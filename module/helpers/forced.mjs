import { FEO } from "../config.mjs";
import { HELD, beside, refuses, scatter, stepBack, stepForward, swaps, tryShove } from "../rules/forced.mjs";
import { tileKey, tilesApart } from "../rules/reach.mjs";
import { canUse, spendSkill } from "../rules/skill-usage.mjs";
import { cooldownWith } from "../rules/choices.mjs";
import { buildChange } from "../rules/timed.mjs";
import { standMove } from "./acting.mjs";
import { cooldownsFor, shovedWith } from "./affinity.mjs";
import { forcedField, reachOf, standsTo, unitsOn } from "./battle-map.mjs";
import { afflictUnit, damageUnit, grantUnit, pop } from "./events.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { takeAction, turnState } from "./phases.mjs";
import { awardEvent } from "./supports.mjs";

/**
 * Forced movement in Foundry: moving a unit's token against its will, by the rules of `rules/forced.mjs`.
 * Everything that moves a unit other than its own movement goes through `moveUnits`: Shove, the steps a fight
 * leaves its units to take, and the skills that swap two units or set one down (see `helpers/actions.mjs`).
 *
 * The token slides to its tile, and two that trade places pass each other. It is not movement of the unit's
 * own: nothing is counted against its movement, and what it had moved this turn stays as it was. A unit that
 * is moved in the middle of its own move goes on from where it lands, with the movement it had left. Whoever
 * wants to know that a unit was moved hears of it on the hook `fire-emblem-online.unitMoved`.
 *
 * A player may move a unit that is not theirs, as when shoving an enemy. Moving that token is then asked of a
 * Game Master.
 *
 * @import {ShoveTry} from "../rules/forced.mjs"
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The name of the query that asks a Game Master to move units for a player. */
export const FORCED_QUERY = `${FEO.id}.forcedMove`;

/** The name of the hook called once a unit was moved against its will: with its token, and where from and to. */
export const MOVED_HOOK = `${FEO.id}.unitMoved`;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The tile a token stands on.
 * @param {TokenDocument|null} token
 * @returns {Tile|null}
 */
function tileOf(token) {
  const tile = tokenTile(token);
  return tile ? { i: tile.i, j: tile.j } : null;
}

/* -------------------------------------------- */

/**
 * How one unit stands to another, by their tokens.
 * @param {TokenDocument} token
 * @param {TokenDocument} other
 * @returns {"friend"|"foe"|"apart"|"self"}
 */
export function relationTo(token, other) {
  if ( token === other ) return "self";
  return standsTo({ army: armyOf(token.actor, token) }, { army: armyOf(other.actor, other) });
}

/* -------------------------------------------- */

/**
 * Is a unit in the fight on a map of square tiles, so that it can be moved or move another?
 * @param {TokenDocument|null} token
 * @returns {boolean}
 */
export function onMap(token) {
  return !!token?.parent?.grid?.isSquare && (token.actor?.type === "unit") && !token.actor.system.defeat?.out && !!tokenTile(token);
}

/* -------------------------------------------- */

/**
 * May one unit move another against its will? Not one that is out of the fight, nor one whose skills keep it
 * where it is (see `refuses`).
 * @param {TokenDocument} by          The unit that would move it
 * @param {TokenDocument} target      The unit that would be moved
 * @returns {boolean}
 */
export function moves(by, target) {
  if ( !onMap(target) || (by.parent !== target.parent) ) return false;
  return !refuses(target.actor.system.skills?.rules, relationTo(by, target));
}

/* -------------------------------------------- */

/**
 * May a unit take a step of its own, as a skill has it once a fight is over? Not one that is held in place.
 * @param {TokenDocument} token
 * @returns {boolean}
 */
export function steps(token) {
  if ( !onMap(token) ) return false;
  const system = token.actor.system;
  if ( !(system.hp?.value > 0) || system.skills?.rules?.includes(HELD) ) return false;
  return !Object.keys(system.conditions ?? {}).some((id) => FEO.conditions[id]?.noMove);
}

/* -------------------------------------------- */
/*  Moving Tokens                               */
/* -------------------------------------------- */

/**
 * Slide a token onto a tile. The move is marked as forced, so that the map neither counts it as the unit's own
 * nor remembers where it came from.
 * @param {TokenDocument} token
 * @param {Tile} tile
 * @returns {Promise<boolean>}    Whether it stands there now
 */
async function slideTo(token, tile) {
  const { x, y } = token.parent.grid.getTopLeftPoint(tile);
  const arrived = await token.move({ x, y, snapped: true, action: "walk" }, {
    constrainOptions: { ignoreWalls: true, ignoreCost: true },
    [FEO.id]: { forced: true }
  });
  return arrived !== false;
}

/* -------------------------------------------- */

/**
 * Move tokens this user may change, all at once, and settle what that means for each unit's own turn.
 * @param {{token: TokenDocument, tile: Tile}[]} list
 * @returns {Promise<boolean>}    Whether every one of them arrived
 */
async function apply(list) {
  const from = list.map(({ token }) => tileOf(token));
  const arrived = await Promise.all(list.map(({ token, tile }) => slideTo(token, tile)));
  for ( const [index, { token, tile }] of list.entries() ) {
    if ( !arrived[index] ) continue;
    try {
      // A unit in the middle of its own move goes on from where it lands: what it moved before stands
      await standMove(token.actor, token);
      Hooks.callAll(MOVED_HOOK, token, { from: from[index], to: { i: tile.i, j: tile.j } });
    } catch(err) {
      console.error(err);
    }
  }
  return arrived.every(Boolean);
}

/* -------------------------------------------- */

/**
 * Move units against their will, each onto a tile of its scene, all at once. Where they land is for whoever
 * asks to have worked out (see `rules/forced.mjs`). Tokens this user may not move are moved by a Game Master.
 * @param {{token: TokenDocument, tile: Tile}[]} list
 * @returns {Promise<boolean>}    Whether they stand there now; false leaves them where they were
 */
export async function moveUnits(list) {
  const wanted = (list ?? []).filter(({ token, tile }) => {
    return token?.parent?.grid?.isSquare && Number.isInteger(tile?.i) && Number.isInteger(tile?.j);
  });
  if ( !wanted.length ) return false;
  try {
    if ( wanted.every(({ token }) => token.isOwner && token.actor?.isOwner) ) return await apply(wanted);
    const gm = game.users.activeGM;
    if ( !gm ) return false;
    return !!(await gm.query(FORCED_QUERY, {
      scene: wanted[0].token.parent.id,
      moves: wanted.map(({ token, tile }) => ({ token: token.id, i: tile.i, j: tile.j }))
    }, { timeout: 10000 }));
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Answer a player's request to move units. Runs for a Game Master, and only puts units on tiles of their own
 * scene that no unit holds but those which are moved away at the same time.
 * @param {{scene: string, moves: {token: string, i: number, j: number}[]}} data
 * @returns {Promise<boolean>}
 */
export async function forcedQuery({ scene: sceneId, moves: asked } = {}) {
  const scene = game.scenes?.get(sceneId);
  if ( !game.user.isGM || !scene?.grid?.isSquare || !Array.isArray(asked) || !asked.length || (asked.length > 12) ) return false;
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const list = [];
  for ( const { token: id, i, j } of asked ) {
    const token = scene.tokens.get(id);
    if ( (token?.actor?.type !== "unit") || !Number.isInteger(i) || !Number.isInteger(j) ) return false;
    if ( (i < i0) || (i >= i1) || (j < j0) || (j >= j1) ) return false;
    list.push({ token, tile: { i, j } });
  }
  const moving = list.map(({ token }) => token);
  const units = unitsOn(scene);
  for ( const { token, tile } of list ) {
    if ( forcedField(token, { units, but: moving }).taken(tile) ) return false;
    if ( list.some((other) => (other.token !== token) && (tileKey(other.tile) === tileKey(tile))) ) return false;
  }
  return apply(list);
}

/* -------------------------------------------- */
/*  Shove                                       */
/* -------------------------------------------- */

/**
 * The movement a unit has left this turn, where that is counted: in a battle, while it is ready to act.
 * @param {TokenDocument} token
 * @returns {number|null}     Null outside of a battle, where a Shove is simply the unit's Action
 */
function movementLeft(token) {
  if ( turnState(token.actor, token) !== "ready" ) return null;
  const view = reachOf(token);
  if ( !view || view.fixed || view.onlyWait ) return 0;
  return Math.max(view.movement - (view.moved ? view.spent : 0), 0);
}

/* -------------------------------------------- */

/**
 * Try a Shove of one unit by another, as they stand: whether it may, where the unit shoved would land, and
 * whether it takes movement in place of the Action.
 * @param {TokenDocument} token       The unit that shoves
 * @param {TokenDocument} target      The unit it would shove
 * @returns {ShoveTry|null}           Null for two units that are not both on one map
 */
export function shoveOf(token, target) {
  if ( !onMap(token) || !onMap(target) || (token === target) || (token.parent !== target.parent) ) return null;
  const system = token.actor.system;
  return tryShove({
    tile: tileOf(token),
    weight: system.wt?.total ?? 0,
    shove: system.shoving ?? null,
    left: movementLeft(token)
  }, {
    tile: tileOf(target),
    weight: target.actor.system.wt?.total ?? 0,
    relation: relationTo(token, target),
    rules: target.actor.system.skills?.rules ?? []
  }, forcedField(target));
}

/* -------------------------------------------- */

/**
 * The units next to a unit, each with what a Shove of it would come to.
 * @param {TokenDocument} token
 * @returns {{target: TokenDocument, tried: ShoveTry}[]}
 */
export function shovesOf(token) {
  if ( !onMap(token) ) return [];
  const here = tileOf(token);
  const found = [];
  for ( const other of unitsOn(token.parent) ) {
    if ( (other.token === token) || (tilesApart(here, other.tile) !== 1) ) continue;
    const tried = shoveOf(token, other.token);
    if ( tried ) found.push({ target: other.token, tried });
  }
  return found;
}

/* -------------------------------------------- */

/**
 * What a Shove leaves behind once the unit shoved has landed: the names of the skills that made it more than
 * a plain one float over the unit that shoved, an enemy that a skill holds in place is held, and the two grow
 * closer where they are partners.
 * @param {TokenDocument} token
 * @param {TokenDocument} target
 * @param {ShoveTry} tried
 * @returns {Promise<void>}
 */
async function afterShove(token, target, tried) {
  const actor = token.actor;
  if ( tried.skills.length ) pop(actor, tried.skills.map((text) => ({ text, tone: "skill" })));
  if ( tried.holds > 0 ) {
    const skill = actor.system.shoving?.skills?.moving || game.i18n.localize("FEO.Shove.label");
    await grantUnit(target.actor, [buildChange({ name: skill, effects: [{ rules: [HELD] }], ends: "turnEnd", turns: tried.holds }, {
      skill, from: token.name || actor.name, giver: actor.uuid
    })], { by: actor });
  }
  try {
    await awardEvent("shove", token, { only: target });
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */

/**
 * A unit Shoves a unit next to it: that unit slides a space straight on, or as far as the unit's skills push
 * it. It is the unit's Action, unless a skill has it take movement instead: what the unit has moved so far
 * then stands, and it goes on from where it stands. Whatever keeps it from shoving is said instead.
 * @param {TokenDocument} token       The unit that shoves
 * @param {TokenDocument} target      The unit next to it
 * @returns {Promise<boolean>}        Whether the unit was shoved
 */
export async function shoveUnit(token, target) {
  const actor = token?.actor;
  const tried = shoveOf(token, target);
  const name = target?.name || target?.actor?.name || "";
  if ( !tried?.ok ) {
    ui.notifications.warn(game.i18n.format(`FEO.Shove.blocked.${tried?.reason ?? "apart"}`, { name }));
    return false;
  }
  if ( !(await moveUnits([{ token: target, tile: tried.tile }])) ) {
    ui.notifications.warn(game.i18n.format("FEO.Shove.failed", { name }));
    return false;
  }
  await afterShove(token, target, tried);

  // A Shove that needed its unit's Affinity, as Muscle lets it be made, has used it
  await shovedWith(actor, tried.lent);
  if ( tried.cost !== null ) await standMove(actor, token, { skill: actor.system.shoving?.skills?.moving ?? "", cost: tried.cost });
  else await takeAction(actor, token, { action: { kind: "shove" } });
  return true;
}

/* -------------------------------------------- */
/*  Steps a Fight Leaves                        */
/* -------------------------------------------- */

/**
 * @typedef StepOffer
 * A step its owner may take or leave, as the map offers it.
 * @property {string} skill                   The skill that offers it
 * @property {TokenDocument} token            The unit whose skill it is
 * @property {Tile[]} tiles                   The tiles to pick from
 * @property {TokenDocument[]} [units]        Units that may be picked in place of a tile
 * @property {string} [hint]                  What a pick does, in a few words
 */

/**
 * The skill of a unit that a step of a fight belongs to: by its Item where the fight named it, else by name.
 * @param {Actor} actor
 * @param {{skill: string, id?: string}} entry
 * @returns {Item|null}
 */
function skillOf(actor, entry) {
  const item = entry.id ? actor.items.get(entry.id) : null;
  if ( item?.type === "skill" ) return item;
  return actor.items.find((other) => (other.type === "skill") && other.system.equipped && (other.name === entry.skill)) ?? null;
}

/* -------------------------------------------- */

/**
 * A fight is over: the units take the steps its skills leave them (see `rules/forced.mjs`). What happens by
 * itself happens first, in the order the fight told it; what a skill says its unit "may" do is then offered on
 * the map to whoever acts for it, one skill after the other, and passed when nothing is picked. Only the unit that started the fight is
 * asked: it is its owner who is at the map.
 * @param {TokenDocument|null} token      The token of the unit that started the fight
 * @param {TokenDocument|null} target     The token of the unit it fought
 * @param {{skill: string, id?: string, by: "initiator"|"defender", step: object}[]} [list]
 *                                        The steps, as the fight told them
 * @param {object} [options]
 * @param {(offer: StepOffer) => Promise<{tile?: Tile, unit?: TokenDocument}|null>} [options.ask]
 *                                        Offers a step on the map; without it, what a unit "may" do is passed
 * @returns {Promise<string[]>}           The skills whose step was taken
 */
export async function takeSteps(token, target, list = [], { ask = null } = {}) {
  const taken = [];
  if ( !token?.parent?.grid?.isSquare || !target || (token.parent !== target.parent) ) return taken;
  const ordered = [...(list ?? [])].sort((a, b) => Number(!!a.step?.may) - Number(!!b.step?.may));
  for ( const entry of ordered ) {
    try {
      const mine = (entry.by === "initiator") ? token : target;
      const foe = (entry.by === "initiator") ? target : token;
      const asks = (entry.step.may && (entry.by === "initiator")) ? ask : null;
      if ( entry.step.may && !asks ) continue;
      if ( await takeStep(mine, foe, entry, asks) ) taken.push(entry.skill);
    } catch(err) {
      console.error(err);
    }
  }
  return taken;
}

/* -------------------------------------------- */

/**
 * Take one step a fight left a unit.
 * @param {TokenDocument} mine        The unit whose skill it is
 * @param {TokenDocument} foe         The unit it fought
 * @param {{skill: string, id?: string, step: object}} entry
 * @param {Function|null} ask         Offers the step on the map, for one its owner may take or leave
 * @returns {Promise<boolean>}        Whether it was taken
 */
async function takeStep(mine, foe, entry, ask) {
  const { skill, step } = entry;
  const actor = mine.actor;
  const here = tileOf(mine);
  const there = tileOf(foe);
  if ( !here || !there || !actor ) return false;
  const flash = () => pop(actor, [{ text: skill, tone: "skill" }]);

  switch ( step.move ) {
    // Into the space between the two, or a space away from the foe: a step of the unit's own
    case "forward":
    case "back": {
      if ( !steps(mine) ) return false;
      const field = forcedField(mine);
      const tile = (step.move === "forward") ? stepForward(here, there, field) : stepBack(here, there, field);
      if ( !tile ) return false;
      if ( step.may && !(await ask({ skill, token: mine, tiles: [tile], hint: "FEO.Forced.hint.back" }))?.tile ) return false;
      if ( !(await moveUnits([{ token: mine, tile }])) ) return false;
      flash();
      return true;
    }

    // The two trade places
    case "swap": {
      if ( !steps(mine) || !moves(mine, foe) ) return false;
      if ( !swaps(here, there, forcedField(mine, { but: [foe] }), forcedField(foe, { but: [mine] })) ) return false;
      if ( !(await moveUnits([{ token: mine, tile: there }, { token: foe, tile: here }])) ) return false;
      flash();
      return true;
    }

    // The foe is shoved, as the command would shove it: no Action, and no movement, is taken for it
    case "shove": {
      const tried = shoveOf(mine, foe);
      if ( !tried?.ok ) return false;
      if ( step.may && !(await ask({ skill, token: mine, tiles: [tried.tile], hint: "FEO.Forced.hint.shove" }))?.tile ) return false;
      if ( !(await moveUnits([{ token: foe, tile: tried.tile }])) ) return false;
      flash();
      await afterShove(mine, foe, tried);
      return true;
    }

    // Every other unit next to the foe is pushed away from it
    case "scatter": {
      const all = unitsOn(mine.parent);
      const others = all.filter((unit) => (unit.token !== mine) && (unit.token !== foe));
      const byId = new Map(others.map((unit) => [unit.token.id, unit.token]));
      const pushed = scatter(there, others.map((unit) => ({ id: unit.token.id, tile: unit.tile })), step.spaces ?? FEO.shove.spaces, (id) => {
        const other = byId.get(id);
        return moves(mine, other) ? forcedField(other, { units: all }) : null;
      });
      if ( !pushed.length ) return false;
      if ( !(await moveUnits(pushed.map((move) => ({ token: byId.get(move.id), tile: move.tile })))) ) return false;
      flash();
      return true;
    }

    // The foe is set down on a tile next to the unit, takes damage and conditions; or takes them where it stands
    case "place": {
      const item = skillOf(actor, entry);
      if ( item?.system.usage?.kind && !canUse(item.system.usage, item.system.state).ok ) return false;
      if ( !onMap(foe) || !(foe.actor.system.hp?.value > 0) ) return false;
      const near = (tilesApart(here, there) === 1) && moves(mine, foe);
      const tiles = near ? beside(here, forcedField(foe)).filter((tile) => tileKey(tile) !== tileKey(there)) : [];
      const picked = await ask({ skill, token: mine, tiles, units: [foe], hint: "FEO.Forced.hint.place" });
      if ( !picked?.tile && !picked?.unit ) return false;
      const moved = !!picked.tile && (await moveUnits([{ token: foe, tile: picked.tile }]));
      flash();
      if ( step.damage > 0 ) await damageUnit(foe.actor, step.damage, { kind: "skill", by: actor, byToken: mine, token: foe });
      for ( const id of step.inflicts ?? [] ) {
        if ( foe.actor.system.defeat?.out ) break;
        await afflictUnit(foe.actor, id, { by: actor, byToken: mine, token: foe });
      }

      // Taking the step is what uses the skill: its cooldown is the shorter one where the foe stayed
      if ( item?.system.usage?.kind && item.isOwner ) {
        const cooldowns = cooldownsFor(actor, item);
        const spent = spendSkill(item.system.usage, item.system.state, { cooldowns });
        const stay = step.cooldown?.stay;
        if ( !moved && Number.isInteger(stay) ) spent.cooldown = (stay > 0) ? cooldownWith(stay, cooldowns) + FEO.skillUse.cooldownExtra : 0;
        await item.update({ "system.state": spent });
      }
      return true;
    }
    default: return false;
  }
}

import { parseRange } from "../rules/combat.mjs";
import { scatter } from "../rules/forced.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { readNumber } from "../rules/skills.mjs";
import { spreadGrant, spreadOut } from "../rules/spread.mjs";
import { buildChange } from "../rules/timed.mjs";
import { tokenTile } from "./exchange.mjs";
import { standingOf } from "./positions.mjs";

export { describeSpread } from "./spread-context.mjs";

/**
 * What a skill does to the units around, in Foundry (see `rules/spread.mjs`): every unit caught gets its share
 * through the one way damage, healing, conditions and lasting changes come to a unit (see `events.mjs`), so
 * that each shows its own number on the map and a unit brought down is defeated by the skill's unit. Where the
 * skill lets its owner pick the units, they are picked on the map in one click each.
 *
 * @import {SpreadShare} from "../rules/spread.mjs"
 */

/**
 * @typedef SpreadEntry
 * A spread that took effect, as a fight or a moment of a turn tells it.
 * @property {string} skill
 * @property {"initiator"|"defender"} [by]    In a fight: the side whose skill it is
 * @property {SpreadShare[]} units            The units caught, each with what it gets
 * @property {number} [choose]                How many of the units listed as `open` its owner may pick instead
 * @property {SpreadShare[]} [open]
 * @property {string} [element]
 * @property {boolean} [nonlethal]
 * @property {{spaces: number, blocked: number}} [push]
 * @property {{free: boolean}} [attack]
 */

/**
 * @typedef SpreadLine
 * What came of a spread for one unit.
 * @property {string} name
 * @property {number} [damage]            The damage it took
 * @property {number} [healed]            The HP it regained
 * @property {string[]} [inflicted]       The conditions it was given
 * @property {string[]} [warded]          Those that something of its own nullified
 * @property {boolean} [granted]          Was it left with a change that lasts?
 * @property {boolean} [pushed]           Was it pushed away?
 * @property {number} [blocked]           The damage it took for standing fast against a push
 * @property {{hit: boolean, crit: boolean, damage: number, kill: boolean, hitChance: number}} [attack]
 *                                        The attack that was made on it
 * @property {boolean} [down]             Was it brought down?
 */

/** Is the unit behind a token still in the fight? */
const standing = (token) => !!token?.actor && !token.actor.system.defeat?.out && (token.actor.system.hp?.value > 0);

/** A die of so many faces, rolled here. */
const die = (faces) => Math.min(Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * faces), faces - 1) + 1;

/* -------------------------------------------- */

/**
 * Pick the units a spread goes to where its owner may: whoever acts for the skill's unit clicks them on the
 * map, one after the other, and those the rules picked stand where they do not. A unit that answers by itself
 * is not asked.
 * @param {TokenDocument} token
 * @param {SpreadEntry} entry
 * @returns {Promise<SpreadShare[]>}
 */
async function pickShares(token, entry) {
  const scene = token.parent;
  const open = (entry.open ?? []).filter((share) => standing(scene.tokens.get(share.id)));
  const count = entry.choose ?? 0;
  if ( !count || (open.length <= count) ) return open.length && count ? open.slice(0, count) : entry.units;
  const { answersAlone } = await import("./answers.mjs");
  if ( answersAlone(token.actor) ) return entry.units;
  const { askOwner } = await import("./rescue.mjs");
  const fixed = entry.units.filter((share) => share.foe);
  const picked = [];
  let left = open;
  while ( picked.length < count ) {
    const answer = await askOwner(token, {
      skill: entry.skill,
      units: left.map((share) => scene.tokens.get(share.id)),
      hint: game.i18n.format("FEO.Spread.hint.pick", { left: count - picked.length })
    });
    const share = answer?.unit ? left.find((other) => other.id === answer.unit.id) : null;
    if ( !share ) break;
    picked.push(share);
    left = left.filter((other) => other !== share);
  }

  // What was not picked is taken as the rules had it: the nearest first
  for ( const share of entry.units ) {
    if ( share.foe || (picked.length >= count) ) continue;
    if ( !picked.some((other) => other.id === share.id) ) picked.push(share);
  }
  return [...fixed, ...picked.slice(0, count)];
}

/* -------------------------------------------- */

/**
 * Push the units a spread catches straight away from the skill's unit, all at once. One that stands next to
 * it and cannot be moved a space, for a wall, the edge of the map, ground it cannot stand on or a unit in its
 * way, takes the damage the spread names instead. A unit that nothing moves against its will is left alone.
 * @param {TokenDocument} token
 * @param {TokenDocument[]} targets
 * @param {{spaces: number, blocked: number}} push
 * @returns {Promise<Map<string, {pushed?: boolean, blocked?: number}>>}    What came of it, by token
 */
async function pushAway(token, targets, push) {
  const told = new Map();
  if ( !token.parent?.grid?.isSquare || !targets.length ) return told;
  const forced = await import("./forced.mjs");
  const { forcedField, unitsOn } = await import("./battle-map.mjs");
  const { damageUnit } = await import("./events.mjs");
  const here = tokenTile(token);
  if ( !here ) return told;
  const centre = { i: here.i, j: here.j };
  const all = unitsOn(token.parent);
  const byId = new Map(targets.map((target) => [target.id, target]));
  const near = targets.map((target) => ({ id: target.id, tile: tokenTile(target) })).filter((unit) => unit.tile && (tilesApart(centre, unit.tile) === 1));
  const moved = scatter(centre, near.map((unit) => ({ id: unit.id, tile: { i: unit.tile.i, j: unit.tile.j } })), push.spaces ?? 1, (id) => {
    const other = byId.get(id);
    return forced.moves(token, other) ? forcedField(other, { units: all }) : null;
  });
  if ( moved.length && (await forced.moveUnits(moved.map((move) => ({ token: byId.get(move.id), tile: move.tile })))) ) {
    for ( const move of moved ) told.set(move.id, { pushed: true });
  }
  for ( const unit of near ) {
    const other = byId.get(unit.id);
    if ( told.has(unit.id) || !forced.moves(token, other) || !(push.blocked > 0) || !standing(other) ) continue;
    const dealt = await damageUnit(other.actor, push.blocked, { kind: "skill", by: token.actor, byToken: token, token: other });
    told.set(unit.id, { blocked: dealt?.dealt ?? push.blocked });
  }
  return told;
}

/* -------------------------------------------- */

/**
 * Deal a spread that took effect: every unit caught gets its share.
 * @param {TokenDocument|null} token      The token of the skill's unit
 * @param {SpreadEntry} entry
 * @param {object} [options]
 * @param {number[]} [options.dice]       Filled in with the dice the attacks it has its unit make rolled
 * @returns {Promise<{skill: string, by?: string, lines: SpreadLine[]}|null>}     What came of it for each unit;
 *          null where nothing did
 */
export async function dealSpread(token, entry, { dice = null } = {}) {
  const scene = token?.parent;
  const actor = token?.actor;
  if ( !scene || !actor || !entry?.units ) return null;
  const { afflictUnit, damageUnit, grantUnit, healUnit, pop } = await import("./events.mjs");
  const shares = await pickShares(token, entry);
  const lines = [];
  const pushing = [];
  let named = false;
  const flash = () => {
    if ( !named ) pop(actor, [{ text: entry.skill, tone: "skill" }]);
    named = true;
  };
  for ( const share of shares ) {
    const target = scene.tokens.get(share.id);
    if ( !target?.actor ) continue;
    const line = { name: target.name || target.actor.name, id: share.id };

    // The unit that was fought has had its share in the fight: only a push is left to make, and what it
    // took there is told as it was
    if ( share.foe ) {
      if ( share.damage > 0 ) line.damage = share.damage;
      const laid = (share.inflicted ?? []).filter((given) => given.success !== false).map((given) => given.id);
      if ( laid.length ) line.inflicted = laid;
      if ( share.push && standing(target) ) pushing.push(target);
      if ( (line.damage > 0) || line.inflicted || share.push ) lines.push(line);
      continue;
    }
    if ( !standing(target) ) continue;
    flash();
    if ( share.damage > 0 ) {
      const dealt = await damageUnit(target.actor, share.damage, {
        kind: "skill", by: actor, byToken: token, token: target, element: entry.element ?? null, nonlethal: !!entry.nonlethal
      });
      line.damage = dealt?.dealt ?? share.damage;
      if ( dealt?.defeated ) line.down = true;
    }
    if ( share.heal > 0 ) {
      const healed = await healUnit(target.actor, share.heal, { by: actor, byToken: token, token: target });
      if ( healed?.healed > 0 ) line.healed = healed.healed;
    }
    for ( const condition of standing(target) ? (share.inflicts ?? []) : [] ) {
      const given = await afflictUnit(target.actor, condition.id, {
        by: actor, byToken: token, token: target, turns: condition.turns, passed: !!condition.passed
      });
      if ( !given ) continue;
      if ( given.success === false ) (line.warded ??= []).push(condition.id);
      else (line.inflicted ??= []).push(condition.id);
    }

    // A change that lasts with a condition is not left on a unit that was not given it
    const kept = !share.change?.while || (line.inflicted ?? []).includes(share.change.while);
    if ( share.change && kept && standing(target) ) {
      const given = await grantUnit(target.actor, [share.change], { by: actor });
      if ( given?.length ) line.granted = true;
    }
    if ( share.push ) pushing.push(target);

    // An attack of the skill's unit on it, with the weapon in hand
    if ( share.attack && standing(target) && (actor.system.hp?.value > 0) && target.object ) {
      const { strikeBeside } = await import("./exchange.mjs");
      const struck = await strikeBeside(actor, token, target.object, {
        skill: entry.skill, hit: share.attack.hit ?? 0, share: share.attack.share ?? 1, free: !!entry.attack?.free
      });
      if ( struck ) {
        line.attack = { hit: struck.hit, crit: struck.crit, damage: struck.damage, kill: struck.kill, hitChance: struck.hitChance };
        if ( struck.kill ) line.down = true;
        if ( dice ) dice.push(...struck.dice);
      }
    }
    if ( (line.damage !== undefined) || line.healed || line.inflicted || line.warded || line.granted || line.attack || share.push ) lines.push(line);
  }

  // Those that are pushed are pushed together, so that one may take the place another leaves
  if ( pushing.length && entry.push ) {
    flash();
    const pushed = await pushAway(token, pushing, entry.push);
    for ( const line of lines ) {
      const came = pushed.get(line.id);
      if ( came?.pushed ) line.pushed = true;
      if ( came?.blocked ) line.blocked = came.blocked;
    }
  }
  const told = lines.filter((line) => (line.damage !== undefined) || line.healed || line.inflicted || line.warded || line.granted || line.attack || line.pushed || line.blocked);
  return told.length ? { skill: entry.skill, ...(entry.by ? { by: entry.by } : {}), lines: told.map(({ id, ...line }) => line) } : null;
}

/* -------------------------------------------- */

/**
 * Deal what the skills of a fight do to the units around the two, now that the fight is saved (see
 * `ExchangeResult.spreads`). A unit that fell in the fight does nothing more, but for what it did as it fell.
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {{initiator: TokenDocument|null, defender: TokenDocument|null}} tokens
 * @param {object} [options]
 * @param {number[]} [options.dice]       Filled in with the dice further attacks rolled
 * @returns {Promise<{skill: string, by: string, lines: SpreadLine[]}[]>}     What came of each, for the card
 */
export async function takeSpreads(result, tokens, { dice = null } = {}) {
  const told = [];
  for ( const entry of result.spreads ?? [] ) {
    const token = tokens[entry.by];
    if ( !token?.parent || !token.actor ) continue;
    try {
      const dealt = await dealSpread(token, entry, { dice });
      if ( dealt ) told.push(dealt);
    } catch(err) {
      console.error(err);
    }
  }
  return told;
}

/* -------------------------------------------- */

/**
 * Describe a unit for the numbers a spread reads from it.
 * @param {Actor} actor
 * @param {object|null} near
 * @returns {object}
 */
function selfOf(actor, near) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  return {
    name: actor.token?.name ?? actor.name,
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    stats: system.statValues,
    base: system.bare?.base ?? {},
    weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
    qualities: system.specialQualities ?? "",
    near
  };
}

/* -------------------------------------------- */

/**
 * Work a spread out on the map and deal it, outside of a fight the system rolls: as a condition is inflicted,
 * as an enemy is defeated, as a skill is used.
 * @param {TokenDocument|null} token      The token of the skill's unit
 * @param {object} about
 * @param {string} about.skill
 * @param {object} about.spread           The `spread` part, with the numbers read from its unit worked out
 *                                        where they were (see `resolveProc`)
 * @param {TokenDocument|null} [about.foe]    The unit it is about: afflicted, or defeated
 * @param {number} [about.dealt]
 * @param {{id: string, turns?: number}|null} [about.inflicted]
 * @returns {Promise<{skill: string, lines: SpreadLine[]}|null>}
 */
export async function castSpread(token, { skill, spread, foe = null, dealt = 0, inflicted = null } = {}) {
  const actor = token?.actor;
  const place = standingOf(token);
  if ( !actor || !place || !spread ) return null;
  const mine = selfOf(actor, place.near);
  const weapon = actor.system.equippedWeapon;
  const out = spreadOut(spread, place.near, foe ? (standingOf(foe)?.near ?? null) : null, {
    dealt,
    inflicted,
    die,
    weaponReach: weapon ? (parseRange(weapon.system.range, actor.system.statValues)?.max ?? 1) : 1,
    read: (value, unit) => readNumber(value, unit ?? mine, null)
  });
  if ( !out?.units.length ) return null;
  const about = { skill, from: mine.name, giver: actor.uuid, giverInTurn: false };
  const settle = (share) => (spread.grant ? { ...share, change: buildChange(spreadGrant(spread.grant, share.inflicts), about) } : share);
  return dealSpread(token, {
    skill,
    units: out.units.map(settle),
    ...(out.choose ? { choose: out.choose, open: (out.open ?? []).map(settle) } : {}),
    ...(spread.element ? { element: spread.element } : {}),
    ...(spread.nonlethal ? { nonlethal: true } : {}),
    ...(spread.push ? { push: { spaces: spread.push.spaces ?? 1, blocked: spread.push.blocked ?? 0 } } : {})
  });
}

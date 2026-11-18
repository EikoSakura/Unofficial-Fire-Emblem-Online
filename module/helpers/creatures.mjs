import { FEO } from "../config.mjs";
import { actArea, actOf } from "../rules/actions.mjs";
import { planAssignment, planUpdate } from "../rules/classes.mjs";
import {
  CREATURE_FLAG, POSSESSED, actMakes, checkGrowth, creatureCost, creatureCount, creatureEnds, creatureExtras, creatureHp, creatureNote,
  creatureRoom, creatureStats, gainsDue, questionsOf, raisable, rankedNames, spotsFor, weaponWay, withQualities
} from "../rules/creatures.mjs";
import { relationOf } from "../rules/positions.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { canUse, usesLeft } from "../rules/skill-usage.mjs";
import { catchUpExp, drawWeapon, levelsBehind, weaponPool } from "../rules/summon.mjs";
import { buildChange } from "../rules/timed.mjs";
import { answersAlone, askFor } from "./answers.mjs";
import { embedClass, findItem, grantSkills, knownSkills } from "./classes.mjs";
import { syncStatus } from "./defeat.mjs";
import { damageUnit, pop, spendFor } from "./events.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { phaseOf } from "./phases.mjs";
import { sightField } from "./sight.mjs";
import { SUMMONED_FLAG, alwaysWields } from "./weapons.mjs";

/**
 * Creatures in Foundry: what a skill's `makes` part brings onto the map (see `rules/creatures.mjs`, which has
 * all such a part can say, and decides everything that can be decided without Foundry).
 *
 * One way in, whatever the creature: `makeAt` for a skill used as an action on a tile picked on the map, and
 * `raiseFor` for an enemy raised as it falls. Both ask a Game Master's client to do it (`placeCreature`), since
 * making a unit and placing a token are a Game Master's to do, and that client checks everything once more.
 *
 * What a creature is in Foundry goes by what it is made from. One made from numbers (its maker's, a table's)
 * or from the unit that fell is an Actor of its own, kept in one folder and deleted with its token: as the
 * battle ends, or when its token is taken off the map. One made from a class that its skill keeps is an Actor
 * that stays, as a Phantom does, and only its token goes. One the Game Master prepared is a token of that
 * Actor that is not linked to it, with what it gains written on the token alone, so that no Actor is made.
 * Each carries a note of what made it (`creatureOf`), from which everything later is read: whose it is, who
 * acts for it, whether its pack is locked, and what becomes of it.
 */

/** The name of the query that asks a Game Master to bring a creature onto the map for a player. */
export const CREATURE_QUERY = `${FEO.id}.creature`;

/** The flag, on a creature, that holds the UUID of its maker: what auras given through a creature go by. */
const SUMMONER_FLAG = "summoner";

/** How many tiles beyond the reach of a skill the creatures one use makes may spread out, past the first. */
const SPREAD = 2;

/** The flag that marks the folder creatures are kept in while they last. */
const FOLDER_FLAG = "creatures";

const GROWTH_TEMPLATE = `systems/${FEO.id}/templates/dialog/creature-growth.hbs`;
const PREPARED_TEMPLATE = `systems/${FEO.id}/templates/dialog/creature-prepared.hbs`;

const fold = (name) => String(name ?? "").trim().toLowerCase();

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * What is noted on a creature of what made it. A Phantom that was summoned before creatures were told apart
 * this way is read as one.
 * @param {Actor|null} actor
 * @returns {object|null}     Null for a unit that no skill made
 */
export function creatureOf(actor) {
  const note = actor?.getFlag?.(FEO.id, CREATURE_FLAG);
  if ( note?.kind ) return note;
  const summoner = actor?.getFlag?.(FEO.id, SUMMONER_FLAG);
  if ( !summoner ) return null;
  return {
    kind: "phantom", maker: summoner, skill: "Summon", scene: "", control: "maker", locked: false, keeps: true, exp: "maker", lasts: "battle",
    own: true, level: "maker", option: actor.getFlag(FEO.id, "summonWeapon") ?? ""
  };
}

/* -------------------------------------------- */

/**
 * The unit that made a creature, if it can still be found.
 * @param {Actor|null} actor
 * @returns {Actor|null}
 */
export function makerOf(actor) {
  const uuid = creatureOf(actor)?.maker;
  if ( !uuid ) return null;
  try {
    const found = foundry.utils.fromUuidSync(uuid);
    return (found?.documentName === "Actor") && (found.type === "unit") ? found : null;
  } catch(err) {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * The unit that earns what a creature's fights would earn it: its maker, where its skill says so.
 * @param {Actor|null} actor
 * @returns {Actor|null}
 */
export function heirOf(actor) {
  return (creatureOf(actor)?.exp === "maker") ? makerOf(actor) : null;
}

/* -------------------------------------------- */

/**
 * Is a unit a creature whose pack cannot be manipulated?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isLocked(actor) {
  return !!creatureOf(actor)?.locked;
}

/* -------------------------------------------- */

/**
 * Why a weapon or an item cannot leave a unit's pack or come into it, if it cannot: a weapon a creature was
 * handed never changes hands, and nothing is traded with a creature whose pack is locked.
 * @param {Actor|null} actor      The unit that carries it, or would
 * @param {Item|null} [item]
 * @returns {string|null}         A localization key; null when nothing stands in the way
 */
export function packBar(actor, item = null) {
  if ( item && alwaysWields(item) ) return "FEO.Creature.bound";
  if ( isLocked(actor) ) return "FEO.Creature.locked";
  return null;
}

/* -------------------------------------------- */

/**
 * Does a creature stand: is it on its feet and in the fight?
 * @param {Actor} actor
 * @returns {boolean}
 */
function stands(actor) {
  return !actor.system.defeat?.state && (actor.system.hp.value > 0);
}

/* -------------------------------------------- */

/**
 * The creatures on a scene, each with its token and what is noted on it.
 * @param {Scene|null} scene
 * @returns {{token: TokenDocument, actor: Actor, note: object}[]}
 */
export function creaturesOn(scene) {
  const list = [];
  for ( const token of scene?.tokens ?? [] ) {
    const actor = token.actor;
    const note = (actor?.type === "unit") ? creatureOf(actor) : null;
    if ( note ) list.push({ token, actor, note });
  }
  return list;
}

/* -------------------------------------------- */

/**
 * The creatures a unit has made that stand on its scene, by the skills that made them.
 * @param {TokenDocument} token
 * @param {string[]|null} [skills]      Only those these skills made
 * @returns {TokenDocument[]}
 */
export function creaturesBy(token, skills = null) {
  const maker = token?.actor?.uuid;
  if ( !maker ) return [];
  return creaturesOn(token.parent).filter(({ actor, note }) => (note.maker === maker) && stands(actor) && (!skills || skills.includes(note.skill)))
    .map((entry) => entry.token);
}

/* -------------------------------------------- */

/**
 * The creatures a unit keeps from one battle to the next, in the order they were made.
 * @param {Actor} maker
 * @param {string} kind
 * @returns {Actor[]}
 */
export function keptBy(maker, kind) {
  if ( !maker?.uuid ) return [];
  return game.actors.filter((actor) => {
    const note = (actor.type === "unit") ? creatureOf(actor) : null;
    return !!note?.keeps && (note.maker === maker.uuid) && (fold(note.kind) === fold(kind));
  });
}

/* -------------------------------------------- */

/**
 * The names and effects of the skills a unit has equipped, as what they say of creatures is read from them.
 * @param {Actor} actor
 * @returns {{name: string, effects: object[], choice: string}[]}
 */
function equipped(actor) {
  return actor.items.filter((item) => (item.type === "skill") && item.system.equipped)
    .map((item) => ({ id: item.id, name: item.name, effects: item.system.effects ?? [], choice: item.system.choice ?? "" }));
}

/* -------------------------------------------- */

/**
 * The tiles of a scene a creature may appear on, among some: those on the map that nothing crosses not, and
 * that no unit in the fight stands on. A hidden token is passed over, so that a player learns nothing from a
 * tile that looks free, and so is the token a returning unit left behind, which goes as it comes back.
 * @param {Scene} scene
 * @param {{i: number, j: number}[]} tiles
 * @param {Actor|null} [returning]
 * @returns {{i: number, j: number}[]}
 */
export function freeAmong(scene, tiles, returning = null) {
  const field = sightField(scene);
  if ( !field ) return [];
  const taken = [];
  for ( const other of scene.tokens ) {
    if ( other.hidden || !other.actor || (other.actor.type !== "unit") ) continue;
    if ( other.actor.system.defeat?.state || other.actor.system.defeat?.out ) continue;
    if ( returning && (other.actorId === returning.id) ) continue;
    const tile = tokenTile(other);
    if ( tile ) taken.push(tile);
  }
  const held = (spot) => taken.some((other) => {
    const width = Math.max(other.width ?? 1, 1);
    const height = Math.max(other.height ?? 1, 1);
    return (spot.i >= other.i) && (spot.i < other.i + height) && (spot.j >= other.j) && (spot.j < other.j + width);
  });
  return (tiles ?? []).filter((tile) => field.inside(tile) && !field.blocked(tile) && !held(tile));
}

/* -------------------------------------------- */

/**
 * The tiles a creature may be placed on by a skill, as its area says: those in its range that are free.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {object} act                The skill's `act` part
 * @param {object} [options]
 * @param {number} [options.beyond]   How many tiles further out to look, for the tiles several creatures
 *                                    spread out over once the first stands on the tile picked
 * @returns {{i: number, j: number}[]}
 */
function tilesFor(token, act, { beyond = 0 } = {}) {
  const origin = tokenTile(token);
  const area = actArea(act);
  if ( !origin || !area ) return [];
  const within = Math.max(area.range?.within ?? 1, 0) + Math.max(beyond, 0);
  const from = Math.max(area.range?.from ?? 0, 0);
  const field = sightField(token.parent);
  if ( !field ) return [];
  const tiles = [];
  for ( let di = -within; di <= within; di++ ) {
    const across = within - Math.abs(di);
    for ( let dj = -across; dj <= across; dj++ ) {
      if ( (Math.abs(di) + Math.abs(dj)) < from ) continue;
      const tile = { i: origin.i + di, j: origin.j + dj };
      if ( field.inside(tile) ) tiles.push(tile);
    }
  }
  return freeAmong(token.parent, tiles);
}

/* -------------------------------------------- */

/**
 * Where a skill stands with its limits right now: how many more creatures its unit may make with it, how
 * many one use may make, and the unit of its that would come back.
 * @param {TokenDocument} token
 * @param {object} makes
 * @param {{i: number, j: number}[]} [tiles]      The free tiles there are for them
 * @returns {{room: number, limit: number, count: number, returning: Actor|null, fresh: boolean}}
 */
function standingWith(token, makes, tiles = null) {
  const actor = token.actor;
  const scene = token.parent;
  const standing = creaturesOn(scene).filter((entry) => stands(entry.actor)).map((entry) => ({ kind: entry.note.kind, maker: entry.note.maker }));
  const extras = creatureExtras(equipped(actor), makes.kind, actor.system.level);
  const room = creatureRoom(makes, standing, actor.uuid, extras.more);
  let returning = null;
  if ( makes.keeps ) {
    const out = new Set(creaturesOn(scene).filter((entry) => stands(entry.actor)).map((entry) => entry.actor.id));
    returning = keptBy(actor, makes.kind).find((kept) => !out.has(kept.id)) ?? null;
  }
  const count = creatureCount(makes, { room, hp: actor.system.hp.value, tiles: tiles ? tiles.length : Infinity });
  const limit = Number.isFinite(makes.most) ? makes.most + (makes.field ? 0 : extras.more) : Infinity;
  return { room, limit, count, returning, fresh: !!makes.keeps && !returning };
}

/* -------------------------------------------- */

/**
 * Why a skill that makes a creature cannot be used right now, if it cannot.
 * @param {TokenDocument} token
 * @param {object} act            The skill's `act` part
 * @param {number} tiles          How many tiles it could be placed on
 * @returns {{key: string, data?: object}|null}
 */
export function makesBlocked(token, act, tiles) {
  const makes = actMakes(act);
  if ( !makes ) return null;
  if ( !game.user.isGM && !game.users.activeGM ) return { key: "FEO.Creature.warn.noGM" };
  if ( (makes.body === "prepared") && !game.user.isGM ) return { key: "FEO.Creature.warn.gmOnly" };
  const state = standingWith(token, makes);
  if ( state.room < 1 ) return { key: (state.limit === 1) ? "FEO.Creature.warn.limitOne" : "FEO.Creature.warn.limit", data: { limit: state.limit } };
  if ( !(tiles > 0) ) return { key: "FEO.Creature.warn.noRoom" };
  if ( state.count < 1 ) return { key: "FEO.Creature.warn.cost", data: { hp: makes.costs?.hp ?? 0 } };
  return null;
}

/* -------------------------------------------- */
/*  Asking                                      */
/* -------------------------------------------- */

/**
 * The units a Game Master has prepared: unit Actors no player owns, that no skill made.
 * @returns {Actor[]}
 */
function preparedUnits() {
  return game.actors.filter((actor) => (actor.type === "unit") && !actor.hasPlayerOwner && !creatureOf(actor))
    .sort((a, b) => (a.folder?.name ?? "").localeCompare(b.folder?.name ?? "") || a.name.localeCompare(b.name));
}

/* -------------------------------------------- */

/**
 * Ask the Game Master which of the units they have prepared appear, and how many of each.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {object} makes
 * @param {number} most         How many may appear in all
 * @returns {Promise<{uuid: string, count: number}[]|null>}     Null when it was called off
 */
async function askPrepared(token, item, makes, most) {
  const units = preparedUnits();
  if ( !units.length ) {
    ui.notifications.warn("FEO.Creature.warn.noPrepared", { localize: true });
    return null;
  }
  const groups = [];
  for ( const unit of units ) {
    const name = unit.folder?.name ?? "";
    let group = groups.find((entry) => entry.name === name);
    if ( !group ) groups.push(group = { name, units: [] });
    group.units.push({ id: unit.id, name: unit.name, img: unit.prototypeToken?.texture?.src || unit.img, cls: unit.system.className ?? "", level: unit.system.level });
  }
  const content = document.createElement("div");
  const html = await foundry.applications.handlebars.renderTemplate(PREPARED_TEMPLATE, { groups, most, one: most === 1 });
  content.innerHTML = `<div class="feo-class-dialog feo-creature-prepared">${html}</div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.Creature.prepared.title", { skill: item.name, name: token.name || token.actor.name }) },
    position: { width: 420 },
    content,
    buttons: [
      { action: "call", label: "FEO.Creature.prepared.confirm", icon: "fa-solid fa-flag", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false,
    render: (event, app) => {
      const root = app.element.querySelector(".feo-creature-prepared");
      const confirm = app.element.querySelector('button[data-action="call"]');
      const tally = root?.querySelector("[data-tally]");
      const refresh = () => {
        const total = Array.from(root.querySelectorAll("input[type=number]")).reduce((sum, input) => sum + Math.max(Math.trunc(Number(input.value)) || 0, 0), 0);
        if ( tally ) tally.textContent = game.i18n.format("FEO.Creature.prepared.tally", { total, most });
        if ( confirm ) confirm.disabled = (total < 1) || (total > most);
      };
      root?.addEventListener("input", refresh);
      refresh();
    }
  });
  if ( !answer || (answer === "cancel") ) return null;
  const picked = [];
  for ( const unit of units ) {
    const count = Math.max(Math.trunc(Number(answer[`count.${unit.id}`] ?? answer.count?.[unit.id])) || 0, 0);
    if ( count > 0 ) picked.push({ uuid: unit.uuid, count });
  }
  const total = picked.reduce((sum, entry) => sum + entry.count, 0);
  return (total >= 1) && (total <= most) ? picked : null;
}

/* -------------------------------------------- */

/**
 * Ask whoever uses a skill what it has picked before its creature appears: which of a table, which weapon,
 * how many; and for units the Game Master has prepared, which of them. Each is a short list above the dock.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @param {object} act                Its `act` part
 * @returns {Promise<object|null>}    What was picked, by the id of each question; null when it was called off
 */
export async function askMakes(token, item, act) {
  const makes = actMakes(act);
  if ( !makes ) return null;
  const tiles = tilesFor(token, act, { beyond: SPREAD });
  const state = standingWith(token, makes, tiles);
  const picks = {};
  const i18n = game.i18n;
  for ( const question of questionsOf(makes, { returning: !!state.returning, room: state.count }) ) {
    const options = question.options.map((option) => ({ id: option.id, label: option.localize ? i18n.localize(option.label) : option.label }));
    const hint = i18n.localize(`FEO.Creature.ask.${(question.id === "weapon") && (weaponWay(makes) === "draw") ? "kind" : question.id}`);
    const asked = game.feo.hud?.choose?.({ token, skill: item.name, hint, options, wait: FEO.creatures.promptTime }) ?? null;
    const answer = asked ? await asked : null;
    if ( !answer ) return null;
    picks[question.id] = answer;
  }
  if ( makes.body === "prepared" ) {
    if ( !game.user.isGM ) return null;
    picks.units = await askPrepared(token, item, makes, state.count);
    if ( !picks.units?.length ) return null;
  }
  return picks;
}

/* -------------------------------------------- */
/*  Making                                      */
/* -------------------------------------------- */

/**
 * A skill used on a tile brings its creature onto the map there: what is still to be picked is asked, the
 * weapon of one that draws it is drawn, a Game Master's client places it, and its maker pays what it costs.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @param {object} act                Its `act` part
 * @param {{i: number, j: number}} tile     The tile that was picked
 * @param {object|null} [picks]       What was picked beforehand (see `askMakes`)
 * @returns {Promise<{rows: object[], rolls: Roll[]}|null>}     What the card of the skill says of it; null
 *                                    when nothing appeared
 */
export async function makeAt(token, item, act, tile, picks = null) {
  const makes = actMakes(act);
  const actor = token?.actor;
  const scene = token?.parent;
  if ( !makes || !actor || !scene || !tile ) return null;
  const i18n = game.i18n;
  const warn = (key, data = {}) => {
    ui.notifications.warn(i18n.format(key, { skill: item.name, ...data }));
    return null;
  };
  const gm = game.user.isGM ? null : game.users.activeGM;
  if ( !game.user.isGM && !gm ) return warn("FEO.Creature.warn.noGM");
  picks ??= await askMakes(token, item, act);
  if ( !picks ) return null;

  // A weapon that is drawn is drawn here, with a die that has a face for each it could be
  const rolls = [];
  const request = { maker: actor.uuid, scene: scene.id, token: token.id, item: item.id, tile: { i: tile.i, j: tile.j }, picks: { ...picks } };
  if ( weaponWay(makes) === "draw" ) {
    const state = standingWith(token, makes);
    const kind = state.returning ? (creatureOf(state.returning)?.option || picks.weapon) : picks.weapon;
    const pool = weaponPool(state.returning?.system.level ?? 1, kind);
    if ( !pool.length ) return warn("FEO.Creature.warn.noWeapon");
    const roll = new foundry.dice.Roll(`1d${pool.length}`);
    await roll.evaluate();
    rolls.push(roll);
    request.picks.weapon = kind;
    request.weapon = drawWeapon(pool, roll.total);
  }
  let result = null;
  try {
    result = game.user.isGM ? await placeCreature(request) : await gm.query(CREATURE_QUERY, request, { timeout: 30000 });
  } catch(err) {
    console.error(err);
  }
  if ( !result?.ok ) return warn(`FEO.Creature.warn.${result?.reason ?? "failed"}`, result?.data ?? {});

  // What each cost its maker
  const cost = creatureCost(makes, result.made.length);
  const rows = [];
  if ( cost.hp > 0 ) {
    const paid = await damageUnit(actor, cost.hp, { kind: "skill", nonlethal: true, token });
    rows.push({ label: token.name || actor.name, value: i18n.format("FEO.Act.harmed", { amount: paid?.dealt ?? cost.hp }) });
  }
  pop(actor, [{ text: item.name, tone: "skill" }]);
  const names = new Map();
  for ( const made of result.made ) names.set(made.name, (names.get(made.name) ?? 0) + 1);
  for ( const [name, count] of names ) {
    const first = result.made.find((made) => made.name === name);
    rows.push({
      label: i18n.localize("FEO.Creature.row.unit"),
      value: (count > 1) ? i18n.format("FEO.Creature.row.many", { name, count }) : i18n.format("FEO.Creature.row.one", { name, level: first.level })
    });
    if ( first.weapon ) rows.push({ label: i18n.localize("FEO.Creature.row.weapon"), value: first.weapon });
  }
  if ( result.behind > 0 ) rows.push({ label: i18n.localize("FEO.Creature.row.behind"), value: String(result.behind), cls: "gold" });

  // What is still to be settled for one that is kept: its growth rates, and the skill another skill gives it
  if ( result.kept ) settleKept(actor, result.kept).catch((err) => console.error(err));
  return { rows, rolls };
}

/* -------------------------------------------- */

/**
 * A unit has defeated an enemy: what its skills raise from it is raised, on the tile it fell on. Whoever acts
 * for the unit is asked first where its skill says so; a unit that answers by itself always does. A skill
 * that counts its uses is used only once a creature stands.
 * @param {TokenDocument} byToken         The unit that defeated it
 * @param {TokenDocument} foeToken        The unit that fell
 * @param {{skill: string, id?: string, makes: object}[]} entries     As a fight or a kill reports them
 * @returns {Promise<string[]>}           The names of the creatures that were raised
 */
export async function raiseFor(byToken, foeToken, entries = []) {
  const actor = byToken?.actor;
  const foe = foeToken?.actor;
  const raisedNames = [];
  if ( !actor || !foe || !entries.length || !byToken.parent || (byToken.parent !== foeToken.parent) ) return raisedNames;
  if ( !stands(actor) ) return raisedNames;
  const i18n = game.i18n;

  // What became of the unit that fell is settled a moment after its HP: only one that died is raised
  for ( let n = 0; (n < 20) && !(foe.system.hp.value > 0) && !foe.system.defeat?.state; n++ ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if ( !raisable({ hp: foe.system.hp.value, state: foe.system.defeat?.state ?? "" }) ) return raisedNames;
  const foeName = foeToken.name || foe.name;
  for ( const entry of entries ) {
    const item = actor.items.find((skill) => (skill.type === "skill") && skill.system.equipped && (entry.id ? (skill.id === entry.id) : (skill.name === entry.skill)));
    const makes = item ? raiseOf(item) : null;
    if ( !makes ) continue;
    const usage = item.system.usage;
    if ( usage?.kind && !canUse(usage, item.system.state).ok ) continue;
    const gm = game.user.isGM ? null : game.users.activeGM;
    if ( !game.user.isGM && !gm ) continue;

    // Its owner is asked, where the skill is one that is chosen when to activate
    if ( makes.asks && !answersAlone(actor) ) {
      const left = usage?.kind ? usesLeft(usage, item.system.state) : null;
      const key = `${item.id}|raise`;
      const point = {
        index: 0, on: "raise", side: "initiator", attack: null,
        about: i18n.format("FEO.Creature.raise.about", { name: byToken.name || actor.name, foe: foeName }),
        offers: [{ key, skill: item.name, id: item.id, what: "raise", amount: Number.isFinite(left) ? left : 0 }]
      };
      let picked = null;
      try {
        picked = await askFor({ token: byToken, actor }, point, foeName, { alone: false });
      } catch(err) {
        console.error(err);
      }
      if ( picked !== key ) continue;
    }
    const request = { maker: actor.uuid, scene: byToken.parent.id, token: byToken.id, item: item.id, slain: foeToken.id };
    let result = null;
    try {
      result = game.user.isGM ? await placeCreature(request) : await gm.query(CREATURE_QUERY, request, { timeout: 30000 });
    } catch(err) {
      console.error(err);
    }
    if ( !result?.ok ) {
      if ( result?.reason && (result.reason !== "failed") ) ui.notifications.warn(i18n.format(`FEO.Creature.warn.${result.reason}`, { skill: item.name, ...(result.data ?? {}) }));
      continue;
    }
    if ( usage?.kind ) await spendFor(actor, item.id);
    pop(actor, [{ text: item.name, tone: "skill" }]);
    raisedNames.push(...result.made.map((made) => made.name));

    // The enemy stands again once: what else would raise it finds it standing
    break;
  }
  return raisedNames;
}

/* -------------------------------------------- */

/**
 * What a skill raises from an enemy its unit defeats, if it raises anything.
 * @param {Item} item
 * @returns {object|null}
 */
function raiseOf(item) {
  if ( item?.system?.automate === false ) return null;
  const effect = (item?.system?.effects ?? []).find((entry) => (entry?.proc?.on === "kill") && entry.makes && (typeof entry.makes === "object"));
  return effect?.makes ?? null;
}

/* -------------------------------------------- */
/*  Placing                                     */
/* -------------------------------------------- */

/**
 * The folder creatures are kept in while they last, made the first time one is.
 * @returns {Promise<Folder>}
 */
async function creatureFolder() {
  const found = game.folders.find((folder) => (folder.type === "Actor") && folder.getFlag(FEO.id, FOLDER_FLAG));
  if ( found ) return found;
  const Folder = foundry.documents.Folder.implementation;
  return Folder.create({ name: game.i18n.localize("FEO.Creature.folder"), type: "Actor", flags: { [FEO.id]: { [FOLDER_FLAG]: true } } });
}

/* -------------------------------------------- */

/**
 * Who may change a creature: whoever may change the unit that acts for it, or the Game Master alone.
 * @param {Actor|null} source     The unit whose owners act for it
 * @returns {object}
 */
function ownershipOf(source) {
  return source ? foundry.utils.deepClone(source.ownership) : { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
}

/* -------------------------------------------- */

/**
 * What a creature always has, as a change that lasts on it: the effects its skill gives it, and for one whose
 * pack is locked, that nothing is stolen from it.
 * @param {object} makes
 * @param {string} skill
 * @returns {object[]}      The changes, as a unit keeps them
 */
function lastingOf(makes, skill) {
  const effects = [...(makes.effects ?? []), ...(makes.locked ? [{ rules: ["unstolen"] }] : [])];
  if ( !effects.length ) return [];
  return [buildChange({ name: skill, effects, ends: "never" }, { skill, own: true })];
}

/* -------------------------------------------- */

/**
 * The weapon a creature is handed, as an Item of the Weapons tab.
 * @param {object} makes
 * @param {object} about
 * @param {Actor} about.maker
 * @param {object|null} [about.option]    The row picked, for a creature picked from a table
 * @param {string} [about.picked]         The weapon picked or drawn, by name
 * @returns {Promise<Item|null>}
 */
async function weaponFor(makes, { maker, option = null, picked = "" } = {}) {
  const way = weaponWay(makes);
  if ( way === "none" ) return null;
  if ( way === "named" ) return findItem("weapon", makes.weapon);
  if ( (way === "pick") || (way === "draw") ) return picked ? findItem("weapon", picked) : null;
  const order = Object.keys(FEO.ranks);
  const best = Object.values(maker.system.proficiencies ?? {}).reduce((top, proficiency) => ((order.indexOf(proficiency?.rank) > order.indexOf(top)) ? proficiency.rank : top), order[0]);
  for ( const name of rankedNames(option?.weapon ?? "", best) ) {
    const found = await findItem("weapon", name);
    if ( found ) return found;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Hand a creature its weapon, in place of the one it was handed before: equipped, and marked as one it wields
 * whatever its rank and never parts with.
 * @param {Actor} creature
 * @param {Item} source       The weapon to copy
 * @returns {Promise<Item>}
 */
async function handWeapon(creature, source) {
  const old = creature.items.filter((item) => (item.type === "weapon") && alwaysWields(item)).map((item) => item.id);
  if ( old.length ) await creature.deleteEmbeddedDocuments("Item", old);
  const held = creature.items.filter((item) => (item.type === "weapon") && item.system.equipped)
    .map((item) => ({ _id: item.id, "system.equipped": false }));
  if ( held.length ) await creature.updateEmbeddedDocuments("Item", held);
  const [item] = await creature.createEmbeddedDocuments("Item", [weaponData(source)], { [FEO.id]: { creature: true } });
  return item;
}

/* -------------------------------------------- */

/**
 * The data of a weapon a creature is handed.
 * @param {Item} source
 * @returns {object}
 */
function weaponData(source) {
  const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
  delete data._id;
  data.system.equipped = true;
  foundry.utils.setProperty(data, `flags.${FEO.id}.${SUMMONED_FLAG}`, true);
  return data;
}

/* -------------------------------------------- */

/**
 * The data of a class a creature is, as an Item of its own with an id that its unit can point to.
 * @param {Item} cls
 * @returns {object}
 */
function classData(cls) {
  const data = cls.inCompendium ? game.items.fromCompendium(cls, { clearFolder: true }) : cls.toObject();
  data._id = foundry.utils.randomID();
  return data;
}

/* -------------------------------------------- */

/**
 * What a token of a creature is made with, beside where it stands: it looks to the map as its maker's does.
 * @param {TokenDocument} like      Its maker's token
 * @returns {object}
 */
function tokenLike(like) {
  return { disposition: like.disposition, hidden: like.hidden, displayBars: like.displayBars, displayName: like.displayName };
}

/* -------------------------------------------- */

/**
 * A unit as a creature's numbers are read from it.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.bare]    Read the stats on its sheet, without what skills, gear and conditions
 *                                    make of them for a while
 * @returns {import("../rules/creatures.mjs").Original}
 */
function originalOf(actor, { bare = false } = {}) {
  const system = actor.system;
  const stats = bare
    ? Object.fromEntries(Object.entries(actor._source.system.stats).map(([key, stat]) => [key, (stat.base ?? 0) + (stat.boost ?? 0)]))
    : { ...system.statValues };
  return { hp: bare ? actor._source.system.hp.max : system.hp.max, weight: system.wt?.total ?? 0, stats };
}

/* -------------------------------------------- */

/**
 * Make a creature that is a unit of a class, kept from then on: at level 1, with the class's stats, skills and
 * Special Qualities, a rank in the kind of weapon it fights with, and no growth rates until they are assigned.
 * @param {object} makes
 * @param {object} about
 * @param {Actor} about.maker
 * @param {TokenDocument} about.token     Its maker's token
 * @param {Item} about.cls
 * @param {string} about.kind             The kind of weapon it fights with
 * @param {string} about.name
 * @param {object} about.note
 * @returns {Promise<Actor>}
 */
async function makeOfClass(makes, { maker, token, cls, kind, name, note }) {
  const Actor = foundry.documents.Actor.implementation;
  const creature = await Actor.create({
    name,
    type: "unit",
    img: cls.img,
    folder: maker.folder?.id ?? null,
    ownership: ownershipOf((note.control === "maker") ? maker : null),
    system: { army: armyOf(maker, token), player: maker.system.player },
    prototypeToken: { name, actorLink: true, texture: { src: cls.img }, bar1: { attribute: "hp" }, ...tokenLike(token) },
    flags: { [FEO.id]: { [CREATURE_FLAG]: note, [SUMMONER_FLAG]: maker.uuid } }
  });
  const known = await knownSkills();
  const change = planAssignment(creature._source.system, cls, {
    stats: true, weight: true, qualities: true, skills: true, known,
    proficiencies: kind ? { [kind]: FEO.startingRanks.first } : null
  });
  const owned = await embedClass(creature, cls);
  const update = { ...planUpdate(change), "system.classId": owned.id };
  for ( const key of Object.keys(creature._source.system.growths) ) update[`system.growths.${key}`] = 0;
  if ( makes.qualities?.length ) update["system.specialQualities"] = withQualities(update["system.specialQualities"] ?? cls.system.specialQualities, makes.qualities);
  const lasting = lastingOf(makes, note.skill);
  if ( lasting.length ) update["system.timed"] = lasting;
  await creature.update(update);
  await grantSkills(creature, change.skills);
  return creature;
}

/* -------------------------------------------- */

/**
 * Make a creature from numbers: a share of its maker's stats, or what the row of a table says of them.
 * @param {object} makes
 * @param {object} about
 * @param {Actor} about.maker
 * @param {TokenDocument} about.token
 * @param {Item|null} about.cls           The class it is, if its skill names one
 * @param {object|null} about.option      The row picked, for one picked from a table
 * @param {Item|null} about.weapon        The weapon it is handed
 * @param {string} about.name
 * @param {object} about.note
 * @param {string} about.folder
 * @returns {Promise<Actor>}
 */
async function makeOfNumbers(makes, { maker, token, cls, option, weapon, name, note, folder }) {
  const built = creatureStats(makes, originalOf(maker), { option, classBase: cls?.system.base ?? null });
  const img = option?.img || makes.img || cls?.img || weapon?.img || "icons/svg/mystery-man.svg";
  const items = [];
  let classId = "";
  if ( cls ) {
    const data = classData(cls);
    classId = data._id;
    items.push(data);
  }
  if ( weapon ) items.push(weaponData(weapon));
  const proficiencies = {};
  if ( weapon && (weapon.system.category in FEO.proficiencies) ) {
    proficiencies[weapon.system.category] = { rank: (weapon.system.rank in FEO.ranks) ? weapon.system.rank : "E", wexp: 0 };
  }
  const growths = Object.fromEntries(Object.keys({ ...FEO.growths, ...FEO.optionalGrowths, ...FEO.weaponLevelGrowth }).map((key) => [key, 0]));
  const Actor = foundry.documents.Actor.implementation;
  return Actor.create({
    name,
    type: "unit",
    img,
    folder,
    ownership: ownershipOf((note.control === "maker") ? maker : null),
    system: {
      army: armyOf(maker, token),
      player: (note.control === "maker") ? maker.system.player : "",
      level: maker.system.level,
      className: cls ? cls.name : (option?.name ?? makes.name ?? ""),
      classId,
      specialQualities: withQualities(cls?.system.specialQualities ?? "", [...(option?.qualities ?? []), ...(makes.qualities ?? [])]),
      hp: { value: creatureHp(makes, built.hp), max: built.hp },
      stats: Object.fromEntries(Object.entries(built.stats).map(([key, base]) => [key, { base }])),
      wt: { class: cls?.system.wt ?? 0 },
      growths,
      proficiencies,
      timed: lastingOf(makes, note.skill)
    },
    prototypeToken: { name, actorLink: true, texture: { src: img }, bar1: { attribute: "hp" }, ...tokenLike(token) },
    flags: { [FEO.id]: { [CREATURE_FLAG]: note, [SUMMONER_FLAG]: maker.uuid } },
    items
  }, { [FEO.id]: { creature: true, noPick: true } });
}

/* -------------------------------------------- */

/**
 * Make a creature of a unit that fell: a copy of it as it was, on its feet again, with what its skill changes
 * about it. The unit that fell is left as it lies.
 * @param {object} makes
 * @param {object} about
 * @param {Actor} about.maker
 * @param {TokenDocument} about.token
 * @param {Actor} about.slain
 * @param {TokenDocument} about.slainToken
 * @param {Item|null} about.cls
 * @param {Item|null} about.weapon
 * @param {object} about.note
 * @param {string} about.folder
 * @returns {Promise<Actor>}
 */
async function makeOfSlain(makes, { maker, token, slain, slainToken, cls, weapon, note, folder }) {
  const data = slain.toObject();
  const name = slainToken.name || slain.name;
  delete data._id;
  const system = data.system;
  const img = slainToken.texture?.src || data.img;

  // Its stats on its sheet, shared out where its skill says so, with the MOV, CON and LoS of the class it now is
  const changed = !!cls || (makes.share !== undefined) || (makes.stats !== undefined);
  let hpMax = system.hp.max;
  if ( changed ) {
    const built = creatureStats(makes, originalOf(slain, { bare: true }), { classBase: cls?.system.base ?? null });
    hpMax = built.hp;
    for ( const [key, base] of Object.entries(built.stats) ) system.stats[key] = { ...(system.stats[key] ?? {}), base, boost: 0 };
  }
  system.hp = { ...system.hp, max: hpMax, value: creatureHp(makes, hpMax) };

  // What it carried and knew: all of it, or none of it
  let items = data.items ?? [];
  if ( makes.skills === false ) items = items.filter((item) => item.type !== "skill");
  if ( makes.pack === false ) items = items.filter((item) => !["weapon", "gear"].includes(item.type));
  if ( cls ) {
    items = items.filter((item) => item.type !== "class");
    const made = classData(cls);
    items.push(made);
    system.classId = made._id;
    system.className = cls.name;
    system.wt = { ...(system.wt ?? {}), class: cls.system.wt ?? 0 };
  }
  if ( weapon ) {
    for ( const item of items ) if ( (item.type === "weapon") && item.system ) item.system.equipped = false;
    items.push(weaponData(weapon));
    if ( weapon.system.category in FEO.proficiencies ) {
      system.proficiencies ??= {};
      const had = system.proficiencies[weapon.system.category]?.rank;
      const order = Object.keys(FEO.ranks);
      const rank = (weapon.system.rank in FEO.ranks) ? weapon.system.rank : "E";
      if ( order.indexOf(had) < order.indexOf(rank) ) system.proficiencies[weapon.system.category] = { rank, wexp: 0 };
    }
  }

  // It is on its feet, on its maker's side, and nothing of the fight it fell in clings to it
  Object.assign(system, {
    army: armyOf(maker, token),
    player: (note.control === "maker") ? maker.system.player : "",
    specialQualities: withQualities(cls ? cls.system.specialQualities : system.specialQualities, makes.qualities ?? []),
    wounds: 0, injuries: 0,
    defeat: { state: "", turns: 0, paused: false },
    waiting: false, break: false, capturing: false,
    captive: { uuid: "", name: "", held: false, turns: 0 },
    captured: { by: "", name: "", hp: 0, held: false },
    rescuing: { uuid: "", token: "", name: "", light: false, over: false },
    rescued: { by: "", token: "", name: "" },
    exp: 0,
    timed: lastingOf(makes, note.skill)
  });
  if ( system.stagger ) system.stagger = { ...system.stagger, turns: 0 };
  if ( makes.pack === false ) system.gold = 0;
  const Actor = foundry.documents.Actor.implementation;
  return Actor.create({
    ...data,
    name,
    img: data.img,
    folder,
    ownership: ownershipOf((note.control === "maker") ? maker : null),
    system,
    items,
    effects: [],
    prototypeToken: {
      ...(data.prototypeToken ?? {}), name, actorLink: true, texture: { ...(slainToken.toObject().texture ?? {}), src: img },
      width: slainToken.width, height: slainToken.height, bar1: { attribute: "hp" }, ...tokenLike(token)
    },
    flags: { ...(data.flags ?? {}), [FEO.id]: { [CREATURE_FLAG]: note, [SUMMONER_FLAG]: maker.uuid } }
  }, { [FEO.id]: { creature: true, noPick: true } });
}

/* -------------------------------------------- */

/**
 * Put a creature's token on a tile, and into the battle that is being fought there.
 * @param {Scene} scene
 * @param {object} data       The token, as it is made
 * @returns {Promise<TokenDocument|null>}
 */
async function placeToken(scene, data) {
  const [made] = await scene.createEmbeddedDocuments("Token", [data], { [FEO.id]: { appears: true } });
  if ( !made ) return null;
  const combat = game.combats.find((other) => other.started && phaseOf(other) && (!other.scene || (other.scene === scene)));
  if ( combat && !combat.combatants.some((combatant) => combatant.tokenId === made.id) ) {
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: made.id, sceneId: scene.id, actorId: made.actorId, hidden: made.hidden }]);
  }
  return made;
}

/* -------------------------------------------- */

/**
 * The token of a creature that has an Actor of its own, on a tile.
 * @param {Actor} creature
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile
 * @param {TokenDocument} like      Its maker's token
 * @returns {Promise<TokenDocument|null>}
 */
async function standOn(creature, scene, tile, like) {
  const left = scene.tokens.filter((other) => other.actorId === creature.id).map((other) => other.id);
  if ( left.length ) await scene.deleteEmbeddedDocuments("Token", left);
  const { x, y } = scene.grid.getTopLeftPoint({ i: tile.i, j: tile.j });
  const placed = await creature.getTokenDocument({ x, y, actorLink: true, ...tokenLike(like) });
  return placeToken(scene, placed.toObject());
}

/* -------------------------------------------- */

/**
 * Bring a creature onto the map: make it if it is not one that returns, hand it its weapon, put its token on
 * its tile and into the battle fought there. Runs for a Game Master, and checks everything it is asked for
 * against the rules once more.
 * @param {object} request
 * @param {string} request.maker          The UUID of the unit whose skill makes it
 * @param {string} request.scene          The id of the scene
 * @param {string} request.token          The id of that unit's token there
 * @param {string} request.item           The id of the skill
 * @param {{i: number, j: number}} [request.tile]     The tile picked, for a skill used on one
 * @param {string} [request.slain]        The id of the token of the unit that fell, for one raised from it
 * @param {object} [request.picks]        What was picked: `option`, `weapon`, `count`, `units`
 * @param {string} [request.weapon]       The weapon drawn, for one that draws it
 * @returns {Promise<{ok: boolean, reason?: string, data?: object, made?: {name: string, level: number,
 *   weapon: string, token: string}[], kept?: string, behind?: number}>}
 */
export async function placeCreature(request = {}) {
  const fail = (reason, data = {}) => ({ ok: false, reason, data });
  if ( !game.user.isGM ) return fail("failed");
  const maker = (typeof request.maker === "string") ? await foundry.utils.fromUuid(request.maker) : null;
  const scene = game.scenes.get(request.scene);
  const token = scene?.tokens.get(request.token);
  if ( (maker?.documentName !== "Actor") || (maker.type !== "unit") || !token || (token.actor !== maker) || !scene.grid?.isSquare ) return fail("failed");
  const item = maker.items.get(request.item);
  if ( (item?.type !== "skill") || !item.system.equipped ) return fail("failed");
  const raising = typeof request.slain === "string";
  const act = raising ? null : actOf(item.system);
  const makes = raising ? raiseOf(item) : actMakes(act);
  if ( !makes ) return fail("failed");
  if ( item.system.usage?.kind && !canUse(item.system.usage, item.system.state).ok ) return fail("failed");
  const picks = (request.picks && (typeof request.picks === "object")) ? request.picks : {};
  const origin = tokenTile(token);

  // How many, and where
  let spots = [];
  let slainToken = null;
  if ( raising ) {
    slainToken = scene.tokens.get(request.slain);
    const slain = slainToken?.actor;
    if ( (slain?.type !== "unit") || !raisable({ hp: slain.system.hp.value, state: slain.system.defeat?.state ?? "" }) ) return fail("failed");
    if ( relationOf(armyOf(maker, token), armyOf(slain, slainToken)) !== "enemy" ) return fail("failed");
    if ( creaturesOn(scene).some((entry) => entry.note.from === slainToken.id) ) return fail("failed");
    const state = standingWith(token, makes);
    if ( state.room < 1 ) return fail((state.limit === 1) ? "limitOne" : "limit", { limit: state.limit });
    const fell = tokenTile(slainToken);
    if ( !fell ) return fail("failed");

    // On the tile it fell on; or where a unit stands there by now, on the free tile nearest to it
    const around = [];
    for ( let di = -2; di <= 2; di++ ) for ( let dj = -2; dj <= 2; dj++ ) around.push({ i: fell.i + di, j: fell.j + dj });
    const free = freeAmong(scene, around).sort((a, b) => tilesApart(a, fell) - tilesApart(b, fell));
    if ( !free.length ) return fail("noRoom");
    spots = [free[0]];
  }
  else {
    // The first stands on the tile picked, within the reach of the skill; the others on free tiles around it
    const free = tilesFor(token, act);
    const pool = tilesFor(token, act, { beyond: SPREAD });
    const state = standingWith(token, makes, pool);
    if ( state.room < 1 ) return fail((state.limit === 1) ? "limitOne" : "limit", { limit: state.limit });
    if ( state.count < 1 ) return fail(free.length ? "cost" : "noRoom", { hp: makes.costs?.hp ?? 0 });
    if ( !free.some((tile) => (tile.i === request.tile?.i) && (tile.j === request.tile?.j)) ) return fail("noRoom");
    let wanted = 1;
    if ( makes.body === "prepared" ) wanted = (picks.units ?? []).reduce((sum, entry) => sum + (Math.max(Math.trunc(Number(entry?.count)) || 0, 0)), 0);
    else if ( (makes.many ?? 1) > 1 ) wanted = Math.max(Math.trunc(Number(picks.count)) || 1, 1);
    if ( (wanted < 1) || (wanted > state.count) ) return fail("failed");
    spots = spotsFor(request.tile, wanted, pool, origin);
    if ( spots.length < wanted ) return fail("noRoom");
  }

  // Units the Game Master prepared appear as tokens of their own Actors, with what they gain written on the
  // token alone
  const made = [];
  const note = (more = {}) => creatureNote(makes, { maker: maker.uuid, skill: item.name, scene: scene.id, ...more });
  if ( makes.body === "prepared" ) {
    const list = [];
    for ( const entry of picks.units ?? [] ) {
      const unit = (typeof entry?.uuid === "string") ? await foundry.utils.fromUuid(entry.uuid) : null;
      if ( (unit?.documentName !== "Actor") || (unit.type !== "unit") || unit.hasPlayerOwner || unit.inCompendium ) return fail("failed");
      for ( let n = 0; n < entry.count; n++ ) list.push(unit);
    }
    for ( const [index, unit] of list.entries() ) {
      const tile = spots[index];
      const { x, y } = scene.grid.getTopLeftPoint({ i: tile.i, j: tile.j });
      const placed = (await unit.getTokenDocument({ x, y, actorLink: false, disposition: token.disposition, hidden: token.hidden })).toObject();
      placed.actorLink = false;
      const system = {};
      const qualities = withQualities(unit.system.specialQualities, makes.qualities ?? []);
      if ( qualities !== unit.system.specialQualities ) system.specialQualities = qualities;
      if ( maker.system.army ) system.army = maker.system.army;
      placed.delta = foundry.utils.mergeObject(placed.delta ?? {}, {
        ...(Object.keys(system).length ? { system } : {}),
        flags: { [FEO.id]: { [CREATURE_FLAG]: note({ own: false }), [SUMMONER_FLAG]: maker.uuid } }
      });
      const stood = await placeToken(scene, placed);
      if ( stood ) made.push({ name: stood.name || unit.name, level: unit.system.level, weapon: "", token: stood.id });
    }
    return made.length ? { ok: true, made } : fail("failed");
  }

  // The class it is, where its skill names one, and the weapon it is handed
  const cls = makes.class ? await findItem("class", makes.class) : null;
  if ( makes.class && !cls ) return fail("noClass", { class: makes.class });
  const option = (makes.body === "table") ? ((makes.options ?? []).find((entry) => entry.name === picks.option) ?? null) : null;
  if ( (makes.body === "table") && !option ) return fail("failed");
  const way = weaponWay(makes);
  let picked = "";
  if ( way === "pick" ) {
    if ( !makes.weapon.pick.includes(picks.weapon) ) return fail("failed");
    picked = picks.weapon;
  }

  // One that is kept returns, or is made the first time; its weapon is one its level can draw
  let behind = 0;
  if ( makes.keeps ) {
    const state = standingWith(token, makes);
    let creature = state.returning;
    const kind = creature ? (creatureOf(creature)?.option || picks.weapon) : picks.weapon;
    if ( way === "draw" ) {
      if ( !makes.weapon.pick.includes(kind) || !weaponPool(creature?.system.level ?? 1, kind).includes(request.weapon) ) return fail("noWeapon");
      picked = request.weapon;
    }
    const weapon = await weaponFor(makes, { maker, picked });
    if ( (way !== "none") && !weapon ) return fail("noWeapon");
    if ( !creature ) {
      const count = keptBy(maker, makes.kind).length;
      const base = game.i18n.format("FEO.Creature.name", { name: maker.name, what: makes.name ?? cls.name });
      creature = await makeOfClass(makes, {
        maker, token, cls, kind: (way === "draw") ? kind : "", name: count ? `${base} ${count + 1}` : base, note: note({ option: kind ?? "" })
      });
    }

    // One that was summoned before creatures carried a note is given one now: its growth rates are its own
    // to assign where it has none yet
    if ( !creature.getFlag(FEO.id, CREATURE_FLAG) ) {
      const fresh = note({ option: kind ?? "" });
      if ( fresh.growth && Object.values(creature._source.system.growths).some((value) => value > 0) ) fresh.growth.due = false;
      await creature.setFlag(FEO.id, CREATURE_FLAG, fresh);
    }

    // It appears whole: on its feet, at full HP, with the level ups it is behind its maker waiting
    behind = (makes.level === "maker") ? levelsBehind(maker.system.level, creature.system.level) : 0;
    await creature.update({
      "system.wounds": 0, "system.injuries": 0,
      "system.defeat": { state: "", turns: 0, paused: false },
      "system.hp.value": creature._source.system.hp.max,
      ...(makes.level === "maker" ? { "system.exp": catchUpExp(maker.system.level, creature.system.level) } : {}),
      "system.waiting": false, "system.break": false
    });
    await syncStatus(creature);
    const held = weapon ? await handWeapon(creature, weapon) : null;
    await giveGains(creature);
    await giveSkills(maker, creature);
    const stood = await standOn(creature, scene, spots[0], token);
    if ( !stood ) return fail("failed");
    return { ok: true, made: [{ name: creature.name, level: creature.system.level, weapon: held?.name ?? "", token: stood.id }], kept: creature.uuid, behind };
  }

  // Anything else is a unit of its own for as long as it lasts
  const folder = (await creatureFolder()).id;
  for ( const tile of spots ) {
    let creature = null;
    let handed = null;
    if ( raising ) {
      handed = await weaponFor(makes, { maker });
      if ( (way !== "none") && !handed ) return fail("noWeapon");
      creature = await makeOfSlain(makes, {
        maker, token, slain: slainToken.actor, slainToken, cls, weapon: handed, folder, note: { ...note(), from: slainToken.id }
      });
    }
    else {
      handed = await weaponFor(makes, { maker, option, picked });
      if ( (way !== "none") && !handed ) return fail("noWeapon");
      const what = option?.name ?? makes.name ?? cls?.name ?? makes.kind;
      creature = await makeOfNumbers(makes, {
        maker, token, cls, option, weapon: handed, folder, note: note({ option: option?.name ?? picked }),
        name: game.i18n.format("FEO.Creature.name", { name: token.name || maker.name, what })
      });
    }
    const stood = creature ? await standOn(creature, scene, tile, token) : null;
    if ( !stood ) {
      if ( creature ) await creature.delete();
      return made.length ? { ok: true, made } : fail("failed");
    }
    made.push({ name: creature.name, level: creature.system.level, weapon: handed?.name ?? "", token: stood.id });
  }
  return { ok: true, made };
}

/* -------------------------------------------- */
/*  Keeping in Step                             */
/* -------------------------------------------- */

/**
 * Give a creature that is kept the skills its maker's other skills say it has, where they are picked.
 * @param {Actor} maker
 * @param {Actor} creature
 * @returns {Promise<void>}
 */
async function giveSkills(maker, creature) {
  const kind = creatureOf(creature)?.kind;
  if ( !kind ) return;
  const wanted = creatureExtras(equipped(maker), kind, maker.system.level).skills.filter((entry) => entry.picked);
  if ( !wanted.length ) return;
  if ( !creature.isOwner ) return;
  await grantSkills(creature, wanted.map((entry) => ({ name: entry.picked, kind: entry.sort })));
}

/* -------------------------------------------- */

/**
 * The skills of a unit that give its creatures a skill which is yet to be picked.
 * @param {Actor} maker
 * @param {string|null} [kind]      Only those for creatures of this kind
 * @returns {{item: Item, sort: string, kind: string}[]}
 */
function skillsDue(maker, kind = null) {
  const due = [];
  for ( const item of maker?.items ?? [] ) {
    if ( (item.type !== "skill") || !item.system.equipped || String(item.system.choice ?? "").trim() ) continue;
    for ( const effect of item.system.effects ?? [] ) {
      const part = effect?.creatures;
      if ( part?.skill && (!kind || (fold(part.kind) === fold(kind))) ) due.push({ item, sort: part.skill, kind: part.kind });
    }
  }
  return due;
}

/* -------------------------------------------- */

/**
 * Have the skill a unit's creatures are given picked: the Compendium opens at the skills of that sort, and the
 * one that is taken is kept as the choice of the skill that gives it. Every creature of that kind the unit
 * keeps is given it at once.
 * @param {Actor} maker
 * @param {Item} item         The skill that gives its creatures a skill
 * @param {string} sort       The kind of skill that is picked
 * @param {string} kind       The kind of creature it is for
 * @returns {Promise<void>}
 */
export async function askCreatureSkill(maker, item, sort, kind) {
  if ( !maker?.isOwner || !item ) return;
  const { default: Compendium } = await import("../apps/compendium.mjs");
  const i18n = game.i18n;
  let taken = "";
  await Compendium.open({
    view: "skills",
    kind: sort,
    chooser: {
      takes: "skill",
      actor: maker.uuid,
      describe: (entry) => {
        if ( taken ) return { can: false, chosen: entry?.name === taken, text: i18n.format("FEO.Creature.skill.taken", { skill: taken, from: item.name }) };
        if ( entry?.kind !== sort ) return { can: false, barred: true, text: i18n.format("FEO.Creature.skill.other", { from: item.name, sort: i18n.localize(FEO.skillKinds[sort] ?? sort) }) };
        return { can: true, text: i18n.format("FEO.Creature.skill.ask", { name: maker.name, from: item.name }), label: i18n.localize("FEO.Creature.skill.confirm") };
      },
      choose: async (entry) => {
        if ( !entry?.name || (entry.kind !== sort) ) return;
        await item.update({ "system.choice": entry.name });
        taken = entry.name;
        for ( const creature of keptBy(maker, kind) ) await giveSkills(maker, creature);
      },
      banner: () => ({ text: i18n.format("FEO.Creature.skill.banner", { name: maker.name, from: item.name }), tags: [], note: i18n.localize("FEO.Creature.skill.note") })
    }
  });
}

/* -------------------------------------------- */

/**
 * Have the growth rates of a creature assigned, by whoever acts for it: so many points, none where none may
 * go. Until they are, it has none.
 * @param {Actor} creature
 * @returns {Promise<boolean>}    Whether they were assigned
 */
export async function assignGrowth(creature) {
  const note = creatureOf(creature);
  const rule = note?.growth;
  if ( !rule?.due || !creature.isOwner ) return false;
  const i18n = game.i18n;
  const keys = Object.keys(FEO.growths);
  const step = FEO.creatures.growthStep;
  const rows = keys.map((key) => ({
    key, label: i18n.localize(FEO.growths[key]), barred: (rule.barred ?? []).includes(key), value: creature._source.system.growths[key] ?? 0
  }));
  const content = document.createElement("div");
  const html = await foundry.applications.handlebars.renderTemplate(GROWTH_TEMPLATE, {
    rows, step, points: rule.points, name: creature.name,
    barred: (rule.barred ?? []).map((key) => i18n.localize(FEO.growths[key])).join(", ")
  });
  content.innerHTML = `<div class="feo-class-dialog feo-creature-growth">${html}</div>`;
  const read = (form) => {
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    return Object.fromEntries(keys.map((key) => [key, Math.trunc(Number(data[`growth.${key}`] ?? data.growth?.[key])) || 0]));
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n.format("FEO.Creature.growth.title", { name: creature.name }) },
    position: { width: 380 },
    content,
    buttons: [
      { action: "assign", label: "FEO.Creature.growth.confirm", icon: "fa-solid fa-check", default: true, callback: (event, button) => read(button.form) },
      { action: "later", label: "FEO.Creature.growth.later" }
    ],
    rejectClose: false,
    render: (event, app) => {
      const root = app.element.querySelector(".feo-creature-growth");
      const confirm = app.element.querySelector('button[data-action="assign"]');
      const tally = root?.querySelector("[data-tally]");
      const refresh = () => {
        const check = checkGrowth(read(app.element.querySelector("form")), rule);
        if ( tally ) {
          tally.textContent = i18n.format("FEO.Creature.growth.left", { left: check.left, points: rule.points });
          tally.classList.toggle("bad", check.left < 0);
        }
        if ( confirm ) confirm.disabled = !check.valid;
      };
      root?.addEventListener("input", refresh);
      refresh();
    }
  });
  if ( !answer || (typeof answer !== "object") || !checkGrowth(answer, rule).valid ) return false;
  const update = { [`flags.${FEO.id}.${CREATURE_FLAG}.growth.due`]: false };
  for ( const key of keys ) update[`system.growths.${key}`] = answer[key];
  await creature.update(update);
  return true;
}

/* -------------------------------------------- */

/**
 * What is still to be settled for a creature that is kept, once it stands: its growth rates, and the skill
 * another skill of its maker gives it.
 * @param {Actor} maker
 * @param {string} uuid       The creature
 * @returns {Promise<void>}
 */
async function settleKept(maker, uuid) {
  const creature = await foundry.utils.fromUuid(uuid);
  if ( !creature ) return;
  const note = creatureOf(creature);
  if ( note?.growth?.due ) await assignGrowth(creature);
  const [due] = skillsDue(maker, note?.kind);
  if ( due ) await askCreatureSkill(maker, due.item, due.sort, due.kind);
}

/* -------------------------------------------- */

/**
 * A creature that has reached the level at which it gains stats gains them, once.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it gained any
 */
async function giveGains(actor) {
  const note = actor?.getFlag?.(FEO.id, CREATURE_FLAG);
  const gains = gainsDue(note?.gains ?? null, actor.system.level);
  if ( !gains ) return false;
  const update = { [`flags.${FEO.id}.${CREATURE_FLAG}.gains.given`]: true };
  for ( const [key, amount] of Object.entries(gains) ) {
    if ( key === "hp" ) update["system.hp.max"] = actor._source.system.hp.max + amount;
    else update[`system.stats.${key}.base`] = (actor._source.system.stats[key]?.base ?? 0) + amount;
  }
  await actor.update(update);
  pop(actor, Object.entries(gains).map(([key, amount]) => ({ text: `${amount > 0 ? "+" : ""}${amount} ${game.i18n.localize(FEO.stats[key]?.abbr ?? key)}`, tone: "skill" })));
  return true;
}

/* -------------------------------------------- */

/**
 * A unit has gained a level. Each creature it keeps that follows its level has one more level up waiting; and
 * a creature that has reached the level at which it gains stats gains them. Runs once, for the designated Game
 * Master.
 * @param {Actor} actor
 * @param {object} changed
 * @returns {Promise<void>}
 */
async function followLevel(actor, changed) {
  if ( !game.user.isActiveGM || (actor?.type !== "unit") ) return;
  if ( !foundry.utils.hasProperty(changed, "system.level") ) return;
  for ( const kept of game.actors.filter((other) => (other.type === "unit") && (creatureOf(other)?.maker === actor.uuid) && (creatureOf(other)?.level === "maker")) ) {
    const exp = catchUpExp(actor.system.level, kept.system.level);
    if ( exp !== kept.system.exp ) await kept.update({ "system.exp": exp });
  }
  await giveGains(actor);
}

/* -------------------------------------------- */
/*  Who Acts for It                             */
/* -------------------------------------------- */

/**
 * The unit that acts for a creature in place of whoever does, for as long as a change on it says so.
 * @param {Actor} actor
 * @returns {Actor|null}
 */
export function possessorOf(actor) {
  const change = (actor?.system?.timed ?? []).find((entry) => entry.by && (entry.effects ?? []).some((effect) => (effect?.rules ?? []).includes(POSSESSED)));
  if ( !change ) return null;
  try {
    const found = foundry.utils.fromUuidSync(change.by);
    return (found?.documentName === "Actor") ? found : null;
  } catch(err) {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Bring who may act for a creature in step with what is noted on it: the owners of its maker, the Game Master
 * alone, or for as long as a unit has taken it over, the owners of that unit. Runs for the designated Game
 * Master, for a creature that is a unit of its own.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether anything changed
 */
export async function syncControl(actor) {
  if ( !game.user.isActiveGM || (actor?.type !== "unit") || actor.isToken || actor.inCompendium ) return false;
  const note = creatureOf(actor);
  if ( !note?.own || !actor.getFlag(FEO.id, CREATURE_FLAG) ) return false;
  const source = possessorOf(actor) ?? ((note.control === "maker") ? makerOf(actor) : null);
  if ( !source && (note.control === "maker") ) return false;
  const wanted = ownershipOf(source);
  if ( foundry.utils.objectsEqual(actor.ownership, wanted) ) return false;
  await actor.update({ ownership: wanted }, { diff: false, recursive: false });
  return true;
}

/* -------------------------------------------- */
/*  Going                                       */
/* -------------------------------------------- */

/** The folder is taken away by one at a time, so that two who find it empty do not both delete it. */
let tidying = Promise.resolve();

/**
 * Take away the folder creatures are kept in once none is left in it.
 * @returns {Promise<void>}
 */
function tidyFolder() {
  tidying = tidying.then(async () => {
    const folder = game.folders.find((entry) => (entry.type === "Actor") && entry.getFlag(FEO.id, FOLDER_FLAG));
    if ( folder && game.folders.has(folder.id) && !folder.contents.length && !folder.children?.length ) await folder.delete();
  }).catch((err) => console.error(err));
  return tidying;
}

/* -------------------------------------------- */

/**
 * Does a creature that is a unit of its own still have a token anywhere?
 * @param {Actor} actor
 * @param {TokenDocument|null} [but]      A token that is going
 * @returns {boolean}
 */
function hasToken(actor, but = null) {
  return game.scenes.some((scene) => scene.tokens.some((token) => (token.actorId === actor.id) && token.actorLink && (token !== but)));
}

/* -------------------------------------------- */

/**
 * A battle is over: the creatures that were made for it leave its map. One that is a unit of its own goes
 * with its token, unless its skill keeps it; one that stays is left where it stands. A creature that fights in
 * another battle that is still running is left alone. Runs once, for the designated Game Master.
 * @param {Combat} combat           The encounter that was deleted
 * @returns {Promise<number>}       How many creatures left
 */
export async function clearCreatures(combat) {
  if ( !game.user.isActiveGM ) return 0;
  const scenes = new Set([combat?.scene, ...Array.from(combat?.combatants ?? []).map((combatant) => game.scenes.get(combatant.sceneId))].filter(Boolean));
  const running = Array.from(game.combats ?? []).filter((other) => (other !== combat) && other.started);
  let gone = 0;
  for ( const scene of scenes ) {
    const tokens = [];
    const actors = new Set();
    for ( const { token, actor, note } of creaturesOn(scene) ) {
      if ( running.some((other) => other.combatants.some((combatant) => combatant.tokenId === token.id)) ) continue;
      const ends = creatureEnds(note, "battle");
      if ( ends.token ) tokens.push(token.id);
      if ( ends.actor && !actor.isToken ) actors.add(actor);
    }
    try {
      if ( tokens.length ) await scene.deleteEmbeddedDocuments("Token", tokens, { [FEO.id]: { cleared: true } });
      gone += tokens.length;
      for ( const actor of actors ) if ( game.actors.has(actor.id) && !hasToken(actor) ) await actor.delete();
    } catch(err) {
      console.error(err);
    }
  }
  await sweepCreatures();
  return gone;
}

/* -------------------------------------------- */

/**
 * Delete the creatures that are units of their own and have no token left anywhere, unless their skill keeps
 * them, and the folder they were kept in once it is empty. Runs for the designated Game Master.
 * @returns {Promise<number>}       How many were deleted
 */
export async function sweepCreatures() {
  if ( !game.user.isActiveGM ) return 0;
  let gone = 0;
  for ( const actor of Array.from(game.actors) ) {
    const note = (actor.type === "unit") ? actor.getFlag(FEO.id, CREATURE_FLAG) : null;
    if ( !note?.kind || !creatureEnds(note, "sweep").actor || hasToken(actor) ) continue;
    try {
      if ( !game.actors.has(actor.id) ) continue;
      await actor.delete();
      gone += 1;
    } catch(err) {
      console.error(err);
    }
  }
  await tidyFolder();
  return gone;
}

/* -------------------------------------------- */
/*  Showing                                     */
/* -------------------------------------------- */

/**
 * A creature appears: a short flash on its tile, out of which its token fades in. Runs on every client for a
 * token it has in view; nothing is saved.
 * @param {TokenDocument} document
 */
function showArrival(document) {
  try {
    if ( !canvas?.ready || (document.parent !== canvas.scene) || !FEO.creatures.flash ) return;
    const placed = document.object;
    if ( !placed || placed.destroyed ) return;
    const { x, y } = placed.center;
    const size = Math.max(placed.w, placed.h);
    const flash = new PIXI.Graphics();
    flash.beginFill(0xffffff, 0.9).drawCircle(0, 0, size * 0.5).endFill();
    flash.lineStyle(Math.max(size * 0.06, 2), 0xb8a4ff, 1).drawCircle(0, 0, size * 0.62);
    flash.position.set(x, y);
    flash.scale.set(0.2);
    flash.alpha = 1;
    (canvas.interface ?? canvas.tokens).addChild(flash);
    const mesh = placed.mesh ?? null;
    if ( mesh ) mesh.alpha = 0;
    const animate = foundry.canvas.animation.CanvasAnimation.animate.bind(foundry.canvas.animation.CanvasAnimation);
    animate([
      { parent: flash.scale, attribute: "x", to: 1.5 },
      { parent: flash.scale, attribute: "y", to: 1.5 },
      { parent: flash, attribute: "alpha", to: 0 },
      ...(mesh ? [{ parent: mesh, attribute: "alpha", to: 1 }] : [])
    ], { name: `${placed.objectId}.appear`, duration: FEO.creatures.flash }).catch(() => {}).finally(() => {
      flash.parent?.removeChild(flash);
      flash.destroy();
      if ( !placed.destroyed ) placed.renderFlags.set({ refreshState: true, refreshMesh: true });
    });
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what creatures listen for. Called once, when the system starts.
 */
export function registerHooks() {
  // A unit that levels up has its creatures follow; a creature a unit has taken over, or let go of, changes hands
  Hooks.on("updateActor", (actor, changed) => {
    followLevel(actor, changed).catch((err) => console.error(err));
    if ( foundry.utils.hasProperty(changed, "system.timed") ) syncControl(actor).catch((err) => console.error(err));
  });

  // A creature appears with a flash
  Hooks.on("createToken", (document, options) => {
    if ( !options?.[FEO.id]?.appears ) return;
    setTimeout(() => showArrival(document), 60);
  });

  // A creature whose token is taken off the map goes with it, where it is a unit of its own that is not kept
  Hooks.on("deleteToken", (document, options) => {
    // Those that leave as a battle ends are seen to together (see `clearCreatures`)
    if ( !game.user.isActiveGM || !document.actorLink || options?.[FEO.id]?.cleared ) return;
    const actor = game.actors.get(document.actorId);
    const note = actor?.getFlag(FEO.id, CREATURE_FLAG);
    if ( !note?.kind || !creatureEnds(note, "token").actor || hasToken(actor, document) ) return;
    Promise.resolve().then(async () => {
      if ( game.actors.has(actor.id) ) await actor.delete();
      await tidyFolder();
    }).catch((err) => console.error(err));
  });

  // Nothing is taken out of the pack of a creature whose pack is locked, and nothing put into it, by a player;
  // and a weapon a creature was handed is copied nowhere else
  Hooks.on("preCreateItem", (item, data, options, userId) => {
    if ( options?.[FEO.id]?.creature || !["weapon", "gear"].includes(item.type) ) return true;
    const parent = item.parent;
    const actor = parent?.documentName === "ActorDelta" ? parent.syntheticActor : parent;
    if ( actor?.documentName !== "Actor" ) return true;
    const copied = !!item.flags?.[FEO.id]?.[SUMMONED_FLAG];
    const user = game.users.get(userId);
    if ( !copied && !(isLocked(actor) && !user?.isGM) ) return true;
    if ( userId === game.user.id ) ui.notifications.warn(game.i18n.format(copied ? "FEO.Creature.bound" : "FEO.Creature.locked", { item: item.name, name: actor.name }));
    return false;
  });
  Hooks.on("preDeleteItem", (item, options, userId) => {
    if ( options?.[FEO.id]?.creature || !["weapon", "gear"].includes(item.type) ) return true;
    const parent = item.parent;
    const actor = parent?.documentName === "ActorDelta" ? parent.syntheticActor : parent;
    const user = game.users.get(userId);
    if ( (actor?.documentName !== "Actor") || user?.isGM || !isLocked(actor) ) return true;
    if ( userId === game.user.id ) ui.notifications.warn(game.i18n.format("FEO.Creature.locked", { item: item.name, name: actor.name }));
    return false;
  });

  // A skill that gives its unit's creatures a skill has it picked as it is learnt
  Hooks.on("createItem", (item, options, userId) => {
    if ( (userId !== game.user.id) || (item.type !== "skill") || options?.[FEO.id]?.noPick ) return;
    const actor = item.parent;
    if ( (actor?.documentName !== "Actor") || (actor.type !== "unit") || (actor.system?.creation?.status === "draft") ) return;
    const part = (item.system.effects ?? []).map((effect) => effect?.creatures).find((entry) => entry?.skill);
    if ( !part || String(item.system.choice ?? "").trim() ) return;
    askCreatureSkill(actor, item, part.skill, part.kind).catch((err) => console.error(err));
  });

  // What was left behind by a battle that ended while nobody was looking is cleared away
  Hooks.once("ready", () => {
    sweepCreatures().catch((err) => console.error(err));
  });
}

/**
 * What a skill does to the units around: a share of a hit for the enemies next to its target, a condition that
 * spreads, HP for the allies nearby, a push, a further attack on a unit behind or beside the target. Pure
 * functions of plain data, so that they can be tested outside of Foundry; nothing in this module knows of
 * Foundry, and what reads a number from a unit is handed in.
 *
 * A skill says so with a `spread` part on an effect that has a moment, of a fight or of a turn:
 *
 *   { proc: { on: "hit", sure: true }, damaged: true,
 *     spread: { who: "enemy", around: "foe", within: 1, targets: 1, pick: "random", damage: { of: "dealt", div: 3 } } }
 *
 * Who is reached:
 *
 *   who: "enemy"            // enemies of its unit (so it is unless given), or its "ally"s
 *   around: "foe"           // around the unit it fights (the target of the fight, of the condition, or the unit
 *                           // it defeated); "self" around its own unit; "both" around either
 *   within: 2, from: 2      // at most so many spaces away, and at least so many; anywhere on the map when
 *                           // `within` is left out
 *   line: { reach: 3 }      // in place of `around`: in a straight line behind the unit it fights, as its own
 *                           // unit sees it, for so many spaces; `reach: "weapon"` for as far as the weapon in
 *                           // hand reaches at the most
 *   apart: true             // not next to its own unit
 *   quality, class          // as in a `near` condition (see `positions.mjs`)
 *   foe: true               // the unit it fights is caught as well, where it stands that near
 *   targets: 1              // no more than so many of them, picked as `pick` says: the "nearest" (so it is
 *                           // unless given), a "random" one, the one that has lost the most HP ("hurt"), or
 *                           // those its owner picks on the map ("choose": the nearest where nobody does)
 *
 * A unit that has left the fight is never reached, and neither is an enemy that cannot be targeted (see
 * `reachable` in `positions.mjs`).
 *
 * What each unit caught gets:
 *
 *   damage: 5                                  // damage, as a skill deals it: whatever the unit's defence
 *   damage: { of: "mag", div: 2 }              // read from the skill's unit
 *   damage: { of: "dealt", div: 3 }            // from the damage of the hit, or of the condition's fight
 *   damage: { of: "hpMax", div: 5, theirs: true }      // `theirs`: read from the unit caught
 *   resist: "res"                              // less that stat of the unit caught
 *   element: "fire"                            // the element the damage is of
 *   nonlethal: true                            // it leaves the unit 1 HP at the least
 *   heal: 7                                    // HP restored, read as damage is
 *   inflicts: ["burn", { id: "berserk", turns: 1 }]    // conditions
 *   passes: { percent: 50, min: 1 }            // at `on: "inflict"`: the condition that was inflicted, for that
 *                                              // share of its turns, rounded down, and no fewer than `min`.
 *                                              // What is passed on sets off nothing further
 *   grant: { effects: [...], ends: "turnEnd" } // a change that lasts (see `timed.mjs`)
 *   push: { spaces: 1, blocked: 5 }            // pushed straight away from the skill's unit; one that cannot
 *                                              // be moved a space takes that damage instead
 *   attack: { hit: -20, damage: 50, falls: { hit: -10, damage: 50 }, free: true }
 *                                              // an attack of its unit on each, one after the other, with the
 *                                              // weapon in hand: that much Hit, that share of its damage, and for
 *                                              // each one after the first so much less Hit and that share of the
 *                                              // one before. `free`: it costs the weapon no use. The unit
 *                                              // attacked makes no counter-attack
 *
 * The damage is the skill's: a unit it brings down is defeated by the skill's unit.
 *
 * @import {Neighbour, Surroundings, Tile} from "./positions.mjs"
 */
import { FEO } from "../config.mjs";
import { matchesNear, reachable } from "./positions.mjs";
import { lineTiles } from "./forced.mjs";

/** What a `spread` part can say. */
export const SPREAD_KEYS = ["who", "around", "within", "from", "line", "apart", "quality", "class", "foe", "targets", "pick",
  "damage", "resist", "element", "nonlethal", "heal", "inflicts", "passes", "grant", "push", "attack"];

/** Around whom a spread reaches. */
export const SPREAD_AROUND = ["foe", "self", "both"];

/** How the units a spread goes to are picked, where there are more than it goes to. */
export const SPREAD_PICKS = ["nearest", "random", "hurt", "choose"];

/** The source that reads the damage of the hit a spread comes from. */
const DEALT = "dealt";

/** The moments a spread may wait for: those of a fight, of a turn, and the use of its skill as an action. */
export const SPREAD_MOMENTS = ["start", "attack", "hit", "crit", "kill", "after", "inflict", "turnStart", "turnEnd", "wait", "use"];

/** The moments at which there is no unit fought, so that a spread reaches around its own unit alone. */
const ALONE_MOMENTS = ["turnStart", "turnEnd", "wait", "use"];

/* -------------------------------------------- */
/*  Lines                                       */
/* -------------------------------------------- */

/**
 * The tiles in a straight line behind a unit, as another sees it: those a line from the middle of the one tile
 * through the middle of the other crosses beyond it, for so many spaces, the nearest first.
 * @param {Tile|null} from        Where the unit that looks stands
 * @param {Tile|null} target      Where the unit it looks at stands
 * @param {number} spaces         How many spaces behind the target the line goes on for
 * @returns {Tile[]}
 */
export function behind(from, target, spaces) {
  if ( !from || !target ) return [];
  const di = target.i - from.i;
  const dj = target.j - from.j;
  const reach = Math.max(Math.floor(spaces) || 0, 0);
  if ( (!di && !dj) || !reach ) return [];

  // The line goes on to a point far enough behind the target that every tile within reach lies before it
  const longest = Math.max(Math.abs(di), Math.abs(dj));
  const times = Math.ceil(reach / longest) + 1;
  const far = { i: target.i + (di * times), j: target.j + (dj * times) };
  const apart = (tile) => Math.abs(tile.i - target.i) + Math.abs(tile.j - target.j);
  return [...lineTiles(target, far), far].filter((tile) => apart(tile) <= reach);
}

/* -------------------------------------------- */

/** Does a unit take up a tile? */
const holds = (unit, tile) => {
  if ( !unit?.tile ) return false;
  const height = Math.max(unit.tile.height ?? 1, 1);
  const width = Math.max(unit.tile.width ?? 1, 1);
  return (tile.i >= unit.tile.i) && (tile.i < (unit.tile.i + height)) && (tile.j >= unit.tile.j) && (tile.j < (unit.tile.j + width));
};

/* -------------------------------------------- */
/*  Who Is Reached                              */
/* -------------------------------------------- */

/**
 * The units a spread reaches: every one that could be caught, the nearest first, before any is picked.
 * @param {object} spread                     The `spread` part of an effect
 * @param {Surroundings|null} near            What the skill's unit has around it
 * @param {Surroundings|null} [foeNear]       What the unit it fights has around it, where there is one
 * @param {object} [options]
 * @param {number} [options.weaponReach]      How far the weapon in hand reaches at the most, for a line
 * @returns {(Neighbour & {foe?: boolean})[]|null}    Null where it cannot be told what stands around: the unit
 *                                            is not on the map, or the unit it fights is not
 */
export function spreadTo(spread, near, foeNear = null, { weaponReach = 1 } = {}) {
  if ( !near || !spread ) return null;
  const who = spread.who ?? "enemy";
  const around = spread.line ? "foe" : (SPREAD_AROUND.includes(spread.around) ? spread.around : "foe");
  if ( (around !== "self") && !foeNear ) return null;
  const filter = { who };
  for ( const key of ["within", "from", "quality", "class"] ) if ( spread[key] !== undefined ) filter[key] = spread[key];
  const found = new Map();

  // How a unit stands to the skill's unit, whoever it is found around
  const mine = new Map(near.others.map((other) => [other.id, other]));
  const add = (other, distance) => {
    const seen = mine.get(other.id);
    if ( !seen || (seen.relation !== who) || !reachable(seen) ) return;
    if ( spread.apart && (seen.distance <= 1) ) return;
    const known = found.get(other.id);
    if ( !known || (distance < known.distance) ) found.set(other.id, { ...seen, distance, away: seen.distance });
  };

  if ( spread.line ) {
    if ( !near.tile || !foeNear.tile ) return null;
    const reach = (spread.line.reach === "weapon") ? weaponReach : (spread.line.reach ?? 1);
    const tiles = behind(near.tile, foeNear.tile, reach);
    tiles.forEach((tile, index) => {
      for ( const other of near.others ) {
        if ( (other.id !== foeNear.id) && holds(other, tile) && matchesNear({ ...other, distance: 0 }, { who, quality: filter.quality, class: filter.class }) ) add(other, index + 1);
      }
    });
  }
  else {
    if ( around !== "foe" ) for ( const other of near.others ) if ( (other.id !== foeNear?.id) && matchesNear(other, filter) ) add(other, other.distance);
    if ( around !== "self" ) {
      for ( const other of foeNear.others ) {
        if ( (other.id !== near.id) && matchesNear({ ...other, relation: who }, filter) ) add(other, other.distance);
      }
    }
  }
  const list = [...found.values()].sort((a, b) => a.distance - b.distance);

  // The unit it fights, where the spread catches it too: it stands 0 spaces from itself, and as far from the
  // skill's unit as it does
  if ( spread.foe && foeNear ) {
    const foe = mine.get(foeNear.id);
    const distance = (around === "self") ? (foe?.distance ?? Infinity) : 0;
    const inside = ((filter.within == null) || (distance <= filter.within)) && ((filter.from == null) || (around !== "self") || (distance >= filter.from));
    if ( foe && inside && !(spread.apart && (foe.distance <= 1)) ) list.unshift({ ...foe, distance, away: foe.distance, foe: true });
  }
  return list;
}

/* -------------------------------------------- */

/**
 * Pick the units a spread goes to, of those it reaches. Where it goes to all of them, or reaches no more than
 * it goes to, nothing is picked. The unit that is fought is never picked away.
 * @param {(Neighbour & {foe?: boolean})[]} units     The units reached, the nearest first
 * @param {object} spread
 * @param {(faces: number) => number} [die]   Rolls a die of so many faces, from 1; picks the first without it
 * @returns {{units: object[], choose: number, rolled?: number[]}}    The units picked; `choose` is how many
 *          of them whoever acts for the skill's unit may pick on the map instead, and 0 where nobody is asked
 */
export function pickSpread(units, spread, die = null) {
  const all = units ?? [];
  const count = Number.isInteger(spread?.targets) ? Math.max(spread.targets, 0) : null;
  const open = all.filter((unit) => !unit.foe);
  const fixed = all.filter((unit) => unit.foe);
  if ( (count === null) || (open.length <= count) ) return { units: all, choose: 0 };
  const how = SPREAD_PICKS.includes(spread.pick) ? spread.pick : "nearest";
  if ( how === "random" ) {
    const left = [...open];
    const picked = [];
    const rolled = [];
    while ( (picked.length < count) && left.length ) {
      const at = Math.min(Math.max((die ? die(left.length) : 1) - 1, 0), left.length - 1);
      rolled.push(at + 1);
      picked.push(...left.splice(at, 1));
    }
    return { units: [...fixed, ...picked], choose: 0, rolled };
  }
  if ( how === "hurt" ) {
    const lost = (unit) => Math.max((unit.hpMax ?? 0) - (unit.hp ?? 0), 0);
    const ordered = [...open].sort((a, b) => (lost(b) - lost(a)) || (a.distance - b.distance));
    return { units: [...fixed, ...ordered.slice(0, count)], choose: 0 };
  }
  return { units: [...fixed, ...open.slice(0, count)], choose: (how === "choose") ? count : 0, ...((how === "choose") ? { open } : {}) };
}

/* -------------------------------------------- */
/*  What Each Gets                              */
/* -------------------------------------------- */

/**
 * A unit that is caught, described for a number that is read from it: its stats as they stand.
 * @param {Neighbour} other
 * @returns {object}
 */
export function caughtSelf(other) {
  return {
    hp: other?.hp ?? 0,
    hpMax: other?.hpMax ?? other?.hp ?? 0,
    level: other?.level ?? 1,
    tier: other?.tier,
    stats: other?.totals ?? other?.stats ?? {},
    base: other?.base ?? {},
    weapon: other?.weapon ?? null,
    qualities: other?.qualities ?? "",
    near: null
  };
}

/* -------------------------------------------- */

/**
 * Work out a number of a spread: a plain one, one read from the damage of the hit it comes from, one read from
 * the unit caught (`theirs`), or one read from the skill's unit. A list is added up.
 * @param {number|object|object[]} value
 * @param {object} [about]
 * @param {number} [about.dealt]              The damage of the hit
 * @param {Neighbour|null} [about.other]      The unit caught
 * @param {(value: object, unit: object|null) => number} [about.read]
 *                                            Reads a number from a unit as `caughtSelf` describes it, or from
 *                                            the skill's unit where none is given
 * @returns {number}
 */
export function spreadAmount(value, { dealt = 0, other = null, read = null } = {}) {
  if ( Array.isArray(value) ) return value.reduce((sum, part) => sum + spreadAmount(part, { dealt, other, read }), 0);
  if ( typeof value === "number" ) return value;
  if ( !value || (typeof value !== "object") ) return 0;
  if ( value.of === DEALT ) {
    const amount = (Math.min(Math.max(dealt, 0), value.cap ?? Infinity) / (value.div ?? 1)) * (value.times ?? 1);
    return Math.floor(amount + 1e-9) + (value.plus ?? 0);
  }
  if ( value.theirs ) {
    const { theirs, ...number } = value;
    return (read && other) ? read(number, caughtSelf(other)) : 0;
  }
  return read ? read(value, null) : 0;
}

/* -------------------------------------------- */

/**
 * Does a number of a spread wait for the damage of a hit, or for the unit that is caught?
 * @param {*} value
 * @returns {boolean}
 */
export function spreadWaits(value) {
  if ( Array.isArray(value) ) return value.some(spreadWaits);
  return !!value && (typeof value === "object") && ((value.of === DEALT) || !!value.theirs);
}

/* -------------------------------------------- */

/**
 * @typedef SpreadShare
 * What a unit caught by a spread gets.
 * @property {string} id
 * @property {string} name
 * @property {boolean} [foe]              Is it the unit that is fought?
 * @property {number} [damage]
 * @property {number} [heal]
 * @property {{id: string, turns?: number}[]} [inflicts]
 * @property {boolean} [push]
 * @property {{hit: number, share: number}} [attack]
 */

/**
 * What one unit caught by a spread gets. `nth` is which of the units caught it is, from 0, for an attack that
 * falls off from one unit to the next.
 * @param {object} spread
 * @param {Neighbour & {foe?: boolean}} other
 * @param {object} [about]
 * @param {number} [about.dealt]                          The damage of the hit the spread comes from
 * @param {{id: string, turns?: number}|null} [about.inflicted]   The condition that was inflicted, at that moment
 * @param {number} [about.nth]
 * @param {Function} [about.read]                         See `spreadAmount`
 * @returns {SpreadShare}
 */
export function spreadShare(spread, other, { dealt = 0, inflicted = null, nth = 0, read = null } = {}) {
  const share = { id: other.id, name: other.name ?? "" };
  if ( other.foe ) share.foe = true;
  if ( spread.damage !== undefined ) {
    const stats = other.totals ?? other.stats ?? {};
    const amount = spreadAmount(spread.damage, { dealt, other, read }) - (spread.resist ? (stats[spread.resist] ?? 0) : 0);
    share.damage = Math.max(Math.floor(amount + 1e-9), 0);
  }
  if ( spread.heal !== undefined ) share.heal = Math.max(Math.floor(spreadAmount(spread.heal, { dealt, other, read }) + 1e-9), 0);
  const conditions = [];
  for ( const entry of spread.inflicts ?? [] ) {
    const id = (typeof entry === "string") ? entry : entry?.id;
    if ( !id ) continue;
    conditions.push(Number.isInteger(entry?.turns) ? { id, turns: entry.turns } : { id });
  }
  if ( spread.passes && inflicted?.id ) {
    const usual = FEO.conditions[inflicted.id]?.turns ?? 1;

    // Of a condition that adds up, what was inflicted is what it grew by, not all its unit now suffers
    const given = (inflicted.stacked && Number.isFinite(inflicted.previous)) ? Math.max((inflicted.turns ?? usual) - inflicted.previous, 0) : (inflicted.turns ?? usual);
    const turns = Math.max(Math.floor(((given * (spread.passes.percent ?? 50)) / 100) + 1e-9), spread.passes.min ?? 1);
    conditions.push({ id: inflicted.id, turns, passed: true });
  }
  if ( conditions.length ) share.inflicts = conditions;
  if ( spread.push ) share.push = true;
  if ( spread.attack ) {
    const falls = spread.attack.falls ?? {};
    share.attack = {
      hit: (spread.attack.hit ?? 0) + ((falls.hit ?? 0) * nth),
      share: ((spread.attack.damage ?? 100) / 100) * (((falls.damage ?? 100) / 100) ** nth)
    };
  }
  return share;
}

/* -------------------------------------------- */

/**
 * The change a spread leaves on a unit it catches, made ready to be built (see `buildChange` in `timed.mjs`):
 * one that lasts as long as the "condition" lasts does so with the first condition that unit is given, and is
 * gone with it if that is cured early.
 * @param {object} grant                              The `grant` of the spread
 * @param {{id: string, turns?: number}[]} [inflicts] The conditions the unit is given
 * @returns {object}
 */
export function spreadGrant(grant, inflicts = []) {
  if ( grant?.turns !== "condition" ) return grant;
  const first = inflicts?.[0] ?? null;
  const { turns, ...rest } = grant;
  if ( !first ) return rest;
  return { ...rest, turns: Math.max(first.turns ?? FEO.conditions[first.id]?.turns ?? 1, 1), next: true, while: first.id };
}

/* -------------------------------------------- */

/**
 * Has a share anything in it for its unit?
 * @param {SpreadShare} share
 * @returns {boolean}
 */
export function hasShare(share) {
  return (share.damage > 0) || (share.heal > 0) || !!share.inflicts?.length || !!share.push || !!share.attack || !!share.change;
}

/* -------------------------------------------- */

/**
 * @typedef SpreadOut
 * A spread that took effect.
 * @property {object[]} units             The units caught, each with what it gets (see `SpreadShare`)
 * @property {number} choose              How many of them whoever acts for the skill's unit may pick instead
 * @property {object[]} [open]            The units they may be picked from, with what each would get
 * @property {number[]} [rolled]          What the dice that picked a random one showed
 */

/**
 * Work a spread out: who is caught, who of them is picked, and what each gets.
 * @param {object} spread
 * @param {Surroundings|null} near
 * @param {Surroundings|null} foeNear
 * @param {object} [about]                    As for `spreadShare`, with `die` and `weaponReach`
 * @returns {SpreadOut|null}                  Null where it cannot be told what stands around
 */
export function spreadOut(spread, near, foeNear, about = {}) {
  const reached = spreadTo(spread, near, foeNear, { weaponReach: about.weaponReach ?? 1 });
  if ( !reached ) return null;
  const picked = pickSpread(reached, spread, about.die ?? null);
  const shares = (list) => list.map((other, nth) => spreadShare(spread, other, { ...about, nth })).filter((share) => hasShare(share) || spread.grant);
  const out = { units: shares(picked.units), choose: picked.choose };
  if ( picked.choose ) out.open = shares(picked.open ?? []);
  if ( picked.rolled ) out.rolled = picked.rolled;
  return out;
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check how a skill says it reaches for the units around, so that a typing mistake does not pass silently.
 * @param {any} spread
 * @param {object|null} [proc]                The moment it waits for
 * @param {object} [options]
 * @param {string[]} [options.conditions]     The conditions there are
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkSpread(spread, proc = null, { conditions = Object.keys(FEO.conditions) } = {}) {
  if ( !spread || (typeof spread !== "object") || Array.isArray(spread) ) return ["spread says who is reached and what each gets"];
  const problems = [];
  for ( const key of Object.keys(spread) ) if ( !SPREAD_KEYS.includes(key) ) problems.push(`spread cannot say "${key}"`);
  if ( !proc || !SPREAD_MOMENTS.includes(proc.on) ) problems.push(`a spread waits for a moment: ${SPREAD_MOMENTS.join(", ")}`);
  if ( (spread.who !== undefined) && !["enemy", "ally"].includes(spread.who) ) problems.push("spread: who is \"enemy\" or \"ally\"");
  if ( spread.line === undefined ) {
    if ( !SPREAD_AROUND.includes(spread.around) ) problems.push(`spread: around is ${SPREAD_AROUND.map((key) => `"${key}"`).join(", ")}`);
    else if ( proc && ALONE_MOMENTS.includes(proc.on) && (spread.around !== "self") ) problems.push("at a moment of a turn a spread reaches around its own unit: around is \"self\"");
  }
  else {
    const reach = spread.line?.reach;
    if ( !spread.line || (typeof spread.line !== "object") || !((reach === "weapon") || (Number.isInteger(reach) && (reach >= 1))) ) {
      problems.push("spread: line says how far behind the unit fought it reaches: { reach: 3 } or { reach: \"weapon\" }");
    }
    if ( spread.around !== undefined ) problems.push("a spread reaches around a unit or along a line, not both");
    if ( proc && ALONE_MOMENTS.includes(proc.on) ) problems.push("a line needs a unit that is fought");
  }
  for ( const key of ["within", "from"] ) {
    if ( (spread[key] !== undefined) && !(Number.isInteger(spread[key]) && (spread[key] >= 0)) ) problems.push(`spread: ${key} is a whole number of spaces`);
  }
  if ( (spread.targets !== undefined) && !(Number.isInteger(spread.targets) && (spread.targets >= 1)) ) problems.push("spread: targets is how many units it goes to");
  if ( (spread.pick !== undefined) && !SPREAD_PICKS.includes(spread.pick) ) problems.push(`spread: pick is ${SPREAD_PICKS.map((key) => `"${key}"`).join(", ")}`);
  if ( (spread.pick !== undefined) && (spread.targets === undefined) ) problems.push("spread: pick needs targets");
  for ( const key of ["apart", "foe", "nonlethal"] ) if ( (spread[key] !== undefined) && (spread[key] !== true) ) problems.push(`spread: ${key} is true or left out`);
  if ( spread.foe && proc && ALONE_MOMENTS.includes(proc.on) ) problems.push("at a moment of a turn there is no unit fought to catch");
  if ( (spread.resist !== undefined) && !["def", "res"].includes(spread.resist) ) problems.push("spread: resist is \"def\" or \"res\"");
  if ( (spread.resist !== undefined) && (spread.damage === undefined) ) problems.push("spread: resist needs damage");
  if ( (spread.element !== undefined) && ((typeof spread.element !== "string") || !spread.element) ) problems.push("spread: element names what the damage is of");
  const amount = (value, key) => {
    for ( const part of [].concat(value) ) {
      if ( (typeof part === "number") ? !(part >= 0) : (!part || (typeof part !== "object") || !(("of" in part) || ("count" in part))) ) {
        problems.push(`spread: ${key} is a number, or one that is read`);
      }
    }
  };
  if ( spread.damage !== undefined ) amount(spread.damage, "damage");
  if ( spread.heal !== undefined ) amount(spread.heal, "heal");
  if ( spread.inflicts !== undefined ) {
    if ( !Array.isArray(spread.inflicts) ) problems.push("spread: inflicts is a list of conditions");
    else {
      for ( const entry of spread.inflicts ) {
        const id = (typeof entry === "string") ? entry : entry?.id;
        if ( !conditions.includes(id) ) problems.push(`spread: unknown condition "${id}"`);
        if ( (typeof entry === "object") && (entry?.turns !== undefined) && !(Number.isInteger(entry.turns) && (entry.turns >= 1)) ) problems.push("spread: the turns of a condition are a whole number");
      }
    }
  }
  if ( spread.passes !== undefined ) {
    const passes = spread.passes;
    if ( !passes || (typeof passes !== "object") || Object.keys(passes).some((key) => !["percent", "min"].includes(key))
      || !(Number.isFinite(passes.percent) && (passes.percent > 0)) || ((passes.min !== undefined) && !(Number.isInteger(passes.min) && (passes.min >= 0))) ) {
      problems.push("spread: passes says what share of its turns the condition is passed on for: { percent: 50, min: 1 }");
    }
    if ( proc && (proc.on !== "inflict") ) problems.push("a spread passes a condition on at the moment one is inflicted");
  }
  if ( spread.push !== undefined ) {
    const push = spread.push;
    if ( !push || (typeof push !== "object") || Object.keys(push).some((key) => !["spaces", "blocked"].includes(key))
      || !(Number.isInteger(push.spaces) && (push.spaces >= 1)) || ((push.blocked !== undefined) && !(Number.isInteger(push.blocked) && (push.blocked >= 1))) ) {
      problems.push("spread: push says how many spaces, and the damage for a unit that cannot be moved: { spaces: 1, blocked: 5 }");
    }
  }
  if ( spread.attack !== undefined ) {
    const attack = spread.attack;
    const number = (value) => (value === undefined) || Number.isFinite(value);
    if ( !attack || (typeof attack !== "object") || Object.keys(attack).some((key) => !["hit", "damage", "falls", "free"].includes(key))
      || !number(attack.hit) || !number(attack.damage) || ((attack.free !== undefined) && (attack.free !== true)) ) {
      problems.push("spread: attack says what the attack on each unit has: { hit: -20, damage: 50, falls: { hit: -10, damage: 50 }, free: true }");
    }
    else if ( attack.falls !== undefined ) {
      const falls = attack.falls;
      if ( !falls || (typeof falls !== "object") || Object.keys(falls).some((key) => !["hit", "damage"].includes(key)) || !number(falls.hit) || !number(falls.damage) ) {
        problems.push("spread: attack.falls says what each attack after the first loses: { hit: -10, damage: 50 }");
      }
    }
    if ( proc && ALONE_MOMENTS.includes(proc.on) ) problems.push("an attack on the units around is made in a fight");
    if ( (spread.who ?? "enemy") !== "enemy" ) problems.push("an attack is made on enemies");
  }
  const does = ["damage", "heal", "inflicts", "passes", "grant", "push", "attack"].some((key) => spread[key] !== undefined);
  if ( !does ) problems.push("spread says what each unit gets: damage, heal, inflicts, passes, grant, push or attack");
  return problems;
}

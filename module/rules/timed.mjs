/**
 * Changes that last a while for Fire Emblem Online: what a skill gives a unit, or does to it, until a turn
 * starts or ends, for a number of turns, or for the rest of the map. Each is kept on the unit that carries it
 * and read as a skill entry of its own, named after the skill and the unit it comes from, so that the sheet,
 * a fight and a moment of a turn count it like any other skill. Pure functions of plain data, so that they
 * can be tested outside of Foundry.
 *
 * A skill grants one with the `grant` part of an effect that waits for a moment (see `skills.mjs`):
 *
 *   grant: {
 *     to: "foe",                        // who carries it: "self" or "foe"; or `reach` for units around
 *     reach: { who: "ally", within: 2 },          // the units around the skill's unit, or with
 *     around: "foe",                              // `around: "foe"` around the unit it fights
 *     name: "Rencounter (END)",         // what it is called, the skill's name unless given
 *     effects: [{ stats: { str: -6 } }],          // what it does, in the notation of skill effects. A number
 *                                                 // is read from the unit that carries it, or with
 *                                                 // `giver: true` from the unit that grants it
 *     ends: "turnEnd",                  // the moment of a turn it ends at: "turnStart", "turnEnd", or "map";
 *                                       // or "phaseEnd", with the Phase that is running, whatever its unit
 *                                       // has done in it: "until the end of the turn" for a unit that may
 *                                       // already have acted; or "never", for one that lasts between maps
 *                                       // until something takes it away
 *     turns: 2,                         // how many of those moments it takes; 1 unless given. "condition",
 *                                       // where a condition is inflicted: as long as that condition lasts
 *     hp: 10,                           // temporary HP: its unit has that many HP on top of its own, over its
 *                                       // maximum if need be, which are lost before its own and gone, with
 *                                       // whatever is left of them, as the change ends
 *     now: true,                        // granted in a fight, it counts for the rest of that fight as well:
 *                                       // the attacks still to come are worked out with it (see `combat.mjs`)
 *     next: true,                       // not counting the turn the unit whose turns count is in right now
 *     clock: "giver",                   // whose turns count: those of the unit that carries it, unless the
 *                                       // unit that grants it is named
 *     max: 3,                           // granted again it grows by one, up to this many times over; without
 *                                       // `max` it is only renewed
 *     stacks: 3, fades: true,           // it starts this many times over, and loses one each time its
 *                                       // moment comes instead of ending at once
 *     once: "defend",                   // it is used up by the next fight its unit is in: one it is attacked
 *                                       // in and would have answered ("defend"), one it starts ("attack"), or
 *                                       // either ("fight"); whichever comes first, that or its `ends`
 *     choose: { stats: ["str", "def"], pick: 2, amount: -5 },
 *                                       // in place of `effects`: whoever acts for the unit that grants it
 *                                       // picks so many of these stats, and the change adds that amount to
 *                                       // each. With nobody to pick, or no answer, the stats are picked for
 *                                       // them (see `pickStats`)
 *     staff: "charm",                   // in place of `effects`, `ends` and `turns`: what a staff does to
 *                                       // its target (see `FEO.staffChanges`)
 *     wait: 1,                          // it begins with its unit's next turn: it does nothing until so many
 *                                       // of that unit's turns have started, and counts its `turns` from there
 *     lone: true,                       // beside `wait`: it is not granted again while its unit carries one
 *                                       // that has begun
 *     unique: true,                     // its unit carries one of its name, whoever granted it: granted by
 *                                       // another unit it takes the place of the one carried, so that two
 *                                       // units with the same skill do not add up ("does not stack with
 *                                       // itself"). Without it, one unit's grant is only renewed by that unit
 *     mend: { of: "hpMax", times: 0.2 },          // HP it restores to its unit as each of that unit's turns
 *                                       // starts, for as long as it lasts; a tally (`max`) restores that
 *                                       // much for each time it was granted
 *     harm: { of: "mag", div: 2 },       // damage its unit takes as each of its turns starts, as a skill of the
 *                                       // unit that grants it deals it: with `ends: "turnStart"`, once, as the
 *                                       // next turn of its unit starts
 *     spoils: true,                     // granted again before it ends, it is spoilt: it does nothing more, and
 *                                       // stays until it would have ended, so that it is not begun anew
 *     random: { stats: ["str", "mag"], pick: { dice: 3 }, amount: { dice: 5 }, apart: true },
 *                                       // in place of `effects`: dice pick so many of these stats (a number,
 *                                       // or a die of so many faces) and what each gains (the same). With
 *                                       // `apart` the change is named after the stats it raises, so that one
 *                                       // for another stat stands beside it
 *     when: { equal: ["mag", "res"] }   // granted only where its giver meets this, as the moment comes
 *     by: true,                         // it remembers the unit it comes from, for what asks who that is
 *     toll: { move: 1, attack: { dice: 4 } },     // HP its unit loses each time it moves, and after each fight
 *                                       // in which it made an attack: a number, or a die of so many faces
 *     watch: true,                      // it keeps track of whether its unit stands within the Line of Sight
 *                                       // of the unit it comes from (see `actions.mjs`)
 *     stance: { state: "Hold", until: ["move"], mark: "hold" }
 *                                       // it is a stance its unit is in: it ends early with what the stance
 *                                       // names, and marks its unit's token meanwhile (see `stances.mjs`)
 *   }
 *
 * and `once` knows two more fights: "strike" is used up by the next fight in which its unit makes an attack
 * (what it does with `firstAttack` and `firstMight` is for that attack alone), and "struck" by the next in
 * which an attack lands on its unit. `to: "giver"` hands a change to the unit an aura comes from.
 *
 * A change that grows is a tally its unit keeps: how many times over it applies is its count, raised by one
 * each time it is granted and held at `max`. A skill takes from the count with a grant that says nothing but
 * whose it is and by how much:
 *
 *   grant: { to: "self", drop: 1 }      // the change of that name (the skill's, unless `name` is given) loses
 *                                       // this many of its `stacks`, and is gone with the last; a unit that
 *                                       // carries none loses nothing, so the count never falls below 0.
 *                                       // `drop: "all"` empties it
 *
 * A tally need not count one at a time, nor only multiply what it does:
 *
 *   grant: { to: "self", max: 50, grows: { of: "dealt" }, ... }     // `grows`: what it grows by each time it
 *                                       // is granted, in place of one: a number, or in a fight one read from
 *                                       // the hit that grants it. It starts at that much
 *   effects: [{ combat: { damage: { of: "count", div: 10 } } }]     // a number read from the count: an effect
 *                                       // that reads it is worked out from it (`div`, `per`, `times`, `plus`,
 *                                       // `max`, `min`) and is not multiplied by it as well
 *
 * A tally that waits (`wait: 1`) counts while it waits and does what it does from its unit's next turn on, so
 * that what was counted through one turn is what the next turn gains; meanwhile a new one counts beside it.
 * The count of a unit's own tally named after one of its skills is shown on that skill (see `skillCounts`).
 *
 * @import {SkillEntry} from "./skills.mjs"
 */
import { FEO } from "../config.mjs";
import { stanceOf } from "./stances.mjs";

/**
 * @typedef TimedChange
 * @property {string} name            The skill it comes from, or what the skill calls it
 * @property {string} from            The unit that granted it; empty for the unit's own
 * @property {object[]} effects       What it does, in the notation of skill effects
 * @property {"turnStart"|"turnEnd"|"phaseEnd"|"map"|"never"} ends
 * @property {number} turns           How many of those moments are still to come
 * @property {number} [hp]            The temporary HP it still holds for its unit
 * @property {string} clock           The unit whose turns count, by its UUID; empty for the unit itself
 * @property {number} stacks          How many times over it applies
 * @property {number} max             The most it can grow to; 0 for one that does not grow
 * @property {boolean} fades          Does it lose one of its `stacks` at its moment, instead of ending?
 * @property {string} [while]         The condition it lasts with: it ends as soon as its unit no longer suffers
 *                                    from that condition, however that came about
 * @property {"defend"|"attack"|"fight"|""} [once]
 *                                    The fight that uses it up, if one does (see `spendOnce`)
 * @property {number} [drop]          Only on a change that is handed to `grantChange` to take from a tally: how
 *                                    many of its `stacks` the change of that name loses. It is never kept
 * @property {number} [grows]         Only on a change that is handed to `grantChange`: what a tally grows by,
 *                                    and starts at, in place of one. It is never kept
 * @property {number} [wait]          The turns of its unit that are still to start before it begins
 * @property {boolean} [lone]         Is it not granted again while its unit carries one that has begun?
 * @property {boolean} [unique]       Does its unit carry one of its name, whoever granted it?
 * @property {number} [mend]          The HP it restores to its unit as each of that unit's turns starts
 * @property {number} [harm]          The damage its unit takes as each of its turns starts, from the skill of
 *                                    the unit that granted it
 * @property {string} [by]            The unit whose skill deals that damage, by its UUID: a unit the damage
 *                                    brings down is defeated by it
 * @property {boolean} [spoils]       Is it spoilt by being granted again before it ends?
 * @property {boolean} [spoiled]      Has it been: it does nothing more, and only waits for its end
 * @property {boolean} [mark]         Does it only keep count of something for a skill, with nothing to show?
 * @property {{move?: number|object, attack?: number|object}} [toll]
 *                                    The HP its unit loses as it moves, and once it has attacked
 * @property {boolean} [watch]        Does it keep track of whether its unit stands in sight of the unit in `by`?
 * @property {import("./stances.mjs").Stance} [stance]
 *                                    The stance it is, for one its unit is in until something ends it
 */

/**
 * The moments a lasting change can end at. One that ends with the map stays until a new battle begins, and one
 * that ends with the Phase goes as the Phase that is running ends, whoever's it is. One that never ends by
 * itself is kept from map to map, until a skill takes it away.
 */
export const TIMED_ENDS = ["turnStart", "turnEnd", "phaseEnd", "map", "never"];

/** The end of a change that no moment brings: it lasts between maps. */
export const NEVER = "never";

/** The most a tally counts to, and the most a change grows by at once. */
export const COUNT_MOST = 999;

/** What a number in the effects of a tally is read from: how much the tally holds. */
export const COUNT_SOURCE = "count";

/** The moment a Phase ends, for the changes that last until then. */
export const PHASE_END = "phaseEnd";

/**
 * The fights that can use a lasting change up: the next one its unit is attacked in and would have answered,
 * the next one it starts, or the next one of either kind.
 */
export const TIMED_ONCE = ["defend", "attack", "fight", "strike", "struck"];

/** The fight that uses a change up as its unit makes an attack in it, and the one that does as it is hit. */
export const ONCE_STRIKE = "strike";
export const ONCE_STRUCK = "struck";

/** What a change is called that only says a skill has had its turn for now: the skill, and this. */
export const USED_MARK = "used";

/**
 * The name of the change that marks a skill as having taken effect as often as it may for now.
 * @param {string} skill
 * @returns {string}
 */
export function usedName(skill) {
  return `${skill} · ${USED_MARK}`;
}

/** What empties a tally, however much it holds. */
const DROP_ALL = 9999;

/** The order in which temporary HP are lost: those that go soonest first. */
const SOONEST = ["phaseEnd", "turnEnd", "turnStart", "map", "never"];

/* -------------------------------------------- */

/**
 * The name a lasting change goes by among a unit's skills: its own, with the unit it comes from.
 * @param {TimedChange} change
 * @returns {string}
 */
export function timedName(change) {
  return change.from ? `${change.name} (${change.from})` : change.name;
}

/* -------------------------------------------- */

/**
 * Does a change do nothing for now: one that waits for a turn of its unit to begin, one that was spoilt, or one
 * that only keeps count of something?
 * @param {TimedChange} change
 * @returns {boolean}
 */
export function isIdle(change) {
  return ((change?.wait ?? 0) > 0) || !!change?.spoiled || !!change?.mark;
}

/* -------------------------------------------- */

/**
 * A unit's lasting changes as skill entries. One that applies several times over has its numbers multiplied.
 * One that another unit left on it is `foreign`, which is what makes its penalties incoming ones.
 * @param {TimedChange[]} [changes]
 * @returns {(SkillEntry & {timed: true, foreign: boolean})[]}
 */
export function timedEntries(changes) {
  return (changes ?? []).filter((change) => ((change.stacks ?? 1) > 0) && !isIdle(change)).map((change) => ({
    name: timedName(change),
    timed: true,
    foreign: !!change.from,

    // The unit it comes from, for what asks whether that is the unit fought, and what it is itself called
    from: change.from ?? "",
    by: change.by ?? "",
    change: change.name,
    nihil: false,

    // An effect that reads the count is worked out from it; any other is multiplied by it
    effects: (change.effects ?? []).map((effect) => {
      if ( readsCount(effect) ) return resolveCount(effect, change.stacks ?? 1);
      return ((change.stacks ?? 1) > 1) ? { ...effect, scale: change.stacks } : effect;
    })
  }));
}

/* -------------------------------------------- */
/*  Tallies                                     */
/* -------------------------------------------- */

/**
 * Does an effect, or anything that holds numbers, read how much the tally it belongs to holds?
 * @param {*} value
 * @returns {boolean}
 */
export function readsCount(value) {
  if ( Array.isArray(value) ) return value.some(readsCount);
  if ( !value || (typeof value !== "object") ) return false;
  return (value.of === COUNT_SOURCE) || Object.values(value).some(readsCount);
}

/**
 * Work out the numbers that are read from the count of a tally: `{ of: "count", per, div, times, plus, max, min }`
 * is the count, in whole steps of `per` or divided by `div`, multiplied, rounded down, with `plus` added, and
 * held between `min` and `max`.
 * @param {*} value           The effects of a lasting change, a part of them, or a list
 * @param {number} count      How much the tally holds
 * @returns {*}               The same with those numbers worked out
 */
export function resolveCount(value, count) {
  if ( Array.isArray(value) ) return value.map((entry) => resolveCount(entry, count));
  if ( !value || (typeof value !== "object") ) return value;
  if ( value.of === COUNT_SOURCE ) {
    let amount = Math.max(Number(count) || 0, 0);
    if ( value.per ) amount = Math.floor(amount / value.per);
    if ( value.div ) amount /= value.div;
    amount = Math.floor((amount * (value.times ?? 1)) + 1e-9) + (value.plus ?? 0);
    if ( value.max != null ) amount = Math.min(amount, value.max);
    return (value.min != null) ? Math.max(amount, value.min) : amount;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveCount(entry, count)]));
}

/**
 * The counts a unit's skills keep on it, for the small number each such skill shows: by the name of the skill,
 * how much its tally holds and the most it can. A tally is a change of the unit's own that can grow; one that
 * still waits for a turn to begin is the count that is running, and is shown before one that has begun.
 * @param {TimedChange[]} [list]      What the unit carries
 * @returns {Record<string, {count: number, max: number, waits: boolean, change: TimedChange}>}
 */
export function skillCounts(list) {
  const found = {};
  for ( const change of list ?? [] ) {
    if ( change?.from || !((change?.max ?? 0) > 0) || change.mark || change.spoiled ) continue;
    const waits = (change.wait ?? 0) > 0;
    if ( found[change.name] && (found[change.name].waits || !waits) ) continue;
    found[change.name] = { count: Math.max(change.stacks ?? 0, 0), max: change.max, waits, change };
  }
  return found;
}

/**
 * What a tally a skill keeps counts, as the skill's own effects say: the moment at which it grows, and whether
 * it grows by the damage of a hit. Null for a skill that keeps no tally under that name.
 * @param {object[]} [effects]    The effects of the skill
 * @param {string} name           What the tally is called: the skill's name, unless its grant names it
 * @param {string} [skill]        The skill's name
 * @returns {{on: string, dealt: boolean}|null}
 */
export function countedAt(effects, name, skill = name) {
  for ( const effect of effects ?? [] ) {
    for ( const grant of [].concat(effect?.grant ?? []) ) {
      if ( !((grant?.max ?? 0) > 0) || grant.drop || ((grant.name ?? skill) !== name) ) continue;
      return { on: effect.proc?.on ?? "", dealt: !!grant.grows && (typeof grant.grows === "object") };
    }
  }
  return null;
}

/**
 * The changes a unit keeps as a new battle begins: those that last between maps.
 * @param {TimedChange[]} [list]
 * @returns {TimedChange[]}
 */
export function keptBetweenMaps(list) {
  return (list ?? []).filter((change) => change?.ends === NEVER);
}

/* -------------------------------------------- */

/**
 * Work out a change a skill grants.
 * @param {object} grant                  The `grant` of the effect, with the numbers read from the giver
 *                                        already worked out
 * @param {object} context
 * @param {string} context.skill          The skill that grants it
 * @param {string} [context.from]         The unit that grants it, when that is not the unit that carries it
 * @param {string} [context.giver]        The UUID of the unit that grants it
 * @param {boolean} [context.own]         Is the unit that carries it the one that grants it?
 * @param {boolean} [context.giverInTurn] Is the unit that grants it in its own turn right now?
 * @param {boolean} [context.carrierInTurn]   Is the unit that carries it?
 * @returns {TimedChange}
 */
export function buildChange(grant, { skill, from = "", giver = "", own = false, giverInTurn = false, carrierInTurn = false } = {}) {
  const byGiver = (grant.clock === "giver") && !own && !!giver;
  const inTurn = byGiver ? giverInTurn : carrierInTurn;
  const ends = TIMED_ENDS.includes(grant.ends) ? grant.ends : "turnEnd";
  const hp = Math.max(Math.floor(Number(grant.hp) || 0), 0);
  const wait = Math.max(Math.floor(Number(grant.wait) || 0), 0);
  const mend = Math.max(Math.floor(Number(grant.mend) || 0), 0);
  const harm = Math.max(Math.floor(Number(grant.harm) || 0), 0);

  // What ends with the Phase ends once, whoever's turns are counted
  const phase = ends === PHASE_END;

  // What a tally grows by each time, where that is not one: it starts at that much
  const grows = Math.min(Math.max(Math.floor(Number(grant.grows) || 0), 0), COUNT_MOST);

  // One that only takes from a tally says whose it is and by how much, and nothing else
  if ( grant.drop ) {
    const drop = (grant.drop === "all") ? DROP_ALL : Math.max(Math.floor(Number(grant.drop) || 0), 0);
    return { name: grant.name ?? skill, from: own ? "" : from, effects: [], ends: "map", turns: 0, clock: "", stacks: 0, max: 0, fades: false, drop };
  }
  return {
    name: grant.name ?? skill,
    from: own ? "" : from,
    effects: grant.effects ?? [],
    ends,
    // One that waits for a turn to begin counts its turns from that turn on
    turns: ((ends === "map") || (ends === NEVER)) ? 0 : phase ? 1 : Math.max(grant.turns ?? 1, 1) + ((grant.next && inTurn && (ends === "turnEnd") && !wait) ? 1 : 0),
    clock: (byGiver && !phase) ? giver : "",
    stacks: grows ? Math.min(grows, Math.max(grant.max ?? grows, 1)) : Math.max(Number(grant.stacks) || 1, 1),
    max: Math.max(grant.max ?? 0, 0),
    ...(grows ? { grows } : {}),
    fades: !!grant.fades,
    ...(hp ? { hp } : {}),
    ...(grant.while ? { while: String(grant.while) } : {}),
    ...(TIMED_ONCE.includes(grant.once) ? { once: grant.once } : {}),
    ...(wait ? { wait } : {}),
    ...((wait && grant.lone) ? { lone: true } : {}),
    ...(grant.unique ? { unique: true } : {}),
    ...(mend ? { mend } : {}),
    ...(harm ? { harm } : {}),
    ...(((harm || grant.by || grant.toll) && giver && !own) ? { by: giver } : {}),
    ...(grant.spoils ? { spoils: true } : {}),
    ...(grant.mark ? { mark: true } : {}),
    ...(tollOf(grant.toll) ? { toll: tollOf(grant.toll) } : {}),
    ...(grant.watch ? { watch: true } : {}),
    ...(stanceOf(grant.stance) ? { stance: stanceOf(grant.stance) } : {})
  };
}

/**
 * What a change takes off its unit's HP as it moves and once it has attacked, with nothing else on it.
 * @param {any} toll
 * @returns {{move?: number|{dice: number}, attack?: number|{dice: number}}|null}     Null for none
 */
function tollOf(toll) {
  const cost = (value) => {
    if ( Number.isInteger(value) && (value >= 1) && (value <= 999) ) return value;
    if ( Number.isInteger(value?.dice) && (value.dice >= 2) && (value.dice <= 100) ) return { dice: value.dice };
    return null;
  };
  const kept = {};
  for ( const key of ["move", "attack"] ) {
    const value = cost(toll?.[key]);
    if ( value ) kept[key] = value;
  }
  return Object.keys(kept).length ? kept : null;
}

/* -------------------------------------------- */

/**
 * The HP the changes a unit carries take off it as it moves, or once it has attacked: each that has begun, by
 * its name, with what it takes and the unit whose skill takes it.
 * @param {TimedChange[]} [list]
 * @param {"move"|"attack"} when
 * @returns {{name: string, from: string, by: string, toll: number|{dice: number}}[]}
 */
export function tollsOf(list, when) {
  return (list ?? []).filter((change) => change?.toll?.[when] && !isIdle(change))
    .map((change) => ({ name: change.name, from: change.from ?? "", by: change.by ?? "", toll: change.toll[when] }));
}

/* -------------------------------------------- */
/*  What a Change Is Made Of                    */
/* -------------------------------------------- */

/**
 * A grant with what it stands for written out: one that names a staff does what that staff does to its target,
 * for as long as the staff says. What the grant says itself comes first.
 * @param {object} grant
 * @returns {object}
 */
export function expandGrant(grant) {
  const staff = grant?.staff ? FEO.staffChanges?.[grant.staff] : null;
  if ( !staff ) return grant;
  const { staff: named, ...rest } = grant;
  return { ...staff, ...rest };
}

/* -------------------------------------------- */

/**
 * The stats a unit picks for a change that has it pick some, where nobody picks for it: those the units that
 * are to carry the change have the most of, so that the change takes the most from them. Among equals the
 * stat that is listed first is taken.
 * @param {{stats: string[], pick?: number}} choose
 * @param {Record<string, number>[]} [carriers]     The stats of each unit that is to carry the change
 * @returns {string[]}
 */
export function pickStats(choose, carriers = []) {
  const listed = [...new Set(choose?.stats ?? [])];
  return rankStats(choose, carriers).slice(0, pickCount(choose)).sort((a, b) => listed.indexOf(a) - listed.indexOf(b));
}

/**
 * The stats a change offers, those first that the units which are to carry it have the most of.
 * @param {{stats: string[]}} choose
 * @param {Record<string, number>[]} [carriers]
 * @returns {string[]}
 */
function rankStats(choose, carriers = []) {
  const listed = [...new Set(choose?.stats ?? [])];
  const sum = (key) => (carriers ?? []).reduce((total, stats) => total + (stats?.[key] ?? 0), 0);
  return listed.map((key, index) => ({ key, index, sum: sum(key) }))
    .sort((a, b) => (b.sum - a.sum) || (a.index - b.index))
    .map((entry) => entry.key);
}

/**
 * How many stats a change has its unit pick: one unless it says more, and no more than it lists.
 * @param {{stats: string[], pick?: number}} choose
 * @returns {number}
 */
export function pickCount(choose) {
  const listed = new Set(choose?.stats ?? []).size;
  return Math.min(Math.max(Math.floor(Number(choose?.pick) || 1), 1), listed);
}

/**
 * What a change does once its stats are picked: the amount it names, added to each of them. Anything that was
 * not on offer is dropped, and what is missing is made up from the stats picked for the unit.
 * @param {{stats: string[], pick?: number, amount: number}} choose
 * @param {string[]} [picked]                       The stats picked, in any order
 * @param {Record<string, number>[]} [carriers]     The stats of each unit that is to carry the change
 * @returns {object[]}                              Effects, in the notation of skill effects
 */
export function chosenEffects(choose, picked = [], carriers = []) {
  const count = pickCount(choose);
  const taken = [...new Set(picked ?? [])].filter((key) => (choose?.stats ?? []).includes(key)).slice(0, count);
  for ( const key of rankStats(choose, carriers) ) {
    if ( taken.length >= count ) break;
    if ( !taken.includes(key) ) taken.push(key);
  }
  const amount = Number(choose?.amount) || 0;
  const order = (choose?.stats ?? []).filter((key) => taken.includes(key));
  return (order.length && amount) ? [{ stats: Object.fromEntries(order.map((key) => [key, amount])) }] : [];
}

/* -------------------------------------------- */
/*  Temporary HP                                */
/* -------------------------------------------- */

/**
 * The temporary HP a unit has: what the changes it carries still hold for it.
 * @param {TimedChange[]} [list]
 * @returns {number}
 */
export function tempHp(list) {
  return (list ?? []).reduce((sum, change) => sum + Math.max(Math.floor(Number(change?.hp) || 0), 0), 0);
}

/* -------------------------------------------- */

/**
 * A unit loses temporary HP: they are taken from the changes that hold them, those that end soonest first. A
 * change that did nothing but hold them, and holds none any more, is over.
 * @param {TimedChange[]} [list]      What the unit carries
 * @param {number} amount             The temporary HP it loses
 * @returns {{list: TimedChange[], spent: number}}    What it carries afterwards, and what was taken
 */
export function spendTemp(list, amount) {
  let left = Math.max(Math.floor(Number(amount) || 0), 0);
  const carried = (list ?? []).map((change) => ({ ...change }));
  const held = carried.map((change) => change.hp > 0);
  const order = carried.map((change, index) => ({ change, index })).filter(({ change }) => change.hp > 0).sort((a, b) => {
    const soon = SOONEST.indexOf(a.change.ends) - SOONEST.indexOf(b.change.ends);
    return soon || ((a.change.turns ?? 1) - (b.change.turns ?? 1)) || (a.index - b.index);
  });
  let spent = 0;
  for ( const { change } of order ) {
    if ( left <= 0 ) break;
    const taken = Math.min(change.hp, left);
    change.hp -= taken;
    left -= taken;
    spent += taken;
  }
  return { list: carried.filter((change, index) => !held[index] || (change.hp > 0) || ((change.effects ?? []).length > 0)), spent };
}

/* -------------------------------------------- */

/**
 * What a unit's HP come to once the HP it has in all, its own and its temporary ones, have changed: what it
 * loses is taken off its temporary HP first, and what it regains is its own, up to its maximum. A fight counts
 * what a unit lost and regained in it as one.
 * @param {{value: number, max: number, temp: number}} hp     Its own HP, their maximum, and its temporary HP
 * @param {number} total              The HP it has in all afterwards; below 0 for a unit that keeps count of it
 * @returns {{value: number, temp: number}}
 */
export function splitHp({ value = 0, max = 0, temp = 0 } = {}, total = 0) {
  const had = value + temp;
  if ( total >= had ) return { value: Math.min(value + (total - had), Math.max(max, value)), temp };
  const kept = Math.max(temp - (had - total), 0);
  return { value: total - kept, temp: kept };
}

/* -------------------------------------------- */

/**
 * Give a unit a lasting change. One it already carries, by the same name from the same unit, is renewed (one
 * that is `unique`, by the same name from any unit); one that can grow grows by one as well, up to its limit. A change that says `drop` gives nothing: it takes that
 * many `stacks` from the change of its name the unit carries, which is gone with the last of them.
 * @param {TimedChange[]} [list]      What the unit carries
 * @param {TimedChange} change
 * @returns {{list: TimedChange[], change: TimedChange|null, renewed: boolean}}    The new list, and the change
 *                                    as the unit now carries it; null where it carries it no longer, or never did
 */
export function grantChange(list, change) {
  const carried = [...(list ?? [])];
  const same = (entry) => (entry.name === change.name) && (!!change.unique || ((entry.from ?? "") === (change.from ?? "")));
  const waits = (entry) => (entry.wait ?? 0) > 0;

  // One that waits for a turn to begin stands beside one of its name that has begun: it takes that one's
  // place only once it begins itself. One that stands alone is not granted while one that has begun is there
  if ( !change.drop && !change.spoils && waits(change) && carried.some((entry) => same(entry) && !waits(entry)) ) {
    if ( change.lone ) return { list: carried, change: carried.find((entry) => same(entry) && !waits(entry)), renewed: false };
  }
  const index = carried.findIndex((entry) => same(entry) && ((change.drop || change.spoils) ? true : (waits(entry) === waits(change))));
  if ( change.drop > 0 ) {
    if ( index < 0 ) return { list: carried, change: null, renewed: false };
    const left = (carried[index].stacks ?? 1) - change.drop;
    if ( left <= 0 ) {
      carried.splice(index, 1);
      return { list: carried, change: null, renewed: true };
    }
    carried[index] = { ...carried[index], stacks: left };
    return { list: carried, change: carried[index], renewed: true };
  }
  const { grows, ...given } = change;
  if ( index < 0 ) {
    carried.push({ ...given });
    return { list: carried, change: carried.at(-1), renewed: false };
  }

  // One that is spoilt by being granted again does nothing more, and stays until it would have ended
  if ( change.spoils ) {
    const { mend, ...rest } = carried[index];
    carried[index] = { ...rest, effects: [], hp: 0, spoils: true, spoiled: true };
    return { list: carried, change: carried[index], renewed: true };
  }

  const stacks = (change.max > 0) ? Math.min((carried[index].stacks ?? 1) + (grows || 1), change.max) : change.stacks;
  carried[index] = { ...given, stacks };
  return { list: carried, change: carried[index], renewed: true };
}

/* -------------------------------------------- */

/**
 * A moment of a turn comes: the changes that end at it count it, and those that have none left to come end.
 * One that fades loses one of its `stacks` instead, and ends with the last.
 * @param {TimedChange[]} [list]      What a unit carries
 * @param {"turnStart"|"turnEnd"} moment
 * @param {string} [clock]            The UUID of the unit whose moment it is, when that is not the unit that
 *                                    carries the changes; only those counted by its turns are then touched
 * @returns {{list: TimedChange[], ended: TimedChange[], changed: boolean}}
 */
export function tickChanges(list, moment, clock = "") {
  const kept = [];
  const ended = [];
  let changed = false;
  for ( const change of list ?? [] ) {
    // One that waits for a turn of its unit to begin counts the turns that start, and nothing else until then
    if ( (change.wait ?? 0) > 0 ) {
      if ( (moment === "turnStart") && ((change.clock ?? "") === clock) ) {
        changed = true;
        const { wait, ...rest } = change;
        kept.push((wait > 1) ? { ...rest, wait: wait - 1 } : rest);
      }
      else kept.push(change);
      continue;
    }
    if ( (change.ends !== moment) || ((change.clock ?? "") !== clock) ) {
      kept.push(change);
      continue;
    }
    changed = true;
    const next = change.fades ? { ...change, stacks: (change.stacks ?? 1) - 1 } : { ...change, turns: (change.turns ?? 1) - 1 };
    if ( (change.fades ? next.stacks : next.turns) > 0 ) kept.push(next);
    else ended.push(change);
  }
  return { list: kept, ended, changed };
}

/* -------------------------------------------- */

/**
 * A unit has been in a fight: the changes it carried into it that the fight uses up are over. One marked
 * "defend" is used up by a fight its unit was attacked in and would have answered, one marked "attack" by a
 * fight it started, one marked "fight" by either.
 * One marked "strike" is used up by a fight in which its unit made an attack, and one marked "struck" by a
 * fight in which an attack landed on it. One that still waits for a turn to begin is used up by none.
 * @param {TimedChange[]} [list]              What the unit carried into the fight
 * @param {"attack"|"defend"|"fight"|null} role     What the fight was to it; null for one that uses nothing up
 * @param {object} [did]
 * @param {boolean} [did.made]                Did it make an attack in the fight?
 * @param {boolean} [did.struck]              Did an attack land on it?
 * @returns {{list: TimedChange[], ended: TimedChange[], changed: boolean}}
 */
export function spendOnce(list, role, { made = false, struck = false } = {}) {
  const kept = [];
  const ended = [];
  const uses = (change) => {
    if ( !role || !change.once || ((change.wait ?? 0) > 0) ) return false;
    if ( change.once === ONCE_STRIKE ) return made;
    if ( change.once === ONCE_STRUCK ) return struck;
    return (change.once === role) || (change.once === "fight");
  };
  for ( const change of list ?? [] ) {
    if ( uses(change) ) ended.push(change);
    else kept.push(change);
  }
  return { list: kept, ended, changed: ended.length > 0 };
}

/* -------------------------------------------- */

/**
 * The changes a unit keeps once its conditions have changed: one that lasts with a condition ends when its
 * unit no longer suffers from it.
 * @param {TimedChange[]} [list]                  What the unit carries
 * @param {Record<string, number>} [conditions]   The conditions it suffers from now
 * @returns {{list: TimedChange[], ended: TimedChange[], changed: boolean}}
 */
export function endWith(list, conditions = {}) {
  const kept = [];
  const ended = [];
  for ( const change of list ?? [] ) {
    if ( change.while && !Object.hasOwn(conditions ?? {}, change.while) ) ended.push(change);
    else kept.push(change);
  }
  return { list: kept, ended, changed: ended.length > 0 };
}

/* -------------------------------------------- */

/**
 * Check a lasting change that is about to be saved, so that nothing but a sensible one is.
 * @param {object} change
 * @param {(effects: object[]) => string[]} checkEffects    Finds what is wrong with a list of effects
 * @returns {TimedChange|null}    The change with nothing else on it, or null when it is not one
 */
export function cleanChange(change, checkEffects) {
  const count = (value, max = 99) => Number.isInteger(value) && (value >= 0) && (value <= max);
  const grows = (change?.grows === undefined) ? {} : { grows: change.grows };
  if ( (change?.grows !== undefined) && !(count(change.grows, COUNT_MOST) && (change.grows > 0)) ) return null;
  const text = (value) => (typeof value === "string") && (value.length <= 200);
  if ( !change || !text(change.name) || !change.name || !text(change.from ?? "") || !text(change.clock ?? "") ) return null;

  // One that only takes from a tally
  if ( change.drop !== undefined ) {
    if ( !count(change.drop, DROP_ALL) || !(change.drop > 0) ) return null;
    return { name: change.name, from: change.from ?? "", effects: [], ends: "map", turns: 0, clock: "", stacks: 0, max: 0, fades: false, drop: change.drop };
  }
  if ( ![undefined, "", ...TIMED_ONCE].includes(change.once) ) return null;
  if ( !TIMED_ENDS.includes(change.ends)|| !count(change.turns) || !count(change.stacks, COUNT_MOST) || !count(change.max, COUNT_MOST) ) return null;
  if ( !Array.isArray(change.effects) || (change.effects.length > 20) || checkEffects(change.effects).length ) return null;
  if ( change.effects.some((effect) => effect.proc || effect.aura || effect.grant) ) return null;
  if ( !text(change.while ?? "") || !count(change.hp ?? 0, 9999) || !count(change.wait ?? 0) || !count(change.mend ?? 0, 9999) ) return null;
  if ( !count(change.harm ?? 0, 9999) || !text(change.by ?? "") ) return null;
  if ( (change.toll != null) && Object.keys(change.toll).length && !tollOf(change.toll) ) return null;
  return {
    name: change.name,
    from: change.from ?? "",
    effects: change.effects,
    ends: change.ends,
    turns: change.turns,
    clock: change.clock ?? "",
    stacks: change.stacks,
    max: change.max,
    fades: !!change.fades,
    hp: change.hp ?? 0,
    while: change.while ?? "",
    once: change.once ?? "",
    wait: change.wait ?? 0,
    lone: !!change.lone,
    ...(change.unique ? { unique: true } : {}),
    mend: change.mend ?? 0,
    harm: change.harm ?? 0,
    by: change.by ?? "",
    spoils: !!change.spoils,
    spoiled: !!change.spoiled,
    mark: !!change.mark,
    toll: tollOf(change.toll) ?? {},
    watch: !!change.watch,
    ...(stanceOf(change.stance) ? { stance: stanceOf(change.stance) } : {}),
    ...grows
  };
}

/* -------------------------------------------- */
/*  Bonuses Multiplied                          */
/* -------------------------------------------- */

/**
 * A change with the bonuses it gives multiplied, as for a unit whose buffs are doubled: what it adds to stats,
 * to combat stats and to the Might of weapons. What it takes off stays as it is, and so does a number that is
 * read from something as it is needed.
 * @param {TimedChange} change
 * @param {number} times
 * @returns {TimedChange}       A copy; the change itself where there is nothing to multiply
 */
export function boostChange(change, times) {
  if ( !Number.isFinite(times) || (times === 1) || !Array.isArray(change?.effects) ) return change;
  const more = (value) => (Number.isFinite(value) && (value > 0)) ? Math.floor((value * times) + 1e-9) : value;
  const table = (values) => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, more(value)]));
  return {
    ...change,
    effects: change.effects.map((effect) => ({
      ...effect,
      ...(effect.stats ? { stats: table(effect.stats) } : {}),
      ...(effect.combat ? { combat: table(effect.combat) } : {}),
      ...(Number.isFinite(effect.might) ? { might: more(effect.might) } : {})
    }))
  };
}

/* -------------------------------------------- */
/*  Healing Over Turns                          */
/* -------------------------------------------- */

/**
 * What the changes a unit carries restore to it as its turn starts: each that has begun and was not spoilt,
 * by its name, with the HP it restores.
 * @param {TimedChange[]} [list]
 * @returns {{name: string, from: string, amount: number}[]}
 */
export function mendsOf(list) {
  // A tally restores what it restores once for each time it was granted
  return (list ?? []).filter((change) => (change?.mend > 0) && !isIdle(change))
    .map((change) => ({ name: change.name, from: change.from ?? "", amount: Math.floor(change.mend) * ((change.max > 0) ? Math.max(change.stacks ?? 1, 1) : 1) }));
}

/* -------------------------------------------- */

/**
 * What the changes a unit carries deal to it as its turn starts: each that has begun, by its name, with the
 * damage it deals and the unit whose skill deals it.
 * @param {TimedChange[]} [list]
 * @returns {{name: string, from: string, amount: number, by: string}[]}
 */
export function harmsOf(list) {
  return (list ?? []).filter((change) => (change?.harm > 0) && !isIdle(change))
    .map((change) => ({ name: change.name, from: change.from ?? "", amount: Math.floor(change.harm), by: change.by ?? "" }));
}

/* -------------------------------------------- */
/*  Stats Picked by Dice                        */
/* -------------------------------------------- */

/**
 * How many dice a change that has dice pick its stats rolls at the most: one for how many stats where that is
 * a die, one for each stat picked, and one for what each gains where that is a die.
 * @param {{stats: string[], pick?: number|{dice: number}, amount?: number|{dice: number}}} random
 * @returns {number}
 */
export function randomDice(random) {
  const listed = new Set(random?.stats ?? []).size;
  if ( !listed ) return 0;
  const byDie = !!random.pick && (typeof random.pick === "object");
  const most = Math.min(byDie ? Math.max(random.pick.dice ?? 1, 1) : Math.max(Math.floor(Number(random.pick) || 1), 1), listed);
  return (byDie ? 1 : 0) + most + ((random.amount && (typeof random.amount === "object")) ? most : 0);
}

/**
 * What a change does whose stats dice pick: so many of the stats it lists, each raised by its amount. How many
 * and by how much are plain numbers, or dice of so many faces.
 * @param {{stats: string[], pick?: number|{dice: number}, amount?: number|{dice: number}}} random
 * @param {(faces: number) => number} die     Rolls a die of so many faces: a whole number from 1 to that
 * @returns {{effects: object[], stats: string[]}}    The effects, in the notation of skill effects, and the
 *                                                    stats that were picked, in the order they are listed
 */
export function randomEffects(random, die) {
  const listed = [...new Set(random?.stats ?? [])];
  if ( !listed.length ) return { effects: [], stats: [] };
  const number = (value, least) => {
    if ( value && (typeof value === "object") ) return die(Math.max(Math.floor(Number(value.dice) || 1), 1));
    return Math.max(Math.floor(Number(value) || least), least);
  };
  const count = Math.min(number(random.pick, 1), listed.length);
  const open = [...listed];
  const gains = {};
  for ( let n = 0; n < count; n++ ) {
    const key = open.splice(die(open.length) - 1, 1)[0];
    gains[key] = (random.amount && (typeof random.amount === "object")) ? number(random.amount, 1) : (Number(random.amount) || 0);
  }
  const stats = listed.filter((key) => gains[key]);
  return { effects: stats.length ? [{ stats: Object.fromEntries(stats.map((key) => [key, gains[key]])) }] : [], stats };
}

/**
 * A die of so many faces read from a d100, as a fight and a moment of a turn roll theirs.
 * @param {() => number} d100       Returns a whole number from 1 to 100
 * @returns {(faces: number) => number}
 */
export function dieFrom(d100) {
  return (faces) => Math.min(Math.floor(((d100() - 1) * faces) / 100), faces - 1) + 1;
}

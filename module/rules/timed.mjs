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
 *     ends: "turnEnd",                  // the moment of a turn it ends at: "turnStart", "turnEnd", or "map"
 *     turns: 2,                         // how many of those moments it takes; 1 unless given. "condition",
 *                                       // where a condition is inflicted: as long as that condition lasts
 *     now: true,                        // granted in a fight, what it adds to the damage its unit takes
 *                                       // also counts for the rest of that fight
 *     next: true,                       // not counting the turn the unit whose turns count is in right now
 *     clock: "giver",                   // whose turns count: those of the unit that carries it, unless the
 *                                       // unit that grants it is named
 *     max: 3,                           // granted again it grows by one, up to this many times over; without
 *                                       // `max` it is only renewed
 *     stacks: 3, fades: true            // it starts this many times over, and loses one each time its
 *   }                                   // moment comes instead of ending at once
 *
 * @import {SkillEntry} from "./skills.mjs"
 */

/**
 * @typedef TimedChange
 * @property {string} name            The skill it comes from, or what the skill calls it
 * @property {string} from            The unit that granted it; empty for the unit's own
 * @property {object[]} effects       What it does, in the notation of skill effects
 * @property {"turnStart"|"turnEnd"|"map"} ends
 * @property {number} turns           How many of those moments are still to come
 * @property {string} clock           The unit whose turns count, by its UUID; empty for the unit itself
 * @property {number} stacks          How many times over it applies
 * @property {number} max             The most it can grow to; 0 for one that does not grow
 * @property {boolean} fades          Does it lose one of its `stacks` at its moment, instead of ending?
 */

/** The moments a lasting change can end at. One that ends with the map stays until a new battle begins. */
export const TIMED_ENDS = ["turnStart", "turnEnd", "map"];

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
 * A unit's lasting changes as skill entries. One that applies several times over has its numbers multiplied.
 * One that another unit left on it is `foreign`, which is what makes its penalties incoming ones.
 * @param {TimedChange[]} [changes]
 * @returns {(SkillEntry & {timed: true, foreign: boolean})[]}
 */
export function timedEntries(changes) {
  return (changes ?? []).filter((change) => (change.stacks ?? 1) > 0).map((change) => ({
    name: timedName(change),
    timed: true,
    foreign: !!change.from,
    nihil: false,
    effects: (change.effects ?? []).map((effect) => ((change.stacks ?? 1) > 1) ? { ...effect, scale: change.stacks } : effect)
  }));
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
  return {
    name: grant.name ?? skill,
    from: own ? "" : from,
    effects: grant.effects ?? [],
    ends,
    turns: (ends === "map") ? 0 : Math.max(grant.turns ?? 1, 1) + ((grant.next && inTurn && (ends === "turnEnd")) ? 1 : 0),
    clock: byGiver ? giver : "",
    stacks: Math.max(grant.stacks ?? 1, 1),
    max: Math.max(grant.max ?? 0, 0),
    fades: !!grant.fades
  };
}

/* -------------------------------------------- */

/**
 * Give a unit a lasting change. One it already carries, by the same name from the same unit, is renewed; one
 * that can grow grows by one as well, up to its limit.
 * @param {TimedChange[]} [list]      What the unit carries
 * @param {TimedChange} change
 * @returns {{list: TimedChange[], change: TimedChange, renewed: boolean}}    The new list, and the change as
 *                                                                           the unit now carries it
 */
export function grantChange(list, change) {
  const carried = [...(list ?? [])];
  const index = carried.findIndex((entry) => (entry.name === change.name) && ((entry.from ?? "") === (change.from ?? "")));
  if ( index < 0 ) {
    carried.push({ ...change });
    return { list: carried, change: carried.at(-1), renewed: false };
  }
  const stacks = (change.max > 0) ? Math.min((carried[index].stacks ?? 1) + 1, change.max) : change.stacks;
  carried[index] = { ...change, stacks };
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
 * Check a lasting change that is about to be saved, so that nothing but a sensible one is.
 * @param {object} change
 * @param {(effects: object[]) => string[]} checkEffects    Finds what is wrong with a list of effects
 * @returns {TimedChange|null}    The change with nothing else on it, or null when it is not one
 */
export function cleanChange(change, checkEffects) {
  const count = (value, max = 99) => Number.isInteger(value) && (value >= 0) && (value <= max);
  const text = (value) => (typeof value === "string") && (value.length <= 200);
  if ( !change || !text(change.name) || !change.name || !text(change.from ?? "") || !text(change.clock ?? "") ) return null;
  if ( !TIMED_ENDS.includes(change.ends) || !count(change.turns) || !count(change.stacks) || !count(change.max) ) return null;
  if ( !Array.isArray(change.effects) || (change.effects.length > 20) || checkEffects(change.effects).length ) return null;
  if ( change.effects.some((effect) => effect.proc || effect.aura || effect.grant) ) return null;
  return {
    name: change.name,
    from: change.from ?? "",
    effects: change.effects,
    ends: change.ends,
    turns: change.turns,
    clock: change.clock ?? "",
    stacks: change.stacks,
    max: change.max,
    fades: !!change.fades
  };
}

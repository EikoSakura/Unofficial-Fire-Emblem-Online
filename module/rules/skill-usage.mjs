/**
 * Skills a unit chooses when to activate: whether one can be used now, what using it costs, and how cooldowns
 * and limited uses come back. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill says how it is used:
 *
 *   usage: {
 *     kind: "declare",     // switched on before a fight and spent by it; "toggle" for one that stays on until
 *                          // it is switched off; "action" for one that is used on the spot; "auto" for one
 *                          // that takes effect by itself when its moment of a fight comes, and is spent by that
 *     cooldown: 3,         // turns it cannot be used again once spent
 *     lasts: 1,            // of the unit's turn starts it stays on once spent; 0 for only the fight or the moment
 *     uses: 2,             // how often it can be spent, 0 for no limit ...
 *     per: "map",          // ... until this comes round: "turn" or "map"
 *     free: true,          // for an action: using it is not the unit's Action, which it still has
 *     unmoved: true,       // for an action: it is used before the unit moves, not after
 *     early: { condition: "burn", turns: 1 },    // it may be used while on cooldown, at a penalty: its effects
 *                          // marked `when: { early: true }` apply in place of those marked `early: false`,
 *                          // its unit is given this condition, and its cooldown starts anew
 *     over: { cooldown: 3 }                      // it may be used beyond the uses it has: its effects marked
 *                          // `when: { over: true }` apply then, in place of those marked `over: false`, and
 *                          // each such use starts this cooldown, which the uses it has do not
 *   }
 *
 * and keeps where it stands:
 *
 *   state: {
 *     active: false,       // switched on, so that effects with `when: { declared: true }` apply
 *     cooldown: 0,         // of the unit's turn starts until it can be used again
 *     lasting: 0,          // of the unit's turn starts until it switches itself off; 0 for no end
 *     used: 0,             // times it was spent since its uses last came back
 *     early: false,        // was it last used before its cooldown was over?
 *     picked: { dodge: 2, stat: "spd" }    // what its unit picked for a fight (see `choices.mjs`): the steps
 *                          // of a trade or of something spent, by the id of that part, and a stat
 *   }
 */
import { FEO } from "../config.mjs";

/** The ways a skill can be used. */
export const USAGE_KINDS = ["declare", "toggle", "action", "auto"];

/** What limited uses can be counted per. */
export const USAGE_PERIODS = ["turn", "map"];

const EMPTY = { active: false, cooldown: 0, lasting: 0, used: 0 };

/**
 * A skill's state with every part present.
 * @param {object} [state]
 * @returns {{active: boolean, cooldown: number, lasting: number, used: number}}
 */
function whole(state) {
  return { ...EMPTY, ...(state ?? {}) };
}

/* -------------------------------------------- */

/**
 * Can a skill be spent now? One that may be used early can be while it is on cooldown, once what it did has
 * ended: the answer then says `early`.
 * @param {object} usage
 * @param {object} state
 * @returns {{ok: boolean, reason: "cooldown"|"uses"|null, early?: boolean}}
 */
export function canUse(usage, state) {
  const now = whole(state);
  const early = (now.cooldown > 0) && !!usage?.early && !now.active;
  if ( (now.cooldown > 0) && !early ) return { ok: false, reason: "cooldown" };
  if ( usedUp(usage, now) ) return usage.over ? { ok: true, reason: null, over: true } : { ok: false, reason: "uses" };
  return early ? { ok: true, reason: null, early: true } : { ok: true, reason: null };
}

/* -------------------------------------------- */

/**
 * Has a skill spent the uses it has? One that may be used beyond them is used "over" from then on, until its
 * uses come back.
 * @param {object} usage
 * @param {object} state
 * @returns {boolean}
 */
export function usedUp(usage, state) {
  return (usage?.uses > 0) && (whole(state).used >= usage.uses);
}

/* -------------------------------------------- */

/**
 * How often a skill can still be spent right now, for one that takes effect by itself: none while it is on
 * cooldown or out of uses, once at a time for one with a cooldown, and otherwise as many times as it has uses
 * left.
 * @param {object} usage
 * @param {object} state
 * @returns {number|null}     Null for a skill without a limit
 */
export function usesLeft(usage, state) {
  const now = whole(state);
  if ( now.cooldown > 0 ) return 0;
  const left = (usage?.uses > 0) ? Math.max(usage.uses - now.used, 0) : null;
  if ( usage?.cooldown > 0 ) return (left === 0) ? 0 : 1;
  return left;
}

/* -------------------------------------------- */

/**
 * The turns a skill on cooldown still has to sit out after the current one. A cooldown is kept as the number
 * of turn starts until the skill is ready, which is that many and the turns the configuration adds.
 * @param {object} state
 * @returns {number}
 */
export function turnsToSitOut(state) {
  return Math.max(whole(state).cooldown - FEO.skillUse.cooldownExtra, 0);
}

/* -------------------------------------------- */

/**
 * Switch a skill on or off by hand. A skill that is declared can only be switched on while it can be spent;
 * switching anything off is always possible.
 * @param {object} usage
 * @param {object} state
 * @param {boolean} [on]      Defaults to the opposite of what it is
 * @returns {{state: object, ok: boolean, reason: string|null}}
 */
export function switchSkill(usage, state, on = !whole(state).active) {
  const now = whole(state);
  if ( !on ) return { state: { ...now, active: false, lasting: 0 }, ok: true, reason: null };
  if ( usage?.kind === "declare" ) {
    const able = canUse(usage, now);
    if ( !able.ok ) return { state: now, ...able };
  }
  return { state: { ...now, active: true }, ok: true, reason: null };
}

/* -------------------------------------------- */

/**
 * Spend a skill: its cooldown starts, a use is counted, and it stays on for as long as it lasts.
 * @param {object} usage
 * @param {object} state
 * @param {object} [options]
 * @param {boolean} [options.early]   Is it used before its cooldown is over, as `canUse` said it may be?
 * @param {number} [options.cooldowns]    Turns its unit's skills add to every cooldown, which may be less
 *                                        than none; a cooldown is never shorter than no turn at all
 * @returns {object}    The state afterwards
 */
export function spendSkill(usage, state, { early = false, cooldowns = 0 } = {}) {
  const now = whole(state);
  const lasts = Math.max(usage?.lasts ?? 0, 0);

  // A use beyond those the skill has starts the cooldown such a use has
  const turns = (usage?.over && usedUp(usage, now)) ? (usage.over.cooldown ?? 0) : (usage?.cooldown ?? 0);
  const spent = {
    active: lasts > 0,
    lasting: lasts,
    cooldown: (turns > 0) ? Math.max(turns + (cooldowns || 0), 0) + FEO.skillUse.cooldownExtra : now.cooldown,
    used: (usage?.uses > 0) ? now.used + 1 : now.used
  };
  if ( usage?.early ) spent.early = !!early;
  return spent;
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: cooldowns run down, skills that last a number of turns may end, and uses counted per
 * turn come back.
 * @param {object} usage
 * @param {object} state
 * @returns {{state: object, changed: boolean, ready: boolean, ended: boolean}}
 */
export function tickSkill(usage, state) {
  const now = whole(state);
  const next = { ...now };
  let ready = false;
  let ended = false;
  if ( now.cooldown > 0 ) {
    next.cooldown = now.cooldown - 1;
    ready = next.cooldown === 0;
  }
  if ( now.lasting > 0 ) {
    next.lasting = now.lasting - 1;
    if ( next.lasting === 0 ) {
      next.active = false;
      if ( now.early ) next.early = false;
      ended = true;
    }
  }
  if ( (usage?.per === "turn") && (now.used > 0) ) next.used = 0;
  const changed = Object.keys(next).some((key) => next[key] !== now[key]);
  return { state: next, changed, ready, ended };
}

/* -------------------------------------------- */

/**
 * A new map begins: every use and cooldown comes back, and what was declared or lasting is over. A skill that
 * is simply switched on stays on.
 * @param {object} usage
 * @param {object} state
 * @returns {{state: object, changed: boolean}}
 */
export function resetSkill(usage, state) {
  const now = whole(state);
  const next = { ...now, cooldown: 0, lasting: 0, used: 0, active: (usage?.kind === "toggle") ? now.active : false };
  if ( now.early ) next.early = false;
  return { state: next, changed: Object.keys(next).some((key) => next[key] !== now[key]) };
}

/* -------------------------------------------- */

/**
 * Check how a skill says it is used, so that a typing mistake does not pass silently.
 * @param {object} [usage]
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkUsage(usage) {
  if ( usage === undefined ) return [];
  const problems = [];
  if ( !usage || (typeof usage !== "object") ) return ["usage must be an object"];
  for ( const key of Object.keys(usage) ) {
    if ( !["kind", "cooldown", "lasts", "uses", "per", "free", "unmoved", "early", "over"].includes(key) ) problems.push(`usage: unknown part "${key}"`);
  }
  if ( usage.over !== undefined ) {
    const over = usage.over;
    if ( !over || (typeof over !== "object") || Object.keys(over).some((key) => key !== "cooldown") || !Number.isInteger(over.cooldown) || (over.cooldown < 0) ) {
      problems.push("usage: over names the cooldown of a use beyond the uses the skill has");
    }
    if ( !(usage.uses > 0) ) problems.push("usage: only a skill with limited uses can be used over them");
  }
  for ( const key of ["free", "unmoved"] ) {
    if ( usage[key] === undefined ) continue;
    if ( usage[key] !== true ) problems.push(`usage: ${key} is true or left out`);
    if ( usage.kind !== "action" ) problems.push(`usage: ${key} is for a skill used as an action`);
  }
  if ( usage.early !== undefined ) {
    const early = usage.early;
    if ( !early || (typeof early !== "object") || Object.keys(early).some((key) => !["condition", "turns"].includes(key)) ) {
      problems.push("usage: early names a condition and its turns, or nothing");
    }
    else {
      if ( (early.condition !== undefined) && !(early.condition in FEO.conditions) ) problems.push(`usage: unknown condition "${early.condition}"`);
      if ( (early.turns !== undefined) && !(Number.isInteger(early.turns) && (early.turns >= 1)) ) problems.push("usage: the turns of an early use are a whole number");
    }
    if ( !(usage.cooldown > 0) ) problems.push("usage: only a skill with a cooldown can be used early");
  }
  if ( !USAGE_KINDS.includes(usage.kind) ) problems.push(`usage: unknown kind "${usage.kind}"`);
  for ( const key of ["cooldown", "lasts", "uses"] ) {
    if ( (usage[key] !== undefined) && (!Number.isInteger(usage[key]) || (usage[key] < 0)) ) problems.push(`usage: ${key} must be a whole number`);
  }
  if ( (usage.per !== undefined) && !USAGE_PERIODS.includes(usage.per) ) problems.push(`usage: unknown period "${usage.per}"`);
  if ( (usage.per !== undefined) !== (usage.uses > 0) ) problems.push("usage: uses and their period go together");
  return problems;
}

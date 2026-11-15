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
 *     per: "map"           // ... until this comes round: "turn" or "map"
 *   }
 *
 * and keeps where it stands:
 *
 *   state: {
 *     active: false,       // switched on, so that effects with `when: { declared: true }` apply
 *     cooldown: 0,         // of the unit's turn starts until it can be used again
 *     lasting: 0,          // of the unit's turn starts until it switches itself off; 0 for no end
 *     used: 0              // times it was spent since its uses last came back
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
 * Can a skill be spent now?
 * @param {object} usage
 * @param {object} state
 * @returns {{ok: boolean, reason: "cooldown"|"uses"|null}}
 */
export function canUse(usage, state) {
  const now = whole(state);
  if ( now.cooldown > 0 ) return { ok: false, reason: "cooldown" };
  if ( (usage?.uses > 0) && (now.used >= usage.uses) ) return { ok: false, reason: "uses" };
  return { ok: true, reason: null };
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
 * @returns {object}    The state afterwards
 */
export function spendSkill(usage, state) {
  const now = whole(state);
  const lasts = Math.max(usage?.lasts ?? 0, 0);
  return {
    active: lasts > 0,
    lasting: lasts,
    cooldown: (usage?.cooldown > 0) ? usage.cooldown + FEO.skillUse.cooldownExtra : now.cooldown,
    used: (usage?.uses > 0) ? now.used + 1 : now.used
  };
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
    if ( !["kind", "cooldown", "lasts", "uses", "per"].includes(key) ) problems.push(`usage: unknown part "${key}"`);
  }
  if ( !USAGE_KINDS.includes(usage.kind) ) problems.push(`usage: unknown kind "${usage.kind}"`);
  for ( const key of ["cooldown", "lasts", "uses"] ) {
    if ( (usage[key] !== undefined) && (!Number.isInteger(usage[key]) || (usage[key] < 0)) ) problems.push(`usage: ${key} must be a whole number`);
  }
  if ( (usage.per !== undefined) && !USAGE_PERIODS.includes(usage.per) ) problems.push(`usage: unknown period "${usage.per}"`);
  if ( (usage.per !== undefined) !== (usage.uses > 0) ) problems.push("usage: uses and their period go together");
  return problems;
}

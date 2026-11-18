/**
 * Moving again after an Action, as Canto has it: a unit that has attacked, used a staff, or done whatever else
 * its skill lists keeps the movement it has not spent, and may move once more before its turn ends. Pure
 * functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill grants such a move with a `canto` part among its effects (see `skills.mjs`), which is always there:
 *
 *   canto: { after: ["attack"] }                      // it may move the rest of its movement after attacking
 *   canto: { after: ["attack", "staff", "item"] }     // after any of these Actions (see `CANTO_ACTIONS`)
 *   canto: { after: "any", not: ["attack"] }          // after every Action but those left out
 *   canto: { after: [...], except: ["Hold"] }         // skills used as an Action that it does not follow, by name,
 *                                                     // or by the name of a state they have their unit enter
 *   canto: { after: ["attack"], mov: "full" }         // the move is of its whole MOV, whatever it has spent
 *   canto: { after: "any", spaces: 1 }                // the move is of so many spaces, whatever it has spent
 *                                                     // and whatever the ground takes: onto any tile it can
 *                                                     // stand on that near
 *
 * or at the one moment of a fight that can bring it about, for the unit that started the fight:
 *
 *   { proc: { on: "after", stat: "dex", div: 2 }, canto: { mov: "full", recover: 1 } }
 *                                                     // `recover`: HP it regains for each space of that move
 *
 * Other skills bend whatever move is granted, and grant none themselves:
 *
 *   canto: { gear: true }                             // it may change the weapon it holds while it moves again
 *   canto: { crossing: { free: ["forest"] } }         // how it crosses terrain on that move alone (see
 *                                                     // `terrain.mjs` for what a `crossing` can say)
 *
 * and a skill of an enemy curbs it:
 *
 *   curbsCanto: { halve: 3, forbid: 1 }               // enemies within 3 spaces have the movement of such a
 *                                                     // move halved, and those within 1 space make none
 *
 * Waiting is no Action that a move follows. The spaces moved this way are counted apart from the rest of the
 * turn's movement, and can be read as a number: `{ of: "cantoSpaces", times: 2 }` (see `movement.mjs`).
 *
 * A later step that grants a move after an Action by other means (another Action, a step after combat) hands
 * `moveAfter` a grant of its own in `grants`, built with `cantoGrant`, and gets the same state back.
 */
import { FEO } from "../config.mjs";
import { addCrossing, checkCrossing, emptyCrossing } from "./terrain.mjs";

/**
 * The Actions a move can follow, as the rulebook lists them for Canto+. An Action of another kind is "other",
 * which only a skill that follows "any" Action answers.
 */
export const CANTO_ACTIONS = ["attack", "staff", "item", "trade", "rescue", "refresh", "skill", "shift", "object", "visit", "arrive", "seize"];

/** What the `canto` part of an effect can say, and the `curbsCanto` part. */
export const CANTO_PARTS = ["after", "not", "except", "mov", "spaces", "gear", "crossing", "recover"];
export const CURB_PARTS = ["halve", "forbid"];

/**
 * @typedef CantoGrant
 * One skill's leave to move again.
 * @property {string} skill               The skill that grants it
 * @property {string[]|"any"} after       The Actions it follows
 * @property {string[]} not               Actions it does not follow, where it follows "any"
 * @property {string[]} except            Skills used as an Action that it does not follow, by name
 * @property {boolean} full               Is the move of the unit's whole MOV, whatever it has spent?
 * @property {number} spaces              The spaces the move is of, whatever it has spent and whatever the
 *                                        ground takes; 0 for a move that is counted from its MOV
 * @property {number} recover             HP the unit regains for each space of the move
 *
 * @typedef Canto
 * What a unit's skills make of moving again after an Action, added up.
 * @property {CantoGrant[]} grants        Each skill's leave to
 * @property {boolean} gear               May it change the weapon it holds while it moves again?
 * @property {import("./terrain.mjs").Crossing|null} crossing
 *                                        How it crosses terrain on that move alone
 * @property {{halve: number, forbid: number, skill: string}|null} curbs
 *                                        How it curbs such moves of its enemies: within so many spaces their
 *                                        movement is halved, and within so many they make none
 *
 * @typedef MoveAgain
 * The move a unit may make after its Action.
 * @property {string} skill               The skill that grants it
 * @property {number} mov                 The movement it has for it
 * @property {boolean} full               Was that counted from its whole MOV?
 * @property {boolean} gear               May it change the weapon it holds meanwhile?
 * @property {import("./terrain.mjs").Crossing|null} crossing
 *                                        How it crosses terrain on this move alone
 * @property {number} recover             HP it regains for each space of the move
 * @property {string} curbed              The enemy skill that halved its movement; blank for none
 */

/* -------------------------------------------- */
/*  Adding Up                                   */
/* -------------------------------------------- */

/**
 * Nothing that has a unit move again, and nothing that curbs it.
 * @returns {Canto}
 */
export function emptyCanto() {
  return { grants: [], gear: false, crossing: null, curbs: null };
}

/* -------------------------------------------- */

/**
 * One skill's leave to move again, from the `canto` part of its effect. A part that names no Actions, as one
 * that comes about at a moment of a fight, follows whatever Action brought it about.
 * @param {string} skill
 * @param {object} [part]
 * @returns {CantoGrant}
 */
export function cantoGrant(skill, part = {}) {
  return {
    skill,
    after: Array.isArray(part.after) ? [...part.after] : "any",
    not: Array.isArray(part.not) ? [...part.not] : [],
    except: Array.isArray(part.except) ? [...part.except] : [],
    full: part.mov === "full",
    spaces: Math.max(Math.floor(Number(part.spaces)) || 0, 0),
    recover: Math.max(Number(part.recover) || 0, 0)
  };
}

/* -------------------------------------------- */

/**
 * Add what one skill effect makes of moving again to what the others do.
 * @param {Canto} total
 * @param {object} [part]             The `canto` part of an effect
 * @param {object} [options]
 * @param {string} [options.skill]    The skill it belongs to
 * @returns {Canto}                   The total, changed
 */
export function addCanto(total, part, { skill = "" } = {}) {
  if ( !part || (typeof part !== "object") ) return total;
  if ( part.after !== undefined ) total.grants.push(cantoGrant(skill, part));
  if ( part.gear ) total.gear = true;
  if ( part.crossing ) total.crossing = addCrossing(total.crossing ?? emptyCrossing(), part.crossing);
  return total;
}

/* -------------------------------------------- */

/**
 * Add how one skill effect curbs the moves enemies make after their Actions to what the others do: the widest
 * reach of each counts.
 * @param {Canto} total
 * @param {object} [part]             The `curbsCanto` part of an effect
 * @param {object} [options]
 * @param {string} [options.skill]    The skill it belongs to
 * @returns {Canto}                   The total, changed
 */
export function addCurb(total, part, { skill = "" } = {}) {
  if ( !part || (typeof part !== "object") ) return total;
  const curbs = total.curbs ?? { halve: 0, forbid: 0, skill };
  curbs.halve = Math.max(curbs.halve, Number(part.halve) || 0);
  curbs.forbid = Math.max(curbs.forbid, Number(part.forbid) || 0);
  total.curbs = curbs;
  return total;
}

/* -------------------------------------------- */

/**
 * Two ways of crossing terrain as one: whatever either opens or eases.
 * @param {import("./terrain.mjs").Crossing|null} [own]       How the unit crosses terrain at all times
 * @param {import("./terrain.mjs").Crossing|null} [extra]     How it does on the move at hand
 * @returns {import("./terrain.mjs").Crossing|null}           Null when neither changes anything
 */
export function mergeCrossing(own = null, extra = null) {
  if ( !extra ) return own ?? null;
  const total = emptyCrossing();
  for ( const crossing of [own, extra] ) {
    if ( !crossing ) continue;
    addCrossing(total, {
      kinds: crossing.kinds ?? [],
      cost: crossing.cost ?? {},
      free: crossing.all ? "all" : (crossing.free ?? []),
      flier: !!crossing.flier,
      steady: !!crossing.steady,
      phase: crossing.phase ?? undefined
    });
  }
  return total;
}

/* -------------------------------------------- */
/*  Moving Again                                */
/* -------------------------------------------- */

/**
 * Does a skill's leave to move again follow an Action? Waiting is never followed by a move.
 * @param {CantoGrant} grant
 * @param {{kind: string, name?: string}} action      The Action taken: a key of `CANTO_ACTIONS`, or "other";
 *                                                    for a skill used as an Action, its name
 * @returns {boolean}
 */
export function follows(grant, action) {
  const kind = action?.kind ?? "other";
  if ( kind === "wait" ) return false;
  if ( grant.after === "any" ) {
    if ( grant.not.includes(kind) ) return false;
  }
  else if ( !grant.after.includes(kind) ) return false;
  if ( kind === "skill" ) {
    // A skill is excepted by its name, or by the name of a state it has its unit enter (see `stances.mjs`)
    const names = [action.name, ...(action.states ?? [])].map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean);
    if ( grant.except.some((skill) => names.includes(String(skill).trim().toLowerCase())) ) return false;
  }
  return true;
}

/* -------------------------------------------- */

/**
 * How the enemies around a unit curb the move it would make after its Action.
 * @param {{distance: number, curbs: {halve: number, forbid: number, skill?: string}|null}[]} [foes]
 *        Its enemies that still stand, each with how far away it is and how its skills curb such moves
 * @returns {{forbidden: boolean, halved: boolean, skill: string}}    `skill` names the skill that does
 */
export function curbOf(foes = []) {
  const found = { forbidden: false, halved: false, skill: "" };
  for ( const foe of foes ?? [] ) {
    const curbs = foe?.curbs;
    if ( !curbs || !Number.isFinite(foe.distance) ) continue;
    if ( (curbs.forbid > 0) && (foe.distance <= curbs.forbid) ) return { forbidden: true, halved: false, skill: curbs.skill ?? "" };
    if ( (curbs.halve > 0) && (foe.distance <= curbs.halve) && !found.halved ) Object.assign(found, { halved: true, skill: curbs.skill ?? "" });
  }
  return found;
}

/* -------------------------------------------- */

/**
 * The move a unit may make after an Action it has just taken, if its skills grant it one: the one that leaves
 * it the most movement. A unit that cannot move, or that an enemy keeps from it, makes none.
 * @param {Canto|null} canto                  What its skills make of moving again
 * @param {{kind: string, name?: string}} action      The Action it took
 * @param {object} [options]
 * @param {number} [options.mov]              Its MOV as it is now: nothing for a unit that is down or held in place
 * @param {number} [options.spent]            The movement it has spent this turn
 * @param {CantoGrant[]} [options.grants]     Leave to move that the Action itself brought about, as a fight's
 *                                            moment may, whatever the Action was
 * @param {{distance: number, curbs: object|null}[]} [options.foes]   Its enemies that still stand
 * @returns {MoveAgain|null}
 */
export function moveAfter(canto, action, { mov = 0, spent = 0, grants = [], foes = [] } = {}) {
  if ( (action?.kind ?? "other") === "wait" ) return null;
  const total = Math.max(Math.floor(Number(mov)) || 0, 0);
  if ( total <= 0 ) return null;
  const allowed = [...(canto?.grants ?? []).filter((grant) => follows(grant, action)), ...(grants ?? [])];
  if ( !allowed.length ) return null;
  const curb = curbOf(foes);
  if ( curb.forbidden ) return null;
  const left = Math.max(total - Math.max(Number(spent) || 0, 0), 0);
  let best = null;
  for ( const grant of allowed ) {
    // A move of so many spaces is that, whatever the unit has spent; an enemy that halves such moves leaves
    // a move of one space none
    const whole = (grant.spaces > 0) ? grant.spaces : grant.full ? total : left;
    const budget = curb.halved ? Math.floor(whole / 2) : Math.floor(whole);
    if ( (budget > 0) && (!best || (budget > best.mov) || ((budget === best.mov) && (grant.recover > best.recover))) ) {
      best = { skill: grant.skill, mov: budget, full: !!grant.full, recover: grant.recover ?? 0, spaces: grant.spaces > 0 };
    }
  }
  if ( !best ) return null;

  // On a move of so many spaces every tile the unit can cross takes one
  const { spaces, ...move } = best;
  const crossing = spaces ? mergeCrossing(canto?.crossing ?? null, { ...emptyCrossing(), all: true }) : (canto?.crossing ?? null);
  return { ...move, gear: !!canto?.gear, crossing, curbed: curb.halved ? curb.skill : "" };
}

/* -------------------------------------------- */

/**
 * What a turn's movement comes to once a unit has moved again: the move it made before its Action and the one
 * after it, as one.
 * @param {{spaces?: number, cost?: number, passed?: string[]}|null} [base]     Its movement before its Action
 * @param {{spaces?: number, cost?: number, passed?: string[]}|null} [walk]     The move made after it
 * @returns {{spaces: number, cost: number, passed: string[], canto: number}}   `canto`: the spaces of the second
 */
export function joinWalks(base = null, walk = null) {
  const again = Math.max(walk?.spaces ?? 0, 0);
  return {
    spaces: Math.max(base?.spaces ?? 0, 0) + again,
    cost: Math.max(base?.cost ?? 0, 0) + Math.max(walk?.cost ?? 0, 0),
    passed: [...new Set([...(base?.passed ?? []), ...(walk?.passed ?? [])])],
    canto: again
  };
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check the `canto` part of a skill effect, so that a typing mistake does not pass silently.
 * @param {object} part
 * @param {object} [options]
 * @param {boolean} [options.moment]    Does it come about at a moment of a fight, which then names no Actions?
 * @returns {string[]}                  What is wrong, in plain words; empty when nothing is
 */
export function checkCanto(part, { moment = false } = {}) {
  const problems = [];
  if ( !part || (typeof part !== "object") || (!moment && !Object.keys(part).length) ) return ["canto must say when the unit moves again, or what changes about it"];
  for ( const key of Object.keys(part) ) if ( !CANTO_PARTS.includes(key) ) problems.push(`canto cannot say "${key}"`);
  const actions = (list, what) => {
    if ( !Array.isArray(list) || !list.length ) return problems.push(`canto: "${what}" lists Actions`);
    for ( const kind of list ) if ( !CANTO_ACTIONS.includes(kind) ) problems.push(`canto: unknown Action "${kind}"`);
    return null;
  };
  if ( moment ) {
    for ( const key of ["after", "not", "except", "gear", "crossing"] ) {
      if ( part[key] !== undefined ) problems.push(`canto: at a moment of a fight it cannot say "${key}"`);
    }
  }
  else {
    if ( (part.after !== undefined) && (part.after !== "any") ) actions(part.after, "after");
    if ( part.after === undefined ) {
      const loose = ["not", "except", "mov", "spaces", "recover"].filter((key) => part[key] !== undefined);
      for ( const key of loose ) problems.push(`canto: "${key}" needs the Actions it comes "after"`);
      if ( !loose.length && (part.gear === undefined) && (part.crossing === undefined) ) {
        problems.push("canto must say when the unit moves again, or what changes about it");
      }
    }
    if ( part.not !== undefined ) {
      if ( part.after !== "any" ) problems.push('canto: "not" leaves Actions out of "any"');
      actions(part.not, "not");
    }
    if ( (part.except !== undefined) && !(Array.isArray(part.except) && part.except.length && part.except.every((name) => (typeof name === "string") && name)) ) {
      problems.push('canto: "except" names skills used as an Action');
    }
    if ( (part.gear !== undefined) && (part.gear !== true) ) problems.push('canto: "gear" is true or left out');
    if ( part.crossing !== undefined ) for ( const problem of checkCrossing(part.crossing) ) problems.push(`canto: ${problem}`);
  }
  if ( (part.spaces !== undefined) && !(Number.isInteger(part.spaces) && (part.spaces >= 1) && (part.mov === undefined)) ) {
    problems.push('canto: "spaces" is a whole number of spaces, in place of "mov"');
  }
  if ( (part.mov !== undefined) && !["left", "full"].includes(part.mov) ) problems.push(`canto: the move is of the MOV "left" or of the "full" MOV, not "${part.mov}"`);
  if ( (part.recover !== undefined) && !(Number.isFinite(part.recover) && (part.recover > 0)) ) problems.push("canto: the HP regained for each space is a number above 0");
  return problems;
}

/* -------------------------------------------- */

/**
 * Check the `curbsCanto` part of a skill effect.
 * @param {object} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkCurb(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || !Object.keys(part).length ) return ["curbsCanto must say within how many spaces"];
  for ( const [key, value] of Object.entries(part) ) {
    if ( !CURB_PARTS.includes(key) ) problems.push(`curbsCanto cannot say "${key}"`);
    else if ( !Number.isInteger(value) || (value < 1) ) problems.push(`curbsCanto: "${key}" is a whole number of spaces from 1`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * What the rulebook calls Canto+, as the `canto` part that grants it: for what "gains the effect of Canto+"
 * without being the skill of that name.
 * @param {{after: string[], except: string[]}} [config]      FEO.cantoPlus
 * @returns {{after: string[], except: string[]}}
 */
export function cantoPlus(config = FEO.cantoPlus) {
  return { after: [...(config?.after ?? [])], except: [...(config?.except ?? [])] };
}

/* -------------------------------------------- */

/**
 * The effect of Canto+ as a skill of the unit that has it by other means, as a Laguz in its animal form does:
 * an entry the skill rules read like those of equipped skills, which Nihil does not cancel.
 * @param {string} name     What it goes by among the unit's skills
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}}
 */
export function cantoPlusEntry(name) {
  return { name, innate: true, nihil: false, effects: [{ canto: cantoPlus() }] };
}

/**
 * Acting again: a unit that earns another go in its turn, as Galeforce has it after a kill, is not spent once
 * its Action is taken. It is ready again from where it stands, and may be picked and used once more. Pure
 * functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill earns its unit such a go with an `acts` part in an effect that waits for a moment (see `skills.mjs`):
 *
 *   { proc: { on: "kill", sure: true }, acts: { mov: "full", once: "turn" } }
 *
 *   acts: {
 *     mov: "full",          // the movement of the go: its whole MOV anew ("full"), what it has not spent this
 *                           // turn ("left", which it is unless given), or none: it acts from where it stands
 *     bars: ["attack"],     // Actions it may not take in that go (see `CANTO_ACTIONS` in `canto.mjs`)
 *     once: "turn"          // it comes at most once a turn, or once a "map"; without it, as often as its
 *   }                       // moment does
 *
 * The moments that can earn one are those of a fight its unit started, for the Action that fight was: a "hit",
 * a "crit", a "kill", and "after" the fight; a "kill" by other means in its own turn; and one moment that is
 * only for this, "action": the unit has taken an Action of its turn, whatever it was but Waiting.
 *
 *   proc: { on: "action", sure: true }                  // after any Action
 *   proc: { on: "action", sure: true, after: ["staff"] }     // after the Actions named
 *   proc: { on: "action", stat: "luk", stars: true }    // rolled once for each Action; with `stars` the
 *                                                       // chance of the unit's Movement Stars is added, where
 *                                                       // the world plays with them
 *
 * Where several skills earn a go at once, one is given: the one that gives the most, and among equals the one
 * whose limit comes back soonest. The others are not used up, and may come at a later moment.
 *
 * The go is a part of the same turn. The turn does not start again, so nothing that counts turns moves: no
 * condition deals its damage or loses a turn, no cooldown runs down, no use per turn comes back, and no skill
 * has its moment at the start of a turn. The turn ends once, as the last go does. A go with its "full" movement
 * counts its movement anew from where the unit stands, as a turn does; one with what is "left" or none goes on
 * counting from where the turn began. The Action before it and the move before that stand.
 *
 * Two rules take something in return, and are read by the turn order:
 *
 *   rules: ["noTurn"]       // its unit loses its turn: as its side's Phase begins it has already acted
 *   rules: ["noRefresh"]    // its unit cannot be given its Action back by another unit, as Refresh does
 */
import { CANTO_ACTIONS } from "./canto.mjs";

/** How much movement a go can have. */
export const ACT_MOVES = ["full", "left", "none"];

/** What a go can be limited to. */
export const ACT_LIMITS = ["turn", "map"];

/** The moments that can earn a unit another go. */
export const ACT_MOMENTS = ["hit", "crit", "kill", "after", "action"];

/** The moment that is only for this: the unit has taken an Action of its turn. */
export const ACTION_MOMENT = "action";

/** What the `acts` part of an effect can say. */
export const ACT_PARTS = ["mov", "bars", "once"];

/** The rules that take a turn away, and that keep a unit from being given its Action back. */
export const NO_TURN = "noTurn";
export const NO_REFRESH = "noRefresh";

/**
 * @typedef ActGrant
 * One skill's leave to act again.
 * @property {string} skill                 The skill that earns it
 * @property {"full"|"left"|"none"} mov     The movement of the go
 * @property {string[]} bars                Actions the unit may not take in it
 * @property {"turn"|"map"|null} once       What it is limited to; null for no limit
 *
 * @typedef GoesUsed
 * The skills that have given a unit a go, by what their limit runs to.
 * @property {string[]} turn                This turn
 * @property {string[]} map                 On this map
 *
 * @typedef Go
 * The go a unit is on, beyond the first of its turn.
 * @property {string} skill                 The skill that earned it
 * @property {"full"|"left"|"none"} kind    The movement it came with
 * @property {number|null} mov              The movement it has for it; null for its whole MOV, as it is
 * @property {string[]} bars                Actions it may not take in it
 * @property {{spaces: number, cost: number, passed: string[], canto: number}|null} base
 *                                          What it had moved this turn as the go began, which the move of this
 *                                          go is added to; null for a go that counts its movement anew
 */

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * One skill's leave to act again, from the `acts` part of its effect.
 * @param {string} skill
 * @param {object} [part]
 * @returns {ActGrant}
 */
export function actGrant(skill, part = {}) {
  return {
    skill: String(skill ?? ""),
    mov: ACT_MOVES.includes(part?.mov) ? part.mov : "left",
    bars: Array.isArray(part?.bars) ? part.bars.filter((kind) => typeof kind === "string") : [],
    once: ACT_LIMITS.includes(part?.once) ? part.once : null
  };
}

/* -------------------------------------------- */

/**
 * Has a skill given all the goes its limit allows?
 * @param {ActGrant} grant
 * @param {GoesUsed} [used]
 * @returns {boolean}
 */
export function usedUp(grant, used = {}) {
  if ( !grant?.once ) return false;
  return (used?.[grant.once] ?? []).includes(grant.skill);
}

/* -------------------------------------------- */

/**
 * The skills whose limit is used up, among those that have given a unit a go: what a fight leaves out, so that
 * a skill is not said to take effect when it has nothing more to give.
 * @param {GoesUsed} [used]
 * @returns {string[]}
 */
export function spentGoes(used = {}) {
  return [...new Set([...(used?.turn ?? []), ...(used?.map ?? [])])];
}

/* -------------------------------------------- */

/**
 * How much a go gives, for telling which of several to take: movement first, then the Actions left open.
 * @param {ActGrant} grant
 * @returns {number}
 */
function worth(grant) {
  return (ACT_MOVES.length - ACT_MOVES.indexOf(grant.mov)) * 100 - (grant.bars.length * 10)
    + ((grant.once === null) ? 2 : (grant.once === "turn") ? 1 : 0);
}

/* -------------------------------------------- */

/**
 * The go a unit is given, of those its skills have earned it at once: the one that gives the most, and among
 * equals the one whose limit comes back soonest. A skill whose limit is used up gives none.
 * @param {ActGrant[]} [grants]
 * @param {GoesUsed} [used]
 * @returns {ActGrant|null}
 */
export function pickGo(grants = [], used = {}) {
  let best = null;
  for ( const grant of grants ?? [] ) {
    if ( !grant || usedUp(grant, used) ) continue;
    if ( !best || (worth(grant) > worth(best)) ) best = grant;
  }
  return best;
}

/* -------------------------------------------- */

/**
 * Count a go against its skill's limit.
 * @param {GoesUsed} [used]
 * @param {ActGrant} grant
 * @returns {GoesUsed}        What is used afterwards
 */
export function spendGo(used = {}, grant) {
  const next = { turn: [...(used?.turn ?? [])], map: [...(used?.map ?? [])] };
  if ( grant?.once && !next[grant.once].includes(grant.skill) ) next[grant.once].push(grant.skill);
  return next;
}

/* -------------------------------------------- */

/**
 * The go a unit is on once it is given one: the movement it has for it, and what it had moved before, where
 * the go goes on counting from where the turn began.
 * @param {ActGrant} grant
 * @param {object} [turn]
 * @param {number} [turn.mov]         Its MOV as it is now
 * @param {{spaces?: number, cost?: number, passed?: string[], canto?: number}|null} [turn.note]
 *                                    What it has moved this turn
 * @returns {Go}
 */
export function goFor(grant, { mov = 0, note = null } = {}) {
  const go = { skill: grant.skill, kind: grant.mov, mov: null, bars: [...grant.bars], base: null };
  if ( grant.mov === "full" ) return go;
  const cost = Math.max(note?.cost ?? 0, 0);
  go.base = {
    spaces: Math.max(note?.spaces ?? 0, 0),
    cost,
    passed: Array.isArray(note?.passed) ? [...note.passed] : [],
    canto: Math.max(note?.canto ?? 0, 0)
  };
  go.mov = (grant.mov === "none") ? 0 : Math.max(Math.floor((Number(mov) || 0) - cost), 0);
  return go;
}

/* -------------------------------------------- */

/**
 * What a turn's movement comes to on a go that goes on counting from where the turn began: what the unit had
 * moved before the go, and the move it makes in it, as one.
 * @param {{spaces?: number, cost?: number, passed?: string[], canto?: number}|null} [base]
 * @param {{spaces?: number, cost?: number, passed?: string[]}|null} [walk]     The move made in the go
 * @returns {{spaces: number, cost: number, passed: string[], canto: number}}
 */
export function walkOn(base = null, walk = null) {
  return {
    spaces: Math.max(base?.spaces ?? 0, 0) + Math.max(walk?.spaces ?? 0, 0),
    cost: Math.max(base?.cost ?? 0, 0) + Math.max(walk?.cost ?? 0, 0),
    passed: [...new Set([...(base?.passed ?? []), ...(walk?.passed ?? [])])],
    canto: Math.max(base?.canto ?? 0, 0)
  };
}

/* -------------------------------------------- */
/*  After an Action                             */
/* -------------------------------------------- */

/**
 * Does a moment that waits for an Action follow the one taken? Waiting is never followed by another go.
 * @param {{after?: string[]}} proc
 * @param {{kind: string, name?: string}} action
 * @returns {boolean}
 */
export function followsAction(proc, action) {
  const kind = action?.kind ?? "other";
  if ( kind === "wait" ) return false;
  return !Array.isArray(proc?.after) || proc.after.includes(kind);
}

/* -------------------------------------------- */

/**
 * The effects of a unit's skills that wait for it to take an Action, and may earn it another go for that.
 * @param {import("./skills.mjs").SkillEntry[]} skills
 * @param {{kind: string, name?: string}} action      The Action it took
 * @param {object} [options]
 * @param {GoesUsed} [options.used]                   The skills that have given it a go
 * @param {(when: object|undefined) => boolean} [options.holds]
 *                                                    Says whether an effect's condition holds for the unit
 * @returns {{skill: string, effect: object, grant: ActGrant, innate: boolean}[]}
 */
export function actionEffects(skills, action, { used = {}, holds = () => true } = {}) {
  const found = [];
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.proc?.on !== ACTION_MOMENT) || !effect.acts || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !followsAction(effect.proc, action) ) continue;
      const grant = actGrant(skill.name, effect.acts);
      if ( usedUp(grant, used) || !holds(effect.when) ) continue;
      found.push({ skill: skill.name, effect, grant, innate: !!skill.innate });
    }
  }

  // The chance of its Movement Stars is rolled by itself only where no skill has added it to its own
  const stacked = found.some((entry) => !entry.innate && entry.effect.proc.stars);
  return stacked ? found.filter((entry) => !(entry.innate && entry.effect.proc.stars)) : found;
}

/* -------------------------------------------- */

/**
 * A unit has taken an Action: the goes its skills earn it for that, each rolled for where it has a chance.
 * @param {{skill: string, effect: object, grant: ActGrant}[]} waiting      As `actionEffects` finds them
 * @param {(proc: object) => number} chanceOf         The chance of a moment for the unit, in percent
 * @param {() => number} [d100]                       Returns a whole number from 1 to 100
 * @param {object} [options]
 * @param {number} [options.stars]                    The chance of its Movement Stars, in percent
 * @returns {{grants: ActGrant[], rolls: {skill: string, roll: number|null, chance: number, success: boolean}[]}}
 */
export function actionGrants(waiting, chanceOf, d100 = () => 100, { stars = 0 } = {}) {
  const grants = [];
  const rolls = [];
  for ( const { skill, effect, grant } of waiting ?? [] ) {
    const proc = effect.proc;
    const chance = proc.sure ? 100 : Math.min(Math.max(chanceOf(proc) + (proc.stars ? Math.max(stars, 0) : 0), 0), 100);
    const roll = ((chance > 0) && (chance < 100)) ? d100() : null;
    const success = (chance >= 100) || ((roll !== null) && (roll <= chance));
    rolls.push({ skill, roll, chance, success });
    if ( success ) grants.push(grant);
  }
  return { grants, rolls };
}

/* -------------------------------------------- */

/**
 * The most d100s the goes a unit's skills may earn it for an Action can need.
 * @param {{effect: object}[]} waiting      As `actionEffects` finds them
 * @returns {number}
 */
export function actionDice(waiting) {
  return (waiting ?? []).filter(({ effect }) => !effect.proc.sure).length;
}

/* -------------------------------------------- */

/**
 * A unit's Movement Stars as a skill of its own, where the world plays with them: after each Action, a chance
 * of another go with its whole movement, as often as it comes.
 * @param {string} name     What it goes by
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}}
 */
export function starsEntry(name) {
  return {
    name,
    innate: true,
    nihil: false,
    effects: [{ proc: { on: ACTION_MOMENT, percent: 0, fixed: true, stars: true }, acts: { mov: "full" } }]
  };
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check the `acts` part of a skill effect and the moment it waits for, so that a typing mistake does not pass
 * silently.
 * @param {object} part
 * @param {object} [proc]       The moment the effect waits for
 * @returns {string[]}          What is wrong, in plain words; empty when nothing is
 */
export function checkActs(part, proc = null) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ["acts must say what the go comes with"];
  for ( const key of Object.keys(part) ) if ( !ACT_PARTS.includes(key) ) problems.push(`acts cannot say "${key}"`);
  if ( (part.mov !== undefined) && !ACT_MOVES.includes(part.mov) ) {
    problems.push(`acts: the go has its "full" MOV, what is "left" of it or "none", not "${part.mov}"`);
  }
  if ( part.bars !== undefined ) {
    if ( !Array.isArray(part.bars) || !part.bars.length ) problems.push('acts: "bars" lists Actions');
    else for ( const kind of part.bars ) if ( !CANTO_ACTIONS.includes(kind) ) problems.push(`acts: unknown Action "${kind}"`);
  }
  if ( (part.once !== undefined) && !ACT_LIMITS.includes(part.once) ) problems.push(`acts: once a "turn" or once a "map", not "${part.once}"`);
  if ( !proc || !ACT_MOMENTS.includes(proc.on) ) {
    problems.push(`acts: another go is earned on ${ACT_MOMENTS.map((moment) => `"${moment}"`).join(", ")}`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * Check what a moment that waits for an Action says of itself.
 * @param {object} proc
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkActionMoment(proc) {
  const problems = [];
  if ( proc?.after !== undefined ) {
    if ( proc.on !== ACTION_MOMENT ) problems.push('only an "action" names the Actions it comes "after"');
    else if ( !Array.isArray(proc.after) || !proc.after.length ) problems.push('an "action": "after" lists Actions');
    else for ( const kind of proc.after ) if ( !CANTO_ACTIONS.includes(kind) ) problems.push(`an "action": unknown Action "${kind}"`);
  }
  if ( proc?.stars !== undefined ) {
    if ( proc.on !== ACTION_MOMENT ) problems.push('only an "action" adds the chance of Movement Stars');
    else if ( proc.stars !== true ) problems.push('an "action": "stars" is true or left out');
    else if ( proc.sure ) problems.push('an "action" that is sure has no chance for Movement Stars to add to');
  }
  return problems;
}

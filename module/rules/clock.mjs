/**
 * The turn clock for Fire Emblem Online: the turn of the battle and the Phase that is running, as skills ask
 * for them. A battle counts its turns from 1, and a turn is over once every side has had its Phase. Pure
 * functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill asks the clock in a condition, and reads it wherever a number stands:
 *
 *   when: { turn: "odd" }               // the turn of the battle is odd-numbered; "even" for the others
 *   when: { turn: { min: 3, max: 6 } }  // or from one turn to another, either end left out
 *   when: { phase: ["enemy", "other"] } // the Phase that is running is one of these sides' (keys of FEO.armies)
 *   combat: { hit: { of: "turnsPast", times: -1, plus: 15, min: 0 } }
 *                                       // `turn` is the turn of the battle, `turnsPast` the turns that are over
 *                                       // since the map began: 15 on turn 1, one less each turn, never below 0
 *
 * Outside of a battle there is no turn and no Phase. A condition that asks for either then holds for nobody,
 * a number read from the clock is not read, and the skill is shown as one to check by hand, as a skill that
 * asks how its unit moved is.
 *
 * @typedef Clock
 * @property {number} turn      The turn of the battle, counted from 1
 * @property {string} phase     The side whose Phase is running
 */

/** The parts of a condition that ask the clock. */
export const CLOCK_KEYS = ["turn", "phase"];

/** What a number can be read from that hangs on the clock. */
export const CLOCK_SOURCES = ["turn", "turnsPast"];

/** What a turn can be asked to be, beside a span of turns. */
export const TURN_PARITIES = ["odd", "even"];

/* -------------------------------------------- */

/**
 * The clock of a battle, from what its encounter says.
 * @param {object} [battle]
 * @param {boolean} [battle.started]    Has the battle begun?
 * @param {number} [battle.round]       The turn of the battle
 * @param {string|null} [battle.phase]  The side whose Phase is running
 * @returns {Clock|null}                Null where no battle is running
 */
export function clockFrom({ started = false, round = 0, phase = null } = {}) {
  const turn = Math.floor(Number(round)) || 0;
  if ( !started || !(turn >= 1) ) return null;
  return { turn, phase: phase ?? "" };
}

/* -------------------------------------------- */

/**
 * Is a turn what a condition asks it to be?
 * @param {"odd"|"even"|{min?: number, max?: number}} asked
 * @param {number} turn
 * @returns {boolean}
 */
export function turnIs(asked, turn) {
  if ( !(turn >= 1) ) return false;
  if ( asked === "odd" ) return (turn % 2) === 1;
  if ( asked === "even" ) return (turn % 2) === 0;
  if ( asked && (typeof asked === "object") ) return (turn >= (asked.min ?? -Infinity)) && (turn <= (asked.max ?? Infinity));
  return false;
}

/* -------------------------------------------- */

/**
 * Does a condition ask the clock for anything?
 * @param {object} [when]
 * @returns {boolean}
 */
export function asksClock(when) {
  return CLOCK_KEYS.some((key) => (when?.[key] !== undefined) && (when[key] !== null) && (when[key] !== ""));
}

/* -------------------------------------------- */

/**
 * Do the parts of a condition that ask the clock hold? Without a clock none of them does.
 * @param {object} [when]
 * @param {Clock|null} [clock]
 * @returns {boolean}
 */
export function clockHolds(when, clock = null) {
  if ( !asksClock(when) ) return true;
  if ( !clock ) return false;
  if ( (when.turn !== undefined) && (when.turn !== null) && (when.turn !== "") && !turnIs(when.turn, clock.turn) ) return false;
  if ( when.phase && ![].concat(when.phase).includes(clock.phase) ) return false;
  return true;
}

/* -------------------------------------------- */

/**
 * A condition without the parts that ask the clock.
 * @param {object} [when]
 * @returns {object|undefined}
 */
export function withoutClock(when) {
  if ( !asksClock(when) ) return when;
  const rest = { ...when };
  for ( const key of CLOCK_KEYS ) delete rest[key];
  return rest;
}

/* -------------------------------------------- */

/**
 * Does a number, or anything that holds numbers, read the clock?
 * @param {*} value       An effect, a part of one, or a list of them
 * @returns {boolean}
 */
export function readsClock(value) {
  if ( Array.isArray(value) ) return value.some(readsClock);
  if ( !value || (typeof value !== "object") ) return false;
  if ( [].concat(value.of ?? []).some((source) => CLOCK_SOURCES.includes(source)) ) return true;
  return Object.values(value).some(readsClock);
}

/* -------------------------------------------- */

/**
 * Does an effect hang on the clock: by its condition, or by a number it reads from it? What it grants for
 * later is not asked: a change that lasts is judged as its unit carries it.
 * @param {object} effect
 * @returns {boolean}
 */
export function needsClock(effect) {
  if ( asksClock(effect?.when) ) return true;
  const { grant, when, proc, ...parts } = effect ?? {};
  return readsClock(parts);
}

/* -------------------------------------------- */

/**
 * What a number reads from the clock.
 * @param {string} source       One of CLOCK_SOURCES
 * @param {Clock|null} [clock]
 * @returns {number}
 */
export function readClock(source, clock = null) {
  const turn = Math.max(clock?.turn ?? 0, 0);
  if ( source === "turnsPast" ) return Math.max(turn - 1, 0);
  return turn;
}

/* -------------------------------------------- */

/**
 * Check what a condition asks of the clock, so that a typing mistake does not pass silently.
 * @param {object} [when]
 * @param {string[]} [sides]      The sides that take a Phase
 * @returns {string[]}            What is wrong, in plain words; empty when nothing is
 */
export function checkClock(when, sides = []) {
  const problems = [];
  const turn = when?.turn;
  if ( (turn !== undefined) && !TURN_PARITIES.includes(turn) ) {
    const span = turn && (typeof turn === "object") && !Array.isArray(turn);
    const whole = (value) => (value === undefined) || (Number.isInteger(value) && (value >= 1));
    if ( !span || !Object.keys(turn).length || Object.keys(turn).some((key) => !["min", "max"].includes(key)) || !whole(turn.min) || !whole(turn.max) ) {
      problems.push(`when: a turn is "odd", "even", or a span of turns { min, max }`);
    }
  }
  if ( when?.phase !== undefined ) {
    const listed = [].concat(when.phase);
    if ( !listed.length || listed.some((side) => !sides.includes(side)) ) problems.push(`when: a Phase is one of ${sides.join(", ")}, or a list of them`);
  }
  return problems;
}

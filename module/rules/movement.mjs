/**
 * A unit's movement in its turn, as skills ask about it: whether it has moved, how many spaces, how much MOV it
 * has left, whether it made a full movement, and whether it still holds the weapon its turn began with. Pure
 * functions of plain data, so that they can be tested outside of Foundry.
 *
 * Movement is only counted in a battle on the map: from the tile where the unit's turn began to the tile it
 * stands on, or would attack from, by the way its reach finds there (see `reach.mjs`). What a unit moved in
 * its turn still counts once that turn is over, until its next turn starts.
 *
 * Skill effects read it in their conditions and numbers (see `skills.mjs`):
 *
 *   when: { moved: true }               // it has moved this turn; `false` for one that has yet to move
 *   when: { fullMove: true }            // it made a full movement: it moved, and has no MOV left
 *   when: { movLeft: { max: 2 } }       // the MOV it has left; also `min`
 *   when: { weaponKept: true }          // the weapon in hand is the one it held as its turn began
 *   { of: "spacesMoved", times: 0.5 }   // the spaces it moved, wherever a number stands
 *   { of: "movLeft", times: 4 }         // the MOV it has left
 *   when: { movedThrough: true }        // it moved through an enemy on that way (see `passing.mjs`)
 *   when: { movedThroughFoe: true }     // in a fight: the unit it fights is an enemy it moved through
 *   { of: "cantoSpaces", times: 2 }     // the spaces it moved after its Action, as Canto lets it (see `canto.mjs`)
 *
 * For a unit whose movement cannot be judged, one that is not on a battle map or not in a battle, such an
 * effect is not applied, and its skill is shown as one to check by hand.
 *
 * @import {Reach, Tile} from "./reach.mjs"
 */
import { pathTo, tileKey, tilesApart } from "./reach.mjs";

/**
 * @typedef Movement
 * What a unit's movement this turn comes to.
 * @property {number} spaces      The spaces it moved
 * @property {number} cost        The movement that took
 * @property {number} mov         Its MOV
 * @property {number} left        The MOV it has left
 * @property {boolean} moved      Has it moved?
 * @property {boolean} full       Did it make a full movement?
 * @property {boolean} kept       Is the weapon in its hand the one it held as its turn began?
 * @property {string[]} passed    The enemies it moved through on its way, each by what tells its token from
 *                                the others
 * @property {number} canto       The spaces of the move it made after its Action, which are among `spaces`
 */

/** The parts of a condition that ask how a unit moved. */
export const MOVE_KEYS = ["moved", "fullMove", "movLeft", "weaponKept", "movedThrough", "movedThroughFoe"];

/** What a number can be read from that hangs on how a unit moved. */
export const MOVE_SOURCES = ["spacesMoved", "movLeft", "cantoSpaces"];

/* -------------------------------------------- */

/**
 * How far it is from where a unit's turn began to a tile: the spaces of the way its reach finds there and the
 * movement they take. A tile outside its reach, as when it was set down there by hand, counts the tiles
 * between the two.
 * @param {Reach} reach     Where the unit can go from where its turn began
 * @param {Tile} tile       The tile it stands on, or would attack from
 * @returns {{spaces: number, cost: number}}
 */
export function walkTo(reach, tile) {
  const key = tileKey(tile);
  if ( key === tileKey(reach.origin) ) return { spaces: 0, cost: 0 };
  if ( !reach.cost.has(key) ) {
    const apart = tilesApart(reach.origin, tile);
    return { spaces: apart, cost: apart };
  }
  return { spaces: pathTo(reach, tile).length, cost: reach.cost.get(key) };
}

/* -------------------------------------------- */

/**
 * What a unit's movement this turn comes to.
 * @param {object} [turn]
 * @param {number} [turn.spaces]              The spaces it moved
 * @param {number} [turn.cost]                The movement that took
 * @param {number} [turn.mov]                 Its MOV as it is now
 * @param {string|null} [turn.held]           The weapon it held as its turn began, by what tells it from the
 *                                            others; blank for none, null when that was never noted
 * @param {string|null} [turn.weapon]         The weapon in its hand now, the same way
 * @param {string[]} [turn.passed]            The enemies it moved through on its way
 * @param {number} [turn.canto]               The spaces of the move it made after its Action
 * @returns {Movement}
 */
export function movementFacts({ spaces = 0, cost = 0, mov = 0, held = null, weapon = null, passed = [], canto = 0 } = {}) {
  const walked = Math.max(Math.floor(Number(spaces)) || 0, 0);
  const spent = Math.max(Number(cost) || 0, 0);
  const total = Math.max(Number(mov) || 0, 0);
  const left = Math.max(total - spent, 0);
  return {
    spaces: walked,
    cost: spent,
    mov: total,
    left,
    moved: walked > 0,
    full: (walked > 0) && (left <= 0),

    // A unit whose turn never began in this battle has held its weapon since the battle did
    kept: (held === null) || (held === undefined) || ((held || "") === (weapon || "")),

    // A unit that has not moved has moved through nobody
    passed: (walked > 0) ? (Array.isArray(passed) ? passed.filter((id) => typeof id === "string") : []) : [],

    // The spaces moved after its Action are among those it moved
    canto: Math.min(Math.max(Math.floor(Number(canto)) || 0, 0), walked)
  };
}

/* -------------------------------------------- */

/**
 * Does a number, or anything that holds numbers, read how a unit moved?
 * @param {*} value       An effect, a part of one, or a list of them
 * @returns {boolean}
 */
export function readsMove(value) {
  if ( Array.isArray(value) ) return value.some(readsMove);
  if ( !value || (typeof value !== "object") ) return false;
  if ( [].concat(value.of ?? []).some((source) => MOVE_SOURCES.includes(source)) ) return true;
  return Object.values(value).some(readsMove);
}

/* -------------------------------------------- */

/**
 * The numbers of an effect that are read from how its unit moved.
 * @param {object} effect
 * @returns {object[]}
 */
export function moveNumbers(effect) {
  const found = [];
  const search = (value, key) => {
    if ( Array.isArray(value) ) for ( const entry of value ) search(entry);
    else if ( value && (typeof value === "object") ) {
      if ( (key !== "when") && [].concat(value.of ?? []).some((source) => MOVE_SOURCES.includes(source)) ) found.push(value);
      else for ( const [name, entry] of Object.entries(value) ) search(entry, name);
    }
  };
  search(effect);
  return found;
}

/* -------------------------------------------- */

/**
 * Does an effect hang on how its unit moved: a condition on its movement, or a number read from it?
 * What it grants for later is not looked at: that is worked out when it is granted.
 * @param {object} effect
 * @returns {boolean}
 */
export function needsMove(effect) {
  if ( !effect ) return false;
  if ( MOVE_KEYS.some((key) => effect.when?.[key] !== undefined) ) return true;
  const { when, grant, aura, ...parts } = effect;
  return readsMove(parts);
}

/* -------------------------------------------- */

/**
 * A condition without its parts that ask how a unit moved.
 * @param {object} [when]
 * @returns {object}
 */
export function withoutMove(when) {
  return Object.fromEntries(Object.entries(when ?? {}).filter(([key]) => !MOVE_KEYS.includes(key)));
}

/* -------------------------------------------- */

/**
 * Do the parts of a condition that ask how a unit moved hold? Whether the unit it fights is one it moved
 * through is asked of the fight (see `movedThroughHolds`).
 * @param {object} [when]
 * @param {Movement|null} [move]      Null when its movement cannot be judged, and nothing of this holds
 * @returns {boolean}
 */
export function moveHolds(when, move = null) {
  if ( !MOVE_KEYS.some((key) => when?.[key] !== undefined) ) return true;
  if ( !move ) return false;
  if ( (typeof when.movedThrough === "boolean") && (((move.passed ?? []).length > 0) !== when.movedThrough) ) return false;
  if ( (typeof when.moved === "boolean") && (move.moved !== when.moved) ) return false;
  if ( (typeof when.fullMove === "boolean") && (move.full !== when.fullMove) ) return false;
  if ( (typeof when.weaponKept === "boolean") && (move.kept !== when.weaponKept) ) return false;
  if ( when.movLeft ) {
    if ( (move.left < (when.movLeft.min ?? -Infinity)) || (move.left > (when.movLeft.max ?? Infinity)) ) return false;
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Is the unit another fights one of the enemies it moved through this turn, or not, as a condition asks?
 * @param {object} [when]
 * @param {Movement|null} [move]      How the unit moved
 * @param {string|null} [foe]         What tells the token of the unit it fights from the others
 * @returns {boolean}
 */
export function movedThroughHolds(when, move = null, foe = null) {
  if ( typeof when?.movedThroughFoe !== "boolean" ) return true;
  if ( !move ) return false;
  return (!!foe && (move.passed ?? []).includes(foe)) === when.movedThroughFoe;
}

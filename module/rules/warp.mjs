/**
 * Warping: a skill used as an action that puts its unit somewhere else on the map, whatever lies between. Which
 * tiles it may land on is worked out here from the map as it is handed in; nothing in this module knows of
 * Foundry.
 *
 * A skill says how it warps in a `warp` part of an effect of its own:
 *
 *   warp: { within: "mov" }                  // onto a tile at most the unit's MOV away; a number for that many
 *   warp: { clear: 3 }                       // onto any tile of the map with no enemy within 3 tiles of it
 *   warp: { within: "mov", unmoved: true }   // `unmoved`: only before the unit has moved this turn
 *
 * Distances are counted along rows and columns, as movement is, but nothing on the way is asked about: not the
 * ground, not walls, not the units that stand there. The tile it lands on must be one the unit could stand on,
 * with nobody on it. A unit with the rule `actAfterWarp` (see `skills.mjs`) keeps its turn when it has warped.
 *
 * A staff moves a unit as its Effect says, which is read here as the staff rules read what a staff heals: an
 * adjacent ally to a space in range (Warp), an ally in range to a space next to the user (Rescue), the user
 * itself to a space in range (Rewarp), an enemy in range to a space next to the user (Entrap), an ally or an
 * enemy one space on (Push), its target back to where it began the battle (Return), or to a random space in
 * range (Miswarp). The range is that of the staff, counted from the unit that uses it. Against an enemy the
 * staff has to hit first, which the staves themselves see to (see `helpers/warp.mjs`).
 *
 * @import {Tile} from "./reach.mjs"
 */
import { tileKey, tilesApart } from "./reach.mjs";

/** The rule that lets a unit act again once it has warped. */
export const ACT_AFTER_WARP = "actAfterWarp";

/**
 * @typedef Warp
 * @property {"mov"|number} [within]    How far the unit may warp: its MOV, or a number of tiles; anywhere if
 *                                      left out
 * @property {number} [clear]           No enemy may stand this near the tile it lands on
 * @property {boolean} [unmoved]        May it only warp before it has moved this turn?
 */

/**
 * How a skill warps its unit, if it does.
 * @param {{effects?: object[], automate?: boolean, usage?: object}|null} skill     Skill data
 * @returns {Warp|null}     Null for a skill that does not, or one the table would rather run by hand
 */
export function warpOf(skill) {
  if ( !skill || (skill.automate === false) || (skill.usage?.kind !== "action") ) return null;
  const effect = (skill.effects ?? []).find((entry) => entry?.warp && (typeof entry.warp === "object"));
  return effect?.warp ?? null;
}

/* -------------------------------------------- */

/**
 * How many tiles a warp reaches.
 * @param {Warp} warp
 * @param {number} movement     The unit's MOV
 * @returns {number}            Infinity for one that reaches the whole map
 */
export function warpDistance(warp, movement) {
  if ( warp?.within === "mov" ) return Math.max(Number(movement) || 0, 0);
  if ( Number.isFinite(warp?.within) ) return Math.max(warp.within, 0);
  return Infinity;
}

/* -------------------------------------------- */

/**
 * @typedef WarpField
 * @property {{i0: number, j0: number, i1: number, j1: number}} bounds
 *                                                The rows and columns of the map, the last of each left out
 * @property {(tile: Tile) => number} cost        Movement it takes to enter the tile; Infinity if the unit
 *                                                cannot stand there
 * @property {(tile: Tile) => boolean} taken      Does someone stand there?
 * @property {Tile[]} [foes]                      Where the unit's enemies stand
 */

/**
 * The tiles a unit can warp to.
 * @param {Warp} warp
 * @param {Tile} standing       Where the unit stands
 * @param {number} movement     Its MOV
 * @param {WarpField} field
 * @returns {Set<string>}       The tiles, by name
 */
export function warpTiles(warp, standing, movement, field) {
  const tiles = new Set();
  if ( !warp || !standing || !field?.bounds ) return tiles;
  const reach = warpDistance(warp, movement);
  const clear = Number.isFinite(warp.clear) ? warp.clear : -1;
  const foes = field.foes ?? [];
  const { i0, j0, i1, j1 } = field.bounds;

  // Only the rows and columns the warp reaches are looked at
  const top = Math.max(i0, Number.isFinite(reach) ? standing.i - reach : i0);
  const foot = Math.min(i1 - 1, Number.isFinite(reach) ? standing.i + reach : i1 - 1);
  for ( let i = top; i <= foot; i++ ) {
    const across = Number.isFinite(reach) ? reach - Math.abs(i - standing.i) : Infinity;
    const left = Math.max(j0, Number.isFinite(across) ? standing.j - across : j0);
    const right = Math.min(j1 - 1, Number.isFinite(across) ? standing.j + across : j1 - 1);
    for ( let j = left; j <= right; j++ ) {
      const tile = { i, j };
      if ( (i === standing.i) && (j === standing.j) ) continue;
      if ( field.taken(tile) || !Number.isFinite(field.cost(tile)) ) continue;
      if ( (clear >= 0) && foes.some((foe) => tilesApart(foe, tile) <= clear) ) continue;
      tiles.add(tileKey(tile));
    }
  }
  return tiles;
}

/* -------------------------------------------- */
/*  Staves                                      */
/* -------------------------------------------- */

/**
 * @typedef StaffWarp
 * @property {"ally"|"self"|"enemy"|"any"|"target"} moves
 *           Whom the staff moves: an ally it is used on, its user, an enemy, an ally or an enemy alike, or its
 *           `target` where the Effect names no side, which is then whichever side the staff is used on
 * @property {"adjacent"|"range"|null} from   Where that unit must stand: next to the user, or within the staff's
 *                                            range; null for a staff that warps its user
 * @property {"adjacent"|"range"|"beside"|"random"|"start"} to
 *           Where it is set down: next to the user, within the staff's range, `beside` where it stands itself,
 *           on a `random` tile within the staff's range, or where it stood as the battle began. The first three
 *           are chosen by whoever uses the staff
 * @property {boolean} [halves]               Is its HP halved once it has been warped?
 */

/**
 * How a staff moves a unit, as its Effect says:
 *
 *   "Teleports an adjacent ally to a space in range"                (Warp)
 *   "Teleports ally in range to an adjacent space"                  (Rescue)
 *   "Teleports unit to a space in range"                            (Rewarp)
 *   "Teleports enemy unit in range to a space adjacent to the user" (Entrap)
 *   "Moves an enemy OR ally by 1 space, in any direction"           (Push)
 *   "Teleports target back to its starting space"                   (Return)
 *   "Teleports target to a random space within the staff's range"   (Miswarp), with "their HP is halved"
 *
 * @param {string} [effect]     The staff's Effect
 * @returns {StaffWarp|null}    Null for a staff that moves nobody the system can place
 */
export function staffWarp(effect) {
  const text = String(effect ?? "").replace(/\s+/g, " ").replace(/[’`]/g, "'").trim();
  const first = text.split(/[.;]/)[0];
  if ( /^teleports? an? adjacent ally to a(?:ny)? space in range$/i.test(first) ) return { moves: "ally", from: "adjacent", to: "range" };
  if ( /^teleports? (?:an? )?ally in range to an? adjacent space$/i.test(first) ) return { moves: "ally", from: "range", to: "adjacent" };
  if ( /^teleports? (?:the )?(?:unit|user) to a(?:ny)? space in range$/i.test(first) ) return { moves: "self", from: null, to: "range" };
  if ( /^teleports? (?:an? )?enemy(?: unit)? in range to a space adjacent to the user$/i.test(first) ) return { moves: "enemy", from: "range", to: "adjacent" };
  const pushed = /^moves? (?:an? )?(enemy or ally|ally or enemy|ally|enemy)(?: unit)? by 1 space\b/i.exec(first);
  if ( pushed ) return { moves: / or /i.test(pushed[1]) ? "any" : pushed[1].toLowerCase(), from: "range", to: "beside" };
  if ( /^teleports? (?:the )?target back to (?:it'?s|their) starting space$/i.test(first) ) return { moves: "target", from: "range", to: "start" };
  if ( /^teleports? (?:the )?target to a random space within (?:the staff'?s )?range$/i.test(first) ) {
    return { moves: "target", from: "range", to: "random", halves: /\bHP is halved\b/i.test(text) };
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Does whoever uses the staff choose the tile its unit is set down on?
 * @param {StaffWarp|null} warp
 * @returns {boolean}
 */
export function staffWarpChosen(warp) {
  return ["range", "adjacent", "beside"].includes(warp?.to);
}

/* -------------------------------------------- */

/**
 * May a staff move a unit: one of the right side, that stands where the staff reaches it?
 * @param {StaffWarp} warp                          With `moves` no longer `target` (see `staffWarp`)
 * @param {"friend"|"foe"|"apart"} relation         How the unit stands to the one that uses the staff
 * @param {number} distance                         Tiles between the two
 * @param {{min: number, max: number}|null} reach   How far the staff reaches; null if its Range sets no limit
 * @returns {boolean}
 */
export function staffWarpReaches(warp, relation, distance, reach) {
  const sides = { ally: ["friend"], enemy: ["foe"], any: ["friend", "foe"] }[warp?.moves] ?? [];
  if ( !sides.includes(relation) ) return false;
  if ( warp.from === "adjacent" ) return distance === 1;
  return !reach || ((distance >= Math.max(reach.min, 1)) && (distance <= reach.max));
}

/* -------------------------------------------- */

/**
 * The tiles a staff can set a unit down on. For a staff that sets its unit down on a random tile, these are the
 * tiles one is drawn from; a staff that sends its unit back where it began has none to offer.
 * @param {StaffWarp} warp
 * @param {Tile} user                               Where the unit that uses the staff stands
 * @param {{min: number, max: number}|null} reach   How far the staff reaches; null if its Range sets no limit
 * @param {WarpField} field                         The map, as the unit that is moved would stand on it
 * @param {Tile|null} [moved]                       Where the unit that is moved stands
 * @returns {Set<string>}                           The tiles, by name
 */
export function staffWarpTiles(warp, user, reach, field, moved = null) {
  if ( !warp || !user || (warp.to === "start") ) return new Set();
  if ( warp.to === "beside" ) return moved ? warpTiles({ within: 1 }, moved, 0, field) : new Set();
  const near = warp.to === "adjacent";
  const least = near ? 1 : Math.max(reach?.min ?? 1, 1);
  const tiles = warpTiles(near ? { within: 1 } : reach ? { within: Math.max(reach.max, 0) } : {}, user, 0, field);
  if ( least > 1 ) for ( const key of Array.from(tiles) ) {
    const [i, j] = key.split(",").map(Number);
    if ( tilesApart(user, { i, j }) < least ) tiles.delete(key);
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * Check how a skill says it warps, so that a typing mistake does not pass silently.
 * @param {any} warp
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkWarp(warp) {
  if ( !warp || (typeof warp !== "object") || Array.isArray(warp) ) return ["warp must say where the unit may land"];
  const problems = [];
  for ( const key of Object.keys(warp) ) {
    if ( !["within", "clear", "unmoved"].includes(key) ) problems.push(`warp cannot say "${key}"`);
  }
  if ( (warp.within !== undefined) && (warp.within !== "mov") && !(Number.isInteger(warp.within) && (warp.within >= 1)) ) {
    problems.push(`a warp reaches "mov" or a whole number of tiles, not "${warp.within}"`);
  }
  if ( (warp.clear !== undefined) && !(Number.isInteger(warp.clear) && (warp.clear >= 0)) ) {
    problems.push(`a warp keeps clear of enemies by a whole number of tiles, not "${warp.clear}"`);
  }
  if ( (warp.unmoved !== undefined) && (warp.unmoved !== true) ) problems.push(`the "unmoved" of a warp is true or left out, not "${warp.unmoved}"`);
  return problems;
}

import { tileKey } from "./reach.mjs";

/**
 * Painting the ground of a battle map, tile by tile. A Game Master paints two things, each on a coat of its
 * own: what kind of terrain a tile is, and how high it lies. A tile holds at most one kind of terrain and one
 * height, so painting over a tile takes it from whatever it was on that coat before.
 *
 * Everything here works on tiles and their names alone. Keeping the coats on a scene is the work of
 * `helpers/paint.mjs`.
 *
 * @import {Tile} from "./reach.mjs"
 */

/**
 * @typedef Brush
 * What the brush lays down.
 * @property {string|null} terrain      A key of FEO.terrain.types, or null to leave the terrain of a tile alone
 * @property {number|null} elevation    How high the ground is to lie, or null to leave the height of a tile alone
 * @property {boolean} erase            Take the paint off instead: both coats, whatever else the brush holds
 */

/**
 * @typedef Paint
 * The paint on a map: the tiles of each kind of terrain and of each height, by name.
 * @property {Map<string, Set<string>>} terrain
 * @property {Map<number, Set<string>>} elevation
 */

/** The coats of paint, in the order they are worked through. */
export const COATS = ["terrain", "elevation"];

/* -------------------------------------------- */

/**
 * The tiles the brush passes over on its way from one tile to another, both included, so that a quick stroke
 * leaves no gaps.
 * @param {Tile} from
 * @param {Tile} to
 * @returns {Tile[]}
 */
export function lineTiles(from, to) {
  const tiles = [];
  const rows = Math.abs(to.i - from.i);
  const columns = Math.abs(to.j - from.j);
  const down = from.i < to.i ? 1 : -1;
  const across = from.j < to.j ? 1 : -1;
  let { i, j } = from;
  let lean = columns - rows;
  for ( let step = 0; step <= rows + columns; step++ ) {
    tiles.push({ i, j });
    if ( (i === to.i) && (j === to.j) ) break;
    const twice = lean * 2;
    if ( twice > -rows ) {
      lean -= rows;
      j += across;
    }
    if ( twice < columns ) {
      lean += columns;
      i += down;
    }
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * Every tile of the box that has two tiles for opposite corners.
 * @param {Tile} from
 * @param {Tile} to
 * @returns {Tile[]}
 */
export function boxTiles(from, to) {
  const tiles = [];
  for ( let i = Math.min(from.i, to.i); i <= Math.max(from.i, to.i); i++ ) {
    for ( let j = Math.min(from.j, to.j); j <= Math.max(from.j, to.j); j++ ) tiles.push({ i, j });
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * What a coat of the brush lays on the tiles it touches.
 * @param {Brush} brush
 * @param {"terrain"|"elevation"} coat
 * @returns {{touches: boolean, lays: string|number|null}}
 *   Whether the brush changes this coat at all, and what it leaves there: null for nothing
 */
function strokeOf(brush, coat) {
  if ( brush.erase ) return { touches: true, lays: null };
  const lays = brush[coat];
  const holds = coat === "terrain" ? !!lays : Number.isInteger(lays);
  return { touches: holds, lays: holds ? lays : null };
}

/* -------------------------------------------- */

/**
 * Pass the brush over some tiles. The paint that was there is left as it is; what comes back is the paint as
 * it is afterwards, and which kinds of terrain and which heights lost or gained a tile.
 * @param {Paint} paint
 * @param {Iterable<Tile>} tiles
 * @param {Brush} brush
 * @returns {{paint: Paint, changed: {terrain: Set<string>, elevation: Set<number>}}}
 */
export function paintTiles(paint, tiles, brush) {
  const keys = Array.from(tiles, tileKey);
  const next = { terrain: new Map(), elevation: new Map() };
  const changed = { terrain: new Set(), elevation: new Set() };
  for ( const coat of COATS ) {
    const { touches, lays } = strokeOf(brush, coat);
    const values = new Set(paint[coat].keys());
    if ( touches && (lays !== null) ) values.add(lays);
    for ( const value of values ) {
      const before = paint[coat].get(value) ?? new Set();
      const after = new Set(before);
      if ( touches ) {
        for ( const key of keys ) {
          if ( value === lays ) after.add(key);
          else after.delete(key);
        }
      }
      if ( after.size !== before.size ) changed[coat].add(value);
      next[coat].set(value, after);
    }
  }
  return { paint: next, changed };
}

/* -------------------------------------------- */

/**
 * What the brush holds, in a word or two: the kind of terrain, the height, both, or neither.
 * @param {Brush} brush
 * @returns {{erase: boolean, terrain: string|null, elevation: number|null, idle: boolean}}
 *   `idle` for a brush that would change nothing
 */
export function brushHolds(brush) {
  const terrain = strokeOf({ ...brush, erase: false }, "terrain").lays;
  const elevation = strokeOf({ ...brush, erase: false }, "elevation").lays;
  return { erase: !!brush.erase, terrain, elevation, idle: !brush.erase && (terrain === null) && (elevation === null) };
}

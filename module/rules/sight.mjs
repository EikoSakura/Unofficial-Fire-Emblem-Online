/**
 * Line of Sight for Fire Emblem Online: which tiles and which units a unit has in its sight. Pure functions of
 * plain data, so that they can be tested outside of Foundry; the map is handed in as functions.
 *
 * LoS is a stat: the radius around a unit that it sees, counted in spaces along rows and columns. A unit has
 * another "in its LoS" when both of these hold:
 *
 *   - the other stands no further away than the unit's LoS counts spaces;
 *   - a straight line from the middle of the one tile to the middle of the other crosses no tile that blocks
 *     sight, and no wall of the scene.
 *
 * What blocks sight is terrain that nobody crosses on foot or flying: the walls, buildings and rock-faces a
 * map is closed in with (the "Wall, Obstacle" kind of terrain). A Thicket bends it as the rules have it for
 * Fog of War: a unit standing in one has 1 less LoS, and is seen only by a unit next to it. Units never block
 * sight, and neither does any other terrain.
 *
 * @import {Tile} from "./reach.mjs"
 */
import { clearLine } from "./forced.mjs";
import { tilesApart } from "./reach.mjs";

/**
 * @typedef SightField
 * The map, as sight crosses it.
 * @property {(tile: Tile) => boolean} [inside]             Is the tile on the map?
 * @property {(tile: Tile) => boolean} [blocked]            Does the tile block sight?
 * @property {(tile: Tile) => boolean} [hides]              Is a unit on the tile seen only from next to it?
 * @property {(tile: Tile) => number} [dims]                What standing on the tile adds to a unit's LoS: -1
 * @property {(from: Tile, to: Tile) => boolean} [wall]     Does a wall of the scene stand between two tiles?
 */

/**
 * How far a unit sees from a tile: its LoS, with what the ground it stands on makes of it.
 * @param {number} los                The unit's LoS
 * @param {Tile} from                 Where it stands
 * @param {SightField} [field]
 * @returns {number}
 */
export function sightReach(los, from, field = {}) {
  return Math.max(Math.floor(Number(los) || 0) + (field.dims?.(from) ?? 0), 0);
}

/* -------------------------------------------- */

/**
 * Does a unit have a tile in its Line of Sight? Its own tile always is.
 * @param {Tile|null} from            Where the unit stands
 * @param {Tile|null} to              The tile, or where another unit stands
 * @param {number} los                The unit's LoS
 * @param {SightField} [field]
 * @returns {boolean}
 */
export function sees(from, to, los, field = {}) {
  if ( !from || !to ) return false;
  const distance = tilesApart(from, to);
  if ( !distance ) return true;
  if ( distance > sightReach(los, from, field) ) return false;
  if ( field.hides?.(to) && (distance > 1) ) return false;
  if ( field.blocked && !clearLine(from, to, field.blocked) ) return false;
  return !field.wall?.(from, to);
}

/* -------------------------------------------- */

/**
 * What stops a unit from having a tile in its Line of Sight, if anything does: for a notice that says why.
 * @param {Tile|null} from
 * @param {Tile|null} to
 * @param {number} los
 * @param {SightField} [field]
 * @returns {"far"|"hidden"|"blocked"|"wall"|null}
 */
export function sightBar(from, to, los, field = {}) {
  if ( !from || !to ) return "far";
  const distance = tilesApart(from, to);
  if ( !distance ) return null;
  if ( distance > sightReach(los, from, field) ) return "far";
  if ( field.hides?.(to) && (distance > 1) ) return "hidden";
  if ( field.blocked && !clearLine(from, to, field.blocked) ) return "blocked";
  return field.wall?.(from, to) ? "wall" : null;
}

/* -------------------------------------------- */

/**
 * Every tile a unit has in its Line of Sight, its own among them, row by row.
 * @param {Tile|null} from
 * @param {number} los
 * @param {SightField} [field]
 * @returns {Tile[]}
 */
export function sightTiles(from, los, field = {}) {
  if ( !from ) return [];
  const reach = sightReach(los, from, field);
  const tiles = [];
  for ( let di = -reach; di <= reach; di++ ) {
    const across = reach - Math.abs(di);
    for ( let dj = -across; dj <= across; dj++ ) {
      const tile = { i: from.i + di, j: from.j + dj };
      if ( field.inside && !field.inside(tile) ) continue;
      if ( field.blocked?.(tile) && (di || dj) ) continue;
      if ( sees(from, tile, los, field) ) tiles.push(tile);
    }
  }
  return tiles;
}

import { FEO } from "../config.mjs";
import { normalizeObject, objectAt, objectTerrain } from "../rules/objects.mjs";

/**
 * Where a scene keeps its doors, chests and Villages (see `rules/objects.mjs`), and reading them. Kept apart
 * from what is done with them (`helpers/objects.mjs`), so that whoever reads the ground of a scene can ask
 * what stands on a tile.
 *
 * @import {MapObject} from "../rules/objects.mjs"
 */

/** The flag, on a scene, that holds its map objects. */
export const OBJECTS_FLAG = "objects";

/** What was read of each scene's map objects, until its flag changes. */
const read = new WeakMap();

/* -------------------------------------------- */

/**
 * The map objects of a scene.
 * @param {Scene|null} scene
 * @returns {MapObject[]}
 */
export function objectsOn(scene) {
  if ( !scene?.grid?.isSquare ) return [];
  const raw = scene.getFlag(FEO.id, OBJECTS_FLAG);
  const known = read.get(scene);
  if ( known && (known.raw === raw) ) return known.list;
  const list = (Array.isArray(raw) ? raw : []).map(normalizeObject).filter(Boolean);
  read.set(scene, { raw, list });
  return list;
}

/* -------------------------------------------- */

/**
 * The map object on a tile of a scene, if one is.
 * @param {Scene|null} scene
 * @param {{i: number, j: number}} tile
 * @returns {MapObject|null}
 */
export function objectOn(scene, tile) {
  return objectAt(objectsOn(scene), tile);
}

/* -------------------------------------------- */

/**
 * The kind of terrain a map object makes of a tile, if it does: a shut door is a wall, a Village that stands
 * a House.
 * @param {Scene|null} scene
 * @param {{i: number, j: number}} tile
 * @returns {string|null}
 */
export function objectGround(scene, tile) {
  const list = objectsOn(scene);
  return list.length ? objectTerrain(objectAt(list, tile)) : null;
}

/* -------------------------------------------- */

/**
 * Forget what was read of a scene's map objects.
 * @param {Scene|null} scene
 */
export function forgetObjects(scene) {
  if ( scene ) read.delete(scene);
}

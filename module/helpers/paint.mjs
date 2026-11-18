import { FEO } from "../config.mjs";
import { COATS, paintTiles } from "../rules/paint.mjs";
import { keyTile } from "../rules/reach.mjs";
import { TERRAIN_BEHAVIOR, ZONE_FLAG } from "./terrain.mjs";

/**
 * The terrain brush in Foundry: what a Game Master paints is kept as Regions of the scene, so that painted
 * ground is read like any other (see helpers/terrain.mjs) and can still be looked at and changed by hand.
 *
 * Each kind of terrain that has been painted is one Region, and so is each height. Such a Region is marked as
 * painted, covers its tiles with a single shape made of grid spaces, and carries one Terrain behaviour that
 * names the kind of terrain or the height, never both. A Region that is marked but has been changed by hand
 * into something else is left alone.
 *
 * A zone that has been marked, such as the one the players set their units up in, is one Region as well: it
 * names its zone in a flag and carries no behaviour, since it says nothing about the ground under it.
 *
 * @import {Brush, Paint} from "../rules/paint.mjs"
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The flag that marks a Region as painted with the brush. */
export const PAINTED_FLAG = "painted";

/** The flag of a scene that says its painted ground is drawn on the map for everyone. */
export const SHOWN_FLAG = "paintShown";

/** The type of the Region shape that is made of grid spaces. */
const GRID_SHAPE = "grid";

/** The colour of a Region that carries a painted height. */
const ELEVATION_TINT = "#d9b662";

/* -------------------------------------------- */

/**
 * The colour a kind of terrain is painted in.
 * @param {string} terrain    A key of FEO.terrain.types
 * @returns {string}          A CSS colour
 */
export function terrainTint(terrain) {
  return FEO.terrain.tints[terrain] ?? FEO.terrain.tints[FEO.terrain.default];
}

/* -------------------------------------------- */

/**
 * What a painted Region carries: a kind of terrain, a height or a zone, and its tiles.
 * @param {RegionDocument} region
 * @returns {{coat: "terrain"|"elevation"|"zone", value: string|number, tiles: Set<string>}|null}
 *   Null for a Region the brush does not look after
 */
function readRegion(region) {
  if ( !region.getFlag(FEO.id, PAINTED_FLAG) ) return null;
  const behavior = region.behaviors.find((other) => (other.type === TERRAIN_BEHAVIOR) && !other.disabled);
  const zone = region.getFlag(FEO.id, ZONE_FLAG);
  const zoned = (typeof zone === "string") && (zone in FEO.zones);

  // A zone that was given ground of its own by hand has become something else
  if ( zoned === !!behavior ) return null;
  const { terrain, elevation } = behavior?.system ?? {};
  const high = Number.isInteger(elevation);
  if ( !zoned && (!!terrain === high) ) return null;
  const tiles = new Set();
  for ( const shape of region.shapes ) {
    if ( shape.type !== GRID_SHAPE ) continue;
    for ( const { i, j } of shape.offsets ?? [] ) tiles.add(`${i},${j}`);
  }
  if ( zoned ) return { coat: "zone", value: zone, tiles };
  return high ? { coat: "elevation", value: elevation, tiles } : { coat: "terrain", value: terrain, tiles };
}

/* -------------------------------------------- */

/**
 * The paint on a scene, and the Regions that hold it.
 * @param {Scene} scene
 * @returns {{paint: Paint, regions: {terrain: Map<string, RegionDocument[]>, elevation: Map<number, RegionDocument[]>,
 *   zone: Map<string, RegionDocument[]>}}}
 */
export function readPaint(scene) {
  const paint = Object.fromEntries(COATS.map((coat) => [coat, new Map()]));
  const regions = Object.fromEntries(COATS.map((coat) => [coat, new Map()]));
  for ( const region of scene?.regions ?? [] ) {
    const held = readRegion(region);
    if ( !held ) continue;
    const { coat, value, tiles } = held;
    if ( !paint[coat].has(value) ) {
      paint[coat].set(value, new Set());
      regions[coat].set(value, []);
    }
    for ( const key of tiles ) paint[coat].get(value).add(key);
    regions[coat].get(value).push(region);
  }
  return { paint, regions };
}

/* -------------------------------------------- */

/**
 * Is the ground of a scene drawn on the map for everyone, as a picture under the tokens (see
 * canvas/ground-art.mjs)? Otherwise it shows only to whoever looks at it with the Survey tool. Either way the
 * rules count it, and its Regions show as any other does: to a Game Master who has the Region controls open.
 * @param {Scene|null} scene
 * @returns {boolean}
 */
export function paintShown(scene) {
  return !!scene?.getFlag(FEO.id, SHOWN_FLAG);
}

/* -------------------------------------------- */

/**
 * Painted ground was once shown to the players by making its Regions visible to everyone, which Foundry draws
 * as a hatched wash. Regions that were left that way are put back to how a Region is made, now that the ground
 * is drawn as a picture instead. Runs for a Game Master.
 * @param {Scene|null} scene
 * @returns {Promise<number>}   How many Regions were put back
 */
export async function veilPaint(scene) {
  if ( !game.user.isGM || !scene ) return 0;
  const { ALWAYS, LAYER_UNLOCKED } = CONST.REGION_VISIBILITY;
  const { regions } = readPaint(scene);
  const updates = [];
  for ( const coat of COATS ) {
    for ( const held of regions[coat].values() ) {
      for ( const region of held ) if ( region.visibility === ALWAYS ) updates.push({ _id: region.id, visibility: LAYER_UNLOCKED });
    }
  }
  if ( updates.length ) await scene.updateEmbeddedDocuments("Region", updates);
  return updates.length;
}

/* -------------------------------------------- */

/**
 * Draw the ground of a scene on the map for everyone, or stop doing so. The scene remembers the choice, and
 * every client draws or wipes the picture as it hears of it. Runs for a Game Master.
 * @param {Scene} scene
 * @param {boolean} shown
 * @returns {Promise<boolean>}    Whether the choice was made
 */
export async function showPaint(scene, shown) {
  if ( !game.user.isGM || !scene ) return false;
  await scene.setFlag(FEO.id, SHOWN_FLAG, !!shown);
  await veilPaint(scene);
  return true;
}

/* -------------------------------------------- */

/**
 * Tiles by name as the grid spaces of a shape, row by row.
 * @param {Iterable<string>} tiles
 * @returns {Tile[]}
 */
function offsetsOf(tiles) {
  return Array.from(tiles, keyTile).sort((a, b) => (a.i - b.i) || (a.j - b.j));
}

/* -------------------------------------------- */

/**
 * The shape that covers some tiles of the grid, as Foundry makes one itself.
 * @param {Tile[]} offsets
 * @returns {object}
 */
function gridShape(offsets) {
  return { type: GRID_SHAPE, offsets, origin: null };
}

/* -------------------------------------------- */

/**
 * The Region that holds a kind of terrain, a height or a zone that has not been painted before.
 * @param {"terrain"|"elevation"|"zone"} coat
 * @param {string|number} value
 * @param {Tile[]} offsets
 * @returns {object}    The data to create the Region with
 */
function regionData(coat, value, offsets) {
  if ( coat === "zone" ) {
    const zone = FEO.zones[value];
    return {
      name: game.i18n.format("FEO.Paint.zoneRegion", { zone: game.i18n.localize(zone?.label ?? value) }),
      color: zone?.tint ?? ELEVATION_TINT,
      shapes: [gridShape(offsets)],
      flags: { [FEO.id]: { [PAINTED_FLAG]: true, [ZONE_FLAG]: value } }
    };
  }
  const terrain = coat === "terrain";
  const label = terrain ? game.i18n.localize(FEO.terrain.types[value]?.label ?? value).split(",")[0] : null;
  return {
    name: terrain
      ? game.i18n.format("FEO.Paint.terrainRegion", { terrain: label })
      : game.i18n.format("FEO.Paint.elevationRegion", { level: value }),
    color: terrain ? terrainTint(value) : ELEVATION_TINT,
    shapes: [gridShape(offsets)],
    behaviors: [{
      type: TERRAIN_BEHAVIOR,
      system: { terrain: terrain ? value : "", elevation: terrain ? null : value }
    }],
    flags: { [FEO.id]: { [PAINTED_FLAG]: true } }
  };
}

/* -------------------------------------------- */

/**
 * Pass the brush over some tiles of a scene: the Regions that hold its paint gain and lose tiles, new ones are
 * made, and those left without a tile are deleted. Runs for a Game Master.
 * @param {Scene} scene
 * @param {Tile[]} tiles
 * @param {Brush} brush
 * @returns {Promise<boolean>}    Whether anything was painted
 */
export async function paintScene(scene, tiles, brush) {
  if ( !game.user.isGM || !scene?.grid?.isSquare || !tiles?.length ) return false;
  const { paint, regions } = readPaint(scene);
  const { paint: next, changed } = paintTiles(paint, tiles, brush);
  const creates = [];
  const updates = [];
  const deletes = [];
  for ( const coat of COATS ) {
    for ( const value of changed[coat] ) {
      const offsets = offsetsOf(next[coat].get(value));
      const [region, ...spare] = regions[coat].get(value) ?? [];

      // Paint that was spread over several Regions is gathered into the first
      for ( const other of spare ) deletes.push(other.id);
      if ( !region ) {
        if ( offsets.length ) creates.push(regionData(coat, value, offsets));
        continue;
      }

      // Shapes that were added to the Region by hand stay as they are
      const kept = region.shapes.filter((shape) => shape.type !== GRID_SHAPE).map((shape) => shape.toObject());
      if ( offsets.length ) kept.push(gridShape(offsets));
      if ( kept.length ) updates.push({ _id: region.id, shapes: kept });
      else deletes.push(region.id);
    }
  }
  if ( deletes.length ) await scene.deleteEmbeddedDocuments("Region", deletes);
  if ( updates.length ) await scene.updateEmbeddedDocuments("Region", updates);
  if ( creates.length ) await scene.createEmbeddedDocuments("Region", creates);
  return !!(deletes.length || updates.length || creates.length);
}

/* -------------------------------------------- */

/**
 * Lay the paint of a whole map on a scene at once, in place of whatever was painted there before: one Region
 * for each kind of terrain, each height and each zone. Regions made by hand are left as they are. Runs for a
 * Game Master.
 * @param {Scene} scene
 * @param {Paint} paint
 * @returns {Promise<boolean>}    Whether the paint was laid
 */
export async function layPaint(scene, paint) {
  if ( !game.user.isGM || !scene?.grid?.isSquare ) return false;
  const { regions } = readPaint(scene);
  const stale = COATS.flatMap((coat) => Array.from(regions[coat].values()).flat().map((region) => region.id));
  const creates = [];
  for ( const coat of COATS ) {
    for ( const [value, tiles] of paint[coat] ?? [] ) {
      if ( tiles.size ) creates.push(regionData(coat, value, offsetsOf(tiles)));
    }
  }
  if ( stale.length ) await scene.deleteEmbeddedDocuments("Region", stale);
  if ( creates.length ) await scene.createEmbeddedDocuments("Region", creates);
  return true;
}

import { FEO } from "../config.mjs";
import { groundOf, terrainHealing, terrainMatters, terrainType } from "../rules/terrain.mjs";
import { postCard } from "./chat.mjs";
import { healUnit } from "./events.mjs";
import { tokenTile } from "./exchange.mjs";
import { forgetObjects, objectGround } from "./map-objects.mjs";
import { weatherOf } from "./map-weather.mjs";

/**
 * The ground of a scene in Foundry: reading the Regions a Game Master painted its terrain with, and telling a
 * unit what it stands on. Nothing is saved for this: each client reads the Regions of the scene it looks at.
 *
 * @import {Ground, Mover} from "../rules/terrain.mjs"
 */

/** The type of the Region behaviour that carries terrain. */
export const TERRAIN_BEHAVIOR = "terrain";

/** The flag of a Region that says which zone its tiles belong to: a key of FEO.zones. */
export const ZONE_FLAG = "zone";

/** The zone the players set their units up in before a battle. */
export const DEPLOY_ZONE = "deploy";

/** What has been read of each scene's ground, tile by tile, until its Regions change. */
const read = new WeakMap();

/* -------------------------------------------- */

/**
 * Forget what was read of a scene's ground, or of every scene's.
 * @param {Scene|null} [scene]
 */
export function forgetGround(scene = null) {
  if ( scene ) read.delete(scene);
  else for ( const other of game.scenes ?? [] ) read.delete(other);
}

/* -------------------------------------------- */

/**
 * The Regions of a scene that say something about its ground, smallest first.
 * @param {Scene} scene
 * @returns {{region: RegionDocument, terrain: string, elevation: number|null, area: number}[]}
 */
function terrainRegions(scene) {
  const regions = [];
  for ( const region of scene.regions ?? [] ) {
    for ( const behavior of region.behaviors ?? [] ) {
      if ( (behavior.type !== TERRAIN_BEHAVIOR) || behavior.disabled ) continue;
      const { terrain, elevation } = behavior.system;
      if ( !terrain && !Number.isInteger(elevation) ) continue;
      regions.push({ region, terrain: terrain ?? "", elevation: Number.isInteger(elevation) ? elevation : null, area: region.area ?? 0 });
    }
  }
  return regions.sort((a, b) => a.area - b.area);
}

/* -------------------------------------------- */

/**
 * The Regions of a scene that mark a zone, such as the one the players set their units up in.
 * @param {Scene} scene
 * @returns {{region: RegionDocument, zone: string}[]}
 */
function zoneRegions(scene) {
  const regions = [];
  for ( const region of scene.regions ?? [] ) {
    const zone = region.getFlag(FEO.id, ZONE_FLAG);
    if ( (typeof zone === "string") && (zone in FEO.zones) ) regions.push({ region, zone });
  }
  return regions;
}

/* -------------------------------------------- */

/**
 * What has been read of a scene's ground so far.
 * @param {Scene} scene
 * @returns {{regions: object[]|null, zones: object[]|null, tiles: Map<string, object>}}
 */
function knownOf(scene) {
  let known = read.get(scene);
  if ( !known ) read.set(scene, known = { regions: null, zones: null, tiles: new Map() });
  return known;
}

/* -------------------------------------------- */

/**
 * Is a zone marked anywhere on a scene?
 * @param {Scene|null} scene
 * @param {string} [zone]     A key of FEO.zones
 * @returns {boolean}
 */
export function hasZone(scene, zone = DEPLOY_ZONE) {
  if ( !scene?.grid?.isSquare ) return false;
  try {
    const known = knownOf(scene);
    known.zones ??= zoneRegions(scene);
    return known.zones.some((entry) => entry.zone === zone);
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Does any Region of a scene say something about its ground? A map that was painted, or had its terrain marked
 * out by hand, has ground worth naming; a scene nobody did that for is open ground from edge to edge.
 * @param {Scene|null} scene
 * @returns {boolean}
 */
export function hasGround(scene) {
  if ( !scene?.grid?.isSquare ) return false;
  try {
    const known = knownOf(scene);
    known.regions ??= terrainRegions(scene);
    return known.regions.length > 0;
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * What a tile of a scene is: its kind of terrain and how high it lies. A tile no Region speaks for is open
 * ground on the floor of the map.
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile     Row and column of the tile
 * @returns {{terrain: string, elevation: number, named?: boolean, painted: string, zone: string|null}}
 *   `named` if a Region says what kind of terrain the tile is, rather than it being open ground for want of one.
 *   `painted` is the terrain as it was painted, where something that stands on the tile makes another kind of
 *   it: a door that is shut is a wall to everyone, and a Village that stands is a House (see `rules/objects.mjs`).
 *   `zone` is the zone the tile was marked as, a key of FEO.zones, if it was
 */
export function tileGround(scene, tile) {
  const blank = { terrain: FEO.terrain.default, elevation: 0, painted: FEO.terrain.default, zone: null };
  if ( !scene?.grid?.isSquare ) return blank;
  const known = knownOf(scene);
  const key = `${tile.i},${tile.j}`;
  if ( known.tiles.has(key) ) return known.tiles.get(key);

  let ground = blank;
  try {
    known.regions ??= terrainRegions(scene);
    known.zones ??= zoneRegions(scene);
    const point = (known.regions.length || known.zones.length) ? scene.grid.getCenterPoint({ i: tile.i, j: tile.j }) : null;
    if ( known.regions.length ) {
      let terrain = null;
      let elevation = null;
      for ( const entry of known.regions ) {
        if ( (terrain !== null) && (elevation !== null) ) break;
        if ( !entry.region.polygonTree?.testPoint(point) ) continue;
        if ( (terrain === null) && entry.terrain ) terrain = entry.terrain;
        if ( (elevation === null) && (entry.elevation !== null) ) elevation = entry.elevation;
      }
      // Whether a Region names the terrain is kept as well, for whoever draws the ground that was painted
      ground = {
        terrain: terrain ?? blank.terrain, elevation: elevation ?? 0, named: terrain !== null, painted: terrain ?? blank.terrain,
        zone: null
      };
    }

    // A zone is marked over the ground, whatever that is
    const marked = known.zones.find((entry) => entry.region.polygonTree?.testPoint(point));
    if ( marked ) ground = { ...ground, zone: marked.zone };

    // What stands on the tile may make another kind of ground of it
    const made = objectGround(scene, tile);
    if ( made ) ground = { ...ground, terrain: made };
  } catch(err) {
    console.error(err);
  }
  known.tiles.set(key, ground);
  return ground;
}

/* -------------------------------------------- */

/**
 * Describe a unit for the terrain rules: what it is, which of its skills the terrain table names, and what its
 * skills change about how it crosses terrain.
 * @param {Actor|null} actor
 * @returns {Mover}
 */
export function moverOf(actor) {
  const system = actor?.system;
  if ( !system ) return {};
  const weapon = system.equippedWeapon;
  const skills = [];
  for ( const item of actor.items ?? [] ) {
    if ( (item.type === "skill") && item.system.equipped ) skills.push(item.name);
  }
  return {
    qualities: system.specialQualities ?? "",
    skills,
    magic: !!FEO.weaponCategories[weapon?.system.category]?.magic,
    shifted: !!system.shift?.transformed,
    className: system.className ?? "",

    // What its skills change about how it crosses terrain, as the unit worked it out
    crossing: system.crossing ?? null,

    // What the weather of its map has every tile cost it more
    weather: weatherOf(actor).move
  };
}

/* -------------------------------------------- */

/**
 * What a token stands on: the bonuses of its tile and the height it stands at.
 * @param {TokenDocument|null} token
 * @param {{i: number, j: number}|null} [tile]    Another tile to stand the unit on, as when it is about to move
 * @returns {(Ground & {type: object, effects: boolean})|null}     Null for a token that is not on a square
 *          grid; `effects` says whether the tile is terrain with effects for this unit
 */
export function groundUnder(token, tile = null) {
  const scene = token?.parent;
  const place = tile ?? tokenTile(token);
  if ( !scene || !place ) return null;
  const { terrain, elevation } = tileGround(scene, place);
  const mover = moverOf(token.actor);
  return { ...groundOf(terrain, elevation, mover), type: terrainType(terrain), effects: terrainMatters(terrain, mover) };
}

/* -------------------------------------------- */

/**
 * A unit's turn starts on ground that heals: it regains a share of its total HP, and chat gets a card.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @returns {Promise<number>}   The HP regained
 */
export async function healFromGround(actor, token) {
  const ground = groundUnder(token);
  if ( !ground || (actor?.type !== "unit") || actor.system.defeat?.state ) return 0;
  const { value, max } = actor.system.hp;
  const healed = (await healUnit(actor, terrainHealing(ground.terrain, value, max)))?.healed ?? 0;
  if ( !healed ) return 0;
  await postCard(actor, {
    title: game.i18n.format("FEO.Terrain.heals", { terrain: game.i18n.localize(ground.type.label) }),
    rows: [{
      label: game.i18n.localize("FEO.Chat.restored"),
      value: game.i18n.format("FEO.Chat.hpAmount", { amount: healed }),
      cls: "good"
    }]
  });
  return healed;
}

/* -------------------------------------------- */

/**
 * Keep what was read of a scene's ground in step with its Regions.
 * @param {() => void} [changed]    Called once the ground of a scene may have changed
 */
export function registerGround(changed = () => {}) {
  const forget = (document) => {
    forgetGround(document?.parent?.documentName === "Scene" ? document.parent : document?.parent?.parent ?? null);
    changed();
  };
  for ( const hook of [
    "createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"
  ] ) Hooks.on(hook, forget);
  Hooks.on("updateScene", (scene, changes) => {
    if ( "grid" in changes ) forget(null);

    // A door that opens, or a Village that falls, changes what its tile is
    else if ( changes.flags?.[FEO.id] !== undefined ) {
      forgetObjects(scene);
      forgetGround(scene);
      changed();
    }
  });
  Hooks.on("canvasReady", () => forget(null));
}

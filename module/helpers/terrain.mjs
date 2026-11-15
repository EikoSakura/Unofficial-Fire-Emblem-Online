import { FEO } from "../config.mjs";
import { groundOf, terrainHealing, terrainMatters, terrainType } from "../rules/terrain.mjs";
import { postCard } from "./chat.mjs";
import { tokenTile } from "./exchange.mjs";

/**
 * The ground of a scene in Foundry: reading the Regions a Game Master painted its terrain with, and telling a
 * unit what it stands on. Nothing is saved for this: each client reads the Regions of the scene it looks at.
 *
 * @import {Ground, Mover} from "../rules/terrain.mjs"
 */

/** The type of the Region behaviour that carries terrain. */
export const TERRAIN_BEHAVIOR = "terrain";

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
 * What a tile of a scene is: its kind of terrain and how high it lies. A tile no Region speaks for is open
 * ground on the floor of the map.
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile     Row and column of the tile
 * @returns {{terrain: string, elevation: number, named?: boolean}}
 *   `named` if a Region says what kind of terrain the tile is, rather than it being open ground for want of one
 */
export function tileGround(scene, tile) {
  const blank = { terrain: FEO.terrain.default, elevation: 0 };
  if ( !scene?.grid?.isSquare ) return blank;
  let known = read.get(scene);
  if ( !known ) read.set(scene, known = { regions: null, tiles: new Map() });
  const key = `${tile.i},${tile.j}`;
  if ( known.tiles.has(key) ) return known.tiles.get(key);

  let ground = blank;
  try {
    known.regions ??= terrainRegions(scene);
    if ( known.regions.length ) {
      const point = scene.grid.getCenterPoint({ i: tile.i, j: tile.j });
      let terrain = null;
      let elevation = null;
      for ( const entry of known.regions ) {
        if ( (terrain !== null) && (elevation !== null) ) break;
        if ( !entry.region.polygonTree?.testPoint(point) ) continue;
        if ( (terrain === null) && entry.terrain ) terrain = entry.terrain;
        if ( (elevation === null) && (entry.elevation !== null) ) elevation = entry.elevation;
      }
      // Whether a Region names the terrain is kept as well, for whoever draws the ground that was painted
      ground = { terrain: terrain ?? blank.terrain, elevation: elevation ?? 0, named: terrain !== null };
    }
  } catch(err) {
    console.error(err);
  }
  known.tiles.set(key, ground);
  return ground;
}

/* -------------------------------------------- */

/**
 * Describe a unit for the terrain rules: what it is, and which of its skills let it cross what others cannot.
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
    className: system.className ?? ""
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
  const healed = terrainHealing(ground.terrain, value, max);
  if ( !healed ) return 0;
  await actor.update({ "system.hp.value": value + healed });
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
  });
  Hooks.on("canvasReady", () => forget(null));
}

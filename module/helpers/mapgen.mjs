import { FEO } from "../config.mjs";
import { mapPaint } from "../rules/mapgen.mjs";
import { writeEncounter } from "./encounters.mjs";
import { SHOWN_FLAG, TRACKS_FLAG, layPaint } from "./paint.mjs";
import { changePlace, encounterAt } from "./worldmap.mjs";

/**
 * The map generator in Foundry: a map that was made up (see rules/mapgen.mjs and rules/mapgen-land.mjs) becomes
 * a scene of its own, its ground painted as the terrain brush would paint it, so that it can be touched up with
 * the brush afterwards. A scene made of a place of the World Map is kept with that place.
 *
 * @import {BattleMap} from "../rules/mapgen.mjs"
 */

/** The side of a tile of a generated scene, in pixels. */
const TILE_SIZE = 100;

/** The flag of a scene that says which map it was made from. */
export const GENERATED_FLAG = "generated";

/* -------------------------------------------- */

/**
 * Make a scene of a map: a square grid of the map's size with every tile painted, open ground included, since
 * the scene has no picture of its own. The painted ground is shown to the players, with the roads of a map made
 * from the World Map drawn across it, and the scene asks no token for sight. Runs for a Game Master.
 * @param {BattleMap} map
 * @param {object} [options]
 * @param {string} [options.name]     What to call the scene
 * @param {string} [options.place]    The place of the World Map it was made of, if it was made of one
 * @returns {Promise<Scene|null>}
 */
export async function createMapScene(map, { name, place = "" } = {}) {
  if ( !game.user.isGM || !map ) return null;
  const Scene = foundry.documents.Scene.implementation;
  const flags = { [SHOWN_FLAG]: true, [GENERATED_FLAG]: { type: map.type, seed: map.seed } };
  if ( place ) flags[GENERATED_FLAG].place = place;
  if ( map.tracks?.length ) flags[TRACKS_FLAG] = map.tracks;
  const scene = await Scene.create({
    name: name || `${map.type} ${map.seed}`,
    width: map.columns * TILE_SIZE,
    height: map.rows * TILE_SIZE,
    grid: { type: CONST.GRID_TYPES.SQUARE, size: TILE_SIZE },
    tokenVision: false,
    flags: { [FEO.id]: flags }
  });
  if ( !scene ) return null;

  // The scene's own first tile lies in from the corner of its canvas by the padding round it
  const { sceneX, sceneY, size } = scene.dimensions;
  await layPaint(scene, mapPaint(map, { top: Math.round(sceneY / size), left: Math.round(sceneX / size), open: true }));
  return scene;
}

/* -------------------------------------------- */

/**
 * Keep a scene with the place of the World Map it was made of: the place remembers it as its battlefield, and
 * the battle that waits there is fought on it if its saved encounter has no scene of its own yet. An encounter
 * that is set on another scene is left where it is. Runs for a Game Master.
 * @param {Scene} scene
 * @param {string} id       The place
 * @returns {Promise<{place: string, encounter: string}|null>}
 *   The names of the place and of the encounter that is now fought on the scene, blank if none is; null if
 *   the place is not on the map
 */
export async function keepWithPlace(scene, id) {
  if ( !game.user.isGM || !scene || !id ) return null;
  const map = await changePlace(id, (place) => (place.scene = scene.id));
  const place = map.places.find((other) => other.id === id);
  if ( !place ) return null;
  const encounter = encounterAt(place);
  if ( !encounter || game.scenes.get(encounter.scene) ) return { place: place.name, encounter: "" };
  await writeEncounter({ ...encounter, scene: scene.id, goal: null, groups: encounter.groups.map((group) => ({ ...group, tile: null })) });
  return { place: place.name, encounter: encounter.name };
}

import { FEO } from "../config.mjs";
import { mapPaint } from "../rules/mapgen.mjs";
import { SHOWN_FLAG, layPaint } from "./paint.mjs";

/**
 * The map generator in Foundry: a map that was made up (see rules/mapgen.mjs) becomes a scene of its own, its
 * ground painted as the terrain brush would paint it, so that it can be touched up with the brush afterwards.
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
 * the scene has no picture of its own. The painted ground is shown to the players, and the scene asks no
 * token for sight. Runs for a Game Master.
 * @param {BattleMap} map
 * @param {object} [options]
 * @param {string} [options.name]     What to call the scene
 * @returns {Promise<Scene|null>}
 */
export async function createMapScene(map, { name } = {}) {
  if ( !game.user.isGM || !map ) return null;
  const Scene = foundry.documents.Scene.implementation;
  const scene = await Scene.create({
    name: name || `${map.type} ${map.seed}`,
    width: map.columns * TILE_SIZE,
    height: map.rows * TILE_SIZE,
    grid: { type: CONST.GRID_TYPES.SQUARE, size: TILE_SIZE },
    tokenVision: false,
    flags: { [FEO.id]: { [SHOWN_FLAG]: true, [GENERATED_FLAG]: { type: map.type, seed: map.seed } } }
  });
  if ( !scene ) return null;

  // The scene's own first tile lies in from the corner of its canvas by the padding round it
  const { sceneX, sceneY, size } = scene.dimensions;
  await layPaint(scene, mapPaint(map, { top: Math.round(sceneY / size), left: Math.round(sceneX / size), open: true }));
  return scene;
}

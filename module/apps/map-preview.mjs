import { drawGround } from "../canvas/ground-art.mjs";

/**
 * The picture of a generated map in the generator's window: the ground as it will be drawn on the scene (see
 * canvas/ground-art.mjs), with the grid laid faintly over it. It is drawn on a canvas element from the map
 * alone, and knows nothing of Foundry.
 *
 * @import {BattleMap} from "../rules/mapgen.mjs"
 */

/**
 * Draw a map on a canvas element, as large as fits a box.
 * @param {HTMLCanvasElement} canvas
 * @param {BattleMap} map
 * @param {object} options
 * @param {Record<string, string>} options.tints    The colour of each kind of terrain
 * @param {number} [options.width]                  The box to fit the picture in, in CSS pixels
 * @param {number} [options.height]
 * @returns {number}                                The side of a tile as drawn, in CSS pixels
 */
export function drawMapPreview(canvas, map, { tints, width = 460, height = 380 }) {
  const cell = Math.max(Math.floor(Math.min(width / map.columns, height / map.rows)), 4);

  // The picture is drawn at twice its size at least, so that it stays sharp on any screen
  const sharp = Math.max(Math.ceil(window.devicePixelRatio || 1), 2);
  canvas.width = map.columns * cell * sharp;
  canvas.height = map.rows * cell * sharp;
  canvas.style.width = `${map.columns * cell}px`;
  canvas.style.height = `${map.rows * cell}px`;
  const pen = canvas.getContext("2d");
  drawGround(pen, {
    rows: map.rows,
    columns: map.columns,
    cell: cell * sharp,
    tints,
    groundAt: (i, j) => ({ terrain: map.tiles[i][j], elevation: map.heights[i][j] })
  });

  // The grid, faintly
  pen.strokeStyle = "rgba(0, 0, 0, .16)";
  pen.lineWidth = sharp;
  pen.beginPath();
  for ( let i = 1; i < map.rows; i++ ) {
    pen.moveTo(0, i * cell * sharp);
    pen.lineTo(canvas.width, i * cell * sharp);
  }
  for ( let j = 1; j < map.columns; j++ ) {
    pen.moveTo(j * cell * sharp, 0);
    pen.lineTo(j * cell * sharp, canvas.height);
  }
  pen.stroke();
  return cell;
}

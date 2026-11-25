import { drawGround, drawTracks } from "../canvas/ground-art.mjs";

/**
 * The pictures of the map generator's window: the generated map as it will be drawn on the scene (see
 * canvas/ground-art.mjs), with the grid laid faintly over it and a ring where the battle is joined and where it
 * leads, and the part of the World Map a map was made from. Each is drawn on a canvas element from what it is
 * given, and knows nothing of Foundry.
 *
 * @import {BattleMap} from "../rules/mapgen.mjs"
 * @import {Lens} from "../rules/mapgen-land.mjs"
 */

/** The colours of the ring where the battle is joined from, and of the ring where it leads. */
export const END_RINGS = { from: "#6fb0ff", to: "#ffd24d" };

/**
 * How sharply a picture is drawn: at twice its size at least, so that it stays sharp on any screen.
 * @returns {number}
 */
const sharpness = () => Math.max(Math.ceil(globalThis.devicePixelRatio || 1), 2);

/* -------------------------------------------- */

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
  const sharp = sharpness();
  const side = cell * sharp;
  canvas.width = map.columns * side;
  canvas.height = map.rows * side;
  canvas.style.width = `${map.columns * cell}px`;
  canvas.style.height = `${map.rows * cell}px`;
  const pen = canvas.getContext("2d");
  drawGround(pen, {
    rows: map.rows,
    columns: map.columns,
    cell: side,
    tints,
    groundAt: (i, j) => ({ terrain: map.tiles[i][j], elevation: map.heights[i][j] })
  });
  drawTracks(pen, map.tracks, { rows: map.rows, columns: map.columns, cell: side });

  // The grid, faintly
  pen.strokeStyle = "rgba(0, 0, 0, .16)";
  pen.lineWidth = sharp;
  pen.beginPath();
  for ( let i = 1; i < map.rows; i++ ) {
    pen.moveTo(0, i * side);
    pen.lineTo(canvas.width, i * side);
  }
  for ( let j = 1; j < map.columns; j++ ) {
    pen.moveTo(j * side, 0);
    pen.lineTo(j * side, canvas.height);
  }
  pen.stroke();

  // A ring where the battle is joined from, and one where it leads
  for ( const [end, color] of Object.entries(END_RINGS) ) {
    const tile = map.ends?.[end];
    if ( !tile ) continue;
    for ( const [stroke, wide] of [["rgba(0, 0, 0, .7)", 0.2], [color, 0.11]] ) {
      pen.strokeStyle = stroke;
      pen.lineWidth = side * wide;
      pen.beginPath();
      pen.arc((tile.j + 0.5) * side, (tile.i + 0.5) * side, side * 0.44, 0, Math.PI * 2);
      pen.stroke();
    }
  }
  return cell;
}

/* -------------------------------------------- */

/**
 * Draw the part of a World Map that lies under a lens on a canvas element, at a width.
 * @param {HTMLCanvasElement} canvas
 * @param {Lens} lens
 * @param {object} options
 * @param {CanvasImageSource[]} options.sheets      The World Map as it is painted, one layer over the other
 * @param {number} options.width                    How wide to draw it, in CSS pixels
 * @param {boolean} [options.grid]                  Lay the tiles of the battle map faintly over it
 * @param {import("../rules/mapgen.mjs").Track[]} [options.tracks]    The roads that cross it
 * @param {{x: number, y: number, picked: boolean}[]} [options.spots] The places on it, and the point picked
 */
export function drawLens(canvas, lens, { sheets, width, grid = false, tracks = [], spots = [] }) {
  const sharp = sharpness();
  const height = Math.round((width * lens.h) / lens.w);
  canvas.width = width * sharp;
  canvas.height = height * sharp;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const pen = canvas.getContext("2d");
  pen.imageSmoothingQuality = "high";
  for ( const sheet of sheets ) pen.drawImage(sheet, lens.x0, lens.y0, lens.w, lens.h, 0, 0, canvas.width, canvas.height);
  const cell = canvas.width / lens.columns;
  if ( grid ) {
    pen.strokeStyle = "rgba(20, 12, 4, .2)";
    pen.lineWidth = 1;
    pen.beginPath();
    for ( let i = 1; i < lens.rows; i++ ) {
      pen.moveTo(0, i * cell);
      pen.lineTo(canvas.width, i * cell);
    }
    for ( let j = 1; j < lens.columns; j++ ) {
      pen.moveTo(j * cell, 0);
      pen.lineTo(j * cell, canvas.height);
    }
    pen.stroke();
  }
  drawTracks(pen, tracks, { rows: lens.rows, columns: lens.columns, cell });
  for ( const spot of spots ) {
    pen.beginPath();
    pen.arc(((spot.x - lens.x0) / lens.scale) * cell, ((spot.y - lens.y0) / lens.scale) * cell, cell * (spot.picked ? 0.5 : 0.36), 0, Math.PI * 2);
    pen.fillStyle = spot.picked ? "#ffd24d" : "#f6e8bb";
    pen.fill();
    pen.strokeStyle = "#2c1e0f";
    pen.lineWidth = Math.max(cell * 0.14, sharp);
    pen.stroke();
  }
}

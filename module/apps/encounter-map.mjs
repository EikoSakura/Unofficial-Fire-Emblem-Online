import { drawGround } from "../canvas/ground-art.mjs";

/**
 * The picture of an encounter's map in the Encounter Builder: the scene's own picture or its painted ground,
 * the tiles the players set up on, and a disc for every unit where it would stand. It is drawn on a canvas
 * element from what it is told, and knows nothing of Foundry.
 */

/** The colours of each side: its disc, and the rim of it. */
const ARMIES = {
  player: ["#4a86e4", "#1c3a72"],
  enemy: ["#d85252", "#6d1d23"],
  ally: ["#4fae72", "#1d5636"],
  other: ["#dba338", "#76520f"]
};

/** The ground a map without a picture or paint of its own is drawn as. */
const OPEN = "plain";

/**
 * @typedef MapPicture
 * @property {number} columns
 * @property {number} rows
 * @property {(i: number, j: number) => string|null} terrainAt
 * @property {(i: number, j: number) => number} elevationAt
 * @property {(i: number, j: number) => string|null} zoneAt
 * @property {HTMLImageElement|null} [image]      The scene's picture, once it has loaded
 * @property {{i: number, j: number, army: string}[]} [others]   Tokens that are on the scene already
 * @property {{id: string, army: string, boss: boolean, recruit: boolean, turn: number, tiles: {i: number, j: number}[]}[]} [groups]
 * @property {string} [selected]                  The id of the group in hand
 * @property {{i: number, j: number}|null} [goal] The space the Objectives are about
 */

/**
 * Draw the map of an encounter on a canvas element, as large as fits a box.
 * @param {HTMLCanvasElement} canvas
 * @param {MapPicture} map
 * @param {object} options
 * @param {Record<string, string>} options.tints      The colour of each kind of terrain
 * @param {string} options.zone                       The colour of the tiles the players set up on
 * @param {number} [options.width]                    The box to fit the picture in, in CSS pixels
 * @param {number} [options.height]
 * @returns {number}                                  The side of a tile as drawn, in CSS pixels
 */
export function drawEncounterMap(canvas, map, { tints, zone, width = 560, height = 440 }) {
  const cell = Math.max(Math.floor(Math.min(width / map.columns, height / map.rows)), 4);
  const sharp = Math.max(Math.ceil(window.devicePixelRatio || 1), 2);
  const side = cell * sharp;
  canvas.width = map.columns * side;
  canvas.height = map.rows * side;
  canvas.style.width = `${map.columns * cell}px`;
  canvas.style.height = `${map.rows * cell}px`;
  canvas.dataset.cell = String(cell);
  const pen = canvas.getContext("2d");
  pen.clearRect(0, 0, canvas.width, canvas.height);

  // The ground: the scene's picture with what is painted over it, or the painted ground on open country
  if ( map.image ) pen.drawImage(map.image, 0, 0, canvas.width, canvas.height);
  drawGround(pen, {
    rows: map.rows,
    columns: map.columns,
    cell: side,
    tints,
    groundAt: (i, j) => {
      const terrain = map.terrainAt(i, j) ?? (map.image ? null : OPEN);
      return terrain ? { terrain, elevation: map.elevationAt(i, j) } : null;
    }
  });

  // The tiles the players set up on
  pen.fillStyle = zone;
  for ( let i = 0; i < map.rows; i++ ) {
    for ( let j = 0; j < map.columns; j++ ) {
      if ( !map.zoneAt(i, j) ) continue;
      pen.globalAlpha = 0.38;
      pen.fillRect(j * side, i * side, side, side);
      pen.globalAlpha = 1;
    }
  }

  // The grid, faintly
  pen.strokeStyle = "rgba(0, 0, 0, .18)";
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

  const centre = (tile) => [(tile.j + 0.5) * side, (tile.i + 0.5) * side];

  // What stands on the scene already: a small square each
  for ( const token of map.others ?? [] ) {
    const [x, y] = centre(token);
    const [fill, rim] = ARMIES[token.army] ?? ARMIES.other;
    const half = side * 0.26;
    pen.fillStyle = fill;
    pen.strokeStyle = rim;
    pen.lineWidth = sharp;
    pen.fillRect(x - half, y - half, half * 2, half * 2);
    pen.strokeRect(x - half, y - half, half * 2, half * 2);
  }

  // The space the Objectives are about: a gold lozenge
  if ( map.goal ) {
    const [x, y] = centre(map.goal);
    const reach = side * 0.44;
    pen.beginPath();
    pen.moveTo(x, y - reach);
    pen.lineTo(x + reach, y);
    pen.lineTo(x, y + reach);
    pen.lineTo(x - reach, y);
    pen.closePath();
    pen.fillStyle = "rgba(240, 212, 138, .55)";
    pen.strokeStyle = "#fff1c2";
    pen.lineWidth = sharp * 1.5;
    pen.fill();
    pen.stroke();
  }

  // The units of the encounter: a disc each, in the colour of its side
  const radius = side * 0.38;
  for ( const group of map.groups ?? [] ) {
    const [fill, rim] = ARMIES[group.army] ?? ARMIES.other;
    const inHand = group.id === map.selected;
    pen.globalAlpha = (map.selected && !inHand) ? 0.6 : 1;
    for ( const tile of group.tiles ) {
      const [x, y] = centre(tile);
      pen.beginPath();
      pen.arc(x, y, radius, 0, Math.PI * 2);
      if ( group.turn > 0 ) {
        // One that arrives later is an outline, with its turn on it where there is room
        pen.setLineDash([side * 0.14, side * 0.1]);
        pen.strokeStyle = fill;
        pen.lineWidth = sharp * 1.6;
        pen.fillStyle = "rgba(0, 0, 0, .35)";
        pen.fill();
        pen.stroke();
        pen.setLineDash([]);
        if ( cell >= 14 ) {
          pen.fillStyle = "#fff";
          pen.font = `700 ${Math.round(side * 0.36)}px sans-serif`;
          pen.textAlign = "center";
          pen.textBaseline = "middle";
          pen.fillText(String(group.turn), x, y + (side * 0.02));
        }
      }
      else {
        pen.fillStyle = fill;
        pen.fill();
        pen.strokeStyle = group.boss ? "#f0d48a" : group.recruit ? "#7fe0a4" : rim;
        pen.lineWidth = sharp * ((group.boss || group.recruit) ? 2 : 1.2);
        pen.stroke();
      }
      if ( inHand ) {
        pen.beginPath();
        pen.arc(x, y, radius + (sharp * 2.2), 0, Math.PI * 2);
        pen.strokeStyle = "#fff";
        pen.lineWidth = sharp * 1.4;
        pen.stroke();
      }
    }
  }
  pen.globalAlpha = 1;
  return cell;
}

/* -------------------------------------------- */

/**
 * The tile of a map that a click on its picture fell on.
 * @param {HTMLCanvasElement} canvas
 * @param {{clientX: number, clientY: number}} event
 * @param {{columns: number, rows: number}} map
 * @returns {{i: number, j: number}|null}     Null for a click off the map
 */
export function tileAt(canvas, event, map) {
  const box = canvas.getBoundingClientRect();
  if ( !box.width || !box.height ) return null;
  const j = Math.floor(((event.clientX - box.left) / box.width) * map.columns);
  const i = Math.floor(((event.clientY - box.top) / box.height) * map.rows);
  if ( (i < 0) || (j < 0) || (i >= map.rows) || (j >= map.columns) ) return null;
  return { i, j };
}

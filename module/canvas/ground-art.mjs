/**
 * The picture of a battle map's ground: every tile drawn as what it is. Grass has its tufts, a forest its
 * trees, a fort its keep and pennant, water its waves, and ground that lies high casts a shadow on the ground
 * below it. The same picture is drawn in the map generator's preview and on the scene itself, so that a map
 * looks on the table as it did when it was chosen.
 *
 * It is drawn with the 2D drawing of an ordinary canvas element, from tiles alone, and knows nothing of
 * Foundry. Every kind of terrain starts from its colour in `FEO.terrain.tints`, so that the picture, the
 * palette of the brush and the legend of the generator agree.
 */

/**
 * @typedef Ground
 * @property {string} terrain       A key of FEO.terrain.types
 * @property {number} elevation     How high the tile lies
 */

/** The side of a tile, in pixels, below which only its colour and the plainest of marks are drawn. */
const FINE = 14;

/** The kinds of terrain that are water, which laps against whatever else it meets. */
const WET = new Set(["water", "river"]);

/* -------------------------------------------- */
/*  Colour and Chance                           */
/* -------------------------------------------- */

/**
 * A colour made lighter or darker.
 * @param {string} hex      A colour as #rrggbb
 * @param {number} by       From -1, which is black, through 0, which leaves it alone, to 1, which is white
 * @returns {string}        A CSS colour
 */
export function shade(hex, by) {
  const value = parseInt(String(hex).slice(1), 16);
  const toward = by < 0 ? 0 : 255;
  const amount = Math.min(Math.abs(by), 1);
  const mix = (part) => Math.round(part + ((toward - part) * amount));
  return `rgb(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
}

/* -------------------------------------------- */

/**
 * A number from 0 up to 1 that is always the same for the same tile and the same count, so that a tile's
 * tufts and trees stand where they stood the last time it was drawn.
 * @param {number} i
 * @param {number} j
 * @param {number} count
 * @returns {number}
 */
function chance(i, j, count) {
  let mixed = (Math.imul(i + 11, 374761393) + Math.imul(j + 7, 668265263) + Math.imul(count + 3, 1274126177)) | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 1274126177);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

/* -------------------------------------------- */
/*  Shapes                                      */
/* -------------------------------------------- */

/**
 * @typedef Tile
 * What a drawing of one tile is given.
 * @property {CanvasRenderingContext2D} pen
 * @property {number} x                       The left edge of the tile
 * @property {number} y                       Its top edge
 * @property {number} c                       Its side
 * @property {Record<string, string>} tints   The colour of each kind of terrain
 * @property {string} tint                    The colour of its own
 * @property {(count: number) => number} luck The tile's own run of chance
 */

/**
 * Fill the whole tile.
 * @param {Tile} tile
 * @param {string} color
 */
function ground({ pen, x, y, c }, color) {
  pen.fillStyle = color;
  pen.fillRect(x, y, c, c);
}

/* -------------------------------------------- */

/**
 * Fill and outline a shape given by points inside the tile, each from 0 to 1 across and down it.
 * @param {Tile} tile
 * @param {number[][]} points
 * @param {string} fill
 * @param {string|null} [line]
 */
function shape({ pen, x, y, c }, points, fill, line = null) {
  pen.beginPath();
  points.forEach(([px, py], at) => (at ? pen.lineTo(x + (px * c), y + (py * c)) : pen.moveTo(x + (px * c), y + (py * c))));
  pen.closePath();
  pen.fillStyle = fill;
  pen.fill();
  if ( line ) {
    pen.strokeStyle = line;
    pen.lineWidth = Math.max(1, c * 0.035);
    pen.lineJoin = "round";
    pen.stroke();
  }
}

/* -------------------------------------------- */

/**
 * A tree seen from above and a little to the side: its shadow, its crown, and the light on the crown.
 * @param {Tile} tile
 * @param {number} px       Where its middle is, from 0 to 1 across the tile
 * @param {number} py       And down it
 * @param {number} r        Its radius, as a share of the tile
 * @param {string} color
 */
function tree({ pen, x, y, c }, px, py, r, color) {
  const [cx, cy, radius] = [x + (px * c), y + (py * c), r * c];
  pen.fillStyle = "rgba(0, 0, 0, .2)";
  pen.beginPath();
  pen.ellipse(cx + (radius * 0.25), cy + (radius * 0.55), radius, radius * 0.6, 0, 0, Math.PI * 2);
  pen.fill();
  pen.fillStyle = color;
  pen.strokeStyle = shade(color, -0.35);
  pen.lineWidth = Math.max(1, c * 0.03);
  pen.beginPath();
  pen.arc(cx, cy, radius, 0, Math.PI * 2);
  pen.fill();
  pen.stroke();
  pen.fillStyle = shade(color, 0.22);
  pen.beginPath();
  pen.arc(cx - (radius * 0.28), cy - (radius * 0.3), radius * 0.5, 0, Math.PI * 2);
  pen.fill();
}

/* -------------------------------------------- */

/**
 * Waves: short curling lines across the tile.
 * @param {Tile} tile
 * @param {string} color
 * @param {number} lines
 */
function waves({ pen, x, y, c, luck }, color, lines) {
  pen.strokeStyle = color;
  pen.lineWidth = Math.max(1, c * 0.05);
  pen.lineCap = "round";
  for ( let line = 0; line < lines; line++ ) {
    const left = x + (c * (0.12 + (luck(line) * 0.3)));
    const top = y + (c * (0.3 + (line * 0.36) + ((luck(line + 4) - 0.5) * 0.1)));
    const reach = c * 0.36;
    pen.beginPath();
    pen.moveTo(left, top);
    pen.quadraticCurveTo(left + (reach * 0.25), top - (c * 0.08), left + (reach * 0.5), top);
    pen.quadraticCurveTo(left + (reach * 0.75), top + (c * 0.08), left + reach, top);
    pen.stroke();
  }
}

/* -------------------------------------------- */

/**
 * Open grass under whatever else stands on the tile, a little lighter or darker from one tile to the next,
 * with tufts.
 * @param {Tile} tile
 * @param {number} [dim]    How much darker than open ground, as under trees
 */
function grass(tile, dim = 0) {
  const { pen, x, y, c, tints, luck } = tile;
  const green = tints.plain ?? "#a9c27a";
  ground(tile, shade(green, ((luck(0) - 0.5) * 0.07) - dim));
  pen.strokeStyle = shade(green, -0.2 - dim);
  pen.lineWidth = Math.max(1, c * 0.035);
  pen.lineCap = "round";
  for ( let tuft = 1; tuft <= 3; tuft++ ) {
    const tx = x + (c * (0.14 + (luck(tuft) * 0.72)));
    const ty = y + (c * (0.22 + (luck(tuft + 3) * 0.62)));
    pen.beginPath();
    pen.moveTo(tx - (c * 0.045), ty - (c * 0.07));
    pen.lineTo(tx, ty);
    pen.lineTo(tx + (c * 0.045), ty - (c * 0.07));
    pen.stroke();
  }
}

/* -------------------------------------------- */
/*  Terrain                                     */
/* -------------------------------------------- */

/** How each kind of terrain is drawn on a tile large enough to show it. */
const DRAW = {
  plain: (tile) => grass(tile),

  forest: (tile) => {
    grass(tile, 0.1);
    const jitter = (count) => (tile.luck(count) - 0.5) * 0.08;
    for ( const [at, [px, py]] of [[0.3, 0.34], [0.7, 0.44], [0.44, 0.72]].entries() ) tree(tile, px + jitter(at + 7), py + jitter(at + 10), 0.2, tile.tint);
  },

  thicket: (tile) => {
    ground(tile, shade(tile.tints.forest ?? tile.tint, -0.12));
    const jitter = (count) => (tile.luck(count) - 0.5) * 0.06;
    const stand = [[0.24, 0.26], [0.62, 0.22], [0.82, 0.5], [0.42, 0.52], [0.2, 0.76], [0.64, 0.8]];
    for ( const [at, [px, py]] of stand.entries() ) tree(tile, px + jitter(at + 7), py + jitter(at + 13), 0.17, tile.tint);
  },

  wardwood: (tile) => {
    grass(tile, 0.06);
    tree(tile, 0.5, 0.5, 0.31, tile.tint);
    tile.pen.fillStyle = "rgba(255, 255, 255, .85)";
    for ( const [px, py] of [[0.36, 0.4], [0.6, 0.34], [0.56, 0.62]] ) {
      tile.pen.beginPath();
      tile.pen.arc(tile.x + (px * tile.c), tile.y + (py * tile.c), tile.c * 0.03, 0, Math.PI * 2);
      tile.pen.fill();
    }
  },

  healhedge: (tile) => {
    const { pen, x, y, c, tint } = tile;
    grass(tile);
    pen.fillStyle = "rgba(0, 0, 0, .18)";
    pen.fillRect(x + (c * 0.16), y + (c * 0.66), c * 0.72, c * 0.1);
    pen.fillStyle = tint;
    pen.strokeStyle = shade(tint, -0.4);
    pen.lineWidth = Math.max(1, c * 0.035);
    pen.beginPath();
    pen.roundRect(x + (c * 0.14), y + (c * 0.3), c * 0.72, c * 0.4, c * 0.14);
    pen.fill();
    pen.stroke();

    // The sign of healing, so that the hedge is known for what it does
    pen.strokeStyle = "#ffffff";
    pen.lineWidth = Math.max(1.5, c * 0.07);
    pen.lineCap = "round";
    pen.beginPath();
    pen.moveTo(x + (c * 0.5), y + (c * 0.38));
    pen.lineTo(x + (c * 0.5), y + (c * 0.62));
    pen.moveTo(x + (c * 0.38), y + (c * 0.5));
    pen.lineTo(x + (c * 0.62), y + (c * 0.5));
    pen.stroke();
  },

  hill: (tile) => {
    const { pen, x, y, c, tint } = tile;
    grass(tile);
    for ( const [px, py, wide, tall] of [[0.34, 0.56, 0.5, 0.26], [0.56, 0.84, 0.8, 0.36]] ) {
      pen.beginPath();
      pen.moveTo(x + ((px - (wide / 2)) * c), y + (py * c));
      pen.quadraticCurveTo(x + (px * c), y + ((py - (tall * 2)) * c), x + ((px + (wide / 2)) * c), y + (py * c));
      pen.closePath();
      pen.fillStyle = tint;
      pen.fill();
      pen.strokeStyle = shade(tint, -0.35);
      pen.lineWidth = Math.max(1, c * 0.035);
      pen.stroke();

      // Light on the side the sun is on
      pen.strokeStyle = shade(tint, 0.3);
      pen.beginPath();
      pen.moveTo(x + ((px - (wide * 0.3)) * c), y + ((py - (tall * 0.42)) * c));
      pen.quadraticCurveTo(x + ((px - (wide * 0.14)) * c), y + ((py - (tall * 0.82)) * c), x + (px * c), y + ((py - (tall * 0.88)) * c));
      pen.stroke();
    }
  },

  mountain: (tile) => {
    const { tint } = tile;
    ground(tile, shade(tint, -0.1));
    const line = shade(tint, -0.5);
    for ( const [left, top, right, base] of [[0.46, 0.4, 0.96, 0.9], [0.06, 0.14, 0.74, 0.9]] ) {
      const peak = (left + right) / 2;
      shape(tile, [[left, base], [peak, top], [peak, base]], shade(tint, 0.28));
      shape(tile, [[peak, top], [right, base], [peak, base]], shade(tint, -0.22));
      shape(tile, [[left, base], [peak, top], [right, base]], "rgba(0, 0, 0, 0)", line);
      const cap = (base - top) * 0.26;
      const spread = (right - left) * 0.13;
      shape(tile, [[peak, top], [peak - spread, top + cap], [peak, top + (cap * 0.72)], [peak + spread, top + cap]], "#ffffff");
    }
  },

  cliff: (tile) => {
    const { pen, x, y, c, tint, luck } = tile;
    ground(tile, tint);
    pen.fillStyle = shade(tint, 0.22);
    pen.fillRect(x, y, c, c * 0.14);
    pen.strokeStyle = shade(tint, -0.35);
    pen.lineWidth = Math.max(1, c * 0.04);
    pen.lineCap = "round";
    for ( let layer = 0; layer < 3; layer++ ) {
      const top = y + (c * (0.34 + (layer * 0.22)));
      pen.beginPath();
      pen.moveTo(x + (c * 0.08), top);
      for ( let step = 1; step <= 4; step++ ) pen.lineTo(x + (c * (0.08 + (step * 0.21))), top + (c * (luck((layer * 4) + step) - 0.5) * 0.12));
      pen.stroke();
    }
  },

  fort: (tile) => {
    const { pen, x, y, c, tint } = tile;
    grass(tile);
    const line = shade(tint, -0.55);
    pen.fillStyle = "rgba(0, 0, 0, .2)";
    pen.fillRect(x + (c * 0.24), y + (c * 0.8), c * 0.62, c * 0.07);
    pen.fillStyle = shade(tint, 0.12);
    pen.strokeStyle = line;
    pen.lineWidth = Math.max(1, c * 0.035);
    pen.lineJoin = "round";
    pen.beginPath();
    pen.rect(x + (c * 0.2), y + (c * 0.4), c * 0.6, c * 0.42);
    for ( const left of [0.2, 0.43, 0.66] ) pen.rect(x + (c * left), y + (c * 0.28), c * 0.14, c * 0.12);
    pen.fill();
    pen.stroke();

    // The gate, and a pennant over the middle of the wall
    pen.fillStyle = line;
    pen.beginPath();
    pen.roundRect(x + (c * 0.42), y + (c * 0.58), c * 0.16, c * 0.24, [c * 0.08, c * 0.08, 0, 0]);
    pen.fill();
    pen.beginPath();
    pen.moveTo(x + (c * 0.5), y + (c * 0.28));
    pen.lineTo(x + (c * 0.5), y + (c * 0.08));
    pen.stroke();
    shape(tile, [[0.5, 0.08], [0.7, 0.14], [0.5, 0.2]], "#c8443c", line);
  },

  house: (tile) => {
    const { pen, x, y, c, tint } = tile;
    grass(tile);
    const line = shade(tint, -0.55);
    pen.fillStyle = "rgba(0, 0, 0, .2)";
    pen.fillRect(x + (c * 0.28), y + (c * 0.8), c * 0.54, c * 0.07);
    pen.fillStyle = "#eadcc0";
    pen.strokeStyle = line;
    pen.lineWidth = Math.max(1, c * 0.035);
    pen.lineJoin = "round";
    pen.beginPath();
    pen.rect(x + (c * 0.24), y + (c * 0.48), c * 0.52, c * 0.34);
    pen.fill();
    pen.stroke();
    shape(tile, [[0.14, 0.5], [0.5, 0.18], [0.86, 0.5]], tint, line);
    pen.fillStyle = line;
    pen.fillRect(x + (c * 0.44), y + (c * 0.62), c * 0.12, c * 0.2);
  },

  cover: (tile) => {
    const { pen, x, y, c, tint } = tile;
    grass(tile);
    pen.fillStyle = "rgba(0, 0, 0, .2)";
    pen.fillRect(x + (c * 0.14), y + (c * 0.76), c * 0.76, c * 0.07);
    pen.fillStyle = shade(tint, 0.1);
    pen.strokeStyle = shade(tint, -0.5);
    pen.lineWidth = Math.max(1, c * 0.035);

    // Sacks, three below and two on top of them
    for ( const [px, py] of [[0.26, 0.68], [0.5, 0.68], [0.74, 0.68], [0.38, 0.5], [0.62, 0.5]] ) {
      pen.beginPath();
      pen.ellipse(x + (px * c), y + (py * c), c * 0.14, c * 0.1, 0, 0, Math.PI * 2);
      pen.fill();
      pen.stroke();
    }
  },

  river: (tile) => {
    ground(tile, shade(tile.tint, (tile.luck(0) - 0.5) * 0.06));
    waves(tile, "rgba(255, 255, 255, .6)", 2);
  },

  water: (tile) => {
    ground(tile, shade(tile.tint, (tile.luck(0) - 0.5) * 0.08));
    waves(tile, "rgba(255, 255, 255, .34)", 2);
  },

  desert: (tile) => {
    const { pen, x, y, c, tint, luck } = tile;
    ground(tile, shade(tint, (luck(0) - 0.5) * 0.07));
    pen.strokeStyle = shade(tint, -0.16);
    pen.lineWidth = Math.max(1, c * 0.035);
    pen.lineCap = "round";
    for ( let ripple = 0; ripple < 2; ripple++ ) {
      const left = x + (c * (0.14 + (luck(ripple + 1) * 0.34)));
      const top = y + (c * (0.34 + (ripple * 0.34)));
      pen.beginPath();
      pen.moveTo(left, top);
      pen.quadraticCurveTo(left + (c * 0.18), top - (c * 0.09), left + (c * 0.38), top);
      pen.stroke();
    }
  }
};

/** How the kinds of terrain that need a mark to be told apart are drawn on a tile too small for a picture. */
const MARK = {
  fort: (tile) => {
    tile.pen.fillStyle = "rgba(255, 255, 255, .92)";
    tile.pen.fillRect(tile.x + (tile.c * 0.26), tile.y + (tile.c * 0.26), tile.c * 0.48, tile.c * 0.48);
  },
  house: (tile) => shape(tile, [[0.5, 0.2], [0.82, 0.74], [0.18, 0.74]], "rgba(255, 255, 255, .92)")
};

/* -------------------------------------------- */
/*  The Lie of the Land                         */
/* -------------------------------------------- */

/**
 * Show how a tile lies against its neighbours: ground that stands above the tile beside it is lit along its
 * far edges and casts a shadow along its near ones, and water laps white against the land.
 * @param {Tile} tile
 * @param {Ground} here
 * @param {(Ground|null)[]} around      The tiles above, to the right of, below and to the left of it
 */
function edges({ pen, x, y, c }, here, around) {
  const [north, east, south, west] = around;
  const level = here.elevation || 0;
  if ( level > 0 ) {
    pen.fillStyle = `rgba(255, 255, 255, ${Math.min(level * 0.07, 0.22)})`;
    pen.fillRect(x, y, c, c);
  }
  const lower = (other) => (other?.elevation || 0) < level;
  if ( lower(south) ) {
    pen.fillStyle = "rgba(0, 0, 0, .38)";
    pen.fillRect(x, y + (c * 0.86), c, c * 0.14);
  }
  if ( lower(east) ) {
    pen.fillStyle = "rgba(0, 0, 0, .26)";
    pen.fillRect(x + (c * 0.92), y, c * 0.08, c);
  }
  if ( lower(north) ) {
    pen.fillStyle = "rgba(255, 255, 255, .5)";
    pen.fillRect(x, y, c, Math.max(1, c * 0.06));
  }
  if ( lower(west) ) {
    pen.fillStyle = "rgba(255, 255, 255, .3)";
    pen.fillRect(x, y, Math.max(1, c * 0.05), c);
  }

  // The shore
  if ( !WET.has(here.terrain) ) return;
  const dry = (other) => !!other && !WET.has(other.terrain);
  const foam = Math.max(1, c * 0.07);
  pen.fillStyle = "rgba(255, 255, 255, .5)";
  if ( dry(north) ) pen.fillRect(x, y, c, foam);
  if ( dry(south) ) pen.fillRect(x, y + c - foam, c, foam);
  if ( dry(west) ) pen.fillRect(x, y, foam, c);
  if ( dry(east) ) pen.fillRect(x + c - foam, y, foam, c);
}

/* -------------------------------------------- */
/*  The Whole Picture                           */
/* -------------------------------------------- */

/**
 * Draw the ground of a map: its tiles from the top left of the drawing onwards, each a square of the same
 * side. A tile nothing is known of is left as it was, so that whatever lies under the drawing shows there.
 * @param {CanvasRenderingContext2D} pen
 * @param {object} map
 * @param {number} map.rows
 * @param {number} map.columns
 * @param {number} map.cell                                     The side of a tile, in pixels
 * @param {Record<string, string>} map.tints                    The colour of each kind of terrain
 * @param {(i: number, j: number) => Ground|null} map.groundAt  What a tile is, or null for one to leave alone
 * @returns {number}                                            How many tiles were drawn
 */
export function drawGround(pen, { rows, columns, cell, tints, groundAt }) {
  const known = (i, j) => ((i >= 0) && (j >= 0) && (i < rows) && (j < columns)) ? groundAt(i, j) : null;
  const fine = cell >= FINE;
  let drawn = 0;
  for ( let i = 0; i < rows; i++ ) {
    for ( let j = 0; j < columns; j++ ) {
      const here = known(i, j);
      if ( !here ) continue;
      drawn++;
      const tint = tints[here.terrain] ?? "#888888";
      const tile = { pen, x: j * cell, y: i * cell, c: cell, tints, tint, luck: (count) => chance(i, j, count) };
      pen.save();
      pen.beginPath();
      pen.rect(tile.x, tile.y, cell, cell);
      pen.clip();
      if ( fine && DRAW[here.terrain] ) DRAW[here.terrain](tile);
      else {
        ground(tile, tint);
        MARK[here.terrain]?.(tile);
      }
      edges(tile, here, [known(i - 1, j), known(i, j + 1), known(i + 1, j), known(i, j - 1)]);
      pen.restore();
    }
  }
  return drawn;
}

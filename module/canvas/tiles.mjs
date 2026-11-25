/**
 * The squares of the battle map: where a unit can go, what it can strike or reach with a staff, where a skill
 * can warp it, what a foe threatens, and the area a skill would take in. Each tile is a square of its own with a pale edge and a sheen, set a little apart from its
 * neighbours, and a slow gleam runs across them all.
 *
 * Nothing here knows of Foundry: a field is given the ticker that drives it and the place of each tile, and
 * draws with PIXI alone.
 */

/**
 * @typedef TileStyle
 * @property {string} top         The colour at the top of a tile
 * @property {string} base        The colour at its foot
 * @property {string} edge        The pale line just inside its rim
 * @property {string} rim         The dark line round it, which keeps it apart from bright ground
 * @property {number} alpha       How solid the tile is at its brightest
 * @property {boolean} [hatched]  Is it struck through with slanting lines, to tell it from the others?
 */

/**
 * How each kind of square is painted.
 * @type {Record<string, TileStyle>}
 */
export const TILE_STYLES = {
  move: { top: "#4f95ff", base: "#1648d8", edge: "#bcd8ff", rim: "#082060", alpha: 0.74 },
  strike: { top: "#ff5f52", base: "#d0141f", edge: "#ffc9c2", rim: "#5c080e", alpha: 0.72 },
  staff: { top: "#4fdc84", base: "#0c9448", edge: "#c8ffdc", rim: "#064022", alpha: 0.7 },
  warp: { top: "#b184ff", base: "#6a25e0", edge: "#e6d6ff", rim: "#2a0a66", alpha: 0.72 },
  threat: { top: "#e86aa8", base: "#a01f66", edge: "#ffcfe6", rim: "#4a0a2e", alpha: 0.56, hatched: true },
  area: { top: "#ffbe55", base: "#e0730f", edge: "#ffe9c2", rim: "#5a2a04", alpha: 0.74 }
};

/** How the gleam runs over the squares: how long one pass takes, how far it dims them, how tightly it is drawn. */
const GLEAM = { period: 2000, depth: 0.16, spread: 0.5 };

/* -------------------------------------------- */

/**
 * Draw one tile on a canvas the size of a space of the grid.
 * @param {CanvasRenderingContext2D} context
 * @param {number} size             The side of the canvas, in pixels
 * @param {TileStyle} style
 * @param {number} [solid]          How much of its body is filled in, from 0 to 1. A tile that is less than
 *                                  solid lets the map show through its middle and keeps its rim, with a band of
 *                                  its colour inside it, so that it can still be told from the other kinds
 */
export function drawTile(context, size, style, solid = 1) {
  const gap = Math.max(1, Math.round(size * 0.035));
  const side = size - (gap * 2);
  const radius = size * 0.08;
  const line = Math.max(1, size * 0.03);
  const filled = Math.min(Math.max(Number.isFinite(solid) ? solid : 1, 0), 1);
  const body = () => {
    context.beginPath();
    context.roundRect(gap, gap, side, side, radius);
  };
  context.clearRect(0, 0, size, size);

  // The body of the tile, paler at the top
  const fill = context.createLinearGradient(0, gap, 0, gap + side);
  fill.addColorStop(0, style.top);
  fill.addColorStop(1, style.base);
  context.fillStyle = fill;
  context.globalAlpha = filled;
  body();
  context.fill();
  context.globalAlpha = 1;

  // A sheen across its upper half, and the lines of a tile that is struck through
  context.save();
  body();
  context.clip();
  const sheen = context.createLinearGradient(0, gap, 0, gap + (side * 0.55));
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.2)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = sheen;
  context.globalAlpha = filled;
  context.fillRect(gap, gap, side, side * 0.55);

  // The band of colour that stands in for a body that was thinned out
  if ( filled < 1 ) {
    const band = line * 2.2;
    const inset = line + (band / 2);
    context.globalAlpha = (1 - filled) * 0.9;
    context.lineWidth = band;
    context.strokeStyle = style.top;
    context.beginPath();
    context.roundRect(gap + inset, gap + inset, side - (inset * 2), side - (inset * 2), Math.max(radius - inset, 0));
    context.stroke();
  }
  if ( style.hatched ) {
    context.strokeStyle = style.rim;
    context.globalAlpha = 0.5;
    context.lineWidth = line;
    const step = size * 0.2;
    for ( let at = -size; at < size; at += step ) {
      context.beginPath();
      context.moveTo(at, size);
      context.lineTo(at + size, 0);
      context.stroke();
    }
  }
  context.restore();

  // The dark rim, and the pale line just inside it
  context.lineWidth = line;
  context.strokeStyle = style.rim;
  body();
  context.stroke();
  context.lineWidth = Math.max(1, line * 0.8);
  context.strokeStyle = style.edge;
  context.beginPath();
  context.roundRect(gap + line, gap + line, side - (line * 2), side - (line * 2), Math.max(radius - line, 0));
  context.stroke();
}

/* -------------------------------------------- */

/**
 * How solid a tile is at a moment, as the gleam passes over it.
 * @param {number} alpha      How solid it is at its brightest
 * @param {number} time       The moment, in milliseconds
 * @param {number} wave       Where the tile lies along the way the gleam runs: its row plus its column
 * @returns {number}
 */
export function gleamAt(alpha, time, wave) {
  const turn = ((time / GLEAM.period) * Math.PI * 2) - (wave * GLEAM.spread);
  return alpha * (1 - (GLEAM.depth * (0.5 - (0.5 * Math.sin(turn)))));
}

/* -------------------------------------------- */

/**
 * The squares painted on a map. They are drawn again only when what they show has changed, and gleam for as
 * long as there are any.
 */
export class TileField {

  /**
   * @param {object} options
   * @param {object} options.ticker       The PIXI ticker that drives the gleam
   * @param {boolean} [options.still]     Should the squares hold still, for a user who has asked for less motion?
   */
  constructor({ ticker, still = false }) {
    this.#ticker = ticker;
    this.#still = still;
    this.container = new PIXI.Container();
    this.container.eventMode = "none";
  }

  /** The squares, to be placed on the canvas by whoever made the field. @type {PIXI.Container} */
  container;

  #ticker;

  #still;

  /** The picture of each kind of tile, by kind. @type {Map<string, PIXI.Texture>} */
  #textures = new Map();

  /** The tiles now shown. @type {{sprite: PIXI.Sprite, alpha: number, wave: number}[]} */
  #tiles = [];

  /** What is now shown, in a word: nothing is drawn again while it stays the same. */
  #shown = "";

  #size = 0;

  /** How much of each square's body is filled in, as the pictures of the tiles were drawn. */
  #solid = 1;

  #gleaming = false;

  /* -------------------------------------------- */

  /** Has the canvas the field was placed on been torn down? @type {boolean} */
  get destroyed() {
    return this.container.destroyed;
  }

  /* -------------------------------------------- */

  /**
   * Show the squares of a map.
   * @param {Record<string, Iterable<string>>} paint    The tiles of each kind, by name
   * @param {(key: string) => {x: number, y: number, wave: number}} place
   *                                  Where a tile lies on the canvas, and along the way the gleam runs
   * @param {number} size             The side of a space of the grid, in pixels
   * @param {number} [solid]          How much of each square's body is filled in, from 0 to 1 (see `drawTile`)
   */
  show(paint, place, size, solid = 1) {
    const kinds = Object.keys(TILE_STYLES).map((kind) => [kind, Array.from(paint[kind] ?? [])]);
    const shown = `${size}|${solid}|${kinds.map(([kind, keys]) => `${kind}:${keys.join(" ")}`).join("|")}`;
    if ( shown === this.#shown ) return;
    this.#shown = shown;
    for ( const child of this.container.removeChildren() ) child.destroy();
    this.#tiles = [];
    if ( (size !== this.#size) || (solid !== this.#solid) ) this.#forget();
    this.#size = size;
    this.#solid = solid;
    for ( const [kind, keys] of kinds ) {
      if ( !keys.length ) continue;
      const style = TILE_STYLES[kind];
      const texture = this.#texture(kind);
      for ( const key of keys ) {
        const { x, y, wave } = place(key);
        const sprite = new PIXI.Sprite(texture);
        sprite.position.set(x, y);
        sprite.width = size;
        sprite.height = size;
        sprite.alpha = style.alpha;
        this.container.addChild(sprite);
        this.#tiles.push({ sprite, alpha: style.alpha, wave });
      }
    }
    this.#gleam(!this.#still && (this.#tiles.length > 0));
  }

  /* -------------------------------------------- */

  /**
   * The picture of a kind of tile, drawn the first time it is asked for.
   * @param {string} kind     A key of TILE_STYLES
   * @returns {PIXI.Texture}
   */
  #texture(kind) {
    let texture = this.#textures.get(kind);
    if ( texture?.baseTexture ) return texture;

    // Drawn at twice the size of a space, within reason, so that it stays sharp when the map is zoomed in
    const side = Math.min(Math.max(Math.round(this.#size * 2), 64), 256);
    const picture = document.createElement("canvas");
    picture.width = side;
    picture.height = side;
    drawTile(picture.getContext("2d"), side, TILE_STYLES[kind], this.#solid);
    texture = PIXI.Texture.from(picture);
    this.#textures.set(kind, texture);
    return texture;
  }

  /* -------------------------------------------- */

  /** Throw the pictures of the tiles away, as when the size of the grid has changed. */
  #forget() {
    for ( const texture of this.#textures.values() ) if ( texture?.baseTexture ) texture.destroy(true);
    this.#textures.clear();
  }

  /* -------------------------------------------- */

  /**
   * Start or stop the gleam.
   * @param {boolean} on
   */
  #gleam(on) {
    if ( on === this.#gleaming ) return;
    this.#gleaming = on;
    if ( on ) this.#ticker.add(this.#onTick, this);
    else this.#ticker.remove(this.#onTick, this);
  }

  /* -------------------------------------------- */

  /** Pass the gleam over the squares. Runs on every frame while there are any. */
  #onTick() {
    try {
      if ( this.destroyed ) return this.#gleam(false);
      const time = this.#ticker.lastTime;
      for ( const tile of this.#tiles ) tile.sprite.alpha = gleamAt(tile.alpha, time, tile.wave);
    } catch(err) {
      console.error(err);
      this.#gleam(false);
    }
  }

  /* -------------------------------------------- */

  /** Take the squares off the canvas for good. */
  destroy() {
    this.#gleam(false);
    this.#forget();
    this.#tiles = [];
    if ( !this.container.destroyed ) this.container.destroy({ children: true });
  }
}

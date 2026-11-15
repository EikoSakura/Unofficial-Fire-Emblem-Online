import { keyTile } from "../rules/reach.mjs";
import { battle, fightsIn, hasActed, turnState } from "../helpers/phases.mjs";
import { TileField } from "./tiles.mjs";

/**
 * The battle map on the canvas: painting where a unit can go and what it can strike, the path of a move, and
 * handing clicks on tiles and tokens to whoever is listening. The Battle HUD listens; this module only draws
 * and reports, and decides nothing.
 *
 * Everything here runs inside Foundry's own drawing and event handling, so nothing in it may throw: whatever
 * goes wrong is logged, and the canvas carries on as if this module were not there.
 */

/**
 * @typedef BattleListener
 * @property {(token: Token, event: Event) => boolean} wantsToken     Would a click on this token mean something?
 * @property {(token: Token, event: Event) => void} onTokenClick      A token it wanted was clicked
 * @property {(tile: {i: number, j: number}, event: Event) => boolean} onTileClick
 *                                            An empty tile was clicked; true if the click was used up
 * @property {(tile: {i: number, j: number}|null) => void} onTileHover
 *                                            The pointer is over another tile, or has left the map
 */

/**
 * Where the squares lie among the things of the scene: over its tiles and drawings, under its tokens, so that
 * a unit stands on its square and is not painted over by it.
 */
const TILE_SORT_LAYER = 650;

/** What draws on the canvas for the battle map, and who listens to it. */
export const battleCanvas = {

  /** @type {BattleListener|null} */
  listener: null,

  /** The squares painted on the map. @type {TileField|null} */
  tiles: null,

  /** The line of a move being considered, drawn over the squares and under the tokens. */
  path: null,

  /** What holds the squares and the path on the ground of the scene. @type {PIXI.Container|null} */
  ground: null,

  /** The tile the pointer was last over. */
  hover: null,

  /* -------------------------------------------- */

  /**
   * Ask the listener something, and take no for an answer if it fails.
   * @param {string} method
   * @param {...any} args
   * @returns {any}
   */
  ask(method, ...args) {
    try {
      return this.listener?.[method]?.(...args) ?? false;
    } catch(err) {
      console.error(err);
      return false;
    }
  },

  /* -------------------------------------------- */

  /**
   * Paint the map: the tiles a unit can move to, strike or reach with a staff, the threat of another, and the
   * path of a move. Whatever was painted before is wiped.
   * @param {object} [paint]
   * @param {Iterable<string>} [paint.move]       Tiles by name, "row,column"
   * @param {Iterable<string>} [paint.strike]
   * @param {Iterable<string>} [paint.staff]
   * @param {Iterable<string>} [paint.threat]
   * @param {{i: number, j: number}[]} [paint.path]     The tiles of a move, from where it starts to where it ends
   */
  draw(paint = {}) {
    try {
      if ( !canvas?.ready || !canvas.primary || !canvas.grid?.isSquare ) return;

      // The squares and the path lie on the ground together, the path over the squares. They go with the
      // scene, and are laid out anew on the next one
      const lost = (thing) => !thing || thing.destroyed;
      if ( lost(this.tiles) || lost(this.path) || lost(this.ground) || !this.ground.parent ) {
        this.tiles?.destroy();
        if ( !lost(this.ground) ) this.ground.destroy({ children: true });
        const still = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        this.tiles = new TileField({ ticker: canvas.app.ticker, still });
        this.path = new PIXI.Graphics();
        const ground = this.ground = new PIXI.Container();
        ground.eventMode = "none";
        ground.addChild(this.tiles.container, this.path);
        ground.elevation = canvas.primary.background?.elevation ?? 0;
        ground.sortLayer = TILE_SORT_LAYER;
        ground.sort = 0;

        // Should the scene not take them, they are laid over the grid instead, where they cover the tokens
        try {
          canvas.primary.addChild(ground);
        } catch(err) {
          console.error(err);
          canvas.interface.grid.addChild(ground);
        }
      }
      this.tiles.show(paint, (key) => {
        const tile = keyTile(key);
        const { x, y } = canvas.grid.getTopLeftPoint(tile);
        return { x, y, wave: tile.i + tile.j };
      }, canvas.grid.size);
      this._drawPath(paint.path ?? []);
    } catch(err) {
      console.error(err);
    }
  },

  /* -------------------------------------------- */

  /**
   * Draw the line of a move through the middle of its tiles, with an arrowhead where it ends.
   * @param {{i: number, j: number}[]} tiles
   */
  _drawPath(tiles) {
    const line = this.path;
    if ( !line || line.destroyed ) return;
    line.clear();
    if ( tiles.length < 2 ) return;
    const points = tiles.map((tile) => canvas.grid.getCenterPoint(tile));
    const size = canvas.grid.size;
    for ( const [width, color, alpha] of [[size * 0.16, 0x000000, 0.55], [size * 0.08, 0xF3D98F, 1]] ) {
      line.lineStyle({ width, color, alpha, cap: "round", join: "round" });
      line.moveTo(points[0].x, points[0].y);
      for ( const point of points.slice(1) ) line.lineTo(point.x, point.y);
    }

    // The arrowhead points the way of the last step
    const end = points.at(-1);
    const before = points.at(-2);
    const angle = Math.atan2(end.y - before.y, end.x - before.x);
    const head = size * 0.22;
    const corner = (turn) => [end.x + (Math.cos(angle + turn) * head), end.y + (Math.sin(angle + turn) * head)];
    line.lineStyle(size * 0.04, 0x000000, 0.55);
    line.beginFill(0xF3D98F, 1);
    line.drawPolygon([...corner(0), ...corner(2.4), ...corner(-2.4)]);
    line.endFill();
  },

  /* -------------------------------------------- */

  /**
   * Have the tokens of a unit drawn again, as when it has acted or its side's Phase begins.
   * @param {Actor|null} [actor]    Every token on the canvas without one
   */
  refreshTokens(actor = null) {
    try {
      for ( const token of canvas?.tokens?.placeables ?? [] ) {
        if ( actor && (token.actor !== actor) && (token.document.actorId !== actor.id) ) continue;
        token.renderFlags.set({ refreshState: true });
      }
    } catch(err) {
      console.error(err);
    }
  },

  /* -------------------------------------------- */

  /**
   * Follow the pointer over the canvas from tile to tile.
   * @param {PointerEvent|null} event     Null when the pointer has left the canvas
   */
  track(event) {
    try {
      let tile = null;
      if ( event && canvas?.ready && canvas.grid?.isSquare ) {
        const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
        const { i, j } = canvas.grid.getOffset(point);
        tile = { i, j };
      }
      if ( (tile?.i === this.hover?.i) && (tile?.j === this.hover?.j) ) return;
      this.hover = tile;
      this.ask("onTileHover", tile);
    } catch(err) {
      console.error(err);
    }
  }
};

/* -------------------------------------------- */

/**
 * Is a token moved by clicks on the map and nothing else? A unit fighting in the battle of its scene goes
 * where a tile of its reach is clicked, so its token is neither dragged nor stepped with the keys. A unit that
 * is down is left out, and so is every token for a Game Master who has lifted the limits on movement, who
 * puts it where they please.
 * @param {Token|TokenDocument|null} token
 * @returns {boolean}
 */
export function movedByClick(token) {
  try {
    const document = token?.document ?? token;
    const actor = document?.actor;
    if ( (actor?.type !== "unit") || !document.parent?.grid?.isSquare ) return false;
    if ( game.user.isGM && game.settings.get("core", "unconstrainedMovement") ) return false;
    const state = turnState(actor, document);
    return (state === "ready") || (state === "acted") || (state === "waiting");
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

const { Token } = foundry.canvas.placeables;
const { TokenLayer } = foundry.canvas.layers;

/**
 * A token on the battle map. A click on it may mean an attack on its unit rather than selecting it, a unit
 * fighting in a battle is not lifted by a drag, and one that has taken its Action this Phase is dimmed and
 * ticked off.
 */
export class FeoToken extends Token {

  /**
   * The tick of a unit that has acted, drawn in the corner of its token.
   * @type {PIXI.Graphics|null}
   */
  #tick = null;

  /* -------------------------------------------- */

  /** @override */
  _canControl(user, event) {
    if ( this.layer?.active && (event?.type === "pointerdown") && battleCanvas.ask("wantsToken", this, event) ) return true;
    return super._canControl(user, event);
  }

  /* -------------------------------------------- */

  /** @override */
  _onClickLeft(event) {
    if ( battleCanvas.ask("wantsToken", this, event) ) {
      event.stopPropagation();
      battleCanvas.ask("onTokenClick", this, event);
      return;
    }
    return super._onClickLeft(event);
  }

  /* -------------------------------------------- */

  /**
   * In a battle a unit is moved by a click on a tile of its reach, and by nothing else: its token stays down
   * when it is dragged.
   * @override
   */
  _canDrag(user, event) {
    if ( movedByClick(this) ) return false;
    return super._canDrag(user, event);
  }

  /* -------------------------------------------- */

  /** @override */
  _refreshState() {
    super._refreshState();
    try {
      const actor = this.actor;
      const acted = (actor?.type === "unit") && hasActed(actor) && (turnState(actor, this.document) === "acted");
      if ( acted ) this.mesh.alpha *= 0.55;
      if ( acted && (!this.#tick || this.#tick.destroyed) ) this.#tick = this.addChild(this.#drawTick());
      if ( this.#tick && !this.#tick.destroyed ) {
        this.#tick.visible = acted;
        this.#tick.position.set(this.w - (canvas.grid.size * 0.2), this.h - (canvas.grid.size * 0.24));
      }
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw the tick: a pale disc with a check in it.
   * @returns {PIXI.Graphics}
   */
  #drawTick() {
    const radius = canvas.grid.size * 0.17;
    const tick = new PIXI.Graphics();
    tick.lineStyle(1, 0x000000, 0.7).beginFill(0xD8D2C2, 1).drawCircle(0, 0, radius).endFill();
    tick.lineStyle({ width: radius * 0.3, color: 0x2A2A2A, alpha: 1, cap: "round", join: "round" });
    tick.moveTo(-radius * 0.5, 0).lineTo(-radius * 0.12, radius * 0.38).lineTo(radius * 0.52, -radius * 0.36);
    return tick;
  }
}

/* -------------------------------------------- */

const { TokenRuler } = foundry.canvas.placeables.tokens;

/**
 * The ruler of a token. In a battle a unit's reach and the path of its move are painted on the grid, so
 * Foundry's own ruler stays out of sight for it: it would draw a second path over them, and count every tile
 * the unit has crossed since the battle began.
 */
export class FeoTokenRuler extends TokenRuler {

  /** @override */
  get isVisible() {
    try {
      const actor = this.token.actor;
      if ( (actor?.type === "unit") && fightsIn(battle(), actor, this.token.document) ) return false;
    } catch(err) {
      console.error(err);
    }
    return super.isVisible;
  }
}

/* -------------------------------------------- */

/**
 * The token layer of the battle map. A click on an empty tile may mean a move there.
 */
export class FeoTokenLayer extends TokenLayer {

  /** @override */
  _onClickLeft(event) {
    try {
      if ( canvas.grid?.isSquare && !this._draggedToken && (game.activeTool !== "target") ) {
        const point = event.interactionData?.origin ?? canvas.mousePosition;
        const { i, j } = canvas.grid.getOffset(point);
        if ( battleCanvas.ask("onTileClick", { i, j }, event) ) return;
      }
    } catch(err) {
      console.error(err);
    }
    return super._onClickLeft(event);
  }
}

/* -------------------------------------------- */

/**
 * Put the battle map on the canvas: its tokens and token layer take the place of the core ones, and the
 * pointer is followed over the canvas.
 */
export function registerBattleCanvas() {
  CONFIG.Token.objectClass = FeoToken;
  CONFIG.Token.rulerClass = FeoTokenRuler;
  CONFIG.Canvas.layers.tokens.layerClass = FeoTokenLayer;

  // The canvas element outlives the scenes drawn on it, so it is listened to once
  let view = null;
  Hooks.on("canvasReady", () => {
    battleCanvas.path = null;
    battleCanvas.hover = null;
    const element = canvas.app?.view;
    if ( !element || (element === view) ) return;
    view = element;
    element.addEventListener("pointermove", (event) => battleCanvas.track(event));
    element.addEventListener("pointerleave", () => battleCanvas.track(null));
  });
}

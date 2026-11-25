import { FEO } from "../config.mjs";
import { keyTile } from "../rules/reach.mjs";
import { battle, fightsIn, hasActed, phaseOf, turnState } from "../helpers/phases.mjs";
import { riderOf } from "../helpers/rescue.mjs";
import { armyOf } from "../helpers/exchange.mjs";
import { unseenBy } from "../rules/reactions.mjs";
import { stancesOf } from "../rules/stances.mjs";
import { TileField } from "./tiles.mjs";

/**
 * The battle map on the canvas: painting where a unit can go and what it can strike, what a move would cost
 * the units along it, the way a unit would be shoved or carried by a skill, and handing clicks on tiles and tokens to whoever is listening. The Battle HUD listens; this module only draws
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
 * @property {(event: Event) => boolean} onGroundRightClick
 *                                            The ground was right-clicked, off every token, and the map was
 *                                            not dragged with it; true if the click was used up
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

  /** The line a unit would be shoved or carried along, drawn over the squares and under the tokens. */
  path: null,

  /** What holds the squares and the path on the ground of the scene. @type {PIXI.Container|null} */
  ground: null,

  /** The numbers over the units a move would hurt, drawn over the tokens. @type {PIXI.Container|null} */
  marks: null,

  /** The traps that lie on the map, drawn on the ground over the squares. @type {PIXI.Graphics|null} */
  traps: null,

  /** The doors, chests and Villages of the map, drawn on the ground over the squares. @type {PIXI.Graphics|null} */
  objects: null,

  /** The tile the pointer was last over. */
  hover: null,

  /**
   * Where on the screen the right button went down on the ground, until it is let go.
   * @type {{x: number, y: number}|null}
   */
  pressed: null,

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
   * way a unit would be shoved or carried. Whatever was painted before is wiped.
   * @param {object} [paint]
   * @param {Iterable<string>} [paint.move]       Tiles by name, "row,column"
   * @param {Iterable<string>} [paint.strike]
   * @param {Iterable<string>} [paint.staff]
   * @param {Iterable<string>} [paint.warp]       Tiles a skill can warp the unit to
   * @param {Iterable<string>} [paint.threat]
   * @param {{i: number, j: number}[]} [paint.path]     The tiles a unit would be shoved or carried over, from first to last
   * @param {Iterable<string>} [paint.area]       The tiles a skill that takes in an area would cover
   * @param {{tile: {i: number, j: number}, text: string, tone?: "bad"|"good"}[]} [paint.marks]
   *                                              What the move would take off the units along its way, or what
   *                                              a skill would do to each unit its area catches
   * @param {{tile: {i: number, j: number}}[]} [paint.traps]    The traps this user is shown, each on its tile
   * @param {object[]} [paint.objects]            The doors, chests and Villages of the map (see `objectsShown`
   *                                              in `helpers/objects.mjs`)
   */
  draw(paint = {}) {
    try {
      if ( !canvas?.ready || !canvas.primary || !canvas.grid?.isSquare ) return;

      // The squares and the path lie on the ground together, the path over the squares. They go with the
      // scene, and are laid out anew on the next one
      const lost = (thing) => !thing || thing.destroyed;
      if ( lost(this.tiles) || lost(this.path) || lost(this.traps) || lost(this.objects) || lost(this.ground) || !this.ground.parent ) {
        this.tiles?.destroy();
        if ( !lost(this.ground) ) this.ground.destroy({ children: true });
        const still = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        this.tiles = new TileField({ ticker: canvas.app.ticker, still });
        this.path = new PIXI.Graphics();
        this.traps = new PIXI.Graphics();
        this.objects = new PIXI.Graphics();
        const ground = this.ground = new PIXI.Container();
        ground.eventMode = "none";
        ground.addChild(this.tiles.container, this.objects, this.traps, this.path);
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
      this._drawTraps(paint.traps ?? []);
      this._drawObjects(paint.objects ?? []);
      this._drawMarks(paint.marks ?? []);
    } catch(err) {
      console.error(err);
    }
  },

  /* -------------------------------------------- */

  /**
   * Write a number over each unit a move would hurt, or a skill would do something to: small, at the top of
   * its tile, in the colour of damage or with `tone: "good"` in that of healing.
   * @param {{tile: {i: number, j: number}, text: string, tone?: "bad"|"good"}[]} marks
   */
  _drawMarks(marks) {
    const lost = (thing) => !thing || thing.destroyed;
    if ( lost(this.marks) || !this.marks.parent ) {
      if ( !marks.length ) return;
      if ( !lost(this.marks) ) this.marks.destroy({ children: true });
      this.marks = new PIXI.Container();
      this.marks.eventMode = "none";

      // Over the tokens and whatever is drawn on them, where the numbers that float up from a unit are
      this.marks.zIndex = CONFIG.Canvas.groups?.interface?.zIndexScrollingText ?? 1100;
      canvas.interface.addChild(this.marks);
    }
    for ( const child of this.marks.removeChildren() ) child.destroy();
    const size = canvas.grid.size;
    const Text = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
    for ( const mark of marks ) {
      const text = new Text(mark.text, {
        fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? "Signika",
        fontSize: Math.round(size * 0.3),
        fontWeight: "bold",
        align: "center",
        lineHeight: Math.round(size * 0.3),
        fill: (mark.tone === "good") ? "#7dffa6" : "#ff6257",
        stroke: "#000000",
        strokeThickness: Math.max(3, Math.round(size * 0.05)),
        lineJoin: "round"
      });
      const { x, y } = canvas.grid.getTopLeftPoint(mark.tile);
      text.anchor.set(0.5, 0);
      text.position.set(x + (size / 2), y + (size * 0.02));
      this.marks.addChild(text);
    }
  },

  /* -------------------------------------------- */

  /**
   * Draw the traps that lie on the map: a small rune in the middle of each tile, a ring with a cross in it.
   * One a skill laid is violet, a Mine of the Items tab red and a Trap of it amber.
   * @param {{tile: {i: number, j: number}, kind?: "skill"|"mine"|"trap"}[]} traps
   */
  _drawTraps(traps) {
    const drawn = this.traps;
    if ( !drawn || drawn.destroyed ) return;
    drawn.clear();
    const size = canvas.grid.size;
    const radius = size * 0.2;
    for ( const trap of traps ) {
      const { x, y } = canvas.grid.getCenterPoint(trap.tile);
      drawn.lineStyle({ width: size * 0.07, color: 0x000000, alpha: 0.55 });
      const [fill, line] = (trap.kind === "mine") ? [0xD04F4F, 0xFFC2C2] : (trap.kind === "trap") ? [0xD09A3F, 0xFFE3B0] : [0x7B4FD0, 0xD9C2FF];
      drawn.beginFill(fill, 0.35).drawCircle(x, y, radius).endFill();
      drawn.lineStyle({ width: size * 0.035, color: line, alpha: 1, cap: "round" });
      drawn.drawCircle(x, y, radius);
      const arm = radius * 0.6;
      drawn.moveTo(x - arm, y - arm).lineTo(x + arm, y + arm);
      drawn.moveTo(x + arm, y - arm).lineTo(x - arm, y + arm);
    }
  },

  /* -------------------------------------------- */

  /**
   * Draw the doors, chests and Villages of the map, each a small sign in the middle of its tile: a door as a
   * barred gate, with what is left of its HP under it once it was struck; a chest as a box with its lid; a
   * Village as a house. One that nothing more can be done with is drawn faint, in grey: a door that stands
   * open as its two posts, a chest with its lid up, a Village that was destroyed struck through.
   * @param {{tile: {i: number, j: number}, kind: string, spent: boolean, shut: boolean, ruined?: boolean,
   *   hp: {value: number, max: number}|null}[]} objects
   */
  _drawObjects(objects) {
    const drawn = this.objects;
    if ( !drawn || drawn.destroyed ) return;
    drawn.clear();
    const size = canvas.grid.size;
    const tints = FEO.objects.tints;
    for ( const object of objects ) {
      const { x, y } = canvas.grid.getCenterPoint(object.tile);
      const color = object.spent ? tints.spent : (tints[object.kind] ?? tints.spent);
      const alpha = object.spent ? 0.55 : 1;
      const half = size * 0.2;
      const edge = { width: size * 0.07, color: 0x000000, alpha: 0.5 * alpha, join: "round" };
      const line = { width: size * 0.035, color: 0xFFF6DC, alpha, cap: "round", join: "round" };
      if ( object.kind === "door" ) {
        if ( object.shut ) {
          // A gate: a slab from post to post, barred across
          drawn.lineStyle(edge);
          drawn.beginFill(color, 0.9).drawRoundedRect(x - (size * 0.3), y - half, size * 0.6, half * 2, size * 0.05).endFill();
          drawn.lineStyle(line);
          drawn.drawRoundedRect(x - (size * 0.3), y - half, size * 0.6, half * 2, size * 0.05);
          drawn.moveTo(x - (size * 0.3), y).lineTo(x + (size * 0.3), y);
          drawn.moveTo(x, y - half).lineTo(x, y + half);
        }
        else {
          // Open: its two posts
          drawn.lineStyle(edge);
          for ( const side of [-1, 1] ) drawn.beginFill(color, 0.8).drawRoundedRect(x + (side * size * 0.3) - (size * 0.04), y - half, size * 0.08, half * 2, size * 0.02).endFill();
        }

        // What is left of a door that was struck, as a bar under it
        if ( object.hp ) {
          const width = size * 0.6;
          const top = y + half + (size * 0.06);
          drawn.lineStyle(0);
          drawn.beginFill(0x000000, 0.6).drawRect(x - (width / 2), top, width, size * 0.06).endFill();
          drawn.beginFill(0xFF6257, 1).drawRect(x - (width / 2), top, width * Math.min(Math.max(object.hp.value / object.hp.max, 0), 1), size * 0.06).endFill();
        }
      }
      else if ( object.kind === "chest" ) {
        const w = size * 0.24;
        const h = size * 0.17;
        drawn.lineStyle(edge);
        drawn.beginFill(color, 0.9 * alpha).drawRoundedRect(x - w, y - h, w * 2, h * 2, size * 0.04).endFill();
        drawn.lineStyle(line);
        drawn.drawRoundedRect(x - w, y - h, w * 2, h * 2, size * 0.04);

        // The lid: shut across the box, or up for one that was opened
        if ( object.spent ) drawn.moveTo(x - w, y - h).lineTo(x - (w * 0.7), y - (h * 1.9)).lineTo(x + (w * 0.7), y - (h * 1.9)).lineTo(x + w, y - h);
        else {
          drawn.moveTo(x - w, y - (h * 0.2)).lineTo(x + w, y - (h * 0.2));
          drawn.moveTo(x, y - (h * 0.2)).lineTo(x, y + (h * 0.35));
        }
      }
      else {
        // A house: walls under a roof
        const w = size * 0.19;
        const h = size * 0.15;
        const roof = [x - (w * 1.35), y - (h * 0.2), x, y - (h * 1.7), x + (w * 1.35), y - (h * 0.2)];
        drawn.lineStyle(edge);
        drawn.beginFill(color, 0.9 * alpha).drawRect(x - w, y - (h * 0.2), w * 2, h * 1.5).endFill();
        drawn.beginFill(color, 0.9 * alpha).drawPolygon(roof).endFill();
        drawn.lineStyle(line);
        drawn.drawRect(x - w, y - (h * 0.2), w * 2, h * 1.5);
        drawn.drawPolygon(roof);
        if ( object.ruined ) {
          drawn.lineStyle({ width: size * 0.05, color: 0xFF6257, alpha: 0.9, cap: "round" });
          drawn.moveTo(x - (w * 1.3), y - (h * 1.5)).lineTo(x + (w * 1.3), y + (h * 1.3));
          drawn.moveTo(x + (w * 1.3), y - (h * 1.5)).lineTo(x - (w * 1.3), y + (h * 1.3));
        }
      }
    }
  },

  /* -------------------------------------------- */

  /**
   * Draw the line a unit would be shoved or carried along through the middle of its tiles, with an arrowhead
   * where it ends.
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
   * Which units share a tile has changed: every unit's token is laid out on its tile again.
   */
  refreshSharing() {
    try {
      for ( const token of canvas?.tokens?.placeables ?? [] ) {
        if ( token.actor?.type === "unit" ) token.renderFlags.set({ refreshMesh: true });
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
 * Is the drag being made a free one? A drag begun with Ctrl held (⌘ on a Mac) puts the tokens it carries
 * wherever they are let go, for a player and a Game Master alike: nothing that limits movement applies to it,
 * and it is not counted as the move of a unit.
 */
let freeDrag = false;

/**
 * Is the key that makes a drag a free one held as a pointer event happens?
 * @param {Event|null} [event]
 * @returns {boolean}
 */
function freeKey(event) {
  if ( event?.ctrlKey || event?.metaKey ) return true;
  try {
    return !!game.keyboard?.isModifierActive("CONTROL");
  } catch(err) {
    return false;
  }
}

/**
 * Was a token moved by a free drag, going by what its update was told?
 * @param {object|null} [options]     The options of the update
 * @returns {boolean}
 */
export function freeMove(options) {
  return !!options?.[FEO.id]?.free;
}

/* -------------------------------------------- */

/**
 * Is a token moved by clicks on the map and nothing else? A unit fighting in the battle of its scene goes
 * where a tile of its reach is clicked, so its token is neither dragged nor stepped with the keys. A unit that
 * is down is left out, and so is every token for a Game Master who has lifted the limits on movement, who
 * puts it where they please. A drag begun with Ctrl held is let through all the same (see `freeDrag`).
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
    return (state === "ready") || (state === "moving") || (state === "acted") || (state === "waiting");
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

const { Token } = foundry.canvas.placeables;
const { TokenLayer } = foundry.canvas.layers;

/**
 * Which corner of its tile a unit's token is drawn in, for one that shares its tile with another unit as a
 * skill may let it: the two are drawn smaller, corner to corner, so that both can be seen.
 * @param {Token} token
 * @returns {-1|0|1}    -1 for the upper left, 1 for the lower right, 0 for a unit that has its tile to itself
 */
function cornerOf(token) {
  const document = token.document;
  const scene = document.parent;
  const actor = token.actor;
  if ( !scene?.grid?.isSquare || (actor?.type !== "unit") || actor.system.defeat?.out ) return 0;
  const { x, y } = document._source ?? document;
  const other = scene.tokens.find((entry) => {
    if ( (entry === document) || (entry.actor?.type !== "unit") || entry.actor.system.defeat?.out ) return false;
    const at = entry._source ?? entry;
    return (Math.abs(at.x - x) < 1) && (Math.abs(at.y - y) < 1);
  });
  if ( !other ) return 0;
  return (document.id < other.id) ? -1 : 1;
}

/** How much smaller a token is drawn when its unit shares its tile, and how far off the middle of the tile. */
const SHARED = { scale: 0.66, shift: 0.17 };

/**
 * Has the unit behind a token left the map, as one that died or retreated has?
 * @param {Token} token
 * @returns {boolean}
 */
function hasLeft(token) {
  const actor = token.actor;
  return (actor?.type === "unit") && !!actor.system.defeat?.gone;
}

/**
 * Is the unit behind a token carried by an ally? It is then off the map like one that has left it, and shown
 * on its carrier's token instead.
 * @param {Token} token
 * @returns {boolean}
 */
function isCarried(token) {
  const actor = token.actor;
  return (actor?.type === "unit") && !!actor.system.defeat?.carried;
}

/** How solid a Game Master sees the token of a unit that has left the map, while looking for it. */
const LEFT_ALPHA = 0.45;

/** How solid the token of a hidden unit is drawn for those who do see it. */
const HIDDEN_ALPHA = 0.6;

/** The colours of the marks a stance puts on its unit's token. */
const STANCE_COLOURS = { hold: 0xF0B840, guard: 0x5AA9F0, hidden: 0xB48CF0 };

/**
 * Is the unit behind a token hidden, as a skill may have it: one its enemies do not see?
 * @param {Token} token
 * @returns {boolean}
 */
function isHidden(token) {
  const actor = token.actor;
  return (actor?.type === "unit") && unseenBy(actor.system.skills?.rules, "foe");
}

/**
 * Does this user see a hidden unit? A Game Master does, and so does whoever owns it; a player sees the hidden
 * units of the players' side and of its allies, and none of the others.
 * @param {Token} token
 * @returns {boolean}
 */
function seesHidden(token) {
  if ( game.user.isGM || token.document.isOwner ) return true;
  return (FEO.camps[armyOf(token.actor, token.document)] ?? null) === FEO.camps.player;
}

/**
 * A unit's defeat has changed: the token of one that has left the map fades away, and that of one that is
 * back is drawn again. Runs on every client for the tokens it has in view; nothing is saved.
 * @param {Actor} actor
 */
function showDefeat(actor) {
  if ( !canvas?.ready || (actor?.type !== "unit") ) return;
  const tokens = actor.token ? [actor.token.object] : (actor.getActiveTokens?.() ?? []);
  for ( const token of tokens ) {
    if ( !(token instanceof FeoToken) || token.destroyed ) continue;
    if ( hasLeft(token) && token.visible && (token.leaving === null) ) token.leave(isCarried(token) ? FEO.rescue.fade : FEO.defeat.fade);
    else token.renderFlags.set({ refreshState: true });
  }

  // A unit that shared its tile with one that is gone has it to itself again
  battleCanvas.refreshSharing();
}

/**
 * A token on the battle map. A click on it may mean an attack on its unit rather than selecting it, a unit
 * fighting in a battle is not lifted by a drag, one that has taken its Action this Phase is dimmed and
 * ticked off, two units that share a tile are drawn corner to corner, and a unit that died or retreated has
 * left the map: its token fades and is drawn no more, until the unit returns. So does the token of a unit that
 * an ally picks up, which is drawn as a small portrait in a corner of its carrier's token until it is set down.
 */
export class FeoToken extends Token {

  /**
   * The tick of a unit that has acted, drawn in the corner of its token.
   * @type {PIXI.Graphics|null}
   */
  #tick = null;

  /**
   * The portrait of the unit this one carries, drawn in a corner of its token, and what it was drawn from.
   * @type {PIXI.Graphics|null}
   */
  #rider = null;

  #riderKey = "";

  /**
   * The marks of the stances the unit is in, drawn in the upper left corner of its token, and what they were
   * drawn from.
   * @type {PIXI.Graphics|null}
   */
  #stance = null;

  #stanceKey = "";

  /**
   * How much is still to be seen of a token that is fading from the map, from 1 to 0; null for one that is
   * not fading.
   * @type {number|null}
   */
  leaving = null;

  /* -------------------------------------------- */

  /**
   * The token of a unit that has left the map is not drawn. A Game Master still finds it: it shows, faintly,
   * while the tokens are highlighted (Alt) and while it is selected, so that the unit can be brought back or
   * its token removed.
   * @override
   */
  get isVisible() {
    try {
      if ( hasLeft(this) && (this.leaving === null) && !this.isPreview ) {
        this.detectionFilter = null;

        // A unit that is carried is on its carrier's token, and nowhere else
        if ( isCarried(this) ) return false;
        return game.user.isGM && (this.controlled || !!this.layer?.highlightObjects) && !this._testCulled();
      }

      // A unit that is hidden is not drawn for those it is hidden from
      if ( !this.isPreview && isHidden(this) && !seesHidden(this) ) {
        this.detectionFilter = null;
        return false;
      }
    } catch(err) {
      console.error(err);
    }
    return super.isVisible;
  }

  /* -------------------------------------------- */

  /**
   * Fade from the map, as the token of a unit that died or retreated does. Once it is gone it is selected no
   * longer, so that it does not stay in sight for a Game Master who had it in hand.
   * @param {number} [duration]     How long it takes, in milliseconds
   * @returns {Promise<void>}
   */
  async leave(duration = FEO.defeat.fade) {
    try {
      this.leaving = 1;
      this.renderFlags.set({ refreshState: true });
      await foundry.canvas.animation.CanvasAnimation.animate([{ parent: this, attribute: "leaving", to: 0 }], {
        name: `${this.objectId}.leave`,
        duration,
        ontick: () => {
          if ( !this.destroyed ) this.renderFlags.set({ refreshState: true });
        }
      });
    } catch(err) {
      console.error(err);
    }
    this.leaving = null;
    if ( this.destroyed ) return;
    if ( hasLeft(this) && this.controlled ) this.release();
    this.renderFlags.set({ refreshState: true });
  }

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
   * when it is dragged, unless Ctrl is held as the drag begins.
   * @override
   */
  _canDrag(user, event) {
    if ( !freeKey(event) && movedByClick(this) ) return false;
    return super._canDrag(user, event);
  }

  /* -------------------------------------------- */

  /**
   * A drag begun with Ctrl held is a free one, for every token it carries.
   * @override
   */
  _initializeDragLeft(event) {
    freeDrag = freeKey(event);
    return super._initializeDragLeft(event);
  }

  /* -------------------------------------------- */

  /** @override */
  _finalizeDragLeft(event) {
    try {
      return super._finalizeDragLeft(event);
    } finally {
      freeDrag = false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Foundry keeps a token in hand when it is let go with Ctrl held, so that the way it takes can be marked out
   * click by click. A free drag has no way to mark out: the token is put down where it is let go.
   * @override
   */
  _shouldPreventDragLeftDrop(event) {
    if ( freeDrag ) return false;
    return super._shouldPreventDragLeftDrop(event);
  }

  /* -------------------------------------------- */

  /**
   * A free drag goes through walls and over ground that cannot be crossed.
   * @override
   */
  _getDragConstrainOptions() {
    const options = super._getDragConstrainOptions();
    return freeDrag ? { ...options, ignoreWalls: true, ignoreCost: true } : options;
  }

  /* -------------------------------------------- */

  /**
   * The update a free drag ends in says that it was one, for whoever would stop the move or take note of it.
   * @override
   */
  _getDragLeftDropUpdateOptions() {
    const options = super._getDragLeftDropUpdateOptions();
    if ( freeDrag ) options[FEO.id] = { ...(options[FEO.id] ?? {}), free: true };
    return options;
  }

  /* -------------------------------------------- */

  /**
   * A unit that shares its tile is drawn smaller, in a corner of it.
   * @override
   */
  _refreshMesh() {
    super._refreshMesh();
    try {
      const corner = cornerOf(this);
      if ( !this.mesh || (!corner && !this._shared) ) return;
      this._shared = corner;
      if ( corner ) this.mesh.scale.set(this.mesh.scale.x * SHARED.scale, this.mesh.scale.y * SHARED.scale);
      this._refreshPosition();
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _refreshPosition() {
    super._refreshPosition();
    try {
      if ( !this._shared || !this.mesh ) return;
      const shift = canvas.grid.size * SHARED.shift * this._shared;
      this.mesh.position.set(this.mesh.position.x + shift, this.mesh.position.y + shift);
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * A battle played in Phases has no turn of a single unit: a whole side has the Phase. Foundry would ring
   * whichever unit comes first in the encounter as the one whose turn it is, so its turn marker is not drawn
   * while such a battle is the encounter in view.
   * @override
   */
  _refreshTurnMarker() {
    try {
      if ( phaseOf(game.combat) ) {
        if ( this.turnMarker ) {
          canvas.tokens.turnMarkers.delete(this);
          this.turnMarker.destroy();
          this.turnMarker = null;
        }
        return;
      }
    } catch(err) {
      console.error(err);
    }
    return super._refreshTurnMarker();
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

      // A token that is fading from the map, and one that has left it and is shown to a Game Master all the same
      const shown = (this.leaving !== null) ? this.leaving : hasLeft(this) ? LEFT_ALPHA : isHidden(this) ? HIDDEN_ALPHA : 1;
      if ( shown < 1 ) {
        this.alpha *= shown;
        this.mesh.alpha *= shown;
      }
      this.#showRider();
      this.#showStance();
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * Show the unit this one carries, an ally it Rescued or a captive, as a small round portrait in the lower
   * left corner of its token; and take it off again once it carries nobody.
   */
  #showRider() {
    const actor = this.actor;
    const rider = ((actor?.type === "unit") && !hasLeft(this)) ? riderOf(actor) : null;
    const key = rider ? `${rider.img}|${rider.captive}` : "";
    if ( key !== this.#riderKey ) {
      this.#riderKey = key;
      if ( this.#rider && !this.#rider.destroyed ) this.#rider.destroy();
      this.#rider = null;
      if ( rider ) this.#drawRider(rider, key).catch((err) => console.error(err));
    }
    if ( this.#rider && !this.#rider.destroyed ) {
      const radius = (canvas.grid.size * FEO.rescue.badge.size) / 2;
      this.#rider.position.set(radius + 1, this.h - radius - 1);
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw the portrait of the unit this one carries: its token's picture in a disc, ringed in the colour of an
   * ally or of a captive.
   * @param {{img: string, captive: boolean}} rider
   * @param {string} key      What it is drawn from, to tell whether it is still wanted once the picture is read
   * @returns {Promise<void>}
   */
  async #drawRider(rider, key) {
    let texture = null;
    try {
      texture = rider.img ? await foundry.canvas.loadTexture(rider.img) : null;
    } catch(err) {
      texture = null;
    }
    if ( this.destroyed || (this.#riderKey !== key) ) return;
    const { size, ally, captive } = FEO.rescue.badge;
    const radius = (canvas.grid.size * size) / 2;
    const badge = new PIXI.Graphics();
    badge.eventMode = "none";
    badge.lineStyle(Math.max(radius * 0.14, 1.5), 0x000000, 0.75).drawCircle(0, 0, radius + 1);
    badge.lineStyle(Math.max(radius * 0.12, 1.5), rider.captive ? captive : ally, 1);
    if ( texture?.valid && (texture.width > 0) && (texture.height > 0) ) {
      // The picture fills the disc, from its middle
      const scale = (radius * 2) / Math.min(texture.width, texture.height);
      const matrix = new PIXI.Matrix().scale(scale, scale).translate(-(texture.width * scale) / 2, -(texture.height * scale) / 2);
      badge.beginFill(0x1B1B22, 1).drawCircle(0, 0, radius).endFill();
      badge.beginTextureFill({ texture, matrix }).drawCircle(0, 0, radius).endFill();
    }
    else badge.beginFill(0x3A3A46, 1).drawCircle(0, 0, radius).endFill();
    this.#rider = this.addChild(badge);
    this.#showRider();
  }

  /* -------------------------------------------- */

  /**
   * Show the stances the unit is in as small marks in the upper left corner of its token, one beside the
   * other: a shield for a unit that holds or stands guard, an eye for one that is hidden. They go as the
   * stance does.
   */
  #showStance() {
    const actor = this.actor;
    const marks = ((actor?.type === "unit") && !hasLeft(this)) ? [...new Set(stancesOf(actor.system.timed).map(({ stance }) => stance.mark))] : [];
    const key = marks.join("|");
    if ( key !== this.#stanceKey ) {
      this.#stanceKey = key;
      if ( this.#stance && !this.#stance.destroyed ) this.#stance.destroy();
      this.#stance = marks.length ? this.addChild(this.#drawStance(marks)) : null;
    }
    if ( this.#stance && !this.#stance.destroyed ) this.#stance.position.set(0, 0);
  }

  /* -------------------------------------------- */

  /**
   * Draw the marks of a unit's stances: each a dark disc with its sign in the colour of the stance.
   * @param {string[]} marks
   * @returns {PIXI.Graphics}
   */
  #drawStance(marks) {
    const size = canvas.grid.size;
    const radius = size * 0.15;
    const badge = new PIXI.Graphics();
    badge.eventMode = "none";
    marks.forEach((mark, index) => {
      const x = radius + 2 + (index * ((radius * 2) + 2));
      const y = radius + 2;
      const colour = STANCE_COLOURS[mark] ?? STANCE_COLOURS.hold;
      badge.lineStyle(1.5, 0x000000, 0.8).beginFill(0x1B1B22, 0.92).drawCircle(x, y, radius).endFill();
      if ( mark === "hidden" ) {
        // An eye, struck through
        badge.lineStyle({ width: radius * 0.22, color: colour, alpha: 1, cap: "round", join: "round" });
        badge.drawEllipse(x, y, radius * 0.62, radius * 0.34);
        badge.beginFill(colour, 1).drawCircle(x, y, radius * 0.16).endFill();
        badge.moveTo(x - (radius * 0.55), y + (radius * 0.55)).lineTo(x + (radius * 0.55), y - (radius * 0.55));
      }
      else {
        // A shield: filled for a unit that stands guard, an outline for one that holds
        const w = radius * 0.56;
        const top = y - (radius * 0.6);
        const shape = [x - w, top, x + w, top, x + w, y + (radius * 0.05), x, y + (radius * 0.68), x - w, y + (radius * 0.05)];
        badge.lineStyle({ width: radius * 0.22, color: colour, alpha: 1, join: "round" });
        if ( mark === "guard" ) badge.beginFill(colour, 0.85);
        badge.drawPolygon(shape);
        if ( mark === "guard" ) badge.endFill();
      }
    });
    return badge;
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

  /* -------------------------------------------- */

  /**
   * The right button went down on the ground, off every token. That may be a click, or the start of a drag
   * that pans the map: which of the two is known once the button is let go, so the place is noted until then
   * (see `registerBattleCanvas`).
   * @override
   */
  _onClickRight(event) {
    try {
      battleCanvas.pressed = (canvas.grid?.isSquare && !this._draggedToken) ? { x: event.clientX, y: event.clientY } : null;
    } catch(err) {
      console.error(err);
    }
    return super._onClickRight(event);
  }
}

/* -------------------------------------------- */

/**
 * How far the pointer may stray, in pixels of the screen, between the right button going down and its being
 * let go for that to be a click still. Foundry begins a drag at the same distance.
 */
const CLICK_SLACK = 10;

/**
 * Put the battle map on the canvas: its tokens and token layer take the place of the core ones, and the
 * pointer is followed over the canvas.
 */
export function registerBattleCanvas() {
  CONFIG.Token.objectClass = FeoToken;
  CONFIG.Token.rulerClass = FeoTokenRuler;
  CONFIG.Canvas.layers.tokens.layerClass = FeoTokenLayer;

  // A right click on the ground is told to the listener as the button is let go, unless the map was dragged
  // with it. The window hears of that before the canvas does, while the canvas still knows of its drag
  globalThis.addEventListener?.("pointerup", (event) => {
    const pressed = battleCanvas.pressed;
    if ( !pressed ) return;
    battleCanvas.pressed = null;
    try {
      if ( event.button !== 2 ) return;
      const manager = canvas?.mouseInteractionManager;
      const dragged = !!manager?.states && (manager.state >= manager.states.DRAG);
      const strayed = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      if ( !dragged && (strayed < CLICK_SLACK) ) battleCanvas.ask("onGroundRightClick", event);
    } catch(err) {
      console.error(err);
    }
  }, true);
  globalThis.addEventListener?.("pointercancel", () => {
    battleCanvas.pressed = null;
  }, true);

  // The canvas element outlives the scenes drawn on it, so it is listened to once
  let view = null;
  // Two units on one tile are drawn corner to corner, and apart again once one of them has left
  for ( const hook of ["createToken", "deleteToken"] ) Hooks.on(hook, () => battleCanvas.refreshSharing());
  Hooks.on("updateToken", (token, changes) => {
    if ( ("x" in changes) || ("y" in changes) ) battleCanvas.refreshSharing();
  });

  // An encounter that takes to Phases, or is no longer played in them, has the turn marker looked at again:
  // Foundry only does so as the turn passes
  Hooks.on("updateCombat", (combat, changes) => {
    try {
      if ( !canvas?.ready || !("phase" in (changes.flags?.[FEO.id] ?? {})) ) return;
      for ( const token of canvas.tokens?.placeables ?? [] ) token.renderFlags.set({ refreshTurnMarker: true });
    } catch(err) {
      console.error(err);
    }
  });

  // A unit that dies or retreats leaves the map, and one that returns is back on it
  Hooks.on("updateActor", (actor, changed) => {
    try {
      const has = (path) => foundry.utils.hasProperty(changed, path);
      if ( has("system.defeat.state") || has("system.rescued") ) showDefeat(actor);

      // A unit that picks one up, or sets one down, shows it on its token or shows it no longer
      if ( has("system.rescuing") || has("system.captive") ) battleCanvas.refreshTokens(actor);

      // So does a unit that enters a stance or leaves one; one that is hidden, or no longer, is looked for again
      if ( has("system.timed") ) {
        battleCanvas.refreshTokens(actor);
        for ( const token of actor.getActiveTokens?.() ?? [] ) token.renderFlags?.set({ refreshVisibility: true });
      }
    } catch(err) {
      console.error(err);
    }
  });
  Hooks.on("canvasReady", () => {
    battleCanvas.path = null;
    battleCanvas.traps = null;
    battleCanvas.marks = null;
    battleCanvas.hover = null;
    battleCanvas.pressed = null;
    const element = canvas.app?.view;
    if ( !element || (element === view) ) return;
    view = element;
    element.addEventListener("pointermove", (event) => battleCanvas.track(event));
    element.addEventListener("pointerleave", () => battleCanvas.track(null));
  });
}

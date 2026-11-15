import { FEO } from "../config.mjs";
import { paintScene, paintShown, terrainTint, veilPaint } from "../helpers/paint.mjs";
import { tileGround } from "../helpers/terrain.mjs";
import { boxTiles, brushHolds, lineTiles } from "../rules/paint.mjs";
import { tileKey } from "../rules/reach.mjs";
import { drawGround } from "./ground-art.mjs";

/**
 * The Fire Emblem controls: a set of scene controls of the system's own, with a canvas layer behind it as
 * Foundry asks of every set. While the set is in use the ground of the map is on show, each kind of terrain
 * in its colour and each height marked; with the terrain brush, a Game Master paints it.
 *
 * The layer only draws and follows the pointer. What the brush holds is kept in `mapTools`, where the palette
 * of the Battle HUD sets it, and a stroke is laid down by `helpers/paint.mjs`. The Compendium and the Base add
 * their own buttons to the set.
 *
 * Like the rest of the battle map, this runs inside Foundry's drawing and event handling, so nothing in it may
 * throw: whatever goes wrong is logged.
 *
 * @import {Brush} from "../rules/paint.mjs"
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The name of the set of controls, and of the layer behind it on the canvas. */
export const MAP_CONTROL = "feo";

/** The names of the tools of the set that work on the map. */
export const MAP_TOOLS = { survey: "feoSurvey", paint: "feoPaint" };

/** What the tools of the map are doing, and who wants to hear of it. */
export const mapTools = {

  /**
   * What the terrain brush holds.
   * @type {Brush}
   */
  brush: { terrain: "forest", elevation: null, erase: false },

  /**
   * Called when the tools change: the set is opened or left, or another tool is taken up.
   * @type {(() => void)|null}
   */
  listener: null,

  /**
   * Is the ground of the map on show?
   * @type {boolean}
   */
  get surveying() {
    return !!globalThis.canvas?.[MAP_CONTROL]?.active;
  },

  /**
   * Is the terrain brush in hand, on a map it can paint?
   * @type {boolean}
   */
  get painting() {
    return this.surveying && game.user.isGM && !!canvas.grid?.isSquare && (game.activeTool === MAP_TOOLS.paint);
  },

  /**
   * Tell whoever is listening that the tools have changed.
   */
  changed() {
    try {
      this.listener?.();
    } catch(err) {
      console.error(err);
    }
  }
};

/* -------------------------------------------- */

/**
 * The tile under a point of the canvas, if it is a tile of the map itself and not of the padding around it.
 * @param {{x: number, y: number}|null} point
 * @returns {Tile|null}
 */
export function mapTile(point) {
  if ( !point || !canvas?.ready || !canvas.grid?.isSquare ) return null;
  const { i, j } = canvas.grid.getOffset(point);
  const middle = canvas.grid.getCenterPoint({ i, j });
  return canvas.dimensions.sceneRect.contains(middle.x, middle.y) ? { i, j } : null;
}

/* -------------------------------------------- */

/**
 * The first and the last tile of the map itself, leaving out the padding round it.
 * @returns {{first: Tile, last: Tile}}
 */
function mapCorners() {
  const rect = canvas.dimensions.sceneRect;
  return {
    first: canvas.grid.getOffset({ x: rect.x + 1, y: rect.y + 1 }),
    last: canvas.grid.getOffset({ x: rect.right - 1, y: rect.bottom - 1 })
  };
}

/* -------------------------------------------- */

/**
 * The ground of the scene as a picture, laid under the tokens for everyone when the scene asks for it (see
 * `paintShown`). The picture is drawn once, tile by tile, by `ground-art.mjs`, and again whenever the ground
 * changes; Foundry then draws it with the scene, lit and darkened like the scene's own background.
 */
export const groundArt = {

  /** The picture on the canvas. @type {PIXI.Sprite|null} */
  sprite: null,

  /** The most pixels a side of the picture may have, and the fewest and most a tile of it is given. */
  limits: { side: 4096, tile: { min: 24, max: 80 } },

  /* -------------------------------------------- */

  /**
   * Is the picture on the canvas?
   * @type {boolean}
   */
  get shown() {
    return !!this.sprite && !this.sprite.destroyed;
  },

  /* -------------------------------------------- */

  /**
   * Take the picture off the canvas.
   */
  clear() {
    const sprite = this.sprite;
    this.sprite = null;
    try {
      if ( sprite && !sprite.destroyed ) sprite.destroy({ texture: true, baseTexture: true });
    } catch(err) {
      console.error(err);
    }
  },

  /* -------------------------------------------- */

  /**
   * Draw the picture again from the ground as it is now, or take it away if the scene does not ask for one.
   */
  refresh() {
    try {
      this.clear();
      const scene = globalThis.canvas?.scene;
      if ( !canvas?.ready || !canvas.grid?.isSquare || !canvas.primary || !paintShown(scene) ) return;
      const { first, last } = mapCorners();
      const rows = last.i - first.i + 1;
      const columns = last.j - first.j + 1;
      if ( (rows < 1) || (columns < 1) ) return;
      const { side, tile } = this.limits;
      const cell = Math.min(Math.max(Math.floor(side / Math.max(rows, columns)), tile.min), tile.max);
      const picture = document.createElement("canvas");
      picture.width = columns * cell;
      picture.height = rows * cell;
      const drawn = drawGround(picture.getContext("2d"), {
        rows,
        columns,
        cell,
        tints: FEO.terrain.tints,
        groundAt: (i, j) => {
          const ground = tileGround(scene, { i: i + first.i, j: j + first.j });
          return ground.named ? ground : null;
        }
      });
      if ( !drawn ) return;

      // Above the scene's own background and below everything that stands on it
      const sprite = new PIXI.Sprite(PIXI.Texture.from(picture));
      const corner = canvas.grid.getTopLeftPoint(first);
      sprite.position.set(corner.x, corner.y);
      sprite.width = columns * canvas.grid.size;
      sprite.height = rows * canvas.grid.size;
      sprite.eventMode = "none";
      sprite.elevation = canvas.primary.background?.elevation ?? 0;
      sprite.sortLayer = 0;
      sprite.sort = 1e9;
      this.sprite = canvas.primary.addChild(sprite);
    } catch(err) {
      console.error(err);
    }
  }
};

/* -------------------------------------------- */

/**
 * The layer behind the Fire Emblem controls.
 */
export class FeoMapLayer extends foundry.canvas.layers.InteractionLayer {

  /** @inheritDoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: MAP_CONTROL, zIndex: 150 });
  }

  /* -------------------------------------------- */

  /** @override */
  static prepareSceneControls() {
    return {
      name: MAP_CONTROL,
      order: 9,
      title: "FEO.Controls.title",
      layer: MAP_CONTROL,
      icon: "feo-emblem",
      onChange: (event, active) => {
        if ( active ) canvas[MAP_CONTROL]?.activate();
      },
      onToolChange: () => mapTools.changed(),
      tools: {
        [MAP_TOOLS.survey]: {
          name: MAP_TOOLS.survey,
          order: 3,
          title: "FEO.Controls.survey",
          icon: "fa-solid fa-mountain-sun"
        },
        [MAP_TOOLS.paint]: {
          name: MAP_TOOLS.paint,
          order: 4,
          title: "FEO.Controls.paint",
          icon: "fa-solid fa-paintbrush",
          visible: game.user.isGM
        }
      },
      activeTool: MAP_TOOLS.survey
    };
  }

  /* -------------------------------------------- */

  /** The ground of the map: a wash of colour over each tile that is not open ground. @type {PIXI.Graphics|null} */
  #ground = null;

  /** The height of each tile that lies above the floor, written in its corner. @type {PIXI.Container|null} */
  #heights = null;

  /** The tiles of the stroke being made. @type {PIXI.Graphics|null} */
  #preview = null;

  /**
   * The stroke being made: where it began, the tile it last reached, its tiles by name, and whether it fills a
   * box.
   * @type {{from: Tile, last: Tile, tiles: Map<string, Tile>, box: boolean}|null}
   */
  #stroke = null;

  /** The strokes are laid down one after another, so that none works from paint that is about to change. */
  #laying = Promise.resolve();

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _draw(options) {
    await super._draw(options);
    this.#ground = this.addChild(new PIXI.Graphics());
    this.#heights = this.addChild(new PIXI.Container());
    this.#preview = this.addChild(new PIXI.Graphics());
    this.#stroke = null;
    this.redraw();
  }

  /* -------------------------------------------- */

  /** @override */
  _activate() {
    this.redraw();
    mapTools.changed();
  }

  /* -------------------------------------------- */

  /** @override */
  _deactivate() {
    this.#stroke = null;
    this.redraw();
    mapTools.changed();
  }

  /* -------------------------------------------- */

  /**
   * Draw the ground of the map again, or wipe it if the controls are not in use.
   */
  redraw() {
    try {
      const ground = this.#ground;
      if ( !ground || ground.destroyed ) return;
      ground.clear();
      for ( const label of this.#heights.removeChildren() ) label.destroy();
      this.#drawStroke();
      if ( !this.active || !canvas.grid?.isSquare ) return;

      const scene = canvas.scene;
      const size = canvas.grid.size;
      const { first, last } = mapCorners();

      // Where the ground is drawn as a picture already, only its heights are marked over it
      const pictured = groundArt.shown;
      const style = CONFIG.canvasTextStyle.clone();
      style.fontSize = Math.round(size * 0.26);
      for ( let i = first.i; i <= last.i; i++ ) {
        for ( let j = first.j; j <= last.j; j++ ) {
          const { terrain, elevation } = tileGround(scene, { i, j });
          const open = terrain === FEO.terrain.default;
          if ( open && !elevation ) continue;
          const { x, y } = canvas.grid.getTopLeftPoint({ i, j });
          if ( !open && !pictured ) {
            ground.lineStyle(0);
            ground.beginFill(Number(foundry.utils.Color.from(terrainTint(terrain))), 0.42);
            ground.drawRect(x, y, size, size);
            ground.endFill();
          }

          // High ground is edged in brass and numbered
          if ( elevation ) {
            ground.lineStyle({ width: Math.max(2, size * 0.04), color: 0xF3D98F, alpha: 0.85, alignment: 0 });
            ground.drawRect(x, y, size, size);
            const label = this.#heights.addChild(new foundry.canvas.containers.PreciseText(String(elevation), style));
            label.anchor.set(1, 0);
            label.position.set(x + size - (size * 0.08), y + (size * 0.04));
          }
        }
      }
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw the tiles of the stroke being made, in the colour the brush would leave them.
   */
  #drawStroke() {
    const preview = this.#preview;
    if ( !preview || preview.destroyed ) return;
    preview.clear();
    const stroke = this.#stroke;
    if ( !stroke ) return;
    const size = canvas.grid.size;
    const holds = brushHolds(mapTools.brush);
    const color = holds.erase ? 0x1A1D26 : holds.terrain ? Number(foundry.utils.Color.from(terrainTint(holds.terrain))) : 0xF3D98F;
    preview.lineStyle({ width: Math.max(1, size * 0.03), color: 0xFFFFFF, alpha: 0.8, alignment: 0 });
    for ( const tile of stroke.tiles.values() ) {
      const { x, y } = canvas.grid.getTopLeftPoint(tile);
      preview.beginFill(color, 0.6);
      preview.drawRect(x, y, size, size);
      preview.endFill();
    }
  }

  /* -------------------------------------------- */
  /*  Painting                                    */
  /* -------------------------------------------- */

  /**
   * Lay a stroke down on the scene, once the strokes before it have been.
   * @param {Tile[]} tiles
   */
  #lay(tiles) {
    const scene = canvas.scene;
    const brush = { ...mapTools.brush };
    if ( !tiles.length || brushHolds(brush).idle ) return;
    this.#laying = this.#laying.then(() => paintScene(scene, tiles, brush)).catch((err) => {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    });
  }

  /* -------------------------------------------- */

  /**
   * A click with the brush paints the tile under it.
   * @override
   */
  _onClickLeft(event) {
    try {
      if ( !mapTools.painting ) return;
      const tile = mapTile(event.interactionData?.origin);
      if ( tile ) this.#lay([tile]);
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _canDragLeftStart(user, event) {
    return mapTools.painting;
  }

  /* -------------------------------------------- */

  /**
   * A drag with the brush paints every tile it passes over; with Shift held as it begins, the box between
   * where it began and where it ends.
   * @override
   */
  _onDragLeftStart(event) {
    try {
      const from = mapTile(event.interactionData?.origin);
      this.#stroke = from ? { from, last: from, tiles: new Map([[tileKey(from), from]]), box: !!event.shiftKey } : null;
      this.#drawStroke();
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftMove(event) {
    try {
      const stroke = this.#stroke;
      const to = mapTile(event.interactionData?.destination);
      if ( !stroke || !to || ((to.i === stroke.last.i) && (to.j === stroke.last.j)) ) return;
      if ( stroke.box ) stroke.tiles.clear();
      for ( const tile of (stroke.box ? boxTiles(stroke.from, to) : lineTiles(stroke.last, to)) ) {
        if ( mapTile(canvas.grid.getCenterPoint(tile)) ) stroke.tiles.set(tileKey(tile), tile);
      }
      stroke.last = to;
      this.#drawStroke();
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftDrop(event) {
    try {
      const stroke = this.#stroke;
      this.#stroke = null;
      this.#drawStroke();
      if ( stroke && mapTools.painting ) this.#lay(Array.from(stroke.tiles.values()));
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftCancel(event) {
    this.#stroke = null;
    this.#drawStroke();
  }
}

/* -------------------------------------------- */

/**
 * Put the Fire Emblem controls among the scene controls, with the layer behind them, and keep the picture of
 * the ground and the ground that is on show in step with the Regions of the scene.
 */
export function registerMapLayer() {
  CONFIG.Canvas.layers[MAP_CONTROL] = { layerClass: FeoMapLayer, group: "interface" };

  // The picture is drawn first, since what is marked over the ground depends on whether there is one
  const redraw = foundry.utils.debounce(() => {
    groundArt.refresh();
    globalThis.canvas?.[MAP_CONTROL]?.redraw();
  }, 40);
  for ( const hook of [
    "canvasReady", "createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior",
    "deleteRegionBehavior"
  ] ) Hooks.on(hook, redraw);
  Hooks.on("updateScene", (scene, changes) => {
    if ( (scene === canvas?.scene) && changes.flags?.[FEO.id] ) redraw();
  });

  // The canvas destroys what is drawn on it as it is taken down, so the picture is let go of first
  Hooks.on("canvasTearDown", () => groundArt.clear());

  // Ground that was shown by making its Regions visible is shown as the picture from now on
  Hooks.on("canvasReady", () => {
    if ( game.user.isActiveGM ) veilPaint(canvas.scene).catch((err) => console.error(err));
  });
}

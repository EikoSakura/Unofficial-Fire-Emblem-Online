import { FEO } from "../config.mjs";
import { paintScene, paintShown, terrainTint, veilPaint } from "../helpers/paint.mjs";
import { DEPLOY_ZONE, hasZone, tileGround } from "../helpers/terrain.mjs";
import { objectOn } from "../helpers/map-objects.mjs";
import { battle } from "../helpers/phases.mjs";
import { boxTiles, brushHolds, lineTiles } from "../rules/paint.mjs";
import { tileKey } from "../rules/reach.mjs";
import { drawGround } from "./ground-art.mjs";

/**
 * The Fire Emblem controls: a set of scene controls of the system's own, with a canvas layer behind it as
 * Foundry asks of every set. While the set is in use the ground of the map is on show, each kind of terrain
 * in its colour and each height marked; with the terrain brush, a Game Master paints it. From any other set
 * the ground shows the same way for as long as everything on the map is highlighted, which is while Alt is held.
 *
 * The deployment zone, where one was marked with the brush, is drawn for everyone until a battle begins on the
 * map, whether the controls are in use or not: it is where the players set their units up.
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
   * What the terrain brush holds: a kind of terrain, a height, the eraser; in their place a zone to mark
   * (`zone`, a key of FEO.zones); or a door, a chest or a Village to set down on the tile that is clicked
   * (`object`, see `rules/objects.mjs`).
   * @type {Brush & {object: "door"|"chest"|"village"|null}}
   */
  brush: { terrain: "forest", elevation: null, zone: null, erase: false, object: null },

  /**
   * Called when the tools change: the set is opened or left, or another tool is taken up.
   * @type {(() => void)|null}
   */
  listener: null,

  /**
   * Is the ground glanced at from whichever controls are in use? It is for as long as everything on the map
   * is highlighted, which is while Alt is held unless the user gave that another key.
   * @type {boolean}
   */
  glancing: false,

  /**
   * Are the Fire Emblem controls in use?
   * @type {boolean}
   */
  get open() {
    return !!globalThis.canvas?.[MAP_CONTROL]?.active;
  },

  /**
   * Is the ground of the map on show? Behind the Fire Emblem controls, and at a glance from any others.
   * @type {boolean}
   */
  get surveying() {
    return this.open || this.glancing;
  },

  /**
   * Is the terrain brush in hand, on a map it can paint?
   * @type {boolean}
   */
  get painting() {
    return this.open && game.user.isGM && !!canvas.grid?.isSquare && (game.activeTool === MAP_TOOLS.paint);
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
          // The picture shows the ground as it was painted, whatever stands on it
          const ground = tileGround(scene, { i: i + first.i, j: j + first.j });
          return ground.named ? { ...ground, terrain: ground.painted ?? ground.terrain } : null;
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

  /** Was the deployment zone on show when the ground was last drawn? */
  #deployed = false;

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
   * Is the ground of the map on show? To whoever has the controls in use, or glances at it from others.
   * @type {boolean}
   */
  get #surveyed() {
    return this.active || mapTools.glancing;
  }

  /* -------------------------------------------- */

  /**
   * Is the deployment zone of the map on show? To whoever looks at the ground, and to everyone until a battle
   * begins there.
   * @type {boolean}
   */
  get #deploying() {
    return this.#surveyed || (hasZone(canvas.scene, DEPLOY_ZONE) && !battle());
  }

  /* -------------------------------------------- */

  /**
   * A battle began or ended, or may have: the deployment zone is drawn or wiped if that changes whether it is
   * on show.
   */
  refreshZone() {
    try {
      if ( this.#ground && !this.#ground.destroyed && (this.#deploying !== this.#deployed) ) this.redraw();
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw the ground of the map again, or wipe it if nobody is looking at it. The deployment zone is drawn with
   * it, and on its own before a battle while nobody is.
   */
  redraw() {
    try {
      const ground = this.#ground;
      if ( !ground || ground.destroyed ) return;
      ground.clear();
      for ( const label of this.#heights.removeChildren() ) label.destroy();
      this.#drawStroke();
      this.#deployed = false;
      if ( !canvas.grid?.isSquare ) return;
      const surveying = this.#surveyed;
      const deploying = this.#deployed = this.#deploying;
      if ( !surveying && !deploying ) return;

      const scene = canvas.scene;
      const size = canvas.grid.size;
      const { first, last } = mapCorners();

      // Where the ground is drawn as a picture already, only its heights are marked over it
      const pictured = groundArt.shown;
      const style = CONFIG.canvasTextStyle.clone();
      style.fontSize = Math.round(size * 0.26);
      const zoneTint = Number(foundry.utils.Color.from(FEO.zones[DEPLOY_ZONE].tint));
      const inset = Math.max(2, size * 0.07);
      for ( let i = first.i; i <= last.i; i++ ) {
        for ( let j = first.j; j <= last.j; j++ ) {
          const { painted: terrain, elevation, zone } = tileGround(scene, { i, j });
          const open = terrain === FEO.terrain.default;
          const deploy = deploying && (zone === DEPLOY_ZONE);
          if ( !deploy && (!surveying || (open && !elevation)) ) continue;
          const { x, y } = canvas.grid.getTopLeftPoint({ i, j });
          if ( surveying && !open && !pictured ) {
            ground.lineStyle(0);
            ground.beginFill(Number(foundry.utils.Color.from(terrainTint(terrain))), 0.42);
            ground.drawRect(x, y, size, size);
            ground.endFill();
          }

          // High ground is edged in brass and numbered
          if ( surveying && elevation ) {
            ground.lineStyle({ width: Math.max(2, size * 0.04), color: 0xF3D98F, alpha: 0.85, alignment: 0 });
            ground.drawRect(x, y, size, size);
            const label = this.#heights.addChild(new foundry.canvas.containers.PreciseText(String(elevation), style));
            label.anchor.set(1, 0);
            label.position.set(x + size - (size * 0.08), y + (size * 0.04));
          }

          // A tile of the deployment zone is a blue plate set inside its edges, so that the ground shows round it
          if ( deploy ) {
            ground.lineStyle({ width: Math.max(2, size * 0.035), color: zoneTint, alpha: 0.95, alignment: 0 });
            ground.beginFill(zoneTint, 0.3);
            ground.drawRect(x + inset, y + inset, size - (inset * 2), size - (inset * 2));
            ground.endFill();
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
    const tint = holds.zone ? FEO.zones[holds.zone]?.tint : holds.terrain ? terrainTint(holds.terrain) : null;
    const color = holds.erase ? 0x1A1D26 : tint ? Number(foundry.utils.Color.from(tint)) : 0xF3D98F;
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
    this.#laying = this.#laying.then(async () => {
      await paintScene(scene, tiles, brush);

      // The eraser takes away what stands on the tiles as well, unless it is only taking a zone off them
      if ( brush.erase && !brush.zone ) {
        const { placeObject } = await import("../helpers/objects.mjs");
        for ( const tile of tiles ) if ( objectOn(scene, tile) ) await placeObject(scene, tile, null);

        // And the mines and traps that lie on them
        const { laidOn, placeTrap } = await import("../helpers/traps.mjs");
        for ( const tile of tiles ) {
          if ( laidOn(scene).some((trap) => (trap.i === tile.i) && (trap.j === tile.j)) ) await placeTrap(scene, tile, null);
        }
      }
    }).catch((err) => {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    });
  }

  /* -------------------------------------------- */

  /**
   * Set down the door, the chest or the Village the brush holds on a tile; on a tile where something stands
   * already, have the Game Master set what that is and holds. A chest and a Village are asked about as they
   * are set down, since each is there for what it holds.
   * @param {Tile} tile
   */
  #place(tile) {
    const scene = canvas.scene;
    const kind = mapTools.brush.object;
    this.#laying = this.#laying.then(async () => {
      // A mine or a trap is set down as the first of the Mines of the Items tab, and the Game Master is then
      // asked which it is; a click on one that lies there asks the same
      if ( kind === "trap" ) {
        const { configureTrap, laidOn, placeTrap, trapItems } = await import("../helpers/traps.mjs");
        const lies = laidOn(scene).find((trap) => (trap.i === tile.i) && (trap.j === tile.j));
        if ( lies ) return configureTrap(scene, lies.id);
        const items = await trapItems();
        if ( !items.length ) return ui.notifications.warn("FEO.Trap.config.none", { localize: true });
        const made = await placeTrap(scene, tile, items[0]);
        return made ? configureTrap(scene, made.id) : null;
      }
      const { configureObject, placeObject } = await import("../helpers/objects.mjs");
      const found = objectOn(scene, tile);
      if ( found ) return configureObject(scene, found.id);
      const made = await placeObject(scene, tile, kind);
      if ( made && (made.kind !== "door") ) await configureObject(scene, made.id);
    }).catch((err) => {
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
      if ( tile && mapTools.brush.object ) this.#place(tile);
      else if ( tile ) this.#lay([tile]);
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _canDragLeftStart(user, event) {
    // What stands on a tile is set down one click at a time
    return mapTools.painting && !mapTools.brush.object;
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

  // The deployment zone shows until a battle begins on the map, and again once it is over
  const zone = foundry.utils.debounce(() => globalThis.canvas?.[MAP_CONTROL]?.refreshZone(), 40);
  for ( const hook of ["createCombat", "updateCombat", "deleteCombat"] ) Hooks.on(hook, zone);

  // While everything on the map is highlighted, as holding Alt does, the ground is on show as well, whichever
  // controls are in use: a look at the land that takes nobody off their tokens
  Hooks.on("highlightObjects", (active) => {
    try {
      if ( mapTools.glancing === !!active ) return;
      mapTools.glancing = !!active;
      globalThis.canvas?.[MAP_CONTROL]?.redraw();
      mapTools.changed();
    } catch(err) {
      console.error(err);
    }
  });

  // The canvas destroys what is drawn on it as it is taken down, so the picture is let go of first. The next
  // scene is drawn with nothing highlighted
  Hooks.on("canvasTearDown", () => {
    groundArt.clear();
    mapTools.glancing = false;
  });

  // Ground that was shown by making its Regions visible is shown as the picture from now on
  Hooks.on("canvasReady", () => {
    if ( game.user.isActiveGM ) veilPaint(canvas.scene).catch((err) => console.error(err));
  });
}

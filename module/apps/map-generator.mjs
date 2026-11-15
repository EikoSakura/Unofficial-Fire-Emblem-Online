import { FEO } from "../config.mjs";
import { createMapScene } from "../helpers/mapgen.mjs";
import { MAP_SIZES, generateMap, mapSize, newSeed } from "../rules/mapgen.mjs";
import { CUSTOM_SIZE, buildMapGenerator, mapName } from "./map-generator-context.mjs";
import { drawMapPreview } from "./map-preview.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The map generator: a window in which a Game Master picks a kind of battlefield and a size, looks at the map
 * that makes, rerolls it until it suits, and has a scene made of it.
 *
 * Nothing is written until the scene is asked for. The map on show is made again from what is chosen each
 * time the window is drawn (see rules/mapgen.mjs), which costs next to nothing; the scene is made by
 * `helpers/mapgen.mjs`, and what the window shows is worked out by `map-generator-context.mjs`.
 */
export default class MapGenerator extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-map-generator",
    classes: ["feo", "feo-mapgen"],
    window: { title: "FEO.MapGen.title", icon: "fa-solid fa-map" },
    position: { width: 780, height: "auto" },
    actions: {
      pickType: MapGenerator.#onPickType,
      reroll: MapGenerator.#onReroll,
      create: MapGenerator.#onCreate
    }
  };

  /** @override */
  static PARTS = {
    generator: { template: `systems/${FEO.id}/templates/map/generator.hbs` }
  };

  /* -------------------------------------------- */

  /** The one window. @type {MapGenerator|null} */
  static #instance = null;

  /** The kind of battlefield: a key of MAP_TYPES. */
  #type = "plains";

  /** The size picked: a key of MAP_SIZES, or `custom` for one set by hand. */
  #size = "medium";

  /** The size in tiles, which is the picked one's unless it is set by hand. */
  #tiles = { ...MAP_SIZES.medium };

  /** What the map is made from. */
  #seed = newSeed();

  /** The name the scene is to have, blank for the one it gets by itself. */
  #name = "";

  /** The map on show. @type {import("../rules/mapgen.mjs").BattleMap|null} */
  #map = null;

  /** Is a scene being made? */
  #busy = false;

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /**
   * Open the map generator, or bring it forward. It is a Game Master's.
   */
  static open() {
    if ( !game.user.isGM ) return;
    MapGenerator.#instance ??= new MapGenerator();
    MapGenerator.#instance.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Open the map generator, or close it if it is open.
   */
  static toggle() {
    if ( MapGenerator.#instance?.rendered ) MapGenerator.#instance.close();
    else MapGenerator.open();
  }

  /* -------------------------------------------- */

  /**
   * Make the map generator part of the game: a way to open it from the Fire Emblem controls and from a macro.
   */
  static register() {
    game.feo.mapGenerator = {
      open: MapGenerator.open, toggle: MapGenerator.toggle, app: MapGenerator, generate: generateMap, createScene: createMapScene
    };

    // A Game Master's button of the Fire Emblem controls, after the terrain brush, opens the window
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools || !game.user.isGM ) return;
      tools.feoMapGen = {
        name: "feoMapGen",
        title: "FEO.Controls.mapgen",
        icon: "fa-solid fa-map",
        order: 5,
        button: true,
        onChange: () => MapGenerator.toggle()
      };
    });
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    this.#map = generateMap({ type: this.#type, ...this.#tiles, seed: this.#seed });
    return buildMapGenerator({ type: this.#type, size: this.#size, name: this.#name, map: this.#map }, game.i18n);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => this.#onChange(event));
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const canvas = this.element.querySelector("canvas.mg-map");
    if ( canvas && this.#map ) drawMapPreview(canvas, this.#map, { tints: FEO.terrain.tints });
  }

  /* -------------------------------------------- */
  /*  Choosing                                    */
  /* -------------------------------------------- */

  /**
   * Something was set in one of the fields: the size, a side of a size set by hand, the seed, or the name.
   * @param {Event} event
   */
  #onChange(event) {
    const { name, value } = event.target ?? {};
    if ( name === "size" ) {
      this.#size = (value in MAP_SIZES) ? value : CUSTOM_SIZE;
      if ( value in MAP_SIZES ) this.#tiles = { ...MAP_SIZES[value] };
    }
    else if ( (name === "columns") || (name === "rows") ) this.#tiles = mapSize({ ...this.#tiles, [name]: value });
    else if ( name === "seed" ) this.#seed = String(value).trim().slice(0, 24) || newSeed();
    else if ( name === "name" ) this.#name = String(value).trim();
    else return;
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Another kind of battlefield was picked.
   * @this {MapGenerator}
   */
  static #onPickType(event, target) {
    this.#type = target.dataset.type;
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Make another map of the same kind and size, from a seed nobody has asked for yet.
   * @this {MapGenerator}
   */
  static #onReroll() {
    this.#seed = newSeed();
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Make a scene of the map on show, and go to it.
   * @this {MapGenerator}
   */
  static async #onCreate() {
    if ( this.#busy || !this.#map ) return;
    this.#busy = true;
    try {
      const scene = await createMapScene(this.#map, { name: this.#name || mapName(this.#map, game.i18n) });
      if ( !scene ) return;
      ui.notifications.info(game.i18n.format("FEO.MapGen.created", { name: scene.name }));
      await this.close();

      // The next map starts from a seed of its own
      this.#seed = newSeed();
      this.#name = "";
      await scene.view();
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    } finally {
      this.#busy = false;
    }
  }
}

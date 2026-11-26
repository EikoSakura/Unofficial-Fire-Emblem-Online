import { FEO } from "../config.mjs";
import { createMapScene, keepWithPlace } from "../helpers/mapgen.mjs";
import { claimsOf, landOf, readWorldMap } from "../helpers/worldmap.mjs";
import { MAP_SIZES, generateMap, mapSize, newSeed, seededRandom } from "../rules/mapgen.mjs";
import { generateFromLand } from "../rules/mapgen-land.mjs";
import { nationAt, pathBetween, stopsFrom } from "../rules/worldmap.mjs";
import { CUSTOM_SIZE, buildMapGenerator, mapName } from "./map-generator-context.mjs";
import { drawLens, drawMapPreview } from "./map-preview.mjs";
import { holderTitle } from "./world-map-context.mjs";
import { paintGround, paintMarks } from "./world-map-draw.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @typedef Pick
 * What a map from the World Map is made of: a place of it, or a point of its ground or its sea.
 * @property {string} [place]     The id of the place
 * @property {number} [x]         The point, where it is no place
 * @property {number} [y]
 */

/**
 * The map generator: a window in which a Game Master makes a battle map, looks at it, rerolls it until it
 * suits, and has a scene made of it. A map is made from a kind of battlefield, or from the ground round a place
 * or a point of the World Map (see rules/mapgen-land.mjs): then the generator follows whatever is picked on the
 * World Map for as long as it is open, and the World Map shows the frame of ground the map is made from. Out at
 * sea that is a map of water, with ships to fight on.
 *
 * Nothing is written until the scene is asked for. The map on show is made again from what is chosen each
 * time the window is drawn, which costs next to nothing; the scene is made by `helpers/mapgen.mjs`, and what
 * the window shows is worked out by `map-generator-context.mjs`.
 */
export default class MapGenerator extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-map-generator",
    classes: ["feo", "feo-mapgen"],
    window: { title: "FEO.MapGen.title", icon: "fa-solid fa-map" },
    position: { width: 812, height: "auto" },
    actions: {
      pickSource: MapGenerator.#onPickSource,
      pickType: MapGenerator.#onPickType,
      lay: MapGenerator.#onLay,
      reroll: MapGenerator.#onReroll,
      create: MapGenerator.#onCreate
    }
  };

  /** @override */
  static PARTS = {
    generator: { template: `systems/${FEO.id}/templates/map/generator.hbs` }
  };

  /** The room round the map on show for the names of the roads that leave it, in pixels. */
  static #MARGIN = 22;

  /* -------------------------------------------- */

  /** The one window. @type {MapGenerator|null} */
  static #instance = null;

  /** Those who are told when what the generator follows on the World Map has changed. @type {Set<() => void>} */
  static #watchers = new Set();

  /** What the map is made from: `kind`, or `world`. */
  #source = "kind";

  /** What on the World Map the map is made of. @type {Pick|null} */
  #pick = null;

  /** The kind of battlefield: a key of MAP_TYPES. */
  #type = "plains";

  /** The size picked: a key of MAP_SIZES, or `custom` for one set by hand. */
  #size = "medium";

  /** The size in tiles, which is the picked one's unless it is set by hand. */
  #tiles = { ...MAP_SIZES.medium };

  /** What a map of a kind of battlefield is made from. */
  #seed = newSeed();

  /** The seed that was rolled or set by hand for a place or a point of the World Map, by what names it. */
  #seeds = new Map();

  /** The name the scene is to have, blank for the one it gets by itself. */
  #name = "";

  /** Is the World Map laid over the map on show? */
  #laid = false;

  /** The map on show. @type {import("../rules/mapgen.mjs").BattleMap|null} */
  #map = null;

  /** The World Map as it was last read, if the world has one: what is kept of it, its land and whose it is. */
  #world = null;

  /** The World Map as it is painted, to cut the frame of a map from. */
  #sheets = null;

  /** Is a scene being made? */
  #busy = false;

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /**
   * Open the map generator, or bring it forward. It is a Game Master's.
   * @param {object} [options]
   * @param {Pick} [options.pick]     A place or a point of the World Map to make the map of
   */
  static open({ pick } = {}) {
    if ( !game.user.isGM ) return;
    const app = (MapGenerator.#instance ??= new MapGenerator());
    if ( pick ) {
      app.#source = "world";
      app.#take(pick);
    }
    app.render({ force: true });
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
      open: MapGenerator.open, toggle: MapGenerator.toggle, app: MapGenerator, generate: generateMap,
      generateFromLand, createScene: createMapScene
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
  /*  With the World Map                          */
  /* -------------------------------------------- */

  /**
   * Be told whenever what the generator follows on the World Map has changed: the ground its map is made from,
   * or whether it follows the World Map at all.
   * @param {() => void} told
   */
  static watch(told) {
    MapGenerator.#watchers.add(told);
  }

  /* -------------------------------------------- */

  /**
   * What the generator is making a map of on the World Map, while it is open and making one from it.
   * @returns {{lens: import("../rules/mapgen-land.mjs").Lens, lie: import("../rules/mapgen-land.mjs").Lie,
   *   place: string, point: {x: number, y: number}}|null}
   *   The frame of ground, the lie of the land in it, the place it is made of (blank for a point), and the point
   */
  static survey() {
    const app = MapGenerator.#instance;
    const map = app?.#map;
    if ( !app?.rendered || (app.#source !== "world") || !map?.lens || !app.#pick ) return null;
    const place = app.#world?.map.places.find((other) => other.id === app.#pick.place) ?? null;
    return { lens: map.lens, lie: map.lie, place: place?.id ?? "", point: place ? { x: place.x, y: place.y } : { x: app.#pick.x, y: app.#pick.y } };
  }

  /* -------------------------------------------- */

  /**
   * A place or a point was picked on the World Map: a generator that is open and making its map from the World
   * Map makes it of that.
   * @param {Pick} pick
   * @returns {boolean}         Does it follow? Not if the generator is not following the World Map
   */
  static follow(pick) {
    const app = MapGenerator.#instance;
    if ( !app?.rendered || (app.#source !== "world") || !app.#world ) return false;
    app.#take(pick);
    app.render();
    return true;
  }

  /* -------------------------------------------- */

  /**
   * The World Map changed: a generator that is open is drawn again, as the company may have moved.
   */
  static changed() {
    if ( MapGenerator.#instance?.rendered ) MapGenerator.#instance.render();
  }

  /* -------------------------------------------- */

  /**
   * Make the map of another place or point of the World Map.
   * @param {Pick} pick
   */
  #take(pick) {
    const next = pick.place ? { place: String(pick.place) } : { x: Math.round(pick.x), y: Math.round(pick.y) };
    if ( MapGenerator.#key(next) !== MapGenerator.#key(this.#pick) ) this.#name = "";
    this.#pick = next;
  }

  /* -------------------------------------------- */

  /**
   * What names a place or a point of the World Map.
   * @param {Pick|null} pick
   * @returns {string}
   */
  static #key(pick) {
    return !pick ? "" : pick.place ? pick.place : `${pick.x},${pick.y}`;
  }

  /* -------------------------------------------- */

  /**
   * Read the World Map, if the world has one.
   * @returns {Promise<{map: object, land: object, claims: Uint8Array}|null>}
   */
  async #readWorld() {
    const map = readWorldMap();
    if ( !map.made ) return null;
    const land = await landOf(map);
    return { map, land, claims: claimsOf(map, land) };
  }

  /* -------------------------------------------- */

  /**
   * The seed the map of what is picked on the World Map is made from: one of its own, the same each time, until
   * another is rolled or set by hand.
   * @returns {string}
   */
  #worldSeed() {
    const key = MapGenerator.#key(this.#pick);
    return this.#seeds.get(key) ?? newSeed(seededRandom(`${this.#world.land.key}|${key}`));
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    this.#world = await this.#readWorld();
    const world = this.#world;
    let place = null;
    if ( (this.#source === "world") && world ) {
      const { map } = world;
      place = map.places.find((other) => other.id === this.#pick?.place) ?? null;

      // With nothing picked, or a place that is gone, the map is made of where the company is
      if ( !place && !Number.isFinite(this.#pick?.x) ) {
        place = map.places.find((other) => other.id === map.party) ?? map.places[0] ?? null;
        this.#pick = place ? { place: place.id } : null;
      }
    }
    if ( (this.#source !== "world") || !world || !this.#pick ) {
      this.#source = "kind";
      this.#map = generateMap({ type: this.#type, ...this.#tiles, seed: this.#seed });
      return buildMapGenerator({ source: "kind", type: this.#type, size: this.#size, name: this.#name, map: this.#map, world: { made: !!world } }, game.i18n);
    }

    const { map, land, claims } = world;
    const point = place ?? this.#pick;
    const way = place && (place.id !== map.party) ? pathBetween(map, map.party, place.id) : null;
    this.#map = generateFromLand({
      land, world: map, point, place, ...this.#tiles, seed: this.#worldSeed(),
      cameBy: way?.stops.at(-2) ?? "", rank: stopsFrom(map, map.party)
    });
    const nation = map.nations.find((other) => other.id === nationAt(land, claims, point.x, point.y));
    return buildMapGenerator({
      source: "world", type: this.#type, size: this.#size, name: this.#name, map: this.#map, laid: this.#laid,
      world: { made: true, place, nation: holderTitle(nation, land, point, game.i18n) }
    }, game.i18n);
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
    const map = this.#map;
    if ( canvas && map ) {
      const margin = map.lens ? MapGenerator.#MARGIN : 0;
      const cell = drawMapPreview(canvas, map, { tints: FEO.terrain.tints });
      if ( map.lens ) this.#drawWorld(map, cell, margin);
    }
    MapGenerator.#tell();
  }

  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    MapGenerator.#tell();
  }

  /* -------------------------------------------- */

  /**
   * Tell whoever watches that what the generator follows on the World Map may have changed.
   */
  static #tell() {
    for ( const told of MapGenerator.#watchers ) {
      try {
        told();
      } catch(err) {
        console.error(err);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw what a map made from the World Map shows of it: the frame of ground it was made from, the same to lay
   * over the map itself, and the names of the roads in the margin, each beside the tile its road leaves by.
   * @param {import("../rules/mapgen-land.mjs").LandMap} map
   * @param {number} cell       The side of a tile of the map on show, in pixels
   * @param {number} margin     The room round it
   */
  #drawWorld(map, cell, margin) {
    const { lens } = map;
    const world = this.#world;
    const sheets = this.#paintSheets(lens);
    const inside = (spot) => (spot.x >= lens.x0) && (spot.y >= lens.y0) && (spot.x < lens.x0 + lens.w) && (spot.y < lens.y0 + lens.h);
    const spots = world.map.places.filter(inside).map((place) => ({ x: place.x, y: place.y, picked: place.id === this.#pick?.place }));
    if ( !this.#pick?.place ) spots.push({ x: this.#pick.x, y: this.#pick.y, picked: true });
    const cut = this.element.querySelector("canvas.mg-cut");
    if ( cut ) drawLens(cut, lens, { sheets, width: 204, grid: true, tracks: map.tracks, spots });
    const laid = this.element.querySelector("canvas.mg-laid");
    if ( laid ) drawLens(laid, lens, { sheets, width: map.columns * cell });
    for ( const tag of this.element.querySelectorAll(".mg-tag") ) {
      const along = `${margin + (Number(tag.dataset.at) * cell)}px`;
      if ( (tag.dataset.side === "top") || (tag.dataset.side === "bottom") ) tag.style.left = along;
      else tag.style.top = along;
    }
  }

  /* -------------------------------------------- */

  /**
   * The World Map as it is painted: its ground and what is inked over it, each on a sheet of its own. The peaks
   * and woods are inked once for a land, and the ground is painted where the frame lies.
   * @param {import("../rules/mapgen-land.mjs").Lens} lens
   * @returns {HTMLCanvasElement[]}
   */
  #paintSheets(lens) {
    const { map, land, claims } = this.#world;
    if ( this.#sheets?.land !== land ) {
      const sheet = () => Object.assign(document.createElement("canvas"), { width: land.width, height: land.height });
      this.#sheets = { land, ground: sheet(), marks: sheet() };
      paintMarks(this.#sheets.marks.getContext("2d"), land);
    }
    paintGround(this.#sheets.ground.getContext("2d"), land, claims, map.nations, {
      box: { x0: lens.x0, y0: lens.y0, x1: lens.x0 + lens.w, y1: lens.y0 + lens.h }
    });
    return [this.#sheets.ground, this.#sheets.marks];
  }

  /* -------------------------------------------- */
  /*  Choosing                                    */
  /* -------------------------------------------- */

  /**
   * Set the seed of the map on show.
   * @param {string} seed
   */
  #setSeed(seed) {
    if ( this.#source === "world" ) this.#seeds.set(MapGenerator.#key(this.#pick), seed);
    else this.#seed = seed;
  }

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
    else if ( name === "seed" ) this.#setSeed(String(value).trim().slice(0, 24) || newSeed());
    else if ( name === "name" ) this.#name = String(value).trim();
    else return;
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * The map is to be made from the World Map, or from a kind of battlefield.
   * @this {MapGenerator}
   */
  static #onPickSource(event, target) {
    if ( target.dataset.source === this.#source ) return;
    this.#source = target.dataset.source === "world" ? "world" : "kind";
    this.#name = "";
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
   * Lay the World Map over the map on show, or take it off again.
   * @this {MapGenerator}
   */
  static #onLay(event, target) {
    this.#laid = !this.#laid;
    target.setAttribute("aria-checked", String(this.#laid));
    this.element.querySelector(".mg-frame")?.classList.toggle("mg-laid-on", this.#laid);
  }

  /* -------------------------------------------- */

  /**
   * Make another map of the same kind or the same ground, and the same size, from a seed nobody has asked for
   * yet.
   * @this {MapGenerator}
   */
  static #onReroll() {
    this.#setSeed(newSeed());
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Make a scene of the map on show, keep it with the place it was made of, and go to it.
   * @this {MapGenerator}
   */
  static async #onCreate() {
    if ( this.#busy || !this.#map ) return;
    this.#busy = true;
    try {
      const map = this.#map;
      const id = map.lens ? (this.#pick?.place ?? "") : "";
      const place = this.#world?.map.places.find((other) => other.id === id) ?? null;
      const scene = await createMapScene(map, { name: this.#name || mapName(map, game.i18n, place), place: place?.id ?? "" });
      if ( !scene ) return;
      const kept = place ? await keepWithPlace(scene, place.id) : null;
      const told = kept?.encounter ? "createdFought" : kept ? "createdKept" : "created";
      ui.notifications.info(game.i18n.format(`FEO.MapGen.${told}`, { name: scene.name, place: kept?.place, encounter: kept?.encounter }));
      await this.close();

      // The next map of a kind starts from a seed of its own; a place keeps the seed its scene was made from
      if ( !map.lens ) this.#seed = newSeed();
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

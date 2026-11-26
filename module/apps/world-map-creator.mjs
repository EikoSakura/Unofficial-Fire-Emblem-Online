import { FEO } from "../config.mjs";
import { readEncounters } from "../helpers/encounters.mjs";
import { claimsOf, landOf, readWorldMap, writeWorldMap } from "../helpers/worldmap.mjs";
import { newSeed } from "../rules/mapgen.mjs";
import {
  cleanWorldMap, joinPlaces, kindAt, madeName, makeWorld, nationFacts, packClaims, paintClaims, placeName, removePlace,
  routeKind, stopsFrom, toggleRoute
} from "../rules/worldmap.mjs";
import { buildCreator, phraser } from "./world-map-context.mjs";
import { overlayMarkup } from "./world-map-draw.mjs";
import MapStage from "./world-map-stage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TEMPLATES = `systems/${FEO.id}/templates/worldmap`;

/**
 * The World Map Creator: a window in which a Game Master makes the map of the world and changes any part of it.
 * A land is made from a shape, a number of nations, how settled it is and a seed, and rerolled until it suits,
 * or a picture of the Game Master's own is used in its place. After that the ground of each nation is painted
 * with a brush, nations and places are named, places are added, moved and taken away, and routes are drawn
 * between them. A place may stand anywhere, on land or at sea.
 *
 * Nothing is kept until the map is saved: the window works on a draft of its own. The land and what is laid
 * over it are made by `rules/worldmap.mjs`, what the tools show is worked out by `world-map-context.mjs`, and
 * the map is shown by a `MapStage`.
 */
export default class WorldMapCreator extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-world-map-creator",
    classes: ["feo", "feo-worldmap", "feo-worldmap-creator"],
    window: { title: "FEO.WorldMap.creator", icon: "fa-solid fa-map-location-dot", resizable: true },
    position: { width: 1280, height: 648 },
    actions: {
      tool: WorldMapCreator.#onTool,
      zoom: WorldMapCreator.#onZoom,
      backdrop: WorldMapCreator.#onBackdrop,
      shape: WorldMapCreator.#onShape,
      count: WorldMapCreator.#onCount,
      density: WorldMapCreator.#onDensity,
      reroll: WorldMapCreator.#onReroll,
      redraw: WorldMapCreator.#onRedraw,
      nation: WorldMapCreator.#onNation,
      color: WorldMapCreator.#onColor,
      addNation: WorldMapCreator.#onAddNation,
      removeNation: WorldMapCreator.#onRemoveNation,
      brush: WorldMapCreator.#onBrush,
      style: WorldMapCreator.#onStyle,
      kind: WorldMapCreator.#onKind,
      toggle: WorldMapCreator.#onToggle,
      remove: WorldMapCreator.#onRemove,
      done: WorldMapCreator.#onDone,
      showPlaces: WorldMapCreator.#onShowPlaces,
      join: WorldMapCreator.#onJoin,
      save: WorldMapCreator.#onSave
    }
  };

  /** @override */
  static PARTS = {
    tools: { template: `${TEMPLATES}/tools.hbs`, scrollable: [".wm-tools-in"] },
    map: { template: `${TEMPLATES}/map.hbs` }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /** The one window. @type {WorldMapCreator|null} */
  static #instance = null;

  /**
   * Open the Creator, or bring it forward. It is a Game Master's.
   */
  static open() {
    if ( !game.user.isGM ) return;
    WorldMapCreator.#instance ??= new WorldMapCreator();
    WorldMapCreator.#instance.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Open the Creator, or close it if it is open.
   */
  static toggle() {
    if ( WorldMapCreator.#instance?.rendered ) WorldMapCreator.#instance.close();
    else WorldMapCreator.open();
  }

  /* -------------------------------------------- */

  /**
   * Make the Creator part of the game: a Game Master's button of the Fire Emblem controls, beside the Map
   * Generator's.
   */
  static register() {
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools || !game.user.isGM ) return;
      tools.feoWorldMapCreator = {
        name: "feoWorldMapCreator",
        title: "FEO.Controls.worldMapCreator",
        icon: "fa-solid fa-map-location-dot",
        order: 5.5,
        button: true,
        onChange: () => WorldMapCreator.toggle()
      };
    });
  }

  /* -------------------------------------------- */

  /**
   * The map the world keeps has changed. A Creator with nothing unsaved starts again from it; one with work
   * unsaved only takes where the company has got to, so that saving does not send it back.
   */
  static changed() {
    const app = WorldMapCreator.#instance;
    if ( !app?.rendered || app.#saving || !app.#draft ) return;
    if ( !app.#unsaved ) {
      app.#draft = null;
      app.render();
      return;
    }
    const party = readWorldMap().party;
    if ( app.#draft.places.some((place) => place.id === party) ) app.#draft.party = party;
    app.#draw();
  }

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** The map as it is being made. Its `claims` are not used: see `#claims`. */
  #draft = null;

  /** Whose ground each point is. @type {Uint8Array|null} */
  #claims = null;

  /** The land of the draft. @type {import("../rules/worldmap.mjs").Land|null} */
  #land = null;

  /** How many nations a new map is made with. */
  #count = 5;

  /** The tool in hand: a key of CREATOR_TOOLS. */
  #tool = "land";

  /** The nation the brush paints, 0 for nobody's. */
  #nation = 1;

  /** The width of the brush: a key of FEO.worldMap.brushes. */
  #brush = "medium";

  /** The kind of place a click adds. */
  #kind = "town";

  /** The place being edited. */
  #selected = "";

  /** The place a route is being drawn from. */
  #linking = "";

  /** Is a picture being chosen for the backdrop? */
  #picture = false;

  /** Has the Game Master named the map? Then making it again keeps the name. */
  #named = false;

  #unsaved = false;

  #saving = false;

  /** What shows the map. @type {MapStage|null} */
  #stage = null;

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    if ( !this.#draft ) await this.#load();
    return {
      creator: true,
      made: true,
      ...buildCreator({
        draft: this.#draft,
        land: this.#land,
        claims: this.#claims,
        count: this.#count,
        tool: this.#tool,
        nation: this.#nation,
        brush: this.#brush,
        kind: this.#kind,
        selected: this.#selected,
        linking: this.#linking,
        unsaved: this.#unsaved,
        encounters: readEncounters().map(({ id, name }) => ({ id, name }))
      }, game.i18n),
      picturing: this.#picture || !!this.#draft.backdrop
    };
  }

  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("input", (event) => this.#onInput(event));
    this.element.addEventListener("change", (event) => this.#onChange(event));
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.dataset.tool = this.#tool;
    const viewport = this.element.querySelector(".wm-viewport");
    let fresh = false;
    if ( viewport && (!this.#stage || options.parts?.includes("map")) ) {
      this.#stage?.destroy();
      this.#stage = new MapStage(viewport, {
        mode: (place) => (this.#tool === "nations" ? "paint" : (this.#tool === "places") && place ? "drag" : "pan"),
        place: (id) => this.#onPlace(id),
        ground: (point) => this.#onGround(point),
        paint: (point, from) => this.#onPaint(point, from),
        painted: () => this.render({ parts: ["tools"] }),
        drag: (id, point) => this.#onDrag(id, point),
        dragged: (id) => this.#onDragged(id),
        hover: (point) => this.#stage?.brush(this.#tool === "nations" ? point : null, FEO.worldMap.brushes[this.#brush])
      });
      fresh = true;
    }
    const hint = this.element.querySelector(".wm-hint");
    if ( hint ) hint.textContent = context.hint;
    this.#draw({ ground: fresh });
  }

  /* -------------------------------------------- */

  /** @override */
  async close(options = {}) {
    if ( this.#unsaved && !options.force ) {
      const leave = await DialogV2.confirm({
        window: { title: game.i18n.localize("FEO.WorldMap.creator") },
        content: `<p>${game.i18n.localize("FEO.WorldMap.unsavedAsk")}</p>`,
        rejectClose: false
      });
      if ( !leave ) return this;
    }
    return super.close(options);
  }

  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#stage?.destroy();
    this.#stage = null;
    this.#draft = null;
    this.#unsaved = false;
    this.#selected = "";
    this.#linking = "";
  }

  /* -------------------------------------------- */

  /**
   * Draw the map as the draft has it.
   * @param {object} [options]
   * @param {boolean} [options.ground]      Paint the ground again too
   */
  #draw({ ground = false } = {}) {
    const draft = this.#draft;
    if ( !this.#stage || !draft || !this.#land ) return;
    if ( ground ) this.#stage.ground(this.#land, this.#claims, draft.nations);
    this.#stage.overlay(overlayMarkup({
      places: draft.places,
      routes: draft.routes,
      nations: draft.nations,
      facts: nationFacts(this.#land, this.#claims, draft.nations),
      base: draft.base,
      party: draft.party,
      shown: () => true,
      veiled: (place) => !place.seen,
      named: () => true,
      selected: this.#selected,
      linking: this.#linking
    }));
  }

  /* -------------------------------------------- */

  /**
   * Show that the map is being made, and give the page a moment to draw that before the work begins.
   * @param {boolean} on
   */
  async #busy(on) {
    this.element?.querySelector(".wm-busy")?.classList.toggle("wm-on", on);
    if ( on ) await new Promise((resolve) => setTimeout(resolve, 30));
  }

  /* -------------------------------------------- */
  /*  The Draft                                   */
  /* -------------------------------------------- */

  /**
   * Start from the map the world keeps, or from a new one if it keeps none.
   */
  async #load() {
    const kept = readWorldMap();
    this.#selected = "";
    this.#linking = "";
    this.#picture = false;
    if ( kept.made ) {
      this.#draft = foundry.utils.deepClone(kept);
      this.#land = await landOf(kept);
      this.#claims = claimsOf(kept, this.#land).slice();
      this.#count = Math.max(kept.nations.length, FEO.worldMap.nations.least);
      this.#named = true;
      this.#unsaved = false;
    } else {
      this.#draft = cleanWorldMap({ seed: newSeed() });
      this.#named = false;
      await this.#make();
    }
    this.#nation = this.#draft.nations[0]?.id ?? 0;
  }

  /* -------------------------------------------- */

  /**
   * Make the draft again from what is chosen: the land, unless it is the one already made, and the nations,
   * places and routes laid over it.
   */
  async #make() {
    const draft = this.#draft;
    draft.backdrop = "";
    this.#land = await landOf(draft);
    const world = makeWorld(this.#land, {
      seed: draft.seed, shape: draft.shape, count: this.#count, density: draft.density, turn: draft.turn
    }, { phrase: phraser(game.i18n) });
    const { name, claims, ...made } = world;
    Object.assign(draft, made);
    if ( !this.#named ) draft.name = name;
    this.#claims = claims;
    this.#selected = "";
    this.#linking = "";
    this.#nation = draft.nations[0]?.id ?? 0;
    this.#unsaved = true;
  }

  /* -------------------------------------------- */

  /**
   * Make the draft again and draw it, showing that the work is under way.
   * @param {(draft: object) => void} [choose]      Changes what the map is made from
   */
  async #remake(choose) {
    if ( !this.#draft ) return;
    choose?.(this.#draft);
    await this.#busy(true);
    try {
      await this.#make();
    } finally {
      await this.#busy(false);
    }
    await this.render({ parts: ["tools"] });
    this.#draw({ ground: true });
  }

  /* -------------------------------------------- */

  /**
   * Draw the map over a picture of the Game Master's own. Nothing that was laid over the made land suits it,
   * so the ground is nobody's again and the places are taken off.
   * @param {string} path
   */
  async #usePicture(path) {
    const draft = this.#draft;
    if ( !path || (path === draft.backdrop) ) return;
    await this.#busy(true);
    try {
      const land = await landOf({ ...draft, backdrop: path });
      if ( land.picture ) {
        this.#land = land;
        this.#claims = new Uint8Array(land.width * land.height);
        Object.assign(draft, { backdrop: path, places: [], routes: [], base: "", party: "" });
        this.#selected = "";
        this.#linking = "";
        this.#unsaved = true;
      }
    } finally {
      await this.#busy(false);
    }
    await this.render({ parts: ["tools"] });
    this.#draw({ ground: true });
  }

  /* -------------------------------------------- */

  /**
   * Something of the draft changed: the tools and the map are drawn again.
   * @param {object} [options]
   * @param {boolean} [options.ground]      Paint the ground again too
   */
  async #changed({ ground = false } = {}) {
    this.#unsaved = true;
    await this.render({ parts: ["tools"] });
    if ( ground ) this.#draw({ ground });
  }

  /** The place being edited. */
  #place() {
    return this.#draft?.places.find((place) => place.id === this.#selected) ?? null;
  }

  /* -------------------------------------------- */
  /*  On the Map                                  */
  /* -------------------------------------------- */

  /**
   * A place was clicked: with the routes tool it is one end of a route, otherwise it is the one to edit.
   * @param {string} id
   */
  #onPlace(id) {
    if ( this.#tool === "routes" ) {
      if ( !this.#linking ) this.#linking = id;
      else {
        if ( this.#linking !== id ) {
          toggleRoute(this.#land, this.#draft, this.#linking, id);
          this.#unsaved = true;
        }
        this.#linking = "";
      }
    } else {
      this.#tool = "places";
      this.#selected = id;
    }
    this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */

  /**
   * The map was clicked where no place is: with the places tool a place is added there, unless one was being
   * edited, which is put down instead. On land it is of the kind that is picked, and at sea it is waters.
   * @param {{x: number, y: number}} point
   */
  #onGround(point) {
    const draft = this.#draft;
    if ( this.#tool === "routes" ) this.#linking = "";
    else if ( this.#tool !== "places" ) return;
    else if ( this.#selected ) this.#selected = "";
    else {
      const kind = kindAt(this.#land, point.x, point.y, this.#kind);
      const place = {
        id: foundry.utils.randomID(8), x: Math.round(point.x), y: Math.round(point.y), kind,
        name: placeName(Math.random, kind, phraser(game.i18n)), seen: true, visited: false, battle: false, encounter: "",
        market: FEO.worldMap.market.includes(kind)
      };
      draft.places.push(place);
      if ( !draft.base ) draft.base = draft.party = place.id;
      this.#selected = place.id;
      this.#unsaved = true;
    }
    this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */

  /**
   * The brush moved: the land under it, all the way from where it was, goes to the nation that is picked.
   * @param {{x: number, y: number}} point
   * @param {{x: number, y: number}} from
   */
  #onPaint(point, from) {
    const reach = FEO.worldMap.brushes[this.#brush];
    const steps = Math.max(Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / (reach * 0.5)), 1);
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for ( let step = 1; step <= steps; step++ ) {
      const part = paintClaims(this.#land, this.#claims, from.x + (((point.x - from.x) * step) / steps),
        from.y + (((point.y - from.y) * step) / steps), reach, this.#nation);
      box.x0 = Math.min(box.x0, part.x0);
      box.y0 = Math.min(box.y0, part.y0);
      box.x1 = Math.max(box.x1, part.x1);
      box.y1 = Math.max(box.y1, part.y1);
    }
    this.#stage.groundBox(box);
    this.#unsaved = true;
  }

  /* -------------------------------------------- */

  /**
   * A place is being dragged: it follows the pointer over land and sea, and stays on the map.
   * @param {string} id
   * @param {{x: number, y: number}} point
   */
  #onDrag(id, point) {
    const place = this.#draft.places.find((other) => other.id === id);
    if ( !place ) return;
    place.x = Math.min(Math.max(Math.round(point.x), 0), FEO.worldMap.width - 1);
    place.y = Math.min(Math.max(Math.round(point.y), 0), FEO.worldMap.height - 1);
    this.#selected = id;
    this.#unsaved = true;
    this.#draw();
  }

  /* -------------------------------------------- */

  /**
   * A place was let go: its routes are roads or sea lanes by where they run now.
   * @param {string} id
   */
  #onDragged(id) {
    const at = new Map(this.#draft.places.map((place) => [place.id, place]));
    for ( const route of this.#draft.routes ) {
      if ( (route.a === id) || (route.b === id) ) route.kind = routeKind(this.#land, at.get(route.a), at.get(route.b));
    }
    this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */
  /*  Typing and Choosing                         */
  /* -------------------------------------------- */

  /**
   * A name is being typed: the map shows it at once, and the tools are left alone so the field keeps its place.
   * @param {Event} event
   */
  #onInput(event) {
    const { field, id } = event.target?.dataset ?? {};
    const value = String(event.target.value ?? "");
    if ( field === "name" ) {
      this.#draft.name = value;
      this.#named = !!value.trim();
    }
    else if ( field === "nation" ) {
      const nation = this.#draft.nations.find((other) => other.id === Number(id));
      if ( nation ) nation.name = value;
    }
    else if ( field === "place" ) {
      const place = this.#place();
      if ( place ) place.name = value;
    }
    else return;
    this.#unsaved = true;
    this.#draw();
  }

  /* -------------------------------------------- */

  /**
   * A field was set: the seed, the picture, the encounter of a battle, or a name that was being typed.
   * @param {Event} event
   */
  #onChange(event) {
    const target = event.target;
    const field = target?.dataset?.field;
    if ( field === "seed" ) {
      const seed = String(target.value).trim().slice(0, 24) || newSeed();
      if ( seed !== this.#draft.seed ) this.#remake((draft) => Object.assign(draft, { seed, turn: 0 }));
    }
    else if ( field === "backdrop" ) this.#usePicture(String(target.value ?? "").trim());
    else if ( field === "encounter" ) {
      const place = this.#place();
      if ( place ) place.encounter = target.value;
      this.#changed();
    }
    else if ( ["name", "nation", "place"].includes(field) ) this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Take another tool in hand.
   * @this {WorldMapCreator}
   */
  static #onTool(event, target) {
    this.#tool = target.dataset.tool;
    this.#linking = "";
    this.#stage?.brush(null);
    if ( this.#tool !== "places" ) this.#selected = "";
    this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */

  /**
   * Look closer, or from further off.
   * @this {WorldMapCreator}
   */
  static #onZoom(event, target) {
    this.#stage?.zoomBy(Number(target.dataset.by) || 1);
  }

  /* -------------------------------------------- */

  /**
   * Draw the map over a land that is made, or over a picture.
   * @this {WorldMapCreator}
   */
  static #onBackdrop(event, target) {
    if ( target.dataset.kind === "picture" ) {
      this.#picture = true;
      this.render({ parts: ["tools"] });
      return;
    }
    this.#picture = false;
    if ( this.#draft.backdrop ) this.#remake();
    else this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */

  /**
   * Another shape of land was picked.
   * @this {WorldMapCreator}
   */
  static #onShape(event, target) {
    this.#picture = false;
    this.#remake((draft) => Object.assign(draft, { shape: target.dataset.shape, turn: 0 }));
  }

  /* -------------------------------------------- */

  /**
   * One nation more, or one fewer.
   * @this {WorldMapCreator}
   */
  static #onCount(event, target) {
    const { least, most } = FEO.worldMap.nations;
    const count = Math.min(Math.max(this.#count + Number(target.dataset.by), least), most);
    if ( count === this.#count ) return;
    this.#count = count;
    this.#remake();
  }

  /* -------------------------------------------- */

  /**
   * The land is to be more settled, or less.
   * @this {WorldMapCreator}
   */
  static #onDensity(event, target) {
    this.#remake((draft) => (draft.density = target.dataset.density));
  }

  /* -------------------------------------------- */

  /**
   * Make another land, from a seed nobody has asked for yet.
   * @this {WorldMapCreator}
   */
  static #onReroll() {
    this.#remake((draft) => Object.assign(draft, { seed: newSeed(), turn: 0 }));
  }

  /* -------------------------------------------- */

  /**
   * Keep the land, and make other nations, places and routes on it.
   * @this {WorldMapCreator}
   */
  static #onRedraw() {
    this.#remake((draft) => draft.turn++);
  }

  /* -------------------------------------------- */

  /**
   * Pick the nation the brush paints. Its name is still there to type in afterwards.
   * @this {WorldMapCreator}
   */
  static async #onNation(event, target) {
    const id = Number(target.dataset.nation);
    if ( id === this.#nation ) return;
    this.#nation = id;
    await this.render({ parts: ["tools"] });
    if ( event.target.matches?.("input") ) this.element.querySelector(`input[data-field="nation"][data-id="${id}"]`)?.focus();
  }

  /* -------------------------------------------- */

  /**
   * Give a nation the next colour.
   * @this {WorldMapCreator}
   */
  static #onColor(event, target) {
    event.stopPropagation();
    const nation = this.#draft.nations.find((other) => other.id === Number(target.dataset.nation));
    if ( !nation ) return;
    nation.color = (nation.color + 1) % FEO.worldMap.colors.length;
    this.#changed({ ground: true });
  }

  /* -------------------------------------------- */

  /**
   * Add a nation, which holds no ground until some is painted for it.
   * @this {WorldMapCreator}
   */
  static #onAddNation() {
    const { nations } = this.#draft;
    const { most } = FEO.worldMap.nations;
    let id = 1;
    while ( nations.some((nation) => nation.id === id) ) id++;
    if ( id > most ) return;
    const used = new Set(nations.map((nation) => nation.color));
    const free = FEO.worldMap.colors.findIndex((color, index) => !used.has(index));
    nations.push({
      id, name: madeName(Math.random, "nation"), style: FEO.worldMap.styles[(id - 1) % FEO.worldMap.styles.length],
      color: free < 0 ? id - 1 : free
    });
    nations.sort((a, b) => a.id - b.id);
    this.#nation = id;
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * Take the picked nation off the map. The ground it held is nobody's.
   * @this {WorldMapCreator}
   */
  static #onRemoveNation() {
    const draft = this.#draft;
    const id = this.#nation;
    if ( !id || (draft.nations.length < 2) ) return;
    draft.nations = draft.nations.filter((nation) => nation.id !== id);
    for ( let i = 0; i < this.#claims.length; i++ ) if ( this.#claims[i] === id ) this.#claims[i] = 0;
    this.#nation = draft.nations[0].id;
    this.#changed({ ground: true });
  }

  /* -------------------------------------------- */

  /**
   * Another width of brush.
   * @this {WorldMapCreator}
   */
  static #onBrush(event, target) {
    this.#brush = target.dataset.brush;
    this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */

  /**
   * What kind of nation the picked one is.
   * @this {WorldMapCreator}
   */
  static #onStyle(event, target) {
    const nation = this.#draft.nations.find((other) => other.id === this.#nation);
    if ( !nation ) return;
    nation.style = target.dataset.style;
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * The kind of the place being edited, or of the next place to be added.
   * @this {WorldMapCreator}
   */
  static #onKind(event, target) {
    const place = this.#place();
    if ( !place ) {
      this.#kind = target.dataset.kind;
      this.render({ parts: ["tools"] });
      return;
    }
    place.kind = target.dataset.kind;
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * Switch something about the place being edited: whether the Base is there, whether it has a market or a
   * battle, and whether the players see it and have been there.
   * @this {WorldMapCreator}
   */
  static #onToggle(event, target) {
    const draft = this.#draft;
    const place = this.#place();
    if ( !place ) return;
    const what = target.dataset.toggle;
    if ( what === "base" ) {
      // The Base moves here, and the company with it if it was at home
      if ( draft.base === place.id ) return;
      if ( draft.party === draft.base ) draft.party = place.id;
      draft.base = place.id;
    }
    else if ( ["market", "battle", "seen", "visited"].includes(what) ) place[what] = !place[what];
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * Take the place being edited off the map.
   * @this {WorldMapCreator}
   */
  static #onRemove() {
    if ( !this.#selected ) return;
    removePlace(this.#draft, this.#selected);
    this.#selected = "";
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * Put down the place being edited.
   * @this {WorldMapCreator}
   */
  static #onDone() {
    this.#selected = "";
    this.render({ parts: ["tools"] });
  }

  /* -------------------------------------------- */

  /**
   * Show every place to the players, or only those near the Base.
   * @this {WorldMapCreator}
   */
  static #onShowPlaces(event, target) {
    const draft = this.#draft;
    const stops = target.dataset.which === "near" ? stopsFrom(draft, draft.base) : null;
    for ( const place of draft.places ) {
      place.seen = !stops || (place.kind === "capital") || ((stops.get(place.id) ?? Infinity) <= FEO.worldMap.known);
    }
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * Lay routes that reach every place, in the place of those there are.
   * @this {WorldMapCreator}
   */
  static #onJoin() {
    const draft = this.#draft;
    draft.routes = joinPlaces(this.#land, draft.places, FEO.worldMap.density[draft.density].apart, Math.random);
    this.#linking = "";
    this.#changed();
  }

  /* -------------------------------------------- */

  /**
   * Keep the map with the world. Every open World Map shows it at once.
   * @this {WorldMapCreator}
   */
  static async #onSave() {
    if ( this.#saving || !this.#draft ) return;
    this.#saving = true;
    try {
      const kept = await writeWorldMap({ ...this.#draft, made: true, claims: packClaims(this.#claims) });
      this.#draft = foundry.utils.deepClone(kept);
      this.#named = true;
      this.#unsaved = false;
      ui.notifications.info("FEO.WorldMap.saved", { localize: true });
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    } finally {
      this.#saving = false;
    }
    this.render({ parts: ["tools"] });
  }
}

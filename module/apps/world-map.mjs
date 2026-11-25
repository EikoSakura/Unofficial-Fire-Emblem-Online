import { FEO } from "../config.mjs";
import {
  beginBattleAt, changePlace, claimsOf, encounterAt, keepTravel, landOf, marchTo, pointAt, readTravel, readWorldMap,
  registerWorldMap, showToAll
} from "../helpers/worldmap.mjs";
import { alongRoute, nationFacts, pathBetween } from "../rules/worldmap.mjs";
import MapGenerator from "./map-generator.mjs";
import { buildWorldMap } from "./world-map-context.mjs";
import WorldMapCreator from "./world-map-creator.mjs";
import { lensMarkup, overlayMarkup } from "./world-map-draw.mjs";
import MapStage from "./world-map-stage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TEMPLATES = `systems/${FEO.id}/templates/worldmap`;

/**
 * The World Map: the land the campaign is set in, with a dot for each place, the routes between them, the
 * ground of each nation, and the company's banner on the place it has come to. Everyone sees the same map. The
 * Game Master sends the company from place to place along the routes, and every open map watches it march; a
 * player can pick a place out and point at it. When the company arrives, the name of the place is shown across
 * the map, with what may be done there at once.
 *
 * A Game Master can have a battle map made of a place, in the Map Generator. While that is open and making its
 * map from the World Map, it follows what is picked here, a click on bare ground picks that ground out, and the
 * frame of ground the battle map is made from is drawn on the map.
 *
 * The map is shown in a window, or as the travel view: over the whole screen with no frame, under Foundry's own
 * interface as a scene would be. Each user's choice of the two is remembered.
 *
 * What the world keeps of the map is read and changed through `helpers/worldmap.mjs`, what is shown around the
 * map is worked out by `world-map-context.mjs`, and the map itself is drawn by a `MapStage`. This class keeps
 * what the reader has picked out and answers to the mouse.
 */
export default class WorldMap extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-world-map",
    classes: ["feo", "feo-worldmap"],
    window: {
      title: "FEO.WorldMap.title",
      icon: "fa-solid fa-earth-europe",
      resizable: true,
      controls: [
        { icon: "fa-solid fa-expand", label: "FEO.WorldMap.act.travel", action: "travel" },
        { icon: "fa-solid fa-users-viewfinder", label: "FEO.WorldMap.act.showAll", action: "showAll", visible: () => game.user.isGM },
        { icon: "fa-solid fa-map-location-dot", label: "FEO.WorldMap.act.edit", action: "create", visible: () => game.user.isGM }
      ]
    },
    position: { width: 1100, height: 814 },
    actions: {
      spot: WorldMap.#onSpot,
      zoom: WorldMap.#onZoom,
      march: WorldMap.#onMarch,
      home: WorldMap.#onHome,
      veil: WorldMap.#onVeil,
      won: WorldMap.#onWon,
      field: WorldMap.#onField,
      begin: WorldMap.#onBegin,
      point: WorldMap.#onPoint,
      base: WorldMap.#onBase,
      create: WorldMap.#onCreate,
      showAll: WorldMap.#onShowAll,
      travel: WorldMap.#onTravel,
      dismiss: WorldMap.#onDismiss
    }
  };

  /** @override */
  static PARTS = {
    map: { template: `${TEMPLATES}/map.hbs` },
    heads: { template: `${TEMPLATES}/heads.hbs` },
    plate: { template: `${TEMPLATES}/plate.hbs` },
    splash: { template: `${TEMPLATES}/splash.hbs` }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /** The one window. @type {WorldMap|null} */
  static #instance = null;

  /**
   * Open the World Map, or bring it forward.
   * @param {object} [options]
   * @param {boolean} [options.travel]      Open it over the whole screen, or in its window; as it last was if
   *                                        not given
   */
  static open({ travel } = {}) {
    const app = (WorldMap.#instance ??= new WorldMap());
    if ( typeof travel === "boolean" ) app.#showAs(travel);
    app.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Open the World Map, or close it if it is open.
   */
  static toggle() {
    if ( WorldMap.#instance?.rendered ) WorldMap.#instance.close();
    else WorldMap.open();
  }

  /* -------------------------------------------- */

  /**
   * Make the World Map part of the game: the setting that holds it, a way to open it from the Fire Emblem
   * controls and from a macro, and a fresh drawing on every client whenever it changes.
   */
  static register() {
    registerWorldMap({
      changed: () => {
        WorldMap.#instance?.#follow();
        WorldMapCreator.changed();
        MapGenerator.changed();
      },
      pointed: (place, user) => WorldMap.#pointed(place, user),
      shown: (travel) => WorldMap.open(travel ? { travel: true } : {})
    });
    game.feo.worldMap = {
      open: WorldMap.open, toggle: WorldMap.toggle, app: WorldMap, read: readWorldMap, marchTo, creator: WorldMapCreator
    };
    WorldMapCreator.register();
    MapGenerator.watch(() => WorldMap.#instance?.#surveyed());

    // A button of the Fire Emblem controls, after the Base's, opens the window, and closes it again
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools ) return;
      tools.feoWorldMap = {
        name: "feoWorldMap",
        title: "FEO.Controls.worldMap",
        icon: "fa-solid fa-earth-europe",
        order: 2.5,
        button: true,
        onChange: () => WorldMap.toggle()
      };
    });
  }

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** The place that is picked out. */
  #selected = "";

  /** The point of bare ground a Game Master picked out to make a battlefield of. @type {{x: number, y: number}|null} */
  #ground = null;

  /** The nation that is picked out, 0 for none. */
  #spotlight = 0;

  /** Is the company on its way? */
  #marching = false;

  /** Is the map over the whole screen? */
  #travel = readTravel();

  /** Has the company just arrived, with the name of the place still across the map? */
  #arrived = false;

  /** The wait before an arrival that asks nothing is taken down. */
  #lingering = 0;

  /** The map as it was last read. @type {import("../rules/worldmap.mjs").WorldMapState|null} */
  #map = null;

  /** Its land. @type {import("../rules/worldmap.mjs").Land|null} */
  #land = null;

  /** Whose ground each point of it is. @type {Uint8Array|null} */
  #claims = null;

  /** What shows the map. @type {MapStage|null} */
  #stage = null;

  /** What the ground was last painted from. */
  #groundKey = "";

  /** Changes of the map are followed one at a time. */
  #queue = Promise.resolve();

  #said = 0;

  /** May the reader see a place? */
  static #shown = (place) => game.user.isGM || place.seen;

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const map = readWorldMap();
    this.#map = map;
    this.#land = map.made ? await landOf(map) : null;
    this.#claims = this.#land ? claimsOf(map, this.#land) : null;
    const picked = map.places.find((place) => place.id === this.#selected);
    if ( !picked || !WorldMap.#shown(picked) ) this.#selected = "";
    if ( !map.nations.some((nation) => nation.id === this.#spotlight) ) this.#spotlight = 0;
    const survey = game.user.isGM && this.#ground ? MapGenerator.survey() : null;
    if ( !survey || survey.place ) this.#ground = null;
    return buildWorldMap({
      map,
      land: this.#land,
      claims: this.#claims,
      selected: this.#selected,
      spotlight: this.#spotlight,
      isGM: game.user.isGM,
      marching: this.#marching,
      arrived: this.#arrived,
      encounterOf: encounterAt,
      fieldOf: (place) => !!place.scene && game.scenes.has(place.scene),
      ground: this.#ground ? { ...this.#ground, lie: survey.lie } : null
    }, game.i18n);
  }

  /* -------------------------------------------- */

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.classList.toggle("wm-travel", this.#travel);
    return frame;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("wm-travel", this.#travel);
    if ( options.parts?.includes("splash") ) this.#linger(context.splash);
    const viewport = this.element.querySelector(".wm-viewport");
    if ( !viewport ) {
      this.#stage?.destroy();
      this.#stage = null;
      return;
    }
    if ( !this.#stage || options.parts?.includes("map") ) {
      this.#stage?.destroy();
      this.#groundKey = "";
      this.#stage = new MapStage(viewport, {
        mode: () => "pan",
        place: (id) => this.#pick(id),
        ground: (point) => this.#pickGround(point)
      });
    }
    this.#draw();
  }

  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#stage?.destroy();
    this.#stage = null;
    this.#marching = false;
    this.#selected = "";
    this.#ground = null;
    this.#arrived = false;
    clearTimeout(this.#lingering);
  }

  /* -------------------------------------------- */

  /**
   * Show the map over the whole screen, or in its window.
   * @param {boolean} travel
   */
  #showAs(travel) {
    this.#travel = travel;
    this.element?.classList.toggle("wm-travel", travel);
  }

  /* -------------------------------------------- */

  /**
   * Draw the map: the ground, if it is not as it was last painted, and everything that lies over it.
   */
  #draw() {
    const { map, land, claims } = { map: this.#map, land: this.#land, claims: this.#claims };
    if ( !this.#stage || !map?.made || !land ) return;
    const key = [land.key, this.#spotlight, JSON.stringify(map.nations), map.claims].join("|");
    if ( key !== this.#groundKey ) {
      this.#stage.ground(land, claims, map.nations, this.#spotlight);
      this.#groundKey = key;
    }
    const shown = WorldMap.#shown;
    const way = !this.#marching && this.#selected && (this.#selected !== map.party)
      ? pathBetween(map, map.party, this.#selected, shown) : null;
    this.#stage.overlay(overlayMarkup({
      places: map.places,
      routes: map.routes,
      nations: map.nations,
      facts: nationFacts(land, claims, map.nations),
      base: map.base,
      party: map.party,
      shown,
      veiled: (place) => !place.seen,
      named: (place) => (place.kind === "capital") || place.battle || (place.id === map.base) || (place.id === map.party),
      selected: this.#selected,
      lit: way?.legs ?? [],
      spotlight: this.#spotlight
    }));

    // The frame of ground the Map Generator is making a battlefield from
    const survey = game.user.isGM ? MapGenerator.survey() : null;
    this.#stage.overlay({ lens: survey && (survey.lens.w < land.width) ? lensMarkup(survey.lens, survey.place ? null : survey.point) : "" });
  }

  /* -------------------------------------------- */

  /**
   * Pick a place out, or none. A Map Generator that follows the World Map makes its map of the place.
   * @param {string} id
   */
  #pick(id) {
    if ( this.#marching ) return;
    if ( id && game.user.isGM ) MapGenerator.follow({ place: id });
    if ( (id === this.#selected) && !this.#ground ) return;
    this.#selected = id;
    this.#ground = null;
    this.render({ parts: ["plate"] });
  }

  /* -------------------------------------------- */

  /**
   * The map was clicked where no place is. A Map Generator that follows the World Map makes its map of the
   * ground there, which is picked out; otherwise nothing is picked out any more.
   * @param {{x: number, y: number}} point
   */
  #pickGround(point) {
    if ( this.#marching ) return;
    const followed = game.user.isGM ? MapGenerator.follow(point) : null;
    if ( followed === null ) return this.#pick("");
    if ( !followed ) return this.#say(game.i18n.localize("FEO.WorldMap.openSea"));
    this.#selected = "";
    this.#ground = { x: point.x, y: point.y };
    this.render({ parts: ["plate"] });
  }

  /* -------------------------------------------- */

  /**
   * What the Map Generator is making a map of has changed, or it was opened or closed: the frame of ground is
   * drawn again, and the plate with it where it tells of ground that was picked out.
   */
  #surveyed() {
    if ( !this.rendered || !game.user.isGM ) return;

    // Ground the generator took up again by itself is picked out here as well
    const survey = MapGenerator.survey();
    const taken = !this.#ground && !this.#marching && !!survey && !survey.place;
    if ( taken ) {
      this.#selected = "";
      this.#ground = { ...survey.point };
    }
    if ( this.#ground ) this.render({ parts: ["plate"] });
    else this.#draw();
  }

  /* -------------------------------------------- */

  /**
   * Say something over the map for a moment.
   * @param {string} text
   */
  #say(text) {
    const toast = this.element?.querySelector(".wm-toast");
    if ( !toast ) return;
    toast.textContent = text;
    toast.classList.add("wm-on");
    clearTimeout(this.#said);
    this.#said = setTimeout(() => toast.classList.remove("wm-on"), 2800);
  }

  /* -------------------------------------------- */
  /*  Following the Map                           */
  /* -------------------------------------------- */

  /**
   * The map changed. If the company has moved, it is watched as it marches there, and its arrival is shown
   * across the map; then the window is drawn again. Changes are followed in the order they came.
   */
  #follow() {
    this.#queue = this.#queue.then(async () => {
      if ( !this.rendered ) return;
      const before = this.#map;
      const next = readWorldMap();
      const sameLand = before?.made && next.made && (before.backdrop === next.backdrop) && (before.seed === next.seed)
        && (before.shape === next.shape);
      if ( !sameLand ) return this.render();
      if ( next.party === before.party ) return this.render({ parts: ["heads", "plate"] });

      // An arrival still up gives way to the next march
      if ( this.#arrived ) {
        this.#arrived = false;
        await this.render({ parts: ["splash"] });
      }
      this.#arrived = await this.#walk(next, before.party, next.party);
      await this.render({ parts: ["heads", "plate", "splash"] });
    }).catch((err) => console.error(err));
  }

  /* -------------------------------------------- */

  /**
   * An arrival was drawn, or taken down: one that asks nothing stays up for a moment only.
   * @param {{stays: boolean}|null} splash
   */
  #linger(splash) {
    clearTimeout(this.#lingering);
    if ( splash && !splash.stays ) this.#lingering = setTimeout(() => this.#dismiss(), FEO.worldMap.splash);
  }

  /* -------------------------------------------- */

  /**
   * Take the arrival down, if it is up.
   */
  #dismiss() {
    clearTimeout(this.#lingering);
    if ( !this.#arrived ) return;
    this.#arrived = false;
    this.element?.querySelector(".wm-splash")?.classList.add("wm-leaving");
    this.#lingering = setTimeout(() => {
      if ( this.rendered && !this.#arrived ) this.render({ parts: ["splash"] });
    }, 260);
  }

  /* -------------------------------------------- */

  /**
   * Walk the banner from one place to another along the routes.
   * @param {import("../rules/worldmap.mjs").WorldMapState} map
   * @param {string} from
   * @param {string} to
   * @returns {Promise<boolean>}    Once it has arrived: did it march there, with the map still open to see it?
   */
  async #walk(map, from, to) {
    const way = pathBetween(map, from, to);
    const stage = this.#stage;
    if ( !way?.legs.length || !stage ) return false;
    const at = new Map(map.places.map((place) => [place.id, place]));
    const legs = way.legs.map((leg) => {
      const a = at.get(leg.from);
      const b = at.get(leg.to);
      const time = Math.max((Math.hypot(a.x - b.x, a.y - b.y) / FEO.worldMap.speed) * 1000, 120);
      return { a, b, bend: leg.from === leg.route.a ? leg.route.bend : -leg.route.bend, time };
    });
    const whole = legs.reduce((sum, leg) => sum + leg.time, 0);
    this.#marching = true;
    this.#selected = "";
    stage.overlay({ lit: "" });
    this.element?.querySelectorAll(".wm-plate [data-action]").forEach((button) => (button.disabled = true));

    // The banner is moved frame by frame; a page that draws no frames is not waited for
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, whole + 800);
      let leg = 0;
      let began = null;
      const frame = (now) => {
        if ( (this.#stage !== stage) || !this.rendered ) return resolve();
        began ??= now;
        const { a, b, bend, time } = legs[leg];
        const t = Math.min((now - began) / time, 1);
        const point = alongRoute(a, b, bend, t);
        stage.banner(point.x, point.y);
        if ( t >= 1 ) {
          leg++;
          began = null;
          if ( leg >= legs.length ) {
            clearTimeout(timer);
            return resolve();
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    this.#marching = false;
    return this.rendered && (this.#stage === stage);
  }

  /* -------------------------------------------- */

  /**
   * A user pointed at a place: it flashes on the map if that is open, and is told otherwise.
   * @param {string} id
   * @param {User} user
   */
  static #pointed(id, user) {
    const place = readWorldMap().places.find((other) => other.id === id);
    if ( !place || !WorldMap.#shown(place) ) return;
    const text = game.i18n.format("FEO.WorldMap.pointed", { user: user.name, place: place.name });
    const app = WorldMap.#instance;
    if ( app?.rendered && app.#stage ) {
      app.#stage.ping(place.x, place.y);
      app.#say(text);
    }
    else ui.notifications.info(text);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * The place the plate is about: the one picked out, or the one the company is at.
   * @returns {import("../rules/worldmap.mjs").Place|null}
   */
  #place() {
    const map = this.#map;
    return map?.places.find((place) => place.id === (this.#selected || map.party)) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Pick a nation out, or stop picking it out.
   * @this {WorldMap}
   */
  static #onSpot(event, target) {
    const id = Number(target.dataset.nation);
    this.#spotlight = this.#spotlight === id ? 0 : id;
    this.render({ parts: ["heads"] });
  }

  /* -------------------------------------------- */

  /**
   * Look closer, or from further off.
   * @this {WorldMap}
   */
  static #onZoom(event, target) {
    this.#stage?.zoomBy(Number(target.dataset.by) || 1);
  }

  /* -------------------------------------------- */

  /**
   * Send the company to the place that is picked out.
   * @this {WorldMap}
   */
  static async #onMarch() {
    const place = this.#place();
    if ( place && !this.#marching && !(await marchTo(place.id)) ) ui.notifications.warn("FEO.WorldMap.noWay", { localize: true });
  }

  /* -------------------------------------------- */

  /**
   * Send the company back to the Base.
   * @this {WorldMap}
   */
  static async #onHome() {
    if ( !this.#marching && this.#map?.base ) await marchTo(this.#map.base);
  }

  /* -------------------------------------------- */

  /**
   * Show a place to the players, or hide it from them.
   * @this {WorldMap}
   */
  static async #onVeil() {
    const place = this.#place();
    if ( place ) await changePlace(place.id, (kept) => (kept.seen = !kept.seen));
  }

  /* -------------------------------------------- */

  /**
   * The battle at the place is won: none waits there any more.
   * @this {WorldMap}
   */
  static async #onWon() {
    const place = this.#place();
    if ( !place ) return;
    await changePlace(place.id, (kept) => {
      kept.battle = false;
      kept.visited = true;
    });
  }

  /* -------------------------------------------- */

  /**
   * Open the Map Generator on the place the plate is about, or on the ground that is picked out, to make a
   * battle map of the land there.
   * @this {WorldMap}
   */
  static #onField() {
    const place = this.#ground ? null : this.#place();
    if ( this.#ground ) MapGenerator.open({ pick: this.#ground });
    else if ( place ) MapGenerator.open({ pick: { place: place.id } });
  }

  /* -------------------------------------------- */

  /**
   * Begin the battle that waits where the company is, once the Game Master has said that it should. An arrival
   * has asked already, by offering to wait.
   * @this {WorldMap}
   */
  static async #onBegin(event, target) {
    const place = this.#place();
    const encounter = encounterAt(place);
    if ( !encounter ) return;
    if ( !target?.closest(".wm-splash") ) {
      const name = foundry.utils.escapeHTML?.(encounter.name) ?? encounter.name;
      const sure = await DialogV2.confirm({
        window: { title: game.i18n.localize("FEO.Encounter.foot.begin") },
        content: `<p>${game.i18n.format("FEO.Encounter.foot.beginAsk", { name })}</p>`,
        rejectClose: false
      });
      if ( !sure ) return;
    }
    this.#dismiss();
    try {
      if ( await beginBattleAt(place) ) await this.close();
      else ui.notifications.warn("FEO.WorldMap.act.beginNone", { localize: true });
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    }
  }

  /* -------------------------------------------- */

  /**
   * Point at the place that is picked out, for everyone to see.
   * @this {WorldMap}
   */
  static #onPoint() {
    const place = this.#place();
    if ( !place ) return;
    pointAt(place.id);
    this.#stage?.ping(place.x, place.y);
    this.#say(game.i18n.format("FEO.WorldMap.pointing", { place: place.name }));
  }

  /* -------------------------------------------- */

  /**
   * Go into the Base.
   * @this {WorldMap}
   */
  static #onBase() {
    this.#dismiss();
    game.feo.base?.open();
  }

  /* -------------------------------------------- */

  /**
   * Open the Creator, to make the map or to change it.
   * @this {WorldMap}
   */
  static #onCreate() {
    WorldMapCreator.open();
  }

  /* -------------------------------------------- */

  /**
   * Open the map on everyone's screen, over the whole of it if that is how it is shown here.
   * @this {WorldMap}
   */
  static #onShowAll() {
    showToAll(this.#travel);
    ui.notifications.info("FEO.WorldMap.shownToAll", { localize: true });
  }

  /* -------------------------------------------- */

  /**
   * Put the map over the whole screen, or back in its window.
   * @this {WorldMap}
   */
  static #onTravel() {
    this.#showAs(!this.#travel);
    keepTravel(this.#travel).catch((err) => console.error(err));
  }

  /* -------------------------------------------- */

  /**
   * Take the arrival down.
   * @this {WorldMap}
   */
  static #onDismiss() {
    this.#dismiss();
  }
}

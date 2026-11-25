import { FEO } from "../config.mjs";
import {
  beginEncounter, blowBetween, describeUnit, mapOf, npcPool, partyPool, placeEncounter, placedTokens, readEncounters,
  registerEncounters, removeEncounter, standsOf, tileBlocked, writeEncounter
} from "../helpers/encounters.mjs";
import { specOf } from "../helpers/npc.mjs";
import { cleanEncounter, newEncounter, partyLevel, scatterTiles } from "../rules/encounters.mjs";
import { buildEncounterBuilder } from "./encounter-builder-context.mjs";
import { drawEncounterMap, tileAt } from "./encounter-map.mjs";
import MapGenerator from "./map-generator.mjs";
import NpcBuilder from "./npc-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Encounter Builder: a window in which a Game Master prepares a battle. Which units are in it and how many,
 * where they stand on its map and when they arrive, what the party has to do, and how that reads for the party
 * that is going.
 *
 * An encounter is kept with the world as it is changed (see helpers/encounters.mjs), and nothing is put on a
 * scene until the Game Master asks for it. What the window shows is worked out by
 * `encounter-builder-context.mjs`, and its map is drawn by `encounter-map.mjs`.
 */
export default class EncounterBuilder extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-encounter-builder",
    classes: ["feo", "feo-encounter"],
    window: { title: "FEO.Encounter.title", icon: "fa-solid fa-flag", resizable: true },
    position: { width: 1280, height: 820 },
    actions: {
      newEncounter: EncounterBuilder.#onNewEncounter,
      deleteEncounter: EncounterBuilder.#onDeleteEncounter,
      generate: EncounterBuilder.#onGenerate,
      objective: EncounterBuilder.#onObjective,
      survive: EncounterBuilder.#onSurvive,
      select: EncounterBuilder.#onSelect,
      count: EncounterBuilder.#onCount,
      remove: EncounterBuilder.#onRemove,
      newNpc: EncounterBuilder.#onNewNpc,
      edit: EncounterBuilder.#onEdit,
      duplicate: EncounterBuilder.#onDuplicate,
      arrive: EncounterBuilder.#onArrive,
      turn: EncounterBuilder.#onTurn,
      protect: EncounterBuilder.#onProtect,
      markGoal: EncounterBuilder.#onMarkGoal,
      scatter: EncounterBuilder.#onScatter,
      partyOpen: EncounterBuilder.#onPartyOpen,
      going: EncounterBuilder.#onGoing,
      partyOnline: EncounterBuilder.#onPartyOnline,
      partyOnMap: EncounterBuilder.#onPartyOnMap,
      partyClear: EncounterBuilder.#onPartyClear,
      show: EncounterBuilder.#onShow,
      way: EncounterBuilder.#onWay,
      place: EncounterBuilder.#onPlace,
      begin: EncounterBuilder.#onBegin
    }
  };

  /** @override */
  static PARTS = {
    builder: { template: `systems/${FEO.id}/templates/encounter/builder.hbs`, scrollable: [".eb-forces", ".eb-read"] }
  };

  /* -------------------------------------------- */

  /** The one window. @type {EncounterBuilder|null} */
  static #instance = null;

  /** The id of the encounter on show. */
  #id = "";

  /** The id of the group in hand. */
  #selected = "";

  /** Which side of the right-hand column is on show: the read, or the unit in hand. */
  #tab = "read";

  /** Which way the read looks: what the foes do to the party, or the party to the foes. */
  #way = "in";

  /** Is the list of who may go open? Until it was opened or closed by hand, it is while nobody is going. */
  #partyOpen = null;

  /** What a click on the map places: the group in hand, or the space the Objectives are about. */
  #placing = "group";

  /** What the window has to say just now. */
  #say = "";

  /** Is something being put on the map? */
  #busy = false;

  /** Is the next change of the encounter one the window need not be drawn again for? */
  #quiet = false;

  /** What the window was last drawn from: the encounter, its map, and where its units stand. */
  #shown = null;

  /** The pictures of scenes, by their address, once they have loaded. @type {Map<string, HTMLImageElement|null>} */
  #pictures = new Map();

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /**
   * Open the Encounter Builder, or bring it forward. It is a Game Master's.
   * @returns {Promise<EncounterBuilder|null>}
   */
  static async open() {
    if ( !game.user.isGM ) return null;
    const app = EncounterBuilder.#instance ??= new EncounterBuilder();
    await app.render({ force: true });
    app.bringToFront();
    return app;
  }

  /* -------------------------------------------- */

  /**
   * Open the Encounter Builder, or close it if it is open.
   */
  static toggle() {
    if ( EncounterBuilder.#instance?.rendered ) EncounterBuilder.#instance.close();
    else EncounterBuilder.open();
  }

  /* -------------------------------------------- */

  /**
   * Make the Encounter Builder part of the game: the encounters the world keeps, a way to open the window from
   * the Fire Emblem controls and from a macro, and the window kept up with what it shows.
   */
  static register() {
    const refresh = foundry.utils.debounce(() => {
      const app = EncounterBuilder.#instance;
      if ( !app?.rendered ) return;
      if ( app.#quiet ) app.#quiet = false;
      else app.render();
    }, 60);
    registerEncounters(refresh);
    game.feo.encounterBuilder = { open: EncounterBuilder.open, toggle: EncounterBuilder.toggle, app: EncounterBuilder };
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools || !game.user.isGM ) return;
      tools.feoEncounter = {
        name: "feoEncounter",
        title: "FEO.Controls.encounter",
        icon: "fa-solid fa-flag",
        order: 6,
        button: true,
        onChange: () => EncounterBuilder.toggle()
      };
    });

    // The map on show follows the scene: its tokens, its painted ground
    for ( const hook of ["createToken", "updateToken", "deleteToken", "createRegion", "updateRegion", "deleteRegion", "updateScene"] ) Hooks.on(hook, refresh);
  }

  /* -------------------------------------------- */
  /*  The Encounter                               */
  /* -------------------------------------------- */

  /**
   * The encounter on show: the one that was picked, or else the one last worked on. A world that keeps none
   * yet is shown a new one, which is kept once something is changed in it.
   * @returns {import("../rules/encounters.mjs").Encounter}
   */
  #encounter() {
    const kept = readEncounters();
    const found = kept.find((encounter) => encounter.id === this.#id) ?? kept[0] ?? null;
    if ( found ) {
      this.#id = found.id;
      return found;
    }
    this.#id ||= foundry.utils.randomID();
    return { ...newEncounter(this.#id, game.i18n.localize("FEO.Encounter.fresh")), scene: canvas?.scene?.id ?? "" };
  }

  /* -------------------------------------------- */

  /**
   * Change the encounter on show and keep it. The window is drawn again as the world takes the change.
   * @param {object} changes
   * @param {string} [say]      What to say of it
   * @returns {Promise<void>}
   */
  async #keep(changes, say = "") {
    this.#say = say;
    const encounter = this.#encounter();
    const next = cleanEncounter({ ...encounter, ...changes });
    const kept = readEncounters().some((other) => other.id === encounter.id);

    // A change that changes nothing is not told by the world, so the window is drawn again here
    if ( kept && (JSON.stringify(next) === JSON.stringify(encounter)) ) {
      this.#quiet = false;
      this.render();
      return;
    }
    try {
      await writeEncounter(next);
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    }
  }

  /**
   * Change one group of the encounter on show.
   * @param {string} id
   * @param {object|null} changes     What changes of it; null to take it out
   * @returns {Promise<void>}
   */
  #keepGroup(id, changes) {
    const groups = this.#encounter().groups.flatMap((group) => {
      if ( group.id !== id ) return [group];
      return changes ? [{ ...group, ...changes }] : [];
    });
    return this.#keep({ groups });
  }

  /* -------------------------------------------- */

  /**
   * Add a unit to the encounter on show, unless it is in it already, and take it in hand.
   * @param {string} actor      The id of the unit
   * @returns {Promise<void>}
   */
  async #addUnit(actor) {
    const encounter = this.#encounter();
    const there = encounter.groups.find((group) => group.actor === actor);
    if ( there ) {
      this.#selected = there.id;
      this.#tab = "unit";
      this.render();
      return;
    }
    const id = foundry.utils.randomID(8);
    this.#selected = id;
    this.#tab = "unit";
    await this.#keep({ groups: [...encounter.groups, { id, actor, count: 1, turn: 0, tile: null }] });
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const encounters = readEncounters();
    const encounter = this.#encounter();
    const scene = game.scenes.get(encounter.scene) ?? null;
    const map = mapOf(scene);
    const groups = encounter.groups.map((group) => {
      const actor = game.actors.get(group.actor) ?? null;
      return { group, actor, unit: actor ? describeUnit(actor) : null };
    });
    const units = new Map(groups.filter((entry) => entry.unit).map((entry) => [entry.group.id, entry.unit]));
    const stands = standsOf(encounter, map, units);
    if ( !groups.some((entry) => entry.group.id === this.#selected) ) this.#selected = "";

    const pool = partyPool().map(({ actor, user }) => ({
      ...describeUnit(actor),
      actor,
      player: user?.name ?? "",
      online: !!user?.active,
      going: encounter.party.includes(actor.id)
    }));
    const going = pool.filter((unit) => unit.going);
    const foes = groups.filter((entry) => entry.unit?.side === "enemy");
    const blows = {
      dealt: going.map((unit) => foes.map((foe) => blowBetween(unit.actor, foe.actor))),
      taken: foes.map((foe) => going.map((unit) => blowBetween(foe.actor, unit.actor)))
    };
    this.#shown = { encounter, map, stands, groups, units };
    return buildEncounterBuilder({
      encounter,
      encounters: encounters.some((other) => other.id === encounter.id) ? encounters : [encounter, ...encounters],
      scenes: game.scenes.map((other) => ({ id: other.id, name: other.name })).sort((a, b) => a.name.localeCompare(b.name)),
      map,
      groups: groups.map(({ group, unit }) => ({ group, unit, placed: map ? (stands.get(group.id)?.length ?? 0) : group.count, loose: !!map && !group.tile })),
      pool,
      npcs: npcPool().map((actor) => ({ id: actor.id, name: actor.name, className: actor.system.className ?? "", level: actor.system.level ?? 1 })),
      blows,
      selected: this.#selected,
      tab: this.#tab,
      way: this.#way,
      partyOpen: this.#partyOpen ?? !going.length,
      placing: this.#placing,
      onMap: placedTokens(encounter, scene).length,
      say: this.#say
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
    const canvas = this.element.querySelector("canvas.eb-canvas");
    if ( !canvas ) return;
    canvas.addEventListener("click", (event) => this.#onMapClick(event, canvas));
    this.#draw(canvas);
  }

  /* -------------------------------------------- */

  /**
   * The picture of a scene, once it has loaded; the map is drawn again when it has.
   * @param {string} address
   * @returns {HTMLImageElement|null}     Null until then, and for a scene without a picture or with a film
   */
  #picture(address) {
    if ( !address || /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(address) ) return null;
    if ( this.#pictures.has(address) ) return this.#pictures.get(address);
    this.#pictures.set(address, null);
    const image = new Image();
    image.onload = () => {
      this.#pictures.set(address, image);
      const canvas = this.element?.querySelector("canvas.eb-canvas");
      if ( canvas ) this.#draw(canvas);
    };
    image.src = address;
    return null;
  }

  /* -------------------------------------------- */

  /**
   * Draw the map of the encounter on show.
   * @param {HTMLCanvasElement} canvas
   */
  #draw(canvas) {
    const { encounter, map, stands, groups } = this.#shown ?? {};
    if ( !map ) return;
    const frame = canvas.parentElement;
    drawEncounterMap(canvas, {
      columns: map.columns,
      rows: map.rows,
      terrainAt: map.terrainAt,
      elevationAt: map.elevationAt,
      zoneAt: map.zoneAt,
      image: this.#picture(map.picture),
      others: map.tokens.filter((token) => token.encounter !== encounter.id),
      groups: groups.filter((entry) => entry.unit).map(({ group, unit }) => ({
        id: group.id, army: unit.side, boss: unit.boss, recruit: unit.recruit, turn: group.turn, tiles: stands.get(group.id) ?? []
      })),
      selected: this.#selected,
      goal: encounter.goal
    }, {
      tints: FEO.terrain.tints,
      zone: FEO.zones.deploy.tint,
      zones: Object.fromEntries(Object.entries(FEO.zones).map(([key, zone]) => [key, zone.tint])),
      width: Math.max((frame?.clientWidth ?? 572) - 12, 240),
      height: 470
    });
  }

  /* -------------------------------------------- */
  /*  Choosing                                    */
  /* -------------------------------------------- */

  /**
   * Something was set in one of the fields: the name, the encounter on show, its scene, its Affinity or its
   * weather, or a unit to add to it.
   * @param {Event} event
   */
  #onChange(event) {
    const { name, value } = event.target ?? {};
    switch ( name ) {
      case "name": {
        // The name is written where it shows. The window is not drawn again for it, so that a click on a button
        // straight from the field still lands on that button
        const name = String(value).trim();
        const option = this.element.querySelector('select[name="encounter"] option:checked');
        if ( option ) option.textContent = name || game.i18n.localize("FEO.Encounter.unnamed");
        this.#quiet = true;
        return this.#keep({ name });
      }
      case "encounter":
        this.#id = value;
        this.#selected = "";
        this.#tab = "read";
        this.#partyOpen = null;
        this.#say = "";
        return this.render();
      case "scene": return this.#keep({ scene: value, goal: null, groups: this.#encounter().groups.map((group) => ({ ...group, tile: null })) });
      case "affinity": return this.#keep({ affinity: value });
      case "weather": return this.#keep({ weather: value });
      case "addUnit": return value ? this.#addUnit(value) : undefined;
    }
  }

  /* -------------------------------------------- */

  /**
   * The map was clicked: the group in hand goes to stand round that tile, or the space the Objectives are about
   * is marked there.
   * @param {PointerEvent} event
   * @param {HTMLCanvasElement} canvas
   */
  #onMapClick(event, canvas) {
    const { map, units } = this.#shown ?? {};
    const tile = map ? tileAt(canvas, event, map) : null;
    if ( !tile ) return;
    if ( this.#placing === "goal" ) {
      this.#placing = "group";
      return this.#keep({ goal: tile });
    }
    if ( !this.#selected ) {
      this.#say = game.i18n.localize("FEO.Encounter.map.hint");
      return this.render();
    }
    if ( tileBlocked(map, tile, units.get(this.#selected) ?? null) ) {
      this.#say = game.i18n.localize("FEO.Encounter.map.blocked");
      return this.render();
    }
    return this.#keepGroup(this.#selected, { tile });
  }

  /* -------------------------------------------- */

  /**
   * @this {EncounterBuilder}
   */
  static async #onNewEncounter() {
    const id = foundry.utils.randomID();
    this.#id = id;
    this.#selected = "";
    this.#tab = "read";
    this.#partyOpen = null;
    this.#say = "";
    await writeEncounter({ ...newEncounter(id, game.i18n.localize("FEO.Encounter.fresh")), scene: canvas?.scene?.id ?? "" });
  }

  /* -------------------------------------------- */

  /**
   * Forget the encounter on show, once the Game Master has said that it should be.
   * @this {EncounterBuilder}
   */
  static async #onDeleteEncounter() {
    const encounter = this.#encounter();
    const sure = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FEO.Encounter.delete") },
      content: `<p>${game.i18n.format("FEO.Encounter.deleteAsk", { name: foundry.utils.escapeHTML?.(encounter.name) ?? encounter.name })}</p>`,
      rejectClose: false
    });
    if ( !sure ) return;
    this.#id = "";
    this.#selected = "";
    this.#say = "";
    await removeEncounter(encounter.id);
    this.render();
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onGenerate() {
    MapGenerator.open();
  }

  /* -------------------------------------------- */
  /*  Objectives                                  */
  /* -------------------------------------------- */

  /**
   * @this {EncounterBuilder}
   */
  static #onObjective(event, target) {
    const key = target.dataset.objective;
    const encounter = this.#encounter();
    if ( !(key in encounter.objectives) ) return;
    return this.#keep({ objectives: { ...encounter.objectives, [key]: !encounter.objectives[key] } });
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onSurvive(event, target) {
    return this.#keep({ survive: Math.max(this.#encounter().survive + (Number(target.dataset.by) || 0), 1) });
  }

  /**
   * The Objectives' space is to be marked on the map, or not after all.
   * @this {EncounterBuilder}
   */
  static #onMarkGoal() {
    this.#placing = (this.#placing === "goal") ? "group" : "goal";
    this.#say = "";
    return this.render();
  }

  /**
   * The unit in hand is the one a Protect Objective is about, or no longer is.
   * @this {EncounterBuilder}
   */
  static #onProtect(event, target) {
    const id = target.dataset.group;
    return this.#keep({ protect: (this.#encounter().protect === id) ? "" : id });
  }

  /* -------------------------------------------- */
  /*  Forces                                      */
  /* -------------------------------------------- */

  /**
   * A group was taken in hand.
   * @this {EncounterBuilder}
   */
  static #onSelect(event, target) {
    this.#selected = target.dataset.group ?? "";
    this.#tab = "unit";
    this.#placing = "group";
    this.#say = "";
    return this.render();
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onCount(event, target) {
    const id = target.dataset.group;
    const group = this.#encounter().groups.find((other) => other.id === id);
    if ( !group ) return;
    return this.#keepGroup(id, { count: Math.min(Math.max(group.count + (Number(target.dataset.by) || 0), 1), FEO.encounter.count) });
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onRemove(event, target) {
    const id = target.dataset.group;
    if ( this.#selected === id ) {
      this.#selected = "";
      this.#tab = "read";
    }
    return this.#keepGroup(id, null);
  }

  /**
   * The same unit once more, as a group of its own: to stand somewhere else, or to arrive later.
   * @this {EncounterBuilder}
   */
  static #onDuplicate(event, target) {
    const encounter = this.#encounter();
    const group = encounter.groups.find((other) => other.id === target.dataset.group);
    if ( !group ) return;
    const id = foundry.utils.randomID(8);
    this.#selected = id;
    return this.#keep({ groups: [...encounter.groups, { ...group, id, count: 1, tile: null }] });
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onArrive(event, target) {
    const group = this.#encounter().groups.find((other) => other.id === this.#selected);
    if ( !group ) return;
    return this.#keepGroup(group.id, { turn: (target.dataset.when === "later") ? (group.turn || 2) : 0 });
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onTurn(event, target) {
    const group = this.#encounter().groups.find((other) => other.id === this.#selected);
    if ( !group ) return;
    return this.#keepGroup(group.id, { turn: Math.max(group.turn + (Number(target.dataset.by) || 0), 2) });
  }

  /* -------------------------------------------- */

  /** The Level of the party that goes with the encounter on show, or null while nobody does. */
  #partyLevel() {
    const going = new Set(this.#encounter().party);
    const levels = partyPool().filter(({ actor }) => going.has(actor.id)).map(({ actor }) => actor.system.level ?? 1);
    return levels.length ? partyLevel(levels) : null;
  }

  /**
   * Open the NPC Builder on a new unit for the encounter on show, which joins it once it is saved.
   * @this {EncounterBuilder}
   */
  static #onNewNpc() {
    const level = this.#partyLevel();
    return NpcBuilder.open({
      spec: { side: "enemy", level: level ?? 1 },
      encounter: this.#encounter().name,
      partyLevel: level,
      done: (actor) => this.#addUnit(actor.id)
    });
  }

  /**
   * Change the unit of a group: in the NPC Builder if it was made there, else on its own sheet.
   * @this {EncounterBuilder}
   */
  static #onEdit(event, target) {
    const group = this.#encounter().groups.find((other) => other.id === target.dataset.group);
    const actor = group ? game.actors.get(group.actor) : null;
    if ( !actor ) return;
    if ( !specOf(actor) ) return actor.sheet?.render({ force: true });
    return NpcBuilder.open({ actor, encounter: this.#encounter().name, partyLevel: this.#partyLevel() });
  }

  /* -------------------------------------------- */

  /**
   * The groups that stand nowhere yet are each put somewhere open, clear of the players' tiles.
   * @this {EncounterBuilder}
   */
  static #onScatter() {
    const { map, units } = this.#shown ?? {};
    if ( !map ) return;
    const encounter = this.#encounter();
    const found = scatterTiles(encounter.groups, {
      columns: map.columns,
      rows: map.rows,
      blocked: (tile, group) => tileBlocked(map, tile, units.get(group.id) ?? null),
      keep: (tile) => !!map.zoneAt(tile.i, tile.j)
    });
    if ( !found.size ) {
      this.#say = game.i18n.localize("FEO.Encounter.map.allPlaced");
      return this.render();
    }
    return this.#keep({ groups: encounter.groups.map((group) => (found.has(group.id) ? { ...group, tile: found.get(group.id) } : group)) });
  }

  /* -------------------------------------------- */
  /*  The Party                                   */
  /* -------------------------------------------- */

  /**
   * @this {EncounterBuilder}
   */
  static #onPartyOpen(event, target) {
    this.#partyOpen = target.getAttribute("aria-expanded") !== "true";
    this.#tab = "read";
    return this.render();
  }

  /**
   * A unit goes, or stays behind.
   * @this {EncounterBuilder}
   */
  static #onGoing(event, target) {
    const id = target.dataset.actor;
    const party = this.#encounter().party;
    this.#partyOpen = true;
    return this.#keep({ party: party.includes(id) ? party.filter((other) => other !== id) : [...party, id] });
  }

  /**
   * The party is the units of the players who are here now.
   * @this {EncounterBuilder}
   */
  static #onPartyOnline() {
    this.#partyOpen = true;
    return this.#keep({ party: partyPool().filter(({ user }) => user?.active).map(({ actor }) => actor.id) });
  }

  /**
   * The party is the player units that stand on the encounter's map already.
   * @this {EncounterBuilder}
   */
  static #onPartyOnMap() {
    const scene = game.scenes.get(this.#encounter().scene);
    const there = new Set((scene?.tokens ?? []).map((token) => token.actorId));
    this.#partyOpen = true;
    return this.#keep({ party: partyPool().filter(({ actor }) => there.has(actor.id)).map(({ actor }) => actor.id) });
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onPartyClear() {
    this.#partyOpen = true;
    return this.#keep({ party: [] });
  }

  /* -------------------------------------------- */

  /**
   * @this {EncounterBuilder}
   */
  static #onShow(event, target) {
    this.#tab = (target.dataset.show === "unit") ? "unit" : "read";
    return this.render();
  }

  /**
   * @this {EncounterBuilder}
   */
  static #onWay(event, target) {
    this.#way = (target.dataset.way === "out") ? "out" : "in";
    return this.render();
  }

  /* -------------------------------------------- */
  /*  Onto the Map                                */
  /* -------------------------------------------- */

  /**
   * Ask before something that cannot be taken back with a click.
   * @param {string} title      The key of what is asked about
   * @param {string} text       The question, as HTML
   * @returns {Promise<boolean>}
   */
  async #ask(title, text) {
    return !!(await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(title) },
      content: `<p>${text}</p>`,
      rejectClose: false
    }));
  }

  /* -------------------------------------------- */

  /**
   * Put the encounter on its map. What it put there before is taken off first, once the Game Master has said so.
   * @this {EncounterBuilder}
   */
  static async #onPlace() {
    if ( this.#busy ) return;
    const encounter = this.#encounter();
    const scene = game.scenes.get(encounter.scene) ?? null;
    const there = placedTokens(encounter, scene).length;
    if ( there && !(await this.#ask("FEO.Encounter.foot.placeAgain", game.i18n.format("FEO.Encounter.foot.placeAsk", { count: there }))) ) return;
    this.#busy = true;
    try {
      const done = await placeEncounter(encounter);
      this.#say = done
        ? game.i18n.format(done.later ? "FEO.Encounter.foot.placedLater" : "FEO.Encounter.foot.placed", { count: done.placed, later: done.later })
        : game.i18n.localize("FEO.Encounter.check.noGrid");
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    } finally {
      this.#busy = false;
    }
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Begin the battle of the encounter, once the Game Master has said that it should.
   * @this {EncounterBuilder}
   */
  static async #onBegin() {
    if ( this.#busy ) return;
    const encounter = this.#encounter();
    const name = foundry.utils.escapeHTML?.(encounter.name) ?? encounter.name;
    if ( !(await this.#ask("FEO.Encounter.foot.begin", game.i18n.format("FEO.Encounter.foot.beginAsk", { name }))) ) return;
    this.#busy = true;
    try {
      const combat = await beginEncounter(encounter);
      if ( combat ) await this.close();
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    } finally {
      this.#busy = false;
    }
  }
}

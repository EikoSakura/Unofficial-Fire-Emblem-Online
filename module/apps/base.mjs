import { FEO } from "../config.mjs";
import { company, mayAct, playsAt, readBase, registerBase, request } from "../helpers/base.mjs";
import { earnsExp } from "../helpers/experience.mjs";
import { iconHtml } from "../helpers/icons.mjs";
import { forgeSteps, isMarching } from "../rules/base.mjs";
import {
  buildBoard, buildCamp, buildConvoy, buildForge, buildMarket, buildMasthead, buildPlaque, buildRail, buildRoster,
  buildSupports, buildTraining, keeperOf, wareOf
} from "./base-context.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TEMPLATES = `systems/${FEO.id}/templates/base`;

/** The posts of the Base, each of which is a part of the window. */
const POSTS = Object.keys(FEO.base.posts);

/**
 * The Base: where the company rests between battles. One window with a post for each thing to do there: the
 * camp, the roster of who marches, the convoy, the market, the forge, supports, the training grounds and the
 * notice board.
 *
 * What is shown is worked out by `base-context.mjs`, which knows nothing of Foundry, and whatever changes
 * anything is asked of `helpers/base.mjs`, which has a Game Master's client do it. This class reads the world,
 * keeps what the reader has chosen, and answers to the mouse and the keyboard.
 */
export default class Base extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-base",
    classes: ["feo", "feo-base"],
    window: {
      title: "FEO.Base.title",
      icon: "fa-solid fa-campground",
      resizable: true
    },
    position: { width: 1120, height: 880 },
    actions: {
      view: Base.#onView,
      visitor: Base.#onVisitor,
      ready: Base.#onReady,
      worldMap: Base.#onWorldMap,
      sound: Base.#onSound,
      configure: Base.#onConfigure,
      post: Base.#onPost,
      gold: Base.#onGold,
      muster: Base.#onMuster,
      flip: Base.#onFlip,
      march: Base.#onMarch,
      stand: Base.#onMarch,
      limit: Base.#onLimit,
      hire: Base.#onHire,
      admit: Base.#onAdmit,
      dismiss: Base.#onDismiss,
      withdraw: Base.#onWithdraw,
      enlist: Base.#onEnlist,
      convoyKind: Base.#onConvoyKind,
      store: Base.#onStore,
      take: Base.#onTake,
      discard: Base.#onDiscard,
      stalls: Base.#onStalls,
      stall: Base.#onStall,
      stallEdit: Base.#onStallEdit,
      stallAdd: Base.#onStallAdd,
      stockFill: Base.#onStockFill,
      stockEdit: Base.#onStockEdit,
      mode: Base.#onMode,
      wareKind: Base.#onWareKind,
      wareFlag: Base.#onWareFlag,
      sort: Base.#onSort,
      ware: Base.#onWare,
      quantity: Base.#onQuantity,
      buy: Base.#onBuy,
      sell: Base.#onSell,
      bench: Base.#onBench,
      temper: Base.#onTemper,
      strike: Base.#onStrike,
      talk: Base.#onTalk,
      befriend: Base.#onBefriend,
      rank: Base.#onRank,
      top: Base.#onTop,
      foe: Base.#onFoe,
      spar: Base.#onSpar,
      join: Base.#onJoin,
      noticeAdd: Base.#onNoticeAdd,
      noticeRemove: Base.#onNoticeRemove
    }
  };

  /** @override */
  static PARTS = {
    masthead: { template: `${TEMPLATES}/masthead.hbs` },
    rail: { template: `${TEMPLATES}/rail.hbs` },
    scene: { template: `${TEMPLATES}/scene.hbs` },
    plaque: { template: `${TEMPLATES}/plaque.hbs` },
    camp: { template: `${TEMPLATES}/camp.hbs`, scrollable: [""] },
    roster: { template: `${TEMPLATES}/roster.hbs`, scrollable: [".bs-deck"] },
    convoy: { template: `${TEMPLATES}/convoy.hbs`, scrollable: [".bs-held", ".bs-pack"] },
    market: { template: `${TEMPLATES}/market.hbs`, scrollable: [".bs-lbody"] },
    forge: { template: `${TEMPLATES}/forge.hbs`, scrollable: [""] },
    supports: { template: `${TEMPLATES}/supports.hbs`, scrollable: [""] },
    training: { template: `${TEMPLATES}/training.hbs`, scrollable: [""] },
    board: { template: `${TEMPLATES}/board.hbs`, scrollable: [""] },
    talk: { template: `${TEMPLATES}/talk.hbs` }
  };

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /** The one window. */
  static #instance = null;

  /** What the stalls sell, read from the compendiums once and kept until one of them changes. */
  static #wares = new Map();

  /**
   * Make the Base part of the game: the setting that holds it, a way to open it from the Fire Emblem controls
   * and from a macro, and a fresh drawing whenever something it shows changes.
   */
  static register() {
    registerBase(() => Base.refresh());
    game.feo.base = { open: Base.open, toggle: Base.toggle, app: Base, request, read: readBase };

    // A button of the Fire Emblem controls, after the Compendium's, opens the window, and closes it again
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools ) return;
      tools.feoBase = {
        name: "feoBase",
        title: "FEO.Base.open",
        icon: "fa-solid fa-campground",
        order: 2,
        button: true,
        onChange: () => Base.toggle()
      };
    });

    // The window follows the units it shows, and who is at the table
    const follow = foundry.utils.debounce(() => Base.refresh(), 120);
    for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "updateUser", "userConnected"] ) Hooks.on(hook, follow);
    Hooks.on("updateCompendium", () => {
      Base.#wares.clear();
      follow();
    });
  }

  /* -------------------------------------------- */

  /**
   * Open the Base, or bring it forward, at one of its posts.
   * @param {object} [options]
   * @param {string} [options.view]     A key of FEO.base.posts
   * @returns {Promise<Base>}
   */
  static async open(options = {}) {
    const app = Base.#instance ??= new Base();
    if ( POSTS.includes(options.view) ) app.#state.view = options.view;

    // Whoever is selected on the map is who visits
    const selected = canvas?.tokens?.controlled?.[0]?.actor?.id;
    if ( selected ) app.#state.visitor = selected;
    await app.render({ force: true });
    app.bringToFront();
    return app;
  }

  /* -------------------------------------------- */

  /**
   * Open the Base, or close it if it is open.
   * @returns {Promise<Base>}
   */
  static async toggle() {
    const app = Base.#instance;
    if ( app?.rendered ) return app.close();
    return Base.open();
  }

  /* -------------------------------------------- */

  /**
   * Draw the window again, if it is open.
   */
  static refresh() {
    const app = Base.#instance;
    if ( app?.rendered ) app.render();
  }

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** What the reader has chosen. */
  #state = {
    view: "camp",
    visitor: null,
    muster: "all",
    flipped: new Set(),
    convoy: "all",
    market: {
      shop: null, mode: "buy", kind: "all", query: "", fit: false, afford: false,
      sort: null, dir: 1, turned: false, ware: null, quantity: 1, dest: "pack"
    },
    forge: { item: null, steps: null, name: null },
    training: { foe: null, healer: "" }
  };

  /** The world as the window was last drawn from it. */
  #world = null;

  /** The letters still to be typed into the text box. */
  #typing = null;

  /** Where the caret stood in the search box, so that drawing the ledger again does not move it. */
  #caret = null;

  /* -------------------------------------------- */

  /**
   * The unit the reader is visiting as.
   * @type {Actor|null}
   */
  get visitor() {
    return game.actors.get(this.#state.visitor ?? "") ?? null;
  }

  /* -------------------------------------------- */
  /*  Reading the World                           */
  /* -------------------------------------------- */

  /**
   * Tell the window about a unit.
   * @param {Actor} actor
   * @param {import("../rules/base.mjs").BaseState} base
   * @param {object} [options]
   * @param {boolean} [options.character]   Is it a player's character?
   * @param {User|null} [options.player]    The player whose character it is
   * @param {User|null} [options.owner]     The player it belongs to, which an ally has none of
   * @returns {import("./base-context.mjs").BaseUnit}
   */
  static #unit(actor, base, { character = false, player = null, owner = null } = {}) {
    const system = actor.system;
    const weapon = system.equippedWeapon;
    const icon = (item) => FEO.categoryIcons[item.system.category] ?? "sword";
    const carried = actor.items.filter((item) => ["weapon", "gear"].includes(item.type)).sort((a, b) => a.sort - b.sort);
    return {
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      img: actor.img,
      level: system.level,
      cls: system.className,
      hp: { value: system.hp.value, max: system.hp.max },
      gold: system.gold,

      // What its skills and what it wears take off a price in a shop, in percent, and where that comes from
      discount: system.knacks?.discount ?? 0,
      discounts: (system.knacks?.discounts ?? []).map((entry) => ({ name: entry.name, percent: entry.percent })),

      // And what they add to what it sells for
      resale: system.knacks?.resale ?? 0,
      resales: (system.knacks?.resales ?? []).map((entry) => ({ name: entry.name, percent: entry.percent })),
      icon: weapon ? icon(weapon) : "shield",
      weapon: weapon ? { name: weapon.name, icon: icon(weapon) } : null,
      stats: system.statValues,
      wounds: system.wounds,
      injuries: system.injuries,
      fallen: system.defeat?.state === "dead",
      character,
      player: player ? { id: player.id, name: player.name, online: player.active } : null,
      owner: owner ? { id: owner.id, name: owner.name, online: owner.active } : null,
      marching: isMarching(base, actor.id, character),
      lead: base.muster[actor.id]?.lead ?? null,
      mine: mayAct(base, actor, game.user),
      earns: earnsExp(actor),
      ranks: system.proficiencies,
      above: system.skills?.wield ?? 0,
      wlv: system.weaponLevel?.used ? system.weaponLevel.base : null,
      affinity: system.affinity,
      items: carried.map((item) => wareOf(item, item.id)),
      bonds: system.bonds.map((bond) => ({
        name: bond.name, uuid: bond.uuid, rank: bond.rank, points: bond.points, kin: bond.kin,
        affinity: bond.affinity, bonus: bond.bonus
      }))
    };
  }

  /* -------------------------------------------- */

  /**
   * Read what the stalls sell from wherever each ware is kept. Wares of one compendium are read together.
   * @param {string[]} uuids
   * @returns {Promise<Map<string, import("./base-context.mjs").Ware|null>>}
   */
  static async #stock(uuids) {
    const wares = Base.#wares;
    const read = (doc, uuid) => wares.set(uuid, ["weapon", "gear"].includes(doc?.type) ? wareOf(doc, uuid) : null);
    const byPack = new Map();
    for ( const uuid of new Set(uuids) ) {
      if ( wares.has(uuid) ) continue;
      const parsed = foundry.utils.parseUuid(uuid);
      const pack = parsed?.collection;
      if ( pack?.metadata && (typeof pack.getDocuments === "function") && parsed.id ) {
        if ( !byPack.has(pack) ) byPack.set(pack, new Map());
        byPack.get(pack).set(parsed.id, uuid);
      }
      else read(await foundry.utils.fromUuid(uuid).catch(() => null), uuid);
    }
    for ( const [pack, ids] of byPack ) {
      const docs = await pack.getDocuments({ _id__in: Array.from(ids.keys()) }).catch(() => []);
      for ( const doc of docs ) read(doc, ids.get(doc.id));
      for ( const uuid of ids.values() ) if ( !wares.has(uuid) ) wares.set(uuid, null);
    }
    return wares;
  }

  /* -------------------------------------------- */

  /**
   * Read the world: the Base, the company, who is at the table and who is visiting.
   * @returns {Promise<import("./base-context.mjs").BaseWorld>}
   */
  async #gather() {
    const base = readBase();
    const state = this.#state;

    // Who is at the table: the players, and a Game Master whose own character marches
    const players = game.users.filter((user) => playsAt(base, user))
      .map((user) => ({ id: user.id, name: user.name, online: user.active, gm: user.isGM }));
    const units = company(base).map(({ actor, user, owner, character }) => Base.#unit(actor, base, { character, player: user, owner }));
    const offers = base.offers.map((offer) => {
      const actor = game.actors.get(offer.actor);
      return actor?.type === "unit" ? { ...offer, unit: Base.#unit(actor, base) } : null;
    }).filter(Boolean);

    // Whoever the reader chose visits; failing that their own character, or the first unit they may act for
    const visitors = units.filter((unit) => unit.mine);
    const visitor = visitors.find((unit) => unit.id === state.visitor) ?? visitors.find((unit) => unit.player?.id === game.user.id)
      ?? visitors[0] ?? null;
    state.visitor = visitor?.id ?? null;

    const stock = await Base.#stock(base.shops.flatMap((shop) => shop.stock.map((ware) => ware.uuid)));
    return { base, user: { id: game.user.id, isGM: game.user.isGM }, players, company: units, offers, visitor, visitors, stock };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _configureRenderOptions(options) {
    const asked = !!options.parts;
    super._configureRenderOptions(options);

    // Once the window is up, only what can have changed is drawn again: the scene stays as it is, so that it
    // can grow and shrink, and the text box keeps what was said
    if ( !options.isFirstRender && !asked ) options.parts = ["masthead", "rail", "plaque", this.#state.view];
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    this.#world = await this.#gather();
    const state = this.#state;
    // A post that has been shut sends whoever stood at it back to the camp
    if ( this.#world.base.closed[state.view] && !game.user.isGM ) {
      state.view = "camp";
      if ( !options.parts.includes("camp") ) options.parts.push("camp");
    }
    return {};
  }

  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = { ...(await super._preparePartContext(partId, context, options)) };
    const world = this.#world;
    const state = this.#state;
    const i18n = game.i18n;

    switch ( partId ) {
      case "masthead": Object.assign(context, buildMasthead(world, i18n)); break;
      case "rail": Object.assign(context, buildRail(world, state, i18n)); break;
      case "plaque": Object.assign(context, buildPlaque(world, state, i18n)); break;
      case "camp": Object.assign(context, buildCamp(world, i18n)); break;
      case "roster": Object.assign(context, buildRoster(world, state, i18n)); break;
      case "convoy": Object.assign(context, buildConvoy(world, state, i18n)); break;
      case "market": {
        const market = buildMarket(world, state.market, i18n);
        state.market.shop = market.shop?.id ?? null;
        state.market.ware = market.ware?.id ?? null;
        Object.assign(context, market);
        break;
      }
      case "forge": {
        const forge = buildForge(world, state.forge, i18n);
        if ( forge.ware && (forge.ware.id !== state.forge.item) ) Object.assign(state.forge, { item: forge.ware.id, steps: null, name: null });
        Object.assign(context, forge);
        break;
      }
      case "supports": Object.assign(context, buildSupports(world, i18n)); break;
      case "training": Object.assign(context, buildTraining(world, state.training, i18n)); break;
      case "board": Object.assign(context, buildBoard(world, i18n)); break;
    }
    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const root = this.element;

    // Searching the ledger draws it again under the box
    root.addEventListener("input", (event) => {
      const box = event.target.closest?.("[data-search]");
      if ( box ) {
        this.#state.market.query = box.value;
        this.#caret = box.selectionStart;
        this.#redraw([this.#state.view]);
        return;
      }
      // A new name is enough to strike the anvil for, without anything being drawn again under the typing
      const name = event.target.closest?.("[data-forge-name]");
      if ( name ) {
        this.#state.forge.name = name.value;
        const strike = root.querySelector('[data-action="strike"]');
        const renamed = !!name.value.trim() && (name.value.trim() !== name.dataset.was);
        if ( strike && (strike.dataset.short !== "true") ) strike.disabled = !renamed && (strike.dataset.stepped !== "true");
      }
    });

    // Choices made from a list
    root.addEventListener("change", (event) => {
      const field = event.target.closest?.("[data-change]");
      if ( !field ) return;
      switch ( field.dataset.change ) {
        case "lead": request("lead", { actor: field.dataset.actor, lead: field.value }); break;
        case "dest": this.#state.market.dest = field.value; break;
        case "healer": this.#state.training.healer = field.value; break;
      }
    });

    // Enter and Space work a card and a row of the ledger as a click does
    root.addEventListener("keydown", (event) => {
      if ( (event.key !== "Enter") && (event.key !== " ") ) return;
      const target = event.target;
      if ( !target.matches?.(".bs-flip[data-action], .bs-row[data-action], .bs-item[data-action]") ) return;
      event.preventDefault();
      target.click();
    });

    // A Game Master drags units onto the roster, and wares onto a stall or into the convoy
    root.addEventListener("dragover", (event) => event.preventDefault());
    root.addEventListener("drop", (event) => this.#onDrop(event));

    this.#say(keeperOf(this.#world, this.#state, game.i18n));
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#stamp();

    // The search box keeps its caret
    const box = this.element.querySelector("[data-search]");
    if ( box && (document.activeElement === box) && (this.#caret !== null) ) box.setSelectionRange(this.#caret, this.#caret);
    this.#caret = null;
  }

  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    clearInterval(this.#typing);
    this.#typing = null;
  }

  /* -------------------------------------------- */

  /**
   * Draw some parts again. Typing asks for this on every key, so the calls are gathered.
   * @param {string[]} parts
   */
  #redraw = foundry.utils.debounce((parts) => this.render({ parts }), 140);

  /* -------------------------------------------- */

  /**
   * Mark the window with the post in view, which the styles read.
   */
  #stamp() {
    const root = this.element;
    if ( !root ) return;
    root.dataset.view = this.#state.view;
    root.dataset.role = game.user.isGM ? "gm" : "player";
  }

  /* -------------------------------------------- */

  /**
   * Have a keeper speak in the text box, a few letters at a time.
   * @param {{name: string, icon: string, line: string}} words
   */
  #say({ name, icon, line }) {
    const box = this.element?.querySelector(".bs-talk");
    if ( !box ) return;
    box.querySelector(".bs-name").textContent = name;
    box.querySelector(".bs-face").innerHTML = iconHtml(icon);
    const text = box.querySelector("p");
    clearInterval(this.#typing);
    if ( window.matchMedia("(prefers-reduced-motion: reduce)").matches ) {
      text.textContent = line;
      return;
    }
    let at = 0;
    text.textContent = "";
    this.#typing = setInterval(() => {
      at += 2;
      text.textContent = line.slice(0, at);
      if ( at >= line.length ) clearInterval(this.#typing);
    }, 16);
  }

  /* -------------------------------------------- */

  /**
   * Say something in the keeper's voice of the post in view.
   * @param {string} key        A key under FEO.Base
   * @param {object} [data]
   */
  #remark(key, data = {}) {
    const keeper = keeperOf(this.#world, this.#state, game.i18n);
    this.#say({ ...keeper, line: game.i18n.format(`FEO.Base.${key}`, data) });
  }

  /* -------------------------------------------- */

  /**
   * Go to a post.
   * @param {string} view
   */
  async #go(view) {
    if ( !POSTS.includes(view) ) return;
    const world = this.#world;
    if ( world.base.closed[view] && !game.user.isGM ) {
      this.#say(keeperOf(world, this.#state, game.i18n, view));
      return;
    }
    if ( view === this.#state.view ) return;
    this.#state.view = view;
    await this.render({ parts: ["rail", "plaque", view] });
    this.#say(keeperOf(this.#world, this.#state, game.i18n));
  }

  /* -------------------------------------------- */

  /**
   * Ask for words in a small dialog.
   * @param {string} title        A translation key
   * @param {string} content      The fields of its form
   * @param {string} [label]      A translation key for its button
   * @returns {Promise<object|null>}    What was typed, or null if the dialog was put away
   */
  static async #ask(title, content, label = "FEO.Base.confirm") {
    const answer = await DialogV2.input({
      window: { title },
      classes: ["feo", "feo-base-dialog"],
      content,
      ok: { label, icon: "fa-solid fa-check" },
      rejectClose: false
    });
    return answer && (typeof answer === "object") ? answer : null;
  }

  /**
   * One field of such a dialog.
   * @param {string} name
   * @param {string} label      A key under FEO.Base
   * @param {object} [options]
   * @returns {string}
   */
  static #field(name, label, { value = "", type = "text", hint = null, options = null, checked = false, min = null } = {}) {
    const esc = foundry.utils.escapeHTML ?? ((text) => String(text));
    const text = game.i18n.localize(`FEO.Base.${label}`);
    let input;
    if ( options ) {
      input = `<select name="${name}">${options.map((option) => `<option value="${esc(option.value)}" ${option.value === value ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select>`;
    }
    else if ( type === "checkbox" ) input = `<input type="checkbox" name="${name}" ${checked ? "checked" : ""}>`;
    else if ( type === "textarea" ) input = `<textarea name="${name}" rows="4">${esc(value)}</textarea>`;
    else if ( type === "image" ) input = `<file-picker name="${name}" type="image" value="${esc(value)}"></file-picker>`;
    else input = `<input type="${type}" name="${name}" value="${esc(String(value ?? ""))}" ${min !== null ? `min="${min}"` : ""}>`;
    return `<div class="form-group"><label>${esc(text)}</label><div class="form-fields">${input}</div>${hint ? `<p class="hint">${esc(game.i18n.localize(`FEO.Base.${hint}`))}</p>` : ""}</div>`;
  }

  /* -------------------------------------------- */
  /*  Dropping                                    */
  /* -------------------------------------------- */

  /**
   * A Game Master drops a unit to recruit it or to stand it at the gate, and a weapon or an item to stock the
   * stall in view or to add it to the convoy.
   * @param {DragEvent} event
   */
  async #onDrop(event) {
    if ( !game.user.isGM ) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( !data?.uuid ) return;
    if ( data.type === "Actor" ) {
      const actor = await foundry.utils.fromUuid(data.uuid);
      if ( (actor?.type !== "unit") || actor.pack ) return ui.notifications.warn("FEO.Base.warn.worldUnit", { localize: true });
      return this.#enlist(actor);
    }
    if ( data.type !== "Item" ) return;
    const view = this.#state.view;
    if ( view === "market" ) await request("stock", { shop: this.#state.market.shop, uuid: data.uuid });
    else if ( view === "convoy" ) await request("stow", { uuid: data.uuid });
  }

  /* -------------------------------------------- */

  /**
   * Ask a Game Master how a unit joins: at once, or from the gate on terms.
   * @param {Actor} actor
   */
  async #enlist(actor) {
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.roster.enlistTitle", [
      `<p>${game.i18n.format("FEO.Base.roster.enlistLead", { name: foundry.utils.escapeHTML(actor.name) })}</p>`,
      field("where", "roster.enlistWhere", {
        value: "roster",
        options: [{ value: "roster", label: game.i18n.localize("FEO.Base.roster.enlistRoster") },
          { value: "gate", label: game.i18n.localize("FEO.Base.roster.enlistGate") }]
      }),
      field("cost", "roster.enlistCost", { type: "number", value: 0, min: 0, hint: "roster.enlistCostHint" }),
      field("check", "roster.enlistCheck", { hint: "roster.enlistCheckHint" }),
      field("terms", "roster.enlistTerms", { hint: "roster.enlistTermsHint" }),
      field("temp", "roster.enlistTemp", { type: "checkbox" })
    ].join(""));
    if ( !answer ) return;
    if ( answer.where === "gate" ) {
      await request("offer", { actor: actor.id, cost: Number(answer.cost) || 0, check: answer.check, terms: answer.terms, temp: !!answer.temp });
    }
    else await request("enlist", { actor: actor.id });
  }

  /* -------------------------------------------- */
  /*  The Frame                                   */
  /* -------------------------------------------- */

  /**
   * Go to a post.
   * @this {Base}
   */
  static async #onView(event, target) {
    await this.#go(target.dataset.view);
  }

  /* -------------------------------------------- */

  /**
   * Visit as the next unit the reader may act for.
   * @this {Base}
   */
  static async #onVisitor() {
    const visitors = this.#world.visitors;
    if ( visitors.length < 2 ) return;
    const at = visitors.findIndex((unit) => unit.id === this.#state.visitor);
    this.#state.visitor = visitors[(at + 1) % visitors.length].id;
    Object.assign(this.#state.forge, { item: null, steps: null, name: null });
    this.#state.market.ware = null;
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Look at the World Map, to see where the company goes next.
   * @this {Base}
   */
  static #onWorldMap() {
    game.feo.worldMap?.open();
  }

  /* -------------------------------------------- */

  /**
   * Say that the reader is ready to march, or not yet.
   * @this {Base}
   */
  static async #onReady() {
    const was = !!this.#world.base.ready[game.user.id];
    const { ok } = await request("ready");
    if ( ok ) this.#remark(was ? "march.notYet" : "march.readySaid");
  }

  /* -------------------------------------------- */

  /**
   * Sound the march: tell the table who goes, and start the count of bouts and of who is ready again.
   * @this {Base}
   */
  static async #onSound() {
    const sure = await DialogV2.confirm({
      window: { title: "FEO.Base.march.sound" },
      content: `<p>${game.i18n.localize("FEO.Base.march.soundPrompt")}</p>`,
      rejectClose: false
    });
    if ( !sure ) return;
    const { ok } = await request("sound");
    if ( ok ) this.#remark("march.soundSaid");
  }

  /* -------------------------------------------- */

  /**
   * Name the Base and the battle ahead, choose its backdrop, and set how many may march and spar.
   * @this {Base}
   */
  static async #onConfigure() {
    const base = this.#world.base;
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.configure.title", [
      field("name", "configure.name", { value: base.name, hint: "configure.nameHint" }),
      field("backdrop", "configure.backdrop", { type: "image", value: base.backdrop, hint: "configure.backdropHint" }),
      field("title", "configure.chapter", { value: base.chapter.title, hint: "configure.chapterHint" }),
      field("subtitle", "configure.subtitle", { value: base.chapter.subtitle }),
      field("limit", "configure.limit", { type: "number", value: base.limit, min: 1, hint: "configure.limitHint" }),
      field("bouts", "configure.bouts", { type: "number", value: base.bouts, min: 0, hint: "configure.boutsHint" })
    ].join(""));
    if ( !answer ) return;
    await request("configure", { ...answer, limit: Math.trunc(Number(answer.limit)), bouts: Math.trunc(Number(answer.bouts)) });
    await this.render({ parts: ["masthead", "rail", "plaque", this.#state.view] });
  }

  /* -------------------------------------------- */

  /**
   * Open or shut a post.
   * @this {Base}
   */
  static async #onPost(event, target) {
    await request("post", { post: target.dataset.post });
  }

  /* -------------------------------------------- */

  /**
   * Give gold to a unit of the company, or take it away.
   * @this {Base}
   */
  static async #onGold() {
    const units = this.#world.company;
    if ( !units.length ) return;
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.camp.grant", [
      field("actor", "camp.grantWho", { value: this.#state.visitor ?? units[0].id, options: units.map((unit) => ({ value: unit.id, label: unit.name })) }),
      field("amount", "camp.grantAmount", { type: "number", value: 500, hint: "camp.grantHint" })
    ].join(""));
    if ( answer ) await request("gold", { actor: answer.actor, amount: Number(answer.amount) || 0 });
  }

  /* -------------------------------------------- */
  /*  The Roster                                  */
  /* -------------------------------------------- */

  /**
   * Show one group of the roster, or all of them.
   * @this {Base}
   */
  static async #onMuster(event, target) {
    this.#state.muster = target.dataset.kind;
    await this.render({ parts: ["roster"] });
  }

  /* -------------------------------------------- */

  /**
   * Turn a card over.
   * @this {Base}
   */
  static #onFlip(event, target) {
    if ( event.target.closest("select, option, input") ) return;
    const id = target.dataset.unit;
    const flipped = this.#state.flipped;
    if ( flipped.has(id) ) flipped.delete(id);
    else flipped.add(id);
    target.classList.toggle("bs-flipped");
  }

  /* -------------------------------------------- */

  /**
   * Send a unit to march, or stand it down.
   * @this {Base}
   */
  static async #onMarch(event, target) {
    const action = target.dataset.action;
    const actor = game.actors.get(target.dataset.actor);
    const { ok } = await request(action, { actor: actor?.id });
    if ( !ok ) return;
    this.#remark(action === "stand" ? "roster.stoodSaid" : "roster.marchSaid", { name: actor.name });
  }

  /* -------------------------------------------- */

  /**
   * Let more units march, or fewer.
   * @this {Base}
   */
  static async #onLimit(event, target) {
    await request("limit", { delta: Number(target.dataset.delta) });
  }

  /* -------------------------------------------- */

  /**
   * Recruit a unit from the gate on its terms.
   * @this {Base}
   */
  static async #onHire(event, target) {
    const offer = this.#world.offers.find((entry) => entry.id === target.dataset.offer);
    if ( !offer ) return;
    const { ok } = await request("hire", { actor: this.#state.visitor, offer: offer.id });
    if ( ok ) this.#remark(offer.cost || game.user.isGM || !offer.check ? "roster.hiredSaid" : "roster.pleadSaid", { name: offer.unit.name });
  }

  /* -------------------------------------------- */

  /**
   * Let a unit at the gate join without paying.
   * @this {Base}
   */
  static async #onAdmit(event, target) {
    const offer = this.#world.offers.find((entry) => entry.id === target.dataset.offer);
    if ( !offer ) return;
    const { ok } = await request("enlist", { actor: offer.unit.id });
    if ( ok ) this.#remark("roster.hiredSaid", { name: offer.unit.name });
  }

  /* -------------------------------------------- */

  /**
   * Take a recruit off the roster.
   * @this {Base}
   */
  static async #onDismiss(event, target) {
    const actor = game.actors.get(target.dataset.actor);
    if ( !actor ) return;
    const sure = await DialogV2.confirm({
      window: { title: "FEO.Base.roster.dismiss" },
      content: `<p>${game.i18n.format("FEO.Base.roster.dismissPrompt", { name: foundry.utils.escapeHTML(actor.name) })}</p>`,
      rejectClose: false
    });
    if ( sure ) await request("dismiss", { actor: actor.id });
  }

  /* -------------------------------------------- */

  /**
   * Send a unit away from the gate.
   * @this {Base}
   */
  static async #onWithdraw(event, target) {
    await request("withdraw", { offer: target.dataset.offer });
  }

  /* -------------------------------------------- */

  /**
   * Choose a unit of the world to recruit or to stand at the gate.
   * @this {Base}
   */
  static async #onEnlist() {
    const taken = new Set([...this.#world.company.map((unit) => unit.id), ...this.#world.offers.map((offer) => offer.unit.id)]);
    const free = game.actors.filter((actor) => (actor.type === "unit") && !taken.has(actor.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if ( !free.length ) return ui.notifications.info("FEO.Base.roster.enlistNone", { localize: true });
    const answer = await Base.#ask("FEO.Base.roster.enlistTitle", Base.#field("actor", "roster.enlistWho", {
      value: free[0].id, options: free.map((actor) => ({ value: actor.id, label: actor.name })), hint: "roster.enlistWhoHint"
    }), "FEO.Base.next");
    const actor = game.actors.get(answer?.actor ?? "");
    if ( actor ) await this.#enlist(actor);
  }

  /* -------------------------------------------- */
  /*  The Convoy                                  */
  /* -------------------------------------------- */

  /**
   * Show one kind of ware in the convoy, or all of them.
   * @this {Base}
   */
  static async #onConvoyKind(event, target) {
    this.#state.convoy = target.dataset.kind;
    await this.render({ parts: ["convoy"] });
  }

  /* -------------------------------------------- */

  /**
   * Store something the visitor carries.
   * @this {Base}
   */
  static async #onStore(event, target) {
    const item = this.visitor?.items.get(target.dataset.item);
    if ( !item ) return;
    const { ok } = await request("store", { actor: this.#state.visitor, item: item.id });
    if ( ok ) this.#remark("convoy.storedSaid", { item: item.name });
  }

  /* -------------------------------------------- */

  /**
   * Take something from the convoy.
   * @this {Base}
   */
  static async #onTake(event, target) {
    const entry = this.#world.base.convoy.find((held) => held.id === target.dataset.entry);
    if ( !entry ) return;
    const { ok } = await request("take", { actor: this.#state.visitor, entry: entry.id });
    if ( ok ) this.#remark("convoy.takenSaid", { item: entry.data.name });
  }

  /* -------------------------------------------- */

  /**
   * Throw something out of the convoy.
   * @this {Base}
   */
  static async #onDiscard(event, target) {
    await request("discard", { entry: target.dataset.entry });
  }

  /* -------------------------------------------- */
  /*  The Market                                  */
  /* -------------------------------------------- */

  /**
   * Draw the market again.
   * @param {object} [changes]    Changes to what the reader has chosen there
   */
  async #market(changes = {}) {
    Object.assign(this.#state.market, changes);
    await this.render({ parts: ["market"] });
  }

  /* -------------------------------------------- */

  /**
   * Set out the stalls a new Base opens with.
   * @this {Base}
   */
  static async #onStalls() {
    await request("stalls");
  }

  /* -------------------------------------------- */

  /**
   * Walk over to a stall.
   * @this {Base}
   */
  static async #onStall(event, target) {
    await this.#market({ shop: target.dataset.shop, mode: "buy", kind: "all", query: "", sort: null, ware: null, quantity: 1 });
    this.#say(keeperOf(this.#world, this.#state, game.i18n));
  }

  /* -------------------------------------------- */

  /**
   * Rename a stall, name its keeper, shut it or take it down.
   * @this {Base}
   */
  static async #onStallEdit() {
    const shop = this.#world.base.shops.find((entry) => entry.id === this.#state.market.shop);
    if ( !shop ) return;
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.market.stallEdit", [
      field("name", "market.stallName", { value: shop.name }),
      field("keeper", "market.stallKeeper", { value: shop.keeper, hint: "market.stallKeeperHint" }),
      field("open", "market.stallOpen", { type: "checkbox", checked: shop.open }),
      field("clear", "market.stallClear", { type: "checkbox" }),
      field("remove", "market.stallRemove", { type: "checkbox" })
    ].join(""));
    if ( !answer ) return;
    if ( answer.clear && !answer.remove ) await request("stock", { shop: shop.id, clear: true });
    await request("stall", { shop: shop.id, name: answer.name, keeper: answer.keeper, open: !!answer.open, remove: !!answer.remove });
  }

  /* -------------------------------------------- */

  /**
   * Put up a new stall.
   * @this {Base}
   */
  static async #onStallAdd() {
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.market.stallAdd", [
      field("name", "market.stallName", { value: game.i18n.localize("FEO.Base.market.newStall") }),
      field("keeper", "market.stallKeeper", { hint: "market.stallKeeperHint" })
    ].join(""));
    if ( answer ) await request("stall", { name: answer.name, keeper: answer.keeper });
  }

  /* -------------------------------------------- */

  /**
   * Stock the stall in view from the compendiums.
   * @this {Base}
   */
  static async #onStockFill() {
    const field = Base.#field;
    const ranks = Object.keys(FEO.ranks).slice(1).map((rank) => ({ value: rank, label: game.i18n.localize(FEO.ranks[rank]) }));
    const answer = await Base.#ask("FEO.Base.market.fill", [
      `<p>${game.i18n.localize("FEO.Base.market.fillLead")}</p>`,
      field("arms", "market.fillArms", { type: "checkbox", checked: true }),
      field("staves", "market.fillStaves", { type: "checkbox" }),
      field("supplies", "market.fillSupplies", { type: "checkbox" }),
      field("rank", "market.fillRank", { value: "D", options: ranks, hint: "market.fillRankHint" })
    ].join(""));
    if ( !answer ) return;
    await request("stock", {
      shop: this.#state.market.shop,
      fill: { rank: answer.rank, arms: !!answer.arms, staves: !!answer.staves, supplies: !!answer.supplies }
    });
  }

  /* -------------------------------------------- */

  /**
   * Set the price of a ware and how many of it there are, or take it off the stall.
   * @this {Base}
   */
  static async #onStockEdit(event, target) {
    const shop = this.#world.base.shops.find((entry) => entry.id === this.#state.market.shop);
    const ware = shop?.stock.find((entry) => entry.id === target.dataset.ware);
    if ( !ware ) return;
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.market.stockEdit", [
      field("price", "market.stockPrice", { type: "number", value: ware.price ?? "", min: 0, hint: "market.stockPriceHint" }),
      field("left", "market.stockLeft", { type: "number", value: ware.left ?? "", min: 0, hint: "market.stockLeftHint" }),
      field("remove", "market.stockRemove", { type: "checkbox" })
    ].join(""));
    if ( !answer ) return;
    const whole = (value) => (value === "") || (value === null) || (value === undefined) ? null : Number(value);
    await request("stock", { shop: shop.id, ware: ware.id, price: whole(answer.price), left: whole(answer.left), remove: !!answer.remove });
  }

  /* -------------------------------------------- */

  /**
   * Buy or sell.
   * @this {Base}
   */
  static async #onMode(event, target) {
    await this.#market({ mode: target.dataset.mode, kind: "all", sort: null, ware: null, quantity: 1 });
  }

  /* -------------------------------------------- */

  /**
   * Show one kind of ware in the ledger, or all of them.
   * @this {Base}
   */
  static async #onWareKind(event, target) {
    await this.#market({ kind: target.dataset.kind });
  }

  /* -------------------------------------------- */

  /**
   * Show only what the visitor can wield, or can afford.
   * @this {Base}
   */
  static async #onWareFlag(event, target) {
    const flag = target.dataset.flag;
    await this.#market({ [flag]: !this.#state.market[flag] });
  }

  /* -------------------------------------------- */

  /**
   * Sort the ledger by a column: one way, then the other, then as it was.
   * @this {Base}
   */
  static async #onSort(event, target) {
    const market = this.#state.market;
    const key = target.dataset.sort;
    if ( market.sort !== key ) await this.#market({ sort: key, dir: ["name", "cost", "weight"].includes(key) ? 1 : -1, turned: false });
    else if ( !market.turned ) await this.#market({ dir: -market.dir, turned: true });
    else await this.#market({ sort: null });
  }

  /* -------------------------------------------- */

  /**
   * Choose a ware from the ledger.
   * @this {Base}
   */
  static async #onWare(event, target) {
    await this.#market({ ware: target.dataset.ware, quantity: 1 });
    this.element.querySelector(`.bs-row[data-ware="${CSS.escape(target.dataset.ware)}"]`)?.focus({ preventScroll: true });
  }

  /* -------------------------------------------- */

  /**
   * Buy more of the chosen ware, or fewer.
   * @this {Base}
   */
  static async #onQuantity(event, target) {
    await this.#market({ quantity: Math.max((this.#state.market.quantity ?? 1) + Number(target.dataset.delta), 1) });
  }

  /* -------------------------------------------- */

  /**
   * Buy the chosen ware.
   * @this {Base}
   */
  static async #onBuy(event, target) {
    const market = this.#state.market;
    const { ok } = await request("buy", {
      actor: this.#state.visitor, shop: market.shop, ware: market.ware, quantity: market.quantity, dest: market.dest
    });
    if ( !ok ) return;
    market.quantity = 1;
    this.#remark("market.boughtSaid", { item: target.dataset.name });
  }

  /* -------------------------------------------- */

  /**
   * Sell the chosen ware.
   * @this {Base}
   */
  static async #onSell(event, target) {
    const item = this.visitor?.items.get(this.#state.market.ware);
    if ( !item ) return;
    const { ok } = await request("sell", { actor: this.#state.visitor, item: item.id });
    if ( ok ) this.#remark("market.soldSaid", { item: item.name, gold: target.dataset.worth });
  }

  /* -------------------------------------------- */
  /*  The Forge                                   */
  /* -------------------------------------------- */

  /**
   * Lay a weapon on the bench.
   * @this {Base}
   */
  static async #onBench(event, target) {
    Object.assign(this.#state.forge, { item: target.dataset.item, steps: null, name: null });
    await this.render({ parts: ["forge"] });
  }

  /* -------------------------------------------- */

  /**
   * Raise or lower one of the stats of the weapon on the bench by an increment.
   * @this {Base}
   */
  static async #onTemper(event, target) {
    const forge = this.#state.forge;
    const item = this.visitor?.items.get(forge.item);
    if ( !item ) return;
    const steps = forgeSteps(forge.steps ?? item.flags?.[FEO.id]?.forge);
    steps[target.dataset.key] += Number(target.dataset.delta);
    forge.steps = forgeSteps(steps);
    await this.render({ parts: ["forge"] });
  }

  /* -------------------------------------------- */

  /**
   * Forge the weapon on the bench as it has been set out.
   * @this {Base}
   */
  static async #onStrike() {
    const forge = this.#state.forge;
    const item = this.visitor?.items.get(forge.item);
    if ( !item ) return;
    const name = (forge.name ?? item.name).trim() || item.name;
    const { ok } = await request("forge", {
      actor: this.#state.visitor, item: item.id, name, steps: forgeSteps(forge.steps ?? item.flags?.[FEO.id]?.forge)
    });
    if ( !ok ) return;
    Object.assign(forge, { steps: null, name: null });
    this.#remark("forge.struckSaid", { item: name });
  }

  /* -------------------------------------------- */
  /*  Supports                                    */
  /* -------------------------------------------- */

  /**
   * Hold a support conversation.
   * @this {Base}
   */
  static async #onTalk(event, target) {
    const { ok } = await request("talk", { actor: this.#state.visitor, bond: Number(target.dataset.bond) });
    if ( ok ) this.#remark("supports.talkSaid", { name: this.#world.visitor?.name ?? "", partner: target.dataset.name });
  }

  /* -------------------------------------------- */

  /**
   * Start a support with another unit of the company.
   * @this {Base}
   */
  static async #onBefriend() {
    const partner = this.element.querySelector("[data-befriend]")?.value;
    if ( partner ) await request("befriend", { actor: this.#state.visitor, partner });
  }

  /* -------------------------------------------- */

  /**
   * Raise a support by a rank, or lower it.
   * @this {Base}
   */
  static async #onRank(event, target) {
    await request("rank", { actor: this.#state.visitor, bond: Number(target.dataset.bond), lower: target.dataset.lower === "true" });
  }

  /* -------------------------------------------- */

  /**
   * A support at A takes one of the highest ranks.
   * @this {Base}
   */
  static async #onTop(event, target) {
    await request("top", { actor: this.#state.visitor, bond: Number(target.dataset.bond), to: target.dataset.to });
  }

  /* -------------------------------------------- */
  /*  The Training Grounds                        */
  /* -------------------------------------------- */

  /**
   * Choose who the visitor faces.
   * @this {Base}
   */
  static async #onFoe(event, target) {
    this.#state.training.foe = target.dataset.foe;
    await this.render({ parts: ["training"] });
  }

  /* -------------------------------------------- */

  /**
   * Fight the bout: say who took it, and both earn what it is worth.
   * @this {Base}
   */
  static async #onSpar(event, target) {
    const me = this.visitor;
    const foe = game.actors.get(target.dataset.foe);
    if ( !me || !foe ) return;
    const winner = await DialogV2.wait({
      window: { title: "FEO.Base.training.title" },
      content: `<p>${game.i18n.format("FEO.Base.training.prompt", { name: foundry.utils.escapeHTML(me.name), foe: foundry.utils.escapeHTML(foe.name) })}</p>`,
      buttons: [
        { action: "actor", label: me.name, icon: "fa-solid fa-flag" },
        { action: "foe", label: foe.name, icon: "fa-solid fa-flag" },
        { action: "cancel", label: "COMMON.Cancel" }
      ],
      rejectClose: false
    });
    if ( (winner !== "actor") && (winner !== "foe") ) return;
    const [healer, staff] = (this.#state.training.healer || ":").split(":");
    const { ok } = await request("spar", { actor: me.id, foe: foe.id, winner, healer, staff });
    if ( ok ) this.#remark("training.foughtSaid", { name: (winner === "actor" ? me : foe).name });
  }

  /* -------------------------------------------- */
  /*  The Notice Board                            */
  /* -------------------------------------------- */

  /**
   * Take part in what a notice asks for.
   * @this {Base}
   */
  static async #onJoin(event, target) {
    const { ok } = await request("join", { actor: this.#state.visitor, notice: target.dataset.notice });
    if ( ok ) this.#remark("board.joinedSaid", { name: this.#world.visitor?.name ?? "" });
  }

  /* -------------------------------------------- */

  /**
   * Pin a notice to the board.
   * @this {Base}
   */
  static async #onNoticeAdd() {
    const field = Base.#field;
    const answer = await Base.#ask("FEO.Base.board.add", [
      field("title", "board.noticeTitle"),
      field("text", "board.noticeText", { type: "textarea" }),
      field("tags", "board.noticeTags", { hint: "board.noticeTagsHint" }),
      field("action", "board.noticeAction", { hint: "board.noticeActionHint" })
    ].join(""));
    if ( answer?.title ) await request("notice", answer);
  }

  /* -------------------------------------------- */

  /**
   * Take a notice down.
   * @this {Base}
   */
  static async #onNoticeRemove(event, target) {
    await request("notice", { remove: true, notice: target.dataset.notice });
  }
}

import { FEO } from "../config.mjs";
import { TREE } from "../rules/class-tree.mjs";
import {
  buildClassSheet, buildEquipment, buildLibrary, buildSkillList, buildSkillSheet, buildTreeContext,
  buildTreeLight, findClass, findSkill, orderFolders, readClass, readGear, readSkill, readWeapon, standingOf, treeOf
} from "./compendium-context.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${FEO.id}/templates/compendium`;

/** The sections of the window, and the parts each one shows under the masthead. */
const VIEWS = {
  classes: { icon: "shield", parts: ["classesHead", "tree", "classSheet"] },
  skills: { icon: "spark", parts: ["skillsHead", "skillList", "skillSheet"] },
  equipment: { icon: "crossed", parts: ["equipmentHead", "equipmentList"] }
};

/** The parts that show how things stand with whoever is taking a class, a skill or equipment for a unit. */
const CHOOSER_PARTS = {
  class: ["classSheet"],
  skill: ["skillList", "skillSheet"],
  pick: ["skillList", "skillSheet"],
  equipment: ["equipmentList"]
};

/**
 * The Compendium: one window for what the system's compendiums hold. Classes stand on a tree that grows from
 * the starting classes at its foot to the last tier at its head, and choosing one opens its class sheet;
 * skills are a roll to run down, with a sheet for the one chosen; weapons and items are listed with their
 * numbers.
 *
 * What is shown is worked out by `compendium-context.mjs`, which knows nothing of Foundry. This class reads the
 * compendiums, keeps what the reader has chosen, and answers to the mouse and the keyboard.
 */
export default class Compendium extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-compendium",
    classes: ["feo", "feo-compendium"],
    window: {
      title: "FEO.Compendium.title",
      icon: "fa-solid fa-book-atlas",
      resizable: true
    },
    position: { width: 1260, height: 860 },
    actions: {
      view: Compendium.#onView,
      people: Compendium.#onPeople,
      selectClass: Compendium.#onSelectClass,
      closeSheet: Compendium.#onCloseSheet,
      skill: Compendium.#onSkill,
      selectSkill: Compendium.#onSelectSkill,
      kind: Compendium.#onKind,
      // Not "tab": Foundry keeps that action for its own tab groups, and never hands it on
      side: Compendium.#onTab,
      type: Compendium.#onType,
      weapons: Compendium.#onWeapons,
      pan: Compendium.#onPan,
      chooseClass: Compendium.#onChooseClass,
      chooseSkill: Compendium.#onChooseSkill,
      pickOption: Compendium.#onPickOption,
      choosePick: Compendium.#onChoosePick,
      buy: Compendium.#onBuy,
      openItem: Compendium.#onOpenItem
    }
  };

  /** @override */
  static PARTS = {
    masthead: { template: `${TEMPLATES}/masthead.hbs` },
    classesHead: { template: `${TEMPLATES}/classes-head.hbs` },
    tree: { template: `${TEMPLATES}/tree.hbs`, scrollable: [".cp-tree-view"] },
    classSheet: { template: `${TEMPLATES}/class-sheet.hbs` },
    skillsHead: { template: `${TEMPLATES}/skills-head.hbs` },
    skillList: { template: `${TEMPLATES}/skill-list.hbs`, scrollable: [".cp-skill-list"] },
    skillSheet: { template: `${TEMPLATES}/skill-sheet.hbs` },
    equipmentHead: { template: `${TEMPLATES}/equipment-head.hbs` },
    equipmentList: { template: `${TEMPLATES}/equipment-list.hbs`, scrollable: [".cp-scroll"] }
  };

  /* -------------------------------------------- */
  /*  Reading the Compendiums                     */
  /* -------------------------------------------- */

  /** What the compendiums hold, read once and kept until one of them changes. */
  static #shelf = null;

  /** The one window. */
  static #instance = null;

  /**
   * The system's own Item compendiums.
   * @returns {CompendiumCollection[]}
   */
  static get packs() {
    return game.packs.filter((pack) => {
      return (pack.documentName === "Item") && (pack.metadata.packageType === "system")
        && (pack.metadata.packageName === FEO.id);
    });
  }

  /**
   * Read the compendiums into a library.
   * @returns {Promise<object>}
   */
  static async library() {
    if ( Compendium.#shelf ) return Compendium.#shelf;
    const entries = { classes: [], skills: [], weapons: [], gear: [] };
    const readers = { class: ["classes", readClass], skill: ["skills", readSkill], weapon: ["weapons", readWeapon], gear: ["gear", readGear] };
    let offset = 0;
    for ( const pack of Compendium.packs ) {
      const documents = await pack.getDocuments();
      const folders = orderFolders(pack.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        description: folder.description,
        sort: folder.sort,
        parent: folder.folder?.id ?? null
      })));

      // Folders keep their order from one compendium to the next
      for ( const folder of folders.values() ) folder.index += offset;
      offset += folders.size + 1;
      for ( const document of documents ) {
        const [list, read] = readers[document.type] ?? [];
        if ( list ) entries[list].push(read(document, folders));
      }
    }
    Compendium.#shelf = buildLibrary(entries);
    return Compendium.#shelf;
  }

  /* -------------------------------------------- */

  /**
   * Make the Compendium part of the game: a way to open it from the Fire Emblem controls and from a macro, and
   * a fresh reading whenever one of its compendiums changes.
   */
  static register() {
    game.feo.compendium = { open: Compendium.open, toggle: Compendium.toggle, app: Compendium };

    // A button at the head of the Fire Emblem controls opens the window, and closes it again
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools ) return;
      tools.feoCompendium = {
        name: "feoCompendium",
        title: "FEO.Compendium.open",
        icon: "fa-solid fa-book-atlas",
        order: 1,
        button: true,
        onChange: () => Compendium.toggle()
      };
    });

    Hooks.on("updateCompendium", (pack) => {
      if ( !Compendium.packs.includes(pack) ) return;
      Compendium.#shelf = null;
      if ( Compendium.#instance?.rendered ) Compendium.#instance.render();
    });

    // Whoever is taking something for a unit is shown the unit as it now is: what it has, and the Gold it has left
    Hooks.on("updateActor", (actor) => {
      const app = Compendium.#instance;
      const chooser = app?.rendered ? app.#chooser : null;
      if ( !chooser || app.#taking || (chooser.actor !== actor.uuid) ) return;
      app.render({ parts: CHOOSER_PARTS[chooser.takes] ?? [] });
    });
  }

  /* -------------------------------------------- */

  /**
   * Open the Compendium, or bring it forward, at a section, a class, a skill or a type of equipment.
   * @param {object} [options]
   * @param {"classes"|"skills"|"equipment"} [options.view]
   * @param {string} [options.class]      The name or id of a class to choose
   * @param {string} [options.skill]      The name or id of a skill to choose
   * @param {string} [options.kind]       The kind of skill to list
   * @param {"weapons"|"items"} [options.tab]     The side of the armoury to show
   * @param {string} [options.type]       The type of weapon or item to show
   * @param {object} [options.chooser]    Someone who takes something from the Compendium for a unit, as the
   *   Character Creator does. `takes` says what: a `class` from the tree, a `skill` from the roll, or
   *   `equipment` from the armoury; or a `pick`, what a skill has its unit pick as it is learnt, which is made
   *   on the skill's own page: `picks(entry)` lists what can be picked there, `toggle(index, value)` takes or
   *   gives up an option, and `choose` confirms. `describe(entry, library)` says how an entry stands with them: for a class
   *   or a skill, what to show at the foot of its sheet, as `{can, chosen, barred, text, label}`; for
   *   equipment, what to show on its row, as `{sold, can, fit, unfit}`. `choose(entry)` takes it. `banner()`,
   *   if there is one, says whom it is for, as `{text, tags, note}` (with `button`, what the button beside each
   *   piece of equipment says in place of Buy), and `actor` is the address of the unit, so
   *   that what is shown keeps up with it. Opening the window without a chooser puts the buttons away
   * @returns {Promise<Compendium>}
   */
  static async open(options = {}) {
    const app = Compendium.#instance ??= new Compendium();
    app.#chooser = options.chooser ?? null;
    const wanted = options.class ? { class: options.class }
      : (options.skill || options.kind) ? { skill: options.skill, kind: options.kind } : null;
    if ( options.view in VIEWS ) app.#state.view = options.view;
    if ( wanted ) app.#wanted = wanted;
    if ( options.tab ) {
      Object.assign(app.#state, { tab: options.tab === "items" ? "items" : "weapons", type: options.type ?? "", equipmentQuery: "" });
    }
    await app.render({ force: true });
    app.bringToFront();
    return app;
  }

  /* -------------------------------------------- */

  /**
   * Open the Compendium, or close it if it is open.
   * @returns {Promise<Compendium>}
   */
  static async toggle() {
    const app = Compendium.#instance;
    if ( app?.rendered ) return app.close();
    return Compendium.open();
  }

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /** What the reader has chosen. */
  #state = {
    view: "classes",
    race: null,
    selected: {},
    sheetOpen: false,
    skill: null,
    kind: "all",
    skillQuery: "",
    tab: "weapons",
    type: "",
    equipmentQuery: ""
  };

  /** What `open` asked to be chosen once the compendiums are read. */
  #wanted = null;

  /** Whoever is taking something from the Compendium for a unit, if anyone is. */
  #chooser = null;

  /** Is something being taken just now? What it changes is shown once it is done. */
  #taking = false;

  /** The library the window was last drawn from. */
  #library = null;

  /** Where the tree was left, so that drawing it again does not send it back to its foot. */
  #treeRace = null;

  /* -------------------------------------------- */

  /**
   * The class chosen among the people in view.
   * @type {string|null}
   */
  get #classId() {
    return this.#state.selected[this.#state.race] ?? null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const library = this.#library = await Compendium.library();
    const state = this.#state;

    // What was asked for by name
    if ( this.#wanted?.class ) {
      const cls = findClass(library, this.#wanted.class);
      if ( cls ) {
        Object.assign(state, { view: "classes", race: cls.race, sheetOpen: true });
        state.selected[cls.race] = cls.id;
      }
    } else if ( this.#wanted ) {
      const kind = this.#wanted.kind in FEO.skillKinds ? this.#wanted.kind : "";
      const skill = findSkill(library, this.#wanted.skill);
      if ( skill ) {
        Object.assign(state, { view: "skills", skill: skill.id, sheetOpen: true, kind: skill.kind === kind ? kind : "all", skillQuery: "" });
      } else if ( kind ) {
        // A kind with no skill named starts at the head of its part of the roll
        Object.assign(state, { kind, skillQuery: "" });
        if ( library.skillById.get(state.skill)?.kind !== kind ) {
          state.skill = library.skills.find((entry) => entry.kind === kind)?.id ?? state.skill;
        }
      }
    }
    this.#wanted = null;

    // Something is always chosen, so that a sheet docked beside its list is never empty
    if ( !library.races.includes(state.race) ) state.race = library.races[0] ?? null;
    this.#chooseDefaultClass();
    if ( !library.skillById.has(state.skill) ) state.skill = library.skills[0]?.id ?? null;
    return { state };
  }

  /* -------------------------------------------- */

  /**
   * Choose the first starting class of the first line for a people that has none chosen yet.
   */
  #chooseDefaultClass() {
    const { race, selected } = this.#state;
    if ( !race || this.#library.byId.has(selected[race]) ) return;
    const { tree } = treeOf(this.#library, race);
    const lead = tree.lines.find((line) => !line.loose)?.lead ?? tree.nodes[0]?.id;
    if ( lead ) selected[race] = lead;
  }

  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context, options) {
    // Each part is built from its own copy, so that what one part is given never shows in another
    context = { ...(await super._preparePartContext(partId, context, options)) };
    const library = this.#library;
    const state = this.#state;
    const i18n = game.i18n;
    const count = (key, total) => i18n.format(`FEO.Compendium.count.${key}`, { count: total.toLocaleString("en-US") });
    const equipment = library.weaponsById.size + library.gearById.size;

    // Whoever is taking what this part shows, and how an entry stands with them
    const chooser = (takes) => (this.#chooser?.takes === takes ? this.#chooser : null);
    const standing = (takes) => (chooser(takes) ? (entry) => this.#chooser.describe(entry, library) : null);

    switch ( partId ) {
      case "masthead":
        context.tabs = Object.entries(VIEWS).map(([id, view]) => ({
          id,
          icon: view.icon,
          label: i18n.localize(`FEO.Compendium.view.${id}`),
          count: count(id, { classes: library.classes.length, skills: library.skills.length, equipment }[id]),
          selected: state.view === id
        }));
        break;

      case "classesHead": {
        const classes = library.classes.filter((cls) => cls.race === state.race);
        context.eyebrow = i18n.format("FEO.Compendium.eyebrow.classes", {
          people: i18n.localize(FEO.races[state.race]?.label ?? ""),
          count: classes.length
        });
        context.listId = `${this.id}-class-names`;
        context.names = classes.map((cls) => cls.name);
        context.races = library.races.length > 1 ? library.races.map((race) => ({
          key: race,
          label: i18n.localize(FEO.races[race].label),
          count: library.classes.filter((cls) => cls.race === race).length,
          pressed: race === state.race
        })) : [];
        break;
      }

      case "tree":
        Object.assign(context, state.race ? buildTreeContext(library, state.race, i18n) : { empty: true });
        break;

      case "classSheet":
        context.sheet = buildClassSheet(library, this.#classId, i18n);
        if ( context.sheet && chooser("class") ) context.choose = standing("class")(library.byId.get(this.#classId));
        break;

      case "skillsHead":
        context.eyebrow = count("skills", library.skills.length);
        context.query = state.skillQuery;
        break;

      case "skillList":
        Object.assign(context, buildSkillList(library, {
          kind: state.kind,
          query: state.skillQuery,
          selected: state.skill,
          describe: standing("skill")
        }, i18n));
        context.banner = (chooser("skill") ?? chooser("pick"))?.banner?.() ?? null;
        break;

      case "skillSheet":
        context.sheet = buildSkillSheet(library, state.skill, i18n);
        if ( context.sheet && chooser("skill") ) context.choose = standing("skill")(library.skillById.get(state.skill));

        // What a skill has its unit pick is picked on the skill's own page
        if ( context.sheet && chooser("pick") ) {
          const shown = library.skillById.get(state.skill);
          context.picking = true;
          context.picks = this.#chooser.picks(shown);
          context.choose = this.#chooser.describe(shown, library);
        }
        break;

      case "equipmentHead":
        context.eyebrow = count("equipment", equipment);
        context.weapons = state.tab === "weapons";
        context.items = state.tab === "items";
        context.query = state.equipmentQuery;
        break;

      case "equipmentList": {
        const built = buildEquipment(library, {
          tab: state.tab,
          type: state.type,
          query: state.equipmentQuery,
          describe: standing("equipment")
        }, i18n);
        state.type = built.type;
        Object.assign(context, built);
        context.banner = chooser("equipment")?.banner?.() ?? null;
        break;
      }
    }
    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const root = this.element;

    // Whatever carries the address of an Item can be dragged onto a sheet that takes one
    root.addEventListener("dragstart", (event) => {
      const uuid = event.target.closest?.("[data-drag-uuid]")?.dataset.dragUuid;
      if ( !uuid ) return;
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
    });

    // Searching redraws the list under the box, not the box
    root.addEventListener("input", (event) => {
      const box = event.target.closest?.("[data-search]");
      if ( !box ) return;
      if ( box.dataset.search === "skills" ) {
        this.#state.skillQuery = box.value;
        this.#redraw(["skillList"], { top: ".cp-skill-list" });
      } else {
        this.#state.equipmentQuery = box.value;
        this.#redraw(["equipmentList"], { top: ".cp-equipment .cp-scroll" });
      }
    });

    // Finding a class by name
    const find = (event) => {
      const box = event.target.closest?.("[data-find]");
      if ( !box || ((event.type === "keydown") && (event.key !== "Enter")) ) return;
      const text = box.value.trim().toLowerCase();
      if ( !text ) return;
      const classes = this.#library.classes.filter((cls) => cls.race === this.#state.race);
      const name = (cls) => cls.name.toLowerCase();
      const found = classes.find((cls) => name(cls) === text) ?? classes.find((cls) => name(cls).startsWith(text))
        ?? classes.find((cls) => name(cls).includes(text)) ?? findClass(this.#library, text);
      if ( !found ) return;
      box.value = "";
      this.selectClass(found.id);
    };
    root.addEventListener("change", find);
    root.addEventListener("keydown", find);

    // Up and down walk the roll of skills, and the sheet follows
    root.addEventListener("keydown", (event) => {
      if ( (event.key !== "ArrowDown") && (event.key !== "ArrowUp") ) return;
      if ( !event.target.closest?.(".cp-skill-list") ) return;
      const rows = [...root.querySelectorAll(".sk-row")];
      const at = rows.indexOf(document.activeElement);
      const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (event.key === "ArrowDown" ? 1 : -1)))];
      if ( !next ) return;
      event.preventDefault();
      next.focus();
      this.selectSkill(next.dataset.skillId, { open: false });
    });

    // Escape closes a sheet that lies over its list before it closes the window
    root.addEventListener("keydown", (event) => {
      if ( (event.key !== "Escape") || !this.#state.sheetOpen || !this.#sheetCovers() ) return;
      event.stopPropagation();
      this.#setSheet(false);
    }, true);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const parts = options.parts ?? Object.keys(Compendium.PARTS);
    this.#stamp();
    if ( parts.includes("tree") ) {
      this.#wireTree();
      this.#paint();
    }
    this.#settleTree();
    if ( parts.includes("skillList") && (this.#state.view === "skills") ) this.#revealSkill();
  }

  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#treeRace = null;
    this.#chooser = null;
  }

  /* -------------------------------------------- */

  /**
   * Draw some parts again. Typing in a search box asks for this on every key, so the calls are gathered.
   * @param {string[]} parts
   * @param {object} [options]
   * @param {string} [options.top]      A scrolling element to send back to its top afterwards
   */
  #redraw = foundry.utils.debounce(async (parts, { top } = {}) => {
    await this.render({ parts });
    if ( top ) this.element?.querySelector(top)?.scrollTo({ top: 0 });
  }, 120);

  /* -------------------------------------------- */

  /**
   * Mark the window with the section in view and whether a sheet is open, which the styles read.
   */
  #stamp() {
    const root = this.element;
    if ( !root ) return;
    root.dataset.view = this.#state.view;
    root.dataset.sheet = this.#state.sheetOpen ? "open" : "closed";
  }

  /* -------------------------------------------- */

  /**
   * Does a sheet lie over its list, as it does in a narrow window, instead of standing beside it?
   * @returns {boolean}
   */
  #sheetCovers() {
    const dock = this.element?.querySelector(`.cp-dock.v-${this.#state.view}`);
    const body = this.element?.querySelector(`.cp-body.v-${this.#state.view}`);
    if ( !dock || !body ) return false;
    return dock.getBoundingClientRect().left < body.getBoundingClientRect().right - 1;
  }

  /* -------------------------------------------- */

  /**
   * Open or close the sheet of the section in view.
   * @param {boolean} open
   */
  #setSheet(open) {
    this.#state.sheetOpen = open;
    this.#stamp();
  }

  /* -------------------------------------------- */
  /*  The Tree                                    */
  /* -------------------------------------------- */

  /** The scrolling view of the tree. */
  get #treeView() {
    return this.element?.querySelector(".cp-tree-view") ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Let the map be dragged to pan it. A drag that moved does not count as a click on the class under it.
   */
  #wireTree() {
    const view = this.#treeView;
    if ( !view ) return;
    let drag = null;
    let swallow = false;
    view.addEventListener("click", (event) => {
      if ( !swallow ) return;
      event.stopPropagation();
      event.preventDefault();
    }, true);
    view.addEventListener("pointerdown", (event) => {
      if ( (event.pointerType !== "mouse") || (event.button !== 0) ) return;
      drag = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop, moved: false };
    });
    view.addEventListener("pointermove", (event) => {
      if ( !drag ) return;
      const [dx, dy] = [event.clientX - drag.x, event.clientY - drag.y];
      if ( !drag.moved && (Math.hypot(dx, dy) < 6) ) return;
      if ( !drag.moved ) view.setPointerCapture(event.pointerId);
      drag.moved = true;
      view.classList.add("dragging");
      view.scrollLeft = drag.left - dx;
      view.scrollTop = drag.top - dy;
    });
    const end = (event) => {
      if ( !drag ) return;
      const moved = drag.moved;
      drag = null;
      view.classList.remove("dragging");
      if ( view.hasPointerCapture?.(event.pointerId) ) view.releasePointerCapture(event.pointerId);
      if ( !moved ) return;
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    view.addEventListener("scroll", () => this.#updatePan(), { passive: true });
  }

  /* -------------------------------------------- */

  /**
   * Light the roads of the class chosen.
   */
  #paint() {
    const root = this.element;
    const routes = root?.querySelector(".cp-routes");
    if ( !routes || !this.#classId ) return;
    const light = buildTreeLight(this.#library, this.#state.race, this.#classId, game.i18n);
    routes.innerHTML = light.routes;
    root.querySelector(".cp-levels").innerHTML = light.tags;
    for ( const node of root.querySelectorAll(".cp-node") ) {
      const mode = light.nodes[node.dataset.classId] ?? "";
      node.className = mode ? `cp-node ${mode}` : "cp-node";
      node.setAttribute("aria-pressed", String(mode === "sel"));
    }
  }

  /* -------------------------------------------- */

  /**
   * The first time the tree of a people can be measured, bring it to rest and bring the class chosen into
   * view. A tree drawn while another section is in view waits until its own is.
   */
  #settleTree() {
    const view = this.#treeView;
    if ( !view || !view.clientHeight || (this.#treeRace === this.#state.race) ) return;
    this.#treeRace = this.#state.race;
    this.#rest();
    this.#reveal(this.#classId, { smooth: false });
    this.#updatePan();
  }

  /* -------------------------------------------- */

  /**
   * Bring the tree to rest with its lowest tier of lines along the foot of the view, so that the starting
   * classes and their promotions are what is seen first.
   */
  #rest() {
    const view = this.#treeView;
    if ( !view ) return;
    const { tree } = treeOf(this.#library, this.#state.race);
    const ground = tree.tiers.filter((row) => row.order >= FEO.classTiers.base.order).pop() ?? tree.tiers.at(-1);
    const foot = ground ? ground.y + TREE.node + 40 : tree.height;
    view.scrollTop = Math.max(0, foot - view.clientHeight);
    view.scrollLeft = 0;
  }

  /* -------------------------------------------- */

  /**
   * Bring a class into view, clear of a sheet that lies over the map.
   * @param {string} id
   * @param {object} [options]
   * @param {boolean} [options.smooth]
   * @param {boolean} [options.centre]    Bring it to the middle even when it is already in view
   */
  #reveal(id, { smooth = true, centre = false } = {}) {
    const view = this.#treeView;
    const spot = standingOf(this.#library, id);
    if ( !view || !spot ) return;
    const gutter = view.querySelector(".cp-tiers")?.offsetWidth ?? 0;
    const dock = this.element.querySelector(".cp-dock.v-classes");
    const cover = (this.#state.sheetOpen && this.#sheetCovers()) ? dock.offsetWidth : 0;
    const room = view.clientWidth - gutter - cover;
    if ( room < 120 ) return;
    const target = {};
    const [left, right] = [view.scrollLeft + 50, view.scrollLeft + room - 60];
    if ( centre || (spot.x < left) || (spot.x > right) ) target.left = Math.max(0, spot.x - (room / 2));
    const [top, bottom] = [view.scrollTop + 30, view.scrollTop + view.clientHeight - TREE.node - 30];
    if ( (spot.y < top) || (spot.y > bottom) ) target.top = Math.max(0, spot.y - ((view.clientHeight - TREE.node) / 2));
    if ( ("left" in target) || ("top" in target) ) view.scrollTo({ ...target, behavior: smooth ? "smooth" : "instant" });
  }

  /* -------------------------------------------- */

  /**
   * Show the arrows at the edges of the map only where there is more of it to see.
   */
  #updatePan() {
    const view = this.#treeView;
    if ( !view ) return;
    const most = view.scrollWidth - view.clientWidth;
    this.element.querySelector(".cp-pan.left")?.classList.toggle("on", view.scrollLeft > 4);
    this.element.querySelector(".cp-pan.right")?.classList.toggle("on", view.scrollLeft < most - 4);
  }

  /* -------------------------------------------- */
  /*  Choosing                                    */
  /* -------------------------------------------- */

  /**
   * Choose a class: light its roads, show its sheet and bring it into view.
   * @param {string} id
   * @param {object} [options]
   * @param {boolean} [options.open]      Open its sheet where the sheet lies over the map
   * @returns {Promise<void>}
   */
  async selectClass(id, { open = true } = {}) {
    const cls = findClass(this.#library, id);
    if ( !cls ) return;
    const state = this.#state;
    const moved = (cls.race !== state.race) || (state.view !== "classes");
    const people = cls.race !== state.race;
    if ( people ) this.#treeRace = null;
    state.view = "classes";
    state.race = cls.race;
    state.selected[cls.race] = cls.id;
    if ( open ) state.sheetOpen = true;
    await this.render({ parts: [...(moved ? ["masthead"] : []), ...(people ? ["classesHead", "tree"] : []), "classSheet"] });
    if ( !people ) this.#paint();
    this.element.querySelector(".cp-dock.v-classes")?.scrollTo({ top: 0 });
    this.#reveal(cls.id);
  }

  /* -------------------------------------------- */

  /**
   * Choose a skill and show its sheet.
   * @param {string} id
   * @param {object} [options]
   * @param {boolean} [options.open]      Open its sheet where the sheet lies over the roll
   * @returns {Promise<void>}
   */
  async selectSkill(id, { open = true } = {}) {
    if ( !this.#library.skillById.has(id) ) return;
    this.#state.skill = id;
    if ( open ) this.#state.sheetOpen = true;
    for ( const row of this.element.querySelectorAll(".sk-row") ) {
      row.setAttribute("aria-pressed", String(row.dataset.skillId === id));
    }
    await this.render({ parts: ["skillSheet"] });
    this.element.querySelector(".cp-dock.v-skills")?.scrollTo({ top: 0 });
  }

  /* -------------------------------------------- */

  /**
   * Bring the row of the skill chosen into view on the roll.
   * @param {object} [options]
   * @param {boolean} [options.flash]     Draw the eye to it
   */
  #revealSkill({ flash = false } = {}) {
    const list = this.element.querySelector(".cp-skill-list");
    const row = list?.querySelector(`.sk-row[aria-pressed="true"]`);
    if ( !row ) return;
    const [top, bottom] = [row.offsetTop - list.offsetTop, row.offsetTop - list.offsetTop + row.offsetHeight];
    if ( (top < list.scrollTop + 30) || (bottom > list.scrollTop + list.clientHeight) ) {
      list.scrollTop = Math.max(0, top - (list.clientHeight / 2) + 20);
    }
    if ( !flash ) return;
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Show a section.
   * @this {Compendium}
   */
  static async #onView(event, target) {
    const view = target.dataset.view;
    if ( !(view in VIEWS) || (view === this.#state.view) ) return;
    this.#state.view = view;
    this.#state.sheetOpen = false;
    await this.render({ parts: ["masthead", ...VIEWS[view].parts] });
  }

  /* -------------------------------------------- */

  /**
   * Show the tree of another people.
   * @this {Compendium}
   */
  static async #onPeople(event, target) {
    const race = target.dataset.race;
    if ( !this.#library.races.includes(race) || (race === this.#state.race) ) return;
    this.#state.race = race;
    this.#state.sheetOpen = false;
    this.#treeRace = null;
    this.#chooseDefaultClass();
    await this.render({ parts: ["classesHead", "tree", "classSheet"] });
  }

  /* -------------------------------------------- */

  /**
   * Choose a class from the map, or follow a link to one.
   * @this {Compendium}
   */
  static #onSelectClass(event, target) {
    return this.selectClass(target.dataset.classId);
  }

  /* -------------------------------------------- */

  /**
   * Close the sheet that lies over the map or the roll.
   * @this {Compendium}
   */
  static #onCloseSheet() {
    this.#setSheet(false);
  }

  /* -------------------------------------------- */

  /**
   * Follow a link to a skill from somewhere else in the Compendium.
   * @this {Compendium}
   */
  static async #onSkill(event, target) {
    const skill = findSkill(this.#library, target.dataset.skillId);
    if ( !skill ) return;
    const state = this.#state;
    const shown = buildSkillList(this.#library, { kind: state.kind, query: state.skillQuery }, game.i18n)
      .groups.some((group) => group.rows.some((row) => row.id === skill.id));
    if ( !shown ) Object.assign(state, { kind: "all", skillQuery: "" });
    Object.assign(state, { view: "skills", skill: skill.id, sheetOpen: true });
    await this.render({ parts: ["masthead", ...VIEWS.skills.parts] });
    this.#revealSkill({ flash: true });
  }

  /* -------------------------------------------- */

  /**
   * Choose a skill from the roll.
   * @this {Compendium}
   */
  static #onSelectSkill(event, target) {
    return this.selectSkill(target.dataset.skillId);
  }

  /* -------------------------------------------- */

  /**
   * Show the skills of one kind.
   * @this {Compendium}
   */
  static async #onKind(event, target) {
    this.#state.kind = target.dataset.kindKey;
    await this.render({ parts: ["skillList"] });
    this.element.querySelector(".cp-skill-list")?.scrollTo({ top: 0 });
  }

  /* -------------------------------------------- */

  /**
   * Show the weapons or the items.
   * @this {Compendium}
   */
  static async #onTab(event, target) {
    if ( target.dataset.tab === this.#state.tab ) return;
    this.#state.tab = target.dataset.tab;
    this.#state.type = "";
    await this.render({ parts: ["equipmentHead", "equipmentList"] });
    this.element.querySelector(".cp-equipment .cp-scroll")?.scrollTo({ top: 0 });
  }

  /* -------------------------------------------- */

  /**
   * Show one type of weapon or item.
   * @this {Compendium}
   */
  static async #onType(event, target) {
    this.#state.type = target.dataset.type;
    await this.render({ parts: ["equipmentList"] });
    this.element.querySelector(".cp-equipment .cp-scroll")?.scrollTo({ top: 0 });
  }

  /* -------------------------------------------- */

  /**
   * Follow a proficiency to its weapons in the armoury.
   * @this {Compendium}
   */
  static async #onWeapons(event, target) {
    Object.assign(this.#state, { view: "equipment", tab: "weapons", type: target.dataset.type, equipmentQuery: "", sheetOpen: false });
    await this.render({ parts: ["masthead", ...VIEWS.equipment.parts] });
    this.element.querySelector(".cp-equipment .cp-scroll")?.scrollTo({ top: 0 });
  }

  /* -------------------------------------------- */

  /**
   * Take something for whoever asked for it, and show what that changed.
   * @param {"class"|"skill"|"equipment"} takes
   * @param {object|undefined} entry      The class, skill, weapon or item as the library keeps it
   * @returns {Promise<void>}
   */
  async #take(takes, entry) {
    const chooser = this.#chooser;
    if ( !entry || (chooser?.takes !== takes) || this.#taking ) return;

    // Only what has a button to press: a class or a skill that can be taken, or something that is for sale
    const standing = chooser.describe(entry, this.#library);
    if ( !(takes === "equipment" ? standing.sold : standing.can) ) return;
    this.#taking = true;
    try {
      await chooser.choose(entry);
    } finally {
      this.#taking = false;
    }
    await this.render({ parts: CHOOSER_PARTS[takes] });
  }

  /* -------------------------------------------- */

  /**
   * Take the class chosen for whoever asked for one.
   * @this {Compendium}
   */
  static #onChooseClass() {
    return this.#take("class", this.#library.byId.get(this.#classId));
  }

  /* -------------------------------------------- */

  /**
   * Take the skill chosen for whoever asked for one.
   * @this {Compendium}
   */
  static #onChooseSkill() {
    return this.#take("skill", this.#library.skillById.get(this.#state.skill));
  }

  /* -------------------------------------------- */

  /**
   * Take or give up one of the options of what a skill has its unit pick.
   * @this {Compendium}
   */
  static #onPickOption(event, target) {
    const chooser = this.#chooser;
    if ( (chooser?.takes !== "pick") || this.#taking ) return null;
    chooser.toggle(Number(target.dataset.pick), target.dataset.value);
    return this.render({ parts: ["skillSheet"] });
  }

  /* -------------------------------------------- */

  /**
   * Confirm what was picked on a skill for whoever asked.
   * @this {Compendium}
   */
  static #onChoosePick() {
    return this.#take("pick", this.#library.skillById.get(this.#state.skill));
  }

  /* -------------------------------------------- */

  /**
   * Buy a weapon or an item for whoever is shopping.
   * @this {Compendium}
   */
  static #onBuy(event, target) {
    const id = target.dataset.id;
    return this.#take("equipment", this.#library.weaponsById.get(id) ?? this.#library.gearById.get(id));
  }

  /* -------------------------------------------- */

  /**
   * Pan the map by about one line.
   * @this {Compendium}
   */
  static #onPan(event, target) {
    this.#treeView?.scrollBy({ left: Number(target.dataset.way) * ((3 * TREE.column) + TREE.gap), behavior: "smooth" });
  }

  /* -------------------------------------------- */

  /**
   * Open the sheet of the Item itself.
   * @this {Compendium}
   */
  static async #onOpenItem(event, target) {
    const item = await foundry.utils.fromUuid(target.dataset.uuid);
    item?.sheet?.render({ force: true });
  }
}

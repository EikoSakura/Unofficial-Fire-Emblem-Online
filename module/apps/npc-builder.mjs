import { FEO } from "../config.mjs";
import { kitFor, lineOf, previewNpc, promotionsOf, saveNpc, specOf, takeClass } from "../helpers/npc.mjs";
import { isBroken, readPrerequisite } from "../rules/creation-fit.mjs";
import { newSeed } from "../rules/mapgen.mjs";
import { cleanSpec, levelSpan, newSpec, wields } from "../rules/npc.mjs";
import Compendium from "./compendium.mjs";
import { findSkill } from "./compendium-context.mjs";
import { buildNpcBuilder } from "./npc-builder-context.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The NPC Builder: a window in which a Game Master makes a unit to play from a class, a Level and a side. The
 * rules fill in the rest (see rules/npc.mjs), and whatever they filled in can be changed by hand.
 *
 * Nothing is written until the unit is saved. What the window shows is worked out again from what was chosen
 * each time it is drawn, by `npc-builder-context.mjs`; long choices are made in the Compendium, which is opened
 * with a chooser as the Character Creator opens it; and the unit is saved by `helpers/npc.mjs`.
 */
export default class NpcBuilder extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-npc-builder",
    classes: ["feo", "feo-npc"],
    window: { title: "FEO.Npc.title", icon: "fa-solid fa-chess-knight", resizable: true },
    position: { width: 960, height: 720 },
    actions: {
      chooseClass: NpcBuilder.#onChooseClass,
      parent: NpcBuilder.#onParent,
      promote: NpcBuilder.#onPromote,
      level: NpcBuilder.#onLevel,
      matchParty: NpcBuilder.#onMatchParty,
      side: NpcBuilder.#onSide,
      flag: NpcBuilder.#onFlag,
      vary: NpcBuilder.#onVary,
      mode: NpcBuilder.#onMode,
      reroll: NpcBuilder.#onReroll,
      adjust: NpcBuilder.#onAdjust,
      con: NpcBuilder.#onCon,
      rank: NpcBuilder.#onRank,
      equip: NpcBuilder.#onEquip,
      drop: NpcBuilder.#onDrop,
      unpack: NpcBuilder.#onUnpack,
      kit: NpcBuilder.#onKit,
      chooseGear: NpcBuilder.#onChooseGear,
      nextSkill: NpcBuilder.#onNextSkill,
      unskill: NpcBuilder.#onUnskill,
      chooseGeneric: NpcBuilder.#onChooseGeneric,
      chooseExtra: NpcBuilder.#onChooseExtra,
      openSheet: NpcBuilder.#onOpenSheet,
      save: NpcBuilder.#onSave
    }
  };

  /** @override */
  static PARTS = {
    builder: { template: `systems/${FEO.id}/templates/encounter/npc-builder.hbs`, scrollable: [".nb-main"] }
  };

  /* -------------------------------------------- */

  /** The one window. @type {NpcBuilder|null} */
  static #instance = null;

  /** What was chosen for the unit. @type {import("../rules/npc.mjs").NpcSpec} */
  #spec = newSpec();

  /** The unit it was opened from, or was saved as. @type {Actor|null} */
  #actor = null;

  /** The Compendium's library, as the window was last drawn from it. */
  #library = null;

  /** Whom the unit is made for: the name of an encounter, the Level of its party, and who to tell once saved. */
  #for = { encounter: "", partyLevel: null, done: null };

  /** What the window has to say just now. */
  #say = "";

  /** Is the unit being saved? */
  #busy = false;

  /* -------------------------------------------- */
  /*  Opening                                     */
  /* -------------------------------------------- */

  /**
   * Open the NPC Builder, or bring it forward, on a unit it made before or on a new one. It is a Game Master's.
   * @param {object} [options]
   * @param {Actor|null} [options.actor]        A unit the builder made, to change
   * @param {object} [options.spec]             What is known of a new unit already: its side, its Level
   * @param {string} [options.encounter]        The name of the encounter it is made for
   * @param {number|null} [options.partyLevel]  The Level of the party of that encounter
   * @param {(actor: Actor) => any} [options.done]    Called with the unit once it is saved
   * @returns {Promise<NpcBuilder|null>}
   */
  static async open({ actor = null, spec = null, encounter = "", partyLevel = null, done = null } = {}) {
    if ( !game.user.isGM ) return null;
    const app = NpcBuilder.#instance ??= new NpcBuilder();
    const kept = actor ? specOf(actor) : null;
    if ( actor && !kept ) {
      // A unit that was made another way is changed on its own sheet
      actor.sheet?.render({ force: true });
      return null;
    }
    app.#actor = actor;
    app.#spec = kept ?? newSpec({ seed: newSeed(), ...(spec ?? {}) });
    app.#for = { encounter, partyLevel, done };
    app.#say = "";
    await app.render({ force: true });
    app.bringToFront();
    return app;
  }

  /* -------------------------------------------- */

  /**
   * Open the NPC Builder on a new unit, or close it if it is open.
   */
  static toggle() {
    if ( NpcBuilder.#instance?.rendered ) NpcBuilder.#instance.close();
    else NpcBuilder.open();
  }

  /* -------------------------------------------- */

  /**
   * Make the NPC Builder part of the game: a way to open it from the Fire Emblem controls and from a macro.
   */
  static register() {
    game.feo.npcBuilder = { open: NpcBuilder.open, toggle: NpcBuilder.toggle, app: NpcBuilder };
    Hooks.on("getSceneControlButtons", (controls) => {
      const tools = controls.feo?.tools;
      if ( !tools || !game.user.isGM ) return;
      tools.feoNpcBuilder = {
        name: "feoNpcBuilder",
        title: "FEO.Controls.npc",
        icon: "fa-solid fa-chess-knight",
        order: 7,
        button: true,
        onChange: () => NpcBuilder.toggle()
      };
    });
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const library = this.#library = await Compendium.library();
    const spec = this.#spec;
    const second = library.byId.get(library.alias.get(spec.classes[1]) ?? spec.classes[1]);
    return buildNpcBuilder({
      spec,
      view: previewNpc(spec, library),
      library,
      parents: second ? (library.parentsOf.get(second.id) ?? []) : [],
      promotions: promotionsOf(library, spec),
      saved: !!this.#actor,
      encounter: this.#for.encounter,
      partyLevel: this.#for.partyLevel,
      say: this.#say
    }, game.i18n);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);

    // The name is written where it shows. The window is not drawn again for it, so that a click on a button
    // straight from the field still lands on that button
    this.element.addEventListener("change", (event) => {
      if ( event.target?.name !== "name" ) return;
      this.#spec = cleanSpec({ ...this.#spec, name: event.target.value });
      const shown = this.element.querySelector(".nb-name");
      if ( shown ) shown.textContent = this.#spec.name || this.#view?.build.className || "";
    });
  }

  /* -------------------------------------------- */

  /**
   * Something was chosen: what is kept of the unit is put right, and the window is drawn again.
   * @param {object} changes        What changes of what was chosen
   * @param {string} [say]          What to say of it
   * @returns {Promise<any>}
   */
  #change(changes, say = "") {
    this.#spec = cleanSpec({ ...this.#spec, ...changes });
    this.#say = say;
    return this.render();
  }

  /** What the unit comes to as it stands. */
  get #view() {
    return this.#library ? previewNpc(this.#spec, this.#library) : null;
  }

  /* -------------------------------------------- */
  /*  Class and Level                             */
  /* -------------------------------------------- */

  /**
   * Open the Compendium at the class tree, with a button on its class sheet that takes the class for the unit.
   * @this {NpcBuilder}
   */
  static #onChooseClass() {
    const i18n = game.i18n;
    const heaven = FEO.classTiers.heaven.order;
    const describe = (cls) => {
      if ( !cls ) return { can: false, text: "" };
      const current = this.#spec.classes.at(-1) ?? "";
      if ( cls.order >= heaven ) return { can: false, barred: true, text: i18n.localize("FEO.Npc.tree.heaven") };
      if ( cls.id === current ) return { can: false, chosen: true, text: i18n.localize("FEO.Npc.tree.chosen") };
      return {
        can: true,
        text: i18n.localize(current ? "FEO.Npc.tree.change" : "FEO.Npc.tree.take"),
        label: i18n.format("FEO.Npc.tree.choose", { name: cls.name.split("/")[0] })
      };
    };
    const choose = async (cls) => {
      this.#spec = takeClass(this.#spec, this.#library ?? await Compendium.library(), cls);
      this.#say = "";
      await this.render();
    };
    const current = this.#library?.byId.get(this.#spec.classes.at(-1) ?? "");
    return Compendium.open({ view: "classes", class: current?.name, chooser: { takes: "class", actor: null, describe, choose } });
  }

  /* -------------------------------------------- */

  /**
   * The unit came up through another class than the one that was taken for it.
   * @this {NpcBuilder}
   */
  static #onParent(event, target) {
    const id = target.dataset.classId;
    if ( !this.#library?.byId.has(id) || (this.#spec.classes.length < 2) ) return;
    return this.#change({ classes: [id, ...this.#spec.classes.slice(1)], ranks: {}, picks: {}, con: null });
  }

  /* -------------------------------------------- */

  /**
   * The unit promotes into a class: it joins the unit's line, and the unit is of the Level that class starts at.
   * @this {NpcBuilder}
   */
  static #onPromote(event, target) {
    const entry = this.#library?.byId.get(target.dataset.classId);
    if ( !entry ) return;
    const level = FEO.classTiers[entry.tier]?.startLevel ?? (this.#spec.level + 1);
    return this.#change({ classes: [...this.#spec.classes, entry.id], level: Math.max(level, this.#spec.level) });
  }

  /* -------------------------------------------- */

  /**
   * Set the unit's Level. Below the Levels of its class, it is of the class it was promoted from again; above
   * them it goes no further than the last Level before that class promotes, which takes a class to promote into.
   * @param {number} level
   * @returns {Promise<any>|void}
   */
  #setLevel(level) {
    if ( !this.#library ) return;
    let line = lineOf(this.#library, this.#spec);
    if ( !line.length ) return;
    while ( (line.length > 1) && (level < levelSpan(line).from) ) line = line.slice(0, -1);
    const span = levelSpan(line);
    return this.#change({ classes: line.map((cls) => cls.id), level: Math.min(Math.max(level, 1), span.to) });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onLevel(event, target) {
    return this.#setLevel(this.#spec.level + (Number(target.dataset.by) || 0));
  }

  /**
   * @this {NpcBuilder}
   */
  static #onMatchParty() {
    if ( Number.isFinite(this.#for.partyLevel) ) return this.#setLevel(this.#for.partyLevel);
  }

  /* -------------------------------------------- */
  /*  Side and Stats                              */
  /* -------------------------------------------- */

  /**
   * @this {NpcBuilder}
   */
  static #onSide(event, target) {
    return this.#change({ side: target.dataset.side });
  }

  /**
   * A mark was switched: Boss, or Recruitable.
   * @this {NpcBuilder}
   */
  static #onFlag(event, target) {
    const flag = target.dataset.flag;
    if ( !["boss", "recruit"].includes(flag) ) return;
    return this.#change({ [flag]: !this.#spec[flag] });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onVary() {
    return this.#change({ vary: !this.#spec.vary });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onMode(event, target) {
    return this.#change({ mode: target.dataset.mode });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onReroll() {
    return this.#change({ mode: "rolled", seed: newSeed() });
  }

  /**
   * A stat was raised or lowered by hand.
   * @this {NpcBuilder}
   */
  static #onAdjust(event, target) {
    const key = target.dataset.stat;
    const by = Number(target.dataset.by) || 0;
    return this.#change({ adjust: { ...this.#spec.adjust, [key]: (this.#spec.adjust[key] ?? 0) + by } });
  }

  /**
   * The CON of a unit whose class leaves it open was set.
   * @this {NpcBuilder}
   */
  static #onCon(event, target) {
    const now = this.#spec.con ?? FEO.npc.con;
    return this.#change({ con: Math.max(now + (Number(target.dataset.by) || 0), 0) });
  }

  /* -------------------------------------------- */
  /*  Weapons and Items                           */
  /* -------------------------------------------- */

  /**
   * A weapon rank was raised by a step: past the highest it starts again at the lowest that is a rank at all.
   * @this {NpcBuilder}
   */
  static #onRank(event, target) {
    const key = target.dataset.proficiency;
    const order = Object.keys(FEO.ranks);
    const now = this.#view?.build.unit.proficiencies[key]?.rank;
    if ( !now ) return;
    const next = order[order.indexOf(now) + 1] ?? order[1];
    return this.#change({ ranks: { ...this.#spec.ranks, [key]: next } });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onEquip(event, target) {
    const index = Number(target.dataset.index);
    return this.#change({ pack: this.#spec.pack.map((row, at) => ({ ...row, equipped: at === index })) });
  }

  /**
   * Whom something the unit carries is left for was changed: nobody, the players, anyone.
   * @this {NpcBuilder}
   */
  static #onDrop(event, target) {
    const index = Number(target.dataset.index);
    const drops = FEO.npc.drops;
    return this.#change({
      pack: this.#spec.pack.map((row, at) => ((at === index) ? { ...row, drop: drops[(drops.indexOf(row.drop) + 1) % drops.length] } : row))
    });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onUnpack(event, target) {
    const index = Number(target.dataset.index);
    return this.#change({ pack: this.#spec.pack.filter((row, at) => at !== index) });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onKit() {
    if ( !this.#library ) return;
    const pack = kitFor(this.#spec, this.#library);
    return this.#change({ pack }, pack.length ? "" : game.i18n.localize("FEO.Npc.pack.noKit"));
  }

  /* -------------------------------------------- */

  /**
   * Open the Compendium at the armoury, with a button on each row that has the unit carry it.
   * @this {NpcBuilder}
   */
  static #onChooseGear() {
    const i18n = game.i18n;
    const describe = (entry) => {
      const weapon = "category" in entry;
      const unit = this.#view?.build.unit ?? null;
      const fit = !weapon || !unit || wields(unit, entry);
      return { sold: !!entry.uuid && !isBroken(entry), can: true, fit, unfit: fit ? "" : i18n.localize("FEO.Npc.pack.unfit") };
    };
    const choose = async (entry) => {
      const weapon = "category" in entry;
      const armed = this.#spec.pack.some((row) => row.type === "weapon");
      await this.#change({
        pack: [...this.#spec.pack, { uuid: entry.uuid, name: entry.name, type: weapon ? "weapon" : "gear", drop: "", equipped: weapon && !armed }]
      });
    };
    const banner = () => {
      const view = this.#view;
      const tags = [];
      if ( view?.build.ranks.length ) {
        tags.push({
          label: i18n.localize("FEO.Npc.armoury.wields"),
          value: view.build.ranks.map((rank) => `${i18n.localize(FEO.proficiencies[rank.key])} ${i18n.localize(FEO.ranks[rank.rank])}`).join(" · ")
        });
      }
      if ( this.#spec.pack.length ) tags.push({ label: i18n.localize("FEO.Npc.armoury.carries"), value: this.#spec.pack.map((row) => row.name).join(", ") });
      return {
        text: i18n.format("FEO.Npc.armoury.banner", { unit: this.#unitName }),
        tags,
        note: i18n.localize("FEO.Npc.armoury.note"),
        button: i18n.localize("FEO.Npc.armoury.button")
      };
    };
    return Compendium.open({ view: "equipment", tab: "weapons", chooser: { takes: "equipment", actor: null, describe, choose, banner } });
  }

  /** What the unit is called for now. */
  get #unitName() {
    return this.#spec.name || this.#view?.build.className || game.i18n.localize("FEO.Npc.unnamed");
  }

  /* -------------------------------------------- */
  /*  Skills                                      */
  /* -------------------------------------------- */

  /**
   * Another of the skills a class offers a choice between was picked: the next one it lists.
   * @this {NpcBuilder}
   */
  static #onNextSkill(event, target) {
    const choice = target.dataset.choice;
    const skill = this.#view?.build.skills.find((other) => other.choice === choice);
    if ( !skill?.options?.length ) return;
    const next = skill.options[(skill.options.indexOf(skill.name) + 1) % skill.options.length];
    return this.#change({ picks: { ...this.#spec.picks, [choice]: next } });
  }

  /**
   * A skill the Game Master gave the unit was taken away again.
   * @this {NpcBuilder}
   */
  static #onUnskill(event, target) {
    const name = String(target.dataset.name ?? "").toLowerCase();
    if ( target.dataset.kind === "generic" ) return this.#change({ generic: "" });
    return this.#change({ extras: this.#spec.extras.filter((other) => other.toLowerCase() !== name) });
  }

  /* -------------------------------------------- */

  /**
   * Open the Compendium at the roll of skills, with a button on its skill sheet that gives the skill to the unit:
   * as its Generic Skill, of which it has one, or as one more that the Game Master gives it.
   * @param {"generic"|"extra"} kind
   * @returns {Promise<Compendium>}
   */
  #openSkills(kind) {
    const i18n = game.i18n;
    const generic = kind === "generic";
    const describe = (skill, library) => {
      if ( !skill ) return { can: false, text: "" };
      const view = this.#view;
      const name = skill.name.toLowerCase();
      const mine = this.#spec.generic.toLowerCase();
      if ( generic && (skill.kind !== "generic") ) return { can: false, barred: true, text: i18n.localize("FEO.Npc.roll.notGeneric") };
      if ( generic && (mine === name) ) return { can: false, chosen: true, text: i18n.localize("FEO.Npc.roll.chosen") };
      const owned = (view?.build.skills ?? []).map((other) => other.name);
      if ( owned.some((other) => other.toLowerCase() === name) ) return { can: false, chosen: true, text: i18n.localize("FEO.Npc.roll.owned") };

      // The Game Master may give a unit a skill it could not come by: one whose prerequisite it does not meet
      // is marked, and can be taken all the same
      const need = view ? readPrerequisite(skill.prerequisite, {
        unit: view.build.unit,
        cls: view.build.classes.at(-1),
        isSkill: (other) => !!findSkill(library, other),
        owned
      }) : { state: "none", text: "" };
      const unmet = need.state === "unmet";
      return {
        can: true,
        barred: unmet,
        text: unmet ? i18n.format("FEO.Npc.roll.unmet", { what: need.text.replace(/\.$/, "") })
          : i18n.localize((generic && mine) ? "FEO.Npc.roll.change" : "FEO.Npc.roll.take"),
        label: i18n.format("FEO.Npc.roll.choose", { name: skill.name })
      };
    };
    const choose = (skill) => (generic
      ? this.#change({ generic: skill.name })
      : this.#change({ extras: [...this.#spec.extras, skill.name] }));
    const banner = () => ({
      text: i18n.format(generic ? "FEO.Npc.roll.bannerGeneric" : "FEO.Npc.roll.bannerExtra", { unit: this.#unitName }),
      tags: (generic && this.#spec.generic) ? [{ label: i18n.localize("FEO.Npc.roll.has"), value: this.#spec.generic }] : [],
      note: i18n.localize(generic ? "FEO.Npc.roll.noteGeneric" : "FEO.Npc.roll.noteExtra")
    });
    return Compendium.open({
      view: "skills",
      kind: generic ? "generic" : "enemy",
      skill: generic ? (this.#spec.generic || undefined) : undefined,
      chooser: { takes: "skill", actor: null, describe, choose, banner }
    });
  }

  /**
   * @this {NpcBuilder}
   */
  static #onChooseGeneric() {
    return this.#openSkills("generic");
  }

  /**
   * @this {NpcBuilder}
   */
  static #onChooseExtra() {
    return this.#openSkills("extra");
  }

  /* -------------------------------------------- */
  /*  Saving                                      */
  /* -------------------------------------------- */

  /**
   * @this {NpcBuilder}
   */
  static #onOpenSheet() {
    this.#actor?.sheet?.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Save the unit, and tell whoever it was made for.
   * @this {NpcBuilder}
   */
  static async #onSave() {
    if ( this.#busy || !this.#library ) return;
    this.#busy = true;
    try {
      const fresh = !this.#actor;
      const actor = await saveNpc(this.#spec, { actor: this.#actor, library: this.#library });
      if ( !actor ) return;
      this.#actor = actor;
      this.#say = game.i18n.format(fresh ? "FEO.Npc.foot.created" : "FEO.Npc.foot.updated", { name: actor.name });
      await this.#for.done?.(actor);
      await this.render();
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    } finally {
      this.#busy = false;
    }
  }
}

import { FEO } from "../config.mjs";
import { bonusLabel, gambitReading } from "../helpers/battalion-context.mjs";
import { growthPickFields } from "../helpers/earnings-context.mjs";
import { postItem } from "../helpers/items.mjs";
import { addModeToggle, setModeToggle } from "../helpers/mode-toggle.mjs";
import { bonusAt, bonusKeys } from "../rules/battalions.mjs";
import { growthChoice } from "../rules/earnings.mjs";
import { activationOf, checkEffects, choicesOf, rolledProc } from "../rules/skills.mjs";
import { buildClassContext } from "./class-context.mjs";
import { artReading, basisLabel, buildItemView } from "./item-view.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * The sheet for every Item type in the system. An item is read on one panel that every type shares, and edited
 * on a template of its type's own; the switch in the window header goes from one to the other.
 */
export default class FeoItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["feo", "item-sheet"],
    position: { width: 540, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleMode: FeoItemSheet.#onToggleMode,
      postItem: FeoItemSheet.#onPostItem,
      addPromotion: FeoItemSheet.#onAddPromotion,
      removePromotion: FeoItemSheet.#onRemovePromotion,
      openPromotion: FeoItemSheet.#onOpenPromotion,
      addNote: FeoItemSheet.#onAddNote,
      removeNote: FeoItemSheet.#onRemoveNote
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `systems/${FEO.id}/templates/item/weapon-sheet.hbs`, scrollable: [""] }
  };

  /* -------------------------------------------- */

  /**
   * The modes a sheet can be in. View mode shows the item to be read; Edit mode shows its fields.
   * @enum {string}
   */
  static MODES = Object.freeze({ VIEW: "view", EDIT: "edit" });

  /**
   * The mode chosen with the header switch, or null until one is needed.
   * @type {string|null}
   */
  #mode = null;

  /* -------------------------------------------- */

  /**
   * The current mode of the sheet. An item that has not been filled in yet opens in Edit mode, and one that
   * cannot be changed is only ever read.
   * @type {string}
   */
  get mode() {
    const { VIEW, EDIT } = FeoItemSheet.MODES;
    if ( !this.isEditable ) return VIEW;
    this.#mode ??= this.#isBlank() ? EDIT : VIEW;
    return this.#mode;
  }

  /* -------------------------------------------- */

  /**
   * Is the item still as it was made, with nothing to read on it?
   * @returns {boolean}
   */
  #isBlank() {
    const system = this.item.system;
    if ( system.description || system.effect ) return false;
    switch ( this.item.type ) {
      case "weapon": return !system.might && !system.hit && !system.uses.max;
      case "skill": return !system.effects.length && !system.prerequisite;
      case "art": return !system.cost;
      case "battalion": return !system.hp.max && !system.gambit.name && !system.gambit.effect;
      case "class": return !system.promotesTo.length && !Object.values(system.skills).some(Boolean)
        && FEO.classStats.every((key) => (system.base[key] === null) && !system.gains[key]);
      default: return !system.cost && !system.restore;
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    if ( this.isEditable ) addModeToggle(frame);

    // Anyone who can read the item can show it to the table, from beside the window's own buttons
    const post = document.createElement("button");
    post.type = "button";
    post.className = "header-control icon fa-solid fa-comment";
    post.dataset.action = "postItem";
    post.dataset.tooltip = game.i18n.localize("FEO.Item.post");
    post.setAttribute("aria-label", post.dataset.tooltip);
    frame.querySelector('.window-header [data-action="toggleControls"]')?.insertAdjacentElement("beforebegin", post);
    return frame;
  }

  /* -------------------------------------------- */

  /**
   * Show the item to the table as a card in the chat. Nothing of it is used.
   * @this {FeoItemSheet}
   */
  static async #onPostItem() {
    await postItem(this.item);
  }

  /* -------------------------------------------- */

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const template = this.mode === FeoItemSheet.MODES.EDIT ? `${this.item.type}-sheet` : "item-view";
    parts.body.template = `systems/${FEO.id}/templates/item/${template}.hbs`;
    return parts;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const system = item.system;
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const labels = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, value.label]));

    Object.assign(context, {
      item,
      system,
      systemFields: system.schema.fields,
      config: FEO,
      icon: item.type === "weapon" ? (FEO.categoryIcons[system.category] ?? "sword")
        : item.type === "skill" ? "spark" : item.type === "class" ? "banner" : item.type === "art" ? "crossed"
          : item.type === "battalion" ? "company" : "flask",
      descriptionHTML: await TextEditor.enrichHTML(system.description, {
        secrets: item.isOwner,
        relativeTo: item,
        rollData: item.getRollData()
      })
    });

    // Read, the item is one panel of display data; the rest is for its fields
    if ( this.mode !== FeoItemSheet.MODES.EDIT ) {
      context.view = buildItemView(item, game.i18n, { description: context.descriptionHTML });
      return context;
    }

    if ( item.type === "weapon" ) context.categories = labels(FEO.weaponCategories);
    if ( item.type === "skill" ) {
      context.statBoosts = Object.entries(FEO.stats).map(([key, config]) => ({
        key,
        label: config.abbr,
        value: system.stats[key]
      }));
      context.combatBoosts = Object.entries(FEO.combatBoosts).map(([key, label]) => ({
        key,
        label,
        value: system.combat[key]
      }));
      context.chance = system.chance;

      // Where the world plays with Alternate Skill Activation, what the chance is read from in place of what
      // is entered here
      const proc = rolledProc(system);
      const basis = proc ? activationOf(proc) : null;
      context.activationNote = basis?.changed
        ? game.i18n.format("FEO.Optional.alternateActivation.note", { basis: basisLabel(basis, game.i18n) })
        : "";

      // What the system applies by itself: the variants on offer and the effects in their own notation
      const choices = choicesOf(system.effects);
      context.choices = choices.length ? Object.fromEntries(choices.map((choice) => [choice, choice])) : null;

      // A skill that raises growth rates of its unit's picking offers a field for each
      context.picks = growthPickFields(system.effects, system.choice);

      // Anything else a skill has its unit pick is shown as it is written, for the Game Master to put right
      context.pickText = (system.picks?.length > 0) && !context.choices && !context.picks;
      context.effectCount = system.effects.length;
      context.effectsJson = JSON.stringify(system.effects, null, 2);
    }
    if ( item.type === "class" ) Object.assign(context, buildClassContext(item));

    // A Combat Art: the kinds and Ranks there are, and what the system reads from the Effect as it is written
    if ( item.type === "art" ) {
      const arts = FEO.optional.combatArts;
      context.artTypes = arts.types;
      context.artRanks = Object.fromEntries(arts.ranks.map((rank) => [rank, FEO.ranks[rank]]));
      context.reading = artReading(system, game.i18n);
      context.effectCount = system.effects.length;
      context.effectsJson = JSON.stringify(system.effects, null, 2);
    }

    // A Battalion: the Authority ranks it can ask for, each bonus with what it comes to at the Battalion's
    // level, and what the system reads from its Gambit's Effect as it is written
    if ( item.type === "battalion" ) {
      const battalions = FEO.optional.battalions;
      context.battalionRanks = Object.fromEntries(battalions.ranks.map((rank) => [rank, FEO.ranks[rank]]));
      context.gambitKinds = battalions.gambit.kinds;
      context.levels = battalions.levels;
      context.bonuses = bonusKeys().map((key) => ({
        key,
        label: bonusLabel(key),
        base: system.bonuses[key].base,
        perLevel: system.bonuses[key].perLevel,
        now: bonusAt(system.bonuses[key], system.level)
      }));
      context.reading = gambitReading(system.reading, game.i18n);
    }
    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const edit = this.mode === FeoItemSheet.MODES.EDIT;
    this.element.classList.toggle("mode-edit", edit);
    this.element.classList.toggle("mode-view", !edit);
    setModeToggle(this.element, edit, edit ? "FEO.Mode.itemEdit" : "FEO.Mode.itemView");
  }

  /* -------------------------------------------- */

  /**
   * Switch between reading the item and editing it.
   * @this {FeoItemSheet}
   */
  static async #onToggleMode() {
    const { VIEW, EDIT } = FeoItemSheet.MODES;
    this.#mode = this.mode === EDIT ? VIEW : EDIT;
    await this.render();
  }

  /* -------------------------------------------- */

  /** @override */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);

    // The effects of a skill or a Combat Art are typed as a list in the system's notation, and only saved
    // when the rules know every part of it
    if ( ["skill", "art"].includes(this.item.type) && ("effectsJson" in data) ) {
      let effects;
      let problem = null;
      try {
        effects = JSON.parse(data.effectsJson || "[]");
        problem = checkEffects(effects)[0] ?? null;
      } catch(err) {
        problem = err.message;
      }
      delete data.effectsJson;
      if ( problem ) ui.notifications.warn(game.i18n.format("FEO.Skill.effectsBad", { problem }));
      else foundry.utils.setProperty(data, "system.effects", effects);
    }

    // The growth rates picked for a skill are kept as its choice
    if ( (this.item.type === "skill") && ("picks" in data) ) {
      foundry.utils.setProperty(data, "system.choice", growthChoice(Object.values(data.picks ?? {})));
      delete data.picks;
    }
    if ( this.item.type !== "class" ) return data;
    const system = data.system ?? {};

    // Ticked proficiencies arrive as a list with a gap for each box left empty
    const options = system.proficiencies?.options;
    if ( options !== undefined ) system.proficiencies.options = [options].flat().filter(Boolean);

    // Rows of a list arrive keyed by their position
    for ( const key of ["promotesTo", "notes"] ) {
      if ( system[key] ) system[key] = Object.values(system[key]);
    }
    return data;
  }

  /* -------------------------------------------- */
  /*  Classes                                     */
  /* -------------------------------------------- */

  /**
   * A class dropped on a class's sheet is added to the classes it promotes to, as a link.
   * @override
   */
  async _onDropDocument(event, document) {
    const item = this.item;
    if ( (item.type !== "class") || (document.documentName !== "Item") || (document.type !== "class") ) {
      return super._onDropDocument(event, document);
    }
    if ( document.uuid === item.uuid ) return null;
    const targets = foundry.utils.deepClone(item._source.system.promotesTo);
    const named = targets.find((target) => !target.uuid && (target.name.toLowerCase() === document.name.toLowerCase()));
    if ( targets.some((target) => target.uuid === document.uuid) ) return null;
    if ( named ) named.uuid = document.uuid;
    else targets.push({ name: document.name, uuid: document.uuid });
    await item.update({ "system.promotesTo": targets });
    return document;
  }

  /* -------------------------------------------- */

  /**
   * Add or remove a row of one of a class's lists.
   * @param {"promotesTo"|"notes"} key
   * @param {object|null} row           The row to add, or null to remove the one the target belongs to
   * @param {HTMLElement} [target]
   */
  async #editList(key, row, target) {
    const list = foundry.utils.deepClone(this.item._source.system[key]);
    if ( row ) list.push(row);
    else list.splice(Number(target.closest("[data-index]").dataset.index), 1);
    await this.item.update({ [`system.${key}`]: list });
  }

  /* -------------------------------------------- */

  /**
   * Add a blank class to promote to.
   * @this {FeoItemSheet}
   */
  static async #onAddPromotion() {
    await this.#editList("promotesTo", { name: "", uuid: "" });
  }

  /* -------------------------------------------- */

  /**
   * Remove a class from those this one promotes to.
   * @this {FeoItemSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemovePromotion(event, target) {
    await this.#editList("promotesTo", null, target);
  }

  /* -------------------------------------------- */

  /**
   * Open the sheet of a linked class.
   * @this {FeoItemSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenPromotion(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    const linked = await foundry.utils.fromUuid(this.item.system.promotesTo[index]?.uuid);
    if ( linked ) linked.sheet.render({ force: true });
    else ui.notifications.warn("FEO.Class.warn.linkBroken", { localize: true });
  }

  /* -------------------------------------------- */

  /**
   * Add a blank line to the class's other lines.
   * @this {FeoItemSheet}
   */
  static async #onAddNote() {
    await this.#editList("notes", { label: "", value: "" });
  }

  /* -------------------------------------------- */

  /**
   * Remove one of the class's other lines.
   * @this {FeoItemSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemoveNote(event, target) {
    await this.#editList("notes", null, target);
  }
}

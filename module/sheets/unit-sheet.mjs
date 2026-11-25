import { FEO } from "../config.mjs";
import { postCard, rollD100 } from "../helpers/chat.mjs";
import { applyLevelGains, assignClass, findPromotions, promoteUnit } from "../helpers/classes.mjs";
import { applyConditionTo, isTracked } from "../helpers/conditions.mjs";
import { setFate, spendRoundFor, treatUnit } from "../helpers/defeat.mjs";
import { armyOf, measureDistance } from "../helpers/exchange.mjs";
import { fightTarget } from "../helpers/fight.mjs";
import { isGripped, takeOutcome } from "../helpers/actions.mjs";
import { growthBar, withoutTaken } from "../helpers/imitation.mjs";
import { movingAgain } from "../helpers/canto.mjs";
import { holdsToWaiting, onlyWaits } from "../helpers/movement.mjs";
import { originOf, takeAction, turnState } from "../helpers/phases.mjs";
import { levelUpSkills, rerollFailed } from "../helpers/earnings.mjs";
import { askPicks, picksOf } from "../helpers/picks.mjs";
import { afflictUnit, awardGold, changeHpByHand, grantUnit, healUnit, pop, selectedOther } from "../helpers/events.mjs";
import { buildLevelUpSplash, showLevelUp } from "../helpers/level-up.mjs";
import { manualLevelUp } from "../helpers/manual-gains.mjs";
import { addModeToggle, setModeToggle } from "../helpers/mode-toggle.mjs";
import { buildSkillCard } from "../helpers/skill-card-context.mjs";
import { addWindowToggle, setWindowToggle } from "../helpers/window-toggle.mjs";
import { growthValue } from "../helpers/earnings-context.mjs";
import { awardExp, earnsExp, expRow, staffExpBy, useExp } from "../helpers/experience.mjs";
import {
  adjustLivesFor, buyPowerFor, promotionLifeUpdate, refundPowerFor, rollCrest, rollMovementStars, sheetOptions
} from "../helpers/optional.mjs";
import {
  heartSealOf, reclassUnit, sealCardsOf
} from "../helpers/reclass.mjs";
import { toggleSealPicker } from "../helpers/seal-picker.mjs";
import { adjustGauge, resetGauge, toggleShift } from "../helpers/shifting.mjs";
import { awardEvent, grantPoints, linkBond, queueRangesFor, reportGains } from "../helpers/supports.mjs";
import { endTurnOf, startTurnOf } from "../helpers/turns.mjs";
import { useSkillMoment, waitFor } from "../helpers/skill-turns.mjs";
import { packBar } from "../helpers/creatures.mjs";
import { castStaffFor, healsMore, staffAreaOf, staffPlanOf, staffTakesOf, staffWhy } from "../helpers/staves.mjs";
import { afterItemHeal, beforeItemHeal, useUpItem } from "../helpers/items.mjs";
import { staffRefreshes } from "../helpers/refresh.mjs";
import { usageRows } from "../helpers/skill-usage-context.mjs";
import { cooldownsFor, switchAffinity } from "../helpers/affinity.mjs";
import { canUse, spendSkill, switchSkill } from "../rules/skill-usage.mjs";
import { learnArt, toggleArt } from "../helpers/arts.mjs";
import { assignBattalion, replenishBattalion, takeBattalion, useGambit } from "../helpers/battalions.mjs";
import { setBreak } from "../helpers/breaking.mjs";
import { setStagger, staggerStops } from "../helpers/stagger.mjs";
import { freeCaptured, pickUpCaptive, releaseCaptive, toggleCapture } from "../helpers/capturing.mjs";
import { skillFits } from "../rules/optional.mjs";
import { countsAsSkill, formsOf, switchForm } from "../rules/skills.mjs";
import { actOf } from "../rules/actions.mjs";
import { stanceGround, statesEntered } from "../rules/stances.mjs";
import { groundUnder } from "../helpers/terrain.mjs";
import { ACT_AFTER_WARP, warpOf } from "../rules/warp.mjs";
import { trapOfItem } from "../rules/traps.mjs";
import { castStaffWarp, staffWarpOf } from "../helpers/warp.mjs";
import { grantedBy } from "../helpers/gear.mjs";
import { isShield, repairItem, sellItem, wieldCheck } from "../helpers/weapons.mjs";
import { guardStanceOf } from "../rules/blocking.mjs";
import { buildChange } from "../rules/timed.mjs";

import { promotesAt } from "../rules/classes.mjs";
import { blocksWeapon } from "../rules/conditions.mjs";
import { gainWexp, wexpProficiencies } from "../rules/combat.mjs";
import { rollGrowths } from "../rules/progression.mjs";
import { cycleRange, startingRank } from "../rules/supports.mjs";
import { grantTimed, removeTimed } from "../helpers/timed.mjs";
import { skillCount } from "../helpers/timed-context.mjs";
import { buildUnitContext } from "./unit-context.mjs";
import { CREATOR_ACTIONS, activateCreator, closeCreator, creatorButton, creatorView, prepareCreator } from "./unit-creator.mjs";

const { DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const TEMPLATES = `systems/${FEO.id}/templates/actor`;

/**
 * The sheet for a Unit.
 */
export default class UnitSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["feo", "unit-sheet"],
    position: { width: 960, height: 830 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleMode: UnitSheet.#onToggleMode,
      toggleMinimize: UnitSheet.#onToggleMinimize,
      adjustHp: UnitSheet.#onAdjustHp,
      giveExp: UnitSheet.#onGiveExp,
      setWounds: UnitSheet.#onSetWounds,
      removeCondition: UnitSheet.#onRemoveCondition,
      toggleBreak: UnitSheet.#onToggleBreak,
      toggleStagger: UnitSheet.#onToggleStagger,
      startTurn: UnitSheet.#onStartTurn,
      endTurn: UnitSheet.#onEndTurn,
      wait: UnitSheet.#onWait,
      switchSkill: UnitSheet.#onSwitchSkill,
      switchAffinity: UnitSheet.#onSwitchAffinity,
      guardStance: UnitSheet.#onGuardStance,
      readyArt: UnitSheet.#onReadyArt,
      assignBattalion: UnitSheet.#onAssignBattalion,
      replenishBattalion: UnitSheet.#onReplenishBattalion,
      takeBattalion: UnitSheet.#onTakeBattalion,
      useGambit: UnitSheet.#onUseGambit,
      learnArt: UnitSheet.#onLearnArt,
      toggleForm: UnitSheet.#onToggleForm,
      createItem: UnitSheet.#onCreateItem,
      editItem: UnitSheet.#onEditItem,
      deleteItem: UnitSheet.#onDeleteItem,
      toggleEquip: UnitSheet.#onToggleEquip,
      pickSkill: UnitSheet.#onPickSkill,
      useItem: UnitSheet.#onUseItem,
      useStaff: UnitSheet.#onUseStaff,
      useSkill: UnitSheet.#onUseSkill,
      postSkill: UnitSheet.#onPostSkill,
      flipSkill: UnitSheet.#onFlipSkill,
      repairItem: UnitSheet.#onRepairItem,
      sellItem: UnitSheet.#onSellItem,
      spendRound: UnitSheet.#onSpendRound,
      setFate: UnitSheet.#onSetFate,
      toggleCapture: UnitSheet.#onToggleCapture,
      pickUpCaptive: UnitSheet.#onPickUpCaptive,
      releaseCaptive: UnitSheet.#onReleaseCaptive,
      freeCaptured: UnitSheet.#onFreeCaptured,
      treat: UnitSheet.#onTreat,
      toggleShift: UnitSheet.#onToggleShift,
      resetGauge: UnitSheet.#onResetGauge,
      adjustGauge: UnitSheet.#onAdjustGauge,
      adjustTransforms: UnitSheet.#onAdjustTransforms,
      toggleBoosted: UnitSheet.#onToggleBoosted,
      autoBond: UnitSheet.#onAutoBond,
      attack: UnitSheet.#onAttack,
      rollCheck: UnitSheet.#onRollCheck,
      levelUp: UnitSheet.#onLevelUp,
      promote: UnitSheet.#onPromote,
      reclass: UnitSheet.#onReclass,
      sealClasses: UnitSheet.#onSealClasses,
      addBond: UnitSheet.#onAddBond,
      deleteBond: UnitSheet.#onDeleteBond,
      removeTimed: UnitSheet.#onRemoveTimed,
      toggleBond: UnitSheet.#onToggleBond,
      adjustLives: UnitSheet.#onAdjustLives,
      rollOptional: UnitSheet.#onRollOptional,
      buyPower: UnitSheet.#onBuyPower,
      refundPower: UnitSheet.#onRefundPower,
      ...CREATOR_ACTIONS
    }
  };

  /** @override */
  static PARTS = {
    rail: { template: `${TEMPLATES}/unit-rail.hbs` },
    creator: { template: `${TEMPLATES}/unit-creator.hbs`, scrollable: [".cr-panel", ".cr-nav"] },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    battle: { template: `${TEMPLATES}/unit-battle.hbs`, scrollable: [""] },
    skills: { template: `${TEMPLATES}/unit-skills.hbs`, scrollable: [""] },
    growth: { template: `${TEMPLATES}/unit-growth.hbs`, scrollable: [""] },
    abilities: { template: `${TEMPLATES}/unit-abilities.hbs`, scrollable: [""] },
    story: { template: `${TEMPLATES}/unit-story.hbs`, scrollable: [""] },
    optional: { template: `${TEMPLATES}/unit-optional.hbs`, scrollable: [""] }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "battle" }, { id: "skills" }, { id: "growth" }, { id: "abilities" }, { id: "story" }, { id: "optional" }
      ],
      initial: "battle",
      labelPrefix: "FEO.Tab"
    }
  };

  /**
   * The modes a sheet can be in. Play mode locks the build of the unit and leaves only what changes during a
   * session editable; Edit mode unlocks everything.
   * @enum {string}
   */
  static MODES = Object.freeze({ PLAY: "play", EDIT: "edit" });

  /**
   * The mode chosen with the header switch, or null until one is needed.
   * @type {string|null}
   */
  #mode = null;

  /**
   * The skills whose cards lie turned over, by id, so that drawing the sheet again leaves them as they lie.
   * @type {Set<string>}
   */
  #flipped = new Set();

  /**
   * Whether the world plays with an Optional Module that has something to fill in on a unit. Those modules
   * have a tab of their own, which a world without them does not see.
   * @type {boolean}
   */
  static get hasOptionalTab() {
    const { lives, movementStars, holyBlood, crests, leadership, levelCap, glory, skillCapacity, stagger, followUpCritical } = FEO.optional;
    return [lives, movementStars, holyBlood, crests, leadership, levelCap, glory, skillCapacity, stagger, followUpCritical].some((module) => module.enabled);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if ( !UnitSheet.hasOptionalTab ) delete parts.optional;
    return parts;
  }

  /* -------------------------------------------- */

  /** @override */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if ( !config || UnitSheet.hasOptionalTab ) return config;
    return { ...config, tabs: config.tabs.filter((tab) => tab.id !== "optional") };
  }

  /* -------------------------------------------- */

  /**
   * The current mode of the sheet. A unit that has not been filled in yet opens in Edit mode.
   * @type {string}
   */
  get mode() {
    const { PLAY, EDIT } = UnitSheet.MODES;
    if ( !this.isEditable ) return PLAY;
    if ( this.#mode === null ) {
      const system = this.actor.system;
      const blank = !system.className && (system.hp.base === 0) && !this.actor.items.size;
      this.#mode = blank ? EDIT : PLAY;
    }
    return this.#mode;
  }

  /* -------------------------------------------- */

  /**
   * Set the mode of the sheet, as finishing a unit in the Character Creator does.
   * @param {string} value    One of UnitSheet.MODES
   */
  set mode(value) {
    if ( Object.values(UnitSheet.MODES).includes(value) ) this.#mode = value;
  }

  /* -------------------------------------------- */

  /**
   * Is the Character Creator open in this window?
   * @type {boolean}
   */
  get creatorOpen() {
    return creatorView(this).open;
  }

  /* -------------------------------------------- */

  /**
   * Which side this unit fights for, which sets the colour of its standard.
   * A side chosen on the sheet wins; otherwise player-owned units are the player side, and the rest follow the
   * disposition of their token.
   * @type {"player"|"enemy"|"ally"|"other"}
   */
  get army() {
    return armyOf(this.actor, this.token);
  }

  /* -------------------------------------------- */

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);

    // A button that folds the window down to its header, beside the one that closes it
    addWindowToggle(frame);
    if ( !this.isEditable ) return frame;

    // A switch in the window header, between the title and the header buttons
    const toggle = addModeToggle(frame);

    // The Character Creator, beside the switch
    toggle.insertAdjacentElement("afterend", creatorButton());
    return frame;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const TextEditor = foundry.applications.ux.TextEditor.implementation;

    // The classes this unit's class promotes to are looked up here, as some may live in a compendium
    const cls = system.classItem;
    const promotions = cls?.system.promotes ? await findPromotions(cls) : [];

    // An encounter counts the turns of the units in it; the others are counted with the buttons on the rail
    const tracked = isTracked(actor);
    const afflicted = Object.keys(system.conditions ?? {}).length > 0;

    // The turn buttons are there for anything the start of a turn counts: conditions, a timer, a gauge, or a
    // skill that waits for the turn or is chosen when to activate, whose cooldowns and uses a turn start
    // counts. The Wait button is there for a unit with a skill that asks for Waiting
    const moments = [...(system.skills?.entries ?? []), ...(system.skills?.auras ?? [])].flatMap((skill) => skill.effects ?? []);
    const waits = moments.some((effect) => (effect.proc?.on === "wait") || (typeof effect.when?.waiting === "boolean"));
    const counted = afflicted || (system.defeat?.state === "incapacitated") || !!system.shift?.mode || system.waiting
      || (system.timed?.length > 0)
      || moments.some((effect) => ["turnStart", "turnEnd"].includes(effect.proc?.on))
      || actor.items.some((item) => (item.type === "skill") && item.system.equipped && item.system.usage?.kind);

    // The cards of its skills lie as they were left
    const unit = buildUnitContext(actor, { promotions, optional: sheetOptions(actor, this.token) });
    // A pick still to be made can be made in either mode; one that is made is changed in Edit mode only
    for ( const skill of unit.skills ?? [] ) {
      skill.flipped = this.#flipped.has(skill.id);
      skill.pickNow = skill.canPick && (skill.needsChoice || (this.mode === UnitSheet.MODES.EDIT));

      // What an equipped skill keeps count of on its unit, as a small number on its card
      const item = skill.equipped ? actor.items.get(skill.id) : null;
      skill.count = item ? skillCount({ name: item.name, effects: item.system.effects }, system.skills?.counts, game.i18n) : null;
    }

    // Heart Seals: the classes the unit can reclass into the lines of, and whether it can do so now. A player
    // spends the Heart Seal the unit carries; the Game Master needs none
    // The closed line names the class in use: the one the unit's line starts in, or else the class it holds.
    // The others are in the menu it opens
    const heartSeals = FEO.optional.heartSeals.enabled ? {
      active: sealCardsOf(actor).find((entry) => entry.starting) ?? (cls ? { name: cls.name, img: cls.img } : null),
      canReclass: !!cls && (game.user.isGM || !!heartSealOf(actor)),
      needsSeal: !!cls && !game.user.isGM && !heartSealOf(actor),
      item: FEO.optional.heartSeals.item
    } : null;

    return Object.assign(context, unit, {
      heartSeals,
      turnControls: this.isEditable && counted && !tracked,
      turnTracked: counted && tracked,
      waitControl: this.isEditable && (waits || system.waiting),
      actor,
      system,
      systemSource: actor._source.system,
      systemFields: system.schema.fields,
      config: FEO,
      editMode: this.mode === UnitSheet.MODES.EDIT,
      creator: await prepareCreator(this),
      biographyHTML: await TextEditor.enrichHTML(system.biography, {
        secrets: actor.isOwner,
        relativeTo: actor,
        rollData: actor.getRollData()
      })
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if ( context.tabs && (partId in context.tabs) ) context.tab = context.tabs[partId];
    return context;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const edit = this.mode === UnitSheet.MODES.EDIT;
    this.element.dataset.army = this.army;
    this.element.classList.toggle("mode-edit", edit);
    this.element.classList.toggle("mode-play", !edit);

    // The Character Creator: its header button, and the window while it is open
    activateCreator(this, context);

    setModeToggle(this.element, edit, edit ? "FEO.Mode.edit" : "FEO.Mode.play");

    // Play mode locks every field except those that change during a session
    if ( !edit && this.isEditable ) {
      for ( const field of this.element.querySelectorAll(".window-content :is(input, select, textarea)[name]") ) {
        if ( !("play" in field.dataset) ) field.disabled = true;
      }
    }

    // Adding a condition is a menu, not a form field, so it is handled here rather than on submit
    const select = this.element.querySelector("select[data-add-condition]");
    select?.addEventListener("change", (event) => {
      event.stopPropagation();
      const statusId = event.currentTarget.value;
      if ( !statusId ) return;

      // In Edit mode a unit is set up, and the condition is put on it as it is. In Play mode it happens to the
      // unit: its skills may nullify it or hand it back, and it is inflicted by the unit selected on the map
      if ( edit ) return applyConditionTo(this.actor, statusId);
      const by = selectedOther(this.actor);
      return afflictUnit(this.actor, statusId, { by: by?.actor ?? null, byToken: by?.token ?? null, down: true });
    });

    // So is giving a bond the points of something its partners did together
    for ( const menu of this.element.querySelectorAll("select[data-bond-points]") ) {
      menu.addEventListener("change", async (event) => {
        event.stopPropagation();
        const amount = FEO.supports.events[event.currentTarget.value];
        const index = Number(event.currentTarget.closest("[data-bond]").dataset.bond);
        if ( !amount ) return;
        const gains = await grantPoints(this.actor, [index], amount);
        await reportGains(this.actor, gains, { reason: `FEO.Support.event.${event.currentTarget.value}`, all: true });
      });
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onClose(options) {
    super._onClose(options);
    closeCreator(this, { render: false });
  }

  /* -------------------------------------------- */

  /** @override */
  async minimize() {
    const done = super.minimize();
    setWindowToggle(this.element, this.minimized);
    await done;
  }

  /* -------------------------------------------- */

  /** @override */
  async maximize() {
    const done = super.maximize();
    setWindowToggle(this.element, this.minimized);
    await done;
  }

  /* -------------------------------------------- */

  /** @override */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);

    // Form fields for an array arrive keyed by index, and carry only the fields that have inputs
    const bonds = data.system?.bonds;
    if ( bonds ) {
      const current = this.actor._source.system.bonds;
      data.system.bonds = Object.values(bonds).map((bond, index) => {
        const next = { ...current[index], ...bond };

        // A Bond Support starts a rank ahead
        if ( next.kin && !current[index]?.kin ) next.rank = startingRank(true, next.rank);
        return next;
      });
    }
    return data;
  }

  /* -------------------------------------------- */

  /**
   * In Play mode, what is typed into the HP, EXP and gold fields happens to the unit rather than being set:
   * HP that is taken off is damage and HP that is added is healing, EXP that is added is experience the unit
   * is given, which its skills multiply, and gold is given or taken. In Edit mode the fields are saved as they
   * are typed.
   * @override
   */
  async _processSubmitData(event, form, submitData, options = {}) {
    const played = (this.mode !== UnitSheet.MODES.EDIT) ? this.#takePlayed(submitData) : null;

    // What a unit that imitates another has taken on is shown, and is none of its own to save
    withoutTaken(this.actor, submitData);
    const result = await super._processSubmitData(event, form, submitData, options);
    if ( !played ) return result;
    if ( played.hp ) await changeHpByHand(this.actor, played.hp);
    if ( played.exp ) await awardExp(this.actor, played.exp);
    if ( played.gold ) await awardGold(this.actor, played.gold);

    // A field whose change came to nothing shows what the unit has again
    await this.render();
    return result;
  }

  /* -------------------------------------------- */

  /**
   * Take what was typed into the fields that happen to a unit out of what the form is about to save.
   * @param {object} submitData     What the form is about to save, which is changed in place
   * @returns {{hp?: number, exp?: number, gold?: number}|null}     What each changes by; null when none does
   */
  #takePlayed(submitData) {
    const system = this.actor.system;
    const played = {};
    const take = (key, path, current, { raise = false } = {}) => {
      const typed = foundry.utils.getProperty(submitData, path);
      if ( !Number.isFinite(typed) || (typed === current) || (raise && (typed < current)) ) return;
      const parts = path.split(".");
      const last = parts.pop();
      delete foundry.utils.getProperty(submitData, parts.join("."))[last];
      played[key] = typed - current;
    };
    take("hp", "system.hp.value", system.hp.value);

    // EXP that is lowered is a correction, and is saved as it is typed
    take("exp", "system.exp", system.exp, { raise: true });
    take("gold", "system.gold", system.gold ?? 0);
    return Object.keys(played).length ? played : null;
  }

  /* -------------------------------------------- */

  /**
   * Another unit dropped on the sheet becomes a support partner, linked to its Actor.
   * @override
   */
  async _onDropActor(event, actor) {
    if ( !this.actor.isOwner || (actor?.type !== "unit") ) return null;
    const linked = await linkBond(this.actor, actor);
    if ( !linked ) ui.notifications.info("FEO.Bond.alreadyLinked", { localize: true });
    return linked ? actor : null;
  }

  /* -------------------------------------------- */

  /**
   * The token this unit acts from: the one the sheet was opened from, else one that is selected, else any.
   * @type {TokenDocument|null}
   */
  get activeToken() {
    const tokens = this.actor.getActiveTokens(false, true);
    return this.token ?? tokens.find((candidate) => candidate.object?.controlled) ?? tokens[0] ?? null;
  }

  /* -------------------------------------------- */

  /**
   * The one other unit the user has targeted, if there is exactly one.
   * @type {Token|null}
   */
  get targetedUnit() {
    const targets = Array.from(game.user.targets).filter((target) => {
      return (target.actor?.type === "unit") && (target.actor !== this.actor);
    });
    return targets.length === 1 ? targets[0] : null;
  }

  /* -------------------------------------------- */

  /**
   * Every other unit the user has targeted, for what is used on several units at once.
   * @type {Token[]}
   */
  get targetedUnits() {
    return Array.from(game.user.targets).filter((target) => {
      return (target.actor?.type === "unit") && (target.actor !== this.actor);
    });
  }

  /* -------------------------------------------- */

  /**
   * A class dropped on the sheet becomes the unit's class; anything else is added as usual.
   * @override
   */
  async _onDropItem(event, item) {
    // A weapon a creature was handed changes hands in no way, and nothing is traded with a pack that is locked
    if ( ["weapon", "gear"].includes(item.type) && (item.parent !== this.actor) ) {
      const from = (item.parent?.documentName === "Actor") ? item.parent : null;
      const bar = (from ? packBar(from, item) : null) ?? (game.user.isGM ? null : packBar(this.actor));
      if ( bar ) {
        ui.notifications.warn(game.i18n.format(bar, { item: item.name, name: (from && packBar(from, item)) ? from.name : this.actor.name }));
        return null;
      }
    }
    if ( item.type !== "class" ) return super._onDropItem(event, item);
    if ( !this.actor.isOwner ) return null;
    const change = await assignClass(this.actor, item);
    return change ? item : null;
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * Find the owned Item that an action target belongs to.
   * @param {HTMLElement} target
   * @returns {Item|undefined}
   */
  #getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  /* -------------------------------------------- */
  /*  Mode                                        */
  /* -------------------------------------------- */

  /**
   * Switch between Play and Edit mode.
   * @this {UnitSheet}
   */
  static async #onToggleMode() {
    const { PLAY, EDIT } = UnitSheet.MODES;
    this.#mode = this.mode === EDIT ? PLAY : EDIT;
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Fold the window down to its header, or open it out again.
   * @this {UnitSheet}
   */
  static async #onToggleMinimize() {
    if ( this.minimized ) await this.maximize();
    else await this.minimize();
  }

  /* -------------------------------------------- */
  /*  Vitals                                      */
  /* -------------------------------------------- */

  /**
   * Raise or lower current HP by a fixed amount. In Play mode that is healing, or damage dealt by the unit
   * selected on the map; in Edit mode the number is set as it is.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAdjustHp(event, target) {
    const { value, max } = this.actor.system.hp;
    const next = Math.min(Math.max(value + Number(target.dataset.delta), 0), max);
    if ( next === value ) return;
    if ( this.mode === UnitSheet.MODES.EDIT ) await this.actor.update({ "system.hp.value": next });
    else await changeHpByHand(this.actor, next - value);
  }

  /* -------------------------------------------- */

  /**
   * Give the unit experience by hand: an amount, and whether it is Bonus EXP. Its skills, and those of the
   * units around it, multiply what it is given.
   * @this {UnitSheet}
   */
  static async #onGiveExp() {
    const i18n = game.i18n;
    const content = document.createElement("div");
    content.innerHTML = `
      <div class="form-group">
        <label>${i18n.localize("FEO.Exp.giveAmount")}</label>
        <input type="number" name="amount" value="10" min="1" step="1" autofocus>
      </div>
      <div class="form-group" data-tooltip="${i18n.localize("FEO.Exp.giveBonusHint")}">
        <label>${i18n.localize("FEO.Exp.giveBonus")}</label>
        <input type="checkbox" name="bonus">
      </div>`;
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n.format("FEO.Exp.giveTitle", { name: this.actor.name }) },
      position: { width: 340 },
      content,
      buttons: [
        { action: "give", label: "FEO.Exp.give", icon: "fa-solid fa-star", default: true,
          callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        { action: "cancel", label: "COMMON.Cancel" }
      ],
      rejectClose: false
    });
    const amount = Math.floor(Number(answer?.amount));
    if ( !answer || (answer === "cancel") || !(amount > 0) ) return;
    await awardExp(this.actor, amount, { bonus: !!answer.bonus });
  }

  /* -------------------------------------------- */

  /**
   * Set the number of Wounds counted toward the next Grave Wound by clicking a pip.
   * Clicking the last filled pip clears it.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSetWounds(event, target) {
    const perGrave = FEO.woundsPerGraveWound;
    const wounds = this.actor.system.wounds;
    const whole = wounds - (wounds % perGrave);
    const clicked = Number(target.dataset.number);
    const partial = (wounds % perGrave) === clicked ? clicked - 1 : clicked;
    await this.actor.update({ "system.wounds": whole + partial });
  }

  /* -------------------------------------------- */

  /**
   * Remove a condition from the unit.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemoveCondition(event, target) {
    await this.actor.effects.get(target.dataset.effectId)?.delete();
  }

  /* -------------------------------------------- */

  /**
   * Rid the unit of Break by hand, or mark it as suffering from it.
   * @this {UnitSheet}
   */
  static async #onToggleBreak() {
    await setBreak(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Have a Staggered unit recover by hand, or Stagger it.
   * @this {UnitSheet}
   */
  static async #onToggleStagger() {
    await setStagger(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Start this unit's turn by hand, for tables that do not run the combat tracker: its conditions deal their
   * damage and lose a turn.
   * @this {UnitSheet}
   */
  static async #onStartTurn() {
    await startTurnOf(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * End this unit's turn by hand: conditions in their last turn end.
   * @this {UnitSheet}
   */
  static async #onEndTurn() {
    await endTurnOf(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Is this unit left with nothing to do but Wait, as one that has Run is? It is told so.
   * @returns {boolean}
   */
  #waitStops() {
    // So is one that has taken its Action and is only moving again, as Canto lets it
    if ( turnState(this.actor, this.activeToken) === "moving" ) {
      ui.notifications.warn("FEO.Canto.only", { localize: true });
      return true;
    }
    // And one that another unit has hold of, which may only try to break free
    if ( isGripped(this.actor) ) {
      ui.notifications.warn("FEO.Grip.cannotAct", { localize: true });
      return true;
    }
    if ( !onlyWaits(this.actor, this.activeToken) ) return false;
    ui.notifications.warn("FEO.Wait.only", { localize: true });
    return true;
  }

  /* -------------------------------------------- */

  /**
   * This unit Waits: its skills that act on Waiting take effect, some until its next turn starts.
   * @this {UnitSheet}
   */
  static async #onWait() {
    // A unit that has acted and could still move, as Canto lets it, only ends its turn: it has not Waited
    if ( turnState(this.actor, this.activeToken) === "moving" ) {
      await takeAction(this.actor, this.activeToken);
      return;
    }
    await waitFor(this.actor);
    await takeAction(this.actor, this.activeToken, { action: { kind: "wait" } });
  }

  /* -------------------------------------------- */

  /**
   * Switch a skill that is chosen when to activate on or off: declare it for the unit's next fight, or turn a
   * skill that stays on until it is turned off.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSwitchSkill(event, target) {
    const item = this.#getItem(target);
    if ( (item?.type !== "skill") || !item.system.usage?.kind ) return;
    const result = switchSkill(item.system.usage, item.system.state);
    if ( !result.ok ) {
      ui.notifications.warn(game.i18n.format(`FEO.Usage.blocked.${result.reason}`, { skill: item.name }));
      return;
    }

    // A skill that holds its unit to Waiting stays on once it has: the move it made possible is taken back first
    if ( item.system.state?.active && !result.state.active && holdsToWaiting(item) && onlyWaits(this.actor, this.activeToken) ) {
      ui.notifications.warn(game.i18n.format("FEO.Wait.held", { skill: item.name }));
      return;
    }

    // A skill that casts a weapon it lends its unit has that weapon picked as it is switched on (see
    // `rules/lending.mjs`): with none to pick, or none picked, it stays off
    if ( !item.system.state?.active && result.state.active ) {
      const { castsOf, pickCast } = await import("../helpers/lending.mjs");
      const casts = castsOf(item);
      if ( casts && !casts.arms.length ) {
        ui.notifications.warn(game.i18n.format("FEO.Lend.noCast", { skill: item.name }));
        return;
      }
      if ( casts ) {
        const picked = await pickCast(item);
        if ( !picked ) return;
        pop(this.actor, [{ text: game.i18n.format("FEO.Lend.cast", { skill: item.name, weapon: picked }), tone: "skill" }]);
      }
    }
    await item.update({ "system.state": result.state });
  }

  /* -------------------------------------------- */

  /**
   * Switch the unit's Affinity on or off, for one its unit chooses when to use: Anima for its next fight, Wood
   * and Breath for its next move, Muscle for its next Shove.
   * @this {UnitSheet}
   */
  static async #onSwitchAffinity() {
    await switchAffinity(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Take up a guard with the weapon in hand as the unit's Action, as Weapon Guard lets it: until its next turn
   * starts the unit blocks at a higher chance, whether or not the skill is switched on, and makes no
   * counter-attack.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onGuardStance(event, target) {
    const item = this.#getItem(target);
    const guard = (item?.type === "skill") ? guardStanceOf(item.system) : null;
    if ( !guard || (this.mode === UnitSheet.MODES.EDIT) ) return;
    const actor = this.actor;
    const token = this.activeToken;
    if ( staggerStops(actor) || this.#waitStops() ) return;
    if ( token && (turnState(actor, token) !== "ready") && (turnState(actor, token) !== "free") ) return;
    const { stance, ...own } = guard;
    const given = await grantUnit(actor, [buildChange({
      name: item.name,
      effects: [{ block: { guard: own, chance: stance, kind: "weapon" }, rules: ["noCounter"] }],

      ends: "turnStart"
    }, { skill: item.name, own: true })]);
    if ( !given?.length ) return;
    pop(actor, [{ text: item.name, tone: "skill" }]);
    await takeAction(actor, token, { action: { kind: "skill", name: item.name } });
  }

  /* -------------------------------------------- */

  /**
   * Learn a Combat Art from the compendium, picked from those the unit's Weapon Ranks allow.
   * @this {UnitSheet}
   */
  static async #onLearnArt() {
    await learnArt(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Ready a Combat Art for the next fight the unit initiates, or put it away again.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onReadyArt(event, target) {
    const item = this.#getItem(target);
    if ( item?.type === "art" ) await toggleArt(item);
  }

  /* -------------------------------------------- */

  /**
   * Assign a Battalion to the unit, or stand it down again. A unit needs the Authority and the Special Quality
   * a Battalion asks for; Edit mode lets it through, with a warning.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAssignBattalion(event, target) {
    const item = this.#getItem(target);
    if ( item?.type === "battalion" ) await assignBattalion(item, { force: this.mode === UnitSheet.MODES.EDIT });
  }

  /* -------------------------------------------- */

  /**
   * Replenish a Battalion, as is done between battles: full HP, and every use of its Gambit back.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onReplenishBattalion(event, target) {
    const item = this.#getItem(target);
    if ( item?.type === "battalion" ) await replenishBattalion(item);
  }

  /* -------------------------------------------- */

  /**
   * Take a Battalion from the compendium, picked from those the unit's Authority lets it command.
   * @this {UnitSheet}
   */
  static async #onTakeBattalion() {
    await takeBattalion(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Use the Gambit of the Battalion the unit commands, on the units that are targeted.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onUseGambit(event, target) {
    const item = this.#getItem(target);
    if ( (item?.type !== "battalion") || !item.system.equipped ) return;
    await useGambit(this.actor, this.activeToken, Array.from(game.user.targets));
  }

  /* -------------------------------------------- */

  /**
   * Take on or put off a Special Quality that a skill lets the unit change at will. The skill's boosts, and
   * everything else that asks for the quality, follow from the unit's Special Qualities.
   * @this {UnitSheet}
   */
  static async #onToggleForm(event, target) {
    const item = this.#getItem(target);
    const form = target.dataset.form;
    if ( (item?.type !== "skill") || !item.system.equipped ) return;
    if ( !formsOf(item.system.effects).some(({ name }) => name === form) ) return;
    await this.actor.update({ "system.specialQualities": switchForm(this.actor.system.specialQualities, form) });
  }

  /* -------------------------------------------- */
  /*  Defeat                                      */
  /* -------------------------------------------- */

  /**
   * An Incapacitated unit gives up a turn of its timer to act or to move half its movement.
   * @this {UnitSheet}
   */
  static async #onSpendRound() {
    await spendRoundFor(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Settle what becomes of the unit: it retreats, is killed, or returns to the party.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSetFate(event, target) {
    await setFate(this.actor, target.dataset.state ?? "");
  }

  /* -------------------------------------------- */

  /**
   * Ready an attempt to capture for the unit's next attack, or put it away again.
   * @this {UnitSheet}
   */
  static async #onToggleCapture() {
    await toggleCapture(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Pick up the unit this one has subdued, which is the unit's Action.
   * @this {UnitSheet}
   */
  static async #onPickUpCaptive() {
    if ( this.#waitStops() ) return;
    if ( await pickUpCaptive(this.actor, this.activeToken) ) await takeAction(this.actor, this.activeToken, { action: { kind: "rescue" } });
  }

  /* -------------------------------------------- */

  /**
   * Let go of the unit's captive, which leaves the battle; a unit it only subdued comes to instead.
   * @this {UnitSheet}
   */
  static async #onReleaseCaptive() {
    await releaseCaptive(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Set this captured unit free: it returns with the HP it had, and whoever held it holds it no longer.
   * @this {UnitSheet}
   */
  static async #onFreeCaptured() {
    await freeCaptured(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Have another unit treat this one's Wounds and Injuries.
   * @this {UnitSheet}
   */
  static async #onTreat() {
    await treatUnit(this.actor);
  }

  /* -------------------------------------------- */
  /*  Changing Form                               */
  /* -------------------------------------------- */

  /**
   * Shift into animal form or back. In Edit mode the gauge is not asked for.
   * @this {UnitSheet}
   */
  static async #onToggleShift() {
    await toggleShift(this.actor, { force: this.mode === UnitSheet.MODES.EDIT });
  }

  /* -------------------------------------------- */

  /**
   * Put the Shift Gauge back to where it starts a map.
   * @this {UnitSheet}
   */
  static async #onResetGauge() {
    await resetGauge(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Raise or lower the Shift Gauge by a fixed amount.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAdjustGauge(event, target) {
    await adjustGauge(this.actor, Number(target.dataset.delta));
  }

  /* -------------------------------------------- */

  /**
   * Spend one of a stone's transformations, or give one back.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAdjustTransforms(event, target) {
    const { uses, limit } = this.actor.system.shift;
    const next = Math.min(Math.max(uses + Number(target.dataset.delta), 0), limit);
    if ( next !== uses ) await this.actor.update({ "system.shift.uses": next });
  }

  /* -------------------------------------------- */

  /**
   * Mark whether the unit started its turn beside another Non-Beorc ally.
   * @this {UnitSheet}
   */
  static async #onToggleBoosted() {
    await this.actor.update({ "system.shift.boosted": !this.actor.system.shift.boosted });
  }

  /* -------------------------------------------- */
  /*  Items                                       */
  /* -------------------------------------------- */

  /**
   * Create a new owned Item of the type named by the target.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) });
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
    item?.sheet.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Open the sheet of an owned Item.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onEditItem(event, target) {
    this.#getItem(target)?.sheet.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Delete an owned Item after confirmation.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDeleteItem(event, target) {
    await this.#getItem(target)?.deleteDialog();
  }

  /* -------------------------------------------- */

  /**
   * Equip or unequip a weapon or skill.
   * Only one weapon can be in hand, and only a limited number of skills can be equipped.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onToggleEquip(event, target) {
    const item = this.#getItem(target);
    if ( !item ) return;
    const equip = !item.system.equipped;

    if ( item.type === "skill" ) {
      // What its Effect says is not a skill takes no slot, and can always be equipped
      // A skill its gear grants is equipped for as long as the gear is
      const granted = grantedBy(item);
      if ( granted ) {
        ui.notifications.warn(game.i18n.format("FEO.Gear.grantedLocked", { skill: item.name, item: granted.name }));
        return;
      }
      const room = this.actor.system.skillRoom;
      const fits = (equip && room && countsAsSkill(item.system.effect)) ? skillFits(room, item.system.capacity) : { ok: true };
      if ( !fits.ok ) {
        ui.notifications.warn((fits.why === "capacity")
          ? game.i18n.format("FEO.Skill.capacityFull", { cost: item.system.capacity ?? 0, left: Math.max(room.limit - room.spent, 0), limit: room.limit })
          : game.i18n.format("FEO.Skill.slotsFull", { slots: room.slots }));
        return;
      }
      await item.update({ "system.equipped": equip });
      return;
    }

    // A unit that is moving again after its Action keeps the weapon it holds, unless a skill lets it change
    if ( (this.mode !== UnitSheet.MODES.EDIT) && (turnState(this.actor, this.activeToken) === "moving") && !movingAgain(this.actor)?.gear ) {
      ui.notifications.warn("FEO.Canto.noGear", { localize: true });
      return;
    }

    // An accessory: only one is worn at a time, beside the weapon and the Shield
    if ( (item.type === "gear") && item.system.isAccessory ) {
      const worn = this.actor.items
        .filter((other) => (other.type === "gear") && other.system.isAccessory && ((other.id === item.id) || (equip && other.system.equipped)))
        .map((other) => ({ _id: other.id, "system.equipped": equip && (other.id === item.id) }));
      await this.actor.updateEmbeddedDocuments("Item", worn);
      return;
    }

    // A Shield: only one is equipped at a time
    if ( item.type === "gear" ) {
      if ( !item.system.isShield ) return;

      // A unit that a lasting change keeps from equipping Shields equips none while it lasts
      if ( equip && (this.mode !== UnitSheet.MODES.EDIT) && this.actor.system.shieldsBarred ) {
        ui.notifications.warn(game.i18n.format("FEO.Block.barred", { name: this.actor.name }));
        return;
      }
      const shields = this.actor.items
        .filter((other) => (other.type === "gear") && other.system.isShield && ((other.id === item.id) || (equip && other.system.equipped)))
        .map((other) => ({ _id: other.id, "system.equipped": equip && (other.id === item.id) }));
      await this.actor.updateEmbeddedDocuments("Item", shields);
      return;
    }

    // A unit may only wield weapons of its rank or lower. Edit mode lets it through, with a warning
    if ( equip ) {
      const check = wieldCheck(this.actor, item);
      if ( !check.ok ) {
        const data = check.level ? { weapon: item.name, needs: check.level.needs, has: check.level.has } : {
          weapon: item.name,
          needs: game.i18n.localize(FEO.ranks[check.needs]),
          has: game.i18n.localize(FEO.ranks[check.has])
        };
        const edit = this.mode === UnitSheet.MODES.EDIT;
        const key = check.level ? "aboveLevel" : "aboveRank";
        ui.notifications.warn(game.i18n.format(`FEO.Weapon.${key}${edit ? "Edit" : ""}`, data));
        if ( !edit ) return;
      }
    }

    const updates = this.actor.items
      .filter((other) => (other.type === "weapon") && ((other.id === item.id) || (equip && other.system.equipped)))
      .map((other) => ({ _id: other.id, "system.equipped": equip && (other.id === item.id) }));
    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /* -------------------------------------------- */

  /**
   * Use a carried item: spend one use, restore HP if it heals, and remove it once it is used up.
   * With one other unit targeted the item is used on that unit, which earns its user experience.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onUseItem(event, target) {
    const item = this.#getItem(target);
    if ( !item || item.system.spent ) return;
    const actor = this.actor;

    // A Shield is equipped, not Used, and so is an accessory: all but one that restores HP to the unit that
    // wears it, as a Goddess Ring does, which is Used while it is worn
    if ( item.system.isShield ) return;
    const worn = !!item.system.isAccessory;
    if ( worn && !((item.system.restore > 0) && item.system.equipped) ) return;

    // A Staggered unit cannot act, nor one that can do nothing but Wait
    if ( staggerStops(actor) || this.#waitStops() ) return;

    // An item that traps a space is laid on a tile next to the unit, which the map asks for. Off a battle map
    // it is only counted as used
    if ( trapOfItem({ name: item.name, effect: item.system.effect }) ) {
      const token = this.activeToken;
      if ( token?.parent?.grid?.isSquare && game.feo.hud?.pickTrap?.(token, item) ) return;
    }
    // An item one of its skills uses up for something that lasts, as Wealth Of Power does with Gems: its owner
    // is asked, the item is destroyed, and that is the unit's Action
    const consumed = await useUpItem(actor, item, this.activeToken);
    if ( consumed === "used" ) await takeAction(actor, this.activeToken, { action: { kind: "item" } });
    if ( consumed ) return;

    const ally = worn ? null : this.targetedUnit;
    const patient = ally?.actor ?? actor;
    if ( ally && !patient.isOwner ) {
      ui.notifications.warn("FEO.Item.notOwner", { localize: true });
      return;
    }
    const rows = [];

    if ( item.system.restore > 0 ) {
      // A skill may have the unit heal its allies for more
      const full = ally ? healsMore(actor, item.system.restore) : item.system.restore;

      // What the skills of the unit it heals make of that: one may have it restore less for something else,
      // which whoever Uses the item is asked about before it heals
      const before = await beforeItemHeal(patient, full, { own: !ally || (patient === actor), item: item.name });

      // Healing an ally with it is healing by this unit, for the skills that ask
      const healed = (await healUnit(patient, before.restore, { down: true, by: ally ? actor : null, byToken: this.activeToken, counted: true }))?.healed ?? 0;
      rows.push({
        label: game.i18n.localize("FEO.Chat.restored"),
        value: game.i18n.format("FEO.Chat.hpAmount", { amount: healed }),
        cls: "good"
      });

      // And what they leave on it for the HP it regained
      rows.push(...await afterItemHeal(patient, before, healed));
    }

    const remaining = Math.max(item.system.uses.value - 1, 0);
    const usedUp = (item.system.uses.max > 0) && (remaining === 0);
    if ( item.system.uses.max > 0 ) rows.push({
      label: game.i18n.localize("FEO.Weapon.uses"),
      value: usedUp ? game.i18n.localize("FEO.Chat.usedUp") : `${remaining} / ${item.system.uses.max}`
    });

    // Using an item on an ally earns experience
    if ( ally && earnsExp(actor, this.activeToken) ) rows.push(expRow(await awardExp(actor, FEO.exp.itemOnAlly)));

    const card = {
      title: ally
        ? game.i18n.format("FEO.Chat.usesItemOn", { item: item.name, target: ally.document.name || patient.name })
        : game.i18n.format("FEO.Chat.usesItem", { item: item.name }),
      subtitle: item.system.effect,
      rows
    };
    if ( usedUp ) await item.delete();
    else if ( item.system.uses.max > 0 ) await item.update({ "system.uses.value": remaining });
    await postCard(actor, card);

    // Using an item is the unit's Action
    await takeAction(actor, this.activeToken, { action: { kind: "item" } });
  }

  /* -------------------------------------------- */

  /**
   * Use a staff: spend one use, earn weapon experience and the experience the staff table gives. The staff
   * does what its Effect says to the unit it is used on, or to every unit it is for (see `helpers/staves.mjs`),
   * and one that moves a unit sets it down on the map. With one other unit targeted it is used on that unit.
   * For a unit that stands on a battle map the staff is used as the map has it: on a unit it reaches and may
   * be used on, on every unit a staff for several catches, and with nothing pointed out the map asks.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target      For a staff that moves a unit: `data-warp-i` and `data-warp-j` name the tile
   *                                  chosen on the map, and `data-warp-now` says that the map has no tile to
   *                                  choose for it. For one that opens a door or a chest: `data-object-i` and
   *                                  `data-object-j` name the tile it stands on
   */
  static async #onUseStaff(event, target) {
    const item = this.#getItem(target);
    if ( (item?.type !== "weapon") || (item.system.category !== "staff") ) return;
    const actor = this.actor;
    const system = actor.system;
    const staff = item.system;

    // A Staggered unit cannot act, nor one that can do nothing but Wait
    if ( staggerStops(actor) || this.#waitStops() ) return;
    if ( staff.broken ) {
      ui.notifications.warn("FEO.Exchange.blocked.broken", { localize: true });
      return;
    }
    if ( blocksWeapon(system.conditions ?? {}, staff) ) {
      ui.notifications.warn("FEO.Exchange.blocked.silenced", { localize: true });
      return;
    }
    const check = wieldCheck(actor, item);
    if ( !check.ok && (this.mode !== UnitSheet.MODES.EDIT) ) {
      ui.notifications.warn(check.level
        ? game.i18n.format("FEO.Weapon.aboveLevel", { weapon: item.name, needs: check.level.needs, has: check.level.has })
        : game.i18n.format("FEO.Weapon.aboveRank", {
          weapon: item.name,
          needs: game.i18n.localize(FEO.ranks[check.needs]),
          has: game.i18n.localize(FEO.ranks[check.has])
        }));
      return;
    }

    const token = this.activeToken;
    let ally = this.targetedUnit;
    const staffName = item.name;
    const tableName = item.flags?.[FEO.id]?.sheetName ?? staffName;
    const rows = [];

    // A staff that moves a unit is used on the map, where the unit it is for and the tile to set it down on
    // are chosen; the map comes back here once they are. For a unit that is not on the map in view the staff
    // is used as any other, and where its unit lands is left to the table
    const warp = staffWarpOf(item);
    const land = { i: Number(target?.dataset?.warpI ?? NaN), j: Number(target?.dataset?.warpJ ?? NaN) };
    const landing = !!warp && Number.isInteger(land.i) && Number.isInteger(land.j);
    const mapped = landing || (target?.dataset?.warpNow === "true");
    if ( warp && !mapped && game.feo.hud?.pickStaffWarp?.(token, item, ally) ) return;

    // On a battle map a staff is used on a unit it reaches and may be used on, and on no other: whatever
    // keeps it from that is said. One that needs something pointed out which was not is picked on the map
    const plan = staffPlanOf(actor, item);
    const door = { i: Number(target?.dataset?.objectI ?? NaN), j: Number(target?.dataset?.objectJ ?? NaN) };
    const object = (Number.isInteger(door.i) && Number.isInteger(door.j)) ? door : null;
    if ( token?.parent?.grid?.isSquare && !warp ) {
      let refusal = null;
      let asks = false;
      if ( ["allies", "enemies"].includes(plan.on) ) {
        const area = staffAreaOf(token, item);
        if ( area && !area.units.length ) refusal = staffWhy(token, item, null, "nobody", area.reach);
      }
      else if ( plan.on === "object" ) asks = !object;
      else if ( plan.on === "unit" ) {
        const tried = staffTakesOf(token, item, ally?.document ?? token);
        if ( !tried.ok ) refusal = staffWhy(token, item, ally?.document ?? token, tried.why, tried.reach);
        asks = !tried.ok && !ally;
      }
      if ( asks && game.feo.hud?.pickStaff?.(token, item) ) return;
      if ( refusal || asks ) {
        ui.notifications.warn(refusal ?? staffWhy(token, item, null, "nobody"));
        return;
      }
    }

    // What the staff does: to the unit it is used on, or to every unit it is for, with the skills of the
    // units having their say
    const cast = await castStaffFor(actor, token, item, ally, this.targetedUnits, { object });
    ally = cast.on ?? null;
    if ( ally && token ) {
      const distance = measureDistance(token, ally.document);
      if ( distance !== null ) rows.push({ label: game.i18n.localize("FEO.Weapon.range"), value: `${distance} (${cast.range ?? staff.range})` });
    }
    rows.push(...cast.rows);

    // The unit a staff moves is set down, unless the staff failed: against an enemy it rolls to hit first. What
    // cannot be done here is left for the table, and said to be
    const warped = (warp && mapped && !cast.cast.missed)
      ? await castStaffWarp(token, item, ally?.document ?? null, landing ? land : null)
      : null;
    if ( warped ) rows.push(...warped.rows);

    // A use, unless a skill spares the staff, and weapon experience toward the next rank
    const update = {};
    const tracked = (staff.uses.max > 0) && !cast.freeUse;
    // A staff that was cast a second time as a follow-up attack is made lost a use for each cast
    const remaining = Math.max(staff.uses.value - (cast.cast?.follow ? 2 : 1), 0);
    if ( tracked ) rows.push({ label: game.i18n.localize("FEO.Weapon.uses"), value: `${remaining} / ${staff.uses.max}` });
    for ( const key of wexpProficiencies(system.proficiencies, staff.category) ) {
      const { rank, wexp } = system.proficiencies[key];
      const after = gainWexp({ rank, wexp }, staff.wexp);
      update[`system.proficiencies.${key}.rank`] = after.rank;
      update[`system.proficiencies.${key}.wexp`] = after.wexp;
      rows.push({
        label: game.i18n.localize("FEO.Weapon.wexp"),
        value: after.rankUps
          ? game.i18n.format("FEO.Chat.rankReached", { rank: game.i18n.localize(FEO.ranks[after.rank]) })
          : `+${staff.wexp}`,
        cls: after.rankUps ? "good" : ""
      });
    }
    if ( Object.keys(update).length ) await actor.update(update);
    if ( tracked ) {
      await item.update({ "system.uses.value": remaining });
      if ( remaining === 0 ) {
        const { breakItem } = await import("../helpers/weapons.mjs");
        await breakItem(item);
        rows.push({ label: staffName, value: game.i18n.localize("FEO.Chat.broke"), cls: "bad" });
      }
    }

    // Experience from the staff table
    const exp = useExp(actor, "staff", tableName, { terrors: cast.slain ?? 0 });
    if ( exp > 0 ) rows.push(expRow(await awardExp(actor, exp, { staff: staffExpBy(actor) })));
    const note = (exp === null) && earnsExp(actor, token) ? game.i18n.localize("FEO.Exp.notListed") : undefined;

    await postCard(actor, {
      title: ally
        ? game.i18n.format("FEO.Chat.usesItemOn", { item: staffName, target: ally.document.name || ally.actor.name })
        : game.i18n.format("FEO.Chat.usesItem", { item: staffName }),
      subtitle: staff.effect,
      rows,
      note
    }, { rolls: [...cast.rolls, ...(warped?.rolls ?? [])] });

    // Using a staff on a partner brings the two closer, each ally a staff for several units reached too
    if ( ally && token ) await awardEvent("assist", token, { only: ally.document });
    for ( const other of (token ? (cast.allies ?? []) : []) ) await awardEvent("assist", token, { only: other });

    // A skill that has a staff act as a Refresh has the ally it was used on, or one picked on the map, act again
    try {
      await staffRefreshes(token, cast.cast, ally?.document ?? null);
    } catch(err) {
      console.error(err);
    }

    // Using a staff is the unit's Action
    await takeAction(actor, token, { action: { kind: "staff" } });
  }

  /* -------------------------------------------- */

  /**
   * Use a skill that the skill experience table lists, and earn what it gives. A skill that warps its unit has
   * the tile chosen on the map first, and is used once the unit stands there. So has a skill that is used on a
   * unit picked on the map: it is used once it has done its part there.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target      `data-warped` says that the map has already warped the unit, and
   *                                  `data-acted` that the skill has done its part to the unit it was used on
   */
  static async #onUseSkill(event, target) {
    const item = this.#getItem(target);
    if ( item?.type !== "skill" ) return;

    // A skill used as an action has to be ready, and using it starts its cooldown and counts a use
    const usage = item.system.usage;
    let spent = null;
    let early = false;
    if ( (usage?.kind === "action") && this.#waitStops() ) return;
    if ( usage?.kind === "action" ) {
      const able = canUse(usage, item.system.state);
      if ( !able.ok ) {
        ui.notifications.warn(game.i18n.format(`FEO.Usage.blocked.${able.reason}`, { skill: item.name }));
        return;
      }

      // A skill for before the unit moves is not used once it has
      if ( usage.unmoved && originOf(this.activeToken) ) {
        ui.notifications.warn(game.i18n.format("FEO.Usage.blocked.moved", { skill: item.name }));
        return;
      }
      // A skill whose stance is entered on a kind of terrain is used by a unit that stands on one
      const kinds = stanceGround(item.system.effects);
      const under = kinds.length ? groundUnder(this.activeToken) : null;
      if ( kinds.length && under && !kinds.includes(under.terrain) ) {
        const names = kinds.map((kind) => game.i18n.localize(FEO.terrain.types[kind]?.label ?? kind)).join(", ");
        ui.notifications.warn(game.i18n.format("FEO.Stance.needsGround", { skill: item.name, kinds: names }));
        return;
      }
      early = !!able.early;
      spent = spendSkill(usage, item.system.state, { early, cooldowns: cooldownsFor(this.actor, item) });
    }
    const actor = this.actor;
    const token = this.activeToken;

    // Warping is done on the map, which comes back here once the unit has landed. For a unit that is not on
    // the map in view the skill is used as any other, and where it lands is left to the table
    const warp = warpOf(item.system);
    if ( warp && (target?.dataset?.warped !== "true") && game.feo.hud?.pickWarp?.(token, item) ) return;

    // So is picking the unit a skill is used on, and what the skill does to it. Off the map in view the skill
    // is only counted
    const act = actOf(item.system);
    const done = target?.dataset?.acted === "true";
    if ( act && !done && game.feo.hud?.pickAct?.(token, item) ) return;
    const acted = (act && done) ? takeOutcome(item) : null;
    const ally = this.targetedUnit;
    const rows = [...(acted?.rows ?? [])];

    // A unit that took hold of another holds on: the cooldown of its skill starts once it lets go
    if ( spent && acted?.holds ) spent = { ...spent, active: true, cooldown: item.system.state?.cooldown ?? 0 };

    const exp = useExp(actor, "skill", item.name);
    if ( exp > 0 ) rows.push(expRow(await awardExp(actor, exp)));
    if ( spent ) {
      // The cooldown of a skill its unit holds another with has yet to start, and is not told of
      rows.push(...usageRows(acted?.holds ? { ...usage, cooldown: 0 } : usage, spent, game.i18n));
      await item.update({ "system.state": spent });

      // What the skill leaves on its unit as it is used: temporary HP, a boost that lasts
      rows.push(...await useSkillMoment(actor, item));
    }

    // A unit whose skills let it act again after warping keeps its turn, and has not moved from where it landed
    const again = !!warp && !!actor.system.skills?.rules?.includes(ACT_AFTER_WARP);
    if ( again ) {
      const source = (actor.system.skills.entries ?? []).find((entry) => (entry.effects ?? []).some((effect) => effect.rules?.includes(ACT_AFTER_WARP)));
      rows.push({ label: source?.name ?? item.name, value: game.i18n.localize("FEO.Usage.actsAgain") });
      if ( originOf(token) && token.isOwner ) await token.unsetFlag(FEO.id, "origin");
    }
    await postCard(actor, {
      title: ally
        ? game.i18n.format("FEO.Chat.usesItemOn", { item: item.name, target: ally.document.name || ally.actor.name })
        : game.i18n.format("FEO.Chat.usesItem", { item: item.name }),
      subtitle: item.system.effect,
      outcome: acted?.outcome ?? undefined,
      rows
    }, { rolls: [...(acted?.rolls ?? [])] });
    if ( ally && token ) await awardEvent("assist", token, { only: ally.document });

    // A skill used before its cooldown was over leaves its unit the condition that is the price of it
    if ( early && usage.early?.condition ) {
      await afflictUnit(actor, usage.early.condition, { turns: usage.early.turns ?? undefined, token });
    }

    // A skill used as an Action is the unit's Action, unless using it is free
    if ( (usage?.kind === "action") && !again && !usage.free ) {
      await takeAction(actor, token, { action: { kind: "skill", name: item.name, states: statesEntered(item.system.effects) } });
    }
  }

  /* -------------------------------------------- */

  /**
   * Show a skill to the table as a card in the chat: what it is, its chance for this unit, and what it does.
   * Nothing is spent and nothing is earned.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onPostSkill(event, target) {
    const item = this.#getItem(target);
    if ( item?.type !== "skill" ) return;
    await postCard(this.actor, buildSkillCard(item, game.i18n), { template: "skill" });
  }

  /* -------------------------------------------- */

  /**
   * Turn a skill's card over, from what it is to what it does and back. Nothing is drawn again, so that the
   * card is seen turning; the face turned away is put out of reach.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onFlipSkill(event, target) {
    const card = target.closest(".skill");
    const id = card?.dataset.itemId;
    if ( !id ) return;

    // Working the scrollbar of a long Effect is not a click on the card
    const text = event.target.closest?.(".effect");
    if ( text && (event.offsetX >= text.clientWidth) ) return;

    const flipped = !this.#flipped.has(id);
    if ( flipped ) this.#flipped.add(id);
    else this.#flipped.delete(id);
    card.classList.toggle("flipped", flipped);
    card.querySelector(".face.front")?.toggleAttribute("inert", flipped);
    card.querySelector(".face.back")?.toggleAttribute("inert", !flipped);
  }

  /* -------------------------------------------- */

  /**
   * Have a weapon repaired for what a blacksmith charges.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRepairItem(event, target) {
    const item = this.#getItem(target);
    if ( (item?.type === "weapon") || isShield(item) ) await repairItem(this.actor, item);
  }

  /* -------------------------------------------- */

  /**
   * Sell a weapon or item for what it is worth.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSellItem(event, target) {
    const item = this.#getItem(target);
    if ( !item || !["weapon", "gear"].includes(item.type) ) return;

    // A weapon a creature was handed is not sold, and nothing is out of a pack that is locked
    const bar = packBar(this.actor, item);
    if ( bar ) {
      ui.notifications.warn(game.i18n.format(bar, { item: item.name, name: this.actor.name }));
      return;
    }
    await sellItem(this.actor, item);
  }

  /* -------------------------------------------- */
  /*  Rolls                                       */
  /* -------------------------------------------- */

  /**
   * Attack with the equipped weapon. With one token targeted this fights a full exchange against it, after
   * showing the forecast. With nothing targeted it rolls against this unit's own numbers.
   * @this {UnitSheet}
   */
  static async #onAttack() {
    const targets = Array.from(game.user.targets);
    if ( !targets.length ) return UnitSheet.#rollUntargeted.call(this);
    if ( targets.length > 1 ) {
      ui.notifications.warn("FEO.Exchange.warn.oneTarget", { localize: true });
      return;
    }

    // The token this unit fights from: the one the sheet was opened from, else one that is selected. In a
    // battle the attack is the unit's Action. Where it stands on a battle map, the map forecasts the fight
    // and has it confirmed there, so that the sheet and the map never tell of it differently
    const token = this.activeToken;
    if ( token?.parent?.grid?.isSquare && game.feo.hud?.pickAttack?.(token, targets[0]) ) return;
    await fightTarget(this.actor, token, targets[0]);
  }

  /* -------------------------------------------- */

  /**
   * Roll an attack with the equipped weapon and report it against this unit's own Accuracy and Critical.
   * The target's Dodge, Critical Avoid and defence are not applied here.
   * @this {UnitSheet}
   */
  static async #rollUntargeted() {
    const actor = this.actor;
    const combat = actor.system.combat;
    const weapon = actor.system.equippedWeapon;
    const { roll, results: [hitRoll, critRoll] } = await rollD100(2);
    const hit = hitRoll <= combat.accuracy.value;
    const crit = hit && (critRoll <= combat.critical.value);
    const versus = (rolled, target) => game.i18n.format("FEO.Chat.rolledAgainst", { roll: rolled, target });

    const rows = [{ label: game.i18n.localize("FEO.Combat.hit"), value: versus(hitRoll, combat.accuracy.value) }];
    if ( hit ) {
      rows.push(
        { label: game.i18n.localize("FEO.Combat.critical"), value: versus(critRoll, combat.critical.value) },
        {
          label: game.i18n.localize("FEO.Combat.damage"),
          value: crit ? `${combat.damage.value} × 3 = ${combat.damage.value * 3}` : combat.damage.value,
          cls: "strong"
        }
      );
    }

    await postCard(actor, {
      title: game.i18n.format("FEO.Chat.attacksWith", {
        weapon: weapon?.name ?? game.i18n.localize("FEO.Combat.unarmed")
      }),
      outcome: {
        label: game.i18n.localize(crit ? "FEO.Chat.criticalHit" : hit ? "FEO.Chat.hit" : "FEO.Chat.miss"),
        cls: crit ? "crit" : hit ? "good" : "bad"
      },
      rows,
      note: game.i18n.localize("FEO.Chat.beforeTarget")
    }, { rolls: [roll] });
  }

  /* -------------------------------------------- */

  /**
   * Roll an ability check or saving throw: d100 plus the ability's bonus.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRollCheck(event, target) {
    const key = target.dataset.check;
    const check = this.actor.system.checks[key];
    if ( !check ) return;
    const { roll, results: [die] } = await rollD100(1);
    await postCard(this.actor, {
      title: game.i18n.localize(`FEO.Ability.${key}`),
      subtitle: game.i18n.localize(FEO.abilityGroups[FEO.abilityChecks[key].group]),
      outcome: { label: String(die + check.bonus), cls: "total" },
      rows: [
        { label: "d100", value: die },
        { label: game.i18n.localize("FEO.Chat.bonus"), value: `+${check.bonus}` }
      ]
    }, { rolls: [roll] });
  }

  /* -------------------------------------------- */

  /**
   * Level up: grant ability points, then roll every growth rate. What they came to is shown on the Level Up
   * splash, and then told in chat.
   * A unit whose class promotes at this level promotes instead. A unit with only a class name is asked whether
   * to promote, which skips the growth rolls and leaves the new class to be applied by hand. With the Level
   * Cap, a unit at its level limit does neither.
   * @this {UnitSheet}
   */
  static async #onLevelUp() {
    const actor = this.actor;
    const system = actor.system;
    const source = actor._source.system;
    if ( (system.exp < FEO.expPerLevel) || system.atMaxLevel ) return;

    // A unit that imitates another levels up once it is itself again
    const waits = growthBar(actor);
    if ( waits ) {
      ui.notifications.warn(waits);
      return;
    }

    const cls = system.classItem;
    if ( promotesAt(system.level, cls) ) {
      await promoteUnit(actor, { levelUp: true });
      return;
    }

    let promote = false;
    if ( !cls && FEO.promotionLevels.includes(system.level) ) {
      const choice = await DialogV2.wait({
        window: { title: "FEO.LevelUp.promotionTitle" },
        content: `<p>${game.i18n.format("FEO.LevelUp.promotionPrompt", { level: system.level })}</p>`,
        buttons: [
          { action: "promote", label: "FEO.LevelUp.promote", default: true },
          { action: "level", label: "FEO.LevelUp.levelNormally" }
        ],
        rejectClose: false
      });
      if ( !choice ) return;
      promote = choice === "promote";
    }

    const level = system.level + 1;
    const points = system.checkPointsPerLevel;
    const update = {
      "system.level": level,
      "system.exp": system.exp - FEO.expPerLevel,
      "system.checkPoints": system.checkPoints + points
    };
    const rows = [{
      label: game.i18n.localize("FEO.LevelUp.abilityPoints"),
      value: `+${points}`
    }];
    const rolls = [];
    let lasting = [];
    let splash = null;

    if ( !promote ) {
      const capped = Object.entries(system.stats).filter(([, stat]) => stat.capped).map(([key]) => key);
      if ( system.hp.capped ) capped.push("hp");
      if ( system.weaponLevel?.used && system.weaponLevel.capped ) capped.push("wlv");
      const growths = Object.keys(FEO.growths);
      let gained;

      // With Manual Stat Gains the level's points are placed by hand, in place of what the growth rates roll
      if ( FEO.optional.manualGains.enabled ) {
        const manual = await manualLevelUp(actor, capped);
        if ( !manual ) return;
        rolls.push(...manual.rolls);
        rows.push(...manual.rows);
        gained = manual.results;
      }
      else {
        const { roll, results } = await rollD100(growths.length - capped.filter((key) => growths.includes(key)).length);
        rolls.push(roll);
        const queue = results.slice();

        // A skill may let the growth rates that failed be rolled once more
        const again = await rerollFailed(actor, rollGrowths(system.growthRates ?? system.growths, capped, () => queue.shift()));
        if ( again.roll ) rolls.push(again.roll);
        gained = again.results;
        for ( const result of gained ) {
          const label = game.i18n.localize(FEO.growths[result.key]);
          if ( result.capped ) rows.push({ label, value: game.i18n.localize("FEO.LevelUp.atCap"), cls: "muted" });
          else rows.push({ label, value: growthValue(result, game.i18n), cls: result.gain ? "good" : "muted" });
        }
      }
      for ( const result of gained ) {
        if ( result.capped || !result.gain ) continue;
        if ( result.key === "hp" ) {
          update["system.hp.max"] = source.hp.max + result.gain;
          update["system.hp.value"] = system.hp.value + result.gain;
        }
        else if ( result.key in FEO.abilities ) {
          update[`system.abilities.${result.key}.increase`] = source.abilities[result.key].increase + result.gain;
        }
        else if ( result.key === "wlv" ) {
          update["system.weaponLevel.base"] = Math.min(source.weaponLevel.base + result.gain, system.weaponLevel.cap);
        }
        else update[`system.stats.${result.key}.base`] = source.stats[result.key].base + result.gain;
      }

      // What the unit's skills do at a level up: gold, HP restored, a boost that lasts a while
      const skills = levelUpSkills(actor, gained, update);
      Object.assign(update, skills.update);
      rows.push(...skills.rows);
      lasting = skills.grants;

      // The Level Up splash is put together from the unit as it stands, before what it gained is saved
      splash = buildLevelUpSplash(actor, { from: system.level, to: level, results: gained, points, notes: skills.rows });
    }
    else {
      // A promotion that takes the place of a level up is one to the unit's skills. Its class is applied by
      // hand, so nothing is known of the stats it raises
      const skills = levelUpSkills(actor, [], update);
      Object.assign(update, skills.update);
      rows.push(...skills.rows);
      lasting = skills.grants;
    }

    // With Additional Lives, promoting grants one more life in total and restores one
    const lives = promote ? promotionLifeUpdate(actor) : {};
    if ( "system.lives.max" in lives ) {
      Object.assign(update, lives);
      rows.push({
        label: game.i18n.localize("FEO.Optional.lives.title"),
        value: `${lives["system.lives.value"]} / ${lives["system.lives.max"]}`,
        cls: "good"
      });
    }
    await actor.update(update);

    // The splash shows what the dice came to before the card tells of it in chat
    if ( splash ) await showLevelUp(actor, splash);
    await postCard(actor, {
      title: game.i18n.format(promote ? "FEO.LevelUp.promotedTo" : "FEO.LevelUp.reached", { level }),
      rows,
      note: promote ? game.i18n.localize("FEO.LevelUp.promotionNote") : undefined
    }, { rolls });
    if ( lasting.length ) await grantTimed(actor, lasting);

    // A class that does not promote learns its skills, and may gain stats, on reaching certain levels
    if ( cls ) await applyLevelGains(actor, level);
  }

  /* -------------------------------------------- */

  /**
   * Pick what a skill has its unit pick as it is learnt, or change it where that is still allowed.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onPickSkill(event, target) {
    const item = this.#getItem(target);
    if ( item?.type !== "skill" ) return;
    if ( !picksOf(item).open && (this.mode !== UnitSheet.MODES.EDIT) ) return;
    await askPicks(item);
  }

  /* -------------------------------------------- */

  /**
   * Promote without levelling up, as a promotion item allows before the usual level.
   * @this {UnitSheet}
   */
  static async #onPromote() {
    const waits = growthBar(this.actor);
    if ( waits ) {
      ui.notifications.warn(waits);
      return;
    }
    await promoteUnit(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Reclass into the line of one of the unit's Heart Seal Classes.
   * @this {UnitSheet}
   */
  static async #onReclass() {
    const waits = growthBar(this.actor);
    if ( waits ) {
      ui.notifications.warn(waits);
      return;
    }
    await reclassUnit(this.actor);
  }

  /* -------------------------------------------- */

  /**
   * Open the menu of the unit's Heart Seal Classes, or close it again. In Edit mode the menu also puts classes
   * on the list and takes them off.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSealClasses(event, target) {
    await toggleSealPicker(this.actor, target, { edit: this.isEditable && (this.mode === UnitSheet.MODES.EDIT) });
  }

  /* -------------------------------------------- */
  /*  Optional Modules                            */
  /* -------------------------------------------- */

  /**
   * Take one of the unit's lives or give one back by hand.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAdjustLives(event, target) {
    await adjustLivesFor(this.actor, Number(target.dataset.delta), this.token ?? null);
  }

  /* -------------------------------------------- */

  /**
   * Unlock a Power with the unit's Glory.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onBuyPower(event, target) {
    await buyPowerFor(this.actor, target.dataset.power);
  }

  /* -------------------------------------------- */

  /**
   * Give up a Power, which hands its Glory back. For the Game Master.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRefundPower(event, target) {
    await refundPowerFor(this.actor, target.dataset.power);
  }

  /* -------------------------------------------- */

  /**
   * Roll one of the chances the Optional Modules give a unit: its Movement Stars or its Crest.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRollOptional(event, target) {
    if ( target.dataset.roll === "movementStars" ) await rollMovementStars(this.actor);
    else if ( target.dataset.roll === "crest" ) await rollCrest(this.actor);
  }

  /* -------------------------------------------- */
  /*  Supports                                    */
  /* -------------------------------------------- */

  /**
   * Add a blank support partner.
   * @this {UnitSheet}
   */
  static async #onAddBond() {
    const bonds = foundry.utils.deepClone(this.actor._source.system.bonds);
    bonds.push({ name: "", affinity: "", rank: "E", points: 0, inRange: false, adjacent: false, auto: true, kin: false, uuid: "" });
    await this.actor.update({ "system.bonds": bonds });
  }

  /* -------------------------------------------- */

  /**
   * Remove a support partner.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDeleteBond(event, target) {
    const bonds = foundry.utils.deepClone(this.actor._source.system.bonds);
    bonds.splice(Number(target.closest("[data-bond]").dataset.bond), 1);
    await this.actor.update({ "system.bonds": bonds });
  }

  /* -------------------------------------------- */

  /**
   * End a change that lasts a while by hand.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemoveTimed(event, target) {
    await removeTimed(this.actor, Number(target.closest("[data-timed]").dataset.timed));
  }

  /* -------------------------------------------- */

  /**
   * Mark a support partner as in or out of range by hand, and for a Bond Support as side by side. Doing so
   * takes the bond off the automatic reading of the tokens on the scene.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onToggleBond(event, target) {
    const bonds = foundry.utils.deepClone(this.actor._source.system.bonds);
    const bond = bonds[Number(target.closest("[data-bond]").dataset.bond)];
    if ( !bond ) return;
    Object.assign(bond, cycleRange(bond), { auto: false });
    await this.actor.update({ "system.bonds": bonds });
  }

  /* -------------------------------------------- */

  /**
   * Hand a bond's range back to the tokens on the scene.
   * @this {UnitSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAutoBond(event, target) {
    const bonds = foundry.utils.deepClone(this.actor._source.system.bonds);
    const bond = bonds[Number(target.closest("[data-bond]").dataset.bond)];
    if ( !bond ) return;
    bond.auto = true;
    await this.actor.update({ "system.bonds": bonds });
    queueRangesFor(this.actor);
  }
}

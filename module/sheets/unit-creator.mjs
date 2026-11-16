import Compendium from "../apps/compendium.mjs";
import { FEO } from "../config.mjs";
import * as creation from "../helpers/creation.mjs";
import { openSealTree, removeSealClassFrom } from "../helpers/reclass.mjs";
import { buildCreator, creatorSummary } from "./creation-context.mjs";

/**
 * The Character Creator on the unit sheet: its button in the window header, what the sheet shows while it is
 * open, and what its buttons do.
 *
 * The Creator takes the place of the sheet's tabs while it is open, beside the unit's standard, which goes on
 * showing the unit as it takes shape. What is chosen is saved by `helpers/creation.mjs`; what is shown is
 * worked out by `creation-context.mjs`. This keeps what each open sheet is looking at, which is nobody else's
 * business and is not saved.
 */

/** How often a window says again that its Creator is open, in milliseconds. */
const BEAT = 20000;

/** The steps that say what a skill does, which is read from the compendiums. */
const NEEDS_LIBRARY = new Set(["skills"]);

/** What each sheet is looking at. */
const views = new WeakMap();

/**
 * What a sheet's Creator is looking at.
 * @param {UnitSheet} sheet
 * @returns {{open: boolean, step: string, draft: string, beat: number|null, wired: HTMLElement|null, queue: Promise<void>}}
 */
export function creatorView(sheet) {
  if ( !views.has(sheet) ) {
    views.set(sheet, {
      open: false,
      step: "",
      draft: "",
      beat: null,
      wired: null,
      queue: Promise.resolve()
    });
  }
  return views.get(sheet);
}

/* -------------------------------------------- */
/*  Context                                     */
/* -------------------------------------------- */

/**
 * What the sheet's templates are given of the Creator: its summary for the header button and the banner, and
 * the whole of it while it is open.
 * @param {UnitSheet} sheet
 * @returns {Promise<object>}
 */
export async function prepareCreator(sheet) {
  const actor = sheet.actor;
  const view = creatorView(sheet);
  const unit = actor._source.system;
  const record = creation.recordOf(actor);
  const cls = actor.system.classItem;
  const skills = creation.takenSkills(actor);
  const summary = creatorSummary({ unit, record, cls, skills, isGM: game.user.isGM, i18n: game.i18n });
  const open = view.open && sheet.isEditable;
  const base = { uid: sheet.id, open, summary, banner: (open || !sheet.isEditable) ? null : summary.banner };
  if ( !open ) return base;

  if ( !view.step ) view.step = summary.first;
  let library = null;
  if ( NEEDS_LIBRARY.has(view.step) ) {
    try {
      library = await Compendium.library();
    } catch(err) {
      console.error(err);
    }
  }
  const watchers = creation.watchers(actor).map(({ user, step }) => ({
    id: user.id,
    name: user.name,
    initial: user.name.slice(0, 1).toUpperCase(),
    color: user.color?.css ?? String(user.color ?? "#888"),
    step
  }));
  return {
    ...base,
    ...buildCreator({
      name: actor.name, unit, record, cls, skills, view, library, watchers,
      user: { id: game.user.id, isGM: game.user.isGM },
      i18n: game.i18n
    })
  };
}

/* -------------------------------------------- */
/*  The header button                           */
/* -------------------------------------------- */

/**
 * Make the Creator's button for the window header. It is filled in each time the sheet is drawn.
 * @returns {HTMLButtonElement}
 */
export function creatorButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control creator-toggle";
  button.dataset.action = "creatorToggle";
  button.innerHTML = `<span class="ring" aria-hidden="true"></span><span class="label"></span><span class="count"></span><span class="badges"></span>`;
  button.querySelector(".label").textContent = game.i18n.localize("FEO.Creator.button.label");
  return button;
}

/* -------------------------------------------- */

/**
 * Bring the window in step with its Creator after the sheet is drawn: the header button, what the window shows,
 * where someone else's change landed, and the listeners of the Creator's own fields.
 * @param {UnitSheet} sheet
 * @param {object} context      The sheet's context, with `creator` as `prepareCreator` built it
 */
export function activateCreator(sheet, context) {
  const root = sheet.element;
  const view = creatorView(sheet);
  const creator = context.creator;
  if ( !root || !creator ) return;
  const { summary } = creator;
  root.classList.toggle("creator-open", creator.open);
  root.classList.toggle("creator-banner", !!creator.banner);

  const button = root.querySelector(".creator-toggle");
  if ( button ) {
    button.setAttribute("aria-pressed", String(creator.open));
    button.dataset.tooltip = summary.hint;
    button.classList.toggle("finished", summary.finished);
    button.querySelector(".ring").style.setProperty("--cr-progress", summary.finished ? 100 : summary.percent);
    button.querySelector(".count").textContent = (summary.started && !summary.finished) ? `${summary.done}/${summary.total}` : "";
    const badges = [];
    if ( summary.fresh ) badges.push(`<i class="cr-bdg new">${game.i18n.format("FEO.Creator.button.fresh", { count: summary.fresh })}</i>`);
    if ( summary.help ) badges.push(`<i class="cr-bdg help" data-tooltip="${game.i18n.localize("FEO.Creator.help.flag")}">${summary.help}</i>`);
    button.querySelector(".badges").innerHTML = badges.join("");
  }

  // A window that was closed and opened again is a new element, to be listened to anew
  if ( view.wired !== root ) {
    view.wired = root;
    wire(sheet);
  }

  // What someone else changed glows for a moment
  const paths = creation.takeRemote(sheet.actor);
  if ( creator.open && paths.length ) {
    for ( const el of root.querySelectorAll(".creator-part [data-fl]") ) {
      const at = el.dataset.fl;
      if ( at && paths.some((path) => (path === at) || path.startsWith(`${at}.`) || at.startsWith(`${path}.`)) ) el.classList.add("cr-flash");
    }
  }
}

/* -------------------------------------------- */

/**
 * Listen to the Creator's own fields. They are not fields of the sheet's form: each saves by itself, so what is
 * typed into one never reaches the sheet's own submission.
 * @param {UnitSheet} sheet
 */
function wire(sheet) {
  const root = sheet.element;
  const view = creatorView(sheet);
  const inside = (event) => event.target.closest?.(".creator-part");

  root.addEventListener("change", (event) => {
    if ( !inside(event) ) return;
    event.stopPropagation();
    const path = event.target.dataset.creatorField;
    if ( path ) run(sheet, () => creation.setField(sheet.actor, path, event.target.value, view.step));
  }, true);

  root.addEventListener("input", (event) => {
    if ( !inside(event) ) return;
    if ( "creatorNote" in event.target.dataset ) view.draft = event.target.value;
  });

  root.addEventListener("keydown", (event) => {
    if ( (event.key !== "Enter") || !inside(event) || (event.target.tagName !== "INPUT") ) return;
    event.preventDefault();
    if ( "creatorNote" in event.target.dataset ) leaveNote(sheet);
    else event.target.blur();
  });
}

/* -------------------------------------------- */
/*  Opening and moving                          */
/* -------------------------------------------- */

/**
 * Do one thing after another: a second click waits for the first to be saved, so that it starts from what the
 * first left.
 * @param {UnitSheet} sheet
 * @param {() => Promise<any>} task
 * @returns {Promise<void>}
 */
function run(sheet, task) {
  const view = creatorView(sheet);
  view.queue = view.queue.then(task).catch((err) => console.error(err));
  return view.queue;
}

/* -------------------------------------------- */

/**
 * Open a sheet's Creator, at a step or at the first that still has something to do.
 * @param {UnitSheet} sheet
 * @param {string} [step]
 * @returns {Promise<void>}
 */
export async function openCreator(sheet, step = "") {
  if ( !sheet.isEditable ) return;
  const actor = sheet.actor;
  const view = creatorView(sheet);
  const summary = creatorSummary({
    unit: actor._source.system, record: creation.recordOf(actor), cls: actor.system.classItem, skills: creation.takenSkills(actor),
    isGM: game.user.isGM, i18n: game.i18n
  });
  view.open = true;
  view.step = step || summary.first;
  creation.announce(actor, view.step, { hello: true });
  clearInterval(view.beat);
  view.beat = setInterval(() => creation.announce(actor, view.step), BEAT);
  await creation.markSteps(actor, view.step);
  await sheet.render();
}

/* -------------------------------------------- */

/**
 * Close a sheet's Creator, and tell the table it is no longer being looked at.
 * @param {UnitSheet} sheet
 * @param {object} [options]
 * @param {boolean} [options.render]    Draw the sheet again
 * @returns {Promise<void>}
 */
export async function closeCreator(sheet, { render = true } = {}) {
  const view = creatorView(sheet);
  if ( !view.open ) return;
  view.open = false;
  clearInterval(view.beat);
  view.beat = null;
  creation.announce(sheet.actor, null);
  if ( render ) await sheet.render();
}

/* -------------------------------------------- */

/**
 * Show another step.
 * @param {UnitSheet} sheet
 * @param {string} step
 * @param {string} [confirmed]    The step left with Next
 * @returns {Promise<void>}
 */
async function goTo(sheet, step, confirmed = "") {
  if ( !step ) return;
  const view = creatorView(sheet);
  if ( !view.open ) return openCreator(sheet, step);
  view.step = step;
  view.draft = "";
  creation.announce(sheet.actor, step);
  await creation.markSteps(sheet.actor, step, confirmed);
  await sheet.render({ parts: ["creator"] });
  sheet.element?.querySelector(".cr-panel")?.scrollTo({ top: 0 });
}

/* -------------------------------------------- */

/**
 * Leave the note typed on the step in view.
 * @param {UnitSheet} sheet
 * @returns {Promise<void>}
 */
function leaveNote(sheet) {
  const view = creatorView(sheet);
  const text = view.draft;
  view.draft = "";
  return run(sheet, () => creation.addNote(sheet.actor, view.step, text));
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/**
 * What the Creator's buttons do, to be added to the sheet's actions. Each is called with the sheet as `this`.
 * @type {Record<string, (this: UnitSheet, event: PointerEvent, target: HTMLElement) => any>}
 */
export const CREATOR_ACTIONS = {

  /** Open the Creator, or go back to the sheet. */
  creatorToggle() {
    return creatorView(this).open ? closeCreator(this) : openCreator(this);
  },

  /** Show a step: from the list, from Back, from what is still to do, or to where someone else is. */
  creatorGoto(event, target) {
    return goTo(this, target.dataset.step);
  },

  /** Go on to the next step, which settles the one left. */
  creatorNext(event, target) {
    return goTo(this, target.dataset.step, creatorView(this).step);
  },

  /** Open the class tree, to take a class from it. */
  creatorTree() {
    return creation.openClassTree(this.actor);
  },

  /** Open the class tree, to take Heart Seal Classes from it. */
  creatorSealTree() {
    return openSealTree(this.actor, { limit: FEO.optional.heartSeals.picks });
  },

  /** Take a class off the list of Heart Seal Classes. */
  creatorSealRemove(event, target) {
    return run(this, () => removeSealClassFrom(this.actor, target.dataset.name));
  },

  /** Open the roll of skills, to take a Generic Skill from it. */
  creatorSkillRoll() {
    return creation.openSkillRoll(this.actor);
  },

  /** Open the armoury at its weapons or its items, to buy from it. */
  creatorArmoury(event, target) {
    return creation.openArmoury(this.actor, target.dataset.tab);
  },

  /** Raise or lower bonus points, a growth rate, an ability's points or Class Weight. */
  creatorAdjust(event, target) {
    const { kind, key, delta } = target.dataset;
    return run(this, () => creation.adjust(this.actor, kind, key, Number(delta), creatorView(this).step));
  },

  /** Choose one of several. */
  creatorPick(event, target) {
    const actor = this.actor;
    const { field, value, ability } = target.dataset;
    return run(this, () => {
      switch ( field ) {
        case "source": return creation.chooseSource(actor, ability, value);
        case "boon": case "bane": return creation.chooseBoon(actor, field, value);
        case "affinity": return creation.setField(actor, "system.affinity", value, "affinity");
        case "classSkill": return creation.chooseSkill(actor, "class", value);
        case "genericSkill": return creation.chooseSkill(actor, "generic", value);
        case "first": return creation.chooseRanks(actor, creation.recordOf(actor).ranks.take, value);
        case "lineage": return creation.chooseGrant(actor, "holyBlood", { lineage: value });
        case "bloodGrade": return creation.chooseGrant(actor, "holyBlood", { grade: value });
        case "crest": return creation.chooseGrant(actor, "crest", { id: value });
        case "crestGrade": return creation.chooseGrant(actor, "crest", { grade: value });
      }
    });
  },

  /** Choose the variant of a starting skill, or take or give up a growth rate it raises. */
  creatorVariant(event, target) {
    return run(this, () => creation.chooseVariant(this.actor, target.dataset.id, target.dataset.value));
  },

  /** Take or give up one of the proficiencies a class offers. The oldest makes room for a new one. */
  creatorTake(event, target) {
    const actor = this.actor;
    const key = target.dataset.value;
    return run(this, () => {
      const { take, first } = creation.recordOf(actor).ranks;
      const choose = actor.system.classItem?.system.proficiencies.choose ?? 0;
      const next = take.includes(key) ? take.filter((other) => other !== key) : [...take, key];
      while ( choose && (next.length > choose) ) next.shift();
      return creation.chooseRanks(actor, next, first);
    });
  },

  /** Hand back something bought. */
  creatorRefund(event, target) {
    return run(this, () => creation.refund(this.actor, target.dataset.id));
  },

  /** Approve what a player asked for, or withdraw the approval. */
  creatorApprove(event, target) {
    return run(this, () => creation.approveGrant(this.actor, target.dataset.which, target.dataset.approved === "true"));
  },

  /** Ask for help on the step in view, or say that it is no longer needed. */
  creatorHelp(event, target) {
    return run(this, () => creation.askHelp(this.actor, creatorView(this).step, target.dataset.asking === "true"));
  },

  /** Leave the note typed on the step in view. */
  creatorNote() {
    return leaveNote(this);
  },

  /** Finish the unit: back to the sheet, with its build locked. */
  async creatorFinish() {
    await run(this, () => creation.finish(this.actor));
    this.mode = this.constructor.MODES.PLAY;
    await closeCreator(this);
  }
};

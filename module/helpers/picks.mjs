import Compendium from "../apps/compendium.mjs";
import { findSkill } from "../apps/compendium-context.mjs";
import { FEO } from "../config.mjs";
import { pickStates, picksLocked, picksOpen, planPick } from "../rules/picks.mjs";

/**
 * What a skill has its unit pick as it is learnt, as it is asked in Foundry: once, wherever the skill is gained
 * (in the Character Creator, on a level up or a promotion that grants it, from a Skill Scroll, dropped on a
 * sheet), then kept on the skill and locked for players. What can be picked, and what a pick changes, is
 * decided by the pure rules in `rules/picks.mjs`.
 *
 * A short pick is asked in a small dialog of tiles. A long one, or one whose options say what they do, opens
 * the Compendium at the skill, where the options are listed under its Effect.
 */

const TEMPLATE = `systems/${FEO.id}/templates/dialog/skill-picks.hbs`;

/** A pick with more options than this, or with options that say what they do, is made in the Compendium. */
const SHORT = 4;

/** What is still being asked of each unit, so that one question follows another. */
const queue = new Map();

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The unit a skill is on, when it is on one. A token that is not linked keeps its Items on its delta.
 * @param {Item} item
 * @returns {Actor|null}
 */
function unitOf(item) {
  if ( item?.type !== "skill" ) return null;
  const parent = item.parent;
  const actor = parent?.documentName === "ActorDelta" ? parent.syntheticActor : parent;
  return (actor?.documentName === "Actor") && (actor.type === "unit") ? actor : null;
}

/* -------------------------------------------- */

/**
 * Is a unit still being made in the Character Creator? Nothing it picks is locked until it is finished.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isCreating(actor) {
  return actor?.system?.creation?.status === "draft";
}

/* -------------------------------------------- */

/**
 * What a pick may need to know of the unit that makes it.
 * @param {Actor|null} actor
 * @returns {import("../rules/picks.mjs").PickUnit}
 */
export function pickUnit(actor) {
  const system = actor?.system ?? {};
  const lowest = Object.keys(FEO.ranks)[0];
  const ranked = Object.entries(system.proficiencies ?? {}).filter(([, proficiency]) => proficiency.rank && (proficiency.rank !== lowest)).map(([key]) => key);
  return {
    proficiencies: ranked.length ? ranked : Object.keys(FEO.proficiencies),
    start: system.creation?.ranks?.first ?? "",
    creating: isCreating(actor)
  };
}

/* -------------------------------------------- */

/**
 * The picks of a skill as they stand on its unit, for whoever shows them.
 * @param {Item} item
 * @returns {{states: import("../rules/picks.mjs").PickState[], open: boolean, locked: boolean, can: boolean}}
 *   `open` while something is still to be picked, `locked` once nothing can be changed by this user, and `can`
 *   when this user may pick or change something
 */
export function picksOf(item) {
  const actor = unitOf(item);
  const unit = pickUnit(actor);
  const states = pickStates(item.system, unit).filter((state) => !state.given);
  const locked = picksLocked(item.system, { gm: game.user.isGM, creating: unit.creating }, unit);
  return { states, open: states.some((state) => state.open), locked, can: !!states.length && item.isOwner && !locked };
}

/* -------------------------------------------- */

/**
 * Is a pick long: more than a handful of options, or options that say what they do?
 * @param {import("../rules/picks.mjs").PickState[]} states
 * @returns {boolean}
 */
export function isLong(states) {
  return states.some((state) => (state.options.length > SHORT) || state.options.some((option) => option.hint));
}

/* -------------------------------------------- */

/**
 * The picks of a skill as a template shows them, with what would be picked written as `choice`.
 * @param {object} skill        The skill's data, with the choice to show
 * @param {import("../rules/picks.mjs").PickUnit} unit
 * @returns {{picks: object[], done: boolean, summary: string}}
 */
export function describePicks(skill, unit) {
  const i18n = game.i18n;
  const states = pickStates(skill, unit);
  const picks = states.map((state, index) => ({ state, index })).filter(({ state }) => !state.given).map(({ state, index }) => {
    const { pick } = state;
    const tally = pick.points
      ? i18n.format("FEO.Pick.points", { spent: state.spent, points: pick.points })
      : (pick.count > 1) ? i18n.format("FEO.Pick.count", { picked: state.picked.length, count: pick.count }) : "";
    return {
      index,
      label: pick.label || i18n.localize(`FEO.Pick.from.${pick.from || "variant"}`),
      tally,
      open: state.open,
      options: state.options.map((option) => {
        const pressed = state.picked.includes(option.value);
        return {
          value: option.value,
          label: option.localize ? i18n.localize(option.label) : option.label,
          hint: option.hint,
          cost: pick.points ? option.cost : null,
          pressed,
          barred: !pressed && !!pick.points && ((state.spent + option.cost) > pick.points)
        };
      })
    };
  });
  const said = picks.flatMap((pick) => pick.options.filter((option) => option.pressed).map((option) => option.label));
  return { picks, done: !states.some((state) => state.open), summary: said.join(", ") };
}

/* -------------------------------------------- */
/*  Picking                                     */
/* -------------------------------------------- */

/**
 * Save what was picked on a skill.
 * @param {Item} item
 * @param {string} choice
 * @returns {Promise<boolean>}
 */
async function save(item, choice) {
  if ( choice === item.system.choice ) return false;
  await item.update({ "system.choice": choice });
  return true;
}

/* -------------------------------------------- */

/**
 * Ask in a small dialog of tiles.
 * @param {Item} item
 * @param {Actor} actor
 * @returns {Promise<string|null>}    The skill's choice, or null if the dialog was closed
 */
async function askDialog(item, actor) {
  const unit = pickUnit(actor);
  let choice = item.system.choice ?? "";
  const skill = () => ({ ...item.system, choice });
  const render = async () => foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    ...describePicks(skill(), unit),
    effect: item.system.effect
  });
  const content = document.createElement("div");
  content.innerHTML = `<div class="feo-class-dialog feo-skill-picks">${await render()}</div>`;

  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.Pick.title", { unit: actor.name, skill: item.name }) },
    position: { width: 440 },
    content,
    buttons: [{
      action: "pick", label: "FEO.Pick.confirm", icon: "fa-solid fa-check", default: true,
      callback: () => choice
    }],
    rejectClose: false,
    render: (event, app) => {
      const root = app.element.querySelector(".feo-skill-picks");
      const confirm = app.element.querySelector('button[data-action="pick"]');
      const refresh = () => {
        if ( confirm ) confirm.disabled = picksOpen(skill(), unit);
      };
      root.addEventListener("click", async (click) => {
        const tile = click.target.closest("[data-pick]");
        if ( !tile ) return;
        const next = planPick(skill(), Number(tile.dataset.pick), tile.dataset.value, unit);
        if ( next === null ) return;
        choice = next;
        root.innerHTML = await render();
        refresh();
      });
      refresh();
    }
  });
}

/* -------------------------------------------- */

/**
 * Ask in the Compendium, at the skill's own page: its options are listed under its Effect, and a button at
 * the foot of the page confirms what was picked.
 * @param {Item} item
 * @param {Actor} actor
 * @param {object} entry        The skill as the Compendium's library keeps it
 * @param {(choice: string) => Promise<any>} take     Saves what was picked
 * @returns {Promise<Compendium>}
 */
function askCompendium(item, actor, entry, take) {
  const i18n = game.i18n;
  const unit = pickUnit(actor);
  let choice = item.system.choice ?? "";
  let saved = false;
  const skill = () => ({ ...item.system, choice });
  const mine = (shown) => shown?.id === entry.id;
  return Compendium.open({
    view: "skills",
    kind: entry.kind,
    skill: entry.id,
    chooser: {
      takes: "pick",
      actor: actor.uuid,
      picks: (shown) => (mine(shown) && !saved ? describePicks(skill(), unit).picks : null),
      toggle: (index, value) => {
        const next = planPick(skill(), index, value, unit);
        if ( next !== null ) choice = next;
      },
      describe: (shown) => {
        if ( !mine(shown) ) return { can: false, barred: true, text: i18n.format("FEO.Pick.elsewhere", { unit: actor.name, skill: item.name }) };
        const { done, summary } = describePicks(skill(), unit);
        if ( saved ) return { can: false, chosen: true, text: i18n.format("FEO.Pick.picked", { unit: actor.name, picked: summary }) };
        return {
          can: done,
          text: summary ? i18n.format("FEO.Pick.sofar", { unit: actor.name, picked: summary }) : i18n.format("FEO.Pick.ask", { unit: actor.name }),
          label: i18n.localize("FEO.Pick.confirm")
        };
      },
      choose: async () => {
        await take(choice);
        saved = true;
      },
      banner: () => ({ text: i18n.format("FEO.Pick.banner", { unit: actor.name, skill: item.name }), tags: [], note: i18n.localize("FEO.Pick.note") })
    }
  });
}

/* -------------------------------------------- */

/**
 * Ask what a skill has its unit pick, if this user may pick it: in the Compendium where the list is long and
 * the Compendium knows the skill, in a dialog otherwise.
 * @param {Item} item
 * @param {object} [options]
 * @param {(choice: string) => Promise<any>} [options.take]   Saves what was picked, in place of the usual way
 * @returns {Promise<boolean>}    Was the question put?
 */
export async function askPicks(item, { take = null } = {}) {
  const actor = unitOf(item);
  if ( !actor ) return false;
  const { states, can } = picksOf(item);
  if ( !can ) return false;
  const keep = take ?? ((choice) => save(item, choice));

  if ( isLong(states) ) {
    let entry = null;
    try {
      entry = findSkill(await Compendium.library(), item.name);
    } catch(err) {
      console.error(err);
    }
    if ( entry ) {
      await askCompendium(item, actor, entry, keep);
      return true;
    }
  }
  const choice = await askDialog(item, actor);
  if ( (choice !== null) && (choice !== undefined) && actor.items.has(item.id) ) await keep(choice);
  return true;
}

/* -------------------------------------------- */

/**
 * Ask for the picks of a skill a unit has just gained, once whatever is still being asked of the unit is
 * answered. A unit in the Character Creator is asked there instead.
 * @param {Item} item
 * @returns {Promise<void>}
 */
export function askLearnt(item) {
  const actor = unitOf(item);
  if ( !actor || isCreating(actor) ) return Promise.resolve();
  const work = async () => {
    if ( !actor.items.has(item.id) || !picksOf(item).open ) return;
    await askPicks(item);
  };
  const run = (queue.get(actor.uuid) ?? Promise.resolve()).then(work).catch((err) => console.error(err));
  queue.set(actor.uuid, run);
  run.then(() => {
    if ( queue.get(actor.uuid) === run ) queue.delete(actor.uuid);
  });
  return run;
}

/* -------------------------------------------- */

/**
 * Register what picks listen for. Called once, when the system starts.
 */
export function registerHooks() {
  // A skill gained by any means asks whoever gained it for what it picks
  Hooks.on("createItem", (item, options, userId) => {
    if ( (userId !== game.user.id) || (item.type !== "skill") || options?.[FEO.id]?.noPick ) return;
    askLearnt(item);
  });

  // What is picked is locked for players once it is complete
  Hooks.on("preUpdateItem", (item, changed, options, user) => {
    if ( (item.type !== "skill") || !("choice" in (changed.system ?? {})) || (changed.system.choice === item.system.choice) ) return true;
    const actor = unitOf(item);
    if ( !actor || game.user.isGM ) return true;
    const unit = pickUnit(actor);
    if ( !picksLocked(item.system, { gm: false, creating: unit.creating }, unit) ) return true;
    ui.notifications.warn(game.i18n.format("FEO.Pick.locked", { skill: item.name }));
    return false;
  });
}

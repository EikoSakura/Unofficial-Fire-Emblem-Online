import { FEO } from "../config.mjs";
import {
  checkGrowths, chooseSkill, planAssignment, planLevelGains, planPromotion, planUpdate
} from "../rules/classes.mjs";
import { skillFits } from "../rules/optional.mjs";
import { countsAsSkill } from "../rules/skills.mjs";
import {
  buildAssignDialog, buildChangeCard, buildPromotionDialog, buildSkillPickDialog
} from "../sheets/class-context.mjs";
import { postCard } from "./chat.mjs";
import { promotionLifeUpdate } from "./optional.mjs";

/**
 * Taking a class and promoting, as they happen in Foundry: finding classes, asking the player, saving the
 * result and posting a card. What changes is decided by the pure rules in `rules/classes.mjs`.
 *
 * @import {ClassChange} from "../rules/classes.mjs"
 */

const TEMPLATES = `systems/${FEO.id}/templates/dialog`;

/* -------------------------------------------- */
/*  Finding Classes and Skills                  */
/* -------------------------------------------- */

/**
 * Find an Item by name, in the world first and then in every Item compendium.
 * @param {string} type                       The Item type to look for
 * @param {string} name
 * @param {(entry: object) => number} [rank]  Scores a match from its type data; the highest score wins
 * @returns {Promise<Item|null>}
 */
export async function findItem(type, name, rank = () => 0) {
  const wanted = name.trim().toLowerCase();
  if ( !wanted ) return null;
  const matches = (entry) => (entry.type === type) && (entry.name.trim().toLowerCase() === wanted);
  const best = (entries) => entries.reduce((top, entry) => (!top || (rank(entry) > rank(top)) ? entry : top), null);

  const local = best(game.items.filter(matches));
  if ( local ) return local;

  const found = [];
  for ( const pack of game.packs ) {
    if ( pack.documentName !== "Item" ) continue;
    const index = await pack.getIndex({ fields: ["system.tier"] });
    for ( const entry of index ) {
      if ( matches(entry) ) found.push({ ...entry, pack });
    }
  }
  const top = best(found);
  return top ? top.pack.getDocument(top._id) : null;
}

/* -------------------------------------------- */

/**
 * Gather the names of every Skill in the world and in the Item compendiums, to tell a skill whose own name has
 * a comma or an "or" in it from a list of skills.
 * @returns {Promise<(name: string) => boolean>}    Is this the name of a skill?
 */
export async function knownSkills() {
  const fold = (name) => String(name ?? "").trim().toLowerCase();
  const names = new Set(game.items.filter((item) => item.type === "skill").map((item) => fold(item.name)));
  for ( const pack of game.packs ) {
    if ( pack.documentName !== "Item" ) continue;
    const index = await pack.getIndex();
    for ( const entry of index ) {
      if ( entry.type === "skill" ) names.add(fold(entry.name));
    }
  }
  return (name) => names.has(fold(name));
}

/* -------------------------------------------- */

/**
 * Find the classes a class promotes to. A link is followed when there is one; otherwise the class is looked up
 * by name, preferring one of the next tier.
 * @param {Item} cls
 * @returns {Promise<(Item|{name: string, missing: true})[]>}   In the order the class lists them
 */
export async function findPromotions(cls) {
  const order = FEO.classTiers[cls.system.tier]?.order ?? 0;
  const nextTier = (entry) => ((FEO.classTiers[entry.system?.tier]?.order === order + 1) ? 1 : 0);
  const targets = [];
  for ( const target of cls.system.promotesTo ) {
    let found = target.uuid ? await foundry.utils.fromUuid(target.uuid) : null;
    if ( found?.type !== "class" ) found = await findItem("class", target.name, nextTier);
    targets.push(found ?? { name: target.name, missing: true });
  }
  return targets;
}

/* -------------------------------------------- */

/**
 * Add skills a unit has learned to it as Items. A Skill of the same name in the world or a compendium is
 * copied; otherwise a Skill is made with only its name and kind. Skills the unit already has are left alone.
 * @param {Actor} actor
 * @param {{name: string, kind: string}[]} skills
 * @returns {Promise<{added: string[], blank: string[]}>}   Names added, and those among them made blank
 */
export async function grantSkills(actor, skills) {
  const owned = new Set(actor.items.filter((item) => item.type === "skill").map((item) => item.name.toLowerCase()));
  // The room the unit has: its slots, and with Skill Capacity its Capacity Points. Each skill added uses some
  const had = actor.system.skillRoom;
  const room = had ? { ...had } : {
    capacity: false, limit: null, spent: 0, slots: actor.system.skillSlots ?? FEO.skillSlots,
    used: actor.items.filter((item) => (item.type === "skill") && item.system.equipped && countsAsSkill(item.system.effect)).length
  };
  const data = [];
  const blank = [];
  for ( const skill of skills ) {
    if ( owned.has(skill.name.toLowerCase()) ) continue;
    owned.add(skill.name.toLowerCase());
    const source = await findItem("skill", skill.name);
    const entry = source
      ? (source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject())
      : { name: skill.name, type: "skill", system: { kind: skill.kind } };
    if ( !source ) blank.push(skill.name);
    entry.system ??= {};
    // What its Effect says is not a skill takes no slot
    const slotted = countsAsSkill(entry.system.effect);
    entry.system.equipped = !slotted || skillFits(room, entry.system.capacity).ok;
    if ( entry.system.equipped && slotted ) {
      room.used++;
      room.spent += entry.system.capacity ?? 0;
    }
    delete entry._id;
    data.push(entry);
  }
  if ( data.length ) await actor.createEmbeddedDocuments("Item", data);
  return { added: data.map((entry) => entry.name), blank };
}

/* -------------------------------------------- */

/**
 * Copy a class onto a unit as one of its own Items.
 * @param {Actor} actor
 * @param {Item} cls
 * @returns {Promise<Item>}
 */
export async function embedClass(actor, cls) {
  if ( cls.parent === actor ) return cls;
  const data = cls.inCompendium ? game.items.fromCompendium(cls, { clearFolder: true }) : cls.toObject();
  delete data._id;
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/* -------------------------------------------- */

/**
 * Render a dialog template into an element.
 * @param {string} name       The template's file name without its extension
 * @param {string} cls        The class of the wrapping element
 * @param {object} data
 * @returns {Promise<HTMLDivElement>}
 */
async function dialogContent(name, cls, data) {
  const content = document.createElement("div");
  const html = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/${name}.hbs`, data);
  content.innerHTML = `<div class="${cls}">${html}</div>`;
  return content;
}

/** Read a dialog's form. */
const readForm = (form) => new foundry.applications.ux.FormDataExtended(form).object;

/* -------------------------------------------- */
/*  Taking a Class                              */
/* -------------------------------------------- */

/**
 * Give a unit a class, after asking what of the class to apply to it.
 * The class it had, if any, is replaced; classes it promoted out of are kept.
 * @param {Actor} actor
 * @param {Item} cls            A class Item from the world, a compendium or the unit itself
 * @returns {Promise<ClassChange|null>}   Null if the player backed out
 */
export async function assignClass(actor, cls) {
  const unit = actor._source.system;
  const current = actor.system.classItem;
  if ( current && (cls.parent === actor) && (cls.id === current.id) ) return null;

  const fresh = !current && (unit.hp.max === 0) && Object.values(unit.stats).every((stat) => stat.base === 0);
  const known = await knownSkills();
  const dialog = buildAssignDialog({ ...unit, className: actor.system.className }, cls, { fresh, known });
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.ClassAssign.title", { name: actor.name }) },
    position: { width: 480 },
    content: await dialogContent("class-assign", "feo-class-dialog feo-class-assign", dialog),
    buttons: [
      { action: "apply", label: "FEO.ClassAssign.confirm", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => readForm(button.form) },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( !answer || (answer === "cancel") ) return null;

  const ranks = {};
  if ( answer.proficiencies ) {
    for ( const key of cls.system.proficiencies.options ) {
      if ( answer[`rank.${key}`] ) ranks[key] = answer[`rank.${key}`];
    }
  }
  const change = planAssignment(unit, cls, {
    stats: !!answer.stats,
    weight: !!answer.weight,
    qualities: !!answer.qualities,
    proficiencies: ranks,
    skills: !!answer.skills,
    pick: answer.skillPick ?? null,
    known
  });

  const owned = await embedClass(actor, cls);
  if ( current && (current.id !== owned.id) ) await current.delete();
  await actor.update({ ...planUpdate(change), "system.classId": owned.id });
  const { blank } = await grantSkills(actor, change.skills);
  await postCard(actor, buildChangeCard(change, game.i18n, {
    subtitle: [FEO.classTiers[cls.system.tier]?.label, FEO.races[cls.system.race]?.label]
      .filter(Boolean).map((label) => game.i18n.localize(label)).join(" · "),
    blank
  }), { template: "class-change" });
  return change;
}

/* -------------------------------------------- */
/*  Promotion                                   */
/* -------------------------------------------- */

/**
 * Promote a unit: show the classes its class promotes to, and apply the one chosen.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.levelUp]   Is this the promotion that takes the place of a level up? It then spends
 *                                      the experience of a level and grants its ability points.
 * @returns {Promise<ClassChange|null>} Null if nothing was done
 */
export async function promoteUnit(actor, { levelUp = false } = {}) {
  const system = actor.system;
  const unit = actor._source.system;
  const from = system.classItem;
  if ( !from?.system.promotes ) return null;

  const found = await findPromotions(from);
  const targets = found.filter((target) => !target.missing);
  const missing = found.filter((target) => target.missing).map((target) => target.name);
  if ( !targets.length ) {
    ui.notifications.warn(game.i18n.format("FEO.Promotion.warn.notFound", { names: missing.join(", ") }));
    return null;
  }

  const known = await knownSkills();
  const dialog = buildPromotionDialog(unit, from, targets, { known });
  dialog.missing = missing.join(", ");
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.Promotion.title", { name: actor.name }) },
    position: { width: Math.min(260 + (targets.length * 200), 860) },
    content: await dialogContent("promotion", "feo-class-dialog feo-promotion", dialog),
    buttons: [
      { action: "promote", label: "FEO.LevelUp.promote", icon: "fa-solid fa-angles-up", default: true,
        callback: (event, button) => readForm(button.form) },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false,
    render: (event, app) => activatePromotionDialog(app.element, unit.growths)
  });
  if ( !answer || (answer === "cancel") ) return null;

  const index = Number(answer.target ?? 0);
  const to = targets[index];
  const card = dialog.classes[index];
  const picked = card.mustChoose
    ? card.proficiencies.filter((entry) => answer[`prof.${index}.${entry.key}`]).map((entry) => entry.key)
    : null;
  const growths = { ...unit.growths };
  for ( const key of Object.keys(growths) ) {
    const value = answer[`growth.${key}`];
    if ( Number.isFinite(value) ) growths[key] = value;
  }
  const change = planPromotion(unit, from, to, {
    proficiencies: picked,
    growths,
    generic: answer.skill === "generic",
    pick: answer[`pick.${index}`] ?? null,
    known
  });

  const owned = await embedClass(actor, to);
  const update = { ...planUpdate(change), "system.classId": owned.id };
  const notes = [];
  if ( levelUp ) {
    const points = system.checkPointsPerLevel;
    update["system.exp"] = Math.max(system.exp - FEO.expPerLevel, 0);
    update["system.checkPoints"] = system.checkPoints + points;
    notes.push(game.i18n.format("FEO.Promotion.abilityPoints", { points }));
  }

  // With Additional Lives, promoting grants one more life in total and restores one
  const lives = promotionLifeUpdate(actor);
  if ( "system.lives.max" in lives ) {
    Object.assign(update, lives);
    notes.push(game.i18n.format("FEO.Optional.lives.promotionNote", {
      left: lives["system.lives.value"],
      limit: lives["system.lives.max"]
    }));
  }
  await actor.update(update);
  const { blank } = await grantSkills(actor, change.skills);
  await postCard(actor, buildChangeCard(change, game.i18n, {
    subtitle: game.i18n.format("FEO.Promotion.fromTo", { from: from.name, to: to.name }),
    blank,
    notes
  }), { template: "class-change" });
  return change;
}

/* -------------------------------------------- */
/*  Levelling in a Class                        */
/* -------------------------------------------- */

/**
 * Ask which of the skills a class offers a unit learns.
 * @param {Actor} actor
 * @param {{names: string[], kind: string}} choice
 * @returns {Promise<string|null>}    The name picked, or null if the dialog was closed
 */
async function askSkill(actor, choice) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.SkillPick.title", { name: actor.name }) },
    position: { width: 400 },
    content: await dialogContent("skill-pick", "feo-class-dialog feo-skill-pick", buildSkillPickDialog(choice)),
    buttons: [
      { action: "learn", label: "FEO.SkillPick.confirm", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => readForm(button.form) }
    ],
    rejectClose: false
  });
  return answer?.skill ?? null;
}

/* -------------------------------------------- */

/**
 * The unit's classes, current class first and then those it promoted out of, latest first.
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function classesOf(actor) {
  const current = actor.system.classItem;
  if ( !current ) return [];
  const order = (item) => FEO.classTiers[item.system.tier]?.order ?? 0;
  const earlier = actor.items.filter((item) => (item.type === "class") && (item !== current));
  return [current, ...earlier.sort((a, b) => order(b) - order(a))];
}

/* -------------------------------------------- */

/**
 * Apply what a unit's classes give it on reaching a level by levelling up, and post a card if anything changed.
 * @param {Actor} actor       The unit, after the level up has been saved
 * @param {number} level      The level just reached
 * @returns {Promise<ClassChange|null>}
 */
export async function applyLevelGains(actor, level) {
  const known = await knownSkills();
  const change = planLevelGains(actor._source.system, classesOf(actor), level, { known });
  if ( !change ) return null;

  // Where the class offers a choice of skill, ask. A choice left unanswered stays on the card as still to make
  for ( let index = 0; index < change.choices.length; ) {
    const name = await askSkill(actor, change.choices[index]);
    if ( !chooseSkill(change, index, name) ) index++;
  }

  const update = planUpdate(change);
  if ( Object.keys(update).length ) await actor.update(update);
  const { blank } = await grantSkills(actor, change.skills);
  await postCard(actor, buildChangeCard(change, game.i18n, {
    title: game.i18n.format("FEO.Class.card.milestone", { level }),
    subtitle: actor.system.className,
    blank
  }), { template: "class-change" });
  return change;
}

/* -------------------------------------------- */

/**
 * Bring the promotion dialog to life: picking a class by clicking its card, keeping the tally of growth rates
 * current, and holding the Promote button until the choices add up.
 * @param {HTMLElement} element                 The dialog's element
 * @param {Record<string, number>} current      The unit's growth rates before promoting
 */
function activatePromotionDialog(element, current) {
  const root = element.querySelector(".feo-promotion");
  if ( !root || root.dataset.live ) return;
  root.dataset.live = "true";
  const form = root.closest("form");
  const confirm = element.querySelector('button[data-action="promote"]');
  const tally = root.querySelector("[data-tally]");
  const list = root.querySelector("[data-problems]");
  const skillChoice = root.querySelector(".skill-choice");

  const refresh = () => {
    const chosen = root.querySelector('input[name="target"]:checked')?.closest(".choice");
    for ( const card of root.querySelectorAll(".choice") ) card.classList.toggle("selected", card === chosen);
    const problems = [];

    // A Generic Skill may only take the place of a Promotion Skill
    if ( skillChoice ) {
      const allowed = chosen ? ("generic" in chosen.dataset) : false;
      skillChoice.hidden = !allowed;
      if ( !allowed ) skillChoice.querySelector('input[value="class"]').checked = true;
    }

    // A class that offers a choice of proficiencies
    const choose = Number(chosen?.dataset.choose ?? 0);
    let blocked = !chosen;
    if ( choose ) {
      const picked = chosen.querySelectorAll('input[type="checkbox"]:checked').length;
      if ( picked !== choose ) {
        blocked = true;
        problems.push(game.i18n.format("FEO.Promotion.problem.choose", { count: choose }));
      }
    }

    // Growth rates
    const planned = {};
    for ( const input of root.querySelectorAll("input[data-growth]") ) {
      planned[input.dataset.growth] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : NaN;
    }
    const filled = Object.values(planned).every(Number.isFinite);
    const check = checkGrowths(current, filled ? planned : current);
    if ( !filled ) blocked = true;
    else {
      for ( const problem of check.problems ) {
        problems.push(game.i18n.format(`FEO.Promotion.problem.${problem.code}`, {
          stat: problem.key ? game.i18n.localize(FEO.growths[problem.key]) : "",
          gained: check.gained,
          expected: check.expected,
          moved: check.moved,
          limit: FEO.promotionGrowth.reallocate,
          over: FEO.promotionGrowth.capBreak
        }));
      }
      if ( !check.valid ) blocked = true;
    }
    tally.textContent = game.i18n.format("FEO.Promotion.tally", { gained: filled ? check.gained : "–", expected: check.expected });
    tally.classList.toggle("bad", !filled || !check.valid);
    list.replaceChildren(...problems.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    if ( confirm ) confirm.disabled = blocked;
  };

  root.addEventListener("click", (event) => {
    const card = event.target.closest(".choice");
    if ( !card || event.target.closest("input, label, a, button") ) return;
    const radio = card.querySelector('input[name="target"]');
    radio.checked = true;
    refresh();
  });
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  refresh();
}

import Compendium from "../apps/compendium.mjs";
import { FEO } from "../config.mjs";
import { chooseSkill, classLine, planReclass, planUpdate, reclassTrade } from "../rules/classes.mjs";
import { addSealClass, removeSealClass, sealClasses, sealClassesAfter } from "../rules/optional.mjs";
import { topRanks } from "../rules/supports.mjs";
import { buildChangeCard, buildReclassDialog } from "../sheets/class-context.mjs";
import { postCard } from "./chat.mjs";
import { classesOf, embedClass, findItem, findPromotions, grantSkills, knownSkills } from "./classes.mjs";

/**
 * Heart Seals and Reclassing, as they happen in Foundry: keeping a unit's list of Heart Seal Classes, finding
 * the classes it can reclass into, asking the player, saving the result and posting a card, and offering a
 * partner's class when a support reaches its highest rank. A Heart Scale adds a class to the list, and a Second
 * Seal reclasses a unit into the line of any class a unit can start in. What changes is decided by the pure
 * rules in `rules/classes.mjs` and `rules/optional.mjs`. Nothing here does anything while the world setting is
 * off.
 *
 * @import {ClassChange} from "../rules/classes.mjs"
 * @import {SealClass} from "../rules/optional.mjs"
 */

const TEMPLATES = `systems/${FEO.id}/templates/dialog`;
const order = (cls) => FEO.classTiers[cls?.system?.tier]?.order ?? 0;
const config = () => FEO.optional.heartSeals;

/* -------------------------------------------- */
/*  The list                                    */
/* -------------------------------------------- */

/**
 * The class a unit's own line starts in: the lowest of the classes it holds, when that is one a unit starts in.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function startingClassOf(actor) {
  const [first] = classLine(classesOf(actor));
  return first && (order(first) <= FEO.classTiers.base.order) ? first : null;
}

/* -------------------------------------------- */

/**
 * A unit's Heart Seal Classes: the class its own line starts in, then those chosen for it.
 * @param {Actor} actor
 * @returns {SealClass[]}
 */
export function sealClassesOf(actor) {
  const starting = startingClassOf(actor);
  const source = starting?._stats?.compendiumSource ?? "";
  return sealClasses(actor._source.system.heartSeals, starting ? { name: starting.name, uuid: source } : null);
}

/* -------------------------------------------- */

/**
 * The class a unit is a guest of: the one its line starts in, where a Second Seal took it there and it is not
 * one of its Heart Seal Classes.
 * @param {Actor} actor
 * @returns {string}    Its name, or "" for a unit whose line starts in a class of its own
 */
export function guestClassOf(actor) {
  const guest = String(actor._source.system.heartSealGuest ?? "").trim();
  return (guest && (startingClassOf(actor)?.name.toLowerCase() === guest.toLowerCase())) ? guest : "";
}

/* -------------------------------------------- */

/**
 * A unit's Heart Seal Classes as its sheet shows them, each with the picture of its class where one is known:
 * its own for the class the unit holds, and otherwise the one the compendium lists for the class it links.
 * @param {Actor} actor
 * @returns {(SealClass & {img: string})[]}
 */
export function sealCardsOf(actor) {
  const starting = startingClassOf(actor);
  return sealClassesOf(actor).map((entry) => {
    let img = entry.starting ? starting?.img : null;
    if ( !img && entry.uuid ) {
      try {
        img = foundry.utils.fromUuidSync(entry.uuid, { strict: false })?.img;
      } catch(err) {
        img = null;
      }
    }
    return { ...entry, img: img ?? "" };
  });
}

/* -------------------------------------------- */

/**
 * Put a class on a unit's list, or take one off.
 * @param {Actor} actor
 * @param {{name: string, uuid?: string}} cls
 * @param {object} [options]
 * @param {number|null} [options.limit]     The most the unit may choose; null for no limit
 * @returns {Promise<boolean>}              Was the list changed?
 */
export async function addSealClassTo(actor, cls, { limit = null } = {}) {
  const list = addSealClass(actor._source.system.heartSeals, cls, { starting: startingClassOf(actor), limit });
  if ( !list ) return false;
  await actor.update({ "system.heartSeals": list });
  return true;
}

export async function removeSealClassFrom(actor, name) {
  const list = removeSealClass(actor._source.system.heartSeals, name);
  if ( !list ) return false;
  await actor.update({ "system.heartSeals": list });
  return true;
}

/* -------------------------------------------- */

/**
 * Open the Compendium at the class tree, with a button on its class sheet that puts the class on a unit's list
 * of Heart Seal Classes. Only a class a unit can start in may be chosen.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {number|null} [options.limit]     The most the unit may choose; null for no limit
 * @param {boolean} [options.scale]         Does each class cost the unit a Heart Scale it carries? The class it
 *                                          is a guest of may then be chosen too, which makes it its own
 * @returns {Promise<Compendium|null>}
 */
export function openSealTree(actor, { limit = null, scale = false } = {}) {
  if ( !config().enabled ) return null;
  const i18n = game.i18n;
  const base = FEO.classTiers.base.order;
  const unit = actor.name;
  const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  const guest = (cls) => scale && same(guestClassOf(actor), cls.name);
  const describe = (cls) => {
    const list = sealClassesOf(actor);
    const chosen = actor._source.system.heartSeals.length;
    if ( cls.order > base ) return { can: false, text: i18n.format("FEO.HeartSeal.tree.promotion", { unit }) };
    if ( !guest(cls) && list.some((entry) => same(entry.name, cls.name)) ) {
      return { can: false, chosen: true, text: i18n.format("FEO.HeartSeal.tree.chosen", { unit }) };
    }
    if ( scale && !heartScaleOf(actor) ) return { can: false, text: i18n.format("FEO.HeartSeal.tree.noScale", { unit, item: config().scale }) };
    if ( (limit !== null) && (chosen >= limit) ) return { can: false, text: i18n.format("FEO.HeartSeal.tree.full", { unit, count: limit }) };
    return {
      can: true,
      text: scale ? i18n.format("FEO.HeartSeal.tree.scale", { unit, item: config().scale })
        : (limit !== null) ? i18n.format("FEO.HeartSeal.tree.take", { unit, left: limit - chosen })
          : i18n.format("FEO.HeartSeal.tree.add", { unit }),
      label: i18n.format("FEO.HeartSeal.tree.choose", { name: cls.name.split("/")[0] })
    };
  };
  const choose = async (cls) => {
    if ( !scale ) return addSealClassTo(actor, { name: cls.name, uuid: cls.uuid ?? "" }, { limit });
    const item = heartScaleOf(actor);
    if ( !item ) return false;
    if ( guest(cls) ) await actor.update({ "system.heartSealGuest": "" });
    else if ( !(await addSealClassTo(actor, { name: cls.name, uuid: cls.uuid ?? "" })) ) return false;
    const spent = item.name;
    await spendItem(item);
    await postCard(actor, {
      title: i18n.format("FEO.HeartSeal.partner.cardTitle", { name: cls.name }),
      subtitle: i18n.format("FEO.HeartSeal.card.spent", { item: spent }),
      rows: []
    });
    return true;
  };
  return Compendium.open({
    view: "classes",
    class: actor.system.classItem?.name,
    chooser: { takes: "class", actor: actor.uuid, describe, choose }
  });
}

/* -------------------------------------------- */
/*  The items                                   */
/* -------------------------------------------- */

/**
 * The item of a name a unit carries, if it carries one that is not used up.
 * @param {Actor} actor
 * @param {string} name
 * @returns {Item|null}
 */
function carriedItem(actor, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if ( !wanted ) return null;
  return actor.items.find((item) => (item.type === "gear") && (item.name.trim().toLowerCase() === wanted) && !item.system.spent) ?? null;
}

/** The Heart Seal a unit carries, if it carries one: what a reclass into one of its Heart Seal Classes spends. */
export const heartSealOf = (actor) => carriedItem(actor, config().item);

/** The Heart Scale a unit carries, if it carries one: what one more Heart Seal Class costs it. */
export const heartScaleOf = (actor) => carriedItem(actor, config().scale);

/** The Second Seal a unit carries, if it carries one: what a reclass into any class spends. */
export const secondSealOf = (actor) => carriedItem(actor, config().second);

/* -------------------------------------------- */

/**
 * Spend one use of an item, and remove it with its last.
 * @param {Item} item
 * @returns {Promise<void>}
 */
async function spendItem(item) {
  const uses = item.system.uses;
  if ( (uses?.max > 0) && (uses.value > 1) ) await item.update({ "system.uses.value": uses.value - 1 });
  else await item.delete();
}

/* -------------------------------------------- */

/**
 * Which of the items Heart Seals go by an item is, by its name.
 * @param {Item} item
 * @returns {"item"|"scale"|"second"|null}    Null for any other item, and while the setting is off
 */
function sealItemKind(item) {
  if ( !config().enabled || (item?.type !== "gear") ) return null;
  const name = item.name.trim().toLowerCase();
  return ["item", "scale", "second"].find((kind) => name === String(config()[kind] ?? "").trim().toLowerCase()) ?? null;
}

/** Is an item a Heart Seal, a Heart Scale or a Second Seal, while the setting is on? */
export const isSealItem = (item) => !!sealItemKind(item);

/* -------------------------------------------- */

/**
 * What Using one of those items does: a Heart Seal reclasses its unit, a Heart Scale adds a class to its list,
 * and a Second Seal reclasses it into any class. Each is spent as that is done, and not before.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Promise<boolean>}    Was it one of them?
 */
export async function useSealItem(actor, item) {
  const kind = sealItemKind(item);
  if ( kind === "item" ) await reclassUnit(actor);
  else if ( kind === "scale" ) await openSealTree(actor, { scale: true });
  else if ( kind === "second" ) await reclassUnit(actor, { any: true });
  return !!kind;
}

/* -------------------------------------------- */
/*  Reclassing                                  */
/* -------------------------------------------- */

/**
 * Find the class a Heart Seal Class stands for: the one it links, or else the one of its name that a unit can
 * start in.
 * @param {SealClass} entry
 * @returns {Promise<Item|null>}
 */
async function findSealClass(entry) {
  let found = entry.uuid ? await foundry.utils.fromUuid(entry.uuid) : null;
  if ( found?.type !== "class" ) {
    const base = FEO.classTiers.base.order;
    found = await findItem("class", entry.name, (cls) => ((FEO.classTiers[cls.system?.tier]?.order ?? 0) <= base ? 1 : 0));
  }
  return (found?.type === "class") ? found : null;
}

/* -------------------------------------------- */

/**
 * The lines of classes that run from a class a unit starts in to a class of a given tier: the class itself
 * for a unit of its tier, and otherwise every way of promoting from it up to that tier.
 * @param {Item} start
 * @param {number} tier         The place of the tier among the tiers
 * @returns {Promise<Item[][]>}
 */
export async function linesFrom(start, tier) {
  let lines = [[start]];
  for ( let guard = 0; guard < 6; guard++ ) {
    const done = lines.filter((line) => order(line.at(-1)) >= tier);
    const open = lines.filter((line) => order(line.at(-1)) < tier);
    if ( !open.length ) return done.filter((line) => order(line.at(-1)) === tier);
    const grown = [];
    for ( const line of open ) {
      const last = line.at(-1);
      const targets = last.system.promotesTo?.length ? await findPromotions(last) : [];
      for ( const target of targets ) {
        if ( target.missing || (order(target) <= order(last)) ) continue;
        grown.push([...line, target]);
      }
    }
    lines = [...done, ...grown];
  }
  return lines.filter((line) => order(line.at(-1)) === tier);
}

/* -------------------------------------------- */

/**
 * Render a dialog template into an element.
 * @param {string} name
 * @param {string} cls
 * @param {object} data
 * @returns {Promise<HTMLDivElement>}
 */
async function dialogContent(name, cls, data) {
  const content = document.createElement("div");
  const html = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/${name}.hbs`, data);
  content.innerHTML = `<div class="${cls}">${html}</div>`;
  return content;
}

const readForm = (form) => new foundry.applications.ux.FormDataExtended(form).object;

/* -------------------------------------------- */

/**
 * Reclass a unit: show the classes its Heart Seal Classes let it take at the tier it is in, and apply the one
 * chosen. A player's unit spends the Heart Seal it carries; the Game Master may reclass a unit that has none.
 *
 * With `any`, the unit reclasses into the line of any class a unit can start in, which is chosen from the class
 * tree first, and spends the Second Seal it carries in place of a Heart Seal.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.any]         Is any class open to it, as with a Second Seal?
 * @returns {Promise<ClassChange|null>}   Null if nothing was done, or where the class tree was opened to choose
 */
export async function reclassUnit(actor, { any = false } = {}) {
  if ( !config().enabled ) return null;
  const i18n = game.i18n;
  if ( !actor.system.classItem ) {
    ui.notifications.warn("FEO.HeartSeal.warn.noClass", { localize: true });
    return null;
  }
  const carried = () => (any ? secondSealOf(actor) : heartSealOf(actor));
  if ( !carried() && !game.user.isGM ) {
    ui.notifications.warn(i18n.format("FEO.HeartSeal.warn.noSeal", { item: any ? config().second : config().item }));
    return null;
  }
  if ( !any ) return reclassInto(actor, sealClassesOf(actor), carried());

  // Any class: it is chosen from the class tree, which closes as the classes of its line are shown
  const base = FEO.classTiers.base.order;
  const unit = actor.name;
  const describe = (cls) => {
    if ( cls.order > base ) return { can: false, text: i18n.format("FEO.HeartSeal.tree.promotion", { unit }) };
    if ( !carried() && !game.user.isGM ) return { can: false, text: i18n.format("FEO.HeartSeal.warn.noSeal", { item: config().second }) };
    return {
      can: true,
      text: i18n.format("FEO.HeartSeal.tree.any", { unit }),
      label: i18n.format("FEO.HeartSeal.tree.reclass", { name: cls.name.split("/")[0] })
    };
  };
  let app = null;
  const choose = async (cls) => {
    await app?.close();
    reclassInto(actor, [{ name: cls.name, uuid: cls.uuid ?? "" }], carried(), { any: true }).catch((err) => console.error(err));
  };
  app = await Compendium.open({
    view: "classes",
    class: actor.system.classItem.name,
    chooser: { takes: "class", actor: actor.uuid, describe, choose }
  });
  return null;
}

/* -------------------------------------------- */

/**
 * Reclass a unit into a line of one of the classes given: show those of the tier it is in, and apply the one
 * chosen.
 * @param {Actor} actor
 * @param {SealClass[]} entries       The classes whose lines are open to it
 * @param {Item|null} seal            The item this spends; null for the Game Master, who needs none
 * @param {object} [options]
 * @param {boolean} [options.any]     Was the class chosen from all of them, as with a Second Seal?
 * @returns {Promise<ClassChange|null>}   Null if nothing was done
 */
async function reclassInto(actor, entries, seal, { any = false } = {}) {
  const i18n = game.i18n;
  const current = actor.system.classItem;

  // The line the unit holds, and every line those classes offer at its tier, but the class it has
  const unit = actor._source.system;
  const from = classLine(classesOf(actor));
  const tier = order(current);
  const lines = [];
  const missing = [];
  for ( const entry of entries ) {
    const start = await findSealClass(entry);
    if ( !start ) {
      missing.push(entry.name);
      continue;
    }
    for ( const line of await linesFrom(start, tier) ) {
      if ( line.at(-1).name.toLowerCase() === current.name.toLowerCase() ) continue;
      if ( lines.some((other) => other.map((cls) => cls.name).join(">") === line.map((cls) => cls.name).join(">")) ) continue;
      lines.push(line);
    }
  }
  if ( !lines.length ) {
    ui.notifications.warn(any
      ? i18n.format("FEO.HeartSeal.warn.noLine", { name: actor.name, class: entries[0]?.name ?? "" })
      : i18n.format("FEO.HeartSeal.warn.noTargets", { name: actor.name }));
    return null;
  }

  const known = await knownSkills();
  const dialog = buildReclassDialog(unit, from, lines, { known });
  dialog.missing = missing.join(", ");
  dialog.seal = seal ? i18n.format("FEO.HeartSeal.dialog.spends", { item: seal.name }) : i18n.localize("FEO.HeartSeal.dialog.noSeal");
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n.format("FEO.HeartSeal.dialog.title", { name: actor.name }) },
    position: { width: Math.min(300 + (Math.min(lines.length, 3) * 200), 900) },
    content: await dialogContent("reclass", "feo-class-dialog feo-promotion feo-reclass", dialog),
    buttons: [
      { action: "reclass", label: "FEO.HeartSeal.dialog.confirm", icon: "fa-solid fa-right-left", default: true,
        callback: (event, button) => readForm(button.form) },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false,
    render: (event, app) => activateReclassDialog(app.element, unit, from, lines)
  });
  if ( !answer || (answer === "cancel") ) return null;

  const index = Number(answer.target ?? 0);
  const to = lines[index];
  const { gain, lose } = readTrade(answer, index, dialog);
  const change = planReclass(unit, from, to, { gain, lose, known });
  if ( !change ) {
    ui.notifications.warn("FEO.HeartSeal.warn.trade", { localize: true });
    return null;
  }

  // Where the new line offers a choice of skill, the dialog asked. They are settled last first, so that the
  // places of those still open do not move; a choice left unanswered stays on the card
  const picks = change.choices.map((choice, at) => answer[`pick.${index}.${at}`] ?? null);
  for ( let at = picks.length - 1; at >= 0; at-- ) chooseSkill(change, at, picks[at]);

  // The classes of the new line take the place of those of the old one. The class the old line started in
  // stays on the unit's list of Heart Seal Classes, and the one the new line starts in needs no entry there.
  // A class that is not one of its own, which a Second Seal took it into, is its guest and is not kept
  const left = startingClassOf(actor);
  const { list, guest } = sealClassesAfter(unit.heartSeals, {
    left: left ? { name: left.name, uuid: left._stats?.compendiumSource ?? "" } : null,
    entered: to[0],
    guest: guestClassOf(actor)
  });
  const owned = [];
  for ( const cls of to ) owned.push(await embedClass(actor, cls));
  const update = { ...planUpdate(change), "system.classId": owned.at(-1).id };
  if ( JSON.stringify(list) !== JSON.stringify(unit.heartSeals) ) update["system.heartSeals"] = list;
  if ( guest !== String(unit.heartSealGuest ?? "") ) update["system.heartSealGuest"] = guest;
  await actor.update(update);
  const gone = actor.items.filter((item) => (item.type === "class") && !owned.some((cls) => cls.id === item.id)).map((item) => item.id);
  if ( gone.length ) await actor.deleteEmbeddedDocuments("Item", gone);
  const { blank } = await grantSkills(actor, change.skills);

  // The seal is spent
  const notes = [];
  if ( seal ) {
    const spent = seal.name;
    await spendItem(seal);
    notes.push(i18n.format("FEO.HeartSeal.card.spent", { item: spent }));
  }
  if ( guest ) notes.push(i18n.format("FEO.HeartSeal.card.guest", { name: guest }));
  if ( !change.statsKnown ) notes.push(i18n.localize("FEO.HeartSeal.card.statsUnknown"));
  if ( change.occultWaits ) notes.push(i18n.format("FEO.HeartSeal.card.occult", { skill: change.occultWaits, level: FEO.occultLevel }));
  await postCard(actor, buildChangeCard(change, i18n, {
    subtitle: i18n.format("FEO.Promotion.fromTo", { from: current.name, to: to.at(-1).name }),
    blank,
    notes
  }), { template: "class-change" });
  return change;
}

/* -------------------------------------------- */

/**
 * Read the trade of proficiencies the dialog's form holds for the class chosen.
 * @param {object} answer       The form's data
 * @param {number} index        The class chosen
 * @param {object} dialog       As `buildReclassDialog` built it
 * @returns {{gain: string[], lose: Record<string, number>}}
 */
function readTrade(answer, index, dialog) {
  const card = dialog.classes[index];
  const gain = card.proficiencies.filter((entry) => answer[`gain.${index}.${entry.key}`]).map((entry) => entry.key);
  const lose = {};
  for ( const entry of dialog.held ) {
    const amount = Number(answer[`lose.${entry.key}`]);
    if ( amount > 0 ) lose[entry.key] = amount;
  }
  return { gain, lose };
}

/* -------------------------------------------- */

/**
 * Bring the reclass dialog to life: picking a class by clicking its card, and holding the Reclass button
 * until the trade of proficiencies adds up.
 * @param {HTMLElement} element     The dialog's element
 * @param {object} unit             The unit's saved data
 * @param {Item[]} from             The line it holds
 * @param {Item[][]} lines          The lines it can reclass into
 */
function activateReclassDialog(element, unit, from, lines) {
  const root = element.querySelector(".feo-reclass");
  if ( !root || root.dataset.live ) return;
  root.dataset.live = "true";
  const form = root.closest("form");
  const confirm = element.querySelector('button[data-action="reclass"]');
  const tally = root.querySelector("[data-tally]");
  const list = root.querySelector("[data-problems]");

  const refresh = () => {
    const chosen = root.querySelector('input[name="target"]:checked')?.closest(".choice");
    for ( const card of root.querySelectorAll(".choice") ) card.classList.toggle("selected", card === chosen);
    const index = Number(chosen?.dataset.index ?? -1);
    const gain = chosen ? Array.from(chosen.querySelectorAll("input[data-gain]:checked"), (input) => input.dataset.gain) : [];
    const lose = {};
    for ( const input of root.querySelectorAll("input[data-lose]") ) {
      if ( input.valueAsNumber > 0 ) lose[input.dataset.lose] = input.valueAsNumber;
    }
    const trade = lines[index] ? reclassTrade(unit, from, lines[index], gain, lose) : null;
    if ( tally ) {
      tally.textContent = game.i18n.format("FEO.HeartSeal.dialog.tally", { owed: trade?.owed ?? 0, paid: trade?.paid ?? 0 });
      tally.classList.toggle("bad", !trade?.valid);
    }
    list?.replaceChildren(...(trade?.problems ?? []).map((problem) => {
      const item = document.createElement("li");
      item.textContent = game.i18n.format(`FEO.HeartSeal.dialog.problem.${problem.code}`, { owed: trade.owed });
      return item;
    }));
    if ( confirm ) confirm.disabled = !trade?.valid;
  };

  root.addEventListener("click", (event) => {
    const card = event.target.closest(".choice");
    if ( !card || event.target.closest("input, label, a, button, select") ) return;
    card.querySelector('input[name="target"]').checked = true;
    refresh();
  });
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  refresh();
}

/* -------------------------------------------- */
/*  A partner's classes                         */
/* -------------------------------------------- */

/**
 * A support has reached its highest rank: offer the unit one of its partner's Heart Seal Classes for its own
 * list. Nothing is asked when the partner has none the unit lacks.
 * @param {Actor} actor
 * @param {Actor} partner
 * @returns {Promise<string|null>}    The class added, or null
 */
export async function offerPartnerClass(actor, partner) {
  if ( !config().enabled || (partner?.type !== "unit") ) return null;
  const mine = new Set(sealClassesOf(actor).map((entry) => entry.name.toLowerCase()));
  // A class the partner is only a guest of is not one of theirs to share
  const guest = guestClassOf(partner).toLowerCase();
  const theirs = sealClassesOf(partner).filter((entry) => !mine.has(entry.name.toLowerCase()) && (entry.name.toLowerCase() !== guest));
  if ( !theirs.length ) return null;
  const i18n = game.i18n;
  const options = theirs.map((entry, index) => `<option value="${index}">${foundry.utils.escapeHTML(entry.name)}</option>`).join("");
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n.format("FEO.HeartSeal.partner.title", { name: actor.name }) },
    position: { width: 420 },
    content: `<p>${i18n.format("FEO.HeartSeal.partner.lead", {
      name: foundry.utils.escapeHTML(actor.name), partner: foundry.utils.escapeHTML(partner.name)
    })}</p><div class="form-group"><label>${i18n.localize("FEO.HeartSeal.title")}</label><div class="form-fields"><select name="class">${options}</select></div></div>`,
    buttons: [
      { action: "add", label: "FEO.HeartSeal.partner.confirm", icon: "fa-solid fa-plus", default: true,
        callback: (event, button) => readForm(button.form) },
      { action: "cancel", label: "FEO.HeartSeal.partner.later" }
    ],
    rejectClose: false
  });
  if ( !answer || (answer === "cancel") ) return null;
  const picked = theirs[Number(answer.class ?? 0)];
  if ( !picked || !(await addSealClassTo(actor, picked)) ) return null;
  await postCard(actor, {
    title: i18n.format("FEO.HeartSeal.partner.cardTitle", { name: picked.name }),
    subtitle: i18n.format("FEO.HeartSeal.partner.cardSubtitle", { partner: partner.name }),
    rows: []
  });
  return picked.name;
}

/* -------------------------------------------- */

/**
 * The partners with whom a unit's supports have just reached one of the highest ranks, from the bonds it had
 * before a change and those it has after it. A support that goes from one of them to the other has reached
 * nothing new.
 * @param {object[]} before     The unit's bonds before the change
 * @param {object[]} after      Its bonds after it
 * @param {string[]} ranks      The ranks that count
 * @returns {string[]}          The addresses of those partners' Actors
 */
export function newTopPartners(before, after, ranks) {
  const key = (bond) => bond.uuid || bond.name;
  const had = new Map((before ?? []).map((bond) => [key(bond), bond.rank]));
  return (after ?? []).filter((bond) => bond.uuid && ranks.includes(bond.rank) && !ranks.includes(had.get(key(bond)))).map((bond) => bond.uuid);
}

/* -------------------------------------------- */

/**
 * Register what Heart Seals listen for. Called once, when the system starts.
 */
export function registerHooks() {
  if ( !config().enabled ) return;

  // The bonds a unit had are noted before they change, and looked at again once they have
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if ( (actor.type !== "unit") || !changes.system?.bonds ) return;
    options.feoBondsBefore = foundry.utils.deepClone(actor._source.system.bonds);
  });
  Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if ( (userId !== game.user.id) || !options.feoBondsBefore || (actor.type !== "unit") ) return;
    for ( const uuid of newTopPartners(options.feoBondsBefore, actor._source.system.bonds, topRanks()) ) {
      try {
        const partner = await foundry.utils.fromUuid(uuid);
        await offerPartnerClass(actor, partner);
      } catch(err) {
        console.error(err);
      }
    }
  });
}

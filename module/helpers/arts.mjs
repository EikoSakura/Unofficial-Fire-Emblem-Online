import { FEO } from "../config.mjs";
import { canPerform, costFor, learnableArts, readCost, readyArt } from "../rules/arts.mjs";

/**
 * Combat Arts in Foundry: the Art a unit has readied for the next fight it initiates, readying one and putting
 * it away again, and carrying it into a fight.
 */

/**
 * A Combat Art as the rules read it.
 * @param {Item} item
 * @returns {{id: string, name: string, type: string, also: string, effect: string, cost: string, automate: boolean,
 *   effects: object[], left: string}}
 */
export function artData(item) {
  const { type, also, effect, cost, automate, effects, left } = item.system;
  return { id: item.id, name: item.name, type, also, effect, cost, automate, effects, left };
}

/* -------------------------------------------- */

/**
 * What the rules ask of a unit to tell whether it can perform an Art now.
 * @param {Actor} actor
 * @returns {object}
 */
export function performerOf(actor) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  return {
    hp: system.hp.value,
    weapon: weapon ? { category: weapon.system.category, uses: { ...weapon.system.uses } } : null,
    conditions: system.conditions ?? {},
    artCost: system.skills?.artCost ?? 0
  };
}

/* -------------------------------------------- */

/**
 * The Combat Art a unit has readied, where the world plays with Combat Arts.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function readiedArt(actor) {
  if ( !FEO.optional.combatArts.enabled ) return null;
  return actor.items.find((item) => (item.type === "art") && item.system.readied) ?? null;
}

/* -------------------------------------------- */

/**
 * A unit as it initiates a fight, performing the Art it has readied if it has one (see `readyArt`).
 * @param {Actor} actor
 * @param {import("../rules/combat.mjs").Combatant} unit    The unit as `combatantOf` describes it
 * @returns {import("../rules/combat.mjs").Combatant}
 */
export function withReadiedArt(actor, unit) {
  const art = readiedArt(actor);
  return art ? readyArt(unit, artData(art), { artCost: actor.system.skills?.artCost ?? 0 }) : unit;
}

/* -------------------------------------------- */

/**
 * What the dialog for learning an Art shows: the Arts a unit could learn now, folder by folder, each with its
 * Rank and what it costs this unit. Nothing here touches Foundry, so that it can be exercised outside of it.
 * @param {{id: string, name: string, folder?: string, system: object}[]} arts    The Arts of the compendium
 * @param {object} unit         What `learnableArts` asks of the unit, and `artCost`
 * @param {{localize: Function, format: Function}} i18n
 * @returns {{groups: {label: string, arts: {id: string, label: string}[]}[], effects: Record<string, string>, count: number}}
 */
export function buildLearnChoices(arts, unit, i18n) {
  const config = FEO.optional.combatArts;
  const plain = arts.map((art) => ({ id: art.id, name: art.name, folder: art.folder ?? "", ...art.system }));
  const groups = [];
  const effects = {};
  for ( const art of learnableArts(plain, unit) ) {
    const label = art.folder || i18n.localize(config.types[art.type] ?? "");
    let group = groups.find((entry) => entry.label === label);
    if ( !group ) groups.push(group = { label, arts: [] });
    const cost = costFor(readCost(art.cost), unit.artCost ?? 0);
    const price = [];
    if ( cost.hp > 0 ) price.push(i18n.format("FEO.Optional.combatArts.cost.hp", { amount: cost.hp }));
    if ( cost.uses > 0 ) price.push(i18n.format("FEO.Optional.combatArts.cost.uses", { amount: cost.uses }));
    const rank = art.rank ? i18n.localize(FEO.ranks[art.rank]) : i18n.localize("FEO.Optional.combatArts.innate");
    group.arts.push({ id: art.id, label: `${art.name} · ${rank} · ${price.length ? price.join(", ") : i18n.localize("FEO.Optional.combatArts.cost.none")}` });
    effects[art.id] = art.effect ?? "";
  }
  return { groups, effects, count: Object.keys(effects).length };
}

/* -------------------------------------------- */

/**
 * Let a unit learn a Combat Art from the compendium: a dialog lists the Arts its Weapon Ranks allow and that
 * it has not learned yet, and the one picked is added to the unit.
 * @param {Actor} actor
 * @returns {Promise<Item|null>}    The Art it learned, if it learned one
 */
export async function learnArt(actor) {
  const config = FEO.optional.combatArts;
  const pack = game.packs.get(`${FEO.id}.${config.pack}`);
  if ( !pack ) {
    ui.notifications.warn("FEO.Optional.combatArts.learn.noPack", { localize: true });
    return null;
  }
  const documents = (await pack.getDocuments()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const choices = buildLearnChoices(
    documents.map((document) => ({ id: document.id, name: document.name, folder: document.folder?.name ?? "", system: document.system })),
    {
      proficiencies: actor.system.proficiencies,
      known: actor.items.filter((item) => item.type === "art").map((item) => item.name),
      ranked: !FEO.optional.weaponLevel.enabled,
      artCost: actor.system.skills?.artCost ?? 0
    },
    game.i18n
  );
  if ( !choices.count ) {
    ui.notifications.info("FEO.Optional.combatArts.learn.none", { localize: true });
    return null;
  }

  // The dialog takes its content as a bare element and copies what is inside it
  const content = document.createElement("div");
  content.innerHTML = await foundry.applications.handlebars.renderTemplate(`systems/${FEO.id}/templates/dialog/learn-art.hbs`, choices);
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.Optional.combatArts.learn.title", { name: actor.name }) },
    position: { width: 460 },
    content,
    buttons: [
      {
        action: "learn", label: "FEO.Optional.combatArts.learn.button", icon: "fa-solid fa-book-open", default: true,
        callback: (event, button) => button.form.elements.art.value
      },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const select = dialog.element.querySelector('select[name="art"]');
      const preview = dialog.element.querySelector(".art-preview");
      const show = () => preview.textContent = choices.effects[select.value] ?? "";
      select.addEventListener("change", show);
      show();
    }
  });
  const source = documents.find((document) => document.id === picked);
  if ( !source ) return null;
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  data.system.readied = false;
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  return item ?? null;
}

/* -------------------------------------------- */

/**
 * Ready a Combat Art for the next fight its unit initiates, or put it away again. A unit has one Art readied
 * at most, and can only ready one it could perform now.
 * @param {Item} item     An Art a unit has
 * @returns {Promise<boolean>}    Whether anything changed
 */
export async function toggleArt(item) {
  const actor = item?.actor;
  if ( !actor || (item.type !== "art") ) return false;
  if ( item.system.readied ) {
    await item.update({ "system.readied": false });
    return true;
  }
  const able = canPerform(artData(item), performerOf(actor));
  if ( !able.ok ) {
    ui.notifications.warn(game.i18n.format("FEO.Optional.combatArts.forecast.blocked", {
      art: item.name,
      why: game.i18n.localize(`FEO.Optional.combatArts.blocked.${able.why}`)
    }));
    return false;
  }
  const others = actor.items.filter((other) => (other.type === "art") && other.system.readied && (other !== item));
  await actor.updateEmbeddedDocuments("Item", [
    ...others.map((other) => ({ _id: other.id, "system.readied": false })),
    { _id: item.id, "system.readied": true }
  ]);
  return true;
}

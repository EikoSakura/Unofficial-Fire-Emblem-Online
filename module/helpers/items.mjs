import { itemLine, itemMoments, itemOffers, itemPower, itemRestores } from "../rules/items.mjs";
import { postCard } from "./chat.mjs";
import { cutIn } from "./cut-ins.mjs";
import { eventUnitOf } from "./events.mjs";
import { buildItemCard } from "./item-card-context.mjs";
import { grantTimed } from "./timed.mjs";
import { describeChange } from "./timed-context.mjs";

/**
 * @import {ItemOffer, ItemUnit} from "../rules/items.mjs"
 */

/**
 * An item is about to restore HP to a unit: what that unit's skills make of it (see `rules/items.mjs`). What
 * takes effect by itself is taken, and whoever Uses the item is asked about each skill its owner may take or
 * leave, with what the item would then restore.
 * @param {Actor} patient               The unit the item heals
 * @param {number} restore              What the item restores, with what its user's skills add for an ally
 * @param {object} [use]
 * @param {boolean} [use.own]           Does the unit Use the item on itself?
 * @param {string} [use.item]           The item's name, for what is asked
 * @returns {Promise<{unit: ItemUnit, taken: ItemOffer[], restore: number}>}    The unit as the rules read it,
 *          the offers that take effect, and what the item restores with them
 */
export async function beforeItemHeal(patient, restore, { own = true, item = "" } = {}) {
  const unit = { ...eventUnitOf(patient), timed: patient.system.timed ?? [] };
  const taken = [];
  for ( const offer of itemOffers(unit, { own }) ) {
    if ( !offer.may ) {
      taken.push(offer);
      continue;
    }
    const now = itemRestores(restore, taken);
    const then = itemRestores(restore, [...taken, offer]);
    const effect = patient.items.get(offer.id)?.system.effect ?? "";
    const escape = foundry.utils.escapeHTML ?? ((text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    const answer = await foundry.applications.api.DialogV2.confirm({
      window: { title: offer.skill },
      content: [
        effect ? `<p><em>${escape(effect)}</em></p>` : "",
        `<p>${escape(game.i18n.format((then === now) ? "FEO.Item.offer" : "FEO.Item.offerHeal", { skill: offer.skill, item, now, then }))}</p>`
      ].join(""),
      rejectClose: false
    });
    if ( answer ) taken.push(offer);
  }
  return { unit, taken, restore: itemRestores(restore, taken) };
}

/* -------------------------------------------- */

/**
 * An item has restored HP to a unit: the changes its skills leave on it for that are granted, each read from
 * the HP it regained.
 * @param {Actor} patient               The unit the item healed
 * @param {{unit: ItemUnit, taken: ItemOffer[]}} before     What `beforeItemHeal` settled
 * @param {number} healed               The HP the item restored to the unit in the end
 * @returns {Promise<{label: string, value: string}[]>}     One row for each skill that took effect, for the
 *          card of the item
 */
export async function afterItemHeal(patient, { unit, taken }, healed) {
  if ( !taken?.length ) return [];
  const { granted, told } = itemMoments(unit, taken, healed);
  if ( granted.length ) await grantTimed(patient, granted.map((entry) => entry.change));
  return told.map((skill) => {
    const later = granted.filter((entry) => (entry.skill === skill) && (entry.change.mend > 0)).reduce((sum, entry) => sum + entry.change.mend, 0);
    return {
      label: skill,
      value: later ? game.i18n.format("FEO.Item.healsLater", { amount: later }) : game.i18n.localize("FEO.SkillTurn.activates"),
      cls: "good"
    };
  });
}

/* -------------------------------------------- */

/**
 * Show an item to the table as a card in the chat: what it is and what it does. Nothing of it is used or spent,
 * and nothing is earned.
 * @param {Item} item
 * @returns {Promise<ChatMessage>}
 */
export async function postItem(item) {
  const { template, card } = buildItemCard(item, game.i18n);
  return postCard(item.actor ?? null, card, { template });
}

/* -------------------------------------------- */

/**
 * A unit is about to Use an item that one of its skills uses up for something that lasts, as Wealth Of Power
 * does with Gems (see `rules/items.mjs`): whoever Uses it is asked, the item is destroyed, and the unit carries
 * the change. An item whose power the unit already carries is kept, and so is one its owner keeps.
 * @param {Actor} actor
 * @param {Item} item
 * @param {TokenDocument|null} [token]    The unit's token, if it has one on a map
 * @returns {Promise<"used"|"kept"|null>}   Null for an item that no skill of the unit uses up: it is Used as any
 *                                        other. "used" where it was destroyed, which is its unit's Action
 */
export async function useUpItem(actor, item, token = null) {
  const unit = { ...eventUnitOf(actor, token ?? undefined), timed: actor.system.timed ?? [] };
  const power = itemPower(unit, item.name);
  if ( !power ) return null;
  if ( power.carried ) {
    ui.notifications.warn(game.i18n.format("FEO.Item.powerActive", { item: item.name, skill: power.skill }));
    return "kept";
  }

  // What it gives, as the skill's own Effect words it for this item, or as the change itself reads
  const escape = foundry.utils.escapeHTML ?? ((text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  const { what, lasts } = describeChange(power.change, game.i18n);
  const gives = itemLine(actor.items.get(power.id)?.system.effect, item.name) || what;
  const answer = await foundry.applications.api.DialogV2.confirm({
    window: { title: power.skill },
    content: [
      gives ? `<p><em>${escape(gives)}</em></p>` : "",
      `<p>${escape(game.i18n.format("FEO.Item.powerAsk", { item: item.name, lasts }))}</p>`
    ].join(""),
    rejectClose: false
  });
  if ( !answer ) return "kept";

  const name = item.name;
  await item.delete();
  await grantTimed(actor, [power.change]);
  cutIn([{ actor, skill: power.skill }]);
  await postCard(actor, {
    title: game.i18n.format("FEO.Item.powerUsed", { item: name }),
    subtitle: power.skill,
    rows: [{ label: name, value: [gives, lasts].filter(Boolean).join(", "), cls: "good" }]
  });
  return "used";
}

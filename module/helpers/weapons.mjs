import { FEO } from "../config.mjs";
import { sellValue } from "../rules/progression.mjs";
import { breakWeapon, canWield, repairWeapon, wieldLevel } from "../rules/weapons.mjs";
import { postCard } from "./chat.mjs";

/**
 * Weapons on units in Foundry: breaking, repairing and selling them, and checking who may wield what.
 */

/** The flag, on a broken weapon, that keeps what it was before it broke. */
export const ORIGINAL_FLAG = "original";

/**
 * What a broken weapon was before it broke, if it is one.
 * @param {Item} item
 * @returns {{name: string, system: object}|null}
 */
export function originalOf(item) {
  return item.flags?.[FEO.id]?.[ORIGINAL_FLAG] ?? null;
}

/* -------------------------------------------- */

/** The flag, on a weapon, that marks it as handed to a summoned unit, which wields it whatever its rank. */
export const SUMMONED_FLAG = "summoned";

/**
 * Was a weapon handed to a unit as it was summoned? Its bearer may always wield it.
 * @param {Item|null} item
 * @returns {boolean}
 */
export function alwaysWields(item) {
  return !!item?.flags?.[FEO.id]?.[SUMMONED_FLAG];
}

/* -------------------------------------------- */

/**
 * May a unit equip a weapon?
 * @param {Actor} actor
 * @param {Item} item
 * @returns {{ok: boolean, has: string|null, needs: string}}
 */
export function wieldCheck(actor, item) {
  if ( !FEO.weapons.rankCheck || alwaysWields(item) ) return { ok: true, has: null, needs: item.system.rank };
  return canWield(actor.system.proficiencies, item.system, { above: actor.system.skills?.wield ?? 0, level: wieldLevel(actor.system) });
}

/* -------------------------------------------- */

/**
 * Turn a weapon that has run out of uses into the broken version of its type.
 * @param {Item} item
 * @returns {Promise<boolean>}    Whether the weapon changed
 */
export async function breakItem(item) {
  if ( (item?.type !== "weapon") || originalOf(item) ) return false;
  const change = breakWeapon({ name: item.name, system: item.system.toObject() });
  if ( !change ) {
    if ( FEO.weapons.unequipOnBreak && item.system.equipped ) await item.update({ "system.equipped": false });
    return false;
  }
  await item.update({
    name: change.name,
    system: change.system,
    [`flags.${FEO.id}.${ORIGINAL_FLAG}`]: change.original
  });
  return true;
}

/* -------------------------------------------- */

/**
 * What repairing and selling an owned weapon or item are worth.
 * @param {Item} item
 * @returns {{repair: number, sell: number, damaged: boolean, broken: boolean}}
 */
export function quote(item) {
  const system = item.system;
  const original = item.type === "weapon" ? originalOf(item) : null;
  const { value, max } = system.uses ?? { value: 0, max: 0 };
  if ( original ) return { repair: Math.max(system.cost ?? 0, 0), sell: 0, damaged: true, broken: true };
  const repair = item.type === "weapon" ? repairWeapon({ name: item.name, system }).cost : 0;
  return {
    repair,
    sell: sellValue(system.cost, value, max),
    damaged: (item.type === "weapon") && (max > 0) && (value < max),
    broken: false
  };
}

/* -------------------------------------------- */

/**
 * Repair a weapon at its owner's expense, after asking.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Promise<boolean>}    Whether the weapon was repaired
 */
export async function repairItem(actor, item) {
  const original = originalOf(item);
  const plan = repairWeapon({ name: item.name, system: item.system.toObject() }, original);
  const gold = actor.system.gold;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.Repair.title" },
    content: `<p>${game.i18n.format("FEO.Repair.prompt", { weapon: plan.name, cost: plan.cost, gold })}</p>`,
    buttons: [
      { action: "pay", label: "FEO.Repair.pay", icon: "fa-solid fa-coins", default: true, disabled: gold < plan.cost },
      { action: "free", label: "FEO.Repair.free" },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( (answer !== "pay") && (answer !== "free") ) return false;

  const paid = answer === "pay" ? plan.cost : 0;
  await item.update({ name: plan.name, system: plan.system });
  if ( original ) await item.unsetFlag(FEO.id, ORIGINAL_FLAG);
  if ( paid ) await actor.update({ "system.gold": Math.max(gold - paid, 0) });
  await postCard(actor, {
    title: game.i18n.format("FEO.Repair.done", { weapon: plan.name }),
    rows: [
      { label: game.i18n.localize("FEO.Weapon.uses"), value: `${plan.system.uses.value} / ${plan.system.uses.max}`, cls: "good" },
      { label: game.i18n.localize("FEO.Unit.gold"), value: paid ? `−${paid}` : game.i18n.localize("FEO.Repair.noCharge") }
    ]
  });
  return true;
}

/* -------------------------------------------- */

/**
 * Sell a weapon or item for what it is worth, after asking.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Promise<boolean>}    Whether it was sold
 */
export async function sellItem(actor, item) {
  const { sell } = quote(item);
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "FEO.Sell.title" },
    content: `<p>${game.i18n.format("FEO.Sell.prompt", { item: item.name, gold: sell })}</p>`,
    rejectClose: false
  });
  if ( !confirmed ) return false;
  const name = item.name;
  await item.delete();
  await actor.update({ "system.gold": actor.system.gold + sell });
  await postCard(actor, {
    title: game.i18n.format("FEO.Sell.done", { item: name }),
    rows: [{ label: game.i18n.localize("FEO.Unit.gold"), value: `+${sell}`, cls: "good" }]
  });
  return true;
}

/**
 * Weapon handling for Fire Emblem Online: who may wield what, what a weapon becomes when it breaks, and what
 * repairing and selling are worth.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";
import { proficienciesFor, weaponRank } from "./combat.mjs";

/**
 * Can a unit wield a weapon? A unit may only equip weapons of its proficiency rank or lower. Weapon types
 * that have no proficiency, such as a Laguz's claws, ask for no rank.
 * @param {Record<string, {rank: string}>} proficiencies    The unit's proficiencies
 * @param {{category: string, rank: string}} weapon         Weapon data
 * @param {object} [options]
 * @param {number} [options.above]    Ranks above its own that a skill lets the unit wield, in the weapon
 *                                    types it has a rank in at all
 * @param {number|null} [options.level]   The unit's Weapon Level, where the world plays with them
 * @returns {{ok: boolean, has: string|null, needs: string, level?: {has: number, needs: number}}}
 *          `has` is the unit's rank with the weapon's type, or null when the type has no proficiency; `level`
 *          is set when Weapon Levels decided it
 */
export function canWield(proficiencies, weapon, { above = 0, level = null } = {}) {
  const needs = weapon?.rank ?? "F";
  if ( !proficienciesFor(weapon?.category).length ) return { ok: true, has: null, needs };
  const order = Object.keys(FEO.ranks);
  const has = weaponRank(proficiencies, weapon.category);

  // With Weapon Levels a unit wields, in the types it has a rank in at all, the weapons whose own Weapon Level
  // is no higher than its own. A weapon without one goes by rank, as it always did
  if ( Number.isFinite(level) && Number.isFinite(weapon.level) ) {
    const held = order.indexOf(has) > 0;
    const mine = level + (held ? Math.max(above ?? 0, 0) * FEO.optional.weaponLevel.perRank : 0);
    return { ok: held ? (mine >= weapon.level) : (needs === order[0]), has, needs, level: { has: level, needs: weapon.level } };
  }
  const reach = order.indexOf(has) + ((order.indexOf(has) > 0) ? Math.max(above ?? 0, 0) : 0);
  return { ok: reach >= order.indexOf(needs), has, needs };
}

/* -------------------------------------------- */

/**
 * The Weapon Level a unit wields by, where the world plays with them.
 * @param {object} [system]     The unit's data, saved or prepared
 * @param {object} [config]     FEO.optional.weaponLevel
 * @returns {number|null}       Null while the module is off
 */
export function wieldLevel(system, config = FEO.optional.weaponLevel) {
  return config.enabled ? (system?.weaponLevel?.base ?? config.start) : null;
}

/* -------------------------------------------- */

/**
 * The rank a Weapon Level counts as, for what goes by rank.
 * @param {number} level
 * @param {object} [config]     FEO.optional.weaponLevel
 * @returns {string}            A key of FEO.ranks
 */
export function levelRank(level, config = FEO.optional.weaponLevel) {
  let rank = Object.keys(FEO.ranks)[0];
  for ( const [key, from] of Object.entries(config.ranks) ) if ( (level ?? 0) >= from ) rank = key;
  return rank;
}

/* -------------------------------------------- */

/**
 * The rank a unit counts as having in a weapon type. With Weapon Levels that is the rank its Weapon Level
 * counts as, in every type it has a rank in at all; the highest rank of all is only ever held outright.
 * @param {string} held                 Its rank in the type, as it is kept
 * @param {string|null} [levelled]      The rank its Weapon Level counts as; null while the module is off
 * @returns {string}
 */
export function countedRank(held, levelled = null) {
  const order = Object.keys(FEO.ranks);
  if ( !levelled || (order.indexOf(held) <= 0) || (held === order.at(-1)) ) return held;
  return levelled;
}

/* -------------------------------------------- */

/**
 * The broken version of a weapon category, if the Broken Weapons table has one.
 * @param {string} category
 * @returns {object|null}
 */
export function brokenForm(category) {
  const table = FEO.weapons.broken;
  if ( table[category] ) return table[category];
  if ( FEO.weaponCategories[category]?.magic ) return table.magic ?? null;
  return null;
}

/* -------------------------------------------- */

/**
 * What a weapon turns into when its last use is spent: the broken version of its type, which never wears out
 * and remembers what it was so that it can be repaired.
 * @param {{name: string, system: object}} weapon     The weapon's name and data
 * @returns {{name: string, system: object, original: {name: string, system: object}}|null}
 *          The changes to make and the weapon as it was, or null when its type has no broken version
 */
export function breakWeapon(weapon) {
  const form = brokenForm(weapon.system.category);
  if ( !form ) return null;
  const { name, ...numbers } = form;
  const kept = ["might", "hit", "crit", "range", "weight", "wexp", "effect", "damageStat", "rank", "uses", "counter"];
  const original = { name: weapon.name, system: {} };
  for ( const key of kept ) {
    if ( weapon.system[key] !== undefined ) original.system[key] = structuredClone(weapon.system[key]);
  }
  return {
    name,
    system: {
      ...numbers,
      rank: "F",
      uses: { value: 0, max: 0 },
      counter: { might: null, hit: null, crit: null },
      equipped: FEO.weapons.unequipOnBreak ? false : (weapon.system.equipped ?? false)
    },
    original
  };
}

/* -------------------------------------------- */

/**
 * What a blacksmith charges to repair a weapon: its cost for each use, times the uses it is missing. A broken
 * weapon is repaired for its full price.
 * @param {number} cost     The weapon's price
 * @param {number} uses     Uses left
 * @param {number} max      Total uses
 * @returns {number}
 */
export function repairCost(cost, uses, max) {
  if ( !(max > 0) ) return 0;
  const missing = Math.min(Math.max(max - (uses ?? 0), 0), max);
  return Math.floor(((cost ?? 0) / max) * missing);
}

/* -------------------------------------------- */

/**
 * Bring a weapon back to full uses, and a broken one back to what it was.
 * @param {{name: string, system: object}} weapon
 * @param {{name: string, system: object}|null} [original]    What a broken weapon was before it broke
 * @returns {{name: string, system: object, cost: number}}    The changes to make and their price
 */
export function repairWeapon(weapon, original = null) {
  if ( original ) {
    const max = original.system.uses?.max ?? 0;
    return {
      name: original.name,
      system: { ...structuredClone(original.system), uses: { value: max, max } },
      cost: Math.max(weapon.system.cost ?? 0, 0)
    };
  }
  const { value, max } = weapon.system.uses;
  return {
    name: weapon.name,
    system: { uses: { value: max, max } },
    cost: repairCost(weapon.system.cost, value, max)
  };
}

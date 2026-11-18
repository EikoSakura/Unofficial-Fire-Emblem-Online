/**
 * Summoning: the weapon a summoned unit is handed for its level, and how far it has fallen behind its
 * summoner. Pure functions of plain data, so that they can be tested outside of Foundry.
 * The weapons are set in `FEO.summon`; what is summoned, how many and where is said by the skill that summons
 * (see `creatures.mjs`).
 */
import { FEO } from "../config.mjs";

/**
 * The weapons a summoned unit can be handed at its level.
 * @param {number} level        The summoned unit's level
 * @param {string} category     The weapon type it fights with, one of `config.categories`
 * @param {object} [config]     FEO.summon
 * @returns {string[]}          Weapon names, each drawn with the same odds
 */
export function weaponPool(level, category, config = FEO.summon) {
  if ( !config.categories.includes(category) ) return [];
  let band = null;
  for ( const entry of config.bands ) {
    if ( (level ?? 1) >= entry.from ) band = entry;
  }
  band ??= config.bands[0];
  const names = [];
  for ( const draw of band?.draws ?? [] ) {
    const name = config.weapons[draw]?.[category];
    if ( name && !names.includes(name) ) names.push(name);
  }
  return names;
}

/* -------------------------------------------- */

/**
 * The weapon a roll draws from a pool.
 * @param {string[]} pool       As `weaponPool` returns it
 * @param {number} roll         A die with as many faces as the pool has weapons, from 1
 * @returns {string|null}
 */
export function drawWeapon(pool, roll) {
  if ( !pool?.length ) return null;
  const at = Math.min(Math.max(Math.trunc(roll) || 1, 1), pool.length);
  return pool[at - 1];
}

/* -------------------------------------------- */

/**
 * The level ups a summoned unit has to take to stand level with its summoner.
 * @param {number} summonerLevel
 * @param {number} level        The summoned unit's own
 * @returns {number}
 */
export function levelsBehind(summonerLevel, level) {
  return Math.max(Math.trunc(summonerLevel ?? 1) - Math.trunc(level ?? 1), 0);
}

/* -------------------------------------------- */

/**
 * The experience that has a summoned unit level up as often as it is behind. It earns none of its own, so
 * this is all it ever has.
 * @param {number} summonerLevel
 * @param {number} level
 * @returns {number}
 */
export function catchUpExp(summonerLevel, level) {
  return levelsBehind(summonerLevel, level) * FEO.expPerLevel;
}

/**
 * Summoning: how many units a summoner may have on the map, where one can appear, the weapon it is handed and
 * how far it has fallen behind its summoner. Pure functions of plain data, so that they can be tested outside
 * of Foundry. What is summoned, and with what, is set in `FEO.summon`.
 */
import { FEO } from "../config.mjs";

const fold = (name) => String(name ?? "").trim().toLowerCase();

/**
 * Is this the skill that summons?
 * @param {string} name
 * @param {object} [config]     FEO.summon
 * @returns {boolean}
 */
export function isSummonSkill(name, config = FEO.summon) {
  return !!fold(name) && (fold(name) === fold(config.skill));
}

/* -------------------------------------------- */

/**
 * How many units a summoner may have on the map at once.
 * @param {string[]} skills     The names of the skills it has equipped
 * @param {number} level        Its level, counted on through its promotions
 * @param {object} [config]     FEO.summon
 * @returns {number}
 */
export function summonLimit(skills, level, config = FEO.summon) {
  const more = config.more;
  const has = !!more?.skill && (skills ?? []).some((name) => fold(name) === fold(more.skill));
  if ( !has ) return config.limit;
  return config.limit + 1 + (more.levels ?? []).filter((reached) => (level ?? 1) >= reached).length;
}

/* -------------------------------------------- */

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
 * The tiles next to a unit, one on each side of it, in the order north, east, south, west. A unit larger than
 * one tile is given the tile at the near end of each side.
 * @param {{i: number, j: number, width?: number, height?: number}} tile    The unit's top row and left column,
 *                                                                          and its size in tiles
 * @returns {{side: "north"|"east"|"south"|"west", i: number, j: number}[]}
 */
export function tilesBeside(tile) {
  const width = Math.max(tile.width ?? 1, 1);
  const height = Math.max(tile.height ?? 1, 1);
  return [
    { side: "north", i: tile.i - 1, j: tile.j },
    { side: "east", i: tile.i, j: tile.j + width },
    { side: "south", i: tile.i + height, j: tile.j },
    { side: "west", i: tile.i, j: tile.j - 1 }
  ];
}

/* -------------------------------------------- */

/**
 * The tiles next to a unit that something can be summoned onto: those on the map that nobody stands on.
 * @param {{i: number, j: number, width?: number, height?: number}} tile
 * @param {object} [options]
 * @param {{i: number, j: number, width?: number, height?: number}[]} [options.taken]   The tiles units stand on
 * @param {(tile: {i: number, j: number}) => boolean} [options.onMap]                   Is a tile on the map?
 * @returns {{side: string, i: number, j: number, free: boolean}[]}     All four, each marked free or not
 */
export function summonTiles(tile, { taken = [], onMap = () => true } = {}) {
  const held = (spot) => taken.some((other) => {
    const width = Math.max(other.width ?? 1, 1);
    const height = Math.max(other.height ?? 1, 1);
    return (spot.i >= other.i) && (spot.i < other.i + height) && (spot.j >= other.j) && (spot.j < other.j + width);
  });
  return tilesBeside(tile).map((spot) => ({ ...spot, free: !!onMap(spot) && !held(spot) }));
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

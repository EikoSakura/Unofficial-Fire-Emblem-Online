import { FEO } from "../config.mjs";

/**
 * Terrain and elevation: what a tile gives the unit standing on it, what it costs to cross, and what the
 * height of two units does to an attack between them. These functions know nothing of Foundry.
 *
 * @typedef Mover
 * @property {string} [qualities]     The unit's Special Qualities, as free text
 * @property {string[]} [skills]      The names of the skills the unit has equipped
 * @property {boolean} [magic]        Does the unit fight with magic?
 * @property {boolean} [shifted]      Is the unit a Laguz in its animal form?
 * @property {string} [className]     The name of the unit's class
 *
 * @typedef Ground
 * @property {string} terrain         A key of FEO.terrain.types
 * @property {number} elevation       How high the tile lies; 0 is the floor of the map
 * @property {number} def             What a unit standing there adds to its DEF
 * @property {number} res             What it adds to its RES
 * @property {number} dodge           What it adds to its Dodge
 */

/**
 * The entry of the terrain table for a kind of terrain; open ground for a kind the table does not know.
 * @param {string} [key]    A key of FEO.terrain.types
 * @returns {object}
 */
export function terrainType(key) {
  return FEO.terrain.types[key] ?? FEO.terrain.types[FEO.terrain.default];
}

/* -------------------------------------------- */

/**
 * Does a unit have a Special Quality?
 * @param {Mover|null} mover
 * @param {string} quality
 * @returns {boolean}
 */
function hasQuality(mover, quality) {
  return String(mover?.qualities ?? "").toLowerCase().includes(quality.toLowerCase());
}

/* -------------------------------------------- */

/**
 * Does a unit fly? Flying units ignore the penalties and the bonuses of terrain, except for healing.
 * @param {Mover|null} mover
 * @returns {boolean}
 */
export function flies(mover) {
  return hasQuality(mover, FEO.terrain.flying);
}

/* -------------------------------------------- */

/**
 * How many spaces of movement one space of a terrain takes a unit.
 * @param {string} key              A key of FEO.terrain.types
 * @param {Mover|null} [mover]      Who is moving; without one the table's own cost is given
 * @returns {number}                Infinity for terrain the unit cannot cross
 */
export function moveCost(key, mover = null) {
  const type = terrainType(key);
  if ( flies(mover) ) return 1;
  if ( type.needs?.length ) {
    const skills = (mover?.skills ?? []).map((name) => String(name).toLowerCase());
    if ( !type.needs.some((name) => skills.includes(name.toLowerCase())) ) return Infinity;
  }
  if ( type.free && mover ) {
    const cls = String(mover.className ?? "").toLowerCase();
    const free = (type.free.magic && mover.magic) || (type.free.shifted && mover.shifted)
      || (type.free.classes ?? []).some((name) => !!cls && (cls === name.toLowerCase()));
    if ( free ) return 1;
  }
  if ( type.slow?.qualities.some((quality) => hasQuality(mover, quality)) ) return type.slow.cost;
  return type.cost;
}

/* -------------------------------------------- */

/**
 * What a tile gives the unit standing on it.
 * @param {string} key              A key of FEO.terrain.types
 * @param {number} [elevation=0]    How high the tile lies
 * @param {Mover|null} [mover]      Who stands there
 * @returns {Ground}
 */
export function groundOf(key, elevation = 0, mover = null) {
  const type = terrainType(key);
  const terrain = key in FEO.terrain.types ? key : FEO.terrain.default;
  const height = Math.max(Math.floor(Number(elevation)) || 0, 0);
  if ( flies(mover) ) return { terrain, elevation: height, def: 0, res: 0, dodge: 0 };
  return { terrain, elevation: height, def: type.def ?? 0, res: type.res ?? 0, dodge: type.dodge ?? 0 };
}

/* -------------------------------------------- */

/**
 * What the height of two units does to an attack from one on the other. A ranged attack gains against a
 * unit on lower ground and loses against one on higher ground; an attack from the next tile gains nothing.
 * @param {number} distance     Tiles between the two units
 * @param {number} own          The elevation of the attacker
 * @param {number} foe          The elevation of its target
 * @returns {{height: number, hit: number, damage: number}}    `height` is 1 from above, -1 from below
 */
export function heightEdge(distance, own, foe) {
  const height = (distance > 1) ? Math.sign((own ?? 0) - (foe ?? 0)) : 0;
  return { height, hit: height * FEO.terrain.elevation.hit, damage: height * FEO.terrain.elevation.damage };
}

/* -------------------------------------------- */

/**
 * Is an attack ruled out by height? Melee attacks cannot be made against targets at different elevations.
 * @param {number} distance     Tiles between the two units
 * @param {number} own          The elevation of the attacker
 * @param {number} foe          The elevation of its target
 * @returns {boolean}
 */
export function heightBlocks(distance, own, foe) {
  return (distance <= 1) && ((own ?? 0) !== (foe ?? 0));
}

/* -------------------------------------------- */

/**
 * Is a tile terrain with effects for the unit standing on it? It is when it gives or takes Defence, Resistance
 * or Dodge, heals, or costs more movement than open ground. A flying unit ignores all of that but the healing.
 * @param {string} key              A key of FEO.terrain.types
 * @param {Mover|null} [mover]      Who stands there
 * @returns {boolean}
 */
export function terrainMatters(key, mover = null) {
  const type = terrainType(key);
  if ( flies(mover) ) return !!type.heal;
  return !!(type.def || type.res || type.dodge || type.heal) || ((type.cost ?? 1) > 1);
}

/* -------------------------------------------- */

/**
 * The HP a unit gains at the start of its turn from the terrain it stands on.
 * @param {string} key          A key of FEO.terrain.types
 * @param {number} hp           The unit's current HP
 * @param {number} hpMax        Its maximum HP
 * @returns {number}
 */
export function terrainHealing(key, hp, hpMax) {
  const heal = terrainType(key).heal ?? 0;
  if ( !heal || !(hp > 0) || (hp >= hpMax) ) return 0;
  return Math.max(Math.min(Math.floor((hpMax * heal) / 100), hpMax - hp), 0);
}

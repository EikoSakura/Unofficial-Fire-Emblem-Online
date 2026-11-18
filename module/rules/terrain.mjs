import { FEO } from "../config.mjs";

/**
 * Terrain and elevation: what a tile gives the unit standing on it, what it costs to cross, and what the
 * height of two units does to an attack between them. These functions know nothing of Foundry.
 *
 * A skill changes how its unit crosses terrain with a `crossing` part among its effects (see `skills.mjs`):
 *
 *   crossing: {
 *     kinds: ["mountain", "cliff"],     // kinds of terrain the unit crosses though they ask for a skill
 *     cost: { mountain: 3, cliff: 3 },  // the most a space of a kind takes it, where it can cross that kind
 *     free: ["river"],                  // kinds whose spaces take it 1, as open ground does; "all" for every
 *                                       // kind it can cross, which leaves it no movement penalty from terrain
 *     flier: true,                      // it crosses terrain as a Flying unit does: every space takes 1, and
 *                                       // the tile it stands on gives it nothing but healing
 *     steady: true,                     // the tile it stands on takes nothing off its Defence, Resistance or
 *                                       // Dodge: what it adds stays
 *     phase: 2                          // it passes through tiles it cannot cross, each taking this much
 *   }                                   // movement, but cannot end its movement on one
 *
 * @typedef Crossing
 * What a unit's skills change about how it crosses terrain, added up.
 * @property {string[]} kinds               Kinds it crosses though they ask for a skill
 * @property {Record<string, number>} cost  The most a space of a kind takes it
 * @property {string[]} free                Kinds whose spaces take it 1
 * @property {boolean} all                  Does every kind it can cross take it 1?
 * @property {boolean} flier                Does it cross terrain as a Flying unit does?
 * @property {number|null} phase            What a tile it cannot cross takes it to pass through; null if it cannot
 * @property {boolean} [steady]             Does the tile it stands on take nothing off its numbers?
 *
 * @typedef Mover
 * @property {string} [qualities]     The unit's Special Qualities, as free text
 * @property {string[]} [skills]      The names of the skills the unit has equipped
 * @property {boolean} [magic]        Does the unit fight with magic?
 * @property {boolean} [shifted]      Is the unit a Laguz in its animal form?
 * @property {string} [className]     The name of the unit's class
 * @property {Crossing|null} [crossing]     What its skills change about how it crosses terrain
 * @property {number} [weather]       What every tile costs it more to cross in the weather of its map (see
 *                                    `weather.mjs`)
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
 * Does a unit fly? Flying units ignore the penalties and the bonuses of terrain, except for healing. So does
 * a unit whose skill has it cross terrain as they do.
 * @param {Mover|null} mover
 * @returns {boolean}
 */
export function flies(mover) {
  return hasQuality(mover, FEO.terrain.flying) || !!mover?.crossing?.flier;
}

/* -------------------------------------------- */
/*  Crossing                                    */
/* -------------------------------------------- */

/**
 * Nothing changed about how a unit crosses terrain.
 * @returns {Crossing}
 */
export function emptyCrossing() {
  return { kinds: [], cost: {}, free: [], all: false, flier: false, steady: false, phase: null };
}

/* -------------------------------------------- */

/**
 * Add what one skill effect changes about how its unit crosses terrain to what the others do.
 * @param {Crossing} total
 * @param {object} [part]     The `crossing` part of an effect
 * @returns {Crossing}        The total, changed
 */
export function addCrossing(total, part) {
  if ( !part || (typeof part !== "object") ) return total;
  for ( const kind of part.kinds ?? [] ) if ( !total.kinds.includes(kind) ) total.kinds.push(kind);
  for ( const [kind, cost] of Object.entries(part.cost ?? {}) ) total.cost[kind] = Math.min(total.cost[kind] ?? Infinity, cost);
  if ( part.free === "all" ) total.all = true;
  else for ( const kind of part.free ?? [] ) if ( !total.free.includes(kind) ) total.free.push(kind);
  if ( part.flier ) total.flier = true;
  if ( part.steady ) total.steady = true;
  if ( Number.isFinite(part.phase) ) total.phase = Math.min(total.phase ?? Infinity, Math.max(part.phase, 1));
  return total;
}

/* -------------------------------------------- */

/**
 * Does anything change about how a unit crosses terrain?
 * @param {Crossing|null} [crossing]
 * @returns {boolean}
 */
export function crosses(crossing) {
  if ( !crossing ) return false;
  return !!(crossing.kinds?.length || Object.keys(crossing.cost ?? {}).length || crossing.free?.length || crossing.all
    || crossing.flier || crossing.steady || (crossing.phase != null));
}

/* -------------------------------------------- */

/**
 * Check the `crossing` part of a skill effect, so that a typing mistake does not pass silently.
 * @param {object} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkCrossing(part) {
  const problems = [];
  const kinds = FEO.terrain.types;
  const named = (list, what) => {
    if ( !Array.isArray(list) || !list.length ) return problems.push(`crossing: "${what}" lists kinds of terrain`);
    for ( const kind of list ) if ( !(kind in kinds) ) problems.push(`crossing: unknown terrain "${kind}"`);
    return null;
  };
  if ( !part || (typeof part !== "object") || !Object.keys(part).length ) return ["crossing must say what changes"];
  for ( const key of Object.keys(part) ) {
    if ( !["kinds", "cost", "free", "flier", "steady", "phase"].includes(key) ) problems.push(`crossing cannot say "${key}"`);
  }
  if ( part.kinds !== undefined ) {
    named(part.kinds, "kinds");
    for ( const kind of Array.isArray(part.kinds) ? part.kinds : [] ) {
      if ( kinds[kind] && !kinds[kind].needs?.length ) problems.push(`crossing: "${kind}" asks for no skill to be crossed`);
    }
  }
  if ( part.cost !== undefined ) {
    const entries = Object.entries(part.cost ?? {});
    if ( !entries.length ) problems.push('crossing: "cost" gives kinds of terrain a number');
    for ( const [kind, cost] of entries ) {
      if ( !(kind in kinds) ) problems.push(`crossing: unknown terrain "${kind}"`);
      else if ( !Number.isInteger(cost) || (cost < 1) ) problems.push(`crossing: the cost of "${kind}" is a whole number from 1`);
    }
  }
  if ( (part.free !== undefined) && (part.free !== "all") ) named(part.free, "free");
  if ( (part.flier !== undefined) && (part.flier !== true) ) problems.push('crossing: "flier" is true or left out');
  if ( (part.steady !== undefined) && (part.steady !== true) ) problems.push('crossing: "steady" is true or left out');
  if ( (part.phase !== undefined) && !(Number.isInteger(part.phase) && (part.phase >= 1)) ) {
    problems.push('crossing: "phase" is the movement a tile takes to pass through, a whole number from 1');
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * How many spaces of movement one space of a terrain takes a unit that may end its movement there. Terrain
 * that asks for a skill is crossed by a unit that has one of the skills the table names, or one whose
 * `crossing` opens that kind to it.
 * @param {string} key              A key of FEO.terrain.types
 * @param {Mover|null} [mover]      Who is moving; without one the table's own cost is given
 * @returns {number}                Infinity for terrain the unit cannot cross
 */
export function moveCost(key, mover = null) {
  const type = terrainType(key);
  const kind = key in FEO.terrain.types ? key : FEO.terrain.default;
  const crossing = mover?.crossing ?? null;

  // What the weather has every tile cost more, on top of whatever the tile itself takes
  const more = Math.max(mover?.weather ?? 0, 0);

  // What nobody crosses stops those who fly as well
  if ( type.impassable ) return Infinity;
  if ( flies(mover) ) return 1 + more;
  if ( type.needs?.length && !crossing?.kinds?.includes(kind) ) {
    const skills = (mover?.skills ?? []).map((name) => String(name).toLowerCase());
    if ( !type.needs.some((name) => skills.includes(name.toLowerCase())) ) return Infinity;
  }
  if ( crossing?.all || crossing?.free?.includes(kind) ) return 1 + more;
  if ( type.free && mover ) {
    const cls = String(mover.className ?? "").toLowerCase();
    const free = (type.free.magic && mover.magic) || (type.free.shifted && mover.shifted)
      || (type.free.classes ?? []).some((name) => !!cls && (cls === name.toLowerCase()));
    if ( free ) return 1 + more;
  }
  const cost = type.slow?.qualities.some((quality) => hasQuality(mover, quality)) ? type.slow.cost : type.cost;
  return Math.min(cost, crossing?.cost?.[kind] ?? Infinity) + more;
}

/* -------------------------------------------- */

/**
 * What entering a tile of a terrain takes a unit on its way, and whether it may end its movement there. A unit
 * whose skill has it pass through what it cannot cross enters such a tile at the cost the skill names, and has
 * to go on.
 * @param {string} key              A key of FEO.terrain.types
 * @param {Mover|null} [mover]      Who is moving
 * @returns {{cost: number, stop: boolean}}     `cost` is Infinity for a tile the unit cannot enter at all
 */
export function passCost(key, mover = null) {
  const cost = moveCost(key, mover);
  if ( Number.isFinite(cost) ) return { cost, stop: true };
  const phase = mover?.crossing?.phase ?? null;
  return { cost: (phase != null) ? phase + Math.max(mover?.weather ?? 0, 0) : Infinity, stop: false };
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

  // A unit the ground takes nothing from keeps what it adds
  const given = mover?.crossing?.steady ? (value) => Math.max(value ?? 0, 0) : (value) => value ?? 0;
  return { terrain, elevation: height, def: given(type.def), res: given(type.res), dodge: given(type.dodge) };
}

/* -------------------------------------------- */

/**
 * What a tile gives the unit standing on it once its bonuses are negated: what it adds to Defence, Resistance
 * and Dodge is gone, what it takes away stays, and so does the height it lies at.
 * @param {Ground|null} ground
 * @returns {Ground|null}
 */
export function withoutBonuses(ground) {
  if ( !ground ) return ground;
  const least = (value) => Math.min(value ?? 0, 0);
  return { ...ground, def: least(ground.def), res: least(ground.res), dodge: least(ground.dodge) };
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
  return !!(type.def || type.res || type.dodge || type.heal || type.impassable) || ((type.cost ?? 1) > 1);
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

/**
 * How units stand in each other's way on the map, and what skills change about it: moving through enemies,
 * ending a move on a tile another unit stands on, stopping enemies beside a unit, stepping diagonally, and the
 * damage a move deals to the enemies it passes through or passes by. Pure functions of plain data, so that
 * they can be tested outside of Foundry.
 *
 * A skill changes it with a `passing` part among its effects (see `skills.mjs`), which is always there, never
 * at a moment or as an aura, and may wait for its skill to be switched on:
 *
 *   passing: {
 *     through: "all",          // its unit moves through enemies as though they were allies; a number for
 *                              // that many enemies a turn
 *     extra: 2,                // each enemy it moves through this way takes that much more movement
 *     free: 1,                 // the first so many enemies it moves through take no movement but what the
 *                              // terrain under them adds
 *     share: true,             // it may end its move on a tile one other unit stands on, any other unit may
 *                              // end its move on the tile it stands on, and while it shares a tile it is in
 *                              // no enemy's way
 *     diagonal: 1,             // steps of a move it may take diagonally, each as one space
 *     zone: true,              // an enemy that enters a tile next to it ends its movement there
 *     hits: { percent: 10 },   // damage to each enemy it moves through: a share of that enemy's maximum HP,
 *                              // an `amount`, or both; `nonlethal: true` leaves 1 HP at least
 *     brushes: { amount: 4, self: 2, nonlethal: true }     // damage to each enemy next to a tile it moves
 *                              // onto, and `self` to the unit for each enemy damaged this way
 *   }
 *
 * Every number may be read from the unit, as anywhere else: `{ of: "level", ... }`. What a unit's skills say
 * is added up as its `Passing`, which the map reads as it works out where the unit can go (see `reach.mjs`).
 */

/**
 * @typedef PassWay
 * A leave to move through enemies.
 * @property {number} limit       How many enemies a turn; Infinity for any number
 * @property {number} extra       The movement each of them takes on top
 *
 * @typedef PathDamage
 * Damage a move deals.
 * @property {string} skill       The skill it comes from
 * @property {number} amount      Points of damage
 * @property {number} percent     A share of the maximum HP of the unit that takes it, on top
 * @property {number} [self]      Points the moving unit takes for each enemy damaged
 * @property {boolean} nonlethal  Does it leave 1 HP at least?
 *
 * @typedef Passing
 * What a unit's skills change about how units stand in its way, and it in theirs.
 * @property {PassWay[]} ways           Its leaves to move through enemies, the cheapest first
 * @property {number} free              Enemies it moves through for no movement but the terrain's
 * @property {boolean} share            May it share a tile?
 * @property {number} diagonal          Diagonal steps a move
 * @property {boolean} zone             Do enemies stop beside it?
 * @property {PathDamage[]} hits        Damage to the enemies it moves through
 * @property {PathDamage[]} brushes     Damage to the enemies it moves past
 */

/** The parts a `passing` can have. */
export const PASSING_PARTS = ["through", "extra", "free", "share", "diagonal", "zone", "hits", "brushes"];

/** The parts of the damage a move deals. */
const DAMAGE_PARTS = { hits: ["amount", "percent", "nonlethal"], brushes: ["amount", "percent", "self", "nonlethal"] };

/**
 * A unit whose skills change nothing about how units stand in its way.
 * @returns {Passing}
 */
export function emptyPassing() {
  return { ways: [], free: 0, share: false, diagonal: 0, zone: false, hits: [], brushes: [] };
}

/* -------------------------------------------- */

/**
 * Add what one `passing` part says to what a unit's skills come to so far.
 * @param {Passing} total
 * @param {object} [part]             The `passing` part of an effect
 * @param {object} [options]
 * @param {string} [options.skill]    The skill it belongs to
 * @param {(value: number|object) => number} [options.read]     Works out a number that is read from the unit
 * @returns {Passing}                 The total, changed
 */
export function addPassing(total, part, { skill = "", read = (value) => Number(value) || 0 } = {}) {
  if ( !part || (typeof part !== "object") ) return total;
  const whole = (value) => Math.max(Math.floor(read(value)) || 0, 0);
  if ( part.through !== undefined ) {
    const limit = (part.through === "all") ? Infinity : whole(part.through);
    if ( limit > 0 ) {
      total.ways.push({ limit, extra: whole(part.extra ?? 0) });
      total.ways.sort((a, b) => a.extra - b.extra);
    }
  }
  if ( part.free !== undefined ) total.free += whole(part.free);
  if ( part.share ) total.share = true;
  if ( part.diagonal !== undefined ) total.diagonal += whole(part.diagonal);
  if ( part.zone ) total.zone = true;
  for ( const key of ["hits", "brushes"] ) {
    const harm = part[key];
    if ( !harm || (typeof harm !== "object") ) continue;
    const entry = { skill, amount: whole(harm.amount ?? 0), percent: Math.max(read(harm.percent ?? 0), 0), nonlethal: !!harm.nonlethal };
    if ( key === "brushes" ) entry.self = whole(harm.self ?? 0);
    if ( entry.amount || entry.percent ) total[key].push(entry);
  }
  return total;
}

/* -------------------------------------------- */

/**
 * Does anything about a unit's passing change where it can go?
 * @param {Passing|null} [passing]
 * @returns {boolean}
 */
export function threads(passing) {
  return !!passing && (passing.ways.length > 0 || passing.share || (passing.diagonal > 0));
}

/* -------------------------------------------- */

/**
 * The movement an enemy takes a unit on top, to move through it: that of the cheapest leave it has not used up.
 * @param {Passing|null} passing
 * @param {number} passed       The enemies it has moved through already this turn
 * @returns {number}            Infinity for a unit that cannot move through another enemy
 */
export function passExtra(passing, passed) {
  let room = 0;
  for ( const way of passing?.ways ?? [] ) {
    room += way.limit;
    if ( passed < room ) return way.extra;
  }
  return Infinity;
}

/* -------------------------------------------- */

/**
 * The number of enemies moved through after which nothing changes any more for a unit: what a search for its
 * ways need count no further than.
 * @param {Passing|null} passing
 * @returns {number}
 */
export function passCap(passing) {
  const counted = (passing?.ways ?? []).reduce((sum, way) => sum + (Number.isFinite(way.limit) ? way.limit : 0), 0);
  return Math.max(counted, passing?.free ?? 0);
}

/* -------------------------------------------- */

/**
 * Check the `passing` part of a skill effect, so that a typing mistake does not pass silently.
 * @param {object} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkPassing(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || !Object.keys(part).length ) return ["passing must say what changes"];
  const number = (value) => (typeof value === "number") ? (value >= 0) : (!!value && (typeof value === "object") && (value.of !== undefined));
  for ( const key of Object.keys(part) ) {
    if ( !PASSING_PARTS.includes(key) ) problems.push(`passing cannot say "${key}"`);
  }
  if ( (part.through !== undefined) && (part.through !== "all") && !(Number.isInteger(part.through) && (part.through >= 1)) ) {
    problems.push('passing: "through" is "all" or a whole number of enemies a turn');
  }
  if ( (part.extra !== undefined) && (part.through === undefined) ) problems.push('passing: "extra" goes with "through"');
  for ( const key of ["extra", "free"] ) {
    if ( (part[key] !== undefined) && !(Number.isInteger(part[key]) && (part[key] >= 0)) ) problems.push(`passing: "${key}" is a whole number`);
  }
  for ( const key of ["share", "zone"] ) {
    if ( (part[key] !== undefined) && (part[key] !== true) ) problems.push(`passing: "${key}" is true or left out`);
  }
  if ( (part.diagonal !== undefined) && !number(part.diagonal) ) problems.push('passing: "diagonal" is a number of steps');
  for ( const [key, parts] of Object.entries(DAMAGE_PARTS) ) {
    const harm = part[key];
    if ( harm === undefined ) continue;
    if ( !harm || (typeof harm !== "object") ) {
      problems.push(`passing: "${key}" says what damage is dealt`);
      continue;
    }
    for ( const name of Object.keys(harm) ) if ( !parts.includes(name) ) problems.push(`passing: "${key}" cannot say "${name}"`);
    if ( (harm.amount === undefined) && (harm.percent === undefined) ) problems.push(`passing: "${key}" deals an "amount" or a "percent" of maximum HP`);
    for ( const name of ["amount", "percent", "self"] ) {
      if ( (harm[name] !== undefined) && !number(harm[name]) ) problems.push(`passing: "${name}" of "${key}" is a number`);
    }
    if ( (harm.nonlethal !== undefined) && (typeof harm.nonlethal !== "boolean") ) problems.push(`passing: "nonlethal" of "${key}" is true or false`);
  }
  return problems;
}

/* -------------------------------------------- */
/*  Damage along a Path                         */
/* -------------------------------------------- */

/**
 * @typedef PathUnit
 * A unit a move may pass.
 * @property {string} id
 * @property {{i: number, j: number}} tile
 * @property {boolean} foe            Is it an enemy of the unit that moves?
 * @property {boolean} [down]         Is it Incapacitated? Such a unit is in nobody's way
 * @property {number} [hp]
 * @property {number} [hpMax]
 *
 * @typedef PathBlow
 * Damage a move deals to one unit.
 * @property {string} id              The unit; blank for the unit that moves
 * @property {string} skill           The skill it comes from
 * @property {number} amount          The damage as it is dealt
 * @property {boolean} nonlethal      Does it leave 1 HP at least?
 *
 * @typedef PathHarm
 * What a move does to the units along its way.
 * @property {string[]} passed                The enemies the unit moves through, in the order it does
 * @property {PathBlow[]} blows               Every blow it deals, in that order, then what it takes itself
 * @property {Record<string, number>} shown   The HP each unit hit is expected to lose, the moving unit under ""
 */

const near = (a, b) => (Math.abs(a.i - b.i) + Math.abs(a.j - b.j)) === 1;
const same = (a, b) => (a.i === b.i) && (a.j === b.j);

/**
 * What a move does to the units along its way: which enemies the unit moves through, the damage it deals to
 * them and to the enemies it moves past, and the damage it takes itself for it.
 *
 * An enemy is moved through when the unit enters its tile and goes on; one whose tile the move ends on is not.
 * An enemy is moved past when it stands next to a tile the unit moves onto, or on one.
 * @param {{i: number, j: number}[]} way      The tiles the unit moves onto, from the first step to the last
 * @param {Passing|null} passing              What its skills make of passing
 * @param {PathUnit[]} units                  The other units on the map
 * @param {object} [mover]
 * @param {number} [mover.hp]                 The HP of the unit that moves
 * @returns {PathHarm}
 */
export function pathHarm(way, passing, units, { hp = Infinity } = {}) {
  const harm = { passed: [], blows: [], shown: {} };
  const steps = way ?? [];
  if ( !steps.length ) return harm;
  const foes = (units ?? []).filter((unit) => unit.foe && !unit.down && unit.tile);
  const left = new Map(foes.map((unit) => [unit.id, unit.hp ?? Infinity]));

  // A blow is counted against the HP its target has left, so that what is shown is what it will lose
  const strike = (id, entry, hpMax, own = null) => {
    const amount = own ?? (entry.amount + Math.floor(((hpMax ?? 0) * entry.percent) / 100));
    if ( !(amount > 0) ) return 0;
    const before = id ? left.get(id) : hp;
    const dealt = Math.max(Math.min(amount, entry.nonlethal ? before - 1 : before), 0);
    if ( id ) left.set(id, before - dealt);
    else hp = before - dealt;
    harm.blows.push({ id, skill: entry.skill, amount, nonlethal: entry.nonlethal });
    if ( dealt > 0 ) harm.shown[id] = (harm.shown[id] ?? 0) + dealt;
    return dealt;
  };

  // The enemies moved through, in the order of the way
  const last = steps.at(-1);
  for ( const step of steps ) {
    if ( same(step, last) ) continue;
    for ( const foe of foes ) {
      if ( !same(foe.tile, step) || harm.passed.includes(foe.id) ) continue;
      harm.passed.push(foe.id);
      for ( const entry of passing?.hits ?? [] ) strike(foe.id, entry, foe.hpMax);
    }
  }

  // The enemies moved past, each once, and what the unit takes for each of them it damaged
  const brushes = passing?.brushes ?? [];
  if ( brushes.length ) {
    const brushed = foes.filter((foe) => steps.some((step) => near(step, foe.tile) || same(step, foe.tile)));
    for ( const entry of brushes ) {
      let damaged = 0;
      for ( const foe of brushed ) if ( strike(foe.id, entry, foe.hpMax) > 0 ) damaged++;
      if ( entry.self && damaged ) strike("", entry, 0, entry.self * damaged);
    }
  }
  return harm;
}

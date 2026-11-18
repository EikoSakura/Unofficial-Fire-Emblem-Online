/**
 * Weather for Fire Emblem Online, as the Weather page of the rules has it: what the kinds of weather that are
 * switched on for a map do to a unit that moves, stands and ends its turn on it, and what strikes the map by
 * itself as a turn of the battle ends. Pure functions of plain data that take their dice as a function, so
 * that they can be tested outside of Foundry. The kinds are the table `FEO.weather` in `config.mjs`.
 *
 * What a kind does is one or more of:
 *
 *   move      what a tile costs more to cross, by what the unit is: one that flies, one that is mounted, and
 *             every other, which the rules call infantry
 *   stats     what its stats change by while the weather lasts
 *   harm      the damage it takes as its turn ends, which never brings it below 1 HP
 *   los       the Line of Sight it has at the least
 *   fatigue   the Fatigue it gains as its turn ends, for a world that plays with that Optional Module
 *   fog       it causes Fog of War, which the system does not draw: it is the Game Master's to run
 *   strikes   bolts that strike tiles picked by dice as a turn of the battle ends: "lightning", "ballista"
 *
 * Several kinds may be switched on together. Each effect then counts once, at the most any of them makes of
 * it: Rain in a Thunderstorm costs no more movement than either, and Hail in a Heat Wave deals 1 damage.
 *
 * A unit whose skills say `rules: ["weatherproof"]` is spared the effects of weather: what tiles cost more,
 * what its stats lose, the damage and the Fatigue of a turn's end. It is not spared Fog of War, with the Line
 * of Sight a Mist sets, nor a bolt that strikes its tile.
 */
import { FEO } from "../config.mjs";

/** The rule that spares a unit the effects of weather, but for Fog of War and what strikes the map. */
export const WEATHERPROOF = "weatherproof";

/**
 * @typedef WeatherUnit
 * A unit as the weather reads it.
 * @property {string} [qualities]     Its Special Qualities, as free text
 * @property {boolean} [flier]        Does a skill have it cross terrain as a Flying unit does?
 * @property {boolean} [proof]        Do its skills spare it the effects of weather?
 * @property {number} [los]           Its Line of Sight without the weather
 */

/**
 * @typedef WeatherEffect
 * What the weather comes to for one unit.
 * @property {number} move                      What each tile costs it more to cross
 * @property {Record<string, number>} stats     What its stats change by
 * @property {number} harm                      The damage it takes as its turn ends
 * @property {number} los                       What is added to its Line of Sight
 * @property {number} fatigue                   The Fatigue it gains as its turn ends
 * @property {Record<string, string>} by        The kind of weather each of those comes from
 */

/* -------------------------------------------- */

/**
 * The kinds of weather in a list that the table knows, each once, in the order of the table.
 * @param {string[]|string|null} [list]
 * @returns {string[]}
 */
export function weatherKinds(list) {
  const wanted = new Set([].concat(list ?? []).filter((kind) => typeof kind === "string"));
  return Object.keys(FEO.weather.kinds).filter((kind) => wanted.has(kind));
}

/* -------------------------------------------- */

const has = (unit, quality) => String(unit?.qualities ?? "").toLowerCase().includes(String(quality).toLowerCase());

/**
 * What a unit is to the weather: one that flies, one that is mounted, or infantry, which is every other.
 * @param {WeatherUnit|null} [unit]
 * @returns {"flying"|"mounted"|"infantry"}
 */
export function weatherClass(unit) {
  if ( unit?.flier || has(unit, FEO.weather.flying) ) return "flying";
  return has(unit, FEO.weather.mounted) ? "mounted" : "infantry";
}

/* -------------------------------------------- */

/**
 * What the weather comes to for a unit.
 * @param {string[]} kinds              The kinds that are switched on
 * @param {WeatherUnit|null} [unit]
 * @returns {WeatherEffect}
 */
export function weatherFor(kinds, unit = null) {
  const out = { move: 0, stats: {}, harm: 0, los: 0, fatigue: 0, by: {} };
  const cls = weatherClass(unit);
  const proof = !!unit?.proof;
  const most = (key, amount, kind) => {
    if ( !(amount > (out[key] ?? 0)) ) return;
    out[key] = amount;
    out.by[key] = kind;
  };
  for ( const kind of weatherKinds(kinds) ) {
    const weather = FEO.weather.kinds[kind];

    // Fog of War is not what a unit can be spared, and neither is the Line of Sight a kind of it sets
    if ( Number.isFinite(weather.los) && Number.isFinite(unit?.los) ) most("los", Math.max(weather.los - unit.los, 0), kind);
    if ( proof ) continue;
    most("move", weather.move?.[cls] ?? 0, kind);
    most("harm", weather.harm ?? 0, kind);
    most("fatigue", weather.fatigue ?? 0, kind);
    for ( const [stat, amount] of Object.entries(weather.stats ?? {}) ) {
      if ( !(amount < (out.stats[stat] ?? 0)) ) continue;
      out.stats[stat] = amount;
      out.by[stat] = kind;
    }
  }
  return out;
}

/* -------------------------------------------- */

/**
 * Does any kind that is switched on cause Fog of War?
 * @param {string[]} kinds
 * @returns {boolean}
 */
export function causesFog(kinds) {
  return weatherKinds(kinds).some((kind) => !!FEO.weather.kinds[kind].fog);
}

/* -------------------------------------------- */
/*  What Strikes the Map                        */
/* -------------------------------------------- */

/**
 * What strikes the map by itself as a turn of the battle ends, for the kinds that are switched on: lightning
 * at the end of every turn, ballista bolts at the end of every other. Each is listed once, however many kinds
 * bring it.
 * @param {string[]} kinds
 * @param {number} turn       The turn of the battle that ends, counted from 1
 * @returns {{strike: string, kind: string}[]}
 */
export function strikesDue(kinds, turn) {
  const due = [];
  for ( const kind of weatherKinds(kinds) ) {
    const strike = FEO.weather.kinds[kind].strikes;
    const config = FEO.weather.strikes[strike];
    if ( !config || due.some((entry) => entry.strike === strike) ) continue;
    if ( !(turn >= 1) || ((turn % Math.max(config.every ?? 1, 1)) !== 0) ) continue;
    due.push({ strike, kind });
  }
  return due;
}

/* -------------------------------------------- */

/**
 * The most dice the strikes of a turn's end can need: for each, what says whether and how often it strikes,
 * and two for every tile.
 * @param {string[]} kinds
 * @param {number} turn
 * @returns {number}
 */
export function strikeDice(kinds, turn) {
  return strikesDue(kinds, turn).reduce((sum, { strike }) => {
    const config = FEO.weather.strikes[strike];
    return sum + 1 + (2 * (config.dice ?? 1));
  }, 0);
}

/* -------------------------------------------- */

/**
 * Roll what strikes the map as a turn of the battle ends. Lightning is a coin: on tails one bolt strikes.
 * Ballista fire is a die of bolts. Where each bolt lands is picked by rolling the size of the map: a die of
 * its width for the column and one of its height for the row.
 * @param {string[]} kinds
 * @param {number} turn                             The turn of the battle that ends
 * @param {{rows: number, cols: number}} size       The size of the map in tiles
 * @param {(faces: number) => number} die           Returns a whole number from 1 to that many
 * @returns {{strike: string, kind: string, roll: number, faces: number, bolts: {row: number, col: number}[]}[]}
 *          For each strike that was due: what was rolled for it and on how many faces, and where its bolts
 *          land, counted from 1 from the top left of the map. One that does not come has no bolts
 */
export function rollStrikes(kinds, turn, size, die) {
  const rows = Math.max(Math.floor(size?.rows ?? 0), 0);
  const cols = Math.max(Math.floor(size?.cols ?? 0), 0);
  if ( !rows || !cols ) return [];
  return strikesDue(kinds, turn).map(({ strike, kind }) => {
    const config = FEO.weather.strikes[strike];
    const faces = config.dice ?? 2;
    const roll = die(faces);

    // A coin strikes once on tails, which is its second face; a die of bolts strikes as often as it shows
    const count = config.dice ? roll : ((roll === 2) ? 1 : 0);
    const bolts = [];
    for ( let index = 0; index < count; index++ ) bolts.push({ col: die(cols), row: die(rows) });
    return { strike, kind, roll, faces, bolts };
  });
}

/* -------------------------------------------- */

/**
 * The damage a bolt deals the unit on the tile it strikes: none on a tile that is indoors, and more to a unit
 * with a Special Quality the strike names.
 * @param {string} strike                   "lightning" or "ballista"
 * @param {{qualities?: string}|null} unit  The unit on the tile, if one stands there
 * @param {string} [terrain]                The kind of terrain of the tile
 * @returns {{damage: number, indoors: boolean}}
 */
export function strikeDamage(strike, unit, terrain = FEO.terrain.default) {
  const config = FEO.weather.strikes[strike];
  const indoors = FEO.weather.indoors.includes(terrain);
  if ( !config || indoors || !unit ) return { damage: 0, indoors };
  const more = Object.entries(config.against ?? {}).filter(([quality]) => has(unit, quality)).map(([, amount]) => amount);
  return { damage: Math.max(config.damage ?? 0, ...more), indoors };
}

/* -------------------------------------------- */

/**
 * Check a list of kinds of weather, so that a typing mistake does not pass silently.
 * @param {*} list
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkWeather(list) {
  if ( !Array.isArray(list) ) return ["weather is a list of kinds"];
  return list.filter((kind) => !(kind in FEO.weather.kinds)).map((kind) => `unknown weather "${kind}"`);
}

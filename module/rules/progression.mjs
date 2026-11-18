/**
 * Levelling, ability check and support formulas for Fire Emblem Online.
 * Pure functions, so that they can be tested outside of Foundry.
 */

/**
 * @typedef GrowthResult
 * @property {string} key       The stat that was rolled
 * @property {number} growth    Its growth rate, in percent
 * @property {number|null} roll The d100 result, or null if the stat was not rolled
 * @property {number} gain      Points gained
 * @property {boolean} capped   Was the stat already at its cap?
 */

/**
 * Roll every growth rate for a level up.
 * A stat increases when the d100 is equal to or lower than its growth rate. A rate above 100% guarantees one
 * point, with the amount above 100% being the chance of a second. Capped stats are not rolled.
 * @param {Record<string, number>} growths    Growth rates in percent, keyed by stat
 * @param {Iterable<string>} capped           Stats that are at their cap
 * @param {() => number} d100                 Returns a whole number from 1 to 100
 * @returns {GrowthResult[]}
 */
export function rollGrowths(growths, capped, d100) {
  const atCap = new Set(capped);
  return Object.entries(growths).map(([key, growth]) => {
    if ( atCap.has(key) ) return { key, growth, roll: null, gain: 0, capped: true };
    const roll = d100();
    let gain;
    if ( growth >= 100 ) gain = 1 + (roll <= (growth - 100) ? 1 : 0);
    else gain = roll <= growth ? 1 : 0;
    return { key, growth, roll, gain, capped: false };
  });
}

/* -------------------------------------------- */

/**
 * @typedef GainRow
 * What one stat may take at a level up with Manual Stat Gains.
 * @property {string} key
 * @property {boolean} capped     Is the stat at its cap? It then takes no point
 * @property {boolean} proc       Did its growth rate come up, in a reading that rolls them?
 * @property {number} most        The most points it may take
 * @property {number} per         What each point raises it by
 * @property {boolean} all        Does raising it take every point there is?
 */

/**
 * What each stat may take at a level up with Manual Stat Gains: one point, which raises it by one. Where
 * growth rates are still rolled, a stat whose rate came up may take a second point in the `open` reading, and
 * rises by two for its one point in the `double` reading. A stat at its cap takes none.
 * @param {string[]} keys                 The stats that can rise at a level up, in order
 * @param {object} [options]
 * @param {Iterable<string>} [options.capped]   Stats at their cap
 * @param {Iterable<string>} [options.procs]    Stats whose growth rate came up
 * @param {"points"|"open"|"double"} [options.mode]
 * @param {string[]} [options.all]        Stats that take every point there is
 * @returns {GainRow[]}
 */
export function gainRows(keys, { capped = [], procs = [], mode = "points", all = [] } = {}) {
  const atCap = new Set(capped);
  const cameUp = new Set(mode === "points" ? [] : procs);
  return keys.map((key) => {
    const proc = cameUp.has(key);
    const whole = all.includes(key);
    return {
      key,
      capped: atCap.has(key),
      proc,
      most: atCap.has(key) ? 0 : (((mode === "open") && proc && !whole) ? 2 : 1),
      per: ((mode === "double") && proc) ? 2 : 1,
      all: whole
    };
  });
}

/* -------------------------------------------- */

/**
 * Check the points placed at a level up with Manual Stat Gains, and work out what each stat gains.
 * @param {GainRow[]} rows                    As `gainRows` gives them
 * @param {Record<string, number>} spend      Points placed, by stat
 * @param {number} points                     The points the level up gives
 * @returns {{valid: boolean, spent: number, left: number, gains: Record<string, number>,
 *   problems: {code: "tooMany"|"over", key?: string}[]}}
 */
export function planGains(rows, spend, points) {
  const problems = [];
  const gains = {};
  let spent = 0;
  for ( const row of rows ) {
    const placed = Math.max(Math.trunc(spend?.[row.key]) || 0, 0);
    if ( !placed ) continue;
    if ( placed > row.most ) problems.push({ code: "tooMany", key: row.key });
    spent += row.all ? Math.max(points, 1) : placed;
    gains[row.key] = placed * row.per;
  }
  if ( spent > points ) problems.push({ code: "over" });
  return { valid: !problems.length, spent, left: points - spent, gains, problems };
}

/* -------------------------------------------- */

/**
 * Ability points gained on a level up: the higher of Charm and Intelligence, plus half of Luck.
 * @param {number} cha
 * @param {number} int
 * @param {number} luk
 * @returns {number}
 */
export function abilityPointsPerLevel(cha, int, luk) {
  return Math.max(cha, int) + Math.floor(luk / 2);
}

/* -------------------------------------------- */

/**
 * Ability points granted at character creation: five times the higher of Charm and Intelligence, plus five
 * that may only be spent on saving throws.
 * @param {number} cha
 * @param {number} int
 * @returns {number}
 */
export function startingAbilityPoints(cha, int) {
  return (Math.max(cha, int) * 5) + 5;
}

/* -------------------------------------------- */

/**
 * The bonus added to a d100 for an ability check or saving throw.
 * @param {number} stat       The governing stat
 * @param {number} luk        Total Luck
 * @param {number} points     Ability points spent
 * @param {number} [extra]    Any further stat added in full, such as Line of Sight for Perception
 * @returns {number}
 */
export function abilityBonus(stat, luk, points, extra = 0) {
  return Math.floor((stat ?? 0) + ((luk ?? 0) / 3) + (points ?? 0) + (extra ?? 0));
}

/* -------------------------------------------- */

/**
 * Map Affinity: what a unit gains on a map that has an Affinity of its own. A unit whose Affinity is the same
 * as the map's receives the bonus; any other unit, and every unit on a map without an Affinity, receives none.
 * @param {string} map                      The Affinity of the map; blank for a map without one
 * @param {string} own                      The unit's Affinity
 * @param {{hit: number, dodge: number}} bonus      What a match gives
 * @returns {{hit: number, dodge: number}|null}     Null where the two are not the same
 */
export function mapAffinityBonus(map, own, bonus) {
  if ( !map || !own || (map !== own) ) return null;
  return { hit: bonus?.hit ?? 0, dodge: bonus?.dodge ?? 0 };
}

/* -------------------------------------------- */

/**
 * The boosts an affinity can give through a support. ATK adds damage and END reduces damage taken; HST (Haste)
 * counts as Attack Speed for making a follow-up attack and for nothing else; `activation` is the Skill
 * Activation rate. The last four are only given by the Optional Affinities.
 */
export const SUPPORT_BOOSTS = ["atk", "end", "hit", "dodge", "critical", "critAvoid", "hst", "activation"];

/**
 * The bonuses a unit receives from one support partner in range:
 * (the unit's affinity boosts + the partner's affinity boosts) × support level, rounded down.
 * @param {Record<string, number>} [own]        This unit's affinity boosts
 * @param {Record<string, number>} [partner]    The partner's affinity boosts
 * @param {number} level                        The support level
 * @returns {Record<"atk"|"end"|"hit"|"dodge"|"critical"|"critAvoid"|"hst"|"activation", number>}
 */
export function supportBonus(own, partner, level) {
  const bonus = {};
  for ( const key of SUPPORT_BOOSTS ) {
    bonus[key] = Math.floor(((own?.[key] ?? 0) + (partner?.[key] ?? 0)) * (level ?? 0));
  }
  return bonus;
}

/* -------------------------------------------- */

/**
 * What the support partners in range add up to, apart from the combat stats their bonuses are added to by
 * name: the damage taken off every hit, the Attack Speed counted towards a follow-up, and the Skill Activation
 * rate.
 * @param {{inRange?: boolean, bonus?: Record<string, number>}[]} bonds
 * @returns {{end: number, hst: number, activation: number}}
 */
export function supportTotals(bonds) {
  const totals = { end: 0, hst: 0, activation: 0 };
  for ( const bond of bonds ?? [] ) {
    if ( !bond.inRange ) continue;
    for ( const key of Object.keys(totals) ) totals[key] += bond.bonus?.[key] ?? 0;
  }
  return totals;
}

/* -------------------------------------------- */

/**
 * Does a unit make a follow-up attack on its Attack Speed alone? Its Haste counts towards its own follow-up;
 * it does nothing against the foe's.
 * @param {number} speed        The unit's Attack Speed
 * @param {number} foeSpeed     The foe's Attack Speed
 * @param {number} threshold    The lead needed to make a follow-up attack
 * @param {number} [haste]      The unit's Haste
 * @returns {boolean}
 */
export function followsUp(speed, foeSpeed, threshold, haste = 0) {
  return ((speed ?? 0) + (haste ?? 0) - (foeSpeed ?? 0)) >= threshold;
}

/* -------------------------------------------- */

/**
 * The gold an item sells for: half its cost, scaled by its remaining uses.
 * @param {number} cost
 * @param {number} uses     Remaining uses
 * @param {number} max      Total uses
 * @returns {number}
 */
export function sellValue(cost, uses, max) {
  if ( !(max > 0) ) return Math.floor((cost ?? 0) / 2);
  return Math.floor(((cost ?? 0) / max * (uses ?? 0)) / 2);
}

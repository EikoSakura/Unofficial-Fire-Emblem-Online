/**
 * What a unit chooses before a fight, and what its skills make of the choice: one combat number traded for
 * another, something spent for damage, one attack made in place of several, the foe's bonuses cancelled or
 * turned around. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill that is chosen when to activate (see `skill-usage.mjs`) is switched on before the fight, and its
 * effects marked `when: { declared: true }` then apply. These parts of an effect are always there, never at a
 * moment or as an aura, and most of them make sense only on such an effect:
 *
 *   trade: { give: { accuracy: "half" }, gain: { critical: "double" } }
 *                                       // half of one number given up for another doubled
 *   trade: { id: "dodge", give: { dodge: 3 }, gain: { critical: 1, hit: 2 }, pick: true }
 *                                       // in steps: each takes what it gives and adds what it gains. With
 *                                       // `pick` the unit picks how many, kept on its skill by that `id`; as
 *                                       // many as it has to give unless it picked
 *   trade: { give: { critical: 6 }, gain: { damage: 1 }, rest: true }
 *                                       // `rest`: what is left of what it gives is given up as well, and
 *                                       // for Critical its unit makes no critical hit
 *
 * A trade gives of "accuracy", "critical", "dodge", "endurance" (END) and "haste" (HST), and gains "hit",
 * "critical", "dodge", "damage" and "haste". A unit that can make no critical hit has no Critical to give.
 *
 *   spend: { id: "hp", hp: 3, gain: { might: 1 } }
 *                                       // HP paid as the fight begins, in steps the unit picks (one unless it
 *                                       // picked), each for what it gains: "might" or "damage". It keeps 1 HP
 *   spend: { id: "forms", transforms: 1, gain: { damage: 2 } }
 *                                       // transformations it still has this turn, the same way
 *
 *   single: { hit: 15, critical: 10, damagePercent: 25 }
 *                                       // a unit that would make several attacks makes one, with this much
 *                                       // more Hit and Critical and, for each attack given up, this share of
 *                                       // its damage before the foe's defence; `stat: ["def", "res"]` has
 *                                       // the highest of these stats added to the weapon's Might in place
 *                                       // of Strength
 *   noWeight: true                      // its weapon and its Shield weigh nothing as Attack Speed is worked out
 *   against: "res"                      // its attacks are resisted by RES ("def" for DEF), whatever the
 *                                       // weapon; "lower" for whichever of the two leaves more damage
 *   hitCap: 45                          // a hit takes no more than this share of its maximum HP off it
 *   foeBonus: { stats: ["spd", "res"], times: -1 }
 *                                       // what the foe's skills, the auras it receives and the changes that
 *                                       // last on it add to these stats is multiplied by this: 0 cancels it,
 *                                       // -1 turns it around. `stats: "pick"` is one stat the unit picks,
 *                                       // kept on its skill as `stat`; the one with the most to lose unless
 *                                       // it picked
 *   cooldowns: -1                       // turns added to the cooldown of every skill its unit uses
 *   rearm: true                         // it may change the weapon in hand before a fight an enemy starts
 *
 * On an attack or a hit (see `skills.mjs`), `asCrit: true` has the attack count as a critical hit for what
 * waits for one, without the damage of one; on an attack, `effective: true` has it deal effective damage and
 * `against` sets what resists that attack. `proc: { ..., spends: true }` has a declared skill spent only by a
 * fight in which that moment took effect.
 */
import { FEO } from "../config.mjs";

/** What a trade can give of, and what it can gain. */
export const TRADE_GIVES = ["accuracy", "critical", "dodge", "endurance", "haste"];
export const TRADE_GAINS = ["hit", "critical", "dodge", "damage", "haste"];

/** What can be spent for damage, and what that buys. */
export const SPEND_COSTS = ["hp", "transforms"];
export const SPEND_GAINS = ["might", "damage"];

/** What an attack can be resisted by: one of the two, or whichever leaves more damage. */
export const AGAINST = ["def", "res", "lower"];

/** The stats a bonus of a foe can be cancelled or turned around on. */
export const BONUS_STATS = ["str", "mag", "dex", "spd", "luk", "def", "res", "con"];

/** The rule that cancels what terrain, supports, weapons, equipment and skills do in a fight, for both units. */
export const PARITY = "parity";

/** The parts of an effect that only do something for the attacks of their unit. */
const ATTACK_PARTS = ["single", "spend", "against", "might", "firstMight", "damageStat", "strikes", "extraAttack", "damageMultiplier", "dealtPercent",
  "ignoreDefence", "effective", "effectiveMultiplier", "weaponRange", "weaponUse"];

/** The moments of a fight that only come through the attacks of their unit. */
const ATTACK_MOMENTS = ["attack", "hit", "crit", "miss", "kill", "blocked", "curbed"];

/** What a trade's gains are added to among the numbers a unit trades with. */
const GAINED = { hit: "accuracy", critical: "critical", dodge: "dodge", damage: "damage", haste: "haste" };

/** The combat stat a number a unit trades with is shown under, for the sum behind it. */
const SHOWN = { accuracy: "hit", critical: "critical", dodge: "dodge", damage: "damage" };

const whole = (value) => Number.isInteger(value) && (value >= 1);

/* -------------------------------------------- */
/*  What a Skill Has Its Unit Pick              */
/* -------------------------------------------- */

/**
 * @typedef FightPick
 * Something a skill has its unit pick for a fight, kept on the skill until it is picked anew.
 * @property {string} id                  What it is kept under
 * @property {"steps"|"stat"} kind        A number of steps, or one stat
 * @property {"trade"|"spend"|"foeBonus"} part    The part of the effect that asks for it
 * @property {object} [give]              For steps of a trade: what each takes
 * @property {object} [gain]              For steps: what each adds
 * @property {{hp?: number, transforms?: number}} [cost]    For steps of a spend: what each costs
 * @property {boolean} all                Is it as many as the unit has, unless it picked?
 */

/**
 * What a skill has its unit pick for a fight, read from its effects: the steps of each trade and of each
 * spend that are picked, and the stat whose bonuses it cancels.
 * @param {object[]} [effects]
 * @returns {FightPick[]}
 */
export function fightPicks(effects = []) {
  const picks = [];
  for ( const effect of effects ?? [] ) {
    const trade = effect?.trade;
    if ( trade?.pick && trade.id ) picks.push({ id: trade.id, kind: "steps", part: "trade", give: { ...trade.give }, gain: { ...trade.gain }, all: true });
    const spend = effect?.spend;
    if ( spend?.id ) {
      const cost = Object.fromEntries(SPEND_COSTS.filter((key) => spend[key] !== undefined).map((key) => [key, spend[key]]));
      picks.push({ id: spend.id, kind: "steps", part: "spend", cost, gain: { ...spend.gain }, all: false });
    }
    if ( effect?.foeBonus?.stats === "pick" ) picks.push({ id: "stat", kind: "stat", part: "foeBonus", all: false });
  }
  return picks.filter((pick, index) => picks.findIndex((other) => other.id === pick.id) === index);
}

/* -------------------------------------------- */

/**
 * What was picked for one of a skill's picks, as a number of steps: a whole number, or null for one that was
 * never picked.
 * @param {Record<string, number|string>} [picked]    What its skill keeps
 * @param {string} [id]
 * @returns {number|null}
 */
export function pickedSteps(picked, id) {
  const value = picked?.[id];
  return (Number.isInteger(value) && (value >= 0)) ? value : null;
}

/* -------------------------------------------- */

/**
 * Change the steps picked for one of a skill's picks by one step up or down, or to all or none of them.
 * @param {number} now                    The steps taken as it stands
 * @param {number} most                   The most it can take
 * @param {"more"|"less"|"all"} how       "all" switches between the most and none
 * @returns {number}
 */
export function stepPick(now, most, how) {
  const top = Math.max(most, 0);
  const held = Math.min(Math.max(now, 0), top);
  if ( how === "more" ) return Math.min(held + 1, top);
  if ( how === "less" ) return Math.max(held - 1, 0);
  return (held >= top) ? 0 : top;
}

/* -------------------------------------------- */
/*  Trades                                      */
/* -------------------------------------------- */

/**
 * @typedef TradeEntry
 * A trade as `skillTotals` collects it.
 * @property {string} skill                   The skill it belongs to
 * @property {object} trade                   The part as it is written
 * @property {number|null} steps              The steps its unit picked; null for as many as it has
 */

/**
 * @typedef Traded
 * What a unit's trades come to.
 * @property {{hit: number, critical: number, dodge: number, damage: number}} combat   Added to its combat stats
 * @property {number} haste                   Added to its HST
 * @property {number} taken                   Added to the damage of every hit it takes: the END it gave up
 * @property {boolean} noCrit                 Does it make no critical hit?
 * @property {{name: string, stats: object, combat: object}[]} sources    What each skill came to, by name
 * @property {string[]} idle                  The skills whose trade came to nothing
 * @property {Record<string, {steps: number, most: number}>} steps    For each trade in steps, by its skill and
 *                                            id ("Skill|id"): the steps taken, and the most there were
 */

/**
 * Work out what a unit's trades come to, one after the other, from the numbers it has to trade with.
 * @param {TradeEntry[]} trades
 * @param {{accuracy: number, critical: number, dodge: number, endurance: number, haste: number}} have
 * @param {object} [options]
 * @param {boolean} [options.canCrit]     Can the unit make a critical hit at all?
 * @returns {Traded}
 */
export function settleTrades(trades, have, { canCrit = true } = {}) {
  const now = { accuracy: 0, critical: 0, dodge: 0, endurance: 0, haste: 0, damage: 0, ...have };
  const start = { ...now };
  const result = { combat: { hit: 0, critical: 0, dodge: 0, damage: 0 }, haste: 0, taken: 0, noCrit: false, sources: [], idle: [], steps: {} };
  for ( const { skill, trade, steps = null } of trades ?? [] ) {
    const before = { ...now };
    const gives = Object.entries(trade?.give ?? {});
    const gains = Object.entries(trade?.gain ?? {});

    // A unit that makes no critical hit has no Critical to give
    const barred = !canCrit && gives.some(([key]) => key === "critical");
    let done = false;
    if ( !barred && gives.some(([, amount]) => amount === "half") ) {
      for ( const [key, amount] of gives ) if ( amount === "half" ) now[key] = Math.floor(Math.max(now[key], 0) / 2);
      for ( const [key, amount] of gains ) now[GAINED[key]] += (amount === "double") ? Math.max(now[GAINED[key]], 0) : amount;
      done = Object.keys(now).some((key) => now[key] !== before[key]);
    }
    else if ( !barred ) {
      const most = Math.min(...gives.map(([key, amount]) => Math.floor(Math.max(now[key], 0) / amount)));
      const taken = Math.max(Math.min(steps ?? most, most), 0);
      for ( const [key, amount] of gives ) now[key] -= taken * amount;
      for ( const [key, amount] of gains ) now[GAINED[key]] += taken * amount;
      if ( trade.id ) result.steps[`${skill}|${trade.id}`] = { steps: taken, most };

      // What is left of what it gave is given up too: a unit without Critical makes no critical hit
      if ( trade.rest ) {
        for ( const [key] of gives ) {
          now[key] = 0;
          if ( key === "critical" ) result.noCrit = true;
        }
      }
      done = (taken > 0) || Object.keys(now).some((key) => now[key] !== before[key]);
    }
    if ( !done ) {
      result.idle.push(skill);
      continue;
    }
    const combat = {};
    for ( const [key, shown] of Object.entries(SHOWN) ) if ( now[key] !== before[key] ) combat[shown] = now[key] - before[key];
    const told = result.sources.find((source) => source.name === skill);
    if ( told ) for ( const [key, amount] of Object.entries(combat) ) told.combat[key] = (told.combat[key] ?? 0) + amount;
    else result.sources.push({ name: skill, stats: {}, combat });
  }
  // A skill whose every trade came to nothing is idle; one of which any was made is not
  const made = new Set(Object.keys(result.steps).filter((key) => result.steps[key].steps > 0).map((key) => key.split("|")[0]));
  for ( const source of result.sources ) made.add(source.name);
  result.idle = [...new Set(result.idle)].filter((name) => !made.has(name));
  for ( const [key, shown] of Object.entries(SHOWN) ) result.combat[shown] = now[key] - start[key];
  result.haste = now.haste - start.haste;
  result.taken = start.endurance - now.endurance;
  return result;
}

/* -------------------------------------------- */
/*  Spending                                    */
/* -------------------------------------------- */

/**
 * @typedef Spent
 * What a unit spends for damage as a fight begins.
 * @property {number} hp                      HP it pays
 * @property {number} transforms              Transformations it gives up
 * @property {number} might                   Added to its weapon's Might
 * @property {number} damage                  Added to its damage
 * @property {{name: string, stats: object, combat: object}[]} sources    What each skill came to, by name
 * @property {string[]} idle                  The skills that had nothing to spend
 * @property {Record<string, {steps: number, most: number}>} steps    By skill and id: the steps taken, and
 *                                            the most there were
 */

/**
 * Work out what a unit spends for damage, one skill after the other.
 * @param {{skill: string, spend: object, steps: number|null}[]} spends
 * @param {{hp: number, transforms: number}} have       Its HP, of which it keeps 1, and the transformations it
 *                                                      still has this turn
 * @returns {Spent}
 */
export function settleSpends(spends, have) {
  const left = { hp: Math.max((have?.hp ?? 0) - 1, 0), transforms: Math.max(have?.transforms ?? 0, 0) };
  const result = { hp: 0, transforms: 0, might: 0, damage: 0, sources: [], idle: [], steps: {} };
  for ( const { skill, spend, steps = null } of spends ?? [] ) {
    const costs = SPEND_COSTS.filter((key) => spend?.[key] > 0);
    const most = costs.length ? Math.min(...costs.map((key) => Math.floor(left[key] / spend[key]))) : 0;
    const taken = Math.max(Math.min(steps ?? 1, most), 0);
    if ( spend?.id ) result.steps[`${skill}|${spend.id}`] = { steps: taken, most };
    if ( !taken ) {
      result.idle.push(skill);
      continue;
    }
    for ( const key of costs ) {
      left[key] -= taken * spend[key];
      result[key] += taken * spend[key];
    }
    const gained = (spend.gain?.might ?? 0) * taken;
    const more = (spend.gain?.damage ?? 0) * taken;
    result.might += gained;
    result.damage += more;
    result.sources.push({ name: skill, stats: {}, combat: { damage: gained + more } });
  }
  return result;
}

/* -------------------------------------------- */
/*  The Foe's Bonuses                           */
/* -------------------------------------------- */

/**
 * What a unit's skills, the auras it receives and the changes that last on it add to each of its stats: the
 * bonuses alone, not what is taken off.
 * @param {{name: string, stats?: Record<string, number>}[]} sources      What each adds, as `skillTotals` lists it
 * @returns {Record<string, number>}
 */
export function bonusesOf(sources) {
  const bonuses = {};
  for ( const source of sources ?? [] ) {
    for ( const [key, amount] of Object.entries(source.stats ?? {}) ) {
      if ( BONUS_STATS.includes(key) && (amount > 0) ) bonuses[key] = (bonuses[key] ?? 0) + amount;
    }
  }
  return bonuses;
}

/* -------------------------------------------- */

/**
 * Work out what the skills of a foe make of a unit's bonuses: cancelled, or turned around.
 * @param {{skill: string, stats: string[]|string, times: number}[]} parts
 *        What the foe's skills say: the stats, one `stat` it picked, or "best" for the one with the most to lose
 * @param {Record<string, number>} bonuses      The unit's bonuses, as `bonusesOf` has them
 * @returns {{stats: Record<string, number>, sources: {name: string, stats: object, combat: object}[]}}
 *          What is added to its stats for the fight, and by which skill
 */
export function settleBonuses(parts, bonuses) {
  const left = { ...(bonuses ?? {}) };
  const stats = {};
  const sources = [];
  for ( const { skill, stats: asked, times = 0 } of parts ?? [] ) {
    let keys = Array.isArray(asked) ? asked : [asked];
    if ( keys.includes("best") ) {
      const best = BONUS_STATS.reduce((found, key) => ((left[key] ?? 0) > (left[found] ?? 0) ? key : found), BONUS_STATS[0]);
      keys = keys.map((key) => (key === "best") ? best : key);
    }
    const changed = {};
    for ( const key of new Set(keys) ) {
      const bonus = left[key] ?? 0;
      if ( !(bonus > 0) ) continue;
      const amount = Math.trunc((times - 1) * bonus);
      if ( !amount ) continue;
      changed[key] = amount;
      stats[key] = (stats[key] ?? 0) + amount;
      left[key] = bonus + amount;
    }
    if ( Object.keys(changed).length ) sources.push({ name: skill, stats: changed, combat: {} });
  }
  return { stats, sources };
}

/* -------------------------------------------- */
/*  One Attack in Place of Several              */
/* -------------------------------------------- */

/**
 * What a unit that makes one attack in place of several makes of it.
 * @param {{hit?: number, critical?: number, damagePercent?: number, stat?: string[]}} single
 * @param {object} unit
 * @param {number} unit.attacks               The attacks it would make
 * @param {number} unit.power                 Its damage before the foe's defence
 * @param {Record<string, number>} unit.stats
 * @param {string} [unit.damageStat]          The stat its weapon adds to its Might
 * @returns {{hit: number, critical: number, damage: number}|null}    What is added to its Hit, its Critical and
 *          its damage; null for a unit that would make one attack anyway
 */
export function loneAttack(single, { attacks, power, stats, damageStat = "str" }) {
  if ( !single || !(attacks > 1) ) return null;

  // Another stat in place of Strength, for a weapon that adds Strength
  const swap = (single.stat?.length && (damageStat === "str"))
    ? Math.max(...single.stat.map((key) => stats?.[key] ?? 0)) - (stats?.str ?? 0)
    : 0;
  const base = Math.max(power + swap, 0);
  const more = Math.floor(((base * (single.damagePercent ?? 0) * (attacks - 1)) / 100) + 1e-9);
  return { hit: single.hit ?? 0, critical: single.critical ?? 0, damage: (base + more) - power };
}

/* -------------------------------------------- */
/*  Who a Choice Is For                         */
/* -------------------------------------------- */

/**
 * Does an effect only do something for the attacks its unit makes? A unit that makes no attack in a fight has
 * no use for it, and a skill that was declared for nothing else is not spent by that fight.
 * @param {object} effect
 * @returns {boolean}
 */
export function forAttacksOnly(effect) {
  if ( effect?.proc ) return ATTACK_MOMENTS.includes(effect.proc.on);
  const parts = Object.keys(effect ?? {}).filter((key) => !["when", "choice", "scale"].includes(key));
  if ( !parts.length ) return true;
  return parts.every((key) => {
    if ( ATTACK_PARTS.includes(key) ) return true;
    if ( key === "combat" ) return Object.keys(effect.combat ?? {}).every((stat) => ["hit", "damage", "critical"].includes(stat));
    if ( key === "trade" ) return Object.keys(effect.trade?.give ?? {}).concat(Object.keys(effect.trade?.gain ?? {})).every((stat) => {
      return ["accuracy", "hit", "critical", "damage"].includes(stat);
    });
    return false;
  });
}

/* -------------------------------------------- */
/*  Cooldowns                                   */
/* -------------------------------------------- */

/**
 * The cooldown of a skill once what its unit's skills add to every cooldown is counted: never less than none.
 * @param {number} cooldown       As the skill has it
 * @param {number} [change]       Turns added to it, which may be less than none
 * @returns {number}
 */
export function cooldownWith(cooldown, change = 0) {
  if ( !(cooldown > 0) ) return 0;
  return Math.max(cooldown + (change ?? 0), 0);
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check a `trade` part, so that a typing mistake does not pass silently.
 * @param {object} trade
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkTrade(trade) {
  if ( !trade || (typeof trade !== "object") ) return ["trade says what is given and what is gained"];
  const problems = [];
  for ( const key of Object.keys(trade) ) if ( !["id", "give", "gain", "pick", "rest"].includes(key) ) problems.push(`trade cannot say "${key}"`);
  const gives = Object.entries(trade.give ?? {});
  const gains = Object.entries(trade.gain ?? {});
  if ( !gives.length || !gains.length ) problems.push("trade needs something to \"give\" and something to \"gain\"");
  const halves = gives.some(([, amount]) => amount === "half");
  for ( const [key, amount] of gives ) {
    if ( !TRADE_GIVES.includes(key) ) problems.push(`trade cannot give "${key}"`);
    else if ( halves ? (amount !== "half") : !whole(amount) ) problems.push(`trade gives "${key}" in whole steps, or "half" of it`);
  }
  for ( const [key, amount] of gains ) {
    if ( !TRADE_GAINS.includes(key) ) problems.push(`trade cannot gain "${key}"`);
    else if ( halves ? !((amount === "double") || whole(amount)) : !whole(amount) ) problems.push(`trade gains "${key}" in whole steps${halves ? ", or \"double\" of it" : ""}`);
  }
  for ( const key of ["pick", "rest"] ) if ( ![undefined, true].includes(trade[key]) ) problems.push(`trade: "${key}" is true or left out`);
  if ( trade.pick && !((typeof trade.id === "string") && trade.id) ) problems.push("a trade whose steps are picked needs an \"id\" to keep them under");
  if ( (trade.pick || trade.rest) && halves ) problems.push("half of a number is traded at once, without \"pick\" or \"rest\"");
  if ( trade.pick && trade.rest ) problems.push("a trade is picked in steps or gives up the \"rest\", not both");
  return problems;
}

/* -------------------------------------------- */

/**
 * Check a `spend` part.
 * @param {object} spend
 * @returns {string[]}
 */
export function checkSpend(spend) {
  if ( !spend || (typeof spend !== "object") ) return ["spend says what is spent and what is gained"];
  const problems = [];
  for ( const key of Object.keys(spend) ) if ( !["id", "gain", ...SPEND_COSTS].includes(key) ) problems.push(`spend cannot say "${key}"`);
  if ( !((typeof spend.id === "string") && spend.id) ) problems.push("spend needs an \"id\" to keep its steps under");
  const costs = SPEND_COSTS.filter((key) => spend[key] !== undefined);
  if ( !costs.length ) problems.push(`spend costs ${SPEND_COSTS.map((key) => `"${key}"`).join(" or ")}`);
  for ( const key of costs ) if ( !whole(spend[key]) ) problems.push(`spend: each step costs a whole number of "${key}"`);
  const gains = Object.entries(spend.gain ?? {});
  if ( !gains.length ) problems.push("spend needs something to \"gain\"");
  for ( const [key, amount] of gains ) {
    if ( !SPEND_GAINS.includes(key) ) problems.push(`spend cannot gain "${key}"`);
    else if ( !whole(amount) ) problems.push(`spend gains "${key}" in whole steps`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * Check a `single` part.
 * @param {object} single
 * @returns {string[]}
 */
export function checkSingle(single) {
  if ( !single || (typeof single !== "object") ) return ["single says what the one attack gains"];
  const problems = [];
  for ( const [key, value] of Object.entries(single) ) {
    if ( key === "stat" ) {
      if ( !Array.isArray(value) || !value.length || value.some((stat) => !(stat in FEO.stats)) ) problems.push("single: \"stat\" lists the stats to use the highest of");
    }
    else if ( !["hit", "critical", "damagePercent"].includes(key) ) problems.push(`single cannot say "${key}"`);
    else if ( !Number.isFinite(value) ) problems.push(`single: "${key}" is a number`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * Check a `foeBonus` part.
 * @param {object} part
 * @returns {string[]}
 */
export function checkFoeBonus(part) {
  if ( !part || (typeof part !== "object") ) return ["foeBonus says which stats and what becomes of their bonuses"];
  const problems = [];
  for ( const key of Object.keys(part) ) if ( !["stats", "times"].includes(key) ) problems.push(`foeBonus cannot say "${key}"`);
  if ( part.stats !== "pick" ) {
    if ( !Array.isArray(part.stats) || !part.stats.length ) problems.push("foeBonus lists \"stats\", or says \"pick\" for one the unit picks");
    else for ( const key of part.stats ) if ( !BONUS_STATS.includes(key) ) problems.push(`foeBonus: unknown stat "${key}"`);
  }
  if ( ![0, -1].includes(part.times) ) problems.push("foeBonus: \"times\" is 0 to cancel the bonuses or -1 to turn them around");
  return problems;
}

/* -------------------------------------------- */
/*  What Is Chosen for a Fight                  */
/* -------------------------------------------- */

/** The parts of an effect that the map reads, and that do nothing in a fight. */
const MAP_PARTS = ["crossing", "passing", "shove", "carry", "canto", "curbsCanto", "refresh", "shift", "warp", "act", "cooldowns", "rearm"];

/** The rules that the map or the turn order reads, and that do nothing in a fight. */
const MAP_RULES = ["onlyWait", "rooted", "unforced", "held", "gripped", "noTurn", "noRefresh", "noSong", "actAfterWarp", "noShield"];

/** The moments that are no moments of a fight. */
const OTHER_MOMENTS = ["turnStart", "turnEnd", "wait", "levelUp", "staff", "action"];

/**
 * Does a skill that is switched on do something in a fight? One that only changes how its unit moves, or what
 * it does at a moment of its turn, is switched on from the list of skills and has no place in a forecast.
 * @param {object[]} [effects]
 * @returns {boolean}
 */
export function choosesForFight(effects = []) {
  return (effects ?? []).some((effect) => {
    if ( !effect?.when?.declared ) return false;
    if ( effect.proc ) return !OTHER_MOMENTS.includes(effect.proc.on);
    return Object.keys(effect).some((key) => {
      if ( ["when", "choice", "scale", ...MAP_PARTS].includes(key) ) return false;
      if ( key === "stats" ) return Object.keys(effect.stats ?? {}).some((stat) => stat !== "mov");
      if ( key === "rules" ) return (effect.rules ?? []).some((rule) => !MAP_RULES.includes(rule));
      return true;
    });
  });
}

/* -------------------------------------------- */

/**
 * Does a skill let its unit change the weapon in hand before a fight an enemy starts?
 * @param {object[]} [effects]
 * @returns {boolean}
 */
export function rearms(effects = []) {
  return (effects ?? []).some((effect) => (effect?.rearm === true) && !effect.proc && !effect.aura);
}

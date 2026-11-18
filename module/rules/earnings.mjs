/**
 * What a unit earns, for Fire Emblem Online: the experience its skills multiply, the row of the staff table it
 * earns by, the growth rates its skills raise, and what its skills do when it levels up. Read from the same
 * structured effects as everything else a skill does (see `skills.mjs`). Pure functions of plain data, so that
 * they can be tested outside of Foundry.
 *
 * The parts of an effect that speak here, none of which changes a number of a fight:
 *
 *   expMultiplier: 1.25               // what the experience the unit earns is multiplied by. With an `aura`
 *                                     // it is for the units around instead, as every aura is
 *   staffExp: "unpromoted"            // the column of the staff table the unit earns by, whatever its class
 *   growths: { hp: 10 }               // added to the growth rates a level up rolls
 *   growths: { pick: 3, amount: 10 }  // the same for as many growth rates as `pick`, which the skill's choice
 *                                     // names ("HP, STR, SPD")
 *
 * and a skill can wait for its unit to level up, as it can for a moment of a fight or of a turn:
 *
 *   {
 *     proc: { on: "levelUp", sure: true },
 *     reroll: true,                   // a growth rate that fails to raise its stat is rolled once more
 *     recover: { of: "hpMax" },       // HP the unit regains
 *     gold: 50,                       // gold the unit gains (also at `on: "kill"`, in a fight)
 *     goldPerGain: 100,               // gold for each stat the level up raised
 *     grant: { to: "self", gained: 1, ends: "turnEnd" }      // a change that lasts a while (see `timed.mjs`):
 *   }                                                        // this much more in every stat the level up raised
 *
 * A level up is every moment a unit gains a level's worth: the growth rates rolled by the Level Up button, the
 * promotion that takes the place of a level up, with the stats its new class gives (`classGains`), and the
 * stats a class gives on reaching a level.
 *
 * @import {GrowthResult} from "./progression.mjs"
 * @import {SkillEntry, SkillSelf} from "./skills.mjs"
 * @import {TimedChange} from "./timed.mjs"
 */
import { FEO } from "../config.mjs";
import { LEVEL_MOMENTS, holds, readNumber } from "./skills.mjs";
import { buildChange } from "./timed.mjs";

/**
 * @typedef ExpSource
 * @property {string} skill     The skill that multiplies, named with the unit it comes from when it is an aura
 * @property {number} times     What it multiplies experience by
 */

/**
 * @typedef ScaledExp
 * @property {number} amount            What the unit earns, rounded down
 * @property {number} base              What it would have earned without any multiplier
 * @property {number} times             What the base was multiplied by, all in all
 * @property {ExpSource[]} sources      The skills that multiplied it
 */

/* -------------------------------------------- */
/*  Reading Skills                              */
/* -------------------------------------------- */

/**
 * The effects of a unit's skills that carry a part and apply outside of any fight: not those that wait for a
 * moment, nor what an aura gives to others, nor those of a skill that is switched off.
 * @param {SkillEntry[]} skills     The unit's skills, with what it receives from the units around it
 * @param {SkillSelf} self
 * @param {string} part
 * @returns {{skill: string, effect: object}[]}
 */
function carrying(skills, self, part) {
  const found = [];
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.[part] === undefined) || (effect[part] === null) || effect.proc ) continue;
      if ( effect.aura && !effect.aura.self ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self ?? {}, null) ) continue;
      found.push({ skill: skill.name, effect });
    }
  }
  return found;
}

/* -------------------------------------------- */

/**
 * A unit in a fight, described for what its skills make it earn.
 * @param {import("./combat.mjs").Combatant} unit
 * @returns {{skills: SkillEntry[], self: SkillSelf}}   Its own skills and what the units around give it
 */
export function earnerOf(unit) {
  return {
    skills: [...(unit?.skills ?? []), ...(unit?.auras ?? [])],
    self: {
      hp: unit?.hp ?? 0,
      hpMax: unit?.hpMax ?? unit?.hp ?? 0,
      level: unit?.level ?? unit?.record?.level ?? 1,
      tier: unit?.tier,
      stats: unit?.bare?.stats ?? unit?.stats ?? {},
      weapon: unit?.weapon ?? null,
      waiting: !!unit?.waiting,
      shifted: !!unit?.shifted,
      near: unit?.near ?? null
    }
  };
}

/* -------------------------------------------- */
/*  Experience                                  */
/* -------------------------------------------- */

/**
 * The skills that multiply the experience a unit earns.
 * @param {SkillEntry[]} skills     The unit's skills, with what it receives from the units around it
 * @param {SkillSelf} self
 * @param {object} [options]
 * @param {boolean} [options.bonus] Is it Bonus EXP that is given? A skill that says so does not multiply it
 * @returns {ExpSource[]}
 */
export function expSources(skills, self, { bonus = false } = {}) {
  return carrying(skills, self, "expMultiplier")
    .filter(({ effect }) => !bonus || (effect.bexp !== false))
    .map(({ skill, effect }) => ({ skill, times: Number(effect.expMultiplier) }))
    .filter((source) => Number.isFinite(source.times) && (source.times >= 0) && (source.times !== 1));
}

/* -------------------------------------------- */

/**
 * Multiply experience a unit is about to earn by what its skills say. Several multipliers are multiplied one
 * after the other, or have their extras added up, as the configuration says; the result is rounded down once.
 * @param {number} amount               Experience as the tables give it
 * @param {ExpSource[]} [sources]
 * @param {object} [options]
 * @param {"multiply"|"add"} [options.stack]    FEO.earnings.expStack
 * @returns {ScaledExp}
 */
export function scaleExp(amount, sources = [], { stack = FEO.earnings.expStack } = {}) {
  const base = Math.max(Math.floor(amount ?? 0), 0);
  const list = (sources ?? []).filter((source) => Number.isFinite(source?.times) && (source.times >= 0) && (source.times !== 1));
  const times = (stack === "add")
    ? Math.max(1 + list.reduce((sum, source) => sum + (source.times - 1), 0), 0)
    : list.reduce((product, source) => product * source.times, 1);
  const tidy = Number(times.toFixed(4));
  return { amount: Math.floor((base * tidy) + 1e-9), base, times: tidy, sources: list };
}

/* -------------------------------------------- */

/**
 * The column of the staff table a unit earns by, when a skill names one.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @returns {{row: "unpromoted"|"promoted", skill: string}|null}
 */
export function staffRow(skills, self) {
  const found = carrying(skills, self, "staffExp").find(({ effect }) => ["unpromoted", "promoted"].includes(effect.staffExp));
  return found ? { row: found.effect.staffExp, skill: found.skill } : null;
}

/* -------------------------------------------- */
/*  Gold                                        */
/* -------------------------------------------- */

/**
 * The most gold a unit's skills can earn it for defeating one foe, whatever their conditions and chances.
 * Gold that goes by the levels between the two units is counted for a foe as far from the unit as two units
 * can be taken to be.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @returns {number}
 */
export function killGold(skills, self) {
  const far = { foe: { level: (self?.level ?? 1) + FEO.earnings.levelsApart } };
  let most = 0;
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.proc?.on === "kill") && effect.gold ) most += Math.max(readNumber(effect.gold, self ?? {}, far), 0);
    }
  }
  return most;
}

/* -------------------------------------------- */
/*  Growth Rates                                */
/* -------------------------------------------- */

/**
 * The growth rates a skill's choice names, in the order given: "HP, STR, SPD".
 * @param {string} [choice]
 * @param {string[]} [keys]     The growth rates in use: the keys of FEO.growths
 * @returns {string[]}          Each once
 */
export function growthPicks(choice, keys = Object.keys(FEO.growths)) {
  const picked = String(choice ?? "").split(/[,;/+]/).map((part) => part.trim().toLowerCase()).filter((key) => keys.includes(key));
  return [...new Set(picked)];
}

/* -------------------------------------------- */

/**
 * Write the growth rates picked for a skill as its choice: each once, in the order given.
 * @param {string[]} picks      Keys of FEO.growths; blanks are left out
 * @returns {string}            "HP, STR, SPD"
 */
export function growthChoice(picks) {
  return [...new Set((picks ?? []).map((key) => String(key ?? "").trim().toLowerCase()).filter(Boolean))]
    .map((key) => key.toUpperCase()).join(", ");
}

/* -------------------------------------------- */

/**
 * How many growth rates a skill lets its unit pick, when it does.
 * @param {object[]} [effects]
 * @returns {number}
 */
export function growthPickCount(effects) {
  return (effects ?? []).reduce((most, effect) => Math.max(most, Number(effect?.growths?.pick) || 0), 0);
}

/* -------------------------------------------- */

/**
 * What a unit's skills add to its growth rates. Always there while the skill is equipped: nothing is asked.
 * @param {SkillEntry[]} skills     The unit's own skills
 * @param {object} [options]
 * @param {string[]} [options.keys] The growth rates in use: the keys of FEO.growths
 * @returns {{bonus: Record<string, number>, missing: {skill: string, pick: number, picked: number}[]}}
 *          Percent added by growth rate, and the skills whose picks are still to be made
 */
export function skillGrowths(skills, { keys = Object.keys(FEO.growths) } = {}) {
  const bonus = {};
  const missing = [];
  const add = (key, amount) => {
    if ( keys.includes(key) && Number.isFinite(amount) && amount ) bonus[key] = (bonus[key] ?? 0) + amount;
  };
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      const growths = effect?.growths;
      if ( !growths || (typeof growths !== "object") || effect.proc || effect.aura ) continue;
      if ( growths.pick ) {
        const picked = growthPicks(skill.choice, keys).slice(0, growths.pick);
        for ( const key of picked ) add(key, Number(growths.amount));
        if ( picked.length < growths.pick ) missing.push({ skill: skill.name, pick: growths.pick, picked: picked.length });
      }
      else for ( const [key, amount] of Object.entries(growths) ) add(key, Number(amount));
    }
  }
  return { bonus, missing };
}

/* -------------------------------------------- */
/*  Levelling Up                                */
/* -------------------------------------------- */

/**
 * The effects of a unit's skills that wait for it to level up, and whose condition holds.
 * @param {SkillEntry[]} skills     The unit's own skills
 * @param {SkillSelf} self
 * @returns {{skill: string, effect: object}[]}
 */
export function levelUpEffects(skills, self) {
  const found = [];
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( !LEVEL_MOMENTS.includes(effect?.proc?.on) || !effect.proc.sure || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self ?? {}, null) ) continue;
      found.push({ skill: skill.name, effect });
    }
  }
  return found;
}

/* -------------------------------------------- */

/**
 * The skill that lets a unit roll a failed growth rate once more, if it has one.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @returns {string|null}
 */
export function rerollSkill(skills, self) {
  return levelUpEffects(skills, self).find(({ effect }) => effect.reroll)?.skill ?? null;
}

/* -------------------------------------------- */

/**
 * The growth rolls of a level up that failed: rolled, and nothing gained.
 * @param {GrowthResult[]} results
 * @returns {GrowthResult[]}
 */
export function failedGrowths(results) {
  return (results ?? []).filter((result) => !result.capped && (result.roll !== null) && !result.gain);
}

/* -------------------------------------------- */

/**
 * Roll every growth rate that failed once more. A stat that was not rolled, or that rose, is left as it is.
 * @param {GrowthResult[]} results
 * @param {() => number} d100       Returns a whole number from 1 to 100
 * @param {string} skill            The skill that allows it
 * @returns {(GrowthResult & {reroll?: {skill: string, first: number}})[]}
 *          The same results; one that was rolled again has the new roll, and keeps the first under `reroll`
 */
export function rerollGrowths(results, d100, skill) {
  return (results ?? []).map((result) => {
    if ( result.capped || (result.roll === null) || result.gain ) return result;
    const roll = d100();
    const growth = result.growth ?? 0;
    const gain = (growth >= 100) ? 1 + ((roll <= (growth - 100)) ? 1 : 0) : ((roll <= growth) ? 1 : 0);
    return { ...result, roll, gain, reroll: { skill, first: result.roll } };
  });
}

/* -------------------------------------------- */

/**
 * What a class gave a unit, as a level up counts it: one gain for each stat it raised, maximum HP among them.
 * @param {import("./classes.mjs").ClassChange|null} change     A promotion, or what a class gives at a level
 * @returns {{key: string, gain: number, roll: null, capped: false}[]}    In the shape of growth rolls
 */
export function classGains(change) {
  const gains = [];
  const note = (key, from, to) => {
    const gain = (Number(to) || 0) - (Number(from) || 0);
    if ( gain > 0 ) gains.push({ key, gain, roll: null, capped: false });
  };
  if ( change?.hpMax ) note("hp", change.hpMax.from, change.hpMax.to);
  for ( const stat of change?.stats ?? [] ) note(stat.key, stat.from, stat.to);
  return gains;
}

/* -------------------------------------------- */

/**
 * @typedef LevelUpOutcome
 * @property {Record<string, number>} gains       Points gained, by stat
 * @property {number} increases                   Stat increases, as gold per increase counts them
 * @property {{skill: string, amount: number}[]} gold     Gold each skill gives
 * @property {number} goldTotal
 * @property {{skill: string, hp: number, healed: number}|null} heal
 *           HP after the skills restored it, and how much that was
 * @property {{skill: string, change: TimedChange|null, amount: number, stats: string[], left: string[]}[]} granted
 *           Changes that last a while: the stats each raises and by how much, and those it would but cannot
 *           (`left`); without a change when it can raise none of them
 */

/**
 * What a unit's skills do once its growth rates have been rolled.
 * @param {SkillEntry[]} skills                 The unit's own skills
 * @param {SkillSelf} self                      The unit as the level up leaves it: HP and maximum HP with
 *                                              what the level up itself added
 * @param {GrowthResult[]} results              The growth rolls, after any that were rolled again
 * @param {object} [options]
 * @param {"stat"|"point"} [options.goldPerGain]    FEO.earnings.goldPerGain
 * @param {boolean} [options.inTurn]            Is the unit in its own turn right now?
 * @returns {LevelUpOutcome}
 */
export function levelUpOutcome(skills, self, results, { goldPerGain = FEO.earnings.goldPerGain, inTurn = false } = {}) {
  const gains = {};
  for ( const result of results ?? [] ) if ( result.gain > 0 ) gains[result.key] = (gains[result.key] ?? 0) + result.gain;
  const raised = Object.keys(gains);
  const increases = (goldPerGain === "point") ? Object.values(gains).reduce((sum, gain) => sum + gain, 0) : raised.length;

  const outcome = { gains, increases, gold: [], goldTotal: 0, heal: null, granted: [] };
  let hp = self?.hp ?? 0;
  const hpMax = self?.hpMax ?? hp;
  const number = (value) => Math.max(readNumber(value ?? 0, { ...self, hp }, null), 0);

  for ( const { skill, effect } of levelUpEffects(skills, self) ) {
    const gold = number(effect.gold) + (number(effect.goldPerGain) * increases);
    if ( gold > 0 ) {
      outcome.gold.push({ skill, amount: gold });
      outcome.goldTotal += gold;
    }

    if ( effect.recover !== undefined ) {
      const healed = Math.max(Math.min(number(effect.recover), hpMax - hp), 0);
      hp += healed;
      outcome.heal = { skill: outcome.heal?.skill ?? skill, hp, healed: (outcome.heal?.healed ?? 0) + healed };
    }

    // A boost in every stat the level up raised, for a while: maximum HP, Charm and Intelligence among them.
    // What the system keeps no number for is left to the table
    for ( const grant of [].concat(effect.grant ?? []) ) {
      const amount = Number(grant?.gained);
      if ( !Number.isFinite(amount) || !amount || !raised.length ) continue;
      const stats = raised.filter((key) => (key in FEO.stats) || (key in FEO.abilities) || (key === "hp"));
      const left = raised.filter((key) => !stats.includes(key));
      if ( !stats.length ) {
        outcome.granted.push({ skill, change: null, amount, stats, left });
        continue;
      }
      const boost = {};
      const plain = stats.filter((key) => key in FEO.stats);
      const abilities = stats.filter((key) => key in FEO.abilities);
      if ( plain.length ) boost.stats = Object.fromEntries(plain.map((key) => [key, amount]));
      if ( abilities.length ) boost.abilities = Object.fromEntries(abilities.map((key) => [key, amount]));
      if ( stats.includes("hp") ) boost.hpMax = amount;
      const { gained, ...rest } = grant;
      outcome.granted.push({
        skill,
        change: buildChange({ ...rest, effects: [boost] }, { skill, own: true, carrierInTurn: inTurn }),
        amount,
        stats,
        left
      });
    }
  }
  return outcome;
}

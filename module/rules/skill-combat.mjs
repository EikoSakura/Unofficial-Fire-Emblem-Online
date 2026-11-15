/**
 * Skills in an exchange: what each unit's skills make of its numbers once it is known who fights whom, at what
 * distance and who can answer. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @import {Combatant} from "./combat.mjs"
 * @import {SkillTotals} from "./skills.mjs"
 */
import { computeCombatStats } from "./combat-stats.mjs";
import { PROC_TRIGGERS, emptyTotals, hasNihil, resolveProc, skillTotals } from "./skills.mjs";
import { timedEntries } from "./timed.mjs";

const SIDES = ["initiator", "defender"];
const other = (side) => side === "initiator" ? "defender" : "initiator";

/**
 * Does a unit carry what the skill rules need: its skills, and its numbers without them?
 * @param {Combatant} unit
 * @returns {boolean}
 */
function skilled(unit) {
  return Array.isArray(unit.skills) && !!unit.bare;
}

/* -------------------------------------------- */

/**
 * Describe a unit for the conditions of skills.
 * @param {Combatant} unit
 * @returns {import("./skills.mjs").SkillSelf & {qualities: string, afflicted: boolean}}
 */
function viewOf(unit, reach = null) {
  const bare = unit.bare ?? {};
  return {
    hp: unit.hp,
    hpMax: unit.hpMax ?? unit.hp,
    level: unit.level ?? unit.record?.level ?? 1,
    gold: unit.gold ?? 0,
    stats: bare.stats ?? unit.stats,
    base: bare.base ?? {},
    weapon: unit.weapon ? { ...unit.weapon, ...(bare.weapon ?? {}), reach } : null,
    accuracy: bare.accuracy ?? unit.combat?.accuracy ?? 0,
    attack: unit.combat?.damage ?? 0,
    waiting: !!unit.waiting,
    shifted: !!unit.shifted,
    near: unit.near ?? null,
    conditions: unit.conditions ?? {},
    qualities: unit.qualities ?? "",
    afflicted: Object.keys(unit.conditions ?? {}).length > 0
  };
}

/* -------------------------------------------- */

/**
 * A unit as it fights once its skills are counted: its stats and combat stats worked out again from its
 * numbers without skills, with what the skills add.
 * @param {Combatant} unit
 * @param {SkillTotals} totals
 * @param {import("./skills.mjs").SkillFight} fight     The fight as the unit sees it
 * @param {SkillTotals|null} [foeTotals]                What the foe's skills add up to, for what they do to
 *                                                      this unit
 * @returns {Combatant & {fx: SkillTotals}}
 */
function withTotals(unit, totals, fight, foeTotals = null) {
  if ( !skilled(unit) ) return { ...unit, fx: totals };
  const bare = unit.bare;
  const stats = { ...bare.stats };
  for ( const [key, amount] of Object.entries(totals.stats) ) stats[key] = Math.max((stats[key] ?? 0) + amount, 0);
  const modifiers = [
    ...(bare.modifiers ?? []),
    ...totals.sources.map((source) => ({ label: source.name, ...source.combat }))
  ];
  const weapon = unit.weapon ? {
    might: unit.weapon.might ?? 0,
    hit: bare.weapon?.hit ?? unit.weapon.hit ?? 0,
    crit: bare.weapon?.crit ?? unit.weapon.crit ?? 0,
    weight: bare.weapon?.weight ?? unit.weapon.weight ?? 0,
    damageStat: totals.damageStat ?? unit.weapon.damageStat ?? "str"
  } : null;
  const combat = computeCombatStats({ stats, boosts: bare.boosts, calc: { ...(bare.calc ?? {}), ...totals.calc }, modifiers }, weapon);

  // Chances to activate, with their numbers worked out from what the unit fights with
  const view = { ...viewOf(unit), stats, combat };
  const options = {
    activation: (totals.combat.activation ?? 0) + (unit.activation ?? 0) + (foeTotals?.foeActivation ?? 0),
    always: totals.rules.has("alwaysActivate"),
    inflictChance: totals.bends?.inflictChance ?? null
  };
  const procs = Object.fromEntries(PROC_TRIGGERS.map((on) => [on, []]));
  for ( const raw of totals.procs ) {
    const proc = resolveProc(raw, view, fight, options);
    procs[proc.on]?.push(proc);
  }
  // A skill may have the weapon add another stat to its Might, which also sets what resists it
  const wielded = (unit.weapon && totals.damageStat) ? { weapon: { ...unit.weapon, damageStat: totals.damageStat } } : {};
  return { ...unit, ...wielded, stats, combat, fx: { ...totals, chances: procs } };
}

/* -------------------------------------------- */

/**
 * Begin working out what skills do in an exchange. Effects that do not depend on who can counter-attack are
 * read at once; `settle` reads the rest once that is known.
 * @param {Combatant} initiator
 * @param {Combatant} defender
 * @param {number} distance
 * @param {{initiator?: object|null, defender?: object|null}} [reach]
 *        How far each unit's weapon reaches by itself, nearest and farthest, for skills that ask
 * @returns {{units: {initiator: Combatant, defender: Combatant},
 *   settle: (answers: {initiator: boolean, defender: boolean}) => {initiator: Combatant, defender: Combatant}}|null}
 *          Null when neither unit carries skills, so that nothing changes for them
 */
export function prepareSkills(initiator, defender, distance, reach = {}) {
  const given = { initiator, defender };
  if ( !SIDES.some((side) => skilled(given[side])) ) return null;

  const views = { initiator: viewOf(initiator, reach.initiator ?? null), defender: viewOf(defender, reach.defender ?? null) };
  const nihil = Object.fromEntries(SIDES.map((side) => {
    return [side, skilled(given[side]) && hasNihil(given[side].skills, views[side])];
  }));
  const fight = (side, answers = null) => ({
    role: side === "initiator" ? "initiating" : "defending",
    distance,
    foe: views[other(side)],
    foeCounters: answers ? answers[other(side)] : null,
    counters: answers ? answers[side] : null
  });

  // Each unit's own skills, and what it receives from the skills of the units around it. Such an aura is not
  // a skill of the unit fought, so Nihil leaves it alone, unless it is the foe itself that gives it
  const lists = Object.fromEntries(SIDES.map((side) => {
    if ( !skilled(given[side]) ) return [side, []];
    const foeId = given[other(side)].near?.id;
    const auras = (given[side].auras ?? []).filter((aura) => !(aura.sourceNihil && nihil[side] && foeId && (aura.from === foeId)));
    return [side, [...given[side].skills, ...timedEntries(given[side].timed), ...auras]];
  }));
  const read = (side, phase, answers, into) => {
    if ( !skilled(given[side]) ) return into ?? emptyTotals();
    return skillTotals(lists[side], views[side], { fight: fight(side, answers), foeNihil: nihil[other(side)], phase, into });
  };

  const early = { initiator: read("initiator", "early"), defender: read("defender", "early") };
  const units = {
    initiator: withTotals(initiator, early.initiator, fight("initiator"), early.defender),
    defender: withTotals(defender, early.defender, fight("defender"), early.initiator)
  };
  const settle = (answers) => {
    const late = { initiator: read("initiator", "late", answers, early.initiator), defender: read("defender", "late", answers, early.defender) };
    return {
      initiator: withTotals(initiator, late.initiator, fight("initiator", answers), late.defender),
      defender: withTotals(defender, late.defender, fight("defender", answers), late.initiator)
    };
  };
  return { units, settle };
}

/* -------------------------------------------- */

/**
 * How many times each attack with a weapon strikes, as its Effect says: "2x Strikes", "2x Strikes when
 * initiating combat" for a unit that initiates, or "2x Strikes when attacking at 1 range" at that distance.
 * Strikes a weapon only offers as a choice are left to the table.
 * @param {string} [effect]             The weapon's Effect
 * @param {object} [fight]
 * @param {boolean} [fight.initiating]
 * @param {number} [fight.distance]
 * @returns {number}
 */
export function weaponStrikes(effect, { initiating = false, distance = 1 } = {}) {
  const text = String(effect ?? "");
  const pattern = /(\d+)\s*x\s+strikes(?:\s+when\s+(initiating(?:\s+combat)?|attacking\s+at\s+(\d+)\s+range))?/gi;
  let strikes = 1;
  for ( const match of text.matchAll(pattern) ) {
    if ( /choose/i.test(text.slice(Math.max(match.index - 60, 0), match.index)) ) continue;
    if ( match[3] && (Number(match[3]) !== distance) ) continue;
    if ( match[2] && !match[3] && !initiating ) continue;
    strikes = Math.max(strikes, Number(match[1]));
  }
  return strikes;
}

/**
 * Auras for Fire Emblem Online: skills of one unit that change the numbers of the units around it. Each unit
 * on a map receives what the skills of the others give it as skill entries of its own, named after the skill
 * and the unit it comes from, so that everything that reads a unit's skills reads its auras the same way.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @import {PlacedUnit, Surroundings} from "./positions.mjs"
 * @import {SkillEntry, SkillSelf} from "./skills.mjs"
 */
import { FEO } from "../config.mjs";
import { conditionsAround } from "./conditions.mjs";
import { surroundings } from "./positions.mjs";
import { carriedBy, chanceOf, holds, multiplyStats, readNumber, skillTotals } from "./skills.mjs";
import { usedName } from "./timed.mjs";

/**
 * @typedef {SkillEntry & {skill: string, from: string, giver: string, aura: true, sourceNihil: boolean,
 *   inverted: boolean, limit?: "turn"}} AuraEntry
 * What a unit receives from the skill of a unit near it. `sourceNihil` marks one that Nihil cancels when its
 * giver is the unit fought, and `limit` one that is given once a turn: its giver carries a mark once it has
 * been (see `usedName` in `timed.mjs`), and gives it no more until the mark is gone.
 */

/** The parts of an effect that are plain amounts, which a unit that gives its auras turned around inverts. */
const AMOUNTS = ["stats", "combat", "might", "taken", "endurance", "dealtPercent", "foeActivation", "hpMax"];

/**
 * Describe a unit on the map for the conditions and numbers of skills.
 * @param {PlacedUnit} unit
 * @param {Surroundings|null} [near]
 * @returns {SkillSelf}
 */
export function selfOf(unit, near = null) {
  return {
    hp: unit.hp ?? 0,
    hpMax: unit.hpMax ?? unit.hp ?? 0,
    level: unit.level ?? 1,
    tier: unit.tier,
    gender: unit.gender ?? "",
    bestRank: unit.bestRank ?? "",
    stats: unit.stats ?? {},
    base: unit.base ?? {},
    accuracy: unit.accuracy ?? 0,
    waiting: !!unit.waiting,
    weapon: unit.weapon ?? null,
    qualities: unit.qualities ?? "",
    shifted: !!unit.shifted,

    // The skills it has equipped, for an aura that asks whether its giver has another skill
    skills: (unit.skills ?? []).filter((skill) => !skill.aura && !skill.timed).map((skill) => skill.name),

    // And the lasting changes of its own that it carries, for one that asks for such a change
    carried: carriedBy(unit.skills),
    near
  };
}

/* -------------------------------------------- */

/**
 * Turn an amount around: a number, or one that is read from a unit.
 * @param {number|object} value
 * @returns {number|object}
 */
function invert(value) {
  if ( typeof value === "number" ) return -value;
  if ( value && (typeof value === "object") && (("of" in value) || ("count" in value)) ) return { ...value, times: -(value.times ?? 1) };
  if ( value && (typeof value === "object") ) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, invert(entry)]));
  return value;
}

/* -------------------------------------------- */

/**
 * What one effect with an aura gives to a unit that receives it: the effect without its aura, with the
 * numbers that are read from the giver worked out, and with the condition each receiver must meet.
 * @param {object} effect
 * @param {() => SkillSelf} giver     The unit that gives it, with its stats as its own skills make them
 * @param {boolean} inverted          Does the giver give its auras turned around?
 * @returns {object|null}             Null when nothing can be given
 */
function give(effect, giver, inverted) {
  const { aura, when, ...parts } = effect;

  // A chance the giver rolls is worked out for the giver, and is then a plain chance for the receiver
  if ( parts.proc?.giver ) {
    const { giver: marked, stat, div, times, percent, ...moment } = parts.proc;
    const view = giver();
    const chance = chanceOf({ stat, div, times, percent }, view, null, { activation: view.activation ?? 0, always: !!view.always });
    parts.proc = { ...moment, percent: chance, fixed: true };
  }
  const resolve = (value) => {
    if ( Array.isArray(value) ) return value.map(resolve);
    if ( !value || (typeof value !== "object") ) return value;
    if ( value.giver ) {
      const { giver: marked, ...number } = value;
      return readNumber(number, giver(), null);
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolve(entry)]));
  };
  const given = resolve(parts);
  if ( inverted ) {
    // What an inverted aura does at a moment, such as healing, is left to the table
    if ( given.proc ) return null;
    for ( const key of AMOUNTS ) if ( key in given ) given[key] = invert(given[key]);
  }
  if ( aura.when ) given.when = aura.when;
  return given;
}

/* -------------------------------------------- */

/**
 * Where a unit stands and what that gives it: the units around it, and the auras it receives from their
 * skills. A unit that is down gives none. A number an aura reads from its giver goes by the giver's stats as
 * its own skills make them, without the auras it receives itself.
 * @param {PlacedUnit[]} units                                      The units with a token on the map
 * @param {string} id                                               The unit asked about
 * @param {(a: PlacedUnit, b: PlacedUnit) => number|null} measure   Tiles between two units
 * @param {((a: PlacedUnit, b: PlacedUnit) => boolean)|null} [sight]    Does one unit have another in its Line of
 *                                                                  Sight? (see `surroundings`)
 * @returns {{near: Surroundings, auras: AuraEntry[]}|null}         Null for a unit that is not on the map
 */
export function standing(units, id, measure, sight = null) {
  const near = surroundings(units, id, measure, sight);
  if ( !near ) return null;

  // A giver's stats with its own skills, which may themselves ask what the giver has around it
  const views = new Map();
  const viewOf = (unit) => {
    if ( !views.has(unit.id) ) {
      const self = selfOf(unit, surroundings(units, unit.id, measure));
      const totals = skillTotals(unit.skills ?? [], self);
      const stats = { ...self.stats };
      for ( const [key, amount] of Object.entries(totals.stats) ) stats[key] = Math.max((stats[key] ?? 0) + amount, 0);
      Object.assign(stats, multiplyStats(stats, totals.statTimes, totals.bends?.debuffs).stats);

      // Its Skill Activation rate, for the chances of its auras that it rolls itself
      const activation = (totals.combat.activation ?? 0) + (unit.activation ?? 0);
      views.set(unit.id, { ...self, stats, activation, always: totals.rules.has("alwaysActivate") });
    }
    return views.get(unit.id);
  };

  // The unit itself, for what an aura asks of the unit that receives it
  const self = (units ?? []).find((unit) => unit.id === id) ?? null;
  const auras = [];
  for ( const other of near.others ) {
    if ( !((other.hp ?? 1) > 0) ) continue;

    // A unit that no enemy can target receives nothing from an enemy's aura
    if ( self?.untargetable && (other.relation === "enemy") ) continue;
    const inverted = !!FEO.auras.inverted && !!other.conditions?.includes(FEO.auras.inverted);

    // What a unit gives: the auras of its own skills, and for a summoned unit those its summoner's skills give
    // through what it summons (`through: "summon"`), while that summoner stands on the map
    const summoner = other.summoner ? ((units ?? []).find((unit) => (unit.actor === other.summoner) && !unit.out && ((unit.hp ?? 1) > 0)) ?? null) : null;
    const giving = [
      ...(other.skills ?? []).map((skill) => ({ skill, owner: other, through: false })),
      ...(summoner?.skills ?? []).map((skill) => ({ skill, owner: summoner, through: true }))
    ];
    for ( const { skill, owner, through } of giving ) {
      const effects = [];
      let limit = null;
      let alone = false;
      for ( const effect of skill.effects ?? [] ) {
        // An aura is for allies or for enemies of its giver, or with "any" for every unit, whatever its side
        const aura = effect.aura;
        if ( !aura || ((aura.who !== "any") && (!other.relation || (aura.who !== other.relation))) ) continue;

        // One that its unit gives through the units it has summoned comes from each of them, not from itself;
        // and one that is not for summoned units passes them over
        if ( (aura.through === "summon") !== through ) continue;
        if ( aura.unsummoned && self?.summoner ) continue;
        if ( (aura.within != null) && (other.distance > aura.within) ) continue;
        if ( (aura.from != null) && (other.distance < aura.from) ) continue;

        // One that is only for certain units, as what a unit that has hold of another gives the unit it holds
        if ( Array.isArray(aura.only) && !aura.only.includes(id) ) continue;

        // One that is given once a turn, and has been
        if ( (aura.once === "turn") && (other.marks ?? []).includes(usedName(skill.name)) ) continue;
        if ( effect.when?.declared && !skill.active ) continue;
        if ( !holds(effect.when, selfOf(owner), null) ) continue;
        const given = give(effect, () => viewOf(owner), inverted);
        if ( given ) effects.push(given);
        if ( given && aura.once ) limit = aura.once;
        if ( given && (aura.stack === false) ) alone = true;
      }
      if ( !effects.length ) continue;

      // Where the same skill of two units does not add up, the nearest one gives it: everywhere where the world
      // has it so, and for a skill that says it does not stack with itself
      if ( (!FEO.auras.stack || alone) && auras.some((entry) => entry.skill === skill.name) ) continue;
      auras.push({
        name: `${skill.name} (${other.name})`,
        skill: skill.name,
        from: other.id,
        giver: other.name,
        aura: true,
        nihil: false,
        sourceNihil: !!skill.nihil,
        inverted,
        ...(limit ? { limit } : {}),
        effects
      });
    }
  }

  // What a condition an ally nearby suffers from takes off the unit's stats, while it stands that near
  for ( const found of conditionsAround(near) ) {
    if ( !found.stats ) continue;
    auras.push({
      name: `${found.name} (${found.from})`, skill: found.name, from: found.unit, giver: found.from, aura: true,
      nihil: false, sourceNihil: false, inverted: false, effects: [{ stats: found.stats }]
    });
  }
  return { near, auras };
}

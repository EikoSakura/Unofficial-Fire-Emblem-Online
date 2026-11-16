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
import { surroundings } from "./positions.mjs";
import { chanceOf, holds, readNumber, skillTotals } from "./skills.mjs";

/**
 * @typedef {SkillEntry & {skill: string, from: string, giver: string, aura: true, sourceNihil: boolean,
 *   inverted: boolean}} AuraEntry
 * What a unit receives from the skill of a unit near it. `sourceNihil` marks one that Nihil cancels when its
 * giver is the unit fought.
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
    stats: unit.stats ?? {},
    base: unit.base ?? {},
    accuracy: unit.accuracy ?? 0,
    waiting: !!unit.waiting,
    weapon: unit.weapon ?? null,
    qualities: unit.qualities ?? "",
    shifted: !!unit.shifted,
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
 * @returns {{near: Surroundings, auras: AuraEntry[]}|null}         Null for a unit that is not on the map
 */
export function standing(units, id, measure) {
  const near = surroundings(units, id, measure);
  if ( !near ) return null;

  // A giver's stats with its own skills, which may themselves ask what the giver has around it
  const views = new Map();
  const viewOf = (unit) => {
    if ( !views.has(unit.id) ) {
      const self = selfOf(unit, surroundings(units, unit.id, measure));
      const totals = skillTotals(unit.skills ?? [], self);
      const stats = { ...self.stats };
      for ( const [key, amount] of Object.entries(totals.stats) ) stats[key] = Math.max((stats[key] ?? 0) + amount, 0);

      // Its Skill Activation rate, for the chances of its auras that it rolls itself
      const activation = (totals.combat.activation ?? 0) + (unit.activation ?? 0);
      views.set(unit.id, { ...self, stats, activation, always: totals.rules.has("alwaysActivate") });
    }
    return views.get(unit.id);
  };

  const auras = [];
  for ( const other of near.others ) {
    if ( !other.relation || !((other.hp ?? 1) > 0) ) continue;
    const inverted = !!FEO.auras.inverted && !!other.conditions?.includes(FEO.auras.inverted);
    for ( const skill of other.skills ?? [] ) {
      const effects = [];
      for ( const effect of skill.effects ?? [] ) {
        const aura = effect.aura;
        if ( !aura || (aura.who !== other.relation) ) continue;
        if ( (aura.within != null) && (other.distance > aura.within) ) continue;
        if ( (aura.from != null) && (other.distance < aura.from) ) continue;
        if ( effect.when?.declared && !skill.active ) continue;
        if ( !holds(effect.when, selfOf(other), null) ) continue;
        const given = give(effect, () => viewOf(other), inverted);
        if ( given ) effects.push(given);
      }
      if ( !effects.length ) continue;

      // Where the same skill of two units does not add up, the nearest one gives it
      if ( !FEO.auras.stack && auras.some((entry) => entry.skill === skill.name) ) continue;
      auras.push({
        name: `${skill.name} (${other.name})`,
        skill: skill.name,
        from: other.id,
        giver: other.name,
        aura: true,
        nihil: false,
        sourceNihil: !!skill.nihil,
        inverted,
        effects
      });
    }
  }
  return { near, auras };
}

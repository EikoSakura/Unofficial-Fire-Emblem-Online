/**
 * Defeat for Fire Emblem Online: Wounds, Incapacitation, overkill damage, Injuries and the choice at the end,
 * as the Death tab of the rules and the Health and Wounds tab of the character sheet describe them.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @import {ExchangePlan, ExchangeResult} from "./combat.mjs"
 */
import { FEO } from "../config.mjs";

/**
 * @typedef DefeatState
 * @property {""|"incapacitated"|"retreated"|"dead"} state
 * @property {number} turns       Turns of Incapacitation left
 * @property {boolean} paused     Is the timer paused, after healing that did not bring the unit back up?
 */

/**
 * @typedef DefeatProfile
 * What the defeat rules need to know about a unit.
 * @property {number} hpMax           Maximum HP before Wounds and Injuries
 * @property {number} resilience      The higher of Endurance and Willpower, divided by ten
 * @property {number} graveWounds
 * @property {number} injuries
 * @property {DefeatState} defeat
 */

const SIDES = ["initiator", "defender"];
const other = (side) => side === "initiator" ? "defender" : "initiator";

/* -------------------------------------------- */
/*  Thresholds                                  */
/* -------------------------------------------- */

/**
 * The damage a single hit must deal to cause a Wound.
 * @param {number} hpMax    Maximum HP before Wounds and Injuries
 * @returns {number}
 */
export function woundThreshold(hpMax) {
  return Math.floor(Math.max(hpMax ?? 0, 0) / FEO.defeat.woundDivisor);
}

/* -------------------------------------------- */

/**
 * How far below zero a unit's HP may fall before it must choose between retreat and death.
 * @param {number} hpMax    Maximum HP before Wounds and Injuries
 * @returns {number}
 */
export function deathThreshold(hpMax) {
  return Math.max(hpMax ?? 0, 0) * FEO.defeat.deathMultiplier;
}

/* -------------------------------------------- */

/**
 * A unit's staying power: the higher of its Endurance and Willpower, divided by ten.
 * It is both the turns a unit stays Incapacitated and what is taken off damage past 0 HP.
 * @param {...number} checks    The unit's totals in the abilities that count
 * @returns {number}
 */
export function resilience(...checks) {
  const best = Math.max(0, ...checks.map((value) => value ?? 0));
  return Math.floor(best / FEO.defeat.resilience.divisor);
}

/* -------------------------------------------- */

/**
 * The turns a unit stays Incapacitated.
 * @param {number} staying        The unit's resilience
 * @param {number} graveWounds
 * @returns {number}
 */
export function incapacitationTurns(staying, graveWounds = 0) {
  return Math.max((staying ?? 0) - ((graveWounds ?? 0) * FEO.defeat.perGraveWound), 0);
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * Apply one hit to a unit's HP. Damage past 0 HP is kept, less the unit's resilience.
 * @param {number} hp             HP before the hit
 * @param {number} damage         Damage dealt
 * @param {number} [staying]      The unit's resilience
 * @returns {{hp: number, past: number, kept: number}}   HP afterwards, the damage past 0 and how much of it stays
 */
export function takeHit(hp, damage, staying = 0) {
  const dealt = Math.max(damage ?? 0, 0);
  if ( (hp > 0) && (dealt < hp) ) return { hp: hp - dealt, past: 0, kept: 0 };
  const past = dealt - Math.max(hp, 0);
  const kept = Math.max(past - Math.max(staying ?? 0, 0), 0);
  return { hp: Math.min(hp, 0) - kept, past, kept };
}

/* -------------------------------------------- */

/**
 * How many Wounds a series of hits causes: one for each that deals the wound threshold or more.
 * @param {number[]} hits     Damage of each hit
 * @param {number} hpMax      Maximum HP before Wounds and Injuries
 * @returns {number}
 */
export function woundsFrom(hits, hpMax) {
  const threshold = woundThreshold(hpMax);
  if ( threshold <= 0 ) return 0;
  return hits.filter((damage) => damage >= threshold).length;
}

/* -------------------------------------------- */

/**
 * What an exchange means for each unit's health beyond its HP: the Wounds its hits caused.
 * @param {ExchangeResult} result
 * @param {{initiator?: number, defender?: number}} hpMax     Each unit's maximum HP before Wounds and Injuries
 * @returns {{initiator: {wounds: number, threshold: number}, defender: {wounds: number, threshold: number}}}
 */
export function exchangeWounds(result, hpMax = {}) {
  return Object.fromEntries(SIDES.map((side) => {
    const taken = result.attacks.filter((attack) => (attack.side === other(side)) && attack.hit).map((attack) => attack.damage);
    return [side, { wounds: woundsFrom(taken, hpMax[side]), threshold: woundThreshold(hpMax[side]) }];
  }));
}

/* -------------------------------------------- */
/*  Incapacitation                              */
/* -------------------------------------------- */

/**
 * Why a unit must now choose between retreat and death, if it must.
 * @param {DefeatProfile & {hp: number}} unit
 * @returns {("injuries"|"damage"|"timer")[]}
 */
export function fateReasons({ hp, hpMax, injuries, defeat }) {
  const reasons = [];
  const down = defeat?.state === "incapacitated";
  if ( ["retreated", "dead", "captured"].includes(defeat?.state) ) return reasons;
  if ( (injuries ?? 0) >= FEO.defeat.injuryLimit ) reasons.push("injuries");
  const limit = deathThreshold(hpMax);
  if ( (limit > 0) && (hp <= -limit) ) reasons.push("damage");
  if ( down && !defeat.paused && (defeat.turns <= 0) ) reasons.push("timer");
  return reasons;
}

/* -------------------------------------------- */

/**
 * What a change of HP means for a unit's defeat state.
 * - A standing unit brought to 0 HP or below becomes Incapacitated.
 * - An Incapacitated unit healed above 0 HP recovers and suffers an Injury.
 * - An Incapacitated unit healed but still at 0 HP or below has its timer paused; one that is hit loses the
 *   pause.
 * @param {DefeatProfile} unit      The unit before the change
 * @param {number} before           HP before the change
 * @param {number} after            HP after the change
 * @returns {{event: "down"|"recovered"|"paused"|"resumed", defeat: DefeatState, injuries: number}|null}
 *          Null when nothing about the unit's defeat changes
 */
export function hpTransition(unit, before, after) {
  const defeat = unit.defeat ?? { state: "", turns: 0, paused: false };
  if ( !Number.isFinite(after) ) return null;

  if ( !defeat.state ) {
    if ( (after > 0) || !(before > 0) || !(unit.hpMax > 0) ) return null;
    return {
      event: "down",
      defeat: { state: "incapacitated", turns: incapacitationTurns(unit.resilience, unit.graveWounds), paused: false },
      injuries: unit.injuries ?? 0
    };
  }

  if ( defeat.state !== "incapacitated" ) return null;
  if ( after > 0 ) {
    return { event: "recovered", defeat: { state: "", turns: 0, paused: false }, injuries: (unit.injuries ?? 0) + 1 };
  }
  if ( Number.isFinite(before) && (after > before) && !defeat.paused ) {
    return { event: "paused", defeat: { ...defeat, paused: true }, injuries: unit.injuries ?? 0 };
  }
  if ( Number.isFinite(before) && (after < before) && defeat.paused ) {
    return { event: "resumed", defeat: { ...defeat, paused: false }, injuries: unit.injuries ?? 0 };
  }
  return null;
}

/* -------------------------------------------- */

/**
 * What a change of HP means for a unit the Incapacitation system does not apply to, as every unit is in a
 * world that plays without it: it is defeated at 0 HP, and back in the fight when it is raised above it.
 * - A standing unit brought to 0 HP or below is dead, or retreats if it has a life to spare.
 * - A dead unit raised above 0 HP returns.
 * @param {{hpMax: number, defeat: DefeatState}} unit     The unit before the change
 * @param {number} before           HP before the change
 * @param {number} after            HP after the change
 * @param {object} [options]
 * @param {boolean} [options.spare]   Does it lose a life and leave the battle instead of dying?
 * @returns {{event: "defeated"|"returned", defeat: DefeatState}|null}    Null when nothing about the unit's
 *          defeat changes
 */
export function plainTransition(unit, before, after, { spare = false } = {}) {
  const state = unit.defeat?.state ?? "";
  if ( !Number.isFinite(after) ) return null;
  if ( !state ) {
    if ( (after > 0) || !(before > 0) || !(unit.hpMax > 0) ) return null;
    return { event: "defeated", defeat: { state: spare ? "retreated" : "dead", turns: 0, paused: false } };
  }
  if ( (state === "dead") && (after > 0) ) return { event: "returned", defeat: { state: "", turns: 0, paused: false } };
  return null;
}

/* -------------------------------------------- */

/**
 * Is a unit out of the fight? One that has retreated, died or been captured is, and so is one that stands at
 * 0 HP with nothing said of what became of it. Such a unit holds no tile, threatens nothing, gives and
 * receives no aura and is nobody's target. An Incapacitated unit is still in the fight. A unit that an ally
 * carries is out of it for as long as it is carried, whatever else is true of it (see `rescue.mjs`).
 * @param {object} unit
 * @param {string} [unit.state]     Its defeat state
 * @param {number} [unit.hp]        Its HP
 * @param {number} [unit.hpMax]     Its maximum HP: a unit that was never given any has not been brought to 0
 * @param {boolean} [unit.carried]  Is it carried by an ally that Rescued it?
 * @returns {boolean}
 */
export function outOfFight({ state = "", hp = 1, hpMax = 0, carried = false } = {}) {
  if ( carried || ["retreated", "dead", "captured"].includes(state) ) return true;
  return !state && (hpMax > 0) && (hp <= 0);
}

/* -------------------------------------------- */

/**
 * Has a unit left the map? One that died or retreated has: its token is taken off it. An Incapacitated unit
 * lies where it fell, and so does a captured one until it is carried, which is shown by other means. A unit
 * that an ally carries is off the map as well, and rides on its carrier's token until it is set down.
 * @param {string} state          Its defeat state
 * @param {object} [options]
 * @param {boolean} [options.carried]     Is it carried by an ally that Rescued it?
 * @returns {boolean}
 */
export function leavesMap(state, { carried = false } = {}) {
  return carried || (state === "dead") || (state === "retreated");
}

/* -------------------------------------------- */

/**
 * An Incapacitated unit's turn starts: a paused timer starts running again, a running one loses a turn.
 * @param {DefeatState} defeat
 * @returns {{defeat: DefeatState, resumed: boolean, from: number, to: number}|null}   Null for a unit that
 *                                                                                    is not Incapacitated
 */
export function tickIncapacitation(defeat) {
  if ( defeat?.state !== "incapacitated" ) return null;
  if ( defeat.paused ) return { defeat: { ...defeat, paused: false }, resumed: true, from: defeat.turns, to: defeat.turns };
  const to = Math.max(defeat.turns - 1, 0);
  return { defeat: { ...defeat, turns: to }, resumed: false, from: defeat.turns, to };
}

/* -------------------------------------------- */

/**
 * An Incapacitated unit gives up a turn of its timer to take one action or move half its movement.
 * @param {DefeatState} defeat
 * @returns {DefeatState|null}    Null if the unit has no turn left to give
 */
export function spendRound(defeat) {
  if ( (defeat?.state !== "incapacitated") || (defeat.turns <= 0) ) return null;
  return { ...defeat, turns: defeat.turns - 1 };
}

/* -------------------------------------------- */
/*  Treatment                                   */
/* -------------------------------------------- */

/**
 * The target number of a Medicine check to heal Wounds or Injuries.
 * @param {"wounds"|"injuries"} kind
 * @param {number} count    How many the patient has
 * @returns {number}
 */
export function treatmentDc(kind, count) {
  const { dc, perCount } = FEO.defeat.treat[kind];
  return dc + (perCount * Math.max(count ?? 0, 0));
}

/* -------------------------------------------- */

/**
 * Resolve a Medicine check to heal a patient. Injuries are the harder check; a healer treating Injuries heals
 * Wounds with the same roll.
 * @param {object} patient
 * @param {number} patient.wounds
 * @param {number} patient.injuries
 * @param {object} healer
 * @param {number} healer.medicine    The healer's Medicine bonus
 * @param {number} roll               The d100
 * @param {object} [options]
 * @param {boolean} [options.injuries]  Is this a day of downtime, so that Injuries can be healed too?
 * @returns {{total: number, heals: number, wounds: {dc: number, success: boolean, healed: number, left: number}|null,
 *   injuries: {dc: number, success: boolean, healed: number, left: number}|null, exp: number}}
 */
export function treat(patient, healer, roll, { injuries = false } = {}) {
  const config = FEO.defeat.treat;
  const total = roll + (healer.medicine ?? 0);
  const heals = Math.floor(Math.max(healer.medicine ?? 0, 0) / config.perMedicine);
  const part = (kind, count) => {
    if ( !(count > 0) ) return null;
    const dc = treatmentDc(kind, count);
    const success = total >= dc;
    const healed = success ? Math.min(heals, count) : 0;
    return { dc, success, healed, left: count - healed };
  };
  const wounds = part("wounds", patient.wounds);
  const hurt = injuries ? part("injuries", patient.injuries) : null;
  const exp = ((wounds?.healed ?? 0) * config.wounds.exp) + ((hurt?.healed ?? 0) * config.injuries.exp);
  return { total, heals, wounds, injuries: hurt, exp };
}

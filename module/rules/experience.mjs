/**
 * Experience awards for Fire Emblem Online, as the EXP tab of the rules gives them.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @import {ExchangePlan, ExchangeResult} from "./combat.mjs"
 */
import { FEO } from "../config.mjs";

/**
 * @typedef ExpAward
 * @property {number} amount                          Experience earned
 * @property {"kill"|"hit"|"pity"|"none"|"noExp"} reason      Why: the foe was defeated, damage was dealt, the unit could
 *                                                    attack but dealt none, or it could not attack at all
 * @property {number} gap                             The unit's level minus its foe's, as the table reads it
 */

const SIDES = ["initiator", "defender"];
const other = (side) => side === "initiator" ? "defender" : "initiator";

/**
 * Fold a name down to what the experience tables compare: lower case, without anything in brackets.
 * @param {string} name
 * @returns {string}
 */
export function tableName(name) {
  return String(name ?? "").replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/* -------------------------------------------- */

/**
 * The gap between a unit's level and its foe's, held within the ends of the combat table.
 * @param {number} level
 * @param {number} foeLevel
 * @returns {number}
 */
export function levelGap(level, foeLevel) {
  const { min, max } = FEO.exp.gap;
  const gap = Math.trunc((level ?? 1) - (foeLevel ?? 1));
  return Math.min(Math.max(gap, min), max);
}

/* -------------------------------------------- */

/**
 * Experience for defeating a foe.
 * @param {number} level
 * @param {number} foeLevel
 * @returns {number}
 */
export function killExp(level, foeLevel) {
  return FEO.exp.combat.kill[levelGap(level, foeLevel)] ?? 0;
}

/* -------------------------------------------- */

/**
 * Experience for a combat in which the unit dealt damage without defeating its foe.
 * @param {number} level
 * @param {number} foeLevel
 * @returns {number}
 */
export function combatExp(level, foeLevel) {
  return FEO.exp.combat.hit[levelGap(level, foeLevel)] ?? 0;
}

/* -------------------------------------------- */

/**
 * Does a unit count as promoted for the staff and skill tables?
 * @param {number} level        The unit's level, counted on through its promotions
 * @param {string} [tier]       The tier of its class, a key of FEO.classTiers, when it has a class
 * @returns {boolean}
 */
export function isPromoted(level, tier) {
  const order = FEO.classTiers[tier]?.order;
  if ( (order !== undefined) && (order >= FEO.classTiers.second.order) ) return true;
  return (level ?? 1) >= FEO.exp.promotedLevel;
}

/* -------------------------------------------- */

/**
 * Look a name up in one of the experience tables.
 * @param {{names: string[], unpromoted: number|null, promoted: number|null}[]} table
 * @param {string} name
 * @returns {object|null}
 */
function findRow(table, name) {
  const wanted = tableName(name);
  if ( !wanted ) return null;
  return table.find((row) => row.names.some((entry) => tableName(entry) === wanted)) ?? null;
}

/* -------------------------------------------- */

/**
 * Experience for using a staff.
 * @param {string} name                 The staff's name
 * @param {boolean} promoted            Is the user promoted?
 * @param {object} [options]
 * @param {number} [options.terrors]    Terrors slain by the staff, for staves that earn more for each
 * @returns {number|null}               Null when the table does not list the staff
 */
export function staffExp(name, promoted, { terrors = 0 } = {}) {
  const row = findRow(FEO.exp.staves, name);
  if ( !row ) return null;
  const base = promoted ? row.promoted : row.unpromoted;
  return (base ?? 0) + ((row.perTerror ?? 0) * Math.max(terrors, 0));
}

/* -------------------------------------------- */

/**
 * Experience for using a skill.
 * @param {string} name         The skill's name
 * @param {boolean} promoted    Is the user promoted?
 * @returns {number|null}       Null when the table does not list the skill
 */
export function skillExp(name, promoted) {
  const row = findRow(FEO.exp.skills, name);
  if ( !row ) return null;
  return (promoted ? row.promoted : row.unpromoted) ?? 0;
}

/* -------------------------------------------- */

/**
 * Does the skill table list a skill at all, so that using it is worth a button?
 * @param {string} name
 * @returns {boolean}
 */
export function earnsSkillExp(name) {
  return !!findRow(FEO.exp.skills, name);
}

/* -------------------------------------------- */

/**
 * Experience each side earns from an exchange.
 * A unit that defeats its foe earns kill experience, whether an attack of its own did or the damage of one of
 * its skills; one that dealt damage earns combat experience; one that could attack but dealt none earns pity
 * experience; one that could not attack earns nothing. Defeating a foe whose skills say that it gives no
 * experience (`rules: ["noExp"]`) earns nothing either.
 * @param {ExchangePlan} plan
 * @param {ExchangeResult} result
 * @param {{initiator?: number, defender?: number}} levels    Each unit's level
 * @returns {{initiator: ExpAward, defender: ExpAward}}
 */
export function exchangeExp(plan, result, levels = {}) {
  const award = (side) => {
    const foe = other(side);
    const gap = levelGap(levels[side], levels[foe]);
    const mine = result.attacks.filter((attack) => attack.side === side);
    if ( mine.some((attack) => attack.kill) || (result.slain ?? []).some((entry) => entry.by === side) ) {
      if ( plan[foe].unit?.fx?.rules?.has?.("noExp") ) return { amount: 0, reason: "noExp", gap };
      return { amount: killExp(levels[side], levels[foe]), reason: "kill", gap };
    }
    if ( mine.some((attack) => attack.hit && (attack.damage > 0)) ) {
      return { amount: combatExp(levels[side], levels[foe]), reason: "hit", gap };
    }
    if ( !plan[side].blocked ) return { amount: FEO.exp.pity, reason: "pity", gap };
    return { amount: 0, reason: "none", gap };
  };
  return Object.fromEntries(SIDES.map((side) => [side, award(side)]));
}

/* -------------------------------------------- */

/**
 * Add experience to what a unit has. Anything past a level's worth is kept, and carries over when the unit
 * levels up.
 * @param {number} exp        Experience the unit has
 * @param {number} amount     Experience earned
 * @returns {{exp: number, gained: number, ready: boolean, levels: number}}   `ready` once a level can be gained
 */
export function gainExp(exp, amount) {
  const gained = Math.max(Math.floor(amount ?? 0), 0);
  const total = Math.max(exp ?? 0, 0) + gained;
  return { exp: total, gained, ready: total >= FEO.expPerLevel, levels: Math.floor(total / FEO.expPerLevel) };
}

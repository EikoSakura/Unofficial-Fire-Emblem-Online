/**
 * Staves for Fire Emblem Online: what a staff does, whom it may be used on, and what the skills of the units
 * make of it. What a staff does is read from its Effect (healing, healing over the turns that follow, curing,
 * the conditions it inflicts, its damage, how it moves a unit: see `warp.mjs`) and from the table of staves in
 * the configuration (`FEO.staves`) for what no general wording covers; `staffPlan` puts the two together. A
 * staff is for one unit, for every ally or every enemy it reaches, for its user, for a door or a chest, or for
 * an ally that has fallen; `staffTakes` says whether it may be used on a unit and why not, and `staffCatches`
 * which units a staff for several catches. `castStaff` works a use of a staff out: the rolls it makes, the HP
 * each unit regains, and what the skills of its user grant. Pure functions of plain data, so that they can be
 * tested outside of Foundry.
 *
 * Skills speak to it with the parts explained at the top of `skills.mjs`: `staffHeal`, `staffHealed`,
 * `staffRange`, `staffImmune`, `healing`, the rules `selfStaff`, `staffFreeUses` and `staffCombat`, and the
 * moments `staff` and `heal`.
 *
 * The four Additional Staff Effects of the Optional Modules are here too, each used only while its world
 * setting is on: a staff that heals may score a critical, it may be cast a second time, a staff that is not
 * used against an enemy may miss, and a staff does something for the unit that has it equipped.
 *
 * @import {SkillEntry} from "./skills.mjs"
 * @import {TimedChange} from "./timed.mjs"
 */
import { FEO } from "../config.mjs";
import { parseRange } from "./combat.mjs";
import { inflictions } from "./conditions.mjs";
import { staffFollows } from "./rounds.mjs";
import { chanceOf, holds, readNumber, resolveGiven } from "./skills.mjs";
import { buildChange } from "./timed.mjs";
import { staffWarp } from "./warp.mjs";

/**
 * @typedef StaffUnit
 * A unit that uses a staff, or that one is used on.
 * @property {string} [name]
 * @property {string} [uuid]
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} [level]
 * @property {Record<string, number>} [stats]         Stat totals
 * @property {number} [hitBonus]                      For the unit that uses the staff: what is added to its Hit
 *                                                    whatever it attacks with
 * @property {Record<string, number>} [conditions]
 * @property {SkillEntry[]} [skills]                  Its equipped skills, and the lasting changes it carries
 * @property {import("./positions.mjs").Surroundings|null} [near]     What it has around it on the map
 * @property {boolean} [ally]                         For the unit a staff is used on: is it the user's ally?
 * @property {boolean} [enemy]                        For the unit a staff is used on: is it the user's enemy?
 * @property {number} [staffHit]                      For the unit that uses the staff: its Offensive Staff Hit
 *                                                    with it
 * @property {number} [staffAvoid]                    For an enemy: its Offensive Staff Avoid, before the tiles
 *                                                    between the two are counted
 * @property {number} [distance]                      For an enemy of a staff for each enemy in range: the tiles
 *                                                    between it and the user
 * @property {number} [attackSpeed]                   Its Attack Speed: with the staff in hand for the unit that
 *                                                    uses it, as it stands for an enemy it is used on. Without
 *                                                    it nobody follows up with a staff
 * @property {number} [haste]                         For the unit that uses the staff: HST it has from elsewhere
 */

/**
 * @typedef StaffCast
 * What using a staff did.
 * @property {"target"|"self"|null} patient           Who the staff healed, if it heals one unit
 * @property {{amount: number, restored: number, full: boolean, skills: string[]}|null} heal
 *           What the staff heals for, the HP the patient regains, and the skills that raised the amount
 * @property {{amount: number, restored: number, skills: string[]}|null} user
 *           The HP the user itself regains: from a staff that heals user and target, or by a skill
 * @property {{id: string|null, name: string, self: boolean, landed: boolean, critical: StaffRoll|null, amount: number,
 *   restored: number, full: boolean}[]|null} units
 *           For a staff that heals every ally it catches: what each regained, and whether the staff reached it
 * @property {{amount: number, own: number, turns: number}|null} mend
 *           For a staff that restores HP over the turns that follow: what an ally regains as each of so many of
 *           its turns starts, and what the user itself would
 * @property {{skill: string, remind: boolean, granted: {to: "self"|"target", id: string|null, name: string, change: TimedChange}[]}[]} moments
 *           The skills that took effect as the staff was used: what they announce, and the changes that last a
 *           while which they grant, to the user or to each unit the staff did its part to
 * @property {string|null} freeUse                    The skill that spares the staff its use
 * @property {{min: number, max: number, changed: boolean}|null} reach
 *           How far the staff reaches as the user's skills make it
 * @property {StaffCastPart[]} casts                  Each time the staff was cast on its one target: once, or
 *                                                    twice with a Double-Cast. Empty for a staff for several units
 * @property {StaffRoll|null} double                  The roll for a Double-Cast, if one was made
 * @property {{name: string, roll: number|null, chance: number, success: boolean}[]|null} reached
 *           For a staff for several units that may miss: the roll made for each unit it was used on. For an
 *           Offensive Staff for each enemy in range: the roll made to hit each, marked `offensive`
 * @property {{rate: number, each: boolean}|null} aim
 *           The chance of the staff to succeed where it may miss; `each` when it is to be rolled by hand for
 *           every unit the staff is for, since none was pointed out
 * @property {boolean} missed                         Did every cast miss, so that the staff did nothing?
 * @property {string|null} follow                     The skill by which an Offensive Staff was cast a second
 *                                                    time at once, as a follow-up attack is made (see
 *                                                    `rounds.mjs`); that cast is marked `follow`
 */

/**
 * @typedef StaffRoll
 * @property {number|null} roll           The d100; null where the chance left nothing to roll
 * @property {number} chance              In percent
 * @property {boolean} success
 */

/**
 * @typedef StaffCastPart
 * One cast of a staff on its one target.
 * @property {StaffRoll|null} hit         Its roll to succeed, where the staff may miss
 * @property {boolean} [offensive]        Was that roll Offensive Staff Hit against an enemy's Offensive Staff Avoid?
 * @property {StaffRoll|null} critical    Its roll for a Heal Critical, where it may score one
 * @property {number} amount              What it heals for
 * @property {number} restored            The HP its target regains
 * @property {{amount: number, restored: number}|null} own      What the user itself regains by it
 */

/* -------------------------------------------- */
/*  Additional Staff Effects                    */
/* -------------------------------------------- */

/**
 * Does a staff restore HP, at once or over the turns that follow? Such a staff is a healing staff.
 * @param {string} [effect]     The staff's Effect
 * @returns {boolean}
 */
export function healsHp(effect) {
  return /\bheals?\b|\brestores?\s+all\s+HP\b/i.test(String(effect ?? ""));
}

/* -------------------------------------------- */

/**
 * Is a staff for several units at once, as Fortify is?
 * @param {string} [effect]     The staff's Effect
 * @returns {boolean}
 */
export function forSeveral(effect) {
  return /\ball\s+(?:adjacent\s+)?allies\b/i.test(String(effect ?? ""));
}

/* -------------------------------------------- */

/**
 * Whom a staff is used on: enemies, anybody else, or either. The staves of the Reference Sheet that are used
 * against enemies are listed; another staff is taken for one when its Effect deals damage, afflicts its target
 * or is for each enemy in range. A staff whose Effect is for an enemy or an ally goes by its target.
 * @param {{name?: string, effect?: string}} staff      `name` as the Reference Sheet has it
 * @param {object} [config]                             FEO.optional.staffMissing
 * @returns {"offensive"|"friendly"|"either"}
 */
export function staffSide(staff, config = FEO.optional.staffMissing) {
  const effect = String(staff?.effect ?? "");
  if ( /\benemy\s+or\s+ally\b|\bally\s+or\s+enemy\b/i.test(effect) ) return "either";
  const name = String(staff?.name ?? "").trim().toLowerCase();
  if ( (config.offensive ?? []).some((listed) => listed.toLowerCase() === name) ) return "offensive";
  return /\bdamage\s+lowered\s+by\b|\bafflicted\s+with\b|\beach\s+enemy\b|\benemy\s+unit\b/i.test(effect) ? "offensive" : "friendly";
}

/* -------------------------------------------- */

/**
 * Is a staff for each enemy in range at once, as Disturb is? Each of them is rolled for separately.
 * @param {string} [effect]     The staff's Effect
 * @returns {boolean}
 */
export function forEachEnemy(effect) {
  return /\beach\s+enemy\b/i.test(String(effect ?? ""));
}

/* -------------------------------------------- */

/**
 * Does an Offensive Staff deal damage, as Pain does? One that does not is a status staff: it does something
 * else to the enemy it hits.
 * @param {string} [effect]     The staff's Effect
 * @returns {boolean}
 */
export function dealsDamage(effect) {
  return /\bdamage\s+lowered\s+by\b/i.test(String(effect ?? ""));
}

/* -------------------------------------------- */

/**
 * The chance of an Offensive Staff to hit an enemy: the user's Offensive Staff Hit less the enemy's Offensive
 * Staff Avoid, which counts 2 for each tile between the two.
 * @param {number} staffHit       The user's Offensive Staff Hit with the staff
 * @param {number} staffAvoid     The enemy's Offensive Staff Avoid, before the tiles are counted
 * @param {number} distance       Tiles between the two
 * @returns {number}              In percent, from 0 to 100
 */
export function offensiveStaffChance(staffHit, staffAvoid, distance) {
  const avoid = (staffAvoid ?? 0) + (Math.max(distance ?? 0, 0) * 2);
  return Math.min(Math.max(Math.floor((staffHit ?? 0) - avoid), 0), 100);
}

/* -------------------------------------------- */

/**
 * The chance of a staff that is not used against an enemy to succeed: its Hit, the user's Dexterity three
 * times over, and what is added to the user's Hit whatever it attacks with.
 * @param {{hit?: number}} staff
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @param {number} [bonus]                    What is added to its Hit
 * @param {object} [config]                   FEO.optional.staffMissing
 * @returns {number}                          In percent, from 0 to 100
 */
export function staffHitRate(staff, stats = {}, bonus = 0, config = FEO.optional.staffMissing) {
  const rate = (staff?.hit ?? 0) + (Math.max(stats[config.stat] ?? 0, 0) * config.times) + (bonus ?? 0);
  return Math.min(Math.max(Math.floor(rate), 0), 100);
}

/* -------------------------------------------- */

/**
 * The chance of a staff that heals to score a Heal Critical: half the user's Luck, rounded down. No skill
 * changes it.
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @param {object} [config]                   FEO.optional.healCriticals
 * @returns {number}                          In percent, from 0 to 100
 */
export function healCritChance(stats = {}, config = FEO.optional.healCriticals) {
  return Math.min(Math.floor(Math.max(stats[config.stat] ?? 0, 0) / config.divisor), 100);
}

/* -------------------------------------------- */

/**
 * The chance of a staff that heals to be cast a second time: half the sum of the user's Dexterity, Speed and
 * Luck, rounded down.
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @param {object} [config]                   FEO.optional.doubleCast
 * @returns {number}                          In percent, from 0 to 100
 */
export function doubleCastChance(stats = {}, config = FEO.optional.doubleCast) {
  const sum = config.stats.reduce((total, key) => total + Math.max(stats[key] ?? 0, 0), 0);
  return Math.min(Math.floor(sum / config.divisor), 100);
}

/* -------------------------------------------- */

/**
 * The most d100s using a staff can need: one for each unit it may miss, or for each of two casts, one for a
 * critical with each of those, and one for the second cast itself. None while the world plays with none of this.
 * @param {number} [units]        The units a staff for several is used on
 * @param {object} [rules]        FEO.optional
 * @returns {number}
 */
export function staffDice(units = 1, rules = FEO.optional) {
  const used = rules.staffMissing?.enabled || rules.healCriticals?.enabled || rules.doubleCast?.enabled;
  return used ? (Math.max(units, 2) * 2) + 1 : 0;
}

/* -------------------------------------------- */

/**
 * The most d100s a unit's skills can need as it uses a staff: one for each of their effects that wait for a
 * staff to be used and roll to take effect.
 * @param {SkillEntry[]} [skills]
 * @returns {number}
 */
export function staffChances(skills) {
  return (skills ?? []).reduce((count, skill) => {
    return count + (skill.effects ?? []).filter((effect) => (effect.proc?.on === "staff") && !effect.proc.sure).length;
  }, 0);
}

/* -------------------------------------------- */

/**
 * The conditions a staff cures its unit of while it is equipped: the ones it inflicts, or all of them for a
 * staff that removes them all. A condition its Effect names that the world does not play with is `unknown`.
 * @param {string} [effect]     The staff's Effect
 * @returns {{all: boolean, conditions: string[], unknown: string[]}|null}    Null for a staff that has nothing to
 *          do with conditions
 */
export function staffCures(effect) {
  const text = String(effect ?? "");
  if ( /\bremoves?\s+all\s+conditions\b|\brestores?\s+\w+\s+to\s+normal\s+condition\b/i.test(text) ) {
    return { all: true, conditions: [], unknown: [] };
  }
  const conditions = inflictions(text).map((infliction) => infliction.id);
  const unknown = [];
  if ( !conditions.length ) {
    for ( const part of text.split(/[,.;\n]/) ) {
      const named = part.match(/\bafflicted\s+with\s+(.+)$|\bgets?\s+the\s+(.+?)\s+condition\b/i);
      if ( named ) unknown.push((named[1] ?? named[2]).trim());
    }
  }
  return (conditions.length || unknown.length) ? { all: false, conditions, unknown } : null;
}

/* -------------------------------------------- */

/**
 * What a staff does for the unit that has it equipped, in the notation of skill effects, as the system applies
 * it in this world. A staff the rule names does what its row says. Of the others, a healing staff heals its
 * unit as each of its turns starts, and a staff that inflicts a condition, or removes them all, cures its unit
 * then. A condition the world does not play with cannot be cured: its moment is announced, for the table to
 * apply. A staff that is out of uses does nothing.
 * @param {{name?: string, effect?: string, broken?: boolean}|null} staff     `name` as the Reference Sheet has it
 * @param {object} [config]     FEO.optional.staffPassives
 * @returns {object[]}          None for a staff that does nothing while equipped, and none while the world does
 *                              not play with the rule
 */
export function staffPassive(staff, config = FEO.optional.staffPassives) {
  if ( !config.enabled || !staff || staff.broken ) return [];
  const name = String(staff.name ?? "").trim().toLowerCase();
  const named = Object.entries(config.staves).find(([listed]) => listed.toLowerCase() === name);
  if ( named ) return named[1];
  const effects = [];
  if ( healsHp(staff.effect) ) effects.push(...config.heal);
  const cures = staffCures(staff.effect);
  const moment = { on: "turnStart", sure: true };
  if ( cures?.all ) effects.push({ proc: moment, cure: "all" });
  else if ( cures?.conditions.length ) effects.push({ proc: moment, cure: cures.conditions });
  else if ( cures ) effects.push({ proc: moment, remind: true });
  return effects;
}

/* -------------------------------------------- */

/**
 * What a staff does for the unit that has it equipped, as one more skill of the unit: an entry the skill rules
 * read like that of an equipped skill, which Nihil does not cancel.
 * @param {{name?: string, effect?: string, broken?: boolean}|null} staff
 * @param {string} name             What it goes by in fights and on cards
 * @param {object} [config]         FEO.optional.staffPassives
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}|null}    Null for a staff with
 *          nothing for the system to apply or announce
 */
export function staffPassiveEntry(staff, name, config = FEO.optional.staffPassives) {
  const effects = staffPassive(staff, config);
  return effects.length ? { name, innate: true, nihil: false, effects } : null;
}

/* -------------------------------------------- */

/**
 * What a staff heals, as its Effect says: "Heals target by 10 + MAG", "Heals 35 + MAG/2", "Heals user and
 * target by 5 + MAG", "Heals all HP". Healing over several turns is not read, and a staff for several units at
 * once is marked `area`.
 * @param {string} [effect]                   The staff's Effect
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @returns {{amount: number|null, full: boolean, user: boolean, area: boolean}|null}   Null for a staff that
 *          does not heal at once
 */
export function staffHealing(effect, stats = {}) {
  const first = String(effect ?? "").trim().split(/[.;\n]/)[0];
  const area = /\ball\s+(?:adjacent\s+)?allies\b/i.test(first);
  if ( /^(?:(?:heals?|restores?)\s+all\s+HP|completely\s+heals)\b/i.test(first) ) return { amount: null, full: true, user: false, area };
  const match = first.match(/^heals?\s+(?:(user\s+and\s+target|target)\s+)?(?:all\s+(?:adjacent\s+)?allies\s+)?(?:by\s+|for\s+)?(\d+)\s*\+\s*MAG(?:\s*\/\s*(\d+))?/i);
  if ( !match ) return null;
  const amount = Number(match[2]) + Math.floor(Math.max(stats.mag ?? 0, 0) / (match[3] ? Number(match[3]) : 1));
  return { amount, full: false, user: /^user/i.test(match[1] ?? ""), area };
}

/* -------------------------------------------- */
/*  What a Staff Does                           */
/* -------------------------------------------- */

/**
 * @typedef StaffPlan
 * What a staff does, as its Effect and the table of staves (`FEO.staves`) have it. Every part is one the
 * system applies by itself.
 * @property {string} name                          The name the Reference Sheet gives it
 * @property {"offensive"|"friendly"|"either"} side Whom it is used on
 * @property {"unit"|"allies"|"enemies"|"self"|"object"|"fallen"|"nobody"} on
 *           What it is used on: one unit; every ally or every enemy it reaches at once; its user alone; a door
 *           or a chest; an ally that has fallen; or nothing the map knows
 * @property {"range"|"adjacent"|null} span         For one for several units: those within its Range (all of
 *                                                  them where its Range sets no limit), or those next to its user
 * @property {import("./warp.mjs").StaffWarp|null} warp     How it moves a unit
 * @property {{amount: number|null, full: boolean, user: boolean}|null} heal
 * @property {{amount: number, turns: number}|null} mend    HP restored as each of so many turns starts
 * @property {"all"|null} cure
 * @property {boolean} clears
 * @property {string[]} inflicts                    The conditions it puts on an enemy it hits
 * @property {{amount: number}|null} damage         Before the RES of its target is taken off
 * @property {number} drain
 * @property {{within: number, percent: number}|null} splash
 * @property {object|null} change                   A change that lasts, as a skill's `grant` writes one
 * @property {{killAt: number}|null} halves
 * @property {string[]|null} slays
 * @property {boolean} steals
 * @property {{mov: string}|null} again
 * @property {number|"endless"|null} repairs
 * @property {string[]} spares                      The weapons it cannot repair, by name
 * @property {string[]|null} unlocks
 * @property {boolean} revives
 * @property {boolean} applied                      Does the system apply anything of it by itself?
 */

/**
 * A staff's Effect as one line of plain text.
 * @param {string} [effect]
 * @returns {string}
 */
function plain(effect) {
  return String(effect ?? "").replace(/\s+/g, " ").replace(/[’`]/g, "'").trim();
}

/* -------------------------------------------- */

/**
 * What a staff restores over the turns that follow, as its Effect says: "Target heals 5 + MAG/2 at the start of
 * their turn for 3 turns", "All allies in range heal 5 + MAG/2 at the start of their turn for 3 turns".
 * @param {string} [effect]                   The staff's Effect
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @returns {{amount: number, turns: number}|null}
 */
export function staffMending(effect, stats = {}) {
  const match = plain(effect).match(/\bheals?\s+(\d+)\s*\+\s*MAG(?:\s*\/\s*(\d+))?\s+at\s+the\s+start\s+of\s+(?:their|its)\s+turns?\s+for\s+(\d+)\s+turns\b/i);
  if ( !match ) return null;
  return {
    amount: Number(match[1]) + Math.floor(Math.max(stats.mag ?? 0, 0) / (match[2] ? Number(match[2]) : 1)),
    turns: Math.max(Number(match[3]), 1)
  };
}

/* -------------------------------------------- */

/**
 * The damage of a staff that deals some, before the RES of its target is taken off: "10 + MAG/2 damage lowered
 * by RES".
 * @param {string} [effect]                   The staff's Effect
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @returns {{amount: number}|null}
 */
export function staffDamage(effect, stats = {}) {
  const match = plain(effect).match(/(\d+)\s*\+\s*MAG(?:\s*\/\s*(\d+))?\s+damage\s+lowered\s+by\s+RES\b/i);
  if ( !match ) return null;
  return { amount: Number(match[1]) + Math.floor(Math.max(stats.mag ?? 0, 0) / (match[2] ? Number(match[2]) : 1)) };
}

/* -------------------------------------------- */

/**
 * What a staff does, with the numbers it has in the hands of a unit.
 * @param {{name?: string, sheetName?: string, effect?: string}} staff    `sheetName` is the name the Reference
 *        Sheet gives it, where it goes by another
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @param {object} [config]                   FEO
 * @returns {StaffPlan}
 */
export function staffPlan(staff, stats = {}, config = FEO) {
  const effect = plain(staff?.effect);
  const name = String(staff?.sheetName ?? staff?.name ?? "").trim();
  const named = Object.entries(config.staves ?? {}).find(([listed]) => listed.toLowerCase() === name.toLowerCase())?.[1] ?? {};
  const side = staffSide({ name, effect }, config.optional?.staffMissing);
  const warp = staffWarp(effect);
  const healing = staffHealing(effect, stats);
  const friendly = side !== "offensive";
  let on = "unit";
  let span = null;
  if ( named.on === "nobody" ) on = "nobody";
  else if ( named.unlocks ) on = "object";
  else if ( named.revives ) on = "fallen";
  else if ( warp ) on = (warp.moves === "self") ? "self" : "unit";
  else if ( forEachEnemy(effect) ) [on, span] = ["enemies", "range"];
  else if ( forSeveral(effect) ) [on, span] = ["allies", /\badjacent\b/i.test(effect) ? "adjacent" : "range"];
  const change = (typeof named.change === "string") ? (config.staffChanges?.[named.change] ?? null) : (named.change ?? null);
  const plan = {
    name, side, on, span, warp,
    heal: healing ? { amount: healing.amount, full: healing.full, user: healing.user } : null,
    mend: staffMending(effect, stats),
    cure: (friendly && ((named.cure === "all") || staffCures(effect)?.all)) ? "all" : null,
    clears: !!named.clears,
    inflicts: friendly ? [] : inflictions(effect).map((infliction) => infliction.id),
    damage: friendly ? null : staffDamage(effect, stats),
    drain: named.drain ?? 0,
    splash: named.splash ?? null,
    change: change ? { name: staff?.name ?? name, ...change } : null,
    halves: named.halves ?? null,
    slays: named.slays ?? null,
    steals: !!named.steals,
    again: named.again ?? null,
    repairs: named.repairs ?? null,
    spares: named.spares ?? [],
    unlocks: named.unlocks ?? null,
    revives: !!named.revives
  };
  plan.applied = !named.text && !!(plan.warp || plan.heal || plan.mend || plan.cure || plan.clears || plan.inflicts.length || plan.damage
    || plan.change || plan.halves || plan.slays || plan.steals || plan.again || plan.repairs || plan.unlocks || plan.revives);
  return plan;
}

/* -------------------------------------------- */

/**
 * May a unit start a fight with a staff in its hand? Only one whose skill lets it, or with a staff whose
 * Effect says that anybody may, as a Broken Staff does. Anybody answers an attack with one.
 * @param {{effect?: string}|null} staff
 * @param {string[]|Set<string>} [rules]    The rules the unit's skills bend
 * @returns {boolean}
 */
export function fightsWithStaff(staff, rules = []) {
  if ( Array.from(rules ?? []).includes(STAFF_COMBAT) ) return true;
  return /\bcombat\s+can\s+be\s+initiated\s+with\s+(?:this\s+)?staff\b/i.test(plain(staff?.effect));
}

/** The rule that lets a unit start a fight with a staff in its hand. */
export const STAFF_COMBAT = "staffCombat";

/* -------------------------------------------- */

/**
 * Is a tile at a distance within the reach of a staff?
 * @param {{min: number, max: number}|null} reach     Null if its Range sets no limit
 * @param {number} distance                           Tiles between it and the user
 * @returns {boolean}
 */
export function staffReaches(reach, distance) {
  return !reach || ((distance >= Math.max(reach.min, 1)) && (distance <= reach.max));
}

/* -------------------------------------------- */

/**
 * @typedef StaffMark
 * A unit as a staff finds it on the map.
 * @property {string} [id]
 * @property {"ally"|"enemy"|"other"} relation    How it stands to the unit that uses the staff
 * @property {number} distance                    Tiles between the two
 * @property {boolean} [self]                     Is it the unit that uses the staff?
 * @property {boolean} [out]                      Is it out of the fight?
 * @property {boolean} [untargetable]             Can the user not make it its target for now?
 * @property {boolean} [unforced]                 Does it refuse being moved by the user?
 * @property {string[]} [immune]                  The staves it is immune to, by name
 * @property {string} [qualities]                 Its Special Qualities
 */

/**
 * May a staff be used on a unit, and if not, why not?
 *
 *   "self"      it is the user, which no skill lets be the target of its own staves
 *   "selfNot"   it is the user, and this staff is never used on its own unit
 *   "down"      it is out of the fight
 *   "ally"      the staff is for an ally, which it is not
 *   "enemy"     the staff is for an enemy, which it is not
 *   "barred"    the user cannot make it its target for now
 *   "out"       it stands out of the staff's reach
 *   "beside"    the staff is for a unit next to its user
 *   "immune"    a skill of its own leaves it out of this staff
 *   "nothing"   the staff does nothing to a unit like it
 *   "unmoved"   it is not moved by the user
 *
 * @param {StaffPlan} plan
 * @param {StaffMark} unit
 * @param {object} [options]
 * @param {{min: number, max: number}|null} [options.reach]   How far the staff reaches in its user's hands
 * @param {boolean} [options.selfStaff]                       Does a skill let the user be the target of its own
 *                                                            staves?
 * @returns {{ok: boolean, why: string|null}}
 */
export function staffTakes(plan, unit, { reach = null, selfStaff = false } = {}) {
  const no = (why) => ({ ok: false, why });
  const yes = { ok: true, why: null };
  if ( unit.self ) {
    if ( plan.warp || (plan.side === "offensive") || plan.again || plan.steals ) return no("selfNot");
    return selfStaff ? yes : no("self");
  }
  if ( unit.out ) return no("down");
  const sides = { offensive: ["enemy"], either: ["ally", "enemy"] }[plan.side] ?? ["ally"];
  if ( !sides.includes(unit.relation) ) return no((plan.side === "offensive") ? "enemy" : "ally");
  if ( unit.untargetable ) return no("barred");
  if ( plan.warp ) {
    const moved = { ally: ["ally"], enemy: ["enemy"], any: ["ally", "enemy"], target: sides }[plan.warp.moves] ?? [];
    if ( !moved.includes(unit.relation) ) return no((unit.relation === "enemy") ? "ally" : "enemy");
    if ( unit.unforced ) return no("unmoved");
    if ( plan.warp.from === "adjacent" ) return (unit.distance === 1) ? yes : no("beside");
  }
  if ( (plan.span === "adjacent") ? (unit.distance !== 1) : !staffReaches(reach, unit.distance) ) return no((plan.span === "adjacent") ? "beside" : "out");
  const lower = plan.name.toLowerCase();
  if ( (unit.immune ?? []).some((listed) => String(listed).toLowerCase() === lower) ) return no("immune");
  if ( plan.slays && !plan.slays.some((quality) => hasQuality(unit.qualities, quality)) ) return no("nothing");
  return yes;
}

/* -------------------------------------------- */

/**
 * Does a unit have a Special Quality, as its sheet lists them?
 * @param {string} [qualities]    "Armored, Terror"
 * @param {string} quality
 * @returns {boolean}
 */
function hasQuality(qualities, quality) {
  return String(qualities ?? "").split(/[,;/\n]/).some((part) => part.trim().toLowerCase() === String(quality).toLowerCase());
}

/* -------------------------------------------- */

/**
 * The units a staff for several units is used on: every ally it reaches, with its user where a skill has its
 * staves for several target it too, or every enemy it reaches that it does anything to.
 * @param {StaffPlan} plan
 * @param {StaffMark[]} units       The units on the map, the user among them
 * @param {object} [options]        As for `staffTakes`
 * @returns {StaffMark[]}           None for a staff that is not for several units
 */
export function staffCatches(plan, units, { reach = null, selfStaff = false } = {}) {
  if ( !["allies", "enemies"].includes(plan?.on) ) return [];
  return (units ?? []).filter((unit) => {
    if ( unit.self ) return (plan.on === "allies") && selfStaff;
    if ( unit.relation !== ((plan.on === "allies") ? "ally" : "enemy") ) return false;
    return staffTakes(plan, unit, { reach, selfStaff }).ok;
  });
}

/* -------------------------------------------- */

/**
 * What an Offensive Staff that deals damage takes off the HP of an enemy it hits: its damage less that
 * enemy's RES, and nothing where the RES is the greater.
 * @param {StaffPlan} plan
 * @param {Record<string, number>} [stats]    The enemy's stat totals
 * @returns {number}
 */
export function staffDamageTo(plan, stats = {}) {
  return plan?.damage ? Math.max(plan.damage.amount - Math.max(stats.res ?? 0, 0), 0) : 0;
}

/* -------------------------------------------- */

/**
 * What a staff that halves the HP of its target takes off them: half, rounded up, so that half, rounded down,
 * is left; all of them where it has no more than the staff kills at.
 * @param {StaffPlan} plan
 * @param {number} hp     The HP its target has
 * @returns {number}
 */
export function staffHalving(plan, hp) {
  if ( !plan?.halves || !(hp > 0) ) return 0;
  return (hp <= (plan.halves.killAt ?? 0)) ? hp : hp - Math.floor(hp / 2);
}

/* -------------------------------------------- */

/**
 * What a staff that repairs makes of the uses of a weapon or a Shield.
 * @param {StaffPlan} plan
 * @param {{name?: string, uses?: {value: number, max: number}}} item
 * @returns {{value: number, max: number}|null}     Null for one it cannot repair, or that needs none
 */
export function staffRepair(plan, item) {
  if ( !plan?.repairs ) return null;
  const lower = String(item?.name ?? "").trim().toLowerCase();
  if ( plan.spares.some((spared) => (lower === spared.toLowerCase()) || lower.startsWith(`${spared.toLowerCase()} `)) ) return null;
  const { value = 0, max = 0 } = item?.uses ?? {};
  if ( !(max > 0) ) return null;
  if ( plan.repairs === "endless" ) return { value: 0, max: 0 };
  if ( value >= max ) return null;
  return { value: Math.min(value + Math.max(Math.floor(max * plan.repairs), 1), max), max };
}

/* -------------------------------------------- */

/**
 * The enemy nearest to a unit, within so many tiles, for what strikes "the closest enemy": every one that
 * stands equally near, so that whoever acts picks between them.
 * @param {import("./positions.mjs").Surroundings|null} near    What the unit has around it
 * @param {number} within
 * @returns {{id: string, name: string, hp: number, distance: number}[]}
 */
export function nearestEnemies(near, within) {
  const enemies = (near?.others ?? []).filter((other) => {
    return (other.relation === "enemy") && (other.distance <= within) && ((other.hp ?? 1) > 0) && !other.out && !other.untargetable;
  }).sort((a, b) => a.distance - b.distance);
  return enemies.filter((other) => other.distance === enemies[0].distance)
    .map((other) => ({ id: other.id, name: other.name, hp: other.hp ?? 0, distance: other.distance }));
}

/* -------------------------------------------- */
/*  Healing by Any Means                        */
/* -------------------------------------------- */

/**
 * The share a unit heals other units for more, by whatever means: what its skills, the changes it carries and
 * the auras it receives add to all its healing, in percent.
 * @param {SkillEntry[]} skills
 * @param {object} self         The unit, as the conditions of skills see it
 * @returns {number}
 */
export function healingShare(skills, self) {
  let more = 0;
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc || effect.aura || !effect.healing?.more ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( holds(effect.when, self, null) ) more += effect.healing.more;
    }
  }
  return more;
}

/* -------------------------------------------- */

/**
 * What the skills of a unit make of its having healed an ally, with a staff, an item or a skill: damage to the
 * enemy nearest to that ally, a share of the HP it regained, rounded down. Where several enemies stand equally
 * near, all of them are named, for whoever acts for the unit to pick one.
 * @param {object} healing
 * @param {StaffUnit} healing.healer      The unit that healed
 * @param {StaffUnit} healing.patient     The ally it healed, with what it has around it
 * @param {number} healing.healed         The HP that ally regained
 * @returns {{harms: {skill: string, amount: number, within: number, units: {id: string, name: string, hp: number}[]}[]}}
 */
export function healMoments({ healer, patient, healed }) {
  const self = viewOf(healer);
  const harms = [];
  for ( const skill of healer?.skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect.proc?.on !== "heal") || !effect.harmNear ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self, null) ) continue;
      const within = effect.harmNear.within ?? 1;
      const amount = Math.floor((((healed ?? 0) * (effect.harmNear.percent ?? 100)) / 100) + 1e-9);
      const units = nearestEnemies(patient?.near ?? null, within);
      if ( (amount > 0) && units.length ) harms.push({ skill: skill.name, amount, within, units });
    }
  }
  return { harms };
}

/* -------------------------------------------- */

/**
 * What a unit's skills say about staves: what they add to the HP it heals, what it regains itself, how far
 * its staves reach, and the rules they bend. Read from the effects that are always there and whose condition
 * holds.
 * @param {SkillEntry[]} skills
 * @param {object} self                 The unit, as the conditions of skills see it
 * @param {object|null} [fight]         The use of the staff as a condition sees it: the distance and the target
 * @returns {{more: number, plus: number, echo: number, both: number, healer: number, healerBoth: number,
 *   ranges: object[], rules: Record<string, string>, by: Record<string, string[]>}}
 */
export function staffBends(skills, self, fight = null) {
  const bends = {
    more: 0, plus: 0, echo: 0, both: 0, healer: 0, healerBoth: 0, ranges: [], rules: {}, follow: null, immune: [],
    by: { more: [], plus: [], echo: [], both: [], healer: [], healerBoth: [], range: [], follow: [] }
  };
  const add = (key, amount, name) => {
    if ( !amount ) return;
    bends[key] += amount;
    if ( !bends.by[key].includes(name) ) bends.by[key].push(name);
  };
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc || effect.aura ) continue;
      if ( !effect.staffHeal && !effect.staffHealed && !effect.staffRange && !effect.staffFollow && !effect.rules && !effect.healing && !effect.staffImmune ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self, fight) ) continue;
      add("more", effect.staffHeal?.more, skill.name);

      // What it heals for more by any means counts with a staff as well
      add("more", effect.healing?.more, skill.name);
      for ( const name of effect.staffImmune ?? [] ) if ( !bends.immune.includes(name) ) bends.immune.push(name);
      add("plus", effect.staffHeal?.plus, skill.name);
      add("both", effect.staffHeal?.both, skill.name);
      add("healerBoth", effect.staffHealed?.both, skill.name);

      // The user regains the same HP only once, whoever of the two has the skill for it
      for ( const [key, share] of [["echo", effect.staffHeal?.self], ["healer", effect.staffHealed?.healer]] ) {
        if ( !(share > 0) ) continue;
        bends[key] = Math.max(bends[key], share);
        if ( !bends.by[key].includes(skill.name) ) bends.by[key].push(skill.name);
      }
      if ( effect.staffRange ) {
        bends.ranges.push({ ...effect.staffRange });
        if ( !bends.by.range.includes(skill.name) ) bends.by.range.push(skill.name);
      }
      for ( const rule of effect.rules ?? [] ) bends.rules[rule] ??= skill.name;

      // Following up with an Offensive Staff: the most HST any of its skills gives for that
      if ( effect.staffFollow ) {
        bends.follow = { haste: Math.max(bends.follow?.haste ?? 0, effect.staffFollow.haste ?? 0) };
        if ( !bends.by.follow.includes(skill.name) ) bends.by.follow.push(skill.name);
      }
    }
  }
  return bends;
}

/* -------------------------------------------- */

/**
 * How far a staff reaches as its user's skills make it: the farthest multiplied by each `times`, then raised
 * to at least each `max`.
 * @param {string|number} range
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @param {{times?: number, max?: number}[]} [changes]
 * @returns {{min: number, max: number, changed: boolean}|null}   Null if the Range sets no limit
 */
export function staffReach(range, stats = {}, changes = []) {
  const own = parseRange(range, stats);
  if ( !own ) return null;
  let max = own.max;
  for ( const change of changes ?? [] ) if ( Number.isFinite(change.times) ) max = Math.floor(max * change.times);
  for ( const change of changes ?? [] ) if ( Number.isFinite(change.max) ) max = Math.max(max, change.max);
  return { min: own.min, max, changed: max !== own.max };
}

/* -------------------------------------------- */

/**
 * The Range of a staff as it is written, so that two can be held against each other: "1-MAG/2" is "1 - mag/2".
 * @param {string|number} range
 * @returns {string}
 */
function rangeText(range) {
  return String(range ?? "").replace(/\s+/g, "").toLowerCase();
}

/* -------------------------------------------- */

/**
 * Describe a unit for the conditions and numbers of its skills as a staff is used.
 * @param {StaffUnit} unit
 * @param {{name?: string}|null} [staff]    The staff in its hand, for the unit that uses it
 * @returns {object}
 */
function viewOf(unit, staff = null) {
  return {
    hp: unit.hp ?? 0,
    hpMax: unit.hpMax ?? unit.hp ?? 0,
    level: unit.level ?? 1,
    tier: unit.tier,
    stats: unit.stats ?? {},
    conditions: unit.conditions ?? {},
    weapon: staff ? { name: staff.name ?? "", category: "staff" } : null,
    near: unit.near ?? null
  };
}

/* -------------------------------------------- */

/**
 * A unit uses a staff, on another unit, on every ally it catches or on nobody in particular. A staff that
 * heals restores HP: to the unit it is used on, to its user where a skill lets it be its own target, or to
 * each ally a staff for several units catches. The user's skills that wait for a staff to be used take effect,
 * for each unit the staff did its part to. What else the staff does (see `staffPlan`) is for whoever called
 * to apply to those units.
 *
 * Where the world plays with the Additional Staff Effects and a d100 is given, a staff that is not used
 * against an enemy rolls to succeed, once for each unit of a staff for several; a cast that heals rolls for a
 * Heal Critical; and a staff that heals one unit rolls to be cast a second time at once, unless its target is
 * at full HP by then. The second cast rolls to succeed and for a critical like the first. A staff of which
 * every cast missed does nothing, and the user's skills that wait for a staff to be used take no effect.
 *
 * An Offensive Staff used on an enemy rolls to hit it wherever a d100 is given, whatever the world plays with:
 * Offensive Staff Hit against Offensive Staff Avoid. One for each enemy in range rolls for each of them.
 * @param {object} cast
 * @param {{name?: string, sheetName?: string, effect?: string, range?: string|number, hit?: number}} cast.staff
 *        `sheetName` is the name the Reference Sheet gives it, where it goes by another
 * @param {StaffUnit} cast.caster               The unit that uses it, which is in its own turn
 * @param {StaffUnit|null} [cast.target]        The unit it is used on
 * @param {StaffUnit[]} [cast.targets]          The units a staff for several is used on, where only their names
 *                                              are known
 * @param {StaffUnit[]|null} [cast.patients]    The units a staff for several allies catches on the map, each
 *                                              with its `id` and its `distance`, marked `ally`, or `self` for
 *                                              the user where a skill has its staves for several target it too
 * @param {StaffUnit[]} [cast.enemies]          The user's enemies on the map, each with its `distance`, for a
 *                                              staff for each enemy in range
 * @param {number|null} [cast.distance]         Tiles between the two, if that is known
 * @param {(() => number)|null} [cast.d100]     Returns a whole number from 1 to 100
 * @param {object} [cast.rules]                 FEO.optional
 * @returns {StaffCast}
 */
export function castStaff({ staff, caster, target = null, targets = [], patients = null, enemies = [], distance = null, d100 = null, rules = FEO.optional }) {
  const self = viewOf(caster, staff);
  const plan = staffPlan(staff, caster.stats);

  // The allies a staff for several units catches, the nearest first: the user itself is none of them, though
  // it may be healed with them
  const caught = (plan.on === "allies") ? (patients ?? null) : null;
  const allies = (caught ?? []).filter((unit) => unit.ally && !unit.self).sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  const first = target ?? allies[0] ?? null;
  const fight = {
    role: "initiating",
    distance: distance ?? first?.distance ?? 1,
    foe: first ? { ...viewOf(first), qualities: first.qualities ?? "", afflicted: Object.keys(first.conditions ?? {}).length > 0 } : viewOf({ hp: 0, hpMax: 0 })
  };
  const mine = staffBends(caster.skills, self, first ? fight : null);
  const theirs = target ? staffBends(target.skills, viewOf(target), null) : null;
  const ally = !!target?.ally || (allies.length > 0);

  // A unit whose skill lets it be the target of its own staves is, when a staff for one ally is used on nobody
  const selfCast = !target && !!mine.rules.selfStaff && (plan.on === "unit") && (plan.side !== "offensive") && !plan.warp
    && !plan.again && !plan.steals;
  const healing = staffHealing(staff?.effect, caster.stats);
  const missing = (unit) => Math.max((unit.hpMax ?? 0) - Math.max(unit.hp ?? 0, 0), 0);
  const result = {
    patient: target ? "target" : selfCast ? "self" : null,
    heal: null,
    user: null,
    units: null,
    mend: null,
    moments: [],
    freeUse: mine.rules.staffFreeUses ?? null,
    reach: staffReach(staff?.range, caster.stats, mine.ranges),
    casts: [],
    double: null,
    reached: null,
    aim: null,
    missed: false,
    follow: null
  };

  // The Additional Staff Effects in use, which all need a die. A chance that leaves nothing to roll rolls
  // nothing
  const using = d100 ? rules : {};
  const roll = (chance) => {
    if ( (chance >= 100) || (chance <= 0) ) return { roll: null, chance, success: chance >= 100 };
    const rolled = d100();
    return { roll: rolled, chance, success: rolled <= chance };
  };

  // Staff Missing: a staff that is not used against an enemy has a chance to succeed, unless its Effect says
  // that it cannot miss an ally
  const several = forSeveral(staff?.effect);
  if ( using.staffMissing?.enabled ) {
    const side = staffSide({ name: staff?.sheetName ?? staff?.name, effect: staff?.effect }, rules.staffMissing);
    const friendly = (side === "friendly") || ((side === "either") && (!target || ally));
    const sure = /\bguaranteed\s+to\s+hit\s+against\s+allies\b/i.test(String(staff?.effect ?? ""));
    if ( friendly && !sure ) {
      const units = !several ? [] : caught ? caught : targets.length ? targets : target ? [target] : [];
      result.aim = { rate: staffHitRate(staff, caster.stats, caster.hitBonus, rules.staffMissing), each: several && !units.length && !caught };
      if ( units.length ) result.reached = units.map((unit) => ({ id: unit.id ?? null, name: unit.name ?? "", ...roll(result.aim.rate) }));
    }
  }
  const landed = (part) => !part.hit || part.hit.success;

  // An Offensive Staff has to hit the enemy it is used on: Offensive Staff Hit against that enemy's Offensive
  // Staff Avoid at the distance between the two. A staff for each enemy in range rolls for each of them. This
  // is no Additional Staff Effect: it is rolled wherever a die is given and the two stand on a map
  const offensive = staffSide({ name: staff?.sheetName ?? staff?.name, effect: staff?.effect }, rules.staffMissing) !== "friendly";
  let offence = null;
  if ( offensive && d100 && Number.isFinite(caster.staffHit) ) {
    const within = (unit) => !result.reach || ((unit.distance >= Math.max(result.reach.min, 1)) && (unit.distance <= result.reach.max));
    const foes = forEachEnemy(staff?.effect) ? (enemies ?? []).filter((unit) => Number.isFinite(unit.distance) && within(unit)) : [];
    if ( foes.length ) {
      result.reached = foes.map((unit) => ({
        id: unit.id ?? null, name: unit.name ?? "", offensive: true, ...roll(offensiveStaffChance(caster.staffHit, unit.staffAvoid, unit.distance))
      }));
    }
    else if ( target?.enemy && (distance !== null) ) offence = roll(offensiveStaffChance(caster.staffHit, target.staffAvoid, distance));
  }

  // The user's skills that wait for a staff to be used. One may ask for the staff to be used on an ally, or
  // to restore HP to one. One that is rolled for rolls once, before the staff heals, as it may heal more
  const waiting = [];
  for ( const skill of caster.skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc?.on !== "staff" ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( effect.proc.ally && !ally ) continue;

      // One may ask for the staff to be used against an enemy, or for a staff with a certain Range
      if ( effect.proc.foe && !target?.enemy && !(result.reached ?? []).some((unit) => unit.offensive) ) continue;
      if ( effect.proc.reach && (rangeText(effect.proc.reach) !== rangeText(staff?.range)) ) continue;
      const hurt = caught ? allies.some((unit) => missing(unit) > 0) : (!healing?.area && target && (missing(target) > 0));
      if ( effect.proc.heals && !(healing && hurt) ) continue;

      // A staff for several units gives nobody its Action back: that is for the one unit a staff is used on
      if ( effect.refreshes && caught ) continue;
      if ( !holds(effect.when, self, fight) ) continue;
      let rolled = null;
      if ( !effect.proc.sure ) {
        const chance = chanceOf(effect.proc, self, null, { activation: caster.activation ?? 0, always: !!caster.always });
        const die = ((chance > 0) && (chance < 100) && d100) ? d100() : null;
        rolled = { roll: die, chance, success: (chance >= 100) || ((die !== null) && (die <= chance)) };
      }
      waiting.push({ skill: skill.name, effect, rolled });
    }
  }

  // HP such a skill has a staff that heals one unit restore on top
  const boosts = waiting.filter(({ effect, rolled }) => (effect.healPlus !== undefined) && (!rolled || rolled.success))
    .map(({ skill, effect }) => ({ skill, amount: readNumber(effect.healPlus, self, null) })).filter((boost) => boost.amount > 0);
  const boosted = boosts.reduce((sum, boost) => sum + boost.amount, 0);

  // Healing, for a staff that heals one unit. What a skill adds for allies is rounded down
  let restored = 0;
  if ( healing && !healing.area && (target || selfCast) ) {
    const patient = target ?? caster;
    const skills = [];
    const by = [];
    const left = { patient: missing(patient), user: missing(caster) };
    if ( !healing.full ) {
      if ( mine.plus ) skills.push(...mine.by.plus);
      for ( const boost of boosts ) if ( !skills.includes(boost.skill) ) skills.push(boost.skill);
      if ( ally && mine.more ) skills.push(...mine.by.more);
    }
    if ( target && healing.user ) {
      if ( mine.both ) by.push(...mine.by.both);
      if ( ally && theirs.healerBoth ) by.push(...theirs.by.healerBoth);
    }
    else if ( target ) {
      if ( mine.echo ) by.push(...mine.by.echo);
      else if ( ally && theirs.healer ) by.push(...theirs.by.healer);
    }
    const critical = (using.healCriticals?.enabled && !healing.full) ? healCritChance(caster.stats, rules.healCriticals) : null;

    // One cast: its roll to succeed, the HP it restores to its target, tripled by a Heal Critical, and what
    // the user regains itself: its share of a staff that heals both, raised by the skills that say so, or the
    // HP its target regained where a skill of either unit has it heal the same
    const once = () => {
      const part = { hit: result.aim ? roll(result.aim.rate) : null, critical: null, amount: 0, restored: 0, own: null };
      if ( !landed(part) ) return part;
      part.amount = left.patient;
      if ( !healing.full ) {
        part.amount = healing.amount + mine.plus + boosted;
        if ( ally && mine.more ) part.amount = Math.floor(((part.amount * (100 + mine.more)) / 100) + 1e-9);
        if ( critical !== null ) {
          part.critical = roll(critical);
          if ( part.critical.success ) part.amount *= rules.healCriticals.times;
        }
      }
      part.restored = Math.min(part.amount, left.patient);
      left.patient -= part.restored;
      if ( target ) {
        let own = 0;
        if ( healing.user ) {
          const bonus = mine.both + (ally ? theirs.healerBoth : 0);
          own = healing.full ? left.user : Math.floor((((healing.amount + mine.plus) * (100 + bonus)) / 100) + 1e-9);
        }
        else {
          const share = Math.max(mine.echo, ally ? theirs.healer : 0);
          own = Math.floor(((part.restored * share) / 100) + 1e-9);
        }
        part.own = { amount: own, restored: Math.min(own, left.user) };
        left.user -= part.own.restored;
      }
      return part;
    };
    result.casts.push(once());

    // Double-Cast: the staff may be cast a second time at once, unless its target is at full HP by then
    if ( using.doubleCast?.enabled && (left.patient > 0) ) {
      result.double = roll(doubleCastChance(caster.stats, rules.doubleCast));
      if ( result.double.success ) result.casts.push(once());
    }

    const hits = result.casts.filter(landed);
    const sum = (key, parts) => parts.reduce((total, part) => total + (part?.[key] ?? 0), 0);
    restored = sum("restored", hits);
    result.patient = target ? "target" : "self";
    if ( hits.length ) result.heal = { amount: sum("amount", hits), restored, full: healing.full, skills };
    const own = hits.map((part) => part.own);
    if ( target && hits.length && (healing.user || (sum("amount", own) > 0)) ) {
      result.user = { amount: sum("amount", own), restored: sum("restored", own), skills: by };
    }
  }

  // A staff that heals every ally it catches: each regains what the staff heals for, as the user's skills make
  // it, where the staff reached it, and a cast that heals may be a Heal Critical for each. The user itself, where
  // a skill has its staves for several target it too, is healed like them, but not for the share its skills
  // add for allies. What the user regains for healing, by a skill of its own or of an ally healed, it regains
  // once: as much as the ally that regained the most
  else if ( healing && caught ) {
    const reachedBy = (unit) => (result.reached ?? []).find((entry) => entry.id === unit.id) ?? null;
    const critical = (using.healCriticals?.enabled && !healing.full) ? healCritChance(caster.stats, rules.healCriticals) : null;
    const skills = [];
    if ( !healing.full ) {
      if ( mine.plus ) skills.push(...mine.by.plus);
      for ( const boost of boosts ) if ( !skills.includes(boost.skill) ) skills.push(boost.skill);
      if ( mine.more && allies.length ) skills.push(...mine.by.more);
    }
    result.units = caught.map((unit) => {
      const hit = reachedBy(unit);
      const part = { id: unit.id ?? null, name: unit.name ?? "", self: !!unit.self, landed: !hit || hit.success, critical: null, amount: 0, restored: 0, full: healing.full };
      if ( !part.landed ) return part;
      part.amount = missing(unit);
      if ( !healing.full ) {
        part.amount = healing.amount + mine.plus + boosted;
        if ( !unit.self && mine.more ) part.amount = Math.floor(((part.amount * (100 + mine.more)) / 100) + 1e-9);
        if ( critical !== null ) {
          part.critical = roll(critical);
          if ( part.critical.success ) part.amount *= rules.healCriticals.times;
        }
      }
      part.restored = Math.min(part.amount, missing(unit));
      return part;
    });
    const healed = result.units.filter((part) => part.landed && !part.self);
    restored = healed.reduce((most, part) => Math.max(most, part.restored), 0);
    result.heal = { amount: restored, restored, full: healing.full, skills, several: true };

    // The user's share: once, and not for a user the staff heals with the others
    if ( !caught.some((unit) => unit.self) ) {
      const by = [];
      let share = mine.echo;
      if ( mine.echo ) by.push(...mine.by.echo);
      else for ( const unit of allies ) {
        const bends = staffBends(unit.skills, viewOf(unit), null);
        if ( !(bends.healer > share) || !healed.some((part) => (part.id === unit.id) && (part.restored > 0)) ) continue;
        share = bends.healer;
        by.splice(0, by.length, ...bends.by.healer);
      }
      const own = Math.floor(((restored * share) / 100) + 1e-9);
      if ( own > 0 ) result.user = { amount: own, restored: Math.min(own, missing(caster)), skills: by };
    }
  }

  // Any other staff for one unit, or for nobody in particular, is cast once
  else if ( result.aim && !several ) result.casts.push({ hit: roll(result.aim.rate), critical: null, amount: 0, restored: 0, own: null });

  // And so is an Offensive Staff used on one enemy, with the roll it made to hit. A unit whose skill lets it
  // follow up with staves casts it a second time at once, with a roll of its own, where it has the Attack
  // Speed a follow-up takes: a staff that inflicts a condition only if the first cast missed
  else if ( offence ) {
    result.casts.push({ hit: offence, offensive: true, critical: null, amount: 0, restored: 0, own: null });
    const again = staffFollows({
      follow: mine.follow,
      speed: caster.attackSpeed,
      foeSpeed: target.attackSpeed,
      haste: caster.haste ?? 0,
      area: forEachEnemy(staff?.effect),
      status: !dealsDamage(staff?.effect),
      landed: offence.success
    });
    if ( again ) {
      result.follow = mine.by.follow.join(", ");
      result.casts.push({
        hit: roll(offensiveStaffChance(caster.staffHit, target.staffAvoid, distance)), offensive: true, follow: true, critical: null, amount: 0, restored: 0, own: null
      });
    }
  }
  result.missed = result.reached ? ((result.reached.length > 0) && result.reached.every((unit) => !unit.success))
    : (result.casts.length > 0) && !result.casts.some(landed);

  // What a staff restores over the turns that follow: to an ally with the share the user's skills add
  if ( plan.mend ) {
    const more = mine.more ? Math.floor(((plan.mend.amount * (100 + mine.more)) / 100) + 1e-9) : plan.mend.amount;
    result.mend = { amount: more, own: plan.mend.amount, turns: plan.mend.turns };
  }

  // The units the staff did its part to, for the skills that waited: the one it was used on, or every ally a
  // staff for several units reached, each with the HP it regained
  const reachedOn = (unit) => (result.reached ?? []).find((entry) => entry.id === unit.id)?.success ?? true;
  const served = caught
    ? allies.filter(reachedOn).map((unit) => ({ unit, restored: result.units?.find((part) => part.id === unit.id)?.restored ?? 0 }))
    : target ? [{ unit: target, restored: ally ? restored : 0 }] : [];

  // The user's skills that waited for the staff to be used now take effect, unless every cast missed. One
  // that rolled and failed only shows its roll
  const view = { ...self, healed: ally ? restored : 0 };
  for ( const { skill, effect, rolled } of result.missed ? [] : waiting ) {
    if ( effect.proc.heals && !(view.healed > 0) ) continue;
    const entry = { skill, remind: !!effect.remind, granted: [] };

    // A Refresh the skill hands out as the staff is used (see `refresh.mjs`), for whoever called to see to
    if ( effect.refreshes ) entry.refreshes = { ...effect.refreshes };
    if ( rolled ) entry.roll = rolled;
    if ( rolled && !rolled.success ) {
      if ( rolled.roll !== null ) result.moments.push({ ...entry, remind: false });
      continue;
    }

    // Changes that last a while, for the user or for the unit the staff is used on. One whose numbers all
    // come to nothing is not granted. One for the unit the staff is used on is for each ally a staff for
    // several units reached: for each it restored HP to, where the skill asks for that
    for ( const grant of [].concat(effect.grant ?? []) ) {
      const to = (grant.to === "target") ? "target" : "self";
      const carriers = (to === "self") ? [null]
        : served.filter((entry) => !effect.proc.heals || (entry.restored > 0)).map((entry) => entry.unit);
      for ( const carrier of carriers ) {
        const effects = resolveGiven(grant.effects ?? [], view);
        const empty = effects.every((part) => Object.entries(part).every(([key, value]) => {
          return (key === "stats") && Object.values(value ?? {}).every((amount) => amount === 0);
        }));
        if ( empty ) continue;
        entry.granted.push({
          to,
          id: carrier?.id ?? null,
          name: carrier ? (carrier.name ?? "") : (caster.name ?? ""),
          change: buildChange({ ...grant, effects }, {
            skill: skill,
            from: caster.name ?? "",
            giver: caster.uuid ?? "",
            own: to === "self",
            giverInTurn: true,
            carrierInTurn: to === "self"
          })
        });
      }
    }
    if ( entry.remind || entry.granted.length || entry.refreshes || (entry.roll && (entry.roll.roll !== null)) ) result.moments.push(entry);
  }
  return result;
}

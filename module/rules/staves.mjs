/**
 * Staves for Fire Emblem Online: what using a staff on a unit does that the system applies by itself, and what
 * the skills of the two units make of it. A staff whose Effect heals one target restores that much HP, and one
 * that warps an ally or its user sets that unit down on a tile chosen on the map (see `warp.mjs`); every other
 * Effect stays on the staff's card for the table. Pure functions of plain data, so that they can be tested
 * outside of Foundry.
 *
 * Skills speak to it with the parts explained at the top of `skills.mjs`: `staffHeal`, `staffHealed`,
 * `staffRange`, the rules `selfStaff` and `staffFreeUses`, and the moment `staff`.
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
import { chanceOf, holds, readNumber, resolveGiven } from "./skills.mjs";
import { buildChange } from "./timed.mjs";

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
 */

/**
 * @typedef StaffCast
 * What using a staff did.
 * @property {"target"|"self"|null} patient           Who the staff healed, if it heals one unit
 * @property {{amount: number, restored: number, full: boolean, skills: string[]}|null} heal
 *           What the staff heals for, the HP the patient regains, and the skills that raised the amount
 * @property {{amount: number, restored: number, skills: string[]}|null} user
 *           The HP the user itself regains: from a staff that heals user and target, or by a skill
 * @property {{skill: string, remind: boolean, granted: {to: "self"|"target", name: string, change: TimedChange}[],
 *   harm: {amount: number, within: number, seen: boolean, units: {id: string, name: string, hp: number}[]}|null}[]} moments
 *           The skills that took effect as the staff was used: what they announce, the changes that last a
 *           while which they grant, and the damage they deal to the nearest enemy of the unit healed
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
 * critical with each cast, and one for the second cast itself. None while the world plays with none of this.
 * @param {number} [units]        The units a staff for several is used on
 * @param {object} [rules]        FEO.optional
 * @returns {number}
 */
export function staffDice(units = 1, rules = FEO.optional) {
  const used = rules.staffMissing?.enabled || rules.healCriticals?.enabled || rules.doubleCast?.enabled;
  return used ? Math.max(units, 2) + 3 : 0;
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
  if ( /^(?:heals?|restores?)\s+all\s+HP\b/i.test(first) ) return { amount: null, full: true, user: false, area };
  const match = first.match(/^heals?\s+(?:(user\s+and\s+target|target)\s+)?(?:all\s+(?:adjacent\s+)?allies\s+)?(?:by\s+|for\s+)?(\d+)\s*\+\s*MAG(?:\s*\/\s*(\d+))?/i);
  if ( !match ) return null;
  const amount = Number(match[2]) + Math.floor(Math.max(stats.mag ?? 0, 0) / (match[3] ? Number(match[3]) : 1));
  return { amount, full: false, user: /^user/i.test(match[1] ?? ""), area };
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
    more: 0, plus: 0, echo: 0, both: 0, healer: 0, healerBoth: 0, ranges: [], rules: {},
    by: { more: [], plus: [], echo: [], both: [], healer: [], healerBoth: [], range: [] }
  };
  const add = (key, amount, name) => {
    if ( !amount ) return;
    bends[key] += amount;
    if ( !bends.by[key].includes(name) ) bends.by[key].push(name);
  };
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc || effect.aura ) continue;
      if ( !effect.staffHeal && !effect.staffHealed && !effect.staffRange && !effect.rules ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self, fight) ) continue;
      add("more", effect.staffHeal?.more, skill.name);
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
    stats: unit.stats ?? {},
    conditions: unit.conditions ?? {},
    weapon: staff ? { name: staff.name ?? "", category: "staff" } : null,
    near: unit.near ?? null
  };
}

/* -------------------------------------------- */

/**
 * A unit uses a staff, on another unit or on nobody in particular. A staff that heals one unit restores its
 * HP: to the unit it is used on, or to its user where a skill lets it be its own target. The user's skills
 * that wait for a staff to be used take effect.
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
 * @param {StaffUnit[]} [cast.targets]          The units a staff for several is used on
 * @param {StaffUnit[]} [cast.enemies]          The user's enemies on the map, each with its `distance`, for a
 *                                              staff for each enemy in range
 * @param {number|null} [cast.distance]         Tiles between the two, if that is known
 * @param {(() => number)|null} [cast.d100]     Returns a whole number from 1 to 100
 * @param {object} [cast.rules]                 FEO.optional
 * @returns {StaffCast}
 */
export function castStaff({ staff, caster, target = null, targets = [], enemies = [], distance = null, d100 = null, rules = FEO.optional }) {
  const self = viewOf(caster, staff);
  const fight = {
    role: "initiating",
    distance: distance ?? 1,
    foe: target ? { ...viewOf(target), qualities: target.qualities ?? "", afflicted: Object.keys(target.conditions ?? {}).length > 0 } : viewOf({ hp: 0, hpMax: 0 })
  };
  const mine = staffBends(caster.skills, self, target ? fight : null);
  const theirs = target ? staffBends(target.skills, viewOf(target), null) : null;
  const ally = !!target?.ally;
  const selfCast = !target && !!mine.rules.selfStaff;
  const healing = staffHealing(staff?.effect, caster.stats);
  const missing = (unit) => Math.max((unit.hpMax ?? 0) - Math.max(unit.hp ?? 0, 0), 0);
  const result = {
    patient: null,
    heal: null,
    user: null,
    moments: [],
    freeUse: mine.rules.staffFreeUses ?? null,
    reach: staffReach(staff?.range, caster.stats, mine.ranges),
    casts: [],
    double: null,
    reached: null,
    aim: null,
    missed: false
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
      const units = !several ? [] : targets.length ? targets : target ? [target] : [];
      result.aim = { rate: staffHitRate(staff, caster.stats, caster.hitBonus, rules.staffMissing), each: several && !units.length };
      if ( units.length ) result.reached = units.map((unit) => ({ name: unit.name ?? "", ...roll(result.aim.rate) }));
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
        name: unit.name ?? "", offensive: true, ...roll(offensiveStaffChance(caster.staffHit, unit.staffAvoid, unit.distance))
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
      if ( effect.proc.heals && !(healing && !healing.area && target && (missing(target) > 0)) ) continue;
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

  // Any other staff for one unit, or for nobody in particular, is cast once
  else if ( result.aim && !several ) result.casts.push({ hit: roll(result.aim.rate), critical: null, amount: 0, restored: 0, own: null });

  // And so is an Offensive Staff used on one enemy, with the roll it made to hit
  else if ( offence ) result.casts.push({ hit: offence, offensive: true, critical: null, amount: 0, restored: 0, own: null });
  result.missed = result.reached ? result.reached.every((unit) => !unit.success)
    : (result.casts.length > 0) && !result.casts.some(landed);

  // The user's skills that waited for the staff to be used now take effect, unless every cast missed. One
  // that rolled and failed only shows its roll
  const view = { ...self, healed: (target && ally) ? restored : 0 };
  for ( const { skill, effect, rolled } of result.missed ? [] : waiting ) {
    if ( effect.proc.heals && !(view.healed > 0) ) continue;
    const entry = { skill, remind: !!effect.remind, granted: [], harm: null };
    if ( rolled ) entry.roll = rolled;
    if ( rolled && !rolled.success ) {
      if ( rolled.roll !== null ) result.moments.push({ ...entry, remind: false });
      continue;
    }

    // Changes that last a while, for the user or for the unit the staff is used on. One whose numbers all
    // come to nothing is not granted
    for ( const grant of [].concat(effect.grant ?? []) ) {
      const to = (grant.to === "target") ? "target" : "self";
      if ( (to === "target") && !target ) continue;
      const effects = resolveGiven(grant.effects ?? [], view);
      const empty = effects.every((part) => Object.entries(part).every(([key, value]) => {
        return (key === "stats") && Object.values(value ?? {}).every((amount) => amount === 0);
      }));
      if ( empty ) continue;
      entry.granted.push({
        to,
        name: (to === "self") ? (caster.name ?? "") : (target.name ?? ""),
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

    // Damage to the enemy nearest to the unit healed: a share of the HP restored, rounded down. Where
    // several stand equally near, the table picks
    if ( effect.harmNear && target ) {
      const within = effect.harmNear.within ?? 1;
      const amount = Math.floor(((view.healed * (effect.harmNear.percent ?? 100)) / 100) + 1e-9);
      const enemies = (target.near?.others ?? []).filter((other) => {
        return (other.relation === "enemy") && (other.distance <= within) && ((other.hp ?? 1) > 0);
      });
      const nearest = enemies.filter((other) => other.distance === enemies[0].distance);
      if ( (amount > 0) && (!target.near || nearest.length) ) entry.harm = {
        amount,
        within,
        seen: !!target.near,
        units: nearest.map((other) => ({ id: other.id, name: other.name, hp: other.hp ?? 0 }))
      };
    }
    if ( entry.remind || entry.granted.length || entry.harm || (entry.roll && (entry.roll.roll !== null)) ) result.moments.push(entry);
  }
  return result;
}

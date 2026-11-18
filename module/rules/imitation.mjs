/**
 * Imitation for Fire Emblem Online: a unit that takes on the attributes of another for a number of turns, and
 * is itself again afterwards. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill used as an action has its unit imitate the unit it is used on with an `imitates` part of its `act`
 * (see `actions.mjs`):
 *
 *   act: {
 *     target: { who: "ally", within: 1 },
 *     imitates: {
 *       turns: 5,                        // of its unit's turn starts until it is itself again; the skill's
 *                                        // cooldown starts then, and not as it is used
 *       not: ["laguz", "manakete"],      // the peoples it cannot imitate: a unit whose class is of one of
 *                                        // them, that changes form as they do, or that has the Special
 *                                        // Quality of that name
 *       rules: ["noSong"]                // rules its unit is under for as long as it imitates
 *     }
 *   }
 *
 * and another skill of the unit speaks of its imitation with a part that is always there:
 *
 *   imitation: {
 *     turns: 1,                          // it lasts so many turns longer
 *     effects: [{ stats: { str: 2 } }],  // what its unit has while it imitates, in the notation of skill
 *                                        // effects: a `when` in them asks the unit as it then stands
 *     keeps: { share: 50, stats: ["str", "mag"], turns: 1 }
 *                                        // once it is itself again it keeps this share, in percent and rounded
 *                                        // down, of what imitating had added to each of these stats, until so
 *                                        // many of its turns have started
 *   }
 *
 * What is taken on is everything that makes a unit what it is on the map: its maximum HP, its stats with their
 * boosts and caps, Charm and Intelligence, its class with all that hangs on it, its Weight, its weapon ranks,
 * its Special Qualities, its skills, and the flat adjustments to its combat stats. What stays the unit's own is
 * what it has rather than what it is: its HP, its level and experience, its growth rates, what it carries, its
 * Gold, its supports and Affinity, its Wounds, its conditions and the changes that last on it, and the skills
 * that speak of imitation, which are what it imitates with.
 *
 * Nothing of the unit's own is written over. What it took on is kept beside it as a note, and laid over its
 * own numbers each time they are read (see `overlay`); the skills and the class it took on are Items marked as
 * such, and its own skills are set aside in the same way. So it is itself again, exactly, as soon as the note
 * and those Items are gone, whatever became of the unit it imitated meanwhile.
 */
import { FEO } from "../config.mjs";

/** What an `imitates` part can say, and an `imitation` part, and what the latter keeps. */
export const IMITATES_PARTS = ["turns", "not", "rules"];
export const IMITATION_PARTS = ["turns", "effects", "keeps"];
export const KEEPS_PARTS = ["share", "stats", "turns"];

/** The flag a unit keeps its imitation under, and the one that marks the Items it took on. */
export const IMITATION_FLAG = "imitation";
export const IMITATED_FLAG = "imitated";

/**
 * @typedef Taken
 * What a unit takes on of another: plain data in the shape of a unit's own.
 * @property {{max: number, cap: number|null}} hp
 * @property {Record<string, {base: number, boost: number, cap: number|null}>} stats
 * @property {Record<string, {source: string, increase: number, boost: number}>} abilities
 * @property {{class: number}} wt
 * @property {Record<string, number>} combatBoosts
 * @property {Record<string, string>} calc
 * @property {Record<string, {rank: string, wexp: number}>} proficiencies
 * @property {string} specialQualities
 * @property {string} className
 * @property {string} boon
 * @property {string} bane
 * @property {{base: number}} weaponLevel
 * @property {number} fcm
 * @property {number} movementStars
 */

/**
 * @typedef ImitationBends
 * What a unit's other skills change about its imitation.
 * @property {number} turns           Turns it lasts longer
 * @property {object[]} effects       What the unit has while it imitates
 * @property {{share: number, stats: string[], turns: number}|null} keeps     What it keeps for a while afterwards
 * @property {string[]} skills        The skills that had a say
 */

const plain = (value) => !!value && (typeof value === "object") && !Array.isArray(value);
const copy = (value) => (value === undefined) ? undefined : JSON.parse(JSON.stringify(value));

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

/**
 * The `imitates` part of a skill, if it has one: of the ways it says what it does, the first.
 * @param {{effects?: object[]}|null} skill
 * @returns {object|null}
 */
export function imitatesOf(skill) {
  for ( const effect of skill?.effects ?? [] ) {
    if ( plain(effect?.act?.imitates) ) return effect.act.imitates;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Does a skill speak of imitation: is it what its unit imitates with, or does it change that? Such a skill
 * stays its unit's own while the unit imitates another, and is not among the skills that are taken on.
 * @param {object[]} [effects]      The skill's effects
 * @returns {boolean}
 */
export function speaksOfImitation(effects) {
  return (effects ?? []).some((effect) => plain(effect?.imitation) || plain(effect?.act?.imitates));
}

/* -------------------------------------------- */

/**
 * What a unit's skills change about its imitation: every `imitation` part among their effects. Such a part is
 * always there.
 * @param {{name: string, effects?: object[]}[]} skills     The unit's equipped skills
 * @returns {ImitationBends}
 */
export function imitationBends(skills) {
  const bends = { turns: 0, effects: [], keeps: null, skills: [] };
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      const part = effect?.imitation;
      if ( !plain(part) || effect.proc || effect.aura ) continue;
      if ( Number.isInteger(part.turns) ) bends.turns += part.turns;
      if ( Array.isArray(part.effects) ) bends.effects.push(...copy(part.effects));
      if ( plain(part.keeps) ) {
        const keeps = {
          share: Number.isFinite(part.keeps.share) ? part.keeps.share : 50,
          stats: Array.isArray(part.keeps.stats) ? [...part.keeps.stats] : [],
          turns: Number.isInteger(part.keeps.turns) ? part.keeps.turns : 1,
          skill: skill.name
        };

        // Of several that keep something, the one that keeps the most
        if ( !bends.keeps || (keeps.share > bends.keeps.share) ) bends.keeps = keeps;
      }
      if ( !bends.skills.includes(skill.name) ) bends.skills.push(skill.name);
    }
  }
  return bends;
}

/* -------------------------------------------- */

/**
 * Why a unit cannot be imitated, if it cannot: it is of a people the skill does not imitate, it changes form
 * as those peoples do, or it has the Special Quality named after one of them.
 * @param {object} imitates                   The skill's `imitates` part
 * @param {object} target
 * @param {string} [target.race]              The people of its class, a key of FEO.races
 * @param {string|null} [target.shifts]       How it changes form, if it does: "gauge" or "stone"
 * @param {string} [target.qualities]         Its Special Qualities, as free text
 * @returns {{why: "people", people: string}|null}      Null for a unit that can be
 */
export function imitateBar(imitates, { race = "", shifts = null, qualities = "" } = {}) {
  const barred = (imitates?.not ?? []).map((people) => String(people).toLowerCase());
  if ( !barred.length ) return null;
  if ( race && barred.includes(String(race).toLowerCase()) ) return { why: "people", people: String(race).toLowerCase() };

  // A unit that changes form without a class to say so is of one of the peoples that do
  if ( shifts ) {
    const people = Object.entries(FEO.shift.byRace).find(([name, mode]) => (mode === shifts) && barred.includes(name))?.[0];
    if ( people ) return { why: "people", people };
  }
  for ( const people of barred ) {
    if ( new RegExp(`(^|[^a-z])${people}([^a-z]|$)`, "i").test(qualities ?? "") ) return { why: "people", people };
  }
  return null;
}

/* -------------------------------------------- */
/*  Taking On and Laying Over                   */
/* -------------------------------------------- */

/**
 * What is taken on of a unit, from its data as it is saved: plain data that no longer hangs on that unit.
 * @param {object} system               The unit's saved data
 * @param {object} [options]
 * @param {string} [options.className]  The name of its class, where an Item gives it
 * @returns {Taken}
 */
export function takenFrom(system, { className = null } = {}) {
  const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const cap = (value) => Number.isFinite(value) ? value : null;
  return {
    hp: { max: number(system?.hp?.max), cap: cap(system?.hp?.cap) },
    stats: Object.fromEntries(Object.keys(FEO.stats).map((key) => {
      const stat = system?.stats?.[key] ?? {};
      return [key, { base: number(stat.base), boost: number(stat.boost), cap: cap(stat.cap) }];
    })),
    abilities: Object.fromEntries(Object.keys(FEO.abilities).map((key) => {
      const ability = system?.abilities?.[key] ?? {};
      return [key, { source: ability.source ?? FEO.abilities[key].sources[0], increase: number(ability.increase), boost: number(ability.boost) }];
    })),
    wt: { class: number(system?.wt?.class) },
    combatBoosts: Object.fromEntries(Object.keys(FEO.combatBoosts).map((key) => [key, number(system?.combatBoosts?.[key])])),
    calc: Object.fromEntries(Object.keys(FEO.calcModes).map((key) => [key, system?.calc?.[key] ?? "normal"])),
    proficiencies: Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => {
      const proficiency = system?.proficiencies?.[key] ?? {};
      return [key, { rank: (proficiency.rank in FEO.ranks) ? proficiency.rank : "F", wexp: number(proficiency.wexp) }];
    })),
    specialQualities: String(system?.specialQualities ?? ""),
    className: String(className ?? system?.className ?? ""),
    boon: String(system?.boon ?? ""),
    bane: String(system?.bane ?? ""),
    weaponLevel: { base: number(system?.weaponLevel?.base, FEO.optional.weaponLevel.start) },
    fcm: number(system?.fcm, FEO.optional.followUpCritical.base),
    movementStars: number(system?.movementStars)
  };
}

/* -------------------------------------------- */

/**
 * Lay what a unit has taken on over its own data, in place, as it is read: its own is what it was saved as,
 * and stays so. Only what is in the shape of what `takenFrom` gives is laid over, so that a note that was
 * tampered with changes nothing else.
 * @param {object} system               The unit's data, as it is being prepared
 * @param {Taken} taken
 * @param {object} [options]
 * @param {string} [options.classId]    The Item that is the class it took on, on the unit itself; blank for
 *                                      one that has but the name of a class
 * @returns {object}                    The same data
 */
export function overlay(system, taken, { classId = "" } = {}) {
  if ( !plain(system) || !plain(taken) ) return system;
  const fill = (into, from, keys) => {
    if ( !plain(into) || !plain(from) ) return;
    for ( const key of keys ) if ( from[key] !== undefined ) into[key] = copy(from[key]);
  };
  fill(system.hp, taken.hp, ["max", "cap"]);
  for ( const key of Object.keys(system.stats ?? {}) ) fill(system.stats[key], taken.stats?.[key], ["base", "boost", "cap"]);
  for ( const key of Object.keys(system.abilities ?? {}) ) fill(system.abilities[key], taken.abilities?.[key], ["source", "increase", "boost"]);
  fill(system.wt, taken.wt, ["class"]);
  fill(system.combatBoosts, taken.combatBoosts, Object.keys(system.combatBoosts ?? {}));
  fill(system.calc, taken.calc, Object.keys(system.calc ?? {}));
  for ( const key of Object.keys(system.proficiencies ?? {}) ) fill(system.proficiencies[key], taken.proficiencies?.[key], ["rank", "wexp"]);
  fill(system.weaponLevel, taken.weaponLevel, ["base"]);
  fill(system, taken, ["specialQualities", "className", "boon", "bane", "fcm", "movementStars"]);
  system.classId = String(classId ?? "");
  return system;
}

/* -------------------------------------------- */

/**
 * The change that lasts on a unit while it imitates: it carries what the unit is under and has for that
 * while, and counts the turns the imitation has left. When it is gone the unit is itself again.
 * @param {object} imitates             The skill's `imitates` part
 * @param {ImitationBends} [bends]      What the unit's other skills change about it
 * @param {object} [options]
 * @param {string} [options.skill]      The skill it imitates with
 * @returns {{name: string, effects: object[], ends: "turnStart", turns: number}}     A grant (see `timed.mjs`)
 */
export function imitationGrant(imitates, bends = null, { skill = "" } = {}) {
  const rules = (imitates?.rules ?? []).filter((rule) => typeof rule === "string");
  return {
    name: skill,
    effects: [...(rules.length ? [{ rules }] : []), ...copy(bends?.effects ?? [])],
    ends: "turnStart",
    turns: Math.max((imitates?.turns ?? 1) + (bends?.turns ?? 0), 1)
  };
}

/* -------------------------------------------- */

/**
 * The HP of a unit as it takes on another's maximum: its own, as far as that maximum goes. What is above it is
 * set aside, and is the unit's again when it is itself once more.
 * @param {number} hp       Its HP
 * @param {number} max      The maximum it takes on
 * @returns {{value: number, held: number}}
 */
export function heldBack(hp, max) {
  const value = Math.min(Math.max(hp ?? 0, 0), Math.max(max ?? 0, 0));
  return { value: (hp > value) ? value : (hp ?? 0), held: Math.max((hp ?? 0) - value, 0) };
}

/* -------------------------------------------- */

/**
 * The HP of a unit that is itself again: what it has, with what was set aside, up to its own maximum. A unit
 * that is down gains nothing.
 * @param {number} hp       Its HP
 * @param {number} held     What was set aside as it took on a lower maximum
 * @param {number} max      Its own maximum
 * @returns {number}
 */
export function givenBack(hp, held, max) {
  if ( !(hp > 0) || !(held > 0) ) return hp ?? 0;
  return Math.max(Math.min(hp + held, Math.max(max ?? 0, hp)), hp);
}

/* -------------------------------------------- */

/**
 * What a unit keeps for a while of what imitating had added to its stats, as a change that lasts on it.
 * @param {{share: number, stats: string[], turns: number, skill?: string}|null} keeps
 * @param {Record<string, number>} before     Its stats while it imitated
 * @param {Record<string, number>} after      Its stats now that it is itself again
 * @returns {{name: string, effects: object[], ends: "turnStart", turns: number}|null}     A grant, or null
 *          where there is nothing to keep
 */
export function keptGrant(keeps, before, after) {
  if ( !keeps || !(keeps.share > 0) ) return null;
  const stats = {};
  for ( const key of keeps.stats ?? [] ) {
    const gained = (before?.[key] ?? 0) - (after?.[key] ?? 0);
    const kept = Math.floor(((gained * keeps.share) / 100) + 1e-9);
    if ( kept > 0 ) stats[key] = kept;
  }
  if ( !Object.keys(stats).length ) return null;
  return { name: keeps.skill ?? "", effects: [{ stats }], ends: "turnStart", turns: Math.max(keeps.turns ?? 1, 1) };
}

/* -------------------------------------------- */
/*  Hands and Weapon Experience                 */
/* -------------------------------------------- */

/**
 * What a unit has in hand once its weapon ranks have changed, as they do when it imitates and when it is
 * itself again. A weapon in hand that it may still wield stays there. Otherwise it takes up the weapon it is
 * told to prefer, as the one it held before it imitated, or else the first it carries that it may wield.
 * @param {{id: string, equipped: boolean, wields: boolean}[]} weapons      The weapons it carries, in order,
 *                                            and whether it may wield each as it now stands
 * @param {string} [prefer]                   The weapon to take up before any other
 * @returns {{equip: string|null, unequip: string[]}}     The weapon to take in hand, if another than it holds,
 *                                            and those to put away
 */
export function handFor(weapons, prefer = "") {
  const held = (weapons ?? []).filter((weapon) => weapon.equipped);
  if ( held.some((weapon) => weapon.wields) ) return { equip: null, unequip: held.filter((weapon) => !weapon.wields).map((weapon) => weapon.id) };
  const wanted = (weapons ?? []).find((weapon) => weapon.wields && (weapon.id === prefer)) ?? (weapons ?? []).find((weapon) => weapon.wields) ?? null;
  return { equip: wanted?.id ?? null, unequip: held.map((weapon) => weapon.id) };
}

/* -------------------------------------------- */

/**
 * The weapon experience a fight gave a unit that imitates, as its own proficiencies have it. The fight counted
 * it towards the ranks the unit took on, which are not its own to raise: what was earned goes to its own
 * proficiency of the same kind instead, where it has a rank in it.
 * @param {{key: string, amount: number}[]} gains           What each proficiency earned
 * @param {Record<string, {rank: string, wexp: number}>} own      The unit's own proficiencies, as saved
 * @param {(proficiency: {rank: string, wexp: number}, amount: number) => {rank: string, wexp: number}} gain
 *                                            How a proficiency takes weapon experience (`gainWexp`)
 * @returns {Record<string, {rank: string, wexp: number}>}        Its own proficiencies that changed
 */
export function ownWexp(gains, own, gain) {
  const changed = {};
  for ( const { key, amount } of gains ?? [] ) {
    const mine = changed[key] ?? own?.[key];
    if ( !mine || !(amount > 0) || !(mine.rank in FEO.ranks) || (mine.rank === "F") ) continue;
    const { rank, wexp } = gain({ rank: mine.rank, wexp: mine.wexp ?? 0 }, amount);
    if ( (rank !== mine.rank) || (wexp !== (mine.wexp ?? 0)) ) changed[key] = { rank, wexp };
  }
  return changed;
}

/* -------------------------------------------- */
/*  The Note                                    */
/* -------------------------------------------- */

/**
 * A unit's imitation as it is kept on it, made sound: what it took on, of whom, with what, and what has to be
 * put back. Null for anything that is no such note.
 * @param {*} note
 * @returns {object|null}
 */
export function readImitation(note) {
  if ( !plain(note) || !plain(note.taken) ) return null;
  const text = (value) => (typeof value === "string") ? value : "";
  return {
    skill: text(note.skill),
    name: text(note.name),
    of: text(note.of),
    ally: text(note.ally),
    change: text(note.change) || text(note.name),
    taken: note.taken,
    classId: text(note.classId),
    hand: text(note.hand),
    held: Number.isInteger(note.held) ? Math.max(note.held, 0) : 0,
    tokens: Array.isArray(note.tokens) ? note.tokens.filter((entry) => plain(entry) && text(entry.scene) && text(entry.id)) : []
  };
}

/* -------------------------------------------- */

/**
 * Has a unit's imitation run out: does it no longer carry the change that counts its turns?
 * @param {object|null} note                  As `readImitation` gives it
 * @param {{name: string, from?: string}[]} [timed]     The changes that last on the unit
 * @returns {boolean}
 */
export function imitationOver(note, timed) {
  if ( !note ) return false;
  return !(timed ?? []).some((change) => (change?.name === note.change) && !change.from);
}

/* -------------------------------------------- */
/*  Checks                                      */
/* -------------------------------------------- */

/**
 * Check the `imitates` part of an action skill, so that a typing mistake does not pass silently.
 * @param {*} imitates
 * @param {object} [options]
 * @param {string[]} [options.rules]      The rules an effect can carry
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkImitates(imitates, { rules = null } = {}) {
  if ( !plain(imitates) ) return ["\"imitates\" says how long: { turns: 5 }"];
  const problems = [];
  for ( const key of Object.keys(imitates) ) if ( !IMITATES_PARTS.includes(key) ) problems.push(`"imitates" cannot say "${key}"`);
  if ( !(Number.isInteger(imitates.turns) && (imitates.turns >= 1)) ) problems.push("\"imitates\" lasts a whole number of turns");
  if ( imitates.not !== undefined ) {
    if ( !Array.isArray(imitates.not) || !imitates.not.length || imitates.not.some((people) => !(people in FEO.races)) ) {
      problems.push(`the "not" of "imitates" lists peoples: ${Object.keys(FEO.races).join(", ")}`);
    }
  }
  if ( imitates.rules !== undefined ) {
    if ( !Array.isArray(imitates.rules) || !imitates.rules.length || imitates.rules.some((rule) => (typeof rule !== "string") || (rules && !rules.includes(rule))) ) {
      problems.push("the \"rules\" of \"imitates\" lists rules its unit is under meanwhile");
    }
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * Check the `imitation` part of a skill.
 * @param {*} imitation
 * @param {object} [options]
 * @param {(effects: object[]) => string[]} [options.checkEffects]    How the effects it lists are checked
 * @returns {string[]}
 */
export function checkImitation(imitation, { checkEffects = null } = {}) {
  if ( !plain(imitation) || !Object.keys(imitation).length ) return ["\"imitation\" must say what changes"];
  const problems = [];
  for ( const key of Object.keys(imitation) ) if ( !IMITATION_PARTS.includes(key) ) problems.push(`"imitation" cannot say "${key}"`);
  if ( (imitation.turns !== undefined) && !Number.isInteger(imitation.turns) ) problems.push("the \"turns\" of \"imitation\" is a whole number of turns more");
  if ( imitation.effects !== undefined ) {
    if ( !Array.isArray(imitation.effects) || !imitation.effects.length ) problems.push("the \"effects\" of \"imitation\" is a list of effects");
    else {
      if ( imitation.effects.some((effect) => !plain(effect) || effect.proc || effect.aura || effect.act || effect.imitation) ) {
        problems.push("the \"effects\" of \"imitation\" are always there while it lasts: no moment, aura or action among them");
      }
      for ( const problem of checkEffects?.(imitation.effects) ?? [] ) problems.push(`imitation: ${problem}`);
    }
  }
  if ( imitation.keeps !== undefined ) {
    const keeps = imitation.keeps;
    if ( !plain(keeps) || Object.keys(keeps).some((key) => !KEEPS_PARTS.includes(key)) ) problems.push("the \"keeps\" of \"imitation\" says { share, stats, turns }");
    else {
      if ( !(Number.isFinite(keeps.share) && (keeps.share > 0) && (keeps.share <= 100)) ) problems.push("the \"share\" that is kept is a percentage");
      if ( !Array.isArray(keeps.stats) || !keeps.stats.length || keeps.stats.some((key) => !(key in FEO.stats)) ) problems.push("the \"stats\" that are kept are listed");
      if ( (keeps.turns !== undefined) && !(Number.isInteger(keeps.turns) && (keeps.turns >= 1)) ) problems.push("what is kept lasts a whole number of turns");
    }
  }
  return problems;
}

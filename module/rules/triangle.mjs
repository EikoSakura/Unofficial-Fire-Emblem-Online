/**
 * The Weapon Triangle for Fire Emblem Online: which of two units has the advantage, what skills make of it, and
 * what one weapon hands to the next. Pure functions of plain data, so that they can be tested outside of
 * Foundry.
 *
 * Advantage goes by the weapon categories in hand (`FEO.triangle`), and the unit that has it gains Hit and
 * damage by its rank with that weapon, which its foe loses (`FEO.triangleBonus`). A skill speaks to it with a
 * `triangle` part, which like `block` is always there: it may wait for its skill to be switched on, be an aura,
 * or sit in a change that lasts a while.
 *
 *   triangle: { times: 2 }                     // what the triangle gives and takes is multiplied, for both units
 *   triangle: { beats: ["fire"] }              // its unit has the advantage against these weapons, whatever it
 *                                              // wields itself: categories or groups, as `foeWeapon` lists them
 *   triangle: { beats: "outside" }             // and against every weapon that stands outside the triangle of
 *                                              // the weapon it wields, or outside any
 *   triangle: { loses: ["light"] }             // its unit is at a disadvantage against these weapons, whatever
 *                                              // it wields itself: its foe is handed the advantage
 *   triangle: { safe: true }                   // it is never at a disadvantage: where its foe would have the
 *                                              // advantage, neither has
 *   triangle: { negates: "hit", at: "disadvantage" }       // what the triangle adds to and takes off "hit",
 *                                              // "damage" or "all" of it is negated for both units; with `at`
 *                                              // only while its unit is at a "disadvantage" or has the "advantage"
 *
 * On an attack a skill can bend the triangle for that attack alone, and then says nothing else:
 *
 *   { proc: { on: "attack", stat: "dex" }, triangle: { boon: 4, bane: 0 } }
 *                                              // what the triangle gives its unit is multiplied by `boon`, and
 *                                              // what it takes off it by `bane`
 *
 * The rules `reverseTriangle`, `alwaysAdvantage`, `noTriangle` and `bestRankTriangle` stay what they were (see
 * `RULES` in `skills.mjs`). In order: the weapons say who has the advantage; a unit that turns the triangle
 * around does; a unit that is granted the advantage has it, unless both are; a unit that is never at a
 * disadvantage is not; a unit that cancels the triangle cancels it; then what is left is multiplied, and
 * negated in part.
 *
 * And a weapon may take something from the one its unit attacked with before, with a `handover` part, which is
 * always there and never an aura:
 *
 *   { when: { weapon: ["light"] }, handover: { from: ["dark"], might: 50, hit: 25, critical: 50 } }
 *                                              // for the first attack its unit makes with a weapon since it
 *                                              // took it in hand: these shares of the Might, Hit and Critical
 *                                              // of the weapon of those categories it last attacked with
 */
import { FEO } from "../config.mjs";

/** What of the triangle a skill can negate: what it does to Hit, to damage, or all of it. */
export const TRIANGLE_NEGATES = ["hit", "damage", "all"];

/** When a skill negates it: only while its unit is at a disadvantage, or only while it has the advantage. */
export const TRIANGLE_AT = ["disadvantage", "advantage"];

/** The weapons a skill grants its unit the advantage against: those outside its own triangle, and outside any. */
export const OUTSIDE = "outside";

/**
 * @typedef TrianglePart
 * What a skill makes of the weapon triangle in a fight, as `skillTotals` collects it.
 * @property {string} skill
 * @property {number} [times]         What the triangle gives and takes is multiplied by
 * @property {boolean} [grants]       Does it hand its unit the advantage against the weapon its foe wields?
 * @property {boolean} [yields]       Does it hand its foe the advantage, for the weapon that foe wields?
 * @property {boolean} [safe]         Is its unit never at a disadvantage?
 * @property {"hit"|"damage"|"all"} [negates]
 * @property {"disadvantage"|"advantage"} [at]
 */

/**
 * @typedef TriangleState
 * @property {number} advantage       1 where the unit that began the fight has the advantage, -1 where its foe
 *                                    has, otherwise 0
 * @property {number} times           What skills multiply the triangle by; 1 where nobody has the advantage
 * @property {number} hit             What its Hit is multiplied by in all: `times`, or 0 where it is negated
 * @property {number} damage          The same for its damage
 * @property {string[]} skills        The skills that made it what it is, for what tells of it
 * @property {{granted: string[], spared: string[], multiplied: string[], negated: string[]}} by
 *                                    Those skills by what they did: handed a unit the advantage, kept a unit
 *                                    from a disadvantage, multiplied the triangle, negated a part of it
 */

/* -------------------------------------------- */

/**
 * Which of two weapon categories has weapon triangle advantage?
 * @param {string} [category]   This unit's weapon category
 * @param {string} [against]    The foe's weapon category
 * @returns {number}            1 with advantage, -1 at a disadvantage, otherwise 0
 */
export function triangleAdvantage(category, against) {
  if ( !category || !against ) return 0;
  if ( FEO.triangle[category]?.beats.includes(against) ) return 1;
  if ( FEO.triangle[against]?.beats.includes(category) ) return -1;
  return 0;
}

/* -------------------------------------------- */

/**
 * The weapon triangles there are: the weapon categories that are tied to one another by who beats whom, each
 * group a triangle of its own. Swords, Axes and Lances are one; every kind of magic is another, since Anima
 * ties Light and Dark to the elements; and the extended triangle, where a world plays with it, is a third.
 * @param {Record<string, {beats: string[], losesTo: string[]}>} [table]
 * @returns {string[][]}
 */
export function trianglesOf(table = FEO.triangle) {
  const groups = [];
  const seen = new Set();
  const tied = (category) => {
    const own = table[category] ?? { beats: [], losesTo: [] };
    const others = Object.entries(table).filter(([, entry]) => entry.beats.includes(category) || (entry.losesTo ?? []).includes(category)).map(([key]) => key);
    return [...own.beats, ...(own.losesTo ?? []), ...others];
  };
  for ( const start of Object.keys(table) ) {
    if ( seen.has(start) ) continue;
    const group = [];
    const queue = [start];
    while ( queue.length ) {
      const category = queue.pop();
      if ( seen.has(category) ) continue;
      seen.add(category);
      group.push(category);
      queue.push(...tied(category));
    }
    groups.push(group);
  }
  return groups;
}

/* -------------------------------------------- */

/**
 * The triangle a weapon category stands in, as the categories in it; null for one that stands in none.
 * @param {string} [category]
 * @param {Record<string, {beats: string[], losesTo: string[]}>} [table]
 * @returns {string[]|null}
 */
export function triangleOf(category, table = FEO.triangle) {
  if ( !category ) return null;
  return trianglesOf(table).find((group) => group.includes(category)) ?? null;
}

/* -------------------------------------------- */

/**
 * Does a weapon stand outside the triangle of another: in a different one, or in none? For a weapon that
 * stands in no triangle itself, as a bow does, every other weapon is outside.
 * @param {string} [category]   The weapon whose triangle is meant
 * @param {string} [against]    The weapon asked about
 * @param {Record<string, {beats: string[], losesTo: string[]}>} [table]
 * @returns {boolean}
 */
export function outsideTriangle(category, against, table = FEO.triangle) {
  if ( !category || !against ) return false;
  const own = triangleOf(category, table);
  return !own || !own.includes(against);
}

/* -------------------------------------------- */

/**
 * Work out the weapon triangle of a fight: who has the advantage once skills have had their say, and what it is
 * then multiplied by.
 * @param {object} initiator
 * @param {string} [initiator.category]         The category of the weapon in hand
 * @param {Set<string>|string[]} [initiator.rules]      The combat rules its skills bend
 * @param {TrianglePart[]} [initiator.parts]    What its skills make of the triangle
 * @param {object} defender                     The same for the unit that is attacked
 * @returns {TriangleState}
 */
export function settleTriangle(initiator = {}, defender = {}) {
  const sides = { initiator, defender };
  const rules = (key) => new Set(sides[key]?.rules ?? []);
  const parts = (key) => sides[key]?.parts ?? [];
  const names = (list) => [...new Set(list.map((part) => part.skill).filter(Boolean))];
  const by = { granted: [], spared: [], multiplied: [], negated: [] };

  // The weapons in hand, and a unit that turns the triangle around
  let advantage = triangleAdvantage(initiator.category, defender.category);
  if ( rules("initiator").has("reverseTriangle") !== rules("defender").has("reverseTriangle") ) advantage = -advantage;

  // A unit that is handed the advantage has it whatever the weapons, as long as both wield one. Where both
  // are, the weapons decide
  // And so has the foe of a unit that is always at a disadvantage against the weapon it wields
  const facing = (key) => (key === "initiator") ? "defender" : "initiator";
  const granting = (key) => [...parts(key).filter((part) => part.grants), ...parts(facing(key)).filter((part) => part.yields)];
  const granted = (key) => rules(key).has("alwaysAdvantage") || (granting(key).length > 0);
  const always = (granted("initiator") ? 1 : 0) - (granted("defender") ? 1 : 0);
  if ( always && initiator.category && defender.category ) {
    // A skill is only named for it where the weapons would not have given the advantage anyway
    if ( advantage !== always ) by.granted = names(granting((always > 0) ? "initiator" : "defender"));
    advantage = always;
  }

  // A unit that is never at a disadvantage: where its foe would have the advantage, neither has
  const worse = (advantage > 0) ? "defender" : (advantage < 0) ? "initiator" : null;
  const spared = worse ? parts(worse).filter((part) => part.safe) : [];
  if ( spared.length ) {
    advantage = 0;
    by.granted = [];
    by.spared = names(spared);
  }
  if ( rules("initiator").has("noTriangle") || rules("defender").has("noTriangle") ) {
    advantage = 0;
    by.granted = [];
  }
  if ( !advantage ) return { advantage: 0, times: 1, hit: 1, damage: 1, skills: [...by.spared], by };

  // What is left is multiplied. A skill counts once for its unit, by the most it multiplies by: the skill
  // itself and the change it left on its unit are one
  let times = 1;
  for ( const key of ["initiator", "defender"] ) {
    const most = new Map();
    for ( const part of parts(key) ) {
      if ( !Number.isFinite(part.times) || (part.times === 1) ) continue;
      most.set(part.skill, Math.max(most.get(part.skill) ?? 0, Math.max(part.times, 0)));
    }
    for ( const [skill, amount] of most ) {
      times *= amount;
      if ( !by.multiplied.includes(skill) ) by.multiplied.push(skill);
    }
  }

  // And a part of it may be negated for both: what it does to Hit, to damage, or all of it
  const kept = { hit: 1, damage: 1 };
  for ( const key of ["initiator", "defender"] ) {
    const standing = (key === "initiator") ? advantage : -advantage;
    for ( const part of parts(key) ) {
      if ( !TRIANGLE_NEGATES.includes(part.negates) ) continue;
      if ( (part.at === "disadvantage") && (standing >= 0) ) continue;
      if ( (part.at === "advantage") && (standing <= 0) ) continue;
      for ( const what of (part.negates === "all") ? ["hit", "damage"] : [part.negates] ) kept[what] = 0;
      if ( !by.negated.includes(part.skill) ) by.negated.push(part.skill);
    }
  }
  return {
    advantage,
    times,
    hit: times * kept.hit,
    damage: times * kept.damage,
    skills: [...new Set([...by.granted, ...by.multiplied, ...by.negated])],
    by
  };
}

/* -------------------------------------------- */

/**
 * What a skill that bends the triangle for one attack adds to that attack's Hit and damage: what the triangle
 * gives its unit multiplied by `boon`, what it takes off it by `bane`.
 * @param {{boon?: number, bane?: number}|null} part
 * @param {{hit?: number, damage?: number}} [triangle]    What the triangle adds to the attack as it stands:
 *                                                        above 0 for the unit, below 0 against it
 * @returns {{hit: number, damage: number}}               What is added on top of that
 */
export function triangleSwing(part, triangle = {}) {
  const more = (amount) => {
    if ( !part || !amount ) return 0;
    const factor = (amount > 0) ? (part.boon ?? 1) : (part.bane ?? 1);
    return Math.trunc((amount * Math.max(factor, 0)) + (Math.sign(amount) * 1e-9)) - amount;
  };
  return { hit: more(triangle.hit ?? 0), damage: more(triangle.damage ?? 0) };
}

/* -------------------------------------------- */

/**
 * Add a `triangle` part to what a unit's skills make of the triangle.
 * @param {TrianglePart[]} list
 * @param {object} part                       The part as the skill words it
 * @param {object} context
 * @param {string} context.name               The skill
 * @param {(beats: string[]|"outside") => boolean} [context.beats]
 *                                            Does the weapon the foe wields fall under what the part names?
 * @returns {boolean}                         Did the part say anything that counts in this fight?
 */
export function addTriangle(list, part, { name, beats = () => false } = {}) {
  const entry = { skill: name };
  if ( Number.isFinite(part.times) && (part.times !== 1) ) entry.times = part.times;
  if ( (part.beats !== undefined) && beats(part.beats) ) entry.grants = true;
  if ( (part.loses !== undefined) && beats(part.loses) ) entry.yields = true;
  if ( part.safe === true ) entry.safe = true;
  if ( TRIANGLE_NEGATES.includes(part.negates) ) {
    entry.negates = part.negates;
    if ( TRIANGLE_AT.includes(part.at) ) entry.at = part.at;
  }
  if ( Object.keys(entry).length === 1 ) return false;
  list.push(entry);
  return true;
}

/* -------------------------------------------- */

/**
 * Check a `triangle` part.
 * @param {object} part
 * @param {object} [options]
 * @param {boolean} [options.moment]      Does it stand at a moment of a fight?
 * @returns {string[]}                    What is wrong, in plain words; empty when nothing is
 */
export function checkTriangle(part, { moment = false } = {}) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return [`"triangle" says what its skill makes of the weapon triangle`];
  const keys = Object.keys(part);
  if ( !keys.length ) problems.push(`"triangle" says nothing`);
  if ( moment ) {
    for ( const key of keys ) {
      if ( !["boon", "bane"].includes(key) ) problems.push(`on an attack the triangle is bent by "boon" and "bane", not "${key}"`);
      else if ( !Number.isFinite(part[key]) || (part[key] < 0) ) problems.push(`"${key}" is a number the triangle is multiplied by, 0 at least`);
    }
    return problems;
  }
  for ( const key of keys ) if ( !["times", "beats", "loses", "safe", "negates", "at"].includes(key) ) problems.push(`the triangle cannot say "${key}"`);
  if ( (part.loses !== undefined) && !(Array.isArray(part.loses) && part.loses.length && part.loses.every((entry) => (typeof entry === "string") && entry)) ) {
    problems.push(`"loses" lists weapons`);
  }
  if ( (part.times !== undefined) && !(Number.isFinite(part.times) && (part.times >= 0)) ) problems.push(`the triangle is multiplied by a number, 0 at least`);
  if ( part.beats !== undefined ) {
    const listed = Array.isArray(part.beats) && part.beats.length && part.beats.every((entry) => (typeof entry === "string") && entry);
    if ( !listed && (part.beats !== OUTSIDE) ) problems.push(`"beats" lists weapons, or says "${OUTSIDE}"`);
  }
  if ( (part.safe !== undefined) && (part.safe !== true) ) problems.push(`"safe" is true or left out`);
  if ( (part.negates !== undefined) && !TRIANGLE_NEGATES.includes(part.negates) ) {
    problems.push(`the triangle is negated in ${TRIANGLE_NEGATES.map((what) => `"${what}"`).join(", ")}, not "${part.negates}"`);
  }
  if ( part.at !== undefined ) {
    if ( part.negates === undefined ) problems.push(`"at" says when the triangle is negated, and needs "negates"`);
    if ( !TRIANGLE_AT.includes(part.at) ) problems.push(`the triangle is negated at ${TRIANGLE_AT.map((what) => `"${what}"`).join(" or ")}, not "${part.at}"`);
  }
  return problems;
}

/* -------------------------------------------- */
/*  What One Weapon Hands to the Next           */
/* -------------------------------------------- */

/**
 * @typedef Wielded
 * What a unit has done with its weapons, for a skill that asks.
 * @property {boolean} fresh          Has it yet to attack with the weapon in hand since it took it in hand?
 * @property {{category: string, name?: string, might?: number, hit?: number, crit?: number}[]} last
 *                                    The weapons it last attacked with, the latest first, one for each category
 */

/**
 * What the weapon in hand takes from the weapon its unit attacked with before, for the first attack it makes
 * since it was taken in hand: shares of that weapon's Might, Hit and Critical, each rounded down.
 * @param {{skill: string, from: string[], might?: number, hit?: number, critical?: number}[]} [handovers]
 *                                    What the unit's skills hand over, of those whose condition holds
 * @param {Wielded|null} [wielded]
 * @returns {{skill: string, weapon: string, might: number, hit: number, critical: number}|null}
 *          Null where nothing is handed over: no such skill, a weapon that has attacked already, or no weapon of
 *          those categories it attacked with before. `weapon` names what was handed over from
 */
export function handedOver(handovers, wielded) {
  if ( !handovers?.length || !wielded?.fresh ) return null;
  const share = (amount, percent) => Math.max(Math.floor((((Number(amount) || 0) * (Number(percent) || 0)) / 100) + 1e-9), 0);
  const handed = { skill: [], weapon: [], might: 0, hit: 0, critical: 0 };
  for ( const handover of handovers ) {
    const before = (wielded.last ?? []).find((weapon) => (handover.from ?? []).includes(weapon?.category));
    if ( !before ) continue;
    const gains = { might: share(before.might, handover.might), hit: share(before.hit, handover.hit), critical: share(before.crit, handover.critical) };
    if ( !gains.might && !gains.hit && !gains.critical ) continue;
    for ( const key of ["might", "hit", "critical"] ) handed[key] += gains[key];
    if ( !handed.skill.includes(handover.skill) ) handed.skill.push(handover.skill);
    if ( before.name && !handed.weapon.includes(before.name) ) handed.weapon.push(before.name);
  }
  if ( !handed.skill.length ) return null;
  return { ...handed, skill: handed.skill.join(", "), weapon: handed.weapon.join(", ") };
}

/* -------------------------------------------- */

/**
 * The weapons a unit last attacked with once it has attacked with another: that one first, and the one of its
 * category it had before gone.
 * @param {Wielded["last"]} [last]
 * @param {{category: string, name?: string, might?: number, hit?: number, crit?: number}} weapon
 * @returns {Wielded["last"]}
 */
export function lastWielded(last, weapon) {
  const number = (value) => Math.floor(Number(value) || 0);
  const entry = { category: String(weapon.category ?? ""), name: String(weapon.name ?? ""), might: number(weapon.might), hit: number(weapon.hit), crit: number(weapon.crit) };
  if ( !entry.category ) return [...(last ?? [])];
  return [entry, ...(last ?? []).filter((other) => other?.category && (other.category !== entry.category))];
}

/* -------------------------------------------- */

/**
 * The weapons a unit last attacked with, as they are kept on it, with nothing else on them: null for what is
 * no such list.
 * @param {*} last
 * @returns {Wielded["last"]|null}
 */
export function cleanWielded(last) {
  if ( !Array.isArray(last) || (last.length > Object.keys(FEO.weaponCategories).length) ) return null;
  const count = (value) => Number.isInteger(value) && (value >= -999) && (value <= 999);
  const kept = [];
  for ( const entry of last ) {
    if ( !entry || !(entry.category in FEO.weaponCategories) || kept.some((other) => other.category === entry.category) ) return null;
    if ( (typeof (entry.name ?? "") !== "string") || ((entry.name ?? "").length > 200) ) return null;
    if ( !count(entry.might ?? 0) || !count(entry.hit ?? 0) || !count(entry.crit ?? 0) ) return null;
    kept.push({ category: entry.category, name: entry.name ?? "", might: entry.might ?? 0, hit: entry.hit ?? 0, crit: entry.crit ?? 0 });
  }
  return kept;
}

/* -------------------------------------------- */

/**
 * Check a `handover` part.
 * @param {object} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkHandover(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return [`"handover" says what a weapon takes from the one used before`];
  for ( const key of Object.keys(part) ) if ( !["from", "might", "hit", "critical"].includes(key) ) problems.push(`a handover cannot say "${key}"`);
  if ( !Array.isArray(part.from) || !part.from.length ) problems.push(`a handover lists the weapon categories it takes "from"`);
  else for ( const category of part.from ) if ( !(category in FEO.weaponCategories) ) problems.push(`unknown weapon category "${category}"`);
  const shares = ["might", "hit", "critical"].filter((key) => part[key] !== undefined);
  if ( !shares.length ) problems.push(`a handover gives a share of "might", "hit" or "critical"`);
  for ( const key of shares ) if ( !(Number.isFinite(part[key]) && (part[key] > 0)) ) problems.push(`the share of "${key}" a handover gives is a number of percent`);
  return problems;
}

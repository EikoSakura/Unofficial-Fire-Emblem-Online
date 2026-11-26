/**
 * Class rules for Fire Emblem Online: taking a class at creation, promotion, the milestones of classes that do
 * not promote, and stat caps.
 * Pure functions, so that they can be tested outside of Foundry. Nothing here saves anything: each planner
 * returns a description of what would change, and `planUpdate` turns one into the data to save.
 */

import { FEO } from "../config.mjs";

/**
 * @typedef ClassLike
 * A class as these rules read it: an Item of type "class", or anything shaped like one.
 * @property {string} name
 * @property {object} system
 * @property {string} system.tier                       A key of FEO.classTiers
 * @property {string} system.race                       A key of FEO.races
 * @property {Record<string, number|null>} system.base  Starting stats, null where the class gives none
 * @property {Record<string, number|null>} [system.conBy]   The CON each proficiency stands for, where CON varies
 * @property {Record<string, number>} system.gains      Stat gains on promoting into the class
 * @property {number} system.wt                         Class Weight
 * @property {Record<string, number|null>} system.caps  Stat caps, null where the class gives none
 * @property {{options: string[], choose: number, note: string}} system.proficiencies
 * @property {{starting: string, promotion: string, occult: string, mastery: string}} system.skills
 * @property {string} system.specialQualities
 * @property {{name: string, uuid: string}[]} system.promotesTo
 */

/**
 * @typedef UnitLike
 * The saved data of a unit that these rules read. This is the source data, before wounds or boosts.
 * @property {number} level
 * @property {{value: number, max: number}} hp
 * @property {Record<string, {base: number}>} stats
 * @property {{class: number}} wt
 * @property {Record<string, {rank: string}>} proficiencies
 * @property {Record<string, number>} growths
 * @property {string} specialQualities
 */

/**
 * @typedef ClassChange
 * What taking a class, promoting or reaching a milestone changes about a unit. Lists are empty and single
 * values are null where nothing changes.
 * @property {"assign"|"promote"|"milestone"|"reclass"} kind
 * @property {string|null} className                    The class the unit now has
 * @property {{from: number, to: number}|null} level
 * @property {{from: number, to: number}|null} hpMax
 * @property {{from: number, to: number}|null} hpValue
 * @property {{key: string, from: number, to: number}[]} stats
 * @property {{from: number, to: number}|null} weight   Class Weight
 * @property {{key: string, from: string, to: string, reason: "class"|"new"|"raised"|"lowered"}[]} proficiencies
 * @property {{from: string, to: string, added: string[], removed?: string[]}|null} qualities
 * @property {{key: string, from: number, to: number}[]} growths
 * @property {{name: string, kind: string}[]} skills    Skills learned
 * @property {{names: string[], kind: string}[]} choices   Skills the class offers a choice between, of which
 *                                                      one is still to be picked
 * @property {boolean} genericSkill                     A Generic Skill is taken: in place of the class's skill, or
 *                                                      of the skills in `forgets`
 * @property {string|null} raised                       The skill the unit has that is raised in place of the
 *                                                      class's skill, as Authority can be
 * @property {string[]} forgets                         Skills given up, by name
 */

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/**
 * Split a list written as on the Class Sheet, such as "Refresh, Reverberate", into names.
 * "None" and dashes count as nothing.
 * @param {string} [text]
 * @returns {string[]}
 */
export function splitNames(text) {
  return String(text ?? "").split(/[,;\n]/).map((name) => name.trim()).filter((name) => {
    return name && !/^(none|-+|–|—|n\/a)$/i.test(name);
  });
}

/* -------------------------------------------- */

/**
 * The names a class lists for one of its skills. "A or B" offers a choice of one, and "A, B" gives both.
 * A skill whose own name has a comma or an "or" in it, such as "Veni, Vidi, Vici" or "Fight or Flight", can
 * only be told apart by being a skill, so the line is read as one name when `known` says it is one.
 * @param {string} [text]
 * @param {((name: string) => boolean)|null} [known]    Is this the name of a skill? Without it, every comma
 *                                                      and every "or" separates two names.
 * @returns {{names: string[], choice: boolean}}
 */
export function classSkills(text, known = null) {
  const whole = String(text ?? "").trim();
  if ( !splitNames(whole).length ) return { names: [], choice: false };
  if ( known?.(whole) ) return { names: [whole], choice: false };
  const options = whole.split(/\s+or\s+/i).map((name) => name.trim()).filter(Boolean);
  if ( options.length > 1 ) return { names: options, choice: true };
  return { names: splitNames(whole), choice: false };
}

/* -------------------------------------------- */

/**
 * Add the skills a class lists in one place to a change: all of them, or the one picked where the class offers
 * a choice. A choice with nothing picked from it is left on the change as still to be made.
 * @param {ClassChange} change
 * @param {string} [text]         The line as the class has it
 * @param {string} kind           The kind of skill, a key of FEO.skillKinds
 * @param {object} [options]
 * @param {((name: string) => boolean)|null} [options.known]    As for `classSkills`
 * @param {string|null} [options.pick]                          The name picked from a choice
 */
function learnSkills(change, text, kind, { known = null, pick = null } = {}) {
  const { names, choice } = classSkills(text, known);
  if ( !choice ) {
    for ( const name of names ) change.skills.push({ name, kind });
    return;
  }
  const wanted = String(pick ?? "").trim().toLowerCase();
  const picked = names.find((name) => name.toLowerCase() === wanted);
  if ( picked ) change.skills.push({ name: picked, kind });
  else change.choices.push({ names, kind });
}

/* -------------------------------------------- */

/**
 * Settle a choice a change left open: the skill picked is learned and the choice is taken off the change.
 * @param {ClassChange} change
 * @param {number} index          Which of `change.choices`
 * @param {string} name           One of the names it offers
 * @returns {boolean}             False when the choice does not offer that name, and nothing was done
 */
export function chooseSkill(change, index, name) {
  const choice = change.choices[index];
  const wanted = String(name ?? "").trim().toLowerCase();
  const picked = choice?.names.find((option) => option.toLowerCase() === wanted);
  if ( !picked ) return false;
  change.choices.splice(index, 1);
  change.skills.push({ name: picked, kind: choice.kind });
  return true;
}

/* -------------------------------------------- */

/**
 * Add Special Qualities to those a unit already has, without repeating any.
 * @param {string} current    The unit's qualities, comma separated
 * @param {string} added      The qualities to add, comma separated
 * @returns {{from: string, to: string, added: string[]}}
 */
export function addQualities(current, added) {
  const have = splitNames(current);
  const known = new Set(have.map((quality) => quality.toLowerCase()));
  const fresh = [];
  for ( const quality of splitNames(added) ) {
    if ( known.has(quality.toLowerCase()) ) continue;
    known.add(quality.toLowerCase());
    fresh.push(quality);
  }
  return { from: String(current ?? ""), to: [...have, ...fresh].join(", "), added: fresh };
}

/* -------------------------------------------- */

/**
 * The rank one step above another. The highest rank stays where it is.
 * @param {string} rank
 * @param {string[]} [order]    Ranks from lowest to highest
 * @returns {string}
 */
export function nextRank(rank, order = Object.keys(FEO.ranks)) {
  const index = order.indexOf(rank);
  if ( index < 0 ) return rank;
  return order[Math.min(index + 1, order.length - 1)];
}

/* -------------------------------------------- */

/**
 * An empty change, to be filled in by a planner.
 * @param {"assign"|"promote"|"milestone"} kind
 * @returns {ClassChange}
 */
function emptyChange(kind) {
  return {
    kind,
    className: null,
    level: null,
    hpMax: null,
    hpValue: null,
    stats: [],
    weight: null,
    proficiencies: [],
    qualities: null,
    growths: [],
    skills: [],
    choices: [],
    genericSkill: false,
    raised: null,
    forgets: []
  };
}

/* -------------------------------------------- */

/**
 * Add an amount to each of a unit's stats, recording those that change.
 * @param {ClassChange} change
 * @param {UnitLike} unit
 * @param {Record<string, number>} gains    Amounts by stat key, which may include "hp"
 */
function applyGains(change, unit, gains) {
  for ( const [key, gain] of Object.entries(gains ?? {}) ) {
    if ( !gain ) continue;
    if ( key === "hp" ) {
      change.hpMax = { from: unit.hp.max, to: Math.max(unit.hp.max + gain, 0) };
      change.hpValue = { from: unit.hp.value, to: Math.max(unit.hp.value + gain, 0) };
      continue;
    }
    const stat = unit.stats[key];
    if ( !stat ) continue;
    change.stats.push({ key, from: stat.base, to: Math.max(stat.base + gain, 0) });
  }
}

/* -------------------------------------------- */
/*  Stat Caps                                   */
/* -------------------------------------------- */

/**
 * @typedef ResolvedCap
 * @property {number|null} value              The cap in force, or null when the stat has none
 * @property {"class"|"manual"|null} source   Where it comes from
 * @property {number} adjust                  The Boon or Bane adjustment included in a class cap
 */

/**
 * Work out a unit's stat caps. A cap given by the unit's class wins, raised by a Boon and lowered by a Bane on
 * that stat; where the class gives none, the cap typed on the unit's own sheet is used as it is.
 * @param {object} options
 * @param {Record<string, number|null>} [options.classCaps]   Caps from the class, by stat key
 * @param {Record<string, number|null>} options.manualCaps    Caps typed on the unit, by stat key
 * @param {string} [options.boon]
 * @param {string} [options.bane]
 * @param {Record<string, number>} [options.adjust]           FEO.boonCap
 * @returns {Record<string, ResolvedCap>}
 */
export function resolveCaps({ classCaps = {}, manualCaps, boon = "", bane = "", adjust = FEO.boonCap }) {
  const caps = {};
  for ( const [key, manual] of Object.entries(manualCaps) ) {
    const fromClass = classCaps?.[key] ?? null;
    if ( fromClass !== null ) {
      const amount = adjust[key] ?? adjust.default ?? 0;
      const shift = (boon === key ? amount : 0) - (bane === key ? amount : 0);
      caps[key] = { value: Math.max(fromClass + shift, 0), source: "class", adjust: shift };
    }
    else caps[key] = { value: manual ?? null, source: (manual ?? null) === null ? null : "manual", adjust: 0 };
  }
  return caps;
}

/* -------------------------------------------- */
/*  Taking a Class                              */
/* -------------------------------------------- */

/**
 * The rank a line of proficiencies says one of them starts at: "All Weapons, with 1 at C rank" says C.
 * A line that says nothing of it leaves the usual rank in force.
 * @param {string} note             The line as the Class Sheet words it
 * @param {string[]} [order]        The ranks there are
 * @returns {string}                The rank, or "" when the line names none
 */
export function writtenFirstRank(note, order = Object.keys(FEO.ranks)) {
  const found = /\bwith\s+(?:1|one)\s+(?:as|at)\s+([A-Z]+)\s+rank\b/i.exec(String(note ?? ""));
  const rank = found?.[1].toUpperCase() ?? "";
  return order.includes(rank) ? rank : "";
}

/**
 * The ranks a new unit of a class starts at: the usual ones, unless the class says the higher one is another, or
 * its tier does, as a Trainee's does: all its proficiencies start at E.
 * @param {ClassLike|null} cls
 * @param {{first: string, others: string}} [ranks]   FEO.startingRanks
 * @param {object} [tiers]                            FEO.classTiers
 * @returns {{first: string, others: string}}
 */
export function startingRanksOf(cls, ranks = FEO.startingRanks, tiers = FEO.classTiers) {
  const first = cls?.system.proficiencies?.firstRank || tiers[cls?.system.tier]?.firstRank || ranks.first;
  return { first, others: ranks.others };
}

/**
 * The ranks a new unit starts with in its class's proficiencies: D in one and E in the others, or whatever
 * the class gives in place of D.
 * A class that offers a choice ("Axe or Lance or Sword") grants only as many as it lets the unit choose.
 * @param {ClassLike} cls
 * @param {{first: string, others: string}} [ranks]   FEO.startingRanks
 * @returns {Record<string, string>}                  Rank by proficiency key
 */
export function startingProficiencies(cls, ranks = FEO.startingRanks) {
  const { options = [], choose = 0 } = cls.system.proficiencies ?? {};
  const granted = choose > 0 ? options.slice(0, choose) : options;
  const { first, others } = startingRanksOf(cls, ranks);
  return Object.fromEntries(granted.map((key, index) => [key, index === 0 ? first : others]));
}

/**
 * The CON of a new unit whose class gives none of its own, where the Class Sheet says "Varies": the one its
 * highest proficiency at Character Creation stands for. Of proficiencies of the same rank, the one that stands
 * for the most CON counts.
 * @param {ClassLike|null} cls
 * @param {Record<string, string>} ranks     The ranks the unit starts with, by proficiency key
 * @param {string[]} [order]                 The ranks, lowest first
 * @returns {number|null}                    Null where the class has a CON of its own, or none for these ranks
 */
export function variedCon(cls, ranks, order = Object.keys(FEO.ranks)) {
  if ( (cls?.system.base?.con ?? null) !== null ) return null;
  let best = null;
  for ( const [key, con] of Object.entries(cls?.system.conBy ?? {}) ) {
    const rank = order.indexOf(ranks?.[key]);
    if ( !Number.isFinite(con) || (rank < 1) ) continue;
    if ( !best || (rank > best.rank) || ((rank === best.rank) && (con > best.con)) ) best = { rank, con };
  }
  return best?.con ?? null;
}

/* -------------------------------------------- */

/**
 * Plan what taking a class changes about a unit.
 * Only the class name always changes; each of the rest is applied when its option is set.
 * @param {UnitLike} unit
 * @param {ClassLike} cls
 * @param {object} [options]
 * @param {boolean} [options.stats]           Set the unit's stats and HP to the class's base stats
 * @param {boolean} [options.weight]          Set Class Weight
 * @param {boolean} [options.qualities]       Add the class's Special Qualities
 * @param {Record<string, string>|null} [options.proficiencies]   Ranks to set, by proficiency key
 * @param {boolean} [options.skills]          Learn the class's starting skills
 * @param {string|null} [options.pick]        The starting skill picked, when the class offers a choice
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @returns {ClassChange}
 */
export function planAssignment(unit, cls, options = {}) {
  const { stats = false, weight = false, qualities = false, proficiencies = null, skills = false } = options;
  const { pick = null, known = null } = options;
  const system = cls.system;
  const change = emptyChange("assign");
  change.className = cls.name;

  if ( stats ) {
    for ( const [key, value] of Object.entries(system.base ?? {}) ) {
      if ( (value === null) || (value === undefined) ) continue;
      if ( key === "hp" ) {
        if ( unit.hp.max !== value ) change.hpMax = { from: unit.hp.max, to: value };
        if ( unit.hp.value !== value ) change.hpValue = { from: unit.hp.value, to: value };
      }
      else if ( unit.stats[key] && (unit.stats[key].base !== value) ) {
        change.stats.push({ key, from: unit.stats[key].base, to: value });
      }
    }
    // A CON that varies goes by the highest of the ranks the unit is given, or of those it has
    const held = Object.fromEntries(Object.entries(unit.proficiencies ?? {}).map(([key, proficiency]) => [key, proficiency.rank]));
    const con = variedCon(cls, proficiencies ?? held);
    if ( (con !== null) && unit.stats.con && (unit.stats.con.base !== con) ) {
      change.stats.push({ key: "con", from: unit.stats.con.base, to: con });
    }
  }

  if ( weight && (unit.wt.class !== system.wt) ) change.weight = { from: unit.wt.class, to: system.wt };

  if ( qualities ) {
    const merged = addQualities(unit.specialQualities, system.specialQualities);
    if ( merged.added.length ) change.qualities = merged;
  }

  for ( const [key, rank] of Object.entries(proficiencies ?? {}) ) {
    const current = unit.proficiencies[key]?.rank;
    if ( !current || !rank || (current === rank) ) continue;
    change.proficiencies.push({ key, from: current, to: rank, reason: "class" });
  }

  if ( skills ) learnSkills(change, system.skills?.starting, "class", { known, pick });
  return change;
}

/* -------------------------------------------- */
/*  Promotion                                   */
/* -------------------------------------------- */

/**
 * Does a unit promote the next time it levels up?
 * It does when its class has classes to promote to and it has reached the level at which its tier promotes.
 * @param {number} level
 * @param {ClassLike|null} cls
 * @param {object} [tiers]    FEO.classTiers
 * @returns {boolean}
 */
export function promotesAt(level, cls, tiers = FEO.classTiers) {
  if ( !cls ) return false;
  const promoteAt = tiers[cls.system.tier]?.promoteAt;
  if ( (promoteAt === undefined) || (promoteAt === null) ) return false;
  return (cls.system.promotesTo?.length > 0) && (level >= promoteAt);
}

/* -------------------------------------------- */

/**
 * The growth rates a unit has after promoting, when the increase is shared evenly.
 * @param {Record<string, number>} growths
 * @param {{stats: string[], gain: number}} [rule]    FEO.promotionGrowth
 * @returns {Record<string, number>}
 */
export function increaseGrowths(growths, rule = FEO.promotionGrowth) {
  const next = { ...growths };
  for ( const key of rule.stats ) {
    if ( key in next ) next[key] += rule.gain;
  }
  return next;
}

/* -------------------------------------------- */

/**
 * Check growth rates chosen by hand for a promotion against the rules for moving them around.
 * `total` is a hard rule: the growths must rise by exactly the promotion's total. The others are returned as
 * warnings, because a Game Master may allow more.
 * @param {Record<string, number>} current    Growth rates before promoting
 * @param {Record<string, number>} planned    Growth rates chosen for after it
 * @param {object} [options]
 * @param {object} [options.rule]             FEO.promotionGrowth
 * @param {Record<string, number>} [options.caps]   FEO.growthCaps
 * @returns {{gained: number, expected: number, moved: number, valid: boolean,
 *   problems: {code: "total"|"moved"|"cap"|"negative", key?: string}[]}}
 */
export function checkGrowths(current, planned, { rule = FEO.promotionGrowth, caps = FEO.growthCaps } = {}) {
  const expected = rule.stats.filter((key) => key in current).length * rule.gain;
  const problems = [];
  let gained = 0;
  let moved = 0;
  for ( const key of Object.keys(current) ) {
    const from = current[key];
    const to = planned[key] ?? from;
    gained += to - from;
    if ( to < from ) moved += from - to;
    if ( to < 0 ) problems.push({ code: "negative", key });

    // A growth may end above its cap only by the amount a promotion breaks it by, or where it already was
    const cap = caps[key] ?? caps.default;
    const ceiling = Math.max(cap, from) + rule.capBreak;
    if ( (to > from) && (to > ceiling) ) problems.push({ code: "cap", key });
  }
  if ( gained !== expected ) problems.unshift({ code: "total" });
  if ( moved > rule.reallocate ) problems.push({ code: "moved" });
  const hard = problems.some((problem) => (problem.code === "total") || (problem.code === "negative"));
  return { gained, expected, moved, valid: !hard, problems };
}

/* -------------------------------------------- */

/**
 * Plan a promotion from one class into another.
 *
 * The unit adds the new class's stat gains, takes its Class Weight (keeping any adjustment the unit had made to
 * its old class's Weight), raises every proficiency it already has by one rank, gains the class's new
 * proficiencies at the rank its tier gives, adds its Special Qualities, raises its growth rates, learns a skill
 * and moves to the level of the new tier.
 *
 * @param {UnitLike} unit
 * @param {ClassLike|null} from               The class being left, if the unit has one
 * @param {ClassLike} to                      The class being promoted into
 * @param {object} [options]
 * @param {string[]|null} [options.proficiencies]   Which of the class's proficiencies are taken, when it offers
 *                                                  a choice. Defaults to the first ones the unit lacks.
 * @param {Record<string, number>|null} [options.growths]   Growth rates chosen by hand, in place of the even
 *                                                          increase
 * @param {boolean} [options.generic]         Take a Generic Skill in place of the class's skill, where the tier
 *                                            allows it
 * @param {string|null} [options.pick]        The skill picked, when the class offers a choice
 * @param {string|null} [options.raise]       A skill the unit has that is raised in place of the class's
 *                                            Promotion or Mastery Skill
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @param {object} [options.tiers]            FEO.classTiers
 * @param {string[]} [options.rankOrder]      Ranks from lowest to highest
 * @param {object} [options.growthRule]       FEO.promotionGrowth
 * @returns {ClassChange}
 */
export function planPromotion(unit, from, to, options = {}) {
  const {
    proficiencies = null,
    growths = null,
    generic = false,
    pick = null,
    raise = null,
    known = null,
    tiers = FEO.classTiers,
    rankOrder = Object.keys(FEO.ranks),
    growthRule = FEO.promotionGrowth
  } = options;
  const system = to.system;
  const tier = tiers[system.tier] ?? {};
  const change = emptyChange("promote");
  change.className = to.name;

  // Level
  const hasStart = (tier.startLevel !== undefined) && (tier.startLevel !== null);
  if ( hasStart ) {
    const level = tier.resetLevel ? tier.startLevel : Math.max(tier.startLevel, unit.level + 1);
    if ( level !== unit.level ) change.level = { from: unit.level, to: level };
  }

  // Stats and Class Weight
  applyGains(change, unit, system.gains);
  const weight = unit.wt.class + (system.wt - (from?.system.wt ?? unit.wt.class));
  if ( weight !== unit.wt.class ) change.weight = { from: unit.wt.class, to: weight };

  // Proficiencies the unit already has rise by one rank
  const lowest = rankOrder[0];
  for ( const [key, proficiency] of Object.entries(unit.proficiencies) ) {
    if ( proficiency.rank === lowest ) continue;
    const raised = nextRank(proficiency.rank, rankOrder);
    if ( raised !== proficiency.rank ) change.proficiencies.push({ key, from: proficiency.rank, to: raised, reason: "raised" });
  }

  // New proficiencies arrive at the rank of the new tier
  for ( const key of chosenProficiencies(unit, to, proficiencies, lowest) ) {
    if ( unit.proficiencies[key]?.rank !== lowest ) continue;
    change.proficiencies.push({ key, from: lowest, to: tier.newRank ?? rankOrder[1], reason: "new" });
  }

  // Special Qualities
  const merged = addQualities(unit.specialQualities, system.specialQualities);
  if ( merged.added.length ) change.qualities = merged;

  // Growth rates
  const next = growths ?? increaseGrowths(unit.growths, growthRule);
  for ( const [key, value] of Object.entries(unit.growths) ) {
    if ( (key in next) && (next[key] !== value) ) change.growths.push({ key, from: value, to: next[key] });
  }

  // The skill of the new tier; or a skill the unit has raised in its place, or a Generic Skill
  if ( raise && ["promotion", "mastery"].includes(tier.skill) ) change.raised = String(raise);
  else if ( generic && tier.generic ) change.genericSkill = true;
  else {
    const kind = { starting: "class", promotion: "promotion", mastery: "mastery" }[tier.skill] ?? "class";
    learnSkills(change, system.skills?.[tier.skill], kind, { known, pick });
  }

  // A unit that started without a Generic Skill, as a Trainee does, takes one now. It takes the place of the
  // skill its class started it with
  if ( tiers[from?.system.tier]?.noGeneric ) {
    change.genericSkill = true;
    const kept = new Set([...change.skills.map((skill) => skill.name), ...change.choices.flatMap((choice) => choice.names)]
      .map((name) => name.toLowerCase()));
    change.forgets = classSkills(from.system.skills?.starting, known).names.filter((name) => !kept.has(name.toLowerCase()));
  }
  return change;
}

/* -------------------------------------------- */

/**
 * The proficiencies a unit takes from a class it promotes into.
 * @param {UnitLike} unit
 * @param {ClassLike} cls
 * @param {string[]|null} picked    The player's choice, if one was made
 * @param {string} lowest           The rank that means "not proficient"
 * @returns {string[]}
 */
function chosenProficiencies(unit, cls, picked, lowest) {
  const { options = [], choose = 0 } = cls.system.proficiencies ?? {};
  if ( picked ) return picked.filter((key) => options.includes(key));
  if ( !choose || (choose >= options.length) ) return options;
  return options.filter((key) => unit.proficiencies[key]?.rank === lowest).slice(0, choose);
}

/* -------------------------------------------- */
/*  Classes that do not Promote                 */
/* -------------------------------------------- */

/**
 * Does a class level on instead of promoting? That is a starting class with no classes to promote to. A class
 * that was itself promoted into has no milestones: its skills came with the promotion.
 * @param {ClassLike|null} cls
 * @param {object} [tiers]    FEO.classTiers
 * @returns {boolean}
 */
export function levelsOn(cls, tiers = FEO.classTiers) {
  if ( !cls || (cls.system.promotesTo?.length > 0) ) return false;
  return (tiers[cls.system.tier]?.order ?? 0) <= tiers.base.order;
}

/* -------------------------------------------- */

/**
 * Which skill a class that does not promote learns on reaching a level, if any.
 * @param {number} level                      The level just reached
 * @param {ClassLike|null} cls
 * @param {Record<number, string>} [levels]   FEO.milestoneLevels
 * @returns {"promotion"|"mastery"|null}
 */
export function milestoneAt(level, cls, levels = FEO.milestoneLevels) {
  if ( !levelsOn(cls) ) return null;
  return levels[level] ?? null;
}

/* -------------------------------------------- */

/**
 * Plan what a class that does not promote gains on reaching a milestone level: the skill a Beorc would have
 * learned by promoting and, for Laguz, Manakete and Taguel, a fixed set of stat gains and the growth increase.
 * The level itself is gained by levelling up as usual and is not part of this plan.
 * @param {UnitLike} unit       The unit as it is after the level up
 * @param {ClassLike} cls
 * @param {number} level        The level just reached
 * @param {object} [options]
 * @param {object} [options.races]            FEO.races
 * @param {Record<number, string>} [options.levels]   FEO.milestoneLevels
 * @param {Record<string, number>} [options.gains]    FEO.milestoneGains
 * @param {object} [options.growthRule]       FEO.promotionGrowth
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @returns {ClassChange|null}                Null when the level is not a milestone for this class
 */
export function planMilestone(unit, cls, level, options = {}) {
  const {
    races = FEO.races,
    levels = FEO.milestoneLevels,
    gains = FEO.milestoneGains,
    growthRule = FEO.promotionGrowth
  } = options;
  const slot = milestoneAt(level, cls, levels);
  if ( !slot ) return null;
  const change = emptyChange("milestone");
  learnSkills(change, cls.system.skills?.[slot], slot, { known: options.known });

  if ( races[cls.system.race]?.milestones ) {
    applyGains(change, unit, gains);
    const next = increaseGrowths(unit.growths, growthRule);
    for ( const [key, value] of Object.entries(unit.growths) ) {
      if ( next[key] !== value ) change.growths.push({ key, from: value, to: next[key] });
    }
  }
  return change;
}

/* -------------------------------------------- */

/**
 * The Occult Skill a unit learns on reaching a level, if any. It belongs to the unit's current class or, for a
 * unit that has promoted past it, to the latest of its earlier classes that has one.
 * @param {number} level              The level just reached
 * @param {ClassLike[]} classes       The unit's classes, current class first
 * @param {number} [occultLevel]      FEO.occultLevel
 * @returns {string}                  The line as the class has it, which may list several or offer a choice
 */
export function occultAt(level, classes, occultLevel = FEO.occultLevel) {
  if ( level !== occultLevel ) return "";
  for ( const cls of classes ) {
    const text = String(cls?.system.skills?.occult ?? "").trim();
    if ( splitNames(text).length ) return text;
  }
  return "";
}

/**
 * Plan everything a unit gains from its classes on reaching a level by levelling up: the milestone of a class
 * that does not promote, and the Occult Skill.
 * @param {UnitLike} unit           The unit as it is after the level up
 * @param {ClassLike[]} classes     The unit's classes, current class first
 * @param {number} level            The level just reached
 * @param {object} [options]        As for `planMilestone`, with `occultLevel`
 * @returns {ClassChange|null}      Null when the level brings nothing
 */
export function planLevelGains(unit, classes, level, options = {}) {
  const [current] = classes;
  if ( !current ) return null;
  const change = planMilestone(unit, current, level, options) ?? emptyChange("milestone");
  learnSkills(change, occultAt(level, classes, options.occultLevel), "occult", { known: options.known });
  const empty = !change.stats.length && !change.growths.length && !change.skills.length && !change.choices.length;
  return empty ? null : change;
}

/* -------------------------------------------- */
/*  Heart Seals and Reclassing                  */
/* -------------------------------------------- */

/**
 * A line of classes: a starting class and the classes promoted into from it, lowest tier first. A unit's own
 * line is the classes it holds; the line it reclasses into runs from a Heart Seal Class to a class of the tier
 * the unit is in.
 * @param {ClassLike[]} classes
 * @param {object} [tiers]      FEO.classTiers
 * @returns {ClassLike[]}
 */
export function classLine(classes, tiers = FEO.classTiers) {
  const order = (cls) => tiers[cls.system.tier]?.order ?? 0;
  return [...(classes ?? [])].sort((a, b) => order(a) - order(b));
}

/* -------------------------------------------- */

/**
 * The stats a line of classes stands for: the base stats of its starting class with the gains of every class
 * promoted into after it, and the Class Weight of its last class. Two lines can be told apart stat by stat
 * only when both start at a class that has base stats.
 * @param {ClassLike[]} line          Lowest tier first
 * @param {string[]} [keys]           FEO.classStats
 * @returns {{known: boolean, stats: Record<string, number>, wt: number}}
 */
export function lineStats(line, keys = FEO.classStats) {
  const [first, ...rest] = line ?? [];
  const base = first?.system.base ?? {};
  const known = !!first && keys.some((key) => (base[key] ?? null) !== null);
  const stats = Object.fromEntries(keys.map((key) => {
    return [key, (base[key] ?? 0) + rest.reduce((sum, cls) => sum + (cls.system.gains?.[key] ?? 0), 0)];
  }));
  return { known, stats, wt: line?.at(-1)?.system.wt ?? 0 };
}

/* -------------------------------------------- */

/**
 * The proficiencies a line of classes gives, and how many of them a unit takes: every one of a class that
 * offers no choice, and as many as a class that does lets a unit choose.
 * @param {ClassLike[]} line
 * @returns {{options: string[], most: number}}
 */
export function lineProficiencies(line) {
  const options = [];
  let most = 0;
  for ( const cls of line ?? [] ) {
    const mine = cls.system.proficiencies ?? {};
    const fresh = (mine.options ?? []).filter((key) => !options.includes(key));
    options.push(...fresh);
    most += mine.choose > 0 ? Math.min(mine.choose, fresh.length) : fresh.length;
  }
  return { options, most };
}

/* -------------------------------------------- */

/**
 * The skills a unit gains for swapping into a line of classes: the skill each of its classes teaches on being
 * taken, the skills a class that does not promote teaches at the levels the unit has passed, and its Occult
 * Skill for a unit of the level that learns one. Below that level the Occult Skill waits for an Occult Scroll.
 * @param {ClassLike[]} line          Lowest tier first
 * @param {number} level              The unit's level
 * @param {object} [options]
 * @param {object} [options.tiers]              FEO.classTiers
 * @param {Record<number, string>} [options.levels]     FEO.milestoneLevels
 * @param {number} [options.occultLevel]        FEO.occultLevel
 * @returns {{learned: {text: string, kind: string}[], occultWaits: string}}
 */
export function lineSkills(line, level, { tiers = FEO.classTiers, levels = FEO.milestoneLevels, occultLevel = FEO.occultLevel } = {}) {
  const kinds = { starting: "class", promotion: "promotion", mastery: "mastery" };
  const learned = [];
  const add = (text, kind) => {
    if ( splitNames(text).length ) learned.push({ text: String(text).trim(), kind });
  };
  for ( const cls of line ?? [] ) {
    const slot = tiers[cls.system.tier]?.skill;
    if ( slot ) add(cls.system.skills?.[slot], kinds[slot] ?? "class");
  }
  const last = line?.at(-1) ?? null;
  if ( levelsOn(last, tiers) ) {
    for ( const [at, slot] of Object.entries(levels) ) {
      if ( level >= Number(at) ) add(last.system.skills?.[slot], kinds[slot] ?? slot);
    }
  }
  const occult = occultAt(occultLevel, [...(line ?? [])].reverse(), occultLevel);
  if ( occult && (level >= occultLevel) ) add(occult, "occult");
  return { learned, occultWaits: (occult && (level < occultLevel)) ? occult : "" };
}

/* -------------------------------------------- */

/**
 * Work out the trade of proficiencies a reclass makes: each proficiency taken from the new line rises by one
 * rank, and for each of them one rank is taken off a proficiency of the line left behind. A rank that is
 * lowered never falls below the lowest rank that still counts as proficient. Taking none costs none.
 * @param {UnitLike} unit
 * @param {ClassLike[]} from                    The line left behind
 * @param {ClassLike[]} to                      The line reclassed into
 * @param {string[]} [gain]                     The proficiencies of the new line that are raised
 * @param {Record<string, number>} [lose]       Ranks taken off proficiencies of the old line
 * @param {string[]} [rankOrder]                Ranks from lowest to highest
 * @returns {{valid: boolean, owed: number, paid: number, problems: {code: "notOffered"|"tooMany"|"notHeld"|"owed"}[],
 *   changes: {key: string, from: string, to: string, reason: "new"|"raised"|"lowered"}[]}}
 */
export function reclassTrade(unit, from, to, gain = [], lose = {}, rankOrder = Object.keys(FEO.ranks)) {
  const offered = lineProficiencies(to);
  const held = lineProficiencies(from).options.filter((key) => unit.proficiencies[key]);
  const wanted = [...new Set(gain)];
  const steps = Object.entries(lose ?? {}).map(([key, amount]) => [key, Math.max(Math.trunc(amount) || 0, 0)]).filter(([, amount]) => amount > 0);
  const problems = [];
  if ( wanted.some((key) => !offered.options.includes(key)) ) problems.push({ code: "notOffered" });
  if ( wanted.length > offered.most ) problems.push({ code: "tooMany" });
  if ( steps.some(([key]) => !held.includes(key)) ) problems.push({ code: "notHeld" });

  // What is owed: a rank for each proficiency taken, while the line left behind has any to give
  const owed = held.length ? wanted.length : 0;
  const paid = steps.reduce((sum, [, amount]) => sum + amount, 0);
  if ( paid !== owed ) problems.push({ code: "owed" });

  // Ranks fall first and rise after, so that a proficiency of both lines ends where the trade leaves it
  const floor = Math.min(1, rankOrder.length - 1);
  const ranks = Object.fromEntries(Object.entries(unit.proficiencies).map(([key, proficiency]) => [key, rankOrder.indexOf(proficiency.rank)]));
  for ( const [key, amount] of steps ) {
    if ( !(key in ranks) || (ranks[key] < floor) ) continue;
    ranks[key] = Math.max(ranks[key] - amount, floor);
  }
  for ( const key of wanted ) {
    if ( key in ranks ) ranks[key] = Math.min(ranks[key] + 1, rankOrder.length - 1);
  }
  const changes = [];
  for ( const [key, proficiency] of Object.entries(unit.proficiencies) ) {
    const before = rankOrder.indexOf(proficiency.rank);
    if ( (before < 0) || (ranks[key] === before) ) continue;
    const reason = ranks[key] < before ? "lowered" : (before === 0 ? "new" : "raised");
    changes.push({ key, from: proficiency.rank, to: rankOrder[ranks[key]], reason });
  }
  return { valid: !problems.length, owed, paid, problems, changes };
}

/* -------------------------------------------- */

/**
 * Plan a reclass from the line of classes a unit holds into another line of the same tier.
 *
 * The unit gains and loses the difference between what the two lines stand for in every stat and in Class
 * Weight, trades proficiencies, puts off the Special Qualities of the line it leaves and takes on those of the
 * line it enters, and gains the skills of the new line. Its level and its growth rates stay as they are, and it
 * keeps every skill it has.
 *
 * @param {UnitLike} unit
 * @param {ClassLike[]} from                    The line left behind, lowest tier first
 * @param {ClassLike[]} to                      The line reclassed into, lowest tier first
 * @param {object} [options]
 * @param {string[]} [options.gain]             The proficiencies of the new line that are raised
 * @param {Record<string, number>} [options.lose]   Ranks taken off proficiencies of the old line
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @param {string[]} [options.keys]             FEO.classStats
 * @param {string[]} [options.rankOrder]        Ranks from lowest to highest
 * @returns {(ClassChange & {occultWaits: string, statsKnown: boolean})|null}   Null when the trade of
 *          proficiencies does not add up, or there is no class to reclass into
 */
export function planReclass(unit, from, to, options = {}) {
  const { gain = [], lose = {}, known = null, keys = FEO.classStats, rankOrder = Object.keys(FEO.ranks) } = options;
  const target = to?.at(-1);
  if ( !target ) return null;
  const trade = reclassTrade(unit, from, to, gain, lose, rankOrder);
  if ( !trade.valid ) return null;
  const change = emptyChange("reclass");
  change.className = target.name;

  // Stats: the difference between the two lines. A unit that still stands keeps at least 1 HP
  const before = lineStats(from, keys);
  const after = lineStats(to, keys);
  change.statsKnown = before.known && after.known;
  if ( change.statsKnown ) {
    for ( const key of keys ) {
      const shift = after.stats[key] - before.stats[key];
      if ( !shift ) continue;
      if ( key === "hp" ) {
        const max = Math.max(unit.hp.max + shift, 1);
        change.hpMax = { from: unit.hp.max, to: max };
        const value = unit.hp.value > 0 ? Math.min(Math.max(unit.hp.value + shift, 1), max) : unit.hp.value;
        if ( value !== unit.hp.value ) change.hpValue = { from: unit.hp.value, to: value };
      }
      else if ( unit.stats[key] ) change.stats.push({ key, from: unit.stats[key].base, to: Math.max(unit.stats[key].base + shift, 0) });
    }
  }
  const weight = unit.wt.class + (after.wt - before.wt);
  if ( weight !== unit.wt.class ) change.weight = { from: unit.wt.class, to: weight };

  change.proficiencies = trade.changes;

  // Special Qualities: those of the line left behind go, those of the new one come
  const gone = new Set((from ?? []).flatMap((cls) => splitNames(cls.system.specialQualities)).map((quality) => quality.toLowerCase()));
  const kept = splitNames(unit.specialQualities).filter((quality) => !gone.has(quality.toLowerCase()));
  const merged = addQualities(kept.join(", "), (to ?? []).map((cls) => cls.system.specialQualities).filter(Boolean).join(", "));
  if ( merged.to !== splitNames(unit.specialQualities).join(", ") ) {
    const now = new Set(splitNames(merged.to).map((quality) => quality.toLowerCase()));
    const had = new Set(splitNames(unit.specialQualities).map((quality) => quality.toLowerCase()));
    change.qualities = {
      from: String(unit.specialQualities ?? ""),
      to: merged.to,
      added: splitNames(merged.to).filter((quality) => !had.has(quality.toLowerCase())),
      removed: splitNames(unit.specialQualities).filter((quality) => !now.has(quality.toLowerCase()))
    };
  }

  const skills = lineSkills(to, unit.level);
  for ( const { text, kind } of skills.learned ) learnSkills(change, text, kind, { known });
  change.occultWaits = skills.occultWaits;
  return change;
}

/* -------------------------------------------- */
/*  Saving a Change                             */
/* -------------------------------------------- */

/**
 * Turn a change into the data to save on the unit, keyed by path.
 * Skills are Items and are not part of this; see `change.skills`.
 * @param {ClassChange} change
 * @returns {Record<string, number|string>}
 */
export function planUpdate(change) {
  const update = {};
  if ( change.className !== null ) update["system.className"] = change.className;
  if ( change.level ) update["system.level"] = change.level.to;
  if ( change.hpMax ) update["system.hp.max"] = change.hpMax.to;
  if ( change.hpValue ) update["system.hp.value"] = change.hpValue.to;
  for ( const stat of change.stats ) update[`system.stats.${stat.key}.base`] = stat.to;
  if ( change.weight ) update["system.wt.class"] = change.weight.to;
  for ( const proficiency of change.proficiencies ) update[`system.proficiencies.${proficiency.key}.rank`] = proficiency.to;
  if ( change.qualities ) update["system.specialQualities"] = change.qualities.to;
  for ( const growth of change.growths ) update[`system.growths.${growth.key}`] = growth.to;
  return update;
}

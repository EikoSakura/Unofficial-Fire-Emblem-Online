/**
 * Character creation for Fire Emblem Online: the steps of the Character Creator, what each has left to do, and
 * what each choice changes about a unit.
 * Pure functions, so that they can be tested outside of Foundry. Nothing here saves anything: each planner
 * returns the data to save, as `update` for the unit and `record` for the Creator's own record of what was
 * chosen, both keyed by path. A planner returns null for a choice the rules do not allow.
 *
 * Choices are applied to the unit as they are made, and as changes rather than as values: taking a bonus point
 * out of Strength lowers Strength by one, whatever it is by then. A unit that was edited by hand, or that has
 * grown since it was made, therefore keeps what it gained.
 *
 * @import {ClassLike, UnitLike} from "./classes.mjs"
 */

import { FEO } from "../config.mjs";
import { addQualities, classSkills, splitNames } from "./classes.mjs";
import { abilityScore } from "./combat-stats.mjs";

/* -------------------------------------------- */
/*  Steps                                       */
/* -------------------------------------------- */

/**
 * @typedef CreationStep
 * @property {string} id
 * @property {string} [module]      The Optional Module, a key of FEO.optional, the step belongs to
 * @property {string} [extendedBy]  An Optional Module that adds to the step when the world plays with it
 * @property {boolean} [approval]   Does what is chosen here wait for the Game Master?
 */

/** Every step the Creator knows, in order. */
export const CREATION_STEPS = [
  { id: "class" },
  { id: "sources" },
  { id: "skills" },
  { id: "ranks" },
  { id: "gold" },
  { id: "bonus" },
  { id: "growths", extendedBy: "growths" },
  { id: "boon" },
  { id: "abilities" },
  { id: "affinity" },
  { id: "heartSeals", module: "heartSeals" },
  { id: "holyBlood", module: "holyBlood", approval: true },
  { id: "crest", module: "crests", approval: true },
  { id: "profile" },
  { id: "review" }
];

/**
 * The steps a world's Creator has: the core ones, and one for each Optional Module in play that asks something
 * of a new unit.
 * @param {object} [optional]     FEO.optional
 * @returns {(CreationStep & {extended: boolean})[]}
 */
export function creationSteps(optional = FEO.optional) {
  return CREATION_STEPS.filter((step) => !step.module || optional[step.module]?.enabled).map((step) => {
    return { ...step, extended: !!step.extendedBy && !!optional[step.extendedBy]?.enabled };
  });
}

/* -------------------------------------------- */
/*  The Record                                  */
/* -------------------------------------------- */

/**
 * @typedef CreationRecord
 * What the Creator keeps on a unit, so that its choices can be looked over, changed and taken back.
 * @property {""|"draft"|"complete"} status       Blank for a unit the Creator has not touched
 * @property {{name: string, uuid: string}} class The class chosen, and where it was taken from
 * @property {boolean} granted                    Has the unit been given its starting Gold?
 * @property {number} wt                          What was added to Class Weight
 * @property {Record<string, number>} bonus       How far bonus points have raised each stat
 * @property {{take: string[], first: string}} ranks    The proficiencies taken, and the one that starts higher
 * @property {{class: {name: string, items: string[]}, generic: {name: string, items: string[]}}} skills
 *   The starting skills taken, and the Items they were added as
 * @property {{id: string, name: string, cost: number}[]} purchases     What was bought, by the Item it became
 * @property {{lineage: string, grade: string, approved: boolean}} holyBlood
 * @property {{id: string, grade: string, approved: boolean}} crest
 * @property {Record<string, boolean>} confirmed  Steps passed with Next, or changed
 * @property {Record<string, boolean>} seen       Steps that have been opened
 * @property {Record<string, string>} help        Who asked for help, by step; blank for nobody
 * @property {{step: string, user: string, name: string, gm: boolean, text: string}[]} notes
 * @property {{user: string, name: string, step: string}} last    Who last changed something, and where
 */

/**
 * Read the Creator's record of a unit, filling in whatever it does not hold.
 * @param {object} [raw]      What the unit keeps as `system.creation`
 * @param {object} [config]   FEO.creation
 * @returns {CreationRecord}
 */
export function readCreation(raw = {}, config = FEO.creation) {
  const data = raw ?? {};
  const text = (value) => (typeof value === "string" ? value : "");
  const list = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
  const flags = (value) => Object.fromEntries(Object.entries(value ?? {}).map(([key, on]) => [key, !!on]));
  const skill = (value) => ({ name: text(value?.name), items: list(value?.items) });
  const grade = (value) => (value === "major" ? "major" : "minor");
  return {
    status: ["draft", "complete"].includes(data.status) ? data.status : "",
    class: { name: text(data.class?.name), uuid: text(data.class?.uuid) },
    granted: !!data.granted,
    wt: Number.isInteger(data.wt) ? data.wt : 0,
    bonus: Object.fromEntries(config.bonus.stats.map((key) => [key, Math.max(Math.trunc(data.bonus?.[key] ?? 0) || 0, 0)])),
    ranks: { take: list(data.ranks?.take), first: text(data.ranks?.first) },
    skills: { class: skill(data.skills?.class), generic: skill(data.skills?.generic) },
    purchases: (Array.isArray(data.purchases) ? data.purchases : []).filter((entry) => entry?.id).map((entry) => {
      return { id: String(entry.id), name: text(entry.name), cost: Number(entry.cost) || 0 };
    }),
    holyBlood: { lineage: text(data.holyBlood?.lineage), grade: grade(data.holyBlood?.grade), approved: !!data.holyBlood?.approved },
    crest: { id: text(data.crest?.id), grade: grade(data.crest?.grade), approved: !!data.crest?.approved },
    confirmed: flags(data.confirmed),
    seen: flags(data.seen),
    help: Object.fromEntries(Object.entries(data.help ?? {}).map(([key, user]) => [key, text(user)])),
    notes: (Array.isArray(data.notes) ? data.notes : []).filter((note) => note?.text).map((note) => {
      return { step: text(note.step), user: text(note.user), name: text(note.name), gm: !!note.gm, text: text(note.text) };
    }),
    last: { user: text(data.last?.user), name: text(data.last?.name), step: text(data.last?.step) }
  };
}

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/**
 * The bonus points it takes to raise a stat by one.
 * @param {string} key
 * @param {object} [config]   FEO.creation
 * @returns {number}
 */
export function pointCost(key, config = FEO.creation) {
  return config.bonus.costly.includes(key) ? config.bonus.cost : 1;
}

/**
 * What a Boon adds to a stat, and a Bane takes from it.
 * @param {string} key
 * @param {object} [config]   FEO.creation
 * @returns {number}
 */
export function boonWorth(key, config = FEO.creation) {
  return config.boon.doubled.includes(key) ? config.boon.doubledBy : 1;
}

/**
 * The value of a stat as it is saved on a unit: maximum HP, the increase of Charm or Intelligence, or the base
 * of any other stat.
 * @param {UnitLike} unit
 * @param {string} key
 * @returns {number}
 */
export function savedStat(unit, key) {
  if ( key === "hp" ) return unit.hp.max;
  if ( key in (unit.abilities ?? {}) ) return unit.abilities[key].increase;
  if ( key === "wlv" ) return unit.weaponLevel?.base ?? 0;
  return unit.stats[key]?.base ?? 0;
}

/**
 * Add to a stat within an update, on top of what the update already does to it. Raising or lowering maximum HP
 * raises or lowers current HP with it.
 * @param {Record<string, any>} update
 * @param {UnitLike} unit
 * @param {string} key
 * @param {number} amount
 */
function shiftStat(update, unit, key, amount) {
  if ( !amount ) return;
  const add = (path, current) => { update[path] = Math.max((update[path] ?? current) + amount, 0); };
  if ( key === "hp" ) {
    add("system.hp.max", unit.hp.max);
    add("system.hp.value", unit.hp.value);
  }
  else if ( key in (unit.abilities ?? {}) ) add(`system.abilities.${key}.increase`, unit.abilities[key].increase);
  else if ( key === "wlv" ) add("system.weaponLevel.base", unit.weaponLevel?.base ?? 0);
  else if ( unit.stats[key] ) add(`system.stats.${key}.base`, unit.stats[key].base);
}

/**
 * A unit as it will be once an update is saved: a copy with the update's paths set.
 * @param {UnitLike} unit
 * @param {Record<string, any>} update    Keyed by path, each starting with "system."
 * @returns {UnitLike}
 */
export function preview(unit, update) {
  const copy = JSON.parse(JSON.stringify(unit));
  for ( const [path, value] of Object.entries(update) ) {
    const keys = path.split(".").slice(1);
    const last = keys.pop();
    let at = copy;
    for ( const key of keys ) at = (at[key] ??= {});
    at[last] = value;
  }
  return copy;
}

/**
 * Charm and Intelligence as a unit's saved data gives them, before anything that passes.
 * @param {UnitLike} unit
 * @returns {{cha: number, int: number}}
 */
export function abilityTotals(unit) {
  const total = (key) => {
    const ability = unit.abilities[key];
    return abilityScore(unit.stats[ability.source]?.base, ability.increase, ability.boost);
  };
  return { cha: total("cha"), int: total("int") };
}

/**
 * The ability points a new unit has to spend: for the higher of Charm and Intelligence, and for saving throws.
 * @param {UnitLike} unit
 * @param {object} [config]   FEO.creation
 * @returns {{general: number, saves: number, total: number}}
 */
export function startingPoints(unit, config = FEO.creation) {
  const { cha, int } = abilityTotals(unit);
  const general = Math.max(cha, int) * config.pointsPer;
  return { general, saves: config.savePoints, total: general + config.savePoints };
}

/**
 * Add to an update the ability points a unit of the first level has once the update is saved, so that the pool
 * on its sheet follows Charm and Intelligence while it is being made.
 * @param {UnitLike} unit
 * @param {Record<string, any>} update
 * @param {object} [config]   FEO.creation
 * @returns {Record<string, any>}   The same update
 */
export function withPool(unit, update, config = FEO.creation) {
  if ( unit.level !== 1 ) return update;
  const pool = startingPoints(preview(unit, update), config).total;
  if ( pool !== unit.checkPoints ) update["system.checkPoints"] = pool;
  return update;
}

/* -------------------------------------------- */
/*  Class                                       */
/* -------------------------------------------- */

/**
 * The names a class lists as its starting skill. "A or B" offers a choice; "A, B" gives both.
 * @param {ClassLike|null} cls
 * @param {((name: string) => boolean)|null} [known]    Is this the name of a skill? See `classSkills`
 * @returns {{names: string[], choice: boolean}}
 */
export function startingSkills(cls, known = null) {
  return classSkills(cls?.system.skills?.starting, known);
}

/**
 * The proficiencies a class has a new unit take without asking: all of them when it offers no choice. The one
 * that starts higher is left open unless there is only one.
 * @param {ClassLike} cls
 * @returns {{take: string[], first: string}}
 */
export function givenRanks(cls) {
  const { options = [], choose = 0 } = cls.system.proficiencies ?? {};
  const take = choose > 0 ? [] : [...options];
  return { take, first: take.length === 1 ? take[0] : "" };
}

/**
 * May a unit's class still be chosen in the Creator? Not once it has promoted out of a starting class.
 * @param {ClassLike|null} cls      The class the unit has
 * @param {object} [tiers]          FEO.classTiers
 * @returns {boolean}
 */
export function classOpen(cls, tiers = FEO.classTiers) {
  if ( !cls ) return true;
  return (tiers[cls.system.tier]?.order ?? 0) <= tiers.base.order;
}

/**
 * Plan taking a class in the Creator, in place of the one the unit has. A unit without a class is given the
 * class's stats outright; one that has a class gains and loses the difference between the two.
 * The skills of the class are not part of the plan: they are Items, added and removed by whoever saves it.
 * @param {UnitLike} unit
 * @param {CreationRecord} record
 * @param {ClassLike|null} from     The class the unit has
 * @param {ClassLike} to
 * @param {object} [options]
 * @param {object} [options.config]     FEO.creation
 * @param {string[]} [options.stats]    FEO.classStats
 * @param {object} [options.ranks]      FEO.startingRanks
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planClass(unit, record, from, to, { config = FEO.creation, stats = FEO.classStats, ranks = FEO.startingRanks } = {}) {
  if ( !to || !classOpen(from) || !classOpen(to) ) return null;
  const update = { "system.className": to.name };
  const base = (cls, key) => cls?.system.base?.[key] ?? 0;

  for ( const key of stats ) {
    if ( from ) shiftStat(update, unit, key, base(to, key) - base(from, key));
    else {
      // A unit that starts here: the class's own number, with whatever the Creator has already put on top
      const boon = (unit.boon === key ? 1 : 0) - (unit.bane === key ? 1 : 0);
      const value = Math.max(base(to, key) + (record.bonus[key] ?? 0) + (boon * boonWorth(key, config)), 0);
      if ( key === "hp" ) Object.assign(update, { "system.hp.max": value, "system.hp.value": value });
      else if ( unit.stats[key] ) update[`system.stats.${key}.base`] = value;
    }
  }
  update["system.wt.class"] = (to.system.wt ?? 0) + record.wt;

  // Special Qualities: those of the class left behind go, those of the new one come
  const gone = new Set(splitNames(from?.system.specialQualities).map((quality) => quality.toLowerCase()));
  const kept = splitNames(unit.specialQualities).filter((quality) => !gone.has(quality.toLowerCase()));
  update["system.specialQualities"] = addQualities(kept.join(", "), to.system.specialQualities).to;

  // Proficiencies: what the Creator gave for the old class is taken back, and the new class gives its own
  for ( const key of record.ranks.take ) {
    if ( unit.proficiencies[key] ) update[`system.proficiencies.${key}.rank`] = "F";
  }
  const given = givenRanks(to);
  for ( const key of given.take ) {
    if ( unit.proficiencies[key] ) update[`system.proficiencies.${key}.rank`] = key === given.first ? ranks.first : ranks.others;
  }

  const changes = {
    "class.name": to.name,
    "ranks.take": given.take,
    "ranks.first": given.first,
    "confirmed.ranks": false,
    status: record.status || "draft"
  };
  // Starting Gold is given once, to a unit that takes its first class here
  if ( !record.granted ) {
    if ( !from ) update["system.gold"] = unit.gold + config.gold;
    changes.granted = true;
  }
  return { update: withPool(unit, update, config), record: changes };
}

/* -------------------------------------------- */

/**
 * Plan raising or lowering Class Weight, by up to what the rules allow either way.
 * @param {UnitLike} unit
 * @param {CreationRecord} record
 * @param {number} value            What is added to the class's own Weight
 * @param {object} [config]         FEO.creation
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planWeight(unit, record, value, config = FEO.creation) {
  if ( !Number.isInteger(value) || (Math.abs(value) > config.weight) ) return null;
  return { update: { "system.wt.class": unit.wt.class + (value - record.wt) }, record: { wt: value } };
}

/* -------------------------------------------- */
/*  Charm and Intelligence                      */
/* -------------------------------------------- */

/**
 * Plan basing Charm or Intelligence on a stat. Only one of the two may be based on a stat both could use.
 * @param {UnitLike} unit
 * @param {"cha"|"int"} ability
 * @param {string} stat
 * @param {object} [options]
 * @param {object} [options.abilities]    FEO.abilities
 * @param {object} [options.config]       FEO.creation
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planSource(unit, ability, stat, { abilities = FEO.abilities, config = FEO.creation } = {}) {
  if ( !abilities[ability]?.sources.includes(stat) ) return null;
  const taken = Object.keys(abilities).some((other) => (other !== ability) && (unit.abilities[other]?.source === stat));
  if ( taken ) return null;
  const update = { [`system.abilities.${ability}.source`]: stat };
  return { update: withPool(unit, update, config), record: {} };
}

/* -------------------------------------------- */
/*  Bonus Points                                */
/* -------------------------------------------- */

/**
 * The bonus points a unit has left to spend. Less than none if it has spent more than there are.
 * @param {CreationRecord} record
 * @param {object} [config]     FEO.creation
 * @returns {number}
 */
export function bonusLeft(record, config = FEO.creation) {
  const spent = Object.entries(record.bonus).reduce((sum, [key, raised]) => sum + (raised * pointCost(key, config)), 0);
  return config.bonus.points - spent;
}

/**
 * Plan raising a stat with bonus points. A stat that costs more than one point for each it rises takes that
 * many out of what is left.
 * @param {UnitLike} unit
 * @param {CreationRecord} record
 * @param {string} key
 * @param {number} points       How far bonus points are to have raised the stat
 * @param {object} [config]     FEO.creation
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planBonus(unit, record, key, points, config = FEO.creation) {
  const rule = config.bonus;
  if ( !rule.stats.includes(key) || !Number.isInteger(points) || (points < 0) || (points > rule.perStat) ) return null;
  const change = points - (record.bonus[key] ?? 0);
  if ( !change ) return null;
  if ( (change > 0) && ((change * pointCost(key, config)) > bonusLeft(record, config)) ) return null;
  const update = {};
  shiftStat(update, unit, key, change);
  return { update: withPool(unit, update, config), record: { [`bonus.${key}`]: points } };
}

/* -------------------------------------------- */
/*  Growth Rates                                */
/* -------------------------------------------- */

/**
 * What a unit's Boon and Bane do to a growth rate.
 * @param {UnitLike} unit
 * @param {string} key
 * @param {object} [config]     FEO.creation
 * @returns {number}
 */
export function growthShift(unit, key, config = FEO.creation) {
  return ((unit.boon === key ? 1 : 0) - (unit.bane === key ? 1 : 0)) * config.boon.growth;
}

/**
 * @typedef GrowthBudget
 * @property {{key: string, value: number, start: number, cap: number, shift: number, mind: boolean}[]} rows
 *   Each growth rate as it was chosen, before its Boon or Bane
 * @property {number} freeLeft        Points left to place anywhere; below zero when too many are placed
 * @property {number} abilityLeft     Points left that may only go to Charm or Intelligence
 * @property {number} total           Every growth rate added up, as chosen
 */

/**
 * The growth points a unit has placed and has left. Points put into Charm and Intelligence come out of the
 * points kept for them first.
 * @param {UnitLike} unit
 * @param {object} [options]
 * @param {object} [options.config]       FEO.creation
 * @param {string[]} [options.keys]       The growth rates in use: the keys of FEO.growths
 * @param {object} [options.optional]     FEO.optionalGrowths, whose rates start at nothing
 * @param {object} [options.caps]         FEO.growthCaps
 * @param {number} [options.start]        FEO.baseGrowth
 * @returns {GrowthBudget}
 */
export function growthBudget(unit, {
  config = FEO.creation, keys = Object.keys(FEO.growths), optional = FEO.optionalGrowths, caps = FEO.growthCaps, start = FEO.baseGrowth
} = {}) {
  const rows = keys.map((key) => {
    const shift = growthShift(unit, key, config);
    return {
      key,
      value: (unit.growths[key] ?? 0) - shift,
      start: key in optional ? 0 : start,
      cap: caps[key] ?? caps.default,
      shift,
      mind: key in (unit.abilities ?? {})
    };
  });
  const placed = (mind) => rows.filter((row) => row.mind === mind).reduce((sum, row) => sum + row.value - row.start, 0);
  const onMind = placed(true);
  return {
    rows,
    freeLeft: config.growth.free - placed(false) - Math.max(onMind - config.growth.abilities, 0),
    abilityLeft: Math.max(config.growth.abilities - onMind, 0),
    total: rows.reduce((sum, row) => sum + row.value, 0)
  };
}

/**
 * Plan setting a growth rate, as it is chosen before a Boon or a Bane.
 * @param {UnitLike} unit
 * @param {string} key
 * @param {number} value
 * @param {object} [options]      As for `growthBudget`
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planGrowth(unit, key, value, options = {}) {
  const budget = growthBudget(unit, options);
  const row = budget.rows.find((entry) => entry.key === key);
  if ( !row || !Number.isInteger(value) || (value < row.start) || (value > row.cap) ) return null;
  const change = value - row.value;
  if ( !change ) return null;
  const room = budget.freeLeft + (row.mind ? budget.abilityLeft : 0);
  if ( change > room ) return null;
  return { update: { [`system.growths.${key}`]: Math.max(value + row.shift, 0) }, record: {} };
}

/* -------------------------------------------- */
/*  Boon and Bane                               */
/* -------------------------------------------- */

/**
 * Plan taking a Boon or a Bane, or giving one up. The stat it leaves goes back to what it was, and the stat it
 * comes to rises or falls, with its growth rate.
 * @param {UnitLike} unit
 * @param {"boon"|"bane"} which
 * @param {string} key              A stat, or blank for none
 * @param {object} [options]
 * @param {object} [options.config]       FEO.creation
 * @param {string[]} [options.stats]      FEO.boonStats
 * @param {string[]} [options.growths]    The growth rates in use: the keys of FEO.growths
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planBoon(unit, which, key, { config = FEO.creation, stats = FEO.boonStats, growths = Object.keys(FEO.growths) } = {}) {
  if ( !["boon", "bane"].includes(which) || (key && !stats.includes(key)) ) return null;
  const other = which === "boon" ? unit.bane : unit.boon;
  const old = unit[which];
  if ( (key === old) || (key && (key === other)) ) return null;
  if ( (which === "bane") && key && (savedStat(unit, key) <= 0) ) return null;

  const sign = which === "boon" ? 1 : -1;
  const update = { [`system.${which}`]: key };
  const move = (stat, direction) => {
    shiftStat(update, unit, stat, direction * boonWorth(stat, config));
    if ( growths.includes(stat) ) {
      const path = `system.growths.${stat}`;
      update[path] = Math.max((update[path] ?? unit.growths[stat] ?? 0) + (direction * config.boon.growth), 0);
    }
  };
  if ( old ) move(old, -sign);
  if ( key ) move(key, sign);
  return { update: withPool(unit, update, config), record: {} };
}

/* -------------------------------------------- */
/*  Proficiencies                               */
/* -------------------------------------------- */

/**
 * Plan the proficiencies a new unit takes from its class, and the one that starts a rank higher.
 * @param {UnitLike} unit
 * @param {CreationRecord} record
 * @param {ClassLike} cls
 * @param {string[]} take           The proficiencies taken
 * @param {string} first            The one that starts higher; blank while it is not chosen
 * @param {object} [ranks]          FEO.startingRanks
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planRanks(unit, record, cls, take, first, ranks = FEO.startingRanks) {
  const { options = [], choose = 0 } = cls?.system.proficiencies ?? {};
  const wanted = options.filter((key) => take.includes(key));
  if ( wanted.length !== take.length ) return null;
  if ( choose > 0 ? (wanted.length > choose) : (wanted.length !== options.length) ) return null;
  const higher = wanted.length === 1 ? wanted[0] : (wanted.includes(first) ? first : "");

  const update = {};
  for ( const key of new Set([...record.ranks.take, ...wanted]) ) {
    if ( !unit.proficiencies[key] ) continue;
    const rank = !wanted.includes(key) ? "F" : (key === higher ? ranks.first : ranks.others);
    if ( unit.proficiencies[key].rank !== rank ) update[`system.proficiencies.${key}.rank`] = rank;
  }
  return { update, record: { "ranks.take": wanted, "ranks.first": higher } };
}

/* -------------------------------------------- */
/*  Ability Points                              */
/* -------------------------------------------- */

/**
 * @typedef PointBudget
 * @property {number} general       Points for abilities and saving throws alike
 * @property {number} saves         Points for saving throws only
 * @property {number} generalLeft   Below zero when too many are spent
 * @property {number} savesLeft
 * @property {number} limit         The most one ability may hold
 */

/**
 * The ability points a new unit has spent and has left. Points put into saving throws come out of the points
 * kept for them first.
 * @param {UnitLike} unit
 * @param {object} [options]
 * @param {object} [options.config]     FEO.creation
 * @param {object} [options.checks]     FEO.abilityChecks
 * @returns {PointBudget}
 */
export function pointBudget(unit, { config = FEO.creation, checks = FEO.abilityChecks } = {}) {
  const { general, saves } = startingPoints(unit, config);
  let onSaves = 0;
  let onRest = 0;
  for ( const [key, check] of Object.entries(unit.checks) ) {
    if ( checks[key]?.group === "saves" ) onSaves += check.points;
    else onRest += check.points;
  }
  return {
    general,
    saves,
    generalLeft: general - onRest - Math.max(onSaves - saves, 0),
    savesLeft: Math.max(saves - onSaves, 0),
    limit: 5 + unit.level
  };
}

/**
 * Plan the points an ability or a saving throw holds.
 * @param {UnitLike} unit
 * @param {string} key
 * @param {number} points
 * @param {object} [options]      As for `pointBudget`
 * @returns {{update: Record<string, any>, record: Record<string, any>}|null}
 */
export function planCheck(unit, key, points, options = {}) {
  const check = unit.checks[key];
  const budget = pointBudget(unit, options);
  if ( !check || !Number.isInteger(points) || (points < 0) || (points > budget.limit) ) return null;
  const change = points - check.points;
  if ( !change ) return null;
  const save = (options.checks ?? FEO.abilityChecks)[key]?.group === "saves";
  if ( change > budget.generalLeft + (save ? budget.savesLeft : 0) ) return null;
  return { update: { [`system.checks.${key}.points`]: points }, record: {} };
}

/* -------------------------------------------- */
/*  Where a unit stands                         */
/* -------------------------------------------- */

/**
 * @typedef StepState
 * @property {"done"|"todo"|"issue"|"wait"} state   Finished, still to do, against a rule, or waiting for the GM
 * @property {string} note                          What to say of it: a key under FEO.Creator.state
 * @property {object} data                          What the note is filled in with
 * @property {boolean} locked                       Can the step not be opened yet?
 * @property {boolean} fresh                        A step an Optional Module added that nobody has opened
 */

/**
 * Where each step of a unit's creation stands.
 * @param {object} options
 * @param {UnitLike} options.unit
 * @param {CreationRecord} options.record
 * @param {ClassLike|null} options.cls          The class the unit has
 * @param {object} [options.optional]           FEO.optional
 * @param {object} [options.config]             FEO.creation
 * @returns {{steps: (CreationStep & StepState & {extended: boolean})[], done: number, total: number, ready: boolean,
 *   pending: string[], fresh: string[], help: string[], gold: number, bonusLeft: number, growth: GrowthBudget,
 *   points: PointBudget, skills: {names: string[], choice: boolean}}}
 */
export function creationState({ unit, record, cls, optional = FEO.optional, config = FEO.creation }) {
  const growth = growthBudget(unit, { config });
  const points = pointBudget(unit, { config });
  const left = bonusLeft(record, config);
  const skills = startingSkills(cls);
  const options = cls?.system.proficiencies?.options ?? [];
  const need = cls ? (cls.system.proficiencies?.choose || options.length) : 0;
  const is = (state, note, data = {}) => ({ state, note, data });
  const granted = (step, picked, approved) => {
    if ( !picked ) return record.confirmed[step] ? is("done", "none") : is("todo", "gm");
    return approved ? is("done", "granted") : is("wait", "waiting");
  };

  const read = (id) => {
    if ( (id !== "class") && !cls ) return is("todo", "needsClass");
    const confirmed = !!record.confirmed[id];
    switch ( id ) {
      case "class": return cls ? is("done", "name", { name: cls.name }) : is("todo", "notChosen");
      case "sources": return confirmed ? is("done", "sources") : is("todo", "unconfirmed");
      case "skills":
        if ( skills.choice && !record.skills.class.name ) return is("todo", "classSkill");
        return record.skills.generic.name ? is("done", "skills") : is("todo", "genericSkill");
      case "ranks":
        if ( record.ranks.take.length < need ) return is("todo", "takeMore", { count: need - record.ranks.take.length });
        if ( need && !record.ranks.first ) return is("todo", "firstRank");
        return is("done", "ranks");
      case "gold": return confirmed ? is("done", "goldLeft", { gold: unit.gold }) : is("todo", "goldToSpend", { gold: unit.gold });
      case "bonus":
        if ( left < 0 ) return is("issue", "over", { count: -left });
        return left === 0 ? is("done", "placed") : is("todo", "left", { count: left });
      case "growths": {
        // With Manual Stat Gains in its plain reading nothing rolls a growth rate
        if ( optional.manualGains?.enabled && (optional.manualGains.mode === "points") ) return is("done", "unused");

        // Promoting raises growth rates past what creation hands out
        if ( !classOpen(cls) ) return is("done", "grown");
        const open = growth.freeLeft + growth.abilityLeft;
        if ( growth.freeLeft < 0 ) return is("issue", "over", { count: -growth.freeLeft });
        return open === 0 ? is("done", "placed") : is("todo", "left", { count: open });
      }
      case "boon":
        if ( !!unit.boon !== !!unit.bane ) return is("issue", "bothOrNeither");
        if ( !confirmed ) return is("todo", "ifYouWant");
        return unit.boon ? is("done", "boonBane") : is("done", "none");
      case "abilities": {
        // Every level brings ability points of its own
        if ( unit.level > 1 ) return is("done", "grown");
        const open = points.generalLeft + points.savesLeft;
        if ( points.generalLeft < 0 ) return is("issue", "over", { count: -points.generalLeft });
        return open === 0 ? is("done", "placed") : is("todo", "left", { count: open });
      }
      case "affinity": return unit.affinity ? is("done", "affinity") : is("todo", "notChosen");
      case "heartSeals": {
        // Three classes beside the one the unit starts in. A unit that has since gained more has enough
        const open = (optional.heartSeals?.picks ?? 0) - (unit.heartSeals?.length ?? 0);
        return open > 0 ? is("todo", "takeMore", { count: open }) : is("done", "heartSeals", { count: unit.heartSeals.length });
      }
      case "holyBlood": return granted(id, record.holyBlood.lineage, record.holyBlood.approved);
      case "crest": return granted(id, record.crest.id, record.crest.approved);
      case "profile": return confirmed ? is("done", "written") : is("todo", "unwritten");
      case "review": return record.status === "complete" ? is("done", "finished") : is("todo", "unfinished");
    }
  };

  const steps = creationSteps(optional).map((step) => ({
    ...step,
    ...read(step.id),
    locked: (step.id !== "class") && !cls,
    fresh: !!step.module && !record.seen[step.id]
  }));
  const work = steps.filter((step) => step.id !== "review");
  const pending = work.filter((step) => step.state !== "done").map((step) => step.id);
  return {
    steps,
    done: work.length - pending.length,
    total: work.length,
    ready: !pending.length,
    pending,
    fresh: steps.filter((step) => step.fresh).map((step) => step.id),
    help: steps.filter((step) => record.help[step.id]).map((step) => step.id),
    gold: unit.gold,
    bonusLeft: left,
    growth,
    points,
    skills
  };
}

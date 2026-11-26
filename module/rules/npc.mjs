/**
 * Quick units for Fire Emblem Online: an enemy, an ally or a bystander made from a class, a Level and a side.
 *
 * A unit is made the way the rules make one. It takes the base stats of its class, then gains its Levels one
 * by one: each rolls a D100 against every growth rate, and the Level after the last of a tier is a promotion
 * in its place. What a class, a promotion or a Level gives is asked of the class rules (`classes.mjs`), which
 * the sheet uses too, so a unit made here is one a player could have levelled by hand.
 *
 * Where the rulebook leaves the Game Master to choose, this picks something and says so:
 *   - growth rates are placed by the shape of the class's base stats, inside the budget and the caps of
 *     character creation (`shapedGrowths`);
 *   - a Level gives what its growth rates give on average, rounded down, unless the unit is `rolled`;
 *   - the 5 bonus points, the Boon and Bane, the Gold and the ability points of character creation are left
 *     for the Character Creator.
 *
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @import {ClassLike, UnitLike} from "./classes.mjs"
 */

import { FEO } from "../config.mjs";
import {
  chooseSkill, planAssignment, planLevelGains, planPromotion, promotesAt, startingProficiencies, variedCon
} from "./classes.mjs";
import { freeGrowth, startsGeneric } from "./creation.mjs";
import { builtInSkills } from "./events.mjs";
import { seededRandom } from "./mapgen.mjs";
import { rollGrowths } from "./progression.mjs";
import { canWield } from "./weapons.mjs";

/**
 * @typedef NpcSpec
 * What the Game Master chose for a unit. Everything else about it follows from this and its classes.
 * @property {string} name
 * @property {"enemy"|"ally"|"other"} side
 * @property {boolean} boss               A Boss: it has the skill every Boss has
 * @property {boolean} recruit            Marked as one the party may recruit
 * @property {string[]} classes           The ids of its classes, lowest tier first
 * @property {number} level
 * @property {"average"|"rolled"} mode    How its Levels are gained
 * @property {string} seed                What its rolls are made from, so that they come out the same again
 * @property {boolean} vary               Each copy placed on a map rolls its own Levels
 * @property {Record<string, number>} adjust    What was added to a stat by hand, or taken off it
 * @property {number|null} con            Its CON, for a class that leaves it open; null for the one its highest
 *                                         proficiency stands for, or the usual one where the class lists none
 * @property {Record<string, string>} ranks     Weapon ranks set by hand
 * @property {Record<string, string>} picks     The skill picked where a class offers a choice, by `choiceId`
 * @property {string} generic             Its Generic Skill
 * @property {string[]} extras            Skills given by hand, such as Enemy Skills
 * @property {NpcCarried[]} pack          What it carries
 * @property {Record<string, number>|null} growths    Growth rates set by hand, in place of the shaped ones
 */

/**
 * @typedef NpcCarried
 * @property {string} uuid                The weapon or item it is a copy of
 * @property {string} name
 * @property {"weapon"|"gear"} type
 * @property {""|"players"|"any"} drop    Who it is left for when the unit is defeated
 * @property {boolean} equipped
 */

/* -------------------------------------------- */
/*  Growth Rates                                */
/* -------------------------------------------- */

/**
 * Growth rates for a unit nobody placed them for: every rate starts where character creation starts it, and
 * the points a player would place go to the stats in the proportion of the class's base stats, none past its
 * cap. A class strong in a stat grows in it. The points that may only go to Charm and Intelligence are shared
 * between the two.
 * @param {ClassLike|null} cls
 * @param {object} [options]
 * @param {string[]} [options.keys]         Every growth rate there is
 * @param {string[]} [options.shaped]       Those the free points go to
 * @param {string[]} [options.abilities]    Those the ability points go to
 * @param {object} [options.config]         FEO.creation.growth
 * @param {number} [options.base]           FEO.baseGrowth
 * @param {Record<string, number>} [options.caps]   FEO.growthCaps
 * @returns {Record<string, number>}
 */
export function shapedGrowths(cls, {
  keys = Object.keys(FEO.growths),
  shaped = FEO.promotionGrowth.stats,
  abilities = Object.keys(FEO.abilities),
  config = FEO.creation.growth,
  base = FEO.baseGrowth,
  caps = FEO.growthCaps
} = {}) {
  const step = Math.max(config.step ?? 5, 1);
  const cap = (key) => caps[key] ?? caps.default;
  const growths = Object.fromEntries(keys.map((key) => [key, (key in FEO.optionalGrowths) ? 0 : base]));
  const into = shaped.filter((key) => key in growths);

  // The free points, shared out by how much of each stat the class starts with. What a stat cannot take for
  // its cap goes round again to the others
  const weight = (key) => Math.max(Number(cls?.system.base?.[key]) || 0, 0.5);
  const exact = Object.fromEntries(into.map((key) => [key, growths[key]]));
  let left = cls ? freeGrowth(cls, FEO.creation) : config.free;
  const open = new Set(into.filter((key) => cap(key) > exact[key]));
  while ( (left > 0.001) && open.size ) {
    const total = [...open].reduce((sum, key) => sum + weight(key), 0);
    let placed = 0;
    for ( const key of [...open] ) {
      const share = Math.min((left * weight(key)) / total, cap(key) - exact[key]);
      exact[key] += share;
      placed += share;
      if ( (cap(key) - exact[key]) < 0.001 ) open.delete(key);
    }
    left -= placed;
    if ( placed < 0.001 ) break;
  }

  // Rates are written in steps: each is rounded down, and the steps that leaves over go to the rates that
  // lost the most by it
  let spare = 0;
  for ( const key of into ) {
    const whole = Math.floor((exact[key] / step) + 0.0001) * step;
    spare += exact[key] - whole;
    growths[key] = whole;
  }
  const order = [...into].sort((a, b) => (exact[b] - growths[b]) - (exact[a] - growths[a]));
  for ( let turn = 0; (spare >= (step - 0.001)) && (turn < (order.length * 4)); turn++ ) {
    const key = order[turn % order.length];
    if ( (growths[key] + step) > cap(key) ) continue;
    growths[key] += step;
    spare -= step;
  }

  // The points for Charm and Intelligence, a step at a time, turn about
  const minds = abilities.filter((key) => key in growths);
  for ( let points = config.abilities ?? 0, turn = 0; minds.length && (points >= step); points -= step, turn++ ) {
    growths[minds[turn % minds.length]] += step;
  }
  return growths;
}

/* -------------------------------------------- */
/*  The Line of Classes                         */
/* -------------------------------------------- */

/**
 * The line of classes a unit of a class has come up through: the class itself, and before it the classes it was
 * promoted from, back to one that has base stats of its own. Where a class can be promoted into from several,
 * the first is taken unless `prefer` names another.
 * @param {ClassLike & {id?: string}} cls
 * @param {(cls: object) => object[]} parentsOf   The classes that promote into a class
 * @param {string[]} [prefer]                     Ids of classes to come up through, where there is a choice
 * @returns {object[]}                            Lowest tier first
 */
export function lineThrough(cls, parentsOf, prefer = []) {
  const line = [cls];
  const starts = (entry) => Object.values(entry?.system.base ?? {}).some((value) => (value ?? null) !== null);
  for ( let guard = 0; !starts(line[0]) && (guard < 6); guard++ ) {
    const parents = (parentsOf(line[0]) ?? []).filter((parent) => !line.includes(parent));
    if ( !parents.length ) break;
    line.unshift(parents.find((parent) => prefer.includes(parent.id)) ?? parents[0]);
  }
  return line;
}

/* -------------------------------------------- */

/**
 * The Levels a line of classes spans: from the Level its first class starts at to the last Level its last
 * class holds before it would promote again.
 * @param {ClassLike[]} line      Lowest tier first
 * @param {object} [options]
 * @param {object} [options.tiers]    FEO.classTiers
 * @param {number} [options.limit]    The highest Level there is
 * @returns {{from: number, to: number, promotes: boolean}}   `promotes`: its last class has classes to promote
 *                                                            to, which Levels past `to` would need
 */
export function levelSpan(line, { tiers = FEO.classTiers, limit = FEO.npc.limit } = {}) {
  const last = line?.at(-1);
  const tier = tiers[last?.system.tier] ?? {};
  const promotes = (last?.system.promotesTo?.length > 0) && Number.isFinite(tier.promoteAt);
  const from = (line?.length > 1) ? (tier.startLevel ?? 1) : 1;
  return { from, to: promotes ? Math.min(tier.promoteAt, limit) : limit, promotes };
}

/* -------------------------------------------- */
/*  Making a Unit                               */
/* -------------------------------------------- */

/**
 * A unit nothing has been done to yet, as far as the class rules read one.
 * @param {object} [options]
 * @param {string[]} [options.stats]            FEO.stats
 * @param {string[]} [options.proficiencies]    FEO.proficiencies
 * @param {string[]} [options.growths]          FEO.growths
 * @returns {UnitLike & {abilities: Record<string, {increase: number}>, className: string}}
 */
export function blankUnit({
  stats = Object.keys(FEO.stats),
  proficiencies = Object.keys(FEO.proficiencies),
  growths = Object.keys(FEO.growths)
} = {}) {
  return {
    className: "",
    level: 1,
    hp: { value: 0, max: 0 },
    stats: Object.fromEntries(stats.map((key) => [key, { base: 0 }])),
    abilities: Object.fromEntries(Object.keys(FEO.abilities).map((key) => [key, { increase: 0 }])),
    wt: { class: 0 },
    proficiencies: Object.fromEntries(proficiencies.map((key) => [key, { rank: Object.keys(FEO.ranks)[0] }])),
    growths: Object.fromEntries(growths.map((key) => [key, (key in FEO.optionalGrowths) ? 0 : FEO.baseGrowth])),
    specialQualities: ""
  };
}

/* -------------------------------------------- */

/** Save a change the class rules planned onto a unit. */
function apply(unit, change) {
  if ( change.className !== null ) unit.className = change.className;
  if ( change.level ) unit.level = change.level.to;
  if ( change.hpMax ) unit.hp.max = change.hpMax.to;
  if ( change.hpValue ) unit.hp.value = change.hpValue.to;
  for ( const stat of change.stats ) unit.stats[stat.key].base = stat.to;
  if ( change.weight ) unit.wt.class = change.weight.to;
  for ( const proficiency of change.proficiencies ) unit.proficiencies[proficiency.key].rank = proficiency.to;
  if ( change.qualities ) unit.specialQualities = change.qualities.to;
  for ( const growth of change.growths ) unit.growths[growth.key] = growth.to;
}

/**
 * What a choice between skills is known by, so that what was picked from it can be kept: the names it offers.
 * @param {string[]} names
 * @returns {string}
 */
export function choiceId(names) {
  return names.map((name) => name.trim().toLowerCase()).join("|");
}

/** What a unit has of a stat, HP and the two abilities included. */
function held(unit, key) {
  if ( key === "hp" ) return unit.hp.max;
  if ( key in unit.abilities ) return unit.abilities[key].increase;
  return unit.stats[key]?.base ?? 0;
}

/** Raise what a unit has of a stat. */
function raise(unit, key, by) {
  if ( !by ) return;
  if ( key === "hp" ) {
    unit.hp.max = Math.max(unit.hp.max + by, 0);
    unit.hp.value = unit.hp.max;
  }
  else if ( key in unit.abilities ) unit.abilities[key].increase = Math.max(unit.abilities[key].increase + by, 0);
  else if ( unit.stats[key] ) unit.stats[key].base = Math.max(unit.stats[key].base + by, 0);
}

/* -------------------------------------------- */

/**
 * @typedef NpcBuild
 * A unit as it comes out: what to save of it, and how it came to be.
 * @property {UnitLike} unit                The unit's data
 * @property {ClassLike[]} classes          The classes it holds, lowest tier first
 * @property {string} className
 * @property {number} level                 The Level it reached, which is lower than the one asked for when
 *                                          its line of classes ends before it
 * @property {""|"promotion"} stopped       Why it went no further: its class would promote, and no class to
 *                                          promote into was named
 * @property {number} levels                Levels gained by growth rates
 * @property {number} promotions            Promotions made
 * @property {Record<string, {base: number, levels: number, promotion: number, adjust: number}>} parts
 *                                          Where each stat comes from
 * @property {Record<string, [number, number]>} span    Where each stat lands for most sets of rolls
 * @property {{name: string, kind: string, source: string, choice?: string, options?: string[]}[]} skills
 *                                          Its skills, each with where it comes from. One whose `source` is
 *                                          `builtIn` comes with a Special Quality, and is the system's to give
 * @property {{key: string, rank: string, byHand: boolean}[]} ranks
 * @property {boolean} conOpen              Its class leaves its CON to be set
 * @property {number} conStart              The CON it starts with, before its Levels and what is set by hand
 * @property {boolean} generic              May it have a Generic Skill of its own from the start?
 */

/**
 * Make a unit: its class's base stats, its Levels, its promotions, and what was set by hand on top.
 * @param {NpcSpec} spec
 * @param {ClassLike[]} line                Its classes, lowest tier first. A Level past the last of them that
 *                                          would be a promotion is not gained
 * @param {object} [options]
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill?
 * @param {object} [options.config]         FEO.npc
 * @returns {NpcBuild|null}                 Null without a class
 */
export function buildNpc(spec, line, { known = null, config = FEO.npc } = {}) {
  const [first] = line ?? [];
  if ( !first ) return null;
  const unit = blankUnit();
  const skills = [];
  const picks = spec.picks ?? {};
  const growthKeys = Object.keys(unit.growths);
  const parts = Object.fromEntries(["hp", ...Object.keys(unit.stats), ...Object.keys(unit.abilities)].map((key) => {
    return [key, { base: 0, levels: 0, promotion: 0, adjust: 0 }];
  }));
  const snapshot = () => Object.fromEntries(Object.keys(parts).map((key) => [key, held(unit, key)]));

  // What a change teaches: its skills, with the one picked where the class offers a choice, the first unless
  // another was picked
  const learn = (change, source) => {
    for ( const skill of change.skills ) skills.push({ ...skill, source });
    while ( change.choices.length ) {
      const { names, kind } = change.choices[0];
      const id = choiceId(names);
      const wanted = names.find((name) => name.toLowerCase() === String(picks[id] ?? "").toLowerCase()) ?? names[0];
      if ( !chooseSkill(change, 0, wanted) ) break;
      skills.push({ name: wanted, kind, source, choice: id, options: names });
      change.skills.pop();
    }
  };

  // The class it starts in
  const taken = planAssignment(unit, first, {
    stats: true, weight: true, qualities: true, proficiencies: startingProficiencies(first), skills: true, known
  });
  apply(unit, taken);
  learn(taken, "class");
  // A class that leaves CON open: the one set by hand, else the one its highest proficiency stands for, going
  // by the ranks it starts with and those set by hand, else the usual one
  const conOpen = (first.system.base?.con ?? null) === null;
  const varied = variedCon(first, { ...startingProficiencies(first), ...(spec.ranks ?? {}) });
  if ( conOpen ) unit.stats.con.base = Math.max(Math.floor(Number(spec.con ?? varied ?? config.con)) || 0, 0);
  unit.hp.value = unit.hp.max;
  for ( const [key, value] of Object.entries(snapshot()) ) parts[key].base = value;
  const given = spec.growths ?? shapedGrowths(first);
  for ( const key of growthKeys ) if ( Number.isFinite(given[key]) ) unit.growths[key] = given[key];

  // Its Levels. Each is rolled, or gives what its rates give on average: what they add up to so far, rounded
  // down, less what was given before
  const wanted = Math.min(Math.max(Math.floor(Number(spec.level)) || 1, 1), config.limit);
  const random = seededRandom(String(spec.seed ?? ""));
  const d100 = () => Math.floor(random() * 100) + 1;
  const mean = Object.fromEntries(growthKeys.map((key) => [key, 0]));
  const spread = { ...mean };
  const gained = { ...mean };
  let index = 0;
  let levels = 0;
  let promotions = 0;
  let stopped = "";
  for ( let guard = 0; (unit.level < wanted) && (guard < 400); guard++ ) {
    const cls = line[index];
    if ( promotesAt(unit.level, cls) ) {
      const next = line[index + 1];
      if ( !next ) {
        stopped = "promotion";
        break;
      }
      const before = snapshot();
      const change = planPromotion(unit, cls, next, { known });
      apply(unit, change);
      unit.hp.value = unit.hp.max;
      learn(change, "promotion");
      for ( const [key, value] of Object.entries(snapshot()) ) parts[key].promotion += value - before[key];
      index++;
      promotions++;
      continue;
    }
    unit.level++;
    levels++;
    const caps = line[index].system.caps ?? {};
    const capped = growthKeys.filter((key) => Number.isFinite(caps[key]) && (held(unit, key) >= caps[key]));
    const rolls = rollGrowths(unit.growths, capped, d100);
    for ( const { key, growth, gain, capped: full } of rolls ) {
      if ( full ) continue;
      const rate = growth / 100;
      const part = rate - Math.floor(rate);
      mean[key] += rate;
      spread[key] += part * (1 - part);
      const by = (spec.mode === "rolled") ? gain : (Math.floor(mean[key] + 1e-9) - gained[key]);
      gained[key] += by;
      if ( key in parts ) parts[key].levels += by;
      raise(unit, key, by);
    }

    // What its classes give at a Level: the skills of one that does not promote, and the Occult Skill
    const before = snapshot();
    const change = planLevelGains(unit, line.slice(0, index + 1).reverse(), unit.level, { known });
    if ( !change ) continue;
    apply(unit, change);
    unit.hp.value = unit.hp.max;
    learn(change, change.skills.some((skill) => skill.kind === "occult") ? "occult" : "promotion");
    for ( const [key, value] of Object.entries(snapshot()) ) parts[key].promotion += value - before[key];
  }

  // What was set by hand
  for ( const [key, by] of Object.entries(spec.adjust ?? {}) ) {
    const amount = Math.floor(Number(by)) || 0;
    if ( !amount || !(key in parts) ) continue;
    const before = held(unit, key);
    raise(unit, key, amount);
    parts[key].adjust = held(unit, key) - before;
  }
  const order = Object.keys(FEO.ranks);
  const set = new Set();
  for ( const [key, rank] of Object.entries(spec.ranks ?? {}) ) {
    if ( !(key in unit.proficiencies) || !order.includes(rank) ) continue;
    unit.proficiencies[key].rank = rank;
    set.add(key);
  }

  // Where each stat lands for most sets of rolls: its average, give or take
  const span = {};
  for ( const key of growthKeys ) {
    if ( !(key in parts) ) continue;
    const fixed = held(unit, key) - gained[key];
    const wide = config.spread * Math.sqrt(spread[key]);
    span[key] = [
      fixed + Math.max(Math.floor(mean[key] - wide + 1e-9), 0),
      fixed + Math.max(Math.ceil(mean[key] + wide - 1e-9), 0)
    ];
  }

  // Its own skills: the Generic Skill a unit starts with, what makes it a Boss, and what the Game Master gave
  // it. What its Special Qualities build into it is listed with them: the system gives a unit those by itself
  const generic = startsGeneric(first);
  const own = new Set(skills.map((skill) => skill.name.toLowerCase()));
  const add = (name, kind, source) => {
    const clean = String(name ?? "").trim();
    if ( !clean || own.has(clean.toLowerCase()) ) return;
    own.add(clean.toLowerCase());
    skills.push({ name: clean, kind, source });
  };
  if ( generic || promotions ) add(spec.generic, "generic", "generic");
  if ( spec.boss ) add(config.boss.skill, "enemy", "boss");
  for ( const name of spec.extras ?? [] ) add(name, "enemy", "extra");
  for ( const name of builtInSkills(unit.specialQualities) ) add(name, "class", "builtIn");

  return {
    unit,
    classes: line.slice(0, index + 1),
    className: unit.className,
    level: unit.level,
    stopped,
    levels,
    promotions,
    parts,
    span,
    skills,
    ranks: Object.entries(unit.proficiencies).filter(([, proficiency]) => proficiency.rank !== order[0])
      .map(([key, proficiency]) => ({ key, rank: proficiency.rank, byHand: set.has(key) })),
    conOpen,
    conStart: parts.con?.base ?? unit.stats.con.base,
    generic: generic || (promotions > 0)
  };
}

/* -------------------------------------------- */
/*  What it Carries                             */
/* -------------------------------------------- */

/**
 * Can a unit wield a weapon, going by its ranks?
 * @param {UnitLike} unit
 * @param {{category: string, rank: string}} weapon
 * @returns {boolean}
 */
export function wields(unit, weapon) {
  return canWield(unit.proficiencies, weapon).ok;
}

/* -------------------------------------------- */

/**
 * A kit for a unit that carries nothing, as the games this is drawn from arm their rank and file: a weapon of
 * the type it is best at, of the family that goes with the tier of its class (Iron for a starting class, Steel
 * for a promoted one, Silver for one promoted twice) or the best of those before it that its rank allows. A
 * type that has no such families, as tomes have none, gives the cheapest weapon of the highest rank that goes
 * with the tier. A unit that uses staves carries the plain healing staff as well, and every kit has its item.
 * @param {UnitLike} unit
 * @param {object[]} weapons    Weapons, each with `name`, `category`, `rank` and `cost`
 * @param {object[]} [gear]     Items, each with `name`
 * @param {object} [options]
 * @param {number} [options.order]    The order of the tier of the unit's class, as FEO.classTiers has it
 * @param {object} [options.config]   FEO.npc
 * @returns {object[]}          The weapon it takes in hand first, when there is one
 */
export function suggestKit(unit, weapons, gear = [], { order = FEO.classTiers.base.order, config = FEO.npc } = {}) {
  const ranks = Object.keys(FEO.ranks);
  const rankOf = (key) => ranks.indexOf(unit.proficiencies[key]?.rank ?? ranks[0]);
  const typeOf = (weapon) => FEO.weaponCategories[weapon.category]?.proficiency ?? null;
  const types = Object.keys(unit.proficiencies).filter((key) => rankOf(key) > 0).sort((a, b) => rankOf(b) - rankOf(a));
  const { families, ranks: caps, staff, item } = config.kit;
  const step = Math.min(Math.max(order - FEO.classTiers.base.order, 0), families.length - 1);
  const cheapest = (list) => [...list].sort((a, b) => ((a.cost ?? 0) - (b.cost ?? 0)) || a.name.localeCompare(b.name))[0] ?? null;
  const named = (name) => weapons.find((weapon) => weapon.name.toLowerCase() === name.toLowerCase()) ?? null;
  const kit = [];
  for ( const type of types.filter((key) => key !== "staff") ) {
    const mine = weapons.filter((weapon) => (typeOf(weapon) === type) && wields(unit, weapon));
    if ( !mine.length ) continue;
    let pick = null;
    for ( let at = step; (at >= 0) && !pick; at-- ) {
      pick = cheapest(mine.filter((weapon) => weapon.name.toLowerCase().startsWith(`${families[at].toLowerCase()} `)));
    }
    if ( !pick ) {
      const cap = caps[step] ? ranks.indexOf(caps[step]) : ranks.length;
      const within = mine.filter((weapon) => ranks.indexOf(weapon.rank) <= cap);
      const top = Math.max(...within.map((weapon) => ranks.indexOf(weapon.rank)));
      pick = cheapest(within.filter((weapon) => ranks.indexOf(weapon.rank) === top));
    }
    if ( pick ) kit.push(pick);
    break;
  }
  const healing = types.includes("staff") ? named(staff) : null;
  if ( healing && wields(unit, healing) ) kit.push(healing);
  const carried = gear.find((entry) => entry.name.toLowerCase() === item.toLowerCase());
  if ( carried ) kit.push(carried);
  return kit;
}

/* -------------------------------------------- */
/*  What the Game Master Chose                  */
/* -------------------------------------------- */

/**
 * A unit nothing has been chosen for yet.
 * @param {object} [given]    What is known of it already
 * @returns {NpcSpec}
 */
export function newSpec(given = {}) {
  return cleanSpec({ name: "", side: "enemy", level: 1, mode: "average", ...given });
}

/* -------------------------------------------- */

/**
 * What the Game Master chose for a unit, read from what was kept of it: anything missing or out of place is
 * put right, so that a unit saved by an older version still opens.
 * @param {object} [raw]
 * @param {object} [config]     FEO.npc
 * @returns {NpcSpec}
 */
export function cleanSpec(raw = {}, config = FEO.npc) {
  const whole = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback);
  const text = (value) => String(value ?? "").trim();
  const record = (value) => ((value && (typeof value === "object") && !Array.isArray(value)) ? value : {});
  const adjust = {};
  for ( const [key, by] of Object.entries(record(raw.adjust)) ) if ( whole(by) ) adjust[key] = whole(by);
  const ranks = {};
  for ( const [key, rank] of Object.entries(record(raw.ranks)) ) {
    if ( (key in FEO.proficiencies) && (rank in FEO.ranks) ) ranks[key] = rank;
  }
  const picks = {};
  for ( const [key, name] of Object.entries(record(raw.picks)) ) if ( text(name) ) picks[key] = text(name);
  const growths = record(raw.growths);
  return {
    name: text(raw.name),
    side: config.sides.includes(raw.side) ? raw.side : config.sides[0],
    boss: !!raw.boss,
    recruit: !!raw.recruit,
    classes: (Array.isArray(raw.classes) ? raw.classes : []).map(text).filter(Boolean),
    level: Math.min(Math.max(whole(raw.level, 1), 1), config.limit),
    mode: raw.mode === "rolled" ? "rolled" : "average",
    seed: text(raw.seed) || "1",
    vary: !!raw.vary,
    adjust,
    con: Number.isFinite(Number(raw.con)) && (raw.con !== null) && (raw.con !== "") ? Math.max(whole(raw.con), 0) : null,
    ranks,
    picks,
    generic: text(raw.generic),
    extras: [...new Set((Array.isArray(raw.extras) ? raw.extras : []).map(text).filter(Boolean))],
    pack: (Array.isArray(raw.pack) ? raw.pack : []).filter((entry) => entry && text(entry.name)).map((entry) => ({
      uuid: text(entry.uuid),
      name: text(entry.name),
      type: entry.type === "gear" ? "gear" : "weapon",
      drop: config.drops.includes(entry.drop) ? entry.drop : "",
      equipped: !!entry.equipped
    })),
    growths: Object.keys(growths).length
      ? Object.fromEntries(Object.entries(growths).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => [key, whole(value)]))
      : null
  };
}

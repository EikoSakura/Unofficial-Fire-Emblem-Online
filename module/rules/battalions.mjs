/**
 * Battalions & Gambits, an Optional Module: what a Battalion adds to the unit that commands it, who may command
 * it, the Authority that takes, what its Gambit does when it is used, how the Battalion loses HP with its
 * commander, and how it levels. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A Battalion is written the way the list of Battalions writes them: each bonus as what it starts at and what
 * it gains "per level up", and its Gambit with its Might, Hit, uses, Range and Effect.
 *
 *   STR: 2, 0.5 per level up      Dodge: 5, 1.3 per level up      Battalion HP: 30
 *   Gambit: Group Flames, 2 Might, 60 Hit, 1 use, Range 2, "Magic damage, Beast, any flammable terrain is..."
 *
 * From a Gambit's Effect the system reads what leaves no doubt, piece by piece: "Magic damage" (MAG against
 * RES, where a Gambit otherwise pits STR against DEF), a Special Quality standing by itself (the Gambit is
 * effective against it), a condition standing by itself ("Poison": inflicted on a hit), and "Roll one accuracy"
 * (one roll to hit for every target). Whatever else it says is kept as it is written, for the table to apply.
 *
 * A Gambit is no exchange of attacks: the unit that uses it rolls to hit each of its targets once, with the
 * Gambit's own Hit and damage, and nobody answers. It has a resolver of its own here, which takes none of what
 * weapons, skills, supports or terrain add to a fight.
 */
import { FEO } from "../config.mjs";
import { effectiveAgainst, parseRange } from "./combat.mjs";
import { applyCondition, conditionConfig, guards, inflictions, wardOff } from "./conditions.mjs";
import { woundsFrom } from "./defeat.mjs";

const ORDER = Object.keys(FEO.ranks);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Round down, forgiving what is lost to fractions such as 1.3 that a number cannot hold exactly. */
const whole = (value) => Math.floor(value + 1e-9);

/* -------------------------------------------- */
/*  Bonuses                                     */
/* -------------------------------------------- */

/**
 * Everything a Battalion can add to, in the order it is listed: stats, abilities, then combat stats.
 * @returns {string[]}
 */
export function bonusKeys() {
  const { stats, abilities, combat } = FEO.optional.battalions.bonuses;
  return [...stats, ...abilities, ...combat];
}

/* -------------------------------------------- */

/**
 * What one bonus of a Battalion comes to at a level: what it starts at and what it gains for every level past
 * the first, rounded down.
 * @param {{base?: number, perLevel?: number}} [bonus]
 * @param {number} [level]
 * @returns {number}
 */
export function bonusAt(bonus, level = 1) {
  const levels = clamp(Math.floor(level ?? 1), 1, FEO.optional.battalions.levels.max) - 1;
  return whole((bonus?.base ?? 0) + ((bonus?.perLevel ?? 0) * levels));
}

/* -------------------------------------------- */

/**
 * Has a Battalion retreated? One brought to 0 HP has, until it is replenished. A Battalion that was never
 * given HP cannot be defeated.
 * @param {{hp?: {value: number, max: number}}} [battalion]
 * @returns {boolean}
 */
export function hasRetreated(battalion) {
  return ((battalion?.hp?.max ?? 0) > 0) && ((battalion.hp.value ?? 0) <= 0);
}

/* -------------------------------------------- */

/**
 * What a Battalion adds to the unit that commands it, at its level: the stats, the abilities and the combat
 * stats it changes. One that has retreated adds nothing.
 * @param {{level?: number, hp?: object, bonuses?: Record<string, {base: number, perLevel: number}>}} [battalion]
 * @returns {{stats: Record<string, number>, abilities: Record<string, number>, combat: Record<string, number>}}
 */
export function battalionBonuses(battalion) {
  const groups = FEO.optional.battalions.bonuses;
  const granted = { stats: {}, abilities: {}, combat: {} };
  if ( !battalion || hasRetreated(battalion) ) return granted;
  for ( const [group, keys] of Object.entries(groups) ) {
    for ( const key of keys ) {
      const amount = bonusAt(battalion.bonuses?.[key], battalion.level);
      if ( amount ) granted[group][key] = amount;
    }
  }
  return granted;
}

/* -------------------------------------------- */
/*  Authority                                   */
/* -------------------------------------------- */

/**
 * The Authority rank a unit counts as having: its own, and never less than the rank Authority starts at in
 * this world, nor more than the highest there is to reach.
 * @param {string} [rank]
 * @returns {string}
 */
export function authorityRank(rank) {
  const config = FEO.optional.battalions;
  const top = Object.keys(config.authority.toNext).length;
  const index = clamp(ORDER.indexOf(rank), Math.max(ORDER.indexOf(config.mode), 0), top);
  return ORDER[index];
}

/* -------------------------------------------- */

/**
 * The Authority EXP it takes to leave a rank, or null at the highest.
 * @param {string} [rank]
 * @returns {number|null}
 */
export function authorityNext(rank) {
  return FEO.optional.battalions.authority.toNext[authorityRank(rank)] ?? null;
}

/* -------------------------------------------- */

/**
 * What Authority adds to hitting with a Gambit and to avoiding one: an amount for each rank above the lowest.
 * @param {string} [rank]
 * @returns {number}
 */
export function authorityBonus(rank) {
  return FEO.optional.battalions.authority.perRank * ORDER.indexOf(authorityRank(rank));
}

/* -------------------------------------------- */

/**
 * Add Authority EXP, moving up a rank each time the EXP its rank takes is reached. At the highest rank no more
 * is earned.
 * @param {{rank?: string, exp?: number}} authority
 * @param {number} amount
 * @returns {{rank: string, exp: number, gained: number, rankUps: number}}
 */
export function gainAuthority(authority, amount) {
  let rank = authorityRank(authority?.rank);
  let exp = Math.max(authority?.exp ?? 0, 0);
  let rankUps = 0;
  if ( authorityNext(rank) === null ) return { rank, exp: 0, gained: 0, rankUps };
  const gained = Math.max(Math.floor(amount ?? 0), 0);
  exp += gained;
  while ( (authorityNext(rank) !== null) && (exp >= authorityNext(rank)) ) {
    exp -= authorityNext(rank);
    rank = ORDER[ORDER.indexOf(rank) + 1];
    rankUps++;
  }
  if ( authorityNext(rank) === null ) exp = 0;
  return { rank, exp, gained, rankUps };
}

/* -------------------------------------------- */
/*  Assigning                                   */
/* -------------------------------------------- */

/** Is a word found in a text, standing by itself? */
function names(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(text ?? "");
}

/**
 * Can a Battalion be assigned to a unit? The unit needs the Authority rank the Battalion asks for, and each of
 * the Special Qualities a Battalion cannot do without in its commander.
 * @param {{rank?: string, quality?: string}} battalion
 * @param {{authority?: string, qualities?: string}} unit
 * @returns {{ok: boolean, why: "off"|"rank"|"quality"|null, needs?: string, has?: string, lacks?: string[]}}
 */
export function canAssign(battalion, unit) {
  const config = FEO.optional.battalions;
  if ( !config.enabled ) return { ok: false, why: "off" };
  const has = authorityRank(unit?.authority);
  const needs = config.ranks.includes(battalion?.rank) ? battalion.rank : config.ranks[0];
  if ( ORDER.indexOf(has) < ORDER.indexOf(needs) ) return { ok: false, why: "rank", needs, has };
  const lacks = config.restricted.filter((quality) => {
    return names(battalion?.quality, quality) && !names(unit?.qualities, quality);
  });
  if ( lacks.length ) return { ok: false, why: "quality", lacks };
  return { ok: true, why: null };
}

/* -------------------------------------------- */
/*  Gambits                                     */
/* -------------------------------------------- */

/**
 * @typedef GambitReading
 * What the system reads from a Gambit's Effect.
 * @property {boolean} magic          Does it deal magic damage: MAG against RES?
 * @property {string[]} effective     The Special Qualities it is effective against
 * @property {string[]} inflicts      The conditions it inflicts on a hit, beside the one every Gambit inflicts
 * @property {boolean} oneRoll        Is one roll to hit made for all of its targets?
 * @property {string} left            The parts of the text that are left to the table
 */

/**
 * Read a Gambit's Effect.
 * @param {string} [text]
 * @returns {GambitReading}
 */
export function readGambit(text) {
  const read = { magic: false, effective: [], inflicts: [], oneRoll: false, left: "" };
  const left = [];
  for ( const sentence of String(text ?? "").split(/[.;]\s+|[.;]$|\n/) ) {
    const kept = [];
    for ( const piece of sentence.split(/,\s*/).map((part) => part.trim()).filter(Boolean) ) {
      const quality = FEO.specialQualities.find((name) => name.toLowerCase() === piece.toLowerCase());
      const [inflicted] = inflictions(piece);
      if ( /^(n\/?a|none|-+)$/i.test(piece) ) continue;
      if ( /^magic(al)? damage$/i.test(piece) ) read.magic = true;
      else if ( /^rolls? one accuracy$/i.test(piece) ) read.oneRoll = true;
      else if ( quality ) read.effective.push(quality);
      else if ( inflicted && (inflicted.chance >= 100) && !inflicted.dice && !inflicted.otherwise ) read.inflicts.push(inflicted.id);
      else kept.push(piece);
    }
    if ( kept.length ) left.push(kept.join(", "));
  }
  read.left = left.join(". ");
  return read;
}

/* -------------------------------------------- */

/**
 * Can a unit use the Gambit of its Battalion now?
 * @param {object|null} battalion               The Battalion assigned to it
 * @param {object} [unit]
 * @param {Record<string, number>} [unit.conditions]    The conditions it suffers from
 * @param {boolean} [unit.down]                         Is it out of the fight?
 * @returns {{ok: boolean, why: "off"|"none"|"down"|"retreated"|"uses"|"condition"|null}}
 */
export function canGambit(battalion, unit = {}) {
  const config = FEO.optional.battalions;
  const no = (why) => ({ ok: false, why });
  if ( !config.enabled ) return no("off");
  if ( !battalion ) return no("none");
  if ( unit.down ) return no("down");
  if ( hasRetreated(battalion) ) return no("retreated");
  if ( config.gambit.blockedBy.some((id) => id in (unit.conditions ?? {})) ) return no("condition");
  const uses = battalion.gambit?.uses;
  if ( ((uses?.max ?? 0) > 0) && ((uses.value ?? 0) <= 0) ) return no("uses");
  return { ok: true, why: null };
}

/* -------------------------------------------- */

/**
 * @typedef GambitUnit
 * A unit as a Gambit needs it, whether it uses one or is its target.
 * @property {string} name
 * @property {number} hp
 * @property {number} [hpMax]
 * @property {number} [hpBase]                    Maximum HP before Wounds and Injuries, for a unit that can be
 *                                                Wounded
 * @property {boolean} [keepsDamage]              Is damage past 0 HP kept, as for a unit that can be
 *                                                Incapacitated?
 * @property {Record<string, number>} stats       Its stat totals, Charm among them
 * @property {{rank: string, exp: number}} authority
 * @property {string} [qualities]                 Its Special Qualities
 * @property {Record<string, number>} [conditions]
 * @property {{skill: string, percent: number, only?: string|string[]}[]} [wards]
 *                                                What may nullify a condition that would be applied to it
 * @property {boolean} [down]                     Is it out of the fight?
 * @property {number} [taken]                     What the damage it takes is multiplied by, as for a unit that
 *                                                is Staggered
 * @property {object|null} [battalion]            The Battalion assigned to it: its `id`, `name`, `quality`,
 *                                                `level`, `exp`, `hp` and `gambit`
 */

/**
 * @typedef GambitStrike
 * What a Gambit does to one of its targets, before the dice.
 * @property {number} index           Which target
 * @property {number} might           The Gambit's Might against it, multiplied where it is effective
 * @property {string[]} effective     The target's Special Qualities the Gambit is effective against
 * @property {number} charm           What the difference in Charm adds to the chance to hit
 * @property {number} authority       What the difference in Authority adds to it
 * @property {number} hit             The chance to hit, in percent
 * @property {number} damage          The damage of a hit
 * @property {string[]} inflicts      The conditions a hit inflicts
 */

/**
 * @typedef GambitPlan
 * @property {GambitUnit} user
 * @property {GambitUnit[]} targets
 * @property {object} gambit                The Gambit, as the Battalion carries it
 * @property {GambitReading} read
 * @property {boolean} offensive
 * @property {{min: number, max: number}|null} reach      From how far it is used, where its Range can be read
 * @property {number|null} distance         How far the nearest target is
 * @property {string|null} blocked          Why it cannot be used, or null
 * @property {GambitStrike[]} strikes       One for each target of an Offensive Gambit
 */

/**
 * Plan the use of a Gambit: whether it can be used, and for an Offensive Gambit the chance to hit and the
 * damage against each target.
 *
 *   Damage = Might + STR or MAG + CHA ÷ 5 − the target's DEF or RES
 *   To hit = Hit + 5 × (CHA − the target's CHA), held between −30 and +30, + 5 for each Authority rank of the
 *            user, − 5 for each of the target
 *
 * @param {GambitUnit} user
 * @param {GambitUnit[]} [targets]
 * @param {object} [options]
 * @param {number|null} [options.distance]    How far the nearest target is, when that could be measured
 * @returns {GambitPlan}
 */
export function planGambit(user, targets = [], { distance = null } = {}) {
  const config = FEO.optional.battalions;
  const battalion = user.battalion ?? null;
  const gambit = battalion?.gambit ?? { name: "", kind: "support", might: 0, hit: 0, range: "", effect: "" };
  const read = readGambit(gambit.effect);
  const offensive = gambit.kind === "offensive";
  const range = parseRange(gambit.range, user.stats);
  const reach = range ? { min: range.min, max: range.max } : null;
  const far = Number.isFinite(distance) ? distance : null;

  const able = canGambit(battalion, user);
  let blocked = able.ok ? null : able.why;
  if ( !blocked && offensive && !targets.length ) blocked = "target";
  if ( !blocked && targets.length && reach && (far !== null) && ((far < reach.min) || (far > reach.max)) ) blocked = "range";

  const { damageDivisor, hitPer, hitCap } = config.gambit.charm;
  const stat = (unit, key) => unit.stats?.[key] ?? 0;
  const strikes = !offensive ? [] : targets.map((target, index) => {
    const effective = effectiveAgainst(read.effective.join(", "), target.qualities);
    const might = (gambit.might ?? 0) * (effective.length ? config.gambit.effective : 1);
    const charm = clamp(hitPer * (stat(user, "cha") - stat(target, "cha")), -hitCap, hitCap);
    const authority = authorityBonus(user.authority?.rank) - authorityBonus(target.authority?.rank);
    const power = might + stat(user, read.magic ? "mag" : "str") + Math.floor(stat(user, "cha") / damageDivisor);
    return {
      index,
      might,
      effective,
      charm,
      authority,
      hit: clamp((gambit.hit ?? 0) + charm + authority, 0, 100),
      damage: Math.floor((Math.max(power - stat(target, read.magic ? "res" : "def"), 0) * (target.taken ?? 1)) + 1e-9),
      inflicts: [config.gambit.inflicts, ...read.inflicts].filter((id, at, list) => conditionConfig(id) && (list.indexOf(id) === at))
    };
  });
  return { user, targets, gambit, read, offensive, reach, distance: far, blocked, strikes };
}

/* -------------------------------------------- */

/**
 * The most d100s the use of a Gambit can ask for: a roll to hit each target, or one for them all, and a roll
 * for each chance a target has of nullifying a condition.
 * @param {GambitPlan} plan
 * @returns {number}
 */
export function gambitBudget(plan) {
  if ( plan.blocked || !plan.strikes.length ) return 0;
  let rolls = plan.read.oneRoll ? 1 : plan.strikes.length;
  for ( const strike of plan.strikes ) {
    const wards = plan.targets[strike.index].wards ?? [];
    for ( const id of strike.inflicts ) {
      rolls += wards.filter((ward) => (ward.percent > 0) && (ward.percent < 100) && guards(ward, id)).length;
    }
  }
  return rolls;
}

/* -------------------------------------------- */

/**
 * What the damage a commander takes does to its Battalion: the Battalion takes a share of it, more from what
 * is effective against the Battalion's own Special Quality, and never more than a share of its full HP at once.
 * A Battalion that has retreated, or was never given HP, takes none.
 * @param {{hp?: {value: number, max: number}}} battalion
 * @param {number} damage                   The damage the commander took
 * @param {object} [options]
 * @param {boolean} [options.effective]     Was it dealt by something effective against the Battalion?
 * @returns {{taken: number, hp: number, retreated: boolean, effective: boolean, capped: boolean}}
 */
export function battalionDamage(battalion, damage, { effective = false } = {}) {
  const { share, cap, effective: times } = FEO.optional.battalions.health;
  const value = battalion?.hp?.value ?? 0;
  const max = battalion?.hp?.max ?? 0;
  if ( !(max > 0) || (value <= 0) || !(damage > 0) ) return { taken: 0, hp: value, retreated: false, effective: false, capped: false };
  const due = whole(((damage * share) / 100) * (effective ? times : 1));
  const most = whole((max * cap) / 100);
  const taken = Math.min(due, most, value);
  return { taken, hp: value - taken, retreated: (value - taken) <= 0, effective: effective && (taken > 0), capped: due > most };
}

/* -------------------------------------------- */

/**
 * Add EXP to a Battalion, which gains a level each time the EXP a level takes is reached. At the highest level
 * no more is earned.
 * @param {{level?: number, exp?: number}} battalion
 * @param {number} amount
 * @returns {{level: number, exp: number, gained: number, levelUps: number}}
 */
export function gainBattalionExp(battalion, amount) {
  const { max, exp: perLevel } = FEO.optional.battalions.levels;
  let level = clamp(Math.floor(battalion?.level ?? 1), 1, max);
  let exp = Math.max(battalion?.exp ?? 0, 0);
  if ( level >= max ) return { level, exp: 0, gained: 0, levelUps: 0 };
  const gained = Math.max(Math.floor(amount ?? 0), 0);
  let levelUps = 0;
  exp += gained;
  while ( (level < max) && (exp >= perLevel) ) {
    exp -= perLevel;
    level++;
    levelUps++;
  }
  if ( level >= max ) exp = 0;
  return { level, exp, gained, levelUps };
}

/* -------------------------------------------- */

/**
 * @typedef GambitHit
 * What a Gambit did to one of its targets.
 * @property {number} index
 * @property {number} roll              The d100 rolled to hit
 * @property {number} chance
 * @property {boolean} hit
 * @property {number} damage            The damage dealt, 0 on a miss
 * @property {number} hpBefore
 * @property {number} hp                The target's HP afterwards
 * @property {boolean} defeated         Was the target brought to 0 HP?
 * @property {number} wounds            Wounds the hit caused a target that can be Wounded
 * @property {{id: string, success: boolean, turns?: number, previous?: number|null, stacked?: boolean,
 *   warded: object[]}[]} inflicted     The conditions the hit would inflict, and whether each was nullified
 * @property {Record<string, number>} conditions      The target's conditions afterwards
 * @property {ReturnType<typeof battalionDamage>|null} battalion    What became of the target's Battalion
 * @property {ReturnType<typeof gainAuthority>|null} authority      The Authority a target earned for dodging
 */

/**
 * @typedef GambitResult
 * @property {GambitHit[]} hits
 * @property {boolean} hitAny             Did the Gambit hit any target?
 * @property {boolean} defeatedAny        Did it defeat a unit or a Battalion?
 * @property {ReturnType<typeof gainAuthority>} authority     The user's Authority afterwards
 * @property {ReturnType<typeof gainBattalionExp>} level      The user's Battalion's level and EXP afterwards
 * @property {{value: number, max: number, spent: number}} uses     The Gambit's uses afterwards
 */

/**
 * Use a Gambit: roll to hit each target, deal its damage, inflict its conditions, pass the damage on to the
 * Battalions of those it hit, and work out the Authority EXP and the Battalion EXP that come of it.
 * @param {GambitPlan} plan         A plan that is not blocked
 * @param {() => number} d100       Returns a whole number from 1 to 100
 * @returns {GambitResult}
 */
export function resolveGambit(plan, d100) {
  const config = FEO.optional.battalions;
  const earned = config.authority.exp;
  let shared = null;
  const hits = plan.strikes.map((strike) => {
    const target = plan.targets[strike.index];
    const roll = plan.read.oneRoll ? (shared ??= d100()) : d100();
    const hit = roll <= strike.hit;
    const damage = hit ? strike.damage : 0;
    const hp = target.keepsDamage ? target.hp - damage : Math.max(target.hp - damage, 0);
    const defeated = hit && (target.hp > 0) && (hp <= 0);

    // The conditions a hit inflicts, unless something the target has nullifies them. A target brought down
    // gains none
    const inflicted = [];
    let conditions = { ...(target.conditions ?? {}) };
    if ( hit && !defeated ) {
      for ( const id of strike.inflicts ) {
        const warded = wardOff(target.wards, id, d100);
        if ( warded.at(-1)?.success ) {
          inflicted.push({ id, success: false, warded });
          continue;
        }
        const applied = applyCondition(conditions, id);
        conditions = applied.state;
        inflicted.push({ id, success: true, turns: applied.turns, previous: applied.previous, stacked: applied.stacked, warded });
      }
    }

    // The target's Battalion takes its share of what the target lost
    const lost = Math.max(target.hp - hp, 0);
    const squad = target.battalion ?? null;
    const battalion = (squad && (lost > 0)) ? battalionDamage(squad, lost, {
      effective: effectiveAgainst(plan.read.effective.join(", "), squad.quality).length > 0
    }) : null;

    return {
      index: strike.index,
      roll,
      chance: strike.hit,
      hit,
      damage,
      hpBefore: target.hp,
      hp,
      defeated,
      wounds: (hit && target.keepsDamage && (target.hpBase > 0)) ? woundsFrom([damage], target.hpBase) : 0,
      inflicted,
      conditions,
      battalion: battalion?.taken ? battalion : null,
      authority: (!hit && target.authority) ? gainAuthority(target.authority, earned.dodge) : null
    };
  });

  // Authority EXP: a hit takes the place of the use, a Support Gambit earns as a hit does, and a defeat is
  // added. Each is counted once for a Gambit, however many targets it had
  const hitAny = hits.some((entry) => entry.hit);
  const defeatedAny = hits.some((entry) => entry.defeated || entry.battalion?.retreated);
  const authority = (plan.offensive ? (hitAny ? earned.hit : earned.use) : earned.support) + (defeatedAny ? earned.defeat : 0);

  // The Battalion's own EXP, and the use the Gambit spends
  const squad = plan.user.battalion ?? {};
  const uses = squad.gambit?.uses ?? { value: 0, max: 0 };
  const spent = (uses.max > 0) ? 1 : 0;
  return {
    hits,
    hitAny,
    defeatedAny,
    authority: gainAuthority(plan.user.authority, authority),
    level: gainBattalionExp(squad, config.levels.use + (defeatedAny ? config.levels.defeat : 0)),
    uses: { value: Math.max((uses.value ?? 0) - spent, 0), max: uses.max ?? 0, spent }
  };
}

/* -------------------------------------------- */
/*  In a Fight                                  */
/* -------------------------------------------- */

/**
 * What a fight between two units does to their Battalions. Each takes its share of the damage its commander
 * took in the fight, more when the foe's weapon, or the Combat Art it performed, is effective against the
 * Battalion's Special Quality. The unit whose foe's Battalion retreats for it earns Authority EXP.
 * @param {import("./combat.mjs").ExchangePlan} plan      A plan whose units carry `battalion` and `authority`
 * @param {import("./combat.mjs").ExchangeResult} result
 * @returns {Record<"initiator"|"defender", {battalion: (ReturnType<typeof battalionDamage> & {id: string,
 *   name: string, max: number})|null, authority: ReturnType<typeof gainAuthority>|null}>}
 */
export function fightBattalions(plan, result) {
  const config = FEO.optional.battalions;
  const sides = ["initiator", "defender"];
  const out = { initiator: { battalion: null, authority: null }, defender: { battalion: null, authority: null } };
  if ( !config.enabled ) return out;
  for ( const side of sides ) {
    const foe = sides.find((other) => other !== side);
    const squad = plan[side].unit.battalion ?? null;
    const outcome = result[side];
    if ( !squad ) continue;
    const lost = Math.max((outcome.hpStart - outcome.hp) + (outcome.healed ?? 0), 0);
    const weapon = plan[foe].unit.weapon ?? null;
    const against = [weapon?.effect ?? "", ...(plan[foe].art?.effective ?? [])].join(", ");
    const harm = battalionDamage(squad, lost, { effective: effectiveAgainst(against, squad.quality).length > 0 });
    if ( !harm.taken ) continue;
    out[side].battalion = { ...harm, id: squad.id, name: squad.name, max: squad.hp.max };
    if ( harm.retreated && plan[foe].unit.authority ) {
      out[foe].authority = gainAuthority(plan[foe].unit.authority, config.authority.exp.battalion);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Between Battles                             */
/* -------------------------------------------- */

/**
 * A Battalion as it is once replenished: at full HP, with every use of its Gambit back.
 * @param {{hp?: {max: number}, gambit?: {uses?: {max: number}}}} battalion
 * @returns {{hp: number, uses: number}}
 */
export function replenished(battalion) {
  return { hp: battalion?.hp?.max ?? 0, uses: battalion?.gambit?.uses?.max ?? 0 };
}

/**
 * Skills in an exchange: what each unit's skills make of its numbers once it is known who fights whom, at what
 * distance and who can answer. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @import {Combatant} from "./combat.mjs"
 * @import {SkillTotals} from "./skills.mjs"
 */
import { shieldAmount } from "./blocking.mjs";
import { bonusesOf, settleBonuses, settleSpends, settleTrades } from "./choices.mjs";
import { computeCombatStats } from "./combat-stats.mjs";
import { conditionModifiers } from "./conditions.mjs";
import { DEBUFF_STATS, PROC_TRIGGERS, emptyTotals, hasNihil, hasParity, multiplyStats, resolveProc, skillTotals, sufferedSources } from "./skills.mjs";
import { timedEntries } from "./timed.mjs";

const SIDES = ["initiator", "defender"];
const other = (side) => side === "initiator" ? "defender" : "initiator";

/**
 * Does a unit carry what the skill rules need: its skills, and its numbers without them?
 * @param {Combatant} unit
 * @returns {boolean}
 */
function skilled(unit) {
  return Array.isArray(unit.skills) && !!unit.bare;
}

/* -------------------------------------------- */

/**
 * Describe a unit for the conditions of skills.
 * @param {Combatant} unit
 * @returns {import("./skills.mjs").SkillSelf & {qualities: string, afflicted: boolean}}
 */
function viewOf(unit, reach = null) {
  const bare = unit.bare ?? {};
  return {
    // Its name, for a change on its foe that asks whether this is the unit it comes from
    name: unit.name ?? "",
    hp: unit.hp,
    hpMax: unit.hpMax ?? unit.hp,
    level: unit.level ?? unit.record?.level ?? 1,
    tier: unit.tier,
    gender: unit.gender ?? "",
    bestRank: unit.bestRank ?? "",
    gold: unit.gold ?? 0,
    stats: bare.stats ?? unit.stats,
    base: bare.base ?? {},
    weapon: unit.weapon ? { ...unit.weapon, ...(bare.weapon ?? {}), reach } : null,
    proficiencies: unit.proficiencies ?? {},
    unusable: unit.unusable ?? 0,
    shield: unit.shield ?? null,
    accuracy: bare.accuracy ?? unit.combat?.accuracy ?? 0,
    attack: unit.combat?.damage ?? 0,
    waiting: !!unit.waiting,
    shifted: !!unit.shifted,
    near: unit.near ?? null,
    move: unit.move ?? null,
    goes: unit.goes ?? [],

    // The turn of the battle and the Phase that is running, for what asks the clock
    clock: unit.clock ?? null,
    conditions: unit.conditions ?? {},
    qualities: unit.qualities ?? "",
    afflicted: Object.keys(unit.conditions ?? {}).length > 0,

    // The marks skills of other units left on it, for a skill that asks for its own
    marks: (unit.timed ?? []).filter((change) => change.mark).map((change) => ({ name: change.name, from: change.from ?? "" }))
  };
}

/* -------------------------------------------- */

/**
 * A unit as it fights once its skills are counted: its stats and combat stats worked out again from its
 * numbers without skills, with what the skills add.
 * @param {Combatant} unit
 * @param {SkillTotals} totals
 * @param {import("./skills.mjs").SkillFight} fight     The fight as the unit sees it
 * @param {SkillTotals|null} [foeTotals]                What the foe's skills add up to, for what they do to
 *                                                      this unit
 * @param {object} [options]
 * @param {boolean} [options.parity]                    Is what supports and equipment do cancelled in this
 *                                                      fight, as Parity has it?
 * @returns {Combatant & {fx: SkillTotals}}
 */
function withTotals(unit, totals, fight, foeTotals = null, { parity = false } = {}) {
  if ( !skilled(unit) ) return { ...unit, fx: totals };
  const bare = unit.bare;
  const stats = { ...bare.stats };
  for ( const [key, amount] of Object.entries(totals.stats) ) stats[key] = Math.max((stats[key] ?? 0) + amount, 0);

  // What the foe's skills make of the bonuses this unit's skills give its stats: cancelled, or turned around
  // and what a change that lasts on the unit itself makes of them, as a Panic staff has it
  const lulled = settleBonuses([...(foeTotals?.foeBonus ?? []), ...(totals.ownBonus ?? [])], bonusesOf(totals.sources));
  for ( const [key, amount] of Object.entries(lulled.stats) ) stats[key] = Math.max((stats[key] ?? 0) + amount, 0);

  // What the unit spends for damage as the fight begins: HP, or transformations it still has this turn. A
  // unit that is known to make no attack spends nothing
  const idle = (fight?.counters === false) ? totals.spends.map((entry) => entry.skill) : [];
  const spent = settleSpends(idle.length ? [] : totals.spends, { hp: unit.hp, transforms: unit.transforms ?? 0 });

  // What the foe's skills take off the stats this unit fights with, less what its own skills take off
  // incoming penalties. A skill whose lasting change the unit already carries is not counted twice
  const relief = totals.bends?.debuffs;
  for ( const { skill, stats: lowered } of foeTotals?.foeStats ?? [] ) {
    if ( (unit.timed ?? []).some((change) => (change.name === skill) && change.from) ) continue;
    for ( const [key, amount] of Object.entries(lowered) ) {
      const eased = ((amount < 0) && relief) ? (relief.negate ? 0 : Math.min(amount + (relief.stats ?? 0), 0)) : amount;
      stats[key] = Math.max((stats[key] ?? 0) + eased, 0);
    }
  }
  // Stats that are multiplied once everything is added to them, as one that is halved for a while is: what
  // comes of it is told under the names of the skills that do so
  const times = multiplyStats(stats, totals.statTimes, relief);
  Object.assign(stats, times.stats);
  const cut = Object.keys(times.change).length ? [{ name: times.names.join(", "), stats: times.change, combat: {} }] : [];

  // Where Parity holds, what the unit's supports add is cancelled, and so is what its Shield does
  const shield = parity ? null : (unit.shield ?? null);
  // What the foe's skills add to the combat stats this unit fights with, less what its own skills take off
  // incoming penalties
  const lent = (foeTotals?.foeCombat ?? []).map(({ skill, combat }) => {
    const eased = Object.fromEntries(Object.entries(combat).map(([key, amount]) => {
      return [key, ((amount < 0) && relief) ? (relief.negate ? 0 : Math.min(amount + (relief.combat ?? 0), 0)) : amount];
    }).filter(([, amount]) => amount));
    return { name: skill, stats: {}, combat: eased };
  }).filter((source) => Object.keys(source.combat).length);
  const modifiers = [
    ...(bare.modifiers ?? []).filter((modifier) => !(parity && modifier.support)),
    ...totals.sources.map((source) => ({ label: source.name, ...source.combat })),
    ...spent.sources.map((source) => ({ label: source.name, ...source.combat })),
    ...lent.map((source) => ({ label: source.name, ...source.combat }))
  ];
  // The Shield a unit has equipped adds to its Weight as Attack Speed is worked out, armed or not. A skill
  // may have its weapon and its Shield weigh nothing for that
  const burden = totals.noWeight ? 0 : (shield?.weight ?? 0);
  const weapon = unit.weapon ? {
    might: unit.weapon.might ?? 0,
    hit: bare.weapon?.hit ?? unit.weapon.hit ?? 0,
    crit: bare.weapon?.crit ?? unit.weapon.crit ?? 0,
    weight: totals.noWeight ? 0 : (bare.weapon?.weight ?? unit.weapon.weight ?? 0) + burden,
    damageStat: totals.damageStat ?? unit.weapon.damageStat ?? "str"
  } : (burden ? { weight: burden } : null);

  // A combat stat a skill multiplies once everything is added to it, told under the skill's name
  const figures = { stats, boosts: bare.boosts, calc: { ...(bare.calc ?? {}), ...totals.calc }, modifiers };
  const plain = computeCombatStats(figures, weapon);
  const scaled = totals.combatTimes.map(({ skill, key, times: by }) => ({ label: skill, key, times: by }));
  const combat = scaled.length ? computeCombatStats({ ...figures, times: scaled }, weapon) : { ...plain };
  const untraded = { ...combat };
  const multiplied = [];
  for ( const [key, name] of scaled.length ? [["hit", "accuracy"], ["damage", "damage"], ["critical", "critical"], ["dodge", "dodge"], ["critAvoid", "critAvoid"]] : [] ) {
    if ( combat[name] === plain[name] ) continue;
    multiplied.push({ name: [...new Set(scaled.filter((entry) => entry.key === key).map((entry) => entry.label))].join(", "), stats: {}, combat: { [key]: combat[name] - plain[name] } });
  }

  // One combat number traded for another, from the numbers the unit now has. A unit that is kept from
  // critical hits has no Critical to give
  const supported = parity ? { endurance: 0, haste: 0, activation: 0 } : { endurance: unit.endurance ?? 0, haste: unit.haste ?? 0, activation: unit.activation ?? 0 };
  const traded = settleTrades(totals.trades, {
    accuracy: combat.accuracy,
    critical: combat.critical,
    dodge: combat.dodge,
    endurance: supported.endurance + totals.endurance,
    haste: supported.haste + totals.haste
  }, { canCrit: !totals.rules.has("noCrit") && !foeTotals?.rules.has("foeNoCrit") });
  combat.accuracy = Math.max(combat.accuracy + traded.combat.hit, 0);
  combat.critical = Math.max(combat.critical + traded.combat.critical, 0);
  combat.dodge = Math.max(combat.dodge + traded.combat.dodge, 0);
  combat.damage = Math.max(combat.damage + traded.combat.damage, 0);

  // Chances to activate, with their numbers worked out from what the unit fights with
  const held = viewOf(unit);
  const view = {
    ...held,
    weapon: held.weapon ? { ...held.weapon, damageStat: weapon?.damageStat ?? held.weapon.damageStat } : null,
    shield,
    stats,
    combat,
    shieldBlock: shieldAmount(shield, totals.block)
  };
  const options = {
    activation: (totals.combat.activation ?? 0) + supported.activation + (foeTotals?.foeActivation ?? 0),
    always: totals.rules.has("alwaysActivate"),
    inflictChance: totals.bends?.inflictChance ?? null
  };
  const procs = Object.fromEntries(PROC_TRIGGERS.map((on) => [on, []]));
  for ( const raw of totals.procs ) {
    // A skill another unit made sure of activates whenever its moment comes
    const proc = resolveProc(raw, view, fight, totals.assured?.has(raw.skill) ? { ...options, always: true } : options);

    // Stats a skill gives for the whole fight as it begins: what they add to the unit's combat stats
    if ( proc.stats ) {
      const raised = { ...stats };
      for ( const [key, amount] of Object.entries(proc.stats) ) raised[key] = Math.max((raised[key] ?? 0) + amount, 0);
      const then = computeCombatStats({ ...figures, stats: raised, times: scaled }, weapon);
      proc.statCombat = {
        hit: then.accuracy - untraded.accuracy,
        critical: then.critical - untraded.critical,
        dodge: then.dodge - untraded.dodge,
        damage: then.damage - untraded.damage,
        critAvoid: then.critAvoid - untraded.critAvoid,
        attackSpeed: then.attackSpeed - untraded.attackSpeed
      };
    }

    // An attack with numbers of its own: what the unit's stats make of that Hit and Might, in place of the
    // weapon's. It is a physical attack unless it says otherwise, with the stat it names added to its Might,
    // and what burdens the unit's Attack Speed still does
    if ( proc.strike ) {
      proc.strike.combat = computeCombatStats({ stats, boosts: bare.boosts, calc: { ...(bare.calc ?? {}), ...totals.calc }, modifiers }, {
        might: proc.strike.might,
        hit: proc.strike.hit,
        crit: proc.strike.crit ?? 0,
        weight: weapon?.weight ?? 0,
        damageStat: proc.strike.stat ?? "str"
      });
    }
    procs[proc.on]?.push(proc);
  }
  // A skill may have the weapon add another stat to its Might, which also sets what resists it
  const wielded = (unit.weapon && totals.damageStat) ? { weapon: { ...unit.weapon, damageStat: totals.damageStat } } : {};

  // What the unit chose comes to this, for the fight: the totals themselves are left as they were read
  const fx = {
    ...totals,
    chances: procs,
    sources: [...totals.sources, ...lulled.sources, ...spent.sources, ...lent, ...cut, ...multiplied, ...traded.sources],

    // The stats that something outside of the unit multiplies down, by how much each
    cut: times.lowered,
    might: totals.might + spent.might,
    haste: totals.haste + traded.haste,
    taken: totals.taken + traded.taken,
    rules: traded.noCrit ? new Set([...totals.rules, "noCrit"]) : totals.rules,

    // The skills whose choice came to nothing in this fight, what the unit pays for what it spends, and the
    // steps each pick came to with the most there were, by skill and id
    idle: [...traded.idle, ...spent.idle, ...idle],
    paid: { hp: spent.hp, transforms: spent.transforms },
    picks: { ...traded.steps, ...spent.steps }
  };
  return {
    ...unit,
    ...wielded,
    ...(parity ? { shield: null, endurance: 0, haste: 0, activation: 0 } : {}),
    hp: unit.hp - spent.hp,
    stats,
    combat,
    fx,

    // What its combat stats are worked out from, for a stat that counts otherwise for one attack (see
    // `combatWith`)
    tally: { figures: { ...figures, times: scaled }, weapon }
  };
}

/* -------------------------------------------- */

/**
 * The combat stats a unit would fight with if its stats were others, everything else as it is: for a stat
 * that counts otherwise for one attack.
 * @param {Combatant & {tally?: object}} unit     A unit as `withTotals` hands it on
 * @param {Record<string, number>} stats        The stats to work them out from
 * @returns {Record<string, number>|null}       Null for a unit whose numbers cannot be worked out again
 */
export function combatWith(unit, stats) {
  if ( !unit?.tally ) return null;
  return computeCombatStats({ ...unit.tally.figures, stats }, unit.tally.weapon);
}

/* -------------------------------------------- */

/**
 * Begin working out what skills do in an exchange. Effects that do not depend on who can counter-attack are
 * read at once; `settle` reads the rest once that is known.
 * @param {Combatant} initiator
 * @param {Combatant} defender
 * @param {number} distance
 * @param {{initiator?: object|null, defender?: object|null}} [reach]
 *        How far each unit's weapon reaches by itself, nearest and farthest, for skills that ask
 * @param {object} [options]
 * @param {{initiator?: string[], defender?: string[]}|null} [options.foiled]
 *        The skills each unit chose for this fight that a skill of its foe brought to nothing
 * @param {{initiator?: string[], defender?: string[]}|null} [options.lapsed]
 *        The parts of the fight that are over for each unit, for its effects that last only until then
 * @returns {{units: {initiator: Combatant, defender: Combatant}, parity: string|null,
 *   settle: (answers: {initiator: boolean, defender: boolean}, known?: object) => {initiator: Combatant, defender: Combatant}}|null}
 *          Null when neither unit carries skills, so that nothing changes for them. `parity` names the skill
 *          that cancels what terrain, supports, weapons, equipment and skills do in this fight, if one does.
 *          `settle` may be told what else the fight has come to, by side: `slays` (the Special Qualities a
 *          side's attacks are effective against), `effective` (those of its foe they are effective for),
 *          `blocked` (why it makes no attack) and `follows` (whether it makes a follow-up attack)
 */
export function prepareSkills(initiator, defender, distance, reach = {}, { foiled = null, lapsed = null } = {}) {
  const given = { initiator, defender };
  if ( !SIDES.some((side) => skilled(given[side])) ) return null;

  const views = { initiator: viewOf(initiator, reach.initiator ?? null), defender: viewOf(defender, reach.defender ?? null) };
  const nihil = Object.fromEntries(SIDES.map((side) => {
    return [side, skilled(given[side]) && hasNihil(given[side].skills, views[side])];
  }));

  // A unit may cancel what skills do in this fight for both, as Parity has it, unless its foe stops that
  const parity = SIDES.map((side) => (skilled(given[side]) ? hasParity(given[side].skills, views[side], nihil[other(side)]) : null)).find(Boolean) ?? null;
  const fight = (side, answers = null, known = null) => ({
    role: side === "initiator" ? "initiating" : "defending",
    distance,
    foe: views[other(side)],
    foeCounters: answers ? answers[other(side)] : null,
    counters: answers ? answers[side] : null,

    // What is known of the foe once the fight is planned that far: what its attacks are effective against,
    // and whether they are against this unit; why it makes no attack; whether it follows up; and the stats of
    // its that are lowered
    foeSlays: known?.slays?.[other(side)] ?? null,
    foeEffective: known?.effective?.[other(side)] ?? null,
    foeBlocked: known?.blocked?.[other(side)] ?? null,
    foeFollows: (typeof known?.follows?.[other(side)] === "boolean") ? known.follows[other(side)] : null,
    foeDebuffs: known?.debuffs?.[other(side)] ?? null
  });

  // Each unit's own skills, and what it receives from the skills of the units around it. Such an aura is not
  // a skill of the unit fought, so Nihil leaves it alone, unless it is the foe itself that gives it
  const lists = Object.fromEntries(SIDES.map((side) => {
    if ( !skilled(given[side]) ) return [side, []];
    const foeId = given[other(side)].near?.id;
    const auras = (given[side].auras ?? []).filter((aura) => !(aura.sourceNihil && nihil[side] && foeId && (aura.from === foeId)));
    return [side, [...given[side].skills, ...timedEntries(given[side].timed), ...auras]];
  }));
  const read = (side, phase, answers, into, known = null) => {
    if ( !skilled(given[side]) ) return into ?? emptyTotals();
    return skillTotals(lists[side], views[side], {
      fight: fight(side, answers, known), foeNihil: nihil[other(side)], phase, into, parity: !!parity, foiled: foiled?.[side] ?? null, lapsed: lapsed?.[side] ?? null
    });
  };
  const fights = { parity: !!parity };

  const early = { initiator: read("initiator", "early"), defender: read("defender", "early") };
  const units = {
    initiator: withTotals(initiator, early.initiator, fight("initiator"), early.defender, fights),
    defender: withTotals(defender, early.defender, fight("defender"), early.initiator, fights)
  };
  // The stats of a unit that are lowered, as its foe's skills count them: by a condition, as its own skills
  // leave that; by a change that lasts on it or an aura; and by a skill of its foe, in this fight. How many of
  // its stats, and by how much in all
  const debuffs = (side) => {
    const lowered = { ...(early[side].lowered ?? {}) };
    const add = (key, amount) => {
      if ( amount ) lowered[key] = (lowered[key] ?? 0) + amount;
    };
    const suffered = {};
    for ( const source of conditionModifiers(given[side].conditions ?? {}) ) {
      for ( const [key, amount] of Object.entries(source.stats ?? {}) ) suffered[key] = (suffered[key] ?? 0) + amount;
    }
    for ( const source of skilled(given[side]) ? sufferedSources(early[side].bends, given[side].conditions ?? {}) : [] ) {
      for ( const [key, amount] of Object.entries(source.stats ?? {}) ) suffered[key] = (suffered[key] ?? 0) + amount;
    }
    for ( const [key, amount] of Object.entries(suffered) ) if ( amount < 0 ) add(key, amount);
    const relief = early[side].bends?.debuffs;
    for ( const { skill, stats } of early[other(side)].foeStats ?? [] ) {
      if ( (given[side].timed ?? []).some((change) => (change.name === skill) && change.from) ) continue;
      for ( const [key, amount] of Object.entries(stats) ) {
        if ( amount < 0 ) add(key, relief ? (relief.negate ? 0 : Math.min(amount + (relief.stats ?? 0), 0)) : amount);
      }
    }
    // And by what multiplies a stat down from outside of the unit, as a stat that is halved for a while
    for ( const [key, amount] of Object.entries(units[side].fx?.cut ?? {}) ) add(key, amount);
    const found = DEBUFF_STATS.filter((key) => (lowered[key] ?? 0) < 0);
    return { count: found.length, sum: found.reduce((sum, key) => sum - lowered[key], 0) };
  };
  const settle = (answers, known = null) => {
    const told = { ...(known ?? {}), debuffs: { initiator: debuffs("initiator"), defender: debuffs("defender") } };
    const late = {
      initiator: read("initiator", "late", answers, early.initiator, told),
      defender: read("defender", "late", answers, early.defender, told)
    };
    return {
      initiator: withTotals(initiator, late.initiator, fight("initiator", answers, told), late.defender, fights),
      defender: withTotals(defender, late.defender, fight("defender", answers, told), late.initiator, fights)
    };
  };
  return { units, settle, parity };
}

/* -------------------------------------------- */

/**
 * How many times each attack with a weapon strikes, as its Effect says: "2x Strikes", "2x Strikes when
 * initiating combat" for a unit that initiates, or "2x Strikes when attacking at 1 range" at that distance.
 * Strikes a weapon only offers as a choice are left to the table.
 * @param {string} [effect]             The weapon's Effect
 * @param {object} [fight]
 * @param {boolean} [fight.initiating]
 * @param {number} [fight.distance]
 * @returns {number}
 */
export function weaponStrikes(effect, { initiating = false, distance = 1 } = {}) {
  const text = String(effect ?? "");
  const pattern = /(\d+)\s*x\s+strikes(?:\s+when\s+(initiating(?:\s+combat)?|attacking\s+at\s+(\d+)\s+range))?/gi;
  let strikes = 1;
  for ( const match of text.matchAll(pattern) ) {
    if ( /choose/i.test(text.slice(Math.max(match.index - 60, 0), match.index)) ) continue;
    if ( match[3] && (Number(match[3]) !== distance) ) continue;
    if ( match[2] && !match[3] && !initiating ) continue;
    strikes = Math.max(strikes, Number(match[1]));
  }
  return strikes;
}

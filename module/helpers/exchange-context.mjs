import { FEO } from "../config.mjs";
import { clockOf } from "./clock.mjs";
import { HARM_FOILS } from "../rules/answers.mjs";
import { settleArt } from "../rules/arts.mjs";
import { sureCritical, planFormations, spreadForecast } from "../rules/combat.mjs";
import { fightBattalions } from "../rules/battalions.mjs";
import { breakAfter, breakInUse } from "../rules/breaking.mjs";
import { captureOutcome } from "../rules/capturing.mjs";
import { readConditions } from "../rules/conditions.mjs";
import { spanOf, strikesAfter } from "../rules/rounds.mjs";
import { spendSkill, turnsToSitOut } from "../rules/skill-usage.mjs";
import { transformsLeft } from "../rules/shifting.mjs";
import { hpHolds } from "../rules/skills.mjs";
import { isStaggered, staggerHit, staggerInUse, staggerOf } from "../rules/stagger.mjs";
import { grantChange, readsCount, spendOnce, timedName } from "../rules/timed.mjs";
import { cleanWielded, lastWielded } from "../rules/triangle.mjs";
import { fcmInUse } from "../rules/variants.mjs";
import { goesSpent } from "./acting.mjs";
import { aftermathLines, recordOf } from "./aftermath.mjs";
import { battalionLines, commandOf } from "./battalion-context.mjs";
import { conditionKeys } from "./condition-context.mjs";
import { describeChange } from "./timed-context.mjs";
import { describeSpread, forecastSpreads } from "./spread-context.mjs";

/**
 * Display data for a combat exchange: the forecast shown before the dice are rolled and the chat card posted
 * afterwards. Nothing here touches Foundry, so that it can be tested outside of it; strings are localized
 * through whatever `i18n` is passed in.
 *
 * @import {Combatant, ExchangePlan, ExchangeResult} from "../rules/combat.mjs"
 */

/**
 * @typedef Localizer
 * @property {(key: string) => string} localize
 * @property {(key: string, data: object) => string} format
 */

/**
 * @typedef ExchangeChange
 * What an exchange changes about one unit. Only the parts that changed are present.
 * @property {number} [hp]                                              Current HP after the exchange
 * @property {{id: string, uses: number}} [weapon]                      The weapon's remaining uses
 * @property {{id: string, uses: number}} [shield]                      The remaining uses of the Shield it has
 *                                                                      equipped, which breaks without any
 * @property {Record<string, {rank: string, wexp: number}>} [proficiencies]
 * @property {Record<string, number|null>} [conditions]                 Turns left for each condition that was
 *                                                                      gained or changed; null for one that ended
 * @property {{id: string, name: string, state: object}[]} [skills]     Declared skills the fight spent, with
 *                                                                      where each now stands
 * @property {import("../rules/timed.mjs").TimedChange[]} [timed]       The changes that last a while which
 *                                                                      the unit carries after the fight
 * @property {number} [gold]                                            Gold its skills earned it
 * @property {{id: string|null, name: string, hp: number, uses: number, broke: boolean}} [art]
 *                                                                      The Combat Art it performed, which is
 *                                                                      no longer readied, and what it cost
 * @property {{rank: string, exp: number}} [authority]                  Its Authority, once it has earned
 *                                                                      Authority EXP
 * @property {{id: string, hp?: number, level?: number, exp?: number, uses?: number}} [battalion]
 *                                                                      What changed about the Battalion it
 *                                                                      commands: its HP, its level and EXP,
 *                                                                      the uses its Gambit has left
 * @property {boolean} [announce]                                       Is a unit that goes down by this to be
 *                                                                      told of on a card of its own?
 * @property {boolean} [break]                                          Whether it suffers from Break after the
 *                                                                      fight, where that changed
 * @property {false} [capturing]                                        Its attempt to capture is readied no
 *                                                                      longer
 * @property {{by: string, name: string, hp: number, held: boolean}} [captured]
 *                                                                      It was captured: by whom, the HP it had
 *                                                                      before, and whether it is carried
 * @property {{uuid: string, name: string, held: boolean, turns: number}|null} [captive]
 *                                                                      The unit it captured or subdued; null
 *                                                                      once it holds none
 * @property {boolean} [freed]                                          A captive that is free again, put back
 *                                                                      `at` a place on the map if one is given
 * @property {boolean} [released]                                       A captive that was let go, and leaves
 * @property {import("../rules/stagger.mjs").StaggerBar|null} [stagger] Where the world plays with Stagger: the
 *                                                                      unit's Stagger bar after the fight where
 *                                                                      the fight changed it, else null. Either
 *                                                                      way the fight has settled what the HP
 *                                                                      the unit lost in it does to its bar
 */

const SIDES = ["initiator", "defender"];

/** Trim a number that may carry a fraction, such as weapon experience, to two decimal places. */
const tidy = (value) => Number(Number(value).toFixed(2));

/** Write a number with its sign. */
const signed = (value) => `${value > 0 ? "+" : "−"}${Math.abs(value)}`;

/**
 * What a Combat Art costs, in words: "3 HP, 5 uses".
 * @param {{hp: number, uses: number}} cost
 * @param {Localizer} i18n
 * @returns {string}
 */
export function artCostLabel(cost, i18n) {
  const parts = [];
  if ( cost?.hp > 0 ) parts.push(i18n.format("FEO.Optional.combatArts.cost.hp", { amount: cost.hp }));
  if ( cost?.uses > 0 ) parts.push(i18n.format("FEO.Optional.combatArts.cost.uses", { amount: cost.uses }));
  return parts.length ? parts.join(", ") : i18n.localize("FEO.Optional.combatArts.cost.none");
}

/**
 * The skill of a unit that bends a combat rule, by name, for a line that names it.
 * @param {Combatant} unit
 * @param {string} rule
 * @param {Localizer} i18n
 * @returns {string}
 */
function ruleSkill(unit, rule, i18n) {
  // A change that lasts on the unit may give it the rule as well as a skill of its own
  const found = [...(unit.skills ?? []), ...(unit.timed ?? [])].find((skill) => (skill.effects ?? []).some((effect) => effect.rules?.includes(rule)));
  return found?.name ?? i18n.localize("FEO.Section.skills");
}

/**
 * Describe what a condition changes about a strike.
 * @param {import("../rules/conditions.mjs").StrikeNote} note
 * @param {Localizer} i18n
 * @returns {string}
 */
function describeNote(note, i18n) {
  return i18n.format(`FEO.Exchange.note.${note.key}`, {
    condition: i18n.localize(conditionKeys(note.id).name),
    hit: signed(note.hit ?? 0),
    critical: signed(note.critical ?? 0),
    amount: signed(note.amount ?? 0),
    element: note.element ? i18n.localize(FEO.weaponCategories[note.element]?.label ?? note.element) : "",
    multiplier: note.multiplier,
    percent: note.percent,
    chance: note.chance,
    cap: note.cap
  });
}

/**
 * Describe a condition a weapon inflicts on a hit.
 * @param {import("../rules/conditions.mjs").Infliction} infliction
 * @param {Localizer} i18n
 * @returns {string}
 */
function describeInfliction(infliction, i18n) {
  const condition = i18n.localize(conditionKeys(infliction.id).name);
  if ( infliction.otherwise ) return i18n.format("FEO.Exchange.inflictsOtherwise", { condition });
  if ( infliction.chance >= 100 ) return i18n.format("FEO.Exchange.inflicts", { condition });
  return i18n.format("FEO.Exchange.inflictsChance", { condition, chance: infliction.chance });
}

/* -------------------------------------------- */

/**
 * Describe a unit as the combat rules need it: its numbers with the weapon in hand.
 * @param {Actor} actor
 * @param {string} [name]   The name to show, when it differs from the Actor's
 * @param {object} [options]
 * @param {boolean} [options.incapacitates]   Does the Incapacitation system apply to the unit, so that damage
 *                                            past 0 HP is kept?
 * @param {{near: object, auras: object[]}|null} [options.place]
 *                                            Where the unit stands: the units around it and the auras it
 *                                            receives. Without it the unit has nothing around it
 * @param {import("../rules/movement.mjs").Movement|null} [options.move]
 *                                            How the unit moved this turn. Without it that cannot be judged
 * @returns {Combatant}
 */
export function combatantOf(actor, name, { incapacitates = false, place = null, move = null } = {}) {
  const system = actor.system;
  const item = system.equippedWeapon;
  const statuses = actor.statuses ?? new Set();
  const afflicted = (flag) => Object.entries(FEO.conditions).some(([id, condition]) => {
    return condition[flag] && statuses.has(id);
  });

  // The unit's numbers without its skills, which the exchange adds the skills to once the fight is known
  let bare;
  if ( system.bare && system.skills ) {
    const stats = { ...system.bare.stats };
    for ( const [key, bonus] of Object.entries(system.shift?.inCombat ?? {}) ) {
      if ( key in stats ) stats[key] = Math.max(stats[key] + bonus, 0);
    }
    const mastery = system.masteryFor?.(item?.system ?? null);
    bare = {
      stats,
      base: system.bare.base,
      boosts: system.combatBoosts,
      calc: system._source?.calc ?? system.calc,
      modifiers: mastery ? [mastery, ...system.bare.modifiers] : system.bare.modifiers,
      accuracy: system.bare.accuracy,
      weapon: item ? { hit: item.system.hit, crit: item.system.crit, weight: item.system.weight, rank: item.system.rank } : null
    };
  }
  return {
    name: name ?? actor.name,
    // Temporary HP count with its own in a fight: they are lost first, as the fight is saved
    hp: system.hp.value + (system.hp.temp ?? 0),
    hpMax: system.hp.max + (system.hp.temp ?? 0),
    conditions: system.conditions ?? readConditions(actor.effects, statuses),
    stats: system.battleValues ?? system.statValues,
    endurance: system.endurance ?? 0,
    haste: system.support?.hst ?? 0,
    activation: system.support?.activation ?? 0,
    gold: system.gold ?? 0,
    wlvRank: system.weaponLevel?.used ? system.weaponLevel.rank : null,
    incapacitated: !!system.defeat?.down,
    resilience: (incapacitates && system.defeat) ? (system.defeat.resilience ?? 0) : undefined,
    record: recordOf(actor),
    level: system.level,
    tier: system.classTier,
    gender: system.profile?.gender ?? "",
    bestRank: system.bestRank ?? "",
    waiting: !!system.waiting,
    shifted: !!system.shift?.transformed,

    // The transformations a stone still has for it this turn once this fight has had its own, and the turns
    // its skills add to every cooldown, for what it chooses before a fight (see `rules/choices.mjs`)
    transforms: ((system.shift?.mode === "stone") && !system.shift.bends?.endless) ? Math.max(transformsLeft(system.shift.uses, system.shift.limit) - 1, 0) : 0,
    cooldowns: system.skills?.cooldowns ?? 0,
    skills: bare ? system.skills.entries : undefined,
    near: place?.near ?? null,
    move,

    // The turn of the battle it is in and the Phase that is running, for a skill that asks the clock
    clock: clockOf(actor),
    goes: goesSpent(actor),

    // The attacks that were made against it since its own turn began, for a skill that counts them (see
    // `rules/rounds.mjs`)
    attacked: Math.max(Math.floor(Number(actor.getFlag?.(FEO.id, "attacked"))) || 0, 0),

    // What it has done with its weapons, for a skill that has one weapon hand something to the next (see
    // `rules/triangle.mjs`): whether the weapon in hand has yet to attack since it was taken in hand, and the
    // weapons it last attacked with
    wielded: { fresh: !item?.getFlag?.(FEO.id, "swung"), last: cleanWielded(actor.getFlag?.(FEO.id, "wielded")) ?? [] },
    auras: place?.auras ?? [],
    timed: JSON.parse(JSON.stringify(system.timed ?? [])),
    uuid: actor.uuid ?? "",
    bare,
    combat: Object.fromEntries(Object.entries(system.combat).map(([key, stat]) => [key, stat.value])),
    weapon: item ? {
      id: item.id,
      name: item.name,
      category: item.system.category,
      might: item.system.might,
      range: item.system.range,
      effect: item.system.effect,
      damageStat: item.system.damageStat,
      wexp: item.system.wexp,
      uses: { value: item.system.uses.value, max: item.system.uses.max }
    } : null,

    // The weapons it carries and cannot wield, for a skill that counts them
    unusable: system.unusable ?? 0,

    // The weapons and tomes it carries, for an answer that spends the uses of one (see `rules/answers.mjs`)
    carried: actor.items.filter((entry) => (entry.type === "weapon") && !entry.system.broken).map((entry) => ({
      id: entry.id,
      name: entry.name,
      img: entry.img,
      category: entry.system.category,
      might: entry.system.might,
      effect: entry.system.effect,
      uses: { value: entry.system.uses.value, max: entry.system.uses.max }
    })),

    // The Shield it has equipped, and what it is beyond its Special Qualities, for a Shield that asks
    shield: system.equippedShield?.system.asShield ?? null,
    kin: `${system.classItem?.system.race ?? ""} ${system.className ?? ""}`.trim(),
    proficiencies: Object.fromEntries(Object.entries(system.proficiencies).map(([key, { rank, wexp }]) => {
      return [key, { rank, wexp }];
    })),
    qualities: system.specialQualities,

    // Battalions & Gambits: its Authority and the Battalion it commands, where the world plays with them
    ...(commandOf(actor) ?? {}),

    // Breaking: whether it suffers from Break, where the world plays with it
    ...(breakInUse() ? { break: !!system.break } : {}),

    // Stagger: its Stagger bar as it stands, where the world plays with it
    ...(staggerInUse() ? { stagger: staggerOf(system._source?.stagger ?? system.stagger, system.hp.value) } : {}),

    // Follow-up Critical Multiplier: its FCM, where the world plays with it
    ...(fcmInUse() ? { fcm: system.fcm } : {}),
    noCounter: afflicted("noCounter"),
    noDodge: afflicted("noDodge")
  };
}

/* -------------------------------------------- */

/**
 * An element of damage by its name, as the weapons of that kind are called: "Fire".
 * @param {string|null} element
 * @param {Localizer} i18n
 * @returns {string}
 */
export function elementName(element, i18n) {
  const label = FEO.weaponCategories[element]?.label;
  return label ? i18n.localize(label) : (element ?? "");
}

/* -------------------------------------------- */

/**
 * The weapon triangle of a fight in a few words, with what skills made of it: "Weapon triangle ×2 (Trilemma)".
 * @param {ExchangePlan} plan
 * @param {Localizer} i18n
 * @returns {string}
 */
export function triangleLabel(plan, i18n) {
  const triangle = plan.triangle ?? {};
  const label = (triangle.times !== undefined) ? i18n.format("FEO.Triangle.times", { times: triangle.times }) : i18n.localize("FEO.Exchange.triangle");
  const skills = [...new Set([...(triangle.skills ?? []), ...(triangle.spared ?? [])])];
  return skills.length ? i18n.format("FEO.Triangle.by", { label, skills: skills.join(", ") }) : label;
}

/* -------------------------------------------- */

/**
 * What the weapon in hand takes from the one its unit attacked with before, in a few words: "Symbiosis: +3 Mt,
 * +20 Hit from Flux on the first attack". What comes to nothing is left out.
 * @param {{skill: string, weapon: string, might: number, hit: number, critical: number}} handed
 * @param {Localizer} i18n
 * @returns {string}
 */
export function handedLabel(handed, i18n) {
  const gains = [["might", "FEO.Weapon.mightAbbr"], ["hit", "FEO.Combat.hit"], ["critical", "FEO.Combat.critAbbr"]]
    .filter(([key]) => handed[key])
    .map(([key, label]) => `${signed(handed[key])} ${i18n.localize(label)}`);
  return i18n.format("FEO.Triangle.handed", { skill: handed.skill, weapon: handed.weapon, gains: gains.join(", ") });
}

/* -------------------------------------------- */

/**
 * Build the forecast for an exchange: each side's chances, damage and number of attacks.
 * @param {ExchangePlan} plan
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {number|null} [options.measured]    The distance measured between the two tokens, if it could be
 * @returns {object}
 */
export function buildForecast(plan, i18n, { measured = null } = {}) {
  // What the skills of both would do to the units around, each named for its side with every unit it would catch
  const reaching = forecastSpreads(spreadForecast(plan), i18n);
  const sides = SIDES.map((key) => {
    const side = plan[key];
    const foe = plan[key === "initiator" ? "defender" : "initiator"];
    const unit = side.unit;
    const active = !side.blocked;

    const tags = [];

    // The weapon triangle, with what skills made of it: what multiplies it, and the skills that had a say
    if ( side.triangle ) {
      const bent = [
        (plan.triangle?.times !== undefined) ? `×${plan.triangle.times}` : "",
        (plan.triangle?.skills ?? []).join(", ")
      ].filter(Boolean).join(" · ");
      const text = i18n.format(side.triangle > 0 ? "FEO.Exchange.advantage" : "FEO.Exchange.disadvantage", {
        hit: signed(side.triangleHit),
        damage: signed(side.triangleDamage)
      });
      tags.push({ label: bent ? `${text} (${bent})` : text, cls: side.triangle > 0 ? "good" : "bad" });
    }
    else if ( plan.triangle?.spared?.length && (key === "initiator") ) {
      tags.push({ label: i18n.format("FEO.Triangle.spared", { skills: plan.triangle.spared.join(", ") }), cls: "cond" });
    }

    // What the weapon in hand takes from the one its unit attacked with before, for its first attack
    if ( active && side.handed ) tags.push({ label: handedLabel(side.handed, i18n), cls: "good" });
    if ( active && side.effective.length ) tags.push({
      label: i18n.format("FEO.Exchange.effective", {
        qualities: side.effective.join(", "),
        multiplier: side.mightMultiplier
      }),
      cls: "good"
    });
    if ( active && side.doubles ) tags.push({ label: i18n.localize("FEO.Exchange.followUp"), cls: "good" });

    // What every hit of this side deals again as damage of an element
    for ( const echo of active ? (side.echoes ?? []) : [] ) tags.push({
      label: i18n.format("FEO.Formula.echoTag", { skill: echo.skill, percent: echo.percent, element: elementName(echo.element, i18n) }),
      cls: "good"
    });

    // Follow-up Critical Multiplier: what this side's Critical is multiplied by on its follow-up attack, and
    // the chance of a critical hit that makes
    if ( active && side.fcm ) tags.push({
      label: i18n.format("FEO.Optional.fcm.forecast", { times: side.fcm, chance: side.critFollow }),
      cls: "good"
    });

    // Breaking: a hit of this side that deals damage takes the foe's counter-attack
    if ( active && side.breaks ) tags.push({ label: i18n.localize("FEO.Optional.breaking.forecast"), cls: "good" });

    // Stagger: a Staggered unit takes more from every hit; else the bar of the unit that is attacked, which
    // what it loses in this fight comes off
    const bar = staggerInUse() ? (unit.stagger ?? null) : null;
    if ( bar && isStaggered(bar) ) tags.push({ label: i18n.localize("FEO.Optional.stagger.forecast.staggered"), cls: "bad" });
    else if ( bar && (key === "defender") && !foe.blocked ) tags.push({
      label: i18n.format("FEO.Optional.stagger.forecast.bar", { value: bar.value, max: bar.max }),
      cls: "cond"
    });

    for ( const entry of reaching.filter((found) => found.by === key) ) {
      tags.push({ label: `${entry.label} (${entry.hint})`, cls: (entry.tone === "good") ? "good" : "cond" });
    }

    // Capturing: the attempt this side makes, a target that is captured without a fight, or why this target
    // cannot be captured
    const attempt = unit.capture;
    if ( attempt?.ok && attempt.outright && (plan.distance <= 1) ) tags.push({
      label: i18n.format("FEO.Optional.capturing.forecast.outright", { name: foe.unit.name, why: i18n.localize(`FEO.Optional.capturing.outright.${attempt.outright}`) }),
      cls: "good"
    });
    else if ( attempt?.ok ) tags.push({
      label: i18n.localize(`FEO.Optional.capturing.forecast.${plan.distance <= 1 ? "attempt" : "ranged"}`),
      cls: "cond"
    });
    else if ( attempt ) tags.push({
      label: i18n.format("FEO.Optional.capturing.forecast.cannot", {
        name: foe.unit.name,
        why: i18n.format(`FEO.Optional.capturing.cannot.${attempt.why}`, { qualities: (attempt.qualities ?? []).join(", ") })
      }),
      cls: "bad"
    });

    // The Combat Art this side performs, with what it costs; what the system leaves of it to the table; and
    // one that was readied and cannot be performed
    if ( active && side.art ) {
      tags.push({ label: i18n.format("FEO.Optional.combatArts.forecast.art", { art: side.art.name, cost: artCostLabel(side.art.cost, i18n) }), cls: "good art" });
      if ( side.art.left ) tags.push({ label: i18n.format("FEO.Optional.combatArts.forecast.left", { art: side.art.name, text: side.art.left }), cls: "bad check" });
    }
    if ( unit.artBlocked ) tags.push({
      label: i18n.format("FEO.Optional.combatArts.forecast.blocked", { art: unit.artBlocked.name, why: i18n.localize(`FEO.Optional.combatArts.blocked.${unit.artBlocked.why}`) }),
      cls: "bad"
    });

    // What conditions change about the attacks of this side, what its weapon inflicts, and what it cannot do
    if ( active ) {
      for ( const note of side.notes ?? [] ) tags.push({ label: describeNote(note, i18n), cls: "cond" });
      for ( const infliction of side.inflicts ?? [] ) tags.push({ label: describeInfliction(infliction, i18n), cls: "cond" });
    }
    for ( const id of side.warnings ?? [] ) {
      const { name, hint } = conditionKeys(id);
      tags.push({ label: `${i18n.localize(name)}: ${i18n.localize(hint)}`, cls: "bad" });
    }
    if ( active && foe.unit.incapacitated ) tags.push({ label: i18n.localize("FEO.Defeat.alwaysHit"), cls: "good" });
    if ( active && (side.strikes > 1) ) tags.push({ label: i18n.format("FEO.Exchange.strikes", { strikes: side.strikes }), cls: "good" });
    if ( active && side.backfire ) tags.push({ label: i18n.format("FEO.Exchange.backfireChance", { chance: side.backfire.chance }), cls: "bad" });

    // A foe that dodges every hit that would be fatal to it, when this side's first hit would be
    if ( active && side.evaded ) tags.push({
      label: i18n.format("FEO.Exchange.fatalDodge", { cap: FEO.fatalDodge.hitCap, name: foe.unit.name, skill: ruleSkill(foe.unit, "dodgeFatal", i18n) }),
      cls: "bad"
    });
    if ( side.skills?.length ) tags.push({ label: i18n.format("FEO.Exchange.skills", { skills: side.skills.join(", ") }), cls: "cond" });

    // What this side chose before the fight (see `rules/choices.mjs`): one attack in place of several, skills
    // a skill of the foe stops, skills that are switched on and come to nothing here, a foe whose skill holds
    // a hit to a share of its HP, and what cancels skills for both
    if ( active && side.lone ) tags.push({ label: i18n.format("FEO.Choice.single", { skill: side.lone.skill, attacks: side.lone.attacks }), cls: "good" });
    if ( side.stopped?.length ) tags.push({
      label: i18n.format("FEO.Choice.stoppedTag", { skill: ruleSkill(foe.unit, "nihil", i18n), skills: side.stopped.join(", ") }),
      cls: "bad"
    });
    if ( side.idle?.length ) tags.push({ label: i18n.format("FEO.Choice.idleTag", { skills: side.idle.join(", ") }), cls: "cond" });
    if ( active && (side.cap !== null) && (side.cap !== undefined) ) tags.push({
      label: i18n.format("FEO.Choice.cap", { skill: (side.cappedBy ?? []).join(", "), amount: side.cap, name: foe.unit.name }),
      cls: "bad"
    });
    if ( plan.parity && (key === "initiator") ) tags.push({ label: i18n.format("FEO.Choice.parity", { skill: plan.parity }), cls: "cond" });

    // A fight of several rounds, as a skill used as an action starts one, and what this side gains for its
    // lead in Attack Speed (see `rules/rounds.mjs`)
    if ( plan.rounds && (key === "initiator") ) tags.push({ label: roundsLabel(plan.rounds, i18n), cls: "good" });
    if ( active && side.led ) tags.push({
      label: i18n.format("FEO.Round.forecast.led", { skill: side.led.skill, damage: signed(side.led.damage), hit: signed(side.led.hit), critical: signed(side.led.critical) }),
      cls: "good"
    });

    // What the units around give or take, each named with the unit it comes from, and the skills that are
    // shown for the table to check: those the system cannot judge at all, and those of a unit off the map
    if ( side.auras?.length ) tags.push({ label: i18n.format("FEO.Exchange.auras", { skills: side.auras.join(", ") }), cls: "cond aura" });
    if ( side.lasting?.length ) tags.push({ label: i18n.format("FEO.Exchange.lasting", { skills: side.lasting.join(", ") }), cls: "cond lasting" });
    for ( const [unseen, key] of [[false, "FEO.Exchange.checks"], [true, "FEO.Exchange.unseen"]] ) {
      const names = (side.checks ?? []).filter((entry) => entry.unseen === unseen).map((entry) => entry.skill);
      if ( names.length ) tags.push({ label: i18n.format(key, { skills: names.join(", ") }), cls: "bad check" });
    }

    // This side's skills that wait for a moment of the fight, with their chance when they have to roll for
    // it: what its own attacks set off, what the foe's attacks set off, and what frames the fight. Those that
    // cannot come up in this fight are left out
    const chances = [];
    for ( const on of active ? ["attack", "hit", "crit", "miss", "kill"] : [] ) chances.push(...(side.chances?.[on] ?? []));
    for ( const on of active ? ["critMiss"] : [] ) chances.push(...(side.chances?.[on] ?? []));
    for ( const on of !foe.blocked ? ["struck", "dodged", "attacked", "landing"] : [] ) chances.push(...(side.chances?.[on] ?? []));

    // What waits for a block: this side's attacks being blocked, where its foe blocks with anything, and its
    // own blocks, where it does. And what waits for what a hit comes to: one of its own that is curbed, one it
    // takes that deals nothing
    const blocks = (proc, guard) => !proc.by || (proc.by === guard.kind);
    if ( active && side.block ) chances.push(...(side.chances?.blocked ?? []).filter((proc) => blocks(proc, side.block)));
    if ( !foe.blocked && foe.block ) {
      // An attack of its own that cannot be made from here is left out
      for ( const on of ["block", "blockFail"] ) {
        chances.push(...(side.chances?.[on] ?? []).filter((proc) => blocks(proc, foe.block) && (!proc.strike || proc.strike.able)));
      }
    }
    if ( active ) chances.push(...(side.chances?.curbed ?? []));
    if ( !foe.blocked ) chances.push(...(side.chances?.unhurt ?? []));
    for ( const on of plan.order.length ? ["start", "after", "inflict", "afflicted", "foil", "round"] : [] ) {
      // A chance to be spared a Wound or an Injury is no chance against anything its foe does
      chances.push(...(side.chances?.[on] ?? []).filter((proc) => (on !== "foil") || proc.foils?.some((kind) => !HARM_FOILS.includes(kind))));
    }
    const told = new Set();
    for ( const proc of chances ) {
      // A skill that only has its moment once in the fight says so
      // One its owner may answer with in the middle of the fight says that, and has no chance to tell
      // What begins with a later attack, counts the attacks made against its unit or reads its chance from
      // the damage of a hit says that (see `rules/rounds.mjs`)
      const key = proc.may ? "FEO.Answer.forecast"
        : proc.from ? "FEO.Round.forecast.later"
          : proc.every ? "FEO.Round.forecast.every"
            : proc.perDamage ? "FEO.Round.forecast.perDamage"
              : proc.harmless ? "FEO.Formula.harmless"
                : (proc.sure && proc.once) ? `FEO.Exchange.once.${proc.on === "attack" ? "attack" : "other"}`
                : `FEO.Exchange.${proc.sure ? "sure" : "chance"}.${proc.on}`;

      // A skill with several effects at one moment is told once
      const label = i18n.format(key, { skill: proc.skill, chance: proc.chance, every: proc.every, percent: proc.perDamage });
      if ( told.has(label) ) continue;
      told.add(label);
      tags.push({ label, cls: "cond proc" });
    }

    // HP left if every attack against this side lands without a critical hit. A first hit may end a condition
    // that the later ones no longer profit from
    // A hit that a skill of its target holds to a share of that unit's HP is shown as what it then deals
    const held = (who, damage) => ((who.cap !== null) && (who.cap !== undefined)) ? Math.min(damage, who.cap) : damage;
    const later = held(side, side.damageLater ?? side.damage);
    const foeLater = held(foe, foe.damageLater ?? foe.damage);
    // A unit that is already down keeps damage past 0 HP, less its resilience, for every hit
    const softened = (damage) => unit.incapacitated ? Math.max(damage - (unit.resilience ?? 0), 0) : damage;
    const foeKey = key === "initiator" ? "defender" : "initiator";
    const shares = plan.order.map((who, index) => (who === foeKey ? (plan.scale?.[index] ?? 1) : null)).filter((share) => share !== null);

    // What each attack against this side deals, one after the other, as the plan has them: the later ones
    // may differ from the first (see `ExchangeSide.blows`). In a fight of several rounds, those of every round
    // it comes to if every attack lands, which ends when a unit falls
    const planned = foe.blows ?? shares.map((share, index) => {
      return { damage: held(foe, Math.floor((((index === 0) ? foe.damage : foeLater) * share) + 1e-9)) };
    });
    const against = plan.rounds ? spanOf(plan).filter((entry) => entry.key === foeKey).map((entry) => entry.blow) : planned;
    // A unit that dodges every hit that would be fatal to it is not counted as taking one. One that a skill
    // is sure to leave at 1 HP is counted that way, and as taking nothing more if the skill says so
    const dodges = !!unit.fx?.rules?.has("dodgeFatal") && (unit.hp > 0);
    const saver = (side.chances?.struck ?? []).find((proc) => proc.sure && proc.survive && (proc.survive !== true));
    const spared = !!saver?.grants?.some((grant) => grant.now && (grant.effects ?? []).some((effect) => effect.takenPercent <= -100));
    let saved = false;

    // What its own skills are sure to have it pay: as the fight begins, and once it is over if it still stands.
    // Damage that cannot kill leaves it 1 HP
    const pays = (on) => (plan.order.length && !unit.fx?.rules?.has("noSkillDamage"))
      ? (side.chances?.[on] ?? []).filter((proc) => proc.sure && (proc.pays > 0) && !proc.ifHit && !proc.ifStruck && !proc.hits && (!proc.uses || (proc.uses.left !== 0)))
      : [];
    const paying = (hp, proc) => (hp <= 0) ? hp : proc.nonlethal ? Math.max(hp - proc.pays, Math.min(hp, 1)) : Math.max(hp - proc.pays, 0);
    const paidFirst = unit.hp - pays("start").reduce(paying, unit.hp);

    // Stagger: once what the unit that is attacked has lost empties its bar, every later hit is multiplied
    let emptying = (bar && (key === "defender") && !isStaggered(bar)) ? bar : null;
    const taken = foe.blocked ? 0 : against.reduce((sum, struck) => {
      const times = (emptying?.turns > 0) ? FEO.optional.stagger.taken : 1;
      const blow = held(foe, Math.floor((softened(sureCritical(struck, foe.unit?.fx?.critMultiplier ?? FEO.critMultiplier)) * times) + 1e-9));
      const left = unit.hp - paidFirst - sum;
      if ( (dodges && (blow >= left)) || (saved && spared) ) return sum;
      if ( saver && !saved && (left > 0) && (blow >= left) && hpHolds(saver.survive.hp, left, unit.hpMax ?? unit.hp) ) {
        saved = true;
        return unit.hp - paidFirst - 1;
      }
      if ( emptying ) emptying = staggerHit(emptying, Math.min(blow, Math.max(left, 0)), { standing: blow < left });
      return sum + blow;
    }, 0);

    // A foe whose Combat Art spares this side leaves it with 1 HP at the least, for as long as the Art lasts
    const sparing = !!foe.art?.spare && (foe.art.persist || (foe.attacks <= 1));
    const hit = (sparing && (unit.hp > 0)) ? Math.min(taken, unit.hp - paidFirst - 1) : taken;
    const stands = unit.hp - paidFirst - hit;
    const lost = unit.hp - ((stands > 0) ? pays("after").reduce(paying, stands) : stands);
    return {
      key,
      role: i18n.localize(`FEO.Exchange.role.${key}`),
      name: unit.name,
      weapon: unit.weapon?.name ?? i18n.localize("FEO.Combat.unarmed"),
      hp: unit.hp,
      hpAfter: unit.incapacitated ? unit.hp - lost : Math.max(unit.hp - lost, 0),
      hpChanges: lost > 0,
      active,
      blocked: side.blocked ? i18n.localize(`FEO.Exchange.blocked.${side.blocked}`) : null,
      hit: side.hit,
      crit: side.crit,

      // The chance that the foe blocks a hit of this side, where it blocks with anything, and what with
      block: (active && side.block) ? side.block.chance : null,
      blockWith: (active && side.block) ? side.block.name : null,

      // The chance of a critical hit with the follow-up attack, where it is another than the first attack's
      critFollow: (active && side.fcm && (side.critFollow !== side.crit)) ? side.critFollow : null,
      damage: side.blows?.[0]?.damage ?? held(side, side.damage),
      damageLater: (side.attacks > 1) && (later !== held(side, side.damage)) ? later : null,
      attacks: side.attacks,
      repeats: side.attacks > 1,

      // What each of its attacks deals, one after the other, and in a few signs what follows the first: "× 2"
      // where they all deal the same, the numbers themselves where they do not
      strikes: active ? (side.blows ?? []).map((blow, index) => ({
        n: index + 1, damage: blow.damage, hit: blow.hit, crit: blow.crit, kind: blow.kind ?? "open", eased: blow.eased ?? []
      })) : [],
      more: active ? strikesAfter(side.blows ?? [], side.attacks) : "",
      varied: active && (side.blows ?? []).some((blow) => blow.damage !== side.blows[0].damage),
      chances: chances.map((proc) => {
        if ( proc.may ) return { skill: proc.skill, on: proc.on, may: true };
        return proc.sure ? { skill: proc.skill, on: proc.on, sure: true } : { skill: proc.skill, on: proc.on, chance: proc.chance };
      }),
      tags
    };
  });

  return {
    distance: plan.distance,
    measured,
    distanceHint: measured === null
      ? i18n.localize("FEO.Exchange.distanceUnmeasured")
      : i18n.format("FEO.Exchange.distanceMeasured", { distance: measured }),
    canAttack: !plan.initiator.blocked,

    // A fight of several rounds says how many, or that it goes on until a unit falls
    rounds: plan.rounds ? roundsLabel(plan.rounds, i18n) : null,
    sides
  };
}

/* -------------------------------------------- */

/**
 * What a fight of several rounds is called in a forecast and on its card.
 * @param {{count: number, skill: string, until: string|null}} rounds
 * @param {Localizer} i18n
 * @returns {string}
 */
export function roundsLabel(rounds, i18n) {
  const skill = rounds.skill || i18n.localize("FEO.Round.fight");
  return rounds.until ? i18n.format("FEO.Round.untilFall", { skill }) : i18n.format("FEO.Round.rounds", { skill, rounds: rounds.count });
}

/* -------------------------------------------- */

/**
 * Work out what an exchange changes about each unit.
 * @param {ExchangePlan} plan
 * @param {ExchangeResult} result
 * @returns {{initiator: ExchangeChange, defender: ExchangeChange}}
 */
export function exchangeChanges(plan, result) {
  const change = (key) => {
    const outcome = result[key];
    const weapon = plan[key].unit.weapon;
    const changes = {};
    if ( outcome.hp !== outcome.hpStart ) changes.hp = outcome.hp;
    if ( weapon && outcome.usesSpent ) changes.weapon = { id: weapon.id, uses: Math.max(outcome.uses, 0) };

    // The uses its answers in the middle of the fight took off other weapons and tomes it carries
    const lost = (outcome.items ?? []).map(({ id, spent }) => {
      const item = (plan[key].unit.carried ?? []).find((entry) => entry.id === id);
      return item ? { id, uses: Math.max((item.uses?.value ?? 0) - spent, 0) } : null;
    }).filter(Boolean);
    if ( lost.length ) changes.items = lost;

    // The uses its Shield lost: to blocks, and to what the foe's skills wore off it
    const shield = plan[key].unit.shield ?? null;
    if ( shield?.id && outcome.shield?.spent ) changes.shield = { id: shield.id, uses: Math.max(outcome.shield.uses, 0) };

    // A Combat Art the unit performed: its HP was paid as the fight began, which the unit keeps even if it
    // took no damage, and its Weapon Uses are paid now, on top of what the attacks cost
    // One that a skill of the foe brought to nothing is paid for all the same
    const performing = plan[key].art ?? plan[key].artFoiled ?? null;
    const art = settleArt(performing, { fought: result.attacks.length > 0, uses: outcome.uses, usesMax: weapon?.uses?.max ?? 0 });
    if ( art.performed ) {
      changes.hp = outcome.hp;
      if ( art.uses ) changes.weapon = { id: weapon.id, uses: art.usesLeft };
      changes.art = { id: performing.id ?? null, name: performing.name, hp: art.hp, uses: art.uses, broke: art.broke };
    }
    if ( outcome.proficiencies.length ) {
      changes.proficiencies = Object.fromEntries(outcome.proficiencies.map((gain) => [gain.key, gain.after]));
    }
    const before = outcome.conditionsStart ?? {};
    const after = outcome.conditions ?? {};
    const conditions = {};
    for ( const id of new Set([...Object.keys(before), ...Object.keys(after)]) ) {
      if ( !(id in after) ) conditions[id] = null;
      else if ( after[id] !== before[id] ) conditions[id] = after[id];
    }
    if ( Object.keys(conditions).length ) changes.conditions = conditions;

    // The declared skills the fight spent: their cooldown starts and a use is counted. One that is still on
    // from an earlier fight is not spent again. A skill that takes effect by itself is spent once for each
    // time it did
    // What the unit's skills add to every cooldown counts for each of them
    const skills = [];
    const cooldowns = plan[key].unit.cooldowns ?? 0;
    for ( const spent of outcome.spent ?? [] ) {
      const skill = (plan[key].unit.skills ?? []).find((entry) => (spent.id ? entry.id === spent.id : entry.name === spent.name));
      if ( !skill?.usage || (skill.state?.lasting > 0) ) continue;
      // The cooldown of the one skill its Affinity shortens is shorter by that much; that of an Affinity is no
      // skill's, and stays as it is
      const turns = skill.innate ? 0 : cooldowns + (skill.cooldowns ?? 0);
      const again = skills.find((entry) => entry.id === skill.id);
      if ( again ) again.state = spendSkill(skill.usage, again.state, { cooldowns: turns });
      else skills.push({ id: skill.id, name: skill.name, state: spendSkill(skill.usage, skill.state, { cooldowns: turns }) });
    }
    if ( skills.length ) changes.skills = skills;

    // What the unit spent for damage as the fight began: the HP it keeps having paid, whatever it took, and
    // the transformations it gave up, which are counted with the one the fight itself used
    const paid = result.attacks.length ? (plan[key].unit.fx?.paid ?? null) : null;
    if ( paid?.hp > 0 ) changes.hp = outcome.hp;
    if ( paid?.transforms > 0 ) changes.transforms = paid.transforms;

    // The attacks made against it this turn, for a unit whose skill counts them across fights
    if ( outcome.faced > 0 ) changes.attacked = (plan[key].unit.attacked ?? 0) + outcome.faced;

    // The weapon it attacked with, for a unit whose skills have one weapon hand something to the next: that
    // weapon has now attacked since it was taken in hand, and is the last of its kind the unit attacked with
    if ( outcome.swung && weapon?.id ) {
      const held = plan[key].unit.bare?.weapon ?? {};
      changes.wielded = {
        id: weapon.id,
        last: lastWielded(plan[key].unit.wielded?.last, {
          category: weapon.category, name: weapon.name, might: weapon.might, hit: held.hit ?? weapon.hit, crit: held.crit ?? weapon.crit
        })
      };
    }

    // Gold the unit's skills earned it for defeating its foe
    const gold = (result.earned ?? []).reduce((sum, entry) => sum + ((entry.by === key) ? (entry.gold ?? 0) : 0), 0);
    if ( gold > 0 ) changes.gold = gold;

    // The changes that last a while which skills granted this unit, on top of what it carried. A unit that
    // fell gains none
    // A change it carried into the fight that this fight uses up is over: one that waits for a fight its unit
    // starts, or for one it is attacked in and would have answered
    // So is one that waits for its unit's next attack, once it has made one, and one that lasts until an
    // attack lands on its unit, once one has
    const role = !result.attacks.length ? null : (key === "initiator") ? "attack" : plan[key].denied ? "defend" : "fight";
    const used = spendOnce(plan[key].unit.timed ?? [], role, { made: outcome.made > 0, struck: !!outcome.struck });
    const grants = (outcome.hp > 0) ? (result.granted ?? []).filter((entry) => entry.to === key) : [];
    if ( grants.length || used.changed ) {
      let list = [...used.list];
      for ( const { change: granted } of grants ) list = grantChange(list, granted).list;
      changes.timed = list;
    }

    // Breaking: the Break a unit carried into a fight ends with it, and one it came to suffer from in the
    // fight is kept for its next
    if ( breakInUse() && result.attacks.length ) {
      const now = breakAfter({ gained: outcome.break, hp: outcome.hp });
      if ( now !== !!plan[key].unit.break ) changes.break = now;
    }

    // Stagger: what the fight left of the unit's bar, where it took anything off it. The bar of the unit that
    // began the fight is left alone, and so is one the fight did not touch
    if ( staggerInUse() ) {
      const before = plan[key].unit.stagger ?? null;
      const bar = outcome.stagger ?? null;
      const touched = !!bar && !!before && ((bar.value !== before.value) || (bar.turns !== before.turns));
      changes.stagger = touched ? { value: bar.value, max: bar.max, turns: bar.turns } : null;
    }
    return changes;
  };
  const changes = { initiator: change("initiator"), defender: change("defender") };

  // Capturing: a target brought to 0 HP in an attempt to capture is captured or subdued, and its captor has
  // it as its captive. The attempt is readied no longer once a fight was fought with it
  const taken = captureOutcome(plan, result);
  if ( taken ) {
    changes.defender.captured = { by: taken.captor.uuid, name: taken.captor.name, hp: taken.hp, held: taken.held };
    changes.initiator.captive = { uuid: taken.captive.uuid, name: taken.captive.name, held: taken.held, turns: taken.turns };
  }
  if ( plan.initiator.unit.capture && result.attacks.length ) changes.initiator.capturing = false;

  // Battalions & Gambits: the HP the Battalion each unit commands lost with it, and the Authority EXP a unit
  // earned for making its foe's Battalion retreat
  const squads = fightBattalions(plan, result);
  for ( const key of SIDES ) {
    const { battalion, authority } = squads[key];
    if ( battalion ) changes[key].battalion = { id: battalion.id, hp: battalion.hp };
    if ( authority?.gained ) changes[key].authority = { rank: authority.rank, exp: authority.exp };
  }

  // And those for units around the two, each named as its surroundings name it
  const others = [];
  for ( const entry of result.granted ?? [] ) {
    if ( !entry.unit ) continue;
    const found = others.find((other) => other.unit === entry.unit);
    if ( found ) found.grants.push(entry.change);
    else others.push({ unit: entry.unit, name: entry.name, grants: [entry.change] });
  }
  if ( others.length ) changes.others = others;
  return changes;
}

/* -------------------------------------------- */

/**
 * @typedef ExchangeCard
 * @property {{key: string, army: string, name: string, hpStart: number, hp: number, changed: boolean,
 *   left: number, lost: number, state: string}[]} sides    Both units, with HP bars as percentages
 * @property {{side: string, army: string, icon: string, name: string, result: string, crit: boolean,
 *   cls: string, tags: {label: string, cls: string}[]}[]} strikes
 *                                                          Every attack, in order, with the skills that
 *                                                          activated for it. An answer that was taken is a line
 *                                                          of its own (`answer`), and in a fight of more rounds
 *                                                          than one a line heads each round (`round`)
 * @property {{label: string, cls: string}[]} notable       What deserves a line of its own
 * @property {{label: string, value: string|number}[]} details   Everything else, shown on request
 * @property {string[]} notes                               Remarks shown with the details
 */

/**
 * Build the chat card for a finished exchange. The card itself shows who fought, what each strike did and
 * where HP ended up; rolls, weapon uses and weapon experience sit in a section that opens on request.
 * @param {ExchangePlan} plan
 * @param {ExchangeResult} result
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {{initiator?: string, defender?: string}} [options.armies]  The side each unit fights for, which
 *                                                                    colours its half of the card
 * @param {string[]} [options.unapplied]    Names of units whose changes could not be saved
 * @param {object} [options.aftermath]      What follows from the exchange, as `exchangeAftermath` returns it
 * @param {{skill: string, by: string, amount: number, units: string[]}[]} [options.splashed]
 *                                          What skills dealt to the enemies around the two once it was over
 * @returns {ExchangeCard}
 */
export function buildExchangeCard(plan, result, i18n, { armies = {}, unapplied = [], aftermath = null, splashed = [], spread = [], stood = null } = {}) {
  const after = aftermath ? aftermathLines(plan, aftermath, i18n) : { notable: [], details: [], down: {} };

  // Capturing: what an attempt to capture came to, if the fight was one
  const taken = captureOutcome(plan, result);
  const name = (key) => plan[key].unit.name;
  const weaponName = (key) => plan[key].unit.weapon?.name ?? i18n.localize("FEO.Combat.unarmed");
  const army = { initiator: armies.initiator ?? "player", defender: armies.defender ?? "enemy" };
  const foeOf = (key) => key === "initiator" ? "defender" : "initiator";
  const condition = (id) => i18n.localize(conditionKeys(id).name);

  // A line for a condition somebody gained, or null when it changes nothing worth a line
  const gained = (who, entry) => {
    // Renewing a condition that was already at its full time changes nothing worth a line
    const renewed = !entry.combatOnly && !entry.stacked && (entry.previous != null);
    if ( renewed && (entry.previous === entry.turns) ) return null;
    const key = entry.combatOnly ? "FEO.Exchange.inflictedCombat"
      : entry.stacked ? "FEO.Exchange.inflictedStack"
        : renewed ? "FEO.Exchange.inflictedRenewed"
          : (entry.turns === 1) ? "FEO.Exchange.inflictedTurn" : "FEO.Exchange.inflictedTurns";
    return { label: i18n.format(key, { name: who, condition: condition(entry.id), turns: entry.turns }), cls: "cond" };
  };

  // A line for a condition that what guards a unit nullified, or null when nothing did
  const nullified = (who, entry) => {
    const ward = entry.warded?.at(-1);
    if ( !ward?.success ) return null;
    return { label: i18n.format("FEO.Exchange.nullified", { name: who, condition: condition(entry.id), skill: ward.skill }), cls: "cond" };
  };

  // The rolls that were made to nullify conditions
  const wardRolls = (entries) => entries.flatMap((entry) => entry?.warded ?? []).filter((ward) => ward.roll !== null).map((ward) => {
    return i18n.format("FEO.Exchange.procRoll", { skill: ward.skill, roll: ward.roll, chance: ward.chance });
  });

  // One roll for a chance to activate, or for a condition to turn into a worse one
  const chanceRoll = (proc) => i18n.format(proc.on === "upgrade" ? "FEO.Exchange.conditionRoll" : "FEO.Exchange.procRoll", {
    skill: proc.skill,
    condition: proc.condition ? condition(proc.condition) : "",
    roll: proc.roll,
    chance: proc.chance
  });

  // Both units and their HP
  const sides = SIDES.map((key) => {
    const { hpStart, hp } = result[key];
    const max = Math.max(plan[key].unit.hpMax ?? 0, hpStart, 1);
    const left = Math.max(Math.round((hp / max) * 100), 0);
    return {
      key,
      army: army[key],
      name: name(key),
      hpStart,
      hp,
      changed: hp !== hpStart,
      left,
      lost: Math.max(Math.round(((Math.max(hpStart, 0) - Math.max(hp, 0)) / max) * 100), 0),
      state: left > 50 ? "high" : left > 25 ? "mid" : "low"
    };
  });

  // An answer that was taken in the middle of the fight is a line of its own, before the attack it was for:
  // who answered, with which skill, and what that did. One a skill of the foe brought to nothing says so
  const answerLine = (answer) => {
    const what = `FEO.Answer.card.${answer.what}`;
    const data = { skill: answer.skill, amount: answer.amount ?? 0, item: answer.item ?? "", cost: answer.cost ?? 0, by: answer.foiled ?? "" };
    const key = answer.foiled ? "FEO.Answer.card.foiled"
      : ((answer.what === "reroll") && (answer.on === "critMiss")) ? "FEO.Answer.card.rerollCrit"
        : ((answer.what === "reduce") && answer.item) ? "FEO.Answer.card.reduceItem"
          : i18n.has(what) ? what : "FEO.Answer.card.use";
    return {
      answer: true,
      side: answer.by,
      army: army[answer.by],
      icon: "fa-reply",
      name: name(answer.by),
      label: i18n.format(key, data),
      cls: `answer${answer.foiled ? " foiled" : ""}`
    };
  };

  // What a skill brought to nothing by itself, as a tag on the attack it was rolled for
  const foilLabel = (proc) => i18n.format(`FEO.Answer.foil.${proc.foils}`, { skill: proc.skill, what: proc.what ?? "" });

  // A fight that went on for more rounds than one is told round by round: a line heads the attacks of each,
  // with what had it fought
  const long = (result.rounds?.length ?? 0) > 0;
  let heading = 0;
  const roundLine = (round) => {
    const why = (result.rounds ?? []).find((entry) => entry.round === round);
    return {
      round: true,
      label: (why?.skill && !plan.rounds) ? i18n.format("FEO.Round.by", { round, skill: why.skill }) : i18n.format("FEO.Round.label", { round }),
      cls: "round"
    };
  };

  // Each attack, in order, with the skills that activated for it: the attacker's own, then the target's
  const strikes = result.attacks.flatMap((attack, index) => {
    const tags = [];
    const head = [];
    if ( long && ((attack.round ?? 1) !== heading) ) {
      heading = attack.round ?? 1;
      head.push(roundLine(heading));
    }
    if ( attack.added ) tags.push({ label: i18n.format("FEO.Exchange.added", { skill: attack.skill }), cls: "added" });
    for ( const proc of attack.procs ?? [] ) {
      if ( !proc.success || (proc.on === "upgrade") ) continue;
      if ( proc.on === "foil" ) tags.push({ label: foilLabel(proc), cls: (proc.by === attack.side) ? "" : "answer" });
      else if ( proc.by === attack.side ) tags.push({ label: proc.skill, cls: "" });
      else tags.push({ label: i18n.format("FEO.Exchange.answer", { skill: proc.skill, name: name(proc.by) }), cls: "answer" });
    }

    // A change this attack left on a unit that counts for the rest of the fight says so where it began
    for ( const entry of result.granted ?? [] ) {
      if ( !entry.counted || (entry.at !== index) ) continue;
      const what = describeChange(entry.change, i18n).what;
      if ( what ) tags.push({ label: i18n.format("FEO.Timed.nowTag", { skill: entry.change.name, name: name(entry.to), what }), cls: (entry.by === attack.side) ? "proc" : "answer" });
    }

    // An attack that backfired hit its own unit; the target only if a skill made it hit both
    const backfired = !!attack.backfire?.success;
    const spared = backfired && !attack.backfire.both;
    if ( backfired && !spared ) tags.push({ label: i18n.localize("FEO.Exchange.backfire"), cls: "answer" });

    // An attack its target dodged because the hit would have been fatal
    if ( attack.evaded ) tags.push({
      label: i18n.format("FEO.Exchange.evadedTag", { skill: ruleSkill(plan[foeOf(attack.side)].unit, "dodgeFatal", i18n) }),
      cls: "answer"
    });

    // An attack that would have been fatal, halved for its target
    if ( attack.halved ) {
      tags.push({ label: i18n.format("FEO.Rescue.halvedTag", { skill: ruleSkill(plan[foeOf(attack.side)].unit, "halveFatal", i18n) }), cls: "answer" });
    }

    // An attack whose target an ally carried off as it fell
    if ( attack.saved ) tags.push({ label: i18n.format("FEO.Rescue.savedTag", { skill: attack.saved.skill }), cls: "answer" });

    // And one whose damage an ally outside the fight took, or turned back
    if ( attack.warded ) tags.push({ label: i18n.format(`FEO.Stance.card.${attack.warded.what}Tag`, { skill: attack.warded.skill }), cls: "answer" });

    // A hit that counts as a critical hit without being one, and one a skill of its target held to a share of
    // that unit's HP
    if ( attack.asCrit ) tags.push({ label: i18n.localize("FEO.Choice.asCrit"), cls: "proc" });

    // A share of the target's maximum HP a die had the hit deal in place of its damage, or would have had
    // that been more; and a hit that killed outright
    if ( attack.instead && attack.hit ) tags.push({
      label: i18n.format(attack.instead.took ? "FEO.Formula.instead" : "FEO.Formula.insteadNot", attack.instead),
      cls: "proc"
    });
    if ( attack.slain ) tags.push({ label: i18n.format("FEO.Formula.slain", { skill: attack.slain }), cls: "proc" });
    if ( attack.capped?.length ) tags.push({ label: i18n.format("FEO.Choice.capped", { skill: attack.capped.join(", "), amount: attack.damage }), cls: "answer" });

    // A hit its target blocked, or parried: what blocked it and what that took off. A block a skill negated
    // is told of by that skill
    const blocked = (attack.block?.success && !spared) ? attack.block : null;
    const parried = !!blocked?.parry?.success;
    return [...head, ...(attack.answers ?? []).map(answerLine), {
      side: attack.side,
      army: army[attack.side],
      icon: attack.side === "initiator" ? "fa-arrow-right" : "fa-arrow-left",
      name: name(attack.side),
      result: spared ? i18n.localize("FEO.Exchange.backfire") : attack.hit ? String(attack.damage)
        : i18n.localize(attack.negated ? "FEO.Answer.negated" : "FEO.Chat.miss"),
      crit: attack.crit && !spared,
      block: !blocked ? null : parried ? i18n.localize("FEO.Block.parried")
        : i18n.format("FEO.Block.blocked", { amount: blocked.amount }),
      blockTip: blocked ? i18n.format("FEO.Block.with", { name: name(foeOf(attack.side)), item: blocked.name }) : "",
      cls: `${(!attack.hit || spared) ? "miss" : attack.crit ? "crit" : "hit"}${blocked ? " block" : ""}`,
      tags
    }];
  });

  // And so is one that was taken outside of an attack, as the one that ended the fight
  strikes.push(...(result.answers ?? []).map(answerLine));

  // A fight its owner ended before a further round says so where that round would have begun
  if ( result.stopped ) strikes.push({
    answer: true,
    side: result.stopped.side,
    army: army[result.stopped.side],
    icon: "fa-hand",
    name: name(result.stopped.side),
    label: i18n.format("FEO.Round.stopped", { skill: result.stopped.skill }),
    cls: "answer"
  });

  // What deserves a line of its own: skills that activated as the fight began, units falling, ranks gained,
  // weapons breaking, anything left unsaved
  const notable = [];

  // A fight of several rounds says what it was, and how many of them were fought where that is not the same
  const fought = (result.rounds?.length ?? 0) + 1;
  if ( plan.rounds ) notable.push({
    label: (!plan.rounds.until && (fought === plan.rounds.count)) ? roundsLabel(plan.rounds, i18n)
      : `${roundsLabel(plan.rounds, i18n)} · ${i18n.format("FEO.Round.fought", { rounds: fought })}`,
    cls: "cond"
  });
  else if ( long ) notable.push({ label: i18n.format("FEO.Round.fought", { rounds: result.rounds.length + 1 }), cls: "cond" });
  for ( const proc of result.opening ?? [] ) {
    // What a skill brought to nothing before the fight: a skill the foe chose for it, or its Combat Art
    if ( proc.on === "foil" ) {
      if ( proc.success ) notable.push({ label: `${name(proc.by)}: ${foilLabel(proc)}`, cls: "cond" });
      continue;
    }

    // One that is only announced has its line among the reminders
    if ( (result.reminders ?? []).some((entry) => (entry.skill === proc.skill) && (entry.by === proc.by)) ) continue;
    if ( proc.success ) notable.push({
      label: i18n.format("FEO.Exchange.activates", { name: name(proc.by), skill: proc.skill }),
      cls: "cond"
    });
  }
  for ( const key of SIDES ) {
    const outcome = result[key];
    // A unit brought to 0 HP is defeated, unless it went down, which is told of elsewhere, or was captured
    if ( outcome.defeated && !after.down[key] && !(taken && (key === "defender")) ) {
      notable.push({ label: i18n.format("FEO.Exchange.defeated", { name: name(key) }), cls: "" });
    }
    for ( const gain of outcome.proficiencies ) {
      if ( gain.rankUps ) notable.push({
        label: i18n.format("FEO.Exchange.rankUp", {
          name: name(key),
          proficiency: i18n.localize(FEO.proficiencies[gain.key]),
          rank: i18n.localize(FEO.ranks[gain.after.rank])
        }),
        cls: "gold"
      });
    }
    if ( outcome.broke ) notable.push({ label: i18n.format("FEO.Exchange.broke", { weapon: weaponName(key) }), cls: "bad" });
    if ( outcome.shield?.broke ) notable.push({ label: i18n.format("FEO.Exchange.broke", { weapon: plan[key].unit.shield.name }), cls: "bad" });
  }

  // Attacks that backfired on their own unit
  for ( const attack of result.attacks ) {
    if ( attack.backfire?.success ) notable.push({
      label: i18n.format("FEO.Exchange.backfired", { name: name(attack.side), amount: attack.backfire.damage }),
      cls: "bad"
    });
  }

  // Hits that would have been fatal to a unit that dodges every such hit
  for ( const attack of result.attacks ) {
    const target = foeOf(attack.side);
    if ( attack.evaded ) notable.push({
      label: i18n.format("FEO.Exchange.evaded", { name: name(target), skill: ruleSkill(plan[target].unit, "dodgeFatal", i18n) }),
      cls: "cond"
    });

    // A hit an ally outside the fight took in the target's place, or turned back on the attacker
    if ( attack.warded ) notable.push({
      label: i18n.format(`FEO.Stance.card.${attack.warded.what}`, {
        name: name(target), foe: name(attack.side), by: attack.warded.by, skill: attack.warded.skill, amount: attack.warded.amount
      }),
      cls: "cond"
    });

    // A unit that an ally came for as the blow fell
    if ( attack.saved ) notable.push({
      label: i18n.format("FEO.Rescue.saved", { name: name(target), by: attack.saved.by, skill: attack.saved.skill }),
      cls: "cond"
    });
  }

  // What each hit did to the conditions of its target
  for ( const attack of result.attacks ) {
    const effects = attack.conditions;
    if ( !effects ) continue;
    const target = name(foeOf(attack.side));
    const burst = effects.burst?.success ? effects.burst : null;
    for ( const id of effects.ended ) {
      if ( id === burst?.id ) continue;
      notable.push({ label: i18n.format("FEO.Exchange.conditionEnds", { name: target, condition: condition(id) }), cls: "" });
    }
    if ( burst ) notable.push({
      label: i18n.format(burst.push ? "FEO.Exchange.burstPush" : "FEO.Exchange.burst", {
        name: target,
        condition: condition(burst.id),
        inflicts: burst.inflicts ? condition(burst.inflicts) : "",
        push: burst.push
      }),
      cls: "cond"
    });
    if ( burst?.warded ) {
      const line = nullified(target, { id: burst.inflicts, warded: burst.warded });
      if ( line ) notable.push(line);
    }
    for ( const entry of effects.inflicted ) {
      const line = entry.success ? gained(target, entry) : nullified(target, entry);
      if ( line ) notable.push(line);
    }
    if ( effects.healed ) notable.push({
      label: i18n.format("FEO.Exchange.regains", { name: name(attack.side), amount: effects.healed }),
      cls: "good"
    });

    // What the target's skills did to the attacker in return
    if ( attack.reflected ) notable.push({
      label: i18n.format("FEO.Exchange.reflected", { name: name(attack.side), amount: attack.reflected }),
      cls: "bad"
    });
    for ( const entry of effects.returned ?? [] ) {
      const line = (entry.success === false) ? nullified(name(attack.side), entry) : gained(name(attack.side), entry);
      if ( line ) notable.push(line);
    }
  }

  // Damage skills dealt outside of an attack, what they did once the fighting was over, and the skills that
  // took effect in a way the table has to apply
  // What a hit dealt again as damage of an element, and what cut the HP its target had left, say so
  const harmed = (entry, amount) => ({
    label: i18n.format(entry.cut ? ((entry.cut === "kill") ? "FEO.Formula.cutKill" : "FEO.Formula.cutShare") : entry.element ? "FEO.Formula.echo" : "FEO.Exchange.harmed", {
      name: name(foeOf(entry.by)), amount, skill: entry.skill, element: entry.element ? elementName(entry.element, i18n) : ""
    }),
    cls: "bad"
  });
  for ( const attack of result.attacks ) {
    for ( const entry of attack.harm ?? [] ) notable.push(harmed(entry, entry.amount));
  }
  // What a unit paid for a skill of its own, as the fight began or once it was over
  for ( const entry of result.paid ?? [] ) notable.push({
    label: i18n.format("FEO.Exchange.paid", { name: name(entry.by), amount: entry.amount, skill: entry.skill }),
    cls: "bad"
  });
  // The conditions skills put on the foe of their unit as the fight began
  for ( const entry of result.before ?? [] ) {
    for ( const inflicted of entry.inflicted ?? [] ) {
      const who = name(foeOf(entry.by));
      const line = (inflicted.success === false) ? nullified(who, inflicted) : gained(who, inflicted);
      if ( line ) notable.push(line);
    }
    for ( const returned of entry.returned ?? [] ) {
      const line = (returned.success === false) ? nullified(name(entry.by), returned) : gained(name(entry.by), returned);
      if ( line ) notable.push(line);
    }
  }
  for ( const entry of result.after ?? [] ) {
    if ( "damage" in entry ) notable.push(harmed(entry, entry.damage));
    for ( const inflicted of entry.inflicted ?? [] ) {
      const who = name(foeOf(entry.by));
      const line = (inflicted.success === false) ? nullified(who, inflicted) : gained(who, inflicted);
      if ( line ) notable.push(line);
    }

    // What the foe's skills handed back for it
    for ( const returned of entry.returned ?? [] ) {
      const line = (returned.success === false) ? nullified(name(entry.by), returned) : gained(name(entry.by), returned);
      if ( line ) notable.push(line);
    }
  }
  for ( const entry of result.reminders ?? [] ) notable.push({
    label: i18n.format("FEO.Exchange.remind", { name: name(entry.by), skill: entry.skill }),
    cls: "cond"
  });

  // Gold a skill earned its unit for defeating the foe
  for ( const entry of result.earned ?? [] ) notable.push({
    label: i18n.format("FEO.Exchange.gold", { name: name(entry.by), amount: entry.gold, skill: entry.skill }),
    cls: "gold"
  });

  // The changes that last a while which skills granted: for each unit and change one line, as it now stands
  const spending = exchangeChanges(plan, result);
  const lines = new Map();
  for ( const entry of result.granted ?? [] ) {
    // One that only keeps count of something for a skill has nothing to tell
    if ( entry.mark || entry.change.mark ) continue;
    const id = `${entry.to ?? entry.unit}|${entry.change.name}|${entry.change.from}`;
    if ( entry.change.drop && !entry.to && !lines.has(id) ) continue;
    let granted = lines.has(id) ? grantChange([lines.get(id).change], entry.change).change : entry.change;
    if ( entry.to ) {
      const waits = (change) => (change.wait ?? 0) > 0;
      granted = (spending[entry.to].timed ?? []).find((change) => {
        return (change.name === entry.change.name) && (change.from === entry.change.from) && (entry.change.drop || (waits(change) === waits(entry.change)));
      });
    }
    if ( granted && readsCount(granted.effects) && !describeChange(granted, i18n).what ) granted = null;
    if ( !granted ) {
      lines.delete(id);
      continue;
    }
    lines.set(id, { name: entry.name, change: granted });
  }
  for ( const { name: who, change: granted } of lines.values() ) notable.push({
    // One that a second hit spoilt says that it is lost
    label: granted.spoiled
      ? i18n.format("FEO.Timed.spoiltLine", { name: who, skill: timedName(granted) })
      : i18n.format("FEO.Exchange.granted", { name: who, skill: timedName(granted), ...describeChange(granted, i18n) }),
    cls: "cond"
  });

  // What skills wore off a foe's weapon and Shield, and the attacks a skill cancelled
  for ( const entry of result.worn ?? [] ) {
    const gear = [];
    if ( entry.weapon ) gear.push(i18n.format("FEO.Exchange.wornItem", { item: weaponName(entry.to), amount: entry.weapon }));
    if ( entry.shield ) gear.push(i18n.format("FEO.Exchange.wornItem", { item: plan[entry.to].unit.shield?.name ?? i18n.localize("FEO.Block.shield"), amount: entry.shield }));
    if ( gear.length ) notable.push({ label: i18n.format("FEO.Exchange.worn", { skill: entry.skill, name: name(entry.to), gear: gear.join(", ") }), cls: "bad" });
  }
  for ( const entry of result.cancelled ?? [] ) notable.push({
    label: i18n.format("FEO.Exchange.cancelled", { skill: entry.skill, name: name(entry.side) }),
    cls: "cond"
  });

  // What a skill dealt to the enemies around the two once the fight was over
  // The unit that fought in the place of another
  if ( stood?.ally ) notable.unshift({
    label: i18n.format("FEO.Stance.card.stood", { name: name("defender"), ally: stood.ally, skill: stood.skill ?? "" }),
    cls: "cond"
  });
  // The allies an attack was made in formation with
  for ( const entry of planFormations(plan) ) {
    if ( !result.attacks.some((attack) => attack.side === entry.by) ) continue;
    const [first, second] = entry.partners.map((unit) => unit.name);
    notable.unshift({ label: i18n.format("FEO.Stance.card.formation", { skill: entry.skill, name: name(entry.by), first, second }), cls: "cond" });
  }
  for ( const entry of splashed ?? [] ) notable.push({
    label: i18n.format("FEO.Answer.splash.dealt", { skill: entry.skill, amount: entry.amount, names: entry.units.join(", ") }),
    cls: "bad"
  });

  // What skills did to the units around the two (see `rules/spread.mjs`): one line for each skill, with what
  // every unit it caught took or gained
  for ( const entry of spread ?? [] ) {
    const what = describeSpread(entry, i18n);
    if ( !what ) continue;
    const heals = entry.lines.every((line) => line.healed && (line.damage === undefined) && !line.attack);
    notable.push({ label: i18n.format("FEO.Spread.card", { skill: entry.skill, what }), cls: heals ? "good" : "bad" });
  }

  // The skills that were shown and not applied, for the table to check by hand
  for ( const key of SIDES ) {
    for ( const [unseen, label] of [[false, "FEO.Exchange.checkLine"], [true, "FEO.Exchange.unseenLine"]] ) {
      const names = (plan[key].checks ?? []).filter((entry) => entry.unseen === unseen).map((entry) => entry.skill);
      if ( names.length ) notable.push({ label: i18n.format(label, { name: name(key), skills: names.join(", ") }), cls: "bad" });
    }
  }
  // Breaking: a unit that came to suffer from Break, and still stands
  for ( const key of SIDES ) {
    if ( result[key].break && (result[key].hp > 0) ) notable.push({
      label: i18n.format("FEO.Optional.breaking.card", { name: name(key) }),
      cls: "cond"
    });
  }

  // Stagger: a unit whose bar was emptied, and still stands
  for ( const key of SIDES ) {
    if ( result[key].staggered && (result[key].hp > 0) ) notable.push({
      label: i18n.format("FEO.Optional.stagger.card.staggered", { name: name(key) }),
      cls: "bad"
    });
  }

  // Capturing: a target that was captured, or subdued for its captor to pick up
  if ( taken ) notable.push({
    label: i18n.format(`FEO.Optional.capturing.card.${taken.held ? "taken" : "subdued"}`, { captor: taken.captor.name, captive: taken.captive.name }),
    cls: "good"
  });

  // What the fight did to the Battalions of the two
  const squads = battalionLines(plan, result, i18n);
  notable.push(...squads.notable);
  notable.push(...after.notable);
  if ( unapplied.length ) notable.push({
    label: i18n.format("FEO.Exchange.unapplied", { names: unapplied.join(", ") }),
    cls: "bad"
  });

  // Everything else
  const details = [{ label: i18n.localize("FEO.Weapon.range"), value: plan.distance }];
  for ( const key of SIDES ) {
    const side = plan[key];

    // A weapon a skill lent the unit for this fight (see `rules/lending.mjs`): the weapon, and the skill
    const lent = side.unit?.weapon?.lent ? side.unit.weapon : null;
    if ( lent && !side.blocked ) details.push({ label: `${name(key)} · ${lent.lent}`, value: lent.name });
    if ( side.triangle > 0 ) details.push({
      label: triangleLabel(plan, i18n),
      value: i18n.format("FEO.Exchange.triangleBonus", {
        name: name(key),
        hit: signed(side.triangleHit),
        damage: signed(side.triangleDamage)
      })
    });

    // What its weapon took from the one it attacked with before, for its first attack
    if ( !side.blocked && side.handed ) details.push({ label: name(key), value: handedLabel(side.handed, i18n) });
  }

  // A triangle that a skill kept from counting against its unit
  if ( !plan.triangle?.advantage && plan.triangle?.spared?.length ) details.push({
    label: i18n.localize("FEO.Exchange.triangle"),
    value: i18n.format("FEO.Triangle.spared", { skills: plan.triangle.spared.join(", ") })
  });
  for ( const key of SIDES ) {
    const side = plan[key];
    if ( !side.blocked && side.effective.length ) details.push({
      label: name(key),
      value: i18n.format("FEO.Exchange.effective", {
        qualities: side.effective.join(", "),
        multiplier: side.mightMultiplier
      })
    });
  }
  for ( const key of SIDES ) {
    const side = plan[key];
    if ( side.blocked ) continue;
    for ( const note of side.notes ?? [] ) details.push({ label: name(key), value: describeNote(note, i18n) });
  }
  for ( const key of SIDES ) {
    const used = plan[key].skills ?? [];
    if ( used.length ) details.push({ label: `${name(key)} · ${i18n.localize("FEO.Section.skills")}`, value: used.join(", ") });
  }
  for ( const key of SIDES ) {
    const around = plan[key].auras ?? [];
    if ( around.length ) details.push({ label: `${name(key)} · ${i18n.localize("FEO.Exchange.nearby")}`, value: around.join(", ") });
  }
  for ( const key of SIDES ) {
    const carried = plan[key].lasting ?? [];
    if ( carried.length ) details.push({ label: `${name(key)} · ${i18n.localize("FEO.Timed.title")}`, value: carried.join(", ") });
  }

  // The declared skills the fight spent, with what that costs, and apart from them the skills that took
  // effect by themselves and counted a use
  for ( const key of SIDES ) {
    const usageOf = (entry) => plan[key].unit.skills.find((skill) => skill.id === entry.id)?.usage ?? {};
    const cost = (entry) => {
      const usage = usageOf(entry);
      const costs = [];
      // The turns it now sits out, which the unit's skills may have made fewer than the skill says
      const turns = (usage.cooldown > 0) ? turnsToSitOut(entry.state) : 0;
      if ( turns > 0 ) costs.push(i18n.format("FEO.Usage.cooldown", { turns }));
      if ( usage.uses > 0 ) costs.push(i18n.format("FEO.Usage.usesLeft", { left: Math.max(usage.uses - entry.state.used, 0), uses: usage.uses }));
      return costs.length ? `${entry.name} (${costs.join(", ")})` : entry.name;
    };
    const all = spending[key].skills ?? [];
    const spent = all.filter((entry) => usageOf(entry).kind !== "auto").map(cost);
    const took = all.filter((entry) => usageOf(entry).kind === "auto").map(cost);
    if ( spent.length ) details.push({ label: `${name(key)} · ${i18n.localize("FEO.Usage.spent")}`, value: spent.join(", ") });
    if ( took.length ) details.push({ label: `${name(key)} · ${i18n.localize("FEO.Usage.took")}`, value: took.join(", ") });
  }

  // The Combat Art the initiator performed, with what it cost, and what the table still has to apply of it
  const performed = spending.initiator.art;
  if ( performed ) {
    details.push({
      label: `${name("initiator")} · ${i18n.localize("FEO.Optional.combatArts.title")}`,
      value: `${performed.name} (${artCostLabel(performed, i18n)})`
    });
    if ( plan.initiator.art?.left ) details.push({
      label: `${performed.name} · ${i18n.localize("FEO.Optional.combatArts.byHand")}`,
      value: plan.initiator.art.left
    });
  }

  // The dice, in the order they were rolled: the chances as the fight began, then for each attack the
  // attacker's chances, the hit, the critical, the target's chances and what happens to conditions
  for ( const key of SIDES ) {
    const rolled = (result.opening ?? []).filter((proc) => (proc.by === key) && !proc.sure);
    if ( rolled.length ) details.push({
      label: `${name(key)} · ${i18n.localize("FEO.Exchange.opening")}`,
      value: rolled.map(chanceRoll).join(" · ")
    });
  }
  result.attacks.forEach((attack, index) => {
    // A skill that is sure of its moment rolled nothing. The rest are kept in the order they were rolled
    const procs = (attack.procs ?? []).filter((proc) => !proc.sure);
    const rolls = procs.filter((proc) => proc.on === "attack").map(chanceRoll);

    // The Hit roll: both of a unit that rolls twice and takes the worse, and the roll a skill had made again.
    // An attack that was negated rolled nothing
    for ( const again of (attack.rerolls ?? []).filter((entry) => entry.roll === "hit") ) {
      rolls.push(i18n.format("FEO.Answer.roll.again", { skill: again.skill, roll: again.first, chance: attack.hitChance }));
    }
    if ( attack.hitRolls ) rolls.push(i18n.format("FEO.Answer.roll.twice", { first: attack.hitRolls[0], second: attack.hitRolls[1], chance: attack.hitChance }));
    else if ( attack.hitRoll !== null ) rolls.push(i18n.format("FEO.Exchange.hitRoll", { roll: attack.hitRoll, chance: attack.hitChance }));
    if ( attack.negated ) rolls.push(i18n.format("FEO.Answer.card.cancel", { skill: attack.negated.skill }));
    for ( const again of (attack.rerolls ?? []).filter((entry) => entry.roll === "crit") ) {
      rolls.push(i18n.format("FEO.Answer.roll.againCrit", { skill: again.skill, roll: again.first, chance: attack.critChance }));
    }
    // A follow-up attack whose Critical was multiplied says by how much
    if ( attack.critRoll !== null ) {
      rolls.push(i18n.format(attack.fcm ? "FEO.Optional.fcm.card.roll" : "FEO.Exchange.critRoll", {
        roll: attack.critRoll, chance: attack.critChance, times: attack.fcm
      }));
    }
    if ( attack.backfire ) {
      rolls.push(i18n.format("FEO.Exchange.backfireRoll", { roll: attack.backfire.roll, chance: attack.backfire.chance }));
    }

    // The target's roll to parry and its roll to block
    if ( attack.block?.parry ) rolls.push(i18n.format("FEO.Block.parryRoll", { roll: attack.block.parry.roll, chance: attack.block.parry.chance }));
    if ( attack.block && (attack.block.roll !== null) ) rolls.push(i18n.format("FEO.Block.roll", { roll: attack.block.roll, chance: attack.block.chance }));
    rolls.push(...procs.filter((proc) => proc.on !== "attack").map(chanceRoll));
    const burst = attack.conditions?.burst;
    if ( burst ) rolls.push(i18n.format("FEO.Exchange.conditionRoll", {
      condition: condition(burst.id),
      roll: burst.roll,
      chance: burst.chance
    }));
    rolls.push(...wardRolls([burst]));
    for ( const entry of attack.conditions?.inflicted ?? [] ) {
      if ( entry.roll !== null ) rolls.push(i18n.format("FEO.Exchange.conditionRoll", {
        condition: condition(entry.id),
        roll: entry.roll,
        chance: entry.chance
      }));
      rolls.push(...wardRolls([entry]));
    }
    rolls.push(...wardRolls(attack.conditions?.returned ?? []));
    const label = attack.added ? `${name(attack.side)} · ${attack.skill}` : name(attack.side);
    const stage = long ? `${i18n.format("FEO.Round.short", { round: attack.round ?? 1 })} · ` : "";
    details.push({ label: `${index + 1}. ${stage}${label}`, value: rolls.join(" · ") });
  });
  // The chances that were rolled as rounds ended, for the round to be fought again
  for ( const proc of (result.turning ?? []).filter((entry) => !entry.sure) ) details.push({
    label: `${i18n.format("FEO.Round.label", { round: proc.round ?? 1 })} · ${name(proc.by)}`,
    value: chanceRoll(proc)
  });
  for ( const key of SIDES ) {
    const rolled = (result.closing ?? []).filter((proc) => (proc.by === key) && !proc.sure);
    if ( rolled.length ) details.push({
      label: `${name(key)} · ${i18n.localize("FEO.Exchange.closing")}`,
      value: rolled.map(chanceRoll).join(" · ")
    });
  }
  for ( const entry of result.after ?? [] ) {
    const tried = wardRolls([...(entry.inflicted ?? []), ...(entry.returned ?? [])]);
    if ( tried.length ) details.push({ label: `${entry.skill} · ${i18n.localize("FEO.Exchange.closing")}`, value: tried.join(" · ") });
  }
  for ( const entry of result.before ?? [] ) {
    const tried = wardRolls([...(entry.inflicted ?? []), ...(entry.returned ?? [])]);
    if ( tried.length ) details.push({ label: `${entry.skill} · ${i18n.localize("FEO.Exchange.opening")}`, value: tried.join(" · ") });
  }

  // The dice that picked the unit a skill went to, among those it could have gone to
  for ( const entry of result.spreads ?? [] ) {
    if ( entry.rolled?.length ) details.push({ label: `${entry.skill} · ${i18n.localize("FEO.Spread.picked")}`, value: entry.rolled.join(", ") });
  }
  for ( const key of SIDES ) {
    const { usesSpent, usesStart, uses } = result[key];
    if ( usesSpent ) details.push({
      label: weaponName(key),
      value: i18n.format("FEO.Exchange.uses", { from: usesStart, to: uses })
    });
  }
  for ( const key of SIDES ) {
    const worn = result[key].shield;
    if ( worn?.spent ) details.push({
      label: plan[key].unit.shield.name,
      value: i18n.format("FEO.Exchange.uses", { from: worn.usesStart, to: worn.uses })
    });
  }
  for ( const key of SIDES ) {
    const outcome = result[key];
    if ( !outcome.wexp ) continue;
    const gained = `+${tidy(outcome.wexp)}`;

    if ( !outcome.proficiencies.length ) {
      details.push({ label: name(key), value: i18n.format("FEO.Exchange.noProficiency", { wexp: gained }) });
      continue;
    }
    for ( const gain of outcome.proficiencies ) {
      const next = FEO.wexpToNext[gain.after.rank];
      details.push({
        label: `${name(key)} · ${i18n.localize(FEO.proficiencies[gain.key])}`,
        value: next == null
          ? i18n.format("FEO.Exchange.wexpMastered", { wexp: gained })
          : i18n.format("FEO.Exchange.wexp", { wexp: gained, now: tidy(gain.after.wexp), next })
      });
    }
  }

  // Stagger: what the fight took off a bar
  for ( const key of SIDES ) {
    const bar = spending[key].stagger;
    if ( bar ) details.push({
      label: `${name(key)} · ${i18n.localize("FEO.Optional.stagger.title")}`,
      value: i18n.format("FEO.Optional.stagger.card.bar", { from: plan[key].unit.stagger.value, to: bar.value, max: bar.max })
    });
  }

  details.push(...squads.details);
  details.push(...after.details);

  // Why somebody did not attack
  const notes = [];
  const reason = plan.defender.blocked;
  if ( reason && (reason !== "noCombat") ) notes.push(i18n.format("FEO.Exchange.noCounter", {
    name: name("defender"),
    reason: i18n.localize(`FEO.Exchange.blocked.${reason}`)
  }));
  for ( const key of SIDES ) {
    if ( result[key].held && (result[key].hp > 0) ) notes.push(i18n.format("FEO.Exchange.held", { name: name(key) }));
  }
  for ( const key of SIDES ) {
    if ( !result[key].broke || (result[key].hp <= 0) ) continue;
    const made = result.attacks.filter((attack) => attack.side === key).length;
    if ( made < plan[key].attacks ) notes.push(i18n.format("FEO.Exchange.brokeEarly", { name: name(key) }));
  }

  return { sides, strikes, notable, details, notes };
}

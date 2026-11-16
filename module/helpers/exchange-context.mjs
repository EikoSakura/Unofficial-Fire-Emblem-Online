import { FEO } from "../config.mjs";
import { settleArt } from "../rules/arts.mjs";
import { fightBattalions } from "../rules/battalions.mjs";
import { breakAfter, breakInUse } from "../rules/breaking.mjs";
import { captureOutcome } from "../rules/capturing.mjs";
import { readConditions } from "../rules/conditions.mjs";
import { spendSkill } from "../rules/skill-usage.mjs";
import { hpHolds } from "../rules/skills.mjs";
import { isStaggered, staggerHit, staggerInUse, staggerOf } from "../rules/stagger.mjs";
import { grantChange, timedName } from "../rules/timed.mjs";
import { fcmInUse } from "../rules/variants.mjs";
import { aftermathLines, recordOf } from "./aftermath.mjs";
import { battalionLines, commandOf } from "./battalion-context.mjs";
import { conditionKeys } from "./condition-context.mjs";
import { describeChange } from "./timed-context.mjs";

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
  const found = (unit.skills ?? []).find((skill) => (skill.effects ?? []).some((effect) => effect.rules?.includes(rule)));
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
 * @returns {Combatant}
 */
export function combatantOf(actor, name, { incapacitates = false, place = null } = {}) {
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
    hp: system.hp.value,
    hpMax: system.hp.max,
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
    waiting: !!system.waiting,
    shifted: !!system.shift?.transformed,
    skills: bare ? system.skills.entries : undefined,
    near: place?.near ?? null,
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
 * Build the forecast for an exchange: each side's chances, damage and number of attacks.
 * @param {ExchangePlan} plan
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {number|null} [options.measured]    The distance measured between the two tokens, if it could be
 * @returns {object}
 */
export function buildForecast(plan, i18n, { measured = null } = {}) {
  const sides = SIDES.map((key) => {
    const side = plan[key];
    const foe = plan[key === "initiator" ? "defender" : "initiator"];
    const unit = side.unit;
    const active = !side.blocked;

    const tags = [];
    if ( side.triangle ) tags.push({
      label: i18n.format(side.triangle > 0 ? "FEO.Exchange.advantage" : "FEO.Exchange.disadvantage", {
        hit: signed(side.triangleHit),
        damage: signed(side.triangleDamage)
      }),
      cls: side.triangle > 0 ? "good" : "bad"
    });
    if ( active && side.effective.length ) tags.push({
      label: i18n.format("FEO.Exchange.effective", {
        qualities: side.effective.join(", "),
        multiplier: side.mightMultiplier
      }),
      cls: "good"
    });
    if ( active && side.doubles ) tags.push({ label: i18n.localize("FEO.Exchange.followUp"), cls: "good" });

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
    for ( const on of !foe.blocked ? ["struck", "dodged"] : [] ) chances.push(...(side.chances?.[on] ?? []));
    for ( const on of plan.order.length ? ["start", "after", "inflict", "afflicted"] : [] ) chances.push(...(side.chances?.[on] ?? []));
    for ( const proc of chances ) {
      // A skill that only has its moment once in the fight says so
      const key = (proc.sure && proc.once) ? `FEO.Exchange.once.${proc.on === "attack" ? "attack" : "other"}`
        : `FEO.Exchange.${proc.sure ? "sure" : "chance"}.${proc.on}`;
      tags.push({ label: i18n.format(key, { skill: proc.skill, chance: proc.chance }), cls: "cond proc" });
    }

    // HP left if every attack against this side lands without a critical hit. A first hit may end a condition
    // that the later ones no longer profit from
    const later = side.damageLater ?? side.damage;
    const foeLater = foe.damageLater ?? foe.damage;
    // A unit that is already down keeps damage past 0 HP, less its resilience, for every hit
    const softened = (damage) => unit.incapacitated ? Math.max(damage - (unit.resilience ?? 0), 0) : damage;
    const foeKey = key === "initiator" ? "defender" : "initiator";
    const shares = plan.order.map((who, index) => (who === foeKey ? (plan.scale?.[index] ?? 1) : null)).filter((share) => share !== null);
    // A unit that dodges every hit that would be fatal to it is not counted as taking one. One that a skill
    // is sure to leave at 1 HP is counted that way, and as taking nothing more if the skill says so
    const dodges = !!unit.fx?.rules?.has("dodgeFatal") && (unit.hp > 0);
    const saver = (side.chances?.struck ?? []).find((proc) => proc.sure && proc.survive && (proc.survive !== true));
    const spared = !!saver?.grants?.some((grant) => grant.now && (grant.effects ?? []).some((effect) => effect.takenPercent <= -100));
    let saved = false;

    // Stagger: once what the unit that is attacked has lost empties its bar, every later hit is multiplied
    let emptying = (bar && (key === "defender") && !isStaggered(bar)) ? bar : null;
    const taken = foe.blocked ? 0 : shares.reduce((sum, share, index) => {
      const times = (emptying?.turns > 0) ? FEO.optional.stagger.taken : 1;
      const blow = Math.floor((softened(index === 0 ? foe.damage : foeLater) * share * times) + 1e-9);
      const left = unit.hp - sum;
      if ( (dodges && (blow >= left)) || (saved && spared) ) return sum;
      if ( saver && !saved && (left > 0) && (blow >= left) && hpHolds(saver.survive.hp, left, unit.hpMax ?? unit.hp) ) {
        saved = true;
        return unit.hp - 1;
      }
      if ( emptying ) emptying = staggerHit(emptying, Math.min(blow, Math.max(left, 0)), { standing: blow < left });
      return sum + blow;
    }, 0);

    // A foe whose Combat Art spares this side leaves it with 1 HP at the least, for as long as the Art lasts
    const sparing = !!foe.art?.spare && (foe.art.persist || (foe.attacks <= 1));
    const lost = (sparing && (unit.hp > 0)) ? Math.min(taken, unit.hp - 1) : taken;
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

      // The chance of a critical hit with the follow-up attack, where it is another than the first attack's
      critFollow: (active && side.fcm && (side.critFollow !== side.crit)) ? side.critFollow : null,
      damage: side.damage,
      damageLater: (side.attacks > 1) && (later !== side.damage) ? later : null,
      attacks: side.attacks,
      repeats: side.attacks > 1,
      chances: chances.map((proc) => {
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
    sides
  };
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

    // A Combat Art the unit performed: its HP was paid as the fight began, which the unit keeps even if it
    // took no damage, and its Weapon Uses are paid now, on top of what the attacks cost
    const performing = plan[key].art ?? null;
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
    const skills = [];
    for ( const spent of outcome.spent ?? [] ) {
      const skill = (plan[key].unit.skills ?? []).find((entry) => (spent.id ? entry.id === spent.id : entry.name === spent.name));
      if ( !skill?.usage || (skill.state?.lasting > 0) ) continue;
      const again = skills.find((entry) => entry.id === skill.id);
      if ( again ) again.state = spendSkill(skill.usage, again.state);
      else skills.push({ id: skill.id, name: skill.name, state: spendSkill(skill.usage, skill.state) });
    }
    if ( skills.length ) changes.skills = skills;

    // Gold the unit's skills earned it for defeating its foe
    const gold = (result.earned ?? []).reduce((sum, entry) => sum + ((entry.by === key) ? (entry.gold ?? 0) : 0), 0);
    if ( gold > 0 ) changes.gold = gold;

    // The changes that last a while which skills granted this unit, on top of what it carried. A unit that
    // fell gains none
    const grants = (result.granted ?? []).filter((entry) => entry.to === key);
    if ( grants.length && (outcome.hp > 0) ) {
      let list = [...(plan[key].unit.timed ?? [])];
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
 *                                                          activated for it
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
 * @returns {ExchangeCard}
 */
export function buildExchangeCard(plan, result, i18n, { armies = {}, unapplied = [], aftermath = null } = {}) {
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

  // Each attack, in order, with the skills that activated for it: the attacker's own, then the target's
  const strikes = result.attacks.map((attack) => {
    const tags = [];
    if ( attack.added ) tags.push({ label: i18n.format("FEO.Exchange.added", { skill: attack.skill }), cls: "added" });
    for ( const proc of attack.procs ?? [] ) {
      if ( !proc.success || (proc.on === "upgrade") ) continue;
      if ( proc.by === attack.side ) tags.push({ label: proc.skill, cls: "" });
      else tags.push({ label: i18n.format("FEO.Exchange.answer", { skill: proc.skill, name: name(proc.by) }), cls: "answer" });
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
    return {
      side: attack.side,
      army: army[attack.side],
      icon: attack.side === "initiator" ? "fa-arrow-right" : "fa-arrow-left",
      name: name(attack.side),
      result: spared ? i18n.localize("FEO.Exchange.backfire") : attack.hit ? String(attack.damage) : i18n.localize("FEO.Chat.miss"),
      crit: attack.crit && !spared,
      cls: (!attack.hit || spared) ? "miss" : attack.crit ? "crit" : "hit",
      tags
    };
  });

  // What deserves a line of its own: skills that activated as the fight began, units falling, ranks gained,
  // weapons breaking, anything left unsaved
  const notable = [];
  for ( const proc of result.opening ?? [] ) {
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
  const harmed = (entry, amount) => ({
    label: i18n.format("FEO.Exchange.harmed", { name: name(foeOf(entry.by)), amount, skill: entry.skill }),
    cls: "bad"
  });
  for ( const attack of result.attacks ) {
    for ( const entry of attack.harm ?? [] ) notable.push(harmed(entry, entry.amount));
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
    const id = `${entry.to ?? entry.unit}|${entry.change.name}|${entry.change.from}`;
    let granted = lines.has(id) ? grantChange([lines.get(id).change], entry.change).change : entry.change;
    if ( entry.to ) {
      granted = (spending[entry.to].timed ?? []).find((change) => (change.name === entry.change.name) && (change.from === entry.change.from));
      if ( !granted ) continue;
    }
    lines.set(id, { name: entry.name, change: granted });
  }
  for ( const { name: who, change: granted } of lines.values() ) notable.push({
    label: i18n.format("FEO.Exchange.granted", { name: who, skill: timedName(granted), ...describeChange(granted, i18n) }),
    cls: "cond"
  });

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
    if ( side.triangle > 0 ) details.push({
      label: i18n.localize("FEO.Exchange.triangle"),
      value: i18n.format("FEO.Exchange.triangleBonus", {
        name: name(key),
        hit: signed(side.triangleHit),
        damage: signed(side.triangleDamage)
      })
    });
  }
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
      if ( usage.cooldown > 0 ) costs.push(i18n.format("FEO.Usage.cooldown", { turns: usage.cooldown }));
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
    rolls.push(i18n.format("FEO.Exchange.hitRoll", { roll: attack.hitRoll, chance: attack.hitChance }));
    // A follow-up attack whose Critical was multiplied says by how much
    if ( attack.critRoll !== null ) {
      rolls.push(i18n.format(attack.fcm ? "FEO.Optional.fcm.card.roll" : "FEO.Exchange.critRoll", {
        roll: attack.critRoll, chance: attack.critChance, times: attack.fcm
      }));
    }
    if ( attack.backfire ) {
      rolls.push(i18n.format("FEO.Exchange.backfireRoll", { roll: attack.backfire.roll, chance: attack.backfire.chance }));
    }
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
    details.push({ label: `${index + 1}. ${label}`, value: rolls.join(" · ") });
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
  for ( const key of SIDES ) {
    const { usesSpent, usesStart, uses } = result[key];
    if ( usesSpent ) details.push({
      label: weaponName(key),
      value: i18n.format("FEO.Exchange.uses", { from: usesStart, to: uses })
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

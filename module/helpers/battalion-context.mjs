/**
 * Battalions & Gambits for display, and as plain data: a Battalion and the unit that commands it as the rules
 * read them, what is shown before a Gambit is used, what using one changes about the units it touched, and
 * the chat card posted afterwards. Nothing here touches Foundry, so that it can be tested outside of it;
 * strings are localized through whatever `i18n` is passed in.
 *
 * @import {GambitPlan, GambitResult, GambitUnit} from "../rules/battalions.mjs"
 * @import {ChatCard} from "./chat.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */
import { FEO } from "../config.mjs";
import { authorityNext, battalionBonuses, canAssign, fightBattalions } from "../rules/battalions.mjs";
import { conditionKeys } from "./condition-context.mjs";

/** Write a number with its sign. */
const signed = (value) => `${value < 0 ? "−" : "+"}${Math.abs(value)}`;

/* -------------------------------------------- */
/*  Plain Data                                  */
/* -------------------------------------------- */

/**
 * A Battalion as the rules read it.
 * @param {{id: string, name: string, system: object}} item
 * @returns {object}
 */
export function battalionData(item) {
  const { rank, quality, level, exp, hp, bonuses, gambit } = item.system;
  return {
    id: item.id,
    name: item.name,
    rank,
    quality,
    level,
    exp,
    hp: { value: hp.value, max: hp.max },
    bonuses,
    gambit: { ...gambit, uses: { value: gambit.uses.value, max: gambit.uses.max } }
  };
}

/* -------------------------------------------- */

/**
 * What a unit brings to the rules of Battalions: its Authority, and the Battalion it commands. Without the
 * module it brings neither.
 * @param {{items?: Iterable<object>, system: object}} actor
 * @returns {{authority: {rank: string, exp: number}, battalion: object|null}|null}
 */
export function commandOf(actor) {
  if ( !FEO.optional.battalions.enabled ) return null;
  const authority = actor.system.authority ?? {};
  const item = Array.from(actor.items ?? []).find((owned) => (owned.type === "battalion") && owned.system.equipped) ?? null;
  return {
    authority: { rank: authority.rank ?? "F", exp: authority.exp ?? 0 },
    battalion: item ? battalionData(item) : null
  };
}

/* -------------------------------------------- */

/**
 * Describe a unit for a Gambit, whether it uses one or is its target.
 * @param {object} actor                  Anything shaped like an Actor
 * @param {string} [name]                 The name to show, when it differs from the Actor's
 * @param {object} [options]
 * @param {boolean} [options.keepsDamage] Is damage past 0 HP kept for the unit, as the Incapacitation system
 *                                        has it?
 * @returns {GambitUnit}
 */
export function gambitUnitOf(actor, name, { keepsDamage = false } = {}) {
  const system = actor.system;
  const command = commandOf(actor);
  return {
    name: name ?? actor.name,
    hp: system.hp.value,
    hpMax: system.hp.max,
    hpBase: system.hp.base ?? system.hp.max,
    keepsDamage,
    stats: system.battleValues ?? system.statValues,
    authority: command?.authority ?? { rank: "F", exp: 0 },
    qualities: system.specialQualities ?? "",
    conditions: system.conditions ?? {},
    wards: system.skills?.bends?.nullify ?? [],
    down: !!system.defeat?.state,
    taken: system.stagger?.times ?? 1,
    battalion: command?.battalion ?? null
  };
}

/* -------------------------------------------- */
/*  Before the Gambit                           */
/* -------------------------------------------- */

/**
 * What is shown before a Gambit is used: the Gambit and its Effect, and for an Offensive Gambit the chance to
 * hit and the damage against each target.
 * @param {GambitPlan} plan
 * @param {Localizer} i18n
 * @returns {ChatCard}
 */
export function gambitForecast(plan, i18n) {
  const at = (key, data = {}) => i18n.format(`FEO.Optional.battalions.${key}`, data);
  const uses = plan.gambit.uses ?? { value: 0, max: 0 };
  const rows = plan.strikes.map((strike) => {
    const target = plan.targets[strike.index];
    const parts = [at("forecast.strike", { hit: strike.hit, damage: strike.damage })];
    if ( strike.effective.length ) parts.push(at("forecast.effective", { qualities: strike.effective.join(", ") }));
    return { label: target.name, value: parts.join(" · ") };
  });
  if ( !plan.offensive && plan.targets.length ) rows.push({
    label: at("forecast.targets"),
    value: plan.targets.map((target) => target.name).join(", ")
  });
  if ( uses.max > 0 ) rows.push({ label: i18n.localize("FEO.Weapon.uses"), value: `${uses.value} / ${uses.max}` });
  if ( plan.gambit.area ) rows.push({ label: at("field.area"), value: plan.gambit.area });
  return {
    title: at("forecast.title", { gambit: plan.gambit.name || i18n.localize("FEO.Optional.battalions.gambit"), battalion: plan.user.battalion?.name ?? "" }),
    subtitle: plan.gambit.effect,
    rows,
    note: plan.offensive ? at("forecast.note") : at("forecast.supportNote")
  };
}

/* -------------------------------------------- */
/*  After the Gambit                            */
/* -------------------------------------------- */

/**
 * What using a Gambit changes about the unit that used it and about each of its targets, in the shape the
 * changes of an exchange are saved in (see `ExchangeChange`).
 * @param {GambitPlan} plan
 * @param {GambitResult} result
 * @returns {{user: object, targets: object[]}}
 */
export function gambitChanges(plan, result) {
  const squad = plan.user.battalion;
  const user = {};
  if ( result.authority.gained ) user.authority = { rank: result.authority.rank, exp: result.authority.exp };
  if ( squad ) {
    user.battalion = { id: squad.id };
    if ( result.level.gained ) Object.assign(user.battalion, { level: result.level.level, exp: result.level.exp });
    if ( result.uses.spent ) user.battalion.uses = result.uses.value;
  }

  const targets = plan.targets.map((target, index) => {
    const hit = result.hits.find((entry) => entry.index === index);
    const change = {};
    if ( !hit ) return change;
    if ( hit.hp !== hit.hpBefore ) change.hp = hit.hp;
    if ( hit.wounds > 0 ) change.wounds = hit.wounds;

    // A unit that can be Incapacitated and goes down has a card of its own for that, with how long it stays
    if ( hit.defeated && target.keepsDamage ) change.announce = true;
    const conditions = {};
    for ( const entry of hit.inflicted ) if ( entry.success ) conditions[entry.id] = entry.turns;
    if ( Object.keys(conditions).length ) change.conditions = conditions;
    if ( hit.battalion && target.battalion ) change.battalion = { id: target.battalion.id, hp: hit.battalion.hp };
    if ( hit.authority?.gained ) change.authority = { rank: hit.authority.rank, exp: hit.authority.exp };
    return change;
  });
  return { user, targets };
}

/* -------------------------------------------- */

/**
 * A line for Authority EXP earned: how much, and where the unit's Authority now stands.
 * @param {{rank: string, exp: number, gained: number}} authority
 * @param {Localizer} i18n
 * @returns {string}
 */
function authorityLine(authority, i18n) {
  const next = authorityNext(authority.rank);
  return i18n.format(next === null ? "FEO.Optional.battalions.card.authorityTop" : "FEO.Optional.battalions.card.authority", {
    gained: authority.gained,
    rank: i18n.localize(FEO.ranks[authority.rank]),
    exp: authority.exp,
    next
  });
}

/* -------------------------------------------- */

/**
 * A line for what a Battalion lost, and what is left of it.
 * @param {{taken: number, hp: number, effective: boolean}} harm
 * @param {number} max
 * @param {Localizer} i18n
 * @returns {string}
 */
function harmLine(harm, max, i18n) {
  return i18n.format(harm.effective ? "FEO.Optional.battalions.card.harmEffective" : "FEO.Optional.battalions.card.harm", {
    taken: harm.taken,
    hp: harm.hp,
    max,
    times: FEO.optional.battalions.health.effective
  });
}

/* -------------------------------------------- */

/**
 * Build the chat card for a Gambit that was used.
 * @param {GambitPlan} plan
 * @param {GambitResult} result
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {string[]} [options.unapplied]    Names of units whose changes could not be saved
 * @returns {ChatCard}
 */
export function buildGambitCard(plan, result, i18n, { unapplied = [] } = {}) {
  const at = (key, data = {}) => i18n.format(`FEO.Optional.battalions.${key}`, data);
  const condition = (id) => i18n.localize(conditionKeys(id).name);
  const squad = plan.user.battalion;
  const gambit = plan.gambit.name || i18n.localize("FEO.Optional.battalions.gambit");
  const rows = [];

  // Each target: the roll, what the hit did, and what became of its Battalion
  for ( const hit of result.hits ) {
    const target = plan.targets[hit.index];
    const rolled = i18n.format("FEO.Chat.rolledAgainst", { roll: hit.roll, target: hit.chance });
    rows.push({
      label: target.name,
      value: hit.hit
        ? at("card.hit", { damage: hit.damage, hpBefore: hit.hpBefore, hp: hit.hp, rolled })
        : at("card.miss", { rolled }),
      cls: hit.hit ? "strong" : ""
    });
    if ( hit.defeated && !target.keepsDamage ) rows.push({ label: target.name, value: i18n.format("FEO.Exchange.defeated", { name: target.name }), cls: "bad" });
    if ( hit.wounds > 0 ) rows.push({
      label: target.name,
      value: i18n.format(hit.wounds === 1 ? "FEO.Defeat.wound" : "FEO.Defeat.wounds", { name: target.name, count: hit.wounds }),
      cls: "bad"
    });
    for ( const entry of hit.inflicted ) {
      const ward = entry.warded?.at(-1);
      rows.push({
        label: target.name,
        value: entry.success
          ? i18n.format(entry.turns === 1 ? "FEO.Exchange.inflictedTurn" : "FEO.Exchange.inflictedTurns", {
            name: target.name, condition: condition(entry.id), turns: entry.turns
          })
          : i18n.format("FEO.Exchange.nullified", { name: target.name, condition: condition(entry.id), skill: ward?.skill ?? "" })
      });
    }
    if ( hit.battalion && target.battalion ) {
      rows.push({ label: target.battalion.name, value: harmLine(hit.battalion, target.battalion.hp.max, i18n) });
      if ( hit.battalion.retreated ) rows.push({
        label: target.battalion.name,
        value: at("card.retreats", { battalion: target.battalion.name, name: target.name }),
        cls: "bad"
      });
    }
    if ( hit.authority?.gained ) rows.push({
      label: `${target.name} · ${at("authority")}`,
      value: authorityLine(hit.authority, i18n),
      cls: hit.authority.rankUps ? "good" : ""
    });
  }

  // A Support Gambit names whom it was used on
  if ( !plan.offensive && plan.targets.length ) rows.push({
    label: at("forecast.targets"),
    value: plan.targets.map((target) => target.name).join(", ")
  });

  // What the unit and its Battalion earned, and the uses the Gambit has left
  if ( result.authority.gained ) rows.push({
    label: at("authority"),
    value: authorityLine(result.authority, i18n),
    cls: result.authority.rankUps ? "good" : ""
  });
  if ( squad && result.level.gained ) rows.push({
    label: squad.name,
    value: result.level.levelUps
      ? at("card.levelUp", { gained: result.level.gained, level: result.level.level })
      : at("card.exp", { gained: result.level.gained, exp: result.level.exp, next: FEO.optional.battalions.levels.exp }),
    cls: result.level.levelUps ? "good" : ""
  });
  if ( result.uses.max > 0 ) rows.push({ label: i18n.localize("FEO.Weapon.uses"), value: `${result.uses.value} / ${result.uses.max}` });

  // What is left of the Gambit's Effect for the table, and anything that could not be saved
  const notes = [];
  if ( plan.read.left ) notes.push(at("card.byHand", { text: plan.read.left }));
  else if ( !plan.offensive && plan.gambit.effect ) notes.push(at("card.byHand", { text: plan.gambit.effect }));
  if ( unapplied.length ) notes.push(i18n.format("FEO.Exchange.unapplied", { names: unapplied.join(", ") }));

  const names = plan.targets.map((target) => target.name).join(", ");
  const card = {
    title: names ? at("card.usesOn", { gambit, targets: names }) : at("card.uses", { gambit }),
    subtitle: squad ? at("card.with", { battalion: squad.name, level: squad.level }) : "",
    rows,
    note: notes.join(" ")
  };
  if ( plan.offensive ) card.outcome = {
    label: i18n.localize(result.hitAny ? "FEO.Chat.hit" : "FEO.Chat.miss"),
    cls: result.hitAny ? "good" : "bad"
  };
  return card;
}

/* -------------------------------------------- */
/*  In a Fight                                  */
/* -------------------------------------------- */

/**
 * The lines an exchange card shows for what the fight did to the Battalions of the two units: what each lost,
 * one that retreated, and the Authority EXP a unit earned for making its foe's Battalion retreat.
 * @param {import("../rules/combat.mjs").ExchangePlan} plan
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {Localizer} i18n
 * @returns {{notable: {label: string, cls: string}[], details: {label: string, value: string}[]}}
 */
export function battalionLines(plan, result, i18n) {
  const notable = [];
  const details = [];
  const fight = fightBattalions(plan, result);
  for ( const side of ["initiator", "defender"] ) {
    const name = plan[side].unit.name;
    const { battalion, authority } = fight[side];
    if ( battalion ) {
      details.push({ label: `${name} · ${battalion.name}`, value: harmLine(battalion, battalion.max, i18n) });
      if ( battalion.retreated ) notable.push({
        label: i18n.format("FEO.Optional.battalions.card.retreats", { battalion: battalion.name, name }),
        cls: "bad"
      });
    }
    if ( authority?.gained ) {
      details.push({ label: `${name} · ${i18n.localize("FEO.Optional.battalions.authority")}`, value: authorityLine(authority, i18n) });
      if ( authority.rankUps ) notable.push({
        label: i18n.format("FEO.Optional.battalions.card.rankUp", { name, rank: i18n.localize(FEO.ranks[authority.rank]) }),
        cls: "gold"
      });
    }
  }
  return { notable, details };
}

/* -------------------------------------------- */
/*  On the Sheet                                */
/* -------------------------------------------- */

/**
 * What a Battalion adds to its commander, part by part: "+2" of STR, "+5" of Dodge.
 * @param {{stats: object, abilities: object, combat: object}} granted    As `battalionBonuses` returns it
 * @returns {{label: string, amount: string}[]}     Each with the translation key of what it adds to
 */
export function bonusParts(granted) {
  return Object.entries({ ...granted.stats, ...granted.abilities, ...granted.combat }).map(([key, amount]) => {
    return { label: bonusLabel(key), amount: signed(amount) };
  });
}

/* -------------------------------------------- */

/**
 * The translation key of what a bonus of a Battalion adds to.
 * @param {string} key
 * @returns {string}
 */
export function bonusLabel(key) {
  const { combat } = FEO.optional.battalions.bonuses;
  return combat.includes(key) ? FEO.combatBoosts[key] : `FEO.Stat.${key}.abbr`;
}

/* -------------------------------------------- */

/**
 * What the system reads from a Gambit's Effect, in words: each part it applies by itself, and the text it
 * leaves to the table.
 * @param {import("../rules/battalions.mjs").GambitReading} read
 * @param {Localizer} i18n
 * @returns {{applied: string[], left: string}}
 */
export function gambitReading(read, i18n) {
  const part = (key, data = {}) => i18n.format(`FEO.Optional.battalions.reads.${key}`, data);
  const applied = [];
  if ( read.magic ) applied.push(part("magic"));
  if ( read.effective.length ) applied.push(part("effective", { qualities: read.effective.join(", "), times: FEO.optional.battalions.gambit.effective }));
  if ( read.inflicts.length ) applied.push(part("inflicts", { conditions: read.inflicts.map((id) => i18n.localize(conditionKeys(id).name)).join(", ") }));
  if ( read.oneRoll ) applied.push(part("oneRoll"));
  return { applied, left: read.left };
}

/* -------------------------------------------- */

/**
 * What the dialog for taking a Battalion from the compendium shows: the Battalions a unit could command now
 * and does not have yet, folder by folder, and for each what it adds at level 1 and what its Gambit does. It
 * is laid out as the dialog a Combat Art is learned in is (`buildLearnChoices`), which shows it.
 * @param {{id: string, name: string, folder?: string, system: object}[]} battalions    Those of the compendium
 * @param {object} unit
 * @param {string} [unit.authority]     Its Authority rank
 * @param {string} [unit.qualities]     Its Special Qualities
 * @param {string[]} [unit.has]         The names of the Battalions it has already
 * @param {Localizer} i18n
 * @returns {{groups: {label: string, arts: {id: string, label: string}[]}[], effects: Record<string, string>, count: number}}
 */
export function buildTakeChoices(battalions, unit, i18n) {
  const config = FEO.optional.battalions;
  const at = (key, data = {}) => i18n.format(`FEO.Optional.battalions.${key}`, data);
  const has = new Set((unit.has ?? []).map((name) => name.toLowerCase()));
  const groups = [];
  const effects = {};
  for ( const battalion of battalions ) {
    const squad = battalion.system;
    if ( has.has(battalion.name.toLowerCase()) || !canAssign(squad, unit).ok ) continue;
    const label = battalion.folder || `${at("authority")} ${i18n.localize(FEO.ranks[squad.rank])}`;
    let group = groups.find((entry) => entry.label === label);
    if ( !group ) groups.push(group = { label, arts: [] });
    const gambit = squad.gambit;
    group.arts.push({
      id: battalion.id,
      label: at("take.option", { name: battalion.name, gambit: gambit.name || at("gambit"), hp: squad.hp.max, cost: Number(squad.cost).toLocaleString("en-US") })
    });

    // What it adds as it comes, then its Gambit as its row on the sheet words it, and the Effect
    const bonuses = bonusParts(battalionBonuses({ ...squad, level: 1, hp: { value: 0, max: 0 } }))
      .map((part) => `${part.amount} ${i18n.localize(part.label)}`);
    const line = [i18n.localize(config.gambit.kinds[gambit.kind] ?? "")];
    if ( gambit.kind === "offensive" ) line.push(at("gambitLine", { might: gambit.might, hit: gambit.hit }));
    line.push(`${i18n.localize("FEO.Weapon.range")} ${gambit.range}`);
    if ( gambit.uses.max > 0 ) line.push(at("usesLine", { value: gambit.uses.max, max: gambit.uses.max }));
    if ( gambit.area ) line.push(gambit.area);
    effects[battalion.id] = [
      bonuses.join(", "),
      `${gambit.name || at("gambit")}: ${line.join(" · ")}`,
      gambit.effect
    ].filter(Boolean).join("\n");
  }
  return { groups, effects, count: Object.keys(effects).length };
}

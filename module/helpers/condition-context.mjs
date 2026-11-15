import { FEO } from "../config.mjs";
import { conditionConfig, conditionModifiers, restrictions } from "../rules/conditions.mjs";

/**
 * Display data for conditions: the chips on the unit sheet, the reminders of what a unit cannot do, and the
 * chat card posted when a unit's turn starts. Nothing here touches Foundry, so that it can be tested outside
 * of it; the card's strings are localized through whatever `i18n` is passed in.
 *
 * @import {ConditionState, TurnStart} from "../rules/conditions.mjs"
 * @import {ChatCard} from "./chat.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * The translation keys of a condition's name and of the one-line reminder of what it does.
 * @param {string} id
 * @returns {{name: string, hint: string}}
 */
export function conditionKeys(id) {
  return { name: `FEO.Condition.${id}`, hint: `FEO.ConditionHint.${id}` };
}

/* -------------------------------------------- */

/**
 * The conditions on a unit as the sheet shows them, read from its active effects. Effects that are not one
 * of the system's conditions are listed too, without a countdown.
 * @param {Iterable<object>} effects      The unit's active effects
 * @param {ConditionState} state          The unit's conditions and the turns each has left
 * @returns {object[]}
 */
export function prepareConditions(effects, state) {
  const modifiers = new Map(conditionModifiers(state).map((source) => [source.id, source]));
  const conditions = [];
  for ( const effect of effects ?? [] ) {
    if ( effect.disabled || (effect.active === false) ) continue;
    const statusId = Array.from(effect.statuses ?? []).find((id) => conditionConfig(id)) ?? null;
    const config = conditionConfig(statusId);
    const turns = config ? (state[statusId] ?? config.turns) : null;
    const source = modifiers.get(statusId);
    const parts = [];
    for ( const [key, amount] of Object.entries(source?.combat ?? {}) ) parts.push({ label: FEO.combatBoosts[key], amount });
    for ( const [key, amount] of Object.entries(source?.stats ?? {}) ) parts.push({ label: FEO.stats[key].abbr, amount });
    conditions.push({
      id: effect.id,
      name: effect.name,
      statusId,
      img: effect.img ?? config?.img ?? null,
      hint: config ? conditionKeys(statusId).hint : null,
      turns,
      counted: config ? (config.countdown !== false) : false,
      last: turns === 0,
      stacks: !!config?.stacks,
      stackMax: config?.stacks?.max ?? null,
      parts
    });
  }
  return conditions;
}

/* -------------------------------------------- */

/**
 * The reminders of what a unit's conditions stop it from doing.
 * @param {ConditionState} state
 * @param {{category: string}|null} [weapon]    The weapon in hand
 * @returns {{id: string, name: string, hint: string}[]}
 */
export function prepareReminders(state, weapon = null) {
  return restrictions(state, weapon).map((id) => ({ id, ...conditionKeys(id) }));
}

/* -------------------------------------------- */

/**
 * Build the chat card for the start of a unit's turn: the damage its conditions dealt, how long each one has
 * left, which ended, and what the unit cannot do this turn.
 * @param {TurnStart} result
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {string} [options.name]                     The unit's name
 * @param {number} [options.hpMax]                    Its maximum HP
 * @param {{category: string}|null} [options.weapon]  The weapon it has in hand
 * @returns {ChatCard}
 */
export function buildTurnCard(result, i18n, { name = "", hpMax = 0, weapon = null } = {}) {
  const label = (id) => i18n.localize(conditionKeys(id).name);
  const turnsLeft = (turns) => {
    if ( turns === 0 ) return i18n.localize("FEO.Turn.lastTurn");
    return i18n.format(turns === 1 ? "FEO.Turn.turnLeft" : "FEO.Turn.turnsLeft", { turns });
  };

  const rows = [];
  if ( result.damage || result.ticks.length ) rows.push({
    label: i18n.localize("FEO.Stat.hp.abbr"),
    value: `${result.hpBefore} → ${result.hp}`,
    cls: "strong"
  });
  for ( const [id, turns] of Object.entries(result.conditions) ) {
    if ( !conditionConfig(id) ) continue;
    const tick = result.ticks.find((entry) => entry.id === id);
    const parts = [];
    // What a skill made of the condition's damage is said with the skill: less of it, more, or HP regained
    const heals = tick?.heals !== undefined;
    if ( tick ) parts.push(i18n.format(heals ? "FEO.Turn.heals" : "FEO.Turn.damage", { damage: heals ? tick.heals : tick.damage, percent: tick.percent, max: hpMax }));
    if ( tick?.skills?.length ) parts.push(tick.skills.join(", "));
    if ( result.reduced.some((entry) => entry.id === id) ) parts.push(turnsLeft(turns));
    if ( parts.length ) rows.push({ label: label(id), value: parts.join(" · "), cls: !tick ? "" : heals ? "good" : "bad" });
  }
  for ( const id of result.ended ) rows.push({ label: label(id), value: i18n.localize("FEO.Turn.ended"), cls: "muted" });

  // A skill that has the unit's conditions run out faster
  if ( result.quick ) rows.push({ label: result.quick.skill, value: i18n.format("FEO.Turn.quick", { turns: result.quick.step }), cls: "" });

  const notes = prepareReminders(result.conditions, weapon).map((reminder) => {
    return `${i18n.localize(reminder.name)}: ${i18n.localize(reminder.hint)}`;
  });
  if ( result.defeated ) notes.unshift(i18n.format("FEO.Exchange.defeated", { name }));

  const card = { title: i18n.localize("FEO.Turn.title"), subtitle: name, rows, cls: "feo-turn" };
  if ( result.damage ) card.outcome = { label: i18n.format("FEO.Turn.lost", { damage: result.damage }), cls: "bad" };
  else if ( result.healed ) card.outcome = { label: i18n.format("FEO.Turn.gained", { amount: result.healed }), cls: "good" };
  if ( notes.length ) card.note = notes.join(" ");
  return card;
}

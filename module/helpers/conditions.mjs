import { FEO } from "../config.mjs";
import { applyCondition, conditionConfig, endTurn, startTurn } from "../rules/conditions.mjs";
import { postCard } from "./chat.mjs";
import { buildTurnCard } from "./condition-context.mjs";

/**
 * Conditions on units in Foundry. A condition is an active effect carrying the condition's status; the turns
 * it has left are kept in a flag on that effect and counted by the system, at the start and end of the
 * unit's own turns, rather than by the combat round clock of the core software.
 *
 * @import {ConditionState, TurnStart} from "../rules/conditions.mjs"
 */

/** The path, on an active effect, of the turns its condition has left. */
export const TURNS_FLAG = `flags.${FEO.id}.turns`;

/* -------------------------------------------- */

/**
 * The conditions on a unit and the turns each has left.
 * @param {Actor} actor
 * @returns {ConditionState}
 */
export function conditionsOf(actor) {
  return { ...(actor.system.conditions ?? {}) };
}

/* -------------------------------------------- */

/**
 * Is a unit taking part in an encounter that has begun, so that the combat tracker counts its turns?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isTracked(actor) {
  return !!game.combat?.started && actor.inCombat;
}

/* -------------------------------------------- */

/**
 * Save changes to a unit's conditions.
 * @param {Actor} actor
 * @param {Record<string, number|null>} changes   Turns left by condition id; null removes the condition
 * @returns {Promise<void>}
 */
export async function setConditions(actor, changes) {
  const ActiveEffect = foundry.documents.ActiveEffect.implementation;
  const created = [];
  const updated = [];
  const deleted = [];

  for ( const [id, turns] of Object.entries(changes ?? {}) ) {
    const config = conditionConfig(id);
    if ( !config || config.combatOnly ) continue;
    const existing = actor.effects.filter((effect) => effect.statuses.has(id));
    if ( turns === null ) {
      deleted.push(...existing.map((effect) => effect.id));
      continue;
    }
    if ( !Number.isInteger(turns) || (turns < 0) ) continue;
    if ( existing.length ) {
      updated.push({ _id: existing[0].id, [TURNS_FLAG]: turns });
      continue;
    }
    const effect = await ActiveEffect.fromStatusEffect(id, { parent: actor });
    effect.updateSource({ [TURNS_FLAG]: turns });
    created.push(effect.toObject());
  }

  if ( deleted.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", deleted);
  if ( updated.length ) await actor.updateEmbeddedDocuments("ActiveEffect", updated);
  if ( created.length ) await actor.createEmbeddedDocuments("ActiveEffect", created, { keepId: true });
}

/* -------------------------------------------- */

/**
 * Apply a condition to a unit. A condition it already has is reset to its full time, or added to if it is
 * one that stacks.
 * @param {Actor} actor
 * @param {string} id                 A key of FEO.conditions
 * @param {object} [options]
 * @param {number} [options.turns]    Turns to apply, instead of the condition's usual amount
 * @returns {Promise<number|null>}    The turns the condition now has
 */
export async function applyConditionTo(actor, id, options = {}) {
  const { turns } = applyCondition(conditionsOf(actor), id, options);
  if ( turns !== null ) await setConditions(actor, { [id]: turns });
  return turns;
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: its conditions deal their damage and lose a turn, and one chat card reports it.
 * @param {Actor} actor
 * @returns {Promise<TurnStart|null>}   What happened, or null if the unit has no conditions
 */
export async function startTurnFor(actor) {
  if ( actor?.type !== "unit" ) return null;
  const conditions = conditionsOf(actor);
  if ( !Object.keys(conditions).length ) return null;

  const { value: hp, max: hpMax } = actor.system.hp;
  // The unit's skills may bend what its conditions deal, how fast they run out and whether they do
  const result = startTurn({ hp, hpMax, conditions, bends: actor.system.skills?.bends ?? null });
  if ( result.hp !== hp ) await actor.update({ "system.hp.value": result.hp });

  const changes = {};
  for ( const id of result.ended ) changes[id] = null;
  for ( const { id, to } of result.reduced ) changes[id] = to;
  await setConditions(actor, changes);

  if ( result.ticks.length || result.reduced.length || result.ended.length ) {
    const weapon = actor.system.equippedWeapon;
    await postCard(actor, buildTurnCard(result, game.i18n, {
      name: actor.token?.name ?? actor.name,
      hpMax,
      weapon: weapon ? { category: weapon.system.category } : null
    }));
  }
  return result;
}

/* -------------------------------------------- */

/**
 * A unit's turn ends: conditions that were in their last turn end.
 * @param {Actor} actor
 * @returns {Promise<string[]>}   The conditions that ended
 */
export async function endTurnFor(actor) {
  if ( actor?.type !== "unit" ) return [];
  const { ended } = endTurn({ conditions: conditionsOf(actor) });
  if ( ended.length ) await setConditions(actor, Object.fromEntries(ended.map((id) => [id, null])));
  return ended;
}

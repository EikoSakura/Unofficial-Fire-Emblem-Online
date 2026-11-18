import { FEO } from "../config.mjs";
import { applyCondition, aroundTicks, conditionConfig, endTurn, startTurn } from "../rules/conditions.mjs";
import { damageShares } from "../rules/events.mjs";
import { postCard } from "./chat.mjs";
import { buildTurnCard } from "./condition-context.mjs";
import { damageUnit, eventUnitOf, healUnit, pop } from "./events.mjs";
import { standingOf, tokenInView } from "./positions.mjs";

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
 * Save changes to a unit's conditions, as they are: whether a condition is applied at all, and what follows
 * from it, is settled before (see `afflictUnit` in `events.mjs`).
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
  if ( created.length ) await actor.createEmbeddedDocuments("ActiveEffect", created, { keepId: true, [FEO.id]: { settled: true } });
}

/* -------------------------------------------- */

/**
 * Apply a condition to a unit as it is, without asking anybody's skills, as when a unit is set up in Edit
 * mode. A condition it already has is reset to its full time, or added to if it is one that stacks.
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
  // What it takes more or less of, as a Staggered unit takes more, counts for each of them
  const share = damageShares(eventUnitOf(actor), { kind: "condition" });
  const result = startTurn({ hp, hpMax, conditions, bends: actor.system.skills?.bends ?? null, times: share.times });
  if ( result.ticks.length && share.shares.length ) pop(actor, share.shares.map(({ skill }) => ({ text: skill, tone: "skill" })));

  // What the conditions restore and what they deal goes the way of all healing and all damage: a blow that
  // would be fatal may be survived, and the card tells what came of it
  if ( result.healed ) await healUnit(actor, result.healed, { down: true });
  if ( result.damage > 0 ) {
    const hurt = await damageUnit(actor, result.damage, { kind: "condition", settled: true });
    if ( hurt ) Object.assign(result, { hp: hurt.hp, damage: hurt.dealt, defeated: hurt.defeated });
  }

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

/* -------------------------------------------- */

/** The flag, on a unit, that lists the conditions of the allies around it which have dealt it their damage this turn. */
const AROUND_FLAG = "aroundTick";

/**
 * A moment of a unit's turn comes: the conditions of the allies around it that reach it (see `around` in the
 * conditions table) deal it their damage, each once a turn. It is dealt as the turn starts where the unit
 * stands that near then, and otherwise as the turn ends where it stands that near by then.
 * @param {Actor} actor
 * @param {"start"|"end"} moment
 * @returns {Promise<number>}     The HP it lost
 */
export async function aroundTickFor(actor, moment) {
  if ( (actor?.type !== "unit") || actor.system.defeat?.state || !(actor.system.hp?.value > 0) ) return 0;
  const before = actor.getFlag(FEO.id, AROUND_FLAG);
  const taken = ((moment === "end") && Array.isArray(before)) ? before : [];
  const token = actor.token ?? tokenInView(actor);
  const place = token ? standingOf(token) : null;
  const ticks = place ? aroundTicks(place.near, actor.system.hp.max, { taken }).filter((tick) => tick.damage > 0) : [];

  // What was dealt as the turn started is remembered until it ends
  if ( (moment === "start") && ticks.length ) await actor.setFlag(FEO.id, AROUND_FLAG, ticks.map((tick) => tick.id));
  else if ( before !== undefined ) await actor.unsetFlag(FEO.id, AROUND_FLAG);
  let lost = 0;
  const rows = [];
  for ( const tick of ticks ) {
    if ( actor.system.defeat?.state || !(actor.system.hp.value > 0) ) break;
    const label = game.i18n.has(`FEO.Condition.${tick.id}`) ? game.i18n.localize(`FEO.Condition.${tick.id}`) : tick.name;
    pop(actor, [{ text: label, tone: "skill" }]);
    const hurt = await damageUnit(actor, tick.damage, { kind: "condition", token });
    const dealt = hurt?.dealt ?? 0;
    lost += dealt;
    rows.push({ label: `${label} (${tick.from})`, value: game.i18n.format("FEO.Act.harmed", { amount: dealt }) });
  }
  if ( rows.length ) {
    await postCard(actor, {
      title: game.i18n.format("FEO.Area.around", { name: actor.token?.name ?? actor.name }),
      subtitle: game.i18n.localize(`FEO.Area.aroundAt.${moment}`),
      rows
    });
  }
  return lost;
}

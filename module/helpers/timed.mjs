import { checkEffects } from "../rules/skills.mjs";
import { cleanChange, grantChange, tickChanges, timedName } from "../rules/timed.mjs";
import { tokenInView } from "./positions.mjs";

/**
 * Changes that last a while on units in Foundry: saving the ones skills grant, counting the turns they last,
 * and taking them off again. They are kept on the unit that carries them, in `system.timed`.
 *
 * @import {TimedChange} from "../rules/timed.mjs"
 */

/**
 * The changes a unit carries, as plain data that can be changed and saved.
 * @param {Actor} actor
 * @returns {TimedChange[]}
 */
export function timedOf(actor) {
  return foundry.utils.deepClone(actor._source?.system?.timed ?? []);
}

/* -------------------------------------------- */

/**
 * Give a unit changes that last a while, on top of what it carries. Anything that is not a sensible change
 * is dropped.
 * @param {Actor} actor
 * @param {TimedChange[]} changes
 * @returns {Promise<TimedChange[]>}    The changes that were given
 */
export async function grantTimed(actor, changes) {
  let list = timedOf(actor);
  const given = [];
  for ( const change of changes ?? [] ) {
    const clean = cleanChange(change, checkEffects);
    if ( !clean ) continue;
    list = grantChange(list, clean).list;
    given.push(clean);
  }
  if ( given.length ) await actor.update({ "system.timed": list });
  return given;
}

/* -------------------------------------------- */

/**
 * Replace the changes a unit carries. Anything that is not a sensible change is dropped.
 * @param {Actor} actor
 * @param {TimedChange[]} list
 * @returns {Promise<void>}
 */
export async function setTimed(actor, list) {
  const clean = (list ?? []).map((change) => cleanChange(change, checkEffects)).filter(Boolean);
  await actor.update({ "system.timed": clean });
}

/* -------------------------------------------- */

/**
 * Take one change off a unit by hand.
 * @param {Actor} actor
 * @param {number} index      Which of its changes
 * @returns {Promise<void>}
 */
export async function removeTimed(actor, index) {
  const list = timedOf(actor);
  if ( !Number.isInteger(index) || !list[index] ) return;
  list.splice(index, 1);
  await actor.update({ "system.timed": list });
}

/* -------------------------------------------- */

/**
 * A moment of a unit's turn comes: the changes it carries that end at that moment count it, and so do the
 * changes on other units of its scene that end by this unit's turns. Changes on units this user may not
 * change are left for the Game Master, whose encounter counts the turns.
 * @param {Actor} actor
 * @param {"turnStart"|"turnEnd"} moment
 * @returns {Promise<string[]>}     The names of the unit's own changes that ended
 */
export async function tickTimedFor(actor, moment) {
  if ( actor?.type !== "unit" ) return [];
  const own = tickChanges(timedOf(actor), moment);
  if ( own.changed ) await actor.update({ "system.timed": own.list });

  const scene = (actor.token ?? tokenInView(actor))?.parent ?? null;
  const seen = new Set([actor]);
  for ( const token of scene?.tokens ?? [] ) {
    const other = token.actor;
    if ( !other || seen.has(other) || (other.type !== "unit") || !other.isOwner ) continue;
    seen.add(other);
    if ( !(other.system.timed ?? []).some((change) => change.clock === actor.uuid) ) continue;
    const theirs = tickChanges(timedOf(other), moment, actor.uuid);
    if ( theirs.changed ) await other.update({ "system.timed": theirs.list });
  }
  return own.ended.map(timedName);
}

/* -------------------------------------------- */

/**
 * A battle begins: what lasted until the end of the last map, or was still running, is over for the units
 * in it.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleTimed(combat) {
  const seen = new Set();
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor) || !actor.isOwner ) continue;
    seen.add(actor);
    if ( actor.system.timed?.length ) await actor.update({ "system.timed": [] });
  }
}

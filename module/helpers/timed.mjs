import { checkEffects } from "../rules/skills.mjs";
import { PHASE_END, boostChange, cleanChange, grantChange, keptBetweenMaps, spendTemp, tickChanges, timedName } from "../rules/timed.mjs";
import { standingOf, tokenInView } from "./positions.mjs";

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
 * @param {object} [options]
 * @param {number|null} [options.times] What the bonuses of the changes the unit gives itself are multiplied by,
 *                                      as for a unit whose buffs are doubled (see `boostChange`); worked out
 *                                      from what the unit has and receives unless given
 * @returns {Promise<TimedChange[]>}    The changes that were given
 */
export async function grantTimed(actor, changes, { times = null } = {}) {
  let list = timedOf(actor);
  const given = [];
  let own = times;
  for ( const change of changes ?? [] ) {
    const mine = !!change && !change.from && !change.mark && !change.drop;
    if ( mine && (own === null) ) own = buffTimesOf(actor);
    const clean = cleanChange((mine && (own !== 1)) ? boostChange(change, own) : change, checkEffects);
    if ( !clean ) continue;

    // A mark that a skill has had its turn for this Phase is kept only where a battle counts Phases
    if ( clean.mark && (clean.ends === PHASE_END) && !game.combat?.started ) continue;
    list = grantChange(list, clean).list;
    given.push(clean);
  }
  if ( given.length ) await actor.update({ "system.timed": list });
  return given;
}

/* -------------------------------------------- */

/**
 * What the bonuses in the lasting changes a unit gives are multiplied by: what its skills, the changes it
 * carries and the auras it receives say, multiplied together.
 * @param {Actor|null} actor
 * @returns {number}      1 for a unit that gives them as they are
 */
export function buffTimesOf(actor) {
  if ( actor?.type !== "unit" ) return 1;
  let place = null;
  try {
    place = standingOf(actor.token ?? tokenInView(actor));
  } catch(err) {
    console.error(err);
  }
  const skills = [...(actor.system.skills?.entries ?? []), ...(actor.system.skills?.timed ?? []), ...(place?.auras ?? [])];
  let times = 1;
  for ( const skill of skills ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( !effect.proc && !effect.aura && Number.isFinite(effect.buffs?.times) && (effect.buffs.times > 0) ) times *= effect.buffs.times;
    }
  }
  return times;
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
 * A unit loses temporary HP: they are taken from the changes that hold them for it.
 * @param {Actor} actor
 * @param {number} amount
 * @returns {Promise<number>}     The temporary HP it lost
 */
export async function loseTemp(actor, amount) {
  if ( !(amount > 0) || !(actor?.system?.hp?.temp > 0) ) return 0;
  const { list, spent } = spendTemp(timedOf(actor), amount);
  if ( spent > 0 ) await actor.update({ "system.timed": list });
  return spent;
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
 * A Phase ends, or a battle does: what lasted until the end of the Phase is over for every unit in the
 * battle, whichever side it is on. Runs for a Game Master.
 * @param {Combat} combat
 * @returns {Promise<number>}     How many units had something end
 */
export async function endPhaseTimed(combat) {
  const seen = new Set();
  let ended = 0;
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor) || !actor.isOwner ) continue;
    seen.add(actor);
    if ( !(actor.system.timed ?? []).some((change) => change.ends === PHASE_END) ) continue;
    const { list, changed } = tickChanges(timedOf(actor), PHASE_END);
    if ( !changed ) continue;
    await actor.update({ "system.timed": list });
    ended += 1;
  }
  return ended;
}

/* -------------------------------------------- */

/**
 * A battle is over: what lasted for the rest of its map is over for a unit that fought in it. Runs for the
 * designated Game Master.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether anything ended
 */
export async function endMapTimed(actor) {
  if ( (actor?.type !== "unit") || !actor.isOwner ) return false;
  const list = timedOf(actor);
  const kept = list.filter((change) => change.ends !== "map");
  if ( kept.length === list.length ) return false;
  await actor.update({ "system.timed": kept });
  return true;
}

/* -------------------------------------------- */

/**
 * A battle begins: what lasted until the end of the last map, or was still running, is over for the units
 * in it. What lasts between maps stays.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleTimed(combat) {
  const seen = new Set();
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor) || !actor.isOwner ) continue;
    seen.add(actor);
    const kept = keptBetweenMaps(timedOf(actor));
    if ( (actor.system.timed?.length ?? 0) !== kept.length ) await actor.update({ "system.timed": kept });
  }
}

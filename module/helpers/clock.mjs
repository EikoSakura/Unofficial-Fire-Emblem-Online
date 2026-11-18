import { clockFrom, needsClock } from "../rules/clock.mjs";
import { battle, fightsIn, phaseOf } from "./phases.mjs";
import { tokenInView } from "./positions.mjs";

/**
 * The turn clock in Foundry: the turn of the battle a unit is in and the Phase that is running, read from the
 * encounter of the scene in view for the skills that ask (see `rules/clock.mjs`). Nothing is saved for this.
 *
 * @import {Clock} from "../rules/clock.mjs"
 */

/**
 * The clock of the battle a unit is fighting in.
 * @param {Actor|null} actor
 * @param {TokenDocument|null} [token]    Its token, which tells units apart that share an Actor
 * @returns {Clock|null}                  Null for a unit that is in no battle
 */
export function clockOf(actor, token = null) {
  try {
    const combat = battle();
    if ( !combat || !actor ) return null;
    if ( !fightsIn(combat, actor, token ?? actor.token ?? tokenInView(actor)) ) return null;
    return clockFrom({ started: combat.started, round: combat.round, phase: phaseOf(combat) });
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Does any of a unit's skills, or of the changes that last on it, ask the clock?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function asksClock(actor) {
  const lists = actor.system.skills ?? {};
  return [...(lists.entries ?? []), ...(lists.timed ?? []), ...(lists.auras ?? [])].some((skill) => (skill.effects ?? []).some(needsClock));
}

/* -------------------------------------------- */

/**
 * Register what tells a unit the turn of its battle. Called once, when the system starts. What changes the
 * clock, an encounter that begins, turns or ends, already has the units of the scene looked at again (see
 * `helpers/movement.mjs`).
 * @param {typeof import("../data/actor-unit.mjs").default} UnitData
 */
export function registerHooks(UnitData) {
  UnitData.clock = (actor) => clockOf(actor);
}

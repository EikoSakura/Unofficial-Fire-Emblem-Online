import { relationOf } from "../rules/positions.mjs";
import { castStaff, staffBends } from "../rules/staves.mjs";
import { armyOf, measureDistance } from "./exchange.mjs";
import { standingOf } from "./positions.mjs";
import { reachText, staffRows } from "./staff-context.mjs";
import { grantTimed } from "./timed.mjs";

/**
 * Staves in Foundry: a staff that heals one unit restores its HP when it is used, and the skills of the two
 * units have their say. Everything else a staff does stays on its card for the table.
 *
 * @import {StaffCast, StaffUnit} from "../rules/staves.mjs"
 */

/**
 * Describe a unit as it is now for the staff rules: its numbers, the skills it has equipped and the lasting
 * changes it carries, and what it has around it.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    Its token, if it has one on a map
 * @returns {StaffUnit}
 */
export function staffUnitOf(actor, token = null) {
  const system = actor.system;
  return {
    name: token?.name || actor.name,
    uuid: actor.uuid ?? "",
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    stats: system.statValues,
    conditions: system.conditions ?? {},
    qualities: system.specialQualities ?? "",
    skills: [...(system.skills?.entries ?? []), ...(system.skills?.timed ?? [])],
    near: standingOf(token)?.near ?? null
  };
}

/* -------------------------------------------- */

/**
 * What a unit heals an ally for with something that restores a fixed amount, such as an item: the amount
 * with the share its skills add to what it heals allies for, rounded down.
 * @param {Actor} actor
 * @param {number} amount
 * @returns {number}
 */
export function healsMore(actor, amount) {
  const unit = staffUnitOf(actor);
  const { more } = staffBends(unit.skills, unit);
  return more ? Math.floor(((amount * (100 + more)) / 100) + 1e-9) : amount;
}

/* -------------------------------------------- */

/**
 * A unit uses a staff: restore the HP it heals, give what the unit's skills grant, and deal what they deal.
 * A unit this user may not change, or one that is down, is left for the table and said to be.
 * @param {Actor} actor                   The unit that uses the staff
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Item} item                     The staff
 * @param {Token|null} [ally]             The one other unit the user has targeted, if any
 * @returns {Promise<{cast: StaffCast, rows: object[], range: string|null, freeUse: boolean}>}
 *          What happened, the rows for the staff's card, the staff's Range as skills make it when they
 *          change it, and whether the staff is spared its use
 */
export async function castStaffFor(actor, token, item, ally = null) {
  const target = ally?.actor ?? null;
  const targetToken = ally?.document ?? null;
  const names = { caster: token?.name || actor.name, target: targetToken?.name || target?.name || "" };
  const cast = castStaff({
    staff: { name: item.name, effect: item.system.effect, range: item.system.range },
    caster: staffUnitOf(actor, token),
    target: target ? { ...staffUnitOf(target, targetToken), ally: relationOf(armyOf(actor, token), armyOf(target, targetToken)) === "ally" } : null,
    distance: (token && targetToken) ? measureDistance(token, targetToken) : null
  });
  const able = (unit) => !!unit?.isOwner && !unit.system.defeat?.state;

  // HP restored: to the unit the staff is used on, or to its user
  if ( cast.heal ) {
    const patient = (cast.patient === "self") ? actor : target;
    if ( !able(patient) ) cast.heal.unsaved = true;
    else if ( cast.heal.restored > 0 ) await patient.update({ "system.hp.value": Math.max(patient.system.hp.value, 0) + cast.heal.restored });
  }
  if ( cast.user?.restored > 0 ) await actor.update({ "system.hp.value": actor.system.hp.value + cast.user.restored });

  // Changes that last a while, and damage to the enemy nearest to the unit healed
  for ( const moment of cast.moments ) {
    const own = moment.granted.filter((granted) => granted.to === "self").map((granted) => granted.change);
    if ( own.length ) await grantTimed(actor, own);
    for ( const granted of moment.granted ) {
      if ( granted.to !== "target" ) continue;
      if ( able(target) ) await grantTimed(target, [granted.change]);
      else granted.unsaved = true;
    }
    const harm = moment.harm;
    if ( harm?.units.length === 1 ) {
      const enemy = targetToken?.parent?.tokens.get(harm.units[0].id)?.actor;
      if ( able(enemy) ) await enemy.update({ "system.hp.value": Math.max(enemy.system.hp.value - harm.amount, 0) });
      else harm.unsaved = true;
    }
  }
  return { cast, rows: staffRows(cast, game.i18n, names), range: reachText(cast), freeUse: !!cast.freeUse };
}

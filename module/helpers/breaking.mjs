/**
 * Break in Foundry: the mark a unit carries while it suffers from Break, which a fight sets and ends (see
 * `exchange.mjs`), and which also ends when the unit's own turn starts and when a new battle begins.
 */

/**
 * Rid a unit of Break, or mark it as suffering from it, as a Game Master does by hand.
 * @param {Actor} actor
 * @param {boolean} [on]      Whether it suffers from Break; the other way round from now unless given
 * @returns {Promise<boolean>}    Whether anything changed
 */
export async function setBreak(actor, on = !actor?.system?.break) {
  if ( (actor?.type !== "unit") || (!!actor.system.break === !!on) ) return false;
  await actor.update({ "system.break": !!on });
  return true;
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: it no longer suffers from Break.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it did until now
 */
export function endBreakFor(actor) {
  return setBreak(actor, false);
}

/* -------------------------------------------- */

/**
 * A battle begins: nobody in it suffers from Break yet.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleBreak(combat) {
  const done = new Set();
  for ( const combatant of combat.combatants ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || done.has(actor.uuid) ) continue;
    done.add(actor.uuid);
    await setBreak(actor, false);
  }
}

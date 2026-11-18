import { FEO } from "../config.mjs";
import { settleAffinity } from "./affinity.mjs";
import { endBreakFor, startBattleBreak } from "./breaking.mjs";
import { tickCaptiveFor } from "./capturing.mjs";
import { aroundTickFor, endTurnFor, startTurnFor } from "./conditions.mjs";
import { tickDefeatFor } from "./defeat.mjs";
import { keepConditions, startBattleEvents } from "./events.mjs";
import { settleShiftsFor, startBattleShift, tickShiftFor } from "./shifting.mjs";
import { endStaggerTurnFor, startBattleStagger, startStaggerTurnFor } from "./stagger.mjs";
import { endSkillTurnFor, startBattleSkills, startSkillTurnFor } from "./skill-turns.mjs";
import { awardBattle, awardEvent } from "./supports.mjs";

/**
 * Everything that happens when a unit's turn starts or ends, whether the combat tracker or the buttons on
 * the sheet say so.
 */

/**
 * A battle begins, before anybody's turn: partners fielded in it together grow closer, every Laguz starts
 * from its starting Shift Gauge in humanoid form, nobody suffers from Break, and every Stagger bar is made
 * anew. Runs for the user who begins the encounter.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattle(combat) {
  // A unit that still imitates another from before is itself again
  try {
    const { endImitations } = await import("./imitation.mjs");
    await endImitations(combat);
  } catch(err) {
    console.error(err);
  }

  // Every unit has what its Special Qualities build into it, and the conditions its skills say it always has
  for ( const step of [startBattleSkills, startBattleBreak, startBattleStagger, startBattleEvents] ) {
    try {
      await step(combat);
    } catch(err) {
      console.error(err);
    }
  }
  await startBattleShift(combat);
  await awardBattle(combat);

  // A unit whose skill has it make items as a map starts makes them (see `helpers/stealing.mjs`)
  try {
    const { startBattleCrafts } = await import("./stealing.mjs");
    await startBattleCrafts(combat);
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: an Incapacitated unit's timer runs down, a Shift Gauge fills or drains and a stone is
 * ready again, the unit stops Waiting and its skills restore what they restore at the start of a turn, it no
 * longer suffers from Break, its Stagger bar regains a share, then conditions deal their damage and lose a turn,
 * and those of the allies around it that reach it deal theirs.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function startTurnOf(actor) {
  if ( actor?.type !== "unit" ) return;
  // A condition its skills say it always has is back before its conditions deal their damage
  const around = (unit) => aroundTickFor(unit, "start");
  // A Shift that a change let a unit make for a turn ends with it, once its skills have had their moment
  for ( const step of [tickDefeatFor, tickShiftFor, startSkillTurnFor, settleShiftsFor, endBreakFor, startStaggerTurnFor, keepConditions, startTurnFor, around] ) {
    try {
      await step(actor);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */

/**
 * A unit's turn ends: conditions in their last turn end, its skills have their moment, the weather deals what
 * it deals, a unit it subdued and
 * did not pick up waits one turn less, a Staggered unit is one turn nearer to recovering, and partners it
 * stands next to grow closer where the world counts points for that.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function endTurnOf(actor) {
  if ( actor?.type !== "unit" ) return;
  try {
    await aroundTickFor(actor, "end");
    await endTurnFor(actor);
    await endSkillTurnFor(actor);

    // An Affinity that is spent by a move and was not, as for a unit that took no Action, is switched off
    await settleAffinity(actor);

    // A trap the unit ends its turn on is sprung, or taken away by one that disarms traps
    try {
      const { waitOnTraps } = await import("./reactions.mjs");
      await waitOnTraps(actor);
    } catch(err) {
      console.error(err);
    }

    // The weather of the map deals what it deals as a turn ends
    try {
      const { weatherTurnFor } = await import("./weather.mjs");
      await weatherTurnFor(actor);
    } catch(err) {
      console.error(err);
    }
    await tickCaptiveFor(actor);
    await endStaggerTurnFor(actor);

    // A weapon a skill lent it, which it took up and did not attack with, is put down as its turn ends
    if ( actor.isOwner && actor.getFlag(FEO.id, "lent") ) await actor.unsetFlag(FEO.id, "lent");
    // A unit that is off the map, as one an ally carries, stands next to nobody
    for ( const token of actor.system.defeat?.out ? [] : (actor.getActiveTokens?.(false, true) ?? []).slice(0, 1) ) {
      await awardEvent("adjacent", token, { range: 1, mutual: false });
    }
  } catch(err) {
    console.error(err);
  }
}

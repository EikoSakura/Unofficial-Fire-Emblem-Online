import { endBreakFor, startBattleBreak } from "./breaking.mjs";
import { tickCaptiveFor } from "./capturing.mjs";
import { endTurnFor, startTurnFor } from "./conditions.mjs";
import { tickDefeatFor } from "./defeat.mjs";
import { startBattleShift, tickShiftFor } from "./shifting.mjs";
import { endSkillTurnFor, startBattleSkills, startSkillTurnFor } from "./skill-turns.mjs";
import { awardBattle, awardEvent } from "./supports.mjs";

/**
 * Everything that happens when a unit's turn starts or ends, whether the combat tracker or the buttons on
 * the sheet say so.
 */

/**
 * A battle begins, before anybody's turn: partners fielded in it together grow closer, every Laguz starts
 * from its starting Shift Gauge in humanoid form, and nobody suffers from Break. Runs for the user who begins
 * the encounter.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattle(combat) {
  for ( const step of [startBattleSkills, startBattleBreak] ) {
    try {
      await step(combat);
    } catch(err) {
      console.error(err);
    }
  }
  await startBattleShift(combat);
  await awardBattle(combat);
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: an Incapacitated unit's timer runs down, a Shift Gauge fills or drains and a stone is
 * ready again, the unit stops Waiting and its skills restore what they restore at the start of a turn, it no
 * longer suffers from Break, then conditions deal their damage and lose a turn.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function startTurnOf(actor) {
  if ( actor?.type !== "unit" ) return;
  for ( const step of [tickDefeatFor, tickShiftFor, startSkillTurnFor, endBreakFor, startTurnFor] ) {
    try {
      await step(actor);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */

/**
 * A unit's turn ends: conditions in their last turn end, its skills have their moment, a unit it subdued and
 * did not pick up waits one turn less, and partners it stands next to grow closer where the world counts
 * points for that.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function endTurnOf(actor) {
  if ( actor?.type !== "unit" ) return;
  try {
    await endTurnFor(actor);
    await endSkillTurnFor(actor);
    await tickCaptiveFor(actor);
    for ( const token of (actor.getActiveTokens?.(false, true) ?? []).slice(0, 1) ) {
      await awardEvent("adjacent", token, { range: 1, mutual: false });
    }
  } catch(err) {
    console.error(err);
  }
}

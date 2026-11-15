import { FEO } from "../config.mjs";
import { beginPhase, phaseOf, sidesOf } from "../helpers/phases.mjs";
import { endTurnOf, startBattle, startTurnOf } from "../helpers/turns.mjs";

/**
 * An encounter in which the turns of units count down their conditions, and with them everything else that
 * the start of a turn counts: an Incapacitated unit's timer, a Shift Gauge, a stone's transformations.
 *
 * A battle between units is played in Phases: every unit of a side has its turn during its side's Phase, which
 * starts the turns of them all at once, and a unit's turn ends when it takes its Action or when the Phase
 * does (see helpers/phases.mjs). The turn order of the combat tracker counts nothing in such a battle.
 *
 * An encounter that is not played in Phases, because it has no units or was begun before Phases were, counts
 * turns as the tracker steps through them: both handlers run once, for the designated Game Master, each time a
 * combatant's turn starts or ends. Turns that are passed over when the tracker jumps ahead count as well.
 * Stepping the tracker backwards undoes nothing.
 */
export default class FeoCombat extends foundry.documents.Combat {

  /**
   * A battle begins: partners fielded together grow closer and every Laguz starts from its starting gauge,
   * before the first turn starts.
   * @override
   */
  async startCombat() {
    try {
      await startBattle(this);
    } catch(err) {
      console.error(err);
    }

    // The first side with units on the field has the first Phase. It is named before the encounter starts,
    // so that the tracker's own first turn counts nothing
    const first = sidesOf(this)[0] ?? null;
    if ( first ) await this.update({ [`flags.${FEO.id}.phase`]: first });
    const combat = await super.startCombat();
    if ( first ) {
      try {
        await beginPhase(this, first);
      } catch(err) {
        console.error(err);
      }
    }
    return combat;
  }

  /* -------------------------------------------- */

  /** @override */
  async _onStartTurn(combatant, context) {
    await super._onStartTurn(combatant, context);
    if ( phaseOf(this) ) return;
    try {
      await startTurnOf(combatant.actor);
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _onEndTurn(combatant, context) {
    await super._onEndTurn(combatant, context);
    if ( phaseOf(this) ) return;
    try {
      await endTurnOf(combatant.actor);
    } catch(err) {
      console.error(err);
    }
  }
}

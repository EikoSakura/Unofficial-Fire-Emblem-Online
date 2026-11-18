import { FEO } from "../config.mjs";
import { settleGrips } from "./actions.mjs";
import { attackTarget } from "./exchange.mjs";
import { takeSteps } from "./forced.mjs";
import { awardGlory, beforeFight, countKills } from "./optional.mjs";
import { takeAction } from "./phases.mjs";
import { sideRefreshes } from "./refresh.mjs";
import { pop } from "./events.mjs";
import { afterStandIn, standInFor } from "./stances.mjs";
import { awardEvent } from "./supports.mjs";

/**
 * A unit attacks a targeted token, with everything that comes of it beyond the exchange itself: whether the
 * sheet's button or the map started it, the same things follow.
 * @param {Actor} actor                   The initiating unit
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Token} targetToken             The targeted token
 * @param {object} [options]              Passed on to the exchange: see `attackTarget`. And `ask`, which offers on
 *                                        the map a step a skill says its unit "may" take once the fight is
 *                                        over (see `takeSteps`); the Battle HUD does unless something else is
 *                                        given
 * @returns {Promise<ChatMessage|null>}   The message that was posted, or null if no exchange took place
 */
export async function fightTarget(actor, token, targetToken, options = {}) {
  // A unit that stands guard for the target is fought in its place, and one that may step in is offered it
  // (see `helpers/stances.mjs`): the fight is then that unit's, at the distance and on the ground of the
  // unit it stands in for. One attack a skill has its unit make is no fight an enemy starts
  let stood = null;
  if ( !options.extra && !options.stand ) {
    try {
      stood = await standInFor(actor, token, targetToken);
    } catch(err) {
      console.error(err);
    }
    if ( stood?.token.object ) {
      pop(stood.holder.actor, [{ text: stood.skill, tone: "skill" }]);
      targetToken = stood.token.object;
      options = { ...options, stand: stood.stand };
    }
    else stood = null;
  }
  const fighters = beforeFight(actor, targetToken.actor);
  const hpBefore = { initiator: actor.system.hp?.value ?? 0, defender: targetToken.actor?.system.hp?.value ?? 0 };
  // The fight tells what its skills leave the unit to do once it is over
  const told = {};
  const message = await attackTarget(actor, token, targetToken, { ...options, told });
  if ( !message ) return null;

  // A unit that was captured was not killed: no weapon counts it, and it gives no Glory
  if ( targetToken.actor?.system.defeat?.state !== "captured" ) {
    // With the Weapon Kill Critical Bonus, a weapon remembers the foes brought down with it
    await countKills(fighters);

    // With Glory, the unit that brings down a unit with Glory to give gains it
    await awardGlory(fighters);
  }

  // Fighting near a partner brings the two closer, for both units in the fight
  for ( const fighter of [token, targetToken.document] ) {
    if ( fighter ) await awardEvent("fight", fighter, { range: FEO.supports.fightRange });
  }

  // The steps its skills leave the units to take now that it is over: a step forward or back, a foe shoved,
  // two units trading places. They come before the Action is counted, so that a move the Action leaves the
  // unit sets out from where it then stands
  try {
    const ask = options.ask ?? ((offer) => game.feo.hud?.ask?.(offer) ?? null);
    await takeSteps(token, targetToken.document, told.steps ?? [], { ask });
    if ( token?.parent ) await settleGrips(token.parent);
  } catch(err) {
    console.error(err);
  }

  // What the skills of the two take from each other now that it is over, and a unit that was made to put down
  // its weapon and its Shield has (see `helpers/stealing.mjs`)
  if ( told.loot?.length || told.disarmed?.length ) {
    try {
      const { afterFight } = await import("./stealing.mjs");
      await afterFight(told, { initiator: token, defender: targetToken.document });
    } catch(err) {
      console.error(err);
    }
  }

  // What the skills of the two raise from the foe they defeated (see `helpers/creatures.mjs`)
  if ( told.raises?.length ) {
    try {
      const { raiseFor } = await import("./creatures.mjs");
      const tokens = { initiator: token, defender: targetToken.document };
      for ( const side of ["initiator", "defender"] ) {
        const entries = told.raises.filter((entry) => entry.by === side);
        const foe = tokens[(side === "initiator") ? "defender" : "initiator"];
        if ( entries.length && tokens[side]?.actor && foe?.actor ) await raiseFor(tokens[side], foe, entries);
      }
    } catch(err) {
      console.error(err);
    }
  }

  // A unit that fought in the place of another trades places with it, where its skill says so
  if ( stood ) {
    try {
      await afterStandIn(stood);
    } catch(err) {
      console.error(err);
    }
  }

  // A Refresh its skills hand out now that the fight is over: the allies around act again at once, and what
  // it gives the unit itself comes with its Action
  let own = { acts: [], moves: [] };
  try {
    own = await sideRefreshes(token, told.refreshes ?? [], { foe: targetToken.document });
  } catch(err) {
    console.error(err);
  }

  // Attacking is the unit's Action, which ends its turn in a battle, unless a skill has it act or move again
  await takeAction(actor, token, {
    action: { kind: "attack" }, moves: [...(told.moves ?? []), ...own.moves], acts: [...(told.acts ?? []), ...own.acts]
  });

  // An enemy that took HP off a unit in this fight may be struck for it by that unit's allies, where a skill
  // of theirs has it so (see `helpers/reactions.mjs`)
  try {
    const { avenge } = await import("./reactions.mjs");
    const lost = (unit, before) => (unit?.system.hp?.value ?? 0) < before;
    if ( token && lost(targetToken.actor, hpBefore.defender) ) await avenge(targetToken.document, token);
    if ( token && lost(actor, hpBefore.initiator) ) await avenge(token, targetToken.document);
  } catch(err) {
    console.error(err);
  }
  return message;
}

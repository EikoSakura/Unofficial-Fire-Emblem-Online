import { FEO } from "../config.mjs";
import { attackTarget } from "./exchange.mjs";
import { awardGlory, beforeFight, countKills } from "./optional.mjs";
import { takeAction } from "./phases.mjs";
import { awardEvent } from "./supports.mjs";

/**
 * A unit attacks a targeted token, with everything that comes of it beyond the exchange itself: whether the
 * sheet's button or the map started it, the same things follow.
 * @param {Actor} actor                   The initiating unit
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Token} targetToken             The targeted token
 * @param {object} [options]              Passed on to the exchange: see `attackTarget`
 * @returns {Promise<ChatMessage|null>}   The message that was posted, or null if no exchange took place
 */
export async function fightTarget(actor, token, targetToken, options = {}) {
  const fighters = beforeFight(actor, targetToken.actor);
  const message = await attackTarget(actor, token, targetToken, options);
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

  // Attacking is the unit's Action, which ends its turn in a battle
  await takeAction(actor, token);
  return message;
}

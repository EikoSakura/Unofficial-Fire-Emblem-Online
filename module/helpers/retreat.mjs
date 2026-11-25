import { setFate } from "./defeat.mjs";
import { tokenTile } from "./exchange.mjs";
import { battle, fightsIn, turnState } from "./phases.mjs";
import { RETREAT_ZONE, hasZone, tileGround } from "./terrain.mjs";

/**
 * Retreating from the map: a Game Master marks the Retreat zone with the terrain brush, and in a battle a unit
 * that stands on one of its tiles may leave the map from there as its Action. It is then out of the fight as a
 * unit that chose retreat over death is, and comes back the same way (see `setFate` in `defeat.mjs`).
 */

/**
 * What Retreat is to a unit, going by where its token stands.
 * @param {TokenDocument|null} token
 * @returns {{open: boolean}|null}    Null where it is no command of the unit at all: off a battle, or on a map
 *                                    without a Retreat zone. `open` if it stands on a tile of the zone
 */
export function retreatOf(token) {
  const scene = token?.parent;
  const actor = token?.actor;
  if ( (actor?.type !== "unit") || !hasZone(scene, RETREAT_ZONE) || !fightsIn(battle(), actor, token) ) return null;
  const tile = tokenTile(token);
  return { open: !!tile && (tileGround(scene, tile).zone === RETREAT_ZONE) };
}

/* -------------------------------------------- */

/**
 * Have a unit leave the map from the tile of the Retreat zone it stands on, once whoever acts for it has said
 * they are sure. Retreating is its Action, so it is for a unit that is ready to take one.
 * @param {TokenDocument} token
 * @returns {Promise<boolean>}    Whether it retreated
 */
export async function retreatUnit(token) {
  const actor = token?.actor;
  const ready = () => !!retreatOf(token)?.open && (turnState(actor, token) === "ready");
  if ( !actor?.isOwner || !ready() ) {
    ui.notifications.warn("FEO.Retreat.away", { localize: true });
    return false;
  }
  const name = token.name || actor.name;
  const sure = await foundry.applications.api.DialogV2.confirm({
    window: { title: "FEO.Retreat.label" },
    content: `<p>${game.i18n.format("FEO.Retreat.prompt", { name: foundry.utils.escapeHTML?.(name) ?? name })}</p>`,
    rejectClose: false
  });

  // The map may have changed while the question stood
  if ( !sure || !ready() ) return false;
  return setFate(actor, "retreated");
}

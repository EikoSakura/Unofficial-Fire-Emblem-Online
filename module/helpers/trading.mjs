import { FEO } from "../config.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { canTrade, endsMove } from "../rules/trading.mjs";
import { unitsOn } from "./battle-map.mjs";
import { isLocked } from "./creatures.mjs";
import { pop } from "./events.mjs";
import { tokenTile } from "./exchange.mjs";
import { onMap, relationTo } from "./forced.mjs";
import { turnState } from "./phases.mjs";
import { moveNoFurther } from "./rescue.mjs";
import { handOver, packOf } from "./stealing.mjs";

/**
 * Trading in Foundry (see `rules/trading.mjs`): the Trade command of the battle map. A unit hands a weapon or
 * an item to an ally next to it, or takes one from it, as often as it likes and as no Action; its move ends
 * with the first, unless a skill of its lets it move on after trading. What changes hands goes the way
 * anything stolen does (`handOver` in `helpers/stealing.mjs`), so a Game Master does it for a player who may
 * not change both units.
 */

/** The name of the hook called once something was traded: with the unit's token, the ally's, and what. */
export const TRADED_HOOK = `${FEO.id}.unitTraded`;

/* -------------------------------------------- */

/**
 * A unit as the rules of trading read it.
 * @param {TokenDocument} token
 * @returns {{tile: object|null, locked: boolean, items: object[]}}
 */
function traderOf(token) {
  const tile = tokenTile(token);
  return { tile: tile ? { i: tile.i, j: tile.j } : null, locked: isLocked(token.actor), items: packOf(token.actor) };
}

/* -------------------------------------------- */

/**
 * Try a Trade of one unit with another, as they stand: whether they may, and what could change hands.
 * @param {TokenDocument} token       The unit that trades
 * @param {TokenDocument} target      The ally it would trade with
 * @returns {import("../rules/trading.mjs").TradeTry|null}    Null for two units that are not both on one map
 */
export function tradeOf(token, target) {
  if ( !onMap(token) || !target?.actor || (token === target) || (token.parent !== target.parent) || !tokenTile(target) ) return null;
  return canTrade(traderOf(token), {
    ...traderOf(target), relation: relationTo(token, target), out: !!target.actor.system.defeat?.out
  });
}

/* -------------------------------------------- */

/**
 * The units next to a unit, each with what a Trade with it would come to.
 * @param {TokenDocument} token
 * @returns {{target: TokenDocument, tried: import("../rules/trading.mjs").TradeTry}[]}
 */
export function tradesOf(token) {
  if ( !onMap(token) ) return [];
  const here = tokenTile(token);
  const found = [];
  for ( const other of unitsOn(token.parent) ) {
    if ( (other.token === token) || (tilesApart(here, other.tile) !== 1) ) continue;
    const tried = tradeOf(token, other.token);
    if ( tried ) found.push({ target: other.token, tried });
  }
  return found;
}

/* -------------------------------------------- */

/**
 * A free command of the unit's turn was used: its move ends there, unless a skill lets it move on after it.
 * Outside of its own turn, and off a battle, nothing is counted.
 * @param {TokenDocument} token
 * @param {"trade"|"shift"} kind
 * @param {string} by                 What ended its move, by name
 * @returns {Promise<void>}
 */
export async function afterFree(token, kind, by) {
  const actor = token?.actor;
  if ( !actor || (turnState(actor, token) !== "ready") ) return;
  const bends = actor.system.shift?.bends ?? null;
  if ( !endsMove(actor.system.canto ?? null, kind, { atWill: !!bends?.atWill && !bends?.brief }) ) return;
  await moveNoFurther(token, by);
}

/* -------------------------------------------- */

/**
 * A unit Trades with an ally next to it: one weapon or item goes from one pack into the other. It is no
 * Action. Whatever keeps it from trading is said instead.
 * @param {TokenDocument} token       The unit that trades
 * @param {TokenDocument} target      The ally next to it
 * @param {"give"|"take"} way         Does the unit hand the item over, or take it?
 * @param {string} itemId
 * @returns {Promise<boolean>}        Whether it changed hands
 */
export async function tradeUnit(token, target, way, itemId) {
  const tried = tradeOf(token, target);
  const name = target?.name || target?.actor?.name || "";
  if ( !tried?.ok ) {
    ui.notifications.warn(game.i18n.format(`FEO.Trade.blocked.${tried?.why ?? "apart"}`, { name }));
    return false;
  }
  const item = ((way === "give") ? tried.gives : tried.takes).find((entry) => entry.id === itemId);
  if ( !item?.ok ) {
    if ( item ) ui.notifications.warn(game.i18n.localize(`FEO.Trade.keptTip.${item.why}`));
    return false;
  }
  const [from, to] = (way === "give") ? [token, target] : [target, token];
  const moved = await handOver(from.actor, itemId, to.actor);
  if ( !moved ) {
    ui.notifications.warn(game.i18n.format("FEO.Trade.failed", { name }));
    return false;
  }
  pop(to.actor, [{ text: game.i18n.format("FEO.Trade.got", { item: moved }), tone: "gold" }]);
  await afterFree(token, "trade", game.i18n.localize("FEO.Trade.label"));
  Hooks.callAll(TRADED_HOOK, token, target, { item: moved, way });
  return true;
}

import { follows } from "./canto.mjs";
import { tilesApart } from "./reach.mjs";

/**
 * Trading, and what the free commands of a turn leave of its move. Nothing here knows of Foundry.
 *
 * The rulebook (Battle, "Actions"): "Trade items with adjacent allies. Units can trade an unlimited amount of
 * times per turn, and may still take other Actions." It is no Action. Like Shifting, of which the rulebook
 * says that it "is like Trading in that it does not take up your action, but you are unable to move after
 * doing so", it ends the unit's move: what the unit has moved stands and it moves no further this turn, unless
 * a skill of its lets it move on after that very thing, as Canto+ does ("can move the rest of their movement
 * after attacking, using an item, trading or rescuing"). Of Shifting that list says "Shifting forms with Feral
 * Instincts": such a skill lets its unit move on after a Shift only where the Shift is one it makes at will, as
 * Feral Instincts has it Shift whatever its gauge holds.
 *
 * Anything in a pack may be given or taken, also what is in hand or worn (it arrives put away), save what
 * never changes hands. A pack that is locked takes part in no trade.
 */

/** The free commands that end a unit's move: keys of `CANTO_ACTIONS` in `rules/canto.mjs`. */
export const FREE_COMMANDS = ["trade", "shift"];

/* -------------------------------------------- */

/**
 * May this weapon or item be handed to another unit?
 * @param {import("./stealing.mjs").PackItem} item
 * @returns {{ok: boolean, why: "bound"|null}}
 */
export function tradable(item) {
  if ( item?.bound ) return { ok: false, why: "bound" };
  return { ok: true, why: null };
}

/* -------------------------------------------- */

/**
 * @typedef TradeTry
 * @property {boolean} ok           May the two trade?
 * @property {"apart"|"side"|"out"|"locked"|"empty"|"nothing"|null} why      Why not
 * @property {(import("./stealing.mjs").PackItem & {ok: boolean, why: string|null})[]} gives     The unit's pack
 * @property {(import("./stealing.mjs").PackItem & {ok: boolean, why: string|null})[]} takes     The ally's pack
 */

/**
 * May a unit Trade with another, and what could change hands?
 * @param {object} unit
 * @param {{i: number, j: number}|null} [unit.tile]
 * @param {boolean} [unit.locked]                     Is its pack locked?
 * @param {import("./stealing.mjs").PackItem[]} [unit.items]
 * @param {object} other
 * @param {{i: number, j: number}|null} [other.tile]
 * @param {"friend"|"foe"|"apart"} other.relation     How the unit stands to it
 * @param {boolean} [other.out]                       Is it out of the fight?
 * @param {boolean} [other.locked]
 * @param {import("./stealing.mjs").PackItem[]} [other.items]
 * @returns {TradeTry}
 */
export function canTrade(unit, other) {
  const no = (why) => ({ ok: false, why, gives: [], takes: [] });
  if ( other?.out ) return no("out");
  if ( unit?.tile && other?.tile && (tilesApart(unit.tile, other.tile) !== 1) ) return no("apart");
  if ( other?.relation !== "friend" ) return no("side");
  if ( unit?.locked || other?.locked ) return no("locked");
  const gives = (unit?.items ?? []).map((item) => ({ ...item, ...tradable(item) }));
  const takes = (other.items ?? []).map((item) => ({ ...item, ...tradable(item) }));
  if ( !gives.length && !takes.length ) return { ok: false, why: "empty", gives, takes };
  if ( ![...gives, ...takes].some((item) => item.ok) ) return { ok: false, why: "nothing", gives, takes };
  return { ok: true, why: null, gives, takes };
}

/* -------------------------------------------- */

/**
 * The rows of a trade as one list to pick from: what the unit would give, then what it would take, each with
 * an id that says which way it goes.
 * @param {TradeTry} tried
 * @returns {{id: string, way: "give"|"take", item: object}[]}
 */
export function tradeRows(tried) {
  return [
    ...(tried?.gives ?? []).map((item) => ({ id: `give:${item.id}`, way: "give", item })),
    ...(tried?.takes ?? []).map((item) => ({ id: `take:${item.id}`, way: "take", item }))
  ];
}

/* -------------------------------------------- */

/**
 * Read a row's id back.
 * @param {string|null} id
 * @returns {{way: "give"|"take", item: string}|null}
 */
export function readTrade(id) {
  const [way, ...rest] = String(id ?? "").split(":");
  const item = rest.join(":");
  return (["give", "take"].includes(way) && item) ? { way, item } : null;
}

/* -------------------------------------------- */

/**
 * Does a free command end its unit's move? It does, unless a skill of the unit lets it move on after it; after
 * a Shift only where the unit Shifts at will.
 * @param {import("./canto.mjs").Canto|null} canto      What the unit's skills make of moving again
 * @param {string} kind                                  A key of `FREE_COMMANDS`
 * @param {object} [options]
 * @param {boolean} [options.atWill]                     For a Shift: does a skill have the unit Shift whatever
 *                                                       its gauge holds, and not just for a turn?
 * @returns {boolean}
 */
export function endsMove(canto, kind, { atWill = false } = {}) {
  if ( !FREE_COMMANDS.includes(kind) ) return false;
  if ( (kind === "shift") && !atWill ) return true;
  return !(canto?.grants ?? []).some((grant) => follows(grant, { kind }));
}

/**
 * The Mines and Traps of the Items tab, as things that lie on a tile of a map. Pure functions of plain data,
 * so that they can be tested outside of Foundry.
 *
 * An item is one of them where its Effect says that it "Traps 1 adjacent space". What it then does is read
 * from the rest of that Effect, as the tab words it:
 *
 *   "are halted"                       a unit that passes over its space has its move end there
 *   "take 10 damage"                   and takes that damage
 *   "inflicted with Bleed and Bind"    and is given those conditions, for as long as each usually lasts
 *   "given the Silence condition"
 *   "Warps units crossing over ... within a range of 1-8 of the trap"
 *                                      it sets the unit down on a tile picked as it was laid, that far from it
 *   "Lasts until it is activated"      it is gone once it was sprung; "for the rest of the map": it stays
 *
 * A unit lays one on a free tile next to it by using the item, which is its Action; a Game Master sets one
 * down anywhere with the terrain brush, and such a trap belongs to nobody. One lies hidden: only the side of
 * the unit that laid it sees it, and one that belongs to nobody only the Game Master.
 *
 * It is sprung by a unit that walks onto its tile, and by one that ends its turn on it; a unit that flies
 * springs it only by ending its turn there. The unit that laid it never springs it; every other unit does,
 * friend or foe. A unit whose skills have it disarm traps takes it away instead (see `disarmerOf` in
 * `stealing.mjs`), walking over it or waiting on it.
 *
 * A skill changes the mines and traps its unit lays with a `laid` part that is always there:
 *
 *   laid: { mines: 5, turns: 1, exp: 10, kill: 25 }
 *                                      // its Mines deal that much more damage; the conditions its mines and
 *                                      // traps give last that many turns longer; it gains that much EXP as
 *                                      // an enemy springs one, and that much as a Mine of its defeats one
 *
 * A Mine is an item of these whose name says Mine or Bomb; every other is a Trap.
 */
import { FEO } from "../config.mjs";

/** What a `laid` part can say. */
export const LAID_PARTS = ["mines", "turns", "exp", "kill"];

/**
 * @typedef ItemTrap
 * What an item of the Items tab does as a trap, read from its Effect.
 * @property {string} name
 * @property {"mine"|"trap"} kind
 * @property {number} range               How far from its unit it is laid
 * @property {boolean} halts
 * @property {number} damage
 * @property {string[]} inflicts          Keys of FEO.conditions
 * @property {{from: number, within: number}|null} warp     How far from it the tile lies it warps a unit to
 * @property {"sprung"|"map"} lasts
 */

/**
 * @typedef LaidTrap
 * A mine or a trap as it lies on a map.
 * @property {string} id
 * @property {number} i                   The row of its tile
 * @property {number} j                   The column of its tile
 * @property {string} name                The item it was laid with
 * @property {"mine"|"trap"} kind
 * @property {boolean} halts
 * @property {number} damage              With what the skills of the unit that laid it add
 * @property {string[]} inflicts
 * @property {number} more                Turns its conditions last longer
 * @property {{i: number, j: number}|null} warp     The tile it warps a unit to
 * @property {"sprung"|"map"} lasts
 * @property {string} by                  The unit that laid it, by its Actor; blank for one nobody laid
 * @property {string} token               That unit's token, where it has one on the map
 * @property {string} side                The side of the unit that laid it; blank for one nobody laid
 * @property {number} exp                 The EXP that unit gains as an enemy springs it
 * @property {number} kill                And as its damage defeats one
 */

/* -------------------------------------------- */
/*  Reading an Item                             */
/* -------------------------------------------- */

/**
 * Is an item a Mine, by its name? Every other item that traps a space is a Trap.
 * @param {string} name
 * @returns {boolean}
 */
export function isMine(name) {
  return /\b(mine|bomb)\b/i.test(String(name ?? ""));
}

/* -------------------------------------------- */

/**
 * What an item does as a trap, read from its Effect as the Items tab words it.
 * @param {{name?: string, effect?: string}|null} item
 * @returns {ItemTrap|null}     Null for an item that traps no space
 */
export function trapOfItem(item) {
  const text = String(item?.effect ?? "").replace(/\s+/g, " ").trim();
  const laid = /^Traps (\d+) adjacent space/i.exec(text);
  if ( !laid ) return null;
  const damage = /takes? (\d+) damage/i.exec(text);
  const reach = /within a range of\s*(\d+)\s*-\s*(\d+)/i.exec(text);

  // The conditions it names: every condition the system knows whose key stands in what it inflicts or gives
  const told = /(?:inflicted with|given the)\s+([^.]*)/i.exec(text)?.[1] ?? "";
  const inflicts = Object.keys(FEO.conditions).filter((id) => {
    if ( FEO.conditions[id].combatOnly ) return false;
    return new RegExp(`(^|[^a-z])${id}([^a-z]|$)`, "i").test(told);
  });
  const name = String(item?.name ?? "").trim();
  return {
    name,
    kind: isMine(name) ? "mine" : "trap",
    range: Math.max(Number(laid[1]) || 1, 1),
    halts: /\bhalted\b/i.test(text),
    damage: damage ? Number(damage[1]) : 0,
    inflicts,
    warp: /\bWarps units\b/i.test(text) ? { from: reach ? Number(reach[1]) : 1, within: reach ? Number(reach[2]) : 8 } : null,
    lasts: /rest of the map/i.test(text) ? "map" : "sprung"
  };
}

/* -------------------------------------------- */
/*  What a Skill Adds                           */
/* -------------------------------------------- */

/**
 * What nothing adds to the mines and traps a unit lays.
 * @returns {{mines: number, turns: number, exp: number, kill: number, skill: string}}
 */
export function emptyLaid() {
  return { mines: 0, turns: 0, exp: 0, kill: 0, skill: "" };
}

/* -------------------------------------------- */

/**
 * Add what one `laid` part gives to what a unit's skills add to the mines and traps it lays.
 * @param {ReturnType<typeof emptyLaid>} total
 * @param {object} [part]
 * @param {object} [options]
 * @param {string} [options.skill]
 * @param {(value: any) => number} [options.number]
 * @returns {ReturnType<typeof emptyLaid>}    `total`, changed
 */
export function addLaid(total, part, { skill = "", number = (value) => Number(value) || 0 } = {}) {
  if ( !part || (typeof part !== "object") ) return total;
  for ( const key of LAID_PARTS ) total[key] += Math.max(Math.trunc(number(part[key] ?? 0)), 0);
  total.skill ||= skill;
  return total;
}

/* -------------------------------------------- */

/**
 * Check a `laid` part, so that a typing mistake does not pass silently.
 * @param {*} part
 * @returns {string[]}
 */
export function checkLaid(part) {
  if ( !part || (typeof part !== "object") || Array.isArray(part) || !Object.keys(part).length ) {
    return ["laid says what the mines and traps of its unit have more: { mines, turns, exp, kill }"];
  }
  const problems = [];
  for ( const [key, value] of Object.entries(part) ) {
    if ( !LAID_PARTS.includes(key) ) problems.push(`laid cannot say "${key}"`);
    else if ( !Number.isInteger(value) || (value < 1) ) problems.push(`laid: "${key}" is a whole number from 1`);
  }
  return problems;
}

/* -------------------------------------------- */
/*  Laying One                                  */
/* -------------------------------------------- */

/**
 * A trap as it lies on a map, with whatever was left out filled in.
 * @param {object} raw
 * @returns {LaidTrap|null}     Null for what is no trap on a tile
 */
export function normalizeTrap(raw) {
  if ( !raw || !Number.isInteger(raw.i) || !Number.isInteger(raw.j) ) return null;
  const whole = (value) => Math.max(Math.trunc(Number(value) || 0), 0);
  const name = String(raw.name ?? "").trim();
  const warp = (Number.isInteger(raw.warp?.i) && Number.isInteger(raw.warp?.j)) ? { i: raw.warp.i, j: raw.warp.j } : null;
  return {
    id: String(raw.id ?? `trap-${raw.i}-${raw.j}`),
    i: raw.i,
    j: raw.j,
    name,
    kind: (raw.kind === "mine") || ((raw.kind !== "trap") && isMine(name)) ? "mine" : "trap",
    halts: raw.halts !== false,
    damage: whole(raw.damage),
    inflicts: (Array.isArray(raw.inflicts) ? raw.inflicts : []).filter((id) => (typeof id === "string") && (id in FEO.conditions)),
    more: whole(raw.more),
    warp,
    lasts: (raw.lasts === "map") ? "map" : "sprung",
    by: String(raw.by ?? ""),
    token: String(raw.token ?? ""),
    side: String(raw.side ?? ""),
    exp: whole(raw.exp),
    kill: whole(raw.kill)
  };
}

/* -------------------------------------------- */

/**
 * Make the trap an item lays on a tile.
 * @param {ItemTrap} item
 * @param {{i: number, j: number}} tile
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {{i: number, j: number}|null} [options.warp]    The tile it warps a unit to
 * @param {{actor?: string, token?: string, side?: string}|null} [options.by]   The unit that lays it; none for
 *                                                        one the Game Master sets down
 * @param {ReturnType<typeof emptyLaid>|null} [options.laid]    What that unit's skills add
 * @returns {LaidTrap}
 */
export function makeTrap(item, tile, { id = "", warp = null, by = null, laid = null } = {}) {
  const adds = laid ?? emptyLaid();

  // A Mine deals more only where it deals any: one that only gives a condition has no damage to add to
  const more = ((item.kind === "mine") && (item.damage > 0)) ? adds.mines : 0;
  return normalizeTrap({
    id: id || `trap-${tile.i}-${tile.j}`,
    i: tile.i,
    j: tile.j,
    name: item.name,
    kind: item.kind,
    halts: item.halts,
    damage: item.damage + more,
    inflicts: item.inflicts,
    more: item.inflicts.length ? adds.turns : 0,
    warp: item.warp ? warp : null,
    lasts: item.lasts,
    by: by?.actor ?? "",
    token: by?.token ?? "",
    side: by?.side ?? "",
    exp: by ? adds.exp : 0,
    kill: (by && (item.kind === "mine")) ? adds.kill : 0
  });
}

/* -------------------------------------------- */

/**
 * The tiles an item may be laid on, as far from its unit as it says: along rows and columns, so that "1
 * adjacent space" is one of the four tiles next to it.
 * @param {{i: number, j: number}} from
 * @param {number} [range]
 * @returns {{i: number, j: number}[]}
 */
export function layTiles(from, range = 1) {
  const tiles = [];
  for ( let di = -range; di <= range; di++ ) {
    for ( let dj = -range; dj <= range; dj++ ) {
      if ( (Math.abs(di) + Math.abs(dj)) === range ) tiles.push({ i: from.i + di, j: from.j + dj });
    }
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * Is a tile one a trap that warps may send a unit to: no nearer to the trap and no further from it than its
 * item says, along rows and columns?
 * @param {{i: number, j: number}} trap     The tile the trap lies on
 * @param {{i: number, j: number}} tile
 * @param {{from: number, within: number}} warp
 * @returns {boolean}
 */
export function warpReaches(trap, tile, warp) {
  const apart = Math.abs(trap.i - tile.i) + Math.abs(trap.j - tile.j);
  return (apart >= (warp?.from ?? 1)) && (apart <= (warp?.within ?? 8));
}

/* -------------------------------------------- */
/*  Seeing and Springing One                    */
/* -------------------------------------------- */

/**
 * Does a user see a trap on the map? A Game Master sees every one. Anyone else sees those the units of the
 * players' side laid, and those of a unit they own: one that belongs to nobody, or to another side, lies hidden.
 * @param {LaidTrap} trap
 * @param {{gm?: boolean, owns?: boolean}} [viewer]     `owns`: does the user own the unit that laid it?
 * @param {Record<string, string|null>} [camps]
 * @returns {boolean}
 */
export function seesTrap(trap, { gm = false, owns = false } = {}, camps = FEO.camps) {
  if ( gm || owns ) return true;
  return !!trap?.side && !!camps[trap.side] && (camps[trap.side] === camps.player);
}

/* -------------------------------------------- */

/**
 * Does a unit spring a trap? Never the unit that laid it. Every other does by ending its turn on its tile,
 * and by walking onto it unless it flies.
 * @param {LaidTrap} trap
 * @param {{actor?: string, flies?: boolean}} unit
 * @param {"walk"|"wait"} [how]
 * @returns {boolean}
 */
export function springs(trap, unit, how = "walk") {
  if ( !trap || (trap.by && (trap.by === unit?.actor)) ) return false;
  return (how === "wait") || !unit?.flies;
}

/* -------------------------------------------- */

/**
 * What a trap does to the unit that springs it.
 * @param {LaidTrap} trap
 * @param {object} [unit]
 * @param {boolean} [unit.enemy]      Is it an enemy of the unit that laid the trap?
 * @returns {{damage: number, inflicts: {id: string, turns: number}[], halts: boolean, warp: {i: number, j: number}|null,
 *   gone: boolean, exp: number, kill: number}}
 *          The damage it deals, the conditions it gives with the turns each lasts, whether the unit's move
 *          ends there, where it is set down, whether the trap is then gone, and the EXP the unit that laid it
 *          gains for it: at once, and more if the damage defeats the unit
 */
export function sprung(trap, { enemy = false } = {}) {
  return {
    damage: trap.damage,
    inflicts: trap.inflicts.map((id) => ({ id, turns: Math.max(FEO.conditions[id]?.turns ?? 1, 1) + trap.more })),
    halts: trap.halts || !!trap.warp,
    warp: trap.warp,
    gone: trap.lasts !== "map",
    exp: enemy ? trap.exp : 0,
    kill: (enemy && (trap.damage > 0)) ? trap.kill : 0
  };
}

/* -------------------------------------------- */

/**
 * The traps of a list that lie on a tile.
 * @param {LaidTrap[]} traps
 * @param {{i: number, j: number}} tile
 * @returns {LaidTrap[]}
 */
export function trapsAt(traps, tile) {
  return (traps ?? []).filter((trap) => (trap.i === tile?.i) && (trap.j === tile?.j));
}

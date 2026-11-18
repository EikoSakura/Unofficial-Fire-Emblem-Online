/**
 * Where a unit can go and what it can strike from there, worked out on a square grid. Units move along rows
 * and columns; they pass through their allies but not their enemies, and cannot stop on a tile another unit
 * stands on. Skills bend each of these (see `passing.mjs`): a unit may move through enemies, at a price or for
 * so many a turn, share a tile, take some of its steps diagonally, or be stopped beside an enemy. These
 * functions know nothing of Foundry: the map is handed in as functions.
 *
 * Tiles are named by row and column as the grid counts them, `i` down and `j` across.
 *
 * @typedef Tile
 * @property {number} i     Row
 * @property {number} j     Column
 *
 * @typedef Field
 * @property {(tile: Tile) => boolean} inside       Is the tile on the map?
 * @property {(tile: Tile) => number} cost          Movement it takes to enter the tile; Infinity if it cannot be
 * @property {(tile: Tile) => boolean} [blocked]    Does something stand there that no unit passes?
 * @property {(tile: Tile) => boolean} [foe]        Does an enemy stand there, whom the unit passes only by a skill?
 * @property {(tile: Tile) => boolean} [taken]      Does someone stand there, so that the unit cannot stop?
 * @property {(tile: Tile) => boolean} [halts]      Does the unit's movement end as it enters the tile?
 * @property {import("./passing.mjs").Passing|null} [pass]    What the unit's skills make of passing
 * @property {number} [passed]                      The enemies it has moved through already this turn
 *
 * @typedef Reach
 * @property {Tile} origin                  Where the unit set out from
 * @property {Map<string, number>} cost     Movement spent to reach each tile it can enter
 * @property {Map<string, string>} prev     The tile each of them is entered from, on the cheapest way there
 * @property {Map<string, string[]>} ways   That way, tile by tile, for each of them
 * @property {Set<string>} stops            The tiles it can end its movement on
 * @property {boolean} plain                Is it the reach of a unit that nothing lets pass or stops on its way?
 */
import { passCap, passExtra, threads } from "./passing.mjs";

/** The four ways a unit can step, and the four more a skill may let it. */
const STEPS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * The name of a tile, for sets and maps of tiles.
 * @param {Tile} tile
 * @returns {string}
 */
export const tileKey = (tile) => `${tile.i},${tile.j}`;

/**
 * The tile a name stands for.
 * @param {string} key
 * @returns {Tile}
 */
export function keyTile(key) {
  const [i, j] = key.split(",").map(Number);
  return { i, j };
}

/* -------------------------------------------- */

/**
 * Tiles between two tiles, counted along rows and columns.
 * @param {Tile} a
 * @param {Tile} b
 * @returns {number}
 */
export function tilesApart(a, b) {
  return Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
}

/* -------------------------------------------- */

/**
 * Every tile a unit can reach with its movement, and the cheapest way to each.
 *
 * A unit that may move through enemies enters an enemy's tile for what the tile takes and what its leave to
 * pass adds, for as many enemies as that leave allows. Where a tile may be shared, a unit that cannot move
 * through the enemy on it still enters it, and ends its movement there. A diagonal step is one space, and is
 * not taken between two tiles the unit could not enter. Movement ends on a tile that halts it.
 * @param {Tile} origin         Where the unit starts its turn
 * @param {number} movement     Its MOV
 * @param {Field} field
 * @returns {Reach}
 */
export function reachFrom(origin, movement, field) {
  const budget = Math.max(Number(movement) || 0, 0);
  const pass = field.pass ?? null;
  const cap = passCap(pass);
  const diagonals = Math.max(pass?.diagonal ?? 0, 0);
  const free = Math.max(pass?.free ?? 0, 0);

  // Where the unit is on a way: the tile, the enemies moved through, the diagonal steps taken, and whether
  // its movement has ended there
  const name = (tile, passed, slanted, halted) => `${tile.i},${tile.j}|${passed}|${slanted}|${halted ? 1 : 0}`;
  const first = { tile: { i: origin.i, j: origin.j }, passed: Math.min(Math.max(field.passed ?? 0, 0), cap), slanted: 0, halted: false, spent: 0 };
  first.key = name(first.tile, first.passed, 0, false);
  const spent = new Map([[first.key, 0]]);
  const from = new Map();
  const open = [first];
  const best = new Map([[tileKey(origin), first]]);

  // Is one way to a tile better than another? The cheaper one, then the one through fewer enemies, then the
  // one with fewer diagonal steps
  const better = (a, b) => !b || (a.spent < b.spent)
    || ((a.spent === b.spent) && ((a.passed < b.passed) || ((a.passed === b.passed) && (a.slanted < b.slanted))));

  while ( open.length ) {
    // The nearest place not yet looked at. Maps are small enough that a search through the list is plenty
    let nearest = 0;
    for ( let index = 1; index < open.length; index++ ) if ( open[index].spent < open[nearest].spent ) nearest = index;
    const [here] = open.splice(nearest, 1);
    if ( (here.spent > spent.get(here.key)) || here.halted ) continue;
    const steps = (here.slanted < diagonals) ? [...STEPS, ...DIAGONALS] : STEPS;
    for ( const [di, dj] of steps ) {
      const next = { i: here.tile.i + di, j: here.tile.j + dj };
      if ( !field.inside(next) || field.blocked?.(next) ) continue;
      const slant = (di !== 0) && (dj !== 0);
      if ( slant ) {
        // Not through the gap between two tiles the unit could not enter
        const open1 = { i: here.tile.i + di, j: here.tile.j };
        const open2 = { i: here.tile.i, j: here.tile.j + dj };
        const shut = (tile) => !field.inside(tile) || !!field.blocked?.(tile) || !Number.isFinite(field.cost(tile));
        if ( shut(open1) && shut(open2) ) continue;
      }
      let price = field.cost(next);
      if ( !Number.isFinite(price) ) continue;
      let passed = here.passed;
      let halted = !!field.halts?.(next);
      if ( field.foe?.(next) ) {
        const extra = passExtra(pass, here.passed);
        if ( Number.isFinite(extra) ) {
          if ( here.passed < free ) price = Math.max(price - 1, 0);
          price += extra;
          passed = Math.min(here.passed + 1, cap);
        }

        // An enemy it cannot move through, on a tile it may share: it goes there and no further
        else if ( !field.taken?.(next) ) halted = true;
        else continue;
      }
      const total = here.spent + price;
      const slanted = here.slanted + (slant ? 1 : 0);
      const key = name(next, passed, slanted, halted);
      if ( !(total <= budget) || (total >= (spent.get(key) ?? Infinity)) ) continue;
      const place = { tile: next, passed, slanted, halted, spent: total, key };
      spent.set(key, total);
      from.set(key, here.key);
      open.push(place);
      const tile = tileKey(next);
      if ( better(place, best.get(tile)) ) best.set(tile, place);
    }
  }

  // The cheapest way to each tile, and the tiles the unit can stop on
  const start = tileKey(origin);
  const cost = new Map();
  const prev = new Map();
  const ways = new Map();
  const stops = new Set();
  for ( const [tile, place] of best ) {
    cost.set(tile, place.spent);
    const way = [];
    for ( let key = place.key; from.has(key); key = from.get(key) ) way.unshift(key.slice(0, key.indexOf("|")));
    ways.set(tile, way);
    if ( way.length ) prev.set(tile, (way.length > 1) ? way.at(-2) : start);
    if ( (tile === start) || !field.taken?.(keyTile(tile)) ) stops.add(tile);
  }
  const plain = !threads(pass) && !field.halts;
  return { origin: { i: origin.i, j: origin.j }, cost, prev, ways, stops, plain };
}

/* -------------------------------------------- */

/**
 * Keep, of the tiles a unit only reaches with movement it has on top of its own, those that let it attack an
 * enemy it could not attack from anywhere its own movement takes it: the others are taken out of its reach.
 * @param {Reach} reach               Its reach with that movement counted in, which is changed
 * @param {number} own                The movement it has without it
 * @param {{id: string, tile: Tile}[]} foes       The enemies it might attack
 * @param {(from: Tile, foe: {id: string, tile: Tile}) => boolean} strikes    Could it attack that enemy from
 *                                    that tile?
 * @param {string|null} [keep]        A tile that stays in its reach whatever it opens: the one it stands on
 * @returns {Map<string, string[]>}   The tiles that stay, by name, each with the enemies it opens
 */
export function pruneLunge(reach, own, foes, strikes, keep = null) {
  const costOf = (key) => reach.cost.get(key) ?? 0;
  const near = [...reach.stops].filter((key) => costOf(key) <= own);
  const within = new Set();
  for ( const foe of foes ?? [] ) if ( near.some((key) => strikes(keyTile(key), foe)) ) within.add(foe.id);
  const opened = new Map();
  for ( const key of [...reach.cost.keys()].filter((tile) => costOf(tile) > own) ) {
    const fresh = reach.stops.has(key)
      ? (foes ?? []).filter((foe) => !within.has(foe.id) && (tileKey(foe.tile) !== key) && strikes(keyTile(key), foe)).map((foe) => foe.id)
      : [];
    if ( fresh.length ) {
      opened.set(key, fresh);
      continue;
    }
    if ( key === keep ) continue;
    for ( const part of [reach.cost, reach.prev, reach.ways, reach.stops] ) part.delete(key);
  }
  return opened;
}

/* -------------------------------------------- */

/**
 * The tiles a unit walks through to reach one of the tiles in its reach, from the first step to the last.
 * @param {Reach} reach
 * @param {Tile} tile
 * @returns {Tile[]}    Empty for a tile out of reach, and for the tile the unit starts on
 */
export function pathTo(reach, tile) {
  let key = tileKey(tile);
  if ( !reach.cost.has(key) ) return [];
  if ( reach.ways ) return (reach.ways.get(key) ?? []).map(keyTile);
  const path = [];
  while ( reach.prev.has(key) ) {
    path.unshift(keyTile(key));
    key = reach.prev.get(key);
  }
  return path;
}

/* -------------------------------------------- */

/**
 * The tiles a unit walks through from one tile of its reach to another, from the first step to the last. From
 * where it set out that is the cheapest way there. From anywhere else, as when it has moved and is moved
 * again, it is the way of the fewest steps over tiles it can enter; a unit that something lets pass or stops
 * on its way goes back along the way it came to where the two ways part, and on from there, so that it never
 * takes a step its reach did not find.
 * @param {Reach} reach
 * @param {Tile} from
 * @param {Tile} to
 * @returns {Tile[]}    Empty if either tile is out of reach, and if they are the same tile
 */
export function wayBetween(reach, from, to) {
  const start = tileKey(from);
  const goal = tileKey(to);
  if ( start === tileKey(reach.origin) ) return pathTo(reach, to);
  if ( (start === goal) || !reach.cost.has(start) || !reach.cost.has(goal) ) return [];
  if ( reach.plain === false ) {
    const came = pathTo(reach, from).map(tileKey);
    const goes = pathTo(reach, to).map(tileKey);
    let shared = 0;
    while ( (shared < came.length) && (shared < goes.length) && (came[shared] === goes[shared]) ) shared++;

    // Back to the last tile both ways have in common, or to where the unit set out, then on
    const back = came.slice(shared, -1).reverse();
    back.push(shared ? came[shared - 1] : tileKey(reach.origin));
    return [...back, ...goes.slice(shared)].filter((key, index, list) => key !== (index ? list[index - 1] : start)).map(keyTile);
  }
  const prev = new Map();
  const seen = new Set([start]);
  const queue = [start];
  while ( queue.length && !seen.has(goal) ) {
    const key = queue.shift();
    const { i, j } = keyTile(key);
    for ( const [di, dj] of STEPS ) {
      const next = tileKey({ i: i + di, j: j + dj });
      if ( seen.has(next) || !reach.cost.has(next) ) continue;
      seen.add(next);
      prev.set(next, key);
      queue.push(next);
    }
  }
  const path = [];
  if ( !seen.has(goal) ) return path;
  for ( let key = goal; key !== start; key = prev.get(key) ) path.unshift(keyTile(key));
  return path;
}

/* -------------------------------------------- */

/**
 * The tiles a weapon reaches from any of a set of tiles.
 * @param {Iterable<string>} from               The tiles the unit may strike from, by name
 * @param {{min: number, max: number}} range    How far the weapon reaches
 * @param {object} field
 * @param {(tile: Tile) => boolean} field.inside                    Is the tile on the map?
 * @param {(from: Tile, to: Tile, distance: number) => boolean} [field.allows]
 *                                              May the unit strike that tile from there? Height can rule it out
 * @returns {Set<string>}
 */
export function strikeTiles(from, range, field) {
  const tiles = new Set();
  const { min, max } = range;
  if ( !(max >= 1) ) return tiles;
  for ( const key of from ) {
    const stand = keyTile(key);
    for ( let di = -max; di <= max; di++ ) {
      const across = max - Math.abs(di);
      for ( let dj = -across; dj <= across; dj++ ) {
        const distance = Math.abs(di) + Math.abs(dj);
        if ( (distance < Math.max(min, 1)) || (distance > max) ) continue;
        const tile = { i: stand.i + di, j: stand.j + dj };
        if ( !field.inside(tile) ) continue;
        if ( field.allows && !field.allows(stand, tile, distance) ) continue;
        tiles.add(tileKey(tile));
      }
    }
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * Does a weapon reach a target from a tile? Two units that share a tile are one tile apart.
 * @param {Tile} tile                           Where the unit would stand
 * @param {Tile} target                         Where its target stands
 * @param {{min: number, max: number}} range    How far the weapon reaches
 * @param {((from: Tile, to: Tile, distance: number) => boolean)|null} [allows]
 * @returns {boolean}
 */
export function strikesFrom(tile, target, range, allows = null) {
  const distance = Math.max(tilesApart(tile, target), 1);
  if ( (distance < Math.max(range.min, 1)) || (distance > range.max) ) return false;
  return !allows || allows(tile, target, distance);
}

/* -------------------------------------------- */

/**
 * The tile a unit would strike a target from: where it stands if the weapon reaches from there, else the
 * tile that takes the least movement, and among those the one the unit is best placed on. The target's own
 * tile is never picked this way, even where the unit could share it.
 * @param {Reach} reach
 * @param {Tile} standing                       Where the unit stands now
 * @param {Tile} target                         Where its target stands
 * @param {{min: number, max: number}} range    How far the weapon reaches
 * @param {object} [options]
 * @param {(from: Tile, to: Tile, distance: number) => boolean} [options.allows]
 * @param {(tile: Tile) => number} [options.prefer]   The higher, the better placed the unit is on a tile
 * @param {boolean} [options.stay]              Must the unit strike from where it stands?
 * @param {{min: number, max: number}|null} [options.walking]   How far the weapon reaches from a tile the unit
 *                                              has to walk to, where that differs
 * @returns {{tile: Tile, cost: number}|null}   Null if the target is out of reach this turn
 */
export function strikeFrom(reach, standing, target, range, { allows = null, prefer = null, stay = false, walking = null } = {}) {
  const fits = (tile, span = range) => strikesFrom(tile, target, span, allows);
  const here = tileKey(standing);
  if ( fits(standing) ) return { tile: { i: standing.i, j: standing.j }, cost: reach.cost.get(here) ?? 0 };
  if ( stay ) return null;

  let best = null;
  for ( const key of reach.stops ) {
    const tile = keyTile(key);
    if ( (key === here) || (key === tileKey(target)) || !fits(tile, walking ?? range) ) continue;
    const candidate = { tile, cost: reach.cost.get(key), liking: prefer ? prefer(tile) : 0 };
    const better = !best || (candidate.cost < best.cost)
      || ((candidate.cost === best.cost) && (candidate.liking > best.liking));
    if ( better ) best = candidate;
  }
  return best ? { tile: best.tile, cost: best.cost } : null;
}

/* -------------------------------------------- */

/**
 * The outline of a set of tiles: every side of a tile that has no tile of the set beyond it.
 * @param {Set<string>} tiles
 * @returns {{i: number, j: number, side: "top"|"bottom"|"left"|"right"}[]}
 */
export function outline(tiles) {
  const edges = [];
  for ( const key of tiles ) {
    const { i, j } = keyTile(key);
    if ( !tiles.has(tileKey({ i: i - 1, j })) ) edges.push({ i, j, side: "top" });
    if ( !tiles.has(tileKey({ i: i + 1, j })) ) edges.push({ i, j, side: "bottom" });
    if ( !tiles.has(tileKey({ i, j: j - 1 })) ) edges.push({ i, j, side: "left" });
    if ( !tiles.has(tileKey({ i, j: j + 1 })) ) edges.push({ i, j, side: "right" });
  }
  return edges;
}

/* -------------------------------------------- */

/**
 * How two sides stand to each other.
 * @param {string} a                    A side
 * @param {string} b                    Another
 * @param {string[][]} alliances        The sides that fight together, group by group
 * @returns {"friend"|"foe"|"apart"}    `apart` when either belongs to no group
 */
export function relation(a, b, alliances) {
  const group = (side) => alliances.findIndex((sides) => sides.includes(side));
  const mine = group(a);
  const theirs = group(b);
  if ( (mine < 0) || (theirs < 0) ) return (a === b) ? "friend" : "apart";
  return mine === theirs ? "friend" : "foe";
}

/**
 * Where a unit can go and what it can strike from there, worked out on a square grid. Units move along rows
 * and columns, never diagonally; they pass through their allies but not their enemies, and cannot stop on a
 * tile another unit stands on. These functions know nothing of Foundry: the map is handed in as functions.
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
 * @property {(tile: Tile) => boolean} [blocked]    Does someone stand there that the unit cannot pass?
 * @property {(tile: Tile) => boolean} [taken]      Does someone stand there, so that the unit cannot stop?
 *
 * @typedef Reach
 * @property {Tile} origin                  Where the unit set out from
 * @property {Map<string, number>} cost     Movement spent to reach each tile it can enter
 * @property {Map<string, string>} prev     The tile each of them is entered from
 * @property {Set<string>} stops            The tiles it can end its movement on
 */

/** The four ways a unit can step. */
const STEPS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

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
 * @param {Tile} origin         Where the unit starts its turn
 * @param {number} movement     Its MOV
 * @param {Field} field
 * @returns {Reach}
 */
export function reachFrom(origin, movement, field) {
  const start = tileKey(origin);
  const cost = new Map([[start, 0]]);
  const prev = new Map();
  const open = [{ tile: { i: origin.i, j: origin.j }, spent: 0 }];
  const budget = Math.max(Number(movement) || 0, 0);

  while ( open.length ) {
    // The nearest tile not yet looked at. Maps are small enough that a sorted list is plenty
    open.sort((a, b) => a.spent - b.spent);
    const { tile, spent } = open.shift();
    if ( spent > cost.get(tileKey(tile)) ) continue;
    for ( const [di, dj] of STEPS ) {
      const next = { i: tile.i + di, j: tile.j + dj };
      if ( !field.inside(next) || field.blocked?.(next) ) continue;
      const total = spent + field.cost(next);
      const key = tileKey(next);
      if ( !(total <= budget) || (total >= (cost.get(key) ?? Infinity)) ) continue;
      cost.set(key, total);
      prev.set(key, tileKey(tile));
      open.push({ tile: next, spent: total });
    }
  }

  const stops = new Set();
  for ( const key of cost.keys() ) {
    if ( (key === start) || !field.taken?.(keyTile(key)) ) stops.add(key);
  }
  return { origin: { i: origin.i, j: origin.j }, cost, prev, stops };
}

/* -------------------------------------------- */

/**
 * The tiles a unit walks through to reach one of the tiles in its reach, from the first step to the last.
 * @param {Reach} reach
 * @param {Tile} tile
 * @returns {Tile[]}    Empty for a tile out of reach, and for the tile the unit starts on
 */
export function pathTo(reach, tile) {
  const path = [];
  let key = tileKey(tile);
  if ( !reach.cost.has(key) ) return path;
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
 * again, it is the way of the fewest steps over tiles it can enter.
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
 * The tile a unit would strike a target from: where it stands if the weapon reaches from there, else the
 * tile that takes the least movement, and among those the one the unit is best placed on.
 * @param {Reach} reach
 * @param {Tile} standing                       Where the unit stands now
 * @param {Tile} target                         Where its target stands
 * @param {{min: number, max: number}} range    How far the weapon reaches
 * @param {object} [options]
 * @param {(from: Tile, to: Tile, distance: number) => boolean} [options.allows]
 * @param {(tile: Tile) => number} [options.prefer]   The higher, the better placed the unit is on a tile
 * @param {boolean} [options.stay]              Must the unit strike from where it stands?
 * @returns {{tile: Tile, cost: number}|null}   Null if the target is out of reach this turn
 */
export function strikeFrom(reach, standing, target, range, { allows = null, prefer = null, stay = false } = {}) {
  const fits = (tile) => {
    const distance = tilesApart(tile, target);
    if ( (distance < Math.max(range.min, 1)) || (distance > range.max) ) return false;
    return !allows || allows(tile, target, distance);
  };
  const here = tileKey(standing);
  if ( fits(standing) ) return { tile: { i: standing.i, j: standing.j }, cost: reach.cost.get(here) ?? 0 };
  if ( stay ) return null;

  let best = null;
  for ( const key of reach.stops ) {
    const tile = keyTile(key);
    if ( !fits(tile) ) continue;
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

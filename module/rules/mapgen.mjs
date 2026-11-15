import { FEO } from "../config.mjs";
import { tileKey } from "./reach.mjs";

/**
 * The map generator: the ground of a battle map made up from a kind of battlefield, a size and a seed. The
 * same three always give the same map, so a map that was liked can be had again from its seed.
 *
 * A map is laid out for a battle that runs from its left edge to its right: whatever else is made, a unit on
 * foot with no skill for it can always walk from the middle of one edge to the middle of the other, or to the
 * throne of a fortress.
 *
 * Everything here works on rows and columns alone and touches nothing of Foundry. Making a scene of a map is
 * the work of `helpers/mapgen.mjs`.
 *
 * @import {Paint} from "./paint.mjs"
 * @import {Tile} from "./reach.mjs"
 */

/**
 * @typedef BattleMap
 * @property {string} type            A key of MAP_TYPES
 * @property {string} seed            What the map was made from
 * @property {number} rows
 * @property {number} columns
 * @property {string[][]} tiles       The kind of terrain of each tile, a key of FEO.terrain.types, row by row
 * @property {number[][]} heights     How high each tile lies
 * @property {{from: Tile, to: Tile}} ends    Where the battle is joined from, and where it leads
 */

/**
 * @typedef Draft
 * A map as it is being made.
 * @property {number} rows
 * @property {number} columns
 * @property {() => number} random    The next number of the seed, from 0 up to 1
 * @property {string[][]} tiles
 * @property {number[][]} heights
 * @property {Tile} [goal]            Where the battle leads, if not to the middle of the right edge
 */

/** The kinds of battlefield the generator knows, each with the function that lays it out. */
export const MAP_TYPES = {
  plains: layPlains,
  woodland: layWoodland,
  highlands: layHighlands,
  river: layRiver,
  coast: layCoast,
  fortress: layFortress,
  town: layTown,
  desert: layDesert
};

/** The sizes offered, in tiles. */
export const MAP_SIZES = {
  small: { columns: 16, rows: 12 },
  medium: { columns: 24, rows: 16 },
  large: { columns: 32, rows: 20 },
  vast: { columns: 40, rows: 26 }
};

/** The fewest and the most tiles a map may have along a side. */
export const MAP_LIMITS = { min: 10, max: 60 };

/** The letters and digits a seed is made of: none that is easily taken for another. */
const SEED_SIGNS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The four ways from a tile to its neighbours. */
const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/* -------------------------------------------- */
/*  Chance                                      */
/* -------------------------------------------- */

/**
 * A run of numbers from 0 up to 1 that is always the same for the same seed.
 * @param {string} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let state = 2166136261;
  for ( const sign of String(seed) ) state = Math.imul(state ^ sign.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------- */

/**
 * A seed nobody has asked for yet.
 * @param {() => number} [random]
 * @returns {string}
 */
export function newSeed(random = Math.random) {
  return Array.from({ length: 5 }, () => SEED_SIGNS[Math.floor(random() * SEED_SIGNS.length)]).join("");
}

/* -------------------------------------------- */

/**
 * A whole number between two others, both included.
 * @param {() => number} random
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
function between(random, low, high) {
  return low + Math.floor(random() * (Math.max(high, low) - low + 1));
}

/* -------------------------------------------- */
/*  Fields                                      */
/* -------------------------------------------- */

/**
 * A value for every tile of a map.
 * @template T
 * @param {number} rows
 * @param {number} columns
 * @param {(i: number, j: number) => T} value
 * @returns {T[][]}
 */
function grid(rows, columns, value) {
  return Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (__, j) => value(i, j)));
}

/* -------------------------------------------- */

/**
 * A field that rises and falls smoothly over the map, as moisture or the lie of the land does: random values
 * some tiles apart, with the tiles between them eased from one to the next, and a finer field laid over it.
 * Each tile is then ranked among all the others, so that "the wettest fifth of the map" is always a fifth.
 * @param {Draft} draft
 * @param {number} spread     How many tiles apart the random values lie
 * @returns {number[][]}      The rank of each tile, from 0 for the lowest up to 1
 */
function ranked(draft, spread) {
  const { rows, columns, random } = draft;
  const layer = (cell) => {
    const lattice = grid(Math.ceil(rows / cell) + 2, Math.ceil(columns / cell) + 2, () => random());
    const ease = (t) => t * t * (3 - (2 * t));
    return grid(rows, columns, (i, j) => {
      const y = Math.floor(i / cell);
      const x = Math.floor(j / cell);
      const ty = ease((i / cell) - y);
      const tx = ease((j / cell) - x);
      const top = lattice[y][x] + ((lattice[y][x + 1] - lattice[y][x]) * tx);
      const bottom = lattice[y + 1][x] + ((lattice[y + 1][x + 1] - lattice[y + 1][x]) * tx);
      return top + ((bottom - top) * ty);
    });
  };
  const coarse = layer(Math.max(spread, 2));
  const fine = layer(Math.max(spread / 2, 2));
  const raw = grid(rows, columns, (i, j) => (coarse[i][j] * 0.65) + (fine[i][j] * 0.35));
  const order = raw.flat().map((value, at) => [value, at]).sort((a, b) => a[0] - b[0]);
  const rank = grid(rows, columns, () => 0);
  order.forEach(([, at], place) => rank[Math.floor(at / columns)][at % columns] = place / order.length);
  return rank;
}

/* -------------------------------------------- */
/*  Laying Terrain                              */
/* -------------------------------------------- */

/**
 * Is a tile on the map?
 * @param {Draft} draft
 * @param {number} i
 * @param {number} j
 * @returns {boolean}
 */
function onMap(draft, i, j) {
  return (i >= 0) && (j >= 0) && (i < draft.rows) && (j < draft.columns);
}

/* -------------------------------------------- */

/**
 * Make a tile a kind of terrain, and set how high it lies if that is given. A tile off the map is passed over.
 * @param {Draft} draft
 * @param {number} i
 * @param {number} j
 * @param {string} kind         A key of FEO.terrain.types
 * @param {number} [height]
 */
function lay(draft, i, j, kind, height) {
  if ( !onMap(draft, i, j) ) return;
  draft.tiles[i][j] = kind;
  if ( height !== undefined ) draft.heights[i][j] = height;
}

/* -------------------------------------------- */

/**
 * Lay a kind of terrain over the tiles that rank highest in a field.
 * @param {Draft} draft
 * @param {number[][]} field
 * @param {number} share                    The share of the map to cover, from the top of the field down
 * @param {string} kind
 * @param {object} [options]
 * @param {number} [options.height]         How high those tiles are to lie
 * @param {string|null} [options.over]      The only kind of terrain to lay it over; any, if null
 * @param {(i: number, j: number) => boolean} [options.where]     Which tiles may be covered at all
 */
function wash(draft, field, share, kind, { height, over = "plain", where = () => true } = {}) {
  for ( let i = 0; i < draft.rows; i++ ) {
    for ( let j = 0; j < draft.columns; j++ ) {
      if ( (field[i][j] < 1 - share) || !where(i, j) ) continue;
      if ( over && (draft.tiles[i][j] !== over) ) continue;
      lay(draft, i, j, kind, height);
    }
  }
}

/* -------------------------------------------- */

/**
 * Put some tiles of a kind here and there.
 * @param {Draft} draft
 * @param {number} count
 * @param {string} kind
 * @param {object} [options]
 * @param {string} [options.over]           The kind of terrain to put them on
 * @param {(i: number, j: number) => boolean} [options.where]
 * @returns {Tile[]}                        Where they were put
 */
function dot(draft, count, kind, { over = "plain", where = () => true } = {}) {
  const put = [];
  for ( let tries = count * 40; (tries > 0) && (put.length < count); tries-- ) {
    const i = between(draft.random, 0, draft.rows - 1);
    const j = between(draft.random, 0, draft.columns - 1);
    if ( (draft.tiles[i][j] !== over) || !where(i, j) ) continue;
    lay(draft, i, j, kind);
    put.push({ i, j });
  }
  return put;
}

/* -------------------------------------------- */

/**
 * The tiles of a way from one tile to another that wanders a little as it goes.
 * @param {Draft} draft
 * @param {Tile} from
 * @param {Tile} to
 * @param {number} [wander]     How often, from 0 to 1, a step is taken sideways instead of onwards
 * @returns {Tile[]}
 */
function wayBetween(draft, from, to, wander = 0) {
  const way = [{ ...from }];
  let { i, j } = from;
  for ( let steps = (draft.rows + draft.columns) * 4; (steps > 0) && ((i !== to.i) || (j !== to.j)); steps-- ) {
    const across = Math.sign(to.j - j);
    const down = Math.sign(to.i - i);
    if ( across && (draft.random() < wander) ) {
      const side = i + (draft.random() < 0.5 ? -1 : 1);
      if ( (side >= 1) && (side < draft.rows - 1) ) i = side;
    }
    else if ( across && (!down || (draft.random() < 0.7)) ) j += across;
    else i += down;
    way.push({ i, j });
  }
  return way;
}

/* -------------------------------------------- */

/**
 * Run water down the map from its top edge to its bottom, drifting as it goes, with bridges and fords over it.
 * @param {Draft} draft
 * @param {object} water
 * @param {string} water.kind           The kind of terrain the water is
 * @param {number} [water.width]        How many tiles wide it runs
 * @param {number} [water.bridges]      How many rows are bridged: open ground from bank to bank
 * @param {number} [water.fords]        How many rows are shallow enough to wade
 * @param {number[]} [water.open]       Rows that are bridged whatever else is, as where a street meets the water
 * @returns {{banks: number[], bridges: number[]}}    The column of the left bank in each row, and the bridged rows
 */
function runWater(draft, { kind, width = 1, bridges = 0, fords = 0, open = [] }) {
  const { rows, columns, random } = draft;
  const banks = [];
  let j = between(random, Math.floor(columns * 0.38), Math.floor(columns * 0.6));
  for ( let i = 0; i < rows; i++ ) {
    if ( random() < 0.35 ) j += random() < 0.5 ? -1 : 1;
    j = Math.min(Math.max(j, 2), columns - 2 - width);
    banks.push(j);
    for ( let wide = 0; wide < width; wide++ ) lay(draft, i, j + wide, kind, 0);
  }

  // Crossings are spread down the water, bridges first and fords between them
  const crossings = bridges + fords;
  const bridged = [...open];
  for ( let at = 0; at < crossings; at++ ) {
    const i = Math.min(Math.max(Math.round(((at + 1) * rows) / (crossings + 1)) + between(random, -1, 1), 1), rows - 2);
    const ford = at >= bridges;
    if ( !ford ) bridged.push(i);
    for ( let wide = 0; wide < width; wide++ ) lay(draft, i, banks[i] + wide, ford ? "river" : "plain", 0);
  }
  for ( const i of open ) for ( let wide = 0; wide < width; wide++ ) lay(draft, i, banks[i] + wide, "plain", 0);
  return { banks, bridges: bridged };
}

/* -------------------------------------------- */

/**
 * Can a unit on foot with no skill for it enter a kind of terrain?
 * @param {string} kind
 * @returns {boolean}
 */
export function walkable(kind) {
  const type = FEO.terrain.types[kind];
  return !!type && !type.needs?.length;
}

/* -------------------------------------------- */

/**
 * Can a unit on foot walk from one tile of a map to another?
 * @param {{rows: number, columns: number, tiles: string[][]}} map
 * @param {Tile} from
 * @param {Tile} to
 * @returns {boolean}
 */
export function walksTo(map, from, to) {
  if ( !walkable(map.tiles[from.i]?.[from.j]) || !walkable(map.tiles[to.i]?.[to.j]) ) return false;
  const seen = new Set([tileKey(from)]);
  const next = [from];
  while ( next.length ) {
    const { i, j } = next.pop();
    if ( (i === to.i) && (j === to.j) ) return true;
    for ( const [di, dj] of STEPS ) {
      const tile = { i: i + di, j: j + dj };
      const key = tileKey(tile);
      if ( seen.has(key) || !walkable(map.tiles[tile.i]?.[tile.j]) ) continue;
      seen.add(key);
      next.push(tile);
    }
  }
  return false;
}

/* -------------------------------------------- */

/**
 * Make sure a unit on foot can walk from one tile to another: if it cannot, a way is cleared between them,
 * open ground wherever something stood in it.
 * @param {Draft} draft
 * @param {Tile} from
 * @param {Tile} to
 */
function openWay(draft, from, to) {
  if ( walksTo(draft, from, to) ) return;
  for ( const { i, j } of wayBetween(draft, from, to, 0.15) ) {
    if ( !walkable(draft.tiles[i][j]) ) lay(draft, i, j, "plain", 0);
  }
}

/* -------------------------------------------- */
/*  Battlefields                                */
/* -------------------------------------------- */

/**
 * Open country: grass with stands of trees, a few hills, a fort or two and the odd house, and now and then a
 * stream.
 * @param {Draft} draft
 */
function layPlains(draft) {
  const area = draft.rows * draft.columns;
  const wet = ranked(draft, 5);
  const high = ranked(draft, 6);
  wash(draft, wet, 0.17, "forest");
  wash(draft, wet, 0.04, "thicket", { over: "forest" });
  wash(draft, high, 0.1, "hill");
  wash(draft, high, 0.05, "hill", { over: "hill", height: 1 });
  if ( draft.random() < 0.35 ) runWater(draft, { kind: "river" });
  dot(draft, 1 + Math.floor(area / 240), "fort");
  dot(draft, 1 + Math.floor(area / 170), "house");
}

/* -------------------------------------------- */

/**
 * Deep woods: trees over half the map and thicket at their heart, with a track through them, clearings, and
 * the hedges and old trees that grow nowhere else.
 * @param {Draft} draft
 */
function layWoodland(draft) {
  const { rows, columns, random } = draft;
  const wet = ranked(draft, 4);
  wash(draft, wet, 0.52, "forest");
  wash(draft, wet, 0.16, "thicket", { over: "forest" });
  for ( let clearing = between(random, 2, 3); clearing > 0; clearing-- ) {
    const i = between(random, 2, rows - 3);
    const j = between(random, 2, columns - 3);
    for ( let di = -1; di <= 1; di++ ) for ( let dj = -2; dj <= 2; dj++ ) if ( Math.abs(di) + Math.abs(dj) < 3 ) lay(draft, i + di, j + dj, "plain");
  }
  if ( random() < 0.5 ) runWater(draft, { kind: "river" });
  const middle = Math.floor(rows / 2);
  for ( const { i, j } of wayBetween(draft, { i: middle, j: 0 }, { i: middle, j: columns - 1 }, 0.3) ) lay(draft, i, j, "plain");
  dot(draft, between(random, 1, 2), "healhedge", { over: "forest" });
  dot(draft, between(random, 1, 2), "wardwood", { over: "forest" });
  dot(draft, 1, "fort");
  dot(draft, between(random, 1, 2), "house");
}

/* -------------------------------------------- */

/**
 * A mountain pass: peaks and cliffs over high ground, wooded valleys, and a road through it all with a fort at
 * each third of the way.
 * @param {Draft} draft
 */
function layHighlands(draft) {
  const { rows, columns } = draft;
  const high = ranked(draft, 5);
  const wet = ranked(draft, 5);
  wash(draft, high, 0.44, "hill", { height: 1 });
  wash(draft, high, 0.22, "cliff", { over: "hill", height: 1 });
  wash(draft, high, 0.17, "mountain", { over: "cliff", height: 2 });
  wash(draft, wet, 0.16, "forest");
  const middle = Math.floor(rows / 2);
  const pass = wayBetween(draft, { i: middle, j: 0 }, { i: middle, j: columns - 1 }, 0.3);
  for ( const { i, j } of pass ) lay(draft, i, j, "plain", 0);
  for ( const third of [1, 2] ) {
    const { i, j } = pass[Math.floor((pass.length * third) / 3)];
    lay(draft, i, j, "fort", 0);
  }
  dot(draft, 1, "house");
}

/* -------------------------------------------- */

/**
 * A river crossing: deep water down the middle of open country, with bridges, a ford, a fort at a bridgehead
 * on either bank and a hamlet on the near side.
 * @param {Draft} draft
 */
function layRiver(draft) {
  const { rows, random } = draft;
  const wet = ranked(draft, 5);
  const high = ranked(draft, 6);
  wash(draft, wet, 0.15, "forest");
  wash(draft, wet, 0.03, "thicket", { over: "forest" });
  wash(draft, high, 0.07, "hill");
  const width = rows >= 14 ? 2 : 1;
  const { banks, bridges } = runWater(draft, { kind: "water", width, bridges: rows >= 18 ? 3 : 2, fords: 1 });
  bridges.forEach((i, at) => {
    const j = (at % 2) ? banks[i] + width : banks[i] - 1;
    if ( draft.tiles[i]?.[j] !== "water" ) lay(draft, i, j, "fort", 0);
  });
  dot(draft, between(random, 2, 3), "house", { where: (i, j) => j < banks[i] - 1 });
  dot(draft, 1, "house", { where: (i, j) => j > banks[i] + width });
}

/* -------------------------------------------- */

/**
 * A coast: the sea along the bottom of the map behind a strand, cliffs here and there above it, woods and
 * hills inland, and a harbour village with its fort.
 * @param {Draft} draft
 */
function layCoast(draft) {
  const { rows, columns, random } = draft;
  const lie = ranked(draft, 5);
  const wet = ranked(draft, 5);
  const high = ranked(draft, 6);

  // Where the sea begins in each column, drifting a little from one to the next
  const shore = [];
  let at = Math.round(rows * 0.66);
  for ( let j = 0; j < columns; j++ ) {
    if ( random() < 0.45 ) at += random() < 0.5 ? -1 : 1;
    at = Math.min(Math.max(at, Math.round(rows * 0.5)), rows - 2);
    shore.push(at);
  }
  const inland = (i, j) => i < shore[j] - 1;
  wash(draft, wet, 0.26, "forest", { where: inland });
  wash(draft, high, 0.14, "hill", { where: inland });
  wash(draft, high, 0.06, "hill", { over: "hill", height: 1, where: inland });
  for ( let j = 0; j < columns; j++ ) {
    for ( let i = shore[j]; i < rows; i++ ) lay(draft, i, j, "water", 0);
    lay(draft, shore[j] - 1, j, "plain", 0);

    // Where the land lies high the strand is a cliff, and the ground behind it stands above the sea
    if ( lie[shore[j] - 1][j] > 0.7 ) {
      lay(draft, shore[j] - 1, j, "cliff", 1);
      if ( shore[j] >= 2 ) draft.heights[shore[j] - 2][j] = 1;
    }
  }
  dot(draft, between(random, 2, 4), "house", { where: (i, j) => (i >= shore[j] - 4) && (i < shore[j] - 1) });
  dot(draft, 1, "fort", { where: inland });
  dot(draft, 1, "house", { where: inland });
}

/* -------------------------------------------- */

/**
 * A fortress: a walled keep on the far side of the map, sometimes behind a moat, with a main gate facing the
 * field and a side gate, a wall across its halls, pillars, and a throne at its heart. Its walls are cliffs,
 * which only those who can climb will cross, and its gates and throne are forts.
 * @param {Draft} draft
 */
function layFortress(draft) {
  const { rows, columns, random } = draft;
  const wet = ranked(draft, 5);
  const moat = (rows >= 12) && (random() < 0.5);
  const margin = moat ? 2 : 1;
  const wide = Math.min(Math.max(Math.round(columns * 0.46), 7), columns - 5);
  const tall = Math.min(Math.max(Math.round(rows * 0.64), 7), rows - (margin * 2));
  const right = columns - 1 - margin;
  const left = right - wide + 1;
  const top = Math.floor((rows - tall) / 2);
  const bottom = top + tall - 1;
  const middle = Math.floor((top + bottom) / 2);

  // The field before the walls
  wash(draft, wet, 0.14, "forest", { where: (i, j) => j < left - 2 });
  dot(draft, between(random, 2, 4), "cover", { where: (i, j) => (j < left - 1) && (j > left - 7) });
  dot(draft, 1, "house", { where: (i, j) => j < left - 3 });

  // The moat, the walls and the floor within them
  for ( let i = top - 1; i <= bottom + 1; i++ ) {
    for ( let j = left - 1; j <= right + 1; j++ ) {
      const ring = (i < top) || (i > bottom) || (j < left) || (j > right);
      const wall = !ring && ((i === top) || (i === bottom) || (j === left) || (j === right));
      if ( ring ) {
        if ( moat ) lay(draft, i, j, "water", 0);
      }
      else lay(draft, i, j, wall ? "cliff" : "plain", 0);
    }
  }

  // A wall across the halls, with a door near either end of it, so that the way to the throne turns
  if ( wide >= 9 ) {
    const inner = left + Math.round(wide * 0.55);
    for ( let i = top + 1; i < bottom; i++ ) lay(draft, i, inner, "cliff", 0);
    lay(draft, top + 2, inner, "plain", 0);
    lay(draft, bottom - 2, inner, "plain", 0);
  }

  // Pillars in the halls, kept off the row of the main gate
  for ( let i = top + 2; i < bottom - 1; i++ ) {
    for ( let j = left + 2; j < right - 1; j++ ) {
      if ( (i !== middle) && ((i - top) % 3 === 2) && ((j - left) % 3 === 2) && (draft.tiles[i][j] === "plain") ) lay(draft, i, j, "cover", 0);
    }
  }

  // The gates, each with a bridge over the moat, and the throne
  lay(draft, middle, left, "fort", 0);
  lay(draft, middle, left - 1, "plain", 0);
  const side = left + between(random, Math.floor(wide * 0.3), Math.floor(wide * 0.45));
  const above = random() < 0.5;
  lay(draft, above ? top : bottom, side, "fort", 0);
  lay(draft, above ? top - 1 : bottom + 1, side, "plain", 0);
  draft.goal = { i: middle, j: right - 2 };
  lay(draft, draft.goal.i, draft.goal.j, "fort", 0);
}

/* -------------------------------------------- */

/**
 * A town: streets between blocks of houses with their gardens and stalls, a main street from edge to edge, a
 * square at the crossing with a hedge to rest by, a garrison, barricades, and sometimes a canal with a bridge
 * at every street.
 * @param {Draft} draft
 */
function layTown(draft) {
  const { rows, columns, random } = draft;
  const middle = Math.floor(rows / 2);
  const broad = rows >= 14 ? 2 : 1;
  const avenue = between(random, Math.floor(columns * 0.4), Math.floor(columns * 0.6));
  const street = (i, j) => ((i >= middle) && (i < middle + broad)) || (j === avenue);
  const streets = [];
  for ( let i = middle; i < middle + broad; i++ ) streets.push(i);

  // Blocks, row of them by row, each a few tiles wide with a street between it and the next
  for ( let i = 1; i < rows - 1; ) {
    const tall = between(random, 2, 3);
    for ( let j = 1; j < columns - 1; ) {
      const wide = between(random, 3, 5);
      for ( let di = 0; di < tall; di++ ) {
        for ( let dj = 0; dj < wide; dj++ ) {
          const [bi, bj] = [i + di, j + dj];
          if ( (bi >= rows - 1) || (bj >= columns - 1) || street(bi, bj) ) continue;
          const roll = random();
          lay(draft, bi, bj, roll < 0.62 ? "house" : roll < 0.74 ? "forest" : roll < 0.82 ? "cover" : "plain");
        }
      }
      j += wide + 1;
    }
    i += tall;
    if ( i < rows - 1 ) streets.push(i);
    i += 1;
  }

  // The square, where the main street meets the avenue
  for ( let i = middle - 2; i < middle + broad + 2; i++ ) {
    for ( let j = avenue - 3; j <= avenue + 3; j++ ) lay(draft, i, j, "plain");
  }
  lay(draft, middle - 2, avenue - 2, "healhedge");
  lay(draft, middle + broad + 1, avenue + 2, "cover");

  // The garrison among the houses, and barricades thrown across the main street
  dot(draft, between(random, 1, 2), "fort", { over: "house" });
  dot(draft, between(random, 3, 5), "cover", { where: (i, j) => (i >= middle) && (i < middle + broad) && (Math.abs(j - avenue) > 3) });
  if ( random() < 0.4 ) runWater(draft, { kind: "water", open: streets.filter((i) => (i > 0) && (i < rows - 1)) });
}

/* -------------------------------------------- */

/**
 * A desert: sand and dunes with bare rock breaking through, hard ground where the going is easy, an oasis,
 * ruins with what is left of a fort, and a village.
 * @param {Draft} draft
 */
function layDesert(draft) {
  const { rows, columns, random } = draft;
  const high = ranked(draft, 6);
  const firm = ranked(draft, 5);
  for ( let i = 0; i < rows; i++ ) for ( let j = 0; j < columns; j++ ) lay(draft, i, j, "desert");
  wash(draft, firm, 0.12, "plain", { over: "desert" });
  wash(draft, high, 0.14, "hill", { over: "desert" });
  wash(draft, high, 0.06, "hill", { over: "hill", height: 1 });
  wash(draft, high, 0.025, "mountain", { over: "hill", height: 2 });

  // The oasis: shallow water with trees round it and a hedge to rest by
  const oasis = { i: between(random, 2, rows - 3), j: between(random, 3, columns - 4) };
  for ( let di = -2; di <= 2; di++ ) {
    for ( let dj = -2; dj <= 2; dj++ ) {
      const far = Math.abs(di) + Math.abs(dj);
      if ( far <= 1 ) lay(draft, oasis.i + di, oasis.j + dj, "river", 0);
      else if ( (far === 2) && (random() < 0.75) ) lay(draft, oasis.i + di, oasis.j + dj, "forest", 0);
    }
  }
  lay(draft, oasis.i, oasis.j + 2, "healhedge", 0);

  // Ruins: broken walls to shelter behind, and the gatehouse that still stands
  for ( let ruin = 0; ruin < 2; ruin++ ) {
    const i = between(random, 1, rows - 3);
    const j = between(random, 1, columns - 3);
    for ( let di = 0; di < 3; di++ ) for ( let dj = 0; dj < 3; dj++ ) if ( random() < 0.45 ) lay(draft, i + di, j + dj, "cover", 0);
    lay(draft, i + 1, j + 1, "fort", 0);
  }
  dot(draft, between(random, 1, 2), "house", { over: "desert" });
}

/* -------------------------------------------- */
/*  Making a Map                                */
/* -------------------------------------------- */

/**
 * A size the generator can work with: whole numbers within its limits.
 * @param {{rows: number, columns: number}} size
 * @returns {{rows: number, columns: number}}
 */
export function mapSize({ rows, columns }) {
  const fit = (value, fallback) => {
    const whole = Math.round(Number(value));
    return Number.isFinite(whole) ? Math.min(Math.max(whole, MAP_LIMITS.min), MAP_LIMITS.max) : fallback;
  };
  return { rows: fit(rows, MAP_SIZES.medium.rows), columns: fit(columns, MAP_SIZES.medium.columns) };
}

/* -------------------------------------------- */

/**
 * Make a map.
 * @param {object} wanted
 * @param {string} wanted.type        A key of MAP_TYPES
 * @param {number} wanted.rows
 * @param {number} wanted.columns
 * @param {string} wanted.seed
 * @returns {BattleMap}
 */
export function generateMap({ type, rows, columns, seed }) {
  const kind = type in MAP_TYPES ? type : "plains";
  const size = mapSize({ rows, columns });
  const draft = {
    ...size,
    random: seededRandom(`${kind}:${size.columns}x${size.rows}:${seed}`),
    tiles: grid(size.rows, size.columns, () => FEO.terrain.default),
    heights: grid(size.rows, size.columns, () => 0)
  };
  MAP_TYPES[kind](draft);

  // The battle can always be joined: both sides have somewhere to stand, and a way to each other
  const middle = Math.floor(size.rows / 2);
  const from = { i: middle, j: 0 };
  const to = draft.goal ?? { i: middle, j: size.columns - 1 };
  for ( const { i, j } of [from, to] ) if ( !walkable(draft.tiles[i][j]) ) lay(draft, i, j, FEO.terrain.default, 0);
  openWay(draft, from, to);
  return { type: kind, seed: String(seed), ...size, tiles: draft.tiles, heights: draft.heights, ends: { from, to } };
}

/* -------------------------------------------- */

/**
 * How many tiles of each kind of terrain a map has, the most of them first.
 * @param {BattleMap} map
 * @returns {{terrain: string, count: number}[]}
 */
export function mapCounts(map) {
  const counts = new Map();
  for ( const kind of map.tiles.flat() ) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return Array.from(counts, ([terrain, count]) => ({ terrain, count })).sort((a, b) => (b.count - a.count) || a.terrain.localeCompare(b.terrain));
}

/* -------------------------------------------- */

/**
 * A map as paint: the tiles of each kind of terrain and of each height above the floor, named as they lie on
 * a scene whose own first tile is some way in from the corner of its canvas.
 * @param {BattleMap} map
 * @param {object} [options]
 * @param {number} [options.top]      The row of the scene's first tile
 * @param {number} [options.left]     The column of the scene's first tile
 * @param {boolean} [options.open]    Paint open ground as well, as on a scene that has no picture of its own
 * @returns {Paint}
 */
export function mapPaint(map, { top = 0, left = 0, open = false } = {}) {
  const paint = { terrain: new Map(), elevation: new Map() };
  const add = (coat, value, key) => {
    if ( !paint[coat].has(value) ) paint[coat].set(value, new Set());
    paint[coat].get(value).add(key);
  };
  for ( let i = 0; i < map.rows; i++ ) {
    for ( let j = 0; j < map.columns; j++ ) {
      const key = tileKey({ i: i + top, j: j + left });
      if ( open || (map.tiles[i][j] !== FEO.terrain.default) ) add("terrain", map.tiles[i][j], key);
      if ( map.heights[i][j] > 0 ) add("elevation", map.heights[i][j], key);
    }
  }
  return paint;
}

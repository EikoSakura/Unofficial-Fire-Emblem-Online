import { FEO } from "../config.mjs";
import { STEPS, between, dot, grid, lay, layShips, mapSize, onMap, openWay, ranked, seededRandom, walkable } from "./mapgen.mjs";
import { tileKey } from "./reach.mjs";
import { routeBow } from "./worldmap.mjs";

/**
 * The map generator, from the World Map: a battle map made of the ground round a place or a point of the World
 * Map, so that a fight there is fought on land that looks as the World Map shows it.
 *
 * The ground is read through a lens: a box of the World Map round the point, as many points to a tile as
 * `FEO.worldMap.lens` says, with north at the top of both. The sea is where the sea is. High ground, woods and
 * dry land set how likely each tile is to be a hill, a tree or sand, and chance from the seed does the rest, so
 * that deep woods give a map that can still be fought over. Each route that crosses the lens is cleared across
 * the map, and what stands at the place stands at its heart. Out at sea there is nothing to stand on, so two
 * ships are laid there for the battle to be fought on. The same land, point, size and seed always give the same
 * map.
 *
 * Everything here works on numbers alone and touches nothing of Foundry.
 *
 * @import {BattleMap, Draft, Track} from "./mapgen.mjs"
 * @import {Tile} from "./reach.mjs"
 * @import {Land, Place, Route} from "./worldmap.mjs"
 */

/**
 * @typedef Lens
 * The part of a World Map a battle map is made from.
 * @property {number} x0          Its left edge, in points of the World Map
 * @property {number} y0          Its top edge
 * @property {number} w           How wide it is, in points
 * @property {number} h           How tall
 * @property {number} scale       How many points a tile covers
 * @property {number} rows
 * @property {number} columns
 */

/**
 * @typedef Lie
 * The lie of the land under a lens, in a few numbers from 0 to 1.
 * @property {number} sea         The share of the lens that is sea
 * @property {string} seaSide     The side the sea is on: one of WINDS, `around`, or blank where there is none
 * @property {number} wood        Of the dry land, how much is wooded
 * @property {number} hills       How much is hills or higher
 * @property {number} peaks       How much is mountains
 * @property {number} arid        How much is dry
 * @property {number} frost       How much is cold
 */

/**
 * @typedef Exit
 * Where a route leaves a battle map.
 * @property {Tile} tile          The last tile of the map it crosses
 * @property {string} id          The place it leads to
 * @property {string} to          The name of that place
 * @property {"road"|"sea"} kind
 * @property {boolean} company    Is it the way the company comes in by?
 */

/**
 * @typedef {BattleMap & {lens: Lens, lie: Lie, exits: Exit[], tracks: Track[], afloat: boolean}} LandMap
 * `afloat` says the battle is fought on ships.
 */

/** The winds, clockwise from the east. */
export const WINDS = ["east", "southEast", "south", "southWest", "west", "northWest", "north", "northEast"];

/* -------------------------------------------- */
/*  Reading the Land                            */
/* -------------------------------------------- */

/**
 * The lens a battle map of a size is made through: a box round a point, kept on the World Map.
 * @param {Land} land
 * @param {{x: number, y: number}} point
 * @param {{rows: number, columns: number}} size
 * @param {number} [scale]        How many points a tile covers
 * @returns {Lens}
 */
export function lensOf(land, point, { rows, columns }, scale = FEO.worldMap.lens) {
  const w = columns * scale;
  const h = rows * scale;
  const fit = (value, most) => Math.min(Math.max(Math.round(value), 0), Math.max(most, 0));
  return { x0: fit(point.x - (w / 2), land.width - w), y0: fit(point.y - (h / 2), land.height - h), w, h, scale, rows, columns };
}

/* -------------------------------------------- */

/**
 * The tile of a lens a point of the World Map falls in, which may be off the battle map.
 * @param {Lens} lens
 * @param {number} x
 * @param {number} y
 * @returns {Tile}
 */
function lensTile(lens, x, y) {
  return { i: Math.floor((y - lens.y0) / lens.scale), j: Math.floor((x - lens.x0) / lens.scale) };
}

/* -------------------------------------------- */

/**
 * A field with every tile eased towards its neighbours.
 * @param {number[][]} field
 * @returns {number[][]}
 */
function soften(field) {
  return grid(field.length, field[0].length, (i, j) => {
    let sum = 0;
    let count = 0;
    for ( let di = -1; di <= 1; di++ ) {
      for ( let dj = -1; dj <= 1; dj++ ) {
        const value = field[i + di]?.[j + dj];
        if ( value === undefined ) continue;
        sum += value;
        count++;
      }
    }
    return sum / count;
  });
}

/* -------------------------------------------- */

/**
 * What the World Map shows under each tile of a lens: how much of it is sea, how high it rises (from 0 for low
 * ground to 2 for mountains), and how wooded, how dry and how cold it is.
 * @param {Land} land
 * @param {Lens} lens
 * @returns {{sea: number[][], rise: number[][], wood: number[][], arid: number[][], frost: number[][]}}
 */
export function surveyLens(land, lens) {
  const { rows, columns, scale, x0, y0 } = lens;
  const share = (of) => grid(rows, columns, (i, j) => {
    let sum = 0;
    for ( let dy = 0; dy < scale; dy++ ) {
      for ( let dx = 0; dx < scale; dx++ ) sum += of(((y0 + (i * scale) + dy) * land.width) + x0 + (j * scale) + dx) || 0;
    }
    return sum / (scale * scale);
  });
  return {
    sea: share((at) => (land.land[at] ? 0 : 1)),
    rise: soften(share((at) => land.high[at])),
    wood: soften(share((at) => land.wood[at])),
    arid: soften(share((at) => land.arid?.[at])),
    frost: share((at) => land.frost?.[at])
  };
}

/* -------------------------------------------- */

/**
 * The lie of the land under a lens, from what was read of it.
 * @param {ReturnType<typeof surveyLens>} read
 * @returns {Lie}
 */
export function lieOf(read) {
  const rows = read.sea.length;
  const columns = read.sea[0].length;
  const sums = { wood: 0, hills: 0, peaks: 0, arid: 0, frost: 0 };
  let dry = 0;
  let across = 0;
  let down = 0;
  for ( let i = 0; i < rows; i++ ) {
    for ( let j = 0; j < columns; j++ ) {
      if ( read.sea[i][j] >= 0.5 ) {
        across += j - ((columns - 1) / 2);
        down += i - ((rows - 1) / 2);
        continue;
      }
      dry++;
      sums.wood += read.wood[i][j];
      sums.hills += Math.min(read.rise[i][j], 1);
      sums.peaks += Math.max(read.rise[i][j] - 1, 0);
      sums.arid += read.arid[i][j];
      sums.frost += read.frost[i][j];
    }
  }
  const wet = (rows * columns) - dry;
  const lie = { sea: wet / (rows * columns), seaSide: "", wood: 0, hills: 0, peaks: 0, arid: 0, frost: 0 };
  for ( const [key, sum] of Object.entries(sums) ) lie[key] = dry ? sum / dry : 0;

  // The sea is on the side its middle lies to, unless it lies all round
  if ( wet ) {
    const turn = Math.round(Math.atan2(down, across) / (Math.PI / 4));
    lie.seaSide = (Math.hypot(across, down) / wet) < 1.5 ? "around" : WINDS[((turn % 8) + 8) % 8];
  }
  return lie;
}

/* -------------------------------------------- */

/**
 * The lie of the land round a point of the World Map, for a battle map of a size.
 * @param {Land} land
 * @param {{x: number, y: number}} point
 * @param {{rows: number, columns: number}} size
 * @returns {Lie}
 */
export function lieAt(land, point, size) {
  return lieOf(surveyLens(land, lensOf(land, point, mapSize(size))));
}

/* -------------------------------------------- */
/*  Making a Map                                */
/* -------------------------------------------- */

/**
 * The tiles stepped through from one tile to another, the last of them included and the first not.
 * @param {Tile} from
 * @param {Tile} to
 * @returns {Tile[]}
 */
function stepsBetween(from, to) {
  const way = [];
  let { i, j } = from;
  while ( (i !== to.i) || (j !== to.j) ) {
    if ( Math.abs(to.j - j) >= Math.abs(to.i - i) ) j += Math.sign(to.j - j);
    else i += Math.sign(to.i - i);
    way.push({ i, j });
  }
  return way;
}

/* -------------------------------------------- */

/**
 * Lay the ground of a draft as the World Map shows it: the sea where the sea is, and the rest by how the land
 * lies there, made ragged by chance.
 * @param {Draft} draft
 * @param {ReturnType<typeof surveyLens>} read
 */
function layLand(draft, read) {
  const { rows, columns, random } = draft;
  const wet = (i, j) => read.sea[i]?.[j] >= 0.5;
  const firm = ranked(draft, 5);
  const lift = ranked(draft, 5);
  const damp = ranked(draft, 4);
  for ( let i = 0; i < rows; i++ ) {
    for ( let j = 0; j < columns; j++ ) {
      if ( wet(i, j) ) {
        lay(draft, i, j, "water", 0);
        continue;
      }

      // Dry land is sand, but for the firm ground that breaks through it
      if ( (read.arid[i][j] + ((firm[i][j] - 0.5) * 0.5) > 0.5) && (firm[i][j] < 0.9) ) lay(draft, i, j, "desert");

      // The higher the land, the more of it is hills, and where it is highest peaks and cliffs stand among them
      const up = read.rise[i][j];
      const peaks = Math.min(Math.max(up - 0.9, 0), 1);
      const hills = 0.05 + (0.42 * Math.min(up, 1));
      const high = lift[i][j];
      if ( high > 1 - (0.27 * peaks) ) lay(draft, i, j, "mountain", 2);
      else if ( high > 1 - (0.34 * peaks) ) lay(draft, i, j, "cliff", 1);
      else if ( high > 1 - (hills * 0.55) ) lay(draft, i, j, "hill", 1);
      else if ( high > 1 - hills ) lay(draft, i, j, "hill");

      // Trees stand on open ground: about half of it in deep woods, with thicket at their heart
      else if ( draft.tiles[i][j] === "plain" ) {
        const trees = read.wood[i][j];
        if ( damp[i][j] > 1 - (0.17 * trees) ) lay(draft, i, j, "thicket");
        else if ( damp[i][j] > 1 - (0.07 + (0.5 * trees)) ) lay(draft, i, j, "forest");
      }
    }
  }

  // The shore: a strand, or a cliff where the land stands high over the water
  for ( let i = 0; i < rows; i++ ) {
    for ( let j = 0; j < columns; j++ ) {
      if ( wet(i, j) || !STEPS.some(([di, dj]) => onMap(draft, i + di, j + dj) && wet(i + di, j + dj)) ) continue;
      if ( (read.rise[i][j] > 0.7) && (random() < 0.6) ) lay(draft, i, j, "cliff", 1);
      else if ( !walkable(draft.tiles[i][j]) ) lay(draft, i, j, "plain", 0);
      else draft.heights[i][j] = 0;
    }
  }
}

/* -------------------------------------------- */

/**
 * Clear every route of the World Map that crosses a lens across the draft made through it: open ground through
 * woods, hills and peaks, and a bridge of boards over water. A sea lane clears nothing, and no route does on a
 * map that is fought on ships.
 * @param {Draft} draft
 * @param {Lens} lens
 * @param {{places: Place[], routes: Route[]}} world
 * @param {boolean} [afloat]      Is the map fought on ships?
 * @returns {{road: Set<string>, exits: Exit[], tracks: Track[]}}
 *   The tiles the roads were cleared over, where each route leaves the map, and the line of each across it
 */
function layRoads(draft, lens, world, afloat = false) {
  const at = new Map(world.places.map((place) => [place.id, place]));
  const road = new Set();
  const exits = [];
  const tracks = [];
  const leaves = (tile, towards, kind) => {
    if ( exits.some((exit) => (exit.id === towards.id) && (exit.kind === kind)) ) return;
    exits.push({ tile, id: towards.id, to: towards.name, kind, company: false });
  };
  const tiles = (point) => [(point.x - lens.x0) / lens.scale, (point.y - lens.y0) / lens.scale];
  for ( const route of world.routes ) {
    const a = at.get(route.a);
    const b = at.get(route.b);
    if ( !a || !b ) continue;
    const bow = routeBow(a, b, route.bend);
    const steps = Math.max(Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (lens.scale * 0.5)), 8);
    const run = [];
    let last = null;
    for ( let n = 0; n <= steps; n++ ) {
      const t = n / steps;
      const s = 1 - t;
      const tile = lensTile(lens, (s * s * a.x) + (2 * s * t * bow.x) + (t * t * b.x), (s * s * a.y) + (2 * s * t * bow.y) + (t * t * b.y));
      const here = onMap(draft, tile.i, tile.j);
      const was = !!last && onMap(draft, last.i, last.j);
      if ( was && !here ) leaves(last, b, route.kind);
      else if ( last && !was && here ) leaves(tile, a, route.kind);
      if ( was && here ) run.push(...stepsBetween(last, tile));
      else if ( here ) run.push(tile);
      last = tile;
    }
    if ( !run.length ) continue;
    tracks.push({ a: tiles(a), c: tiles(bow), b: tiles(b), sea: route.kind === "sea" });
    if ( afloat || (route.kind === "sea") ) continue;
    for ( const { i, j } of run ) {
      road.add(tileKey({ i, j }));
      lay(draft, i, j, draft.tiles[i][j] === "water" ? "deck" : "plain", 0);
    }
  }
  return { road, exits, tracks };
}

/* -------------------------------------------- */

/**
 * How far the island a place stands on reaches from its heart, across the map and down it, where the World Map
 * shows only sea there: far enough for what the place is.
 * @param {string} kind       One of FEO.worldMap.kinds
 * @param {number} rows
 * @param {number} columns
 * @returns {{i: number, j: number}}
 */
function islandOf(kind, rows, columns) {
  if ( kind === "capital" ) return { i: Math.round(rows * 0.36) + 2, j: Math.round(columns * 0.33) + 2 };
  if ( kind === "town" ) return { i: Math.round(rows * 0.27) + 2, j: Math.round(columns * 0.24) + 2 };
  if ( kind === "fort" ) return { i: Math.min(Math.max(Math.round(rows * 0.18), 2), 4) + 4, j: Math.min(Math.max(Math.round(columns * 0.15), 3), 6) + 4 };
  return { i: 5, j: 6 };
}

/* -------------------------------------------- */

/**
 * Make a battle map of a point of the World Map: the sea, the high ground, the woods and the dry land lie where
 * the World Map shows them, the roads leave by the edges they leave by there, and what stands at the place
 * stands at the heart of the map.
 *
 * A capital is a town round a walled keep, a fortress a keep with a gate wherever a road meets its walls, a
 * town streets and a square, a village a few houses, a port houses by the shore and a jetty, and ruins broken
 * walls. A point that is no place has none of these.
 *
 * Waters are fought over on ships, and so is a point picked out at sea: two ships lie side by side at the heart
 * of the map (see `layShips`), the company's on the side it comes from. Waters are sea even where the World Map
 * shows land, as on a map drawn over a picture, which knows of no sea. Any other place that lies in the sea
 * stands on an island of its own.
 *
 * The battle is joined from the road the company comes by, and leads to the heart of the place, or on bare
 * ground to the road out on the far side; at sea it is joined from the company's deck and leads to the helm of
 * the other ship. Whatever is made, a unit on foot can walk from one to the other.
 * @param {object} wanted
 * @param {Land} wanted.land
 * @param {{places: Place[], routes: Route[]}} wanted.world
 * @param {{x: number, y: number}} wanted.point
 * @param {Place|null} [wanted.place]     The place at the point, if it is one
 * @param {number} wanted.rows
 * @param {number} wanted.columns
 * @param {string} wanted.seed
 * @param {string} [wanted.cameBy]        The place the company comes from, if it is a route away
 * @param {Map<string, number>} [wanted.rank]     How many routes each place is from the company, to tell which
 *                                                road leads back towards it where `cameBy` does not
 * @param {number} [wanted.scale]         How many points of the World Map a tile covers
 * @returns {LandMap}
 */
export function generateFromLand({ land, world, point, place = null, rows, columns, seed, cameBy = "", rank = new Map(), scale = FEO.worldMap.lens }) {
  const size = mapSize({ rows, columns });
  const lens = lensOf(land, point, size, scale);
  const draft = {
    ...size,
    random: seededRandom(`land:${land.key}:${lens.x0},${lens.y0}:${size.columns}x${size.rows}:${seed}`),
    tiles: grid(size.rows, size.columns, () => FEO.terrain.default),
    heights: grid(size.rows, size.columns, () => 0)
  };
  const { random } = draft;
  const R = size.rows;
  const C = size.columns;
  const read = surveyLens(land, lens);
  const kind = place?.kind ?? "";
  const centre = lensTile(lens, point.x, point.y);
  const heart = { i: Math.min(Math.max(centre.i, 2), R - 3), j: Math.min(Math.max(centre.j, 2), C - 3) };

  // Waters are sea whatever the World Map shows, and another place out at sea has an island under it
  const wet = read.sea[heart.i][heart.j] >= 0.5;
  const afloat = (kind === "waters") || (!place && wet);
  if ( afloat && !wet ) read.sea = grid(R, C, () => 1);
  else if ( place && !afloat && wet ) {
    const reach = islandOf(kind, R, C);
    for ( let i = 0; i < R; i++ ) {
      for ( let j = 0; j < C; j++ ) {
        if ( Math.hypot((i - heart.i) / reach.i, (j - heart.j) / reach.j) + ((random() - 0.5) * 0.2) <= 1 ) read.sea[i][j] = 0;
      }
    }
  }
  layLand(draft, read);
  const { road, exits, tracks } = layRoads(draft, lens, world, afloat);

  // The side the company comes in by: the road from where it was, or the road that leads back towards it
  const company = (cameBy && exits.find((exit) => exit.id === cameBy))
    || [...exits].sort((x, y) => (rank.get(x.id) ?? Infinity) - (rank.get(y.id) ?? Infinity))[0] || null;
  if ( company ) company.company = true;
  let from = company ? company.tile : { i: Math.floor(R / 2), j: 0 };

  // What stands at the place is built round the heart of the map, off the water and off the roads
  const dryAt = (i, j) => onMap(draft, i, j) && (draft.tiles[i][j] !== "water");
  const open = (i, j) => dryAt(i, j) && !road.has(tileKey({ i, j }));
  const near = (count, kind, reach, { over = ["plain", "forest", "desert", "hill"], where = () => true } = {}) => {
    for ( let tries = count * 40, put = 0; (tries > 0) && (put < count); tries-- ) {
      const i = heart.i + between(random, -reach, reach);
      const j = heart.j + between(random, -reach, reach);
      if ( !open(i, j) || !over.includes(draft.tiles[i][j]) || !where(i, j) || ((i === heart.i) && (j === heart.j)) ) continue;
      lay(draft, i, j, kind);
      put++;
    }
  };
  let goal = null;

  // Streets between blocks of houses with their gardens and stalls
  const blocks = (hw, hh) => {
    const within = (i, j) => Math.hypot((i - heart.i) / (hh + 0.5), (j - heart.j) / (hw + 0.5)) <= 1;
    for ( let i = heart.i - hh; i <= heart.i + hh; i++ ) {
      for ( let j = heart.j - hw; j <= heart.j + hw; j++ ) if ( within(i, j) && dryAt(i, j) ) lay(draft, i, j, "plain", 0);
    }
    for ( let i = heart.i - hh; i <= heart.i + hh; ) {
      const tall = between(random, 2, 3);
      for ( let j = heart.j - hw; j <= heart.j + hw; ) {
        const wide = between(random, 3, 5);
        for ( let di = 0; di < tall; di++ ) {
          for ( let dj = 0; dj < wide; dj++ ) {
            const [bi, bj] = [i + di, j + dj];
            if ( (bi > heart.i + hh) || (bj > heart.j + hw) || !within(bi, bj) || !open(bi, bj) ) continue;
            const roll = random();
            lay(draft, bi, bj, roll < 0.6 ? "house" : roll < 0.72 ? "forest" : roll < 0.8 ? "cover" : "plain");
          }
        }
        j += wide + 1;
      }
      i += tall + 1;
    }
  };

  // A walled keep, with a gate wherever a road meets its walls, pillars in its halls and a throne at its
  // heart. Its walls are cliffs and its gates and throne are forts, as those of a fortress are
  const keep = (hw, hh) => {
    const top = heart.i - Math.min(hh, heart.i - 1);
    const bottom = heart.i + Math.min(hh, R - 2 - heart.i);
    const left = heart.j - Math.min(hw, heart.j - 1);
    const right = heart.j + Math.min(hw, C - 2 - heart.j);
    let gates = 0;
    for ( let i = top; i <= bottom; i++ ) {
      for ( let j = left; j <= right; j++ ) {
        const ends = (i === top) || (i === bottom);
        const sides = (j === left) || (j === right);
        if ( !ends && !sides ) lay(draft, i, j, "plain", 0);
        else if ( !(ends && sides) && road.has(tileKey({ i, j })) ) {
          lay(draft, i, j, "fort", 0);
          gates++;
        }
        else lay(draft, i, j, "cliff", 0);
      }
    }

    // A keep no road leads to has its gate on the side the company comes from
    if ( !gates ) {
      const di = from.i - heart.i;
      const dj = from.j - heart.j;
      const across = Math.abs(dj) >= Math.abs(di);
      const gate = across ? { i: heart.i, j: dj < 0 ? left : right } : { i: di < 0 ? top : bottom, j: heart.j };
      const out = across ? { i: gate.i, j: gate.j + (dj < 0 ? -1 : 1) } : { i: gate.i + (di < 0 ? -1 : 1), j: gate.j };
      lay(draft, gate.i, gate.j, "fort", 0);
      if ( onMap(draft, out.i, out.j) && !walkable(draft.tiles[out.i][out.j]) ) lay(draft, out.i, out.j, "plain", 0);
    }
    for ( let i = top + 2; i <= bottom - 2; i += 2 ) {
      for ( let j = left + 2; j <= right - 2; j += 2 ) {
        if ( (i !== heart.i) && (j !== heart.j) && !road.has(tileKey({ i, j })) ) lay(draft, i, j, "cover", 0);
      }
    }
    lay(draft, heart.i, heart.j, "fort", 0);
    goal = heart;
    return { top, bottom, left, right };
  };

  // At sea the ships lie about the heart of the map, the company's on the side it comes from
  if ( afloat ) {
    const [own, foe] = layShips(draft, { heart, before: C >= R ? from.i < heart.i : from.j < heart.j });
    from = own.deck;
    goal = foe.helm;
  }
  else if ( kind === "capital" ) {
    blocks(Math.round(C * 0.33), Math.round(R * 0.36));
    keep(2, 2);
  }
  else if ( kind === "town" ) {
    blocks(Math.round(C * 0.24), Math.round(R * 0.27));

    // The square, with a hedge to rest by, and the garrison among the houses
    for ( let di = -1; di <= 1; di++ ) {
      for ( let dj = -1; dj <= 1; dj++ ) if ( dryAt(heart.i + di, heart.j + dj) ) lay(draft, heart.i + di, heart.j + dj, "plain", 0);
    }
    lay(draft, heart.i - 1, heart.j - 1, "healhedge", 0);
    near(1, "fort", 6, { over: ["house"] });
    goal = heart;
  }
  else if ( kind === "fort" ) {
    const hw = Math.min(Math.max(Math.round(C * 0.15), 3), 6);
    const hh = Math.min(Math.max(Math.round(R * 0.18), 2), 4);
    const walls = keep(hw, hh);
    const outside = (i, j) => (i < walls.top - 1) || (i > walls.bottom + 1) || (j < walls.left - 1) || (j > walls.right + 1);
    near(between(random, 3, 5), "cover", Math.max(hw, hh) + 3, { where: outside });
    near(between(random, 1, 2), "house", Math.max(hw, hh) + 5, { where: outside });
  }
  else if ( kind === "port" ) {
    near(between(random, 6, 9), "house", 5);
    near(1, "fort", 3);

    // The jetty: out over the water from the shore nearest the heart of the port
    let shore = null;
    for ( let i = 0; i < R; i++ ) {
      for ( let j = 0; j < C; j++ ) {
        if ( !dryAt(i, j) ) continue;
        const step = STEPS.find(([di, dj]) => onMap(draft, i + di, j + dj) && (draft.tiles[i + di][j + dj] === "water"));
        const far = Math.hypot(i - heart.i, j - heart.j);
        if ( step && (!shore || (far < shore.far)) ) shore = { i, j, far, step };
      }
    }
    for ( let n = 1; shore && (n <= 3); n++ ) {
      const [i, j] = [shore.i + (shore.step[0] * n), shore.j + (shore.step[1] * n)];
      if ( !onMap(draft, i, j) || (draft.tiles[i][j] !== "water") ) break;
      lay(draft, i, j, "deck", 0);
    }
    goal = heart;
  }
  else if ( kind === "village" ) {
    near(between(random, 5, 8), "house", 4);
    near(1, "healhedge", 3);
    goal = heart;
  }
  else if ( kind === "ruins" ) {
    for ( let ruin = 0; ruin < 3; ruin++ ) {
      const i = heart.i + between(random, -4, 3);
      const j = heart.j + between(random, -5, 4);
      for ( let di = 0; di < 3; di++ ) {
        for ( let dj = 0; dj < 3; dj++ ) if ( (random() < 0.45) && open(i + di, j + dj) ) lay(draft, i + di, j + dj, "cover", 0);
      }
    }
    lay(draft, heart.i, heart.j, "fort", 0);
    goal = heart;
  }
  else {
    dot(draft, 1, "house");
    if ( random() < 0.6 ) dot(draft, 1, "fort");
  }

  // Where the battle leads: the heart of the place, or the road out on the far side
  let to = goal;
  if ( !to ) {
    const far = exits.filter((exit) => !exit.company && (exit.kind !== "sea"))
      .sort((x, y) => Math.hypot(y.tile.i - from.i, y.tile.j - from.j) - Math.hypot(x.tile.i - from.i, x.tile.j - from.j))[0];
    to = far ? far.tile : { i: R - 1 - from.i, j: C - 1 - from.j };
  }

  // Both ends are on ground a unit on foot can stand on: a company that comes by sea lands on the nearest shore
  const landing = (tile) => {
    if ( walkable(draft.tiles[tile.i]?.[tile.j]) ) return tile;
    let best = null;
    for ( let i = 0; i < R; i++ ) {
      for ( let j = 0; j < C; j++ ) {
        if ( !walkable(draft.tiles[i][j]) ) continue;
        const far = Math.hypot(i - tile.i, j - tile.j);
        if ( !best || (far < best.far) ) best = { i, j, far };
      }
    }
    return best ? { i: best.i, j: best.j } : tile;
  };
  from = landing(from);
  to = landing(to);
  for ( const { i, j } of [from, to] ) if ( !walkable(draft.tiles[i][j]) ) lay(draft, i, j, FEO.terrain.default, 0);
  openWay(draft, from, to);
  return {
    type: "land", seed: String(seed), ...size, tiles: draft.tiles, heights: draft.heights, ends: { from, to },
    lens, lie: lieOf(read), exits, tracks, afloat
  };
}

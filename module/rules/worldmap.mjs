import { FEO } from "../config.mjs";
import { seededRandom } from "./mapgen.mjs";

/**
 * The World Map: the land a campaign is set in. A map is a painted land, the ground each nation holds, a dot for
 * each place and the routes between them. The company stands on one place and goes from place to place along
 * the routes.
 *
 * The land is made from a shape and a seed, and the same two always give the same land, so it is never kept:
 * it is made again wherever the map is shown. What is kept is everything laid over it, which can all be changed
 * by hand: the nations and the ground they hold, the places, the routes, and where the company is.
 *
 * Everything here works on numbers alone and touches nothing of Foundry or of a page. Keeping the map in the
 * world is the work of `helpers/worldmap.mjs`, and drawing it that of `apps/world-map-draw.mjs`.
 *
 * @typedef Land
 * The land of a map, a value for each point of it, row by row.
 * @property {string} key             What it was made from
 * @property {number} width
 * @property {number} height
 * @property {boolean} picture        Is it a picture of the Game Master's own? Then all of it counts as land
 * @property {Uint8Array} land        1 where there is land, 0 where there is sea
 * @property {Uint8Array} high        1 for hills, 2 for mountains
 * @property {Uint8Array} wood        1 where woods stand
 * @property {Uint8ClampedArray} paint    The colour of each point with nobody holding it: red, green, blue
 * @property {{kind: "peak"|"hill"|"tree", x: number, y: number, size: number}[]} marks   What is inked over it
 *
 * @typedef Nation
 * @property {number} id              From 1, which is also its number on the ground it holds
 * @property {string} name
 * @property {string} style           One of FEO.worldMap.styles
 * @property {number} color           Which of FEO.worldMap.colors it is drawn in
 *
 * @typedef Place
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {string} kind            One of FEO.worldMap.kinds
 * @property {string} name
 * @property {boolean} seen           Is it shown to the players?
 * @property {boolean} visited        Has the company been there?
 * @property {boolean} battle         Is a battle waiting there?
 * @property {string} encounter       The saved encounter of that battle, if it has one
 * @property {boolean} market
 *
 * @typedef Route
 * @property {string} a               The place at one end
 * @property {string} b               The place at the other
 * @property {"road"|"sea"} kind
 * @property {number} bend            How far it bows to one side, as a share of its length
 *
 * @typedef WorldMapState
 * What a world keeps of its map.
 * @property {boolean} made           Has a map been made yet?
 * @property {string} name
 * @property {string} backdrop        The picture it is drawn over, blank for a land that is made
 * @property {string} seed
 * @property {string} shape           A key of FEO.worldMap.shapes
 * @property {string} density         A key of FEO.worldMap.density
 * @property {number} turn            How many times the nations and places were made again on the same land
 * @property {Nation[]} nations
 * @property {string} claims          Whose ground each point is, packed (see `packClaims`)
 * @property {Place[]} places
 * @property {Route[]} routes
 * @property {string} base            The place the Base is at
 * @property {string} party           The place the company is at
 */

/* -------------------------------------------- */
/*  Noise                                       */
/* -------------------------------------------- */

/** A number from a text, the same each time. */
function numberOf(text) {
  let state = 2166136261;
  for ( const sign of String(text) ) state = Math.imul(state ^ sign.charCodeAt(0), 16777619);
  return state >>> 0;
}

/** A number from 0 up to 1 for a corner of a grid, the same each time. */
function corner(i, j, seed) {
  let mixed = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed | 0, 1274126177);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 1274126177);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise: the corners of a grid, blended between. */
function noise(x, y, seed) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - (2 * fx));
  const v = fy * fy * (3 - (2 * fy));
  const a = corner(i, j, seed);
  const b = corner(i + 1, j, seed);
  const c = corner(i, j + 1, seed);
  const d = corner(i + 1, j + 1, seed);
  return a + ((b - a) * u) + ((c - a) * v) + ((a - b - c + d) * u * v);
}

/** Noise laid over itself, each layer twice as fine and half as strong as the last. */
function layered(x, y, layers, seed) {
  let value = 0;
  let strength = 0.5;
  let scale = 1;
  let total = 0;
  for ( let n = 0; n < layers; n++ ) {
    value += strength * noise(x * scale, y * scale, seed + (n * 17));
    total += strength;
    strength *= 0.5;
    scale *= 2;
  }
  return value / total;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** From 0 to 1 as a value goes from one edge to the other, easing at both. */
function ease(from, to, value) {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - (2 * t));
}

/* -------------------------------------------- */
/*  The Land                                    */
/* -------------------------------------------- */

/**
 * How strongly each shape of land wants land at a point: 1 at its heart, falling away from it. `x` and `y` run
 * from 0 to 1 across the map, and `wide` is how many times wider the map is than high.
 */
const SHAPES = {
  continent: (x, y) => 1 - Math.hypot((2 * x) - 1, ((2 * y) - 1) / 0.92),
  twin: (x, y, wide) => Math.max(1 - (Math.hypot((x - 0.29) * wide, y - 0.45) / 0.47),
    1 - (Math.hypot((x - 0.72) * wide, y - 0.56) / 0.47)),
  inner: (x, y) => 1 - (Math.abs(Math.hypot((2 * x) - 1, ((2 * y) - 1) / 0.9) - 0.6) / 0.3),
  isles: (x, y) => 1 - Math.hypot((2 * x) - 1, (2 * y) - 1)
};

/** The colours the land is painted in. */
const PAINT = {
  grass: [178, 187, 122], wood: [124, 152, 92], dry: [217, 199, 143], cold: [216, 220, 208], hill: [190, 168, 116],
  mount: [148, 126, 100], shallow: [160, 196, 190], deep: [92, 136, 156], foam: [226, 235, 216], coast: [66, 50, 30]
};

/**
 * What a land is made from, as one text.
 * @param {{seed: string, shape: string}} chosen
 * @returns {string}
 */
export function landKey({ seed, shape }) {
  return `${seed}|${shape}`;
}

/* -------------------------------------------- */

/**
 * Make the land of a map: where there is land and sea, where it rises, where woods stand, and the colour of
 * every point of it.
 * @param {object} chosen
 * @param {string} chosen.seed
 * @param {string} chosen.shape       A key of FEO.worldMap.shapes
 * @param {object} [config]
 * @returns {Land}
 */
export function makeLand({ seed, shape }, config = FEO.worldMap) {
  const kind = shape in config.shapes ? shape : Object.keys(config.shapes)[0];
  const { grain, pull, land: share } = config.shapes[kind];
  const { width: W, height: H } = config;
  const wide = W / H;
  const key = landKey({ seed, shape: kind });
  const base = numberOf(key);
  const random = seededRandom(key);
  const pulls = SHAPES[kind];

  // How high every point lies: noise, drawn towards the shape, falling into the sea at the edges of the map
  const height = new Float32Array(W * H);
  const bendX = new Float32Array(W * H);
  const bendY = new Float32Array(W * H);
  const offX = (random() - 0.5) * 0.08;
  const offY = (random() - 0.5) * 0.08;
  for ( let y = 0, i = 0; y < H; y++ ) {
    const ny = y / H;
    for ( let x = 0; x < W; x++, i++ ) {
      const nx = x / W;
      const u = nx * wide;
      const bx = layered((u * 2.2) + 5.1, (ny * 2.2) + 1.7, 2, base + 101) - 0.5;
      const by = layered((u * 2.2) + 9.3, (ny * 2.2) + 4.2, 2, base + 202) - 0.5;
      bendX[i] = bx;
      bendY[i] = by;
      let value = layered((u * grain) + (bx * 1.2), (ny * grain) + (by * 1.2), 5, base)
        + (pulls(nx + offX + (bx * 0.14), ny + offY + (by * 0.14), wide) * pull);
      const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
      if ( edge < 0.06 ) value -= ((0.06 - edge) / 0.06) * 0.9;
      height[i] = value;
    }
  }

  // The sea stands at the height that leaves the share of land the shape asks for
  const sample = [];
  for ( let i = 0; i < height.length; i += 11 ) sample.push(height[i]);
  sample.sort((a, b) => a - b);
  const sea = sample[Math.floor(sample.length * (1 - share))];
  const top = sample.at(-1);
  const low = sample[Math.floor(sample.length * 0.05)];

  // Where it rises into ranges, and how wet it is
  const land = new Uint8Array(W * H);
  const rise = new Float32Array(W * H);
  const wet = new Float32Array(W * H);
  const rises = [];
  let slopes = 0;
  let counted = 0;
  for ( let y = 0, i = 0; y < H; y++ ) {
    const ny = y / H;
    for ( let x = 0; x < W; x++, i++ ) {
      if ( height[i] < sea ) continue;
      land[i] = 1;
      const u = (x / W) * wide;
      const up = (height[i] - sea) / (top - sea);
      const ridge = 1 - Math.abs((2 * layered((u * 4.2) + bendX[i], (ny * 4.2) + bendY[i], 3, base + 303)) - 1);
      rise[i] = (ridge * ridge * ridge * (0.35 + up) * ease(0, 0.07, up)) + (up * 0.3);
      wet[i] = layered((u * 3) + 40.5, (ny * 3) + 12.5, 3, base + 404);
      if ( i % 13 ) continue;
      rises.push(rise[i]);
      if ( (x > 1) && (y > 1) && (x < W - 2) && (y < H - 2) ) {
        const slope = height[i - W - 1] - height[i + W + 1];
        slopes += slope * slope;
        counted++;
      }
    }
  }
  rises.sort((a, b) => a - b);
  const hillAt = rises[Math.floor(rises.length * 0.8)] ?? 1;
  const mountAt = rises[Math.floor(rises.length * 0.925)] ?? 1;
  const light = 0.085 / (Math.sqrt(slopes / Math.max(counted, 1)) || 1);

  // The colour of every point: the ground by what grows on it, lit from the north-west, and the sea by its depth
  const high = new Uint8Array(W * H);
  const wood = new Uint8Array(W * H);
  const paint = new Uint8ClampedArray(W * H * 3);
  const blend = (into, colour, share) => {
    into[0] += (colour[0] - into[0]) * share;
    into[1] += (colour[1] - into[1]) * share;
    into[2] += (colour[2] - into[2]) * share;
  };
  const ink = [0, 0, 0];
  for ( let y = 0, i = 0; y < H; y++ ) {
    const ny = y / H;
    for ( let x = 0; x < W; x++, i++ ) {
      const inside = (x > 5) && (y > 5) && (x < W - 6) && (y < H - 6);
      if ( land[i] ) {
        const wooded = ease(0.5, 0.59, wet[i]);
        const dry = ease(0.43, 0.35, wet[i]) * ease(0.52, 0.72, ny);
        const cold = ease(0.2, 0.1, ny + ((wet[i] - 0.5) * 0.3));
        high[i] = rise[i] > mountAt ? 2 : rise[i] > hillAt ? 1 : 0;
        wood[i] = (wooded > 0.6) && !high[i] && (cold < 0.5) && (dry < 0.5) ? 1 : 0;
        ink[0] = PAINT.grass[0];
        ink[1] = PAINT.grass[1];
        ink[2] = PAINT.grass[2];
        blend(ink, PAINT.wood, wooded);
        blend(ink, PAINT.dry, dry);
        blend(ink, PAINT.cold, cold);
        blend(ink, PAINT.hill, ease(hillAt * 0.86, hillAt, rise[i]));
        blend(ink, PAINT.mount, ease(mountAt * 0.93, mountAt, rise[i]));
        const slope = inside ? height[i - W - 1] - height[i + W + 1] : 0;
        const lit = 1 + clamp(slope * light * (high[i] ? 1.7 : 1), -0.3, 0.3) + ((corner(x, y, 7) - 0.5) * 0.06);
        ink[0] *= lit;
        ink[1] *= lit;
        ink[2] *= lit;
        if ( inside ) {
          if ( !land[i - 1] || !land[i + 1] || !land[i - W] || !land[i + W] ) blend(ink, PAINT.coast, 1);
          else if ( !land[i - 2] || !land[i + 2] || !land[i - (2 * W)] || !land[i + (2 * W)] ) blend(ink, [0, 0, 0], 0.2);
        }
      } else {
        const depth = clamp(((sea - height[i]) / (sea - low)) * 1.25, 0, 1);
        ink[0] = PAINT.shallow[0];
        ink[1] = PAINT.shallow[1];
        ink[2] = PAINT.shallow[2];
        blend(ink, PAINT.deep, depth);
        if ( inside ) {
          if ( land[i - 2] || land[i + 2] || land[i - (2 * W)] || land[i + (2 * W)] ) blend(ink, PAINT.foam, 1);
          else if ( land[i - 5] || land[i + 5] || land[i - (5 * W)] || land[i + (5 * W)] ) blend(ink, PAINT.foam, 0.4);
          else if ( (((y + Math.floor(noise(x * 0.012, y * 0.03, 5) * 16)) % 13) === 0) && (noise(x * 0.035, y * 0.21, 6) > 0.5) ) {
            blend(ink, [255, 255, 245], 0.1);
          }
        }
        const fleck = (corner(x, y, 9) - 0.5) * 5;
        ink[0] += fleck;
        ink[1] += fleck;
        ink[2] += fleck;
      }
      paint[i * 3] = ink[0];
      paint[(i * 3) + 1] = ink[1];
      paint[(i * 3) + 2] = ink[2];
    }
  }

  // What is inked over the paint: peaks, hills and trees, the ones further up the map first
  const marks = [];
  const spot = (fromX, fromY, stepX, stepY, shake) => {
    const found = [];
    for ( let gy = fromY; gy < H - 6; gy += stepY ) {
      for ( let gx = fromX; gx < W - 6; gx += stepX ) {
        const x = gx + Math.round((random() - 0.5) * shake);
        const y = gy + Math.round((random() - 0.5) * shake);
        found.push({ x, y, i: (y * W) + x, roll: random(), size: random() });
      }
    }
    return found;
  };
  for ( const { x, y, i, roll, size } of spot(8, 8, 16, 15, 10) ) {
    if ( !land[i] ) continue;
    if ( high[i] === 2 ) marks.push({ kind: "peak", x, y, size: 0.8 + (size * 0.7) });
    else if ( (high[i] === 1) && (roll < 0.5) ) marks.push({ kind: "hill", x, y, size: 0.8 + (size * 0.5) });
  }
  for ( const { x, y, i, roll, size } of spot(6, 6, 9, 9, 7) ) {
    if ( land[i] && wood[i] && (roll < 0.72) ) marks.push({ kind: "tree", x, y, size: 0.8 + (size * 0.5) });
  }
  marks.sort((a, b) => a.y - b.y);

  return { key, width: W, height: H, picture: false, land, high, wood, paint, marks };
}

/* -------------------------------------------- */

/**
 * The land of a map that is drawn over a picture: all of it can be painted and built on, and nothing is inked
 * over it.
 * @param {string} key                        What tells this picture from another
 * @param {Uint8ClampedArray|number[]} pixels     The picture at the size of the map: red, green, blue, alpha
 * @param {object} [config]
 * @returns {Land}
 */
export function pictureLand(key, pixels, config = FEO.worldMap) {
  const { width: W, height: H } = config;
  const paint = new Uint8ClampedArray(W * H * 3);
  for ( let i = 0; i < W * H; i++ ) {
    paint[i * 3] = pixels[i * 4];
    paint[(i * 3) + 1] = pixels[(i * 4) + 1];
    paint[(i * 3) + 2] = pixels[(i * 4) + 2];
  }
  return {
    key, width: W, height: H, picture: true, land: new Uint8Array(W * H).fill(1), high: new Uint8Array(W * H),
    wood: new Uint8Array(W * H), paint, marks: []
  };
}

/* -------------------------------------------- */

/**
 * Is there land at a point?
 * @param {Land} land
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function isLand(land, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  return (px >= 0) && (py >= 0) && (px < land.width) && (py < land.height) && !!land.land[(py * land.width) + px];
}

/** Is the sea within a short way of a point? */
function nearSea(land, x, y, reach) {
  for ( let turn = 0; turn < 8; turn++ ) {
    if ( !isLand(land, x + (Math.cos(turn * 0.785) * reach), y + (Math.sin(turn * 0.785) * reach)) ) return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Names                                       */
/* -------------------------------------------- */

const NAME_STARTS = [
  "Al", "Bel", "Cor", "Dun", "Fal", "Hal", "Kar", "Lor", "Mar", "Nor", "Or", "Sil", "Val", "Wyn", "Thra", "Ver", "Bry",
  "Mer", "Eld", "Rhy", "Aur", "Dor", "Sar", "Tir", "Hes", "Quen", "Ith"
];
const NAME_MIDDLES = ["a", "e", "i", "o", "an", "en", "ar", "or", "el", "ae", "ou", "and", "eth"];
const NATION_ENDS = ["ia", "or", "ar", "en", "eth", "oth", "ane", "ora", "una", "ys"];
const PLACE_ENDS = [
  "nor", "heim", "gard", "mont", "vale", "ford", "wick", "stead", "burg", "holm", "ton", "mere", "crest", "fell", "moor",
  "den", "hollow", "reach", "watch", "brook"
];

/** Names that belong to lands of the Fire Emblem games, which a made-up land is not given. */
const TAKEN = new Set([
  "maria", "altea", "valla", "bern", "ilia", "renais", "grado", "daein", "crimea", "nohr", "ylisse", "valm", "plegia",
  "elibe", "tellius", "magvel", "archanea", "jugdral", "fodlan", "elyos", "valentia", "aurelis", "talys", "macedon",
  "ostia", "sacae", "etruria", "pherae", "thracia", "silesse", "verdane", "lycia"
]);

/**
 * A made-up name.
 * @param {() => number} random
 * @param {"nation"|"place"} [kind]
 * @returns {string}
 */
export function madeName(random, kind = "place") {
  const ends = kind === "nation" ? NATION_ENDS : PLACE_ENDS;
  const pick = (list) => list[Math.floor(random() * list.length)];
  for ( let tries = 0; tries < 20; tries++ ) {
    const start = pick(NAME_STARTS);
    const end = pick(ends);
    const name = random() < 0.5 ? start + end : start + pick(NAME_MIDDLES) + end;
    if ( (name.length <= 10) && !TAKEN.has(name.toLowerCase()) && !/(.)\1\1|aa|ii|uu|[aeiou]{3}/i.test(name) ) return name;
  }
  return "Avenmoor";
}

/* -------------------------------------------- */

/**
 * The name of a place of a kind. `phrase` puts a made-up name into the words of the reader's language: it is
 * given `port.0`, `port.1`, `fort.0`, `fort.1` or `ruins` and the name.
 * @param {() => number} random
 * @param {string} kind
 * @param {(key: string, name: string) => string} [phrase]
 * @returns {string}
 */
export function placeName(random, kind, phrase = (key, name) => name) {
  const name = madeName(random);
  const which = random() < 0.5 ? 0 : 1;
  if ( (kind === "port") || (kind === "fort") ) return phrase(`${kind}.${which}`, name);
  if ( kind === "ruins" ) return phrase("ruins", name);
  return name;
}

/* -------------------------------------------- */
/*  Whose Ground                                */
/* -------------------------------------------- */

/**
 * Pack whose ground each point is into a text: runs of the same nation, each a letter for the nation (A for
 * nobody's) and how long the run is.
 * @param {Uint8Array} claims
 * @returns {string}
 */
export function packClaims(claims) {
  const runs = [];
  for ( let i = 0; i < claims.length; ) {
    const value = claims[i];
    let end = i + 1;
    while ( (end < claims.length) && (claims[end] === value) ) end++;
    runs.push(String.fromCharCode(65 + value) + (end - i).toString(36));
    i = end;
  }
  return runs.join("");
}

/* -------------------------------------------- */

/**
 * Whose ground each point is, from the text it was packed into. A text that is short leaves the rest nobody's.
 * @param {string} text
 * @param {number} size           How many points the map has
 * @param {number} [most]         The highest nation there can be
 * @returns {Uint8Array}
 */
export function unpackClaims(text, size, most = FEO.worldMap.nations.most) {
  const claims = new Uint8Array(size);
  let at = 0;
  for ( const [, sign, run] of String(text ?? "").matchAll(/([A-Z])([0-9a-z]+)/g) ) {
    if ( at >= size ) break;
    const length = Math.min(parseInt(run, 36), size - at);
    const nation = sign.charCodeAt(0) - 65;
    if ( nation && (nation <= most) ) claims.fill(nation, at, at + length);
    at += length;
  }
  return claims;
}

/* -------------------------------------------- */

/**
 * The nation that holds the ground at a point: its number, or 0 for the sea and for land nobody holds.
 * @param {Land} land
 * @param {Uint8Array} claims
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function nationAt(land, claims, x, y) {
  return isLand(land, x, y) ? claims[(Math.round(y) * land.width) + Math.round(x)] : 0;
}

/* -------------------------------------------- */

/**
 * Paint the land around a point into a nation, or into nobody's. The sea takes no paint.
 * @param {Land} land
 * @param {Uint8Array} claims         Changed in place
 * @param {number} x
 * @param {number} y
 * @param {number} reach              How far from the point the brush paints
 * @param {number} nation             0 for nobody's
 * @returns {{x0: number, y0: number, x1: number, y1: number}}   The part of the map that may have changed
 */
export function paintClaims(land, claims, x, y, reach, nation) {
  const { width: W, height: H } = land;
  const x0 = Math.max(0, Math.floor(x - reach));
  const y0 = Math.max(0, Math.floor(y - reach));
  const x1 = Math.min(W - 1, Math.ceil(x + reach));
  const y1 = Math.min(H - 1, Math.ceil(y + reach));
  for ( let py = y0; py <= y1; py++ ) {
    for ( let px = x0; px <= x1; px++ ) {
      const i = (py * W) + px;
      if ( land.land[i] && ((((px - x) ** 2) + ((py - y) ** 2)) <= (reach * reach)) ) claims[i] = nation;
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/* -------------------------------------------- */

/**
 * What there is to say of each nation's ground: how much of it there is, where its middle lies, and how many
 * places stand on it.
 * @param {Land} land
 * @param {Uint8Array} claims
 * @param {Nation[]} nations
 * @param {Place[]} [places]
 * @returns {Map<number, {area: number, x: number, y: number, places: number}>}    By the nation's number
 */
export function nationFacts(land, claims, nations, places = []) {
  const { width: W, height: H } = land;
  const sums = new Map(nations.map((nation) => [nation.id, { count: 0, x: 0, y: 0, places: 0 }]));
  for ( let y = 0; y < H; y += 4 ) {
    for ( let x = 0; x < W; x += 4 ) {
      const i = (y * W) + x;
      const sum = land.land[i] ? sums.get(claims[i]) : null;
      if ( !sum ) continue;
      sum.count++;
      sum.x += x;
      sum.y += y;
    }
  }
  for ( const place of places ) {
    const sum = sums.get(nationAt(land, claims, place.x, place.y));
    if ( sum ) sum.places++;
  }
  return new Map([...sums].map(([id, { count, x, y, places: held }]) => {
    return [id, { area: count * 16, x: count ? x / count : 0, y: count ? y / count : 0, places: held }];
  }));
}

/* -------------------------------------------- */
/*  Routes                                      */
/* -------------------------------------------- */

/** How much of the straight line between two points is sea, and how much is mountain. */
function crossing(land, a, b) {
  let sea = 0;
  let mount = 0;
  for ( let step = 1; step < 24; step++ ) {
    const x = Math.round(a.x + (((b.x - a.x) * step) / 24));
    const y = Math.round(a.y + (((b.y - a.y) * step) / 24));
    const i = (y * land.width) + x;
    if ( !land.land[i] ) sea++;
    else if ( land.high[i] === 2 ) mount++;
  }
  return { sea: sea / 23, mount: mount / 23 };
}

/**
 * The kind of route that joins two places: a sea lane where most of the way is water, a road otherwise.
 * @param {Land} land
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {"road"|"sea"}
 */
export function routeKind(land, a, b) {
  return crossing(land, a, b).sea > 0.3 ? "sea" : "road";
}

/** Do two straight lines cross? Lines that share an end do not. */
function linesCross(a, b, c, d) {
  if ( (a === c) || (a === d) || (b === c) || (b === d) ) return false;
  const side = (p, q, r) => Math.sign(((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x)));
  return (side(a, b, c) !== side(a, b, d)) && (side(c, d, a) !== side(c, d, b));
}

/**
 * Join every place to the others: the shortest set of routes that reaches them all, counting water and
 * mountains as longer than they are, and then a few more where the way round would be long.
 * @param {Land} land
 * @param {Place[]} places
 * @param {number} apart              How far apart places were kept
 * @param {() => number} random
 * @returns {Route[]}
 */
export function joinPlaces(land, places, apart, random) {
  const pairs = [];
  for ( let i = 0; i < places.length; i++ ) {
    for ( let j = i + 1; j < places.length; j++ ) {
      const length = Math.hypot(places[i].x - places[j].x, places[i].y - places[j].y);
      const { sea, mount } = crossing(land, places[i], places[j]);
      pairs.push({ i, j, length, sea, cost: length * (1 + (3.2 * sea) + (1.3 * mount)) });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const group = places.map((place, n) => n);
  const groupOf = (n) => (group[n] === n ? n : (group[n] = groupOf(group[n])));
  const route = (pair) => ({
    a: places[pair.i].id, b: places[pair.j].id, kind: pair.sea > 0.3 ? "sea" : "road", bend: (random() - 0.5) * 0.24
  });
  const routes = [];
  for ( const pair of pairs ) {
    if ( groupOf(pair.i) === groupOf(pair.j) ) continue;
    group[groupOf(pair.i)] = groupOf(pair.j);
    routes.push(route(pair));
    pair.used = true;
  }
  const at = new Map(places.map((place) => [place.id, place]));
  for ( const pair of pairs ) {
    if ( pair.used || (pair.length > apart * 1.8) || (pair.sea > 0.12) ) continue;
    if ( routes.some((other) => linesCross(places[pair.i], places[pair.j], at.get(other.a), at.get(other.b))) ) continue;
    const way = pathBetween({ places, routes }, places[pair.i].id, places[pair.j].id);
    if ( way && (way.length > pair.length * 2.3) ) routes.push(route(pair));
  }
  return routes;
}

/* -------------------------------------------- */

/**
 * The places a route away from a place, each with the route that leads to it.
 * @param {{places: Place[], routes: Route[]}} map
 * @param {string} id
 * @returns {{id: string, route: Route}[]}
 */
export function neighbours(map, id) {
  const found = [];
  for ( const route of map.routes ) {
    if ( route.a === id ) found.push({ id: route.b, route });
    else if ( route.b === id ) found.push({ id: route.a, route });
  }
  return found;
}

/* -------------------------------------------- */

/**
 * How many routes each place is from a place, for every place that can be reached from it.
 * @param {{places: Place[], routes: Route[]}} map
 * @param {string} from
 * @returns {Map<string, number>}
 */
export function stopsFrom(map, from) {
  const stops = new Map([[from, 0]]);
  const queue = [from];
  while ( queue.length ) {
    const at = queue.shift();
    for ( const next of neighbours(map, at) ) {
      if ( stops.has(next.id) ) continue;
      stops.set(next.id, stops.get(at) + 1);
      queue.push(next.id);
    }
  }
  return stops;
}

/* -------------------------------------------- */

/**
 * The shortest way from one place to another along the routes.
 * @param {{places: Place[], routes: Route[]}} map
 * @param {string} from
 * @param {string} to
 * @param {(place: Place) => boolean} [open]      Which places the way may pass through; all of them if not given
 * @returns {{stops: string[], legs: {route: Route, from: string, to: string}[], length: number}|null}
 *   The places passed, the routes taken in order, and how far it is; null where there is no way
 */
export function pathBetween(map, from, to, open = () => true) {
  const at = new Map(map.places.map((place) => [place.id, place]));
  if ( !at.has(from) || !at.has(to) ) return null;
  const far = new Map([[from, 0]]);
  const came = new Map();
  const done = new Set();
  for ( ;; ) {
    let here = null;
    let least = Infinity;
    for ( const [id, length] of far ) {
      if ( !done.has(id) && (length < least) ) {
        here = id;
        least = length;
      }
    }
    if ( here === null ) return null;
    if ( here === to ) break;
    done.add(here);
    for ( const next of neighbours(map, here) ) {
      const place = at.get(next.id);
      if ( !place || !open(place) ) continue;
      const length = least + Math.hypot(at.get(here).x - place.x, at.get(here).y - place.y);
      if ( length < (far.get(next.id) ?? Infinity) ) {
        far.set(next.id, length);
        came.set(next.id, { from: here, route: next.route });
      }
    }
  }
  const stops = [to];
  const legs = [];
  for ( let id = to; came.has(id); ) {
    const step = came.get(id);
    legs.unshift({ route: step.route, from: step.from, to: id });
    stops.unshift(step.from);
    id = step.from;
  }
  return { stops, legs, length: far.get(to) };
}

/* -------------------------------------------- */

/**
 * The point a route bows through between its two ends.
 * @param {{x: number, y: number}} a      Where it is followed from
 * @param {{x: number, y: number}} b      Where it leads
 * @param {number} bend                   The route's bend, as it is kept from its `a` to its `b`
 * @returns {{x: number, y: number}}
 */
export function routeBow(a, b, bend) {
  return { x: ((a.x + b.x) / 2) - ((b.y - a.y) * bend), y: ((a.y + b.y) / 2) + ((b.x - a.x) * bend) };
}

/* -------------------------------------------- */

/**
 * A point along a route.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {number} bend
 * @param {number} t                      From 0 at `a` to 1 at `b`
 * @returns {{x: number, y: number}}
 */
export function alongRoute(a, b, bend, t) {
  const bow = routeBow(a, b, bend);
  const s = 1 - t;
  return {
    x: (s * s * a.x) + (2 * s * t * bow.x) + (t * t * b.x),
    y: (s * s * a.y) + (2 * s * t * bow.y) + (t * t * b.y)
  };
}

/* -------------------------------------------- */
/*  Making a Map                                */
/* -------------------------------------------- */

/**
 * Make what is laid over a land: its nations and the ground each holds, its places, the routes between them,
 * and where the Base is. The same land and the same choices always give the same map.
 * @param {Land} land
 * @param {object} chosen
 * @param {string} chosen.seed
 * @param {string} chosen.shape
 * @param {number} chosen.count           How many nations
 * @param {string} chosen.density         A key of FEO.worldMap.density
 * @param {number} [chosen.turn]          How many times this was asked for again on the same land
 * @param {object} [options]
 * @param {(key: string, name: string) => string} [options.phrase]    Puts a made-up name into words: see
 *   `placeName`, and `world.<shape>` for the name of the map
 * @param {object} [options.config]
 * @returns {{name: string, nations: Nation[], claims: Uint8Array, places: Place[], routes: Route[], base: string,
 *   party: string}}
 */
export function makeWorld(land, { seed, shape, count, density, turn = 0 }, { phrase = (key, name) => name, config = FEO.worldMap } = {}) {
  const { width: W, height: H } = land;
  const random = seededRandom(`${seed}|${shape}|${count}|${density}|${turn}`);
  const spread = config.density[density] ?? config.density.settled;
  const total = clamp(Math.floor(Number(count) || 0), config.nations.least, config.nations.most);
  const name = phrase(`world.${shape in config.shapes ? shape : "continent"}`, madeName(random, "nation"));
  const claims = new Uint8Array(W * H);

  // Capitals stand on low ground away from the coast, as far from one another as the land allows
  const open = [];
  for ( let tries = 0; (tries < 9000) && (open.length < 700); tries++ ) {
    const x = Math.round(40 + (random() * (W - 80)));
    const y = Math.round(40 + (random() * (H - 80)));
    if ( isLand(land, x, y) && (land.high[(y * W) + x] < 2) && !nearSea(land, x, y, 16) ) open.push({ x, y });
  }
  for ( let tries = 0; (tries < 9000) && (open.length < total); tries++ ) {
    const x = Math.round(20 + (random() * (W - 40)));
    const y = Math.round(20 + (random() * (H - 40)));
    if ( isLand(land, x, y) ) open.push({ x, y });
  }
  if ( !open.length ) return { name, nations: [], claims, places: [], routes: [], base: "", party: "" };
  const capitals = [open[Math.floor(random() * open.length)]];
  while ( (capitals.length < total) && (capitals.length < open.length) ) {
    let best = null;
    let furthest = -1;
    for ( const spot of open ) {
      let nearest = Infinity;
      for ( const capital of capitals ) nearest = Math.min(nearest, Math.hypot(spot.x - capital.x, spot.y - capital.y));
      nearest *= 0.85 + (random() * 0.3);
      if ( nearest > furthest ) {
        furthest = nearest;
        best = spot;
      }
    }
    capitals.push(best);
  }
  const styles = config.styles.map((style) => [random(), style]).sort((a, b) => a[0] - b[0]).map(([, style]) => style);
  const nations = capitals.map((capital, n) => ({
    id: n + 1, name: madeName(random, "nation"), style: styles[n % styles.length], color: n % config.colors.length
  }));

  // Land goes to the nearest capital, the borders bent by noise; land far from all of them is nobody's
  const bent = numberOf(`${seed}|borders|${turn}`);
  const wide = W / H;
  let acres = 0;
  for ( let i = 0; i < land.land.length; i += 7 ) acres += land.land[i];
  const reach = 0.86 * Math.sqrt((acres * 7) / capitals.length);
  for ( let y = 0, i = 0; y < H; y++ ) {
    for ( let x = 0; x < W; x++, i++ ) {
      if ( !land.land[i] ) continue;
      const u = (x / W) * wide;
      const v = y / H;
      const px = x + ((layered((u * 5) + 70.5, (v * 5) + 3.5, 3, bent) - 0.5) * 130);
      const py = y + ((layered((u * 5) + 11.5, (v * 5) + 90.5, 3, bent + 7) - 0.5) * 130);
      let holder = 0;
      let nearest = Infinity;
      for ( let n = 0; n < capitals.length; n++ ) {
        const far = Math.hypot(px - capitals[n].x, py - capitals[n].y);
        if ( far < nearest ) {
          nearest = far;
          holder = n + 1;
        }
      }
      claims[i] = nearest > reach ? 0 : holder;
    }
  }

  // Places: the capitals, then dots kept apart from one another, each of a kind that suits where it stands
  const places = [];
  const add = (x, y, kind) => places.push({
    id: `p${places.length + 1}`, x, y, kind, name: "", seen: false, visited: false, battle: false, encounter: "", market: false
  });
  capitals.forEach((capital, n) => {
    claims[(capital.y * W) + capital.x] = n + 1;
    add(capital.x, capital.y, "capital");
  });
  for ( let tries = 0; (tries < 6000) && (places.length < spread.most); tries++ ) {
    const x = Math.round(30 + (random() * (W - 60)));
    const y = Math.round(34 + (random() * (H - 64)));
    const i = (y * W) + x;
    const roll = random();
    if ( !land.land[i] || (land.high[i] === 2) ) continue;
    if ( places.some((place) => Math.hypot(place.x - x, place.y - y) < spread.apart) ) continue;
    if ( nearSea(land, x, y, 15) && (roll < 0.6) ) add(x, y, "port");
    else if ( !claims[i] ) add(x, y, roll < 0.7 ? "ruins" : "village");
    else if ( (land.high[i] === 1) && (roll < 0.45) ) add(x, y, "fort");
    else add(x, y, roll < 0.45 ? "town" : roll < 0.88 ? "village" : "fort");
  }
  const routes = joinPlaces(land, places, spread.apart, random);
  const at = new Map(places.map((place) => [place.id, place]));
  for ( const route of routes ) {
    if ( route.kind !== "sea" ) continue;
    for ( const id of [route.a, route.b] ) if ( at.get(id).kind !== "capital" ) at.get(id).kind = "port";
  }
  for ( const place of places ) {
    place.name = placeName(random, place.kind, phrase);
    place.market = config.market.includes(place.kind);
  }

  // The Base is at the place nearest the first nation's capital, and the players know the land around it
  const home = places[0];
  const base = places.filter((place) => (place !== home) && (place.kind !== "ruins") && (nationAt(land, claims, place.x, place.y) === 1))
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0] ?? home;
  base.visited = true;
  const stops = stopsFrom({ places, routes }, base.id);
  for ( const place of places ) place.seen = (place.kind === "capital") || ((stops.get(place.id) ?? Infinity) <= config.known);
  return { name, nations, claims, places, routes, base: base.id, party: base.id };
}

/* -------------------------------------------- */
/*  What a World Keeps                          */
/* -------------------------------------------- */

/**
 * A map as a world keeps it, with anything missing or out of place put right.
 * @param {object} [raw]
 * @param {object} [config]
 * @returns {WorldMapState}
 */
export function cleanWorldMap(raw = {}, config = FEO.worldMap) {
  raw ??= {};
  const text = (value) => String(value ?? "").trim();
  const whole = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);
  const nations = [];
  for ( const nation of Array.isArray(raw.nations) ? raw.nations : [] ) {
    const id = whole(nation?.id);
    if ( (id < 1) || (id > config.nations.most) || nations.some((other) => other.id === id) ) continue;
    nations.push({
      id,
      name: text(nation.name),
      style: config.styles.includes(nation.style) ? nation.style : config.styles[0],
      color: clamp(whole(nation.color, id - 1), 0, config.colors.length - 1)
    });
  }
  nations.sort((a, b) => a.id - b.id);

  const places = [];
  const ids = new Set();
  for ( const place of Array.isArray(raw.places) ? raw.places : [] ) {
    const id = text(place?.id);
    if ( !id || ids.has(id) ) continue;
    ids.add(id);
    places.push({
      id,
      x: clamp(whole(place.x), 0, config.width - 1),
      y: clamp(whole(place.y), 0, config.height - 1),
      kind: config.kinds.includes(place.kind) ? place.kind : "village",
      name: text(place.name),
      seen: !!place.seen,
      visited: !!place.visited,
      battle: !!place.battle,
      encounter: text(place.encounter),
      market: !!place.market
    });
  }

  const routes = [];
  const joined = new Set();
  for ( const route of Array.isArray(raw.routes) ? raw.routes : [] ) {
    const a = text(route?.a);
    const b = text(route?.b);
    const pair = [a, b].sort().join("|");
    if ( !ids.has(a) || !ids.has(b) || (a === b) || joined.has(pair) ) continue;
    joined.add(pair);
    routes.push({ a, b, kind: route.kind === "sea" ? "sea" : "road", bend: clamp(Number(route.bend) || 0, -0.3, 0.3) });
  }

  const base = ids.has(text(raw.base)) ? text(raw.base) : (places[0]?.id ?? "");
  return {
    made: !!raw.made,
    name: text(raw.name),
    backdrop: text(raw.backdrop),
    seed: text(raw.seed),
    shape: raw.shape in config.shapes ? raw.shape : Object.keys(config.shapes)[0],
    density: raw.density in config.density ? raw.density : "settled",
    turn: Math.max(whole(raw.turn), 0),
    nations,
    claims: text(raw.claims),
    places,
    routes,
    base,
    party: ids.has(text(raw.party)) ? text(raw.party) : base
  };
}

/* -------------------------------------------- */

/**
 * The company arrives at a place: it has been there now, the players are shown it, and they are shown the
 * places a route away from it.
 * @param {WorldMapState} map         Changed in place
 * @param {string} id
 * @returns {WorldMapState}
 */
export function arriveAt(map, id) {
  const place = map.places.find((other) => other.id === id);
  if ( !place ) return map;
  map.party = id;
  place.seen = true;
  place.visited = true;
  const near = new Set(neighbours(map, id).map((next) => next.id));
  for ( const other of map.places ) if ( near.has(other.id) ) other.seen = true;
  return map;
}

/* -------------------------------------------- */

/**
 * Take a place off the map, with the routes that led to it. The Base and the company move to another place if
 * they were there.
 * @param {WorldMapState} map         Changed in place
 * @param {string} id
 * @returns {WorldMapState}
 */
export function removePlace(map, id) {
  map.places = map.places.filter((place) => place.id !== id);
  map.routes = map.routes.filter((route) => (route.a !== id) && (route.b !== id));
  if ( map.base === id ) map.base = map.places[0]?.id ?? "";
  if ( map.party === id ) map.party = map.base;
  return map;
}

/* -------------------------------------------- */

/**
 * Join two places with a route, or take away the route that joins them.
 * @param {Land} land
 * @param {WorldMapState} map         Changed in place
 * @param {string} a
 * @param {string} b
 * @param {() => number} [random]
 * @returns {boolean}                 Are they joined now?
 */
export function toggleRoute(land, map, a, b, random = Math.random) {
  const from = map.places.find((place) => place.id === a);
  const to = map.places.find((place) => place.id === b);
  if ( !from || !to || (from === to) ) return false;
  const at = map.routes.findIndex((route) => ((route.a === a) && (route.b === b)) || ((route.a === b) && (route.b === a)));
  if ( at >= 0 ) {
    map.routes.splice(at, 1);
    return false;
  }
  map.routes.push({ a, b, kind: routeKind(land, from, to), bend: (random() - 0.5) * 0.2 });
  return true;
}

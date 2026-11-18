/**
 * Skills used as an action that take in an area of the map: which tiles the area covers, where it may be
 * placed, and which units it catches. Pure functions of plain data, so that they can be tested outside of
 * Foundry; the map is handed in as functions.
 *
 * A skill used as an action (see `actions.mjs`) says so with an `area` in its `act` part, in place of the
 * `target` of a skill that is used on one unit:
 *
 *   act: {
 *     area: {
 *       shape: "radius", radius: 2,      // every tile at most so many spaces from its centre, counted along
 *                                        // rows and columns; "square": every tile at most so many rows and
 *                                        // columns away, so that `radius: 1` is the eight tiles around the
 *                                        // centre, diagonals included, and the centre itself
 *       centre: "self",                  // where it is centred: on its unit ("self", so it is unless given), or
 *                                        // on a "tile" that whoever acts for the unit picks on the map
 *       range: { from: 1, within: 3 },   // for a tile that is picked: how far from the unit it may lie;
 *                                        // `range: "weapon"` for as far as the weapon in its hand attacks
 *       who: "enemy",                    // whom it catches: its unit's "enemy" units, its "ally" units, or "any"
 *       self: true,                      // its own unit is caught as well, where it stands in the area
 *       only: { quality: ["Terror"], ranks: ["dark"] }
 *                                        // only units with one of these Special Qualities, or a rank in one of
 *                                        // these proficiencies
 *     },
 *     ...                                // what each unit caught gets, as `act` says it of one unit
 *   }
 *
 * Other shapes:
 *
 *   shape: "line", reach: 3              // a straight line from the unit through a unit next to it that is
 *                                        // picked on the map, for so many tiles; `reach: "units"` for as long as
 *                                        // one unit it catches stands behind the other
 *   shape: "sight"                       // every tile the unit has in its Line of Sight (see `sight.mjs`)
 *   shape: "map"                         // the whole map
 *
 * The map paints the area before the skill is used: around the unit itself it is there to be confirmed with a
 * click, and one that is centred on a tile or runs through a unit follows the pointer until a click places it.
 *
 * @import {Tile} from "./reach.mjs"
 */
import { FEO } from "../config.mjs";
import { hasQuality } from "./positions.mjs";
import { tileKey, tilesApart } from "./reach.mjs";
import { sightTiles } from "./sight.mjs";

/** The shapes an area can have. */
export const AREA_SHAPES = ["radius", "square", "line", "sight", "map"];

/** Where an area is centred: on the unit itself, on a tile that is picked, or along a unit that is. */
export const AREA_CENTRES = ["self", "tile", "unit"];

/** What an `area` can say. */
export const AREA_PARTS = ["shape", "radius", "centre", "range", "who", "self", "only", "reach"];

/** The range of an area that may be placed as far away as the weapon in its unit's hand attacks. */
export const WEAPON_RANGE = "weapon";

/** A line that runs on for as long as the units it catches stand one behind the other. */
export const LINE_UNITS = "units";

/**
 * @typedef AreaUnit
 * A unit on the map, as an area asks about it.
 * @property {string} id
 * @property {Tile} tile
 * @property {"self"|"friend"|"foe"|"apart"} relation     How it stands to the unit that uses the skill
 * @property {string} [qualities]         Its Special Qualities, as free text
 * @property {string[]} [ranks]           The proficiencies it has a rank in
 */

/**
 * @typedef AreaField
 * The map, as an area is laid on it.
 * @property {(tile: Tile) => boolean} [inside]     Is the tile on the map?
 * @property {(tile: Tile) => boolean} [holds]      For a line: does a unit the area catches stand on the tile?
 * @property {number} [los]                         For "sight": the LoS of the unit that uses the skill
 * @property {import("./sight.mjs").SightField} [sight]   For "sight": the map as sight crosses it
 */

/* -------------------------------------------- */
/*  Where It Lies                               */
/* -------------------------------------------- */

/**
 * Where an area is centred: one that runs along a line through a unit that is picked, one that is read from
 * the unit's sight or takes in the whole map on the unit itself, any other as it says.
 * @param {object|null} area
 * @returns {"self"|"tile"|"unit"}
 */
export function areaCentre(area) {
  if ( area?.shape === "line" ) return "unit";
  if ( (area?.shape === "sight") || (area?.shape === "map") ) return "self";
  return (area?.centre === "tile") ? "tile" : "self";
}

/* -------------------------------------------- */

/**
 * The tiles an area may be centred on, for one that is centred on a tile picked on the map: those as far from
 * the unit as its range says.
 * @param {object} area
 * @param {Tile} origin                             Where the unit that uses the skill stands
 * @param {(tile: Tile) => boolean} [inside]        Is a tile on the map?
 * @returns {Tile[]}
 */
export function areaCentres(area, origin, inside = null) {
  if ( !origin || (areaCentre(area) !== "tile") || (area.range === WEAPON_RANGE) ) return [];
  const within = Math.max(area.range?.within ?? 1, 0);
  const from = Math.max(area.range?.from ?? 0, 0);
  const tiles = [];
  for ( let di = -within; di <= within; di++ ) {
    const across = within - Math.abs(di);
    for ( let dj = -across; dj <= across; dj++ ) {
      const tile = { i: origin.i + di, j: origin.j + dj };
      if ( (Math.abs(di) + Math.abs(dj)) < from ) continue;
      if ( !inside || inside(tile) ) tiles.push(tile);
    }
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * A straight line from a unit through a tile next to it, along a row or a column.
 * @param {Tile} origin                     Where the unit stands
 * @param {Tile} through                    The tile next to it that the line runs through
 * @param {object} [options]
 * @param {number|"units"} [options.reach]  How many tiles it runs for; "units" for as long as each next tile
 *                                          holds a unit the area catches
 * @param {(tile: Tile) => boolean} [options.holds]     Does such a unit stand on a tile?
 * @param {(tile: Tile) => boolean} [options.inside]    Is a tile on the map?
 * @returns {{tiles: Tile[], beyond: Tile|null}}    Its tiles from the nearest on, and the first tile past them;
 *                                          no tiles for two tiles that do not lie next to each other, and no
 *                                          tile past them where the map ends
 */
export function lineArea(origin, through, { reach = 1, holds = null, inside = null } = {}) {
  if ( !origin || !through || (tilesApart(origin, through) !== 1) ) return { tiles: [], beyond: null };
  const di = through.i - origin.i;
  const dj = through.j - origin.j;
  const on = (tile) => !inside || inside(tile);
  const at = (n) => ({ i: origin.i + (di * n), j: origin.j + (dj * n) });
  const tiles = [];
  let n = 1;
  if ( reach === LINE_UNITS ) {
    while ( on(at(n)) && !!holds?.(at(n)) ) tiles.push(at(n++));
  }
  else {
    const most = Math.max(Math.floor(Number(reach) || 0), 0);
    while ( (n <= most) && on(at(n)) ) tiles.push(at(n++));
  }
  const beyond = at(n);
  return { tiles, beyond: (tiles.length && on(beyond)) ? beyond : null };
}

/* -------------------------------------------- */

/**
 * The tiles an area covers.
 * @param {object} area
 * @param {Tile} origin               Where the unit that uses the skill stands
 * @param {Tile|null} [centre]        The tile it is centred on, or for a line the tile it runs through; the
 *                                    unit's own for an area around the unit
 * @param {AreaField} [field]
 * @returns {Tile[]|null}             Null for an area that is the whole map; empty where it cannot lie there
 */
export function areaTiles(area, origin, centre = null, field = {}) {
  if ( !area || !origin ) return [];
  const inside = field.inside ?? null;
  if ( area.shape === "map" ) return null;
  if ( area.shape === "sight" ) return sightTiles(origin, field.los ?? 0, { inside, ...(field.sight ?? {}) });
  if ( area.shape === "line" ) return centre ? lineArea(origin, centre, { reach: area.reach ?? 1, holds: field.holds, inside }).tiles : [];
  const middle = (areaCentre(area) === "tile") ? centre : origin;
  if ( !middle ) return [];
  const radius = Math.max(Math.floor(Number(area.radius) || 0), 0);
  const square = area.shape === "square";
  const tiles = [];
  for ( let di = -radius; di <= radius; di++ ) {
    const across = square ? radius : radius - Math.abs(di);
    for ( let dj = -across; dj <= across; dj++ ) {
      const tile = { i: middle.i + di, j: middle.j + dj };
      if ( !inside || inside(tile) ) tiles.push(tile);
    }
  }
  return tiles;
}

/* -------------------------------------------- */
/*  Whom It Catches                             */
/* -------------------------------------------- */

/**
 * Is a unit one an area catches, wherever it stands: of the side the area is for, and of the kind it asks for?
 * @param {object} area
 * @param {AreaUnit} unit
 * @returns {boolean}
 */
export function areaCatches(area, unit) {
  if ( !area || !unit ) return false;
  if ( unit.relation === "self" ) return !!area.self;
  const sides = { ally: ["friend"], enemy: ["foe"], any: ["friend", "foe", "apart"] }[area.who ?? "enemy"] ?? [];
  if ( !sides.includes(unit.relation) ) return false;
  const only = area.only;
  if ( !only ) return true;
  const quality = (only.quality ?? []).some((name) => hasQuality(unit.qualities, name));
  const rank = (only.ranks ?? []).some((key) => (unit.ranks ?? []).includes(key));
  return quality || rank;
}

/* -------------------------------------------- */

/**
 * The units an area catches: those it is for that stand on one of its tiles, the nearest to the unit that
 * uses the skill first.
 * @param {object} area
 * @param {Tile[]|null} tiles         The tiles it covers; null for the whole map
 * @param {AreaUnit[]} units          The units on the map
 * @param {Tile|null} [origin]        Where the unit that uses the skill stands
 * @returns {AreaUnit[]}
 */
export function areaUnits(area, tiles, units, origin = null) {
  const covered = tiles ? new Set(tiles.map(tileKey)) : null;
  const caught = (units ?? []).filter((unit) => unit.tile && areaCatches(area, unit) && (!covered || covered.has(tileKey(unit.tile))));
  if ( !origin ) return caught;
  return caught.map((unit, index) => ({ unit, index })).sort((a, b) => {
    return (tilesApart(origin, a.unit.tile) - tilesApart(origin, b.unit.tile)) || (a.index - b.index);
  }).map((entry) => entry.unit);
}

/* -------------------------------------------- */
/*  Shares                                      */
/* -------------------------------------------- */

/**
 * @typedef {Record<string, {hp?: number, gauge?: number}>} Shares
 * What a unit that gives up HP of its own restores to each unit it shares them among, by unit: HP, and for a
 * unit with a Shift Gauge, points of that.
 */

/**
 * What all the shares come to.
 * @param {Shares} shares
 * @returns {number}
 */
export function sharesTotal(shares) {
  return Object.values(shares ?? {}).reduce((sum, share) => sum + Math.max(share?.hp ?? 0, 0) + Math.max(share?.gauge ?? 0, 0), 0);
}

/* -------------------------------------------- */

/**
 * The HP a unit gives up for what it shares out: each restores so many times itself, and a part of one is
 * paid for in full.
 * @param {Shares} shares
 * @param {number} [gives]      What each HP given up restores
 * @returns {number}
 */
export function sharesCost(shares, gives = 2) {
  return Math.ceil(sharesTotal(shares) / Math.max(gives, 1));
}

/* -------------------------------------------- */

/**
 * What a unit may still share out: it keeps 1 HP whatever it gives.
 * @param {number} hp           The HP it has
 * @param {Shares} shares
 * @param {number} [gives]
 * @returns {number}
 */
export function sharesRoom(hp, shares, gives = 2) {
  return Math.max(((Math.max(hp, 1) - 1) * Math.max(gives, 1)) - sharesTotal(shares), 0);
}

/* -------------------------------------------- */

/**
 * Change the share of one unit: by so much, or with "fill" to all it lacks and can be given, which given to a
 * unit that already has a share takes that share away again.
 * @param {Shares} shares
 * @param {string} id                     The unit
 * @param {"hp"|"gauge"} kind
 * @param {number|"fill"} step
 * @param {object} about
 * @param {number} about.lacks            What the unit lacks of it: the most it can be given
 * @param {number} about.hp               The HP of the unit that shares out
 * @param {number} [about.gives]
 * @returns {Shares}
 */
export function shareWith(shares, id, kind, step, { lacks = 0, hp = 0, gives = 2 } = {}) {
  const next = Object.fromEntries(Object.entries(shares ?? {}).map(([key, share]) => [key, { ...share }]));
  const mine = next[id] ?? {};
  const has = Math.max(mine[kind] ?? 0, 0);
  let wanted;
  if ( step === "fill" ) wanted = has ? 0 : Infinity;
  else wanted = has + (Math.floor(Number(step)) || 0);
  mine[kind] = 0;
  next[id] = mine;
  const most = Math.min(Math.max(lacks, 0), sharesRoom(hp, next, gives));
  mine[kind] = Math.min(Math.max(wanted, 0), most);
  if ( !mine[kind] ) delete mine[kind];
  if ( !Object.keys(mine).length ) delete next[id];
  return next;
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check how a skill says which area it takes in, so that a typing mistake does not pass silently.
 * @param {any} area
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkArea(area) {
  if ( !area || (typeof area !== "object") || Array.isArray(area) ) return ["act: an area says its shape and whom it catches"];
  const problems = [];
  for ( const key of Object.keys(area) ) if ( !AREA_PARTS.includes(key) ) problems.push(`act: an area cannot say "${key}"`);
  if ( !AREA_SHAPES.includes(area.shape) ) problems.push(`act: the shape of an area is ${AREA_SHAPES.map((key) => `"${key}"`).join(", ")}`);
  const round = (area.shape === "radius") || (area.shape === "square");
  // One that is placed on a tile may be that tile alone
  const least = (area.centre === "tile") ? 0 : 1;
  if ( round && !(Number.isInteger(area.radius) && (area.radius >= least)) ) problems.push("act: an area has a radius of 1 space or more");
  if ( !round && (area.radius !== undefined) ) problems.push("act: only a \"radius\" or a \"square\" has a radius");
  if ( area.centre !== undefined ) {
    if ( !["self", "tile"].includes(area.centre) ) problems.push("act: an area is centred on \"self\" or on a \"tile\" that is picked");
    else if ( !round ) problems.push("act: only a \"radius\" or a \"square\" says where it is centred");
  }
  if ( area.range === WEAPON_RANGE ) {
    if ( area.centre !== "tile" ) problems.push("act: only an area centred on a \"tile\" has a range");
  }
  else if ( area.range !== undefined ) {
    const range = area.range;
    const whole = (value) => Number.isInteger(value) && (value >= 0);
    if ( !range || (typeof range !== "object") || Object.keys(range).some((key) => !["from", "within"].includes(key))
      || !whole(range.within) || ((range.from !== undefined) && !whole(range.from)) || ((range.from ?? 0) > range.within) ) {
      problems.push("act: the range of an area says how far from the unit its centre may lie: { from: 1, within: 3 }");
    }
    if ( area.centre !== "tile" ) problems.push("act: only an area centred on a \"tile\" has a range");
  }
  else if ( area.centre === "tile" ) problems.push("act: an area centred on a \"tile\" says its range");
  if ( (area.who !== undefined) && !["enemy", "ally", "any"].includes(area.who) ) problems.push("act: an area catches \"enemy\" units, \"ally\" units or \"any\"");
  if ( (area.self !== undefined) && (area.self !== true) ) problems.push("act: \"self\" of an area is true or left out");
  if ( area.reach !== undefined ) {
    if ( area.shape !== "line" ) problems.push("act: only a \"line\" has a reach");
    else if ( !((area.reach === LINE_UNITS) || (Number.isInteger(area.reach) && (area.reach >= 1))) ) problems.push("act: a line reaches a number of tiles, or \"units\"");
  }
  if ( area.only !== undefined ) {
    const only = area.only;
    const listed = (list) => Array.isArray(list) && list.length && list.every((entry) => (typeof entry === "string") && entry);
    if ( !only || (typeof only !== "object") || Object.keys(only).some((key) => !["quality", "ranks"].includes(key)) || !Object.keys(only).length ) {
      problems.push("act: \"only\" lists the Special Qualities or the proficiencies a unit must have: { quality, ranks }");
    }
    else {
      if ( (only.quality !== undefined) && !listed(only.quality) ) problems.push("act: only.quality is a list of Special Qualities");
      if ( (only.ranks !== undefined) && !(listed(only.ranks) && only.ranks.every((key) => key in FEO.proficiencies)) ) problems.push("act: only.ranks is a list of proficiencies");
    }
  }
  return problems;
}

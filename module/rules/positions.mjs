/**
 * Where units stand for Fire Emblem Online: which units are allies and which are enemies of a unit, how far
 * away each one is, and what skills may ask about them. Pure functions of plain data, so that they can be
 * tested outside of Foundry; how far apart two units are is measured by a function that is handed in.
 */
import { FEO } from "../config.mjs";

/**
 * @typedef Tile
 * Where a unit stands on a square grid.
 * @property {number} i           Its top row
 * @property {number} j           Its left column
 * @property {number} [width]     Its size in tiles, 1 unless given
 * @property {number} [height]
 */

/**
 * @typedef PlacedUnit
 * A unit with a token on a map.
 * @property {string} id                  What tells its token from the others
 * @property {string} [actor]             What tells its Actor from the others, so that two tokens of one unit
 *                                        are not each other's neighbours
 * @property {string} name
 * @property {string} side                A key of FEO.armies
 * @property {Tile|null} [tile]           Null where the map has no square grid
 * @property {{terrain: string, effects: boolean}|null} [ground]      What it stands on
 * @property {boolean} [out]              Has it left the fight? Such a unit is nobody's neighbour
 * @property {number} [hp]
 * @property {number} [hpMax]
 * @property {string} [qualities]         Special Qualities, as free text
 * @property {string} [className]
 * @property {string[]} [conditions]      The conditions it suffers from
 * @property {object[]} [skills]          Its equipped skills, for the auras they give
 */

/**
 * @typedef {PlacedUnit & {relation: "ally"|"enemy"|null, distance: number}} Neighbour
 */

/**
 * @typedef Surroundings
 * What a unit has around it.
 * @property {string} id
 * @property {string} side
 * @property {Tile|null} tile
 * @property {{terrain: string, effects: boolean}|null} [ground]
 *                                    What it stands on, and whether that is terrain with effects for it; null
 *                                    where that cannot be told
 * @property {Neighbour[]} others     Every other unit on the map, nearest first
 */

/**
 * @typedef NearFilter
 * Which units around a unit a skill asks about.
 * @property {"ally"|"enemy"} who
 * @property {number} [within]        At most this many tiles away; anywhere on the map when left out
 * @property {number} [from]          At least this many tiles away
 * @property {string[]} [quality]     With any of these Special Qualities
 * @property {string[]} [class]       Of any of these classes
 * @property {number} [min]           As a condition: at least this many, 1 unless `max` is given
 * @property {number} [max]           As a condition: at most this many
 */

/* -------------------------------------------- */
/*  Sides                                       */
/* -------------------------------------------- */

/**
 * What a unit of one side is to a unit of another: sides of one camp are allies, sides of different camps are
 * enemies, and a side without a camp is neither to anybody.
 * @param {string} side
 * @param {string} other
 * @param {Record<string, string|null>} [camps]
 * @returns {"ally"|"enemy"|null}
 */
export function relationOf(side, other, camps = FEO.camps) {
  const mine = camps[side] ?? null;
  const theirs = camps[other] ?? null;
  if ( !mine || !theirs ) return null;
  return mine === theirs ? "ally" : "enemy";
}

/* -------------------------------------------- */
/*  Neighbours                                  */
/* -------------------------------------------- */

/**
 * What a unit has around it: every other unit on the map that is still in the fight, with what it is to the
 * unit and how many tiles away it stands.
 * @param {PlacedUnit[]} units                                      The units with a token on the map
 * @param {string} id                                               The unit asked about
 * @param {(a: PlacedUnit, b: PlacedUnit) => number|null} measure   Tiles between two units, null if that
 *                                                                  cannot be told
 * @returns {Surroundings|null}       Null for a unit that is not on the map
 */
export function surroundings(units, id, measure) {
  const self = (units ?? []).find((unit) => unit.id === id);
  if ( !self ) return null;
  const others = [];
  for ( const unit of units ) {
    if ( (unit === self) || unit.out || (unit.actor && (unit.actor === self.actor)) ) continue;
    const distance = measure(self, unit);
    if ( !Number.isFinite(distance) ) continue;
    others.push({ ...unit, relation: relationOf(self.side, unit.side), distance });
  }
  others.sort((a, b) => a.distance - b.distance);
  return { id: self.id, side: self.side, tile: self.tile ?? null, ground: self.ground ?? null, others };
}

/* -------------------------------------------- */

/**
 * Does a Special Quality appear in a unit's qualities, written as free text?
 * @param {string} [qualities]
 * @param {string} quality
 * @returns {boolean}
 */
export function hasQuality(qualities, quality) {
  const escaped = quality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(qualities ?? "");
}

/* -------------------------------------------- */

/**
 * Is a neighbour one of the units a skill asks about?
 * @param {Neighbour} other
 * @param {NearFilter} filter
 * @returns {boolean}
 */
export function matchesNear(other, filter) {
  if ( other.relation !== filter.who ) return false;
  if ( (filter.within != null) && (other.distance > filter.within) ) return false;
  if ( (filter.from != null) && (other.distance < filter.from) ) return false;
  if ( filter.quality?.length && !filter.quality.some((quality) => hasQuality(other.qualities, quality)) ) return false;
  if ( filter.class?.length ) {
    const name = String(other.className ?? "").trim().toLowerCase();
    if ( !filter.class.some((entry) => entry.toLowerCase() === name) ) return false;
  }
  return true;
}

/* -------------------------------------------- */

/**
 * The units around a unit that a skill asks about.
 * @param {Surroundings|null} near
 * @param {NearFilter} filter
 * @returns {Neighbour[]|null}    Null when it is not known what the unit has around it
 */
export function unitsNear(near, filter) {
  if ( !near ) return null;
  return near.others.filter((other) => matchesNear(other, filter));
}

/* -------------------------------------------- */

/**
 * How many of the units around a unit a skill asks about.
 * @param {Surroundings|null} near
 * @param {NearFilter} filter
 * @returns {number|null}     Null when it is not known what the unit has around it
 */
export function countNear(near, filter) {
  return unitsNear(near, filter)?.length ?? null;
}

/* -------------------------------------------- */

/**
 * Is a count of units what a condition asks for? At least one unless the condition says otherwise; one that
 * only gives a `max` asks for no more than that, so `max: 0` is "none".
 * @param {number|null} count
 * @param {NearFilter} filter
 * @returns {boolean}
 */
export function countHolds(count, filter) {
  if ( count === null ) return false;
  const min = filter.min ?? ((filter.max != null) ? 0 : 1);
  return (count >= min) && ((filter.max == null) || (count <= filter.max));
}

/* -------------------------------------------- */

/**
 * The units a unit and its foe both have around them that a skill asks about, counted around the foe: the
 * unit's allies (or its enemies) that stand near the unit it fights.
 * @param {Surroundings|null} near        What the unit has around it
 * @param {Surroundings|null} foeNear     What its foe has around it
 * @param {NearFilter} filter             `who` as the unit sees it, the distance as the foe does
 * @returns {Neighbour[]|null}            Null when that cannot be told
 */
export function unitsNearFoe(near, foeNear, filter) {
  if ( !near || !foeNear ) return null;
  const { who, ...rest } = filter;
  const mine = new Set(near.others.filter((other) => other.relation === who).map((other) => other.id));
  return foeNear.others.filter((other) => {
    return mine.has(other.id) && matchesNear({ ...other, relation: who }, { who, ...rest });
  });
}

/* -------------------------------------------- */
/*  Opposite Sides                              */
/* -------------------------------------------- */

const size = (tile) => ({ width: Math.max(tile.width ?? 1, 1), height: Math.max(tile.height ?? 1, 1) });

/**
 * Do two units stand on opposite sides of a third: in one row or column with it, one on each side, the second
 * of them right next to it?
 * @param {Tile} unit       The unit that asks
 * @param {Tile} middle     The unit between them
 * @param {Tile} ally       The unit on the far side
 * @returns {boolean}
 */
export function oppositeSides(unit, middle, ally) {
  // Along one axis: all three share a row (or column), the unit and the ally lie on either side of the middle
  // one, and the ally touches it
  const along = (axis, length, across, breadth) => {
    const start = middle[axis];
    const end = start + length(middle) - 1;
    const shares = (tile) => (tile[across] <= (middle[across] + breadth(middle) - 1)) && ((tile[across] + breadth(tile) - 1) >= middle[across]);
    if ( !shares(unit) || !shares(ally) ) return false;
    const before = (tile) => (tile[axis] + length(tile) - 1) < start;
    const after = (tile) => tile[axis] > end;
    const touches = (tile) => before(tile) ? ((tile[axis] + length(tile)) === start) : (tile[axis] === (end + 1));
    return ((before(unit) && after(ally)) || (after(unit) && before(ally))) && touches(ally);
  };
  const width = (tile) => size(tile).width;
  const height = (tile) => size(tile).height;
  return along("j", width, "i", height) || along("i", height, "j", width);
}

/* -------------------------------------------- */

/**
 * The allies of a unit that stand on the far side of the unit it fights.
 * @param {Surroundings|null} near        What the unit has around it
 * @param {Surroundings|null} foeNear     What its foe has around it
 * @returns {Neighbour[]|null}            Null when that cannot be told: a unit is not on the map, or the map
 *                                        has no square grid
 */
export function alliesOpposite(near, foeNear) {
  if ( !near?.tile || !foeNear?.tile ) return null;
  return near.others.filter((other) => {
    return (other.relation === "ally") && (other.id !== foeNear.id) && other.tile && oppositeSides(near.tile, foeNear.tile, other.tile);
  });
}

/* -------------------------------------------- */
/*  One Space                                   */
/* -------------------------------------------- */

/**
 * Do two units stand in the same space: is there a tile that both take up?
 * @param {Tile|null} a
 * @param {Tile|null} b
 * @returns {boolean|null}      Null when that cannot be told: a unit is not on the map, or the map has no
 *                              square grid
 */
export function sharesSpace(a, b) {
  if ( !a || !b ) return null;
  const overlaps = (from, length, other, otherLength) => (from < (other + otherLength)) && (other < (from + length));
  return overlaps(a.i, size(a).height, b.i, size(b).height) && overlaps(a.j, size(a).width, b.j, size(b).width);
}

/* -------------------------------------------- */

/**
 * Do two units stand corner to corner: one tile apart both along the rows and along the columns, so that they
 * are diagonal neighbours, which the rules count as 2 tiles apart?
 * @param {Tile|null} a
 * @param {Tile|null} b
 * @returns {boolean}     False where either has no tile
 */
export function touchesCorner(a, b) {
  if ( !a || !b ) return false;
  const gap = (start1, size1, start2, size2) => Math.max(start2 - (start1 + size1 - 1), start1 - (start2 + size2 - 1), 0);
  return (gap(a.j, Math.max(a.width ?? 1, 1), b.j, Math.max(b.width ?? 1, 1)) === 1)
    && (gap(a.i, Math.max(a.height ?? 1, 1), b.i, Math.max(b.height ?? 1, 1)) === 1);
}

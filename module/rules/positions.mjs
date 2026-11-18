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
 * @property {boolean} [untargetable]     Can no enemy make it the target of anything? (see `reachable`)
 * @property {{category: string, name?: string}[]} [carried]
 *                                        The weapons and tomes it carries and may wield, for what counts them
 * @property {string} [summoner]          For a summoned unit: what tells the Actor of its summoner from the others
 */

/**
 * @typedef {PlacedUnit & {relation: "ally"|"enemy"|null, distance: number, seen?: boolean, sees?: boolean}} Neighbour
 * `seen`: the unit asked about has this one in its Line of Sight; `sees`: this one has the unit asked about in
 * its own (see `sight.mjs`). Both are left out where sight cannot be told.
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
 * @property {string[]} [carries]     That carry a weapon of one of these categories or groups which they may wield
 * @property {boolean} [sees]         That have the unit they are counted around in their Line of Sight
 * @property {boolean} [seen]         That the unit they are counted around has in its Line of Sight
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
 * @param {((a: PlacedUnit, b: PlacedUnit) => boolean)|null} [sight]    Does the first unit have the second in
 *                                                                  its Line of Sight?
 * @returns {Surroundings|null}       Null for a unit that is not on the map
 */
export function surroundings(units, id, measure, sight = null) {
  const self = (units ?? []).find((unit) => unit.id === id);
  if ( !self ) return null;
  const others = [];
  for ( const unit of units ) {
    if ( (unit === self) || unit.out || (unit.actor && (unit.actor === self.actor)) ) continue;
    const distance = measure(self, unit);
    if ( !Number.isFinite(distance) ) continue;
    others.push({ ...unit, relation: relationOf(self.side, unit.side), distance, ...(sight ? { seen: !!sight(self, unit), sees: !!sight(unit, self) } : {}) });
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
  if ( filter.carries?.length && !carriesAny(other.carried, filter.carries) ) return false;

  // A unit that carries the mark of a skill, as one that skill was used on does
  if ( filter.marked && !(other.marks ?? []).includes(filter.marked) ) return false;

  // A unit that has the one it is counted around in its Line of Sight, or that this one has in its own. Where
  // sight cannot be told, the LoS stat of the one that looks is counted in spaces
  if ( filter.sees && !(other.sees ?? (other.distance <= (other.totals?.los ?? other.stats?.los ?? 0))) ) return false;
  if ( filter.seen && !other.seen ) return false;
  return true;
}

/* -------------------------------------------- */

/**
 * Does a unit carry a weapon of one of the listed kinds that it may wield? A kind is a weapon category, or
 * "magic" for every tome.
 * @param {{category: string}[]} [carried]    The weapons and tomes it carries and may wield
 * @param {string[]} list
 * @returns {boolean}
 */
export function carriesAny(carried, list) {
  return (carried ?? []).some((item) => {
    return list.some((entry) => ((entry === "magic") ? !!FEO.weaponCategories[item?.category]?.magic : (item?.category === entry)));
  });
}

/* -------------------------------------------- */

/**
 * Can a skill reach a unit near its own, to do something to it? Not one that has left the fight or has no HP,
 * and not an enemy that cannot be targeted: what picks nobody by name still passes such a unit over.
 * @param {Neighbour} other
 * @returns {boolean}
 */
export function reachable(other) {
  if ( !other || other.out || !((other.hp ?? 1) > 0) ) return false;
  return !(other.untargetable && (other.relation === "enemy"));
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
/*  Formations                                  */
/* -------------------------------------------- */

/**
 * The spaces between two units on a square grid, counted along rows and columns between the nearest tiles
 * each takes up: 1 for units side by side, 2 for units corner to corner.
 * @param {Tile|null} a
 * @param {Tile|null} b
 * @returns {number|null}     Null where either has no tile
 */
export function tilesApart(a, b) {
  if ( !a || !b ) return null;
  const gap = (start1, size1, start2, size2) => Math.max(start2 - (start1 + size1 - 1), start1 - (start2 + size2 - 1), 0);
  return gap(a.j, size(a).width, b.j, size(b).width) + gap(a.i, size(a).height, b.i, size(b).height);
}

/* -------------------------------------------- */

/**
 * Do three units stand in a triangle around a fourth? They do where they are not in one line and the middle of
 * the fourth's space lies inside the triangle between the middles of theirs, its edges included: so three
 * units on three sides of it do (the T of the games), and so do two on opposite sides with a third anywhere
 * off their line, while three that all stand to one side of it do not.
 * @param {Tile[]} corners    The three units
 * @param {Tile} middle       The unit they stand around
 * @returns {boolean}
 */
export function standAround(corners, middle) {
  if ( (corners?.length !== 3) || corners.some((tile) => !tile) || !middle ) return false;
  // Twice the middle of each space, so that every number is whole
  const point = (tile) => ({ x: (2 * tile.j) + size(tile).width - 1, y: (2 * tile.i) + size(tile).height - 1 });
  const [a, b, c] = corners.map(point);
  const p = point(middle);
  const cross = (o, u, v) => ((u.x - o.x) * (v.y - o.y)) - ((u.y - o.y) * (v.x - o.x));
  if ( cross(a, b, c) === 0 ) return false;
  const sides = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

/* -------------------------------------------- */

/**
 * @typedef FormationFilter
 * A formation a unit makes with allies around the unit it fights.
 * @property {string} with          The skill each of those allies has equipped
 * @property {number} [others]      How many allies it takes; 2 unless given
 * @property {number} [from]        Every unit of it stands at least this many spaces from the unit fought; 1
 * @property {number} [within]      And at most this many; 2
 */

/**
 * The allies a unit makes a formation with around the unit it fights (see `standAround`): two others that
 * have the skill asked for equipped, each of the three no nearer to the unit fought and no further from it
 * than the formation allows. Where several pairs would do, the pair nearest to the unit fought is taken.
 * @param {Surroundings|null} near        What the unit has around it; its `tile` is where it fights from
 * @param {Surroundings|null} foeNear     What its foe has around it
 * @param {FormationFilter} filter
 * @returns {Neighbour[]|null}    The allies, or none where the formation does not stand; null when that
 *                                cannot be told: a unit is not on the map, or the map has no square grid
 */
export function formationAround(near, foeNear, filter) {
  if ( !near?.tile || !foeNear?.tile || !filter?.with ) return null;
  const from = filter.from ?? 1;
  const within = filter.within ?? 2;
  const inReach = (tile) => {
    const apart = tilesApart(tile, foeNear.tile);
    return (apart !== null) && (apart >= from) && (apart <= within);
  };
  if ( (filter.others ?? 2) !== 2 ) return [];
  if ( !inReach(near.tile) ) return [];
  const partners = near.others
    .filter((other) => (other.relation === "ally") && (other.id !== foeNear.id) && other.tile && reachable(other) && inReach(other.tile))
    .filter((other) => (other.skills ?? []).some((skill) => skill?.name === filter.with))
    .sort((a, b) => tilesApart(a.tile, foeNear.tile) - tilesApart(b.tile, foeNear.tile));
  for ( let first = 0; first < partners.length; first++ ) {
    for ( let second = first + 1; second < partners.length; second++ ) {
      if ( standAround([near.tile, partners[first].tile, partners[second].tile], foeNear.tile) ) return [partners[first], partners[second]];
    }
  }
  return [];
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

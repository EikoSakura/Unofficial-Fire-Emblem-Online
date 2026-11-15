/**
 * Supports for Fire Emblem Online: how support points become ranks, and when partners are close enough to
 * boost each other, as the Off the Map section of the rules describes them.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";

/**
 * @typedef Bond
 * @property {string} name
 * @property {string} [uuid]        The partner's Actor, when the bond is linked to one
 * @property {string} rank          A key of FEO.supportRanks
 * @property {number} points
 * @property {boolean} [kin]        Is this a Bond Support?
 * @property {boolean} [inRange]
 * @property {boolean} [adjacent]
 * @property {boolean} [auto]       Is range found from the tokens on the scene?
 */

const RANKS = () => Object.keys(FEO.supportRanks);

/**
 * The highest support rank.
 * @returns {string}
 */
export function topRank() {
  return RANKS().at(-1);
}

/* -------------------------------------------- */

/**
 * The points a bond needs for its next rank, or null when it has none to gain or ranks are raised by hand.
 * With the chapters method this is a running total; with the points method it is counted from zero each rank.
 * @param {string} rank
 * @param {string} [method]
 * @returns {number|null}
 */
export function pointsForNext(rank, method = FEO.supports.method) {
  const ranks = RANKS();
  const next = ranks[ranks.indexOf(rank) + 1];
  if ( !next ) return null;
  if ( method === "chapters" ) return FEO.supports.chapters.thresholds[next] ?? null;
  if ( method === "points" ) return FEO.supports.points.perRank;
  return null;
}

/* -------------------------------------------- */

/**
 * Add support points to a bond and raise its rank as far as they carry it.
 * A rank is never lost. The highest rank is only reached while the unit has room for another support of it.
 * @param {{rank: string, points: number}} bond
 * @param {number} amount
 * @param {object} [options]
 * @param {string} [options.method]       How supports grow; the world's method by default
 * @param {number} [options.topRanks]     How many of the unit's other supports are already at the highest rank
 * @returns {{rank: string, points: number, rankUps: number, held: boolean}}   `held` when the highest rank was
 *                                                                              earned but there is no room for it
 */
export function addPoints(bond, amount, { method = FEO.supports.method, topRanks = 0 } = {}) {
  const ranks = RANKS();
  const top = topRank();
  const room = topRanks < FEO.supports.topRankLimit;
  let rank = bond.rank;
  let points = Math.max((bond.points ?? 0) + Math.max(Math.floor(amount ?? 0), 0), 0);
  let rankUps = 0;
  let held = false;

  for ( ;; ) {
    const next = ranks[ranks.indexOf(rank) + 1];
    const needed = pointsForNext(rank, method);
    if ( !next || (needed === null) || (points < needed) ) break;
    if ( (next === top) && !room ) {
      held = true;
      break;
    }
    if ( method === "points" ) points -= needed;
    rank = next;
    rankUps++;
  }
  return { rank, points, rankUps, held };
}

/* -------------------------------------------- */

/**
 * The rank a new bond starts at.
 * @param {boolean} kin     Is it a Bond Support?
 * @param {string} [rank]   The rank it has now
 * @returns {string}
 */
export function startingRank(kin, rank = "E") {
  if ( !kin ) return rank;
  const ranks = RANKS();
  return ranks.indexOf(rank) < ranks.indexOf(FEO.supports.bondStart) ? FEO.supports.bondStart : rank;
}

/* -------------------------------------------- */

/**
 * What a distance between two partners means for their support.
 * @param {number|null} distance    Tiles between them, or null when they are not on the same scene
 * @returns {{inRange: boolean, adjacent: boolean}}
 */
export function rangeState(distance) {
  if ( !Number.isFinite(distance) ) return { inRange: false, adjacent: false };
  return { inRange: distance <= FEO.supportRange, adjacent: distance <= 1 };
}

/* -------------------------------------------- */

/**
 * The next state of a bond's range when it is set by hand: out of range, in range, and for a Bond Support
 * side by side as well.
 * @param {{inRange?: boolean, adjacent?: boolean, kin?: boolean}} bond
 * @returns {{inRange: boolean, adjacent: boolean}}
 */
export function cycleRange(bond) {
  if ( !bond.inRange ) return { inRange: true, adjacent: false };
  if ( bond.kin && !bond.adjacent ) return { inRange: true, adjacent: true };
  return { inRange: false, adjacent: false };
}

/* -------------------------------------------- */

/**
 * What the partners of a Bond Support gain while side by side.
 * @param {{kin?: boolean, inRange?: boolean, adjacent?: boolean}} bond
 * @returns {{hit: number, dodge: number, critical: number}|null}
 */
export function kinBonus(bond) {
  if ( !bond.kin || !bond.inRange || !bond.adjacent ) return null;
  return { ...FEO.supports.bondAdjacent };
}

/* -------------------------------------------- */

/**
 * Does a bond name a given unit as its partner? A linked bond goes by its link; any other by name, compared
 * without regard to case.
 * @param {Bond} bond
 * @param {{uuid?: string, uuids?: string[], names: string[]}} unit   The unit's Actor, any other Actor it stands
 *                                                                   for, and the names it goes by
 * @returns {boolean}
 */
export function namesPartner(bond, unit) {
  if ( bond.uuid ) return [unit.uuid, ...(unit.uuids ?? [])].includes(bond.uuid);
  const wanted = String(bond.name ?? "").trim().toLowerCase();
  if ( !wanted ) return false;
  return unit.names.some((name) => String(name ?? "").trim().toLowerCase() === wanted);
}

/* -------------------------------------------- */

/**
 * Find, among a group of units, every bond whose partner is in the group too.
 * @param {{uuid?: string, names: string[], bonds: Bond[]}[]} units
 * @returns {{unit: number, bond: number, partner: number}[]}    Indexes into `units` and into the unit's bonds
 */
export function bondsWithin(units) {
  const found = [];
  units.forEach((unit, index) => {
    (unit.bonds ?? []).forEach((bond, bondIndex) => {
      const partner = units.findIndex((candidate, other) => (other !== index) && namesPartner(bond, candidate));
      if ( partner >= 0 ) found.push({ unit: index, bond: bondIndex, partner });
    });
  });
  return found;
}

/* -------------------------------------------- */

/**
 * The points an event is worth under the world's method.
 * @param {string} event      A key of FEO.supports.events, or "battle" for two partners fielded together
 * @param {string} [method]
 * @returns {number}
 */
export function eventPoints(event, method = FEO.supports.method) {
  if ( method === "chapters" ) return event === "battle" ? FEO.supports.chapters.perBattle : 0;
  if ( method !== "points" ) return 0;
  if ( event === "battle" ) return FEO.supports.events.chapter;
  return FEO.supports.events[event] ?? 0;
}

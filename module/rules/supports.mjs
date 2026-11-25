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
 * The highest support ranks, of which a support reaches one: A+ and S.
 * @returns {string[]}
 */
export function topRanks() {
  return RANKS().filter((rank) => FEO.supportRanks[rank].top);
}

/* -------------------------------------------- */

/**
 * Is a rank one of the highest?
 * @param {string} rank
 * @returns {boolean}
 */
export function isTop(rank) {
  return !!FEO.supportRanks[rank]?.top;
}

/* -------------------------------------------- */

/**
 * The ranks a support climbs one after another, from E to A.
 * @returns {string[]}
 */
export function ladder() {
  return RANKS().filter((rank) => !FEO.supportRanks[rank].top);
}

/* -------------------------------------------- */

/**
 * The ranks that come after a rank: the next one up to A, both of the highest from A, and none from those.
 * @param {string} rank
 * @returns {string[]}
 */
export function nextRanks(rank) {
  const steps = ladder();
  const at = steps.indexOf(rank);
  if ( at < 0 ) return [];
  return (at === steps.length - 1) ? topRanks() : [steps[at + 1]];
}

/* -------------------------------------------- */

/**
 * The rank below a rank: A for both of the highest. Null for the lowest.
 * @param {string} rank
 * @returns {string|null}
 */
export function rankBelow(rank) {
  const steps = ladder();
  if ( isTop(rank) ) return steps.at(-1);
  return steps[steps.indexOf(rank) - 1] ?? null;
}

/* -------------------------------------------- */

/**
 * Does a support stand where it chooses between the highest ranks?
 * @param {string} rank
 * @returns {boolean}
 */
export function atFork(rank) {
  return rank === ladder().at(-1);
}

/* -------------------------------------------- */

/**
 * The highest ranks a unit already holds, on its supports other than one.
 * @param {{rank: string}[]} bonds
 * @param {number} [except]     The support that is not counted
 * @returns {string[]}
 */
export function takenTops(bonds, except = -1) {
  return [...new Set((bonds ?? []).filter((bond, index) => (index !== except) && isTop(bond.rank)).map((bond) => bond.rank))];
}

/* -------------------------------------------- */

/**
 * The highest ranks still open to a support: those neither of its partners holds with somebody else.
 * @param {string[]} [taken]      Those its unit holds
 * @param {string[]} [theirs]     Those its partner holds
 * @returns {string[]}
 */
export function openTops(taken = [], theirs = []) {
  return topRanks().filter((rank) => !taken.includes(rank) && !theirs.includes(rank));
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
  const [next] = nextRanks(rank);
  if ( !next ) return null;
  if ( method === "chapters" ) return FEO.supports.chapters.thresholds[next] ?? null;
  if ( method === "points" ) return FEO.supports.points.perRank;
  return null;
}

/* -------------------------------------------- */

/**
 * Has a support the points for one of the highest ranks, which its partners have yet to choose?
 * @param {{rank: string, points: number}} bond
 * @param {string} [method]
 * @returns {boolean}
 */
export function isReady(bond, method = FEO.supports.method) {
  const needed = pointsForNext(bond.rank, method);
  return atFork(bond.rank) && (needed !== null) && ((bond.points ?? 0) >= needed);
}

/* -------------------------------------------- */

/**
 * Add support points to a bond and raise its rank as far as they carry it. A rank is never lost.
 * At A the points only make the support ready: which of the highest ranks it reaches is for its partners to
 * choose (see `takeTop`), and it gains no points beyond those it needs. A support of the highest rank gains none.
 * @param {{rank: string, points: number}} bond
 * @param {number} amount
 * @param {object} [options]
 * @param {string} [options.method]     How supports grow; the world's method by default
 * @param {string[]} [options.taken]    The highest ranks its unit and its partner hold with somebody else
 * @returns {{rank: string, points: number, rankUps: number, gained: number, ready: boolean, held: boolean,
 *   ripened: boolean, open: string[]}}
 *   `gained`, the points that counted; `ready`, when a highest rank is there to be chosen from `open`; `held`,
 *   when it was earned but both are taken; `ripened`, when the support came to that with these points
 */
export function addPoints(bond, amount, { method = FEO.supports.method, taken = [] } = {}) {
  const had = Math.max(bond.points ?? 0, 0);
  const added = Math.max(Math.floor(amount ?? 0), 0);
  const open = openTops(taken);
  const none = { rank: bond.rank, points: had, rankUps: 0, gained: 0, ready: false, held: false, ripened: false, open };
  if ( isTop(bond.rank) || !nextRanks(bond.rank).length ) return none;

  const was = isReady(bond, method);
  let rank = bond.rank;
  let points = had + added;
  let gained = added;
  let rankUps = 0;
  let full = false;

  for ( ;; ) {
    const needed = pointsForNext(rank, method);
    if ( (needed === null) || (points < needed) ) break;
    if ( atFork(rank) ) {
      gained -= points - needed;
      points = needed;
      full = true;
      break;
    }
    if ( method === "points" ) points -= needed;
    rank = nextRanks(rank)[0];
    rankUps++;
  }
  const ready = full && (open.length > 0);
  const held = full && !open.length;
  return { rank, points, rankUps, gained: Math.max(gained, 0), ready, held, ripened: full && !was, open };
}

/* -------------------------------------------- */

/**
 * A support at A takes one of the highest ranks.
 * @param {{rank: string, points: number}} bond
 * @param {string} top                    The rank chosen
 * @param {object} [options]
 * @param {string} [options.method]       How supports grow; the world's method by default
 * @param {string[]} [options.taken]      The highest ranks its unit holds with somebody else
 * @param {boolean} [options.force]       Is it taken whether or not the support has the points, as by a Game Master?
 * @returns {{rank: string, points: number}|null}     Null when it cannot take that rank
 */
export function takeTop(bond, top, { method = FEO.supports.method, taken = [], force = false } = {}) {
  if ( !isTop(top) || !atFork(bond.rank) || taken.includes(top) ) return null;
  if ( !force && !isReady(bond, method) ) return null;
  return { rank: top, points: (method === "points") ? 0 : Math.max(bond.points ?? 0, 0) };
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

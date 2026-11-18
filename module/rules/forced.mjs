/**
 * Forced movement: a unit that is moved by something other than its own movement. Shoved away from a unit,
 * pulled towards one, swapped with another, set down on a tile next to someone, or stepping forward, backward
 * or into its foe's place once a fight is over. Where it lands is worked out here from the map as it is handed
 * in; nothing in this module knows of Foundry.
 *
 * Every such move goes by the same rules. The unit lands on a tile of the map whose ground it could stand on
 * and that nobody holds (a tile with one unit on it is free where either may share a tile, see `passing.mjs`),
 * and it crosses no wall on its way. A move of several spaces goes as far as it can and stops in front of
 * whatever is in its way; one that cannot go a single space is not made at all, and what offers it says why.
 *
 * Some units are not moved by others at all, which a skill says with a rule (see `skills.mjs`):
 *
 *   rules: ["rooted"]       // nothing moves its unit but the unit itself: not an enemy, not an ally
 *   rules: ["unforced"]     // no enemy moves its unit, or holds it in place
 *   rules: ["held"]         // its unit cannot move: what holds a unit in place puts this on it for a while
 *
 * Shove is a command every unit has: it pushes a unit next to it one space on, if that unit's Weight is not 3
 * or more above its own. A skill changes it with a `shove` part, which like `crossing` is always there and may
 * wait for its skill to be switched on:
 *
 *   shove: { spaces: 2 }                // its Shove pushes this many spaces, as far as the way is free
 *   shove: { moving: 1, holds: 1 }      // shoving an enemy takes this much movement in place of its Action,
 *                                       // while it has that much left; the enemy is then held in place until
 *                                       // the end of this many of its own turns
 *   shove: { any: true, more: 1 }       // it shoves a unit whatever would keep it from that: the unit's
 *                                       // Weight, or a rule that says nobody moves it. A unit it could shove
 *                                       // anyway is pushed this many spaces further instead
 *
 * And a skill moves units as a fight ends with a `step` part at a moment of that fight (see `STEP_MOVES`):
 *
 *   { proc: { on: "after", sure: true }, step: { move: "forward" } }           // its unit steps into the
 *                                                                               // space between it and its foe
 *   { proc: { on: "after", sure: true }, step: { move: "back", may: true } }    // or a space away from its foe;
 *                                                                               // `may`: only if its owner
 *                                                                               // picks the tile on the map
 *   { proc: { on: "attack", stat: "dex" }, step: { move: "swap" } }             // it trades places with its foe
 *   { proc: { on: "after", sure: true }, step: { move: "shove", may: true } }   // it Shoves its foe, as the
 *                                                                               // command does
 *   { proc: { on: "hit", sure: true, once: true }, step: { move: "scatter" } }  // every other unit next to
 *                                                                               // its foe is pushed a space
 *                                                                               // away from that foe
 *   { proc: { on: "after", sure: true, hits: 2 },                               // `hits`: only once it has
 *     step: { move: "place", may: true, damage: 5, inflicts: ["daze"],          // landed this many attacks.
 *             cooldown: { stay: 1 } } }                                         // Its foe is set down on a
 *                                       // tile next to the unit, takes this damage and these conditions; its
 *                                       // owner may also pick the foe itself, which is then not moved, and
 *                                       // the skill's cooldown is `stay` turns in place of its own
 *
 * The steps are taken once the fight is over and before its unit's Action is counted, so that a move the
 * Action leaves it sets out from where it then stands. None of them is movement of the unit's own: what it
 * moved this turn is counted as before.
 *
 * @import {Tile} from "./reach.mjs"
 */
import { FEO } from "../config.mjs";
import { tileKey, tilesApart } from "./reach.mjs";

/** The rules that keep a unit from being moved: by anyone but itself, and by its enemies. */
export const ROOTED = "rooted";
export const UNFORCED = "unforced";

/** The rule that keeps a unit from moving at all. */
export const HELD = "held";

/** How a skill can move units as a fight ends. */
export const STEP_MOVES = ["forward", "back", "swap", "shove", "scatter", "place"];

/** What the `step` part of an effect can say, and the `shove` part. */
export const STEP_PARTS = ["move", "may", "spaces", "damage", "inflicts", "cooldown"];
export const SHOVE_PARTS = ["spaces", "moving", "holds", "any", "more"];

/** The four ways a unit can be moved a space. */
const STEPS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/**
 * @typedef ForcedField
 * The map, as the unit that is moved would stand on it.
 * @property {(tile: Tile) => boolean} inside             Is the tile on the map?
 * @property {(tile: Tile) => boolean} stands             Could the unit stand on the ground of the tile?
 * @property {(tile: Tile) => boolean} taken              Does someone stand there, whose tile it may not share?
 * @property {(from: Tile, to: Tile) => boolean} [wall]   Is there a wall between two tiles that touch?
 */

/**
 * @typedef Slide
 * Where a move of some spaces in one direction ends.
 * @property {Tile} tile                                  The tile the unit lands on; where it stood if it is
 *                                                        not moved at all
 * @property {Tile[]} way                                 The tiles it moves onto, in order
 * @property {number} moved                               How many spaces it goes
 * @property {"edge"|"wall"|"terrain"|"taken"|null} blocked     What stopped it short, if anything did
 */

/* -------------------------------------------- */
/*  Who Is Moved                                */
/* -------------------------------------------- */

/**
 * Does a unit refuse to be moved by another? One that is rooted does, whoever asks; one that is not moved
 * against its will refuses everyone but its friends. Nothing keeps a unit from a step of its own.
 * @param {Iterable<string>|null} rules             The rules its skills give it (see `skills.mjs`)
 * @param {"friend"|"foe"|"apart"|"self"} relation  How the unit that moves it stands to it
 * @returns {boolean}
 */
export function refuses(rules, relation) {
  if ( relation === "self" ) return false;
  const has = new Set(rules ?? []);
  if ( has.has(ROOTED) ) return true;
  return has.has(UNFORCED) && (relation !== "friend");
}

/* -------------------------------------------- */

/**
 * May a unit Shove another? It may unless the other's Weight is above its own by the margin or more.
 * @param {number} weight       The Weight of the unit that shoves
 * @param {number} other        The Weight of the unit it would shove
 * @param {number} [margin]     How much heavier the other must be to stay put
 * @returns {boolean}
 */
export function canShove(weight, other, margin = FEO.shove.margin) {
  return ((Number(other) || 0) - (Number(weight) || 0)) < margin;
}

/* -------------------------------------------- */
/*  Where It Lands                              */
/* -------------------------------------------- */

/**
 * The step from one tile towards another, along a row or a column.
 * @param {Tile} from
 * @param {Tile} to
 * @returns {{di: number, dj: number}|null}   Null for two tiles that are the same, or that lie on neither a
 *                                            row nor a column together
 */
export function stepOf(from, to) {
  const di = to.i - from.i;
  const dj = to.j - from.j;
  if ( (di !== 0) === (dj !== 0) ) return null;
  return { di: Math.sign(di), dj: Math.sign(dj) };
}

/* -------------------------------------------- */

/**
 * What keeps a unit from being moved from one tile onto the next.
 * @param {Tile} from
 * @param {Tile} to
 * @param {ForcedField} field
 * @returns {"edge"|"wall"|"terrain"|"taken"|null}    Null when nothing does
 */
export function blocks(from, to, field) {
  if ( !field.inside(to) ) return "edge";
  if ( field.wall?.(from, to) ) return "wall";
  if ( !field.stands(to) ) return "terrain";
  return field.taken(to) ? "taken" : null;
}

/* -------------------------------------------- */

/**
 * Move a unit some spaces in one direction: it goes as far as it can, and stops in front of the first tile it
 * cannot be moved onto.
 * @param {Tile} start                        Where it stands
 * @param {{di: number, dj: number}|null} step
 * @param {number} spaces                     How many spaces it is moved at most
 * @param {ForcedField} field
 * @returns {Slide}
 */
export function slide(start, step, spaces, field) {
  const here = { i: start.i, j: start.j };
  const way = [];
  let blocked = null;
  if ( !step ) return { tile: here, way, moved: 0, blocked: "edge" };
  let at = here;
  for ( let n = 0; n < Math.max(Math.floor(spaces) || 0, 0); n++ ) {
    const next = { i: at.i + step.di, j: at.j + step.dj };
    blocked = blocks(at, next, field);
    if ( blocked ) break;
    way.push(next);
    at = next;
  }
  return { tile: at, way, moved: way.length, blocked };
}

/* -------------------------------------------- */

/**
 * Push a unit away from another: straight on, along the row or column the two share.
 * @param {Tile} from           Where the unit that pushes stands
 * @param {Tile} target         Where the unit that is pushed stands
 * @param {number} spaces
 * @param {ForcedField} field   The map, as the unit that is pushed would stand on it
 * @returns {Slide}
 */
export function push(from, target, spaces, field) {
  return slide(target, stepOf(from, target), spaces, field);
}

/* -------------------------------------------- */

/**
 * Pull a unit towards another, along the row or column the two share. It stops next to the unit that pulls.
 * @param {Tile} to             Where the unit that pulls stands
 * @param {Tile} target         Where the unit that is pulled stands
 * @param {number} spaces
 * @param {ForcedField} field   The map, as the unit that is pulled would stand on it
 * @returns {Slide}
 */
export function pull(to, target, spaces, field) {
  const room = Math.max(tilesApart(to, target) - 1, 0);
  return slide(target, stepOf(target, to), Math.min(spaces, room), field);
}

/* -------------------------------------------- */

/**
 * May two units trade places? Each must be able to stand on the ground the other stands on.
 * @param {Tile} a
 * @param {Tile} b
 * @param {ForcedField} fieldA    The map, as the unit on `a` would stand on it
 * @param {ForcedField} fieldB    The map, as the unit on `b` would
 * @returns {boolean}
 */
export function swaps(a, b, fieldA, fieldB) {
  if ( (a.i === b.i) && (a.j === b.j) ) return false;
  return fieldA.inside(b) && fieldB.inside(a) && fieldA.stands(b) && fieldB.stands(a);
}

/* -------------------------------------------- */

/**
 * The tiles next to a tile that a unit can be set down on.
 * @param {Tile} centre         The tile they lie around
 * @param {ForcedField} field   The map, as the unit that is moved would stand on it
 * @returns {Tile[]}
 */
export function beside(centre, field) {
  const tiles = [];
  for ( const [di, dj] of STEPS ) {
    const tile = { i: centre.i + di, j: centre.j + dj };
    if ( !blocks(centre, tile, field) ) tiles.push(tile);
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * The tiles that lie between two tiles two spaces apart: the one in the middle of a row or column, or the two
 * that touch both of a pair set corner to corner.
 * @param {Tile} a
 * @param {Tile} b
 * @returns {Tile[]}    Empty for two tiles that are not two spaces apart
 */
export function between(a, b) {
  const di = b.i - a.i;
  const dj = b.j - a.j;
  if ( (Math.abs(di) + Math.abs(dj)) !== 2 ) return [];
  if ( (di === 0) || (dj === 0) ) return [{ i: a.i + (di / 2), j: a.j + (dj / 2) }];
  return [{ i: a.i, j: b.j }, { i: b.i, j: a.j }];
}

/* -------------------------------------------- */

/**
 * The space a unit steps into towards a foe two spaces away: the first of the tiles between them that it can
 * be moved onto.
 * @param {Tile} unit
 * @param {Tile} foe
 * @param {ForcedField} field   The map, as the unit would stand on it
 * @returns {Tile|null}         Null when something is in the way, or the two are not two spaces apart
 */
export function stepForward(unit, foe, field) {
  return between(unit, foe).find((tile) => !blocks(unit, tile, field)) ?? null;
}

/* -------------------------------------------- */

/**
 * The space a unit steps back into, away from a foe: straight back along the row or column the two share, or
 * for a foe that stands off it, away along the line it is further off on.
 * @param {Tile} unit
 * @param {Tile} foe
 * @param {ForcedField} field   The map, as the unit would stand on it
 * @returns {Tile|null}         Null when it cannot step back
 */
export function stepBack(unit, foe, field) {
  const di = unit.i - foe.i;
  const dj = unit.j - foe.j;
  if ( !di && !dj ) return null;
  const ways = [];
  if ( Math.abs(di) >= Math.abs(dj) ) ways.push({ di: Math.sign(di), dj: 0 });
  if ( Math.abs(dj) >= Math.abs(di) ) ways.push({ di: 0, dj: Math.sign(dj) });
  for ( const step of ways ) {
    const moved = slide(unit, step, 1, field);
    if ( moved.moved ) return moved.tile;
  }
  return null;
}

/* -------------------------------------------- */
/*  Lines                                       */
/* -------------------------------------------- */

/**
 * The tiles a straight line from the middle of one tile to the middle of another crosses, the two themselves
 * left out. A line that passes exactly through a corner crosses neither of the tiles beside it.
 * @param {Tile} a
 * @param {Tile} b
 * @returns {Tile[]}
 */
export function lineTiles(a, b) {
  const ni = Math.abs(b.i - a.i);
  const nj = Math.abs(b.j - a.j);
  const si = Math.sign(b.i - a.i);
  const sj = Math.sign(b.j - a.j);
  const tiles = [];
  let i = a.i;
  let j = a.j;
  let ii = 0;
  let jj = 0;
  while ( (ii < ni) || (jj < nj) ) {
    // Which edge the line meets next: that of the next row, of the next column, or both at a corner
    const row = (1 + (2 * ii)) * nj;
    const column = (1 + (2 * jj)) * ni;
    if ( row === column ) {
      i += si;
      j += sj;
      ii++;
      jj++;
    }
    else if ( row < column ) {
      i += si;
      ii++;
    }
    else {
      j += sj;
      jj++;
    }
    tiles.push({ i, j });
  }
  tiles.pop();
  return tiles;
}

/* -------------------------------------------- */

/**
 * Is the way between two tiles clear: does a straight line between them cross no tile that stands in it?
 * @param {Tile} a
 * @param {Tile} b
 * @param {(tile: Tile) => boolean} blocked     Does a tile stand in the way?
 * @returns {boolean}
 */
export function clearLine(a, b, blocked) {
  return !lineTiles(a, b).some((tile) => blocked(tile));
}

/* -------------------------------------------- */

/**
 * Does something stand between two tiles, for an attack that cannot be made through it? A tile the straight
 * line between the two crosses that stands in the way does. Two tiles that touch at a corner have nothing
 * between them unless both tiles beside that corner stand in the way.
 * @param {Tile} a
 * @param {Tile} b
 * @param {(tile: Tile) => boolean} stands      Does a tile stand in the way?
 * @returns {boolean}
 */
export function standsBetween(a, b, stands) {
  if ( lineTiles(a, b).some((tile) => stands(tile)) ) return true;
  if ( (Math.abs(a.i - b.i) === 1) && (Math.abs(a.j - b.j) === 1) ) return stands({ i: a.i, j: b.j }) && stands({ i: b.i, j: a.j });
  return false;
}

/* -------------------------------------------- */
/*  Shove                                       */
/* -------------------------------------------- */

/**
 * @typedef Shoving
 * What a unit's skills make of its Shove.
 * @property {number} spaces              How many spaces it pushes
 * @property {number|null} moving         The movement shoving an enemy takes in place of its Action; null for
 *                                        a unit whose Shove is always its Action
 * @property {number} holds               The turns of its own an enemy it shoves is then held in place for
 * @property {boolean} any                Does it shove a unit whatever would keep it from that?
 * @property {number} more                The spaces further it then pushes a unit it could shove anyway
 * @property {{spaces: string, moving: string, any: string}} skills   The skills that give it each
 */

/**
 * The Shove of a unit without a skill that changes it.
 * @returns {Shoving}
 */
export function emptyShove() {
  return { spaces: FEO.shove.spaces, moving: null, holds: 0, any: false, more: 0, skills: { spaces: "", moving: "", any: "" } };
}

/* -------------------------------------------- */

/**
 * Add what one skill makes of its unit's Shove: the furthest push and the cheapest way to shove count.
 * @param {Shoving} total
 * @param {object} part               The `shove` part of an effect
 * @param {object} [options]
 * @param {string} [options.skill]    The skill it comes from
 * @returns {Shoving}                 `total`, changed
 */
export function addShove(total, part, { skill = "" } = {}) {
  if ( Number.isFinite(part?.spaces) && (part.spaces > total.spaces) ) {
    total.spaces = part.spaces;
    total.skills.spaces = skill;
  }
  if ( Number.isFinite(part?.moving) && ((total.moving === null) || (part.moving < total.moving)) ) {
    total.moving = Math.max(part.moving, 0);
    total.skills.moving = skill;
    total.holds = Math.max(part.holds ?? 0, 0);
  }
  if ( part?.any ) {
    if ( !total.any ) total.skills.any = skill;
    total.any = true;
    total.more = Math.max(total.more, Math.max(Math.floor(Number(part.more)) || 0, 0));
  }
  return total;
}

/* -------------------------------------------- */

/**
 * @typedef ShoveTry
 * Whether a unit may Shove another, and what comes of it.
 * @property {boolean} ok
 * @property {"apart"|"rooted"|"weight"|"edge"|"wall"|"terrain"|"taken"|null} reason    Why not, when it may not
 * @property {Tile} tile              Where the unit that is shoved lands
 * @property {Tile[]} way             The tiles it moves onto
 * @property {number} moved           How many spaces it goes
 * @property {number|null} cost       The movement the Shove takes in place of the unit's Action; null when it
 *                                    is the unit's Action
 * @property {number} holds           The turns the unit that is shoved is then held in place for
 * @property {string[]} skills        The skills that made this Shove more than a plain one
 * @property {string} [lent]          What let it shove a unit it could not have shoved, or pushed that unit
 *                                    further than it would have gone: blank where the Shove did without it
 */

/**
 * Try a Shove: the unit pushes a unit next to it straight on.
 * @param {object} unit
 * @param {Tile} unit.tile
 * @param {number} unit.weight
 * @param {Shoving|null} [unit.shove]         What its skills make of its Shove
 * @param {number|null} [unit.left]           The movement it has left this turn; null where that is not counted
 * @param {object} target
 * @param {Tile} target.tile
 * @param {number} target.weight
 * @param {"friend"|"foe"|"apart"} target.relation    How the unit stands to it
 * @param {Iterable<string>|null} [target.rules]      The rules its skills give it
 * @param {ForcedField} field                 The map, as the unit that is shoved would stand on it
 * @returns {ShoveTry}
 */
export function tryShove(unit, target, field) {
  const shove = unit.shove ?? emptyShove();
  const here = { i: target.tile.i, j: target.tile.j };
  const none = (reason) => ({ ok: false, reason, tile: here, way: [], moved: 0, cost: null, holds: 0, skills: [] });
  if ( tilesApart(unit.tile, target.tile) !== 1 ) return none("apart");
  // A unit that shoves whatever would keep it from that needs it for a unit that refuses to be moved or is
  // too heavy; one it could shove anyway it pushes further instead
  const refused = refuses(target.rules, target.relation);
  const heavy = !canShove(unit.weight, target.weight);
  if ( refused && !shove.any ) return none("rooted");
  if ( heavy && !shove.any ) return none("weight");
  const forced = refused || heavy;
  const spaces = shove.spaces + ((shove.any && !forced) ? (shove.more ?? 0) : 0);
  const pushed = push(unit.tile, target.tile, spaces, field);
  if ( !pushed.moved ) return none(pushed.blocked ?? "edge");
  const lent = !!shove.any && (forced || (pushed.moved > shove.spaces));

  // Shoving an enemy takes movement in place of the Action, for a unit whose skill has it and that has as much
  const foe = target.relation === "foe";
  const moving = foe && (shove.moving !== null) && (unit.left !== null) && (unit.left !== undefined) && (unit.left >= shove.moving);
  const skills = [];
  if ( (pushed.moved > FEO.shove.spaces) && shove.skills.spaces ) skills.push(shove.skills.spaces);
  if ( foe && (shove.moving !== null) && shove.skills.moving ) skills.push(shove.skills.moving);
  if ( lent && shove.skills.any && !skills.includes(shove.skills.any) ) skills.push(shove.skills.any);
  return {
    ok: true,
    reason: null,
    tile: pushed.tile,
    way: pushed.way,
    moved: pushed.moved,
    cost: moving ? shove.moving : null,
    holds: (foe && (shove.moving !== null)) ? shove.holds : 0,
    skills,
    lent: lent ? (shove.skills.any || "") : ""
  };
}

/* -------------------------------------------- */

/**
 * The units next to a tile, each with where a push away from that tile would take it.
 * @param {Tile} centre                       The tile they are pushed away from
 * @param {{id: string, tile: Tile}[]} units  The units that might be, each by what tells it from the others
 * @param {number} spaces
 * @param {(id: string) => ForcedField|null} fieldOf    The map as each of them would stand on it; null for
 *                                            one that is not moved
 * @returns {{id: string, from: Tile, tile: Tile, way: Tile[]}[]}     Those that are moved, the furthest first
 */
export function scatter(centre, units, spaces, fieldOf) {
  const moved = [];
  const held = new Set();
  const left = new Set();
  const near = units.filter((unit) => tilesApart(centre, unit.tile) === 1);

  // A unit that stays where it is keeps its tile; one that is moved leaves it to whoever comes after
  for ( const unit of near ) {
    const field = fieldOf(unit.id);
    if ( !field ) continue;
    const pushed = push(centre, unit.tile, spaces, {
      ...field,
      taken: (tile) => (field.taken(tile) && !left.has(tileKey(tile))) || held.has(tileKey(tile))
    });
    if ( !pushed.moved ) continue;
    left.add(tileKey(unit.tile));
    held.add(tileKey(pushed.tile));
    moved.push({ id: unit.id, from: unit.tile, tile: pushed.tile, way: pushed.way });
  }
  return moved;
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check how a skill says it changes its unit's Shove, so that a typing mistake does not pass silently.
 * @param {any} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkShove(part) {
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ["shove must say what the skill changes about its unit's Shove"];
  const problems = [];
  for ( const key of Object.keys(part) ) {
    if ( !SHOVE_PARTS.includes(key) ) problems.push(`shove cannot say "${key}"`);
  }
  if ( (part.spaces !== undefined) && !(Number.isInteger(part.spaces) && (part.spaces >= 1)) ) {
    problems.push("a Shove pushes a whole number of spaces");
  }
  if ( (part.moving !== undefined) && !(Number.isInteger(part.moving) && (part.moving >= 0)) ) {
    problems.push("the movement a Shove takes is a whole number");
  }
  if ( (part.holds !== undefined) && !(Number.isInteger(part.holds) && (part.holds >= 1)) ) {
    problems.push("the turns a shoved enemy is held for are a whole number");
  }
  if ( (part.holds !== undefined) && (part.moving === undefined) ) problems.push("only a Shove that takes movement holds the enemy it shoves");
  if ( (part.any !== undefined) && (part.any !== true) ) problems.push('shove: "any" is true or left out');
  if ( (part.more !== undefined) && !(Number.isInteger(part.more) && (part.more >= 1) && part.any) ) {
    problems.push('the spaces a Shove pushes further are a whole number, beside "any"');
  }
  if ( (part.spaces === undefined) && (part.moving === undefined) && (part.any === undefined) ) problems.push("shove changes how far a Shove pushes, what it takes, or whom it moves");
  return problems;
}

/* -------------------------------------------- */

/**
 * Check how a skill says it moves units as a fight ends.
 * @param {any} part                      The `step` part of an effect
 * @param {object|null} [proc]            The moment it waits for
 * @param {object} [options]
 * @param {string[]} [options.conditions]     The conditions there are
 * @returns {string[]}
 */
export function checkStep(part, proc = null, { conditions = Object.keys(FEO.conditions) } = {}) {
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ["step must say how the skill moves a unit"];
  const problems = [];
  for ( const key of Object.keys(part) ) {
    if ( !STEP_PARTS.includes(key) ) problems.push(`step cannot say "${key}"`);
  }
  if ( !STEP_MOVES.includes(part.move) ) problems.push(`step: unknown move "${part.move}"`);
  if ( !proc || !["attack", "hit", "crit", "kill", "after"].includes(proc.on) ) {
    problems.push("a step is taken at a moment of a fight: attack, hit, crit, kill or after");
  }
  if ( (part.may !== undefined) && (part.may !== true) ) problems.push("the \"may\" of a step is true or left out");
  if ( part.may && !["back", "shove", "place"].includes(part.move) ) problems.push(`a "${part.move}" step is not for its owner to pick`);
  if ( (part.spaces !== undefined) && !(Number.isInteger(part.spaces) && (part.spaces >= 1)) ) problems.push("a step goes a whole number of spaces");
  if ( (part.spaces !== undefined) && (part.move !== "scatter") ) problems.push("only a \"scatter\" step says how many spaces");
  for ( const key of ["damage", "inflicts", "cooldown"] ) {
    if ( (part[key] !== undefined) && (part.move !== "place") ) problems.push(`only a "place" step says "${key}"`);
  }
  if ( (part.damage !== undefined) && !(Number.isInteger(part.damage) && (part.damage >= 1)) ) problems.push("the damage of a step is a whole number");
  if ( part.inflicts !== undefined ) {
    if ( !Array.isArray(part.inflicts) ) problems.push("the conditions of a step are a list");
    else for ( const id of part.inflicts ) if ( !conditions.includes(id) ) problems.push(`step: unknown condition "${id}"`);
  }
  if ( part.cooldown !== undefined ) {
    const stay = part.cooldown?.stay;
    if ( !part.cooldown || (typeof part.cooldown !== "object") || Object.keys(part.cooldown).some((key) => key !== "stay")
      || !(Number.isInteger(stay) && (stay >= 0)) ) problems.push("the cooldown of a step says how many turns it is when the foe stays: { stay: 1 }");
  }
  return problems;
}

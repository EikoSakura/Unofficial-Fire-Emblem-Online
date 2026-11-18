import { fightsWithStaff } from "../rules/staves.mjs";
import { FEO } from "../config.mjs";
import { walkOn } from "../rules/acting.mjs";
import { mergeCrossing } from "../rules/canto.mjs";
import { rangeHole, rangeWith } from "../rules/combat.mjs";
import { UNFORCED, standsBetween, stepForward } from "../rules/forced.mjs";
import { movementFacts, walkTo } from "../rules/movement.mjs";
import { pathHarm } from "../rules/passing.mjs";
import { unseenBy } from "../rules/reactions.mjs";
import { pathTo, pruneLunge, reachFrom, relation, strikeFrom, strikeTiles, strikesFrom, tileKey, tilesApart, wayBetween } from "../rules/reach.mjs";
import { groundOf, heightBlocks, moveCost, passCost, terrainType } from "../rules/terrain.mjs";
import { warpTiles } from "../rules/warp.mjs";
import { extraGo } from "./acting.mjs";
import { lungeOf } from "./affinity.mjs";
import { movingAgain, walkAgain } from "./canto.mjs";
import { armyOf, cannotTarget, shelterOver, tokenTile } from "./exchange.mjs";
import { lentRangeOf } from "./lending.mjs";
import { movOf, rangesWith, skillsWith, turnMoveOf, turnNote } from "./movement.mjs";
import { originOf, turnState } from "./phases.mjs";
import { moverOf, tileGround } from "./terrain.mjs";

/**
 * The battle map in Foundry: reading the tokens and the ground of a scene for the reach rules. Where a unit
 * can go, what it can strike and from where are worked out by `rules/reach.mjs`; this module hands it the
 * scene. Nothing is saved for it.
 *
 * @import {Reach, Tile} from "../rules/reach.mjs"
 */

/**
 * @typedef PlacedToken
 * @property {TokenDocument} token
 * @property {Actor} actor
 * @property {string} army          A key of FEO.armies
 * @property {Tile} tile            The tile of its top-left corner
 * @property {boolean} down         Is the unit Incapacitated? It no longer holds its tile then
 * @property {import("../rules/passing.mjs").Passing|null} passing
 *                                  What its skills make of units standing in each other's way
 */

/**
 * The units that stand on a scene, as the user looking at it may know them.
 * @param {Scene|null} scene
 * @returns {PlacedToken[]}
 */
export function unitsOn(scene) {
  const units = [];
  if ( !scene?.grid?.isSquare ) return units;
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( (actor?.type !== "unit") || actor.system.defeat?.out ) continue;
    if ( token.hidden && !game.user.isGM ) continue;
    const tile = tokenTile(token);
    if ( !tile ) continue;
    units.push({
      token, actor, army: armyOf(actor, token), tile: { i: tile.i, j: tile.j }, down: !!actor.system.defeat?.down,
      passing: actor.system.passing ?? null
    });
  }
  return units;
}

/* -------------------------------------------- */

/**
 * How one unit stands to another.
 * @param {PlacedToken|{army: string}} a
 * @param {PlacedToken|{army: string}} b
 * @returns {"friend"|"foe"|"apart"}
 */
export function standsTo(a, b) {
  return relation(a.army, b.army, FEO.alliances);
}

/* -------------------------------------------- */

/**
 * How far a unit can move this turn. A unit that is down or held in place by a condition does not move.
 * @param {Actor} actor
 * @returns {number}
 */
export function movementOf(actor) {
  return movOf(actor);
}

/* -------------------------------------------- */

/**
 * How far the weapon in a unit's hand reaches, and whether it is a staff.
 * @param {Actor} actor
 * @param {object[]} [changes]    What the unit's skills change about the weapon's Range, as they stand
 * @returns {{min: number, max: number, staff: boolean, open: number, step: boolean, way: boolean, lent?: boolean}|null}
 *          Null for a unit with nothing to strike with. `open` is how far it reaches whatever lies between:
 *          from further away, as a skill may let it attack, it needs room to step into the space between
 *          (`step`), or nothing standing between the two (`way`). `lent` for a unit that attacks with a weapon
 *          a skill lends it in place of the one in its hand
 */
export function rangeOf(actor, changes = []) {
  const weapon = actor.system.equippedWeapon;
  const usable = !!weapon && !weapon.system.broken;
  // A staff is no weapon to strike with, but for a unit whose skill lets it start a fight with one, or a
  // staff that says anybody may: that unit strikes the units next to it
  const wand = usable && (weapon.system.category === "staff");
  const melee = wand && fightsWithStaff({ effect: weapon.system.effect }, actor.system.skills?.rules);
  const staff = wand && !melee;
  const range = usable ? rangeWith(melee ? "1" : weapon.system.range, actor.system.statValues, (staff || melee) ? [] : changes) : null;

  // A weapon a skill lends the unit (see `rules/lending.mjs`): one it took up is what it attacks with, whatever
  // is in its hand; one that is used by itself widens how far the weapon in its hand reaches
  const lent = staff ? null : lentRangeOf(actor, range ? { min: Math.max(range.min, 1), max: Math.max(range.max, 1) } : null);
  if ( lent?.lent ) return { min: Math.max(lent.min, 1), max: Math.max(lent.max, 1), staff: false, open: Math.max(lent.max, 1), step: false, way: false, lent: true };
  if ( !range ) return null;
  const max = Math.max(lent?.max ?? range.max, 1);
  const bound = changes.filter((change) => change.clear || change.open);
  const free = staff ? null : rangeWith(weapon.system.range, actor.system.statValues, changes.filter((change) => !bound.includes(change)));
  return {
    min: Math.max(Math.min(lent?.min ?? range.min, range.min), 1), max, staff,
    open: free ? Math.max(Math.min(Math.max(free.max, 1), max), lent?.max ?? 0) : max,
    step: bound.some((change) => change.clear),
    way: bound.some((change) => change.open),

    // The distances within that it does not attack at, where a skill adds to its reach from further on only
    hole: staff ? null : rangeHole(weapon.system.range, actor.system.statValues, changes)
  };
}

/* -------------------------------------------- */

/**
 * What stands between two tiles of a scene, for an attack that cannot be made through obstacles or units: a
 * unit that is neither of the two, a tile that nothing crosses, or a wall of the scene.
 * @param {Scene} scene
 * @param {Tile} from
 * @param {Tile} to
 * @param {object} [options]
 * @param {PlacedToken[]} [options.units]     The units on the scene, where they are already known
 * @param {TokenDocument[]} [options.but]     Units that do not count: the two themselves
 * @returns {"unit"|"terrain"|"wall"|null}     Null where nothing does
 */
export function betweenOn(scene, from, to, { units = null, but = [] } = {}) {
  if ( !scene?.grid?.isSquare || !from || !to ) return null;
  const taken = new Set((units ?? unitsOn(scene)).filter((other) => !but.includes(other.token) && !other.down).map((other) => tileKey(other.tile)));
  if ( standsBetween(from, to, (tile) => taken.has(tileKey(tile))) ) return "unit";
  if ( standsBetween(from, to, (tile) => !!terrainType(tileGround(scene, tile)?.terrain)?.impassable) ) return "terrain";
  return wallBetween(scene, from, to) ? "wall" : null;
}

/* -------------------------------------------- */

/**
 * Is there a wall of the scene between two tiles that touch? Only the scene in view can be asked: on any
 * other, nothing is known to stand between them.
 * @param {Scene} scene
 * @param {Tile} from
 * @param {Tile} to
 * @returns {boolean}
 */
export function wallBetween(scene, from, to) {
  try {
    if ( !scene?.walls?.size || (globalThis.canvas?.scene !== scene) || !canvas.ready ) return false;
    const backend = CONFIG.Canvas.polygonBackends?.move;
    if ( !backend?.testCollision ) return false;
    return !!backend.testCollision(scene.grid.getCenterPoint(from), scene.grid.getCenterPoint(to), { type: "move", mode: "any" });
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * The map as a unit that is moved against its will would stand on it (see `rules/forced.mjs`): which tiles
 * are on it, which it could stand on, which someone holds, and where a wall is in the way.
 * @param {TokenDocument} token           The unit that is moved
 * @param {object} [options]
 * @param {PlacedToken[]} [options.units]         The units on its scene, where they are already known
 * @param {TokenDocument[]} [options.but]         Units to leave out, as one that moves at the same time
 * @returns {import("../rules/forced.mjs").ForcedField}
 */
export function forcedField(token, { units = null, but = [] } = {}) {
  const scene = token.parent;
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const mover = moverOf(token.actor);
  const passing = token.actor?.system.passing ?? null;
  const at = new Map();
  for ( const other of units ?? unitsOn(scene) ) {
    if ( (other.token === token) || but.includes(other.token) ) continue;
    const key = tileKey(other.tile);
    if ( !at.has(key) ) at.set(key, []);
    at.get(key).push(other);
  }
  return {
    inside: (tile) => (tile.i >= i0) && (tile.i < i1) && (tile.j >= j0) && (tile.j < j1),
    stands: (tile) => Number.isFinite(moveCost(tileGround(scene, tile).terrain, mover)),

    // A tile with one unit on it is free where either of the two may share a tile
    taken: (tile) => {
      const there = at.get(tileKey(tile)) ?? [];
      if ( !there.length ) return false;
      return (there.length > 1) || !(passing?.share || there[0].passing?.share);
    },
    wall: (from, to) => wallBetween(scene, from, to)
  };
}

/* -------------------------------------------- */

/**
 * @typedef TokenReach
 * @property {PlacedToken} unit           The unit that moves
 * @property {PlacedToken[]} units        Every unit on the scene
 * @property {Tile} standing              Where its token stands now
 * @property {boolean} moved              Has it moved since its turn began?
 * @property {boolean} fixed              Does that move stand, as one that dealt damage on its way does? It is
 *                                        then neither taken back nor made again
 * @property {import("../rules/passing.mjs").Passing|null} passing
 *                                        What its skills make of units standing in each other's way
 * @property {number} movement            Its MOV
 * @property {import("../rules/terrain.mjs").Mover} mover     The unit as the terrain rules know it
 * @property {number} spent               Movement spent to get where it stands
 * @property {Reach} reach                Where it can go from where its turn began
 * @property {import("../rules/movement.mjs").Movement|null} move
 *                                        How it moved this turn, for its skills; null outside of a battle
 * @property {Set<string>|null} mustAttack    The enemies it must attack, by their tokens, having moved a space
 *                                        its Affinity added to reach them; null for a unit that made no such move
 * @property {boolean} onlyWait           Do its skills leave it nothing to do but Wait? So it is for a unit that
 *                                        is moving again
 * @property {import("./canto.mjs").MovingAgain|null} again
 *                                        The move it may make after the Action it has taken, as Canto lets it:
 *                                        its reach is then worked out from where it stood as it acted, for the
 *                                        movement that move has, and it strikes nothing
 * @property {import("../rules/acting.mjs").Go|null} go
 *                                        The go it is on beyond the first of its turn, as a skill earned it: a
 *                                        go without its whole movement moves with what that go has, and counts
 *                                        on from what the unit had moved before; one that bars attacking
 *                                        strikes nothing
 * @property {{min: number, max: number, staff: boolean}|null} range
 *                                        How far its weapon reaches from where it stands, as its skills make it
 * @property {{min: number, max: number, staff: boolean}|null} walking
 *                                        How far it reaches from a tile the unit has to walk to, which a skill
 *                                        for a unit that has not moved no longer counts for
 * @property {Set<string>} strikes        The tiles its weapon reaches: from anywhere it can go, or once it has
 *                                        moved from where it stands
 * @property {(tile: Tile) => {terrain: string, elevation: number}} ground
 * @property {(from: Tile, to: Tile, distance: number) => boolean} allows
 * @property {(tile: Tile) => boolean} inside
 */

/**
 * Where a token can go and what it can strike this turn, on the scene it stands on.
 * @param {TokenDocument} token
 * @param {object} [options]
 * @param {boolean} [options.fresh]     Work it out as if the unit's turn had just begun where it stands: for
 *                                      the threat of a unit that is not acting now
 * @returns {TokenReach|null}           Null for a token that is not a unit on a square grid
 */
export function reachOf(token, { fresh = false } = {}) {
  const scene = token?.parent;
  const actor = token?.actor;
  const standing = tokenTile(token);
  if ( !scene?.grid?.isSquare || (actor?.type !== "unit") || !standing ) return null;
  const units = unitsOn(scene);
  const unit = units.find((other) => other.token === token)
    ?? { token, actor, army: armyOf(actor, token), tile: { i: standing.i, j: standing.j }, down: !!actor.system.defeat?.down, passing: actor.system.passing ?? null };

  // A unit that has taken its Action and may move again, as Canto lets it, sets out from where it stood as
  // it acted, with the movement that move has
  const state = fresh ? null : turnState(actor, token);
  const again = (state === "moving") ? movingAgain(actor) : null;

  // A unit on another go of its turn, as a skill earned it, may have less than its whole movement for it
  const go = (state === "ready") ? extraGo(actor) : null;

  // Where the turn began, or that second move: a token that has moved remembers it, until its unit acts
  const saved = fresh ? null : originOf(token);
  const start = saved ? scene.grid.getOffset({ x: saved.x + (scene.grid.sizeX / 2), y: saved.y + (scene.grid.sizeY / 2) }) : standing;
  const origin = { i: start.i, j: start.j };
  const here = { i: standing.i, j: standing.j };
  const moved = !!saved && ((origin.i !== here.i) || (origin.j !== here.j));

  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const inside = (tile) => (tile.i >= i0) && (tile.i < i1) && (tile.j >= j0) && (tile.j < j1);
  // Who stands where: the other units tile by tile, and how many units a tile holds with this one counted
  // A unit this one does not see, as an enemy that is hidden, is not in its way and holds no tile for it: it
  // may try to walk onto that tile, and is stopped as it does (see `helpers/reactions.mjs`)
  const at = new Map();
  const crowd = new Map();
  for ( const other of units ) {
    if ( (other.token !== token) && unseenBy(other.actor.system.skills?.rules, standsTo(unit, other)) ) continue;
    const key = tileKey(other.tile);
    crowd.set(key, (crowd.get(key) ?? 0) + 1);
    if ( other.token === token ) continue;
    if ( !at.has(key) ) at.set(key, []);
    at.get(key).push(other);
  }
  if ( !units.includes(unit) ) crowd.set(tileKey(here), (crowd.get(tileKey(here)) ?? 0) + 1);
  // On the move it makes after its Action it may cross terrain as it otherwise does not
  const usual = moverOf(actor);
  const mover = again?.crossing ? { ...usual, crossing: mergeCrossing(usual.crossing ?? null, again.crossing) } : usual;
  const ground = (tile) => tileGround(scene, tile);
  const passing = unit.passing ?? null;

  // A unit is in the way of those that are not its friends, unless it is down, or shares its tile as a skill
  // lets it: such a unit blocks nobody while it does
  const inWay = (other) => !other.down && (standsTo(unit, other) !== "friend")
    && !(other.passing?.share && ((crowd.get(tileKey(other.tile)) ?? 0) > 1));

  // An enemy whose skill stops those that come beside it ends the unit's movement on the tiles next to it
  // A unit that no enemy keeps from moving is not stopped there
  const unforced = !!actor.system.skills?.rules?.includes(UNFORCED);
  const wardens = unforced ? []
    : units.filter((other) => (other.token !== token) && !other.down && other.passing?.zone && (standsTo(unit, other) === "foe"));

  // What each tile takes the unit, as its skills have it cross terrain. A tile it only passes through, as a
  // skill may let it, is one it cannot stop on
  const pass = (tile) => passCost(ground(tile).terrain, mover);
  const field = {
    inside,
    cost: (tile) => pass(tile).cost,

    // A unit passes its allies, and anyone who is down; an enemy only as its skills let it
    foe: (tile) => (at.get(tileKey(tile)) ?? []).some(inWay),

    // It cannot stop on a tile someone is on, unless one of the two may share a tile and nobody else is there
    taken: (tile) => {
      if ( !pass(tile).stop ) return true;
      const there = at.get(tileKey(tile)) ?? [];
      if ( !there.length ) return false;
      return (there.length > 1) || !(passing?.share || there[0].passing?.share);
    },
    pass: passing
  };
  if ( wardens.length ) field.halts = (tile) => wardens.some((other) => tilesApart(other.tile, tile) === 1);

  // The enemies it moved through before its Action count against how many it may move through this turn
  if ( again ) field.passed = again.base.passed.length;
  else if ( go?.base ) field.passed = go.base.passed.length;
  const movement = (again && (movementOf(actor) > 0)) ? again.mov
    : (go && (go.mov !== null)) ? Math.min(go.mov, movementOf(actor))
    : movementOf(actor);
  const reach = reachFrom(origin, movement, field);

  // A move that dealt damage on its way stands: the unit stays where it took it
  const fixed = !fresh && moved && turnNote(token).fixed;
  if ( fixed ) reach.stops = new Set([tileKey(here)]);

  // Melee cannot be made against a target on another level. And from further than its weapon reaches by
  // itself, as a skill may let it attack, the unit needs room to step into the space between the two
  // or, for a skill that says so, nothing standing between the two
  let open = Infinity;
  let between = null;
  let needs = { step: false, way: false, hole: null };
  const allows = (from, to, distance) => {
    if ( heightBlocks(distance, ground(from).elevation, ground(to).elevation) ) return false;
    if ( needs.hole && (distance > needs.hole.above) && (distance < needs.hole.from) ) return false;
    if ( distance <= open ) return true;
    if ( needs.way && betweenOn(scene, from, to, { units, but: [token, ...units.filter((other) => tileKey(other.tile) === tileKey(to)).map((other) => other.token)] }) ) return false;
    if ( !needs.step ) return true;
    between ??= forcedField(token, { units });
    return !!stepForward(from, to, between);
  };

  // How the unit moved this turn, and what its skills make of that before any fight: how far its weapon
  // reaches from where it stands, how far from a tile it would have to walk to, and whether it may act at all
  // While its turn runs that is counted from where the turn began; afterwards it is what its token noted
  // A move made after its Action is added to what the unit moved before it
  const ready = (state === "ready") || !!again;
  const foes = units.filter((other) => (other.token !== token) && (standsTo(unit, other) === "foe"));
  const walk = (tile) => {
    const way = { ...walkTo(reach, tile), passed: passedOn(reach, tile, foes) };
    return again ? walkAgain(again, way) : go?.base ? walkOn(go.base, way) : way;
  };
  const move = turnMoveOf(token, { fresh, walk: ready ? walk(here) : null });
  const totals = skillsWith(actor, move);

  // A unit that is moving again has taken its Action: it strikes nothing more this turn. Nor does one on a
  // go that bars attacking, though its staff still reaches
  let range = again ? null : rangeOf(actor, rangesWith(actor, move));
  if ( range && !range.staff && go?.bars.includes("attack") ) range = null;
  let walking = range;
  if ( move && !moved && range && !range.staff ) {
    const stepped = { ...move, ...movementFacts({ spaces: 1, cost: 1, mov: move.mov }), kept: move.kept };
    walking = rangeOf(actor, rangesWith(actor, stepped));
  }
  open = Math.min(range?.open ?? Infinity, walking?.open ?? Infinity);
  needs = { step: !!(range?.step || walking?.step), way: !!(range?.way || walking?.way), hole: range?.hole ?? walking?.hole ?? null };
  const aim = { inside, allows: range?.staff ? null : allows };

  // Movement its Affinity adds while it is switched on, as Breath does, only takes the unit to a tile from
  // which it can attack an enemy it could not have attacked otherwise, which it then must attack
  const lunge = (!again && !go) ? lungeOf(actor) : 0;
  let opened = null;
  if ( lunge > 0 ) {
    const armed = !!range && !range.staff;
    const marks = armed ? foes.filter((other) => !other.down && !cannotTarget(actor, token, other.actor, other.token))
      .map((other) => ({ id: other.token.id, tile: other.tile })) : [];
    opened = pruneLunge(reach, movement - lunge, marks, (from, foe) => {
      return strikesFrom(from, foe.tile, (tileKey(from) === tileKey(here)) ? range : (walking ?? range), allows);
    }, tileKey(here));
  }
  const mustAttack = (!fresh && moved && opened?.has(tileKey(here))) ? new Set(opened.get(tileKey(here))) : null;
  const strikes = range ? strikeTiles([tileKey(here)], range, aim) : new Set();
  if ( range && !moved ) for ( const key of strikeTiles(reach.stops, walking, aim) ) strikes.add(key);
  return {
    unit, units, standing: here, moved, fixed, passing, movement, mover, again, go,
    spent: reach.cost.get(tileKey(here)) ?? 0,
    reach, move, onlyWait: !!again || totals.rules.has("onlyWait"), range, walking, strikes, ground, allows, inside,

    // The enemies it must attack, having moved a space its Affinity added to reach them; null for no such move
    mustAttack
  };
}

/* -------------------------------------------- */

/**
 * The enemies a unit moves through on the way its reach finds to a tile, in the order it does.
 * @param {Reach} reach
 * @param {Tile} tile
 * @param {PlacedToken[]} foes      Its enemies on the scene
 * @returns {string[]}              Each by what tells its token from the others
 */
function passedOn(reach, tile, foes) {
  const way = pathTo(reach, tile);
  if ( way.length < 2 ) return [];
  return pathHarm(way, null, foes.map((foe) => ({ id: foe.token.id, tile: foe.tile, foe: true, down: foe.down }))).passed;
}

/* -------------------------------------------- */

/**
 * How far it is from where a unit's turn began to a tile of its reach, and whom it moves through on the way:
 * what its movement this turn comes to once it stands there. For a unit that is moving again after its Action,
 * the way to the tile from where it stood as it acted is added to what it moved before, and counted apart as
 * `canto`.
 * @param {TokenReach} view
 * @param {Tile} tile
 * @returns {{spaces: number, cost: number, passed: string[], canto?: number}}
 */
export function walkOf(view, tile) {
  const foes = view.units.filter((other) => (other.token !== view.unit.token) && (standsTo(view.unit, other) === "foe"));
  const way = { ...walkTo(view.reach, tile), passed: passedOn(view.reach, tile, foes) };
  return view.again ? walkAgain(view.again, way) : view.go?.base ? walkOn(view.go.base, way) : way;
}

/* -------------------------------------------- */

/**
 * What a unit's movement this turn comes to where the move it is making sets out from: nothing for a unit
 * whose turn has just begun, and what it had moved before for one that is moving again after its Action, or
 * on a go that counts on from where its turn began.
 * @param {TokenReach|null} view
 * @returns {{spaces: number, cost: number, passed: string[], canto: number}|null}
 */
export function walkHome(view) {
  if ( view?.again ) return walkAgain(view.again, null);
  return view?.go?.base ? walkOn(view.go.base, null) : null;
}

/* -------------------------------------------- */

/**
 * What a move to a tile of its reach does to the units along the way, counted from where the unit's turn
 * began: the damage it deals to the enemies it moves through or past, and what it takes itself.
 * @param {TokenReach} view
 * @param {Tile} tile
 * @returns {import("../rules/passing.mjs").PathHarm & {units: Map<string, PlacedToken>}}
 *          With the units it names, by what tells their tokens apart
 */
export function harmOf(view, tile) {
  const others = view.units.filter((other) => other.token !== view.unit.token);
  const harm = pathHarm(pathTo(view.reach, tile), view.passing, others.map((other) => ({
    id: other.token.id,
    tile: other.tile,
    foe: standsTo(view.unit, other) === "foe",
    down: other.down,
    hp: other.actor.system.hp.value,
    hpMax: other.actor.system.hp.max
  })), { hp: view.unit.actor.system.hp.value });
  return { ...harm, units: new Map(others.map((other) => [other.token.id, other])) };
}

/* -------------------------------------------- */

/**
 * Where a unit would attack another from: the tile it stands on if its weapon reaches from there, else the
 * tile that takes the least movement, on the highest and best protected ground among those.
 * @param {TokenReach} view             The attacker's reach
 * @param {TokenDocument} target        The token it attacks
 * @param {object} [options]
 * @param {boolean} [options.stay]      Must it attack from where it stands?
 * @param {boolean} [options.unsheltered]   Leave out what an ally of the target that shelters it bars, to
 *                                      tell whether that alone keeps the unit from attacking
 * @returns {{tile: Tile, cost: number, distance: number, spaces: number, passed: string[]}|null}
 *                                      The tile, the movement and the spaces of the way there from where its
 *                                      turn began, the enemies moved through on it, and the tiles between it
 *                                      and the target; null if it cannot attack the target this turn
 */
export function attackFrom(view, target, { stay = false, unsheltered = false } = {}) {
  const there = tokenTile(target);
  if ( !view?.range || view.range.staff || !there ) return null;

  // A unit that none of its enemies can make their target for now is attacked by none of them
  if ( cannotTarget(view.unit.actor, view.unit.token, target.actor, target) ) return null;

  // A unit that moved a space its Affinity added attacks an enemy that space brought within its reach
  if ( view.mustAttack && !view.mustAttack.has(target.id) ) return null;
  const goal = { i: there.i, j: there.j };
  const prefer = (tile) => {
    const { terrain, elevation } = view.ground(tile);
    const gives = groundOf(terrain, elevation, view.mover ?? null);
    return (elevation * 1000) + (gives.dodge + (gives.def * 10));
  };
  const found = strikeFrom(view.reach, view.standing, goal, view.range, {
    allows: unsheltered ? view.allows : openTo(view, target), prefer, stay: stay || view.moved, walking: view.walking
  });
  if ( !found ) return null;
  const { spaces, passed } = walkOf(view, found.tile);
  return { ...found, distance: Math.max(tilesApart(found.tile, goal), 1), spaces, passed };
}

/* -------------------------------------------- */

/**
 * What says whether a unit may attack a target from a tile: what its reach allows, less the tiles from which
 * an ally of the target that shelters it keeps the unit from attacking (see `shelterOver`).
 * @param {TokenReach} view             The attacker's reach
 * @param {TokenDocument} target        The token it attacks
 * @returns {((from: Tile, to: Tile, distance: number) => boolean)|null}
 */
function openTo(view, target) {
  const barred = shelterOver(view.unit.actor, view.unit.token, target.actor, target);
  if ( !barred ) return view.allows;
  return (from, to, distance) => (!view.allows || view.allows(from, to, distance)) && !barred(from);
}

/* -------------------------------------------- */

/**
 * Could a unit attack another from a tile of its choosing: one it can stop on this turn that its weapon
 * reaches the target from? A unit that has moved attacks from where it stands.
 * @param {TokenReach} view             The attacker's reach
 * @param {TokenDocument} target        The token it attacks
 * @param {Tile} tile                   The tile it would attack from
 * @returns {{tile: Tile, cost: number, distance: number, spaces: number, passed: string[]}|null}   Null if it could not
 */
export function attackAt(view, target, tile) {
  const there = tokenTile(target);
  if ( !view?.range || view.range.staff || !there || !tile ) return null;
  if ( cannotTarget(view.unit.actor, view.unit.token, target.actor, target) ) return null;
  if ( view.mustAttack && !view.mustAttack.has(target.id) ) return null;
  const goal = { i: there.i, j: there.j };
  const key = tileKey(tile);
  const here = key === tileKey(view.standing);
  if ( !here && (view.moved || !view.reach.stops.has(key)) ) return null;
  if ( !strikesFrom(tile, goal, here ? view.range : view.walking, openTo(view, target)) ) return null;
  const { spaces, cost, passed } = walkOf(view, tile);
  return { tile: { i: tile.i, j: tile.j }, cost, distance: Math.max(tilesApart(tile, goal), 1), spaces, passed };
}

/* -------------------------------------------- */

/**
 * Everything a unit could strike on its next turn: the tiles it can reach and those its weapon reaches from
 * them.
 * @param {TokenDocument} token
 * @returns {Set<string>}
 */
export function threatOf(token) {
  // A unit that is down or out of the fight threatens nothing
  if ( token?.actor?.system?.defeat?.out ) return new Set();
  const view = reachOf(token, { fresh: true });
  if ( !view || view.unit.down ) return new Set();
  const tiles = new Set(view.reach.stops);
  if ( view.range && !view.range.staff ) for ( const key of view.strikes ) tiles.add(key);
  return tiles;
}

/* -------------------------------------------- */

/**
 * The tiles a skill can warp a unit to from where it stands: within the skill's reach whatever lies between,
 * on ground the unit could stand on, with nobody there.
 * @param {TokenReach} view                               The unit's reach
 * @param {import("../rules/warp.mjs").Warp} warp         How the skill warps
 * @returns {Set<string>}                                 The tiles, by name
 */
export function warpTilesOf(view, warp) {
  const { token, actor } = view.unit;
  const scene = token.parent;
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const mover = moverOf(actor);
  const others = view.units.filter((other) => other.token !== token);
  const taken = new Set(others.map((other) => tileKey(other.tile)));
  return warpTiles(warp, view.standing, view.movement, {
    bounds: { i0, j0, i1, j1 },
    cost: (tile) => moveCost(view.ground(tile).terrain, mover),
    taken: (tile) => taken.has(tileKey(tile)),
    foes: others.filter((other) => standsTo(view.unit, other) === "foe").map((other) => other.tile)
  });
}

/* -------------------------------------------- */

/**
 * The points of a scene a token passes through to walk to a tile of its reach, for Foundry to move it along.
 * @param {TokenDocument} token
 * @param {Reach} reach
 * @param {Tile} tile
 * @param {Tile|null} [from]              The tile it walks from, if not the one its reach sets out from
 * @returns {{x: number, y: number}[]}    Empty if the tile is out of reach
 */
export function waypointsTo(token, reach, tile, from = null) {
  const grid = token.parent.grid;
  return wayBetween(reach, from ?? reach.origin, tile).map(({ i, j }) => {
    const { x, y } = grid.getTopLeftPoint({ i, j });
    return { x, y, snapped: true };
  });
}

import { FEO } from "../config.mjs";
import { parseRange } from "../rules/combat.mjs";
import { reachFrom, relation, strikeFrom, strikeTiles, tileKey, tilesApart, wayBetween } from "../rules/reach.mjs";
import { heightBlocks, moveCost } from "../rules/terrain.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { originOf } from "./phases.mjs";
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
    units.push({ token, actor, army: armyOf(actor, token), tile: { i: tile.i, j: tile.j }, down: !!actor.system.defeat?.down });
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
  const system = actor.system;
  if ( system.defeat?.state ) return 0;
  const held = Object.keys(system.conditions ?? {}).some((id) => FEO.conditions[id]?.noMove);
  return held ? 0 : Math.max(system.statValues?.mov ?? 0, 0);
}

/* -------------------------------------------- */

/**
 * How far the weapon in a unit's hand reaches, and whether it is a staff.
 * @param {Actor} actor
 * @returns {{min: number, max: number, staff: boolean}|null}   Null for a unit with nothing to strike with
 */
export function rangeOf(actor) {
  const weapon = actor.system.equippedWeapon;
  if ( !weapon || weapon.system.broken ) return null;
  const range = parseRange(weapon.system.range, actor.system.statValues);
  if ( !range ) return null;
  return { min: Math.max(range.min, 1), max: Math.max(range.max, 1), staff: weapon.system.category === "staff" };
}

/* -------------------------------------------- */

/**
 * @typedef TokenReach
 * @property {PlacedToken} unit           The unit that moves
 * @property {PlacedToken[]} units        Every unit on the scene
 * @property {Tile} standing              Where its token stands now
 * @property {boolean} moved              Has it moved since its turn began?
 * @property {number} movement            Its MOV
 * @property {number} spent               Movement spent to get where it stands
 * @property {Reach} reach                Where it can go from where its turn began
 * @property {{min: number, max: number, staff: boolean}|null} range
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
    ?? { token, actor, army: armyOf(actor, token), tile: { i: standing.i, j: standing.j }, down: !!actor.system.defeat?.down };

  // Where the turn began: a token that has moved remembers it, until its unit acts
  const saved = fresh ? null : originOf(token);
  const start = saved ? scene.grid.getOffset({ x: saved.x + (scene.grid.sizeX / 2), y: saved.y + (scene.grid.sizeY / 2) }) : standing;
  const origin = { i: start.i, j: start.j };
  const here = { i: standing.i, j: standing.j };
  const moved = !!saved && ((origin.i !== here.i) || (origin.j !== here.j));

  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const inside = (tile) => (tile.i >= i0) && (tile.i < i1) && (tile.j >= j0) && (tile.j < j1);
  const at = new Map();
  for ( const other of units ) if ( other.token !== token ) at.set(tileKey(other.tile), other);
  const mover = moverOf(actor);
  const ground = (tile) => tileGround(scene, tile);
  const field = {
    inside,
    cost: (tile) => moveCost(ground(tile).terrain, mover),
    // A unit passes its allies, and anyone who is down; it cannot stop on a tile someone is on
    blocked: (tile) => {
      const other = at.get(tileKey(tile));
      return !!other && !other.down && (standsTo(unit, other) !== "friend");
    },
    taken: (tile) => at.has(tileKey(tile))
  };
  const movement = movementOf(actor);
  const reach = reachFrom(origin, movement, field);

  // Melee cannot be made against a target on another level
  const allows = (from, to, distance) => !heightBlocks(distance, ground(from).elevation, ground(to).elevation);
  const range = rangeOf(actor);
  const from = moved ? [tileKey(here)] : reach.stops;
  const strikes = range ? strikeTiles(from, range, { inside, allows: range.staff ? null : allows }) : new Set();
  return {
    unit, units, standing: here, moved, movement,
    spent: reach.cost.get(tileKey(here)) ?? 0,
    reach, range, strikes, ground, allows, inside
  };
}

/* -------------------------------------------- */

/**
 * Where a unit would attack another from: the tile it stands on if its weapon reaches from there, else the
 * tile that takes the least movement, on the highest and best protected ground among those.
 * @param {TokenReach} view             The attacker's reach
 * @param {TokenDocument} target        The token it attacks
 * @param {object} [options]
 * @param {boolean} [options.stay]      Must it attack from where it stands?
 * @returns {{tile: Tile, cost: number, distance: number}|null}   Null if it cannot attack the target this turn
 */
export function attackFrom(view, target, { stay = false } = {}) {
  const there = tokenTile(target);
  if ( !view?.range || view.range.staff || !there ) return null;
  const goal = { i: there.i, j: there.j };
  const prefer = (tile) => {
    const { terrain, elevation } = view.ground(tile);
    const type = FEO.terrain.types[terrain] ?? {};
    return (elevation * 1000) + ((type.dodge ?? 0) + ((type.def ?? 0) * 10));
  };
  const found = strikeFrom(view.reach, view.standing, goal, view.range, { allows: view.allows, prefer, stay: stay || view.moved });
  return found ? { ...found, distance: tilesApart(found.tile, goal) } : null;
}

/* -------------------------------------------- */

/**
 * Everything a unit could strike on its next turn: the tiles it can reach and those its weapon reaches from
 * them.
 * @param {TokenDocument} token
 * @returns {Set<string>}
 */
export function threatOf(token) {
  const view = reachOf(token, { fresh: true });
  if ( !view || view.unit.down ) return new Set();
  const tiles = new Set(view.reach.stops);
  if ( view.range && !view.range.staff ) for ( const key of view.strikes ) tiles.add(key);
  return tiles;
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

import { sees, sightBar } from "../rules/sight.mjs";
import { terrainType } from "../rules/terrain.mjs";
import { tokenTile } from "./exchange.mjs";
import { tileGround } from "./terrain.mjs";

/**
 * Line of Sight in Foundry (see `rules/sight.mjs`): reading the ground and the walls of a scene for what blocks
 * sight, and telling whether one unit has another in its Line of Sight. Nothing is saved for it.
 *
 * @import {Tile} from "../rules/reach.mjs"
 * @import {SightField} from "../rules/sight.mjs"
 */

/**
 * Does a wall of the scene that blocks sight stand between two tiles? Only the scene in view can be asked: on
 * any other, nothing is known to stand between them.
 * @param {Scene} scene
 * @param {Tile} from
 * @param {Tile} to
 * @returns {boolean}
 */
export function sightWall(scene, from, to) {
  try {
    if ( !scene?.walls?.size || (globalThis.canvas?.scene !== scene) || !canvas.ready ) return false;
    const backend = CONFIG.Canvas.polygonBackends?.sight;
    if ( !backend?.testCollision ) return false;
    return !!backend.testCollision(scene.grid.getCenterPoint(from), scene.grid.getCenterPoint(to), { type: "sight", mode: "any" });
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * A scene as sight crosses it: ground that nobody crosses blocks it, as a wall of the scene does; a unit on
 * ground that hides it is seen only from next to it; and ground may take from the Line of Sight of a unit that
 * stands on it.
 * @param {Scene|null} scene
 * @returns {SightField|null}     Null for a scene without a square grid
 */
export function sightField(scene) {
  if ( !scene?.grid?.isSquare ) return null;
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const kind = (tile) => terrainType(tileGround(scene, tile)?.terrain) ?? {};
  return {
    inside: (tile) => (tile.i >= i0) && (tile.i < i1) && (tile.j >= j0) && (tile.j < j1),
    blocked: (tile) => !!kind(tile).impassable,
    hides: (tile) => !!kind(tile).hides,
    dims: (tile) => kind(tile).los ?? 0,
    wall: (from, to) => sightWall(scene, from, to)
  };
}

/* -------------------------------------------- */

/**
 * A unit's Line of Sight, as a number of spaces.
 * @param {Actor|null} actor
 * @returns {number}
 */
export function losOf(actor) {
  return Math.max(actor?.system?.statValues?.los ?? 0, 0);
}

/* -------------------------------------------- */

/**
 * Does one unit have another in its Line of Sight, as the two stand on their scene?
 * @param {TokenDocument|null} token      The unit that looks
 * @param {TokenDocument|null} other      The unit it looks at
 * @param {object} [options]
 * @param {Tile|null} [options.from]      A tile to look from in place of the one the unit stands on
 * @returns {boolean}
 */
export function inSight(token, other, { from = null } = {}) {
  const scene = token?.parent;
  const field = (scene && (scene === other?.parent)) ? sightField(scene) : null;
  if ( !field || !token.actor || !other.actor ) return false;
  return sees(from ?? tokenTile(token), tokenTile(other), losOf(token.actor), field);
}

/* -------------------------------------------- */

/**
 * What keeps one unit from having another in its Line of Sight, if anything does.
 * @param {TokenDocument|null} token
 * @param {TokenDocument|null} other
 * @returns {"far"|"hidden"|"blocked"|"wall"|null}
 */
export function sightBarOn(token, other) {
  const scene = token?.parent;
  const field = (scene && (scene === other?.parent)) ? sightField(scene) : null;
  if ( !field ) return "far";
  return sightBar(tokenTile(token), tokenTile(other), losOf(token.actor), field);
}

/* -------------------------------------------- */

/**
 * Tell whether each of the units on a scene has another in its Line of Sight, for the position rules: the units
 * are those `describe` in `positions.mjs` makes, which carry their tile and their stats as they stand.
 * @param {Scene|null} scene
 * @returns {((a: object, b: object) => boolean)|null}    Null for a scene without a square grid
 */
export function sightOn(scene) {
  const field = sightField(scene);
  if ( !field ) return null;
  return (a, b) => (a?.tile && b?.tile) ? sees(a.tile, b.tile, a.totals?.los ?? a.stats?.los ?? 0, field) : false;
}

/* -------------------------------------------- */

/**
 * Where two units stand for a fight that one of them would start from another tile than its token is on: what
 * each has around it, with whether the two have each other in their Line of Sight worked out from that tile.
 * @param {{initiator: object|null, defender: object|null}} places    What each has around it (see `standingOf`)
 * @param {TokenDocument} token           The unit that would move
 * @param {TokenDocument} target          The unit it would fight
 * @param {Tile} from                     The tile it would fight from
 * @returns {{initiator: object|null, defender: object|null}}
 */
export function sightFrom(places, token, target, from) {
  const field = sightField(token?.parent);
  if ( !field || !places?.initiator || !places?.defender ) return places;
  const here = { i: from.i, j: from.j };
  const there = tokenTile(target);
  const mine = sees(here, there, losOf(token.actor), field);
  const theirs = sees(there, here, losOf(target.actor), field);
  const fix = (place, id, seen, looks) => ({
    ...place,
    near: { ...place.near, others: place.near.others.map((other) => (other.id === id) ? { ...other, seen, sees: looks } : other) }
  });
  return { initiator: fix(places.initiator, target.id, mine, theirs), defender: fix(places.defender, token.id, theirs, mine) };
}

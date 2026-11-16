import { FEO } from "../config.mjs";
import { tileKey, tilesApart } from "../rules/reach.mjs";
import { staffBends, staffReach, staffSide } from "../rules/staves.mjs";
import { moveCost } from "../rules/terrain.mjs";
import { staffWarp, staffWarpReaches, staffWarpTiles } from "../rules/warp.mjs";
import { standsTo, unitsOn } from "./battle-map.mjs";
import { applyChanges, armyOf, tokenTile } from "./exchange.mjs";
import { battle, originOf, phaseOf } from "./phases.mjs";
import { staffUnitOf } from "./staves.mjs";
import { moverOf, tileGround } from "./terrain.mjs";

/**
 * Warping in Foundry: setting a unit's token down on another tile of its scene, whatever lies between, and
 * reading the scene for the staves that do so. Which tiles a unit may land on is decided by the pure rules in
 * `rules/warp.mjs`.
 *
 * A player may move a unit that is not theirs, as with a Warp staff used on an ally or an Entrap staff used on
 * an enemy. Moving that token is then asked of a Game Master.
 *
 * @import {StaffWarp} from "../rules/warp.mjs"
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The name of the query that asks a Game Master to set a unit down for a player. */
export const WARP_QUERY = `${FEO.id}.warp`;

/** The flag, on a token, that holds where it stood as its battle began. */
const START_FLAG = "start";

/* -------------------------------------------- */
/*  Where a Battle Began                        */
/* -------------------------------------------- */

/**
 * A battle begins: every unit in it remembers where it stands, for what sends a unit back to its starting
 * space. Runs for the user who begins the encounter.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function markStarts(combat) {
  for ( const combatant of combat?.combatants ?? [] ) await markStart(combat, combatant);
}

/* -------------------------------------------- */

/**
 * A unit takes the field: it remembers where it stands.
 * @param {Combat} combat
 * @param {Combatant} combatant
 * @returns {Promise<void>}
 */
export async function markStart(combat, combatant) {
  const token = combatant?.token;
  if ( !combat || (token?.actor?.type !== "unit") || !token.isOwner ) return;
  const { x, y } = token._source ?? token;
  await token.setFlag(FEO.id, START_FLAG, { x, y, combat: combat.id });
}

/* -------------------------------------------- */

/**
 * A unit joins an encounter. If that is a battle under way, it remembers where it stands as it joins. Runs once,
 * for the designated Game Master.
 * @param {Combatant} combatant
 */
export function onCombatantCreated(combatant) {
  const combat = combatant?.parent;
  if ( !game.users.activeGM?.isSelf || !combat?.started || !phaseOf(combat) ) return;
  markStart(combat, combatant).catch((err) => console.error(err));
}

/* -------------------------------------------- */

/**
 * The tile a unit stood on as the battle it is fighting in began.
 * @param {TokenDocument|null} token
 * @returns {Tile|null}     Null for a unit that is in no battle, or whose start was not recorded
 */
export function startOf(token) {
  const start = token?.getFlag(FEO.id, START_FLAG);
  const grid = token?.parent?.grid;
  if ( !grid?.isSquare || !Number.isFinite(start?.x) || !Number.isFinite(start?.y) ) return null;
  if ( !start.combat || (battle()?.id !== start.combat) ) return null;
  const { i, j } = grid.getOffset({ x: start.x + (grid.sizeX / 2), y: start.y + (grid.sizeY / 2) });
  return { i, j };
}

/* -------------------------------------------- */
/*  Staves                                      */
/* -------------------------------------------- */

/**
 * How a staff moves a unit, if it does and is fit to be used. A staff whose Effect names no side for its
 * target moves the units it is used on: enemies for a staff used against enemies, allies for any other.
 * @param {Item|null} item
 * @returns {StaffWarp|null}
 */
export function staffWarpOf(item) {
  if ( (item?.type !== "weapon") || (item.system.category !== "staff") || item.system.broken ) return null;
  const warp = staffWarp(item.system.effect);
  if ( warp?.moves !== "target" ) return warp;
  const side = staffSide({ name: item.flags?.[FEO.id]?.sheetName ?? item.name, effect: item.system.effect });
  return { ...warp, moves: { offensive: "enemy", friendly: "ally", either: "any" }[side] };
}

/* -------------------------------------------- */

/**
 * How far a staff reaches in the hands of a unit, as its skills make it.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {Item} item
 * @returns {{min: number, max: number, changed: boolean}|null}   Null if its Range sets no limit
 */
export function staffReachOf(actor, token, item) {
  const unit = staffUnitOf(actor, token);
  const self = { hp: unit.hp, hpMax: unit.hpMax, level: unit.level, stats: unit.stats, conditions: unit.conditions, near: unit.near,
    weapon: { name: item.name, category: "staff" } };
  return staffReach(item.system.range, unit.stats, staffBends(unit.skills, self).ranges);
}

/* -------------------------------------------- */

/**
 * May a staff move a unit: one of the side it is for, standing where the staff reaches it?
 * @param {TokenDocument|null} user       The token of the unit that uses the staff
 * @param {Item} item                     The staff
 * @param {TokenDocument|null} target     The token it is used on
 * @returns {boolean}
 */
export function staffWarpAllows(user, item, target) {
  const warp = staffWarpOf(item);
  const here = tokenTile(user);
  const there = tokenTile(target);
  if ( !warp || !here || !there || (user === target) || (user.parent !== target.parent) || !target.actor ) return false;
  if ( target.actor.system.defeat?.out ) return false;
  const relation = standsTo({ army: armyOf(user.actor, user) }, { army: armyOf(target.actor, target) });
  return staffWarpReaches(warp, relation, tilesApart(here, there), staffReachOf(user.actor, user, item));
}

/* -------------------------------------------- */

/**
 * The tiles a staff can set a unit down on: within its range of the unit that uses it, next to that unit, or
 * next to where the unit that is moved stands, on ground that unit could stand on, with nobody there.
 * @param {TokenDocument} user        The token of the unit that uses the staff
 * @param {Item} item                 The staff
 * @param {TokenDocument} moved       The token that is moved: the user's own, or the one the staff is used on
 * @returns {Set<string>}             The tiles, by name
 */
export function staffWarpTilesOf(user, item, moved) {
  const scene = user?.parent;
  const warp = staffWarpOf(item);
  const standing = tokenTile(user);
  const from = tokenTile(moved);
  if ( !warp || !scene?.grid?.isSquare || !standing || !from || !moved?.actor ) return new Set();
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const mover = moverOf(moved.actor);
  const taken = new Set(unitsOn(scene).map((unit) => tileKey(unit.tile)));
  return staffWarpTiles(warp, { i: standing.i, j: standing.j }, staffReachOf(user.actor, user, item), {
    bounds: { i0, j0, i1, j1 },
    cost: (tile) => moveCost(tileGround(scene, tile).terrain, mover),
    taken: (tile) => taken.has(tileKey(tile))
  }, { i: from.i, j: from.j });
}

/* -------------------------------------------- */

/**
 * A staff that moves a unit has been used on the map, and did not fail: its unit is set down. On the tile that
 * was chosen, on one drawn among those in its range, or where the unit stood as the battle began. A staff that
 * halves the HP of the unit it warped does so. What cannot be done, because the unit is not this user's to
 * change and no Game Master is there, or because there is no tile to send it to, is said for the table. Whether
 * the staff hit an enemy it is used on is rolled as it is cast, with every other Offensive Staff (see
 * `staves.mjs`).
 * @param {TokenDocument|null} user       The token of the unit that uses the staff
 * @param {Item} item                     The staff
 * @param {TokenDocument|null} target     The token it is used on; none for a staff that warps its user
 * @param {Tile|null} [land]              The tile chosen on the map, for a staff that has one chosen
 * @returns {Promise<{rows: {label: string, value: string, cls: string}[], rolls: Roll[]}|null>}
 *          The rows for the staff's card and the dice that were rolled; null if the staff moves nobody here
 */
export async function castStaffWarp(user, item, target, land = null) {
  const warp = staffWarpOf(item);
  const subject = (warp?.moves === "self") ? user : target;
  if ( !warp || !user?.parent?.grid?.isSquare || !subject?.actor ) return null;
  if ( (warp.moves !== "self") && !staffWarpAllows(user, item, target) ) return null;
  const i18n = game.i18n;
  const name = subject.name || subject.actor.name;
  const rows = [];
  const rolls = [];
  const say = (key, cls = "", data = {}) => rows.push({ label: name, value: i18n.format(`FEO.Staff.${key}`, data), cls });

  // Where the unit is set down
  const open = staffWarpTilesOf(user, item, subject);
  let tile = null;
  let done = "warped";
  if ( warp.to === "start" ) {
    const start = startOf(subject);
    const here = tokenTile(subject);
    if ( start && (start.i === here.i) && (start.j === here.j) ) {
      say("warpAtStart", "muted");
      return { rows, rolls };
    }
    const taken = !!start && unitsOn(user.parent).some((unit) => (unit.token !== subject) && (unit.tile.i === start.i) && (unit.tile.j === start.j));
    if ( !start || taken ) {
      say(start ? "warpStartTaken" : "warpNoStart", "bad");
      return { rows, rolls };
    }
    tile = start;
    done = "warpedStart";
  }
  else if ( warp.to === "random" ) {
    const tiles = Array.from(open).sort();
    if ( !tiles.length ) {
      say("warpNowhere", "bad");
      return { rows, rolls };
    }
    const dice = new foundry.dice.Roll(`1d${tiles.length}`);
    await dice.evaluate();
    rolls.push(dice);
    const [i, j] = tiles[Math.min(Math.max(dice.total, 1), tiles.length) - 1].split(",").map(Number);
    tile = { i, j };
    done = "warpedRandom";
  }
  else if ( land && open.has(tileKey(land)) ) tile = { i: land.i, j: land.j };
  else {
    say("warpUnsaved", "bad");
    return { rows, rolls };
  }

  if ( !(await warpToken(subject, tile)) ) {
    say("warpUnsaved", "bad");
    return { rows, rolls };
  }
  say(done);

  // Half its HP, rounded down, and never its last
  const hp = subject.actor.system.hp.value;
  if ( warp.halves && (hp > 1) ) {
    const half = Math.max(Math.floor(hp / 2), 1);
    const unsaved = await applyChanges([{ uuid: subject.actor.uuid, hp: half }]);
    say(unsaved.length ? "halvedUnsaved" : "halved", unsaved.length ? "bad" : "", { from: hp, to: half });
  }
  return { rows, rolls };
}

/* -------------------------------------------- */
/*  Setting a Unit Down                         */
/* -------------------------------------------- */

/**
 * Set a token down on a tile at once. A unit that is warped has not moved: no move of its own is left to take
 * back, and it sets out anew from where it lands.
 * @param {TokenDocument} token
 * @param {Tile} tile
 * @returns {Promise<boolean>}    Whether it stands there now
 */
async function place(token, tile) {
  const { x, y } = token.parent.grid.getTopLeftPoint(tile);
  const arrived = await token.move({ x, y, snapped: true, action: "displace" }, {
    constrainOptions: { ignoreWalls: true, ignoreCost: true },
    [FEO.id]: { warp: true }
  });
  if ( arrived === false ) return false;
  if ( originOf(token) ) await token.unsetFlag(FEO.id, "origin");
  return true;
}

/* -------------------------------------------- */

/**
 * Warp a unit's token to a tile of its scene. A token this user may not move is set down by a Game Master.
 * @param {TokenDocument|null} token
 * @param {Tile} tile
 * @returns {Promise<boolean>}    Whether it stands there now; false leaves it for the table
 */
export async function warpToken(token, tile) {
  const scene = token?.parent;
  if ( !scene?.grid?.isSquare || !Number.isInteger(tile?.i) || !Number.isInteger(tile?.j) ) return false;
  try {
    if ( token.isOwner ) return await place(token, tile);
    const gm = game.users.activeGM;
    if ( !gm ) return false;
    return !!(await gm.query(WARP_QUERY, { scene: scene.id, token: token.id, i: tile.i, j: tile.j }, { timeout: 10000 }));
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Answer a player's request to set a unit down. Runs for a Game Master, and only puts a unit on a tile of its
 * own scene that nobody stands on.
 * @param {{scene: string, token: string, i: number, j: number}} data
 * @returns {Promise<boolean>}
 */
export async function warpQuery({ scene: sceneId, token: tokenId, i, j } = {}) {
  const scene = game.scenes?.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  if ( !game.user.isGM || (token?.actor?.type !== "unit") || !scene.grid?.isSquare ) return false;
  if ( !Number.isInteger(i) || !Number.isInteger(j) ) return false;
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  if ( (i < i0) || (i >= i1) || (j < j0) || (j >= j1) ) return false;
  if ( unitsOn(scene).some((unit) => (unit.token !== token) && (unit.tile.i === i) && (unit.tile.j === j)) ) return false;
  return place(token, { i, j });
}

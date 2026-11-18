/**
 * The things that stand on a map and that a unit can act on: doors, chests and Villages. Pure functions of
 * plain data, so that they can be tested outside of Foundry.
 *
 * A Game Master places them on the tiles of a scene. Each is on one tile:
 *
 *   door      Shut, it is a wall to everyone: nobody crosses its tile, fliers included, and nobody sees past
 *             it. A unit next to it Opens it as its Action with a key that opens doors, or without one where a
 *             skill has it open doors. Otherwise it is broken down: it has the HP of its kind (see the table
 *             of doors in The Map), an attack on it always lands and takes the unit's damage off them, and at
 *             0 it stands open.
 *   chest     A unit on its tile or next to it Opens it as its Action, with a key that opens chests or by a
 *             skill, and is given what the Game Master put in it: weapons, items and gold.
 *   village   A unit on its tile Visits it as its Action and is given the reward the Game Master set. A unit
 *             that can destroy Villages (see `pillages` in `stealing.mjs`) Destroys it from its tile, as its
 *             Action: nothing is to be had from it afterwards. A Village that was visited has shut its gates
 *             and is not destroyed.
 *
 * What is done with one is said as an `ObjectAct`: who may, from where, by what means.
 */
import { FEO } from "../config.mjs";
import { tilesApart } from "./reach.mjs";

/** The kinds of things that stand on a map. */
export const OBJECT_KINDS = ["door", "chest", "village"];

/** What a unit can do with one. */
export const OBJECT_ACTS = ["open", "break", "visit", "pillage"];

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * @typedef MapObject
 * @property {string} id
 * @property {"door"|"chest"|"village"} kind
 * @property {number} i                   The row of its tile
 * @property {number} j                   The column of its tile
 * @property {string} name                What it is called on the map; blank for the name of its kind
 * @property {string} door                A door's kind: a key of FEO.objects.doors
 * @property {{value: number, max: number}} hp      A door's HP
 * @property {boolean} open               Is the door open, or the chest opened?
 * @property {boolean} broken             Was the door broken down?
 * @property {boolean} visited            Was the Village visited?
 * @property {boolean} destroyed          Was the Village destroyed?
 * @property {number} gold                Gold in a chest, or given by a Village
 * @property {object[]} items             The weapons and items in a chest or given by a Village, as Item data
 * @property {string} note                What a Village tells its visitor
 */

/**
 * A map object as the rules read it, with whatever was left out filled in.
 * @param {object} raw
 * @returns {MapObject|null}      Null for something that is no map object
 */
export function normalizeObject(raw) {
  if ( !raw || !OBJECT_KINDS.includes(raw.kind) || !Number.isInteger(raw.i) || !Number.isInteger(raw.j) ) return null;
  const doors = FEO.objects.doors;
  const door = (raw.kind === "door") ? ((raw.door in doors) ? raw.door : Object.keys(doors)[0]) : "";
  const max = door ? Math.max(Math.trunc(raw.hp?.max ?? doors[door].hp) || doors[door].hp, 1) : 0;
  const value = door ? Math.min(Math.max(Math.trunc(raw.hp?.value ?? max), 0), max) : 0;
  return {
    id: String(raw.id ?? `${raw.kind}-${raw.i}-${raw.j}`),
    kind: raw.kind,
    i: raw.i,
    j: raw.j,
    name: String(raw.name ?? "").trim(),
    door,
    hp: { value, max },
    open: !!raw.open,
    broken: !!raw.broken,
    visited: !!raw.visited,
    destroyed: !!raw.destroyed,
    gold: Math.max(Math.trunc(raw.gold ?? 0) || 0, 0),
    items: Array.isArray(raw.items) ? raw.items.filter((item) => item && (typeof item === "object") && item.name) : [],
    note: String(raw.note ?? "").trim()
  };
}

/* -------------------------------------------- */

/**
 * The map object on a tile, if one is.
 * @param {MapObject[]} objects
 * @param {{i: number, j: number}} tile
 * @returns {MapObject|null}
 */
export function objectAt(objects, tile) {
  return (objects ?? []).find((object) => (object.i === tile?.i) && (object.j === tile?.j)) ?? null;
}

/* -------------------------------------------- */

/**
 * Does a map object stand in the way: of movement, and of sight? A door that is shut does.
 * @param {MapObject|null} object
 * @returns {boolean}
 */
export function blocksWay(object) {
  return (object?.kind === "door") && !object.open && !object.broken;
}

/* -------------------------------------------- */

/**
 * Is there nothing more to do with a map object? An open door, an opened chest, a Village that was visited or
 * destroyed.
 * @param {MapObject|null} object
 * @returns {boolean}
 */
export function isSpent(object) {
  if ( !object ) return true;
  if ( object.kind === "village" ) return object.visited || object.destroyed;
  return object.open || object.broken;
}

/* -------------------------------------------- */

/**
 * The kind of terrain a map object makes of its tile, if it does: a shut door is a wall, and a Village that
 * stands is a House, whatever was painted under either.
 * @param {MapObject|null} object
 * @returns {string|null}     A key of FEO.terrain.types, or null where the tile is what was painted
 */
export function objectTerrain(object) {
  if ( blocksWay(object) ) return FEO.objects.shut;
  if ( (object?.kind === "village") && !object.destroyed ) return FEO.objects.standing;
  return null;
}

/* -------------------------------------------- */
/*  Acting on One                               */
/* -------------------------------------------- */

/**
 * @typedef ObjectUnit
 * A unit as the rules of map objects read it.
 * @property {{i: number, j: number}} tile
 * @property {string[]} [opens]           What its skills open without a key
 * @property {string} [opensBy]           The skill that does
 * @property {{id: string, name: string, opens: string[], uses: number|null}[]} [keys]
 *                                        The keys it carries, each with what it opens and the uses it has left
 *                                        (null for one that never runs out)
 * @property {boolean} [pillages]         Can it destroy Villages?
 * @property {boolean} [raider]           Is it no friend of the players' side?
 * @property {number} [damage]            The damage of an attack with the weapon in hand, before any defence
 * @property {{min: number, max: number}|null} [range]    How far that weapon reaches; null for an unarmed unit
 */

/**
 * @typedef ObjectAct
 * @property {MapObject} object
 * @property {"open"|"break"|"visit"|"pillage"} act
 * @property {boolean} ok
 * @property {"spent"|"apart"|"key"|"unarmed"|"range"|"shut"|"cannot"|null} why     Why not
 * @property {"skill"|"key"|null} [by]    How it is opened
 * @property {string} [name]              The skill or the key it is opened with
 * @property {string} [key]               The key that is used, by its id
 * @property {number} [damage]            What an attack takes off a door
 * @property {number} [left]              The HP the door then has
 */

/**
 * How far a unit stands from a map object, along rows and columns.
 * @param {ObjectUnit} unit
 * @param {MapObject} object
 * @returns {number}
 */
function apart(unit, object) {
  return tilesApart(unit.tile, { i: object.i, j: object.j });
}

/**
 * May a unit Open a door or a chest? It stands where it can reach it, and has a skill that opens it or a key
 * that does. A skill is used before a key, which it costs nothing.
 * @param {ObjectUnit} unit
 * @param {MapObject} object
 * @returns {ObjectAct}
 */
export function canOpen(unit, object) {
  const no = (why) => ({ object, act: "open", ok: false, why });
  if ( !["door", "chest"].includes(object?.kind) ) return no("cannot");
  if ( isSpent(object) ) return no("spent");
  const distance = apart(unit, object);
  const near = (object.kind === "door") ? (distance === 1) : (distance <= 1);
  if ( !near ) return no("apart");
  if ( (unit.opens ?? []).includes(object.kind) ) return { object, act: "open", ok: true, why: null, by: "skill", name: unit.opensBy ?? "" };
  const key = (unit.keys ?? []).find((entry) => entry.opens.includes(object.kind) && ((entry.uses === null) || (entry.uses > 0)));
  if ( !key ) return no("key");
  return { object, act: "open", ok: true, why: null, by: "key", name: key.name, key: key.id };
}

/* -------------------------------------------- */

/**
 * May a unit attack a door to break it down? It needs a weapon in hand that reaches the door from where it
 * stands. The attack always lands and takes its damage off the door's HP; nothing lessens it.
 * @param {ObjectUnit} unit
 * @param {MapObject} object
 * @returns {ObjectAct}
 */
export function canBreak(unit, object) {
  const no = (why) => ({ object, act: "break", ok: false, why });
  if ( object?.kind !== "door" ) return no("cannot");
  if ( isSpent(object) ) return no("spent");
  if ( !unit.range ) return no("unarmed");
  const distance = apart(unit, object);
  if ( (distance < unit.range.min) || (distance > unit.range.max) ) return no("range");
  const damage = Math.max(Math.trunc(unit.damage ?? 0), 0);
  return { object, act: "break", ok: true, why: null, damage, left: Math.max(object.hp.value - damage, 0) };
}

/* -------------------------------------------- */

/**
 * May a unit Visit a Village? It stands on its tile, and the Village still stands with its gates open. A unit
 * that is no friend of the players' side does not visit.
 * @param {ObjectUnit} unit
 * @param {MapObject} object
 * @returns {ObjectAct}
 */
export function canVisit(unit, object) {
  const no = (why) => ({ object, act: "visit", ok: false, why });
  if ( (object?.kind !== "village") || unit.raider ) return no("cannot");
  if ( isSpent(object) ) return no(object.destroyed ? "spent" : "shut");
  if ( apart(unit, object) !== 0 ) return no("apart");
  return { object, act: "visit", ok: true, why: null };
}

/* -------------------------------------------- */

/**
 * May a unit Destroy a Village? Only one whose skills have it destroy Villages, that is no friend of the
 * players' side, from the Village's tile, while the Village stands and has not been visited.
 * @param {ObjectUnit} unit
 * @param {MapObject} object
 * @returns {ObjectAct}
 */
export function canPillage(unit, object) {
  const no = (why) => ({ object, act: "pillage", ok: false, why });
  if ( (object?.kind !== "village") || !unit.pillages || !unit.raider ) return no("cannot");
  if ( isSpent(object) ) return no(object.destroyed ? "spent" : "shut");
  if ( apart(unit, object) !== 0 ) return no("apart");
  return { object, act: "pillage", ok: true, why: null };
}

/* -------------------------------------------- */

/**
 * What a unit would do with a map object as its Action: Open a door or a chest where it can, else break the
 * door down; Destroy a Village where it can, else Visit it. Where it can do nothing, the reason the first of
 * those gives.
 * @param {ObjectUnit} unit
 * @param {MapObject} object
 * @returns {ObjectAct}
 */
export function actOn(unit, object) {
  if ( object?.kind === "village" ) {
    const raid = canPillage(unit, object);
    return raid.ok || unit.raider ? raid : canVisit(unit, object);
  }
  const opened = canOpen(unit, object);
  if ( opened.ok || (object?.kind !== "door") || (opened.why === "spent") ) return opened;
  const broken = canBreak(unit, object);
  return broken.ok ? broken : opened;
}

/* -------------------------------------------- */

/**
 * Everything on a map a unit can act on from where it stands, each with what it would do.
 * @param {ObjectUnit} unit
 * @param {MapObject[]} objects
 * @returns {ObjectAct[]}
 */
export function actsFor(unit, objects) {
  return (objects ?? []).filter((object) => !isSpent(object)).map((object) => actOn(unit, object)).filter((act) => act.ok);
}

/* -------------------------------------------- */

/**
 * A map object once something was done with it.
 * @param {MapObject} object
 * @param {ObjectAct} act
 * @returns {MapObject}       A copy, changed
 */
export function afterAct(object, act) {
  const next = { ...object, hp: { ...object.hp }, items: [...object.items] };
  if ( act.act === "open" ) next.open = true;
  else if ( act.act === "break" ) {
    next.hp.value = Math.max(object.hp.value - (act.damage ?? 0), 0);
    if ( next.hp.value <= 0 ) next.broken = true;
  }
  else if ( act.act === "visit" ) next.visited = true;
  else if ( act.act === "pillage" ) next.destroyed = true;
  return next;
}

/* -------------------------------------------- */

/**
 * What a unit is given for what it did with a map object: what a chest it opened held, the reward of a
 * Village it visited. A door gives nothing, and neither does a Village that is destroyed.
 * @param {MapObject} object
 * @param {ObjectAct} act
 * @returns {{gold: number, items: object[], note: string}}
 */
export function yieldOf(object, act) {
  const gives = ((act.act === "open") && (object.kind === "chest")) || (act.act === "visit");
  if ( !gives ) return { gold: 0, items: [], note: "" };
  return { gold: object.gold, items: object.items.map((item) => ({ ...item })), note: (act.act === "visit") ? object.note : "" };
}

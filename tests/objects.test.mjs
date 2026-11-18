/**
 * Tests for the things that stand on a map and that a unit can act on (`module/rules/objects.mjs`): doors,
 * chests and Villages.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import {
  OBJECT_KINDS, actOn, actsFor, afterAct, blocksWay, canBreak, canOpen, canPillage, canVisit, isSpent, normalizeObject, objectAt,
  objectTerrain, yieldOf
} from "../module/rules/objects.mjs";
import { terrainType } from "../module/rules/terrain.mjs";
import { skillKnacks } from "../module/rules/skills.mjs";
import { keyOpens } from "../module/rules/stealing.mjs";
import { skill } from "./lib/fixtures.mjs";

const at = (i, j) => ({ i, j });
const door = (more = {}) => normalizeObject({ id: "d", kind: "door", i: 3, j: 4, ...more });
const chest = (more = {}) => normalizeObject({ id: "c", kind: "chest", i: 3, j: 4, gold: 200, items: [{ name: "Steel Sword", type: "weapon" }], ...more });
const village = (more = {}) => normalizeObject({ id: "v", kind: "village", i: 3, j: 4, gold: 500, items: [{ name: "Elixir", type: "gear" }], note: "Take this, and good luck.", ...more });

/** A unit next to the object, with a sword in hand that deals 12. */
const visitor = (more = {}) => ({ tile: at(3, 3), opens: [], keys: [], pillages: false, raider: false, damage: 12, range: { min: 1, max: 1 }, ...more });
const key = (name, effect, uses = 1) => ({ id: name.toLowerCase().replace(/ /g, "-"), name, opens: keyOpens(effect), uses });
const DOOR_KEY = key("Door Key", "Opens a door.");
const CHEST_KEY = key("Chest Key", "Opens a chest.");
const MASTER_KEY = key("Master Key", "Opens a chest or door.", 2);

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

test("a map object is a door, a chest or a Village on a tile; a door has the HP of its kind", () => {
  assert.deepEqual(OBJECT_KINDS, ["door", "chest", "village"]);
  assert.equal(normalizeObject({ kind: "lever", i: 1, j: 1 }), null);
  assert.equal(normalizeObject({ kind: "door" }), null);
  assert.deepEqual([door().door, door().hp], ["wooden", { value: 25, max: 25 }]);
  assert.deepEqual(door({ door: "castle" }).hp, { value: 100, max: 100 });
  assert.deepEqual(door({ door: "iron", hp: { value: 12 } }).hp, { value: 12, max: 50 });
  assert.equal(door({ door: "paper" }).door, "wooden");

  // The table of doors in The Map
  const hp = Object.fromEntries(Object.entries(FEO.objects.doors).map(([name, entry]) => [name, entry.hp]));
  assert.deepEqual(hp, { wooden: 25, reinforcedWooden: 40, iron: 50, reinforcedIron: 65, portcullis: 80, castle: 100 });
  assert.equal(chest().hp.max, 0);
  assert.equal(objectAt([door(), chest({ i: 5, j: 5 })], at(5, 5)).kind, "chest");
  assert.equal(objectAt([door()], at(0, 0)), null);
});

test("a door that is shut is a wall to everyone, and a Village that stands is a House", () => {
  assert.equal(blocksWay(door()), true);
  assert.equal(blocksWay(door({ open: true })), false);
  assert.equal(blocksWay(door({ broken: true })), false);
  assert.equal(blocksWay(chest()), false);
  assert.equal(blocksWay(null), false);
  assert.equal(objectTerrain(door()), "wall");
  assert.equal(terrainType(objectTerrain(door())).impassable, true, "nobody crosses it, and nobody sees past it");
  assert.equal(objectTerrain(door({ open: true })), null);
  assert.equal(objectTerrain(village()), "house");
  assert.equal(objectTerrain(village({ visited: true })), "house", "a Village that shut its gates still stands");
  assert.equal(objectTerrain(village({ destroyed: true })), null);
  assert.equal(objectTerrain(chest()), null);
  assert.equal(objectTerrain(null), null);
});

/* -------------------------------------------- */
/*  Doors                                       */
/* -------------------------------------------- */

test("a door is opened from next to it, with a key that opens doors or by a skill", () => {
  assert.equal(canOpen(visitor(), door()).why, "key");
  assert.equal(canOpen(visitor({ keys: [CHEST_KEY] }), door()).why, "key", "a Chest Key opens no door");
  const keyed = canOpen(visitor({ keys: [CHEST_KEY, DOOR_KEY] }), door());
  assert.deepEqual([keyed.ok, keyed.by, keyed.name, keyed.key], [true, "key", "Door Key", "door-key"]);
  assert.equal(canOpen(visitor({ keys: [MASTER_KEY] }), door()).ok, true);
  assert.equal(canOpen(visitor({ keys: [{ ...DOOR_KEY, uses: 0 }] }), door()).why, "key", "a key with no use left opens nothing");
  assert.equal(canOpen(visitor({ keys: [{ ...DOOR_KEY, uses: null }] }), door()).ok, true, "one that never runs out does");

  // Thievery opens it without a key, and before a key is spent
  const knacks = skillKnacks([skill("Thievery")]);
  const picked = canOpen(visitor({ opens: knacks.opens, opensBy: knacks.skills.opens, keys: [DOOR_KEY] }), door());
  assert.deepEqual([picked.ok, picked.by, picked.name, picked.key], [true, "skill", "Thievery", undefined]);

  // Only from a tile next to it; an open door is opened no more
  assert.equal(canOpen(visitor({ keys: [DOOR_KEY], tile: at(3, 2) }), door()).why, "apart");
  assert.equal(canOpen(visitor({ keys: [DOOR_KEY], tile: at(4, 5) }), door()).why, "apart");
  assert.equal(canOpen(visitor({ keys: [DOOR_KEY] }), door({ open: true })).why, "spent");
  assert.equal(afterAct(door(), keyed).open, true);
  assert.equal(blocksWay(afterAct(door(), keyed)), false);
  assert.deepEqual(yieldOf(door(), keyed), { gold: 0, items: [], note: "" });
});

test("a door a unit cannot open is broken down: an attack takes its damage off the door's HP", () => {
  const strike = canBreak(visitor(), door());
  assert.deepEqual([strike.ok, strike.damage, strike.left], [true, 12, 13]);
  const once = afterAct(door(), strike);
  assert.deepEqual([once.hp.value, once.broken, blocksWay(once)], [13, false, true]);
  const twice = afterAct(once, canBreak(visitor(), once));
  assert.deepEqual([twice.hp.value, twice.broken], [1, false]);
  const thrice = afterAct(twice, canBreak(visitor(), twice));
  assert.deepEqual([thrice.hp.value, thrice.broken, blocksWay(thrice), isSpent(thrice)], [0, true, false, true]);

  // It takes a weapon in hand that reaches the door from where the unit stands
  assert.equal(canBreak(visitor({ range: null }), door()).why, "unarmed");
  assert.equal(canBreak(visitor({ tile: at(3, 2) }), door()).why, "range");
  assert.equal(canBreak(visitor({ tile: at(3, 2), range: { min: 2, max: 2 } }), door()).ok, true);
  assert.equal(canBreak(visitor({ range: { min: 2, max: 2 } }), door()).why, "range");
  assert.equal(canBreak(visitor(), chest()).why, "cannot", "a chest is not broken open");

  // What a unit does with a door as its Action: it opens it where it can, and strikes it otherwise
  assert.equal(actOn(visitor({ keys: [DOOR_KEY] }), door()).act, "open");
  assert.equal(actOn(visitor(), door()).act, "break");
  const stuck = actOn(visitor({ range: null }), door());
  assert.deepEqual([stuck.act, stuck.ok, stuck.why], ["open", false, "key"]);
});

/* -------------------------------------------- */
/*  Chests                                      */
/* -------------------------------------------- */

test("a chest is opened from its tile or from next to it, and gives what was put in it", () => {
  assert.equal(canOpen(visitor(), chest()).why, "key");
  assert.equal(canOpen(visitor({ keys: [DOOR_KEY] }), chest()).why, "key", "a Door Key opens no chest");
  const opened = canOpen(visitor({ keys: [CHEST_KEY] }), chest());
  assert.deepEqual([opened.ok, opened.by, opened.key], [true, "key", "chest-key"]);
  assert.equal(canOpen(visitor({ keys: [CHEST_KEY], tile: at(3, 4) }), chest()).ok, true, "from its own tile");
  assert.equal(canOpen(visitor({ keys: [CHEST_KEY], tile: at(5, 4) }), chest()).why, "apart");
  assert.equal(canOpen(visitor({ opens: ["door", "chest"], opensBy: "Thievery" }), chest()).by, "skill");

  const gains = yieldOf(chest(), opened);
  assert.deepEqual([gains.gold, gains.items.map((item) => item.name), gains.note], [200, ["Steel Sword"], ""]);
  const after = afterAct(chest(), opened);
  assert.deepEqual([after.open, isSpent(after)], [true, true]);
  assert.equal(canOpen(visitor({ keys: [CHEST_KEY] }), after).why, "spent");
  assert.equal(actOn(visitor(), chest()).ok, false, "a chest is not broken open");
});

/* -------------------------------------------- */
/*  Villages                                    */
/* -------------------------------------------- */

test("a Village is visited from its tile for the reward that was set, once", () => {
  assert.equal(canVisit(visitor(), village()).why, "apart");
  const visit = canVisit(visitor({ tile: at(3, 4) }), village());
  assert.equal(visit.ok, true);
  const gains = yieldOf(village(), visit);
  assert.deepEqual([gains.gold, gains.items.map((item) => item.name), gains.note], [500, ["Elixir"], "Take this, and good luck."]);
  const after = afterAct(village(), visit);
  assert.deepEqual([after.visited, isSpent(after)], [true, true]);
  assert.equal(canVisit(visitor({ tile: at(3, 4) }), after).why, "shut");

  // A unit that is no friend of the players' side does not visit
  assert.equal(canVisit(visitor({ tile: at(3, 4), raider: true }), village()).why, "cannot");
});

test("Pillage: an enemy with it destroys a Village from its tile, and nothing is to be had from it then", () => {
  const bandit = (more = {}) => visitor({ tile: at(3, 4), pillages: skillKnacks([skill("Pillage")]).pillages, raider: true, ...more });
  const raid = canPillage(bandit(), village());
  assert.equal(raid.ok, true);
  assert.equal(actOn(bandit(), village()).act, "pillage");
  const ruins = afterAct(village(), raid);
  assert.deepEqual([ruins.destroyed, isSpent(ruins)], [true, true]);
  assert.deepEqual(yieldOf(village(), raid), { gold: 0, items: [], note: "" });
  assert.equal(canVisit(visitor({ tile: at(3, 4) }), ruins).why, "spent");

  // Not from next to it, not without the skill, not by a unit of the players' side, and not once it was visited
  assert.equal(canPillage(bandit({ tile: at(3, 3) }), village()).why, "apart");
  assert.equal(canPillage(bandit({ pillages: false }), village()).why, "cannot");
  assert.equal(canPillage(bandit({ raider: false }), village()).why, "cannot");
  assert.equal(actOn(bandit({ raider: false }), village()).act, "visit", "a Bandit of the players' side visits");
  assert.equal(canPillage(bandit(), village({ visited: true })).why, "shut");
  assert.equal(actOn(bandit({ pillages: false }), village()).ok, false, "an enemy without it does nothing with a Village");
});

/* -------------------------------------------- */
/*  From Where a Unit Stands                    */
/* -------------------------------------------- */

test("what a unit can act on from where it stands", () => {
  const map = [door({ id: "d1", i: 3, j: 4 }), door({ id: "d2", i: 9, j: 9 }), chest({ id: "c1", i: 2, j: 3 }), chest({ id: "c2", i: 4, j: 3, open: true }),
    village({ id: "v1", i: 3, j: 3 })];
  const acts = actsFor(visitor({ keys: [MASTER_KEY] }), map);
  assert.deepEqual(acts.map((act) => `${act.object.id}:${act.act}`), ["d1:open", "c1:open", "v1:visit"]);

  // Without a key it can still strike the door, and visit
  assert.deepEqual(actsFor(visitor(), map).map((act) => `${act.object.id}:${act.act}`), ["d1:break", "v1:visit"]);
  assert.deepEqual(actsFor(visitor({ tile: at(7, 7) }), map), []);
});

/**
 * Tests for `module/rules/linking.mjs`: which copies of a unit hold nothing of their own, and can be made one
 * with it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bare, keepsNothing } from "../module/rules/linking.mjs";

/** A token's copy of its unit as Foundry keeps it when nothing was changed on it. */
const untouched = () => ({
  _id: "delta0000000001", name: null, type: null, img: null, system: {}, items: [], effects: [], ownership: null, flags: {}
});

test("nothing, an empty list and an object with nothing in it are bare", () => {
  assert.equal(bare(null), true);
  assert.equal(bare(undefined), true);
  assert.equal(bare([]), true);
  assert.equal(bare({}), true);
  assert.equal(bare({ hp: {}, flags: { "fire-emblem-online": {} }, items: [] }), true);
});

test("a value that says something is not bare, even one that says nothing much", () => {
  assert.equal(bare(0), false);
  assert.equal(bare(""), false);
  assert.equal(bare(false), false);
  assert.equal(bare({ hp: { value: 0 } }), false);
  assert.equal(bare([null]), false);
});

test("a token that never had a copy of its own, or never changed it, keeps nothing", () => {
  assert.equal(keepsNothing(null), true);
  assert.equal(keepsNothing(undefined), true);
  assert.equal(keepsNothing(untouched()), true);
  assert.equal(keepsNothing({ _id: "delta0000000001" }), true);
});

test("a copy that took a wound, an item, a name or a mark keeps something", () => {
  assert.equal(keepsNothing({ ...untouched(), system: { hp: { value: 3 } } }), false);
  assert.equal(keepsNothing({ ...untouched(), items: [{ _id: "item000000000001", name: "Iron Sword" }] }), false);
  assert.equal(keepsNothing({ ...untouched(), items: [{ _id: "item000000000001", _tombstone: true }] }), false);
  assert.equal(keepsNothing({ ...untouched(), name: "Mira the Second" }), false);
  assert.equal(keepsNothing({ ...untouched(), flags: { "fire-emblem-online": { moved: true } } }), false);
});

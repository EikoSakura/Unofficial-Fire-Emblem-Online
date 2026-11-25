/**
 * Tests for `module/rules/migration.mjs`: what a skill a unit already has takes from the skills compendium.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESSORY_TAKES, KEPT, accessoryToWear, planRefresh, same, shelve, sourceOf } from "../module/rules/migration.mjs";

const PREFIX = "Compendium.fire-emblem-online.";
const uuid = (id) => `${PREFIX}skills.Item.${id}`;

/** A skill as the compendium has it. */
const entry = (id, name, system = {}, img = `icons/${id}.webp`) => ({
  uuid: uuid(id),
  name,
  img,
  system: {
    kind: "generic", equipped: true, effect: `${name} does something.`, effects: [], picks: [], choice: "", raises: 0,
    automate: true, usage: { kind: "", cooldown: 0, early: null }, state: { active: false, cooldown: 0, used: 0, picked: {} },
    ...system
  }
});

/** A copy of it on a unit, changed as told. */
const copy = (from, { system = {}, link = from.uuid, ...rest } = {}) => ({
  name: from.name,
  img: from.img,
  system: { ...structuredClone(from.system), ...system },
  _stats: { compendiumSource: link },
  ...rest
});

const vantage = entry("vantage", "Vantage", { effects: [{ on: "attacked", first: true }] });
const blow = entry("blow", "Blow", { effects: [{ choice: "Death Blow", stats: { str: 6 } }] });
const lordCharm = entry("charm-lord", "Charm", { kind: "class" });
const bardCharm = entry("charm-bard", "Charm", { kind: "promotion" });
const twinA = entry("twin-a", "Twin", { kind: "enemy" });
const twinB = entry("twin-b", "Twin", { kind: "enemy" });
const shelf = shelve([vantage, blow, lordCharm, bardCharm, twinA, twinB]);

test("values are compared whatever the order of their keys", () => {
  assert.equal(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assert.equal(same({ a: 1 }, { a: 1, b: undefined }), true);
  assert.equal(same({ a: 1 }, { a: 1, b: null }), false);
  assert.equal(same([1, 2], [2, 1]), false);
  assert.equal(same([], {}), false);
  assert.equal(same(null, {}), false);
  assert.equal(same("", 0), false);
});

test("a skill is a copy of the entry it names, whatever it was renamed to", () => {
  const found = sourceOf(copy(vantage, { name: "My Vantage" }), shelf, { prefix: PREFIX });
  assert.equal(found.by, "link");
  assert.equal(found.entry, vantage);
});

test("a skill from a compendium that is not the system's is left alone, even by name", () => {
  const found = sourceOf(copy(vantage, { link: "Compendium.world.homebrew.Item.abc" }), shelf, { prefix: PREFIX });
  assert.deepEqual(found, { entry: null, by: "foreign" });
});

test("a skill made by hand, or whose entry is gone, is matched by its name", () => {
  assert.equal(sourceOf({ name: " vantage ", system: { kind: "generic" } }, shelf, { prefix: PREFIX }).entry, vantage);
  const gone = sourceOf(copy(vantage, { link: uuid("no-longer-there") }), shelf, { prefix: PREFIX });
  assert.equal(gone.by, "name");
  assert.equal(gone.entry, vantage);
  assert.deepEqual(sourceOf({ name: "Homebrew Strike" }, shelf, { prefix: PREFIX }), { entry: null, by: "none" });
});

test("a name several skills share is settled by the kind, or not at all", () => {
  assert.equal(sourceOf({ name: "Charm", system: { kind: "promotion" } }, shelf, { prefix: PREFIX }).entry, bardCharm);
  assert.deepEqual(sourceOf({ name: "Charm", system: { kind: "generic" } }, shelf, { prefix: PREFIX }), { entry: null, by: "shared" });
  assert.deepEqual(sourceOf({ name: "Twin", system: { kind: "enemy" } }, shelf, { prefix: PREFIX }), { entry: null, by: "shared" });
});

test("a skill that is as its entry has it is left alone", () => {
  assert.equal(planRefresh(copy(vantage), vantage), null);
});

test("what is the unit's own is never a reason to change a skill, and is never taken", () => {
  const mine = copy(blow, {
    system: { equipped: false, choice: "Death Blow", raises: 2, automate: false, state: { active: true, cooldown: 3, used: 1, picked: { a: 1 } } }
  });
  assert.equal(planRefresh(mine, blow), null);

  const old = copy(blow, { system: { ...mine.system, effects: [], effect: "Old words." } });
  const plan = planRefresh(old, blow);
  assert.deepEqual(plan.fields.sort(), ["effect", "effects"]);
  for ( const key of KEPT ) assert.equal(key in plan.system, false, key);
});

test("a skill from before the system applied it takes what the skill is from its entry", () => {
  const old = copy(vantage, { img: "icons/svg/aura.svg", system: { effects: [], usage: { kind: "", cooldown: 0, early: { condition: "stun" } } } });
  const plan = planRefresh(old, vantage);
  assert.deepEqual(plan.system, { effects: vantage.system.effects, usage: vantage.system.usage });
  assert.equal(plan.img, vantage.img);
  assert.deepEqual(plan.fields, ["effects", "usage", "img"]);
  assert.equal("link" in plan, false);
});

test("a skill matched by its name is a copy of its entry from then on", () => {
  const blank = { name: "Vantage", img: "icons/svg/item-bag.svg", system: { kind: "generic", effect: "" } };
  const plan = planRefresh(blank, vantage);
  assert.equal(plan.link, vantage.uuid);
  assert.equal(plan.system.effect, vantage.system.effect);
  assert.deepEqual(plan.system.effects, vantage.system.effects);
});

test("an accessory takes what it is from its entry, and keeps its icon, its uses and whether it is worn", () => {
  const ring = {
    uuid: `${PREFIX}items.Item.speed-ring`, name: "Speed Ring", img: "icons/ring.webp",
    system: { effect: "Unit gains +5 SPD.", uses: { value: 0, max: 0 }, cost: 8000, equip: true, restore: 0, equipped: false, description: "" }
  };
  const old = {
    name: "Speed Ring", img: "icons/my-own.webp", _stats: { compendiumSource: ring.uuid },
    system: { effect: "Unit gains +4 SPD.", uses: { value: 3, max: 5 }, cost: 100, equip: true, restore: 0, equipped: true, description: "Mine." }
  };
  const plan = planRefresh(old, ring, { only: ACCESSORY_TAKES });
  assert.deepEqual(plan.system, { effect: "Unit gains +5 SPD.", cost: 8000 });
  assert.equal("img" in plan, false);
  assert.deepEqual(plan.fields, ["effect", "cost"]);
  assert.equal(planRefresh({ ...old, system: { ...old.system, effect: ring.system.effect, cost: 8000 } }, ring, { only: ACCESSORY_TAKES }), null);
});

test("a unit that carries accessories and wears none puts on the first of its sheet, once", () => {
  assert.equal(accessoryToWear([]), null);
  assert.equal(accessoryToWear([{ id: "a", equipped: false, sort: 200 }]), "a");
  assert.equal(accessoryToWear([{ id: "a", equipped: false, sort: 200 }, { id: "b", equipped: false, sort: 100 }]), "b");
  assert.equal(accessoryToWear([{ id: "a", equipped: false, sort: 0 }, { id: "b", equipped: false, sort: 0 }]), "a");
  assert.equal(accessoryToWear([{ id: "a", equipped: false, sort: 200 }, { id: "b", equipped: true, sort: 300 }]), null, "one is worn already");
});

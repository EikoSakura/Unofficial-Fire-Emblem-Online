/**
 * Tests for `module/rules/classes.mjs`: what Step 3 added to promoting.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planPromotion } from "../module/rules/classes.mjs";

/** A unit's saved data, as far as promoting reads it. */
const unit = () => ({
  level: 20,
  hp: { value: 20, max: 24 },
  stats: Object.fromEntries(["str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con", "los"].map((key) => [key, { base: 5 }])),
  wt: { class: 2 },
  proficiencies: { sword: { rank: "D" } },
  growths: { hp: 50, str: 40, mag: 10, def: 30, res: 20, dex: 40, spd: 40, luk: 30 },
  specialQualities: ""
});

/** A class of some tier that teaches one skill for it. */
const cls = (name, tier, skills) => ({
  name,
  system: {
    tier, race: "beorc", wt: 2, gains: { hp: 4, str: 2 }, caps: {}, specialQualities: "",
    proficiencies: { options: [], choose: 0, note: "" },
    skills: { starting: "", promotion: "", occult: "", mastery: "", ...skills },
    promotesTo: []
  }
});

test("a promotion learns the skill of the new class", () => {
  const change = planPromotion(unit(), cls("Lord", "base", {}), cls("Great Lord", "second", { promotion: "Charm" }));
  assert.deepEqual(change.skills, [{ name: "Charm", kind: "promotion" }]);
  assert.equal(change.raised, null);
  assert.equal(change.genericSkill, false);
});

test("a skill can be raised in place of a Promotion or a Mastery Skill", () => {
  const second = planPromotion(unit(), cls("Lord", "base", {}), cls("Great Lord", "second", { promotion: "Charm" }), { raise: "Authority" });
  assert.equal(second.raised, "Authority");
  assert.deepEqual(second.skills, []);
  assert.equal(second.genericSkill, false);
  assert.deepEqual(second.stats.map((stat) => stat.key), ["str"], "the class is taken as it would be otherwise");

  const third = planPromotion(unit(), cls("Great Lord", "second", {}), cls("Emperor", "third", { mastery: "Aether" }), { raise: "Authority" });
  assert.equal(third.raised, "Authority");
  assert.deepEqual(third.skills, []);

  // Raising goes before a Generic Skill in the skill's place: only one of them is taken
  const both = planPromotion(unit(), cls("Lord", "base", {}), cls("Great Lord", "second", { promotion: "Charm" }), { raise: "Authority", generic: true });
  assert.equal(both.raised, "Authority");
  assert.equal(both.genericSkill, false);
});

test("the skill a class starts its units with is not given up for a raise", () => {
  const change = planPromotion(unit(), cls("Recruit", "trainee", {}), cls("Lord", "base", { starting: "Authority" }), { raise: "Authority" });
  assert.equal(change.raised, null);
  assert.deepEqual(change.skills, [{ name: "Authority", kind: "class" }]);
});

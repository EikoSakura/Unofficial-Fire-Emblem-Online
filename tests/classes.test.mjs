/**
 * Tests for `module/rules/classes.mjs`: what Step 3 added to promoting.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planAssignment, planPromotion, variedCon } from "../module/rules/classes.mjs";

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

/* -------------------------------------------- */
/*  A CON that varies                           */
/* -------------------------------------------- */

/** The Class Sheet's Mage: its CON goes by the highest proficiency at Character Creation. */
const mage = {
  name: "Mage",
  system: {
    tier: "base", wt: 0,
    base: { hp: 17, str: 1, mag: 7, def: 3, res: 7, dex: 8, spd: 6, luk: 4, mov: 6, con: null, los: 2 },
    conBy: { sword: null, light: 5, wind: 5, fire: 6, water: 6, thunder: 7, earth: 7 },
    proficiencies: { options: ["fire", "thunder", "wind", "water", "earth", "light"], choose: 2, note: "" },
    skills: { starting: "", promotion: "", occult: "", mastery: "" },
    specialQualities: "", promotesTo: []
  }
};

test("a CON that varies is the one the highest proficiency stands for", () => {
  assert.equal(variedCon(mage, { light: "D", thunder: "E" }), 5);
  assert.equal(variedCon(mage, { wind: "D" }), 5);
  assert.equal(variedCon(mage, { fire: "D", wind: "E" }), 6);
  assert.equal(variedCon(mage, { water: "C" }), 6);
  assert.equal(variedCon(mage, { thunder: "D", light: "E" }), 7);
  assert.equal(variedCon(mage, { earth: "D", fire: "E" }), 7);
});

test("of proficiencies of the same rank the one that stands for the most CON counts", () => {
  assert.equal(variedCon(mage, { light: "E", fire: "E", thunder: "E" }), 7);
  assert.equal(variedCon(mage, { light: "E", water: "E" }), 6);
});

test("a class gives no varied CON without a proficiency it lists, or with a CON of its own", () => {
  assert.equal(variedCon(mage, {}), null);
  assert.equal(variedCon(mage, { fire: "F", sword: "D", dark: "D" }), null);
  const fixed = { ...mage, system: { ...mage.system, base: { ...mage.system.base, con: 6 } } };
  assert.equal(variedCon(fixed, { thunder: "D" }), null);
  assert.equal(variedCon({ name: "Fighter", system: { base: { con: null } } }, { axe: "D" }), null);
});

test("taking a class with its stats sets a CON that varies by the ranks given, or by those the unit has", () => {
  const blank = () => ({
    ...unit(), hp: { max: 0, value: 0 }, wt: { class: 0 }, specialQualities: "",
    stats: Object.fromEntries(Object.keys(mage.system.base).filter((key) => key !== "hp").map((key) => [key, { base: 0 }])),
    proficiencies: { thunder: { rank: "D" }, light: { rank: "E" } }
  });
  const conOf = (change) => change.stats.find((stat) => stat.key === "con")?.to;
  assert.equal(conOf(planAssignment(blank(), mage, { stats: true, proficiencies: { wind: "D", fire: "E" } })), 5);
  assert.equal(conOf(planAssignment(blank(), mage, { stats: true })), 7);
  assert.equal(conOf(planAssignment(blank(), mage, { proficiencies: { wind: "D" } })), undefined);
});

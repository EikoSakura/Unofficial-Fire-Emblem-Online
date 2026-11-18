/**
 * Tests for `module/rules/creation.mjs`: what a unit with more placed than it has may still do.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import {
  freeGrowth, growthBudget, helpSteps, planCheck, planGrowth, pointBudget, readCreation
} from "../module/rules/creation.mjs";

/** A class of a tier, as far as the growth points read it. */
const cls = (tier) => ({ name: tier, system: { tier } });

/** A unit's saved data with every growth point of a starting class placed. */
const unit = () => ({
  level: 1,
  boon: "",
  bane: "",
  stats: { spd: { base: 6 }, mag: { base: 2 } },
  abilities: { cha: { source: "spd", increase: 0, boost: 0 }, int: { source: "mag", increase: 0, boost: 0 } },
  // 245 over the 10 each rate starts at, and the 25 kept for Charm and Intelligence
  growths: { hp: 80, str: 60, mag: 10, def: 40, res: 20, dex: 45, spd: 50, luk: 20, cha: 35, int: 10 },
  checks: { acrobatics: { points: 0 }, athletics: { points: 0 } }
});

test("a unit of a starting class has every growth point placed", () => {
  const budget = growthBudget(unit(), { free: freeGrowth(cls("base")) });
  assert.equal(budget.freeLeft, 0);
  assert.equal(budget.abilityLeft, 0);
});

test("a unit that became a Trainee has too many placed, and may still lower a growth rate", () => {
  const options = { free: freeGrowth(cls("trainee")) };
  const made = unit();
  assert.equal(growthBudget(made, options).freeLeft, FEO.classTiers.trainee.growthPoints - FEO.creation.growth.free);

  // Nothing may rise while there is too much placed
  assert.equal(planGrowth(made, "mag", 15, options), null);
  assert.equal(planGrowth(made, "int", 15, options), null);

  // Anything may fall, Charm and Intelligence too
  assert.deepEqual(planGrowth(made, "str", 55, options)?.update, { "system.growths.str": 55 });
  assert.deepEqual(planGrowth(made, "cha", 30, options)?.update, { "system.growths.cha": 30 });
});

test("lowering growth rates until none are over frees them to be placed again", () => {
  const options = { free: freeGrowth(cls("trainee")) };
  const made = unit();
  made.growths.hp = 40;
  assert.equal(growthBudget(made, options).freeLeft, 0);
  assert.equal(planGrowth(made, "mag", 15, options), null);
  made.growths.str = 55;
  assert.deepEqual(planGrowth(made, "mag", 15, options)?.update, { "system.growths.mag": 15 });
});

test("a growth rate past its cap may come down a step at a time", () => {
  const made = unit();
  made.growths.hp = 90;
  const options = { free: freeGrowth(cls("base")) };
  assert.deepEqual(planGrowth(made, "hp", 85, options)?.update, { "system.growths.hp": 85 });
  assert.equal(planGrowth(made, "hp", 95, options), null);
});

test("a growth rate does not fall below where it starts, nor rise past its cap", () => {
  const options = { free: freeGrowth(cls("base")) };
  const made = unit();
  assert.equal(planGrowth(made, "mag", 5, options), null);
  made.growths.def = 35;
  assert.equal(planGrowth(made, "str", 65, options), null);
});

test("ability points may be taken off a unit that has more placed than it has", () => {
  const made = unit();
  // Charm 6 gives 30 points, and 5 more for saving throws; 40 are placed on what is no saving throw
  made.checks = { acrobatics: { points: 6 }, athletics: { points: 34 } };
  const budget = pointBudget(made);
  assert.ok(budget.generalLeft < 0);
  assert.equal(planCheck(made, "acrobatics", 7), null);
  assert.deepEqual(planCheck(made, "acrobatics", 5)?.update, { "system.checks.acrobatics.points": 5 });

  // One past the most a check may hold comes down too
  assert.ok(made.checks.athletics.points > budget.limit);
  assert.deepEqual(planCheck(made, "athletics", 33)?.update, { "system.checks.athletics.points": 33 });
});

test("help is waited for on the steps where it was asked and not yet answered", () => {
  const none = {};
  assert.deepEqual(helpSteps(readCreation(undefined), none), []);

  // Told in the Creator's order, whatever the order they were asked in; an answered step is blank again
  const record = readCreation({ help: { gold: "user1", class: "user2", skills: "" } });
  assert.deepEqual(helpSteps(record, none), ["class", "gold"]);

  // A step of an Optional Module waits only while the world plays with it
  const blood = readCreation({ help: { holyBlood: "user1" } });
  assert.deepEqual(helpSteps(blood, none), []);
  assert.deepEqual(helpSteps(blood, { holyBlood: { enabled: true } }), ["holyBlood"]);
});

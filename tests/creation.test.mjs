/**
 * Tests for `module/rules/creation.mjs`: what a unit with more placed than it has may still do.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import {
  chosenCon, freeGrowth, growthBudget, helpSteps, planCheck, planClass, planGrowth, planRanks, pointBudget, readCreation
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

/* -------------------------------------------- */
/*  A CON that goes by the highest proficiency  */
/* -------------------------------------------- */

const CLASS_STATS = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con", "los"];

/** A starting class as the Class Sheet lists it; its CON varies where `con` is left out. */
const starting = (name, { con = null, conBy = {}, options = [], choose = 0 } = {}) => ({
  name,
  system: {
    tier: "base", wt: 0, specialQualities: "",
    base: { hp: 17, str: 1, mag: 7, def: 3, res: 7, dex: 8, spd: 6, luk: 4, mov: 6, con, los: 2 },
    conBy,
    proficiencies: { options, choose, firstRank: "", note: "" }
  }
});
const mage = starting("Mage", {
  options: ["fire", "thunder", "wind", "water", "earth", "light"], choose: 2,
  conBy: { light: 5, wind: 5, fire: 6, water: 6, thunder: 7, earth: 7 }
});
const monk = starting("Monk", { con: 6, options: ["light"] });
const shaman = starting("Shaman", { options: ["wind"], conBy: { wind: 4 } });

/** A unit nothing has been chosen for, and the same unit once a plan is saved. */
const fresh = () => ({
  level: 1, boon: "", bane: "", gold: 0, specialQualities: "", skillRanks: [],
  hp: { max: 0, value: 0 },
  wt: { class: 0 },
  stats: Object.fromEntries(CLASS_STATS.filter((key) => key !== "hp").map((key) => [key, { base: 0 }])),
  abilities: { cha: { source: "spd", increase: 0, boost: 0 }, int: { source: "mag", increase: 0, boost: 0 } },
  growths: {},
  checks: {},
  proficiencies: Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => [key, { rank: "F" }]))
});
const saved = (made, record, plan) => {
  for ( const [path, value] of Object.entries(plan.update) ) {
    const keys = path.split(".").slice(1);
    const last = keys.pop();
    keys.reduce((at, key) => (at[key] ??= {}), made)[last] = value;
  }
  const raw = structuredClone(record);
  for ( const [path, value] of Object.entries(plan.record) ) {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((at, key) => (at[key] ??= {}), raw)[last] = value;
  }
  return readCreation(raw);
};

test("a Mage's CON follows its highest proficiency as it is chosen", () => {
  const made = fresh();
  let record = readCreation({});
  record = saved(made, record, planClass(made, record, null, mage));
  assert.equal(made.stats.con.base, 0, "nothing is taken yet");

  // Two taken and neither chosen to start higher: the one that stands for more, for now
  record = saved(made, record, planRanks(made, record, mage, ["wind", "thunder"], ""));
  assert.equal(made.stats.con.base, 7);
  record = saved(made, record, planRanks(made, record, mage, ["wind", "thunder"], "wind"));
  assert.equal(made.stats.con.base, 5);
  assert.equal(made.proficiencies.wind.rank, "D");
  record = saved(made, record, planRanks(made, record, mage, ["wind", "thunder"], "thunder"));
  assert.equal(made.stats.con.base, 7);
  record = saved(made, record, planRanks(made, record, mage, ["fire", "light"], "fire"));
  assert.equal(made.stats.con.base, 6);
  assert.equal(record.con, 6);

  // What else the Creator has put on CON stays on top
  made.stats.con.base += 2;
  record = saved(made, record, planRanks(made, record, mage, ["fire", "light"], "light"));
  assert.equal(made.stats.con.base, 7);
  record = saved(made, record, planRanks(made, record, mage, [], ""));
  assert.equal(made.stats.con.base, 2);
  assert.equal(record.con, 0);
});

test("changing class takes back the CON the old class gave for a proficiency, and gives the new one's", () => {
  const made = fresh();
  let record = readCreation({});
  record = saved(made, record, planClass(made, record, null, mage));
  record = saved(made, record, planRanks(made, record, mage, ["earth", "light"], "earth"));
  assert.equal(made.stats.con.base, 7);

  // To a class with a CON of its own
  record = saved(made, record, planClass(made, record, mage, monk));
  assert.equal(made.stats.con.base, 6);
  assert.equal(record.con, 0);

  // To one whose only proficiency settles it at once, and back
  record = saved(made, record, planClass(made, record, monk, shaman));
  assert.equal(made.stats.con.base, 4);
  assert.equal(record.con, 4);
  record = saved(made, record, planClass(made, record, shaman, mage));
  assert.equal(made.stats.con.base, 0);
  assert.equal(record.con, 0);
});

test("a unit that starts in a class with one proficiency has its CON from the first", () => {
  const made = fresh();
  made.boon = "con";
  const record = saved(made, readCreation({ bonus: { con: 1 } }), planClass(made, readCreation({ bonus: { con: 1 } }), null, shaman));
  assert.equal(made.stats.con.base, 4 + 1 + 1);
  assert.equal(record.con, 4);
});

test("a Mage made before its CON went by proficiency is put right when its proficiencies are next chosen", () => {
  const made = fresh();
  made.stats.con.base = 1;
  made.proficiencies.fire.rank = "D";
  made.proficiencies.wind.rank = "E";
  let record = readCreation({ class: { name: "Mage" }, bonus: { con: 1 }, ranks: { take: ["fire", "wind"], first: "fire" } });
  assert.equal(record.con, 0);
  record = saved(made, record, planRanks(made, record, mage, ["fire", "wind"], "fire"));
  assert.equal(made.stats.con.base, 7);
  assert.equal(chosenCon(mage, ["fire", "wind"], "fire"), 6);
});

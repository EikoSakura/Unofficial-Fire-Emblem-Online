/**
 * Tests for `module/rules/earnings.mjs`: what skills make of experience that is given, by a fight or by hand.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { standing } from "../module/rules/auras.mjs";
import { classGains, expSources, levelUpOutcome, scaleExp } from "../module/rules/earnings.mjs";
import { skill, unit } from "./lib/fixtures.mjs";

const award = (who, amount, options) => scaleExp(amount, expSources(who.skills, who.self, options), { stack: "multiply" }).amount;

test("Lineage and Elite multiply experience and Bonus EXP alike", () => {
  assert.equal(award(unit({ skills: [skill("Lineage")] }), 40), 50);
  assert.equal(award(unit({ skills: [skill("Lineage")] }), 40, { bonus: true }), 50);
  assert.equal(award(unit({ skills: [skill("Elite")] }), 40), 60);
  assert.equal(award(unit({ skills: [skill("Elite")] }), 40, { bonus: true }), 60);
  assert.equal(award(unit({ skills: [skill("Lineage"), skill("Elite")] }), 40), 75);
});

test("Greenhorn doubles experience, but not Bonus EXP", () => {
  const trainee = unit({ skills: [skill("Greenhorn")] });
  assert.equal(award(trainee, 30), 60);
  assert.equal(award(trainee, 30, { bonus: true }), 30);
});

test("Demiform halves experience while it is used, but not Bonus EXP", () => {
  assert.equal(award(unit({ skills: [skill("Demiform", { active: true })] }), 30), 15);
  assert.equal(award(unit({ skills: [skill("Demiform", { active: true })] }), 30, { bonus: true }), 30);
  assert.equal(award(unit({ skills: [skill("Demiform")] }), 30), 30);
});

test("Guidance gives the allies next to its unit half as much again", () => {
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const guide = { id: "guide", name: "Guide", side: "player", tile: { i: 0, j: 0 }, hp: 20, hpMax: 20, stats: {}, skills: [skill("Guidance")] };
  const pupil = { id: "pupil", name: "Pupil", side: "player", tile: { i: 0, j: 1 }, hp: 20, hpMax: 20, stats: {}, skills: [] };
  const near = unit({ skills: standing([guide, pupil], "pupil", measure).auras });
  assert.equal(award(near, 30), 45);
  assert.equal(award(near, 30, { bonus: true }), 45);
  const far = unit({ skills: standing([guide, { ...pupil, tile: { i: 0, j: 2 } }], "pupil", measure).auras });
  assert.equal(award(far, 30), 30);
});

/* -------------------------------------------- */
/*  Step 3: every level-up moment               */
/* -------------------------------------------- */

/** What a promotion changes, as `planPromotion` tells it. */
const promotion = {
  hpMax: { from: 24, to: 28 },
  hpValue: { from: 10, to: 14 },
  stats: [{ key: "str", from: 9, to: 11 }, { key: "def", from: 6, to: 7 }, { key: "mov", from: 5, to: 6 }, { key: "luk", from: 4, to: 4 }]
};

test("the stats a class gives count as the stats a level up raised", () => {
  assert.deepEqual(classGains(promotion).map(({ key, gain }) => [key, gain]), [["hp", 4], ["str", 2], ["def", 1], ["mov", 1]]);
  assert.deepEqual(classGains(null), []);
  assert.deepEqual(classGains({ stats: [], hpMax: null }), []);
});

test("Payment pays for each stat a promotion raises, as for each a level up rolls", () => {
  const who = unit({ skills: [skill("Payment")] });
  const rolled = [{ key: "str", gain: 1 }, { key: "spd", gain: 1 }, { key: "luk", gain: 0 }];
  assert.equal(levelUpOutcome(who.skills, who.self, rolled, { goldPerGain: "stat" }).goldTotal, 200);
  assert.equal(levelUpOutcome(who.skills, who.self, classGains(promotion), { goldPerGain: "stat" }).goldTotal, 400);
  assert.equal(levelUpOutcome(who.skills, who.self, classGains(promotion), { goldPerGain: "point" }).goldTotal, 800);
  assert.equal(levelUpOutcome(who.skills, who.self, [], { goldPerGain: "stat" }).goldTotal, 0, "a promotion applied by hand raises nothing here");
});

test("Revitalize heals at every level-up moment and boosts what it raised, Charm and Intelligence among it", () => {
  const who = unit({ hp: 14, hpMax: 28, skills: [skill("Revitalize")] });
  const promoted = levelUpOutcome(who.skills, who.self, classGains(promotion));
  assert.deepEqual(promoted.heal, { skill: "Revitalize", hp: 28, healed: 14 });
  assert.deepEqual(promoted.granted[0].change.effects, [{ stats: { str: 1, def: 1, mov: 1 }, hpMax: 1 }]);
  assert.deepEqual(promoted.granted[0].left, []);

  const rolled = levelUpOutcome(who.skills, who.self, [{ key: "cha", gain: 1 }, { key: "int", gain: 1 }, { key: "res", gain: 1 }]);
  assert.deepEqual(rolled.granted[0].change.effects, [{ stats: { res: 1 }, abilities: { cha: 1, int: 1 } }]);
  assert.deepEqual(rolled.granted[0].left, []);

  // A promotion applied by hand still heals, and boosts nothing
  const byHand = levelUpOutcome(who.skills, who.self, []);
  assert.equal(byHand.heal.healed, 14);
  assert.deepEqual(byHand.granted, []);
});

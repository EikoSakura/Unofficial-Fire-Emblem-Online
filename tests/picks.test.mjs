/**
 * Tests for `module/rules/picks.mjs`: what a skill has its unit pick as it is learnt, and for the skills of
 * Step 3 that pick something.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planVariant, skillVariants } from "../module/rules/creation.mjs";
import { skillGrowths } from "../module/rules/earnings.mjs";
import {
  checkPicks, chosenOf, pickStates, pickedOf, picksLocked, picksOf, picksOpen, planPick, readChoice, writeChoice
} from "../module/rules/picks.mjs";
import { rankSteps } from "../module/rules/skill-ranks.mjs";
import { effectsOf } from "../module/rules/skills.mjs";

const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../packs-src/skills/effects.json", import.meta.url)), "utf8")).skills;

/** A skill as its Item keeps it. */
const data = (name, choice = "") => ({ effects: listed[name].effects, picks: listed[name].picks ?? [], choice, automate: true });

test("a skill whose effects come in variants offers them without saying more", () => {
  const blow = data("Blow");
  const [pick] = picksOf(blow);
  assert.equal(pick.id, "variant");
  assert.equal(pick.count, 1);
  assert.equal(pick.options.length, 10);
  assert.equal(picksOpen(blow), true);
  assert.equal(planPick(blow, 0, "Death Blow"), "Death Blow");
  assert.equal(planPick(blow, 0, "No Such Blow"), null);
  assert.equal(picksOpen(data("Blow", "Death Blow")), false);
  assert.equal(planPick(data("Blow", "Death Blow"), 0, "Death Blow"), null, "picking what is picked changes nothing");
  assert.equal(planPick(data("Blow", "Death Blow"), 0, "Mighty Blow"), "Mighty Blow", "another variant takes its place");
});

test("a skill that is run by hand, or has nothing to pick, asks nothing", () => {
  assert.deepEqual(picksOf({ ...data("Blow"), automate: false }), []);
  assert.deepEqual(picksOf(data("Payment")), []);
  assert.equal(picksOpen(data("Payment")), false);
  assert.equal(picksLocked(data("Payment")), false);
});

test("Aptitude picks three growth rates, and the oldest makes room for a fourth", () => {
  let aptitude = data("Aptitude");
  const [state] = pickStates(aptitude);
  assert.equal(state.pick.from, "growths");
  assert.equal(state.pick.count, 3);
  assert.equal(state.open, true);
  for ( const key of ["HP", "STR", "SPD"] ) aptitude = { ...aptitude, choice: planPick(aptitude, 0, key) };
  assert.equal(aptitude.choice, "HP, STR, SPD");
  assert.equal(picksOpen(aptitude), false);
  assert.deepEqual(skillGrowths([{ name: "Aptitude", choice: aptitude.choice, effects: aptitude.effects }]).bonus, { hp: 10, str: 10, spd: 10 });
  assert.equal(planPick(aptitude, 0, "LUK"), "STR, SPD, LUK");
  assert.equal(planPick(aptitude, 0, "STR"), "HP, SPD", "one that is picked can be given up");
});

test("a complete pick is locked for players, not for the Game Master, and not in the Creator", () => {
  const open = data("Aptitude", "HP, STR");
  const done = data("Aptitude", "HP, STR, SPD");
  assert.equal(picksLocked(open), false);
  assert.equal(picksLocked(done), true);
  assert.equal(picksLocked(done, { gm: true }), false);
  assert.equal(picksLocked(done, { creating: true }), false);
  assert.equal(picksLocked(data("Altesse", "Male")), true);
});

test("Altesse, Advisor and the Tactics declare what they pick, with what each option does", () => {
  assert.deepEqual(picksOf(data("Altesse"))[0].options.map((option) => option.value), ["Male", "Female"]);
  assert.deepEqual(picksOf(data("Advisor"))[0].options.map((option) => option.value), ["Physical", "Magical"]);
  const [order] = picksOf(data("Knightly Tactics"));
  assert.equal(order.label, "Order");
  assert.equal(order.options.length, 6);
  assert.equal(order.options[0].hint, "+4 Skill Activation Rate, +1.5 RES");
  assert.equal(planPick(data("Knightly Tactics"), 0, "weißritter"), "Weißritter", "an option is found whatever its case");
  for ( const name of ["Altesse", "Advisor", "Knightly Tactics", "Imperial Tactics", "Practiced"] ) {
    assert.deepEqual(checkPicks(listed[name].picks, listed[name].effects), [], name);
  }
});

test("an effect marked with a choice applies while that is among what is picked", () => {
  assert.equal(effectsOf(data("Knightly Tactics")).length, 0);
  assert.equal(effectsOf(data("Knightly Tactics", "Rotritter")).length, 1);
  assert.equal(effectsOf(data("Imperial Tactics", "Todesrose")).length, 4);
  assert.deepEqual(chosenOf({ choice: "Fire; Forest, Hill" }), ["Fire; Forest, Hill", "Fire", "Forest", "Hill"]);
  const both = { effects: [{ choice: "Forest", stats: { def: 1 } }, { choice: "Hill", stats: { res: 1 } }, { choice: "Sea", stats: { spd: 1 } }], choice: "Forest, Hill" };
  assert.equal(effectsOf(both).length, 2);
});

test("Practiced asks for a starting proficiency only of a unit the Creator did not make", () => {
  const practiced = data("Practiced");
  const made = { proficiencies: ["sword", "lance"], start: "", creating: false };
  assert.equal(picksOpen(practiced, made), true);
  assert.deepEqual(pickStates(practiced, made)[0].options.map((option) => option.value), ["sword", "lance"]);
  assert.equal(planPick(practiced, 0, "lance", made), "lance");
  assert.deepEqual(pickedOf({ ...practiced, choice: "lance" }, "start"), ["lance"]);
  assert.deepEqual(rankSteps({ ...practiced, choice: "lance" }, { start: "lance" }), { lance: 1 });

  // In the Creator, and for a unit whose starting proficiency the Creator kept, nothing is asked
  assert.equal(picksOpen(practiced, { ...made, creating: true }), false);
  assert.equal(picksOpen(practiced, { ...made, start: "sword" }), false);
  assert.deepEqual(skillVariants(practiced), []);
  assert.equal(picksLocked(practiced, {}, { ...made, start: "sword" }), false, "what was never asked is not locked");
});

test("several picks are written one after the other, and points are spent by cost", () => {
  const song = {
    effects: [],
    picks: [
      { id: "tone", options: ["Bright", "Dark"] },
      { id: "verses", points: 4, options: [{ value: "Might", cost: 1 }, { value: "Guard", cost: 2 }, { value: "Wind", cost: 3 }] }
    ],
    choice: ""
  };
  assert.deepEqual(checkPicks(song.picks, song.effects), []);
  assert.deepEqual(readChoice("Dark; Might, Wind", 2), [["Dark"], ["Might", "Wind"]]);
  assert.equal(writeChoice([["Dark"], ["Might", "Wind"]]), "Dark; Might, Wind");
  let now = { ...song, choice: planPick(song, 1, "Wind") };
  assert.equal(now.choice, "; Wind");
  now = { ...now, choice: planPick(now, 0, "Dark") };
  assert.equal(now.choice, "Dark; Wind");
  assert.equal(planPick(now, 1, "Guard"), null, "3 + 2 points are more than 4");
  now = { ...now, choice: planPick(now, 1, "Might") };
  assert.equal(now.choice, "Dark; Wind, Might");
  const [, verses] = pickStates(now);
  assert.equal(verses.spent, 4);
  assert.equal(verses.open, false);
  assert.equal(picksOpen(now), false);
  assert.equal(planPick(now, 1, "Wind"), "Dark; Might", "an option can be given back");
});

test("a pick from the stats offers every stat in use", () => {
  const cheer = { effects: [], picks: [{ id: "stat", from: "stats" }], choice: "" };
  const [state] = pickStates(cheer, { stats: ["str", "mag", "def"] });
  assert.deepEqual(state.options.map((option) => option.value), ["STR", "MAG", "DEF"]);
  assert.equal(state.options[0].localize, true);
  assert.equal(planPick(cheer, 0, "mag", { stats: ["str", "mag", "def"] }), "MAG");
});

test("mistakes in the picks a skill declares are caught", () => {
  assert.equal(checkPicks(undefined).length, 0);
  assert.equal(checkPicks([]).length, 1);
  assert.equal(checkPicks([{ options: ["A", "B"] }]).length, 1, "a pick needs an id");
  assert.equal(checkPicks([{ id: "x", from: "moons" }]).length, 1);
  assert.equal(checkPicks([{ id: "x", options: ["A, B"] }]).length, 1);
  assert.equal(checkPicks([{ id: "x", options: ["A"], count: 0 }]).length, 1);
  assert.equal(checkPicks([{ id: "x" }], []).length, 1, "nothing to pick from");
  assert.equal(checkPicks([{ id: "x", options: ["A"] }], [{ choice: "B", stats: { str: 1 } }]).length, 1, "a variant that is not offered");
  assert.deepEqual(checkPicks([{ id: "x", label: "Kind", hints: { A: "does a" } }], [{ choice: "A", stats: { str: 1 } }]), []);
});

test("the Creator shows each pick of a starting skill and plans it the same way", () => {
  const [variant] = skillVariants(data("Ruse"));
  assert.equal(variant.kind, "variant");
  assert.equal(variant.options.length, 9);
  assert.equal(variant.open, true);
  assert.equal(planVariant(data("Ruse"), "MOV"), "MOV");
  const [growths] = skillVariants(data("Aptitude", "HP"));
  assert.equal(growths.kind, "growths");
  assert.equal(growths.count, 3);
  assert.deepEqual(growths.picked, ["HP"]);
  assert.equal(planVariant(data("Aptitude", "HP"), "DEX"), "HP, DEX");
});

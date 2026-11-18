import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { beatTime, fightCutIns, holdTime, planBeats, plateText, queueBeats, squashBeats } from "../module/rules/cut-ins.mjs";

const proc = (skill, by, more = {}) => ({ skill, by, on: "attack", roll: 10, chance: 50, success: true, ...more });
const names = (beats) => beats.map((beat) => beat.map((plate) => `${plate.unit}: ${plateText(plate).names.join(", ")}`).join(" | "));

test("a cut-in stays as long as its speed says, and not at all when off", () => {
  assert.equal(beatTime("normal"), FEO.cutIns.speeds.normal);
  assert.equal(beatTime("fast"), FEO.cutIns.speeds.fast);
  assert.ok(beatTime("fast") < beatTime("normal"));
  assert.equal(beatTime("off"), 0);
  assert.equal(beatTime(undefined), 0);
  assert.equal(beatTime("toString"), 0);
});

test("a fight tells of its rolled skills and answers in the order they happened", () => {
  const result = {
    opening: [proc("Vantage", "defender", { on: "start" })],
    attacks: [
      { side: "defender", procs: [proc("Pavise", "initiator", { on: "struck" })] },
      { side: "initiator", answers: [{ by: "defender", skill: "Capote" }], procs: [proc("Luna", "initiator"), proc("Sol", "initiator", { success: false })] }
    ],
    answers: [{ by: "initiator", skill: "Retreat" }],
    closing: [proc("Lifetaker", "initiator", { on: "after" })]
  };
  assert.deepEqual(fightCutIns(result), [
    { by: "defender", skill: "Vantage" },
    { by: "initiator", skill: "Pavise" },
    { by: "defender", skill: "Capote" },
    { by: "initiator", skill: "Luna" },
    { by: "initiator", skill: "Retreat" },
    { by: "initiator", skill: "Lifetaker" }
  ]);
});

test("a skill that is always on, or sure of its moment, does not flash; one that foils always does", () => {
  const result = {
    attacks: [{
      side: "initiator",
      procs: [
        proc("Triangle Attack", "initiator", { sure: true, roll: null }),
        proc("Nihil", "defender", { on: "foil", sure: true, roll: null }),
        proc("Sharpen", "initiator", { on: "upgrade" })
      ]
    }]
  };
  assert.deepEqual(fightCutIns(result), [{ by: "defender", skill: "Nihil" }]);
  assert.deepEqual(fightCutIns({ attacks: [] }), []);
  assert.deepEqual(fightCutIns(null), []);
});

test("a declared skill the fight spent comes first, and is told of once", () => {
  const result = { attacks: [{ side: "initiator", procs: [proc("Wrath", "initiator"), proc("Luna", "initiator")] }] };
  assert.deepEqual(fightCutIns(result, { initiator: ["Wrath", "Wrath"], defender: ["Guard"] }), [
    { by: "initiator", skill: "Wrath" },
    { by: "defender", skill: "Guard" },
    { by: "initiator", skill: "Luna" }
  ]);
});

test("each cut-in is a beat of its own while there are few", () => {
  const beats = planBeats([{ unit: "a", skill: "Luna" }, { unit: "b", skill: "Pavise" }, { unit: "a", skill: "Sol" }]);
  assert.deepEqual(names(beats), ["a: Luna", "b: Pavise", "a: Sol"]);
});

test("a skill that takes effect several times running is shown once, with its count", () => {
  const beats = planBeats([{ unit: "a", skill: "Adept" }, { unit: "a", skill: "Adept" }, { unit: "b", skill: "Adept" }]);
  assert.deepEqual(names(beats), ["a: Adept ×2", "b: Adept"]);
});

test("more than may wait: what a unit does in a row is one plate", () => {
  const beats = planBeats([
    { unit: "a", skill: "Luna" }, { unit: "a", skill: "Sol" }, { unit: "b", skill: "Pavise" }, { unit: "a", skill: "Astra" }
  ], 3);
  assert.deepEqual(names(beats), ["a: Luna, Sol", "b: Pavise", "a: Astra"]);
});

test("still too many: every unit shows all of its own at one time", () => {
  const beats = planBeats([
    { unit: "a", skill: "Luna" }, { unit: "b", skill: "Pavise" }, { unit: "a", skill: "Sol" },
    { unit: "b", skill: "Aegis" }, { unit: "a", skill: "Luna" }, { unit: "b", skill: "Miracle" }
  ], 3);
  assert.equal(beats.length, 1);
  assert.deepEqual(names(beats), ["a: Luna ×2, Sol | b: Pavise, Aegis, Miracle"]);
});

test("a plate names so many skills and counts the rest", () => {
  const plate = { unit: "a", skills: ["One", "Two", "Three", "Four", "Five"].map((name) => ({ name, count: 1 })) };
  assert.deepEqual(plateText(plate, 3), { names: ["One", "Two", "Three"], more: 2 });
  assert.deepEqual(plateText({ unit: "a", skills: [] }), { names: [], more: 0 });
});

test("beats that join those waiting are shown after them, or all together when too many wait", () => {
  const first = planBeats([{ unit: "a", skill: "Luna" }, { unit: "b", skill: "Pavise" }]);
  const second = planBeats([{ unit: "c", skill: "Renewal" }]);
  assert.deepEqual(names(queueBeats(first, second, 3)), ["a: Luna", "b: Pavise", "c: Renewal"]);
  const third = planBeats([{ unit: "a", skill: "Sol" }, { unit: "d", skill: "Renewal" }]);
  const all = queueBeats(queueBeats(first, second, 3), third, 3);
  assert.equal(all.length, 1);
  assert.deepEqual(names(all), ["a: Luna, Sol | b: Pavise | c: Renewal | d: Renewal"]);
  assert.deepEqual(queueBeats([], [], 3), []);
  assert.deepEqual(squashBeats([]), []);
});

test("what waits never takes longer than the beats that may wait", () => {
  const time = beatTime("normal");
  const many = Array.from({ length: 40 }, (unused, index) => ({ unit: `u${index % 7}`, skill: `S${index}` }));
  let waiting = [];
  for ( let at = 0; at < many.length; at += 5 ) waiting = queueBeats(waiting, planBeats(many.slice(at, at + 5)));
  assert.ok(waiting.length <= FEO.cutIns.most);
  assert.ok(holdTime(waiting.length, time, time) <= (FEO.cutIns.most + 1) * time);
});

test("numbers wait for the beat that shows and those behind it, and for nothing otherwise", () => {
  assert.equal(holdTime(0, 0, 560), 0);
  assert.equal(holdTime(0, -40, 560), 0);
  assert.equal(holdTime(0, 200, 560), 200);
  assert.equal(holdTime(2, 200, 560), 1320);
});

test("planning does not change what it is given", () => {
  const shown = [{ unit: "a", skill: "Luna" }, { unit: "a", skill: "Luna" }];
  const beats = planBeats(shown);
  const kept = JSON.stringify(beats);
  queueBeats(beats, planBeats([{ unit: "a", skill: "Luna" }, { unit: "b", skill: "Sol" }, { unit: "c", skill: "Sol" }]), 2);
  assert.equal(JSON.stringify(beats), kept);
  assert.equal(shown.length, 2);
});

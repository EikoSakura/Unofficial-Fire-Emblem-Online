/**
 * Tests for `module/rules/level-sync.mjs`: the band of Levels an encounter is for, the record a unit keeps of
 * what it was at each Level, what it was at a Level the record holds and at one it does not, and how its HP and
 * its skills follow.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { cleanEncounter } from "../module/rules/encounters.mjs";
import { overlay } from "../module/rules/imitation.mjs";
import {
  cleanBand, levelUpsWaiting, readRecord, readSnapshot, readSync, recordChange, shareOfHp, skillsOff, snapshotOf, standingOf, syncedOff, takenOf,
  unitAt
} from "../module/rules/level-sync.mjs";

/** A unit's saved data, as far as a Level Sync reads it. */
function saved({ level = 1, hp = 20, stats = {}, boosts = {}, ranks = {}, classId = "cls1", className = "Myrmidon", wt = 0, qualities = "" } = {}) {
  return {
    level,
    classId,
    className,
    hp: { value: hp, max: hp },
    stats: Object.fromEntries(Object.keys(FEO.stats).map((key) => [key, { base: stats[key] ?? 5, boost: boosts[key] ?? 0, cap: null }])),
    abilities: Object.fromEntries(Object.keys(FEO.abilities).map((key) => [key, { source: FEO.abilities[key].sources[0], increase: 0, boost: 0 }])),
    wt: { class: wt },
    proficiencies: Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => [key, { rank: ranks[key]?.[0] ?? "F", wexp: ranks[key]?.[1] ?? 0 }])),
    weaponLevel: { base: FEO.optional.weaponLevel.start },
    specialQualities: qualities,
    combatBoosts: {},
    calc: {}
  };
}

test("a band is kept sound, and tells how a unit stands to it", () => {
  assert.deepEqual(cleanBand(), { on: false, min: FEO.levelSync.min, max: FEO.levelSync.max });
  assert.deepEqual(cleanBand({ on: 1, min: 5, max: 10 }), { on: true, min: 5, max: 10 });
  assert.deepEqual(cleanBand({ on: true, min: 12, max: 10 }), { on: true, min: 10, max: 10 }, "the bottom is not above the top");
  assert.deepEqual(cleanBand({ on: true, min: -3, max: 9999 }), { on: true, min: 1, max: FEO.levelSync.most });

  const band = cleanBand({ on: true, min: 5, max: 10 });
  assert.deepEqual(standingOf(23, band), { kind: "sync", level: 10 });
  assert.deepEqual(standingOf(10, band), { kind: "in", level: 10 });
  assert.deepEqual(standingOf(5, band), { kind: "in", level: 5 });
  assert.deepEqual(standingOf(4, band), { kind: "under", level: 4 }, "a unit under the band is marked, not raised");
  assert.deepEqual(standingOf(23, { ...band, on: false }), { kind: "off", level: 23 });
  assert.deepEqual(standingOf(23, null), { kind: "off", level: 23 });
});

test("an encounter keeps its band", () => {
  assert.deepEqual(cleanEncounter({ id: "a" }).sync, { on: false, min: FEO.levelSync.min, max: FEO.levelSync.max });
  assert.deepEqual(cleanEncounter({ id: "a", sync: { on: true, min: 5, max: 10 } }).sync, { on: true, min: 5, max: 10 });
});

test("a snapshot keeps what a unit is, shortly, and reads back the same", () => {
  const system = saved({ hp: 31, stats: { str: 12, spd: 15 }, boosts: { str: 2 }, ranks: { sword: ["C", 14] }, wt: 3, qualities: "Mounted" });
  const snapshot = snapshotOf(system, { classId: "cls1", className: "Myrmidon", skills: ["s1", "s2", "s1", ""] });
  assert.equal(snapshot.hp, 31);
  assert.equal(snapshot.stats.str, 12);
  assert.deepEqual(snapshot.boosts, { str: 2 }, "only the boosts that are not nothing");
  assert.deepEqual(snapshot.ranks, { sword: ["C", 14] }, "only the proficiencies it has a rank in");
  assert.deepEqual(snapshot.skills, ["s1", "s2"]);
  assert.deepEqual(snapshot.cls, { id: "cls1", name: "Myrmidon" });
  assert.deepEqual(readSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.equal(readSnapshot(null), null);
  assert.equal(readSnapshot({ hp: 3 }), null);
  assert.deepEqual(readRecord({ 5: snapshot, x: snapshot, 0: snapshot, 7: "nothing" }), { 5: snapshot });
});

test("the record notes the Level a unit leaves, and forgets the Levels it goes back under", () => {
  const snapshot = snapshotOf(saved());
  assert.deepEqual(recordChange({}, 5, 6, snapshot), { noted: { 5: snapshot }, forgotten: [] });
  assert.deepEqual(recordChange({}, 5, 5, snapshot), { noted: {}, forgotten: [] });
  assert.deepEqual(recordChange({}, 20, 21, snapshot), { noted: { 20: snapshot }, forgotten: [] }, "a promotion that goes on counting is one more Level");

  const kept = { 3: snapshot, 4: snapshot, 5: snapshot, 6: snapshot };
  assert.deepEqual(recordChange(kept, 7, 5, snapshot), { noted: {}, forgotten: [5, 6] }, "put right by hand: what is not behind it goes");
  assert.deepEqual(recordChange(kept, 10, 1, snapshot), { noted: {}, forgotten: [3, 4, 5, 6] }, "a promotion that starts its Levels anew");
  assert.deepEqual(recordChange(kept, 4, 5, snapshot), { noted: { 4: snapshot }, forgotten: [5, 6] }, "what was noted for Levels ahead was stale");
});

test("what a unit was at a Level on record is read from it, exactly", () => {
  const at10 = snapshotOf(saved({ level: 10, hp: 23, stats: { str: 8 }, ranks: { sword: ["C", 0] } }), { skills: ["s1", "s2"] });
  const now = { level: 23, snapshot: snapshotOf(saved({ level: 23, hp: 34, stats: { str: 15 }, ranks: { sword: ["A", 0] }, classId: "cls2", className: "Swordmaster" }), { skills: ["s1", "s2", "s3", "s4"] }) };
  const found = unitAt({ 10: at10 }, 10, now);
  assert.equal(found.exact, true);
  assert.equal(found.snapshot, at10);
  assert.equal(found.from, 10);

  const same = unitAt({ 10: at10 }, 30, now);
  assert.equal(same.exact, true, "a Level it has not passed is what it is");
  assert.equal(same.snapshot, now.snapshot);

  assert.deepEqual(skillsOff(["s1", "s2", "s3", "s4"], found.snapshot), ["s3", "s4"]);
  assert.deepEqual(skillsOff(["s1", "s2"], now.snapshot), []);
});

test("a Level that is not on record is walked back to by the growth rates", () => {
  const growths = { hp: 60, str: 40, mag: 0, spd: 55, cha: 10 };
  const now = { level: 16, snapshot: snapshotOf(saved({ level: 16, hp: 30, stats: { str: 12, mag: 2, spd: 14 }, ranks: { fire: ["C", 3] } }), { skills: ["s1", "s2"] }) };
  const found = unitAt({}, 10, now, { growths });
  assert.equal(found.exact, false);
  assert.equal(found.from, 16);
  assert.equal(found.snapshot.hp, 30 - Math.round(0.6 * 6));
  assert.equal(found.snapshot.stats.str, 12 - Math.round(0.4 * 6));
  assert.equal(found.snapshot.stats.spd, 14 - Math.round(0.55 * 6));
  assert.equal(found.snapshot.stats.mag, 2, "a stat that does not grow stays");
  assert.deepEqual(found.snapshot.ranks, now.snapshot.ranks, "what cannot be told is left as it is");
  assert.deepEqual(found.snapshot.skills, ["s1", "s2"]);
  assert.equal(now.snapshot.hp, 30, "what it is now is not touched");

  // It is worked out from the nearest Level that is known, which may be on record
  const at13 = snapshotOf(saved({ level: 13, hp: 27, stats: { str: 10 } }), { skills: ["s1"] });
  const nearer = unitAt({ 13: at13 }, 10, now, { growths });
  assert.equal(nearer.from, 13);
  assert.equal(nearer.snapshot.hp, 27 - Math.round(0.6 * 3));
  assert.deepEqual(nearer.snapshot.skills, ["s1"]);

  // And a stat is not taken under what its first class started with
  const floored = unitAt({}, 1, now, { growths: { str: 100 }, floor: { str: 6 } });
  assert.equal(floored.snapshot.stats.str, 6);
});

test("walking back past a promotion takes back what the class gave, and the class", () => {
  const now = {
    level: 23,
    snapshot: snapshotOf(saved({ level: 23, hp: 34, stats: { str: 15, spd: 22, mov: 7 }, classId: "cls2", className: "Swordmaster", wt: 2 }))
  };
  const jumps = [{ at: 21, gains: { hp: 2, str: 2, spd: 4, mov: 1 }, from: { id: "cls1", name: "Myrmidon", wt: 0 } }];
  const found = unitAt({}, 19, now, { growths: { hp: 50, str: 50 }, jumps });

  // Levels 23 and 22 were rolled, 21 was the promotion, 20 was rolled: three Levels' worth of growth
  assert.equal(found.snapshot.hp, 34 - 2 - Math.round(0.5 * 3));
  assert.equal(found.snapshot.stats.str, 15 - 2 - Math.round(0.5 * 3));
  assert.equal(found.snapshot.stats.spd, 22 - 4);
  assert.equal(found.snapshot.stats.mov, 6);
  assert.deepEqual(found.snapshot.cls, { id: "cls1", name: "Myrmidon" });
  assert.equal(found.snapshot.wt, 0);

  const after = unitAt({}, 21, now, { growths: { hp: 50 }, jumps });
  assert.deepEqual(after.snapshot.cls, { id: "cls2", name: "Swordmaster" }, "a Level it had already promoted at keeps the class");
  assert.equal(after.snapshot.stats.spd, 22);
});

test("what a unit was is laid over its own data, and its own is left as it was saved", () => {
  const own = saved({ level: 23, hp: 34, stats: { str: 15 }, boosts: { str: 1 }, ranks: { sword: ["A", 5], axe: ["D", 0] }, classId: "cls2", className: "Swordmaster" });
  const was = snapshotOf(saved({ level: 10, hp: 23, stats: { str: 8 }, ranks: { sword: ["C", 12] }, qualities: "" }), { classId: "cls1", className: "Myrmidon" });
  const before = JSON.stringify(own);
  const read = overlay(JSON.parse(before), takenOf(was), { classId: "cls1" });
  assert.equal(read.hp.max, 23);
  assert.equal(read.stats.str.base, 8);
  assert.equal(read.stats.str.boost, 0);
  assert.deepEqual(read.proficiencies.sword, { rank: "C", wexp: 12 });
  assert.deepEqual(read.proficiencies.axe, { rank: "F", wexp: 0 }, "a proficiency it did not have yet");
  assert.equal(read.classId, "cls1");
  assert.equal(read.className, "Myrmidon");
  assert.equal(read.level, 23, "the Level is set beside it");
  assert.equal(JSON.stringify(own), before);
});

test("the note of a Level Sync is read back sound", () => {
  const taken = takenOf(snapshotOf(saved()));
  assert.equal(readSync(null), null);
  assert.equal(readSync({ level: 10 }), null, "one that holds nothing of the unit is no note");
  assert.equal(readSync({ level: 0, taken }), null);
  const note = readSync({ level: 10, own: 23, taken, off: ["s3", 4, ""], scene: "sc", name: "The Sunken Shrine", exact: false, from: 13 });
  assert.equal(note.level, 10);
  assert.equal(note.own, 23);
  assert.equal(note.exact, false);
  assert.equal(note.from, 13);
  assert.deepEqual(note.off, ["s3"]);
  assert.equal(note.classId, "");

  assert.equal(syncedOff({ level: 10, taken, off: ["s3"] }, "s3"), true);
  assert.equal(syncedOff({ level: 10, taken, off: ["s3"] }, "s1"), false);
  assert.equal(syncedOff(undefined, "s3"), false);
  assert.equal(syncedOff({ off: ["s3"] }, "s3"), false);
});

test("HP keeps its share of the maximum, going in and coming out", () => {
  assert.equal(shareOfHp(34, 34, 23), 23, "full stays full");
  assert.equal(shareOfHp(17, 34, 23), 12);
  assert.equal(shareOfHp(1, 34, 23), 1, "a unit that had some has some");
  assert.equal(shareOfHp(12, 23, 34), 18);
  assert.equal(shareOfHp(23, 23, 34), 34);
  assert.equal(shareOfHp(0, 34, 23), 0, "a unit that is down stays down");
  assert.equal(shareOfHp(-4, 34, 23), -4);
  assert.equal(shareOfHp(40, 34, 23), 23, "HP above the maximum counts as full");
  assert.equal(shareOfHp(10, 0, 23), 10);
});

test("experience holds the Level ups that wait", () => {
  assert.equal(levelUpsWaiting(99), 0);
  assert.equal(levelUpsWaiting(100), 1);
  assert.equal(levelUpsWaiting(250), 2);
  assert.equal(levelUpsWaiting(-5), 0);
});

/**
 * Tests for `module/rules/level-up.mjs`: what the Level Up splash shows of a level up, and the line its unit says.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { rerollGrowths } from "../module/rules/earnings.mjs";
import { levelMood, raisedCount, readSplash, rowPlaces, splashLine, splashRows } from "../module/rules/level-up.mjs";
import { rollGrowths } from "../module/rules/progression.mjs";

/** The growth rates and rolls of the rulebook's worked example, with a Charm and an Intelligence beside them. */
const RATES = { hp: 60, str: 45, mag: 10, def: 30, res: 20, dex: 55, spd: 60, luk: 45, cha: 25, int: 20 };
const ROLLS = [34, 71, 9, 88, 20, 12, 97, 46, 58, 31];
const VALUES = { hp: 24, str: 9, mag: 1, def: 5, res: 3, dex: 11, spd: 13, luk: 7, cha: 3, int: 2 };
const dice = (list) => {
  const queue = list.slice();
  return () => queue.shift();
};

test("the splash shows every stat as it stood, and its gain with the growth rolls", () => {
  const rows = splashRows(rollGrowths(RATES, [], dice(ROLLS)), VALUES);
  assert.deepEqual(rows.map((row) => row.key), Object.keys(RATES));
  assert.deepEqual(rows.filter((row) => row.gain).map((row) => `${row.key} ${row.value}+${row.gain}`), ["hp 24+1", "mag 1+1", "res 3+1", "dex 11+1"]);
  assert.ok(rows.every((row) => row.pass === (row.gain ? 1 : 0)));
  assert.equal(raisedCount(rows), 4);
});

test("a stat at its cap is shown as it stands and gains nothing", () => {
  const rows = splashRows(rollGrowths(RATES, ["spd"], dice(ROLLS)), VALUES);
  const spd = rows.find((row) => row.key === "spd");
  assert.deepEqual(spd, { key: "spd", value: 13, gain: 0, pass: 0, capped: true });
});

test("a growth rate over 100% shows the two points it can give", () => {
  const rows = splashRows(rollGrowths({ hp: 120 }, [], dice([14])), { hp: 24 });
  assert.deepEqual(rows, [{ key: "hp", value: 24, gain: 2, pass: 1, capped: false }]);
});

test("what a skill had rolled again comes in after the growth rolls", () => {
  const first = rollGrowths(RATES, [], dice(ROLLS));
  const again = rerollGrowths(first, dice([40, 62, 15, 77, 90, 12]), "Blossom");
  const rows = splashRows(again, VALUES);
  assert.deepEqual(rows.filter((row) => row.pass === 1).map((row) => row.key), ["hp", "mag", "res", "dex"]);
  assert.deepEqual(rows.filter((row) => row.pass === 2).map((row) => row.key), ["str", "spd", "int"]);
  assert.deepEqual(rows.filter((row) => row.pass === 0).map((row) => row.key), ["def", "luk", "cha"]);
  assert.equal(raisedCount(rows), 7);
});

test("points placed by hand are shown like growth rolls that came up", () => {
  const placed = [
    { key: "hp", growth: 60, roll: null, gain: 0, capped: false },
    { key: "str", growth: 45, roll: null, gain: 1, capped: false },
    { key: "con", growth: 10, roll: null, gain: 0, capped: false }
  ];
  assert.deepEqual(splashRows(placed, { hp: 24, str: 9, con: 6 }).map((row) => row.pass), [0, 1, 0]);
});

test("the unit says its line for how the level went, or nothing where none is written", () => {
  const lines = { great: " Never stronger! ", fair: "A little sharper.", poor: "" };
  assert.equal(levelMood(FEO.levelUp.lines.great), "great");
  assert.equal(levelMood(FEO.levelUp.lines.great - 1), "fair");
  assert.equal(levelMood(FEO.levelUp.lines.fair), "fair");
  assert.equal(levelMood(FEO.levelUp.lines.fair - 1), "poor");
  assert.equal(levelMood(0), "poor");
  assert.equal(splashLine(lines, 7), "Never stronger!");
  assert.equal(splashLine(lines, 3), "A little sharper.");
  assert.equal(splashLine(lines, 1), "");
  assert.equal(splashLine(null, 5), "");
  assert.equal(splashLine({}, 5), "");
});

test("the first stat has a row of its own, and the others stand in two columns under it", () => {
  assert.deepEqual(rowPlaces(0), []);
  assert.deepEqual(rowPlaces(1), [{ column: 1, row: 1 }]);
  const ten = rowPlaces(10);
  assert.deepEqual(ten[0], { column: 1, row: 1 });
  assert.deepEqual(ten.slice(1, 6).map((place) => `${place.column}:${place.row}`), ["1:2", "1:3", "1:4", "1:5", "1:6"]);
  assert.deepEqual(ten.slice(6).map((place) => `${place.column}:${place.row}`), ["2:2", "2:3", "2:4", "2:5"]);
  const twelve = rowPlaces(12);
  assert.equal(twelve.filter((place) => place.column === 1).length, 7);
  assert.equal(twelve.filter((place) => place.column === 2).length, 5);
  assert.equal(new Set(twelve.map((place) => `${place.column}:${place.row}`)).size, 12);
});

test("a splash another client sent is cut to what a splash is made of", () => {
  const sent = {
    army: "enemy",
    name: "Tamsin",
    className: "Myrmidon",
    img: "icons/svg/mystery-man.svg",
    from: 7,
    to: 8,
    text: { title: "Level Up", extra: "left out" },
    rows: [{ key: "hp", label: "HP", value: 24, gain: 1, pass: 1, capped: false, tip: "34 vs 60%" }, { key: "x", label: "" }],
    skill: "Blossom",
    chips: [{ label: "Ability points", value: "+6" }, {}],
    line: "A little sharper.",
    html: "<script>"
  };
  const read = readSplash(sent);
  assert.equal(read.army, "enemy");
  assert.equal(read.rows.length, 1);
  assert.deepEqual(read.rows[0], { key: "hp", label: "HP", value: 24, gain: 1, pass: 1, capped: false, tip: "34 vs 60%" });
  assert.deepEqual(read.chips, [{ label: "Ability points", value: "+6", tip: "" }]);
  assert.deepEqual(Object.keys(read.text), ["title", "skip", "auto", "next", "atCap"]);
  assert.equal(read.text.next, "");
  assert.equal("html" in read, false);
});

test("a splash that is none, names no unit or shows no stat is not played", () => {
  assert.equal(readSplash(null), null);
  assert.equal(readSplash("splash"), null);
  assert.equal(readSplash({ name: "Tamsin", rows: [] }), null);
  assert.equal(readSplash({ name: "", rows: [{ label: "HP" }] }), null);
  assert.equal(readSplash({ name: {}, rows: [{ label: "HP" }] }), null);
});

test("a splash from another client cannot be made endless", () => {
  const long = "x".repeat(5000);
  const read = readSplash({
    army: "toString",
    name: long,
    from: -4,
    to: 1e9,
    rows: Array.from({ length: 200 }, () => ({ label: long, value: 1e9, gain: 1e9, pass: 9 })),
    chips: Array.from({ length: 200 }, () => ({ label: long, value: long })),
    line: long
  });
  const most = FEO.levelUp.most;
  assert.equal(read.army, "other");
  assert.equal(read.name.length, most.text);
  assert.equal(read.line.length, most.text);
  assert.equal(read.rows.length, most.rows);
  assert.equal(read.chips.length, most.chips);
  assert.deepEqual([read.from, read.to], [0, 9999]);
  assert.deepEqual([read.rows[0].value, read.rows[0].gain, read.rows[0].pass], [9999, 99, 2]);
});

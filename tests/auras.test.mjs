/**
 * Tests for `module/rules/auras.mjs`: an aura for every unit around, whatever its side.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { standing } from "../module/rules/auras.mjs";
import { turnMoment } from "../module/rules/skills.mjs";
import { dice, skill } from "./lib/fixtures.mjs";

const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
const placed = (id, side, j, skills = []) => ({ id, name: id, side, tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills });

test("Toxify reaches the units next to its unit: allies, enemies and those that are neither", () => {
  const toxic = placed("toxic", "enemy", 0, [skill("Toxify")]);
  for ( const side of ["enemy", "player", "ally", "other"] ) {
    const auras = standing([toxic, placed("near", side, 1)], "near", measure).auras;
    assert.equal(auras.length, 1, side);
    assert.equal(auras[0].from, "toxic");
    assert.deepEqual(auras[0].effects.map((effect) => effect.proc.on), ["turnStart", "turnEnd"], side);
  }
  assert.equal(standing([toxic, placed("far", "player", 2)], "far", measure).auras.length, 0);
});

test("a unit next to it is given Poison as its turn starts and as it ends, by the unit that has Toxify", () => {
  const toxic = placed("toxic", "enemy", 0, [skill("Toxify")]);
  const auras = standing([toxic, placed("near", "player", 1)], "near", measure).auras;
  const self = { name: "near", hp: 20, hpMax: 20, level: 1, stats: {}, near: null };
  for ( const moment of ["turnStart", "turnEnd"] ) {
    const result = turnMoment(auras, self, moment, dice(), { conditions: {} });
    assert.equal(result.entries.length, 1, moment);
    assert.deepEqual(result.entries[0].inflicts, ["poison"], moment);
    assert.equal(result.entries[0].from, "toxic", moment);
  }
  assert.equal(turnMoment(auras, self, "wait", dice(), { conditions: {} }).entries.length, 0);
});

test("an aura for allies or for enemies still leaves out a unit that is neither", () => {
  const guide = placed("guide", "player", 0, [skill("Guidance")]);
  assert.equal(standing([guide, placed("near", "other", 1)], "near", measure).auras.length, 0);
  assert.equal(standing([guide, placed("near", "enemy", 1)], "near", measure).auras.length, 0);
  assert.equal(standing([guide, placed("near", "ally", 1)], "near", measure).auras.length, 1);
});

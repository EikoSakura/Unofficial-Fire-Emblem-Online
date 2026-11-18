/**
 * Tests for `module/rules/actions.mjs`: skills used as an action on a unit picked on the map. Whom such a skill
 * may be used on, what a unit can do with an ally next to it, the opposed Ability check, and a unit that has
 * hold of another.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actOf, actPicksTile, actReaches, bestCheck, checkAct, dragTo, gripEntry, gripHolds, maneuverAt, maneuvers, opposedCheck
} from "../module/rules/actions.mjs";
import { standing } from "../module/rules/auras.mjs";
import { tileKey, tilesApart } from "../module/rules/reach.mjs";
import { checkEffects, skillTotals } from "../module/rules/skills.mjs";
import { skill } from "./lib/fixtures.mjs";

const at = (i, j) => ({ i, j });

/** A map of 7 rows and columns, with the tiles nobody stands on and those someone does. */
function field({ rock = [], units = [] } = {}) {
  const has = (list, tile) => list.some((other) => tileKey(other) === tileKey(tile));
  return {
    inside: (tile) => (tile.i >= 0) && (tile.i < 7) && (tile.j >= 0) && (tile.j < 7),
    stands: (tile) => !has(rock, tile),
    taken: (tile) => has(units, tile)
  };
}

/** The skill as an Item's data has it. */
const data = (name) => {
  const entry = skill(name);
  return { effects: entry.effects, usage: entry.usage, automate: true };
};

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("the action skills of the step say what they do to their target", () => {
  assert.deepEqual(actOf(data("Maneuver")), { target: { who: "ally", within: 1 }, move: "maneuver" });
  assert.deepEqual(actOf(data("Foul Play")), { target: { who: "ally", within: 5, clear: true }, move: "swap" });
  assert.equal(actOf(data("Death Grip")).grip, true);
  assert.equal(actOf(data("Fortress")), null, "a skill without a target is used on the spot");
  assert.equal(actOf({ ...data("Maneuver"), automate: false }), null, "one the table runs by hand is only counted");
  assert.equal(actOf(null), null);

  assert.equal(actPicksTile(actOf(data("Maneuver"))), true);
  assert.equal(actPicksTile(actOf(data("Foul Play"))), false);
});

test("a typing mistake in an act does not pass silently", () => {
  assert.deepEqual(checkAct({ target: { who: "ally" }, move: "swap" }), []);
  assert.deepEqual(checkAct({ target: { who: "enemy", within: 1 }, check: { by: "athletics", against: ["reflex", "athletics"] }, grip: true }), []);
  assert.equal(checkAct({ move: "swap" }).length, 1, "it needs a target");
  assert.equal(checkAct({ target: { who: "friend" }, move: "swap" }).length, 1);
  assert.equal(checkAct({ target: { who: "ally", range: 2 }, move: "swap" }).length, 1);
  assert.equal(checkAct({ target: { who: "ally" }, move: "shuffle" }).length, 1);
  assert.equal(checkAct({ target: { who: "ally" } }).length, 1, "it has to do something");
  assert.equal(checkAct({ target: { who: "enemy" }, grip: true, check: { by: "atletics", against: ["reflex"] } }).length, 1);
  assert.equal(checkAct({ target: { who: "enemy" }, grip: true, check: { by: "athletics", against: [] } }).length, 1);

  // An act stands alone in its effect
  assert.equal(checkEffects([{ act: { target: { who: "ally" }, move: "swap" }, stats: { str: 1 } }]).length, 1);
});

/* -------------------------------------------- */
/*  Whom It Reaches                             */
/* -------------------------------------------- */

test("a skill reaches the units of the side it is for, as far away as it says", () => {
  const maneuver = actOf(data("Maneuver"));
  assert.equal(actReaches(maneuver, "friend", 1), true);
  assert.equal(actReaches(maneuver, "friend", 2), false);
  assert.equal(actReaches(maneuver, "foe", 1), false);

  const foulPlay = actOf(data("Foul Play"));
  assert.equal(actReaches(foulPlay, "friend", 5), true);
  assert.equal(actReaches(foulPlay, "friend", 6), false);
  assert.equal(actReaches(foulPlay, "apart", 2), false);

  const grip = actOf(data("Death Grip"));
  assert.equal(actReaches(grip, "foe", 1), true);
  assert.equal(actReaches(grip, "friend", 1), false);
  assert.equal(actReaches({ target: { who: "any", within: 3, from: 2 } }, "apart", 1), false);
  assert.equal(actReaches({ target: { who: "any", within: 3, from: 2 } }, "apart", 3), true);
});

/* -------------------------------------------- */
/*  Maneuver                                    */
/* -------------------------------------------- */

test("a unit trades places with an ally next to it, moves beside it, or sets it down beside itself", () => {
  const unit = at(3, 3);
  const ally = at(3, 4);
  const taken = [unit, ally];
  const open = maneuvers(unit, ally, { unit: field({ units: taken }), ally: field({ units: taken }) });
  assert.equal(open.swap, true);
  assert.deepEqual(open.pivot.map(tileKey).sort(), ["2,4", "3,5", "4,4"]);
  assert.deepEqual(open.place.map(tileKey).sort(), ["2,3", "3,2", "4,3"]);

  // What a click means: the ally itself, a tile next to it, a tile next to the unit, or nothing
  assert.equal(maneuverAt(open, ally, ally), "swap");
  assert.equal(maneuverAt(open, ally, at(3, 5)), "pivot");
  assert.equal(maneuverAt(open, ally, at(2, 3)), "place");
  assert.equal(maneuverAt(open, ally, at(0, 0)), null);
  assert.equal(maneuverAt(open, ally, unit), null);

  // No tile is next to both, so a click never means two things
  for ( const tile of open.pivot ) assert.equal(tilesApart(tile, unit) > 1, true);

  // Tiles someone stands on, or that the unit moved could not stand on, are not offered
  const crowded = maneuvers(unit, ally, {
    unit: field({ units: [...taken, at(3, 5)], rock: [at(2, 4)] }),
    ally: field({ units: [...taken, at(2, 3)], rock: [unit] })
  });
  assert.deepEqual(crowded.pivot.map(tileKey), ["4,4"]);
  assert.deepEqual(crowded.place.map(tileKey).sort(), ["3,2", "4,3"]);
  assert.equal(crowded.swap, false, "the ally could not stand where the unit does");

  // An ally that is not moved by others: the unit can still move beside it
  const rooted = maneuvers(unit, ally, { unit: field({ units: taken }), ally: null });
  assert.equal(rooted.swap, false);
  assert.deepEqual(rooted.place, []);
  assert.equal(rooted.pivot.length, 3);
});

/* -------------------------------------------- */
/*  Opposed Checks                              */
/* -------------------------------------------- */

test("an opposed check succeeds unless the answer is higher", () => {
  assert.deepEqual(opposedCheck({ roll: 50, bonus: 10 }, { roll: 40, bonus: 5 }), { total: 60, against: 45, success: true });
  assert.equal(opposedCheck({ roll: 50, bonus: 10 }, { roll: 55, bonus: 5 }).success, true, "a tie goes to the unit that asks");
  assert.equal(opposedCheck({ roll: 50, bonus: 10 }, { roll: 56, bonus: 5 }).success, false);
});

test("a unit answers with the best of the checks it may use", () => {
  assert.deepEqual(bestCheck({ reflex: 12, athletics: 20 }, ["reflex", "athletics"]), { key: "athletics", bonus: 20 });
  assert.deepEqual(bestCheck({ reflex: 12, athletics: 12 }, ["reflex", "athletics"]), { key: "reflex", bonus: 12 });
  assert.deepEqual(bestCheck({}, ["reflex", "athletics"]), { key: "reflex", bonus: 0 });
});

/* -------------------------------------------- */
/*  Holding a Unit                              */
/* -------------------------------------------- */

test("a unit that is held can neither move, act nor dodge, for as long as it stands next to its holder", () => {
  const measure = (a, b) => tilesApart(a.tile, b.tile);
  const placed = (id, side, tile, skills = []) => ({ id, name: id, side, tile, hp: 20, hpMax: 20, level: 5, stats: {}, skills, conditions: [] });
  const holder = placed("holder", "player", at(3, 3), [gripEntry("Death Grip", "held")]);
  const units = (where) => [holder, placed("held", "enemy", where), placed("other", "enemy", at(2, 3))];

  // The unit held receives it as a skill of its own, named after the skill and its holder
  const near = standing(units(at(3, 4)), "held", measure);
  assert.deepEqual(near.auras.map((aura) => aura.name), ["Death Grip (holder)"]);
  const totals = skillTotals(near.auras, { hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null });
  assert.equal(totals.rules.has("held"), true);
  assert.equal(totals.rules.has("gripped"), true);
  assert.equal(totals.calc.dodgeBy, "none");

  // Nobody else does, though it stands as near
  assert.deepEqual(standing(units(at(3, 4)), "other", measure).auras, []);

  // Once the two are apart it is free, with nothing to take off it
  assert.deepEqual(standing(units(at(3, 5)), "held", measure).auras, []);

  assert.equal(gripHolds({ tile: at(3, 3) }, { tile: at(3, 4) }), true);
  assert.equal(gripHolds({ tile: at(3, 3) }, { tile: at(3, 5) }), false);
  assert.equal(gripHolds({ tile: at(3, 3), out: true }, { tile: at(3, 4) }), false);
  assert.equal(gripHolds({ tile: at(3, 3) }, { tile: at(3, 4), out: true }), false);
  assert.equal(gripHolds({ tile: at(3, 3) }, null), false);
});

test("a unit that is held is dragged to the tile its holder came from", () => {
  // The holder walked from 3,3 to 3,0 by way of 3,1: the unit it holds comes to 3,1
  assert.deepEqual(dragTo({ holder: at(3, 0), held: at(3, 4), from: at(3, 1) }, field()), { tile: at(3, 1), moved: true });

  // Still next to its holder, it stays where it is
  assert.deepEqual(dragTo({ holder: at(2, 4), held: at(3, 4), from: at(2, 3) }, field()), { tile: at(3, 4), moved: false });

  // Where it cannot stand on that tile, or someone does, it comes to the nearest free tile next to its holder
  assert.deepEqual(dragTo({ holder: at(3, 0), held: at(3, 4), from: at(3, 1) }, field({ rock: [at(3, 1)] })).tile, at(4, 0));
  assert.deepEqual(dragTo({ holder: at(3, 0), held: at(6, 0), from: null }, field()).tile, at(4, 0));

  // With no room beside its holder the hold is broken
  assert.equal(dragTo({ holder: at(0, 0), held: at(3, 4), from: at(0, 1) }, field({ rock: [at(0, 1)], units: [at(1, 0)] })), null);
});

/**
 * Tests for `module/rules/defeat.mjs`: what a change of HP means for a unit, with the Incapacitation system and
 * without it, which units are out of the fight, and that such a unit stands in nobody's way on the map.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { standing } from "../module/rules/auras.mjs";
import { hpTransition, leavesMap, outOfFight, plainTransition } from "../module/rules/defeat.mjs";
import { reachFrom, strikeFrom, tileKey } from "../module/rules/reach.mjs";
import { skill } from "./lib/fixtures.mjs";

const blank = { state: "", turns: 0, paused: false };
const standingUnit = (hpMax = 20) => ({ hpMax, resilience: 3, graveWounds: 0, injuries: 0, defeat: { ...blank } });

/* -------------------------------------------- */
/*  What a Change of HP Means                   */
/* -------------------------------------------- */

test("without the Incapacitation system a unit brought to 0 HP is dead", () => {
  assert.deepEqual(plainTransition(standingUnit(), 8, 0), { event: "defeated", defeat: { state: "dead", turns: 0, paused: false } });
  assert.equal(plainTransition(standingUnit(), 8, -4).defeat.state, "dead");
});

test("a unit with a life to spare retreats instead", () => {
  assert.equal(plainTransition(standingUnit(), 8, 0, { spare: true }).defeat.state, "retreated");
});

test("nothing follows from HP that stays above 0, that was at 0 already, or that the unit never had", () => {
  assert.equal(plainTransition(standingUnit(), 8, 1), null);
  assert.equal(plainTransition(standingUnit(), 0, 0), null);
  assert.equal(plainTransition(standingUnit(0), 1, 0), null);
  assert.equal(plainTransition(standingUnit(), 8, NaN), null);
});

test("a dead unit raised above 0 HP returns; one that retreated or was captured stays as it is", () => {
  const unit = (state) => ({ hpMax: 20, defeat: { ...blank, state } });
  assert.deepEqual(plainTransition(unit("dead"), 0, 5), { event: "returned", defeat: blank });
  assert.equal(plainTransition(unit("dead"), 0, 0), null);
  assert.equal(plainTransition(unit("retreated"), 0, 5), null);
  assert.equal(plainTransition(unit("captured"), 3, 9), null);
});

test("with the Incapacitation system a unit brought to 0 HP goes down instead, and is still in the fight", () => {
  const change = hpTransition(standingUnit(), 8, -2);
  assert.equal(change.event, "down");
  assert.equal(change.defeat.state, "incapacitated");
  assert.equal(change.defeat.turns, 3);
  assert.equal(outOfFight({ state: change.defeat.state, hp: -2, hpMax: 20 }), false);
  assert.equal(leavesMap(change.defeat.state), false);
});

/* -------------------------------------------- */
/*  Out of the Fight                            */
/* -------------------------------------------- */

test("a unit that retreated, died or was captured is out of the fight, whatever its HP", () => {
  for ( const state of ["retreated", "dead", "captured"] ) {
    assert.equal(outOfFight({ state, hp: 0, hpMax: 20 }), true, state);
    assert.equal(outOfFight({ state, hp: 12, hpMax: 20 }), true, state);
  }
});

test("a unit left at 0 HP with nothing said of what became of it is out of the fight all the same", () => {
  assert.equal(outOfFight({ state: "", hp: 0, hpMax: 20 }), true);
  assert.equal(outOfFight({ state: "", hp: -3, hpMax: 20 }), true);
});

test("a standing unit, an Incapacitated one and one that was never given HP are not", () => {
  assert.equal(outOfFight({ state: "", hp: 1, hpMax: 20 }), false);
  assert.equal(outOfFight({ state: "incapacitated", hp: -6, hpMax: 20 }), false);
  assert.equal(outOfFight({ state: "", hp: 0, hpMax: 0 }), false);
  assert.equal(outOfFight(), false);
});

test("a unit that died or retreated leaves the map; one that is down or captured stays where it lies", () => {
  assert.equal(leavesMap("dead"), true);
  assert.equal(leavesMap("retreated"), true);
  assert.equal(leavesMap("incapacitated"), false);
  assert.equal(leavesMap("captured"), false);
  assert.equal(leavesMap(""), false);
});

/* -------------------------------------------- */
/*  On the Map                                  */
/* -------------------------------------------- */

/**
 * The map as a unit of the player's side finds it, read the way `helpers/battle-map.mjs` reads a scene: a unit
 * that is out of the fight is not on it, one that is down holds no tile, and an enemy is in the way.
 * @param {number} rows
 * @param {number} columns
 * @param {{tile: {i: number, j: number}, side: string, state?: string, hp?: number, hpMax?: number}[]} units
 */
function field(rows, columns, units) {
  const on = units.filter((unit) => !outOfFight({ state: unit.state ?? "", hp: unit.hp ?? 10, hpMax: unit.hpMax ?? 10 }));
  const at = (tile) => on.filter((unit) => tileKey(unit.tile) === tileKey(tile));
  return {
    inside: (tile) => (tile.i >= 0) && (tile.i < rows) && (tile.j >= 0) && (tile.j < columns),
    cost: () => 1,
    foe: (tile) => at(tile).some((unit) => (unit.side === "enemy") && (unit.state !== "incapacitated")),
    taken: (tile) => at(tile).length > 0
  };
}

/** A corridor one tile wide with an enemy two tiles down it. */
const corridor = (enemy) => field(1, 6, [{ tile: { i: 0, j: 2 }, side: "enemy", ...enemy }]);

test("a standing enemy blocks the way: a unit goes neither onto its tile nor past it", () => {
  const reach = reachFrom({ i: 0, j: 0 }, 5, corridor({ hp: 8 }));
  assert.deepEqual([...reach.stops].sort(), ["0,0", "0,1"]);
  assert.equal(reach.cost.has("0,2"), false);
});

test("an enemy that was defeated blocks nothing: a unit walks over its tile and may stop on it", () => {
  for ( const enemy of [{ state: "dead", hp: 0 }, { state: "retreated", hp: 0 }, { state: "", hp: 0 }] ) {
    const reach = reachFrom({ i: 0, j: 0 }, 5, corridor(enemy));
    assert.deepEqual([...reach.stops].sort(), ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5"], JSON.stringify(enemy));
    assert.equal(reach.cost.get("0,4"), 4);
  }
});

test("an Incapacitated unit holds no tile either, but it is still there: nobody stops on it", () => {
  const reach = reachFrom({ i: 0, j: 0 }, 5, corridor({ state: "incapacitated", hp: -2 }));
  assert.equal(reach.cost.get("0,4"), 4);
  assert.equal(reach.stops.has("0,2"), false);
});

test("an attack on what stands behind a defeated enemy is made from the tile it fell on", () => {
  const range = { min: 1, max: 1 };
  const target = { i: 0, j: 3 };
  const blocked = reachFrom({ i: 0, j: 0 }, 5, corridor({ hp: 8 }));
  assert.equal(strikeFrom(blocked, { i: 0, j: 0 }, target, range), null);
  const open = reachFrom({ i: 0, j: 0 }, 5, corridor({ state: "dead", hp: 0 }));
  assert.deepEqual(strikeFrom(open, { i: 0, j: 0 }, target, range), { tile: { i: 0, j: 2 }, cost: 2 });
});

test("a defeated unit gives no aura and is not among the units around another", () => {
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const placed = (id, side, j, about = {}) => {
    const unit = { id, name: id, side, tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills: [], state: "", ...about };
    return { ...unit, out: outOfFight(unit) };
  };
  const near = placed("near", "player", 1);
  const alive = standing([placed("toxic", "enemy", 0, { skills: [skill("Toxify")] }), near], "near", measure);
  assert.equal(alive.auras.length, 1);
  assert.equal(alive.near.others.length, 1);
  for ( const about of [{ state: "dead", hp: 0 }, { state: "", hp: 0 }] ) {
    const fallen = standing([placed("toxic", "enemy", 0, { skills: [skill("Toxify")], ...about }), near], "near", measure);
    assert.equal(fallen.auras.length, 0, JSON.stringify(about));
    assert.equal(fallen.near.others.length, 0, JSON.stringify(about));
  }
});

/**
 * Tests for `module/rules/passing.mjs` and what Step 6 gave the map and the skills: how units stand in each
 * other's way, what skills change about it, the damage a move deals along its way, and what a unit that moved
 * through an enemy can be asked.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planExchange } from "../module/rules/combat.mjs";
import { moveHolds, movedThroughHolds, movementFacts, needsMove } from "../module/rules/movement.mjs";
import { addPassing, checkPassing, emptyPassing, passCap, passExtra, pathHarm, threads } from "../module/rules/passing.mjs";
import { pathTo, reachFrom, strikeFrom, strikesFrom, tileKey, wayBetween } from "../module/rules/reach.mjs";
import { checkEffects, levelInTier, readNumber, skillPassing, skillTotals } from "../module/rules/skills.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/** What a list of `passing` parts comes to. */
const passing = (...parts) => parts.reduce((total, part) => addPassing(total, part, { skill: "Test" }), emptyPassing());

/**
 * A map for a unit, drawn row by row: "." open ground, "#" a wall, "f" forest, "E" an enemy, "A" an ally, "O" an
 * enemy that stops those who come beside it, "S" an enemy alone on its tile that lets others share it.
 * @param {string[]} rows
 * @param {import("../module/rules/passing.mjs").Passing|null} [pass]    What the unit's skills make of passing
 * @param {Record<string, number>} [costly]     What a tile takes in place of what its kind does, by its name
 */
function field(rows, pass = null, costly = {}) {
  const at = (tile) => rows[tile.i]?.[tile.j];
  const wardens = rows.flatMap((row, i) => [...row].map((kind, j) => (kind === "O") ? { i, j } : null)).filter(Boolean);
  const map = {
    inside: (tile) => at(tile) !== undefined,
    cost: (tile) => costly[tileKey(tile)] ?? ({ "#": Infinity, f: 2 }[at(tile)] ?? 1),
    foe: (tile) => ["E", "O", "S"].includes(at(tile)),
    taken: (tile) => ["E", "O", "A"].includes(at(tile)) ? !pass?.share : false,
    pass
  };
  if ( wardens.length ) map.halts = (tile) => wardens.some((warden) => (Math.abs(warden.i - tile.i) + Math.abs(warden.j - tile.j)) === 1);
  return map;
}

/** Five rows with an enemy in the third column of each: a line right across the map. */
const LINE = ["..E..", "..E..", "..E..", "..E..", "..E.."];

/** The same with a second line two columns on. */
const LINES = ["..E.E.", "..E.E.", "..E.E.", "..E.E.", "..E.E."];

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("what skills say about passing is added up, the cheapest leave first", () => {
  assert.equal(threads(emptyPassing()), false);
  const both = passing({ through: 1 }, { through: "all", extra: 2 }, { free: 1 });
  assert.deepEqual(both.ways, [{ limit: 1, extra: 0 }, { limit: Infinity, extra: 2 }]);
  assert.equal(threads(both), true);

  // The first enemy goes by the leave that costs nothing, every one after it by the other
  assert.equal(passExtra(both, 0), 0);
  assert.equal(passExtra(both, 1), 2);
  assert.equal(passExtra(both, 7), 2);
  assert.equal(passCap(both), 1);
  assert.equal(passExtra(passing({ through: 1 }), 1), Infinity);
  assert.equal(passExtra(null, 0), Infinity);

  // Stopping enemies beside a unit changes nothing about where the unit itself can go
  assert.equal(threads(passing({ zone: true })), false);
  assert.equal(threads(passing({ share: true })), true);
  assert.equal(threads(passing({ diagonal: 2 })), true);
});

test("a passing part is checked like any other", () => {
  assert.deepEqual(checkPassing({ through: "all", extra: 2, hits: { percent: 10 } }), []);
  assert.deepEqual(checkPassing({ brushes: { amount: 4, self: 2, nonlethal: true } }), []);
  assert.deepEqual(checkPassing({ diagonal: { of: "classLevel", less: 1, per: 5, plus: 1, max: 4 } }), []);
  assert.equal(checkPassing({}).length, 1);
  assert.equal(checkPassing({ through: 0 }).length, 1);
  assert.equal(checkPassing({ extra: 2 }).length, 1);
  assert.equal(checkPassing({ hits: { nonlethal: true } }).length, 1);
  assert.equal(checkPassing({ hits: { amount: 4, self: 2 } }).length, 1);
  assert.equal(checkPassing({ through: "all", past: true }).length, 1);

  // It is always there, and judged before it is known where the unit goes
  assert.deepEqual(checkEffects([{ when: { declared: true }, passing: { through: "all" } }]), []);
  assert.equal(checkEffects([{ proc: { on: "turnStart", sure: true }, passing: { through: "all" } }]).length > 0, true);
  assert.equal(checkEffects([{ when: { moved: true }, passing: { through: "all" } }]).length > 0, true);
  assert.equal(checkEffects([{ when: { role: "initiating" }, passing: { through: "all" } }]).length > 0, true);
  assert.deepEqual(checkEffects([{ when: { role: "initiating", movedThroughFoe: true }, combat: { damage: 2 } }]), []);
  assert.equal(checkEffects([{ when: { movedThrough: "yes" }, combat: { damage: 2 } }]).length, 1);
});

/* -------------------------------------------- */
/*  Where a Unit Can Go                         */
/* -------------------------------------------- */

test("a line of enemies stops a unit, and one that moves through enemies threads it", () => {
  const from = { i: 2, j: 0 };
  const stopped = reachFrom(from, 4, field(LINE));
  assert.equal(stopped.cost.has("2,2"), false);
  assert.equal(stopped.cost.has("2,3"), false);
  assert.equal(stopped.plain, true);

  const nimble = reachFrom(from, 4, field(LINE, skillPassing([skill("Nimble")])));
  assert.equal(nimble.cost.get("2,3"), 3);
  assert.equal(nimble.cost.get("2,4"), 4);
  assert.deepEqual(pathTo(nimble, { i: 2, j: 3 }), [{ i: 2, j: 1 }, { i: 2, j: 2 }, { i: 2, j: 3 }]);

  // It passes through the enemy's tile, and does not stop on it
  assert.equal(nimble.cost.has("2,2"), true);
  assert.equal(nimble.stops.has("2,2"), false);
  assert.equal(nimble.stops.has("2,3"), true);
  assert.equal(nimble.plain, false);
});

test("Bypass moves through one enemy a turn, and with Nimble the first for nothing", () => {
  const from = { i: 2, j: 0 };
  const thief = reachFrom(from, 6, field(LINES, skillPassing([skill("Bypass")])));
  assert.equal(thief.cost.get("2,3"), 3);
  assert.equal(thief.cost.has("2,4"), false, "the second enemy is in its way");
  assert.equal(thief.cost.has("2,5"), false);

  // With Nimble every enemy is passed, and the first takes no movement
  const both = skillPassing([skill("Bypass"), skill("Nimble")]);
  assert.equal(both.free, 1);
  const cat = reachFrom(from, 6, field(LINES, both));
  assert.equal(cat.cost.get("2,2"), 1);
  assert.equal(cat.cost.get("2,3"), 2);
  assert.equal(cat.cost.get("2,5"), 4, "the second enemy takes what its tile takes");

  // What the terrain under the first enemy adds is still paid: a Forest takes 1 of its 2
  const wooded = reachFrom(from, 6, field(LINES, both, { "2,2": 2, "1,2": 9, "3,2": 9 }));
  assert.equal(wooded.cost.get("2,3"), 3);

  // An enemy already moved through this turn counts against the one Bypass allows
  const spent = reachFrom(from, 6, { ...field(LINES, skillPassing([skill("Bypass")])), passed: 1 });
  assert.equal(spent.cost.has("2,3"), false);
});

test("Barge crosses enemies at 2 more movement each", () => {
  const from = { i: 2, j: 0 };
  const barge = skillPassing([skill("Barge")], { qualities: "Mounted", checks: {} });
  assert.deepEqual(barge.ways, [{ limit: Infinity, extra: 2 }]);
  assert.equal(reachFrom(from, 4, field(LINE, barge)).cost.has("2,3"), false);
  const far = reachFrom(from, 5, field(LINE, barge));
  assert.equal(far.cost.get("2,2"), 4);
  assert.equal(far.cost.get("2,3"), 5);

  // With Bypass the first enemy is crossed for nothing more, and the next at 2 more
  const thief = skillPassing([skill("Barge"), skill("Bypass")], { qualities: "Mounted", checks: {} });
  const run = reachFrom(from, 8, field(LINES, thief));
  assert.equal(run.cost.get("2,3"), 3);
  assert.equal(run.cost.get("2,5"), 7);
});

test("Obstruct ends an enemy's movement on the tiles next to its unit", () => {
  const rows = [".....", ".....", "..O..", ".....", "....."];
  const open = rows.map((row) => row.replace("O", "E"));
  const from = { i: 2, j: 0 };

  // Around an enemy that only stands there, the tile behind it takes 5 movement
  assert.equal(reachFrom(from, 6, field(open)).cost.get("2,3"), 5);
  assert.equal(reachFrom(from, 6, field(open)).cost.get("1,3"), 4);

  // Next to one with Obstruct the unit goes no further, so the way round is the long one
  const warded = reachFrom(from, 6, field(rows));
  assert.equal(warded.cost.get("2,1"), 1);
  assert.equal(warded.stops.has("2,1"), true);
  assert.equal(warded.cost.get("1,2"), 3);
  assert.equal(warded.cost.get("1,3"), 6);
  assert.equal(warded.cost.has("2,3"), false);
  assert.equal(warded.plain, false);

  // Moving through enemies does not help: the tiles round it are where the way ends
  assert.equal(reachFrom(from, 6, field(rows, skillPassing([skill("Nimble")]))).cost.has("2,3"), false);

  // A unit that starts its turn next to it may leave
  const beside = reachFrom({ i: 2, j: 1 }, 2, field(rows));
  assert.equal(beside.cost.get("2,0"), 1);
  assert.equal(beside.cost.get("0,1"), 2);
  assert.equal(skillPassing([skill("Obstruct")]).zone, true);
});

test("Dash takes diagonal steps, more of them as its unit gains levels", () => {
  const open = [".....", ".....", ".....", ".....", "....."];
  const from = { i: 2, j: 2 };
  const steps = (level, active = true) => skillPassing([skill("Dash", { active })], { level }).diagonal;
  assert.equal(steps(21, false), 0, "switched off it does nothing");
  assert.deepEqual([21, 25, 26, 31, 36, 40].map((level) => steps(level)), [1, 1, 2, 3, 4, 4]);
  assert.deepEqual([1, 6, 16, 20].map((level) => steps(level)), [1, 2, 4, 4]);
  assert.equal(levelInTier(26), 6);
  assert.equal(levelInTier(41), 1);
  assert.equal(readNumber({ of: ["str", "def"], best: true }, { stats: { str: 4, def: 9 } }), 9);

  const once = reachFrom(from, 3, field(open, passing({ diagonal: 1 })));
  assert.equal(once.cost.get("1,1"), 1);
  assert.equal(pathTo(once, { i: 1, j: 1 }).length, 1, "a diagonal step is one space");
  assert.equal(once.cost.get("0,0"), 3, "the second diagonal is walked round");
  assert.equal(reachFrom(from, 3, field(open, passing({ diagonal: 2 }))).cost.get("0,0"), 2);
  assert.equal(reachFrom(from, 2, field(open)).cost.has("1,1"), true);
  assert.equal(reachFrom(from, 1, field(open)).cost.has("1,1"), false);

  // Not through the gap between two tiles it could not enter, but past a single one
  const corner = reachFrom({ i: 1, j: 1 }, 1, field([".#.", "#..", "..."], passing({ diagonal: 1 })));
  assert.equal(corner.cost.has("0,0"), false);
  assert.equal(corner.cost.has("0,2"), true);
});

test("a unit that may share a tile ends its move on another unit, and lets others end theirs on it", () => {
  const flyby = skillPassing([skill("Flyby")]);
  assert.equal(flyby.share, true);
  const flier = reachFrom({ i: 0, j: 0 }, 4, field(["..E.A"], flyby));
  assert.equal(flier.stops.has("0,2"), true, "on an enemy");
  assert.equal(flier.stops.has("0,4"), true, "on an ally");
  assert.equal(flier.cost.get("0,3"), 3, "and through the enemy");

  // A unit that moves through nobody still walks onto the tile of an enemy that shares it, and no further
  const walker = reachFrom({ i: 0, j: 0 }, 4, field([".S.."]));
  assert.equal(walker.stops.has("0,1"), true);
  assert.equal(walker.cost.has("0,2"), false);
  assert.equal(reachFrom({ i: 0, j: 0 }, 4, field([".E.."])).cost.has("0,1"), false);
});

test("a unit moved again goes back the way it came where its reach is not plain", () => {
  const nimble = reachFrom({ i: 2, j: 0 }, 5, field(LINE, passing({ through: "all" })));
  const way = wayBetween(nimble, { i: 2, j: 3 }, { i: 1, j: 1 });
  assert.deepEqual(way, [{ i: 2, j: 2 }, { i: 2, j: 1 }, { i: 1, j: 1 }]);
  assert.deepEqual(wayBetween(nimble, { i: 2, j: 1 }, { i: 2, j: 3 }), [{ i: 2, j: 2 }, { i: 2, j: 3 }]);
  assert.deepEqual(wayBetween(nimble, { i: 2, j: 3 }, { i: 2, j: 0 }), [{ i: 2, j: 2 }, { i: 2, j: 1 }, { i: 2, j: 0 }]);

  // A plain reach still takes the fewest steps
  const plain = reachFrom({ i: 2, j: 0 }, 4, field([".....", ".....", ".....", ".....", "....."]));
  assert.equal(wayBetween(plain, { i: 0, j: 0 }, { i: 0, j: 2 }).length, 2);
});

test("two units in one space are a tile apart, and the map never picks that space by itself", () => {
  const sword = { min: 1, max: 1 };
  assert.equal(strikesFrom({ i: 0, j: 2 }, { i: 0, j: 2 }, sword), true);
  assert.equal(strikesFrom({ i: 0, j: 2 }, { i: 0, j: 2 }, { min: 2, max: 2 }), false);
  const flier = reachFrom({ i: 0, j: 0 }, 4, field(["..E.."], passing({ through: "all", share: true })));
  assert.equal(flier.stops.has("0,2"), true);
  assert.deepEqual(strikeFrom(flier, { i: 0, j: 0 }, { i: 0, j: 2 }, sword).tile, { i: 0, j: 1 });

  // A unit that stands in the enemy's space already attacks from there
  assert.deepEqual(strikeFrom(flier, { i: 0, j: 2 }, { i: 0, j: 2 }, sword).tile, { i: 0, j: 2 });
});

/* -------------------------------------------- */
/*  Damage along a Path                         */
/* -------------------------------------------- */

test("Barge deals a share of each crossed enemy's maximum HP, more with Animal Handling, Athletics or Warfare", () => {
  const share = (self) => skillPassing([skill("Barge")], self).hits[0].percent;
  assert.equal(share({ qualities: "Mounted", checks: { handleAnimal: 14, warfare: 3, athletics: 60 } }), 10);
  assert.equal(share({ qualities: "Mounted", checks: { handleAnimal: 31, warfare: 12, athletics: 60 } }), 20);
  assert.equal(share({ qualities: "Mounted", checks: { handleAnimal: 2, warfare: 45 } }), 25);
  assert.equal(share({ qualities: "", checks: { handleAnimal: 45, athletics: 15, warfare: 0 } }), 15, "on foot it is Athletics");

  const barge = skillPassing([skill("Barge")], { qualities: "Mounted", checks: {} });
  const way = [{ i: 0, j: 1 }, { i: 0, j: 2 }, { i: 0, j: 3 }];
  const units = [
    { id: "a", tile: { i: 0, j: 2 }, foe: true, hp: 35, hpMax: 35 },
    { id: "b", tile: { i: 0, j: 3 }, foe: true, hp: 20, hpMax: 20 },
    { id: "c", tile: { i: 0, j: 1 }, foe: false, hp: 20, hpMax: 20 },
    { id: "d", tile: { i: 0, j: 1 }, foe: true, down: true, hp: 0, hpMax: 20 }
  ];
  const harm = pathHarm(way, barge, units);

  // The enemy on the tile the move ends on is not crossed, nor is an ally or a unit that is down
  assert.deepEqual(harm.passed, ["a"]);
  assert.deepEqual(harm.blows, [{ id: "a", skill: "Barge", amount: 3, nonlethal: false }]);
  assert.deepEqual(harm.shown, { a: 3 });
  assert.deepEqual(pathHarm([], barge, units), { passed: [], blows: [], shown: {} });
});

test("Trample hurts every enemy next to the way and its own unit, and kills nobody", () => {
  assert.deepEqual(skillPassing([skill("Trample")]).brushes, []);
  const trample = skillPassing([skill("Trample", { active: true })]);
  assert.deepEqual(trample.brushes, [{ skill: "Trample", amount: 4, percent: 0, nonlethal: true, self: 2 }]);
  assert.equal(threads(trample), false, "it changes nothing about where the unit goes");

  // From (1,0) along the row to (1,3)
  const way = [{ i: 1, j: 1 }, { i: 1, j: 2 }, { i: 1, j: 3 }];
  const units = [
    { id: "above", tile: { i: 0, j: 2 }, foe: true, hp: 20, hpMax: 20 },
    { id: "weak", tile: { i: 2, j: 3 }, foe: true, hp: 3, hpMax: 20 },
    { id: "ahead", tile: { i: 1, j: 4 }, foe: true, hp: 20, hpMax: 20 },
    { id: "last", tile: { i: 2, j: 1 }, foe: true, hp: 1, hpMax: 20 },
    { id: "behind", tile: { i: 0, j: 0 }, foe: true, hp: 20, hpMax: 20 },
    { id: "friend", tile: { i: 0, j: 1 }, foe: false, hp: 20, hpMax: 20 }
  ];
  const harm = pathHarm(way, trample, units, { hp: 5 });
  assert.deepEqual(harm.passed, []);
  assert.deepEqual(harm.shown, { above: 4, weak: 2, ahead: 4, "": 4 });

  // An enemy with 1 HP loses none, and counts for nothing against the unit: 2 for each of the other three,
  // which would be 6, leaves it 1 HP
  const own = harm.blows.at(-1);
  assert.deepEqual(own, { id: "", skill: "Trample", amount: 6, nonlethal: true });
  assert.equal(harm.blows.filter((blow) => blow.id).every((blow) => (blow.amount === 4) && blow.nonlethal), true);
  assert.equal(harm.blows.some((blow) => blow.id === "behind"), false, "the tile the move starts on is not moved onto");

  // An enemy moved through is next to the way as well
  const through = pathHarm(way, { ...trample, ways: [{ limit: Infinity, extra: 0 }] }, [{ id: "on", tile: { i: 1, j: 2 }, foe: true, hp: 9, hpMax: 9 }]);
  assert.deepEqual(through.passed, ["on"]);
  assert.equal(through.shown.on, 4);
});

test("Juna Oil adds MOV, holds its unit to Waiting, and deals an eighth of its Weight to enemies moved through", () => {
  const self = { hp: 20, hpMax: 20, level: 5, stats: { mov: 4 }, weapon: null, weight: 17, move: movementFacts({ mov: 7 }) };
  const off = skillTotals([skill("Juna Oil")], self);
  assert.equal(off.stats.mov ?? 0, 0);
  assert.equal(skillPassing([skill("Juna Oil")], self).ways.length, 0);

  const on = [skill("Juna Oil", { active: true })];
  assert.equal(skillTotals(on, self).stats.mov, 3);
  assert.equal(skillTotals(on, self).rules.has("onlyWait"), true);
  const oiled = skillPassing(on, self);
  assert.deepEqual(oiled.ways, [{ limit: Infinity, extra: 0 }]);
  assert.deepEqual(oiled.hits, [{ skill: "Juna Oil", amount: 2, percent: 0, nonlethal: false }]);

  // Used before its cooldown is over, it adds 1 MOV in place of 3
  const early = [skill("Juna Oil", { active: true, early: true })];
  assert.equal(skillTotals(early, self).stats.mov, 1);
  assert.equal(skillTotals(early, self).rules.has("onlyWait"), true);
  assert.equal(skillPassing(early, self).hits[0].amount, 2);
});

/* -------------------------------------------- */
/*  Asking about It                             */
/* -------------------------------------------- */

test("a unit's movement says whom it moved through", () => {
  const through = movementFacts({ spaces: 3, cost: 3, mov: 6, passed: ["foe"] });
  assert.deepEqual(through.passed, ["foe"]);
  assert.deepEqual(movementFacts({ spaces: 0, cost: 0, mov: 6, passed: ["foe"] }).passed, [], "a unit that has not moved passed nobody");
  assert.equal(moveHolds({ movedThrough: true }, through), true);
  assert.equal(moveHolds({ movedThrough: false }, through), false);
  assert.equal(moveHolds({ movedThrough: true }, movementFacts({ spaces: 3, cost: 3, mov: 6 })), false);
  assert.equal(moveHolds({ movedThrough: true }, null), false);
  assert.equal(movedThroughHolds({ movedThroughFoe: true }, through, "foe"), true);
  assert.equal(movedThroughHolds({ movedThroughFoe: true }, through, "other"), false);
  assert.equal(movedThroughHolds({ movedThroughFoe: false }, through, "other"), true);
  assert.equal(movedThroughHolds({ movedThroughFoe: true }, null, "foe"), false);
  assert.equal(movedThroughHolds({}, null, null), true);
  assert.equal(needsMove({ when: { movedThroughFoe: true }, combat: { damage: 2 } }), true);
});

test("Bypass adds damage and Critical against the enemy its unit moved through, and against no other", () => {
  const foe = (id) => ({
    ...fighter({ name: "Foe", hp: 60, hpMax: 60, stats: { def: 0, spd: 0 } }),
    near: { id, side: "enemy", tile: { i: 0, j: 2 }, ground: null, others: [] }
  });
  const thief = (passed, skills = [skill("Bypass")]) => fighter({ skills, move: movementFacts({ spaces: 3, cost: 3, mov: 6, passed }) });
  const plain = planExchange(thief(["foe"], []), foe("foe"), { distance: 1 }).initiator;
  const through = planExchange(thief(["foe"]), foe("foe"), { distance: 1 }).initiator;
  assert.equal(through.damage, plain.damage + 2);
  assert.equal(through.base.critical, plain.base.critical + 5);

  // Not against another enemy, not for a unit that moved through nobody, and not when it is attacked
  assert.equal(planExchange(thief(["foe"]), foe("other"), { distance: 1 }).initiator.damage, plain.damage);
  assert.equal(planExchange(thief([]), foe("foe"), { distance: 1 }).initiator.damage, plain.damage);
  const attacked = planExchange(foe("foe"), thief(["foe"]), { distance: 1 }).defender;
  const usual = planExchange(foe("foe"), thief(["foe"], []), { distance: 1 }).defender;
  assert.equal(attacked.damage, usual.damage);

  // Off the map, where movement cannot be judged, it is named to check by hand and adds nothing
  const unseen = planExchange(fighter({ skills: [skill("Bypass")], move: null }), foe("foe"), { distance: 1 }).initiator;
  assert.equal(unseen.damage, plain.damage);
});

test("a made-up skill can ask whether its unit moved through anyone", () => {
  const eager = made("Eager", [{ when: { movedThrough: true }, combat: { hit: 10 } }]);
  const self = (passed) => ({ hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null, move: movementFacts({ spaces: 2, cost: 2, mov: 5, passed }) });
  assert.equal(skillTotals([eager], self(["foe"])).combat.hit, 10);
  assert.equal(skillTotals([eager], self([])).combat.hit ?? 0, 0);
});

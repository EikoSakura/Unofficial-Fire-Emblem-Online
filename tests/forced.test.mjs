/**
 * Tests for `module/rules/forced.mjs` and what Step 9 gave the skills: where a unit that is moved against its
 * will lands, who is not moved, Shove with its Weight test and what skills make of it, and the steps a fight
 * leaves its units to take.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import {
  STEP_MOVES, addShove, beside, between, blocks, canShove, checkShove, checkStep, clearLine, emptyShove, lineTiles, pull, push,
  refuses, scatter, slide, stepBack, stepForward, stepOf, swaps, tryShove
} from "../module/rules/forced.mjs";
import { tileKey } from "../module/rules/reach.mjs";
import { attackRanges, checkEffects, skillShove, skillTotals } from "../module/rules/skills.mjs";
import { dice, fighter, made, skill } from "./lib/fixtures.mjs";

const at = (i, j) => ({ i, j });

/**
 * A map of so many rows and columns, with what stands on it.
 * @param {object} [map]
 * @param {number} [map.rows]
 * @param {number} [map.columns]
 * @param {{i: number, j: number}[]} [map.rock]     Tiles nobody stands on
 * @param {{i: number, j: number}[]} [map.units]    Tiles someone stands on
 * @param {[object, object][]} [map.walls]          Pairs of tiles with a wall between them
 * @returns {import("../module/rules/forced.mjs").ForcedField}
 */
function field({ rows = 7, columns = 7, rock = [], units = [], walls = [] } = {}) {
  const has = (list, tile) => list.some((other) => tileKey(other) === tileKey(tile));
  return {
    inside: (tile) => (tile.i >= 0) && (tile.i < rows) && (tile.j >= 0) && (tile.j < columns),
    stands: (tile) => !has(rock, tile),
    taken: (tile) => has(units, tile),
    wall: (from, to) => walls.some(([a, b]) => {
      return ((tileKey(a) === tileKey(from)) && (tileKey(b) === tileKey(to))) || ((tileKey(a) === tileKey(to)) && (tileKey(b) === tileKey(from)));
    })
  };
}

/** What a unit with these skills makes of its Shove; `on` are those switched on. */
const shoveOf = (names, on = names) => skillShove(names.map((name) => skill(name, { active: on.includes(name) })));

/** Roll out a fight in which every die comes up as told. */
function fight(initiator, defender, roll, distance = 1) {
  const plan = planExchange(initiator, defender, { distance });
  return resolveExchange(plan, typeof roll === "function" ? roll : () => roll);
}

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

const STEP = ["Shove", "Smite", "Tackle", "Bulldozer", "Impact", "Maneuver", "Foul Play", "Throw", "Pounce", "Repel", "Lunge", "Fortress",
  "Death Grip", "General"];

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of STEP ) assert.deepEqual(checkEffects(skill(name).effects), [], name);
});

test("a typing mistake in a shove or a step does not pass silently", () => {
  assert.deepEqual(checkShove({ spaces: 2 }), []);
  assert.deepEqual(checkShove({ moving: 1, holds: 1 }), []);
  assert.equal(checkShove({}).length, 1);
  assert.equal(checkShove({ space: 2 }).length, 2);
  assert.equal(checkShove({ spaces: 0 }).length, 1);
  assert.equal(checkShove({ spaces: 2, holds: 1 }).length, 1, "only a Shove that takes movement holds");

  const after = { on: "after", sure: true };
  for ( const move of STEP_MOVES ) assert.deepEqual(checkStep({ move }, after), [], move);
  assert.deepEqual(checkStep({ move: "back", may: true }, after), []);
  assert.deepEqual(checkStep({ move: "place", may: true, damage: 5, inflicts: ["daze"], cooldown: { stay: 1 } }, after), []);
  assert.equal(checkStep({ move: "sideways" }, after).length, 1);
  assert.equal(checkStep({ move: "back" }, null).length, 1, "a step waits for a moment of a fight");
  assert.equal(checkStep({ move: "back" }, { on: "turnStart", sure: true }).length, 1);
  assert.equal(checkStep({ move: "swap", may: true }, after).length, 1, "trading places is not for its owner to pick");
  assert.equal(checkStep({ move: "back", damage: 5 }, after).length, 1);
  assert.equal(checkStep({ move: "place", inflicts: ["dazed"] }, after).length, 1);
  assert.equal(checkStep({ move: "place", cooldown: { moved: 3 } }, after).length, 1);

  // In an effect, a step needs its moment, and hits are counted after the fight
  assert.equal(checkEffects([{ step: { move: "back" } }]).length > 0, true);
  assert.equal(checkEffects([{ proc: { on: "hit", sure: true, hits: 2 }, step: { move: "scatter" } }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "after", sure: true }, shove: { spaces: 2 } }]).length, 1);
  assert.equal(checkEffects([{ rules: ["rooted", "unforced", "held", "gripped"] }]).length, 0);
});

/* -------------------------------------------- */
/*  Who Is Moved                                */
/* -------------------------------------------- */

test("a rooted unit is moved by nobody but itself, and an unforced one by no enemy", () => {
  assert.equal(refuses([], "foe"), false);
  assert.equal(refuses(null, "friend"), false);
  assert.equal(refuses(["rooted"], "foe"), true);
  assert.equal(refuses(["rooted"], "friend"), true);
  assert.equal(refuses(["rooted"], "self"), false);
  assert.equal(refuses(["unforced"], "foe"), true);
  assert.equal(refuses(["unforced"], "apart"), true);
  assert.equal(refuses(["unforced"], "friend"), false);
  assert.equal(refuses(new Set(["unforced"]), "self"), false);
});

test("Fortress roots its unit while it is on, and General is never moved by an enemy", () => {
  const self = { hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null };
  assert.equal(skillTotals([skill("Fortress", { active: true })], self).rules.has("rooted"), true);
  assert.equal(skillTotals([skill("Fortress")], self).rules.has("rooted"), false);
  assert.equal(skillTotals([skill("General")], self).rules.has("unforced"), true);

  // No enemy slows a unit with General: what another unit put on it takes no MOV off it
  const slowed = { name: "Mire (Foe)", timed: true, foreign: true, nihil: false, effects: [{ stats: { mov: -2, spd: -2 } }] };
  assert.deepEqual(skillTotals([slowed], self).stats, { mov: -2, spd: -2 });
  assert.deepEqual(skillTotals([skill("General"), slowed], self).stats, { spd: -2 });
});

/* -------------------------------------------- */
/*  Where It Lands                              */
/* -------------------------------------------- */

test("a step goes along a row or a column", () => {
  assert.deepEqual(stepOf(at(2, 2), at(2, 3)), { di: 0, dj: 1 });
  assert.deepEqual(stepOf(at(2, 2), at(0, 2)), { di: -1, dj: 0 });
  assert.equal(stepOf(at(2, 2), at(2, 2)), null);
  assert.equal(stepOf(at(2, 2), at(3, 3)), null);
});

test("a unit is not moved off the map, through a wall, onto ground it cannot stand on or onto another unit", () => {
  assert.equal(blocks(at(0, 0), at(0, 1), field()), null);
  assert.equal(blocks(at(0, 0), at(-1, 0), field()), "edge");
  assert.equal(blocks(at(0, 0), at(0, 1), field({ walls: [[at(0, 1), at(0, 0)]] })), "wall");
  assert.equal(blocks(at(0, 0), at(0, 1), field({ rock: [at(0, 1)] })), "terrain");
  assert.equal(blocks(at(0, 0), at(0, 1), field({ units: [at(0, 1)] })), "taken");
});

test("a push goes straight away, as far as it can", () => {
  const open = push(at(3, 2), at(3, 3), 1, field());
  assert.deepEqual(open, { tile: at(3, 4), way: [at(3, 4)], moved: 1, blocked: null });
  assert.deepEqual(push(at(3, 2), at(3, 3), 2, field()).tile, at(3, 5));

  // The second space is taken: it goes one, and says what stopped it
  const short = push(at(3, 2), at(3, 3), 2, field({ units: [at(3, 5)] }));
  assert.equal(short.moved, 1);
  assert.equal(short.blocked, "taken");
  assert.deepEqual(short.tile, at(3, 4));

  // Nowhere to go at all
  const stuck = push(at(3, 2), at(3, 3), 2, field({ rock: [at(3, 4)] }));
  assert.equal(stuck.moved, 0);
  assert.equal(stuck.blocked, "terrain");
  assert.deepEqual(stuck.tile, at(3, 3));
  assert.equal(push(at(3, 5), at(3, 6), 1, field()).blocked, "edge");

  // Two units that do not share a row or a column are not pushed apart
  assert.equal(push(at(2, 2), at(3, 3), 1, field()).moved, 0);
  assert.equal(slide(at(1, 1), null, 2, field()).moved, 0);
});

test("a pull stops next to the unit that pulls", () => {
  assert.deepEqual(pull(at(3, 0), at(3, 4), 2, field()).tile, at(3, 2));
  assert.deepEqual(pull(at(3, 0), at(3, 2), 5, field()).tile, at(3, 1));
  assert.equal(pull(at(3, 0), at(3, 1), 5, field()).moved, 0);
  assert.equal(pull(at(3, 0), at(3, 4), 2, field({ units: [at(3, 3)] })).moved, 0);
});

test("two units trade places where each can stand on the other's ground", () => {
  assert.equal(swaps(at(1, 1), at(4, 4), field(), field()), true);
  assert.equal(swaps(at(1, 1), at(1, 1), field(), field()), false);

  // The second cannot stand where the first does, as a rider cannot on a Peak
  assert.equal(swaps(at(1, 1), at(4, 4), field(), field({ rock: [at(1, 1)] })), false);
  assert.equal(swaps(at(1, 1), at(4, 4), field({ rock: [at(4, 4)] }), field()), false);
});

test("the tiles next to a tile that a unit can be set down on", () => {
  assert.equal(beside(at(3, 3), field()).length, 4);
  assert.deepEqual(beside(at(0, 0), field({ units: [at(0, 1)] })), [at(1, 0)]);
  assert.equal(beside(at(3, 3), field({ rock: [at(2, 3)], walls: [[at(3, 3), at(4, 3)]] })).length, 2);
});

test("the space between two tiles two apart, and the step forward into it", () => {
  assert.deepEqual(between(at(3, 1), at(3, 3)), [at(3, 2)]);
  assert.deepEqual(between(at(1, 3), at(3, 3)), [at(2, 3)]);
  assert.deepEqual(between(at(2, 2), at(3, 3)), [at(2, 3), at(3, 2)]);
  assert.deepEqual(between(at(2, 2), at(2, 3)), []);
  assert.deepEqual(between(at(2, 2), at(2, 5)), []);

  assert.deepEqual(stepForward(at(3, 1), at(3, 3), field()), at(3, 2));
  assert.equal(stepForward(at(3, 1), at(3, 3), field({ units: [at(3, 2)] })), null, "a unit is in the way");
  assert.equal(stepForward(at(3, 1), at(3, 3), field({ rock: [at(3, 2)] })), null, "an obstacle is in the way");

  // Set corner to corner, either of the two tiles between will do
  assert.deepEqual(stepForward(at(2, 2), at(3, 3), field({ units: [at(2, 3)] })), at(3, 2));
  assert.equal(stepForward(at(2, 2), at(3, 3), field({ units: [at(2, 3)], rock: [at(3, 2)] })), null);
  assert.equal(stepForward(at(2, 2), at(2, 3), field()), null, "next to its foe there is no space between");
});

test("a step back goes straight away from the foe", () => {
  assert.deepEqual(stepBack(at(3, 3), at(3, 4), field()), at(3, 2));
  assert.deepEqual(stepBack(at(3, 3), at(1, 3), field()), at(4, 3));
  assert.equal(stepBack(at(3, 0), at(3, 1), field()), null, "its back is to the edge of the map");
  assert.equal(stepBack(at(3, 3), at(3, 4), field({ units: [at(3, 2)] })), null);

  // Corner to corner it backs away along either line, whichever is free
  assert.deepEqual(stepBack(at(3, 3), at(4, 4), field()), at(2, 3));
  assert.deepEqual(stepBack(at(3, 3), at(4, 4), field({ rock: [at(2, 3)] })), at(3, 2));
});

test("a straight line crosses the tiles between its ends, and is clear when none of them stands in it", () => {
  assert.deepEqual(lineTiles(at(0, 0), at(0, 3)), [at(0, 1), at(0, 2)]);
  assert.deepEqual(lineTiles(at(0, 0), at(0, 1)), []);
  assert.deepEqual(lineTiles(at(0, 0), at(0, 0)), []);

  // Exactly through the corners, it crosses only the tiles on the diagonal
  assert.deepEqual(lineTiles(at(0, 0), at(3, 3)), [at(1, 1), at(2, 2)]);
  assert.deepEqual(lineTiles(at(3, 3), at(0, 0)), [at(2, 2), at(1, 1)]);

  // Off the diagonal it crosses every tile it passes over
  assert.deepEqual(lineTiles(at(0, 0), at(1, 2)).map(tileKey), ["0,1", "1,1"]);
  assert.equal(lineTiles(at(0, 0), at(2, 5)).length, 6);

  const wall = (tile) => tileKey(tile) === "0,2";
  assert.equal(clearLine(at(0, 0), at(0, 4), wall), false);
  assert.equal(clearLine(at(1, 0), at(1, 4), wall), true);
  assert.equal(clearLine(at(0, 2), at(0, 4), wall), true, "the ends themselves are not asked");
});

/* -------------------------------------------- */
/*  Shove                                       */
/* -------------------------------------------- */

test("a unit shoves any unit whose Weight is not 3 or more above its own", () => {
  assert.equal(canShove(10, 10), true);
  assert.equal(canShove(10, 12), true);
  assert.equal(canShove(10, 13), false);
  assert.equal(canShove(10, 2), true);
  assert.equal(FEO.shove.margin, 3);
});

test("Shove pushes a neighbour one space, and says why when it cannot", () => {
  const unit = { tile: at(3, 2), weight: 10 };
  const ally = { tile: at(3, 3), weight: 8, relation: "friend", rules: [] };
  const done = tryShove(unit, ally, field());
  assert.equal(done.ok, true);
  assert.deepEqual(done.tile, at(3, 4));
  assert.equal(done.moved, 1);
  assert.equal(done.cost, null, "a Shove is the unit's Action");
  assert.deepEqual(done.skills, []);

  assert.equal(tryShove(unit, { ...ally, tile: at(3, 4) }, field()).reason, "apart");
  assert.equal(tryShove(unit, { ...ally, tile: at(4, 3) }, field()).reason, "apart");
  assert.equal(tryShove(unit, { ...ally, weight: 13 }, field()).reason, "weight");
  assert.equal(tryShove(unit, ally, field({ units: [at(3, 4)] })).reason, "taken");
  assert.equal(tryShove(unit, ally, field({ rock: [at(3, 4)] })).reason, "terrain");
  assert.equal(tryShove(unit, ally, field({ walls: [[at(3, 3), at(3, 4)]] })).reason, "wall");
  assert.equal(tryShove({ ...unit, tile: at(3, 5) }, { ...ally, tile: at(3, 6) }, field()).reason, "edge");
  assert.equal(tryShove(unit, { ...ally, rules: ["rooted"] }, field()).reason, "rooted");
  assert.equal(tryShove(unit, { ...ally, rules: ["unforced"] }, field()).ok, true, "an ally moves a General");
  assert.equal(tryShove(unit, { ...ally, relation: "foe", rules: ["unforced"] }, field()).reason, "rooted");
  assert.equal(tryShove(unit, { ...ally, relation: "foe" }, field()).ok, true, "an enemy is shoved like anyone");
});

test("Smite shoves 2 spaces while it is switched on", () => {
  assert.deepEqual(shoveOf([]), emptyShove());
  assert.equal(shoveOf(["Smite"], []).spaces, 1);
  const shove = shoveOf(["Smite"]);
  assert.equal(shove.spaces, 2);

  const unit = { tile: at(3, 2), weight: 10, shove };
  const ally = { tile: at(3, 3), weight: 8, relation: "friend" };
  const far = tryShove(unit, ally, field());
  assert.deepEqual(far.tile, at(3, 5));
  assert.deepEqual(far.way, [at(3, 4), at(3, 5)]);
  assert.deepEqual(far.skills, ["Smite"]);

  // The second space is not free: it goes one, as a plain Shove would
  const near = tryShove(unit, ally, field({ units: [at(3, 5)] }));
  assert.equal(near.ok, true);
  assert.deepEqual(near.tile, at(3, 4));
  assert.deepEqual(near.skills, []);
  assert.equal(tryShove(unit, ally, field({ units: [at(3, 4)] })).ok, false);
});

test("Bulldozer shoves an enemy for 1 movement in place of the Action, and holds it", () => {
  const shove = shoveOf(["Bulldozer"]);
  assert.equal(shove.moving, 1);
  assert.equal(shove.holds, 1);
  const unit = { tile: at(3, 2), weight: 10, shove, left: 3 };
  const foe = { tile: at(3, 3), weight: 8, relation: "foe" };

  const moving = tryShove(unit, foe, field());
  assert.equal(moving.cost, 1);
  assert.equal(moving.holds, 1);
  assert.deepEqual(moving.skills, ["Bulldozer"]);

  // With no movement left it is the unit's Action, and the enemy is held all the same
  const spent = tryShove({ ...unit, left: 0 }, foe, field());
  assert.equal(spent.cost, null);
  assert.equal(spent.holds, 1);

  // Off a battle, where movement is not counted, it is the Action too
  assert.equal(tryShove({ ...unit, left: null }, foe, field()).cost, null);

  // An ally is shoved as ever: as the Action, and is not held
  const ally = tryShove(unit, { ...foe, relation: "friend" }, field());
  assert.equal(ally.cost, null);
  assert.equal(ally.holds, 0);
  assert.deepEqual(ally.skills, []);

  // With Smite as well, it pushes 2 spaces for that movement
  const both = addShove(shoveOf(["Smite"]), { moving: 1, holds: 1 }, { skill: "Bulldozer" });
  const smitten = tryShove({ ...unit, shove: both }, foe, field());
  assert.equal(smitten.moved, 2);
  assert.equal(smitten.cost, 1);
  assert.deepEqual(smitten.skills, ["Smite", "Bulldozer"]);
});

test("the units next to a tile are pushed away from it, each where it has room", () => {
  const units = [{ id: "north", tile: at(2, 3) }, { id: "east", tile: at(3, 4) }, { id: "far", tile: at(3, 6) }, { id: "rooted", tile: at(4, 3) }];
  const taken = units.map((unit) => unit.tile);
  const moved = scatter(at(3, 3), units, 1, (id) => (id === "rooted") ? null : field({ units: taken }));
  assert.deepEqual(moved.map((entry) => [entry.id, tileKey(entry.tile)]), [["north", "1,3"], ["east", "3,5"]]);

  // A unit with its back to another stays, and so does the one behind it
  const line = [{ id: "a", tile: at(3, 4) }, { id: "b", tile: at(3, 5) }];
  assert.deepEqual(scatter(at(3, 3), line, 1, () => field({ units: line.map((unit) => unit.tile) })), []);
});

/* -------------------------------------------- */
/*  Steps a Fight Leaves                        */
/* -------------------------------------------- */

test("Tackle and Repel leave their unit a step once the fight it started is over", () => {
  const unit = () => fighter({ name: "A", hp: 60, hpMax: 60, skills: [skill("Tackle"), skill("Repel")] });
  const result = fight(unit(), fighter({ name: "B", hp: 60, hpMax: 60 }), 50);
  assert.deepEqual(result.steps, [
    { skill: "Tackle", by: "initiator", step: { move: "shove", may: true } },
    { skill: "Repel", by: "initiator", step: { move: "back", may: true } }
  ]);

  // Neither is for a fight another unit started
  const answered = fight(fighter({ name: "B", hp: 60, hpMax: 60 }), unit(), 50);
  assert.equal(answered.steps, undefined);

  // A foe that fell is not shoved; the step back is still there
  const slain = fight(unit(), fighter({ name: "B", hp: 1, stats: { def: 0 } }), 1);
  assert.deepEqual(slain.steps.map((entry) => entry.skill), ["Repel"]);
});

test("Pounce trades places with its foe after a fight it took effect in, whoever started it", () => {
  const pouncer = () => fighter({ name: "A", hp: 400, hpMax: 400, skills: [skill("Pounce")], stats: { dex: 20 } });
  const sturdy = () => fighter({ name: "B", hp: 400, hpMax: 400 });
  const lucky = fight(pouncer(), sturdy(), 5);
  assert.deepEqual(lucky.steps, [{ skill: "Pounce", by: "initiator", step: { move: "swap" } }]);
  assert.equal(fight(pouncer(), sturdy(), 95).steps, undefined, "it did not take effect");

  const defending = fight(sturdy(), pouncer(), 5);
  assert.deepEqual(defending.steps, [{ skill: "Pounce", by: "defender", step: { move: "swap" } }]);

  // A foe that fell trades places with nobody
  const fallen = fight(pouncer(), fighter({ name: "B", hp: 3, stats: { def: 0 } }), 5);
  assert.equal(fallen.defender.hp <= 0, true);
  assert.equal(fallen.steps, undefined);
});

test("Impact pushes the units around its target once an attack lands, while it is switched on", () => {
  const unit = (active) => fighter({ name: "A", hp: 60, hpMax: 60, skills: [skill("Impact", { active })] });
  const hit = fight(unit(true), fighter({ name: "B", hp: 60, hpMax: 60 }), 50);
  assert.deepEqual(hit.steps, [{ skill: "Impact", by: "initiator", step: { move: "scatter", spaces: 1 } }]);
  assert.equal(fight(unit(false), fighter({ name: "B", hp: 60, hpMax: 60 }), 50).steps, undefined);
  assert.equal(fight(unit(true), fighter({ name: "B", hp: 60, hpMax: 60 }), 100).steps, undefined, "every attack missed");
  assert.equal(fight(fighter({ name: "B", hp: 60, hpMax: 60 }), unit(true), 50).steps, undefined);

  // The attack that fells the target pushes those around it all the same
  const slain = fight(unit(true), fighter({ name: "B", hp: 1, stats: { def: 0 } }), 1);
  assert.equal(slain.steps.length, 1);
});

test("Throw is offered once its unit has landed two attacks, and is not used until it is taken", () => {
  const thrower = (stats = {}) => fighter({ name: "A", hp: 60, hpMax: 60, skills: [skill("Throw")], stats });
  const foe = () => fighter({ name: "B", hp: 60, hpMax: 60, stats: { spd: 1 } });

  // One attack is not enough
  const once = fight(thrower(), fighter({ name: "B", hp: 60, hpMax: 60 }), 50);
  assert.equal(once.attacks.filter((attack) => attack.side === "initiator").length, 1);
  assert.equal(once.steps, undefined);

  // Fast enough to attack twice, it is offered, with its item to spend
  const twice = fight(thrower({ spd: 20 }), foe(), 50);
  assert.equal(twice.attacks.filter((attack) => (attack.side === "initiator") && attack.hit).length, 2);
  assert.equal(twice.steps.length, 1);
  assert.equal(twice.steps[0].skill, "Throw");
  assert.equal(twice.steps[0].id, "throw");
  assert.deepEqual(twice.steps[0].step, { move: "place", may: true, damage: 5, inflicts: ["daze"], cooldown: { stay: 1 } });
  assert.deepEqual(twice.initiator.spent, [], "passing it up costs nothing");

  // On cooldown it is not offered
  const cooling = { ...skill("Throw"), state: { active: false, cooldown: 2, lasting: 0, used: 0 } };
  const waiting = fight(fighter({ name: "A", hp: 60, hpMax: 60, skills: [cooling], stats: { spd: 20 } }), foe(), 50);
  assert.equal(waiting.steps, undefined);
});

test("Lunge reaches 2 spaces with a weapon of range 1 when its unit starts the fight, for +10 Critical and a step forward", () => {
  const lunger = (active = true) => fighter({ name: "A", hp: 60, hpMax: 60, skills: [skill("Lunge", { active })] });
  const foe = () => fighter({ name: "B", hp: 60, hpMax: 60 });

  // The map reads how far it reaches before any fight is planned
  const self = { hp: 60, hpMax: 60, level: 5, stats: {}, weapon: { category: "sword", range: "1", reach: { min: 1, max: 1 } } };
  assert.deepEqual(attackRanges([skill("Lunge", { active: true })], self), [{ max: 2, clear: true }]);
  assert.deepEqual(attackRanges([skill("Lunge")], self), []);
  assert.deepEqual(attackRanges([skill("Lunge", { active: true })], { ...self, weapon: { category: "bow", range: "2", reach: { min: 2, max: 2 } } }), []);

  // From 2 spaces: the attack is made, with the Critical and the step; the foe's sword does not answer
  const far = planExchange(lunger(), foe(), { distance: 2 });
  assert.equal(far.initiator.blocked ?? null, null);
  assert.equal(far.initiator.crit - planExchange(lunger(), foe(), { distance: 1 }).initiator.crit, 10);
  assert.deepEqual(fight(lunger(), foe(), 50, 2).steps, [{ skill: "Lunge", by: "initiator", step: { move: "forward" } }]);

  // Next to its foe it attacks as usual
  assert.equal(fight(lunger(), foe(), 50, 1).steps, undefined);

  // Switched off, or when it is attacked, it does not reach
  assert.equal(planExchange(lunger(false), foe(), { distance: 2 }).initiator.blocked, "outOfRange");
  const attacked = planExchange(fighter({ name: "B", weapon: { category: "bow", range: "2" } }), lunger(), { distance: 2 });
  assert.ok(attacked.defender.blocked, "it does not answer from 2 spaces");
});

test("a step is told once for each skill, however often its moment comes", () => {
  const eager = made("Eager", [{ proc: { on: "hit", sure: true }, step: { move: "scatter" } }]);
  const result = fight(fighter({ name: "A", hp: 60, hpMax: 60, skills: [eager], stats: { spd: 20 } }),
    fighter({ name: "B", hp: 60, hpMax: 60, stats: { spd: 1 } }), dice(50, 50, 50, 50, 50, 50, 50, 50, 50, 50));
  assert.equal(result.steps.length, 1);
});

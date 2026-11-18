/**
 * Tests for `module/rules/phases.mjs`: which sides of a battle take a Phase, and whose Phase comes next. A
 * side with nobody left in the fight, by the test `outOfFight` of `module/rules/defeat.mjs`, takes none.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { outOfFight } from "../module/rules/defeat.mjs";
import { listedSides, phaseAfter, phaseSides } from "../module/rules/phases.mjs";

const ORDER = FEO.phases;

/** A unit of a side, as the battle reads it: in the fight unless its defeat state and HP say otherwise. */
const unit = (army, state = "", hp = 10) => ({ army, out: outOfFight({ state, hp, hpMax: 10 }) });

/** Play Phases one after another, as ending each of them does, and tell whose they were and which turn. */
function play(units, phase, turns) {
  const seen = [];
  let round = 1;
  for ( let step = 0; step < turns; step++ ) {
    const next = phaseAfter(phase, phaseSides(units, ORDER), ORDER);
    if ( next.turn ) round += 1;
    phase = next.army;
    seen.push(`${round}:${phase}`);
  }
  return seen;
}

/* -------------------------------------------- */
/*  Which Sides Take a Phase                    */
/* -------------------------------------------- */

test("every side with a unit in the fight takes a Phase, in the order of the sides", () => {
  const units = [unit("enemy"), unit("other"), unit("player"), unit("ally")];
  assert.deepEqual(phaseSides(units, ORDER), ["player", "enemy", "ally", "other"]);
  assert.deepEqual(phaseSides([unit("enemy"), unit("player")], ORDER), ["player", "enemy"]);
});

test("a side whose units are all dead or have retreated takes none", () => {
  const units = [unit("player"), unit("enemy", "dead", 0), unit("enemy", "retreated", 0), unit("ally")];
  assert.deepEqual(phaseSides(units, ORDER), ["player", "ally"]);
});

test("neither does a side whose units were all captured, or left at 0 HP with nothing said of them", () => {
  assert.deepEqual(phaseSides([unit("player"), unit("enemy", "captured", 4)], ORDER), ["player"]);
  assert.deepEqual(phaseSides([unit("player"), unit("enemy", "", 0)], ORDER), ["player"]);
});

test("a side with one unit left standing among the fallen still takes its Phase", () => {
  const units = [unit("player"), unit("enemy", "dead", 0), unit("enemy"), unit("enemy", "retreated", 0)];
  assert.deepEqual(phaseSides(units, ORDER), ["player", "enemy"]);
});

test("a side that only has Incapacitated units left takes its Phase: their timers run on their turns", () => {
  const units = [unit("player", "incapacitated", -3), unit("player", "incapacitated", 0), unit("enemy")];
  assert.deepEqual(phaseSides(units, ORDER), ["player", "enemy"]);
});

test("with nobody left in the fight at all, the sides that are there take their Phases as before", () => {
  const units = [unit("player", "dead", 0), unit("enemy", "dead", 0)];
  assert.deepEqual(phaseSides(units, ORDER), ["player", "enemy"]);
  assert.deepEqual(phaseSides([], ORDER), []);
});

/* -------------------------------------------- */
/*  Whose Phase Comes Next                      */
/* -------------------------------------------- */

test("the next side in the order has the next Phase, and a new turn begins after the last", () => {
  const sides = ["player", "enemy", "ally"];
  assert.deepEqual(phaseAfter("player", sides, ORDER), { army: "enemy", turn: false });
  assert.deepEqual(phaseAfter("enemy", sides, ORDER), { army: "ally", turn: false });
  assert.deepEqual(phaseAfter("ally", sides, ORDER), { army: "player", turn: true });
});

test("a side with nobody left in the fight is passed over", () => {
  const units = [unit("player"), unit("enemy", "dead", 0), unit("ally")];
  const sides = phaseSides(units, ORDER);
  assert.deepEqual(phaseAfter("player", sides, ORDER), { army: "ally", turn: false });
  assert.deepEqual(phaseAfter("ally", sides, ORDER), { army: "player", turn: true });
});

test("the last side left has Phase after Phase, a turn of the battle each: nothing hangs and nothing ends", () => {
  const units = [unit("player"), unit("enemy", "dead", 0)];
  assert.deepEqual(play(units, "player", 4), ["2:player", "3:player", "4:player", "5:player"]);
  const foes = [unit("player", "dead", 0), unit("enemy")];
  assert.deepEqual(play(foes, "enemy", 3), ["2:enemy", "3:enemy", "4:enemy"]);
});

test("a side whose last unit falls in its own Phase hands over to the next side that is left", () => {
  const units = [unit("player"), unit("enemy", "dead", 0)];
  assert.deepEqual(phaseAfter("enemy", phaseSides(units, ORDER), ORDER), { army: "player", turn: true });
  const fallen = [unit("player", "dead", 0), unit("enemy")];
  assert.deepEqual(phaseAfter("player", phaseSides(fallen, ORDER), ORDER), { army: "enemy", turn: false });
});

test("a side that has a unit back takes its Phase again at its next place in the order", () => {
  const enemy = unit("enemy", "dead", 0);
  const units = [unit("player"), enemy];
  assert.deepEqual(play(units, "player", 2), ["2:player", "3:player"]);

  // Raised during the players' Phase: its place in this turn is still to come
  enemy.out = outOfFight({ state: "", hp: 5, hpMax: 10 });
  assert.deepEqual(play(units, "player", 3), ["1:enemy", "2:player", "2:enemy"]);

  // Players brought back during the enemy's Phase have had their place in this turn: theirs is the next one
  const back = [unit("player", "dead", 0), unit("enemy")];
  assert.deepEqual(play(back, "enemy", 1), ["2:enemy"]);
  back[0].out = false;
  assert.deepEqual(play(back, "enemy", 2), ["2:player", "2:enemy"]);
});

test("reinforcements bring their side back in the same way", () => {
  const units = [unit("player"), unit("enemy", "dead", 0)];
  assert.deepEqual(phaseSides(units, ORDER), ["player"]);
  units.push(unit("enemy"));
  assert.deepEqual(phaseSides(units, ORDER), ["player", "enemy"]);
  assert.deepEqual(phaseAfter("player", phaseSides(units, ORDER), ORDER), { army: "enemy", turn: false });
});

test("no side taking a Phase leaves nothing to begin", () => {
  assert.equal(phaseAfter("player", [], ORDER), null);
  assert.deepEqual(phaseAfter(null, ["enemy"], ORDER), { army: "enemy", turn: true });
});

/* -------------------------------------------- */
/*  The Phase Banner                            */
/* -------------------------------------------- */

test("the banner lists the sides that take a Phase, and the side whose Phase is still running", () => {
  assert.deepEqual(listedSides("player", ["player"], ORDER), ["player"]);
  assert.deepEqual(listedSides("player", ["player", "ally"], ORDER), ["player", "ally"]);

  // The last enemy fell in the enemy's own Phase: it is listed until that Phase ends
  assert.deepEqual(listedSides("enemy", ["player"], ORDER), ["player", "enemy"]);
});

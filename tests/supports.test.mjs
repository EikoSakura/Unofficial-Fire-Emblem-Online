/**
 * Tests for `module/rules/supports.mjs`: how support points become ranks, the choice between A+ and S that a
 * support comes to at A, and what each thing partners do together is worth.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { supportBonus } from "../module/rules/progression.mjs";
import {
  addPoints, atFork, bondsWithin, eventPoints, isReady, isTop, ladder, newBond, nextRanks, openTops, pointsForNext,
  rankBelow, rankProgress, startingRank, stepRank, takeTop, takenTops, topRanks, unmetAllies
} from "../module/rules/supports.mjs";

const bond = (rank, points = 0) => ({ rank, points });

test("the ranks climb from E to A, then fork into A+ and S", () => {
  assert.deepEqual(ladder(), ["E", "D", "C", "B", "A"]);
  assert.deepEqual(topRanks(), ["A+", "S"]);
  assert.deepEqual(nextRanks("E"), ["D"]);
  assert.deepEqual(nextRanks("B"), ["A"]);
  assert.deepEqual(nextRanks("A"), ["A+", "S"]);
  assert.deepEqual(nextRanks("A+"), []);
  assert.deepEqual(nextRanks("S"), []);
  assert.equal(atFork("A"), true);
  assert.equal(atFork("B"), false);
  assert.equal(isTop("A+"), true);
  assert.equal(isTop("S"), true);
  assert.equal(isTop("A"), false);
});

test("the rank below either of the highest is A, and E has none below it", () => {
  assert.equal(rankBelow("S"), "A");
  assert.equal(rankBelow("A+"), "A");
  assert.equal(rankBelow("A"), "B");
  assert.equal(rankBelow("D"), "E");
  assert.equal(rankBelow("E"), null);
});

test("A+ and S give the same: the Affinity boosts five times over", () => {
  assert.equal(FEO.supportRanks["A+"].level, 5);
  assert.equal(FEO.supportRanks.S.level, 5);
  const fire = FEO.affinityBoosts.fire;
  const thunder = FEO.affinityBoosts.thunder;
  assert.deepEqual(
    supportBonus(fire, thunder, FEO.supportRanks["A+"].level),
    supportBonus(fire, thunder, FEO.supportRanks.S.level)
  );
});

test("a world counts points for what partners do together unless it is told otherwise", () => {
  assert.equal(FEO.supports.method, "points");
  assert.equal(eventPoints("adjacent"), 4);
  assert.equal(eventPoints("shove"), 2);
  assert.equal(eventPoints("assist"), 6);
  assert.equal(eventPoints("rescue"), 5);
  assert.equal(eventPoints("fight"), 5);
  assert.equal(eventPoints("battle"), 10);
  assert.equal(eventPoints("battle", "chapters"), 1);
  assert.equal(eventPoints("fight", "chapters"), 0);
  assert.equal(eventPoints("battle", "manual"), 0);
});

test("the points a rank needs", () => {
  assert.equal(pointsForNext("E", "points"), 80);
  assert.equal(pointsForNext("A", "points"), 80);
  assert.equal(pointsForNext("S", "points"), null);
  assert.equal(pointsForNext("A+", "points"), null);
  assert.equal(pointsForNext("E", "chapters"), 2);
  assert.equal(pointsForNext("B", "chapters"), 15);
  assert.equal(pointsForNext("A", "chapters"), 20);
  assert.equal(pointsForNext("C", "manual"), null);
});

test("points raise a rank at 80 and start again from what is left over", () => {
  assert.deepEqual(
    addPoints(bond("E", 76), 6, { method: "points" }),
    { rank: "D", points: 2, rankUps: 1, gained: 6, ready: false, held: false, ripened: false, open: ["A+", "S"] }
  );
  const far = addPoints(bond("E", 0), 170, { method: "points" });
  assert.equal(far.rank, "C");
  assert.equal(far.points, 10);
  assert.equal(far.rankUps, 2);
});

test("a point for each battle is a running total", () => {
  const after = addPoints(bond("D", 4), 1, { method: "chapters" });
  assert.equal(after.rank, "C");
  assert.equal(after.points, 5);
  assert.equal(after.rankUps, 1);
});

test("at A the points make a support ready, and its partners choose", () => {
  const after = addPoints(bond("A", 76), 6, { method: "points" });
  assert.equal(after.rank, "A");
  assert.equal(after.points, 80);
  assert.equal(after.gained, 4);
  assert.equal(after.rankUps, 0);
  assert.equal(after.ready, true);
  assert.equal(after.ripened, true);
  assert.deepEqual(after.open, ["A+", "S"]);
  assert.equal(isReady(after, "points"), true);

  // It gains nothing more while it waits, and does not ripen twice
  const again = addPoints(after, 10, { method: "points" });
  assert.equal(again.points, 80);
  assert.equal(again.gained, 0);
  assert.equal(again.ready, true);
  assert.equal(again.ripened, false);
});

test("a support can climb to A and become ready with the same points", () => {
  const after = addPoints(bond("B", 70), 100, { method: "points" });
  assert.equal(after.rank, "A");
  assert.equal(after.rankUps, 1);
  assert.equal(after.points, 80);
  assert.equal(after.gained, 90);
  assert.equal(after.ready, true);
  assert.equal(after.ripened, true);
});

test("a highest rank one of the two holds with somebody else is not open", () => {
  const one = addPoints(bond("A", 79), 1, { method: "points", taken: ["S"] });
  assert.equal(one.ready, true);
  assert.deepEqual(one.open, ["A+"]);
  const none = addPoints(bond("A", 79), 1, { method: "points", taken: ["S", "A+"] });
  assert.equal(none.ready, false);
  assert.equal(none.held, true);
  assert.equal(none.ripened, true);
  assert.deepEqual(none.open, []);
});

test("a support of the highest rank gains nothing", () => {
  for ( const rank of ["A+", "S"] ) {
    const after = addPoints(bond(rank, 3), 10, { method: "points" });
    assert.equal(after.rank, rank);
    assert.equal(after.points, 3);
    assert.equal(after.gained, 0);
    assert.equal(after.rankUps, 0);
  }
});

test("ranks raised by hand are not raised by points", () => {
  const after = addPoints(bond("C", 0), 500, { method: "manual" });
  assert.equal(after.rank, "C");
  assert.equal(after.rankUps, 0);
  assert.equal(after.ready, false);
});

test("taking one of the highest ranks", () => {
  assert.deepEqual(takeTop(bond("A", 80), "S", { method: "points" }), { rank: "S", points: 0 });
  assert.deepEqual(takeTop(bond("A", 80), "A+", { method: "points" }), { rank: "A+", points: 0 });
  assert.deepEqual(takeTop(bond("A", 21), "S", { method: "chapters" }), { rank: "S", points: 21 });

  // Not before it has the points, unless a Game Master hands it out
  assert.equal(takeTop(bond("A", 40), "S", { method: "points" }), null);
  assert.deepEqual(takeTop(bond("A", 40), "S", { method: "points", force: true }), { rank: "S", points: 0 });
  assert.deepEqual(takeTop(bond("A", 0), "A+", { method: "manual", force: true }), { rank: "A+", points: 0 });

  // Not from below A, not a rank that is no highest rank, and not one that is taken
  assert.equal(takeTop(bond("B", 80), "S", { method: "points", force: true }), null);
  assert.equal(takeTop(bond("A", 80), "A", { method: "points" }), null);
  assert.equal(takeTop(bond("A", 80), "S", { method: "points", taken: ["S"] }), null);
  assert.equal(takeTop(bond("S", 0), "A+", { method: "points", force: true }), null);
});

test("a unit holds one A+ and one S", () => {
  const bonds = [bond("S"), bond("A", 80), bond("C"), bond("A+")];
  assert.deepEqual(takenTops(bonds).sort(), ["A+", "S"]);
  assert.deepEqual(takenTops(bonds, 0), ["A+"]);
  assert.deepEqual(takenTops(bonds, 1).sort(), ["A+", "S"]);
  assert.deepEqual(openTops(["S"]), ["A+"]);
  assert.deepEqual(openTops(["S"], ["A+"]), []);
  assert.deepEqual(openTops([], ["A+"]), ["S"]);
  assert.deepEqual(openTops(), ["A+", "S"]);
});

test("a Bond Support starts at D", () => {
  assert.equal(startingRank(true, "E"), "D");
  assert.equal(startingRank(true, "B"), "B");
  assert.equal(startingRank(true, "A+"), "A+");
  assert.equal(startingRank(false, "E"), "E");
});

test("the bonds within a group of units", () => {
  const units = [
    { uuid: "Actor.a", names: ["Lyra"], bonds: [{ name: "Corin", uuid: "Actor.b" }, { name: "Nobody here" }] },
    { uuid: "Actor.b", names: ["Corin"], bonds: [{ name: "lyra" }] },
    { uuid: "Actor.c", names: ["Brigand"], bonds: [] }
  ];
  assert.deepEqual(bondsWithin(units), [{ unit: 0, bond: 0, partner: 1 }, { unit: 1, bond: 0, partner: 0 }]);
});

/* -------------------------------------------- */
/*  Supports that begin by themselves           */
/* -------------------------------------------- */

const onMap = (name, side, { linked = true, bonds = [] } = {}) => {
  return { uuid: `Actor.${name}`, names: [name], side, linked, bonds };
};

test("a support that has just begun is an E with nothing to its name", () => {
  assert.deepEqual(newBond({ name: "Corvin", affinity: "fire", uuid: "Actor.Corvin" }), {
    name: "Corvin", affinity: "fire", rank: "E", points: 0, inRange: false, adjacent: false, auto: true, kin: false,
    uuid: "Actor.Corvin"
  });
  assert.equal(newBond().uuid, "");
});

test("a unit has yet to meet the allies none of its bonds names", () => {
  const corvin = onMap("Corvin", "player");
  const isolde = onMap("Isolde", "player");
  const guest = onMap("Guest", "ally");
  const maren = onMap("Maren", "player", { bonds: [{ uuid: "Actor.Corvin", name: "Corvin" }] });
  assert.deepEqual(unmetAllies(maren, [maren, corvin, isolde, guest]).map((unit) => unit.names[0]), ["Isolde", "Guest"]);
});

test("a bond kept by name alone still names its partner", () => {
  const isolde = onMap("Isolde", "player");
  const maren = onMap("Maren", "player", { bonds: [{ name: "isolde" }] });
  assert.deepEqual(unmetAllies(maren, [isolde]), []);
});

test("foes, units of no side and copies of a unit begin no support", () => {
  const maren = onMap("Maren", "player");
  const others = [onMap("Brigand", "enemy"), onMap("Trader", "other"), onMap("Soldier", "player", { linked: false })];
  assert.deepEqual(unmetAllies(maren, others), []);
  assert.deepEqual(unmetAllies(onMap("Soldier", "player", { linked: false }), [maren]), []);
  assert.deepEqual(unmetAllies(onMap("Trader", "other"), [onMap("Pedlar", "other")]), []);
});

test("an ally with two tokens on the map is met once", () => {
  const maren = onMap("Maren", "player");
  const corvin = onMap("Corvin", "player");
  assert.equal(unmetAllies(maren, [corvin, { ...corvin }]).length, 1);
});

test("foes of one side come to support each other as allies do", () => {
  const boss = onMap("Warlord", "enemy");
  assert.equal(unmetAllies(boss, [onMap("Lieutenant", "enemy"), onMap("Maren", "player")]).length, 1);
});

test("a rank up by hand climbs to A and no further, and starts the points over", () => {
  assert.deepEqual(stepRank(bond("E", 30), { method: "points" }), { rank: "D", points: 0 });
  assert.deepEqual(stepRank(bond("B", 79), { method: "points" }), { rank: "A", points: 0 });
  assert.equal(stepRank(bond("A", 80), { method: "points" }), null);
  assert.equal(stepRank(bond("S"), { method: "points" }), null);
});

test("a rank down by hand goes from either of the highest to A, and from E nowhere", () => {
  assert.deepEqual(stepRank(bond("S", 0), { lower: true, method: "points" }), { rank: "A", points: 0 });
  assert.deepEqual(stepRank(bond("A+", 0), { lower: true, method: "points" }), { rank: "A", points: 0 });
  assert.deepEqual(stepRank(bond("C", 40), { lower: true, method: "points" }), { rank: "D", points: 0 });
  assert.equal(stepRank(bond("E", 10), { lower: true, method: "points" }), null);
});

test("with a point for each battle, a rank set by hand has the points of that rank", () => {
  const at = FEO.supports.chapters.thresholds;
  assert.deepEqual(stepRank(bond("E", 1), { method: "chapters" }), { rank: "D", points: at.D });
  assert.deepEqual(stepRank(bond("D", at.C + 3), { method: "chapters" }), { rank: "C", points: at.C + 3 });
  assert.deepEqual(stepRank(bond("B", at.B + 2), { lower: true, method: "chapters" }), { rank: "C", points: at.B - 1 });
  assert.deepEqual(stepRank(bond("D", at.D), { lower: true, method: "chapters" }), { rank: "E", points: at.D - 1 });
});

test("ranks raised by hand alone keep the points they have", () => {
  assert.deepEqual(stepRank(bond("C", 7), { method: "manual" }), { rank: "B", points: 7 });
});

test("the bar of a support fills a part for each rank climbed, and the rank it has by its points", () => {
  const per = FEO.supports.points.perRank;
  assert.deepEqual(rankProgress(bond("E", 0), "points"), [0, 0, 0, 0, 0]);
  assert.deepEqual(rankProgress(bond("C", per / 2), "points"), [1, 1, 0.5, 0, 0]);
  assert.deepEqual(rankProgress(bond("A", per), "points"), [1, 1, 1, 1, 1]);
  assert.deepEqual(rankProgress(bond("S", 0), "points"), [1, 1, 1, 1, 1]);
  assert.deepEqual(rankProgress(bond("B", 5), "manual"), [1, 1, 1, 0, 0]);
});

test("with a point for each battle, the bar counts from the points the rank was reached at", () => {
  const at = FEO.supports.chapters.thresholds;
  const half = at.C + ((at.B - at.C) / 2);
  assert.deepEqual(rankProgress(bond("C", half), "chapters"), [1, 1, 0.5, 0, 0]);
  assert.deepEqual(rankProgress(bond("E", at.D / 2), "chapters"), [0.5, 0, 0, 0, 0]);
});

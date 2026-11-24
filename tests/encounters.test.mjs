/**
 * Tests for `module/rules/encounters.mjs`: what a prepared battle holds, where its units stand, what its
 * Objectives need, and how hard it reads for a party.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import {
  blowWorth, cleanEncounter, encounterChecks, expOnOffer, gatherTiles, hitsToFell, newEncounter, partyLevel, protectedGroup,
  readDifficulty, scatterTiles
} from "../module/rules/encounters.mjs";
import { seededRandom } from "../module/rules/mapgen.mjs";

const blow = (damage, hit = 100, crit = 0, attacks = 1) => ({ damage, hit, crit, attacks });

test("an attack is worth its damage by its chances", () => {
  assert.equal(blowWorth(null), 0);
  assert.equal(blowWorth(blow(10)), 10);
  assert.equal(blowWorth(blow(10, 50)), 5);
  assert.equal(blowWorth(blow(10, 100, 50)), 20, "a critical hit deals three times as much");
  assert.equal(blowWorth(blow(10, 100, 0, 2)), 20);
  assert.equal(blowWorth(blow(10, 140, -5)), 10, "chances are held within 0 and 100");
  assert.equal(hitsToFell(blow(7), 20), 3);
  assert.equal(hitsToFell(blow(20), 20), 1);
  assert.equal(hitsToFell(blow(0), 20), Infinity);
  assert.equal(hitsToFell(null, 20), Infinity);
});

test("a party is counted at its average Level", () => {
  assert.equal(partyLevel([7, 6, 7, 6, 7, 6]), 7);
  assert.equal(partyLevel([3, 4]), 4);
  assert.equal(partyLevel([]), 1);
});

test("the Kill EXP on a map is that of every foe that gives any", () => {
  const even = FEO.exp.combat.kill[0];
  const higher = FEO.exp.combat.kill[-2];
  assert.equal(expOnOffer([{ level: 5, count: 3 }, { level: 7, count: 1 }, { level: 5, count: 4, silent: true }], 5), (3 * even) + higher);
});

test("a battle reads harder the more of its HP the party loses on the way", () => {
  // Two units of 20 HP against four foes of 20 HP. Each unit fells a foe in two attacks: eight attacks, four
  // turns. Each foe deals a unit 5 a turn: 20 a turn at first, half of that over the fight, 40 of the party's 40
  const party = [{ hp: 20 }, { hp: 20 }];
  const foes = [{ count: 4, hp: 20 }];
  const read = readDifficulty({ party, foes, dealt: [[blow(10)], [blow(10)]], taken: [[blow(5), blow(5)]] });
  assert.equal(read.turns, 4);
  assert.equal(read.share, 1);
  assert.equal(read.key, "lunatic");
  assert.equal(read.risk, null, "nobody falls in two hits");

  const easier = readDifficulty({ party, foes: [{ count: 1, hp: 20 }], dealt: [[blow(10)], [blow(10)]], taken: [[blow(5), blow(5)]] });
  assert.equal(easier.turns, 1);
  assert.equal(easier.share, 2.5 / 40);
  assert.equal(easier.key, "easy");
  assert.ok(easier.step < read.step);
});

test("healing, silent foes and units that do not fight are counted as they are", () => {
  const foes = [{ count: 4, hp: 20 }];
  const taken = [[blow(5), blow(5), blow(5)]];
  // A healer does not fight: the two fighters still need four turns, and the 30 it heals come off the 40 taken
  const healed = readDifficulty({ party: [{ hp: 20 }, { hp: 20 }, { hp: 20, heals: 7.5 }], foes, dealt: [[blow(10)], [blow(10)], [null]], taken });
  assert.equal(healed.turns, 4);
  assert.equal(healed.share, 10 / 60);
  const silent = readDifficulty({ party: [{ hp: 20 }], foes: [{ count: 2, hp: 10, silent: true }], dealt: [[blow(10)]], taken: [[blow(20)]] });
  assert.equal(silent.turns, 2);
  assert.equal(silent.share, 0);
  assert.equal(readDifficulty({ party: [{ hp: 20 }], foes: [], dealt: [[]], taken: [] }), null);
  assert.equal(readDifficulty({ party: [{ hp: 20 }], foes, dealt: [[null]], taken: [[blow(5)]] }), null, "nobody fights");
});

test("the unit most foes fell in two hits is the one at risk", () => {
  const read = readDifficulty({
    party: [{ hp: 30 }, { hp: 16 }],
    foes: [{ count: 3, hp: 20 }, { count: 1, hp: 30 }],
    dealt: [[blow(10), blow(10)], [blow(4), blow(4)]],
    taken: [[blow(9), blow(9)], [blow(16), blow(8)]]
  });
  assert.deepEqual(read.risk, { index: 1, many: 4 });
  const unhurt = readDifficulty({ party: [{ hp: 30 }], foes: [{ count: 1, hp: 20 }], dealt: [[blow(0)]], taken: [[blow(0)]] });
  assert.equal(unhurt.turns, 20 / FEO.encounter.difficulty.least, "a foe nobody can hurt does not make the count endless");
});

test("an Objective is checked for what it needs", () => {
  const encounter = cleanEncounter({ id: "e", objectives: { boss: true, protect: true, seize: true } });
  const groups = [
    { id: "a", name: "Brigand", side: "enemy", count: 3, turn: 0, placed: true },
    { id: "b", name: "Averil", side: "ally", count: 1, turn: 0, placed: false, unfit: [] }
  ];
  const codes = (checks) => checks.map((check) => `${check.ok ? "+" : "-"}${check.code}`);
  assert.deepEqual(codes(encounterChecks(encounter, groups)), ["-bossMissing", "+protect", "-unmarked", "-unplaced"]);

  groups.push({ id: "c", name: "Dorran", side: "enemy", count: 1, turn: 0, placed: true, boss: true, unfit: ["Killer Axe"], recruit: true });
  const twice = encounterChecks(encounter, [...groups, { id: "d", name: "Dorran", side: "enemy", count: 1, turn: 3, placed: true, boss: true }]);
  assert.equal(twice[0].data.name, "Dorran", "a Boss that two rows name is named once");
  const ready = encounterChecks({ ...encounter, goal: { i: 4, j: 11 } }, groups);
  assert.deepEqual(codes(ready), ["+boss", "+protect", "+marked", "-unfit", "+recruit", "-unplaced"]);
  assert.deepEqual(ready[2].data, { objective: "seize", column: 12, row: 5 });
  assert.deepEqual(codes(encounterChecks(cleanEncounter({ id: "e" }), [])), ["-none"]);
  assert.deepEqual(codes(encounterChecks(cleanEncounter({ id: "e", objectives: { rout: true, survive: true } }), groups.slice(0, 1))), ["+rout", "+survive"]);
});

test("Protect is about the group that was named, or the only allies there are", () => {
  const groups = [{ id: "a", side: "enemy" }, { id: "b", side: "ally" }, { id: "c", side: "other" }];
  assert.equal(protectedGroup({ protect: "" }, groups).id, "b");
  assert.equal(protectedGroup({ protect: "c" }, groups).id, "c");
  assert.equal(protectedGroup({ protect: "a" }, groups).id, "b", "an enemy is not protected");
  assert.equal(protectedGroup({ protect: "" }, [...groups, { id: "d", side: "ally" }]), null);
});

test("a group gathers round the tile it was put on", () => {
  const groups = [
    { id: "a", count: 3, tile: { i: 0, j: 0 } },
    { id: "b", count: 2, tile: { i: 0, j: 1 } },
    { id: "c", count: 2, tile: null }
  ];
  const stands = gatherTiles(groups, { columns: 4, rows: 3, blocked: (tile) => (tile.i === 1) && (tile.j === 0) });
  assert.deepEqual(stands.get("a"), [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 1 }]);
  assert.deepEqual(stands.get("b"), [{ i: 0, j: 2 }, { i: 1, j: 2 }]);
  assert.deepEqual(stands.get("c"), []);
  const all = [...stands.values()].flat().map((tile) => `${tile.i},${tile.j}`);
  assert.equal(new Set(all).size, all.length, "nobody shares a tile");
  assert.deepEqual(gatherTiles([groups[0]], { columns: 4, rows: 3, taken: ["0,0"] }).get("a")[0], { i: 0, j: 1 });
});

test("groups that stand nowhere are scattered clear of the players and of each other", () => {
  const groups = [{ id: "a", count: 2, tile: { i: 5, j: 18 } }, { id: "b", count: 3, tile: null }, { id: "c", count: 1, tile: null }];
  const keep = (tile) => tile.j < 4;
  const found = scatterTiles(groups, { columns: 20, rows: 12, keep, random: seededRandom("scatter") });
  assert.deepEqual([...found.keys()], ["b", "c"]);
  for ( const tile of found.values() ) {
    assert.ok(!keep(tile));
    assert.ok((tile.i >= 0) && (tile.i < 12) && (tile.j >= 0) && (tile.j < 20));
  }
  assert.equal(scatterTiles(groups, { columns: 20, rows: 12, blocked: () => true }).size, 0, "nowhere to stand");
});

test("what was kept of an encounter is put right as it is read", () => {
  const read = cleanEncounter({
    id: " e1 ", name: "Ford", objectives: { boss: 1, dance: true }, survive: 0, goal: { i: "3", j: 4.7 }, party: ["a", "a", "", "b"],
    groups: [{ id: "g", actor: "x", count: 99, turn: -2, tile: { i: 1 } }, { id: "g", actor: "y" }, { id: "h" }, null]
  });
  assert.equal(read.id, "e1");
  assert.equal(read.objectives.boss, true);
  assert.equal("dance" in read.objectives, false);
  assert.equal(read.survive, 1);
  assert.deepEqual(read.goal, { i: 3, j: 4 });
  assert.deepEqual(read.party, ["a", "b"]);
  assert.deepEqual(read.groups, [{ id: "g", actor: "x", count: FEO.encounter.count, turn: 0, tile: null }]);
  assert.deepEqual(cleanEncounter(read), read);
  assert.equal(newEncounter("n", "New").survive, FEO.encounter.survive);
});

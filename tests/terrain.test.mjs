/**
 * Tests for `module/rules/terrain.mjs` and what Step 5 gave skills to read and to change: the kind of tile a
 * unit and its foe stand on, as conditions, and what tiles cost a unit or allow it, as the map reads them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { planExchange } from "../module/rules/combat.mjs";
import { walkable } from "../module/rules/mapgen.mjs";
import { pathTo, reachFrom, tileKey } from "../module/rules/reach.mjs";
import { checkEffects, holds, needsPlace, skillCrossing, skillTotals, turnMoment } from "../module/rules/skills.mjs";
import {
  addCrossing, checkCrossing, crosses, emptyCrossing, flies, groundOf, moveCost, passCost, terrainMatters, withoutBonuses
} from "../module/rules/terrain.mjs";
import { dice, fighter, made, skill } from "./lib/fixtures.mjs";

/** A unit as the terrain rules know it, with what its skills change about how it crosses terrain. */
const mover = (skills = [], rest = {}) => ({ qualities: "", skills: [], crossing: skillCrossing(skills), ...rest });

/** What a unit has around it when it stands alone on a tile of some kind. */
const standing = (terrain, who = {}) => ({
  id: "unit", side: "player", tile: { i: 0, j: 0 }, others: [],
  ground: { terrain, effects: terrainMatters(terrain, who) }
});

/** A fighter that stands on a tile of some kind. */
const placed = (terrain, options = {}) => ({ ...fighter(options), near: standing(terrain, { qualities: options.qualities ?? "" }) });

/** The forecast of an attack between two fighters, each on a tile of some kind. */
function forecast(attacker, defender, { distance = 1 } = {}) {
  const tile = (unit) => groundOf(unit.near?.ground?.terrain ?? "plain", 0, { qualities: unit.qualities });
  return planExchange(attacker, defender, { distance, ground: { initiator: tile(attacker), defender: tile(defender) } });
}

/** A foe that stands still on a tile of some kind and has no skills. */
const foe = (terrain = "plain", options = {}) => placed(terrain, { name: "Foe", hp: 60, hpMax: 60, stats: { def: 0, spd: 0 }, ...options });

/**
 * A map of 9 by 9 tiles for a unit, drawn row by row: "." open ground, "w" water, "m" mountain, "f" forest,
 * "#" a wall. Tiles are entered at what the terrain rules have them take the unit.
 */
function field(rows, who) {
  const kinds = { ".": "plain", w: "water", m: "mountain", f: "forest", c: "cliff", "#": "wall" };
  const kind = (tile) => kinds[rows[tile.i]?.[tile.j]] ?? "plain";
  return {
    inside: (tile) => (tile.i >= 0) && (tile.i < rows.length) && (tile.j >= 0) && (tile.j < rows[0].length),
    cost: (tile) => passCost(kind(tile), who).cost,
    taken: (tile) => !passCost(kind(tile), who).stop
  };
}

/* -------------------------------------------- */
/*  Crossing                                    */
/* -------------------------------------------- */

test("terrain costs what the table says, and asks for a skill where it says so", () => {
  assert.equal(moveCost("plain"), 1);
  assert.equal(moveCost("forest", mover()), 2);
  assert.equal(moveCost("mountain", mover()), Infinity);
  assert.equal(moveCost("water", mover()), Infinity);

  // A skill the table names opens the terrain by its name alone, as a copy learnt before this was built does
  assert.equal(moveCost("mountain", { skills: ["Mountaineer"] }), 4);
  assert.equal(moveCost("water", { skills: ["sailor"] }), 2);

  // A Flying unit crosses everything at 1, but for what nobody crosses
  assert.equal(moveCost("cliff", { qualities: "Flying" }), 1);
  assert.equal(moveCost("wall", { qualities: "Flying" }), Infinity);
  assert.equal(moveCost("wall", { skills: ["Mountaineer", "Privateer"] }), Infinity);
  assert.equal(walkable("wall"), false);
  assert.equal(FEO.terrain.tints.wall !== undefined, true);
});

test("what skills change about crossing terrain is added up", () => {
  const total = emptyCrossing();
  assert.equal(crosses(total), false);
  addCrossing(total, { kinds: ["mountain"], cost: { mountain: 3 } });
  addCrossing(total, { kinds: ["mountain", "water"], cost: { mountain: 2, cliff: 4 }, free: ["river"] });
  addCrossing(total, { phase: 3 });
  addCrossing(total, { phase: 2 });
  assert.deepEqual(total, { kinds: ["mountain", "water"], cost: { mountain: 2, cliff: 4 }, free: ["river"], all: false, flier: false, steady: false, phase: 2 });
  assert.equal(crosses(total), true);
  assert.equal(addCrossing(emptyCrossing(), { free: "all" }).all, true);
  assert.equal(flies({ crossing: addCrossing(emptyCrossing(), { flier: true }) }), true);
});

test("Climber, Mountaineer, Sailor and Privateer open the terrain that asks for them", () => {
  for ( const name of ["Climber", "Mountaineer"] ) {
    const who = mover([skill(name)]);
    assert.equal(moveCost("mountain", who), 4, name);
    assert.equal(moveCost("cliff", who), 5, name);
    assert.equal(moveCost("water", who), Infinity, name);
  }
  for ( const name of ["Sailor", "Privateer"] ) {
    const who = mover([skill(name)]);
    assert.equal(moveCost("water", who), 2, name);
    assert.equal(moveCost("mountain", who), Infinity, name);
  }
});

test("Swiftfoot leaves no movement penalty and crosses Mountains, not Cliffs or Water", () => {
  const who = mover([skill("Swiftfoot")]);
  for ( const kind of ["forest", "thicket", "hill", "mountain", "river", "desert", "wardwood", "cover"] ) assert.equal(moveCost(kind, who), 1, kind);
  assert.equal(moveCost("cliff", who), Infinity);
  assert.equal(moveCost("water", who), Infinity);
  assert.equal(moveCost("desert", mover([skill("Swiftfoot")], { qualities: "Armored" })), 1);

  // With Climber as well, Cliffs take 1 too
  assert.equal(moveCost("cliff", mover([skill("Swiftfoot"), skill("Climber")])), 1);
});

test("Spectral Form crosses terrain as a Flying unit does, and gains nothing from its tile", () => {
  const who = mover([skill("Spectral Form")]);
  for ( const kind of ["forest", "mountain", "cliff", "water", "desert"] ) assert.equal(moveCost(kind, who), 1, kind);
  assert.equal(moveCost("wall", who), Infinity);
  assert.deepEqual(groundOf("forest", 0, who), { terrain: "forest", elevation: 0, def: 0, res: 0, dodge: 0 });
  assert.equal(terrainMatters("forest", who), false);
  assert.equal(terrainMatters("fort", who), true);
});

test("Phasing passes through what the unit cannot cross at 2 MOV a tile, without stopping there", () => {
  const who = mover([skill("Phasing")]);
  assert.deepEqual(passCost("wall", who), { cost: 2, stop: false });
  assert.deepEqual(passCost("water", who), { cost: 2, stop: false });
  assert.deepEqual(passCost("forest", who), { cost: 2, stop: true });
  assert.deepEqual(passCost("wall", mover()), { cost: Infinity, stop: false });

  // A wall two tiles thick, with 5 MOV: through it and one step beyond, never onto it
  const rows = [".....", "..##.", "....."].map((row) => `${row}....`);
  const walled = reachFrom({ i: 1, j: 1 }, 5, field(rows, who));
  assert.equal(walled.cost.get("1,4"), 5);
  assert.equal(walled.stops.has("1,4"), true);
  assert.equal(walled.stops.has("1,2"), false);
  assert.equal(walled.stops.has("1,3"), false);
  assert.deepEqual(pathTo(walled, { i: 1, j: 4 }).map(tileKey), ["1,2", "1,3", "1,4"]);

  // Without the skill the wall is walked around, which takes longer
  const around = reachFrom({ i: 1, j: 1 }, 5, field(rows, mover()));
  assert.equal(around.cost.has("1,2"), false);
  assert.equal(around.cost.get("1,4"), 5);
  assert.equal(pathTo(around, { i: 1, j: 4 }).length, 5);
});

test("a Pirate's reach spills across the water, a Mountaineer's over the peaks", () => {
  const rows = [
    "....w....",
    "....w....",
    "....w....",
    "mmmmw....",
    "....w...."
  ];
  const from = { i: 1, j: 2 };
  const plain = reachFrom(from, 5, field(rows, mover()));
  assert.equal([...plain.stops].some((key) => Number(key.split(",")[1]) >= 4), false);
  assert.equal([...plain.stops].some((key) => Number(key.split(",")[0]) >= 3), false);

  const pirate = reachFrom(from, 5, field(rows, mover([skill("Privateer")])));
  assert.equal(pirate.stops.has("1,4"), true);
  assert.equal(pirate.cost.get("1,4"), 3);
  assert.equal(pirate.stops.has("1,6"), true);
  assert.equal(pirate.stops.has("3,2"), false);

  const brigand = reachFrom(from, 6, field(rows, mover([skill("Mountaineer")])));
  assert.equal(brigand.stops.has("3,2"), true);
  assert.equal(brigand.cost.get("3,2"), 5);
  assert.equal(brigand.stops.has("4,2"), true);
  assert.equal(brigand.stops.has("1,4"), false);
});

/* -------------------------------------------- */
/*  Standing on Terrain                         */
/* -------------------------------------------- */

test("a condition asks what the unit stands on, and what its foe does", () => {
  const self = { hp: 20, hpMax: 20, near: standing("forest") };
  assert.equal(holds({ standsOn: ["forest", "thicket"] }, self), true);
  assert.equal(holds({ standsOn: ["hill"] }, self), false);
  assert.equal(holds({ terrain: true }, self), true);
  assert.equal(holds({ terrain: false }, self), false);
  assert.equal(holds({ terrain: false }, { ...self, near: standing("plain") }), true);

  // The foe's tile needs a fight
  const fight = { role: "initiating", distance: 1, foe: { hp: 20, hpMax: 20, near: standing("thicket") } };
  assert.equal(holds({ foeOn: ["forest", "thicket"] }, self), false);
  assert.equal(holds({ foeOn: ["forest", "thicket"] }, self, fight), true);
  assert.equal(holds({ foeOn: ["hill"] }, self, fight), false);
  assert.equal(holds({ foeTerrain: true }, self, fight), true);
  assert.equal(holds({ foeTerrain: false }, self, fight), false);
});

test("what hangs on the ground is not applied for a unit that is not on a map, only named to check", () => {
  // Terrain without effects is asked as much as terrain with them
  assert.equal(needsPlace({ when: { terrain: false }, combat: { hit: 20 } }), true);
  const off = skillTotals([skill("Open Assault"), skill("Natural Cover"), skill("Mountaineer")], { hp: 20, hpMax: 20, stats: {}, near: null });
  assert.equal(off.combat.hit ?? 0, 0);
  assert.equal(off.taken, 0);
  assert.equal(off.stats.def ?? 0, 0);
  assert.deepEqual(off.checks.map((entry) => entry.skill).sort(), ["Mountaineer", "Natural Cover", "Open Assault"]);

  // On a map each is judged
  const on = skillTotals([skill("Open Assault"), skill("Natural Cover")], { hp: 20, hpMax: 20, stats: {}, near: standing("plain") });
  assert.equal(on.combat.hit, 20);
  assert.equal(on.combat.damage, 3);
  assert.equal(on.taken, 0);
  assert.deepEqual(on.checks, []);
});

test("Natural Cover takes 2 off the damage taken on terrain with an effect", () => {
  const hit = (terrain) => forecast(foe("plain", { name: "Attacker" }), placed(terrain, { skills: [skill("Natural Cover")] })).initiator.damage;
  const bare = (terrain) => forecast(foe("plain", { name: "Attacker" }), placed(terrain)).initiator.damage;
  assert.equal(hit("plain"), bare("plain"));
  assert.equal(hit("river"), bare("river") - 2);
  assert.equal(hit("forest"), bare("forest") - 2);
});

test("Terrain Fighter gains on the kind of terrain picked as it was learnt, and only there", () => {
  const plain = forecast(placed("forest"), foe());
  const on = forecast(placed("forest", { skills: [skill("Terrain Fighter", { choice: "Forest" })] }), foe());
  assert.equal(on.initiator.base.accuracy, plain.initiator.base.accuracy + 15);
  assert.equal(on.initiator.damage, plain.initiator.damage + 1);
  assert.deepEqual(on.initiator.skills, ["Terrain Fighter"]);

  const elsewhere = forecast(placed("hill", { skills: [skill("Terrain Fighter", { choice: "Forest" })] }), foe());
  assert.equal(elsewhere.initiator.base.accuracy, forecast(placed("hill"), foe()).initiator.base.accuracy);
  assert.deepEqual(elsewhere.initiator.skills, []);

  // Nothing is picked, nothing is gained
  assert.equal(forecast(placed("forest", { skills: [skill("Terrain Fighter")] }), foe()).initiator.damage, plain.initiator.damage);

  // Every row of the table a unit can stand on is on offer
  const offered = skill("Terrain Fighter", { choice: "Cover" }).effects.flatMap((effect) => effect.when.standsOn);
  assert.deepEqual(offered, ["cover"]);
});

test("Open Assault gains on terrain without any effects", () => {
  const gain = (terrain) => {
    const usual = forecast(placed(terrain), foe());
    const open = forecast(placed(terrain, { skills: [skill("Open Assault")] }), foe());
    return [open.initiator.base.accuracy - usual.initiator.base.accuracy, open.initiator.damage - usual.initiator.damage];
  };
  assert.deepEqual(gain("plain"), [20, 3]);
  assert.deepEqual(gain("forest"), [0, 0]);
  assert.deepEqual(gain("house"), [0, 0]);
});

test("Mountaineer gains 1 DEF on a Hill and Privateer on a River", () => {
  const taken = (terrain, skills) => forecast(foe("plain", { name: "Attacker" }), placed(terrain, { skills })).initiator.damage;
  assert.equal(taken("hill", [skill("Mountaineer")]), taken("hill", []) - 1);
  assert.equal(taken("forest", [skill("Mountaineer")]), taken("forest", []));
  assert.equal(taken("river", [skill("Privateer")]), taken("river", []) - 1);
  assert.equal(taken("hill", [skill("Privateer")]), taken("hill", []));
});

test("Forester gains in the woods and negates what the woods give its foe", () => {
  const usual = forecast(placed("forest"), foe("thicket"));
  const woods = forecast(placed("forest", { skills: [skill("Forester")] }), foe("thicket"));
  assert.equal(woods.initiator.base.accuracy, usual.initiator.base.accuracy + 10);
  assert.equal(woods.initiator.base.critical, usual.initiator.base.critical + 10);

  // The Thicket adds 30 to the foe's Dodge, the Forest 15 and 1 DEF: gone against a Forester
  assert.equal(usual.initiator.ground.dodge, 30);
  assert.equal(woods.initiator.ground.dodge, 0);
  assert.equal(woods.initiator.base.dodge, usual.initiator.base.dodge - 30);
  const guarded = forecast(placed("plain"), foe("forest"));
  const cleared = forecast(placed("plain", { skills: [skill("Forester")] }), foe("forest"));
  assert.equal(cleared.initiator.damage, guarded.initiator.damage + 1);
  assert.equal(cleared.initiator.ground.cover, 0);
  assert.deepEqual(cleared.initiator.skills, ["Forester"]);

  // The Forester keeps what its own tile gives it, and a foe on a Hill keeps its Hill
  assert.equal(woods.defender.ground.dodge, 15);
  const hill = forecast(placed("plain", { skills: [skill("Forester")] }), foe("hill"));
  assert.equal(hill.initiator.ground.dodge, 20);
  assert.deepEqual(hill.initiator.skills, []);

  // Defending, it negates the tile of the unit that attacks it as well
  const attacked = forecast(foe("forest", { name: "Attacker" }), placed("plain", { skills: [skill("Forester")] }));
  assert.equal(attacked.defender.ground.dodge, 0);
});

test("negating the bonuses of a tile leaves what it takes away", () => {
  assert.deepEqual(withoutBonuses(groundOf("cliff", 2)), { terrain: "cliff", elevation: 2, def: 0, res: 0, dodge: -15 });
  assert.deepEqual(withoutBonuses(groundOf("mountain", 0)), { terrain: "mountain", elevation: 0, def: 0, res: 0, dodge: 0 });
  assert.equal(withoutBonuses(null), null);
});

test("Sojourner gains on its Minor and its Major terrain, and crosses them more easily", () => {
  const brigand = [skill("Mountaineer"), skill("Sojourner", { choice: "Hill; Mountain & Cliff" })];
  assert.equal(moveCost("mountain", mover(brigand)), 3);
  assert.equal(moveCost("cliff", mover(brigand)), 3);
  assert.equal(moveCost("river", mover(brigand)), 2);

  // The Major terrain eases the way of a unit that can cross it, and opens nothing by itself
  assert.equal(moveCost("mountain", mover([skill("Sojourner", { choice: "Hill; Mountain & Cliff" })])), Infinity);
  const pirate = [skill("Privateer"), skill("Sojourner", { choice: "Plain; Water & River" })];
  assert.equal(moveCost("river", mover(pirate)), 1);
  assert.equal(moveCost("water", mover(pirate)), 2);
  assert.equal(moveCost("mountain", mover(pirate)), Infinity);

  // Hill: +1 DEF and RES. Mountain and Cliff: +2 END
  const taken = (terrain, skills) => forecast(foe("plain", { name: "Attacker" }), placed(terrain, { skills })).initiator.damage;
  assert.equal(taken("hill", brigand), taken("hill", [skill("Mountaineer")]) - 1);
  assert.equal(taken("mountain", brigand), taken("mountain", [skill("Mountaineer")]) - 2);
  assert.equal(taken("forest", brigand), taken("forest", [skill("Mountaineer")]));

  // House: +1 ATK, +1 END, +3 Hit. Fort: +1 ATK and END, +5 Hit and Critical
  const house = forecast(placed("house", { skills: [skill("Sojourner", { choice: "House; Fort" })] }), foe());
  const usual = forecast(placed("house"), foe());
  assert.equal(house.initiator.damage, usual.initiator.damage + 1);
  assert.equal(house.initiator.base.accuracy, usual.initiator.base.accuracy + 3);
  assert.equal(house.defender.damage, usual.defender.damage - 1);
  const fort = forecast(placed("fort", { skills: [skill("Sojourner", { choice: "House; Fort" })] }), foe());
  assert.equal(fort.initiator.base.critical, forecast(placed("fort"), foe()).initiator.base.critical + 5);

  // Forest and Thicket: Critical Avoid. Desert: Hit and Critical Avoid
  const totals = (terrain, choice) => skillTotals([skill("Sojourner", { choice })], { hp: 20, hpMax: 20, stats: {}, near: standing(terrain) });
  assert.deepEqual(totals("forest", "Forest; Thicket").combat, { critAvoid: 5 });
  assert.deepEqual(totals("thicket", "Forest; Thicket").stats, { res: 2 });
  assert.deepEqual(totals("desert", "Plain; Desert").combat, { hit: 5, critAvoid: 5 });
  assert.equal(totals("plain", "Plain; Desert").haste, 1);
  assert.equal(totals("river", "Plain; Water & River").haste, 2);
  assert.equal(totals("hill", "Plain; Water & River").haste, 0);
});

test("the tile a turn starts on gives Pathfinder its MOV, Forager and a Sojourner of the Healhedge their HP", () => {
  const self = (terrain, hp = 20) => ({ name: "Unit", hp, hpMax: 40, level: 5, stats: { mov: 6 }, near: standing(terrain) });
  const path = turnMoment([skill("Pathfinder")], self("plain"), "turnStart", dice());
  assert.equal(path.entries.length, 1);
  const [granted] = path.entries[0].granted;
  assert.equal(granted.unit, null);
  assert.deepEqual(granted.change.effects, [{ stats: { mov: 2 } }]);
  assert.equal(granted.change.ends, "turnEnd");
  assert.deepEqual(turnMoment([skill("Pathfinder")], self("forest"), "turnStart", dice()).entries, []);
  assert.deepEqual(turnMoment([skill("Pathfinder")], self("fort"), "turnStart", dice()).entries, []);

  const forager = (terrain) => turnMoment([skill("Forager")], self(terrain), "turnStart", dice()).healed;
  assert.equal(forager("forest"), 6);
  assert.equal(forager("thicket"), 6);
  assert.equal(forager("wardwood"), 6);
  assert.equal(forager("plain"), 0);

  const hedge = skill("Sojourner", { choice: "Plain; Healhedge" });
  assert.equal(turnMoment([hedge], self("healhedge"), "turnStart", dice()).healed, 4);
  assert.equal(turnMoment([hedge], self("forest"), "turnStart", dice()).healed, 0);

  // Off the map the healing is shown for the table to check, not applied
  const off = turnMoment([skill("Forager")], { ...self("forest"), near: null }, "turnStart", dice());
  assert.equal(off.healed, 0);
  assert.equal(off.entries[0].remind, "check");
});

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

test("the terrain parts of an effect are checked like any other", () => {
  assert.deepEqual(checkEffects([
    { when: { standsOn: ["forest"], terrain: false }, combat: { hit: 5 } },
    { when: { foeOn: ["hill"], foeTerrain: true }, rules: ["foeNoTerrain"] },
    { crossing: { kinds: ["water"], cost: { mountain: 3 }, free: ["river"], phase: 2 } },
    { when: { tier: { min: 2 } }, crossing: { free: "all", flier: true } }
  ]), []);
  assert.equal(checkEffects([{ when: { standsOn: ["woods"] }, might: 1 }]).length, 1);
  assert.equal(checkEffects([{ when: { standsOn: "forest" }, might: 1 }]).length, 1);
  assert.equal(checkEffects([{ when: { foeTerrain: "yes" }, might: 1 }]).length, 1);
  assert.equal(checkEffects([{ aura: { who: "ally", within: 2, when: { standsOn: ["forest"] } }, might: 1 }]).length, 1);
  assert.equal(checkEffects([{ crossing: { kinds: ["forest"] } }]).length, 1);
  assert.equal(checkEffects([{ crossing: { kinds: ["lava"] } }]).length, 1);
  assert.equal(checkEffects([{ crossing: { cost: { cliff: 0 } } }]).length, 1);
  assert.equal(checkEffects([{ crossing: { swims: true } }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "turnStart", sure: true }, crossing: { phase: 2 } }]).length, 1);
  assert.equal(checkEffects([{ when: { standsOn: ["hill"] }, crossing: { phase: 2 } }]).length, 1);
  assert.equal(checkCrossing({}).length, 1);
});

test("how a unit crosses terrain is read from its skills as they stand", () => {
  // A variant not picked changes nothing, nor does a skill that waits to be switched on
  assert.equal(crosses(skillCrossing([skill("Sojourner", { choice: "Forest; Thicket" })])), false);
  assert.equal(crosses(skillCrossing([made("Wading", [{ when: { declared: true }, crossing: { kinds: ["water"] } }])])), false);
  assert.deepEqual(skillCrossing([{ ...made("Wading", [{ when: { declared: true }, crossing: { kinds: ["water"] } }]), active: true }]).kinds, ["water"]);

  // A condition on the unit is judged
  const ranked = made("Old Hand", [{ when: { tier: { min: 2 } }, crossing: { free: "all" } }]);
  assert.equal(skillCrossing([ranked], { tier: 1 }).all, false);
  assert.equal(skillCrossing([ranked], { tier: 2 }).all, true);

  // A change that lasts on the unit counts like a skill; what a skill only says in a fight does not show there
  assert.deepEqual(skillTotals([skill("Climber")], { hp: 20, hpMax: 20, stats: {} }).applied, []);
});

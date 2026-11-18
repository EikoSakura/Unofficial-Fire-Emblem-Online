/**
 * Tests for `module/rules/rescue.mjs` and what Step 10 gave the skills: who may be picked up, what carrying
 * costs, where a unit that was carried is set down, and an ally that comes for a unit as the blow falls.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { canCapture, carryEntry as captiveEntry, readyCapture } from "../module/rules/capturing.mjs";
import { planExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { leavesMap, outOfFight } from "../module/rules/defeat.mjs";
import { sufferDamage } from "../module/rules/events.mjs";
import { tileKey } from "../module/rules/reach.mjs";
import {
  addCarry, burdened, canRescue, carriedHeal, carryEntry, checkCarry, comesFor, dropTiles, emptyCarry, felledBy, landing, landsOn,
  liftWeight, nearestFree
} from "../module/rules/rescue.mjs";
import { checkEffects, coverageOf, skillCarry, skillTotals } from "../module/rules/skills.mjs";
import { fighter, made, skill, unit } from "./lib/fixtures.mjs";

const at = (i, j) => ({ i, j });

/**
 * A map of so many rows and columns, with what stands on it.
 * @param {object} [map]
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

/** What a unit with these skills makes of carrying. */
const carryOf = (names, options = {}) => skillCarry(names.map((name) => skill(name, options)));

/** A unit that would carry, and an ally next to it. */
const lifter = (more = {}) => ({ tile: at(3, 3), weight: 10, carry: null, holds: false, ...more });
const ally = (more = {}) => ({ tile: at(3, 4), weight: 10, relation: "friend", qualities: "", rules: [], carries: false, out: false, ...more });

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

const STEP = ["Rescue", "Aid", "Courteous", "Savior", "Wings of Hope", "Miraculous Save", "Guardian"];

test("the skills of the step are written in parts the rules know, and leave nothing to the table", () => {
  for ( const name of STEP ) {
    const listed = skill(name);
    assert.deepEqual(checkEffects(listed.effects), [], name);
  }
  assert.equal(coverageOf({ effect: "x", listed: true, left: "" }), "done");
});

test("a carry part that says something the rules do not know is told", () => {
  assert.deepEqual(checkCarry({ weight: 6 }), []);
  assert.deepEqual(checkCarry({ drops: { effects: [{ stats: { def: 2 } }], ends: "turnStart" } }), []);
  assert.equal(checkCarry({ wieght: 6 }).length, 1);
  assert.equal(checkCarry({}).length, 1);
  assert.equal(checkCarry({ free: "yes" }).length, 1);
  assert.equal(checkCarry({ heals: 150 }).length, 1);
  assert.equal(checkCarry({ drops: { effects: [] } }).length, 1);
  assert.equal(checkCarry({ drops: { effects: [{ stats: { def: 2 } }], ends: "never" } }).length, 1);
  assert.ok(checkEffects([{ proc: { on: "kill", sure: true }, carry: { weight: 6 } }]).length > 0, "never at a moment");
  assert.ok(checkEffects([{ when: { role: "initiating" }, carry: { weight: 6 } }]).length > 0, "never on a fight");
  assert.ok(checkEffects([{ carry: { drops: { effects: [{ nonsense: 1 }], ends: "turnStart" } } }]).length > 0, "what is left on the unit is checked");
});

test("each skill of the step gives its unit what its Effect says", () => {
  assert.deepEqual(carryOf([]), emptyCarry());
  assert.equal(carryOf(["Aid"]).weight, 6);
  assert.equal(carryOf(["Savior"]).free, true);
  assert.equal(carryOf(["Courteous"]).light, true);
  assert.equal(carryOf(["Wings of Hope"]).heals, 15);
  assert.equal(carryOf(["Guardian"]).saves, true);
  const drops = carryOf(["Miraculous Save"]).drops;
  assert.equal(drops.length, 1);
  assert.equal(drops[0].skill, "Miraculous Save");
  assert.equal(drops[0].ends, "turnStart");
  assert.deepEqual(drops[0].effects, [{ rules: ["halveFatal"] }]);
  assert.deepEqual(carryOf(["Aid", "Savior"]).skills.weight, ["Aid"]);
  assert.equal(carryOf(["Aid", "Savior"]).skills.free, "Savior");
});

test("Guardian is used once a map, and gives nothing once it is spent", () => {
  assert.deepEqual(skill("Guardian").usage, { kind: "auto", cooldown: 0, lasts: 0, uses: 1, per: "map" });
  assert.equal(carryOf(["Guardian"], { used: 1 }).saves, false);
});

test("none of them changes a number of its own unit by itself", () => {
  for ( const name of STEP ) {
    const totals = skillTotals([skill(name)], { hp: 20, hpMax: 20, level: 5, stats: { dex: 8, spd: 8 }, weapon: null });
    assert.deepEqual(totals.sources, [], name);
  }
});

test("a part of several skills adds up: Weight is summed, the highest share of healing counts", () => {
  const total = emptyCarry();
  addCarry(total, { weight: 6 }, { skill: "Aid" });
  addCarry(total, { weight: 2 }, { skill: "Sturdy" });
  addCarry(total, { heals: 10 }, { skill: "Lesser" });
  addCarry(total, { heals: 15 }, { skill: "Wings of Hope" });
  addCarry(total, { heals: 5 }, { skill: "Least" });
  assert.equal(total.weight, 8);
  assert.equal(total.heals, 15);
  assert.equal(total.skills.heals, "Wings of Hope");
});

/* -------------------------------------------- */
/*  Who Is Picked Up                            */
/* -------------------------------------------- */

test("a unit picks up an ally of equal or less Weight, and no heavier one", () => {
  assert.deepEqual(canRescue(lifter(), ally()), { ok: true, why: null });
  assert.equal(canRescue(lifter(), ally({ weight: 4 })).ok, true);
  assert.deepEqual(canRescue(lifter(), ally({ weight: 11 })), { ok: false, why: "weight" });
});

test("Aid counts as 6 more Weight for picking a unit up", () => {
  const aid = carryOf(["Aid"]);
  assert.equal(liftWeight(10, aid), 16);
  assert.equal(canRescue(lifter({ carry: aid }), ally({ weight: 16 })).ok, true);
  assert.equal(canRescue(lifter({ carry: aid }), ally({ weight: 17 })).why, "weight");
});

test("only an ally next to the unit is picked up, by a unit with free hands", () => {
  assert.equal(canRescue(lifter(), ally({ tile: at(3, 5) })).why, "apart");
  assert.equal(canRescue(lifter(), ally({ tile: at(4, 4) })).why, "apart", "not corner to corner");
  assert.equal(canRescue(lifter(), ally({ relation: "foe" })).why, "side");
  assert.equal(canRescue(lifter(), ally({ relation: "apart" })).why, "side");
  assert.equal(canRescue(lifter(), ally({ relation: "self" })).why, "self");
  assert.equal(canRescue(lifter({ holds: true }), ally()).why, "holding");
  assert.equal(canRescue(lifter(), ally({ out: true })).why, "out");
});

test("a unit that carries one, a Ballistician and a unit that nothing moves are not picked up", () => {
  assert.equal(canRescue(lifter(), ally({ carries: true })).why, "carrying");
  assert.deepEqual(canRescue(lifter(), ally({ qualities: "Mounted, Ballistician" })), { ok: false, why: "quality", qualities: ["Ballistician"] });
  assert.equal(canRescue(lifter(), ally({ qualities: "Mounted, Flying" })).ok, true, "a rider is, if it is light enough");
  assert.equal(canRescue(lifter(), ally({ rules: ["rooted"] })).why, "rooted");
  assert.equal(canRescue(lifter(), ally({ rules: ["unforced"] })).ok, true, "its allies may move a unit no enemy moves");
});

test("a unit that is handed over need not stand next to its new carrier, and one a skill carries off is not weighed", () => {
  assert.equal(canRescue(lifter(), ally({ tile: at(0, 0) }), { near: false }).ok, true);
  assert.equal(canRescue(lifter(), ally({ tile: at(0, 0), weight: 30 }), { near: false }).why, "weight");
  assert.equal(canRescue(lifter(), ally({ weight: 30 }), { weigh: false }).ok, true);
  assert.equal(canRescue(lifter(), ally({ weight: 30, qualities: "Ballistician" }), { weigh: false }).why, "quality");
});

/* -------------------------------------------- */
/*  What Carrying Costs                         */
/* -------------------------------------------- */

test("carrying a unit halves DEX and SPD, for an ally and for a captive alike", () => {
  const self = { hp: 20, hpMax: 20, level: 5, stats: { str: 10, dex: 9, spd: 12, def: 6 }, weapon: null };
  for ( const entry of [carryEntry("Carrying: Lyn"), captiveEntry("Captive: Brigand")] ) {
    const totals = skillTotals([entry], self);
    assert.equal(totals.stats.dex, -5, entry.name);
    assert.equal(totals.stats.spd, -6, entry.name);
    assert.equal(totals.stats.str ?? 0, 0, entry.name);
    assert.equal(totals.sources[0].name, entry.name);
  }
  assert.deepEqual(carryEntry("x").effects, [{ statPercent: FEO.rescue.carry }]);
});

test("Savior on the carrier and Courteous on the unit carried each take the penalty away", () => {
  assert.equal(burdened(emptyCarry(), false), true);
  assert.equal(burdened(null, false), true);
  assert.equal(burdened(carryOf(["Savior"]), false), false);
  assert.equal(burdened(emptyCarry(), carryOf(["Courteous"]).light), false);
  assert.equal(burdened(carryOf(["Aid"]), false), true, "Aid lifts the Weight test, not the penalty");
});

test("Aid counts for the Weight an attempt to capture asks for, and Savior fights it unhindered", () => {
  const was = FEO.optional.capturing.enabled;
  FEO.optional.capturing.enabled = true;
  try {
    const target = { weight: 12, qualities: "", conditions: {}, weapons: [{ name: "Iron Axe", category: "axe", broken: false }] };
    assert.equal(canCapture({ weight: 10 }, target).why, "weight");
    assert.equal(canCapture({ weight: 10, carry: carryOf(["Aid"]) }, target).ok, true);
    assert.equal(canCapture({ weight: 10, carry: carryOf(["Aid"]), holds: true }, target).why, "holding");

    const check = { ok: true, why: null, outright: null };
    const attacker = fighter({ skills: [] });
    assert.equal(readyCapture(attacker, check, "Capture").skills.length, 1, "every stat but LUK halved");
    assert.equal(readyCapture(attacker, check, "Capture", { free: true }).skills.length, 0);
    assert.deepEqual(readyCapture(attacker, check, "Capture", { free: true }).capture, check);
  } finally {
    FEO.optional.capturing.enabled = was;
  }
});

test("a unit that is carried is out of the fight and off the map, whatever its HP", () => {
  assert.equal(outOfFight({ state: "", hp: 20, hpMax: 20 }), false);
  assert.equal(outOfFight({ state: "", hp: 20, hpMax: 20, carried: true }), true);
  assert.equal(outOfFight({ state: "incapacitated", hp: 0, hpMax: 20, carried: true }), true);
  assert.equal(leavesMap(""), false);
  assert.equal(leavesMap("", { carried: true }), true);
  assert.equal(leavesMap("dead"), true);
});

test("Wings of Hope restores a share of maximum HP, rounded down, 1 at least", () => {
  assert.equal(carriedHeal(33, 15), 4);
  assert.equal(carriedHeal(20, 15), 3);
  assert.equal(carriedHeal(5, 15), 1);
  assert.equal(carriedHeal(20, 0), 0);
  assert.equal(carriedHeal(0, 15), 0);
});

/* -------------------------------------------- */
/*  Where It Is Set Down                        */
/* -------------------------------------------- */

test("a unit is dropped on a free tile next to its carrier that it can stand on", () => {
  const keys = (tiles) => tiles.map(tileKey).sort();
  assert.deepEqual(keys(dropTiles(at(3, 3), field())), ["2,3", "3,2", "3,4", "4,3"]);
  assert.deepEqual(keys(dropTiles(at(3, 3), field({ rock: [at(2, 3)], units: [at(3, 4)], walls: [[at(3, 3), at(4, 3)]] }))), ["3,2"]);
  assert.deepEqual(keys(dropTiles(at(0, 0), field())), ["0,1", "1,0"]);
  assert.deepEqual(dropTiles(at(3, 3), field({ units: [at(2, 3), at(4, 3), at(3, 2), at(3, 4)] })), []);
});

test("a carrier that dies, retreats or is captured leaves its passenger on its own tile", () => {
  assert.deepEqual(landing(at(3, 3), field()), at(3, 3));
  assert.equal(landsOn(at(3, 3), field({ rock: [at(3, 3)] })), false);
});

test("where the passenger cannot stand there, it lands on the nearest tile it can stand on", () => {
  const water = [at(3, 3), at(2, 3), at(4, 3), at(3, 2), at(3, 4)];
  const tile = landing(at(3, 3), field({ rock: water }));
  assert.equal(Math.abs(tile.i - 3) + Math.abs(tile.j - 3), 2);
  assert.deepEqual(nearestFree(at(0, 0), field({ rock: [at(0, 0)], units: [at(0, 1)] })), at(1, 0));
  assert.equal(nearestFree(at(0, 0), field({ rows: 1, columns: 1, units: [at(0, 0)] })), null);
});

test("an Incapacitated carrier sets its passenger down next to it, on a tile picked by a die", () => {
  const open = field({ units: [at(3, 3)] });
  const tiles = dropTiles(at(3, 3), open);
  assert.equal(tiles.length, 4);
  for ( const index of [0, 1, 2, 3] ) assert.deepEqual(landing(at(3, 3), open, { beside: true, pick: () => index }), tiles[index]);
  assert.deepEqual(landing(at(3, 3), open, { beside: true, pick: () => 99 }), tiles[3], "a die that rolls high picks the last");

  // Hemmed in on every side, it lands as near as there is room, never on the tile its carrier lies on
  const ring = [at(3, 3), at(2, 3), at(4, 3), at(3, 2), at(3, 4)];
  const far = landing(at(3, 3), field({ units: ring }), { beside: true });
  assert.equal(Math.abs(far.i - 3) + Math.abs(far.j - 3), 2);
});

/* -------------------------------------------- */
/*  Miraculous Save                             */
/* -------------------------------------------- */

const saved = () => made("Miraculous Save", carryOf(["Miraculous Save"]).drops[0].effects);

test("what Miraculous Save leaves on a unit halves a blow that would be fatal, and no other", () => {
  const who = () => unit({ hp: 10, hpMax: 20, skills: [saved()] });
  for ( const kind of ["attack", "skill", "condition", "terrain"] ) {
    const blow = sufferDamage(who(), 12, { kind });
    assert.equal(blow.dealt, 6, kind);
    assert.equal(blow.hp, 4, kind);
    assert.deepEqual(blow.steps.map((step) => step.what), ["halve"], kind);
    assert.equal(blow.steps[0].skill, "Miraculous Save", kind);
  }
  const light = sufferDamage(who(), 9, { kind: "attack" });
  assert.equal(light.dealt, 9, "a blow that is not fatal is taken whole");
  assert.deepEqual(light.steps, []);
});

test("a blow that is fatal even when halved still is", () => {
  const blow = sufferDamage(unit({ hp: 10, hpMax: 20, skills: [saved()] }), 30, { kind: "attack" });
  assert.equal(blow.dealt, 15);
  assert.equal(blow.hp, 0);
  assert.equal(blow.defeated, true);
  const last = sufferDamage(unit({ hp: 1, hpMax: 20, skills: [saved()] }), 1, { kind: "attack" });
  assert.equal(last.hp, 1, "half of 1 is nothing");
});

test("it halves a fatal hit in a fight the system rolls as well", () => {
  const attacker = fighter({ name: "Brigand", stats: { str: 20, dex: 30 } });
  const plain = resolveExchange(planExchange(attacker, fighter({ name: "Lyn", hp: 12, hpMax: 20 }), { distance: 1 }), () => 1);
  const hit = plain.attacks[0].damage;
  assert.ok(hit >= 12, "the hit would be fatal");
  const guarded = fighter({ name: "Lyn", hp: 12, hpMax: 20, skills: [saved()] });
  const result = resolveExchange(planExchange(attacker, guarded, { distance: 1 }), () => 1);
  assert.equal(result.attacks[0].damage, Math.floor(hit / 2));
});

/* -------------------------------------------- */
/*  Guardian                                    */
/* -------------------------------------------- */

test("an ally comes to a tile next to the unit that it can reach, the nearest first", () => {
  const reach = { stops: new Set(["2,5", "3,4", "4,5"]), cost: new Map([["2,5", 4], ["3,4", 2], ["4,5", 3]]) };
  assert.deepEqual(comesFor(at(3, 1), at(3, 5), reach), [at(3, 4), at(4, 5), at(2, 5)]);
  assert.deepEqual(comesFor(at(3, 4), at(3, 5), reach), [at(3, 4)], "next to it already, it stays where it is");
  assert.deepEqual(comesFor(at(0, 0), at(6, 6), reach), []);
});

test("only the hit of an attack that defeats a unit is answered", () => {
  assert.equal(felledBy({ attacks: [{ side: "initiator", kill: true }], defender: { defeated: true }, initiator: { defeated: false } }), "defender");
  assert.equal(felledBy({ attacks: [{ side: "defender", kill: true }], defender: { defeated: false }, initiator: { defeated: true } }), "initiator");
  assert.equal(felledBy({ attacks: [{ side: "initiator", kill: false }], defender: { defeated: true }, initiator: { defeated: false } }), null,
    "brought down by something other than the hit");
  assert.equal(felledBy({ attacks: [], defender: { defeated: false }, initiator: { defeated: false } }), null);
  assert.equal(felledBy(null), null);
});

test("a unit that an ally comes for is left with 1 HP by the blow, and the fight ends there", () => {
  const attacker = fighter({ name: "Brigand", stats: { str: 20, dex: 30, spd: 30 } });
  const victim = fighter({ name: "Lyn", hp: 12, hpMax: 20 });
  const plan = planExchange(attacker, victim, { distance: 1 });
  const rolls = Array.from({ length: rollBudget(plan) + 4 }, () => 1);
  const replay = () => {
    let index = 0;
    return () => rolls[index++];
  };

  const lost = resolveExchange(plan, replay());
  assert.equal(felledBy(lost), "defender");
  assert.equal(lost.defender.hp, 0);

  const kept = resolveExchange(plan, replay(), { saved: { defender: { skill: "Guardian", by: "Kent" } } });
  assert.equal(kept.defender.hp, 1);
  assert.equal(kept.defender.defeated, false);
  assert.equal(felledBy(kept), null);
  const last = kept.attacks.at(-1);
  assert.deepEqual(last.saved, { skill: "Guardian", by: "Kent" });
  assert.equal(last.kill, false);
  assert.equal(last.hpAfter, 1);
  assert.equal(kept.attacks.length, lost.attacks.length, "the same blows up to the one that would have felled it, and none after");
  assert.equal(kept.slain, undefined);
});

test("a fight nobody would fall in is rolled the same whether an ally stands by or not", () => {
  const attacker = fighter({ name: "Brigand", stats: { str: 4 } });
  const victim = fighter({ name: "Lyn", hp: 20, hpMax: 20, stats: { def: 10 } });
  const plan = planExchange(attacker, victim, { distance: 1 });
  const plain = resolveExchange(plan, () => 50);
  const watched = resolveExchange(plan, () => 50, { saved: { defender: { skill: "Guardian", by: "Kent" } } });
  assert.deepEqual(watched, plain);
});

test("nothing is done to a unit that was carried off once the fight is over, nor by it", () => {
  const venom = made("Venom", [{ proc: { on: "after", sure: true }, retaliate: 5 }]);
  const spite = made("Spite", [{ proc: { on: "after", sure: true }, retaliate: 5 }]);
  const attacker = fighter({ name: "Brigand", hp: 20, stats: { str: 20, dex: 30 }, skills: [venom] });
  const victim = fighter({ name: "Lyn", hp: 12, hpMax: 20, skills: [spite] });
  const plan = planExchange(attacker, victim, { distance: 1 });
  const kept = resolveExchange(plan, () => 1, { saved: { defender: { skill: "Guardian", by: "Kent" } } });
  assert.equal(kept.defender.hp, 1, "what its foe deals after the fight does not reach it");
  assert.equal(kept.initiator.hp, 20, "and it deals nothing itself");
  assert.equal(kept.after, undefined);
});

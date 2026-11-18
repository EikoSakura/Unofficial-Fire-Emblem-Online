/**
 * Tests for `module/rules/spread.mjs` and what reads it: what a skill does to the units around the target of a
 * fight, around its own unit or in a line, at a moment of a fight or of a turn.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerAlone } from "../module/rules/answers.mjs";
import { standing } from "../module/rules/auras.mjs";
import { planExchange, playExchange, resolveExchange, rollBudget, spreadForecast } from "../module/rules/combat.mjs";
import { conditionMoments, killMoments } from "../module/rules/events.mjs";
import { reachable, surroundings } from "../module/rules/positions.mjs";
import { checkEffects, skillTotals, turnMoment, useMoment } from "../module/rules/skills.mjs";
import { behind, checkSpread, pickSpread, spreadGrant, spreadOut, spreadShare, spreadTo } from "../module/rules/spread.mjs";
import { buildChange, harmsOf } from "../module/rules/timed.mjs";
import { describeSpread, forecastSpreads } from "../module/helpers/spread-context.mjs";
import { dice, fighter, made, skill, unit } from "./lib/fixtures.mjs";

/* -------------------------------------------- */
/*  A Map                                       */
/* -------------------------------------------- */

const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);

/** A unit with a token on the map: `at` is its row and column. */
function token(id, side, at, more = {}) {
  return {
    id, actor: `Actor.${id}`, name: id.toUpperCase(), side, tile: { i: at[0], j: at[1] }, hp: 20, hpMax: 20, level: 5,
    stats: { str: 10, mag: 4, def: 6, res: 3, dex: 8, spd: 8, luk: 5 }, skills: [], ...more
  };
}

/** What a unit has around it on a map of such units. */
const around = (units, id) => surroundings(units, id, measure);

/** Two fighters standing on a map among others: A (a player's unit) attacks B (an enemy). */
function onMap(a, b, others, { at = [0, 0], foeAt = [0, 1] } = {}) {
  const units = [token("a", "player", at, { hp: a.hp, hpMax: a.hpMax }), token("b", "enemy", foeAt, { hp: b.hp, hpMax: b.hpMax }), ...others];
  return [{ ...a, near: around(units, "a") }, { ...b, near: around(units, "b") }];
}

const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });
const BOW = { name: "Iron Bow", category: "bow", range: "2", might: 6 };
const FIRE = { name: "Fire", category: "fire", range: "1-2", might: 5, damageStat: "mag" };

/** Roll a fight out with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], { rest = 100, distance = 1, decide = () => null } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const points = [];
  const { result, used } = playExchange(plan, (index) => rolls[index] ?? rest, (point) => {
    points.push(point);
    const key = decide(point);
    return (key === "first") ? point.offers[0].key : (key ?? null);
  });
  assert.ok(used <= rollBudget(plan), `rolled ${used} of ${rollBudget(plan)}`);
  return { plan, result, points };
}

const shares = (spread) => spread.units.map(({ change, ...share }) => share);

/* -------------------------------------------- */
/*  The Rule Itself                             */
/* -------------------------------------------- */

test("a line behind a unit: straight on, along a diagonal, and for so many spaces", () => {
  assert.deepEqual(behind({ i: 0, j: 0 }, { i: 0, j: 2 }, 3), [{ i: 0, j: 3 }, { i: 0, j: 4 }, { i: 0, j: 5 }]);
  assert.deepEqual(behind({ i: 2, j: 2 }, { i: 1, j: 1 }, 2), [{ i: 0, j: 0 }]);
  assert.deepEqual(behind({ i: 0, j: 0 }, { i: 0, j: 0 }, 3), []);
  assert.deepEqual(behind({ i: 0, j: 0 }, { i: 0, j: 1 }, 0), []);
  assert.deepEqual(behind(null, { i: 0, j: 1 }, 2), []);
});

test("who is reached: around the foe, around the unit, around both, and never the foe unless it is named", () => {
  const units = [
    token("a", "player", [0, 0]), token("b", "enemy", [0, 1]), token("c", "enemy", [0, 2]), token("d", "enemy", [1, 0]),
    token("e", "enemy", [0, 4]), token("f", "player", [1, 1]), token("g", "other", [0, 3])
  ];
  const near = around(units, "a");
  const foeNear = around(units, "b");
  const ids = (spread) => spreadTo(spread, near, foeNear).map((other) => other.id);
  assert.deepEqual(ids({ around: "foe", within: 1 }), ["c"]);
  assert.deepEqual(ids({ around: "foe", within: 3 }), ["c", "d", "e"]);
  assert.deepEqual(ids({ around: "self", within: 1 }), ["d"]);
  assert.deepEqual(ids({ around: "both", within: 1 }).sort(), ["c", "d"]);
  assert.deepEqual(ids({ around: "self", within: 1, foe: true }), ["b", "d"]);
  assert.deepEqual(ids({ around: "foe", within: 1, foe: true }), ["b", "c"]);
  assert.deepEqual(ids({ around: "foe", within: 3, apart: true }), ["c", "e"]);
  assert.deepEqual(ids({ who: "ally", around: "self", within: 2 }), ["f"]);
  assert.deepEqual(ids({ around: "self" }).sort(), ["c", "d", "e"]);

  // Nothing can be told for a unit that is not on the map, nor around a foe that is not
  assert.equal(spreadTo({ around: "foe", within: 1 }, null, foeNear), null);
  assert.equal(spreadTo({ around: "foe", within: 1 }, near, null), null);
  assert.deepEqual(spreadTo({ around: "self", within: 1 }, near, null).map((other) => other.id), ["b", "d"]);
});

test("a unit that left the fight is passed over, and so is an enemy that cannot be targeted", () => {
  const units = [
    token("a", "player", [0, 0]), token("b", "enemy", [0, 1]), token("c", "enemy", [0, 2], { untargetable: true }),
    token("d", "enemy", [1, 1], { hp: 0 }), token("e", "enemy", [0, 3], { out: true }), token("f", "enemy", [1, 2])
  ];
  const reached = spreadTo({ around: "foe", within: 2 }, around(units, "a"), around(units, "b"));
  assert.deepEqual(reached.map((other) => other.id), ["f"]);
  assert.equal(reachable({ relation: "ally", untargetable: true, hp: 5 }), true);
  assert.equal(reachable({ relation: "enemy", untargetable: true, hp: 5 }), false);
});

test("who is picked: the nearest, a random one, the most hurt, or those the owner picks", () => {
  const list = [{ id: "x", distance: 1, hp: 20, hpMax: 20 }, { id: "y", distance: 1, hp: 5, hpMax: 20 }, { id: "z", distance: 2, hp: 10, hpMax: 20 }];
  const ids = (picked) => picked.units.map((other) => other.id);
  assert.deepEqual(ids(pickSpread(list, {})), ["x", "y", "z"]);
  assert.deepEqual(ids(pickSpread(list, { targets: 1 })), ["x"]);
  assert.deepEqual(ids(pickSpread(list, { targets: 1, pick: "random" }, () => 3)), ["z"]);
  assert.deepEqual(ids(pickSpread(list, { targets: 2, pick: "random" }, () => 1)), ["x", "y"]);
  assert.deepEqual(ids(pickSpread(list, { targets: 1, pick: "hurt" })), ["y"]);
  const chosen = pickSpread(list, { targets: 1, pick: "choose" });
  assert.equal(chosen.choose, 1);
  assert.deepEqual(ids(chosen), ["x"]);
  assert.equal(chosen.open.length, 3);

  // With no more units than it goes to, nobody is asked and nothing is rolled
  assert.equal(pickSpread(list.slice(0, 1), { targets: 1, pick: "choose" }).choose, 0);
  assert.equal(pickSpread(list.slice(0, 1), { targets: 1, pick: "random" }, () => assert.fail("no die")).rolled, undefined);
});

test("what each gets: a share of the hit, a number read from the unit caught, less its defence", () => {
  const other = { id: "c", name: "C", hp: 12, hpMax: 21, stats: { res: 3 }, totals: { res: 4 } };
  const read = (value, from) => (from ? Math.floor((from[value.of] ?? from.stats?.[value.of] ?? 0) / (value.div ?? 1)) : 9);
  assert.equal(spreadShare({ damage: { of: "dealt", div: 3 } }, other, { dealt: 10 }).damage, 3);
  assert.equal(spreadShare({ damage: { of: "hpMax", div: 5, theirs: true } }, other, { read }).damage, 4);
  assert.equal(spreadShare({ damage: { of: "mag" }, resist: "res" }, other, { read }).damage, 5);
  assert.equal(spreadShare({ damage: 2, resist: "res" }, other, { read }).damage, 0);
  assert.equal(spreadShare({ heal: [3, { of: "dealt" }] }, other, { dealt: 4 }).heal, 7);
  assert.deepEqual(spreadShare({ inflicts: ["burn", { id: "berserk", turns: 1 }] }, other).inflicts, [{ id: "burn" }, { id: "berserk", turns: 1 }]);
});

test("a condition is passed on for a share of its turns, and no fewer than the least", () => {
  const passes = { passes: { percent: 50, min: 1 } };
  const other = { id: "c", name: "C" };
  assert.deepEqual(spreadShare(passes, other, { inflicted: { id: "poison", turns: 5 } }).inflicts, [{ id: "poison", turns: 2, passed: true }]);
  assert.deepEqual(spreadShare(passes, other, { inflicted: { id: "stun", turns: 1 } }).inflicts, [{ id: "stun", turns: 1, passed: true }]);
  assert.equal(spreadShare(passes, other, {}).inflicts, undefined);

  // Of a condition that adds up, half of what was added, not of all the unit suffers
  assert.deepEqual(spreadShare(passes, other, { inflicted: { id: "burn", turns: 9, previous: 5, stacked: true } }).inflicts, [{ id: "burn", turns: 2, passed: true }]);
});

test("an attack on each unit caught falls off from one to the next", () => {
  const attack = { attack: { hit: -20, damage: 50, falls: { hit: -10, damage: 50 }, free: true } };
  assert.deepEqual(spreadShare(attack, { id: "c" }, { nth: 0 }).attack, { hit: -20, share: 0.5 });
  assert.deepEqual(spreadShare(attack, { id: "d" }, { nth: 1 }).attack, { hit: -30, share: 0.25 });
  assert.deepEqual(spreadShare({ attack: {} }, { id: "c" }).attack, { hit: 0, share: 1 });
});

test("a change that lasts as long as the condition lasts with the first condition the unit is given", () => {
  const grant = { effects: [{ rules: ["turned"] }], ends: "turnEnd", turns: "condition" };
  assert.deepEqual(spreadGrant(grant, [{ id: "berserk", turns: 1 }]), { effects: [{ rules: ["turned"] }], ends: "turnEnd", turns: 1, next: true, while: "berserk" });
  assert.equal(spreadGrant(grant, [{ id: "rattled" }]).while, "rattled");
  assert.equal(spreadGrant({ effects: [], ends: "turnStart" }, []).ends, "turnStart");
});

test("a spread that is written wrongly is told of", () => {
  const wrong = (spread, proc = { on: "hit", sure: true }) => checkSpread(spread, proc).length > 0;
  assert.equal(wrong({ who: "enemy", around: "foe", within: 1, damage: 5 }), false);
  assert.equal(wrong({ around: "foe", within: 1 }), true);
  assert.equal(wrong({ around: "near", damage: 5 }), true);
  assert.equal(wrong({ around: "foe", damage: 5, pick: "random" }), true);
  assert.equal(wrong({ around: "foe", damage: 5, aim: true }), true);
  assert.equal(wrong({ around: "foe", inflicts: ["nothing"] }), true);
  assert.equal(wrong({ around: "foe", damage: 5 }, { on: "turnStart", sure: true }), true);
  assert.equal(wrong({ around: "self", damage: 5 }, { on: "turnStart", sure: true }), false);
  assert.equal(wrong({ around: "foe", passes: { percent: 50 } }), true);
  assert.equal(wrong({ around: "foe", passes: { percent: 50 } }, { on: "inflict", sure: true }), false);
  assert.equal(wrong({ line: { reach: "weapon" }, attack: { hit: -20 } }), false);
  assert.equal(wrong({ line: { reach: 0 }, attack: {} }), true);
  assert.equal(wrong({ around: "foe", damage: 5 }, { on: "struck", sure: true }), true);
  assert.deepEqual(checkEffects([{ proc: { on: "after", sure: true }, spread: { around: "foe", within: 2, damage: { of: "hpMax", div: 5, theirs: true } } }]), []);
  assert.ok(checkEffects([{ proc: { on: "after", sure: true }, spread: { around: "foe", grant: { effects: [], ends: "sometime" } } }]).length > 0);
});

/* -------------------------------------------- */
/*  Damage Around the Target                    */
/* -------------------------------------------- */

test("Cleave: a third of the damage dealt goes to a random enemy next to the target, for each hit in melee", () => {
  const others = [token("c", "enemy", [0, 2]), token("d", "enemy", [1, 1]), token("e", "enemy", [0, 4])];
  const [a, b] = onMap(A({ skills: [skill("Cleave")] }), B(), others);
  const { result } = fight(a, b, [1, 100, 51], { rest: 100 });
  const hit = result.attacks[0];
  assert.equal(hit.damage, 9);
  assert.equal(result.spreads.length, 1);
  assert.equal(result.spreads[0].skill, "Cleave");
  assert.deepEqual(shares(result.spreads[0]), [{ id: "d", name: "D", damage: 3 }]);
  assert.deepEqual(result.spreads[0].rolled, [2]);

  // Not from 2 spaces away, and not where nobody stands next to the target
  const [far, foe] = onMap(A({ skills: [skill("Cleave")], weapon: BOW }), B(), others, { foeAt: [0, 2] });
  assert.equal(fight(far, foe, [1], { distance: 2 }).result.spreads, undefined);
  const [alone, lone] = onMap(A({ skills: [skill("Cleave")] }), B(), []);
  assert.equal(fight(alone, lone, [1]).result.spreads, undefined);
});

test("Fearsome Blow: defeating an enemy the unit attacked takes a quarter of their HP off those within 2 spaces", () => {
  const others = [token("c", "enemy", [0, 3], { hp: 9, hpMax: 21 }), token("d", "enemy", [3, 1]), token("f", "player", [1, 1])];
  const [a, b] = onMap(A({ skills: [skill("Fearsome Blow")] }), B({ hp: 5 }), others);
  const { result } = fight(a, b, [1]);
  assert.equal(result.defender.defeated, true);
  assert.deepEqual(shares(result.spreads[0]), [{ id: "c", name: "C", damage: 5 }]);
  assert.equal(result.spreads[0].on, "kill");

  // Not for a foe that stands, and not for a unit that was attacked
  assert.equal(fight(...onMap(A({ skills: [skill("Fearsome Blow")] }), B(), others), [1]).result.spreads, undefined);
  const [c, d] = onMap(A({ hp: 5 }), B({ skills: [skill("Fearsome Blow")] }), [token("x", "player", [1, 0])]);
  assert.equal(fight(c, d, [100, 100, 1]).result.spreads, undefined);
});

test("Savage Blow: after a fight the unit started, a fifth of their maximum HP off the enemies within 2 spaces of the target", () => {
  const others = [token("c", "enemy", [0, 2], { hpMax: 23 }), token("d", "enemy", [2, 1], { hpMax: 30 }), token("e", "enemy", [0, 5])];
  const [a, b] = onMap(A({ skills: [skill("Savage Blow")] }), B(), others);
  const { result } = fight(a, b, [100, 100]);
  assert.deepEqual(shares(result.spreads[0]), [{ id: "c", name: "C", damage: 4 }, { id: "d", name: "D", damage: 6 }]);
  assert.equal(result.spreads[0].on, "after");
  assert.equal(result.defender.hp, 30);

  // The forecast names it as sure, with what each would take
  const told = spreadForecast(planExchange(a, b, { distance: 1 }));
  assert.equal(told.length, 1);
  assert.deepEqual({ skill: told[0].skill, sure: told[0].sure, by: told[0].by }, { skill: "Savage Blow", sure: true, by: "initiator" });
  assert.deepEqual(told[0].units.map((share) => share.damage), [4, 6]);
});

test("Scorch: starting a fight with a Fire tome, MAG less their RES and Burn for the enemies next to the target", () => {
  const others = [token("c", "enemy", [0, 2], { totals: { res: 3 } }), token("d", "enemy", [1, 1], { totals: { res: 30 } })];
  const mage = { skills: [skill("Scorch")], stats: { mag: 12 }, weapon: FIRE };
  const [a, b] = onMap(A(mage), B(), others);
  const { result } = fight(a, b, [100]);
  assert.deepEqual(shares(result.spreads[0]), [
    { id: "c", name: "C", damage: 9, inflicts: [{ id: "burn" }] },
    { id: "d", name: "D", damage: 0, inflicts: [{ id: "burn" }] }
  ]);
  assert.equal(result.spreads[0].element, "fire");
  assert.equal(result.spreads[0].on, "start");
  assert.equal(result.defender.conditions.burn, undefined);

  // Not with another weapon in hand
  assert.equal(fight(...onMap(A({ skills: [skill("Scorch")], stats: { mag: 12 } }), B(), others), [100]).result.spreads, undefined);
});

test("Fulmination: declared, Dark damage of its MAG that cannot kill for the enemies within 3 spaces of the target", () => {
  const others = [token("c", "enemy", [0, 4]), token("d", "enemy", [2, 2]), token("e", "enemy", [0, 6])];
  const caster = (active) => A({ skills: [skill("Fulmination", { active })], stats: { mag: 11 } });
  const [a, b] = onMap(caster(true), B(), others);
  const { result } = fight(a, b, [100]);
  assert.deepEqual(shares(result.spreads[0]), [{ id: "c", name: "C", damage: 11 }, { id: "d", name: "D", damage: 11 }]);
  assert.equal(result.spreads[0].nonlethal, true);
  assert.equal(result.spreads[0].element, "dark");
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Fulmination"]);
  assert.equal(result.defender.hp, 30);

  // Not unless it was declared
  assert.equal(fight(...onMap(caster(false), B(), others), [100]).result.spreads, undefined);
});

test("Primal Blast: as the unit transforms for a fight, a quarter of its STR for every enemy next to it, its foe too", () => {
  const others = [token("c", "enemy", [1, 0]), token("d", "enemy", [0, 3])];
  const dragon = { ...A({ skills: [skill("Primal Blast")], stats: { str: 14, mag: 9 } }), shifted: true };
  const [a, b] = onMap(dragon, B(), others);
  const { result } = fight(a, b, [100, 100]);
  const spread = result.spreads[0];
  assert.deepEqual(shares(spread), [{ id: "b", name: "B", foe: true, damage: 3 }, { id: "c", name: "C", damage: 3 }]);
  assert.equal(result.defender.hp, 27);

  // With a stone that adds MAG it is MAG, and a unit that is not transformed deals none
  const mage = { ...A({ skills: [skill("Primal Blast")], stats: { str: 14, mag: 9 }, weapon: { name: "Magestone", category: "manakete", damageStat: "mag" } }), shifted: true };
  assert.equal(fight(...onMap(mage, B(), others), [100, 100]).result.spreads[0].units[0].damage, 2);
  assert.equal(fight(...onMap(A({ skills: [skill("Primal Blast")] }), B(), others), [100, 100]).result.spreads, undefined);
});

test("Blue Flame: 15 more damage, and 5 more for each ally next to the unit, up to 4 of them", () => {
  const allies = (count) => [[1, 0], [-1, 0], [0, -1], [2, 0], [3, 0]].slice(0, count).map((at, index) => token(`f${index}`, "player", at));
  const damage = (count) => {
    const [a, b] = onMap(A({ skills: [skill("Blue Flame", { nihil: true })] }), B({ hp: 60, hpMax: 60 }), allies(count));
    return fight(a, b, [1, 1, 100]).result.attacks[0].damage;
  };
  assert.equal(damage(0), 24);
  assert.equal(damage(2), 34);
  assert.equal(damage(3), 39);
});

/* -------------------------------------------- */
/*  Conditions Around                           */
/* -------------------------------------------- */

test("Inferno: the target and the enemies next to it are Burned, and take half the unit's MAG as their next turn starts", () => {
  const others = [token("c", "enemy", [0, 2]), token("d", "enemy", [0, 4])];
  const mage = A({ skills: [skill("Inferno")], stats: { mag: 13 }, weapon: FIRE });
  const [a, b] = onMap(mage, B(), others);
  const { result } = fight(a, b, [1, 100, 100]);
  const spread = result.spreads[0];
  assert.deepEqual(spread.units.map((share) => share.id), ["b", "c"]);
  assert.ok(result.defender.conditions.burn > 0);
  const own = result.granted.find((entry) => entry.to === "defender");
  assert.equal(own.change.harm, 6);
  assert.equal(own.change.ends, "turnStart");
  assert.equal(own.change.by, "Actor.A");
  assert.deepEqual(spread.units[1].inflicts, [{ id: "burn" }]);
  assert.equal(spread.units[1].change.harm, 6);

  // Nothing where the roll fails
  assert.equal(fight(a, b, [100, 100, 100]).result.spreads, undefined);
});

test("a change that deals damage as a turn starts says how much, and whose skill it is", () => {
  const change = buildChange({ effects: [], harm: 6, ends: "turnStart" }, { skill: "Inferno", from: "A", giver: "Actor.A" });
  assert.deepEqual(harmsOf([change, buildChange({ effects: [{ stats: { str: 1 } }], ends: "turnEnd" }, { skill: "Other", own: true })]),
    [{ name: "Inferno", from: "A", amount: 6, by: "Actor.A" }]);
});

test("Dark Calling: a condition its unit inflicts in a fight is passed on to the enemies next to the target for half its turns", () => {
  const others = [token("c", "enemy", [0, 2]), token("f", "player", [1, 1])];
  const curse = made("Hex", [{ proc: { on: "hit", sure: true }, inflicts: [{ id: "poison", turns: 5 }] }]);
  const [a, b] = onMap(A({ skills: [curse, skill("Dark Calling"), skill("Curse Siphon")] }), B(), others);
  const { result } = fight(a, b, [1, 100, 100]);
  const spread = result.spreads.find((entry) => entry.skill === "Dark Calling");
  assert.deepEqual(shares(spread), [{ id: "c", name: "C", inflicts: [{ id: "poison", turns: 2, passed: true }] }]);
  assert.equal(spread.on, "inflict");
});

test("Dark Calling: outside of a fight the moment hands the spread to whoever knows the map", () => {
  const giver = unit({ name: "Druid", skills: [skill("Dark Calling")], inTurn: true });
  const moments = conditionMoments({ giver, target: unit({ name: "Foe" }), inflicted: { id: "sleep", turns: 3 } });
  assert.equal(moments.spreads.length, 1);
  const units = [token("druid", "player", [0, 0]), token("foe", "enemy", [0, 2]), token("c", "enemy", [0, 3]), token("f", "player", [1, 2])];
  const out = spreadOut(moments.spreads[0].spread, around(units, "druid"), around(units, "foe"), { inflicted: { id: "sleep", turns: 3 } });
  assert.deepEqual(out.units, [{ id: "c", name: "C", inflicts: [{ id: "sleep", turns: 1, passed: true }] }]);
});

test("Roar: the enemy is Stunned as the fight begins, and makes no counter-attack in it", () => {
  const { result } = fight(A({ skills: [skill("Roar", { nihil: true })] }), B(), [1, 100, 100]);
  assert.deepEqual(result.before.map(({ skill: name, by }) => ({ name, by })), [{ name: "Roar", by: "initiator" }]);
  assert.ok(result.defender.conditions.stun > 0);
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator"]);

  // Where the roll fails the enemy answers as usual
  const failed = fight(A({ skills: [skill("Roar", { nihil: true })] }), B(), [100, 100, 100]);
  assert.equal(failed.result.before, undefined);
  assert.deepEqual(failed.result.attacks.map((attack) => attack.side), ["initiator", "defender"]);
});

test("Fearsome: as the turn of an enemy next to its unit starts, that enemy may be Stunned by it", () => {
  const wyvern = token("w", "enemy", [0, 0], { skills: [skill("Fearsome")], stats: { str: 20 } });
  const auras = standing([wyvern, token("near", "player", [0, 1])], "near", measure).auras;
  assert.equal(auras.length, 1);
  const self = { name: "near", hp: 20, hpMax: 20, level: 1, stats: {}, near: null };
  const stunned = turnMoment(auras, self, "turnStart", dice(10), { conditions: {} });
  assert.deepEqual(stunned.entries[0].inflicts, ["stun"]);
  assert.equal(stunned.entries[0].from, "w");
  assert.equal(stunned.entries[0].chance, 10);
  assert.equal(turnMoment(auras, self, "turnStart", dice(11), { conditions: {} }).entries[0].inflicts, undefined);
  assert.equal(standing([wyvern, token("far", "player", [0, 2])], "far", measure).auras.length, 0);

  // An enemy that cannot be targeted is given nothing by it
  assert.equal(standing([wyvern, token("shade", "player", [0, 1], { untargetable: true })], "shade", measure).auras.length, 0);
});

test("Omen: a random enemy is Rattled and marked each turn, and defeating a marked enemy Rattles them all", () => {
  const units = [token("o", "enemy", [0, 0]), token("p", "player", [0, 3]), token("q", "player", [4, 4]), token("r", "enemy", [1, 0])];
  const self = { name: "O", uuid: "Actor.o", hp: 20, hpMax: 20, level: 5, stats: {}, near: around(units, "o") };
  const turn = turnMoment([skill("Omen")], self, "turnStart", dice(100), { conditions: {} });
  const spread = turn.entries[0].spread;
  assert.deepEqual(spread.units.map((share) => share.id), ["q"]);
  assert.deepEqual(spread.units[0].inflicts, [{ id: "rattled" }]);
  assert.deepEqual({ name: spread.units[0].change.name, mark: spread.units[0].change.mark, while: spread.units[0].change.while },
    { name: "Omen", mark: true, while: "rattled" });

  // The kill: only of an enemy that carries the mark
  const killer = unit({ name: "O", skills: [skill("Omen")], inTurn: true });
  const marked = { ...unit({ name: "P", hp: 0 }), marks: [{ name: "Omen", from: "O" }] };
  assert.equal(killMoments(killer, marked).spreads.length, 1);
  assert.equal(killMoments(killer, unit({ name: "P", hp: 0 })).spreads.length, 0);
  assert.equal(killMoments(killer, { ...unit({ name: "P", hp: 0 }), marks: [{ name: "Omen", from: "Another" }] }).spreads.length, 0);
  const all = spreadOut(killMoments(killer, marked).spreads[0].spread, around(units, "o"), around(units, "p"));
  assert.deepEqual(all.units.map((share) => share.id).sort(), ["q"]);

  // In a fight the system rolls it is the same
  const others = [token("x", "enemy", [3, 3]), token("y", "enemy", [5, 5])];
  const [a, b] = onMap(A({ skills: [skill("Omen")] }), { ...B({ hp: 4 }), timed: [buildChange({ name: "Omen", effects: [], mark: true, ends: "turnEnd" }, { skill: "Omen", from: "A", giver: "Actor.A" })] }, others);
  const fought = fight(a, b, [1]).result;
  assert.deepEqual(fought.spreads[0].units.map((share) => share.id), ["x", "y"]);
  assert.equal(fight(...onMap(A({ skills: [skill("Omen")] }), B({ hp: 4 }), others), [1]).result.spreads, undefined);
});

test("Bewitch: the enemies next to the unit are Berserked until the end of their next turn, and turned on their own", () => {
  const units = [token("w", "player", [0, 0]), token("c", "enemy", [0, 1]), token("d", "enemy", [1, 0]), token("e", "enemy", [2, 2]), token("f", "player", [0, -1])];
  const self = { name: "W", uuid: "Actor.w", hp: 20, hpMax: 20, level: 5, stats: { mag: 20 }, near: around(units, "w") };
  const turn = turnMoment([skill("Bewitch")], self, "turnStart", dice(10), { conditions: {} });
  const spread = turn.entries[0].spread;
  assert.deepEqual(spread.units.map((share) => share.id), ["c", "d"]);
  assert.deepEqual(spread.units[0].inflicts, [{ id: "berserk", turns: 1 }]);
  assert.deepEqual(spread.units[0].change.effects, [{ rules: ["turned"] }]);
  assert.equal(spread.units[0].change.while, "berserk");
  assert.equal(turnMoment([skill("Bewitch")], self, "turnStart", dice(11), { conditions: {} }).entries[0].spread, undefined);

  // Forced with its Use button: no roll
  const used = useMoment(skill("Bewitch"), self, dice());
  assert.deepEqual(used.entries[0].spread.units.map((share) => share.id), ["c", "d"]);
});

/* -------------------------------------------- */
/*  Further Attacks                             */
/* -------------------------------------------- */

test("Multishot: an attack on an enemy next to the target and not next to the unit, picked by its owner", () => {
  const others = [token("c", "enemy", [0, 3]), token("d", "enemy", [1, 2]), token("e", "enemy", [1, 0])];
  const archer = A({ skills: [skill("Multishot")], weapon: BOW, stats: { dex: 30 } });
  const [a, b] = onMap(archer, B(), others, { foeAt: [0, 2] });
  const { result } = fight(a, b, [30, 100], { distance: 2 });
  const spread = result.spreads[0];
  assert.equal(spread.choose, 1);
  assert.deepEqual(spread.open.map((share) => share.id).sort(), ["c", "d"]);
  assert.deepEqual(spread.units.map((share) => share.attack), [{ hit: 0, share: 1 }]);
  assert.deepEqual(spread.attack, { free: false });

  // Not with another weapon, and not where the roll fails
  assert.equal(fight(...onMap(A({ skills: [skill("Multishot")], stats: { dex: 30 } }), B(), others), [1, 100]).result.spreads, undefined);
  assert.equal(fight(a, b, [31, 100], { distance: 2 }).result.spreads, undefined);
});

test("an attack on another unit beside a fight is one attack, made at any distance, that is not answered", () => {
  const archer = A({ skills: [skill("Multishot")], weapon: BOW });
  const plan = planExchange(archer, B(), { distance: 5, extra: { skill: "Multishot" } });
  assert.deepEqual(plan.order, ["initiator"]);
  assert.equal(plan.initiator.blocked, null);
  assert.ok(plan.defender.blocked);
  const usual = planExchange(A({ weapon: BOW }), B({ weapon: BOW }), { distance: 2 });
  assert.deepEqual(usual.order, ["initiator", "defender"]);
  const extra = planExchange(A({ weapon: BOW }), B({ weapon: BOW }), { distance: 2, extra: { skill: "Collateral", hit: -20, share: 0.5, free: true } });
  assert.deepEqual(extra.order, ["initiator"]);
  assert.equal(extra.initiator.hit, usual.initiator.hit - 20);
  const result = resolveExchange(extra, dice(1, 100));
  assert.equal(result.attacks[0].damage, Math.floor(usual.initiator.damage / 2));
  assert.equal(result.initiator.usesSpent, 0);

  // It reaches for nobody in turn
  const others = [token("c", "enemy", [0, 3])];
  const [a, b] = onMap(archer, B(), others, { foeAt: [0, 2] });
  assert.equal(planExchange(a, b, { distance: 2, extra: { skill: "Multishot" } }).initiator.chances.start.length, 0);
});

test("Collateral: on a ranged hit the unit may attack the enemies in a line behind the target, each at less Hit and half the damage", () => {
  const others = [token("c", "enemy", [0, 3]), token("d", "enemy", [0, 4]), token("e", "enemy", [1, 3]), token("far", "enemy", [0, 6])];
  const gunner = A({ skills: [skill("Collateral", { chosen: true })], weapon: BOW });
  const [a, b] = onMap(gunner, B(), others, { foeAt: [0, 2] });
  const taken = fight(a, b, [1, 100], { distance: 2, decide: () => "first" });
  assert.equal(taken.points[0].on, "hit");
  assert.deepEqual(taken.points[0].offers.map(({ what, others: count }) => ({ what, count })), [{ what: "spread", count: 2 }]);
  const spread = taken.result.spreads[0];
  assert.deepEqual(spread.units.map(({ id, attack }) => ({ id, attack })), [
    { id: "c", attack: { hit: -20, share: 0.5 } },
    { id: "d", attack: { hit: -30, share: 0.25 } }
  ]);
  assert.deepEqual(spread.attack, { free: true });

  // Passed, nothing; a miss offers nothing; and nothing is offered with nobody behind
  assert.equal(fight(a, b, [1, 100], { distance: 2 }).result.spreads, undefined);
  assert.equal(fight(a, b, [100], { distance: 2, decide: () => "first" }).points.length, 0);
  const [lone, foe] = onMap(gunner, B(), [token("e", "enemy", [1, 3])], { foeAt: [0, 2] });
  assert.equal(fight(lone, foe, [1, 100], { distance: 2, decide: () => "first" }).points.length, 0);

  // A unit that answers by itself takes what costs it nothing
  assert.equal(answerAlone(taken.points[0]), "Collateral");
});

test("Whirlwind: an additional attack with Elwind that adds DEX, and every enemy next to the unit is pushed back", () => {
  const others = [token("c", "enemy", [1, 0]), token("d", "enemy", [0, 3])];
  const raven = A({ skills: [skill("Whirlwind", { nihil: true })], stats: { spd: 20, dex: 12, mag: 1 } });
  const [a, b] = onMap(raven, B({ hp: 60, hpMax: 60, stats: { res: 2, spd: 20 } }), others);
  const { result } = fight(a, b, [10, 1, 100, 1, 100], { rest: 100 });
  const mine = result.attacks.filter((attack) => attack.side === "initiator");
  assert.equal(mine.length, 2);
  assert.equal(mine[1].added, true);
  assert.equal(mine[1].skill, "Whirlwind");
  assert.deepEqual(mine[1].own, { hit: 80, might: 5 });
  assert.equal(mine[1].damage, 5 + 12 - 2);
  const spread = result.spreads[0];
  assert.deepEqual(spread.units.map(({ id, push, foe }) => ({ id, push, foe })), [{ id: "b", push: true, foe: true }, { id: "c", push: true, foe: undefined }]);
  assert.deepEqual(spread.push, { spaces: 1, blocked: 5 });

  // The attack it adds rolls no Whirlwind of its own
  assert.equal(result.spreads.length, 1);
});

/* -------------------------------------------- */
/*  Healing and Help Around the Unit            */
/* -------------------------------------------- */

test("Holy Aura: allies within 3 spaces regain a fifth of their HP as the unit's turn starts", () => {
  const units = [
    token("h", "player", [0, 0]), token("f", "player", [0, 3], { hp: 4, hpMax: 23 }), token("g", "ally", [1, 1], { hp: 10, hpMax: 10 }),
    token("far", "player", [0, 4], { hp: 1 }), token("x", "enemy", [0, 1], { hp: 1 })
  ];
  const self = { name: "H", uuid: "Actor.h", hp: 5, hpMax: 20, level: 5, stats: { luk: 30 }, near: around(units, "h") };
  const turn = turnMoment([skill("Holy Aura")], self, "turnStart", dice(30), { conditions: {} });
  assert.deepEqual(turn.entries[0].spread.units, [{ id: "g", name: "G", heal: 2 }, { id: "f", name: "F", heal: 4 }]);
  assert.equal(turn.healed, 0);
  assert.equal(turnMoment([skill("Holy Aura")], self, "turnStart", dice(31), { conditions: {} }).entries[0].spread, undefined);

  // With no ally in reach it has no moment
  const alone = { ...self, near: around([token("h", "player", [0, 0])], "h") };
  assert.equal(turnMoment([skill("Holy Aura")], alone, "turnStart", dice(), { conditions: {} }).entries.length, 0);
});

test("Holy Conduit: a critical hit restores the damage it dealt to the ally next to the unit that has lost the most HP", () => {
  const others = [token("f", "player", [1, 0], { hp: 18 }), token("g", "player", [-1, 0], { hp: 6 }), token("h", "player", [0, -2], { hp: 1 })];
  const [a, b] = onMap(A({ skills: [skill("Holy Conduit", { nihil: true })] }), B({ hp: 60, hpMax: 60 }), others);
  const { result } = fight(a, b, [1, 1, 100]);
  assert.equal(result.attacks[0].crit, true);
  assert.deepEqual(shares(result.spreads[0]), [{ id: "g", name: "G", heal: result.attacks[0].damage }]);
  assert.equal(fight(a, b, [1, 100, 100]).result.spreads, undefined);
});

test("Influence: allies next to the unit regain 7 HP after a fight it started", () => {
  const others = [token("f", "player", [1, 0]), token("g", "player", [2, 0]), token("x", "enemy", [-1, 0])];
  const [a, b] = onMap(A({ skills: [skill("Influence")] }), B(), others);
  assert.deepEqual(shares(fight(a, b, [100, 100]).result.spreads[0]), [{ id: "f", name: "F", heal: 7 }]);
  const [c, d] = onMap(A(), B({ skills: [skill("Influence")] }), [token("y", "enemy", [0, 2])]);
  assert.equal(fight(c, d, [100, 100]).result.spreads, undefined);
});

test("Influence: Motivate gives 2 more, to allies within 2 spaces", () => {
  const given = (skills, j) => standing([token("o", "player", [0, 0], { skills }), token("n", "player", [0, j])], "n", measure).auras;
  const plain = given([skill("Motivate")], 1);
  assert.deepEqual(plain[0].effects.map((effect) => effect.stats), [{ def: 3, res: 3, luk: 3 }]);
  assert.equal(given([skill("Motivate")], 2).length, 0);
  const more = given([skill("Motivate"), skill("Influence")], 2);
  assert.deepEqual(more[0].effects.map((effect) => effect.stats), [{ def: 5, res: 5, luk: 5 }]);
  assert.deepEqual(given([skill("Motivate"), skill("Influence")], 1)[0].effects.map((effect) => effect.stats), [{ def: 5, res: 5, luk: 5 }]);
});

/* -------------------------------------------- */
/*  Numbers and Auras From Who Stands Near      */
/* -------------------------------------------- */

test("Harmonize: +1 Might for each ally within 2 spaces that carries a Tome it may wield", () => {
  const tome = [{ category: "fire", name: "Fire" }];
  const units = [
    token("m", "player", [0, 0]), token("f", "player", [0, 1], { carried: tome }), token("g", "ally", [1, 1], { carried: [{ category: "dark", name: "Flux" }] }),
    token("h", "player", [0, 2], { carried: [{ category: "sword", name: "Iron Sword" }] }), token("far", "player", [0, 3], { carried: tome }),
    token("x", "enemy", [1, 0], { carried: tome })
  ];
  const self = { hp: 20, hpMax: 20, level: 5, stats: {}, near: around(units, "m") };
  assert.equal(skillTotals([skill("Harmonize")], self).might, 2);
  assert.equal(skillTotals([skill("Harmonize")], { ...self, near: around([token("m", "player", [0, 0])], "m") }).might, 0);

  // Off the map nobody can be counted: the skill is named to check by hand
  const off = skillTotals([skill("Harmonize")], { ...self, near: null });
  assert.equal(off.might, 0);
  assert.deepEqual(off.checks.map((entry) => entry.skill), ["Harmonize"]);
});

test("Phantom Support: the unit's Phantom gives its allies within 3 spaces that were not summoned, once", () => {
  const summoner = token("s", "player", [0, 0], { skills: [skill("Phantom Support")] });
  const phantom = (id, at) => token(id, "player", at, { summoner: "Actor.s" });
  const got = (units, id) => standing(units, id, measure).auras;
  const units = [summoner, phantom("p1", [0, 6]), token("n", "player", [0, 8]), phantom("p2", [0, 9]), token("x", "enemy", [0, 7]), token("far", "player", [5, 0])];
  const near = got(units, "n");
  assert.equal(near.length, 1);
  assert.equal(near[0].skill, "Phantom Support");
  assert.equal(near[0].from, "p2");
  assert.deepEqual(near[0].effects, [{ combat: { dodge: 10, critAvoid: 5 }, stats: { def: 1, res: 1 } }]);
  assert.equal(got(units, "x").length, 0);
  assert.equal(got(units, "p2").length, 0);
  assert.equal(got(units, "far").length, 0);

  // The summoner gains it from its own Phantom, and gives nothing itself
  const close = [summoner, phantom("p1", [0, 2]), token("m", "player", [1, 0])];
  assert.equal(got(close, "s")[0].from, "p1");
  assert.equal(got(close, "m")[0].from, "p1");
  assert.equal(got([summoner, token("m", "player", [1, 0])], "m").length, 0);

  // A Phantom whose summoner has not the skill gives nothing
  assert.equal(got([token("s", "player", [0, 0]), phantom("p1", [0, 2]), token("m", "player", [1, 2])], "m").length, 0);
});

/* -------------------------------------------- */
/*  Units That Cannot Be Targeted               */
/* -------------------------------------------- */

test("a unit that cannot be targeted is passed over by a reach at a turn moment and by a change for the units around a foe", () => {
  const units = [token("r", "player", [0, 0]), token("c", "enemy", [0, 1], { untargetable: true }), token("d", "enemy", [1, 0])];
  const self = { name: "R", uuid: "Actor.r", hp: 20, hpMax: 20, level: 5, stats: { res: 30 }, near: around(units, "r") };
  const curse = made("Curse", [{ proc: { on: "turnStart", sure: true }, grant: { reach: { who: "enemy", within: 1 }, effects: [{ stats: { str: -2 } }], ends: "turnEnd" } }]);
  assert.deepEqual(turnMoment([curse], self, "turnStart", dice(), { conditions: {} }).entries[0].granted.map((entry) => entry.unit), ["d"]);

  const others = [token("c", "enemy", [0, 2], { untargetable: true }), token("d", "enemy", [1, 1])];
  const [a, b] = onMap(A({ skills: [skill("Savage Blow")] }), B(), others);
  assert.deepEqual(fight(a, b, [100, 100]).result.spreads[0].units.map((share) => share.id), ["d"]);
});

/* -------------------------------------------- */
/*  Telling It                                  */
/* -------------------------------------------- */

const i18n = { localize: (key) => key, format: (key, data = {}) => `${key}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ""}` };

test("the card tells what each unit caught took or gained, one part for each", () => {
  const told = describeSpread({ lines: [
    { name: "C", damage: 4, down: true },
    { name: "D", healed: 7 },
    { name: "E", inflicted: ["burn"], pushed: true },
    { name: "F", blocked: 5 },
    { name: "G", attack: { hit: true, crit: false, damage: 6, kill: false, hitChance: 70 } }
  ] }, i18n);
  assert.equal(told.split(" · ").length, 5);
  assert.match(told, /^C FEO\.Spread\.damage \{"amount":4\}, FEO\.Spread\.down/);
  assert.match(told, /D FEO\.Spread\.heal \{"amount":7\}/);
  assert.match(told, /E FEO\.Condition\.burn, FEO\.Spread\.pushed/);
  assert.match(told, /F FEO\.Spread\.blocked \{"amount":5\}/);
  assert.match(told, /G FEO\.Spread\.attack\.hit/);
  assert.equal(describeSpread({ lines: [] }, i18n), "");
});

test("the forecast names a spread in a few words, with every unit it would catch behind it", () => {
  const others = [token("c", "enemy", [0, 2], { hpMax: 23 }), token("d", "enemy", [1, 1]), token("f", "player", [1, 0])];
  const [a, b] = onMap(A({ skills: [skill("Savage Blow"), skill("Cleave"), skill("Influence")] }), B(), others);
  const notes = forecastSpreads(spreadForecast(planExchange(a, b, { distance: 1 })), i18n);
  assert.deepEqual(notes.map((note) => [note.skill, note.sure, note.tone]), [["Cleave", false, "bad"], ["Savage Blow", true, "bad"], ["Influence", true, "good"]]);
  assert.match(notes[0].label, /^FEO\.Spread\.forecast\.on\.hit/);
  assert.match(notes[0].hint, /^FEO\.Spread\.forecast\.among/);
  assert.match(notes[1].label, /^FEO\.Spread\.forecast\.sure/);
  assert.equal(notes[1].hint.split(" · ").length, 2);

  // A fight in which nothing reaches anybody has nothing to name
  assert.deepEqual(forecastSpreads(spreadForecast(planExchange(A(), B(), { distance: 1 })), i18n), []);
});

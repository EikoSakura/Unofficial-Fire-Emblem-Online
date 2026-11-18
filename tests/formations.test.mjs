/**
 * Tests for the formations of `module/rules/positions.mjs` and the attacks made in them: three units that
 * stand in a triangle around an enemy, read through Triangle Attack and Delta Attack as they are written in
 * effects.json. Run with `node --test tests/` or `node tests/formations.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planExchange, planFormations, resolveExchange } from "../module/rules/combat.mjs";
import { formationAround, standAround, surroundings, tilesApart } from "../module/rules/positions.mjs";
import { checkEffects } from "../module/rules/skills.mjs";
import { builtEffects, fighter, made, skill } from "./lib/fixtures.mjs";

const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
const tile = (i, j) => ({ i, j });

/** A unit with a token on the map: `at` is its row and column. */
function token(id, side, at, more = {}) {
  return { id, actor: `Actor.${id}`, name: id.toUpperCase(), side, tile: tile(...at), hp: 20, hpMax: 20, level: 5, stats: {}, skills: [], ...more };
}

/**
 * A (a player's unit) attacks B (an enemy) with allies P and Q on the map, each with the skills given.
 * @returns {[object, object]}    The two fighters, each with what it has around it
 */
function field(name, { at = [1, 0], foeAt = [1, 1], p = [0, 1], q = [1, 2], partners = [skill(name), skill(name)], own = [skill(name)], more = [], weapon = {}, foe = {} } = {}) {
  const units = [
    token("a", "player", at), token("b", "enemy", foeAt),
    token("p", "player", p, { skills: partners[0] ? [partners[0]] : [] }),
    token("q", "player", q, { skills: partners[1] ? [partners[1]] : [] }),
    ...more
  ];
  const a = { ...fighter({ name: "A", skills: own, weapon: { hit: 60, ...weapon }, stats: { spd: 20 } }), near: surroundings(units, "a", measure) };
  const b = { ...fighter({ name: "B", hp: 60, hpMax: 60, ...foe }), near: surroundings(units, "b", measure) };
  return [a, b];
}

/* -------------------------------------------- */
/*  A Triangle on a Square Grid                 */
/* -------------------------------------------- */

test("three units stand around a fourth where its space lies inside the triangle between them, edges included", () => {
  const middle = tile(5, 5);
  // On three sides of it: the T of the games
  assert.equal(standAround([tile(5, 4), tile(4, 5), tile(5, 6)], middle), true);
  assert.equal(standAround([tile(4, 5), tile(5, 6), tile(6, 5)], middle), true);
  // Two on opposite sides and a third off their line, 2 spaces away
  assert.equal(standAround([tile(5, 4), tile(5, 6), tile(3, 5)], middle), true);
  // Corner to corner on two sides, and one behind
  assert.equal(standAround([tile(4, 4), tile(4, 6), tile(6, 5)], middle), true);
  // All three to one side of it
  assert.equal(standAround([tile(4, 5), tile(4, 6), tile(5, 6)], middle), false);
  assert.equal(standAround([tile(4, 4), tile(4, 5), tile(4, 6)], middle), false);
  // In one line through it: no triangle at all
  assert.equal(standAround([tile(5, 3), tile(5, 4), tile(5, 6)], middle), false);
  assert.equal(standAround([tile(5, 4), tile(5, 6)], middle), false);
});

test("spaces are counted along rows and columns, between the nearest tiles of two units", () => {
  assert.equal(tilesApart(tile(0, 0), tile(0, 1)), 1);
  assert.equal(tilesApart(tile(0, 0), tile(1, 1)), 2);
  assert.equal(tilesApart({ i: 0, j: 0, width: 2, height: 2 }, tile(1, 2)), 1);
  assert.equal(tilesApart(null, tile(0, 0)), null);
});

test("a formation takes two allies that have the skill, each of the three 1 or 2 spaces from the enemy", () => {
  const filter = { with: "Triangle Attack", others: 2, from: 1, within: 2 };
  const [a, b] = field("Triangle Attack");
  assert.deepEqual(formationAround(a.near, b.near, filter).map((unit) => unit.id), ["p", "q"]);

  // An ally without the skill is no part of it
  const [a2, b2] = field("Triangle Attack", { partners: [skill("Triangle Attack"), null] });
  assert.deepEqual(formationAround(a2.near, b2.near, filter), []);

  // An ally 3 spaces from the enemy is too far, though the triangle would stand
  const [a3, b3] = field("Triangle Attack", { p: [1, 4], q: [0, 1] });
  assert.deepEqual(formationAround(a3.near, b3.near, filter), []);

  // 2 spaces away is near enough: an archer and a unit corner to corner
  const [a4, b4] = field("Triangle Attack", { at: [1, 3], foeAt: [1, 1], p: [0, 0], q: [2, 0] });
  assert.deepEqual(formationAround(a4.near, b4.near, filter).map((unit) => unit.id).sort(), ["p", "q"]);

  // The unit itself must stand 1 or 2 spaces away as well
  const [a5, b5] = field("Triangle Attack", { at: [1, 4], foeAt: [1, 1], p: [0, 1], q: [2, 1] });
  assert.deepEqual(formationAround(a5.near, b5.near, filter), []);

  // Where it cannot be told where units stand, nothing is said
  assert.equal(formationAround(null, b.near, filter), null);

  // An enemy that has the skill is nobody's partner
  const [a6, b6] = field("Triangle Attack", { partners: [skill("Triangle Attack"), null], more: [token("x", "enemy", [1, 2], { skills: [skill("Triangle Attack")] })], q: [3, 3] });
  assert.deepEqual(formationAround(a6.near, b6.near, filter), []);
});

/* -------------------------------------------- */
/*  The Attacks                                 */
/* -------------------------------------------- */

test("the effects of Triangle Attack and Delta Attack pass the build's checks", () => {
  for ( const name of ["Triangle Attack", "Delta Attack"] ) assert.deepEqual(checkEffects(builtEffects(name)), [], name);
  assert.ok(checkEffects([{ when: { formation: { with: "", others: 2 } }, combat: { hit: 5 } }]).length > 0);
  assert.ok(checkEffects([{ when: { formation: { with: "X", others: 3 } }, combat: { hit: 5 } }]).length > 0);
});

test("Triangle Attack: the first attack of a fight its unit starts cannot miss and is a critical hit", () => {
  const [a, b] = field("Triangle Attack");
  const plan = planExchange(a, b, { distance: 1 });

  // The forecast already has the guaranteed numbers for the first attack, and the usual ones for the next
  assert.deepEqual([plan.initiator.blows[0].hit, plan.initiator.blows[0].crit], [100, 100]);
  assert.deepEqual([plan.initiator.blows[1].hit, plan.initiator.blows[1].crit], [60, 1]);
  assert.deepEqual(planFormations(plan).map((entry) => [entry.skill, entry.by, entry.partners.map((unit) => unit.name)]), [["Triangle Attack", "initiator", ["P", "Q"]]]);

  // Every die comes up 99: the first attack still hits and is critical, the follow-up misses
  const result = resolveExchange(plan, () => 99);
  const mine = result.attacks.filter((attack) => attack.side === "initiator");
  assert.deepEqual([mine[0].hit, mine[0].crit], [true, true]);
  assert.equal(mine[0].damage, plan.initiator.blows[0].damage * 3);
  assert.equal(mine[1].hit, false);
});

test("Triangle Attack does nothing without the formation, when its unit is attacked, or from 3 spaces", () => {
  // All three to one side of the enemy: none stands beyond it
  const [a, b] = field("Triangle Attack", { p: [0, 1], q: [0, 2] });
  const plan = planExchange(a, b, { distance: 1 });
  assert.deepEqual([plan.initiator.blows[0].hit, plan.initiator.blows[0].crit], [60, 1]);
  assert.deepEqual(planFormations(plan), []);

  // The unit that is attacked makes no Triangle Attack in return
  const [c, d] = field("Triangle Attack");
  const back = planExchange(d, c, { distance: 1 });
  assert.equal(back.defender.blows?.[0]?.hit === 100, false);
  assert.deepEqual(planFormations(back), []);

  // Without the skill of its own the unit makes none, whoever stands around
  const [e, f] = field("Triangle Attack", { own: [] });
  assert.deepEqual(planExchange(e, f, { distance: 1 }).initiator.blows[0].crit, 1);
});

test("Delta Attack: the first attack of a fight its unit starts deals five times its damage, and is rolled to hit", () => {
  const [a, b] = field("Delta Attack");
  const plan = planExchange(a, b, { distance: 1 });
  const plain = planExchange(...field("Delta Attack", { own: [] }), { distance: 1 }).initiator.blows[0].damage;
  assert.equal(plan.initiator.blows[0].damage, plain * 5);
  assert.equal(plan.initiator.blows[0].hit, 60);
  assert.equal(plan.initiator.blows[1].damage, plain);
  assert.deepEqual(planFormations(plan).map((entry) => entry.skill), ["Delta Attack"]);

  // It hits on a roll within its Hit, and misses beyond it like any attack
  const hit = resolveExchange(plan, () => 50).attacks.find((attack) => attack.side === "initiator");
  assert.deepEqual([hit.hit, hit.damage], [true, plain * 5]);
  const miss = resolveExchange(plan, () => 99).attacks.find((attack) => attack.side === "initiator");
  assert.equal(miss.hit, false);
});

test("a formation of one skill is not one of the other", () => {
  // Allies with Delta Attack do not stand in for Triangle Attack
  const [a, b] = field("Triangle Attack", { partners: [skill("Delta Attack"), skill("Delta Attack")] });
  assert.deepEqual(planFormations(planExchange(a, b, { distance: 1 })), []);
});

test("a foe that cancels skills chosen when to activate stops the attack, and no formation is told", () => {
  const nihil = made("Nihil", [{ rules: ["nihil"] }]);
  const [a, b] = field("Triangle Attack", { own: [skill("Triangle Attack", { chosen: true })], foe: { skills: [nihil] } });
  const plan = planExchange(a, b, { distance: 1 });
  assert.deepEqual([plan.initiator.blows[0].hit === 100, plan.initiator.blows[0].crit === 100], [false, false]);
  assert.deepEqual(planFormations(plan), []);
});

test("a formation is a condition any effect may ask", () => {
  const drill = made("Drill", [{ when: { formation: { with: "Drill" } }, combat: { hit: 20 } }]);
  const units = [token("a", "player", [1, 0]), token("b", "enemy", [1, 1]), token("p", "player", [0, 1], { skills: [drill] }), token("q", "player", [1, 2], { skills: [drill] })];
  const a = { ...fighter({ name: "A", skills: [drill], weapon: { hit: 60 } }), near: surroundings(units, "a", measure) };
  const b = { ...fighter({ name: "B" }), near: surroundings(units, "b", measure) };
  const alone = { ...fighter({ name: "A", skills: [drill], weapon: { hit: 60 } }), near: surroundings([units[0], units[1]], "a", measure) };
  const foeAlone = { ...fighter({ name: "B" }), near: surroundings([units[0], units[1]], "b", measure) };
  assert.equal(planExchange(a, b, { distance: 1 }).initiator.hit - planExchange(alone, foeAlone, { distance: 1 }).initiator.hit, 20);
});

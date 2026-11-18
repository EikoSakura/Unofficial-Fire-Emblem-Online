/**
 * Tests for the answers in the middle of a fight (`module/rules/answers.mjs`, `module/rules/combat.mjs`): a
 * fight that stops for an answer and goes on from the same dice, the points a skill may answer at, what limits
 * an answer, the chances that are rolled in place of one, and the rule a unit answers by when nobody is asked.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerAlone, foilsBefore, settleFoils } from "../module/rules/answers.mjs";
import { readShield } from "../module/rules/blocking.mjs";
import { planExchange, playExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { checkEffects } from "../module/rules/skills.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/**
 * Play a fight with dice that come up as told, then always as `rest`. `decide` answers each point: with the key
 * of an offer, with "first" for the first offer, or with nothing to pass. The points that came up are told.
 */
function play(initiator, defender, rolls = [], decide = () => null, { rest = 100, distance = 1, options = {} } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const points = [];
  const { result, answers, used } = playExchange(plan, (index) => rolls[index] ?? rest, (point) => {
    points.push(point);
    const key = decide(point, points.length - 1);
    return (key === "first") ? point.offers[0].key : (key ?? null);
  }, options);
  assert.ok(used <= rollBudget(plan), `rolled ${used} of ${rollBudget(plan)}`);
  return { plan, result, answers, points, used };
}

const first = () => "first";
const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });
const BOW = { name: "Iron Bow", category: "bow", range: "2", might: 6 };

/* -------------------------------------------- */
/*  A Fight That Stops for an Answer            */
/* -------------------------------------------- */

test("a fight stops at the first point it has no answer for, and says what is offered", () => {
  const plan = planExchange(A(), B({ skills: [skill("Capote", { chosen: true })] }));
  const rolls = [1, 100, 1, 100];
  let used = 0;
  const stopped = resolveExchange(plan, () => rolls[used++], { answers: [] });
  assert.equal(stopped.attacks, undefined);
  assert.equal(stopped.pending.index, 0);
  assert.equal(stopped.pending.on, "landing");
  assert.equal(stopped.pending.side, "defender");
  assert.deepEqual(stopped.pending.offers, [{ key: "Capote", skill: "Capote", id: "capote", what: "dodge" }]);

  // The offer tells of the attack as far as it has come: rolled to hit and for its critical, not yet dealt
  assert.deepEqual(stopped.pending.attack, { side: "initiator", hitChance: 90, hitRoll: 1, crit: false, critChance: 1, critRoll: 100, damage: 9, margin: null, hp: 30 });
});

test("Capote: taken, the hit is dodged and the skill is spent; the fight goes on from the same dice", () => {
  const capote = () => B({ skills: [skill("Capote", { chosen: true })] });
  const taken = play(A(), capote(), [1, 100, 1, 100], first);
  assert.equal(taken.points.length, 1);
  assert.deepEqual(taken.answers, ["Capote"]);
  const dodged = taken.result.attacks[0];
  assert.equal(dodged.hit, false);
  assert.equal(dodged.damage, 0);
  assert.equal(dodged.dodged, "Capote");
  assert.deepEqual(dodged.answers, [{ skill: "Capote", by: "defender", on: "landing", what: "dodge" }]);
  assert.equal(taken.result.defender.hp, 30);
  assert.deepEqual(taken.result.defender.spent, [{ id: "capote", name: "Capote" }]);

  // A sword that did not land lost no use; the counter-attack rolled the dice that were its own all along
  assert.equal(dodged.useSpent, false);
  assert.equal(taken.result.attacks[1].hitRoll, 1);
  assert.equal(taken.result.attacks[1].damage, 9);

  const passed = play(A(), capote(), [1, 100, 1, 100], () => null);
  assert.equal(passed.points.length, 1);
  assert.deepEqual(passed.answers, [null]);
  assert.equal(passed.result.attacks[0].hit, true);
  assert.equal(passed.result.defender.hp, 21);
  assert.deepEqual(passed.result.defender.spent, []);
  assert.equal(passed.result.attacks[1].hitRoll, 1);
});

test("without answers nobody is asked, and a fight is what it was before", () => {
  const plan = planExchange(A(), B({ skills: [skill("Capote", { chosen: true })] }));
  const rolls = [1, 100, 1, 100];
  let used = 0;
  const plain = resolveExchange(plan, () => rolls[used++]);
  const passed = play(A(), B({ skills: [skill("Capote", { chosen: true })] }), rolls, () => null);
  assert.deepEqual(plain.attacks, passed.result.attacks);
  assert.equal(plain.pending, undefined);
});

test("an attack that misses asks nobody to dodge it, and a skill on cooldown answers nothing", () => {
  const missed = play(A(), B({ skills: [skill("Capote", { chosen: true })] }), [100, 100], first);
  assert.equal(missed.points.length, 0);
  const resting = skill("Capote", { chosen: true });
  resting.state.cooldown = 2;
  const cooling = play(A(), B({ skills: [resting] }), [1, 100, 100], first);
  assert.equal(cooling.points.length, 0);
  assert.equal(cooling.result.attacks[0].hit, true);
});

/* -------------------------------------------- */
/*  An Attack About to Be Made                  */
/* -------------------------------------------- */

test("Deflect Arrows: +15 Dodge against one ranged attack, offered before it is rolled", () => {
  const archer = () => A({ weapon: BOW });
  const taken = play(archer(), B({ skills: [skill("Deflect Arrows", { chosen: true })] }), [80, 100], first, { distance: 2 });
  const point = taken.points[0];
  assert.equal(point.on, "attacked");
  assert.equal(point.attack.hitRoll, null);
  assert.equal(point.attack.hitChance, 90);
  assert.equal(point.attack.damage, 10);
  assert.equal(point.offers[0].what, "dodgeMore");
  assert.equal(point.offers[0].amount, 15);
  assert.equal(taken.result.attacks[0].hitChance, 75);
  assert.equal(taken.result.attacks[0].hit, false);
  assert.deepEqual(taken.result.defender.spent, [{ id: "deflect-arrows", name: "Deflect Arrows" }]);

  const passed = play(archer(), B({ skills: [skill("Deflect Arrows", { chosen: true })] }), [80, 100], () => null, { distance: 2 });
  assert.equal(passed.result.attacks[0].hit, true);
  assert.deepEqual(passed.result.defender.spent, []);
});

test("Deflect Arrows: not against an attack from next to the unit, not twice a turn, and Snatch Arrows replaces it", () => {
  const near = planExchange(A(), B({ skills: [skill("Deflect Arrows", { chosen: true })] }));
  assert.equal(near.defender.chances.attacked.length, 0);
  const used = play(A({ weapon: BOW }), B({ skills: [skill("Deflect Arrows", { chosen: true, used: 1 })] }), [80, 100], first, { distance: 2 });
  assert.equal(used.points.length, 0);
  const both = play(A({ weapon: BOW }), B({ skills: [skill("Deflect Arrows", { chosen: true }), skill("Snatch Arrows", { chosen: true })] }), [80, 100], () => null, { distance: 2 });
  assert.deepEqual(both.points[0].offers.map((offer) => offer.skill), ["Snatch Arrows"]);
});

test("Snatch Arrows: the attack is made and does nothing: no roll, no hit, no miss, and the bow loses its use", () => {
  const { result, points, used } = play(A({ weapon: BOW }), B({ skills: [skill("Snatch Arrows", { chosen: true })] }), [1, 1], first, { distance: 2 });
  assert.equal(points[0].offers[0].what, "cancel");
  assert.equal(used, 0);
  assert.equal(result.attacks.length, 1);
  const attack = result.attacks[0];
  assert.deepEqual(attack.negated, { skill: "Snatch Arrows", by: "defender" });
  assert.equal(attack.hitRoll, null);
  assert.equal(attack.hit, false);
  assert.equal(attack.damage, 0);
  assert.equal(attack.useSpent, true);
  assert.equal(result.initiator.usesSpent, 1);
  assert.equal(result.defender.hp, 30);
  assert.deepEqual(result.defender.spent, [{ id: "snatch-arrows", name: "Snatch Arrows" }]);
});

test("Flee: a faster unit that started the fight may end it as its foe is about to attack, and earns nothing", () => {
  const runner = () => A({ stats: { spd: 14 }, skills: [skill("Flee", { chosen: true })] });
  const taken = play(runner(), B(), [1, 100, 1, 100, 1, 100], first);
  assert.deepEqual(taken.plan.order, ["initiator", "defender", "initiator"]);
  assert.equal(taken.points[0].on, "attacked");
  assert.equal(taken.points[0].side, "initiator");
  assert.equal(taken.points[0].attack.side, "defender");
  assert.equal(taken.points[0].offers[0].what, "end");
  assert.equal(taken.result.attacks.length, 1);
  assert.deepEqual(taken.result.fled, { side: "initiator", skill: "Flee", forgoExp: true });
  assert.equal(taken.result.initiator.hp, 30);
  assert.deepEqual(taken.result.initiator.spent, [{ id: "flee", name: "Flee" }]);
  assert.deepEqual(taken.result.answers, [{ skill: "Flee", by: "initiator", on: "attacked", what: "end" }]);

  const stayed = play(runner(), B(), [1, 100, 1, 100, 1, 100], () => null);
  assert.equal(stayed.result.attacks.length, 3);
  assert.equal(stayed.result.fled, undefined);
});

test("Flee: not for a unit that is no faster, and not for one that is attacked", () => {
  const slow = planExchange(A({ skills: [skill("Flee", { chosen: true })] }), B());
  assert.equal(slow.initiator.chances.attacked.length, 0);
  const attacked = planExchange(A(), B({ stats: { spd: 14 }, skills: [skill("Flee", { chosen: true })] }));
  assert.equal(attacked.defender.chances.attacked.length, 0);
});

/* -------------------------------------------- */
/*  A Roll That Failed                          */
/* -------------------------------------------- */

test("True Strike: a miss by 10 or less may be rolled again, once in a fight", () => {
  const striker = () => A({ stats: { spd: 14 }, weapon: { hit: 80 }, skills: [skill("True Strike", { chosen: true })] });

  // 85 against 80 misses by 5; rolled again it lands. The foe misses; the follow-up misses by 4, and is left
  const { result, points } = play(striker(), B(), [85, 50, 100, 100, 84], first);
  assert.equal(points.length, 1);
  assert.equal(points[0].on, "miss");
  assert.equal(points[0].attack.margin, 5);
  assert.equal(points[0].offers[0].what, "reroll");
  assert.deepEqual(result.attacks[0].rerolls, [{ skill: "True Strike", roll: "hit", first: 85 }]);
  assert.equal(result.attacks[0].hitRoll, 50);
  assert.equal(result.attacks[0].hit, true);
  assert.equal(result.attacks[2].hit, false);
  assert.equal(result.attacks[2].rerolls, undefined);
});

test("True Strike: not for a miss by more than 10; a failed critical roll counts as well", () => {
  const striker = () => A({ weapon: { hit: 80 }, skills: [skill("True Strike", { chosen: true })] });
  assert.equal(play(striker(), B(), [91, 100, 100], first).points.length, 0);
  assert.equal(play(striker(), B(), [90, 100, 100], () => null).points.length, 1);

  const { result, points, plan } = play(striker(), B(), [1, 5, 1, 100, 100], first);
  assert.equal(plan.initiator.crit, 1);
  assert.equal(points[0].on, "critMiss");
  assert.equal(points[0].attack.margin, 4);
  assert.deepEqual(result.attacks[0].rerolls, [{ skill: "True Strike", roll: "crit", first: 5 }]);
  assert.equal(result.attacks[0].crit, true);
  assert.equal(result.attacks[0].damage, 27);
});

test("Odds Manipulator: any miss, a use for each; several answers are offered together, each once", () => {
  const lucky = () => A({ weapon: { hit: 80 }, skills: [skill("True Strike", { chosen: true }), skill("Odds Manipulator", { chosen: true })] });
  const { result, points } = play(lucky(), B(), [85, 83, 40, 100, 100], (point) => point.offers.at(-1).key);

  // Both at the first miss; the one that was taken is not offered again for the same attack
  assert.deepEqual(points.map((point) => point.offers.map((offer) => offer.skill)), [["True Strike", "Odds Manipulator"], ["True Strike"]]);
  assert.deepEqual(result.attacks[0].rerolls, [
    { skill: "Odds Manipulator", roll: "hit", first: 85 },
    { skill: "True Strike", roll: "hit", first: 83 }
  ]);
  assert.equal(result.attacks[0].hit, true);
  assert.deepEqual(result.initiator.spent, [{ id: "odds-manipulator", name: "Odds Manipulator" }]);

  // By any margin, and not once its uses are spent
  const wide = play(A({ weapon: { hit: 50 }, skills: [skill("Odds Manipulator", { chosen: true })] }), B(), [100, 100, 100], () => null);
  assert.equal(wide.points[0].attack.margin, 50);
  const spent = play(A({ weapon: { hit: 50 }, skills: [skill("Odds Manipulator", { chosen: true, used: 4 })] }), B(), [100, 100, 100], first);
  assert.equal(spent.points.length, 0);
});

/* -------------------------------------------- */
/*  A Hit Just Taken                            */
/* -------------------------------------------- */

const FIRE = { id: "t1", name: "Fire", category: "fire", might: 5, effect: "", uses: { value: 10, max: 10 } };
const THUNDER = { id: "t2", name: "Thunder", category: "thunder", might: 8, effect: "", uses: { value: 1, max: 20 } };

test("Manaward: two uses of a Tome it carries take that Tome's Might off the hit, once in a fight", () => {
  const warded = () => ({ ...B({ skills: [skill("Manaward", { chosen: true })] }), carried: [{ id: "B-weapon", name: "Iron Sword", category: "sword", might: 5, uses: { value: 40, max: 40 } }, FIRE, THUNDER] });
  const { result, points } = play(A({ stats: { spd: 14 } }), warded(), [1, 100, 100, 1, 100], first);
  assert.equal(points.length, 1);
  assert.equal(points[0].on, "struck");
  assert.equal(points[0].attack.damage, 9);

  // A Tome with a single use left is not offered, and a sword never is
  assert.deepEqual(points[0].offers.map(({ key, what, amount, cost, item }) => ({ key, what, amount, cost, item: item.name })), [
    { key: "Manaward|t1", what: "reduce", amount: 5, cost: 2, item: "Fire" }
  ]);
  assert.equal(result.attacks[0].damage, 4);
  assert.deepEqual(result.attacks[0].answers, [{ skill: "Manaward", by: "defender", on: "struck", what: "reduce", amount: 5, item: "Fire", cost: 2 }]);
  assert.deepEqual(result.defender.items, [{ id: "t1", spent: 2 }]);

  // The follow-up lands whole: the skill has answered in this fight
  assert.equal(result.attacks[2].damage, 9);
  assert.equal(result.defender.hp, 30 - 4 - 9);
});

test("Manaward: the Tome in hand may be the one spent, and nothing is offered for a hit that deals nothing", () => {
  const tome = { id: "held", name: "Fire", category: "fire", might: 5, range: "1-2", damageStat: "mag", uses: { value: 10, max: 10 } };
  const mage = { ...B({ weapon: tome, skills: [skill("Manaward", { chosen: true })] }), carried: [{ ...tome, effect: "" }] };
  const { result } = play(A(), mage, [1, 100, 100], first);
  assert.equal(result.attacks[0].damage, 4);
  assert.equal(result.defender.items, undefined);

  // Two uses for the answer, one for the counter-attack that missed, as every attack with a tome costs one
  assert.equal(result.defender.usesSpent, 3);

  const wall = { ...B({ stats: { def: 30 }, skills: [skill("Manaward", { chosen: true })] }), carried: [FIRE] };
  assert.equal(play(A(), wall, [1, 100, 100], first).points.length, 0);
});

/* -------------------------------------------- */
/*  A Critical Hit Just Landed                  */
/* -------------------------------------------- */

/** Units around the two: C next to A, D next to B, E far from both, and an ally of A beside it. */
function placed(a, b) {
  const others = (list) => list.map(([id, relation, distance]) => ({ id, name: id.toUpperCase(), relation, distance, hp: 10 }));
  return [
    { ...a, near: { id: "a", side: "player", tile: null, others: others([["b", "enemy", 1], ["c", "enemy", 1], ["f", "ally", 1], ["d", "enemy", 2], ["e", "enemy", 5]]) } },
    { ...b, near: { id: "b", side: "enemy", tile: null, others: others([["a", "enemy", 1], ["d", "ally", 1], ["c", "ally", 2], ["e", "ally", 4]]) } }
  ];
}

test("Chop Down: a critical hit may be dealt plain, for half its damage before defence to 2 enemies around", () => {
  const [a, b] = placed(A({ skills: [skill("Chop Down", { chosen: true })] }), B());
  const taken = play(a, b, [1, 1, 100], first);
  assert.equal(taken.points[0].on, "crit");
  assert.equal(taken.points[0].attack.damage, 27);
  assert.deepEqual(taken.points[0].offers.map(({ what, amount, others }) => ({ what, amount, others })), [{ what: "plain", amount: 7, others: 2 }]);
  const hit = taken.result.attacks[0];
  assert.equal(hit.crit, true);
  assert.equal(hit.plain, "Chop Down");
  assert.equal(hit.damage, 9);
  assert.deepEqual(taken.result.splashes, [{ skill: "Chop Down", by: "initiator", amount: 7, count: 2, units: [{ id: "c", name: "C" }, { id: "d", name: "D" }] }]);

  const passed = play(a, b, [1, 1, 100], () => null);
  assert.equal(passed.result.attacks[0].damage, 27);
  assert.equal(passed.result.splashes, undefined);

  // With no other enemy next to either, there is nothing to forgo the damage for
  assert.equal(play(A({ skills: [skill("Chop Down", { chosen: true })] }), B(), [1, 1, 100], first).points.length, 0);
});

test("Chop Down: a critical missed by 10 or less may deal half Atk to the target for 4 uses of the weapon", () => {
  const chopper = (uses = 40) => A({ weapon: { uses: { value: uses, max: 40 } }, skills: [skill("Chop Down", { chosen: true })] });
  const { result, points } = play(chopper(), B(), [1, 5, 100], first);
  assert.equal(points[0].on, "critMiss");
  assert.deepEqual(points[0].offers.map(({ what, amount, cost }) => ({ what, amount, cost })), [{ what: "harm", amount: 7, cost: 4 }]);
  assert.equal(result.attacks[0].damage, 9);
  assert.deepEqual(result.attacks[0].harm, [{ skill: "Chop Down", by: "initiator", to: "defender", amount: 7 }]);
  assert.equal(result.defender.hp, 30 - 9 - 7);
  assert.equal(result.initiator.usesSpent, 5);

  // Not by more than 10, and not with 4 uses or fewer left
  assert.equal(play(chopper(), B(), [1, 12, 100], first).points.length, 0);
  assert.equal(play(chopper(4), B(), [1, 5, 100], first).points.length, 0);
});

/* -------------------------------------------- */
/*  What Is Rolled by Itself                    */
/* -------------------------------------------- */

const closeCall = () => skill("Close Call", { nihil: true });

test("Close Call: a critical hit against the unit is rolled for, and lands without the damage of one", () => {
  const lucky = B({ stats: { luk: 30 }, skills: [closeCall()] });
  const keen = () => A({ weapon: { crit: 60 } });
  const plan = planExchange(keen(), lucky);
  assert.equal(plan.defender.chances.foil[0].chance, 30);
  assert.ok(plan.initiator.crit > 1);
  const { result, points } = play(keen(), lucky, [1, 1, 10, 100], first);
  assert.equal(points.length, 0);
  assert.equal(result.attacks[0].hit, true);
  assert.equal(result.attacks[0].crit, false);
  assert.equal(result.attacks[0].critFoiled, "Close Call");
  assert.equal(result.attacks[0].damage, 9);
  assert.deepEqual(result.attacks[0].procs, [{ skill: "Close Call", on: "foil", by: "defender", roll: 10, chance: 30, success: true, foils: "crit" }]);

  const unlucky = play(keen(), lucky, [1, 1, 31, 100], first);
  assert.equal(unlucky.result.attacks[0].crit, true);
});

test("Close Call: a skill of the foe that rolled to activate and did, and a block of the foe", () => {
  const eager = A({ skills: [made("Surge", [{ proc: { on: "attack", percent: 50 }, damage: 5 }])] });
  const lucky = B({ stats: { luk: 30 }, skills: [closeCall()] });
  const { result } = play(eager, lucky, [10, 20, 1, 100, 100], first);
  assert.deepEqual(result.attacks[0].procs.map(({ skill: name, success, foiled, foils, what }) => ({ name, success, foiled, foils, what })), [
    { name: "Surge", success: false, foiled: "Close Call", foils: undefined, what: undefined },
    { name: "Close Call", success: true, foiled: undefined, foils: "activation", what: "Surge" }
  ]);
  assert.equal(result.attacks[0].damage, 9);

  const shield = { id: "round", name: "Round Shield", ...readShield("Has a 40 + DEX/2% chance to block physical attacks, reducing them by 4. Adds 1 Weight during Attack Speed calculation. 30 Uses."), uses: { value: 30, max: 30 } };
  const blocked = play(A({ stats: { luk: 30 }, skills: [closeCall()] }), B({ shield }), [1, 100, 1, 10, 100], first);
  assert.equal(blocked.result.attacks[0].block.success, false);
  assert.equal(blocked.result.attacks[0].block.negated, "Close Call");
  assert.equal(blocked.result.attacks[0].damage, 9);
  assert.equal(blocked.result.defender.shield.spent, 0);
});

test("Close Call: an answer of a skill that is chosen when to activate is spent, and does nothing", () => {
  const { result } = play(A({ stats: { luk: 30 }, skills: [closeCall()] }), B({ skills: [skill("Capote", { chosen: true })] }), [1, 100, 10, 100], first);
  assert.equal(result.attacks[0].hit, true);
  assert.equal(result.attacks[0].damage, 9);
  assert.deepEqual(result.attacks[0].answers, [{ skill: "Capote", by: "defender", on: "landing", what: "dodge", foiled: "Close Call" }]);
  assert.deepEqual(result.defender.spent, [{ id: "capote", name: "Capote" }]);
});

test("Close Call: what the foe chose for the fight is rolled for before it is planned, and is spent all the same", () => {
  const mighty = () => A({ skills: [skill("Mighty Strike", { active: true })] });
  const lucky = () => B({ stats: { luk: 30 }, skills: [closeCall()] });
  const plan = planExchange(mighty(), lucky());
  assert.deepEqual(plan.initiator.chose, ["Mighty Strike"]);
  assert.ok(plan.initiator.damage > 9);
  const list = foilsBefore(plan);
  assert.deepEqual(list, [{ by: "defender", skill: "Close Call", chance: 30, sure: false, foils: "choose", what: "Mighty Strike" }]);

  const failed = settleFoils(list, () => 31);
  assert.equal(failed.foiled, null);
  assert.equal(failed.rolls[0].success, false);

  const { rolls, foiled } = settleFoils(list, () => 30);
  assert.deepEqual(rolls, [{ skill: "Close Call", on: "foil", by: "defender", roll: 30, chance: 30, success: true, foils: "choose", what: "Mighty Strike" }]);
  assert.deepEqual(foiled, { initiator: ["Mighty Strike"], defender: [], art: false });
  const again = planExchange(mighty(), lucky(), { foiled });
  assert.equal(again.initiator.damage, 9);
  assert.deepEqual(again.initiator.foiled, ["Mighty Strike"]);
  assert.deepEqual(again.initiator.declared.map((entry) => entry.name), ["Mighty Strike"]);
});

test("Close Call: a Combat Art of the foe is rolled for too, and does nothing where it is brought to nothing", () => {
  const art = { id: "art", name: "Sunder", might: 4, hit: 0, critical: 0, dodge: 0, critAvoid: 0, strikes: 1, effective: [], persist: false, noFollowUp: false, spare: false, reach: null, cost: { hp: 0, uses: 0 } };
  const artist = () => ({ ...A(), art });
  const lucky = () => B({ stats: { luk: 30 }, skills: [closeCall()] });
  const plan = planExchange(artist(), lucky());
  assert.equal(plan.initiator.damage, 13);
  const { foiled } = settleFoils(foilsBefore(plan), () => 1);
  assert.deepEqual(foiled, { initiator: [], defender: [], art: true });
  const again = planExchange(artist(), lucky(), { foiled });
  assert.equal(again.initiator.art, null);
  assert.equal(again.initiator.artFoiled.name, "Sunder");
  assert.equal(again.initiator.damage, 9);
});

test("Cancel: as the fight begins and with each attack, the foe's next attack is not made", () => {
  // Rolled as the fight begins: the first attack of the unit that started it is cancelled
  const guarded = play(A(), B({ skills: [skill("Cancel", { nihil: true })] }), [5, 100, 1, 100], first);
  assert.deepEqual(guarded.result.cancelled, [{ side: "initiator", skill: "Cancel", by: "defender" }]);
  assert.deepEqual(guarded.result.attacks.map((attack) => attack.side), ["defender"]);
  assert.equal(guarded.result.initiator.usesSpent, 0);

  // Rolled with an attack, whether or not that attack lands
  const striking = play(A({ skills: [skill("Cancel", { nihil: true })] }), B(), [100, 5, 100], first);
  assert.equal(striking.result.attacks.length, 1);
  assert.equal(striking.result.attacks[0].hit, false);
  assert.deepEqual(striking.result.cancelled, [{ side: "defender", skill: "Cancel", by: "initiator" }]);
});

test("Cancel: one attack waits to be cancelled at a time", () => {
  // Both of a faster unit's chances come before its foe's one attack: that one attack is cancelled, once
  const { result } = play(A({ stats: { spd: 14 }, skills: [skill("Cancel", { nihil: true })] }), B(), [100, 5, 1, 100, 5, 1, 100], first);
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "initiator"]);
  assert.equal(result.cancelled.length, 1);
});

test("Enervation: the target rolls its Hit rolls twice and takes the worse, from then on", () => {
  const sapper = A({ skills: [skill("Enervation", { nihil: true })] });
  const plan = planExchange(sapper, B());
  assert.equal(plan.initiator.chances.attack[0].chance, 5);

  // The chance comes, the attack lands; the counter-attack rolls 20 and 95, and misses by the 95
  const { result } = play(sapper, B(), [3, 1, 100, 20, 95], first);
  assert.equal(result.attacks[0].hit, true);
  assert.deepEqual(result.attacks[1].hitRolls, [20, 95]);
  assert.equal(result.attacks[1].hitRoll, 95);
  assert.equal(result.attacks[1].hit, false);
  const granted = result.granted.find((entry) => entry.to === "defender");
  assert.deepEqual(granted.change.effects, [{ rules: ["worstHit"] }]);
  assert.equal(granted.change.ends, "turnEnd");

  // Laid on a unit that is in its own turn it lasts until the end of the turn after this one
  const turned = play(B(), sapper, [1, 100, 3, 1, 100], first);
  assert.equal(turned.result.granted.find((entry) => entry.to === "initiator").change.turns, 2);
  assert.equal(granted.change.turns, 1);

  // And it holds in the fights the unit has while the change lasts
  const cursed = { ...B(), timed: [granted.change] };
  const next = play(cursed, A(), [10, 91, 100], first);
  assert.equal(next.plan.initiator.worst, true);
  assert.deepEqual(next.result.attacks[0].hitRolls, [10, 91]);
  assert.equal(next.result.attacks[0].hit, false);
});

test("Enervation: an attack that misses lays nothing on the target", () => {
  const { result } = play(A({ skills: [skill("Enervation", { nihil: true })] }), B(), [3, 100, 20, 100], first);
  assert.equal(result.granted, undefined);
  assert.equal(result.attacks[1].hitRolls, undefined);
});

/* -------------------------------------------- */
/*  An Ally That Comes                          */
/* -------------------------------------------- */

test("an ally that stands by answers the blow that would defeat a unit, as Guardian has it", () => {
  const standby = { defender: [{ key: "ally-1", skill: "Guardian", by: "Ally" }] };
  const frail = () => B({ hp: 5 });
  const taken = play(A(), frail(), [1, 100, 1, 100], first, { options: { standby } });
  assert.equal(taken.points[0].on, "fall");
  assert.equal(taken.points[0].side, "defender");
  assert.deepEqual(taken.points[0].offers, [{ key: "ally-1", skill: "Guardian", what: "save", by: "Ally" }]);
  assert.equal(taken.result.attacks.length, 1);
  assert.deepEqual(taken.result.attacks[0].saved, { skill: "Guardian", by: "Ally" });
  assert.equal(taken.result.defender.hp, 1);
  assert.equal(taken.result.defender.defeated, false);

  const passed = play(A(), frail(), [1, 100, 1, 100], () => null, { options: { standby } });
  assert.equal(passed.result.defender.defeated, true);

  // A blow that leaves the unit standing asks nobody
  assert.equal(play(A(), B(), [1, 100, 1, 100], first, { options: { standby } }).points.length, 0);
});

/* -------------------------------------------- */
/*  A Unit That Answers by Itself               */
/* -------------------------------------------- */

test("a unit that answers by itself keeps off a hit that would take a quarter of its HP, and rolls again", () => {
  const point = (what, attack, more = {}) => ({ on: "x", side: "defender", attack: { hitChance: 90, hp: 20, ...attack }, offers: [{ key: "k", skill: "S", what, ...more }] });
  assert.equal(answerAlone(point("dodge", { damage: 5 })), "k");
  assert.equal(answerAlone(point("dodge", { damage: 4 })), null);
  assert.equal(answerAlone(point("dodge", { damage: 4, hp: 4 })), "k");
  assert.equal(answerAlone(point("cancel", { damage: 9 })), "k");
  assert.equal(answerAlone(point("cancel", { damage: 9, hitChance: 0 })), null);
  assert.equal(answerAlone(point("dodgeMore", { damage: 9 }, { amount: 15 })), "k");
  assert.equal(answerAlone(point("reduce", { damage: 9 }, { amount: 5 })), "k");
  assert.equal(answerAlone(point("reduce", { damage: 0 }, { amount: 5 })), null);
  assert.equal(answerAlone(point("reroll", { damage: 0 })), "k");
  assert.equal(answerAlone(point("save", { damage: 30 })), "k");

  // What gives something up is left to a person
  for ( const what of ["end", "plain", "harm", "use"] ) assert.equal(answerAlone(point(what, { damage: 30 })), null);

  // Of several that lessen a hit, the one that takes the most off
  const two = { on: "struck", side: "defender", attack: { damage: 9, hp: 20, hitChance: 90 }, offers: [{ key: "small", what: "reduce", amount: 3 }, { key: "large", what: "reduce", amount: 8 }] };
  assert.equal(answerAlone(two), "large");
});

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

test("an answer that is written wrong is told of", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  assert.equal(wrong({ proc: { on: "landing", may: true }, dodge: true }), false);
  assert.equal(wrong({ proc: { on: "landing", may: true, stat: "dex" }, dodge: true }), true);
  assert.equal(wrong({ proc: { on: "hit", sure: true }, dodge: true }), true);
  assert.equal(wrong({ proc: { on: "attacked", may: true }, cancel: true }), false);
  assert.equal(wrong({ proc: { on: "struck", may: true }, cancel: true }), true);
  assert.equal(wrong({ proc: { on: "miss", may: true, within: 10 }, reroll: true }), false);
  assert.equal(wrong({ proc: { on: "hit", may: true, within: 10 } }), true);
  assert.equal(wrong({ proc: { on: "struck", sure: true }, costs: { weapon: 2 }, reduce: 3 }), true);
  assert.equal(wrong({ proc: { on: "struck", may: true }, costs: { item: ["magic"], uses: 2 }, reduce: { of: "itemMight" } }), false);
  assert.equal(wrong({ proc: { on: "struck", may: true }, reduce: { of: "itemMight" } }), true);
  assert.equal(wrong({ proc: { on: "foil", stat: "luk" }, foils: ["crit"] }), false);
  assert.equal(wrong({ proc: { on: "foil", stat: "luk" }, foils: ["everything"] }), true);
  assert.equal(wrong({ proc: { on: "foil", may: true }, foils: ["crit"] }), true);
  assert.equal(wrong({ proc: { on: "crit", may: true }, plain: true, splash: { percent: 50, targets: 2 } }), false);
  assert.equal(wrong({ proc: { on: "crit", may: true }, plain: true, splash: { percent: 50 } }), true);
  assert.equal(wrong({ proc: { on: "start", stat: "dex" }, cancels: 1 }), false);
  assert.equal(wrong({ proc: { on: "kill", stat: "dex" }, cancels: 1 }), true);
});

/**
 * Tests for the round of a fight (`module/rules/rounds.mjs`, `module/rules/combat.mjs`): who attacks first,
 * the attacks skills add, what each attack after the first gains or loses, rounds that are fought again, fights
 * of several rounds, and attacks made in answer from outside the usual order.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerAlone } from "../module/rules/answers.mjs";
import { checkAct } from "../module/rules/actions.mjs";
import { planExchange, playExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { checkRounds, countsEvery, lineUp, roundsOf, spanOf, speedSteps, staffFollows, stopsAlone, strikesAfter } from "../module/rules/rounds.mjs";
import { checkEffects } from "../module/rules/skills.mjs";
import { castStaff } from "../module/rules/staves.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/**
 * Play a fight with dice that come up as told, then always as `rest`. `decide` answers each point: with the key
 * of an offer, with "first" for the first offer, or with nothing to pass. The points that came up are told.
 */
function play(initiator, defender, rolls = [], decide = () => null, { rest = 100, distance = 1, rounds = null, options = {} } = {}) {
  const plan = planExchange(initiator, defender, { distance, rounds });
  const points = [];
  const { result, answers, used } = playExchange(plan, (index) => rolls[index] ?? rest, (point) => {
    points.push(point);
    const key = decide(point, points.length - 1);
    return (key === "first") ? point.offers[0].key : (key ?? null);
  }, options);
  return { plan, result, answers, points, used };
}

const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });
const FAST = { spd: 14 };
const BOW = { name: "Iron Bow", category: "bow", range: "2", might: 5 };
const sides = (result) => result.attacks.map((attack) => attack.side[0].toUpperCase()).join("");
const dealt = (result, side) => result.attacks.filter((attack) => attack.side === side).map((attack) => attack.damage);

// Every attack hits and none is critical: the Hit roll is 1 and the critical roll 100
const HITS = Array.from({ length: 400 }, (_, index) => ((index % 2) ? 100 : 1));

const STEP = ["Diversion", "Accost", "Bushwhack", "Deathmatch", "To the Death", "Thunderstorm", "Ravage", "Aquila", "Pursuit", "Strong Riposte",
  "Penetration", "Crusader's Ward", "Guard", "Beatdown", "Flèche", "Staff Mage", "Revenge", "Quickclaw", "Handgonne", "Arcane Rush"];

/* -------------------------------------------- */
/*  The Parts                                   */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of STEP ) {
    const entry = skill(name);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.ok(entry.effects.length > 0, name);
  }
});

test("a typing mistake in what reshapes a round does not pass silently", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  assert.ok(wrong({ extraAttack: { percent: 100, attacks: 1 } }), "a unit always makes one attack");
  assert.ok(wrong({ extraAttack: { percent: 100, follows: "yes" } }));
  assert.ok(wrong({ proc: { on: "attack", sure: true }, extraAttack: { percent: 100 } }), "always there");
  assert.ok(wrong({ speedLead: { damage: 1 } }), "a lead is counted in steps");
  assert.ok(wrong({ speedLead: { per: 3 } }), "a step gives something");
  assert.ok(wrong({ staffFollow: { speed: 3 } }));
  assert.ok(wrong({ proc: { on: "attack", stat: "dex" }, order: "first" }), "the order is changed as the fight begins");
  assert.ok(wrong({ proc: { on: "start", stat: "dex" }, order: "last" }));
  assert.ok(wrong({ proc: { on: "start", stat: "dex" }, cuts: { lone: 25 } }));
  assert.ok(wrong({ proc: { on: "attack", stat: "dex", from: 2 }, damage: 1 }), "what begins later is sure");
  assert.ok(wrong({ proc: { on: "attack", sure: true, from: 1 }, damage: 1 }));
  assert.ok(wrong({ proc: { on: "attack", sure: true, mounts: true }, damage: 1 }), "what mounts begins somewhere");
  assert.ok(wrong({ proc: { on: "struck", sure: true, every: 1 }, negate: 50 }));
  assert.ok(wrong({ proc: { on: "hit", perDamage: 3 }, remind: true }), "damage taken is known when struck");
  assert.ok(wrong({ proc: { on: "struck", perDamage: 3 }, attack: true, reduce: 2 }), "an attack at once is all it does");
  assert.ok(wrong({ proc: { on: "round", stat: "dex" } }), "the end of a round has the round fought again");
  assert.ok(wrong({ proc: { on: "round", stat: "dex" }, again: { most: 0 } }));
  assert.ok(wrong({ proc: { on: "round", may: true }, again: { most: 3 } }), "its owner may stop it, not start it");
  assert.ok(wrong({ proc: { on: "after", sure: true }, again: { most: 3 } }));
  assert.ok(wrong({ proc: { on: "attack", stat: "dex" }, sequence: [{}, { stat: "magic" }] }));
  assert.ok(wrong({ when: { inSight: false }, combat: { hit: 5 } }));
  assert.deepEqual(checkRounds({ proc: { on: "round", sure: true, faster: true, healthier: true }, again: { most: 40, stop: true } }), []);

  // A skill used as an action starts a fight of several rounds, and does nothing else to its target
  assert.deepEqual(checkAct({ target: { who: "enemy", within: "weapon" }, fight: { rounds: 5 } }), []);
  assert.deepEqual(checkAct({ target: { who: "enemy", within: "weapon" }, fight: { rounds: "fall" } }), []);
  assert.equal(checkAct({ target: { who: "enemy", within: "weapon" }, fight: { rounds: 1 } }).length, 1);
  assert.equal(checkAct({ target: { who: "ally", within: 1 }, fight: { rounds: 5 } }).length, 1);
  assert.equal(checkAct({ target: { who: "enemy", within: "weapon" }, fight: { rounds: 5 }, grip: true }).length, 1);
});

test("the attacks of a round are put in order: who attacks first, who presses on, who joins in", () => {
  const entry = (key, kind) => ({ key, kind });
  const round = [entry("initiator", "open"), entry("defender", "open"), entry("initiator", "follow"), entry("defender", "extra")];
  const told = (list) => list.map((item) => `${item.key[0]}:${item.kind}`).join(" ");
  assert.equal(told(lineUp(round)), "i:open d:open i:follow d:extra");
  assert.equal(told(lineUp(round, { first: "defender" })), "d:open i:open i:follow d:extra");
  assert.equal(told(lineUp(round, { pressing: ["initiator"] })), "i:open i:follow d:open d:extra");

  // A side that presses on without a follow-up makes one more attack right after its first
  const plain = [entry("initiator", "open"), entry("defender", "open")];
  const press = { initiator: [entry("initiator", "press")] };
  assert.equal(told(lineUp(plain, { pressing: ["initiator"], press })), "i:open i:press d:open");
  assert.equal(told(lineUp(round, { pressing: ["initiator"], press })), "i:open i:follow d:open d:extra", "its follow-up is what it makes there");

  // An attack a side joins in with: where its counter-attack would be, or right after its first
  const alone = [entry("initiator", "open"), entry("initiator", "follow")];
  const joins = { defender: [entry("defender", "join")] };
  assert.equal(told(lineUp(alone, { joins })), "i:open d:join i:follow");
  assert.equal(told(lineUp(round, { joins })), "i:open d:open d:join i:follow d:extra");

  // A side that makes no attack cannot attack first
  assert.equal(told(lineUp(alone, { first: "defender" })), "i:open i:follow");
});

test("small rules: steps of Attack Speed, every so many attacks, the rounds of a fight", () => {
  assert.equal(speedSteps(20, 8, 3), 2, "12 over, 4 of them for the follow-up, 8 left");
  assert.equal(speedSteps(12, 8, 3), 0);
  assert.equal(speedSteps(15, 8, 3), 1);
  assert.deepEqual([0, 1, 2, 3].map((before) => countsEvery(before, 2)), [false, true, false, true]);
  assert.equal(roundsOf(null), null);
  assert.deepEqual(roundsOf({ rounds: 5, skill: "Deathmatch" }), { count: 5, skill: "Deathmatch", until: null });
  assert.deepEqual(roundsOf({ rounds: "fall", skill: "To the Death" }, { most: 50 }), { count: 50, skill: "To the Death", until: "fall" });
  assert.equal(roundsOf({ rounds: 1 }), null);
});

/* -------------------------------------------- */
/*  Further Attacks                             */
/* -------------------------------------------- */

test("Ravage: a unit that would attack twice makes one more attack after all others", () => {
  const twice = planExchange(A({ stats: FAST, skills: [skill("Ravage")] }), B());
  assert.deepEqual(twice.order, ["initiator", "defender", "initiator", "initiator"]);
  assert.equal(twice.initiator.attacks, 3);
  assert.deepEqual(twice.kinds, ["open", "open", "follow", "extra"]);

  const once = planExchange(A({ skills: [skill("Ravage")] }), B());
  assert.deepEqual(once.order, ["initiator", "defender"]);
  assert.equal(once.initiator.attacks, 1);

  // A weapon that strikes twice attacks twice; and it counts on either side of a fight
  const brave = planExchange(A(), B({ weapon: { effect: "2x Strikes" }, skills: [skill("Ravage")] }));
  assert.deepEqual(brave.order, ["initiator", "defender", "defender", "defender"]);
  const { result } = play(A({ stats: FAST, skills: [skill("Ravage")] }), B(), HITS);
  assert.equal(sides(result), "IDII");
  assert.equal(result.defender.hp, 30 - 27);
});

test("an extra attack for a unit that follows up by its own Attack Speed, as Aquila has it", () => {
  const aquila = made("Aquila", [{ rules: ["sureFollowUp"] }, { extraAttack: { percent: 100, follows: true } }]);
  const slow = planExchange(A({ skills: [aquila] }), B());
  assert.deepEqual(slow.order, ["initiator", "defender", "initiator"], "a guaranteed follow-up, and no more");
  const fast = planExchange(A({ stats: FAST, skills: [aquila] }), B());
  assert.deepEqual(fast.order, ["initiator", "defender", "initiator", "initiator"], "one more attack on top of its own follow-up");
  assert.equal(fast.initiator.attacks, 3);
});

test("Beatdown: a weapon that strikes twice when initiating strikes twice whoever began the fight", () => {
  const gauntlets = { effect: "2x Strikes when initiating combat." };
  assert.deepEqual(planExchange(A(), B({ weapon: gauntlets })).order, ["initiator", "defender"]);
  assert.deepEqual(planExchange(A(), B({ weapon: gauntlets, skills: [skill("Beatdown")] })).order, ["initiator", "defender", "defender"]);
  assert.deepEqual(planExchange(A({ weapon: gauntlets, skills: [skill("Beatdown")] }), B()).order, ["initiator", "initiator", "defender"]);
});

test("Arcane Rush: a second attack at once that adds MAG and is resisted by RES", () => {
  const rush = () => A({ skills: [skill("Arcane Rush")] });
  // DEX 8 / 2 = 4%: the roll for it comes before the attack's own
  const { result } = play(rush(), B(), [4, 1, 100, 1, 100, 1, 100]);
  assert.equal(sides(result), "IID");
  assert.equal(result.attacks[0].damage, 9, "STR 10 + Might 5 - DEF 6");
  assert.equal(result.attacks[1].damage, 6, "MAG 4 + Might 5 - RES 3");
  assert.equal(result.attacks[1].added, true);
  assert.equal(result.initiator.usesSpent, 2, "each of the two costs a use");

  const failed = play(rush(), B(), [5, 1, 100, 1, 100]);
  assert.equal(sides(failed.result), "ID");

  // Not from 2 spaces, and not with a tome
  assert.equal(planExchange(A({ weapon: BOW, skills: [skill("Arcane Rush")] }), B(), { distance: 2 }).initiator.chances.attack.length, 0);
  assert.equal(planExchange(A({ weapon: { category: "fire", damageStat: "mag" }, skills: [skill("Arcane Rush")] }), B()).initiator.chances.attack.length, 0);
});

/* -------------------------------------------- */
/*  Numbers That Change With Each Attack        */
/* -------------------------------------------- */

test("Pursuit: a stacking +1 Might and +3 Critical on each attack after the first, when initiating", () => {
  const brave = { effect: "2x Strikes" };
  const plan = planExchange(A({ stats: FAST, weapon: brave, skills: [skill("Pursuit")] }), B());
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.damage), [9, 10, 11, 12]);
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.crit), [1, 4, 7, 10]);
  assert.equal(plan.initiator.damage, 9, "the first attack is as it was");

  const { result, used } = play(A({ stats: FAST, weapon: brave, skills: [skill("Pursuit")] }), B({ hp: 60, hpMax: 60 }), HITS);
  assert.equal(sides(result), "IIDII");
  assert.deepEqual(dealt(result, "initiator"), [9, 10, 11, 12]);
  assert.deepEqual(result.attacks.filter((attack) => attack.side === "initiator").map((attack) => attack.critChance), [1, 4, 7, 10]);
  assert.ok(used <= rollBudget(plan));

  // Not when it is attacked; Strong Riposte is the same for the unit that is
  assert.deepEqual(planExchange(A(), B({ stats: FAST, skills: [skill("Pursuit")] })).defender.blows.map((blow) => blow.damage), [9, 9]);
  assert.deepEqual(planExchange(A(), B({ stats: FAST, skills: [skill("Strong Riposte")] })).defender.blows.map((blow) => blow.damage), [9, 10]);
  assert.deepEqual(planExchange(A({ stats: FAST, skills: [skill("Strong Riposte")] }), B()).initiator.blows.map((blow) => blow.damage), [9, 9]);
});

test("Pursuit counts every attack its unit makes, also one a skill adds", () => {
  const { result } = play(A({ stats: FAST, skills: [skill("Pursuit"), skill("Ravage")] }), B({ hp: 60, hpMax: 60 }), HITS);
  assert.equal(sides(result), "IDII");
  assert.deepEqual(dealt(result, "initiator"), [9, 10, 11]);
});

test("Penetration: attacks past the first ignore a third of the foe's defence", () => {
  const plan = planExchange(A({ stats: FAST, skills: [skill("Penetration")] }), B());
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.damage), [9, 11], "DEF 6: 2 of it ignored");
  const { result } = play(A({ stats: FAST, skills: [skill("Penetration")] }), B(), HITS);
  assert.deepEqual(dealt(result, "initiator"), [9, 11]);

  // What is left of the defence is rounded down
  const tough = planExchange(A({ stats: FAST, skills: [skill("Penetration")] }), B({ stats: { def: 10 } }));
  assert.deepEqual(tough.initiator.blows.map((blow) => blow.damage), [5, 9], "DEF 10: 6 left of it");
});

test("Crusader's Ward: half damage from every attack after the first, or a quarter less from a lone attack", () => {
  const ward = () => B({ skills: [skill("Crusader's Ward")] });
  // DEX 8%: rolled as the fight begins
  const doubled = play(A({ stats: FAST }), ward(), [8, ...HITS]);
  assert.equal(sides(doubled.result), "IDI");
  assert.deepEqual(dealt(doubled.result, "initiator"), [9, 4]);
  assert.equal(doubled.result.opening[0].skill, "Crusader's Ward");

  const lone = play(A(), ward(), [8, ...HITS]);
  assert.deepEqual(dealt(lone.result, "initiator"), [6], "9 less a quarter, rounded down");

  const failed = play(A({ stats: FAST }), ward(), [9, ...HITS]);
  assert.deepEqual(dealt(failed.result, "initiator"), [9, 9]);

  // Not for the unit that starts the fight
  assert.equal(planExchange(A({ skills: [skill("Crusader's Ward")] }), B()).initiator.chances.start.length, 0);
});

test("Guard: every second attack made against the unit deals half, counted through its turn", () => {
  const guard = (attacked = 0) => ({ ...B({ hp: 60, hpMax: 60, skills: [skill("Guard")] }), attacked });
  const plan = planExchange(A({ stats: FAST }), guard());
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.damage), [9, 4]);
  assert.deepEqual(plan.initiator.blows[1].eased, ["Guard"]);

  const first = play(A({ stats: FAST }), guard(), HITS);
  assert.deepEqual(dealt(first.result, "initiator"), [9, 4]);
  assert.equal(first.result.defender.faced, 2);
  assert.equal(first.result.initiator.faced, undefined, "only a unit whose skill counts them is told");

  // With one attack already made against it this turn, the first of this fight is the second
  const later = play(A({ stats: FAST }), guard(1), HITS);
  assert.deepEqual(dealt(later.result, "initiator"), [4, 9]);
  assert.deepEqual(planExchange(A({ stats: FAST }), guard(1)).initiator.blows.map((blow) => blow.damage), [4, 9]);

  // An attack that misses is counted all the same
  const missed = play(A({ stats: FAST, weapon: { effect: "2x Strikes" } }), guard(), [100, 1, 100, 1, 100, 1, 100, 1, 100]);
  assert.deepEqual(dealt(missed.result, "initiator"), [0, 4, 9, 4]);
});

test("Flèche: damage, Hit and Critical for every 3 Attack Speed over a foe the unit follows up on", () => {
  const fleche = (spd) => A({ stats: { spd }, skills: [skill("Flèche")] });
  const plain = planExchange(A({ stats: { spd: 20 } }), B());
  const plan = planExchange(fleche(20), B());
  assert.deepEqual(plan.initiator.led, { skill: "Flèche", damage: 2, hit: 6, critical: 6 });
  assert.equal(plan.initiator.damage, plain.initiator.damage + 2);
  assert.equal(plan.initiator.crit, plain.initiator.crit + 6);

  // 12 Attack Speed is enough to follow up, and no more; a slower unit gains nothing, nor one that is attacked
  assert.equal(planExchange(fleche(12), B()).initiator.led, null);
  assert.equal(planExchange(fleche(10), B()).initiator.led, null);
  assert.equal(planExchange(A(), B({ stats: { spd: 20 }, skills: [skill("Flèche")] })).defender.led, null);
});

/* -------------------------------------------- */
/*  Who Strikes First                           */
/* -------------------------------------------- */

test("Diversion: the unit that is attacked may attack first", () => {
  const diversion = () => B({ skills: [skill("Diversion")] });
  // LUK 5%
  const taken = play(A({ stats: FAST }), diversion(), [5, ...HITS]);
  assert.equal(sides(taken.result), "DII");
  const failed = play(A({ stats: FAST }), diversion(), [6, ...HITS]);
  assert.equal(sides(failed.result), "IDI");

  // A unit that cannot answer rolls nothing, nor does one that starts the fight
  assert.equal(planExchange(A({ weapon: BOW }), diversion(), { distance: 2 }).defender.chances.start.length, 0);
  assert.equal(planExchange(A({ skills: [skill("Diversion")] }), B()).initiator.chances.start.length, 0);
});

test("Thunderstorm: the follow-up before the counter-attack, or one more attack, with +15 Hit and Critical and +3 damage", () => {
  const storm = (stats = {}) => A({ stats, skills: [skill("Thunderstorm")] });
  // DEX 8 / 2 = 4%
  const fast = play(storm(FAST), B(), [4, ...HITS]);
  assert.equal(sides(fast.result), "IID");
  assert.deepEqual(dealt(fast.result, "initiator"), [12, 12]);
  assert.equal(fast.result.attacks[0].critChance, 16);
  assert.equal(fast.result.attacks[1].added, undefined, "its own follow-up");

  const slow = play(storm(), B(), [4, ...HITS]);
  assert.equal(sides(slow.result), "IID");
  assert.equal(slow.result.attacks[1].added, true);
  assert.equal(slow.result.attacks[1].skill, "Thunderstorm");
  assert.equal(slow.result.initiator.usesSpent, 2);

  const failed = play(storm(FAST), B(), [5, ...HITS]);
  assert.equal(sides(failed.result), "IDI");
  assert.deepEqual(dealt(failed.result, "initiator"), [9, 9]);

  // Against a foe that cannot answer the additional attack and the bonus still come
  const ranged = play(A({ weapon: BOW, skills: [skill("Thunderstorm")] }), B(), [4, ...HITS], () => null, { distance: 2 });
  assert.equal(sides(ranged.result), "II");
});

/* -------------------------------------------- */
/*  Rounds That Repeat                          */
/* -------------------------------------------- */

test("Accost: the round is fought again on a chance, with its own dice, until the chance fails", () => {
  const accost = () => A({ hp: 60, hpMax: 60, skills: [skill("Accost")] });
  // DEX 8 / 1.5 = 5%. Round 1: two attacks, four dice; then the roll for another round
  const rolls = [1, 100, 1, 100, 5, 1, 100, 1, 100, 5, 1, 100, 1, 100, 6];
  const { result, used } = play(accost(), B({ hp: 60, hpMax: 60 }), rolls);
  assert.equal(sides(result), "IDIDID");
  assert.deepEqual(result.attacks.map((attack) => attack.round ?? 1), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(result.rounds, [{ round: 2, skill: "Accost", by: "initiator" }, { round: 3, skill: "Accost", by: "initiator" }]);
  assert.deepEqual(result.turning.map((roll) => [roll.roll, roll.chance, roll.success, roll.round]), [[5, 5, true, 1], [5, 5, true, 2], [6, 5, false, 3]]);
  assert.equal(used, 15);
  assert.equal(result.defender.hp, 60 - 27);
  assert.equal(result.initiator.usesSpent, 3, "every round wears the weapon");
  assert.equal(result.stopped, undefined);
});

test("Accost: its owner may end the fight before a further round, and a unit that falls ends it", () => {
  const accost = () => A({ hp: 60, hpMax: 60, skills: [skill("Accost")] });
  const rolls = [1, 100, 1, 100, 5, 1, 100, 1, 100, 5, 1, 100, 1, 100, 5];

  // Asked before the second round, with where the two stand; it passes, and stops before the third
  const { result, points, answers } = play(accost(), B({ hp: 60, hpMax: 60 }), rolls, (point, index) => (index === 1 ? "first" : null));
  assert.equal(points.length, 2);
  assert.equal(points[0].on, "round");
  assert.equal(points[0].side, "initiator");
  assert.equal(points[0].attack, null);
  assert.deepEqual(points[0].offers, [{ key: "Accost", skill: "Accost", id: null, what: "stop" }]);
  assert.deepEqual(points[0].round, { next: 2, hp: 51, foeHp: 51, deals: 9, takes: 9 });
  assert.deepEqual(points[1].round, { next: 3, hp: 42, foeHp: 42, deals: 9, takes: 9 });
  assert.deepEqual(answers, [null, "Accost"]);
  assert.equal(sides(result), "IDID");
  assert.deepEqual(result.stopped, { side: "initiator", skill: "Accost", round: 2 });
  assert.equal(result.fled, undefined, "it earns what the fight earned");

  // A foe that falls in the second round ends the fight there: nothing more is rolled
  const fatal = play(accost(), B({ hp: 18, hpMax: 30 }), rolls);
  assert.equal(sides(fatal.result), "IDI");
  assert.equal(fatal.result.defender.defeated, true);
  assert.equal(fatal.used, 7);

  // It is for either side of a fight
  const defending = play(B({ hp: 60, hpMax: 60 }), accost(), [1, 100, 1, 100, 5, 1, 100, 1, 100, 6]);
  assert.equal(sides(defending.result), "IDID");
  assert.deepEqual(defending.result.rounds, [{ round: 2, skill: "Accost", by: "defender" }]);
});

test("a round is fought again no more often than the skill says, and never after one in which nobody attacked", () => {
  const twice = made("Twice", [{ proc: { on: "round", sure: true }, again: { most: 2 } }]);
  const { result } = play(A({ hp: 99, hpMax: 99, skills: [twice] }), B({ hp: 99, hpMax: 99 }), HITS);
  assert.equal(result.attacks.at(-1).round, 3);
  assert.equal(result.rounds.length, 2);

  // Both weapons break in the first round: the second has no attack in it, and there is no third
  const last = { uses: { value: 1, max: 40 } };
  const forever = made("Forever", [{ proc: { on: "round", sure: true }, again: { most: 30 } }]);
  const broke = play(A({ hp: 99, hpMax: 99, weapon: last, skills: [forever] }), B({ hp: 99, hpMax: 99, weapon: last }), HITS);
  assert.equal(sides(broke.result), "ID");
  assert.equal(broke.result.rounds.length, 1);
});

test("Bushwhack: the round again while the unit is faster and has more HP than its foe", () => {
  const bush = (hp, stats = FAST) => A({ hp, hpMax: 60, stats, skills: [skill("Bushwhack")] });
  // 40 HP against 30: after each round 31 / 12 (two hits of 9 for one), then the foe falls in the second
  const { result } = play(bush(40), B(), HITS);
  assert.equal(sides(result), "IDIIDI");
  assert.equal(result.defender.defeated, true);
  assert.deepEqual(result.rounds, [{ round: 2, skill: "Bushwhack", by: "initiator" }]);

  // With no more HP than its foe as the round ends there is no further round, nor for a unit that is no faster
  const weaker = play(bush(20), B({ hp: 60, hpMax: 60 }), HITS);
  assert.equal(sides(weaker.result), "IDI");
  assert.equal(planExchange(bush(40, {}), B()).initiator.chances.round.length, 0);
});

test("a unit nobody is asked for ends a fight that the next round would lose", () => {
  assert.equal(stopsAlone({ hp: 9, foeHp: 30, deals: 9, takes: 9 }), true);
  assert.equal(stopsAlone({ hp: 9, foeHp: 9, deals: 9, takes: 9 }), false, "it would defeat its foe");
  assert.equal(stopsAlone({ hp: 10, foeHp: 30, deals: 9, takes: 9 }), false);
  const point = (round) => ({ index: 0, on: "round", side: "initiator", attack: null, offers: [{ key: "Accost", skill: "Accost", what: "stop" }], round });
  assert.equal(answerAlone(point({ next: 2, hp: 9, foeHp: 30, deals: 9, takes: 9 })), "Accost");
  assert.equal(answerAlone(point({ next: 2, hp: 30, foeHp: 30, deals: 9, takes: 9 })), null);
});

test("a fight of 5 rounds, as Deathmatch starts one, and one that goes on until a unit falls", () => {
  const five = { rounds: 5, skill: "Deathmatch" };
  const { plan, result, used } = play(A({ hp: 99, hpMax: 99 }), B({ hp: 99, hpMax: 99 }), HITS, () => null, { rounds: five });
  assert.deepEqual(plan.rounds, { count: 5, skill: "Deathmatch", until: null });
  assert.equal(sides(result), "IDIDIDIDID");
  assert.deepEqual(result.attacks.map((attack) => attack.round ?? 1), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(result.rounds.length, 4);
  assert.equal(result.rounds[0].skill, "Deathmatch");
  assert.equal(result.defender.hp, 99 - 45);
  assert.equal(result.initiator.usesSpent, 5);
  assert.ok(used <= rollBudget(plan), `rolled ${used} of ${rollBudget(plan)}`);

  // It ends when a unit falls
  const short = play(A({ hp: 99, hpMax: 99 }), B({ hp: 20, hpMax: 30 }), HITS, () => null, { rounds: five });
  assert.equal(sides(short.result), "IDIDI");
  assert.equal(short.result.defender.defeated, true);

  // Until a unit falls: as many rounds as that takes
  const death = play(A({ hp: 99, hpMax: 99 }), B({ hp: 60, hpMax: 60 }), HITS, () => null, { rounds: { rounds: "fall", skill: "To the Death" } });
  assert.equal(death.plan.rounds.until, "fall");
  assert.equal(death.result.defender.defeated, true);
  assert.equal(death.result.attacks.at(-1).round, 7);
  assert.equal(death.result.attacks.length, 13);

  // A fight nobody can attack in has no rounds
  assert.equal(planExchange(A({ weapon: null }), B(), { rounds: five }).rounds, undefined);
});

test("what a fight has once it has once, however many rounds it runs to, and what counts attacks counts on", () => {
  const mighty = { ...skill("Mighty Strike", { active: true }) };
  const { result } = play(A({ hp: 99, hpMax: 99, skills: [mighty, skill("Pursuit")] }), B({ hp: 99, hpMax: 99 }), HITS, () => null, { rounds: { rounds: 3 } });
  assert.deepEqual(dealt(result, "initiator"), [13, 10, 11], "Mighty Strike for the first attack alone; Pursuit mounts through the rounds");
});

/* -------------------------------------------- */
/*  Attacks Made in Answer                      */
/* -------------------------------------------- */

test("Revenge: a unit that is hit may attack at once, at 3% for each point of damage taken, with +15 Hit", () => {
  const revenge = (options = {}) => B({ skills: [skill("Revenge")], ...options });
  // A hits for 9: 27%. Hit roll, critical roll, then the roll for Revenge
  const { plan, result, used } = play(A(), revenge(), [1, 100, 27, 1, 100, 1, 100]);
  assert.equal(sides(result), "IDD");
  const reply = result.attacks[1];
  assert.equal(reply.added, true);
  assert.equal(reply.skill, "Revenge");
  assert.equal(reply.hitChance, Math.min(plan.defender.hit + 15, 100));
  assert.equal(result.attacks[2].hitChance, plan.defender.hit, "the +15 is for that attack alone");
  const told = result.attacks[0].procs.find((proc) => proc.skill === "Revenge");
  assert.deepEqual([told.roll, told.chance, told.success], [27, 27, true]);
  assert.ok(used <= rollBudget(plan));

  const failed = play(A(), revenge(), [1, 100, 28, 1, 100]);
  assert.equal(sides(failed.result), "ID");

  // A miss rolls nothing, a unit that cannot attack from there makes none, and an attack made that way sets off no other
  const missed = play(A(), revenge(), [100, 1, 100]);
  assert.equal(sides(missed.result), "ID");
  assert.equal(missed.used, 3);
  const ranged = play(A({ weapon: BOW }), revenge(), [1, 100, 1], () => null, { distance: 2 });
  assert.equal(sides(ranged.result), "I");
  const both = play(A({ skills: [skill("Revenge")] }), revenge(), [1, 100, 1, 1, 100, 1, 100, 1, 1, 100]);
  assert.equal(sides(both.result), "IDDI", "A answers the counter-attack, not the attack B made in answer");
});

test("Revenge is the initiator's too, and a unit that fell makes no attack", () => {
  const fatal = play(A(), B({ hp: 9, skills: [skill("Revenge")] }), [1, 100, 1]);
  assert.equal(sides(fatal.result), "I");
  assert.equal(fatal.used, 2);
});

test("Quickclaw: an attack with damage equal to STR when attacked from 2-3 range", () => {
  const cat = (skills = []) => B({ skills: [skill("Quickclaw"), ...skills] });
  // DEX 8%
  const { plan, result } = play(A({ weapon: BOW }), cat(), [8, ...HITS], () => null, { distance: 2 });
  assert.equal(plan.defender.blocked, "outOfRange");
  assert.equal(sides(result), "ID");
  const claw = result.attacks[1];
  assert.equal(claw.added, true);
  assert.equal(claw.skill, "Quickclaw");
  assert.equal(claw.damage, 4, "STR 10 - DEF 6");
  assert.deepEqual(claw.own, { hit: 90, might: 0 });
  assert.equal(result.defender.usesSpent, 0, "it is not made with the weapon");

  const failed = play(A({ weapon: BOW }), cat(), [9, ...HITS], () => null, { distance: 2 });
  assert.equal(sides(failed.result), "I");

  // A unit that can answer makes it right after its first attack
  const counter = made("Distant Counter", [{ rules: ["distantCounter"] }]);
  const able = play(A({ weapon: BOW }), cat([counter]), [8, ...HITS], () => null, { distance: 2 });
  assert.equal(sides(able.result), "IDD");
  assert.equal(able.result.attacks[1].added, undefined);
  assert.equal(able.result.attacks[2].skill, "Quickclaw");

  // Not from next to it, not from 4 spaces, and not for the unit that starts the fight
  assert.equal(planExchange(A(), cat()).defender.chances.start.length, 0);
  assert.equal(planExchange(A({ weapon: { ...BOW, range: "2-4" } }), cat(), { distance: 4 }).defender.chances.start.length, 0);
});

test("Handgonne: one counter-attack by a unit whose weapon does not reach, within its Line of Sight", () => {
  const gunner = (options = {}) => B({ weapon: BOW, skills: [skill("Handgonne")], ...options });
  // DEX 8 / 2 = 4%
  const { plan, result } = play(A({ stats: FAST }), gunner(), [4, ...HITS]);
  assert.equal(plan.defender.blocked, "outOfRange");
  assert.equal(plan.defender.joins, true);
  assert.equal(sides(result), "IDI");
  assert.equal(result.attacks[1].skill, "Handgonne");
  assert.equal(result.attacks[1].damage, 9);
  assert.equal(result.defender.usesSpent, 1, "it is made with the weapon in hand");

  const failed = play(A({ stats: FAST }), gunner(), [5, ...HITS]);
  assert.equal(sides(failed.result), "II");

  // Not for a unit that can answer, not beyond its Line of Sight, not without a weapon to attack with
  assert.equal(planExchange(A({ weapon: BOW }), gunner(), { distance: 2 }).defender.chances.start.length, 0);
  const far = { ...BOW, range: "2-9" };
  assert.equal(planExchange(A({ weapon: far }), B({ skills: [skill("Handgonne")] }), { distance: 6 }).defender.chances.start.length, 1);
  assert.equal(planExchange(A({ weapon: far }), B({ skills: [skill("Handgonne")] }), { distance: 7 }).defender.chances.start.length, 0);
  assert.equal(planExchange(A(), gunner({ weapon: { ...BOW, uses: { value: 0, max: 40 } } })).defender.chances.start.length, 0);
  assert.equal(planExchange(A(), B({ weapon: null, skills: [skill("Handgonne")] })).defender.chances.start.length, 0);
});

/* -------------------------------------------- */
/*  Staves                                      */
/* -------------------------------------------- */

test("Staff Mage: an Offensive Staff is cast again by a unit fast enough, within its limits", () => {
  const follow = { haste: 3 };
  assert.equal(staffFollows({ follow, speed: 9, foeSpeed: 8 }), true, "1 + 3 HST is the 4 a follow-up takes");
  assert.equal(staffFollows({ follow, speed: 8, foeSpeed: 8 }), false);
  assert.equal(staffFollows({ follow: null, speed: 20, foeSpeed: 8 }), false, "not without the skill");
  assert.equal(staffFollows({ follow, speed: 20, foeSpeed: 8, area: true }), false, "a staff for each enemy in range never doubles");
  assert.equal(staffFollows({ follow, speed: 20, foeSpeed: 8, status: true, landed: true }), false, "a status staff that hit does not");
  assert.equal(staffFollows({ follow, speed: 20, foeSpeed: 8, status: true, landed: false }), true, "one that missed does");
  assert.equal(staffFollows({ follow, speed: 20, foeSpeed: 8, status: false, landed: true }), true);
});

test("Staff Mage: the second cast rolls its own hit", () => {
  const caster = (skills) => ({ name: "Mage", hp: 20, hpMax: 20, stats: { mag: 10, dex: 8, spd: 12, luk: 5 }, skills, staffHit: 80, attackSpeed: 12 });
  const target = { name: "Foe", hp: 20, hpMax: 20, stats: {}, skills: [], enemy: true, staffAvoid: 20, attackSpeed: 8 };
  const sleep = { name: "Sleep", effect: "Target enemy unit is afflicted with Sleep for 3 turns.", range: "1-MAG/2", hit: 70 };
  const rolls = (list) => {
    let at = 0;
    return () => list[at++];
  };

  // Hit 80 - Avoid 20 - 2 for each of 2 tiles = 56. A status staff that hit is not cast again
  const landed = castStaff({ staff: sleep, caster: caster([skill("Staff Mage")]), target, distance: 2, d100: rolls([56, 1]), rules: {} });
  assert.equal(landed.casts.length, 1);
  assert.equal(landed.follow, null);

  // One that missed is, and the second cast rolls for itself
  const missed = castStaff({ staff: sleep, caster: caster([skill("Staff Mage")]), target, distance: 2, d100: rolls([57, 10]), rules: {} });
  assert.equal(missed.casts.length, 2);
  assert.deepEqual(missed.casts.map((cast) => cast.hit.success), [false, true]);
  assert.equal(missed.casts[1].follow, true);
  assert.equal(missed.follow, "Staff Mage");
  assert.equal(missed.missed, false);

  // Not without the skill, and not for a unit that is too slow
  assert.equal(castStaff({ staff: sleep, caster: caster([]), target, distance: 2, d100: rolls([57, 10]), rules: {} }).casts.length, 1);
  const slow = { ...caster([skill("Staff Mage")]), attackSpeed: 8 };
  assert.equal(castStaff({ staff: sleep, caster: slow, target, distance: 2, d100: rolls([57, 10]), rules: {} }).casts.length, 1);

  // A staff that deals damage is cast again though it hit
  const bolt = { name: "Smite", effect: "Target enemy unit takes damage lowered by RES.", range: "1-MAG/2", hit: 70 };
  const twice = castStaff({ staff: bolt, caster: caster([skill("Staff Mage")]), target, distance: 2, d100: rolls([1, 1]), rules: {} });
  assert.equal(twice.casts.length, 2);
});

/* -------------------------------------------- */
/*  The Forecast                                */
/* -------------------------------------------- */

test("the forecast says in a few signs what the attacks after the first deal", () => {
  const blows = (...list) => list.map((damage) => ({ damage }));
  assert.equal(strikesAfter(blows(9)), "");
  assert.equal(strikesAfter(blows(9, 9)), "× 2");
  assert.equal(strikesAfter(blows(9, 10)), "+ 10");
  assert.equal(strikesAfter(blows(9, 10, 11, 12)), "+ 10 + 11 + 12");
  assert.equal(strikesAfter(blows(9, 10, 11, 12, 13)), "… 13 (× 5)");
  assert.equal(strikesAfter([], 3), "× 3", "a plan that lists no attacks still says how many");

  // What a unit that attacks twice with Pursuit shows, and one against a foe with Guard
  assert.equal(strikesAfter(planExchange(A({ stats: FAST, skills: [skill("Pursuit")] }), B()).initiator.blows), "+ 10");
  assert.equal(strikesAfter(planExchange(A({ stats: FAST }), B({ skills: [skill("Guard")] })).initiator.blows), "+ 4");
  assert.equal(strikesAfter(planExchange(A({ stats: FAST }), B()).initiator.blows), "× 2");
});

test("the forecast of a fight of several rounds counts the attacks until a unit would fall", () => {
  const told = (plan) => spanOf(plan).map((entry) => entry.key[0]).join("");
  const five = { rounds: 5, skill: "Deathmatch" };
  assert.equal(told(planExchange(A({ hp: 99, hpMax: 99 }), B({ hp: 99, hpMax: 99 }), { rounds: five })), "ididididid");
  assert.equal(told(planExchange(A({ hp: 99, hpMax: 99 }), B({ hp: 20, hpMax: 30 }), { rounds: five })), "ididi", "B falls to the third hit");
  assert.equal(told(planExchange(A({ hp: 99, hpMax: 99 }), B({ hp: 99, hpMax: 99 }))), "id", "one round without it");

  // A fight in which nothing would be dealt is not counted on
  const walls = { def: 40 };
  assert.equal(told(planExchange(A({ stats: walls }), B({ stats: walls }), { rounds: { rounds: "fall" } })), "id");
});

/* -------------------------------------------- */
/*  Dice                                        */
/* -------------------------------------------- */

test("a fight that is rolled out without answers asks nobody, and is what it was with every answer passed", () => {
  const accost = () => A({ hp: 60, hpMax: 60, skills: [skill("Accost")] });
  const rolls = [1, 100, 1, 100, 5, 1, 100, 1, 100, 6];
  const plan = planExchange(accost(), B({ hp: 60, hpMax: 60 }));
  let used = 0;
  const plain = resolveExchange(plan, () => rolls[used++] ?? 100);
  const passed = play(accost(), B({ hp: 60, hpMax: 60 }), rolls);
  assert.equal(plain.pending, undefined);
  assert.deepEqual(plain.attacks, passed.result.attacks);
});

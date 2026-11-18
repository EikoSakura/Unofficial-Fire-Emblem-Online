/**
 * Tests for what a unit chooses before a fight (`module/rules/choices.mjs`) and what a fight the system rolls
 * makes of it (`module/rules/combat.mjs`): one combat number traded for another, something spent for damage,
 * one attack in place of several, no Weight for Attack Speed, a cap on what a hit takes, a hit that counts as
 * a critical hit, another defence to resist an attack, the foe's bonuses cancelled or turned around, a foe that
 * stops skills that are chosen, Parity, and cooldowns that are shorter.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bonusesOf, checkFoeBonus, checkSingle, checkSpend, checkTrade, choosesForFight, cooldownWith, fightPicks, forAttacksOnly, loneAttack,
  rearms, settleBonuses, settleSpends, settleTrades, stepPick
} from "../module/rules/choices.mjs";
import { planExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { spendSkill } from "../module/rules/skill-usage.mjs";
import { checkEffects, skillTotals } from "../module/rules/skills.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/** Roll out a fight with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], { rest = 100, distance = 1, ground = null } = {}) {
  const plan = planExchange(initiator, defender, { distance, ground });
  let rolled = 0;
  const result = resolveExchange(plan, () => {
    rolled += 1;
    return rolls[rolled - 1] ?? rest;
  });
  assert.ok(rolled <= rollBudget(plan), `rolled ${rolled} of ${rollBudget(plan)}`);
  return { plan, result, rolled };
}

/** A skill that is switched on. */
const on = (name, options = {}) => skill(name, { active: true, ...options });

/** A foe that never answers, so that a fight is the attacks of the unit that starts it. */
const quiet = (options = {}) => fighter({ name: "B", hp: 40, hpMax: 40, weapon: null, ...options });

/*
 * The fighter of the fixtures: STR 10, MAG 4, DEF 6, RES 3, DEX 8, SPD 8, LUK 5, CON 8, an Iron Sword of 5 Might,
 * 90 Hit and 5 Weight. Against its like that is Accuracy 111, Dodge 21, Critical 6, Critical Avoid 5, Atk 15:
 * 90 Hit, 1 Crit, 9 damage.
 */

/* -------------------------------------------- */
/*  Trades                                      */
/* -------------------------------------------- */

test("settleTrades: half of one number for another doubled, steps picked or all at once, and the rest given up", () => {
  const have = { accuracy: 111, critical: 6, dodge: 21, endurance: 2, haste: 1 };
  const gamble = settleTrades([{ skill: "Gamble", trade: { give: { accuracy: "half" }, gain: { critical: "double" } } }], have);
  assert.deepEqual(gamble.combat, { hit: -56, critical: 6, dodge: 0, damage: 0 });
  assert.deepEqual(gamble.sources, [{ name: "Gamble", stats: {}, combat: { hit: -56, critical: 6 } }]);

  const reckless = [
    { skill: "Reckless Charge", trade: { id: "end", give: { endurance: 1 }, gain: { haste: 1 }, pick: true }, steps: null },
    { skill: "Reckless Charge", trade: { id: "dodge", give: { dodge: 3 }, gain: { critical: 1, hit: 2 }, pick: true }, steps: 2 }
  ];
  const all = settleTrades(reckless, have);
  assert.equal(all.haste, 2, "all its END, unless it picked");
  assert.equal(all.taken, 2, "the END it gave up no longer takes damage off");
  assert.deepEqual(all.combat, { hit: 4, critical: 2, dodge: -6, damage: 0 });
  assert.deepEqual(all.steps, { "Reckless Charge|end": { steps: 2, most: 2 }, "Reckless Charge|dodge": { steps: 2, most: 7 } });

  const force = [{ skill: "Critical Force", trade: { give: { critical: 6 }, gain: { damage: 1 }, rest: true } }];
  const forced = settleTrades(force, { ...have, critical: 20 });
  assert.deepEqual(forced.combat, { hit: 0, critical: -20, dodge: 0, damage: 3 });
  assert.equal(forced.noCrit, true);
  const barred = settleTrades(force, { ...have, critical: 20 }, { canCrit: false });
  assert.deepEqual(barred.idle, ["Critical Force"], "a unit that makes no critical hit has no Critical to give");
  assert.equal(barred.combat.damage, 0);
  assert.deepEqual(settleTrades(reckless, { ...have, endurance: 0, dodge: 2 }).idle, ["Reckless Charge"]);
  assert.deepEqual(settleTrades(reckless, { ...have, endurance: 0 }).idle, [], "a skill of which one trade was made is not idle");
});

test("Gamble: Accuracy is halved and Critical doubled, also for the unit that is attacked", () => {
  const plain = planExchange(fighter({ name: "A" }), fighter({ name: "B" }));
  assert.deepEqual([plain.initiator.hit, plain.initiator.crit, plain.initiator.damage], [90, 1, 9]);
  const plan = planExchange(fighter({ name: "A", skills: [on("Gamble")] }), fighter({ name: "B", skills: [on("Gamble")] }));
  assert.deepEqual([plan.initiator.hit, plan.initiator.crit], [34, 7], "55 Accuracy against 21 Dodge, 12 Critical against 5");
  assert.deepEqual([plan.defender.hit, plan.defender.crit], [34, 7]);
  assert.deepEqual(plan.initiator.unit.fx.sources.find((source) => source.name === "Gamble").combat, { hit: -56, critical: 6 });
  const off = planExchange(fighter({ name: "A", skills: [skill("Gamble")] }), fighter({ name: "B" }));
  assert.equal(off.initiator.hit, 90, "a switch that is off does nothing");
});

test("Critical Force: no critical hit, +1 damage for every 6 Critical, only for a unit that starts the fight and can Critical", () => {
  const keen = { weapon: { crit: 30 } };
  const plan = planExchange(fighter({ name: "A", ...keen, skills: [on("Critical Force")] }), fighter({ name: "B" }));
  assert.equal(plan.initiator.crit, 0);
  assert.equal(plan.initiator.damage, 9 + 6, "36 Critical is 6 damage");
  const { result } = fight(fighter({ name: "A", ...keen, skills: [on("Critical Force")] }), quiet(), [1]);
  assert.equal(result.attacks[0].critRoll, null, "nothing is rolled for a critical hit");
  const answering = planExchange(fighter({ name: "B" }), fighter({ name: "A", ...keen, skills: [on("Critical Force")] }));
  assert.equal(answering.defender.crit, 31, "attacked, it keeps its Critical");
  const barred = planExchange(fighter({ name: "A", ...keen, skills: [on("Critical Force"), made("Calm", [{ rules: ["noCrit"] }])] }), fighter({ name: "B" }));
  assert.equal(barred.initiator.damage, 9);
  assert.deepEqual(barred.initiator.idle, ["Critical Force"]);
});

test("Reckless Charge and Ebb and Flow: END for HST, Dodge for Critical and Hit, HST for damage, in the steps picked", () => {
  const charger = (picked = {}) => fighter({ name: "A", skills: [made("Tough", [{ endurance: 3 }]), on("Reckless Charge", { picked })] });
  const all = planExchange(charger(), fighter({ name: "B" }));
  assert.equal(all.initiator.unit.fx.haste, 3);
  assert.equal(all.defender.damage, 9, "the 3 END it had are gone: its foe deals what it would without them");
  assert.equal(all.initiator.unit.combat.dodge, 0, "all 21 Dodge in steps of 3");
  assert.deepEqual([all.initiator.hit, all.initiator.crit], [100, 8], "111 + 14 Accuracy, 6 + 7 Critical");
  assert.equal(all.defender.hit, 100, "nothing left to dodge with");

  const some = planExchange(charger({ end: 1, dodge: 0 }), fighter({ name: "B" }));
  assert.equal(some.initiator.unit.fx.haste, 1);
  assert.equal(some.defender.damage, 7, "2 END are left");
  assert.equal(some.initiator.hit, 90);
  assert.deepEqual(some.initiator.unit.fx.picks, { "Reckless Charge|end": { steps: 1, most: 3 }, "Reckless Charge|dodge": { steps: 0, most: 7 } });

  // 4 SPD short of a follow-up: the 4 HST from its END make it
  const slow = (skills) => fighter({ name: "A", stats: { spd: 8 }, skills });
  const foe = fighter({ name: "B", stats: { spd: 6 } });
  assert.equal(planExchange(slow([made("Tough", [{ endurance: 2 }])]), foe).initiator.doubles, false);
  assert.equal(planExchange(slow([made("Tough", [{ endurance: 2 }]), on("Reckless Charge", { picked: { dodge: 0 } })]), foe).initiator.doubles, true);

  const ebb = planExchange(fighter({ name: "A", skills: [made("Swift", [{ haste: 2 }]), on("Ebb and Flow", { picked: { hit: 5 } })] }), fighter({ name: "B" }));
  assert.equal(ebb.initiator.unit.fx.haste, 0);
  assert.equal(ebb.initiator.damage, 11, "2 HST are 2 damage");
  assert.deepEqual([ebb.initiator.hit, ebb.initiator.crit], [75, 6], "15 Hit for 5 Critical");
  assert.equal(ebb.defender.hit, 80, "and 10 Dodge");
});

/* -------------------------------------------- */
/*  One Attack in Place of Several              */
/* -------------------------------------------- */

test("loneAttack: a share of the damage for each attack given up, with another stat in place of Strength", () => {
  assert.equal(loneAttack({ hit: 15 }, { attacks: 1, power: 15, stats: {} }), null);
  assert.deepEqual(loneAttack({ hit: 15, critical: 10, damagePercent: 25 }, { attacks: 2, power: 15, stats: {} }), { hit: 15, critical: 10, damage: 3 });
  assert.deepEqual(loneAttack({ damagePercent: 25 }, { attacks: 4, power: 15, stats: {} }), { hit: 0, critical: 0, damage: 11 });
  const blow = loneAttack({ hit: 5, critical: 15, damagePercent: 10, stat: ["def", "res"] }, { attacks: 2, power: 15, stats: { str: 10, def: 14, res: 3 } });
  assert.deepEqual(blow, { hit: 5, critical: 15, damage: 5 }, "19 with DEF, and a tenth of that");
  const tome = loneAttack({ damagePercent: 10, stat: ["def", "res"] }, { attacks: 2, power: 15, stats: { str: 10, def: 14 }, damageStat: "mag" });
  assert.equal(tome.damage, 1, "a weapon that adds another stat keeps it");
});

test("Singular Strike: a unit that would attack twice attacks once, with +15 Hit, +10 Critical and a quarter more damage", () => {
  const fast = (skills) => fighter({ name: "A", stats: { spd: 14 }, skills });
  const twice = planExchange(fast([]), fighter({ name: "B" }));
  assert.equal(twice.initiator.attacks, 2);
  const plan = planExchange(fast([on("Singular Strike")]), fighter({ name: "B" }));
  assert.equal(plan.initiator.attacks, 1);
  assert.deepEqual(plan.order, ["initiator", "defender"]);
  assert.equal(plan.initiator.damage, twice.initiator.damage + 3, "a quarter of 15 Atk");
  assert.equal(plan.initiator.hit, Math.min(twice.initiator.hit + 15, 100));
  assert.equal(plan.initiator.crit, twice.initiator.crit + 10);
  assert.deepEqual(plan.initiator.lone, { skill: "Singular Strike", attacks: 2, hit: 15, critical: 10, damage: 3 });
  const { result } = fight(fast([on("Singular Strike")]), fighter({ name: "B" }), [1, 100, 1, 100]);
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Singular Strike"]);

  // A brave weapon that also follows up gives up three attacks
  const brave = planExchange(fighter({ name: "A", stats: { spd: 14 }, weapon: { effect: "2x Strikes" }, skills: [on("Singular Strike")] }), fighter({ name: "B" }));
  assert.equal(brave.initiator.lone.attacks, 4);
  assert.equal(brave.initiator.power, 15 + 11);
});

test("Singular Strike: a unit that would attack once gains nothing, and the skill is not spent", () => {
  const { plan, result } = fight(fighter({ name: "A", skills: [on("Singular Strike")] }), fighter({ name: "B" }), [1, 100, 1, 100]);
  assert.equal(plan.initiator.lone, null);
  assert.equal(plan.initiator.damage, 9);
  assert.deepEqual(plan.initiator.idle, ["Singular Strike"]);
  assert.deepEqual(result.initiator.spent, []);
});

test("Body Blow: only for a unit that starts the fight, with the higher of DEF and RES in place of STR", () => {
  const tank = (skills) => fighter({ name: "A", stats: { spd: 14, def: 14 }, skills });
  const plan = planExchange(tank([on("Body Blow")]), fighter({ name: "B" }));
  assert.equal(plan.initiator.attacks, 1);
  assert.equal(plan.initiator.power, 20, "5 Might + 14 DEF, and a tenth of that");
  assert.equal(plan.initiator.crit, 1 + 15);
  const answering = planExchange(fighter({ name: "B" }), tank([on("Body Blow")]));
  assert.equal(answering.defender.attacks, 2, "attacked, it fights as ever");
  assert.deepEqual(answering.defender.declared, []);
});

/* -------------------------------------------- */
/*  Weight, Defences and the Cap                */
/* -------------------------------------------- */

test("Gigas Grip: weapon and Shield weigh nothing as Attack Speed is worked out", () => {
  const heavy = { weapon: { weight: 14 } };
  const slow = planExchange(fighter({ name: "A", ...heavy }), fighter({ name: "B" }));
  assert.equal(slow.initiator.unit.combat.attackSpeed, 2, "8 SPD less 6 Weight over CON");
  assert.equal(slow.defender.doubles, true);
  const { plan, result } = fight(fighter({ name: "A", ...heavy, skills: [on("Gigas Grip")] }), fighter({ name: "B" }), [1, 100, 1, 100]);
  assert.equal(plan.initiator.unit.combat.attackSpeed, 8);
  assert.equal(plan.defender.doubles, false);
  assert.equal(plan.defender.hit, 90, "its Dodge is counted from that Attack Speed");
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Gigas Grip"]);

  // Switched on beforehand, it counts for a unit that is attacked and cannot answer, and is spent
  const far = fight(fighter({ name: "B", weapon: { category: "bow", range: "2" } }), fighter({ name: "A", ...heavy, skills: [on("Gigas Grip")] }), [1, 100], { distance: 2 });
  assert.equal(far.plan.defender.blocked, "outOfRange");
  assert.equal(far.plan.initiator.doubles, false);
  assert.deepEqual(far.result.defender.spent.map((entry) => entry.name), ["Gigas Grip"]);
});

test("Infuse and Magic Weapons: a physical weapon resisted by RES, with half of MAG and no critical hit for Infuse", () => {
  const foe = () => fighter({ name: "B", stats: { def: 9, res: 2 } });
  const mage = (skills, weapon = {}) => fighter({ name: "A", stats: { mag: 8 }, weapon, skills });
  assert.equal(planExchange(mage([]), foe()).initiator.damage, 6);
  const magic = planExchange(mage([on("Magic Weapons")]), foe());
  assert.equal(magic.initiator.damage, 13);
  assert.equal(magic.initiator.defence, "res");
  assert.equal(magic.initiator.strike.physical, true, "it stays a physical attack for what asks");
  const infused = planExchange(mage([on("Infuse")], { crit: 30 }), foe());
  assert.equal(infused.initiator.damage, 13 + 4);
  assert.equal(infused.initiator.crit, 0);
  const thrown = planExchange(mage([on("Infuse")], { range: "1-2" }), foe(), { distance: 2 });
  assert.equal(thrown.initiator.damage, 6, "not from 2 tiles away");
  const tome = planExchange(mage([on("Magic Weapons")], { category: "fire", damageStat: "mag" }), foe());
  assert.equal(tome.initiator.defence, "res");
  assert.equal(planExchange(foe(), mage([on("Magic Weapons")])).defender.defence, "def", "attacked, it strikes at DEF");
});

test("Robust: a hit takes no more than 45% of maximum HP, a critical hit too, and a fight spends it", () => {
  const sturdy = (extra = {}) => fighter({ name: "B", hp: 20, hpMax: 20, skills: [on("Robust")], ...extra });
  const brute = () => fighter({ name: "A", stats: { str: 30 } });
  const plan = planExchange(brute(), sturdy());
  assert.equal(plan.initiator.damage, 29);
  assert.equal(plan.initiator.cap, 9);
  assert.deepEqual(plan.initiator.cappedBy, ["Robust"]);
  const { result } = fight(brute(), sturdy(), [1, 1, 100]);
  assert.equal(result.attacks[0].crit, true);
  assert.equal(result.attacks[0].damage, 9);
  assert.deepEqual(result.attacks[0].capped, ["Robust"]);
  assert.equal(result.defender.hp, 11);
  assert.deepEqual(result.defender.spent.map((entry) => entry.name), ["Robust"]);

  // It is spent by a fight in which its unit cannot answer, too
  const unarmed = fight(brute(), sturdy({ weapon: null }), [1, 100]);
  assert.equal(unarmed.result.defender.hp, 11);
  assert.deepEqual(unarmed.result.defender.spent.map((entry) => entry.name), ["Robust"]);
  assert.equal(fight(brute(), fighter({ name: "B", skills: [skill("Robust")] }), [1, 100]).result.defender.hp, 0, "not unless it is switched on");
});

/* -------------------------------------------- */
/*  A Hit That Counts as a Critical Hit         */
/* -------------------------------------------- */

const lifetaker = made("Bloodlust", [{ proc: { on: "crit", sure: true }, recover: 4 }]);

test("Stunt: the first hit that lands counts as a critical hit for skills, without the damage of one", () => {
  const stunter = (hp = 10) => fighter({ name: "A", hp, hpMax: 20, skills: [on("Stunt"), lifetaker] });
  const { result } = fight(stunter(), quiet(), [1, 100]);
  assert.equal(result.attacks[0].crit, false);
  assert.equal(result.attacks[0].asCrit, true);
  assert.equal(result.attacks[0].damage, 9);
  assert.equal(result.initiator.hp, 14, "what waits for a critical hit took effect");
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Stunt"]);

  // Only the first: the second hit is a plain one
  const twice = fight(fighter({ name: "A", hp: 10, hpMax: 20, stats: { spd: 14 }, skills: [on("Stunt"), lifetaker] }), quiet(), [1, 100, 1, 100]);
  assert.deepEqual(twice.result.attacks.map((attack) => !!attack.asCrit), [true, false]);
  assert.equal(twice.result.initiator.hp, 14);

  // A fight in which no attack lands does not spend it
  const missed = fight(stunter(), quiet(), [100]);
  assert.equal(missed.result.attacks[0].hit, false);
  assert.deepEqual(missed.result.initiator.spent, []);
});

test("Fatality: the first attack deals effective damage and counts as a critical hit for skills", () => {
  const plain = planExchange(fighter({ name: "A" }), quiet());
  const { plan, result } = fight(fighter({ name: "A", hp: 10, hpMax: 20, stats: { spd: 14 }, skills: [on("Fatality"), lifetaker] }), quiet(), [1, 100, 1, 100]);
  assert.equal(plan.initiator.effectiveMore, 10, "5 Might counted three times");
  assert.equal(plan.initiator.damage, plain.initiator.damage + 10, "the forecast counts it for the first attack");
  assert.equal(plan.initiator.damageLater, plain.initiator.damage);
  assert.deepEqual(result.attacks.map((attack) => attack.damage), [19, 9]);
  assert.deepEqual(result.attacks.map((attack) => !!attack.asCrit), [true, false]);
  assert.equal(result.initiator.hp, 14);
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Fatality"]);
  const warded = planExchange(fighter({ name: "A", skills: [on("Fatality")] }), quiet({ skills: [made("Ward", [{ rules: ["noEffective"] }])] }));
  assert.equal(warded.initiator.damage, plain.initiator.damage);
});

test("a skill declared for one attack shows in the numbers of the forecast, and only the first attack has it", () => {
  const { plan, result } = fight(fighter({ name: "A", stats: { spd: 14 }, skills: [on("Mighty Strike")] }), quiet(), [1, 100, 1, 100]);
  assert.equal(plan.initiator.damage, 13, "9 damage and half again");
  assert.equal(plan.initiator.damageLater, 9);
  assert.deepEqual(plan.initiator.named.damage, [["Mighty Strike", 4]]);
  assert.deepEqual(result.attacks.map((attack) => attack.damage), [13, 9]);
});

/* -------------------------------------------- */
/*  Spending for Damage                         */
/* -------------------------------------------- */

test("settleSpends: steps of HP that leave 1, and transformations, one step unless picked", () => {
  const hp = { skill: "Incantation", spend: { id: "hp", hp: 3, gain: { might: 1 } }, steps: null };
  assert.deepEqual(settleSpends([hp], { hp: 20 }), {
    hp: 3, transforms: 0, might: 1, damage: 0, idle: [], sources: [{ name: "Incantation", stats: {}, combat: { damage: 1 } }],
    steps: { "Incantation|hp": { steps: 1, most: 6 } }
  });
  assert.equal(settleSpends([{ ...hp, steps: 99 }], { hp: 20 }).hp, 18, "it keeps 1 HP");
  assert.deepEqual(settleSpends([hp], { hp: 3 }).idle, ["Incantation"]);
  const forms = { skill: "Extract Power", spend: { id: "forms", transforms: 1, gain: { damage: 2 } }, steps: 2 };
  const spent = settleSpends([forms], { hp: 20, transforms: 3 });
  assert.deepEqual([spent.transforms, spent.damage], [2, 4]);
  assert.deepEqual(settleSpends([forms], { hp: 20, transforms: 0 }).idle, ["Extract Power"]);
});

test("Incantation: HP are paid as the fight begins for Might with a tome, and not by a unit that makes no attack", () => {
  const tome = { category: "fire", damageStat: "mag" };
  const mage = (picked = {}, weapon = tome) => fighter({ name: "A", hp: 20, hpMax: 20, weapon, skills: [on("Incantation", { picked })] });
  const plain = planExchange(fighter({ name: "A", weapon: tome }), fighter({ name: "B" }));
  const plan = planExchange(mage({ hp: 2 }), fighter({ name: "B" }));
  assert.equal(plan.initiator.damage, plain.initiator.damage + 2);
  assert.equal(plan.initiator.unit.hp, 14);
  assert.deepEqual(plan.initiator.unit.fx.paid, { hp: 6, transforms: 0 });
  const { result } = fight(mage({ hp: 2 }), quiet(), [1, 100]);
  assert.equal(result.initiator.hp, 14);
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Incantation"]);
  assert.equal(planExchange(mage(), fighter({ name: "B" })).initiator.unit.hp, 17, "3 HP once, unless more was picked");
  assert.equal(planExchange(mage({ hp: 2 }, {}), fighter({ name: "B" })).initiator.unit.hp, 20, "a sword is no magic weapon");

  // Attacked from where it cannot answer, it spends nothing and stays switched on
  const far = fight(fighter({ name: "B", weapon: { category: "bow", range: "2" } }), mage({ hp: 2 }, { ...tome, range: "1" }), [100], { distance: 2 });
  assert.equal(far.plan.defender.unit.hp, 20);
  assert.deepEqual(far.plan.defender.idle, ["Incantation"]);
  assert.deepEqual(far.result.defender.spent, []);
});

test("Extract Power: transformations left this turn for 2 damage each", () => {
  const dragon = (transforms, picked = {}) => ({ ...fighter({ name: "A", skills: [on("Extract Power", { picked })] }), transforms });
  const plan = planExchange(dragon(2, { forms: 2 }), fighter({ name: "B" }));
  assert.equal(plan.initiator.damage, 13);
  assert.deepEqual(plan.initiator.unit.fx.paid, { hp: 0, transforms: 2 });
  const none = planExchange(dragon(0), fighter({ name: "B" }));
  assert.equal(none.initiator.damage, 9);
  assert.deepEqual(none.initiator.idle, ["Extract Power"]);
  assert.deepEqual(none.initiator.declared, [], "and it is not spent");
});

/* -------------------------------------------- */
/*  The Foe's Bonuses                           */
/* -------------------------------------------- */

test("settleBonuses: the stat picked or the one with the most to lose is cancelled, or turned around", () => {
  const bonuses = bonusesOf([{ name: "Rally", stats: { spd: 4, def: 2, mov: 1 } }, { name: "Curse", stats: { spd: -3, res: 5 } }]);
  assert.deepEqual(bonuses, { spd: 4, def: 2, res: 5 });
  assert.deepEqual(settleBonuses([{ skill: "Lull", stats: ["best"], times: 0 }], bonuses).stats, { res: -5 });
  assert.deepEqual(settleBonuses([{ skill: "Lull", stats: ["def"], times: 0 }], bonuses).stats, { def: -2 });
  const turned = settleBonuses([{ skill: "Cauterize", stats: ["spd", "res"], times: -1 }], bonuses);
  assert.deepEqual(turned.stats, { spd: -8, res: -10 });
  assert.deepEqual(turned.sources, [{ name: "Cauterize", stats: { spd: -8, res: -10 }, combat: {} }]);
  const both = settleBonuses([{ skill: "Lull", stats: ["spd"], times: 0 }, { skill: "Cauterize", stats: ["spd", "res"], times: -1 }], bonuses);
  assert.deepEqual(both.stats, { spd: -4, res: -10 }, "a bonus that was cancelled is not turned around as well");
  assert.deepEqual(settleBonuses([{ skill: "Lull", stats: ["best"], times: 0 }], {}).stats, {});
});

test("Lull: the foe's largest bonus is cancelled for a unit that starts the fight, or the stat it picked", () => {
  const buffed = () => fighter({ name: "B", skills: [made("Rally", [{ stats: { def: 4, spd: 2 } }])] });
  assert.equal(planExchange(fighter({ name: "A" }), buffed()).initiator.damage, 5);
  const plan = planExchange(fighter({ name: "A", skills: [skill("Lull")] }), buffed());
  assert.equal(plan.initiator.damage, 9, "its 4 DEF are gone");
  assert.equal(plan.defender.unit.stats.spd, 10);
  assert.deepEqual(plan.defender.unit.fx.sources.at(-1), { name: "Lull", stats: { def: -4 }, combat: {} });
  const picked = planExchange(fighter({ name: "A", skills: [skill("Lull", { picked: { stat: "spd" } })] }), buffed());
  assert.equal(picked.initiator.damage, 5);
  assert.equal(picked.defender.unit.stats.spd, 8);
  assert.equal(planExchange(buffed(), fighter({ name: "A", skills: [skill("Lull")] })).initiator.unit.stats.def, 10, "not when it is attacked");
});

test("Cauterize: the bonuses to SPD and RES of a foe at half its HP or more become penalties", () => {
  const buffed = (hp) => fighter({ name: "B", hp, hpMax: 20, skills: [made("Rally", [{ stats: { spd: 3, res: 2, def: 1 } }])] });
  const plan = planExchange(fighter({ name: "A", skills: [skill("Cauterize")] }), buffed(10));
  assert.deepEqual([plan.defender.unit.stats.spd, plan.defender.unit.stats.res, plan.defender.unit.stats.def], [5, 1, 7]);
  const hurt = planExchange(fighter({ name: "A", skills: [skill("Cauterize")] }), buffed(9));
  assert.equal(hurt.defender.unit.stats.spd, 11);
  const answering = planExchange(buffed(20), fighter({ name: "A", skills: [skill("Cauterize")] }));
  assert.equal(answering.initiator.unit.stats.spd, 5, "at the start of combat, for either side");
});

/* -------------------------------------------- */
/*  Rend Heaven                                 */
/* -------------------------------------------- */

test("Rend Heaven: half of the other stat is added, and the attack is resisted by the lower defence", () => {
  const foe = () => quiet({ stats: { def: 9, res: 2 } });
  const render = fighter({ name: "A", stats: { mag: 8, dex: 20 }, skills: [skill("Rend Heaven")] });
  const lit = fight(render, foe(), [10, 1, 100]);
  assert.equal(lit.plan.initiator.chances.attack[0].chance, 10);
  assert.equal(lit.result.attacks[0].damage, (15 + 4) - 2, "half of 8 MAG, against 2 RES");
  const dark = fight(render, foe(), [11, 1, 100]);
  assert.equal(dark.result.attacks[0].damage, 15 - 9);
  const tome = fighter({ name: "A", stats: { mag: 8, dex: 20 }, weapon: { category: "fire", damageStat: "mag" }, skills: [skill("Rend Heaven")] });
  assert.equal(fight(tome, quiet({ stats: { def: 1, res: 6 } }), [10, 1, 100]).result.attacks[0].damage, (13 + 5) - 1, "half of 10 STR, against 1 DEF");
});

/* -------------------------------------------- */
/*  Nihil                                       */
/* -------------------------------------------- */

test("Nihil and Mantle: a foe's skills that are chosen do nothing, are named as stopped and are not spent", () => {
  for ( const name of ["Nihil", "Mantle"] ) {
    const { plan, result } = fight(
      fighter({ name: "A", stats: { spd: 14 }, weapon: { name: "Blessed Sword" }, skills: [on("Mighty Strike"), on("Gamble"), on("Singular Strike")] }),
      // Mantle also keeps its foe from critical hits, so that nothing is rolled for one
      quiet({ skills: [skill(name)] }), (name === "Mantle") ? [1, 1] : [1, 100, 1, 100]
    );
    assert.deepEqual(plan.initiator.stopped, ["Mighty Strike", "Gamble", "Singular Strike"], name);
    assert.equal(plan.initiator.hit, 90, "Gamble halves nothing");
    assert.equal(plan.initiator.attacks, 2);
    assert.deepEqual(plan.initiator.declared, []);
    assert.deepEqual(result.attacks.map((attack) => attack.damage), [9, 9]);
    assert.deepEqual(result.initiator.spent, []);
  }
});

test("Nihil: a chance of a skill that is chosen is stopped too, and what the unit has from elsewhere is not", () => {
  const render = fighter({ name: "A", stats: { dex: 40 }, skills: [skill("Rend Heaven", { chosen: true }), made("Keen", [{ combat: { hit: 5 } }])] });
  const plan = planExchange(render, quiet({ skills: [skill("Nihil")] }));
  assert.deepEqual(plan.initiator.chances.attack, []);
  assert.deepEqual(plan.initiator.stopped, ["Rend Heaven"]);
  assert.equal(plan.initiator.unit.combat.accuracy, 111 + 64 + 5);
  const robust = planExchange(fighter({ name: "A", stats: { str: 30 }, skills: [skill("Nihil")] }), fighter({ name: "B", skills: [on("Robust")] }));
  assert.equal(robust.initiator.cap, null);
  assert.deepEqual(robust.defender.stopped, ["Robust"]);
});

/* -------------------------------------------- */
/*  Parity                                      */
/* -------------------------------------------- */

test("Parity: terrain, supports, weapon effects, Shields and skills are cancelled for both, but not what was declared", () => {
  const ground = { initiator: { def: 0, res: 0, dodge: 0, elevation: 0 }, defender: { def: 2, res: 2, dodge: 20, elevation: 0 } };
  const friend = { label: "Friend", support: true, hit: 10, damage: 2 };
  const attacker = (skills) => {
    const unit = fighter({ name: "A", weapon: { effect: "2x Strikes. Effective against Armored." }, skills: [made("Might", [{ stats: { str: 4 } }]), ...skills] });
    return { ...unit, endurance: 3, bare: { ...unit.bare, modifiers: [friend] } };
  };
  const armored = () => fighter({ name: "B", qualities: "Armored", skills: [made("Wall", [{ stats: { def: 5 } }]), made("Vantage", [{ rules: ["first"] }])] });
  const usual = planExchange(attacker([]), armored(), { ground });
  assert.equal(usual.initiator.strikes, 2);
  assert.equal(usual.initiator.mightMultiplier, 3);
  assert.equal(usual.order[0], "defender");
  assert.equal(usual.defender.damage, 6, "3 END from its supports");

  const plan = planExchange(attacker([on("Parity"), on("Mighty Strike")]), armored(), { ground });
  assert.equal(plan.parity, "Parity");
  assert.equal(plan.initiator.strikes, 1);
  assert.equal(plan.initiator.mightMultiplier, 1);
  assert.equal(plan.order[0], "initiator");
  assert.equal(plan.initiator.unit.stats.str, 10);
  assert.equal(plan.defender.unit.stats.def, 6);
  assert.equal(plan.initiator.hit, 90, "no support, no tile");
  assert.equal(plan.initiator.damageLater, 9);
  assert.equal(plan.initiator.damage, 13, "Mighty Strike was declared before the fight");
  assert.equal(plan.defender.damage, 9, "its supports take nothing off");
  assert.deepEqual(plan.initiator.ground, { height: 0, hit: 0, damage: 0, dodge: 0, cover: 0 });

  // The unit that is attacked may be the one that has it; a foe with Nihil stops it
  assert.equal(planExchange(armored(), attacker([on("Parity")]), { ground }).parity, "Parity");
  const stopped = planExchange(attacker([on("Parity")]), fighter({ name: "B", skills: [skill("Nihil")] }));
  assert.equal(stopped.parity, undefined);
  assert.equal(stopped.initiator.strikes, 2);
  assert.equal(planExchange(attacker([skill("Parity")]), armored()).parity, undefined, "not unless it is switched on");
});

test("Parity: a bow keeps the effective damage of its kind, and what comes after the fight still comes", () => {
  const bow = { category: "bow", range: "2", effect: "Effective against Flying. Inflicts Poison." };
  const archer = fighter({ name: "A", weapon: bow, skills: [on("Parity"), made("Reaper", [{ proc: { on: "kill", sure: true }, recover: 5 }])] });
  const plan = planExchange(archer, quiet({ qualities: "Flying" }), { distance: 2 });
  assert.equal(plan.initiator.mightMultiplier, 3);
  assert.deepEqual(plan.initiator.inflicts, []);
  assert.equal(plan.initiator.chances.kill.length, 1);
  const totals = skillTotals([made("Elite", [{ expMultiplier: 2 }, { combat: { hit: 5 } }])], { hp: 10, hpMax: 10, stats: {} }, { parity: true });
  assert.deepEqual(totals.combat, {});
});

/* -------------------------------------------- */
/*  Cooldowns                                   */
/* -------------------------------------------- */

test("Overdrive: every cooldown of the unit is a turn shorter, and never less than none", () => {
  const totals = skillTotals([skill("Overdrive")], { hp: 10, hpMax: 10, stats: {} });
  assert.equal(totals.cooldowns, -1);
  assert.deepEqual(totals.applied, [], "it has nothing to tell in a fight");
  assert.equal(cooldownWith(3, -1), 2);
  assert.equal(cooldownWith(1, -1), 0);
  assert.equal(cooldownWith(0, -1), 0);
  const usage = { kind: "declare", cooldown: 3 };
  assert.equal(spendSkill(usage, {}).cooldown, 4, "3 turns, and the turn start before them");
  assert.equal(spendSkill(usage, {}, { cooldowns: -1 }).cooldown, 3);
  assert.equal(spendSkill({ kind: "declare", cooldown: 1 }, {}, { cooldowns: -2 }).cooldown, 1);
  assert.equal(spendSkill({ kind: "declare" }, { cooldown: 0 }, { cooldowns: -1 }).cooldown, 0);
});

/* -------------------------------------------- */
/*  Picks, Checks and Who a Choice Is For       */
/* -------------------------------------------- */

test("fightPicks and stepPick: what a skill has its unit pick for a fight, and how a pick is stepped", () => {
  assert.deepEqual(fightPicks(skill("Reckless Charge").effects).map((pick) => [pick.id, pick.kind, pick.part, pick.all]),
    [["end", "steps", "trade", true], ["dodge", "steps", "trade", true]]);
  assert.deepEqual(fightPicks(skill("Incantation").effects).map((pick) => [pick.id, pick.cost, pick.all]), [["hp", { hp: 3 }, false]]);
  assert.deepEqual(fightPicks(skill("Lull").effects).map((pick) => [pick.id, pick.kind]), [["stat", "stat"]]);
  assert.deepEqual(fightPicks(skill("Gamble").effects), []);
  assert.equal(stepPick(2, 5, "more"), 3);
  assert.equal(stepPick(5, 5, "more"), 5);
  assert.equal(stepPick(0, 5, "less"), 0);
  assert.equal(stepPick(2, 5, "all"), 5);
  assert.equal(stepPick(5, 5, "all"), 0);
});

test("choosesForFight, rearms and forAttacksOnly: where a skill is chosen, and what a unit that makes no attack spends", () => {
  for ( const name of ["Gamble", "Robust", "Stunt", "Parity", "Mighty Strike", "Weapon Guard"] ) assert.equal(choosesForFight(skill(name).effects), true, name);
  for ( const name of ["Trample", "Dash", "Smite", "Lull"] ) assert.equal(choosesForFight(skill(name).effects), false, name);
  assert.equal(rearms(skill("Sidearm").effects), true);
  assert.equal(rearms(skill("Preparedness").effects), true);
  assert.equal(rearms(skill("Robust").effects), false);
  assert.equal(skill("Sidearm").usage.uses, 2);
  assert.equal(forAttacksOnly({ single: { hit: 15 } }), true);
  assert.equal(forAttacksOnly({ combat: { hit: 15, damage: 3 } }), true);
  assert.equal(forAttacksOnly({ combat: { dodge: 15 } }), false);
  assert.equal(forAttacksOnly({ hitCap: 45 }), false);
  assert.equal(forAttacksOnly({ noWeight: true }), false);
  assert.equal(forAttacksOnly({ proc: { on: "attack", sure: true } }), true);
  assert.equal(forAttacksOnly({ proc: { on: "struck", sure: true } }), false);
});

test("checkEffects: the parts of a choice are checked", () => {
  assert.deepEqual(checkTrade({ give: { accuracy: "half" }, gain: { critical: "double" } }), []);
  assert.deepEqual(checkTrade({ id: "d", give: { dodge: 3 }, gain: { critical: 1, hit: 2 }, pick: true }), []);
  assert.ok(checkTrade({ give: { dodge: 3 }, gain: { hit: 2 }, pick: true }).length, "a pick needs an id");
  assert.ok(checkTrade({ give: { luck: 1 }, gain: { hit: 1 } }).length);
  assert.ok(checkTrade({ give: { dodge: 1 }, gain: { speed: 1 } }).length);
  assert.deepEqual(checkSpend({ id: "hp", hp: 3, gain: { might: 1 } }), []);
  assert.ok(checkSpend({ hp: 3, gain: { might: 1 } }).length);
  assert.ok(checkSpend({ id: "x", gold: 3, gain: { might: 1 } }).length);
  assert.deepEqual(checkSingle({ hit: 5, critical: 15, damagePercent: 10, stat: ["def", "res"] }), []);
  assert.ok(checkSingle({ stat: ["grit"] }).length);
  assert.deepEqual(checkFoeBonus({ stats: "pick", times: 0 }), []);
  assert.ok(checkFoeBonus({ stats: ["hp"], times: -1 }).length);
  assert.ok(checkFoeBonus({ stats: ["spd"], times: 2 }).length);
  assert.deepEqual(checkEffects([{ when: { declared: true }, proc: { on: "hit", sure: true, once: true, spends: true }, asCrit: true }]), []);
  assert.ok(checkEffects([{ proc: { on: "hit", sure: true, spends: true }, asCrit: true }]).length, "only a skill that is switched on is spent");
  assert.ok(checkEffects([{ proc: { on: "struck", sure: true }, asCrit: true }]).length);
  assert.ok(checkEffects([{ against: "luk" }]).length);
  assert.ok(checkEffects([{ hitCap: 0 }]).length);
  assert.ok(checkEffects([{ proc: { on: "attack", sure: true }, hitCap: 45 }]).length);
  assert.ok(checkEffects([{ cooldowns: 0.5 }]).length);
});

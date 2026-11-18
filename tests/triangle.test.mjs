/**
 * Tests for the Weapon Triangle (`module/rules/triangle.mjs`, `module/rules/combat.mjs`): who has the
 * advantage, what skills make of it (multiplied, negated, granted, never against their unit, bent for one
 * attack), what else reads it, and what one weapon hands to the next.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { planExchange, playExchange, triangleAdvantage } from "../module/rules/combat.mjs";
import { checkEffects } from "../module/rules/skills.mjs";
import {
  checkHandover, checkTriangle, cleanWielded, handedOver, lastWielded, outsideTriangle, settleTriangle, triangleOf, triangleSwing, trianglesOf
} from "../module/rules/triangle.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

function play(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const { result } = playExchange(plan, (index) => rolls[index] ?? rest, () => null, {});
  return { plan, result };
}

const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });
const AXE = { name: "Iron Axe", category: "axe" };
const LANCE = { name: "Iron Lance", category: "lance" };
const BOW = { name: "Iron Bow", category: "bow", range: "2" };
const FIRE = { name: "Fire", category: "fire", range: "1-2", damageStat: "mag" };
const WIND = { name: "Wind", category: "wind", range: "1-2", damageStat: "mag" };
const FLUX = { name: "Flux", category: "dark", range: "1-2", damageStat: "mag", might: 9, hit: 70, crit: 10 };
const SHINE = { name: "Shine", category: "light", range: "1-2", damageStat: "mag", might: 6, hit: 80, crit: 5 };

// Every attack hits and none is critical: the Hit roll is 1 and the critical roll 100
const HITS = Array.from({ length: 40 }, (_, index) => ((index % 2) ? 100 : 1));
const dealt = (result, side) => result.attacks.filter((attack) => attack.side === side).map((attack) => attack.damage);

// The fixture's unit has rank E with Swords, which is worth 10 Hit and 1 damage, and no rank with anything
// else, which is worth 5 Hit and 1 damage
const E = FEO.triangleBonus.E;
const F = FEO.triangleBonus.F;

const STEP = ["Adaptation", "Assault", "Deeper Knowledge", "Trilemma", "Symbiosis", "Blessing of Vesta"];

/** Play with an Optional Module switched on, and put it back as it was. */
function withModule(key, entry, run) {
  const before = FEO.optional[key];
  FEO.optional[key] = { ...(before ?? {}), ...entry };
  try {
    return run();
  }
  finally {
    if ( before === undefined ) delete FEO.optional[key];
    else FEO.optional[key] = before;
  }
}

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

test("a typing mistake in what bends the triangle does not pass silently", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  assert.ok(wrong({ triangle: {} }));
  assert.ok(wrong({ triangle: { times: "double" } }));
  assert.ok(wrong({ triangle: { doubles: true } }));
  assert.ok(wrong({ triangle: { beats: [] } }));
  assert.ok(wrong({ triangle: { beats: "everything" } }));
  assert.ok(wrong({ triangle: { safe: "yes" } }));
  assert.ok(wrong({ triangle: { negates: "accuracy" } }));
  assert.ok(wrong({ triangle: { at: "disadvantage" } }), "at needs negates");
  assert.ok(wrong({ triangle: { negates: "hit", at: "always" } }));
  assert.ok(wrong({ triangle: { boon: 4 } }), "boon and bane are for an attack");
  assert.ok(wrong({ proc: { on: "attack", stat: "dex" }, triangle: { times: 2 } }), "on an attack only boon and bane");
  assert.ok(wrong({ proc: { on: "struck", stat: "dex" }, triangle: { boon: 4 } }), "only on an attack");
  assert.ok(wrong({ proc: { on: "attack", stat: "dex" }, triangle: { boon: 4 }, damage: 2 }), "stands alone");
  assert.ok(wrong({ handover: { from: ["dark"] } }), "a share is needed");
  assert.ok(wrong({ handover: { from: ["shadow"], might: 50 } }));
  assert.ok(wrong({ handover: { from: ["dark"], might: 50, speed: 5 } }));
  assert.ok(wrong({ proc: { on: "attack", sure: true }, handover: { from: ["dark"], might: 50 } }), "always there");
  assert.ok(wrong({ when: { module: "mounts" }, combat: { hit: 10 } }), "a module nobody has heard of");

  assert.deepEqual(checkTriangle({ times: 2 }), []);
  assert.deepEqual(checkTriangle({ beats: "outside" }), []);
  assert.deepEqual(checkTriangle({ boon: 4, bane: 0 }, { moment: true }), []);
  assert.deepEqual(checkHandover({ from: ["dark"], might: 50, hit: 25, critical: 50 }), []);
  assert.deepEqual(checkEffects([{ when: { module: "dismounting" }, combat: { hit: 10 } }]), [], "a module that is awaited may be asked for");
});

/* -------------------------------------------- */
/*  Triangles                                   */
/* -------------------------------------------- */

test("the triangles: Swords, Axes and Lances are one, all magic another, the rest stands in none", () => {
  const groups = trianglesOf();
  assert.equal(groups.length, 2);

  // Katanas are a sub-category of Swords, and stand where Swords do
  assert.deepEqual([...triangleOf("sword")].sort(), ["axe", "katana", "lance", "sword"]);
  assert.ok(triangleOf("dark").includes("fire"), "Anima ties Light and Dark to the elements");
  assert.equal(triangleOf("bow"), null);

  assert.equal(outsideTriangle("sword", "axe"), false);
  assert.equal(outsideTriangle("sword", "fire"), true, "another triangle");
  assert.equal(outsideTriangle("sword", "bow"), true, "no triangle at all");
  assert.equal(outsideTriangle("fire", "earth"), false, "one triangle, though neither beats the other");
  assert.equal(outsideTriangle("bow", "sword"), true, "a weapon that stands in none has every other outside");
  assert.equal(outsideTriangle("bow", "bow"), true);
  assert.equal(outsideTriangle("sword", undefined), false, "an unarmed foe wields nothing");

  // The extended triangle is a third: Brawl beats Bows, which beat Knives, which beat Brawl
  const extended = { ...FEO.triangle, brawl: { beats: ["bow"], losesTo: ["knife"] }, bow: { beats: ["knife"], losesTo: ["brawl"] }, knife: { beats: ["brawl"], losesTo: ["bow"] } };
  assert.equal(trianglesOf(extended).length, 3);
  assert.equal(outsideTriangle("bow", "knife", extended), false);
  assert.equal(outsideTriangle("bow", "sword", extended), true);
});

test("who has the advantage: the weapons, then the skills, in their order", () => {
  const sword = (extra = {}) => ({ category: "sword", ...extra });
  const axe = (extra = {}) => ({ category: "axe", ...extra });
  const lance = (extra = {}) => ({ category: "lance", ...extra });
  assert.equal(triangleAdvantage("sword", "axe"), 1);
  assert.equal(settleTriangle(sword(), axe()).advantage, 1);
  assert.equal(settleTriangle(sword(), lance()).advantage, -1);
  assert.equal(settleTriangle(sword(), sword()).advantage, 0);
  assert.equal(settleTriangle(sword({ rules: ["reverseTriangle"] }), axe()).advantage, -1);

  // Handed the advantage: against whatever the weapons say, unless both are
  const grant = { skill: "Grant", grants: true };
  assert.equal(settleTriangle(sword({ parts: [grant] }), lance()).advantage, 1);
  assert.deepEqual(settleTriangle(sword({ parts: [grant] }), lance()).skills, ["Grant"]);
  assert.equal(settleTriangle(sword({ parts: [grant] }), lance({ rules: ["alwaysAdvantage"] })).advantage, -1, "both: the weapons decide");
  assert.equal(settleTriangle(sword({ parts: [grant] }), {}).advantage, 0, "an unarmed foe");

  // Never at a disadvantage: neither has the advantage then, whoever handed it out
  const safe = { skill: "Safe", safe: true };
  const spared = settleTriangle(sword({ parts: [safe] }), lance());
  assert.equal(spared.advantage, 0);
  assert.deepEqual(spared.by.spared, ["Safe"]);
  assert.equal(settleTriangle(sword({ parts: [safe] }), axe()).advantage, 1, "its own advantage stays");
  assert.equal(settleTriangle(sword({ parts: [safe] }), axe({ rules: ["alwaysAdvantage"] })).advantage, 0);
  assert.equal(settleTriangle(sword({ parts: [grant] }), lance({ rules: ["noTriangle"] })).advantage, 0);
});

test("what the triangle gives and takes is multiplied, a skill counting once for its unit", () => {
  const twice = { skill: "Twice", times: 2 };
  const one = settleTriangle({ category: "sword", parts: [twice] }, { category: "axe" });
  assert.deepEqual([one.times, one.hit, one.damage], [2, 2, 2]);
  assert.deepEqual(one.skills, ["Twice"]);
  assert.equal(settleTriangle({ category: "sword", parts: [twice, twice] }, { category: "axe" }).times, 2, "the skill and the change it left");
  assert.equal(settleTriangle({ category: "sword", parts: [twice] }, { category: "axe", parts: [twice] }).times, 4, "one on each side");
  assert.equal(settleTriangle({ category: "sword", parts: [twice, { skill: "Thrice", times: 3 }] }, { category: "axe" }).times, 6);
  assert.equal(settleTriangle({ category: "sword", parts: [twice] }, { category: "sword" }).times, 1, "nothing to multiply");
});

test("a part of the triangle is negated for both units, at a disadvantage or always", () => {
  const even = { skill: "Even", negates: "hit", at: "disadvantage" };
  const down = settleTriangle({ category: "sword", parts: [even] }, { category: "lance" });
  assert.deepEqual([down.advantage, down.hit, down.damage], [-1, 0, 1]);
  assert.deepEqual(down.by.negated, ["Even"]);
  const up = settleTriangle({ category: "sword", parts: [even] }, { category: "axe" });
  assert.deepEqual([up.advantage, up.hit, up.damage], [1, 1, 1], "not while it has the advantage");
  const held = settleTriangle({ category: "axe" }, { category: "lance", parts: [even] });
  assert.deepEqual([held.advantage, held.hit], [1, 0], "on the unit that is attacked as well");
  assert.equal(settleTriangle({ category: "sword", parts: [{ skill: "None", negates: "all" }] }, { category: "axe" }).damage, 0);
});

test("for one attack: what the triangle gives is multiplied, what it takes is lessened", () => {
  assert.deepEqual(triangleSwing({ boon: 4, bane: 0 }, { hit: 10, damage: 1 }), { hit: 30, damage: 3 });
  assert.deepEqual(triangleSwing({ boon: 4, bane: 0 }, { hit: -15, damage: -2 }), { hit: 15, damage: 2 });
  assert.deepEqual(triangleSwing({ boon: 4, bane: 0 }, { hit: 0, damage: 0 }), { hit: 0, damage: 0 });
  assert.deepEqual(triangleSwing({ boon: 4, bane: 0 }, { hit: 0, damage: -1 }), { hit: 0, damage: 1 }, "each by its own sign");
  assert.deepEqual(triangleSwing({ bane: 0.5 }, { hit: -15, damage: -3 }), { hit: 8, damage: 2 }, "half a penalty, rounded towards none");
});

/* -------------------------------------------- */
/*  In a Fight                                  */
/* -------------------------------------------- */

test("the triangle in a fight: Hit and damage for the unit with the advantage, taken off its foe", () => {
  const plan = planExchange(A(), B({ weapon: AXE }));
  const even = planExchange(A(), B());
  assert.deepEqual(plan.triangle, { advantage: "initiator", rank: "E", hit: E.hit, damage: E.damage });
  assert.equal(plan.initiator.triangleHit, E.hit);
  assert.equal(plan.defender.triangleHit, -E.hit);
  assert.equal(plan.initiator.damage, even.initiator.damage + E.damage);
  assert.equal(plan.defender.damage, even.defender.damage - E.damage);
});

test("Trilemma: doubled for both when its unit starts the fight, and until its next turn starts", () => {
  const on = () => skill("Trilemma", { active: true });
  const plain = planExchange(A(), B({ weapon: AXE }));
  const plan = planExchange(A({ skills: [on()] }), B({ weapon: AXE }));
  assert.equal(plan.triangle.times, 2);
  assert.deepEqual(plan.triangle.skills, ["Trilemma"]);
  assert.deepEqual([plan.initiator.triangleHit, plan.initiator.triangleDamage], [2 * E.hit, 2 * E.damage]);
  assert.deepEqual([plan.defender.triangleHit, plan.defender.triangleDamage], [-2 * E.hit, -2 * E.damage]);
  assert.equal(plan.initiator.damage, plain.initiator.damage + E.damage);
  assert.equal(plan.defender.damage, plain.defender.damage - E.damage);
  assert.equal(plan.initiator.hit, Math.min(plain.initiator.hit + E.hit, 100));

  // At a disadvantage it is the unit that loses twice as much
  const worse = planExchange(A({ skills: [on()] }), B({ weapon: LANCE }));
  assert.deepEqual([worse.initiator.triangleHit, worse.initiator.triangleDamage], [-2 * F.hit, -2 * F.damage]);

  // Switched off, or attacked: nothing
  assert.equal(planExchange(A({ skills: [skill("Trilemma")] }), B({ weapon: AXE })).triangle.times, undefined);
  assert.equal(planExchange(B({ weapon: AXE }), A({ skills: [on()] })).triangle.times, undefined);

  // The fight leaves it on its unit until its next turn starts, whatever the weapons were
  const { result } = play(A({ skills: [on()] }), B(), HITS);
  const granted = result.granted.find((entry) => entry.to === "initiator");
  assert.deepEqual(granted.change.effects, [{ triangle: { times: 2 } }]);
  assert.deepEqual([granted.change.name, granted.change.ends, granted.change.turns], ["Trilemma", "turnStart", 1]);

  // With that change it is doubled when its unit is attacked too, and with the switch off
  const lasting = { timed: [granted.change] };
  const attacked = planExchange(B({ weapon: AXE }), { ...A({ skills: [skill("Trilemma")] }), ...lasting });
  assert.equal(attacked.triangle.times, 2);
  assert.equal(attacked.defender.triangleHit, 2 * E.hit);

  // And a second fight it starts in the same turn is doubled, not quadrupled
  assert.equal(planExchange({ ...A({ skills: [on()] }), ...lasting }, B({ weapon: AXE })).triangle.times, 2);

  // Two units with it double it twice
  assert.equal(planExchange(A({ skills: [on()] }), { ...B({ weapon: AXE }), ...lasting }).triangle.times, 4);
});

test("Deeper Knowledge: four times what the triangle gives, nothing of what it takes, for that attack", () => {
  const sage = () => A({ skills: [skill("Deeper Knowledge")] });
  const plan = planExchange(sage(), B({ weapon: AXE }));
  assert.equal(plan.initiator.chances.attack.length, 1);
  assert.equal(plan.initiator.chances.attack[0].chance, 8, "DEX 8");

  // With the advantage: the roll for it comes before the attack's own
  const fired = play(sage(), B({ weapon: AXE }), [8, 1, 100, 1, 100]);
  assert.deepEqual(dealt(fired.result, "initiator"), [plan.initiator.damage + (3 * E.damage)]);
  assert.equal(fired.result.attacks[0].hitChance, Math.min(plan.initiator.hit + (3 * E.hit), 100));
  assert.deepEqual(dealt(fired.result, "defender"), [plan.defender.damage], "the foe's attacks are as they were");
  const failed = play(sage(), B({ weapon: AXE }), [9, 1, 100, 1, 100]);
  assert.deepEqual(dealt(failed.result, "initiator"), [plan.initiator.damage]);

  // At a disadvantage: the attack loses nothing to the triangle
  const down = planExchange(sage(), B({ weapon: LANCE }));
  const even = planExchange(A(), B());
  const freed = play(sage(), B({ weapon: LANCE }), [8, 1, 100, 1, 100]);
  assert.equal(down.initiator.damage, even.initiator.damage - F.damage);
  assert.deepEqual(dealt(freed.result, "initiator"), [even.initiator.damage]);
  assert.equal(freed.result.attacks[0].hitChance, even.initiator.hit);
  assert.deepEqual(dealt(freed.result, "defender"), [down.defender.damage], "the foe keeps what the triangle gives it");

  // With Trilemma what is multiplied is what is already doubled
  const both = () => A({ skills: [skill("Deeper Knowledge"), skill("Trilemma", { active: true })] });
  const doubled = planExchange(both(), B({ weapon: AXE }));
  const rolled = play(both(), B({ weapon: AXE }), [8, 1, 100, 1, 100]);
  assert.deepEqual(dealt(rolled.result, "initiator"), [doubled.initiator.damage + (3 * 2 * E.damage)]);

  // Where the triangle does nothing, it has nothing to roll for
  assert.equal(planExchange(sage(), B()).initiator.chances.attack.length, 0);
  assert.equal(planExchange(B({ weapon: AXE }), sage()).defender.chances.attack.length, 1, "when attacked as well");
});

test("Adaptation: at a disadvantage the triangle changes nobody's Hit", () => {
  const sergeant = () => A({ skills: [skill("Adaptation")] });
  const plain = planExchange(A(), B({ weapon: LANCE }));
  const plan = planExchange(sergeant(), B({ weapon: LANCE }));
  assert.equal(plan.triangle.advantage, "defender");
  assert.deepEqual(plan.triangle.negated, ["Adaptation"]);
  assert.deepEqual([plan.initiator.triangle, plan.initiator.triangleHit, plan.initiator.triangleDamage], [-1, 0, -F.damage]);
  assert.deepEqual([plan.defender.triangle, plan.defender.triangleHit, plan.defender.triangleDamage], [1, 0, F.damage]);
  assert.equal(plan.initiator.hit, plain.initiator.hit + F.hit);
  assert.equal(plan.defender.hit, Math.max(plain.defender.hit - F.hit, 0));
  assert.equal(plan.initiator.damage, plain.initiator.damage, "damage stays");

  // With the advantage it changes nothing, and when attacked at a disadvantage it holds as well
  const up = planExchange(sergeant(), B({ weapon: AXE }));
  assert.equal(up.initiator.triangleHit, E.hit);
  assert.equal(up.triangle.negated, undefined);
  assert.equal(planExchange(B({ weapon: LANCE }), sergeant()).defender.triangleHit, 0);
});

test("Adaptation: +10 Hit against infantry while mounted waits for the Dismounting module", () => {
  const rider = (qualities = "Mounted") => A({ qualities, skills: [skill("Adaptation")] });
  const base = planExchange(A({ qualities: "Mounted" }), B());
  assert.equal(planExchange(rider(), B()).initiator.base.accuracy, base.initiator.base.accuracy, "no such module yet");
  assert.ok(FEO.optionalAwaited.includes("dismounting"));
  assert.equal("dismounting" in FEO.optional, false, "once the module is built, take it off the awaited list");

  withModule("dismounting", { enabled: true }, () => {
    assert.equal(planExchange(rider(), B()).initiator.base.accuracy, base.initiator.base.accuracy + 10);
    assert.equal(planExchange(rider("Flying"), B()).initiator.base.accuracy, base.initiator.base.accuracy + 10);
    assert.equal(planExchange(rider(), B({ qualities: "Mounted" })).initiator.base.accuracy, base.initiator.base.accuracy, "not against a rider");
    assert.equal(planExchange(rider(), B({ qualities: "Flying" })).initiator.base.accuracy, base.initiator.base.accuracy);
    assert.equal(planExchange(rider(""), B()).initiator.base.accuracy, base.initiator.base.accuracy, "not on foot");
  });
});

test("Assault: the advantage against weapons outside the triangle of its own, and outside any", () => {
  const master = (weapon = {}) => A({ weapon, skills: [skill("Assault")] });
  const tome = planExchange(master(), B({ weapon: FIRE }));
  assert.equal(tome.triangle.advantage, "initiator");
  assert.deepEqual(tome.triangle.skills, ["Assault"]);
  assert.equal(tome.initiator.triangleHit, E.hit, "by its rank with its own weapon");
  assert.equal(planExchange(master(), B({ weapon: BOW })).triangle.advantage, "initiator", "a weapon in no triangle");

  // Within its own triangle the weapons decide
  assert.equal(planExchange(master(), B({ weapon: LANCE })).triangle.advantage, "defender");
  assert.equal(planExchange(master(), B({ weapon: AXE })).triangle.skills, undefined);
  assert.equal(planExchange(master(), B()).triangle.advantage, null);

  // With a bow, which stands in no triangle, every weapon is outside; and when attacked as well
  const archer = planExchange(master(BOW), B(), { distance: 2 });
  assert.equal(archer.triangle.advantage, "initiator");
  assert.equal(archer.initiator.triangleHit, F.hit);
  assert.equal(planExchange(B({ weapon: FIRE }), master()).triangle.advantage, "defender");

  // Not against an unarmed foe, and two of them cancel out
  assert.equal(planExchange(master(), B({ weapon: null })).triangle.advantage, null);
  assert.equal(planExchange(master(), B({ weapon: FIRE, skills: [skill("Assault")] })).triangle.advantage, null);
});

test("Blessing of Vesta: the advantage against Fire tomes, whatever its unit wields", () => {
  const blessed = (weapon = {}) => A({ weapon, skills: [skill("Blessing of Vesta")] });
  assert.equal(planExchange(blessed(), B({ weapon: FIRE })).triangle.advantage, "initiator");
  assert.equal(planExchange(B({ weapon: FIRE }), blessed()).triangle.advantage, "defender");
  assert.equal(planExchange(A({ weapon: WIND }), B({ weapon: FIRE })).triangle.advantage, "defender", "Fire beats Wind");
  assert.equal(planExchange(blessed(WIND), B({ weapon: FIRE })).triangle.advantage, "initiator", "but not this unit");
  assert.equal(planExchange(blessed(), B({ weapon: WIND })).triangle.advantage, null, "only against Fire");
  assert.equal(planExchange(blessed({ category: "water", range: "1-2", damageStat: "mag" }), B({ weapon: FIRE })).triangle.skills, undefined, "Water beats Fire anyway");
});

test("Symbiosis: no disadvantage with Dark and Light tomes, and Dark tomes effective against Terrors", () => {
  const razgriz = (weapon) => A({ weapon, skills: [skill("Symbiosis")] });
  const plan = planExchange(razgriz(FLUX), B({ weapon: SHINE }));
  assert.equal(planExchange(A({ weapon: FLUX }), B({ weapon: SHINE })).triangle.advantage, "defender", "Light beats Dark");
  assert.equal(plan.triangle.advantage, null);
  assert.deepEqual(plan.triangle.spared, ["Symbiosis"]);
  assert.deepEqual([plan.initiator.triangleHit, plan.defender.triangleHit, plan.defender.triangleDamage], [0, 0, 0], "the foe gains nothing either");
  assert.ok(plan.initiator.skills.includes("Symbiosis"));

  // Its own advantage stays, it holds when attacked, and with another weapon it does nothing
  assert.equal(planExchange(razgriz(SHINE), B({ weapon: FLUX })).triangle.advantage, "initiator");
  assert.equal(planExchange(B({ weapon: { ...FIRE, category: "anima" } }), razgriz(SHINE)).triangle.advantage, null, "Anima beats Light");
  assert.equal(planExchange(razgriz({}), B({ weapon: LANCE })).triangle.advantage, "defender");
  assert.equal(planExchange(razgriz(FLUX), B({ weapon: SHINE, skills: [skill("Triangle Adept")] })).triangle.advantage, null);

  // Dark tomes, and only they, are effective against Terrors
  assert.deepEqual(planExchange(razgriz(FLUX), B({ qualities: "Terror" })).initiator.effective, ["Terror"]);
  assert.deepEqual(planExchange(razgriz(SHINE), B({ qualities: "Terror" })).initiator.effective, []);
  assert.deepEqual(planExchange(A({ weapon: FLUX }), B({ qualities: "Terror" })).initiator.effective, []);
});

/* -------------------------------------------- */
/*  What Else Reads the Triangle                */
/* -------------------------------------------- */

test("Breaking goes by who has the advantage in the end: granted it breaks, spared it does not", () => {
  withModule("breaking", { enabled: true, mode: "both" }, () => {
    assert.equal(planExchange(A(), B({ weapon: AXE })).initiator.breaks, true);
    assert.equal(planExchange(A({ skills: [skill("Assault")] }), B({ weapon: FIRE })).initiator.breaks, true, "an advantage a skill handed out");
    assert.equal(planExchange(B({ weapon: SHINE }), A({ weapon: FLUX })).initiator.breaks, true);
    assert.equal(planExchange(B({ weapon: SHINE }), A({ weapon: FLUX, skills: [skill("Symbiosis")] })).initiator.breaks, false, "no disadvantage, no Break");
    assert.equal(planExchange(A({ skills: [skill("Trilemma", { active: true })] }), B({ weapon: AXE })).initiator.breaks, true, "multiplied or not");
    assert.equal(planExchange(B({ weapon: LANCE }), A({ skills: [skill("Adaptation")] })).initiator.breaks, true, "the advantage is still there");
  });
});

test("Parity keeps the triangle of the weapons and cancels what skills make of it", () => {
  const parity = () => skill("Parity", { active: true });
  const doubled = planExchange(A({ skills: [parity(), skill("Trilemma")] }), B({ weapon: AXE, skills: [skill("Deeper Knowledge")] }));
  assert.equal(doubled.parity, "Parity");
  assert.deepEqual(doubled.triangle, { advantage: "initiator", rank: "E", hit: E.hit, damage: E.damage });
  assert.equal(doubled.defender.chances.attack.length, 0);
  assert.equal(planExchange(A({ skills: [parity(), skill("Assault")] }), B({ weapon: FIRE })).triangle.advantage, null);
  assert.equal(planExchange(A({ weapon: FLUX, skills: [parity(), skill("Symbiosis")] }), B({ weapon: SHINE })).triangle.advantage, "defender");

  // A skill that was declared before the fight stays, as every such skill does
  const declared = planExchange(A({ skills: [parity(), skill("Trilemma", { active: true })] }), B({ weapon: AXE }));
  assert.equal(declared.triangle.times, 2);
});

test("a skill of the foe that cancels skills cancels what they make of the triangle", () => {
  const nihil = made("Nihil", [{ rules: ["nihil"] }]);
  const assault = { ...skill("Assault"), nihil: true };
  assert.equal(planExchange(A({ skills: [assault] }), B({ weapon: FIRE, skills: [nihil] })).triangle.advantage, null);
  const trilemma = planExchange(A({ skills: [skill("Trilemma", { active: true })] }), B({ weapon: AXE, skills: [nihil] }));
  assert.equal(trilemma.triangle.times, undefined, "a skill that is chosen does nothing against it");
  assert.deepEqual(trilemma.initiator.stopped, ["Trilemma"]);
});

/* -------------------------------------------- */
/*  What One Weapon Hands to the Next           */
/* -------------------------------------------- */

test("a handover: shares of the last weapon of a kind, for the first attack since the weapon was taken in hand", () => {
  const handover = { skill: "Symbiosis", from: ["dark"], might: 50, hit: 25, critical: 50 };
  const last = [{ category: "dark", name: "Flux", might: 9, hit: 70, crit: 10 }];
  assert.deepEqual(handedOver([handover], { fresh: true, last }), { skill: "Symbiosis", weapon: "Flux", might: 4, hit: 17, critical: 5 });
  assert.equal(handedOver([handover], { fresh: false, last }), null, "it has attacked already");
  assert.equal(handedOver([handover], { fresh: true, last: [{ category: "light", might: 9, hit: 70, crit: 10 }] }), null, "no weapon of that kind");
  assert.equal(handedOver([handover], { fresh: true, last: [] }), null);
  assert.equal(handedOver([handover], null), null);
  assert.equal(handedOver([], { fresh: true, last }), null);

  // The last weapon of each kind is remembered, the latest first
  const now = lastWielded(last, { category: "light", name: "Shine", might: 6, hit: 80, crit: 5 });
  assert.deepEqual(now.map((weapon) => weapon.name), ["Shine", "Flux"]);
  assert.deepEqual(lastWielded(now, { category: "dark", name: "Nosferatu", might: 10, hit: 60, crit: 0 }).map((weapon) => weapon.name), ["Nosferatu", "Shine"]);
  assert.deepEqual(cleanWielded(now), now);
  assert.equal(cleanWielded([{ category: "shadow" }]), null);
  assert.equal(cleanWielded("Flux"), null);
  assert.equal(cleanWielded([last[0], last[0]]), null, "one for each kind");
});

test("Symbiosis: a Light tome takes from the last Dark tome, and a Dark one from the last Light", () => {
  const wielded = (fresh = true) => ({ fresh, last: [{ category: "dark", name: "Flux", might: 9, hit: 70, crit: 10 }] });
  const razgriz = (extra = {}) => ({ ...A({ weapon: SHINE, stats: { spd: 14 }, skills: [skill("Symbiosis")] }), ...extra });
  const plain = planExchange(razgriz(), B());
  const plan = planExchange(razgriz({ wielded: wielded() }), B());
  assert.deepEqual(plan.initiator.handed, { skill: "Symbiosis", weapon: "Flux", might: 4, hit: 17, critical: 5, damage: 4 });
  assert.equal(plan.initiator.damage, plain.initiator.damage + 4);
  assert.equal(plan.initiator.hit, Math.min(plain.initiator.hit + 17, 100));
  assert.equal(plan.initiator.crit, plain.initiator.crit + 5);
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.damage), [plain.initiator.damage + 4, plain.initiator.damage], "the first attack alone");

  // The fight deals what the forecast shows, and tells that the tome has attacked
  const { result } = play(razgriz({ wielded: wielded() }), B(), HITS);
  assert.deepEqual(dealt(result, "initiator"), [plain.initiator.damage + 4, plain.initiator.damage]);
  assert.equal(result.initiator.swung, true);
  assert.equal(result.defender.swung, undefined, "only for a unit whose skills ask");

  // Not once the tome has attacked, not from a Light tome to a Light tome, and a Dark tome takes from a Light
  assert.equal(planExchange(razgriz({ wielded: wielded(false) }), B()).initiator.handed, undefined);
  const lights = { fresh: true, last: [{ category: "light", name: "Shine", might: 6, hit: 80, crit: 5 }] };
  assert.equal(planExchange(razgriz({ wielded: lights }), B()).initiator.handed, undefined);
  const dark = planExchange({ ...A({ weapon: FLUX, skills: [skill("Symbiosis")] }), wielded: lights }, B());
  assert.deepEqual(dark.initiator.handed, { skill: "Symbiosis", weapon: "Shine", might: 3, hit: 20, critical: 2, damage: 3 });

  // A unit that is attacked and answers makes its first attack too; one that cannot answer keeps it
  const answered = planExchange(B(), razgriz({ wielded: wielded() }));
  assert.equal(answered.defender.handed.might, 4);
  const near = { ...A({ weapon: { ...SHINE, range: "1" }, skills: [skill("Symbiosis")] }), wielded: wielded() };
  const far = play(B({ weapon: BOW }), near, HITS, { distance: 2 });
  assert.equal(far.plan.defender.handed, undefined);
  assert.equal(far.result.defender.swung, undefined);

  // The Might counts as the tome's own: an effective weapon multiplies it
  const slayer = planExchange({ ...A({ weapon: FLUX, skills: [skill("Symbiosis")] }), wielded: lights }, B({ qualities: "Terror" }));
  assert.equal(slayer.initiator.handed.damage, 3 * slayer.initiator.mightMultiplier);
});

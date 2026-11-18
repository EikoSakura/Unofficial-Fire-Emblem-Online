/**
 * Tests for what the reading of the skills that no earlier step had re-read found (Step 34d of the skill
 * automation plan): the weapon types of Magic, Miracle at 1 HP, the auras of four Enemy-Exclusive skills, damage
 * gained as a fight begins, Rive, Role Model, Fists for bare hands, conditions on HP, and the check the build
 * makes of a skill that nothing accounts for.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { armedWith, lentEffects } from "../module/rules/actions.mjs";
import { standing } from "../module/rules/auras.mjs";
import { planExchange, playExchange, rollBudget } from "../module/rules/combat.mjs";
import { sufferDamage } from "../module/rules/events.mjs";
import { checkLend, lendOffers, lentBare } from "../module/rules/lending.mjs";
import { checkEffects, choicesOf, skillLends, unaccounted, weaponIs, weaponTypeOf } from "../module/rules/skills.mjs";
import { buildChange, cleanChange, grantChange, timedEntries } from "../module/rules/timed.mjs";
import { builtEffects, dice, fighter, skill, unit } from "./lib/fixtures.mjs";

/** Plan a fight and roll it out: every die comes up as `rest`. */
function play(initiator, defender, { rest = 50 } = {}) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  const { result, used } = playExchange(plan, () => rest, () => null, {});
  assert.ok(used <= rollBudget(plan), `the fight rolled ${used} dice, more than the ${rollBudget(plan)} it plans for`);
  return { plan, result };
}

// With 6 DEX and 5 LUK a unit has 5 Critical, which its foe's 5 Critical Avoid leaves nothing of: no critical
// roll is made. Its sword deals 5 + 10 STR - 6 DEF = 9, and hits at 86
const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const dealt = (result, side = "initiator") => result.attacks.filter((attack) => attack.side === side).map((attack) => attack.damage);

// A unit whose skills activate whatever is rolled
const sure = (who) => ({ ...who, activation: 100 });

/* -------------------------------------------- */
/*  The Weapon Types of Magic                   */
/* -------------------------------------------- */

const TYPED = ["Critical Focus", "Weapon Focus", "Weaponbreaker", "Weaponfaire", "Weaponkiller"].flatMap((name) => [name, `Improved ${name}`]);

test("the weapon-type skills offer the three Magic types the Effect names", () => {
  for ( const name of TYPED ) {
    const choices = choicesOf(builtEffects(name));
    const all = skill(name, { choice: "Dark and Light, Scrolls and Magicite" });
    assert.deepEqual(checkEffects(builtEffects(name)), [], name);
    assert.equal(choices.length, 11, name);
    for ( const choice of ["Anima", "Dark and Light", "Scrolls and Magicite"] ) assert.ok(choices.includes(choice), `${name}: ${choice}`);
    const lists = Object.fromEntries(all.effects.map((effect) => [effect.choice, effect.when.weapon ?? effect.when.foeWeapon]));
    assert.deepEqual(lists["Dark and Light"], FEO.magicTypes.darkLight.kinds, name);
    assert.deepEqual(lists["Scrolls and Magicite"], FEO.magicTypes.scrolls.kinds, name);
  }
});

test("Dark and Light counts Astral, and the third type counts Scrolls, Magicite, Arcanima and Chaos", () => {
  const { darkLight, scrolls, anima } = FEO.magicTypes;
  for ( const category of ["dark", "light", "astral"] ) assert.ok(weaponIs({ category }, darkLight.kinds), category);
  for ( const category of ["scroll", "magicite", "arcanima", "chaos"] ) assert.ok(weaponIs({ category }, scrolls.kinds), category);
  for ( const category of ["anima", "fire", "thunder", "wind", "water", "ice", "earth"] ) assert.ok(weaponIs({ category }, anima.kinds), category);
  assert.ok(!weaponIs({ category: "fire" }, darkLight.kinds));
  assert.ok(!weaponIs({ category: "dark" }, scrolls.kinds));
});

test("a tome picked for Art of War stands for its whole Magic type", () => {
  const fire = weaponTypeOf({ key: "fire", label: "FEO.WeaponType.fire", categories: ["fire"] });
  assert.deepEqual(fire, { key: "anima", label: "FEO.WeaponType.anima", categories: ["anima"] });
  assert.equal(weaponTypeOf({ key: "water", label: "", categories: ["water", "ice"] }).key, "anima");
  assert.equal(weaponTypeOf({ key: "light", label: "", categories: ["light"] }).key, "darkLight");
  assert.equal(weaponTypeOf({ key: "dark", label: "", categories: ["dark"] }).key, "darkLight");
  const bow = { key: "bow", label: "FEO.Proficiency.bow", categories: ["bow", "crossbow"] };
  assert.equal(weaponTypeOf(bow), bow, "any other kind is its own type");

  // What is lent for Anima holds with a Wind tome, as Weapon Focus for Anima does
  const lends = skill("Art of War").effects[0].act.grant.lends;
  const effects = lentEffects(lends, { wields: fire.categories, foes: weaponTypeOf({ key: "dark", label: "", categories: ["dark"] }).categories });
  assert.deepEqual(checkEffects(effects), []);
  assert.ok(weaponIs({ category: "wind" }, effects[0].when.weapon));
  assert.ok(weaponIs({ category: "light" }, effects[1].when.foeWeapon));
  assert.ok(!weaponIs({ category: "fire" }, effects[1].when.foeWeapon));
});

/* -------------------------------------------- */
/*  Miracle                                     */
/* -------------------------------------------- */

test("Miracle does not save a unit that is already at 1 HP", () => {
  const who = (hp) => unit({ hp, hpMax: 20, stats: { luk: 100 }, skills: [skill("Miracle")] });
  assert.equal(sufferDamage(who(2), 30, {}, dice(1)).hp, 1, "saved at 2 HP");
  assert.equal(sufferDamage(who(1), 30, {}, dice()).hp, 0, "at 1 HP nothing is rolled, and the blow is fatal");

  // In a fight as well: a unit at 1 HP whose Miracle would activate on any roll falls to the first hit
  const { result } = play(A(), sure(B({ hp: 1, skills: [skill("Miracle")] })));
  assert.equal(result.defender.hp, 0);
  assert.equal(play(A(), sure(B({ hp: 2, skills: [skill("Miracle")] }))).result.attacks[0].damage, 1, "at 2 HP it is left 1");
});

/* -------------------------------------------- */
/*  Four Auras Worded as the Players See Them   */
/* -------------------------------------------- */

const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
const placed = (id, side, j, skills = []) => ({ id, name: id, side, tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills });

test("Calm and Embolden strengthen the side that has them, Discord and Imbecile weaken its enemies", () => {
  const reaches = (name, side) => standing([placed("boss", "enemy", 0, [skill(name)]), placed("near", side, 3)], "near", measure).auras;
  for ( const name of ["Calm", "Embolden"] ) {
    assert.equal(reaches(name, "enemy").length, 1, `${name} reaches the holder's side`);
    assert.equal(reaches(name, "player").length, 0, `${name} leaves the players alone`);
    assert.equal(standing([placed("boss", "enemy", 0, [skill(name)])], "boss", measure).auras.length, 0, `${name} is not for its own unit`);
  }
  for ( const name of ["Discord", "Imbecile"] ) {
    assert.equal(reaches(name, "player").length, 1, `${name} reaches the players`);
    assert.equal(reaches(name, "enemy").length, 0, `${name} leaves the holder's side alone`);
  }
  assert.deepEqual(reaches("Calm", "enemy")[0].effects[0].combat, { hit: 10, critical: 10 });
  assert.deepEqual(reaches("Embolden", "enemy")[0].effects[0].combat, { dodge: 15, critAvoid: 5 });
  assert.deepEqual(reaches("Discord", "player")[0].effects[0].combat, { critical: -10, critAvoid: -10 });
  assert.deepEqual(reaches("Imbecile", "player")[0].effects[0].combat, { hit: -10, dodge: -10 });
  assert.equal(standing([placed("boss", "enemy", 0, [skill("Calm")]), placed("far", "enemy", 4)], "far", measure).auras.length, 0);
});

/* -------------------------------------------- */
/*  Damage Gained as a Fight Begins             */
/* -------------------------------------------- */

test("Iron Fist and Mistdancer add their damage to every attack of the fight they activate in", () => {
  // 20 SPD against 8 follows up: two attacks, of 9 damage each without the skill
  const quick = (skills = []) => A({ stats: { spd: 20, def: 9 }, skills });
  const plain = dealt(play(quick(), B()).result);
  assert.equal(plain.length, 2);

  // A quarter of 9 DEF, rounded down, on both
  assert.deepEqual(dealt(play(sure(quick([skill("Iron Fist")])), B()).result), plain.map((damage) => damage + 2));
  assert.deepEqual(dealt(play(quick([skill("Iron Fist")]), B(), { rest: 50 }).result), plain, "nothing where it does not activate");

  // A quarter of its Dodge, as it fights with it
  const misty = play(sure(quick([skill("Mistdancer")])), B());
  const dodge = misty.plan.initiator.unit.combat.dodge;
  assert.ok(dodge >= 4);
  assert.deepEqual(dealt(misty.result), plain.map((damage) => damage + Math.floor(dodge / 4)));
});

/* -------------------------------------------- */
/*  Rive                                        */
/* -------------------------------------------- */

test("Rive ignores a third of DEF at half HP or less, whatever the weapon, and nothing of RES", () => {
  const rive = [skill("Rive")];
  assert.deepEqual(skill("Rive").effects[0].when, { hp: { op: "le", percent: 50 } });
  const hit = (attacker) => planExchange(attacker, B({ stats: { def: 6, res: 6 } })).initiator.damage;

  // 6 DEF counts as 4
  assert.equal(hit(A({ hp: 15, skills: rive })), hit(A({ hp: 15 })) + 2);
  assert.equal(hit(A({ hp: 16, skills: rive })), hit(A({ hp: 16 })), "not above half HP");

  // A tome is resisted by RES, and so is a sword that adds Magic to its Might: Rive leaves RES as it is
  const tome = { name: "Fire", category: "fire", range: "1-2", damageStat: "mag" };
  const levin = { name: "Levin Sword", damageStat: "mag" };
  for ( const weapon of [tome, levin] ) {
    assert.equal(hit(A({ hp: 15, weapon, skills: rive })), hit(A({ hp: 15, weapon })), weapon.name);
  }
});

/* -------------------------------------------- */
/*  Role Model                                  */
/* -------------------------------------------- */

test("Role Model does not stack with itself, whoever grants it", () => {
  const grant = skill("Role Model").effects[0].grant;
  assert.equal(grant.unique, true);
  const from = (name) => cleanChange(buildChange(grant, { skill: "Role Model", from: name, giver: `Actor.${name}` }), checkEffects);
  assert.equal(from("Ada").unique, true, "kept as the change is saved");
  let list = grantChange([], from("Ada")).list;
  list = grantChange(list, from("Bo")).list;
  assert.equal(list.length, 1);
  assert.equal(list[0].from, "Bo", "the later one takes the place of the first");
  assert.equal(timedEntries(list).length, 1);

  // A change that does not say so still stands beside one of its name from another unit
  const plain = (name) => buildChange({ ...grant, unique: undefined }, { skill: "Rally", from: name });
  assert.equal(grantChange(grantChange([], plain("Ada")).list, plain("Bo")).list.length, 2);
  assert.deepEqual(checkEffects([{ proc: { on: "kill", sure: true }, grant: { to: "self", effects: [{ combat: { hit: 5 } }], ends: "turnEnd", unique: true } }]), []);
});

/* -------------------------------------------- */
/*  Fists for Bare Hands                        */
/* -------------------------------------------- */

test("Unarmed Combat, Verdant Faith and Metal Coffin lend Fists, which bare hands fight with", () => {
  for ( const name of ["Unarmed Combat", "Verdant Faith", "Metal Coffin"] ) {
    const entry = skill(name);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    const lend = entry.effects.find((effect) => effect.lend)?.lend;
    assert.equal(lend?.bare, true, name);
    assert.deepEqual(checkLend(lend), [], name);
  }
  assert.ok(checkLend({ weapon: "Fists", bare: true, hand: true }).length > 0);

  // Two of them lend one pair of Fists: offered once, and used by itself only where no weapon is in hand
  const skills = [skill("Unarmed Combat"), skill("Metal Coffin")];
  const self = unit({ skills }).self;
  const offers = lendOffers(skillLends(skills, self), {});
  assert.deepEqual(offers.map((offer) => [offer.name, offer.bare, offer.auto]), [["Fists", true, false]]);
  assert.equal(lentBare(offers, true), null, "a unit with a weapon in hand fights with that");
  assert.equal(lentBare(offers, false)?.name, "Fists");
  assert.equal(lentBare(lendOffers(skillLends([skill("Vantage")], self), {}), false), null, "nobody else has Fists to fall back on");

  // Attacked with nothing in its hand, the unit attacks back with them, with what its skills give it for Fists
  const bare = B({ weapon: null, skills });
  assert.equal(planExchange(A(), bare).defender.blocked, "unarmed");
  const armed = armedWith(bare, lentBare(offers, false).arm);
  const plan = planExchange(A(), armed);
  assert.equal(plan.defender.blocked, null);
  assert.equal(plan.defender.unit.weapon.name, "Fists");
  const { result } = play(A(), armed);
  assert.equal(dealt(result, "defender").length, 2, "Unarmed Combat strikes twice with Fists");
});

/* -------------------------------------------- */
/*  Conditions on HP                            */
/* -------------------------------------------- */

test("a condition on HP is read once as the fight begins: Chivalry lasts once the foe is hurt", () => {
  const quick = (skills = []) => A({ stats: { spd: 20 }, skills });
  const plain = dealt(play(quick(), B()).result);
  assert.equal(plain.length, 2);
  assert.deepEqual(dealt(play(quick([skill("Chivalry")]), B()).result), plain.map((damage) => damage + 2), "on the second attack too");
  assert.deepEqual(dealt(play(quick([skill("Chivalry")]), B({ hp: 29 })).result), plain, "not against a foe that is hurt already");
  assert.deepEqual(dealt(play(quick([skill("Pragmatism")]), B({ hp: 29 })).result), plain.map((damage) => damage + 2));
  assert.deepEqual(dealt(play(quick([skill("Pragmatism")]), B()).result), plain, "not on the second attack against a foe that was at full HP");
});

/* -------------------------------------------- */
/*  The Check of the Build                      */
/* -------------------------------------------- */

test("the build stops at a skill with an Effect that nothing accounts for", () => {
  assert.equal(unaccounted({ effect: "Does a thing." }), true);
  assert.equal(unaccounted({ effect: "Does a thing.", effects: [] }), true, "listed with nothing is not enough");
  assert.equal(unaccounted({ effect: "" }), false, "a skill without an Effect needs nothing");
  assert.equal(unaccounted({ effect: "Does a thing.", effects: [{ combat: { hit: 5 } }] }), false);
  assert.equal(unaccounted({ effect: "+5 Hit", boost: true }), false);
  assert.equal(unaccounted({ effect: "Does a thing.", usage: "action" }), false);
  assert.equal(unaccounted({ effect: "Does a thing.", note: "The Game Master decides." }), false);
  assert.equal(unaccounted({ effect: "Does a thing.", left: "The table moves the unit." }), false);
  assert.equal(unaccounted({ effect: "Does a thing.", note: "  " }), true);
});

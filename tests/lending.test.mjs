/**
 * Tests for weapons a skill lends its unit and for longer reach (see `module/rules/lending.mjs`): a weapon the
 * unit does not carry, picked among several or used by itself from where the weapon in hand does not reach; a
 * weapon that reaches further for one attack, with what stands between checked; an attack on the unit behind
 * the target; a volley over a square; and a tome cast as its unit is hit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { armedWith, checkAct } from "../module/rules/actions.mjs";
import { WEAPON_RANGE, areaCentres, areaTiles, checkArea } from "../module/rules/areas.mjs";
import { parseRange, planExchange, rangeHole, reaches, resolveExchange, spreadForecast } from "../module/rules/combat.mjs";
import { standsBetween } from "../module/rules/forced.mjs";
import {
  LENT_PICK, armOf, attackWith, bestRank, castArm, checkLend, lendOffers, lentArms, lentAt, lentRange, proficientWith, withArms
} from "../module/rules/lending.mjs";
import { surroundings } from "../module/rules/positions.mjs";
import { checkEffects, coverageOf, skillLends } from "../module/rules/skills.mjs";
import { canUse, checkUsage, spendSkill, usedUp } from "../module/rules/skill-usage.mjs";
import { checkPicks } from "../module/rules/picks.mjs";
import { FEO } from "../module/config.mjs";
import { readFileSync } from "node:fs";
import { arsenal, builtEffects, dice, fighter, made, skill } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(new URL("../packs-src/skills/effects.json", import.meta.url), "utf8")).skills;

const STEP = ["Aurablast", "Shadowgift", "Vortex", "Animus", "Animose", "Battery", "Cannon", "Firebreathing", "Longarm", "Breath Weapon",
  "Draconic Heritage", "Spellshield"];

const ranks = (table) => Object.fromEntries(Object.entries(table).map(([key, rank]) => [key, { rank, wexp: 0 }]));
const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });
const FIRE = { name: "Fire", category: "fire", range: "1-2", might: 4, hit: 80, damageStat: "mag" };
const BOW = { name: "Iron Bow", category: "bow", range: "2", might: 6 };

/** A unit as its skills are asked about it outside of a fight. */
function selfOf(unit, more = {}) {
  const weapon = unit.weapon ? { ...unit.weapon, reach: parseRange(unit.weapon.range, unit.stats) } : null;
  return { hp: unit.hp, hpMax: unit.hpMax, level: unit.level, stats: unit.stats, weapon, proficiencies: unit.proficiencies, ...more };
}

/** The weapon in a unit's hand, as what is lent to the hand asks about it. */
const heldOf = (unit) => (unit.weapon ? { id: unit.weapon.id, name: unit.weapon.name, category: unit.weapon.category, uses: unit.weapon.uses, wexp: unit.weapon.wexp, broken: false } : null);

/** What a unit's skills lend it as it stands. */
const offersOf = (unit, more = {}) => lendOffers(skillLends(unit.skills, selfOf(unit, more)), { proficiencies: unit.proficiencies, held: heldOf(unit) });

/* -------------------------------------------- */
/*  The Parts                                   */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know, and leave nothing to the table", () => {
  for ( const name of STEP ) {
    const entry = listed[name];
    assert.deepEqual(checkEffects(builtEffects(name)), [], name);
    assert.deepEqual(checkEffects(entry.effects), [], `${name}, as it is written by hand`);
    assert.deepEqual(checkUsage(entry.usage), [], name);
    assert.deepEqual(checkPicks(entry.picks, entry.effects), [], name);
    assert.equal(entry.left, undefined, name);
    assert.equal(coverageOf({ effect: "x", listed: true, left: entry.left ?? "" }), "done", name);
  }
});

test("a typing mistake in what a skill lends does not pass silently", () => {
  assert.deepEqual(checkLend({ weapon: "Arclight", range: "2", hand: true }), []);
  assert.deepEqual(checkLend({ tomes: { category: "wind", range: "1-2" }, rank: "best" }), []);
  assert.ok(checkLend({ weapon: "Fire", tomes: { category: "fire" } }).length, "names or a kind, not both");
  assert.ok(checkLend({}).length, "it says what it lends");
  assert.ok(checkLend({ weapon: "Fire", rank: "worst" }).length);
  assert.ok(checkLend({ weapon: "Fire", wexp: -1 }).length);
  assert.ok(checkLend({ weapon: "Fire", hand: true, cast: true }).length);
  assert.ok(checkLend({ weapon: "Fire", better: { skill: "X" } }).length);
  assert.ok(checkLend({ weapon: "Fire", stat: "luk" }).length);
  assert.ok(checkLend({ tomes: { category: "tome" } }).length);
  assert.ok(checkLend({ weapon: "Fire" }, { lend: {}, combat: { hit: 5 } }).length, "it stands alone in its effect");
  assert.ok(checkEffects([{ proc: { on: "struck", sure: true }, attack: { lent: true } }]).length, "an attack with a lent weapon needs one that is cast");
  assert.ok(checkEffects([{ proc: { on: "attack", sure: true }, betters: "Breath Weapon" }]).length, "what betters a weapon is rolled as it is lent");
  assert.deepEqual(checkEffects([{ proc: { on: "lend", stat: "dex" }, betters: "Breath Weapon" }]), []);
  assert.ok(checkEffects([{ weaponRange: { max: 2, open: 1 } }]).length);
  assert.ok(checkUsage({ kind: "declare", over: { cooldown: 3 } }).length, "only a skill with limited uses is used over them");
});

test("the build writes the numbers of the Weapons tab into what a skill names, and says so where the tab has no such weapon", () => {
  const [effect] = builtEffects("Aurablast");
  assert.deepEqual(effect.lend.arms.map((arm) => [arm.name, arm.category, arm.might, arm.hit, arm.crit, arm.range]), [["Arclight", "light", 6, 85, 10, "1-2"]]);
  const wrong = withArms([{ lend: { weapon: "Arclite" } }, { proc: { on: "attack", sure: true }, attack: { weapon: "Elwynd" } }], arsenal);
  assert.equal(wrong.problems.length, 2);
  const cast = withArms([{ proc: { on: "attack", sure: true }, attack: { weapon: "Force" } }], arsenal);
  assert.equal(cast.effects[0].attack.arm.hit, 85);
  assert.deepEqual(attackWith({ hit: -10 }, cast.effects[0].attack.arm), {
    hit: 75, might: 4, critical: 0, range: 2, from: 1, stat: "mag", against: "res", element: "anima", effect: "", name: "Force"
  });
});

/* -------------------------------------------- */
/*  A Weapon the Unit Does Not Carry            */
/* -------------------------------------------- */

test("Animus: the seven basic tomes are lent whatever the unit's ranks, wear nothing, earn half the weapon experience, and leave the sword alone", () => {
  const mage = { ...A({ skills: [skill("Animus")], stats: { mag: 9 } }), proficiencies: ranks({ sword: "E", fire: "F" }) };
  const offers = offersOf(mage);
  assert.deepEqual(offers.map((offer) => offer.name), ["Force", "Fire", "Wind", "Thunder", "Water", "Ice", "Stone"]);
  assert.ok(offers.every((offer) => offer.ready && offer.spends && !offer.auto && !offer.cast));
  const fire = offers.find((offer) => offer.name === "Fire");
  assert.deepEqual({ id: fire.arm.weapon.id, uses: fire.arm.weapon.uses, wexp: fire.arm.weapon.wexp, range: fire.arm.weapon.range, lent: fire.arm.weapon.lent },
    { id: null, uses: { value: 0, max: 0 }, wexp: 0.5, range: "1-2", lent: "Animus" });

  // Nothing is lent to attack with until one is taken up, and the one taken up is what the fight is fought with
  assert.equal(lentAt(offers, { picked: null, distance: 2, reaches: false }), null);
  assert.equal(lentAt(offers, { picked: fire.key, distance: 2, reaches: false }), fire);
  assert.deepEqual(lentRange(offers, { picked: fire.key, own: { min: 1, max: 1 } }), { min: 1, max: 2, lent: true });
  const plan = planExchange(armedWith(mage, fire.arm), B(), { distance: 2 });
  assert.equal(plan.initiator.blocked, null, "a sword would not reach 2 spaces");
  assert.equal(plan.initiator.unit.weapon.name, "Fire");
  assert.equal(plan.initiator.damage, 9 + 4 - 3, "MAG and the tome's Might against RES");
  assert.equal(plan.defender.blocked, "outOfRange", "the foe's sword does not answer from 2 spaces");
  const result = resolveExchange(plan, dice(1, 100, 100));
  assert.equal(result.initiator.usesSpent, 0, "a lent weapon has no uses to lose");
  assert.equal(result.initiator.wexp, 0.5, "half of Fire's 1 wEXP");
  assert.deepEqual(result.initiator.proficiencies.map((gain) => [gain.key, gain.after.wexp]), [["fire", 0.5]], "earned for Fire, without a rank in it");
  assert.equal(mage.weapon.name, "Iron Sword", "the weapon in hand stays in hand");
  assert.equal(mage.weapon.uses.value, 40);

  // While its skill sits out its cooldown the tomes are lent no longer
  const cooling = offersOf({ ...mage, skills: [skill("Animus", { cooldown: 3 })] });
  assert.ok(cooling.every((offer) => !offer.ready && (offer.reason === "cooldown") && (offer.wait === 2)));
  assert.equal(lentAt(cooling, { picked: cooling[1].key, distance: 2, reaches: false }), null);
  assert.equal(lentRange(cooling, { picked: cooling[1].key, own: { min: 1, max: 1 } }), null);
  assert.equal(spendSkill(skill("Animus").usage, skill("Animus").state).cooldown, 3 + FEO.skillUse.cooldownExtra);
});

test("Animose: the seven tomes of 1 range, of which Chill attacks at Midrange only", () => {
  const mage = A({ skills: [skill("Animose")] });
  const offers = offersOf(mage);
  assert.deepEqual(offers.map((offer) => offer.name), ["Surge", "Blaze", "Draft", "Charge", "Tide", "Chill", "Fissure"]);
  assert.ok(offers.every((offer) => offer.arm.weapon.wexp === (arsenal.named(offer.name).wexp / 2)));
  const chill = offers.find((offer) => offer.name === "Chill");
  assert.equal(planExchange(armedWith(mage, chill.arm), B(), { distance: 1 }).initiator.blocked, null);
  assert.equal(planExchange(armedWith(mage, chill.arm), B(), { distance: 2 }).initiator.blocked, "outOfRange");
  assert.deepEqual(lentRange(offers, { picked: chill.key, own: { min: 1, max: 1 } }), { min: 1, max: 1, lent: true });
});

test("Vortex: the Wind tomes of 1-2 range of the rank of the unit's best proficiency, or of the next below that has one", () => {
  const lend = builtEffects("Vortex")[0].lend;
  const names = (table) => lentArms(lend, ranks(table)).map((arm) => arm.name);
  assert.deepEqual(names({ sword: "A", wind: "F" }), ["Dire Wind", "Excalibur", "Tornado"]);
  assert.deepEqual(names({ sword: "F" }), ["Breeze", "Whirl"]);
  assert.deepEqual(names({ lance: "C", sword: "E" }), ["Arcwind", "Squall"]);
  assert.deepEqual(names({ axe: "STAR" }), ["Forseti", "Sylpheed"], "no Wind tome is of the top rank: those of the rank below");
  assert.equal(bestRank(ranks({ sword: "D", bow: "B", staff: "E" })), "B");
  assert.ok(lentArms(lend, ranks({ sword: "A" })).every((arm) => (arm.category === "wind") && (arm.range === "1-2")));

  // No cooldown and no cost: the weapon experience is the tome's own
  const knight = { ...A({ skills: [skill("Vortex")] }), proficiencies: ranks({ sword: "A" }) };
  const offers = offersOf(knight);
  assert.ok(offers.every((offer) => offer.ready && !offer.spends));
  const tornado = offers.find((offer) => offer.name === "Tornado");
  assert.equal(tornado.arm.weapon.wexp, 3);
  assert.equal(planExchange(armedWith(knight, tornado.arm), B(), { distance: 2 }).initiator.unit.weapon.category, "wind");
});

test("Breath Weapon: the Arc- tome of the type that was picked, at 1-2 range and with MAG, for a cooldown of 3 turns", () => {
  assert.equal(offersOf(A({ skills: [skill("Breath Weapon")] })).length, 0, "nothing is lent until a type is picked");
  const rider = A({ skills: [skill("Breath Weapon", { choice: "Ice" })], stats: { mag: 12 } });
  const offers = offersOf(rider);
  assert.deepEqual(offers.map((offer) => [offer.name, offer.arm.weapon.range, offer.arm.weapon.damageStat, offer.arm.weapon.wexp, offer.spends]),
    [["Arcice", "1-2", "mag", 0, true]], "Arcice reaches 2-3 on the Weapons tab: the skill has it attack at 1-2");
  assert.deepEqual([offers[0].better.skill, offers[0].better.arm.weapon.name, offers[0].better.arm.weapon.range], ["Draconic Heritage", "Rexfrost", "1-2"]);
  for ( const [type, arc] of [["Anima", "Arcforce"], ["Fire", "Arcfire"], ["Thunder", "Arcthunder"], ["Wind", "Arcwind"], ["Water", "Arcwater"], ["Earth", "Arcstone"]] ) {
    assert.deepEqual(offersOf(A({ skills: [skill("Breath Weapon", { choice: type })] })).map((offer) => offer.name), [arc]);
  }
  const plan = planExchange(armedWith(rider, offers[0].arm), B(), { distance: 1 });
  assert.equal(plan.initiator.blocked, null);
  assert.equal(plan.initiator.damage, 12 + 9 - 3, "MAG and Arcice's Might against RES");
  assert.ok(plan.order.includes("defender"), "an attack like any other: the foe answers where its weapon reaches");
  assert.equal(resolveExchange(plan, dice(1, 100, 100, 100, 100)).initiator.wexp, 0, "a breath is no tome: no weapon experience");

  // Not while Dismounted, which no unit is until that module tells it; and not while it cools down
  assert.equal(offersOf(rider, { dismounted: true }).length, 0);
  assert.equal(offersOf(rider, { dismounted: false }).length, 1);
  assert.ok(!offersOf(A({ skills: [skill("Breath Weapon", { choice: "Ice", cooldown: 2 })] }))[0].ready);
});

test("Draconic Heritage: a DEX% chance, as a fight is started with Breath Weapon, of the Rex- tome in its place; Nihil cancels it", () => {
  const rider = A({ skills: [skill("Breath Weapon", { choice: "Fire" }), skill("Draconic Heritage", { nihil: true })], stats: { dex: 14, mag: 10 } });
  const [offer] = offersOf(rider);
  const plan = planExchange(armedWith(rider, offer.arm), B(), { distance: 2 });
  const chance = plan.initiator.chances.lend.find((proc) => proc.betters === "Breath Weapon");
  assert.deepEqual([chance.skill, chance.chance], ["Draconic Heritage", 14]);
  const better = planExchange(armedWith(rider, offer.better.arm), B(), { distance: 2 });
  assert.equal(better.initiator.unit.weapon.name, "Rexflame");
  assert.equal(better.initiator.damage - plan.initiator.damage, 2, "Rexflame has 2 more Might than Arcfire");
  const nihil = made("Nihil", [{ rules: ["nihil"] }]);
  const stopped = planExchange(armedWith(rider, offer.arm), B({ skills: [nihil] }), { distance: 2 });
  assert.equal(stopped.initiator.chances.lend.length, 0);
  assert.equal(planExchange(B(), rider, { distance: 1 }).defender.chances.lend.length, 1, "it is only asked for by the unit that starts the fight");
});

/* -------------------------------------------- */
/*  Longer and Different Reach                  */
/* -------------------------------------------- */

test("Aurablast: with a melee weapon in hand the unit attacks from 2 spaces with the numbers of Arclight, and the weapon in hand is what wears", () => {
  const knight = { ...A({ skills: [skill("Aurablast")], stats: { mag: 7 } }), proficiencies: ranks({ sword: "E", light: "F" }) };
  const offers = offersOf(knight);
  assert.deepEqual(offers.map((offer) => [offer.name, offer.auto, offer.arm.weapon.range]), [["Arclight", true, "2"]]);
  assert.equal(lentAt(offers, { distance: 1, reaches: true }), null, "next to the foe the sword itself attacks");
  const lent = lentAt(offers, { distance: 2, reaches: false });
  assert.equal(lent.name, "Arclight");
  assert.equal(lentAt(offers, { distance: 3, reaches: false }), null);
  assert.deepEqual(lentRange(offers, { own: { min: 1, max: 1 } }), { min: 1, max: 2, lent: false }, "the map offers 1 to 2 spaces");
  assert.deepEqual({ id: lent.arm.weapon.id, wears: lent.arm.weapon.wears, trains: lent.arm.weapon.trains, wexp: lent.arm.weapon.wexp, uses: lent.arm.weapon.uses.value },
    { id: "A-weapon", wears: "sword", trains: "sword", wexp: 1, uses: 40 });

  const armed = armedWith(knight, lent.arm);
  const plan = planExchange(armed, B({ qualities: "Terror" }), { distance: 2 });
  assert.equal(plan.initiator.blocked, null);
  assert.equal(plan.initiator.unit.weapon.category, "light");
  assert.equal(plan.initiator.damage, 7 + (6 * FEO.effectiveMight.default) - 3, "MAG and Arclight's Might, effective against Terror, against RES");
  assert.equal(planExchange(knight, B(), { distance: 2 }).initiator.blocked, "outOfRange", "the sword alone does not reach");
  const hit = resolveExchange(planExchange(armed, B(), { distance: 2 }), dice(1, 100, 100, 1, 100, 100));
  assert.equal(hit.initiator.usesSpent, 1, "the sword pays the use for the hit");
  assert.deepEqual(hit.initiator.proficiencies.map((gain) => gain.key), ["sword"], "and earns the weapon experience of its kind");
  const miss = resolveExchange(planExchange(armed, B(), { distance: 2 }), dice(100, 100));
  assert.equal(miss.initiator.usesSpent, 0, "a melee weapon wears on a hit only, though the numbers are a tome's");

  // Not with a bow in hand, nor with a sword that is out of uses
  assert.equal(offersOf(A({ skills: [skill("Aurablast")], weapon: BOW })).length, 0);
  assert.equal(offersOf(A({ skills: [skill("Aurablast")], weapon: { uses: { value: 0, max: 40 } } })).length, 0);
});

test("Shadowgift: the same with the numbers of Carreau", () => {
  const knight = A({ skills: [skill("Shadowgift")], stats: { mag: 7 } });
  const lent = lentAt(offersOf(knight), { distance: 2, reaches: false });
  assert.deepEqual([lent.name, lent.arm.weapon.might, lent.arm.bare.hit, lent.arm.weapon.category, lent.arm.weapon.range], ["Carreau", 11, 65, "dark", "2"]);
  assert.equal(planExchange(armedWith(knight, lent.arm), B(), { distance: 2 }).initiator.damage, 7 + 11 - 3);
});

test("Battery: a Tome attacks from 3 to 10 spaces; once a map for nothing, then at -25 Hit and Critical with a cooldown of 3 turns", () => {
  const mage = (options = {}) => A({ skills: [skill("Battery", { active: true, ...options })], stats: { mag: 9 }, weapon: FIRE });
  assert.equal(planExchange(A({ weapon: FIRE }), B(), { distance: 7 }).initiator.blocked, "outOfRange");
  assert.equal(planExchange(mage(), B(), { distance: 7 }).initiator.blocked, null);
  assert.equal(planExchange(mage(), B(), { distance: 10 }).initiator.blocked, null);
  assert.equal(planExchange(mage(), B(), { distance: 11 }).initiator.blocked, "outOfRange");
  assert.equal(planExchange(A({ skills: [skill("Battery")], weapon: FIRE }), B(), { distance: 7 }).initiator.blocked, "outOfRange", "only while it is switched on");
  assert.equal(planExchange(A({ skills: [skill("Battery", { active: true })] }), B(), { distance: 7 }).initiator.blocked, "outOfRange", "only with a Tome");

  // A Tome of 1 range gains 3 to 10 spaces, not 2
  const blaze = { name: "Blaze", category: "fire", range: "1", might: 6, damageStat: "mag" };
  assert.deepEqual(rangeHole("1", {}, [{ max: 10, from: 3 }]), { above: 1, from: 3 });
  assert.equal(rangeHole("1-2", {}, [{ max: 10, from: 3 }]), null);
  assert.ok(reaches(blaze, 1, {}, [{ max: 10, from: 3 }]) && !reaches(blaze, 2, {}, [{ max: 10, from: 3 }]) && reaches(blaze, 3, {}, [{ max: 10, from: 3 }]));
  assert.equal(planExchange(A({ skills: [skill("Battery", { active: true })], weapon: blaze }), B(), { distance: 2 }).initiator.blocked, "outOfRange");

  // The first use of a map costs nothing more; a later one is at a penalty and starts a cooldown
  const first = planExchange(mage(), B(), { distance: 7 });
  const again = planExchange(mage({ used: 1 }), B(), { distance: 7 });
  assert.equal(again.initiator.hit, first.initiator.hit - 25);
  const usage = skill("Battery").usage;
  assert.deepEqual(canUse(usage, { used: 0 }), { ok: true, reason: null });
  assert.deepEqual(canUse(usage, { used: 1 }), { ok: true, reason: null, over: true });
  assert.deepEqual(canUse(usage, { used: 1, cooldown: 2 }), { ok: false, reason: "cooldown" });
  assert.equal(spendSkill(usage, { used: 0 }).cooldown, 0, "the use it has starts no cooldown");
  assert.deepEqual([spendSkill(usage, { used: 0 }).used, usedUp(usage, { used: 1 })], [1, true]);
  assert.equal(spendSkill(usage, { used: 1 }).cooldown, 3 + FEO.skillUse.cooldownExtra);

  // A fight from further than the Tome reaches spends it; one from where the Tome reaches by itself does not
  const far = resolveExchange(planExchange(mage(), B(), { distance: 7 }), dice(100, 100));
  assert.deepEqual(far.initiator.spent.map((entry) => entry.name), ["Battery"]);
  const near = resolveExchange(planExchange(mage(), B(), { distance: 2 }), dice(100, 100));
  assert.deepEqual(near.initiator.spent ?? [], []);
});

test("Longarm: from 2 spaces only where nothing stands between the two", () => {
  const spear = () => A({ skills: [skill("Longarm", { active: true })] });
  assert.equal(planExchange(spear(), B(), { distance: 2 }).initiator.blocked, null);
  assert.equal(planExchange(spear(), B(), { distance: 2, way: { blocked: null } }).initiator.blocked, null);
  for ( const what of ["unit", "terrain", "wall"] ) {
    assert.equal(planExchange(spear(), B(), { distance: 2, way: { blocked: what } }).initiator.blocked, "obstructed", what);
  }
  assert.equal(planExchange(spear(), B(), { distance: 1, way: { blocked: "unit" } }).initiator.blocked, null, "next to the foe nothing is between them");
  assert.equal(planExchange(A({ weapon: BOW }), B(), { distance: 2, way: { blocked: "unit" } }).initiator.blocked, null, "a bow shoots past what stands between");

  // What stands between: a tile the straight line crosses, and at a corner only both tiles beside it
  const at = (i, j) => ({ i, j });
  const on = (...tiles) => (tile) => tiles.some((other) => (other.i === tile.i) && (other.j === tile.j));
  assert.ok(standsBetween(at(0, 0), at(0, 2), on(at(0, 1))));
  assert.ok(!standsBetween(at(0, 0), at(0, 2), on(at(1, 1))));
  assert.ok(!standsBetween(at(0, 0), at(1, 1), on(at(0, 1))), "one of the two tiles beside the corner is free");
  assert.ok(standsBetween(at(0, 0), at(1, 1), on(at(0, 1), at(1, 0))));
  assert.ok(!standsBetween(at(0, 0), at(0, 1), on(at(0, 0), at(0, 1))), "the two themselves do not stand between");
});

/* -------------------------------------------- */
/*  Several Tiles at Once                       */
/* -------------------------------------------- */

const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
const token = (id, side, at, more = {}) => ({
  id, actor: `Actor.${id}`, name: id.toUpperCase(), side, tile: { i: at[0], j: at[1] }, hp: 20, hpMax: 20, level: 5,
  stats: { str: 10, mag: 4, def: 6, res: 3, dex: 8, spd: 8, luk: 5 }, skills: [], ...more
});
function onMap(a, b, others, { at = [0, 0], foeAt = [0, 1] } = {}) {
  const units = [token("a", "player", at), token("b", "enemy", foeAt), ...others];
  return [{ ...a, near: surroundings(units, "a", measure) }, { ...b, near: surroundings(units, "b", measure) }];
}

test("Firebreathing: a Fire tome also strikes the enemy on the tile right behind its target, in a straight line, with one attack of its own", () => {
  const breather = () => A({ skills: [skill("Firebreathing")], weapon: FIRE });
  const behind = [token("c", "enemy", [0, 2]), token("d", "enemy", [1, 1]), token("e", "player", [0, 3])];
  const [a, b] = onMap(breather(), B(), behind);
  const told = spreadForecast(planExchange(a, b, { distance: 1 }));
  assert.equal(told.length, 1);
  assert.deepEqual({ skill: told[0].skill, by: told[0].by, sure: told[0].sure }, { skill: "Firebreathing", by: "initiator", sure: true });
  assert.deepEqual(told[0].units.map((share) => [share.id, share.attack.hit, share.attack.share]), [["c", 0, 1]], "the unit behind, at the tome's full numbers");

  // The fight tells of it once, to be dealt when the fight is over, and it costs the tome no further use
  const result = resolveExchange(planExchange(a, b, { distance: 1 }), dice(100, 100, 100));
  assert.deepEqual(result.spreads.map((entry) => [entry.skill, entry.units.map((share) => share.id), !!entry.attack?.free]), [["Firebreathing", ["c"], true]]);

  // From 2 spaces the tile behind the target is the third in the line
  const [far, target] = onMap(breather(), B(), [token("c", "enemy", [0, 3]), token("d", "enemy", [0, 1])], { foeAt: [0, 2] });
  assert.deepEqual(spreadForecast(planExchange(far, target, { distance: 2 }))[0].units.map((share) => share.id), ["c"]);

  // Not along a diagonal, not with another weapon, not when the unit is attacked, and not on an ally
  const [corner, across] = onMap(breather(), B(), [token("c", "enemy", [2, 2])], { foeAt: [1, 1] });
  assert.deepEqual(spreadForecast(planExchange(corner, across, { distance: 2 })), []);
  const [sword, foe] = onMap(A({ skills: [skill("Firebreathing")] }), B(), behind);
  assert.deepEqual(spreadForecast(planExchange(sword, foe, { distance: 1 })), []);
  const [attacker, defending] = onMap(B(), breather(), [token("c", "player", [0, 2])], { at: [0, 1], foeAt: [0, 0] });
  assert.deepEqual(spreadForecast(planExchange(attacker, defending, { distance: 1 })), []);
  const [alone, one] = onMap(breather(), B(), [token("e", "player", [0, 2])]);
  assert.deepEqual(spreadForecast(planExchange(alone, one, { distance: 1 })), []);
});

test("Cannon: a 3x3 square placed as far away as the Bolt in hand attacks, an attack on each enemy in it, and a debuff on each afterwards", () => {
  const act = builtEffects("Cannon")[0].act;
  assert.deepEqual(checkAct(act), []);
  assert.deepEqual(checkArea(act.area), []);
  assert.equal(act.area.range, WEAPON_RANGE);
  assert.deepEqual(act.strike, { hand: true, only: ["bolt"], combat: true });
  assert.ok(checkAct({ ...act, strike: { hand: true, only: [] } }).length);
  assert.ok(checkAct({ target: { who: "enemy", within: 2 }, strike: { might: 1, hit: 50 }, grant: act.grant }).length, "only a volley over an area leaves a change behind");
  assert.ok(checkArea({ ...act.area, centre: "self" }).length, "only an area placed on a tile has a range");

  // The Bolt's own Range says where it may be placed: 3 to 8 spaces away
  const reach = parseRange("3-8");
  const area = { ...act.area, range: { from: reach.min, within: reach.max } };
  const inside = () => true;
  const centres = areaCentres(area, { i: 10, j: 10 }, inside);
  const apart = (tile) => Math.abs(tile.i - 10) + Math.abs(tile.j - 10);
  assert.ok(centres.every((tile) => (apart(tile) >= 3) && (apart(tile) <= 8)));
  assert.ok(centres.some((tile) => apart(tile) === 3) && centres.some((tile) => apart(tile) === 8));
  assert.equal(areaCentres(act.area, { i: 10, j: 10 }, inside).length, 0, "nowhere until the weapon in hand says how far");
  assert.equal(areaTiles(area, { i: 10, j: 10 }, { i: 10, j: 15 }, { inside }).length, 9);

  // What each enemy that was attacked carries until the end of its next turn
  assert.deepEqual(act.grant.effects, [{ combat: { dodge: -10, hit: -10, damage: -2 }, stats: { def: -2, res: -2 } }]);
  assert.deepEqual([act.grant.ends, act.grant.next], ["turnEnd", true]);
  assert.deepEqual([listed.Cannon.usage.kind, listed.Cannon.usage.cooldown], ["action", 3]);
});

/* -------------------------------------------- */
/*  A Tome Cast as Its Unit Is Hit              */
/* -------------------------------------------- */

test("Spellshield: the tome that was infused is cast at the attacker as its unit is hit, at -10 Hit and half its damage, and the hit deals a quarter less", () => {
  const shielded = (picked, options = {}) => ({
    ...B({ skills: [skill("Spellshield", { active: true, picked: picked ? { [LENT_PICK]: picked } : {}, ...options })], stats: { mag: 8 } }),
    proficiencies: ranks({ sword: "E", dark: "D", fire: "E", water: "E" })
  });

  // What may be infused: the basic tomes of the kinds of magic the unit has a rank of E or higher with
  const lend = builtEffects("Spellshield")[0].lend;
  assert.deepEqual(lentArms(lend, ranks({ sword: "A", dark: "D", fire: "E", water: "E", light: "F" })).map((arm) => arm.name), ["Force", "Fire", "Water", "Ice", "Flux"]);
  assert.deepEqual(lentArms(lend, ranks({ sword: "A" })), [], "a unit with no rank in magic has nothing to infuse");
  assert.ok(proficientWith(ranks({ thunder: "E" }), "anima") && !proficientWith(ranks({ thunder: "F" }), "anima"));
  assert.equal(castArm(builtEffects("Spellshield"), { [LENT_PICK]: "Flux" }, ranks({ dark: "D", fire: "E" })).name, "Flux");
  assert.equal(castArm(builtEffects("Spellshield"), { [LENT_PICK]: "Light" }, ranks({ dark: "D", fire: "E" })).name, "Force", "one it cannot infuse: the first it can");
  assert.equal(offersOf(shielded("Flux")).filter((offer) => !offer.cast).length, 0, "it is not a weapon to attack with");

  // A hit: a quarter less, then Flux at the attacker with the unit's MAG, at half its damage
  const plain = planExchange(A(), B({ stats: { mag: 8 } }), { distance: 1 });
  const plan = planExchange(A(), shielded("Flux"), { distance: 1 });
  const cast = plan.defender.chances.struck.find((proc) => proc.attack);
  assert.deepEqual([cast.strike.name, cast.strike.hit, cast.strike.might, cast.strike.range, cast.strike.share, cast.strike.able], ["Flux", 70, 7, 2, 0.5, true]);
  // The dice: the hit and its critical; the spell's hit, its critical and Flux's chance to Darken; the unit's
  // own counter-attack and its critical
  const result = resolveExchange(plan, dice(1, 100, 1, 100, 100, 1, 100));
  const [blow, spell] = result.attacks;
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "defender", "defender"], "the spell comes at once, before its own counter-attack");
  assert.equal(blow.damage, Math.floor((plain.initiator.damage * 75) / 100));
  assert.deepEqual([spell.side, spell.skill, !!spell.own], ["defender", "Spellshield", true]);
  assert.equal(spell.damage, Math.floor((8 + 7 - 3) / 2), "MAG and Flux's Might against RES, halved");
  assert.equal(result.attacks.filter((attack) => attack.skill === "Spellshield").length, 1, "cast once, though its unit is hit again");
  assert.deepEqual(result.defender.spent.map((entry) => entry.name), ["Spellshield"]);
  assert.equal(result.defender.usesSpent, 1, "only its own counter-attack costs its sword a use");

  // A fight in which it is not hit leaves it on
  const dodged = resolveExchange(planExchange(A(), shielded("Flux"), { distance: 1 }), dice(100, 100));
  assert.deepEqual(dodged.defender.spent ?? [], []);

  // From further than the tome reaches it is not cast, though the hit still deals less; nor from nearer
  const shot = planExchange(A({ weapon: { ...BOW, range: "2-3" } }), shielded("Flux"), { distance: 3 });
  assert.equal(shot.defender.chances.struck.find((proc) => proc.attack).strike.able, false);
  const far = resolveExchange(shot, dice(1, 100));
  assert.deepEqual(far.attacks.map((attack) => attack.side), ["initiator"]);
  assert.equal(far.attacks[0].damage, Math.floor((planExchange(A({ weapon: { ...BOW, range: "2-3" } }), B(), { distance: 3 }).initiator.damage * 75) / 100));
  assert.equal(planExchange(A(), shielded("Ice"), { distance: 1 }).defender.chances.struck.find((proc) => proc.attack).strike.able, false, "Ice reaches 2-3");
  assert.equal(planExchange(A({ weapon: BOW }), shielded("Ice"), { distance: 2 }).defender.chances.struck.find((proc) => proc.attack).strike.able, true);

  // Switched off it does nothing, and it sits out 3 turns once it was cast
  const off = planExchange(A(), { ...shielded("Flux"), skills: [skill("Spellshield", { picked: { [LENT_PICK]: "Flux" } })] }, { distance: 1 });
  assert.equal(off.defender.chances.struck.length, 0);
  assert.deepEqual([listed.Spellshield.usage.kind, listed.Spellshield.usage.cooldown], ["declare", 3]);
});

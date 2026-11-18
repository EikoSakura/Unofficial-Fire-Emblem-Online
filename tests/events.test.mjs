/**
 * Tests for `module/rules/events.mjs`: damage, healing, conditions and kills from any source, read through the
 * skills as they are written in effects.json. Run with `node --test tests/` or `node tests/events.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { standing } from "../module/rules/auras.mjs";
import {
  builtInChanges, builtInSkills, conditionMoments, damageDice, damageShares, keptConditions, killDice, killMoments,
  receiveCondition, regainHp, sufferDamage, wardDice
} from "../module/rules/events.mjs";
import { conditionBends } from "../module/rules/skills.mjs";
import { timedEntries } from "../module/rules/timed.mjs";
import { dice, made, skill, unit } from "./lib/fixtures.mjs";

const SWORD = { name: "Iron Sword", category: "sword" };
const FIRE = { name: "Fire", category: "fire" };
const bendsOf = (who) => conditionBends(who.skills, who.self);

/** The auras a unit receives from the units placed around it. */
function aurasFor(units, id) {
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  return standing(units, id, measure).auras;
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

test("plain damage comes off HP and stops at 0", () => {
  const hit = sufferDamage(unit({ hp: 20 }), 7, { kind: "attack" }, dice());
  assert.deepEqual([hit.dealt, hit.hp, hit.defeated], [7, 13, false]);
  const fatal = sufferDamage(unit({ hp: 5 }), 12, { kind: "condition" }, dice());
  assert.deepEqual([fatal.dealt, fatal.hp, fatal.defeated], [12, 0, true]);
});

test("damage past 0 HP is kept for a unit that can be Incapacitated, less its resilience", () => {
  const hit = sufferDamage(unit({ hp: 5, resilience: 3 }), 12, {}, dice());
  assert.equal(hit.hp, -4);
  assert.equal(hit.defeated, true);
});

test("damage that cannot kill leaves 1 HP, and a Staggered unit takes more of any kind", () => {
  assert.equal(sufferDamage(unit({ hp: 5 }), 12, { kind: "skill", nonlethal: true }, dice()).hp, 1);
  assert.equal(sufferDamage(unit({ hp: 20, times: 1.5 }), 5, { kind: "condition" }, dice()).dealt, 7);
});

test("Favored survives a lethal blow of any kind once, from above half HP", () => {
  for ( const kind of ["attack", "skill", "condition", "backfire"] ) {
    const who = unit({ hp: 20, hpMax: 20, skills: [skill("Favored")] });
    const blow = sufferDamage(who, 30, { kind }, dice());
    assert.equal(blow.hp, 1, kind);
    assert.equal(blow.defeated, false, kind);
    assert.deepEqual(blow.steps.map((step) => step.what), ["survive"], kind);
    assert.deepEqual(blow.used.map((spent) => spent.name), ["Favored"], kind);
    assert.equal(blow.grants.length, 1, kind);
  }
  // At half HP or less it does nothing, nor once its use is spent, nor for a blow that is not lethal
  assert.equal(sufferDamage(unit({ hp: 10, hpMax: 20, skills: [skill("Favored")] }), 30, {}, dice()).hp, 0);
  assert.equal(sufferDamage(unit({ hp: 20, hpMax: 20, skills: [skill("Favored", { used: 1 })] }), 30, {}, dice()).hp, 0);
  const light = sufferDamage(unit({ hp: 20, hpMax: 20, skills: [skill("Favored")] }), 5, {}, dice());
  assert.deepEqual([light.hp, light.used.length, light.grants.length], [15, 0, 0]);
});

test("Favored then takes no damage of any kind for the rest of that turn", () => {
  const own = sufferDamage(unit({ skills: [skill("Favored")], inTurn: true }), 30, { kind: "condition" }, dice());
  assert.equal(own.grants[0].ends, "turnEnd");
  const away = sufferDamage(unit({ skills: [skill("Favored")], inTurn: false }), 30, { kind: "attack" }, dice());
  assert.equal(away.grants[0].ends, "turnStart");

  // The change it was granted is one of its skills from then on
  const carrying = unit({ hp: 1, skills: [skill("Favored", { used: 1 }), ...timedEntries(away.grants)] });
  for ( const kind of ["attack", "skill", "condition", "backfire"] ) {
    const next = sufferDamage(carrying, 9, { kind }, dice());
    assert.deepEqual([next.dealt, next.hp], [0, 1], kind);
  }
});

test("Miracle rolls to halve a fatal blow of any kind", () => {
  const who = () => unit({ hp: 20, hpMax: 20, stats: { luk: 5 }, skills: [skill("Miracle")] });
  assert.equal(damageDice(who(), { kind: "condition" }), 1);
  const saved = sufferDamage(who(), 30, { kind: "condition" }, dice(5));
  assert.deepEqual([saved.dealt, saved.hp], [15, 5]);
  assert.equal(sufferDamage(who(), 30, { kind: "condition" }, dice(6)).hp, 0);

  // Still fatal once halved: 1 HP is left. A blow that is not fatal rolls nothing
  assert.equal(sufferDamage(who(), 90, {}, dice(1)).hp, 1);
  assert.equal(sufferDamage(who(), 19, {}, dice()).hp, 1);
});

test("Dragonskin takes no damage from skills, and all of an attack", () => {
  const who = unit({ skills: [skill("Dragonskin")] });
  const trampled = sufferDamage(who, 8, { kind: "skill" }, dice());
  assert.deepEqual([trampled.dealt, trampled.steps[0]], [0, { what: "immune", skill: "Dragonskin" }]);
  assert.equal(sufferDamage(who, 8, { kind: "attack", weapon: SWORD }, dice()).dealt, 8);
});

test("Goddess's Blessing and Mantle are damaged by Blessed weapons and Non-Beorc attacks only", () => {
  for ( const name of ["Goddess's Blessing", "Mantle"] ) {
    const who = unit({ skills: [skill(name)] });
    for ( const kind of ["condition", "skill", "backfire", "terrain"] ) assert.equal(sufferDamage(who, 8, { kind }, dice()).dealt, 0, `${name} ${kind}`);
    assert.equal(sufferDamage(who, 8, { kind: "attack" }, dice()).dealt, 0, `${name}: by hand, nobody selected`);
    assert.equal(sufferDamage(who, 8, { kind: "attack", weapon: SWORD }, dice()).dealt, 0, `${name}: a plain sword`);
    assert.equal(sufferDamage(who, 8, { kind: "attack", weapon: { name: "Blessed Lance", category: "lance" } }, dice()).dealt, 8);
    assert.equal(sufferDamage(who, 8, { kind: "attack", weapon: { name: "Claw", category: "laguz" } }, dice()).dealt, 8);
  }
});

test("Aspected takes no damage of its chosen magic, whatever deals it", () => {
  const who = unit({ skills: [skill("Aspected", { choice: "Fire" })] });
  assert.equal(sufferDamage(who, 8, { kind: "attack", weapon: FIRE }, dice()).dealt, 0);
  assert.equal(sufferDamage(who, 8, { kind: "skill", element: "fire" }, dice()).dealt, 0);
  assert.equal(sufferDamage(who, 8, { kind: "skill", element: "thunder" }, dice()).dealt, 8);
  assert.equal(sufferDamage(who, 8, { kind: "attack", weapon: SWORD }, dice()).dealt, 8);
});

test("Blessing of Vesta takes a quarter of what a Fire tome deals", () => {
  const who = unit({ skills: [skill("Blessing of Vesta")] });
  assert.equal(sufferDamage(who, 20, { kind: "attack", weapon: FIRE }, dice()).dealt, 5);
  assert.equal(sufferDamage(who, 20, { kind: "attack", weapon: SWORD }, dice()).dealt, 20);
});

test("a share more damage counts for damage of every kind, unless it is already counted", () => {
  const staggered = { name: "Stagger", from: "Foe", effects: [{ takenPercent: 50 }], ends: "turnEnd", turns: 2, clock: "", stacks: 1, max: 0, fades: false };
  const who = unit({ skills: timedEntries([staggered]) });
  assert.equal(damageShares(who, { kind: "condition" }).times, 1.5);
  for ( const kind of ["attack", "skill", "condition"] ) assert.equal(sufferDamage(who, 10, { kind }, dice()).dealt, 15, kind);
  assert.equal(sufferDamage(who, 15, { kind: "condition", settled: true }, dice()).dealt, 15);
});

test("Rampart lends its unit's DEF or RES to an ally next to it that is hit, 90% of the time", () => {
  const wall = { id: "wall", name: "Wall", side: "player", tile: { i: 0, j: 0 }, hp: 30, hpMax: 30, waiting: true, qualities: "Armored",
    stats: { def: 12, res: 9, dex: 5 }, skills: [skill("Rampart")] };
  const friend = { id: "friend", name: "Friend", side: "player", tile: { i: 0, j: 1 }, hp: 20, hpMax: 20, stats: {}, skills: [] };
  const auras = aurasFor([wall, friend], "friend");
  assert.equal(auras.length, 1);

  // Waiting with the Armored quality the wall has 13 DEF, 7 more than the 6 of its ally
  const who = () => unit({ hp: 20, stats: { def: 6, res: 3 }, skills: auras });
  assert.equal(damageDice(who(), { kind: "attack", resist: "def" }), 1);
  const lent = sufferDamage(who(), 10, { kind: "attack", resist: "def" }, dice(90));
  assert.deepEqual([lent.dealt, lent.steps.map((step) => step.what)], [3, ["shield"]]);
  assert.equal(sufferDamage(who(), 10, { kind: "attack", resist: "def" }, dice(91)).dealt, 10);

  // Damage that no defence was counted against has nothing to gain, and rolls nothing
  assert.equal(sufferDamage(who(), 10, { kind: "attack" }, dice()).dealt, 10);
  assert.equal(sufferDamage(who(), 10, { kind: "condition" }, dice()).dealt, 10);

  // A wall that is not Waiting lends nothing
  assert.equal(aurasFor([{ ...wall, waiting: false }, friend], "friend").length, 0);
});

test("Dragon Ward halves a hit on an ally within 2 tiles at its unit's DEX%, and only a hit", () => {
  const rider = { id: "rider", name: "Rider", side: "player", tile: { i: 0, j: 0 }, hp: 30, hpMax: 30, stats: { dex: 40 }, skills: [skill("Dragon Ward")] };
  const friend = { id: "friend", name: "Friend", side: "player", tile: { i: 0, j: 2 }, hp: 20, hpMax: 20, stats: {}, skills: [] };
  const who = () => unit({ hp: 20, skills: aurasFor([rider, friend], "friend") });
  assert.equal(sufferDamage(who(), 11, { kind: "attack", weapon: SWORD }, dice(40)).dealt, 5);
  assert.equal(sufferDamage(who(), 11, { kind: "attack", weapon: SWORD }, dice(41)).dealt, 11);
  assert.equal(sufferDamage(who(), 11, { kind: "skill" }, dice()).dealt, 11);
  assert.equal(aurasFor([rider, { ...friend, tile: { i: 0, j: 3 } }], "friend").length, 0);
});

/* -------------------------------------------- */
/*  Healing                                     */
/* -------------------------------------------- */

test("healing stops at maximum HP, and a staff heals a unit below 0 HP from 0", () => {
  assert.deepEqual(regainHp({ hp: 15, hpMax: 20 }, 9), { hpBefore: 15, hp: 20, healed: 5 });
  assert.deepEqual(regainHp({ hp: 20, hpMax: 20 }, 9), { hpBefore: 20, hp: 20, healed: 0 });
  assert.deepEqual(regainHp({ hp: -6, hpMax: 20 }, 4), { hpBefore: -6, hp: -2, healed: 4 });
  assert.deepEqual(regainHp({ hp: -6, hpMax: 20 }, 4, { fromZero: true }), { hpBefore: -6, hp: 4, healed: 4 });
});

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

test("Healthy nullifies a condition half of the time, from any source", () => {
  const wards = bendsOf(unit({ skills: [skill("Healthy")] })).nullify;
  assert.equal(wardDice(wards), 1);
  const warded = receiveCondition({ conditions: {}, hp: 20, wards }, "poison", {}, dice(50));
  assert.deepEqual([warded.success, warded.state], [false, {}]);
  const given = receiveCondition({ conditions: {}, hp: 20, wards }, "poison", {}, dice(51));
  assert.equal(given.success, undefined);
  assert.ok(given.state.poison > 0);
});

test("skills that are immune to conditions refuse them without a roll", () => {
  const cases = [
    ["Rage", "sleep", true], ["Rage", "poison", false],
    ["Blessing of Vesta", "burn", true], ["Blessing of Vesta", "poison", false],
    ["Dragonskin", "poison", true], ["Dragonskin", "burn", true], ["Dragonskin", "sleep", false],
    ["Immunity", "sleep", true], ["General", "stun", true]
  ];
  for ( const [name, id, immune] of cases ) {
    const wards = bendsOf(unit({ skills: [skill(name)] })).nullify;
    assert.equal(wardDice(wards), 0, name);
    const given = receiveCondition({ conditions: {}, hp: 20, wards }, id, {}, dice());
    assert.equal(given.success === false, immune, `${name} against ${id}`);
  }
});

test("a condition lasts longer when its giver's skills say so, and one handed back cuts nothing short", () => {
  const usual = receiveCondition({ conditions: {}, hp: 20 }, "bind", {}, dice());
  const longer = receiveCondition({ conditions: {}, hp: 20 }, "bind", { more: 2 }, dice());
  assert.equal(longer.turns, usual.turns + 2);
  const kept = receiveCondition({ conditions: { bind: 3 }, hp: 20 }, "bind", { turns: 1, keep: true }, dice());
  assert.deepEqual([kept.turns, kept.state.bind], [3, 3]);

  // A condition that stacks is added to instead
  assert.equal(receiveCondition({ conditions: { burn: 3 }, hp: 20 }, "burn", { turns: 1, keep: true }, dice()).turns, 4);
  assert.equal(receiveCondition({ conditions: {}, hp: 0 }, "burn", {}, dice()), null);
  assert.ok(receiveCondition({ conditions: {}, hp: 0 }, "burn", { down: true }, dice()));
  assert.equal(receiveCondition({ conditions: {}, hp: 20 }, "nothing", {}, dice()), null);
});

test("Arsonist, Reverb and Stagger leave their mark on a unit they give the condition, by any means", () => {
  const target = unit({ name: "Foe", conditions: { burn: 3 } });
  const burnt = conditionMoments({ giver: unit({ name: "Pyro", skills: [skill("Arsonist")] }), target, inflicted: { id: "burn", turns: 3 } });
  assert.equal(burnt.grants.length, 1);
  const { to, change } = burnt.grants[0];
  assert.equal(to, "target");
  assert.deepEqual([change.name, change.from, change.while, change.turns], ["Arsonist", "Pyro", "burn", 3]);
  assert.deepEqual(change.effects, [{ suffers: { burn: { tick: 5 } } }]);

  // Another condition sets nothing off
  assert.equal(conditionMoments({ giver: unit({ skills: [skill("Arsonist")] }), target, inflicted: { id: "poison", turns: 3 } }).grants.length, 0);

  const stunned = conditionMoments({ giver: unit({ name: "Brute", skills: [skill("Stagger")] }), target, inflicted: { id: "stun", turns: 1 } });
  assert.deepEqual(stunned.grants[0].change.effects, [{ takenPercent: 50 }]);
  assert.equal(stunned.grants[0].change.while, "stun");

  const shaken = conditionMoments({ giver: unit({ name: "Bard", skills: [skill("Reverb")] }), target, inflicted: { id: "tremor", turns: 2 } });
  assert.deepEqual(shaken.grants[0].change.effects, [{ suffers: { tremor: { burst: true } } }]);
});

test("Blood for Blood hands a condition back to the unit that gave it, when one is known", () => {
  const target = unit({ name: "Victim", skills: [skill("Blood for Blood")] });
  const giver = unit({ name: "Foe" });
  assert.deepEqual(conditionMoments({ giver, target, inflicted: { id: "poison", turns: 3 } }).returned, [{ id: "poison", turns: 1, skill: "Blood for Blood" }]);
  assert.deepEqual(conditionMoments({ giver, target, inflicted: { id: "sleep", turns: 3 } }).returned, []);
  assert.deepEqual(conditionMoments({ giver: null, target, inflicted: { id: "poison", turns: 3 } }).returned, []);
});

test("Immunity is left nothing by the unit that gives it a condition", () => {
  const target = unit({ name: "Boss", skills: [skill("Immunity")] });
  target.bends = bendsOf(target);
  const out = conditionMoments({ giver: unit({ skills: [skill("Stagger")] }), target, inflicted: { id: "stun", turns: 1 } });
  assert.equal(out.grants.length, 0);
});

test("Toxify always has Poison", () => {
  const who = unit({ skills: [skill("Toxify")] });
  assert.deepEqual(keptConditions(bendsOf(who), {}), ["poison"]);
  assert.deepEqual(keptConditions(bendsOf(who), { poison: 1 }), []);
  assert.deepEqual(keptConditions(null, {}), []);
});

/* -------------------------------------------- */
/*  Defeat                                      */
/* -------------------------------------------- */

test("Loot pays for a foe defeated by any means", () => {
  const paid = killMoments(unit({ skills: [skill("Loot")] }), unit({ name: "Foe", hp: 0 }), dice());
  assert.deepEqual([paid.goldTotal, paid.gold], [50, [{ skill: "Loot", amount: 50 }]]);
  assert.equal(killMoments(unit(), unit({ hp: 0 }), dice()).goldTotal, 0);
});

test("Plunder and Greed roll for gold by the levels between the two units", () => {
  const foe = unit({ name: "Foe", hp: 0, level: 8 });
  const brigand = (skills) => unit({ level: 5, stats: { str: 20 }, skills });
  assert.equal(killDice(brigand([skill("Plunder")]), foe), 1);
  assert.equal(killMoments(brigand([skill("Plunder")]), foe, dice(20)).goldTotal, 150);
  assert.equal(killMoments(brigand([skill("Plunder")]), foe, dice(21)).goldTotal, 0);
  assert.equal(killMoments(brigand([skill("Plunder")]), unit({ hp: 0, level: 5 }), dice(1)).goldTotal, 50);

  // Greed alone rolls at half the chance; with Plunder it rolls nothing and doubles Plunder's gold
  assert.equal(killMoments(brigand([skill("Greed")]), foe, dice(10)).goldTotal, 150);
  assert.equal(killMoments(brigand([skill("Greed")]), foe, dice(11)).goldTotal, 0);
  assert.equal(killDice(brigand([skill("Plunder"), skill("Greed")]), foe), 1);
  assert.equal(killMoments(brigand([skill("Plunder"), skill("Greed")]), foe, dice(20)).goldTotal, 300);
});

/* -------------------------------------------- */
/*  Special Qualities                           */
/* -------------------------------------------- */

test("Armored, Bandit and Beast units are given Rampart, Greed and Rouse by themselves", () => {
  assert.deepEqual(builtInSkills("Armored, Dragon"), ["Rampart"]);

  // A Bandit is given Pillage as well, which has it destroy Villages
  assert.deepEqual(builtInSkills("Bandit/Beast"), ["Greed", "Pillage", "Rouse"]);

  // Mounted, Flying and Ballistician units are given Canto+, once however many of the three they are
  assert.deepEqual(builtInSkills("Armored, Mounted"), ["Rampart", "Canto+"]);
  assert.deepEqual(builtInSkills("Mounted, Flying"), ["Canto+"]);
  assert.deepEqual(builtInSkills("Ballistician"), ["Canto+"]);
  assert.deepEqual(builtInSkills(""), []);
  assert.deepEqual(builtInChanges("Armored", []), { add: ["Rampart"], remove: [] });
  assert.deepEqual(builtInChanges("Armored", [{ name: "Rampart", builtIn: true }]), { add: [], remove: [] });

  // One put on by hand is not added again, and not taken off when the quality goes
  assert.deepEqual(builtInChanges("Armored", [{ name: "rampart" }]), { add: [], remove: [] });
  assert.deepEqual(builtInChanges("Dragon", [{ name: "Rampart" }, { name: "Greed", builtIn: true }]), { add: [], remove: ["Greed"] });
});

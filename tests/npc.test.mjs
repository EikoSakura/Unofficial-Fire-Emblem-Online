/**
 * Tests for `module/rules/npc.mjs`: a quick unit made from a class, a Level and a side.
 * The classes are the Class Sheet's Fighter, Warrior, Knight and General.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { buildNpc, choiceId, cleanSpec, levelSpan, lineThrough, newSpec, shapedGrowths, suggestKit, wields } from "../module/rules/npc.mjs";

const STATS = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con", "los"];
const row = (values) => Object.fromEntries(STATS.map((key, index) => [key, values[index] ?? null]));

/** A class as the Class Sheet lists it. */
const cls = (name, tier, { base = [], gains = [], wt = 0, options = [], skills = {}, qualities = "", promotesTo = [], race = "beorc", caps = {} } = {}) => ({
  id: name.toLowerCase(),
  name,
  system: {
    tier, race, wt, caps,
    base: row(base),
    gains: Object.fromEntries(STATS.map((key, index) => [key, gains[index] ?? 0])),
    proficiencies: { options, choose: 0, note: "" },
    skills: { starting: "", promotion: "", occult: "", mastery: "", ...skills },
    specialQualities: qualities,
    promotesTo: promotesTo.map((target) => ({ name: target, uuid: "" }))
  }
});

const fighter = cls("Fighter", "base", {
  base: [24, 9, 0, 3, 2, 6, 6, 5, 6, 10, 2], wt: 3, options: ["axe"], skills: { starting: "Rive" }, promotesTo: ["Warrior"]
});
const warrior = cls("Warrior", "second", {
  gains: [4, 3, 0, 2, 0, 2, 2, 1, 1, 3, 0], wt: 4, options: ["bow"], skills: { promotion: "Proud Fighter", occult: "Forceful" }, promotesTo: ["Reaver"]
});
const brigand = cls("Brigand", "base", {
  base: [27, 10, 0, 1, 1, 3, 5, 6, 6, 11, 2], options: ["axe"], qualities: "Bandit",
  skills: { starting: "Chop Down or Reckless Charge or Sojourner or Plunder" }, promotesTo: ["Berserker"]
});
const mage = cls("Mage", "base", { base: [17, 1, 7, 3, 7, 8, 6, 4, 6, null, 2], options: ["fire"], skills: { starting: "Animus or Animose" } });
const tiger = cls("Tiger", "base", {
  race: "laguz", base: [22, 8, 0, 6, 2, 6, 6, 4, 6, 10, 2], skills: { promotion: "Roar", mastery: "Rend", occult: "Savage" }
});

const spec = (given) => newSpec({ name: "Test", seed: "abc", ...given });

test("growth rates follow the shape of the class inside the budget and the caps", () => {
  const growths = shapedGrowths(fighter);
  const eight = FEO.promotionGrowth.stats;
  assert.equal(eight.reduce((sum, key) => sum + growths[key], 0), (eight.length * FEO.baseGrowth) + FEO.creation.growth.free);
  assert.equal(growths.hp, FEO.growthCaps.hp, "the stat the class has most of grows to its cap");
  for ( const key of eight ) {
    assert.ok(growths[key] <= (FEO.growthCaps[key] ?? FEO.growthCaps.default), `${key} is within its cap`);
    assert.equal(growths[key] % FEO.creation.growth.step, 0, `${key} is written in steps`);
    assert.ok(growths[key] >= FEO.baseGrowth, `${key} keeps what every rate starts at`);
  }
  assert.ok(growths.str > growths.mag, "a Fighter grows in Strength before Magic");
  assert.equal(growths.mag, FEO.baseGrowth);
  assert.equal(growths.cha + growths.int, (2 * FEO.baseGrowth) + FEO.creation.growth.abilities);
  assert.deepEqual(shapedGrowths(fighter), growths, "the same class always gives the same rates");
});

test("a unit of Level 1 is its class as it stands", () => {
  const made = buildNpc(spec({ level: 1 }), [fighter]);
  assert.equal(made.level, 1);
  assert.equal(made.className, "Fighter");
  assert.equal(made.unit.hp.max, 24);
  assert.equal(made.unit.hp.value, 24);
  assert.equal(made.unit.stats.str.base, 9);
  assert.equal(made.unit.stats.mov.base, 6);
  assert.equal(made.unit.wt.class, 3);
  assert.equal(made.unit.proficiencies.axe.rank, "D");
  assert.equal(made.unit.proficiencies.sword.rank, "F");
  assert.deepEqual(made.skills, [{ name: "Rive", kind: "class", source: "class" }]);
  assert.equal(made.levels, 0);
  assert.deepEqual(made.parts.str, { base: 9, levels: 0, promotion: 0, adjust: 0 });
});

test("Levels give what the growth rates give on average, rounded down", () => {
  const growths = shapedGrowths(fighter);
  const made = buildNpc(spec({ level: 10 }), [fighter]);
  assert.equal(made.level, 10);
  assert.equal(made.levels, 9);
  for ( const key of ["str", "def", "spd", "luk"] ) {
    assert.equal(made.unit.stats[key].base, fighter.system.base[key] + Math.floor(((9 * growths[key]) / 100) + 1e-9), key);
  }
  assert.equal(made.unit.hp.max, 24 + Math.floor((9 * growths.hp) / 100));
  assert.equal(made.unit.stats.mov.base, 6, "MOV has no growth rate");
  assert.deepEqual(buildNpc(spec({ level: 10, seed: "other" }), [fighter]).unit, made.unit, "and are the same whatever the seed");
});

test("a rolled unit gains by its dice, the same for the same seed", () => {
  const first = buildNpc(spec({ level: 12, mode: "rolled", seed: "seed-1" }), [fighter]);
  const again = buildNpc(spec({ level: 12, mode: "rolled", seed: "seed-1" }), [fighter]);
  assert.deepEqual(first.unit, again.unit);
  const sets = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => {
    return JSON.stringify(buildNpc(spec({ level: 12, mode: "rolled", seed }), [fighter]).unit.stats);
  }));
  assert.ok(sets.size > 1, "another seed rolls another unit");
  for ( const [key, [low, high]] of Object.entries(first.span) ) {
    assert.ok(low <= high, `${key} has a span`);
  }
  assert.ok(first.span.str[0] < first.span.str[1], "a stat that grows has a span to land in");
});

test("the Level after the last of a tier is a promotion", () => {
  const made = buildNpc(spec({ level: 21 }), [fighter, warrior]);
  const before = buildNpc(spec({ level: 20 }), [fighter, warrior]);
  assert.equal(before.className, "Fighter");
  assert.equal(before.levels, 19);
  assert.equal(made.level, 21);
  assert.equal(made.className, "Warrior");
  assert.equal(made.promotions, 1);
  assert.equal(made.levels, 19, "the promotion is in the place of a Level up");
  assert.equal(made.unit.stats.str.base, before.unit.stats.str.base + 3);
  assert.equal(made.unit.hp.max, before.unit.hp.max + 4);
  assert.equal(made.parts.str.promotion, 3);
  assert.equal(made.unit.wt.class, 4);
  assert.equal(made.unit.proficiencies.axe.rank, "C", "a rank it had rises");
  assert.equal(made.unit.proficiencies.bow.rank, "D", "a new one starts at D");
  assert.equal(made.unit.growths.str, before.unit.growths.str + 5);
  assert.deepEqual(made.skills.map((skill) => skill.name), ["Rive", "Proud Fighter"]);
  assert.deepEqual(made.classes.map((entry) => entry.name), ["Fighter", "Warrior"]);
});

test("a unit goes no further than its line of classes", () => {
  const made = buildNpc(spec({ level: 30 }), [fighter]);
  assert.equal(made.level, 20);
  assert.equal(made.stopped, "promotion");
  const whole = buildNpc(spec({ level: 30 }), [fighter, warrior]);
  assert.equal(whole.level, 30);
  assert.equal(whole.stopped, "");
});

test("a class that does not promote levels on and learns its skills at the milestones", () => {
  const made = buildNpc(spec({ level: 50 }), [tiger]);
  assert.equal(made.level, 50);
  assert.equal(made.stopped, "");
  assert.deepEqual(made.skills.map((skill) => skill.name), ["Roar", "Rend", "Savage"]);
  assert.equal(made.parts.str.promotion, 2 * FEO.milestoneGains.str);
});

test("where a class offers a choice of skill the first is taken unless another is picked", () => {
  const first = buildNpc(spec({ level: 1 }), [brigand]);
  const [skill] = first.skills;
  assert.equal(skill.name, "Chop Down");
  assert.deepEqual(skill.options, ["Chop Down", "Reckless Charge", "Sojourner", "Plunder"]);
  const picked = buildNpc(spec({ level: 1, picks: { [choiceId(skill.options)]: "Plunder" } }), [brigand]);
  assert.equal(picked.skills[0].name, "Plunder");
});

test("a Boss has the skill of a Boss, and a unit is shown what its Special Qualities build into it", () => {
  const boss = buildNpc(spec({ boss: true, generic: "Vantage", extras: ["Advantage", "advantage"] }), [fighter]);
  assert.deepEqual(boss.skills.map((skill) => `${skill.name}:${skill.source}`), ["Rive:class", "Vantage:generic", "General:boss", "Advantage:extra"]);
  const bandit = buildNpc(spec({}), [brigand]).skills.filter((skill) => skill.source === "builtIn").map((skill) => skill.name);
  assert.deepEqual(bandit, [].concat(FEO.qualitySkills.Bandit));
});

test("what is set by hand goes on top", () => {
  const made = buildNpc(spec({ level: 5, adjust: { def: 2, hp: -3, spd: -99 }, ranks: { axe: "B", sword: "E" } }), [fighter]);
  const plain = buildNpc(spec({ level: 5 }), [fighter]);
  assert.equal(made.unit.stats.def.base, plain.unit.stats.def.base + 2);
  assert.equal(made.parts.def.adjust, 2);
  assert.equal(made.unit.hp.max, plain.unit.hp.max - 3);
  assert.equal(made.unit.hp.value, made.unit.hp.max);
  assert.equal(made.unit.stats.spd.base, 0, "a stat does not fall below nothing");
  assert.equal(made.parts.spd.adjust, -plain.unit.stats.spd.base);
  assert.deepEqual(made.ranks, [{ key: "sword", rank: "E", byHand: true }, { key: "axe", rank: "B", byHand: true }]);
});

test("a class that leaves CON open takes the one it is given", () => {
  const open = buildNpc(spec({}), [mage]);
  assert.equal(open.conOpen, true);
  assert.equal(open.unit.stats.con.base, FEO.npc.con);
  assert.equal(buildNpc(spec({ con: 4 }), [mage]).unit.stats.con.base, 4);
  assert.equal(buildNpc(spec({}), [fighter]).conOpen, false);
});

test("a class is reached through the classes that promote into it", () => {
  const parents = new Map([[warrior, [fighter, brigand]], [fighter, []], [brigand, []]]);
  const parentsOf = (entry) => parents.get(entry) ?? [];
  assert.deepEqual(lineThrough(warrior, parentsOf).map((entry) => entry.name), ["Fighter", "Warrior"]);
  assert.deepEqual(lineThrough(warrior, parentsOf, ["brigand"]).map((entry) => entry.name), ["Brigand", "Warrior"]);
  assert.deepEqual(lineThrough(fighter, parentsOf).map((entry) => entry.name), ["Fighter"]);
  assert.deepEqual(levelSpan([fighter]), { from: 1, to: 20, promotes: true });
  assert.deepEqual(levelSpan([fighter, warrior]), { from: 21, to: 40, promotes: true });
  assert.deepEqual(levelSpan([tiger]), { from: 1, to: FEO.npc.limit, promotes: false });
});

test("a kit is the Iron, Steel or Silver weapon that goes with the tier, a staff for a healer, and a Vulnerary", () => {
  const weapons = [
    { name: "Iron Axe", category: "axe", rank: "E", cost: 440 },
    { name: "Iron Greataxe", category: "axe", rank: "E", cost: 800 },
    { name: "Venin Axe", category: "axe", rank: "D", cost: 430 },
    { name: "Steel Axe", category: "axe", rank: "D", cost: 600 },
    { name: "Silver Axe", category: "axe", rank: "A", cost: 1500 },
    { name: "Iron Sword", category: "sword", rank: "E", cost: 460 },
    { name: "Fire", category: "fire", rank: "E", cost: 600 },
    { name: "Elfire", category: "fire", rank: "D", cost: 700 },
    { name: "Flare", category: "fire", rank: "D", cost: 900 },
    { name: "Light", category: "light", rank: "E", cost: 450 },
    { name: "Heal", category: "staff", rank: "E", cost: 525 },
    { name: "Mend", category: "staff", rank: "D", cost: 1200 }
  ];
  const gear = [{ name: "Potion" }, { name: "Vulnerary" }];
  const names = (kit) => kit.map((entry) => entry.name);
  const unit = buildNpc(spec({}), [fighter]).unit;
  assert.deepEqual(names(suggestKit(unit, weapons, gear)), ["Iron Axe", "Vulnerary"]);
  assert.equal(wields(unit, weapons[4]), false);
  assert.equal(wields(unit, weapons[3]), true);

  // A promoted unit takes the next family, and one promoted twice the best of them its rank allows
  const promoted = buildNpc(spec({ level: 21 }), [fighter, warrior]).unit;
  assert.deepEqual(names(suggestKit(promoted, weapons, gear, { order: FEO.classTiers.second.order })), ["Steel Axe", "Vulnerary"]);
  assert.deepEqual(names(suggestKit(promoted, weapons, gear, { order: FEO.classTiers.third.order })), ["Steel Axe", "Vulnerary"]);
  const master = buildNpc(spec({ level: 21, ranks: { axe: "A" } }), [fighter, warrior]).unit;
  assert.deepEqual(names(suggestKit(master, weapons, gear, { order: FEO.classTiers.third.order })), ["Silver Axe", "Vulnerary"]);

  // Tomes have no such families: the cheapest of the rank that goes with the tier
  const caster = buildNpc(spec({}), [mage]).unit;
  assert.deepEqual(names(suggestKit(caster, weapons, gear)), ["Fire", "Vulnerary"]);
  assert.deepEqual(names(suggestKit(caster, weapons, gear, { order: FEO.classTiers.second.order })), ["Elfire", "Vulnerary"]);

  const cleric = cls("Cleric", "base", { base: [15, 1, 6, 1, 9, 6, 6, 6, 6, 6, 2], options: ["light", "staff"] });
  assert.deepEqual(names(suggestKit(buildNpc(spec({}), [cleric]).unit, weapons, gear)), ["Light", "Heal", "Vulnerary"]);
  assert.deepEqual(suggestKit(buildNpc(spec({}), [tiger]).unit, weapons, []), []);
});

test("what was kept of a unit is put right as it is read", () => {
  const read = cleanSpec({
    name: "  Dorran ", side: "player", level: 999, mode: "dice", adjust: { str: "2", def: 0, luk: "x" }, ranks: { axe: "C", whip: "A", sword: "Z" },
    extras: ["Advantage", "", "Advantage"], pack: [{ name: "Steel Axe", uuid: "u", drop: "all", equipped: 1 }, { name: "" }, null], con: ""
  });
  assert.equal(read.name, "Dorran");
  assert.equal(read.side, "enemy");
  assert.equal(read.level, FEO.npc.limit);
  assert.equal(read.mode, "average");
  assert.deepEqual(read.adjust, { str: 2 });
  assert.deepEqual(read.ranks, { axe: "C" });
  assert.deepEqual(read.extras, ["Advantage"]);
  assert.deepEqual(read.pack, [{ uuid: "u", name: "Steel Axe", type: "weapon", drop: "", equipped: true }]);
  assert.equal(read.con, null);
  assert.equal(read.growths, null);
  assert.deepEqual(cleanSpec(read), read, "and reading it again changes nothing");
});

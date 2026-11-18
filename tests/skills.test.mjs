/**
 * Tests for `module/rules/skills.mjs`: the parts of the notation that Steps 2 and 3 added.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { selfOf, standing } from "../module/rules/auras.mjs";
import {
  RULES, bestRankOf, chanceOf, checkEffects, conditionBends, genderOf, holds, readsRaises, resolveProc, skillStars, skillTotals,
  tierByLevel, unitTier, weaponIs
} from "../module/rules/skills.mjs";
import { skill, unit } from "./lib/fixtures.mjs";

test("a monster's Eye weapons are told by their name", () => {
  assert.equal(weaponIs({ name: "Evil Eye", category: "monster" }, ["eye"]), true);
  assert.equal(weaponIs({ name: "Crimson Eyes", category: "monster" }, ["eye"]), true);
  assert.equal(weaponIs({ name: "Eyelash Whip", category: "monster" }, ["eye"]), false);
  assert.equal(weaponIs({ name: "Fetid Claw", category: "monster" }, ["eye"]), false);
  assert.equal(weaponIs(null, ["eye"]), false);
});

test("Medusa's Gaze gives its unit's Eye weapons a plain 15% chance to Petrify on a hit", () => {
  const gaze = skill("Medusa's Gaze");
  assert.deepEqual(checkEffects(gaze.effects), []);
  const procs = (weapon) => {
    const who = unit({ skills: [gaze], weapon });
    return skillTotals(who.skills, who.self, { fight: { role: "initiating", distance: 1, foe: { stats: {} } } }).procs;
  };
  const [proc] = procs({ name: "Evil Eye", category: "monster" });
  assert.deepEqual(proc.effect.proc, { on: "hit", percent: 15, fixed: true });
  assert.deepEqual(proc.effect.inflicts, ["petrification"]);
  assert.equal(procs({ name: "Fetid Claw", category: "monster" }).length, 0);
});

test("the new parts are known to the check, and their mistakes are caught", () => {
  assert.ok(RULES.includes("noExp"));
  assert.deepEqual(checkEffects([{ expMultiplier: 2, bexp: false }]), []);
  assert.equal(checkEffects([{ expMultiplier: 2, bexp: true }]).length, 1);
  assert.equal(checkEffects([{ bexp: false }]).length, 1);
  assert.deepEqual(checkEffects([{ aura: { who: "any", within: 1 }, proc: { on: "turnStart", sure: true }, inflicts: ["poison"] }]), []);
  assert.equal(checkEffects([{ aura: { who: "everyone", within: 1 }, stats: { str: 1 } }]).length, 1);
  assert.equal(checkEffects([{ when: { near: { who: "any", within: 1 } }, stats: { str: 1 } }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "turnStart", sure: true }, inflicts: ["nothing"] }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "turnStart", sure: true }, inflicts: [{ id: "poison", dice: 3 }] }]).length, 1);
});

test("Rage and Blessing of Vesta are immune to one condition each", () => {
  const wards = (name) => {
    const who = unit({ skills: [skill(name)] });
    return conditionBends(who.skills, who.self).nullify;
  };
  assert.deepEqual(wards("Rage"), [{ skill: "Rage", percent: 100, only: ["sleep"] }]);
  assert.deepEqual(wards("Blessing of Vesta"), [{ skill: "Blessing of Vesta", percent: 100, only: ["burn"] }]);
});

/* -------------------------------------------- */
/*  Step 3: class tiers, gender, ranks, raises  */
/* -------------------------------------------- */

/** What a unit's skills add up to against a foe. */
const against = (who, foe = {}, role = "initiating") => {
  return skillTotals(who.skills, who.self, { fight: { role, distance: 1, foe: { stats: {}, hp: 20, hpMax: 20, level: 5, ...foe } } });
};

test("a unit's class tier is that of its class, or the one its level would have brought", () => {
  assert.equal(unitTier({ tier: "trainee", promotes: true, level: 3 }), 0);
  assert.equal(unitTier({ tier: "base", promotes: true, level: 20 }), 1);
  assert.equal(unitTier({ tier: "second", promotes: true, level: 21 }), 2);
  assert.equal(unitTier({ tier: "third", promotes: false, level: 41 }), 3);
  assert.equal(unitTier({ tier: "heaven", promotes: false, level: 60 }), 4);

  // A class that does not promote, as a Laguz's, and a unit without a class
  assert.equal(unitTier({ tier: "base", promotes: false, level: 20 }), 1);
  assert.equal(unitTier({ tier: "base", promotes: false, level: 21 }), 2);
  assert.equal(unitTier({ tier: null, level: 45 }), 3);
  assert.equal(tierByLevel(1), 1);
  assert.equal(tierByLevel(40), 2);
});

test("Lethal Grace, Mountaineer and Privateer gain 5 Critical at Tier 2, whatever the level", () => {
  const crit = (name, about) => {
    const who = unit({ skills: [skill(name)], ...about });
    return skillTotals(who.skills, who.self).combat.critical;
  };
  assert.equal(crit("Lethal Grace", { tier: 1, level: 30 }), 5);
  assert.equal(crit("Lethal Grace", { tier: 2, level: 21 }), 10);
  assert.equal(crit("Lethal Grace", { tier: 3, level: 41 }), 10);
  assert.equal(crit("Mountaineer", { tier: 1 }), 10);
  assert.equal(crit("Privateer", { tier: 2 }), 15);
  assert.equal(crit("Mountaineer", { level: 25 }), 15, "without a tier the level says");
});

test("Pride and Underdog count the class tiers between the two units", () => {
  const proud = (about, foe) => against(unit({ skills: [skill("Pride")], ...about }), foe).combat;
  assert.deepEqual(proud({ level: 10, tier: 1 }, { level: 8, tier: 1 }), { hit: 15 });
  assert.deepEqual(proud({ level: 22, tier: 2 }, { level: 18, tier: 1 }), { hit: 20, critical: 5 });
  assert.deepEqual(proud({ level: 42, tier: 3 }, { level: 41, tier: 1 }), { hit: 10, critical: 10 }, "the tiers count whatever the levels are");
  assert.deepEqual(proud({ level: 5, tier: 1 }, { level: 5, tier: 2 }), {});

  const humble = (about, foe) => against(unit({ skills: [skill("Underdog")], ...about }), foe, "defending").combat;
  assert.deepEqual(humble({ level: 5, tier: 1 }, { level: 7, tier: 1 }), { dodge: 15 });
  assert.deepEqual(humble({ level: 18, tier: 1 }, { level: 45, tier: 3 }), { dodge: 25, critAvoid: 10 });
  assert.deepEqual(humble({ level: 25, tier: 2 }, { level: 5, tier: 0 }), {});
});

test("Knightly Tactics gives the effect picked when an enemy initiates, times the class tier", () => {
  const knight = (choice, tier, role = "defending") => against(unit({ skills: [skill("Knightly Tactics", { choice })], tier }), {}, role);
  assert.deepEqual(knight("Weißritter", 1).stats, { res: 1 });
  assert.equal(knight("Weißritter", 1).combat.activation, 4);
  assert.deepEqual(knight("Weißritter", 2).stats, { res: 3 });
  assert.equal(knight("Weißritter", 3).combat.activation, 12);
  assert.deepEqual(knight("Weißritter", 3).stats, { res: 4 });
  assert.equal(knight("Grünritter", 2).haste, 2);
  assert.deepEqual(knight("Grünritter", 2).stats, { dex: 4 });
  assert.deepEqual(knight("Gelbritter", 3).combat, { damage: 5, dodge: 15 });
  assert.deepEqual(knight("Beigeritter", 1, "initiating").combat, {}, "not when the unit itself initiates");
  assert.deepEqual(knight("", 2).stats, {}, "nothing until an effect is picked");
});

test("Imperial Tactics gives the effect picked when initiating, and Todesrose rolls to Rattle by its own list", () => {
  const rose = (choice, tier, role = "initiating") => against(unit({ skills: [skill("Imperial Tactics", { choice })], tier }), {}, role);
  assert.deepEqual(rose("Schwarze Rose", 2).combat, { hit: 14, critical: 6 });
  assert.equal(rose("Bergrose", 1).taken, -1);
  assert.equal(rose("Bergrose", 3).taken, -5);
  assert.deepEqual(rose("Trauerrose", 2).stats, { spd: 3 });
  assert.deepEqual(rose("Aschfahle Rose", 3, "defending").stats, {});

  const heal = rose("Welke Rose", 2).procs.map((raw) => resolveProc(raw, unit({ tier: 2 }).self, null));
  assert.equal(heal.length, 1);
  assert.equal(heal[0].recover, 4);

  for ( const [tier, chance] of [[1, 8], [2, 12], [3, 16]] ) {
    const who = unit({ skills: [skill("Imperial Tactics", { choice: "Todesrose" })], tier, stats: { dex: 8 } });
    const { procs, stats } = against(who);
    assert.deepEqual(stats, { mag: 2 * tier });
    assert.equal(procs.length, 1, `one chance at Tier ${tier}`);
    assert.equal(chanceOf(procs[0].effect.proc, who.self, null), chance);
    assert.deepEqual(procs[0].effect.inflicts, ["rattled"]);
  }
});

test("Ruse lowers the stat picked by 3, and by one more for each class tier above the first", () => {
  const stacks = (choice, tier) => {
    const who = unit({ skills: [skill("Ruse", { choice })], tier });
    const [raw] = against(who).procs;
    return resolveProc(raw, who.self, { role: "initiating", distance: 1, foe: { stats: {} } }).grants[0];
  };
  assert.equal(stacks("STR", 1).stacks, 3);
  assert.deepEqual(stacks("STR", 1).effects, [{ stats: { str: -1 } }]);
  assert.equal(stacks("STR", 2).stacks, 4);
  assert.equal(stacks("LUK", 3).stacks, 5);
  assert.equal(stacks("MOV", 1).stacks, 2);
  assert.equal(stacks("MOV", 3).stacks, 4);
});

test("gender and the highest weapon rank are read for the conditions that ask for them", () => {
  assert.equal(genderOf("Male"), "male");
  assert.equal(genderOf(" f "), "female");
  assert.equal(genderOf("Nonbinary"), "");
  assert.equal(genderOf(""), "");
  assert.equal(holds({ gender: "male" }, { gender: "Man" }), true);
  assert.equal(holds({ gender: "male" }, { gender: "Woman" }), false);
  assert.equal(holds({ gender: "male" }, { gender: "nonbinary" }), true);
  assert.equal(holds({ gender: "female" }, {}), true, "nothing typed is neither");

  assert.equal(bestRankOf({ sword: "C", fire: "D", staff: "F" }), "physical");
  assert.equal(bestRankOf({ sword: "E", staff: "B" }), "magical");
  assert.equal(bestRankOf({ lance: "A", dark: "A" }), "both");
  assert.equal(bestRankOf({ sword: "F", fire: "F" }), "");
  assert.equal(holds({ bestRank: "physical" }, { bestRank: "physical" }), true);
  assert.equal(holds({ bestRank: "physical" }, { bestRank: "both" }), true);
  assert.equal(holds({ bestRank: "physical" }, { bestRank: "magical" }), false);
  assert.equal(holds({ bestRank: "magical" }, { bestRank: "" }), false);
  assert.equal(holds({ tier: { min: 2 } }, { level: 30 }), true);
  assert.equal(holds({ tier: { min: 2, max: 2 } }, { tier: 3 }), false);
});

test("Altesse and Advisor reach the allies their pick names", () => {
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const placed = (id, j, about = {}) => ({ id, name: id, side: "player", tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills: [], ...about });
  const given = (giver, ally) => {
    const auras = standing([giver, ally], ally.id, measure).auras;
    return skillTotals(auras, selfOf(ally));
  };
  const lady = (choice) => placed("lady", 0, { skills: [skill("Altesse", { choice })] });
  assert.equal(given(lady("Female"), placed("ally", 2, { gender: "Female" })).taken, -3);
  assert.equal(given(lady("Female"), placed("ally", 2, { gender: "Male" })).taken, 0);
  assert.equal(given(lady("Female"), placed("ally", 2, { gender: "Nonbinary" })).taken, -3);
  assert.equal(given(lady("Male"), placed("ally", 2, { gender: "" })).taken, -3);
  assert.equal(given(lady("Male"), placed("ally", 3, { gender: "Male" })).taken, 0, "out of reach");
  assert.equal(given(lady(""), placed("ally", 1, { gender: "Male" })).taken, 0, "nothing picked");

  const sage = (choice) => placed("sage", 0, { skills: [skill("Advisor", { choice })] });
  assert.equal(given(sage("Magical"), placed("ally", 1, { bestRank: "magical" })).combat.damage, 3);
  assert.equal(given(sage("Magical"), placed("ally", 1, { bestRank: "both" })).combat.damage, 3);
  assert.equal(given(sage("Magical"), placed("ally", 1, { bestRank: "physical" })).combat.damage, undefined);
  assert.equal(given(sage("Physical"), placed("ally", 2, { bestRank: "physical" })).combat.damage, 3);
});

test("Authority is its boosts, or Leadership Stars with that module, and grows each time it is raised", () => {
  const boosts = (raises) => {
    const who = unit({ skills: [skill("Authority", { raises })] });
    return skillTotals(who.skills, who.self).combat;
  };
  const was = FEO.optional.leadership.enabled;
  try {
    FEO.optional.leadership.enabled = false;
    assert.deepEqual(boosts(0), { hit: 10, dodge: 10 });
    assert.deepEqual(boosts(1), { hit: 20, dodge: 20 });
    assert.deepEqual(boosts(2), { hit: 30, dodge: 30 });
    assert.equal(skillStars([skill("Authority")]), 0);
    assert.equal(skillStars([skill("Divine Authority")]), 0);

    FEO.optional.leadership.enabled = true;
    assert.deepEqual(boosts(1), {});
    assert.equal(skillStars([skill("Authority")]), 1);
    assert.equal(skillStars([skill("Authority", { raises: 2 })]), 3);
    assert.equal(skillStars([skill("Authority"), skill("Divine Authority")]), 4);
  } finally {
    FEO.optional.leadership.enabled = was;
  }
  assert.equal(readsRaises(skill("Authority").effects), true);
  assert.equal(readsRaises(skill("Divine Authority").effects), false);
});

test("the parts Step 3 added are known to the check, and their mistakes are caught", () => {
  assert.deepEqual(checkEffects([{ when: { tier: { min: 2 } }, stats: { str: 1 } }]), []);
  assert.equal(checkEffects([{ when: { tier: 2 }, stats: { str: 1 } }]).length, 1);
  assert.equal(checkEffects([{ when: { tier: { above: 2 } }, stats: { str: 1 } }]).length, 1);
  assert.deepEqual(checkEffects([{ aura: { who: "ally", within: 2, when: { gender: "female" } }, taken: -3 }]), []);
  assert.equal(checkEffects([{ aura: { who: "ally", within: 2, when: { gender: "robot" } }, taken: -3 }]).length, 1);
  assert.equal(checkEffects([{ when: { bestRank: "staves" }, stats: { str: 1 } }]).length, 1);
  assert.deepEqual(checkEffects([{ when: { module: "leadership" }, stars: 1 }]), []);
  assert.equal(checkEffects([{ when: { module: "nothing" }, stars: 1 }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "hit", sure: true }, stars: 1 }]).length, 1);
  assert.deepEqual(checkEffects([{ abilities: { cha: 1 } }]), []);
  assert.equal(checkEffects([{ abilities: { str: 1 } }]).length, 1);
});

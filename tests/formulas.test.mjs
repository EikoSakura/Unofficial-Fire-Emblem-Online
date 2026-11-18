/**
 * Tests for damage formulas and what an attack targets (`module/rules/combat.mjs`, `module/rules/skills.mjs`,
 * `module/rules/skill-combat.mjs`): what resists an attack, damage read from HP or dealt as a second blow,
 * kills and who is spared them, effective damage and its exceptions, numbers counted per something, what a
 * fight has come to by the time its late effects are read, and stats gained as a fight begins.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCombat } from "../module/rules/combat-stats.mjs";
import { echoDamage, planExchange, playExchange, rollBudget } from "../module/rules/combat.mjs";
import { baseDamage, checkEffects, ranksWith, skillTotals } from "../module/rules/skills.mjs";
import { timedEntries } from "../module/rules/timed.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/**
 * Plan a fight and roll it out with the dice given, one after the other; `rest` is what every die after them
 * comes up as. The dice that were rolled are counted against what the plan says it may need.
 */
function play(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const { result, used } = playExchange(plan, (index) => rolls[index] ?? rest, () => null, {});
  assert.ok(used <= rollBudget(plan), `the fight rolled ${used} dice, more than the ${rollBudget(plan)} it plans for`);
  return { plan, result };
}

// With 6 DEX and 5 LUK a unit has 5 Critical, which its foe's 5 Critical Avoid leaves nothing of: no critical
// roll is made. Its sword deals 5 + 10 STR - 6 DEF = 9, and hits at 86
const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const UNARMED = { weapon: null };
const TOME = { name: "Fire", category: "fire", range: "1-2", damageStat: "mag" };
const first = (result, side = "initiator") => result.attacks.find((attack) => attack.side === side);
const dealt = (result, side = "initiator") => result.attacks.filter((attack) => attack.side === side).map((attack) => attack.damage);

const STEP = ["Arcane Blade", "Vanquish", "Hellhound", "Northswain's Glow", "Show of Force", "Mangle", "Shatterheart", "Lethality", "Ironhide",
  "Unstoppable", "Greater Terror", "Dark Veil", "Ruined Sky", "Colossus", "Titanomachy", "Collector", "Weapon Insight", "Artillerist", "Cruelty",
  "Tenacity", "Opportunist", "Punish", "Observant", "Teshuah", "Kestrel", "Expiacion", "Brutal Strength", "Lethal Grace", "Killing Machine", "Quixotic",
  "Ambush", "General"];

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

test("a typing mistake in what an attack deals does not pass silently", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  const attack = { on: "attack", stat: "dex" };
  assert.ok(wrong({ when: { foeWeaponRank: ["Z"] }, takenPercent: -50 }));
  assert.ok(wrong({ when: { foeWeaponRank: "E" }, takenPercent: -50 }));
  assert.ok(wrong({ when: { foeEffective: "no" }, takenPercent: -50 }));
  assert.ok(wrong({ when: { foeDenied: false }, combat: { hit: 5 } }));
  assert.ok(wrong({ when: { overkill: 1 }, might: 2 }));
  assert.ok(wrong({ uneffective: "Armored" }));
  assert.ok(wrong({ proc: attack, uneffective: ["Armored"] }), "always there");
  assert.ok(wrong({ combatTimes: { speed: 2 } }));
  assert.ok(wrong({ combatTimes: { critical: "double" } }));
  assert.ok(wrong({ foeCombat: { might: 2 } }));
  assert.ok(wrong({ echo: { percent: 50, floor: 75 } }), "the floor is the smaller share");
  assert.ok(wrong({ echo: { percent: 50, element: "steam" } }));
  assert.ok(wrong({ echo: { percent: 50, resist: "luk" } }));
  assert.ok(wrong({ proc: attack, statPlus: { luk: 2 } }));
  assert.ok(wrong({ proc: { on: "struck", stat: "dex" }, statPlus: { str: 2 } }), "for an attack");
  assert.ok(wrong({ proc: attack, slay: "yes" }));
  assert.ok(wrong({ proc: attack, instead: { dice: 100 } }), "says what the share is of");
  assert.ok(wrong({ proc: attack, cut: { percent: 150 } }));
  assert.ok(wrong({ proc: attack, cut: { percent: 50, killAt: 0 } }));
  assert.ok(wrong({ proc: attack, defend: { def: 2 } }), "when struck");
  assert.ok(wrong({ proc: { on: "struck", stat: "dex" }, defend: { luk: 2 } }));
  assert.ok(wrong({ proc: attack, effective: "Terror" }));
  assert.ok(wrong({ proc: { on: "hit", sure: true }, stats: { spd: 5 } }), "stats come from the start");
  assert.ok(wrong({ proc: { on: "attack", sure: true, unable: true }, damage: 2 }));
  assert.ok(wrong({ proc: { on: "crit", sure: true, harmless: true }, recover: 2 }), "deals damage of its own");
  assert.deepEqual(checkEffects([{ proc: { on: "start", stat: "dex" }, stats: { spd: 5 } }]), []);
  assert.deepEqual(checkEffects([{ proc: attack, effective: ["Terror"] }]), []);
});

test("a unit has a rank with a kind of weapon, or has not", () => {
  const ranks = { sword: { rank: "E" }, axe: { rank: "F" }, fire: { rank: "C" } };
  assert.equal(ranksWith(ranks, "sword"), true);
  assert.equal(ranksWith(ranks, "axe"), false, "F is no rank at all");
  assert.equal(ranksWith(ranks, "lance"), false);
  assert.equal(ranksWith(ranks, "anima"), true, "Anima goes by any of its proficiencies");
  assert.equal(ranksWith(ranks, "monster"), false, "a kind without a proficiency");
});

test("base damage is Might and stat less the defence that resists the weapon", () => {
  const self = { weapon: { category: "sword", might: 5, damageStat: "str" }, stats: { str: 10, mag: 4 } };
  assert.equal(baseDamage(self, { stats: { def: 6, res: 3 } }), 9);
  assert.equal(baseDamage({ ...self, weapon: { category: "fire", might: 5, damageStat: "mag" } }, { stats: { def: 6, res: 3 } }), 6);
  assert.equal(baseDamage({ ...self, weapon: null }, { stats: { def: 6 } }), 0);
});

/* -------------------------------------------- */
/*  What Resists an Attack                      */
/* -------------------------------------------- */

test("Arcane Blade adds 5 + MAG to Hit and Critical and is resisted by RES", () => {
  const { result } = play(A({ skills: [skill("Arcane Blade")] }), B(UNARMED), [1, 1, 100]);
  const attack = first(result);
  assert.equal(attack.damage, 12, "5 + 10 - 3 RES in place of 6 DEF");
  assert.equal(attack.hitChance, 95);
  assert.equal(attack.critChance, 9);
  assert.equal(first(play(A({ skills: [skill("Arcane Blade")] }), B(UNARMED), [100, 1]).result).damage, 9, "not when it does not activate");
});

test("Vanquish is resisted by whichever of DEF and RES is lower", () => {
  const vanquish = () => A({ skills: [skill("Vanquish")] });
  assert.equal(first(play(vanquish(), B(UNARMED), [1, 1]).result).damage, 12);
  assert.equal(first(play(vanquish(), B({ ...UNARMED, stats: { def: 2, res: 9 } }), [1, 1]).result).damage, 13, "DEF stays where it is the lower");
});

test("Expiacion counts a third of DEF or RES as the stat the weapon adds", () => {
  assert.equal(first(play(A({ skills: [skill("Expiacion")] }), B(UNARMED), [1, 1]).result).damage, 11, "+2 for 6 DEF, with a weapon that adds STR");
  const tome = play(A({ skills: [skill("Expiacion")], weapon: TOME }), B(UNARMED), [1, 1]);
  assert.equal(first(tome.result).damage, tome.plan.initiator.damage + 1, "+1 for 3 RES, with one that adds MAG");
  const blade = { name: "Levin Sword", damageStat: "mag" };
  const levin = play(A({ skills: [skill("Expiacion")], weapon: blade }), B(UNARMED), [1, 1]);
  assert.equal(first(levin.result).damage, levin.plan.initiator.damage + 1, "a sword that adds MAG goes by RES and MAG");
});

test("Expiacion counts a third of STR or MAG as the defence a hit is resisted with", () => {
  const guarded = () => B({ ...UNARMED, skills: [skill("Expiacion")] });
  assert.equal(first(play(A(), guarded(), [1, 1]).result).damage, 6, "9 less a third of 10 STR, against DEF");
  const tome = play(A({ weapon: TOME }), guarded(), [1, 1]);
  assert.equal(first(tome.result).damage, tome.plan.initiator.damage - 1, "a third of 4 MAG, against RES");
  const turned = play(A({ skills: [made("Turn", [{ against: "res" }])] }), guarded(), [1, 1]);
  assert.equal(first(turned.result).damage, turned.plan.initiator.damage - 1, "a sword a skill has resisted by RES goes by MAG");
});

test("Brutal Strength counts half the unit's HP as STR", () => {
  assert.equal(first(play(A({ skills: [skill("Brutal Strength")] }), B(UNARMED), [1, 1]).result).damage, 24);
  const tome = play(A({ skills: [skill("Brutal Strength")], weapon: TOME }), B(UNARMED), [1, 1]);
  assert.equal(first(tome.result).damage, tome.plan.initiator.damage, "nothing for a weapon that adds MAG");
});

/* -------------------------------------------- */
/*  Damage Read From HP, or Dealt Again         */
/* -------------------------------------------- */

test("an echo is a share of the hit, less what resists it, and no less than its floor", () => {
  const echo = { percent: 50, floor: 25, held: 3, plus: 0, negated: false };
  assert.equal(echoDamage(echo, 9), 2, "4 less 3 RES is under a quarter of 9");
  assert.equal(echoDamage({ ...echo, held: 0 }, 9), 4);
  assert.equal(echoDamage(echo, 40), 17);
  assert.equal(echoDamage(echo, 0), 0, "nothing for a hit that dealt nothing");
  assert.equal(echoDamage({ ...echo, negated: true }, 40), 0);
});

test("Hellhound deals half of each hit again as Fire damage, when its unit begins the fight", () => {
  const { plan, result } = play(A({ skills: [skill("Hellhound")] }), B(UNARMED), [1]);
  assert.deepEqual(plan.initiator.blows.map((blow) => [blow.damage, blow.echo]), [[11, 2]], "the forecast counts it in the damage");
  assert.equal(first(result).damage, 9);
  assert.deepEqual(first(result).harm, [{ skill: "Hellhound", by: "initiator", to: "defender", amount: 2, element: "fire" }]);
  assert.equal(result.defender.hp, 19);
  const answered = play(A(), B({ skills: [skill("Hellhound")] }), [1, 1]);
  assert.equal(answered.plan.defender.echoes.length, 0, "not for the unit that is attacked");
  assert.equal(answered.result.initiator.hp, 21);
});

test("Hellhound's second blow can defeat the foe, and is its unit's kill", () => {
  const { result } = play(A({ skills: [skill("Hellhound"), made("Trophy", [{ proc: { on: "kill", sure: true }, recover: 4 }])], hp: 20 }), B({ ...UNARMED, hp: 11 }), [1]);
  assert.equal(first(result).kill, false, "the hit left 2 HP");
  assert.equal(result.defender.defeated, true);
  assert.equal(result.initiator.healed, 4, "what its skills give for defeating a foe is given");
});

test("Northswain's Glow adds the average of MAG, RES and LUK and is effective against Terror", () => {
  const glow = () => A({ skills: [skill("Northswain's Glow")] });
  assert.equal(first(play(glow(), B(UNARMED), [1, 1]).result).damage, 13, "+4 for 4, 3 and 5");
  assert.equal(first(play(glow(), B({ ...UNARMED, qualities: "Terror" }), [1, 1]).result).damage, 23, "and the weapon's Might twice more");
});

test("Show of Force doubles the weapon's Might against a foe its base damage would fell", () => {
  const show = () => A({ skills: [skill("Show of Force")] });
  assert.equal(play(show(), B({ ...UNARMED, hp: 8 })).plan.initiator.damage, 14);
  assert.equal(play(show(), B({ ...UNARMED, hp: 9 })).plan.initiator.damage, 9, "9 is not more than 9 HP");
  assert.equal(play(show(), B(UNARMED)).plan.initiator.damage, 9);
});

test("Mangle deals a D100 share of the target's maximum HP in place of the damage, unless that is more", () => {
  const mangle = () => A({ skills: [skill("Mangle")] });
  const more = first(play(mangle(), B(UNARMED), [1, 1, 60]).result);
  assert.equal(more.damage, 18, "60% of 30 HP");
  assert.deepEqual(more.instead, { skill: "Mangle", roll: 60, dice: 100, amount: 18, took: true });
  const less = first(play(mangle(), B(UNARMED), [1, 1, 20]).result);
  assert.equal(less.damage, 9, "6 is less than the hit");
  assert.equal(less.instead.took, false);
  assert.equal(first(play(mangle(), B(UNARMED), [100, 1, 60]).result).instead, undefined, "not when it does not activate");
});

test("Shatterheart halves the HP its target has left, and kills a target left at 1 HP", () => {
  const heart = () => A({ skills: [skill("Shatterheart")] });
  const halved = play(heart(), B(UNARMED), [1, 1]).result;
  assert.equal(halved.defender.hp, 11, "30 - 9 = 21, then 10 less");
  assert.deepEqual(first(halved).harm, [{ skill: "Shatterheart", by: "initiator", to: "defender", amount: 10, cut: "share" }]);
  const killed = play(heart(), B({ ...UNARMED, hp: 10 }), [1, 1]).result;
  assert.equal(killed.defender.defeated, true);
  assert.equal(first(killed).harm[0].cut, "kill");
  assert.equal(play(heart(), B({ ...UNARMED, hp: 11 }), [1, 1]).result.defender.hp, 1, "2 HP left lose 1");
});

test("Lethality kills at half the unit's Critical", () => {
  const whisper = () => A({ skills: [skill("Lethality")] });
  const { plan, result } = play(whisper(), B(UNARMED), [1, 1]);
  assert.equal(plan.initiator.chances.attack[0].chance, 2, "half of 5 Critical");
  assert.equal(first(result).slain, "Lethality");
  assert.equal(first(result).damage, 30);
  assert.equal(result.defender.defeated, true);
  assert.equal(play(whisper(), B(UNARMED), [3, 1]).result.defender.hp, 21);
});

test("a kill may be survived as any lethal blow may", () => {
  const saved = B({ ...UNARMED, skills: [made("Miracle", [{ proc: { on: "struck", sure: true }, survive: { hp: { op: "gt", percent: 50 } } }])] });
  assert.equal(play(A({ skills: [skill("Lethality")] }), saved, [1, 1]).result.defender.hp, 1);
});

test("General negates Lethality and Bane: the attack deals its damage and no more", () => {
  const boss = () => B({ ...UNARMED, skills: [skill("General")] });
  const lethal = play(A({ skills: [skill("Lethality")] }), boss(), [1, 1]).result;
  assert.equal(lethal.defender.hp, 21);
  assert.equal(first(lethal).slain, undefined);
  const mangled = play(A({ skills: [skill("Mangle")] }), boss(), [1, 1, 60]).result;
  assert.equal(first(mangled).damage, 9);
  assert.equal(first(mangled).instead, undefined, "nothing is rolled");
  assert.equal(play(A({ skills: [skill("Shatterheart")] }), boss(), [1, 1]).result.defender.hp, 21);
  assert.equal(play(A({ skills: [skill("Shatterheart")] }), B({ ...UNARMED, hp: 10, skills: [skill("General")] }), [1, 1]).result.defender.hp, 1);
});

test("Lethal Grace deals a tenth of the target's maximum HP on a critical hit that deals none", () => {
  const grace = () => A({ skills: [skill("Lethal Grace")] });
  const wall = play(grace(), B({ ...UNARMED, stats: { def: 30 } }), [1, 1]);
  assert.equal(wall.plan.initiator.crit, 5, "+5 Critical at Tier 1");
  assert.equal(first(wall.result).crit, true);
  assert.equal(first(wall.result).damage, 0);
  assert.equal(wall.result.defender.hp, 27);
  assert.equal(play(grace(), B({ ...UNARMED, stats: { def: 30 } }), [1, 100]).result.defender.hp, 30, "not on a hit that is no critical hit");
  assert.equal(play(grace(), B(UNARMED), [1, 1]).result.defender.hp, 3, "a critical hit that deals damage deals that");
});

test("Killing Machine doubles the unit's Critical once everything is added", () => {
  const machine = planExchange(A({ skills: [skill("Killing Machine")] }), B(UNARMED));
  assert.equal(machine.initiator.unit.combat.critical, 10);
  assert.equal(machine.initiator.crit, 5);
  assert.deepEqual(machine.initiator.unit.fx.sources.find((source) => source.name === "Killing Machine").combat, { critical: 5 }, "named in the sum");
  const sheet = computeCombat({ stats: { dex: 6, luk: 5 }, times: [{ label: "Killing Machine", key: "critical", times: 2 }] }, { crit: 10 });
  assert.equal(sheet.critical.value, 30);
  assert.deepEqual(sheet.critical.terms.at(-1), { label: "Killing Machine", localize: false, value: 15, modifier: true });
});

/* -------------------------------------------- */
/*  Effective Damage and its Exceptions         */
/* -------------------------------------------- */

const HAMMER = { name: "Hammer", effect: "Effective against Armored units." };
const BLESSED = { name: "Blessed Sword", effect: "Effective against Terror units." };

test("Ironhide halves damage from E and D rank weapons that are not effective against its unit", () => {
  const hide = (options = {}) => B({ ...UNARMED, skills: [skill("Ironhide")], ...options });
  assert.equal(planExchange(A(), hide()).initiator.damage, 4, "half of 9, rounded down");
  assert.equal(planExchange(A({ weapon: { rank: "D" } }), hide()).initiator.damage, 4);
  assert.equal(planExchange(A({ weapon: { rank: "C" } }), hide()).initiator.damage, 9);
  assert.equal(planExchange(A({ weapon: HAMMER }), hide({ qualities: "Armored" })).initiator.damage, 19, "an effective weapon deals its damage");
  assert.equal(planExchange(A({ weapon: HAMMER }), hide()).initiator.damage, 4, "one that is not effective against this unit is halved");
});

test("Unstoppable takes no effective damage for being Armored, and deals +5 to wielders of Armor-effective weapons", () => {
  const gigas = (options = {}) => B({ skills: [skill("Unstoppable")], qualities: "Armored, Mounted", ...options });
  const plan = planExchange(A({ weapon: HAMMER }), gigas());
  assert.deepEqual(plan.initiator.effective, []);
  assert.equal(plan.initiator.damage, 9);
  assert.equal(plan.defender.damage, 14, "+5 against the Hammer");
  assert.equal(planExchange(A(), gigas()).defender.damage, 9);
  const both = planExchange(A({ weapon: { name: "Rapier", effect: "Effective against Armored and Mounted units." } }), gigas());
  assert.deepEqual(both.initiator.effective, ["Mounted"], "still effective for what else the unit is");
});

test("Greater Terror gains +7 DEF and RES against Terror-effective weapons", () => {
  const terror = () => B({ ...UNARMED, skills: [skill("Greater Terror")], qualities: "Terror" });
  assert.equal(planExchange(A({ weapon: BLESSED }), terror()).initiator.damage, 12, "15 + 10 - 13");
  assert.equal(planExchange(A(), terror()).initiator.damage, 9);
  const slayer = planExchange(A({ weapon: TOME, skills: [skill("Slayer")] }), terror());
  assert.equal(slayer.defender.unit.stats.res, 10, "a tome a skill makes effective against Terror is such a weapon");
});

test("Dark Veil gains +35 Dodge against weapons that are not Terror-effective", () => {
  const wraith = () => B({ ...UNARMED, skills: [skill("Dark Veil")], qualities: "Terror" });
  const { result } = play(A(), wraith(), [1, 1]);
  assert.equal(first(result).hitChance, 51);
  assert.equal(first(play(A(), wraith(), [100, 1]).result).hitChance, 86, "not when it does not activate");
  const blessed = play(A({ weapon: BLESSED }), wraith(), [1, 1]);
  assert.equal(blessed.plan.defender.chances.start.length, 0, "nothing to roll against a Terror-effective weapon");
  assert.equal(first(blessed.result).hitChance, 86);
});

test("Ruined Sky is effective against Flying units, more so with a Flying-effective weapon, and with Giantkiller", () => {
  const flier = () => B({ ...UNARMED, qualities: "Flying" });
  const lance = { name: "Skylance", effect: "Effective against Flying units." };
  assert.equal(planExchange(A({ skills: [skill("Ruined Sky")] }), flier()).initiator.damage, 19, "x3 with any weapon");
  assert.equal(planExchange(A({ skills: [skill("Ruined Sky")], weapon: lance }), flier()).initiator.damage, 24, "x4");
  assert.equal(planExchange(A({ skills: [skill("Ruined Sky"), skill("Giantkiller")], weapon: lance }), flier()).initiator.damage, 29, "x5");
  assert.equal(planExchange(A({ skills: [skill("Ruined Sky"), skill("Giantkiller")] }), flier()).initiator.damage, 24, "Giantkiller alone is x4");
  assert.equal(planExchange(A({ skills: [skill("Ruined Sky")], weapon: lance }), B(UNARMED)).initiator.damage, 9);
});

/* -------------------------------------------- */
/*  Numbers Per Something                       */
/* -------------------------------------------- */

test("Colossus triples STR and adds Might for each point of CON over the target's", () => {
  const reaver = (con) => A({ skills: [skill("Colossus")], stats: { con } });
  assert.equal(first(play(reaver(12), B(UNARMED), [1, 1]).result).damage, 33, "9 + 20 + 4");
  assert.equal(first(play(reaver(8), B(UNARMED), [1, 1]).result).damage, 29);
  const hammer = play(reaver(12), B({ ...UNARMED, qualities: "Armored" }), [1, 1]);
  assert.equal(first(hammer.result).damage, 33, "no more without an effective weapon");
  const smash = play(A({ skills: [skill("Colossus")], stats: { con: 12 }, weapon: HAMMER }), B({ ...UNARMED, qualities: "Armored" }), [1, 1]);
  assert.equal(first(smash.result).damage, smash.plan.initiator.damage + 20 + 12, "the Might counts as the weapon's own");
});

test("Titanomachy trades DEX and SPD for STR and DEF by the CON it has over its weapon's Weight", () => {
  const titan = (con) => planExchange(A({ skills: [skill("Titanomachy")], stats: { con } }), B(UNARMED)).initiator.unit.stats;
  const some = titan(8);
  assert.deepEqual([some.str, some.def, some.dex, some.spd], [16, 12, 3, 5], "3 points over a Weight of 5");
  const most = titan(20);
  assert.deepEqual([most.str, most.def, most.dex, most.spd], [22, 18, 0, 2], "up to +12 and down to -6");
  const none = titan(4);
  assert.deepEqual([none.str, none.def, none.dex, none.spd], [10, 6, 6, 8]);
});

test("Collector deals +2 and takes -1 for each weapon it carries and cannot use", () => {
  const plan = planExchange({ ...A({ skills: [skill("Collector")] }), unusable: 2 }, B());
  assert.equal(plan.initiator.damage, 13);
  assert.equal(plan.defender.damage, 7);
  assert.equal(planExchange(A({ skills: [skill("Collector")] }), B()).initiator.damage, 9);
});

test("Weapon Insight gains +3 STR, SPD and DEX against a weapon type its unit has a rank with", () => {
  const paladin = () => A({ skills: [skill("Weapon Insight")] });
  const known = planExchange(paladin(), B()).initiator.unit.stats;
  assert.deepEqual([known.str, known.spd, known.dex], [13, 11, 9]);
  const unknown = planExchange(paladin(), B({ weapon: { name: "Iron Axe", category: "axe" } })).initiator.unit.stats;
  assert.deepEqual([unknown.str, unknown.spd, unknown.dex], [10, 8, 6]);
  assert.equal(planExchange(paladin(), B(UNARMED)).initiator.unit.stats.str, 10);
});

test("Artillerist gains by the distance, and half as much with Bolts", () => {
  const far = (weapon) => planExchange(A({ skills: [skill("Artillerist")], weapon }), B(UNARMED), { distance: 4 }).initiator;
  const bow = far({ name: "Longbow", category: "bow", range: "2-4" });
  const plain = planExchange(A({ weapon: { name: "Longbow", category: "bow", range: "2-4" } }), B(UNARMED), { distance: 4 }).initiator;
  assert.equal(bow.damage - plain.damage, 3);
  assert.equal(bow.base.critical - plain.base.critical, 9);
  const bolt = far({ name: "Ballista", category: "bolt", range: "3-10" });
  const loose = planExchange(A({ weapon: { name: "Ballista", category: "bolt", range: "3-10" } }), B(UNARMED), { distance: 4 }).initiator;
  assert.equal(bolt.damage - loose.damage, 1, "half of 3, rounded down");
  assert.equal(bolt.base.critical - loose.base.critical, 4, "half of 9, rounded down");
});

const CURSE = { name: "Curse", from: "Actor.Z", effects: [{ stats: { str: -3, def: -2 } }], ends: "map", turns: 1, stacks: 1 };

test("Cruelty gains +3 Hit for each of the foe's stats that is lowered", () => {
  const cruel = () => A({ skills: [skill("Cruelty")] });
  const cursed = { ...B(UNARMED), timed: [CURSE] };
  const plan = planExchange(cruel(), cursed);
  assert.equal(plan.initiator.base.accuracy - planExchange(A(), cursed).initiator.base.accuracy, 6, "STR and DEF are lowered");
  assert.equal(plan.initiator.damage, planExchange(A(), cursed).initiator.damage, "no condition, no damage");
  assert.equal(planExchange(cruel(), B(UNARMED)).initiator.base.accuracy, planExchange(A(), B(UNARMED)).initiator.base.accuracy);
  const own = { ...B(UNARMED), timed: [{ ...CURSE, from: "" }] };
  assert.equal(planExchange(cruel(), own).initiator.base.accuracy, planExchange(A(), own).initiator.base.accuracy, "what a unit does to itself is no debuff");
});

test("Cruelty counts a stat that a skill of its own unit lowers in the fight", () => {
  const seal = made("Daunt", [{ foeStats: { spd: -2, luk: -1 } }]);
  const plan = planExchange(A({ skills: [skill("Cruelty"), seal] }), B(UNARMED));
  const plain = planExchange(A({ skills: [seal] }), B(UNARMED));
  assert.equal(plan.initiator.base.accuracy - plain.initiator.base.accuracy, 6);
});

test("Tenacity deals more by the points the foe's stats are lowered by", () => {
  const cursed = { ...B(UNARMED), timed: [CURSE] };
  assert.equal(planExchange(A({ skills: [skill("Tenacity")] }), cursed).initiator.damage - planExchange(A(), cursed).initiator.damage, 5);
  assert.equal(planExchange(A({ skills: [skill("Tenacity")] }), B(UNARMED)).initiator.damage, 9);
});

/* -------------------------------------------- */
/*  Conditions on the Fight                     */
/* -------------------------------------------- */

test("Opportunist is for a foe that is kept from its counter-attack, not for one whose weapon does not reach", () => {
  const rogue = () => A({ skills: [skill("Opportunist")] });
  assert.equal(planExchange(rogue(), B(UNARMED)).initiator.damage, 12, "an unarmed foe");
  assert.equal(planExchange(rogue(), B({ weapon: { name: "Bow", category: "bow", range: "2" } })).initiator.damage, 9, "a bow next to it does not reach");
  assert.equal(planExchange(rogue(), B({ weapon: { uses: { value: 0, max: 40 } } })).initiator.damage, 12, "a broken weapon");
  assert.equal(planExchange(rogue(), { ...B(), noCounter: true }).initiator.damage, 12, "a condition that takes the counter-attack");
  assert.equal(planExchange(rogue(), B()).initiator.damage, 9);
  assert.equal(planExchange(B(), rogue()).defender.damage, 9, "only when its unit begins the fight");
});

test("Opportunist is for a foe that answers with a Staff", () => {
  const staff = B({ weapon: { name: "Heal", category: "staff", might: 0 } });
  const plan = planExchange(A({ skills: [skill("Opportunist")] }), staff);
  assert.equal(plan.defender.blocked, null, "the Staff answers");
  assert.equal(plan.initiator.damage, 12);
  assert.equal(plan.initiator.base.accuracy - planExchange(A(), staff).initiator.base.accuracy, 5);
  assert.deepEqual(plan.initiator.denial, [], "and is not counted a second time");
});

test("Opportunist counts from the moment its foe loses its counter-attack in the middle of the fight", () => {
  const rogue = A({ skills: [skill("Opportunist")], stats: { spd: 14 } });
  const plan = planExchange(rogue, B({ weapon: { uses: { value: 1, max: 40 } } }));
  assert.deepEqual(plan.initiator.denial, [{ skill: "Opportunist", combat: { hit: 5, damage: 3, critical: 5 } }]);
  assert.deepEqual(plan.order, ["initiator", "defender", "initiator"]);

  // A hits, B hits and its weapon breaks, A follows up against a foe that can no longer answer
  const { result } = playExchange(plan, (index) => [1, 1, 1, 100][index] ?? 100, () => null, {});
  assert.deepEqual(dealt(result), [9, 12]);
  assert.equal(result.attacks[2].hitChance, result.attacks[0].hitChance + 5);
});

test("Punish answers a hit while its unit makes no attack, or none that deals damage", () => {
  const sage = (options = {}) => B({ skills: [skill("Punish")], ...options });
  const unarmed = play(A(), sage(UNARMED), [1]).result;
  assert.deepEqual(first(unarmed).reflected, 2, "half of 4 MAG");
  assert.equal(unarmed.initiator.hp, 28);
  const harmless = play(A({ stats: { def: 40 } }), sage(), [1, 1]);
  assert.equal(harmless.plan.defender.damage, 0);
  assert.equal(harmless.result.initiator.hp, 28, "its counter-attack deals nothing");
  const armed = play(A(), sage(), [1, 1]);
  assert.equal(armed.plan.defender.chances.struck.length, 0, "not for a unit whose attacks deal damage");
  assert.equal(armed.result.initiator.hp, 21);
  assert.equal(play(A({ hp: 2 }), sage(UNARMED), [1]).result.initiator.hp, 1, "it cannot kill");
});

test("Observant gains +2 HST against a foe that cannot counter", () => {
  const archer = (skills) => A({ skills, stats: { spd: 10 } });
  assert.equal(planExchange(archer([skill("Observant")]), B(UNARMED)).initiator.doubles, true, "a lead of 2 and 2 HST");
  assert.equal(planExchange(archer([]), B(UNARMED)).initiator.doubles, false);
  assert.equal(planExchange(archer([skill("Observant")]), B()).initiator.doubles, false, "not against a foe that answers");
});

test("Teshuah's change gives +1 HST with each +3 Critical Avoid", () => {
  const grant = skill("Teshuah").effects[0].grant;
  assert.equal(grant.max, 5);
  const totals = skillTotals(timedEntries([{ name: "Teshuah", from: "Actor.Z", effects: grant.effects, ends: "turnEnd", turns: 1, stacks: 3 }]), { hp: 20, hpMax: 20, stats: {} });
  assert.equal(totals.haste, 3);
  assert.equal(totals.combat.critAvoid, 9);
});

test("Kestrel's +5 SPD counts for the whole fight, and earns its unit a follow-up", () => {
  const hawk = () => A({ skills: [skill("Kestrel")] });
  const slow = () => B({ stats: { spd: 5 } });
  const plan = planExchange(hawk(), slow());
  assert.equal(plan.initiator.doubles, false, "a lead of 3 is not enough");
  assert.equal(plan.initiator.chances.start[0].statCombat.attackSpeed, 5);

  // The start roll, then A (which now rolls for a critical hit, and fails), B, and A again
  const { result } = playExchange(plan, (index) => [1, 1, 100, 1, 1, 100][index] ?? 100, () => null, {});
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "defender", "initiator"]);
  assert.deepEqual(dealt(result), [14, 14], "+5 damage");
  assert.equal(result.attacks[1].hitChance, planExchange(A(), slow()).defender.hit - 10, "+10 Dodge from 5 SPD");
  assert.equal(result.attacks[0].critChance, 20);
  const quiet = playExchange(plan, (index) => [100, 1, 1][index] ?? 100, () => null, {}).result;
  assert.deepEqual(quiet.attacks.map((attack) => attack.side), ["initiator", "defender"]);
});

test("Kestrel's +5 SPD takes a follow-up from a foe that had one by Attack Speed", () => {
  const plan = planExchange(A({ skills: [skill("Kestrel")] }), B({ stats: { spd: 12 } }));
  assert.equal(plan.defender.doubles, true);
  const { result } = playExchange(plan, (index) => [1, 1, 100, 1][index] ?? 100, () => null, {});
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "defender"]);
  const without = playExchange(plan, (index) => [100, 1, 1, 1][index] ?? 100, () => null, {}).result;
  assert.deepEqual(without.attacks.map((attack) => attack.side), ["initiator", "defender", "defender"]);
});

test("Quixotic adds 20 Critical and Skill Activation for both units, when its unit begins the fight", () => {
  const knight = () => A({ skills: [skill("Quixotic")] });
  const foe = () => B({ skills: [skill("Vanquish")] });
  const plan = planExchange(knight(), foe());
  assert.equal(plan.initiator.crit, 20);
  assert.equal(plan.defender.crit, 20);
  assert.equal(plan.defender.chances.attack[0].chance, 26, "6 DEX and 20");
  assert.deepEqual(plan.defender.unit.fx.sources.find((source) => source.name === "Quixotic").combat, { critical: 20 }, "named in the foe's sum");
  const turned = planExchange(foe(), knight());
  assert.equal(turned.initiator.crit, 0);
  assert.equal(turned.defender.crit, 0);
  assert.equal(turned.initiator.chances.attack[0].chance, 6);
});

test("Ambush is for a foe with nobody near it that makes no follow-up", () => {
  const around = (id, others) => ({ id, side: id === "a" ? "player" : "enemy", tile: null, ground: null, others });
  const alone = (extra = []) => ({
    a: around("a", [{ id: "b", name: "B", relation: "enemy", distance: 1 }, ...extra.map((unit) => ({ ...unit, relation: "enemy", distance: 3 }))]),
    b: around("b", [{ id: "a", name: "A", relation: "enemy", distance: 1 }, ...extra.map((unit) => ({ ...unit, relation: "ally" }))])
  });
  const ruffian = (near) => ({ ...A({ skills: [skill("Ambush")] }), near });
  const lone = alone();
  const plan = planExchange(ruffian(lone.a), { ...B(), near: lone.b });
  assert.equal(plan.initiator.damage, 12);
  assert.equal(plan.initiator.base.critical - planExchange(A(), B()).initiator.base.critical, 10);
  const guarded = alone([{ id: "c", name: "C", distance: 2 }]);
  assert.equal(planExchange(ruffian(guarded.a), { ...B(), near: guarded.b }).initiator.damage, 9, "another enemy within 2 spaces of the foe");
  const far = alone([{ id: "c", name: "C", distance: 3 }]);
  assert.equal(planExchange(ruffian(far.a), { ...B(), near: far.b }).initiator.damage, 12, "one 3 spaces away is not");
  assert.equal(planExchange(ruffian(lone.a), { ...B({ stats: { spd: 12 } }), near: lone.b }).initiator.damage, 9, "a foe that follows up");
  assert.equal(planExchange({ ...B(), near: lone.b }, ruffian(lone.a)).defender.damage, 9, "only when its unit begins the fight");
});

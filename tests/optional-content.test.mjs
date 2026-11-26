/**
 * Tests for what of the Optional Content Sheet is in the game (`packs-src/optional-content.json`): Katanas as a
 * sub-category of Swords and what an equipped weapon gives its unit (`module/rules/weapons.mjs`), the skills of
 * the Ashigaru and Oni Savage lines (`module/rules/combat.mjs`, `module/rules/rounds.mjs`,
 * `module/rules/stances.mjs`, `module/rules/items.mjs`), those of the Merchant line (`module/rules/stealing.mjs`,
 * `module/rules/earnings.mjs`, `module/rules/items.mjs`), and the list itself.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FEO } from "../module/config.mjs";
import { standing } from "../module/rules/auras.mjs";
import { goldGained, goldTally, turnGold } from "../module/rules/earnings.mjs";
import { surroundings } from "../module/rules/positions.mjs";
import { discounted, resold } from "../module/rules/stealing.mjs";
import { buildSkillTurnCard } from "../module/helpers/skill-turn-context.mjs";
import { backfires, planExchange, playExchange, rollBudget, weaponRank } from "../module/rules/combat.mjs";
import { ITEM_MOMENT, checkConsumes, checkItemMoment, itemLine, itemMoments, itemOffers, itemPower, itemPowers, itemRestores } from "../module/rules/items.mjs";
import { checkRounds, defenderLeads } from "../module/rules/rounds.mjs";
import { checkEffects, skillKnacks, skillStanding, skillTotals, turnMoment, weaponIs } from "../module/rules/skills.mjs";
import { checkShelters, shelterOf, shelteredFrom } from "../module/rules/stances.mjs";
import { carriedNames, cleanChange, grantChange, mendsOf, skillCounts, timedEntries } from "../module/rules/timed.mjs";
import { triangleAdvantage } from "../module/rules/triangle.mjs";
import { breakWeapon, canWield, weaponDodge, weaponEntry, weaponGives } from "../module/rules/weapons.mjs";
import { dice, fighter, skill, unit } from "./lib/fixtures.mjs";

/**
 * Plan a fight and roll it out with the dice given, one after the other; `rest` is what every die after them
 * comes up as. `rolled` is how many dice the fight asked for.
 */
function play(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  let most = -1;
  const { result } = playExchange(plan, (index) => {
    most = Math.max(most, index);
    return rolls[index] ?? rest;
  }, () => null, {});
  return { plan, result, rolled: most + 1 };
}

// With 6 DEX and 5 LUK a unit has 5 Critical, which its foe's 5 Critical Avoid leaves nothing of: no critical
// roll is made. Its sword deals 5 + 10 STR - 6 DEF = 9, and hits at 86. With 13 SPD it follows up
const A = (options = {}) => fighter({ name: "A", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const B = (options = {}) => fighter({ name: "B", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const FAST = { spd: 13 };
const BOW = { name: "Iron Bow", category: "bow", range: "2" };
const sides = (result) => result.attacks.map((attack) => attack.side[0].toUpperCase()).join("");
const by = (result, side) => result.attacks.filter((attack) => attack.side === side);
const granted = (result, to) => (result.granted ?? []).filter((entry) => entry.to === to).map((entry) => entry.change);
const after = (fighterUnit, result, to) => granted(result, to).reduce((list, change) => grantChange(list, change).list, fighterUnit.timed ?? []);
const count = (list, name) => (list.find((change) => change.name === name)?.stacks ?? 0);

const SKILLS = ["Fast Recovery", "Belligerent", "Mugen-Ryu", "Short Tempered", "Hitobashira", "Hard to Kill", "Senbonzakura", "Demon's Embrace",
  "Haggle", "Income", "Wealth Of Power", "Make A Killing"];
const KATANA = { name: "Iron Katana", category: "katana", might: 5, hit: 90, crit: 5, weight: 8, rank: "E", range: "1", effect: "+5 Dodge" };

/* -------------------------------------------- */
/*  The List                                    */
/* -------------------------------------------- */

test("the list names the skills of its lines, and each is written in parts the rules know", () => {
  const list = JSON.parse(readFileSync(fileURLToPath(new URL("../packs-src/optional-content.json", import.meta.url)), "utf8"));
  assert.deepEqual([...list.skills].sort(), [...SKILLS].sort());
  for ( const name of SKILLS ) {
    const entry = skill(name);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.ok(entry.effects.length > 0, name);
  }
  assert.deepEqual(list.weapons.Katanas, ["Bronze Katana", "Akuma", "Iron Katana", "Kotetsu"]);
  assert.deepEqual(list.items, { "Promotion and Reclassing": [FEO.optional.heartSeals.item] }, "the item a reclass spends, by the name it is looked for");
  assert.deepEqual(list.classes.map((entry) => entry.name), ["Ashigaru", "Rei", "Hitokiri", "Oni Savage", "Yokai", "Shugoki", "Merchant", "Profiteer", "Tycoon"]);
});

/* -------------------------------------------- */
/*  Katanas                                     */
/* -------------------------------------------- */

test("a Katana is wielded with the Sword rank, and what is for Swords is for Katanas", () => {
  assert.equal(FEO.weaponCategories.katana.proficiency, "sword");
  assert.equal(weaponRank({ sword: { rank: "C" } }, "katana"), "C");
  assert.ok(canWield({ sword: { rank: "E" } }, { category: "katana", rank: "E" }).ok);
  assert.ok(!canWield({ sword: { rank: "E" } }, { category: "katana", rank: "D" }).ok);
  assert.ok(!canWield({ lance: { rank: "A" } }, { category: "katana", rank: "E" }).ok);

  assert.ok(weaponIs(KATANA, ["sword"]), "a skill for Swords");
  assert.ok(weaponIs(KATANA, ["katana"]));
  assert.ok(!weaponIs({ category: "sword" }, ["katana"]), "what is for Katanas is for them alone");
  assert.ok(weaponIs(KATANA, ["melee"]) && weaponIs(KATANA, ["physical"]) && !weaponIs(KATANA, ["magic"]));
});

test("a Katana stands in the weapon triangle where a Sword does", () => {
  assert.equal(triangleAdvantage("katana", "axe"), 1);
  assert.equal(triangleAdvantage("axe", "katana"), -1);
  assert.equal(triangleAdvantage("katana", "lance"), -1);
  assert.equal(triangleAdvantage("lance", "katana"), 1);
  assert.equal(triangleAdvantage("katana", "sword"), 0);
});

test("a weapon's Effect adds Dodge where a part of it says so and nothing else", () => {
  assert.equal(weaponDodge("+5 Dodge"), 5);
  assert.equal(weaponDodge("+1 Dodge, (31-LUK)% of damaging wielder instead of target."), 1);
  assert.equal(weaponDodge("+8 Dodge, Terror"), 8);
  assert.equal(weaponDodge("Terror, +15 Dodge"), 15);
  assert.equal(weaponDodge("-50 Dodge, unit makes +2 additional attacks."), -50);
  assert.equal(weaponDodge("+3 Dodge. Does not count as a ranged attack at 2-3 Range."), 3);
  assert.equal(weaponDodge("Flying, User gains +20 Dodge against physical ranged attacks. 45% to Squall."), 0);
  assert.equal(weaponDodge("Inflicts -15 Dodge on enemy until user's next turn."), 0);
  assert.equal(weaponDodge("Target's Dodge is also reduced by 20."), 0);
  assert.equal(weaponDodge(""), 0);
});

test("every Katana grants +2 HST but -1 END while it is equipped, and the Dodge of its Effect", () => {
  assert.deepEqual(weaponGives(KATANA), [{ haste: 2, endurance: -1 }, { combat: { dodge: 5 } }]);
  assert.deepEqual(weaponGives({ category: "sword", effect: "+20 Dodge" }), [{ combat: { dodge: 20 } }]);
  assert.deepEqual(weaponGives({ category: "sword", effect: "" }), []);
  assert.deepEqual(weaponGives({ ...KATANA, broken: true }), [], "a weapon out of uses gives nothing");
  assert.equal(weaponEntry({ category: "sword", effect: "" }, "Iron Sword"), null);

  const entry = weaponEntry(KATANA, "Iron Katana");
  assert.equal(entry.name, "Iron Katana");
  assert.equal(entry.innate, true);
  assert.equal(entry.nihil, false, "Nihil cancels skills, not a weapon");
  assert.deepEqual(checkEffects(entry.effects), []);

  // As one more skill of its unit: 5 Dodge, 2 HST for following up, and 1 more damage from every hit
  const totals = skillTotals([entry], { hp: 20, hpMax: 20, level: 1, stats: {}, weapon: KATANA });
  assert.equal(totals.combat.dodge, 5);
  assert.equal(totals.haste, 2);
  assert.equal(totals.endurance, -1);
  assert.equal(totals.taken, 1);
});

test("in a fight a Katana follows up 2 Attack Speed sooner, and its wielder takes 1 more from every hit", () => {
  const armed = (options = {}) => A({ weapon: { ...KATANA, weight: 5 }, skills: [{ ...weaponEntry(KATANA, "Iron Katana"), active: false, spends: false, usage: null, state: null }], ...options });

  // 2 Attack Speed over the foe is no follow-up; with the Katana's HST it is
  assert.deepEqual(planExchange(A({ stats: { spd: 10 } }), B()).order, ["initiator", "defender"]);
  assert.deepEqual(planExchange(armed({ stats: { spd: 10 } }), B()).order, ["initiator", "defender", "initiator"]);

  // The foe's sword deals 9 to a unit without it, and 10 to one with it; and hits it 5 less often
  const plain = planExchange(B(), A()).initiator;
  const against = planExchange(B(), armed()).initiator;
  assert.equal(against.blows[0].damage, plain.blows[0].damage + 1);
  assert.equal(against.hit, plain.hit - 5);
});

test("a Katana breaks into a Broken Katana, and Akuma may turn on its wielder", () => {
  const broken = breakWeapon({ name: "Iron Katana", system: { ...KATANA, uses: { value: 0, max: 45 } } });
  assert.equal(broken.name, "Broken Katana");
  assert.equal(broken.system.weight, 18);
  assert.equal(weaponDodge(broken.system.effect), 1);
  assert.equal(broken.original.name, "Iron Katana");
  assert.equal(backfires("+1 Dodge, (31-LUK)% of damaging wielder instead of target."), 31);
});

/* -------------------------------------------- */
/*  Mugen-Ryu                                   */
/* -------------------------------------------- */

test("Mugen-Ryu: a hit by a unit that makes no follow-up is followed by attacks at half its Hit, 4 at the most", () => {
  const rei = (options = {}) => A({ skills: [skill("Mugen-Ryu")], ...options });
  const tough = () => B({ hp: 80, hpMax: 80 });

  // The opening attack hits at 86; each of the chain at 43, and all four land
  const all = play(rei(), tough(), [1, 43, 43, 43, 43, 100]);
  assert.equal(sides(all.result), "IIIIID");
  assert.deepEqual(by(all.result, "initiator").map((attack) => attack.hitChance), [86, 43, 43, 43, 43]);
  assert.deepEqual(by(all.result, "initiator").map((attack) => !!attack.added), [false, true, true, true, true]);
  assert.equal(by(all.result, "initiator")[1].skill, "Mugen-Ryu");
  assert.equal(all.result.defender.hp, 80 - (5 * 9));
  assert.equal(all.result.initiator.usesSpent, 5, "each wears the weapon");
  assert.ok(all.rolled <= rollBudget(all.plan), "the fight is handed dice enough");

  // The first that misses ends it
  const missed = play(rei(), tough(), [1, 43, 44, 100]);
  assert.equal(sides(missed.result), "IIID");
  assert.equal(missed.result.defender.hp, 80 - (2 * 9));

  // An opening attack that misses begins nothing
  assert.equal(sides(play(rei(), tough(), [87, 100]).result), "ID");

  // A unit that follows up makes its follow-up and no chain
  const fast = play(rei({ stats: FAST }), tough(), [1, 100, 1]);
  assert.equal(sides(fast.result), "IDI");
  assert.ok(by(fast.result, "initiator").every((attack) => !attack.added));

  // A counter-attack begins one as well, and the foe's fall ends one
  const counter = play(A(), B({ skills: [skill("Mugen-Ryu")] }), [100, 1, 43, 44]);
  assert.equal(sides(counter.result), "IDDD");
  const fell = play(rei(), B({ hp: 15 }), [1, 1, 1, 1, 1]);
  assert.equal(sides(fell.result), "II");
  assert.equal(fell.result.defender.hp, 0);
});

test("a typing mistake in a chain does not pass silently", () => {
  const wrong = (effect) => checkRounds(effect).length > 0;
  assert.ok(!wrong({ proc: { on: "hit", sure: true }, chain: { most: 4, hit: 50, lone: true } }));
  assert.ok(wrong({ proc: { on: "attack", sure: true }, chain: { most: 4 } }), "a chain is begun by a hit");
  assert.ok(wrong({ proc: { on: "hit", stat: "dex" }, chain: { most: 4 } }), "and is sure");
  assert.ok(wrong({ proc: { on: "hit", sure: true }, chain: { hit: 50 } }), "it says how many");
  assert.ok(wrong({ proc: { on: "hit", sure: true }, chain: { most: 4, hit: 150 } }));
  assert.ok(wrong({ proc: { on: "hit", sure: true }, chain: { most: 4, times: 2 } }));
  assert.ok(wrong({ proc: { on: "hit", sure: true, hurt: true }, damage: 1 }), "hurt is for an attack");
  assert.ok(wrong({ proc: { on: "attack", sure: true, hurt: true, from: 2 }, might: 1 }));
});

/* -------------------------------------------- */
/*  Short Tempered                              */
/* -------------------------------------------- */

test("Short Tempered: the foe attacks first in a fight the unit starts, and a hit taken is +5 Might from then on", () => {
  const yokai = (options = {}) => A({ skills: [skill("Short Tempered")], ...options });

  // The foe's hit lands: the unit answers with 5 + 5 Might
  const hit = play(yokai(), B(), [1, 1]);
  assert.deepEqual(hit.plan.order, ["defender", "initiator"]);
  assert.equal(sides(hit.result), "DI");
  assert.equal(by(hit.result, "initiator")[0].damage, 14);

  // It misses: the unit's attack is as it was
  const missed = play(yokai(), B(), [100, 1]);
  assert.equal(by(missed.result, "initiator")[0].damage, 9);

  // A fight an enemy starts is as it was, and the hit it lands counts all the same
  const attacked = play(A(), B({ skills: [skill("Short Tempered")] }), [1, 1]);
  assert.equal(sides(attacked.result), "ID");
  assert.equal(by(attacked.result, "defender")[0].damage, 14);

  // A foe that cannot answer attacks at no time, and two of the same mind fight as usual
  assert.deepEqual(planExchange(yokai({ weapon: BOW }), B(), { distance: 2 }).order, ["initiator"]);
  assert.deepEqual(planExchange(yokai(), B({ skills: [skill("Short Tempered")] })).order, ["initiator", "defender"]);

  // A follow-up comes where follow-ups do
  assert.deepEqual(planExchange(yokai({ stats: FAST }), B()).order, ["defender", "initiator", "initiator"]);
});

test("who leads a round: a defender that attacks first, or the foe of a unit that gives way", () => {
  assert.equal(defenderLeads([], []), false);
  assert.equal(defenderLeads([], ["first"]), true);
  assert.equal(defenderLeads(["first"], ["first"]), false);
  assert.equal(defenderLeads(["foeFirst"], []), true);
  assert.equal(defenderLeads(["foeFirst"], ["foeFirst"]), false);
  assert.equal(defenderLeads(new Set(["foeFirst", "first"]), new Set()), false, "a unit of two minds changes nothing");
  assert.equal(defenderLeads([], ["foeFirst"]), false, "the foe of a unit that is attacked attacks first anyway");
  assert.equal(defenderLeads(["foeFirst"], ["first"]), true);
});

/* -------------------------------------------- */
/*  Hitobashira                                 */
/* -------------------------------------------- */

test("Hitobashira: a killing blow restores the damage it dealt, and 3 HP as a turn starts above 75% HP", () => {
  const rei = (hp) => A({ hp, skills: [skill("Hitobashira")] });

  // The blow would deal 9; the foe had 5 HP left
  const killed = play(rei(10), B({ hp: 5 }), [1]);
  assert.equal(killed.result.defender.hp, 0);
  assert.equal(killed.result.initiator.hp, 15);
  assert.equal(killed.result.initiator.healed, 5);

  // A hit that does not kill restores nothing
  assert.equal(play(rei(10), B(), [1, 100]).result.initiator.hp, 10);

  const turn = skill("Hitobashira").effects.find((effect) => effect.proc.on === "turnStart");
  assert.equal(turn.recover, 3);
  assert.deepEqual(turn.when, { hp: { op: "gt", percent: 75 } });
});

/* -------------------------------------------- */
/*  Hard to Kill                                */
/* -------------------------------------------- */

test("Hard to Kill: +1 DEF and RES for every 3 HP missing, and shelter for the allies around below half HP", () => {
  const self = (hp) => ({ hp, hpMax: 40, level: 5, stats: {}, weapon: null });
  const entry = () => [skill("Hard to Kill")];
  assert.deepEqual(skillTotals(entry(), self(40)).stats, {});
  assert.deepEqual(skillTotals(entry(), self(38)).stats, {});
  assert.deepEqual(skillTotals(entry(), self(31)).stats, { def: 3, res: 3 });
  assert.deepEqual(skillTotals(entry(), self(19)).stats, { def: 7, res: 7 });

  assert.deepEqual(skillStanding(entry(), self(20)).shelters, [], "at half its HP it shelters nobody yet");
  const [shelter] = skillStanding(entry(), self(19)).shelters;
  assert.equal(shelter.skill, "Hard to Kill");
  assert.equal(shelter.within, 2);
  assert.equal(shelter.from, 2);
});

test("a unit that shelters its allies bars the tiles near it, for the allies near it", () => {
  const guard = { tile: { i: 5, j: 5 }, name: "Yokai", shelters: [shelterOf({ who: "ally", within: 2, from: 2 }, { skill: "Hard to Kill" })] };
  const ally = { i: 5, j: 6 };

  // From 2 tiles of the guard no ally within 2 tiles of it is attacked; from further away it is
  assert.deepEqual(shelteredFrom([guard], ally, { i: 5, j: 7 }), { name: "Yokai", skill: "Hard to Kill" });
  assert.deepEqual(shelteredFrom([guard], ally, { i: 4, j: 6 }), { name: "Yokai", skill: "Hard to Kill" }, "a diagonal neighbour is 2 tiles away");
  assert.equal(shelteredFrom([guard], ally, { i: 5, j: 8 }), null, "an archer 3 tiles from the guard");

  // An ally further from the guard is not sheltered, whoever attacks it
  assert.equal(shelteredFrom([guard], { i: 5, j: 8 }, { i: 5, j: 7 }), null);
  assert.equal(shelteredFrom([], ally, { i: 5, j: 7 }), null);

  assert.equal(shelterOf(null), null);
  assert.deepEqual(checkShelters({ who: "ally", within: 2, from: 2 }), []);
  assert.ok(checkShelters({ who: "enemy", within: 2 }).length > 0);
  assert.ok(checkShelters({ who: "ally", within: 0 }).length > 0);
  assert.ok(checkShelters({ who: "ally", within: 2, near: 2 }).length > 0);
  assert.ok(checkEffects([{ proc: { on: "turnStart", sure: true }, shelters: { who: "ally", within: 2 } }]).length > 0, "always there");
});

/* -------------------------------------------- */
/*  Senbonzakura                                */
/* -------------------------------------------- */

test("Senbonzakura: +1 STR, MAG, DEF and RES for each kill, up to +9, and 1 less for each hit that deals damage", () => {
  const hitokiri = (options = {}) => A({ skills: [skill("Senbonzakura")], ...options });
  const killed = play(hitokiri(), B({ hp: 5 }), [1]);
  let list = after(hitokiri(), killed.result, "initiator");
  assert.equal(count(list, "Senbonzakura"), 1);
  assert.equal(list[0].ends, "map");
  assert.equal(list[0].max, 9);
  assert.deepEqual(list[0].effects, [{ stats: { str: 1, mag: 1, def: 1, res: 1 } }]);

  // It grows to 9 and no further
  for ( let kills = 0; kills < 12; kills++ ) list = grantChange(list, granted(killed.result, "initiator")[0]).list;
  assert.equal(count(list, "Senbonzakura"), 9);

  // A hit that deals damage takes one from it; a miss takes nothing, and neither does a hit that the +9 DEF
  // leaves no damage of
  const strong = () => B({ stats: { str: 30 } });
  const struck = play(strong(), { ...hitokiri(), timed: list }, [1, 100]);
  assert.ok(by(struck.result, "initiator")[0].damage > 0);
  assert.equal(count(after({ timed: list }, struck.result, "defender"), "Senbonzakura"), 8);
  const dodged = play(strong(), { ...hitokiri(), timed: list }, [100, 100]);
  assert.equal(count(after({ timed: list }, dodged.result, "defender"), "Senbonzakura"), 9);
  const shrugged = play(B(), { ...hitokiri(), timed: list }, [1, 100]);
  assert.equal(by(shrugged.result, "initiator")[0].damage, 0);
  assert.equal(count(after({ timed: list }, shrugged.result, "defender"), "Senbonzakura"), 9);

  // And a unit that carries none loses nothing
  assert.deepEqual(after(hitokiri(), struck.result, "defender"), []);
});

/* -------------------------------------------- */
/*  Demon's Embrace                             */
/* -------------------------------------------- */

test("Demon's Embrace: a fight started at or below 30% HP, or against such a foe, restores the damage dealt", () => {
  const shugoki = (hp) => A({ hp, skills: [skill("Demon's Embrace")] });

  // 12 of 40 HP is 30%
  assert.equal(play(shugoki(20), B({ hp: 12 }), [1, 100]).result.initiator.hp, 29, "the foe");
  assert.equal(play(shugoki(12), B(), [1, 100]).result.initiator.hp, 21, "the unit itself");
  assert.equal(play(shugoki(20), B({ hp: 13 }), [1, 100]).result.initiator.hp, 20, "neither");

  // Only in a fight it starts, and never above its maximum HP
  assert.equal(play(A(), B({ hp: 12, skills: [skill("Demon's Embrace")] }), [100, 1]).result.defender.hp, 12);
  assert.equal(play(shugoki(38), B({ hp: 12 }), [1, 100]).result.initiator.hp, 40);

  // A blow that kills restores what it dealt, no more than the foe had left
  assert.equal(play(shugoki(20), B({ hp: 4 }), [1]).result.initiator.hp, 24);
});

/* -------------------------------------------- */
/*  Healing Items                               */
/* -------------------------------------------- */

test("Fast Recovery: half the HP an item restored again as the next turn starts, and two items heal for both", () => {
  const ashigaru = unit({ name: "Ashigaru", hp: 8, hpMax: 30, skills: [skill("Fast Recovery")] });
  const offers = itemOffers(ashigaru, { own: true });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].may, false, "it takes effect by itself");
  assert.equal(itemRestores(10, offers), 10, "the item heals as it would");
  assert.equal(itemOffers(ashigaru, { own: false }).length, 1, "an item an ally Uses on it counts too");

  const { granted: given, told } = itemMoments(ashigaru, offers, 10);
  assert.deepEqual(told, ["Fast Recovery"]);
  assert.equal(given.length, 1);
  const change = given[0].change;
  assert.equal(change.name, "Fast Recovery");
  assert.equal(change.mend, 5);
  assert.equal(change.ends, "turnStart");
  assert.equal(change.turns, 1);
  assert.deepEqual(mendsOf([change]), [{ name: "Fast Recovery", from: "", amount: 5 }]);

  // An odd amount is rounded down, and an item that restored nothing leaves nothing
  assert.equal(itemMoments(ashigaru, offers, 7).granted[0].change.mend, 3);
  assert.deepEqual(itemMoments(ashigaru, offers, 0).granted, []);
  assert.deepEqual(itemMoments(ashigaru, offers, 1).granted, []);

  // A second item before that turn adds to what the first left
  const again = itemMoments({ ...ashigaru, timed: [change] }, offers, 6);
  assert.equal(again.granted[0].change.mend, 8);
});

test("Belligerent: half the healing of an item the unit Uses on itself for +2 to its stats, if its owner says so", () => {
  const oni = unit({ name: "Oni", hp: 8, hpMax: 30, skills: [skill("Belligerent")] });
  const offers = itemOffers(oni, { own: true });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].may, true, "its owner is asked");
  assert.equal(offers[0].healTimes, 0.5);
  assert.deepEqual(itemOffers(oni, { own: false }), [], "an item an ally Uses on it does not ask");

  // Declined: the item heals as it would, and nothing is left on the unit
  assert.equal(itemRestores(10, []), 10);
  assert.deepEqual(itemMoments(oni, [], 10), { granted: [], told: [] });

  // Accepted: half the healing, rounded down, and +2 to seven stats and CON until its next turn starts
  assert.equal(itemRestores(10, offers), 5);
  assert.equal(itemRestores(15, offers), 7);
  const { granted: given, told } = itemMoments(oni, offers, 5);
  assert.deepEqual(told, ["Belligerent"]);
  assert.deepEqual(given[0].change.effects, [{ stats: { str: 2, mag: 2, def: 2, res: 2, dex: 2, spd: 2, luk: 2, con: 2 } }]);
  assert.equal(given[0].change.ends, "turnStart");
  assert.equal(given[0].change.turns, 1);
  assert.ok(!given[0].change.mend);

  // At full HP the item restores nothing, and the stats are gained all the same
  assert.equal(itemMoments(oni, offers, 0).granted.length, 1);

  // With Fast Recovery beside it: half of what the halved item restored
  const both = unit({ name: "Both", hp: 8, hpMax: 30, skills: [skill("Belligerent"), skill("Fast Recovery")] });
  const taken = itemOffers(both, { own: true });
  assert.equal(itemRestores(20, taken), 10);
  assert.equal(itemMoments(both, taken, 10).granted.find((entry) => entry.skill === "Fast Recovery").change.mend, 5);
});

test("a typing mistake in what follows a healing item does not pass silently", () => {
  assert.equal(ITEM_MOMENT, "itemHeal");
  const wrong = (effect) => checkItemMoment(effect).length > 0;
  const grant = { to: "self", effects: [{ stats: { str: 1 } }], ends: "turnStart" };
  assert.ok(!wrong({ proc: { on: "itemHeal", sure: true }, grant }));
  assert.ok(!wrong({ proc: { on: "itemHeal", may: true, own: true }, healTimes: 0.5, grant }));
  assert.ok(!wrong({ proc: { on: "attack", sure: true }, damage: 1 }), "another moment is not its business");
  assert.ok(wrong({ proc: { on: "itemHeal" }, grant }), "sure, or an answer");
  assert.ok(wrong({ proc: { on: "itemHeal", sure: true, may: true }, grant }));
  assert.ok(wrong({ proc: { on: "itemHeal", stat: "dex", sure: true }, grant }), "it is not rolled for");
  assert.ok(wrong({ proc: { on: "itemHeal", sure: true }, recover: 3 }));
  assert.ok(wrong({ proc: { on: "itemHeal", sure: true } }), "it does something");
  assert.ok(wrong({ proc: { on: "itemHeal", sure: true }, healTimes: -1 }));
  assert.ok(wrong({ proc: { on: "itemHeal", sure: true }, grant: { ...grant, to: "foe" } }));
  assert.ok(wrong({ proc: { on: "turnStart", sure: true }, healTimes: 0.5, recover: 1 }), "only an item is multiplied");
  assert.ok(checkEffects([{ proc: { on: "itemHeal", sure: true }, damage: 2 }]).length > 0);
});

/* -------------------------------------------- */
/*  Haggle                                      */
/* -------------------------------------------- */

const bare = (more = {}) => ({ hp: 20, hpMax: 40, level: 5, stats: { str: 10, luk: 13 }, weapon: null, ...more });

test("Haggle: 10% off in shops and on starting equipment, and 10% more for what the unit sells", () => {
  const knacks = skillKnacks([skill("Haggle")], bare());
  assert.equal(knacks.discount, 10);
  assert.equal(knacks.outfit, 10);
  assert.equal(knacks.resale, 10);
  assert.deepEqual(knacks.discounts, [{ name: "Haggle", percent: 10 }]);
  assert.deepEqual(knacks.outfits, [{ name: "Haggle", percent: 10 }]);
  assert.deepEqual(knacks.resales, [{ name: "Haggle", percent: 10 }]);

  // In a shop it stacks with Bargain; Bargain takes nothing off starting equipment and adds nothing to a sale
  const both = skillKnacks([skill("Haggle"), skill("Bargain")], bare());
  assert.equal(both.discount, 35);
  assert.equal(both.outfit, 10);
  assert.equal(both.resale, 10);
  assert.equal(skillKnacks([skill("Bargain")], bare()).outfit, 0);
  assert.equal(skillKnacks([skill("Bargain")], bare()).resale, 0);

  // Prices are rounded down
  assert.equal(discounted(1000, both.discount), 650);
  assert.equal(discounted(625, knacks.outfit), 562);
  assert.equal(resold(500, knacks.resale), 550);
  assert.equal(resold(455, knacks.resale), 500);
  assert.equal(resold(455, 0), 455);
  assert.equal(resold(0, 10), 0);

  assert.ok(checkEffects([{ resale: 0 }]).length > 0);
  assert.ok(checkEffects([{ outfit: 150 }]).length > 0);
});

/* -------------------------------------------- */
/*  Income                                      */
/* -------------------------------------------- */

const walked = (spaces, canto = 0) => ({ spaces, cost: spaces, mov: 6, left: Math.max(6 - spaces, 0), moved: spaces > 0, full: spaces >= 6, kept: true, passed: [], canto });

test("Income: 5 Gold as a turn starts, and 1 Gold for each space moved as it ends", () => {
  const income = [skill("Income")];
  const start = turnMoment(income, bare(), "turnStart", dice());
  assert.equal(start.entries.length, 1);
  assert.equal(start.entries[0].gold, 5);
  assert.equal(start.entries[0].sure, true, "nothing is rolled");

  // The spaces of a move made after its Action are among those it moved
  assert.equal(turnMoment(income, bare({ move: walked(4, 1) }), "turnEnd", dice()).entries[0].gold, 4);
  assert.equal(turnMoment(income, bare({ move: walked(0) }), "turnEnd", dice()).entries[0].gold, 0);
  assert.equal(turnMoment(income, bare({ move: null }), "turnEnd", dice()).entries[0].gold, 0, "off a battle map nothing is counted");
  assert.equal(turnMoment(income, bare(), "wait", dice()).entries.length, 0);

  assert.ok(checkEffects([{ proc: { on: "attack", sure: true }, gold: 5 }]).length > 0);
  assert.ok(checkEffects([{ proc: { on: "turnStart", sure: true }, aura: { who: "ally", within: 2 }, gold: 5 }]).length > 0);
});

test("the Gold a skill gives as turns pass is counted for the map, and held to what the Game Master allows", () => {
  // No limit
  assert.equal(turnGold(5, 0, 0), 5);
  assert.equal(turnGold(5, 900, 0), 5);

  // At most 15 a map
  assert.equal(turnGold(5, 0, 15), 5);
  assert.equal(turnGold(5, 14, 15), 1);
  assert.equal(turnGold(5, 15, 15), 0);
  assert.equal(turnGold(0, 0, 15), 0);

  // The tally: a change named after the skill that does nothing, grows by what was given, and ends with the map
  let timed = [];
  for ( const amount of [5, 4, 5] ) timed = grantChange(timed, cleanChange(goldTally("Income", amount), checkEffects)).list;
  assert.equal(timed.length, 1);
  assert.equal(timed[0].ends, "map");
  assert.deepEqual(timed[0].effects, []);
  assert.equal(goldGained(timed, "Income"), 14);
  assert.equal(goldGained(timed, "Plunder"), 0);
  assert.equal(goldGained([], "Income"), 0);
  assert.equal(skillCounts(timed).Income.count, 14, "shown on the skill");
  assert.equal(goldTally("Income", 0), null);
});

test("a turn's card tells the Gold a skill gave, and has no row for one that had none to give", () => {
  const i18n = { localize: (key) => key, format: (key, data = {}) => `${key} ${JSON.stringify(data)}` };
  const entry = (more) => ({ skill: "Income", sure: true, roll: null, chance: 100, success: true, recover: 0, healed: 0, remind: false, ...more });
  const rows = (entries) => buildSkillTurnCard({ hpBefore: 20, hp: 20, healed: 0, entries }, i18n, { name: "Profiteer", moment: "turnStart" }).rows;
  assert.deepEqual(rows([entry({ gold: 5, gained: 5 })]).map((row) => row.value), ['FEO.SkillTurn.gold {"amount":5}']);
  assert.deepEqual(rows([entry({ gold: 5, gained: 0 })]).map((row) => row.value), ["FEO.SkillTurn.goldSpent"], "the map allows no more");
  assert.deepEqual(rows([entry({ gold: 0 })]), []);
  assert.deepEqual(rows([entry({})]).map((row) => row.value), ["FEO.SkillTurn.activates"], "any other skill still says that it took effect");
});

/* -------------------------------------------- */
/*  Make A Killing                              */
/* -------------------------------------------- */

test("Make A Killing: +1 Hit, Dodge, Critical and damage for every 500, 1,000, 1,500 and 2,000 Gold", () => {
  const tycoon = (gold) => skillTotals([skill("Make A Killing")], bare({ gold })).combat;
  assert.deepEqual(tycoon(0), {});
  assert.deepEqual(tycoon(499), {});
  assert.deepEqual(tycoon(500), { hit: 1 });
  assert.deepEqual(tycoon(4200), { hit: 8, dodge: 4, critical: 2, damage: 2 });

  // In a fight, by the Gold on the unit's sheet: 6,000 Gold is +12 Hit, +6 Dodge, +4 Critical and +3 damage
  const rich = planExchange(A({ gold: 6000, skills: [skill("Make A Killing")] }), B());
  const poor = planExchange(A({ skills: [skill("Make A Killing")] }), B());
  assert.equal(rich.initiator.hit, poor.initiator.hit + 12);
  assert.equal(rich.initiator.blows[0].damage, poor.initiator.blows[0].damage + 3);
  assert.equal(rich.initiator.crit, poor.initiator.crit + 4);
  assert.equal(rich.defender.hit, poor.defender.hit - 6);
});

/* -------------------------------------------- */
/*  Wealth Of Power                             */
/* -------------------------------------------- */

const wealth = () => skill("Wealth Of Power");
const profiteer = (timed = []) => ({ ...unit({ name: "Profiteer", hp: 20, hpMax: 40, skills: [wealth()] }), timed });
const power = (name) => itemPower(profiteer(), name).change;
const GEMS = ["Green Gem", "Red Gem", "Blue Gem", "Purple Gem", "White Gem", "Pink Gem", "Black Gem", "Rainbow Gem"];

test("Wealth Of Power: each of the eight Gems is used up for a power of its own that lasts for the map", () => {
  const powers = itemPowers(profiteer());
  assert.deepEqual(powers.map((entry) => entry.item), GEMS);
  for ( const entry of powers ) {
    assert.equal(entry.skill, "Wealth Of Power");
    assert.equal(entry.change.name, `Wealth Of Power (${entry.item})`);
    assert.equal(entry.change.ends, "map");
    assert.equal(entry.carried, false);
    assert.ok(cleanChange(entry.change, checkEffects), `${entry.item}: a change that can be saved`);
  }

  // A Gem is known by its name, whatever its case; any other item is Used as it always was
  assert.equal(itemPower(profiteer(), "red gem").item, "Red Gem");
  assert.equal(itemPower(profiteer(), "Vulnerary"), null);
  assert.equal(itemPower(profiteer(), "Laguz Gem"), null);
  assert.equal(itemPower({ ...unit({ skills: [] }), timed: [] }, "Red Gem"), null, "not without the skill");

  // None adds up with itself; each stands beside the others
  const carrying = profiteer([power("Red Gem")]);
  assert.equal(itemPower(carrying, "Red Gem").carried, true);
  assert.equal(itemPower(carrying, "Blue Gem").carried, false);
  const all = GEMS.reduce((list, name) => grantChange(list, power(name)).list, []);
  assert.equal(all.length, 8);
  assert.deepEqual(carriedNames(all), GEMS.map((name) => `Wealth Of Power (${name})`));

  // What each gives, as the skill's own Effect words it
  const effect = "Unit can use Gems as an action.\n\nGreen Gem: +5 HP healed per turn.\nRed Gem: +6 STR and +10 Critical\nBlue Gem: +20 Dodge";
  assert.equal(itemLine(effect, "Red Gem"), "+6 STR and +10 Critical");
  assert.equal(itemLine(effect, "green gem"), "+5 HP healed per turn.");
  assert.equal(itemLine(effect, "Pink Gem"), "");
});

test("Wealth Of Power: what the Green, Red, Blue, Pink, Black and Rainbow Gems give", () => {
  const holding = (names, options = {}) => ({ ...A({ skills: [wealth()], ...options }), timed: names.map(power) });
  const plain = planExchange(A({ skills: [wealth()] }), B());
  const numbers = (plan) => ({ hit: plan.initiator.hit, crit: plan.initiator.crit, damage: plan.initiator.blows[0].damage, foeHit: plan.defender.hit });
  assert.deepEqual(numbers(plain), { hit: 86, crit: 0, damage: 9, foeHit: 86 });

  // Green: 5 HP as each of its turns starts, for as long as the map lasts
  assert.deepEqual(mendsOf([power("Green Gem")]), [{ name: "Wealth Of Power (Green Gem)", from: "", amount: 5 }]);

  // Red: +6 STR and +10 Critical. Blue: +20 Dodge
  assert.deepEqual(numbers(planExchange(holding(["Red Gem"]), B())), { hit: 86, crit: 10, damage: 15, foeHit: 86 });
  assert.deepEqual(numbers(planExchange(holding(["Blue Gem"]), B())), { hit: 86, crit: 0, damage: 9, foeHit: 66 });

  // Pink: +5 LUK, and a third of its LUK with those 5 to Hit and Dodge: (5 + 5) / 3 is 3, on top of what 5 LUK
  // give by themselves
  const lucky = skillTotals(timedEntries([power("Pink Gem")]), bare({ stats: { luk: 5 } }));
  assert.equal(lucky.stats.luk, 5);
  assert.equal(lucky.combat.hit, 3);
  assert.equal(lucky.combat.dodge, 3);

  // Black: what Wrath and Heroism give at half HP or less, and nothing above it; not twice to a unit with Wrath
  assert.equal(planExchange(holding(["Black Gem"], { hp: 20 }), B()).initiator.crit, 50);
  assert.equal(planExchange(holding(["Black Gem"], { hp: 21 }), B()).initiator.crit, 0);
  const wrathful = { ...A({ hp: 20, skills: [wealth(), skill("Wrath")] }), timed: [power("Black Gem")] };
  assert.equal(planExchange(wrathful, B()).initiator.crit, 50);
  assert.equal(skillTotals(timedEntries([power("Black Gem")]), bare({ hp: 20 })).combat.activation, 30);

  // Rainbow: double damage, and +15 Hit, Dodge and Critical
  assert.deepEqual(numbers(planExchange(holding(["Rainbow Gem"]), B())), { hit: 100, crit: 15, damage: 18, foeHit: 71 });

  // Side by side they add up
  assert.deepEqual(numbers(planExchange(holding(["Red Gem", "Blue Gem", "Rainbow Gem"]), B())), { hit: 100, crit: 25, damage: 30, foeHit: 51 });
});

test("Wealth Of Power: the Purple Gem Poisons with every hit, and every enemy next to the unit as its turn starts", () => {
  const holding = (names) => ({ ...A({ skills: [wealth()] }), timed: names.map(power) });
  const hit = play(holding(["Purple Gem"]), B(), [1, 100]);
  assert.deepEqual(hit.result.attacks[0].conditions.inflicted.map((given) => given.id), ["poison"]);
  assert.deepEqual(play(holding(["Purple Gem"]), B(), [100, 100]).result.attacks[0].conditions?.inflicted ?? [], [], "a miss Poisons nobody");
  assert.deepEqual(play(holding([]), B(), [1, 100]).result.attacks[0].conditions.inflicted, [], "not without the Gem");
  assert.deepEqual(play(holding(["Red Gem"]), B(), [1, 100]).result.attacks[0].conditions.inflicted, [], "nor with another");

  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const placed = (id, side, j) => ({ id, name: id, side, tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills: [] });
  const near = surroundings([placed("profiteer", "player", 0), placed("foe", "enemy", 1), placed("friend", "player", -1), placed("far", "enemy", 3)], "profiteer", measure);
  const carried = carriedNames([power("Purple Gem")]);
  const turn = turnMoment([wealth()], bare({ near, carried }), "turnStart", dice());
  assert.equal(turn.entries.length, 1);
  assert.deepEqual(turn.entries[0].spread.units.map((share) => share.id), ["foe"]);
  assert.deepEqual(turn.entries[0].spread.units[0].inflicts.map((given) => given.id), ["poison"]);
  assert.deepEqual(turnMoment([wealth()], bare({ near, carried: [] }), "turnStart", dice()).entries, []);
});

test("Wealth Of Power: the White Gem gives the allies within 3 spaces what Charm and Solidarity give", () => {
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const placed = (id, side, j, skills = []) => ({ id, name: id, side, tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills });
  const white = timedEntries([power("White Gem")]);
  const given = (skills, to = placed("ally", "player", 3)) => standing([placed("profiteer", "player", 0, skills), to], to.id, measure).auras;

  const auras = given([wealth(), ...white]);
  assert.equal(auras.length, 1);
  assert.deepEqual(auras[0].effects, [{ combat: { hit: 10, dodge: 10 } }, { combat: { critical: 10, critAvoid: 10 } }]);

  // Not without the Gem, not for a unit further away, and not for an enemy
  assert.deepEqual(given([wealth()]), []);
  assert.deepEqual(given([wealth(), ...white], placed("ally", "player", 4)), []);
  assert.deepEqual(given([wealth(), ...white], placed("foe", "enemy", 2)), []);

  // A unit that has Charm of its own is not given it twice
  const charming = given([wealth(), skill("Charm"), ...white]);
  assert.deepEqual(charming.flatMap((aura) => aura.effects), [{ combat: { critical: 10, critAvoid: 10 } }, { combat: { hit: 10, dodge: 10 } }]);
});

test("a typing mistake in an item a skill uses up does not pass silently", () => {
  const grant = { to: "self", name: "Power (Stone)", effects: [{ stats: { str: 1 } }], ends: "map" };
  const wrong = (effect) => checkConsumes(effect, checkEffects).length > 0;
  assert.ok(!wrong({ consumes: { item: "Stone", grant } }));
  assert.ok(!wrong({ consumes: { item: "Stone", grant: { ...grant, effects: [], mend: 5 } } }));
  assert.ok(!wrong({ stats: { str: 1 } }), "an effect without one is not its business");
  assert.ok(wrong({ consumes: { grant } }), "it names the item");
  assert.ok(wrong({ consumes: { item: "Stone" } }), "and the change");
  assert.ok(wrong({ consumes: { item: "Stone", grant: { ...grant, to: "foe" } } }));
  assert.ok(wrong({ consumes: { item: "Stone", grant: { ...grant, name: "" } } }), "a name of its own");
  assert.ok(wrong({ consumes: { item: "Stone", grant: { ...grant, ends: "soon" } } }));
  assert.ok(wrong({ consumes: { item: "Stone", grant: { ...grant, effects: [{ stats: { strength: 1 } }] } } }));
  assert.ok(wrong({ consumes: { item: "Stone", grant: { ...grant, effects: [{ proc: { on: "hit", sure: true }, inflicts: ["poison"] }] } } }), "a moment is written on the skill");
  assert.ok(wrong({ consumes: { item: "Stone", grant }, stats: { str: 1 } }), "it stands alone");
  assert.ok(wrong({ proc: { on: "turnStart", sure: true }, consumes: { item: "Stone", grant } }));
  assert.ok(checkEffects([{ when: { carries: "" }, stats: { str: 1 } }]).length > 0);
  assert.deepEqual(checkEffects([{ when: { carries: "Power (Stone)" }, stats: { str: 1 } }]), []);
});

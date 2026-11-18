/**
 * Tests for stealing, loot and what skills make of gear (`module/rules/stealing.mjs`): the Steal command, the
 * knacks a unit's skills and gear add up to, what a skill takes from a foe at a moment of a fight the system
 * rolls (`module/rules/combat.mjs`) or as it defeats one by other means (`module/rules/events.mjs`), a foe made
 * to put down what it holds, a discount in a shop, the items made as a map starts, and a weapon's Effect
 * amplified.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { barredFromCapture } from "../module/rules/capturing.mjs";
import { planExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { builtInSkills, killDice, killMoments } from "../module/rules/events.mjs";
import { checkEffects, coverageOf, skillKnacks, skillTotals } from "../module/rules/skills.mjs";
import {
  UNCAPTURED, UNSTOLEN, addKnacks, amplified, bestPick, canSteal, checkKnacks, checkLoot, craftable, craftsAlone, disarmerOf, discounted,
  emptyKnacks, gearKnacks, goldFrom, keyOpens, lootOf, pickings, stealable
} from "../module/rules/stealing.mjs";
import { dice, fighter, made, skill, unit } from "./lib/fixtures.mjs";

const at = (i, j) => ({ i, j });

/** Roll out a fight with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  let rolled = 0;
  const result = resolveExchange(plan, () => {
    rolled += 1;
    return rolls[rolled - 1] ?? rest;
  });
  assert.ok(rolled <= rollBudget(plan), `rolled ${rolled} of ${rollBudget(plan)}`);
  return { plan, result, rolled };
}

/** A foe that never answers, so that a fight is the attacks of the unit that starts it. */
const quiet = (options = {}) => fighter({ name: "B", hp: 60, hpMax: 60, weapon: null, ...options });

/** What a unit with these skills may do with gear and with the things on a map. */
const knacksOf = (names, self = {}) => skillKnacks(names.map((name) => skill(name)), self);

/** The rules a unit with these skills carries. */
const rulesOf = (names) => skillTotals(names.map((name) => skill(name)), fighter({ name: "W" })).rules;

/** A pack: a sword in hand, a spare axe, a heavy lance, a Shield on the arm, a ring that is worn and a salve. */
const PACK = [
  { id: "sword", name: "Iron Sword", type: "weapon", weight: 5, equipped: true, cost: 460 },
  { id: "axe", name: "Hand Axe", type: "weapon", weight: 7, cost: 300 },
  { id: "lance", name: "Steel Lance", type: "weapon", weight: 13, cost: 480 },
  { id: "shield", name: "Round Shield", type: "gear", equipped: true, cost: 1000 },
  { id: "ring", name: "Bargain Ring", type: "gear", worn: true, cost: 10000 },
  { id: "salve", name: "Vulnerary", type: "gear", cost: 300 }
];
const thief = (more = {}) => ({ steals: true, spd: 14, str: 9, tile: at(3, 3), ...more });
const mark = (more = {}) => ({ spd: 8, tile: at(3, 4), relation: "foe", rules: [], out: false, items: PACK, ...more });

const STEP = ["Steal", "Thievery", "Fast Fingers", "Honor Among Thieves", "Watchful", "Disarm", "Despoil", "Mug", "Robbery", "Bargain",
  "Tools of the Trade", "Amplify", "Pillage"];

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of STEP ) assert.deepEqual(checkEffects(skill(name).effects), [], name);
  assert.equal(coverageOf({ effect: "x", listed: true, left: "" }), "done");
});

test("what a part may say is checked", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  assert.equal(wrong({ steal: { use: true } }), false);
  assert.equal(wrong({ steal: true }), true);
  assert.equal(wrong({ opens: ["door", "window"] }), true);
  assert.equal(wrong({ discount: 0 }), true);
  assert.equal(wrong({ crafts: { items: 2 } }), true);
  assert.equal(wrong({ proc: { on: "hit", sure: true }, steal: { use: true } }), true, "a knack is always there");
  assert.equal(wrong({ loot: { gold: "foe" } }), true, "loot is taken at a moment");
  assert.equal(wrong({ proc: { on: "start", sure: true }, loot: { gold: "foe" } }), true, "on a hit or a kill");
  assert.equal(wrong({ proc: { on: "kill", sure: true }, loot: { dice: 3, of: [{ item: "Bullion" }] } }), true, "a face for each side of the die");
  assert.equal(wrong({ proc: { on: "kill", sure: true }, loot: { item: "Bullion", gold: 5 } }), true);
  assert.equal(wrong({ proc: { on: "hit", sure: true }, unequips: true }), true, "the foe puts down its weapon on an attack that lands");
  assert.equal(wrong({ proc: { on: "attack", sure: true }, unequips: true }), false);
  assert.equal(wrong({ proc: { on: "attack", sure: true }, amplify: 0 }), true);
  assert.deepEqual(checkKnacks({ pillages: true, disarms: true }), []);
  assert.deepEqual(checkLoot({ steal: true }, "hit"), []);
});

/* -------------------------------------------- */
/*  Steal                                       */
/* -------------------------------------------- */

test("Steal: a unit with the command takes what an enemy next to it does not have in hand", () => {
  const tried = canSteal(thief(), mark());
  assert.equal(tried.ok, true);
  const why = Object.fromEntries(tried.items.map((item) => [item.id, item.why]));
  assert.deepEqual(why, { sword: "equipped", axe: null, lance: "heavy", shield: "equipped", ring: "worn", salve: null });

  // A weapon no heavier than the unit's STR can be taken; an item has no Weight to speak of
  assert.equal(stealable({ type: "weapon", weight: 9 }, { str: 9 }).ok, true);
  assert.equal(stealable({ type: "weapon", weight: 10 }, { str: 9 }).why, "heavy");
  assert.equal(stealable({ type: "gear", weight: 99 }, { str: 1 }).ok, true);
  assert.equal(stealable({ type: "weapon", weight: 1, bound: true }, { str: 9 }).why, "bound");
});

test("Steal: whom a unit may not steal from, and why", () => {
  assert.equal(canSteal(thief({ steals: false }), mark()).why, "cannot");
  assert.equal(canSteal(thief(), mark({ tile: at(3, 5) })).why, "apart");
  assert.equal(canSteal(thief(), mark({ tile: at(4, 4) })).why, "apart", "not across a corner");
  assert.equal(canSteal(thief(), mark({ relation: "friend" })).why, "side");
  assert.equal(canSteal(thief(), mark({ out: true })).why, "out");

  // Its SPD must be higher, not equal
  assert.equal(canSteal(thief({ spd: 8 }), mark()).why, "speed");
  assert.equal(canSteal(thief({ spd: 9 }), mark()).ok, true);
  assert.equal(canSteal(thief(), mark({ items: [] })).why, "empty");
  assert.equal(canSteal(thief(), mark({ items: PACK.filter((item) => item.equipped) })).why, "nothing");
});

test("Thievery gives the Steal command, opens doors and chests and disarms traps", () => {
  const knacks = knacksOf(["Thievery"]);
  assert.equal(knacks.steals, true);
  assert.deepEqual(knacks.opens, ["door", "chest"]);
  assert.equal(knacks.disarms, true);
  assert.equal(knacks.skills.steals, "Thievery");
  assert.equal(knacksOf([]).steals, false);

  // A trap it walks onto is disarmed by that skill; another unit springs it
  assert.equal(disarmerOf(knacks), "Thievery");
  assert.equal(disarmerOf(knacksOf([])), null);
  assert.equal(disarmerOf(null), null);
});

test("a Thief Glove gives the Steal command, and a Bargain Ring a discount, to whoever wears it", () => {
  assert.deepEqual(gearKnacks("Unit can use the Steal action."), { steal: { use: true } });
  assert.deepEqual(gearKnacks("Unit receives a 25% discount in Shops. Stacks with the Bargain skill."), { discount: 25 });
  assert.equal(gearKnacks("Increases SPD growth by 10%."), null);
  const knacks = addKnacks(emptyKnacks(), gearKnacks("Unit can use the Steal action."), { skill: "Thief Glove" });
  assert.deepEqual([knacks.steals, knacks.skills.steals], [true, "Thief Glove"]);

  // And a key says what it opens
  assert.deepEqual(keyOpens("Opens a chest."), ["chest"]);
  assert.deepEqual(keyOpens("Opens a door."), ["door"]);
  assert.deepEqual(keyOpens("Opens a chest or door."), ["door", "chest"]);
  assert.deepEqual(keyOpens("Restores 10 HP."), []);
});

/* -------------------------------------------- */
/*  Units Nothing Is Taken From                 */
/* -------------------------------------------- */

test("Watchful and Honor Among Thieves: nothing is stolen from the unit, by Steal or in a fight", () => {
  assert.equal(rulesOf(["Honor Among Thieves"]).has(UNSTOLEN), true);
  assert.equal(rulesOf(["Honor Among Thieves"]).has(UNCAPTURED), false);
  assert.deepEqual([...rulesOf(["Watchful"])].sort(), [UNCAPTURED, UNSTOLEN].sort());
  assert.equal(canSteal(thief(), mark({ rules: [...rulesOf(["Watchful"])] })).why, "guarded");
  assert.equal(canSteal(thief(), mark({ rules: [...rulesOf(["Honor Among Thieves"])] })).why, "guarded");
  assert.deepEqual(pickings({ str: 9 }, { rules: [UNSTOLEN], items: PACK }), []);
});

test("Watchful: the unit is never captured", () => {
  const target = { weight: 5, qualities: "", conditions: { sleep: 2 }, weapons: [] };
  assert.equal(barredFromCapture(target), null);
  assert.deepEqual(barredFromCapture({ ...target, rules: [...rulesOf(["Watchful"])] }), { why: "watchful" });
  assert.equal(barredFromCapture({ ...target, rules: [...rulesOf(["Honor Among Thieves"])] }), null);
});

test("Honor Among Thieves still counts the Bandits on its side", () => {
  const others = [
    { id: "b", relation: "ally", distance: 3, qualities: "Bandit" }, { id: "c", relation: "ally", distance: 9, qualities: "Bandit, Mounted" },
    { id: "d", relation: "ally", distance: 1, qualities: "" }, { id: "e", relation: "enemy", distance: 1, qualities: "Bandit" }
  ];
  const totals = skillTotals([skill("Honor Among Thieves")], { ...fighter({ name: "H" }), near: { id: "a", side: "enemy", tile: null, others } });
  assert.equal(totals.combat.damage, 4);
});

/* -------------------------------------------- */
/*  Taking in a Fight                           */
/* -------------------------------------------- */

test("Fast Fingers: a melee attack that lands leaves one item of the foe's pack to be picked afterwards", () => {
  const fingers = () => fighter({ name: "A", skills: [skill("Fast Fingers")], stats: { spd: 20 } });
  const { result } = fight(fingers(), quiet(), [], { rest: 1 });
  assert.equal(result.attacks.filter((attack) => attack.lands !== false).length, 2, "it follows up");
  assert.deepEqual(result.loot, [{ skill: "Fast Fingers", id: "fast-fingers", by: "initiator", on: "hit", loot: { steal: true } }]);

  // Its use is counted only once an item is taken, which the map sees to
  assert.equal((result.initiator.skills ?? []).some((entry) => entry.name === "Fast Fingers"), false);

  // An attack that misses takes nothing, and neither does one from two spaces away
  assert.equal(fight(fingers(), quiet(), [], { rest: 100 }).result.loot, undefined);
  const ranged = fighter({ name: "A", skills: [skill("Fast Fingers")], weapon: { range: "1-2" } });
  assert.equal(fight(ranged, quiet(), [], { rest: 1, distance: 2 }).result.loot, undefined);

  // While it is on cooldown it does nothing
  const cooling = fighter({ name: "A", skills: [skill("Fast Fingers", { cooldown: 3 })] });
  assert.equal(fight(cooling, quiet(), [], { rest: 1 }).result.loot, undefined);

  // And it takes effect for the unit that is attacked as well
  const answered = fight(fighter({ name: "A", weapon: null }), fighter({ name: "B", skills: [skill("Fast Fingers")] }), [], { rest: 1 });
  assert.equal(answered.result.loot, undefined, "an unarmed foe is not answered at all");
  const struck = fight(fighter({ name: "A", hp: 60, hpMax: 60 }), fighter({ name: "B", hp: 60, hpMax: 60, skills: [skill("Fast Fingers")] }), [], { rest: 1 });
  assert.equal(struck.result.loot[0].by, "defender");
});

test("what Fast Fingers may take: what could be stolen, whatever the two units' SPD", () => {
  const open = pickings({ str: 9 }, { rules: [], items: PACK }).filter((item) => item.ok).map((item) => item.id);
  assert.deepEqual(open, ["axe", "salve"]);

  // A unit that answers by itself takes what costs the most
  assert.equal(bestPick(pickings({ str: 9 }, { items: PACK })).id, "axe");
  assert.equal(bestPick(pickings({ str: 20 }, { items: PACK })).id, "lance");
  assert.equal(bestPick([]), null);
});

test("Disarm: once the attack lands the foe puts down its weapon and its Shield, and attacks no more", () => {
  const armed = () => fighter({ name: "B", hp: 60, hpMax: 60 });
  const plain = fight(fighter({ name: "A", hp: 60, hpMax: 60 }), armed(), [], { rest: 1 });
  assert.deepEqual(plain.result.attacks.map((attack) => attack.side), ["initiator", "defender"]);
  assert.equal(plain.result.disarmed, undefined);

  const disarming = fighter({ name: "A", hp: 60, hpMax: 60, skills: [skill("Disarm")] });
  const { result } = fight(disarming, armed(), [], { rest: 1 });
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator"], "the counter-attack is not made");
  assert.deepEqual(result.disarmed, [{ side: "defender", skill: "Disarm", by: "initiator" }]);

  // DEX% is rolled for the attack: a roll above it disarms nobody, and neither does an attack that misses
  const chance = disarming.stats.dex;
  const missed = fight(disarming, armed(), [chance + 1], { rest: 1 });
  assert.equal(missed.result.disarmed, undefined);
  assert.equal(fight(disarming, armed(), [1], { rest: 100 }).result.disarmed, undefined);

  // A foe that holds nothing, or a weapon that is not a Beorc's, is not rolled for
  assert.equal(fight(disarming, quiet(), [], { rest: 1 }).result.disarmed, undefined);
  const laguz = fighter({ name: "B", hp: 60, hpMax: 60, weapon: { category: "laguz", name: "Claw" } });
  assert.equal(fight(disarming, laguz, [], { rest: 1 }).result.disarmed, undefined);
});

/* -------------------------------------------- */
/*  Loot                                        */
/* -------------------------------------------- */

test("Mug: gold from an enemy it hits, once for each enemy", () => {
  const mugger = () => fighter({ name: "A", skills: [skill("Mug")], stats: { spd: 20, dex: 8 } });
  const { result } = fight(mugger(), quiet(), [], { rest: 1 });
  assert.equal(result.attacks.length, 2, "two attacks land");
  assert.deepEqual(result.loot, [{ skill: "Mug", by: "initiator", on: "hit", loot: { gold: "foe", once: "foe" } }], "it takes effect once in a fight");

  // The enemy carries the mark from then on, and is not rolled against again on that map
  const marked = result.granted.find((entry) => (entry.to === "defender") && entry.change.mark);
  assert.deepEqual([marked.change.name, marked.change.ends, marked.change.from], ["Mug", "map", "A"]);
  const again = fight(mugger(), { ...quiet(), timed: [marked.change] }, [], { rest: 1 });
  assert.equal(again.result.loot, undefined);
  assert.equal(again.result.attacks.some((attack) => (attack.procs ?? []).some((proc) => proc.skill === "Mug")), false);

  // Another unit's mark does not keep this one from it
  const others = fight(mugger(), { ...quiet(), timed: [{ ...marked.change, from: "Someone" }] }, [], { rest: 1 });
  assert.equal(others.result.loot.length, 1);

  // DEX% is rolled as the attack connects: the attack lands, and every roll after it is one above DEX
  assert.equal(fight(mugger(), quiet(), [1], { rest: 9 }).result.loot, undefined);
  assert.equal(fight(mugger(), quiet(), [1], { rest: 8 }).result.loot.length, 1);
});

test("stolen gold is what the enemy carries, or what the world gives for one that carries none", () => {
  assert.deepEqual(goldFrom("foe", { gold: 320 }, 50), { amount: 320, carried: true });
  assert.deepEqual(goldFrom("foe", { gold: 0 }, 50), { amount: 50, carried: false });
  assert.deepEqual(goldFrom("foe", {}, 0), { amount: 0, carried: false });
  assert.deepEqual(goldFrom(75, { gold: 320 }, 50), { amount: 75, carried: false });
  assert.equal(goldFrom("foe", { gold: 0 }).amount, FEO.stealing.gold);
});

test("Despoil: LUK% for a Bullion from an enemy it defeats, in a fight and by any other means", () => {
  const despoiler = fighter({ name: "A", skills: [skill("Despoil")], stats: { str: 60, luk: 5 } });
  const { result } = fight(despoiler, quiet({ hp: 5 }), [], { rest: 1 });
  assert.deepEqual(result.loot, [{ skill: "Despoil", by: "initiator", on: "kill", loot: { item: "Bullion" } }]);
  assert.equal(fight(despoiler, quiet({ hp: 5 }), [1], { rest: 6 }).result.loot, undefined, "above LUK%");
  assert.equal(fight(despoiler, quiet({ hp: 5 }), [1], { rest: 5 }).result.loot.length, 1);
  assert.equal(fight(despoiler, quiet({ hp: 900, hpMax: 900 }), [], { rest: 1 }).result.loot, undefined, "a foe that stands gives nothing");

  // Outside of a fight
  const killer = unit({ skills: [skill("Despoil")], stats: { luk: 5 } });
  const foe = unit({ name: "Foe", hp: 0 });
  assert.equal(killDice(killer, foe), 1);
  assert.deepEqual(killMoments(killer, foe, dice(5)).loot, [{ skill: "Despoil", on: "kill", loot: { item: "Bullion" } }]);
  assert.deepEqual(killMoments(killer, foe, dice(6)).loot, []);
  assert.equal(FEO.stealing.bullion, "Bullion");
});

test("Robbery: a D3 gives one of the enemy's items, gold, or a Bullion", () => {
  const robber = unit({ skills: [skill("Robbery")], stats: { luk: 10 } });
  const [taken] = killMoments(robber, unit({ name: "Foe", hp: 0 }), dice(10)).loot;
  assert.equal(taken.skill, "Robbery");
  assert.deepEqual(lootOf(taken.loot, () => 1), { gives: { item: "foe" }, roll: 1, faces: 3 });
  assert.deepEqual(lootOf(taken.loot, () => 2), { gives: { gold: "foe" }, roll: 2, faces: 3 });
  assert.deepEqual(lootOf(taken.loot, () => 3), { gives: { item: "Bullion" }, roll: 3, faces: 3 });
  assert.deepEqual(killMoments(robber, unit({ name: "Foe", hp: 0 }), dice(11)).loot, []);

  // What is not rolled for gives what it says
  assert.deepEqual(lootOf({ item: "Bullion" }), { gives: { item: "Bullion" }, roll: null, faces: 0 });
  assert.deepEqual(lootOf({ gold: "foe", once: "foe" }).gives, { gold: "foe" });

  // The Game Master picks among everything the enemy carries that can change hands, in hand or not
  const all = pickings({ str: Infinity }, { items: PACK }).map((item) => item.id);
  assert.equal(all.length, PACK.length);
});

/* -------------------------------------------- */
/*  Shops                                       */
/* -------------------------------------------- */

test("Bargain: a quarter off in shops, which stacks with the Bargain Ring", () => {
  const knacks = knacksOf(["Bargain"]);
  assert.equal(knacks.discount, 25);
  assert.equal(discounted(1000, knacks.discount), 750);
  addKnacks(knacks, gearKnacks("Unit receives a 25% discount in Shops. Stacks with the Bargain skill."), { skill: "Bargain Ring" });
  assert.equal(knacks.discount, 50);
  assert.deepEqual(knacks.discounts, [{ name: "Bargain", percent: 25 }, { name: "Bargain Ring", percent: 25 }]);
  assert.equal(discounted(1000, knacks.discount), 500);

  // A price is rounded down, and is never less than nothing
  assert.equal(discounted(515, 25), 386);
  assert.equal(discounted(1, 25), 0);
  assert.equal(discounted(1000, 0), 1000);
  assert.equal(discounted(1000, 250), 0);
  assert.equal(knacksOf([]).discount, 0);
});

/* -------------------------------------------- */
/*  Items Made as a Map Starts                  */
/* -------------------------------------------- */

const WARES = [
  { id: "a", name: "Incense", cost: 450, folder: "Buffing Items" },
  { id: "b", name: "Coffee", cost: 585, folder: "Buffing Items" },
  { id: "c", name: "Nails", cost: 650, folder: "Combat Items" },
  { id: "d", name: "Grenade", cost: 1400, folder: "Combat Items" },
  { id: "e", name: "Vulnerary", cost: 300, folder: "Healing" },
  { id: "f", name: "Free Sample", cost: 0, folder: "Combat Items" }
];

test("Tools of the Trade: up to 2 Buffing or Combat items of 1000 together, 3 of 1500 at Tier 3, with DEX/10 uses", () => {
  const second = knacksOf(["Tools of the Trade"], { tier: 2, stats: { dex: 27 } }).crafts;
  assert.deepEqual([second.items, second.cost, second.uses, second.skill], [2, 1000, 2, "Tools of the Trade"]);
  assert.deepEqual(second.folders, ["Buffing Items", "Combat Items"]);
  const third = knacksOf(["Tools of the Trade"], { tier: 3, stats: { dex: 34 } }).crafts;
  assert.deepEqual([third.items, third.cost, third.uses], [3, 1500, 3]);
  assert.equal(knacksOf(["Tools of the Trade"], { tier: 1, stats: { dex: 9 } }).crafts.uses, 0, "the map gives it 1 use at least");
  assert.equal(knacksOf([]).crafts, null);

  // What may be made: of those sections, for no more than is left
  const first = craftable(second, WARES);
  assert.deepEqual(first.open.map((ware) => ware.name), ["Incense", "Coffee", "Nails"]);
  assert.deepEqual([first.left, first.room], [1000, 2]);
  const next = craftable(second, WARES, [WARES[2]]);
  assert.deepEqual([next.open.map((ware) => ware.name), next.left, next.room], [[], 350, 1]);
  assert.deepEqual(craftable(second, WARES, [WARES[0]]).open.map((ware) => ware.name), ["Incense"], "the same item may be made twice");
  assert.equal(craftable(second, WARES, [WARES[0], WARES[0]]).room, 0);
  assert.deepEqual(craftable(third, WARES).open.map((ware) => ware.name), ["Incense", "Coffee", "Nails", "Grenade"]);

  // A unit no player owns makes the costliest that fit
  assert.deepEqual(craftsAlone(second, WARES).map((ware) => ware.name), ["Nails"]);
  assert.deepEqual(craftsAlone(third, WARES).map((ware) => ware.name), ["Grenade"]);
  assert.deepEqual(craftsAlone({ ...second, cost: 600 }, WARES).map((ware) => ware.name), ["Coffee"]);
  assert.deepEqual(craftsAlone({ ...third, cost: 1500 }, WARES.slice(0, 3)).map((ware) => ware.name), ["Nails", "Nails"]);
});

/* -------------------------------------------- */
/*  A Weapon's Effect, Amplified                */
/* -------------------------------------------- */

test("Amplify: on a magical attack the weapon's Might counts twice and what its Effect inflicts is half again", () => {
  const tome = { category: "fire", damageStat: "mag", name: "Elfire", range: "1-2", effect: "Beast, 33% to Burn." };
  const mage = (skills) => fighter({ name: "A", skills, weapon: tome, stats: { dex: 20 } });
  const plain = fight(mage([]), quiet(), [], { rest: 1 }).result.attacks[0];
  const { result } = fight(mage([skill("Amplify")]), quiet(), [], { rest: 1 });
  const amplified1 = result.attacks[0];
  assert.equal(amplified1.procs.some((proc) => (proc.skill === "Amplify") && proc.success), true);

  // Might 5 counts twice; a critical hit triples what is dealt, so the 5 more are 15
  assert.equal(amplified1.damage - plain.damage, amplified1.crit ? 15 : 5);
  assert.deepEqual([plain.conditions.inflicted[0].chance, plain.conditions.inflicted[0].turns], [33, 1]);
  assert.deepEqual([amplified1.conditions.inflicted[0].chance, amplified1.conditions.inflicted[0].turns], [49, 2]);

  // DEX/2% is rolled for each attack; one it does not come for is as the weapon is
  const failed = fight(mage([skill("Amplify")]), quiet(), [11], { rest: 1 }).result.attacks[0];
  assert.equal(failed.conditions.inflicted[0].chance, 33);

  // A physical attack is not rolled for
  const sword = fight(fighter({ name: "A", skills: [skill("Amplify")], stats: { dex: 20 } }), quiet(), [], { rest: 1 }).result.attacks[0];
  assert.equal((sword.procs ?? []).some((proc) => proc.skill === "Amplify"), false);

  // The numbers themselves
  assert.equal(amplified(33, 50, { most: 100 }), 49);
  assert.equal(amplified(80, 50, { most: 100 }), 100);
  assert.equal(amplified(10, 0), 10);
});

test("an Effect a skill amplifies on any attack works the same for one made up for the test", () => {
  const amp = made("Loud", [{ proc: { on: "attack", sure: true }, amplify: 100 }]);
  const tome = { category: "ice", damageStat: "mag", name: "Shiver", range: "1-2", effect: "Mounted, 20% Frostbite." };
  const hit = fight(fighter({ name: "A", skills: [amp], weapon: tome }), quiet(), [], { rest: 1 }).result.attacks[0];
  assert.deepEqual([hit.conditions.inflicted[0].id, hit.conditions.inflicted[0].chance, hit.conditions.inflicted[0].turns], ["frostbite", 40, 6]);
});

/* -------------------------------------------- */
/*  Villages                                    */
/* -------------------------------------------- */

test("Pillage: a Bandit is given it by itself, and it has its unit destroy Villages", () => {
  assert.equal(knacksOf(["Pillage"]).pillages, true);
  assert.equal(knacksOf(["Pillage"]).skills.pillages, "Pillage");
  assert.equal(knacksOf(["Thievery"]).pillages, false);
  assert.deepEqual(builtInSkills("Bandit"), ["Greed", "Pillage"]);
  assert.deepEqual([].concat(FEO.qualitySkills.Bandit), ["Greed", "Pillage"]);
});

/**
 * Tests for action skills with one target (see `module/rules/actions.mjs`): a buff or a debuff with a stat
 * that is picked, for one unit or all in reach; healing and damage with what it leaves behind; one attack with
 * numbers of its own; what an ally is given to carry; and a mark on one unit of the map.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actAmount, actForAll, actGrant, actModes, actOf, actReaches, activationSkills, armedWith, checkAct, learntStats, lentEffects, pickBy,
  provokers, strikeWeapon, tollOf, withoutMoments
} from "../module/rules/actions.mjs";
import { surroundings } from "../module/rules/positions.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { checkEffects, coverageOf, readNumber, skillTotals, useMoment } from "../module/rules/skills.mjs";
import { checkUsage } from "../module/rules/skill-usage.mjs";
import { buildChange, chosenEffects, cleanChange, grantChange, spendOnce, tickChanges, timedEntries, tollsOf } from "../module/rules/timed.mjs";
import { changeParts, changeTone } from "../module/helpers/timed-context.mjs";
import { readFileSync } from "node:fs";
import { dice, fighter, made, skill } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(new URL("../packs-src/skills/effects.json", import.meta.url), "utf8")).skills;

/** The skill as an Item's data has it. */
const data = (name) => {
  const entry = skill(name);
  return { effects: listed[name].effects, usage: entry.usage, automate: true };
};
const act = (name, meets = null) => actOf(data(name), meets);

const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });
const context = { skill: "Skill", from: "A", giver: "Actor.A", giverInTurn: true };

/** A unit that carries a change another left on it. */
const carrying = (unit, ...changes) => ({ ...unit, timed: changes.reduce((list, change) => grantChange(list, change).list, unit.timed ?? []) });

const STEP = ["Cheer", "Jeer", "Rally", "Sabotage", "Salve", "Hemorrhage", "Pebble", "Haymaker", "Confiteor", "Harsh Command", "Enlighten", "Art of War",
  "Provoke", "Blast", "Mark", "Bounty Hunter", "Headhunter", "Loyalty", "Forward Observation", "Blood Tide", "Influence"];

/* -------------------------------------------- */
/*  The Parts                                   */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know, and leave nothing to the table", () => {
  for ( const name of STEP ) {
    const entry = listed[name];
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.deepEqual(checkUsage(entry.usage), [], name);
    assert.equal(entry.left, undefined, name);
    assert.equal(coverageOf({ effect: "x", listed: true, left: entry.left ?? "" }), "done", name);
  }
  assert.equal(listed.Spellshield.left, undefined, "Spellshield was finished with the weapons a unit does not carry");
});

test("a typing mistake in what an action skill does does not pass silently", () => {
  const ally = { who: "ally", within: 1 };
  assert.deepEqual(checkAct({ target: { ...ally, self: true }, heal: 5 }), []);
  assert.deepEqual(checkAct({ target: { who: "enemy", within: "map" }, grant: { mark: true, effects: [], ends: "map" } }), []);
  assert.equal(checkAct({ target: { ...ally, self: "yes" }, heal: 5 }).length, 1);
  assert.equal(checkAct({ target: ally, heal: "some" }).length, 1);
  assert.equal(checkAct({ target: ally, grant: { choose: { stats: ["strength"], amount: 4 }, ends: "turnEnd" } }).length, 1);
  assert.equal(checkAct({ target: ally, grant: { choose: { stats: "learnt" }, ends: "turnEnd" } }).length, 1, "it needs an amount");
  assert.equal(checkAct({ target: ally, asks: "target", grant: { effects: [{ stats: { str: 1 } }] } }).length, 1, "nothing to ask about");
  assert.equal(checkAct({ target: ally, grant: { effects: [], toll: { rest: 1 } } }).length, 1);
  assert.equal(checkAct({ target: { who: "ally", within: "map" }, grant: { effects: [{ stats: { str: 1 } }] }, all: { grant: { effects: [{ stats: { str: 1 } }] } } }).length, 1,
    "all in reach needs a reach in tiles");
  assert.equal(checkAct({ target: { who: "enemy", within: 3 }, strike: { hit: 50 } }).length, 1, "numbers of its own are a Might and a Hit");
  assert.equal(checkAct({ target: { who: "enemy", within: 1 }, strike: { might: 0, hit: 50, weapon: ["brawl"] } }).length, 1, "its own numbers or a weapon");
  assert.equal(checkAct({ target: { who: "ally", within: 1 }, strike: { might: 0, hit: 50 } }).length, 1, "an attack is made on an enemy");
  assert.equal(checkAct({ target: { who: "enemy", within: "map" }, grant: { effects: [{ stats: { str: 1 } }] }, watch: { stays: { max: 10, effects: [{ combat: { hit: -5 } }] } } }).length, 1,
    "a watch remembers whom it comes from");
  assert.equal(checkAct({ target: ally, grant: { lends: [{ pick: "anyone", effects: [{ combat: { hit: 1 } }] }] } }).length, 1);
  assert.ok(checkEffects([{ when: { hp: { op: "full" } }, act: { target: ally, heal: 5 } }]).length > 0, "beside it only a skill or a tier is asked for");
  assert.deepEqual(checkEffects([{ when: { tier: { min: 3 } }, act: { target: ally, heal: 5 } }]), []);
});

test("a skill that says what it does in more ways than one does what the first that holds says", () => {
  const has = (...names) => (when) => ((when.skill === undefined) || names.includes(when.skill)) && ((when.noSkill === undefined) || !names.includes(when.noSkill));
  assert.equal(act("Rally", has()).target.within, 1);
  assert.equal(act("Rally", has("Influence")).target.within, 2);
  assert.equal(act("Rally").target.within, 1, "without a unit to ask, the first way");
  const tier = (n) => (when) => (n >= (when.tier?.min ?? 0)) && (n <= (when.tier?.max ?? 9));
  assert.equal(act("Haymaker", tier(2)).strike.effects[0].proc.percent, 15);
  assert.equal(act("Haymaker", tier(3)).strike.effects[0].proc.percent, 25);
  assert.equal(actOf({ ...data("Cheer"), automate: false }), null);
});

/* -------------------------------------------- */
/*  Buffs and Debuffs                           */
/* -------------------------------------------- */

test("Cheer and Jeer: the stat picked as the skill was learnt, +4 or -4 for one unit, 2 for all in reach", () => {
  const cheer = act("Cheer");
  assert.deepEqual(actModes(cheer), ["one", "all"]);
  assert.deepEqual(learntStats("SPD"), ["spd"]);
  assert.deepEqual(learntStats(""), []);
  assert.equal(actGrant(cheer.grant, { choice: "" }), null, "nothing until the stat is picked");
  const one = actGrant(cheer.grant, { choice: "SPD" });
  assert.deepEqual(chosenEffects(one.choose, [], []), [{ stats: { spd: 4 } }]);
  const all = actGrant(actForAll(cheer).grant, { choice: "SPD" });
  assert.deepEqual(chosenEffects(all.choose, [], []), [{ stats: { spd: 2 } }]);
  assert.equal(actForAll(cheer).all, undefined);
  assert.ok(actReaches(cheer, "friend", 1) && !actReaches(cheer, "friend", 2) && !actReaches(cheer, "foe", 1) && !actReaches(cheer, "self", 0));

  // For 1 turn: until the turn of the unit that Cheered starts again
  const change = buildChange({ ...one, effects: chosenEffects(one.choose) }, context);
  assert.deepEqual({ ends: change.ends, turns: change.turns, clock: change.clock }, { ends: "turnStart", turns: 1, clock: "Actor.A" });
  assert.equal(tickChanges([change], "turnStart", "").ended.length, 0, "not by the ally's own turn");
  assert.equal(tickChanges([change], "turnStart", "Actor.A").ended.length, 1);
  assert.equal(listed.Cheer.picks[0].options.length, 7);

  const jeer = act("Jeer");
  assert.equal(jeer.target.who, "enemy");
  const lowered = actGrant(jeer.grant, { choice: "DEF" });
  assert.deepEqual(chosenEffects(lowered.choose), [{ stats: { def: -4 } }]);
  assert.deepEqual(chosenEffects(actGrant(actForAll(jeer).grant, { choice: "DEF" }).choose), [{ stats: { def: -2 } }]);
  const debuff = buildChange({ ...lowered, effects: chosenEffects(lowered.choose) }, context);
  assert.deepEqual({ ends: debuff.ends, turns: debuff.turns, clock: debuff.clock }, { ends: "turnEnd", turns: 1, clock: "" });

  // In a fight the enemy has that much less
  const plain = planExchange(A(), B());
  assert.equal(planExchange(A(), carrying(B(), debuff)).initiator.damage, plain.initiator.damage + 4);
});

test("Rally: the ally picks its stat, +4 for one or +2 for all adjacent, and Influence makes it +6 and +4 within 2 spaces", () => {
  const rally = act("Rally");
  assert.equal(rally.asks, "target");
  assert.equal(rally.grant.choose.stats.length, 7);
  assert.deepEqual(chosenEffects(actGrant(rally.grant).choose, ["mag"], []), [{ stats: { mag: 4 } }]);
  assert.deepEqual(chosenEffects(actForAll(rally).grant.choose, ["luk"], []), [{ stats: { luk: 2 } }]);

  // With nobody to pick, the stat the ally has the most of
  assert.deepEqual(chosenEffects(rally.grant.choose, [], [{ str: 3, mag: 9, dex: 5 }]), [{ stats: { mag: 4 } }]);
  const strong = act("Rally", (when) => when.skill === "Influence");
  assert.deepEqual([strong.target.within, strong.grant.choose.amount, strong.all.grant.choose.amount], [2, 6, 4]);
  assert.ok(actReaches(strong, "friend", 2) && !actReaches(rally, "friend", 2));
  assert.equal(listed.Influence.left, undefined);
});

test("Sabotage: -6 to a stat of the unit's choosing for an enemy within 3 spaces, until its own next turn starts", () => {
  const sabotage = act("Sabotage");
  assert.ok(actReaches(sabotage, "foe", 3) && !actReaches(sabotage, "foe", 4) && !actReaches(sabotage, "friend", 1));
  assert.equal(listed.Sabotage.usage.cooldown, 2);
  assert.equal(sabotage.asks, undefined, "its own unit picks");
  const effects = chosenEffects(sabotage.grant.choose, ["res"], []);
  assert.deepEqual(effects, [{ stats: { res: -6 } }]);
  const change = buildChange({ ...sabotage.grant, effects }, context);
  assert.deepEqual({ ends: change.ends, clock: change.clock }, { ends: "turnStart", clock: "Actor.A" });
  assert.equal(changeTone(change), "down");
});

/* -------------------------------------------- */
/*  Healing and Damage                          */
/* -------------------------------------------- */

test("Salve heals the unit itself or an adjacent ally for 5 HP", () => {
  const salve = act("Salve");
  assert.ok(actReaches(salve, "self", 0), "itself");
  assert.ok(actReaches(salve, "friend", 1) && !actReaches(salve, "friend", 2) && !actReaches(salve, "foe", 1));
  assert.equal(actAmount(salve.heal, () => 0), 5);
  assert.equal(actAmount(undefined, () => 9), 0);
});

test("Hemorrhage: a tenth of the enemy's maximum HP, then 1 HP for each move and 1-4 after each attack, for 2 turns", () => {
  const hemorrhage = act("Hemorrhage");
  const read = (value, theirs) => readNumber(value, { hpMax: theirs ? 37 : 20, stats: {} }, null);
  assert.equal(actAmount(hemorrhage.damage, read), 3, "of the enemy's maximum HP, rounded down");
  assert.equal(listed.Hemorrhage.usage.cooldown, 3);
  const change = buildChange(hemorrhage.grant, context);
  assert.deepEqual(change.toll, { move: 1, attack: { dice: 4 } });
  assert.equal(change.by, "Actor.A", "what it takes is its unit's doing");
  assert.deepEqual({ ends: change.ends, turns: change.turns }, { ends: "turnEnd", turns: 2 });
  assert.deepEqual(tollsOf([change], "move").map((toll) => toll.toll), [1]);
  assert.deepEqual(tollsOf([change], "attack").map((toll) => toll.toll), [{ dice: 4 }]);
  assert.equal(tollsOf([{ ...change, wait: 1 }], "move").length, 0);
  assert.equal(tollOf(1, () => 100), 1);
  assert.deepEqual([1, 25, 26, 50, 75, 76, 100].map((roll) => tollOf({ dice: 4 }, () => roll)), [1, 1, 2, 2, 3, 4, 4]);
  assert.deepEqual(cleanChange(change, checkEffects).toll, { move: 1, attack: { dice: 4 } });
  assert.equal(cleanChange({ ...change, toll: { move: "all" } }, checkEffects), null);
  assert.equal(changeTone(change), "down");
  assert.equal(changeParts(change).length, 2);
});

/* -------------------------------------------- */
/*  One Attack of the Skill's Own               */
/* -------------------------------------------- */

/** What a fight is told of an attack a skill has its unit make with numbers of its own. */
function strikeFor(name, unit, meets = null) {
  const written = act(name, meets);
  const view = { hp: unit.hp, hpMax: unit.hpMax, stats: unit.stats, weapon: unit.weapon ? { ...unit.weapon, hit: unit.bare.weapon.hit } : null };
  const within = written.target.within;
  const arm = strikeWeapon(written.strike, { name, number: (value) => readNumber(value, view, null), reach: { min: written.target.from ?? 1, max: within } });
  return { skill: name, share: (written.strike.share ?? 100) / 100, free: true, plain: !!written.strike.plain, effects: written.strike.effects ?? [], arm };
}

test("Pebble: one attack at 2 or 3 spaces with 0 Might, 50 Hit and 5 Critical, 50% to Stun, that activates no skill and is not answered", () => {
  const pebble = act("Pebble");
  assert.ok(actReaches(pebble, "foe", 2) && actReaches(pebble, "foe", 3) && !actReaches(pebble, "foe", 1) && !actReaches(pebble, "foe", 4));
  const luna = made("Luna", [{ proc: { on: "attack", percent: 100 }, damage: 10 }, { combat: { damage: 1 } }]);
  const thrower = A({ skills: [luna] });
  const extra = strikeFor("Pebble", thrower);
  assert.deepEqual({ might: extra.arm.weapon.might, range: extra.arm.weapon.range, hit: extra.arm.bare.hit, crit: extra.arm.bare.crit }, { might: 0, range: "2-3", hit: 50, crit: 5 });
  const bow = { name: "Iron Bow", category: "bow", range: "2", might: 6 };
  const plan = planExchange(thrower, B({ weapon: bow }), { distance: 3, extra });
  assert.deepEqual(plan.order, ["initiator"], "one attack, no follow-up, not answered");
  assert.ok(plan.defender.blocked);
  const sword = planExchange(A(), B(), { distance: 1 });
  assert.equal(plan.initiator.hit, sword.initiator.hit - 40, "50 Hit in place of the sword's 90");
  assert.equal(plan.initiator.damage, 10 + 0 + 1 - 6, "STR and no Might, with what its skills always add");
  assert.equal(plan.initiator.chances.attack.length, 0, "no skill activates");
  assert.deepEqual(plan.initiator.inflicts?.map((entry) => [entry.id, entry.chance]) ?? plan.initiator.unit.weapon.effect, [["stun", 50]]);
  const result = resolveExchange(plan, dice(1, 100, 1));
  assert.equal(result.attacks.length, 1);
  assert.equal(result.initiator.usesSpent, 0, "the weapon in hand is not used");
  assert.deepEqual(withoutMoments(thrower).skills[0].effects, [{ combat: { damage: 1 } }]);
});

test("Haymaker: one attack with a Brawl weapon the unit carries, at half its final damage, with a chance to Daze", () => {
  const written = act("Haymaker", (when) => (when.tier?.max ?? 9) >= 2);
  assert.deepEqual(written.strike.weapon, ["brawl"]);
  const gauntlets = { id: "g", name: "Iron Gauntlets", category: "brawl", might: 3, range: "1", effect: "2x Strikes", damageStat: "str", wexp: 1, uses: { value: 30, max: 30 } };
  const arm = { weapon: gauntlets, bare: { hit: 85, crit: 0, weight: 2, rank: "E" } };
  const brawler = A();
  assert.equal(armedWith(brawler, arm).weapon.name, "Iron Gauntlets");
  assert.equal(armedWith(brawler, arm).bare.weapon.hit, 85);
  assert.equal(brawler.weapon.name, "Iron Sword", "the weapon in hand stays in hand");
  const extra = { skill: "Haymaker", share: 0.5, free: false, effects: written.strike.effects, arm };
  const plan = planExchange(brawler, B(), { distance: 1, extra });
  assert.deepEqual(plan.order, ["initiator"], "one strike of a weapon that strikes twice, and no counter-attack");
  const whole = planExchange(armedWith(A(), arm), B(), { distance: 1 });
  const result = resolveExchange(plan, dice(1, 100, 15));
  assert.equal(result.attacks[0].damage, Math.floor(whole.initiator.damage / 2));
  const daze = plan.initiator.chances.hit.find((proc) => proc.skill === "Haymaker");
  assert.equal(daze.chance, 15);
  assert.ok(result.attacks[0].conditions.inflicted.some((entry) => entry.id === "daze"), "a 15 on the die Dazes");
  const missed = resolveExchange(planExchange(brawler, B(), { distance: 1, extra }), dice(1, 100, 16));
  assert.ok(!missed.attacks[0].conditions.inflicted.some((entry) => entry.id === "daze"));
  assert.equal(result.initiator.usesSpent, 1, "the Brawl weapon loses a use");
});

test("Confiteor: one attack within 3 spaces whose damage is STR + MAG against the lower of DEF and RES", () => {
  const confiteor = act("Confiteor");
  assert.ok(actReaches(confiteor, "foe", 1) && actReaches(confiteor, "foe", 3) && !actReaches(confiteor, "foe", 4));
  assert.equal(listed.Confiteor.usage.cooldown, 3);
  const templar = A({ stats: { str: 10, mag: 7 } });
  const extra = strikeFor("Confiteor", templar);
  assert.equal(extra.arm.weapon.might, 7, "MAG as its Might, STR added to it");
  assert.equal(extra.arm.bare.hit, 90, "the Hit of the weapon in hand");
  const plan = planExchange(templar, B({ stats: { def: 9, res: 2 } }), { distance: 3, extra });
  assert.deepEqual(plan.order, ["initiator"]);
  assert.equal(plan.initiator.damage, 10 + 7 - 2, "against RES, the lower");
  assert.equal(planExchange(templar, B({ stats: { def: 1, res: 8 } }), { distance: 2, extra }).initiator.damage, 10 + 7 - 1, "against DEF, the lower");
});

/* -------------------------------------------- */
/*  What an Ally Carries                        */
/* -------------------------------------------- */

test("Harsh Command turns stat penalties into bonuses, negates combat penalties and lets its ally counter-attack", () => {
  const command = buildChange(act("Harsh Command").grant, { skill: "Harsh Command", from: "Sergeant", giver: "Actor.S" });
  assert.equal(command.ends, "turnEnd");
  const curse = buildChange({ effects: [{ stats: { str: -4 }, combat: { hit: -10 } }], ends: "turnEnd" }, { skill: "Curse", from: "Witch", giver: "Actor.W" });
  const self = { hp: 20, hpMax: 20, stats: { str: 10 }, weapon: null, near: null };
  const cursed = skillTotals(timedEntries([curse]), self);
  assert.deepEqual([cursed.stats.str, cursed.combat.hit], [-4, -10]);
  const commanded = skillTotals(timedEntries([curse, command]), self);
  assert.equal(commanded.stats.str, 4, "the penalty counts as a bonus");
  assert.equal(commanded.combat.hit ?? 0, 0, "and the penalty to Hit is gone");
  assert.ok(commanded.rules.has("unforced") && commanded.rules.has("answers"));

  // It answers an attack though a skill would keep it from it
  const sweep = made("Sweep", [{ rules: ["foeNoCounter"] }]);
  assert.ok(planExchange(A({ skills: [sweep] }), B()).defender.blocked);
  assert.equal(planExchange(A({ skills: [sweep] }), carrying(B(), command)).defender.blocked, null);
  assert.equal(changeTone(command), "up");
});

test("Enlighten makes sure of one of the unit's skills that roll a chance in a fight, for its next fight", () => {
  const astra = made("Astra", [{ proc: { on: "attack", stat: "dex", div: 2 }, damage: 5 }]);
  const renewal = made("Renewal", [{ proc: { on: "turnStart", stat: "luk" }, recover: 5 }]);
  const steady = made("Steady", [{ combat: { hit: 5 } }, { proc: { on: "kill", sure: true }, recover: 2 }]);
  assert.deepEqual(activationSkills([astra, renewal, steady]), ["Astra"], "not one that waits for a turn, nor one that is sure");
  assert.equal(pickBy(["a", "b", "c"], 1), "a");
  assert.equal(pickBy(["a", "b", "c"], 35), "b");
  assert.equal(pickBy(["a", "b", "c"], 100), "c");
  assert.equal(pickBy([], 50), null);
  const enlighten = act("Enlighten");
  assert.ok(enlighten.assures && actReaches(enlighten, "self", 0) && actReaches(enlighten, "friend", 1));
  assert.equal(listed.Enlighten.usage.cooldown, 5);

  const sure = buildChange({ name: "Enlighten", effects: [{ assures: ["Astra"] }], ends: "map", once: "fight" }, { skill: "Enlighten", from: "Apostle" });
  const plain = planExchange(A({ skills: [astra] }), B());
  assert.equal(plain.initiator.chances.attack[0].chance, 4, "DEX 8, halved");
  const plan = planExchange(carrying(A({ skills: [astra] }), sure), B());
  assert.equal(plan.initiator.chances.attack[0].chance, 100);
  assert.equal(spendOnce([sure], "attack").ended.length, 1, "the fight uses it up");
  assert.equal(spendOnce([sure], "fight").ended.length, 1);
  assert.equal(spendOnce([sure], null).ended.length, 0);
  assert.deepEqual(cleanChange(sure, checkEffects).effects, [{ assures: ["Astra"] }]);
});

test("Art of War lends the effects of five skills for the kinds of weapon that are picked", () => {
  const art = act("Art of War");
  const lends = art.grant.lends;
  assert.deepEqual(lends.map((lend) => [lend.pick, lend.manual]), [["wields", "B"], ["foes", "B"]]);
  const effects = lentEffects(lends, { wields: ["bow", "crossbow"], foes: ["lance"] });
  assert.deepEqual(effects, [
    { when: { weapon: ["bow", "crossbow"] }, combat: { critical: 10, hit: 20, damage: 3 } },
    { when: { foeWeapon: ["lance"] }, combat: { hit: 15, dodge: 15, damage: 3, critical: 10 } }
  ]);
  assert.deepEqual(checkEffects(effects), []);
  assert.equal(lentEffects(lends, { wields: ["sword"] }).length, 1, "nothing for a kind nobody could pick");

  // The ally fights the better for it, with that weapon and against that weapon
  const lent = buildChange({ ends: "turnStart", clock: "giver", effects: lentEffects(lends, { wields: ["sword"], foes: ["sword"] }) }, { ...context, skill: "Art of War" });
  const plain = planExchange(A(), B());
  const plan = planExchange(carrying(A(), lent), B());
  assert.equal(plan.initiator.damage, plain.initiator.damage + 6);
  assert.equal(plan.initiator.crit, plain.initiator.crit + 20);
  assert.equal(plan.defender.hit, plain.defender.hit - 15, "Dodge against a sword");
  const lance = { name: "Iron Lance", category: "lance" };
  assert.equal(planExchange(carrying(A({ weapon: lance }), lent), B({ weapon: lance })).initiator.crit, plain.initiator.crit, "not with a lance against a lance");
});

/* -------------------------------------------- */
/*  A Mark on One Unit                          */
/* -------------------------------------------- */

test("Mark: whoever fights the marked enemy has +15 Hit and Critical and +3 damage, one enemy at a time", () => {
  const mark = act("Mark");
  assert.ok(actReaches(mark, "foe", 1) && actReaches(mark, "foe", 40), "anywhere on the map");
  assert.ok(!actReaches(mark, "friend", 2));
  assert.equal(mark.grant.lone, true);
  const change = buildChange(mark.grant, { ...context, skill: "Mark" });
  assert.equal(change.ends, "map");
  const plain = planExchange(A(), B());
  const plan = planExchange(A(), carrying(B(), change));
  assert.equal(plan.initiator.damage, plain.initiator.damage + 3);
  assert.equal(plan.initiator.crit, plain.initiator.crit + 15);
  assert.equal(Math.min(plain.initiator.hit + 15, 100), plan.initiator.hit);
  assert.equal(plan.defender.damage, plain.defender.damage, "the marked enemy gains nothing");

  // Used on another enemy, the first loses it
  const dropped = grantChange([change], buildChange({ drop: "all", name: "Mark" }, { ...context, skill: "Mark" }));
  assert.equal(dropped.list.length, 0);
  assert.equal(changeTone(change), "down");
});

test("Provoke: the enemy carries the rule and the unit it comes from for 3 turns, until it is in a fight", () => {
  const provoke = act("Provoke");
  assert.ok(actReaches(provoke, "foe", 4) && !actReaches(provoke, "foe", 5));
  assert.equal(listed.Provoke.usage.cooldown, 3);
  const change = buildChange(provoke.grant, { ...context, skill: "Provoke" });
  assert.deepEqual({ ends: change.ends, turns: change.turns, once: change.once, by: change.by }, { ends: "turnEnd", turns: 3, once: "fight", by: "Actor.A" });
  assert.deepEqual(provokers([change]), ["Actor.A"]);
  assert.deepEqual(provokers([{ ...change, wait: 1 }]), []);
  assert.deepEqual(provokers([{ name: "x", effects: [{ stats: { str: 1 } }], by: "Actor.A" }]), []);
  assert.ok(skillTotals(timedEntries([change]), { stats: {}, near: null }).rules.has("provoked"));
  assert.equal(spendOnce([change], "attack").ended.length, 1, "ends if it enters combat, whoever started it");
  assert.equal(spendOnce([change], "fight").ended.length, 1);
  let list = [change];
  for ( let turn = 0; turn < 2; turn++ ) list = tickChanges(list, "turnEnd").list;
  assert.equal(list.length, 1);
  assert.equal(tickChanges(list, "turnEnd").list.length, 0, "over as its third turn ends");
  assert.equal(cleanChange(change, checkEffects).by, "Actor.A");
});

test("Bounty Hunter and Headhunter: bonuses in a fight against the enemy that was selected, once a map", () => {
  for ( const [name, bonus] of [["Bounty Hunter", 2], ["Headhunter", 3]] ) {
    const written = act(name);
    assert.ok(actReaches(written, "foe", 30), name);
    assert.deepEqual(listed[name].usage, { kind: "action", free: true, uses: 1, per: "map" }, name);
    const mark = buildChange({ ...written.grant, name }, { skill: name, from: "A", giver: "Actor.A" });
    assert.equal(mark.mark, true);
    const hunter = A({ skills: [skill(name)] });
    const plain = planExchange(hunter, B());
    const plan = planExchange(hunter, carrying(B(), mark));
    assert.equal(plan.initiator.damage, plain.initiator.damage + bonus, `${name}: STR`);
    assert.equal(plan.defender.damage, plain.defender.damage - bonus, `${name}: DEF`);
    assert.ok(plan.initiator.crit >= plain.initiator.crit + 10, `${name}: Critical`);
    assert.ok(plan.defender.hit <= plain.defender.hit - 10, `${name}: Dodge`);

    // Not against another unit, nor against one that carries another unit's mark
    const other = planExchange(hunter, carrying(B(), { ...mark, from: "Somebody" }));
    assert.equal(other.initiator.damage, plain.initiator.damage, name);
  }
  const armored = { qualities: "Armored" };
  const mark = buildChange({ ...act("Headhunter").grant, name: "Headhunter" }, { skill: "Headhunter", from: "A", giver: "Actor.A" });
  const result = resolveExchange(planExchange(A({ skills: [skill("Headhunter")] }), carrying(B(armored), mark)), dice(1, 100, 100, 100));
  const usual = resolveExchange(planExchange(A({ skills: [skill("Headhunter")] }), B(armored)), dice(1, 100, 100, 100));
  assert.ok(result.attacks[0].damage > usual.attacks[0].damage + 3, "effective damage against the enemy it selected");
});

test("Loyalty: +10 Hit and Critical within 2 spaces of the ally that was chosen for the map", () => {
  const loyalty = act("Loyalty");
  assert.ok(actReaches(loyalty, "friend", 12) && !actReaches(loyalty, "foe", 1));
  assert.deepEqual(listed.Loyalty.usage, { kind: "action", free: true, uses: 1, per: "map" });
  assert.equal(buildChange({ ...loyalty.grant, name: "Loyalty" }, context).mark, true);
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const placed = (id, side, at, more = {}) => ({ id, actor: `Actor.${id}`, name: id, side, tile: { i: at[0], j: at[1] }, hp: 20, hpMax: 20, stats: {}, skills: [], ...more });
  const near = (marks, at) => surroundings([placed("k", "player", [0, 0]), placed("lord", "player", at, { marks }), placed("other", "player", [0, 1])], "k", measure);
  const self = (around) => ({ hp: 20, hpMax: 20, stats: {}, weapon: null, near: around });
  assert.equal(skillTotals([skill("Loyalty")], self(near(["Loyalty"], [1, 1]))).combat.hit, 10);
  assert.equal(skillTotals([skill("Loyalty")], self(near(["Loyalty"], [1, 1]))).combat.critical, 10);
  assert.equal(skillTotals([skill("Loyalty")], self(near(["Loyalty"], [2, 1]))).combat.hit ?? 0, 0, "3 spaces is too far");
  assert.equal(skillTotals([skill("Loyalty")], self(near([], [1, 1]))).combat.hit ?? 0, 0, "another ally does not count");
});

test("Forward Observation: its unit's side fights the chosen enemy better, and the enemy loses Hit while it is watched", () => {
  const written = act("Forward Observation");
  assert.ok(actReaches(written, "foe", 25));
  assert.equal(written.grant.lone, true);
  const chosen = buildChange({ ...written.grant, watch: true }, { ...context, skill: "Forward Observation" });
  assert.deepEqual({ by: chosen.by, watch: chosen.watch, ends: chosen.ends }, { by: "Actor.A", watch: true, ends: "map" });
  assert.equal(cleanChange(chosen, checkEffects).watch, true);
  const plain = planExchange(A(), B());
  const plan = planExchange(A(), carrying(B(), chosen));
  assert.equal(plan.defender.hit, plain.defender.hit - 15, "+15 Dodge against it");
  assert.equal(plan.defender.damage, plain.defender.damage - 2, "+2 DEF against it");

  // As it first stands in sight: -15 Hit until the end of its next turn. Each turn it starts there: -5 Hit
  // and -1 damage more, up to 10 times over; a turn that starts out of sight takes all of it off
  const enters = buildChange({ ...written.watch.enters, name: "sighted" }, context);
  assert.deepEqual({ ends: enters.ends, turns: enters.turns }, { ends: "turnEnd", turns: 1 });
  let list = [];
  for ( let turn = 0; turn < 12; turn++ ) list = grantChange(list, buildChange({ ...written.watch.stays, name: "in sight", ends: "map" }, context)).list;
  assert.equal(list[0].stacks, 10);
  const watched = planExchange(A(), carrying(carrying(B(), chosen), ...[enters], list[0]));
  assert.equal(watched.defender.hit, plain.defender.hit - 15 - 15 - 50);
  assert.equal(watched.defender.damage, Math.max(plain.defender.damage - 2 - 10, 0));
  assert.equal(grantChange(list, buildChange({ drop: "all", name: "in sight" }, context)).list.length, 0);
});

test("Blood Tide: the unit and the ally it chooses both gain +2 STR and +4 DEX, one ally at a time", () => {
  const tide = act("Blood Tide");
  assert.deepEqual(listed["Blood Tide"].usage, { kind: "action", free: true });
  assert.ok(actReaches(tide, "friend", 9));
  assert.deepEqual([tide.grant.lone, tide.grant.also], [true, "self"]);
  const { lone, also, ...plain } = tide.grant;
  const change = buildChange(plain, { ...context, skill: "Blood Tide" });
  assert.deepEqual(change.effects, [{ stats: { str: 2, dex: 4 } }]);
  assert.equal(change.ends, "map");
  const base = planExchange(A(), B());
  assert.equal(planExchange(carrying(A(), { ...change, from: "" }), B()).initiator.damage, base.initiator.damage + 2);
});

/* -------------------------------------------- */
/*  A Charge                                    */
/* -------------------------------------------- */

test("Blast: from its unit's next turn, +6 Might with every Tome and 2 more Range with one that reaches 3 or less", () => {
  assert.deepEqual(listed.Blast.usage, { kind: "action", cooldown: 3, unmoved: true });
  const self = { name: "Cannon", uuid: "Actor.Cannon", hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null, near: null };
  const used = useMoment(skill("Blast"), self, () => 100);
  const [change] = used.entries.flatMap((entry) => entry.granted.map((given) => given.change));
  assert.equal(change.wait, 1);
  assert.equal(timedEntries([change]).length, 0, "nothing in the turn it is charged in");
  const begun = tickChanges([change], "turnStart").list;
  assert.equal(timedEntries(begun).length, 1);
  assert.equal(tickChanges(begun, "turnEnd").list.length, 0, "over as that turn ends");

  const fire = { name: "Fire", category: "fire", range: "1-2", might: 5, damageStat: "mag" };
  const mage = (weapon) => ({ ...A({ weapon, stats: { mag: 10 } }), timed: begun });
  const plain = planExchange(A({ weapon: fire, stats: { mag: 10 } }), B(), { distance: 2 });
  const charged = planExchange(mage(fire), B(), { distance: 2 });
  assert.equal(charged.initiator.damage, plain.initiator.damage + 6);
  assert.equal(planExchange(mage(fire), B(), { distance: 4 }).initiator.blocked, null, "1-2 reaches 4");
  assert.equal(planExchange(A({ weapon: fire, stats: { mag: 10 } }), B(), { distance: 4 }).initiator.blocked, "outOfRange");
  const siege = { name: "Bolting", category: "thunder", range: "3-10", might: 8, damageStat: "mag" };
  assert.equal(planExchange(mage(siege), B(), { distance: 12 }).initiator.blocked, "outOfRange", "not a Tome that reaches further than 3");
  assert.equal(planExchange(mage(siege), B(), { distance: 5 }).initiator.damage, planExchange(A({ weapon: siege, stats: { mag: 10 } }), B(), { distance: 5 }).initiator.damage + 6);
  assert.equal(planExchange({ ...A(), timed: begun }, B()).initiator.damage, planExchange(A(), B()).initiator.damage, "not with a sword");
});

/**
 * Tests for the changes a fight leaves on a foe (`module/rules/combat.mjs`, `module/rules/skills.mjs`,
 * `module/rules/skill-combat.mjs`, `module/rules/timed.mjs`): a change that counts for the rest of the fight
 * it is granted in, one that lasts only a part of a fight, a stat that is multiplied or counts otherwise for
 * one attack, stats picked by whoever acts for a unit, the effect of a staff, and a chance that is rolled as
 * a unit is attacked.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planExchange, playExchange, resolveExchange } from "../module/rules/combat.mjs";
import { checkEffects, multiplyStats, skillTotals, turnMoment } from "../module/rules/skills.mjs";
import { changeTone, changeParts } from "../module/helpers/timed-context.mjs";
import { chosenEffects, cleanChange, expandGrant, grantChange, pickCount, pickStats, tickChanges, timedEntries } from "../module/rules/timed.mjs";
import { FEO } from "../module/config.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/**
 * Plan a fight and roll it out with the dice given, one after the other; `rest` is what every die after them
 * comes up as. `decide` answers what whoever acts for a unit is asked in the middle of it.
 */
function play(initiator, defender, rolls = [], { rest = 100, distance = 1, decide = () => null } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const { result } = playExchange(plan, (index) => rolls[index] ?? rest, decide, {});
  return { plan, result };
}

// With 6 DEX and 5 LUK a unit has 5 Critical, which its foe's 5 Critical Avoid leaves nothing of: no critical
// roll is made. Its sword deals 5 + 10 STR - 6 DEF = 9, and hits at 86. With 13 SPD it follows up
const A = (options = {}) => fighter({ name: "A", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const B = (options = {}) => fighter({ name: "B", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const FAST = { spd: 13 };
const by = (result, side) => result.attacks.filter((attack) => attack.side === side);
const dealt = (result, side = "initiator") => by(result, side).map((attack) => attack.damage);
const sides = (result) => result.attacks.map((attack) => attack.side);
const change = (result, to = "defender") => (result.granted ?? []).find((entry) => entry.to === to)?.change ?? null;

const STEP = ["Ruin", "Flense", "Cudgel", "Anathema", "Corona", "Radiance", "Insight", "Savage", "Tear", "Misery Mirror", "Seal", "Ploy", "Pulverize",
  "Burning Desire", "Glare"];

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

test("a typing mistake in what a fight leaves on a foe does not pass silently", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  const attack = { on: "attack", stat: "dex" };
  const grant = (more) => ({ proc: attack, grant: { to: "foe", ends: "turnEnd", ...more } });
  assert.ok(wrong({ statTimes: { luck: 0 } }), "an unknown stat");
  assert.ok(wrong({ statTimes: { def: -1 } }));
  assert.ok(wrong({ statTimes: { def: 0.5 }, aura: { who: "enemy", within: 2 } }));
  assert.ok(!wrong({ statTimes: { def: 0.5 } }));
  assert.ok(wrong({ statTimes: { def: 0.5 }, until: "theEnd" }));
  assert.ok(wrong({ proc: attack, until: "followUp", damage: 1 }), "always there");
  assert.ok(wrong({ proc: { on: "struck", stat: "dex" }, foeStatTimes: { luk: 0 } }), "on an attack");
  assert.ok(wrong({ proc: attack, foeStatTimes: { luck: 0 } }));
  assert.ok(wrong({ proc: { on: "hit", stat: "dex" }, inflictsAttacker: ["stun"] }));
  assert.ok(!wrong({ proc: { on: "attacked", stat: "str" }, inflictsAttacker: ["stun"] }));
  assert.ok(wrong(grant({ choose: { stats: ["str"], amount: -5 } })), "two stats at least");
  assert.ok(wrong(grant({ choose: { stats: ["str", "def"], pick: 2, amount: -5 } })), "fewer than are listed");
  assert.ok(wrong(grant({ choose: { stats: ["str", "def"], amount: 0 } })));
  assert.ok(wrong(grant({ choose: { stats: ["str", "def"], amount: -5 }, effects: [{ stats: { str: -1 } }] })));
  assert.ok(!wrong(grant({ choose: { stats: ["str", "def", "res"], pick: 2, amount: -5 } })));
  assert.ok(wrong({ proc: attack, grant: { to: "foe", staff: "nothing" } }));
  assert.ok(wrong({ proc: attack, grant: { to: "foe", staff: "charm", effects: [{ stats: { str: -1 } }] } }));
  assert.ok(!wrong({ proc: attack, grant: { to: "foe", staff: "charm" } }));
  assert.ok(wrong(grant({ over: "res", effects: [{ stats: { str: -1 } }] })), "only with a reach");
});

/* -------------------------------------------- */
/*  A Stat That Is Multiplied                   */
/* -------------------------------------------- */

test("a stat is multiplied once everything is added to it, and two halvings make a quarter", () => {
  assert.deepEqual(multiplyStats({ def: 15, res: 9 }, { own: {}, incoming: { def: 0.5 }, by: { def: ["Insight"] } }).stats, { def: 7, res: 9 });
  const twice = multiplyStats({ def: 15 }, { own: { def: 0.5 }, incoming: { def: 0.5 }, by: { def: ["One", "Two"] } });
  assert.equal(twice.stats.def, 3, "15 -> 7 -> 3");
  assert.deepEqual(twice.names, ["One", "Two"]);
  assert.equal(multiplyStats({ luk: 9 }, { own: {}, incoming: { luk: 0 }, by: {} }).stats.luk, 0);
  assert.deepEqual(multiplyStats({ def: 15 }, { own: {}, incoming: { def: 0.5 }, by: {} }).lowered, { def: -8 });
});

test("what a unit's skills take off incoming penalties eases a stat that is halved, or negates it", () => {
  assert.equal(multiplyStats({ def: 15 }, { own: {}, incoming: { def: 0.5 }, by: {} }, { stats: 4 }).stats.def, 11, "8 less, eased by 4");
  assert.equal(multiplyStats({ def: 15 }, { own: {}, incoming: { def: 0.5 }, by: {} }, { stats: 20 }).stats.def, 15);
  const halved = { name: "Insight (A)", timed: true, foreign: true, effects: [{ statTimes: { def: 0.5 } }] };
  const ward = made("Ward", [{ debuffs: { negate: true } }]);
  const self = { hp: 20, hpMax: 20, level: 5, stats: { def: 15 }, weapon: null };
  assert.deepEqual(skillTotals([halved], self).statTimes.incoming, { def: 0.5 });
  assert.deepEqual(skillTotals([ward, halved], self).statTimes.incoming, {}, "negated");
});

test("a change that halves a stat halves it in a fight, with what else lowers it counted first", () => {
  const insight = { name: "Insight", from: "A", effects: [{ statTimes: { def: 0.5, res: 0.5 } }], ends: "turnEnd", turns: 1, clock: "", stacks: 1, max: 0, fades: false };
  const flense = { name: "Flense", from: "A", effects: [{ stats: { def: -2 } }], ends: "turnEnd", turns: 1, clock: "", stacks: 1, max: 0, fades: false };
  const plain = planExchange(A(), B());
  assert.equal(plain.initiator.damage, 9);
  const halved = planExchange(A(), { ...B(), timed: [insight] });
  assert.equal(halved.defender.unit.stats.def, 3);
  assert.equal(halved.defender.unit.stats.res, 1, "3 halved, rounded down");
  assert.equal(halved.initiator.damage, 12);
  const both = planExchange(A(), { ...B(), timed: [flense, insight] });
  assert.equal(both.defender.unit.stats.def, 2, "(6 - 2) halved");
  assert.equal(both.initiator.damage, 13);
  assert.ok(both.defender.unit.fx.sources.some((source) => (source.name === "Insight (A)") && (source.stats.def === -2)), "named in the sums");
});

test("a halved stat is one stat debuff, by the points it is lowered by", () => {
  const insight = { name: "Insight", from: "A", effects: [{ statTimes: { def: 0.5 } }], ends: "turnEnd", turns: 1, clock: "", stacks: 1, max: 0, fades: false };
  const cruel = planExchange(A({ skills: [skill("Cruelty")] }), { ...B(), timed: [insight] });
  assert.equal(cruel.initiator.hit, planExchange(A(), { ...B(), timed: [insight] }).initiator.hit + 3, "one stat is lowered");
});

test("a change says what it does to a stat it multiplies, and whether its unit is the worse for it", () => {
  const halved = { name: "Insight", from: "A", effects: [{ statTimes: { def: 0.5, res: 0.5 } }], ends: "turnEnd", turns: 2, stacks: 1 };
  assert.deepEqual(changeParts(halved).map((part) => part.value), ["×0.5", "×0.5"]);
  assert.equal(changeTone(halved), "down");
  assert.equal(changeTone({ effects: [{ stats: { str: 3 } }] }), "up");
  assert.equal(changeTone({ effects: [{ stats: { str: 3, def: -3 } }] }), "");
  assert.equal(changeTone({ effects: [{ rules: ["neutral", "noCombat"] }] }), "down");
  assert.equal(changeTone({ effects: [{ calc: { damageBy: "lowest" } }] }), "down");
  assert.equal(changeTone({ effects: [], hp: 10 }), "up");
});

/* -------------------------------------------- */
/*  A Change That Counts at Once                */
/* -------------------------------------------- */

test("Flense lowers the foe's DEF by the damage dealt, from the next attack of that fight on", () => {
  const { result } = play(A({ stats: FAST, skills: [skill("Flense")] }), B(), [1, 1, 100, 50, 1]);
  assert.deepEqual(sides(result), ["initiator", "defender", "initiator"]);
  assert.deepEqual(dealt(result), [9, 15], "6 DEF less, all of it");
  const left = result.granted.find((entry) => entry.to === "defender");
  assert.deepEqual(left.change.effects, [{ stats: { def: -9 } }]);
  assert.equal(left.now, true);
  assert.equal(left.counted, true);
  assert.equal(left.at, 0, "the attack it began with");
  assert.equal(left.change.turns, 1, "until the end of the foe's next turn");
});

test("Flense that does not activate, or misses, changes nothing", () => {
  assert.deepEqual(dealt(play(A({ stats: FAST, skills: [skill("Flense")] }), B(), [50, 1, 1, 50, 1]).result), [9, 9]);
  const missed = play(A({ stats: FAST, skills: [skill("Flense")] }), B(), [1, 100, 1, 50, 1]).result;
  assert.deepEqual(dealt(missed), [0, 9]);
  assert.equal(missed.granted, undefined);
});

test("Flense activated again is set anew by that hit, not added up", () => {
  const { result } = play(A({ stats: FAST, skills: [skill("Flense")] }), B({ stats: { def: 12 } }), [1, 1, 1, 1, 1]);
  assert.deepEqual(dealt(result), [3, 6], "3 less DEF for the second attack");
  const changes = result.granted.filter((entry) => entry.to === "defender").map((entry) => entry.change.effects[0].stats.def);
  assert.deepEqual(changes, [-3, -6]);
});

test("a plan that does not say what it was planned from counts a change from after the fight, as before", () => {
  const plan = planExchange(A({ stats: FAST, skills: [skill("Flense")] }), B());
  const { given, ...bare } = plan;
  const result = resolveExchange(bare, (() => {
    const rolls = [1, 1];
    let at = 0;
    return () => rolls[at++] ?? 100;
  })());
  assert.deepEqual(dealt(result), [9, 0], "the follow-up misses on a 100; nothing was planned again");
  assert.equal(result.granted[0].counted, undefined);
});

test("Ruin takes Critical Avoid off the foe for the rest of the fight, 20 at most", () => {
  const ruined = play(A({ stats: FAST, skills: [skill("Ruin")] }), B(), [1, 1, 50, 1, 50, 1, 100]).result;
  const attacks = by(ruined, "initiator");
  assert.equal(attacks[0].critChance, 0);
  assert.equal(attacks[1].critChance, 9, "5 Critical against 5 - 9 Critical Avoid");
  assert.deepEqual(change(ruined).effects, [{ combat: { critAvoid: -9 } }]);
  const strong = play(A({ stats: { ...FAST, str: 40 }, skills: [skill("Ruin")] }), B({ hp: 90, hpMax: 90 }), [1, 1, 50, 1, 50, 1, 100]).result;
  assert.deepEqual(change(strong).effects, [{ combat: { critAvoid: -20 } }]);
});

test("Cudgel picks STR, DEF or SPD by a die, and the stat is lowered for the rest of the fight", () => {
  // The activation, the hit, then the die for the stat: 1 is STR, 50 is DEF, 100 is SPD
  const str = play(A({ stats: FAST, skills: [skill("Cudgel")] }), B(), [1, 1, 1, 1, 50, 1]).result;
  assert.equal(change(str).name, "Cudgel (STR)");
  assert.equal(by(str, "defender")[0].damage, 5, "4 STR less");
  assert.equal(by(str, "initiator")[0].damage, 9 + 8, "a fifth of 40 HP");
  const def = play(A({ stats: FAST, skills: [skill("Cudgel")] }), B(), [1, 1, 50, 1, 50, 1]).result;
  assert.equal(change(def).name, "Cudgel (DEF)");
  assert.deepEqual(dealt(def), [17, 13], "4 DEF less for the follow-up");
  assert.equal(change(def).turns, 2);
});

test("Anathema has the foe fight with its lowest stats from its next attack on", () => {
  const foe = () => B({ stats: { str: 14, mag: 2, dex: 10, spd: 9 } });
  const cursed = play(A({ skills: [skill("Anathema")] }), foe(), [1, 1, 1]).result;
  assert.equal(by(cursed, "defender")[0].damage, 5 + 2 - 6, "MAG in place of STR");
  const plain = play(A(), foe(), [1, 1]).result;
  assert.equal(by(plain, "defender")[0].damage, 13);
  assert.ok(by(cursed, "defender")[0].hitChance < by(plain, "defender")[0].hitChance);
});

test("Radiance doubles the damage and takes 50 Accuracy off the foe for the rest of the fight", () => {
  const { result } = play(A({ skills: [skill("Radiance")] }), B(), [1, 1, 1]);
  assert.equal(by(result, "initiator")[0].damage, 18);
  const plain = play(A(), B(), [1, 1]).result;
  assert.equal(by(result, "defender")[0].hitChance, by(plain, "defender")[0].hitChance - 50);
  assert.deepEqual(change(result).effects, [{ combat: { hit: -50 } }]);
});

test("Misery Mirror takes 5 DEX and SPD off the attacker at once, which it regains 1 a turn", () => {
  const mirror = () => B({ stats: { mag: 20 }, skills: [skill("Misery Mirror")] });

  // A hits, the mirror activates; B answers; A follows up with less Hit
  const { result } = play(A({ stats: FAST }), mirror(), [1, 1, 100, 50]);
  const attacks = by(result, "initiator");
  assert.equal(attacks[0].reflected, 4, "half of 9");
  assert.equal(attacks[1].hitChance, attacks[0].hitChance - 10, "5 DEX is 10 Accuracy");
  const left = change(result, "initiator");
  assert.equal(left.stacks, 5);
  assert.equal(left.fades, true);
  assert.equal(left.ends, "turnStart");
  const [entry] = timedEntries([left]);
  assert.equal(entry.effects[0].scale, 5);
  const ticked = tickChanges([left], "turnStart");
  assert.equal(ticked.list[0].stacks, 4, "1 regained as a turn starts");
});

test("a unit that negates what would be put on it is given nothing in the middle of a fight either", () => {
  const warded = B({ skills: [made("Ward", [{ debuffs: { negate: true } }])] });
  const { result } = play(A({ stats: FAST, skills: [skill("Flense")] }), warded, [1, 1]);
  assert.deepEqual(dealt(result), [9, 0]);
  assert.equal(result.granted, undefined);
});

/* -------------------------------------------- */
/*  Changes From After the Fight                */
/* -------------------------------------------- */

test("Corona ignores 30% of RES, and leaves the target with 0.7 of its RES after the fight", () => {
  const tome = { name: "Fire", category: "fire", range: "1-2", damageStat: "mag" };
  const mage = () => A({ stats: { ...FAST, mag: 12 }, weapon: tome, skills: [skill("Corona")] });
  const { result } = play(mage(), B({ stats: { res: 10 } }), [1, 1, 100, 50, 1]);
  assert.deepEqual(dealt(result), [5 + 12 - 7, 5 + 12 - 10], "the follow-up is against the whole RES: after combat");
  const left = change(result);
  assert.deepEqual(left.effects, [{ statTimes: { res: 0.7 } }]);
  assert.equal(result.granted[0].now, undefined);
  const next = planExchange(mage(), { ...B({ stats: { res: 10 } }), timed: [left] });
  assert.equal(next.defender.unit.stats.res, 7);
});

test("Insight halves DEF and RES after the fight, until the end of its unit's next turn", () => {
  const { result } = play(A({ stats: FAST, skills: [skill("Insight")] }), B(), [1, 100, 100, 50, 1]);
  assert.deepEqual(dealt(result), [13, 9], "a sure hit for 1.5 times; DEF is whole for the follow-up");
  const left = change(result);
  assert.deepEqual(left.effects, [{ statTimes: { def: 0.5, res: 0.5 } }]);
  assert.equal(left.clock, "Actor.A", "by its unit's turns");
  assert.equal(left.turns, 2, "this turn's end and the next");
  const defending = play(B(), A({ skills: [skill("Insight")] }), [1, 1, 100]).result;
  assert.equal(change(defending, "initiator").turns, 1);
  assert.equal(tickChanges([left], "turnEnd", "Actor.A").list[0].turns, 1);
  assert.equal(tickChanges([left], "turnEnd").list[0].turns, 2, "the target's own turns do not count");
});

test("Savage doubles STR for the attack and halves the target's DEX after the fight", () => {
  const { result } = play(A({ skills: [skill("Savage")] }), B(), [1, 1, 100]);
  assert.equal(by(result, "initiator")[0].damage, 19);
  assert.deepEqual(change(result).effects, [{ statTimes: { dex: 0.5 } }]);
  assert.equal(change(result).turns, 1);
});

/* -------------------------------------------- */
/*  A Stat of the Foe for One Attack            */
/* -------------------------------------------- */

test("Tear triples STR and counts the enemy's LUK as 0 for that attack alone", () => {
  const lucky = () => B({ stats: { luk: 15 } });
  const plain = play(A({ stats: FAST }), lucky(), [1, 100, 1]).result;
  const torn = play(A({ stats: FAST, skills: [skill("Tear")] }), lucky(), [1, 1, 100, 100, 50, 1]).result;
  const [first, second] = by(torn, "initiator");
  assert.equal(first.damage, 29, "STR three times");
  assert.equal(first.hitChance, by(plain, "initiator")[0].hitChance + 15, "15 LUK of Dodge");
  assert.equal(first.critChance, 5, "no Critical Avoid left");
  assert.equal(second.hitChance, by(plain, "initiator")[1].hitChance, "the next attack is as it was");
  assert.equal(torn.granted, undefined, "nothing lasts");
});

/* -------------------------------------------- */
/*  A Part of a Fight                           */
/* -------------------------------------------- */

test("Pulverize lowers DEF and RES to a quarter until its unit's follow-up attack is made", () => {
  const basara = () => A({ stats: FAST, skills: [skill("Pulverize", { active: true })] });
  const quick = () => B({ stats: { spd: 18 } });
  const plan = planExchange(basara(), B());
  assert.deepEqual(plan.lapses, { initiator: ["followUp"], defender: [] });
  assert.equal(plan.initiator.unit.stats.def, 1, "a quarter of 6");
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.damage), [18, 9], "doubled for the first attack");
  assert.deepEqual(plan.defender.blows.map((blow) => blow.damage), [14], "against 1 DEF");

  // A foe that follows up too makes that attack once the unit has made its own: against the whole DEF
  const both = planExchange(basara(), quick());
  assert.deepEqual(both.order, ["initiator", "defender", "defender"], "13 SPD does not follow up on 18");
  const even = planExchange(A({ stats: { spd: 12 }, skills: [skill("Pulverize", { active: true })] }), B({ stats: { spd: 16 } }));
  assert.deepEqual(even.defender.blows.map((blow) => blow.damage), [14, 14], "no follow-up of its own: for the whole fight");
  const slow = planExchange(basara(), B({ stats: { spd: 9 }, skills: [made("Twice", [{ rules: ["sureFollowUp"] }])] }));
  assert.deepEqual(slow.order, ["initiator", "defender", "initiator", "defender"]);
  assert.deepEqual(slow.defender.blows.map((blow) => blow.damage), [14, 9], "back to 6 DEF after the follow-up");
  assert.equal(slow.defender.blows[1].lapsed, true);

  const { result } = playExchange(slow, () => 1, () => null, {});
  assert.deepEqual(dealt(result, "defender"), [14, 9]);
  assert.deepEqual(dealt(result), [18, 9]);
});

test("Pulverize does nothing when its unit is attacked, or while it is switched off", () => {
  assert.equal(planExchange(B(), A({ skills: [skill("Pulverize", { active: true })] })).lapses, undefined);
  assert.equal(planExchange(A({ skills: [skill("Pulverize")] }), B()).initiator.unit.stats.def, 6);
});

/* -------------------------------------------- */
/*  Stats Picked by the Unit's Owner            */
/* -------------------------------------------- */

test("stats are picked for a unit by what the foe has the most of, in the order they are listed", () => {
  const choose = { stats: ["str", "mag", "def", "res", "spd", "dex", "luk"], pick: 2, amount: -5 };
  assert.equal(pickCount(choose), 2);
  assert.equal(pickCount({ stats: ["str", "def"], amount: -4 }), 1);
  assert.deepEqual(pickStats(choose, [{ str: 10, mag: 4, def: 6, res: 3, spd: 8, dex: 6, luk: 5 }]), ["str", "spd"]);
  assert.deepEqual(chosenEffects(choose, ["luk"], [{ str: 10, spd: 8 }]), [{ stats: { str: -5, luk: -5 } }], "what is left open is picked for it");
  assert.deepEqual(chosenEffects(choose, ["def", "res", "str"], []), [{ stats: { def: -5, res: -5 } }], "no more than it may");
  assert.deepEqual(chosenEffects(choose, ["con"], [{ dex: 9, luk: 8 }]), [{ stats: { dex: -5, luk: -5 } }], "what was not on offer is dropped");
});

test("Seal lowers the two stats its owner picks after the fight, and picks for them where nobody answers", () => {
  const sealer = () => A({ skills: [skill("Seal")] });

  // Nobody is asked: the foe's highest two, STR and SPD
  const alone = play(sealer(), B(), [1, 1, 1]).result;
  assert.deepEqual(change(alone).effects, [{ stats: { str: -5, spd: -5 } }]);
  assert.equal(change(alone).turns, 1);

  // The owner is asked twice, with what is still open each time
  const seen = [];
  const picked = play(sealer(), B(), [1, 1, 1], {
    decide: (point) => {
      seen.push({ on: point.on, side: point.side, stats: point.offers.map((offer) => offer.stat), left: point.offers[0].left });
      return (seen.length === 1) ? "Seal|def" : "Seal|res";
    }
  }).result;
  assert.deepEqual(change(picked).effects, [{ stats: { def: -5, res: -5 } }]);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], { on: "pick", side: "initiator", stats: ["str", "mag", "def", "res", "spd", "dex", "luk"], left: 2 });
  assert.deepEqual(seen[1].stats, ["str", "mag", "res", "spd", "dex", "luk"]);
  assert.equal(seen[1].left, 1);

  // One pick and a pass: the second is picked for them
  let asked = 0;
  const half = play(sealer(), B(), [1, 1, 1], { decide: () => ((asked++ === 0) ? "Seal|luk" : null) }).result;
  assert.deepEqual(change(half).effects, [{ stats: { str: -5, luk: -5 } }]);
});

test("Seal that does not activate, or whose foe fell, leaves nothing", () => {
  assert.equal(play(A({ skills: [skill("Seal")] }), B(), [1, 1, 50]).result.granted, undefined);
  assert.equal(play(A({ stats: { str: 60 }, skills: [skill("Seal")] }), B(), [1]).result.granted, undefined);
});

test("Ploy lowers one stat of the enemies within 2 spaces whose RES the unit's RES surpasses", () => {
  const near = {
    id: "ploy", side: "player", tile: null, others: [
      { id: "weak", name: "Weak", relation: "enemy", distance: 1, hp: 20, hpMax: 20, stats: { str: 9, res: 2 }, totals: { str: 12, res: 2, spd: 4 } },
      { id: "wise", name: "Wise", relation: "enemy", distance: 2, hp: 20, hpMax: 20, stats: { res: 9 }, totals: { str: 30, res: 9 } },
      { id: "far", name: "Far", relation: "enemy", distance: 3, hp: 20, hpMax: 20, stats: { res: 0 }, totals: { res: 0 } },
      { id: "friend", name: "Friend", relation: "ally", distance: 1, hp: 20, hpMax: 20, stats: { res: 0 }, totals: { res: 0 } }
    ]
  };
  const self = { name: "Schemer", uuid: "Actor.Schemer", hp: 20, hpMax: 20, level: 5, stats: { res: 6 }, weapon: null, near };
  const moment = turnMoment([skill("Ploy")], self, "turnStart", () => 100);
  const granted = moment.entries[0].granted;
  assert.deepEqual(granted.map((entry) => entry.unit), ["weak"], "RES 6 surpasses 2, not 9, and 3 spaces is too far");
  assert.deepEqual(granted[0].change.effects, [{ stats: { str: -4 } }], "picked for it: what that enemy has the most of");
  assert.equal(granted[0].change.ends, "phaseEnd");
  assert.deepEqual(granted[0].choose.stats.length, 7);

  // What its owner picked, by the skill
  const picked = turnMoment([skill("Ploy")], self, "turnStart", () => 100, { picks: { Ploy: ["spd"] } });
  assert.deepEqual(picked.entries[0].granted[0].change.effects, [{ stats: { spd: -4 } }]);

  // Nobody whose RES it surpasses: nothing happens
  const dull = turnMoment([skill("Ploy")], { ...self, stats: { res: 1 } }, "turnStart", () => 100);
  assert.equal(dull.entries.length, 0);
});

/* -------------------------------------------- */
/*  The Effect of a Staff, and Conditions       */
/* -------------------------------------------- */

test("the effect of the Charm staff is a change that lasts 3 turns: neutral, and attacking nobody", () => {
  const grant = expandGrant({ to: "foe", staff: "charm" });
  assert.deepEqual(grant.effects, FEO.staffChanges.charm.effects);
  assert.equal(grant.turns, 3);
  assert.equal(grant.to, "foe");
  assert.equal(expandGrant({ to: "foe", staff: "charm", turns: 1 }).turns, 1, "what the grant says itself comes first");
  assert.deepEqual(checkEffects(grant.effects), []);
  const totals = skillTotals([{ name: "Charm (A)", timed: true, foreign: true, effects: grant.effects }], { hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null });
  assert.ok(totals.rules.has("neutral") && totals.rules.has("noCombat"));
});

test("Burning Desire adds LUK to the damage, burns for 3 turns, and charms the target at once", () => {
  const lamia = () => A({ stats: { ...FAST, dex: 12 }, skills: [skill("Burning Desire")] });
  const { result } = play(lamia(), B(), [1, 1]);
  assert.deepEqual(sides(result), ["initiator", "initiator"], "the target is charmed and makes no counter-attack");
  assert.equal(by(result, "initiator")[0].damage, 14, "5 LUK");
  assert.equal(result.defender.conditions.burn, 3);
  const left = change(result);
  assert.equal(left.name, "Charm");
  assert.equal(left.from, "A");
  assert.equal(left.turns, 3);
  assert.ok(cleanChange(left, checkEffects), "it can be saved");

  // A target that already burns has the 3 turns added
  const burning = play(lamia(), B({ conditions: { burn: 2 } }), [1, 1]).result;
  assert.equal(burning.defender.conditions.burn, 5);

  // In its own turn the turn that is running is not counted
  const counter = play(B(), lamia(), [1, 1, 1]).result;
  assert.equal(change(counter, "initiator").turns, 4);
  assert.deepEqual(sides(counter), ["initiator", "defender", "defender"]);

  // A charmed unit begins no fight
  const charmed = planExchange({ ...B(), timed: [left] }, A());
  assert.equal(charmed.initiator.blocked, "skill");
});

test("Glare is rolled as its unit is attacked from 2 or 3 spaces, whether the attack lands or not", () => {
  const bow = { name: "Iron Bow", category: "bow", range: "2-3" };
  const tiger = () => B({ stats: { str: 30 }, skills: [skill("Glare")] });
  const archer = () => A({ stats: FAST, weapon: bow });

  // The Glare, then the attack, which misses: the archer is Stunned all the same, and makes no follow-up
  const missed = play(archer(), tiger(), [1, 100], { distance: 2 }).result;
  assert.deepEqual(sides(missed), ["initiator"]);
  assert.equal(missed.attacks[0].hit, false);
  assert.equal(missed.initiator.conditions.stun, 1);
  assert.equal(missed.attacks[0].conditions.returned[0].id, "stun");

  // And when it lands
  const landed = play(archer(), tiger(), [1, 1], { distance: 3 }).result;
  assert.equal(landed.attacks[0].hit, true);
  assert.equal(landed.initiator.conditions.stun, 1);
  assert.deepEqual(sides(landed), ["initiator"]);

  // Not rolled, or not from there: nothing
  const quiet = play(archer(), tiger(), [90, 1, 90, 1], { distance: 2 }).result;
  assert.equal(quiet.initiator.conditions.stun, undefined);
  assert.equal(by(quiet, "initiator").length, 2);
  const close = play(A({ stats: FAST }), tiger(), [1, 1, 1, 1], { distance: 1 }).result;
  assert.equal(close.initiator.conditions.stun, undefined);
});

/* -------------------------------------------- */
/*  What Lasts                                  */
/* -------------------------------------------- */

test("a change the foe carries after the fight is renewed, not doubled, by the same skill", () => {
  const first = play(A({ skills: [skill("Radiance")] }), B(), [1, 1, 100]).result;
  const carried = grantChange([], change(first)).list;
  const again = grantChange(carried, change(first));
  assert.equal(again.list.length, 1);
  assert.equal(again.renewed, true);
});

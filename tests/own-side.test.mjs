/**
 * Tests for what a fight leaves on a unit's own side (`module/rules/combat.mjs`, `module/rules/skills.mjs`,
 * `module/rules/timed.mjs`, `module/rules/auras.mjs`): a bonus that waits for the unit's next attack, one that
 * begins with its next turn, healing over the turns to come, what a unit pays for a skill of its own, stats
 * that dice pick, temporary HP as a skill is used, Dodge against an attack that would take much of its HP, and
 * what passes between allies around a fight.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { standing } from "../module/rules/auras.mjs";
import { planExchange, playExchange } from "../module/rules/combat.mjs";
import { sufferDamage } from "../module/rules/events.mjs";
import { checkEffects, momentDice, resolveDealt, turnMoment, useMoment } from "../module/rules/skills.mjs";
import { changeLasts, changeParts, changeTone, timedRows } from "../module/helpers/timed-context.mjs";
import {
  buildChange, cleanChange, dieFrom, grantChange, isIdle, mendsOf, randomDice, randomEffects, spendOnce, tickChanges, timedEntries, usedName
} from "../module/rules/timed.mjs";
import { fighter, made, skill, unit } from "./lib/fixtures.mjs";

/**
 * Plan a fight and roll it out with the dice given, one after the other; `rest` is what every die after them
 * comes up as.
 */
function play(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const { result } = playExchange(plan, (index) => rolls[index] ?? rest, () => null, {});
  return { plan, result };
}

// With 6 DEX and 5 LUK a unit has 5 Critical, which its foe's 5 Critical Avoid leaves nothing of: no critical
// roll is made. Its sword deals 5 + 10 STR - 6 DEF = 9, and hits at 86. With 13 SPD it follows up
const A = (options = {}) => fighter({ name: "A", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const B = (options = {}) => fighter({ name: "B", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const FAST = { spd: 13 };
const UNARMED = { weapon: null };
const by = (result, side) => result.attacks.filter((attack) => attack.side === side);
const dealt = (result, side = "initiator") => by(result, side).map((attack) => attack.damage);
const granted = (result, to) => (result.granted ?? []).filter((entry) => entry.to === to).map((entry) => entry.change);
const carrying = (fighterUnit, changes) => ({ ...fighterUnit, timed: changes.reduce((list, change) => grantChange(list, change).list, []) });

// The units around a unit, as the map tells of them
const around = (id, others) => ({ id, side: "player", tile: null, others });
const ally = (id, distance) => ({ id, name: id, relation: "ally", distance, hp: 20, hpMax: 20, stats: {}, totals: {} });

const STEP = ["Executioner's Mindset", "Iaido", "Standardbearer", "Lottery", "Hook", "Synergy", "Golden Lotus", "Holy Vestments", "Hero's Blood",
  "Future Sight", "Sharpen Claws", "Vindication", "Bloodthirst", "Convalescence", "Fury", "Bloodlust", "Umbra", "Primal Fury", "Offensive Tactics"];

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

test("a typing mistake in what a fight leaves on its own side does not pass silently", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  const grant = (more, proc = { on: "kill", sure: true }) => ({ proc, grant: { to: "self", effects: [{ stats: { str: 1 } }], ends: "turnEnd", ...more } });
  assert.ok(!wrong(grant({ wait: 1, lone: true })));
  assert.ok(wrong(grant({ wait: 0 })));
  assert.ok(wrong(grant({ lone: true })), "alone, without a turn to wait for");
  assert.ok(wrong(grant({ wait: 1, ends: "phaseEnd" })));
  assert.ok(wrong(grant({ spoils: "yes" })));
  assert.ok(wrong(grant({ mend: "much" })));
  assert.ok(!wrong(grant({ mend: { of: "hpMax", times: 0.2 } })));
  assert.ok(wrong(grant({ mend: { of: "taken" } })), "read from a hit, at a kill");
  assert.ok(!wrong(grant({ mend: { of: "taken" } }, { on: "struck", sure: true })));
  assert.ok(wrong(grant({ when: { equals: ["mag", "res"] } })));
  assert.ok(!wrong(grant({ when: { equal: ["mag", "res"] } })));
  assert.ok(wrong(grant({ once: "strikes" })));
  assert.ok(!wrong(grant({ once: "strike" })));

  // Stats that dice pick
  const random = (given) => ({ proc: { on: "hit", sure: true }, grant: { to: "self", random: given, ends: "turnEnd" } });
  assert.ok(!wrong(random({ stats: ["str", "mag"], pick: { dice: 2 }, amount: { dice: 5 } })));
  assert.ok(wrong(random({ stats: ["str", "luck"], amount: 2 })));
  assert.ok(wrong(random({ stats: ["str"], amount: 0 })));
  assert.ok(wrong(random({ stats: ["str"], amount: 2, pick: { die: 3 } })));
  assert.ok(wrong({ proc: { on: "hit", sure: true }, grant: { to: "self", effects: [{ stats: { str: 1 } }], random: { stats: ["str"], amount: 2 }, ends: "turnEnd" } }));

  // The first attack of a fight, what a unit pays, and what is kept for a later fight
  assert.ok(!wrong({ firstAttack: { hit: 20, critical: 15 } }));
  assert.ok(wrong({ firstAttack: { dodge: 20 } }));
  assert.ok(wrong({ firstAttack: { hit: 20 }, proc: { on: "hit", sure: true } }));
  assert.ok(!wrong({ proc: { on: "after", sure: true }, pays: 5, nonlethal: true }));
  assert.ok(wrong({ proc: { on: "hit", sure: true }, pays: 5 }));
  assert.ok(wrong({ proc: { on: "after", sure: true }, pays: 0 }));
  assert.ok(!wrong({ proc: { on: "dodged", stat: "dex" }, next: { hit: 20 }, keep: true }));
  assert.ok(wrong({ proc: { on: "dodged", stat: "dex" }, keep: true }), "nothing to keep");
  assert.ok(!wrong({ proc: { on: "struck", stat: "dex" }, negate: 45, nextOfNegated: { damage: 100 } }));
  assert.ok(wrong({ proc: { on: "struck", stat: "dex" }, nextOfNegated: { damage: 100 } }), "nothing is negated");
  assert.ok(wrong({ proc: { on: "hit", stat: "dex" }, negate: 45, nextOfNegated: { damage: 100 } }));

  // A share of maximum HP an attack would take, a skill being used, an aura given once a turn
  assert.ok(!wrong({ proc: { on: "attacked", sure: true, perHp: 25 }, combat: { dodge: 10, critAvoid: 5 } }));
  assert.ok(wrong({ proc: { on: "attacked", stat: "dex", perHp: 25 }, combat: { dodge: 10 } }));
  assert.ok(wrong({ proc: { on: "struck", sure: true, perHp: 25 }, negate: 10 }));
  assert.ok(wrong({ proc: { on: "start", sure: true }, combat: { critAvoid: 5 } }));
  const used = { proc: { on: "use", sure: true }, grant: { to: "self", hp: 10, effects: [], ends: "turnStart", turns: 3 } };
  assert.ok(!wrong(used));
  assert.ok(wrong({ ...used, grant: { ...used.grant, to: "foe" } }));
  assert.ok(wrong({ ...used, recover: 5 }));
  assert.ok(wrong({ proc: { on: "use", stat: "dex" }, grant: used.grant }));
  assert.ok(!wrong({ aura: { who: "ally", within: 2, once: "turn" }, endurance: 2 }));
  assert.ok(wrong({ aura: { who: "ally", within: 2, once: "map" }, endurance: 2 }));
  const giver = { proc: { on: "start", sure: true }, grant: { to: "giver", effects: [{ combat: { damage: 3 } }], ends: "turnEnd" } };
  assert.ok(wrong(giver), "only an aura has a giver");
  assert.ok(!wrong({ ...giver, aura: { who: "ally", within: 2 } }));
  assert.ok(wrong({ when: { declared: true, lasting: "no" }, combat: { hit: 1 } }));
  assert.ok(wrong({ when: { lasting: false }, combat: { hit: 1 } }), "beside declared");
});

/* -------------------------------------------- */
/*  Changes That Wait, Mend and Spoil           */
/* -------------------------------------------- */

test("a change that waits for a turn does nothing until that turn starts, and counts its turns from there", () => {
  const change = buildChange({ effects: [{ stats: { str: 5 } }], ends: "turnEnd", wait: 1, next: true }, { skill: "Hook", own: true, carrierInTurn: true });
  assert.equal(change.wait, 1);
  assert.equal(change.turns, 1, "the turn it is granted in is not one of its turns");
  assert.ok(isIdle(change));
  assert.deepEqual(timedEntries([change]), [], "no skill entry while it waits");

  // The end of the turn it was granted in does not count it; the start of the next begins it
  const ended = tickChanges([change], "turnEnd");
  assert.deepEqual(ended.list, [change]);
  assert.equal(ended.changed, false);
  const begun = tickChanges([change], "turnStart");
  assert.equal(begun.list[0].wait, undefined);
  assert.equal(timedEntries(begun.list).length, 1);
  assert.equal(tickChanges(begun.list, "turnEnd").list.length, 0, "over as that turn ends");
  assert.equal(changeLasts(change).key, "FEO.Timed.lasts.wait");
});

test("a waiting change stands beside one that has begun, and one that stands alone is not granted then", () => {
  const waiting = buildChange({ effects: [{ combat: { hit: 15 } }], ends: "turnEnd", wait: 1 }, { skill: "Synergy", own: true });
  const begun = tickChanges([waiting], "turnStart").list;
  const both = grantChange(begun, waiting).list;
  assert.equal(both.length, 2, "this turn's, and the next turn's");
  assert.equal(grantChange(both, waiting).list.length, 2, "the waiting one is renewed");
  const lone = buildChange({ effects: [{ statPercent: { str: 50 } }], ends: "turnEnd", wait: 1, lone: true }, { skill: "Hook", own: true });
  const active = tickChanges([lone], "turnStart").list;
  assert.equal(grantChange(active, lone).list.length, 1, "no Hook for the turn after");
  assert.equal(grantChange([lone], lone).list.length, 1);
});

test("a change restores HP as each turn of its unit starts, and one a second hit spoils restores none", () => {
  const mend = buildChange({ effects: [], mend: 8, ends: "turnStart", turns: 3, once: "struck" }, { skill: "Bloodthirst", own: true });
  assert.deepEqual(mendsOf([mend]), [{ name: "Bloodthirst", from: "", amount: 8 }]);
  assert.equal(tickChanges(tickChanges(tickChanges([mend], "turnStart").list, "turnStart").list, "turnStart").list.length, 0, "three turn starts");
  const first = buildChange({ effects: [], mend: 4, ends: "turnStart", spoils: true }, { skill: "Convalescence", own: true });
  const twice = grantChange([first], buildChange({ effects: [], mend: 9, ends: "turnStart", spoils: true }, { skill: "Convalescence", own: true })).list;
  assert.equal(twice.length, 1);
  assert.ok(twice[0].spoiled);
  assert.deepEqual(mendsOf(twice), []);
  assert.equal(grantChange(twice, first).list[0].spoiled, true, "a third hit begins nothing anew");
  assert.equal(tickChanges(twice, "turnStart").list.length, 0, "gone as the turn starts");
  assert.ok(cleanChange(twice[0], checkEffects).spoiled);
  assert.equal(cleanChange(mend, checkEffects).mend, 8);
  assert.equal(cleanChange({ ...mend, mend: -1 }, checkEffects), null);
});

test("a fight uses up a change that waits for an attack, or lasts until a hit, only when that came about", () => {
  const strike = buildChange({ effects: [{ firstAttack: { hit: 20 } }], ends: "map", once: "strike" }, { skill: "Iaido", own: true });
  const struck = buildChange({ effects: [], mend: 8, ends: "turnStart", turns: 3, once: "struck" }, { skill: "Bloodthirst", own: true });
  const list = [strike, struck];
  assert.equal(spendOnce(list, "fight", {}).list.length, 2, "attacked, without attacking or being hit");
  assert.deepEqual(spendOnce(list, "attack", { made: true }).ended, [strike]);
  assert.deepEqual(spendOnce(list, "fight", { struck: true }).ended, [struck]);
  assert.equal(spendOnce(list, "fight", { made: true, struck: true }).list.length, 0);
  assert.equal(spendOnce(list, null, { made: true, struck: true }).list.length, 2, "no attack was made at all");
  assert.equal(changeLasts(strike).key, "FEO.Timed.lasts.once.strike");
});

test("dice pick the stats of a change, how many and by how much", () => {
  // A die of 3 for how many, then for each a die for which and a die of 5 for how much
  const rolls = [100, 1, 100, 1, 1, 100, 50];
  let at = 0;
  const lottery = { stats: ["str", "mag", "def", "res", "dex", "spd"], pick: { dice: 3 }, amount: { dice: 5 } };
  const { effects, stats } = randomEffects(lottery, dieFrom(() => rolls[at++]));
  assert.deepEqual(stats, ["str", "mag", "spd"]);
  assert.deepEqual(effects, [{ stats: { str: 5, mag: 1, spd: 3 } }]);
  assert.equal(at, 7);
  assert.equal(randomDice(lottery), 7);
  assert.equal(randomDice({ stats: ["str", "mag"], pick: 1, amount: 2 }), 1);
  assert.deepEqual(randomEffects({ stats: ["str", "mag"], pick: 1, amount: 2 }, () => 2).effects, [{ stats: { mag: 2 } }]);
  assert.deepEqual(randomEffects({ stats: ["str", "mag"], pick: 5, amount: 2 }, () => 1).effects, [{ stats: { str: 2, mag: 2 } }], "no more than it lists");
});

test("a number of a change is read from what a skill took off a hit, or from what the hit dealt", () => {
  assert.deepEqual(resolveDealt([{ combat: { dodge: { of: "negated" } } }], { negated: 3, taken: 6 }), [{ combat: { dodge: 3 } }]);
  assert.equal(resolveDealt({ of: "taken", div: 2 }, { negated: 3, taken: 9 }), 4);
  assert.equal(resolveDealt({ of: "dealt", times: -1 }, 7), -7, "as before");
  assert.equal(resolveDealt({ of: "negated" }, 7), 0);
});

test("a change says what it leaves on its unit, and whether the unit is the better for it", () => {
  const claws = { name: "Sharpen Claws", effects: [{ firstMight: 5, firstAttack: { critical: 25 } }], ends: "map", once: "strike" };
  assert.deepEqual(changeParts(claws).map((part) => `${part.value} ${part.label}`), ["+5 FEO.Timed.first.might", "+25 FEO.Timed.first.critical"]);
  assert.equal(changeTone(claws), "up");
  assert.equal(changeTone({ effects: [], mend: 8 }), "up");
  assert.deepEqual(changeParts({ effects: [], mend: 8 }), [{ value: "+8", label: "FEO.Timed.mend" }]);
  const marked = { name: "Offensive Tactics", from: "A", effects: [{ when: { foeGiver: false }, foeCombat: { damage: 3 } }], ends: "phaseEnd" };
  assert.equal(changeTone(marked), "down", "its foes deal more to it");
  assert.deepEqual(changeParts(marked), [{ value: "+3", label: "FEO.Timed.foe.damage" }]);
  assert.equal(timedRows([{ name: usedName("Vindication"), effects: [], mark: true, ends: "phaseEnd" }, claws]).length, 1, "a mark is not shown");
});

/* -------------------------------------------- */
/*  A Bonus for the Rest of the Fight           */
/* -------------------------------------------- */

test("Executioner's Mindset gives +2 STR and DEX from the start of a fight its foe cannot answer, in the forecast too", () => {
  const plain = planExchange(A(), B(UNARMED));
  const plan = planExchange(A({ skills: [skill("Executioner's Mindset")] }), B(UNARMED));
  assert.equal(plan.initiator.unit.stats.str, 12);
  assert.equal(plan.initiator.damage, plain.initiator.damage + 2);
  assert.equal(plan.initiator.blows[0].damage, 11);
  assert.ok(plan.initiator.hit > plain.initiator.hit, "DEX is Hit");
  const { result } = play(A({ skills: [skill("Executioner's Mindset")] }), B(UNARMED), [1]);
  assert.deepEqual(dealt(result), [11]);
  const [left] = granted(result, "initiator");
  assert.deepEqual(left.effects, [{ stats: { str: 2, dex: 2 } }]);
  assert.equal(left.turns, 2, "until the end of its next turn");
  assert.ok(result.attacks[0].conditions.inflicted.some((entry) => entry.id === "bleed"));

  // Carried into a second fight of that kind it is set anew, not doubled
  const again = planExchange(carrying(A({ skills: [skill("Executioner's Mindset")] }), [left]), B(UNARMED));
  assert.equal(again.initiator.unit.stats.str, 12);

  // Against a foe that answers, or from 2 spaces, there is nothing
  assert.equal(planExchange(A({ skills: [skill("Executioner's Mindset")] }), B()).initiator.damage, plain.initiator.damage);
  assert.equal(play(A({ skills: [skill("Executioner's Mindset")] }), B(), [1]).result.granted, undefined);
});

/* -------------------------------------------- */
/*  A Bonus That Waits for the Next Attack      */
/* -------------------------------------------- */

test("Iaido adds 20 Hit and 15 Critical to the next attack of the fight in which its unit dodged", () => {
  // A misses, Iaido activates, and B's counter-attack has it
  const plain = play(A(), B(), [100, 1]).result;
  const { result } = play(A(), B({ skills: [skill("Iaido")] }), [100, 1, 1]);
  const counter = by(result, "defender")[0];
  assert.equal(counter.hitChance, Math.min(by(plain, "defender")[0].hitChance + 20, 100));
  assert.equal(counter.critChance, 15);
  assert.deepEqual(granted(result, "defender"), [], "spent in this fight");
});

test("Iaido that finds no attack in its fight waits for the next fight in which its unit attacks", () => {
  const dull = { hit: 60 };
  const { result } = play(A(), B({ ...UNARMED, skills: [skill("Iaido")] }), [100, 1]);
  const [kept] = granted(result, "defender");
  assert.equal(kept.once, "strike");
  assert.equal(kept.ends, "map");
  assert.deepEqual(kept.effects, [{ firstAttack: { hit: 20, critical: 15 } }]);

  // The forecast of the fight that will use it up counts it, for the first attack alone
  const before = planExchange(B({ stats: FAST, weapon: dull }), A());
  const after = planExchange(carrying(B({ stats: FAST, weapon: dull }), [kept]), A());
  assert.equal(after.initiator.hit, before.initiator.hit + 20);
  assert.equal(after.initiator.crit, before.initiator.crit + 15);
  assert.equal(after.initiator.blows[0].hit, before.initiator.blows[0].hit + 20);
  assert.equal(after.initiator.blows[1].hit, before.initiator.blows[1].hit, "the follow-up is as it was");
  assert.equal(after.initiator.blows[1].crit, before.initiator.blows[1].crit);
  assert.deepEqual(after.initiator.unit.fx.firstBy, ["Iaido"], "named in the sums");

  // And that fight uses it up: one in which the unit is only attacked does not
  const fight = playExchange(after, () => 50, () => null, {}).result;
  assert.equal(fight.initiator.made, 2);
  assert.equal(spendOnce(after.initiator.unit.timed, "attack", { made: fight.initiator.made > 0 }).list.length, 0);
  const attacked = play(A(), carrying(B(UNARMED), [kept]), [1]).result;
  assert.equal(attacked.defender.made, 0);
  assert.equal(spendOnce([kept], "fight", { made: attacked.defender.made > 0 }).list.length, 1);
});

test("Holy Vestments takes 45% off a hit and adds what it took off to the damage of the next attack", () => {
  // A hits for 9, of which 5 are taken off (4 are dealt); B's counter-attack deals 9 + 5
  const { result } = play(A(), B({ skills: [skill("Holy Vestments")] }), [1, 1, 1]);
  assert.deepEqual(dealt(result), [4]);
  assert.deepEqual(dealt(result, "defender"), [14]);
  assert.deepEqual(granted(result, "defender"), []);

  // With no attack left to make in that fight, the damage waits for a later one
  const waiting = play(A(), B({ ...UNARMED, skills: [skill("Holy Vestments")] }), [1, 1]).result;
  const [kept] = granted(waiting, "defender");
  assert.deepEqual(kept.effects, [{ firstAttack: { damage: 5 } }]);
  assert.equal(kept.once, "strike");
  const later = planExchange(carrying(B({ stats: FAST }), [kept]), A());
  assert.deepEqual(later.initiator.blows.map((blow) => blow.damage), [14, 9]);

  // A hit that deals no damage is not one it answers
  const armoured = play(A(), B({ stats: { def: 30 }, skills: [skill("Holy Vestments")] }), [1, 1]).result;
  assert.deepEqual(granted(armoured, "defender"), []);
});

test("Sharpen Claws adds 5 Might and 25 Critical to the first attack of the next fight its unit attacks in", () => {
  const self = { name: "Ghoul", uuid: "Actor.Ghoul", hp: 20, hpMax: 20, level: 5, stats: { dex: 6 }, weapon: null, near: null };
  const moment = turnMoment([skill("Sharpen Claws")], self, "turnStart", () => 1);
  const kept = moment.entries[0].granted[0].change;
  assert.equal(kept.once, "strike");
  assert.equal(kept.ends, "map");
  assert.equal(turnMoment([skill("Sharpen Claws")], self, "turnStart", () => 100).entries[0].success, false);

  const before = planExchange(A({ stats: FAST }), B());
  const after = planExchange(carrying(A({ stats: FAST }), [kept]), B());
  assert.deepEqual(after.initiator.blows.map((blow) => blow.damage), [before.initiator.blows[0].damage + 5, before.initiator.blows[1].damage]);
  assert.deepEqual(after.initiator.blows.map((blow) => blow.crit), [before.initiator.blows[0].crit + 25, before.initiator.blows[1].crit]);
  assert.equal(grantChange([kept], kept).list.length, 1, "it does not stack");

  // The attack is the first the unit makes in the fight, also where it is the one attacked
  const defending = planExchange(B(), carrying(A(), [kept]));
  assert.equal(defending.defender.blows[0].damage, 14);
});

/* -------------------------------------------- */
/*  A Bonus on the Next Turn, or for Turns      */
/* -------------------------------------------- */

test("Hook raises STR by half on the unit's next turn after a kill, and not on the turn after that", () => {
  const { result } = play(A({ skills: [skill("Hook")] }), B({ hp: 5 }), [1]);
  assert.ok(result.attacks[0].kill);
  const [hook] = granted(result, "initiator");
  assert.equal(hook.wait, 1);
  assert.ok(hook.lone);
  assert.equal(planExchange(carrying(A(), [hook]), B()).initiator.damage, 9, "nothing yet");
  const begun = tickChanges([hook], "turnStart").list;
  assert.equal(planExchange({ ...A(), timed: begun }, B()).initiator.damage, 14, "half of 10 STR more");
  assert.equal(grantChange(begun, hook).list.length, 1, "a kill on that turn earns nothing");
  assert.equal(tickChanges(begun, "turnEnd").list.length, 0);

  // A kill outside of a fight the system rolls counts as well
  assert.equal(play(A({ skills: [skill("Hook")] }), B(), [1]).result.granted, undefined, "no kill, no Hook");
});

test("Synergy adds MAG and RES to the damage, and where the two are equal +15 Hit and Dodge on the next turn", () => {
  const even = play(A({ stats: { mag: 4, res: 4 }, skills: [skill("Synergy")] }), B(UNARMED), [1, 1]).result;
  assert.deepEqual(dealt(even), [17], "9 + 4 + 4");
  const [boost] = granted(even, "initiator");
  assert.deepEqual(boost.effects, [{ combat: { hit: 15, dodge: 15 } }]);
  assert.equal(boost.wait, 1);
  assert.equal(boost.turns, 1);
  const odd = play(A({ stats: { mag: 4, res: 3 }, skills: [skill("Synergy")] }), B(UNARMED), [1, 1]).result;
  assert.deepEqual(dealt(odd), [16]);
  assert.deepEqual(granted(odd, "initiator"), []);
  assert.deepEqual(granted(play(A({ stats: { mag: 4, res: 4 }, skills: [skill("Synergy")] }), B(UNARMED), [100, 1]).result, "initiator"), [], "not activated");
});

test("Golden Lotus negates a third of a hit and turns what it negated into Dodge, at once and for two turns", () => {
  // A hits for 9: 3 are negated. Its follow-up is made against 3 more Dodge
  const { result } = play(A({ stats: FAST }), B({ skills: [skill("Golden Lotus")] }), [1, 1, 100, 1, 100]);
  const [first, second] = by(result, "initiator");
  assert.equal(first.damage, 6);
  assert.equal(second.hitChance, first.hitChance - 3);
  const [lotus] = granted(result, "defender");
  assert.deepEqual(lotus.effects, [{ combat: { dodge: 3 } }]);
  assert.equal(lotus.turns, 2);
  assert.ok(result.granted[0].now && result.granted[0].counted);

  // By hand, outside of a fight the system rolls, it is worked out the same way
  const struck = sufferDamage(unit({ skills: [skill("Golden Lotus")], stats: { dex: 6 } }), 9, { kind: "attack" }, () => 1);
  assert.equal(struck.dealt, 6);
  assert.deepEqual(struck.grants[0].effects, [{ combat: { dodge: 3 } }]);
});

test("Future Sight adds 10 Dodge and 5 Critical Avoid for each quarter of its HP an attack would take", () => {
  const keen = { weapon: { crit: 30 } };
  const seer = (hpMax) => B({ hp: hpMax, hpMax, skills: [skill("Future Sight")] });
  const plain = planExchange(A(keen), B({ hp: 20, hpMax: 20 }));

  // 9 damage is 45% of 20 HP: one quarter. Of 18 HP it is two, and of 40 HP none
  const one = planExchange(A(keen), seer(20));
  assert.equal(one.initiator.hit, plain.initiator.hit - 10);
  assert.equal(one.initiator.crit, plain.initiator.crit - 5);
  assert.deepEqual(one.initiator.foreseen, { dodge: 10, critAvoid: 5, skills: ["Future Sight"] });
  const two = planExchange(A(keen), seer(18));
  assert.equal(two.initiator.hit, plain.initiator.hit - 20);
  assert.equal(two.initiator.blows[0].crit, plain.initiator.crit - 10);
  const none = planExchange(A(keen), seer(40));
  assert.equal(none.initiator.hit, plain.initiator.hit);
  assert.equal(none.initiator.foreseen, undefined);

  // The fight rolls against the same numbers
  const fight = playExchange(one, () => 100, () => null, {}).result;
  assert.equal(fight.attacks[0].hitChance, one.initiator.hit);
  assert.equal(fight.attacks[0].critChance, one.initiator.crit);
  const calm = playExchange(none, () => 100, () => null, {}).result;
  assert.equal(calm.attacks[0].hitChance, plain.initiator.hit);
});

/* -------------------------------------------- */
/*  Healing Over the Turns to Come              */
/* -------------------------------------------- */

test("Bloodthirst restores a fifth of maximum HP at the start of the next three turns, or until its unit is hit", () => {
  const { result } = play(A({ skills: [skill("Bloodthirst")] }), B({ hp: 5 }), [1]);
  const [thirst] = granted(result, "initiator");
  assert.equal(thirst.mend, 8, "20% of 40");
  assert.equal(thirst.ends, "turnStart");
  assert.equal(thirst.turns, 3);
  assert.equal(thirst.once, "struck");
  assert.deepEqual(mendsOf([thirst]), [{ name: "Bloodthirst", from: "", amount: 8 }]);

  // A fight in which an attack lands on the unit ends it; one in which every attack misses does not
  const hit = play(B(), carrying(A(), [thirst]), [1]).result;
  assert.equal(hit.defender.struck, true);
  assert.equal(spendOnce([thirst], "fight", { struck: hit.defender.struck }).list.length, 0);
  const missed = play(B(), carrying(A(), [thirst]), [100]).result;
  assert.equal(spendOnce([thirst], "fight", { struck: missed.defender.struck }).list.length, 1);
  assert.equal(grantChange([{ ...thirst, turns: 1 }], thirst).list[0].turns, 3, "another kill starts the three turns anew");
});

test("Convalescence restores half the damage of the first hit of a turn, unless a second hit follows", () => {
  // One hit of 9: half of it, rounded down, as the next turn starts
  const once = play(A(), B({ skills: [skill("Convalescence")] }), [1]).result;
  const [rest] = granted(once, "defender");
  assert.equal(rest.mend, 4);
  assert.equal(rest.ends, "turnStart");
  assert.deepEqual(mendsOf([rest]), [{ name: "Convalescence", from: "", amount: 4 }]);

  // Two hits in one fight: the second spoils it
  const twice = play(A({ stats: FAST }), B({ skills: [skill("Convalescence")] }), [1, 100, 1]).result;
  const list = granted(twice, "defender").reduce((carried, change) => grantChange(carried, change).list, []);
  assert.equal(list.length, 1);
  assert.deepEqual(mendsOf(list), []);

  // So does a hit in a later fight of the same turn, and a hit that deals no damage changes nothing
  assert.deepEqual(mendsOf(grantChange([rest], granted(play(A(), B({ skills: [skill("Convalescence")] }), [1]).result, "defender")[0]).list), []);
  assert.deepEqual(granted(play(A(), B({ stats: { def: 30 }, skills: [skill("Convalescence")] }), [1]).result, "defender"), []);
  assert.deepEqual(granted(play(A(), B({ skills: [skill("Convalescence")] }), [100]).result, "defender"), [], "a miss");
});

/* -------------------------------------------- */
/*  What a Unit Pays                            */
/* -------------------------------------------- */

test("Fury adds 4 damage and 5 Critical, and costs 5 HP after the fight that cannot kill", () => {
  const { plan, result } = play(A({ skills: [skill("Fury", { active: true })] }), B(UNARMED), [1, 100]);
  assert.equal(plan.initiator.damage, 13);
  assert.equal(result.initiator.hp, 35);
  assert.deepEqual(result.paid, [{ skill: "Fury", by: "initiator", amount: 5, at: "after" }]);
  const weak = play(A({ hp: 3, skills: [skill("Fury", { active: true })] }), B(UNARMED), [1, 100]).result;
  assert.equal(weak.initiator.hp, 1);
  assert.equal(weak.paid[0].amount, 2);
  const off = play(A({ skills: [skill("Fury")] }), B(UNARMED), [1]).result;
  assert.equal(off.paid, undefined);
  assert.equal(off.initiator.hp, 40);
});

test("Bloodlust adds 3 to four stats at full HP and deals 5 to its unit afterwards, which can defeat it", () => {
  const full = play(A({ skills: [skill("Bloodlust")] }), B(UNARMED), [1]);
  assert.equal(full.plan.initiator.unit.stats.str, 13);
  assert.equal(full.result.initiator.hp, 35);
  assert.equal(full.result.paid[0].amount, 5);
  const hurt = play(A({ hp: 39, skills: [skill("Bloodlust")] }), B(UNARMED), [1]);
  assert.equal(hurt.plan.initiator.unit.stats.str, 10);
  assert.equal(hurt.result.paid, undefined);
  const frail = play(A({ hp: 4, hpMax: 4, skills: [skill("Bloodlust")] }), B(UNARMED), [1]).result;
  assert.equal(frail.initiator.hp, 0);
  assert.ok(frail.initiator.defeated);
});

test("Umbra halves its unit's HP as the fight it is used for begins, and not again while it lasts", () => {
  const umbra = skill("Umbra", { active: true });
  const { plan, result } = play(A({ hp: 21, skills: [umbra] }), B(UNARMED), [1]);
  assert.equal(result.initiator.hp, 11, "10 lost: half of 21, rounded down");
  assert.deepEqual(result.paid, [{ skill: "Umbra", by: "initiator", amount: 10, at: "start" }]);
  assert.equal(plan.initiator.damage, 14, "9 and 60% more");
  assert.equal(play(A({ hp: 1, skills: [umbra] }), B(UNARMED), [1]).result.initiator.hp, 1);

  // Still on in a later fight, for the turn it lasts: no further halving
  const lasting = { ...umbra, state: { ...umbra.state, lasting: 1 } };
  const later = play(A({ hp: 21, skills: [lasting] }), B(UNARMED), [1]);
  assert.equal(later.result.initiator.hp, 21);
  assert.equal(later.plan.initiator.damage, 14);
});

/* -------------------------------------------- */
/*  Temporary HP                                */
/* -------------------------------------------- */

test("Primal Fury lends a quarter of maximum HP, rounded up, as it is used, for its three turns", () => {
  const self = { name: "Barbarian", uuid: "Actor.Barbarian", hp: 30, hpMax: 37, level: 5, stats: {}, weapon: null, near: null };
  const used = useMoment(skill("Primal Fury"), self, () => 100);
  const [change] = used.entries.flatMap((entry) => entry.granted.map((given) => given.change));
  assert.equal(change.hp, 10, "37 / 4, rounded up");
  assert.equal(change.ends, "turnStart");
  assert.equal(change.turns, 3);
  assert.equal(change.name, "Primal Fury");
  assert.equal(turnMoment([skill("Primal Fury")], self, "turnStart", () => 100).entries.length, 0, "not at the start of a turn");
  assert.equal(cleanChange(change, checkEffects).hp, 10);
});

/* -------------------------------------------- */
/*  Stats That Dice Pick                        */
/* -------------------------------------------- */

test("Lottery boosts up to three of six stats by up to 5 each until the turn ends", () => {
  const self = { name: "Trickster", uuid: "Actor.Trickster", hp: 20, hpMax: 20, level: 5, stats: { luk: 10 }, weapon: null, near: null };
  const rolls = [10, 100, 1, 100, 1, 1, 100, 50];
  let at = 0;
  const moment = turnMoment([skill("Lottery")], self, "turnStart", () => rolls[at++]);
  assert.equal(moment.entries[0].success, true, "10 against 10 LUK");
  const change = moment.entries[0].granted[0].change;
  assert.deepEqual(change.effects, [{ stats: { str: 5, mag: 1, spd: 3 } }]);
  assert.equal(change.ends, "turnEnd");
  assert.equal(change.turns, 1);
  assert.equal(change.name, "Lottery");
  assert.equal(at, 8);
  const waiting = [{ effect: skill("Lottery").effects[0] }];
  assert.equal(momentDice(waiting), 8, "the roll to activate and seven dice");
  assert.equal(turnMoment([skill("Lottery")], self, "turnStart", () => 11).entries[0].granted, undefined);
});

test("Standardbearer gives each ally within 2 spaces +2 to a stat a die picks, as each attack lands", () => {
  const near = around("a", [ally("near", 1), ally("close", 2), ally("far", 3)]);
  const { result } = play({ ...A({ skills: [skill("Standardbearer")] }), near }, B(UNARMED), [1, 1, 100]);
  const given = result.granted.filter((entry) => entry.unit);
  assert.deepEqual(given.map((entry) => entry.unit), ["near", "close"]);
  assert.deepEqual(given.map((entry) => entry.change.effects), [[{ stats: { str: 2 } }], [{ stats: { res: 2 } }]]);
  assert.deepEqual(given.map((entry) => entry.change.name), ["Standardbearer (STR)", "Standardbearer (RES)"]);
  assert.ok(given.every((entry) => (entry.change.clock === "Actor.A") && (entry.change.turns === 2)), "until the end of its unit's next turn");

  // Another stat stands beside the first, and the same stat again is renewed
  const carried = grantChange(grantChange([], given[0].change).list, { ...given[1].change }).list;
  assert.equal(carried.length, 2);
  assert.equal(grantChange(carried, given[0].change).list.length, 2);
  assert.equal(play({ ...A({ skills: [skill("Standardbearer")] }), near }, B(UNARMED), [100]).result.granted, undefined, "a miss");
});

/* -------------------------------------------- */
/*  Between Allies                              */
/* -------------------------------------------- */

test("Hero's Blood adds 30% of SPD to the damage and gives the unit and every ally +4 ATK, END and SPD", () => {
  const near = around("a", [ally("near", 1), ally("far", 9)]);
  const { result } = play({ ...A({ stats: FAST, skills: [skill("Hero's Blood")] }), near }, B(), [1, 1, 100, 100, 1]);
  const [first, second] = by(result, "initiator");
  assert.equal(first.damage, 12, "9, and 30% of 13 SPD");
  assert.equal(second.damage, 13, "9 and 4 ATK, from the next attack on");
  assert.equal(by(result, "defender")[0].hitChance < 86, true, "SPD is Dodge too");
  const [mine] = granted(result, "initiator");
  assert.deepEqual(mine.effects, [{ combat: { damage: 4 }, endurance: 4, stats: { spd: 4 } }]);
  assert.equal(mine.turns, 2);
  const others = result.granted.filter((entry) => entry.unit);
  assert.deepEqual(others.map((entry) => entry.unit), ["near", "far"], "every ally on the map");
  assert.ok(others.every((entry) => entry.change.clock === "Actor.A"));
});

test("Vindication gives an ally that is attacked +2 END and its own unit +3 ATK, once a Phase", () => {
  const measure = (a, b) => Math.abs(a.tile.j - b.tile.j);
  const placed = (id, side, j, more = {}) => ({ id, name: id, side, tile: { i: 0, j }, hp: 20, hpMax: 20, stats: {}, skills: [], ...more });
  const knight = placed("knight", "player", 0, { skills: [skill("Vindication")] });
  const auras = standing([knight, placed("friend", "player", 2)], "friend", measure).auras;
  assert.equal(auras.length, 1);
  assert.equal(auras[0].limit, "turn");

  // An enemy starts a fight against the ally: 2 less from every hit, and the knight gains 3 damage
  const { plan, result } = play(A(), { ...B(), auras }, [1, 100]);
  assert.equal(plan.initiator.damage, 7);
  const given = result.granted.filter((entry) => entry.unit === "knight");
  assert.deepEqual(given.map((entry) => entry.change.name), ["Vindication", usedName("Vindication")]);
  assert.deepEqual(given[0].change.effects, [{ combat: { damage: 3 } }]);
  assert.equal(given[0].change.from, "", "its own change");
  assert.equal(given[0].change.ends, "turnEnd");
  assert.ok(given[1].change.mark);
  assert.equal(given[1].change.ends, "phaseEnd");

  // The ally starting a fight gains nothing, and the knight that carries the mark gives nothing more
  assert.equal(planExchange({ ...B(), auras }, A()).defender.damage, 9);
  assert.equal(play({ ...B(), auras }, A(), [1, 100]).result.granted, undefined);
  const spent = standing([{ ...knight, marks: [usedName("Vindication")] }, placed("friend", "player", 2)], "friend", measure).auras;
  assert.equal(spent.length, 0);
  assert.equal(standing([knight, placed("friend", "player", 3)], "friend", measure).auras.length, 0, "3 spaces is too far");
});

test("Offensive Tactics marks the enemy its unit attacked, and every other unit deals 3 more to it that Phase", () => {
  const { plan, result } = play(A({ skills: [skill("Offensive Tactics")] }), B(), [1, 100]);
  assert.equal(plan.initiator.damage, 12);
  const [mark] = granted(result, "defender");
  assert.equal(mark.name, "Offensive Tactics");
  assert.equal(mark.from, "A");
  assert.equal(mark.ends, "phaseEnd");

  // An ally attacks the marked enemy: 3 more. The unit itself gains nothing on top of its own 3
  const marked = carrying(B(), [mark]);
  assert.equal(planExchange(fighter({ name: "C", hp: 40, hpMax: 40, stats: { dex: 6 } }), marked).initiator.damage, 12);
  assert.equal(planExchange(A({ skills: [skill("Offensive Tactics")] }), marked).initiator.damage, 12);
  assert.equal(planExchange(marked, fighter({ name: "C", hp: 40, hpMax: 40, stats: { dex: 6 } })).defender.damage, 9, "not where the marked unit attacks");

  // When its unit is attacked, or its foe falls, nothing is left
  assert.deepEqual(granted(play(B(), A({ skills: [skill("Offensive Tactics")] }), [1, 1]).result, "initiator"), []);
  assert.equal(play(A({ skills: [skill("Offensive Tactics")] }), B({ hp: 5 }), [1]).result.granted, undefined);
});

/* -------------------------------------------- */
/*  Made-up Skills                              */
/* -------------------------------------------- */

test("what is kept for the next attack is not kept where the skill does not say so", () => {
  const eager = made("Eager", [{ proc: { on: "dodged", sure: true }, next: { hit: 10 } }]);
  assert.equal(play(A(), B({ ...UNARMED, skills: [eager] }), [100]).result.granted, undefined);
});

test("damage a unit pays for a skill is not taken by one that takes no damage from skills", () => {
  const cost = made("Cost", [{ proc: { on: "after", sure: true }, pays: 5 }, { rules: ["noSkillDamage"] }]);
  const { result } = play(A({ skills: [cost] }), B(UNARMED), [1]);
  assert.equal(result.initiator.hp, 40);
  assert.equal(result.paid, undefined);
});

/**
 * Tests for the turn clock and for what skills keep count of (`module/rules/clock.mjs`, `module/rules/timed.mjs`,
 * `module/rules/skills.mjs`, `module/rules/combat.mjs`, `module/rules/events.mjs`): conditions and numbers read
 * from the turn of the battle and the Phase that is running, limits that hold from fight to fight and from turn
 * to turn, tallies that grow by an amount, are read as a number, last between maps and reset, a critical hit a
 * skill makes sure, the least a chance of one is, and a unit no enemy can target.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkClock, clockFrom, clockHolds, needsClock, readClock, turnIs, withoutClock } from "../module/rules/clock.mjs";
import { planExchange, playExchange } from "../module/rules/combat.mjs";
import { conditionMoments, killMoments } from "../module/rules/events.mjs";
import { spendSkill, tickSkill, usesLeft } from "../module/rules/skill-usage.mjs";
import { checkEffects, readNumber, skillTotals, turnEffects, turnMoment, useMoment } from "../module/rules/skills.mjs";
import { changeLasts, changeParts, changeTone, skillCount, timedRows } from "../module/helpers/timed-context.mjs";
import {
  COUNT_MOST, buildChange, cleanChange, countedAt, grantChange, keptBetweenMaps, readsCount, resolveCount, skillCounts, tickChanges, timedEntries
} from "../module/rules/timed.mjs";
import { dice, fighter, made, skill, unit } from "./lib/fixtures.mjs";

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
const by = (result, side) => result.attacks.filter((attack) => attack.side === side);
const dealt = (result, side = "initiator") => by(result, side).map((attack) => attack.damage);
const granted = (result, to) => (result.granted ?? []).filter((entry) => entry.to === to).map((entry) => entry.change);
const carrying = (fighterUnit, changes) => ({ ...fighterUnit, timed: changes.reduce((list, change) => grantChange(list, change).list, fighterUnit.timed ?? []) });
const after = (fighterUnit, result, to) => granted(result, to).reduce((list, change) => grantChange(list, change).list, fighterUnit.timed ?? []);
const count = (list, name) => (list.find((change) => change.name === name)?.stacks ?? 0);

// The clock of a battle, and a unit in it
const at = (turn, phase = "player") => ({ turn, phase });
const on = (fighterUnit, clock) => ({ ...fighterUnit, clock });
const i18n = { localize: (key) => key, format: (key, data = {}) => `${key}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ""}` };

const STEP = ["Serenity", "Tempest", "Evened Out", "Better Odds", "Quick Burn", "Cold Rain", "Invincible", "Channel", "Sweep", "Shade", "Master Horseman",
  "Rancor", "Proud Fighter", "Bloody Glee", "Untouchable", "Executioner", "Curse Siphon", "Criticality", "First Blood"];

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

test("a typing mistake in what asks the clock or keeps count does not pass silently", () => {
  const wrong = (effect) => checkEffects([effect]).length > 0;
  assert.ok(!wrong({ when: { turn: "odd" }, might: 4 }));
  assert.ok(!wrong({ when: { turn: { min: 3 } }, might: 4 }));
  assert.ok(wrong({ when: { turn: "sometimes" }, might: 4 }));
  assert.ok(wrong({ when: { turn: { from: 3 } }, might: 4 }));
  assert.ok(wrong({ when: { turn: {} }, might: 4 }));
  assert.ok(!wrong({ when: { phase: ["enemy", "other"] }, rules: ["untargetable"] }));
  assert.ok(wrong({ when: { phase: ["foes"] }, rules: ["untargetable"] }));
  assert.ok(wrong({ rules: ["untouchable"] }));

  // A tally: what it grows by, what its effects read, how long it is kept, and what takes from it
  const tally = (more, proc = { on: "hit", sure: true }) => ({ proc, grant: { to: "self", effects: [{ combat: { damage: 1 } }], ends: "map", max: 5, ...more } });
  assert.ok(!wrong(tally({})));
  assert.ok(!wrong(tally({ ends: "never" })));
  assert.ok(wrong(tally({ ends: "always" })));
  assert.ok(!wrong(tally({ grows: 2 })));
  assert.ok(!wrong(tally({ grows: { of: "dealt" } })));
  assert.ok(wrong(tally({ grows: { of: "dealt" } }, { on: "kill", sure: true })), "no hit to read at a kill");
  assert.ok(wrong(tally({ grows: 0 })));
  assert.ok(wrong(tally({ grows: 2, max: undefined })), "what grows is a tally");
  assert.ok(wrong(tally({ max: COUNT_MOST + 1 })));
  assert.ok(!wrong(tally({ effects: [{ combat: { damage: { of: "count", div: 10 } } }] })));
  assert.ok(wrong(tally({ effects: [{ combat: { damage: { of: "count", div: 10 } } }], max: undefined })), "only a tally has a count");
  assert.ok(!wrong({ proc: { on: "crit", sure: true }, grant: { to: "self", drop: "all", now: true } }));
  assert.ok(wrong({ proc: { on: "crit", sure: true }, grant: { to: "self", drop: "all", ends: "map" } }));

  // The moment of an attack that is no critical hit, a critical hit that is sure, and a use given up
  assert.ok(!wrong(tally({}, { on: "noCrit", sure: true })));
  assert.ok(wrong(tally({}, { on: "noCrit", stat: "dex" })), "nothing is rolled for it");
  assert.ok(wrong({ proc: { on: "noCrit", sure: true }, recover: 5 }));
  assert.ok(!wrong({ proc: { on: "attack", sure: true, once: true }, sureHit: true, sureCrit: true }));
  assert.ok(wrong({ proc: { on: "hit", sure: true }, sureCrit: true }));
  assert.ok(wrong({ proc: { on: "attack", sure: true }, sureCrit: "yes" }));
  assert.ok(!wrong({ proc: { on: "struck", sure: true }, forfeit: true }));
  assert.ok(wrong({ proc: { on: "struck", stat: "dex" }, forfeit: true }));
  assert.ok(wrong({ proc: { on: "struck", sure: true }, forfeit: true, negate: 50 }));
  assert.ok(!wrong({ critFloor: 1 }));
  assert.ok(wrong({ critFloor: 0 }));
  assert.ok(wrong({ proc: { on: "start", sure: true }, critFloor: 1 }));

  // Regaining HP for inflicting a condition, not for suffering one
  assert.ok(!wrong({ proc: { on: "inflict", sure: true }, recover: { of: "hpMax", times: 0.1 } }));
  assert.ok(wrong({ proc: { on: "afflicted", sure: true }, recover: 5 }));
});

/* -------------------------------------------- */
/*  The Clock                                   */
/* -------------------------------------------- */

test("a battle has a clock once it has begun, and nothing else has", () => {
  assert.deepEqual(clockFrom({ started: true, round: 3, phase: "enemy" }), { turn: 3, phase: "enemy" });
  assert.equal(clockFrom({ started: false, round: 3, phase: "enemy" }), null);
  assert.equal(clockFrom({ started: true, round: 0, phase: "player" }), null);
  assert.equal(clockFrom(), null);
});

test("a turn is odd or even or within a span, and no turn is neither", () => {
  assert.ok(turnIs("odd", 1) && turnIs("odd", 7) && !turnIs("odd", 2));
  assert.ok(turnIs("even", 2) && !turnIs("even", 5));
  assert.ok(turnIs({ min: 3 }, 3) && !turnIs({ min: 3 }, 2) && turnIs({ max: 4 }, 4) && !turnIs({ min: 2, max: 4 }, 5));
  assert.ok(!turnIs("odd", 0) && !turnIs("even", 0));

  assert.ok(clockHolds({ turn: "even" }, at(4)));
  assert.ok(!clockHolds({ turn: "even" }, at(5)));
  assert.ok(!clockHolds({ turn: "even" }, null), "outside of a battle it holds for nobody");
  assert.ok(clockHolds({ phase: ["enemy", "other"] }, at(1, "enemy")));
  assert.ok(!clockHolds({ phase: ["enemy", "other"] }, at(1, "player")));
  assert.ok(clockHolds({ hp: { op: "full" } }, null), "what does not ask the clock needs none");
  assert.deepEqual(withoutClock({ turn: "odd", role: "initiating" }), { role: "initiating" });
  assert.equal(readClock("turn", at(6)), 6);
  assert.equal(readClock("turnsPast", at(6)), 5);
  assert.equal(readClock("turnsPast", null), 0);
  assert.ok(needsClock({ when: { turn: "odd" }, might: 4 }));
  assert.ok(needsClock({ combat: { hit: { of: "turnsPast", times: -1, plus: 15 } } }));
  assert.ok(!needsClock({ proc: { on: "turnEnd", sure: true }, grant: { to: "self", effects: [{ when: { phase: ["enemy"] }, rules: ["untargetable"] }], ends: "turnStart" } }),
    "what it grants is judged as it is carried");
  assert.deepEqual(checkClock({ turn: "odd", phase: "enemy" }, ["player", "enemy"]), []);
  assert.equal(checkClock({ phase: "enemy" }, ["player"]).length, 1);
});

test("a number can be held at a least as at a most", () => {
  const self = { clock: at(20), stats: {} };
  assert.equal(readNumber({ of: "turnsPast", times: -1, plus: 15, min: 0 }, self), 0);
  assert.equal(readNumber({ of: "turnsPast", times: -1, plus: 15, min: 0 }, { clock: at(4), stats: {} }), 12);
  assert.equal(readNumber({ of: "turn", max: 3 }, self), 3);
});

test("Serenity and Tempest add 4 Might on even and on odd turns", () => {
  const damage = (skills, clock) => planExchange(on(A({ skills }), clock), B()).initiator.blows[0].damage;
  assert.equal(damage([], at(2)), 9);
  assert.equal(damage([skill("Serenity")], at(2)), 13);
  assert.equal(damage([skill("Serenity")], at(3)), 9);
  assert.equal(damage([skill("Tempest")], at(3)), 13);
  assert.equal(damage([skill("Tempest")], at(2)), 9);

  // The bonus counts on either side of a fight, whoever's Phase it is
  assert.equal(planExchange(B(), on(A({ skills: [skill("Tempest")] }), at(1, "enemy"))).defender.blows[0].damage, 13);
});

test("outside of a battle a skill that asks the turn is named to check by hand, and nothing of it applies", () => {
  const blind = planExchange(A({ skills: [skill("Serenity"), skill("Better Odds"), skill("Quick Burn")] }), B()).initiator;
  assert.equal(blind.blows[0].damage, 9);
  assert.equal(blind.hit, 86);
  assert.deepEqual(blind.checks.map((entry) => entry.skill), ["Serenity", "Better Odds", "Quick Burn"]);
  const totals = skillTotals([skill("Evened Out")], { hp: 20, hpMax: 20, stats: {}, clock: null });
  assert.equal(totals.combat.dodge ?? 0, 0);
  assert.deepEqual(totals.checks, [{ skill: "Evened Out", unseen: false }]);
});

test("Better Odds adds 20 Hit and Critical on odd turns, Evened Out 20 Dodge and Critical Avoid on even ones", () => {
  // A weapon with 60 Hit and 30 Critical: 56 to hit and 30 to be a critical hit
  const keen = { weapon: { hit: 60, crit: 30 } };
  const plain = planExchange(on(A(keen), at(1)), B()).initiator;
  assert.deepEqual([plain.hit, plain.crit], [56, 30]);
  const odd = planExchange(on(A({ ...keen, skills: [skill("Better Odds")] }), at(1)), B()).initiator;
  assert.deepEqual([odd.hit, odd.crit], [76, 50]);
  const even = planExchange(on(A({ ...keen, skills: [skill("Better Odds")] }), at(2)), B()).initiator;
  assert.deepEqual([even.hit, even.crit], [56, 30]);

  const guarded = planExchange(on(A(keen), at(2)), on(B({ skills: [skill("Evened Out")] }), at(2))).initiator;
  assert.deepEqual([guarded.hit, guarded.crit], [36, 10]);
  const open = planExchange(on(A(keen), at(3)), on(B({ skills: [skill("Evened Out")] }), at(3))).initiator;
  assert.deepEqual([open.hit, open.crit], [56, 30]);
});

test("Quick Burn starts a map at +15 Hit and Dodge and loses 1 each turn", () => {
  const dull = { weapon: { hit: 60 } };
  const hit = (turn) => planExchange(on(A({ ...dull, skills: [skill("Quick Burn")] }), at(turn)), B()).initiator.hit;
  assert.equal(hit(1), 71);
  assert.equal(hit(2), 70);
  assert.equal(hit(6), 66);
  assert.equal(hit(16), 56);
  assert.equal(hit(40), 56, "never below nothing");

  // And the same Dodge for the unit that is attacked
  const dodged = (turn) => planExchange(on(A(dull), at(turn)), on(B({ skills: [skill("Quick Burn")] }), at(turn))).initiator.hit;
  assert.equal(dodged(1), 41);
  assert.equal(dodged(11), 51);
});

/* -------------------------------------------- */
/*  Limits From Fight to Fight                  */
/* -------------------------------------------- */

test("Cold Rain slows the first foe its unit hits each turn, and no other", () => {
  // Two hits in one fight: one change on the foe, one use spent
  const first = play(A({ stats: FAST, skills: [skill("Cold Rain")] }), B(), [], { rest: 1 });
  assert.equal(by(first.result, "initiator").length, 2);
  const slowed = granted(first.result, "defender");
  assert.equal(slowed.length, 1);
  assert.deepEqual(slowed[0].effects, [{ stats: { mov: -1, spd: -2 } }]);
  assert.equal(slowed[0].ends, "turnEnd");
  assert.deepEqual(first.result.initiator.spent.map((entry) => entry.name), ["Cold Rain"]);

  // A second fight in the same turn, with its use spent: nothing
  const second = play(A({ stats: FAST, skills: [skill("Cold Rain", { used: 1 })] }), B(), [], { rest: 1 });
  assert.deepEqual(granted(second.result, "defender"), []);
  assert.deepEqual(second.result.initiator.spent, []);

  // The use comes back as its unit's own turn starts
  const entry = skill("Cold Rain", { used: 1 });
  assert.equal(usesLeft(entry.usage, entry.state), 0);
  assert.equal(usesLeft(entry.usage, tickSkill(entry.usage, entry.state).state), 1);

  // A miss slows nobody and spends nothing
  const missed = play(A({ skills: [skill("Cold Rain")] }), B());
  assert.deepEqual(granted(missed.result, "defender"), []);
  assert.deepEqual(missed.result.initiator.spent, []);
});

test("Invincible is rolled as a turn starts, takes all damage off that turn, and rests the turn after", () => {
  // DEF 6: a chance of 3%
  const entry = skill("Invincible");
  const who = { name: "Wall", hp: 20, hpMax: 20, level: 5, stats: { def: 6 } };
  const failed = turnMoment([entry], who, "turnStart", dice(4));
  assert.equal(failed.entries[0].success, false);
  assert.equal(failed.entries[0].uses, undefined);
  const came = turnMoment([entry], who, "turnStart", dice(3));
  assert.equal(came.entries[0].success, true);
  assert.deepEqual(came.entries[0].uses, { id: entry.id, name: "Invincible" });
  const change = came.entries[0].granted[0].change;
  assert.deepEqual(change.effects, [{ takenPercent: -100 }]);
  assert.equal(change.ends, "turnStart");
  assert.equal(changeTone(change), "up");

  // No damage from an attack while it lasts, and it is over as the next turn starts
  assert.equal(planExchange(A(), carrying(B(), [change])).initiator.blows[0].damage, 0);
  assert.equal(tickChanges([change], "turnEnd").list.length, 1);
  assert.equal(tickChanges([change], "turnStart").list.length, 0);

  // Once it has taken effect it has no moment as the next turn starts, and has one again the turn after
  const spent = { ...entry, state: spendSkill(entry.usage, entry.state) };
  const next = { ...spent, state: tickSkill(spent.usage, spent.state).state };
  assert.equal(turnEffects([next], who, "turnStart").length, 0);
  assert.equal(turnMoment([next], who, "turnStart", dice()).entries.length, 0, "nothing is rolled");
  const later = { ...next, state: tickSkill(next.usage, next.state).state };
  assert.equal(turnEffects([later], who, "turnStart").length, 1);
});

test("Channel halves the first magical damage of a turn and adds it to its unit's next attack", () => {
  const tome = { category: "fire", damageStat: "mag", name: "Fire", range: "1-2" };

  // 5 Might + 4 MAG - 3 RES = 6: the first hit deals 3, the second 6; the counter-attack between them 9 + 3
  const mage = () => A({ stats: FAST, weapon: tome });
  const { plan, result } = play(mage(), B({ skills: [skill("Channel")] }), [], { rest: 1 });
  assert.deepEqual(plan.initiator.blows.map((blow) => blow.damage), [3, 6], "the forecast counts the one hit it halves");
  assert.deepEqual(plan.initiator.blows[0].eased, ["Channel"]);
  assert.deepEqual(dealt(result, "initiator"), [3, 6]);
  assert.deepEqual(dealt(result, "defender"), [12]);
  assert.deepEqual(result.defender.spent.map((entry) => entry.name), ["Channel"]);

  // Not against a sword, and not a second time in a turn
  assert.deepEqual(dealt(play(A({ stats: FAST }), B({ skills: [skill("Channel")] }), [], { rest: 1 }).result, "initiator"), [9, 9]);
  assert.deepEqual(dealt(play(mage(), B({ skills: [skill("Channel", { used: 1 })] }), [], { rest: 1 }).result, "initiator"), [6, 6]);

  // A unit that makes no attack in that fight keeps the bonus for its next one, on the same map
  const unarmed = play(mage(), B({ weapon: null, skills: [skill("Channel")] }), [], { rest: 1 });
  const kept = granted(unarmed.result, "defender");
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].effects, [{ firstAttack: { damage: 3 } }]);
  assert.equal(kept[0].once, "strike");
  assert.equal(planExchange(carrying(B(), kept), A()).initiator.blows[0].damage, 12);
});

test("First Blood makes the first attack of a map a hit and a critical hit, unless its unit is hit first", () => {
  // A critical hit deals three times the damage
  const eager = () => A({ stats: FAST, skills: [skill("First Blood")] });
  const { plan, result } = play(eager(), B({ hp: 60, hpMax: 60 }), [], { rest: 50 });
  assert.deepEqual([plan.initiator.hit, plan.initiator.crit], [100, 100]);
  const mine = by(result, "initiator");
  assert.ok(mine[0].hit && mine[0].crit);
  assert.equal(mine[0].damage, 27);
  assert.ok(mine[1].hit && !mine[1].crit, "the follow-up is an attack like any other");
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["First Blood"]);

  // Its use is gone for the rest of the map
  const spent = planExchange(A({ skills: [skill("First Blood", { used: 1 })] }), B()).initiator;
  assert.deepEqual([spent.hit, spent.crit], [86, 0]);

  // Attacked first and hit: the skill is given up, and its counter-attack is an attack like any other
  const hit = play(A(), B({ skills: [skill("First Blood")] }), [], { rest: 50 });
  const counter = by(hit.result, "defender")[0];
  assert.ok(counter.hit && !counter.crit);
  assert.equal(counter.damage, 9);
  assert.deepEqual(hit.result.defender.spent.map((entry) => entry.name), ["First Blood"]);

  // Attacked first and missed: its counter-attack is the first attack
  const missed = play(A(), B({ skills: [skill("First Blood")] }), [100], { rest: 50 });
  assert.equal(by(missed.result, "initiator")[0].hit, false);
  assert.ok(by(missed.result, "defender")[0].crit);

  // A foe that cannot be critically hit is hit all the same
  const safe = planExchange(eager(), B({ skills: [made("Guarded", [{ rules: ["foeNoCrit"] }])] })).initiator;
  assert.deepEqual([safe.hit, safe.crit], [100, 0]);
});

/* -------------------------------------------- */
/*  Into the Following Phases                   */
/* -------------------------------------------- */

test("Sweep takes the foe's counter-attack, and its unit's own until its next turn unless its stat is 4 higher", () => {
  const fire = skill("Sweep", { choice: "Firesweep" });
  const { plan, result } = play(A({ skills: [fire] }), B(), [], { rest: 1 });
  assert.equal(by(result, "defender").length, 0, "the foe makes no counter-attack");
  assert.ok(plan.defender.blocked);
  const debt = granted(result, "initiator");
  assert.equal(debt.length, 1);
  assert.equal(debt[0].ends, "turnStart");
  assert.equal(debt[0].turns, 1);
  assert.equal(changeParts(debt[0])[0].label, "FEO.Timed.rule.noCounterWeaker");

  // Attacked by a foe of its own STR: no counter-attack. With 4 more STR than the attacker it answers
  const even = planExchange(B(), carrying(A({ skills: [fire] }), debt));
  assert.equal(even.defender.blocked, "skill");
  const weaker = planExchange(B({ stats: { str: 7 } }), carrying(A({ skills: [fire] }), debt));
  assert.equal(weaker.defender.blocked, "skill", "3 more is not enough");
  const outdone = planExchange(B({ stats: { str: 6 } }), carrying(A({ skills: [fire] }), debt));
  assert.ok(!outdone.defender.blocked);

  // Windsweep goes by SPD; and its own attacks are as ever while the change lasts
  const wind = granted(play(A({ skills: [skill("Sweep", { choice: "Windsweep" })] }), B(), [], { rest: 1 }).result, "initiator");
  assert.deepEqual(wind[0].effects[0].when.compare, { left: "spd", right: "spd", margin: -3, reverse: true });
  assert.ok(!planExchange(carrying(A({ skills: [fire] }), debt), B()).initiator.blocked);

  // Attacked itself, it owes nothing afterwards; and the change is over as its next turn starts
  assert.deepEqual(granted(play(B(), A({ skills: [fire] }), [], { rest: 1 }).result, "defender"), []);
  assert.equal(tickChanges(debt, "turnStart").list.length, 0);
});

test("Shade keeps its unit from being targeted by enemies while another side has its Phase", () => {
  // DEX 8: a chance of 4%, rolled as its turn ends
  const who = { name: "Shadow", hp: 20, hpMax: 20, level: 5, stats: { dex: 8 } };
  assert.equal(turnMoment([skill("Shade")], who, "turnEnd", dice(5)).entries[0].success, false);
  const hidden = turnMoment([skill("Shade")], who, "turnEnd", dice(4)).entries[0].granted[0].change;
  assert.equal(hidden.ends, "turnStart");
  assert.equal(changeParts(hidden)[0].label, "FEO.Timed.rule.untargetable");
  assert.equal(changeTone(hidden), "up");

  const rules = (clock) => skillTotals(timedEntries([hidden]), { ...who, clock }).rules;
  assert.ok(rules(at(2, "enemy")).has("untargetable"));
  assert.ok(rules(at(2, "other")).has("untargetable"));
  assert.ok(!rules(at(2, "player")).has("untargetable"), "not while the players have their Phase");
  assert.ok(!rules(null).has("untargetable"), "nor outside of a battle");
  assert.equal(tickChanges([hidden], "turnStart").list.length, 0, "over as its next turn starts");
});

test("Master Horseman gives 3 MOV that shrink by 1 each turn, and does not add up", () => {
  const entry = skill("Master Horseman");
  const who = { name: "Rider", hp: 20, hpMax: 20, level: 5, stats: { mov: 7 } };
  const used = useMoment(entry, who, dice()).entries[0].granted[0].change;
  assert.equal(used.stacks, 3);
  assert.ok(used.fades);
  const mov = (list) => skillTotals(timedEntries(list), who).stats.mov ?? 0;
  let list = grantChange([], used).list;
  assert.equal(mov(list), 3);
  list = tickChanges(list, "turnEnd").list;
  assert.equal(mov(list), 2);

  // Used again while it lasts: back to 3, not 5
  assert.equal(mov(grantChange(list, used).list), 3);
  list = tickChanges(list, "turnEnd").list;
  assert.equal(mov(list), 1);
  assert.equal(tickChanges(list, "turnEnd").list.length, 0);
  assert.deepEqual(entry.usage.uses, 2);
});

/* -------------------------------------------- */
/*  Tallies                                     */
/* -------------------------------------------- */

test("a tally grows by what it is told to, starts at that much, and is read as a number by its effects", () => {
  const grant = { effects: [{ combat: { damage: { of: "count", div: 10 } } }], ends: "map", max: 50 };
  const first = buildChange({ ...grant, grows: 18 }, { skill: "Tally", own: true });
  assert.equal(first.stacks, 18);
  let list = grantChange([], first).list;
  assert.equal(list[0].grows, undefined, "what it grows by is not kept");
  list = grantChange(list, buildChange({ ...grant, grows: 9 }, { skill: "Tally", own: true })).list;
  assert.equal(list[0].stacks, 27);
  list = grantChange(list, buildChange({ ...grant, grows: 40 }, { skill: "Tally", own: true })).list;
  assert.equal(list[0].stacks, 50, "held at the most it counts to");

  // Its effects read the count, and are not multiplied by it as well
  assert.ok(readsCount(grant.effects));
  assert.deepEqual(timedEntries(list)[0].effects, [{ combat: { damage: 5 } }]);
  assert.deepEqual(resolveCount({ stats: { str: { of: "count", per: 3, times: 2, plus: 1, max: 6 } } }, 10), { stats: { str: 6 } });
  assert.deepEqual(resolveCount({ stats: { str: { of: "count", times: -1, min: -4 } } }, 10), { stats: { str: -4 } });

  // One whose effects do not read it is multiplied by it, as before
  const plain = buildChange({ effects: [{ stats: { def: 1 } }], ends: "map", max: 10 }, { skill: "Plain", own: true });
  const twice = grantChange(grantChange([], plain).list, plain).list;
  assert.deepEqual(timedEntries(twice)[0].effects, [{ stats: { def: 1 }, scale: 2 }]);

  // What grows passes the check that guards what is saved, and nonsense does not
  const check = (effects) => checkEffects(effects);
  assert.equal(cleanChange({ ...first }, check).grows, 18);
  assert.equal(cleanChange({ ...first, grows: 0 }, check), null);
  assert.equal(cleanChange({ ...first, stacks: COUNT_MOST + 1 }, check), null);
  assert.equal(cleanChange({ ...first, ends: "never" }, check).ends, "never");
});

test("a tally that lasts between maps is kept as a battle begins, and emptied however much it holds", () => {
  const grant = { effects: [{ combat: { critical: 1 } }], ends: "never", max: 999 };
  const kept = buildChange(grant, { skill: "Criticality", own: true });
  assert.equal(kept.turns, 0);
  const map = buildChange({ effects: [{ stats: { str: 1 } }], ends: "map", max: 10 }, { skill: "Executioner", own: true });
  const turn = buildChange({ effects: [{ stats: { str: 1 } }], ends: "turnEnd" }, { skill: "Hook", own: true });
  assert.deepEqual(keptBetweenMaps([kept, map, turn]).map((change) => change.name), ["Criticality"]);
  assert.equal(changeLasts(kept).key, "FEO.Timed.lasts.never");

  // No moment of a turn touches it
  const full = [{ ...kept, stacks: 500 }];
  for ( const moment of ["turnStart", "turnEnd", "phaseEnd"] ) assert.equal(tickChanges(full, moment).list[0].stacks, 500);
  const drop = buildChange({ drop: "all" }, { skill: "Criticality", own: true });
  assert.equal(grantChange(full, drop).list.length, 0);
  assert.ok(cleanChange(drop, checkEffects), "what empties it passes the check that guards what is saved");
});

test("Rancor counts the damage its unit deals through a turn and turns it into damage for the next", () => {
  // Two hits of 9
  const { result } = play(A({ stats: FAST, skills: [skill("Rancor")] }), B(), [], { rest: 1 });
  let list = after(A(), result, "initiator");
  assert.equal(list.length, 1);
  assert.equal(list[0].stacks, 18);
  assert.equal(list[0].wait, 1);
  assert.deepEqual(timedEntries(list), [], "it gives nothing while it counts");
  assert.equal(skillCounts(list).Rancor.count, 18);
  assert.ok(skillCounts(list).Rancor.waits);

  // What it deals in another fight of the same turn is added, as a counter-attack is: 9 more
  const again = play(B(), carrying(A({ skills: [skill("Rancor")] }), list), [], { rest: 1 });
  list = after({ timed: list }, again.result, "defender");
  assert.equal(list.length, 1);
  assert.equal(list[0].stacks, 27);
  assert.equal(list[0].wait, 1, "it goes on waiting as it grows");

  // A miss, and a hit that deals nothing, count nothing
  assert.deepEqual(granted(play(A({ skills: [skill("Rancor")] }), B()).result, "initiator"), []);
  assert.deepEqual(granted(play(A({ skills: [skill("Rancor")] }), B({ stats: { def: 30 } }), [], { rest: 1 }).result, "initiator"), []);

  // As its next turn starts the count becomes +1 damage for every 10, for that turn
  list = tickChanges(list, "turnStart").list;
  assert.deepEqual(timedEntries(list)[0].effects, [{ combat: { damage: 2 } }]);
  assert.equal(planExchange(carrying(A(), list), B()).initiator.blows[0].damage, 11);

  // Meanwhile a new count runs beside it, which is the one the skill shows
  const next = play(carrying(A({ skills: [skill("Rancor")] }), list), B(), [], { rest: 1 });
  const both = after({ timed: list }, next.result, "initiator");
  assert.equal(both.length, 2);
  assert.equal(skillCounts(both).Rancor.count, 11);
  assert.ok(skillCounts(both).Rancor.waits);
  assert.equal(tickChanges(both, "turnEnd").list.length, 1, "the bonus is over as that turn ends");

  // 50 damage or more is +5, and no more
  const most = grantChange([], buildChange({ ...skill("Rancor").effects[0].grant, grows: 80 }, { skill: "Rancor", own: true })).list;
  assert.deepEqual(timedEntries(tickChanges(most, "turnStart").list)[0].effects, [{ combat: { damage: 5 } }]);
});

test("Proud Fighter adds 2 STR for each fight its unit starts, up to 10, until a turn without one", () => {
  const proud = () => A({ skills: [skill("Proud Fighter")] });
  const { plan, result } = play(proud(), B(), [], { rest: 1 });
  assert.equal(plan.initiator.blows[0].damage, 11, "the forecast counts it from the first attack");
  assert.equal(dealt(result)[0], 11);
  let list = after(proud(), result, "initiator");
  assert.equal(count(list, "Proud Fighter"), 1);
  assert.equal(list[0].turns, 2, "this turn and the next");

  // A second fight it starts: 4 STR in all
  const second = play(carrying(proud(), list), B(), [], { rest: 1 });
  assert.equal(dealt(second.result)[0], 13);
  list = after({ timed: list }, second.result, "initiator");
  assert.equal(count(list, "Proud Fighter"), 2);

  // Attacked, it gains nothing, and fights with what it has
  const attacked = play(B(), carrying(proud(), list), [], { rest: 1 });
  assert.deepEqual(granted(attacked.result, "defender"), []);
  assert.equal(dealt(attacked.result, "defender")[0], 13);

  // No more than five times over
  let full = list;
  for ( let n = 0; n < 6; n++ ) full = grantChange(full, list[0]).list;
  assert.equal(count(full, "Proud Fighter"), 5);

  // The end of the turn it fought in leaves it; the end of a turn in which it started no fight ends it; a
  // fight in that turn keeps it
  const one = tickChanges(list, "turnEnd").list;
  assert.equal(count(one, "Proud Fighter"), 2);
  assert.equal(tickChanges(one, "turnEnd").list.length, 0);
  const renewed = after({ timed: one }, play(carrying(proud(), one), B(), [], { rest: 1 }).result, "initiator");
  assert.equal(count(renewed, "Proud Fighter"), 3);
  assert.equal(tickChanges(renewed, "turnEnd").list.length, 1);
});

test("Bloody Glee adds 1 damage and 5 Critical for each kill, and is emptied by a critical hit", () => {
  // A kill in a fight, and one by other means
  const glee = () => A({ skills: [skill("Bloody Glee")] });
  const killed = play(glee(), B({ hp: 5 }), [], { rest: 1 });
  let list = after(glee(), killed.result, "initiator");
  assert.equal(count(list, "Bloody Glee"), 1);
  assert.equal(list[0].ends, "map");
  const foe = unit({ name: "Foe", hp: 0 });
  const other = killMoments(unit({ skills: [skill("Bloody Glee")], inTurn: true }), foe, dice());
  list = grantChange(list, other.grants[0]).list;
  assert.equal(count(list, "Bloody Glee"), 2);

  // +2 damage, and 10 Critical where there was none
  const bonus = planExchange(carrying(glee(), list), B()).initiator;
  assert.equal(bonus.blows[0].damage, 11);
  assert.equal(bonus.crit, 10);

  // A critical hit empties it; the hit itself still has the bonus
  const crit = play(carrying(glee(), list), B({ hp: 80, hpMax: 80 }), [1, 1], { rest: 100 });
  assert.ok(by(crit.result, "initiator")[0].crit);
  assert.equal(by(crit.result, "initiator")[0].damage, 33);
  assert.deepEqual(after({ timed: list }, crit.result, "initiator"), []);

  // A critical hit that kills empties it first and is then counted
  const both = play(carrying(glee(), list), B({ hp: 20 }), [1, 1], { rest: 100 });
  assert.equal(count(after({ timed: list }, both.result, "initiator"), "Bloody Glee"), 1);
});

test("Executioner adds 1 to six stats for each kill, ten times at most, for the rest of the map", () => {
  const grim = () => A({ skills: [skill("Executioner")] });
  const killed = play(grim(), B({ hp: 5 }), [], { rest: 1 });
  let list = after(grim(), killed.result, "initiator");
  assert.equal(count(list, "Executioner"), 1);
  assert.equal(list[0].ends, "map");
  assert.deepEqual(Object.keys(list[0].effects[0].stats).sort(), ["def", "dex", "mag", "res", "spd", "str"]);
  for ( let n = 0; n < 12; n++ ) list = grantChange(list, list[0]).list;
  assert.equal(count(list, "Executioner"), 10);
  assert.deepEqual(keptBetweenMaps(list), [], "it is over with the battle");

  // 10 STR more: 19 damage; and 10 DEF more for what it takes
  assert.equal(planExchange(carrying(grim(), list), B()).initiator.blows[0].damage, 19);
  assert.equal(planExchange(B(), carrying(grim(), list)).initiator.blows[0].damage, 0);

  // A fight that kills nobody counts nothing
  assert.deepEqual(granted(play(grim(), B(), [], { rest: 1 }).result, "initiator"), []);
});

test("Untouchable adds 5 Hit and Critical for each attack dodged, up to 30, and is emptied by a hit", () => {
  // The attack misses: the counter-attack already has +5 Hit
  const nimble = () => B({ skills: [skill("Untouchable")] });
  const dodged = play(A(), nimble(), [100, 1], { rest: 1 });
  assert.equal(by(dodged.result, "initiator")[0].hit, false);
  assert.equal(by(dodged.result, "defender")[0].hitChance, 91);
  let list = after(nimble(), dodged.result, "defender");
  assert.equal(count(list, "Untouchable"), 1);
  assert.equal(list[0].ends, "map");

  // Six times over at most: +30 Hit and Critical
  for ( let n = 0; n < 8; n++ ) list = grantChange(list, list[0]).list;
  assert.equal(count(list, "Untouchable"), 6);
  const sharp = planExchange(carrying(nimble(), list), A()).initiator;
  assert.deepEqual([sharp.hit, sharp.crit], [100, 30]);

  // A hit empties it, from the unit's next attack of that fight on
  const struck = play(A(), carrying(nimble(), list), [1], { rest: 50 });
  assert.ok(by(struck.result, "initiator")[0].hit);
  assert.equal(by(struck.result, "defender")[0].hitChance, 86);
  assert.deepEqual(after({ timed: list }, struck.result, "defender"), []);
});

test("Curse Siphon heals for a tenth of maximum HP and adds 5 Skill Activation for each condition inflicted", () => {
  const giver = unit({ name: "Shaman", hp: 10, hpMax: 23, skills: [skill("Curse Siphon")], inTurn: true });
  const target = unit({ name: "Foe" });
  const cursed = conditionMoments({ giver, target, inflicted: { id: "poison", turns: 3 } });
  assert.equal(cursed.recover, 2);
  assert.equal(cursed.grants.length, 1);
  const change = cursed.grants[0].change;
  assert.equal(cursed.grants[0].to, "giver");
  assert.deepEqual(change.effects, [{ combat: { activation: 5 } }]);
  assert.equal(change.turns, 3, "the turn it is inflicted in, and two more");

  // Four times over at most: +20
  let list = [];
  for ( let n = 0; n < 6; n++ ) list = grantChange(list, change).list;
  assert.equal(count(list, "Curse Siphon"), 4);
  assert.equal(skillTotals(timedEntries(list), { hp: 20, hpMax: 20, stats: {} }).combat.activation, 20);

  // Two turns without a condition end it; one inflicted in between keeps it
  let waning = tickChanges(list, "turnEnd").list;
  waning = tickChanges(waning, "turnEnd").list;
  assert.equal(count(waning, "Curse Siphon"), 4);
  assert.equal(grantChange(waning, change).list[0].turns, 3);
  assert.equal(tickChanges(waning, "turnEnd").list.length, 0);

  // Inflicted while another side has its Phase: its own next two turns
  const answering = conditionMoments({ giver: { ...giver, inTurn: false }, target, inflicted: { id: "poison", turns: 3 } });
  assert.equal(answering.grants[0].change.turns, 2);

  // In a fight the system rolls it heals as the condition comes
  const venom = made("Venom", [{ proc: { on: "hit", sure: true }, inflicts: ["poison"] }]);
  const fought = play(A({ hp: 20, hpMax: 40, skills: [venom, skill("Curse Siphon")] }), B(), [], { rest: 1 });
  assert.equal(fought.result.initiator.healed, 4);
  assert.equal(count(after(A(), fought.result, "initiator"), "Curse Siphon"), 1);
});

test("Criticality keeps a chance of 1% to be critical, and gains 1 Critical for every attack that is not", () => {
  // No Critical to speak of: 1% all the same, but not against a foe that cannot be critically hit
  const patient = () => A({ skills: [skill("Criticality")] });
  assert.equal(planExchange(A(), B()).initiator.crit, 0);
  assert.equal(planExchange(patient(), B()).initiator.crit, 1);
  assert.equal(planExchange(patient(), B({ skills: [made("Guarded", [{ rules: ["foeNoCrit"] }])] })).initiator.crit, 0);

  // A miss and a hit that is no critical hit each count, from the next attack on, and are kept between maps
  const { result } = play(A({ stats: FAST, skills: [skill("Criticality")] }), B(), [100, 1, 1, 50], { rest: 100 });
  const mine = by(result, "initiator");
  assert.equal(mine.length, 2);
  assert.ok(!mine[0].hit && mine[1].hit && !mine[1].crit);
  let list = after(patient(), result, "initiator");
  assert.equal(count(list, "Criticality"), 2);
  assert.equal(list[0].ends, "never");
  assert.equal(keptBetweenMaps(list).length, 1);

  // Carried into a fight it is that much Critical; and it has no limit to speak of
  for ( let n = 0; n < 40; n++ ) list = grantChange(list, list[0]).list;
  assert.equal(count(list, "Criticality"), 42);
  assert.equal(planExchange(carrying(patient(), list), B()).initiator.crit, 42);

  // A critical hit dispels all of it
  const crit = play(carrying(patient(), list), B({ hp: 80, hpMax: 80 }), [1, 1], { rest: 100 });
  assert.ok(by(crit.result, "initiator")[0].crit);
  assert.deepEqual(after({ timed: list }, crit.result, "initiator"), []);
});

test("what counts at once in a fight is counted in the order it came", () => {
  // Hit and no critical hit: the count grows; the next attack is a critical hit: it is emptied, and what the
  // attack after that fails to be is counted anew
  const patient = A({ stats: FAST, skills: [skill("Criticality")], weapon: { crit: 40 } });
  const { result } = play(patient, B({ hp: 200, hpMax: 200 }), [1, 100, 100, 1, 1], { rest: 100 });
  const mine = by(result, "initiator");
  assert.ok(mine[0].hit && !mine[0].crit);
  assert.equal(mine[0].critChance, 40);
  assert.equal(mine[1].critChance, 41, "the first attack that was no critical hit counts for the second");
  assert.ok(mine[1].crit);
  assert.deepEqual(after(patient, result, "initiator"), []);
});

/* -------------------------------------------- */
/*  Shown on the Skill                          */
/* -------------------------------------------- */

test("the count a skill keeps is shown on it, with what it counts and what it gives", () => {
  const glee = skill("Bloody Glee");
  const tally = buildChange(glee.effects[0].grant, { skill: "Bloody Glee", own: true });
  let list = [];
  for ( let n = 0; n < 3; n++ ) list = grantChange(list, tally).list;
  assert.deepEqual(countedAt(glee.effects, "Bloody Glee"), { on: "kill", dealt: false });
  const shown = skillCount(glee, skillCounts(list), i18n);
  assert.equal(shown.value, 3);
  assert.equal(shown.most, null, "a count without a limit to speak of names none");
  assert.match(shown.tip, /^Bloody Glee · FEO\.Timed\.count\.of\.kill \{"count":3\} · \+3 .*\+15 .*FEO\.Timed\.lasts\.map/);
  assert.equal(skillCount(skill("Serenity"), skillCounts(list), i18n), null);
  assert.equal(skillCount(glee, skillCounts([]), i18n), null, "nothing to show while it holds nothing");

  // One that counts to a limit names it; one that counts damage says so
  const grim = skill("Executioner");
  const kills = grantChange([], buildChange(grim.effects[0].grant, { skill: "Executioner", own: true })).list;
  assert.equal(skillCount(grim, skillCounts(kills), i18n).most, 10);
  const rancor = skill("Rancor");
  assert.deepEqual(countedAt(rancor.effects, "Rancor"), { on: "hit", dealt: true });
  const running = grantChange([], buildChange({ ...rancor.effects[0].grant, grows: 23 }, { skill: "Rancor", own: true })).list;
  const told = skillCount(rancor, skillCounts(running), i18n);
  assert.equal(told.value, 23);
  assert.match(told.tip, /count\.of\.dealt \{"count":23\} · \+2 .*FEO\.Timed\.lasts\.wait/);

  // A change another unit left, a mark and a change that does not grow are no count of the unit's skills
  const foreign = { ...tally, from: "Bard" };
  const plain = buildChange({ effects: [{ stats: { str: 2 } }], ends: "turnEnd" }, { skill: "Hook", own: true });
  assert.deepEqual(skillCounts([foreign, plain, { ...tally, mark: true }]), {});

  // The rows of the sheet tell what a tally holds, and what an effect that reads the count comes to
  assert.equal(timedRows(list)[0].count, 3);
  assert.equal(timedRows([plain])[0].count, null);
  assert.deepEqual(changeParts(tickChanges(running, "turnStart").list[0]).map((part) => part.value), ["+2"]);
});

/**
 * Tests for `module/rules/acting.mjs` and what Step 8 gave the turn order and the skills: the go a unit earns
 * beyond the first of its turn, which moments earn it, what it comes with, how often, and what a skill takes
 * in return.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACT_MOMENTS, actGrant, actionDice, actionEffects, actionGrants, checkActionMoment, checkActs, followsAction, goFor, pickGo,
  spendGo, spentGoes, starsEntry, usedUp, walkOn
} from "../module/rules/acting.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { killMoments } from "../module/rules/events.mjs";
import { starChance } from "../module/rules/optional.mjs";
import { canUse, spendSkill, tickSkill } from "../module/rules/skill-usage.mjs";
import { chanceOf, checkEffects, holds, skillTotals, turnMoment } from "../module/rules/skills.mjs";
import { tickChanges, timedEntries } from "../module/rules/timed.mjs";
import { dice, fighter, made, skill, unit } from "./lib/fixtures.mjs";

const STEP = ["Galeforce", "Onrush", "Encore", "Flurry", "Powerstaff", "Action Surge", "Re-Move", "Hustle"];

/** The Actions the system has a unit take. */
const attack = { kind: "attack" };
const staff = { kind: "staff" };
const item = { kind: "item" };
const wait = { kind: "wait" };

/** The leave to act again that a skill of the step gives. */
const grantOf = (name) => actGrant(name, skill(name).effects.find((effect) => effect.acts).acts);

/** A unit as its skills are asked about it outside of a fight. */
const self = (stats = {}) => ({ hp: 20, hpMax: 20, level: 5, stats: { luk: 5, ...stats }, conditions: {}, qualities: "" });

/** The effects that wait for an Action, for a unit with these skills. */
const waitingFor = (skills, action, used = {}) => actionEffects(skills, action, { used, holds: (when) => holds(when, self(), null) });

/** Roll out a fight in which every die comes up as told. */
function fight(initiator, defender, roll) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  return resolveExchange(plan, () => roll);
}

/** A unit that fells whatever it attacks, and one that falls to the first hit. */
const slayer = (skills, more = {}) => fighter({ name: "A", hp: 40, hpMax: 40, skills, stats: { str: 30, spd: 20 }, ...more });
const victim = (more = {}) => fighter({ name: "B", hp: 5, hpMax: 20, stats: { def: 0 }, ...more });

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of STEP ) {
    const entry = skill(name);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.ok(entry.effects.some((effect) => effect.acts), `${name} earns another go`);
  }
});

test("a typing mistake in an acts part does not pass silently", () => {
  const kill = { on: "kill", sure: true };
  assert.deepEqual(checkActs({ mov: "full", once: "turn" }, kill), []);
  assert.deepEqual(checkActs({}, kill), []);
  assert.deepEqual(checkActs({ mov: "none", bars: ["attack"] }, kill), []);
  assert.equal(checkActs({ mov: "half" }, kill).length, 1);
  assert.equal(checkActs({ once: "ever" }, kill).length, 1);
  assert.equal(checkActs({ bars: ["atack"] }, kill).length, 1);
  assert.equal(checkActs({ bars: [] }, kill).length, 1);
  assert.equal(checkActs({ gives: "turn" }, kill).length, 1);
  assert.equal(checkActs({ mov: "full" }, { on: "struck", sure: true }).length, 1, "not when struck");
  assert.equal(checkActs({ mov: "full" }, null).length, 1, "another go waits for a moment");
  for ( const on of ACT_MOMENTS ) assert.deepEqual(checkActs({ mov: "full" }, { on, sure: true }), [], on);

  assert.deepEqual(checkActionMoment({ on: "action", sure: true, after: ["staff"] }), []);
  assert.deepEqual(checkActionMoment({ on: "action", stat: "luk", stars: true }), []);
  assert.equal(checkActionMoment({ on: "kill", sure: true, after: ["staff"] }).length, 1);
  assert.equal(checkActionMoment({ on: "action", sure: true, after: ["stave"] }).length, 1);
  assert.equal(checkActionMoment({ on: "action", sure: true, stars: true }).length, 1, "nothing to add stars to");

  // In an effect: at a moment, for the skill's own unit, and an Action taken earns a go and nothing else
  const problems = (effect) => checkEffects([effect]);
  assert.deepEqual(problems({ proc: { on: "action", sure: true }, acts: { mov: "left" } }), []);
  assert.ok(problems({ acts: { mov: "full" } }).length, "always there");
  assert.ok(problems({ proc: { on: "action", sure: true } }).length, "an Action taken that earns nothing");
  assert.ok(problems({ proc: { on: "action", sure: true }, acts: {}, recover: 5 }).length);
  assert.ok(problems({ proc: { on: "action", sure: true }, acts: {}, when: { role: "initiating" } }).length);
  assert.ok(problems({ proc: { on: "kill", sure: true }, acts: {}, aura: { who: "ally", within: 2 } }).length);
  assert.ok(problems({ proc: { on: "turnStart", sure: true }, acts: {} }).length);
});

test("what each skill gives is read from its effect", () => {
  assert.deepEqual(grantOf("Galeforce"), { skill: "Galeforce", mov: "full", bars: [], once: "turn" });
  assert.deepEqual(grantOf("Onrush"), { skill: "Onrush", mov: "full", bars: [], once: "map" });
  assert.deepEqual(grantOf("Encore"), { skill: "Encore", mov: "none", bars: ["attack"], once: "turn" });
  assert.deepEqual(grantOf("Flurry"), { skill: "Flurry", mov: "full", bars: [], once: "turn" });
  assert.deepEqual(grantOf("Powerstaff"), { skill: "Powerstaff", mov: "full", bars: [], once: "turn" });
  assert.deepEqual(grantOf("Action Surge"), { skill: "Action Surge", mov: "left", bars: [], once: "turn" });
  assert.deepEqual(grantOf("Re-Move"), { skill: "Re-Move", mov: "full", bars: [], once: "turn" });
  assert.deepEqual(grantOf("Hustle"), { skill: "Hustle", mov: "full", bars: [], once: "turn" });

  // A part that says nothing gives an Action with the movement left, as often as its moment comes
  assert.deepEqual(actGrant("Made", {}), { skill: "Made", mov: "left", bars: [], once: null });
});

/* -------------------------------------------- */
/*  Which Go, and How Often                     */
/* -------------------------------------------- */

test("of several goes earned at once the one that gives the most is given, and the others are kept", () => {
  const galeforce = grantOf("Galeforce");
  const onrush = grantOf("Onrush");
  const encore = grantOf("Encore");
  const surge = grantOf("Action Surge");
  assert.equal(pickGo([encore, surge, galeforce]).skill, "Galeforce");
  assert.equal(pickGo([encore, surge]).skill, "Action Surge", "movement left beats none");
  assert.equal(pickGo([]), null);

  // Among equals the limit that comes back soonest is spent first: Galeforce's turn before Onrush's map
  assert.equal(pickGo([onrush, galeforce]).skill, "Galeforce");
  assert.equal(pickGo([onrush, actGrant("Stars", { mov: "full" })]).skill, "Stars");

  // Only the go that is given counts against its skill
  let used = spendGo({ turn: [], map: [] }, galeforce);
  assert.deepEqual(used, { turn: ["Galeforce"], map: [] });
  assert.equal(usedUp(galeforce, used), true);
  assert.equal(usedUp(onrush, used), false);
  assert.equal(pickGo([onrush, galeforce, encore], used).skill, "Onrush", "the second kill of the turn");
  used = spendGo(used, onrush);
  assert.equal(pickGo([onrush, galeforce, encore], used).skill, "Encore", "the third");
  used = spendGo(used, encore);
  assert.equal(pickGo([onrush, galeforce, encore], used), null);
  assert.deepEqual(spentGoes(used).sort(), ["Encore", "Galeforce", "Onrush"]);

  // A new turn brings back what is counted by the turn, not what is counted by the map
  const next = { turn: [], map: used.map };
  assert.equal(pickGo([onrush, galeforce], next).skill, "Galeforce");
  assert.equal(pickGo([onrush], next), null);

  // What has no limit is never used up
  const stars = actGrant("Stars", { mov: "full" });
  assert.deepEqual(spendGo(used, stars), used);
  assert.equal(usedUp(stars, used), false);
});

test("a go has its whole movement anew, what the turn has left, or none", () => {
  const note = { spaces: 3, cost: 4, passed: ["foe1"], canto: 0 };

  // Full: nothing is carried over, and its movement is counted anew from where the unit stands
  assert.deepEqual(goFor(grantOf("Galeforce"), { mov: 6, note }), { skill: "Galeforce", kind: "full", mov: null, bars: [], base: null });

  // Left: what the turn has not spent, counted on from where it began
  const surge = goFor(grantOf("Action Surge"), { mov: 6, note });
  assert.equal(surge.mov, 2);
  assert.deepEqual(surge.base, note);
  assert.equal(goFor(grantOf("Action Surge"), { mov: 3, note }).mov, 0, "never less than none");
  assert.equal(goFor(grantOf("Action Surge"), { mov: 6, note: null }).mov, 6, "a unit that has not moved");

  // None: it acts from where it stands
  const encore = goFor(grantOf("Encore"), { mov: 6, note });
  assert.equal(encore.mov, 0);
  assert.deepEqual(encore.bars, ["attack"]);
  assert.deepEqual(encore.base, note);

  // The move made in such a go is added to what the unit had moved before
  assert.deepEqual(walkOn(note, { spaces: 2, cost: 2, passed: ["foe2", "foe1"] }), { spaces: 5, cost: 6, passed: ["foe1", "foe2"], canto: 0 });
  assert.deepEqual(walkOn(note, null), note);
});

/* -------------------------------------------- */
/*  After an Action                             */
/* -------------------------------------------- */

test("Powerstaff follows a staff, Action Surge any Action, and nothing follows Waiting", () => {
  assert.equal(followsAction({ after: ["staff"] }, staff), true);
  assert.equal(followsAction({ after: ["staff"] }, attack), false);
  assert.equal(followsAction({}, { kind: "other" }), true);
  assert.equal(followsAction({}, wait), false);

  const skills = [skill("Powerstaff"), skill("Action Surge")];
  assert.deepEqual(waitingFor(skills, staff).map((entry) => entry.skill), ["Powerstaff", "Action Surge"]);
  assert.deepEqual(waitingFor(skills, attack).map((entry) => entry.skill), ["Action Surge"]);
  assert.deepEqual(waitingFor(skills, item).map((entry) => entry.skill), ["Action Surge"]);
  assert.deepEqual(waitingFor(skills, wait), []);

  // Both are sure: nothing is rolled, and the staff's full movement is the go that is given
  const waiting = waitingFor(skills, staff);
  assert.equal(actionDice(waiting), 0);
  const { grants, rolls } = actionGrants(waiting, () => 0, dice());
  assert.equal(rolls.every((roll) => roll.success && (roll.roll === null)), true);
  assert.equal(pickGo(grants).skill, "Powerstaff");

  // Once a turn each: the second staff of the turn earns the second Action, and the third nothing
  let used = spendGo({}, pickGo(grants));
  const second = waitingFor(skills, staff, used);
  assert.deepEqual(second.map((entry) => entry.skill), ["Action Surge"]);
  used = spendGo(used, second[0].grant);
  assert.deepEqual(waitingFor(skills, staff, used), []);

  // A fight's moments are not an Action taken
  assert.deepEqual(waitingFor([skill("Galeforce"), skill("Flurry"), skill("Encore")], attack), []);
});

test("Re-Move is rolled at LUK, with the chance of the unit's Movement Stars added", () => {
  const who = self({ luk: 12 });
  const chance = (proc) => chanceOf(proc, who, null, { activation: 0 });
  const remove = [skill("Re-Move")];
  const waiting = actionEffects(remove, attack, { holds: (when) => holds(when, who, null) });
  assert.equal(actionDice(waiting), 1);
  assert.equal(actionGrants(waiting, chance, dice(12)).grants.length, 1);
  assert.equal(actionGrants(waiting, chance, dice(13)).grants.length, 0);

  // Three stars are 15% more, in the one roll
  const stars = starChance(3, { max: 5, perStar: 5 });
  assert.equal(stars, 15);
  const both = actionEffects([...remove, starsEntry("Movement Stars")], attack);
  assert.deepEqual(both.map((entry) => entry.skill), ["Re-Move"], "the stars are not rolled a second time");
  assert.equal(actionGrants(both, chance, dice(27), { stars }).grants.length, 1);
  assert.equal(actionGrants(both, chance, dice(28), { stars }).grants.length, 0);
  assert.equal(actionGrants(both, chance, dice(27), { stars }).rolls[0].chance, 27);

  // It can only happen once: afterwards the stars are rolled by themselves, as often as they come
  const used = spendGo({}, grantOf("Re-Move"));
  const after = actionEffects([...remove, starsEntry("Movement Stars")], attack, { used });
  assert.deepEqual(after.map((entry) => entry.skill), ["Movement Stars"]);
  const alone = actionGrants(after, chance, dice(15), { stars });
  assert.deepEqual(alone.grants, [{ skill: "Movement Stars", mov: "full", bars: [], once: null }]);
  assert.equal(alone.rolls[0].chance, 15, "a chance of their own, which the Skill Activation rate does not change");
  assert.equal(actionGrants(after, chance, dice(16), { stars }).grants.length, 0);
  assert.deepEqual(actionEffects([...remove, starsEntry("Movement Stars")], attack, { used: spendGo(used, alone.grants[0]) })
    .map((entry) => entry.skill), ["Movement Stars"]);

  // A chance of nothing rolls nothing, and neither does a sure thing
  assert.equal(actionGrants(actionEffects([starsEntry("Stars")], attack), chance, dice(), { stars: 0 }).grants.length, 0);
  assert.equal(actionGrants(waiting, () => 100, dice()).grants.length, 1);
});

/* -------------------------------------------- */
/*  A Fight That Earns a Go                     */
/* -------------------------------------------- */

test("Galeforce, Onrush and Encore are earned by the unit that started the fight and felled its foe", () => {
  const felled = fight(slayer([skill("Galeforce"), skill("Onrush"), skill("Encore")]), victim(), 50);
  assert.equal(felled.defender.defeated, true);
  assert.deepEqual(felled.acts.map((entry) => entry.skill).sort(), ["Encore", "Galeforce", "Onrush"]);
  assert.deepEqual(felled.acts.find((entry) => entry.skill === "Encore").acts, { mov: "none", bars: ["attack"], once: "turn" });
  assert.equal(felled.acts.every((entry) => entry.by === "initiator"), true);
  assert.equal(felled.reminders, undefined, "nothing is left for the table");

  // A foe that survives earns nothing
  assert.equal(fight(slayer([skill("Galeforce")]), victim({ hp: 200, hpMax: 200 }), 50).acts, undefined);

  // Nor does a foe felled while another side has its Phase: the unit that was attacked earns no go
  const answered = fight(victim({ hp: 100, hpMax: 100, stats: { str: 0 } }), { ...slayer([skill("Galeforce")]) }, 50);
  assert.equal(answered.initiator.defeated, false);
  const countered = fight(fighter({ name: "B", hp: 5, stats: { def: 0, str: 0 } }), slayer([skill("Galeforce")]), 50);
  assert.equal(countered.initiator.defeated, true);
  assert.equal(countered.acts, undefined);

  // A skill that has given the go its limit allows has no part in the fight
  const spent = { ...slayer([skill("Galeforce"), skill("Encore")]), goes: ["Galeforce"] };
  assert.deepEqual(fight(spent, victim(), 50).acts.map((entry) => entry.skill), ["Encore"]);
  assert.equal(fight({ ...spent, goes: ["Galeforce", "Encore"] }, victim(), 50).acts, undefined);
});

test("Flurry is earned by a critical hit, once, for a unit that still stands", () => {
  const sharp = (more = {}) => slayer([skill("Flurry")], { weapon: { crit: 100 }, ...more });
  const wall = () => fighter({ name: "B", hp: 200, hpMax: 200, stats: { def: 0, str: 0 } });

  // Every die comes up 1: each attack is a critical hit, and the go is earned once
  const crits = fight(sharp(), wall(), 1);
  assert.ok(crits.attacks.filter((attack) => (attack.side === "initiator") && attack.crit).length >= 1);
  assert.deepEqual(crits.acts, [{ skill: "Flurry", by: "initiator", acts: { mov: "full", once: "turn" } }]);

  // No critical hit, no go; and none for the unit that was attacked
  assert.equal(fight(slayer([skill("Flurry")]), wall(), 50).acts, undefined);
  assert.equal(fight(wall(), sharp(), 1).acts, undefined);

  // A unit that falls in the fight it started does not act again
  const frail = fight(sharp({ hp: 1, stats: { str: 1, spd: 0, def: 0 } }),
    fighter({ name: "B", hp: 200, hpMax: 200, stats: { def: 0, str: 30, spd: 0 } }), 1);
  assert.equal(frail.initiator.defeated, true);
  assert.equal(frail.acts, undefined);
});

test("a foe defeated by other means earns the go only in the unit's own turn", () => {
  const foe = unit({ name: "Foe", hp: 0 });
  const mine = killMoments(unit({ skills: [skill("Galeforce")], inTurn: true }), foe, dice());
  assert.deepEqual(mine.acts, [{ skill: "Galeforce", acts: { mov: "full", once: "turn" } }]);
  assert.deepEqual(mine.reminders, []);
  assert.deepEqual(killMoments(unit({ skills: [skill("Galeforce")], inTurn: false }), foe, dice()).acts, []);
  assert.deepEqual(killMoments(unit({ inTurn: true }), foe, dice()).acts, []);
});

/* -------------------------------------------- */
/*  What a Skill Takes in Return                */
/* -------------------------------------------- */

test("Hustle is used before the unit moves, is no Action, and earns the go only while it is on", () => {
  const usage = skill("Hustle").usage;
  assert.equal(usage.free, true);
  assert.equal(usage.unmoved, true);
  assert.equal(usage.cooldown, 4);
  assert.deepEqual(waitingFor([skill("Hustle")], attack), []);
  const on = skill("Hustle", { active: true });
  assert.deepEqual(waitingFor([on], attack).map((entry) => entry.skill), ["Hustle"]);
  assert.deepEqual(waitingFor([on], attack, spendGo({}, grantOf("Hustle"))), [], "one second go");

  // Used, it stays on for that turn, and is off again as the next one starts
  const spent = spendSkill(usage, { active: false, cooldown: 0, lasting: 0, used: 0 });
  assert.equal(spent.active, true);
  assert.equal(canUse(usage, spent).ok, false);
  assert.equal(tickSkill(usage, spent).state.active, false);

  // While it is on its unit cannot be Refreshed, and keeps its turn
  const rules = (skills) => skillTotals(skills, self()).rules;
  assert.equal(rules([on]).has("noRefresh"), true);
  assert.equal(rules([on]).has("noTurn"), false);
  assert.equal(rules([skill("Hustle")]).has("noRefresh"), false);
});

test("Hustle's price comes as that turn ends: -3 to its stats, the next turn lost, no Refresh", () => {
  const who = { ...self({ str: 10, con: 8 }), name: "Hustler" };
  assert.equal(turnMoment([skill("Hustle")], who, "turnEnd", dice()).entries.length, 0, "not for a unit that did not use it");
  const ended = turnMoment([skill("Hustle", { active: true })], who, "turnEnd", dice());
  assert.equal(ended.entries.length, 1);
  const [{ change }] = ended.entries[0].granted;
  assert.equal(change.ends, "turnStart");
  assert.equal(change.turns, 2);

  // What the unit carries from then on
  const carried = skillTotals(timedEntries([change]), who);
  assert.equal(carried.rules.has("noTurn"), true);
  assert.equal(carried.rules.has("noRefresh"), true);
  for ( const stat of ["str", "mag", "dex", "spd", "luk", "def", "res", "con"] ) assert.equal(carried.stats[stat], -3, stat);
  assert.equal(carried.stats.mov, undefined);

  // It is still there as the turn it loses starts, and gone as the one after that does
  const lost = tickChanges([change], "turnStart");
  assert.equal(lost.list.length, 1);
  assert.equal(skillTotals(timedEntries(lost.list), who).rules.has("noTurn"), true);
  const free = tickChanges(lost.list, "turnStart");
  assert.equal(free.list.length, 0);
  assert.equal(skillTotals(made("None", []).effects, who).rules.has("noTurn"), false);
});

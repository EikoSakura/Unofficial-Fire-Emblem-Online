/**
 * Tests for standing guard (`module/rules/stances.mjs`): the stances a unit enters and what ends them, the units
 * that are fought in another's place, and the units that take a hit meant for an ally or turn it back in the
 * middle of somebody else's fight (`module/rules/combat.mjs`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkAct } from "../module/rules/actions.mjs";
import { addCanto, emptyCanto, follows } from "../module/rules/canto.mjs";
import { planExchange, playExchange, resolveExchange } from "../module/rules/combat.mjs";
import { checkEffects, coverageOf, skillStanding, skillTotals, useMoment } from "../module/rules/skills.mjs";
import {
  BLOW, blowsTotal, checkGuards, checkStance, checkWards, guardOf, guardsFor, hitRedirected, keepStances, stanceGround, stanceLapses,
  stanceOf, stancesOf, statesEntered, stepsInAlone, wardOffers, wardsAlone
} from "../module/rules/stances.mjs";
import { buildChange, cleanChange, tickChanges, timedEntries } from "../module/rules/timed.mjs";
import { fighter, skill } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../packs-src/skills/effects.json", import.meta.url)), "utf8")).skills;

const STEP = ["Overwatch", "Avert", "Sentry", "Protect", "Got Your Back", "Terrorguard", "Redirect", "Rebuke", "Suppress", "Alarm", "Spell Trap", "Camouflage"];
const WHO = { name: "Knight", uuid: "Actor.Knight", hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null, near: null };
const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });

/** The change a skill leaves on its unit as it is used. */
function entered(name, who = WHO) {
  const used = useMoment(skill(name), who, () => 100);
  return used.entries.flatMap((entry) => entry.granted.map((given) => given.change))[0];
}

/** A unit on the map, as the rules of guarding know it. */
const at = (id, i, j, side = "player", more = {}) => ({ id, uuid: `Actor.${id}`, tile: { i, j }, side, ...more });

/* -------------------------------------------- */
/*  The Skills of the Step                      */
/* -------------------------------------------- */

test("every skill of the step is written in parts the rules know, and none leaves anything to the table", () => {
  for ( const name of STEP ) {
    const entry = listed[name];
    assert.ok(entry, `${name} is listed`);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.equal(entry.left, undefined, `${name} leaves nothing`);
    assert.ok(entry.note, `${name} says how it is read`);
    assert.equal(coverageOf({ effect: "x", listed: true, left: entry.left ?? "" }), "done");
  }
});

/* -------------------------------------------- */
/*  Stances                                     */
/* -------------------------------------------- */

test("a stance is a change that says what it is called, what ends it and how it is marked", () => {
  assert.equal(stanceOf(null), null);
  assert.equal(stanceOf({}), null, "a change that says nothing of a stance is none");
  assert.deepEqual(stanceOf({ state: "Hold", mark: "hold" }), { state: "Hold", until: [], on: [], mark: "hold" });
  assert.deepEqual(stanceOf({ until: ["move", "alone", "nonsense"], mark: "guard" }), { state: "", until: ["move", "alone"], on: [], mark: "guard" });
  assert.deepEqual(stanceOf({ on: ["forest"], mark: "hidden" }).until, ["terrain"], "one that is kept on a kind of terrain ends off it");
  assert.deepEqual(checkStance({ state: "Hold", until: ["move"], mark: "hold" }), []);
  assert.equal(checkStance({ until: ["sleep"] }).length, 1);
  assert.equal(checkStance({ on: ["lava"] }).length, 1);
  assert.equal(checkStance({ mark: "crown" }).length, 1);
  assert.equal(checkStance({ icon: "x" }).length, 1);
});

test("Overwatch: used as an action, its unit Holds until its next turn starts, and reacts to a move once", () => {
  assert.deepEqual(listed.Overwatch.usage, { kind: "action" });
  const change = entered("Overwatch");
  assert.equal(change.name, "Overwatch");
  assert.equal(change.ends, "turnStart");
  assert.deepEqual(change.stance, { state: "Hold", until: [], on: [], mark: "hold" });
  assert.ok(cleanChange(change, checkEffects), "it passes the check that guards what is saved");
  assert.deepEqual(cleanChange(change, checkEffects).stance, change.stance);
  assert.deepEqual(stancesOf([change]).map((held) => held.stance.mark), ["hold"]);

  const { reacts, guard, wards } = skillStanding(timedEntries([change]), WHO);
  assert.equal(guard.length + wards.length, 0);
  assert.equal(reacts.length, 1);
  assert.deepEqual({ ...reacts[0], effects: undefined, rallies: undefined }, {
    skill: "Overwatch", id: "", to: "move", within: "weapon", near: 0, fight: true, strike: false, halts: "hurt", once: "turn", may: true,
    effects: undefined, rallies: undefined, moves: "", stance: true
  });

  // The skill itself gives its unit nothing in a fight, and the stance is over as its next turn starts
  assert.equal(skillTotals([skill("Overwatch"), ...timedEntries([change])], WHO).rules.size, 0);
  assert.equal(tickChanges([change], "turnStart").list.length, 0);
  assert.equal(skillStanding(timedEntries(tickChanges([change], "turnStart").list), WHO).reacts.length, 0);
});

test("a skill that enters the Hold state is one Canto+ does not follow", () => {
  for ( const name of ["Overwatch", "Avert", "Sentry"] ) assert.deepEqual(statesEntered(listed[name].effects), ["Hold"], name);
  assert.deepEqual(statesEntered(listed.Protect.effects), []);
  const canto = addCanto(emptyCanto(), { after: ["attack", "skill"], except: ["Hold", "Bastion"] }, { skill: "Canto+" });
  const grant = canto.grants[0];
  assert.equal(follows(grant, { kind: "skill", name: "Rally" }), true);
  assert.equal(follows(grant, { kind: "skill", name: "Overwatch", states: statesEntered(listed.Overwatch.effects) }), false);
  assert.equal(follows(grant, { kind: "skill", name: "Protect", states: statesEntered(listed.Protect.effects) }), true);
  assert.equal(follows(grant, { kind: "skill", name: "Bastion" }), false);
});

test("Protect: its unit stands guard until it is moved or no ally stands next to it", () => {
  const change = entered("Protect");
  assert.equal(change.ends, "map");
  assert.deepEqual(change.stance, { state: "", until: ["move", "alone"], on: [], mark: "guard" });
  assert.equal(stanceLapses(change.stance, { allies: 2 }), false);
  assert.equal(stanceLapses(change.stance, { moved: true, allies: 2 }), true, "however it is moved");
  assert.equal(stanceLapses(change.stance, { allies: 0 }), true, "with nobody left to guard");
  assert.equal(stanceLapses(change.stance, { attacked: true, allies: 1 }), false, "attacking does not end it");
  assert.equal(stanceLapses(change.stance, {}), false, "what is not known is not judged");
  const other = buildChange({ name: "Rally", effects: [{ stats: { str: 2 } }], ends: "turnStart" }, { skill: "Rally", own: true });
  const kept = keepStances([other, change], { moved: true });
  assert.deepEqual(kept.list.map((entry) => entry.name), ["Rally"]);
  assert.deepEqual(kept.ended.map((entry) => entry.name), ["Protect"]);
  assert.equal(keepStances([other, change], { allies: 1 }).changed, false);

  const { guard } = skillStanding(timedEntries([change]), WHO);
  assert.deepEqual(guard, [{ skill: "Protect", id: "", within: 1, may: false, swap: false, effects: [], through: null, self: false, only: "" }]);
});

test("Camouflage: entered on a Forest or a Thicket, and over with an attack or on other ground", () => {
  assert.deepEqual(stanceGround(listed.Camouflage.effects), ["forest", "thicket"]);
  assert.deepEqual(stanceGround(listed.Overwatch.effects), []);
  const change = entered("Camouflage");
  assert.equal(change.ends, "turnStart");
  assert.deepEqual(change.stance, { state: "", until: ["attack", "terrain"], on: ["forest", "thicket"], mark: "hidden" });
  assert.equal(stanceLapses(change.stance, { moved: true, terrain: "thicket" }), false, "moving within the trees keeps it");
  assert.equal(stanceLapses(change.stance, { terrain: "plain" }), true);
  assert.equal(stanceLapses(change.stance, { attacked: true, terrain: "forest" }), true);
  const totals = skillTotals(timedEntries([change]), WHO);
  assert.ok(totals.rules.has("hidden") && totals.rules.has("untargetable"));
  const { reacts } = skillStanding(timedEntries([change]), WHO);
  assert.equal(reacts.length, 1);
  assert.equal(reacts[0].to, "pass");
  assert.ok(reacts[0].strike && (reacts[0].moves === "half") && reacts[0].may);
});

/* -------------------------------------------- */
/*  Fighting in Another's Place                 */
/* -------------------------------------------- */

test("a unit that stands guard is fought in the place of an ally next to it", () => {
  const protect = skillStanding(timedEntries([entered("Protect")]), WHO).guard;
  const ally = at("ally", 5, 5);
  const foe = at("foe", 5, 7, "enemy");
  const guard = at("guard", 4, 5, "player", { guard: protect });
  const offers = guardsFor(ally, foe, [ally, foe, guard]);
  assert.deepEqual(offers, [{ guard: "guard", holder: "guard", skill: "Protect", id: "", may: false, swap: false, effects: [] }]);

  // Not from further away, not for itself, not against its own side, not once it is down
  assert.deepEqual(guardsFor(ally, foe, [ally, foe, { ...guard, tile: { i: 3, j: 5 } }]), []);
  assert.deepEqual(guardsFor(guard, foe, [ally, foe, guard]), [], "nobody stands in for the guard itself");
  assert.deepEqual(guardsFor(ally, at("friend", 5, 6, "ally"), [ally, guard]), [], "an ally starts no fight to guard against");
  assert.deepEqual(guardsFor(ally, foe, [ally, foe, { ...guard, out: true }]), []);
  assert.deepEqual(guardsFor(ally, foe, [ally, foe, { ...guard, side: "enemy" }]), [], "an enemy's guard does not fight its own side");

  // The first of several fights, and a unit that only may step in comes after one that stands guard
  const second = at("second", 6, 5, "player", { guard: protect });
  const may = at("may", 5, 4, "player", { guard: skillStanding([skill("Got Your Back")], WHO).guard });
  assert.deepEqual(guardsFor(ally, foe, [ally, foe, may, guard, second]).map((offer) => offer.guard), ["guard", "second", "may"]);
});

test("Got Your Back: its unit may take the place of an ally next to it, with +3 END, and the two trade places", () => {
  assert.equal(listed["Got Your Back"].usage, undefined);
  const [way] = skillStanding([skill("Got Your Back")], WHO).guard;
  assert.deepEqual(way, { skill: "Got Your Back", id: "got-your-back", within: 1, may: true, swap: true, effects: [{ endurance: 3 }], through: null, self: false, only: "" });
  const ally = at("ally", 5, 5);
  const foe = at("foe", 5, 6, "enemy");
  const friend = at("friend", 6, 5, "player", { guard: [way] });
  const [offer] = guardsFor(ally, foe, [ally, foe, friend]);
  assert.ok(offer.may && offer.swap);
  assert.equal(offer.holder, "friend");

  // What it has for that fight is lent to it as the fight is planned
  const lent = buildChange({ name: "Got Your Back", effects: offer.effects, ends: "turnEnd" }, { skill: "Got Your Back", own: true });
  const plain = planExchange(A(), B());
  const stood = planExchange(A(), B(), { more: { defender: [lent] } });
  assert.equal(stood.initiator.damage, plain.initiator.damage - 3);
  assert.equal(stood.defender.damage, plain.defender.damage, "its own attacks are as they were");
});

test("a unit that answers by itself steps in where that spares its side", () => {
  assert.equal(blowsTotal([{ damage: 9, hit: 80 }, { damage: 9, hit: 80 }]), 18);
  assert.equal(blowsTotal([{ damage: 9, hit: 0 }]), 0, "an attack that cannot land takes nothing");
  assert.equal(stepsInAlone({ ally: { hp: 10, takes: 12 }, guard: { hp: 30, takes: 14 } }), true, "the ally would fall");
  assert.equal(stepsInAlone({ ally: { hp: 30, takes: 12 }, guard: { hp: 30, takes: 4 } }), true, "it takes less");
  assert.equal(stepsInAlone({ ally: { hp: 30, takes: 6 }, guard: { hp: 30, takes: 8 } }), false);
  assert.equal(stepsInAlone({ ally: { hp: 10, takes: 12 }, guard: { hp: 8, takes: 9 } }), false, "not to fall in its place");
  assert.equal(stepsInAlone({ ally: { hp: 30, takes: 0 }, guard: { hp: 30, takes: 0 } }), false);
});

test("Terrorguard: an allied Terror next to its unit fights in its place, or in that of an ally next to the Terror", () => {
  const [way] = skillStanding([skill("Terrorguard")], WHO).guard;
  assert.deepEqual(way.through, { quality: ["Terror"], within: 1 });
  assert.ok(way.may && way.self);
  const diabolist = at("diabolist", 5, 5, "player", { guard: [way] });
  const terror = at("terror", 5, 4, "player", { qualities: "Flying, Terror" });
  const ally = at("ally", 4, 4);
  const far = at("far", 8, 8);
  const foe = at("foe", 5, 6, "enemy");
  const units = [diabolist, terror, ally, far, foe];

  // In its own place
  assert.deepEqual(guardsFor(diabolist, foe, units), [{ guard: "terror", holder: "diabolist", skill: "Terrorguard", id: "terrorguard", may: true, swap: false, effects: [] }]);

  // In that of an ally next to the Terror, and of no other
  assert.deepEqual(guardsFor(ally, foe, units).map((offer) => [offer.guard, offer.holder]), [["terror", "diabolist"]]);
  assert.deepEqual(guardsFor(far, foe, units), []);
  assert.deepEqual(guardsFor(terror, foe, units), [], "nobody stands in for the Terror itself");

  // Only a Terror, only one next to the unit, and the unit itself does not fight for its ally by this skill
  assert.deepEqual(guardsFor(diabolist, foe, [diabolist, { ...terror, qualities: "Flying" }, foe]), []);
  assert.deepEqual(guardsFor(diabolist, foe, [diabolist, { ...terror, tile: { i: 5, j: 3 } }, foe]), []);
  assert.deepEqual(guardsFor(ally, foe, [{ ...diabolist, tile: { i: 4, j: 5 } }, ally, foe]), []);
});

test("a unit takes the place of the one unit a change comes from, as a later skill may have it", () => {
  // Possession (step 28): the summoner leaves this on its undead, which then stands in for the summoner alone
  const change = buildChange(
    { name: "Possession", by: true, clock: "giver", ends: "turnStart", stance: { mark: "guard" }, effects: [{ guards: { who: "ally", within: 1, only: "giver" } }] },
    { skill: "Possession", from: "Necromancer", giver: "Actor.necromancer" }
  );
  assert.equal(change.by, "Actor.necromancer");
  assert.equal(change.clock, "Actor.necromancer", "it lasts by the summoner's turns");
  assert.ok(cleanChange(change, checkEffects));
  const [way] = skillStanding(timedEntries([change]), { ...WHO, name: "Undead" }).guard;
  assert.equal(way.only, "Actor.necromancer");
  assert.equal(way.skill, "Possession");
  const summoner = at("necromancer", 5, 5);
  const undead = at("undead", 5, 4, "player", { guard: [way] });
  const other = at("other", 4, 4);
  const foe = at("foe", 5, 6, "enemy");
  assert.deepEqual(guardsFor(summoner, foe, [summoner, undead, other, foe]).map((offer) => offer.guard), ["undead"]);
  assert.deepEqual(guardsFor(other, foe, [summoner, undead, other, foe]), [], "it stands in for nobody else");
  assert.equal(guardOf({ who: "ally", only: "giver" }, { skill: "x" }), null, "a skill of its own has no giver");
  assert.deepEqual(checkGuards({ who: "ally", within: 1, only: "giver" }), []);
  assert.equal(checkGuards({ who: "enemy" }).length, 1);
  assert.equal(checkGuards({ who: "ally", self: true }).length, 1);
});

/* -------------------------------------------- */
/*  Taking a Hit Meant for Another              */
/* -------------------------------------------- */

/** An ally that stands by with a skill of the step, as `wardStandby` describes it. */
function standby(name, more = {}) {
  const [ward] = skillStanding([skill(name)], WHO).wards;
  return { key: `ally|${name}`, skill: name, by: "Ally", at: BLOW, takes: ward.takes, negate: ward.negate, returns: ward.returns, heavy: ward.heavy, hp: 30, stats: { def: 10, res: 2 }, ...more };
}

test("Redirect: once a turn its unit takes a hit meant for an ally next to it, worked out with its own defence", () => {
  assert.deepEqual(listed.Redirect.usage, { kind: "auto", uses: 1, per: "turn" });
  const [ward] = skillStanding([skill("Redirect")], WHO).wards;
  assert.deepEqual(ward, { skill: "Redirect", id: "redirect", within: 1, takes: true, negate: false, returns: 0, heavy: 0 });
  assert.equal(skillStanding([skill("Redirect", { used: 1 })], WHO).wards.length, 0, "not once its use is spent");

  // 9 damage against DEF 6 is 5 against DEF 10, and 13 against RES 2 for magic
  assert.equal(hitRedirected(9, 6, 10), 5);
  assert.equal(hitRedirected(9, 6, 2), 13);
  assert.equal(hitRedirected(3, 6, 20), 0);
  assert.equal(hitRedirected(27, 6, 10, 3), 15, "a critical hit counts the difference as often as its damage");

  const plan = planExchange(A(), B());
  assert.equal(plan.initiator.damage, 9);
  const ally = standby("Redirect");
  const points = [];
  const { result } = playExchange(plan, (index) => [1, 100, 1, 100][index] ?? 100, (point) => {
    points.push(point);
    return point.offers[0].key;
  }, { standby: { defender: [ally] } });
  assert.equal(points.length, 1);
  assert.equal(points[0].on, BLOW);
  assert.equal(points[0].side, "defender");
  assert.deepEqual(points[0].offers, [{ key: "ally|Redirect", skill: "Redirect", what: "redirect", amount: 5, by: "Ally", hp: 30 }]);
  assert.equal(points[0].attack.damage, 9);
  assert.equal(result.defender.hp, 30, "the ally takes nothing of it");
  assert.deepEqual(result.wards, [{ key: "ally|Redirect", skill: "Redirect", by: "Ally", what: "redirect", amount: 5, side: "defender", negated: 9 }]);
  assert.equal(result.attacks[0].warded.amount, 5);
  assert.equal(result.attacks[0].hit, true);
  assert.equal(result.initiator.hp, 30 - 9, "the counter-attack is made as ever");

  // Passed, the hit lands; nobody is asked where the fight is rolled without answers, or for an attack that misses
  const passed = playExchange(plan, (index) => [1, 100, 1, 100][index] ?? 100, () => null, { standby: { defender: [ally] } });
  assert.equal(passed.result.defender.hp, 21);
  assert.equal(passed.result.wards, undefined);
  assert.equal(resolveExchange(plan, () => 1, { standby: { defender: [ally] } }).wards, undefined);
  let asked = 0;
  playExchange(plan, () => 100, () => (asked++, null), { standby: { defender: [ally] } });
  assert.equal(asked, 0);

  // It answers once in a fight, and an ally of the unit that began the fight is asked for the counter-attack
  const twice = planExchange(A({ stats: { spd: 20 } }), B());
  const offered = [];
  playExchange(twice, (index) => ((index % 2) ? 100 : 1), (point) => (offered.push(point), point.offers[0].key), { standby: { defender: [ally] } });
  assert.equal(offered.length, 1);
  const mine = [];
  playExchange(plan, (index) => [1, 100, 1, 100][index] ?? 100, (point) => (mine.push(point.side), null), { standby: { initiator: [ally], defender: [] } });
  assert.deepEqual(mine, ["initiator"]);
});

test("Rebuke: a hit that takes half of an ally's HP or more is negated, and half of it dealt to the attacker", () => {
  assert.deepEqual(listed.Rebuke.usage, { kind: "auto", cooldown: 3 });
  const [ward] = skillStanding([skill("Rebuke")], WHO).wards;
  assert.deepEqual(ward, { skill: "Rebuke", id: "rebuke", within: 1, takes: false, negate: true, returns: 50, heavy: 50 });
  const cooling = { ...skill("Rebuke"), state: { active: false, cooldown: 2, lasting: 0, used: 0 } };
  assert.equal(skillStanding([cooling], WHO).wards.length, 0, "not while it is on cooldown");

  const ally = standby("Rebuke");
  assert.deepEqual(wardOffers([ally], { damage: 9, hp: 30 }), [], "9 of 30 HP is no heavy hit");
  assert.deepEqual(wardOffers([ally], { damage: 9, hp: 18 }), [{ key: "ally|Rebuke", skill: "Rebuke", what: "rebuke", amount: 4, by: "Ally", hp: 30 }]);
  assert.deepEqual(wardOffers([ally], { damage: 9, hp: 19 }), [], "just under half");
  assert.deepEqual(wardOffers([ally], { damage: 9, hp: 18 }, ["ally|Rebuke"]), [], "once in a fight");
  assert.deepEqual(wardOffers([{ ...ally, at: undefined }], { damage: 9, hp: 18 }), [], "an ally that only comes for a fallen unit offers nothing here");

  const frail = () => B({ hp: 12 });
  const { result } = playExchange(planExchange(A(), frail()), (index) => [1, 100, 1, 100][index] ?? 100, (point) => point.offers[0].key, { standby: { defender: [ally] } });
  assert.equal(result.defender.hp, 12, "all of it is negated");
  assert.equal(result.initiator.hp, 30 - 4 - 9, "half of the hit, and then the counter-attack");
  assert.equal(result.attacks[0].reflected, 4);
  assert.equal(result.wards[0].what, "rebuke");

  // What it turns back can bring the attacker down, which ends the fight
  const weak = playExchange(planExchange(A({ hp: 3 }), frail()), (index) => [1, 100, 1, 100][index] ?? 100, (point) => point.offers[0].key, { standby: { defender: [ally] } });
  assert.equal(weak.result.initiator.hp, 0);
  assert.equal(weak.result.attacks.length, 1);

  // A unit that answers by itself always turns a hit back, and takes one only where that spares its side
  assert.equal(wardsAlone({ what: "rebuke", amount: 4 }, { damage: 9, hp: 12 }), true);
  assert.equal(wardsAlone({ what: "redirect", amount: 5, hp: 30 }, { damage: 9, hp: 30 }), true, "it takes less");
  assert.equal(wardsAlone({ what: "redirect", amount: 13, hp: 30 }, { damage: 9, hp: 30 }), false);
  assert.equal(wardsAlone({ what: "redirect", amount: 13, hp: 30 }, { damage: 9, hp: 9 }), true, "the ally would fall");
  assert.equal(wardsAlone({ what: "redirect", amount: 13, hp: 10 }, { damage: 9, hp: 9 }), false, "not to fall in its place");
  assert.deepEqual(checkWards({ who: "ally", within: 1, takes: true }), []);
  assert.equal(checkWards({ who: "ally" }).length, 1);
  assert.equal(checkWards({ who: "ally", takes: true, negate: true }).length, 1);
});

test("a skill that lays a trap is used on a tile that is picked", () => {
  const act = listed["Spell Trap"].effects[0].act;
  assert.deepEqual(checkAct(act), []);
  assert.equal(checkAct({ ...act, area: { shape: "radius", radius: 1 } }).length, 1, "not around the unit itself");
  assert.equal(checkAct({ target: { who: "enemy" }, trap: act.trap }).some((problem) => problem.includes("area")), true);
});

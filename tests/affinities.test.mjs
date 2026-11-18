/**
 * Tests for the Additional Affinity Effects: every Affinity is applied by the system, and those their unit
 * chooses when to use are switched on and spent as a skill is (see `module/rules/optional.mjs`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { moveAfter } from "../module/rules/canto.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { emptyShove, tryShove } from "../module/rules/forced.mjs";
import {
  AFFINITY_ID, activationExp, activationGrade, affinityCooldown, affinityEffectMode, affinityEntry, affinityUsage, hasCooldown
} from "../module/rules/optional.mjs";
import { surroundings } from "../module/rules/positions.mjs";
import { mapAffinityBonus } from "../module/rules/progression.mjs";
import { keyTile, pruneLunge, reachFrom, tilesApart } from "../module/rules/reach.mjs";
import { checkEffects, skillCanto, skillCrossing, skillShove, skillTotals, turnMoment } from "../module/rules/skills.mjs";
import { checkUsage, spendSkill, tickSkill } from "../module/rules/skill-usage.mjs";
import { groundOf, moveCost } from "../module/rules/terrain.mjs";
import { grantChange, mendsOf } from "../module/rules/timed.mjs";
import { exchangeAftermath } from "../module/helpers/aftermath.mjs";
import { dice, fighter, made } from "./lib/fixtures.mjs";

/** A world that plays with both Affinity modules and with every condition there is. */
const ON = {
  config: { ...FEO.optional.affinityEffects, enabled: true },
  affinities: { ...FEO.affinities, ...FEO.optionalAffinities },
  conditions: new Proxy({}, { has: () => true })
};
const ALL = Object.keys(ON.affinities);

/** What an Affinity builds into its unit, as the unit carries it among its skills. */
function affinity(key, { active = false, used = 0, cooldown = 0 } = {}) {
  const entry = affinityEntry(key, `${key} Affinity`, ON);
  const use = affinityUsage(key, ON);
  if ( !use ) return { ...entry, active: false, spends: false, usage: null, state: null };
  return {
    ...entry, id: AFFINITY_ID, active, spends: use.spentBy === "fight", usage: use.usage,
    state: { active, cooldown, lasting: 0, used }
  };
}

/** Roll out a fight with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], rest = 100) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  let rolled = 0;
  const result = resolveExchange(plan, () => rolls[rolled++] ?? (rolled++, rest));
  return { plan, result };
}

const hits = (result, side) => result.attacks.filter((attack) => (attack.side === side) && attack.hit);

/** The changes a fight granted one of its sides. */
const granted = (result, side) => (result.granted ?? []).filter((entry) => entry.to === side).map((entry) => entry.change);

test("there are 37 Affinities, and the system applies every one of them", () => {
  assert.equal(ALL.length, 37);
  for ( const key of ALL ) assert.equal(affinityEffectMode(key, ON), "auto", key);
});

test("what each Affinity does is written without a mistake", () => {
  for ( const key of ALL ) {
    assert.deepEqual(checkEffects(ON.config.effects[key] ?? []), [], key);
    assert.ok(key in ON.config.effects, key);
  }
  for ( const [key, usage] of Object.entries(ON.config.usage) ) {
    assert.deepEqual(checkUsage(usage), [], key);
    assert.ok(["fight", "move", "shove"].includes(ON.config.spentBy[key]), key);
  }
});

test("an Affinity that is left out of play does nothing", () => {
  const off = { ...ON, config: { ...FEO.optional.affinityEffects, enabled: false } };
  for ( const key of ALL ) {
    assert.equal(affinityEntry(key, key, off), null);
    assert.equal(affinityUsage(key, off), null);
    assert.equal(affinityEffectMode(key, off), null);
  }
  assert.equal(activationExp("emblem", [1, 2], off), 0);
});

test("Anima targets the lower of DEF and RES while it is switched on, and the fight spends it", () => {
  // 15 damage against 6 DEF, or against 3 RES
  const foe = () => fighter({ name: "B", hp: 40, hpMax: 40 });
  const plain = fight(fighter({ name: "A", skills: [affinity("anima")] }), foe(), [1]);
  assert.equal(hits(plain.result, "initiator")[0].damage, 9);
  assert.deepEqual(plain.result.initiator.spent, []);

  const used = fight(fighter({ name: "A", skills: [affinity("anima", { active: true })] }), foe(), [1]);
  assert.equal(hits(used.result, "initiator")[0].damage, 12);
  assert.deepEqual(used.result.initiator.spent, [{ id: AFFINITY_ID, name: "anima Affinity" }]);

  // Twice a map: the second use is its last
  const entry = affinity("anima", { active: true });
  const once = spendSkill(entry.usage, entry.state);
  assert.deepEqual(once, { active: false, lasting: 0, cooldown: 0, used: 1 });
  assert.equal(spendSkill(entry.usage, once).used, 2);
});

test("a foe that cancels skills does not stop Anima, which is no skill", () => {
  const nihil = made("Nihil", [{ rules: ["nihil"] }]);
  const { plan, result } = fight(
    fighter({ name: "A", skills: [affinity("anima", { active: true })] }),
    fighter({ name: "B", hp: 40, hpMax: 40, skills: [nihil] }), [1]
  );
  assert.deepEqual(plan.initiator.stopped, []);
  assert.equal(hits(result, "initiator")[0].damage, 12);
});

test("Sinew counts the hits of 2 damage or more its unit takes in a fight it did not start", () => {
  const sinew = affinity("sinew");
  const struck = fight(fighter({ name: "A" }), fighter({ name: "B", hp: 40, hpMax: 40, skills: [sinew] }), [1]);
  const counted = granted(struck.result, "defender");
  assert.equal(counted.length, 1);
  assert.deepEqual([counted[0].name, counted[0].mend, counted[0].max, counted[0].ends], ["sinew Affinity", 1, 99, "turnStart"]);

  // A hit that deals 1 damage is not counted, nor one taken in a fight the unit started
  const grazed = fight(fighter({ name: "A" }), fighter({ name: "B", hp: 40, hpMax: 40, stats: { def: 14 }, skills: [sinew] }), [1]);
  assert.equal(hits(grazed.result, "initiator")[0].damage, 1);
  assert.deepEqual(granted(grazed.result, "defender"), []);
  const began = fight(fighter({ name: "B", hp: 40, hpMax: 40, skills: [sinew] }), fighter({ name: "A" }), [1, 100, 1]);
  assert.ok(hits(began.result, "defender").length > 0);
  assert.deepEqual(granted(began.result, "initiator"), []);
});

test("what Sinew counted is restored as its unit's next turn starts, 1 HP for each hit", () => {
  const change = { name: "sinew Affinity", from: "", effects: [], ends: "turnStart", turns: 1, clock: "", stacks: 1, max: 99, fades: false, mend: 1 };
  let list = grantChange([], change).list;
  list = grantChange(list, change).list;
  list = grantChange(list, change).list;
  assert.deepEqual(mendsOf(list), [{ name: "sinew Affinity", from: "", amount: 3 }]);

  // A change that is no tally restores what it says, however often it was granted
  const plain = { ...change, name: "Balm", max: 0, mend: 4 };
  assert.deepEqual(mendsOf(grantChange(grantChange([], plain).list, plain).list), [{ name: "Balm", from: "", amount: 4 }]);
});

test("Staff heals one ally next to its unit for 1 HP when its unit deals damage", () => {
  const token = (id, side, at) => ({ id, actor: `Actor.${id}`, name: id, side, tile: { i: at[0], j: at[1] }, hp: 10, hpMax: 20, skills: [] });
  const units = [token("a", "player", [0, 0]), token("b", "enemy", [0, 1]), token("ally", "player", [1, 0]), token("far", "player", [3, 0])];
  const measure = (one, other) => tilesApart(one.tile, other.tile);
  const on = (who, id) => ({ ...who, near: surroundings(units, id, measure) });
  const mine = on(fighter({ name: "A", skills: [affinity("staff")] }), "a");
  const { result } = fight(mine, on(fighter({ name: "B", hp: 40, hpMax: 40 }), "b"), [1]);
  const spread = (result.spreads ?? []).filter((entry) => entry.skill === "staff Affinity");
  assert.equal(spread.length, 1);
  assert.deepEqual(spread[0].units.map((unit) => [unit.id, unit.heal]), [["ally", 1]]);

  // A hit that deals no damage heals nobody, and neither does one with no ally next to its unit
  const none = fight(mine, on(fighter({ name: "B", hp: 40, hpMax: 40, stats: { def: 30 } }), "b"), [1]);
  assert.equal(none.result.spreads, undefined);
  const alone = { ...mine, near: surroundings(units.filter((unit) => unit.id !== "ally"), "a", measure) };
  assert.equal(fight(alone, on(fighter({ name: "B", hp: 40, hpMax: 40 }), "b"), [1]).result.spreads, undefined);
});

test("Muscle shoves a unit whatever would keep it from that, and pushes one it could shove a space further", () => {
  const field = { inside: (tile) => (tile.j >= 0) && (tile.j < 8) && (tile.i === 0), stands: () => true, taken: () => false };
  const unit = (shove) => ({ tile: { i: 0, j: 1 }, weight: 5, shove, left: null });
  const light = { tile: { i: 0, j: 2 }, weight: 5, relation: "friend", rules: [] };
  const heavy = { ...light, weight: 12 };
  const rooted = { ...light, relation: "foe", rules: ["rooted"] };

  // Switched off, its unit shoves as any other
  const off = skillShove([affinity("muscle")], {});
  assert.deepEqual(off, emptyShove());
  assert.equal(tryShove(unit(off), heavy, field).reason, "weight");
  assert.equal(tryShove(unit(off), rooted, field).reason, "rooted");
  assert.equal(tryShove(unit(off), light, field).moved, 1);

  const on = skillShove([affinity("muscle", { active: true })], {});
  assert.equal(on.any, true);
  const forced = tryShove(unit(on), heavy, field);
  assert.deepEqual([forced.ok, forced.moved, forced.lent], [true, 1, "muscle Affinity"]);
  assert.equal(tryShove(unit(on), rooted, field).lent, "muscle Affinity");
  const further = tryShove(unit(on), light, field);
  assert.deepEqual([further.moved, further.lent, further.tile], [2, "muscle Affinity", { i: 0, j: 4 }]);

  // A unit it could shove anyway, with no room for the second space, does not use it up
  const tight = { ...field, inside: (tile) => (tile.j >= 0) && (tile.j < 4) && (tile.i === 0) };
  const short = tryShove(unit(on), light, tight);
  assert.deepEqual([short.ok, short.moved, short.lent], [true, 1, ""]);
});

test("Wood has every tile its unit can cross take 1 movement, and its tile take nothing off it", () => {
  const off = { crossing: skillCrossing([affinity("wood")], {}) };
  const on = { crossing: skillCrossing([affinity("wood", { active: true })], {}) };
  assert.equal(moveCost("hill", off), 3);
  assert.equal(moveCost("hill", on), 1);
  assert.equal(moveCost("forest", on), 1);

  // Terrain that asks for a skill is no penalty to ignore: it stays closed
  assert.equal(moveCost("mountain", on), Infinity);
  assert.equal(groundOf("cliff", 0, off).dodge, -15);
  assert.equal(groundOf("cliff", 0, on).dodge, 0);
  assert.deepEqual(groundOf("forest", 0, on), groundOf("forest", 0, off));

  // Used, it stays on until its unit's next turn starts, and then sits out two turns
  const entry = affinity("wood", { active: true });
  const spent = spendSkill(entry.usage, entry.state);
  assert.deepEqual([spent.active, spent.lasting], [true, 1]);
  const next = tickSkill(entry.usage, spent).state;
  assert.deepEqual([next.active, next.lasting], [false, 0]);
  assert.equal(spent.cooldown - FEO.skillUse.cooldownExtra, 2);
});

test("Avian moves one space after any Action, whatever its unit has moved and whatever the ground takes", () => {
  const canto = skillCanto([affinity("avian")], {});
  for ( const kind of ["attack", "staff", "item", "shove", "other"] ) {
    const again = moveAfter(canto, { kind }, { mov: 5, spent: 5 });
    assert.equal(again?.mov, 1, kind);
    assert.equal(again.crossing.all, true);
    assert.equal(again.skill, "avian Affinity");
  }
  assert.equal(moveAfter(canto, { kind: "wait" }, { mov: 5, spent: 0 }), null);

  // A unit that cannot move makes no such move, and Canto with more movement left is the better one
  assert.equal(moveAfter(canto, { kind: "attack" }, { mov: 0, spent: 0 }), null);
  const both = skillCanto([affinity("avian"), made("Canto", [{ canto: { after: ["attack"] } }])], {});
  const better = moveAfter(both, { kind: "attack" }, { mov: 5, spent: 2 });
  assert.deepEqual([better.mov, better.skill, better.crossing], [3, "Canto", null]);
});

test("Breath adds a space of movement while it is switched on, and sits out three turns once it is used", () => {
  const off = skillTotals([affinity("breath")], { hp: 20, hpMax: 20, level: 5, stats: { mov: 5 } });
  const on = skillTotals([affinity("breath", { active: true })], { hp: 20, hpMax: 20, level: 5, stats: { mov: 5 } });
  assert.equal(off.stats.mov ?? 0, 0);
  assert.equal(on.stats.mov, 1);
  const entry = affinity("breath", { active: true });
  const spent = spendSkill(entry.usage, entry.state);
  assert.deepEqual([spent.active, spent.cooldown - FEO.skillUse.cooldownExtra], [false, 3]);

  // A fight does not spend it: the move that made use of it does, which the map sees to
  const { result } = fight(fighter({ name: "A", skills: [entry] }), fighter({ name: "B", hp: 40, hpMax: 40 }), [1]);
  assert.deepEqual(result.initiator.spent, []);
});

test("the space Breath adds is kept where it reaches a new enemy, and taken away everywhere else", () => {
  const field = { inside: (tile) => (tile.i >= 0) && (tile.i < 9) && (tile.j >= 0) && (tile.j < 9), cost: () => 1, foe: () => false, taken: (tile) => (tile.i === 4) && (tile.j === 4) };
  const reach = reachFrom({ i: 4, j: 0 }, 3, field);
  const strikes = (from, foe) => tilesApart(from, foe.tile) === 1;

  // The enemy on (4, 4) is 4 spaces away: with 2 MOV the unit ends 2 away at best, with the third space next to it
  const opened = pruneLunge(reach, 2, [{ id: "far", tile: { i: 4, j: 4 } }], strikes);
  assert.deepEqual([...opened.keys()].sort(), ["3,2", "4,3", "5,2"].filter((key) => tilesApart(keyTile(key), { i: 4, j: 4 }) === 1).sort());
  assert.deepEqual(opened.get("4,3"), ["far"]);
  for ( const key of reach.stops ) assert.ok((reach.cost.get(key) <= 2) || opened.has(key), key);
  assert.equal(reach.cost.has("4,3"), true);
  assert.equal(reach.cost.has("1,0"), false);

  // An enemy the unit reaches anyway opens nothing: the third space is gone altogether
  const again = reachFrom({ i: 4, j: 0 }, 3, field);
  const none = pruneLunge(again, 2, [{ id: "near", tile: { i: 4, j: 3 } }], strikes);
  assert.equal(none.size, 0);
  assert.equal([...again.cost.values()].every((cost) => cost <= 2), true);

  // The tile the unit stands on stays in its reach whatever it opens
  const stood = reachFrom({ i: 4, j: 0 }, 3, field);
  pruneLunge(stood, 2, [], strikes, "7,0");
  assert.equal(stood.stops.has("7,0"), true);
});

test("Emblem gives 5, 7 or 10 EXP for a Skill that activates, by what the Skill divides its stat by", () => {
  assert.equal(activationGrade({ on: "attack", stat: "dex" }), 1);
  assert.equal(activationGrade({ on: "attack", stat: "dex", div: 1.5 }), 1.5);
  assert.equal(activationGrade({ on: "attack", stat: "luk", div: 2 }), 2);
  assert.equal(activationGrade({ on: "attack", percent: 25 }), null);
  assert.equal(activationGrade({ on: "attack", sure: true }), null);
  assert.equal(activationGrade({ on: "hit", percent: 25, fixed: true }), null);
  assert.equal(activationExp("emblem", [1, 1.5, 2], ON), 22);
  assert.equal(activationExp("emblem", [3, 4], ON), 0);
  assert.equal(activationExp("fire", [1, 2], ON), 0);
});

test("a fight tells which of a unit's own Skills rolled to activate and did, and Emblem's EXP is added", () => {
  // DEX 8: Flare activates at 8%, Spark at 4%
  const flare = made("Flare", [{ proc: { on: "attack", stat: "dex" }, damage: 3 }]);
  const spark = made("Spark", [{ proc: { on: "attack", stat: "dex", div: 2 }, damage: 1 }]);
  const always = made("Always", [{ proc: { on: "attack", sure: true }, damage: 1 }]);
  const one = planExchange(fighter({ name: "A", skills: [flare, spark, always, affinity("emblem")] }), fighter({ name: "B", hp: 60, hpMax: 60 }), { distance: 1 });
  const result = resolveExchange(one, dice(1, 100, 1, 100, 100, 100, 100, 100, 100, 100, 100, 100));
  const sparked = result.initiator.sparked ?? [];
  assert.ok(sparked.length >= 1, "a Skill activated");
  assert.ok(sparked.every((grade) => [1, 2].includes(grade)));
  assert.equal(result.defender.sparked, undefined);

  // What the fight earns its unit is that much more
  one.initiator.unit.record = { ...one.initiator.unit.record, affinity: "emblem" };
  const before = FEO.optional.affinityEffects.enabled;
  FEO.optional.affinityEffects.enabled = true;
  FEO.affinities.emblem = FEO.optionalAffinities.emblem;
  try {
    const earned = exchangeAftermath(one, result, { earns: { initiator: true } }).initiator.exp;
    const plain = exchangeAftermath(one, { ...result, initiator: { ...result.initiator, sparked: [] } }, { earns: { initiator: true } }).initiator.exp;
    assert.equal(earned.amount - plain.amount, activationExp("emblem", sparked, ON));
    assert.deepEqual(earned.sparked, { amount: earned.amount - plain.amount, skills: sparked.length });
  } finally {
    FEO.optional.affinityEffects.enabled = before;
    delete FEO.affinities.emblem;
  }
});

test("a moment of a turn tells so as well, and what an Affinity or a sure Skill does counts for nothing", () => {
  const renew = made("Renew", [{ proc: { on: "turnStart", stat: "luk" }, recover: 2 }]);
  const sure = made("Sure", [{ proc: { on: "turnStart", sure: true }, recover: 1 }]);
  const self = { hp: 10, hpMax: 20, level: 5, stats: { luk: 5 }, near: null };
  const told = turnMoment([renew, sure, affinity("fire")], self, "turnStart", dice(1));
  assert.deepEqual(told.entries.map((entry) => [entry.skill, entry.grade ?? null]), [["Renew", 1], ["Sure", null]]);
  const failed = turnMoment([renew], self, "turnStart", dice(99));
  assert.equal(failed.entries[0].grade, undefined);
});

test("a unit whose Affinity is the map's gains 5 Hit and 5 Dodge, and no other unit does", () => {
  assert.deepEqual(FEO.mapAffinity, { hit: 5, dodge: 5 });
  assert.deepEqual(mapAffinityBonus("fire", "fire", FEO.mapAffinity), { hit: 5, dodge: 5 });
  assert.equal(mapAffinityBonus("fire", "ice", FEO.mapAffinity), null);
  assert.equal(mapAffinityBonus("", "fire", FEO.mapAffinity), null);
  assert.equal(mapAffinityBonus("fire", "", FEO.mapAffinity), null);

  // It reaches the unit as the weather of its map does, and counts in a fight
  const map = { name: "Map Affinity", skill: "Map Affinity", from: "", giver: "", aura: true, nihil: false, effects: [{ combat: mapAffinityBonus("fire", "fire", FEO.mapAffinity) }] };
  const mine = fighter({ name: "A" });
  const plain = planExchange(mine, fighter({ name: "B" }), { distance: 1 });
  const matched = planExchange({ ...mine, auras: [map] }, fighter({ name: "B" }), { distance: 1 });
  assert.equal(matched.initiator.hit - plain.initiator.hit, 5);
  assert.equal(plain.defender.hit - matched.defender.hit, 5);
});

test("Key takes a turn off the cooldown of the one skill chosen for it", () => {
  const unit = { affinity: "key", affinitySkill: "abc" };
  assert.deepEqual(affinityCooldown(unit, ON), { skill: "abc", turns: -1 });
  assert.equal(affinityCooldown({ affinity: "key", affinitySkill: "" }, ON), null);
  assert.equal(affinityCooldown({ affinity: "lock", affinitySkill: "abc" }, ON), null);
  assert.equal(hasCooldown({ usage: { kind: "action", cooldown: 3 } }), true);
  assert.equal(hasCooldown({ usage: { kind: "declare", uses: 1, per: "map" } }), false);
  assert.equal(hasCooldown({ usage: null }), false);

  // A cooldown of 3 turns is one of 2, and one of 1 turn is none at all
  const three = spendSkill({ kind: "action", cooldown: 3 }, {}, { cooldowns: -1 });
  assert.equal(three.cooldown - FEO.skillUse.cooldownExtra, 2);
  const one = spendSkill({ kind: "action", cooldown: 1 }, {}, { cooldowns: -1 });
  assert.equal(one.cooldown - FEO.skillUse.cooldownExtra, 0);
});

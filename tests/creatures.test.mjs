/**
 * Tests for the creatures skills bring onto the map (`module/rules/creatures.mjs`): what a `makes` part says,
 * the stats a creature is made with, the weapon it is handed, how many its maker may have, where several
 * appear, what is asked first, an enemy raised at a kill in a fight the system rolls (`module/rules/combat.mjs`)
 * or by other means (`module/rules/events.mjs`), a skill used on a creature in one of two ways
 * (`module/rules/actions.mjs`), and what becomes of a creature as the battle ends.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FEO } from "../module/config.mjs";
import { actArea, actInstead, actOf, actWays, checkAct } from "../module/rules/actions.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import {
  POSSESSED, actMakes, checkCreatures, checkGrowth, checkMakes, checkTable, controlOf, creatureCost, creatureCount, creatureEnds,
  creatureExtras, creatureHp, creatureNote, creatureRoom, creatureStats, gainsDue, makesIn, makesWeapons, questionsOf, raisable,
  rankedNames, spotsFor, weaponWay, withQualities
} from "../module/rules/creatures.mjs";
import { killMoments } from "../module/rules/events.mjs";
import { RULES, checkEffects, skillStanding, skillTotals } from "../module/rules/skills.mjs";
import { canUse, checkUsage } from "../module/rules/skill-usage.mjs";
import { guardsFor } from "../module/rules/stances.mjs";
import { drawWeapon, weaponPool } from "../module/rules/summon.mjs";
import { buildChange, timedEntries } from "../module/rules/timed.mjs";
import { settleTriangle } from "../module/rules/triangle.mjs";
import { dice, fighter, made as madeUp, skill, unit } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../packs-src/skills/effects.json", import.meta.url)), "utf8")).skills;

const STEP = ["Summon", "Multi-Phantom", "Phantom Skill", "Phantom Support", "Rise", "Reanimate", "Possession", "Infection", "Divide", "Wildkin",
  "Spirit Call", "Conjure", "Reinforce"];

/** What a skill of the step makes: as it is used, or at a kill. */
const makesOf = (name) => makesIn(skill(name).effects)[0];

/** The `act` part of a skill of the step. */
const act = (name) => actOf({ effects: skill(name).effects, usage: skill(name).usage });

/** A unit whose numbers a creature is read from. */
const original = (more = {}) => ({
  hp: 41, weight: 9,
  stats: { str: 9, mag: 22, def: 11, res: 17, dex: 15, spd: 13, luk: 10, mov: 5, con: 7, los: 3 },
  ...more
});

/** Roll out a fight with dice that always come up as `rest`. */
function fight(initiator, defender, { rest = 100 } = {}) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  return resolveExchange(plan, () => rest);
}

const tile = (i, j) => ({ i, j });

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of STEP ) {
    const entry = listed[name];
    assert.ok(entry, `${name} is listed`);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.deepEqual(checkUsage(entry.usage), [], name);
    assert.equal(entry.left, undefined, `${name} leaves nothing to the table`);
  }
  assert.ok(RULES.includes(POSSESSED));
});

test("what a creature may be is checked", () => {
  const sound = { kind: "imp", body: "maker" };
  assert.deepEqual(checkMakes(sound), []);
  assert.equal(checkMakes({ body: "maker" }).length, 1, "it names its kind");
  assert.equal(checkMakes({ kind: "imp", body: "clay" }).length, 1);
  assert.equal(checkMakes({ ...sound, share: [3] }).length, 1);
  assert.equal(checkMakes({ ...sound, stats: { str: { of: "wit" } } }).length, 1);
  assert.equal(checkMakes({ ...sound, stats: { str: {} } }).length, 1);
  assert.equal(checkMakes({ ...sound, hp: 0 }).length, 1);
  assert.equal(checkMakes({ ...sound, control: "anyone" }).length, 1);
  assert.equal(checkMakes({ ...sound, field: true }).length, 1, "a field needs a limit to count");
  assert.equal(checkMakes({ ...sound, costs: { gold: 5 } }).length, 1);
  assert.equal(checkMakes({ ...sound, keeps: true }).length, 1, "only a unit of a class is kept");
  assert.equal(checkMakes({ ...sound, weapon: { draw: "level" } }).length, 1, "a drawn weapon lists its kinds");
  assert.equal(checkMakes({ kind: "imp", body: "table" }).length, 1, "a table lists its options");
  assert.equal(checkMakes({ kind: "imp", body: "class" }).length, 1, "a class is named");

  // A slain unit is raised at a kill, and nothing else is
  assert.equal(checkMakes({ kind: "imp", body: "slain" }).length, 1);
  assert.deepEqual(checkMakes({ kind: "imp", body: "slain", asks: true }, { at: "kill" }), []);
  assert.equal(checkMakes(sound, { at: "kill" }).length, 1);
  assert.equal(checkEffects([{ makes: { kind: "imp", body: "slain" } }]).length > 0, true, "at a moment");
  assert.equal(checkEffects([{ proc: { on: "hit", sure: true }, makes: { kind: "imp", body: "slain" } }]).length > 0, true, "at a kill");
  assert.deepEqual(checkEffects([{ proc: { on: "kill", sure: true }, makes: { kind: "imp", body: "slain" } }]), []);

  // As a skill is used, it appears on one tile that is picked
  const beside = { shape: "radius", radius: 0, centre: "tile", range: { from: 1, within: 1 }, who: "any" };
  assert.deepEqual(checkAct({ area: beside, makes: sound }), []);
  assert.equal(checkAct({ area: { ...beside, radius: 1 }, makes: sound }).length, 1);
  assert.equal(checkAct({ target: { who: "ally" }, makes: sound }).length > 0, true);
  assert.equal(checkAct({ area: beside, makes: sound, heal: 5 }).length, 1);

  // And what a skill says of the creatures another makes
  assert.deepEqual(checkCreatures({ kind: "imp", more: 1, levels: [26] }), []);
  assert.equal(checkCreatures({ kind: "imp" }).length, 1);
  assert.equal(checkCreatures({ kind: "imp", levels: [26] }).length > 0, true);
  assert.equal(checkCreatures({ kind: "imp", skill: "legendary" }).length, 1);
  assert.equal(checkEffects([{ proc: { on: "kill", sure: true }, creatures: { kind: "imp", more: 1 } }]).length > 0, true, "always there");
});

/* -------------------------------------------- */
/*  The Phantom                                 */
/* -------------------------------------------- */

test("Summon: one Phantom of its class on a tile next to its summoner, kept, with a weapon drawn for its level", () => {
  const summon = skill("Summon");
  assert.equal(summon.usage.kind, "action");
  const area = actArea(act("Summon"));
  assert.deepEqual([area.centre, area.radius, area.range], ["tile", 0, { from: 1, within: 1 }]);
  const makes = actMakes(act("Summon"));
  assert.deepEqual([makes.kind, makes.body, makes.class, makes.most, makes.keeps], ["phantom", "class", "Phantom", 1, true]);
  assert.equal(controlOf(makes), "maker", "its summoner's player acts for it");

  // Its weapon type is picked the first time and kept; the weapon itself is drawn each time
  assert.equal(weaponWay(makes), "draw");
  assert.deepEqual(questionsOf(makes).map((question) => [question.id, question.options.map((option) => option.id)]), [["weapon", ["sword", "lance", "axe"]]]);
  assert.deepEqual(questionsOf(makes, { returning: true }), []);
  assert.deepEqual(makes.weapon.pick, FEO.summon.categories);
  assert.deepEqual(weaponPool(1, "axe"), ["Bronze Axe", "Glass Axe", "Devil Axe", "Slim Axe", "Iron Axe"]);
  assert.equal(drawWeapon(weaponPool(1, "axe"), 5), "Iron Axe");

  // One at a time
  const mine = "Actor.summoner";
  assert.equal(creatureRoom(makes, [], mine), 1);
  assert.equal(creatureRoom(makes, [{ kind: "phantom", maker: mine }], mine), 0);
  assert.equal(creatureRoom(makes, [{ kind: "phantom", maker: "Actor.other" }, { kind: "spirit", maker: mine }], mine), 1, "another's, or of another kind");

  // What is noted on it: its growth points are still to be assigned, its gains still to come, and it is kept
  const note = creatureNote(makes, { maker: mine, skill: "Summon", scene: "s", option: "axe" });
  assert.deepEqual(note.growth, { points: 200, barred: ["hp", "def", "res"], due: true });
  assert.deepEqual([note.keeps, note.exp, note.level, note.option, note.control, note.locked], [true, "maker", "maker", "axe", "maker", false]);
  assert.deepEqual(creatureEnds(note, "battle"), { token: true, actor: false }, "it leaves the map, and stays among the Actors");
  assert.deepEqual(creatureEnds(note, "token"), { token: false, actor: false });

  // 200 growth points, none for HP, DEF or RES
  const spread = { hp: 0, str: 60, mag: 0, def: 0, res: 0, dex: 50, spd: 50, luk: 40 };
  assert.deepEqual(checkGrowth(spread, note.growth), { spent: 200, left: 0, valid: true, barred: [] });
  assert.equal(checkGrowth({ ...spread, luk: 30 }, note.growth).valid, false, "ten are left");
  assert.equal(checkGrowth({ ...spread, luk: 45 }, note.growth).left, -5);
  assert.deepEqual(checkGrowth({ ...spread, luk: 30, def: 10 }, note.growth).barred, ["def"]);
  assert.equal(checkGrowth({ ...spread, luk: 40.5 }, note.growth).valid, false);

  // +2 CON and +1 MOV once, at the level it would have promoted at
  assert.equal(gainsDue(note.gains, 20), null);
  assert.deepEqual(gainsDue(note.gains, 21), { con: 2, mov: 1 });
  assert.equal(gainsDue({ ...note.gains, given: true }, 30), null);
  assert.equal(FEO.promotionLevels[0] + 1, makes.gains.level);
});

test("Multi-Phantom: one more Phantom out, and one more again at levels 6 and 11 of Tier 2", () => {
  const makes = actMakes(act("Summon"));
  const skills = [skill("Summon"), skill("Multi-Phantom")];
  const mine = "Actor.summoner";
  const out = (count) => Array.from({ length: count }, () => ({ kind: "phantom", maker: mine }));
  assert.equal(creatureExtras([skill("Summon")], "phantom", 40).more, 0);
  assert.equal(creatureExtras(skills, "phantom", 21).more, 1);
  assert.equal(creatureExtras(skills, "phantom", 25).more, 1);
  assert.equal(creatureExtras(skills, "phantom", 26).more, 2);
  assert.equal(creatureExtras(skills, "phantom", 31).more, 3);
  assert.equal(creatureExtras(skills, "spirit", 31).more, 0, "of that kind alone");
  assert.equal(creatureRoom(makes, out(1), mine, creatureExtras(skills, "phantom", 21).more), 1);
  assert.equal(creatureRoom(makes, out(2), mine, creatureExtras(skills, "phantom", 21).more), 0);
  assert.equal(creatureRoom(makes, out(3), mine, creatureExtras(skills, "phantom", 31).more), 1);
  assert.equal(creatureRoom(makes, out(4), mine, creatureExtras(skills, "phantom", 31).more), 0);
});

test("Phantom Skill: the Phantom has one Generic Skill, picked once", () => {
  const learnt = { ...skill("Phantom Skill"), choice: "" };
  assert.deepEqual(creatureExtras([skill("Summon"), learnt], "phantom").skills, [{ from: "Phantom Skill", sort: "generic", picked: "" }]);
  assert.deepEqual(creatureExtras([{ ...learnt, choice: "Vantage" }], "phantom").skills, [{ from: "Phantom Skill", sort: "generic", picked: "Vantage" }]);
  assert.deepEqual(creatureExtras([learnt], "minion").skills, []);
  assert.ok("generic" in FEO.skillKinds);
});

test("Phantom Support: the aura is given through what the unit has summoned", () => {
  const [effect] = skill("Phantom Support").effects;
  assert.deepEqual([effect.aura.through, effect.aura.unsummoned, effect.aura.within, effect.aura.stack], ["summon", true, 3, false]);
  assert.deepEqual([effect.combat.dodge, effect.combat.critAvoid, effect.stats.def, effect.stats.res], [10, 5, 1, 1]);
});

/* -------------------------------------------- */
/*  Undead                                      */
/* -------------------------------------------- */

test("Rise: an enemy its unit kills is raised with 1 HP and Terror, up to 3 times a map, under the Game Master's hand", () => {
  const rise = skill("Rise");
  assert.deepEqual([rise.usage.kind, rise.usage.uses, rise.usage.per], ["auto", 3, "map"]);
  const makes = makesOf("Rise");
  assert.deepEqual([makes.body, makes.hp, makes.qualities, makes.control, makes.locked, makes.asks], ["slain", 1, ["Terror"], "gm", true, true]);
  assert.equal(controlOf(makes), "gm");

  // In a fight the system rolls: the kill is told, and the use is left to be counted once the unit is raised
  const necromancer = fighter({ name: "A", skills: [rise], stats: { str: 60 } });
  const result = fight(necromancer, fighter({ name: "B", hp: 5, weapon: null }), { rest: 1 });
  assert.equal(result.raises.length, 1);
  assert.deepEqual([result.raises[0].skill, result.raises[0].by, result.raises[0].on, result.raises[0].makes.kind], ["Rise", "initiator", "kill", "undead"]);
  assert.equal((result.counted ?? []).some((entry) => entry.name === "Rise"), false);
  assert.equal(fight(necromancer, fighter({ name: "B", hp: 900, hpMax: 900, weapon: null }), { rest: 1 }).raises, undefined, "a foe that stands is not raised");

  // With no use left nothing is raised
  const spent = fighter({ name: "A", skills: [skill("Rise", { used: 3 })], stats: { str: 60 } });
  assert.equal(fight(spent, fighter({ name: "B", hp: 5, weapon: null }), { rest: 1 }).raises, undefined);
  assert.equal(canUse(rise.usage, { used: 3, cooldown: 0 }).ok, false);
  assert.equal(canUse(rise.usage, { used: 2, cooldown: 0 }).ok, true);

  // By any other means
  const [raised] = killMoments(unit({ skills: [rise] }), unit({ name: "Foe", hp: 0 }), dice()).raises;
  assert.deepEqual([raised.skill, raised.on, raised.makes.body], ["Rise", "kill", "slain"]);

  // It stands up as it was, at 1 HP, with Terror beside what it had
  const fallen = original({ hp: 30 });
  assert.deepEqual(creatureStats(makes, fallen), { hp: 30, stats: fallen.stats });
  assert.equal(creatureHp(makes, 30), 1);
  assert.equal(withQualities("Armored, Bandit", makes.qualities), "Armored, Bandit, Terror");
  assert.equal(withQualities("Flying, terror", makes.qualities), "Flying, terror", "once");
  assert.equal(withQualities("", makes.qualities), "Terror");

  // Only a unit that died of it
  assert.equal(raisable({ hp: 0, state: "dead" }), true);
  assert.equal(raisable({ hp: 0, state: "incapacitated" }), false);
  assert.equal(raisable({ hp: 0, state: "retreated" }), false);
  assert.equal(raisable({ hp: 0, state: "captured" }), false);
  assert.equal(raisable({ hp: 0, state: "" }), false, "what became of it is not known yet");
  assert.equal(raisable({ hp: 4, state: "" }), false);

  // Its pack is locked, and it is gone with the battle, Actor and all
  const note = creatureNote(makes, { maker: "Actor.a", skill: "Rise" });
  assert.deepEqual([note.locked, note.control, note.keeps, note.exp], [true, "gm", false, ""]);
  assert.deepEqual(creatureEnds(note, "battle"), { token: true, actor: true });
  assert.deepEqual(creatureEnds(note, "token"), { token: false, actor: true });
});

test("Reanimate: a minion at three quarters of its maker, STR from MAG, a Steel weapon of choice, 3 at most", () => {
  assert.equal(skill("Reanimate").usage.kind, "action");
  const makes = actMakes(act("Reanimate"));
  const made = creatureStats(makes, original());

  // 41 HP, MAG 22, DEF 11, RES 17, DEX 15, SPD 13, LUK 10, each at 3/4 rounded down; STR is 3/4 of MAG
  assert.equal(made.hp, 30);
  assert.deepEqual(made.stats, { str: 16, mag: 16, def: 8, res: 12, dex: 11, spd: 9, luk: 7, mov: 5, con: 7, los: 3 });
  assert.equal(creatureHp(makes, made.hp), 30, "it appears whole");

  // The weapon is picked as the skill is used
  assert.equal(weaponWay(makes), "pick");
  assert.deepEqual(questionsOf(makes), [{ id: "weapon", options: ["Steel Sword", "Steel Lance", "Steel Axe"].map((name) => ({ id: name, label: name })) }]);
  assert.deepEqual(makesWeapons(makes), { named: ["Steel Sword", "Steel Lance", "Steel Axe"], ranked: [] });
  assert.deepEqual([makes.qualities, makes.control, makes.locked], [["Terror"], "gm", true]);

  // No more than three at once, and those Rise raised are another kind
  const mine = "Actor.deathlord";
  const minions = (count) => Array.from({ length: count }, () => ({ kind: makes.kind, maker: mine }));
  assert.equal(creatureRoom(makes, minions(2), mine), 1);
  assert.equal(creatureRoom(makes, minions(3), mine), 0);
  assert.equal(creatureRoom(makes, [...minions(2), { kind: makesOf("Rise").kind, maker: mine }], mine), 1);
  assert.equal(creatureRoom(makes, [...minions(2), { kind: makes.kind, maker: "Actor.other" }], mine), 1);

  // Whatever it wields, it is at a disadvantage against Light tomes: its foe has the advantage
  const yields = [{ skill: "Reanimate", yields: true }];
  assert.equal(settleTriangle({ category: "sword", parts: yields }, { category: "light" }).advantage, -1);
  assert.equal(settleTriangle({ category: "light" }, { category: "sword", parts: yields }).advantage, 1);
  assert.deepEqual(settleTriangle({ category: "light" }, { category: "sword", parts: yields }).by.granted, ["Reanimate"]);
  const minion = (options = {}) => fighter({ name: "A", skills: [madeUp("Reanimate", makes.effects)], ...options });
  const shine = { name: "Shine", category: "light", range: "1-2", damageStat: "mag", might: 6, hit: 80, crit: 5 };
  const fire = { name: "Fire", category: "fire", range: "1-2", damageStat: "mag" };
  assert.equal(planExchange(fighter({ name: "A" }), fighter({ name: "B", weapon: shine })).triangle.advantage, null, "a sword and a Light tome are no match of the triangle");
  assert.equal(planExchange(minion(), fighter({ name: "B", weapon: shine })).triangle.advantage, "defender");
  assert.equal(planExchange(fighter({ name: "B", weapon: shine }), fighter({ name: "A", skills: [madeUp("Reanimate", makes.effects)] })).triangle.advantage, "initiator");
  assert.equal(planExchange(minion(), fighter({ name: "B", weapon: fire })).triangle.advantage, null, "against Light alone");
});

test("Possession: control of an undead within 3 spaces, or one next to the unit fights in its place", () => {
  const possession = act("Possession");
  assert.deepEqual(possession.target, { who: "ally", within: 3, made: ["Rise", "Reanimate"], unacted: true });

  // Which ways are open goes by how near the undead stands, and whether it has acted
  assert.deepEqual(actWays(possession, { distance: 3 }), ["main"]);
  assert.deepEqual(actWays(possession, { distance: 4 }), []);
  assert.deepEqual(actWays(possession, { distance: 1 }), ["main", "instead"]);
  assert.deepEqual(actWays(possession, { distance: 1, acted: true }), ["instead"]);
  assert.deepEqual(actWays(possession, { distance: 2, acted: true }), []);

  // The first way: +3 to six stats and its maker's hand, until the undead's own turn ends
  const context = { skill: "Possession", from: "Necromancer", giver: "Actor.necromancer" };
  const held = buildChange({ name: "Possession", ...possession.grant }, context);
  assert.deepEqual([held.ends, held.turns, held.by, held.clock], ["turnEnd", 1, "Actor.necromancer", ""]);
  const totals = skillTotals(timedEntries([held]), { stats: {} });
  assert.deepEqual(totals.stats, { str: 3, def: 3, res: 3, dex: 3, spd: 3, con: 3 });
  assert.ok(totals.rules.has ? totals.rules.has(POSSESSED) : totals.rules.includes(POSSESSED));

  // The other: it stands in for the unit alone, as Protect has it, until the unit's next turn starts
  const other = actInstead(possession);
  assert.equal(other.target.within, 1);
  assert.equal(other.instead, undefined);
  assert.deepEqual(other.grant, possession.instead.grant);
  const stands = buildChange({ name: "Possession", ...other.grant }, context);
  assert.deepEqual([stands.ends, stands.clock, stands.stance.mark], ["turnStart", "Actor.necromancer", "guard"]);
  const [way] = skillStanding(timedEntries([stands]), { name: "Undead" }).guard;
  assert.equal(way.only, "Actor.necromancer");
  const on = (id, i, j, side = "player", more = {}) => ({ id, uuid: `Actor.${id}`, tile: { i, j }, side, ...more });
  const necromancer = on("necromancer", 5, 5);
  const undead = on("undead", 5, 4, "player", { guard: [way] });
  const ally = on("ally", 4, 4);
  const foe = on("foe", 5, 6, "enemy");
  assert.deepEqual(guardsFor(necromancer, foe, [necromancer, undead, ally, foe]).map((offer) => offer.guard), ["undead"]);
  assert.deepEqual(guardsFor(ally, foe, [necromancer, undead, ally, foe]), []);
});

test("Infection: an enemy its unit kills stands up as a Revenant at half its stats, 1 HP, no skills, basic Claws", () => {
  const infection = skill("Infection");
  assert.equal(infection.usage, null, "it takes effect by itself, as often as its unit kills");
  const makes = makesOf("Infection");
  assert.deepEqual([makes.body, makes.class, makes.hp, makes.skills, makes.pack, makes.weapon], ["slain", "Revenant", 1, false, false, "Claws"]);
  assert.equal(controlOf(makes), "maker");

  // In a fight, and by any other means
  const revenant = fighter({ name: "A", skills: [infection], stats: { str: 60 } });
  assert.deepEqual(fight(revenant, fighter({ name: "B", hp: 5, weapon: null }), { rest: 1 }).raises.map((entry) => [entry.skill, entry.by]), [["Infection", "initiator"]]);
  assert.equal(killMoments(unit({ skills: [infection] }), unit({ name: "Foe", hp: 0 }), dice()).raises.length, 1);

  // A unit attacked by one that kills it raises it too
  const victim = fighter({ name: "A", hp: 3, stats: { str: 1 } });
  const answer = fight(victim, fighter({ name: "B", skills: [infection], stats: { str: 60 } }), { rest: 1 });
  assert.deepEqual(answer.raises.map((entry) => entry.by), ["defender"]);

  // Half of what the enemy had, rounded down; MOV, CON and LoS are the Revenant's
  const revenantClass = { hp: 22, str: 6, mov: 4, con: 9, los: 2 };
  const made = creatureStats(makes, original(), { classBase: revenantClass });
  assert.equal(made.hp, 20);
  assert.deepEqual(made.stats, { str: 4, mag: 11, def: 5, res: 8, dex: 7, spd: 6, luk: 5, mov: 4, con: 9, los: 2 });
  assert.equal(creatureHp(makes, made.hp), 1);
  assert.deepEqual(makesWeapons(makes), { named: ["Claws"], ranked: [] });
  assert.deepEqual(questionsOf(makes), []);
});

/* -------------------------------------------- */
/*  Other Creatures                             */
/* -------------------------------------------- */

test("Divide: Mogalls at a third of its stats for 5 HP each, 5 on the field at most", () => {
  const makes = actMakes(act("Divide"));
  assert.deepEqual([makes.class, makes.share, makes.most, makes.field, makes.many, makes.costs.hp, makes.weapon], ["Mogall", [1, 3], 5, true, 5, 5, "Eye"]);
  const mogallClass = { mov: 6, con: 3, los: 4 };
  const made = creatureStats(makes, original(), { classBase: mogallClass });
  assert.equal(made.hp, 13);
  assert.deepEqual(made.stats, { str: 3, mag: 7, def: 3, res: 5, dex: 5, spd: 4, luk: 3, mov: 6, con: 3, los: 4 });

  // The field is counted whoever made them
  const mine = "Actor.archmogall";
  const others = [{ kind: "mogall", maker: "Actor.other" }, { kind: "mogall", maker: mine }, { kind: "mogall", maker: mine }];
  assert.equal(creatureRoom(makes, others, mine), 2);
  assert.equal(creatureRoom(makes, [...others, ...others], mine), 0);

  // How many one use makes: what it says, what the field has room for, what its HP pays, what tiles there are
  assert.equal(creatureCount(makes, { room: 5, hp: 40, tiles: 4 }), 4);
  assert.equal(creatureCount(makes, { room: 2, hp: 40, tiles: 4 }), 2);
  assert.equal(creatureCount(makes, { room: 5, hp: 11, tiles: 4 }), 2, "5 HP each, and it keeps 1");
  assert.equal(creatureCount(makes, { room: 5, hp: 5, tiles: 4 }), 0);
  assert.deepEqual(creatureCost(makes, 3), { hp: 15 });
  assert.deepEqual(questionsOf(makes, { room: 3 }), [{ id: "count", options: [1, 2, 3].map((n) => ({ id: String(n), label: String(n) })) }]);
  assert.deepEqual(questionsOf(makes, { room: 1 }), [], "one is not asked for");

  // The first on the tile picked, the others on the free tiles nearest to it
  const free = [tile(4, 5), tile(5, 6), tile(6, 5), tile(5, 4)];
  assert.deepEqual(spotsFor(tile(5, 6), 3, free, tile(5, 5)), [tile(5, 6), tile(4, 5), tile(6, 5)]);
  assert.deepEqual(spotsFor(tile(5, 6), 9, free, tile(5, 5)).length, 4);
  assert.deepEqual(spotsFor(tile(9, 9), 2, free, tile(5, 5)), [], "the tile picked must be free");
});

test("Wildkin: one animal of its table a map, at shares of the Warden's stats, with a Laguz weapon of its best rank", () => {
  const wildkin = skill("Wildkin");
  assert.deepEqual([wildkin.usage.uses, wildkin.usage.per, wildkin.usage.free], [1, "map", true]);
  const makes = actMakes(act("Wildkin"));
  assert.deepEqual(questionsOf(makes), [{ id: "option", options: ["Bear", "Eagle", "Wolf"].map((name) => ({ id: name, label: name })) }]);
  assert.equal(controlOf(makes), "maker");
  const warden = original({ hp: 40, weight: 10, stats: { str: 20, mag: 10, def: 10, res: 8, dex: 20, spd: 20, luk: 10, mov: 6, con: 8, los: 3 } });
  const option = (name) => makes.options.find((entry) => entry.name === name);

  const bear = creatureStats(makes, warden, { option: option("Bear") });
  assert.equal(bear.hp, 36);
  assert.deepEqual(bear.stats, { str: 17, mag: 5, def: 8, res: 6, dex: 13, spd: 12, luk: 7, mov: 6, con: 30, los: 3 });
  const eagle = creatureStats(makes, warden, { option: option("Eagle") });
  assert.deepEqual([eagle.hp, eagle.stats.spd, eagle.stats.mov, eagle.stats.con, eagle.stats.los], [30, 18, 9, 7, 4]);
  const wolf = creatureStats(makes, warden, { option: option("Wolf") });
  assert.deepEqual([wolf.hp, wolf.stats.dex, wolf.stats.mov, wolf.stats.con, wolf.stats.los], [34, 18, 8, 18, 5]);
  assert.deepEqual(makes.options.map((entry) => entry.qualities), [["Beast"], ["Flying"], ["Beast"]]);

  // Fang, Talon and Claw, of the rank of the Warden's best proficiency
  assert.deepEqual(makesWeapons(makes), { named: [], ranked: ["Tiger Fang", "Talon", "Claw"] });
  assert.deepEqual(rankedNames("Talon", "C").slice(0, 2), ["Talon (C)", "Great Talon (C)"]);
  assert.equal(rankedNames("Talon", "S").includes("Great Talon (S)"), true);
  assert.deepEqual(rankedNames("Claw", "F").slice(0, 1), ["Claw (E)"], "E at least");
  assert.equal(rankedNames("Claw", "A").at(-2), "Claw (E)", "down to E where a rank is not listed");

  // The table on the sheet and the options are kept the same by the build
  const head = ["Animal", "HP", "STR", "MAG", "DEF", "RES", "DEX", "SPD", "LUK", "MOV", "WT", "LoS", "Special Quality"];
  const rows = [
    ["Bear", "90%", "85%", "50%", "80%", "75%", "65%", "60%", "70%", "6", "3", "3", "Beast"],
    ["Eagle", "75%", "70%", "50%", "65%", "60%", "85%", "90%", "80%", "9", "70%", "4", "Flying"],
    ["Wolf", "85%", "80%", "50%", "70%", "60%", "90%", "75%", "65%", "8", "1.8", "5", "Beast"]
  ];
  assert.deepEqual(checkTable(makes.options, head, rows), []);
  const changed = rows.map((row) => [...row]);
  changed[0][2] = "80%";
  changed[2][12] = "Flying";
  assert.equal(checkTable(makes.options, head, changed).length, 2);
  assert.equal(checkTable(makes.options, head, rows.slice(0, 2)).length, 1);

  // It is gone with the battle
  assert.deepEqual(creatureEnds(creatureNote(makes, { maker: "Actor.w", skill: "Wildkin", option: "Bear" }), "battle"), { token: true, actor: true });
});

test("Spirit Call: a Spirit with its maker's stats, 30 HP and half its DEF and RES, with the tome of a type that is picked", () => {
  const call = skill("Spirit Call");
  assert.deepEqual([call.usage.kind, call.usage.uses, call.usage.per, call.usage.free], ["action", 1, "map", undefined]);
  const makes = actMakes(act("Spirit Call"));
  const made = creatureStats(makes, original());
  assert.equal(made.hp, 30);
  assert.deepEqual(made.stats, { ...original().stats, def: 5, res: 8 });
  const [asked] = questionsOf(makes);
  assert.equal(asked.id, "weapon");
  assert.deepEqual(asked.options.map((option) => option.label), ["Fire (Rexflame)", "Thunder (Rexbolt)", "Wind (Rexcalibur)", "Light (Rexaura)", "Dark (Balberith)"]);
  assert.equal(makesWeapons(makes).named.length, 5);
  assert.equal(creatureRoom(makes, [{ kind: "spirit", maker: "Actor.m" }], "Actor.m"), Infinity, "its uses limit it, not a count");
});

test("Conjure and Reinforce: units the Game Master has prepared, as tokens of their own", () => {
  const conjure = actMakes(act("Conjure"));
  assert.deepEqual([conjure.body, conjure.many, conjure.qualities], ["prepared", 5, ["Terror"]]);
  assert.equal(skill("Conjure").usage.cooldown, 3);
  assert.deepEqual(questionsOf(conjure), [], "which, and how many, is picked in a list of its own");
  assert.equal(creatureCount(conjure, { tiles: 3 }), 3);
  assert.equal(creatureCount(conjure, {}), 5);

  // No Actor is made for them: they go with the battle as tokens
  const terror = creatureNote(conjure, { maker: "Actor.cantor", skill: "Conjure", own: false });
  assert.deepEqual(creatureEnds(terror, "battle"), { token: true, actor: false });
  assert.deepEqual(creatureEnds(terror, "token"), { token: false, actor: false });

  // Reinforcements arrive anywhere on the map and stay
  const reinforce = act("Reinforce");
  assert.equal(actArea(reinforce).range.within, 99);
  const arrived = creatureNote(actMakes(reinforce), { maker: "Actor.boss", skill: "Reinforce", own: false });
  assert.equal(arrived.lasts, "stays");
  assert.deepEqual(creatureEnds(arrived, "battle"), { token: false, actor: false });
  assert.equal(creatureCount(actMakes(reinforce), { tiles: 40 }), 12);
});

test("what is not a creature has nothing end with the battle", () => {
  assert.deepEqual(creatureEnds(null, "battle"), { token: false, actor: false });
  assert.deepEqual(creatureEnds(undefined, "sweep"), { token: false, actor: false });
  assert.deepEqual(creatureEnds(creatureNote(makesOf("Rise"), { maker: "a", skill: "Rise" }), "sweep"), { token: false, actor: true });
});

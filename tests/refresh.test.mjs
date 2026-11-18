/**
 * Tests for `module/rules/refresh.mjs` and what Step 11 gave the skills, the fight, staves and the changes
 * that last a while: who a Refresh may be used on, how skills reshape it, the other ways it is used, the
 * Refresh a skill hands out as something else is done, and temporary HP.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { killMoments } from "../module/rules/events.mjs";
import {
  NO_SONG, canRefresh, checkRefresh, checkRefreshes, cursesFor, emptyRefresh, farthest, groupOf, nearGroup, nearest, optionsOf,
  rangeAt, refreshSpent, songsFor
} from "../module/rules/refresh.mjs";
import { usesLeft } from "../module/rules/skill-usage.mjs";
import { RULES, checkEffects, skillRefresh, skillTotals } from "../module/rules/skills.mjs";
import { castStaff } from "../module/rules/staves.mjs";
import {
  PHASE_END, TIMED_ENDS, buildChange, cleanChange, grantChange, spendTemp, splitHp, tempHp, tickChanges, timedEntries
} from "../module/rules/timed.mjs";
import { dice, fighter, made, skill, unit } from "./lib/fixtures.mjs";

const STEP = ["Refresh", "Inspiring Song", "Cantrip", "Hymn", "Resonance", "Reverberate", "Ancient Verse", "Galdr", "Power Chord",
  "Call to Arms", "Offensive Stafftics", "Lead by Example", "Staffsong", "Raucous Roar"];

/** A unit as its skills are asked about it outside of a fight. */
const self = (more = {}) => ({ hp: 20, hpMax: 20, level: 5, tier: 1, stats: { mag: 9, luk: 13 }, conditions: {}, qualities: "", shifted: false, ...more });

/** What a unit with these skills makes of Refresh. */
const singer = (skills, more = {}) => skillRefresh(skills, self(more));

/** An ally next to the singer that has acted, as the rules read it. */
const ally = (more = {}) => ({ relation: "friend", distance: 1, out: false, state: "acted", sings: false, rules: [], hurt: true, afflicted: true, gauge: true, ...more });

/** Roll out a fight in which every die comes up as told. */
function fight(initiator, defender, roll) {
  return resolveExchange(planExchange(initiator, defender, { distance: 1 }), () => roll);
}

/** A unit as the staff rules read it. */
const caster = (skills, more = {}) => ({
  name: "Singer", uuid: "Actor.Singer", hp: 20, hpMax: 20, level: 5, tier: 2, stats: { mag: 10, luk: 8 }, conditions: {},
  qualities: "", skills, near: null, activation: 0, always: false, staffHit: 100, ...more
});
const patient = (more = {}) => ({
  name: "Ally", uuid: "Actor.Ally", hp: 10, hpMax: 20, level: 5, stats: {}, conditions: {}, qualities: "", skills: [], near: null,
  ally: true, enemy: false, staffAvoid: 0, ...more
});
const HEAL = { name: "Heal", effect: "Heals target by 10 + MAG.", range: "1", hit: 100 };
const PHYSIC = { name: "Physic", effect: "Heals target by 10 + MAG.", range: "1-MAG/2", hit: 100 };
const SLEEP = { name: "Sleep", effect: "Target is afflicted with Sleep.", range: "1-MAG/2", hit: 100 };

/** The Refreshes the skills that waited for a staff hand out. */
const sungBy = (cast) => cast.moments.filter((moment) => moment.refreshes).map((moment) => [moment.skill, moment.refreshes.to]);

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of STEP ) assert.deepEqual(checkEffects(skill(name).effects), [], name);
  for ( const name of ["Inspiring Song", "Cantrip"] ) {
    assert.deepEqual(checkEffects(skill(name, { choice: "DEX, LUK, STR" }).effects), [], name);
  }
});

test("a typing mistake in a refresh part does not pass silently", () => {
  assert.deepEqual(checkRefresh({ use: true }), []);
  assert.deepEqual(checkRefresh({ range: { max: 3, without: ["Inspiring Song"] } }), []);
  assert.deepEqual(checkRefresh({ targets: "all" }), []);
  assert.deepEqual(checkRefresh({ gives: { hp: 10, ends: "phaseEnd" } }), []);
  assert.deepEqual(checkRefresh({ curses: { within: 4, effects: [{ stats: { str: -3 } }], ends: "turnEnd" } }), []);
  assert.deepEqual(checkRefresh({ option: { id: "heal", instead: true, heal: { of: "mag" } } }), []);
  assert.equal(checkRefresh({}).length, 1);
  assert.equal(checkRefresh({ use: "yes" }).length, 1);
  assert.equal(checkRefresh({ reach: 2 }).length, 1);
  assert.equal(checkRefresh({ range: { max: 0 } }).length, 1);
  assert.equal(checkRefresh({ range: { max: 2, without: [] } }).length, 1);
  assert.equal(checkRefresh({ targets: 1 }).length, 1);
  assert.equal(checkRefresh({ gives: { ends: "turnStart" } }).length, 1, "a change needs effects, or temporary HP");
  assert.equal(checkRefresh({ gives: { effects: [{}], ends: "whenever" } }).length, 1);
  assert.equal(checkRefresh({ curses: { effects: [{}], ends: "turnEnd" } }).length, 1, "an enemy must be within some reach");
  assert.equal(checkRefresh({ option: { id: "heal", heal: 5 } }).length, 1, "what replaces the Action is used instead of it");
  assert.equal(checkRefresh({ option: { id: "idle", instead: true } }).length, 1, "an option does something");
  assert.equal(checkRefresh({ option: { instead: true, cure: "all" } }).length, 1, "an option has an id");

  // What a Refresh lays over a unit is checked as any effect is, and it is always there
  assert.equal(checkEffects([{ refresh: { gives: { effects: [{ stat: { str: 3 } }], ends: "turnStart" } } }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "kill", sure: true }, refresh: { use: true } }]).length, 1);
  assert.equal(checkEffects([{ when: { role: "initiating" }, refresh: { use: true } }]).length, 1);
});

test("a typing mistake in a refreshes part does not pass silently", () => {
  const kill = { on: "kill", sure: true };
  const staff = { on: "staff", sure: true, ally: true };
  assert.deepEqual(checkRefreshes({ to: "near", once: "turn" }, kill), []);
  assert.deepEqual(checkRefreshes({ to: "self", once: "turn", times: 2 }, { on: "after", stat: "dex" }), []);
  assert.deepEqual(checkRefreshes({ to: "target" }, staff), []);
  assert.deepEqual(checkRefreshes({ to: "pick", within: "staff", may: true }, staff), []);
  assert.equal(checkRefreshes({ to: "everyone" }, kill).length, 1);
  assert.equal(checkRefreshes({ to: "near" }, { on: "turnStart", sure: true }).length >= 1, true);
  assert.equal(checkRefreshes({ to: "target" }, kill).length, 1, "only a staff has a target");
  assert.equal(checkRefreshes({ to: "pick" }, staff).length, 1, "a pick says how near");
  assert.equal(checkRefreshes({ to: "self", times: 2 }, kill).length, 1, "times count what is limited");
  assert.equal(checkRefreshes({ to: "self", once: "map" }, kill).length, 1);
  assert.equal(checkEffects([{ proc: { on: "kill", sure: true }, refreshes: { to: "nearby" } }]).length, 1);
});

/* -------------------------------------------- */
/*  The Command                                 */
/* -------------------------------------------- */

test("the skill Refresh gives its unit the command", () => {
  assert.deepEqual(singer([]), emptyRefresh());
  const refresh = singer([skill("Refresh")]);
  assert.equal(refresh.use, true);
  assert.equal(refresh.skill, "Refresh");
  assert.equal(refresh.targets, 1);
  assert.equal(farthest(refresh), 1);

  // The songs alone give no command
  assert.equal(singer([skill("Inspiring Song", { choice: "STR, DEF" }), skill("Hymn")]).use, false);

  // A rule keeps a unit that has the skill from using it, as Imitate will have it
  assert.ok(RULES.includes(NO_SONG));
});

test("a Refresh is for an ally next to the unit that has acted", () => {
  const refresh = singer([skill("Refresh")]);
  assert.equal(canRefresh(refresh, ally()).ok, true);
  assert.equal(canRefresh(refresh, ally({ state: "moving" })).ok, true, "one that still moves after its Action has acted");
  const why = (more) => canRefresh(refresh, ally(more)).why;
  assert.equal(why({ relation: "self" }), "self");
  assert.equal(why({ relation: "foe" }), "side");
  assert.equal(why({ relation: "apart" }), "side");
  assert.equal(why({ out: true }), "out");
  assert.equal(why({ state: "down" }), "out");
  assert.equal(why({ distance: 2 }), "apart");
  assert.equal(why({ sings: true }), "singer", "a unit with Refresh is not Refreshed");
  assert.equal(why({ rules: ["noRefresh"] }), "barred");
  assert.equal(why({ state: "ready" }), "ready");
  assert.equal(why({ state: "waiting" }), "phase");
  assert.equal(why({ state: "free" }), "phase");
});

test("Hustle keeps its unit from being Refreshed while it is on, and while its price lasts", () => {
  const rules = (skills) => [...skillTotals(skills, self()).rules];
  const hustling = rules([skill("Hustle", { active: true })]);
  assert.equal(canRefresh(singer([skill("Refresh")]), ally({ rules: hustling })).why, "barred");
  assert.equal(canRefresh(singer([skill("Refresh")]), ally({ rules: rules([skill("Hustle")]) })).ok, true);
});

/* -------------------------------------------- */
/*  Reach and Number                            */
/* -------------------------------------------- */

test("Hymn has Refresh reach 2 spaces, and 3 without the buffs of Inspiring Song", () => {
  const refresh = singer([skill("Refresh"), skill("Hymn"), skill("Inspiring Song", { choice: "STR, DEF" }), skill("Call to Arms")]);
  assert.equal(farthest(refresh), 3);
  assert.deepEqual(rangeAt(refresh, 1).without, []);
  assert.deepEqual(rangeAt(refresh, 2).without, []);
  assert.deepEqual(rangeAt(refresh, 3).without, ["Inspiring Song"]);
  assert.equal(rangeAt(refresh, 4), null);
  assert.equal(canRefresh(refresh, ally({ distance: 3 })).ok, true);
  assert.equal(canRefresh(refresh, ally({ distance: 4 })).why, "apart");

  // What the songs lay over an ally 2 spaces away, and what is left of it at 3
  const near = songsFor(refresh, { distance: 2, range: rangeAt(refresh, 2) });
  assert.deepEqual(near.map((song) => song.skill).sort(), ["Call to Arms", "Inspiring Song"]);
  const far = songsFor(refresh, { distance: 3, range: rangeAt(refresh, 3) });
  assert.deepEqual(far.map((song) => song.skill), ["Call to Arms"]);
});

test("Resonance has Refresh reach 2 allies, 3 at Tier 3, and Reverberate all of them in animal form", () => {
  assert.equal(singer([skill("Refresh"), skill("Resonance")], { tier: 2 }).targets, 2);
  assert.equal(singer([skill("Refresh"), skill("Resonance")], { tier: 3 }).targets, 3);
  assert.equal(singer([skill("Refresh"), skill("Reverberate")], { shifted: false }).targets, 1);
  assert.equal(singer([skill("Refresh"), skill("Reverberate")], { shifted: true }).targets, Infinity);
  assert.equal(singer([skill("Refresh"), skill("Reverberate"), skill("Resonance")], { shifted: true }).skills.targets, "Reverberate");
});

/* -------------------------------------------- */
/*  What Songs Lay Over It                      */
/* -------------------------------------------- */

test("Inspiring Song lays the buffs its unit picked over a Refresh, as one change until the ally's next turn", () => {
  const refresh = singer([skill("Refresh"), skill("Inspiring Song", { choice: "DEX, CON, STR" })]);
  const songs = songsFor(refresh, { distance: 1 });
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, "Inspiring Song");
  assert.equal(songs[0].ends, "turnStart");
  assert.deepEqual(songs[0].effects, [{ stats: { dex: 5 } }, { stats: { con: 2 } }, { stats: { str: 3 } }]);

  // As the ally carries it: one entry among its skills, named after the song and the singer
  const change = buildChange(songs[0], { skill: songs[0].skill, from: "Ninian", giver: "Actor.Ninian" });
  const [entry] = timedEntries([change]);
  assert.equal(entry.name, "Inspiring Song (Ninian)");
  assert.equal(tickChanges([change], "turnEnd").list.length, 1);
  assert.equal(tickChanges([change], "turnStart").list.length, 0);

  // Nothing picked, nothing given
  assert.deepEqual(songsFor(singer([skill("Refresh"), skill("Inspiring Song")]), { distance: 1 }), []);
});

test("Cantrip puts the debuffs its unit picked on the enemy nearest to it, within 4 spaces", () => {
  const refresh = singer([skill("Refresh"), skill("Cantrip", { choice: "MOV, LUK" })]);
  const [curse] = cursesFor(refresh);
  assert.equal(curse.within, 4);
  assert.equal(curse.ends, "turnEnd");
  assert.deepEqual(curse.effects, [{ stats: { luk: -5 } }, { stats: { mov: -2 } }]);
  assert.deepEqual(songsFor(refresh, { distance: 1 }), [], "it gives the ally nothing");

  const foes = [{ id: "a", distance: 5 }, { id: "b", distance: 3 }, { id: "c", distance: 3 }, { id: "d", distance: 4 }];
  assert.deepEqual(nearest(foes, curse.within).map((foe) => foe.id), ["b", "c"], "those equally near are for the singer to pick from");
  assert.deepEqual(nearest([{ id: "a", distance: 5 }], curse.within), []);
});

test("Call to Arms gives 10 temporary HP until the Phase ends, and has its unit Refreshed with the allies around", () => {
  const refresh = singer([skill("Call to Arms")]);
  assert.equal(refresh.self, true);
  const [song] = songsFor(refresh, { distance: 1 });
  assert.equal(song.hp, 10);
  assert.equal(song.ends, PHASE_END);
  const change = buildChange(song, { skill: song.skill, from: "Herald" });
  assert.equal(change.hp, 10);
  assert.equal(tempHp([change]), 10);
});

/* -------------------------------------------- */
/*  Other Ways to Use It                        */
/* -------------------------------------------- */

test("Ancient Verse offers three ways to use Refresh instead of the regular one", () => {
  const refresh = singer([skill("Refresh"), skill("Ancient Verse")], { stats: { mag: 9, luk: 13 } });
  const ways = optionsOf(refresh);
  assert.deepEqual(ways.map((way) => way.id), ["Ancient Verse:heal", "Ancient Verse:guard", "Ancient Verse:calm"]);
  assert.ok(ways.every((way) => way.instead && !way.cooldown));
  const [heal, guard, calm] = ways;
  assert.equal(heal.heal, 9, "HP equal to the singer's MAG");
  assert.deepEqual(songsFor(refresh, { distance: 1, option: guard })[0].effects, [{ stats: { def: 3, res: 3 } }], "a quarter of its LUK");
  assert.deepEqual(songsFor(refresh, { distance: 1, option: calm })[0].effects, [{ rules: ["foeNoCrit"] }]);
  assert.equal(songsFor(refresh, { distance: 1, option: calm })[0].ends, "turnEnd");

  // Used instead of the Action given back, it is for any ally in reach that it does something for
  assert.equal(canRefresh(refresh, ally({ state: "ready" }), { option: heal }).ok, true);
  assert.equal(canRefresh(refresh, ally({ state: "ready", sings: true, rules: ["noRefresh"] }), { option: guard }).ok, true);
  assert.equal(canRefresh(refresh, ally({ hurt: false }), { option: heal }).why, "full");
  assert.equal(canRefresh(refresh, ally({ distance: 2 }), { option: heal }).why, "apart");
  assert.equal(canRefresh(refresh, ally({ relation: "foe" }), { option: heal }).why, "side");
});

test("Galdr offers five more, two of them until the end of the Phase", () => {
  const refresh = singer([skill("Refresh"), skill("Galdr")], { stats: { luk: 22 } });
  const ways = Object.fromEntries(optionsOf(refresh).map((way) => [way.id.split(":")[1], way]));
  assert.deepEqual(Object.keys(ways), ["cure", "gauge", "mov", "str", "mag"]);
  assert.equal(ways.cure.cure, "all");
  assert.equal(ways.gauge.gauge, "turn");
  assert.equal(canRefresh(refresh, ally({ afflicted: false }), { option: ways.cure }).why, "well");
  assert.equal(canRefresh(refresh, ally({ gauge: false }), { option: ways.gauge }).why, "gauge");
  const [stride] = songsFor(refresh, { distance: 1, option: ways.mov });
  assert.deepEqual(stride.effects, [{ stats: { mov: 2 } }]);
  assert.equal(stride.ends, PHASE_END);
  assert.deepEqual(songsFor(refresh, { distance: 1, option: ways.str })[0].effects, [{ stats: { str: 5 } }]);
  assert.deepEqual(songsFor(refresh, { distance: 1, option: ways.mag })[0].effects, [{ stats: { mag: 5 } }]);

  // What ends with the Phase ends with it, whatever its unit has done, and at no moment of a turn
  const change = buildChange(stride, { skill: "Galdr", from: "Reyson" });
  assert.equal(tickChanges([change], "turnEnd").list.length, 1);
  assert.equal(tickChanges([change], "turnStart").list.length, 1);
  assert.equal(tickChanges([change], PHASE_END).list.length, 0);
});

test("Power Chord gives buffs by range, alone on a cooldown of 3 or with the other songs on one of 5", () => {
  const refresh = singer([skill("Refresh"), skill("Hymn"), skill("Inspiring Song", { choice: "LUK" }), skill("Power Chord")]);
  const [alone, withSongs] = optionsOf(refresh);
  assert.equal(alone.alone, true);
  assert.equal(alone.cooldown, 3);
  assert.equal(withSongs.alone, false);
  assert.equal(withSongs.cooldown, 5);
  assert.ok(!alone.instead && !withSongs.instead, "the ally acts again either way");

  const at = (distance, option) => songsFor(refresh, { distance, range: rangeAt(refresh, distance), option });
  assert.deepEqual(at(1, alone), [{ skill: "Power Chord", name: "Power Chord", ends: "turnStart", effects: [{ stats: { str: 3, mag: 3, def: 3, res: 3 } }] }]);
  assert.deepEqual(at(2, alone)[0].effects, [{ stats: { dex: 5, luk: 5, spd: 3, con: 2 } }]);
  assert.deepEqual(at(3, alone)[0].effects, [{ stats: { def: 3, res: 3, mov: 2 } }]);
  assert.deepEqual(at(1, withSongs).map((song) => song.skill), ["Inspiring Song", "Power Chord"]);
  assert.deepEqual(at(1, null).map((song) => song.skill), ["Inspiring Song"], "the regular way leaves Power Chord out");
  assert.deepEqual(cursesFor(singer([skill("Cantrip", { choice: "STR" })]), alone), [], "alone, nothing else comes with it");

  // While its cooldown runs the skill gives nothing: the map leaves it out of what the unit's skills make of Refresh
  const chord = skill("Power Chord");
  assert.equal(usesLeft(chord.usage, chord.state), 1);
  assert.equal(usesLeft(chord.usage, { ...chord.state, cooldown: 4 }), 0);
  assert.equal(optionsOf(refresh, () => false).length, 0);
});

/* -------------------------------------------- */
/*  Handed Out by Other Things                  */
/* -------------------------------------------- */

test("Lead by Example hands out a Refresh as its unit defeats a foe in its own turn, once a turn", () => {
  const slayer = fighter({ name: "A", hp: 40, hpMax: 40, skills: [skill("Lead by Example")], stats: { str: 30, spd: 20 } });
  const part = { to: "near", once: "turn" };
  const won = fight(slayer, fighter({ name: "B", hp: 5, stats: { def: 0 } }), 1);
  assert.deepEqual(won.refreshes, [{ skill: "Lead by Example", by: "initiator", refreshes: part }]);
  assert.equal(fight(slayer, fighter({ name: "B", hp: 60, hpMax: 60, stats: { def: 30 } }), 1).refreshes, undefined, "no kill, no Refresh");

  // Not for the unit that was attacked: its allies have not acted in another side's Phase
  const answered = fight(fighter({ name: "B", hp: 5, stats: { def: 0, spd: 0 } }), slayer, 1);
  assert.equal(answered.refreshes, undefined);

  // A foe brought down by other means, in its own turn
  const foe = unit({ name: "Foe", hp: 0 });
  assert.deepEqual(killMoments(unit({ skills: [skill("Lead by Example")], inTurn: true }), foe, dice()).refreshes, [{ skill: "Lead by Example", refreshes: part }]);
  assert.deepEqual(killMoments(unit({ skills: [skill("Lead by Example")], inTurn: false }), foe, dice()).refreshes, []);

  // Once a turn
  assert.equal(refreshSpent("Lead by Example", part, {}), false);
  assert.equal(refreshSpent("Lead by Example", part, { "Lead by Example": 1 }), true);
  assert.equal(refreshSpent("Lead by Example", { to: "near" }, { "Lead by Example": 5 }), false, "nothing limits it unless it says so");
});

test("the allies next to the unit or next to its foe are Refreshed: its owner picks where both have some", () => {
  assert.deepEqual(nearGroup([], []), { group: null, ask: false });
  assert.deepEqual(nearGroup(["a"], []), { group: "self", ask: false });
  assert.deepEqual(nearGroup([], ["b", "c"]), { group: "foe", ask: false });
  assert.deepEqual(nearGroup(["a", "b"], ["b", "a"]), { group: "self", ask: false });
  assert.deepEqual(nearGroup(["a"], ["b"]), { group: null, ask: true });
  assert.equal(groupOf("a", ["a"], ["b", "c"]), "self");
  assert.equal(groupOf("c", ["a"], ["b", "c"]), "foe");
  assert.equal(groupOf("a", ["a"], ["a", "b"]), "foe", "an ally in both stands for the larger group");
  assert.equal(groupOf("z", ["a"], ["b"]), null);
});

test("Raucous Roar Refreshes its unit after a fight it started, twice a turn at most, with HST for a kill", () => {
  const roarer = (more = {}) => fighter({ name: "A", hp: 40, hpMax: 40, skills: [skill("Raucous Roar")], stats: { str: 30, spd: 20, dex: 30 }, ...more });
  const part = { to: "self", once: "turn", times: 2 };

  // Rolled at DEX/1.5: the Refresh comes with a roll that passes, and the HST only where the foe fell
  const stood = fight(roarer(), fighter({ name: "B", hp: 60, hpMax: 60, stats: { def: 40 } }), 1);
  assert.deepEqual(stood.refreshes, [{ skill: "Raucous Roar", by: "initiator", refreshes: part }]);
  assert.equal((stood.granted ?? []).length, 0);
  const felled = fight(roarer(), fighter({ name: "B", hp: 5, stats: { def: 0 } }), 1);
  assert.deepEqual(felled.refreshes, [{ skill: "Raucous Roar", by: "initiator", refreshes: part }]);
  assert.equal(felled.granted.length, 1);
  assert.deepEqual(felled.granted[0].change.effects, [{ haste: 2 }]);
  assert.equal(felled.granted[0].change.ends, "turnEnd");
  assert.equal(fight(roarer(), fighter({ name: "B", hp: 5, stats: { def: 0 } }), 100).refreshes, undefined, "a roll that fails brings nothing");

  // Not when it is attacked
  assert.equal(fight(fighter({ name: "B", hp: 60, hpMax: 60, stats: { def: 40, str: 0 } }), roarer(), 1).refreshes, undefined);

  // Twice a turn: once it has, the skill has nothing more to give in a fight
  assert.equal(refreshSpent("Raucous Roar", part, { "Raucous Roar": 1 }), false);
  assert.equal(refreshSpent("Raucous Roar", part, { "Raucous Roar": 2 }), true);
  const spent = planExchange({ ...roarer(), goes: ["Raucous Roar"] }, fighter({ name: "B", hp: 5, stats: { def: 0 } }), { distance: 1 });
  assert.equal(resolveExchange(spent, () => 1).refreshes, undefined);
});

test("Staffsong has a staff used on an ally next to its unit act as a Refresh", () => {
  const cast = (staff, distance, skills = [skill("Staffsong")]) => castStaff({ staff, caster: caster(skills), target: patient(), distance });
  assert.deepEqual(sungBy(cast(HEAL, 1)), [["Staffsong", "target"]]);
  assert.deepEqual(sungBy(cast(PHYSIC, 3)), [], "not from further away");
  assert.deepEqual(sungBy(castStaff({ staff: HEAL, caster: caster([skill("Staffsong")]), target: null })), [], "nor used on nobody");
  assert.deepEqual(sungBy(cast(HEAL, 1, [])), []);
});

test("Offensive Stafftics does the same for a staff of Range 1-MAG/2, and after an Offensive Staff hits", () => {
  const skills = [skill("Offensive Stafftics")];
  const onAlly = (staff, distance) => castStaff({ staff, caster: caster(skills), target: patient(), distance });
  assert.deepEqual(sungBy(onAlly(PHYSIC, 4)), [["Offensive Stafftics", "target"]]);
  assert.deepEqual(sungBy(onAlly(HEAL, 1)), [], "a staff of another Range does not");

  // An Offensive Staff that hits an enemy lets the unit pick an ally within the staff's reach; one that misses does not
  const foe = patient({ name: "Foe", ally: false, enemy: true, staffAvoid: 0 });
  const hit = castStaff({ staff: SLEEP, caster: caster(skills), target: foe, distance: 2, d100: dice(1) });
  assert.equal(hit.missed, false);
  assert.deepEqual(sungBy(hit), [["Offensive Stafftics", "pick"]]);
  assert.deepEqual(hit.moments[0].refreshes, { to: "pick", within: "staff", may: true });
  assert.deepEqual(hit.reach, { min: 1, max: 5, changed: false });
  const miss = castStaff({ staff: SLEEP, caster: caster(skills, { staffHit: 0 }), target: patient({ name: "Foe", ally: false, enemy: true, staffAvoid: 50 }), distance: 2, d100: dice(100) });
  assert.equal(miss.missed, true);
  assert.deepEqual(sungBy(miss), []);

  // With both skills a staff next to an ally still Refreshes once: each skill says so, and the ally acts again once
  const both = castStaff({ staff: PHYSIC, caster: caster([skill("Staffsong"), skill("Offensive Stafftics")]), target: patient(), distance: 1 });
  assert.equal(sungBy(both).length, 2);
});

/* -------------------------------------------- */
/*  Temporary HP                                */
/* -------------------------------------------- */

test("a lasting change can hold temporary HP, which are lost first and gone with it", () => {
  assert.ok(TIMED_ENDS.includes(PHASE_END));
  const lent = buildChange({ hp: 10, effects: [], ends: "phaseEnd" }, { skill: "Call to Arms", from: "Herald" });
  const fury = buildChange({ hp: 6, effects: [{ combat: { hit: 20 } }], ends: "turnEnd", turns: 3 }, { skill: "Primal Fury", own: true });
  assert.equal(tempHp([lent, fury]), 16);
  assert.equal(tempHp([]), 0);
  assert.equal(tempHp([{ name: "Plain", effects: [] }]), 0);

  // Those that go soonest are lost first; a change that only held HP is over once they are spent
  const some = spendTemp([fury, lent], 4);
  assert.equal(some.spent, 4);
  assert.deepEqual(some.list.map((change) => [change.name, change.hp]), [["Primal Fury", 6], ["Call to Arms", 6]]);
  const more = spendTemp([fury, lent], 13);
  assert.deepEqual(more.list.map((change) => [change.name, change.hp]), [["Primal Fury", 3]]);
  const all = spendTemp([fury, lent], 99);
  assert.equal(all.spent, 16);
  assert.deepEqual(all.list.map((change) => [change.name, change.hp]), [["Primal Fury", 0]], "one that does more stays, without its HP");
  assert.equal(lent.hp, 10, "what was handed in is left as it was");

  // Granted again it is renewed, not added to; it is kept as a change is saved; and it ends with its change
  assert.equal(tempHp(grantChange([{ ...lent, hp: 3 }], lent).list), 10);
  assert.equal(cleanChange(lent, () => []).hp, 10);
  assert.equal(cleanChange({ ...lent, hp: -1 }, () => []), null);
  assert.equal(tempHp(tickChanges([lent], PHASE_END).list), 0);
});

test("what a unit loses comes off its temporary HP before its own, and what it regains is its own", () => {
  const hp = { value: 20, max: 30, temp: 10 };
  assert.deepEqual(splitHp(hp, 30), { value: 20, temp: 10 }, "nothing changed");
  assert.deepEqual(splitHp(hp, 24), { value: 20, temp: 4 });
  assert.deepEqual(splitHp(hp, 20), { value: 20, temp: 0 });
  assert.deepEqual(splitHp(hp, 12), { value: 12, temp: 0 });
  assert.deepEqual(splitHp(hp, 0), { value: 0, temp: 0 });
  assert.deepEqual(splitHp(hp, -4), { value: -4, temp: 0 }, "a unit that keeps count below 0");
  assert.deepEqual(splitHp(hp, 35), { value: 25, temp: 10 });
  assert.deepEqual(splitHp(hp, 60), { value: 30, temp: 10 }, "its own HP stop at their maximum");
  assert.deepEqual(splitHp({ value: 30, max: 30, temp: 10 }, 40), { value: 30, temp: 10 }, "over its maximum, as the HP are lent");
  assert.deepEqual(splitHp({ value: 8, max: 30, temp: 0 }, 3), { value: 3, temp: 0 });
});

test("a grant in a fight can hold temporary HP read from its unit, and can wait for a kill", () => {
  const fury = made("Fury", [{ proc: { on: "start", sure: true }, grant: { to: "self", hp: { of: "hpMax", div: 4, round: "up" }, effects: [{ combat: { hit: 20 } }], ends: "turnEnd", turns: 3 } }]);
  assert.deepEqual(checkEffects(fury.effects), []);
  const raging = fight(fighter({ name: "A", hp: 30, hpMax: 30, skills: [fury], stats: { str: 0 } }), fighter({ name: "B", hp: 60, hpMax: 60, stats: { def: 30, str: 0 } }), 1);
  assert.equal(raging.granted[0].change.hp, 8, "a quarter of 30, rounded up");
  assert.equal(checkEffects([{ proc: { on: "after", sure: true }, grant: { to: "self", effects: [{ haste: 2 }], ends: "turnEnd", kill: "yes" } }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "turnStart", sure: true }, grant: { to: "self", effects: [{ haste: 2 }], ends: "turnEnd", kill: true } }]).length, 1);
});

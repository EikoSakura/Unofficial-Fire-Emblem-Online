/**
 * Tests for action skills that take in an area (see `module/rules/areas.mjs`), for Line of Sight (see
 * `module/rules/sight.mjs`), and for what the conditions of the units around a unit do to it: the shapes an
 * area can have, where it may be placed and whom it catches; what blocks sight; and the skills of the step as
 * they are written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { actArea, actInflicts, actOf, checkAct, userGrant } from "../module/rules/actions.mjs";
import {
  areaCatches, areaCentre, areaCentres, areaTiles, areaUnits, checkArea, lineArea, shareWith, sharesCost, sharesRoom, sharesTotal
} from "../module/rules/areas.mjs";
import { standing } from "../module/rules/auras.mjs";
import { planExchange } from "../module/rules/combat.mjs";
import { aroundTicks, conditionModifiers, conditionsAround, startTurn, tickDamage } from "../module/rules/conditions.mjs";
import { matchesNear, surroundings } from "../module/rules/positions.mjs";
import { tileKey } from "../module/rules/reach.mjs";
import { sees, sightBar, sightReach, sightTiles } from "../module/rules/sight.mjs";
import { checkEffects, coverageOf, holds, readNumber, resolveGiven, skillTotals } from "../module/rules/skills.mjs";
import { canUse, checkUsage, spendSkill } from "../module/rules/skill-usage.mjs";
import { buildChange, grantChange, tickChanges, timedEntries } from "../module/rules/timed.mjs";
import { FEO } from "../module/config.mjs";
import { fighter, skill } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(new URL("../packs-src/skills/effects.json", import.meta.url), "utf8")).skills;

/** The skill as an Item's data has it, and what it does as an action. */
const data = (name) => ({ effects: listed[name].effects, usage: skill(name).usage, automate: true });
const act = (name) => actOf(data(name));

const STEP = ["Immolation", "Unnerve", "Howl", "Smoke Bomb", "Lunar Cry", "Holy War", "Malaise", "Dogma", "Waterwheel", "Override", "Staredown",
  "Sacrifice", "Spotting"];

const at = (i, j) => ({ i, j });
const keys = (tiles) => tiles.map(tileKey).sort();
const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);

/** A map of 10 by 10 tiles. */
const inside = (tile) => (tile.i >= 0) && (tile.i < 10) && (tile.j >= 0) && (tile.j < 10);

/** A unit on the map, as an area asks about it. */
const placed = (id, relation, i, j, more = {}) => ({ id, relation, tile: at(i, j), ...more });

/** A unit with a token on the map, as the position rules read it. */
function token(id, side, i, j, more = {}) {
  return {
    id, actor: `Actor.${id}`, name: id.toUpperCase(), side, tile: at(i, j), hp: 20, hpMax: 20, level: 5,
    stats: { str: 10, mag: 4, def: 6, res: 3, dex: 8, spd: 8, luk: 5, los: 5 }, totals: { los: 5 }, skills: [], ...more
  };
}

/* -------------------------------------------- */
/*  The Parts                                   */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know, and leave nothing to the table", () => {
  for ( const name of STEP ) {
    const entry = listed[name];
    assert.deepEqual(checkEffects(entry.effects), [], name);
    if ( entry.usage ) assert.deepEqual(checkUsage(entry.usage), [], name);
    assert.equal(entry.left, undefined, name);
    assert.ok(entry.note, name);
    assert.equal(coverageOf({ effect: "x", listed: true, left: entry.left ?? "" }), "done", name);
  }
});

test("a typing mistake in an area does not pass silently", () => {
  assert.deepEqual(checkArea({ shape: "radius", radius: 2, who: "any", self: true }), []);
  assert.deepEqual(checkArea({ shape: "radius", radius: 2, centre: "tile", range: { from: 1, within: 3 } }), []);
  assert.deepEqual(checkArea({ shape: "square", radius: 1 }), []);
  assert.deepEqual(checkArea({ shape: "line", reach: "units" }), []);
  assert.deepEqual(checkArea({ shape: "line", reach: 3 }), []);
  assert.deepEqual(checkArea({ shape: "sight" }), []);
  assert.deepEqual(checkArea({ shape: "map", who: "enemy", only: { quality: ["Terror"], ranks: ["dark"] } }), []);
  assert.equal(checkArea({ shape: "circle" }).length, 1);
  assert.equal(checkArea({ shape: "radius" }).length, 1);
  assert.equal(checkArea({ shape: "radius", radius: 2, centre: "tile" }).length, 1, "a tile to centre on needs a range");
  assert.equal(checkArea({ shape: "radius", radius: 2, range: { within: 3 } }).length, 1, "a range needs a tile to centre on");
  assert.equal(checkArea({ shape: "sight", radius: 2 }).length, 1);
  assert.equal(checkArea({ shape: "radius", radius: 2, reach: 3 }).length, 1);
  assert.equal(checkArea({ shape: "map", who: "foe" }).length, 1);
  assert.equal(checkArea({ shape: "map", only: { ranks: ["shadow"] } }).length, 1);
  assert.equal(checkArea({ shape: "map", width: 3 }).length, 1);
});

test("a skill is used on a target or takes in an area, and an area skill says only what it can do", () => {
  const area = { shape: "radius", radius: 2 };
  assert.deepEqual(checkAct({ area, inflicts: ["stun"] }), []);
  assert.deepEqual(checkAct({ area, strike: { hand: true } }), []);
  assert.deepEqual(checkAct({ area: { shape: "line", reach: "units" }, strike: { hand: true, plain: true }, through: true }), []);
  assert.deepEqual(checkAct({ area, shares: { gives: 2 } }), []);
  assert.deepEqual(checkAct({ target: { who: "enemy", within: 1 }, inflicts: [{ id: "malaise", turns: 3 }] }), []);
  assert.equal(checkAct({ area, target: { who: "enemy" }, inflicts: ["stun"] }).length, 1);
  assert.equal(checkAct({ area, inflicts: ["dizzy"] }).length, 1);
  assert.equal(checkAct({ area, inflicts: ["stun"], through: true }).length, 1, "only a line is moved through");
  assert.equal(checkAct({ area, inflicts: ["stun"], move: "swap" }).length, 1);
  assert.equal(checkAct({ target: { who: "enemy", within: 1 }, strike: { hand: true } }).length, 1, "the weapon in hand is for an area");
  assert.equal(checkAct({ target: { who: "ally", within: 1 }, heal: 5, user: { grant: { effects: [{ stats: { str: 1 } }] } } }).length, 1);
  assert.equal(checkAct({ area, shares: { gives: 0 } }).length, 1);
  assert.equal(checkAct({ area, grant: { effects: [{ stats: { str: 1 } }] }, again: { grant: { effects: [] } } }).length >= 1, true, "again says what it costs");
  assert.equal(checkAct({ area }).length, 1, "an area alone does nothing");
});

/* -------------------------------------------- */
/*  Shapes                                      */
/* -------------------------------------------- */

test("a radius is counted along rows and columns, a square takes in the diagonals", () => {
  const radius = areaTiles({ shape: "radius", radius: 2 }, at(5, 5), null, { inside });
  assert.equal(radius.length, 13);
  assert.ok(keys(radius).includes("3,5") && keys(radius).includes("4,4") && !keys(radius).includes("3,4"));
  const square = areaTiles({ shape: "square", radius: 1 }, at(5, 5), null, { inside });
  assert.deepEqual(keys(square), keys([at(4, 4), at(4, 5), at(4, 6), at(5, 4), at(5, 5), at(5, 6), at(6, 4), at(6, 5), at(6, 6)]));

  // The edge of the map cuts an area off
  assert.equal(areaTiles({ shape: "radius", radius: 2 }, at(0, 0), null, { inside }).length, 6);
  assert.equal(areaTiles({ shape: "map" }, at(0, 0), null, { inside }), null, "the whole map has no tiles of its own");
});

test("an area centred on a tile lies where it is placed, within its range of the unit", () => {
  const area = act("Smoke Bomb").area;
  assert.equal(areaCentre(area), "tile");
  const centres = areaCentres(area, at(5, 5), inside);
  assert.equal(centres.length, 24, "1 to 3 spaces away: 4 + 8 + 12 tiles");
  assert.ok(!keys(centres).includes("5,5"), "not the unit's own tile");
  assert.ok(keys(centres).includes("5,8") && !keys(centres).includes("5,9"));

  // Placed 3 spaces away, it takes in the tiles within 2 spaces of that tile
  const tiles = areaTiles(area, at(5, 5), at(5, 8), { inside });
  assert.ok(keys(tiles).includes("5,9") && keys(tiles).includes("3,8") && keys(tiles).includes("5,6") && !keys(tiles).includes("5,5"));
  assert.equal(areaTiles(area, at(5, 5), null, { inside }).length, 0, "nowhere until it is placed");
  assert.equal(areaCentre(act("Immolation").area), "self");
  assert.deepEqual(areaCentres(act("Immolation").area, at(5, 5), inside), []);
});

test("a line runs from the unit through the unit next to it, for so many tiles or as long as units stand in it", () => {
  const fixed = lineArea(at(5, 5), at(5, 6), { reach: 3, inside });
  assert.deepEqual(fixed.tiles, [at(5, 6), at(5, 7), at(5, 8)]);
  assert.deepEqual(fixed.beyond, at(5, 9));

  // Enemies on 5,6 and 5,7, none on 5,8: the line ends there, and that is where the unit lands
  const foes = new Set(["5,6", "5,7", "5,9"]);
  const run = lineArea(at(5, 5), at(5, 6), { reach: "units", holds: (tile) => foes.has(tileKey(tile)), inside });
  assert.deepEqual(run.tiles, [at(5, 6), at(5, 7)]);
  assert.deepEqual(run.beyond, at(5, 8));

  // Up a column, to the edge of the map: there is no tile past it
  const up = lineArea(at(1, 5), at(0, 5), { reach: "units", holds: () => true, inside });
  assert.deepEqual(up.tiles, [at(0, 5)]);
  assert.equal(up.beyond, null);
  assert.deepEqual(lineArea(at(5, 5), at(6, 6), { reach: 3, inside }).tiles, [], "not through a diagonal neighbour");
  assert.deepEqual(lineArea(at(5, 5), at(5, 7), { reach: 3, inside }).tiles, [], "nor through a tile further off");
  assert.equal(areaCentre({ shape: "line", reach: "units" }), "unit");
});

test("an area catches the units it is for that stand in it, the nearest first", () => {
  const units = [
    placed("far", "foe", 5, 7), placed("near", "foe", 5, 6), placed("friend", "friend", 4, 5), placed("me", "self", 5, 5),
    placed("out", "foe", 5, 9), placed("other", "apart", 6, 5)
  ];
  const tiles = areaTiles({ shape: "radius", radius: 2 }, at(5, 5), null, { inside });
  const ids = (area) => areaUnits(area, tiles, units, at(5, 5)).map((unit) => unit.id);
  assert.deepEqual(ids({ who: "enemy" }), ["near", "far"]);
  assert.deepEqual(ids({ who: "ally" }), ["friend"]);
  assert.deepEqual(ids({ who: "any", self: true }), ["me", "near", "friend", "other", "far"]);
  assert.deepEqual(ids({}), ["near", "far"], "enemies unless it says otherwise");
  assert.deepEqual(areaUnits({ who: "enemy" }, null, units, at(5, 5)).map((unit) => unit.id), ["near", "far", "out"], "the whole map");
});

/* -------------------------------------------- */
/*  Line of Sight                               */
/* -------------------------------------------- */

test("Line of Sight is the LoS stat in spaces, and a straight line that crosses a blocking tile blocks it", () => {
  const wall = (tile) => (tile.i === 5) && (tile.j === 7);
  const field = { inside, blocked: wall };
  assert.equal(sees(at(5, 5), at(5, 9), 4, {}), true, "4 spaces away with a LoS of 4");
  assert.equal(sees(at(5, 5), at(5, 9), 3, {}), false, "too far");
  assert.equal(sees(at(5, 5), at(5, 9), 5, field), false, "the wall on 5,7 stands in the line");
  assert.equal(sightBar(at(5, 5), at(5, 9), 5, field), "blocked");
  assert.equal(sightBar(at(5, 5), at(5, 9), 3, field), "far");
  assert.equal(sees(at(5, 5), at(4, 8), 5, field), true, "a line that passes beside the wall is clear");
  assert.equal(sees(at(5, 5), at(5, 6), 5, field), true, "in front of the wall");
  assert.equal(sees(at(5, 5), at(5, 5), 0, field), true, "its own tile");

  // A wall of the scene between the two blocks it as well
  assert.equal(sees(at(5, 5), at(5, 6), 5, { wall: () => true }), false);
  assert.equal(sightBar(at(5, 5), at(5, 6), 5, { wall: () => true }), "wall");

  // Units do not block sight: only what the field says does
  assert.equal(sees(at(5, 5), at(5, 8), 5, { blocked: () => false }), true);
});

test("a Thicket takes 1 from the Line of Sight of a unit in it, and hides a unit from all but its neighbours", () => {
  const thicket = (tile) => (tile.i === 5) && (tile.j === 5);
  assert.equal(sightReach(4, at(5, 5), { dims: (tile) => (thicket(tile) ? -1 : 0) }), 3);
  assert.equal(sees(at(5, 5), at(5, 9), 4, { dims: (tile) => (thicket(tile) ? -1 : 0) }), false);
  assert.equal(sees(at(5, 9), at(5, 5), 5, { hides: thicket }), false, "seen only from next to it");
  assert.equal(sees(at(5, 6), at(5, 5), 5, { hides: thicket }), true);
  assert.equal(sightBar(at(5, 9), at(5, 5), 5, { hides: thicket }), "hidden");
  assert.equal(FEO.terrain.types.thicket.los, -1);
  assert.equal(FEO.terrain.types.thicket.hides, true);
  assert.equal(FEO.terrain.types.wall.impassable, true, "what nobody crosses is what blocks sight");
});

test("the tiles in a unit's sight leave out those behind a wall", () => {
  const wall = (tile) => (tile.i === 5) && (tile.j === 6);
  const open = sightTiles(at(5, 5), 3, { inside });
  assert.equal(open.length, 25, "every tile within 3 spaces");
  const shadowed = keys(sightTiles(at(5, 5), 3, { inside, blocked: wall }));
  assert.ok(!shadowed.includes("5,6"), "the wall itself");
  assert.ok(!shadowed.includes("5,7") && !shadowed.includes("5,8"), "and the tiles behind it");
  assert.ok(shadowed.includes("4,6") && shadowed.includes("6,6") && shadowed.includes("5,4"));
  assert.equal(areaTiles({ shape: "sight" }, at(5, 5), null, { inside, los: 3, sight: { blocked: wall } }).length, shadowed.length);
});

test("the units around a unit say whom it sees and who sees it", () => {
  const wall = (tile) => (tile.i === 0) && (tile.j === 2);
  const sight = (a, b) => sees(a.tile, b.tile, a.totals.los, { blocked: wall });
  const units = [token("a", "player", 0, 0), token("b", "enemy", 0, 4), token("c", "enemy", 2, 0), token("d", "player", 0, 9, { totals: { los: 9 } })];
  const near = surroundings(units, "a", measure, sight);
  const of = (id) => near.others.find((other) => other.id === id);
  assert.equal(of("b").seen, false, "the wall stands between them");
  assert.equal(of("b").sees, false);
  assert.equal(of("c").seen, true);
  assert.equal(of("d").seen, false, "9 spaces away with a LoS of 5");
  assert.equal(of("d").sees, false, "D sees that far, but the wall is in its line");
  assert.equal(surroundings(units, "a", measure).others[0].seen, undefined, "nothing is said where sight is not told");
  assert.equal(matchesNear({ relation: "ally", distance: 3, sees: true }, { who: "ally", sees: true }), true);
  assert.equal(matchesNear({ relation: "ally", distance: 3, sees: false }, { who: "ally", sees: true }), false);
  assert.equal(matchesNear({ relation: "ally", distance: 3, stats: { los: 5 } }, { who: "ally", sees: true }), true, "by the stat where the map is not known");
  assert.equal(matchesNear({ relation: "ally", distance: 6, stats: { los: 5 } }, { who: "ally", sees: true }), false);
});

test("a foe within the unit's Line of Sight is one it sees, not only one that near", () => {
  const self = (seen) => ({ hp: 20, hpMax: 20, stats: { los: 5 }, near: { id: "a", others: [{ id: "b", relation: "enemy", distance: 3, ...seen }] } });
  const fight = { role: "defending", distance: 3, foe: { hp: 20, hpMax: 20, stats: {}, near: { id: "b", others: [] } } };
  assert.equal(holds({ inSight: true }, self({ seen: true }), fight), true);
  assert.equal(holds({ inSight: true }, self({ seen: false }), fight), false, "a wall in between");
  assert.equal(holds({ inSight: true }, self({}), fight), true, "by the stat where sight is not told");
  assert.equal(holds({ inSight: true }, self({}), { ...fight, distance: 6 }), false);
});

/* -------------------------------------------- */
/*  The Skills                                  */
/* -------------------------------------------- */

test("Immolation: 2 turns of Burn for the unit and every unit within 2 spaces, friend or foe", () => {
  const does = act("Immolation");
  assert.deepEqual(actArea(does), { shape: "radius", radius: 2, who: "any", self: true });
  assert.deepEqual(actInflicts(does.inflicts), [{ id: "burn", turns: 2 }]);
  assert.equal(skill("Immolation").usage.cooldown, 4);
  const units = [placed("me", "self", 5, 5), placed("ally", "friend", 5, 6), placed("foe", "foe", 4, 4), placed("far", "foe", 5, 8)];
  const caught = areaUnits(does.area, areaTiles(does.area, at(5, 5), null, { inside }), units, at(5, 5));
  assert.deepEqual(caught.map((unit) => unit.id), ["me", "ally", "foe"]);
});

test("Unnerve Rattles and Howl Stuns every foe within 2 spaces, and nobody else", () => {
  for ( const [name, condition, cooldown] of [["Unnerve", "rattled", 3], ["Howl", "stun", 4]] ) {
    const does = act(name);
    assert.deepEqual(actInflicts(does.inflicts), [{ id: condition }], name);
    assert.equal(skill(name).usage.cooldown, cooldown, name);
    const units = [placed("me", "self", 5, 5), placed("ally", "friend", 5, 6), placed("foe", "foe", 4, 4), placed("far", "foe", 5, 8)];
    const caught = areaUnits(does.area, areaTiles(does.area, at(5, 5), null, { inside }), units, at(5, 5));
    assert.deepEqual(caught.map((unit) => unit.id), ["foe"], name);
  }
});

test("Smoke Bomb: enemies in the area lose 30 Hit and Dodge and half their MOV until the end of their next turn", () => {
  const does = act("Smoke Bomb");
  const change = buildChange(does.grant, { skill: "Smoke Bomb", from: "Hero", giver: "Actor.hero", giverInTurn: true });
  assert.equal(change.ends, "turnEnd");
  assert.equal(change.turns, 1);
  const foe = fighter({ name: "Foe", stats: { mov: 5 } });
  const totals = skillTotals(timedEntries(grantChange([], change).list), foe);
  assert.equal(totals.combat.hit, -30);
  assert.equal(totals.combat.dodge, -30);
  assert.equal(totals.statTimes.incoming.mov ?? totals.statTimes.own.mov, 0.5, "its MOV is halved");

  // The end of the enemy's next turn ends it
  assert.equal(tickChanges([change], "turnEnd").list.length, 0);
  assert.equal(skill("Smoke Bomb").usage.cooldown, 4);
});

test("Lunar Cry: +2 for the unit for every enemy caught and -2 for each of them, for 3 of the unit's turns", () => {
  const does = act("Lunar Cry");
  assert.equal(does.area.radius, 4);
  assert.equal(userGrant(does.user, 0), null, "nobody caught, nothing gained");
  const mine = buildChange({ ...userGrant(does.user, 3), name: "Lunar Cry" }, { skill: "Lunar Cry", own: true, carrierInTurn: true });
  assert.equal(mine.stacks, 3);
  const unit = fighter({ name: "Wolf" });
  const gained = skillTotals(timedEntries([mine]), unit).stats;
  assert.deepEqual({ str: gained.str, dex: gained.dex, spd: gained.spd, def: gained.def }, { str: 6, dex: 6, spd: 6, def: 6 });

  // The enemies carry theirs by the turns of the unit that howled: both end as its third turn from now starts
  const theirs = buildChange(does.grant, { skill: "Lunar Cry", from: "Wolf", giver: "Actor.wolf", giverInTurn: true });
  assert.equal(theirs.clock, "Actor.wolf");
  assert.equal(skillTotals(timedEntries([theirs]), fighter({ name: "Foe" })).stats.str, -2);
  let list = [theirs];
  let own = [mine];
  for ( let turn = 1; turn <= 3; turn++ ) {
    assert.equal(list.length, 1, `still there before turn ${turn}`);
    list = tickChanges(list, "turnStart", "Actor.wolf").list;
    own = tickChanges(own, "turnStart").list;
  }
  assert.equal(list.length, 0);
  assert.equal(own.length, 0);
  assert.equal(skill("Lunar Cry").usage.cooldown, 5);
});

test("Holy War: once a map, enemies with a Dark rank or the Terror quality lose 3, and the unit gains 3 against them", () => {
  const does = act("Holy War");
  const usage = skill("Holy War").usage;
  assert.equal(usage.uses, 1);
  assert.equal(usage.per, "map");
  assert.equal(usage.free, true, "its Effect does not call it an action");
  assert.equal(canUse(usage, spendSkill(usage, { active: false, cooldown: 0, lasting: 0, used: 0 })).ok, false, "once");
  const units = [
    placed("mage", "foe", 0, 0, { ranks: ["dark", "staff"] }), placed("terror", "foe", 9, 9, { qualities: "Terror, Flying" }),
    placed("knight", "foe", 5, 5, { ranks: ["lance"], qualities: "Armored" }), placed("ally", "friend", 1, 1, { ranks: ["dark"] })
  ];
  assert.deepEqual(areaUnits(does.area, null, units, at(5, 0)).map((unit) => unit.id), ["mage", "terror"]);
  assert.equal(areaCatches(does.area, placed("x", "foe", 0, 0, { ranks: ["light"] })), false);

  // The enemy carries the -3 for 3 of its turns, and the mark for the rest of the map
  const context = { skill: "Holy War", from: "Crusader", giver: "Actor.crusader" };
  const weakened = buildChange(does.grant, context);
  assert.equal(weakened.turns, 3);
  const mark = buildChange({ name: does.mark.name, effects: [], mark: true, ends: does.mark.ends }, context);
  assert.equal(mark.ends, "map");
  const lost = skillTotals(timedEntries([weakened, mark]), fighter({ name: "Mage" })).stats;
  assert.deepEqual({ str: lost.str, mag: lost.mag, def: lost.def, res: lost.res }, { str: -3, mag: -3, def: -3, res: -3 });

  // And the unit has +3 against an enemy that carries its mark, and none against another
  const crusader = fighter({ name: "Crusader", skills: [skill("Holy War")] });
  const marked = { ...fighter({ name: "Mage" }), timed: [mark] };
  const plain = planExchange(crusader, fighter({ name: "Mage" }));
  const sworn = planExchange(crusader, marked);
  assert.equal(sworn.initiator.damage - plain.initiator.damage, 3, "+3 STR");
  assert.equal(plain.defender.damage - sworn.defender.damage, 3, "+3 DEF");
});

test("Malaise is a condition: -4 DEX and SPD and a tenth of maximum HP each turn, for 3 turns", () => {
  const does = act("Malaise");
  assert.deepEqual(does.target, { who: "enemy", within: 1 });
  assert.deepEqual(actInflicts(does.inflicts), [{ id: "malaise", turns: 3 }]);
  assert.equal(skill("Malaise").usage.cooldown, 3);
  assert.equal(FEO.conditions.malaise.turns, 3);
  assert.deepEqual(conditionModifiers({ malaise: 3 })[0].stats, { dex: -4, spd: -4 });
  assert.deepEqual(tickDamage("malaise", 3, 37), { percent: 10, damage: 3 });
  const turn = startTurn({ hp: 37, hpMax: 37, conditions: { malaise: 3 } });
  assert.equal(turn.hp, 34);
  assert.equal(turn.conditions.malaise, 2);
});

test("Malaise reaches the allies of the unit that suffers it within 3 spaces: -2 DEX and SPD, and damage once a turn", () => {
  const sick = token("sick", "enemy", 0, 0, { conditions: ["malaise"] });
  const units = [sick, token("close", "enemy", 0, 3), token("far", "enemy", 0, 4), token("hero", "player", 0, 1), token("also", "enemy", 1, 2, { conditions: ["malaise"] })];
  const near = (id) => surroundings(units, id, measure);
  assert.deepEqual(conditionsAround(near("close")).map((found) => [found.id, found.unit]), [["malaise", "also"]], "once, from the nearest");
  assert.equal(conditionsAround(near("far")).length, 1, "4 spaces from the first afflicted unit, 3 from the second");
  assert.equal(conditionsAround(surroundings([sick, token("far", "enemy", 0, 4)], "far", measure)).length, 0, "4 spaces away");
  assert.equal(conditionsAround(near("hero")).length, 0, "its enemies are untouched");

  // A tenth of its own maximum HP, rounded down, once in each of its turns
  assert.deepEqual(aroundTicks(near("close"), 37).map((tick) => tick.damage), [3]);
  assert.deepEqual(aroundTicks(near("close"), 37, { taken: ["malaise"] }), [], "not again as the turn ends");
  assert.deepEqual(aroundTicks(near("hero"), 37), []);

  // And -2 DEX and SPD as one more aura it receives, while it stands that near
  const auras = standing(units, "close", measure).auras;
  assert.equal(auras.length, 1);
  assert.deepEqual(auras[0].effects, [{ stats: { dex: -2, spd: -2 } }]);
  assert.equal(standing([sick, token("far", "enemy", 0, 4)], "far", measure).auras.length, 0);
  const totals = skillTotals(auras, fighter({ name: "Close" }));
  assert.equal(totals.stats.dex, -2);
  assert.equal(totals.stats.spd, -2);
});

test("Dogma: twice a map, the Skill Activation rate of every ally rises by the unit's LUK until its next turn starts", () => {
  const does = act("Dogma");
  const usage = skill("Dogma").usage;
  assert.equal(usage.uses, 2);
  assert.equal(usage.per, "map");
  assert.equal(usage.free, undefined, "it is the unit's Action");
  assert.equal(does.area.shape, "map");
  assert.equal(areaCatches(does.area, placed("ally", "friend", 0, 0)), true);
  assert.equal(areaCatches(does.area, placed("me", "self", 0, 0)), false);
  assert.equal(areaCatches(does.area, placed("foe", "foe", 0, 0)), false);

  // The LUK is that of the unit that uses it, as the skill is used
  const giver = { hp: 20, hpMax: 20, level: 5, stats: { luk: 17 } };
  const grant = resolveGiven(does.grant, giver);
  assert.deepEqual(grant.effects, [{ combat: { activation: 17 } }]);
  const change = buildChange(grant, { skill: "Dogma", from: "Seer", giver: "Actor.seer", giverInTurn: true });
  assert.equal(skillTotals(timedEntries([change]), fighter({ name: "Ally" })).combat.activation, 17);
  assert.equal(tickChanges([change], "turnStart").list.length, 1, "its own turn does not end it");
  assert.equal(tickChanges([change], "turnStart", "Actor.seer").list.length, 0, "the next turn of the unit that gave it does");

  // Extending it costs a quarter of maximum HP, and leaves the unit nothing but to move and Wait that turn
  assert.equal(readNumber(does.again.pays, { hp: 9, hpMax: 38, stats: {} }, null), 9);
  const bound = buildChange(does.again.grant, { skill: "Dogma", own: true, carrierInTurn: true });
  assert.equal(bound.ends, "turnEnd");
  assert.equal(bound.turns, 1);
  assert.ok(skillTotals(timedEntries([bound]), fighter({ name: "Seer" })).rules.has("onlyWait"));
});

test("Waterwheel: one attack with the weapon in hand on every unit around the user, diagonals included", () => {
  const does = act("Waterwheel");
  assert.deepEqual(does.strike, { hand: true });
  assert.equal(skill("Waterwheel").usage.cooldown, 4);
  const tiles = areaTiles(does.area, at(5, 5), null, { inside });
  const units = [
    placed("me", "self", 5, 5), placed("n", "foe", 4, 5), placed("ne", "foe", 4, 6), placed("ally", "friend", 6, 4), placed("two", "foe", 5, 7)
  ];
  assert.deepEqual(areaUnits(does.area, tiles, units, at(5, 5)).map((unit) => unit.id), ["n", "ne", "ally"], "all units, not the user");

  // The attack is one that is not answered and strikes once, at whatever distance the two stand
  const lancer = fighter({ name: "Lancer", stats: { spd: 20 }, weapon: { name: "Iron Lance", category: "lance", range: "1" } });
  const plan = planExchange(lancer, fighter({ name: "Foe" }), { distance: 2, extra: { skill: "Waterwheel", share: 1 } });
  assert.equal(plan.initiator.blocked, null, "a diagonal neighbour is 2 spaces away, and is struck all the same");
  assert.deepEqual(plan.order, ["initiator"], "once, with no follow-up and no counter-attack");
});

test("Override: one attack that cannot miss on each enemy of the line, with none of its unit's skills taking effect", () => {
  const does = act("Override");
  assert.deepEqual(does.area, { shape: "line", reach: "units", who: "enemy" });
  assert.equal(does.through, true);
  assert.equal(does.strike.plain, true);
  assert.equal(skill("Override").usage.cooldown, 3);

  // An enemy next to the unit and one right behind it are caught; an ally in the line ends it
  const units = [placed("me", "self", 5, 5), placed("one", "foe", 5, 6), placed("two", "foe", 5, 7), placed("ally", "friend", 5, 8), placed("three", "foe", 5, 9)];
  const holds = (tile) => areaUnits(does.area, [tile], units).length > 0;
  const line = lineArea(at(5, 5), at(5, 6), { reach: does.area.reach, holds, inside });
  assert.deepEqual(areaUnits(does.area, line.tiles, units, at(5, 5)).map((unit) => unit.id), ["one", "two"]);
  assert.deepEqual(line.beyond, at(5, 8), "where it would land: taken by the ally, so this line is not offered on the map");

  // The attack cannot miss, whatever the foe's Dodge
  const knight = fighter({ name: "Duke", stats: { dex: 0, luk: 0 } });
  const dodger = fighter({ name: "Dodger", stats: { spd: 40, luk: 40 } });
  const usual = planExchange(knight, dodger, { extra: { skill: "Override", share: 1 } });
  assert.ok(usual.initiator.hit < 100);
  const sure = planExchange(knight, dodger, { extra: { skill: "Override", share: 1, plain: true, effects: does.strike.effects } });
  assert.equal(sure.initiator.hit, 100);
  assert.deepEqual(sure.order, ["initiator"]);
});

test("Staredown halves the MOV of every enemy in the unit's Line of Sight until the end of its next turn", () => {
  const does = act("Staredown");
  assert.equal(does.area.shape, "sight");
  assert.equal(listed.Staredown.effects.length, 2, "what it always does to enemies that start their turn near stays");
  const wall = (tile) => (tile.i === 5) && (tile.j === 7);
  const tiles = areaTiles(does.area, at(5, 5), null, { inside, los: 4, sight: { blocked: wall } });
  const units = [placed("seen", "foe", 5, 6), placed("hidden", "foe", 5, 8), placed("far", "foe", 0, 5), placed("ally", "friend", 4, 5)];
  assert.deepEqual(areaUnits(does.area, tiles, units, at(5, 5)).map((unit) => unit.id), ["seen"], "not the one behind the wall, nor the one out of sight");
  const change = buildChange(does.grant, { skill: "Staredown", from: "Hunter", giver: "Actor.hunter", giverInTurn: true });
  const totals = skillTotals(timedEntries([change]), fighter({ name: "Foe" }));
  assert.equal(totals.statTimes.incoming.mov ?? totals.statTimes.own.mov, 0.5);
  assert.equal(tickChanges([change], "turnEnd").list.length, 0);
});

test("Sacrifice: each HP given up restores 2, shared out among allies, and the unit keeps 1 HP", () => {
  const does = act("Sacrifice");
  assert.deepEqual(does.shares, { gives: 2 });
  assert.equal(does.area.radius, 5);
  const about = { hp: 10, gives: 2 };

  // A click gives an ally all it lacks; a second click takes it away again
  let shares = shareWith({}, "a", "hp", "fill", { ...about, lacks: 7 });
  assert.deepEqual(shares, { a: { hp: 7 } });
  assert.equal(sharesCost(shares, 2), 4, "a part of an HP is paid in full");
  assert.deepEqual(shareWith(shares, "a", "hp", "fill", { ...about, lacks: 7 }), {});

  // The unit can restore 18 with its 10 HP, keeping 1: the second ally gets what is left
  shares = shareWith(shares, "b", "hp", "fill", { ...about, lacks: 30 });
  assert.deepEqual(shares, { a: { hp: 7 }, b: { hp: 11 } });
  assert.equal(sharesTotal(shares), 18);
  assert.equal(sharesCost(shares, 2), 9);
  assert.equal(sharesRoom(10, shares, 2), 0);
  assert.deepEqual(shareWith(shares, "c", "hp", "fill", { ...about, lacks: 5 }), shares, "nothing left to give");

  // A little more, a little less, and a Shift Gauge in place of HP
  shares = shareWith({}, "a", "hp", 2, { ...about, lacks: 7 });
  shares = shareWith(shares, "a", "hp", 2, { ...about, lacks: 7 });
  assert.deepEqual(shares, { a: { hp: 4 } });
  assert.deepEqual(shareWith(shares, "a", "hp", -2, { ...about, lacks: 7 }), { a: { hp: 2 } });
  assert.deepEqual(shareWith(shares, "a", "hp", 20, { ...about, lacks: 7 }), { a: { hp: 7 } }, "no more than it lacks");
  assert.deepEqual(shareWith(shares, "l", "gauge", "fill", { ...about, lacks: 6 }), { a: { hp: 4 }, l: { gauge: 6 } });
});

test("Spotting: Damage, Hit and Critical against an enemy an ally has in its Line of Sight, less within 4 spaces", () => {
  const archer = (distance, sees) => {
    const unit = fighter({ name: "Archer", skills: [skill("Spotting")], weapon: { name: "Longbow", category: "bow", range: "1-9", crit: 30 } });
    const foe = fighter({ name: "Foe", stats: { spd: 30, luk: 0 } });
    const spotter = { id: "s", actor: "Actor.s", name: "S", side: "player", hp: 20, hpMax: 20 };
    return [
      { ...unit, near: { id: "a", side: "player", tile: at(0, 0), others: [{ ...spotter, relation: "ally", distance: 3 }, { id: "b", relation: "enemy", distance }] } },
      { ...foe, near: { id: "b", side: "enemy", tile: at(0, distance), others: [{ ...spotter, relation: "enemy", distance: 2, sees }, { id: "a", relation: "enemy", distance }] } }
    ];
  };
  const numbers = (distance, sees) => {
    const [a, b] = archer(distance, sees);
    const side = planExchange(a, b, { distance }).initiator;
    return { hit: side.hit, damage: side.damage, crit: side.crit };
  };
  const unseen = numbers(6, false);
  const far = numbers(6, true);
  assert.deepEqual({ damage: far.damage - unseen.damage, hit: far.hit - unseen.hit, crit: far.crit - unseen.crit }, { damage: 3, hit: 15, crit: 10 });
  const base = numbers(4, false);
  const close = numbers(4, true);
  assert.deepEqual({ damage: close.damage - base.damage, hit: close.hit - base.hit, crit: close.crit - base.crit }, { damage: 1, hit: 10, crit: 5 });
});

/**
 * Tests for `module/rules/weather.mjs` and what reads it: what the weather of a map does to a unit, what
 * strikes the map as a turn of the battle ends, and the skill that spares its unit (Forecast, as it is written
 * in effects.json). Run with `node --test tests/` or `node tests/weather.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { checkEffects, skillRule, skillTotals } from "../module/rules/skills.mjs";
import { moveCost, passCost } from "../module/rules/terrain.mjs";
import {
  WEATHERPROOF, causesFog, checkWeather, rollStrikes, strikeDamage, strikeDice, strikesDue, weatherClass, weatherFor, weatherKinds
} from "../module/rules/weather.mjs";
import { weatherAuras } from "../module/helpers/map-weather.mjs";
import { builtEffects, skill } from "./lib/fixtures.mjs";

/** A die that comes up as told, one face after the other, and remembers what was asked of it. */
function die(...rolls) {
  let at = 0;
  const asked = [];
  const roll = (faces) => {
    if ( at >= rolls.length ) throw new Error(`a die was rolled that the test did not expect (d${faces})`);
    asked.push(faces);
    return rolls[at++];
  };
  roll.asked = asked;
  return roll;
}

const infantry = { qualities: "", los: 6 };
const knight = { qualities: "Mounted, Armored", los: 6 };
const flier = { qualities: "Flying, Mounted", los: 6 };
const forecast = (unit) => ({ ...unit, proof: skillRule([skill("Forecast")], WEATHERPROOF, {}) });

/* -------------------------------------------- */
/*  What It Does to a Unit                      */
/* -------------------------------------------- */

test("the table has every kind of weather of the Weather page, and a list keeps only those", () => {
  const kinds = ["rain", "snowstorm", "thunderstorm", "windstorm", "hail", "heatWave", "fog", "sandstorm", "darkness", "ashStorm", "mist", "ballista"];
  assert.deepEqual(Object.keys(FEO.weather.kinds).sort(), [...kinds].sort());
  assert.deepEqual(weatherKinds(["hail", "rain", "rain", "sleet", 3]), ["rain", "hail"]);
  assert.deepEqual(weatherKinds(null), []);
  assert.deepEqual(checkWeather(["rain", "sleet"]), ['unknown weather "sleet"']);
});

test("a unit that flies is neither infantry nor mounted to the weather", () => {
  assert.equal(weatherClass(infantry), "infantry");
  assert.equal(weatherClass(knight), "mounted");
  assert.equal(weatherClass(flier), "flying");
  assert.equal(weatherClass({ qualities: "", flier: true }), "flying");
});

test("Rain, a Snowstorm and a Thunderstorm: tiles cost infantry 1 more MOV and Mounted units 2 more", () => {
  for ( const kind of ["rain", "snowstorm", "thunderstorm"] ) {
    assert.equal(weatherFor([kind], infantry).move, 1, kind);
    assert.equal(weatherFor([kind], knight).move, 2, kind);
    assert.equal(weatherFor([kind], flier).move, 0, kind);
  }
});

test("a Windstorm: tiles cost Flying units 1 more MOV, and nobody else", () => {
  assert.equal(weatherFor(["windstorm"], flier).move, 1);
  assert.equal(weatherFor(["windstorm"], infantry).move, 0);
  assert.equal(weatherFor(["windstorm"], knight).move, 0);
});

test("what the weather has tiles cost more is added to what each tile takes", () => {
  const walker = { qualities: "", weather: weatherFor(["rain"], infantry).move };
  const rider = { qualities: "Mounted", weather: weatherFor(["rain"], knight).move };
  assert.equal(moveCost("plain", walker), 2);
  assert.equal(moveCost("forest", walker), 3);
  assert.equal(moveCost("plain", rider), 3);
  assert.equal(moveCost("desert", rider), 5);
  assert.equal(moveCost("wall", walker), Infinity);
  assert.equal(moveCost("mountain", walker), Infinity);

  // A flier in a Windstorm pays 2 for every tile it flies over
  const wind = { qualities: "Flying", weather: weatherFor(["windstorm"], flier).move };
  assert.equal(moveCost("forest", wind), 2);
  assert.equal(moveCost("plain", { qualities: "Flying", weather: weatherFor(["rain"], flier).move }), 1);

  // A unit that passes through what it cannot cross pays it there too
  assert.deepEqual(passCost("wall", { qualities: "", crossing: { phase: 2 }, weather: 1 }), { cost: 3, stop: false });
  assert.equal(moveCost("plain", { qualities: "" }), 1);
});

test("Hail and a Heat Wave: 1 damage as a turn ends; a Heat Wave also takes 3 SPD", () => {
  assert.equal(weatherFor(["hail"], infantry).harm, 1);
  const heat = weatherFor(["heatWave"], infantry);
  assert.deepEqual([heat.harm, heat.stats, heat.fatigue], [1, { spd: -3 }, 1]);
  assert.deepEqual(weatherFor(["rain"], infantry).stats, {});
});

test("kinds that are switched on together each count once, at the most any makes of an effect", () => {
  const both = weatherFor(["rain", "thunderstorm", "snowstorm"], knight);
  assert.equal(both.move, 2);
  assert.equal(weatherFor(["hail", "heatWave"], infantry).harm, 1);
  const storm = weatherFor(["rain", "windstorm", "heatWave"], flier);
  assert.deepEqual([storm.move, storm.stats.spd, storm.by.move], [1, -3, "windstorm"]);
});

test("Fog, a Sandstorm, Darkness, an Ash Storm and a Mist cause Fog of War, and apply nothing else", () => {
  for ( const kind of ["fog", "sandstorm", "darkness", "ashStorm"] ) {
    assert.equal(causesFog([kind]), true, kind);
    const effect = weatherFor([kind], infantry);
    assert.deepEqual([effect.move, effect.harm, effect.los, effect.stats], [0, 0, 0, {}], kind);
  }
  assert.equal(causesFog(["mist"]), true);
  assert.equal(causesFog(["rain", "hail"]), false);
});

test("a Mist: the LoS of every unit is 4 unless it is higher", () => {
  assert.equal(weatherFor(["mist"], { qualities: "", los: 2 }).los, 2);
  assert.equal(weatherFor(["mist"], { qualities: "", los: 4 }).los, 0);
  assert.equal(weatherFor(["mist"], { qualities: "", los: 7 }).los, 0);
});

/* -------------------------------------------- */
/*  Forecast                                    */
/* -------------------------------------------- */

test("Forecast spares its unit the effects of weather: movement, stats and the damage of a turn's end", () => {
  assert.deepEqual(checkEffects(builtEffects("Forecast")), []);
  assert.equal(skillRule([skill("Forecast")], WEATHERPROOF, {}), true);
  assert.equal(skillRule([], WEATHERPROOF, {}), false);
  assert.equal(skillTotals([skill("Forecast")], { hp: 20, hpMax: 20, level: 1, stats: {} }).rules.has(WEATHERPROOF), true);

  const all = ["rain", "windstorm", "hail", "heatWave"];
  for ( const unit of [infantry, knight, flier] ) {
    const effect = weatherFor(all, forecast(unit));
    assert.deepEqual([effect.move, effect.harm, effect.fatigue, effect.stats], [0, 0, 0, {}]);
  }
  assert.equal(moveCost("forest", { qualities: "", weather: weatherFor(["rain"], forecast(infantry)).move }), 2);
});

test("Forecast does not spare its unit Fog of War, lightning or ballista fire", () => {
  // The LoS a Mist sets is part of Fog of War, and stays
  assert.equal(weatherFor(["mist"], forecast({ qualities: "", los: 2 })).los, 2);
  assert.equal(causesFog(["fog"]), true);

  // A bolt deals what it deals, whatever the unit's skills: nothing about the unit but its qualities is read
  assert.equal(strikeDamage("lightning", forecast(infantry)).damage, 10);
  assert.equal(strikeDamage("ballista", forecast(infantry)).damage, 10);
});

/* -------------------------------------------- */
/*  What Strikes the Map                        */
/* -------------------------------------------- */

test("lightning is due as every turn ends in a Thunderstorm, ballista fire as every other turn ends", () => {
  assert.deepEqual(strikesDue(["thunderstorm"], 1).map((entry) => entry.strike), ["lightning"]);
  assert.deepEqual(strikesDue(["thunderstorm"], 2).map((entry) => entry.strike), ["lightning"]);
  assert.deepEqual(strikesDue(["ballista"], 1), []);
  assert.deepEqual(strikesDue(["ballista"], 2).map((entry) => entry.strike), ["ballista"]);
  assert.deepEqual(strikesDue(["ballista"], 3), []);
  assert.deepEqual(strikesDue(["ballista", "thunderstorm"], 4).map((entry) => entry.strike), ["lightning", "ballista"]);
  assert.deepEqual(strikesDue(["rain", "hail"], 2), []);
  assert.equal(strikeDice(["thunderstorm"], 1), 3);
  assert.equal(strikeDice(["ballista"], 2), 11);
  assert.equal(strikeDice(["rain"], 2), 0);
});

test("lightning strikes on tails, on a tile picked by rolling the size of the map", () => {
  const size = { rows: 15, cols: 10 };
  const heads = die(1);
  assert.deepEqual(rollStrikes(["thunderstorm"], 1, size, heads)[0].bolts, []);
  assert.deepEqual(heads.asked, [2]);

  // Tails: a D10 for the column, then a D15 for the row, as the worked example of the rules has it
  const tails = die(2, 5, 12);
  const [struck] = rollStrikes(["thunderstorm"], 1, size, tails);
  assert.deepEqual(struck.bolts, [{ col: 5, row: 12 }]);
  assert.deepEqual(tails.asked, [2, 10, 15]);
});

test("ballista fire is 1D5 bolts, each on a tile of its own roll", () => {
  const rolls = die(3, 1, 1, 10, 15, 4, 4);
  const [fire] = rollStrikes(["ballista"], 2, { rows: 15, cols: 10 }, rolls);
  assert.equal(fire.roll, 3);
  assert.deepEqual(fire.bolts, [{ col: 1, row: 1 }, { col: 10, row: 15 }, { col: 4, row: 4 }]);
  assert.deepEqual(rolls.asked, [5, 10, 15, 10, 15, 10, 15]);
  assert.deepEqual(rollStrikes(["ballista"], 3, { rows: 15, cols: 10 }, die()), []);
  assert.deepEqual(rollStrikes(["ballista"], 2, { rows: 0, cols: 0 }, die()), []);
});

test("a bolt deals 10 damage, lightning 15 to a Dragon, and nothing on a tile that is indoors", () => {
  assert.deepEqual(strikeDamage("lightning", { qualities: "" }, "plain"), { damage: 10, indoors: false });
  assert.deepEqual(strikeDamage("lightning", { qualities: "Dragon, Flying" }, "forest"), { damage: 15, indoors: false });
  assert.deepEqual(strikeDamage("ballista", { qualities: "Dragon" }, "plain"), { damage: 10, indoors: false });
  assert.deepEqual(strikeDamage("lightning", { qualities: "Dragon" }, "house"), { damage: 0, indoors: true });
  assert.deepEqual(strikeDamage("ballista", null, "plain"), { damage: 0, indoors: false });
});

/* -------------------------------------------- */
/*  As a Unit's Numbers Read It                 */
/* -------------------------------------------- */

test("what the weather does to stats reaches a unit as an entry named after the weather", () => {
  const scene = (list) => ({ flags: { [FEO.id]: { weather: list } } });
  const unit = (system) => ({ system: { specialQualities: "", ...system } });
  const name = (kind) => kind;

  const heat = weatherAuras(scene(["heatWave"]), unit({ weather: { proof: false, los: 6 } }), name);
  assert.deepEqual(heat.map((entry) => [entry.name, entry.effects]), [["heatWave", [{ stats: { spd: -3 } }]]]);
  const totals = skillTotals(heat, { hp: 20, hpMax: 20, level: 1, stats: { spd: 10 } });
  assert.equal(totals.stats.spd, -3);

  // A unit with Forecast receives none of it; a Mist still gives it the LoS it sets
  assert.deepEqual(weatherAuras(scene(["heatWave", "rain"]), unit({ weather: { proof: true, los: 6 } }), name), []);
  const mist = weatherAuras(scene(["mist", "heatWave"]), unit({ weather: { proof: true, los: 2 } }), name);
  assert.deepEqual(mist.map((entry) => [entry.name, entry.effects]), [["mist", [{ stats: { los: 2 } }]]]);
  assert.deepEqual(weatherAuras(scene([]), unit({ weather: { proof: false, los: 2 } }), name), []);
  assert.deepEqual(weatherAuras({ flags: {} }, unit({}), name), []);
});

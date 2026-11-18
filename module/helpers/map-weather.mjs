import { FEO } from "../config.mjs";
import { weatherFor, weatherKinds } from "../rules/weather.mjs";

/**
 * The weather of a scene, as it is read: the kinds its Game Master switched on, and what they come to for a
 * unit. It is kept apart from what the weather does (see `weather.mjs`) so that what reads the ground and
 * where units stand can read it without loading the rest.
 *
 * @import {WeatherEffect, WeatherUnit} from "../rules/weather.mjs"
 */

/** The flag of a scene that lists the kinds of weather switched on for it. */
export const WEATHER_FLAG = "weather";

/**
 * The kinds of weather switched on for a scene.
 * @param {Scene|null} scene
 * @returns {string[]}
 */
export function weatherOn(scene) {
  const list = scene?.flags?.[FEO.id]?.[WEATHER_FLAG];
  return Array.isArray(list) ? weatherKinds(list) : [];
}

/* -------------------------------------------- */

/**
 * Describe a unit for the weather rules.
 * @param {Actor|null} actor
 * @returns {WeatherUnit}
 */
export function weatherUnitOf(actor) {
  const system = actor?.system;
  if ( !system ) return {};
  return {
    qualities: system.specialQualities ?? "",
    flier: !!system.crossing?.flier,
    proof: !!system.weather?.proof,
    los: system.weather?.los ?? 0
  };
}

/* -------------------------------------------- */

/**
 * The scene a unit stands on for the weather: that of its own token, else the one in view.
 * @param {Actor|null} actor
 * @returns {Scene|null}
 */
function sceneOf(actor) {
  return actor?.token?.parent ?? globalThis.canvas?.scene ?? null;
}

/* -------------------------------------------- */

/**
 * What the weather of a scene comes to for a unit.
 * @param {Actor|null} actor
 * @param {Scene|null} [scene]    The scene it stands on; that of its token, or the one in view, unless given
 * @returns {WeatherEffect}
 */
export function weatherOf(actor, scene = sceneOf(actor)) {
  return weatherFor(weatherOn(scene), weatherUnitOf(actor));
}

/* -------------------------------------------- */

/**
 * What the weather of a scene does to a unit's stats, as entries its numbers read like the auras it receives:
 * one for each kind that changes any, named after that kind.
 * @param {Scene|null} scene
 * @param {Actor|null} actor
 * @param {(key: string) => string} [name]    Words a kind of weather; its key unless given
 * @returns {object[]}
 */
export function weatherAuras(scene, actor, name = null) {
  const kinds = weatherOn(scene);
  if ( !kinds.length || !actor ) return [];
  const effect = weatherFor(kinds, weatherUnitOf(actor));
  const stats = { ...effect.stats };
  if ( effect.los > 0 ) stats.los = effect.los;
  const byKind = new Map();
  for ( const [stat, amount] of Object.entries(stats) ) {
    const kind = effect.by[stat];
    if ( !kind || !amount ) continue;
    if ( !byKind.has(kind) ) byKind.set(kind, {});
    byKind.get(kind)[stat] = amount;
  }
  const words = name ?? ((kind) => globalThis.game?.i18n?.localize(FEO.weather.kinds[kind].label) ?? kind);
  return Array.from(byKind, ([kind, changed]) => ({
    name: words(kind), skill: words(kind), from: "", giver: "", aura: true, weather: kind,
    nihil: false, sourceNihil: false, inverted: false, effects: [{ stats: changed }]
  }));
}

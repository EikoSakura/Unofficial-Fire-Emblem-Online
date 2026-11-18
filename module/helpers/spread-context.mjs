/**
 * Words for what a skill did, or would do, to the units around (see `rules/spread.mjs`), for the cards and the
 * forecast. Nothing here knows of Foundry but the localizer it is handed.
 *
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * What came of a spread, in a few words for a card: one part for each unit.
 * @param {{lines: import("./spread.mjs").SpreadLine[]}} told
 * @param {Localizer} i18n
 * @returns {string}
 */
export function describeSpread(told, i18n) {
  const condition = (id) => i18n.localize(`FEO.Condition.${id}`);
  return (told?.lines ?? []).map((line) => {
    const parts = [];
    if ( line.attack ) {
      const key = !line.attack.hit ? "miss" : line.attack.crit ? "crit" : "hit";
      parts.push(i18n.format(`FEO.Spread.attack.${key}`, { damage: line.attack.damage, hit: line.attack.hitChance }));
    }
    if ( line.damage !== undefined ) parts.push(i18n.format("FEO.Spread.damage", { amount: line.damage }));
    if ( line.healed ) parts.push(i18n.format("FEO.Spread.heal", { amount: line.healed }));
    if ( line.inflicted?.length ) parts.push(line.inflicted.map(condition).join(", "));
    if ( line.warded?.length ) parts.push(i18n.format("FEO.Spread.warded", { conditions: line.warded.map(condition).join(", ") }));
    if ( line.pushed ) parts.push(i18n.localize("FEO.Spread.pushed"));
    if ( line.blocked ) parts.push(i18n.format("FEO.Spread.blocked", { amount: line.blocked }));
    if ( line.down ) parts.push(i18n.localize("FEO.Spread.down"));
    if ( !parts.length && line.granted ) parts.push(i18n.localize("FEO.Spread.marked"));
    return `${line.name} ${parts.join(", ")}`;
  }).join(" · ");
}

/* -------------------------------------------- */

/**
 * What a spread would do to one unit, as a forecast tells it: its name and what it would get.
 * @param {import("../rules/spread.mjs").SpreadShare} share
 * @param {Localizer} i18n
 * @returns {string}
 */
export function describeShare(share, i18n) {
  const parts = [];
  if ( share.attack ) parts.push(i18n.localize("FEO.Spread.forecast.attack"));
  if ( share.damage !== undefined ) parts.push(i18n.format("FEO.Spread.damage", { amount: share.damage }));
  if ( share.heal ) parts.push(i18n.format("FEO.Spread.heal", { amount: share.heal }));
  if ( share.inflicts?.length ) parts.push(share.inflicts.map((entry) => i18n.localize(`FEO.Condition.${entry.id}`)).join(", "));
  if ( share.push ) parts.push(i18n.localize("FEO.Spread.pushed"));
  return `${share.name} ${parts.join(", ")}`.trim();
}

/* -------------------------------------------- */

/**
 * What the skills of a planned fight would do to the units around, for a forecast: one entry for each skill,
 * with a short label, the sum of the damage or healing it is sure of, and every unit it would catch for a hover.
 * @param {ReturnType<import("../rules/combat.mjs").spreadForecast>} list
 * @param {Localizer} i18n
 * @returns {{skill: string, by: string, label: string, hint: string, sure: boolean, tone: "bad"|"good"}[]}
 */
export function forecastSpreads(list, i18n) {
  return (list ?? []).map((entry) => {
    const count = entry.picks ? Math.min(entry.picks, entry.units.length) : entry.units.length;
    const heals = entry.units.some((share) => share.heal > 0);
    const when = entry.sure ? "sure" : entry.may ? "may" : (entry.chance < 100) ? "chance" : `on.${entry.on}`;
    const what = i18n.format(`FEO.Spread.forecast.${heals ? "allies" : "enemies"}`, { count });
    const label = i18n.format(`FEO.Spread.forecast.${when}`, { skill: entry.skill, what, chance: entry.chance });
    const each = entry.units.map((share) => describeShare(share, i18n)).join(" · ");
    const hint = entry.picks && (entry.units.length > entry.picks)
      ? i18n.format("FEO.Spread.forecast.among", { count: entry.picks, units: each })
      : each;
    return { skill: entry.skill, by: entry.by, label, hint, sure: !!entry.sure, tone: heals ? "good" : "bad" };
  });
}

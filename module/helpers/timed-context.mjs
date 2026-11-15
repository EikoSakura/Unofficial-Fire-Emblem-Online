import { FEO } from "../config.mjs";

/**
 * Display data for changes that last a while: what one does, in a few words, and how long it still lasts.
 * Nothing here touches Foundry, so that it can be tested outside of it; strings are localized through
 * whatever `i18n` is passed in, or by the template that shows the rows.
 *
 * @import {TimedChange} from "../rules/timed.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */

/** Write a number with its sign. */
const signed = (value) => `${value > 0 ? "+" : "−"}${Math.abs(value)}`;

/**
 * What a change does, as amounts with the key of what each is an amount of. A number that is read from the
 * unit when it is needed is shown by its sign alone.
 * @param {TimedChange} change
 * @returns {{value: string, label: string}[]}
 */
export function changeParts(change) {
  const stacks = Math.max(change.stacks ?? 1, 1);
  const amount = (value, suffix = "") => {
    if ( typeof value === "number" ) return `${signed(value * stacks)}${suffix}`;
    return ((value?.times ?? 1) < 0) ? "−" : "+";
  };
  const parts = [];
  for ( const effect of change.effects ?? [] ) {
    for ( const [key, value] of Object.entries(effect.stats ?? {}) ) parts.push({ value: amount(value), label: FEO.stats[key]?.abbr ?? key });
    for ( const [key, value] of Object.entries(effect.statPercent ?? {}) ) parts.push({ value: amount(value, "%"), label: FEO.stats[key]?.abbr ?? key });
    for ( const [key, value] of Object.entries(effect.combat ?? {}) ) {
      parts.push({ value: amount(value), label: (key === "activation") ? "FEO.Skill.activation" : (FEO.combatBoosts[key] ?? key) });
    }
    if ( effect.hpMax ) parts.push({ value: amount(effect.hpMax), label: "FEO.Stat.hp.abbr" });
    if ( effect.might ) parts.push({ value: amount(effect.might), label: "FEO.Weapon.might" });
    if ( effect.endurance ) parts.push({ value: amount(effect.endurance), label: "FEO.Timed.endurance" });
    if ( effect.haste ) parts.push({ value: amount(effect.haste), label: "FEO.Bond.hst" });
    if ( effect.taken ) parts.push({ value: amount(effect.taken), label: "FEO.Timed.taken" });
    if ( effect.takenPercent ) parts.push({ value: amount(effect.takenPercent, "%"), label: "FEO.Timed.taken" });
    if ( effect.dealtPercent ) parts.push({ value: amount(effect.dealtPercent, "%"), label: "FEO.Timed.dealt" });

    // What it adds to the HP its unit heals with staves
    if ( effect.staffHeal?.plus ) parts.push({ value: amount(effect.staffHeal.plus), label: "FEO.Staff.healing" });
    if ( effect.staffHeal?.more ) parts.push({ value: amount(effect.staffHeal.more, "%"), label: "FEO.Staff.healing" });

    // What it makes of a condition its unit suffers from: more damage at the start of a turn, named by the
    // condition, and damage when the condition bursts
    for ( const [id, bend] of Object.entries(effect.suffers ?? {}) ) {
      if ( bend.tick ) parts.push({ value: amount(bend.tick, "%"), label: `FEO.Condition.${id}` });
      if ( bend.burst ) parts.push({ value: "+", label: "FEO.Timed.burst" });
    }
  }
  return parts;
}

/* -------------------------------------------- */

/**
 * How long a change still lasts, as the key of a sentence and the number that goes into it.
 * @param {TimedChange} change
 * @returns {{key: string, turns: number}}
 */
export function changeLasts(change) {
  if ( change.ends === "map" ) return { key: "FEO.Timed.lasts.map", turns: 0 };
  const turns = change.fades ? Math.max(change.stacks ?? 1, 1) : Math.max(change.turns ?? 1, 1);
  const whose = change.clock ? "giver" : "own";
  if ( change.fades ) return { key: "FEO.Timed.lasts.fades", turns };
  return { key: `FEO.Timed.lasts.${change.ends}.${whose}${turns > 1 ? "Many" : ""}`, turns };
}

/* -------------------------------------------- */

/**
 * A change in a few words, for a chat card: what it does, and how long it lasts.
 * @param {TimedChange} change
 * @param {Localizer} i18n
 * @returns {{what: string, lasts: string}}
 */
export function describeChange(change, i18n) {
  const lasts = changeLasts(change);
  return {
    what: changeParts(change).map((part) => `${part.value} ${i18n.localize(part.label)}`).join(", "),
    lasts: i18n.format(lasts.key, { turns: lasts.turns, from: change.from })
  };
}

/* -------------------------------------------- */

/**
 * The changes a unit carries, as rows for its sheet.
 * @param {TimedChange[]} [changes]
 * @returns {{index: number, name: string, from: string, parts: {value: string, label: string}[],
 *   lasts: {key: string, turns: number}}[]}
 */
export function timedRows(changes) {
  return (changes ?? []).map((change, index) => ({
    index,
    name: change.name,
    from: change.from ?? "",
    parts: changeParts(change),
    lasts: changeLasts(change)
  }));
}

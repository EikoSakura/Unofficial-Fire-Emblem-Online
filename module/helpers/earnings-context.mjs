import { FEO } from "../config.mjs";
import { growthPickCount, growthPicks } from "../rules/earnings.mjs";
import { describeChange } from "./timed-context.mjs";

/**
 * Display data for what a unit earns: experience its skills multiplied, what its skills did when it levelled
 * up, and the growth rates a skill lets it pick. Nothing here touches Foundry, so that it can be tested
 * outside of it; strings are localized through whatever `i18n` is passed in, or by the template.
 *
 * @import {LevelUpOutcome, ScaledExp} from "../rules/earnings.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * What skills multiplied experience by, in a few words: "30 × 1.25: Lineage".
 * @param {Partial<ScaledExp>|null} award
 * @param {Localizer} i18n
 * @returns {string}      Empty when no skill multiplied it
 */
export function expTimes(award, i18n) {
  if ( !award?.sources?.length ) return "";
  return i18n.format("FEO.Exp.times", {
    base: award.base,
    times: award.times,
    skills: award.sources.map((source) => source.skill).join(", ")
  });
}

/* -------------------------------------------- */

/**
 * Experience earned, as a card row shows it: the amount, and in brackets what skills made of it.
 * @param {{gained: number, staff?: {row: string, skill: string}|null} & Partial<ScaledExp>} award
 * @param {Localizer} i18n
 * @returns {string}
 */
export function expAmount(award, i18n) {
  const notes = [];
  if ( award.staff ) notes.push(i18n.format(`FEO.Exp.staffBy.${award.staff.row}`, { skill: award.staff.skill }));
  const times = expTimes(award, i18n);
  if ( times ) notes.push(times);
  return notes.length ? `${award.gained} (${notes.join("; ")})` : String(award.gained);
}

/* -------------------------------------------- */

/**
 * One growth roll of a level up, as its row on the card tells it. One that was rolled again shows both rolls
 * and the skill that allowed the second.
 * @param {import("../rules/progression.mjs").GrowthResult & {reroll?: {skill: string, first: number}}} result
 * @param {Localizer} i18n
 * @returns {string}
 */
export function growthValue(result, i18n) {
  if ( !result.reroll ) return i18n.format("FEO.LevelUp.growthRoll", { roll: result.roll, growth: result.growth, gain: result.gain });
  return i18n.format("FEO.LevelUp.growthReroll", {
    first: result.reroll.first,
    roll: result.roll,
    growth: result.growth,
    gain: result.gain,
    skill: result.reroll.skill
  });
}

/* -------------------------------------------- */

/**
 * The rows a level-up card shows for what the unit's skills did: gold, HP restored, a boost that lasts.
 * @param {LevelUpOutcome} outcome
 * @param {Localizer} i18n
 * @returns {{label: string, value: string, cls: string}[]}
 */
export function levelUpRows(outcome, i18n) {
  const rows = [];
  const abbr = (key) => i18n.localize(FEO.growths[key] ?? FEO.stats[key]?.abbr ?? key);
  for ( const { skill, amount } of outcome?.gold ?? [] ) {
    rows.push({ label: skill, value: i18n.format("FEO.LevelUp.gold", { amount }), cls: "good" });
  }
  if ( outcome?.heal?.healed > 0 ) rows.push({
    label: outcome.heal.skill,
    value: i18n.format("FEO.LevelUp.healed", { amount: outcome.heal.healed, hp: outcome.heal.hp }),
    cls: "good"
  });
  for ( const { skill, change, amount, left } of outcome?.granted ?? [] ) {
    const parts = [];
    if ( change ) parts.push(i18n.format("FEO.LevelUp.boost", describeChange(change, i18n)));
    if ( left.length ) parts.push(i18n.format("FEO.LevelUp.boostLeft", { amount, stats: left.map(abbr).join(", ") }));
    rows.push({ label: skill, value: parts.join("; "), cls: change ? "good" : "muted" });
  }
  return rows;
}

/* -------------------------------------------- */

/**
 * The growth rates a skill lets its unit pick, as fields for the skill's sheet.
 * @param {object[]} effects      The skill's effects
 * @param {string} [choice]       What has been picked so far: "HP, STR, SPD"
 * @returns {{index: number, number: number, value: string, options: Record<string, string>}[]|null}
 *          Null for a skill that picks none
 */
export function growthPickFields(effects, choice) {
  const count = growthPickCount(effects);
  if ( !count ) return null;
  const picked = growthPicks(choice);
  return Array.from({ length: count }, (unused, index) => ({
    index,
    number: index + 1,
    value: picked[index] ?? "",
    options: { ...FEO.growths }
  }));
}

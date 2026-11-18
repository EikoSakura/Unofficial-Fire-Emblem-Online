/**
 * Display data for Shield Block: the sum behind a Block chance and what a block takes off, in words. Nothing
 * here touches Foundry; strings are localized through whatever `i18n` is passed in.
 *
 * @import {Guard} from "../rules/blocking.mjs"
 */

/** Write a number with its sign. */
const signed = (value) => `${value > 0 ? "+" : "−"}${Math.abs(value)}`;

/**
 * The lines of the sum behind a Block chance: what blocks, with its own chance, then what DEX, the unit's
 * skills and its foe's each add or take, and what is lost to the limits of a chance.
 * @param {Guard} guard
 * @param {{localize: (key: string) => string}} i18n
 * @returns {{label: string, value: string, cls: string}[]}
 */
export function blockLines(guard, i18n) {
  const lines = guard.parts.map((part, index) => ({
    label: part.key ? i18n.localize(part.label) : part.label,
    value: (index === 0) ? `${part.value}` : signed(part.value),
    cls: (index === 0) ? "" : (part.value > 0) ? "pos" : "neg"
  })).filter((line, index) => (index === 0) || (line.value !== "−0"));
  const rest = guard.chance - guard.parts.reduce((sum, part) => sum + part.value, 0);
  if ( rest ) lines.push({ label: i18n.localize("FEO.Hud.sum.other"), value: signed(rest), cls: (rest > 0) ? "pos" : "neg" });
  return lines;
}

/**
 * What a block takes off a hit, in a few words: "−4", "−20%", "to 1", "all".
 * @param {Guard} guard
 * @param {{localize: (key: string) => string, format: (key: string, data: object) => string}} i18n
 * @returns {string}
 */
export function blockAmount(guard, i18n) {
  const rule = guard.rule ?? {};
  if ( rule.negate ) return i18n.localize("FEO.Block.takes.all");
  if ( rule.to !== undefined ) return i18n.format("FEO.Block.takes.to", { amount: rule.to });
  if ( rule.percent !== undefined ) return i18n.format("FEO.Block.takes.percent", { amount: rule.percent });
  return i18n.format("FEO.Block.takes.amount", { amount: rule.reduce ?? 0 });
}

/**
 * A Block chance told in one line, for a tooltip: what it is made of, what a block takes off, and the chance
 * to parry where the Shield has one.
 * @param {Guard} guard
 * @param {{localize: (key: string) => string, format: (key: string, data: object) => string}} i18n
 * @returns {string}
 */
export function blockTip(guard, i18n) {
  const sum = blockLines(guard, i18n).map((line) => `${line.label} ${line.value}`).join(" · ");
  const parry = guard.parry ? ` ${i18n.format("FEO.Block.parryChance", { chance: guard.parry.chance })}` : "";
  return `${sum}. ${i18n.format("FEO.Block.takes.line", { amount: blockAmount(guard, i18n) })}${parry}`;
}

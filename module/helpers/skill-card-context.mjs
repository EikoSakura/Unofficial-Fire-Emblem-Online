import { FEO } from "../config.mjs";
import { KIND_ICONS, icon } from "../apps/compendium-context.mjs";
import { formsOf } from "../rules/skills.mjs";
import { usagePairs } from "../sheets/item-view.mjs";

/**
 * Display data for a skill shown to the table as a card in the chat: what the tile on the unit's sheet says of
 * it, for those who do not have the sheet open.
 *
 * Nothing here touches Foundry, so that it can be exercised outside of it. Text is localized through whatever
 * `i18n` is passed in.
 *
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * @typedef {object} SkillCard
 * @property {string} name
 * @property {string} icon        The icon of its kind, as SVG markup
 * @property {string} kind        Its kind, in words
 * @property {string} choice      The variant taken of a skill that offers several
 * @property {string} chance      Its chance to activate for the unit that has it, in words
 * @property {string[]} forms     The Special Qualities it has its unit in now
 * @property {string} effect      Its Effect, as text
 * @property {{label: string, value: string|number}[]} rows     How it is used, and where it stands
 */

/**
 * Build the card of a skill.
 * @param {object} item           A skill, or anything shaped like one: its name, system data, and the actor
 *                                that has it if one does
 * @param {Localizer} i18n
 * @returns {SkillCard}
 */
export function buildSkillCard(item, i18n) {
  const system = item.system;
  const chance = system.chance ?? null;

  // Only a skill that is equipped and applied by the system holds its unit in a Special Quality
  const live = !!item.actor && system.equipped && (system.automate !== false);
  const forms = live ? formsOf(system.effects, item.actor.system?.specialQualities) : [];

  return {
    name: item.name,
    icon: icon(KIND_ICONS[system.kind] ?? "spark"),
    kind: i18n.localize(FEO.skillKinds[system.kind] ?? ""),
    choice: system.choice ?? "",
    chance: chance === null ? "" : i18n.format("FEO.Skill.chance", { chance }),
    forms: forms.filter((form) => form.on).map((form) => form.name),
    effect: system.effect ?? "",
    rows: usagePairs(item, i18n)
  };
}

import { canUse, turnsToSitOut } from "../rules/skill-usage.mjs";

/**
 * Display data for skills that are chosen when to activate: the button and note on a unit's skill card, and
 * the rows a chat card shows for what using one costs. Nothing here touches Foundry, so that it can be tested
 * outside of it.
 *
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * The button and the note for a skill that is chosen when to activate, as the unit sheet shows them.
 * @param {object} skill      Skill data: equipped, usage, state
 * @returns {{action: string|null, label: string|null, hint: string|null, active: boolean, blocked: boolean,
 *   note: string|null, turns: number, left: number, uses: number}|null}
 *          Null for a skill that is not used this way, or not equipped. A skill that takes effect by itself
 *          has no button, only its note: no `action`, `label` or `hint`
 */
export function prepareUsage(skill) {
  const usage = skill.usage;
  if ( !usage?.kind || !skill.equipped ) return null;
  const state = skill.state ?? {};
  const active = !!state.active;
  const able = canUse(usage, state);

  // What stands in the way or is running out, in that order: a cooldown, a limited number of uses, an effect
  // that lasts a number of turns
  let note = null;
  let turns = 0;
  if ( state.cooldown > 0 ) {
    turns = turnsToSitOut(state);
    note = turns > 0 ? "FEO.Usage.cooldownLeft" : "FEO.Usage.readyNext";
  }
  else if ( usage.uses > 0 ) note = "FEO.Usage.usesLeft";
  else if ( state.lasting > 0 ) {
    turns = state.lasting;
    note = turns === 1 ? "FEO.Usage.lastingTurn" : "FEO.Usage.lastingTurns";
  }

  const label = {
    declare: active ? "FEO.Usage.declared" : "FEO.Usage.declare",
    toggle: active ? "FEO.Usage.on" : "FEO.Usage.off",
    action: "FEO.Usage.use"
  }[usage.kind];
  const auto = usage.kind === "auto";
  return {
    action: auto ? null : (usage.kind === "action") ? "useSkill" : "switchSkill",
    label: label ?? null,
    hint: auto ? null : `FEO.Usage.hint.${usage.kind}`,
    active: auto ? false : active,
    // Switching something off is always possible; switching on or using needs the skill to be ready
    blocked: !able.ok && (auto || (usage.kind === "action") || ((usage.kind === "declare") && !active)),
    note,
    turns,
    left: Math.max((usage.uses ?? 0) - (state.used ?? 0), 0),
    uses: usage.uses ?? 0
  };
}

/* -------------------------------------------- */

/**
 * The rows a chat card shows for what using a skill costs: its cooldown, the uses it has left, how long it lasts.
 * @param {object} usage
 * @param {object} state      Where the skill stands once it was spent
 * @param {Localizer} i18n
 * @returns {{label: string, value: string}[]}
 */
export function usageRows(usage, state, i18n) {
  const rows = [];
  if ( usage?.lasts > 0 ) rows.push({
    label: i18n.localize("FEO.Usage.lastsRow"),
    value: usage.lasts === 1 ? i18n.localize("FEO.Usage.untilNextTurn") : i18n.format("FEO.Usage.turns", { turns: usage.lasts })
  });
  if ( usage?.cooldown > 0 ) rows.push({
    label: i18n.localize("FEO.Usage.cooldownRow"),
    value: i18n.format("FEO.Usage.turns", { turns: usage.cooldown })
  });
  if ( usage?.uses > 0 ) rows.push({
    label: i18n.localize("FEO.Usage.usesRow"),
    value: i18n.format("FEO.Usage.usesLeft", { left: Math.max(usage.uses - (state?.used ?? 0), 0), uses: usage.uses })
  });
  return rows;
}

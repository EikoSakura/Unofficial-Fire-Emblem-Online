/**
 * Display data for what a unit's skills do at a moment of its turn. Nothing here touches Foundry, so that it
 * can be tested outside of it; strings are localized through whatever `i18n` is passed in.
 *
 * @import {TurnMoment} from "../rules/skills.mjs"
 * @import {ChatCard} from "./chat.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */
import { describeChange } from "./timed-context.mjs";
import { describeSpread } from "./spread-context.mjs";

/**
 * Build the chat card for a moment of a unit's turn: each skill that had its moment, the roll it made if it
 * needed one, the HP it restored, and what is left for the table to apply.
 * @param {TurnMoment} result
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {string} [options.name]                             The unit's name
 * @param {"turnStart"|"turnEnd"|"wait"} [options.moment]
 * @param {{skill: string, ready: boolean, ended: boolean}[]} [options.tracker]
 *        The skills chosen when to activate that came off cooldown or stopped lasting as the turn started
 * @returns {ChatCard}
 */
export function buildSkillTurnCard(result, i18n, { name = "", moment = "turnStart", tracker = [] } = {}) {
  const rows = [];
  if ( result.hp !== result.hpBefore ) rows.push({
    label: i18n.localize("FEO.Stat.hp.abbr"),
    value: `${result.hpBefore} → ${result.hp}`,
    cls: "strong"
  });
  for ( const entry of result.entries ) {
    const parts = [];
    if ( !entry.sure ) parts.push(i18n.format("FEO.SkillTurn.roll", { roll: entry.roll, chance: entry.chance }));
    if ( !entry.success ) parts.push(i18n.localize("FEO.SkillTurn.nothing"));
    else if ( entry.remind === "check" ) {
      parts.push(entry.recover
        ? i18n.format("FEO.SkillTurn.checkHeal", { amount: entry.recover })
        : i18n.localize("FEO.SkillTurn.check"));
    }

    // What reached for the units around: the HP each regained, or their names for the table
    else if ( entry.reached ) {
      if ( entry.recover ) {
        for ( const reached of entry.reached ) {
          parts.push(i18n.format(reached.unsaved ? "FEO.SkillTurn.reachUnsaved" : "FEO.SkillTurn.reachHeals", {
            name: reached.name,
            amount: reached.healed
          }));
        }
      }
      if ( entry.remind ) parts.push(i18n.format("FEO.SkillTurn.remindReach", { names: entry.reached.map((reached) => reached.name).join(", ") }));
    }
    else {
      if ( entry.recover ) parts.push(i18n.format("FEO.SkillTurn.heals", { amount: entry.healed }));
      if ( entry.cured?.length ) parts.push(i18n.format("FEO.SkillTurn.cures", {
        conditions: entry.cured.map((id) => i18n.localize(`FEO.Condition.${id}`)).join(", ")
      }));
      // Conditions the unit was given, and those that something nullified
      const names = (list) => list.map(({ id }) => i18n.localize(`FEO.Condition.${id}`)).join(", ");
      const given = (entry.inflicted ?? []).filter((inflicted) => inflicted.success);
      const warded = (entry.inflicted ?? []).filter((inflicted) => !inflicted.success);
      if ( given.length ) parts.push(i18n.format("FEO.SkillTurn.inflicts", { conditions: names(given) }));
      if ( warded.length ) parts.push(i18n.format("FEO.SkillTurn.nullified", { conditions: names(warded) }));
      if ( entry.remind ) parts.push(i18n.localize("FEO.SkillTurn.remind"));

      // What it did to the units around, each with what it took or gained
      const around = entry.spreadTold ? describeSpread(entry.spreadTold, i18n) : "";
      if ( around ) parts.push(around);
      if ( !entry.recover && !entry.remind && !entry.granted?.length && !entry.cured?.length && !entry.inflicted?.length && !around ) parts.push(i18n.localize("FEO.SkillTurn.activates"));
    }

    // Changes that last a while which the skill granted: one mention for the unit itself, and one for the
    // units around that share the same change
    if ( entry.success && entry.granted?.length ) {
      const groups = new Map();
      for ( const granted of entry.granted ) {
        const { what, lasts } = describeChange(granted.change, i18n);
        const id = `${granted.unit ? "others" : "self"}|${granted.unsaved ? "unsaved" : "saved"}|${what}|${lasts}`;
        if ( !groups.has(id) ) groups.set(id, { self: !granted.unit, unsaved: !!granted.unsaved, what, lasts, names: [] });
        groups.get(id).names.push(granted.name);
      }
      for ( const group of groups.values() ) {
        const key = group.self ? "FEO.SkillTurn.grantSelf" : group.unsaved ? "FEO.SkillTurn.grantUnsaved" : "FEO.SkillTurn.grants";
        parts.push(i18n.format(key, { names: group.names.join(", "), what: group.what, lasts: group.lasts }));
      }
    }
    const healed = entry.healed || (entry.reached ?? []).some((reached) => reached.healed && !reached.unsaved);
    rows.push({ label: entry.skill, value: parts.join(" · "), cls: !entry.success ? "muted" : healed ? "good" : "" });
  }
  for ( const entry of tracker ) {
    const parts = [];

    // HP a change that lasts on the unit restored to it as its turn started
    if ( entry.healed > 0 ) {
      rows.push({ label: entry.skill, value: i18n.format("FEO.SkillTurn.heals", { amount: entry.healed }), cls: "good" });
      continue;
    }

    // And damage one of them dealt to it
    if ( entry.harmed > 0 ) {
      rows.push({ label: entry.skill, value: i18n.format("FEO.SkillTurn.harms", { amount: entry.harmed }), cls: "bad" });
      continue;
    }
    if ( entry.ended ) parts.push(i18n.localize("FEO.Usage.ended"));
    if ( entry.ready ) parts.push(i18n.localize("FEO.Usage.ready"));
    if ( parts.length ) rows.push({ label: entry.skill, value: parts.join(" · "), cls: "" });
  }

  const card = { title: i18n.localize(`FEO.SkillTurn.title.${moment}`), subtitle: name, rows, cls: "feo-turn" };
  if ( result.healed ) card.outcome = { label: i18n.format("FEO.SkillTurn.gained", { amount: result.healed }), cls: "good" };
  return card;
}

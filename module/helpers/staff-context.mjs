/**
 * Display data for a staff that is used: the rows its chat card gains for what the system applied by itself.
 * Nothing here touches Foundry, so that it can be tested outside of it; strings are localized through
 * whatever `i18n` is passed in.
 *
 * @import {StaffCast} from "../rules/staves.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */
import { describeChange } from "./timed-context.mjs";

/**
 * How far a staff reaches as its user's skills make it, in the words of a weapon's Range.
 * @param {StaffCast} cast
 * @returns {string|null}     Null when no skill changes it
 */
export function reachText(cast) {
  const reach = cast.reach;
  if ( !reach?.changed ) return null;
  return (reach.min === reach.max) ? String(reach.max) : `${reach.min}-${reach.max}`;
}

/* -------------------------------------------- */

/**
 * The rows a staff's card gains: the HP it restored and to whom, the HP its user regained, the skills that
 * took effect with what they granted, dealt or leave for the table, and a skill that spared the staff its use.
 * What could not be saved is marked `unsaved` beforehand, and is then said to be applied by hand.
 * @param {StaffCast} cast
 * @param {Localizer} i18n
 * @param {object} [names]
 * @param {string} [names.caster]     The unit that used the staff
 * @param {string} [names.target]     The unit it was used on
 * @returns {{label: string, value: string, cls: string}[]}
 */
export function staffRows(cast, i18n, { caster = "", target = "" } = {}) {
  const rows = [];
  const by = (skills) => (skills?.length ? ` (${skills.join(", ")})` : "");
  if ( cast.heal ) rows.push({
    label: i18n.localize("FEO.Chat.restored"),
    value: i18n.format(cast.heal.unsaved ? "FEO.Staff.healedUnsaved" : "FEO.Staff.healed", {
      name: (cast.patient === "self") ? caster : target,
      amount: cast.heal.restored
    }) + by(cast.heal.skills),
    cls: "good"
  });
  if ( cast.user ) rows.push({
    label: i18n.localize("FEO.Chat.restored"),
    value: i18n.format("FEO.Staff.healed", { name: caster, amount: cast.user.restored }) + by(cast.user.skills),
    cls: "good"
  });

  for ( const moment of cast.moments ?? [] ) {
    const parts = [];
    if ( moment.remind ) parts.push(i18n.localize("FEO.SkillTurn.remind"));
    for ( const granted of moment.granted ) {
      const { what, lasts } = describeChange(granted.change, i18n);
      const key = (granted.to === "self") ? "FEO.SkillTurn.grantSelf" : granted.unsaved ? "FEO.SkillTurn.grantUnsaved" : "FEO.SkillTurn.grants";
      parts.push(i18n.format(key, { names: granted.name, what, lasts }));
    }
    const harm = moment.harm;
    if ( harm && (harm.units.length === 1) && !harm.unsaved ) {
      parts.push(i18n.format("FEO.Staff.harm", { name: harm.units[0].name, amount: harm.amount }));
    }
    else if ( harm ) {
      const names = harm.units.map((unit) => unit.name).join(", ");
      parts.push(i18n.format(names ? "FEO.Staff.harmNamed" : "FEO.Staff.harmByHand", { names, amount: harm.amount, within: harm.within, name: target }));
    }
    if ( parts.length ) rows.push({ label: moment.skill, value: parts.join(" · "), cls: "" });
  }
  if ( cast.freeUse ) rows.push({ label: cast.freeUse, value: i18n.localize("FEO.Staff.spared"), cls: "" });
  return rows;
}

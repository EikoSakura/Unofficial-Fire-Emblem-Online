/**
 * Display data for a staff that is used: the rows its chat card gains for what the system applied by itself.
 * Nothing here touches Foundry, so that it can be tested outside of it; strings are localized through
 * whatever `i18n` is passed in.
 *
 * @import {StaffCast} from "../rules/staves.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */
import { FEO } from "../config.mjs";
import { readNumber } from "../rules/skills.mjs";
import { doubleCastChance, healCritChance, staffHealing, staffHitRate, staffPassive, staffSide } from "../rules/staves.mjs";
import { changeParts, describeChange } from "./timed-context.mjs";

/**
 * What the Additional Staff Effects make of the staff a unit has equipped, for its sheet: its chance to
 * succeed where it may miss, its chances of a Heal Critical and of a second cast where it heals one unit, and
 * what it does for its unit while it is equipped. Each is null while the world does not play with it, or
 * where the staff has none.
 * @param {{name?: string, sheetName?: string, effect?: string, hit?: number, broken?: boolean}} staff
 * @param {{stats?: Record<string, number>, hitBonus?: number}} unit    The unit that has it equipped
 * @param {object} [rules]      FEO.optional
 * @returns {{hit: number|null, critical: number|null, double: number|null,
 *   passive: {value: string, label: string, condition?: string, note?: string}[]|null}}
 *          `passive` as amounts with the key of what each is an amount of
 */
export function staffTags(staff, { stats = {}, hitBonus = 0 } = {}, rules = FEO.optional) {
  const named = { name: staff.sheetName ?? staff.name, effect: staff.effect, broken: staff.broken };
  const healing = staffHealing(staff.effect, stats);
  const heals = !!healing && !healing.area;
  const sure = /\bguaranteed\s+to\s+hit\s+against\s+allies\b/i.test(String(staff.effect ?? ""));
  const friendly = (staffSide(named, rules.staffMissing) === "friendly") && !sure;

  const parts = [];
  for ( const effect of staffPassive(named, rules.staffPassives) ) {
    if ( effect.recover ) parts.push({ value: `+${readNumber(effect.recover, { stats })}`, label: "FEO.Optional.staffPassives.heal" });
    if ( effect.cure === "all" ) parts.push({ value: "", label: "FEO.Optional.staffPassives.cureAll" });
    else for ( const id of effect.cure ?? [] ) parts.push({ value: "", label: "FEO.Optional.staffPassives.cure", condition: `FEO.Condition.${id}` });
    if ( effect.remind ) parts.push({ value: "", label: "FEO.Optional.staffPassives.cureByHand" });
    if ( effect.proc ) continue;
    const note = (effect.when?.foeQuality ?? []).join(", ");
    for ( const part of changeParts({ effects: [effect] }) ) parts.push(note ? { ...part, note } : part);
  }
  return {
    hit: (rules.staffMissing.enabled && friendly) ? staffHitRate(staff, stats, hitBonus, rules.staffMissing) : null,
    critical: (rules.healCriticals.enabled && heals && !healing.full) ? healCritChance(stats, rules.healCriticals) : null,
    double: (rules.doubleCast.enabled && heals) ? doubleCastChance(stats, rules.doubleCast) : null,
    passive: parts.length ? parts : null
  };
}

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
 * The rows a staff's card gains: the rolls it made to succeed or to hit an enemy, for a Heal Critical and for
 * a second cast, the HP it restored and to whom, the HP its user regained, the skills that
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
  const patient = (cast.patient === "self") ? caster : target;

  // A roll that was made, with its chance and what came of it
  const rolled = (label, made, outcome, cls) => {
    const parts = (made.roll === null) ? [] : [i18n.format("FEO.SkillTurn.roll", { roll: made.roll, chance: made.chance })];
    rows.push({ label: i18n.localize(label), value: [...parts, outcome].join(" · "), cls });
  };
  const aimed = (hit, name) => {
    if ( hit.roll === null ) return;
    const key = hit.success ? (name ? "FEO.Staff.reaches" : "FEO.Staff.succeeds") : (name ? "FEO.Staff.misses" : "FEO.Staff.fails");
    rolled("FEO.Staff.hit", hit, i18n.format(key, { name }), hit.success ? "" : "bad");
  };

  // An Offensive Staff's roll to hit an enemy is always shown, with its chance where that left nothing to roll
  const struck = (hit, name) => {
    const odds = (hit.roll === null) ? `${hit.chance}%` : i18n.format("FEO.SkillTurn.roll", { roll: hit.roll, chance: hit.chance });
    const outcome = i18n.format(hit.success ? "FEO.Staff.reaches" : "FEO.Staff.misses", { name });
    rows.push({ label: i18n.localize("FEO.Combat.staffHit"), value: `${odds} · ${outcome}`, cls: hit.success ? "" : "bad" });
  };

  // Each cast of the staff on its one target: whether it succeeded where it may miss, whether it was a Heal
  // Critical, and the HP it restored. A second cast follows the roll that brought it
  const casts = cast.casts?.length ? cast.casts : cast.heal ? [{ restored: cast.heal.restored }] : [];
  casts.forEach((part, index) => {
    if ( (index === 1) && cast.double ) rolled("FEO.Staff.double", cast.double, i18n.localize("FEO.Staff.doubleYes"), "good");
    if ( part.hit && part.offensive ) struck(part.hit, target);
    else if ( part.hit ) aimed(part.hit, target || ((cast.patient === "self") ? caster : ""));
    if ( part.hit && !part.hit.success ) return;
    if ( part.critical ) {
      const key = part.critical.success ? "FEO.Staff.criticalYes" : "FEO.Staff.criticalNo";
      rolled("FEO.Staff.critical", part.critical, i18n.format(key, { amount: part.amount }), part.critical.success ? "good" : "muted");
    }
    if ( cast.heal ) rows.push({
      label: i18n.localize("FEO.Chat.restored"),
      value: i18n.format(cast.heal.unsaved ? "FEO.Staff.healedUnsaved" : "FEO.Staff.healed", { name: patient, amount: part.restored }) + by(cast.heal.skills),
      cls: "good"
    });
  });
  if ( cast.double && !cast.double.success ) rolled("FEO.Staff.double", cast.double, i18n.localize("FEO.Staff.doubleNo"), "muted");

  // A staff for several units: the roll made for each, or the chance to roll for each by hand
  for ( const unit of cast.reached ?? [] ) {
    if ( unit.offensive ) {
      struck(unit, unit.name);
      continue;
    }
    if ( unit.roll === null ) continue;
    rolled("FEO.Staff.hit", unit, i18n.format(unit.success ? "FEO.Staff.reaches" : "FEO.Staff.misses", { name: unit.name }), unit.success ? "" : "bad");
  }
  if ( cast.aim?.each && (cast.aim.rate < 100) ) rows.push({
    label: i18n.localize("FEO.Staff.hit"),
    value: i18n.format("FEO.Staff.rollEach", { rate: cast.aim.rate }),
    cls: ""
  });
  if ( cast.user ) rows.push({
    label: i18n.localize("FEO.Chat.restored"),
    value: i18n.format("FEO.Staff.healed", { name: caster, amount: cast.user.restored }) + by(cast.user.skills),
    cls: "good"
  });

  for ( const moment of cast.moments ?? [] ) {
    const parts = [];

    // A skill that rolled to take effect shows its roll, whether or not it did
    const failed = !!moment.roll && !moment.roll.success;
    if ( moment.roll && (moment.roll.roll !== null) ) parts.push(`${moment.roll.roll} / ${moment.roll.chance}`);
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
    if ( parts.length ) rows.push({ label: moment.skill, value: parts.join(" · "), cls: failed ? "muted" : "" });
  }
  if ( cast.freeUse ) rows.push({ label: cast.freeUse, value: i18n.localize("FEO.Staff.spared"), cls: "" });
  return rows;
}

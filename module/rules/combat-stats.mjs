/**
 * Combat stat formulas for Fire Emblem Online.
 *
 * These are ported from the Character Sheet Template 2.0 and the "Intro and Basics" rules tab.
 * Everything here is a pure function of plain numbers so that it can be tested outside of Foundry.
 */

/**
 * Round down and floor at zero. All stats are rounded down, and all but Critical Avoid cannot be negative.
 * @param {number} value
 * @returns {number}
 */
export function nonNegative(value) {
  return Math.max(Math.floor(value), 0);
}

/* -------------------------------------------- */

/**
 * The total of a stat: its base value plus its boosts.
 * @param {number} base
 * @param {number} boost
 * @param {number} [modifier]   Automatic adjustments from skills, conditions and the like
 * @returns {number}
 */
export function statTotal(base, boost, modifier = 0) {
  return nonNegative((base ?? 0) + (boost ?? 0) + (modifier ?? 0));
}

/* -------------------------------------------- */

/**
 * Charm or Intelligence: five sixths of the chosen base stat, plus level-up increases and boosts.
 * @param {number} sourceBase   The base value (without boosts) of the stat the ability is derived from
 * @param {number} increase     Points gained from growths
 * @param {number} boost        Temporary or item boosts
 * @returns {number}
 */
export function abilityScore(sourceBase, increase, boost) {
  return nonNegative(((sourceBase ?? 0) * 5 / 6) + (increase ?? 0) + (boost ?? 0));
}

/* -------------------------------------------- */

/**
 * Weight: Constitution plus the Weight of the unit's class.
 * @param {number} con        Total Constitution
 * @param {number} classWt    Weight granted by the class, including any adjustment made at creation
 * @returns {number}
 */
export function unitWeight(con, classWt) {
  return nonNegative((con ?? 0) + (classWt ?? 0));
}

/* -------------------------------------------- */

/**
 * Attack Speed before boosts. Constitution offsets weapon Weight but never raises speed above the stat itself.
 * @param {number} speed    The stat used for speed: SPD, or DEX when parrying
 * @param {number} con      Total Constitution
 * @param {number} weight   Weapon Weight
 * @returns {number}
 */
export function attackSpeed(speed, con, weight) {
  return Math.max(Math.min(speed, speed + con - weight), 0);
}

/* -------------------------------------------- */

/**
 * @typedef CombatModifier
 * A named adjustment to combat stats, such as a skill, a condition or a support partner in range.
 * @property {string} label           A display name, or a localization key when `localize` is true
 * @property {boolean} [localize]
 * @property {number} [hit]
 * @property {number} [damage]
 * @property {number} [critical]
 * @property {number} [attackSpeed]
 * @property {number} [dodge]
 * @property {number} [critAvoid]
 */

/**
 * @typedef CombatInput
 * @property {Record<string, number>} stats     Stat totals keyed by stat id (str, mag, res, dex, spd, luk, con)
 * @property {Record<string, number>} [boosts]  Manual combat boosts (hit, damage, critical, attackSpeed, dodge,
 *                                              critAvoid)
 * @property {{accuracy: string, critical: string, dodge: string}} [calc]   Calculation modes
 * @property {CombatModifier[]} [modifiers]     Automatic adjustments
 * @property {{label: string, key: string, times: number}[]} [times]
 *                                              What multiplies a combat stat once everything is added to it, as
 *                                              a skill may: the stat by the name of its boost (hit, damage,
 *                                              critical, dodge, critAvoid), and the name it is told under
 */

/**
 * @typedef WeaponInput
 * @property {number} might
 * @property {number} hit
 * @property {number} crit
 * @property {number} weight
 * @property {string} damageStat    One of str, mag, spd, dex
 */

/**
 * @typedef CombatTerm
 * @property {string} label
 * @property {boolean} localize     Is the label a localization key?
 * @property {number} value
 * @property {boolean} [modifier]   Does this term come from a modifier rather than the base formula?
 */

/**
 * @typedef CombatStat
 * @property {number} value
 * @property {CombatTerm[]} terms   The parts that add up to the value, omitting zeroes
 */

/**
 * @typedef {Record<"accuracy"|"damage"|"critical"|"attackSpeed"|"dodge"|"critAvoid"|"staffHit"|"staffAvoid",
 *   CombatStat>} CombatBreakdown
 */

/** The weapon profile used when a unit has nothing equipped. */
export const UNARMED = Object.freeze({ might: 0, hit: 0, crit: 0, weight: 0, damageStat: "str" });

/**
 * Formulas only a skill can put on a unit, beside the calculation modes a unit chooses on its sheet: the stat
 * its Damage, Accuracy or Critical is worked out from is the lowest of a few, or its Dodge is nothing at all.
 */
export const SKILL_CALC = Object.freeze({
  damageBy: ["lowest"],
  accuracyBy: ["lowest"],
  criticalBy: ["lowest"],
  dodgeBy: ["none"]
});

/** The stats the lowest of which a skill has a combat stat worked out from. */
const LOWEST_OF = Object.freeze({
  damageBy: ["str", "mag", "dex", "spd"],
  accuracyBy: ["dex", "spd", "str"],
  criticalBy: ["dex", "spd"]
});

/** The keys a combat modifier may adjust, mapped to the manual boost of the same name. */
const BOOST_KEYS = ["hit", "damage", "critical", "attackSpeed", "dodge", "critAvoid"];

const key = (label) => ({ label, localize: true });
const abbr = (stat) => key(`FEO.Stat.${stat}.abbr`);

/**
 * Compute a unit's combat stats with a given weapon, keeping the terms behind each number.
 * @param {CombatInput} unit
 * @param {WeaponInput|null} [weapon]   The weapon in hand, or null when unarmed
 * @returns {CombatBreakdown}
 */
export function computeCombat(unit, weapon) {
  const s = (stat) => unit.stats?.[stat] ?? 0;
  const calc = unit.calc ?? {};
  const w = { ...UNARMED, ...(weapon ?? {}) };

  // Gather the adjustments that apply to each combat stat: manual boosts first, then named modifiers
  const adjustments = (boostKey) => {
    const terms = [];
    const manual = unit.boosts?.[boostKey] ?? 0;
    if ( manual ) terms.push({ ...key("FEO.Term.manual"), value: manual, modifier: true });
    for ( const modifier of unit.modifiers ?? [] ) {
      const value = modifier[boostKey] ?? 0;
      if ( value ) terms.push({ label: modifier.label, localize: !!modifier.localize, value, modifier: true });
    }
    return terms;
  };
  const adjust = Object.fromEntries(BOOST_KEYS.map((boostKey) => [boostKey, adjustments(boostKey)]));
  const sum = (terms) => terms.reduce((total, term) => total + term.value, 0);

  // Attack Speed: boosts are added after the floor at zero
  const speedTerms = (stat) => [
    { ...abbr(stat), value: s(stat) },
    { ...key("FEO.Term.weightOverCon"), value: -Math.min(Math.max(w.weight - s("con"), 0), s(stat)) }
  ];
  const as = attackSpeed(s("spd"), s("con"), w.weight) + sum(adjust.attackSpeed);

  // The lowest of a few stats, where a skill has a combat stat worked out from that
  const lowest = (mode) => LOWEST_OF[mode].reduce((least, stat) => (s(stat) < s(least) ? stat : least));

  // Accuracy
  let accuracyTerms;
  switch ( (calc.accuracyBy === "lowest") ? "lowest" : calc.accuracy ) {
    case "lowest":
      accuracyTerms = [{ ...key("FEO.Term.lowestDouble"), value: s(lowest("accuracyBy")) * 2 }];
      break;
    case "bruteForce":
      accuracyTerms = [{ ...abbr("str"), value: s("str") }, { ...abbr("dex"), value: s("dex") }];
      break;
    case "weaponFinesse":
      accuracyTerms = [{ ...abbr("spd"), value: s("spd") }, { ...abbr("dex"), value: s("dex") }];
      break;
    default:
      accuracyTerms = [{ ...key("FEO.Term.dexDouble"), value: s("dex") * 2 }];
  }
  accuracyTerms.push({ ...abbr("luk"), value: s("luk") }, { ...key("FEO.Term.weaponHit"), value: w.hit });

  // Damage: a weapon that scales with SPD uses Attack Speed rather than the raw stat
  const damageTerm = (calc.damageBy === "lowest") ? { ...key("FEO.Term.lowest"), value: s(lowest("damageBy")) }
    : w.damageStat === "spd"
      ? { ...key("FEO.Combat.attackSpeed"), value: as }
      : { ...abbr(w.damageStat), value: s(w.damageStat) };

  // Critical
  const critTerm = (calc.criticalBy === "lowest")
    ? { ...key("FEO.Term.lowestHalf"), value: s(lowest("criticalBy")) / 2 }
    : null;
  const critStat = calc.critical === "fencersGrace" ? "spd" : "dex";

  // Dodge: Parry substitutes DEX for SPD when working out Attack Speed
  const parry = calc.dodge === "parry";
  const dodgeSpeed = parry ? attackSpeed(s("dex"), s("con"), w.weight) + sum(adjust.attackSpeed) : as;

  // What multiplies a combat stat once everything is added to it is one more term: what it adds, under the
  // name of what multiplies
  const stat = (terms, { negative = false, key = null } = {}) => {
    let total = Math.floor(sum(terms));
    if ( !negative ) total = Math.max(total, 0);
    const told = terms.filter((term) => term.value !== 0);
    for ( const entry of key ? (unit.times ?? []) : [] ) {
      if ( (entry.key !== key) || !Number.isFinite(entry.times) || (entry.times === 1) ) continue;
      const more = Math.floor((total * entry.times) + 1e-9) - total;
      total += more;
      if ( more ) told.push({ label: entry.label, localize: false, value: more, modifier: true });
    }
    return { value: total, terms: told };
  };

  return {
    accuracy: stat([...accuracyTerms, ...adjust.hit], { key: "hit" }),
    damage: stat([{ ...key("FEO.Weapon.might"), value: w.might }, damageTerm, ...adjust.damage], { key: "damage" }),
    critical: stat([
      critTerm ?? { ...key(`FEO.Term.${critStat}Half`), value: s(critStat) / 2 },
      { ...key("FEO.Term.lukHalf"), value: s("luk") / 2 },
      { ...key("FEO.Term.weaponCrit"), value: w.crit },
      ...adjust.critical
    ], { key: "critical" }),
    attackSpeed: stat([...speedTerms("spd"), ...adjust.attackSpeed]),

    // A unit a skill leaves no Dodge has none, whatever would add to it
    dodge: (calc.dodgeBy === "none") ? { value: 0, terms: [] } : stat([
      { ...key(parry ? "FEO.Term.parrySpeedDouble" : "FEO.Term.speedDouble"), value: dodgeSpeed * 2 },
      { ...abbr("luk"), value: s("luk") },
      ...adjust.dodge
    ], { key: "dodge" }),
    critAvoid: stat([{ ...abbr("luk"), value: s("luk") }, ...adjust.critAvoid], { negative: true, key: "critAvoid" }),
    staffHit: stat([
      { ...key("FEO.Term.weaponHit"), value: w.hit },
      { ...key("FEO.Term.magTimesFive"), value: s("mag") * 5 },
      { ...abbr("dex"), value: s("dex") },
      ...adjust.hit
    ]),
    staffAvoid: stat([
      { ...key("FEO.Term.resTimesFive"), value: s("res") * 5 },
      { ...abbr("spd"), value: s("spd") },
      ...adjust.dodge
    ])
  };
}

/* -------------------------------------------- */

/**
 * Compute a unit's combat stats with a given weapon as plain numbers.
 * @param {CombatInput} unit
 * @param {WeaponInput|null} [weapon]
 * @returns {Record<keyof CombatBreakdown, number>}
 */
export function computeCombatStats(unit, weapon) {
  const breakdown = computeCombat(unit, weapon);
  return Object.fromEntries(Object.entries(breakdown).map(([stat, { value }]) => [stat, value]));
}

/* -------------------------------------------- */

/**
 * Offensive Staff Avoid against an attacker a number of tiles away.
 * @param {number} staffAvoid   Offensive Staff Avoid at zero distance
 * @param {number} distance     Tiles between the unit and the attacker
 * @returns {number}
 */
export function staffAvoidAt(staffAvoid, distance) {
  return staffAvoid + (nonNegative(distance) * 2);
}

/* -------------------------------------------- */

/**
 * The highest Attack Speed a foe can have and still be doubled, or null if nobody can be.
 * @param {number} speed        This unit's Attack Speed
 * @param {number} threshold    The lead needed to make a follow-up attack
 * @returns {number|null}
 */
export function doublesAtOrBelow(speed, threshold) {
  const limit = speed - threshold;
  return limit >= 0 ? limit : null;
}

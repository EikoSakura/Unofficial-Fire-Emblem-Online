import { FEO } from "../config.mjs";
import { classOpen } from "./creation.mjs";
import { canWield, wieldLevel } from "./weapons.mjs";

/**
 * How a skill, a weapon or an item suits a unit that is being made: whether it may take a skill, going by the
 * skill's prerequisite, and whether it can wield a weapon. The Character Creator says so beside what the
 * Compendium offers it.
 * Nothing here touches Foundry. Skills, weapons and items are read as the Compendium's library keeps them.
 */

/* -------------------------------------------- */
/*  What a skill asks for                       */
/* -------------------------------------------- */

/** The proficiencies that are magic, for a prerequisite that asks for "Magic". */
const MAGIC = ["fire", "thunder", "wind", "water", "earth", "light", "dark"];

/** A prerequisite that asks for nothing. */
const NO_PREREQUISITE = /^(|n\/?a|none|-+|–|—)$/i;

/**
 * Can a new unit take a skill, going by its prerequisite? Only what can be told for certain is judged: a class
 * tier, a weapon rank, another skill. A rank counts if the unit has it or its class offers it, since the
 * Creator asks for skills before proficiencies. Anything else is left for the table to read.
 * @param {string} prerequisite
 * @param {object} options
 * @param {object} options.unit               The unit's saved data
 * @param {object|null} options.cls           The class the unit has
 * @param {(name: string) => boolean} options.isSkill     Is this the name of a skill?
 * @param {string[]} [options.owned]          The names of the skills the unit has
 * @returns {{text: string, state: "none"|"met"|"unmet"|"read"}}    `read` for one that is not judged
 */
export function readPrerequisite(prerequisite, { unit, cls, isSkill, owned = [] }) {
  const text = String(prerequisite ?? "").replace(/\s+/g, " ").trim();
  if ( NO_PREREQUISITE.test(text) ) return { text: "", state: "none" };
  const has = new Set(owned.map((name) => name.toLowerCase()));
  const offered = new Set(cls?.system.proficiencies?.options ?? []);
  const ranked = (key) => offered.has(key) || ((unit.proficiencies?.[key]?.rank ?? "F") !== "F");

  const judge = (part) => {
    const clause = part.trim().replace(/\.$/, "");
    if ( /^2nd tier$/i.test(clause) ) return classOpen(cls) ? "unmet" : "met";
    const rank = /^unit has (.+?) rank$/i.exec(clause);
    if ( rank ) {
      const kinds = rank[1].toLowerCase().split(/\s+or\s+|\s*,\s*/);
      const keys = kinds.flatMap((kind) => (kind === "magic" ? MAGIC : kind in FEO.proficiencies ? [kind] : [null]));
      if ( keys.includes(null) ) return "read";
      return keys.some(ranked) ? "met" : "unmet";
    }
    if ( isSkill(clause) ) return has.has(clause.toLowerCase()) ? "met" : "unmet";
    return "read";
  };

  // "2nd Tier, Unit has Staff rank." asks for both; a prerequisite that is itself the name of a skill is one
  const verdicts = isSkill(text.replace(/\.$/, "")) ? [judge(text)] : text.split(/\s*,\s*(?=unit\b|2nd\b)/i).map(judge);
  const state = verdicts.includes("unmet") ? "unmet" : verdicts.includes("read") ? "read" : "met";
  return { text, state };
}

/* -------------------------------------------- */
/*  What a unit can wield                       */
/* -------------------------------------------- */

/** The names of what a weapon becomes when it breaks: nothing a new unit would buy. */
const BROKEN = new Set(Object.values(FEO.weapons.broken).map((form) => form.name.toLowerCase()));

/**
 * Is this something a shop does not sell: the broken form of a weapon or a shield?
 * @param {{name: string}} entry
 * @returns {boolean}
 */
export function isBroken(entry) {
  const name = String(entry.name ?? "").toLowerCase();
  return BROKEN.has(name) || /^broken\b/.test(name);
}

/* -------------------------------------------- */

/**
 * Has a new unit anything it was made to wield: a rank in some proficiency, or the claws or stones of its
 * people, who have no proficiency to take?
 * @param {object} unit         The unit's saved data
 * @param {object|null} cls     The class the unit has
 * @returns {boolean}
 */
export function isArmed(unit, cls) {
  const race = cls?.system.race ?? "";
  return FEO.shift.weaponCategories.includes(race) || (race === "monster")
    || Object.values(unit.proficiencies ?? {}).some((proficiency) => (proficiency?.rank ?? "F") !== "F");
}

/* -------------------------------------------- */

/**
 * How a weapon suits a new unit. A weapon type with a proficiency asks for a rank in it, and for the weapon's
 * own rank, unless the weapon says it needs none; the claws and stones of a people are theirs alone, and ask
 * for the unit's level; Bolts are for those who man a ballista.
 * @param {{category: string, rank: string, level: number|null, effect?: string}} weapon
 * @param {object} options
 * @param {object} options.unit         The unit's saved data
 * @param {object|null} options.cls     The class the unit has
 * @returns {{ok: boolean, why: ""|"rank"|"type"|"level"|"people", has?: string, needs?: string|number}}
 */
export function wieldOf(weapon, { unit, cls }) {
  const category = weapon.category;
  const race = cls?.system.race ?? "";
  if ( FEO.shift.weaponCategories.includes(category) || (category === "monster") ) {
    if ( race !== category ) return { ok: false, why: "people" };
    if ( (weapon.level ?? 0) > (unit.level ?? 1) ) return { ok: false, why: "level", needs: weapon.level };
    return { ok: true, why: "" };
  }
  if ( category === "bolt" ) {
    const mans = /ballist/i.test(`${cls?.name ?? ""} ${cls?.system.specialQualities ?? ""}`);
    return mans ? { ok: true, why: "" } : { ok: false, why: "people" };
  }
  const { ok, has, needs, level } = canWield(unit.proficiencies, weapon, { level: wieldLevel(unit) });
  if ( has === Object.keys(FEO.ranks)[0] ) {
    const open = /can be equipped without \w+ rank/i.test(weapon.effect ?? "");
    return open ? { ok: true, why: "" } : { ok: false, why: "type" };
  }
  if ( ok ) return { ok: true, why: "" };
  return level ? { ok: false, why: "wlv", has: level.has, needs: level.needs } : { ok: false, why: "rank", has, needs };
}

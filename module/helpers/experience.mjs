import { FEO } from "../config.mjs";
import { expSources, scaleExp } from "../rules/earnings.mjs";
import { gainExp, isPromoted, skillExp, staffExp } from "../rules/experience.mjs";
import { earnerOfActor, staffRowFor } from "./earnings.mjs";
import { expAmount } from "./earnings-context.mjs";
import { pop } from "./events.mjs";
import { armyOf } from "./exchange.mjs";

/**
 * Experience on units in Foundry: who earns it, and saving what they earn.
 */

/**
 * Does a unit earn experience? Units of the sides listed in the configuration do, until they reach their level
 * limit in a world that plays with the Level Cap.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    The unit's token, if it has one
 * @returns {boolean}
 */
export function earnsExp(actor, token = null) {
  if ( actor.system.atMaxLevel ) return false;
  return FEO.exp.armies.includes(armyOf(actor, token ?? actor.token ?? null));
}

/* -------------------------------------------- */

/**
 * Does a unit count as promoted for the staff and skill tables?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isPromotedUnit(actor) {
  return isPromoted(actor.system.level, actor.system.classItem?.system.tier);
}

/* -------------------------------------------- */

/**
 * Give a unit experience, from whatever source: a staff or a skill it used, a treatment, a spar, or what the
 * table gives it by hand. Its skills, and those of the units around it, can multiply what it earns.
 * @param {Actor} actor
 * @param {number} amount               Experience as the tables give it, or as it is given by hand
 * @param {object} [options]
 * @param {boolean} [options.bonus]     Is it Bonus EXP? A skill that says so does not multiply it
 * @param {{row: string, skill: string}|null} [options.staff]   The skill that chose the column of the staff
 *                                                              table the amount was read from, to be told
 * @returns {Promise<{gained: number, exp: number, ready: boolean, base?: number, times?: number,
 *   sources?: {skill: string, times: number}[], staff?: {row: string, skill: string}}>}
 *          What it gained and now has, and whether it can level up; with what skills made of the amount
 */
export async function awardExp(actor, amount, { staff = null, bonus = false } = {}) {
  const earner = earnerOfActor(actor);
  const scaled = scaleExp(amount, expSources(earner.skills, earner.self, { bonus }));
  const { exp, gained, ready } = gainExp(actor.system.exp, scaled.amount);
  if ( gained > 0 ) {
    await actor.update({ "system.exp": exp });
    pop(actor, [{ text: game.i18n.format("FEO.Exp.float", { amount: gained }), tone: "exp" }]);
  }
  const award = { gained, exp, ready };
  if ( scaled.sources.length && (scaled.base > 0) ) Object.assign(award, { base: scaled.base, times: scaled.times, sources: scaled.sources });
  if ( staff ) award.staff = staff;
  return award;
}

/* -------------------------------------------- */

/**
 * The skill that makes a unit earn by another column of the staff table than its class would, if it has one.
 * @param {Actor} actor
 * @returns {{row: "unpromoted"|"promoted", skill: string}|null}
 */
export function staffExpBy(actor) {
  return staffRowFor(actor, isPromotedUnit(actor));
}

/* -------------------------------------------- */

/**
 * The experience a unit earns for using a staff or a skill, read from the tables.
 * @param {Actor} actor
 * @param {"staff"|"skill"} kind
 * @param {string} name
 * @returns {number|null}     Null when the table does not list it, or the unit earns no experience
 */
export function useExp(actor, kind, name, { terrors = 0 } = {}) {
  if ( !earnsExp(actor) ) return null;
  const promoted = isPromotedUnit(actor);
  if ( kind !== "staff" ) return skillExp(name, promoted);

  // A skill can have staves earn by the other column of their table
  const by = staffExpBy(actor);
  return staffExp(name, by ? (by.row === "promoted") : promoted, { terrors });
}

/* -------------------------------------------- */

/**
 * A chat card row reporting experience earned.
 * @param {{gained: number, exp: number, ready: boolean}} award
 * @returns {{label: string, value: string, cls: string}}
 */
export function expRow(award) {
  return {
    label: game.i18n.localize("FEO.Unit.exp"),
    value: game.i18n.format(award.ready ? "FEO.Exp.rowReady" : "FEO.Exp.row", {
      amount: expAmount(award, game.i18n),
      total: award.exp,
      next: FEO.expPerLevel
    }),
    cls: "good"
  };
}

import { FEO } from "../config.mjs";
import { expSources, failedGrowths, killGold, levelUpOutcome, rerollGrowths, rerollSkill, scaleExp, staffRow } from "../rules/earnings.mjs";
import { rollD100 } from "./chat.mjs";
import { levelUpRows } from "./earnings-context.mjs";
import { standingOf, tokenInView } from "./positions.mjs";

/**
 * What a unit earns, in Foundry: reading a unit's skills for the experience, gold and growth rules, and
 * letting them have their say when the unit levels up. What they say is decided by the pure rules in
 * `rules/earnings.mjs`.
 *
 * @import {GrowthResult} from "../rules/progression.mjs"
 * @import {LevelUpOutcome} from "../rules/earnings.mjs"
 */

/**
 * Describe a unit for what its skills make it earn: its own skills, and with `around` what the skills of the
 * units around it give it, read from where its token stands right now.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.around]    Count what the units around it give it?
 * @returns {{skills: object[], self: object}}
 */
export function earnerOfActor(actor, { around = true } = {}) {
  const system = actor.system ?? {};
  const weapon = system.equippedWeapon;
  let place = null;
  if ( around ) {
    try {
      place = standingOf(actor.token ?? tokenInView(actor));
    } catch(err) {
      console.error(err);
    }
  }
  return {
    skills: [...(system.skills?.entries ?? []), ...(place?.auras ?? [])],
    self: {
      hp: system.hp?.value ?? 0,
      hpMax: system.hp?.max ?? 0,
      level: system.level ?? 1,
      stats: system.bare?.stats ?? system.statValues ?? {},
      weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
      waiting: !!system.waiting,
      shifted: !!system.shift?.transformed,
      near: place?.near ?? null
    }
  };
}

/* -------------------------------------------- */

/**
 * The most a unit can be handed from one fight, as its skills stand: experience up to a level's worth times
 * what multiplies it, and gold up to what its skills give for defeating a foe. A request to save more than
 * that for it is not one the system made.
 * @param {Actor} actor
 * @returns {{exp: number, gold: number}}
 */
export function mostEarned(actor) {
  const { skills, self } = earnerOfActor(actor);
  return { exp: scaleExp(FEO.expPerLevel, expSources(skills, self)).amount, gold: killGold(skills, self) };
}

/* -------------------------------------------- */

/**
 * The skill that makes a unit earn by another column of the staff table than its class would.
 * @param {Actor} actor
 * @param {boolean} promoted    Does the unit count as promoted?
 * @returns {{row: "unpromoted"|"promoted", skill: string}|null}    Null when no skill changes the column
 */
export function staffRowFor(actor, promoted) {
  const { skills, self } = earnerOfActor(actor, { around: false });
  const found = staffRow(skills, self);
  return found && ((found.row === "promoted") !== !!promoted) ? found : null;
}

/* -------------------------------------------- */

/**
 * Roll the growth rates of a level up that failed once more, for a unit with a skill that allows it.
 * @param {Actor} actor
 * @param {GrowthResult[]} results      The growth rolls as they came out
 * @returns {Promise<{results: GrowthResult[], roll: Roll|null}>}   The rolls as they now stand, and the dice
 *                                                                  that were rolled for it, if any were
 */
export async function rerollFailed(actor, results) {
  const { skills, self } = earnerOfActor(actor, { around: false });
  const skill = rerollSkill(skills, self);
  const failed = skill ? failedGrowths(results) : [];
  if ( !failed.length ) return { results, roll: null };
  const { roll, results: dice } = await rollD100(failed.length);
  const queue = dice.slice();
  return { results: rerollGrowths(results, () => queue.shift(), skill), roll };
}

/* -------------------------------------------- */

/**
 * What a unit's skills do once its growth rates have been rolled: gold, HP restored, a boost that lasts.
 * Nothing is saved here. A unit that is down or out of the fight is not healed.
 * @param {Actor} actor
 * @param {GrowthResult[]} results      The growth rolls, after any that were rolled again
 * @param {object} [update]             What the level up is about to save, for the HP it leaves the unit at
 * @returns {{outcome: LevelUpOutcome, update: object, rows: {label: string, value: string, cls: string}[],
 *   grants: import("../rules/timed.mjs").TimedChange[]}}
 *          What to save on top, the rows for the level-up card, and the changes that last a while to grant
 *          once the level up is saved
 */
export function levelUpSkills(actor, results, update = {}) {
  const system = actor.system;
  const { skills, self } = earnerOfActor(actor, { around: false });
  const hpGain = (results ?? []).find((result) => result.key === "hp")?.gain ?? 0;
  const standing = !system.defeat?.state;
  const hp = update["system.hp.value"] ?? system.hp.value;

  // The unit as the level up leaves it. One that is down has no HP to restore
  const after = { ...self, hp, hpMax: standing ? system.hp.max + hpGain : hp };
  const outcome = levelUpOutcome(skills, after, results);
  const extra = {};
  if ( outcome.goldTotal > 0 ) extra["system.gold"] = system.gold + outcome.goldTotal;
  if ( outcome.heal?.healed > 0 ) extra["system.hp.value"] = outcome.heal.hp;
  return {
    outcome,
    update: extra,
    rows: levelUpRows(outcome, game.i18n),
    grants: outcome.granted.map((granted) => granted.change).filter(Boolean)
  };
}

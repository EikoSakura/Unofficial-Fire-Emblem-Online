/**
 * What the tests share: the skills as they are written in `packs-src/skills/effects.json`, units to try them
 * on, and dice that come up as told.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEO } from "../../module/config.mjs";
import { effectsOf } from "../../module/rules/skills.mjs";
import { withArms } from "../../module/rules/lending.mjs";
import { usedUp } from "../../module/rules/skill-usage.mjs";

const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../../packs-src/skills/effects.json", import.meta.url)), "utf8")).skills;

// The weapons that skills name, with the numbers of the Weapons tab, as the build keeps them for the tests
const lent = JSON.parse(readFileSync(fileURLToPath(new URL("../../packs-src/skills/lent-weapons.json", import.meta.url)), "utf8"));

/** The weapons of that list, as the build looks them up on the Weapons tab. */
export const arsenal = {
  named: (name) => lent.weapons[name] ?? null,
  tomes: ({ category, range }) => (lent.tomes[`${category}|${range ?? ""}`] ?? []).map((name) => lent.weapons[name])
};

/**
 * The effects of a skill as the build writes them into the pack: with the numbers of the weapons they name.
 * @param {string} name       As it is listed in effects.json
 * @returns {object[]}
 */
export function builtEffects(name) {
  const entry = listed[name];
  if ( !entry ) throw new Error(`effects.json lists no skill named ${name}`);
  const { effects, problems } = withArms(entry.effects, arsenal);
  if ( problems.length ) throw new Error(`${name}: ${problems.join("; ")}`);
  return effects;
}

/**
 * A skill as a unit has it equipped, with the effects the system applies for it.
 * @param {string} name               As it is listed in effects.json
 * @param {object} [options]
 * @param {string} [options.choice]   The variant chosen, for a skill that offers several
 * @param {boolean} [options.active]  Is it switched on, for a skill that is chosen when to activate?
 * @param {number} [options.used]     Uses spent, for a skill that counts them
 * @param {number} [options.raises]   Times it has been raised, for a skill that can be
 * @param {boolean} [options.early]   Was it used before its cooldown was over, for a skill that may be?
 * @param {object} [options.picked]   What its unit picked for a fight: steps by the id of a trade, and a stat
 * @param {boolean} [options.chosen]  Is it marked as chosen when to activate on the reference sheet?
 * @param {boolean} [options.nihil]   Is it marked as cancelled by Nihil?
 * @param {number} [options.cooldown] Turns it still sits out, for a skill with a cooldown
 * @returns {object}
 */
export function skill(name, { choice = "", active = false, used = 0, raises = 0, early = false, picked = {}, chosen = false, nihil = false, cooldown = 0 } = {}) {
  const entry = listed[name];
  if ( !entry ) throw new Error(`effects.json lists no skill named ${name}`);
  const usage = entry.usage ? { kind: "", cooldown: 0, lasts: 0, uses: 0, per: "", ...entry.usage } : null;
  const effects = effectsOf({ effects: builtEffects(name), choice, raises, early, over: !!usage?.over && usedUp(usage, { used }) });
  return {
    id: name.toLowerCase().replace(/[^a-z]+/g, "-"),
    name,
    nihil,
    chosen: chosen || ["declare", "toggle", "action"].includes(usage?.kind),
    picked,
    choice,
    active,
    spends: usage?.kind === "declare",
    effects,
    usage,
    state: usage ? { active, cooldown, lasting: 0, used } : null
  };
}

/**
 * A skill made up for a test.
 * @param {string} name
 * @param {object[]} effects
 * @returns {object}
 */
export function made(name, effects) {
  return { id: name.toLowerCase(), name, nihil: false, choice: "", active: false, spends: false, effects, usage: null, state: null };
}

const STATS = { str: 10, mag: 4, def: 6, res: 3, dex: 8, spd: 8, luk: 5, mov: 5, con: 8, los: 6 };

/**
 * A unit as the rules of events read it (see `rules/events.mjs`).
 * @param {object} [options]
 * @returns {import("../../module/rules/events.mjs").EventUnit}
 */
export function unit({ name = "Unit", hp = 20, hpMax = 20, level = 5, stats = {}, skills = [], conditions = {}, qualities = "",
  weapon = null, bends = null, inTurn = false, times = 1, resilience = undefined, near = null, gold = 0, tier = undefined, gender = "",
  bestRank = "" } = {}) {
  const all = { ...STATS, ...stats };
  return {
    name,
    uuid: `Actor.${name}`,
    hp,
    hpMax,
    level,
    stats: all,
    skills,
    conditions,
    bends,
    activation: 0,
    always: false,
    times,
    resilience,
    inTurn,
    self: { hp, hpMax, level, tier, gender, bestRank, gold, stats: all, weapon, qualities, conditions, near, waiting: false, shifted: false }
  };
}

/**
 * Dice that come up as told, one after the other, and say how many were rolled.
 * @param {...number} rolls
 * @returns {(() => number) & {rolled: () => number}}
 */
export function dice(...rolls) {
  let at = 0;
  const d100 = () => {
    if ( at >= rolls.length ) throw new Error(`a die was rolled that the test did not expect (after ${rolls.length})`);
    return rolls[at++];
  };
  d100.rolled = () => at;
  return d100;
}

/**
 * A unit as an exchange of attacks reads it (see `rules/combat.mjs`), with a sword in hand.
 * @param {object} [options]
 * @param {object|null} [options.move]   How it moved this turn (see `rules/movement.mjs`); null when that cannot
 *                                      be judged
 * @returns {object}
 */
export function fighter({ name = "Fighter", hp = 20, hpMax = 20, level = 5, stats = {}, skills = [], conditions = {}, qualities = "",
  weapon = {}, gold = 0, tier = undefined, move = null, shield = null } = {}) {
  const all = { ...STATS, ...stats };
  const held = weapon ? {
    id: `${name}-weapon`, name: "Iron Sword", category: "sword", might: 5, hit: 90, crit: 0, weight: 5, rank: "E", range: "1",
    effect: "", damageStat: "str", wexp: 1, uses: { value: 40, max: 40 }, ...weapon
  } : null;
  return {
    name,
    uuid: `Actor.${name}`,
    hp,
    hpMax,
    level,
    tier,
    gold,
    conditions,
    stats: all,
    endurance: 0,
    haste: 0,
    activation: 0,
    incapacitated: false,
    resilience: undefined,
    record: { level, exp: 0, hpBase: hpMax, injuries: 0, graveWounds: 0, defeat: { state: "", turns: 0, paused: false }, shift: {} },
    waiting: false,
    shifted: false,
    skills,
    near: null,
    move,
    auras: [],
    timed: [],
    bare: {
      stats: all,
      base: all,
      boosts: Object.fromEntries(Object.keys(FEO.combatBoosts ?? {}).map((key) => [key, 0])),
      calc: {},
      modifiers: [],
      accuracy: 0,
      weapon: held ? { hit: held.hit, crit: held.crit, weight: held.weight, rank: held.rank } : null
    },
    combat: {},
    shield,
    weapon: held,

    proficiencies: { sword: { rank: "E", wexp: 0 } },
    qualities,
    noCounter: false,
    noDodge: false
  };
}

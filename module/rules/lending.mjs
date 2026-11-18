/**
 * Weapons a skill lends its unit: a weapon the unit does not carry, with the numbers the Weapons tab gives it,
 * for the attacks the unit starts. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill says what it lends with a `lend` part, which stands in an effect of its own and is always there. What
 * the effect asks of its unit (`when`, a `choice`) is asked as of any effect that needs no fight:
 *
 *   lend: {
 *     weapon: "Arclight",                 // a weapon named on the Weapons tab; several are written as a list,
 *                                         // ["Force", "Fire"], and the unit picks among them
 *     tomes: { category: "wind", range: "1-2" },      // in place of names: every weapon of that kind that has
 *                                         // this Range on the Weapons tab
 *     rank: "best",                       // of those, the ones of the rank of its unit's best proficiency, or
 *                                         // of the next rank below that has any
 *     proficient: true,                   // of those, the ones of a kind its unit has a rank of E or higher with
 *     range: "1-2",                       // the Range it attacks at, in place of the weapon's own
 *     stat: "mag",                        // the stat added to its Might, in place of the weapon's own
 *     wexp: 0.5,                          // the share of its weapon experience the unit earns: 1 unless given
 *     hand: true,                         // it is not picked: the unit attacks with it, in place of the weapon
 *                                         // in its hand, from a distance that weapon does not reach and this
 *                                         // one does. The weapon in hand is still what is swung: it pays the
 *                                         // use as its kind does and earns its own weapon experience
 *     cast: true,                         // it is not attacked with: one is picked as the skill is switched on,
 *                                         // for an attack the skill has its unit make (`attack: { lent: true }`)
 *     bare: true,                         // it is picked as any lent weapon is, and a unit with no weapon in
 *                                         // its hand fights with it by itself: in a fight it starts, and to
 *                                         // attack back in one an enemy starts
 *     better: { skill: "Draconic Heritage", weapon: "Rexflame" },
 *                                         // a chance of that skill, rolled as the fight is started (its effect
 *                                         // `{ proc: { on: "lend", stat: "dex" }, betters: "Breath Weapon" }`):
 *                                         // the unit attacks with this weapon in its place
 *     arms: [{ name, category, might, hit, crit, range, weight, rank, wexp, effect, damageStat }]
 *                                         // the weapons with their numbers, which the build writes from the
 *                                         // Weapons tab so that no number is written by hand
 *   }
 *
 * A lent weapon is no Item. It wears nothing, has no uses to run out of, and is neither traded nor put in the
 * pack. A unit attacks with it whatever its ranks. It is for the fights its unit starts: a counter-attack is
 * made with the weapon in hand, or with a weapon lent to `bare` hands where there is none in them. A skill that counts its uses (`usage.kind: "auto"`, with a cooldown or uses) is
 * spent by the fight its weapon is attacked with, and lends nothing while it cannot be spent.
 *
 * An attack a skill has its unit make at a moment of a fight may be made with a weapon of the Weapons tab too:
 * `attack: { weapon: "Elwind" }` has the numbers of that weapon, written in by the build as `arm`, and
 * `attack: { lent: true, hit: -10 }` those of the weapon picked for its skill, with what it says added.
 */
import { FEO } from "../config.mjs";
import { canUse, turnsToSitOut } from "./skill-usage.mjs";

/** What a `lend` part may say. */
const LEND_KEYS = ["weapon", "tomes", "rank", "proficient", "range", "stat", "wexp", "hand", "cast", "bare", "better", "arms"];

/** What the build writes of a weapon. */
export const ARM_KEYS = ["name", "category", "might", "hit", "crit", "range", "weight", "rank", "wexp", "effect", "damageStat"];

/** The id under which a skill keeps the weapon that was picked for it (see `state.picked` in `skill-usage.mjs`). */
export const LENT_PICK = "lent";

/**
 * @typedef LentArm
 * @property {string} name
 * @property {string} category
 * @property {number} might
 * @property {number} hit
 * @property {number} crit
 * @property {string} range
 * @property {number} weight
 * @property {string} rank
 * @property {number} wexp
 * @property {string} effect
 * @property {string} damageStat
 */

/**
 * @typedef LendOffer
 * @property {string} key             What tells it from the others: the skill's id and the weapon's name
 * @property {string} skill           The skill that lends it
 * @property {string|null} id         That skill's Item, where it is one
 * @property {string} name            The weapon
 * @property {boolean} auto           Is it used by itself, from where the weapon in hand does not reach?
 * @property {boolean} cast           Is it picked for an attack the skill makes, and not attacked with?
 * @property {boolean} bare           Does a unit with no weapon in its hand fight with it by itself?
 * @property {boolean} ready          Can it be attacked with now?
 * @property {"cooldown"|"uses"|null} reason      Why not
 * @property {number} wait            The turns its skill still sits out
 * @property {boolean} spends         Does a fight with it spend its skill?
 * @property {{weapon: object, bare: object}} arm     The weapon as a fight reads one (see `armedWith`)
 * @property {{skill: string, arm: {weapon: object, bare: object}}|null} better
 *                                    The weapon a chance of another skill has the unit attack with instead
 */

/* -------------------------------------------- */

/**
 * The weapons a `lend` part names, as it is written by hand: for the build, which looks each up.
 * @param {object} lend
 * @returns {{names: string[], tomes: {category: string, range?: string}|null, better: string|null}}
 */
export function lendNames(lend) {
  return {
    names: (lend?.weapon === undefined) ? [] : [].concat(lend.weapon),
    tomes: lend?.tomes ?? null,
    better: lend?.better?.weapon ?? null
  };
}

/* -------------------------------------------- */

/**
 * A weapon as a `lend` part keeps it: its name and the numbers a fight reads.
 * @param {string} name       As the compendium names it
 * @param {object} system     The weapon's data
 * @returns {LentArm}
 */
export function armData(name, system) {
  return {
    name,
    category: system.category,
    might: system.might ?? 0,
    hit: system.hit ?? 0,
    crit: system.crit ?? 0,
    range: String(system.range ?? ""),
    weight: system.weight ?? 0,
    rank: system.rank ?? "E",
    wexp: system.wexp ?? 0,
    effect: String(system.effect ?? ""),
    damageStat: system.damageStat ?? "str"
  };
}

/* -------------------------------------------- */

/**
 * The effects of a skill with the weapons they name written in: the `arms` of each `lend` part, the `arm` of
 * what betters it, and the `arm` of an attack made with a named weapon. The build does this from the Weapons
 * tab, and the tests from the list the build keeps of the weapons that skills name.
 * @param {object[]} effects
 * @param {object} lookup
 * @param {(name: string) => LentArm|null} lookup.named       A weapon by its name
 * @param {(tomes: {category: string, range?: string}) => LentArm[]} lookup.tomes
 *                                                    Every weapon of a kind, with that Range where one is given
 * @returns {{effects: object[], problems: string[]}}
 */
export function withArms(effects, { named, tomes }) {
  const problems = [];
  const find = (name) => {
    const arm = named(name);
    if ( !arm ) problems.push(`the Weapons tab has no weapon named "${name}"`);
    return arm;
  };
  const filled = (effects ?? []).map((effect) => {
    let next = effect;
    if ( effect?.lend && (typeof effect.lend === "object") ) {
      const lend = { ...effect.lend };
      const { names, tomes: kind, better } = lendNames(lend);
      lend.arms = kind ? tomes(kind) : names.map(find).filter(Boolean);
      if ( kind && !lend.arms.length ) problems.push(`the Weapons tab has no ${kind.category} weapon with a Range of "${kind.range ?? "any"}"`);
      if ( better ) {
        const arm = find(better);
        if ( arm ) lend.better = { ...lend.better, arm };
      }
      next = { ...next, lend };
    }
    if ( (typeof effect?.attack?.weapon === "string") && effect.attack.weapon ) {
      const arm = find(effect.attack.weapon);
      if ( arm ) next = { ...next, attack: { ...effect.attack, arm } };
    }
    return next;
  });
  return { effects: filled, problems };
}

/* -------------------------------------------- */

/**
 * The highest rank among a unit's proficiencies.
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @returns {string}
 */
export function bestRank(proficiencies) {
  const order = Object.keys(FEO.ranks);
  const best = Math.max(...Object.values(proficiencies ?? {}).map((proficiency) => order.indexOf(proficiency?.rank)), 0);
  return order[best];
}

/* -------------------------------------------- */

/**
 * Does a unit have a rank of E or higher with a kind of weapon? Anima goes by any of its proficiencies.
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @param {string} category
 * @returns {boolean}
 */
export function proficientWith(proficiencies, category) {
  const order = Object.keys(FEO.ranks);
  const keys = (category === "anima") ? FEO.animaProficiencies : [FEO.weaponCategories[category]?.proficiency];
  return keys.some((key) => key && (order.indexOf(proficiencies?.[key]?.rank) >= 1));
}

/* -------------------------------------------- */

/**
 * The weapons of a `lend` part that its unit is lent as it stands: all of them, or those its ranks leave.
 * @param {object} lend
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @returns {LentArm[]}
 */
export function lentArms(lend, proficiencies = {}) {
  let arms = (lend?.arms ?? []).filter((arm) => arm?.name);
  if ( lend?.proficient ) arms = arms.filter((arm) => proficientWith(proficiencies, arm.category));
  if ( lend?.rank === "best" ) {
    const order = Object.keys(FEO.ranks);
    const held = arms.map((arm) => order.indexOf(arm.rank));
    const top = order.indexOf(bestRank(proficiencies));
    const at = Math.max(...held.filter((rank) => rank <= top), -1);
    arms = arms.filter((arm, index) => held[index] === at);
  }
  return arms;
}

/* -------------------------------------------- */

/**
 * A lent weapon as a fight reads a weapon (see `armedWith` in `actions.mjs`).
 * @param {object} lend               The `lend` part
 * @param {LentArm} arm               The weapon, with its numbers
 * @param {object} [options]
 * @param {string} [options.skill]    The skill that lends it
 * @param {object|null} [options.held]    The weapon in the unit's hand, for a weapon lent to `hand`: its id, its
 *                                    kind, its uses and its weapon experience
 * @returns {{weapon: object, bare: {hit: number, crit: number, weight: number, rank: string}}}
 */
export function armOf(lend, arm, { skill = "", held = null } = {}) {
  const share = Number.isFinite(lend?.wexp) ? Math.max(lend.wexp, 0) : 1;
  const weapon = {
    id: null,
    name: arm.name,
    category: arm.category,
    might: arm.might ?? 0,
    range: String(lend?.range ?? arm.range ?? "1"),
    effect: String(arm.effect ?? ""),
    damageStat: lend?.stat ?? arm.damageStat ?? "str",
    wexp: (arm.wexp ?? 0) * share,
    uses: { value: 0, max: 0 },
    lent: skill
  };

  // A weapon lent to the hand: the weapon in hand is swung, so that it wears as its kind does and earns the
  // weapon experience of its kind
  if ( lend?.hand && held ) {
    Object.assign(weapon, {
      id: held.id ?? null,
      uses: { value: held.uses?.value ?? 0, max: held.uses?.max ?? 0 },
      wexp: (held.wexp ?? 0) * share,
      wears: held.category,
      trains: held.category,
      swung: held.name ?? ""
    });
  }
  return { weapon, bare: { hit: arm.hit ?? 0, crit: arm.crit ?? 0, weight: arm.weight ?? 0, rank: arm.rank ?? "E" } };
}

/* -------------------------------------------- */

/**
 * What a unit's skills lend it as it stands: one offer for each weapon.
 * @param {{skill: string, id?: string|null, lend: object, usage?: object|null, state?: object|null}[]} lends
 *                                    The `lend` parts that hold for the unit (see `skillLends` in `skills.mjs`)
 * @param {object} [unit]
 * @param {Record<string, {rank: string}>} [unit.proficiencies]
 * @param {object|null} [unit.held]   The weapon in its hand: `{ id, name, category, uses, wexp, broken }`
 * @returns {LendOffer[]}
 */
export function lendOffers(lends, { proficiencies = {}, held = null } = {}) {
  const offers = [];
  const spent = !!held && ((held.uses?.max > 0) && !(held.uses.value > 0));
  for ( const { skill, id = null, lend, usage = null, state = null } of lends ?? [] ) {
    // A weapon lent to the hand needs a weapon in it that is fit to swing
    if ( lend.hand && (!held || held.broken || spent) ) continue;
    const counted = !!usage?.kind && ((usage.cooldown > 0) || (usage.uses > 0));
    const able = counted ? canUse(usage, state) : { ok: true, reason: null };
    for ( const arm of lentArms(lend, proficiencies) ) {
      const better = (lend.better?.arm && lend.better.skill)
        ? { skill: lend.better.skill, arm: armOf(lend, lend.better.arm, { skill, held }) }
        : null;
      offers.push({
        key: `${id ?? skill}:${arm.name}`,
        skill,
        id,
        name: arm.name,
        auto: !!lend.hand,
        cast: !!lend.cast,
        bare: !!lend.bare,
        ready: able.ok,
        reason: able.ok ? null : able.reason,
        wait: (able.reason === "cooldown") ? turnsToSitOut(state) : 0,
        spends: counted && !lend.cast,
        arm: armOf(lend, arm, { skill, held }),
        better
      });
    }
  }
  // Several skills may lend the same weapon to bare hands: it is offered once
  const twice = (offer, index) => offer.bare && (offers.findIndex((other) => other.bare && (other.name === offer.name)) !== index);
  return offers.filter((offer, index) => (offers.findIndex((other) => other.key === offer.key) === index) && !twice(offer, index));
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit with no weapon in its hand fights with by itself, if its skills lend it one.
 * @param {LendOffer[]} offers        What its skills lend it
 * @param {boolean} [armed]           Has it a weapon in its hand?
 * @returns {LendOffer|null}
 */
export function lentBare(offers, armed = false) {
  if ( armed ) return null;
  return (offers ?? []).find((offer) => offer.bare && offer.ready) ?? null;
}

/* -------------------------------------------- */

/**
 * The nearest and farthest a weapon attacks at, as its Range is written with numbers.
 * @param {string} range
 * @returns {{min: number, max: number}|null}
 */
function span(range) {
  const numbers = String(range ?? "").match(/\d+/g)?.map(Number) ?? [];
  if ( !numbers.length ) return /midrange/i.test(String(range ?? "")) ? { min: 1, max: 1 } : null;
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit attacks with at a distance: the one it picked, or else one that is used by itself
 * where the weapon in its hand does not reach.
 * @param {LendOffer[]} offers        What its skills lend it
 * @param {object} options
 * @param {string|null} [options.picked]      The offer it picked, by its `key`
 * @param {number} options.distance           Tiles to the unit it attacks
 * @param {boolean} [options.reaches]         Does the weapon in its hand attack at that distance?
 * @returns {LendOffer|null}
 */
export function lentAt(offers, { picked = null, distance, reaches = false } = {}) {
  const usable = (offers ?? []).filter((offer) => offer.ready && !offer.cast);
  const chosen = picked ? usable.find((offer) => !offer.auto && (offer.key === picked)) : null;
  if ( chosen ) return chosen;
  if ( reaches ) return null;
  return usable.find((offer) => {
    const reach = offer.auto ? span(offer.arm.weapon.range) : null;
    return !!reach && (distance >= reach.min) && (distance <= reach.max);
  }) ?? null;
}

/* -------------------------------------------- */

/**
 * How far a unit attacks with what it is lent, for the map: the Range of the weapon it picked in place of the
 * one in its hand, or the Range of that one widened by what is lent to the hand.
 * @param {LendOffer[]} offers
 * @param {object} [options]
 * @param {string|null} [options.picked]
 * @param {{min: number, max: number}|null} [options.own]     How far the weapon in its hand reaches
 * @returns {{min: number, max: number, lent: boolean}|null}  Null where nothing is lent that changes it
 */
export function lentRange(offers, { picked = null, own = null } = {}) {
  const usable = (offers ?? []).filter((offer) => offer.ready && !offer.cast);
  const chosen = picked ? usable.find((offer) => !offer.auto && (offer.key === picked)) : null;
  if ( chosen ) {
    const reach = span(chosen.arm.weapon.range);
    return reach ? { ...reach, lent: true } : null;
  }
  if ( !own ) return null;
  let { min, max } = own;
  let widened = false;
  for ( const offer of usable.filter((entry) => entry.auto) ) {
    const reach = span(offer.arm.weapon.range);
    if ( !reach || ((reach.min >= min) && (reach.max <= max)) ) continue;
    min = Math.min(min, reach.min);
    max = Math.max(max, reach.max);
    widened = true;
  }
  return widened ? { min, max, lent: false } : null;
}

/* -------------------------------------------- */

/**
 * The attack a skill has its unit make with a weapon of the Weapons tab, as an attack with numbers of its own is
 * written (see `attack` in `skills.mjs`): the weapon's numbers, with what the attack itself says added to its
 * Hit and its Might.
 * @param {object} attack             The `attack` part: `{ arm }` or `{ lent: true }`, with `hit` and `might`
 * @param {LentArm|null} arm          The weapon: the one written in, or the one picked for the skill
 * @returns {object|null}             Null where there is no weapon to make it with
 */
export function attackWith(attack, arm) {
  if ( !arm ) return null;
  const reach = span(arm.range) ?? { min: 1, max: 1 };
  const magic = !!FEO.weaponCategories[arm.category]?.magic;
  return {
    hit: (arm.hit ?? 0) + (Number.isFinite(attack?.hit) ? attack.hit : 0),
    might: Math.max((arm.might ?? 0) + (Number.isFinite(attack?.might) ? attack.might : 0), 0),
    critical: arm.crit ?? 0,
    range: Number.isInteger(attack?.range) ? attack.range : reach.max,
    from: Number.isInteger(attack?.range) ? 1 : reach.min,
    stat: arm.damageStat ?? (magic ? "mag" : "str"),
    against: (magic || (arm.damageStat === "mag")) ? "res" : "def",
    element: magic ? arm.category : null,
    effect: String(arm.effect ?? ""),
    name: arm.name
  };
}

/* -------------------------------------------- */

/**
 * The weapon picked for a skill that casts one, among those it lends its unit: the one it kept, or the first.
 * @param {object[]} effects          The skill's effects
 * @param {Record<string, any>} [picked]      What the skill keeps as picked
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @returns {LentArm|null}
 */
export function castArm(effects, picked = {}, proficiencies = {}) {
  const lend = (effects ?? []).find((effect) => effect?.lend?.cast)?.lend;
  if ( !lend ) return null;
  const arms = lentArms(lend, proficiencies);
  return arms.find((arm) => arm.name === picked?.[LENT_PICK]) ?? arms[0] ?? null;
}

/* -------------------------------------------- */

/**
 * Check a `lend` part, so that a typing mistake does not pass silently.
 * @param {object} lend
 * @param {object} [effect]       The effect it stands in
 * @returns {string[]}            What is wrong, in plain words; empty when nothing is
 */
export function checkLend(lend, effect = {}) {
  const problems = [];
  if ( !lend || (typeof lend !== "object") || Array.isArray(lend) ) return ["lend must be an object"];
  for ( const key of Object.keys(lend) ) if ( !LEND_KEYS.includes(key) ) problems.push(`lend: unknown part "${key}"`);
  const names = (lend.weapon === undefined) ? [] : [].concat(lend.weapon);
  if ( names.some((name) => (typeof name !== "string") || !name) ) problems.push("lend: a weapon is named as it is on the Weapons tab");
  if ( (lend.weapon === undefined) === (lend.tomes === undefined) ) problems.push("lend: names its weapons, or the kind and Range of them, not both");
  if ( lend.tomes !== undefined ) {
    const tomes = lend.tomes;
    if ( !tomes || (typeof tomes !== "object") || !(tomes.category in FEO.weaponCategories) ) problems.push("lend: \"tomes\" names a kind of weapon");
    else for ( const key of Object.keys(tomes) ) if ( !["category", "range"].includes(key) ) problems.push(`lend: "tomes" cannot say "${key}"`);
  }
  if ( (lend.rank !== undefined) && (lend.rank !== "best") ) problems.push("lend: \"rank\" is \"best\" or left out");
  for ( const key of ["proficient", "hand", "cast", "bare"] ) if ( (lend[key] !== undefined) && (lend[key] !== true) ) problems.push(`lend: "${key}" is true or left out`);
  if ( lend.hand && lend.cast ) problems.push("lend: a weapon is lent to the hand or cast, not both");
  if ( lend.bare && (lend.hand || lend.cast) ) problems.push("lend: a weapon for bare hands is neither lent to the hand nor cast");
  if ( (lend.range !== undefined) && !span(lend.range) ) problems.push(`lend: cannot read the range "${lend.range}"`);
  if ( (lend.stat !== undefined) && !(lend.stat in FEO.damageStats) ) problems.push(`lend: unknown stat "${lend.stat}"`);
  if ( (lend.wexp !== undefined) && !(Number.isFinite(lend.wexp) && (lend.wexp >= 0)) ) problems.push("lend: \"wexp\" is the share of the weapon experience that is earned");
  if ( lend.better !== undefined ) {
    const better = lend.better;
    if ( !better || (typeof better !== "object") || (typeof better.skill !== "string") || !better.skill || (typeof better.weapon !== "string") || !better.weapon ) {
      problems.push("lend: \"better\" names a skill and the weapon its chance has the unit attack with");
    }
    else for ( const key of Object.keys(better) ) if ( !["skill", "weapon", "arm"].includes(key) ) problems.push(`lend: "better" cannot say "${key}"`);
  }
  if ( lend.arms !== undefined ) {
    if ( !Array.isArray(lend.arms) || lend.arms.some((arm) => !arm || (typeof arm.name !== "string") || !(arm.category in FEO.weaponCategories)) ) {
      problems.push("lend: \"arms\" is written by the build, from the Weapons tab");
    }
  }

  // It stands alone, with nothing but what its effect asks of its unit outside of a fight
  for ( const key of Object.keys(effect ?? {}) ) {
    if ( !["lend", "when", "choice"].includes(key) ) problems.push(`lend: stands in an effect of its own, without "${key}"`);
  }
  return problems;
}

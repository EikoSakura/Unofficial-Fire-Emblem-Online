/**
 * Combat Arts, an Optional Module: what an Art's text and Cost say, which weapons can perform it, how many a
 * unit may have learned, and what a unit that attacks with one brings to the fight. Pure functions of plain
 * data, so that they can be tested outside of Foundry.
 *
 * An Art is written the way the lists of Arts write them, and the system reads what leaves no doubt:
 *
 *   Effect: "+2 Might, +10 Hit and Critical, -20 Dodge. 2x Strikes. Unit cannot make a follow up via Doubling."
 *   Cost:   "3 HP, 5 WU"
 *
 * From the Effect it reads the numbers added to Might, Hit, Critical, Dodge and Critical Avoid, "2x Strikes",
 * "Effective against Armored units", a Range ("2 Range", "1-3 Range", "+1 Range"), that the unit makes no
 * follow-up attack, that the enemy cannot counter-attack, that a fatal blow leaves the enemy with 1 HP, and
 * "Effects persist through combat". Whatever else the text says is kept as it is written, for the table to
 * apply. A number that only counts under a condition ("an additional +4 Might if...") is part of that.
 *
 * An Art can also carry effects of its own, in the notation of skill effects (see `skills.mjs`), for what its
 * text says beyond that: a condition it inflicts, HP it restores, a stat it lowers after the fight. Its unit
 * has them as one more skill while it performs the Art, and only as the unit that initiates. Such an Art says
 * itself what is still left of its text for the table.
 *
 *   effects: [{ proc: { on: "attack", sure: true, once: true }, inflicts: ["bleed"] }]
 *   left: ""
 *
 * An Art is performed from where its kind of weapon strikes: a melee Art next to the foe, a Bow or Rifle Art
 * from 2 tiles or more, any other from wherever the weapon reaches. An Art whose text names a Range is
 * performed from there instead.
 */
import { FEO } from "../config.mjs";

/** The numbers an Art can add, as its text names them. The longer name comes first so that it is not cut short. */
const NUMBERS = [["Critical Avoid", "critAvoid"], ["Might", "might"], ["Hit", "hit"], ["Critical", "critical"], ["Dodge", "dodge"]];

const NAMES = NUMBERS.map(([name]) => name).join("|");

/** One number for one or more of those: "+10 Hit", "+20 Critical and Hit", "+10 Hit, Dodge and Critical". */
const LIST = new RegExp(`^([+\\-\\u2212]\\s*\\d+)\\s+((?:${NAMES})(?:\\s*(?:,\\s*and|,|and)\\s*(?:${NAMES}))*)$`, "i");

/** A piece of an Art's text is one of these, or is left to the table. */
const PHRASES = {
  strikes: /^(\d)x strikes$/i,
  effective: /^effective against (.+?) units?$/i,
  rangeAdd: /^\+\s*(\d+) range$/i,
  range: /^(?:can be used at )?(\d+)(?:\s*[-–]\s*(\d+))? range$/i,
  ownRange: /^uses (?:the )?(?:equipped )?weapon'?s range$/i,
  noFollowUp: /^(?:(?:the )?(?:unit|user) )?cannot make (?:a |any )?follow[- ]?ups?(?: attacks?)?(?: via doubling)?$/i,
  foeNoCounter: /^(?:the )?(?:enemy|target|foe) cannot counter[- ]?attack$/i,
  persist: /^effects persist through(?:out)? combat$/i,
  spare: /^fatal blows leave (?:the )?(?:enemies|enemy|foe|target) (?:with|at) 1 hp(?: instead)?$/i
};

/**
 * @typedef ArtReading
 * What the system reads from an Art's Effect.
 * @property {number} might
 * @property {number} hit
 * @property {number} critical
 * @property {number} dodge
 * @property {number} critAvoid
 * @property {number} strikes               How many times its attack strikes, 1 unless the Art says more
 * @property {string[]} effective           The Special Qualities its attack is effective against
 * @property {{add?: number, min?: number, max?: number}|null} range
 *                                          What it changes about how far the weapon attacks
 * @property {boolean} noFollowUp           Does its unit make no follow-up attack?
 * @property {boolean} foeNoCounter         Can the enemy not counter-attack?
 * @property {boolean} persist              Do its effects last for the whole fight, not only the first attack?
 * @property {boolean} spare                Does a blow that would be fatal leave the enemy with 1 HP?
 * @property {string} left                  The parts of the text that are left to the table
 */

/**
 * Read an Art's Effect.
 * @param {string} [text]
 * @returns {ArtReading}
 */
export function readArt(text) {
  const read = {
    might: 0, hit: 0, critical: 0, dodge: 0, critAvoid: 0, strikes: 1, effective: [], range: null,
    noFollowUp: false, foeNoCounter: false, persist: false, spare: false, left: ""
  };
  const left = [];

  // A sentence is read piece by piece, where its commas divide it. A list of numbers has commas of its own:
  // "+10 Hit, Dodge and Critical" is one piece
  for ( const sentence of String(text ?? "").split(/[.;]\s+|[.;]$|\n/) ) {
    const pieces = [];
    for ( const piece of sentence.split(/,\s*/) ) {
      const bare = piece.trim().replace(/^and\s+/i, "");
      const joins = pieces.length && new RegExp(`^(?:${NAMES})(?:\\s+and\\s+(?:${NAMES}))*$`, "i").test(bare)
        && LIST.test(pieces.at(-1));
      if ( joins ) pieces[pieces.length - 1] += `, ${piece.trim()}`;
      else if ( piece.trim() ) pieces.push(piece.trim());
    }
    for ( const piece of pieces ) {
      const list = piece.match(LIST);
      if ( list ) {
        const amount = Number(list[1].replace(/\s/g, "").replace("−", "-"));
        for ( const [name, key] of NUMBERS ) {
          if ( new RegExp(`(^|[^a-z])${name}(?! avoid)([^a-z]|$)`, "i").test(list[2]) ) read[key] += amount;
        }
        continue;
      }
      let match;
      if ( (match = piece.match(PHRASES.strikes)) ) read.strikes = Math.max(read.strikes, Number(match[1]));
      else if ( (match = piece.match(PHRASES.effective)) && !/^(all|every)\b/i.test(match[1]) ) {
        for ( const quality of match[1].split(/\s*(?:,|\band\b|\bor\b|\/)\s*/).filter(Boolean) ) read.effective.push(quality.trim());
      }
      else if ( (match = piece.match(PHRASES.rangeAdd)) ) read.range = { ...(read.range ?? {}), add: Number(match[1]) };
      else if ( (match = piece.match(PHRASES.range)) ) {
        read.range = { ...(read.range ?? {}), min: Number(match[1]), max: Number(match[2] ?? match[1]) };
      }
      else if ( PHRASES.ownRange.test(piece) ) continue;
      else if ( PHRASES.noFollowUp.test(piece) ) read.noFollowUp = true;
      else if ( PHRASES.foeNoCounter.test(piece) ) read.foeNoCounter = true;
      else if ( PHRASES.persist.test(piece) ) read.persist = true;
      else if ( PHRASES.spare.test(piece) ) read.spare = true;
      else left.push(piece);
    }
  }
  read.left = left.join(", ");
  return read;
}

/* -------------------------------------------- */

/**
 * What the system applies of an Art: what it reads from the Effect, and the effects the Art carries. An Art
 * that carries effects says itself what is left for the table; one the table would rather run by hand leaves
 * all of its Effect.
 * @param {{effect?: string, automate?: boolean, effects?: object[], left?: string}} art
 * @returns {ArtReading & {effects: object[]}}
 */
export function readArtItem(art) {
  if ( art.automate === false ) return { ...readArt(""), left: art.effect ?? "", effects: [] };
  const read = readArt(art.effect);
  const effects = Array.isArray(art.effects) ? art.effects : [];
  if ( effects.length ) read.left = art.left ?? "";
  return { ...read, effects };
}

/* -------------------------------------------- */

/**
 * From how far an Art is performed: where its text names a Range, from there; a melee Art from next to the
 * foe; a Bow or Rifle Art from 2 tiles or more; any other from wherever the weapon reaches.
 * @param {{type: string}} art
 * @param {ArtReading & {effects?: object[]}} read
 * @returns {{min: number, max: number}|null}     Null for an Art that sets no limit of its own
 */
export function artReach(art, read) {
  const config = FEO.optional.combatArts;
  if ( read.range?.max ) return { min: read.range.min, max: read.range.max + (read.range.add ?? 0) };

  // An effect the Art carries may have the weapon reach further, or nearer, and the Art is performed from there too
  const ranges = (read.effects ?? []).map((effect) => effect.weaponRange).filter(Boolean);
  const nearest = (limit) => Math.min(limit, ...ranges.map((range) => range.min ?? Infinity));
  const farthest = (limit) => Math.max(limit, ...ranges.map((range) => range.max ?? 0));
  if ( config.melee.includes(art.type) ) return { min: nearest(1), max: farthest(1 + (read.range?.add ?? 0)) };
  if ( config.ranged.includes(art.type) ) return { min: nearest(2), max: Infinity };
  return null;
}

/* -------------------------------------------- */

/**
 * Read an Art's Cost: "3 HP", "5 WU", "3 HP, 5 WU". Anything else, such as "N/A", costs nothing.
 * @param {string} [text]
 * @returns {{hp: number, uses: number}}
 */
export function readCost(text) {
  const cost = { hp: 0, uses: 0 };
  for ( const match of String(text ?? "").matchAll(/(\d+)\s*(HP|WU|weapon uses?|uses?)\b/gi) ) {
    cost[/^hp$/i.test(match[2]) ? "hp" : "uses"] += Number(match[1]);
  }
  return cost;
}

/* -------------------------------------------- */

/**
 * What an Art costs a unit: each cost it has, changed by what the unit's skills and Powers say, and never
 * less than nothing. A cost the Art does not have stays none.
 * @param {{hp: number, uses: number}} cost
 * @param {number} [change]     What is added to each cost, as `artCost` among skill effects
 * @returns {{hp: number, uses: number}}
 */
export function costFor(cost, change = 0) {
  const paid = (amount) => (amount > 0) ? Math.max(amount + change, 0) : 0;
  return { hp: paid(cost?.hp ?? 0), uses: paid(cost?.uses ?? 0) };
}

/* -------------------------------------------- */

/**
 * Can a weapon of a category perform an Art? Universal Arts go with any weapon but a staff. Any other Art goes
 * with the weapons of its own type, with those that count as that type (by the proficiency they are wielded
 * with, or as the configuration lists them), and with those the Art itself names besides.
 * @param {{type: string, also?: string}} art
 * @param {string} [category]     The weapon's category, a key of `FEO.weaponCategories`
 * @returns {boolean}
 */
export function weaponPerforms(art, category) {
  const config = FEO.optional.combatArts;
  if ( !category || config.barred.includes(category) ) return false;
  if ( art.type === config.universal ) return true;
  const counts = [category, FEO.weaponCategories[category]?.proficiency, ...(config.uses[category] ?? [])].filter(Boolean);
  if ( counts.includes(art.type) ) return true;
  return counts.some((type) => new RegExp(`(^|[^a-z])${type}s?([^a-z]|$)`, "i").test(art.also ?? ""));
}

/* -------------------------------------------- */

/**
 * Can a unit perform an Art now, with the weapon in its hand?
 * @param {{type: string, also?: string, cost?: string}} art
 * @param {object} unit
 * @param {number} unit.hp
 * @param {{category: string, uses?: {value: number, max: number}}|null} unit.weapon
 * @param {Record<string, number>} [unit.conditions]    The conditions it suffers from
 * @param {number} [unit.artCost]                       What its skills add to the costs of its Arts
 * @returns {{ok: boolean, why: "off"|"unarmed"|"type"|"hp"|"natural"|"condition"|null,
 *   cost: {hp: number, uses: number}}}     `natural` for an Art that costs Weapon Uses, with a weapon that is
 *                                          part of its unit's body
 */
export function canPerform(art, unit) {
  const config = FEO.optional.combatArts;
  const cost = costFor(readCost(art.cost), unit.artCost ?? 0);
  const no = (why) => ({ ok: false, why, cost });
  if ( !config.enabled ) return no("off");
  if ( config.blockedBy.some((id) => id in (unit.conditions ?? {})) ) return no("condition");
  if ( !unit.weapon ) return no("unarmed");
  if ( !weaponPerforms(art, unit.weapon.category) ) return no("type");
  if ( (cost.hp > 0) && (cost.hp >= unit.hp) ) return no("hp");
  if ( (cost.uses > 0) && config.natural.includes(unit.weapon.category) ) return no("natural");
  return { ok: true, why: null, cost };
}

/* -------------------------------------------- */

/**
 * How many Combat Arts a unit may have learned: one for every Weapon Rank it has reached, in every weapon type
 * whose Ranks teach Arts.
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @returns {number}
 */
export function artsAllowed(proficiencies = {}) {
  const config = FEO.optional.combatArts;
  const order = Object.keys(FEO.ranks);
  return Object.entries(proficiencies).reduce((sum, [key, proficiency]) => {
    return sum + (config.noLearning.includes(key) ? 0 : Math.max(order.indexOf(proficiency?.rank), 0));
  }, 0);
}

/* -------------------------------------------- */

/**
 * Can a unit learn an Art, by the Weapon Ranks it has reached? A Universal Art is learned with any weapon type
 * whose Ranks teach Arts, at the Art's Rank or a higher one. Any other Art is learned with a weapon type that
 * teaches its type, at the Art's Rank or a higher one and no sooner than the Rank from which weapon-specific
 * Arts are taught. An Art without a Rank is one every unit has.
 * @param {{type: string, rank?: string}} art
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @returns {boolean}
 */
export function canLearn(art, proficiencies = {}) {
  const config = FEO.optional.combatArts;
  if ( !art.rank ) return true;
  const order = Object.keys(FEO.ranks);
  const universal = art.type === config.universal;
  const needed = Math.max(order.indexOf(art.rank), universal ? 1 : order.indexOf(config.typedFrom));
  return Object.entries(proficiencies).some(([key, proficiency]) => {
    if ( config.noLearning.includes(key) || (order.indexOf(proficiency?.rank) < needed) ) return false;
    return universal || (key === art.type) || (config.teaches[key] ?? []).includes(art.type);
  });
}

/* -------------------------------------------- */

/**
 * The Arts of a list that a unit could learn now and has not learned yet, in the order of the list.
 * @param {{name: string, type: string, rank?: string}[]} arts
 * @param {object} unit
 * @param {Record<string, {rank: string}>} [unit.proficiencies]
 * @param {string[]} [unit.known]         The names of the Arts it has
 * @param {boolean} [unit.ranked]         Does it have Weapon Ranks to learn by? Without them, as with Weapon
 *                                        Levels, any Art can be learned
 * @returns {object[]}
 */
export function learnableArts(arts, { proficiencies = {}, known = [], ranked = true } = {}) {
  const has = new Set(known.map((name) => name.toLowerCase()));
  return arts.filter((art) => !has.has(art.name.toLowerCase()) && (!ranked || canLearn(art, proficiencies)));
}

/* -------------------------------------------- */

/**
 * @typedef FightArt
 * A Combat Art as the unit that attacks with it carries it into a fight (see `planExchange`).
 * @property {string} [id]
 * @property {string} name
 * @property {{hp: number, uses: number}} cost    What it costs its unit: the HP is paid as the fight begins,
 *                                                the Weapon Uses once it is over
 * @property {number} might
 * @property {number} hit
 * @property {number} critical
 * @property {number} dodge
 * @property {number} critAvoid
 * @property {number} strikes
 * @property {string[]} effective
 * @property {boolean} noFollowUp
 * @property {boolean} persist
 * @property {boolean} spare                      Does a blow that would be fatal leave the foe with 1 HP?
 * @property {{min: number, max: number}|null} reach      From how far it is performed, where it sets a limit
 * @property {string} left                        What its text says besides, for the table to apply
 */

/**
 * Ready a unit to attack with a Combat Art: it pays the Art's HP now, carries the Art into the fight, and gains
 * what the Art changes about the whole fight as one more skill of its own. A unit that cannot perform the Art
 * is left as it is, with the reason why.
 * @param {import("./combat.mjs").Combatant} unit
 * @param {{id?: string, name: string, type: string, also?: string, effect?: string, cost?: string,
 *   automate?: boolean, effects?: object[], left?: string}} art
 * @param {object} [options]
 * @param {number} [options.artCost]    What the unit's skills add to the costs of its Arts
 * @returns {import("./combat.mjs").Combatant}
 */
export function readyArt(unit, art, { artCost = 0 } = {}) {
  const able = canPerform(art, { hp: unit.hp, weapon: unit.weapon, conditions: unit.conditions, artCost });
  if ( !able.ok ) return { ...unit, artBlocked: { name: art.name, why: able.why } };

  // An Art the table would rather run by hand is paid for and named, and nothing of it is applied
  const read = readArtItem(art);
  const single = FEO.optional.combatArts.mode === "single";
  const carried = {
    id: art.id,
    name: art.name,
    cost: able.cost,
    might: read.might,
    hit: read.hit,
    critical: read.critical,
    dodge: read.dodge,
    critAvoid: read.critAvoid,
    strikes: read.strikes,
    effective: read.effective,
    noFollowUp: single || read.noFollowUp,
    persist: read.persist,
    spare: read.spare,
    reach: (art.automate === false) ? null : artReach(art, read),
    left: read.left
  };

  // How far the weapon attacks and whether the enemy can answer are settled for the whole fight, as the
  // rules of a skill are
  const whole = {};
  if ( read.range ) whole.weaponRange = read.range;
  if ( read.foeNoCounter ) whole.rules = ["foeNoCounter"];
  const effects = Object.keys(whole).length ? [{ when: { role: "initiating" }, ...whole }] : [];

  // The effects the Art carries are its unit's while it initiates this fight
  for ( const effect of read.effects ) effects.push({ ...effect, when: { ...(effect.when ?? {}), role: "initiating" } });
  const entry = effects.length ? [{ name: art.name, art: true, effects }] : [];
  return {
    ...unit,
    hp: unit.hp - able.cost.hp,
    art: carried,
    skills: Array.isArray(unit.skills) ? [...unit.skills, ...entry] : unit.skills
  };
}

/* -------------------------------------------- */

/**
 * What a fight with a Combat Art leaves its unit to pay once it is over: the Art's Weapon Uses, on top of what
 * the attacks themselves cost, with the weapon breaking then if that is its last. A weapon that never wears
 * out has none to pay. Without a fight no Art was performed, and nothing is paid.
 * @param {FightArt|null} art
 * @param {object} fight
 * @param {boolean} fight.fought                Was any attack made?
 * @param {number|null} fight.uses              The weapon's uses after the fight
 * @param {number} [fight.usesMax]              Its uses when new, 0 for a weapon that never wears out
 * @returns {{performed: boolean, hp: number, uses: number, usesLeft: number|null, broke: boolean}}
 */
export function settleArt(art, { fought, uses, usesMax = 0 }) {
  if ( !art || !fought ) return { performed: false, hp: 0, uses: 0, usesLeft: uses, broke: false };
  const wears = (usesMax > 0) && Number.isFinite(uses);
  const paid = wears ? Math.min(art.cost.uses, Math.max(uses, 0)) : 0;
  const left = wears ? Math.max(uses - paid, 0) : uses;
  return { performed: true, hp: art.cost.hp, uses: paid, usesLeft: left, broke: wears && (paid > 0) && (left === 0) };
}

/**
 * Shield Block for Fire Emblem Online: what a Shield is, which attacks it blocks and by how much, and the Block
 * chance of a unit against an attack.
 *
 * Ported from the "Shields" section of the Items tab of the Reference Sheet. A Shield is an item a unit equips,
 * one at a time. When a hit lands on its bearer and the Shield can block that kind of attack, its Block chance
 * is rolled: the chance the Shield names, plus half the bearer's DEX. A block takes the Shield's amount off the
 * damage of that hit and costs the Shield a use; a Shield out of uses is a Broken Shield, and is put away. A
 * Shield also adds to its bearer's Weight as Attack Speed is worked out. Some weapons act as a Shield, and the
 * skill Weapon Guard has its unit block with the weapon in hand. Pure functions of plain data, so that they can
 * be tested outside of Foundry.
 *
 * A unit's skills speak to all of this with a `block` part on an effect, which is always there, may wait for
 * its skill to be switched on, and may be given to the units around as an aura:
 *
 *   block: { chance: 10 }                             // added to the unit's own Block chance; a number may be
 *                                                     // read from the unit, or count the units around it
 *   block: { chance: 4, kind: "shield" }              // `kind`: only where it blocks with a "shield", or only
 *                                                     // with the "weapon" in hand; both unless given
 *   block: { fullDex: true }                          // its Shield adds its whole DEX, not half
 *   block: { amount: 1 }                              // added to what its blocks take off a hit
 *   block: { magic: "half" }                          // its Shield blocks magical attacks too, by half of what
 *                                                     // it takes off a physical one; `true` for all of it
 *   block: { guard: { chance: 30, stance: 20 } }      // it blocks with the weapon in hand: physical attacks
 *                                                     // with a weapon, magical ones with a tome, at this chance
 *                                                     // plus DEX/2 (`dexDiv`), by half the weapon's Might, for a
 *                                                     // use of the weapon. `stance`: what using it as an Action
 *                                                     // adds to that chance until its unit's next turn starts,
 *                                                     // during which the unit does not counter-attack
 *   block: { foeChance: -10, kind: "shield" }         // added to the Block chance of the foe it attacks
 *   block: { negates: "shield" }                      // the foe's Shield blocks none of its attacks in this
 *                                                     // fight; "all" for a guarding weapon as well
 *   block: { first: "negate" }                        // the first use of its Shield, one that has lost none
 *                                                     // yet, takes all the damage off the hit it blocks;
 *   block: { last: "negate" }                         // and so does the block that costs it its last
 *
 * and beside it, on an effect that adds to DEF or RES, `lostOnBlock: true` has a hit that is blocked dealt as
 * if the unit went without that much.
 */
import { FEO } from "../config.mjs";

/**
 * @typedef BlockRule
 * What a Shield takes off one kind of attack. Every part that is given must hold for the rule to speak of an
 * attack; of the rules that do, the one that leaves the least damage is used.
 * @property {"physical"|"magical"|"any"} kind
 * @property {"melee"|"ranged"} [range]       Only attacks from next to the unit, or only from further away
 * @property {string} [element]               Only attacks of this element, a key of FEO.attackElements
 * @property {string} [notElement]            No attack of this element
 * @property {string} [from]                  Only attacks of a unit that is one of these, as its Special
 *                                            Qualities, race or class name it: "Terror", "Manakete"
 * @property {string} [weapon]                Only attacks with a weapon whose name says this: "eye"
 * @property {boolean} [effective]            Only attacks that are effective against the unit
 * @property {number} [reduce]                Taken off the damage
 * @property {number} [percent]               The share of the damage that is taken off
 * @property {number} [to]                    What the damage is brought down to
 * @property {boolean} [negate]               All of the damage is taken off
 */

/**
 * @typedef Shield
 * @property {string} [id]
 * @property {string} name
 * @property {number} chance                  Its Block chance before DEX
 * @property {number} dexDiv                  What the bearer's DEX is divided by before it is added; 0 for a
 *                                            Shield that DEX adds nothing to
 * @property {BlockRule[]} blocks             What it blocks, and by how much
 * @property {number} weight                  Added to the bearer's Weight as Attack Speed is worked out
 * @property {number} wearPhysical            Uses a block of a physical attack costs it; a block costs 1 otherwise
 * @property {{chance: number, dexDiv: number, uses: number}|null} parry
 *                                            A chance to parry a melee attack instead: all of the damage is
 *                                            taken off, for this many uses
 * @property {{value: number, max: number}} uses    A maximum of 0 means it never wears out
 */

/**
 * @typedef Guard
 * What a unit blocks an attack with, and how likely.
 * @property {"shield"|"weapon"} kind         A Shield (or a weapon that acts as one), or the weapon in hand
 * @property {"shield"|"weapon"} wears        Which of the unit's two items a block costs uses
 * @property {string} name
 * @property {number} chance                  0 to 100
 * @property {{label: string, key?: boolean, value: number}[]} parts
 *                                            The sum behind the chance; `key` marks a label to be localized
 * @property {BlockRule} rule                 What a block takes off this attack
 * @property {number} cost                    Uses a block costs
 * @property {{chance: number, uses: number}|null} parry
 * @property {{value: number, max: number}} uses
 * @property {{skill: string, uses?: object|null}[]} first      The skills that have its first use take all
 * @property {{skill: string, uses?: object|null}[]} last       And those that have its last use take all
 * @property {number} lost                    DEF or RES the unit goes without on a hit that is blocked
 */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** The kinds of block a `block` part can speak of. */
export const BLOCK_KINDS = ["shield", "weapon"];

/**
 * The rule a unit carries that has no Shield equipped and can equip none: only ever in a change that lasts a
 * while, as a skill leaves it on its target.
 */
export const NO_SHIELD = "noShield";

/**
 * Is a unit kept from having a Shield equipped by a change that lasts on it?
 * @param {{effects?: object[], stacks?: number}[]} [changes]     The lasting changes it carries
 * @returns {boolean}
 */
export function shieldsBarred(changes) {
  return (changes ?? []).some((change) => ((change.stacks ?? 1) > 0) && (change.effects ?? []).some((effect) => effect?.rules?.includes(NO_SHIELD)));
}

/**
 * What a Shield takes off a physical attack from next to its bearer, as a plain number: its "physical block
 * amount". A Shield that takes a share, or everything, has none to name.
 * @param {Pick<Shield, "blocks">|null} shield
 * @param {BlockTotals|null} [block]      What the bearer's skills make of blocking: what they add counts
 * @returns {number}
 */
export function shieldAmount(shield, block = null) {
  if ( !shield ) return 0;
  const more = (block?.amount ?? []).filter((entry) => !entry.kind || (entry.kind === "shield")).reduce((sum, entry) => sum + entry.amount, 0);
  const rule = blockRule(shield.blocks, { physical: true, distance: 1, element: null, effective: false }, { amount: more });
  return Math.max(rule?.reduce ?? 0, 0);
}

/** What the first or the last use of a Shield can do. */
const USE_EFFECTS = ["negate"];

/* -------------------------------------------- */
/*  Reading a Shield                            */
/* -------------------------------------------- */

/**
 * The element an Effect names, as a key of FEO.attackElements.
 * @param {string} word
 * @returns {string|null}
 */
function elementOf(word) {
  const key = String(word ?? "").trim().toLowerCase();
  return (FEO.attackElements ?? []).includes(key) ? key : null;
}

/**
 * Read a Shield from its Effect, as the Items tab of the Reference Sheet words it:
 * "Has a 40 + DEX/2% chance to block physical attacks, reducing them by 4. Adds 1 Weight during Attack Speed
 * calculation. 30 Uses."
 * @param {string} [effect]
 * @returns {Omit<Shield, "name"|"uses">|null}     Null for an item that is no Shield
 */
export function readShield(effect) {
  const text = String(effect ?? "").replace(/\s+/g, " ");
  const head = /(\d+)\s*(?:\+\s*DEX\s*\/\s*(\d+))?\s*%?\s*chance to block ([^.,]*)/i.exec(text);
  if ( !head ) return null;
  const scope = head[3].toLowerCase();
  const blocks = [];

  // What the chance is said to be for: physical attacks, every attack, or physical ones and some magical ones
  const spared = /physical and non-([a-z]+) magical/i.exec(scope);
  const kinds = spared ? ["physical", "magical"] : /physical/.test(scope) ? ["physical"] : ["any"];
  const scoped = (amount) => kinds.map((kind) => {
    const rule = { kind, ...amount };
    if ( spared && (kind === "magical") && elementOf(spared[1]) ) rule.notElement = elementOf(spared[1]);
    return rule;
  });

  // One amount for everything the Shield blocks
  const all = /reducing them (?:by (\d+)(%?)|to (\d+) damage)/i.exec(text);
  if ( all?.[3] ) blocks.push(...scoped({ to: Number(all[3]) }));
  else if ( all?.[2] ) blocks.push(...scoped({ percent: Number(all[1]) }));
  else if ( all ) blocks.push(...scoped({ reduce: Number(all[1]) }));

  // An amount for each kind of attack: "Reduces physical attacks by 1, reduces magical attacks by 4",
  // "Reduces melee attacks by 5, reduces ranged attacks by 10", "reduces Fire attacks by 10", "reduces
  // physical attacks from Terrors by 8"
  const subject = (words) => {
    const rules = [];
    for ( const word of words.toLowerCase().split(/\s+and\s+/) ) {
      if ( word === "physical" ) rules.push({ kind: "physical" });
      else if ( (word === "magical") || (word === "magic") ) rules.push({ kind: "magical" });
      else if ( (word === "melee") || (word === "ranged") ) rules.push({ kind: kinds.includes("any") ? "any" : "physical", range: word });
      else if ( elementOf(word) ) rules.push({ kind: "any", element: elementOf(word) });
    }
    return rules;
  };
  const each = /\b(physical and magical|[a-z]+) attacks(?: from ([a-z]+?)s?)? by (\d+)/gi;
  for ( const match of text.matchAll(each) ) {
    for ( const rule of subject(match[1]) ) blocks.push({ ...rule, ...(match[2] ? { from: match[2] } : {}), reduce: Number(match[3]) });
  }

  // Attacks it takes everything off: "negates ranged attacks", "negates Fire attacks", "negates and reflects
  // magical attacks", "negates attacks from Manaketes", "nullifies Dark magic and Eye attacks"
  for ( const match of text.matchAll(/\bnegates (?:and reflects )?([a-z]+) attacks/gi) ) {
    for ( const rule of subject(match[1]) ) blocks.push({ ...rule, negate: true });
  }
  const kin = /\bnegates attacks from ([a-z]+?)s?\b/i.exec(text);
  if ( kin ) blocks.push({ kind: "any", from: kin[1], negate: true });
  const nulled = /\bnullifies ([a-z]+) magic(?: and ([a-z]+) attacks)?/i.exec(text);
  if ( nulled ) {
    if ( elementOf(nulled[1]) ) blocks.push({ kind: "any", element: elementOf(nulled[1]), negate: true });
    if ( nulled[2] ) blocks.push({ kind: "any", weapon: nulled[2].toLowerCase(), negate: true });
  }

  // Effective attacks, which some Shields take more off: "Effective attacks that are blocked are instead
  // reduced by 10, including magical attacks"
  const effective = /effective attacks that are blocked are instead reduced by (\d+)(, including magical attacks)?/i.exec(text);
  if ( effective ) blocks.push({ kind: effective[2] ? "any" : "physical", effective: true, reduce: Number(effective[1]) });
  if ( !blocks.length ) return null;

  const wear = /loses (\d+) uses when blocking physical attacks/i.exec(text);
  const weight = /adds (\d+) weight during attack speed/i.exec(text);
  const parry = /(\d+)\s*\+\s*DEX\s*\/\s*(\d+)\s*% chance to instead parry a melee attack[^.]*?consuming (\d+) uses/i.exec(text);
  return {
    chance: Number(head[1]),
    dexDiv: head[2] ? Number(head[2]) : 0,
    blocks,
    weight: weight ? Number(weight[1]) : 0,
    wearPhysical: wear ? Number(wear[1]) : 1,
    parry: parry ? { chance: Number(parry[1]), dexDiv: Number(parry[2]), uses: Number(parry[3]) } : null
  };
}

/* -------------------------------------------- */

/**
 * What a weapon's Effect says of blocking: a weapon that acts as a Shield ("Acts as a Shield against physical
 * attacks, with 40+DEX/2 Block rate and 3 DEF"), what it adds to its wielder's Block chance ("+10 Block rate"),
 * and whether its attacks go past Shields ("Ignores DEF and Shields", "Negates DEF and Shields").
 * @param {string} [effect]
 * @returns {{shield: Omit<Shield, "name"|"uses">|null, chance: number, negates: boolean}}
 */
export function weaponBlocking(effect) {
  const text = String(effect ?? "").replace(/\s+/g, " ");
  const acts = /acts as a shield against physical attacks, with (\d+)\s*\+\s*DEX\s*\/\s*(\d+) block rate and (\d+) DEF/i.exec(text);
  const bonus = acts ? null : /\+\s*(\d+)\s*block (?:rate|chance)/i.exec(text);
  return {
    shield: acts ? {
      chance: Number(acts[1]),
      dexDiv: Number(acts[2]),
      blocks: [{ kind: "physical", reduce: Number(acts[3]) }],
      weight: 0,
      wearPhysical: 1,
      parry: null
    } : null,
    chance: bonus ? Number(bonus[1]) : 0,
    negates: /\b(?:ignores|negates) DEF and shields\b/i.test(text)
  };
}

/* -------------------------------------------- */
/*  What a Block Takes Off                      */
/* -------------------------------------------- */

/**
 * @typedef BlockedAttack
 * The attack a block is asked of.
 * @property {boolean} physical           Is it resisted with DEF?
 * @property {number} [distance]          Tiles between the two
 * @property {string|null} [element]      Its element, if it has one
 * @property {boolean} [effective]        Is it effective against the unit?
 * @property {string} [weaponName]        The name of the weapon it is made with
 * @property {string} [kin]               What the attacker is: its Special Qualities, race and class, as text
 */

/**
 * Does a rule speak of an attack?
 * @param {BlockRule} rule
 * @param {BlockedAttack} attack
 * @returns {boolean}
 */
function ruleHolds(rule, attack) {
  if ( (rule.kind === "physical") && !attack.physical ) return false;
  if ( (rule.kind === "magical") && attack.physical ) return false;
  const near = (attack.distance ?? 1) <= 1;
  if ( rule.range && ((rule.range === "melee") !== near) ) return false;
  if ( rule.element && (attack.element !== rule.element) ) return false;
  if ( rule.notElement && (attack.element === rule.notElement) ) return false;
  if ( rule.effective && !attack.effective ) return false;
  if ( rule.weapon && !new RegExp(`\\b${rule.weapon}\\b`, "i").test(attack.weaponName ?? "") ) return false;
  if ( rule.from && !new RegExp(`\\b${rule.from}`, "i").test(attack.kin ?? "") ) return false;
  return true;
}

/**
 * The damage of a hit once a block has taken its amount off.
 * @param {number} damage
 * @param {BlockRule} rule
 * @param {object} [options]
 * @param {number} [options.times]    What the amount is multiplied by, as a skill may double it
 * @param {number} [options.less]     What is taken off the amount first, as a skill of the attacker may
 * @returns {number}
 */
export function lessen(damage, rule, { times = 1, less = 0 } = {}) {
  const hit = Math.max(damage, 0);
  if ( !rule ) return hit;
  if ( rule.negate ) return 0;
  if ( rule.to !== undefined ) return Math.min(hit, Math.max(rule.to, 0));
  if ( rule.percent !== undefined ) return Math.max(hit - Math.floor(((hit * Math.min(rule.percent * times, 100)) / 100) + 1e-9), 0);
  return Math.max(hit - Math.max(Math.floor(((rule.reduce ?? 0) * times) + 1e-9) - less, 0), 0);
}

/**
 * What a Shield takes off an attack: of its rules that speak of the attack, the one that takes the most.
 * @param {BlockRule[]} blocks
 * @param {BlockedAttack} attack
 * @param {object} [options]
 * @param {number} [options.amount]           Added to what a rule takes off as a plain amount
 * @param {boolean|"half"} [options.magic]    Does a skill have it block magical attacks as well, by what it
 *                                            takes off a physical one, or by half of that?
 * @returns {BlockRule|null}                  Null when it cannot block the attack
 */
export function blockRule(blocks, attack, { amount = 0, magic = false } = {}) {
  const plus = (rule) => ((rule.reduce !== undefined) && amount) ? { ...rule, reduce: Math.max(rule.reduce + amount, 0) } : rule;
  let found = (blocks ?? []).filter((rule) => ruleHolds(rule, attack)).map(plus);

  // A Shield that a skill lets block magical attacks takes off them what it takes off a physical attack from
  // the same place, or half of it
  if ( !found.length && magic && !attack.physical ) {
    found = (blocks ?? []).filter((rule) => (rule.kind === "physical") && ruleHolds(rule, { ...attack, physical: true })).map(plus).map((rule) => {
      if ( magic !== "half" ) return rule;
      if ( rule.reduce !== undefined ) return { ...rule, reduce: Math.floor(rule.reduce / 2) };
      return (rule.percent !== undefined) ? { ...rule, percent: Math.floor(rule.percent / 2) } : rule;
    });
  }
  if ( !found.length ) return null;

  // Judged by a hit large enough to tell them apart
  return found.reduce((best, rule) => (lessen(1000, rule) < lessen(1000, best) ? rule : best));
}

/**
 * Can a Shield block magical attacks at all?
 * @param {Pick<Shield, "blocks">|null} shield
 * @returns {boolean}
 */
export function blocksMagic(shield) {
  return (shield?.blocks ?? []).some((rule) => rule.kind !== "physical");
}

/**
 * Has a Shield, or a weapon, a use left to block with? One that never wears out always has.
 * @param {{value: number, max: number}|null} [uses]
 * @returns {boolean}
 */
export function hasUses(uses) {
  return !(uses?.max > 0) || (uses.value > 0);
}

/* -------------------------------------------- */
/*  What Skills Make of It                      */
/* -------------------------------------------- */

/**
 * @typedef BlockTotals
 * What a unit's skills make of blocking.
 * @property {{name: string, amount: number, kind: string|null}[]} chance       Added to its own Block chance
 * @property {{name: string, amount: number, kind: string|null}[]} foeChance    Added to its foe's
 * @property {boolean} fullDex
 * @property {{name: string, amount: number, kind: string|null}[]} amount       Added to what its blocks take off
 * @property {boolean|"half"} magic
 * @property {{name: string, chance: number, dexDiv: number, stance: number}|null} guard
 * @property {"shield"|"all"|null} negates
 * @property {{skill: string, kind: string|null, uses: object|null}[]} first
 * @property {{skill: string, kind: string|null, uses: object|null}[]} last
 * @property {{def: number, res: number}} lost
 */

/**
 * Nothing changed about blocking.
 * @returns {BlockTotals}
 */
export function emptyBlock() {
  return {
    chance: [], foeChance: [], fullDex: false, amount: [], magic: false, guard: null, negates: null,
    first: [], last: [], lost: { def: 0, res: 0 }
  };
}

/**
 * Add one `block` part to what a unit's skills make of blocking.
 * @param {BlockTotals} into
 * @param {object} part                       The `block` part of an effect
 * @param {object} about
 * @param {string} about.name                 The skill it comes from
 * @param {(value: *) => number} about.number   Works out a number that may be read from the unit
 * @param {object|null} [about.uses]          For a skill that counts its uses: how often it still can
 * @returns {BlockTotals}
 */
export function addBlock(into, part, { name, number, uses = null }) {
  const kind = BLOCK_KINDS.includes(part.kind) ? part.kind : null;
  const note = (list, amount) => {
    if ( amount ) list.push({ name, amount, kind });
  };
  if ( part.chance !== undefined ) note(into.chance, number(part.chance));
  if ( part.foeChance !== undefined ) note(into.foeChance, number(part.foeChance));
  if ( part.fullDex ) into.fullDex = true;
  if ( part.amount !== undefined ) note(into.amount, number(part.amount));
  if ( part.magic ) into.magic = ((into.magic === true) || (part.magic === true)) ? true : "half";
  if ( part.guard ) {
    const guard = { name, chance: number(part.guard.chance ?? 0), dexDiv: part.guard.dexDiv ?? 2, stance: number(part.guard.stance ?? 0) };
    if ( !into.guard || (guard.chance > into.guard.chance) ) into.guard = { ...guard, stance: Math.max(guard.stance, into.guard?.stance ?? 0) };
    else into.guard.stance = Math.max(into.guard.stance, guard.stance);
  }
  if ( part.negates ) into.negates = ((into.negates === "all") || (part.negates === "all")) ? "all" : "shield";
  if ( part.first ) into.first.push({ skill: name, kind, uses });
  if ( part.last ) into.last.push({ skill: name, kind, uses });
  return into;
}

/**
 * Check a `block` part as an effect writes it.
 * @param {*} part
 * @returns {string[]}      What is wrong with it, if anything
 */
export function checkBlock(part) {
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ["block must say what it changes"];
  const problems = [];
  const number = (value) => Number.isFinite(value) || (value && (typeof value === "object") && ((value.of !== undefined) || value.count));
  for ( const key of Object.keys(part) ) {
    if ( !["chance", "foeChance", "kind", "fullDex", "amount", "magic", "guard", "negates", "first", "last"].includes(key) ) problems.push(`block cannot say "${key}"`);
  }
  for ( const key of ["chance", "foeChance", "amount"] ) {
    if ( (part[key] !== undefined) && !number(part[key]) ) problems.push(`block: "${key}" is a number`);
  }
  if ( (part.kind !== undefined) && !BLOCK_KINDS.includes(part.kind) ) problems.push(`block: "kind" is ${BLOCK_KINDS.map((kind) => `"${kind}"`).join(" or ")}`);
  if ( (part.fullDex !== undefined) && (part.fullDex !== true) ) problems.push('block: "fullDex" is true or left out');
  if ( ![undefined, true, "half"].includes(part.magic) ) problems.push('block: "magic" is true or "half"');
  if ( ![undefined, "shield", "all"].includes(part.negates) ) problems.push('block: "negates" is "shield" or "all"');
  for ( const key of ["first", "last"] ) {
    if ( (part[key] !== undefined) && !USE_EFFECTS.includes(part[key]) ) problems.push(`block: the "${key}" use can "negate"`);
  }
  if ( part.guard !== undefined ) {
    const guard = part.guard;
    if ( !guard || (typeof guard !== "object") ) problems.push("block: a guard says its chance");
    else {
      for ( const key of Object.keys(guard) ) if ( !["chance", "dexDiv", "stance"].includes(key) ) problems.push(`block: a guard cannot say "${key}"`);
      if ( !number(guard.chance) ) problems.push("block: a guard needs its chance");
      if ( (guard.dexDiv !== undefined) && !(Number.isInteger(guard.dexDiv) && (guard.dexDiv >= 0)) ) problems.push('block: "dexDiv" is a whole number');
      if ( (guard.stance !== undefined) && !number(guard.stance) ) problems.push('block: "stance" is a number');
    }
  }
  return problems;
}

/**
 * The guard a skill lets its unit take up as an Action, as Weapon Guard does: the chance it blocks at with the
 * weapon in hand, and what the stance adds to it.
 * @param {{effects?: object[], automate?: boolean}} skill     A skill's data
 * @returns {{chance: number, dexDiv?: number, stance: number}|null}     Null for a skill that offers none
 */
export function guardStanceOf(skill) {
  if ( skill?.automate === false ) return null;
  for ( const effect of skill?.effects ?? [] ) {
    const guard = effect?.block?.guard;
    if ( !guard || !(Number.isFinite(guard.stance) && (guard.stance > 0)) || !Number.isFinite(guard.chance) ) continue;
    return { chance: guard.chance, ...(Number.isInteger(guard.dexDiv) ? { dexDiv: guard.dexDiv } : {}), stance: guard.stance };
  }
  return null;
}

/* -------------------------------------------- */
/*  The Block Chance                            */
/* -------------------------------------------- */


/**
 * What a unit blocks an attack with, and how likely: its Shield where that can block the attack, else a weapon
 * in hand that acts as one, else the weapon it guards with.
 * @param {object} unit                       The unit that is attacked
 * @param {Shield|null} [unit.shield]         The Shield it has equipped
 * @param {object|null} [unit.weapon]         The weapon in hand: name, category, might, effect, uses
 * @param {Record<string, number>} [unit.stats]
 * @param {BlockTotals|null} [unit.block]     What its skills make of blocking
 * @param {BlockedAttack|null} attack         The attack; null asks what it would block a physical attack from
 *                                            next to it with
 * @param {object} [foe]                      The unit that attacks
 * @param {BlockTotals|null} [foe.block]      What its skills make of blocking
 * @param {object|null} [foe.weapon]          Its weapon, whose Effect may go past Shields
 * @returns {Guard|null}                      Null when it blocks with nothing
 */
export function guardOf(unit, attack = null, foe = {}) {
  const struck = attack ?? { physical: true, distance: 1, element: null, effective: false };
  const own = unit.block ?? emptyBlock();
  const theirs = foe.block ?? emptyBlock();
  const dex = unit.stats?.dex ?? 0;
  const held = unit.weapon ?? null;
  const reads = weaponBlocking(held?.effect);
  const pierces = weaponBlocking(foe.weapon?.effect).negates ? "shield" : null;
  const negated = (theirs.negates === "all") ? "all" : (theirs.negates ?? pierces);
  const magical = FEO.weaponCategories[held?.category]?.magic;

  // What it could block with, in the order it is tried
  const candidates = [];
  if ( unit.shield && hasUses(unit.shield.uses) && (negated === null) ) {
    candidates.push({ kind: "shield", wears: "shield", item: unit.shield, name: unit.shield.name, uses: unit.shield.uses });
  }
  if ( held && reads.shield && hasUses(held.uses) && (negated === null) ) {
    candidates.push({ kind: "shield", wears: "weapon", item: { ...reads.shield, name: held.name }, name: held.name, uses: held.uses });
  }
  if ( held && own.guard && hasUses(held.uses) && (held.category !== "staff") && (negated !== "all") && (struck.physical !== !!magical) ) {
    const guarding = {
      chance: own.guard.chance,
      dexDiv: own.guard.dexDiv,
      blocks: [{ kind: struck.physical ? "physical" : "magical", reduce: Math.floor((held.might ?? 0) / 2) }],
      wearPhysical: 1,
      parry: null
    };
    candidates.push({ kind: "weapon", wears: "weapon", item: guarding, name: held.name, uses: held.uses, by: own.guard.name });
  }

  for ( const { kind, wears, item, name, uses, by } of candidates ) {
    const counts = (entry) => !entry.kind || (entry.kind === kind);
    const more = own.amount.filter(counts).reduce((sum, entry) => sum + entry.amount, 0);
    const rule = blockRule(item.blocks, struck, { amount: more, magic: (kind === "shield") ? own.magic : false });
    if ( !rule ) continue;

    const div = (kind === "shield") && own.fullDex && item.dexDiv ? 1 : item.dexDiv;
    const parts = [{ label: name, value: item.chance }];
    if ( div ) parts.push({ label: "FEO.Stat.dex.abbr", key: true, value: Math.floor(dex / div) });
    if ( reads.chance ) parts.push({ label: held.name, value: reads.chance });
    for ( const entry of own.chance.filter(counts) ) parts.push({ label: entry.name, value: entry.amount });
    for ( const entry of theirs.foeChance.filter(counts) ) parts.push({ label: entry.name, value: entry.amount });
    const chance = clamp(parts.reduce((sum, part) => sum + part.value, 0), 0, 100);
    const parry = (item.parry && struck.physical && ((struck.distance ?? 1) <= 1))
      ? { chance: clamp(item.parry.chance + (item.parry.dexDiv ? Math.floor(dex / item.parry.dexDiv) : 0), 0, 100), uses: item.parry.uses }
      : null;
    return {
      kind,
      wears,
      name,
      ...(item.id ? { id: item.id } : {}),
      ...(by ? { by } : {}),
      chance,
      parts,
      rule,
      cost: struck.physical ? Math.max(item.wearPhysical ?? 1, 1) : 1,
      parry,
      uses: { value: uses?.value ?? 0, max: uses?.max ?? 0 },
      first: own.first.filter(counts),
      last: own.last.filter(counts),
      lost: own.lost[struck.physical ? "def" : "res"] ?? 0
    };
  }
  return null;
}

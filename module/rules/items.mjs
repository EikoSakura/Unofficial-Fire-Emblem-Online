/**
 * Items and skills for Fire Emblem Online: what a unit's skills make of the HP an item restores to it, and the
 * items a skill has its unit use up for something that lasts. Pure functions of plain data, so that they can
 * be tested outside of Foundry.
 *
 * A skill waits for the moment its unit regains HP from an item that restores them, which is no moment of a
 * fight or of a turn. It is `sure`, or an answer whoever Uses the item may give (`may: true`), asked before
 * the item heals:
 *
 *   { proc: { on: "itemHeal", sure: true },
 *     grant: { to: "self", effects: [], mend: { of: "healed", div: 2 }, ends: "turnStart" } }
 *                                       // a change for its unit, in which a number can be read from `healed`,
 *                                       // the HP the item restored to it. Here: half of that again as its
 *                                       // next turn starts
 *   { proc: { on: "itemHeal", may: true, own: true }, healTimes: 0.5,
 *     grant: { to: "self", effects: [{ stats: { str: 2 } }], ends: "turnStart" } }
 *                                       // `own`: only for an item its unit Uses on itself. `healTimes`: what
 *                                       // the item restores to it is multiplied by this, rounded down
 *
 * What the item restores is settled first, with every `healTimes` that takes effect; then the unit is healed;
 * then the changes are granted, each read from the HP it regained. A change that heals over the turns to come
 * (`mend`) and is granted again before it is over adds to what it had left to give, so that two items heal
 * for both.
 *
 * And a skill has its unit use up an item for a change that lasts, as Wealth Of Power does with Gems. A
 * `consumes` part stands alone in its effect and is always there, one for each item:
 *
 *   { consumes: { item: "Red Gem",
 *                 grant: { to: "self", name: "Wealth Of Power (Red Gem)", ends: "map",
 *                          effects: [{ stats: { str: 6 }, combat: { critical: 10 } }] } } }
 *
 * Using that item is then its unit's Action: the item is destroyed, whatever uses it had left, and its unit
 * carries the change, which is written as any lasting change is (see `timed.mjs`). While it carries it the
 * item cannot be used that way again, so that none adds up with itself; changes of different names stand
 * side by side. What such a power does at a moment of a fight or of a turn, or for the units around, cannot
 * be written into a change: it is written on the skill itself, for as long as its unit carries the change:
 *
 *   { when: { carries: "Wealth Of Power (Purple Gem)" }, proc: { on: "hit", sure: true }, inflicts: ["poison"] }
 *
 * @import {SkillEntry, SkillSelf} from "./skills.mjs"
 * @import {TimedChange} from "./timed.mjs"
 */
import { holds, readNumber, resolveGiven } from "./skills.mjs";
import { TIMED_ENDS, buildChange } from "./timed.mjs";

/** The moment a unit regains HP from an item that restores them. */
export const ITEM_MOMENT = "itemHeal";

/** What an effect that waits for it can say, and what its moment can. */
export const ITEM_PARTS = ["proc", "when", "choice", "grant", "healTimes", "remind"];
export const ITEM_PROC_PARTS = ["on", "sure", "may", "own"];

/**
 * @typedef ItemUnit
 * A unit as these rules read it.
 * @property {string} [name]
 * @property {string} [uuid]
 * @property {SkillEntry[]} skills      Its equipped skills and the changes it carries
 * @property {SkillSelf} self           What its skills may ask about it
 * @property {TimedChange[]} [timed]    The changes that last on it, for one that adds to what it had left
 */

/**
 * @typedef ItemOffer
 * One thing a skill of the unit does as an item restores HP to it.
 * @property {string} skill
 * @property {string} [id]              The skill Item, where there is one
 * @property {number} index             Which of the skill's effects it is
 * @property {boolean} may              Is whoever Uses the item asked?
 * @property {number} healTimes         What the item restores is multiplied by; 1 where it leaves that alone
 * @property {object} effect
 */

/* -------------------------------------------- */

/**
 * What a unit's skills do as an item restores HP to it: every effect that waits for that moment and whose
 * condition holds. Those its owner may take or leave are marked `may`.
 * @param {ItemUnit} unit               The unit the item heals
 * @param {object} [use]
 * @param {boolean} [use.own]           Does it Use the item on itself?
 * @returns {ItemOffer[]}
 */
export function itemOffers(unit, { own = true } = {}) {
  const offers = [];
  for ( const skill of unit?.skills ?? [] ) {
    (skill.effects ?? []).forEach((effect, index) => {
      if ( (effect?.proc?.on !== ITEM_MOMENT) || effect.aura ) return;
      if ( effect.proc.own && !own ) return;
      if ( effect.when?.declared && !skill.active ) return;
      if ( !holds(effect.when, unit.self ?? {}, null) ) return;
      offers.push({
        skill: skill.name,
        id: skill.id ?? "",
        index,
        may: !!effect.proc.may,
        healTimes: Number.isFinite(effect.healTimes) ? Math.max(effect.healTimes, 0) : 1,
        effect
      });
    });
  }
  return offers;
}

/* -------------------------------------------- */

/**
 * What an item restores once the skills that take effect have had their say.
 * @param {number} restore              What the item restores, with what its user's skills add for an ally
 * @param {ItemOffer[]} taken           The offers that take effect: those that are sure, and those accepted
 * @returns {number}
 */
export function itemRestores(restore, taken = []) {
  const times = taken.reduce((product, offer) => product * (offer.healTimes ?? 1), 1);
  return Math.max(Math.floor((Math.max(restore ?? 0, 0) * times) + 1e-9), 0);
}

/* -------------------------------------------- */

/**
 * What the offers that take effect leave on the unit once the item has healed it: the changes that last a
 * while, with the numbers read from the HP it regained, and the skills that are only announced.
 * @param {ItemUnit} unit
 * @param {ItemOffer[]} taken
 * @param {number} healed               The HP the item restored to the unit in the end
 * @returns {{granted: {skill: string, change: TimedChange}[], told: string[]}}
 */
export function itemMoments(unit, taken = [], healed = 0) {
  const view = { ...(unit?.self ?? {}), healed: Math.max(healed ?? 0, 0) };
  const granted = [];
  const told = [];
  for ( const offer of taken ) {
    const effect = offer.effect ?? {};
    let gave = false;
    for ( const written of [].concat(effect.grant ?? []) ) {
      if ( written?.when && !holds(written.when, view, null) ) continue;
      const { when: asked, ...grant } = written;
      const given = { ...grant, effects: resolveGiven(grant.effects ?? [], view) };
      for ( const key of ["mend", "hp"] ) {
        if ( grant[key] && (typeof grant[key] === "object") ) given[key] = Math.max(readNumber(grant[key], view, null), 0);
      }

      // One that does nothing but heal later, and has nothing to heal, is not granted
      const idle = !given.effects.length && !(given.mend > 0) && !(given.hp > 0) && (written.mend !== undefined);
      if ( idle ) continue;
      const change = buildChange(given, { skill: offer.skill, own: true, carrierInTurn: true });

      // What it had left to restore of an earlier one is added to what it restores now
      const carried = (unit?.timed ?? []).find((entry) => (entry.name === change.name) && !(entry.from ?? "") && (entry.mend > 0) && !entry.spoiled);
      if ( carried && (change.mend > 0) && !(change.max > 0) ) change.mend += carried.mend;
      granted.push({ skill: offer.skill, change });
      gave = true;
    }
    if ( effect.remind || gave || (offer.healTimes !== 1) ) told.push(offer.skill);
  }
  return { granted, told: [...new Set(told)] };
}

/* -------------------------------------------- */
/*  Items a Skill Uses Up                       */
/* -------------------------------------------- */

/** What a `consumes` part can say, what its change can, and what may stand beside it in its effect. */
export const CONSUME_PARTS = ["item", "grant"];
export const CONSUME_GRANT_PARTS = ["to", "name", "effects", "ends", "turns", "mend", "hp"];
export const CONSUME_BESIDE = ["consumes", "when", "choice"];

const sameItem = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/**
 * @typedef ItemPower
 * What a skill makes of an item its unit uses up.
 * @property {string} skill
 * @property {string} [id]              The skill Item, where there is one
 * @property {string} item              The item it uses up, by its name
 * @property {TimedChange} change       The change its unit then carries
 * @property {boolean} carried          Does its unit carry that change already? The item is then kept
 */

/**
 * The items a unit's skills have it use up for something that lasts, each with the change it gives: every
 * `consumes` part of a skill of its own whose condition holds.
 * @param {ItemUnit} unit
 * @returns {ItemPower[]}
 */
export function itemPowers(unit) {
  const powers = [];
  const carried = (unit?.timed ?? []).filter((change) => !(change.from ?? "")).map((change) => change.name);
  for ( const skill of unit?.skills ?? [] ) {
    if ( skill.aura || skill.timed ) continue;
    for ( const effect of skill.effects ?? [] ) {
      const part = effect?.consumes;
      if ( !part || (typeof part !== "object") || !part.item || !part.grant ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, unit.self ?? {}, null) ) continue;
      const grant = { ...part.grant, effects: resolveGiven(part.grant.effects ?? [], unit.self ?? {}) };
      for ( const key of ["mend", "hp"] ) {
        if ( grant[key] && (typeof grant[key] === "object") ) grant[key] = Math.max(readNumber(grant[key], unit.self ?? {}, null), 0);
      }
      const change = buildChange(grant, { skill: skill.name, own: true, carrierInTurn: true });
      powers.push({ skill: skill.name, id: skill.id ?? "", item: String(part.item), change, carried: carried.includes(change.name) });
    }
  }
  return powers;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of an item it is about to Use, where one of them uses it up for something that
 * lasts. Of several skills that would, the first is taken.
 * @param {ItemUnit} unit
 * @param {string} name                 The item's name
 * @returns {ItemPower|null}            Null for an item that is Used as any other
 */
export function itemPower(unit, name) {
  return itemPowers(unit).find((power) => sameItem(power.item, name)) ?? null;
}

/* -------------------------------------------- */

/**
 * What a skill's Effect says of an item, where it lists what each does on a line of its own, as the note
 * pinned to Wealth Of Power does: "Red Gem: +6 STR and +10 Critical".
 * @param {string} [effect]             The skill's Effect, with the note pinned to it
 * @param {string} name                 The item's name
 * @returns {string}                    Empty where the Effect has no such line
 */
export function itemLine(effect, name) {
  for ( const line of String(effect ?? "").split(/\n+/) ) {
    const found = /^\s*([^:]{1,60}):\s*(.+?)\s*$/.exec(line);
    if ( found && sameItem(found[1], name) ) return found[2];
  }
  return "";
}

/* -------------------------------------------- */

/**
 * Check a `consumes` part, so that a typing mistake does not pass silently.
 * @param {object} effect
 * @param {(effects: object[]) => string[]} [checkEffects]    Finds what is wrong with a list of effects
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is, or when the effect has none
 */
export function checkConsumes(effect, checkEffects = () => []) {
  if ( effect?.consumes === undefined ) return [];
  const problems = [];
  const part = effect.consumes;
  if ( effect.proc || effect.aura ) problems.push('"consumes" is always there, not at a moment or as an aura');
  for ( const key of Object.keys(effect) ) if ( !CONSUME_BESIDE.includes(key) && (key !== "proc") && (key !== "aura") ) problems.push(`"consumes" stands alone in its effect, without "${key}"`);
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return [...problems, '"consumes" names the item its unit uses up and the change that gives'];
  for ( const key of Object.keys(part) ) if ( !CONSUME_PARTS.includes(key) ) problems.push(`consumes cannot say "${key}"`);
  if ( (typeof part.item !== "string") || !part.item.trim() ) problems.push("consumes: item is the name of the item it uses up");
  const grant = part.grant;
  if ( !grant || (typeof grant !== "object") || Array.isArray(grant) ) return [...problems, "consumes: grant is the lasting change its unit then carries"];
  for ( const key of Object.keys(grant) ) if ( !CONSUME_GRANT_PARTS.includes(key) ) problems.push(`consumes: its change cannot say "${key}"`);
  if ( grant.to !== "self" ) problems.push('consumes: its change is for "self"');
  if ( (typeof grant.name !== "string") || !grant.name ) problems.push("consumes: its change has a name of its own, so that the changes of different items stand side by side");
  if ( !TIMED_ENDS.includes(grant.ends) ) problems.push(`consumes: its change ends at ${TIMED_ENDS.map((end) => `"${end}"`).join(", ")}`);
  if ( (grant.turns !== undefined) && !(Number.isInteger(grant.turns) && (grant.turns >= 1)) ) problems.push("consumes: its change lasts a whole number of turns");
  for ( const key of ["mend", "hp"] ) {
    if ( (grant[key] !== undefined) && !(Number.isFinite(grant[key]) || (grant[key] && (typeof grant[key] === "object") && (grant[key].of !== undefined))) ) {
      problems.push(`consumes: the "${key}" of its change is a number`);
    }
  }
  if ( !Array.isArray(grant.effects) ) problems.push("consumes: the effects of its change are a list, which may be empty");
  else if ( grant.effects.some((inner) => inner?.proc || inner?.aura || inner?.grant || inner?.consumes) ) {
    problems.push('consumes: the effects of a lasting change cannot wait for a moment, be an aura or grant another; write those on the skill, with "carries"');
  }
  else for ( const problem of checkEffects(grant.effects) ) problems.push(`consumes: in its change, ${problem}`);
  return problems;
}

/* -------------------------------------------- */

/**
 * Check an effect that waits for an item to restore HP to its unit, so that a typing mistake does not pass
 * silently.
 * @param {object} effect
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is, or when it waits for another moment
 */
export function checkItemMoment(effect) {
  const proc = effect?.proc;
  if ( proc?.on !== ITEM_MOMENT ) {
    const problems = [];
    if ( effect?.healTimes !== undefined ) problems.push('only an item that restores HP is multiplied, "healTimes", as it does: "itemHeal"');
    if ( proc?.own !== undefined ) problems.push('only an item that restores HP asks whether its unit Uses it on itself, "own"');
    return problems;
  }
  const problems = [];
  for ( const key of Object.keys(effect) ) if ( !ITEM_PARTS.includes(key) ) problems.push(`an item that restores HP cannot do "${key}"`);
  for ( const key of Object.keys(proc) ) if ( !ITEM_PROC_PARTS.includes(key) ) problems.push(`the moment an item restores HP cannot say "${key}"`);
  if ( !proc.sure === !proc.may ) problems.push('what follows an item that restores HP is "sure", or its owner "may" take it');
  if ( (proc.own !== undefined) && (proc.own !== true) ) problems.push('"own" is true or left out');
  if ( effect.aura ) problems.push("what follows an item that restores HP is for the skill's own unit, not an aura");
  if ( (effect.healTimes !== undefined) && !(Number.isFinite(effect.healTimes) && (effect.healTimes >= 0)) ) problems.push('"healTimes" is what the HP restored is multiplied by: a number, 0 at least');
  if ( (effect.grant === undefined) && (effect.healTimes === undefined) && !effect.remind ) problems.push('an item that restores HP grants a lasting change, is multiplied with "healTimes", or is only announced');
  for ( const grant of [].concat(effect.grant ?? []) ) {
    if ( grant?.reach || (grant?.to !== "self") ) problems.push('as an item restores HP a lasting change is for "self"');
    if ( grant?.drop !== undefined ) problems.push("an item that restores HP takes nothing from a tally");
  }
  return problems;
}

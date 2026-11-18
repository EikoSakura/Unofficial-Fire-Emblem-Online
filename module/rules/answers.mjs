/**
 * Answers in the middle of a fight for Fire Emblem Online: what a unit's skill lets whoever acts for it choose
 * while an exchange is rolled out, and what a skill brings to nothing by a chance of its own. Pure functions of
 * plain data, so that they can be tested outside of Foundry.
 *
 * A skill effect waits for a moment of a fight with a `proc` (see `skills.mjs`). One that says `may: true` in
 * place of a chance or of `sure` is an answer: when its moment comes the fight stops, and whoever acts for the
 * unit is offered it. The dice of a fight are rolled before it is worked out, so the fight is then worked out
 * again from the same dice with what was answered so far (see `resolveExchange` and `playExchange` in
 * `combat.mjs`): it comes to the same point, takes the answer, and goes on from there.
 *
 *   { proc: { on: "landing", may: true }, dodge: true }
 *                                       // a hit that would land on the unit: it dodges the attack instead
 *   { proc: { on: "attacked", may: true }, when: { range: { min: 2 } }, combat: { dodge: 15 } }
 *                                       // an attack about to be made against it, here a ranged one: Dodge
 *                                       // against that attack alone
 *   { proc: { on: "attacked", may: true }, when: { range: { min: 2 } }, cancel: true }
 *                                       // the attack is negated: it is made, and does nothing
 *   { proc: { on: "attacked", may: true, faster: true }, when: { role: "initiating" }, end: true, forgoExp: true }
 *                                       // the fight ends there, before that attack, and its unit earns no
 *                                       // experience from it; `faster`: only for a unit with more Attack
 *                                       // Speed than its foe
 *   { proc: { on: "miss", may: true, within: 10 }, reroll: true }
 *                                       // an attack roll of its own that missed, by this much or less (by any
 *                                       // margin without `within`): the roll is made again
 *   { proc: { on: "critMiss", may: true, within: 10 }, reroll: true }
 *                                       // a hit of its own that failed its critical roll
 *   { proc: { on: "critMiss", may: true, within: 10 }, retaliate: { of: "attack", div: 2 }, costs: { weapon: 4 } }
 *                                       // damage to its target once the hit is dealt, for uses of the weapon
 *   { proc: { on: "struck", may: true, once: true }, costs: { item: ["magic"], uses: 2 }, reduce: { of: "itemMight" } }
 *                                       // a hit it has just taken: uses of an item it carries, of these kinds
 *                                       // (see `weaponIs`), take that item's Might off the hit; each item it
 *                                       // could spend is an offer of its own
 *   { proc: { on: "crit", may: true }, plain: true, splash: { percent: 50, targets: 2, around: "both" } }
 *                                       // a critical hit it has just landed: dealt without the damage of one,
 *                                       // and a share of the hit's damage before the foe's defence goes to so
 *                                       // many other enemies next to its unit ("self"), its foe ("foe") or
 *                                       // either ("both"), picked on the map once the fight is over
 *
 * Every other moment of a fight may be an answer too: with `may: true` the parts the moment has anyway are
 * taken or left by the unit's owner. Several answers to one point are offered together; one is taken at a time,
 * and the others are offered again for as long as the point stands. An answer is offered at most once at a
 * point, and with `once: true` its skill answers once in a fight. What limits its skill (a cooldown, uses per
 * turn or per map: `usage.kind: "auto"`) is spent only by an answer that is taken. Nobody is asked about a unit
 * that has nothing to answer with.
 *
 * What needs no choice is rolled by itself, like every other chance:
 *
 *   { proc: { on: "foil", stat: "luk" }, foils: ["crit", "choose", "activation", "block", "art"] }
 *                                       // a chance, rolled each time, to bring to nothing something its foe
 *                                       // does: a critical hit (the hit lands without the damage of one), a
 *                                       // skill that is chosen when to activate (one declared for the fight,
 *                                       // rolled before the fight is planned; an answer, as it is taken), a
 *                                       // skill that rolled to activate and did, a block, and a Combat Art
 *   { proc: { on: "foil", stat: "luk" }, foils: ["wound"] }
 *                                       // and outside of a fight as in one, what the defeat rules would give
 *                                       // its own unit: a "wound", an "injury". Each one is rolled for by
 *                                       // itself as it would be given (see `saveHarm` in `events.mjs`)
 *   { proc: { on: "attack", stat: "dex" }, cancels: 1 }
 *                                       // the foe's next attack in this fight is not made; also at "start"
 *                                       // and on a "block"
 *   rules: ["worstHit"]                 // its unit rolls each Hit roll twice and takes the worse; in a change
 *                                       // granted with `now: true` it counts for the rest of that fight too
 */
import { FEO } from "../config.mjs";
import { stopsAlone } from "./rounds.mjs";

/** The moments of a fight that only come up for an answer, or for a chance that is rolled in its place. */
export const ANSWER_MOMENTS = ["attacked", "landing", "critMiss"];

/** The moment a unit's skill may bring to nothing something its foe does. */
export const FOIL_MOMENT = "foil";

/** What such a skill can bring to nothing. */
export const FOILS = ["crit", "choose", "activation", "block", "art", "wound", "injury"];

/** Those of them that are no doing of a foe: what the defeat rules would give the skill's own unit. */
export const HARM_FOILS = ["wound", "injury"];

/** The rule that has a unit roll its Hit rolls twice and take the worse. */
export const WORST_HIT = "worstHit";

/** The point at which an ally may come for a unit that an attack would defeat (see `rescue.mjs`). */
export const FALL = "fall";

/** Where the enemies stand that a share of a hit goes to. */
export const SPLASH_AROUND = ["self", "foe", "both"];

/**
 * What stops a fight that is being worked out: an answer is awaited. `resolveExchange` hands its point back.
 */
export class Pending extends Error {
  /**
   * @param {AnswerPoint} point
   */
  constructor(point) {
    super("An answer is awaited.");
    this.point = point;
  }
}

/**
 * @typedef AnswerOffer
 * @property {string} key             What tells it from the other offers of its point
 * @property {string} skill           The skill that answers
 * @property {string|null} [id]       The skill Item, where it is known
 * @property {string} what            What it would do: "dodge", "cancel", "dodgeMore", "end", "reroll", "harm",
 *                                    "reduce", "plain", "save", "stop" (end the fight before a further
 *                                    round) or, for the parts a moment has anyway, "use"
 * @property {number} [amount]        Its number: the Dodge it adds, the damage it takes off or deals
 * @property {number} [cost]          The uses it costs
 * @property {{id: string, name: string, img?: string}} [item]    The item whose uses it costs
 * @property {number} [others]        For "plain": how many other enemies a share of the hit would go to
 * @property {string} [by]            For "save": the ally that would come, by name
 */

/**
 * @typedef AnswerPoint
 * @property {number} index           Which question of the fight it is, counted from 0
 * @property {string} on              The moment: "attacked", "landing", "miss", "critMiss", "struck", "crit",
 *                                    "fall", or any other moment of a fight
 * @property {"initiator"|"defender"} side    The side that may answer
 * @property {{side: string, hitChance: number, hitRoll: number|null, crit: boolean, critChance: number,
 *   critRoll: number|null, damage: number, margin: number|null, hp: number}|null} attack
 *                                    The attack it is about, as far as it has come: who makes it, its chances
 *                                    and rolls, the damage it would deal or deals, by how much a roll failed,
 *                                    and the HP its target has
 * @property {AnswerOffer[]} offers
 * @property {{next: number, hp: number, foeHp: number, deals: number, takes: number}} [round]
 *                                    For the point at which a round has ended and a skill would have it fought
 *                                    again ("round", with an offer to "stop"): the round that would follow,
 *                                    the HP the unit and its foe have, and what the attacks of a round deal
 *                                    and take if they all land (see `rounds.mjs`)
 */

/* -------------------------------------------- */

/**
 * What an answer would do, for the offer to say.
 * @param {object} proc     The moment as `resolveProc` works it out
 * @returns {string}
 */
export function answerKind(proc) {
  if ( proc.dodge ) return "dodge";
  if ( proc.cancel ) return "cancel";
  if ( proc.end ) return "end";
  if ( proc.reroll ) return "reroll";
  if ( proc.plain ) return "plain";
  if ( (proc.on === "attacked") && (proc.combat?.dodge > 0) ) return "dodgeMore";
  if ( (proc.on === "struck") && (proc.reduce || proc.reduceItem || proc.negate) ) return "reduce";
  if ( proc.retaliate > 0 ) return "harm";
  if ( proc.spread ) return "spread";
  return "use";
}

/* -------------------------------------------- */

/**
 * The answer a unit gives by itself, where nobody is asked for it: the first offer worth taking, by a rule
 * that needs no judgement. What keeps a hit off the unit or lessens one is taken for a hit that would take a
 * share of the HP the unit has left, or all of it; a roll is made again; an ally comes for one that would fall.
 * What gives something up (ending the fight, a critical hit's damage, uses of a weapon for damage) is left.
 * @param {AnswerPoint} point
 * @param {object} [options]
 * @param {number} [options.share]    The share of the HP it has left, in percent, that a hit must take
 * @returns {string|null}             The key of the offer taken, or null to pass
 */
export function answerAlone(point, { share = FEO.answers.alone.share } = {}) {
  const attack = point?.attack ?? null;
  const heavy = !!attack && (attack.damage > 0) && ((attack.damage * 100) >= (Math.max(attack.hp, 1) * share));
  const worth = (offer) => {
    switch ( offer.what ) {
      case "dodge": return heavy;
      case "cancel": return heavy && (attack.hitChance > 0);
      case "dodgeMore": return heavy && (attack.hitChance > 0) && ((attack.hitChance - (offer.amount ?? 0)) < 100);
      case "reduce": return heavy && ((offer.amount ?? 0) > 0);
      case "reroll": return true;
      case "save": return true;

      // What reaches for the units around costs nothing, and gives nothing up
      case "spread": return true;

      // A fight that would go on for a further round is ended where that round would defeat the unit and not
      // its foe (see `rounds.mjs`)
      case "stop": return stopsAlone(point?.round ?? null);
      default: return false;
    }
  };

  // Of several that lessen a hit, the one that takes the most off
  const offers = [...(point?.offers ?? [])].sort((a, b) => ((b.what === "reduce") ? (b.amount ?? 0) : 0) - ((a.what === "reduce") ? (a.amount ?? 0) : 0));
  return offers.find(worth)?.key ?? null;
}

/* -------------------------------------------- */

/**
 * What a unit's skills may bring to nothing before a fight is worked out: the skills its foe chose for the
 * fight, and the Combat Art its foe performs. Each is rolled for once, by the first of the unit's chances that
 * can; the fight is then planned again without what was brought to nothing (`planExchange` with `foiled`).
 * @param {import("./combat.mjs").ExchangePlan} plan
 * @returns {{by: "initiator"|"defender", skill: string, chance: number, sure: boolean, foils: "choose"|"art",
 *   what: string}[]}       `by` is the side whose skill rolls, `what` the skill or Art of its foe
 */
export function foilsBefore(plan) {
  const list = [];
  if ( !plan?.order?.length ) return list;
  for ( const by of ["initiator", "defender"] ) {
    const foe = (by === "initiator") ? "defender" : "initiator";
    if ( !(plan[by].unit.hp > 0) ) continue;
    const chances = plan[by].chances?.[FOIL_MOMENT] ?? [];
    const first = (kind) => chances.find((proc) => proc.foils?.includes(kind)) ?? null;
    const chosen = first("choose");
    for ( const name of chosen ? (plan[foe].chose ?? []) : [] ) {
      list.push({ by, skill: chosen.skill, chance: chosen.chance, sure: !!chosen.sure, foils: "choose", what: name });
    }
    const art = first("art");
    if ( art && plan[foe].art ) list.push({ by, skill: art.skill, chance: art.chance, sure: !!art.sure, foils: "art", what: plan[foe].art.name ?? "" });
  }
  return list;
}

/* -------------------------------------------- */

/**
 * Roll what a unit's skills may bring to nothing before a fight.
 * @param {ReturnType<typeof foilsBefore>} list
 * @param {() => number} d100
 * @returns {{rolls: object[], foiled: {initiator: string[], defender: string[], art: boolean}|null}}
 *          The rolls, as a fight tells its chances (with `foils` and `what`), and what was brought to nothing:
 *          the skills of each side by name, and the Combat Art. Null when nothing was
 */
export function settleFoils(list, d100) {
  const rolls = [];
  const foiled = { initiator: [], defender: [], art: false };
  for ( const entry of list ?? [] ) {
    const roll = entry.sure ? null : d100();
    const success = entry.sure || (roll <= entry.chance);
    rolls.push({ skill: entry.skill, on: FOIL_MOMENT, by: entry.by, roll, chance: entry.sure ? 100 : entry.chance, success, foils: entry.foils, what: entry.what, ...(entry.sure ? { sure: true } : {}) });
    if ( !success ) continue;
    if ( entry.foils === "art" ) foiled.art = true;
    else foiled[(entry.by === "initiator") ? "defender" : "initiator"].push(entry.what);
  }
  const any = foiled.art || foiled.initiator.length || foiled.defender.length;
  return { rolls, foiled: any ? foiled : null };
}

/* -------------------------------------------- */

/**
 * Check the parts of an effect that speak of answers, so that a typing mistake does not pass silently.
 * @param {object} effect
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkAnswer(effect) {
  const problems = [];
  const proc = effect?.proc ?? null;
  const on = proc?.on;
  const only = (key, moments, what) => {
    if ( (key in (effect ?? {})) && !((effect[key] === true) && moments.includes(on)) ) problems.push(what);
  };
  if ( proc && (proc.may !== undefined) ) {
    if ( proc.may !== true ) problems.push('"may" is true or left out');
    if ( proc.sure || proc.stat || (proc.percent != null) ) problems.push("an answer its owner may give has no chance and is not sure");
    if ( effect.aura ) problems.push("an answer is for the skill's own unit, not an aura");
  }
  if ( proc && (proc.within !== undefined) ) {
    if ( !["miss", "critMiss"].includes(on) ) problems.push('"within" is the margin a roll failed by, on a "miss" or a "critMiss"');
    if ( !(Number.isFinite(proc.within) && (proc.within >= 1)) ) problems.push('"within" is a number, 1 at least');
  }
  if ( proc && (proc.faster !== undefined) && (proc.faster !== true) ) problems.push('"faster" is true or left out');
  only("dodge", ["landing"], 'a hit is dodged, "dodge: true", as it is "landing"');
  only("cancel", ["attacked"], 'an attack is negated, "cancel: true", as the unit is "attacked"');
  only("plain", ["crit"], 'a critical hit is dealt without its damage, "plain: true", on a "crit"');
  only("forgoExp", ["attacked"], '"forgoExp" is true, beside "end", as the unit is "attacked"');
  if ( ("forgoExp" in (effect ?? {})) && !effect.end ) problems.push('"forgoExp" goes with "end"');
  if ( ("reroll" in (effect ?? {})) && ["miss", "critMiss"].includes(on) && (effect.reroll !== true) ) problems.push('a roll is made again with "reroll: true"');
  if ( (on === "attacked") && effect.combat && Object.keys(effect.combat).some((key) => !["dodge", "critAvoid"].includes(key)) ) {
    problems.push('against an attack about to be made a unit only gains "dodge" and "critAvoid"');
  }
  if ( (on === "attacked") && effect.combat?.critAvoid && proc?.may ) problems.push('an answer to an attack about to be made only gains "dodge"');
  if ( proc && (proc.perHp !== undefined) ) {
    if ( (on !== "attacked") || !proc.sure ) problems.push('"perHp" is for what is sure as its unit is "attacked"');
    if ( !(Number.isFinite(proc.perHp) && (proc.perHp > 0)) ) problems.push('"perHp" is a share of maximum HP, in percent');
  }
  if ( "splash" in (effect ?? {}) ) {
    const splash = effect.splash;
    if ( !["hit", "crit"].includes(on) ) problems.push('a share of a hit goes to other enemies on a "hit" or a "crit"');
    if ( !splash || (typeof splash !== "object") ) problems.push("splash says what share goes to how many enemies");
    else {
      for ( const key of Object.keys(splash) ) if ( !["percent", "targets", "around"].includes(key) ) problems.push(`splash cannot say "${key}"`);
      if ( !(Number.isFinite(splash.percent) && (splash.percent > 0)) ) problems.push("splash: percent is the share of the hit's damage before the foe's defence");
      if ( !(Number.isInteger(splash.targets) && (splash.targets >= 1)) ) problems.push("splash: targets is how many enemies it goes to");
      if ( (splash.around !== undefined) && !SPLASH_AROUND.includes(splash.around) ) problems.push(`splash: around is ${SPLASH_AROUND.map((key) => `"${key}"`).join(", ")}`);
    }
  }
  if ( "costs" in (effect ?? {}) ) {
    const costs = effect.costs;
    if ( !proc?.may ) problems.push("only an answer has a cost");
    if ( !costs || (typeof costs !== "object") ) problems.push("costs names uses of the weapon in hand, or of an item");
    else {
      for ( const key of Object.keys(costs) ) if ( !["weapon", "item", "uses"].includes(key) ) problems.push(`costs cannot say "${key}"`);
      const whole = (value) => Number.isInteger(value) && (value >= 1);
      if ( (costs.weapon !== undefined) && !whole(costs.weapon) ) problems.push("costs: weapon is a whole number of uses of the weapon in hand");
      if ( (costs.item !== undefined) && !(Array.isArray(costs.item) && costs.item.length && whole(costs.uses)) ) {
        problems.push("costs: item lists the kinds of item, and uses how many of its uses");
      }
      if ( (costs.weapon === undefined) === (costs.item === undefined) ) problems.push("costs: the weapon in hand or an item, one of the two");
    }
  }
  if ( (effect?.reduce?.of === "itemMight") && !effect.costs?.item ) problems.push('"itemMight" is the Might of the item an answer spends uses of');
  if ( on === FOIL_MOMENT ) {
    const foils = effect.foils;
    if ( proc.may ) problems.push("what a skill brings to nothing is rolled for, not chosen");
    if ( !Array.isArray(foils) || !foils.length || !foils.every((kind) => FOILS.includes(kind)) ) {
      problems.push(`foils lists what is brought to nothing: ${FOILS.map((kind) => `"${kind}"`).join(", ")}`);
    }
    for ( const key of Object.keys(effect) ) if ( !["proc", "when", "choice", "foils"].includes(key) ) problems.push(`a chance to bring something to nothing cannot do "${key}"`);
  }
  else if ( "foils" in (effect ?? {}) ) problems.push('"foils" is for the moment "foil"');
  return problems;
}

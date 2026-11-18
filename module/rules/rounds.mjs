/**
 * The round of a fight for Fire Emblem Online: who attacks when, how often, and how a fight goes on for more
 * rounds than one. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A fight is one round unless something has it otherwise: the unit that starts it attacks, its foe answers, and
 * whoever is fast enough attacks again (see `planExchange` in `combat.mjs`). Skills reshape that with the parts
 * below, each written on an effect like any other (see the top of `skills.mjs`).
 *
 * Always there:
 *
 *   extraAttack: { percent: 100, attacks: 2 }     // one more attack after all others; `attacks`: only for a
 *                                                 // unit that would make that many attacks without it
 *   extraAttack: { percent: 100, follows: true }  // `follows`: only for a unit that follows up by its Attack
 *                                                 // Speed, whatever a skill grants it
 *   rules: ["strikesAlways"]                      // what its weapon strikes "when initiating combat" it strikes
 *                                                 // whoever began the fight
 *   rules: ["foeFirst"]                           // its foe attacks first in a fight its unit starts, where that
 *                                                 // foe attacks at all; against a foe that has the same rule,
 *                                                 // or with the rule "first" beside it, the round is as it was
 *   speedLead: { per: 3, damage: 1, hit: 3, critical: 3 }      // against a foe it follows up on: these for
 *                                                 // every `per` Attack Speed it has over that foe beyond what
 *                                                 // a follow-up takes
 *   staffFollow: { haste: 3 }                     // it follows up with an Offensive Staff, with that much HST
 *                                                 // (see `staffFollows`)
 *   when: { inSight: true }                       // in a fight: its foe stands within its Line of Sight
 *
 * At the start of a fight, `proc: { on: "start", ... }`:
 *
 *   order: "first"                    // its unit attacks first in every round of this fight, whoever began it
 *   order: "press"                    // its follow-up attack is made before its foe's counter-attack; a unit
 *                                     // that makes none makes one more attack there instead
 *   cuts: { later: 50, lone: 25 }     // for the rest of the fight it takes that share less damage from every
 *                                     // attack after the first that is made against it; from a foe that makes
 *                                     // no more than one attack, `lone` less from that one
 *   attack: true                      // it makes one attack with the weapon in hand in each round, where it
 *                                     // would make none because that weapon does not reach: in the place of
 *                                     // its counter-attack
 *   attack: { hit, might, range }     // the same with an attack that has numbers of its own (see `skills.mjs`);
 *                                     // a unit that attacks anyway makes it right after its first attack
 *
 * On each attack, `proc: { on: "attack", sure: true, ... }`:
 *
 *   proc: { on: "attack", sure: true, from: 2 }                // `from`: only from its unit's 2nd attack of
 *                                                              // the fight on, whatever that attack is
 *   proc: { on: "attack", sure: true, from: 2, mounts: true }  // `mounts`: its numbers count once for each
 *                                                              // attack its unit has made since
 *   might: 1                          // added to the weapon's Might for that attack, as `damage` is to its damage
 *   proc: { on: "attack", sure: true, hurt: true }             // `hurt`: only once an attack has landed on
 *                                                              // its unit in this fight, for every attack it
 *                                                              // makes from then on
 *   stat: "mag"                       // the attack adds this stat to the weapon's Might in place of the one the
 *                                     // weapon adds; also in a `sequence`, beside `against`
 *
 * On a hit, `proc: { on: "hit", sure: true }`:
 *
 *   chain: { most: 4, hit: 50, lone: true }       // its unit makes one more attack at once, at that share of
 *                                                 // the Hit it comes to in the end (rounded down), and another
 *                                                 // for as long as each lands, `most` in a row. A chain is begun
 *                                                 // by an attack of the round and by none a skill added; with
 *                                                 // `lone`, only by a unit that makes no follow-up attack in
 *                                                 // that fight. The attacks of a chain are made with the weapon
 *                                                 // in hand and wear it as any attack does, and set off no
 *                                                 // attack in answer
 *
 * When struck, `proc: { on: "struck", ... }`:
 *
 *   proc: { on: "struck", sure: true, every: 2 }     // `every`: only for every 2nd attack that is made against
 *                                                    // its unit, hit or miss, counted from the start of its
 *                                                    // own turn across fights
 *   proc: { on: "struck", perDamage: 3 }, attack: true, next: { hit: 15 }
 *                                                    // `perDamage`: a chance of that many percent for each
 *                                                    // point of damage the hit dealt. `attack: true`: its
 *                                                    // unit, if it still stands and can attack, makes one
 *                                                    // more attack at once
 *
 * As a round ends, `proc: { on: "round", ... }`, with a chance or `sure`:
 *
 *   again: { most: 20, stop: true }   // the round is fought again, with the same attacks in the same order,
 *                                     // that many times at most in a fight. With `stop`, whoever acts for the
 *                                     // unit may end the fight instead, before any attack of the further
 *                                     // round is made: an answer (see `answers.mjs`), offered as "stop"
 *   proc: { on: "round", sure: true, faster: true, healthier: true }
 *                                     // `healthier`: only while its unit has more HP than its foe, as the
 *                                     // round ends; `faster`: only for a unit with more Attack Speed
 *
 * A skill used as an action starts a fight of several rounds with `act: { target, fight: { rounds: 5 } }` or
 * `fight: { rounds: "fall" }` (see `actions.mjs`): the plan then carries `rounds`, and the fight goes on for
 * that many rounds, or until a unit falls.
 *
 * Every further round rolls its own dice, wears weapons and has every moment of a fight as the first had. What
 * a fight has once (the first attack's Combat Art, a moment marked `once`) it has once, however many rounds it
 * runs to, and what counts the attacks made counts on through them. A fight ends as soon as a unit falls, when
 * a round passes in which nobody attacked, and after `FEO.rounds.most` rounds at the latest.
 */
import { FEO } from "../config.mjs";

/** The moment a round of a fight ends. */
export const ROUND_MOMENT = "round";

/** How a skill changes the order of a round as the fight begins. */
export const ORDERS = ["first", "press"];

/** The rule that has a weapon strike as it does "when initiating combat" whoever began the fight. */
export const STRIKES_ALWAYS = "strikesAlways";

/** The rule that has the foe of its unit attack first in a fight its unit starts. */
export const FOE_FIRST = "foeFirst";

/* -------------------------------------------- */

/**
 * Does the unit that is attacked make the first attack of a round? It does where its own skill has it attack
 * first, and where a skill of the unit that began the fight has its foe do so. Two units that would both
 * lead, or both give way, leave the round as it is; so does one whose skills say both of itself.
 * @param {Set<string>|string[]} [initiator]    The combat rules the skills of the unit that began the fight bend
 * @param {Set<string>|string[]} [defender]     The same for the unit that is attacked
 * @returns {boolean}
 */
export function defenderLeads(initiator = [], defender = []) {
  const has = (rules, rule) => (rules instanceof Set) ? rules.has(rule) : [].concat(rules ?? []).includes(rule);
  const leads = (rules) => has(rules, "first") && !has(rules, FOE_FIRST);
  const yields = (rules) => has(rules, FOE_FIRST) && !has(rules, "first");
  return (leads(defender) && !leads(initiator)) || (yields(initiator) && !yields(defender));
}

/** What a fight is said to go on until, where it has no number of rounds. */
export const UNTIL_FALL = "fall";

/* -------------------------------------------- */

/**
 * The rounds a fight is fought for, where something has it go on for more than one.
 * @param {{rounds?: number|string, skill?: string}|null} [fight]     As an action skill says it: a number of
 *                                                                    rounds, or "fall"
 * @param {object} [config]     FEO.rounds
 * @returns {{count: number, skill: string, until: "fall"|null}|null}  Null for a fight of one round
 */
export function roundsOf(fight, config = FEO.rounds) {
  if ( !fight ) return null;
  const most = config?.most ?? 50;
  if ( fight.rounds === UNTIL_FALL ) return { count: most, skill: fight.skill ?? "", until: UNTIL_FALL };
  const count = Math.min(Math.floor(Number(fight.rounds)) || 1, most);
  return (count > 1) ? { count, skill: fight.skill ?? "", until: null } : null;
}

/* -------------------------------------------- */

/**
 * @typedef RoundEntry
 * One attack of a round, as it stands in the order of attacks.
 * @property {"initiator"|"defender"} key
 * @property {"open"|"follow"|"extra"|"press"|"join"} kind      The attack a side makes first, its follow-up, one
 *                                                              a skill adds after all others, one made for
 *                                                              pressing on, one a skill has it join in with
 */

/**
 * Put the attacks of a round in order, with what skills changed about it as the fight began.
 * @param {RoundEntry[]} entries          The attacks as the plan has them
 * @param {object} [changes]
 * @param {string|null} [changes.first]   The side that attacks first, where a skill has it so
 * @param {Record<string, RoundEntry[]>} [changes.press]
 *                                        For a side that presses on: the attacks it makes right after its first
 *                                        where it has no follow-up to make there
 * @param {string[]} [changes.pressing]   The sides that press on
 * @param {Record<string, RoundEntry[]>} [changes.joins]
 *                                        The attacks a skill has a side join in with
 * @returns {RoundEntry[]}
 */
export function lineUp(entries, { first = null, press = {}, pressing = [], joins = {} } = {}) {
  const foeOf = (key) => (key === "initiator") ? "defender" : "initiator";
  const of = (key, kind) => entries.filter((entry) => (entry.key === key) && (entry.kind === kind));
  const opens = { initiator: of("initiator", "open"), defender: of("defender", "open") };
  const follows = { initiator: of("initiator", "follow"), defender: of("defender", "follow") };
  const extras = entries.filter((entry) => entry.kind === "extra");

  // Who opens the round: the unit that began the fight, unless a skill has its foe attack first
  const lead = (first && opens[first].length && opens[foeOf(first)].length) ? first
    : entries.find((entry) => entry.kind === "open")?.key ?? "initiator";
  const round = [];
  const early = new Set();
  for ( const key of [lead, foeOf(lead)] ) {
    const mine = [...opens[key]];

    // A side that presses on makes its follow-up right after its first attack, or one more attack there
    if ( pressing.includes(key) && mine.length ) {
      if ( follows[key].length ) {
        mine.push(...follows[key]);
        early.add(key);
      }
      else mine.push(...(press[key] ?? []));
    }

    // An attack a skill has a side join in with: right after its first, or where its first would have been
    const joined = joins[key] ?? [];
    if ( mine.length ) mine.splice(opens[key].length, 0, ...joined);
    else mine.push(...joined);
    round.push(...mine);
  }
  for ( const key of ["initiator", "defender"] ) if ( !early.has(key) ) round.push(...follows[key]);
  round.push(...extras);
  return round;
}

/* -------------------------------------------- */

/**
 * How many steps of Attack Speed a unit has over its foe beyond what a follow-up takes.
 * @param {number} speed          Its Attack Speed
 * @param {number} foeSpeed       Its foe's
 * @param {number} per            The Attack Speed a step takes
 * @param {number} [threshold]    The lead a follow-up takes
 * @returns {number}
 */
export function speedSteps(speed, foeSpeed, per, threshold = FEO.doubleThreshold) {
  if ( !(per > 0) ) return 0;
  return Math.max(Math.floor(((speed ?? 0) - (foeSpeed ?? 0) - threshold) / per), 0);
}

/* -------------------------------------------- */

/**
 * Does the attack a unit is about to receive count for a skill that takes effect for every so many?
 * @param {number} before     The attacks made against it this turn before this one
 * @param {number} every      Every how many attacks the skill takes effect
 * @returns {boolean}
 */
export function countsEvery(before, every) {
  return (every > 0) && (((Math.max(before, 0) + 1) % every) === 0);
}

/* -------------------------------------------- */

/**
 * Does a unit that nobody is asked for end a fight that would go on for a further round? It does where the
 * attacks of a round would defeat it and its own would not defeat its foe; otherwise it fights on.
 * @param {{hp: number, foeHp: number, deals: number, takes: number}|null} round    Where the two stand as the
 *        round ends, and what the attacks of a round deal each of them if they all land
 * @returns {boolean}
 */
export function stopsAlone(round) {
  if ( !round ) return false;
  return (round.takes >= round.hp) && (round.deals < round.foeHp);
}

/* -------------------------------------------- */

/**
 * Is an Offensive Staff cast a second time at once, as a follow-up attack is made? Only by a unit whose skill
 * lets it follow up with staves, with the Attack Speed lead a follow-up takes; never with a staff for each
 * enemy in range, and with a staff that inflicts a condition only where the first cast failed to.
 * @param {object} cast
 * @param {{haste: number}|null} cast.follow      What the unit's skills make of following up with a staff
 * @param {number} cast.speed                     Its Attack Speed with the staff in hand
 * @param {number} cast.foeSpeed                  Its target's Attack Speed
 * @param {number} [cast.haste]                   HST it has from elsewhere
 * @param {boolean} [cast.area]                   Is the staff for each enemy in range?
 * @param {boolean} [cast.status]                 Does the staff inflict a condition?
 * @param {boolean} [cast.landed]                 Did its first cast hit?
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function staffFollows({ follow, speed, foeSpeed, haste = 0, area = false, status = false, landed = true }, threshold = FEO.doubleThreshold) {
  if ( !follow || area ) return false;
  if ( !Number.isFinite(speed) || !Number.isFinite(foeSpeed) ) return false;
  if ( ((speed + (follow.haste ?? 0) + haste) - foeSpeed) < threshold ) return false;
  return !(status && landed);
}

/* -------------------------------------------- */

/**
 * In a few signs, what a side's attacks after the first deal: "× 2" where they all deal what the first does,
 * each number where they differ, and the last of them with their count where there are too many to list.
 * @param {{damage: number}[]} blows      What each of its attacks deals, one after the other
 * @param {number} [attacks]              How many it makes, where the plan does not list them
 * @returns {string}                      Empty for a side that makes one attack
 */
export function strikesAfter(blows, attacks = blows.length) {
  const count = blows.length || attacks;
  if ( count <= 1 ) return "";
  const first = blows[0]?.damage;
  if ( !blows.length || blows.every((blow) => blow.damage === first) ) return `× ${count}`;
  if ( count <= 4 ) return blows.slice(1).map((blow) => `+ ${blow.damage}`).join(" ");
  return `… ${blows.at(-1).damage} (× ${count})`;
}

/* -------------------------------------------- */

/**
 * The attacks a fight of several rounds comes to if every attack lands without a critical hit, in the order
 * they are made: the attacks of a round, round after round, until a unit falls or the rounds are over. A round
 * in which nothing would be dealt ends it.
 * @param {import("./combat.mjs").ExchangePlan} plan
 * @returns {{key: string, blow: {damage: number, hit: number}}[]}
 */
export function spanOf(plan) {
  const span = [];
  const hp = { initiator: plan.initiator.unit.hp, defender: plan.defender.unit.hp };
  const fallen = () => (hp.initiator <= 0) || (hp.defender <= 0);
  for ( let round = 0; (round < (plan.rounds?.count ?? 1)) && !fallen(); round++ ) {
    const at = { initiator: 0, defender: 0 };
    let dealt = 0;
    for ( const key of plan.order ) {
      const blow = plan[key].blows?.[at[key]++];
      if ( !blow || fallen() ) continue;
      span.push({ key, blow });
      const lands = (blow.hit === undefined) || (blow.hit > 0);
      dealt += lands ? blow.damage : 0;
      hp[(key === "initiator") ? "defender" : "initiator"] -= lands ? blow.damage : 0;
    }
    if ( !dealt ) break;
  }
  return span;
}

/* -------------------------------------------- */

/**
 * Check the parts of an effect that speak of the round of a fight, so that a typing mistake does not pass
 * silently.
 * @param {object} effect
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkRounds(effect) {
  const problems = [];
  const proc = effect?.proc ?? null;
  const on = proc?.on;
  const whole = (value, least = 1) => Number.isInteger(value) && (value >= least);
  const share = (value) => Number.isFinite(value) && (value > 0) && (value <= 100);

  if ( effect?.extraAttack !== undefined ) {
    const extra = effect.extraAttack;
    if ( !extra || (typeof extra !== "object") ) problems.push("extraAttack says what share of its damage the attack deals");
    else {
      for ( const key of Object.keys(extra) ) if ( !["percent", "attacks", "follows"].includes(key) ) problems.push(`extraAttack cannot say "${key}"`);
      if ( (extra.percent !== undefined) && !(Number.isFinite(extra.percent) && (extra.percent > 0)) ) problems.push("extraAttack: percent is a share of the attack's damage");
      if ( (extra.attacks !== undefined) && !whole(extra.attacks, 2) ) problems.push("extraAttack: attacks is how many attacks its unit must make without it, 2 at least");
      if ( ![undefined, true].includes(extra.follows) ) problems.push("extraAttack: follows is true or left out");
    }
    if ( proc || effect.aura ) problems.push('"extraAttack" is always there, not at a moment or as an aura');
  }
  if ( effect?.speedLead !== undefined ) {
    const lead = effect.speedLead;
    if ( proc || effect.aura ) problems.push('"speedLead" is always there, not at a moment or as an aura');
    if ( !lead || (typeof lead !== "object") || !(Number.isFinite(lead.per) && (lead.per > 0)) ) problems.push("speedLead: per is the Attack Speed each step takes");
    else {
      for ( const [key, value] of Object.entries(lead) ) {
        if ( !["per", "damage", "hit", "critical"].includes(key) ) problems.push(`speedLead cannot say "${key}"`);
        else if ( !Number.isFinite(value) ) problems.push(`speedLead: "${key}" is a number`);
      }
      if ( !["damage", "hit", "critical"].some((key) => lead[key]) ) problems.push("speedLead gives damage, hit or critical for each step");
    }
  }
  if ( effect?.staffFollow !== undefined ) {
    const follow = effect.staffFollow;
    if ( proc || effect.aura ) problems.push('"staffFollow" is always there, not at a moment or as an aura');
    if ( !follow || (typeof follow !== "object") || Object.keys(follow).some((key) => key !== "haste") || ((follow.haste !== undefined) && !Number.isFinite(follow.haste)) ) {
      problems.push("staffFollow says the HST its unit follows up with staves by: { haste }");
    }
  }
  if ( (effect?.when?.inSight !== undefined) && (effect.when.inSight !== true) ) problems.push('"inSight" is true or left out');

  // At the start of a fight
  if ( "order" in (effect ?? {}) ) {
    if ( on !== "start" ) problems.push('the order of a round is changed as the fight begins, "start"');
    if ( !ORDERS.includes(effect.order) ) problems.push(`order is ${ORDERS.map((key) => `"${key}"`).join(" or ")}, not "${effect.order}"`);
  }
  if ( "cuts" in (effect ?? {}) ) {
    const cuts = effect.cuts;
    if ( on !== "start" ) problems.push('"cuts" is rolled for as the fight begins, "start"');
    if ( !cuts || (typeof cuts !== "object") || !share(cuts.later) ) problems.push("cuts: later is the share taken off every attack after the first");
    else {
      for ( const key of Object.keys(cuts) ) if ( !["later", "lone"].includes(key) ) problems.push(`cuts cannot say "${key}"`);
      if ( (cuts.lone !== undefined) && !share(cuts.lone) ) problems.push("cuts: lone is the share taken off the one attack of a foe that makes no other");
    }
  }

  // On an attack
  if ( proc && (proc.from !== undefined) ) {
    if ( (on !== "attack") || !proc.sure ) problems.push('"from" is for a "sure" moment on an "attack"');
    if ( !whole(proc.from, 2) ) problems.push('"from" is the attack of the fight it begins with, 2 at least');
    if ( effect.sequence ) problems.push('a moment that begins "from" a later attack turns no attack into several');
  }
  if ( proc && (proc.mounts !== undefined) && !((proc.mounts === true) && (proc.from !== undefined)) ) problems.push('"mounts" is true, beside "from"');
  if ( proc && (proc.hurt !== undefined) ) {
    if ( (proc.hurt !== true) || (on !== "attack") || !proc.sure ) problems.push('"hurt" is true, for a "sure" moment on an "attack"');
    if ( proc.from !== undefined ) problems.push('a moment begins "from" a later attack, or once its unit is "hurt", not both');
    if ( effect.sequence || effect.attack ) problems.push('a moment that waits for its unit to be "hurt" adds no attack');
  }

  // On a hit
  if ( "chain" in (effect ?? {}) ) {
    const chain = effect.chain;
    if ( (on !== "hit") || !proc?.sure ) problems.push('a chain of attacks is begun by a "sure" moment on a "hit"');
    if ( !chain || (typeof chain !== "object") || !whole(chain.most, 1) ) problems.push("chain: most is how many attacks it adds in a row at the most");
    else {
      for ( const key of Object.keys(chain) ) if ( !["most", "hit", "lone"].includes(key) ) problems.push(`chain cannot say "${key}"`);
      if ( (chain.hit !== undefined) && !(Number.isFinite(chain.hit) && (chain.hit > 0) && (chain.hit <= 100)) ) problems.push("chain: hit is the share of its Hit each of its attacks is made at, in percent");
      if ( ![undefined, true].includes(chain.lone) ) problems.push('chain: "lone" is true or left out');
    }
  }
  if ( ("might" in (effect ?? {})) && proc && (on !== "attack") ) problems.push('Might is added to an "attack"');
  for ( const part of proc ? [effect, ...(effect.sequence ?? [])] : [] ) {
    if ( (part?.stat !== undefined) && !(part.stat in FEO.stats) ) problems.push(`unknown stat "${part.stat}"`);
  }
  if ( proc && ("stat" in effect) && (on !== "attack") ) problems.push('another stat is added to the weapon\'s Might on an "attack"');

  // When struck
  if ( proc && (proc.every !== undefined) ) {
    if ( (on !== "struck") || !proc.sure ) problems.push('"every" is for a "sure" moment when "struck"');
    if ( !whole(proc.every, 2) ) problems.push('"every" is every how many attacks, 2 at least');
  }
  if ( proc && (proc.perDamage !== undefined) ) {
    if ( on !== "struck" ) problems.push('a chance is read from the damage of a hit, "perDamage", when "struck"');
    if ( !(Number.isFinite(proc.perDamage) && (proc.perDamage > 0)) ) problems.push('"perDamage" is the chance in percent for each point of damage');
    if ( proc.sure || proc.may || proc.stat || (proc.percent != null) ) problems.push('a chance read from damage is no other chance, and not "sure"');
  }
  if ( (on === "struck") && effect.attack ) {
    const allowed = ["proc", "when", "choice", "attack", "next", "remind", "grant"];
    for ( const key of Object.keys(effect) ) if ( !allowed.includes(key) ) problems.push(`a unit that attacks at once when struck cannot also "${key}"`);
  }

  // As a round ends
  if ( on === ROUND_MOMENT ) {
    const again = effect.again;
    for ( const key of Object.keys(effect) ) if ( !["proc", "when", "choice", "again"].includes(key) ) problems.push(`the end of a round cannot do "${key}"`);
    if ( proc.may ) problems.push("a further round is rolled for or sure; its owner may stop it");
    if ( effect.aura ) problems.push("a further round is for the skill's own unit, not an aura");
    if ( !again || (typeof again !== "object") || !whole(again.most) ) problems.push("again: most is how many times the round is fought again at most");
    else {
      for ( const key of Object.keys(again) ) if ( !["most", "stop"].includes(key) ) problems.push(`again cannot say "${key}"`);
      if ( ![undefined, true].includes(again.stop) ) problems.push("again: stop is true or left out");
    }
  }
  else if ( "again" in (effect ?? {}) ) problems.push('"again" is for the moment "round"');
  if ( proc && (proc.healthier !== undefined) && !((proc.healthier === true) && (on === ROUND_MOMENT)) ) problems.push('"healthier" is true, as a "round" ends');
  return problems;
}

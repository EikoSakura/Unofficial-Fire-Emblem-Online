/**
 * What happens to a unit, for Fire Emblem Online: damage it takes, a condition put on it, a foe it defeats.
 * Whatever the source (an attack rolled by the system, the damage of a skill, a condition at the start of a
 * turn, a weapon that backfires, a number typed in by hand), the same questions are asked of the unit's skills
 * here, so that a skill which answers such an event answers it wherever it comes from. Pure functions of plain
 * data that take their dice as a function, so that they can be tested outside of Foundry.
 *
 * Damage is of a kind:
 *
 *   "attack"      a hit of an attack. With the weapon it was made with, what the unit's skills say about that
 *                 weapon counts (`when: { foeWeapon: ["fire"] }`), and with the defence it was counted against
 *                 (`resist`) a defence lent by an ally counts
 *   "skill"       what a skill deals outside of an attack
 *   "condition"   what a condition deals as a turn starts
 *   "backfire"    what the unit's own weapon turns on it
 *   "terrain"     what the ground deals
 *
 * and a unit's skills answer it in this order: a unit that takes no damage from skills takes none of that kind
 * (`rules: ["noSkillDamage"]`); a share more or less (`takenPercent`) counts for damage of every kind, as does
 * what a Staggered unit takes on top; an attack is then lessened by what the unit, or an ally near it, has a
 * chance of when it is struck (`negate`, `reduce`, `shield`); and a blow that would still be fatal, whatever
 * dealt it, may be survived (`survive`). What a unit does to its attacker in return (`reflect`, `retaliate`,
 * `inflictsAttacker`) belongs to an exchange of attacks and is read there.
 *
 * @import {ConditionBends, ConditionState} from "./conditions.mjs"
 * @import {SkillEntry, SkillSelf} from "./skills.mjs"
 * @import {TimedChange} from "./timed.mjs"
 */
import { FEO } from "../config.mjs";
import { FOIL_MOMENT, HARM_FOILS } from "./answers.mjs";
import { applyCondition, conditionConfig, wardOff } from "./conditions.mjs";
import { takeHit, woundsFrom } from "./defeat.mjs";
import { hasQuality } from "./positions.mjs";
import { hpHolds, readsDealt, resolveDealt, resolveProc, skillTotals } from "./skills.mjs";
import { buildChange } from "./timed.mjs";

/**
 * @typedef EventUnit
 * A unit as the rules of events read it.
 * @property {string} [name]
 * @property {string} [uuid]
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} [level]
 * @property {Record<string, number>} [stats]     The stats it has now, with everything counted
 * @property {SkillEntry[]} skills                Its equipped skills, the changes it carries for a while and
 *                                                the auras it receives
 * @property {SkillSelf} self                     What its skills may ask about it
 * @property {ConditionState} [conditions]
 * @property {ConditionBends|null} [bends]        How its skills bend the rules of conditions
 * @property {number} [activation]                Its Skill Activation rate
 * @property {boolean} [always]                   Do its skills always activate?
 * @property {number} [times]                     What the damage it takes is multiplied by, as for a unit that
 *                                                is Staggered
 * @property {number} [resilience]                Set for a unit that can be Incapacitated: damage past 0 HP is
 *                                                kept, less this much
 * @property {boolean} [inTurn]                   Is it its own turn right now?
 */

/**
 * @typedef DamageFacts
 * @property {"attack"|"skill"|"condition"|"backfire"|"terrain"} [kind]
 * @property {object|null} [weapon]         The weapon an attack was made with
 * @property {string|null} [element]        The element of the damage, where no weapon is known
 * @property {"def"|"res"|null} [resist]    The defence the damage was counted against, if any
 * @property {boolean} [nonlethal]          Does it leave the unit 1 HP at least?
 * @property {boolean} [settled]            Are shares and immunities already counted in the amount?
 * @property {number} [distance]            Tiles between the unit and what dealt it
 * @property {SkillSelf|null} [by]          The unit that dealt it, where one is known
 */

/**
 * @typedef DamageOutcome
 * @property {string} kind
 * @property {number} asked                 The damage as it came
 * @property {number} dealt                 The damage as the unit takes it
 * @property {number} hpBefore
 * @property {number} hp
 * @property {boolean} defeated             Did it bring a standing unit to 0 HP?
 * @property {{what: "immune"|"share"|"negate"|"reduce"|"shield"|"halve"|"survive", skill: string, amount?: number,
 *   times?: number}[]} steps               What the unit's skills made of it, in order
 * @property {{skill: string, roll: number|null, chance: number, success: boolean, sure: boolean}[]} rolls
 * @property {{id: string|null, name: string}[]} used     Skills that count their uses, one for each time one
 *                                                        took effect
 * @property {TimedChange[]} grants         Changes that last a while which the unit is granted
 */

/** The kinds of damage a unit can take. */
export const DAMAGE_KINDS = ["attack", "skill", "condition", "backfire", "terrain"];

const SIDES = ["giver", "target"];

/* -------------------------------------------- */
/*  Reading Units                               */
/* -------------------------------------------- */

/**
 * The fight a unit's skills are asked about when something happens to it outside of an exchange of attacks:
 * the unit counts as initiating in its own turn and as defending otherwise, and its foe is whatever is known
 * of the unit that did it.
 * @param {EventUnit} unit
 * @param {object} [about]
 * @param {SkillSelf|null} [about.by]       The other unit, where one is known
 * @param {object|null} [about.weapon]      The weapon it acted with
 * @param {string|null} [about.element]     The element of what it did, where no weapon is known
 * @param {number} [about.distance]
 * @returns {import("./skills.mjs").SkillFight}
 */
export function eventFight(unit, about = {}) {
  const foe = about.by ?? {};
  const weapon = about.weapon ?? (about.element ? { name: "", category: about.element } : null);
  return {
    role: unit.inTurn ? "initiating" : "defending",
    distance: about.distance ?? 1,
    foe: {
      hp: foe.hp ?? 0,
      hpMax: foe.hpMax ?? foe.hp ?? 0,
      level: foe.level ?? unit.level ?? unit.self?.level ?? 1,
      stats: foe.stats ?? {},
      weapon,
      qualities: foe.qualities ?? "",
      near: foe.near ?? null,
      afflicted: Object.keys(foe.conditions ?? {}).length > 0,
      marks: foe.marks ?? []
    },
    foeCounters: null,
    counters: null
  };
}

/* -------------------------------------------- */

/**
 * A unit as its skills are asked about it, with the names of its own skills.
 * @param {EventUnit} unit
 * @returns {SkillSelf}
 */
function selfOf(unit) {
  const self = { name: unit.name ?? "", hp: unit.hp, hpMax: unit.hpMax, level: unit.level ?? 1, conditions: unit.conditions ?? {}, ...(unit.self ?? {}) };
  if ( !Array.isArray(self.skills) ) {
    self.skills = (unit.skills ?? []).filter((skill) => !skill.aura && !skill.timed).map((skill) => skill.name);
  }
  return self;
}

/* -------------------------------------------- */

/**
 * The chances of a unit's skills that wait for a moment, worked out for the event at hand.
 * @param {EventUnit} unit
 * @param {string} on                                         The moment: "struck", "kill", "inflict", "afflicted"
 * @param {import("./skills.mjs").SkillFight|null} fight
 * @returns {import("./skills.mjs").Proc[]}
 */
export function momentProcs(unit, on, fight) {
  const self = selfOf(unit);
  const totals = skillTotals(unit.skills ?? [], self, { fight });
  const seen = { ...self, stats: unit.stats ?? self.stats ?? {} };
  // An answer its owner may give is only offered in a fight the system rolls
  return totals.procs.filter((raw) => (raw.effect.proc.on === on) && !raw.effect.proc.may).map((raw) => resolveProc(raw, seen, fight, {
    activation: unit.activation ?? 0,
    always: !!unit.always,
    inflictChance: totals.bends.inflictChance
  }));
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * What a unit's skills make of the size of damage of a kind, before anything is rolled: the skills that leave
 * it none, and those that give it a share more or less.
 * @param {EventUnit} unit
 * @param {DamageFacts} [about]
 * @returns {{times: number, immune: string[], shares: {skill: string, times: number}[]}}
 *          What the damage is multiplied by, with what a Staggered unit takes on top; the skills by which it
 *          takes none from skills; and each skill that changes its share
 */
export function damageShares(unit, about = {}) {
  const fight = eventFight(unit, about);
  const self = selfOf(unit);
  const immune = [];
  const shares = [];
  for ( const skill of unit.skills ?? [] ) {
    const one = skillTotals([skill], self, { fight });
    if ( one.rules.has("noSkillDamage") ) immune.push(skill.name);
    if ( one.takenMultiplier !== 1 ) shares.push({ skill: skill.name, times: one.takenMultiplier });
  }
  const times = shares.reduce((product, share) => product * share.times, 1) * Math.max(unit.times ?? 1, 0);
  return { times, immune, shares };
}

/* -------------------------------------------- */

/**
 * The skill, or the change that lasts on a unit, by which a blow that would be fatal to it is halved.
 * @param {EventUnit} unit
 * @param {DamageFacts} [about]
 * @returns {string|null}     Its name; null for a unit that has none
 */
export function fatalHalver(unit, about = {}) {
  const fight = eventFight(unit, about);
  const self = selfOf(unit);
  for ( const skill of unit.skills ?? [] ) {
    if ( skillTotals([skill], self, { fight }).rules.has("halveFatal") ) return skill.name;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * The chances a unit has when damage of a kind reaches it: for an attack, what lessens a hit; for damage of
 * every kind, what lets it survive a fatal blow. Those that survive are read last, and of them one that costs
 * a use after those that cost none.
 * @param {EventUnit} unit
 * @param {DamageFacts} [about]
 * @returns {import("./skills.mjs").Proc[]}
 */
export function struckProcs(unit, about = {}) {
  const attack = (about.kind ?? "attack") === "attack";
  const procs = momentProcs(unit, "struck", eventFight(unit, about));
  const lessening = attack ? procs.filter((proc) => !proc.survive && (proc.negate || proc.reduce || proc.shield)) : [];
  const saving = procs.filter((proc) => proc.survive);
  return [...lessening, ...saving.filter((proc) => !proc.uses), ...saving.filter((proc) => proc.uses)];
}

/* -------------------------------------------- */

/**
 * The most d100s damage to a unit can need: one for each of its chances that is rolled for.
 * @param {EventUnit} unit
 * @param {DamageFacts} [about]
 * @returns {number}
 */
export function damageDice(unit, about = {}) {
  return struckProcs(unit, about).filter((proc) => !proc.sure).length;
}

/* -------------------------------------------- */

/**
 * A unit takes damage, from whatever source.
 * @param {EventUnit} unit
 * @param {number} amount           The damage as it comes
 * @param {DamageFacts} [about]
 * @param {() => number} [d100]     Returns a whole number from 1 to 100
 * @returns {DamageOutcome}
 */
export function sufferDamage(unit, amount, about = {}, d100 = () => 100) {
  const kind = DAMAGE_KINDS.includes(about.kind) ? about.kind : "attack";
  const hpBefore = unit.hp ?? 0;
  const hpMax = unit.hpMax ?? hpBefore;
  const asked = Math.max(Math.floor(amount ?? 0), 0);
  const outcome = { kind, asked, dealt: asked, hpBefore, hp: hpBefore, defeated: false, steps: [], rolls: [], used: [], grants: [] };
  if ( !asked ) return outcome;
  let damage = asked;

  // A unit that takes no damage from skills, and the share more or less it takes of damage of any kind
  if ( !about.settled ) {
    const { times, immune, shares } = damageShares(unit, { ...about, kind });
    if ( (kind === "skill") && immune.length ) {
      damage = 0;
      outcome.steps.push({ what: "immune", skill: immune[0] });
    }
    else if ( times !== 1 ) {
      damage = Math.floor((damage * times) + 1e-9);
      for ( const share of shares ) outcome.steps.push({ what: (share.times === 0) ? "immune" : "share", skill: share.skill, times: share.times });
    }
  }

  // The chances the unit has now that the damage reaches it
  const counted = [];
  const fire = (proc) => {
    const same = (entry) => (entry.id ?? entry.name) === (proc.uses.id ?? proc.uses.name);
    if ( proc.uses && (proc.uses.left !== null) && (counted.filter(same).length >= proc.uses.left) ) return false;
    const roll = proc.sure ? null : d100();
    const success = proc.sure || (roll <= proc.chance);
    outcome.rolls.push({ skill: proc.skill, roll, chance: proc.sure ? 100 : proc.chance, success, sure: !!proc.sure });
    if ( success && proc.uses ) counted.push({ id: proc.uses.id ?? null, name: proc.uses.name });
    return success;
  };
  const own = unit.stats ?? unit.self?.stats ?? {};
  let lent = 0;

  // A blow that would be fatal is halved for a unit whose skills, or a change that lasts on it, say so: once
  // whatever lessens it has, and before anything is rolled to survive it. It may be fatal still
  let halved = false;
  const halve = () => {
    if ( halved || (hpBefore <= 0) || (damage < hpBefore) ) return;
    halved = true;
    const skill = fatalHalver(unit, { ...about, kind });
    if ( !skill ) return;
    const before = damage;
    damage = Math.floor(damage / 2);
    outcome.steps.push({ what: "halve", skill, amount: before - damage });
  };
  for ( const proc of (damage > 0) ? struckProcs(unit, { ...about, kind }) : [] ) {
    if ( damage <= 0 ) break;
    if ( proc.survive ) {
      halve();
      // Halving a blow does nothing for a unit at 1 HP; being left at 1 HP hangs on the HP it had
      if ( (hpBefore <= 0) || (damage < hpBefore) ) continue;
      if ( (proc.survive === true) ? (hpBefore <= 1) : !hpHolds(proc.survive.hp, hpBefore, hpMax) ) continue;
    }

    // A defence that is no more than the unit's own, or for damage no defence was counted against, lends nothing
    const more = (proc.shield && about.resist) ? Math.max((proc.shield[about.resist] ?? 0) - (own[about.resist] ?? 0), 0) : 0;
    if ( !proc.survive && !proc.negate && !proc.reduce && !(more > lent) ) continue;
    if ( !fire(proc) ) continue;

    // What the skill grants its own unit as it takes effect. A change that is read from what the skill takes
    // off the blow is worked out from that; one that is read from what the blow deals in the end waits for a
    // fight the system rolls
    const less = proc.negate ? damage - Math.floor(((damage * (100 - proc.negate)) / 100) + 1e-9) : 0;
    const off = less + (proc.reduce ? Math.min(proc.reduce, damage - less) : 0);
    for ( let grant of (proc.grants ?? []).filter((entry) => (entry.to === "self") && !entry.reach) ) {
      if ( readsDealt(grant) ) {
        if ( readsDealt(grant, ["dealt", "taken"]) || !(off > 0) ) continue;
        grant = { ...grant, effects: resolveDealt(grant.effects, { negated: off }) };
        if ( grant.mend && (typeof grant.mend === "object") ) grant.mend = resolveDealt(grant.mend, { negated: off });
      }
      outcome.grants.push(buildChange(grant, { skill: proc.source ?? proc.skill, from: proc.giver || "", own: !proc.giver, carrierInTurn: !!unit.inTurn }));
    }
    const before = damage;
    if ( proc.survive ) {
      if ( proc.survive === true ) damage = Math.floor(damage / 2);
      if ( damage >= hpBefore ) damage = hpBefore - 1;
      outcome.steps.push({ what: "survive", skill: proc.skill, amount: before - damage });
      continue;
    }
    if ( proc.negate ) {
      damage = Math.floor(((damage * (100 - proc.negate)) / 100) + 1e-9);
      outcome.steps.push({ what: "negate", skill: proc.skill, amount: before - damage });
    }
    if ( proc.reduce ) {
      const had = damage;
      damage = Math.max(damage - proc.reduce, 0);
      outcome.steps.push({ what: "reduce", skill: proc.skill, amount: had - damage });
    }

    // A defence lent for this hit: it is lessened by the difference, counted once however many lend theirs
    if ( more > lent ) {
      const had = damage;
      damage = Math.max(damage - (more - lent), 0);
      lent = more;
      outcome.steps.push({ what: "shield", skill: proc.skill, amount: had - damage });
    }
  }

  halve();
  if ( about.nonlethal && (hpBefore > 0) ) damage = Math.min(damage, hpBefore - 1);
  outcome.dealt = damage;
  outcome.used = counted;
  outcome.hp = Number.isFinite(unit.resilience) ? takeHit(hpBefore, damage, unit.resilience).hp : Math.max(hpBefore - damage, Math.min(hpBefore, 0));
  outcome.defeated = (hpBefore > 0) && (outcome.hp <= 0);
  return outcome;
}

/* -------------------------------------------- */
/*  Wounds and Injuries                         */
/* -------------------------------------------- */

/**
 * The chances a unit's skills give it to take no Wound, or no Injury, that the defeat rules would give it
 * (`{ proc: { on: "foil", stat: "luk" }, foils: ["wound"] }`), surest first.
 * @param {EventUnit} unit
 * @param {"wound"|"injury"} what
 * @returns {import("./skills.mjs").Proc[]}
 */
export function harmSavers(unit, what) {
  if ( !HARM_FOILS.includes(what) ) return [];
  return momentProcs(unit, FOIL_MOMENT, eventFight(unit))
    .filter((proc) => proc.foils?.includes(what) && (proc.sure || (proc.chance > 0)))
    .sort((a, b) => (b.sure ? 101 : b.chance) - (a.sure ? 101 : a.chance));
}

/* -------------------------------------------- */

/**
 * The most d100s that sparing a unit so many Wounds or Injuries can need.
 * @param {EventUnit} unit
 * @param {"wound"|"injury"} what
 * @param {number} [count]
 * @returns {number}
 */
export function harmDice(unit, what, count = 1) {
  return Math.max(count ?? 0, 0) * harmSavers(unit, what).filter((proc) => !proc.sure).length;
}

/* -------------------------------------------- */

/**
 * A unit would be given Wounds, or Injuries: each is rolled for by itself, with each chance its skills give it
 * in turn until one comes.
 * @param {EventUnit} unit
 * @param {"wound"|"injury"} what
 * @param {number} [count]          How many it would be given
 * @param {() => number} [d100]     Returns a whole number from 1 to 100
 * @returns {{what: string, asked: number, left: number, spared: number,
 *   rolls: {skill: string, roll: number|null, chance: number, success: boolean, sure: boolean, foils: string}[]}}
 *          How many it is still given, how many it was spared, and what was rolled
 */
export function saveHarm(unit, what, count = 1, d100 = () => 100) {
  const asked = Math.max(Math.floor(count ?? 0), 0);
  const out = { what, asked, left: asked, spared: 0, rolls: [] };
  const savers = asked ? harmSavers(unit, what) : [];
  if ( !savers.length ) return out;
  for ( let index = 0; index < asked; index++ ) {
    for ( const proc of savers ) {
      const roll = proc.sure ? null : d100();
      const success = !!proc.sure || (roll <= proc.chance);
      out.rolls.push({ skill: proc.skill, roll, chance: proc.sure ? 100 : proc.chance, success, sure: !!proc.sure, foils: what });
      if ( !success ) continue;
      out.left -= 1;
      out.spared += 1;
      break;
    }
  }
  return out;
}

/* -------------------------------------------- */

/**
 * The Wounds one instance of damage causes a unit that can be Wounded: a hit of an attack that deals its
 * maximum HP divided by 1.5 or more. Damage of any other kind is no hit, and causes none.
 * @param {DamageOutcome} outcome       What came of the damage (see `sufferDamage`)
 * @param {number} hpBase               The unit's maximum HP before Wounds and Injuries
 * @returns {number}
 */
export function damageWounds(outcome, hpBase) {
  if ( (outcome?.kind !== "attack") || !(outcome.dealt > 0) ) return 0;
  return woundsFrom([outcome.dealt], hpBase);
}

/* -------------------------------------------- */
/*  Healing                                     */
/* -------------------------------------------- */

/**
 * A unit regains HP, up to its maximum.
 * @param {{hp: number, hpMax: number}} unit
 * @param {number} amount
 * @param {object} [options]
 * @param {boolean} [options.fromZero]    Is a unit below 0 HP healed from 0, as a staff heals it?
 * @returns {{hpBefore: number, hp: number, healed: number}}    `healed` is what it regained from where it
 *          was healed from
 */
export function regainHp(unit, amount, { fromZero = false } = {}) {
  const hpBefore = unit.hp ?? 0;
  const from = fromZero ? Math.max(hpBefore, 0) : hpBefore;
  const healed = Math.max(Math.min(Math.floor(amount ?? 0), (unit.hpMax ?? from) - from), 0);
  return { hpBefore, hp: healed ? from + healed : hpBefore, healed };
}

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

/**
 * A condition would be put on a unit: what guards the unit may nullify it, and otherwise it is applied.
 * @param {object} target
 * @param {ConditionState} [target.conditions]    The conditions it suffers from
 * @param {number} [target.hp]                    A unit without HP is given no condition
 * @param {{skill: string, percent: number, only?: "damaging"|string[]}[]} [target.wards]
 *                                                What may nullify a condition that would be applied to it
 * @param {string} id
 * @param {object} [options]
 * @param {number} [options.turns]      Turns to apply, instead of the condition's usual amount
 * @param {number} [options.more]       Turns it lasts longer, as the skills of the unit that inflicts it say
 * @param {boolean} [options.keep]      For one handed back for a few turns: it never cuts short what the unit
 *                                      already suffers
 * @param {boolean} [options.down]      Is it applied to a unit without HP all the same?
 * @param {() => number} [d100]         Returns a whole number from 1 to 100
 * @returns {{id: string, success?: false, turns?: number, previous?: number|null, stacked?: boolean,
 *   warded?: object[], state: ConditionState, held: boolean}|null}
 *          Null for what is no condition a unit can keep, or for a unit without HP. `success: false` when it
 *          was nullified; `warded` lists what was tried; `state` is what the unit then suffers from, and
 *          `held` says that the condition stops it from counter-attacking
 */
export function receiveCondition({ conditions = {}, hp = 1, wards = [] } = {}, id, { turns, more = 0, keep = false, down = false } = {}, d100 = () => 100) {
  const config = conditionConfig(id);
  if ( !config || config.combatOnly || (!down && !(hp > 0)) ) return null;
  const warded = wardOff(wards, id, d100);
  if ( warded.at(-1)?.success ) return { id, success: false, warded, state: { ...conditions }, held: false };
  const tried = warded.length ? { warded } : {};
  const has = conditions[id];
  if ( keep && !config.stacks && ((has ?? -1) >= turns) ) {
    return { id, turns: has, previous: has, stacked: false, ...tried, state: { ...conditions }, held: false };
  }
  const amount = ((turns !== undefined) || more) ? (turns ?? config.turns) + more : undefined;
  const applied = applyCondition(conditions, id, { turns: amount });
  return { id, turns: applied.turns, previous: applied.previous, stacked: applied.stacked, ...tried, state: applied.state, held: !!config.noCounter };
}

/* -------------------------------------------- */

/**
 * The most d100s putting a condition on a unit can need: one for each chance below 100% that may nullify it.
 * @param {{skill: string, percent: number, only?: "damaging"|string[]}[]} [wards]
 * @returns {number}
 */
export function wardDice(wards) {
  return (wards ?? []).filter((ward) => (ward.percent > 0) && (ward.percent < 100)).length;
}

/* -------------------------------------------- */

/**
 * A unit has been given a condition outside of an exchange of attacks: the skills of the unit that gave it
 * which wait for that take effect, and those of the unit that suffers it may hand it back. Both moments are
 * sure ones, so nothing is rolled.
 * @param {object} event
 * @param {EventUnit|null} [event.giver]    The unit that inflicted it, where one is known
 * @param {EventUnit} event.target          The unit that suffers it
 * @param {{id: string, turns?: number}} event.inflicted
 * @param {number} [event.distance]
 * @returns {{
 *   grants: {to: "giver"|"target", skill: string, change: TimedChange}[],
 *   returned: {id: string, turns: number, skill: string}[],
 *   reminders: {skill: string, by: "giver"|"target"}[],
 *   recover: number
 * }}   Changes that last a while, for either unit; the condition handed back to the giver, and for how many
 *      turns; the skills the system only announces; and the HP the giver regains for inflicting it
 */
export function conditionMoments({ giver = null, target, inflicted, distance = 1 }) {
  const out = { grants: [], returned: [], reminders: [], recover: 0, spreads: [] };
  const units = { giver, target };
  const fights = {
    giver: giver ? eventFight(giver, { by: { ...selfOf(target), stats: target.stats ?? target.self?.stats ?? {} }, distance }) : null,
    target: eventFight(target, { by: giver ? { ...selfOf(giver), stats: giver.stats ?? giver.self?.stats ?? {} } : null, distance })
  };
  const other = (side) => SIDES.find((key) => key !== side);
  const give = (proc, by) => {
    for ( let grant of proc.grants ?? [] ) {
      if ( grant.reach ) {
        if ( !out.reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) out.reminders.push({ skill: proc.skill, by });
        continue;
      }
      const to = (grant.to === "foe") ? other(by) : by;
      const carrier = units[to];
      if ( !carrier || !(carrier.hp > 0) ) continue;

      // A unit that negates what would be put on it is given nothing by another
      if ( (to !== by) && carrier.bends?.debuffs?.negate ) continue;

      // A change that lasts as long as the condition does, counted from the afflicted unit's next turn, and
      // gone with the condition if that is cured early
      if ( grant.turns === "condition" ) grant = { ...grant, turns: Math.max(inflicted.turns ?? 1, 1), next: true, while: inflicted.id };
      const own = (to === by) && !proc.giver;
      out.grants.push({
        to,
        skill: proc.source ?? proc.skill,
        change: buildChange(grant, {
          skill: proc.source ?? proc.skill,
          from: proc.giver || (units[by].name ?? ""),
          giver: units[by].uuid ?? "",
          own,
          giverInTurn: !!units[by].inTurn,
          carrierInTurn: !!carrier.inTurn
        })
      });
    }
    if ( proc.remind && !out.reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) out.reminders.push({ skill: proc.skill, by });
  };

  for ( const proc of giver ? momentProcs(giver, "inflict", fights.giver) : [] ) {
    if ( proc.conditions && !proc.conditions.includes(inflicted.id) ) continue;

    // HP the unit that inflicts it regains for that
    if ( giver.hp > 0 ) out.recover += Math.max(proc.recover ?? 0, 0);
    give(proc, "giver");

    // What it does to the units around the one it afflicted, for whoever knows the map to work out
    if ( proc.spread ) out.spreads.push({ skill: proc.source ?? proc.skill, spread: proc.spread });
  }
  for ( const proc of (target.hp > 0) ? momentProcs(target, "afflicted", fights.target) : [] ) {
    if ( proc.conditions && !proc.conditions.includes(inflicted.id) ) continue;
    give(proc, "target");
    if ( giver && (proc.returns > 0) ) out.returned.push({ id: inflicted.id, turns: proc.returns, skill: proc.skill });
  }
  return out;
}

/* -------------------------------------------- */

/**
 * The conditions a unit's skills say it always has, which it does not have right now.
 * @param {ConditionBends|null} bends
 * @param {ConditionState} [conditions]
 * @returns {string[]}
 */
export function keptConditions(bends, conditions = {}) {
  return Object.entries(bends?.suffers ?? {})
    .filter(([id, bend]) => bend?.stays && conditionConfig(id) && !conditionConfig(id).combatOnly && !Object.hasOwn(conditions ?? {}, id))
    .map(([id]) => id);
}

/* -------------------------------------------- */
/*  Defeat                                      */
/* -------------------------------------------- */

/**
 * @typedef KillMoments
 * @property {{skill: string, amount: number}[]} gold     Gold each skill gives
 * @property {number} goldTotal
 * @property {number} recover                             HP the unit regains
 * @property {string[]} reminders                         Skills the system only announces
 * @property {TimedChange[]} grants                       Changes that last a while, for the unit itself
 * @property {{skill: string, acts: object}[]} acts       Goes its skills earn it in its own turn
 * @property {{skill: string, refreshes: object}[]} refreshes     A Refresh its skills hand out in its own turn
 * @property {{skill: string, roll: number|null, chance: number, success: boolean, sure: boolean}[]} rolls
 * @property {{skill: string, on: "kill", loot: object}[]} loot       What its skills take from the foe (see
 *                                                        `stealing.mjs`)
 * @property {{skill: string, id?: string, on: "kill", makes: object}[]} raises     The creatures its skills
 *                                                        raise from the foe (see `creatures.mjs`)
 */

/**
 * The chances of a unit's skills that wait for it to defeat a foe.
 * @param {EventUnit} killer
 * @param {EventUnit} foe
 * @param {number} [distance]
 * @returns {import("./skills.mjs").Proc[]}
 */
function killProcs(killer, foe, distance = 1) {
  const by = { ...selfOf(foe), stats: foe.stats ?? foe.self?.stats ?? {}, marks: foe.marks ?? [] };
  return momentProcs(killer, "kill", eventFight(killer, { by, weapon: by.weapon ?? null, distance }));
}

/**
 * The most d100s a unit defeating a foe can need.
 * @param {EventUnit} killer
 * @param {EventUnit} foe
 * @returns {number}
 */
export function killDice(killer, foe) {
  return killProcs(killer, foe).filter((proc) => !proc.sure).length;
}

/**
 * A unit has defeated a foe, by whatever means: what its skills give it for that.
 * @param {EventUnit} killer
 * @param {EventUnit} foe
 * @param {() => number} [d100]     Returns a whole number from 1 to 100
 * @param {object} [options]
 * @param {number} [options.distance]
 * @returns {KillMoments}
 */
export function killMoments(killer, foe, d100 = () => 100, { distance = 1 } = {}) {
  const out = { gold: [], goldTotal: 0, recover: 0, reminders: [], grants: [], acts: [], refreshes: [], rolls: [], spreads: [], loot: [], raises: [] };
  for ( const proc of killProcs(killer, foe, distance) ) {
    const roll = proc.sure ? null : d100();
    const success = proc.sure || (roll <= proc.chance);
    out.rolls.push({ skill: proc.skill, roll, chance: proc.sure ? 100 : proc.chance, success, sure: !!proc.sure });
    if ( !success ) continue;
    if ( proc.gold > 0 ) {
      out.gold.push({ skill: proc.skill, amount: proc.gold });
      out.goldTotal += proc.gold;
    }
    out.recover += Math.max(proc.recover ?? 0, 0);
    if ( proc.remind && !out.reminders.includes(proc.skill) ) out.reminders.push(proc.skill);

    // What it takes from the foe it defeated
    if ( proc.loot ) out.loot.push({ skill: proc.skill, on: "kill", loot: proc.loot });

    // The creature it raises from the foe it defeated
    if ( proc.makes && !out.raises.some((entry) => entry.skill === proc.skill) ) {
      out.raises.push({ skill: proc.skill, ...(proc.uses?.id ? { id: proc.uses.id } : {}), on: "kill", makes: proc.makes });
    }

    // What it does to the units around, for whoever knows the map to work out
    if ( proc.spread ) out.spreads.push({ skill: proc.source ?? proc.skill, spread: proc.spread });

    // Another go in its turn, for a unit that defeats its foe in its own turn (see `acting.mjs`)
    if ( proc.acts && killer.inTurn && !out.acts.some((entry) => entry.skill === proc.skill) ) out.acts.push({ skill: proc.skill, acts: proc.acts });

    // A Refresh it hands out for that, to the allies around or to itself (see `refresh.mjs`)
    if ( proc.refreshes && killer.inTurn && !out.refreshes.some((entry) => entry.skill === proc.skill) ) out.refreshes.push({ skill: proc.skill, refreshes: proc.refreshes });
    for ( const grant of (proc.grants ?? []).filter((entry) => (entry.to === "self") && !entry.reach) ) {
      out.grants.push(buildChange(grant, { skill: proc.source ?? proc.skill, from: proc.giver || "", own: !proc.giver, carrierInTurn: !!killer.inTurn }));
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  What a Special Quality Builds In            */
/* -------------------------------------------- */

/**
 * The skills a unit's Special Qualities build into it.
 * @param {string} [qualities]                    Its Special Qualities, as free text
 * @param {Record<string, string|string[]>} [table]      The skill each quality builds in, or the skills:
 *                                                        FEO.qualitySkills
 * @returns {string[]}                            Each once
 */
export function builtInSkills(qualities, table = FEO.qualitySkills) {
  const names = Object.entries(table ?? {}).filter(([quality]) => hasQuality(qualities, quality)).flatMap(([, skill]) => [].concat(skill));
  return [...new Set(names)];
}

/* -------------------------------------------- */

/**
 * What has to change among a unit's skills for it to have what its Special Qualities build into it: those it
 * lacks are added, and those it was given this way and has the quality for no longer are taken off. One that
 * was put on it by hand is left alone.
 * @param {string} [qualities]
 * @param {{name: string, builtIn?: boolean}[]} [held]      The skills it has, and whether each was given this way
 * @param {Record<string, string>} [table]
 * @returns {{add: string[], remove: string[]}}
 */
export function builtInChanges(qualities, held = [], table = FEO.qualitySkills) {
  const wanted = builtInSkills(qualities, table);
  const key = (name) => String(name ?? "").trim().toLowerCase();
  const has = new Set((held ?? []).map((skill) => key(skill.name)));
  return {
    add: wanted.filter((name) => !has.has(key(name))),
    remove: [...new Set((held ?? []).filter((skill) => skill.builtIn && !wanted.some((name) => key(name) === key(skill.name))).map((skill) => skill.name))]
  };
}

/**
 * Condition rules for Fire Emblem Online: how long conditions last, what they do when a unit's turn starts,
 * and how they change an exchange of attacks.
 *
 * Ported from the Condition list in the "Intro and Basics" tab of the rules and the rulings in the Book of
 * Stipulations. Every number comes from the conditions table in the system configuration. Everything here
 * works on plain data and takes its dice as a function, so that it can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";

/**
 * @typedef {Record<string, number>} ConditionState
 * The conditions on a unit: the number of the unit's own turns each one has left, by condition id. For a
 * condition that stacks, this number is also its stack. A condition with 0 turns left is in its last turn
 * and ends when that turn does.
 */

/**
 * @typedef Infliction
 * A condition a weapon inflicts on a hit, as read from its Effect.
 * @property {string} id            The condition
 * @property {number} chance        Chance to inflict it, in percent
 * @property {number|null} dice     The faces of the die that sets how many turns are added, or null for the
 *                                  condition's usual amount
 * @property {boolean} otherwise    Is it only inflicted when the one listed before it was not?
 */

/**
 * @typedef StrikeContext
 * @property {ConditionState} [attacker]    The attacker's conditions
 * @property {ConditionState} [target]      The target's conditions
 * @property {boolean} [initiating]         Did the attacker initiate this combat?
 * @property {number} [distance]            Tiles between the two units
 * @property {boolean} [physical]           Is the attack resisted with DEF?
 * @property {string|null} [element]        The element of the attack, if it has one
 * @property {boolean} [noDodge]            Is the target unable to dodge for a reason other than a condition?
 * @property {number} [fcm]                 What the attacker's Critical is multiplied by before the target's
 *                                          Critical Avoid is taken off: its Follow-up Critical Multiplier, for
 *                                          a follow-up attack where the world plays with it
 */

/**
 * @typedef StrikeNote
 * Something a condition changed about a strike, for display.
 * @property {string} key       One of ranged, hitCap, noDodge, foeInitiating, taken, negates, multiplier, leech,
 *                              burst
 * @property {string} id        The condition responsible
 */

/**
 * @typedef TurnStart
 * @property {number} hpBefore
 * @property {number} hp                    HP after the damage of this turn start
 * @property {number} damage                HP lost
 * @property {number} [healed]              HP regained first, from a condition whose damage a skill turns around
 * @property {boolean} defeated             Did the damage bring the unit to 0 HP?
 * @property {{id: string, percent: number, damage: number, heals?: number, skills?: string[]}[]} ticks
 *                                          Damage dealt by each condition; `heals` when a skill turns it into
 *                                          HP regained, and `skills` names those that changed it
 * @property {{step: number, skill: string}} [quick]    Set when a skill has conditions lose more than a turn
 * @property {ConditionState} conditions    The unit's conditions afterwards
 * @property {{id: string, from: number, to: number}[]} reduced         Conditions that lost a turn
 * @property {string[]} ending              Conditions now in their last turn
 * @property {string[]} ended               Conditions that ended
 */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @typedef ConditionBends
 * How a unit's skills bend the rules of conditions, as `conditionBends` in `skills.mjs` gathers it.
 * @property {Record<string, number>} inflictChance     Added to the chances the unit has of inflicting each
 * @property {Record<string, number>} inflictTurns      Turns each lasts longer when the unit inflicts it
 * @property {{skill: string, percent: number, only?: "damaging"|string[]}[]} nullify
 *                                                      What may nullify a condition that would be applied to it
 * @property {Record<string, {damage: number, penalties: number, tick: number, stays: boolean,
 *   burst: string|null, damageBy: string[], penaltiesBy: string[]}>} suffers
 *                                                      What each condition does to the unit that has it: its
 *                                                      damage and its penalties multiplied, percent added to its
 *                                                      damage, whether it never runs out, the skill that makes
 *                                                      it hurt when it bursts, and the skills that changed its
 *                                                      damage and its penalties
 * @property {number} recovery                          Turns each condition loses as the unit's turn starts
 * @property {string} [recoveryBy]                      The skill that says so
 * @property {{stats: number, combat: number, negate: boolean, skills: string[]}} debuffs
 *                                                      What is taken off every penalty put on the unit
 * @property {Record<string, string>} burstHarm         The skill that makes each condition hurt its unit when
 *                                                      this unit bursts it
 */

/* -------------------------------------------- */

/**
 * The configuration of a condition, or nothing for an id that is not one.
 * @param {string} id
 * @returns {object|undefined}
 */
export function conditionConfig(id) {
  return Object.hasOwn(FEO.conditions, id) ? FEO.conditions[id] : undefined;
}

/* -------------------------------------------- */
/*  Durations                                   */
/* -------------------------------------------- */

/**
 * Read the conditions on a unit from its active effects.
 * The turns a condition has left are kept in a flag on its effect; an effect without one counts as fresh.
 * @param {Iterable<{statuses?: Iterable<string>, disabled?: boolean, active?: boolean, flags?: object}>} [effects]
 * @param {Iterable<string>} [statuses]   Status ids known to be active, for those without an effect of their own
 * @returns {ConditionState}
 */
export function readConditions(effects, statuses) {
  const state = {};
  for ( const effect of effects ?? [] ) {
    if ( effect.disabled || (effect.active === false) ) continue;
    const turns = effect.flags?.[FEO.id]?.turns;
    for ( const id of effect.statuses ?? [] ) {
      const config = conditionConfig(id);
      if ( !config ) continue;
      const left = Number.isInteger(turns) ? Math.max(turns, 0) : config.turns;
      state[id] = Math.max(state[id] ?? 0, left);
    }
  }
  for ( const id of statuses ?? [] ) {
    if ( conditionConfig(id) && !Object.hasOwn(state, id) ) state[id] = conditionConfig(id).turns;
  }
  return state;
}

/* -------------------------------------------- */

/**
 * The stack of a stacking condition, for the rules that count it. A condition in its last turn still counts
 * as one.
 * @param {number} turns    Turns the condition has left
 * @returns {number}
 */
export function stacksOf(turns) {
  return Math.max(turns, 1);
}

/* -------------------------------------------- */

/**
 * Apply a condition to a unit. Applying a condition the unit already has resets its time; for a condition
 * that stacks, the turns are added instead, up to its limit.
 * @param {ConditionState} state
 * @param {string} id
 * @param {object} [options]
 * @param {number} [options.turns]    Turns to apply, instead of the condition's usual amount
 * @returns {{state: ConditionState, turns: number|null, previous: number|null, stacked: boolean}}
 *   The new state, the turns the condition now has, the turns it had before, and whether it was added to
 */
export function applyCondition(state, id, { turns } = {}) {
  const config = conditionConfig(id);
  if ( !config ) return { state: { ...state }, turns: null, previous: null, stacked: false };
  const amount = Number.isInteger(turns) ? Math.max(turns, 0) : config.turns;
  const previous = Object.hasOwn(state, id) ? state[id] : null;
  const stacked = !!config.stacks && (previous !== null);
  let next = stacked ? previous + amount : amount;
  if ( config.stacks?.max != null ) next = Math.min(next, config.stacks.max);
  return { state: { ...state, [id]: next }, turns: next, previous, stacked };
}

/* -------------------------------------------- */
/*  The Unit's Turn                             */
/* -------------------------------------------- */

/**
 * The damage a condition deals at the start of a turn.
 * @param {string} id
 * @param {number} turns    Turns the condition has left, before this turn is counted
 * @param {number} hpMax    The unit's maximum HP
 * @param {{damage?: number, tick?: number}|null} [bend]    What the unit's skills make of it: percent added,
 *                                                          and what the damage is then multiplied by
 * @returns {{percent: number, damage: number, heals?: number}|null}    Null for a condition that deals none.
 *          A share of the damage is rounded down, the usual way; multiplied by less than 0 it heals instead
 */
export function tickDamage(id, turns, hpMax, bend = null) {
  const tick = conditionConfig(id)?.tick;
  if ( !tick ) return null;
  const percent = tick.percent + ((tick.perTurn ?? 0) * turns) + (bend?.tick ?? 0);
  const exact = (Math.max(hpMax, 0) * percent) / 100;
  const full = tick.round === "up" ? Math.ceil(exact) : Math.floor(exact);
  const factor = bend?.damage ?? 1;
  if ( factor === 1 ) return { percent, damage: full };
  const share = Math.floor((full * Math.abs(factor)) + 1e-9);
  return (factor < 0) ? { percent, damage: 0, heals: share } : { percent, damage: share };
}

/* -------------------------------------------- */

/**
 * A unit's turn starts. Conditions that deal damage do so, every condition loses a turn, and one that has
 * no turns left after that is in its last turn: it stays for this turn and ends with it.
 * A condition that was already in its last turn, and was not cleared when that turn ended, ends now.
 * @param {object} unit
 * @param {number} unit.hp                    Current HP
 * @param {number} unit.hpMax                 Maximum HP
 * @param {ConditionState} unit.conditions
 * @param {ConditionBends|null} [unit.bends]  How the unit's skills bend the rules of conditions: what each
 *                                            deals, whether it runs out, and how fast
 * @param {number} [unit.times]               What the damage the unit takes is multiplied by, as for a unit
 *                                            that is Staggered
 * @returns {TurnStart}
 */
export function startTurn({ hp, hpMax, conditions, bends = null, times = 1 }) {
  const next = {};
  const ticks = [];
  const reduced = [];
  const ending = [];
  const ended = [];
  const step = Math.max(Math.floor(bends?.recovery ?? 1), 1);
  let total = 0;
  let healing = 0;

  for ( const [id, turns] of Object.entries(conditions ?? {}) ) {
    const config = conditionConfig(id);
    if ( !config ) {
      next[id] = turns;
      continue;
    }
    if ( turns <= 0 ) {
      ended.push(id);
      continue;
    }
    const bend = bends?.suffers?.[id] ?? null;
    const tick = tickDamage(id, turns, hpMax, bend);
    if ( tick ) {
      if ( times !== 1 ) tick.damage = Math.floor((tick.damage * times) + 1e-9);
      const bent = !!bend && ((tick.heals !== undefined) || ((bend.damage ?? 1) !== 1) || !!bend.tick);
      ticks.push(bent ? { id, ...tick, skills: [...(bend.damageBy ?? [])] } : { id, ...tick });
      total += tick.damage;
      healing += tick.heals ?? 0;
    }
    if ( (config.countdown === false) || bend?.stays ) {
      next[id] = turns;
      continue;
    }
    next[id] = Math.max(turns - step, 0);
    reduced.push({ id, from: turns, to: next[id] });
    if ( next[id] === 0 ) ending.push(id);
  }

  // Healing comes before damage. A unit that is down neither heals nor is damaged
  const mended = hp > 0 ? Math.min(hp + healing, Math.max(hpMax, hp)) : hp;
  const after = hp > 0 ? Math.max(mended - total, 0) : hp;
  const result = {
    hpBefore: hp,
    hp: after,
    damage: mended - after,
    defeated: (hp > 0) && (after <= 0),
    ticks,
    conditions: next,
    reduced,
    ending,
    ended
  };
  if ( mended !== hp ) result.healed = mended - hp;
  if ( (step > 1) && reduced.length ) result.quick = { step, skill: bends.recoveryBy ?? "" };
  return result;
}

/* -------------------------------------------- */

/**
 * A unit's turn ends. Conditions that were in their last turn end.
 * @param {object} unit
 * @param {ConditionState} unit.conditions
 * @returns {{conditions: ConditionState, ended: string[]}}
 */
export function endTurn({ conditions }) {
  const next = {};
  const ended = [];
  for ( const [id, turns] of Object.entries(conditions ?? {}) ) {
    if ( conditionConfig(id) && (turns <= 0) ) ended.push(id);
    else next[id] = turns;
  }
  return { conditions: next, ended };
}

/* -------------------------------------------- */
/*  Stats                                       */
/* -------------------------------------------- */

/**
 * The flat adjustments a unit's conditions make to its stats and combat stats, including those that depend
 * on how many turns a condition has left.
 * @param {ConditionState} state
 * @returns {{id: string, stats: Record<string, number>|null, combat: Record<string, number>|null}[]}
 */
export function conditionModifiers(state) {
  const sources = [];
  for ( const [id, turns] of Object.entries(state ?? {}) ) {
    const config = conditionConfig(id);
    if ( !config ) continue;
    let stats = config.stats ? { ...config.stats } : null;
    for ( const [key, loss] of Object.entries(config.statLoss ?? {}) ) {
      const amount = Math.max(Math.floor(stacksOf(turns) * loss.perTurn), loss.min ?? 0);
      stats ??= {};
      stats[key] = (stats[key] ?? 0) - amount;
    }
    if ( !stats && !config.combat ) continue;
    sources.push({ id, stats, combat: config.combat ?? null });
  }
  return sources;
}

/* -------------------------------------------- */
/*  What a Unit Cannot Do                       */
/* -------------------------------------------- */

/**
 * The condition, if any, that stops a unit from using a weapon.
 * @param {ConditionState} state
 * @param {{category: string}|null} weapon
 * @returns {string|null}
 */
export function blocksWeapon(state, weapon) {
  if ( !weapon ) return null;
  for ( const id of Object.keys(state ?? {}) ) {
    const blocks = conditionConfig(id)?.blocks;
    if ( !blocks ) continue;
    if ( blocks.magic && FEO.weaponCategories[weapon.category]?.magic ) return id;
    if ( blocks.categories?.includes(weapon.category) ) return id;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * The condition, if any, that stops a unit from counter-attacking.
 * @param {ConditionState} state
 * @returns {string|null}
 */
export function heldBy(state) {
  return Object.keys(state ?? {}).find((id) => conditionConfig(id)?.noCounter) ?? null;
}

/* -------------------------------------------- */

/**
 * The conditions that limit what a unit can do, for reminders. A condition that only rules out certain
 * weapons is listed when the weapon in hand is one of them.
 * @param {ConditionState} state
 * @param {{category: string}|null} [weapon]    The weapon in hand
 * @returns {string[]}
 */
export function restrictions(state, weapon = null) {
  const blocking = blocksWeapon(state, weapon);
  return Object.keys(state ?? {}).filter((id) => {
    const config = conditionConfig(id);
    if ( !config ) return false;
    if ( config.noMove || config.noAct || config.moveOrAct || config.noCounter || config.noDodge ) return true;
    return !!config.limits || (id === blocking);
  });
}

/* -------------------------------------------- */
/*  Weapons                                     */
/* -------------------------------------------- */

/**
 * The element of a weapon's attacks: its category when that is an element, otherwise the element its Effect
 * names for the magic weapon triangle.
 * @param {{category?: string, effect?: string}|null} weapon
 * @returns {string|null}
 */
export function attackElement(weapon) {
  if ( !weapon ) return null;
  if ( FEO.attackElements.includes(weapon.category) ) return weapon.category;
  const named = /([a-z]+)\s+for\s+magic(?:al)?\s+weapon/i.exec(weapon.effect ?? "")?.[1].toLowerCase();
  return FEO.attackElements.includes(named) ? named : null;
}

/* -------------------------------------------- */

/**
 * The names a weapon's Effect may use for a condition: its own, and any aliases.
 * @param {string} id
 * @returns {string[]}
 */
export function conditionNames(id) {
  const name = id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return [name, ...(conditionConfig(id)?.aliases ?? []).map((alias) => alias.toLowerCase())];
}

/* -------------------------------------------- */

/**
 * The conditions a weapon inflicts on a hit: those its Effect names in a clause of their own, such as
 * "Poison", "33% to Burn", "15% to inflict Foam" or "33% to inflict 1d2 Tremor". A condition that is only
 * mentioned as part of a longer sentence is not inflicted.
 * @param {string} [effect]   The weapon's Effect
 * @returns {Infliction[]}
 */
export function inflictions(effect) {
  if ( !effect ) return [];
  const ids = new Map();
  for ( const id of Object.keys(FEO.conditions) ) {
    for ( const name of conditionNames(id) ) ids.set(name, id);
  }
  const names = Array.from(ids.keys()).sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"));
  const clause = new RegExp(
    "^(?:(\\d+)\\s*%\\s*(?:chance\\s+)?(?:to\\s+)?)?"
    + "(?:(?:inflicts?|target\\s+is\\s+afflicted\\s+with|targets?\\s+gets?\\s+the)\\s+)?"
    + "(?:\\d*d(\\d+)\\s+)?"
    + `(${names.join("|")})`
    + "(?:\\s+condition)?(?:\\s+target(?:\\s+and\\b.*)?)?(\\s+otherwise)?$",
    "i"
  );

  const found = [];
  for ( const part of effect.split(/[,.;\n]/) ) {
    const match = clause.exec(part.trim());
    if ( !match ) continue;
    const id = ids.get(match[3].toLowerCase().replace(/\s+/g, " "));
    if ( found.some((infliction) => infliction.id === id) ) continue;
    found.push({
      id,
      chance: match[1] ? clamp(Number(match[1]), 0, 100) : 100,
      dice: match[2] ? Number(match[2]) : null,
      otherwise: !!match[4]
    });
  }
  return found;
}

/* -------------------------------------------- */
/*  Nullifying                                  */
/* -------------------------------------------- */

/**
 * Does something that may nullify conditions cover this one? One marked "damaging" covers the conditions that
 * deal damage at the start of a turn; a list covers those it names; anything else covers them all.
 * @param {{only?: "damaging"|string[]}} ward
 * @param {string} id
 * @returns {boolean}
 */
export function guards(ward, id) {
  if ( !ward?.only ) return true;
  if ( ward.only === "damaging" ) return !!conditionConfig(id)?.tick;
  return [].concat(ward.only).includes(id);
}

/* -------------------------------------------- */

/**
 * A condition would be applied to a unit: what may nullify it is tried in turn, until something does. A chance
 * of 100% rolls nothing.
 * @param {{skill: string, percent: number, only?: "damaging"|string[]}[]} [wards]    What the unit's skills say
 * @param {string} id
 * @param {() => number} d100             Returns a whole number from 1 to 100
 * @returns {{skill: string, roll: number|null, chance: number, success: boolean}[]}
 *          What was tried, in order; the condition is nullified when the last of them succeeded
 */
export function wardOff(wards, id, d100) {
  const tried = [];
  for ( const ward of wards ?? [] ) {
    if ( !(ward.percent > 0) || !guards(ward, id) ) continue;
    const chance = Math.min(ward.percent, 100);
    const roll = (chance >= 100) ? null : d100();
    const success = (roll === null) || (roll <= chance);
    tried.push({ skill: ward.skill, roll, chance, success });
    if ( success ) break;
  }
  return tried;
}

/* -------------------------------------------- */
/*  The Exchange                                */
/* -------------------------------------------- */

/**
 * Is an attack of one of the listed kinds?
 * @param {string[]} kinds                A list of `physical`, elements, or `any`
 * @param {StrikeContext} strike
 * @returns {boolean}
 */
function ofKind(kinds, { physical, element }) {
  return kinds.includes("any") || (!!physical && kinds.includes("physical")) || (!!element && kinds.includes(element));
}

/* -------------------------------------------- */

/**
 * Work out one strike's chances and damage from the numbers the two units bring to the exchange and the
 * conditions each of them has as the strike is made.
 * @param {object} base
 * @param {number} base.accuracy      The attacker's Accuracy, with the weapon triangle
 * @param {number} base.dodge         The target's Dodge
 * @param {number} base.critical      The attacker's Critical
 * @param {number} base.critAvoid     The target's Critical Avoid
 * @param {number} base.damage        The attacker's damage less the target's defence and Endurance, which may
 *                                    be below 0
 * @param {StrikeContext} [context]
 * @returns {{hit: number, crit: number, damage: number, notes: StrikeNote[]}}
 */
export function strikeNumbers(base, context = {}) {
  const { attacker = {}, target = {}, initiating = false, distance = 1, element = null, physical = false } = context;
  const notes = [];
  let accuracy = base.accuracy;
  let critical = base.critical;
  let cap = 100;
  let dodges = !context.noDodge;
  let taken = 0;
  let multiplier = 1;
  let negated = false;

  for ( const id of Object.keys(attacker) ) {
    const config = conditionConfig(id);
    if ( !config ) continue;
    if ( config.ranged && (distance >= config.ranged.from) ) {
      accuracy += config.ranged.hit;
      notes.push({ key: "ranged", id, hit: config.ranged.hit });
    }
    if ( config.hitCap != null ) {
      cap = Math.min(cap, config.hitCap);
      notes.push({ key: "hitCap", id, cap: config.hitCap });
    }
  }

  for ( const [id, turns] of Object.entries(target) ) {
    const config = conditionConfig(id);
    if ( !config ) continue;
    if ( config.noDodge ) {
      dodges = false;
      notes.push({ key: "noDodge", id });
    }
    if ( initiating && config.foeInitiating ) {
      accuracy += config.foeInitiating.hit ?? 0;
      critical += config.foeInitiating.critical ?? 0;
      notes.push({ key: "foeInitiating", id, hit: config.foeInitiating.hit ?? 0, critical: config.foeInitiating.critical ?? 0 });
    }
    if ( element && config.taken?.[element] ) {
      taken += config.taken[element];
      notes.push({ key: "taken", id, amount: config.taken[element], element });
    }
    if ( element && config.negates?.includes(element) ) {
      negated = true;
      notes.push({ key: "negates", id, element });
    }
    if ( physical && config.takenMultiplier?.physical ) {
      multiplier *= config.takenMultiplier.physical;
      notes.push({ key: "multiplier", id, multiplier: config.takenMultiplier.physical });
    }
    if ( config.leech ) notes.push({ key: "leech", id, percent: config.leech });
    if ( config.burst && ofKind([config.burst.on], context) ) {
      notes.push({ key: "burst", id, chance: Math.min(config.burst.chancePerTurn * stacksOf(turns), 100) });
    }
  }

  return {
    hit: Math.min(clamp(accuracy - (dodges ? base.dodge : 0), 0, 100), cap),
    crit: clamp((critical * (context.fcm ?? 1)) - base.critAvoid, 0, 100),
    damage: negated ? 0 : Math.max(base.damage + taken, 0) * multiplier,
    notes
  };
}

/* -------------------------------------------- */

/**
 * The conditions a unit is left with once a hit has ended those that end on being hit.
 * @param {ConditionState} state
 * @param {StrikeContext} strike
 * @returns {{state: ConditionState, ended: string[]}}
 */
export function endOnHit(state, strike) {
  const next = {};
  const ended = [];
  for ( const [id, turns] of Object.entries(state ?? {}) ) {
    const kinds = conditionConfig(id)?.endsOnHit;
    if ( kinds && ofKind(kinds, strike) ) ended.push(id);
    else next[id] = turns;
  }
  return { state: next, ended };
}

/* -------------------------------------------- */

/**
 * Work out what a hit does to the conditions of its target, in this order: damage taken heals the attacker
 * where a condition says so, conditions that end on being hit end, a condition that can burst may do so, and
 * the weapon inflicts its own.
 * @param {ConditionState} target         The target's conditions before the hit
 * @param {object} hit
 * @param {boolean} [hit.physical]        Is the attack resisted with DEF?
 * @param {string|null} [hit.element]     The element of the attack
 * @param {number} hit.damage             HP the target lost
 * @param {boolean} [hit.alive=true]      Does the target still have HP?
 * @param {Infliction[]} [hit.inflicts]   What the weapon inflicts; `more` on one adds turns to it
 * @param {object[]} [hit.wards]          What may nullify a condition that would be applied to the target
 * @param {Record<string, string>} [hit.burstHarm]    The attacker's skills that make a condition it bursts
 *                                        deal damage, by condition
 * @param {Record<string, object>} [hit.suffers]      What the target's skills, and what was left on it, make
 *                                        of each of its conditions
 * @param {() => number} d100             Returns a whole number from 1 to 100
 * @returns {{
 *   target: ConditionState,
 *   ended: string[],
 *   burst: {id: string, roll: number, chance: number, success: boolean, inflicts: string, push: number,
 *     harm?: number, skill?: string, warded?: object[]}|null,
 *   inflicted: {id: string, chance: number, roll: number|null, success: boolean, turns?: number,
 *     previous?: number|null, stacked?: boolean, combatOnly?: boolean, warded?: object[]}[],
 *   leech: number,
 *   held: boolean
 * }}   The target's conditions afterwards, what ended, burst and was inflicted, the HP returned to the
 *      attacker, and whether the target can make no further attacks in this exchange. A burst that a skill
 *      makes hurt has `harm`, the damage it deals, and `skill`; `warded` lists what was tried to nullify a
 *      condition, which was not applied when the last of it succeeded
 */
export function resolveHit(target, hit, d100) {
  const { physical = false, element = null, damage, alive = true, inflicts = [], wards = [], burstHarm = null, suffers = null } = hit;
  const strike = { physical, element };
  const inflicted = [];
  let burst = null;
  let held = false;

  let leech = 0;
  for ( const id of Object.keys(target ?? {}) ) {
    const share = conditionConfig(id)?.leech;
    if ( share ) leech += Math.floor((damage * share) / 100);
  }

  let { state, ended } = endOnHit(target, strike);
  if ( !alive ) return { target: state, ended, burst, inflicted, leech, held };

  for ( const [id, turns] of Object.entries(state) ) {
    const config = conditionConfig(id)?.burst;
    if ( !config || !(damage > 0) || !ofKind([config.on], strike) ) continue;
    const chance = Math.min(config.chancePerTurn * stacksOf(turns), 100);
    const roll = d100();
    burst = { id, roll, chance, success: roll <= chance, inflicts: config.inflicts, push: config.push ?? 0 };
    if ( !burst.success ) continue;

    // A skill may make the burst hurt, by as much as the condition had turns left: one of the unit that
    // bursts it, or one of the unit that inflicted it, which left its mark on the target
    const harming = burstHarm?.[id] ?? suffers?.[id]?.burst ?? null;
    if ( harming ) Object.assign(burst, { harm: stacksOf(turns), skill: harming });
    delete state[id];
    ended.push(id);
    if ( config.inflicts ) {
      const warded = wardOff(wards, config.inflicts, d100);
      if ( warded.length ) burst.warded = warded;
      if ( warded.at(-1)?.success ) continue;
      state = applyCondition(state, config.inflicts).state;
      if ( conditionConfig(config.inflicts)?.noCounter ) held = true;
    }
  }

  let missed = false;
  for ( const entry of inflicts ) {
    const config = conditionConfig(entry.id);
    if ( !config || (entry.otherwise && !missed) ) continue;
    let chance = entry.chance;
    if ( chance < 100 ) {
      for ( const id of Object.keys(state) ) chance += conditionConfig(id)?.chanceAgainst?.[entry.id] ?? 0;
      chance = Math.min(chance, 100);
    }
    const roll = chance < 100 ? d100() : null;
    const success = (roll === null) || (roll <= chance);
    missed = !success;
    if ( !success ) {
      inflicted.push({ id: entry.id, chance, roll, success });
      continue;
    }

    // What guards the target may nullify the condition
    const warded = wardOff(wards, entry.id, d100);
    const tried = warded.length ? { warded } : {};
    if ( warded.at(-1)?.success ) {
      inflicted.push({ id: entry.id, chance, roll, success: false, warded });
      continue;
    }
    if ( config.noCounter ) held = true;
    if ( config.combatOnly ) {
      inflicted.push({ id: entry.id, chance, roll, success, combatOnly: true, ...tried });
      continue;
    }
    let turns = entry.dice ? Math.max(Math.ceil((d100() * entry.dice) / 100), 1) : (entry.turns ?? undefined);
    if ( entry.more ) turns = (turns ?? config.turns) + entry.more;
    const applied = applyCondition(state, entry.id, { turns });
    state = applied.state;
    inflicted.push({
      id: entry.id,
      chance,
      roll,
      success,
      turns: applied.turns,
      previous: applied.previous,
      stacked: applied.stacked,
      ...tried
    });
  }

  return { target: state, ended, burst, inflicted, leech, held };
}

/**
 * Rescue: a unit picks up an ally next to it and carries it. Pure functions of plain data, so that they can be
 * tested outside of Foundry.
 *
 * Rescue is a command every unit has. A unit may pick up an ally whose Weight is no more than its own. While
 * it carries that ally its DEX and SPD are halved, and the ally is off the map: it holds no tile, is in nobody's
 * way, gives and receives nothing, cannot be targeted and cannot act. Four commands go with it:
 *
 *   Rescue    pick up an ally next to the unit                              the unit's Action
 *   Drop      set the ally down on a free tile next to the unit             the unit's Action
 *   Give      hand the ally to an ally next to the unit that can carry it   free, but the unit moves no further
 *   Take      take over the ally that an ally next to the unit carries      free, but the unit moves no further
 *
 * A carrier that can carry no longer sets its ally down by itself: on a random free tile next to it when it is
 * Incapacitated, on its own tile when it dies, retreats or is captured, and on the nearest tile the ally can
 * stand on where it cannot stand there.
 *
 * A captive is carried in the same way (see `capturing.mjs`): the same halving, on the same token. It is not
 * dropped, given or taken, though: its captor releases it, and it leaves the map.
 *
 * A skill changes all this with a `carry` part, which like `shove` is always there:
 *
 *   carry: { weight: 6 }        // its unit counts as this much heavier when it picks a unit up or captures one
 *   carry: { free: true }       // its unit has no penalty from carrying a unit, nor from an attempt to capture
 *   carry: { light: true }      // a unit that carries this one has no penalty from it
 *   carry: { heals: 15 }        // the ally it carries regains this share of its HP as each of its turns starts
 *   carry: { drops: { effects: [...], ends: "turnStart" } }     // a change that lasts on the ally it sets down
 *   carry: { saves: true }      // it may come for an ally within its movement that an attack would defeat:
 *                               // the ally is left with 1 HP and carried off, whatever it weighs
 *
 * @import {ForcedField} from "./forced.mjs"
 * @import {Reach, Tile} from "./reach.mjs"
 */
import { FEO } from "../config.mjs";
import { beside, refuses } from "./forced.mjs";
import { tileKey, tilesApart } from "./reach.mjs";

/** What the `carry` part of an effect can say. */
export const CARRY_PARTS = ["weight", "free", "light", "heals", "drops", "saves"];

/** What a change that lasts on a unit which is set down can say. */
export const DROP_PARTS = ["name", "effects", "ends", "turns"];

/** Is a word found in a text, standing by itself? */
function names(text, word) {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(text ?? "");
}

/* -------------------------------------------- */
/*  What Skills Make of It                      */
/* -------------------------------------------- */

/**
 * @typedef Carrying
 * What a unit's skills make of carrying a unit, and of being carried.
 * @property {number} weight          Weight it counts as having on top when it picks a unit up
 * @property {boolean} free           Does carrying a unit cost it nothing?
 * @property {boolean} light          Does carrying it cost its carrier nothing?
 * @property {number} heals           The share of its HP, in percent, that the ally it carries regains as each
 *                                    of that ally's turns starts
 * @property {{skill: string, name?: string, effects: object[], ends: string, turns?: number}[]} drops
 *                                    Changes that last on the ally it sets down
 * @property {boolean} saves          May it come for an ally that an attack would defeat?
 * @property {{weight: string[], free: string, light: string, heals: string, saves: string}} skills
 *                                    The skills that give it each
 */

/**
 * What carrying comes to for a unit without a skill that changes it.
 * @returns {Carrying}
 */
export function emptyCarry() {
  return { weight: 0, free: false, light: false, heals: 0, drops: [], saves: false, skills: { weight: [], free: "", light: "", heals: "", saves: "" } };
}

/* -------------------------------------------- */

/**
 * Add what one skill makes of carrying: Weight adds up, and of several shares of healing the highest counts.
 * @param {Carrying} total
 * @param {object} part               The `carry` part of an effect
 * @param {object} [options]
 * @param {string} [options.skill]    The skill it comes from
 * @returns {Carrying}                `total`, changed
 */
export function addCarry(total, part, { skill = "" } = {}) {
  if ( Number.isFinite(part?.weight) && part.weight ) {
    total.weight += part.weight;
    total.skills.weight.push(skill);
  }
  for ( const key of ["free", "light", "saves"] ) {
    if ( (part?.[key] !== true) || total[key] ) continue;
    total[key] = true;
    total.skills[key] = skill;
  }
  if ( Number.isFinite(part?.heals) && (part.heals > total.heals) ) {
    total.heals = part.heals;
    total.skills.heals = skill;
  }
  if ( Array.isArray(part?.drops?.effects) && part.drops.effects.length ) total.drops.push({ ...part.drops, skill });
  return total;
}

/* -------------------------------------------- */

/**
 * What carrying a unit does to its carrier, as one more skill of its own: its DEX and SPD are halved.
 * @param {string} [name]     What it goes by among the unit's numbers
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}}
 */
export function carryEntry(name = "Rescue") {
  return { name, innate: true, nihil: false, effects: [{ statPercent: { ...FEO.rescue.carry } }] };
}

/* -------------------------------------------- */

/**
 * Is a carrier slowed by the unit it carries? Not one whose skills make nothing of the load, nor one that
 * carries a unit which is no load to anyone.
 * @param {Carrying|null} [carrier]     What the carrier's skills make of carrying
 * @param {boolean} [light]             Is the unit it carries no load, as its own skills have it?
 * @returns {boolean}
 */
export function burdened(carrier = null, light = false) {
  return !carrier?.free && !light;
}

/* -------------------------------------------- */
/*  Who Is Picked Up                            */
/* -------------------------------------------- */

/**
 * The Weight a unit counts as having when it picks a unit up, to Rescue it or to capture it.
 * @param {number} weight               Its Weight
 * @param {Carrying|null} [carry]       What its skills make of carrying
 * @returns {number}
 */
export function liftWeight(weight, carry = null) {
  return (Number(weight) || 0) + (carry?.weight ?? 0);
}

/* -------------------------------------------- */

/**
 * @typedef RescueCheck
 * @property {boolean} ok
 * @property {"self"|"holding"|"out"|"side"|"apart"|"carrying"|"quality"|"rooted"|"weight"|null} why
 *                                      Why not, when it may not
 * @property {string[]} [qualities]     The Special Qualities that keep the unit from being picked up
 */

/**
 * May a unit pick up another, to Rescue it or to take it over from the unit that carries it?
 * @param {object} unit                       The unit that would carry
 * @param {Tile} [unit.tile]
 * @param {number} unit.weight
 * @param {Carrying|null} [unit.carry]        What its skills make of carrying
 * @param {boolean} [unit.holds]              Does it carry a unit already, or hold a captive?
 * @param {object} target                     The unit that would be carried
 * @param {Tile} [target.tile]
 * @param {number} target.weight
 * @param {"friend"|"foe"|"apart"|"self"} target.relation     How the unit stands to it
 * @param {string} [target.qualities]         Its Special Qualities, as free text
 * @param {Iterable<string>|null} [target.rules]      The rules its skills give it
 * @param {boolean} [target.carries]          Does it carry a unit itself, or hold a captive?
 * @param {boolean} [target.out]              Is it out of the fight?
 * @param {object} [options]
 * @param {boolean} [options.near]            Must the two stand next to each other? Not so for a unit that is
 *                                            handed over, which is next to nobody
 * @param {boolean} [options.weigh]           Does its Weight count? Not for a unit a skill has carried off
 * @returns {RescueCheck}
 */
export function canRescue(unit, target, { near = true, weigh = true } = {}) {
  const no = (why, more = {}) => ({ ok: false, why, ...more });
  if ( target?.relation === "self" ) return no("self");
  if ( unit?.holds ) return no("holding");
  if ( target?.out ) return no("out");
  if ( target?.relation !== "friend" ) return no("side");
  if ( near && (!unit?.tile || !target?.tile || (tilesApart(unit.tile, target.tile) !== 1)) ) return no("apart");
  if ( target.carries ) return no("carrying");
  const barred = FEO.rescue.barred.filter((quality) => names(target.qualities, quality));
  if ( barred.length ) return no("quality", { qualities: barred });
  if ( refuses(target.rules, target.relation) ) return no("rooted");
  if ( weigh && (liftWeight(unit?.weight, unit?.carry) < (Number(target.weight) || 0)) ) return no("weight");
  return { ok: true, why: null };
}

/* -------------------------------------------- */
/*  Where It Is Set Down                        */
/* -------------------------------------------- */

/**
 * Could a unit be set down on a tile: one of the map, whose ground it could stand on, that nobody holds?
 * @param {Tile} tile
 * @param {ForcedField} field     The map, as the unit that is set down would stand on it
 * @returns {boolean}
 */
export function landsOn(tile, field) {
  return field.inside(tile) && field.stands(tile) && !field.taken(tile);
}

/* -------------------------------------------- */

/**
 * The tiles a carrier may Drop the unit it carries on: those next to it that the unit could stand on, with
 * nobody there and no wall between.
 * @param {Tile} centre           The carrier's tile
 * @param {ForcedField} field     The map, as the unit that is carried would stand on it
 * @returns {Tile[]}
 */
export function dropTiles(centre, field) {
  return beside(centre, field);
}

/* -------------------------------------------- */

/**
 * The tile nearest to another that a unit could be set down on, counted along rows and columns, whatever lies
 * between. Of several as near, the first going round from the top.
 * @param {Tile} centre
 * @param {ForcedField} field
 * @param {number} [most]         How far to look
 * @returns {Tile|null}           Null for a map with no room at all
 */
export function nearestFree(centre, field, most = 40) {
  for ( let apart = 0; apart <= most; apart++ ) {
    for ( let di = -apart; di <= apart; di++ ) {
      const dj = apart - Math.abs(di);
      for ( const tile of (dj ? [{ i: centre.i + di, j: centre.j + dj }, { i: centre.i + di, j: centre.j - dj }] : [{ i: centre.i + di, j: centre.j }]) ) {
        if ( landsOn(tile, field) ) return tile;
      }
    }
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Where a unit that was carried lands when it is set down without anybody picking the tile: as its carrier
 * falls, or as a skill has it dropped.
 * @param {Tile} centre                   The carrier's tile
 * @param {ForcedField} field             The map, as the unit that was carried would stand on it
 * @param {object} [options]
 * @param {boolean} [options.beside]      Is it set down next to its carrier, on a tile picked by a die? So it
 *                                        is for a carrier that still lies or stands on its own tile
 * @param {(count: number) => number} [options.pick]      Picks one of so many, from 0
 * @returns {Tile|null}                   Null for a map with no room at all
 */
export function landing(centre, field, { beside: next = false, pick = () => 0 } = {}) {
  if ( next ) {
    const tiles = dropTiles(centre, field);
    if ( tiles.length ) return tiles[Math.min(Math.max(Math.floor(pick(tiles.length)), 0), tiles.length - 1)];
    const far = { ...field, taken: (tile) => (tileKey(tile) === tileKey(centre)) || field.taken(tile) };
    return nearestFree(centre, far);
  }
  return nearestFree(centre, field);
}

/* -------------------------------------------- */
/*  While It Is Carried                         */
/* -------------------------------------------- */

/**
 * The HP a unit that is carried regains as its turn starts, as a skill of its carrier has it.
 * @param {number} hpMax        Its maximum HP
 * @param {number} percent      The share it regains
 * @returns {number}
 */
export function carriedHeal(hpMax, percent) {
  if ( !(percent > 0) || !(hpMax > 0) ) return 0;
  return Math.max(Math.floor(((hpMax * percent) / 100) + 1e-9), 1);
}

/* -------------------------------------------- */
/*  Coming for an Ally                          */
/* -------------------------------------------- */

/**
 * The tiles a unit could come to an ally on: those next to the ally that it can stop on with its movement, the
 * one it stands on included, the nearest first.
 * @param {Tile} here           Where the unit stands
 * @param {Tile} there          Where the ally stands
 * @param {Reach} reach         Where the unit can go from where it stands
 * @returns {Tile[]}
 */
export function comesFor(here, there, reach) {
  if ( tilesApart(here, there) === 1 ) return [{ i: here.i, j: here.j }];
  const tiles = [];
  for ( const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]] ) {
    const tile = { i: there.i + di, j: there.j + dj };
    if ( reach.stops.has(tileKey(tile)) ) tiles.push(tile);
  }
  const cost = (tile) => reach.cost.get(tileKey(tile)) ?? Infinity;
  return tiles.sort((a, b) => cost(a) - cost(b));
}

/* -------------------------------------------- */

/**
 * Did the last attack of a fight defeat a unit? That is the blow a unit which comes for an ally answers: a
 * unit brought down by anything else, as by a skill's damage, is not saved from it.
 * @param {import("./combat.mjs").ExchangeResult} result
 * @returns {"initiator"|"defender"|null}     The side that was defeated by it
 */
export function felledBy(result) {
  const last = result?.attacks?.at(-1);
  if ( !last?.kill ) return null;
  const side = (last.side === "initiator") ? "defender" : "initiator";
  return result[side]?.defeated ? side : null;
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check how a skill says it changes carrying, so that a typing mistake does not pass silently. The effects of
 * a change it leaves on the unit that is set down are checked with all others (see `checkEffects`).
 * @param {any} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkCarry(part) {
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ["carry must say what the skill changes about carrying a unit"];
  const problems = [];
  const keys = Object.keys(part);
  for ( const key of keys ) if ( !CARRY_PARTS.includes(key) ) problems.push(`carry cannot say "${key}"`);
  if ( !keys.length ) problems.push("carry must say what the skill changes about carrying a unit");
  if ( (part.weight !== undefined) && !(Number.isInteger(part.weight) && (part.weight !== 0)) ) problems.push("the Weight a unit counts as having on top is a whole number");
  for ( const key of ["free", "light", "saves"] ) {
    if ( (part[key] !== undefined) && (part[key] !== true) ) problems.push(`the "${key}" of carry is true, not "${part[key]}"`);
  }
  if ( (part.heals !== undefined) && !(Number.isFinite(part.heals) && (part.heals > 0) && (part.heals <= 100)) ) {
    problems.push("the HP a carried ally regains is a share in percent");
  }
  if ( part.drops !== undefined ) {
    const drops = part.drops;
    if ( !drops || (typeof drops !== "object") || !Array.isArray(drops.effects) || !drops.effects.length ) {
      problems.push("what lasts on a unit that is set down has effects");
    }
    else {
      for ( const key of Object.keys(drops) ) if ( !DROP_PARTS.includes(key) ) problems.push(`what lasts on a unit that is set down cannot say "${key}"`);
      if ( !["turnStart", "turnEnd"].includes(drops.ends) ) problems.push("what lasts on a unit that is set down ends at its \"turnStart\" or \"turnEnd\"");
      if ( (drops.turns !== undefined) && !(Number.isInteger(drops.turns) && (drops.turns >= 1)) ) problems.push("the turns such a change lasts are a whole number");
    }
  }
  return problems;
}

import { FEO } from "../config.mjs";
import { cooldownsFor } from "./affinity.mjs";
import { tileKey, tilesApart } from "../rules/reach.mjs";
import { canRescue, carriedHeal, comesFor, dropTiles, landing, liftWeight } from "../rules/rescue.mjs";
import { canUse, spendSkill } from "../rules/skill-usage.mjs";
import { buildChange } from "../rules/timed.mjs";
import { standMove, turnEnded } from "./acting.mjs";
import { answersAlone } from "./answers.mjs";
import { forcedField, reachOf, unitsOn } from "./battle-map.mjs";
import { grantUnit, healUnit, pop } from "./events.mjs";
import { tokenTile } from "./exchange.mjs";
import { moveUnits, relationTo, steps } from "./forced.mjs";
import { endMove, originOf, takeAction, turnState, unitsOf } from "./phases.mjs";
import { awardEvent } from "./supports.mjs";
import { endTurnOf } from "./turns.mjs";

/**
 * Rescue in Foundry: one unit picks up an ally and carries it, by the rules of `rules/rescue.mjs`. The four
 * commands of the map (Rescue, Drop, Give and Take), what becomes of a unit whose carrier falls, and a skill
 * that has its unit come for an ally as a blow would defeat it.
 *
 * Who carries whom is kept on both units (`system.rescuing` on the carrier, `system.rescued` on the unit it
 * carries). A unit that is carried is out of the fight for as long as it is (`system.defeat.out`): the map
 * leaves it out of everything, and its token is not drawn but shown as a small portrait on its carrier's. The
 * token itself is kept under its carrier's, so that it is where its unit is when it is set down again.
 *
 * A player may pick up, hand over or set down a unit that is not theirs. Whatever changes a unit this user
 * does not own is asked of a Game Master.
 *
 * @import {RescueCheck} from "../rules/rescue.mjs"
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The name of the query that asks a Game Master to have one unit pick up, hand over or set down another. */
export const CARRY_QUERY = `${FEO.id}.carry`;

/** The name of the query that offers something on the map of the user who acts for a unit, and brings back the answer. */
export const OFFER_QUERY = `${FEO.id}.offer`;

/** The name of the hook called once a unit was picked up, handed over or set down: with the two tokens and what happened. */
export const CARRY_HOOK = `${FEO.id}.unitCarried`;

const NOBODY = { uuid: "", token: "", name: "", light: false, over: false };
const NO_CARRIER = { by: "", token: "", name: "" };

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

const nameOf = (token) => token?.name || token?.actor?.name || "";

/**
 * The tile a token stands on.
 * @param {TokenDocument|null} token
 * @returns {Tile|null}
 */
function tileOf(token) {
  const tile = tokenTile(token);
  return tile ? { i: tile.i, j: tile.j } : null;
}

/* -------------------------------------------- */

/**
 * A document by its UUID, if it is at hand.
 * @param {string} uuid
 * @returns {Document|null}
 */
function found(uuid) {
  if ( !uuid ) return null;
  try {
    return foundry.utils.fromUuidSync(uuid) ?? null;
  } catch(err) {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * The ally a unit carries.
 * @param {Actor|null} actor
 * @returns {{token: TokenDocument|null, actor: Actor|null, name: string, over: boolean}|null}    Null for a
 *          unit that carries nobody
 */
export function passengerOf(actor) {
  const held = actor?.system?.rescuing;
  if ( !held?.uuid && !held?.token ) return null;
  const token = found(held.token);
  const rider = token?.actor ?? found(held.uuid);
  return { token: (token?.documentName === "Token") ? token : null, actor: (rider?.documentName === "Actor") ? rider : null, name: held.name ?? "", over: !!held.over };
}

/* -------------------------------------------- */

/**
 * The unit that carries a unit.
 * @param {Actor|null} actor
 * @returns {{token: TokenDocument|null, actor: Actor|null, name: string}|null}   Null for a unit nobody carries
 */
export function carrierOf(actor) {
  const held = actor?.system?.rescued;
  if ( !held?.by && !held?.token ) return null;
  const token = found(held.token);
  const carrier = token?.actor ?? found(held.by);
  return { token: (token?.documentName === "Token") ? token : null, actor: (carrier?.documentName === "Actor") ? carrier : null, name: held.name ?? "" };
}

/* -------------------------------------------- */

/**
 * Is a unit carried by an ally that Rescued it?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isCarried(actor) {
  return !!actor?.system?.rescued?.by;
}

/* -------------------------------------------- */

/**
 * Does a unit have its hands full: with an ally it carries, or with a captive it holds or has yet to pick up?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function handsFull(actor) {
  const system = actor?.system;
  return !!system?.rescuing?.uuid || !!system?.rescuing?.token || !!system?.captive?.uuid;
}

/* -------------------------------------------- */

/**
 * Whom a unit has on its token, to show there: the ally it carries, or the captive it holds.
 * @param {Actor|null} actor
 * @returns {{name: string, img: string, captive: boolean}|null}
 */
export function riderOf(actor) {
  const system = actor?.system;
  const rider = passengerOf(actor);
  if ( rider ) {
    return { name: rider.name, img: rider.token?.texture?.src || rider.actor?.prototypeToken?.texture?.src || rider.actor?.img || "", captive: false };
  }
  if ( !FEO.optional.capturing.enabled || !system?.captive?.held || !system.captive.uuid ) return null;
  const captive = found(system.captive.uuid);
  const token = captive?.token ?? captive?.getActiveTokens?.(false, true)?.[0] ?? null;
  return { name: system.captive.name ?? "", img: token?.texture?.src || captive?.prototypeToken?.texture?.src || captive?.img || "", captive: true };
}

/* -------------------------------------------- */

/**
 * Is a unit on a map of square tiles, in the fight, so that it can pick a unit up?
 * @param {TokenDocument|null} token
 * @returns {boolean}
 */
function stands(token) {
  return !!token?.parent?.grid?.isSquare && (token.actor?.type === "unit") && !token.actor.system.defeat?.out && !!tokenTile(token);
}

/* -------------------------------------------- */

/**
 * A unit as the rules of Rescue read the one that would carry.
 * @param {TokenDocument} token
 * @returns {object}
 */
function lifter(token) {
  const system = token.actor.system;
  return { tile: tileOf(token), weight: system.wt?.total ?? 0, carry: system.carry ?? null, holds: handsFull(token.actor) };
}

/* -------------------------------------------- */

/**
 * A unit as the rules of Rescue read the one that would be carried.
 * @param {TokenDocument} by          The unit that would carry it
 * @param {TokenDocument} token
 * @param {object} [options]
 * @param {boolean} [options.riding]  Is it carried already, by the unit it is taken over from?
 * @returns {object}
 */
function liftee(by, token, { riding = false } = {}) {
  const system = token.actor.system;
  return {
    tile: tileOf(token),
    weight: system.wt?.total ?? 0,
    relation: relationTo(by, token),
    qualities: system.specialQualities ?? "",
    rules: system.skills?.rules ?? [],
    carries: handsFull(token.actor),
    out: riding ? !!system.defeat?.state && (system.defeat.state !== "incapacitated") : !!system.defeat?.out
  };
}

/* -------------------------------------------- */
/*  What a Unit May Do                          */
/* -------------------------------------------- */

/**
 * May a unit Rescue another, as they stand?
 * @param {TokenDocument} token       The unit that would carry
 * @param {TokenDocument} target      The ally it would pick up
 * @param {object} [options]          As for `canRescue`
 * @returns {RescueCheck|null}        Null for two units that are not both on one map
 */
export function rescueOf(token, target, options = {}) {
  if ( !stands(token) || !target?.actor || (token === target) || (token.parent !== target.parent) ) return null;
  return canRescue(lifter(token), liftee(token, target), options);
}

/* -------------------------------------------- */

/**
 * The allies next to a unit that it may Rescue.
 * @param {TokenDocument} token
 * @returns {TokenDocument[]}
 */
export function rescuesOf(token) {
  if ( !stands(token) || handsFull(token.actor) ) return [];
  const here = tileOf(token);
  return unitsOn(token.parent)
    .filter((other) => (other.token !== token) && (tilesApart(here, other.tile) === 1) && rescueOf(token, other.token)?.ok)
    .map((other) => other.token);
}

/* -------------------------------------------- */

/**
 * May a unit Take the ally that another carries?
 * @param {TokenDocument} token       The unit that would take it over
 * @param {TokenDocument} from        The unit that carries it
 * @returns {RescueCheck & {rider?: TokenDocument}|null}      Null for two units that are not both on one map
 */
export function takeOf(token, from) {
  if ( !stands(token) || !stands(from) || (token === from) || (token.parent !== from.parent) ) return null;
  if ( tilesApart(tileOf(token), tileOf(from)) !== 1 ) return { ok: false, why: "apart" };
  if ( relationTo(token, from) !== "friend" ) return { ok: false, why: "side" };
  const rider = passengerOf(from.actor)?.token;
  if ( !rider?.actor ) return { ok: false, why: "nobody" };
  return { ...canRescue(lifter(token), liftee(token, rider, { riding: true }), { near: false }), rider };
}

/* -------------------------------------------- */

/**
 * The allies next to a unit whose passenger it may Take.
 * @param {TokenDocument} token
 * @returns {TokenDocument[]}
 */
export function takesOf(token) {
  if ( !stands(token) || handsFull(token.actor) ) return [];
  const here = tileOf(token);
  return unitsOn(token.parent)
    .filter((other) => (other.token !== token) && (tilesApart(here, other.tile) === 1) && takeOf(token, other.token)?.ok)
    .map((other) => other.token);
}

/* -------------------------------------------- */

/**
 * The allies next to a unit that it may Give the ally it carries to.
 * @param {TokenDocument} token
 * @returns {TokenDocument[]}
 */
export function givesOf(token) {
  if ( !stands(token) || !passengerOf(token.actor)?.token ) return [];
  const here = tileOf(token);
  return unitsOn(token.parent)
    .filter((other) => (other.token !== token) && (tilesApart(here, other.tile) === 1) && takeOf(other.token, token)?.ok)
    .map((other) => other.token);
}

/* -------------------------------------------- */

/**
 * The tiles a unit may Drop the ally it carries on.
 * @param {TokenDocument} token
 * @returns {Tile[]}
 */
export function dropsOf(token) {
  const rider = passengerOf(token?.actor)?.token;
  const here = tileOf(token);
  if ( !stands(token) || !rider?.actor || !here ) return [];
  return dropTiles(here, forcedField(rider));
}

/* -------------------------------------------- */
/*  Carrying                                    */
/* -------------------------------------------- */

/**
 * Put a token on a tile at once, without anything being made of the move.
 * @param {TokenDocument} token
 * @param {{x: number, y: number}} point      The top left corner of the tile
 * @returns {Promise<void>}
 */
async function settle(token, { x, y }) {
  if ( !token?.parent || !Number.isFinite(x) || !Number.isFinite(y) ) return;
  const at = token._source ?? token;
  if ( (Math.abs(at.x - x) < 1) && (Math.abs(at.y - y) < 1) ) return;
  try {
    await token.move({ x, y, snapped: true, action: "displace" }, {
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
      animate: false,
      [FEO.id]: { forced: true, carried: true }
    });
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */

/**
 * The turn of a unit that is picked up is over: it does nothing more this Phase, carried or set down.
 * @param {TokenDocument} token
 * @returns {Promise<void>}
 */
async function endTurn(token) {
  const actor = token.actor;
  const state = turnState(actor, token);
  if ( state === "moving" ) await endMove(actor, token);
  else if ( state === "ready" ) {
    if ( !turnEnded(actor) ) await endTurnOf(actor);
    await actor.setFlag(FEO.id, "acted", true);
    if ( originOf(token) ) await token.unsetFlag(FEO.id, "origin");
  }
}

/* -------------------------------------------- */

/**
 * @typedef CarryOp
 * One unit picks up, hands over or sets down another.
 * @property {"lift"|"hand"|"drop"|"fall"|"loose"} op
 * @property {TokenDocument} carrier          The unit that carries, or is to; for "loose", the unit that was carried
 * @property {TokenDocument} [target]         "lift": the ally it picks up. "hand": the ally it hands its passenger to
 * @property {Tile} [tile]                    "drop": the tile the passenger is set down on; without one it is
 *                                            set down next to its carrier, on a tile picked by a die
 * @property {boolean} [beside]               "fall": is the passenger set down next to its carrier?
 * @property {string} [saved]                 "lift": the skill, by its Item, that has the unit come for the ally
 */

/**
 * Do what a `CarryOp` says, for a user who may change every unit in it. What it says is checked against the
 * rules again, since it may have been asked for by another user.
 * @param {CarryOp} op
 * @returns {Promise<boolean>}    Whether it was done
 */
async function apply({ op, carrier, target = null, tile = null, beside = false, saved = "" }) {
  const scene = carrier?.parent;
  const actor = carrier?.actor;
  if ( !scene?.grid?.isSquare || (actor?.type !== "unit") ) return false;

  switch ( op ) {
    // One unit picks up another: by the command, or as a skill has it come for an ally
    case "lift": {
      if ( target?.parent !== scene ) return false;
      const skill = saved ? actor.items.get(saved) : null;
      if ( saved && !savesWith(skill) ) return false;
      const tried = rescueOf(carrier, target, { weigh: !skill });
      if ( !tried?.ok ) return false;
      const over = !!skill && (liftWeight(actor.system.wt?.total, actor.system.carry) < (target.actor.system.wt?.total ?? 0));
      await endTurn(target);
      await target.actor.update({ "system.rescued": { by: actor.uuid, token: carrier.uuid, name: nameOf(carrier) } });
      await actor.update({
        "system.rescuing": { uuid: target.actor.uuid, token: target.uuid, name: nameOf(target), light: !!target.actor.system.carry?.light, over }
      });
      if ( skill?.system.usage?.kind ) {
        await skill.update({ "system.state": spendSkill(skill.system.usage, skill.system.state, { cooldowns: cooldownsFor(actor, skill) }) });
      }
      await settle(target, carrier._source ?? carrier);
      Hooks.callAll(CARRY_HOOK, carrier, target, { op });
      return true;
    }

    // The passenger of one unit is handed to another, whichever of the two asked
    case "hand": {
      const tried = (target?.parent === scene) ? takeOf(target, carrier) : null;
      if ( !tried?.ok ) return false;
      const rider = tried.rider;
      await actor.update({ "system.rescuing": { ...NOBODY } });
      await rider.actor.update({ "system.rescued": { by: target.actor.uuid, token: target.uuid, name: nameOf(target) } });
      await target.actor.update({
        "system.rescuing": { uuid: rider.actor.uuid, token: rider.uuid, name: nameOf(rider), light: !!rider.actor.system.carry?.light, over: false }
      });
      await settle(rider, target._source ?? target);
      Hooks.callAll(CARRY_HOOK, target, rider, { op, from: carrier });
      return true;
    }

    // The passenger is set down: by its carrier, on a tile that was picked or next to it; or where it lands
    // as its carrier falls
    case "drop":
    case "fall": {
      const rider = passengerOf(actor)?.token;
      if ( !rider?.actor ) {
        await actor.update({ "system.rescuing": { ...NOBODY } });
        return false;
      }
      const here = tileOf(carrier);
      const field = forcedField(rider);
      const onto = ((op === "drop") && tile)
        ? dropTiles(here, field).find((other) => tileKey(other) === tileKey(tile))
        : landing(here, field, { beside: beside || (op === "drop"), pick: (count) => Math.floor(Math.random() * count) });
      if ( (op === "drop") && !onto ) return false;
      await settle(rider, scene.grid.getTopLeftPoint(onto ?? here));
      await actor.update({ "system.rescuing": { ...NOBODY } });
      await rider.actor.update({ "system.rescued": { ...NO_CARRIER } });

      // What a skill of the carrier leaves on the unit it sets down
      if ( op === "drop" ) {
        for ( const drop of actor.system.carry?.drops ?? [] ) {
          try {
            await grantUnit(rider.actor, [buildChange({ name: drop.name, effects: drop.effects, ends: drop.ends, turns: drop.turns }, {
              skill: drop.skill, from: nameOf(carrier), giver: actor.uuid
            })], { by: actor });
          } catch(err) {
            console.error(err);
          }
        }
      }
      Hooks.callAll(CARRY_HOOK, carrier, rider, { op });
      return true;
    }

    // A unit whose carrier is gone, or carries it no longer, stands where its token is, or as near as it can
    case "loose": {
      const held = carrierOf(actor);
      if ( held?.actor && (held.actor.system.rescuing?.token === carrier.uuid) ) await held.actor.update({ "system.rescuing": { ...NOBODY } });
      await actor.update({ "system.rescued": { ...NO_CARRIER } });
      if ( !actor.system.defeat?.state || (actor.system.defeat.state === "incapacitated") ) {
        const onto = landing(tileOf(carrier), forcedField(carrier));
        if ( onto ) await settle(carrier, scene.grid.getTopLeftPoint(onto));
      }
      Hooks.callAll(CARRY_HOOK, held?.token ?? null, carrier, { op });
      return true;
    }
    default: return false;
  }
}

/* -------------------------------------------- */

/**
 * Have one unit pick up, hand over or set down another. Where this user may not change every unit in it, a
 * Game Master does it.
 * @param {CarryOp} op
 * @returns {Promise<boolean>}    Whether it was done
 */
export async function carry(op) {
  const carrier = op?.carrier;
  if ( !carrier?.parent ) return false;
  try {
    const rider = (op.op === "lift") ? op.target : (op.op === "loose") ? carrierOf(carrier.actor)?.token : passengerOf(carrier.actor)?.token;
    const touched = [carrier, rider, (op.op === "hand") ? op.target : null].filter(Boolean);
    if ( touched.every((token) => token.isOwner && token.actor?.isOwner) ) return await apply(op);
    const gm = game.users.activeGM;
    if ( !gm ) return false;
    return !!(await gm.query(CARRY_QUERY, {
      op: op.op, scene: carrier.parent.id, carrier: carrier.id, target: op.target?.id ?? null, tile: op.tile ?? null,
      beside: !!op.beside, saved: op.saved ?? ""
    }, { timeout: 10000 }));
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Answer a player's request to have one unit pick up, hand over or set down another. Runs for a Game Master;
 * what is asked for is checked against the rules like any other.
 * @param {object} data     A `CarryOp`, with its tokens by what tells them apart on their scene
 * @returns {Promise<boolean>}
 */
export async function carryQuery({ op, scene: sceneId, carrier, target, tile, beside, saved } = {}) {
  const scene = game.scenes?.get(sceneId);
  if ( !game.user.isGM || !scene?.grid?.isSquare ) return false;
  if ( !["lift", "hand", "drop", "fall", "loose"].includes(op) ) return false;
  const picked = (tile && Number.isInteger(tile.i) && Number.isInteger(tile.j)) ? { i: tile.i, j: tile.j } : null;
  try {
    return await apply({
      op, carrier: scene.tokens.get(carrier) ?? null, target: target ? (scene.tokens.get(target) ?? null) : null,
      tile: picked, beside: !!beside, saved: (typeof saved === "string") ? saved : ""
    });
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */
/*  The Commands                                */
/* -------------------------------------------- */

/**
 * Say why something cannot be done.
 * @param {string} key          Under `FEO.Rescue`
 * @param {object} [data]
 */
function warn(key, data = {}) {
  ui.notifications.warn(game.i18n.format(`FEO.Rescue.${key}`, data));
}

/* -------------------------------------------- */

/**
 * The unit moves no further this turn: what it has moved so far stands, and it goes on from where it stands
 * with no movement left. So it is for a unit that has given its passenger away or taken one over, and for one
 * that has Traded or changed form.
 * @param {TokenDocument} token
 * @param {string} [by]         What ended its move, by name
 * @returns {Promise<void>}
 */
export async function moveNoFurther(token, by = game.i18n.localize("FEO.Rescue.label")) {
  const actor = token.actor;
  if ( turnState(actor, token) !== "ready" ) return;
  const view = reachOf(token);
  const left = (!view || view.fixed) ? 0 : Math.max(view.movement - (view.moved ? view.spent : 0), 0);
  await standMove(actor, token, { skill: by, cost: left });
}

/* -------------------------------------------- */

/**
 * A unit Rescues an ally next to it: the ally leaves its tile and rides on the unit, whose DEX and SPD are
 * halved while it carries it. It is the unit's Action. Whatever keeps it from it is said instead.
 * @param {TokenDocument} token       The unit that Rescues
 * @param {TokenDocument} target      The ally next to it
 * @returns {Promise<boolean>}        Whether the ally was picked up
 */
export async function rescueUnit(token, target) {
  const tried = rescueOf(token, target);
  const name = nameOf(target);
  if ( !tried?.ok ) {
    warn(`blocked.${tried?.why ?? "apart"}`, { name, qualities: (tried?.qualities ?? []).join(", ") });
    return false;
  }
  if ( !(await carry({ op: "lift", carrier: token, target })) ) {
    warn("failed", { name });
    return false;
  }
  await takeAction(token.actor, token, { action: { kind: "rescue" } });
  return true;
}

/* -------------------------------------------- */

/**
 * A unit Drops the ally it carries on a free tile next to it. It is the unit's Action.
 * @param {TokenDocument} token
 * @param {Tile} tile
 * @returns {Promise<boolean>}        Whether the ally was set down
 */
export async function dropUnit(token, tile) {
  const rider = passengerOf(token?.actor);
  if ( !rider?.token ) return false;
  if ( !dropsOf(token).some((other) => tileKey(other) === tileKey(tile)) ) {
    warn("blocked.tile", { name: rider.name });
    return false;
  }
  if ( !(await carry({ op: "drop", carrier: token, tile })) ) {
    warn("failed", { name: rider.name });
    return false;
  }
  await takeAction(token.actor, token, { action: { kind: "rescue" } });
  return true;
}

/* -------------------------------------------- */

/**
 * A unit Gives the ally it carries to an ally next to it that can carry it. It is no Action, but the unit
 * moves no further this turn.
 * @param {TokenDocument} token       The unit that gives
 * @param {TokenDocument} to          The ally that takes over
 * @returns {Promise<boolean>}        Whether the passenger was handed over
 */
export async function giveUnit(token, to) {
  const rider = passengerOf(token?.actor);
  const tried = rider?.token ? takeOf(to, token) : null;
  if ( !tried?.ok ) {
    warn(`blocked.${tried?.why ?? "nobody"}`, { name: rider?.name ?? nameOf(to), qualities: (tried?.qualities ?? []).join(", ") });
    return false;
  }
  if ( !(await carry({ op: "hand", carrier: token, target: to })) ) {
    warn("failed", { name: rider.name });
    return false;
  }
  await moveNoFurther(token);
  return true;
}

/* -------------------------------------------- */

/**
 * A unit Takes the ally that an ally next to it carries. It is no Action, but the unit moves no further this
 * turn.
 * @param {TokenDocument} token       The unit that takes over
 * @param {TokenDocument} from        The ally that carries
 * @returns {Promise<boolean>}        Whether the passenger was handed over
 */
export async function takeUnit(token, from) {
  const tried = takeOf(token, from);
  const name = tried?.rider ? nameOf(tried.rider) : nameOf(from);
  if ( !tried?.ok ) {
    warn(`blocked.${tried?.why ?? "apart"}`, { name, qualities: (tried?.qualities ?? []).join(", ") });
    return false;
  }
  if ( !(await carry({ op: "hand", carrier: from, target: token })) ) {
    warn("failed", { name });
    return false;
  }
  await moveNoFurther(token);
  return true;
}

/* -------------------------------------------- */
/*  Turns                                       */
/* -------------------------------------------- */

/**
 * The turn of a unit that is carried starts: it regains what a skill of its carrier restores to the ally it
 * carries.
 * @param {Actor} actor       The unit that is carried
 * @returns {Promise<void>}
 */
export async function tendCarried(actor) {
  const carrier = carrierOf(actor)?.actor;
  const heals = carrier?.system.carry?.heals ?? 0;
  const { value, max } = actor.system.hp ?? {};
  if ( !(heals > 0) || !(value > 0) || !(value < max) ) return;
  pop(carrier, [{ text: carrier.system.carry.skills.heals, tone: "skill" }]);
  await healUnit(actor, carriedHeal(max, heals));
}

/* -------------------------------------------- */

/**
 * The turn of a unit starts that carries an ally it could not carry by its Weight, as a skill had it: it sets
 * that ally down at once, on a free tile next to it.
 * @param {TokenDocument} token
 * @returns {Promise<boolean>}    Whether it set anybody down
 */
export async function setDownOver(token) {
  if ( !passengerOf(token?.actor)?.over ) return false;
  return carry({ op: "drop", carrier: token });
}

/* -------------------------------------------- */

/**
 * A side's Phase ends: where the world counts points for it, a unit of the players that still carries a
 * partner at half its HP or less grows closer to it.
 * @param {Combat} combat
 * @param {string} army       The side whose Phase ends
 * @returns {Promise<void>}
 */
export async function awardCarried(combat, army) {
  if ( army !== "player" ) return;
  for ( const unit of unitsOf(combat) ) {
    if ( (unit.army !== army) || !unit.token ) continue;
    const rider = passengerOf(unit.actor);
    const hp = rider?.actor?.system.hp;
    if ( !rider?.token || !hp || !((hp.value * 2) <= hp.max) ) continue;
    try {
      await awardEvent("rescue", unit.token, { only: rider.token });
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */
/*  Keeping It Straight                         */
/* -------------------------------------------- */

/**
 * After a unit has changed: a carrier that is out of the fight now, or down, sets its passenger down; a unit
 * that dies or retreats while it is carried is carried no longer. Runs for the user who made the change.
 * @param {Actor} actor
 * @param {object} changed
 * @param {object} options
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function followCarrier(actor, changed, options, userId) {
  if ( (actor?.type !== "unit") || (userId !== game.user.id) ) return;
  const state = foundry.utils.getProperty(changed, "system.defeat.state");
  if ( !state ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token ) return;

  // An Incapacitated carrier lies on its tile, so its passenger lands next to it; any other is gone from it
  if ( passengerOf(actor) ) await carry({ op: "fall", carrier: token, beside: state === "incapacitated" });
  if ( isCarried(actor) && (state !== "incapacitated") ) await carry({ op: "loose", carrier: token });
}

/* -------------------------------------------- */

/**
 * Look over a scene for carrying that no longer stands, and end it: a unit whose carrier is gone or carries
 * it no longer stands where its token is, and a unit whose passenger is gone carries nobody. Runs for a Game
 * Master.
 * @param {Scene|null} scene
 * @returns {Promise<number>}     How many were put right
 */
export async function settleCarries(scene) {
  if ( !game.user.isGM || !scene?.grid?.isSquare ) return 0;
  let mended = 0;
  for ( const token of Array.from(scene.tokens) ) {
    const actor = token.actor;
    if ( actor?.type !== "unit" ) continue;
    try {
      if ( isCarried(actor) ) {
        const held = carrierOf(actor);
        const stands = !!held?.token?.parent && !held.actor?.system.defeat?.out && (held.actor?.system.rescuing?.token === token.uuid);
        if ( !stands && (await apply({ op: "loose", carrier: token })) ) mended += 1;
      }
      const rider = actor.system.rescuing?.token ? passengerOf(actor) : null;
      if ( rider && (!rider.token?.parent || (rider.actor?.system.rescued?.token !== token.uuid)) ) {
        await actor.update({ "system.rescuing": { ...NOBODY } });
        mended += 1;
      }
    } catch(err) {
      console.error(err);
    }
  }
  return mended;
}

/* -------------------------------------------- */
/*  Coming for an Ally                          */
/* -------------------------------------------- */

/**
 * Does a skill let its unit come for an ally that an attack would defeat, and can it be used now?
 * @param {Item|null} item
 * @returns {boolean}
 */
function savesWith(item) {
  if ( (item?.type !== "skill") || !item.system.equipped || (item.system.automate === false) ) return false;
  if ( !(item.system.effects ?? []).some((effect) => effect?.carry?.saves === true) ) return false;
  return !item.system.usage?.kind || canUse(item.system.usage, item.system.state).ok;
}

/* -------------------------------------------- */

/**
 * The user who acts for a unit: a player who owns it and is connected, or the Game Master whose own character
 * it is, else the Game Master who runs the battle.
 * @param {Actor} actor
 * @returns {User|null}
 */
export function actsFor(actor) {
  const owners = game.users.filter((user) => {
    return user.active && (user.isGM ? (user.character?.id === actor.id) : actor.testUserPermission(user, "OWNER"));
  });
  return owners.find((user) => user === game.user) ?? owners[0] ?? game.users.activeGM ?? null;
}

/* -------------------------------------------- */

/**
 * Offer something on the map to whoever acts for a unit, wherever they sit: tiles and units to pick from, and
 * a pick or a pass comes back (see `game.feo.hud.ask`).
 * @param {TokenDocument} token       The unit it is offered to
 * @param {{skill: string, tiles?: Tile[], units?: TokenDocument[], hint?: string}} offer
 * @returns {Promise<{tile?: Tile, unit?: TokenDocument}|null>}     Null when it was passed
 */
export async function askOwner(token, offer) {
  const user = actsFor(token.actor);
  if ( !user ) return null;
  try {
    if ( user === game.user ) return (await game.feo.hud?.ask?.({ ...offer, token })) ?? null;
    const answer = await user.query(OFFER_QUERY, {
      scene: token.parent.id, token: token.id, skill: offer.skill, hint: offer.hint ?? "",
      tiles: (offer.tiles ?? []).map(({ i, j }) => ({ i, j })), units: (offer.units ?? []).map((unit) => unit.id)
    }, { timeout: FEO.forced.promptTime + 5000 });
    if ( answer?.tile ) return { tile: { i: answer.tile.i, j: answer.tile.j } };
    const unit = answer?.unit ? token.parent.tokens.get(answer.unit) : null;
    return unit ? { unit } : null;
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Answer another client's request to offer something on this user's map. Only a unit this user acts for is
 * offered anything, on the scene in view.
 * @param {{scene: string, token: string, skill: string, hint: string, tiles: Tile[], units: string[]}} data
 * @returns {Promise<{tile?: Tile, unit?: string}|null>}
 */
export async function offerQuery({ scene: sceneId, token: tokenId, skill, hint, tiles, units } = {}) {
  const scene = game.scenes?.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  if ( !token?.isOwner || (scene !== globalThis.canvas?.scene) || !Array.isArray(tiles) || !Array.isArray(units) ) return null;
  const picked = await game.feo.hud?.ask?.({
    token,
    skill: String(skill ?? ""),
    hint: String(hint ?? ""),
    tiles: tiles.filter((tile) => Number.isInteger(tile?.i) && Number.isInteger(tile?.j)).map(({ i, j }) => ({ i, j })),
    units: units.map((id) => scene.tokens.get(id)).filter(Boolean)
  });
  if ( picked?.tile ) return { tile: picked.tile };
  return picked?.unit ? { unit: picked.unit.id } : null;
}

/* -------------------------------------------- */

/**
 * @typedef Standby
 * An ally that stands by for a unit, should an attack defeat it.
 * @property {string} key             What tells it from the others: its token
 * @property {string} skill           The skill that lets it come
 * @property {string} by              Its name
 * @property {TokenDocument} token
 * @property {Item} item              That skill
 * @property {Tile} tile              Where it stands
 */

/**
 * @typedef Saver
 * A unit that comes for an ally as the blow that would defeat it falls.
 * @property {string} key                             Which of the allies that stood by it is
 * @property {"initiator"|"defender"} side            The side of the fight it comes for
 * @property {{skill: string, by: string}} saved      The skill, and the unit that comes, by name
 * @property {() => Promise<boolean>} finish          Has it move to its ally and pick it up, once the fight is saved
 */

/**
 * The allies that stand by for a unit before a fight is rolled, should an attack in it defeat that unit: every
 * one whose skill lets it come for an ally, with a use left, that can move and act and has free hands. Whether
 * one stands near enough is only worked out if the blow falls (see `comeTo`). The fight has the blow answered
 * by them, like every other answer in the middle of a fight (see `helpers/answers.mjs`).
 * @param {TokenDocument|null} victim       The unit that may fall
 * @param {TokenDocument|null} attacker     The unit it fights
 * @returns {Standby[]}
 */
export function standbyFor(victim, attacker) {
  if ( !victim?.actor || !tileOf(victim) || !victim.parent?.grid?.isSquare ) return [];
  const standing = [];
  for ( const other of unitsOn(victim.parent) ) {
    const token = other.token;
    const actor = other.actor;
    if ( (token === victim) || (token === attacker) || other.down || !actor.system.carry?.saves ) continue;
    const item = actor.items.find(savesWith);
    if ( !item || !steps(token) || actor.system.stagger?.staggered ) continue;
    if ( Object.keys(actor.system.conditions ?? {}).some((id) => FEO.conditions[id]?.noAct) ) continue;
    if ( !rescueOf(token, victim, { near: false, weigh: false })?.ok ) continue;
    standing.push({ key: token.id, skill: item.name, by: nameOf(token), token, item, tile: other.tile });
  }
  return standing;
}

/* -------------------------------------------- */

/**
 * The blow that would defeat a unit falls: an ally that stands by for it, with a tile next to the unit within
 * its whole movement, whatever it has moved this turn, may come for it. Whoever acts for that ally is offered
 * it on the map, the nearest first, with one click to take it and no answer taken for a no; an ally that
 * answers by itself comes by itself. The fight then leaves the unit 1 HP, and whoever rolled it has the ally
 * come once it is saved.
 * @param {Standby[]} standing        The allies that stood by as the fight began
 * @param {TokenDocument} victim
 * @param {"initiator"|"defender"} side     The side of the fight the unit is
 * @returns {Promise<Saver|null>}
 */
export async function comeTo(standing, victim, side) {
  const there = tileOf(victim);
  if ( !victim?.actor || !there ) return null;
  const able = [];
  for ( const ally of standing ?? [] ) {
    const view = reachOf(ally.token, { fresh: true });
    const tiles = view ? comesFor(ally.tile, there, view.reach) : [];
    if ( tiles.length ) able.push({ ...ally, tiles, cost: view.reach.cost.get(tileKey(tiles[0])) ?? 0 });
  }
  able.sort((a, b) => a.cost - b.cost);

  for ( const { key, token, item, tiles } of able ) {
    // Standing next to its ally already, it is asked by that ally; else by the tiles it may come to
    const near = tilesApart(tileOf(token), there) === 1;
    const picked = answersAlone(token.actor)
      ? { tile: tiles[0] }
      : await askOwner(token, { skill: item.name, tiles: near ? [] : tiles, units: [victim], hint: "FEO.Rescue.hint.save" });
    if ( !picked?.tile && !picked?.unit ) continue;
    const tile = picked.tile ?? tiles[0];
    return {
      key,
      side,
      saved: { skill: item.name, by: nameOf(token) },
      finish: async () => {
        if ( !near && !(await moveUnits([{ token, tile }])) ) return false;
        pop(token.actor, [{ text: item.name, tone: "skill" }]);
        return carry({ op: "lift", carrier: token, target: victim, saved: item.id });
      }
    };
  }
  return null;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what carrying listens for. Called once, when the system starts.
 */
export function registerHooks() {
  // A unit that is carried goes where its carrier goes: its token is kept under its carrier's
  Hooks.on("updateToken", (token, changes) => {
    try {
      if ( !game.user.isActiveGM || !(("x" in changes) || ("y" in changes)) ) return;
      const rider = passengerOf(token.actor)?.token;
      if ( rider && (rider.parent === token.parent) ) settle(rider, token._source ?? token);
    } catch(err) {
      console.error(err);
    }
  });

  // A carrier that falls sets its passenger down, and a unit that dies while it is carried is carried no more
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    followCarrier(actor, changed, options, userId).catch((err) => console.error(err));
  });

  // A token that is taken off the map carries nobody, and is carried by nobody
  Hooks.on("deleteToken", (token) => {
    if ( game.user.isActiveGM ) settleCarries(token.parent).catch((err) => console.error(err));
  });
}

import { FEO } from "../config.mjs";
import { canCapture, readyCapture, tickSubdued } from "../rules/capturing.mjs";
import { buildCaptureCard, captorOf, captureTargetOf } from "./capture-context.mjs";
import { postCard } from "./chat.mjs";
import { applyChanges, armyOf, measureDistance } from "./exchange.mjs";

/**
 * Capturing in Foundry: readying an attempt, the attempt a fight is then fought as, capturing a unit that
 * cannot fight back, picking up a subdued one, releasing a captive, and setting one free when its captor is
 * defeated. Everything about the two units is saved through the changes of an exchange, so that a player can
 * capture a unit only a Game Master may change.
 */

const nameOf = (actor, token = null) => token?.name || actor.token?.name || actor.name;

/** The first token that stands for a unit on the scene that is shown. */
const tokenOf = (actor) => actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;

/* -------------------------------------------- */
/*  The Attempt                                 */
/* -------------------------------------------- */

/**
 * Can a unit attempt to capture another, as both are now?
 * @param {Actor} actor                       The unit that would capture
 * @param {TokenDocument|null} token          Its token, if it has one
 * @param {Actor} target
 * @param {TokenDocument|null} targetToken
 * @returns {import("../rules/capturing.mjs").CaptureCheck}
 */
export function captureCheck(actor, token, target, targetToken) {
  const foe = armyOf(actor, token ?? actor.token ?? null) !== armyOf(target, targetToken ?? target.token ?? null);
  return canCapture(captorOf(actor), captureTargetOf(target, { foe }));
}

/* -------------------------------------------- */

/**
 * Carry the attempt to capture a unit has readied into the fight it is about to start.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {Actor} target
 * @param {TokenDocument|null} targetToken
 * @param {import("../rules/combat.mjs").Combatant} unit    The unit as `combatantOf` describes it
 * @returns {import("../rules/combat.mjs").Combatant}
 */
export function withReadiedCapture(actor, token, target, targetToken, unit) {
  if ( !FEO.optional.capturing.enabled || !actor.system.capturing ) return unit;
  return readyCapture(unit, captureCheck(actor, token, target, targetToken), game.i18n.localize("FEO.Optional.capturing.attempt"), {
    free: !!actor.system.carry?.free
  });
}

/* -------------------------------------------- */

/**
 * Ready an attempt to capture for the next fight a unit starts, or put it away again. A unit that holds a
 * captive, or has one waiting to be picked up, readies none.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether anything changed
 */
export async function toggleCapture(actor) {
  if ( actor?.type !== "unit" ) return false;
  if ( actor.system.capturing ) {
    await actor.update({ "system.capturing": false });
    return true;
  }
  const why = !FEO.optional.capturing.enabled ? "off" : (actor.system.captive?.uuid || actor.system.rescuing?.uuid) ? "holding" : null;
  if ( why ) {
    ui.notifications.warn(`FEO.Optional.capturing.cannot.${why}`, { localize: true });
    return false;
  }
  await actor.update({ "system.capturing": true });
  return true;
}

/* -------------------------------------------- */

/**
 * Capture a unit that cannot fight back, without a fight: its captor picks it up at once.
 * @param {Actor} actor                   The captor
 * @param {TokenDocument|null} token
 * @param {Actor} target
 * @param {TokenDocument|null} targetToken
 * @param {string} reason                 Why the target cannot fight back, as `capturedOutright` names it
 * @returns {Promise<ChatMessage>}
 */
export async function captureOutright(actor, token, target, targetToken, reason) {
  const names = { captor: nameOf(actor, token), captive: nameOf(target, targetToken) };
  const unsaved = await applyChanges([
    { uuid: target.uuid, captured: { by: actor.uuid, name: names.captor, hp: Math.max(target.system.hp.value, 0), held: true } },
    { uuid: actor.uuid, captive: { uuid: target.uuid, name: names.captive, held: true, turns: 0 }, capturing: false }
  ]);
  return postCard(actor, buildCaptureCard("outright", { ...names, reason, unsaved: unsaved.length > 0 }, game.i18n));
}

/* -------------------------------------------- */
/*  Holding a Captive                           */
/* -------------------------------------------- */

/**
 * Pick up the unit a captor has subdued: it stands next to it, and carries it from now on.
 * @param {Actor} actor                   The captor
 * @param {TokenDocument|null} [token]    Its token, if it has one on the scene
 * @returns {Promise<ChatMessage|null>}   The message that was posted, or null if nobody was picked up
 */
export async function pickUpCaptive(actor, token = null) {
  const held = actor?.system.captive;
  if ( !FEO.optional.capturing.enabled || !held?.uuid || held.held ) return null;
  const target = await foundry.utils.fromUuid(held.uuid);
  if ( (target?.type !== "unit") || (target.system.defeat?.state !== "captured") ) {
    // Whoever waited to be picked up is gone or on its feet again
    await actor.update({ "system.captive": { uuid: "", name: "", held: false, turns: 0 } });
    return null;
  }
  const from = token ?? tokenOf(actor);
  const there = tokenOf(target);
  const apart = (from && there) ? measureDistance(from, there) : null;
  if ( (apart !== null) && (apart > 1) ) {
    ui.notifications.warn(game.i18n.format("FEO.Optional.capturing.cannot.far", { name: held.name }));
    return null;
  }
  const names = { captor: nameOf(actor, token), captive: held.name };
  const unsaved = await applyChanges([
    { uuid: target.uuid, captured: { by: actor.uuid, name: names.captor, hp: target.system.captured?.hp ?? 0, held: true } },
    { uuid: actor.uuid, captive: { uuid: held.uuid, name: held.name, held: true, turns: 0 } }
  ]);
  return postCard(actor, buildCaptureCard("pickedUp", { ...names, unsaved: unsaved.length > 0 }, game.i18n));
}

/* -------------------------------------------- */

/**
 * Let go of a captive. One that was carried leaves the map and is out of the battle; one that only waited to
 * be picked up comes to where it lies, with the HP it had.
 * @param {Actor} actor       The captor
 * @param {object} [options]
 * @param {boolean} [options.free]    Set the captive free, with the HP it had, where its captor stands: what
 *                                    happens when the captor is defeated
 * @returns {Promise<ChatMessage|null>}
 */
export async function releaseCaptive(actor, { free = false } = {}) {
  const held = actor?.system.captive;
  if ( !held?.uuid ) return null;
  const target = await foundry.utils.fromUuid(held.uuid);
  const waking = free || !held.held;
  const names = { captor: nameOf(actor), captive: held.name };
  const changes = [{ uuid: actor.uuid, captive: null }];
  let hp = 0;
  if ( (target?.type === "unit") && (target.system.defeat?.state === "captured") ) {
    hp = target.system.captured?.hp ?? 0;
    const place = tokenOf(actor);
    changes.unshift(waking
      ? { uuid: target.uuid, freed: true, ...((held.held && place) ? { at: { x: place.x, y: place.y } } : {}) }
      : { uuid: target.uuid, released: true });
  }
  const unsaved = await applyChanges(changes);
  const event = !waking ? "released" : held.held ? "freed" : "wakes";
  return postCard(actor, buildCaptureCard(event, { ...names, hp, unsaved: unsaved.length > 0 }, game.i18n));
}

/* -------------------------------------------- */

/**
 * Set a captured unit free from its own side: whoever held it holds it no longer, and it returns with the HP
 * it had. This is how a Game Master undoes a capture by hand.
 * @param {Actor} actor       The captured unit
 * @returns {Promise<ChatMessage|null>}
 */
export async function freeCaptured(actor) {
  if ( actor?.system.defeat?.state !== "captured" ) return null;
  const taken = actor.system.captured ?? {};
  const captor = taken.by ? await foundry.utils.fromUuid(taken.by) : null;
  if ( (captor?.type === "unit") && (captor.system.captive?.uuid === actor.uuid) ) {
    return releaseCaptive(captor, { free: true });
  }
  const unsaved = await applyChanges([{ uuid: actor.uuid, freed: true }]);
  return postCard(actor, buildCaptureCard(taken.held ? "freed" : "wakes", {
    captor: taken.name ?? "", captive: nameOf(actor), hp: taken.hp ?? 0, unsaved: unsaved.length > 0
  }, game.i18n));
}

/* -------------------------------------------- */
/*  Turns and Defeat                            */
/* -------------------------------------------- */

/**
 * A unit's turn ends: a unit it subdued and has not picked up waits one turn less, and comes to when the wait
 * is over.
 * @param {Actor} actor
 * @returns {Promise<{turns: number, wakes: boolean}|null>}     Null for a unit with nobody waiting
 */
export async function tickCaptiveFor(actor) {
  if ( (actor?.type !== "unit") || !FEO.optional.capturing.enabled ) return null;
  const tick = tickSubdued(actor.system.captive);
  if ( !tick ) return null;
  if ( tick.wakes ) await releaseCaptive(actor);
  else await actor.update({ "system.captive.turns": tick.turns });
  return tick;
}

/* -------------------------------------------- */

/**
 * After a unit has changed: one that is out of the fight now, however it came to that, holds its captive no
 * longer. Runs for the user who made the change.
 * @param {Actor} actor
 * @param {object} changed
 * @param {object} options
 * @param {string} userId
 * @returns {Promise<ChatMessage|null>}
 */
export async function followCaptor(actor, changed, options, userId) {
  if ( (actor?.type !== "unit") || (userId !== game.user.id) || !FEO.optional.capturing.enabled ) return null;
  if ( !foundry.utils.getProperty(changed, "system.defeat.state") || !actor.system.captive?.uuid ) return null;
  return releaseCaptive(actor, { free: true });
}

/* -------------------------------------------- */

/**
 * Show on the map and in the encounter what was saved about a captive: one that is carried is taken off the
 * map, and one that was carried and is free again is put back, where its captor stood if that is known. A
 * unit that was only subdued stays where it lies. Tokens this user may not change are left alone.
 * @param {Actor} actor       The captive
 * @param {object} [shown]
 * @param {boolean|null} [shown.hide]             Take its tokens off the map, or put them back; null to
 *                                                leave them as they are
 * @param {{x: number, y: number}|null} [shown.at]    Where to put them back
 * @returns {Promise<void>}
 */
export async function settleCapture(actor, { hide = null, at = null } = {}) {
  try {
    const { syncStatus } = await import("./defeat.mjs");
    await syncStatus(actor);
    if ( hide === null ) return;
    for ( const token of actor.token ? [actor.token] : (actor.getActiveTokens?.(false, true) ?? []) ) {
      if ( !token.isOwner ) continue;
      const update = {};
      if ( token.hidden !== hide ) update.hidden = hide;
      if ( !hide && Number.isFinite(at?.x) && Number.isFinite(at?.y) ) Object.assign(update, { x: at.x, y: at.y });
      if ( Object.keys(update).length ) await token.update(update);
    }
  } catch(err) {
    console.error(err);
  }
}

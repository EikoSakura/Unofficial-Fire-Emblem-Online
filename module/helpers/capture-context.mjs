/**
 * Capturing for display, and as plain data: a unit as the rules of capturing read it, what its sheet shows of
 * an attempt, a captive and a captor, and the chat cards posted when a unit is captured, picked up, released
 * or free again. Nothing here touches Foundry, so that it can be tested outside of it; strings are localized
 * through whatever `i18n` is passed in.
 *
 * @import {CaptureTarget} from "../rules/capturing.mjs"
 * @import {ChatCard} from "./chat.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */
import { FEO } from "../config.mjs";
import { isBroken } from "../rules/combat.mjs";

/**
 * A unit as the rules of capturing read the one that would be captured.
 * @param {{items?: Iterable<object>, system: object}} actor
 * @param {object} [options]
 * @param {boolean} [options.foe]     Is it an enemy of the unit that would capture it?
 * @returns {CaptureTarget}
 */
export function captureTargetOf(actor, { foe = true } = {}) {
  const system = actor.system;
  const shift = system.shift ?? {};
  return {
    weight: system.wt?.total ?? 0,
    qualities: system.specialQualities ?? "",
    conditions: system.conditions ?? {},
    shift: { mode: shift.mode ?? null, active: !!(shift.transformed ?? shift.active), left: shift.left ?? 0 },
    weapons: Array.from(actor.items ?? []).filter((item) => item.type === "weapon").map((item) => ({
      name: item.name,
      category: item.system.category,
      broken: !!item.system.broken || isBroken(item.system)
    })),
    out: !!system.defeat?.state,
    foe
  };
}

/* -------------------------------------------- */

/**
 * A unit as the rules of capturing read the one that would capture.
 * @param {{system: object}} actor
 * @returns {{weight: number, holds: boolean}}
 */
export function captorOf(actor) {
  return { weight: actor.system.wt?.total ?? 0, holds: !!actor.system.captive?.uuid };
}

/* -------------------------------------------- */

/**
 * What a unit's sheet and the map show of capturing, where the world plays with it.
 * @param {object} system     The unit's data
 * @returns {{readied: boolean, captive: {name: string, held: boolean, turns: number}|null,
 *   captured: {by: string, held: boolean}|null}|null}
 */
export function captureView(system) {
  if ( !FEO.optional.capturing.enabled ) return null;
  const captive = system.captive?.uuid ? system.captive : null;
  const captured = (system.defeat?.state === "captured") ? (system.captured ?? {}) : null;
  return {
    readied: !!system.capturing,
    captive: captive ? { name: captive.name, held: !!captive.held, turns: captive.turns ?? 0 } : null,
    captured: captured ? { by: captured.name ?? "", held: !!captured.held } : null
  };
}

/* -------------------------------------------- */

/**
 * Why a unit cannot capture its target, in words.
 * @param {import("../rules/capturing.mjs").CaptureCheck} check
 * @param {Localizer} i18n
 * @returns {string}
 */
export function captureReason(check, i18n) {
  return i18n.format(`FEO.Optional.capturing.cannot.${check.why}`, { qualities: (check.qualities ?? []).join(", ") });
}

/* -------------------------------------------- */

/**
 * Build the card for something that happened to a captive.
 * @param {"outright"|"pickedUp"|"released"|"freed"|"wakes"} event
 * @param {object} data
 * @param {string} data.captor          The name of the unit that captures or held
 * @param {string} data.captive         The name of the unit that is captured or was held
 * @param {string} [data.reason]        For a capture without a fight: why the target could not fight back
 * @param {number} [data.hp]            The HP a unit that is free again returns with
 * @param {boolean} [data.unsaved]      Could the change not be saved for want of a Game Master?
 * @param {Localizer} i18n
 * @returns {ChatCard}
 */
export function buildCaptureCard(event, { captor, captive, reason = "", hp = 0, unsaved = false }, i18n) {
  const at = (key, data = {}) => i18n.format(`FEO.Optional.capturing.card.${key}`, { captor, captive, hp, ...data });
  const card = { title: at(`${event}Title`), rows: [] };
  switch ( event ) {
    case "outright":
      card.subtitle = i18n.localize(`FEO.Optional.capturing.outright.${reason}`);
      card.outcome = { label: at("captured"), cls: "good" };
      card.note = at("carryNote");
      break;
    case "pickedUp":
      card.outcome = { label: at("captured"), cls: "good" };
      card.note = at("carryNote");
      break;
    case "released":
      card.outcome = { label: at("released"), cls: "" };
      break;
    case "freed":
      card.outcome = { label: at("freed"), cls: "bad" };
      card.rows.push({ label: i18n.localize("FEO.Stat.hp.abbr"), value: hp });
      break;
    case "wakes":
      card.outcome = { label: at("wakes"), cls: "bad" };
      card.rows.push({ label: i18n.localize("FEO.Stat.hp.abbr"), value: hp });
      break;
  }
  if ( unsaved ) card.note = i18n.format("FEO.Exchange.unapplied", { names: [captor, captive].join(", ") });
  return card;
}

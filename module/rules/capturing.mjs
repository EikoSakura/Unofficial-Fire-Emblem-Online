/**
 * Capturing, an Optional Module: a unit may attempt to capture the unit it attacks instead of killing it.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * To capture a unit one needs more Weight than it has. The attempt is a fight like any other, which the
 * capturing unit fights with every stat but LUK halved. A target brought to 0 HP in it is not killed:
 *
 *   from next to it      it is captured, and carried by its captor as a Rescued unit is: the captor's SPD and
 *                        DEX are halved for as long as it holds its captive
 *   from further away    it is subdued where it stands, out of the fight, for its captor to pick up on its
 *                        next turn. Left where it is until that turn has ended, it comes to with the HP it had
 *
 * Some units are never captured: Ballisticians, Terrors, Mounted and Flying units, a Laguz in its animal form,
 * a Manakete or Taguel with transformations left, and a unit whose skill says so (`rules: ["uncaptured"]`). Others are captured without a fight at all: a unit under
 * Sleep, Stun, Petrification, Freeze, Beckon, Seduce, Stop or Control, which may then even ride or fly, one
 * with no weapon, one with nothing but broken weapons and staves, and one with nothing but its Fists.
 *
 * A captive is out of the fight. Released, it leaves the map. If its captor is defeated it is free again, and
 * returns with the HP it had before it was captured.
 */
import { FEO } from "../config.mjs";
import { carryEntry as burden, liftWeight } from "./rescue.mjs";
import { UNCAPTURED } from "./stealing.mjs";

/** Is a word found in a text, standing by itself? */
function names(text, word) {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(text ?? "");
}

/* -------------------------------------------- */
/*  Stats                                       */
/* -------------------------------------------- */

/**
 * What an attempt to capture does to the unit that makes it, as one more skill of its own for that fight:
 * every stat but those that are spared, halved.
 * @param {string} [name]     What it goes by in the fight and on its card
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}}
 */
export function captureEntry(name = "Capture") {
  const { spared, percent } = FEO.optional.capturing;
  const halved = Object.keys(FEO.stats).filter((key) => !spared.includes(key));
  return { name, innate: true, nihil: false, effects: [{ statPercent: Object.fromEntries(halved.map((key) => [key, percent])) }] };
}

/* -------------------------------------------- */

/**
 * What holding a captive does to its captor, as one more skill of its own: what Rescuing does (see
 * `rescue.mjs`).
 * @param {string} [name]     What it goes by among the unit's numbers
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}}
 */
export function carryEntry(name = "Captive") {
  return burden(name);
}

/* -------------------------------------------- */
/*  Who Can Be Captured                         */
/* -------------------------------------------- */

/**
 * @typedef CaptureTarget
 * A unit as the rules of capturing read it.
 * @property {number} weight                      Its Weight
 * @property {string} [qualities]                 Its Special Qualities, as free text
 * @property {Record<string, number>} [conditions]
 * @property {{mode: "gauge"|"stone"|null, active?: boolean, left?: number}} [shift]
 *                                                How it changes form, whether it is transformed, and the
 *                                                transformations it has left
 * @property {{name: string, category: string, broken: boolean}[]} [weapons]
 *                                                The weapons it carries
 * @property {boolean} [out]                      Is it out of the fight already?
 * @property {Iterable<string>|null} [rules]      The rules its skills give it: one of them may keep it from
 *                                                being captured
 * @property {boolean} [foe]                      Is it an enemy of the unit that would capture it? Taken to
 *                                                be one unless said otherwise
 */

/**
 * Why a unit is captured without a fight, if it is: it is under a condition that leaves it helpless, or it has
 * nothing to fight back with.
 * @param {CaptureTarget} target
 * @returns {"condition"|"unarmed"|"broken"|"fists"|null}
 */
export function capturedOutright(target) {
  const config = FEO.optional.capturing;
  if ( config.outright.some((id) => id in (target?.conditions ?? {})) ) return "condition";
  const weapons = target?.weapons ?? [];
  if ( !weapons.length ) return "unarmed";
  const usable = weapons.filter((weapon) => !weapon.broken && (weapon.category !== "staff"));
  if ( !usable.length ) return "broken";
  if ( usable.every((weapon) => weapon.name === FEO.shift.humanWeapon) ) return "fists";
  return null;
}

/* -------------------------------------------- */

/**
 * Why a unit can never be captured as it is now, if it cannot. One that rides or flies can be while a
 * condition leaves it helpless.
 * @param {CaptureTarget} target
 * @returns {{why: "quality"|"rider"|"shifted"|"transforms"|"watchful", qualities?: string[]}|null}
 */
export function barredFromCapture(target) {
  const config = FEO.optional.capturing;

  // One whose skills keep it from being captured never is, whatever state it is in
  if ( new Set(target?.rules ?? []).has(UNCAPTURED) ) return { why: "watchful" };
  const has = (list) => list.filter((quality) => names(target?.qualities, quality));
  const barred = has(config.barred);
  if ( barred.length ) return { why: "quality", qualities: barred };
  const shift = target?.shift ?? {};
  if ( (shift.mode === "gauge") && shift.active ) return { why: "shifted" };
  if ( (shift.mode === "stone") && ((shift.left ?? 0) > 0) ) return { why: "transforms" };
  const riding = shift.mode ? [] : has(config.riders);
  if ( riding.length && (capturedOutright(target) !== "condition") ) return { why: "rider", qualities: riding };
  return null;
}

/* -------------------------------------------- */

/**
 * @typedef CaptureCheck
 * @property {boolean} ok               Can the unit attempt to capture this target?
 * @property {"off"|"holding"|"side"|"out"|"weight"|"quality"|"rider"|"shifted"|"transforms"|null} why
 *                                      Why not
 * @property {string[]} [qualities]     The Special Qualities that keep the target from being captured
 * @property {"condition"|"unarmed"|"broken"|"fists"|null} outright
 *                                      Why the target is captured without a fight, from next to it
 */

/**
 * Can a unit attempt to capture another?
 * @param {{weight: number, holds?: boolean, carry?: import("./rescue.mjs").Carrying|null}} captor
 *                                                        Its Weight, whether it has a captive already, one
 *                                                        waiting to be picked up or an ally it carries, and
 *                                                        what its skills make of carrying a unit: the Weight
 *                                                        they add counts here as it does for Rescuing
 * @param {CaptureTarget} target
 * @returns {CaptureCheck}
 */
export function canCapture(captor, target) {
  const no = (why, more = {}) => ({ ok: false, why, outright: null, ...more });
  if ( !FEO.optional.capturing.enabled ) return no("off");
  if ( captor?.holds ) return no("holding");
  if ( target?.foe === false ) return no("side");
  if ( target?.out ) return no("out");
  if ( !(liftWeight(captor?.weight, captor?.carry) > (target?.weight ?? 0)) ) return no("weight");
  const barred = barredFromCapture(target);
  if ( barred ) return no(barred.why, barred.qualities ? { qualities: barred.qualities } : {});
  return { ok: true, why: null, outright: capturedOutright(target) };
}

/* -------------------------------------------- */
/*  The Attempt                                 */
/* -------------------------------------------- */

/**
 * Ready a unit to attack in an attempt to capture: it carries the attempt into the fight, and where it can
 * capture its target it fights with its stats halved. A unit that cannot capture this target attacks as ever,
 * with the reason why.
 * @param {import("./combat.mjs").Combatant} unit
 * @param {CaptureCheck} check
 * @param {string} [name]       What the halving goes by in the fight
 * @param {object} [options]
 * @param {boolean} [options.free]    Do its skills leave it no penalty from capturing? It then fights the
 *                                    attempt with its stats as they are
 * @returns {import("./combat.mjs").Combatant}
 */
export function readyCapture(unit, check, name, { free = false } = {}) {
  if ( !check.ok || !unit.skills || free ) return { ...unit, capture: check };
  return { ...unit, capture: check, skills: [...unit.skills, captureEntry(name)] };
}

/* -------------------------------------------- */

/**
 * @typedef CaptureOutcome
 * @property {boolean} held       Is the target carried by its captor now? Otherwise it is subdued where it
 *                                stands, for its captor to pick up
 * @property {number} hp          The HP the target had before, which it returns with if it gets free
 * @property {number} turns       For a subdued target: how many turns of its captor may end before it comes to
 * @property {{uuid: string, name: string}} captor
 * @property {{uuid: string, name: string}} captive
 */

/**
 * What an attempt to capture came to: the target was brought to 0 HP in it, by a captor that still stands.
 * @param {import("./combat.mjs").ExchangePlan} plan
 * @param {import("./combat.mjs").ExchangeResult} result
 * @returns {CaptureOutcome|null}     Null for a fight that was no attempt, or an attempt that failed
 */
export function captureOutcome(plan, result) {
  const config = FEO.optional.capturing;
  const attempt = plan.initiator.unit.capture;
  if ( !config.enabled || !attempt?.ok || !result.attacks.length ) return null;
  if ( !result.defender.defeated || (result.initiator.hp <= 0) ) return null;
  const held = plan.distance <= 1;
  return {
    held,
    hp: result.defender.hpStart,
    turns: held ? 0 : config.subdued,
    captor: { uuid: plan.initiator.unit.uuid ?? "", name: plan.initiator.unit.name ?? "" },
    captive: { uuid: plan.defender.unit.uuid ?? "", name: plan.defender.unit.name ?? "" }
  };
}

/* -------------------------------------------- */

/**
 * A turn of a unit ends while a unit it subdued waits to be picked up: the wait grows shorter, and once it is
 * over the subdued unit comes to.
 * @param {{uuid?: string, held?: boolean, turns?: number}} [captive]     What the unit keeps of its captive
 * @returns {{turns: number, wakes: boolean}|null}      Null for a unit with nobody waiting
 */
export function tickSubdued(captive) {
  if ( !captive?.uuid || captive.held ) return null;
  const turns = Math.max((captive.turns ?? 0) - 1, 0);
  return { turns, wakes: turns <= 0 };
}

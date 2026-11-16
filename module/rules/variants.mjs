/**
 * The combat variants: Optional Modules that each change a single rule of combat. Pure functions of plain data,
 * so that they can be tested outside of Foundry.
 *
 * Follow-up Critical Multiplier. Every unit has an FCM, from 1 to 5. On a follow-up attack, the second attack a
 * unit makes for having the Attack Speed lead, its Critical is multiplied by its FCM before the foe's Critical
 * Avoid is taken off: a Critical of 5 is one of 10 for a unit with an FCM of 2. An FCM of 1 changes nothing.
 *
 * A weapon that strikes twice with every attack does not make its second strike a follow-up. Only the strikes
 * of the follow-up attack itself are multiplied: the third and fourth of the four such a weapon strikes when
 * its unit follows up. The attacks a skill adds to a fight are no follow-ups either, while the attacks a skill
 * turns one attack into are that attack still.
 *
 * The multiplier is one of the chance of a critical hit. What a critical hit multiplies damage by is another
 * matter entirely, and is left alone.
 */
import { FEO } from "../config.mjs";

/**
 * Does the world play with the Follow-up Critical Multiplier?
 * @returns {boolean}
 */
export function fcmInUse() {
  return FEO.optional.followUpCritical.enabled;
}

/* -------------------------------------------- */

/**
 * What a unit's Critical is multiplied by on its follow-up attacks: its FCM as a whole number, held between
 * the lowest and the highest an FCM can be. Where the world does not play with it, or for a unit without one,
 * that is 1.
 * @param {number} [fcm]      The unit's FCM
 * @param {{enabled: boolean, base: number, max: number}} [config]    FEO.optional.followUpCritical
 * @returns {number}
 */
export function followUpTimes(fcm, config = FEO.optional.followUpCritical) {
  if ( !config.enabled ) return 1;
  const value = Math.floor(Number(fcm));
  if ( !Number.isFinite(value) ) return config.base;
  return Math.min(Math.max(value, config.base), config.max);
}

/* -------------------------------------------- */

/**
 * A Critical as a follow-up attack counts it, before the foe's Critical Avoid is taken off.
 * @param {number} critical   The unit's Critical
 * @param {number} [fcm]      The unit's FCM
 * @returns {number}
 */
export function followUpCritical(critical, fcm) {
  return (critical ?? 0) * followUpTimes(fcm);
}

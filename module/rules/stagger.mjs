/**
 * Stagger, an Optional Module. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * Every unit has a Stagger bar beside its HP, as large as a share of the HP it has when the bar is made: when a
 * battle begins, or the first time the bar is needed. The HP a unit loses comes off its bar too, whatever took
 * it, except in a fight the unit began itself. A unit whose bar is empty is Staggered: it takes double damage
 * from everything and cannot act, for the rest of the turn it happens in and until the end of its own next turn.
 * It then recovers, and its bar is full again.
 *
 * Healing does nothing for the bar. It regains a share of its full size as each of the unit's turns starts,
 * unless the unit is Staggered, whose bar stays empty until it recovers.
 *
 * Staggered is no condition: nothing cures it, and it is kept on the unit with its bar.
 */
import { FEO } from "../config.mjs";

/**
 * @typedef StaggerBar
 * @property {number} value     What is left of the bar
 * @property {number} max       Its full size; 0 for a bar that was not made yet
 * @property {number} turns     For a Staggered unit, the ends of its own turn left before it recovers; else 0
 */

const whole = (value) => Math.max(Math.floor(Number(value) || 0), 0);

/**
 * Does the world play with Stagger?
 * @returns {boolean}
 */
export function staggerInUse() {
  return FEO.optional.stagger.enabled;
}

/* -------------------------------------------- */

/**
 * The full size of the Stagger bar of a unit with an amount of HP: a share of it, rounded down, and never
 * less than 1 for a unit with any HP at all.
 * @param {number} hp     The HP the unit has as the bar is made
 * @returns {number}
 */
export function staggerMax(hp) {
  if ( !(hp > 0) ) return 0;
  return Math.max(Math.floor(((hp * FEO.optional.stagger.share) / 100) + 1e-9), 1);
}

/* -------------------------------------------- */

/**
 * What a Stagger bar regains as its unit's turn starts: a share of its full size, rounded down, and never less
 * than 1.
 * @param {number} max    The full size of the bar
 * @returns {number}
 */
export function staggerRegain(max) {
  if ( !(max > 0) ) return 0;
  return Math.max(Math.floor(((max * FEO.optional.stagger.regain) / 100) + 1e-9), 1);
}

/* -------------------------------------------- */

/**
 * The Stagger bar of a unit as it stands. A bar that was not made yet is as large as the HP the unit has now
 * makes it, and full.
 * @param {Partial<StaggerBar>|null} [kept]   What the unit keeps of its bar
 * @param {number} [hp]                       The HP the unit has
 * @returns {StaggerBar}
 */
export function staggerOf(kept, hp = 0) {
  const turns = Math.min(whole(kept?.turns), FEO.optional.stagger.turns.own);
  const max = whole(kept?.max);
  if ( max > 0 ) return { value: turns ? 0 : Math.min(whole(kept?.value), max), max, turns };
  const made = staggerMax(hp);
  return { value: turns ? 0 : made, max: made, turns };
}

/* -------------------------------------------- */

/**
 * Is a unit Staggered?
 * @param {Partial<StaggerBar>|null} [bar]
 * @returns {boolean}
 */
export function isStaggered(bar) {
  return staggerInUse() && ((bar?.turns ?? 0) > 0);
}

/* -------------------------------------------- */

/**
 * What the damage a unit takes is multiplied by: more than 1 for a Staggered unit.
 * @param {Partial<StaggerBar>|null} [bar]
 * @returns {number}
 */
export function staggerTimes(bar) {
  return isStaggered(bar) ? FEO.optional.stagger.taken : 1;
}

/* -------------------------------------------- */

/**
 * A new battle: the bar is made anew from the HP the unit has, and is full.
 * @param {number} hp
 * @returns {StaggerBar}
 */
export function staggerReset(hp) {
  const max = staggerMax(hp);
  return { value: max, max, turns: 0 };
}

/* -------------------------------------------- */

/**
 * A unit loses HP, which comes off its Stagger bar. A bar that is emptied Staggers a unit that still stands:
 * until the end of its next turn, and of the one after that when it happens during its own turn, which it then
 * has the rest of to sit out as well.
 * @param {StaggerBar} bar                  The bar as `staggerOf` gives it
 * @param {number} lost                     The HP the unit lost
 * @param {object} [options]
 * @param {boolean} [options.inTurn]        Is it the unit's own turn, which has not ended yet?
 * @param {boolean} [options.standing]      Does the unit have HP left?
 * @returns {StaggerBar & {lost: number, staggered: boolean}}
 *          The bar afterwards, what came off it, and whether the unit came to be Staggered
 */
export function staggerHit(bar, lost, { inTurn = false, standing = true } = {}) {
  const amount = whole(lost);
  if ( !amount || !(bar?.max > 0) || (bar.turns > 0) ) {
    return { value: bar?.value ?? 0, max: bar?.max ?? 0, turns: bar?.turns ?? 0, lost: 0, staggered: false };
  }
  const value = Math.max(bar.value - amount, 0);
  const staggered = (value <= 0) && standing;
  const { own, away } = FEO.optional.stagger.turns;
  return { value, max: bar.max, turns: staggered ? (inTurn ? own : away) : 0, lost: bar.value - value, staggered };
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: its bar regains a share of its full size. The bar of a Staggered unit stays empty.
 * @param {StaggerBar} bar
 * @returns {StaggerBar & {regained: number}}
 */
export function staggerTurnStart(bar) {
  if ( !(bar?.max > 0) || (bar.turns > 0) ) return { value: bar?.value ?? 0, max: bar?.max ?? 0, turns: bar?.turns ?? 0, regained: 0 };
  const value = Math.min(bar.value + staggerRegain(bar.max), bar.max);
  return { value, max: bar.max, turns: 0, regained: value - bar.value };
}

/* -------------------------------------------- */

/**
 * A unit's turn ends: a Staggered unit is one turn nearer to recovering, and one that recovers has a full bar
 * again.
 * @param {StaggerBar} bar
 * @returns {StaggerBar & {recovered: boolean}}
 */
export function staggerTurnEnd(bar) {
  if ( !(bar?.turns > 0) ) return { value: bar?.value ?? 0, max: bar?.max ?? 0, turns: 0, recovered: false };
  const turns = bar.turns - 1;
  return { value: turns ? 0 : bar.max, max: bar.max, turns, recovered: turns === 0 };
}

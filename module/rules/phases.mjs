/**
 * The order of Phases in a battle: which sides take one, and whose comes next. A side takes a Phase while it
 * has a unit in the fight. A side whose units are all out of it (dead, retreated or captured: see `outOfFight`
 * in `defeat.mjs`) takes none until one of them is back or another joins it; an Incapacitated unit is still in
 * the fight, since its timer runs on its own turns and it may give one up to act.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * @typedef PhaseUnit
 * @property {string} army      The side it fights for
 * @property {boolean} [out]    Is it out of the fight?
 */

/**
 * The sides that take a Phase, in the order they take them: those with a unit in the fight. Should nobody be
 * left in the fight at all, every side that is there takes its Phase as before, so that the battle goes on
 * turning until the Game Master ends it.
 * @param {PhaseUnit[]} units     The units taking part in the battle
 * @param {string[]} order        Every side there is, in the order of their Phases
 * @returns {string[]}
 */
export function phaseSides(units, order) {
  const present = new Set();
  const standing = new Set();
  for ( const unit of units ?? [] ) {
    present.add(unit.army);
    if ( !unit.out ) standing.add(unit.army);
  }
  const takes = standing.size ? standing : present;
  return order.filter((army) => takes.has(army));
}

/* -------------------------------------------- */

/**
 * Whose Phase begins when one ends: that of the next side in the order that takes one. Once the last of them
 * has had its Phase a new turn of the battle begins with the first, which is the same side again when it is
 * the only one left.
 * @param {string|null} phase     The side whose Phase ends; it need not take one any more itself
 * @param {string[]} sides        The sides that take a Phase, in order (see `phaseSides`)
 * @param {string[]} order        Every side there is, in the order of their Phases
 * @returns {{army: string, turn: boolean}|null}    The side, and whether a new turn of the battle begins
 *                                                  with it; null if no side takes a Phase
 */
export function phaseAfter(phase, sides, order) {
  if ( !sides?.length ) return null;
  const at = order.indexOf(phase);
  if ( at >= 0 ) {
    for ( const army of order.slice(at + 1) ) if ( sides.includes(army) ) return { army, turn: false };
  }
  return { army: sides[0], turn: true };
}

/* -------------------------------------------- */

/**
 * The sides the Phase banner lists: those that take a Phase, and the one whose Phase is running even if its
 * last unit has just fallen.
 * @param {string|null} phase     The side whose Phase it is
 * @param {string[]} sides        The sides that take a Phase, in order (see `phaseSides`)
 * @param {string[]} order        Every side there is, in the order of their Phases
 * @returns {string[]}
 */
export function listedSides(phase, sides, order) {
  return order.filter((army) => sides.includes(army) || (army === phase));
}

/**
 * Which tokens can be made one with their unit, for Fire Emblem Online. Foundry places a token either linked
 * to its Actor, so that the token and the sheet are the same unit, or as a copy that goes its own way from the
 * moment it is placed and keeps whatever changes on it for itself. Pure functions of plain data, so that they
 * can be tested outside of Foundry.
 *
 * A copy that was never changed holds nothing its unit lacks, and can be linked with nothing lost. One that
 * was changed holds what happened to it on the map, which linking would hide, and is left for the table to see
 * to.
 *
 * Nothing here touches Foundry: `helpers/linking.mjs` links what these say can be.
 */

/**
 * Is there nothing in a value: null, an empty list, or an object with nothing in it at any depth?
 * @param {*} value
 * @returns {boolean}
 */
export function bare(value) {
  if ( (value === null) || (value === undefined) ) return true;
  if ( Array.isArray(value) ) return !value.length;
  if ( typeof value === "object" ) return Object.values(value).every(bare);
  return false;
}

/* -------------------------------------------- */

/**
 * Does a token's copy of its unit hold nothing of its own? What the copy changes of its unit is kept as a
 * delta: a name, a picture, numbers, items, effects and flags, each only where they differ.
 * @param {object|null} [delta]     The source of the token's ActorDelta
 * @returns {boolean}
 */
export function keepsNothing(delta) {
  if ( !delta ) return true;
  const { _id, ...own } = delta;
  return bare(own);
}

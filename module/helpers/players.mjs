/**
 * Who plays which unit. A unit is a player's when a player owns it, or when it is the character a user has
 * chosen for themselves. A Game Master may choose one too: Foundry counts no Game Master among the owners of
 * anything, so their character is found by that choice, and is played like any other when someone else runs
 * the battle.
 */

/**
 * The user who has chosen a unit as their character, whatever their role.
 * @param {Actor|null} actor
 * @returns {User|null}
 */
export function characterOf(actor) {
  if ( !actor?.id || actor.inCompendium ) return null;
  return game.users.find((user) => user.character?.id === actor.id) ?? null;
}

/* -------------------------------------------- */

/**
 * Is a unit a player's: one a player owns, or the chosen character of any user?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isPlayerUnit(actor) {
  return !!actor && (!!actor.hasPlayerOwner || !!characterOf(actor));
}

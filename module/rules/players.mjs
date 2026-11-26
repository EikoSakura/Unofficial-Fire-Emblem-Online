/**
 * Who plays which unit, where one person has more than one user, for Fire Emblem Online. Pure functions of plain
 * data, so that they can be tested outside of Foundry; `helpers/players.mjs` reads the world for them.
 *
 * On The Forge a Game Master may join a game "as a temporary player": The Forge logs them in as a user of the
 * Player role that is not their own. It marks that user as temporary, and marks every user it knows the
 * account of with that account. A Game Master's character is chosen on their own user, so it is found from the
 * temporary one by the account the two share, and handed over.
 *
 * Only a Game Master's client can make someone the owner of a unit, and a Game Master who plays is not one for
 * as long as they do. So a temporary player notes on themselves which user they are the rest of the time, and
 * whichever Game Master is next in the game, they themselves once they are back, hands the character over. It
 * is theirs already the next time they come in as a temporary player.
 */

/** Where The Forge keeps what it knows of a user: its flags, of which these are read. */
export const FORGE_SCOPE = "forge-vtt";

/**
 * @typedef UserLike
 * A user, as far as these rules read one.
 * @property {string} id
 * @property {boolean} [active]              Are they in the game now?
 * @property {string|null} [character]       The id of the Actor they chose as their character
 * @property {string} [playsAs]              For a temporary player: the user they noted they are the rest of the time
 * @property {Record<string, object>} [flags]
 */

/**
 * Is a user one The Forge made for a Game Master to play as for a while?
 * @param {UserLike|null} user
 * @returns {boolean}
 */
export function isTemporary(user) {
  return !!user?.flags?.[FORGE_SCOPE]?.temporary;
}

/**
 * The account of The Forge a user is the user of, as The Forge notes it on them.
 * @param {UserLike|null} user
 * @returns {string}        Blank where it notes none
 */
export function accountOf(user) {
  const account = user?.flags?.[FORGE_SCOPE]?.player;
  return ((account ?? null) === null) || (typeof account === "object") ? "" : String(account);
}

/**
 * May a user be the one a temporary player is the rest of the time? It is a user of their own that is not
 * temporary: where both are noted with an account, it is the same one.
 * @param {UserLike|null} temp      The temporary player
 * @param {UserLike|null} own       The other user
 * @returns {boolean}
 */
export function mayPlayAs(temp, own) {
  if ( !isTemporary(temp) || !own || isTemporary(own) || (own.id === temp.id) ) return false;
  const [theirs, mine] = [accountOf(own), accountOf(temp)];
  return !theirs || !mine || (theirs === mine);
}

/**
 * The user a temporary player is the rest of the time: the one of the same account that is not temporary, or
 * where no account tells, the one they noted on themselves.
 * @param {UserLike} temp           The temporary player
 * @param {UserLike[]} users        The users of the world
 * @param {string} [account]        The account their client is logged in with, where it is known; else the one
 *                                  noted on the temporary player is gone by
 * @returns {UserLike|null}
 */
export function ownUserOf(temp, users, account = "") {
  if ( !isTemporary(temp) ) return null;
  const mine = String(account ?? "") || accountOf(temp);
  const shared = mine ? (users ?? []).find((user) => (user.id !== temp.id) && !isTemporary(user) && (accountOf(user) === mine)) : null;
  if ( shared ) return shared;
  const noted = temp.playsAs ? (users ?? []).find((user) => user.id === temp.playsAs) : null;
  return mayPlayAs(temp, noted) ? noted : null;
}

/**
 * May a temporary player be handed the character of another user? They may where that user is one of their
 * own, and has chosen one.
 * @param {UserLike|null} temp      Who asks
 * @param {UserLike|null} own       Whose character they ask for
 * @returns {boolean}
 */
export function mayTakeOver(temp, own) {
  return mayPlayAs(temp, own) && !!own.character;
}

/**
 * The user who plays a unit, of those who chose it as their character: whoever is in the game now, and of those
 * a user of their own before a temporary one.
 * @param {UserLike[]} users        The users of the world
 * @param {string} actor            The id of the unit
 * @returns {UserLike|null}
 */
export function playerAmong(users, actor) {
  const theirs = (users ?? []).filter((user) => !!actor && (user.character === actor));
  const rank = (user) => (user.active ? 0 : 2) + (isTemporary(user) ? 1 : 0);
  return theirs.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * The owners of a unit once it is handed to a temporary player: they own it, and the temporary players that
 * owned it before them and are gone from the world no longer do.
 * @param {Record<string, number>} ownership    Who may do what with the unit, by user id, and "default"
 * @param {string} temp                         The id of the temporary player
 * @param {string[]} users                      The ids of the users of the world
 * @param {number} owner                        The level of an owner
 * @returns {Record<string, number>|null}       Null where nothing changes
 */
export function handedOwnership(ownership, temp, users, owner) {
  const next = {};
  for ( const [id, level] of Object.entries(ownership ?? {}) ) {
    if ( (id === "default") || users.includes(id) ) next[id] = level;
  }
  next[temp] = owner;
  const before = Object.entries(ownership ?? {});
  const same = (before.length === Object.keys(next).length) && before.every(([id, level]) => next[id] === level);
  return same ? null : next;
}

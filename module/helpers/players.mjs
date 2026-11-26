/**
 * Who plays which unit. A unit is a player's when a player owns it, or when it is the character a user has
 * chosen for themselves. A Game Master may choose one too: Foundry counts no Game Master among the owners of
 * anything, so their character is found by that choice, and is played like any other when someone else runs
 * the battle.
 *
 * A Game Master who joins as a temporary player on The Forge is another user for as long as they do: that user
 * is handed the character of their own, and made its owner, as they come in (see `rules/players.mjs`).
 */

import { FEO } from "../config.mjs";
import { handedOwnership, isTemporary, mayTakeOver, ownUserOf, playerAmong } from "../rules/players.mjs";

/** The query by which a temporary player asks a Game Master for the character of their own user. */
export const TAKE_OVER_QUERY = `${FEO.id}.takeOverCharacter`;

/** A user as the rules read one. */
const plain = (user) => ({ id: user.id, active: user.active, character: user.character?.id ?? null, flags: user.flags });

/**
 * The user who has chosen a unit as their character, whatever their role. Where a Game Master and the temporary
 * player they join as have both chosen it, the one who is in the game is meant.
 * @param {Actor|null} actor
 * @returns {User|null}
 */
export function characterOf(actor) {
  if ( !actor?.id || actor.inCompendium ) return null;
  const found = playerAmong(game.users.map(plain), actor.id);
  return found ? game.users.get(found.id) ?? null : null;
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

/* -------------------------------------------- */
/*  Temporary Players                           */
/* -------------------------------------------- */

/**
 * The account of The Forge this client is logged in with, as The Forge's own script knows it.
 * @returns {Promise<string>}     Blank off The Forge, or where it does not say
 */
async function forgeAccount() {
  const api = globalThis.ForgeAPI;
  if ( !api ) return "";
  try {
    if ( !api.lastStatus && (typeof api.status === "function") ) await api.status();
  } catch(err) {
    console.warn(err);
  }
  const account = api.lastStatus?.user;
  return ((account ?? null) === null) || (typeof account === "object") ? "" : String(account);
}

/**
 * Hand a temporary player the character of their own user: a Game Master's client makes them its owner and
 * their character. Answers the query a temporary player's client sends as it comes in.
 * @param {object} data
 * @param {string} data.user      The temporary player
 * @param {string} data.own       The user they are the rest of the time
 * @returns {Promise<{ok: boolean, name?: string}>}
 */
export async function takeOverQuery({ user, own } = {}) {
  const temp = game.users.get(user);
  const mine = game.users.get(own);
  if ( !game.user.isGM || !temp || !mine || !mayTakeOver(plain(temp), plain(mine)) ) return { ok: false };
  const actor = mine.character;
  if ( !actor ) return { ok: false };

  const ownership = handedOwnership(actor.ownership, temp.id, game.users.map((other) => other.id), CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  if ( ownership ) await actor.update({ ownership }, { diff: false, recursive: false });
  if ( temp.character?.id !== actor.id ) await temp.update({ character: actor.id });
  return { ok: true, name: actor.name };
}

/**
 * As a temporary player comes in, take up the character of the user they are the rest of the time. A Game
 * Master does the handing over, so it waits for one where none is in the game yet.
 * @returns {Promise<void>}
 */
async function takeUpCharacter() {
  const me = game.user;
  if ( !isTemporary(plain(me)) ) return;
  const found = ownUserOf(plain(me), game.users.map(plain), await forgeAccount());
  const own = found ? game.users.get(found.id) : null;
  const actor = own?.character;
  if ( !actor ) return;
  if ( (me.character?.id === actor.id) && actor.isOwner ) return;

  const ask = async () => {
    const gm = game.users.activeGM;
    if ( !gm ) return false;
    try {
      const result = await gm.query(TAKE_OVER_QUERY, { user: me.id, own: own.id }, { timeout: 15000 });
      if ( !result?.ok ) return false;
      ui.notifications.info(game.i18n.format("FEO.Players.takenOver", { name: result.name ?? actor.name }));
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  };
  if ( await ask() ) return;

  // No Game Master to hand it over yet: ask again as one comes in
  const hook = Hooks.on("userConnected", async (user, connected) => {
    if ( !connected || !user.isGM ) return;
    if ( await ask() ) Hooks.off("userConnected", hook);
  });
}

/**
 * Register the query that hands a character over, and take one up once the world is ready.
 */
export function registerPlayers() {
  CONFIG.queries[TAKE_OVER_QUERY] = takeOverQuery;
  Hooks.once("ready", () => takeUpCharacter().catch((err) => console.error(err)));
}

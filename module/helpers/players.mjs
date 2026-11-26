/**
 * Who plays which unit. A unit is a player's when a player owns it, or when it is the character a user has
 * chosen for themselves. A Game Master may choose one too: Foundry counts no Game Master among the owners of
 * anything, so their character is found by that choice, and is played like any other when someone else runs
 * the battle.
 *
 * A Game Master who joins as a temporary player on The Forge is another user for as long as they do: that user
 * is handed the character of their own, and made its owner (see `rules/players.mjs`). A Game Master's client
 * does the handing over: the one in the game as they come in, or the next to come in, which may be their own
 * once they are back. From then on the character is theirs whenever they come in as a temporary player.
 */

import { FEO } from "../config.mjs";
import { handedOwnership, isTemporary, mayTakeOver, ownUserOf, playerAmong } from "../rules/players.mjs";

/** The query by which a temporary player asks a Game Master for the character of their own user. */
export const TAKE_OVER_QUERY = `${FEO.id}.takeOverCharacter`;

/** The flag, on a temporary player, that notes the user they are the rest of the time. */
export const PLAYS_AS_FLAG = "playsAs";

/** A user as the rules read one. */
const plain = (user) => ({
  id: user.id, active: user.active, character: user.character?.id ?? null, flags: user.flags,
  playsAs: String(user.flags?.[FEO.id]?.[PLAYS_AS_FLAG] ?? "")
});

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
 * Hand a temporary player the character of the user they are the rest of the time: they are made its owner, and
 * it is made their character. Nothing is saved where both already hold. Only a Game Master may.
 * @param {User} temp
 * @param {User} own
 * @returns {Promise<boolean>}    Was the character theirs once this was done?
 */
async function handOver(temp, own) {
  if ( !game.user.isGM || !mayTakeOver(plain(temp), plain(own)) ) return false;
  const actor = own.character;
  const ownership = handedOwnership(actor.ownership, temp.id, game.users.map((other) => other.id), CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  if ( ownership ) await actor.update({ ownership }, { diff: false, recursive: false });
  if ( temp.character?.id !== actor.id ) await temp.update({ character: actor.id });
  return true;
}

/**
 * Hand a temporary player their character, as their client asks for it.
 * @param {object} data
 * @param {string} data.user      The temporary player
 * @param {string} data.own       The user they are the rest of the time
 * @returns {Promise<{ok: boolean}>}
 */
export async function takeOverQuery({ user, own } = {}) {
  const temp = game.users.get(user);
  const mine = game.users.get(own);
  return { ok: !!temp && !!mine && await handOver(temp, mine) };
}

/**
 * Hand every temporary player of the world the character of the user they are the rest of the time. The Game
 * Master whose client answers for the world does it, so that it is done once.
 * @returns {Promise<void>}
 */
async function handOverAll() {
  if ( !game.users.activeGM?.isSelf ) return;
  const users = game.users.map(plain);
  for ( const temp of game.users ) {
    if ( !isTemporary(plain(temp)) ) continue;
    const found = ownUserOf(plain(temp), users);
    if ( found ) await handOver(temp, game.users.get(found.id));
  }
}

/**
 * As a temporary player comes in, take up the character of the user they are the rest of the time: note who
 * that is, and ask a Game Master for the character. Where none is in the game, the note is what the next one
 * to come in goes by. The player is told how it stands.
 * @returns {Promise<void>}
 */
async function takeUpCharacter() {
  const me = game.user;
  if ( !isTemporary(plain(me)) ) return;
  const told = (key, data = {}) => ui.notifications.info(game.i18n.format(`FEO.Players.${key}`, data));

  const found = ownUserOf(plain(me), game.users.map(plain), await forgeAccount());
  const own = found ? game.users.get(found.id) : null;
  if ( !own ) {
    ui.notifications.warn(game.i18n.localize("FEO.Players.unknown"));
    return;
  }
  if ( me.getFlag(FEO.id, PLAYS_AS_FLAG) !== own.id ) await me.setFlag(FEO.id, PLAYS_AS_FLAG, own.id);
  const actor = own.character;
  if ( !actor ) {
    told("noCharacter", { user: own.name });
    return;
  }
  const mine = () => (me.character?.id === actor.id) && actor.isOwner;
  if ( mine() ) return;

  // It is told once the character is theirs, whichever way it was handed over
  const arrived = Hooks.on("updateUser", (user) => {
    if ( !user.isSelf || !mine() ) return;
    Hooks.off("updateUser", arrived);
    told("takenOver", { name: actor.name });
  });
  const gm = game.users.activeGM;
  if ( !gm ) {
    told("waiting", { name: actor.name });
    return;
  }
  try {
    await gm.query(TAKE_OVER_QUERY, { user: me.id, own: own.id }, { timeout: 15000 });
  } catch(err) {
    console.error(err);
  }
}

/**
 * Register the query that hands a character over, take one up as a temporary player comes in, and have a Game
 * Master hand over what waits: as they come in, as a temporary player joins or notes who they are, and as a
 * user chooses another character.
 */
export function registerPlayers() {
  CONFIG.queries[TAKE_OVER_QUERY] = takeOverQuery;
  const later = () => handOverAll().catch((err) => console.error(err));
  Hooks.once("ready", () => {
    takeUpCharacter().catch((err) => console.error(err));
    later();
  });
  Hooks.on("createUser", later);
  Hooks.on("userConnected", (user, connected) => {
    if ( connected ) later();
  });
  Hooks.on("updateUser", (user, changes) => {
    if ( ("character" in changes) || (changes.flags?.[FEO.id] && (PLAYS_AS_FLAG in changes.flags[FEO.id])) ) later();
  });
}

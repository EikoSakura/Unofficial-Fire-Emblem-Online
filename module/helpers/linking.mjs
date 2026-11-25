import { FEO } from "../config.mjs";
import { keepsNothing } from "../rules/linking.mjs";
import { ownerOf } from "./base.mjs";
import { postCard } from "./chat.mjs";

/**
 * A player's unit stands on the map as itself. Foundry places a token either linked to its Actor, so that the
 * token and the sheet are one unit, or as a copy that goes its own way from the moment it is placed. A unit
 * that belongs to a player is one person wherever it is put, so its token is linked without anyone ticking the
 * box:
 *
 * - a unit a player makes is linked as it is made;
 * - a unit that becomes a player's, because a Game Master makes them its owner or a user chooses it as their
 *   character, is linked then;
 * - the units that were players' before this was done are linked once for each world, as a Game Master opens it.
 *
 * It is done as a unit becomes a player's and not kept so: a Game Master who unticks the box afterwards has it
 * stay unticked. An ally the Base has only handed to a player to run is not theirs, and is left as it is, and so
 * is every unit of the Game Master's, which is placed as the NPC Builder or the Game Master set it.
 *
 * A token of the unit that is on a map already, as a copy, is linked too where it holds nothing of its own (see
 * `rules/linking.mjs`); one that does is left as a copy, and the Game Master is told of it.
 *
 * It can be run again at any time with `game.feo.linking.linkPlayerUnits()`.
 */

/** The world setting that keeps whether the world's player units have been linked. */
const SETTING = "playerTokensLinked";

/**
 * The units that belonged to a player when this client last looked, by id. Foundry's own window for who owns
 * what saves without asking anyone beforehand, so what a unit was is kept here to tell what it has become.
 * @type {Set<string>}
 */
let known = new Set();

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * Does a unit belong to a player: is it a user's chosen character, has a player been made its owner, or is
 * everyone its owner? A player the Base has only handed an ally to does not count.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function belongsToPlayer(actor) {
  if ( (actor?.type !== "unit") || actor.pack ) return false;
  if ( ownerOf(actor) ) return true;
  return (actor.ownership?.default ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
}

/* -------------------------------------------- */

/**
 * Look at a unit again, and say whether it has become a player's since it was last looked at.
 * @param {Actor} actor
 * @returns {boolean}
 */
function becamePlayers(actor) {
  const was = known.has(actor.id);
  const now = belongsToPlayer(actor);
  if ( now ) known.add(actor.id);
  else known.delete(actor.id);
  return now && !was;
}

/* -------------------------------------------- */
/*  Linking                                     */
/* -------------------------------------------- */

/**
 * Link a unit to its tokens: the token it places from now on, and those already on a map that hold nothing of
 * their own. The tokens on the maps are a Game Master's to change, and are left alone for anyone else.
 * @param {Actor} actor
 * @returns {Promise<{unit: boolean, tokens: string[], copies: string[]}>}
 *   Whether the unit's own token was changed, the tokens on the maps that were linked, and those left as copies
 */
export async function linkUnit(actor) {
  const report = { unit: false, tokens: [], copies: [] };
  if ( (actor?.type !== "unit") || !game.actors.has(actor.id) ) return report;
  if ( !actor.prototypeToken.actorLink ) {
    await actor.update({ "prototypeToken.actorLink": true });
    report.unit = true;
  }
  if ( !game.user.isGM ) return report;
  for ( const scene of game.scenes ) {
    const copies = scene.tokens.filter((token) => (token.actorId === actor.id) && !token.actorLink);
    if ( !copies.length ) continue;
    const named = (token) => `${token.name} (${scene.name})`;
    const clean = copies.filter((token) => keepsNothing(token._source.delta));
    report.copies.push(...copies.filter((token) => !clean.includes(token)).map(named));
    if ( !clean.length ) continue;
    await scene.updateEmbeddedDocuments("Token", clean.map((token) => ({ _id: token.id, actorLink: true })));
    report.tokens.push(...clean.map(named));
  }
  return report;
}

/* -------------------------------------------- */

/**
 * A unit has just become a player's: link it, and say so where a token of it had to be left as a copy.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function linkNew(actor) {
  const { copies } = await linkUnit(actor);
  if ( !copies.length ) return;
  ui.notifications.warn(game.i18n.format("FEO.Linking.copiesLeft", { name: actor.name, list: copies.join(", ") }), { permanent: true });
}

/* -------------------------------------------- */

/**
 * Link every unit of the world that belongs to a player. A Game Master's to do.
 * @param {object} [options]
 * @param {boolean} [options.tell]    Post what changed to the Game Masters?
 * @returns {Promise<{units: string[], tokens: string[], copies: string[]}|null>}
 *   The units whose own token was changed, the tokens on the maps that were linked, and those left as copies;
 *   null for a player
 */
export async function linkPlayerUnits({ tell = true } = {}) {
  if ( !game.user.isGM ) return null;
  const report = { units: [], tokens: [], copies: [] };
  for ( const actor of Array.from(game.actors) ) {
    if ( !belongsToPlayer(actor) ) continue;
    try {
      const told = await linkUnit(actor);
      if ( told.unit ) report.units.push(actor.name);
      report.tokens.push(...told.tokens);
      report.copies.push(...told.copies);
    } catch(err) {
      console.error(`${FEO.id} | ${actor.name} could not be linked to its tokens.`, err);
    }
  }
  if ( tell ) await tellLinked(report);
  return report;
}

/* -------------------------------------------- */

/**
 * Tell the Game Masters which units were linked, and which tokens were left as copies.
 * @param {{units: string[], tokens: string[], copies: string[]}} report
 * @returns {Promise<ChatMessage|null>}     Null when nothing changed and nothing is left to see to
 */
async function tellLinked(report) {
  const i18n = game.i18n;
  if ( !report.units.length && !report.tokens.length && !report.copies.length ) return null;
  const rows = [];
  if ( report.units.length ) rows.push({ label: i18n.localize("FEO.Linking.units"), value: report.units.join(", ") });
  if ( report.tokens.length ) rows.push({ label: i18n.localize("FEO.Linking.tokens"), value: report.tokens.join(", ") });
  if ( report.copies.length ) rows.push({ label: i18n.localize("FEO.Linking.copies"), value: report.copies.join(", ") });
  return postCard(null, {
    title: i18n.localize("FEO.Linking.title"),
    subtitle: i18n.format("FEO.Linking.count", { units: report.units.length, tokens: report.tokens.length }),
    rows,
    note: i18n.localize(report.copies.length ? "FEO.Linking.noteCopies" : "FEO.Linking.note")
  }, { whisper: game.users.filter((user) => user.isGM).map((user) => user.id) });
}

/* -------------------------------------------- */
/*  Registering                                 */
/* -------------------------------------------- */

/**
 * Register the setting the world remembers its linking by, and what linking listens for. Called once, when the
 * system starts.
 */
export function registerHooks() {
  game.settings.register(FEO.id, SETTING, { scope: "world", config: false, type: Boolean, default: false });

  // A unit a player makes, or one that is made as a player's own, is linked as it is made
  Hooks.on("preCreateActor", (actor, data, options) => {
    if ( (actor.type !== "unit") || actor.pack || options?.pack ) return;
    if ( !game.user.isGM || belongsToPlayer(actor) ) actor.updateSource({ prototypeToken: { actorLink: true } });
  });
  Hooks.on("createActor", (actor) => {
    if ( belongsToPlayer(actor) ) known.add(actor.id);
  });

  // A unit a player is made the owner of is linked then, by whoever made them so. The Base only lends an ally
  // to the player who runs it, which is not linked
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( (actor.type !== "unit") || !("ownership" in changed) || options?.[FEO.id]?.lending ) return;
    if ( becamePlayers(actor) && (userId === game.user.id) ) linkNew(actor).catch((err) => console.error(err));
  });

  // And so is the unit a user chooses as their character, where it was nobody's before
  Hooks.on("updateUser", (user, changed) => {
    if ( !("character" in changed) ) return;
    const actor = user.character;
    const fresh = !!actor && becamePlayers(actor);
    known = new Set(game.actors.filter(belongsToPlayer).map((unit) => unit.id));
    if ( fresh && game.users.activeGM?.isSelf ) linkNew(actor).catch((err) => console.error(err));
  });

  // The units that were players' before any of this are linked once, as a Game Master opens the world
  Hooks.once("ready", () => {
    known = new Set(game.actors.filter(belongsToPlayer).map((unit) => unit.id));
    if ( !game.users.activeGM?.isSelf || game.settings.get(FEO.id, SETTING) ) return;
    linkPlayerUnits().then(() => game.settings.set(FEO.id, SETTING, true)).catch((err) => console.error(err));
  });
}

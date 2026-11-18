import { FEO } from "../config.mjs";
import {
  isStaggered, staggerHit, staggerInUse, staggerOf, staggerReset, staggerTurnEnd, staggerTurnStart
} from "../rules/stagger.mjs";
import { postCard } from "./chat.mjs";
import { turnState } from "./phases.mjs";

/**
 * Stagger in Foundry: the Stagger bar a unit keeps beside its HP. Whenever a unit loses HP, whatever took it,
 * the same amount comes off its bar, and a unit whose bar is emptied is Staggered. A fight follows the bars of
 * its two units by itself, strike by strike, and saves what it left of them (see `exchange.mjs`); everything
 * else is followed here. The bar regains a share as its unit's turn starts, a Staggered unit recovers as its
 * turn ends, and a new battle makes every bar anew.
 */

/** The update option that says a fight has settled what the HP a unit lost in it does to its Stagger bar. */
export const STAGGER_SETTLED = "staggerSettled";

/** The update option that carries the units an update Staggered, by Actor UUID. */
const STAGGERED = "feoStaggered";

const nameOf = (actor) => actor.token?.name ?? actor.name;
const kept = (bar) => ({ value: bar.value, max: bar.max, turns: bar.turns });

/**
 * The Stagger bar of a unit as it stands.
 * @param {Actor} actor
 * @returns {import("../rules/stagger.mjs").StaggerBar}
 */
export function staggerBarOf(actor) {
  const system = actor.system;
  return staggerOf(actor._source?.system?.stagger ?? system.stagger, system.hp.value);
}

/* -------------------------------------------- */

/**
 * Is it a unit's own turn, which has not ended yet? Outside of a battle nothing is counted, and it is not.
 * @param {Actor} actor
 * @returns {boolean}
 */
function inTurn(actor) {
  const state = turnState(actor, actor.token ?? null);
  return (state === "ready") || (state === "moving");
}

/* -------------------------------------------- */

/**
 * Tell a Staggered unit that it cannot act, where it is about to.
 * @param {Actor} actor
 * @returns {boolean}     Whether the unit is Staggered
 */
export function staggerStops(actor) {
  if ( !isStaggered(actor?.system?.stagger) ) return false;
  ui.notifications.warn("FEO.Optional.stagger.cannotAct", { localize: true });
  return true;
}

/* -------------------------------------------- */

/**
 * Stagger a unit, or have it recover, as a Game Master does by hand. A unit that recovers has a full bar again.
 * @param {Actor} actor
 * @param {boolean} [on]      Whether it is Staggered; the other way round from now unless given
 * @returns {Promise<boolean>}    Whether anything changed
 */
export async function setStagger(actor, on = !isStaggered(actor?.system?.stagger)) {
  if ( !staggerInUse() || (actor?.type !== "unit") ) return false;
  const bar = staggerBarOf(actor);
  if ( (bar.turns > 0) === !!on ) return false;
  const { own, away } = FEO.optional.stagger.turns;
  await actor.update({
    "system.stagger": on ? { value: 0, max: bar.max, turns: inTurn(actor) ? own : away } : { value: bar.max, max: bar.max, turns: 0 }
  });
  return true;
}

/* -------------------------------------------- */
/*  Following HP                                */
/* -------------------------------------------- */

/**
 * Before a unit's HP is lowered, take what it loses off its Stagger bar as well, in the same change. A change
 * that a fight has settled, or that sets the bar itself, is left as it is, but for a bar that is given a size
 * for the first time. Called for an Actor and for the Actor of an unlinked token.
 * @param {Actor|null} actor
 * @param {object} changes
 * @param {object} options      The options of the update, which travel with it
 */
export function planStagger(actor, changes, options) {
  if ( !staggerInUse() || (actor?.type !== "unit") || options?.[FEO.id]?.[STAGGER_SETTLED] ) return;

  // A bar that is given its size by hand is full, unless what is left of it is given as well
  const typed = foundry.utils.getProperty(changes, "system.stagger");
  if ( typed ) {
    const made = (actor._source?.system?.stagger?.max ?? 0) > 0;
    if ( !made && (typed.max > 0) && !("value" in typed) && !("turns" in typed) ) typed.value = typed.max;
    return;
  }
  const hp = foundry.utils.getProperty(changes, "system.hp.value");
  if ( !Number.isFinite(hp) ) return;
  const before = actor.system.hp.value;
  if ( !(hp < before) ) return;
  const bar = staggerOf(actor._source?.system?.stagger ?? actor.system.stagger, before);
  const after = staggerHit(bar, before - hp, { inTurn: inTurn(actor), standing: hp > 0 });
  foundry.utils.setProperty(changes, "system.stagger", kept(after));
  if ( after.staggered && options ) (options[STAGGERED] ??= {})[actor.uuid] = true;
}

/* -------------------------------------------- */

/**
 * After a change that Staggered a unit, say so on a chat card. Runs for the user who made the change.
 * @param {Actor} actor
 * @param {object} changed
 * @param {object} options
 * @param {string} userId
 * @returns {Promise<boolean>}    Whether a card was posted
 */
export async function followStagger(actor, changed, options, userId) {
  if ( (actor?.type !== "unit") || (userId !== game.user.id) || !options?.[STAGGERED]?.[actor.uuid] ) return false;
  delete options[STAGGERED][actor.uuid];
  await postCard(actor, {
    title: game.i18n.format("FEO.Optional.stagger.card.staggeredTitle", { name: nameOf(actor) }),
    subtitle: game.i18n.localize("FEO.Optional.stagger.hint")
  });
  return true;
}

/* -------------------------------------------- */
/*  Turns and Battles                           */
/* -------------------------------------------- */

/**
 * A battle begins: the Stagger bar of every unit in it is made anew from the HP the unit has, and nobody is
 * Staggered.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleStagger(combat) {
  if ( !staggerInUse() ) return;
  const done = new Set();
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || done.has(actor.uuid) || !actor.isOwner ) continue;
    done.add(actor.uuid);
    await actor.update({ "system.stagger": staggerReset(actor.system.hp.value) });
  }
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: its Stagger bar regains a share of its full size, unless the unit is Staggered.
 * @param {Actor} actor
 * @returns {Promise<number>}     What the bar regained
 */
export async function startStaggerTurnFor(actor) {
  if ( !staggerInUse() || (actor?.type !== "unit") || actor.system.defeat?.state ) return 0;
  const after = staggerTurnStart(staggerBarOf(actor));
  if ( after.regained ) await actor.update({ "system.stagger": kept(after) });
  return after.regained;
}

/* -------------------------------------------- */

/**
 * A unit's turn ends: a Staggered unit is one turn nearer to recovering. One that recovers has a full bar
 * again, and a chat card says so.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether the unit recovered
 */
export async function endStaggerTurnFor(actor) {
  if ( !staggerInUse() || (actor?.type !== "unit") ) return false;
  const bar = staggerBarOf(actor);
  if ( !(bar.turns > 0) ) return false;
  const after = staggerTurnEnd(bar);
  await actor.update({ "system.stagger": kept(after) });
  if ( after.recovered ) await postCard(actor, {
    title: game.i18n.format("FEO.Optional.stagger.card.recoveredTitle", { name: nameOf(actor) }),
    subtitle: game.i18n.localize("FEO.Optional.stagger.card.recovered")
  });
  return after.recovered;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * The changes that keep the tokens of a scene in step with the rule. Where the world plays with Stagger the
 * bar is a unit's second token bar, beside its HP: a token that shows something else there keeps it, and one
 * that was given the bar once is not given it again if it is taken off. Where the world does not, a token
 * that still shows the bar from when it did shows it no longer.
 * @param {Iterable<TokenDocument>} tokens
 * @returns {object[]}    One update for each token that has to change
 */
export function tokenBarUpdates(tokens) {
  const given = `flags.${FEO.id}.staggerBar`;
  const updates = [];
  for ( const token of tokens ?? [] ) {
    const shown = token.bar2?.attribute ?? null;
    if ( !staggerInUse() ) {
      if ( shown === "stagger" ) updates.push({ _id: token.id, "bar2.attribute": null, [given]: false });
    }
    else if ( !shown && !foundry.utils.getProperty(token, given) && (game.actors.get(token.actorId)?.type === "unit") ) {
      updates.push({ _id: token.id, "bar2.attribute": "stagger", [given]: true });
    }
  }
  return updates;
}

/* -------------------------------------------- */

/**
 * Register what Stagger listens for. Called once, when the system starts.
 */
export function registerHooks() {
  // Tokens that were on a map before are brought in step as the map is drawn, by the Game Master's client
  Hooks.on("canvasReady", () => {
    if ( !game.user.isActiveGM || !canvas.scene ) return;
    const updates = tokenBarUpdates(canvas.scene.tokens);
    if ( updates.length ) canvas.scene.updateEmbeddedDocuments("Token", updates).catch((err) => console.error(err));
  });
  if ( !staggerInUse() ) return;

  // Whatever lowers a unit's HP lowers its Stagger bar
  Hooks.on("preUpdateActor", (actor, changes, options) => planStagger(actor, changes, options));
  Hooks.on("preUpdateActorDelta", (delta, changes, options) => planStagger(delta.syntheticActor, changes, options));
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    followStagger(actor, changed, options, userId).catch((err) => console.error(err));
  });

  // A token shows the bar from the moment it is placed
  Hooks.on("preCreateToken", (token) => {
    const [update] = tokenBarUpdates([token]);
    if ( !update ) return;
    delete update._id;
    token.updateSource(update);
  });
}

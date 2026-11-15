import { FEO } from "../config.mjs";
import { armyOf } from "./exchange.mjs";
import { healFromGround } from "./terrain.mjs";
import { endTurnOf, startTurnOf } from "./turns.mjs";

/**
 * Phases: a battle is played side by side. Every unit of a side may move and take one Action during its
 * side's Phase, in any order; then the next side has its Phase, and once every side has had one a new turn of
 * the battle begins.
 *
 * The encounter keeps whose Phase it is. A unit that has taken its Action carries a mark until its side's
 * next Phase, and a token that has moved remembers where it set out from until its unit acts, so that the
 * move can be taken back.
 */

/** The name of the query that asks a Game Master to end the running Phase. */
export const END_PHASE_QUERY = `${FEO.id}.endPhase`;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * Does an encounter belong to a scene? One that is linked to no scene belongs to them all.
 * @param {Combat} combat
 * @param {Scene|null} scene
 * @returns {boolean}
 */
function foughtOn(combat, scene) {
  return !combat.scene || (combat.scene === scene);
}

/* -------------------------------------------- */

/**
 * The battle being fought on the scene in view, if one has begun: an encounter there that has started and is
 * played in Phases, the active one first.
 *
 * This does not ask the combat tracker which encounter it is showing. The tracker only turns to an encounter
 * once it has drawn itself again, and it may be showing another one altogether.
 * @returns {Combat|null}
 */
export function battle() {
  const scene = globalThis.canvas?.scene ?? game.scenes?.current ?? null;
  let found = null;
  for ( const combat of game.combats ?? [] ) {
    if ( !combat.started || !phaseOf(combat) || !foughtOn(combat, scene) ) continue;
    if ( combat.active ) return combat;
    found ??= combat;
  }
  return found;
}

/* -------------------------------------------- */

/**
 * Is an encounter a battle of the scene in view: one that has started there and is played in Phases? Unlike
 * `battle()`, this can be asked of an encounter that has just been deleted.
 * @param {Combat|null} combat
 * @returns {boolean}
 */
export function foughtHere(combat) {
  const scene = globalThis.canvas?.scene ?? game.scenes?.current ?? null;
  return !!combat?.started && !!phaseOf(combat) && foughtOn(combat, scene);
}

/* -------------------------------------------- */

/**
 * The tokens that would take the field if a battle began on a scene: those of every unit there that is not
 * out of the fight for good.
 * @param {Scene|null} scene
 * @returns {TokenDocument[]}
 */
export function fieldOf(scene) {
  return scene?.tokens.filter((token) => (token.actor?.type === "unit") && !token.actor.system.defeat?.out) ?? [];
}

/* -------------------------------------------- */

/**
 * Does a unit take part in an encounter?
 * @param {Combat|null} combat
 * @param {Actor|null} actor
 * @param {TokenDocument|null} [token]    Its token, which tells units apart that share an Actor
 * @returns {boolean}
 */
export function fightsIn(combat, actor, token = null) {
  if ( !combat || !actor ) return false;
  const id = token?.id ?? actor.token?.id ?? null;
  if ( id ) return combat.combatants.some((combatant) => combatant.tokenId === id);
  return combat.combatants.some((combatant) => combatant.actorId === actor.id);
}

/* -------------------------------------------- */

/**
 * Whose Phase it is in an encounter.
 * @param {Combat|null} combat
 * @returns {string|null}   A key of FEO.armies, or null for an encounter that is not played in Phases
 */
export function phaseOf(combat) {
  const phase = combat?.getFlag(FEO.id, "phase");
  return phase in FEO.armies ? phase : null;
}

/* -------------------------------------------- */

/**
 * The units taking part in an encounter.
 * @param {Combat|null} combat
 * @returns {{combatant: Combatant, token: TokenDocument|null, actor: Actor, army: string}[]}
 */
export function unitsOf(combat) {
  const units = [];
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( actor?.type !== "unit" ) continue;
    units.push({ combatant, token: combatant.token ?? null, actor, army: armyOf(actor, combatant.token ?? null) });
  }
  return units;
}

/* -------------------------------------------- */

/**
 * The sides of an encounter, in the order they take their Phases.
 * @param {Combat|null} combat
 * @returns {string[]}
 */
export function sidesOf(combat) {
  const present = new Set(unitsOf(combat).map((unit) => unit.army));
  return FEO.phases.filter((army) => present.has(army));
}

/* -------------------------------------------- */

/**
 * Has a unit taken its Action this Phase?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function hasActed(actor) {
  return !!actor?.getFlag(FEO.id, "acted");
}

/* -------------------------------------------- */

/**
 * Where a unit stands in the turn order.
 * @param {Actor|null} actor
 * @param {TokenDocument|null} [token]
 * @returns {"free"|"ready"|"acted"|"down"|"waiting"}
 *   `free` outside of a battle, where nothing is counted; `waiting` while another side has its Phase
 */
export function turnState(actor, token = null) {
  if ( actor?.system?.defeat?.state ) return "down";
  const combat = battle();
  if ( !fightsIn(combat, actor, token) ) return "free";
  if ( armyOf(actor, token ?? actor.token ?? null) !== phaseOf(combat) ) return "waiting";
  return hasActed(actor) ? "acted" : "ready";
}

/* -------------------------------------------- */

/**
 * Where a token set out from this Phase, if it has moved since.
 * @param {TokenDocument|null} token
 * @returns {{x: number, y: number}|null}
 */
export function originOf(token) {
  const origin = token?.getFlag(FEO.id, "origin");
  return (Number.isFinite(origin?.x) && Number.isFinite(origin?.y)) ? { x: origin.x, y: origin.y } : null;
}

/**
 * The Phase that a change to an encounter begins, if it begins one. Every client asks this of each change it
 * hears of, so that all of them announce a Phase alike, and a client that loads into a battle under way
 * announces nothing.
 *
 * A Phase begins when the encounter names another side. Two changes name no side and begin a Phase all the
 * same: the start of a battle, whose first side is named before the encounter starts, and a new turn of a
 * battle in which a single side fights. Both show as the turn of the battle going up while the first side has
 * the Phase. When several sides fight, a new turn is followed by the first side being named, and that is the
 * change which counts.
 * @param {Combat|null} combat    The encounter, as it is after the change
 * @param {object} changes        What was changed
 * @param {object} [options]      The options the change was made with
 * @returns {{army: string, round: number}|null}
 */
export function phaseBegunBy(combat, changes, options = {}) {
  const phase = phaseOf(combat);
  if ( !combat?.started || !phase ) return null;
  const named = "phase" in (changes?.flags?.[FEO.id] ?? {});
  const turned = ("round" in (changes ?? {})) && !(options?.direction < 0);
  if ( !named && !(turned && (phase === sidesOf(combat)[0])) ) return null;
  return { army: phase, round: combat.round };
}

/* -------------------------------------------- */
/*  Acting                                      */
/* -------------------------------------------- */

/**
 * A unit has taken its Action, which ends its turn: conditions in their last turn end, it is marked as having
 * acted until its side's next Phase, and its move can no longer be taken back. Outside of a battle nothing is
 * counted.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]
 * @returns {Promise<boolean>}    Whether the unit's turn was ended
 */
export async function takeAction(actor, token = null) {
  if ( turnState(actor, token) !== "ready" ) return false;
  await endTurnOf(actor);
  await actor.setFlag(FEO.id, "acted", true);
  if ( originOf(token) && token.isOwner ) await token.unsetFlag(FEO.id, "origin");
  return true;
}

/* -------------------------------------------- */
/*  Running the Battle                          */
/* -------------------------------------------- */

/**
 * A side's Phase begins: nobody on it has acted yet, no move can be taken back any more, ground that heals
 * does, and the turn of each of its units starts. Runs for a Game Master.
 * @param {Combat} combat
 * @param {string} army     A key of FEO.armies
 * @returns {Promise<void>}
 */
export async function beginPhase(combat, army) {
  await combat.update({ [`flags.${FEO.id}.phase`]: army });
  for ( const unit of unitsOf(combat) ) {
    try {
      if ( hasActed(unit.actor) ) await unit.actor.unsetFlag(FEO.id, "acted");
      if ( originOf(unit.token) ) await unit.token.unsetFlag(FEO.id, "origin");
      if ( unit.army !== army ) continue;

      // Healing comes before whatever the conditions of the unit deal
      await healFromGround(unit.actor, unit.token);
      await startTurnOf(unit.actor);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */

/**
 * The running Phase ends: the turn of every unit of its side that has not acted ends, and the next side has
 * its Phase. Once every side has had one, a new turn of the battle begins. Runs for a Game Master.
 * @param {Combat} combat
 * @returns {Promise<string|null>}    The side whose Phase begins, or null if nothing was done
 */
export async function endPhase(combat) {
  if ( !game.user.isGM || !combat?.started ) return null;
  const sides = sidesOf(combat);
  if ( !sides.length ) return null;
  const phase = phaseOf(combat);
  for ( const unit of unitsOf(combat) ) {
    if ( (unit.army !== phase) || hasActed(unit.actor) || unit.actor.system.defeat?.state ) continue;
    try {
      await endTurnOf(unit.actor);
    } catch(err) {
      console.error(err);
    }
  }
  const at = sides.indexOf(phase);
  const next = sides[(at + 1) % sides.length];
  if ( (at < 0) || ((at + 1) >= sides.length) ) await combat.nextRound();
  await beginPhase(combat, next);
  return next;
}

/* -------------------------------------------- */

/**
 * Ask for the running Phase to end: a Game Master ends it, anyone else asks one who is connected.
 * @returns {Promise<boolean>}    Whether the Phase ended
 */
export async function requestEndPhase() {
  const combat = battle();
  if ( !combat ) return false;
  if ( game.user.isGM ) return !!(await endPhase(combat));
  const gm = game.users.activeGM;
  if ( !gm ) {
    ui.notifications.warn("FEO.Phase.noGM", { localize: true });
    return false;
  }
  try {
    return !!(await gm.query(END_PHASE_QUERY, { combat: combat.id }, { timeout: 15000 }));
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Answer a player's request to end the running Phase. Runs for a Game Master, and only ends the Phase of the
 * players' own side.
 * @param {{combat: string}} data
 * @returns {Promise<boolean>}
 */
export async function endPhaseQuery({ combat: id } = {}) {
  const combat = game.combats?.get(id);
  if ( !game.user.isGM || !combat || (phaseOf(combat) !== "player") ) return false;
  return !!(await endPhase(combat));
}

/* -------------------------------------------- */

/**
 * Begin a battle on a scene: an encounter with every unit that has a token there, started at once. Runs for
 * a Game Master.
 * @param {Scene} scene
 * @returns {Promise<Combat|null>}
 */
export async function beginBattle(scene) {
  if ( !game.user.isGM || !scene ) return null;
  const tokens = fieldOf(scene);
  if ( !tokens.length ) {
    ui.notifications.warn("FEO.Phase.noUnits", { localize: true });
    return null;
  }
  const Combat = foundry.documents.Combat.implementation;

  // Encounters of this scene that hold nobody are leftovers, and are cleared away
  for ( const other of Array.from(game.combats) ) {
    if ( (other.scene === scene) && !other.combatants.size ) await other.delete();
  }

  // An encounter that is waiting to begin is used; else a new one is made for the scene
  let combat = game.combats.find((other) => foughtOn(other, scene) && !other.started) ?? null;
  combat ??= await Combat.create({ scene: scene.id });

  // Who is in it is asked of the encounter itself, not of whichever one the tracker happens to show
  const fielded = new Set(combat.combatants.map((combatant) => combatant.tokenId));
  const missing = tokens.filter((token) => !fielded.has(token.id));
  if ( missing.length ) {
    await combat.createEmbeddedDocuments("Combatant", missing.map((token) => ({
      tokenId: token.id, sceneId: scene.id, actorId: token.actorId, hidden: token.hidden
    })));
  }

  // Making it the active encounter also turns the tracker to it
  if ( !combat.active ) await combat.activate();
  await combat.startCombat();
  if ( !phaseOf(combat) ) ui.notifications.warn("FEO.Phase.notBegun", { localize: true });
  return combat;
}

/* -------------------------------------------- */

/**
 * End a battle: the encounter is closed, once the Game Master has said that it should be. What the battle
 * left on its units is cleared as the encounter goes, however it goes (see `clearBattle`).
 * @param {Combat|null} combat
 * @returns {Promise<boolean>}    Whether the battle ended
 */
export async function endBattle(combat) {
  if ( !game.user.isGM || !combat ) return false;
  await combat.endCombat();
  return !game.combats.some((other) => other === combat);
}

/* -------------------------------------------- */

/**
 * A battle is over: none of its units has acted any more, and no move waits to be taken back, so that no unit
 * goes on looking spent on the map or carries a mark into what comes next. A unit that is fighting in another
 * battle keeps its marks. Runs once, for the designated Game Master, when an encounter played in Phases is
 * deleted.
 * @param {Combat} combat           The encounter that was deleted
 * @returns {Promise<number>}       How many marks were cleared
 */
export async function clearBattle(combat) {
  if ( !game.user.isActiveGM || !phaseOf(combat) ) return 0;
  const running = Array.from(game.combats ?? []).filter((other) => (other !== combat) && other.started && phaseOf(other));
  let cleared = 0;
  for ( const unit of unitsOf(combat) ) {
    if ( running.some((other) => fightsIn(other, unit.actor, unit.token)) ) continue;
    try {
      if ( hasActed(unit.actor) ) {
        await unit.actor.unsetFlag(FEO.id, "acted");
        cleared += 1;
      }
      if ( originOf(unit.token) ) {
        await unit.token.unsetFlag(FEO.id, "origin");
        cleared += 1;
      }
    } catch(err) {
      console.error(err);
    }
  }
  return cleared;
}

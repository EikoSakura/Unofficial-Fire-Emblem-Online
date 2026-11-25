import { FEO } from "../config.mjs";
import { phaseAfter, phaseSides } from "../rules/phases.mjs";
import { clearGoes, extraGo, goAfter, losesTurn, turnEnded } from "./acting.mjs";
import { retryGrip, settleGrips } from "./actions.mjs";
import { settleAffinity } from "./affinity.mjs";
import { moveAgainFor, movingAgain, settleMove } from "./canto.mjs";
import { armyOf } from "./exchange.mjs";
import { forgetTurn, noteTurn } from "./movement.mjs";
import { awardCarried, isCarried, setDownOver, settleCarries, tendCarried } from "./rescue.mjs";
import { awardBeside } from "./supports.mjs";
import { healFromGround } from "./terrain.mjs";
import { endMapTimed, endPhaseTimed } from "./timed.mjs";
import { endTurnOf, startTurnOf } from "./turns.mjs";

/**
 * Phases: a battle is played side by side. Every unit of a side may move and take one Action during its
 * side's Phase, in any order; then the next side has its Phase, and once every side has had one a new turn of
 * the battle begins.
 *
 * The encounter keeps whose Phase it is. A unit that has taken its Action carries a mark until its side's
 * next Phase, and a token that has moved remembers where it set out from until its unit acts, so that the
 * move can be taken back.
 *
 * An Action may leave its unit a move, as Canto does (see `helpers/canto.mjs`). Its turn then does not end with
 * the Action: it is `moving` until it Waits or its Phase ends, and meanwhile its token remembers where it stood
 * as it acted, so that this second move can be taken back in its turn. Whatever else grants a move after an
 * Action hands `takeAction` what grants it, and the same follows.
 *
 * An Action may also earn its unit another go, as a kill does with Galeforce (see `helpers/acting.mjs`). Its
 * turn then goes on as well: it is `ready` again from where it stands, and whatever it does next is told to
 * `takeAction` like its first Action was. The turn ends once, with the last of its goes.
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
 * The sides of an encounter that take a Phase, in the order they take them: those with a unit still in the
 * fight. A side whose units have all died, retreated or been captured takes none, until one of them returns
 * or another joins it.
 * @param {Combat|null} combat
 * @returns {string[]}
 */
export function sidesOf(combat) {
  return phaseSides(unitsOf(combat).map((unit) => ({ army: unit.army, out: !!unit.actor.system.defeat?.out })), FEO.phases);
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
 * @returns {"free"|"ready"|"moving"|"acted"|"down"|"waiting"}
 *   `free` outside of a battle, where nothing is counted; `waiting` while another side has its Phase;
 *   `moving` once it has taken its Action and may still move, as Canto lets it
 */
export function turnState(actor, token = null) {
  if ( actor?.system?.defeat?.state ) return "down";
  const combat = battle();
  if ( !fightsIn(combat, actor, token) ) return "free";
  if ( armyOf(actor, token ?? actor.token ?? null) !== phaseOf(combat) ) return "waiting";
  if ( hasActed(actor) ) return "acted";
  return movingAgain(actor) ? "moving" : "ready";
}

/* -------------------------------------------- */

/**
 * Is it a unit's own turn, which has not ended yet: is it ready to act, or still moving after its Action?
 * @param {Actor|null} actor
 * @param {TokenDocument|null} [token]
 * @returns {boolean}
 */
export function inOwnTurn(actor, token = null) {
  const state = turnState(actor, token);
  return (state === "ready") || (state === "moving");
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
 * battle in which a single side takes a Phase, as when it is the only one left in the fight. Both show as the
 * turn of the battle going up while the first side has the Phase. When several sides take one, a new turn is
 * followed by the first side being named, and that is the change which counts. A side with nobody left in the
 * fight is never named, so no Phase of its own is announced.
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
 *
 * An Action that leaves its unit a move, as Canto has it, does not end the turn: the move it made stands, and
 * the unit is `moving` until it Waits or its Phase ends (see `endMove`). For a unit that is moving already,
 * whatever it does next ends its turn.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]
 * @param {object} [options]
 * @param {{kind: string, name?: string}} [options.action]
 *                                        The Action taken: "attack", "staff", "item", "skill" with the skill's
 *                                        name, "wait", and the others `rules/canto.mjs` lists; "other" unless given
 * @param {{skill: string, canto: object}[]} [options.moves]
 *                                        Moves the Action itself brought about, each with the skill that
 *                                        grants it and its `canto` part: as a fight reports them, or as a
 *                                        later rule that grants a move after an Action hands them in
 * @param {{skill: string, acts: object}[]} [options.acts]
 *                                        Goes the Action itself earned its unit, each with the skill that
 *                                        earns it and its `acts` part, as a fight reports them
 * @returns {Promise<boolean>}    Whether the unit's turn was ended, or went on to another go or its second move
 */
export async function takeAction(actor, token = null, { action = null, moves = [], acts = [] } = {}) {
  const state = turnState(actor, token);
  if ( state === "moving" ) return endMove(actor, token);
  if ( state !== "ready" ) return false;
  const taken = action ?? { kind: "other" };

  // A weapon a skill lent the unit, which it took up and did not attack with, is put down again
  if ( actor.isOwner && actor.getFlag(FEO.id, "lent") ) await actor.unsetFlag(FEO.id, "lent");

  // An Affinity that is spent by a move, as Wood and Breath are: the move it was switched on for is made
  try {
    await settleAffinity(actor, token);
  } catch(err) {
    console.error(err);
  }

  // An Action that earns its unit another go does not end its turn: it is ready again from where it stands.
  // That comes before a move the Action would leave it, which the last Action of its turn leaves it instead
  const here = extraGo(actor);
  if ( await goAfter(actor, token, taken, acts) ) return true;

  // A unit on a go without movement does not move after its Action either
  const again = (here?.kind === "none") ? null : moveAgainFor(actor, token, taken, moves);
  if ( again ) {
    // What it moved before its Action stands, and where it stands now is where the second move sets out from
    if ( originOf(token) && token.isOwner ) await token.unsetFlag(FEO.id, "origin");
    await actor.setFlag(FEO.id, "again", again);
    return true;
  }

  // The turn of a unit that was given a go once it was over has had its end
  if ( !turnEnded(actor) ) await endTurnOf(actor);
  await actor.setFlag(FEO.id, "acted", true);
  if ( originOf(token) && token.isOwner ) await token.unsetFlag(FEO.id, "origin");
  return true;
}

/* -------------------------------------------- */

/**
 * The turn of a unit that could move again after its Action ends, whether it moved or not: it regains what
 * that move earned it, its turn ends as any does, and the move can no longer be taken back.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]
 * @returns {Promise<boolean>}    Whether its turn was ended
 */
export async function endMove(actor, token = null) {
  const again = movingAgain(actor);
  if ( !again ) return false;
  try {
    await settleMove(actor, token, again);
  } catch(err) {
    console.error(err);
  }
  if ( !turnEnded(actor) ) await endTurnOf(actor);
  await actor.update({ [`flags.${FEO.id}.acted`]: true });
  await actor.unsetFlag(FEO.id, "again");
  if ( originOf(token) && token.isOwner ) await token.unsetFlag(FEO.id, "origin");
  return true;
}

/* -------------------------------------------- */
/*  Running the Battle                          */
/* -------------------------------------------- */

/**
 * A side's Phase begins: nobody on it has acted yet or is still moving, no move can be taken back any more, ground that heals
 * does, and the turn of each of its units starts, which forgets what the unit moved in its last one. A unit
 * that loses this turn, as one that overreached in its last does, has its turn start and end at once. Runs
 * for a Game Master.
 * @param {Combat} combat
 * @param {string} army     A key of FEO.armies
 * @returns {Promise<void>}
 */
export async function beginPhase(combat, army) {
  await combat.update({ [`flags.${FEO.id}.phase`]: army });

  // A hold that no longer stands, as when one of its two units fell or was moved away, is over
  try {
    const scenes = new Set(unitsOf(combat).map((unit) => unit.token?.parent).filter(Boolean));
    for ( const scene of scenes ) await settleGrips(scene);

    // So is carrying that no longer stands, as when a carrier was taken off the map
    for ( const scene of scenes ) await settleCarries(scene);
  } catch(err) {
    console.error(err);
  }
  // A unit that could not carry its passenger by its Weight, as a skill had it, sets it down before any turn
  // of its side starts, so that the unit it sets down has a turn of its own this Phase
  for ( const unit of unitsOf(combat) ) {
    try {
      if ( (unit.army === army) && unit.token ) await setDownOver(unit.token);
    } catch(err) {
      console.error(err);
    }
  }
  for ( const unit of unitsOf(combat) ) {
    try {
      if ( hasActed(unit.actor) ) await unit.actor.unsetFlag(FEO.id, "acted");
      if ( movingAgain(unit.actor) ) await unit.actor.unsetFlag(FEO.id, "again");
      if ( originOf(unit.token) ) await unit.token.unsetFlag(FEO.id, "origin");

      // The goes of the last turn are over; what was counted for the map stays
      await clearGoes(unit.actor);
      if ( unit.army !== army ) continue;

      // Its turn starts: its token notes the weapon it holds, and that it has yet to move
      if ( unit.token ) await noteTurn(unit.token, unit.actor);

      // The attacks made against it are counted anew, for a skill that counts them through a turn
      if ( unit.actor.getFlag(FEO.id, "attacked") !== undefined ) await unit.actor.unsetFlag(FEO.id, "attacked");

      // Healing comes before whatever the conditions of the unit deal. A unit that an ally carries stands on
      // no ground, and regains what its carrier's skills restore to it instead
      const carried = isCarried(unit.actor);
      if ( carried ) await tendCarried(unit.actor);
      else await healFromGround(unit.actor, unit.token);
      await startTurnOf(unit.actor);

      // A unit that another has hold of tries to break free as its turn starts
      if ( unit.token && !carried && !unit.actor.system.defeat?.state ) await retryGrip(unit.token);

      // A unit that loses this turn neither moves nor acts in it: the turn passes, and it has acted. So it is
      // for a unit that is carried, for which time passes all the same
      if ( (carried || losesTurn(unit.actor)) && !unit.actor.system.defeat?.state ) {
        await endTurnOf(unit.actor);
        await unit.actor.setFlag(FEO.id, "acted", true);
      }
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */

/**
 * The running Phase ends: the turn of every unit of its side that has not acted ends, and the next side that
 * still has a unit in the fight has its Phase. Once every such side has had one, a new turn of the battle
 * begins. The battle itself goes on until the Game Master ends it. Runs for a Game Master.
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
      // A unit that could still move after its Action has moved all it will
      if ( movingAgain(unit.actor) ) await endMove(unit.actor, unit.token);
      else if ( !turnEnded(unit.actor) ) await endTurnOf(unit.actor);
    } catch(err) {
      console.error(err);
    }
  }

  // Carrying a hurt partner through the Phase brings the two closer, and so does ending it side by side
  for ( const award of [awardCarried, awardBeside] ) {
    try {
      await award(combat, phase);
    } catch(err) {
      console.error(err);
    }
  }

  // What lasted until the end of this Phase is over, for every unit in the battle
  try {
    await endPhaseTimed(combat);
  } catch(err) {
    console.error(err);
  }

  // The next side that still has a unit in the fight has its Phase; a side with none left is passed over
  const next = phaseAfter(phase, sides, FEO.phases);

  // As a turn of the battle ends, what the weather of the map has strike it strikes
  if ( next.turn ) {
    try {
      const { weatherRoundEnd } = await import("./weather.mjs");
      await weatherRoundEnd(combat);
    } catch(err) {
      console.error(err);
    }
    await combat.nextRound();
  }
  await beginPhase(combat, next.army);
  return next.army;
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

  // What lasted until the end of the Phase that was running is over as well
  try {
    cleared += await endPhaseTimed(combat);
  } catch(err) {
    console.error(err);
  }
  for ( const unit of unitsOf(combat) ) {
    if ( running.some((other) => fightsIn(other, unit.actor, unit.token)) ) continue;
    try {
      if ( hasActed(unit.actor) ) {
        await unit.actor.unsetFlag(FEO.id, "acted");
        cleared += 1;
      }
      if ( movingAgain(unit.actor) ) {
        await unit.actor.unsetFlag(FEO.id, "again");
        cleared += 1;
      }
      if ( await clearGoes(unit.actor, { map: true }) ) cleared += 1;
      if ( unit.actor.getFlag(FEO.id, "attacked") !== undefined ) {
        await unit.actor.unsetFlag(FEO.id, "attacked");
        cleared += 1;
      }
      if ( unit.actor.getFlag(FEO.id, "grip") !== undefined ) {
        await unit.actor.unsetFlag(FEO.id, "grip");
        cleared += 1;
      }
      if ( originOf(unit.token) ) {
        await unit.token.unsetFlag(FEO.id, "origin");
        cleared += 1;
      }
      if ( unit.token && (await forgetTurn(unit.token)) ) cleared += 1;

      // What lasted for the rest of the map, as what a skill counted through it, is over with the battle
      if ( await endMapTimed(unit.actor) ) cleared += 1;

      // And so is what a skill made for it as the battle began
      try {
        const { endBattleCrafts } = await import("./stealing.mjs");
        cleared += await endBattleCrafts(unit.actor);
      } catch(err) {
        console.error(err);
      }

      // So are the traps it had lying, and what it had reacted with
      for ( const key of ["traps", "reacted"] ) {
        if ( unit.actor.getFlag(FEO.id, key) === undefined ) continue;
        await unit.actor.unsetFlag(FEO.id, key);
        cleared += 1;
      }
    } catch(err) {
      console.error(err);
    }
  }

  // A unit that imitates another is itself again (see `helpers/imitation.mjs`)
  try {
    const { endImitations } = await import("./imitation.mjs");
    cleared += await endImitations(combat);
  } catch(err) {
    console.error(err);
  }

  // And a unit that was synced down to the Levels of the battle has its own again (see `helpers/level-sync.mjs`)
  try {
    const { endSyncOn } = await import("./level-sync.mjs");
    cleared += await endSyncOn(combat.scene ?? null);
  } catch(err) {
    console.error(err);
  }

  // The mines and traps its units laid are gone with it (see `helpers/traps.mjs`)
  try {
    const { clearLaid } = await import("./traps.mjs");
    cleared += await clearLaid(combat);
  } catch(err) {
    console.error(err);
  }

  // And the creatures skills made for the battle leave its map (see `helpers/creatures.mjs`)
  try {
    const { clearCreatures } = await import("./creatures.mjs");
    cleared += await clearCreatures(combat);
  } catch(err) {
    console.error(err);
  }
  return cleared;
}

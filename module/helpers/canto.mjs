import { FEO } from "../config.mjs";
import { cantoGrant, joinWalks, moveAfter } from "../rules/canto.mjs";
import { UNFORCED } from "../rules/forced.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { isStaggered } from "../rules/stagger.mjs";
import { standsTo, unitsOn } from "./battle-map.mjs";
import { healUnit } from "./events.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { movOf, turnNote } from "./movement.mjs";

/**
 * Moving again after an Action, in Foundry (see `rules/canto.mjs`): whether the Action a unit has just taken
 * leaves it a move, what its turn's movement comes to once it has made it, and what that move earns it.
 *
 * A unit that may move again carries the move as the flag `again` until its turn ends: the movement it has for
 * it, the skill that grants it, how it crosses terrain meanwhile, and what it had moved before its Action
 * (`base`), which the second move is added to. While it does, it stands in the turn order as `moving` (see
 * `helpers/phases.mjs`): the map gives it its range back from where it stands, and it moves or Waits.
 *
 * @import {MoveAgain} from "../rules/canto.mjs"
 */

/**
 * @typedef {MoveAgain & {base: {spaces: number, cost: number, passed: string[]}}} MovingAgain
 * The move a unit may make after its Action, with what it had moved before it.
 */

/**
 * The move a unit may still make this turn, if the Action it took left it one.
 * @param {Actor|null} actor
 * @returns {MovingAgain|null}
 */
export function movingAgain(actor) {
  const again = actor?.getFlag(FEO.id, "again");
  if ( !again || !Number.isFinite(again.mov) ) return null;
  const base = again.base ?? {};
  return {
    skill: String(again.skill ?? ""),
    mov: Math.max(again.mov, 0),
    full: again.full === true,
    gear: again.gear === true,
    crossing: again.crossing ?? null,
    recover: Number.isFinite(again.recover) ? Math.max(again.recover, 0) : 0,
    curbed: String(again.curbed ?? ""),
    base: {
      spaces: Number.isFinite(base.spaces) ? base.spaces : 0,
      cost: Number.isFinite(base.cost) ? base.cost : 0,
      passed: Array.isArray(base.passed) ? base.passed.filter((id) => typeof id === "string") : []
    }
  };
}

/* -------------------------------------------- */

/**
 * The move an Action leaves the unit that took it, as its skills and the enemies around it have it. Only a
 * unit on a battle map moves again: one that is down, captured, held in place, or unable to act does not.
 * @param {Actor} actor
 * @param {TokenDocument|null} token      Its token on the map
 * @param {{kind: string, name?: string}} action      The Action it took (see `CANTO_ACTIONS`)
 * @param {{skill: string, canto: object}[]} [moves]  Moves the Action itself brought about, as a moment of
 *                                        the fight it started may
 * @returns {MovingAgain|null}
 */
export function moveAgainFor(actor, token, action, moves = []) {
  const scene = token?.parent;
  const here = tokenTile(token);
  if ( (actor?.type !== "unit") || !scene?.grid?.isSquare || !here ) return null;
  const system = actor.system;
  // Not a unit that the Action brought down, whether it is Incapacitated for it or simply defeated
  if ( system.defeat?.state || !(system.hp?.value > 0) ) return null;

  // A unit that the Action left unable to act makes no further move either
  if ( isStaggered(system.stagger) ) return null;
  if ( Object.keys(system.conditions ?? {}).some((id) => FEO.conditions[id]?.noAct) ) return null;

  // The enemies that still stand, and how the skills of each curb such a move
  // A unit that no enemy keeps from moving is curbed by none
  const unit = { army: armyOf(actor, token) };
  const foes = system.skills?.rules?.includes(UNFORCED) ? [] : unitsOn(scene)
    .filter((other) => (other.token !== token) && !other.down && (standsTo(unit, other) === "foe"))
    .map((other) => ({ distance: tilesApart(here, other.tile), curbs: other.actor.system.canto?.curbs ?? null }));
  const note = turnNote(token);
  const again = moveAfter(system.canto ?? null, action ?? { kind: "other" }, {
    mov: movOf(actor),
    spent: note.cost,
    grants: (moves ?? []).map((move) => cantoGrant(move.skill, move.canto ?? {})),
    foes
  });
  return again ? { ...again, base: { spaces: note.spaces, cost: note.cost, passed: note.passed } } : null;
}

/* -------------------------------------------- */

/**
 * What a unit's movement this turn comes to once the move it makes after its Action is counted in.
 * @param {MovingAgain} again
 * @param {{spaces: number, cost: number, passed?: string[]}|null} [walk]   The way of that move, from where
 *                                        the unit stood as it acted; nothing for a unit back there
 * @returns {{spaces: number, cost: number, passed: string[], canto: number}}
 */
export function walkAgain(again, walk = null) {
  return joinWalks(again?.base ?? null, walk);
}

/* -------------------------------------------- */

/**
 * A unit's turn ends after it could move again: it regains what the move it made earns it, as a skill may
 * have each space of it restore HP.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {MovingAgain} again
 * @returns {Promise<number>}     The HP it regained
 */
export async function settleMove(actor, token, again) {
  const spaces = turnNote(token).canto;
  const amount = Math.floor((again?.recover ?? 0) * spaces);
  if ( !(amount > 0) || actor.system.defeat?.state ) return 0;
  const healed = await healUnit(actor, amount);
  return healed?.healed ?? 0;
}

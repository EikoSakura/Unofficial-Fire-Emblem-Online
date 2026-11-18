import { FEO } from "../config.mjs";
import {
  NO_REFRESH, NO_TURN, actGrant, actionDice, actionEffects, actionGrants, goFor, pickGo, spendGo, spentGoes, starsEntry, usedUp
} from "../rules/acting.mjs";
import { parseRange } from "../rules/combat.mjs";
import { starChance } from "../rules/optional.mjs";
import { chanceOf, holds } from "../rules/skills.mjs";
import { isStaggered } from "../rules/stagger.mjs";
import { movingAgain, settleMove } from "./canto.mjs";
import { rollD100 } from "./chat.mjs";
import { pop } from "./events.mjs";
import { armyOf } from "./exchange.mjs";
import { movOf, noteMove, noteTurn, turnMoveOf, turnNote } from "./movement.mjs";
import { battle, fightsIn, hasActed, originOf, phaseOf, turnState } from "./phases.mjs";

/**
 * Acting again, in Foundry (see `rules/acting.mjs`): a unit that earns another go in its turn is not spent on
 * the map. It is ready again from where it stands, and may be picked and used once more.
 *
 * `actAgain` is the one way a unit is given a go, whoever gives it: its own skill at a moment of its turn, or
 * another unit, as Refresh will have it. A unit carries what its turn has made of this as the flag `goes`: the
 * skills that have given it a go this turn and on this map, the go it is on, the goes it earned before it took
 * its Action, and whether its turn has already had its end.
 *
 * @import {ActGrant, Go, GoesUsed} from "../rules/acting.mjs"
 */

/**
 * @typedef Goes
 * What a unit's turn has made of acting again.
 * @property {string[]} turn          The skills that have given it a go this turn
 * @property {string[]} map           Those that have on this map
 * @property {Go|null} go             The go it is on, beyond the first of its turn
 * @property {ActGrant[]} earned      Goes it has earned before taking its Action, which that Action brings
 * @property {boolean} ended          Has its turn had its end, as that of a unit given a go afterwards has?
 * @property {Record<string, number>} sung     How often each of its skills has handed out a Refresh this turn
 * @property {string[]} hushed        Those of them that have as often as they may
 */

/** The name of the hook called once a unit has been given another go: with the unit, its token and the go. */
export const ACTS_AGAIN_HOOK = `${FEO.id}.actsAgain`;

const names = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === "string") : []);

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * What a unit's turn has made of acting again.
 * @param {Actor|null} actor
 * @returns {Goes}
 */
export function goesOf(actor) {
  const kept = actor?.getFlag(FEO.id, "goes") ?? {};
  const go = (kept.go && (typeof kept.go === "object")) ? {
    skill: String(kept.go.skill ?? ""),
    kind: ["full", "left", "none"].includes(kept.go.kind) ? kept.go.kind : "full",
    mov: Number.isFinite(kept.go.mov) ? Math.max(kept.go.mov, 0) : null,
    bars: names(kept.go.bars),

    // One that only keeps count of what the unit has moved, and is no go a skill earned it
    quiet: kept.go.quiet === true,
    base: (kept.go.base && (typeof kept.go.base === "object")) ? {
      spaces: Number.isFinite(kept.go.base.spaces) ? kept.go.base.spaces : 0,
      cost: Number.isFinite(kept.go.base.cost) ? kept.go.base.cost : 0,
      passed: names(kept.go.base.passed),
      canto: Number.isFinite(kept.go.base.canto) ? kept.go.base.canto : 0
    } : null
  } : null;
  return {
    turn: names(kept.turn),
    map: names(kept.map),
    go,
    earned: Array.isArray(kept.earned) ? kept.earned.filter((grant) => grant?.skill).map((grant) => actGrant(grant.skill, grant)) : [],
    ended: kept.ended === true,
    sung: Object.fromEntries(Object.entries((kept.sung && (typeof kept.sung === "object")) ? kept.sung : {}).filter(([, count]) => Number.isInteger(count) && (count > 0))),
    hushed: names(kept.hushed)
  };
}

/* -------------------------------------------- */

/**
 * The go a unit is on, beyond the first of its turn: what it has to move with, and what it may not do. It
 * only counts for a unit that is ready to act.
 * @param {Actor|null} actor
 * @returns {Go|null}
 */
export function extraGo(actor) {
  return goesOf(actor).go;
}

/* -------------------------------------------- */

/**
 * The skills of a unit whose limit of goes is used up: a fight leaves them out.
 * @param {Actor|null} actor
 * @returns {string[]}
 */
export function goesSpent(actor) {
  const goes = goesOf(actor);
  return [...new Set([...spentGoes(goes), ...goes.hushed])];
}

/* -------------------------------------------- */

/**
 * How often each of a unit's skills has handed out a Refresh this turn (see `rules/refresh.mjs`).
 * @param {Actor|null} actor
 * @returns {Record<string, number>}
 */
export function sungOf(actor) {
  return goesOf(actor).sung;
}

/* -------------------------------------------- */

/**
 * Count a Refresh that one of a unit's skills has handed out against what that skill may hand out in a turn.
 * @param {Actor} actor
 * @param {string} skill
 * @param {number|null} [most]    How often it may in a turn; null where nothing limits it
 * @returns {Promise<void>}
 */
export async function countSung(actor, skill, most = null) {
  if ( !actor?.isOwner || !skill || !(most > 0) ) return;
  const had = goesOf(actor);
  const count = (had.sung[skill] ?? 0) + 1;
  await keep(actor, {
    sung: { ...had.sung, [skill]: count },
    hushed: (count >= most) ? [...new Set([...had.hushed, skill])] : had.hushed
  });
}

/* -------------------------------------------- */

/**
 * Has a unit's turn already had its end, though it may act again? So it is for a unit that was given a go
 * once its turn was over: what ends with a turn does not end a second time.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function turnEnded(actor) {
  return goesOf(actor).ended;
}

/* -------------------------------------------- */

/**
 * Does a unit lose its turn, as one that has overreached does?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function losesTurn(actor) {
  return !!actor?.system?.skills?.rules?.includes(NO_TURN);
}

/* -------------------------------------------- */

/**
 * May another unit give this one its Action back, as Refresh does? Not a unit whose skill says it cannot be,
 * nor one that is down. This is what the Refresh command asks before it calls `actAgain`.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function canBeRefreshed(actor) {
  if ( (actor?.type !== "unit") || actor.system.defeat?.state ) return false;
  return !actor.system.skills?.rules?.includes(NO_REFRESH);
}

/* -------------------------------------------- */

/**
 * Describe a unit as it is now for the conditions and chances of its skills, outside of any fight.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @returns {object}
 */
function selfOf(actor, token) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  const stats = system.statValues ?? {};
  return {
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    gender: system.profile?.gender ?? "",
    bestRank: system.bestRank ?? "",
    gold: system.gold ?? 0,
    stats,
    base: system.bare?.base ?? {},
    waiting: !!system.waiting,
    weapon: weapon ? { name: weapon.name, ...weapon.system, reach: parseRange(weapon.system.range, stats) } : null,
    near: system.skills?.near ?? null,
    move: turnMoveOf(token),
    conditions: system.conditions ?? {},
    qualities: system.specialQualities ?? "",
    shifted: !!system.shift?.transformed,
    skills: (system.skills?.entries ?? []).map((skill) => skill.name)
  };
}

/* -------------------------------------------- */

/**
 * Can a unit make use of another go: is it standing, and able to act?
 * @param {Actor} actor
 * @returns {boolean}
 */
function fitToAct(actor) {
  const system = actor?.system;
  if ( (actor?.type !== "unit") || system.defeat?.state || !(system.hp?.value > 0) ) return false;
  if ( isStaggered(system.stagger) ) return false;
  return !Object.keys(system.conditions ?? {}).some((id) => FEO.conditions[id]?.noAct);
}

/* -------------------------------------------- */
/*  Giving a Go                                 */
/* -------------------------------------------- */

/**
 * Keep what a unit's turn has made of acting again.
 * @param {Actor} actor
 * @param {Partial<Goes>} changes
 * @returns {Promise<void>}
 */
async function keep(actor, changes) {
  const had = goesOf(actor);
  await actor.setFlag(FEO.id, "goes", {
    turn: changes.turn ?? had.turn,
    map: changes.map ?? had.map,
    go: (changes.go !== undefined) ? changes.go : had.go,
    earned: changes.earned ?? had.earned,
    ended: changes.ended ?? had.ended,
    sung: changes.sung ?? had.sung,
    hushed: changes.hushed ?? had.hushed
  });
}

/* -------------------------------------------- */

/**
 * Give a unit another go in its turn: it is no longer spent, and is ready again from where it stands. This is
 * the one way a unit acts again, for its own skills and for what another unit does for it: Refresh gives an
 * ally its Action back with `actAgain(ally, token, { skill: "Refresh", mov: "full" })`, once `canBeRefreshed`
 * has said that it may.
 *
 * The go is a part of the same turn: nothing that counts turns moves, and the turn ends once. A unit whose
 * turn was over when the go came has had that end, and does not have it again. What it did before stands: its
 * move can no longer be taken back, and with its "full" movement the go counts its movement anew.
 * @param {Actor} actor
 * @param {TokenDocument|null} token      Its token on the map
 * @param {object} grant
 * @param {string} grant.skill            What gives it, by name: it is flashed over the unit
 * @param {"full"|"left"|"none"} [grant.mov]    The movement of the go: its whole MOV anew unless given
 * @param {string[]} [grant.bars]         Actions it may not take in that go
 * @param {"turn"|"map"|null} [grant.once]      Counted against that skill's limit of goes
 * @param {object} [options]
 * @param {boolean} [options.flash]       Is the skill's name floated over the unit? It is unless told not to
 * @returns {Promise<boolean>}            Whether the unit was given the go: not one that is down, that is not
 *                                        fighting in the battle, or whose side does not have the Phase
 */
export async function actAgain(actor, token = null, grant = {}, { flash = true } = {}) {
  if ( (actor?.type !== "unit") || actor.system.defeat?.state || !(actor.system.hp?.value > 0) ) return false;
  const combat = battle();
  if ( !fightsIn(combat, actor, token) || (armyOf(actor, token ?? actor.token ?? null) !== phaseOf(combat)) ) return false;
  const given = actGrant(grant.skill ?? "", { mov: "full", ...grant });
  const had = goesOf(actor);

  // A unit that was still moving after its Action has moved all it will on that move
  const moving = movingAgain(actor);
  if ( moving ) {
    try {
      await settleMove(actor, token, moving);
    } catch(err) {
      console.error(err);
    }
    await actor.unsetFlag(FEO.id, "again");
  }

  // The go it is on, from what it has moved so far; one with its whole movement counts that anew
  const go = goFor(given, { mov: movOf(actor), note: turnNote(token) });
  const used = spendGo(had, given);
  await keep(actor, { ...used, go, earned: [], ended: had.ended || hasActed(actor) });
  if ( hasActed(actor) ) await actor.unsetFlag(FEO.id, "acted");
  if ( token?.isOwner ) {
    if ( originOf(token) ) await token.unsetFlag(FEO.id, "origin");
    if ( given.mov === "full" ) await noteTurn(token, actor);
  }
  if ( flash && given.skill ) pop(actor, [{ text: given.skill, tone: "skill" }]);
  Hooks.callAll(ACTS_AGAIN_HOOK, actor, token, go);
  return true;
}

/* -------------------------------------------- */

/**
 * A unit has taken an Action of its turn: if that earns it another go, it is given one, and its turn goes on.
 * What earns it is what the Action itself brought about, as a kill in the fight it started; what the unit
 * earned before it acted; and what its skills make of an Action having been taken, some by a chance that is
 * rolled here, without a word in the chat.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {{kind: string, name?: string}} action      The Action it took
 * @param {{skill: string, acts: object}[]} [acts]    Goes the Action itself earned, as a fight reports them
 * @returns {Promise<boolean>}                        Whether it acts again
 */
export async function goAfter(actor, token, action, acts = []) {
  const had = goesOf(actor);
  const drop = async () => {
    if ( had.earned.length ) await keep(actor, { earned: [] });
    return false;
  };

  // Waiting ends the turn whatever was earned, and a unit that can no longer act has no use for a go
  if ( ((action?.kind ?? "other") === "wait") || !fitToAct(actor) ) return drop();
  const grants = [...(acts ?? []).map((entry) => actGrant(entry.skill, entry.acts ?? {})), ...had.earned];

  // What its skills, and the changes that last on it, make of an Action having been taken. Its Movement
  // Stars count as a skill of its own where the world plays with them
  const system = actor.system;
  const stars = FEO.optional.movementStars?.enabled ? starChance(system.starsTotal ?? system.movementStars ?? 0) : 0;
  const skills = [...(system.skills?.entries ?? []), ...(system.skills?.timed ?? [])];
  if ( stars > 0 ) skills.push(starsEntry(game.i18n.localize("FEO.Optional.stars.title")));
  const self = selfOf(actor, token);
  const waiting = actionEffects(skills, action, { used: had, holds: (when) => holds(when, self, null) });
  if ( waiting.length ) {
    const needed = actionDice(waiting);
    const { results } = needed ? await rollD100(needed) : { results: [] };
    let at = 0;
    const always = !!system.skills?.rules?.includes("alwaysActivate");
    const rolled = actionGrants(waiting, (proc) => chanceOf(proc, self, null, { activation: system.skills?.activation ?? 0, always }),
      () => results[at++] ?? 100, { stars });
    grants.push(...rolled.grants);
  }
  const grant = pickGo(grants, had);
  if ( !grant ) return drop();
  return actAgain(actor, token, grant);
}

/* -------------------------------------------- */

/**
 * A unit has earned another go outside of the Action it takes, as by defeating a foe on its way. One that has
 * yet to act keeps it for the Action it takes; one that has acted is given it at once. Outside of its own turn
 * it earns nothing.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {{skill: string, acts: object}[]} acts      The goes its skills earn it
 * @returns {Promise<boolean>}                        Whether it was given a go at once
 */
export async function earnGo(actor, token, acts = []) {
  if ( !acts?.length || !actor?.isOwner ) return false;
  const state = turnState(actor, token);
  const had = goesOf(actor);
  const grants = acts.map((entry) => actGrant(entry.skill, entry.acts ?? {})).filter((grant) => !usedUp(grant, had));
  if ( !grants.length ) return false;
  if ( state === "ready" ) {
    const earned = [...had.earned, ...grants.filter((grant) => !had.earned.some((other) => other.skill === grant.skill))];
    await keep(actor, { earned });
    return false;
  }
  if ( ((state !== "acted") && (state !== "moving")) || !fitToAct(actor) ) return false;
  const grant = pickGo(grants, had);
  return grant ? actAgain(actor, token, grant) : false;
}

/**
 * What a unit has moved so far this turn stands, and it goes on from where it now stands with the movement it
 * has left, less what something other than moving took: as when a skill has it spend movement to Shove, or
 * when it is moved against its will in the middle of its own move. Its move can no longer be taken back, and
 * what it moves from here on is added to what it moved before, as on a go that counts on from where its turn
 * began (see `rules/acting.mjs`). For a unit that is moving again after its Action, the same is done to that
 * move.
 * @param {Actor} actor
 * @param {TokenDocument|null} token      Its token on the map
 * @param {object} [options]
 * @param {string} [options.skill]        What took the movement, by name
 * @param {number} [options.cost]         The movement it took
 * @returns {Promise<boolean>}            Whether anything was changed: nothing is for a unit that is not in
 *                                        its own turn, or that has neither moved nor spent any movement
 */
export async function standMove(actor, token = null, { skill = "", cost = 0 } = {}) {
  const state = turnState(actor, token);
  if ( !token?.isOwner || !actor?.isOwner || ((state !== "ready") && (state !== "moving")) ) return false;
  const spent = Math.max(Math.floor(cost) || 0, 0);
  if ( !originOf(token) && !spent ) return false;
  const note = turnNote(token);
  const base = { spaces: note.spaces, cost: note.cost + spent, passed: [...note.passed], canto: note.canto };

  // A unit that is moving again after its Action has that much less of that move left
  const moving = movingAgain(actor);
  if ( (state === "moving") && moving ) {
    const used = Math.max(note.cost - moving.base.cost, 0);
    await actor.setFlag(FEO.id, "again", {
      ...moving, mov: Math.max(moving.mov - used - spent, 0), base: { spaces: base.spaces, cost: base.cost, passed: base.passed }
    });
  }
  else {
    // What its turn, or the go it is on, gave it to move with, less what it has used of it
    const had = goesOf(actor).go;
    const whole = had?.base ? ((had.mov ?? 0) + had.base.cost) : movOf(actor);
    const go = {
      skill: had?.skill ?? skill,
      kind: (had && (had.kind !== "full")) ? had.kind : "left",

      // A move that dealt damage on its way stands, and its unit moves no further
      mov: note.fixed ? 0 : Math.max(whole - note.cost - spent, 0),
      bars: had?.bars ?? [],
      quiet: had ? had.quiet : true,
      base
    };
    await keep(actor, { go });
  }
  if ( originOf(token) ) await token.unsetFlag(FEO.id, "origin");
  if ( spent ) await noteMove(token, base, { fixed: note.fixed });
  return true;
}

/* -------------------------------------------- */
/*  The Turn Order                              */
/* -------------------------------------------- */

/**
 * A side's Phase begins, or a battle ends: what a unit's turn had made of acting again is over. The goes its
 * skills gave it on this map stay counted until the battle ends.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.map]     Is the battle over, so that what was counted for the map goes too?
 * @returns {Promise<boolean>}        Whether there was anything to clear
 */
export async function clearGoes(actor, { map = false } = {}) {
  if ( actor?.getFlag(FEO.id, "goes") === undefined ) return false;
  const had = goesOf(actor);
  if ( map || !had.map.length ) {
    await actor.unsetFlag(FEO.id, "goes");
    return true;
  }
  if ( !had.turn.length && !had.go && !had.earned.length && !had.ended && !had.hushed.length && !Object.keys(had.sung).length ) return false;
  await keep(actor, { turn: [], go: null, earned: [], ended: false, sung: {}, hushed: [] });
  return true;
}

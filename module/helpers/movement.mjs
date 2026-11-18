import { FEO } from "../config.mjs";
import { parseRange } from "../rules/combat.mjs";
import { HELD } from "../rules/forced.mjs";
import { movementFacts, needsMove } from "../rules/movement.mjs";
import { attackRanges, skillTotals } from "../rules/skills.mjs";
import { turnState } from "./phases.mjs";
import { queueStanding, tokenInView } from "./positions.mjs";

/**
 * A unit's movement in its turn, in Foundry: what a token remembers of it, and what that comes to for the
 * skills that ask (see `rules/movement.mjs`).
 *
 * In a battle a token notes, as its unit's turn starts, the weapon the unit holds, and as it moves, the spaces
 * it moved, the movement they took and the enemies it moved through, counted from where the turn began (with
 * the move it makes after its Action, where a skill lets it, added to the one before), and
 * whether the move stands: one that dealt damage on its way is not taken back or made again. The note stays once the unit has
 * acted, until its next turn starts, so that what it moved still counts while the other sides have their
 * Phases. Outside of a battle nothing is noted, and movement cannot be judged.
 *
 * @import {Movement} from "../rules/movement.mjs"
 */

/**
 * What a token has noted of its unit's turn.
 * @param {TokenDocument|null} token
 * @returns {{held: string|null, spaces: number, cost: number, passed: string[], fixed: boolean, canto: number}}
 *          `canto`: the spaces among them that it moved after its Action, as Canto lets it
 */
export function turnNote(token) {
  const note = token?.getFlag(FEO.id, "turn") ?? {};
  return {
    held: (typeof note.held === "string") ? note.held : null,
    spaces: Number.isFinite(note.spaces) ? note.spaces : 0,
    cost: Number.isFinite(note.cost) ? note.cost : 0,
    passed: Array.isArray(note.passed) ? note.passed.filter((id) => typeof id === "string") : [],
    fixed: note.fixed === true,
    canto: Number.isFinite(note.canto) ? note.canto : 0
  };
}

/* -------------------------------------------- */

/**
 * Does the move a unit made this turn stand, so that it is neither taken back nor made again? One that dealt
 * damage on its way does.
 * @param {TokenDocument|null} token
 * @returns {boolean}
 */
export function moveStands(token) {
  return turnNote(token).fixed;
}

/* -------------------------------------------- */

/**
 * How far a unit can move this turn: its MOV, or nothing for one that is down or held in place by a condition.
 * @param {Actor} actor
 * @returns {number}
 */
export function movOf(actor) {
  const system = actor.system;
  if ( system.defeat?.state ) return 0;

  // Nor one that another unit holds in place, as one that was shoved by a Bulldozer or is grappled
  const held = Object.keys(system.conditions ?? {}).some((id) => FEO.conditions[id]?.noMove)
    || !!system.skills?.rules?.includes(HELD);
  return held ? 0 : Math.max(system.statValues?.mov ?? 0, 0);
}

/* -------------------------------------------- */

/**
 * How a unit moved this turn, for its skills.
 * @param {TokenDocument|null} token      Its token on the map
 * @param {object} [options]
 * @param {{spaces: number, cost: number, passed?: string[], canto?: number}|null} [options.walk]
 *                                        The way to a tile it would attack from, in place of what it has moved
 * @param {boolean} [options.fresh]       As if its turn had just begun where it stands
 * @param {Actor} [options.actor]         The unit, where the token must not be asked for it
 * @param {number} [options.mov]          Its MOV, where the unit is still being worked out
 * @param {string|null} [options.weapon]  The weapon in its hand, the same way
 * @returns {Movement|null}               Null where movement cannot be judged: without a token on a map of
 *                                        square tiles, and outside of a battle
 */
export function turnMoveOf(token, { walk = null, fresh = false, actor = null, mov = null, weapon = undefined } = {}) {
  const unit = actor ?? token?.actor ?? null;
  if ( !token?.parent?.grid?.isSquare || (unit?.type !== "unit") ) return null;
  if ( turnState(unit, token) === "free" ) return null;
  const note = turnNote(token);
  const here = fresh ? { spaces: 0, cost: 0 } : (walk ?? note);
  return movementFacts({
    spaces: here.spaces,
    cost: here.cost,
    passed: here.passed ?? [],
    canto: here.canto ?? 0,
    mov: mov ?? movOf(unit),
    held: fresh ? null : note.held,
    weapon: (weapon === undefined) ? (unit.system.equippedWeapon?.id ?? "") : (weapon ?? "")
  });
}

/* -------------------------------------------- */

/**
 * How a unit moved this turn, asked while the unit itself is being worked out: by its token on the scene in
 * view, without asking that token for its Actor.
 * @param {Actor} actor
 * @param {object} [options]      As for `turnMoveOf`: its `mov` and the `weapon` in its hand
 * @returns {Movement|null}
 */
export function turnMoveOfActor(actor, options = {}) {
  try {
    const token = tokenInView(actor);
    return token ? turnMoveOf(token, { ...options, actor }) : null;
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * What a unit's skills come to as it stands, outside of any fight, with its movement as given: for what the
 * map asks of them before a fight is planned, such as how far its weapon reaches and whether it may act.
 * @param {Actor} actor
 * @param {Movement|null} move
 * @returns {import("../rules/skills.mjs").SkillTotals}
 */
export function skillsWith(actor, move) {
  const lists = actor.system.skills ?? {};
  return skillTotals([...(lists.entries ?? []), ...(lists.timed ?? []), ...(lists.auras ?? [])], selfWith(actor, move));
}

/* -------------------------------------------- */

/**
 * What a unit's skills change about how far the weapon in its hand reaches, as it stands and with its
 * movement as given: at all times, and when it starts a fight, which the map adds since the unit it shows the
 * reach of is the one that would start it.
 * @param {Actor} actor
 * @param {Movement|null} move
 * @returns {{add?: number, min?: number, max?: number, clear?: boolean}[]}
 */
export function rangesWith(actor, move) {
  const lists = actor.system.skills ?? {};
  const self = selfWith(actor, move);
  return [
    ...skillsWith(actor, move).ranges,
    ...attackRanges([...(lists.entries ?? []), ...(lists.timed ?? []), ...(lists.auras ?? [])], self)
  ];
}

/* -------------------------------------------- */

/**
 * Describe a unit as it stands for the conditions and numbers of its skills, outside of any fight.
 * @param {Actor} actor
 * @param {Movement|null} move
 * @returns {import("../rules/skills.mjs").SkillSelf}
 */
export function selfWith(actor, move) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  const stats = system.bare?.stats ?? system.statValues;
  const lists = system.skills ?? {};
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
    accuracy: system.bare?.accuracy ?? 0,
    waiting: !!system.waiting,
    weapon: weapon ? { name: weapon.name, ...weapon.system, reach: parseRange(weapon.system.range, stats) } : null,
    near: lists.near ?? null,
    move,
    clock: lists.clock ?? null,
    conditions: system.conditions ?? {},
    qualities: system.specialQualities ?? "",
    shifted: !!system.shift?.transformed
  };
}

/* -------------------------------------------- */

/**
 * Is a unit left with nothing to do but Wait, as one that has Run is?
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {object} [options]      As for `turnMoveOf`: the `walk` to a tile it would act from
 * @returns {boolean}
 */
export function onlyWaits(actor, token, options = {}) {
  const move = turnMoveOf(token, options);
  return !!move && skillsWith(actor, move).rules.has("onlyWait");
}

/* -------------------------------------------- */

/**
 * Does a skill hold its unit to Waiting while it is switched on, so that it cannot be switched off once that
 * has come about?
 * @param {Item} item
 * @returns {boolean}
 */
export function holdsToWaiting(item) {
  return (item?.system?.effects ?? []).some((effect) => effect?.when?.declared && effect.rules?.includes("onlyWait"));
}

/* -------------------------------------------- */
/*  Noting                                      */
/* -------------------------------------------- */

/**
 * A unit's turn starts: its token notes what it holds, and that it has yet to move.
 * @param {TokenDocument} token
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function noteTurn(token, actor) {
  if ( !token?.isOwner ) return;
  const note = token.getFlag(FEO.id, "turn");
  const held = actor?.system.equippedWeapon?.id ?? "";
  if ( note && (note.held === held) && !note.spaces && !note.cost && !note.passed?.length && !note.fixed && !note.canto ) return;
  await token.setFlag(FEO.id, "turn", { held, spaces: 0, cost: 0, passed: [], fixed: false, canto: 0 });
}

/* -------------------------------------------- */

/**
 * A unit has moved, or its move was taken back: its token notes what its movement this turn comes to.
 * @param {TokenDocument} token
 * @param {{spaces: number, cost: number, passed?: string[], canto?: number}|null} [walk]
 *                                        The way from where its turn began to where it stands, and the enemies
 *                                        it moved through on it; nothing for a unit back where it began. For a
 *                                        unit that moves again after its Action, both moves as one, with the
 *                                        spaces of the second as `canto`
 * @param {object} [options]
 * @param {boolean} [options.fixed]       Does the move stand, as one that dealt damage on its way does?
 * @returns {Promise<void>}
 */
export async function noteMove(token, walk = null, { fixed = false } = {}) {
  if ( !token?.isOwner ) return;
  const note = turnNote(token);
  const spaces = Math.max(walk?.spaces ?? 0, 0);
  const cost = Math.max(walk?.cost ?? 0, 0);
  const passed = (spaces > 0) ? (walk?.passed ?? []) : [];
  const canto = Math.min(Math.max(walk?.canto ?? 0, 0), spaces);
  const same = (note.spaces === spaces) && (note.cost === cost) && (note.fixed === !!fixed) && (note.canto === canto)
    && (note.passed.length === passed.length) && note.passed.every((id, index) => id === passed[index]);
  if ( same ) return;
  await token.setFlag(FEO.id, "turn", { spaces, cost, passed, fixed: !!fixed, canto });
}

/* -------------------------------------------- */

/**
 * A battle is over: a token forgets what it noted of its unit's turn.
 * @param {TokenDocument} token
 * @returns {Promise<boolean>}    Whether there was anything to forget
 */
export async function forgetTurn(token) {
  if ( !token?.isOwner || (token.getFlag(FEO.id, "turn") === undefined) ) return false;
  await token.unsetFlag(FEO.id, "turn");
  return true;
}

/* -------------------------------------------- */
/*  Keeping Sheets in Step                      */
/* -------------------------------------------- */

/**
 * Does any of a unit's skills ask how it moved?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function asksMove(actor) {
  const lists = actor.system.skills ?? {};
  return [...(lists.entries ?? []), ...(lists.auras ?? [])].some((skill) => (skill.effects ?? []).some(needsMove));
}

/* -------------------------------------------- */

/**
 * Register what tells a unit how it moved, and what changes that. Called once, when the system starts.
 * @param {typeof import("../data/actor-unit.mjs").default} UnitData
 */
export function registerHooks(UnitData) {
  UnitData.moving = turnMoveOfActor;

  // What a token notes of its turn, and whose Phase it is, change the numbers of the units that ask
  Hooks.on("updateToken", (token, changes) => {
    const noted = Object.keys(changes.flags?.[FEO.id] ?? {}).some((key) => key.endsWith("turn"));
    if ( noted && (token.parent === globalThis.canvas?.scene) ) queueStanding();
  });
  for ( const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "deleteCombatant"] ) {
    Hooks.on(hook, () => queueStanding());
  }
}

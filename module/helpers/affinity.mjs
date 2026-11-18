import { FEO } from "../config.mjs";
import { AFFINITY_ID, activationExp } from "../rules/optional.mjs";
import { pathTo, tileKey } from "../rules/reach.mjs";
import { resetSkill, spendSkill, switchSkill, tickSkill } from "../rules/skill-usage.mjs";
import { groundOf, moveCost } from "../rules/terrain.mjs";

/**
 * Additional Affinity Effects in Foundry: the Affinities their unit chooses when to use (Anima, Wood, Breath
 * and Muscle), which are switched on and spent as a skill is and keep where they stand on the unit; the
 * experience Emblem gives; and the cooldown Key shortens. What each does is written in the configuration and
 * worked out by `rules/optional.mjs`.
 */

/**
 * How a unit's Affinity is used, for one its unit chooses when to use.
 * @param {Actor|null} actor
 * @returns {{usage: object, spentBy: "fight"|"move"|"shove", name: string, on: boolean}|null}
 *          Null for a unit whose Affinity is always there, or does nothing
 */
export function affinityWay(actor) {
  return actor?.system?.affinityWay ?? null;
}

/* -------------------------------------------- */

/**
 * Where a unit's Affinity stands, with every part present.
 * @param {Actor} actor
 * @returns {{active: boolean, cooldown: number, lasting: number, used: number}}
 */
export function affinityState(actor) {
  const state = actor?.system?.affinityUse ?? {};
  return { active: !!state.active, cooldown: state.cooldown ?? 0, lasting: state.lasting ?? 0, used: state.used ?? 0 };
}

/* -------------------------------------------- */

/**
 * Keep where a unit's Affinity stands.
 * @param {Actor} actor
 * @param {object} state
 * @returns {Promise<void>}
 */
async function keep(actor, state) {
  const count = (value) => Math.min(Math.max(Math.floor(Number(value)) || 0, 0), 99);
  await actor.update({
    "system.affinityUse": { active: !!state.active, cooldown: count(state.cooldown), lasting: count(state.lasting), used: count(state.used) }
  });
}

/* -------------------------------------------- */

/**
 * Switch a unit's Affinity on or off. It can only be switched on while it can be spent; whatever stands in the
 * way is said instead.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it was switched
 */
export async function switchAffinity(actor) {
  const way = affinityWay(actor);
  if ( !way || !actor.isOwner ) return false;
  const result = switchSkill(way.usage, affinityState(actor));
  if ( !result.ok ) {
    ui.notifications.warn(game.i18n.format(`FEO.Usage.blocked.${result.reason}`, { skill: way.name }));
    return false;
  }
  await keep(actor, result.state);
  return true;
}

/* -------------------------------------------- */

/**
 * A unit's Affinity was used: its cooldown starts, a use is counted, and it stays on for as long as it lasts.
 * Its name floats over the unit.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it was spent
 */
export async function spendAffinity(actor) {
  const way = affinityWay(actor);
  if ( !way || !actor.isOwner ) return false;
  await keep(actor, spendSkill(way.usage, affinityState(actor)));
  try {
    const { pop } = await import("./events.mjs");
    pop(actor, [{ text: way.name, tone: "skill" }]);
  } catch(err) {
    console.error(err);
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Keep where a fight left a unit's Affinity, as the fight worked it out (see `exchangeChanges`).
 * @param {Actor} actor
 * @param {object} state
 * @returns {Promise<boolean>}    Whether it was kept
 */
export async function saveAffinity(actor, state) {
  if ( !affinityWay(actor) ) return false;
  await keep(actor, state);
  return true;
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: the cooldown of its Affinity runs down, and one that lasted until now is over.
 * @param {Actor} actor
 * @returns {Promise<{skill: string, ready: boolean, ended: boolean}[]>}    What to tell on the card of the turn
 */
export async function tickAffinity(actor) {
  const way = affinityWay(actor);
  if ( !way ) return [];
  const ticked = tickSkill(way.usage, affinityState(actor));
  if ( ticked.changed ) await keep(actor, ticked.state);
  return (ticked.ready || ticked.ended) ? [{ skill: way.name, ready: ticked.ready, ended: ticked.ended }] : [];
}

/* -------------------------------------------- */

/**
 * A battle begins: the uses and the cooldown of a unit's Affinity come back, and it is switched off. Where the
 * Affinity is no longer one its unit chooses when to use, what was kept of it is forgotten.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function resetAffinity(actor) {
  const way = affinityWay(actor);
  const state = affinityState(actor);
  const reset = way ? resetSkill(way.usage, state) : { state: { active: false, cooldown: 0, lasting: 0, used: 0 }, changed: Object.values(state).some(Boolean) };
  if ( reset.changed ) await keep(actor, reset.state);
}

/* -------------------------------------------- */

/**
 * The spaces a unit's Affinity adds to its movement while it is switched on, as Breath does: only where they
 * let it attack an enemy it could not have reached, which the map sees to (see `reachOf`).
 * @param {Actor|null} actor
 * @returns {number}
 */
export function lungeOf(actor) {
  const way = affinityWay(actor);
  if ( !way?.on || (way.spentBy !== "move") ) return 0;
  const entry = (actor.system.skills?.entries ?? []).find((skill) => skill.id === AFFINITY_ID);
  return (entry?.effects ?? []).reduce((sum, effect) => sum + (effect.when?.declared ? Math.max(Number(effect.stats?.mov) || 0, 0) : 0), 0);
}

/* -------------------------------------------- */

/**
 * Did a unit make use of an Affinity that is spent by a move, as it stands when its Action is taken or its
 * turn ends? One that eases terrain was used by a move over a tile that would have taken more movement, or by
 * standing on a tile that would take something off its unit; one that adds movement by a move further than
 * the unit's own movement goes.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @returns {Promise<boolean>}
 */
async function madeUseOf(actor, token) {
  const entry = (actor.system.skills?.entries ?? []).find((skill) => skill.id === AFFINITY_ID);
  const effects = (entry?.effects ?? []).filter((effect) => effect.when?.declared);
  const { reachOf } = await import("./battle-map.mjs");
  const { turnNote } = await import("./movement.mjs");
  const view = token ? reachOf(token) : null;

  // Further than its own movement goes: what it noted of its turn is what it moved
  const lunge = lungeOf(actor);
  if ( (lunge > 0) && token && view && !view.again && !view.go ) {
    if ( turnNote(token).cost > (view.movement - lunge) ) return true;
  }

  // Over ground that would have taken more, or on ground that would take something off it
  if ( view && effects.some((effect) => effect.crossing) ) {
    const plain = { ...view.mover, crossing: { ...(view.mover?.crossing ?? {}), all: false, steady: false } };
    const here = view.ground(view.standing);
    const taken = groundOf(here.terrain, here.elevation, plain);
    if ( [taken.def, taken.res, taken.dodge].some((value) => value < 0) ) return true;
    const way = view.moved ? pathTo(view.reach, view.standing) : [];
    const origin = tileKey(view.reach.origin);
    for ( const tile of way ) {
      if ( tileKey(tile) === origin ) continue;
      const kind = view.ground(tile).terrain;
      if ( moveCost(kind, plain) > moveCost(kind, view.mover) ) return true;
    }
  }
  return false;
}

/* -------------------------------------------- */

/**
 * A unit has taken its Action, or its turn ends: an Affinity that is spent by a move and is switched on was
 * either used, and is spent, or was not, and is switched off again without a cooldown.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]
 * @returns {Promise<void>}
 */
export async function settleAffinity(actor, token = null) {
  const way = affinityWay(actor);
  if ( !way?.on || (way.spentBy !== "move") || !actor.isOwner ) return;
  const state = affinityState(actor);

  // One that was spent and still lasts has had its use
  if ( state.lasting > 0 ) return;
  let used = false;
  try {
    used = await madeUseOf(actor, token ?? actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null);
  } catch(err) {
    console.error(err);
  }
  if ( used ) await spendAffinity(actor);
  else await keep(actor, { ...state, active: false });
}

/* -------------------------------------------- */

/**
 * A unit made a Shove that needed its Affinity, as Muscle lets it: the Affinity is spent.
 * @param {Actor} actor
 * @param {string} lent       What the Shove says let it be made (see `tryShove`)
 * @returns {Promise<boolean>}    Whether the Affinity was spent
 */
export async function shovedWith(actor, lent) {
  const way = affinityWay(actor);
  if ( !lent || !way?.on || (way.spentBy !== "shove") || (lent !== way.name) ) return false;
  return spendAffinity(actor);
}

/* -------------------------------------------- */

/**
 * The experience a unit's Affinity gives it for Skills of its own that rolled to activate and did, outside of
 * a fight: at a moment of its turn, as Emblem has it.
 * @param {Actor} actor
 * @param {number[]} grades       What each of those Skills divides its stat by
 * @returns {Promise<number>}     The experience it gained
 */
export async function awardActivations(actor, grades = []) {
  const amount = activationExpOf(actor, grades);
  if ( !(amount > 0) ) return 0;
  const { awardExp, earnsExp } = await import("./experience.mjs");
  if ( !earnsExp(actor) ) return 0;
  const award = await awardExp(actor, amount);
  return award?.gained ?? 0;
}

/* -------------------------------------------- */

/**
 * The experience a unit's Affinity gives it for so many of its Skills that activated.
 * @param {Actor} actor
 * @param {number[]} grades
 * @returns {number}
 */
export function activationExpOf(actor, grades = []) {
  const system = actor?.system;
  if ( !system?.affinity || !grades?.length ) return 0;
  const always = !!system.glory?.extras?.resonance;
  return activationExp(system.affinity, grades, always ? { config: { ...FEO.optional.affinityEffects, enabled: true } } : {});
}

/* -------------------------------------------- */

/**
 * The turns added to the cooldown of a skill as its unit uses it: what the unit's skills add to every
 * cooldown, and what its Affinity takes off the one skill chosen for it, as Key does.
 * @param {Actor|null} actor
 * @param {Item|null} [item]      The skill that is used
 * @returns {number}              Which may be less than none
 */
export function cooldownsFor(actor, item = null) {
  const skills = actor?.system?.skills;
  const entry = item ? (skills?.entries ?? []).find((skill) => skill.id === item.id) : null;
  return (skills?.cooldowns ?? 0) + (entry?.cooldowns ?? 0);
}

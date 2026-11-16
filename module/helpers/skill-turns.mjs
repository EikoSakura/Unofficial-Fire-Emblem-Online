import { turnEffects, turnMoment } from "../rules/skills.mjs";
import { resetSkill, tickSkill } from "../rules/skill-usage.mjs";
import { postCard, rollD100, rollFromResults } from "./chat.mjs";
import { conditionsOf, setConditions } from "./conditions.mjs";
import { standingOf, tokenInView } from "./positions.mjs";
import { buildSkillTurnCard } from "./skill-turn-context.mjs";
import { grantTimed, tickTimedFor } from "./timed.mjs";

/**
 * What a unit's skills do at the moments of its turn: when it starts, when it ends, and when the unit Waits.
 * A unit that has Waited stays `waiting` until its next turn starts, which some skills ask for.
 *
 * @import {TurnMoment} from "../rules/skills.mjs"
 */

/**
 * Describe a unit as it is now for the conditions and numbers of its skills.
 * @param {Actor} actor
 * @param {{near: object}|null} [place]   Where it stands, if it has a token on a map
 * @returns {object}
 */
function selfOf(actor, place = null) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  return {
    name: actor.token?.name ?? actor.name,
    uuid: actor.uuid,
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    stats: system.statValues,
    waiting: system.waiting,
    weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
    near: place?.near ?? null,
    qualities: system.specialQualities ?? "",
    shifted: !!system.shift?.transformed
  };
}

/* -------------------------------------------- */

/**
 * Let a unit's skills have a moment of its turn: roll for those that need a roll, restore the HP they give,
 * and report it in one chat card. A unit that is out of the fight does nothing.
 * @param {Actor} actor
 * @param {"turnStart"|"turnEnd"|"wait"} moment
 * @param {object} [options]
 * @param {{skill: string, ready: boolean, ended: boolean}[]} [options.tracker]
 *        Skills that came off cooldown or stopped lasting, to report on the same card
 * @returns {Promise<TurnMoment|null>}    What happened, or null if no skill had its moment
 */
export async function skillMomentFor(actor, moment, { tracker = [] } = {}) {
  if ( actor?.type !== "unit" ) return null;
  const system = actor.system;

  // Where the unit stands as its moment comes: its skills may ask about the units around it or reach for
  // them, and the auras it receives from their skills have their moment with its own
  const token = actor.token ?? tokenInView(actor);
  const place = standingOf(token);
  const skills = [...(system.skills?.entries ?? []), ...(place?.auras ?? [])];
  const self = selfOf(actor, place);
  const name = actor.token?.name ?? actor.name;
  const conditions = conditionsOf(actor);
  const waiting = (system.defeat?.state || !(self.hp > 0)) ? [] : turnEffects(skills, self, moment, { conditions });
  if ( !waiting.length ) {
    if ( tracker.length ) {
      const nothing = { hpBefore: self.hp, hp: self.hp, healed: 0, entries: [] };
      await postCard(actor, buildSkillTurnCard(nothing, game.i18n, { name, moment, tracker }));
    }
    return null;
  }

  // Every die that may be needed is rolled at once, and the message shows the ones that were used
  const needed = waiting.filter(({ effect }) => !effect.proc.sure).length;
  const { results } = needed ? await rollD100(needed) : { results: [] };
  const used = [];
  const result = turnMoment(skills, self, moment, () => {
    const next = results[used.length];
    used.push(next);
    return next;
  }, { activation: system.skills.activation ?? 0, always: !!system.skills.rules?.includes("alwaysActivate"), conditions });
  if ( !result.entries.length ) return null;

  if ( result.hp !== result.hpBefore ) await actor.update({ "system.hp.value": result.hp });

  // Conditions the unit is cured of
  const cured = [...new Set(result.entries.flatMap((entry) => entry.cured ?? []))];
  if ( cured.length ) await setConditions(actor, Object.fromEntries(cured.map((id) => [id, null])));

  // HP a skill restores to the units around. Those this user may not change are left for the table
  for ( const entry of result.entries ) {
    for ( const reached of entry.reached ?? [] ) {
      if ( !reached.healed ) continue;
      const other = token?.parent?.tokens.get(reached.id)?.actor;
      if ( other?.isOwner ) await other.update({ "system.hp.value": reached.hp });
      else reached.unsaved = true;
    }
  }

  // Changes that last a while which skills granted: to the unit itself, and to the units around
  const own = result.entries.flatMap((entry) => (entry.granted ?? []).filter((granted) => !granted.unit).map((granted) => granted.change));
  if ( own.length ) await grantTimed(actor, own);
  for ( const entry of result.entries ) {
    for ( const granted of entry.granted ?? [] ) {
      if ( !granted.unit ) continue;
      const other = token?.parent?.tokens.get(granted.unit)?.actor;
      if ( other?.isOwner ) await grantTimed(other, [granted.change]);
      else granted.unsaved = true;
    }
  }
  await postCard(actor, buildSkillTurnCard(result, game.i18n, { name, moment, tracker }), {
    rolls: used.length ? [rollFromResults(used)] : []
  });
  return result;
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: it no longer counts as Waiting, the skills it chooses when to activate count a turn
 * (cooldowns run down, what lasts a number of turns may end, uses per turn come back), and its skills have
 * their moment.
 * @param {Actor} actor
 * @returns {Promise<TurnMoment|null>}
 */
export async function startSkillTurnFor(actor) {
  if ( actor?.type !== "unit" ) return null;
  if ( actor.system.waiting ) await actor.update({ "system.waiting": false });

  // What lasted until the start of this turn is over
  const updates = [];
  const tracker = (await tickTimedFor(actor, "turnStart")).map((name) => ({ skill: name, ready: false, ended: true }));
  for ( const item of actor.items ) {
    if ( (item.type !== "skill") || !item.system.usage?.kind ) continue;
    const ticked = tickSkill(item.system.usage, item.system.state);
    if ( ticked.changed ) updates.push({ _id: item.id, "system.state": ticked.state });
    if ( ticked.ready || ticked.ended ) tracker.push({ skill: item.name, ready: ticked.ready, ended: ticked.ended });
  }
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  return skillMomentFor(actor, "turnStart", { tracker });
}

/* -------------------------------------------- */

/**
 * A battle begins: for every unit in it the uses and cooldowns of its skills come back, and what was declared
 * or lasting is over. Runs for the user who begins the encounter.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleSkills(combat) {
  const seen = new Set();
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor) || !actor.isOwner ) continue;
    seen.add(actor);
    const updates = [];
    for ( const item of actor.items ) {
      if ( (item.type !== "skill") || !item.system.usage?.kind ) continue;
      const reset = resetSkill(item.system.usage, item.system.state);
      if ( reset.changed ) updates.push({ _id: item.id, "system.state": reset.state });
    }
    if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);

    // What lasted until the end of the last map, or was still running, is over
    if ( actor.system.timed?.length ) await actor.update({ "system.timed": [] });
  }
}

/* -------------------------------------------- */

/**
 * A unit's turn ends: its skills have their moment.
 * @param {Actor} actor
 * @returns {Promise<TurnMoment|null>}
 */
export async function endSkillTurnFor(actor) {
  if ( actor?.type !== "unit" ) return null;

  // What lasted until the end of this turn is over, before skills grant anything new
  const tracker = (await tickTimedFor(actor, "turnEnd")).map((name) => ({ skill: name, ready: false, ended: true }));
  return skillMomentFor(actor, "turnEnd", { tracker });
}

/* -------------------------------------------- */

/**
 * A unit Waits: it counts as Waiting until its next turn starts, and its skills have their moment. Waiting
 * twice in a turn does nothing the second time.
 * @param {Actor} actor
 * @returns {Promise<TurnMoment|null>}
 */
export async function waitFor(actor) {
  if ( actor?.type !== "unit" ) return null;
  if ( actor.system.defeat?.state ) {
    ui.notifications.warn("FEO.Wait.down", { localize: true });
    return null;
  }
  if ( actor.system.waiting ) {
    ui.notifications.info("FEO.Wait.already", { localize: true });
    return null;
  }
  await actor.update({ "system.waiting": true });
  return skillMomentFor(actor, "wait");
}

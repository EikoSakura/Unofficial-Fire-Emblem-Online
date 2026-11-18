import { FEO } from "../config.mjs";
import { USE_MOMENT, momentDice, turnEffects, turnMoment, useMoment } from "../rules/skills.mjs";
import { carriedNames, harmsOf, keptBetweenMaps, mendsOf, timedName } from "../rules/timed.mjs";
import { describeChange } from "./timed-context.mjs";
import { resetSkill, spendSkill, tickSkill } from "../rules/skill-usage.mjs";
import { awardActivations, cooldownsFor, resetAffinity, tickAffinity } from "./affinity.mjs";
import { postCard, rollD100, rollFromResults } from "./chat.mjs";
import { clockOf } from "./clock.mjs";
import { conditionsOf, setConditions } from "./conditions.mjs";
import { cutIn } from "./cut-ins.mjs";
import { afflictUnit, awardGold, damageUnit, grantUnit, healUnit } from "./events.mjs";
import { goldGained, goldTally, turnGold } from "../rules/earnings.mjs";
import { turnMoveOf } from "./movement.mjs";
import { standingOf, tokenInView } from "./positions.mjs";
import { buildSkillTurnCard } from "./skill-turn-context.mjs";
import { grantTimed, tickTimedFor, timedOf } from "./timed.mjs";

/**
 * What a unit's skills do at the moments of its turn: when it starts, when it ends, and when the unit Waits.
 * A unit that has Waited stays `waiting` until its next turn starts, which some skills ask for.
 *
 * @import {TurnMoment} from "../rules/skills.mjs"
 */

/**
 * Did a skill do nothing at its moment but give its unit gold, as Income does? What it gave is told by the
 * float over the unit alone: it flashes no cut-in and posts no card, turn after turn.
 * @param {object} entry      One skill's part of a moment (see `turnMoment`)
 * @returns {boolean}
 */
function onlyGold(entry) {
  return !!entry.success && !!entry.sure && (entry.gold !== undefined) && !entry.recover && !entry.remind && !entry.granted?.length
    && !entry.cured?.length && !entry.inflicts?.length && !entry.reached && !entry.spread;
}

/* -------------------------------------------- */

/**
 * Describe a unit as it is now for the conditions and numbers of its skills.
 * @param {Actor} actor
 * @param {{near: object}|null} [place]   Where it stands, if it has a token on a map
 * @param {object|null} [move]            How it moved this turn, if that can be judged
 * @returns {object}
 */
function selfOf(actor, place = null, move = null) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  return {
    name: actor.token?.name ?? actor.name,
    uuid: actor.uuid,
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    stats: system.statValues,
    waiting: system.waiting,
    weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
    near: place?.near ?? null,
    move,

    // The lasting changes of its own that it carries, for a skill that asks for one by name
    carried: carriedNames(system.timed),
    clock: clockOf(actor),
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
  const self = selfOf(actor, place, turnMoveOf(token));
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
  // A change whose stats dice pick rolls its own
  const needed = momentDice(waiting);
  const { results } = needed ? await rollD100(needed) : { results: [] };
  const used = [];
  const having = (picks = null) => turnMoment(skills, self, moment, () => {
    const next = results[used.length];
    used.push(next);
    return next;
  }, { activation: system.skills.activation ?? 0, always: !!system.skills.rules?.includes("alwaysActivate"), conditions, picks });
  let result = having();
  if ( !result.entries.length ) return null;

  // A change that has its unit pick stats: whoever acts for the unit picks them above the dock, and the moment
  // is worked out again from the same dice with what was picked. With no answer the stats picked for it stand
  const asked = new Map();
  for ( const entry of result.entries ) {
    for ( const granted of entry.granted ?? [] ) if ( granted.choose && !asked.has(granted.change.name) ) asked.set(granted.change.name, granted.choose);
  }
  if ( asked.size ) {
    const picks = {};
    try {
      const { pickStatsFor } = await import("./answers.mjs");
      for ( const [skill, choose] of asked ) {
        const picked = await pickStatsFor(token, actor, { skill, choose });
        if ( picked.length ) picks[skill] = picked;
      }
    } catch(err) {
      console.error(err);
    }
    if ( Object.keys(picks).length ) {
      used.length = 0;
      result = having(picks);
    }
  }

  // The skills that took effect flash over the unit before what they do is shown
  cutIn(result.entries.filter((entry) => entry.success && entry.skill && !onlyGold(entry)).map((entry) => ({ actor, skill: entry.skill })));
  if ( result.healed > 0 ) await healUnit(actor, result.healed);

  // A skill that takes effect by itself a limited number of times is spent by the moment that took effect: a
  // use is counted, and its cooldown starts
  const spent = [];
  for ( const entry of result.entries ) {
    const item = (entry.success && entry.uses?.id) ? actor.items.get(entry.uses.id) : null;
    if ( !item?.system?.usage?.kind || spent.some((update) => update._id === item.id) ) continue;
    spent.push({ _id: item.id, "system.state": spendSkill(item.system.usage, item.system.state, { cooldowns: cooldownsFor(actor, item) }) });
  }
  if ( spent.length ) await actor.updateEmbeddedDocuments("Item", spent);

  // An Affinity that gives experience for the unit's own Skills that rolled to activate and did, as Emblem does
  try {
    await awardActivations(actor, result.entries.filter((entry) => entry.grade).map((entry) => entry.grade));
  } catch(err) {
    console.error(err);
  }

  // Gold its skills give it at this moment, as Income does: each is counted for the map on a tally named
  // after its skill, and held to what the Game Master allows a map. A float over the unit says what it gained
  const quiet = !tracker.length && result.entries.every(onlyGold);
  for ( const entry of result.entries ) {
    if ( !entry.success || !(entry.gold > 0) ) continue;
    entry.gained = turnGold(entry.gold, goldGained(actor.system.timed, entry.skill));
    if ( !(entry.gained > 0) ) continue;
    await awardGold(actor, entry.gained);
    const tally = goldTally(entry.skill, entry.gained);
    if ( tally ) await grantTimed(actor, [tally]);
  }

  // Conditions the unit is cured of
  const cured = [...new Set(result.entries.flatMap((entry) => entry.cured ?? []))];
  if ( cured.length ) await setConditions(actor, Object.fromEntries(cured.map((id) => [id, null])));

  // Conditions the unit is given: what an aura gives it is inflicted by the unit the aura comes from
  for ( const entry of result.entries ) {
    const giver = entry.from ? (token?.parent?.tokens.get(entry.from) ?? null) : null;
    for ( const id of entry.inflicts ?? [] ) {
      const given = await afflictUnit(actor, id, { by: giver?.actor ?? null, byToken: giver, token });
      (entry.inflicted ??= []).push({ id, success: !!given && (given.success !== false) });
    }
  }

  // HP a skill restores to the units around. What cannot be saved for one of them is left for the table
  for ( const entry of result.entries ) {
    for ( const reached of entry.reached ?? [] ) {
      if ( !reached.healed ) continue;
      const other = token?.parent?.tokens.get(reached.id)?.actor;
      const healed = other ? await healUnit(other, reached.healed, { by: actor, byToken: token, token: token.parent.tokens.get(reached.id) }) : null;
      if ( !healed ) reached.unsaved = true;
    }
  }

  // What a skill does to the units around (see `rules/spread.mjs`): each gets its share through the one way
  // damage, healing and conditions come to a unit, and the card tells what came of it
  for ( const entry of result.entries ) {
    if ( !entry.spread || !token ) continue;
    try {
      const { dealSpread } = await import("./spread.mjs");
      entry.spreadTold = await dealSpread(token, { skill: entry.skill, ...entry.spread });
    } catch(err) {
      console.error(err);
    }
  }

  // Changes that last a while which skills granted: to the unit itself, and to the units around. A unit that
  // negates what would be put on it takes nothing from an enemy
  const own = result.entries.flatMap((entry) => (entry.granted ?? []).filter((granted) => !granted.unit).map((granted) => granted.change));
  if ( own.length ) await grantTimed(actor, own);
  for ( const entry of result.entries ) {
    for ( const granted of entry.granted ?? [] ) {
      if ( !granted.unit ) continue;
      const other = token?.parent?.tokens.get(granted.unit)?.actor;
      const given = other ? await grantUnit(other, [granted.change], { by: actor }) : null;
      if ( !given ) granted.unsaved = true;
    }
  }
  if ( quiet ) return result;
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

  // What it has reacted with since its last turn started is forgotten: each of its reactions is open again
  try {
    const { forgetReacted } = await import("./reactions.mjs");
    await forgetReacted(actor);
  } catch(err) {
    console.error(err);
  }

  // What the changes it carries restore to it as its turn starts, before any of them ends: each through the
  // one door for healing, told on the card of the turn
  const mended = [];
  if ( !actor.system.defeat?.state && (actor.system.hp.value > 0) ) {
    for ( const mend of mendsOf(timedOf(actor)) ) {
      const healed = await healUnit(actor, mend.amount);
      if ( healed?.healed > 0 ) mended.push({ skill: timedName(mend), healed: healed.healed });
    }
  }

  // And what they deal to it: damage of the skill of the unit that left the change, which has defeated it if
  // that brings it down
  if ( !actor.system.defeat?.state && (actor.system.hp.value > 0) ) {
    for ( const harm of harmsOf(timedOf(actor)) ) {
      if ( actor.system.defeat?.state || !(actor.system.hp.value > 0) ) break;
      let by = null;
      try {
        by = harm.by ? await foundry.utils.fromUuid(harm.by) : null;
      } catch(err) {
        by = null;
      }
      const dealt = await damageUnit(actor, harm.amount, { kind: "skill", by: (by?.type === "unit") ? by : null });
      if ( dealt?.dealt > 0 ) mended.push({ skill: timedName(harm), harmed: dealt.dealt });
    }
  }

  // A unit that is watched by another is looked at: whether it starts this turn within that unit's sight
  try {
    const { keepWatch } = await import("./actions.mjs");
    await keepWatch(actor.token ?? tokenInView(actor), { turnStart: true });
  } catch(err) {
    console.error(err);
  }

  // A skill that may do its part once more as this turn starts says so with a mark, which is read before it
  // goes with what lasted until now
  let again = [];
  try {
    const { againOffers } = await import("./areas.mjs");
    again = againOffers(actor);
  } catch(err) {
    console.error(err);
  }

  // What lasted until the start of this turn is over
  const updates = [];
  const tracker = [...mended, ...(await tickTimedFor(actor, "turnStart")).filter((name) => !again.includes(name)).map((name) => ({ skill: name, ready: false, ended: true }))];

  // A unit whose imitation has run out with that is itself again, before its skills count the turn
  try {
    const { settleImitation } = await import("./imitation.mjs");
    await settleImitation(actor);
  } catch(err) {
    console.error(err);
  }
  for ( const item of actor.items ) {
    if ( (item.type !== "skill") || !item.system.usage?.kind ) continue;
    const ticked = tickSkill(item.system.usage, item.system.state);
    if ( ticked.changed ) updates.push({ _id: item.id, "system.state": ticked.state });
    if ( ticked.ready || ticked.ended ) tracker.push({ skill: item.name, ready: ticked.ready, ended: ticked.ended });
  }
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);

  // So does an Affinity its unit chooses when to use
  try {
    tracker.push(...(await tickAffinity(actor)));
  } catch(err) {
    console.error(err);
  }

  // And whoever acts for the unit is offered it, now that what it gave before has ended
  if ( again.length ) {
    try {
      const { offerAgain } = await import("./areas.mjs");
      await offerAgain(actor, again);
    } catch(err) {
      console.error(err);
    }
  }
  return skillMomentFor(actor, "turnStart", { tracker });
}

/* -------------------------------------------- */

/**
 * A skill is used as an action: what it leaves on its unit at that moment is granted, as a change that lasts.
 * @param {Actor} actor
 * @param {Item} item         The skill that is used
 * @returns {Promise<{label: string, value: string}[]>}    Rows for the card of the skill: what was granted
 */
export async function useSkillMoment(actor, item) {
  if ( (actor?.type !== "unit") || (item?.type !== "skill") ) return [];
  const entry = (actor.system.skills?.entries ?? []).find((skill) => skill.id === item.id);
  if ( !entry?.effects?.some((effect) => effect.proc?.on === USE_MOMENT) ) return [];
  const token = actor.token ?? tokenInView(actor);
  const d100 = () => Math.min(Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * 100), 99) + 1;
  const result = useMoment(entry, selfOf(actor, standingOf(token), turnMoveOf(token)), d100);
  const rows = [];

  // What it does to the units around as it is used
  for ( const found of result.entries ) {
    if ( !found.spread || !token ) continue;
    try {
      const { dealSpread, describeSpread } = await import("./spread.mjs");
      const told = await dealSpread(token, { skill: item.name, ...found.spread });
      if ( told ) rows.push({ label: item.name, value: describeSpread(told, game.i18n) });
    } catch(err) {
      console.error(err);
    }
  }
  const own = result.entries.flatMap((found) => (found.granted ?? []).filter((granted) => !granted.unit).map((granted) => granted.change));
  if ( !own.length ) return rows;
  const given = await grantTimed(actor, own);
  return [...rows, ...given.map((change) => {
    const { what, lasts } = describeChange(change, game.i18n);
    return { label: change.name, value: [what, lasts].filter(Boolean).join(", ") };
  })];
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

    // So do those of an Affinity its unit chooses when to use. A unit whose Affinity shortens the cooldown of
    // a skill of its choice, and that has chosen none it has equipped, is told so as the map starts
    try {
      await resetAffinity(actor);
      const keys = FEO.optional.affinityEffects;
      const asks = (keys.enabled || actor.system.glory?.extras?.resonance) && !!keys.cooldown?.[actor.system.affinity];
      if ( asks && !(actor.system.skills?.entries ?? []).some((entry) => entry.cooldowns) ) {
        ui.notifications.info(game.i18n.format("FEO.Optional.affinityEffect.skill.none", { name: combatant.token?.name ?? actor.name }));
      }
    } catch(err) {
      console.error(err);
    }

    // What lasted until the end of the last map, or was still running, is over; what lasts between maps stays
    const kept = keptBetweenMaps(timedOf(actor));
    if ( (actor.system.timed?.length ?? 0) !== kept.length ) await actor.update({ "system.timed": kept });
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

import { FEO } from "../config.mjs";
import { hpTransition, plainTransition, spendRound, tickIncapacitation, treat } from "../rules/defeat.mjs";
import { postCard, rollD100 } from "./chat.mjs";
import { buildDefeatCard, buildTreatCard } from "./defeat-context.mjs";
import { incapacitates } from "./exchange.mjs";
import { awardExp, earnsExp, expRow } from "./experience.mjs";
import { postLifeCard, reviveLife, spendLife } from "./optional.mjs";

/**
 * Defeat on units in Foundry. Whenever a unit's HP changes, whatever changed it, the system works out what
 * that means: a unit of a side that uses the Incapacitation system goes down, gets back up with an Injury or
 * has its timer paused; a unit of any other side, and every unit of a world that plays without that system, is
 * defeated at 0 HP. A unit that dies or retreats leaves the map: its token is drawn no longer (see
 * `canvas/battle-canvas.mjs`).
 */

/** The update option that carries each unit's HP from before an update, by Actor UUID. */
export const HP_BEFORE = "feoHpBefore";

/** The update option that keeps the system from posting a card of its own for a unit going down. */
export const QUIET = { [FEO.id]: { quietDefeat: true } };

/**
 * Describe a unit for the defeat rules.
 * @param {Actor} actor
 * @returns {import("../rules/defeat.mjs").DefeatProfile}
 */
function profileOf(actor) {
  const system = actor.system;
  const { state, turns, paused } = system.defeat;
  return {
    hpMax: system.hp.base,
    resilience: system.defeat.resilience,
    graveWounds: system.graveWounds,
    injuries: system.injuries,
    defeat: { state, turns, paused }
  };
}

const nameOf = (actor) => actor.token?.name ?? actor.name;

/* -------------------------------------------- */
/*  Following HP                                */
/* -------------------------------------------- */

/**
 * Before a unit's HP is changed, note what it was. Called for an Actor and for the Actor of an unlinked token.
 * @param {Actor|null} actor
 * @param {object} changes
 * @param {object} options      The options of the update, which travel with it
 */
export function rememberHp(actor, changes, options) {
  if ( (actor?.type !== "unit") || !options ) return;
  if ( !foundry.utils.hasProperty(changes, "system.hp.value") ) return;
  (options[HP_BEFORE] ??= {})[actor.uuid] = actor.system.hp.value;
}

/* -------------------------------------------- */

/**
 * After a unit's HP has changed, work out what that means for it. Runs for the user who made the change.
 * @param {Actor} actor
 * @param {object} changed
 * @param {object} options
 * @param {string} userId
 * @returns {Promise<string|null>}    What happened, if anything
 */
export async function followHp(actor, changed, options, userId) {
  if ( (actor?.type !== "unit") || (userId !== game.user.id) ) return null;
  if ( !foundry.utils.hasProperty(changed, "system.hp.value") ) return null;

  const system = actor.system;
  const state = system.defeat.state;
  const after = system.hp.value;
  const before = options?.[HP_BEFORE]?.[actor.uuid] ?? (state ? after : 1);

  // A unit the Incapacitation system does not apply to, as every unit is in a world that plays without it:
  // defeated at 0 HP, and back when raised above it
  if ( !incapacitates(actor, actor.token) ) {
    const plain = { hpMax: system.hp.base, defeat: { state } };
    const fall = plainTransition(plain, before, after);
    if ( fall?.event === "defeated" ) {
      // With Additional Lives, a unit that would die loses a life and leaves the battle instead
      const life = spendLife(actor);
      const fallen = plainTransition(plain, before, after, { spare: !!life && !life.dead }).defeat;
      await actor.update({ "system.defeat": fallen, ...(life?.update ?? {}) });
      await syncStatus(actor);
      if ( life ) await postLifeCard(actor, life.dead ? "last" : "lost", life);
      return fallen.state;
    }
    if ( fall?.event === "returned" ) {
      // A unit brought back from death returns with one life
      const life = reviveLife(actor);
      await actor.update({ "system.defeat": fall.defeat, ...(life?.update ?? {}) });
      await syncStatus(actor);
      if ( life ) await postLifeCard(actor, "revived", life);
      return "returned";
    }
    return null;
  }

  const change = hpTransition(profileOf(actor), before, after);
  if ( !change ) return null;

  // The Injury of getting back up may be spared by a skill of the unit, which is rolled for here
  let spared = [];
  let dice = [];
  if ( (change.event === "recovered") && (change.injuries > system.injuries) ) {
    try {
      const { spareHarm } = await import("./events.mjs");
      const saved = await spareHarm(actor, "injury", change.injuries - system.injuries);
      spared = saved.rolls;
      dice = saved.roll ? [saved.roll] : [];
      change.injuries = system.injuries + saved.left;
    } catch(err) {
      console.error(err);
    }
  }
  const update = { "system.defeat": change.defeat };
  if ( change.injuries !== system.injuries ) {
    // An Injury lowers maximum HP, which current HP cannot exceed
    update["system.injuries"] = change.injuries;
    const max = Math.max(system.hp.max - ((change.injuries - system.injuries) * FEO.injuryPenalty), 0);
    if ( after > max ) update["system.hp.value"] = max;
  }
  await actor.update(update);
  await syncStatus(actor);

  const quiet = !!options?.[FEO.id]?.quietDefeat && (change.event === "down");
  if ( !quiet ) await postCard(actor, buildDefeatCard(change.event, {
    name: nameOf(actor),
    turns: change.defeat.turns,
    injuries: change.injuries,
    hp: after,
    fate: actor.system.defeat.fate,
    spared
  }, game.i18n), { rolls: dice });
  return change.event;
}

/* -------------------------------------------- */

/**
 * Show a unit's defeat on its tokens and in the encounter.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function syncStatus(actor) {
  const state = actor.system.defeat.state;
  const out = ["dead", "retreated", "captured"].includes(state);
  try {
    const down = FEO.defeat.status.id;
    if ( CONFIG.statusEffects[down] ) await actor.toggleStatusEffect(down, { active: state === "incapacitated" });
    const dead = CONFIG.specialStatusEffects.DEFEATED;
    if ( CONFIG.statusEffects[dead] ) await actor.toggleStatusEffect(dead, { active: state === "dead", overlay: true });
    for ( const combatant of game.combat?.combatants ?? [] ) {
      if ( (combatant.actor !== actor) || (combatant.defeated === out) || !combatant.isOwner ) continue;
      await combatant.update({ defeated: out });
    }
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */
/*  Incapacitation                              */
/* -------------------------------------------- */

/**
 * An Incapacitated unit's turn starts: its timer runs down, unless healing paused it.
 * @param {Actor} actor
 * @returns {Promise<object|null>}    What happened, or null for a unit that is not Incapacitated
 */
export async function tickDefeatFor(actor) {
  if ( (actor?.type !== "unit") || !FEO.defeat.enabled ) return null;
  const { state, turns, paused } = actor.system.defeat;
  const tick = tickIncapacitation({ state, turns, paused });
  if ( !tick ) return null;
  await actor.update({ "system.defeat": tick.defeat });
  await postCard(actor, buildDefeatCard(tick.resumed ? "resumed" : "tick", {
    name: nameOf(actor),
    turns: tick.to,
    fate: actor.system.defeat.fate
  }, game.i18n));
  return tick;
}

/* -------------------------------------------- */

/**
 * An Incapacitated unit gives up a turn of its timer to take one action or move half its movement.
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function spendRoundFor(actor) {
  const { state, turns, paused } = actor.system.defeat;
  const next = spendRound({ state, turns, paused });
  if ( !next ) {
    ui.notifications.warn("FEO.Defeat.noRounds", { localize: true });
    return false;
  }
  await actor.update({ "system.defeat": next });
  await postCard(actor, buildDefeatCard("spent", {
    name: nameOf(actor),
    turns: next.turns,
    fate: actor.system.defeat.fate
  }, game.i18n));
  return true;
}

/* -------------------------------------------- */

/**
 * Settle what becomes of a unit: it retreats from the map, is killed, or returns to the party.
 * @param {Actor} actor
 * @param {"retreated"|"dead"|""} state     Blank brings the unit back
 * @returns {Promise<boolean>}
 */
export async function setFate(actor, state) {
  let life = null;
  if ( state === "dead" ) {
    // With Additional Lives, a unit with a life to spare loses it instead of dying. Whether this death is one
    // a life answers for is the table's call, so it is asked
    const spare = spendLife(actor);
    if ( spare ) {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "FEO.Defeat.killTitle" },
        content: `<p>${game.i18n.format("FEO.Optional.lives.killPrompt", {
          name: nameOf(actor),
          left: spare.left + 1,
          limit: spare.limit
        })}</p>`,
        buttons: [
          { action: "life", label: "FEO.Optional.lives.lose", icon: "fa-solid fa-heart-crack", default: true },
          { action: "dead", label: "FEO.Optional.lives.killOutright", icon: "fa-solid fa-skull" },
          { action: "cancel", label: "COMMON.Cancel" }
        ],
        rejectClose: false
      });
      if ( (choice !== "life") && (choice !== "dead") ) return false;
      if ( choice === "life" ) life = spare;
    }
    else {
      const sure = await foundry.applications.api.DialogV2.confirm({
        window: { title: "FEO.Defeat.killTitle" },
        content: `<p>${game.i18n.format("FEO.Defeat.killPrompt", { name: nameOf(actor) })}</p>`,
        rejectClose: false
      });
      if ( !sure ) return false;
    }
  }

  // A unit that loses a life leaves the battle, unless it was its last
  const fate = life && !life.dead ? "retreated" : state;
  const update = { "system.defeat": { state: fate, turns: 0, paused: false }, ...(life?.update ?? {}) };

  // A unit that comes back is on its feet again, and one brought back from death returns with one life
  const revived = !state && (actor.system.defeat.state === "dead") ? reviveLife(actor) : null;
  if ( revived ) Object.assign(update, revived.update);
  if ( !state && (actor.system.hp.value <= 0) ) update["system.hp.value"] = Math.min(1, actor.system.hp.max);
  await actor.update(update);
  await syncStatus(actor);
  if ( life ) await postLifeCard(actor, life.dead ? "last" : "lost", life);
  else await postCard(actor, buildDefeatCard(state || "returned", { name: nameOf(actor) }, game.i18n));
  if ( revived ) await postLifeCard(actor, "revived", revived);
  return true;
}

/* -------------------------------------------- */
/*  Treatment                                   */
/* -------------------------------------------- */

/**
 * The units that could treat a patient: those the user owns that are still in the fight, tokens they have
 * selected first and then the best healers.
 * @param {Actor} patient
 * @returns {Actor[]}
 */
function healersFor(patient) {
  const check = FEO.defeat.treat.check;
  const medicine = (actor) => actor.system.checks[check].bonus;
  const selected = (canvas?.tokens?.controlled ?? []).map((token) => token.actor);
  const owned = game.actors.filter((actor) => actor.isOwner).sort((a, b) => {
    return (a.type === "unit") && (b.type === "unit") ? medicine(b) - medicine(a) : 0;
  });
  const seen = new Set();
  return [...selected, ...owned].filter((actor) => {
    if ( !actor || (actor.type !== "unit") || (actor === patient) || !actor.isOwner || seen.has(actor.uuid) ) return false;
    if ( actor.system.defeat.state ) return false;
    seen.add(actor.uuid);
    return true;
  });
}

/* -------------------------------------------- */

/**
 * Have another unit treat a patient's Wounds, and on a day of downtime its Injuries too: a Medicine check
 * against a target number that rises with each one.
 * @param {Actor} patient
 * @returns {Promise<object|null>}    The result of the check, or null if it was called off
 */
export async function treatUnit(patient) {
  const { wounds, injuries } = patient.system;
  if ( !wounds && !injuries ) return null;
  const healers = healersFor(patient);
  if ( !healers.length ) {
    ui.notifications.warn("FEO.Treat.noHealer", { localize: true });
    return null;
  }

  const check = FEO.defeat.treat.check;
  const content = document.createElement("div");
  content.innerHTML = await foundry.applications.handlebars.renderTemplate(
    `systems/${FEO.id}/templates/dialog/treat.hbs`,
    {
      patient: nameOf(patient),
      wounds,
      injuries,
      healers: healers.map((actor) => ({ uuid: actor.uuid, name: nameOf(actor), medicine: actor.system.checks[check].bonus }))
    }
  );
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.Treat.dialogTitle" },
    position: { width: 420 },
    content,
    buttons: [
      { action: "treat", label: "FEO.Treat.confirm", icon: "fa-solid fa-dice-d20", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( !answer || (answer === "cancel") ) return null;
  const healer = healers.find((actor) => actor.uuid === answer.healer) ?? healers[0];

  const medicine = healer.system.checks[check].bonus;
  const { roll, results: [die] } = await rollD100(1);
  const result = treat({ wounds, injuries }, { medicine }, die, { injuries: !!answer.downtime });

  const update = {};
  if ( result.wounds?.healed ) update["system.wounds"] = result.wounds.left;
  if ( result.injuries?.healed ) update["system.injuries"] = result.injuries.left;
  if ( Object.keys(update).length ) await patient.update(update);

  const card = buildTreatCard({ healer: nameOf(healer), patient: nameOf(patient), roll: die, medicine, result }, game.i18n);
  if ( result.exp && earnsExp(healer) ) card.rows.push(expRow(await awardExp(healer, result.exp)));
  await postCard(healer, card, { rolls: [roll] });
  return result;
}

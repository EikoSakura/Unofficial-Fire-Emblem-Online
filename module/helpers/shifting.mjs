import { FEO } from "../config.mjs";
import { canShift, changeGauge, gaugeTurnStart, isHumanWeapon, shiftLapses } from "../rules/shifting.mjs";
import { postCard } from "./chat.mjs";
import { armyOf, measureDistance } from "./exchange.mjs";

/**
 * Changing form on units in Foundry: the Shift Gauge of a Laguz and the stone of a Manakete or Taguel.
 */

const nameOf = (actor) => actor.token?.name ?? actor.name;

/** The flag of a unit whose Shift was made at will, with a gauge that did not hold enough for it. */
const LENT_FLAG = "shiftLent";

/** The units that were offered a Shift, each with the turn it was offered in: nobody is asked twice a turn. */
const offered = new Map();

/**
 * A card about a unit's form.
 * @param {Actor} actor
 * @param {string} outcome              A translation key for what happened
 * @param {object} [options]
 * @param {object[]} [options.rows]
 * @param {string} [options.note]       A translation key
 * @param {string} [options.cls]
 * @returns {Promise<ChatMessage>}
 */
function shiftCard(actor, outcome, { rows = [], note = null, cls = "" } = {}) {
  return postCard(actor, {
    title: nameOf(actor),
    subtitle: game.i18n.localize("FEO.Shift.title"),
    outcome: { label: game.i18n.localize(outcome), cls },
    rows,
    note: note ? game.i18n.localize(note) : undefined
  });
}

const gaugeRow = (from, to) => ({
  label: game.i18n.localize("FEO.Shift.gauge"),
  value: from === to ? `${to} / ${FEO.shift.gauge.max}` : `${from} → ${to} / ${FEO.shift.gauge.max}`
});

/* -------------------------------------------- */

/**
 * Put the right weapon in a unit's hands for its form: the weapon of its people while transformed, and what
 * a unit fights with in humanoid form otherwise. A unit that carries neither keeps what it has.
 * @param {Actor} actor
 * @param {boolean} transformed
 * @returns {Promise<void>}
 */
export async function equipForForm(actor, transformed) {
  // A unit whose skills let it start a fight in humanoid form does so with what a unit fights with in that
  // form: one that carries none is handed it, so that its hands need not be looked at before it attacks
  if ( !transformed && Number.isFinite(actor.system.shift?.bends?.humanFight)
    && !actor.items.some((item) => (item.type === "weapon") && isHumanWeapon(item.name)) ) {
    try {
      const { findItem } = await import("./classes.mjs");
      const source = await findItem("weapon", FEO.shift.humanWeapon);
      if ( source ) {
        const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
        delete data._id;
        data.system = { ...(data.system ?? {}), equipped: false };
        await actor.createEmbeddedDocuments("Item", [data]);
      }
    } catch(err) {
      console.error(err);
    }
  }
  const weapons = actor.items.filter((item) => item.type === "weapon");
  const natural = (item) => FEO.shift.weaponCategories.includes(item.system.category);
  const wanted = transformed
    ? weapons.find(natural)
    : weapons.find((item) => isHumanWeapon(item.name));
  const updates = [];
  for ( const item of weapons ) {
    const equip = wanted ? (item === wanted) : (item.system.equipped && (transformed || !natural(item)));
    if ( item.system.equipped !== equip ) updates.push({ _id: item.id, "system.equipped": equip });
  }
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
}

/* -------------------------------------------- */

/**
 * Shift a Laguz into its animal form, or back out of it.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.force]   Shift even without enough gauge, as some skills and the Game Master allow
 * @returns {Promise<boolean>}        Whether the unit changed form
 */
export async function toggleShift(actor, { force = false } = {}) {
  const shift = actor.system.shift;
  if ( shift.mode !== "gauge" ) return false;
  if ( !shift.active && !force && !canShift(shift, { atWill: !!shift.bends?.atWill }) ) {
    ui.notifications.warn(game.i18n.format("FEO.Shift.notEnough", { needed: FEO.shift.gauge.shiftAt }));
    return false;
  }
  const active = !shift.active;

  // A Shift that only a change lasting on the unit lets it make, as Gregarious does for a turn, ends with it
  const lent = active && !force && !canShift(shift) && !!shift.bends?.atWill && !!shift.bends?.brief;
  await actor.update({
    "system.shift.active": active,
    ...(lent ? { [`flags.${FEO.id}.${LENT_FLAG}`]: true } : (actor.getFlag(FEO.id, LENT_FLAG) ? { [`flags.${FEO.id}.-=${LENT_FLAG}`]: null } : {}))
  });
  await equipForForm(actor, active);
  await shiftCard(actor, active ? "FEO.Shift.shifts" : "FEO.Shift.reverts", {
    rows: [gaugeRow(shift.value, shift.value)],
    note: "FEO.Shift.noMove",
    cls: active ? "good" : ""
  });
  return true;
}

/* -------------------------------------------- */

/**
 * A unit whose Shift was only made at will, as a change that lasts on it for a turn let it, is in humanoid
 * form again once nothing lets it Shift at will any longer; unless its gauge has come to hold enough.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it reverted
 */
async function lapseShift(actor) {
  if ( (actor?.type !== "unit") || !actor.isOwner || !actor.getFlag(FEO.id, LENT_FLAG) ) return false;
  const shift = actor.system.shift;
  if ( (shift.mode !== "gauge") || !shift.active ) {
    await actor.unsetFlag(FEO.id, LENT_FLAG);
    return false;
  }
  if ( !shiftLapses(shift, { lent: true, atWill: !!shift.bends?.atWill }) ) {
    // A gauge that holds enough makes the Shift the unit's own from here on
    if ( !shift.bends?.brief ) await actor.unsetFlag(FEO.id, LENT_FLAG);
    return false;
  }
  await actor.update({ "system.shift.active": false, [`flags.${FEO.id}.-=${LENT_FLAG}`]: null });
  await equipForForm(actor, false);
  await shiftCard(actor, "FEO.Shift.reverts", { rows: [gaugeRow(shift.value, shift.value)] });
  return true;
}

/* -------------------------------------------- */

/**
 * Offer a Shift to a unit that a change lasting on it lets Shift at will for a while, as Gregarious does:
 * whoever acts for it is asked once a turn, above the dock on their own map, and a unit that answers by itself
 * Shifts. A unit that is transformed, or whose gauge lets it Shift anyway, is not asked.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it Shifted
 */
async function offerShift(actor) {
  const shift = actor?.system?.shift;
  if ( (actor?.type !== "unit") || (shift?.mode !== "gauge") || shift.active || !shift.bends?.brief || !shift.bends?.atWill ) return false;
  if ( canShift(shift) || actor.system.defeat?.state || !(actor.system.hp?.value > 0) ) return false;
  const combat = game.combat?.started ? game.combat : null;
  const stamp = combat ? `${combat.id}:${combat.round}:${combat.getFlag?.(FEO.id, "phase") ?? ""}` : "";
  if ( stamp && (offered.get(actor.uuid) === stamp) ) return false;
  offered.set(actor.uuid, stamp);

  // The change that lets it, for what the offer is called
  const by = (actor.system.timed ?? []).find((change) => (change.effects ?? []).some((effect) => effect?.shift?.brief))?.name ?? game.i18n.localize("FEO.Shift.title");
  const { answersAlone, askFor } = await import("./answers.mjs");
  let take = answersAlone(actor);
  if ( !take ) {
    const { tokenInView } = await import("./positions.mjs");
    const token = actor.token ?? tokenInView(actor);
    const picked = await askFor({ token, actor }, {
      index: 0, on: "shift", side: "initiator", attack: null,
      about: game.i18n.localize("FEO.Shift.offerHint"),
      offers: [{ key: "shift", skill: by, id: null, what: "shift", item: { name: game.i18n.localize("FEO.Shift.shift") } }]
    }, "", { alone: false });
    take = picked === "shift";
  }
  if ( !take ) return false;

  // Asked a moment ago, it may have Shifted meanwhile, or lost what let it
  const now = actor.system.shift;
  if ( now.active || !now.bends?.atWill ) return false;
  if ( actor.isOwner ) return toggleShift(actor);
  return false;
}

/* -------------------------------------------- */

/**
 * A unit's turn has started and its skills have had their moment: of the units on its scene, those whose
 * Shift was only lent them revert where nothing lends it any longer, and those that may now Shift at will for
 * a while are offered it. The offers are not waited for, so that the turn goes on meanwhile.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function settleShiftsFor(actor) {
  if ( actor?.type !== "unit" ) return;
  const { tokenInView } = await import("./positions.mjs");
  const scene = (actor.token ?? tokenInView(actor))?.parent ?? null;
  const units = new Set([actor]);
  for ( const token of scene?.tokens ?? [] ) if ( token.actor?.type === "unit" ) units.add(token.actor);
  const asked = [];
  for ( const unit of units ) {
    if ( unit.system.shift?.mode !== "gauge" ) continue;
    try {
      await lapseShift(unit);
    } catch(err) {
      console.error(err);
    }
    if ( unit.system.shift.bends?.brief && unit.isOwner ) asked.push(unit);
  }
  if ( asked.length ) {
    (async () => {
      for ( const unit of asked ) await offerShift(unit);
    })().catch((err) => console.error(err));
  }
}

/* -------------------------------------------- */

/**
 * Set a Laguz's gauge to where it starts a map, in humanoid form.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.keep]    Leave the gauge where the last map left it, as a skill may have it
 * @returns {Promise<void>}
 */
export async function resetGauge(actor, { keep = false } = {}) {
  const shift = actor.system.shift;
  if ( shift.mode !== "gauge" ) return;
  const wasActive = shift.active;
  await actor.update({ "system.shift": {
    value: keep ? shift.value : Math.min(Math.max(shift.profile.start, 0), FEO.shift.gauge.max),
    active: false,
    fought: { own: 0, other: 0 }
  } });
  // A unit that may start a fight in humanoid form has what it fights with there in hand as the map starts
  if ( wasActive || Number.isFinite(shift.bends?.humanFight) ) await equipForForm(actor, false);
  if ( actor.getFlag(FEO.id, LENT_FLAG) ) await actor.unsetFlag(FEO.id, LENT_FLAG);
}

/* -------------------------------------------- */

/**
 * Is a Manakete or Taguel next to another Non-Beorc unit of its own side?
 * @param {Actor} actor
 * @returns {boolean|null}    Null when the unit has no token to measure from
 */
function besideKin(actor) {
  const tokens = actor.getActiveTokens(false, true);
  if ( !tokens.length ) return null;
  return tokens.some((token) => token.parent.tokens.some((other) => {
    const ally = other.actor;
    if ( (other === token) || (ally?.type !== "unit") || !ally.system.shift?.mode || ally.system.defeat?.out ) return false;
    if ( armyOf(ally, other) !== armyOf(actor, token) ) return false;
    return measureDistance(token, other) === 1;
  }));
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: a Shift Gauge fills or drains, and a stone is ready to transform its bearer again.
 * @param {Actor} actor
 * @returns {Promise<object|null>}    What happened, or null for a unit that does not change form
 */
export async function tickShiftFor(actor) {
  if ( actor?.type !== "unit" ) return null;
  const shift = actor.system.shift;

  if ( shift.mode === "gauge" ) {
    const tick = gaugeTurnStart(shift, shift.profile);
    await actor.update({ "system.shift": { value: tick.value, active: tick.active, fought: tick.fought } });
    if ( tick.reverted ) await equipForForm(actor, false);
    if ( tick.delta || tick.reverted ) {
      const ready = !tick.active && (shift.value < FEO.shift.gauge.shiftAt) && (tick.value >= FEO.shift.gauge.shiftAt);
      await shiftCard(actor, tick.reverted ? "FEO.Shift.reverts" : ready ? "FEO.Shift.ready" : "FEO.Shift.turn", {
        rows: [gaugeRow(shift.value, tick.value)],
        cls: ready ? "good" : ""
      });
    }
    return tick;
  }

  if ( shift.mode === "stone" ) {
    const beside = besideKin(actor);
    const boosted = beside ?? shift.boosted;
    if ( shift.uses || (boosted !== shift.boosted) ) {
      await actor.update({ "system.shift": { uses: 0, boosted } });
    }
    if ( boosted && !shift.boosted ) await shiftCard(actor, "FEO.Shift.boosted", { cls: "good" });
    return { uses: 0, boosted };
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Change a Laguz's gauge by hand, as items and skills do.
 * @param {Actor} actor
 * @param {number} delta
 * @returns {Promise<void>}
 */
export async function adjustGauge(actor, delta) {
  const shift = actor.system.shift;
  if ( shift.mode !== "gauge" ) return;
  const change = changeGauge(shift, delta);
  if ( !change.delta ) return;
  await actor.update({ "system.shift": { value: change.value, active: change.active } });
  if ( change.reverted ) {
    await equipForForm(actor, false);
    await shiftCard(actor, "FEO.Shift.reverts", { rows: [gaugeRow(shift.value, change.value)] });
  }
}

/* -------------------------------------------- */

/**
 * A battle begins: every Laguz in it starts from its starting gauge.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleShift(combat) {
  const done = new Set();
  for ( const combatant of combat.combatants ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || done.has(actor.uuid) ) continue;
    done.add(actor.uuid);
    if ( actor.system.shift.mode === "gauge" ) await resetGauge(actor, { keep: !!actor.system.shift.bends?.keep });
    else if ( (actor.system.shift.mode === "stone") && actor.system.shift.uses ) await actor.update({ "system.shift.uses": 0 });
  }
}

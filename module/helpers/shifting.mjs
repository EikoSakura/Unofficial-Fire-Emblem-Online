import { FEO } from "../config.mjs";
import { canShift, changeGauge, gaugeTurnStart } from "../rules/shifting.mjs";
import { postCard } from "./chat.mjs";
import { armyOf, measureDistance } from "./exchange.mjs";

/**
 * Changing form on units in Foundry: the Shift Gauge of a Laguz and the stone of a Manakete or Taguel.
 */

const nameOf = (actor) => actor.token?.name ?? actor.name;

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
  const weapons = actor.items.filter((item) => item.type === "weapon");
  const natural = (item) => FEO.shift.weaponCategories.includes(item.system.category);
  const wanted = transformed
    ? weapons.find(natural)
    : weapons.find((item) => item.name.trim().toLowerCase() === FEO.shift.humanWeapon.toLowerCase());
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
  await actor.update({ "system.shift.active": active });
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
  if ( wasActive ) await equipForForm(actor, false);
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

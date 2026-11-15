import { FEO } from "../config.mjs";
import { addPoints, bondsWithin, eventPoints, namesPartner, rangeState, topRank } from "../rules/supports.mjs";
import { postCard } from "./chat.mjs";
import { measureDistance } from "./exchange.mjs";

/**
 * Supports on units in Foundry: finding out from the tokens on a scene which partners are in range, and
 * handing out support points.
 */

/**
 * Describe the unit behind a token for the support rules.
 * @param {TokenDocument} token
 * @returns {{token: TokenDocument, actor: Actor, uuid: string, uuids: string[], names: string[], bonds: object[]}}
 */
function unitOf(token) {
  const actor = token.actor;
  return {
    token,
    actor,
    uuid: actor.uuid,
    uuids: [token.baseActor?.uuid].filter(Boolean),
    names: [token.name, actor.name],
    bonds: actor.system.bonds
  };
}

/**
 * The units with a token on a scene that are still in the fight.
 * @param {Scene} scene
 * @returns {ReturnType<typeof unitOf>[]}
 */
function unitsOn(scene) {
  return scene.tokens.filter((token) => (token.actor?.type === "unit") && !token.actor.system.defeat?.out).map(unitOf);
}

const nameOf = (actor) => actor.token?.name ?? actor.name;

/* -------------------------------------------- */
/*  Range                                       */
/* -------------------------------------------- */

/**
 * Work out, for every unit with a token on a scene, which of its support partners are in range and which are
 * side by side, and save what changed. Bonds whose range is set by hand are left alone. Runs for the active
 * Game Master only, so that it happens once.
 * @param {Scene} scene
 * @returns {Promise<number>}   How many units were updated
 */
export async function refreshRanges(scene) {
  if ( !scene || !game.users.activeGM?.isSelf ) return 0;
  const units = unitsOn(scene);
  const done = new Set();
  let updated = 0;

  for ( const unit of units ) {
    if ( done.has(unit.uuid) ) continue;
    done.add(unit.uuid);
    const mine = units.filter((other) => other.uuid === unit.uuid);
    const bonds = foundry.utils.deepClone(unit.actor._source.system.bonds);
    let changed = false;

    for ( const bond of bonds ) {
      if ( !bond.auto ) continue;
      let nearest = null;
      for ( const partner of units ) {
        if ( (partner.uuid === unit.uuid) || !namesPartner(bond, partner) ) continue;
        for ( const own of mine ) {
          const distance = measureDistance(own.token, partner.token);
          if ( (distance !== null) && ((nearest === null) || (distance < nearest)) ) nearest = distance;
        }
      }
      const { inRange, adjacent } = rangeState(nearest);
      if ( (bond.inRange !== inRange) || (bond.adjacent !== adjacent) ) {
        bond.inRange = inRange;
        bond.adjacent = adjacent;
        changed = true;
      }
    }
    if ( changed ) {
      await unit.actor.update({ "system.bonds": bonds });
      updated++;
    }
  }
  return updated;
}

/* -------------------------------------------- */

const pending = new Map();

/**
 * Ask for a scene's support ranges to be worked out again shortly, so that a burst of token changes is
 * answered once.
 * @param {Scene} scene
 */
export function queueRanges(scene) {
  if ( !scene || !game.users.activeGM?.isSelf ) return;
  clearTimeout(pending.get(scene.id));
  pending.set(scene.id, setTimeout(() => {
    pending.delete(scene.id);
    refreshRanges(scene).catch((err) => console.error(err));
  }, 150));
}

/* -------------------------------------------- */

/**
 * Work out ranges again for the scenes a unit has a token on, after its bonds were edited.
 * @param {Actor} actor
 */
export function queueRangesFor(actor) {
  for ( const token of actor.getActiveTokens(false, true) ) queueRanges(token.parent);
}

/* -------------------------------------------- */
/*  Points                                      */
/* -------------------------------------------- */

/**
 * Add support points to some of a unit's bonds and raise their ranks as far as the points carry them.
 * @param {Actor} actor
 * @param {number[]} indexes      Which of the unit's bonds
 * @param {number} amount
 * @returns {Promise<{name: string, partner: string, amount: number, rank: string, points: number, rankUps: number,
 *   held: boolean}[]>}           What each bond gained
 */
export async function grantPoints(actor, indexes, amount) {
  if ( !(amount > 0) || !indexes.length ) return [];
  const bonds = foundry.utils.deepClone(actor._source.system.bonds);
  const top = topRank();
  const gains = [];
  for ( const index of new Set(indexes) ) {
    const bond = bonds[index];
    if ( !bond ) continue;
    const topRanks = bonds.filter((other, at) => (at !== index) && (other.rank === top)).length;
    const after = addPoints(bond, amount, { topRanks });
    bond.rank = after.rank;
    bond.points = after.points;
    gains.push({ name: nameOf(actor), partner: bond.name, amount, ...after });
  }
  if ( gains.length ) await actor.update({ "system.bonds": bonds });
  return gains;
}

/* -------------------------------------------- */

/**
 * Report support gains in one chat card. Gains that changed no rank are only listed when asked for.
 * @param {Actor} speaker
 * @param {Awaited<ReturnType<typeof grantPoints>>} gains
 * @param {object} [options]
 * @param {string} [options.reason]     A translation key for what the points were for
 * @param {boolean} [options.all]       List every gain, not only new ranks
 * @returns {Promise<void>}
 */
export async function reportGains(speaker, gains, { reason = null, all = false } = {}) {
  const shown = gains.filter((gain) => all || gain.rankUps || gain.held);
  if ( !shown.length ) return;
  const rows = shown.map((gain) => ({
    label: `${gain.name} · ${gain.partner || game.i18n.localize("FEO.Bond.unnamed")}`,
    value: gain.rankUps
      ? game.i18n.format("FEO.Support.rankUp", { rank: game.i18n.localize(FEO.supportRanks[gain.rank].label) })
      : gain.held
        ? game.i18n.localize("FEO.Support.held")
        : game.i18n.format("FEO.Support.gained", { amount: gain.amount, points: gain.points }),
    cls: gain.rankUps ? "good" : gain.held ? "muted" : ""
  }));
  await postCard(speaker, {
    title: game.i18n.localize("FEO.Support.title"),
    subtitle: reason ? game.i18n.localize(reason) : undefined,
    rows
  });
}

/* -------------------------------------------- */

/**
 * A battle begins: every pair of partners fielded in it together gains what the world's method gives for that.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function awardBattle(combat) {
  const amount = eventPoints("battle");
  if ( !amount ) return;
  const units = [];
  for ( const combatant of combat.combatants ) {
    if ( (combatant.actor?.type !== "unit") || !combatant.token ) continue;
    if ( !units.some((unit) => unit.uuid === combatant.actor.uuid) ) units.push(unitOf(combatant.token));
  }
  const gains = [];
  const byUnit = new Map();
  for ( const { unit, bond } of bondsWithin(units) ) byUnit.set(unit, [...(byUnit.get(unit) ?? []), bond]);
  for ( const [index, bonds] of byUnit ) gains.push(...await grantPoints(units[index].actor, bonds, amount));
  const speaker = units[0]?.actor;
  if ( speaker ) await reportGains(speaker, gains, { reason: "FEO.Support.event.battle" });
}

/* -------------------------------------------- */

/**
 * Something two partners did together earns them points, when the world counts points for it. Each of the
 * two units gains on its own record of the bond, where the user may change it.
 * @param {string} event              A key of FEO.supports.events
 * @param {TokenDocument} token       The unit that did it
 * @param {object} [options]
 * @param {number} [options.range]            Only partners within this many tiles count
 * @param {TokenDocument} [options.only]      Only this partner counts
 * @param {boolean} [options.mutual=true]     Do the partners gain on their records too?
 * @returns {Promise<void>}
 */
export async function awardEvent(event, token, { range = null, only = null, mutual = true } = {}) {
  const amount = eventPoints(event);
  if ( !amount || !token?.parent || (token.actor?.type !== "unit") ) return;
  const me = unitOf(token);
  const others = only ? [unitOf(only)] : unitsOn(token.parent).filter((unit) => unit.uuid !== me.uuid);
  const gains = [];

  for ( const partner of others ) {
    if ( partner.actor?.type !== "unit" ) continue;
    if ( range !== null ) {
      const distance = measureDistance(token, partner.token);
      if ( (distance === null) || (distance > range) ) continue;
    }
    const mine = me.bonds.map((bond, index) => namesPartner(bond, partner) ? index : -1).filter((index) => index >= 0);
    if ( mine.length && me.actor.isOwner ) gains.push(...await grantPoints(me.actor, mine, amount));
    if ( !mutual || !partner.actor.isOwner ) continue;
    const theirs = partner.bonds.map((bond, index) => namesPartner(bond, me) ? index : -1).filter((index) => index >= 0);
    if ( theirs.length ) gains.push(...await grantPoints(partner.actor, theirs, amount));
  }
  await reportGains(me.actor, gains, { reason: `FEO.Support.event.${event}` });
}

/* -------------------------------------------- */

/**
 * Record a new support with another unit, linked to its Actor.
 * @param {Actor} actor
 * @param {Actor} partner
 * @returns {Promise<boolean>}    False if the unit already has a bond with the partner
 */
export async function linkBond(actor, partner) {
  if ( (partner?.type !== "unit") || (partner === actor) ) return false;
  const bonds = foundry.utils.deepClone(actor._source.system.bonds);
  const uuid = partner.token?.baseActor?.uuid ?? partner.uuid;
  const unit = { uuid, uuids: [partner.uuid], names: [partner.name] };
  const existing = bonds.find((bond) => namesPartner(bond, unit));
  if ( existing ) {
    if ( existing.uuid ) return false;
    existing.uuid = uuid;
  }
  else bonds.push({
    name: partner.name, affinity: partner.system.affinity ?? "", rank: "E", points: 0,
    inRange: false, adjacent: false, auto: true, kin: false, uuid
  });
  await actor.update({ "system.bonds": bonds });
  queueRangesFor(actor);
  return true;
}

import { FEO } from "../config.mjs";
import { cooldownsFor } from "./affinity.mjs";
import { gainWexp } from "../rules/combat.mjs";
import { cooldownWith } from "../rules/choices.mjs";
import {
  IMITATED_FLAG, IMITATION_FLAG, givenBack, handFor, heldBack, imitateBar, imitatesOf, imitationBends, imitationGrant, imitationOver, keptGrant, ownWexp,
  readImitation, speaksOfImitation, takenFrom
} from "../rules/imitation.mjs";
import { effectsOf } from "../rules/skills.mjs";
import { buildChange, grantChange } from "../rules/timed.mjs";
import { pop } from "./events.mjs";
import { grantTimed, timedOf } from "./timed.mjs";
import { wieldCheck } from "./weapons.mjs";

/**
 * Imitation in Foundry (see `rules/imitation.mjs`): a unit takes on the attributes of the unit a skill of its
 * own is used on, and is itself again when the turns of that run out, when it reverts at will, and when the
 * battle ends.
 *
 * Nothing of the unit's own is written over. What it took on is kept on it as the flag `imitation` and laid
 * over its numbers as they are prepared (see `prepareBaseData` of the unit's data); the class and the skills
 * it took on are Items of its own that carry the flag `imitated`, and its own skills are set aside while that
 * note is there. The turns are counted by a change that lasts on it, named after the skill: once that change
 * is gone, however it went, the unit reverts. So reverting is taking the note and those Items away again, and
 * needs nothing of the unit that was imitated.
 *
 * What is written to the unit's own Documents meanwhile is only what is its own to have: its HP, the weapon in
 * its hand, the look of its token, which the note remembers, and the state of the skill it imitates with.
 */

/** What is told the hooks of other parts as Items are taken on and given up: none of them is a skill learnt. */
const QUIET = { [FEO.id]: { noPick: true, [IMITATED_FLAG]: true } };

/** The units that are being brought back to themselves right now, each with what is doing so. */
const reverting = new Map();

const nameOf = (actor, token = null) => token?.name || actor?.token?.name || actor?.name || "";

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * A unit's imitation, as it is noted on it.
 * @param {Actor|null} actor
 * @returns {object|null}     Null for a unit that is itself
 */
export function imitationOf(actor) {
  return readImitation(actor?.flags?.[FEO.id]?.[IMITATION_FLAG]);
}

/* -------------------------------------------- */

/**
 * Is an Item one a unit took on as it imitated another?
 * @param {Item|null} item
 * @returns {boolean}
 */
export function isImitated(item) {
  return !!item?.flags?.[FEO.id]?.[IMITATED_FLAG];
}

/* -------------------------------------------- */

/**
 * What a unit's own skills change about its imitation.
 * @param {Actor} actor
 * @returns {import("../rules/imitation.mjs").ImitationBends}
 */
export function imitationBendsOf(actor) {
  const skills = actor.items.filter((item) => (item.type === "skill") && item.system.equipped && (item.system.automate !== false) && !isImitated(item));
  return imitationBends(skills.map((item) => ({ name: item.name, effects: effectsOf(item.system) })));
}

/* -------------------------------------------- */

/**
 * Why a skill cannot have its unit imitate another, if it cannot: in words for the table.
 * @param {TokenDocument} token       The unit that would imitate
 * @param {object} imitates           The skill's `imitates` part
 * @param {TokenDocument} other       The unit it would imitate
 * @returns {{key: string, data: object}|null}
 */
export function imitationBar(token, imitates, other) {
  const ally = other?.actor;
  if ( ally?.type !== "unit" ) return { key: "FEO.Imitate.blocked.unit", data: {} };
  const name = nameOf(ally, other);
  if ( imitationOf(token?.actor) ) return { key: "FEO.Imitate.blocked.already", data: { name: imitationOf(token.actor).ally } };
  const bar = imitateBar(imitates, {
    race: ally.system.classItem?.system.race ?? "",
    shifts: ally.system.shift?.mode ?? null,
    qualities: ally.system.specialQualities ?? ""
  });
  if ( bar ) {
    const people = game.i18n.localize(FEO.races[bar.people]?.label ?? bar.people);
    return { key: "FEO.Imitate.blocked.people", data: { name, people } };
  }
  return null;
}

/* -------------------------------------------- */
/*  Imitating                                   */
/* -------------------------------------------- */

/**
 * The Items a unit takes on of another: its class, and every skill it has equipped but those that speak of
 * imitation. Each is a copy that is marked, and a skill starts afresh: ready, and switched off.
 * @param {Actor} ally
 * @returns {object[]}      Item data to create on the unit that imitates
 */
function itemsOf(ally) {
  const mark = (item) => {
    const data = item.toObject();
    delete data._id;
    const { builtIn, ...flags } = data.flags?.[FEO.id] ?? {};
    data.flags = { ...(data.flags ?? {}), [FEO.id]: { ...flags, [IMITATED_FLAG]: true } };
    return data;
  };
  const list = [];
  const cls = ally.system.classItem;
  if ( cls ) list.push(mark(cls));
  for ( const item of ally.items ) {
    if ( (item.type !== "skill") || !item.system.equipped || speaksOfImitation(item.system.effects) ) continue;
    const data = mark(item);
    data.system.equipped = true;
    data.system.state = { active: false, cooldown: 0, lasting: 0, used: 0, early: false, picked: {} };
    list.push(data);
  }
  return list;
}

/* -------------------------------------------- */

/**
 * Put the right weapon in a unit's hands once its weapon ranks have changed: one in hand that it may no longer
 * wield is put away, and it takes up the weapon it is told to prefer, or the first it carries that it may wield.
 * @param {Actor} actor
 * @param {string} [prefer]     The weapon to take up before any other
 * @returns {Promise<{equip: string|null, unequip: string[]}>}
 */
async function settleHand(actor, prefer = "") {
  const weapons = actor.items.filter((item) => item.type === "weapon").map((item) => ({
    id: item.id,
    equipped: !!item.system.equipped,
    wields: !item.system.broken && wieldCheck(actor, item).ok
  }));
  const hand = handFor(weapons, prefer);
  const updates = [
    ...hand.unequip.map((id) => ({ _id: id, "system.equipped": false })),
    ...(hand.equip ? [{ _id: hand.equip, "system.equipped": true }] : [])
  ];
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  return hand;
}

/* -------------------------------------------- */

/**
 * A unit takes on the attributes of another, as a skill of its own has it: that unit's stats, class, weapon
 * ranks, Special Qualities and skills, for as many turns as the skill says. Runs for whoever acts for the unit.
 * @param {TokenDocument} token       The unit that imitates
 * @param {Item} item                 The skill it imitates with
 * @param {object} imitates           The skill's `imitates` part
 * @param {TokenDocument} target      The unit it imitates
 * @returns {Promise<{label: string, value: string}[]|null>}      Rows for the card of the skill; null where
 *                                                                nothing was taken on
 */
export async function imitateUnit(token, item, imitates, target) {
  const actor = token?.actor;
  const ally = target?.actor;
  if ( (actor?.type !== "unit") || (ally?.type !== "unit") || (actor === ally) || !actor.isOwner ) return null;
  if ( imitationOf(actor) || imitationBar(token, imitates, target) ) return null;
  const i18n = game.i18n;
  const allyName = nameOf(ally, target);

  // What is taken on: of a unit that itself imitates another, what it has taken on
  const theirs = imitationOf(ally);
  const cls = ally.system.classItem;
  const taken = theirs
    ? foundry.utils.deepClone(theirs.taken)
    : takenFrom(ally._source.system, { className: cls?.name ?? ally._source.system.className });
  if ( cls ) taken.className = cls.name;

  // The class and the skills, as Items of the unit's own
  const made = await actor.createEmbeddedDocuments("Item", itemsOf(ally), QUIET);
  const classId = made.find((entry) => entry.type === "class")?.id ?? "";

  // The change that counts its turns, with what the unit is under and has meanwhile; the HP it has above the
  // maximum it takes on are set aside; and the look of its token, which is the other unit's for as long
  const bends = imitationBendsOf(actor);
  const change = buildChange(imitationGrant(imitates, bends, { skill: item.name }), { skill: item.name, own: true, carrierInTurn: true });
  const hp = heldBack(actor.system.hp.value, taken.hp.max);
  const texture = foundry.utils.deepClone(target._source?.texture ?? null);
  const note = {
    skill: item.id,
    name: item.name,
    of: ally.uuid,
    ally: allyName,
    change: change.name,
    taken,
    classId,
    hand: actor.system.equippedWeapon?.id ?? "",
    held: hp.held,
    tokens: (texture && token.parent && token.id) ? [{ scene: token.parent.id, id: token.id, texture: foundry.utils.deepClone(token._source.texture) }] : []
  };
  try {
    const { list } = grantChange(timedOf(actor), change);
    await actor.update({
      [`flags.${FEO.id}.${IMITATION_FLAG}`]: note,
      "system.timed": list,
      ...(hp.held ? { "system.hp.value": hp.value } : {})
    }, { [FEO.id]: { quietHp: true } });
  } catch(err) {
    // Nothing was taken on: what was made for it goes again
    console.error(err);
    const ids = made.map((entry) => entry.id).filter((id) => actor.items.has(id));
    if ( ids.length ) await actor.deleteEmbeddedDocuments("Item", ids, QUIET);
    return null;
  }

  // From here on the unit imitates: what follows is only how it looks and what it holds
  try {
    if ( note.tokens.length ) await token.update({ texture });
  } catch(err) {
    console.error(err);
  }
  let hand = { equip: null, unequip: [] };
  try {
    hand = await settleHand(actor);
  } catch(err) {
    console.error(err);
  }
  pop(actor, [{ text: i18n.format("FEO.Imitate.float", { name: allyName }), tone: "skill" }]);
  Hooks.callAll(`${FEO.id}.unitImitates`, token, target, { skill: item.name });

  const rows = [{ label: nameOf(actor, token), value: i18n.format("FEO.Imitate.row", { name: allyName, turns: change.turns }) }];
  const put = hand.unequip.map((id) => actor.items.get(id)?.name).filter(Boolean);
  if ( put.length ) {
    const taken = hand.equip ? (actor.items.get(hand.equip)?.name ?? "") : "";
    rows.push({ label: put.join(", "), value: taken ? i18n.format("FEO.Imitate.swapped", { weapon: taken }) : i18n.localize("FEO.Imitate.putAway") });
  }
  return rows;
}

/* -------------------------------------------- */
/*  Reverting                                   */
/* -------------------------------------------- */

/**
 * A unit that imitates another is itself again: what it took on goes, its own skills are its own again, its
 * token has its own look, the HP that were set aside are back as far as its own maximum goes, and the
 * cooldown of the skill it imitated with starts. What its skills keep of the imitation for a while is granted.
 * Runs for whoever may change the unit; safe to call for a unit that is itself.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.quiet]     Say nothing over its token, as when a battle is cleared away
 * @returns {Promise<boolean>}          Whether it reverted
 */
export async function revertUnit(actor, { quiet = false } = {}) {
  if ( (actor?.type !== "unit") || !actor.isOwner ) return false;

  // Asked twice at once, as by the turn that ran out and by what listens for it, it reverts once: whoever asks
  // second waits for that
  const going = reverting.get(actor.uuid);
  if ( going ) return going;
  if ( !imitationOf(actor) ) return false;
  const done = revert(actor, { quiet }).finally(() => reverting.delete(actor.uuid));
  reverting.set(actor.uuid, done);
  return done;
}

/* -------------------------------------------- */

/**
 * Bring a unit that imitates another back to itself (see `revertUnit`).
 * @param {Actor} actor
 * @param {object} options
 * @param {boolean} options.quiet
 * @returns {Promise<boolean>}
 */
async function revert(actor, { quiet }) {
  const note = imitationOf(actor);
  if ( !note ) return false;
  try {
    const before = { ...actor.system.statValues };
    const bends = imitationBendsOf(actor);

    // Where the change that counted its turns has already gone, what it added to its stats went with it: that
    // is counted as it stood, since it was gained through imitating too
    if ( imitationOver(note, actor._source?.system?.timed) ) {
      for ( const effect of bends.effects ) {
        if ( effect.when ) continue;
        for ( const [key, amount] of Object.entries(effect.stats ?? {}) ) if ( Number.isFinite(amount) ) before[key] = (before[key] ?? 0) + amount;
      }
    }

    // The note goes, with the change that counted its turns: from here on the unit is itself
    const kept = timedOf(actor).filter((change) => !((change.name === note.change) && !change.from));
    await actor.update({ [`flags.${FEO.id}.-=${IMITATION_FLAG}`]: null, "system.timed": kept });

    // What it took on goes with it
    const ids = actor.items.filter(isImitated).map((item) => item.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("Item", ids, QUIET);

    // The HP that were set aside as it took on a lower maximum
    const hp = givenBack(actor.system.hp.value, note.held, actor.system.hp.max);
    if ( hp !== actor.system.hp.value ) await actor.update({ "system.hp.value": hp }, { [FEO.id]: { quietHp: true } });

    // Its token looks like itself again, wherever it was when it began to imitate
    for ( const entry of note.tokens ) {
      try {
        const token = game.scenes?.get(entry.scene)?.tokens.get(entry.id);
        if ( token && entry.texture ) await token.update({ texture: entry.texture });
      } catch(err) {
        console.error(err);
      }
    }

    // What it held before is in its hand again, where what it holds is not its own to wield
    try {
      await settleHand(actor, note.hand);
    } catch(err) {
      console.error(err);
    }

    // The skill it imitated with is switched off, and its cooldown starts now
    const item = actor.items.get(note.skill);
    const usage = item?.system.usage;
    if ( usage?.kind ) {
      const cooldown = (usage.cooldown > 0) ? cooldownWith(usage.cooldown, cooldownsFor(actor, item)) + FEO.skillUse.cooldownExtra : 0;
      await item.update({ "system.state": { ...item.system.state, active: false, lasting: 0, cooldown } });
    }

    // And what its skills have it keep for a while of what imitating had added to its stats
    const grant = keptGrant(bends.keeps, before, actor.system.statValues);
    if ( grant ) await grantTimed(actor, [buildChange(grant, { skill: grant.name, own: true, carrierInTurn: true })]);
    if ( !quiet ) pop(actor, [{ text: game.i18n.localize("FEO.Imitate.reverts"), tone: "skill" }]);
    Hooks.callAll(`${FEO.id}.unitReverts`, actor, { ally: note.ally, skill: note.name });
    return true;
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * A unit whose imitation has run out is itself again: one that no longer carries the change that counted its
 * turns, whether those ran out, the change was taken off by hand, or a battle cleared it away.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Whether it reverted
 */
export async function settleImitation(actor) {
  const note = imitationOf(actor);
  if ( !note || !imitationOver(note, actor._source?.system?.timed) ) return false;
  return revertUnit(actor);
}

/* -------------------------------------------- */

/**
 * A battle begins or ends: every unit in it that imitates another is itself again. Runs for a Game Master.
 * @param {Combat} combat
 * @returns {Promise<number>}     How many reverted
 */
export async function endImitations(combat) {
  const seen = new Set();
  let count = 0;
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor) || !actor.isOwner ) continue;
    seen.add(actor);
    if ( imitationOf(actor) && await revertUnit(actor, { quiet: true }) ) count += 1;
  }
  return count;
}

/* -------------------------------------------- */

/**
 * A world opens: a unit whose imitation ran out while nobody was there to see to it is itself again, and
 * Items that were taken on by a unit that imitates no longer are deleted. One that still imitates is left as
 * it is: its note, its Items and its turns are all saved with it. Runs for the designated Game Master.
 * @returns {Promise<void>}
 */
export async function sweepImitations() {
  const units = new Set(game.actors.filter((actor) => actor.type === "unit"));
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) if ( !token.actorLink && (token.actor?.type === "unit") ) units.add(token.actor);
  }
  for ( const actor of units ) {
    try {
      if ( imitationOf(actor) ) {
        await settleImitation(actor);
        continue;
      }
      const left = actor.items.filter(isImitated).map((item) => item.id);
      if ( left.length ) await actor.deleteEmbeddedDocuments("Item", left, QUIET);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */
/*  What Stays the Unit's Own                   */
/* -------------------------------------------- */

/**
 * The weapon experience a fight gave a unit that imitates, as it is saved: the fight counted it towards the
 * ranks the unit took on, which are not written to it. What was earned goes to its own proficiency of the
 * same kind, where it has a rank in it.
 * @param {Actor} actor
 * @param {Record<string, {rank: string, wexp: number}>} [counted]     Each proficiency as the fight left it
 * @returns {Record<string, {rank: string, wexp: number}>|null}        Its own proficiencies to save in their
 *          place; null for a unit that is itself, whose proficiencies are saved as the fight left them
 */
export function ownProficiencies(actor, counted) {
  if ( !imitationOf(actor) ) return null;
  const mine = actor._source.system.proficiencies ?? {};
  const theirs = actor.system.proficiencies ?? {};
  const gains = [];
  for ( const [key, after] of Object.entries(counted ?? {}) ) {
    const before = theirs[key];
    if ( !before || !(after?.rank in FEO.ranks) || !Number.isFinite(after.wexp) ) continue;

    // What was earned is what the rank it took on gained, counted through any rank that was passed
    const order = Object.keys(FEO.ranks);
    let amount = after.wexp - (before.wexp ?? 0);
    for ( let index = order.indexOf(before.rank); (index >= 0) && (index < order.indexOf(after.rank)); index++ ) {
      amount += FEO.wexpToNext[order[index]] ?? 0;
    }
    if ( amount > 0 ) gains.push({ key, amount });
  }
  return ownWexp(gains, mine, (proficiency, amount) => gainWexp(proficiency, amount));
}

/* -------------------------------------------- */

/**
 * Why a unit does not level up, change class or promote right now, if it does not: one that imitates another
 * does so once it is itself again, since its stats and its class are not its own meanwhile.
 * @param {Actor} actor
 * @returns {string|null}     What to tell the table; null for a unit that may
 */
export function growthBar(actor) {
  const note = imitationOf(actor);
  return note ? game.i18n.format("FEO.Imitate.blocked.growth", { name: nameOf(actor), ally: note.ally }) : null;
}

/* -------------------------------------------- */

/**
 * Take from what a sheet is about to save everything that a unit which imitates another has taken on: the
 * sheet shows it, and none of it is the unit's own to save.
 * @param {Actor} actor
 * @param {object} data       What the sheet submits, as nested data
 * @returns {object}          The same data
 */
export function withoutTaken(actor, data) {
  if ( !imitationOf(actor) || !data?.system ) return data;
  const system = data.system;
  for ( const key of ["stats", "abilities", "combatBoosts", "calc", "proficiencies", "specialQualities", "className", "classId", "boon", "bane", "fcm", "movementStars", "weaponLevel", "wt"] ) {
    delete system[key];
  }
  if ( system.hp ) {
    delete system.hp.max;
    delete system.hp.cap;
  }
  return data;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what imitation listens for. Called once, when the system starts.
 */
export function registerHooks() {
  // A unit that no longer carries the change that counts the turns of its imitation is itself again: whoever
  // took the change off sees to it
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( (userId !== game.user.id) || (actor.type !== "unit") || !foundry.utils.hasProperty(changed, "system.timed") ) return;
    if ( imitationOf(actor) ) settleImitation(actor).catch((err) => console.error(err));
  });

  // The skill a unit imitates with is taken off it: it is itself again
  Hooks.on("deleteItem", (item, options, userId) => {
    if ( (userId !== game.user.id) || (item.type !== "skill") ) return;
    const actor = item.actor;
    if ( (actor?.type === "unit") && (imitationOf(actor)?.skill === item.id) ) revertUnit(actor).catch((err) => console.error(err));
  });

  Hooks.once("ready", () => {
    if ( game.users.activeGM?.isSelf ) sweepImitations().catch((err) => console.error(err));
  });
}

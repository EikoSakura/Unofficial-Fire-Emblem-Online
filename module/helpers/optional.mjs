import { FEO } from "../config.mjs";
import {
  activates, adjustLives, bloodRanks, buyPower, crestOf, felled, gloryEarned, leaderReaches, livesState, loseLife,
  promotionLives, refundPower, reviveLives, starChance
} from "../rules/optional.mjs";
import { buildChanceCard, buildLifeCard } from "../sheets/optional-context.mjs";
import { postCard, rollD100 } from "./chat.mjs";
import { isTracked } from "./conditions.mjs";
import { armyOf, measureDistance } from "./exchange.mjs";

/**
 * The Optional Modules on units in Foundry: lives, the chances rolled from the sheet, the ranks Holy Blood
 * gives, the reach of an Authority's Leadership Stars and the kills made with a weapon. Each does nothing
 * while the world setting for its module is off.
 */

const nameOf = (actor) => actor.token?.name ?? actor.name;

/* -------------------------------------------- */
/*  Additional Lives                            */
/* -------------------------------------------- */

/**
 * The lives a unit has.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    The unit's token, if it has one
 * @returns {import("../rules/optional.mjs").LivesState}
 */
export function livesOf(actor, token = null) {
  const army = armyOf(actor, token ?? actor.token ?? null);
  return livesState(actor.system.lives, { applies: FEO.optional.lives.armies.includes(army) });
}

/* -------------------------------------------- */

/**
 * What it takes for a unit that would die to lose a life instead. Nothing is saved here.
 * @param {Actor} actor
 * @returns {{update: object, left: number, limit: number, dead: boolean}|null}   Null for a unit with no
 *          life to lose
 */
export function spendLife(actor) {
  const state = livesOf(actor);
  const lost = loseLife(state);
  if ( !lost ) return null;
  return { update: { "system.lives.value": lost.left }, left: lost.left, limit: state.limit, dead: lost.dead };
}

/* -------------------------------------------- */

/**
 * Post the card for a life lost, the last life lost, or a unit that returns with one.
 * @param {Actor} actor
 * @param {"lost"|"last"|"revived"} event
 * @param {{left: number, limit: number}} lives
 * @returns {Promise<ChatMessage>}
 */
export function postLifeCard(actor, event, { left, limit }) {
  return postCard(actor, buildLifeCard(event, { name: nameOf(actor), left, limit }, game.i18n));
}

/* -------------------------------------------- */

/**
 * What a unit brought back from death changes about its lives: it returns with one.
 * @param {Actor} actor
 * @returns {{update: object, left: number, limit: number}|null}    Null when its lives stay as they are
 */
export function reviveLife(actor) {
  const state = livesOf(actor);
  const left = reviveLives(state);
  return left === null ? null : { update: { "system.lives.value": left }, left, limit: state.limit };
}

/* -------------------------------------------- */

/**
 * What promoting changes about a unit's lives: one more in total, and one restored.
 * @param {Actor} actor
 * @returns {object}    Update paths; empty for a unit without lives
 */
export function promotionLifeUpdate(actor) {
  const gained = promotionLives(livesOf(actor));
  return gained ? { "system.lives.max": gained.max, "system.lives.value": gained.value } : {};
}

/* -------------------------------------------- */

/**
 * Take a life from a unit or give one back by hand, within its total. This settles nothing else about the
 * unit: whether it leaves the battle or dies is decided where it is defeated.
 * @param {Actor} actor
 * @param {number} delta
 * @param {TokenDocument|null} [token]
 * @returns {Promise<number|null>}    The lives left, or null when nothing changed
 */
export async function adjustLivesFor(actor, delta, token = null) {
  const state = livesOf(actor, token);
  if ( !state.used ) return null;
  const left = adjustLives(state, delta);
  if ( left === state.left ) return null;
  await actor.update({ "system.lives.value": left });
  return left;
}

/* -------------------------------------------- */
/*  Rolls                                       */
/* -------------------------------------------- */

/**
 * Roll a unit's Movement Stars after it has acted: on a success it may act again.
 * @param {Actor} actor
 * @returns {Promise<boolean|null>}   Whether it may act again; null for a unit without stars
 */
export async function rollMovementStars(actor) {
  const config = FEO.optional.movementStars;
  const stars = actor.system.starsTotal ?? actor.system.movementStars ?? 0;
  const chance = starChance(stars);
  if ( !config.enabled || !chance ) return null;
  const { roll, results: [die] } = await rollD100(1);
  const success = activates(die, chance);
  await postCard(actor, buildChanceCard({
    title: game.i18n.localize("FEO.Optional.stars.title"),
    subtitle: game.i18n.format("FEO.Optional.stars.subtitle", { stars: Math.min(stars, config.max), chance }),
    roll: die,
    chance,
    success,
    yes: game.i18n.localize("FEO.Optional.stars.again"),
    no: game.i18n.localize("FEO.Optional.stars.done"),
    note: success ? game.i18n.localize("FEO.Optional.stars.againNote") : undefined
  }, game.i18n), { rolls: [roll] });
  return success;
}

/* -------------------------------------------- */

/**
 * Roll for a unit's Crest to activate. What it does is on the card for the table to apply.
 * @param {Actor} actor
 * @returns {Promise<boolean|null>}   Whether it activated; null for a unit without a Crest
 */
export async function rollCrest(actor) {
  const config = FEO.optional.crests;
  const crest = config.enabled ? crestOf(actor.system.crest) : null;
  if ( !crest ) return null;
  const { roll, results: [die] } = await rollD100(1);
  const success = activates(die, crest.chance);
  const name = crest.custom
    ? (crest.name || game.i18n.localize("FEO.Optional.crest.custom"))
    : game.i18n.localize(`FEO.Optional.crest.names.${crest.id}`);
  const effect = crest.custom ? crest.effect : game.i18n.localize(`FEO.Optional.crest.effects.${crest.id}`);
  await postCard(actor, buildChanceCard({
    title: name,
    subtitle: game.i18n.format("FEO.Optional.crest.subtitle", {
      grade: game.i18n.localize(config.grades[crest.grade]),
      chance: crest.chance
    }),
    roll: die,
    chance: crest.chance,
    success,
    yes: game.i18n.localize("FEO.Optional.crest.active"),
    no: game.i18n.localize("FEO.Optional.crest.inactive"),
    note: effect ? `${crest.chance}% ${effect}` : undefined
  }, game.i18n), { rolls: [roll] });
  return success;
}

/* -------------------------------------------- */
/*  Holy Blood                                  */
/* -------------------------------------------- */

/**
 * Before a unit's Holy Blood changes, add to the same update the ranks the change gives or takes back.
 * @param {Actor|null} actor
 * @param {object} changes      The changes about to be saved, which this adds to
 */
export function planBloodRanks(actor, changes) {
  if ( !FEO.optional.holyBlood.enabled || (actor?.type !== "unit") ) return;
  const incoming = changes?.system?.holyBlood?.lineages;
  if ( !incoming ) return;
  const system = actor.system;
  const lineages = { ...system.holyBlood.lineages, ...incoming };
  const ranks = Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => {
    return [key, changes.system.proficiencies?.[key]?.rank ?? system.proficiencies[key].rank];
  }));
  const records = Object.fromEntries(Object.entries(system.holyBlood.ranks).map(([key, { steps, from }]) => {
    return [key, { steps, from }];
  }));
  const plan = bloodRanks(ranks, records, lineages);
  for ( const [key, rank] of Object.entries(plan.ranks) ) {
    foundry.utils.setProperty(changes, `system.proficiencies.${key}.rank`, rank);
  }
  for ( const [key, record] of Object.entries(plan.records) ) {
    foundry.utils.setProperty(changes, `system.holyBlood.ranks.${key}`, record);
  }
}

/* -------------------------------------------- */
/*  Authority & Leadership                      */
/* -------------------------------------------- */

/**
 * The units that could be a unit's Authority: those with Leadership Stars, tokens on the scene in view first.
 * The unit's current Authority is always among them.
 * @param {Actor} actor
 * @returns {{uuid: string, name: string}[]}
 */
export function leaderChoices(actor) {
  if ( !FEO.optional.leadership.enabled ) return [];
  const seen = new Set([actor.uuid]);
  const leaders = [];
  const add = (candidate, name) => {
    if ( !candidate || (candidate.type !== "unit") || seen.has(candidate.uuid) ) return;
    if ( !(candidate.system.leadership?.stars > 0) && (candidate.uuid !== actor.system.leadership?.authority) ) return;
    seen.add(candidate.uuid);
    leaders.push({ uuid: candidate.uuid, name: `${name} (${"★".repeat(Math.min(candidate.system.leadership?.stars ?? 0, 9))})` });
  };
  for ( const token of canvas?.scene?.tokens ?? [] ) add(token.actor, token.name);
  for ( const candidate of game.actors ?? [] ) add(candidate, candidate.name);

  // An Authority that is not here to be found is kept, so that saving the sheet does not forget it
  const authority = actor.system.leadership?.authority;
  if ( authority && !seen.has(authority) ) {
    leaders.push({ uuid: authority, name: game.i18n.localize("FEO.Optional.leadership.elsewhere") });
  }
  return leaders;
}

/* -------------------------------------------- */

/**
 * What the sheet hands to its display data for the Optional Modules.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]
 * @returns {{army: string, leaders: {uuid: string, name: string}[]}}
 */
export function sheetOptions(actor, token = null) {
  return { army: armyOf(actor, token ?? actor.token ?? null), leaders: leaderChoices(actor) };
}

/* -------------------------------------------- */

/**
 * Work out, for every unit on a scene that names an Authority, how many of its Authority's Leadership Stars
 * reach it, and save what changed. An Authority that is not on the scene, or is out of the fight, lends none.
 * Units without a linked Authority are left alone, so that a number typed by hand stays. Runs for the active
 * Game Master only, so that it happens once.
 * @param {Scene} scene
 * @returns {Promise<number>}   How many units were updated
 */
export async function refreshLeadership(scene) {
  if ( !FEO.optional.leadership.enabled || !scene || !game.users.activeGM?.isSelf ) return 0;
  const tokens = Array.from(scene.tokens ?? []).filter((token) => token.actor?.type === "unit");
  const done = new Set();
  let updated = 0;
  for ( const token of tokens ) {
    const actor = token.actor;
    const authority = actor.system.leadership?.authority;
    if ( !authority || done.has(actor.uuid) ) continue;
    done.add(actor.uuid);
    let stars = 0;
    for ( const follower of tokens.filter((other) => other.actor.uuid === actor.uuid) ) {
      for ( const leader of tokens ) {
        if ( (leader.actor.uuid !== authority) || (leader.actor.uuid === actor.uuid) ) continue;
        if ( leader.actor.system.defeat?.out ) continue;
        if ( !leaderReaches(measureDistance(follower, leader)) ) continue;
        stars = Math.max(stars, leader.actor.system.leadership?.stars ?? 0);
      }
    }
    if ( stars !== actor.system.leadership.received ) {
      await actor.update({ "system.leadership.received": stars });
      updated++;
    }
  }
  return updated;
}

/* -------------------------------------------- */

const pending = new Map();

/**
 * Ask for a scene's Authorities to be worked out again shortly, so that a burst of changes is answered once.
 * @param {Scene|null} scene
 */
export function queueLeadership(scene) {
  if ( !FEO.optional.leadership.enabled || !scene || !game.users.activeGM?.isSelf ) return;
  clearTimeout(pending.get(scene.id));
  pending.set(scene.id, setTimeout(() => {
    pending.delete(scene.id);
    refreshLeadership(scene).catch((err) => console.error(err));
  }, 150));
}

/* -------------------------------------------- */
/*  Weapon Kill Critical Bonus                  */
/* -------------------------------------------- */

/**
 * Note what two units are before they fight, so that the kills of the fight can be counted afterwards.
 * @param {...(Actor|null)} actors
 * @returns {{actor: Actor, hp: number, weaponId: string|null}[]}
 */
export function beforeFight(...actors) {
  if ( !FEO.optional.weaponKills.enabled && !FEO.optional.glory.enabled ) return [];
  return actors.filter((actor) => actor?.type === "unit").map((actor) => ({
    actor,
    hp: actor.system.hp.value,
    weaponId: actor.system.equippedWeapon?.id ?? null
  }));
}

/* -------------------------------------------- */

/**
 * After a fight between two units, add a kill to the weapon of each one that brought the other down. Weapons
 * on units this user may not change are left for the Game Master to count.
 * @param {{actor: Actor, hp: number, weaponId: string|null}[]} before    As `beforeFight` noted them
 * @returns {Promise<Item[]>}     The weapons that gained a kill
 */
export async function countKills(before) {
  const counted = [];
  if ( !FEO.optional.weaponKills.enabled || (before.length !== 2) ) return counted;
  for ( const [index, side] of before.entries() ) {
    const foe = before[1 - index];
    if ( !felled(foe.hp, foe.actor.system.hp.value) ) continue;
    const weapon = side.weaponId ? side.actor.items.get(side.weaponId) : null;
    if ( (weapon?.type !== "weapon") || !side.actor.isOwner ) continue;
    await weapon.update({ "system.kills": (weapon.system.kills ?? 0) + 1 });
    counted.push(weapon);
  }
  return counted;
}

/* -------------------------------------------- */
/*  Glory                                       */
/* -------------------------------------------- */

/**
 * After a fight between two units, give each one that brought the other down the Glory the other had to give.
 * Glory for a unit this user may not change is announced, for the Game Master to add.
 * @param {{actor: Actor, hp: number}[]} before     As `beforeFight` noted them
 * @returns {Promise<{actor: Actor, amount: number}[]>}     Who earned how much
 */
export async function awardGlory(before) {
  const earned = [];
  if ( !FEO.optional.glory.enabled || (before.length !== 2) ) return earned;
  for ( const [index, side] of before.entries() ) {
    const foe = before[1 - index];
    const amount = gloryEarned(foe.hp, foe.actor.system.hp.value, foe.actor.system.glory?.bounty);
    if ( !amount ) continue;
    const total = (side.actor.system.glory?.value ?? 0) + amount;
    const saved = side.actor.isOwner;
    if ( saved ) await side.actor.update({ "system.glory.value": total });
    await postCard(side.actor, {
      title: game.i18n.format("FEO.Optional.glory.card.earned", { name: nameOf(side.actor), amount }),
      subtitle: game.i18n.format("FEO.Optional.glory.card.from", { name: nameOf(foe.actor) }),
      outcome: { label: game.i18n.format("FEO.Optional.glory.card.total", { total }), cls: "good" },
      note: saved ? undefined : game.i18n.localize("FEO.Optional.glory.card.unsaved")
    });
    earned.push({ actor: side.actor, amount });
  }
  return earned;
}

/* -------------------------------------------- */

/**
 * Unlock a Power with a unit's Glory. Powers are unlocked during downtime: a unit in a battle that is under
 * way unlocks none, unless the Game Master says so.
 * @param {Actor} actor
 * @param {string} id
 * @returns {Promise<boolean>}    Was it unlocked?
 */
export async function buyPowerFor(actor, id) {
  if ( !FEO.optional.glory.enabled ) return false;
  if ( isTracked(actor) && !game.user.isGM ) {
    ui.notifications.warn("FEO.Optional.glory.warn.downtime", { localize: true });
    return false;
  }
  const glory = actor._source.system.glory;
  const next = buyPower(glory, id);
  if ( !next ) {
    ui.notifications.warn("FEO.Optional.glory.warn.cannot", { localize: true });
    return false;
  }
  await actor.update({ "system.glory.value": next.value, "system.glory.powers": next.powers });
  const name = game.i18n.localize(`FEO.Optional.glory.powers.${id}.name`);
  await postCard(actor, {
    title: game.i18n.format("FEO.Optional.glory.card.unlocked", { name: nameOf(actor), power: name }),
    subtitle: game.i18n.format("FEO.Optional.glory.card.cost", { cost: glory.value - next.value, left: next.value }),
    note: game.i18n.localize(`FEO.Optional.glory.powers.${id}.text`)
  });
  return true;
}

/* -------------------------------------------- */

/**
 * Give up a Power and have its Glory back. Only a Game Master may, as Powers are permanent.
 * @param {Actor} actor
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function refundPowerFor(actor, id) {
  if ( !game.user.isGM ) return false;
  const next = refundPower(actor._source.system.glory, id);
  if ( !next ) return false;
  await actor.update({ "system.glory.value": next.value, "system.glory.powers": next.powers });
  return true;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what the Optional Modules listen for. Called once, when the system starts.
 */
export function registerHooks() {
  if ( FEO.optional.holyBlood.enabled ) {
    Hooks.on("preUpdateActor", (actor, changes) => planBloodRanks(actor, changes));
    Hooks.on("preUpdateActorDelta", (delta, changes) => planBloodRanks(delta.syntheticActor, changes));
  }

  if ( FEO.optional.leadership.enabled ) {
    const moved = ["x", "y", "width", "height", "elevation"];
    Hooks.on("updateToken", (token, changes) => {
      if ( moved.some((key) => key in changes) ) queueLeadership(token.parent);
    });
    Hooks.on("createToken", (token) => queueLeadership(token.parent));
    Hooks.on("deleteToken", (token) => queueLeadership(token.parent));
    Hooks.on("canvasReady", () => queueLeadership(canvas.scene));

    // A change of stars or of Authority, or a leader leaving the fight, moves what reaches whom
    Hooks.on("updateActor", (actor, changed) => {
      if ( (actor.type !== "unit") || !(changed.system?.leadership || changed.system?.defeat) ) return;
      if ( changed.system?.leadership && Object.keys(changed.system.leadership).every((key) => key === "received") ) return;

      // A unit that no longer names an Authority no longer has its stars
      const unlinked = (changed.system?.leadership?.authority === "") && (actor.system.leadership.received > 0);
      if ( unlinked && game.users.activeGM?.isSelf ) actor.update({ "system.leadership.received": 0 });
      for ( const token of actor.getActiveTokens(false, true) ) queueLeadership(token.parent);
    });
  }
}

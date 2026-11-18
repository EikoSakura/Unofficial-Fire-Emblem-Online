import { FEO } from "../config.mjs";
import { parseRange, reaches } from "../rules/combat.mjs";
import { LENT_PICK, lendOffers, lentArms, lentAt, lentBare, lentRange } from "../rules/lending.mjs";
import { skillLends } from "../rules/skills.mjs";
import { rangesWith, selfWith } from "./movement.mjs";

/**
 * Weapons a skill lends its unit, in Foundry (see `rules/lending.mjs` for the rules): what a unit is lent as
 * it stands, which of them it has taken up to attack with, and the picture each is shown with. A lent weapon
 * is no Item: the unit remembers the one it took up, by a flag, until it has attacked with it, acted, or taken
 * a weapon of its own in hand.
 *
 * @import {LendOffer} from "../rules/lending.mjs"
 */

/** The flag a unit keeps the lent weapon it took up under. */
const FLAG = "lent";

/**
 * The weapon in a unit's hand, as what is lent to the hand asks about it.
 * @param {Actor} actor
 * @returns {{id: string, name: string, category: string, uses: {value: number, max: number}, wexp: number, broken: boolean}|null}
 */
function heldOf(actor) {
  const item = actor.system.equippedWeapon;
  if ( !item ) return null;
  return {
    id: item.id,
    name: item.name,
    category: item.system.category,
    uses: { value: item.system.uses.value, max: item.system.uses.max },
    wexp: item.system.wexp,
    broken: !!item.system.broken
  };
}

/* -------------------------------------------- */

/**
 * Does any of a unit's skills lend it a weapon at all? Asked first, since most units have none that does.
 * @param {Actor} actor
 * @returns {boolean}
 */
function lends(actor) {
  return (actor?.system?.skills?.entries ?? []).some((skill) => (skill.effects ?? []).some((effect) => effect?.lend));
}

/* -------------------------------------------- */

/**
 * What a unit's skills lend it as it stands: one offer for each weapon.
 * @param {Actor} actor
 * @returns {LendOffer[]}
 */
export function offersOf(actor) {
  if ( !lends(actor) ) return [];
  const found = skillLends(actor.system.skills.entries, selfWith(actor, null));
  return lendOffers(found, { proficiencies: actor.system.proficiencies, held: heldOf(actor) });
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit has taken up to attack with, if it still may: by the name its offer goes by.
 * @param {Actor} actor
 * @param {LendOffer[]} [offers]      What it is lent, where that is already known
 * @returns {string|null}
 */
export function takenUp(actor, offers = null) {
  const key = actor?.getFlag?.(FEO.id, FLAG)?.key;
  if ( (typeof key !== "string") || !key ) return null;
  return (offers ?? offersOf(actor)).some((offer) => (offer.key === key) && offer.ready && !offer.auto && !offer.cast) ? key : null;
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit has in hand for the fight it is in the middle of, whether or not its skill could be
 * spent again: for a further attack that fight has it make, once the fight itself has spent the skill.
 * @param {Actor} actor
 * @param {LendOffer[]} [offers]      What it is lent, where that is already known
 * @returns {LendOffer|null}
 */
export function stillHeld(actor, offers = null) {
  const key = actor?.getFlag?.(FEO.id, FLAG)?.key;
  if ( (typeof key !== "string") || !key ) return null;
  return (offers ?? offersOf(actor)).find((offer) => (offer.key === key) && !offer.auto && !offer.cast) ?? null;
}

/* -------------------------------------------- */

/**
 * Take up a lent weapon to attack with, or put it down again.
 * @param {Actor} actor
 * @param {string|null} key       The offer, or null to go back to the weapon in hand
 * @returns {Promise<void>}
 */
export async function takeUp(actor, key) {
  if ( !actor?.isOwner ) return;
  if ( key ) await actor.setFlag(FEO.id, FLAG, { key });
  else if ( actor.getFlag(FEO.id, FLAG) ) await actor.unsetFlag(FEO.id, FLAG);
}

/* -------------------------------------------- */

/**
 * Does the weapon in a unit's hand attack at a distance, with what its skills make of its Range?
 * @param {Actor} actor
 * @param {number} distance
 * @param {import("../rules/movement.mjs").Movement|null} [move]
 * @returns {boolean}
 */
function handReaches(actor, distance, move = null) {
  const item = actor.system.equippedWeapon;
  if ( !item || item.system.broken || (item.system.category === "staff") ) return false;
  if ( (item.system.uses?.max > 0) && !(item.system.uses.value > 0) ) return false;
  return reaches(item.system, distance, actor.system.statValues, rangesWith(actor, move));
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit attacks with from a distance, if any: the one it took up, or one that is used by
 * itself where the weapon in its hand does not reach.
 * @param {Actor} actor
 * @param {number} distance
 * @param {object} [options]
 * @param {LendOffer[]} [options.offers]      What it is lent, where that is already known
 * @param {import("../rules/movement.mjs").Movement|null} [options.move]
 * @returns {LendOffer|null}
 */
export function lentFor(actor, distance, { offers = null, move = null } = {}) {
  const list = offers ?? offersOf(actor);
  if ( !list.length ) return null;
  const picked = takenUp(actor, list);
  return lentAt(list, { picked, distance, reaches: picked ? false : handReaches(actor, distance, move) });
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit fights with by itself because it has no weapon in its hand, if its skills lend it one
 * for that (see `bare` in `rules/lending.mjs`).
 * @param {Actor} actor
 * @param {LendOffer[]} [offers]      What it is lent, where that is already known
 * @returns {LendOffer|null}
 */
export function bareFor(actor, offers = null) {
  if ( !offers && !lends(actor) ) return null;
  return lentBare(offers ?? offersOf(actor), !!actor.system.equippedWeapon);
}

/* -------------------------------------------- */

/**
 * How far a unit attacks with what it is lent, for the map: null where nothing is lent that changes it.
 * @param {Actor} actor
 * @param {{min: number, max: number}|null} own       How far the weapon in its hand reaches
 * @returns {{min: number, max: number, lent: boolean}|null}
 */
export function lentRangeOf(actor, own) {
  const offers = offersOf(actor);
  if ( !offers.length ) return null;
  return lentRange(offers, { picked: takenUp(actor, offers), own });
}

/* -------------------------------------------- */

/**
 * The picture of a weapon by its name, as the weapons compendium has it.
 * @param {string} name
 * @returns {string}      Empty where the compendium has no weapon of that name
 */
export function weaponImage(name) {
  const pack = game.packs?.get(`${FEO.id}.weapons`);
  return pack?.index?.find?.((entry) => entry.name === name)?.img ?? "";
}

/* -------------------------------------------- */

/**
 * What the dock's list of weapons shows of what a unit is lent: every weapon it may take up, with the skill
 * that lends it, and those that are used by themselves.
 * @param {Actor} actor
 * @returns {{key: string, name: string, skill: string, img: string, mark: string, might: number, hit: number,
 *   range: string, on: boolean, auto: boolean, ready: boolean, reason: string|null, wait: number}[]}
 */
export function lentList(actor) {
  const offers = offersOf(actor).filter((offer) => !offer.cast);
  const picked = takenUp(actor, offers);
  return offers.map((offer) => ({
    key: offer.key,
    name: offer.name,
    skill: offer.skill,
    img: weaponImage(offer.name) || actor.items.get(offer.id)?.img || "icons/svg/book.svg",
    mark: actor.items.get(offer.id)?.img ?? "",
    might: offer.arm.weapon.might,
    hit: offer.arm.bare.hit,
    crit: offer.arm.bare.crit,
    range: offer.arm.weapon.range,
    on: offer.key === picked,
    auto: offer.auto,
    ready: offer.ready,
    reason: offer.reason,
    wait: offer.wait
  }));
}

/* -------------------------------------------- */

/**
 * The lent weapon a unit holds in place of the one in its hand, for what shows a unit's weapon.
 * @param {Actor} actor
 * @returns {{key: string, name: string, skill: string, img: string, mark: string, might: number, hit: number,
 *   range: string}|null}
 */
export function lentInHand(actor) {
  return lentList(actor).find((entry) => entry.on) ?? null;
}

/* -------------------------------------------- */

/**
 * The weapons a skill may cast, among which one is picked as the skill is switched on (see `cast` in
 * `rules/lending.mjs`), and the one it has picked.
 * @param {Item} item         The skill
 * @returns {{arms: object[], picked: string|null}|null}      Null for a skill that casts none
 */
export function castsOf(item) {
  const lend = (item?.system?.effects ?? []).find((effect) => effect?.lend?.cast)?.lend;
  if ( !lend || (item.system.automate === false) ) return null;
  const arms = lentArms(lend, item.parent?.system?.proficiencies ?? {});
  const kept = item.system.state?.picked?.[LENT_PICK];
  return { arms, picked: arms.some((arm) => arm.name === kept) ? kept : null };
}

/* -------------------------------------------- */

/**
 * Have whoever acts for a unit pick the weapon a skill casts, as the skill is switched on: from a short list
 * above the dock, each with its numbers. A unit that answers by itself takes the one with the most Might.
 * @param {Item} item         The skill
 * @returns {Promise<string|null>}    The weapon picked, which the skill then keeps; null where none was
 */
export async function pickCast(item) {
  const casts = castsOf(item);
  if ( !casts?.arms.length ) return null;
  const strongest = [...casts.arms].sort((a, b) => (b.might - a.might) || (b.hit - a.hit))[0];
  let name = casts.picked ?? strongest.name;

  // The list is offered on the map the unit stands on; off it, the one it last picked stays, or the strongest
  const token = (item.parent?.getActiveTokens?.(false, true) ?? []).find((placed) => placed.parent === globalThis.canvas?.scene) ?? null;
  if ( (casts.arms.length > 1) && token ) {
    const { answersAlone } = await import("./answers.mjs");
    const ask = game.feo?.hud?.choose;
    if ( answersAlone(item.parent) ) name = strongest.name;
    else if ( ask ) {
      const picked = await ask({
        token,
        skill: item.name,
        hint: game.i18n.format("FEO.Lend.castHint", { skill: item.name }),
        options: casts.arms.map((arm) => ({
          id: arm.name,
          label: arm.name,
          hint: game.i18n.format("FEO.Lend.numbers", { might: arm.might, hit: arm.hit, range: arm.range }),
          img: weaponImage(arm.name) || item.img
        }))
      });
      if ( !picked ) return null;
      name = picked;
    }
  }
  await item.update({ "system.state.picked": { ...(item.system.state?.picked ?? {}), [LENT_PICK]: name } });
  return name;
}

/* -------------------------------------------- */

/**
 * How far the weapon in a unit's hand reaches by itself, as its Range is written.
 * @param {Actor} actor
 * @returns {{min: number, max: number}|null}
 */
export function ownReach(actor) {
  const item = actor.system.equippedWeapon;
  return item ? parseRange(item.system.range, actor.system.statValues) : null;
}

/* -------------------------------------------- */

/**
 * A unit that takes a weapon of its own in hand puts down the one it was lent.
 */
export function registerHooks() {
  Hooks.on("updateItem", (item, change, options, userId) => {
    if ( (userId !== game.user.id) || (item.type !== "weapon") || !item.parent ) return;
    if ( change.system?.equipped !== true ) return;
    if ( item.parent.getFlag?.(FEO.id, FLAG) ) takeUp(item.parent, null);
  });
}

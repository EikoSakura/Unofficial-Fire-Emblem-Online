/**
 * The Base for Fire Emblem Online: what the company keeps between battles, as the Off the Map section of the
 * rules describes it. Who is on the roster and who marches, what forging and sparring are worth, and the shape
 * of what the world remembers about its Base.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";
import { killExp } from "./experience.mjs";

/**
 * @typedef BaseState
 * @property {string} name                      What the Base is called
 * @property {string} backdrop                  An image shown in place of the drawn camp, if one is set
 * @property {{title: string, subtitle: string}} chapter    The battle the company marches to next
 * @property {Record<string, boolean>} closed   The posts the Game Master has shut
 * @property {number} limit                     How many units may march
 * @property {number} bouts                     How many times a unit may spar before the next battle
 * @property {string[]} members                 The Actors recruited to the roster, besides the players' characters
 * @property {Record<string, {march?: boolean, out?: boolean, lead?: string}>} muster
 *           For each Actor: whether a recruit marches, whether a player's character sits out, and the User who
 *           leads it in battle ("" for the Game Master)
 * @property {{id: string, actor: string, cost: number, terms: string, check: string, temp: boolean}[]} offers
 *           Units waiting at the gate, and what each asks to join
 * @property {{id: string, data: object}[]} convoy          Item data held for the whole company
 * @property {{id: string, name: string, icon: string, keeper: string, open: boolean,
 *   stock: {id: string, uuid: string, price: number|null, left: number|null}[]}[]} shops
 * @property {{id: string, title: string, text: string, tags: string[], action: string}[]} notices
 * @property {Record<string, boolean>} ready    The Users who are ready to march
 * @property {Record<string, number>} sparred   Bouts each Actor has fought since the last battle
 * @property {Record<string, string>} talked    The support rank each pair last held a conversation at
 */

/**
 * A Base as it is before anyone has changed it.
 * @returns {BaseState}
 */
export function emptyBase() {
  return {
    name: "",
    backdrop: "",
    chapter: { title: "", subtitle: "" },
    closed: {},
    limit: FEO.base.limit,
    bouts: FEO.base.spar.bouts,
    members: [],
    muster: {},
    offers: [],
    convoy: [],
    shops: [],
    notices: [],
    ready: {},
    sparred: {},
    talked: {}
  };
}

/* -------------------------------------------- */

/**
 * Read what a world has stored of its Base, filling in whatever is missing or misshapen.
 * @param {object} [raw]
 * @returns {BaseState}
 */
export function normalizeBase(raw) {
  const base = emptyBase();
  if ( !raw || (typeof raw !== "object") ) return base;
  const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
  const record = (value) => value && (typeof value === "object") && !Array.isArray(value) ? { ...value } : {};
  const list = (value) => Array.isArray(value) ? value.filter((entry) => entry && (typeof entry === "object")) : [];
  const count = (value, fallback, min) => Number.isInteger(value) && (value >= min) ? value : fallback;

  base.name = text(raw.name);
  base.backdrop = text(raw.backdrop);
  base.chapter = { title: text(raw.chapter?.title), subtitle: text(raw.chapter?.subtitle) };
  base.closed = record(raw.closed);
  base.limit = count(raw.limit, base.limit, 1);
  base.bouts = count(raw.bouts, base.bouts, 0);
  base.members = Array.isArray(raw.members) ? [...new Set(raw.members.filter((id) => typeof id === "string"))] : [];
  base.muster = record(raw.muster);
  base.offers = list(raw.offers).map((offer) => ({
    id: text(offer.id), actor: text(offer.actor), cost: count(offer.cost, 0, 0),
    terms: text(offer.terms), check: text(offer.check), temp: !!offer.temp
  })).filter((offer) => offer.id && offer.actor);
  base.convoy = list(raw.convoy).filter((entry) => entry.id && entry.data);
  base.shops = list(raw.shops).filter((shop) => shop.id).map((shop) => ({
    id: shop.id, name: text(shop.name), icon: text(shop.icon, "coin"), keeper: text(shop.keeper), open: shop.open !== false,
    stock: list(shop.stock).filter((ware) => ware.id && ware.uuid).map((ware) => ({
      id: ware.id, uuid: ware.uuid,
      price: Number.isInteger(ware.price) && (ware.price >= 0) ? ware.price : null,
      left: Number.isInteger(ware.left) && (ware.left >= 0) ? ware.left : null
    }))
  }));
  base.notices = list(raw.notices).filter((notice) => notice.id).map((notice) => ({
    id: notice.id, title: text(notice.title), text: text(notice.text),
    tags: Array.isArray(notice.tags) ? notice.tags.filter((tag) => typeof tag === "string") : [],
    action: text(notice.action)
  }));
  base.ready = record(raw.ready);
  base.sparred = record(raw.sparred);
  base.talked = record(raw.talked);
  return base;
}

/* -------------------------------------------- */
/*  The Roster                                  */
/* -------------------------------------------- */

/**
 * Does a unit of the company march to the next battle? A player's character marches unless it has been stood
 * down; a recruit marches once it has been chosen.
 * @param {BaseState} base
 * @param {string} actor          The unit's Actor
 * @param {boolean} character     Is it a player's character?
 * @returns {boolean}
 */
export function isMarching(base, actor, character) {
  const entry = base.muster[actor];
  return character ? !entry?.out : !!entry?.march;
}

/* -------------------------------------------- */

/**
 * How many places in the ranks are still open.
 * @param {BaseState} base
 * @param {{id: string, character: boolean}[]} company    Everyone on the roster
 * @returns {number}
 */
export function openPlaces(base, company) {
  const marching = company.filter((unit) => isMarching(base, unit.id, unit.character)).length;
  return Math.max(base.limit - marching, 0);
}

/* -------------------------------------------- */
/*  Forging                                     */
/* -------------------------------------------- */

/**
 * @typedef {Record<string, number>} ForgeSteps   Increments to each of a weapon's stats, up or down
 */

/**
 * A weapon's increments, each held within the limit and whole.
 * @param {ForgeSteps} [steps]
 * @returns {ForgeSteps}
 */
export function forgeSteps(steps = {}) {
  const { max, stats } = FEO.base.forge;
  const held = {};
  for ( const key of Object.keys(stats) ) held[key] = Math.min(Math.max(Math.trunc(steps?.[key] ?? 0) || 0, -max), max);
  return held;
}

/* -------------------------------------------- */

/**
 * What it costs to bring one stat to a number of increments from none: each costs more than the last.
 * @param {number} increments
 * @returns {number}
 */
export function forgeCost(increments) {
  const n = Math.abs(Math.trunc(increments ?? 0));
  return FEO.base.forge.cost * n * (n + 1) / 2;
}

/* -------------------------------------------- */

/**
 * What a smith charges to take a weapon from one set of increments to another. Increments already paid for
 * are not paid for again, and taking some away earns nothing back; turning a stat the other way starts anew.
 * @param {ForgeSteps} from
 * @param {ForgeSteps} to
 * @returns {{total: number, byStat: Record<string, number>}}
 */
export function forgePrice(from, to) {
  const before = forgeSteps(from);
  const after = forgeSteps(to);
  const byStat = {};
  let total = 0;
  for ( const key of Object.keys(after) ) {
    const same = (Math.sign(before[key]) === Math.sign(after[key])) || (before[key] === 0);
    const paid = same ? forgeCost(before[key]) : 0;
    byStat[key] = Math.max(forgeCost(after[key]) - paid, 0);
    total += byStat[key];
  }
  return { total, byStat };
}

/* -------------------------------------------- */

/**
 * How many increments a weapon carries, of the most it can.
 * @param {ForgeSteps} steps
 * @returns {{count: number, most: number}}
 */
export function forgeCount(steps) {
  const held = forgeSteps(steps);
  const keys = Object.keys(held);
  return { count: keys.reduce((sum, key) => sum + Math.abs(held[key]), 0), most: keys.length * FEO.base.forge.max };
}

/* -------------------------------------------- */

/**
 * A weapon's stats once it is forged from one set of increments to another.
 * @param {{might: number, hit: number, crit: number, weight: number}} weapon   Weapon data as it is now
 * @param {ForgeSteps} from
 * @param {ForgeSteps} to
 * @returns {Record<string, number>}
 */
export function forgedStats(weapon, from, to) {
  const before = forgeSteps(from);
  const after = forgeSteps(to);
  const stats = {};
  for ( const [key, { step }] of Object.entries(FEO.base.forge.stats) ) {
    stats[key] = (weapon?.[key] ?? 0) + ((after[key] - before[key]) * step);
    if ( key === "weight" ) stats[key] = Math.max(stats[key], 0);
  }
  return stats;
}

/* -------------------------------------------- */

/**
 * Can a weapon be forged? Staves, and the weapons of Laguz, Manakete and Taguel, cannot; nor can one that is
 * broken.
 * @param {{category: string}} weapon
 * @param {boolean} [broken]
 * @returns {boolean}
 */
export function canForge(weapon, broken = false) {
  return !broken && !!weapon && !FEO.base.forge.barred.includes(weapon.category);
}

/* -------------------------------------------- */
/*  Sparring                                    */
/* -------------------------------------------- */

/**
 * What a bout of sparring earns each fighter: kill experience against the other's level, and more for the one
 * who yields.
 * @param {number} level        The fighter's level
 * @param {number} foeLevel     The level of whoever it faced
 * @param {boolean} yielded     Did this fighter lose?
 * @returns {number}
 */
export function sparExp(level, foeLevel, yielded) {
  return killExp(level, foeLevel) + (yielded ? FEO.base.spar.loser : 0);
}

/* -------------------------------------------- */

/**
 * Bouts a unit has left before the next battle.
 * @param {BaseState} base
 * @param {string} actor
 * @returns {number}
 */
export function boutsLeft(base, actor) {
  return Math.max(base.bouts - (base.sparred[actor] ?? 0), 0);
}

/* -------------------------------------------- */
/*  Wares                                       */
/* -------------------------------------------- */

/**
 * The group a weapon is listed under in a ledger: its own type, with the kinds of bow together and every
 * tome together.
 * @param {string} type         "weapon" or "gear"
 * @param {string} [category]   A key of FEO.weaponCategories
 * @returns {string}            A key of FEO.base.wares
 */
export function wareKind(type, category) {
  if ( type !== "weapon" ) return "item";
  const config = FEO.weaponCategories[category];
  if ( config?.magic ) return "tome";
  if ( config?.ranged ) return "bow";
  return category in FEO.base.wares ? category : "other";
}

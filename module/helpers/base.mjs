import { FEO } from "../config.mjs";
import {
  boutsLeft, canForge, forgePrice, forgeSteps, forgedStats, isMarching, normalizeBase, sparExp, wareKind
} from "../rules/base.mjs";
import { sellValue } from "../rules/progression.mjs";
import { discounted } from "../rules/stealing.mjs";
import { postCard } from "./chat.mjs";
import { awardExp, earnsExp, expRow, useExp } from "./experience.mjs";
import { linkBond } from "./supports.mjs";
import { originalOf } from "./weapons.mjs";

/**
 * The Base in Foundry: what the world remembers of it, who is in the company, and everything that can be done
 * there. What a world remembers is one world setting, which only a Game Master may write, so whatever a player
 * does at the Base is asked of an active Game Master, whose client does it.
 *
 * @import {BaseState} from "../rules/base.mjs"
 */

/** The world setting that holds the Base. */
export const BASE_SETTING = "base";

/** The query by which a player asks a Game Master to do something at the Base. */
export const BASE_QUERY = `${FEO.id}.base`;

/** The flag, on a forged weapon, that keeps the increments it carries. */
export const FORGE_FLAG = "forge";

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * Register the setting that holds the Base, and the query that changes it.
 * @param {() => void} onChange     Called on every client when the Base changes
 */
export function registerBase(onChange) {
  game.settings.register(FEO.id, BASE_SETTING, { scope: "world", config: false, type: Object, default: {}, onChange });
  CONFIG.queries[BASE_QUERY] = baseQuery;
}

/* -------------------------------------------- */

/**
 * What the world remembers of its Base.
 * @returns {BaseState}
 */
export function readBase() {
  return normalizeBase(game.settings.get(FEO.id, BASE_SETTING));
}

/* -------------------------------------------- */

/**
 * The company: the characters of the players, then the units recruited to the roster.
 * @param {BaseState} [base]
 * @returns {{actor: Actor, user: User|null, character: boolean}[]}
 */
export function company(base = readBase()) {
  const units = [];
  const seen = new Set();
  for ( const user of game.users ) {
    const actor = user.isGM ? null : user.character;
    if ( (actor?.type !== "unit") || seen.has(actor.id) ) continue;
    seen.add(actor.id);
    units.push({ actor, user, character: true });
  }
  for ( const id of base.members ) {
    const actor = game.actors.get(id);
    if ( (actor?.type !== "unit") || seen.has(id) ) continue;
    seen.add(id);
    units.push({ actor, user: null, character: false });
  }
  return units;
}

/* -------------------------------------------- */

/**
 * May a user act for a unit at the Base? Its owners may, and whoever leads it in battle.
 * @param {BaseState} base
 * @param {Actor} actor
 * @param {User} user
 * @returns {boolean}
 */
export function mayAct(base, actor, user) {
  return user.isGM || actor.testUserPermission(user, "OWNER") || (base.muster[actor.id]?.lead === user.id);
}

/* -------------------------------------------- */

/**
 * The system's own Item compendiums, which the stalls are stocked from.
 * @returns {CompendiumCollection[]}
 */
export function systemPacks() {
  return game.packs.filter((pack) => {
    return (pack.documentName === "Item") && (pack.metadata.packageType === "system")
      && (pack.metadata.packageName === FEO.id);
  });
}

/* -------------------------------------------- */
/*  Asking                                      */
/* -------------------------------------------- */

/**
 * Do something at the Base. A Game Master does it at once; anyone else asks an active Game Master to.
 * @param {string} action     A key of the actions below
 * @param {object} [data]     What the action needs
 * @returns {Promise<{ok: boolean}>}
 */
export async function request(action, data = {}) {
  const payload = { action, data, user: game.user.id };
  let result;
  if ( game.user.isGM ) result = await perform(payload);
  else {
    const gm = game.users.activeGM;
    if ( !gm ) result = { ok: false, warn: "FEO.Base.warn.noGM" };
    else {
      try {
        result = await gm.query(BASE_QUERY, payload, { timeout: 15000 });
      } catch(err) {
        console.error(err);
        result = { ok: false, warn: "FEO.Base.warn.failed" };
      }
    }
  }
  if ( result?.warn ) ui.notifications.warn(game.i18n.format(result.warn, result.data ?? {}));
  return result ?? { ok: false };
}

/* -------------------------------------------- */

/**
 * Answer another user's request to do something at the Base. Runs for a Game Master.
 * @param {{action: string, data: object, user: string}} payload
 * @returns {Promise<{ok: boolean}>}
 */
export async function baseQuery(payload) {
  if ( !game.user.isGM ) return { ok: false };
  return perform(payload);
}

/* -------------------------------------------- */

/** A request that is turned down, with the reason to tell whoever made it. */
class Refusal extends Error {
  constructor(key, data = {}) {
    super(key);
    this.key = key;
    this.data = data;
  }
}

const refuse = (key, data) => {
  throw new Refusal(key, data);
};

/** Requests are answered one at a time, so that two of them never write over each other. */
let queue = Promise.resolve();

/**
 * Take a place in the queue.
 * @param {{action: string, data: object, user: string}} payload
 * @returns {Promise<{ok: boolean}>}
 */
function perform(payload) {
  const done = queue.then(() => act(payload));
  queue = done.catch(() => {});
  return done;
}

/* -------------------------------------------- */

/**
 * Carry out one request and save what it changed.
 * @param {{action: string, data: object, user: string}} payload
 * @returns {Promise<{ok: boolean, warn?: string, data?: object}>}
 */
async function act({ action, data = {}, user: userId } = {}) {
  const user = game.users.get(userId);
  const entry = ACTIONS[action];
  if ( !user || !entry ) return { ok: false };
  if ( entry.gm && !user.isGM ) return { ok: false, warn: "FEO.Base.warn.gmOnly" };
  const before = readBase();
  const base = foundry.utils.deepClone(before);
  try {
    const actor = data.actor ? game.actors.get(data.actor) : null;
    if ( entry.unit ) {
      if ( actor?.type !== "unit" ) refuse("noUnit");
      if ( !mayAct(base, actor, user) ) refuse("notYours", { name: actor.name });
    }
    if ( entry.post && base.closed[entry.post] && !user.isGM ) refuse("closed");
    const result = await entry.run({ base, data, user, actor });
    if ( JSON.stringify(before) !== JSON.stringify(base) ) await game.settings.set(FEO.id, BASE_SETTING, base);
    return { ok: true, ...(result ?? {}) };
  } catch(err) {
    if ( err instanceof Refusal ) return { ok: false, warn: `FEO.Base.warn.${err.key}`, data: err.data };
    console.error(err);
    return { ok: false, warn: "FEO.Base.warn.failed" };
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const newId = () => foundry.utils.randomID();
const number = (value) => Number(value ?? 0).toLocaleString("en-US");

/**
 * The player whose character a unit is, if it is one.
 * @param {Actor} actor
 * @returns {User|null}
 */
function playerOf(actor) {
  return game.users.find((user) => !user.isGM && (user.character?.id === actor.id)) ?? null;
}

/**
 * A unit that is on the roster, or a refusal.
 * @param {BaseState} base
 * @param {string} id
 * @returns {{actor: Actor, player: User|null}}
 */
function member(base, id) {
  const actor = game.actors.get(id);
  if ( actor?.type !== "unit" ) refuse("noUnit");
  const player = playerOf(actor);
  if ( !player && !base.members.includes(actor.id) ) refuse("notOnRoster", { name: actor.name });
  return { actor, player };
}

/**
 * A weapon or an item that a unit carries, or a refusal.
 * @param {Actor} actor
 * @param {string} id
 * @returns {Item}
 */
function carried(actor, id) {
  const item = actor.items.get(id);
  if ( !item || !["weapon", "gear"].includes(item.type) ) refuse("noItem");
  return item;
}

/**
 * May a unit part with a weapon or an item, or is it refused: one a creature was handed is neither stored nor
 * sold, and nothing leaves a pack that is locked (see `helpers/creatures.mjs`).
 * @param {Actor} actor
 * @param {Item} item
 */
async function parts(actor, item) {
  const { packBar } = await import("./creatures.mjs");
  if ( packBar(actor, item) ) refuse("bound", { item: item.name, name: actor.name });
}

/**
 * Take gold from a unit, or refuse if it has too little.
 * @param {Actor} actor
 * @param {number} amount
 */
async function pay(actor, amount) {
  if ( !(amount > 0) ) return;
  const gold = actor.system.gold;
  if ( gold < amount ) refuse("gold", { name: actor.name, cost: number(amount), gold: number(gold) });
  await actor.update({ "system.gold": gold - amount });
}

/**
 * The data of a weapon or an item fresh from a stall.
 * @param {Item} source
 * @returns {object}
 */
function freshCopy(source) {
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  if ( data.system.uses ) data.system.uses.value = data.system.uses.max;
  if ( "equipped" in data.system ) data.system.equipped = false;
  return data;
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/**
 * Everything that can be done at the Base. `gm` marks what only a Game Master may do; `unit` what is done for
 * the unit named in the request, which whoever asks must be allowed to act for; `post` the post that must be
 * open for it.
 * @type {Record<string, {gm?: boolean, unit?: boolean, post?: string, run: (context: {base: BaseState,
 *   data: object, user: User, actor: Actor|null}) => Promise<object|void>|object|void}>}
 */
const ACTIONS = {

  /* ---------- The camp and the march ---------- */

  ready: {
    run({ base, user }) {
      if ( base.ready[user.id] ) delete base.ready[user.id];
      else base.ready[user.id] = true;
    }
  },

  sound: {
    gm: true,
    async run({ base, user }) {
      const marching = company(base).filter((unit) => isMarching(base, unit.actor.id, unit.character));
      const rows = marching.map(({ actor, user: player }) => {
        const lead = game.users.get(base.muster[actor.id]?.lead ?? "") ?? player;
        return { label: actor.name, value: lead ? fmt("FEO.Base.roster.ledBy", { name: lead.name }) : loc("FEO.Base.roster.gm") };
      });
      base.ready = {};
      base.sparred = {};
      const speaker = marching[0]?.actor ?? user.character ?? null;
      await postCard(speaker, {
        title: loc("FEO.Base.march.sounded"),
        subtitle: [base.chapter.title, base.chapter.subtitle].filter(Boolean).join(" · ") || undefined,
        rows
      });
    }
  },

  configure: {
    gm: true,
    run({ base, data }) {
      const text = (value) => String(value ?? "").trim();
      base.name = text(data.name);
      base.backdrop = text(data.backdrop);
      base.chapter = { title: text(data.title), subtitle: text(data.subtitle) };
      if ( Number.isInteger(data.limit) && (data.limit >= 1) ) base.limit = data.limit;
      if ( Number.isInteger(data.bouts) && (data.bouts >= 0) ) base.bouts = data.bouts;
    }
  },

  post: {
    gm: true,
    run({ base, data }) {
      if ( !(data.post in FEO.base.posts) || (data.post === "camp") ) return;
      if ( base.closed[data.post] ) delete base.closed[data.post];
      else base.closed[data.post] = true;
    }
  },

  gold: {
    gm: true,
    async run({ data }) {
      const actor = game.actors.get(data.actor);
      const amount = Math.trunc(Number(data.amount) || 0);
      if ( (actor?.type !== "unit") || !amount ) return;
      await actor.update({ "system.gold": Math.max(actor.system.gold + amount, 0) });
      await postCard(actor, {
        title: fmt("FEO.Base.camp.granted", { name: actor.name }),
        rows: [{ label: loc("FEO.Unit.gold"), value: `${amount > 0 ? "+" : "−"}${number(Math.abs(amount))}`, cls: amount > 0 ? "good" : "" }]
      });
    }
  },

  /* ---------- The roster ---------- */

  march: {
    post: "roster",
    run({ base, data, user }) {
      const { actor, player } = member(base, data.actor);
      if ( player && !user.isGM && (player !== user) && player.active ) refuse("notYours", { name: actor.name });
      if ( actor.system.defeat?.state === "dead" ) refuse("fallen", { name: actor.name });
      const marching = company(base).filter((unit) => isMarching(base, unit.actor.id, unit.character)).length;
      if ( !isMarching(base, actor.id, !!player) && (marching >= base.limit) ) refuse("full");
      const entry = base.muster[actor.id] ??= {};
      if ( player ) delete entry.out;
      else {
        entry.march = true;
        entry.lead ??= user.isGM ? "" : user.id;
      }
    }
  },

  stand: {
    post: "roster",
    run({ base, data, user }) {
      const { actor, player } = member(base, data.actor);
      if ( player && !user.isGM && (player !== user) && player.active ) refuse("notYours", { name: actor.name });
      const entry = base.muster[actor.id] ??= {};
      if ( player ) entry.out = true;
      else entry.march = false;
    }
  },

  lead: {
    post: "roster",
    run({ base, data, user }) {
      const { actor, player } = member(base, data.actor);
      if ( player && !user.isGM && player.active ) refuse("notYours", { name: actor.name });
      const lead = game.users.get(data.lead ?? "");
      const entry = base.muster[actor.id] ??= {};
      if ( lead && !lead.isGM && (lead !== player) ) entry.lead = lead.id;
      else if ( player ) delete entry.lead;
      else entry.lead = "";
    }
  },

  limit: {
    gm: true,
    run({ base, data }) {
      const marching = company(base).filter((unit) => isMarching(base, unit.actor.id, unit.character)).length;
      base.limit = Math.min(Math.max(base.limit + Math.trunc(Number(data.delta) || 0), Math.max(marching, 1)), 40);
    }
  },

  enlist: {
    gm: true,
    run({ base, data }) {
      const actor = game.actors.get(data.actor);
      if ( actor?.type !== "unit" ) refuse("noUnit");
      if ( playerOf(actor) || base.members.includes(actor.id) ) refuse("onRoster", { name: actor.name });
      base.members.push(actor.id);
      base.offers = base.offers.filter((offer) => offer.actor !== actor.id);
    }
  },

  dismiss: {
    gm: true,
    run({ base, data }) {
      base.members = base.members.filter((id) => id !== data.actor);
      delete base.muster[data.actor];
    }
  },

  offer: {
    gm: true,
    run({ base, data }) {
      const actor = game.actors.get(data.actor);
      if ( actor?.type !== "unit" ) refuse("noUnit");
      if ( playerOf(actor) || base.members.includes(actor.id) ) refuse("onRoster", { name: actor.name });
      base.offers = base.offers.filter((offer) => offer.actor !== actor.id);
      base.offers.push({
        id: newId(), actor: actor.id, cost: Math.max(Math.trunc(Number(data.cost) || 0), 0),
        terms: String(data.terms ?? "").trim(), check: String(data.check ?? "").trim(), temp: !!data.temp
      });
    }
  },

  withdraw: {
    gm: true,
    run({ base, data }) {
      base.offers = base.offers.filter((offer) => offer.id !== data.offer);
    }
  },

  // A unit at the gate joins: for gold, which whoever is visiting pays, or by the Game Master's leave
  hire: {
    unit: true,
    post: "roster",
    async run({ base, data, user, actor }) {
      const offer = base.offers.find((entry) => entry.id === data.offer);
      const recruit = game.actors.get(offer?.actor ?? "");
      if ( !offer || (recruit?.type !== "unit") ) refuse("gone");

      // One that must be persuaded is asked in the chat, and joins when the Game Master says so
      if ( !offer.cost && offer.check && !user.isGM ) {
        await postCard(actor, {
          title: fmt("FEO.Base.roster.pleads", { name: actor.name, recruit: recruit.name }),
          rows: [{ label: loc("FEO.Base.roster.check"), value: offer.check }],
          note: loc("FEO.Base.roster.pleadsNote")
        });
        return;
      }
      await pay(actor, user.isGM && data.free ? 0 : offer.cost);
      base.offers = base.offers.filter((entry) => entry.id !== offer.id);
      if ( !base.members.includes(recruit.id) ) base.members.push(recruit.id);
      await postCard(recruit, {
        title: fmt("FEO.Base.roster.joined", { name: recruit.name }),
        subtitle: offer.terms || undefined,
        rows: offer.cost && !(user.isGM && data.free)
          ? [{ label: fmt("FEO.Base.paidBy", { name: actor.name }), value: `−${number(offer.cost)}` }] : []
      });
    }
  },

  /* ---------- The convoy ---------- */

  store: {
    unit: true,
    post: "convoy",
    async run({ base, data, actor }) {
      const item = carried(actor, data.item);
      await parts(actor, item);
      const kept = item.toObject();
      if ( "equipped" in kept.system ) kept.system.equipped = false;
      base.convoy.unshift({ id: newId(), data: kept });
      await item.delete();
    }
  },

  take: {
    unit: true,
    post: "convoy",
    async run({ base, data, actor }) {
      const index = base.convoy.findIndex((entry) => entry.id === data.entry);
      if ( index < 0 ) refuse("gone");
      const [entry] = base.convoy.splice(index, 1);
      const made = foundry.utils.deepClone(entry.data);
      delete made._id;
      await actor.createEmbeddedDocuments("Item", [made]);
    }
  },

  stow: {
    gm: true,
    async run({ base, data }) {
      const source = await foundry.utils.fromUuid(data.uuid);
      if ( !["weapon", "gear"].includes(source?.type) ) refuse("noItem");
      const kept = source.toObject();
      if ( "equipped" in kept.system ) kept.system.equipped = false;
      base.convoy.unshift({ id: newId(), data: kept });
    }
  },

  discard: {
    gm: true,
    run({ base, data }) {
      base.convoy = base.convoy.filter((entry) => entry.id !== data.entry);
    }
  },

  /* ---------- The market ---------- */

  buy: {
    unit: true,
    post: "market",
    async run({ base, data, actor }) {
      const shop = base.shops.find((entry) => entry.id === data.shop);
      const ware = shop?.stock.find((entry) => entry.id === data.ware);
      if ( !shop?.open || !ware ) refuse("gone");
      const source = await foundry.utils.fromUuid(ware.uuid);
      if ( !["weapon", "gear"].includes(source?.type) ) refuse("gone");
      if ( ware.left === 0 ) refuse("soldOut", { item: source.name });
      const most = Math.min(ware.left ?? FEO.base.buyMost, FEO.base.buyMost);
      const quantity = Math.min(Math.max(Math.trunc(Number(data.quantity) || 1), 1), most);
      // What the unit's skills and what it wears take off a price is taken off each ware (see `discounted`)
      const total = discounted(ware.price ?? source.system.cost, actor.system.knacks?.discount ?? 0) * quantity;
      await pay(actor, total);

      const copies = Array.from({ length: quantity }, () => freshCopy(source));
      const toConvoy = data.dest === "convoy";
      if ( toConvoy ) base.convoy.unshift(...copies.map((copy) => ({ id: newId(), data: copy })));
      else await actor.createEmbeddedDocuments("Item", copies);
      if ( ware.left !== null ) ware.left -= quantity;
      await postCard(actor, {
        title: fmt("FEO.Base.market.bought", { name: actor.name, item: quantity > 1 ? `${quantity} × ${source.name}` : source.name }),
        subtitle: shop.name || undefined,
        rows: [{ label: loc("FEO.Unit.gold"), value: `−${number(total)}` }],
        note: toConvoy ? loc("FEO.Base.market.sentToConvoy") : undefined
      });
    }
  },

  sell: {
    unit: true,
    post: "market",
    async run({ data, actor }) {
      const item = carried(actor, data.item);
      await parts(actor, item);
      const { value, max } = item.system.uses ?? { value: 0, max: 0 };
      const worth = originalOf(item) ? 0 : sellValue(item.system.cost, value, max);
      const name = item.name;
      await item.delete();
      await actor.update({ "system.gold": actor.system.gold + worth });
      await postCard(actor, {
        title: fmt("FEO.Sell.done", { item: name }),
        rows: [{ label: loc("FEO.Unit.gold"), value: `+${number(worth)}`, cls: "good" }]
      });
    }
  },

  stall: {
    gm: true,
    run({ base, data }) {
      const text = (value) => String(value ?? "").trim();
      const shop = base.shops.find((entry) => entry.id === data.shop);
      if ( shop ) {
        if ( data.remove ) base.shops = base.shops.filter((entry) => entry !== shop);
        else Object.assign(shop, { name: text(data.name) || shop.name, keeper: text(data.keeper), open: data.open !== false });
        return;
      }
      base.shops.push({ id: newId(), name: text(data.name) || loc("FEO.Base.market.newStall"), icon: "coin", keeper: text(data.keeper), open: true, stock: [] });
    }
  },

  // The stalls a new Base opens with, each stocked from the compendiums
  stalls: {
    gm: true,
    async run({ base }) {
      if ( base.shops.length ) return;
      for ( const { key, icon } of FEO.base.stalls ) {
        const shop = { id: newId(), name: loc(`FEO.Base.market.stall.${key}`), icon, keeper: loc(`FEO.Base.market.keeper.${key}`), open: true, stock: [] };
        const wanted = key === "armory" ? { arms: true } : { staves: true, supplies: true };
        shop.stock = await stockFrom(shop.stock, { rank: "D", ...wanted });
        base.shops.push(shop);
      }
    }
  },

  stock: {
    gm: true,
    async run({ base, data }) {
      const shop = base.shops.find((entry) => entry.id === data.shop);
      if ( !shop ) refuse("gone");
      if ( data.fill ) {
        shop.stock = await stockFrom(shop.stock, data.fill);
        return;
      }
      if ( data.clear ) {
        shop.stock = [];
        return;
      }
      if ( data.uuid ) {
        const source = await foundry.utils.fromUuid(data.uuid);
        if ( !["weapon", "gear"].includes(source?.type) ) refuse("noItem");
        if ( !shop.stock.some((ware) => ware.uuid === data.uuid) ) shop.stock.push({ id: newId(), uuid: data.uuid, price: null, left: null });
        return;
      }
      const ware = shop.stock.find((entry) => entry.id === data.ware);
      if ( !ware ) refuse("gone");
      if ( data.remove ) shop.stock = shop.stock.filter((entry) => entry !== ware);
      else {
        const whole = (value) => (value === null) || (value === "") || (value === undefined) ? null : Math.max(Math.trunc(Number(value) || 0), 0);
        ware.price = whole(data.price);
        ware.left = whole(data.left);
      }
    }
  },

  /* ---------- The forge ---------- */

  forge: {
    unit: true,
    post: "forge",
    async run({ data, actor }) {
      const item = carried(actor, data.item);
      if ( (item.type !== "weapon") || !canForge(item.system, !!originalOf(item)) ) refuse("cannotForge", { item: item.name });
      const from = forgeSteps(item.flags?.[FEO.id]?.[FORGE_FLAG]);
      const to = forgeSteps(data.steps);
      const keys = Object.keys(to).filter((key) => to[key] !== from[key]);
      const name = String(data.name ?? "").trim() || item.name;
      if ( !keys.length && (name === item.name) ) return;
      const { total } = forgePrice(from, to);
      await pay(actor, total);
      const stats = forgedStats(item.system, from, to);
      const was = item.system;
      const rows = keys.map((key) => ({
        label: loc(`FEO.Weapon.${key}`),
        value: `${was[key]} → ${stats[key]}`,
        cls: ((key === "weight") ? (stats[key] < was[key]) : (stats[key] > was[key])) ? "good" : ""
      }));
      if ( total ) rows.push({ label: loc("FEO.Unit.gold"), value: `−${number(total)}` });
      await item.update({
        name,
        system: Object.fromEntries(keys.map((key) => [key, stats[key]])),
        [`flags.${FEO.id}.${FORGE_FLAG}`]: to
      });
      await postCard(actor, { title: fmt("FEO.Base.forge.done", { name: actor.name, item: name }), rows });
    }
  },

  /* ---------- Supports ---------- */

  talk: {
    unit: true,
    post: "supports",
    async run({ base, data, actor }) {
      const bond = actor.system.bonds[data.bond];
      if ( !bond ) refuse("gone");
      base.talked[`${actor.id}:${bond.uuid || bond.name}`] = bond.rank;
      await postCard(actor, {
        title: loc("FEO.Base.supports.conversation"),
        subtitle: fmt("FEO.Base.supports.pair", { name: actor.name, partner: bond.name || loc("FEO.Bond.unnamed") }),
        rows: [{ label: loc("FEO.Bond.rank"), value: loc(FEO.supportRanks[bond.rank]?.label ?? ""), cls: "good" }],
        note: loc("FEO.Base.supports.conversationNote")
      });
    }
  },

  befriend: {
    unit: true,
    post: "supports",
    async run({ base, data, actor }) {
      const { actor: partner } = member(base, data.partner);
      if ( partner === actor ) return;
      const made = await linkBond(actor, partner);
      await linkBond(partner, actor);
      if ( !made ) refuse("bonded", { name: partner.name });
    }
  },

  rank: {
    gm: true,
    async run({ data }) {
      const actor = game.actors.get(data.actor);
      if ( actor?.type !== "unit" ) refuse("noUnit");
      const bonds = foundry.utils.deepClone(actor._source.system.bonds);
      const bond = bonds[data.bond];
      const ranks = Object.keys(FEO.supportRanks);
      const next = ranks[ranks.indexOf(bond?.rank) + (data.lower ? -1 : 1)];
      if ( !bond || !next ) return;
      bond.rank = next;
      await actor.update({ "system.bonds": bonds });
    }
  },

  /* ---------- The training grounds ---------- */

  spar: {
    unit: true,
    post: "training",
    async run({ base, data, actor }) {
      const { actor: foe } = member(base, data.foe);
      if ( foe === actor ) refuse("noUnit");
      for ( const fighter of [actor, foe] ) {
        if ( boutsLeft(base, fighter.id) < 1 ) refuse("noBouts", { name: fighter.name });
      }
      const won = data.winner === "foe" ? foe : actor;
      const rows = [];
      for ( const [fighter, other] of [[actor, foe], [foe, actor]] ) {
        base.sparred[fighter.id] = (base.sparred[fighter.id] ?? 0) + 1;
        if ( !earnsExp(fighter) ) continue;
        const award = await awardExp(fighter, sparExp(fighter.system.level, other.system.level, fighter !== won));
        rows.push({ ...expRow(award), label: fighter.name });
      }

      // Whoever stands by with a staff mends them afterwards, which spends a use and earns as it would on the map
      const healer = data.healer ? game.actors.get(data.healer) : null;
      const staff = healer?.items.get(data.staff ?? "");
      if ( (staff?.type === "weapon") && (staff.system.category === "staff") && !staff.system.broken ) {
        const { value, max } = staff.system.uses;
        if ( max > 0 ) await staff.update({ "system.uses.value": Math.max(value - 1, 0) });
        const amount = useExp(healer, "staff", staff.name);
        if ( amount ) rows.push({ ...expRow(await awardExp(healer, amount)), label: `${healer.name} · ${staff.name}` });
      }
      await postCard(actor, {
        title: fmt("FEO.Base.training.bout", { name: actor.name, foe: foe.name }),
        outcome: { label: fmt("FEO.Base.training.won", { name: won.name }), cls: "good" },
        rows
      });
    }
  },

  /* ---------- The notice board ---------- */

  notice: {
    gm: true,
    run({ base, data }) {
      if ( data.remove ) {
        base.notices = base.notices.filter((notice) => notice.id !== data.notice);
        return;
      }
      const text = (value) => String(value ?? "").trim();
      if ( !text(data.title) ) return;
      base.notices.push({
        id: newId(), title: text(data.title), text: text(data.text), action: text(data.action),
        tags: text(data.tags).split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean)
      });
    }
  },

  join: {
    unit: true,
    post: "board",
    async run({ base, data, actor }) {
      const notice = base.notices.find((entry) => entry.id === data.notice);
      if ( !notice ) refuse("gone");
      await postCard(actor, {
        title: notice.title,
        subtitle: fmt("FEO.Base.board.joined", { name: actor.name }),
        rows: notice.tags.map((tag) => ({ label: "·", value: tag })),
        note: notice.text || undefined
      });
    }
  }
};

/* -------------------------------------------- */

/**
 * Add to a stall's stock from the system's compendiums.
 * @param {{id: string, uuid: string, price: number|null, left: number|null}[]} stock   What the stall holds
 * @param {object} wanted
 * @param {string} [wanted.rank]        The highest rank of weapon to stock, a key of FEO.ranks
 * @param {boolean} [wanted.arms]       Weapons and tomes
 * @param {boolean} [wanted.staves]     Staves
 * @param {boolean} [wanted.supplies]   Items
 * @returns {Promise<object[]>}         The stock with what was found added to it
 */
async function stockFrom(stock, { rank = "D", arms = false, staves = false, supplies = false } = {}) {
  const ranks = Object.keys(FEO.ranks);
  const reach = Math.max(ranks.indexOf(rank), 0);
  const kinds = Object.keys(FEO.base.wares);
  const found = [];
  for ( const pack of systemPacks() ) {
    const index = await pack.getIndex({ fields: ["system.cost", "system.rank", "system.category"] });
    for ( const entry of index ) {
      const cost = entry.system?.cost ?? 0;
      if ( !(cost > 0) ) continue;
      if ( entry.type === "gear" ) {
        if ( supplies ) found.push({ entry, kind: "item", rank: 0, cost });
        continue;
      }
      if ( entry.type !== "weapon" ) continue;
      const kind = wareKind("weapon", entry.system.category);
      const at = ranks.indexOf(entry.system.rank);
      if ( (kind === "other") || (at < 0) || (at > reach) ) continue;
      if ( kind === "staff" ? staves : arms ) found.push({ entry, kind, rank: at, cost });
    }
  }
  found.sort((a, b) => (kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) || (a.rank - b.rank) || (a.cost - b.cost)
    || a.entry.name.localeCompare(b.entry.name));
  const held = new Set(stock.map((ware) => ware.uuid));
  const added = found.filter(({ entry }) => !held.has(entry.uuid))
    .map(({ entry }) => ({ id: newId(), uuid: entry.uuid, price: null, left: null }));
  return [...stock, ...added];
}

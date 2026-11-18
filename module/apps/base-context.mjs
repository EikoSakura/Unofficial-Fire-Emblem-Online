/**
 * What the Base window shows, worked out from plain data: the company, what the world remembers of its Base,
 * and what the reader has chosen. Nothing here knows of Foundry, so that it can be tested outside of it.
 *
 * @import {BaseState} from "../rules/base.mjs"
 */
import { FEO } from "../config.mjs";
import {
  boutsLeft, canForge, forgeCount, forgePrice, forgeSteps, forgedStats, sparExp, wareKind
} from "../rules/base.mjs";
import { sellValue } from "../rules/progression.mjs";
import { discounted } from "../rules/stealing.mjs";
import { pointsForNext } from "../rules/supports.mjs";
import { canWield } from "../rules/weapons.mjs";

/**
 * @typedef Ware    A weapon or an item, as a ledger lists it
 * @property {string} id
 * @property {string|null} uuid
 * @property {string} name
 * @property {string} img
 * @property {"weapon"|"gear"} type
 * @property {string|null} category
 * @property {string} kind                A key of FEO.base.wares
 * @property {string} icon
 * @property {boolean} staff
 * @property {string|null} rank
 * @property {number|null} might
 * @property {number|null} hit
 * @property {number|null} crit
 * @property {number|null} weight
 * @property {string} range
 * @property {{value: number, max: number}} uses
 * @property {number} cost
 * @property {string} effect
 * @property {boolean} equipped
 * @property {boolean} broken
 * @property {Record<string, number>|null} forged
 */

/**
 * @typedef BaseUnit    A unit of the company, or one waiting at the gate
 * @property {string} id
 * @property {string} name
 * @property {string} img
 * @property {number} level
 * @property {string} cls
 * @property {{value: number, max: number}} hp
 * @property {number} gold
 * @property {number} [discount]          What it pays less in a shop, in percent
 * @property {{name: string, percent: number}[]} [discounts]      The skills and items that comes from
 * @property {string} icon
 * @property {{name: string, icon: string}|null} weapon     What it has equipped
 * @property {Record<string, number>} stats
 * @property {number} wounds
 * @property {number} injuries
 * @property {boolean} fallen
 * @property {boolean} character                    Is it a player's character?
 * @property {{id: string, name: string, online: boolean}|null} player
 * @property {boolean} marching
 * @property {string|null} lead                     The User who leads it, "" for the Game Master
 * @property {boolean} mine                         May the reader act for it?
 * @property {boolean} earns                        Does it earn experience?
 * @property {Record<string, {rank: string}>} ranks
 * @property {number} above
 * @property {string} affinity
 * @property {Ware[]} items
 * @property {object[]} bonds
 */

/**
 * @typedef BaseWorld
 * @property {BaseState} base
 * @property {{id: string, isGM: boolean}} user
 * @property {{id: string, name: string, online: boolean}[]} players
 * @property {BaseUnit[]} company
 * @property {{id: string, cost: number, terms: string, check: string, temp: boolean, unit: BaseUnit}[]} offers
 * @property {BaseUnit|null} visitor
 * @property {BaseUnit[]} visitors
 * @property {Map<string, Ware|null>} stock     The wares of every stall, by the address of each
 */

const number = (value) => Number(value ?? 0).toLocaleString("en-US");
const STAT_KEYS = ["str", "mag", "dex", "spd", "luk", "def", "res", "con"];
const LEDGER_STATS = ["might", "hit", "crit", "weight"];

/**
 * Tell a ledger about a weapon or an item.
 * @param {{name: string, img?: string, type: string, system: object, flags?: object, uuid?: string}} data
 * @param {string} id
 * @returns {Ware}
 */
export function wareOf(data, id) {
  const system = data.system ?? {};
  const weapon = data.type === "weapon";
  const kind = wareKind(data.type, system.category);
  const flags = data.flags?.[FEO.id] ?? {};
  return {
    id,
    uuid: data.uuid ?? null,
    name: data.name,
    img: data.img ?? "",
    type: weapon ? "weapon" : "gear",
    category: weapon ? system.category : null,
    kind,
    icon: weapon ? (FEO.categoryIcons[system.category] ?? FEO.base.wares[kind]) : (/\bkey\b|lockpick/i.test(data.name) ? "key" : "flask"),
    staff: kind === "staff",
    rank: weapon ? system.rank : null,
    level: weapon ? (system.level ?? null) : null,
    might: weapon ? system.might : null,
    hit: weapon ? system.hit : null,
    crit: weapon ? system.crit : null,
    weight: weapon ? system.weight : null,
    range: weapon ? (system.range ?? "") : "",
    uses: { value: system.uses?.value ?? 0, max: system.uses?.max ?? 0 },
    cost: system.cost ?? 0,
    effect: system.effect ?? "",
    equipped: !!system.equipped,
    broken: !!flags.original,
    forged: flags.forge ?? null
  };
}

/* -------------------------------------------- */

/**
 * How a ware suits a unit: anyone can use an item; a weapon is fit to wield, asks for a higher rank, or is not
 * of a type the unit has any rank in.
 * @param {BaseUnit|null} unit
 * @param {Ware} ware
 * @returns {"any"|"fit"|"unfit"|"other"}
 */
export function fitOf(unit, ware) {
  if ( ware.type !== "weapon" ) return "any";
  if ( !unit ) return "other";
  const { ok, has } = canWield(unit.ranks, { category: ware.category, rank: ware.rank, level: ware.level }, { above: unit.above, level: unit.wlv ?? null });
  if ( ok ) return "fit";
  return (has === null) || (has === Object.keys(FEO.ranks)[0]) ? "other" : "unfit";
}

/* -------------------------------------------- */

/**
 * What a ware sells for.
 * @param {Ware} ware
 * @returns {number}
 */
export function worthOf(ware) {
  return ware.broken ? 0 : sellValue(ware.cost, ware.uses.value, ware.uses.max);
}

/* -------------------------------------------- */

/**
 * One line that says what a ware is.
 * @param {Ware} ware
 * @param {object} i18n
 * @returns {string}
 */
function wareLine(ware, i18n) {
  const loc = (key) => i18n.localize(key);
  if ( ware.type !== "weapon" ) return ware.effect;
  const rank = `${loc("FEO.Weapon.rank")} ${loc(FEO.ranks[ware.rank] ?? "")}`;
  const parts = ware.staff
    ? [rank, `${loc("FEO.Weapon.rangeAbbr")} ${ware.range}`, `${loc("FEO.Weapon.weightAbbr")} ${ware.weight}`]
    : [rank, `${loc("FEO.Weapon.mightAbbr")} ${ware.might}`, `${loc("FEO.Weapon.hit")} ${ware.hit}`,
      `${loc("FEO.Weapon.critAbbr")} ${ware.crit}`, `${loc("FEO.Weapon.weightAbbr")} ${ware.weight}`,
      `${loc("FEO.Weapon.rangeAbbr")} ${ware.range}`];
  return parts.join(" · ");
}

/* -------------------------------------------- */

/**
 * A ware as a row of a plain list: the convoy, a pack, the forge's bench.
 * @param {Ware} ware
 * @param {object} i18n
 * @returns {object}
 */
function listRow(ware, i18n) {
  const { value, max } = ware.uses;
  return {
    id: ware.id,
    kind: ware.kind,
    icon: ware.icon,
    name: ware.name,
    meta: wareLine(ware, i18n),
    equipped: ware.equipped,
    uses: max > 0 ? `${value}/${max}` : "",
    pct: max > 0 ? Math.round(value / max * 100) : 0,
    hasUses: max > 0
  };
}

/* -------------------------------------------- */

/**
 * A unit's health as a bar.
 * @param {BaseUnit} unit
 * @returns {{value: number, max: number, pct: number, low: boolean}}
 */
function hpOf(unit) {
  const { value, max } = unit.hp;
  const pct = max > 0 ? Math.min(Math.max(Math.round(value / max * 100), 0), 100) : 0;
  return { value, max, pct, low: pct < 50 };
}

const subOf = (unit, i18n) => i18n.format("FEO.Base.unit.sub", { level: unit.level, cls: unit.cls || i18n.localize("FEO.Base.unit.noClass") });

/**
 * Who leads a unit in battle.
 * @param {BaseWorld} world
 * @param {BaseUnit} unit
 * @returns {{id: string, name: string, online: boolean}|null}   Null for the Game Master
 */
function leaderOf(world, unit) {
  const chosen = world.players.find((player) => player.id === unit.lead);
  return chosen ?? unit.player ?? null;
}

/**
 * The bonds of a unit that have reached a rank no conversation has been held at.
 * @param {BaseWorld} world
 * @param {BaseUnit|null} unit
 * @returns {number[]}    Their indexes
 */
function ripeBonds(world, unit) {
  if ( !unit ) return [];
  return unit.bonds.map((bond, index) => {
    const level = FEO.supportRanks[bond.rank]?.level ?? 0;
    return (level > 0) && (world.base.talked[`${unit.id}:${bond.uuid || bond.name}`] !== bond.rank) ? index : -1;
  }).filter((index) => index >= 0);
}

/* -------------------------------------------- */
/*  The Frame                                   */
/* -------------------------------------------- */

/**
 * The masthead: the name of the Base, who is visiting and what gold they carry.
 * @param {BaseWorld} world
 * @param {object} i18n
 * @returns {object}
 */
export function buildMasthead(world, i18n) {
  const visitor = world.visitor;
  return {
    name: world.base.name || i18n.localize("FEO.Base.title"),
    visitor: visitor ? { name: visitor.name, sub: subOf(visitor, i18n), icon: visitor.icon } : null,
    gold: visitor ? number(visitor.gold) : null,
    choice: world.visitors.length > 1
  };
}

/* -------------------------------------------- */

/**
 * The rail: the posts of the Base, and the battle the company marches to.
 * @param {BaseWorld} world
 * @param {{view: string}} ui
 * @param {object} i18n
 * @returns {object}
 */
export function buildRail(world, ui, i18n) {
  const { base, visitor, user } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const marching = world.company.filter((unit) => unit.marching).length;
  const ripe = ripeBonds(world, visitor).length;
  const notes = {
    camp: () => loc("post.camp.note"),
    roster: () => fmt("post.roster.note", { count: marching, limit: base.limit }),
    convoy: () => fmt("post.convoy.note", { count: base.convoy.length }),
    market: () => fmt("post.market.note", { count: base.shops.filter((shop) => shop.open).length }),
    forge: () => loc("post.forge.note"),
    supports: () => ripe ? fmt("post.supports.ripe", { count: ripe }) : fmt("post.supports.note", { count: visitor?.bonds.length ?? 0 }),
    training: () => visitor ? fmt("post.training.note", { count: boutsLeft(base, visitor.id) }) : loc("post.training.none"),
    board: () => fmt("post.board.note", { count: base.notices.length })
  };
  const flags = { roster: marching < base.limit, supports: ripe > 0 };
  const posts = Object.entries(FEO.base.posts).map(([id, post]) => {
    const closed = !!base.closed[id];
    return {
      id,
      icon: closed ? "lock" : post.icon,
      name: loc(`post.${id}.name`),
      note: closed ? loc("post.closed") : notes[id](),
      closed,
      flag: !closed && !!flags[id] && (ui.view !== id),
      selected: ui.view === id,
      toggle: user.isGM && (id !== "camp")
    };
  });

  // Who is ready: the players with a character in the company, or everyone at the table if there are none
  const withUnit = world.players.filter((player) => world.company.some((unit) => unit.player?.id === player.id));
  const table = withUnit.length ? withUnit : world.players;
  const ready = table.filter((player) => base.ready[player.id]).length;
  return {
    posts,
    isGM: user.isGM,
    march: {
      title: base.chapter.title || loc("march.next"),
      subtitle: base.chapter.subtitle,
      pips: table.map((player) => ({ on: !!base.ready[player.id], name: player.name })),
      readyText: fmt("march.ready", { count: ready, total: table.length }),
      mine: !!base.ready[user.id],
      canReady: !user.isGM
    }
  };
}

/* -------------------------------------------- */

/**
 * The plaque that names the post in view over the scene.
 * @param {BaseWorld} world
 * @param {{view: string}} ui
 * @param {object} i18n
 * @returns {object}
 */
export function buildPlaque(world, ui, i18n) {
  const camp = ui.view === "camp";
  return {
    icon: FEO.base.posts[ui.view]?.icon ?? "tent",
    eyebrow: camp ? (world.base.name || i18n.localize("FEO.Base.title")) : i18n.localize(`FEO.Base.post.${ui.view}.eyebrow`),
    title: i18n.localize(camp ? "FEO.Base.post.camp.title" : `FEO.Base.post.${ui.view}.name`),
    backdrop: world.base.backdrop,
    isGM: world.user.isGM
  };
}

/* -------------------------------------------- */

/**
 * What the keeper of a post says when a visitor arrives.
 * @param {BaseWorld} world
 * @param {{view: string, market?: {shop: string}}} ui
 * @param {object} i18n
 * @param {string} [post]     The post, when it is not the one in view
 * @returns {{name: string, icon: string, line: string}}
 */
export function keeperOf(world, ui, i18n, post = ui.view) {
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  if ( world.base.closed[post] ) {
    return { name: loc("keeper.camp"), icon: "lock", line: i18n.format("FEO.Base.line.closed", { post: loc(`post.${post}.name`) }) };
  }
  const shop = post === "market" ? world.base.shops.find((entry) => entry.id === ui.market?.shop) : null;
  return {
    name: shop?.keeper || loc(`keeper.${post}`),
    icon: shop?.icon ?? FEO.base.posts[post]?.icon ?? "tent",
    line: post === "camp" ? i18n.format("FEO.Base.line.camp", { name: world.base.name || loc("title") }) : loc(`line.${post}`)
  };
}

/* -------------------------------------------- */
/*  The Camp                                    */
/* -------------------------------------------- */

/**
 * The camp: who marches and how they fare, and what is worth doing tonight.
 * @param {BaseWorld} world
 * @param {object} i18n
 * @returns {object}
 */
export function buildCamp(world, i18n) {
  const { base, visitor } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const party = world.company.filter((unit) => unit.marching);
  const open = Math.max(base.limit - party.length, 0);
  const units = party.map((unit) => {
    const tags = [];
    if ( unit.fallen ) tags.push({ cls: "bane", text: loc("unit.fallen") });
    else if ( unit.injuries ) tags.push({ cls: "bane", text: loc("unit.injured") });
    else if ( unit.wounds ) tags.push({ cls: "bane", text: loc("unit.wounded") });
    if ( !unit.character ) tags.push({ cls: "boon", text: loc("unit.recruit") });
    else if ( base.ready[unit.player?.id] ) tags.push({ cls: "good", icon: "check", text: loc("unit.ready") });
    return {
      id: unit.id, name: unit.name, sub: subOf(unit, i18n), icon: unit.icon, hp: hpOf(unit), tags,
      me: unit.id === visitor?.id, gold: number(unit.gold)
    };
  });

  const closed = base.closed;
  const shortcuts = [];
  const add = (view, title, sub) => {
    if ( !closed[view] ) shortcuts.push({ view, icon: FEO.base.posts[view].icon, title, sub });
  };
  if ( open > 0 ) add("roster", fmt("camp.open", { count: open }), loc("camp.openSub"));
  const ripe = ripeBonds(world, visitor);
  if ( ripe.length ) {
    const bond = visitor.bonds[ripe[0]];
    add("supports", fmt("camp.talk", { name: bond.name || i18n.localize("FEO.Bond.unnamed") }),
      fmt("camp.talkSub", { rank: i18n.localize(FEO.supportRanks[bond.rank]?.label ?? "") }));
  }
  if ( visitor?.items.some((ware) => (ware.type === "weapon") && canForge(ware, ware.broken)) ) add("forge", loc("camp.forge"), loc("camp.forgeSub"));
  if ( visitor && (boutsLeft(base, visitor.id) > 0) && (party.length > 1) ) {
    add("training", fmt("camp.spar", { count: boutsLeft(base, visitor.id) }), loc("camp.sparSub"));
  }
  if ( base.notices.length ) add("board", fmt("camp.notices", { count: base.notices.length }), loc("camp.noticesSub"));
  if ( base.shops.some((shop) => shop.open && shop.stock.length) ) add("market", loc("camp.market"), loc("camp.marketSub"));

  return {
    units,
    count: fmt("camp.count", { count: party.length, limit: base.limit }),
    chapter: base.chapter.title,
    none: world.company.length ? loc("camp.noneMarching") : loc(world.user.isGM ? "camp.noCompanyGM" : "camp.noCompany"),
    shortcuts,
    forWhom: visitor ? fmt("camp.forWhom", { name: visitor.name }) : loc("camp.forNobody"),
    isGM: world.user.isGM
  };
}

/* -------------------------------------------- */
/*  The Roster                                  */
/* -------------------------------------------- */

/**
 * The roster: a card for every unit of the company and every one waiting at the gate.
 * @param {BaseWorld} world
 * @param {{muster: string, flipped: Set<string>}} ui
 * @param {object} i18n
 * @returns {object}
 */
export function buildRoster(world, ui, i18n) {
  const { base, user, visitor } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const party = world.company.filter((unit) => unit.marching);
  const waiting = world.company.filter((unit) => !unit.marching);
  const open = Math.max(base.limit - party.length, 0);
  const full = open <= 0;

  const sheet = (unit) => ({
    id: unit.id,
    img: unit.img,
    icon: unit.icon,
    name: unit.name,
    sub: subOf(unit, i18n),
    hp: hpOf(unit),
    stats: STAT_KEYS.map((key) => ({ label: i18n.localize(`FEO.Stat.${key}.abbr`), value: unit.stats[key] ?? 0 })),
    weapon: unit.weapon,
    flipped: ui.flipped.has(unit.id)
  });

  const card = (unit) => {
    const on = unit.marching;
    const away = unit.character && !unit.player?.online;
    const fixed = unit.character && !away && !user.isGM;
    const leader = leaderOf(world, unit);
    const handed = unit.character && !!leader && (leader.id !== unit.player?.id);
    const mayChoose = !unit.character || away || user.isGM || (unit.player?.id === user.id);

    let tag = unit.character ? unit.player.name : on ? (leader ? fmt("roster.ledBy", { name: leader.name }) : loc("roster.gm")) : loc("unit.recruit");
    if ( unit.character && on && handed ) tag = fmt("roster.ledBy", { name: leader.name });
    else if ( away ) tag = fmt("roster.away", { name: unit.player.name });

    const toggle = unit.fallen ? null
      : fixed ? { lock: true, title: fmt("roster.always", { name: unit.player.name }) }
        : on ? { action: "stand", on: true, title: fmt("roster.standTitle", { name: unit.name }) }
          : { action: "march", disabled: full, title: full ? loc("roster.full") : fmt("roster.marchTitle", { name: unit.name }) };
    const button = unit.fallen ? { label: loc("roster.cannot"), disabled: true }
      : fixed ? { label: loc("roster.alwaysShort"), disabled: true }
        : on ? { action: "stand", label: loc("roster.stand") }
          : { action: "march", label: loc(full ? "roster.full" : "roster.march"), gold: true, disabled: full };

    // Whoever may lead it: every player, here or away, and the Game Master
    const leads = on && mayChoose && (!unit.character || away || user.isGM) ? [
      ...world.players.map((player) => ({
        value: player.id,
        label: fmt("roster.ledBy", { name: player.online ? player.name : fmt("roster.awayName", { name: player.name }) }),
        selected: leader?.id === player.id
      })),
      { value: "", label: loc("roster.gm"), selected: !leader }
    ] : null;

    return {
      ...sheet(unit),
      mode: on ? "on" : "off",
      tag,
      tagAway: away && !(on && handed),
      band: unit.fallen ? loc("unit.fallen") : unit.injuries ? loc("unit.injured") : null,
      toggle,
      leads,
      button,
      dismiss: user.isGM && !unit.character
    };
  };

  const offer = (entry) => {
    const persuade = !entry.cost && !!entry.check;
    const poor = !visitor || (visitor.gold < entry.cost);
    return {
      ...sheet(entry.unit),
      mode: "gate",
      offer: entry.id,
      cost: entry.cost ? number(entry.cost) : null,
      tag: entry.cost ? null : persuade ? fmt("roster.checkTag", { check: entry.check }) : loc("roster.free"),
      chips: [entry.terms, entry.temp ? loc("roster.temp") : ""].filter(Boolean),
      button: persuade && !user.isGM
        ? { action: "hire", label: loc("roster.persuade"), gold: true, disabled: !visitor }
        : { action: "hire", label: entry.cost ? fmt("roster.recruitFor", { cost: number(entry.cost) }) : loc("roster.recruit"), gold: true, disabled: !visitor || (!!entry.cost && poor) },
      admit: user.isGM,
      withdraw: user.isGM
    };
  };

  const shown = (key) => (ui.muster === "all") || (ui.muster === key);
  const groups = [];
  if ( shown("marching") ) groups.push({
    key: "marching", title: loc("roster.marching"), note: fmt("roster.places", { count: party.length, limit: base.limit }),
    cards: party.map(card), blanks: Array.from({ length: open }, () => ({}))
  });
  if ( shown("waiting") ) groups.push({
    key: "waiting", title: loc("roster.waiting"), note: loc("roster.waitingNote"),
    cards: waiting.map(card), none: waiting.length ? null : loc("roster.noneWaiting")
  });
  if ( shown("gate") ) groups.push({
    key: "gate", title: loc("roster.gate"), note: loc("roster.gateNote"),
    cards: world.offers.map(offer), none: world.offers.length ? null : loc(user.isGM ? "roster.noneGateGM" : "roster.noneGate")
  });

  return {
    title: base.chapter.title ? fmt("roster.title", { chapter: base.chapter.title }) : loc("roster.titlePlain"),
    lead: fmt("roster.lead", { limit: base.limit }),
    kinds: [["all", loc("roster.all")], ["marching", loc("roster.marching")], ["waiting", loc("roster.waiting")],
      ["gate", fmt("roster.gateCount", { count: world.offers.length })]].map(([key, label]) => ({ key, label, pressed: ui.muster === key })),
    seats: world.players.map((player) => ({ name: player.online ? player.name : fmt("roster.awayName", { name: player.name }), away: !player.online })),
    count: party.length,
    countText: fmt("roster.countOf", { limit: base.limit }),
    limit: base.limit,
    full,
    groups,
    isGM: user.isGM
  };
}

/* -------------------------------------------- */
/*  The Convoy                                  */
/* -------------------------------------------- */

/**
 * The convoy: what the visitor carries on one side, and what is held for the company on the other.
 * @param {BaseWorld} world
 * @param {{convoy: string}} ui
 * @param {object} i18n
 * @returns {object}
 */
export function buildConvoy(world, ui, i18n) {
  const { base, visitor } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const held = base.convoy.map((entry) => wareOf(entry.data, entry.id));
  const counts = {};
  for ( const ware of held ) counts[ware.kind] = (counts[ware.kind] ?? 0) + 1;
  const kind = (ui.convoy === "all") || counts[ui.convoy] ? ui.convoy : "all";
  const kinds = [{ key: "all", label: loc("all"), count: held.length, pressed: kind === "all" },
    ...Object.entries(FEO.base.wares).filter(([key]) => counts[key]).map(([key, icon]) => ({
      key, icon, label: loc(`ware.${key}`), count: counts[key], pressed: kind === key
    }))];
  const rows = held.filter((ware) => (kind === "all") || (ware.kind === kind)).map((ware) => listRow(ware, i18n));
  return {
    visitor: !!visitor,
    packTitle: visitor ? fmt("convoy.pack", { name: visitor.name }) : loc("convoy.packNobody"),
    packCount: visitor ? fmt("convoy.carried", { count: visitor.items.length }) : "",
    pack: (visitor?.items ?? []).map((ware) => listRow(ware, i18n)),
    packNone: loc(visitor ? "convoy.nonePack" : "noVisitor"),
    heldCount: fmt("convoy.held", { count: held.length }),
    kinds,
    rows,
    heldNone: loc(held.length ? "convoy.noneKind" : "convoy.noneHeld"),
    isGM: world.user.isGM
  };
}

/* -------------------------------------------- */
/*  The Market                                  */
/* -------------------------------------------- */

/**
 * The market: the stalls, the ledger of the one in view or of what the visitor has to sell, and the ware
 * chosen from it.
 * @param {BaseWorld} world
 * @param {object} ui     The reader's choices at the market
 * @param {object} i18n
 * @returns {object}
 */
export function buildMarket(world, ui, i18n) {
  const { base, visitor, user } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const shop = base.shops.find((entry) => entry.id === ui.shop) ?? base.shops.find((entry) => entry.open) ?? base.shops[0] ?? null;
  const buying = (ui.mode !== "sell") || !visitor;
  const gold = visitor?.gold ?? 0;
  const who = visitor?.name ?? loc("market.visitor");

  // What is listed: the stall's stock, or what the visitor carries. A price is what the visitor pays: what its
  // skills and what it wears take off is taken off, and said on hover (see `discounted`)
  const discount = buying ? (visitor?.discount ?? 0) : 0;
  const cut = (listed) => {
    if ( !(discount > 0) ) return "";
    const parts = (visitor.discounts ?? []).map((entry) => `${entry.name} −${entry.percent}%`).join(", ");
    return fmt("market.discount", { parts, listed: number(listed) });
  };
  const source = buying
    ? (shop?.stock ?? []).map((entry) => {
      const ware = world.stock.get(entry.uuid);
      const listed = entry.price ?? ware?.cost ?? 0;
      return ware ? { ware: { ...ware, id: entry.id }, price: discounted(listed, discount), left: entry.left, cut: cut(listed) } : null;
    }).filter(Boolean)
    : visitor.items.map((ware) => ({ ware, price: worthOf(ware), left: null, cut: "" }));

  const query = (ui.query ?? "").trim().toLowerCase();
  const passing = source.filter(({ ware, price }) => (!query || ware.name.toLowerCase().includes(query))
    && (!buying || !ui.fit || ["fit", "any"].includes(fitOf(visitor, ware))) && (!buying || !ui.afford || (price <= gold)));
  const counts = {};
  for ( const { ware } of passing ) counts[ware.kind] = (counts[ware.kind] ?? 0) + 1;
  const kind = (ui.kind === "all") || source.some(({ ware }) => ware.kind === ui.kind) ? ui.kind : "all";
  const shown = passing.filter(({ ware }) => (kind === "all") || (ware.kind === kind));

  const ranks = Object.keys(FEO.ranks);
  const sorters = {
    name: ({ ware }) => ware.name,
    rank: ({ ware }) => ranks.indexOf(ware.rank),
    uses: ({ ware }) => buying ? ware.uses.max : ware.uses.value,
    cost: ({ price }) => price
  };
  if ( ui.sort ) {
    const read = sorters[ui.sort] ?? (({ ware }) => ware[ui.sort] ?? -1);
    shown.sort((a, b) => {
      const x = read(a);
      const y = read(b);
      return ((typeof x === "string" ? x.localeCompare(y) : x - y) * ui.dir) || a.ware.name.localeCompare(b.ware.name);
    });
  }

  const chosen = source.find(({ ware }) => ware.id === ui.ware) ?? shown[0] ?? source[0] ?? null;
  const cell = (value) => ({ value: value ?? "–", zero: !value });
  const row = ({ ware, price, left, cut: off }) => {
    const item = ware.type !== "weapon";
    return {
      cut: off ?? "",
      id: ware.id,
      kind: ware.kind,
      icon: ware.icon,
      name: ware.name,
      special: !item && !!ware.effect,
      effect: ware.effect,
      left: buying && (left !== null) ? fmt("market.left", { count: left }) : null,
      soldOut: buying && (left === 0),
      item,
      rank: item ? null : i18n.localize(FEO.ranks[ware.rank] ?? ""),
      fit: fitOf(visitor, ware),
      cells: item ? [] : [...(ware.staff ? [cell(null), cell(null), cell(null)] : [cell(ware.might), cell(ware.hit), cell(ware.crit)]), cell(ware.weight)],
      range: ware.range,
      uses: buying ? (ware.uses.max || "–") : (ware.uses.max ? ware.uses.value : "–"),
      price: number(price),
      poor: buying && (price > gold),
      selected: chosen?.ware.id === ware.id
    };
  };

  const groups = !shown.length ? []
    : ui.sort ? [{ rows: shown.map(row) }]
      : Object.entries(FEO.base.wares).filter(([key]) => shown.some(({ ware }) => ware.kind === key)).map(([key, icon]) => {
        const of = shown.filter(({ ware }) => ware.kind === key);
        return { kind: key, icon, label: loc(`ware.${key}`), count: of.length, rows: of.map(row) };
      });

  const column = (key, label, cls = "") => ({ key, label, cls, on: ui.sort === key, dir: ui.dir });
  const kinds = [{ key: "all", label: loc("all"), count: passing.length, pressed: kind === "all" },
    ...Object.entries(FEO.base.wares).filter(([key]) => source.some(({ ware }) => ware.kind === key)).map(([key, icon]) => ({
      key, icon, label: loc(`ware.${key}`), count: counts[key] ?? 0, pressed: kind === key
    }))];

  return {
    setup: !base.shops.length,
    isGM: user.isGM,
    stalls: base.shops.map((entry) => ({
      id: entry.id, name: entry.name, icon: entry.open ? entry.icon : "lock", pressed: entry.id === shop?.id, shut: !entry.open,
      note: entry.open ? fmt("market.wares", { count: entry.stock.length }) : loc("post.closed"),
      disabled: !entry.open && !user.isGM
    })),
    shop: shop ? { id: shop.id, name: shop.name, keeper: shop.keeper, open: shop.open } : null,
    buying,
    canSell: !!visitor,
    query: ui.query ?? "",
    placeholder: loc(buying ? "market.find" : "market.findPack"),
    kinds,
    fit: !!ui.fit,
    afford: !!ui.afford,
    fitLabel: fmt("market.fit", { name: who }),
    columns: [
      column("name", loc(buying ? "market.ware" : "market.carried"), "l"),
      column("rank", loc("market.rank"), "c"),
      column("might", i18n.localize("FEO.Weapon.mightAbbr")),
      column("hit", i18n.localize("FEO.Weapon.hit")),
      column("crit", i18n.localize("FEO.Weapon.critAbbr")),
      column("weight", i18n.localize("FEO.Weapon.weightAbbr")),
      { label: i18n.localize("FEO.Weapon.rangeAbbr") },
      column("uses", i18n.localize("FEO.Weapon.uses")),
      column("cost", loc(buying ? "market.price" : "market.fetches"))
    ],
    groups,
    none: source.length ? loc("market.noneMatch") : loc(buying ? (user.isGM ? "market.noneStockGM" : "market.noneStock") : "market.nonePack"),
    legend: { fit: fmt("market.legendFit", { name: who }), other: fmt("market.legendOther", { name: who }) },
    shown: fmt("market.shown", { count: shown.length, total: source.length }),
    ware: chosen ? buildWare(world, ui, chosen, { buying, shop }, i18n) : null
  };
}

/* -------------------------------------------- */

/**
 * The ware chosen from a ledger, set out beside it.
 * @param {BaseWorld} world
 * @param {object} ui
 * @param {{ware: Ware, price: number, left: number|null, cut?: string}} chosen    `cut`: what was taken off the
 *                                                price for this visitor, in words
 * @param {{buying: boolean, shop: object|null}} options
 * @param {object} i18n
 * @returns {object}
 */
function buildWare(world, ui, { ware, price, left, cut = "" }, { buying, shop }, i18n) {
  const { visitor, user } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const who = visitor?.name ?? loc("market.visitor");
  const gold = visitor?.gold ?? 0;
  const armed = (ware.type === "weapon") && !ware.staff;
  const held = armed && buying ? visitor?.items.find((item) => item.equipped && (item.type === "weapon") && !item.staff) ?? null : null;
  const fit = fitOf(visitor, ware);

  const delta = (key) => {
    if ( !held ) return null;
    const by = ware[key] - held[key];
    if ( !by ) return { text: loc("market.same") };
    return { text: `${by > 0 ? "+" : "−"}${Math.abs(by)}`, cls: ((key === "weight") ? (by < 0) : (by > 0)) ? "up" : "down" };
  };
  const labels = { might: "FEO.Weapon.mightAbbr", hit: "FEO.Weapon.hit", crit: "FEO.Weapon.critAbbr", weight: "FEO.Weapon.weightAbbr" };
  const stats = ware.type !== "weapon" ? [] : [
    ...LEDGER_STATS.map((key) => ({
      label: i18n.localize(labels[key]), value: ware.staff && (key !== "weight") ? "–" : ware[key], delta: delta(key)
    })),
    { label: i18n.localize("FEO.Weapon.rangeAbbr"), value: ware.range || "–", delta: null }
  ];

  const kindName = loc(`wareOne.${ware.kind}`);
  const rank = ware.rank ? i18n.localize(FEO.ranks[ware.rank] ?? "") : "";
  const verdict = fit === "fit" ? { cls: "good", icon: "check", text: fmt("market.canWield", { name: who }) }
    : fit === "unfit" ? { cls: "bane", text: fmt("market.needsRank", { kind: kindName, rank }) }
      : fit === "other" ? { cls: "", text: fmt("market.notTheirs", { name: who }) }
        : { cls: "good", icon: "check", text: loc("market.anyone") };
  const users = ware.type === "weapon" ? world.company.filter((unit) => fitOf(unit, ware) === "fit")
    .map((unit) => ({ name: unit.name, me: unit.id === visitor?.id })) : [];

  const most = Math.max(Math.min(left ?? FEO.base.buyMost, FEO.base.buyMost), 1);
  const quantity = Math.min(Math.max(ui.quantity ?? 1, 1), most);
  const total = price * quantity;
  return {
    id: ware.id,
    kind: ware.kind,
    icon: ware.icon,
    name: ware.name,
    sub: [rank ? fmt("market.kindRank", { kind: kindName, rank }) : kindName,
      ware.uses.max ? fmt("market.uses", { count: buying ? ware.uses.max : `${ware.uses.value}/${ware.uses.max}` }) : ""].filter(Boolean).join(" · "),
    verdict,
    note: ware.effect || (ware.type === "weapon" ? fmt("market.plain", { kind: kindName.toLowerCase(), rank }) : ""),
    left: buying && (left !== null) ? fmt("market.onlyLeft", { count: left }) : null,
    stats,
    versus: held ? fmt("market.versus", { name: who, weapon: held.name }) : null,
    users,
    buying,
    quantity,
    fewer: quantity <= 1,
    more: quantity >= most,
    toConvoy: ui.dest === "convoy",
    destPack: fmt("market.toPack", { name: who }),
    buyLabel: left === 0 ? loc("market.soldOut") : fmt("market.buyFor", { total: number(total) }),

    // What was taken off the price for this visitor, where anything was
    cut,
    sellLabel: fmt("market.sellFor", { gold: number(price) }),
    goldLeft: number(gold - total),
    short: total > gold,
    total: number(total),
    canBuy: !!visitor && (total <= gold) && (left !== 0) && !!shop?.open,
    soldOut: left === 0,
    forge: armed && buying && !world.base.closed.forge,
    usesLeft: fmt("market.usesLeft", { value: ware.uses.value, max: ware.uses.max }),
    hasUses: ware.uses.max > 0,
    goldAfter: number(gold + price),
    worth: number(price),
    uuid: ware.uuid,
    gm: user.isGM && buying
  };
}

/* -------------------------------------------- */
/*  The Forge                                   */
/* -------------------------------------------- */

/**
 * The forge: the visitor's weapons on the bench, and the one being tempered.
 * @param {BaseWorld} world
 * @param {{item: string|null, steps: object|null, name: string|null}} ui
 * @param {object} i18n
 * @returns {object}
 */
export function buildForge(world, ui, i18n) {
  const { visitor } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const weapons = (visitor?.items ?? []).filter((ware) => ware.type === "weapon");
  const fit = weapons.filter((ware) => canForge(ware, ware.broken));
  const ware = fit.find((entry) => entry.id === ui.item) ?? fit[0] ?? null;
  const bench = weapons.map((entry) => ({
    ...listRow(entry, i18n),
    selected: entry.id === ware?.id,
    barred: !canForge(entry, entry.broken),
    forged: !!entry.forged && (forgeCount(entry.forged).count > 0)
  }));
  if ( !ware ) {
    return {
      bench,
      benchLead: visitor ? fmt("forge.benchLead", { name: visitor.name }) : "",
      none: loc(!visitor ? "noVisitor" : weapons.length ? "forge.noneFit" : "forge.noneWeapons")
    };
  }

  const from = forgeSteps(ware.forged);
  const to = forgeSteps((ui.item === ware.id) && ui.steps ? ui.steps : from);
  const stats = forgedStats(ware, from, to);
  const price = forgePrice(from, to);
  const { max } = FEO.base.forge;
  const rows = Object.keys(FEO.base.forge.stats).map((key) => {
    const steps = to[key];
    const changed = stats[key] !== ware[key];
    return {
      key,
      label: i18n.localize(`FEO.Weapon.${key}`),
      was: ware[key],
      now: stats[key],
      changed,
      cls: !changed ? "" : ((key === "weight") ? (stats[key] < ware[key]) : (stats[key] > ware[key])) ? "up" : "down",
      fewer: steps <= -max,
      more: steps >= max,
      pips: Array.from({ length: (max * 2) + 1 }, (_, index) => {
        const at = index - max;
        if ( at === 0 ) return { mid: true };
        return { cls: (steps > 0) && (at > 0) && (at <= steps) ? "up" : (steps < 0) && (at < 0) && (at >= steps) ? "down" : "" };
      }),
      cost: price.byStat[key] ? number(price.byStat[key]) : null
    };
  });
  const { count, most } = forgeCount(to);
  const gold = visitor.gold;
  const name = (ui.item === ware.id) && (ui.name !== null) && (ui.name !== undefined) ? ui.name : ware.name;
  const stepped = Object.keys(to).some((key) => to[key] !== from[key]);
  const touched = stepped || (!!name.trim() && (name.trim() !== ware.name));
  return {
    bench,
    benchLead: fmt("forge.benchLead", { name: visitor.name }),
    ware: { id: ware.id, kind: ware.kind, name, was: ware.name },
    stepped,
    rows,
    count,
    most,
    total: number(price.total),
    goldLeft: number(gold - price.total),
    short: price.total > gold,
    canStrike: touched && (price.total <= gold),
    strikes: fmt("forge.strikes", { count, most })
  };
}

/* -------------------------------------------- */
/*  Supports                                    */
/* -------------------------------------------- */

/**
 * Supports: the visitor's bonds, how far each has come and what it gives.
 * @param {BaseWorld} world
 * @param {object} i18n
 * @returns {object}
 */
export function buildSupports(world, i18n) {
  const { visitor, user, base } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  const method = FEO.supports.method;
  const ranks = Object.keys(FEO.supportRanks);
  const ripe = new Set(ripeBonds(world, visitor));

  const gives = (bonus) => Object.entries(FEO.supportBoosts)
    .filter(([key]) => bonus?.[key])
    .map(([key, label]) => `${i18n.localize(label)} +${bonus[key]}`).join(", ");

  const bonds = (visitor?.bonds ?? []).map((bond, index) => {
    const partner = world.company.find((unit) => bond.uuid && (unit.uuid === bond.uuid)) ?? null;
    const at = ranks.indexOf(bond.rank);
    const needed = pointsForNext(bond.rank, method);
    const floor = method === "chapters" ? (FEO.supports.chapters.thresholds[bond.rank] ?? 0) : 0;
    const next = ranks[at + 1];
    const progress = (needed === null) ? null : {
      pct: Math.min(Math.max(Math.round((bond.points - floor) / Math.max(needed - floor, 1) * 100), 0), 100),
      text: fmt(`supports.progress.${method}`, {
        points: bond.points, needed, rank: i18n.localize(FEO.supportRanks[next]?.label ?? "")
      })
    };
    const given = gives(bond.bonus);
    const kin = FEO.supports.bondAdjacent;
    return {
      index,
      name: bond.name || i18n.localize("FEO.Bond.unnamed"),
      icon: partner?.icon ?? "heart",
      sub: partner ? subOf(partner, i18n) : loc("supports.offRoster"),
      affinities: [FEO.affinityIcons[visitor.affinity], FEO.affinityIcons[bond.affinity]].filter(Boolean),
      kin: !!bond.kin,
      ladder: ranks.map((rank, step) => ({
        label: i18n.localize(FEO.supportRanks[rank].label), cls: step === at ? "now" : step < at ? "won" : ""
      })),
      progress,
      ripe: ripe.has(index),
      gives: given ? fmt("supports.gives", { range: FEO.supportRange, bonus: given }) : loc("supports.nothingYet"),
      kinGives: bond.kin ? fmt("supports.kinGives", { hit: kin.hit, dodge: kin.dodge, crit: kin.critical }) : null,
      canRaise: user.isGM && !!next,
      canLower: user.isGM && (at > 0)
    };
  });

  const bonded = new Set((visitor?.bonds ?? []).map((bond) => bond.uuid).filter(Boolean));
  const names = new Set((visitor?.bonds ?? []).map((bond) => String(bond.name ?? "").trim().toLowerCase()));
  return {
    visitor: !!visitor,
    who: visitor?.name ?? "",
    icon: visitor?.icon ?? "shield",
    bonds,
    none: loc(visitor ? "supports.none" : "noVisitor"),
    method: i18n.localize(FEO.supports.methods[method] ?? ""),
    limit: loc("supports.limit"),
    candidates: !visitor ? [] : world.company.filter((unit) => (unit.id !== visitor.id) && !bonded.has(unit.uuid)
      && !names.has(unit.name.trim().toLowerCase())).map((unit) => ({ id: unit.id, name: unit.name })),
    isGM: user.isGM,
    closed: !!base.closed.supports
  };
}

/* -------------------------------------------- */
/*  The Training Grounds                        */
/* -------------------------------------------- */

/**
 * The training grounds: the visitor, whoever they face, and what the bout is worth.
 * @param {BaseWorld} world
 * @param {{foe: string|null, healer: string}} ui
 * @param {object} i18n
 * @returns {object}
 */
export function buildTraining(world, ui, i18n) {
  const { visitor, base } = world;
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  const fmt = (key, data) => i18n.format(`FEO.Base.${key}`, data);
  if ( !visitor ) return { none: loc("noVisitor") };

  const fighter = (unit, foe = false) => {
    const left = boutsLeft(base, unit.id);
    return {
      id: unit.id, name: unit.name, sub: subOf(unit, i18n), icon: unit.icon, foe,
      weapon: unit.weapon ?? { name: loc("training.unarmed"), icon: "fist" },
      pips: Array.from({ length: base.bouts }, (_, index) => ({ on: index < left })),
      left: fmt("training.left", { count: left }),
      spent: left < 1
    };
  };
  const rivals = world.company.filter((unit) => (unit.id !== visitor.id) && unit.marching);
  const able = (unit) => !unit.fallen && (boutsLeft(base, unit.id) > 0);
  const foe = rivals.find((unit) => (unit.id === ui.foe) && able(unit)) ?? rivals.find(able) ?? null;

  // Whoever in the company carries a staff with a use left can stand by
  const healers = [{ value: "", label: loc("training.noHealer") }];
  for ( const unit of world.company ) {
    for ( const ware of unit.items ) {
      if ( !ware.staff || ware.broken || ((ware.uses.max > 0) && (ware.uses.value < 1)) ) continue;
      healers.push({
        value: `${unit.id}:${ware.id}`,
        label: fmt("training.healer", { name: unit.name, staff: ware.name, uses: ware.uses.max ? `${ware.uses.value}/${ware.uses.max}` : "∞" })
      });
    }
  }
  const healer = healers.some((entry) => entry.value === ui.healer) ? ui.healer : "";
  for ( const entry of healers ) entry.selected = entry.value === healer;

  const stake = (unit, other) => unit.earns
    ? fmt("training.stake", { name: unit.name, win: sparExp(unit.level, other.level, false), lose: sparExp(unit.level, other.level, true) })
    : fmt("training.noStake", { name: unit.name });
  return {
    lead: fmt("training.lead", { name: visitor.name }),
    me: fighter(visitor),
    foe: foe ? fighter(foe, true) : null,
    rivals: rivals.map((unit) => ({
      id: unit.id, name: unit.name, icon: unit.icon, pressed: unit.id === foe?.id, disabled: !able(unit),
      note: unit.fallen ? loc("unit.fallen") : boutsLeft(base, unit.id) < 1 ? loc("training.spentShort") : ""
    })),
    noRivals: loc("training.noRivals"),
    stakes: foe ? [stake(visitor, foe), stake(foe, visitor)] : [],
    bonus: fmt("training.bonus", { amount: FEO.base.spar.loser }),
    healers,
    canBegin: !!foe && able(visitor),
    limit: fmt("training.limit", { count: base.bouts })
  };
}

/* -------------------------------------------- */
/*  The Notice Board                            */
/* -------------------------------------------- */

/**
 * The notice board: what the Game Master has pinned to it.
 * @param {BaseWorld} world
 * @param {object} i18n
 * @returns {object}
 */
export function buildBoard(world, i18n) {
  const loc = (key) => i18n.localize(`FEO.Base.${key}`);
  return {
    notices: world.base.notices.map((notice) => ({
      id: notice.id, title: notice.title, text: notice.text, tags: notice.tags,
      action: notice.action || loc("board.join")
    })),
    canJoin: !!world.visitor,
    none: loc(world.user.isGM ? "board.noneGM" : "board.none"),
    isGM: world.user.isGM
  };
}

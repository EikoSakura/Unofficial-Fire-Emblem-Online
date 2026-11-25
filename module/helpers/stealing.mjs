import { FEO } from "../config.mjs";
import { bestPick, canSteal, craftable, craftsAlone, goldFrom, lootOf, pickings } from "../rules/stealing.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { unitsOn } from "./battle-map.mjs";
import { awardGold, pop, spendFor } from "./events.mjs";
import { tokenTile } from "./exchange.mjs";
import { onMap, relationTo } from "./forced.mjs";
import { takeAction } from "./phases.mjs";
import { isPlayerUnit } from "./players.mjs";
import { SUMMONED_FLAG } from "./weapons.mjs";

/**
 * Stealing and loot in Foundry (see `rules/stealing.mjs`): the Steal command of the battle map, what skills
 * take from a foe once a fight is over or as it falls, a foe made to put down what it holds, and the items a
 * skill has its unit make as a battle begins.
 *
 * A weapon or an item changes hands as a copy: it is made in the pack of the unit that takes it and deleted
 * from the pack it was in. A player who steals from a unit that is not theirs asks a Game Master to do that.
 */

/** The name of the query that asks a Game Master to have something change hands for a player. */
export const STEAL_QUERY = `${FEO.id}.steal`;

/** The name of the query that has a player pick the items a unit of theirs makes as a battle begins. */
export const CRAFT_QUERY = `${FEO.id}.craft`;

/** The flag, on an item, that marks it as made by a skill for one battle: the skill's name. */
export const CRAFTED_FLAG = "crafted";

/** The world setting for the gold a unit steals from an enemy that carries none. */
export const GOLD_SETTING = "stolenGold";

/** The name of the world setting for the most Gold a skill gives in a map at the moments of a turn. */
export const TURN_GOLD_SETTING = "turnGoldMost";

/** The name of the hook called once something was stolen: with the thief's token, the other's, and what. */
export const STOLEN_HOOK = `${FEO.id}.unitStolen`;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * Register the world's settings for gold: what is stolen from a foe that carries none, and the most a skill
 * such as Income gives in a map.
 */
export function registerSettings() {
  game.settings.register(FEO.id, GOLD_SETTING, {
    name: "FEO.Setting.stolenGold.name",
    hint: "FEO.Setting.stolenGold.hint",
    scope: "world",
    config: true,
    type: Number,
    default: FEO.stealing.gold,
    onChange: (value) => {
      FEO.stealing.gold = Math.max(Math.trunc(Number(value) || 0), 0);
    }
  });
  FEO.stealing.gold = Math.max(Math.trunc(Number(game.settings.get(FEO.id, GOLD_SETTING)) || 0), 0);

  // The most Gold one skill gives its unit in a map at the moments of its turns, as Income does
  game.settings.register(FEO.id, TURN_GOLD_SETTING, {
    name: "FEO.Setting.turnGoldMost.name",
    hint: "FEO.Setting.turnGoldMost.hint",
    scope: "world",
    config: true,
    type: Number,
    default: FEO.earnings.turnGoldMost,
    onChange: (value) => {
      FEO.earnings.turnGoldMost = Math.max(Math.trunc(Number(value) || 0), 0);
    }
  });
  FEO.earnings.turnGoldMost = Math.max(Math.trunc(Number(game.settings.get(FEO.id, TURN_GOLD_SETTING)) || 0), 0);
}

/* -------------------------------------------- */

/**
 * A unit's pack as the rules of stealing read it: its weapons and items, each with whether it is in hand,
 * worn, or never changes hands.
 * @param {Actor|null} actor
 * @returns {(import("../rules/stealing.mjs").PackItem & {img: string, uses: string})[]}
 */
export function packOf(actor) {
  const pack = [];
  for ( const item of actor?.items ?? [] ) {
    if ( !["weapon", "gear"].includes(item.type) ) continue;
    const system = item.system;
    const shield = (item.type === "gear") && !!system.isShield;
    const uses = system.uses ?? { value: 0, max: 0 };
    pack.push({
      id: item.id,
      name: item.name,
      img: item.img,
      type: item.type,
      weight: (item.type === "weapon") ? (system.weight ?? 0) : 0,
      equipped: (item.type === "weapon") ? !!system.equipped : (shield && !!system.equipped),

      // An accessory is worn while it is equipped, one at a time; one that is only carried can be taken
      worn: (item.type === "gear") && !!system.equip && !shield && (!system.isAccessory || !!system.equipped),
      bound: !!item.getFlag(FEO.id, SUMMONED_FLAG),
      cost: system.cost ?? 0,
      uses: (uses.max > 0) ? `${uses.value}/${uses.max}` : ""
    });
  }
  return pack;
}

/* -------------------------------------------- */

/**
 * A unit as the rules of stealing read the one that takes.
 * @param {TokenDocument} token
 * @returns {{steals: boolean, spd: number, str: number, tile: object|null}}
 */
function thiefOf(token) {
  const system = token.actor.system;
  const stats = system.statValues ?? {};
  const tile = tokenTile(token);
  return { steals: !!system.knacks?.steals, spd: stats.spd ?? 0, str: stats.str ?? 0, tile: tile ? { i: tile.i, j: tile.j } : null };
}

/**
 * A unit as the rules of stealing read the one that is taken from.
 * @param {TokenDocument} token       The unit that would take
 * @param {TokenDocument} target
 * @returns {object}
 */
function victimOf(token, target) {
  const system = target.actor.system;
  const tile = tokenTile(target);
  return {
    spd: system.statValues?.spd ?? 0,
    tile: tile ? { i: tile.i, j: tile.j } : null,
    relation: relationTo(token, target),
    rules: system.skills?.rules ?? [],
    out: !!system.defeat?.out,
    gold: system.gold ?? 0,
    items: packOf(target.actor)
  };
}

/* -------------------------------------------- */

/**
 * Try a Steal of one unit from another, as they stand: whether it may, and what of the other's pack it could
 * take.
 * @param {TokenDocument} token       The unit that steals
 * @param {TokenDocument} target      The unit it would steal from
 * @returns {import("../rules/stealing.mjs").StealTry|null}     Null for two units that are not both on one map
 */
export function stealOf(token, target) {
  if ( !onMap(token) || !target?.actor || (token === target) || (token.parent !== target.parent) || !tokenTile(target) ) return null;
  return canSteal(thiefOf(token), victimOf(token, target));
}

/* -------------------------------------------- */

/**
 * The units next to a unit, each with what a Steal from it would come to.
 * @param {TokenDocument} token
 * @returns {{target: TokenDocument, tried: import("../rules/stealing.mjs").StealTry}[]}
 */
export function stealsOf(token) {
  if ( !onMap(token) || !token.actor.system.knacks?.steals ) return [];
  const here = tokenTile(token);
  const found = [];
  for ( const other of unitsOn(token.parent) ) {
    if ( (other.token === token) || (tilesApart(here, other.tile) !== 1) ) continue;
    const tried = stealOf(token, other.token);
    if ( tried ) found.push({ target: other.token, tried });
  }
  return found;
}

/* -------------------------------------------- */

/**
 * The pack of a unit as a list to pick from: each item with what it is, and greyed with the reason where it
 * cannot be taken.
 * @param {(import("../rules/stealing.mjs").PackItem & {ok: boolean, why: string|null, img?: string, uses?: string})[]} items
 * @returns {{id: string, label: string, hint: string, img: string, end: string, disabled: boolean, tip: string}[]}
 */
export function packOptions(items) {
  const i18n = game.i18n;
  return (items ?? []).map((item) => ({
    id: item.id,
    label: item.name,
    img: item.img ?? "",
    hint: item.ok
      ? ((item.type === "weapon") ? i18n.format("FEO.Steal.weapon", { weight: item.weight ?? 0 }) : i18n.localize("FEO.Steal.item"))
      : i18n.format(`FEO.Steal.kept.${item.why}`, { weight: item.weight ?? 0 }),
    end: item.uses ?? "",
    disabled: !item.ok,
    tip: item.ok ? "" : i18n.format(`FEO.Steal.keptTip.${item.why}`, { weight: item.weight ?? 0 })
  }));
}

/* -------------------------------------------- */
/*  Changing Hands                              */
/* -------------------------------------------- */

/**
 * Have a Game Master do something for a player who may not change every unit in it.
 * @param {object} data
 * @returns {Promise<*>}
 */
async function ask(data) {
  const gm = game.users.activeGM;
  if ( !gm ) return null;
  try {
    return await gm.query(STEAL_QUERY, data, { timeout: 15000 });
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * A weapon or an item goes from one unit's pack into another's.
 * @param {Actor} from
 * @param {string} itemId
 * @param {Actor} to
 * @returns {Promise<string|null>}    The name of what changed hands, or null when nothing did
 */
export async function handOver(from, itemId, to) {
  if ( (from?.type !== "unit") || (to?.type !== "unit") || (from === to) ) return null;
  if ( !from.isOwner || !to.isOwner ) return ask({ op: "hand", from: from.uuid, item: itemId, to: to.uuid });
  const item = from.items.get(itemId);
  if ( !item || !["weapon", "gear"].includes(item.type) ) return null;

  // A weapon a creature was handed changes hands in no way, and nothing goes into or out of a pack that is
  // locked (see `helpers/creatures.mjs`)
  const { packBar } = await import("./creatures.mjs");
  if ( packBar(from, item) || packBar(to) ) return null;
  const data = item.toObject();
  delete data._id;
  if ( "equipped" in data.system ) data.system.equipped = false;
  await to.createEmbeddedDocuments("Item", [data]);
  await item.delete();
  return data.name;
}

/* -------------------------------------------- */

/**
 * Put an item of the Items tab into a unit's pack, by its name.
 * @param {Actor} actor
 * @param {string} name
 * @param {object} [options]
 * @param {string} [options.uuid]           Where the item is found, where that is known
 * @param {number|null} [options.uses]      The uses it has, where they are not the item's own
 * @param {string} [options.crafted]        The skill that made it for this battle
 * @returns {Promise<string|null>}          Its name, or null when no such item was found
 */
export async function giveItem(actor, name, { uuid = "", uses = null, crafted = "" } = {}) {
  if ( actor?.type !== "unit" ) return null;
  if ( !actor.isOwner ) return ask({ op: "give", to: actor.uuid, name, uses, crafted });
  const { findItem } = await import("./classes.mjs");
  const known = uuid ? await foundry.utils.fromUuid(uuid) : null;
  const source = ["weapon", "gear"].includes(known?.type) ? known : ((await findItem("gear", name)) ?? (await findItem("weapon", name)));
  if ( !source ) return null;
  const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
  delete data._id;
  if ( "equipped" in data.system ) data.system.equipped = false;
  if ( Number.isInteger(uses) && (uses > 0) && data.system.uses ) data.system.uses = { value: uses, max: uses };
  if ( crafted ) data.flags = { ...(data.flags ?? {}), [FEO.id]: { ...(data.flags?.[FEO.id] ?? {}), [CRAFTED_FLAG]: crafted } };
  await actor.createEmbeddedDocuments("Item", [data]);
  return data.name;
}

/* -------------------------------------------- */

/**
 * A unit puts down what it holds: the weapon in its hand and the Shield it has equipped are in its pack, not
 * equipped.
 * @param {Actor} actor
 * @returns {Promise<string[]>}     The names of what it put down
 */
export async function putDown(actor) {
  if ( actor?.type !== "unit" ) return [];
  if ( !actor.isOwner ) return (await ask({ op: "putDown", actor: actor.uuid })) ?? [];
  const held = actor.items.filter((item) => {
    if ( !item.system.equipped ) return false;
    return (item.type === "weapon") || ((item.type === "gear") && item.system.isShield);
  });
  if ( !held.length ) return [];
  await actor.updateEmbeddedDocuments("Item", held.map((item) => ({ _id: item.id, "system.equipped": false })));
  return held.map((item) => item.name);
}

/* -------------------------------------------- */

/**
 * Gold goes from one unit to another: the one that takes it gains it, and the other loses what of it was its
 * own.
 * @param {Actor} thief
 * @param {Actor} victim
 * @param {number|"foe"} amount
 * @returns {Promise<number>}       What the thief gained
 */
export async function takeGold(thief, victim, amount) {
  if ( (thief?.type !== "unit") || (victim?.type !== "unit") ) return 0;
  if ( !thief.isOwner || !victim.isOwner ) return (await ask({ op: "gold", thief: thief.uuid, victim: victim.uuid, amount })) ?? 0;
  const taken = goldFrom(amount, { gold: victim.system.gold ?? 0 }, FEO.stealing.gold);
  if ( !(taken.amount > 0) ) return 0;
  if ( taken.carried ) await victim.update({ "system.gold": Math.max((victim.system.gold ?? 0) - taken.amount, 0) });
  return awardGold(thief, taken.amount);
}

/* -------------------------------------------- */

/**
 * Answer a player's request to have something change hands. Runs for a Game Master.
 * @param {object} data
 * @returns {Promise<*>}
 */
export async function stealQuery(data = {}) {
  if ( !game.user.isGM ) return null;
  const unit = async (uuid) => {
    const found = ((typeof uuid === "string") && uuid) ? await foundry.utils.fromUuid(uuid) : null;
    return ((found?.documentName === "Actor") && (found.type === "unit")) ? found : null;
  };
  const token = async (uuid) => {
    const found = ((typeof uuid === "string") && uuid) ? await foundry.utils.fromUuid(uuid) : null;
    return (found?.documentName === "Token") ? found : null;
  };
  try {
    switch ( data.op ) {
      case "hand": {
        const [from, to] = [await unit(data.from), await unit(data.to)];
        return (from && to && (typeof data.item === "string")) ? handOver(from, data.item, to) : null;
      }
      case "give": {
        const to = await unit(data.to);
        if ( !to || (typeof data.name !== "string") ) return null;
        return giveItem(to, data.name, { uses: Number.isInteger(data.uses) ? data.uses : null, crafted: (typeof data.crafted === "string") ? data.crafted : "" });
      }
      case "putDown": {
        const actor = await unit(data.actor);
        return actor ? putDown(actor) : [];
      }
      case "gold": {
        const [thief, victim] = [await unit(data.thief), await unit(data.victim)];
        const amount = (data.amount === "foe") ? "foe" : (Number.isInteger(data.amount) && (data.amount > 0) && (data.amount <= 99999)) ? data.amount : null;
        return (thief && victim && (amount !== null)) ? takeGold(thief, victim, amount) : 0;
      }
      case "steal": {
        const [thief, target] = [await token(data.thief), await token(data.target)];
        return (thief && target && (typeof data.item === "string")) ? steal(thief, target, data.item) : false;
      }
      case "loot": {
        const [by, foe] = [await token(data.by), await token(data.foe)];
        return (by?.actor && foe?.actor && Array.isArray(data.entries)) ? lootFoe(by, foe, data.entries) : false;
      }
      default: return null;
    }
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */
/*  The Steal Command                           */
/* -------------------------------------------- */

/**
 * Take an item out of a unit's pack by the rules of Steal, which are asked again.
 * @param {TokenDocument} token
 * @param {TokenDocument} target
 * @param {string} itemId
 * @returns {Promise<boolean>}
 */
async function steal(token, target, itemId) {
  const tried = stealOf(token, target);
  const item = tried?.items.find((entry) => entry.id === itemId);
  if ( !tried?.ok || !item?.ok ) return false;
  const name = await handOver(target.actor, itemId, token.actor);
  if ( !name ) return false;
  pop(token.actor, [{ text: game.i18n.format("FEO.Steal.took", { item: name }), tone: "gold" }]);
  Hooks.callAll(STOLEN_HOOK, token, target, { item: name });
  return true;
}

/* -------------------------------------------- */

/**
 * A unit Steals a weapon or an item from an enemy next to it. It is the unit's Action. Whatever keeps it from
 * stealing is said instead.
 * @param {TokenDocument} token       The unit that steals
 * @param {TokenDocument} target      The enemy next to it
 * @param {string} itemId             What it takes
 * @returns {Promise<boolean>}        Whether it took it
 */
export async function stealUnit(token, target, itemId) {
  const actor = token?.actor;
  const tried = stealOf(token, target);
  const name = target?.name || target?.actor?.name || "";
  if ( !tried?.ok ) {
    ui.notifications.warn(game.i18n.format(`FEO.Steal.blocked.${tried?.why ?? "apart"}`, { name }));
    return false;
  }
  const item = tried.items.find((entry) => entry.id === itemId);
  if ( !item?.ok ) {
    if ( item ) ui.notifications.warn(game.i18n.format(`FEO.Steal.keptTip.${item.why}`, { weight: item.weight ?? 0 }));
    return false;
  }
  const done = (actor.isOwner && target.actor.isOwner)
    ? await steal(token, target, itemId)
    : !!(await ask({ op: "steal", thief: token.uuid, target: target.uuid, item: itemId }));
  if ( !done ) {
    ui.notifications.warn(game.i18n.format("FEO.Steal.failed", { name }));
    return false;
  }
  await takeAction(actor, token, { action: { kind: "steal" } });
  return true;
}

/* -------------------------------------------- */
/*  Loot                                        */
/* -------------------------------------------- */

/**
 * Roll a die of so many faces.
 * @param {number} faces
 * @returns {number}
 */
function die(faces) {
  return Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * faces) + 1;
}

/* -------------------------------------------- */

/**
 * Have the Game Master pick the item a unit gains from a fallen foe, or none. Without one at the table, and
 * where none answers in time, a die picks among the items that could be stolen.
 * @param {TokenDocument} by
 * @param {TokenDocument} foe
 * @param {string} skill
 * @param {object[]} items      The foe's pack, each with whether it could be stolen
 * @returns {Promise<string|null>}    The item picked, by its id
 */
async function gmPicks(by, foe, skill, items) {
  const open = items.filter((item) => item.ok);
  const random = () => (open.length ? open[die(open.length) - 1].id : null);
  if ( !items.length ) return null;
  if ( !game.user.isGM ) return random();
  const { DialogV2 } = foundry.applications.api;
  const encode = foundry.utils.escapeHTML ?? ((text) => String(text));
  const names = { name: by.name || by.actor.name, foe: foe.name || foe.actor.name, skill };
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const end = (value) => {
      if ( done ) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const dialog = new DialogV2({
      window: { title: skill },
      content: `<p>${encode(game.i18n.format("FEO.Loot.gmPick", names))}</p>`,
      buttons: [
        ...items.map((item, index) => ({ action: `item${index}`, label: item.name, callback: () => item.id })),
        { action: "none", label: "FEO.Loot.gmNone", default: true, callback: () => "" }
      ],
      submit: (result) => end(result || null),
      rejectClose: false
    });
    dialog.addEventListener("close", () => end(null), { once: true });
    timer = setTimeout(() => {
      end(random());
      dialog.close().catch(() => {});
    }, FEO.stealing.ask);
    dialog.render({ force: true }).catch((err) => {
      console.error(err);
      end(random());
    });
  });
}

/* -------------------------------------------- */

/**
 * Have whoever acts for a unit pick the item it takes from a foe's pack, of those that could be stolen. A unit
 * that answers by itself takes the one that costs the most.
 * @param {TokenDocument} by
 * @param {TokenDocument} foe
 * @param {string} skill
 * @param {object[]} items
 * @returns {Promise<string|null>}
 */
async function ownerPicks(by, foe, skill, items) {
  const open = items.filter((item) => item.ok);
  if ( !open.length ) return null;
  try {
    const { answersAlone, askFor } = await import("./answers.mjs");
    if ( answersAlone(by.actor) ) return bestPick(items)?.id ?? null;
    const point = {
      index: 0, on: "take", side: "initiator", attack: null,
      about: game.i18n.format("FEO.Loot.pick", { foe: foe.name || foe.actor.name }),
      offers: open.map((item) => ({ key: item.id, skill, id: null, what: "take", item: { name: item.name, img: item.img ?? "" }, hint: item.uses ?? "" }))
    };
    return await askFor({ token: by, actor: by.actor }, point, foe.name || foe.actor.name, { alone: false });
  } catch(err) {
    console.error(err);
    return bestPick(items)?.id ?? null;
  }
}

/* -------------------------------------------- */

/**
 * A unit takes from a foe what its skills have it take: gold, an item by name, one of the foe's own, or what
 * a die picks of those. Nothing of the foe's own is taken from a unit that nothing is stolen from. What it
 * gains floats over the unit.
 * @param {TokenDocument} by          The unit whose skills take
 * @param {TokenDocument} foe
 * @param {{skill: string, id?: string, on?: string, loot: object}[]} entries     As a fight or a kill reports
 *                                    them
 * @returns {Promise<boolean>}        Whether anything was gained
 */
export async function lootFoe(by, foe, entries = []) {
  const actor = by?.actor;
  const victim = foe?.actor;
  if ( (actor?.type !== "unit") || (victim?.type !== "unit") || !entries.length ) return false;
  if ( !actor.isOwner || !victim.isOwner ) {
    const plain = entries.map((entry) => ({ skill: entry.skill, id: entry.id ?? null, on: entry.on ?? "", loot: entry.loot }));
    return !!(await ask({ op: "loot", by: by.uuid, foe: foe.uuid, entries: plain }));
  }
  const i18n = game.i18n;
  const guarded = (victim.system.skills?.rules ?? []).includes("unstolen");
  let gained = false;
  for ( const entry of entries ) {
    try {
      const { gives, roll, faces } = lootOf(entry.loot, die);
      const lines = [{ text: roll ? `${entry.skill}: ${i18n.format("FEO.Loot.die", { faces, roll })}` : entry.skill, tone: "skill" }];
      let name = null;

      // Gold: what the foe carries, or what the world gives for one that carries none
      if ( gives.gold !== undefined ) {
        if ( guarded && (gives.gold === "foe") ) continue;
        pop(actor, lines);
        if ( (await takeGold(actor, victim, gives.gold)) > 0 ) gained = true;
        continue;
      }

      // One item of the foe's pack that could be stolen, which the unit's owner picks; the skill is used only
      // once one is taken
      if ( gives.steal ) {
        const items = pickings({ str: actor.system.statValues?.str ?? 0 }, { rules: victim.system.skills?.rules ?? [], items: packOf(victim) });
        const picked = await ownerPicks(by, foe, entry.skill, items);
        if ( picked && items.some((item) => (item.id === picked) && item.ok) ) name = await handOver(victim, picked, actor);
        if ( name && entry.id ) await spendFor(actor, entry.id);
      }

      // One of the foe's own, which the Game Master picks or keeps
      else if ( gives.item === "foe" ) {
        const items = pickings({ str: Infinity }, { rules: victim.system.skills?.rules ?? [], items: packOf(victim) });
        const picked = await gmPicks(by, foe, entry.skill, items);
        if ( picked && items.some((item) => item.id === picked) ) name = await handOver(victim, picked, actor);
      }

      // An item of the Items tab
      else if ( gives.item ) name = await giveItem(actor, gives.item);
      if ( !name ) {
        if ( roll ) pop(actor, lines);
        continue;
      }
      gained = true;
      pop(actor, [...lines, { text: i18n.format("FEO.Steal.took", { item: name }), tone: "gold" }]);
      Hooks.callAll(STOLEN_HOOK, by, foe, { item: name, skill: entry.skill });
    } catch(err) {
      console.error(err);
    }
  }
  return gained;
}

/* -------------------------------------------- */

/**
 * A fight is over: what the skills of its two units take from each other is taken, and a unit a skill made
 * put down its weapon and its Shield has.
 * @param {{loot?: object[], disarmed?: object[]}} told         What the fight left to do
 * @param {{initiator: TokenDocument|null, defender: TokenDocument|null}} tokens
 * @returns {Promise<void>}
 */
export async function afterFight(told, tokens) {
  const other = (side) => (side === "initiator") ? "defender" : "initiator";
  for ( const entry of told?.disarmed ?? [] ) {
    const unit = tokens[entry.side]?.actor;
    if ( !unit || unit.system.defeat?.out ) continue;
    try {
      const names = await putDown(unit);
      if ( names.length ) pop(unit, [{ text: game.i18n.format("FEO.Disarm.down", { items: names.join(", ") }), tone: "damage" }]);
    } catch(err) {
      console.error(err);
    }
  }
  for ( const side of ["initiator", "defender"] ) {
    const entries = (told?.loot ?? []).filter((entry) => entry.by === side);
    if ( !entries.length || !tokens[side]?.actor || !tokens[other(side)]?.actor ) continue;
    await lootFoe(tokens[side], tokens[other(side)], entries);
  }
}

/* -------------------------------------------- */
/*  Items Made as a Battle Begins               */
/* -------------------------------------------- */

/**
 * The items of the Items tab a skill may have its unit make: those of the sections it names, each with its
 * cost.
 * @param {string[]} folders
 * @returns {Promise<(import("../rules/stealing.mjs").Craftable & {uuid: string, img: string})[]>}
 */
export async function craftWares(folders) {
  const wanted = new Set((folders ?? []).map((name) => name.toLowerCase()));
  const wares = [];
  for ( const pack of game.packs ) {
    if ( (pack.documentName !== "Item") || (pack.metadata.packageName !== FEO.id) ) continue;
    const sections = new Map(pack.folders.map((folder) => [folder.id, folder.name]));
    if ( ![...sections.values()].some((name) => wanted.has(name.toLowerCase())) ) continue;
    const index = await pack.getIndex({ fields: ["system.cost", "system.effect", "folder"] });
    for ( const entry of index ) {
      const folder = sections.get(entry.folder?._id ?? entry.folder) ?? "";
      if ( (entry.type !== "gear") || !wanted.has(folder.toLowerCase()) ) continue;
      wares.push({ id: entry._id, uuid: entry.uuid, name: entry.name, img: entry.img ?? "", cost: entry.system?.cost ?? 0, folder, effect: entry.system?.effect ?? "" });
    }
  }
  return wares.sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------- */

/**
 * What a unit has made with its skill for this battle, and what it may still make.
 * @param {Actor} actor
 * @param {object[]} [wares]      The items it may make, where they are known
 * @returns {{crafts: object|null, made: {name: string, cost: number}[], open: object[], left: number, room: number}}
 */
export function craftState(actor, wares = []) {
  const crafts = actor?.system.knacks?.crafts ?? null;
  const made = (actor?.items ?? []).filter((item) => item.getFlag(FEO.id, CRAFTED_FLAG)).map((item) => ({ name: item.name, cost: item.system.cost ?? 0 }));
  if ( !crafts ) return { crafts, made, open: [], left: 0, room: 0 };
  return { crafts, made, ...craftable(crafts, wares, made) };
}

/* -------------------------------------------- */

/**
 * Make one item for a unit with its skill: it has the uses the skill gives it, 1 at least, and is marked as
 * made by the skill.
 * @param {Actor} actor
 * @param {object} crafts
 * @param {{name: string, uuid: string}} ware
 * @returns {Promise<string|null>}
 */
async function craft(actor, crafts, ware) {
  return giveItem(actor, ware.name, { uuid: ware.uuid, uses: Math.max(crafts.uses, 1), crafted: crafts.skill });
}

/* -------------------------------------------- */

/**
 * Have this user pick the items a unit makes with its skill: the Compendium opens at the items of the first
 * section the skill names, each with a button while it still fits, and says above them what is left. An item
 * is made as it is picked; closing the window ends the picking.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Was the Compendium opened?
 */
export async function openCrafts(actor) {
  const crafts = actor?.system.knacks?.crafts;
  if ( !crafts || !actor.isOwner ) return false;
  const wares = await craftWares(crafts.folders);
  if ( !wares.length ) return false;
  const i18n = game.i18n;
  const number = (value) => Number(value ?? 0).toLocaleString("en-US");
  const now = () => craftState(actor, wares);
  const describe = (entry) => {
    const ware = wares.find((other) => other.uuid === entry.uuid);
    return { sold: !!ware, can: !!ware && now().open.some((other) => other.uuid === entry.uuid), fit: true, unfit: "" };
  };
  const choose = async (entry) => {
    const ware = now().open.find((other) => other.uuid === entry.uuid);
    if ( ware ) await craft(actor, crafts, ware);
  };
  const banner = () => {
    const state = now();
    return {
      text: i18n.format("FEO.Craft.banner", { unit: actor.name, skill: crafts.skill }),

      // What the button beside each item says, in place of buying it
      button: i18n.localize("FEO.Craft.make"),
      tags: [
        { label: i18n.localize("FEO.Craft.items"), value: i18n.format("FEO.Craft.itemsValue", { made: state.made.length, most: crafts.items }) },
        { label: i18n.localize("FEO.Craft.cost"), value: i18n.format("FEO.Craft.costValue", { left: number(state.left), total: number(crafts.cost) }) },
        { label: i18n.localize("FEO.Craft.uses"), value: String(Math.max(crafts.uses, 1)) }
      ],
      note: state.made.length
        ? i18n.format("FEO.Craft.made", { items: state.made.map((item) => item.name).join(", ") })
        : i18n.localize("FEO.Craft.note")
    };
  };
  const { default: Compendium } = await import("../apps/compendium.mjs");
  const library = await Compendium.library();
  const wanted = new Set(crafts.folders.map((name) => name.toLowerCase()));
  const group = (library.gearGroups ?? []).find((other) => wanted.has(String(other.name ?? "").toLowerCase()));
  await Compendium.open({
    view: "equipment", tab: "items", type: group?.key ?? "all",
    chooser: { takes: "equipment", actor: actor.uuid, describe, choose, banner }
  });
  return true;
}

/* -------------------------------------------- */

/**
 * Answer a Game Master's request to have this user pick the items a unit of theirs makes.
 * @param {{actor?: string}} data
 * @returns {Promise<boolean>}
 */
export async function craftQuery({ actor: uuid } = {}) {
  const actor = ((typeof uuid === "string") && uuid) ? await foundry.utils.fromUuid(uuid) : null;
  if ( (actor?.documentName !== "Actor") || !actor.isOwner ) return false;
  return openCrafts(actor);
}

/* -------------------------------------------- */

/**
 * A unit makes its items by itself: the costliest that fit, while one does.
 * @param {Actor} actor
 * @returns {Promise<string[]>}       The names of what it made
 */
export async function craftAlone(actor) {
  const crafts = actor?.system.knacks?.crafts;
  if ( !crafts || !actor.isOwner ) return [];
  const wares = await craftWares(crafts.folders);
  const state = craftState(actor, wares);
  const left = { ...crafts, cost: state.left, items: state.room };
  const made = [];
  for ( const ware of craftsAlone(left, wares) ) {
    const name = await craft(actor, crafts, ware);
    if ( name ) made.push(name);
  }
  if ( made.length ) pop(actor, [{ text: crafts.skill, tone: "skill" }, ...made.map((text) => ({ text, tone: "gold" }))]);
  return made;
}

/* -------------------------------------------- */

/**
 * A battle begins: every unit in it whose skill makes items makes them. A unit no player owns makes the
 * costliest that fit by itself; for any other, whoever acts for it has the Compendium opened to pick them.
 * Runs for the user who begins the encounter.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleCrafts(combat) {
  const seen = new Set();
  let opened = false;
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor.uuid) || !actor.system.knacks?.crafts ) continue;
    seen.add(actor.uuid);
    if ( actor.items.some((item) => item.getFlag(FEO.id, CRAFTED_FLAG)) ) continue;
    try {
      if ( !isPlayerUnit(actor) ) {
        await craftAlone(actor);
        continue;
      }
      const { actsFor } = await import("./rescue.mjs");
      const user = actsFor(actor);
      if ( user && (user !== game.user) ) user.query(CRAFT_QUERY, { actor: actor.uuid }, { timeout: 15000 }).catch((err) => console.error(err));

      // One window at a time on this client: the first unit's opens, and the others are named
      else if ( !opened ) opened = await openCrafts(actor);
      else ui.notifications.info(game.i18n.format("FEO.Craft.later", { unit: actor.name, skill: actor.system.knacks.crafts.skill }));
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */

/**
 * A battle is over: what a unit's skills made for it is gone from its pack, used or not, whoever made it.
 * @param {Actor} actor
 * @returns {Promise<number>}     How many items went
 */
export async function endBattleCrafts(actor) {
  if ( (actor?.type !== "unit") || !actor.isOwner ) return 0;
  const made = actor.items.filter((item) => item.getFlag(FEO.id, CRAFTED_FLAG)).map((item) => item.id);
  if ( made.length ) await actor.deleteEmbeddedDocuments("Item", made);
  return made.length;
}

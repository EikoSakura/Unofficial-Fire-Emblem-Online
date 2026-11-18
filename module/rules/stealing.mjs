/**
 * Stealing, loot and what skills make of gear. Pure functions of plain data, so that they can be tested
 * outside of Foundry.
 *
 * Steal is a command, as Shove and Rescue are, but not one every unit has: a skill or an item gives it. A unit
 * that has it takes one weapon or item out of the pack of an enemy next to it, as its Action. Its SPD must be
 * higher than that enemy's; what the enemy has equipped stays with it; and a weapon that weighs more than the
 * unit's STR is too heavy to take.
 *
 * What a unit's skills let it do with gear and with the things that stand on a map are parts of an effect that
 * are always there, as `shove` and `carry` are. They are added up into the unit's knacks:
 *
 *   steal: { use: true }        // its unit has the Steal command
 *   opens: ["door", "chest"]    // it opens these without a key (see `objects.mjs`)
 *   disarms: true               // it disarms the traps and mines it walks over
 *   pillages: true              // it can destroy Villages
 *   discount: 25                // what it buys in a shop costs it this many percent less
 *   outfit: 10                  // what it buys as its starting equipment, as it is created, costs it this
 *                               // many percent less
 *   resale: 10                  // what it sells brings it this many percent more
 *   crafts: { items: 2, cost: 1000, folders: ["Buffing Items", "Combat Items"], uses: { of: "dex", div: 10 } }
 *                               // as a map starts it makes up to so many items of those sections of the Items
 *                               // tab, of that total cost at most, each with that many uses; they are gone as
 *                               // the map ends
 *
 * Two rules say whom nothing is taken from:
 *
 *   rules: ["unstolen"]         // nothing is stolen from its unit: not by Steal, not by a skill in a fight
 *   rules: ["uncaptured"]       // its unit cannot be captured
 *
 * And in a fight a skill takes from the foe at a moment of it, a hit or a kill, with a `loot` part, or has the
 * foe put down what it holds with `unequips`:
 *
 *   { proc: { on: "hit", stat: "dex", once: true }, loot: { gold: "foe", once: "foe" } }
 *                               // gold from the foe: what it carries, or what the world gives for a foe that
 *                               // carries none; `once: "foe"`: one time for each enemy on a map
 *   { proc: { on: "kill", stat: "luk" }, loot: { item: "Bullion" } }       // an item of that name
 *   { proc: { on: "kill", stat: "luk" }, loot: { item: "foe" } }           // one of the foe's own items,
 *                               // which the Game Master picks, or keeps
 *   { proc: { on: "kill", stat: "luk" }, loot: { dice: 3, of: [{ item: "foe" }, { gold: "foe" }, { item: "Bullion" }] } }
 *                               // a die of so many faces picks one of them
 *   { proc: { on: "hit", sure: true }, loot: { steal: true } }
 *                               // one item of the foe's pack that could be stolen, which the unit's owner
 *                               // picks once the fight is over; passing takes nothing and uses nothing
 *   { proc: { on: "attack", stat: "dex" }, unequips: true }
 *                               // once the attack has landed the foe puts down its weapon and its Shield: it
 *                               // makes no further attack in that fight and blocks nothing more
 *
 * And `amplify: 50` on an attack has what the weapon's Effect does count for half as much again: the chance it
 * inflicts a condition at, rounded down (see `amplified`), and the turns that condition lasts, rounded up.
 */
import { FEO } from "../config.mjs";
import { tilesApart } from "./reach.mjs";
import { addLaid, checkLaid, emptyLaid } from "./traps.mjs";

/** The rule that keeps anything from being stolen from a unit. */
export const UNSTOLEN = "unstolen";

/** The rule that keeps a unit from being captured. */
export const UNCAPTURED = "uncaptured";

/** The parts of an effect that are a unit's knacks. */
export const KNACK_KEYS = ["steal", "opens", "disarms", "pillages", "discount", "outfit", "resale", "crafts", "laid"];

/** The knacks that are a share of a price, each with the list that says where it comes from. */
const SHARES = { discount: "discounts", outfit: "outfits", resale: "resales" };

/** What a `crafts` part can say. */
export const CRAFT_PARTS = ["items", "cost", "folders", "uses"];

/** What a `loot` part can say. */
export const LOOT_PARTS = ["gold", "item", "steal", "dice", "of", "once"];

/** The moments of a fight a skill can take something from the foe at. */
export const LOOT_MOMENTS = ["hit", "kill"];

/** What a unit can open without a key. */
export const OPENABLE = ["door", "chest"];

/* -------------------------------------------- */
/*  Knacks                                      */
/* -------------------------------------------- */

/**
 * @typedef Knacks
 * What a unit's skills and gear let it do with gear and with the things that stand on a map.
 * @property {boolean} steals           Does it have the Steal command?
 * @property {string[]} opens           What it opens without a key: "door", "chest"
 * @property {boolean} disarms          Does it disarm the traps and mines it walks over?
 * @property {boolean} pillages         Can it destroy Villages?
 * @property {number} discount          What it buys in a shop costs it this many percent less
 * @property {{name: string, percent: number}[]} discounts    Where that comes from, for whoever shows it
 * @property {number} outfit            What it buys as its starting equipment costs it this many percent less
 * @property {{name: string, percent: number}[]} outfits
 * @property {number} resale            What it sells brings it this many percent more
 * @property {{name: string, percent: number}[]} resales
 * @property {{skill: string, items: number, cost: number, folders: string[], uses: number}|null} crafts
 *                                      What it makes as a map starts
 * @property {{mines: number, turns: number, exp: number, kill: number, skill: string}} laid
 *                                      What its skills add to the mines and traps it lays (see `traps.mjs`)
 * @property {{steals: string, opens: string, disarms: string, pillages: string}} skills    What gives it each
 */

/**
 * The knacks of a unit without any.
 * @returns {Knacks}
 */
export function emptyKnacks() {
  return {
    steals: false, opens: [], disarms: false, pillages: false, discount: 0, discounts: [], outfit: 0, outfits: [], resale: 0, resales: [], crafts: null,

    // What its skills add to the mines and traps it lays (see `traps.mjs`)
    laid: emptyLaid(),
    skills: { steals: "", opens: "", disarms: "", pillages: "" }
  };
}

/* -------------------------------------------- */

/**
 * Add what one effect gives to a unit's knacks.
 * @param {Knacks} total
 * @param {object} effect             An effect of a skill, or what an item gives
 * @param {object} [options]
 * @param {string} [options.skill]    What it comes from
 * @param {(value: any) => number} [options.number]   Reads a number that may be read from the unit
 * @returns {Knacks}                  `total`, changed
 */
export function addKnacks(total, effect, { skill = "", number = (value) => Number(value) || 0 } = {}) {
  if ( effect?.steal?.use && !total.steals ) {
    total.steals = true;
    total.skills.steals = skill;
  }
  for ( const kind of [].concat(effect?.opens ?? []) ) {
    if ( !OPENABLE.includes(kind) || total.opens.includes(kind) ) continue;
    total.opens.push(kind);
    total.skills.opens ||= skill;
  }
  if ( effect?.disarms && !total.disarms ) {
    total.disarms = true;
    total.skills.disarms = skill;
  }
  if ( effect?.pillages && !total.pillages ) {
    total.pillages = true;
    total.skills.pillages = skill;
  }

  if ( effect?.laid ) addLaid(total.laid ??= emptyLaid(), effect.laid, { skill, number });

  // Discounts stack: each is so many percent of the price, and together they never take all of it. So do
  // what is taken off starting equipment, and what is added to what its unit sells for
  for ( const [key, list] of Object.entries(SHARES) ) {
    const percent = Math.max(Math.trunc(number(effect?.[key] ?? 0)), 0);
    if ( !(percent > 0) ) continue;
    (total[list] ??= []).push({ name: skill, percent });
    total[key] = (key === "resale") ? (total[key] ?? 0) + percent : Math.min((total[key] ?? 0) + percent, FEO.stealing.discountMost);
  }

  // Of several skills that make items, the one that makes the most is used
  const crafts = effect?.crafts;
  if ( crafts && (typeof crafts === "object") ) {
    const made = {
      skill,
      items: Math.max(Math.trunc(number(crafts.items ?? 0)), 0),
      cost: Math.max(Math.trunc(number(crafts.cost ?? 0)), 0),
      folders: [].concat(crafts.folders ?? []).map(String),
      uses: Math.max(Math.floor(number(crafts.uses ?? 0)), 0)
    };
    if ( (made.items > 0) && (!total.crafts || (made.cost > total.crafts.cost) || (made.items > total.crafts.items)) ) total.crafts = made;
  }
  return total;
}

/* -------------------------------------------- */

/**
 * What is wrong with the knacks an effect names, in plain words.
 * @param {object} effect
 * @returns {string[]}
 */
export function checkKnacks(effect) {
  const problems = [];
  if ( effect?.laid !== undefined ) problems.push(...checkLaid(effect.laid));
  if ( effect?.steal !== undefined ) {
    if ( !effect.steal || (typeof effect.steal !== "object") || (effect.steal.use !== true) || (Object.keys(effect.steal).length !== 1) ) {
      problems.push('"steal" says { use: true }');
    }
  }
  if ( effect?.opens !== undefined ) {
    const list = [].concat(effect.opens);
    if ( !Array.isArray(effect.opens) || !list.length || list.some((kind) => !OPENABLE.includes(kind)) ) {
      problems.push(`"opens" is a list of ${OPENABLE.map((kind) => `"${kind}"`).join(" and ")}`);
    }
  }
  for ( const key of ["disarms", "pillages"] ) {
    if ( (effect?.[key] !== undefined) && (effect[key] !== true) ) problems.push(`"${key}" is true`);
  }
  for ( const key of Object.keys(SHARES) ) {
    if ( effect?.[key] === undefined ) continue;
    const plain = Number.isFinite(effect[key]) && (effect[key] > 0) && (effect[key] <= 100);
    if ( !plain && !(effect[key] && (typeof effect[key] === "object")) ) problems.push(`"${key}" is a share of the price in percent, from 1 to 100`);
  }
  if ( effect?.crafts !== undefined ) {
    const crafts = effect.crafts;
    if ( !crafts || (typeof crafts !== "object") ) problems.push('"crafts" says how many items of what cost it makes');
    else {
      for ( const key of Object.keys(crafts) ) if ( !CRAFT_PARTS.includes(key) ) problems.push(`"crafts" cannot say "${key}"`);
      if ( !(Number.isInteger(crafts.items) && (crafts.items > 0)) ) problems.push('"crafts.items" is how many items it makes');
      if ( !(Number.isInteger(crafts.cost) && (crafts.cost > 0)) ) problems.push('"crafts.cost" is the most they cost together');
      if ( !Array.isArray(crafts.folders) || !crafts.folders.length ) problems.push('"crafts.folders" names the sections of the Items tab they come from');
      if ( crafts.uses === undefined ) problems.push('"crafts.uses" is how many uses each has');
    }
  }
  return problems;
}

/**
 * Does a unit disarm a trap it walks onto, and by which of its skills? A trap that is disarmed is gone: it
 * neither stops the unit nor strikes it.
 * @param {Knacks|null} knacks
 * @returns {string|null}     The skill, or null for a unit that springs the trap
 */
export function disarmerOf(knacks) {
  return knacks?.disarms ? (knacks.skills?.disarms || "") : null;
}

/* -------------------------------------------- */
/*  What an Item Gives                          */
/* -------------------------------------------- */

/**
 * What an item that is worn gives its unit, read from its Effect as the Items tab words it: the Steal command
 * ("Unit can use the Steal action."), a discount ("Unit receives a 25% discount in Shops.").
 * @param {string} effect
 * @returns {object|null}     An effect of knacks, or null for an item that gives none
 */
export function gearKnacks(effect) {
  const text = String(effect ?? "");
  const out = {};
  if ( /\bcan use the Steal action\b/i.test(text) ) out.steal = { use: true };
  const discount = /\b(\d{1,3})\s*%\s*discount in shops\b/i.exec(text);
  if ( discount ) out.discount = Math.min(Number(discount[1]), 100);
  return Object.keys(out).length ? out : null;
}

/* -------------------------------------------- */

/**
 * What a key opens, read from its Effect as the Items tab words it ("Opens a chest.", "Opens a chest or door.").
 * @param {string} effect
 * @returns {string[]}      "door", "chest", or both; empty for an item that is no key
 */
export function keyOpens(effect) {
  const found = /^\s*Opens an? ((?:chest|door)(?:\s*(?:or|and|,)\s*(?:an? )?(?:chest|door))*)\s*\.?\s*$/i.exec(String(effect ?? ""));
  if ( !found ) return [];
  return OPENABLE.filter((kind) => new RegExp(`\\b${kind}\\b`, "i").test(found[1]));
}

/* -------------------------------------------- */
/*  The Price of a Ware                         */
/* -------------------------------------------- */

/**
 * What a ware costs a unit with a discount: so many percent less, rounded down, and never less than nothing.
 * @param {number} price
 * @param {number} [discount]   In percent
 * @returns {number}
 */
export function discounted(price, discount = 0) {
  const cut = Math.min(Math.max(discount ?? 0, 0), 100);
  return Math.max(Math.floor(((price ?? 0) * (100 - cut)) / 100), 0);
}

/* -------------------------------------------- */

/**
 * What a unit is paid for something it sells: so many percent more than it is worth, rounded down.
 * @param {number} worth        What it sells for (see `sellValue` in `progression.mjs`)
 * @param {number} [resale]     In percent
 * @returns {number}
 */
export function resold(worth, resale = 0) {
  return Math.max(Math.floor(((worth ?? 0) * (100 + Math.max(resale ?? 0, 0))) / 100), 0);
}

/* -------------------------------------------- */
/*  Steal                                       */
/* -------------------------------------------- */

/**
 * @typedef PackItem
 * A weapon or an item in a unit's pack, as the rules of stealing read it.
 * @property {string} id
 * @property {string} name
 * @property {"weapon"|"gear"} type
 * @property {number} [weight]          The Weight of a weapon
 * @property {boolean} [equipped]       Is it in hand: the weapon the unit holds, the Shield it has equipped?
 * @property {boolean} [worn]           Is it an item that is worn for its effect, as an accessory is?
 * @property {boolean} [bound]          Can it never change hands, as a weapon a unit was summoned with?
 * @property {number} [cost]
 */

/**
 * May a unit take this item from the unit that carries it?
 * @param {PackItem} item
 * @param {{str: number}} thief
 * @returns {{ok: boolean, why: "equipped"|"worn"|"heavy"|"bound"|null}}
 */
export function stealable(item, thief) {
  if ( item?.bound ) return { ok: false, why: "bound" };
  if ( item?.equipped ) return { ok: false, why: "equipped" };
  if ( item?.worn ) return { ok: false, why: "worn" };
  if ( (item?.type === "weapon") && ((item.weight ?? 0) > (thief?.str ?? 0)) ) return { ok: false, why: "heavy" };
  return { ok: true, why: null };
}

/* -------------------------------------------- */

/**
 * @typedef StealTry
 * @property {boolean} ok               May the unit steal from this one?
 * @property {"cannot"|"apart"|"side"|"out"|"guarded"|"speed"|"empty"|"nothing"|null} why     Why not
 * @property {(PackItem & {ok: boolean, why: string|null})[]} items       Its pack, each item with whether it
 *                                      can be taken; empty where the unit may not steal from it at all
 */

/**
 * May a unit Steal from another, and what?
 * @param {object} thief
 * @param {boolean} thief.steals              Does it have the Steal command?
 * @param {number} thief.spd
 * @param {number} thief.str
 * @param {{i: number, j: number}|null} [thief.tile]
 * @param {object} target
 * @param {number} target.spd
 * @param {{i: number, j: number}|null} [target.tile]
 * @param {"friend"|"foe"|"apart"} target.relation    How the unit stands to it
 * @param {Iterable<string>|null} [target.rules]      The rules its skills give it
 * @param {boolean} [target.out]                      Is it out of the fight?
 * @param {PackItem[]} [target.items]
 * @returns {StealTry}
 */
export function canSteal(thief, target) {
  const no = (why) => ({ ok: false, why, items: [] });
  if ( !thief?.steals ) return no("cannot");
  if ( target?.out ) return no("out");
  if ( thief.tile && target?.tile && (tilesApart(thief.tile, target.tile) !== 1) ) return no("apart");
  if ( target?.relation !== "foe" ) return no("side");
  if ( new Set(target.rules ?? []).has(UNSTOLEN) ) return no("guarded");
  if ( !((thief.spd ?? 0) > (target.spd ?? 0)) ) return no("speed");
  const items = (target.items ?? []).map((item) => ({ ...item, ...stealable(item, thief) }));
  if ( !items.length ) return { ok: false, why: "empty", items };
  if ( !items.some((item) => item.ok) ) return { ok: false, why: "nothing", items };
  return { ok: true, why: null, items };
}

/* -------------------------------------------- */

/**
 * What a skill takes from the foe's pack in a fight: the items of it that could be stolen. Neither the test of
 * SPD nor standing next to the foe is asked, which are the Steal command's; a foe nothing is stolen from keeps
 * everything.
 * @param {{str: number}} thief
 * @param {{rules?: Iterable<string>|null, items?: PackItem[]}} target
 * @returns {(PackItem & {ok: boolean, why: string|null})[]}
 */
export function pickings(thief, target) {
  if ( new Set(target?.rules ?? []).has(UNSTOLEN) ) return [];
  return (target?.items ?? []).map((item) => ({ ...item, ...stealable(item, thief) }));
}

/* -------------------------------------------- */

/**
 * The item a unit that answers by itself takes, of those it may: the one that costs the most.
 * @param {(PackItem & {ok: boolean})[]} items
 * @returns {PackItem|null}
 */
export function bestPick(items) {
  return (items ?? []).filter((item) => item.ok).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0] ?? null;
}

/* -------------------------------------------- */
/*  Loot                                        */
/* -------------------------------------------- */

/**
 * What is wrong with a `loot` part, in plain words.
 * @param {object} loot
 * @param {string} [on]     The moment it waits for
 * @returns {string[]}
 */
export function checkLoot(loot, on = "") {
  const problems = [];
  if ( !loot || (typeof loot !== "object") ) return ['"loot" says what is taken from the foe'];
  if ( on && !LOOT_MOMENTS.includes(on) ) problems.push(`"loot" is taken on a ${LOOT_MOMENTS.map((moment) => `"${moment}"`).join(" or a ")}`);
  for ( const key of Object.keys(loot) ) if ( !LOOT_PARTS.includes(key) ) problems.push(`"loot" cannot say "${key}"`);
  const one = (entry, at) => {
    const said = ["gold", "item", "steal"].filter((key) => entry?.[key] !== undefined);
    if ( said.length !== 1 ) problems.push(`${at} says one of "gold", "item" and "steal"`);
    if ( (entry?.gold !== undefined) && (entry.gold !== "foe") && !(Number.isInteger(entry.gold) && (entry.gold > 0)) ) problems.push(`${at}: "gold" is "foe" or an amount`);
    if ( (entry?.item !== undefined) && ((typeof entry.item !== "string") || !entry.item) ) problems.push(`${at}: "item" is "foe" or the name of an item`);
    if ( (entry?.steal !== undefined) && (entry.steal !== true) ) problems.push(`${at}: "steal" is true`);
  };
  if ( loot.dice !== undefined ) {
    if ( !Number.isInteger(loot.dice) || (loot.dice < 2) ) problems.push('"loot.dice" is the faces of the die');
    if ( !Array.isArray(loot.of) || (loot.of.length !== loot.dice) ) problems.push('"loot.of" lists what each face of the die gives');
    else loot.of.forEach((entry, index) => one(entry, `"loot.of" ${index + 1}`));
    if ( ["gold", "item", "steal"].some((key) => loot[key] !== undefined) ) problems.push('"loot" with a die says what it gives in "of"');
  }
  else {
    if ( loot.of !== undefined ) problems.push('"loot.of" goes with "dice"');
    one(loot, '"loot"');
  }
  if ( (loot.once !== undefined) && (loot.once !== "foe") ) problems.push('"loot.once" is "foe"');
  return problems;
}

/* -------------------------------------------- */

/**
 * What a `loot` part gives this time: itself, or what its die picks.
 * @param {object} loot
 * @param {(faces: number) => number} [die]     Rolls a die of so many faces: a whole number from 1 to that
 * @returns {{gives: {gold?: number|"foe", item?: string, steal?: boolean}, roll: number|null, faces: number}}
 */
export function lootOf(loot, die = () => 1) {
  if ( Number.isInteger(loot?.dice) && Array.isArray(loot.of) && loot.of.length ) {
    const roll = Math.min(Math.max(Math.trunc(die(loot.dice)) || 1, 1), loot.of.length);
    return { gives: { ...loot.of[roll - 1] }, roll, faces: loot.dice };
  }
  const gives = {};
  for ( const key of ["gold", "item", "steal"] ) if ( loot?.[key] !== undefined ) gives[key] = loot[key];
  return { gives, roll: null, faces: 0 };
}

/* -------------------------------------------- */

/**
 * The gold a unit takes from a foe: all the foe carries, or what the world gives for one that carries none.
 * @param {number|"foe"} amount         What the skill says
 * @param {{gold?: number}} foe
 * @param {number} [fallback]           What a foe without gold of its own gives
 * @returns {{amount: number, carried: boolean}}    `carried`: is it the foe's own, which it then loses?
 */
export function goldFrom(amount, foe, fallback = FEO.stealing.gold) {
  if ( Number.isFinite(amount) ) return { amount: Math.max(Math.trunc(amount), 0), carried: false };
  const carried = Math.max(Math.trunc(foe?.gold ?? 0), 0);
  if ( carried > 0 ) return { amount: carried, carried: true };
  return { amount: Math.max(Math.trunc(fallback ?? 0), 0), carried: false };
}

/* -------------------------------------------- */
/*  Items Made as a Map Starts                  */
/* -------------------------------------------- */

/**
 * @typedef Craftable
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {string} folder      The section of the Items tab it is listed under
 */

/**
 * The items a unit may still make, given what it has picked so far: those of the sections its skill names,
 * while it has made fewer than it may, each for no more than is left of the total cost.
 * @param {{items: number, cost: number, folders: string[]}} crafts
 * @param {Craftable[]} wares
 * @param {Craftable[]} [picked]
 * @returns {{open: Craftable[], left: number, room: number}}     What may be picked, the cost that is left and
 *                                                                how many more it may make
 */
export function craftable(crafts, wares, picked = []) {
  const spent = picked.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  const left = Math.max((crafts?.cost ?? 0) - spent, 0);
  const room = Math.max((crafts?.items ?? 0) - picked.length, 0);
  const folders = new Set((crafts?.folders ?? []).map((name) => name.toLowerCase()));
  const open = !room ? [] : (wares ?? []).filter((item) => folders.has(String(item.folder ?? "").toLowerCase()) && ((item.cost ?? 0) > 0) && (item.cost <= left));
  return { open, left, room };
}

/* -------------------------------------------- */

/**
 * What a unit that answers by itself makes: the costliest item that fits, again and again while one does. The
 * same item may be made more than once.
 * @param {{items: number, cost: number, folders: string[]}} crafts
 * @param {Craftable[]} wares
 * @returns {Craftable[]}
 */
export function craftsAlone(crafts, wares) {
  const picked = [];
  for ( ;; ) {
    const { open } = craftable(crafts, wares, picked);
    const best = [...open].sort((a, b) => (b.cost - a.cost) || a.name.localeCompare(b.name))[0];
    if ( !best ) return picked;
    picked.push(best);
  }
}

/* -------------------------------------------- */
/*  A Weapon's Effect, Amplified                */
/* -------------------------------------------- */

/**
 * A number of a weapon's Effect made so many percent more, rounded down: the chance it inflicts a condition
 * at, held at 100. The turns that condition lasts are rounded up (see `resolveHit` in `conditions.mjs`).
 * @param {number} value
 * @param {number} percent        What it is increased by, in percent
 * @param {object} [options]
 * @param {number} [options.most]     What it never goes beyond
 * @returns {number}
 */
export function amplified(value, percent, { most = Infinity } = {}) {
  if ( !Number.isFinite(value) || !(percent > 0) ) return value;
  return Math.min(Math.floor((value * (100 + percent)) / 100), most);
}

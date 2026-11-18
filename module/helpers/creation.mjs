import Compendium from "../apps/compendium.mjs";
import { FEO } from "../config.mjs";
import { isArmed, isBroken, wieldOf } from "../rules/creation-fit.mjs";
import { discounted } from "../rules/stealing.mjs";
import {
  classOpen, freeGrowth, growthShift, planBonus, planBoon, planCheck, planClass, planGrowth, planRanks, planSource, planWeight, readCreation,
  planVariant, startingSkills, startsGeneric
} from "../rules/creation.mjs";
import { embedClass, grantSkills } from "./classes.mjs";
import { askPicks } from "./picks.mjs";
import { openGenericRoll } from "./skill-roll.mjs";
import { settled } from "./skill-ranks.mjs";

/**
 * The Character Creator as it happens in Foundry: saving each choice to the unit, adding and removing the Items
 * a choice brings, asking the Game Master, and telling the others at the table who is looking at what.
 * What a choice changes is decided by the pure rules in `rules/creation.mjs`.
 *
 * Every choice is saved the moment it is made, so a unit's sheet is always what the Creator has made of it so
 * far, and anyone with the sheet open sees it change.
 *
 * @import {CreationRecord, TakenSkill} from "../rules/creation.mjs"
 */

/** The socket the system speaks on. */
const SOCKET = `system.${FEO.id}`;

/** How long someone is taken to be looking at a step without saying so again, in milliseconds. */
const STALE = 45000;

/** The fields of a unit the Creator's own inputs may set as they are. */
const FIELDS = new Set([
  "name", "system.player", "system.affinity", "system.affinityRank",
  ...["gender", "age", "race", "homeland", "allegiance", "occupation", "lines", "veils"].map((key) => `system.profile.${key}`)
]);

/* -------------------------------------------- */
/*  Saving                                      */
/* -------------------------------------------- */

/**
 * The Creator's record of a unit, as it is saved.
 * @param {Actor} actor
 * @returns {CreationRecord}
 */
export function recordOf(actor) {
  return readCreation(actor._source.system.creation);
}

/* -------------------------------------------- */

/**
 * Save a plan: what it changes about the unit, what it notes in the Creator's record, and who made the change.
 * Only the parts of the record that change are sent, so two people working on a unit do not undo each other.
 * @param {Actor} actor
 * @param {{update?: Record<string, any>, record?: Record<string, any>}|null} plan    Null for a choice refused
 * @param {string} [step]     The step the change was made on, which it confirms
 * @returns {Promise<boolean>}    Was anything saved?
 */
export async function commit(actor, plan, step = "") {
  if ( !plan ) return false;
  const update = { ...plan.update };
  for ( const [path, value] of Object.entries(plan.record ?? {}) ) update[`system.creation.${path}`] = value;
  if ( step ) update[`system.creation.confirmed.${step}`] ??= true;
  if ( !recordOf(actor).status ) update["system.creation.status"] ??= "draft";
  update["system.creation.last"] = { user: game.user.id, name: game.user.name, step };
  await actor.update(update);
  return true;
}

/* -------------------------------------------- */

/**
 * Delete Items of a unit that are still there.
 * @param {Actor} actor
 * @param {string[]} ids
 * @returns {Promise<void>}
 */
async function removeItems(actor, ids) {
  const present = ids.filter((id) => actor.items.has(id));
  if ( present.length ) await actor.deleteEmbeddedDocuments("Item", present);
}

/* -------------------------------------------- */

/**
 * Add skills to a unit, and tell which Items they became. A skill the unit already had is left alone and is
 * not among them, so it is not taken away later.
 * @param {Actor} actor
 * @param {string[]} names
 * @param {string} kind       The kind of a skill that no compendium knows
 * @returns {Promise<string[]>}
 */
async function grant(actor, names, kind) {
  const { added } = await grantSkills(actor, names.map((name) => ({ name, kind })));
  const wanted = new Set(added.map((name) => name.toLowerCase()));
  return actor.items.filter((item) => (item.type === "skill") && wanted.has(item.name.toLowerCase())).map((item) => item.id);
}

/* -------------------------------------------- */
/*  Class                                       */
/* -------------------------------------------- */

/**
 * Take a class in the Creator, in place of the one the unit has. Its starting skill comes with it when the
 * class offers no choice of one.
 * @param {Actor} actor
 * @param {Item} cls        A class Item from the world or a compendium
 * @returns {Promise<boolean>}
 */
export async function chooseClass(actor, cls) {
  if ( cls?.type !== "class" ) return false;
  const record = recordOf(actor);
  const current = actor.system.classItem;
  if ( current && (cls.parent === actor) && (cls.id === current.id) ) return false;
  if ( !planClass(actor._source.system, record, current, cls) ) {
    ui.notifications.warn("FEO.Creator.warn.classLocked", { localize: true });
    return false;
  }

  const owned = await embedClass(actor, cls);
  if ( current && (current.id !== owned.id) ) await current.delete();
  await removeItems(actor, record.skills.class.items);
  const starting = startingSkills(owned);
  const items = starting.choice ? [] : await grant(actor, starting.names, "class");

  // The ranks are planned once the skills that came and went have given and taken back their own
  await settled(actor);
  const plan = planClass(actor._source.system, record, current, cls);
  plan.update["system.classId"] = owned.id;
  Object.assign(plan.record, {
    "class.uuid": cls.uuid ?? "",
    "skills.class": { name: starting.choice ? "" : starting.names.join(", "), items }
  });

  // A class that starts without a Generic Skill gives up the one already taken
  if ( !startsGeneric(owned) && record.skills.generic.name ) {
    await removeItems(actor, record.skills.generic.items);
    plan.record["skills.generic"] = { name: "", items: [] };
  }
  return commit(actor, plan, "class");
}

/* -------------------------------------------- */

/**
 * Open the Compendium at the class tree, with a button on its class sheet that takes the class for a unit.
 * @param {Actor} actor
 * @returns {Promise<Compendium>}
 */
export function openClassTree(actor) {
  const i18n = game.i18n;
  const base = FEO.classTiers.base.order;
  const describe = (cls) => {
    const current = actor.system.classItem;
    const unit = actor.name;
    if ( !classOpen(current) ) return { can: false, text: i18n.format("FEO.Creator.tree.promoted", { unit }) };
    if ( cls.order > base ) return { can: false, text: i18n.format("FEO.Creator.tree.promotion", { unit }) };
    if ( current?.name === cls.name ) return { can: false, chosen: true, text: i18n.format("FEO.Creator.tree.chosen", { unit }) };
    return {
      can: true,
      text: current ? i18n.format("FEO.Creator.tree.change", { from: current.name }) : i18n.format("FEO.Creator.tree.take", { unit }),
      label: i18n.format(current ? "FEO.Creator.tree.changeTo" : "FEO.Creator.tree.choose", { name: cls.name.split("/")[0] })
    };
  };
  const choose = async (cls) => {
    const source = cls.uuid ? await foundry.utils.fromUuid(cls.uuid) : null;
    if ( source ) await chooseClass(actor, source);
  };
  return Compendium.open({
    view: "classes",
    class: actor.system.classItem?.name,
    chooser: { takes: "class", actor: actor.uuid, describe, choose }
  });
}

/* -------------------------------------------- */
/*  Numbers                                     */
/* -------------------------------------------- */

/**
 * Raise or lower one of the numbers the Creator hands out: bonus points, a growth rate, the points of an
 * ability, or Class Weight.
 * @param {Actor} actor
 * @param {"bonus"|"growth"|"check"|"wt"} kind
 * @param {string} key          The stat, growth rate or ability; unused for Class Weight
 * @param {number} direction    1 or -1
 * @param {string} step         The step it is done on
 * @returns {Promise<boolean>}
 */
export async function adjust(actor, kind, key, direction, step) {
  const unit = actor._source.system;
  const record = recordOf(actor);
  let plan = null;
  if ( kind === "bonus" ) plan = planBonus(unit, record, key, (record.bonus[key] ?? 0) + direction);
  else if ( kind === "wt" ) plan = planWeight(unit, record, record.wt + direction);
  else if ( kind === "check" ) plan = planCheck(unit, key, (unit.checks[key]?.points ?? 0) + direction);
  else if ( kind === "growth" ) {
    const value = (unit.growths[key] ?? 0) - growthShift(unit, key) + (direction * FEO.creation.growth.step);
    plan = planGrowth(unit, key, value, { free: freeGrowth(actor.system.classItem) });
  }
  return commit(actor, plan, step);
}

/* -------------------------------------------- */

/**
 * Base Charm or Intelligence on a stat.
 * @param {Actor} actor
 * @param {"cha"|"int"} ability
 * @param {string} stat
 * @returns {Promise<boolean>}
 */
export function chooseSource(actor, ability, stat) {
  return commit(actor, planSource(actor._source.system, ability, stat), "sources");
}

/* -------------------------------------------- */

/**
 * Take a Boon or a Bane, or give it up.
 * @param {Actor} actor
 * @param {"boon"|"bane"} which
 * @param {string} key          A stat, or blank for none
 * @returns {Promise<boolean>}
 */
export function chooseBoon(actor, which, key) {
  return commit(actor, planBoon(actor._source.system, which, key), "boon");
}

/* -------------------------------------------- */

/**
 * Take the proficiencies a class offers, and choose the one that starts a rank higher.
 * @param {Actor} actor
 * @param {string[]} take
 * @param {string} first
 * @returns {Promise<boolean>}
 */
export async function chooseRanks(actor, take, first) {
  await settled(actor);
  const plan = planRanks(actor._source.system, recordOf(actor), actor.system.classItem, take, first);
  return commit(actor, plan, "ranks");
}

/* -------------------------------------------- */

/**
 * Set a field of the unit that a step of the Creator fills in as it is: its Affinity, its name, its profile.
 * @param {Actor} actor
 * @param {string} path
 * @param {string} value
 * @param {string} step
 * @returns {Promise<boolean>}
 */
export function setField(actor, path, value, step) {
  if ( !FIELDS.has(path) ) return Promise.resolve(false);
  if ( (path === "name") && !String(value).trim() ) return Promise.resolve(false);
  return commit(actor, { update: { [path]: value } }, step);
}

/* -------------------------------------------- */
/*  Skills and Gold                             */
/* -------------------------------------------- */

/**
 * Take a starting skill: the one chosen among those a class offers, or the Generic Skill every unit but a
 * Trainee starts with. The skill it takes the place of is removed.
 * @param {Actor} actor
 * @param {"class"|"generic"} slot
 * @param {string} name       Blank to give the skill up
 * @returns {Promise<boolean>}
 */
export async function chooseSkill(actor, slot, name) {
  const had = recordOf(actor).skills[slot];
  if ( !had || (had.name === name) ) return false;
  if ( (slot === "generic") && name && !startsGeneric(actor.system.classItem) ) return false;
  await removeItems(actor, had.items);
  const items = name ? await grant(actor, [name], slot) : [];
  return commit(actor, { record: { [`skills.${slot}`]: { name, items } } }, "skills");
}

/* -------------------------------------------- */

/**
 * The starting skills the Creator added to a unit, as they are now, for what each still has its unit choose.
 * @param {Actor} actor
 * @returns {TakenSkill[]}
 */
export function takenSkills(actor) {
  const record = recordOf(actor);
  return ["class", "generic"].flatMap((slot) => record.skills[slot].items.flatMap((id) => {
    const item = actor.items.get(id);
    if ( item?.type !== "skill" ) return [];
    const { effects, picks, choice, automate } = item.system;
    return [{ id, slot, name: item.name, effects, picks, choice, automate }];
  }));
}

/* -------------------------------------------- */

/**
 * Choose the variant of a starting skill that comes in several, or take or give up one of the growth rates a
 * starting skill raises.
 * @param {Actor} actor
 * @param {string} id         The Item the skill was added as
 * @param {string} value      The variant, or the growth rate
 * @param {number} [index]    Which of the skill's picks
 * @returns {Promise<boolean>}
 */
export async function chooseVariant(actor, id, value, index = 0) {
  const skill = takenSkills(actor).find((taken) => taken.id === id);
  const choice = skill ? planVariant(skill, value, index) : null;
  if ( choice === null ) return false;
  await actor.items.get(id).update({ "system.choice": choice });
  return commit(actor, {}, "skills");
}

/* -------------------------------------------- */

/**
 * Open the picker for what a starting skill has its unit pick, where the list is too long for the step: the
 * Compendium at the skill's page, or a dialog for a skill the Compendium does not know.
 * @param {Actor} actor
 * @param {string} id         The Item the skill was added as
 * @returns {Promise<boolean>}
 */
export async function openVariant(actor, id) {
  const item = takenSkills(actor).some((taken) => taken.id === id) ? actor.items.get(id) : null;
  if ( !item ) return false;
  return askPicks(item, {
    take: async (choice) => {
      if ( choice !== item.system.choice ) await item.update({ "system.choice": choice });
      await commit(actor, {}, "skills");
    }
  });
}

/* -------------------------------------------- */

/**
 * What a weapon or an item costs a unit as starting equipment: its price, less what the unit's skills take off
 * what it is outfitted with, as Haggle does.
 * @param {Actor} actor
 * @param {number} [price]
 * @returns {number}
 */
export function outfitCost(actor, price) {
  return discounted(price ?? 0, actor?.system?.knacks?.outfit ?? 0);
}

/* -------------------------------------------- */

/**
 * Buy a weapon or an item with the unit's Gold.
 * @param {Actor} actor
 * @param {string} uuid       The Item to buy a copy of
 * @returns {Promise<boolean>}
 */
export async function buy(actor, uuid) {
  const source = await foundry.utils.fromUuid(uuid);
  if ( !source || !["weapon", "gear"].includes(source.type) ) return false;
  // What the unit's skills take off its starting equipment is taken off the price (see `discounted`)
  const cost = outfitCost(actor, source.system.cost);
  const gold = actor._source.system.gold;
  if ( cost > gold ) {
    ui.notifications.warn("FEO.Creator.warn.gold", { localize: true });
    return false;
  }
  const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
  delete data._id;
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  const purchases = [...recordOf(actor).purchases, { id: item.id, name: item.name, cost }];
  return commit(actor, { update: { "system.gold": gold - cost }, record: { purchases } }, "gold");
}

/* -------------------------------------------- */

/**
 * Hand back something bought in the Creator, for what it cost.
 * @param {Actor} actor
 * @param {string} id         The Item it became
 * @returns {Promise<boolean>}
 */
export async function refund(actor, id) {
  const record = recordOf(actor);
  const bought = record.purchases.find((purchase) => purchase.id === id);
  if ( !bought ) return false;
  await removeItems(actor, [id]);
  const purchases = record.purchases.filter((purchase) => purchase.id !== id);
  return commit(actor, { update: { "system.gold": actor._source.system.gold + bought.cost }, record: { purchases } }, "gold");
}

/* -------------------------------------------- */

/**
 * Open the Compendium at the roll of skills, with a button on its skill sheet that takes a Generic Skill as the
 * one a unit starts with.
 * @param {Actor} actor
 * @returns {Promise<Compendium>}
 */
export function openSkillRoll(actor) {
  return openGenericRoll(actor, {
    had: () => recordOf(actor).skills.generic,
    choose: (skill) => chooseSkill(actor, "generic", skill.name),
    refuse: () => (startsGeneric(actor.system.classItem) ? "" : game.i18n.format("FEO.Creator.roll.noGeneric", { unit: actor.name }))
  });
}

/* -------------------------------------------- */

/**
 * Open the Compendium at the armoury, with a button on each row that buys it with a unit's Gold. The weapons
 * are opened at the type the unit can wield the most of.
 * @param {Actor} actor
 * @param {"weapons"|"items"} [tab]
 * @returns {Promise<Compendium>}
 */
export async function openArmoury(actor, tab = "weapons") {
  const i18n = game.i18n;
  const number = (value) => Number(value ?? 0).toLocaleString("en-US");
  const rankOf = (rank) => i18n.localize(FEO.ranks[rank] ?? "");
  const why = (wield) => {
    switch ( wield.why ) {
      case "rank": return i18n.format("FEO.Creator.gold.needsRank", { needs: rankOf(wield.needs), has: rankOf(wield.has) });
      case "level": return i18n.format("FEO.Creator.gold.needsLevel", { level: wield.needs });
      case "wlv": return i18n.format("FEO.Creator.gold.needsWlv", { needs: wield.needs, has: wield.has });
      case "people": return i18n.localize("FEO.Creator.gold.notTheirs");
      default: return i18n.localize("FEO.Creator.gold.unfit");
    }
  };
  const describe = (entry) => {
    const wield = ("category" in entry) ? wieldOf(entry, { unit: actor._source.system, cls: actor.system.classItem }) : { ok: true };
    return {
      sold: !!entry.uuid && !isBroken(entry),
      can: outfitCost(actor, entry.cost) <= actor._source.system.gold,
      fit: wield.ok,
      unfit: wield.ok ? "" : why(wield)
    };
  };
  const choose = (entry) => buy(actor, entry.uuid);
  const banner = () => {
    const unit = actor._source.system;
    const bought = recordOf(actor).purchases.map((purchase) => purchase.name);
    const wields = Object.entries(unit.proficiencies ?? {}).filter(([key, proficiency]) => {
      return (key in FEO.proficiencies) && ((proficiency?.rank ?? "F") !== "F");
    }).map(([key, proficiency]) => `${i18n.localize(FEO.proficiencies[key])} ${rankOf(proficiency.rank)}`);
    const tags = [{
      label: i18n.localize("FEO.Creator.armoury.gold"),
      value: i18n.format("FEO.Creator.armoury.goldValue", { left: number(unit.gold), total: number(FEO.creation.gold) })
    }];
    if ( wields.length ) tags.push({ label: i18n.localize("FEO.Creator.gold.wields"), value: wields.join(" · ") });

    // What its skills take off every price here
    const outfits = actor.system.knacks?.outfits ?? [];
    if ( outfits.length ) tags.push({ label: i18n.localize("FEO.Creator.armoury.outfit"), value: outfits.map((entry) => `${entry.name} −${entry.percent}%`).join(" · ") });
    return {
      text: i18n.format("FEO.Creator.armoury.banner", { unit: actor.name }),
      tags,
      note: bought.length
        ? i18n.format("FEO.Creator.armoury.bought", { items: bought.join(", ") })
        : i18n.format("FEO.Creator.armoury.note", { unit: actor.name })
    };
  };

  // A unit with nothing it was made to wield yet starts at the head of the armoury
  let type = "";
  if ( (tab !== "items") && isArmed(actor._source.system, actor.system.classItem) ) {
    const library = await Compendium.library();
    const fits = (group) => group.rows.filter((row) => !isBroken(row) && describe(row).fit).length;
    const best = library.weaponGroups.map((group) => ({ key: group.key, fits: fits(group) })).sort((a, b) => b.fits - a.fits)[0];
    if ( best?.fits ) type = best.key;
  }
  return Compendium.open({
    view: "equipment",
    tab: tab === "items" ? "items" : "weapons",
    type,
    chooser: { takes: "equipment", actor: actor.uuid, describe, choose, banner }
  });
}

/* -------------------------------------------- */
/*  What the Game Master gives                  */
/* -------------------------------------------- */

/** What giving Holy Blood or a Crest saves on the unit, or taking it back. */
function grantPaths(which, choice, given) {
  if ( which === "holyBlood" ) {
    return choice.lineage ? { [`system.holyBlood.lineages.${choice.lineage}`]: given ? choice.grade : "" } : {};
  }
  return given ? { "system.crest.id": choice.id, "system.crest.grade": choice.grade } : { "system.crest.id": "" };
}

/** The key of what is chosen in each. */
const PICKED = { holyBlood: "lineage", crest: "id" };

/**
 * Choose Holy Blood or a Crest. What a player chooses is asked of the Game Master and waits for approval; what
 * the Game Master chooses is given at once.
 * @param {Actor} actor
 * @param {"holyBlood"|"crest"} which
 * @param {object} changes      The lineage or Crest, its grade, or both
 * @returns {Promise<boolean>}
 */
export function chooseGrant(actor, which, changes) {
  const old = recordOf(actor)[which];
  const next = { ...old, ...changes };
  next.approved = game.user.isGM && !!next[PICKED[which]];
  const update = { ...(old.approved ? grantPaths(which, old, false) : {}), ...(next.approved ? grantPaths(which, next, true) : {}) };
  return commit(actor, { update, record: { [which]: next } }, which);
}

/* -------------------------------------------- */

/**
 * Approve what a player asked for, or withdraw the approval. Only a Game Master may.
 * @param {Actor} actor
 * @param {"holyBlood"|"crest"} which
 * @param {boolean} approved
 * @returns {Promise<boolean>}
 */
export function approveGrant(actor, which, approved) {
  if ( !game.user.isGM ) return Promise.resolve(false);
  const old = recordOf(actor)[which];
  const next = { ...old, approved: approved && !!old[PICKED[which]] };
  if ( next.approved === old.approved ) return Promise.resolve(false);
  return commit(actor, { update: grantPaths(which, old, next.approved), record: { [which]: next } }, which);
}

/* -------------------------------------------- */
/*  Steps, help and notes                       */
/* -------------------------------------------- */

/**
 * Note that a step has been opened, and that the one left with Next is settled.
 * @param {Actor} actor
 * @param {string} seen           The step opened
 * @param {string} [confirmed]    The step passed with Next
 * @returns {Promise<void>}
 */
export async function markSteps(actor, seen, confirmed = "") {
  const record = recordOf(actor);
  const update = {};
  if ( seen && !record.seen[seen] ) update[`system.creation.seen.${seen}`] = true;
  if ( confirmed && !record.confirmed[confirmed] ) update[`system.creation.confirmed.${confirmed}`] = true;
  if ( Object.keys(update).length ) await actor.update(update);
}

/* -------------------------------------------- */

/**
 * Ask for help on a step, or say that it is no longer needed. A player's call is sent to the Game Masters.
 * @param {Actor} actor
 * @param {string} step
 * @param {boolean} asking
 * @returns {Promise<void>}
 */
export async function askHelp(actor, step, asking) {
  await actor.update({
    [`system.creation.help.${step}`]: asking ? game.user.id : "",
    "system.creation.last": { user: game.user.id, name: game.user.name, step }
  });
  if ( asking && !game.user.isGM ) {
    game.socket.emit(SOCKET, { type: "creator.help", actor: actor.uuid, user: game.user.id, step });
  }
}

/* -------------------------------------------- */

/**
 * Leave a note on a step, for whoever else works on the unit.
 * @param {Actor} actor
 * @param {string} step
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function addNote(actor, step, text) {
  const words = String(text ?? "").trim().slice(0, 500);
  if ( !words ) return;
  const note = { step, user: game.user.id, name: game.user.name, gm: game.user.isGM, text: words };
  await actor.update({
    "system.creation.notes": [...recordOf(actor).notes, note],
    "system.creation.last": { user: game.user.id, name: game.user.name, step }
  });
}

/* -------------------------------------------- */

/**
 * Finish the unit: its creation is complete. The Creator stays, for whatever needs changing later.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function finish(actor) {
  await actor.update({
    "system.creation.status": "complete",
    "system.creation.last": { user: game.user.id, name: game.user.name, step: "review" }
  });
}

/* -------------------------------------------- */
/*  Who is looking                              */
/* -------------------------------------------- */

/** Who else has the Creator of each unit open, and on which step: unit by unit, user by user. */
const presence = new Map();

/** The steps this user has open, unit by unit, to tell whoever joins. */
const mine = new Map();

/** What someone else last changed about each unit, until its sheet has shown it. */
const remote = new Map();

/**
 * Draw the Creator of a unit again wherever it is open.
 * @param {string} uuid
 */
function refresh(uuid) {
  const actor = foundry.utils.fromUuidSync(uuid);
  for ( const app of Object.values(actor?.apps ?? {}) ) {
    if ( app.rendered && app.creatorOpen ) app.render({ parts: ["creator"] });
  }
}

/* -------------------------------------------- */

/**
 * Tell the table which step of a unit's Creator this user is on, or that they have left it.
 * @param {Actor} actor
 * @param {string|null} step    Null on leaving
 * @param {object} [options]
 * @param {boolean} [options.hello]   Ask those already there to say so
 */
export function announce(actor, step, { hello = false } = {}) {
  if ( step ) mine.set(actor.uuid, step);
  else mine.delete(actor.uuid);
  game.socket?.emit(SOCKET, { type: "creator.presence", actor: actor.uuid, user: game.user.id, step, hello });
}

/* -------------------------------------------- */

/**
 * Who else has a unit's Creator open.
 * @param {Actor} actor
 * @returns {{user: User, step: string}[]}
 */
export function watchers(actor) {
  const now = Date.now();
  const here = [];
  for ( const [id, entry] of presence.get(actor.uuid) ?? [] ) {
    const user = game.users.get(id);
    if ( user?.active && (now - entry.time < STALE) ) here.push({ user, step: entry.step });
  }
  return here;
}

/* -------------------------------------------- */

/**
 * What someone else changed about a unit since its sheet was last drawn: the paths under `system`, each read
 * once.
 * @param {Actor} actor
 * @returns {string[]}
 */
export function takeRemote(actor) {
  const paths = remote.get(actor.uuid) ?? [];
  remote.delete(actor.uuid);
  return paths;
}

/* -------------------------------------------- */

/**
 * Make the Creator part of the game: listen for who is looking at which step and for calls for help, and keep
 * what others change so that a sheet can show where it landed.
 */
export function registerCreation() {
  game.socket?.on(SOCKET, (message) => {
    if ( message?.type === "creator.presence" ) {
      const users = presence.get(message.actor) ?? new Map();
      if ( message.step ) users.set(message.user, { step: message.step, time: Date.now() });
      else users.delete(message.user);
      presence.set(message.actor, users);
      refresh(message.actor);

      // Someone who has just arrived is told who is already there
      if ( message.hello && mine.has(message.actor) ) {
        game.socket.emit(SOCKET, { type: "creator.presence", actor: message.actor, user: game.user.id, step: mine.get(message.actor) });
      }
    }
    else if ( (message?.type === "creator.help") && game.user.isGM ) {
      const actor = foundry.utils.fromUuidSync(message.actor);
      if ( !actor ) return;
      ui.notifications.info(game.i18n.format("FEO.Creator.help.notice", {
        user: game.users.get(message.user)?.name ?? "",
        unit: actor.name,
        step: game.i18n.localize(`FEO.Creator.step.${message.step}.title`)
      }));
    }
  });

  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( (userId === game.user.id) || (actor.type !== "unit") || !changed.system ) return;
    remote.set(actor.uuid, Object.keys(foundry.utils.flattenObject(changed.system)));
  });

  Hooks.on("userConnected", (user, connected) => {
    if ( connected ) return;
    for ( const [uuid, users] of presence ) {
      if ( users.delete(user.id) ) refresh(uuid);
    }
  });
}

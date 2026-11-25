/**
 * Bringing the skills units already have up to date with the skills compendium, for Fire Emblem Online. A unit
 * keeps a copy of each skill it learnt, as the compendium had it that day: one made before the system applied
 * a skill by itself still has the skill as words only. Pure functions of plain data, so that they can be
 * tested outside of Foundry.
 *
 * A skill is matched with the entry it was copied from, which Foundry notes on the copy; a skill that was made
 * by hand, or whose entry is gone, is matched by its name. From its entry it takes what the skill is: its
 * Effect, its numbers, what the system does with it and its icon. What is its unit's own stays as it is:
 * whether it is equipped, what was picked on it, the times it was raised, whether the table runs it by hand,
 * and where its cooldown and uses stand.
 *
 * Nothing here touches Foundry: `helpers/migration.mjs` saves what these plans say.
 */

/** What of a skill is its unit's own, and is never taken from the compendium. */
export const KEPT = ["equipped", "choice", "raises", "automate", "state"];

/**
 * What an accessory takes from its entry of the items compendium: what the accessory is. Whether it is worn
 * and the uses it has left are its unit's own, and anything else of it is left as it is.
 */
export const ACCESSORY_TAKES = ["effect", "cost", "equip", "restore"];

/**
 * @typedef SkillEntry
 * A skill as the compendium has it.
 * @property {string} uuid        Where it is: "Compendium.<system>.<pack>.Item.<id>"
 * @property {string} name
 * @property {string} img
 * @property {object} system      Its data, as it is saved
 */

/**
 * @typedef SkillShelf
 * The skills of the compendiums, as they are looked up.
 * @property {Map<string, SkillEntry>} byUuid
 * @property {Map<string, SkillEntry[]>} byName     By name in lower case; a name may be that of several skills
 */

/**
 * @typedef RefreshPlan
 * What a skill takes from its entry.
 * @property {Record<string, any>} system     The fields of its data that change, each as the entry has it
 * @property {string} [img]                   Its icon, when that changes
 * @property {string} [link]                  The entry to note on a skill that was matched by its name
 * @property {string[]} fields                The names of what changes
 */

/** A name as names are compared. */
const fold = (name) => String(name ?? "").trim().toLowerCase();

/* -------------------------------------------- */

/**
 * Are two saved values the same? Objects are compared key by key, in whatever order their keys come.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function same(a, b) {
  if ( a === b ) return true;
  if ( (a === null) || (b === null) || (typeof a !== "object") || (typeof b !== "object") ) return false;
  if ( Array.isArray(a) !== Array.isArray(b) ) return false;
  if ( Array.isArray(a) ) return (a.length === b.length) && a.every((value, index) => same(value, b[index]));
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  const others = Object.keys(b).filter((key) => b[key] !== undefined);
  return (keys.length === others.length) && keys.every((key) => same(a[key], b[key]));
}

/* -------------------------------------------- */

/**
 * Put the skills of the compendiums where they can be looked up.
 * @param {SkillEntry[]} entries
 * @returns {SkillShelf}
 */
export function shelve(entries) {
  const shelf = { byUuid: new Map(), byName: new Map() };
  for ( const entry of entries ?? [] ) {
    shelf.byUuid.set(entry.uuid, entry);
    const name = fold(entry.name);
    if ( !shelf.byName.has(name) ) shelf.byName.set(name, []);
    shelf.byName.get(name).push(entry);
  }
  return shelf;
}

/* -------------------------------------------- */

/**
 * Find the entry a skill is a copy of.
 *
 * A skill copied from one of the system's compendiums is a copy of that entry, whatever it has been renamed
 * to. One copied from anywhere else, a compendium of the world's own or of a module, is somebody's own skill
 * and has no entry here. A skill that names no entry, or one that is gone, is matched by its name; where
 * several skills share the name, by its kind as well, and not at all when that does not settle it.
 * @param {{name: string, system?: {kind?: string}, _stats?: {compendiumSource?: string|null}}} skill
 * @param {SkillShelf} shelf
 * @param {object} [options]
 * @param {string} [options.prefix]     What the address of an entry of the system begins with:
 *                                      "Compendium.<system>."
 * @returns {{entry: SkillEntry, by: "link"|"name"}|{entry: null, by: "foreign"|"shared"|"none"}}
 *   The entry and how it was found; or why there is none: the skill is from elsewhere, its name is shared by
 *   skills that cannot be told apart, or no skill has its name
 */
export function sourceOf(skill, shelf, { prefix = "Compendium." } = {}) {
  const link = String(skill?._stats?.compendiumSource ?? "");
  if ( link ) {
    const linked = shelf.byUuid.get(link);
    if ( linked ) return { entry: linked, by: "link" };
    if ( !link.startsWith(prefix) ) return { entry: null, by: "foreign" };
  }
  const named = shelf.byName.get(fold(skill?.name)) ?? [];
  if ( named.length === 1 ) return { entry: named[0], by: "name" };
  if ( !named.length ) return { entry: null, by: "none" };
  const kind = named.filter((entry) => entry.system?.kind === skill?.system?.kind);
  return kind.length === 1 ? { entry: kind[0], by: "name" } : { entry: null, by: "shared" };
}

/* -------------------------------------------- */

/**
 * Plan what a skill takes from its entry: every field of its data that is not its unit's own and differs, and
 * its icon.
 * @param {{img?: string, system?: object, _stats?: {compendiumSource?: string|null}}} skill
 *   The skill as it is saved
 * @param {SkillEntry} entry
 * @param {object} [options]
 * @param {string[]|null} [options.only]    The fields that are taken, where not all that is not its unit's own
 *                                          is: as for an accessory (`ACCESSORY_TAKES`)
 * @returns {RefreshPlan|null}    Null when the skill is as its entry has it
 */
export function planRefresh(skill, entry, { only = null } = {}) {
  const plan = { system: {}, fields: [] };
  const mine = skill?.system ?? {};
  for ( const [key, value] of Object.entries(entry?.system ?? {}) ) {
    if ( KEPT.includes(key) || (only && !only.includes(key)) || same(mine[key], value) ) continue;
    plan.system[key] = value;
    plan.fields.push(key);
  }
  // Its icon is taken with all the rest; where only some fields are, the icon it was given stays
  if ( !only && entry?.img && (entry.img !== skill?.img) ) {
    plan.img = entry.img;
    plan.fields.push("img");
  }
  if ( !plan.fields.length ) return null;

  // A skill that was matched by its name is a copy of its entry from now on
  if ( entry.uuid && (skill?._stats?.compendiumSource !== entry.uuid) ) plan.link = entry.uuid;
  return plan;
}

/* -------------------------------------------- */
/*  Accessories                                 */
/* -------------------------------------------- */

/**
 * The accessory a unit puts on as its world is brought up to date. Before accessories were worn one at a time
 * a unit simply carried them: one that carries any and wears none puts on the first of them, in the order of
 * its sheet. A unit that wears one already is left as it is.
 * @param {{id: string, equipped?: boolean, sort?: number}[]} accessories    The accessories it carries
 * @returns {string|null}     The id of the one to put on, or null when there is nothing to do
 */
export function accessoryToWear(accessories = []) {
  if ( !accessories.length || accessories.some((item) => item.equipped) ) return null;
  return accessories.reduce((first, item) => (((item.sort ?? 0) < (first.sort ?? 0)) ? item : first)).id;
}

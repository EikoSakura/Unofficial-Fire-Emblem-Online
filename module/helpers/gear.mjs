import { FEO } from "../config.mjs";
import { GRANTED_FLAG, grantedSkills } from "../rules/gear.mjs";
import { findItem } from "./classes.mjs";

/**
 * The skills gear grants, as they are kept in Foundry (see `rules/gear.mjs` for what gear grants). A weapon in
 * hand, an accessory or a Shield that says "Grants Miracle" gives its unit that skill as a Skill Item of its
 * own for as long as the gear is equipped: it is equipped, takes no skill slot, and is used, switched and
 * counted as any skill of the unit is. It goes as the gear is put away, traded, sold or broken.
 *
 * Where such a skill stood, its cooldown and the uses it had spent, is kept on the gear as the skill goes, and
 * given back as it returns, so that putting gear away and taking it up again resets nothing.
 */

/** The flag on a piece of gear that keeps where the skills it grants stood when it was put away. */
const SAVED_FLAG = "grantedState";

/** What marks an update as one of these, so that it does not start another look at the same unit. */
const SYNC = { [FEO.id]: { gearSync: true } };

/** One look at a time for each unit, so that two changes at once grant nothing twice. */
const queue = new Map();

const fold = (name) => String(name ?? "").trim().toLowerCase();

/* -------------------------------------------- */

/**
 * The gear of a unit that may grant it skills, as the rules read it.
 * @param {Actor} actor
 * @returns {{id: string, name: string, kind: string, effect: string, category?: string, equipped: boolean, broken: boolean}[]}
 */
function gearOf(actor) {
  const barred = !!actor.system.shieldsBarred;
  const gear = [];
  for ( const item of actor.items ) {
    if ( item.type === "weapon" ) {
      gear.push({
        id: item.id, name: item.name, kind: "weapon", effect: item.system.effect, category: item.system.category,
        equipped: !!item.system.equipped, broken: !!item.system.broken
      });
    }
    else if ( (item.type === "gear") && (item.system.isAccessory || item.system.isShield) ) {
      gear.push({
        id: item.id, name: item.name, kind: item.system.isShield ? "shield" : "accessory", effect: item.system.effect,
        equipped: !!item.system.equipped && !(item.system.isShield && barred), broken: !!item.system.spent
      });
    }
  }

  // What is equipped comes first, so that a skill two pieces grant is that of the one in use
  return gear.sort((a, b) => Number(b.equipped) - Number(a.equipped));
}

/* -------------------------------------------- */

/**
 * Bring the skills a unit's gear grants it in line with the gear it has equipped: those that are missing are
 * added, and those whose gear no longer grants them are taken off.
 * @param {Actor} actor
 * @returns {Promise<{added: string[], removed: string[]}>}
 */
async function look(actor) {
  const report = { added: [], removed: [] };
  if ( (actor?.type !== "unit") || !actor.isOwner ) return report;
  const gear = gearOf(actor);
  const wanted = grantedSkills(gear).map((grant) => ({ ...grant, gear: gear.find((piece) => piece.name === grant.from) }));
  const granted = actor.items.filter((item) => (item.type === "skill") && item.flags?.[FEO.id]?.[GRANTED_FLAG]);

  // Skills whose gear no longer grants them go, and leave where they stood on that gear if the unit still has it
  const gone = granted.filter((item) => {
    const by = item.flags[FEO.id][GRANTED_FLAG];
    return !wanted.some((grant) => (fold(grant.skill) === fold(item.name)) && (grant.gear?.id === by.id));
  });
  for ( const item of gone ) {
    const source = actor.items.get(item.flags[FEO.id][GRANTED_FLAG].id);
    if ( source ) await source.update({ [`flags.${FEO.id}.${SAVED_FLAG}.${item.id}`]: { name: item.name, state: item.toObject().system.state } }, SYNC);
  }
  if ( gone.length ) {
    await actor.deleteEmbeddedDocuments("Item", gone.map((item) => item.id), SYNC);
    report.removed = gone.map((item) => item.name);
  }

  // Skills that are granted and missing are added. One the unit has equipped as a skill of its own is its own
  const data = [];
  const restored = [];
  for ( const grant of wanted ) {
    const has = actor.items.some((item) => {
      if ( (item.type !== "skill") || (fold(item.name) !== fold(grant.skill)) || gone.includes(item) ) return false;
      return item.flags?.[FEO.id]?.[GRANTED_FLAG] ? true : !!item.system.equipped;
    });
    if ( has || data.some((entry) => fold(entry.name) === fold(grant.skill)) ) continue;
    const found = await findItem("skill", grant.skill);
    if ( !found ) {
      console.warn(`${FEO.id} | ${grant.from} grants ${grant.skill}, and no skill of that name was found.`);
      continue;
    }
    const entry = found.inCompendium ? game.items.fromCompendium(found, { clearFolder: true }) : found.toObject();
    delete entry._id;
    entry.system ??= {};
    entry.system.equipped = true;

    // Where it stood when its gear was last put away
    const source = actor.items.get(grant.gear?.id);
    const saved = Object.entries(source?.flags?.[FEO.id]?.[SAVED_FLAG] ?? {}).find(([, kept]) => fold(kept?.name) === fold(grant.skill));
    if ( saved ) {
      entry.system.state = { ...(entry.system.state ?? {}), ...(saved[1].state ?? {}) };
      restored.push({ source, key: saved[0] });
    }
    entry.flags = { ...(entry.flags ?? {}), [FEO.id]: { ...(entry.flags?.[FEO.id] ?? {}), [GRANTED_FLAG]: { id: grant.gear?.id ?? "", name: grant.from } } };
    data.push(entry);
  }
  if ( data.length ) {
    await actor.createEmbeddedDocuments("Item", data, SYNC);
    report.added = data.map((entry) => entry.name);
  }
  for ( const { source, key } of restored ) await source.update({ [`flags.${FEO.id}.${SAVED_FLAG}.-=${key}`]: null }, SYNC);
  return report;
}

/* -------------------------------------------- */

/**
 * Bring the skills a unit's gear grants it in line with its gear. Looks at one unit are made one after the
 * other, so that two changes at once grant nothing twice.
 * @param {Actor} actor
 * @returns {Promise<{added: string[], removed: string[]}>}
 */
export function syncGranted(actor) {
  const key = actor?.uuid ?? "";
  const next = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(() => look(actor));
  queue.set(key, next);
  next.finally(() => {
    if ( queue.get(key) === next ) queue.delete(key);
  }).catch((err) => console.error(`${FEO.id} | The skills ${actor?.name} is granted by its gear could not be brought in line.`, err));
  return next;
}

/* -------------------------------------------- */

/**
 * The piece of gear that grants a skill, if one does.
 * @param {Item} item       A Skill Item
 * @returns {{id: string, name: string}|null}
 */
export function grantedBy(item) {
  const by = item?.flags?.[FEO.id]?.[GRANTED_FLAG];
  return by ? { id: by.id ?? "", name: by.name ?? "" } : null;
}

/* -------------------------------------------- */

/**
 * Does a change to an Item call for a look at what its unit's gear grants?
 * @param {Item} item
 * @param {object} [changed]    What an update changes; left out for an Item that is made or deleted
 * @returns {boolean}
 */
function concerns(item, changed = null) {
  if ( item?.parent?.type !== "unit" ) return false;
  if ( !["weapon", "gear", "skill"].includes(item.type) ) return false;
  if ( !changed ) return true;
  if ( changed.name !== undefined ) return true;
  const system = changed.system ?? {};
  if ( item.type === "skill" ) return system.equipped !== undefined;
  return ["equipped", "effect", "uses", "category", "equip", "shield"].some((key) => system[key] !== undefined);
}

/* -------------------------------------------- */

/**
 * Have the client that changes a unit's gear see to the skills that gear grants, and have one Game Master look
 * at every unit as the world opens, for the gear that was equipped before the system granted skills.
 */
export function registerHooks() {
  const mine = (userId, options) => (userId === game.user.id) && !options?.[FEO.id]?.gearSync;
  Hooks.on("createItem", (item, options, userId) => {
    if ( mine(userId, options) && concerns(item) ) syncGranted(item.parent);
  });
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if ( mine(userId, options) && concerns(item, changed) ) syncGranted(item.parent);
  });
  Hooks.on("deleteItem", (item, options, userId) => {
    if ( mine(userId, options) && concerns(item) ) syncGranted(item.parent);
  });

  // A change that lasts may keep a unit from its Shield, and what the Shield grants goes with it
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( mine(userId, options) && (actor.type === "unit") && (changed.system?.timed !== undefined) ) syncGranted(actor);
  });
  Hooks.once("ready", async () => {
    if ( !game.users.activeGM?.isSelf ) return;
    for ( const actor of game.actors ) if ( actor.type === "unit" ) await syncGranted(actor);
    for ( const scene of game.scenes ) {
      for ( const token of scene.tokens ) {
        if ( !token.actorLink && (token.actor?.type === "unit") ) await syncGranted(token.actor);
      }
    }
  });
}

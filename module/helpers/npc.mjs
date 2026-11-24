import Compendium from "../apps/compendium.mjs";
import { findSkill } from "../apps/compendium-context.mjs";
import { FEO } from "../config.mjs";
import { computeCombatStats, unitWeight } from "../rules/combat-stats.mjs";
import { isBroken } from "../rules/creation-fit.mjs";
import { buildNpc, cleanSpec, levelSpan, lineThrough, suggestKit, wields } from "../rules/npc.mjs";
import { grantSkills } from "./classes.mjs";
import { syncBuiltIn } from "./events.mjs";

/**
 * Quick units in Foundry: what the NPC Builder shows of a unit before it is saved, and saving it as a Unit of
 * its own with its classes, skills and what it carries. What a unit is made of is decided by `rules/npc.mjs`.
 *
 * @import {NpcSpec, NpcBuild} from "../rules/npc.mjs"
 */

/** The flag of a Unit that keeps what the Game Master chose for it, as text. */
export const SPEC_FLAG = FEO.npc.flag;

/** The flag of an Item the builder gave a unit, which it may take away again. */
export const MADE_FLAG = "npcMade";

/** The flag of something a unit carries that says whom it is left for. */
export const DROP_FLAG = "drop";

/** The flag of a unit whose drops were told once it fell. */
const DROPPED_FLAG = "dropped";

/** The flag of the folder the builder keeps its units in. */
const FOLDER_FLAG = "npcFolder";

/* -------------------------------------------- */
/*  Classes                                     */
/* -------------------------------------------- */

/** Classes as the class rules read them, by the entry of the library each was read from. */
const CLASSES = new WeakMap();

/**
 * A class of the Compendium's library, as the class rules read one.
 * @param {object} entry
 * @returns {import("../rules/classes.mjs").ClassLike & {id: string, uuid: string, img: string}}
 */
export function classOf(entry) {
  if ( !entry ) return null;
  if ( CLASSES.has(entry) ) return CLASSES.get(entry);
  const cls = {
    id: entry.id,
    uuid: entry.uuid,
    name: entry.name,
    img: entry.img,
    system: {
      tier: entry.tier,
      race: entry.race,
      base: { ...entry.base },
      gains: Object.fromEntries(Object.entries(entry.gains ?? {}).map(([key, gain]) => [key, gain ?? 0])),
      wt: entry.wt ?? 0,
      caps: {},
      proficiencies: { ...entry.proficiencies },
      skills: { ...entry.skills },
      specialQualities: (entry.qualities ?? []).join(", "),
      promotesTo: [...(entry.promotesTo ?? [])]
    }
  };
  CLASSES.set(entry, cls);
  return cls;
}

/* -------------------------------------------- */

/**
 * The classes of a unit, lowest tier first, as the library has them.
 * @param {object} library
 * @param {NpcSpec} spec
 * @returns {object[]}
 */
export function lineOf(library, spec) {
  return (spec.classes ?? []).map((id) => classOf(library.byId.get(library.alias.get(id) ?? id))).filter(Boolean);
}

/* -------------------------------------------- */

/**
 * Take a class for a unit: its line of classes becomes the one that leads to it, its Level moves into the
 * Levels that class holds, and what was set for its old class is let go. A unit that carried nothing but what
 * was suggested for it, or nothing at all, is given a kit for the new class.
 * @param {NpcSpec} spec
 * @param {object} library
 * @param {object} entry        The class, as the library has it
 * @returns {NpcSpec}
 */
export function takeClass(spec, library, entry) {
  const parentsOf = (cls) => (library.parentsOf.get(cls.id) ?? []).map(classOf);
  const line = lineThrough(classOf(entry), parentsOf, spec.classes);
  const span = levelSpan(line);
  const next = cleanSpec({
    ...spec,
    classes: line.map((cls) => cls.id),
    level: Math.min(Math.max(spec.level, span.from), span.to),
    ranks: {},
    picks: {},
    con: null,
    pack: []
  });
  next.pack = kitFor(next, library);
  return next;
}

/* -------------------------------------------- */

/**
 * The classes a unit's class promotes to, for a unit that has reached the Level at which it would.
 * @param {object} library
 * @param {NpcSpec} spec
 * @returns {object[]}          As the library has them
 */
export function promotionsOf(library, spec) {
  const last = library.byId.get(library.alias.get(spec.classes.at(-1)) ?? spec.classes.at(-1));
  if ( !last ) return [];
  const heaven = FEO.classTiers.heaven.order;
  return (library.targetsOf.get(last.id) ?? []).filter((target) => target.order < heaven);
}

/* -------------------------------------------- */
/*  What a Unit Comes To                        */
/* -------------------------------------------- */

/**
 * Find what a unit carries in the library.
 * @param {object} library
 * @param {{uuid: string, name: string, type: string}} carried
 * @returns {object|null}
 */
function carriedIn(library, carried) {
  const id = String(carried.uuid ?? "").split(".").pop();
  const found = library.weaponsById.get(id) ?? library.gearById.get(id);
  if ( found ) return found;
  const name = carried.name.toLowerCase();
  const all = [...library.weaponsById.values(), ...library.gearById.values()];
  return all.find((entry) => entry.name.toLowerCase() === name) ?? null;
}

/* -------------------------------------------- */

/**
 * A kit for a unit, as what it carries is kept: its weapon in its hand.
 * @param {NpcSpec} spec
 * @param {object} library
 * @returns {import("../rules/npc.mjs").NpcCarried[]}
 */
export function kitFor(spec, library) {
  const build = buildNpc(spec, lineOf(library, spec), { known: (name) => !!findSkill(library, name) });
  if ( !build ) return [];
  const weapons = [...library.weaponsById.values()].filter((weapon) => weapon.uuid && !isBroken(weapon));
  const kit = suggestKit(build.unit, weapons, [...library.gearById.values()].filter((item) => item.uuid), {
    order: FEO.classTiers[build.classes.at(-1).system.tier]?.order
  });
  return kit.map((entry, index) => ({
    uuid: entry.uuid,
    name: entry.name,
    type: ("category" in entry) ? "weapon" : "gear",
    drop: "",
    equipped: (index === 0) && ("category" in entry)
  }));
}

/* -------------------------------------------- */

/**
 * @typedef NpcView
 * A unit as it would come out, before it is saved.
 * @property {NpcBuild} build
 * @property {object[]} line                      Its classes, as the class rules read them
 * @property {{from: number, to: number, promotes: boolean}} span     The Levels its last class holds
 * @property {object[]} carried                   What it carries: each as kept, with `entry` (as the library
 *                                                has it), `weapon`, `fit` and `hand` (is it the weapon in hand?)
 * @property {object|null} weapon                 The weapon in its hand, as the library has it
 * @property {Record<string, number>} combat      Its combat stats with that weapon
 * @property {number} wt
 */

/**
 * What a unit would come to.
 * @param {NpcSpec} spec
 * @param {object} library
 * @returns {NpcView|null}      Null for a unit without a class
 */
export function previewNpc(spec, library) {
  const line = lineOf(library, spec);
  const build = buildNpc(spec, line, { known: (name) => !!findSkill(library, name) });
  if ( !build ) return null;
  const carried = spec.pack.map((kept) => {
    const entry = carriedIn(library, kept);
    const weapon = !!entry && ("category" in entry);
    return { ...kept, entry, weapon, fit: weapon ? wields(build.unit, entry) : true, hand: false };
  });

  // The weapon in its hand: the one it was told to hold, or else the first it can wield
  const hand = carried.find((row) => row.weapon && row.fit && row.equipped) ?? carried.find((row) => row.weapon && row.fit) ?? null;
  if ( hand ) hand.hand = true;
  const weapon = hand?.entry ?? null;
  const stats = Object.fromEntries(Object.entries(build.unit.stats).map(([key, stat]) => [key, stat.base]));
  const combat = computeCombatStats({ stats }, weapon ? {
    might: weapon.might,
    hit: weapon.hit,
    crit: weapon.crit,
    weight: weapon.weight,
    damageStat: FEO.weaponCategories[weapon.category]?.magic ? "mag" : "str"
  } : null);
  return {
    build,
    line,
    span: levelSpan(build.classes),
    carried,
    weapon,
    combat,
    wt: unitWeight(stats.con, build.unit.wt.class)
  };
}

/* -------------------------------------------- */
/*  Units that were Made                        */
/* -------------------------------------------- */

/**
 * What the Game Master chose for a unit the builder made.
 * @param {Actor|null} actor
 * @returns {NpcSpec|null}      Null for a unit that was made another way
 */
export function specOf(actor) {
  const kept = actor?.getFlag?.(FEO.id, SPEC_FLAG);
  if ( !kept ) return null;
  try {
    return cleanSpec((typeof kept === "string") ? JSON.parse(kept) : kept);
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * The folder the builder keeps its units in, made the first time one is saved.
 * @returns {Promise<Folder|null>}
 */
async function npcFolder() {
  const found = game.folders.find((folder) => (folder.type === "Actor") && folder.getFlag(FEO.id, FOLDER_FLAG));
  if ( found ) return found;
  const Folder = foundry.documents.Folder.implementation;
  return Folder.create({ name: game.i18n.localize(FEO.npc.folder), type: "Actor", flags: { [FEO.id]: { [FOLDER_FLAG]: true } } });
}

/** A copy of an Item of the world or of a compendium, to give to a unit. */
function copyOf(source) {
  const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
  delete data._id;
  return data;
}

/* -------------------------------------------- */

/**
 * The data of a unit as the rules made it.
 * @param {NpcSpec} spec
 * @param {NpcBuild} build
 * @returns {object}            What to save under `system`
 */
function systemOf(spec, build) {
  const unit = build.unit;
  return {
    className: build.className,
    level: unit.level,
    exp: 0,
    army: spec.side,
    specialQualities: unit.specialQualities,
    hp: { value: unit.hp.max, max: unit.hp.max },
    wt: { class: unit.wt.class },
    stats: Object.fromEntries(Object.entries(unit.stats).map(([key, stat]) => [key, { base: stat.base }])),
    abilities: Object.fromEntries(Object.entries(unit.abilities).map(([key, ability]) => [key, { increase: ability.increase }])),
    growths: { ...unit.growths },
    proficiencies: Object.fromEntries(Object.entries(unit.proficiencies).map(([key, proficiency]) => [key, { rank: proficiency.rank }]))
  };
}

/* -------------------------------------------- */

/**
 * Save a unit: a new Unit in the builder's folder, or the one it was opened from, made over. Its numbers are
 * set as the rules give them, its classes are those of its line, it learns the skills it lacks and gives up
 * those the builder gave it that it no longer has, and what the builder had it carry is laid out anew. What
 * was added to it by hand on its sheet is left alone. Runs for a Game Master.
 * @param {NpcSpec} chosen
 * @param {object} [options]
 * @param {Actor|null} [options.actor]      The unit to make over
 * @param {object|null} [options.library]   The Compendium's library
 * @returns {Promise<Actor|null>}
 */
export async function saveNpc(chosen, { actor = null, library = null } = {}) {
  if ( !game.user.isGM ) return null;
  library ??= await Compendium.library();
  const spec = cleanSpec(chosen);
  const view = previewNpc(spec, library);
  if ( !view ) return null;
  const { build } = view;
  const last = build.classes.at(-1);
  const name = spec.name || build.className;
  const quiet = { [FEO.id]: { noPick: true } };
  const { FRIENDLY, HOSTILE, NEUTRAL } = CONST.TOKEN_DISPOSITIONS;
  const token = { name, actorLink: false, disposition: { enemy: HOSTILE, ally: FRIENDLY, other: NEUTRAL }[spec.side], bar1: { attribute: "hp" } };
  const flags = { [FEO.id]: { [SPEC_FLAG]: JSON.stringify(spec) } };
  const system = systemOf(spec, build);

  if ( actor ) await actor.update({ name, system, prototypeToken: token, flags });
  else {
    const Actor = foundry.documents.Actor.implementation;
    const folder = await npcFolder();
    const picture = last.img ? { img: last.img } : {};
    actor = await Actor.create({
      name,
      type: "unit",
      ...picture,
      folder: folder?.id ?? null,
      system,
      prototypeToken: last.img ? { ...token, texture: { src: last.img } } : token,
      flags
    });
    if ( !actor ) return null;
  }

  // Its classes: those of its line take the place of the ones it had
  const old = actor.items.filter((item) => item.type === "class").map((item) => item.id);
  let current = "";
  for ( const cls of build.classes ) {
    const source = cls.uuid ? await foundry.utils.fromUuid(cls.uuid) : null;
    if ( !source ) continue;
    const [owned] = await actor.createEmbeddedDocuments("Item", [copyOf(source)], quiet);
    current = owned?.id ?? current;
  }
  await actor.update({ "system.classId": current });
  if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);

  // Its skills: those the builder gave it before that it no longer has go, and those it lacks are learnt. What
  // its Special Qualities build into it is the system's to give and to take away
  const given = build.skills.filter((skill) => skill.source !== "builtIn");
  const wanted = new Set(given.map((skill) => skill.name.toLowerCase()));
  const gone = actor.items.filter((item) => (item.type === "skill") && item.getFlag(FEO.id, MADE_FLAG) && !item.getFlag(FEO.id, "builtIn")
    && !wanted.has(item.name.toLowerCase()));
  if ( gone.length ) await actor.deleteEmbeddedDocuments("Item", gone.map((item) => item.id));
  const before = new Set(actor.items.map((item) => item.id));
  await grantSkills(actor, given.map((skill) => ({ name: skill.name, kind: skill.kind })));
  const learnt = actor.items.filter((item) => (item.type === "skill") && !before.has(item.id) && wanted.has(item.name.toLowerCase()));
  if ( learnt.length ) {
    await actor.updateEmbeddedDocuments("Item", learnt.map((item) => ({ _id: item.id, [`flags.${FEO.id}.${MADE_FLAG}`]: true })));
  }

  // What it carries: what the builder laid out before is cleared away, and laid out anew
  const laid = actor.items.filter((item) => ["weapon", "gear"].includes(item.type) && item.getFlag(FEO.id, MADE_FLAG));
  if ( laid.length ) await actor.deleteEmbeddedDocuments("Item", laid.map((item) => item.id));
  const pack = [];
  for ( const row of view.carried ) {
    const source = row.entry?.uuid ? await foundry.utils.fromUuid(row.entry.uuid) : null;
    if ( !source ) continue;
    const data = copyOf(source);
    data.system ??= {};
    if ( data.type === "weapon" ) data.system.equipped = row.hand;
    data.flags = { ...(data.flags ?? {}), [FEO.id]: { ...(data.flags?.[FEO.id] ?? {}), [MADE_FLAG]: true, [DROP_FLAG]: row.drop } };
    pack.push(data);
  }

  // A weapon the unit had in hand that the builder did not give it is put away for the one it is told to hold
  if ( pack.some((data) => data.system.equipped) ) {
    const held = actor.items.filter((item) => (item.type === "weapon") && item.system.equipped);
    if ( held.length ) await actor.updateEmbeddedDocuments("Item", held.map((item) => ({ _id: item.id, "system.equipped": false })));
  }
  if ( pack.length ) await actor.createEmbeddedDocuments("Item", pack, quiet);
  await syncBuiltIn(actor);
  return actor;
}

/* -------------------------------------------- */

/**
 * What sets a copy of a unit that varies apart from the unit it is a copy of: the stats its own rolls gave it.
 * @param {NpcSpec} spec
 * @param {object} library
 * @param {string} seed         What this copy rolls from
 * @returns {object|null}       What to keep on its token, or null where the unit cannot be made
 */
export function copyDelta(spec, library, seed) {
  const build = buildNpc({ ...spec, mode: "rolled", seed }, lineOf(library, spec), { known: (name) => !!findSkill(library, name) });
  if ( !build ) return null;
  const { hp, stats, abilities } = systemOf(spec, build);
  return { system: { hp, stats, abilities } };
}

/* -------------------------------------------- */
/*  Drops                                       */
/* -------------------------------------------- */

/**
 * What a unit leaves behind when it is defeated, as the builder marked it.
 * @param {Actor|null} actor
 * @returns {{name: string, drop: "players"|"any"}[]}
 */
export function dropsOf(actor) {
  return (actor?.items ?? []).filter((item) => ["players", "any"].includes(item.getFlag?.(FEO.id, DROP_FLAG)))
    .map((item) => ({ name: item.name, drop: item.getFlag(FEO.id, DROP_FLAG) }));
}

/* -------------------------------------------- */

/**
 * A unit's HP changed: one that fell with something marked to be left behind has it told in chat, once. One
 * that is back on its feet may leave it behind again.
 * @param {Actor} actor
 * @param {object} changed
 * @returns {Promise<void>}
 */
async function tellDrops(actor, changed) {
  if ( !game.user.isActiveGM || (actor.type !== "unit") || !foundry.utils.hasProperty(changed, "system.hp.value") ) return;
  const told = !!actor.getFlag(FEO.id, DROPPED_FLAG);
  if ( actor.system.hp.value > 0 ) {
    if ( told ) await actor.unsetFlag(FEO.id, DROPPED_FLAG);
    return;
  }
  const drops = dropsOf(actor);
  if ( told || !drops.length ) return;
  await actor.setFlag(FEO.id, DROPPED_FLAG, true);
  const ChatMessage = foundry.documents.ChatMessage.implementation;
  const escape = foundry.utils.escapeHTML ?? ((text) => text);
  const items = drops.map((drop) => game.i18n.format(`FEO.Npc.drops.${drop.drop}`, { item: escape(drop.name) })).join(", ");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${game.i18n.format("FEO.Npc.drops.card", { name: escape(actor.token?.name ?? actor.name), items })}</p>`
  });
}

/* -------------------------------------------- */

/**
 * Follow the units the builder made: what one leaves behind is told as it falls.
 */
export function registerHooks() {
  Hooks.on("updateActor", (actor, changed) => {
    tellDrops(actor, changed).catch((err) => console.error(err));
  });
}

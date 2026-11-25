import { FEO } from "../config.mjs";
import { IMITATED_FLAG } from "../rules/imitation.mjs";
import {
  SYNC_FLAG, cleanBand, levelUpsWaiting, readRecord, readSync, recordChange, shareOfHp, skillsOff, snapshotOf, standingOf, takenOf, unitAt
} from "../rules/level-sync.mjs";
import { postCard } from "./chat.mjs";
import { settleHand } from "./imitation.mjs";
import { isPlayerUnit } from "./players.mjs";
import { wieldCheck } from "./weapons.mjs";

/**
 * Level Sync in Foundry (see `rules/level-sync.mjs`): a unit keeps a record of what it was at each Level it
 * leaves; an encounter that is for a band of Levels syncs the player units above it as its battle begins, and
 * those that are put on its map afterwards; and they are themselves again when the battle is over.
 *
 * Nothing of a unit's own is written over. What it was is kept on it as the flag `levelSync` and laid over its
 * numbers as they are prepared (see `prepareBaseData` of the unit's data); the skills it did not have yet are
 * set aside while that note is there. What is written to the unit meanwhile is only what is its own to have: its
 * HP and the weapon in its hand. So ending a sync is taking the note away again.
 */

/** What the updates of a sync tell the rest of the system: HP that changes with it is no damage and no healing. */
const QUIET = { [FEO.id]: { quietHp: true } };

/** Units as an encounter would have them, kept until something about a unit changes (see `syncedView`). */
const VIEWS = new Map();

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * A unit's Level Sync, as it is noted on it.
 * @param {Actor|null} actor
 * @returns {object|null}     Null for a unit that is not synced
 */
export function syncOf(actor) {
  return readSync(actor?.flags?.[FEO.id]?.[SYNC_FLAG]);
}

/* -------------------------------------------- */

/**
 * The band a scene's battle is synced to, if it is.
 * @param {Scene|null} scene
 * @returns {{min: number, max: number, encounter: string, name: string}|null}
 */
export function bandOf(scene) {
  const kept = scene?.flags?.[FEO.id]?.[SYNC_FLAG];
  if ( !kept || (typeof kept !== "object") ) return null;
  const band = cleanBand({ ...kept, on: true });
  return { min: band.min, max: band.max, encounter: String(kept.encounter ?? ""), name: String(kept.name ?? "") };
}

/* -------------------------------------------- */

/**
 * What a unit is, from its own data as it is saved, as its Level record would keep it.
 * @param {Actor} actor
 * @returns {import("../rules/level-sync.mjs").Snapshot}
 */
function ownSnapshot(actor) {
  const own = actor._source.system;
  const cls = actor.items.get(own.classId);
  return snapshotOf(own, {
    classId: (cls?.type === "class") ? cls.id : "",
    className: (cls?.type === "class") ? cls.name : own.className,
    skills: actor.items.filter((item) => (item.type === "skill") && !item.flags?.[FEO.id]?.[IMITATED_FLAG]).map((item) => item.id)
  });
}

/* -------------------------------------------- */

/**
 * What is known of how a unit came by its Levels, for the Levels its record does not hold: the Levels it
 * reached by promoting, with what each class gave and the class it left, the milestones of a class that does
 * not promote, and the base stats of the class it started in.
 * @param {Actor} actor
 * @returns {{jumps: import("../rules/level-sync.mjs").Jump[], floor: Record<string, number>}}
 */
function pastOf(actor) {
  const tiers = FEO.classTiers;
  const order = (item) => tiers[item.system.tier]?.order ?? 0;
  const current = actor.items.get(actor._source.system.classId);
  if ( current?.type !== "class" ) return { jumps: [], floor: {} };
  const line = actor.items.filter((item) => (item.type === "class") && !item.flags?.[FEO.id]?.[IMITATED_FLAG] && (order(item) <= order(current)))
    .sort((a, b) => (order(b) - order(a)) || ((a === current) ? -1 : (b === current) ? 1 : 0));
  const jumps = [];
  let first = current;
  for ( let cls = current; cls; ) {
    first = cls;
    const tier = tiers[cls.system.tier] ?? {};
    const earlier = line.find((other) => order(other) < order(cls)) ?? null;

    // A class that was promoted into at a Level its tier starts with, counting on from the Levels before
    if ( Number.isInteger(tier.startLevel) && (tier.startLevel > 1) && !tier.resetLevel ) {
      const gains = Object.fromEntries(Object.entries(cls.system.gains ?? {}).filter(([, amount]) => amount > 0));
      jumps.push({ at: tier.startLevel, gains, from: earlier ? { id: earlier.id, name: earlier.name, wt: earlier.system.wt ?? 0 } : null });
    }
    if ( tier.resetLevel ) break;
    cls = earlier;
  }

  // A class that levels on in place of promoting gains the same at each of its milestones
  if ( !current.system.promotesTo?.length && (order(current) <= tiers.base.order) && FEO.races[current.system.race]?.milestones ) {
    for ( const level of Object.keys(FEO.milestoneLevels) ) jumps.push({ at: Number(level), gains: { ...FEO.milestoneGains }, from: null });
  }
  const floor = Object.fromEntries(Object.entries(first.system.base ?? {}).filter(([, value]) => Number.isFinite(value)));
  return { jumps, floor };
}

/* -------------------------------------------- */
/*  Syncing a Unit                              */
/* -------------------------------------------- */

/**
 * The note a unit would keep were it synced to a Level: what it was at that Level, and what has to be set aside.
 * Nothing is written.
 * @param {Actor} actor
 * @param {number} level
 * @param {object} [about]      What the note says of where it is synced: `encounter`, `name`, `scene`
 * @returns {object|null}       Null for a unit that is at that Level or under it
 */
export function planSync(actor, level, about = {}) {
  if ( actor?.type !== "unit" ) return null;
  const own = actor._source.system;
  if ( !Number.isInteger(level) || (level < 1) || (own.level <= level) ) return null;
  const found = unitAt(readRecord(own.levels), level, { level: own.level, snapshot: ownSnapshot(actor) }, { growths: own.growths, ...pastOf(actor) });

  // The class it had then, where it is still an Item of its own; else the class it has, under its own name
  const was = actor.items.get(found.snapshot.cls.id);
  const taken = takenOf(found.snapshot);
  if ( was?.type !== "class" ) taken.className = own.className;
  const skills = actor.items.filter((item) => (item.type === "skill") && !item.flags?.[FEO.id]?.[IMITATED_FLAG]).map((item) => item.id);
  return {
    level,
    own: own.level,
    exact: found.exact,
    from: found.from,
    taken,
    classId: (was?.type === "class") ? was.id : "",
    off: skillsOff(skills, found.snapshot),
    encounter: String(about.encounter ?? ""),
    name: String(about.name ?? ""),
    scene: String(about.scene ?? ""),
    hand: ""
  };
}

/* -------------------------------------------- */

/**
 * A unit as it would be were it synced to a Level, without anything being written: a copy of it, in memory
 * only, that carries the note. A unit at that Level or under it is given back as it is. The copy is kept until
 * something about a unit changes (see `forgetViews`).
 * @param {Actor} actor
 * @param {number} level
 * @returns {Actor}
 */
export function syncedView(actor, level) {
  if ( syncOf(actor) ) return actor;
  const key = `${actor.uuid}@${level}`;
  if ( VIEWS.has(key) ) return VIEWS.get(key);
  let view = actor;
  try {
    const note = planSync(actor, level);
    if ( note ) view = actor.clone({ flags: { [FEO.id]: { [SYNC_FLAG]: note } } }, { keepId: true });
  } catch(err) {
    console.warn(err);
  }
  VIEWS.set(key, view);
  return view;
}

/**
 * Forget the units kept as an encounter would have them: something about a unit has changed.
 */
export function forgetViews() {
  VIEWS.clear();
}

/* -------------------------------------------- */

/** The numbers of a unit that a Level Sync is told by, in the order of the sheet. */
const TOLD = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con"];

/**
 * How a unit would change were it synced to a Level, for the Encounter Builder to show: its numbers with what
 * each loses, the class it goes back to, the skills that are set aside and the weapons it could not yet wield.
 * For a unit that is synced already, what it is now, with nothing to hold it against.
 * @param {Actor} actor
 * @param {number} level
 * @returns {object|null}     Null for a unit that Level changes nothing about
 */
export function previewSync(actor, level) {
  const view = syncedView(actor, level);
  const synced = view?.system?.synced;
  if ( !synced ) return null;
  const now = (view === actor) ? null : actor;
  const value = (unit, key) => ((key === "hp") ? (unit.system.hp?.max ?? 0) : (unit.system.statValues?.[key] ?? 0));
  return {
    level: synced.level,
    own: synced.own,
    exact: synced.exact,
    from: synced.from,
    className: view.system.className ?? "",
    ownClassName: now ? (now.system.className ?? "") : "",
    stats: TOLD.map((key) => ({ key, value: value(view, key), cut: now ? Math.max(value(now, key) - value(view, key), 0) : 0 })),
    skills: view.items.filter((item) => (item.type === "skill") && (item.system.equipped || item.system.setAside))
      .map((item) => ({ name: item.name, off: !!item.system.syncedOff })),
    weapons: view.items.filter((item) => item.type === "weapon").map((item) => {
      const check = wieldCheck(view, item);
      return { name: item.name, off: !check.ok, needs: String(check.needs ?? item.system.rank ?? "") };
    })
  };
}

/* -------------------------------------------- */

/**
 * Sync a unit down to a Level: it has what it was at that Level until the sync ends. Its HP keeps its share of
 * the maximum, and a weapon it could not yet wield is put away for one it could. Runs for whoever may change the
 * unit; a unit at that Level or under it is left as it is.
 * @param {Actor} actor
 * @param {number} level
 * @param {object} [about]      Where it is synced: `encounter`, `name`, `scene`
 * @returns {Promise<object|null>}    Its note, or null where nothing was done
 */
export async function syncUnit(actor, level, about = {}) {
  if ( (actor?.type !== "unit") || !actor.isOwner ) return null;
  const there = syncOf(actor);
  if ( there && (there.level === level) ) return there;
  if ( there ) await endSync(actor);
  const note = planSync(actor, level, about);
  if ( !note ) return null;
  note.hand = actor.system.equippedWeapon?.id ?? "";
  const before = actor.system.hp.max;
  await actor.update({ [`flags.${FEO.id}.${SYNC_FLAG}`]: note }, QUIET);
  forgetViews();
  try {
    const hp = shareOfHp(actor.system.hp.value, before, actor.system.hp.max);
    if ( hp !== actor.system.hp.value ) await actor.update({ "system.hp.value": hp }, QUIET);

    // A weapon it could not yet wield is put away for one it could, which the note remembers
    const hand = await settleHand(actor);
    if ( note.hand && hand.unequip.includes(note.hand) ) {
      await actor.update({ [`flags.${FEO.id}.${SYNC_FLAG}.took`]: hand.equip ?? "none" });
    }
  } catch(err) {
    console.error(err);
  }
  Hooks.callAll(`${FEO.id}.levelSynced`, actor, note);
  return syncOf(actor);
}

/* -------------------------------------------- */

/**
 * The weapon a unit held before its Level Sync is in its hand again, where the sync had put it away and the
 * unit still holds what it took up in its place: a weapon it chose for itself meanwhile stays where it is.
 * @param {Actor} actor       The unit, itself again
 * @param {object} note       The note it had
 * @returns {Promise<void>}
 */
async function handBack(actor, note) {
  const held = actor.system.equippedWeapon?.id ?? "none";
  const own = note.took ? actor.items.get(note.hand) : null;
  if ( !own || (held !== note.took) || own.system.broken || !wieldCheck(actor, own).ok ) {
    await settleHand(actor, note.hand);
    return;
  }
  await actor.updateEmbeddedDocuments("Item", [
    ...((held !== "none") ? [{ _id: held, "system.equipped": false }] : []),
    { _id: own.id, "system.equipped": true }
  ]);
}

/* -------------------------------------------- */

/**
 * End a unit's Level Sync: it is itself again, with the same share of its HP, and what it held before in its
 * hand. Safe to call for a unit that is not synced.
 * @param {Actor} actor
 * @returns {Promise<object|null>}    The note it had, or null where it had none
 */
export async function endSync(actor) {
  const note = syncOf(actor);
  if ( !note || !actor.isOwner ) return null;
  const before = actor.system.hp.max;
  await actor.unsetFlag(FEO.id, SYNC_FLAG);
  forgetViews();
  try {
    const hp = shareOfHp(actor.system.hp.value, before, actor.system.hp.max);
    if ( hp !== actor.system.hp.value ) await actor.update({ "system.hp.value": hp }, QUIET);
    await handBack(actor, note);
  } catch(err) {
    console.error(err);
  }
  Hooks.callAll(`${FEO.id}.levelSyncEnds`, actor, note);
  return note;
}

/* -------------------------------------------- */
/*  A Battle                                    */
/* -------------------------------------------- */

/**
 * Tell the table of a Level Sync, as a card in the chat.
 * @param {string} title
 * @param {string} subtitle
 * @param {{label: string, value: string}[]} rows
 * @returns {Promise<void>}
 */
async function tell(title, subtitle, rows) {
  if ( !rows.length ) return;
  try {
    await postCard(null, { title, subtitle, rows: rows.map((row) => ({ ...row, cls: "strong" })), cls: "level-sync" });
  } catch(err) {
    console.error(err);
  }
}

/** The words for a band: "Lv 10", or "Lv 5 to 10". */
function bandLabel(band) {
  return game.i18n.format((band.min === band.max) ? "FEO.LevelSync.bandOne" : "FEO.LevelSync.band", { min: band.min, max: band.max });
}

/**
 * The player units of a scene, with those an encounter says are going: each once.
 * @param {Scene} scene
 * @param {string[]} [party]      The ids of the units that are going
 * @returns {Actor[]}
 */
function playersOn(scene, party = []) {
  const units = new Set();
  for ( const token of scene?.tokens ?? [] ) {
    const actor = token.actor;
    if ( (actor?.type === "unit") && token.actorLink && isPlayerUnit(actor) ) units.add(actor);
  }
  for ( const id of party ) {
    const actor = game.actors.get(id);
    if ( actor?.type === "unit" ) units.add(actor);
  }
  return [...units];
}

/* -------------------------------------------- */

/**
 * The battle of an encounter begins: where the encounter is for a band of Levels, its scene keeps that band, the
 * player units on its map and those that are going are synced down to its top Level, and the table is told.
 * An encounter that is not synced ends any sync its scene still had. Runs for a Game Master.
 * @param {import("../rules/encounters.mjs").Encounter} encounter
 * @param {Scene} scene
 * @returns {Promise<Actor[]>}      The units that were synced
 */
export async function beginSync(encounter, scene) {
  if ( !game.user.isGM || !scene ) return [];
  const band = cleanBand(encounter?.sync);
  if ( bandOf(scene) ) await endSyncOn(scene, { quiet: true });
  if ( !band.on ) return [];
  await scene.setFlag(FEO.id, SYNC_FLAG, { min: band.min, max: band.max, encounter: encounter.id, name: encounter.name });

  const synced = [];
  const rows = [];
  for ( const actor of playersOn(scene, encounter.party) ) {
    try {
      const own = actor._source.system.level;
      if ( standingOf(own, band).kind !== "sync" ) continue;
      const note = await syncUnit(actor, band.max, { encounter: encounter.id, name: encounter.name, scene: scene.id });
      if ( !note ) continue;
      synced.push(actor);
      rows.push({ label: actor.name, value: game.i18n.format("FEO.LevelSync.card.down", { own, level: note.level }) });
    } catch(err) {
      console.error(err);
    }
  }
  await tell(game.i18n.localize("FEO.LevelSync.title"), [encounter.name, bandLabel(band)].filter(Boolean).join(" · "), rows);
  return synced;
}

/* -------------------------------------------- */

/**
 * The units that are synced for the battle of a scene.
 * @param {Scene} scene
 * @returns {Actor[]}
 */
function syncedOn(scene) {
  return game.actors.filter((actor) => (actor.type === "unit") && (syncOf(actor)?.scene === scene.id));
}

/**
 * The battle of a scene is over, or its sync is ended early: every unit that was synced for it is itself again,
 * the scene forgets its band, and the table is told who has Level ups waiting. Runs for a Game Master; safe to
 * call for a scene that is not synced.
 * @param {Scene|null} scene
 * @param {object} [options]
 * @param {boolean} [options.quiet]     Say nothing in the chat
 * @returns {Promise<number>}           How many units it ended for
 */
export async function endSyncOn(scene, { quiet = false } = {}) {
  if ( !game.user.isGM || !scene ) return 0;
  const band = bandOf(scene);
  const rows = [];
  for ( const actor of syncedOn(scene) ) {
    try {
      const note = await endSync(actor);
      if ( !note ) continue;
      const waiting = levelUpsWaiting(actor._source.system.exp);
      rows.push({
        label: actor.name,
        value: waiting
          ? game.i18n.format((waiting === 1) ? "FEO.LevelSync.card.backOne" : "FEO.LevelSync.card.backMany", { level: note.own, count: waiting })
          : game.i18n.format("FEO.LevelSync.card.back", { level: note.own })
      });
    } catch(err) {
      console.error(err);
    }
  }
  if ( band ) await scene.unsetFlag(FEO.id, SYNC_FLAG);
  if ( !quiet ) await tell(game.i18n.localize("FEO.LevelSync.ended"), band?.name ?? "", rows);
  return rows.length;
}

/* -------------------------------------------- */

/**
 * A token is put on a map whose battle is synced: a player unit above its band is synced as it arrives.
 * Done by one Game Master's client.
 * @param {TokenDocument} token
 * @returns {Promise<void>}
 */
async function onArrival(token) {
  const scene = token.parent;
  const band = bandOf(scene);
  const actor = token.actor;
  if ( !band || !game.user.isActiveGM || (actor?.type !== "unit") || !token.actorLink || !isPlayerUnit(actor) || syncOf(actor) ) return;
  const own = actor._source.system.level;
  if ( own <= band.max ) return;
  const note = await syncUnit(actor, band.max, { encounter: band.encounter, name: band.name, scene: scene.id });
  if ( !note ) return;
  await tell(game.i18n.localize("FEO.LevelSync.title"), [band.name, bandLabel(band)].filter(Boolean).join(" · "), [
    { label: actor.name, value: game.i18n.format("FEO.LevelSync.card.down", { own, level: note.level }) }
  ]);
}

/* -------------------------------------------- */

/**
 * A world opens: a unit that is still synced for a scene that is gone, or whose battle is over or no longer
 * synced, is itself again. One whose battle still runs is left as it is. Runs for the designated Game Master.
 * @returns {Promise<void>}
 */
export async function sweepSyncs() {
  // A scene that still keeps the band of a battle nobody fights on it any more forgets it, and its units with it
  for ( const scene of game.scenes ) {
    try {
      if ( bandOf(scene) && !game.combats.some((combat) => combat.scene?.id === scene.id) ) await endSyncOn(scene, { quiet: true });
    } catch(err) {
      console.error(err);
    }
  }
  for ( const actor of game.actors ) {
    try {
      const note = (actor.type === "unit") ? syncOf(actor) : null;
      if ( !note || !note.scene ) continue;
      if ( !bandOf(game.scenes.get(note.scene)) ) await endSync(actor);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what Level Sync listens for. Called once, when the system starts.
 */
export function registerHooks() {
  // The Level record: as the Level of a player's unit changes, by whatever way, what it was at the Level it
  // leaves is noted with that very change. A unit that already has a record goes on keeping it
  Hooks.on("preUpdateActor", (actor, changed) => {
    if ( actor.type !== "unit" ) return;
    const to = changed?.system?.level;
    const own = actor._source.system;
    if ( !Number.isInteger(to) || (to === own.level) ) return;
    if ( !isPlayerUnit(actor) && !Object.keys(own.levels ?? {}).length ) return;
    try {
      const { noted, forgotten } = recordChange(own.levels, own.level, to, ownSnapshot(actor));
      if ( !Object.keys(noted).length && !forgotten.length ) return;
      const levels = { ...(changed.system.levels ?? {}), ...noted };
      for ( const level of forgotten ) levels[level] = new foundry.data.operators.ForcedDeletion();
      changed.system.levels = levels;
    } catch(err) {
      console.error(err);
    }
  });

  Hooks.on("createToken", (token) => {
    onArrival(token).catch((err) => console.error(err));
  });

  // Units as an encounter would have them hold until a unit changes, or what one holds does
  for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "deleteActor"] ) Hooks.on(hook, forgetViews);

  Hooks.once("ready", () => {
    if ( game.users.activeGM?.isSelf ) sweepSyncs().catch((err) => console.error(err));
  });
}

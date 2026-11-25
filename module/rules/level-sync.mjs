/**
 * Level Sync for Fire Emblem Online: an encounter may be for a band of Levels, and a unit above that band fights
 * in it as it was at the band's top Level, for as long as the battle lasts. Pure functions of plain data, so
 * that they can be tested outside of Foundry.
 *
 * The rulebook has no such thing, so all of this is the system's own.
 *
 * What a unit was at a Level is read from its Level record: each time its Level goes up, what it was at the
 * Level it leaves is noted (see `snapshotOf` and `recordChange`). A Level the record does not hold, as for a unit
 * that levelled up before the record was kept, is estimated by walking back from the nearest Level that is known
 * (see `unitAt`): each Level up takes back what its growth rates gave on average, and a promotion takes back
 * exactly what its class gave.
 *
 * Nothing of the unit's own is written over. What it was is kept beside it as a note, and laid over its own
 * numbers each time they are read, the way an imitation is (see `overlay` in `imitation.mjs`); the skills it
 * learned since are set aside for as long. So it is itself again, exactly, as soon as the note is gone.
 *
 * What comes down: its Level, its maximum HP, its stats with their boosts, Charm and Intelligence, its Weapon
 * Level, its weapon ranks, its Special Qualities, its Class Weight, its class where the sync goes back past a
 * promotion, and the skills it did not yet have. What stays: its HP as a share of the maximum, its experience,
 * what it carries, its Gold, its supports, its Wounds, its conditions and its growth rates.
 */
import { FEO } from "../config.mjs";

/** The flag a unit keeps its Level Sync under, and the one a scene keeps the band of its battle under. */
export const SYNC_FLAG = "levelSync";

const plain = (value) => !!value && (typeof value === "object") && !Array.isArray(value);
const whole = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback);
const text = (value) => ((typeof value === "string") ? value : "");

/* -------------------------------------------- */
/*  The Band                                    */
/* -------------------------------------------- */

/**
 * @typedef LevelBand
 * The Levels an encounter is for.
 * @property {boolean} on     Is the encounter synced at all?
 * @property {number} min     Its lowest Level: a unit under it is marked, and nothing more
 * @property {number} max     Its highest Level: a unit above it fights as it was at this Level
 */

/**
 * The band of an encounter, read from what was kept of it: anything missing or out of place is put right.
 * @param {object} [raw]
 * @param {object} [config]     FEO.levelSync
 * @returns {LevelBand}
 */
export function cleanBand(raw = {}, config = FEO.levelSync) {
  const max = Math.min(Math.max(whole(raw?.max, config.max), 1), config.most);
  const min = Math.min(Math.max(whole(raw?.min, config.min), 1), max);
  return { on: !!raw?.on, min, max };
}

/* -------------------------------------------- */

/**
 * How a unit stands to a band: above it and synced down to its top, under it, inside it, or the band is off.
 * @param {number} level            The unit's own Level
 * @param {LevelBand|null} band
 * @returns {{kind: "off"|"in"|"sync"|"under", level: number}}     The Level it goes at
 */
export function standingOf(level, band) {
  const own = Math.max(whole(level, 1), 1);
  if ( !band?.on ) return { kind: "off", level: own };
  if ( own > band.max ) return { kind: "sync", level: band.max };
  if ( own < band.min ) return { kind: "under", level: own };
  return { kind: "in", level: own };
}

/* -------------------------------------------- */
/*  The Level Record                            */
/* -------------------------------------------- */

/**
 * @typedef Snapshot
 * What a unit was at a Level, as its record keeps it. Kept short: only what is not nothing is written.
 * @property {number} hp                              Its maximum HP
 * @property {Record<string, number>} stats           The base of each stat
 * @property {Record<string, number>} boosts          The boost of each stat that had one
 * @property {Record<string, number>} abilities       What Charm and Intelligence had been increased by
 * @property {Record<string, number>} abilityBoosts   Their boosts, where they had one
 * @property {number} wt                              Its Class Weight
 * @property {Record<string, [string, number]>} ranks Its rank and weapon experience in each proficiency it had
 * @property {number} wlv                             Its Weapon Level
 * @property {string} qualities                       Its Special Qualities
 * @property {{id: string, name: string}} cls         Its class: the Item it was on the unit, and its name
 * @property {string[]} skills                        The skills it had, by the Item each is on the unit
 */

/**
 * What a unit is right now, from its data as it is saved, as its record would keep it.
 * @param {object} system               The unit's saved data
 * @param {object} [about]
 * @param {string} [about.classId]      The Item that is its class
 * @param {string} [about.className]    The name of its class
 * @param {string[]} [about.skills]     The skills it has, by Item
 * @returns {Snapshot}
 */
export function snapshotOf(system, { classId = null, className = null, skills = [] } = {}) {
  const number = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
  const some = (entries) => Object.fromEntries(entries.filter(([, value]) => value !== 0));
  const stats = Object.keys(FEO.stats);
  const abilities = Object.keys(FEO.abilities);
  const ranks = {};
  for ( const key of Object.keys(FEO.proficiencies) ) {
    const proficiency = system?.proficiencies?.[key];
    if ( !(proficiency?.rank in FEO.ranks) || (proficiency.rank === "F") ) continue;
    ranks[key] = [proficiency.rank, number(proficiency.wexp)];
  }
  return {
    hp: number(system?.hp?.max),
    stats: Object.fromEntries(stats.map((key) => [key, number(system?.stats?.[key]?.base)])),
    boosts: some(stats.map((key) => [key, number(system?.stats?.[key]?.boost)])),
    abilities: Object.fromEntries(abilities.map((key) => [key, number(system?.abilities?.[key]?.increase)])),
    abilityBoosts: some(abilities.map((key) => [key, number(system?.abilities?.[key]?.boost)])),
    wt: number(system?.wt?.class),
    ranks,
    wlv: number(system?.weaponLevel?.base, FEO.optional.weaponLevel.start),
    qualities: String(system?.specialQualities ?? ""),
    cls: { id: String(classId ?? system?.classId ?? ""), name: String(className ?? system?.className ?? "") },
    skills: [...new Set((skills ?? []).filter((id) => (typeof id === "string") && id))]
  };
}

/* -------------------------------------------- */

/**
 * A snapshot made sound, so that one that was tampered with changes nothing it should not. Null for anything
 * that is no snapshot.
 * @param {*} raw
 * @returns {Snapshot|null}
 */
export function readSnapshot(raw) {
  if ( !plain(raw) || !plain(raw.stats) ) return null;
  const numbers = (from, keys) => Object.fromEntries(keys.filter((key) => Number.isFinite(from?.[key])).map((key) => [key, from[key]]));
  const stats = Object.keys(FEO.stats);
  const abilities = Object.keys(FEO.abilities);
  const ranks = {};
  for ( const key of Object.keys(FEO.proficiencies) ) {
    const [rank, wexp] = Array.isArray(raw.ranks?.[key]) ? raw.ranks[key] : [];
    if ( (rank in FEO.ranks) && (rank !== "F") ) ranks[key] = [rank, Number.isFinite(wexp) ? Math.max(wexp, 0) : 0];
  }
  return {
    hp: Number.isFinite(raw.hp) ? Math.max(raw.hp, 0) : 0,
    stats: Object.fromEntries(stats.map((key) => [key, Number.isFinite(raw.stats[key]) ? Math.max(raw.stats[key], 0) : 0])),
    boosts: numbers(raw.boosts, stats),
    abilities: Object.fromEntries(abilities.map((key) => [key, Number.isFinite(raw.abilities?.[key]) ? raw.abilities[key] : 0])),
    abilityBoosts: numbers(raw.abilityBoosts, abilities),
    wt: Number.isFinite(raw.wt) ? raw.wt : 0,
    ranks,
    wlv: Number.isFinite(raw.wlv) ? Math.max(raw.wlv, 0) : FEO.optional.weaponLevel.start,
    qualities: text(raw.qualities),
    cls: { id: text(raw.cls?.id), name: text(raw.cls?.name) },
    skills: Array.isArray(raw.skills) ? raw.skills.filter((id) => (typeof id === "string") && id) : []
  };
}

/* -------------------------------------------- */

/**
 * A unit's Level record, made sound: what it was at each Level it has left, by that Level.
 * @param {*} raw
 * @returns {Record<number, Snapshot>}
 */
export function readRecord(raw) {
  const record = {};
  if ( !plain(raw) ) return record;
  for ( const [key, value] of Object.entries(raw) ) {
    const level = Number(key);
    const snapshot = readSnapshot(value);
    if ( Number.isInteger(level) && (level >= 1) && snapshot ) record[level] = snapshot;
  }
  return record;
}

/* -------------------------------------------- */

/**
 * What changes in a unit's Level record as its Level does. Going up, what it was at the Level it leaves is
 * noted. Going down, as when a Level is put right by hand or a promotion starts its Levels anew, what was noted
 * for the Levels it no longer has left is forgotten: those are not behind it any more.
 * @param {*} levels              Its record, as it is saved
 * @param {number} from           Its Level
 * @param {number} to             The Level it goes to
 * @param {Snapshot} snapshot     What it is, before anything else of that change
 * @returns {{noted: Record<number, Snapshot>, forgotten: number[]}}    The snapshot to keep, by its Level, and
 *                                              the Levels whose snapshots go. Both empty when nothing changes
 */
export function recordChange(levels, from, to, snapshot) {
  const change = { noted: {}, forgotten: [] };
  if ( !Number.isInteger(from) || !Number.isInteger(to) || (from === to) ) return change;
  const notes = (to > from) && (from >= 1) && !!snapshot;
  if ( notes ) change.noted[from] = snapshot;
  change.forgotten = Object.keys(readRecord(levels)).map(Number).filter((level) => (level >= to) && !(notes && (level === from)));
  return change;
}

/* -------------------------------------------- */
/*  What a Unit Was                             */
/* -------------------------------------------- */

/**
 * @typedef Jump
 * A Level that was reached by something other than a Level up: a promotion, or the milestone of a class that
 * does not promote.
 * @property {number} at                          The Level it was reached with
 * @property {Record<string, number>} gains       What it added, by stat; `hp` for maximum HP
 * @property {{id: string, name: string, wt: number}|null} [from]     The class that was left, where one was
 */

/**
 * What a unit was at a Level.
 *
 * Where its record holds that Level, that is what it was. Otherwise it is estimated from the nearest Level above
 * that is known, which at the last is what the unit is now: each Level between is walked back. A Level that was
 * reached with a jump takes back what the jump gave, and its class; any other takes back each growth rate's
 * worth of a point, and what that comes to over all of them is rounded. A stat is not taken under its `floor`,
 * and what cannot be told, as when a skill or a weapon rank came, is left as it is at the Level that is known.
 * @param {Record<number, Snapshot>} record         Its record, as `readRecord` gives it
 * @param {number} level                            The Level asked about
 * @param {{level: number, snapshot: Snapshot}} now What it is
 * @param {object} [options]
 * @param {Record<string, number>} [options.growths]    Its growth rates, in percent
 * @param {Jump[]} [options.jumps]
 * @param {Record<string, number>} [options.floor]      The least each stat was: the base stats of the class it
 *                                                      started in, where that is known
 * @returns {{snapshot: Snapshot, exact: boolean, from: number}}     `from` is the Level it was worked out from
 */
export function unitAt(record, level, now, { growths = {}, jumps = [], floor = {} } = {}) {
  const wanted = Math.max(whole(level, 1), 1);
  if ( wanted >= now.level ) return { snapshot: now.snapshot, exact: true, from: now.level };
  if ( record?.[wanted] ) return { snapshot: record[wanted], exact: true, from: wanted };

  const above = Object.keys(record ?? {}).map(Number).filter((other) => (other > wanted) && (other < now.level)).sort((a, b) => a - b)[0];
  const anchor = (above !== undefined) ? { level: above, snapshot: record[above] } : now;
  const was = JSON.parse(JSON.stringify(anchor.snapshot));
  const take = (key, amount) => {
    if ( !(amount > 0) ) return;
    const least = Math.max(Number.isFinite(floor?.[key]) ? floor[key] : 0, (key === "hp") ? 1 : 0);
    if ( key === "hp" ) was.hp = Math.max(Math.min(was.hp, Math.max(was.hp - amount, least)), 0);
    else if ( key in was.stats ) was.stats[key] = Math.min(was.stats[key], Math.max(was.stats[key] - amount, least));
    else if ( key in was.abilities ) was.abilities[key] = Math.max(was.abilities[key] - amount, 0);
  };

  let rolled = 0;
  for ( let reached = anchor.level; reached > wanted; reached-- ) {
    const jump = (jumps ?? []).find((other) => other.at === reached);
    if ( !jump ) {
      rolled += 1;
      continue;
    }
    for ( const [key, amount] of Object.entries(jump.gains ?? {}) ) take(key, amount);
    if ( jump.from ) {
      was.cls = { id: text(jump.from.id), name: text(jump.from.name) };
      if ( Number.isFinite(jump.from.wt) ) was.wt = jump.from.wt;
    }
  }
  for ( const [key, rate] of Object.entries(growths ?? {}) ) {
    if ( Number.isFinite(rate) ) take(key, Math.round((Math.max(rate, 0) * rolled) / 100));
  }
  return { snapshot: was, exact: false, from: anchor.level };
}

/* -------------------------------------------- */

/**
 * A snapshot in the shape a unit's own data has, to be laid over it (see `overlay` in `imitation.mjs`): only
 * what a Level Sync changes is in it.
 * @param {Snapshot} snapshot
 * @returns {object}
 */
export function takenOf(snapshot) {
  return {
    hp: { max: snapshot.hp },
    stats: Object.fromEntries(Object.keys(FEO.stats).map((key) => [key, { base: snapshot.stats[key] ?? 0, boost: snapshot.boosts?.[key] ?? 0 }])),
    abilities: Object.fromEntries(Object.keys(FEO.abilities).map((key) => {
      return [key, { increase: snapshot.abilities?.[key] ?? 0, boost: snapshot.abilityBoosts?.[key] ?? 0 }];
    })),
    wt: { class: snapshot.wt },
    proficiencies: Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => {
      const [rank, wexp] = snapshot.ranks?.[key] ?? ["F", 0];
      return [key, { rank, wexp }];
    })),
    weaponLevel: { base: snapshot.wlv },
    specialQualities: snapshot.qualities,
    className: snapshot.cls.name
  };
}

/* -------------------------------------------- */

/**
 * The skills a unit did not have yet at the Level it is synced to: those of its skills that the snapshot of
 * that Level does not list. They are set aside for as long as it is synced.
 * @param {string[]} skills       The skills it has, by Item
 * @param {Snapshot} snapshot
 * @returns {string[]}
 */
export function skillsOff(skills, snapshot) {
  const had = new Set(snapshot?.skills ?? []);
  return (skills ?? []).filter((id) => !had.has(id));
}

/* -------------------------------------------- */
/*  The Note                                    */
/* -------------------------------------------- */

/**
 * A unit's Level Sync as it is kept on it, made sound: the Level it is synced to, its own, what it was, and
 * what has to be put back: `hand` is the weapon it held, and `took` the one it took up in its place where it
 * could not yet wield that one. Null for anything that is no such note.
 * @param {*} note
 * @returns {object|null}
 */
export function readSync(note) {
  if ( !plain(note) || !plain(note.taken) || !Number.isInteger(note.level) || (note.level < 1) ) return null;
  return {
    level: note.level,
    own: Number.isInteger(note.own) ? note.own : note.level,
    exact: note.exact !== false,
    from: Number.isInteger(note.from) ? note.from : note.level,
    taken: note.taken,
    classId: text(note.classId),
    off: Array.isArray(note.off) ? note.off.filter((id) => (typeof id === "string") && id) : [],
    encounter: text(note.encounter),
    name: text(note.name),
    scene: text(note.scene),
    hand: text(note.hand),
    took: text(note.took)
  };
}

/* -------------------------------------------- */

/**
 * Is a skill set aside by the Level Sync of its unit?
 * @param {*} note          The unit's note, as it is saved
 * @param {string} id       The skill, by Item
 * @returns {boolean}
 */
export function syncedOff(note, id) {
  return !!id && plain(note) && plain(note.taken) && Array.isArray(note.off) && note.off.includes(id);
}

/* -------------------------------------------- */
/*  HP and Level Ups                            */
/* -------------------------------------------- */

/**
 * The HP of a unit as its maximum changes with a Level Sync, going in and coming out: the same share of the new
 * maximum, rounded, and never nothing for a unit that had some. A unit that is down stays as it is.
 * @param {number} hp       Its HP
 * @param {number} from     Its maximum before
 * @param {number} to       Its maximum after
 * @returns {number}
 */
export function shareOfHp(hp, from, to) {
  const value = hp ?? 0;
  if ( !(value > 0) || !(to > 0) ) return value;
  if ( !(from > 0) ) return Math.min(value, to);
  return Math.min(Math.max(Math.round((Math.min(value, from) * to) / from), 1), to);
}

/* -------------------------------------------- */

/**
 * The Level ups a unit has waiting: its experience holds so many Levels' worth.
 * @param {number} exp
 * @param {number} [perLevel]     FEO.expPerLevel
 * @returns {number}
 */
export function levelUpsWaiting(exp, perLevel = FEO.expPerLevel) {
  return Math.max(Math.floor(Math.max(exp ?? 0, 0) / perLevel), 0);
}

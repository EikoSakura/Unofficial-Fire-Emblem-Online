/**
 * Encounters for Fire Emblem Online: a battle prepared ahead of the session. Who is in it and how many, where
 * they stand and when they arrive, what the party has to do, and how hard that reads for the party that goes.
 *
 * The rulebook says what a map may ask of the party (its Objectives) and what a foe is worth (Kill EXP). It has
 * no measure of how hard a battle is, so the one here is this system's own and says so wherever it is shown:
 * see `readDifficulty`.
 *
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 */

import { FEO } from "../config.mjs";
import { killExp } from "./experience.mjs";
import { cleanBand } from "./level-sync.mjs";

/**
 * @typedef Blow
 * What one unit does to another in a fight it starts, as the forecast gives it.
 * @property {number} damage      What a hit that is not critical deals
 * @property {number} hit         Its chance to hit, 0 to 100
 * @property {number} crit        Its chance of a critical hit, 0 to 100
 * @property {number} attacks     How many times it attacks in the fight
 */

/**
 * @typedef EncounterGroup
 * A stat block of an encounter and how many of it there are.
 * @property {string} id
 * @property {string} actor           The id of the unit it is copies of
 * @property {number} count
 * @property {number} turn            The turn it arrives at the start of; 0 for one that is there from the start
 * @property {{i: number, j: number}|null} tile     The tile it gathers round; null while it is not placed
 */

/**
 * @typedef Encounter
 * @property {string} id
 * @property {string} name
 * @property {string} scene           The id of the scene it is fought on; blank while none is chosen
 * @property {Record<string, boolean>} objectives   By key of FEO.encounter.objectives
 * @property {number} survive         The turns to survive, for that Objective
 * @property {{i: number, j: number}|null} goal     The space the Objectives that need one are about
 * @property {string} protect         The id of the group that must not be defeated
 * @property {string} affinity        The Affinity of the map; blank for none
 * @property {string} weather         The weather of the map; blank for none
 * @property {string[]} party         The ids of the player units that are going
 * @property {import("./level-sync.mjs").LevelBand} sync     The Levels it is for, where it is synced
 * @property {EncounterGroup[]} groups
 */

/* -------------------------------------------- */
/*  One Unit Against Another                    */
/* -------------------------------------------- */

/**
 * What a unit's attacks on another are worth on average: the damage of a hit by its chance to land, a critical
 * hit dealing three times as much, for every attack it makes.
 * @param {Blow|null} blow
 * @returns {number}
 */
export function blowWorth(blow) {
  if ( !blow ) return 0;
  const hit = Math.min(Math.max(blow.hit ?? 0, 0), 100) / 100;
  const crit = Math.min(Math.max(blow.crit ?? 0, 0), 100) / 100;
  return Math.max(blow.damage ?? 0, 0) * hit * (1 + (2 * crit)) * Math.max(blow.attacks ?? 1, 0);
}

/* -------------------------------------------- */

/**
 * How many hits of a unit fell another.
 * @param {Blow|null} blow
 * @param {number} hp       The HP of the unit that is hit
 * @returns {number}        Infinity for a unit that deals it no damage
 */
export function hitsToFell(blow, hp) {
  if ( !blow || !(blow.damage > 0) ) return Infinity;
  return Math.max(Math.ceil(Math.max(hp, 1) / blow.damage), 1);
}

/* -------------------------------------------- */
/*  The Party                                   */
/* -------------------------------------------- */

/**
 * The Level a party is counted as: the average of its units, rounded.
 * @param {number[]} levels
 * @returns {number}
 */
export function partyLevel(levels) {
  const known = (levels ?? []).filter((level) => Number.isFinite(level));
  if ( !known.length ) return 1;
  return Math.max(Math.round(known.reduce((sum, level) => sum + level, 0) / known.length), 1);
}

/* -------------------------------------------- */

/**
 * The Kill EXP a map holds for a unit of a Level: that of every foe on it. A foe that gives none when it is
 * defeated is left out.
 * @param {{level: number, count: number, silent?: boolean}[]} foes
 * @param {number} level
 * @returns {number}
 */
export function expOnOffer(foes, level) {
  return (foes ?? []).reduce((sum, foe) => sum + (foe.silent ? 0 : killExp(level, foe.level) * Math.max(foe.count ?? 1, 0)), 0);
}

/* -------------------------------------------- */
/*  How Hard                                    */
/* -------------------------------------------- */

/**
 * @typedef Difficulty
 * @property {number} turns       The turns the party needs to fell every foe
 * @property {number} share       The share of its HP the foes take from it in that time: 1 is all of it
 * @property {number} step        Which of the bands that is, from 0
 * @property {string} key         The key of that band
 * @property {{index: number, many: number}|null} risk    The unit of the party the most foes fell in a few
 *                                                        hits, and how many do
 */

/**
 * How hard a battle reads for a party. This is no rule of the game: it strings the forecast together.
 *
 * The party needs so many attacks to fell every foe, at what its units that fight deal each of them on average;
 * shared among those units, that is so many turns. In that time every foe attacks once a turn, at what it deals
 * a unit of the party on average, and as the foes fall one by one they come to half of that between them. What
 * the party's staves heal in those turns is taken off, and what is left is held against the HP of the party.
 *
 * It counts no terrain, no Skill that is not in the forecast, and no good play, and has every foe in reach
 * from the first turn, so it leans harsh.
 * @param {object} battle
 * @param {{hp: number, heals?: number}[]} battle.party     The units that go: their HP, and what each heals a
 *                                                          turn with the staff in its hand
 * @param {{count: number, hp: number, silent?: boolean}[]} battle.foes     `silent` for one that does not fight
 * @param {(Blow|null)[][]} battle.dealt      What each unit of the party does to each foe: by unit, then by foe
 * @param {(Blow|null)[][]} battle.taken      What each foe does to each unit of the party: by foe, then by unit
 * @param {object} [config]                   FEO.encounter.difficulty
 * @returns {Difficulty|null}                 Null where there is nothing to read: no foe, or nobody who fights
 */
export function readDifficulty({ party = [], foes = [], dealt = [], taken = [] }, config = FEO.encounter.difficulty) {
  const fighters = party.map((unit, index) => index).filter((index) => (dealt[index] ?? []).some((blow) => !!blow));
  const fielded = foes.map((foe, index) => ({ ...foe, index })).filter((foe) => foe.count > 0);
  if ( !fighters.length || !fielded.length ) return null;

  let attacks = 0;
  let eachTurn = 0;
  for ( const foe of fielded ) {
    const each = fighters.reduce((sum, index) => sum + blowWorth(dealt[index]?.[foe.index]), 0) / fighters.length;
    attacks += (foe.count * Math.max(foe.hp, 1)) / Math.max(each, config.least);
    if ( foe.silent ) continue;
    const row = taken[foe.index] ?? [];
    eachTurn += (foe.count * party.reduce((sum, unit, index) => sum + blowWorth(row[index]), 0)) / party.length;
  }
  const turns = attacks / fighters.length;
  const healed = party.reduce((sum, unit) => sum + Math.max(unit.heals ?? 0, 0), 0) * turns;
  const hp = party.reduce((sum, unit) => sum + Math.max(unit.hp, 1), 0);
  const share = Math.max(((eachTurn * turns) / 2) - healed, 0) / hp;
  const found = config.bands.findIndex((band) => share < band.under);
  const step = found < 0 ? config.bands.length - 1 : found;

  // Who is in the most danger: the unit the most foes fell in a few hits
  let risk = null;
  party.forEach((unit, index) => {
    const many = fielded.reduce((sum, foe) => {
      if ( foe.silent ) return sum;
      return sum + ((hitsToFell(taken[foe.index]?.[index], unit.hp) <= config.fellIn) ? foe.count : 0);
    }, 0);
    if ( many && (!risk || (many > risk.many)) ) risk = { index, many };
  });
  return { turns, share, step, key: config.bands[step].key, risk };
}

/* -------------------------------------------- */
/*  Objectives                                  */
/* -------------------------------------------- */

/**
 * What stands in the way of an encounter being played as it is set up, and what is in order: an Objective that
 * has what it needs, or lacks it; a unit that cannot use what it carries; a group that stands nowhere yet.
 * Each is a line to show, told by its `code`, with what to say in it.
 * @param {Encounter} encounter
 * @param {object[]} groups       The groups as they are known: each with `id`, `name`, `side`, `count`, `turn`,
 *                                `placed`, `boss`, `recruit`, `unarmed` (it fights and has no weapon it can use)
 *                                and `unfit` (the names of weapons it lacks the rank for)
 * @param {object} [config]       FEO.encounter
 * @returns {{ok: boolean, code: string, data: object}[]}
 */
export function encounterChecks(encounter, groups, config = FEO.encounter) {
  const checks = [];
  const say = (ok, code, data = {}) => checks.push({ ok, code, data });
  const on = (key) => !!encounter.objectives?.[key];
  const foes = groups.filter((group) => group.side === "enemy");
  const count = (list) => list.reduce((sum, group) => sum + group.count, 0);

  if ( !config.objectives.some(on) ) say(false, "none");
  if ( on("boss") ) {
    const bosses = foes.filter((group) => group.boss);
    if ( bosses.length ) say(true, "boss", { name: [...new Set(bosses.map((group) => group.name))].join(", ") });
    else say(false, "bossMissing");
  }
  if ( on("rout") ) say(foes.length > 0, foes.length ? "rout" : "routMissing", { count: count(foes), later: count(foes.filter((group) => group.turn > 0)) });
  if ( on("survive") ) say(true, "survive", { turns: encounter.survive });
  if ( on("protect") ) {
    const kept = protectedGroup(encounter, groups);
    if ( kept ) say(true, "protect", { name: kept.name });
    else say(false, "protectMissing");
  }
  for ( const key of config.marked ) {
    if ( !on(key) ) continue;
    if ( encounter.goal ) say(true, "marked", { objective: key, column: encounter.goal.j + 1, row: encounter.goal.i + 1 });
    else say(false, "unmarked", { objective: key });
  }

  for ( const group of groups ) {
    if ( group.missing ) {
      say(false, "gone", { name: group.name });
      continue;
    }
    if ( group.unfit?.length ) say(false, "unfit", { name: group.name, weapons: group.unfit.join(", ") });
    if ( group.unarmed ) say(false, "unarmed", { name: group.name });
    if ( group.recruit ) say(true, "recruit", { name: group.name });
  }
  const loose = groups.filter((group) => !group.placed && !group.missing);
  if ( loose.length ) say(false, "unplaced", { count: count(loose), names: loose.map((group) => group.name).join(", ") });
  return checks;
}

/* -------------------------------------------- */

/**
 * The group a Protect Objective is about: the one that was named, or else the only group of allies there is.
 * @param {Encounter} encounter
 * @param {{id: string, side: string}[]} groups
 * @returns {object|null}
 */
export function protectedGroup(encounter, groups) {
  const named = groups.find((group) => group.id === encounter.protect);
  if ( named && (named.side !== "enemy") ) return named;
  const allies = groups.filter((group) => group.side === "ally");
  return allies.length === 1 ? allies[0] : null;
}

/* -------------------------------------------- */
/*  Where They Stand                            */
/* -------------------------------------------- */

/** The tiles round one, nearest first. */
const AROUND = [
  [0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 2], [2, 0], [0, -2], [-2, 0],
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2], [2, 2], [2, -2], [-2, -2], [-2, 2],
  [0, 3], [3, 0], [0, -3], [-3, 0], [1, 3], [3, 1], [3, -1], [1, -3], [-1, -3], [-3, -1], [-3, 1], [-1, 3]
];

/**
 * The tile each unit of each group stands on: a group gathers round the tile it was put on, nearest tiles
 * first, on tiles that are on the map, that nobody stands on yet and that it can stand on. A group that was not
 * put anywhere stands nowhere, and one that finds too few tiles stands on those it finds.
 * @param {EncounterGroup[]} groups
 * @param {object} map
 * @param {number} map.columns
 * @param {number} map.rows
 * @param {(tile: {i: number, j: number}, group: EncounterGroup) => boolean} [map.blocked]
 *                                    Can this group not stand there?
 * @param {Iterable<string>} [map.taken]    Tiles something stands on already, as "i,j"
 * @returns {Map<string, {i: number, j: number}[]>}   The tiles of each group, by its id
 */
export function gatherTiles(groups, { columns, rows, blocked = () => false, taken = [] }) {
  const used = new Set(taken);
  const stands = new Map();
  for ( const group of groups ?? [] ) {
    const tiles = [];
    stands.set(group.id, tiles);
    if ( !group.tile ) continue;
    for ( const [di, dj] of AROUND ) {
      if ( tiles.length >= group.count ) break;
      const tile = { i: group.tile.i + di, j: group.tile.j + dj };
      const key = `${tile.i},${tile.j}`;
      if ( (tile.i < 0) || (tile.j < 0) || (tile.i >= rows) || (tile.j >= columns) || used.has(key) ) continue;
      if ( blocked(tile, group) ) continue;
      used.add(key);
      tiles.push(tile);
    }
  }
  return stands;
}

/* -------------------------------------------- */

/**
 * A tile for each group that stands nowhere yet: somewhere open on the map, away from the tiles to keep clear
 * (those the players set up on) and from the groups that are placed already.
 * @param {EncounterGroup[]} groups
 * @param {object} map
 * @param {number} map.columns
 * @param {number} map.rows
 * @param {(tile: {i: number, j: number}, group: EncounterGroup) => boolean} [map.blocked]
 * @param {(tile: {i: number, j: number}) => boolean} [map.keep]    Is this a tile to keep clear?
 * @param {() => number} [map.random]
 * @returns {Map<string, {i: number, j: number}>}     The tile found for each such group, by its id
 */
export function scatterTiles(groups, { columns, rows, blocked = () => false, keep = () => false, random = Math.random }) {
  const kept = [];
  for ( let i = 0; i < rows; i++ ) for ( let j = 0; j < columns; j++ ) if ( keep({ i, j }) ) kept.push({ i, j });
  const anchors = (groups ?? []).filter((group) => group.tile).map((group) => group.tile);
  const apart = (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
  const found = new Map();
  for ( const group of groups ?? [] ) {
    if ( group.tile ) continue;
    let best = null;
    for ( let attempt = 0; attempt < 60; attempt++ ) {
      const tile = { i: Math.floor(random() * rows), j: Math.floor(random() * columns) };
      if ( keep(tile) || blocked(tile, group) ) continue;

      // The further from the players' tiles and from the other groups, the better, up to a point
      const fromKept = kept.length ? Math.min(...kept.map((other) => apart(tile, other))) : 6;
      const fromOthers = anchors.length ? Math.min(...anchors.map((other) => apart(tile, other))) : 4;
      const score = Math.min(fromKept, 6) + Math.min(fromOthers, 4);
      if ( !best || (score > best.score) ) best = { tile, score };
      if ( score >= 10 ) break;
    }
    if ( !best ) continue;
    found.set(group.id, best.tile);
    anchors.push(best.tile);
  }
  return found;
}

/* -------------------------------------------- */
/*  Keeping an Encounter                        */
/* -------------------------------------------- */

/**
 * An encounter nothing has been set up in yet.
 * @param {string} id
 * @param {string} [name]
 * @returns {Encounter}
 */
export function newEncounter(id, name = "") {
  return cleanEncounter({ id, name });
}

/* -------------------------------------------- */

/**
 * An encounter read from what was kept of it: anything missing or out of place is put right.
 * @param {object} [raw]
 * @param {object} [config]     FEO.encounter
 * @returns {Encounter}
 */
export function cleanEncounter(raw = {}, config = FEO.encounter) {
  const text = (value) => String(value ?? "").trim();
  const whole = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback);
  const tile = (value) => ((value && Number.isFinite(Number(value.i)) && Number.isFinite(Number(value.j)))
    ? { i: whole(value.i), j: whole(value.j) } : null);
  const seen = new Set();
  const groups = [];
  for ( const group of Array.isArray(raw.groups) ? raw.groups : [] ) {
    const id = text(group?.id);
    if ( !id || seen.has(id) || !text(group.actor) ) continue;
    seen.add(id);
    groups.push({
      id,
      actor: text(group.actor),
      count: Math.min(Math.max(whole(group.count, 1), 1), config.count),
      turn: Math.max(whole(group.turn), 0),
      tile: tile(group.tile)
    });
  }
  return {
    id: text(raw.id),
    name: text(raw.name),
    scene: text(raw.scene),
    objectives: Object.fromEntries(config.objectives.map((key) => [key, !!raw.objectives?.[key]])),
    survive: Math.max(whole(raw.survive, config.survive), 1),
    goal: tile(raw.goal),
    protect: text(raw.protect),
    affinity: text(raw.affinity),
    weather: text(raw.weather),
    party: [...new Set((Array.isArray(raw.party) ? raw.party : []).map(text).filter(Boolean))],
    sync: cleanBand(raw.sync),
    groups
  };
}

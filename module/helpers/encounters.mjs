import Compendium from "../apps/compendium.mjs";
import { FEO } from "../config.mjs";
import { splitNames } from "../rules/classes.mjs";
import { parseRange, planExchange } from "../rules/combat.mjs";
import { cleanEncounter, gatherTiles, protectedGroup } from "../rules/encounters.mjs";
import { staffHealing } from "../rules/staves.mjs";
import { canWield } from "../rules/weapons.mjs";
import { company } from "./base.mjs";
import { combatantOf } from "./exchange-context.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { setMapAffinity } from "./map-affinity.mjs";
import { DROP_FLAG, copyDelta, specOf } from "./npc.mjs";
import { readPaint } from "./paint.mjs";
import { beginBattle } from "./phases.mjs";
import { characterOf, isPlayerUnit } from "./players.mjs";
import { setWeather } from "./weather.mjs";

/**
 * Encounters in Foundry: the battles a Game Master has prepared are kept with the world; the units of one are
 * read for what the Encounter Builder shows of them, asked what they do to one another, and put on the map.
 * What an encounter holds and how hard it reads is decided by `rules/encounters.mjs`.
 *
 * @import {Blow, Encounter, EncounterGroup} from "../rules/encounters.mjs"
 */

/** The world setting the encounters are kept in. */
const SETTING = FEO.encounter.setting;

/** The flag of a scene that keeps the units still to arrive, each with the turn it arrives on. */
const ARRIVALS_FLAG = FEO.encounter.arrivals;

/** The flags of a token that say which encounter put it on the map, and as part of which group. */
export const ENCOUNTER_FLAG = "encounter";
const GROUP_FLAG = "encounterGroup";

/* -------------------------------------------- */
/*  Keeping Encounters                          */
/* -------------------------------------------- */

/**
 * The encounters the world keeps, the one last worked on first.
 * @returns {Encounter[]}
 */
export function readEncounters() {
  const kept = game.settings.get(FEO.id, SETTING);
  return (Array.isArray(kept?.list) ? kept.list : []).map((raw) => cleanEncounter(raw)).filter((encounter) => encounter.id);
}

/* -------------------------------------------- */

/**
 * Keep an encounter: it takes the place of the one of its id, or joins the others, at their head.
 * @param {Encounter} encounter
 * @returns {Promise<Encounter>}
 */
export async function writeEncounter(encounter) {
  const clean = cleanEncounter(encounter);
  if ( !game.user.isGM || !clean.id ) return clean;
  const others = readEncounters().filter((other) => other.id !== clean.id);
  await game.settings.set(FEO.id, SETTING, { list: [clean, ...others] });
  return clean;
}

/* -------------------------------------------- */

/**
 * Forget an encounter. The units it was made of stay in the world.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeEncounter(id) {
  if ( !game.user.isGM ) return;
  await game.settings.set(FEO.id, SETTING, { list: readEncounters().filter((other) => other.id !== id) });
}

/* -------------------------------------------- */
/*  Units                                       */
/* -------------------------------------------- */

/** The user who plays a unit, where one does: whoever chose it as their character, or a player who owns it. */
function playerOf(actor) {
  return characterOf(actor)
    ?? game.users.find((user) => !user.isGM && actor.testUserPermission(user, "OWNER")) ?? null;
}

/**
 * The player units of the world, from which a party is picked: the company, then every other unit a player owns.
 * @returns {{actor: Actor, user: User|null}[]}
 */
export function partyPool() {
  const pool = [];
  const seen = new Set();
  for ( const { actor, user } of company() ) {
    seen.add(actor.id);
    pool.push({ actor, user: user ?? playerOf(actor) });
  }
  for ( const actor of game.actors ) {
    if ( (actor.type !== "unit") || seen.has(actor.id) || !isPlayerUnit(actor) ) continue;
    pool.push({ actor, user: playerOf(actor) });
  }
  return pool;
}

/* -------------------------------------------- */

/**
 * The units a Game Master may add to an encounter: every unit no player owns, those the builder made first.
 * @returns {Actor[]}
 */
export function npcPool() {
  const units = game.actors.filter((actor) => (actor.type === "unit") && !isPlayerUnit(actor));
  const made = (actor) => (specOf(actor) ? 0 : 1);
  return units.sort((a, b) => (made(a) - made(b)) || a.name.localeCompare(b.name));
}

/* -------------------------------------------- */

/**
 * @typedef UnitView
 * A unit as the Encounter Builder shows it, read from its Actor.
 */

/**
 * Read a unit for the Encounter Builder: its numbers as its sheet has them, what it carries and knows, and the
 * marks the NPC Builder gave it.
 * @param {Actor} actor
 * @returns {UnitView}
 */
export function describeUnit(actor) {
  const system = actor.system;
  const spec = specOf(actor);
  const held = system.equippedWeapon ?? null;
  const stats = system.statValues ?? {};
  const skills = actor.items.filter((item) => item.type === "skill").map((item) => item.name);
  const knows = (name) => skills.some((skill) => skill.toLowerCase() === name.toLowerCase());
  const qualities = splitNames(system.specialQualities);
  const staff = held?.system.category === "staff";
  const weapons = actor.items.filter((item) => item.type === "weapon");
  const silent = knows(FEO.npc.silent);
  return {
    id: actor.id,
    name: actor.name,
    img: actor.img,
    className: system.className ?? "",
    level: system.level ?? 1,
    hp: system.hp?.max ?? 0,
    stats,
    wt: system.wt?.total ?? 0,
    combat: Object.fromEntries(Object.entries(system.combat ?? {}).map(([key, stat]) => [key, stat?.value ?? 0])),
    weapon: held ? { name: held.name, category: held.system.category, staff } : null,
    heals: staff ? (staffHealing(held.system.effect, stats)?.amount ?? 0) : 0,
    skills,
    qualities,
    carried: actor.items.filter((item) => ["weapon", "gear"].includes(item.type)).map((item) => ({
      name: item.name, drop: item.getFlag(FEO.id, DROP_FLAG) ?? ""
    })),
    side: armyOf(actor, null),
    made: !!spec,
    boss: spec ? spec.boss : knows(FEO.npc.boss.skill),
    recruit: !!spec?.recruit,
    vary: !!spec?.vary,
    flying: qualities.some((quality) => quality.toLowerCase() === FEO.terrain.flying.toLowerCase()),
    silent,
    unarmed: !silent && !held,
    unfit: weapons.filter((item) => !canWield(system.proficiencies, item.system).ok).map((item) => item.name)
  };
}

/* -------------------------------------------- */
/*  One Unit Against Another                    */
/* -------------------------------------------- */

/** What units do to one another, by who attacks whom. Forgotten whenever a unit or what it holds changes. */
const BLOWS = new Map();

/**
 * What a unit does to another by the plain formulas, where the forecast cannot be asked.
 * @param {Actor} attacker
 * @param {Actor} target
 * @returns {Blow|null}
 */
function plainBlow(attacker, target) {
  const weapon = attacker.system.equippedWeapon;
  if ( !weapon ) return null;
  const mine = attacker.system.combat ?? {};
  const theirs = target.system.combat ?? {};
  const stats = target.system.statValues ?? {};
  const value = (stat) => stat?.value ?? 0;
  const guard = FEO.weaponCategories[weapon.system.category]?.magic ? (stats.res ?? 0) : (stats.def ?? 0);
  return {
    damage: Math.max(value(mine.damage) - guard, 0),
    hit: Math.min(Math.max(value(mine.accuracy) - value(theirs.dodge), 0), 100),
    crit: Math.min(Math.max(value(mine.critical) - value(theirs.critAvoid), 0), 100),
    attacks: (value(mine.attackSpeed) - value(theirs.attackSpeed)) >= FEO.doubleThreshold ? 2 : 1
  };
}

/* -------------------------------------------- */

/**
 * What a unit does to another in a fight it starts, as the forecast of that fight has it: on open, level
 * ground, at the nearest its weapon strikes from, with nobody around either of them. A unit that cannot start
 * a fight, as one with a staff or with nothing in its hand cannot, does nothing.
 * @param {Actor} attacker
 * @param {Actor} target
 * @returns {Blow|null}
 */
export function blowBetween(attacker, target) {
  const key = `${attacker.uuid}>${target.uuid}`;
  if ( BLOWS.has(key) ) return BLOWS.get(key);
  let blow = null;
  const weapon = attacker.system.equippedWeapon;
  if ( weapon && (weapon.system.category !== "staff") && !weapon.system.broken ) {
    try {
      const reach = parseRange(weapon.system.range, attacker.system.statValues);
      const plan = planExchange(combatantOf(attacker, attacker.name), combatantOf(target, target.name), {
        distance: Math.max(reach?.min ?? 1, 1)
      });
      const side = plan.initiator;
      if ( side && !side.blocked ) {
        const times = (plan.order ?? []).filter((who) => who === "initiator").length;
        blow = {
          damage: side.damage ?? 0,
          hit: side.hit ?? 0,
          crit: side.crit ?? 0,
          attacks: Math.max(times, 1) * Math.max(side.strikes ?? 1, 1)
        };
      }
    } catch(err) {
      console.warn(err);
      blow = plainBlow(attacker, target);
    }
  }
  BLOWS.set(key, blow);
  return blow;
}

/* -------------------------------------------- */
/*  The Map                                     */
/* -------------------------------------------- */

/**
 * @typedef EncounterMap
 * The map of a scene as the Encounter Builder shows it. Its tiles are counted from the scene's own top left
 * corner, row then column, whatever the scene has for padding.
 * @property {Scene} scene
 * @property {number} columns
 * @property {number} rows
 * @property {number} top               The row of the canvas the scene's first row is
 * @property {number} left
 * @property {string} picture           The scene's picture, if it has one
 * @property {(i: number, j: number) => string|null} terrainAt     The kind of terrain painted on a tile
 * @property {(i: number, j: number) => number} elevationAt
 * @property {(i: number, j: number) => string|null} zoneAt        The zone a tile belongs to
 * @property {{id: string, i: number, j: number, army: string, encounter: string}[]} tokens
 */

/**
 * Read the map of a scene.
 * @param {Scene|null} scene
 * @returns {EncounterMap|null}     Null without a scene, or for one that has no square grid
 */
export function mapOf(scene) {
  if ( !scene?.grid?.isSquare ) return null;
  const [top, left, bottom, right] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const { paint } = readPaint(scene);
  const coat = (painted) => {
    const tiles = new Map();
    for ( const [value, keys] of painted ?? [] ) for ( const key of keys ) tiles.set(key, value);
    return tiles;
  };
  const terrain = coat(paint.terrain);
  const elevation = coat(paint.elevation);
  const zone = coat(paint.zone);
  const key = (i, j) => `${i + top},${j + left}`;
  const tokens = [];
  for ( const token of scene.tokens ) {
    const tile = tokenTile(token);
    if ( !tile ) continue;
    tokens.push({
      id: token.id,
      i: tile.i - top,
      j: tile.j - left,
      army: token.actor ? armyOf(token.actor, token) : "other",
      encounter: token.getFlag(FEO.id, ENCOUNTER_FLAG) ?? ""
    });
  }

  // The picture of a scene is that of the level it opens on
  const level = scene.initialLevel ?? scene.levels?.contents?.[0] ?? null;
  return {
    scene,
    columns: Math.max(right - left, 1),
    rows: Math.max(bottom - top, 1),
    top,
    left,
    picture: level?.background?.src || "",
    terrainAt: (i, j) => terrain.get(key(i, j)) ?? null,
    elevationAt: (i, j) => elevation.get(key(i, j)) ?? 0,
    zoneAt: (i, j) => zone.get(key(i, j)) ?? null,
    tokens
  };
}

/* -------------------------------------------- */

/**
 * Can a unit not be put on a tile: a wall, or ground only some units cross, for a unit that does not fly?
 * @param {EncounterMap} map
 * @param {{i: number, j: number}} tile
 * @param {UnitView|null} unit
 * @returns {boolean}
 */
export function tileBlocked(map, tile, unit) {
  const terrain = FEO.terrain.types[map.terrainAt(tile.i, tile.j)] ?? null;
  if ( !terrain ) return false;
  if ( terrain.impassable ) return true;
  return !!terrain.needs?.length && !unit?.flying;
}

/* -------------------------------------------- */

/**
 * Where every unit of an encounter stands on its map: each group round the tile it was put on, clear of the
 * tokens other things put there.
 * @param {Encounter} encounter
 * @param {EncounterMap|null} map
 * @param {Map<string, UnitView>} units     The unit of each group, by the group's id
 * @returns {Map<string, {i: number, j: number}[]>}
 */
export function standsOf(encounter, map, units) {
  if ( !map ) return new Map(encounter.groups.map((group) => [group.id, []]));
  return gatherTiles(encounter.groups, {
    columns: map.columns,
    rows: map.rows,
    blocked: (tile, group) => tileBlocked(map, tile, units.get(group.id) ?? null),
    taken: map.tokens.filter((token) => token.encounter !== encounter.id).map((token) => `${token.i},${token.j}`)
  });
}

/* -------------------------------------------- */
/*  Onto the Map                                */
/* -------------------------------------------- */

/**
 * The tokens an encounter has put on its scene.
 * @param {Encounter} encounter
 * @param {Scene|null} scene
 * @returns {TokenDocument[]}
 */
export function placedTokens(encounter, scene) {
  return scene?.tokens.filter((token) => token.getFlag(FEO.id, ENCOUNTER_FLAG) === encounter.id) ?? [];
}

/* -------------------------------------------- */

/**
 * Put an encounter on its map: a token for every unit of every group that was placed, on the tile it stands on.
 * A copy of a unit that varies rolls its own Levels. A group that arrives on a later turn is kept with the
 * scene until that turn begins. What the encounter put there before is taken off first. Runs for a Game Master.
 * @param {Encounter} encounter
 * @returns {Promise<{placed: number, later: number}|null>}     Null where it could not be done
 */
export async function placeEncounter(encounter) {
  const scene = game.scenes.get(encounter.scene) ?? null;
  const map = mapOf(scene);
  if ( !game.user.isGM || !map ) return null;
  const library = await Compendium.library();
  const actors = new Map(encounter.groups.map((group) => [group.id, game.actors.get(group.actor) ?? null]));
  const units = new Map([...actors].filter(([, actor]) => actor).map(([id, actor]) => [id, describeUnit(actor)]));
  const stands = standsOf(encounter, map, units);

  const old = placedTokens(encounter, scene).map((token) => token.id);
  if ( old.length ) await scene.deleteEmbeddedDocuments("Token", old);

  const now = [];
  const later = [];
  for ( const group of encounter.groups ) {
    const actor = actors.get(group.id);
    if ( !actor ) continue;
    const spec = specOf(actor);
    const tiles = stands.get(group.id) ?? [];
    for ( const [index, tile] of tiles.entries() ) {
      const { x, y } = scene.grid.getTopLeftPoint({ i: tile.i + map.top, j: tile.j + map.left });
      const data = (await actor.getTokenDocument({ x, y, actorLink: false })).toObject();
      delete data._id;
      data.flags = { ...(data.flags ?? {}), [FEO.id]: { ...(data.flags?.[FEO.id] ?? {}), [ENCOUNTER_FLAG]: encounter.id, [GROUP_FLAG]: group.id } };
      if ( spec?.vary ) {
        const own = copyDelta(spec, library, `${spec.seed}-${group.id}-${index}-${foundry.utils.randomID(6)}`);
        if ( own ) data.delta = foundry.utils.mergeObject(data.delta ?? {}, own);
      }
      if ( group.turn > 0 ) later.push({ turn: group.turn, token: data });
      else now.push(data);
    }
  }
  if ( now.length ) await scene.createEmbeddedDocuments("Token", now);
  if ( later.length ) await scene.setFlag(FEO.id, ARRIVALS_FLAG, later);
  else if ( scene.getFlag(FEO.id, ARRIVALS_FLAG) !== undefined ) await scene.unsetFlag(FEO.id, ARRIVALS_FLAG);
  return { placed: now.length, later: later.length };
}

/* -------------------------------------------- */

/**
 * The words of an encounter's Objectives, one line each, as the party is told them when the battle begins.
 * @param {Encounter} encounter
 * @param {{id: string, name: string, side: string, boss?: boolean}[]} groups
 * @returns {string[]}
 */
export function objectiveLines(encounter, groups) {
  const i18n = game.i18n;
  const lines = [];
  for ( const key of FEO.encounter.objectives ) {
    if ( !encounter.objectives[key] ) continue;
    const label = i18n.localize(`FEO.Encounter.objective.${key}.label`);
    let detail = i18n.localize(`FEO.Encounter.objective.${key}.hint`);
    if ( key === "boss" ) {
      const names = [...new Set(groups.filter((group) => group.boss && (group.side === "enemy")).map((group) => group.name))];
      if ( names.length ) detail = names.join(", ");
    }
    else if ( FEO.encounter.marked.includes(key) && encounter.goal ) {
      detail = i18n.format("FEO.Encounter.map.goalAt", { column: encounter.goal.j + 1, row: encounter.goal.i + 1 });
    }
    else if ( key === "survive" ) detail = i18n.format("FEO.Encounter.objective.survive.turns", { turns: encounter.survive });
    else if ( key === "protect" ) detail = protectedGroup(encounter, groups)?.name ?? detail;
    lines.push(`<b>${label}:</b> ${foundry.utils.escapeHTML?.(detail) ?? detail}`);
  }
  return lines;
}

/* -------------------------------------------- */

/**
 * Begin the battle of an encounter: it is put on its map if it is not there yet, the map is given its Affinity
 * and its weather, the scene is brought into view, the party is told its Objectives, and the battle begins.
 * Runs for a Game Master.
 * @param {Encounter} encounter
 * @returns {Promise<Combat|null>}
 */
export async function beginEncounter(encounter) {
  const scene = game.scenes.get(encounter.scene) ?? null;
  if ( !game.user.isGM || !scene ) return null;
  if ( !placedTokens(encounter, scene).length && !scene.getFlag(FEO.id, ARRIVALS_FLAG)?.length ) await placeEncounter(encounter);
  await setMapAffinity(scene, encounter.affinity);
  await setWeather(scene, encounter.weather ? [encounter.weather] : []);
  if ( !scene.isView ) await scene.view();

  const groups = encounter.groups.map((group) => {
    const actor = game.actors.get(group.actor);
    return actor ? { ...describeUnit(actor), id: group.id } : null;
  }).filter(Boolean);
  const lines = objectiveLines(encounter, groups);
  if ( lines.length ) {
    const ChatMessage = foundry.documents.ChatMessage.implementation;
    const title = foundry.utils.escapeHTML?.(encounter.name) ?? encounter.name;
    await ChatMessage.create({
      speaker: { alias: game.i18n.localize("FEO.Encounter.briefing") },
      content: `<h3>${title}</h3><ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>`
    });
  }
  return beginBattle(scene);
}

/* -------------------------------------------- */
/*  Arrivals                                    */
/* -------------------------------------------- */

/**
 * The turn of a battle went up: the units of its scene that arrive on that turn are put on the map and join
 * the battle. Done by one Game Master's client.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
async function arrive(combat) {
  const scene = combat.scene ?? null;
  if ( !game.user.isActiveGM || !combat.started || !scene ) return;
  const waiting = scene.getFlag(FEO.id, ARRIVALS_FLAG);
  if ( !Array.isArray(waiting) || !waiting.length ) return;
  const due = waiting.filter((entry) => entry.turn <= combat.round);
  if ( !due.length ) return;

  // What is left to arrive is noted first, so that nothing arrives twice
  const left = waiting.filter((entry) => entry.turn > combat.round);
  if ( left.length ) await scene.setFlag(FEO.id, ARRIVALS_FLAG, left);
  else await scene.unsetFlag(FEO.id, ARRIVALS_FLAG);
  const made = await scene.createEmbeddedDocuments("Token", due.map((entry) => entry.token));
  const joined = new Set(combat.combatants.map((combatant) => combatant.tokenId));
  const fresh = made.filter((token) => !joined.has(token.id));
  if ( fresh.length ) {
    await combat.createEmbeddedDocuments("Combatant", fresh.map((token) => ({
      tokenId: token.id, sceneId: scene.id, actorId: token.actorId, hidden: token.hidden
    })));
  }
  const names = [...new Set(made.map((token) => token.name))].join(", ");
  ui.notifications.info(game.i18n.format("FEO.Encounter.arrived", { turn: combat.round, names, count: made.length }));
}

/* -------------------------------------------- */

/**
 * Make encounters part of the game: the setting they are kept in, the units that arrive as the turns of a
 * battle go by, and what units do to one another forgotten as they change.
 * @param {() => void} [changed]      Called when something an encounter is made of has changed
 */
export function registerEncounters(changed = () => {}) {
  game.settings.register(FEO.id, SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: { list: [] },
    onChange: () => changed()
  });
  Hooks.on("updateCombat", (combat, changes, options) => {
    if ( !("round" in (changes ?? {})) || (options?.direction < 0) ) return;
    arrive(combat).catch((err) => console.error(err));
  });

  // What a unit does to another holds until either of them changes, or what one of them holds does
  const forget = (document) => {
    const actor = (document?.documentName === "Actor") ? document : document?.parent;
    if ( actor?.documentName !== "Actor" ) return;
    BLOWS.clear();
    changed();
  };
  for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "createActor", "deleteActor"] ) Hooks.on(hook, forget);
}

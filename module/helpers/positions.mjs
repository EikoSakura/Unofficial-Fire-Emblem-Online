import { FEO } from "../config.mjs";
import { standing } from "../rules/auras.mjs";
import { UNTARGETABLE, needsPlace } from "../rules/skills.mjs";
import { armyOf, measureDistance, tokenTile } from "./exchange.mjs";
import { asksClock, clockOf } from "./clock.mjs";
import { asksMove, turnMoveOfActor } from "./movement.mjs";
import { mapAffinityAuras } from "./map-affinity.mjs";
import { weatherAuras } from "./map-weather.mjs";
import { sightOn } from "./sight.mjs";
import { groundUnder } from "./terrain.mjs";

/**
 * Where units stand in Foundry: reading the tokens of a scene for the position rules, telling a unit what it
 * has around it, and keeping the numbers on sheets in step as tokens move. Nothing is saved for this: each
 * client works it out from the scene it has in view.
 *
 * @import {PlacedUnit} from "../rules/positions.mjs"
 */

/**
 * Describe the unit behind a token for the position rules.
 * @param {TokenDocument} token
 * @returns {PlacedUnit & {token: TokenDocument}}
 */
function describe(token) {
  const actor = token.actor;
  const system = actor.system;
  const weapon = system.equippedWeapon;
  const ground = groundUnder(token);
  return {
    id: token.id,
    actor: actor.uuid,
    token,
    name: token.name || actor.name,
    side: armyOf(actor, token),
    tile: tokenTile(token),
    ground: ground ? { terrain: ground.terrain, effects: ground.effects } : null,
    out: !!system.defeat?.out,
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    gender: system.profile?.gender ?? "",
    bestRank: system.bestRank ?? "",
    stats: system.bare?.stats ?? system.statValues,

    // Its stats as they stand, with its skills and what lasts on it, for what holds them against another's
    totals: system.statValues,
    base: system.bare?.base ?? {},
    accuracy: system.bare?.accuracy ?? 0,
    waiting: !!system.waiting,
    weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
    qualities: system.specialQualities ?? "",
    shifted: !!system.shift?.transformed,
    className: system.className ?? "",
    conditions: Object.keys(system.conditions ?? {}),
    skills: system.skills?.entries ?? [],

    // The skills it carries a mark for: those that have taken effect as often as they may for now
    marks: (system.timed ?? []).filter((change) => change.mark).map((change) => change.name),

    // Whether no enemy can make it the target of anything, the weapons and tomes it carries and may wield,
    // and for a summoned unit the unit that summoned it
    untargetable: !!system.skills?.rules?.includes(UNTARGETABLE),
    carried: system.wieldable ?? [],
    summoner: actor.getFlag?.(FEO.id, "summoner") ?? ""
  };
}

/* -------------------------------------------- */

/**
 * Does a token stand on the map for the position rules? A unit's token does, unless it is hidden and hidden
 * tokens are set not to count.
 * @param {TokenDocument} token
 * @returns {boolean}
 */
function counts(token) {
  if ( token.hidden && !FEO.auras.hidden ) return false;
  return token.actor?.type === "unit";
}

/* -------------------------------------------- */

/** Tiles between two units on a scene, measured between their tokens. */
const measure = (a, b) => measureDistance(a.token, b.token);

/** The scene whose units are being read, so that reading one unit does not start reading them all again. */
let reading = null;

/**
 * The units with a token on a scene, described for the position rules.
 * @param {Scene} scene
 * @returns {(PlacedUnit & {token: TokenDocument})[]}
 */
function unitsOn(scene) {
  if ( reading?.scene === scene ) return reading.units ?? [];

  // Reading a token's Actor may prepare it for the first time, which asks where it stands in turn. It has
  // nothing around it for that moment, and is looked at again once every unit is known
  const outer = reading;
  reading = { scene, units: null };
  try {
    return Array.from(scene.tokens ?? []).filter(counts).map(describe);
  } finally {
    reading = outer;
  }
}

/* -------------------------------------------- */

/**
 * Where a token stands: the units around it on its scene, and the auras it receives from their skills.
 * @param {TokenDocument|null} token
 * @returns {{near: object, auras: object[]}|null}    Null without a token that stands on a map
 */
export function standingOf(token) {
  const scene = token?.parent;
  if ( !scene || !counts(token) ) return null;
  return inWeather(standing(unitsOn(scene), token.id, measure, sightOn(scene)), scene, token.actor);
}

/* -------------------------------------------- */

/**
 * Add what the weather of a scene does to a unit's stats to what it receives where it stands, as entries of
 * the same kind as the auras of the units around it (see `rules/weather.mjs`).
 * @param {{near: object, auras: object[]}|null} place
 * @param {Scene} scene
 * @param {Actor|null} actor
 * @returns {{near: object, auras: object[]}|null}
 */
function inWeather(place, scene, actor) {
  if ( !place ) return place;
  // And so is what the Affinity of the map gives a unit of that Affinity
  const weather = [...weatherAuras(scene, actor), ...mapAffinityAuras(scene, actor)];
  return weather.length ? { ...place, auras: [...place.auras, ...weather] } : place;
}

/* -------------------------------------------- */

/**
 * The token a unit stands with on the scene in view: its own for a unit that only exists as a token, else the
 * first token there that is linked to it.
 * @param {Actor} actor
 * @returns {TokenDocument|null}
 */
export function tokenInView(actor) {
  const scene = globalThis.canvas?.scene;
  if ( !scene || !actor ) return null;
  if ( actor.token ) return (actor.token.parent === scene) ? actor.token : null;
  if ( !actor.id || actor.pack ) return null;
  return scene.tokens.find((token) => token.actorLink && (token.actorId === actor.id)) ?? null;
}

/* -------------------------------------------- */

/**
 * Where a unit stands on the scene in view, for its own numbers. A unit without a token there has nothing
 * around it.
 * @param {Actor} actor
 * @returns {{near: object, auras: object[]}|null}
 */
export function standingOfActor(actor) {
  // While the units of a scene are being read, nobody is told where it stands
  if ( reading && !reading.units ) return null;

  // A unit that an ally carries is off the map, and has nothing around it
  if ( actor?.system?.rescued?.by ) return null;
  try {
    const token = tokenInView(actor);

    // The Actor of an unlinked token is built when it is first asked for, and prepared before its token
    // holds it. Reading that token's Actor now would build another, which would ask in turn, without end.
    // It has nothing around it for that moment, and is looked at again shortly
    if ( token?.isLazyDelta ) {
      queueStanding();
      return null;
    }
    return standingOf(token);
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */
/*  Keeping Sheets in Step                      */
/* -------------------------------------------- */

/** What each unit last had around it that matters for its numbers, by Actor. */
const seen = new Map();

/**
 * What matters about where a unit stands for its numbers, as text to compare: the auras it receives, and for
 * a unit with a skill of its own that asks about the units around it, where each of them is. Such a unit
 * has something to compare even with nobody around it, since being alone on the map is an answer too, and so
 * is the ground it stands on. A unit with a skill that asks how it moved this turn compares that as well.
 * @param {Actor} actor
 * @param {{near: object, auras: object[]}|null} place
 * @returns {string}
 */
function signature(actor, place) {
  if ( !place ) return "";
  const asks = (actor.system.skills?.entries ?? []).some((skill) => {
    return (skill.effects ?? []).some((effect) => needsPlace(effect) && (!effect.aura || effect.aura.self));
  });
  const around = asks ? place.near.others.map((other) => [other.id, other.relation, other.distance, other.tile, other.qualities, other.className, other.seen, other.sees]) : [];
  const auras = place.auras.map((aura) => [aura.name, aura.effects]);
  const move = asksMove(actor) ? [turnMoveOfActor(actor)] : [];

  // And one with a skill, or a change that lasts on it, which asks the turn of the battle compares that
  const clock = asksClock(actor) ? [clockOf(actor)] : [];
  return (asks || auras.length || move.length || clock.length) ? JSON.stringify([place.near.tile, place.near.ground, around, auras, ...move, ...clock]) : "";
}

/* -------------------------------------------- */

/**
 * Work out again where every unit on the scene in view stands, and prepare again those whose numbers that
 * changes, so that their sheets show them. Runs on every client for itself; nothing is saved.
 * @param {Scene} scene
 * @returns {number}    How many units were prepared again
 */
export function refreshStanding(scene) {
  if ( !scene || (scene !== globalThis.canvas?.scene) ) return 0;
  const units = unitsOn(scene);
  const sight = sightOn(scene);
  const outer = reading;
  reading = { scene, units };
  let changed = 0;
  try {
    const here = new Set();
    for ( const unit of units ) {
      const actor = unit.token.actor;
      if ( here.has(actor) || (tokenInView(actor) !== unit.token) ) continue;
      here.add(actor);
      const now = signature(actor, inWeather(standing(units, unit.id, measure, sight), scene, actor));
      if ( (seen.get(actor) ?? "") === now ) continue;
      seen.set(actor, now);
      actor.reset();
      actor.render(false);
      changed++;
    }

    // A unit that no longer stands here no longer has anything around it. One whose token is gone is gone too
    for ( const [actor, was] of seen ) {
      if ( here.has(actor) ) continue;
      seen.delete(actor);
      if ( !was || (actor.token && !actor.token.parent?.tokens.has(actor.token.id)) ) continue;
      actor.reset();
      actor.render(false);
      changed++;
    }
  } finally {
    reading = outer;
  }
  return changed;
}

/* -------------------------------------------- */

let pending = null;

/**
 * Ask for the scene in view to be looked at again shortly, so that a burst of changes is answered once.
 */
export function queueStanding() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    try {
      // What shows a unit's numbers beside its sheet, as the Battle HUD does, is told that they changed
      if ( refreshStanding(globalThis.canvas?.scene) > 0 ) Hooks.callAll(`${FEO.id}.standingChanged`);
    } catch(err) {
      console.error(err);
    }
  }, 150);
}

/* -------------------------------------------- */

/**
 * Register what moves where units stand, or what they give each other. Called once, when the system starts.
 * @param {typeof import("../data/actor-unit.mjs").default} UnitData
 */
export function registerHooks(UnitData) {
  UnitData.standing = standingOfActor;

  const inView = (scene) => !!scene && (scene === globalThis.canvas?.scene);
  const moved = ["x", "y", "width", "height", "hidden", "disposition", "actorLink", "actorId"];
  Hooks.on("updateToken", (token, changes) => {
    if ( inView(token.parent) && moved.some((key) => key in changes) ) queueStanding();
  });
  for ( const hook of ["createToken", "deleteToken"] ) {
    Hooks.on(hook, (token) => {
      if ( inView(token.parent) ) queueStanding();
    });
  }
  Hooks.on("canvasReady", () => queueStanding());

  // The weather of a scene changes what its units have
  Hooks.on("updateScene", (scene, changes) => {
    if ( inView(scene) && (changes.flags?.[FEO.id] !== undefined) ) queueStanding();
  });

  // The ground a unit stands on changes with the Regions its scene is painted with
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion"] ) {
    Hooks.on(hook, (region) => {
      if ( inView(region.parent) ) queueStanding();
    });
  }
  for ( const hook of ["createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) {
    Hooks.on(hook, (behavior) => {
      if ( inView(behavior.parent?.parent) ) queueStanding();
    });
  }

  // A unit's HP, side, conditions and skills change what it gives the units around it
  const unit = (actor) => (actor?.type === "unit") && !!tokenInView(actor);
  Hooks.on("updateActor", (actor) => {
    if ( unit(actor) ) queueStanding();
  });
  for ( const hook of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    Hooks.on(hook, (document) => {
      if ( unit(document.parent) ) queueStanding();
    });
  }
}

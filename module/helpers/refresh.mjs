import { FEO } from "../config.mjs";
import { cooldownsFor } from "./affinity.mjs";
import { tilesApart } from "../rules/reach.mjs";
import {
  NO_SONG, REFRESH_NAME, canRefresh, cursesFor, farthest, groupOf, nearGroup, nearest, optionsOf, refreshSpent, songsFor
} from "../rules/refresh.mjs";
import { spendSkill, usesLeft } from "../rules/skill-usage.mjs";
import { cooldownWith } from "../rules/choices.mjs";
import { skillRefresh } from "../rules/skills.mjs";
import { buildChange } from "../rules/timed.mjs";
import { actAgain, canBeRefreshed, countSung, sungOf } from "./acting.mjs";
import { unitsOn } from "./battle-map.mjs";
import { setConditions } from "./conditions.mjs";
import { grantUnit, healUnit, pop } from "./events.mjs";
import { cannotTarget, tokenTile } from "./exchange.mjs";
import { awardExp, useExp } from "./experience.mjs";
import { relationTo } from "./forced.mjs";
import { takeAction, turnState } from "./phases.mjs";
import { askOwner } from "./rescue.mjs";
import { adjustGauge } from "./shifting.mjs";
import { awardEvent } from "./supports.mjs";

/**
 * Refresh in Foundry: a unit with the skill sings or dances for an ally that has acted, and that ally may move
 * and act again (see `rules/refresh.mjs`). The command of the map, the changes songs lay over it, the other
 * ways it can be used, and the Refresh a skill hands out as something else is done all end in one place,
 * `sing`, which gives each ally its Action back through `actAgain`.
 *
 * A player may Refresh a unit that is not theirs. Whatever changes a unit this user does not own is asked of a
 * Game Master.
 *
 * @import {RefreshCheck, RefreshOption, Refreshing} from "../rules/refresh.mjs"
 */

/** The name of the query that asks a Game Master to have one unit Refresh others. */
export const REFRESH_QUERY = `${FEO.id}.refresh`;

/** The name of the hook called once a unit was Refreshed: with the singer's token, the ally's, and how. */
export const REFRESH_HOOK = `${FEO.id}.unitRefreshed`;

const nameOf = (token) => token?.name || token?.actor?.name || "";

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The tile a token stands on.
 * @param {TokenDocument|null} token
 * @returns {{i: number, j: number}|null}
 */
function tileOf(token) {
  const tile = tokenTile(token);
  return tile ? { i: tile.i, j: tile.j } : null;
}

/* -------------------------------------------- */

/**
 * Is a unit on a map of square tiles, in the fight?
 * @param {TokenDocument|null} token
 * @returns {boolean}
 */
function stands(token) {
  return !!token?.parent?.grid?.isSquare && (token.actor?.type === "unit") && !token.actor.system.defeat?.out && !!tokenTile(token);
}

/* -------------------------------------------- */

/**
 * What a unit's skills, and the changes that last on it, make of Refresh, with its numbers as they are now.
 * A skill that counts a cooldown gives nothing while it runs.
 * @param {Actor|null} actor
 * @returns {Refreshing}
 */
export function refreshingOf(actor) {
  const system = actor?.system ?? {};
  const weapon = system.equippedWeapon;
  const skills = [...(system.skills?.entries ?? []), ...(system.skills?.timed ?? [])]
    .filter((skill) => !((skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0)));
  return skillRefresh(skills, {
    hp: system.hp?.value ?? 0,
    hpMax: system.hp?.max ?? 0,
    level: system.level,
    tier: system.classTier,
    gender: system.profile?.gender ?? "",
    bestRank: system.bestRank ?? "",
    stats: system.statValues ?? {},
    base: system.bare?.base ?? {},
    waiting: !!system.waiting,
    weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
    near: system.skills?.near ?? null,
    conditions: system.conditions ?? {},
    qualities: system.specialQualities ?? "",
    shifted: !!system.shift?.transformed
  });
}

/* -------------------------------------------- */

/**
 * Has a unit the Refresh command, and may it use it? Not one whose skill is not its own to use, as the rule
 * `noSong` has it: what Imitate leaves on a unit that copies one with Refresh.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function sings(actor) {
  if ( (actor?.type !== "unit") || actor.system.skills?.rules?.includes(NO_SONG) ) return false;
  return refreshingOf(actor).use;
}

/* -------------------------------------------- */

/**
 * What a unit's Refresh goes by: the skill that gives it the command.
 * @param {Refreshing} refreshing
 * @returns {string}
 */
function songName(refreshing) {
  return refreshing?.skill || REFRESH_NAME;
}

/* -------------------------------------------- */

/**
 * The other ways a unit may use its Refresh now, beside the regular one.
 * @param {TokenDocument|null} token
 * @returns {RefreshOption[]}
 */
export function refreshOptionsOf(token) {
  if ( !stands(token) || !sings(token.actor) ) return [];
  return optionsOf(refreshingOf(token.actor));
}

/* -------------------------------------------- */

/**
 * A unit as the rules of Refresh read the one it would be used on.
 * @param {TokenDocument} by          The unit that would Refresh it
 * @param {TokenDocument} token
 * @returns {object}
 */
function hearer(by, token) {
  const system = token.actor.system;
  const here = tileOf(by);
  const there = tileOf(token);
  return {
    relation: relationTo(by, token),
    distance: (here && there) ? tilesApart(here, there) : Infinity,
    out: !!system.defeat?.out || !!system.defeat?.state || !(system.hp?.value > 0),
    state: turnState(token.actor, token),
    sings: refreshingOf(token.actor).use,
    rules: system.skills?.rules ?? [],
    hurt: (system.hp?.value ?? 0) < (system.hp?.max ?? 0),
    afflicted: Object.keys(system.conditions ?? {}).length > 0,
    gauge: system.shift?.mode === "gauge"
  };
}

/* -------------------------------------------- */

/**
 * May a unit use its Refresh on another, as they stand?
 * @param {TokenDocument} token       The unit that would Refresh
 * @param {TokenDocument} target      The ally it would be used on
 * @param {object} [options]
 * @param {RefreshOption|null} [options.option]   The way it is used, other than the regular one
 * @param {boolean} [options.near]                Must the ally be within the reach of the command?
 * @returns {(RefreshCheck & {distance: number})|null}    Null for two units that are not both on one map
 */
export function refreshOf(token, target, { option = null, near = true } = {}) {
  if ( !stands(token) || !target?.actor || (token.parent !== target.parent) || !tokenTile(target) ) return null;
  const heard = hearer(token, target);
  return { ...canRefresh(refreshingOf(token.actor), heard, { option, near }), distance: heard.distance };
}

/* -------------------------------------------- */

/**
 * The allies a unit may use its Refresh on.
 * @param {TokenDocument} token
 * @param {object} [options]
 * @param {RefreshOption|null} [options.option]   The way it is used, other than the regular one
 * @returns {{token: TokenDocument, bare: boolean}[]}     Each with whether the reach it is used by leaves out
 *                                                        what some of the unit's skills would lay over it
 */
export function refreshesOf(token, { option = null } = {}) {
  if ( !stands(token) || !sings(token.actor) ) return [];
  const here = tileOf(token);
  const most = farthest(refreshingOf(token.actor));
  const found = [];
  for ( const other of unitsOn(token.parent) ) {
    if ( (other.token === token) || (tilesApart(here, other.tile) > most) ) continue;
    const tried = refreshOf(token, other.token, { option });
    if ( tried?.ok ) found.push({ token: other.token, bare: (tried.range?.without ?? []).length > 0 });
  }
  return found;
}

/* -------------------------------------------- */

/**
 * How many allies a unit's Refresh is used on at once.
 * @param {TokenDocument} token
 * @returns {number}      Infinity for every ally in reach
 */
export function refreshCount(token) {
  return refreshingOf(token?.actor).targets;
}

/* -------------------------------------------- */
/*  Singing                                     */
/* -------------------------------------------- */

/**
 * @typedef SongRequest
 * One unit Refreshes others.
 * @property {TokenDocument} singer           The unit that does
 * @property {TokenDocument[]} targets        The allies it is used on
 * @property {string} [option]                The way it is used, other than the regular one: the option's id
 * @property {Record<string, string>} [foes]  The enemy each change for the nearest enemy goes to, by the
 *                                            change's name: the token's id
 * @property {{skill: string}|null} [side]    The skill that hands the Refresh out, where it is not the command
 */

/**
 * The lasting change one of a singer's skills lays over a unit.
 * @param {object} song                       As `songsFor` and `cursesFor` give them
 * @param {TokenDocument} singer
 * @returns {import("../rules/timed.mjs").TimedChange}
 */
function changeOf(song, singer) {
  return buildChange({ name: song.name, effects: song.effects, ends: song.ends, turns: song.turns, hp: song.hp }, {
    skill: song.skill, from: nameOf(singer), giver: singer.actor.uuid, giverInTurn: true
  });
}

/* -------------------------------------------- */

/**
 * Does a unit have a skill that hands out a Refresh, as a request says it does?
 * @param {Actor} actor
 * @param {string} skill
 * @returns {boolean}
 */
function handsOut(actor, skill) {
  return (actor.system.skills?.entries ?? []).some((entry) => {
    return (entry.name === skill) && (entry.effects ?? []).some((effect) => effect.refreshes);
  });
}

/* -------------------------------------------- */

/**
 * Do what a `SongRequest` says, for a user who may change every unit in it. What it says is checked against
 * the rules again, since it may have been asked for by another user.
 * @param {SongRequest} request
 * @returns {Promise<string[]>}     The tokens of the allies that were Refreshed, by their ids
 */
async function apply({ singer, targets = [], option = "", foes = {}, side = null }) {
  const scene = singer?.parent;
  const actor = singer?.actor;
  if ( !stands(singer) ) return [];
  const refreshing = refreshingOf(actor);
  if ( side ? !handsOut(actor, side.skill) : !sings(actor) ) return [];
  const chosen = (option && !side) ? (optionsOf(refreshing).find((entry) => entry.id === option) ?? null) : null;
  if ( option && !side && !chosen ) return [];
  const name = side ? side.skill : songName(refreshing);
  const done = [];
  const asked = side ? targets : targets.slice(0, Math.max(refreshing.targets, 1));

  for ( const target of asked ) {
    if ( (target?.parent !== scene) || done.includes(target.id) ) continue;
    const tried = refreshOf(singer, target, { option: chosen, near: !side });
    if ( !tried?.ok ) continue;
    const ally = target.actor;
    try {
      if ( chosen?.instead ) {
        // Something else in place of the Action given back
        if ( chosen.heal > 0 ) await healUnit(ally, chosen.heal, { by: actor, byToken: singer, token: target });
        if ( chosen.cure ) {
          const had = Object.keys(ally.system.conditions ?? {});
          const cured = (chosen.cure === "all") ? had : had.filter((id) => chosen.cure.includes(id));
          if ( cured.length ) await setConditions(ally, Object.fromEntries(cured.map((id) => [id, null])));
        }
        if ( (chosen.gauge !== null) && (ally.system.shift?.mode === "gauge") ) {
          const delta = (chosen.gauge === "turn") ? (ally.system.shift.profile?.turnHuman ?? 0) : chosen.gauge;
          if ( delta ) await adjustGauge(ally, delta);
        }
        pop(ally, [{ text: chosen.label, tone: "skill" }]);
      }
      else if ( !canBeRefreshed(ally) || !(await actAgain(ally, target, { skill: name, mov: "full" })) ) continue;

      // What the singer's skills lay over it
      const songs = songsFor(refreshing, { distance: tried.distance, range: tried.range, option: chosen });
      if ( songs.length ) {
        const given = await grantUnit(ally, songs.map((song) => changeOf(song, singer)), { by: actor });
        if ( given?.length ) pop(ally, [...new Set(songs.map((song) => song.skill))].map((text) => ({ text, tone: "skill" })));
      }
      done.push(target.id);
      Hooks.callAll(REFRESH_HOOK, singer, target, { skill: name, option: chosen?.id ?? "" });
    } catch(err) {
      console.error(err);
    }
  }
  if ( !done.length ) return done;

  // What they do to the enemy nearest to the singer, within so many spaces
  for ( const curse of cursesFor(refreshing, chosen) ) {
    try {
      const foe = scene.tokens.get(foes?.[curse.name] ?? "");
      const there = tileOf(foe);
      if ( !foe?.actor || !there || (relationTo(singer, foe) !== "foe") || foe.actor.system.defeat?.out ) continue;
      if ( cannotTarget(actor, singer, foe.actor, foe) ) continue;
      if ( tilesApart(tileOf(singer), there) > curse.within ) continue;
      const given = await grantUnit(foe.actor, [changeOf(curse, singer)], { by: actor });
      if ( given?.length ) pop(foe.actor, [{ text: curse.skill, tone: "skill" }]);
    } catch(err) {
      console.error(err);
    }
  }
  return done;
}

/* -------------------------------------------- */

/**
 * Have one unit Refresh others. Where this user may not change every unit in it, a Game Master does it.
 * @param {SongRequest} request
 * @returns {Promise<string[]>}     The tokens of the allies that were Refreshed, by their ids
 */
export async function sing(request) {
  const singer = request?.singer;
  if ( !singer?.parent ) return [];
  try {
    const touched = [singer, ...(request.targets ?? [])].filter(Boolean);
    if ( touched.every((token) => token.isOwner && token.actor?.isOwner) ) return await apply(request);
    const gm = game.users.activeGM;
    if ( !gm ) return [];
    const answer = await gm.query(REFRESH_QUERY, {
      scene: singer.parent.id, singer: singer.id, targets: (request.targets ?? []).map((target) => target.id),
      option: request.option ?? "", foes: request.foes ?? {}, side: request.side ? { skill: request.side.skill } : null
    }, { timeout: 10000 });
    return Array.isArray(answer) ? answer : [];
  } catch(err) {
    console.error(err);
    return [];
  }
}

/* -------------------------------------------- */

/**
 * Answer a player's request to have one unit Refresh others. Runs for a Game Master; what is asked for is
 * checked against the rules like any other.
 * @param {object} data     A `SongRequest`, with its tokens by what tells them apart on their scene
 * @returns {Promise<string[]>}
 */
export async function refreshQuery({ scene: sceneId, singer, targets, option, foes, side } = {}) {
  const scene = game.scenes?.get(sceneId);
  if ( !game.user.isGM || !scene?.grid?.isSquare || !Array.isArray(targets) ) return [];
  const picked = Object.fromEntries(Object.entries((foes && (typeof foes === "object")) ? foes : {})
    .filter(([name, id]) => (typeof name === "string") && (typeof id === "string")).slice(0, 10));
  try {
    return await apply({
      singer: scene.tokens.get(singer) ?? null,
      targets: targets.slice(0, 40).map((id) => scene.tokens.get(id)).filter(Boolean),
      option: (typeof option === "string") ? option : "",
      foes: picked,
      side: (side && (typeof side.skill === "string")) ? { skill: side.skill } : null
    });
  } catch(err) {
    console.error(err);
    return [];
  }
}

/* -------------------------------------------- */

/**
 * The enemy each change for the nearest enemy goes to. Where several stand equally near, the singer's owner
 * picks one on the map, and a die does where they pass.
 * @param {TokenDocument} token       The singer
 * @param {RefreshOption|null} [option]
 * @returns {Promise<Record<string, string>>}     The token of that enemy by the change's name
 */
async function foesFor(token, option = null) {
  const curses = cursesFor(refreshingOf(token.actor), option);
  if ( !curses.length ) return {};
  const here = tileOf(token);
  // An enemy that cannot be targeted is passed over: the next nearest is taken
  const foes = unitsOn(token.parent).filter((other) => (relationTo(token, other.token) === "foe") && !other.down)
    .filter((other) => !cannotTarget(token.actor, token, other.actor, other.token))
    .map((other) => ({ id: other.token.id, token: other.token, distance: tilesApart(here, other.tile) }));
  const picked = {};
  for ( const curse of curses ) {
    const tied = nearest(foes, curse.within);
    if ( !tied.length ) continue;
    let foe = tied[0];
    if ( tied.length > 1 ) {
      const answer = await askOwner(token, { skill: curse.skill, units: tied.map((entry) => entry.token), hint: "FEO.Refresh.hint.foe" });
      foe = tied.find((entry) => entry.token === answer?.unit) ?? tied[Math.floor(Math.random() * tied.length)];
    }
    picked[curse.name] = foe.id;
  }
  return picked;
}

/* -------------------------------------------- */
/*  The Command                                 */
/* -------------------------------------------- */

/**
 * Say why something cannot be done.
 * @param {string} key          Under `FEO.Refresh`
 * @param {object} [data]
 */
function warn(key, data = {}) {
  ui.notifications.warn(game.i18n.format(`FEO.Refresh.${key}`, data));
}

/* -------------------------------------------- */

/**
 * A unit uses its Refresh on allies within its reach: each may move and act again this turn, or has what the
 * way it is used does instead, and what the unit's skills lay over a Refresh comes with it. It is the unit's
 * Action. Whatever keeps it from it is said instead.
 * @param {TokenDocument} token           The unit that Refreshes
 * @param {TokenDocument[]} targets       The allies it is used on
 * @param {object} [options]
 * @param {string} [options.option]       The way it is used, other than the regular one: the option's id
 * @returns {Promise<boolean>}            Whether anybody was Refreshed
 */
export async function refreshUnits(token, targets, { option = "" } = {}) {
  const actor = token?.actor;
  if ( !stands(token) || !sings(actor) ) return false;
  const refreshing = refreshingOf(actor);
  const chosen = option ? (optionsOf(refreshing).find((entry) => entry.id === option) ?? null) : null;
  if ( option && !chosen ) return false;
  const asked = [...new Set(targets ?? [])].slice(0, Math.max(refreshing.targets, 1));
  for ( const target of asked ) {
    const tried = refreshOf(token, target, { option: chosen });
    if ( tried?.ok ) continue;
    warn(`blocked.${tried?.why ?? "apart"}`, { name: nameOf(target) });
    return false;
  }
  if ( !asked.length ) return false;

  const foes = await foesFor(token, chosen);
  const done = await sing({ singer: token, targets: asked, option: chosen?.id ?? "", foes });
  if ( !done.length ) {
    warn("failed", { name: nameOf(asked[0]) });
    return false;
  }

  // An option that counts a cooldown has its skill sit that out
  const item = chosen?.cooldown ? actor.items.get(chosen.item) : null;
  if ( item?.system.usage?.kind ) {
    const spent = spendSkill(item.system.usage, item.system.state);
    await item.update({ "system.state": { ...spent, cooldown: cooldownWith(chosen.cooldown, cooldownsFor(actor, item)) + FEO.skillUse.cooldownExtra } });
  }

  // Experience from the skill table, and what singing for a partner does for the two
  const exp = useExp(actor, "skill", REFRESH_NAME);
  if ( exp > 0 ) await awardExp(actor, exp);
  for ( const target of asked.filter((entry) => done.includes(entry.id)) ) {
    try {
      await awardEvent("assist", token, { only: target });
    } catch(err) {
      console.error(err);
    }
  }
  await takeAction(actor, token, { action: { kind: "refresh" } });
  return true;
}

/* -------------------------------------------- */
/*  Handed Out by Other Things                  */
/* -------------------------------------------- */

/**
 * The allies around a tile that a skill of a unit could Refresh, as it hands one out.
 * @param {TokenDocument} token       The unit whose skill does
 * @param {{i: number, j: number}|null} centre
 * @param {number} within
 * @param {number} [from]             The nearest they may stand
 * @returns {TokenDocument[]}
 */
function alliesAround(token, centre, within, from = 1) {
  if ( !centre ) return [];
  return unitsOn(token.parent).filter((other) => {
    if ( other.token === token ) return false;
    const apart = tilesApart(centre, other.tile);
    return (apart >= from) && (apart <= within) && !!refreshOf(token, other.token, { near: false })?.ok;
  }).map((other) => other.token);
}

/* -------------------------------------------- */

/**
 * The skills of a unit hand out a Refresh, as something else was done: a foe it defeated, a fight it started,
 * a staff it used. The allies each is for are Refreshed at once, with what the unit's skills lay over a
 * Refresh; where its owner has something to pick, it is offered on the map. What the unit itself is given is
 * handed back, for whoever counts its Action to give it.
 * @param {TokenDocument|null} token      The unit whose skills hand it out
 * @param {{skill: string, refreshes: object}[]} [list]   As a fight, a kill or a staff reports them
 * @param {object} [about]
 * @param {TokenDocument|null} [about.foe]        The foe it fought or defeated
 * @param {TokenDocument|null} [about.target]     The unit a staff was used on
 * @param {{min: number, max: number}|null} [about.reach]     The reach of that staff
 * @returns {Promise<{acts: {skill: string, acts: object}[], moves: {skill: string, canto: object}[]}>}
 *          Another go, or a move, for the unit itself: to hand to `takeAction` with its Action
 */
export async function sideRefreshes(token, list = [], { foe = null, target = null, reach = null } = {}) {
  const own = { acts: [], moves: [] };
  const actor = token?.actor;
  if ( !list?.length || !stands(token) || !actor.isOwner ) return own;
  for ( const { skill, refreshes: part } of list ) {
    try {
      if ( !part || refreshSpent(skill, part, sungOf(actor)) ) continue;
      const most = (part.once === "turn") ? Math.max(part.times ?? 1, 1) : null;
      const side = { skill };
      let done = false;
      switch ( part.to ) {
        // The unit itself moves and acts again
        case "self": {
          if ( !canBeRefreshed(actor) ) break;
          own.acts.push({ skill, acts: { mov: "full" } });
          done = true;
          break;
        }

        // The ally a staff was used on
        case "target": {
          if ( !target || !refreshOf(token, target, { near: false })?.ok ) break;
          done = (await sing({ singer: token, targets: [target], side, foes: await foesFor(token) })).length > 0;
          break;
        }

        // Every ally next to the unit, or every ally next to its foe: its owner picks where both have some
        case "near": {
          const mine = alliesAround(token, tileOf(token), 1);
          const theirs = alliesAround(token, tileOf(foe), 1);
          const ids = (tokens) => tokens.map((entry) => entry.id);
          let { group, ask } = nearGroup(ids(mine), ids(theirs));
          if ( ask ) {
            const answer = await askOwner(token, { skill, units: [...new Set([...mine, ...theirs])], hint: "FEO.Refresh.hint.near" });
            group = (answer?.unit ? groupOf(answer.unit.id, ids(mine), ids(theirs)) : null) ?? ((theirs.length > mine.length) ? "foe" : "self");
          }
          const allies = (group === "foe") ? theirs : (group === "self") ? mine : [];
          if ( allies.length ) done = (await sing({ singer: token, targets: allies, side, foes: await foesFor(token) })).length > 0;

          // A unit whose skills have it Refreshed with them is: for one Action, or for one move
          const refreshing = refreshingOf(actor);
          if ( refreshing.self && canBeRefreshed(actor) ) {
            const picked = await game.feo.hud?.choose?.({
              token, skill: refreshing.skills.self || skill,
              options: [
                { id: "act", label: game.i18n.localize("FEO.Refresh.own.act"), hint: game.i18n.localize("FEO.Refresh.own.actHint") },
                { id: "move", label: game.i18n.localize("FEO.Refresh.own.move"), hint: game.i18n.localize("FEO.Refresh.own.moveHint") }
              ]
            });
            if ( picked === "move" ) own.moves.push({ skill, canto: { mov: "full" } });
            else own.acts.push({ skill, acts: { mov: "none" } });
            done = true;
          }
          break;
        }

        // One ally within so many spaces, or within the reach of the staff, which its owner picks on the map
        case "pick": {
          const within = (part.within === "staff") ? (reach?.max ?? 1) : (part.within ?? 1);
          const allies = alliesAround(token, tileOf(token), within, (part.within === "staff") ? Math.max(reach?.min ?? 1, 1) : 1);
          if ( !allies.length ) break;
          const answer = await askOwner(token, { skill, units: allies, hint: "FEO.Refresh.hint.pick" });
          if ( !answer?.unit || !allies.includes(answer.unit) ) break;
          done = (await sing({ singer: token, targets: [answer.unit], side, foes: await foesFor(token) })).length > 0;
          break;
        }
        default: break;
      }
      if ( done ) {
        // The skill is named over its unit; for the unit itself, the go it is given names it
        if ( part.to !== "self" ) pop(actor, [{ text: skill, tone: "skill" }]);
        await countSung(actor, skill, most);
      }
    } catch(err) {
      console.error(err);
    }
  }
  return own;
}

/* -------------------------------------------- */

/**
 * A unit has used a staff: the skills that hand out a Refresh for that do.
 * @param {TokenDocument|null} token      The unit that used it
 * @param {import("../rules/staves.mjs").StaffCast} cast      What using the staff came to
 * @param {TokenDocument|null} [target]   The unit it was used on
 * @returns {Promise<void>}
 */
export async function staffRefreshes(token, cast, target = null) {
  const list = (cast?.moments ?? []).filter((moment) => moment.refreshes && (!moment.roll || moment.roll.success))
    .map((moment) => ({ skill: moment.skill, refreshes: moment.refreshes }));
  if ( list.length ) await sideRefreshes(token, list, { target, reach: cast.reach ?? null });
}

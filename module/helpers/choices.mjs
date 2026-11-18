import { FEO } from "../config.mjs";
import { AFFINITY_ID } from "../rules/optional.mjs";
import { affinityState, affinityWay, cooldownsFor } from "./affinity.mjs";
import { BONUS_STATS, choosesForFight, fightPicks, rearms, stepPick } from "../rules/choices.mjs";
import { canCounter, isBroken } from "../rules/combat.mjs";
import { canUse, spendSkill, turnsToSitOut } from "../rules/skill-usage.mjs";
import { standsTo } from "./battle-map.mjs";
import { armyOf } from "./exchange.mjs";
import { actsFor } from "./rescue.mjs";
import { wieldCheck } from "./weapons.mjs";

/**
 * What a unit chooses before a fight, in Foundry (see `rules/choices.mjs`): the skills a forecast lists for the
 * unit that attacks, with the steps and the stat it picks for them, which are kept on the skill; and the weapon
 * a unit that is attacked may change to before the fight is rolled, which whoever acts for it is offered on
 * their own map.
 */

/** The name of the query that offers a unit that is attacked another weapon, on the client of whoever acts for it. */
export const REARM_QUERY = `${FEO.id}.rearm`;

/* -------------------------------------------- */
/*  The Choices of a Forecast                   */
/* -------------------------------------------- */

/**
 * @typedef ForecastChoice
 * A skill a forecast lists for the unit that attacks.
 * @property {string} id                  The skill Item
 * @property {string} name
 * @property {string} img
 * @property {"declare"|"toggle"|""} kind How it is switched on; none for one that is always there
 * @property {boolean} on                 Is it switched on?
 * @property {{ok: boolean, reason: string|null}} able    Can it be switched on now?
 * @property {number} turns               Turns of cooldown it still sits out
 * @property {boolean} stopped            Does a skill of the foe stop it in this fight?
 * @property {boolean} idle               Is it on, and comes to nothing in this fight?
 * @property {{id: string, kind: "steps"|"stat", part: string, give?: object, gain?: object, cost?: object,
 *   steps?: number, most?: number, stat?: string}[]} picks
 *                                        What it has its unit pick, with the steps taken and the most there
 *                                        are, or the stat picked
 */

/**
 * The skills of a unit that a forecast lists: those it switches on for a fight, and those that are always there
 * and have it pick something for one.
 * @param {Actor} actor
 * @param {import("../rules/combat.mjs").ExchangeSide|null} [side]    The unit's side of the fight as planned
 * @returns {ForecastChoice[]}
 */
export function fightChoices(actor, side = null) {
  const choices = [];
  const fx = side?.unit?.fx ?? null;
  for ( const item of actor?.items ?? [] ) {
    if ( (item.type !== "skill") || !item.system.equipped || (item.system.automate === false) ) continue;
    const { usage, state, effects } = item.system;
    const kind = ["declare", "toggle"].includes(usage?.kind) ? usage.kind : "";
    const picks = fightPicks(effects);
    if ( kind ? !choosesForFight(effects) : !picks.length ) continue;
    const on = !kind || !!state?.active;
    choices.push({
      id: item.id,
      name: item.name,
      img: item.img,
      kind,
      on,
      able: (kind === "declare") ? canUse(usage, state) : { ok: true, reason: null },
      turns: kind ? turnsToSitOut(state) : 0,
      usesLeft: (usage?.uses > 0) ? Math.max(usage.uses - (state?.used ?? 0), 0) : null,
      stopped: !!side?.stopped?.includes(item.name),
      idle: on && !!side?.idle?.includes(item.name),
      picks: picks.map((pick) => {
        if ( pick.kind === "stat" ) {
          const stat = state?.picked?.stat;
          return { ...pick, stat: BONUS_STATS.includes(stat) ? stat : "" };
        }
        const told = fx?.picks?.[`${item.name}|${pick.id}`] ?? null;
        return { ...pick, steps: told?.steps ?? null, most: told?.most ?? null };
      })
    });
  }

  // An Affinity its unit chooses when to use, which a fight spends, is ticked like a skill that is declared.
  // It is no skill: what stops skills in a fight leaves it
  const way = affinityWay(actor);
  if ( way && (way.spentBy === "fight") ) {
    const state = affinityState(actor);
    choices.push({
      id: AFFINITY_ID,
      name: way.name,
      img: "",
      kind: "declare",
      innate: true,
      on: state.active,
      able: canUse(way.usage, state),
      turns: turnsToSitOut(state),
      usesLeft: (way.usage.uses > 0) ? Math.max(way.usage.uses - state.used, 0) : null,
      stopped: false,
      idle: state.active && !!side?.idle?.includes(way.name),
      picks: []
    });
  }
  return choices;
}

/* -------------------------------------------- */

/**
 * Change the steps a unit picked for one of a skill's picks: one more, one less, or all or none of them.
 * @param {Item} item                 The skill
 * @param {string} id                 The pick, as its effect names it
 * @param {"more"|"less"|"all"} how
 * @param {{steps: number, most: number}} now     The steps taken as the fight is planned, and the most there are
 * @returns {Promise<boolean>}        Whether anything changed
 */
export async function stepChoice(item, id, how, { steps = 0, most = 0 } = {}) {
  if ( (item?.type !== "skill") || !fightPicks(item.system.effects).some((pick) => (pick.id === id) && (pick.kind === "steps")) ) return false;
  const next = stepPick(steps, most, how);
  if ( next === steps ) return false;
  await item.update({ "system.state.picked": { [id]: next } });
  return true;
}

/* -------------------------------------------- */

/**
 * Keep the stat a unit picked for a skill that asks for one; none for the one with the most to lose.
 * @param {Item} item
 * @param {string} stat
 * @returns {Promise<boolean>}
 */
export async function pickStat(item, stat) {
  if ( (item?.type !== "skill") || !fightPicks(item.system.effects).some((pick) => pick.kind === "stat") ) return false;
  await item.update({ "system.state.picked": { stat: BONUS_STATS.includes(stat) ? stat : "" } });
  return true;
}

/* -------------------------------------------- */
/*  Changing Weapon Before a Fight              */
/* -------------------------------------------- */

/**
 * The skill that lets a unit change its weapon before a fight an enemy starts, if it has one it can use now:
 * one that costs nothing before one that counts its uses.
 * @param {Actor} actor
 * @param {object} [foe]
 * @param {boolean} [foe.nihil]     Does the unit that attacks cancel skills, as Nihil does?
 * @returns {Item|null}
 */
export function rearmSkill(actor, { nihil = false } = {}) {
  const found = (actor?.items ?? []).filter((item) => {
    if ( (item.type !== "skill") || !item.system.equipped || (item.system.automate === false) || !rearms(item.system.effects) ) return false;

    // A unit that cancels skills cancels those it is marked to, and stops those that are chosen when to activate
    if ( nihil && (item.system.nihil || item.system.chosen) ) return false;
    return !item.system.usage?.kind || canUse(item.system.usage, item.system.state).ok;
  });
  return found.find((item) => !item.system.usage?.kind) ?? found[0] ?? null;
}

/* -------------------------------------------- */

/**
 * The weapons a unit could change to: those in its pack that it may wield and that are not broken, other than
 * the one in hand, each with whether it would answer this attack.
 * @param {Actor} actor
 * @param {object} fight
 * @param {object|null} [fight.weapon]    The weapon it is attacked with: category, range, effect
 * @param {number} [fight.distance]       Tiles between the two
 * @returns {{id: string, label: string, hint: string, img: string}[]}
 */
export function rearmOptions(actor, { weapon = null, distance = 1 } = {}) {
  const i18n = game.i18n;
  return (actor?.items ?? []).filter((item) => {
    if ( (item.type !== "weapon") || item.system.equipped || (item.system.category === "staff") ) return false;
    if ( item.system.broken || isBroken({ uses: item.system.uses }) ) return false;
    return wieldCheck(actor, item).ok;
  }).map((item) => {
    const answers = canCounter({ category: item.system.category, range: item.system.range, effect: item.system.effect }, weapon, distance, actor.system.statValues);
    return {
      id: item.id,
      label: item.name,
      img: item.img,
      hint: `${i18n.localize("FEO.Hud.might")} ${item.system.might} · ${i18n.localize("FEO.Combat.hit")} ${item.system.hit} · `
        + i18n.localize(answers ? "FEO.Choice.rearm.answers" : "FEO.Choice.rearm.silent")
    };
  });
}

/* -------------------------------------------- */

/**
 * Offer a unit that is attacked another weapon, on this client, and put the one picked in its hand. The skill
 * that lets it counts a use where it counts them. No answer in time is a no.
 * @param {TokenDocument} token       The unit that is attacked
 * @param {TokenDocument|null} foe    The unit that attacks it
 * @param {number} distance
 * @returns {Promise<boolean>}        Whether it changed its weapon
 */
async function rearmHere(token, foe, distance) {
  const actor = token?.actor;
  if ( !actor?.isOwner || actor.system.defeat?.state || !(actor.system.hp?.value > 0) ) return false;
  const skill = rearmSkill(actor, { nihil: !!foe?.actor?.system.skills?.rules?.includes("nihil") });
  if ( !skill ) return false;
  const held = foe?.actor?.system.equippedWeapon;
  const options = rearmOptions(actor, {
    weapon: held ? { category: held.system.category, range: held.system.range, effect: held.system.effect } : null,
    distance
  });
  if ( !options.length ) return false;

  // The list takes the place of whatever the user had selected, which is theirs again once it is answered
  const before = (globalThis.canvas?.tokens?.controlled ?? []).slice();
  const picked = await game.feo.hud?.choose?.({
    token,
    skill: skill.name,
    hint: game.i18n.format("FEO.Choice.rearm.hint", { foe: foe?.name || foe?.actor?.name || "" }),
    options,
    wait: FEO.choices.promptTime
  });
  try {
    const mine = token.object;
    if ( before.length && !((before.length === 1) && (before[0] === mine)) ) {
      mine?.release();
      for ( const other of before ) if ( !other.destroyed ) other.control({ releaseOthers: false });
    }
  } catch(err) {
    console.error(err);
  }
  const weapon = picked ? actor.items.get(picked) : null;
  if ( weapon?.type !== "weapon" ) return false;
  await actor.updateEmbeddedDocuments("Item", actor.items
    .filter((other) => (other.type === "weapon") && ((other.id === weapon.id) || other.system.equipped))
    .map((other) => ({ _id: other.id, "system.equipped": other.id === weapon.id })));
  if ( skill.system.usage?.kind ) {
    await skill.update({ "system.state": spendSkill(skill.system.usage, skill.system.state, { cooldowns: cooldownsFor(actor, skill) }) });
  }
  try {
    const { pop } = await import("./events.mjs");
    pop(actor, [{ text: `${skill.name}: ${weapon.name}`, tone: "skill" }]);
  } catch(err) {
    console.error(err);
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Answer another client's request to offer a unit this user acts for another weapon, before a fight it is
 * attacked in is rolled. Only a unit this user owns, on the scene in view, is offered anything.
 * @param {{scene: string, token: string, foe: string, distance: number}} data
 * @returns {Promise<boolean>}
 */
export async function rearmQuery({ scene: sceneId, token: tokenId, foe: foeId, distance } = {}) {
  const scene = game.scenes?.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  if ( !token?.isOwner || (scene !== globalThis.canvas?.scene) ) return false;
  return rearmHere(token, scene.tokens.get(foeId) ?? null, Math.max(Math.floor(Number(distance)) || 1, 1));
}

/* -------------------------------------------- */

/**
 * A unit is about to be attacked by an enemy: where a skill lets it change its weapon first, whoever acts for
 * it is offered the weapons it could change to, on whichever client they sit, with one click to take one and
 * no answer taken for a no.
 * @param {TokenDocument|null} attacker
 * @param {TokenDocument|null} defender
 * @param {number} distance
 * @returns {Promise<boolean>}        Whether the unit changed its weapon
 */
export async function offerRearm(attacker, defender, distance) {
  const actor = defender?.actor;
  if ( !attacker?.actor || !actor || !defender.parent ) return false;
  if ( standsTo({ army: armyOf(attacker.actor, attacker) }, { army: armyOf(actor, defender) }) !== "foe" ) return false;
  if ( !rearmSkill(actor, { nihil: !!attacker.actor.system.skills?.rules?.includes("nihil") }) ) return false;
  if ( !rearmOptions(actor).length ) return false;
  const user = actsFor(actor);
  if ( !user ) return false;
  try {
    if ( user === game.user ) return await rearmHere(defender, attacker, distance);
    return !!(await user.query(REARM_QUERY, { scene: defender.parent.id, token: defender.id, foe: attacker.id, distance }, {
      timeout: FEO.choices.promptTime + 5000
    }));
  } catch(err) {
    console.error(err);
    return false;
  }
}

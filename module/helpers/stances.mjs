import { FEO } from "../config.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { BLOW, blowsTotal, guardsFor, keepStances, stancesOf, stepsInAlone, wardsAlone } from "../rules/stances.mjs";
import { unitsOn } from "./battle-map.mjs";
import { armyOf, planAttack, tokenTile } from "./exchange.mjs";
import { damageUnit, grantUnit, pop, spendFor } from "./events.mjs";
import { moveUnits, moves, onMap } from "./forced.mjs";
import { groundUnder } from "./terrain.mjs";
import { timedOf } from "./timed.mjs";

/**
 * Standing guard in Foundry (see `rules/stances.mjs`): keeping a unit's stances while what they hang on holds,
 * finding the unit that is fought in another's place before an attack is made, asking whoever acts for a unit
 * that may step in, and having the units that stand by answer a hit on their ally in the middle of a fight.
 *
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The name by which a unit is called on the map. */
const nameOf = (token) => token?.name || token?.actor?.name || "";

/**
 * The tile a token stands on.
 * @param {TokenDocument|null} token
 * @returns {Tile|null}
 */
function tileOf(token) {
  const tile = tokenTile(token);
  return tile ? { i: tile.i, j: tile.j } : null;
}

/* -------------------------------------------- */
/*  Stances                                     */
/* -------------------------------------------- */

/**
 * The stances a unit is in, each by the name of its change and with what the stance says.
 * @param {Actor|null} actor
 * @returns {{name: string, from: string, stance: import("../rules/stances.mjs").Stance}[]}
 */
export function stancesOn(actor) {
  return (actor?.type === "unit") ? stancesOf(timedOf(actor)) : [];
}

/* -------------------------------------------- */

/**
 * How many allies stand next to a unit on the map.
 * @param {TokenDocument} token
 * @returns {number}
 */
function alliesBeside(token) {
  const here = tileOf(token);
  if ( !here || !token.parent?.grid?.isSquare ) return 0;
  const army = armyOf(token.actor, token);
  return unitsOn(token.parent).filter((other) => {
    if ( (other.token === token) || other.down || !(other.actor.system.hp?.value > 0) ) return false;
    return (tilesApart(here, other.tile) === 1) && (FEO.camps[other.army] ?? null) && (FEO.camps[other.army] === (FEO.camps[army] ?? null));
  }).length;
}

/* -------------------------------------------- */

/**
 * Something has come about that may end a unit's stances: it was moved, an ally has left its side, it made an
 * attack. Those that end with it are taken off the unit, through the one way a change comes to a unit, so that
 * a unit this user may not change has its Game Master do it.
 * @param {TokenDocument|null} token
 * @param {object} [came]
 * @param {boolean} [came.moved]          It was moved, by itself or by anything else
 * @param {boolean} [came.attacked]       It made an attack
 * @returns {Promise<string[]>}           The stances that ended, by name
 */
export async function settleStances(token, { moved = false, attacked = false } = {}) {
  const actor = token?.actor;
  if ( (actor?.type !== "unit") || !stancesOn(actor).length ) return [];
  const facts = { moved, attacked };
  if ( token.parent?.grid?.isSquare && tokenTile(token) ) {
    facts.allies = alliesBeside(token);
    facts.terrain = groundUnder(token)?.terrain ?? undefined;
  }
  const { ended } = keepStances(timedOf(actor), facts);
  if ( !ended.length ) return [];
  await grantUnit(actor, ended.map((change) => ({
    name: change.name, from: change.from ?? "", effects: [], ends: "map", turns: 0, clock: "", stacks: 0, max: 0, fades: false, drop: 9999
  })));
  return ended.map((change) => change.name);
}

/* -------------------------------------------- */

/**
 * The units of a scene have moved, or one of them has fallen: every stance that hangs on who stands next to
 * its unit, or on the ground under it, is looked at again.
 * @param {Scene|null} scene
 * @returns {Promise<void>}
 */
export async function settleScene(scene) {
  if ( !scene?.grid?.isSquare ) return;
  for ( const token of scene.tokens ) {
    if ( (token.actor?.type !== "unit") || token.actor.system.defeat?.out ) continue;
    if ( !stancesOn(token.actor).some(({ stance }) => stance.until.includes("alone") || stance.until.includes("terrain")) ) continue;
    await settleStances(token);
  }
}

/* -------------------------------------------- */
/*  Fighting in Another's Place                 */
/* -------------------------------------------- */

/**
 * @typedef StandIn
 * A unit that is fought in the place of another.
 * @property {TokenDocument} token        The unit that fights
 * @property {TokenDocument} holder       The unit whose skill or stance has it so
 * @property {TokenDocument} ally         The unit it stands in for
 * @property {string} skill
 * @property {string} id                  The holder's skill Item, where there is one
 * @property {boolean} may
 * @property {boolean} swap
 * @property {{tile: Tile, skill: string, effects: object[], ally: string}} stand
 *                                        What the fight is told (see `planAttack`): the tile it is fought on,
 *                                        and what the unit has for it
 */

/**
 * The units that may be fought in the place of a unit another is about to attack, those that stand guard for
 * it first (see `guardsFor`).
 * @param {TokenDocument|null} token      The unit that attacks
 * @param {TokenDocument|null} target     The unit it attacks
 * @returns {StandIn[]}
 */
export function guardOffers(token, target) {
  const scene = target?.parent;
  if ( !token?.actor || !target?.actor || !scene?.grid?.isSquare || (token.parent !== scene) || !tileOf(target) ) return [];
  const units = unitsOn(scene);
  const describe = (unit) => ({
    id: unit.token.id,
    uuid: unit.actor.uuid,
    tile: unit.tile,
    side: unit.army,
    out: unit.down || !(unit.actor.system.hp?.value > 0),
    qualities: unit.actor.system.specialQualities ?? "",
    guard: unit.actor.system.guard ?? []
  });
  const placed = units.map(describe);
  const find = (document) => placed.find((unit) => unit.id === document.id)
    ?? { id: document.id, uuid: document.actor.uuid, tile: tileOf(document), side: armyOf(document.actor, document), qualities: "", guard: [] };
  const there = tileOf(target);
  return guardsFor(find(target), find(token), placed).map((offer) => {
    const guard = scene.tokens.get(offer.guard);
    const holder = scene.tokens.get(offer.holder);
    if ( !guard?.object || !holder ) return null;
    return {
      token: guard, holder, ally: target, skill: offer.skill, id: offer.id, may: offer.may, swap: offer.swap,
      stand: { tile: there, skill: offer.skill, effects: offer.effects, ally: nameOf(target) }
    };
  }).filter(Boolean);
}

/* -------------------------------------------- */

/**
 * The unit that stands guard for another, and is fought in its place whoever attacks it: known before the
 * attack is made, so that the forecast shows it.
 * @param {TokenDocument|null} token      The unit that attacks
 * @param {TokenDocument|null} target     The unit it attacks
 * @returns {StandIn|null}
 */
export function sureGuard(token, target) {
  try {
    return guardOffers(token, target).find((offer) => !offer.may) ?? null;
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * The units that may step into the place of another as it is attacked, if whoever acts for them says so.
 * @param {TokenDocument|null} token
 * @param {TokenDocument|null} target
 * @returns {StandIn[]}
 */
export function mayGuards(token, target) {
  try {
    return guardOffers(token, target).filter((offer) => offer.may);
  } catch(err) {
    console.error(err);
    return [];
  }
}

/* -------------------------------------------- */

/**
 * What the attacks of a unit would take off another if they all land, as the fight is planned.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {Token} target
 * @param {object|null} [stand]
 * @returns {number|null}     Null where the fight cannot be planned
 */
function wouldTake(actor, token, target, stand = null) {
  const matchup = planAttack(actor, token, target, { stand });
  if ( matchup.warning ) return null;
  const plan = matchup.makePlan(matchup.distance);
  return plan.initiator.blocked ? 0 : blowsTotal(plan.initiator.blows);
}

/* -------------------------------------------- */

/**
 * An attack is about to be made on a unit: the unit that is fought in its place, if one is. A unit that
 * stands guard for it is; else each unit that may step in is offered it in turn, in one click, by whoever
 * acts for the unit whose skill it is, and a unit that answers by itself steps in where that spares its side.
 * @param {Actor} actor                   The unit that attacks
 * @param {TokenDocument|null} token
 * @param {Token} targetToken             The unit it attacks
 * @returns {Promise<StandIn|null>}
 */
export async function standInFor(actor, token, targetToken) {
  const target = targetToken?.document;
  if ( !token || !target ) return null;
  const offers = guardOffers(token, target);
  const sure = offers.find((offer) => !offer.may);
  if ( sure ) return sure;
  const { answersAlone, askFor } = await import("./answers.mjs");
  for ( const offer of offers ) {
    const holder = offer.holder;
    let takes = false;
    try {
      if ( answersAlone(holder.actor) ) {
        const ally = wouldTake(actor, token, targetToken);
        const guard = wouldTake(actor, token, offer.token.object, offer.stand);
        takes = (ally !== null) && (guard !== null) && stepsInAlone({
          ally: { hp: target.actor.system.hp.value, takes: ally },
          guard: { hp: offer.token.actor.system.hp.value, takes: guard }
        });
      }
      else {
        const key = `${offer.token.id}|${offer.skill}`;
        const through = offer.token !== holder;
        const point = {
          index: 0, on: "guard", side: "defender", attack: null, ally: nameOf(target),
          about: game.i18n.format("FEO.Stance.about.attack", { foe: nameOf(token), ally: nameOf(target) }),
          offers: [{ key, skill: offer.skill, id: offer.id || null, what: through ? "guardThrough" : "guard", by: nameOf(offer.token), ally: nameOf(target) }]
        };
        takes = (await askFor({ token: holder, actor: holder.actor }, point, nameOf(token))) === key;
      }
    } catch(err) {
      console.error(err);
    }
    if ( takes ) return offer;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * A fight in which a unit stood in for another is over: its skill says so over it, and where the skill has the
 * two trade places they do, if both still stand and may be moved.
 * @param {StandIn} stood
 * @returns {Promise<void>}
 */
export async function afterStandIn(stood) {
  if ( !stood?.swap ) return;
  const { token, ally } = stood;
  const here = tileOf(token);
  const there = tileOf(ally);
  if ( !here || !there || !onMap(token) || !onMap(ally) ) return;
  if ( !moves(token, ally) || !moves(ally, token) ) return;
  await moveUnits([{ token, tile: there }, { token: ally, tile: here }]);
}

/* -------------------------------------------- */
/*  Taking a Hit Meant for Another              */
/* -------------------------------------------- */

/**
 * The units that stand by for a unit before a fight is rolled, to take a hit that would land on it or to turn
 * it back: every ally near enough whose skill lets it, with a use left, that still stands. The fight has such
 * a hit answered by them, like every other answer in the middle of a fight (see `helpers/answers.mjs`).
 * @param {TokenDocument|null} victim       The unit that may be hit
 * @param {TokenDocument|null} attacker     The unit it fights
 * @returns {(import("../rules/stances.mjs").WardStandby & {token: TokenDocument, item: Item|null})[]}
 */
export function wardStandby(victim, attacker) {
  const there = tileOf(victim);
  if ( !victim?.actor || !there || !victim.parent?.grid?.isSquare ) return [];
  const side = FEO.camps[armyOf(victim.actor, victim)] ?? null;
  const standing = [];
  for ( const other of unitsOn(victim.parent) ) {
    const { token, actor } = other;
    if ( (token === victim) || (token === attacker) || other.down || !(actor.system.hp?.value > 0) ) continue;
    if ( !side || ((FEO.camps[other.army] ?? null) !== side) ) continue;
    for ( const ward of actor.system.wards ?? [] ) {
      if ( tilesApart(other.tile, there) > ward.within ) continue;
      const stats = actor.system.battleValues ?? actor.system.statValues ?? {};
      standing.push({
        key: `${token.id}|${ward.skill}`, skill: ward.skill, by: nameOf(token), at: BLOW,
        takes: ward.takes, negate: ward.negate, returns: ward.returns, heavy: ward.heavy,
        hp: actor.system.hp.value, stats: { def: stats.def ?? 0, res: stats.res ?? 0 },
        token, item: ward.id ? (actor.items.get(ward.id) ?? null) : null
      });
    }
  }
  return standing;
}

/* -------------------------------------------- */

/**
 * A hit that deals damage would land on a unit that allies stand by for: each is offered it in turn, in one
 * click, by whoever acts for it, and the first that takes it has answered. A unit that answers by itself
 * takes a hit where that spares its side, and turns back whatever it can.
 * @param {import("../rules/answers.mjs").AnswerPoint} point
 * @param {ReturnType<typeof wardStandby>} standing     The units that stood by as the fight began
 * @param {{initiator: {token: TokenDocument|null, actor: Actor}, defender: {token: TokenDocument|null, actor: Actor}}} units
 * @returns {Promise<string|null>}        The key of the offer taken, or null
 */
export async function answerBlow(point, standing, units) {
  const { answersAlone, askFor } = await import("./answers.mjs");
  const victim = units[point.side];
  const attacker = units[(point.side === "initiator") ? "defender" : "initiator"];
  const ally = nameOf(victim?.token) || victim?.actor?.name || "";
  for ( const offer of point.offers ?? [] ) {
    const ward = (standing ?? []).find((entry) => entry.key === offer.key);
    if ( !ward ) continue;
    let takes = false;
    try {
      if ( answersAlone(ward.token.actor) ) takes = wardsAlone(offer, point.attack ?? {});
      else {
        const asked = { ...point, ally, offers: [{ ...offer, ally }] };
        takes = (await askFor({ token: ward.token, actor: ward.token.actor }, asked, nameOf(attacker?.token) || attacker?.actor?.name || "")) === offer.key;
      }
    } catch(err) {
      console.error(err);
    }
    if ( takes ) return offer.key;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * A fight is saved in which allies outside of it answered a hit: the unit that took one takes its damage,
 * through the one way damage comes to a unit, as an attack of the unit that made it; each skill that answered
 * says so over its unit and has a use counted.
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {{initiator: TokenDocument|null, defender: TokenDocument|null}} tokens
 * @returns {Promise<{skill: string, by: string, what: string, amount: number, ally: string}[]>}     What came of each, for the card
 */
export async function takeWards(result, tokens) {
  const told = [];
  for ( const ward of result?.wards ?? [] ) {
    const victim = tokens[ward.side];
    const attacker = tokens[(ward.side === "initiator") ? "defender" : "initiator"];
    const scene = victim?.parent ?? attacker?.parent;
    const [id] = String(ward.key).split("|");
    const token = scene?.tokens.get(id);
    if ( !token?.actor ) continue;
    try {
      pop(token.actor, [{ text: ward.skill, tone: "skill" }]);
      const item = token.actor.items.find((entry) => (entry.type === "skill") && (entry.name === ward.skill) && entry.system.usage?.kind);
      if ( item ) await spendFor(token.actor, item.id);
      if ( (ward.what === "redirect") && (ward.amount > 0) ) {
        await damageUnit(token.actor, ward.amount, { kind: "attack", settled: true, by: attacker?.actor ?? null, byToken: attacker ?? null, token });
      }
      told.push({ skill: ward.skill, by: nameOf(token), what: ward.what, amount: ward.amount, ally: nameOf(victim) });
    } catch(err) {
      console.error(err);
    }
  }
  return told;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what stances listen for. Called once, when the system starts.
 */
export function registerHooks() {
  // A unit that is moved, however that came about, is in no stance that lasts until it moves; and every stance
  // that hangs on who stands next to its unit is looked at again once the units stand where they now do. The
  // user who moved the token sees to the first, an active Game Master to the second, or that user without one
  Hooks.on("updateToken", (token, changes, options, userId) => {
    try {
      if ( !(("x" in changes) || ("y" in changes)) || (token.actor?.type !== "unit") ) return;
      const mine = userId === game.user.id;
      if ( mine ) settleStances(token, { moved: true }).catch((err) => console.error(err));
      if ( game.users.activeGM ? game.user.isActiveGM : mine ) settleScene(token.parent).catch((err) => console.error(err));
    } catch(err) {
      console.error(err);
    }
  });

  // So is it when a unit falls or leaves the map
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    try {
      if ( !foundry.utils.hasProperty(changed, "system.defeat.state") && !foundry.utils.hasProperty(changed, "system.hp.value") ) return;
      if ( !(game.users.activeGM ? game.user.isActiveGM : (userId === game.user.id)) ) return;
      if ( !(actor.system.hp?.value > 0) || actor.system.defeat?.out ) settleScene(globalThis.canvas?.scene ?? null).catch((err) => console.error(err));
    } catch(err) {
      console.error(err);
    }
  });
  Hooks.on("deleteToken", (token, options, userId) => {
    if ( game.users.activeGM ? game.user.isActiveGM : (userId === game.user.id) ) settleScene(token.parent).catch((err) => console.error(err));
  });
}

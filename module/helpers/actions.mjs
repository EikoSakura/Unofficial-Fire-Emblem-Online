import { FEO } from "../config.mjs";
import { cooldownsFor } from "./affinity.mjs";
import {
  GRIPPED, MAP_REACH, WEAPON_REACH, actAmount, actArea, actForAll, actGrant, actInflicts, actInstead, actOf, actPicksTile, actReaches, actWays, actWears,
  activationSkills, bestCheck, dragTo, gripHolds, lentEffects, maneuverAt, maneuvers, opposedCheck, pickBy, strikeWeapon, tollOf, wornDown
} from "../rules/actions.mjs";
import { reaches } from "../rules/combat.mjs";
import { UNFORCED, clearLine, swaps } from "../rules/forced.mjs";
import { tilesApart } from "../rules/reach.mjs";
import { readNumber, weaponIs, weaponTypeOf } from "../rules/skills.mjs";
import { canUse } from "../rules/skill-usage.mjs";
import { cooldownWith } from "../rules/choices.mjs";
import { terrainType } from "../rules/terrain.mjs";
import { buildChange, chosenEffects, pickCount, tollsOf } from "../rules/timed.mjs";
import { forcedField, unitsOn, wallBetween } from "./battle-map.mjs";
import { postCard, rollD100 } from "./chat.mjs";
import { cutIn } from "./cut-ins.mjs";
import { afflictUnit, damageUnit, grantUnit, healUnit, pop } from "./events.mjs";
import { applyChanges, cannotTarget, planAttack, tokenTile } from "./exchange.mjs";
import { moveUnits, moves, onMap, relationTo } from "./forced.mjs";
import { rangesWith, turnMoveOf } from "./movement.mjs";
import { inSight } from "./sight.mjs";
import { hasActed, takeAction } from "./phases.mjs";
import { creatureOf } from "./creatures.mjs";
import { imitateUnit, imitationBar } from "./imitation.mjs";
import { tileGround } from "./terrain.mjs";

/**
 * Skills used as an action on a unit picked on the map, in Foundry (see `rules/actions.mjs`): which units a
 * skill may be used on from where its unit stands, and doing its part once the target is picked. The map
 * offers the targets (see the Battle HUD) and then has the unit sheet use the skill as it uses any other, so
 * that its cooldown, its card and the unit's Action are the same wherever it was used from.
 *
 * A unit that has hold of another keeps that as its flag `grip`: the token it holds and the skill it holds it
 * with. Nothing is kept on the unit that is held, which reads it from its holder for as long as the hold lasts.
 *
 * @import {Tile} from "../rules/reach.mjs"
 */

/** The name of the query that asks a Game Master to end a hold for a player who does not own the holder. */
export const GRIP_QUERY = `${FEO.id}.endGrip`;

/** The flag, on a unit, that says which unit it has hold of. */
const GRIP_FLAG = "grip";

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

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

/**
 * What a unit's flag says of the unit it has hold of.
 * @param {Actor|null} actor
 * @returns {{token: string, skill: string, item: string, home: Tile|null}|null}
 */
export function gripOf(actor) {
  const grip = actor?.getFlag(FEO.id, GRIP_FLAG);
  if ( !grip || (typeof grip.token !== "string") || !grip.token ) return null;
  const home = (Number.isInteger(grip.home?.i) && Number.isInteger(grip.home?.j)) ? { i: grip.home.i, j: grip.home.j } : null;
  return { token: grip.token, skill: String(grip.skill ?? ""), item: String(grip.item ?? ""), home };
}

/* -------------------------------------------- */

/**
 * The unit a unit has hold of, while the hold stands: the two are both in the fight, next to each other.
 * @param {TokenDocument|null} holder
 * @returns {TokenDocument|null}
 */
export function holding(holder) {
  const grip = gripOf(holder?.actor);
  const held = grip ? holder.parent?.tokens.get(grip.token) : null;
  if ( !held?.actor ) return null;
  const placed = (token) => ({ tile: tileOf(token), out: !!token.actor.system.defeat?.out || !(token.actor.system.hp?.value > 0) });
  return gripHolds(placed(holder), placed(held)) ? held : null;
}

/* -------------------------------------------- */

/**
 * The unit that has hold of a unit, if one does.
 * @param {TokenDocument|null} token
 * @returns {TokenDocument|null}
 */
export function heldBy(token) {
  if ( !token?.parent ) return null;
  for ( const other of token.parent.tokens ) {
    if ( (other === token) || (other.actor?.type !== "unit") || !gripOf(other.actor) ) continue;
    if ( holding(other) === token ) return other;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Is a unit held by another, so that it takes no Action but to try to break free, or to Wait?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isGripped(actor) {
  return !!actor?.system?.skills?.rules?.includes(GRIPPED);
}

/* -------------------------------------------- */

/**
 * What a skill does to a unit picked on the map, as its unit stands: of the ways it may say so, the first
 * whose condition the unit meets (another skill it has equipped, its class tier).
 * @param {TokenDocument|null} token      The unit that has the skill
 * @param {Item|null} item                The skill
 * @returns {object|null}                 Its `act` part
 */
export function actFor(token, item) {
  const actor = token?.actor ?? item?.parent ?? null;
  const has = (name) => !!actor?.items?.some((entry) => (entry.type === "skill") && entry.system.equipped && (entry.name === name));
  return actOf(item?.system, (when) => {
    if ( (when.skill !== undefined) && !has(when.skill) ) return false;
    if ( (when.noSkill !== undefined) && has(when.noSkill) ) return false;
    const tier = actor?.system?.classTier ?? 1;
    if ( (when.tier?.min !== undefined) && (tier < when.tier.min) ) return false;
    if ( (when.tier?.max !== undefined) && (tier > when.tier.max) ) return false;
    return true;
  });
}

/* -------------------------------------------- */

/**
 * A unit as a number of a skill is read from it: its HP, its stats, the weapon in its hand.
 * @param {TokenDocument} token
 * @returns {object}
 */
function viewOf(token) {
  const system = token.actor.system;
  return {
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    stats: system.statValues,
    combat: Object.fromEntries(Object.entries(system.combat ?? {}).map(([key, stat]) => [key, stat.value])),
    weapon: system.equippedWeapon ? { name: system.equippedWeapon.name, ...system.equippedWeapon.system } : null
  };
}

/* -------------------------------------------- */

/**
 * The one attack a skill has its unit make on the unit it is used on, as a fight is told of it (see `extra` in
 * `planExchange`): what it is made with, at what share of its damage, and whether it activates skills. It is
 * made with a weapon of the kind the skill names that the unit carries and may wield, or with numbers of its
 * own in place of a weapon.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @returns {object|null}             Null for a skill that makes no such attack, or a unit without the weapon
 */
export function strikeOf(token, item) {
  const act = actFor(token, item);
  const strike = act?.strike;
  if ( !strike || !token?.actor ) return null;
  const actor = token.actor;
  let arm = null;

  // With the weapon in its hand, which must be fit to attack with
  if ( strike.hand ) {
    const held = actor.system.equippedWeapon;
    if ( !held || (held.system.category === "staff") || held.system.broken || ((held.system.uses?.max > 0) && !(held.system.uses.value > 0)) ) return null;

    // Only a weapon of the kinds the skill names, and only one that attacks: one with a Hit of its own
    if ( strike.only && !weaponIs({ name: held.name, category: held.system.category }, strike.only) ) return null;
    if ( strike.combat && !(held.system.hit > 0) ) return null;
    return {
      skill: item.name, item: item.id, share: (strike.share ?? 100) / 100, free: false, plain: !!strike.plain,
      effects: strike.effects ?? [], arm: null, image: held.img ?? ""
    };
  }
  if ( strike.weapon ) {
    const usable = (entry) => !entry.system.broken && !((entry.system.uses?.max > 0) && !(entry.system.uses.value > 0));
    const may = new Set((actor.system.wieldable ?? []).map((entry) => entry.id).filter(Boolean));
    const found = actor.items.find((entry) => {
      return (entry.type === "weapon") && usable(entry) && (!may.size || may.has(entry.id))
        && weaponIs({ name: entry.name, category: entry.system.category }, strike.weapon);
    });
    if ( !found ) return null;
    arm = {
      weapon: {
        id: found.id, name: found.name, category: found.system.category, might: found.system.might, range: found.system.range,
        effect: found.system.effect, damageStat: found.system.damageStat, wexp: found.system.wexp,
        uses: { value: found.system.uses.value, max: found.system.uses.max }
      },
      bare: { hit: found.system.hit, crit: found.system.crit, weight: found.system.weight, rank: found.system.rank }
    };
  }
  else {
    const view = viewOf(token);
    const within = Number.isInteger(act.target?.within) ? act.target.within : 1;
    arm = strikeWeapon(strike, { name: item.name, number: (value) => readNumber(value, view, null), reach: { min: Math.min(act.target?.from ?? 1, within), max: within } });
  }
  return {
    skill: item.name, item: item.id, share: (strike.share ?? 100) / 100, free: !strike.weapon, plain: !!strike.plain,
    effects: strike.effects ?? [], arm, image: strike.weapon ? (actor.items.get(arm.weapon.id)?.img ?? "") : (item.img ?? "")
  };
}

/* -------------------------------------------- */
/*  Targets                                     */
/* -------------------------------------------- */

/**
 * Is the way between two units clear: does a straight line between them cross no tile that nothing passes,
 * and no wall of the scene?
 * @param {TokenDocument} token
 * @param {TokenDocument} other
 * @returns {boolean}
 */
function clearBetween(token, other) {
  const scene = token.parent;
  const here = tileOf(token);
  const there = tileOf(other);
  if ( !clearLine(here, there, (tile) => !!terrainType(tileGround(scene, tile).terrain).impassable) ) return false;
  return !wallBetween(scene, here, there);
}

/* -------------------------------------------- */

/**
 * Whether the weapon in a unit's hand attacks at a distance from where it stands, with what its skills make of
 * the weapon's reach: for a skill that is used on a unit in weapon range.
 * @param {TokenDocument} token
 * @returns {(distance: number) => boolean}
 */
function armedAt(token) {
  const actor = token.actor;
  const weapon = actor.system.equippedWeapon;
  if ( !weapon || weapon.system.broken || ((weapon.system.uses?.max > 0) && !(weapon.system.uses.value > 0)) ) return () => false;
  const changes = rangesWith(actor, turnMoveOf(token));
  return (distance) => reaches(weapon.system, distance, actor.system.statValues, changes);
}

/* -------------------------------------------- */

/**
 * The uses a skill takes off the weapon and the Shield of the unit it is used on, as the unit that uses it
 * stands: its numbers are read with the weapon in its hand.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {object} act                The skill's `act` part
 * @returns {{weapon: number, shield: number}}
 */
export function actWearsOf(token, act) {
  const view = viewOf(token);
  return actWears(act?.wears ?? null, (value) => readNumber(value, view, null));
}

/* -------------------------------------------- */

/**
 * What a unit can do with an ally next to it, as the two stand (see `maneuvers`).
 * @param {TokenDocument} token
 * @param {TokenDocument} ally
 * @returns {import("../rules/actions.mjs").Maneuver}
 */
export function maneuversOf(token, ally) {
  const units = unitsOn(token.parent);
  return maneuvers(tileOf(token), tileOf(ally), {
    unit: forcedField(token, { units }),
    ally: moves(token, ally) ? forcedField(ally, { units }) : null
  });
}

/* -------------------------------------------- */

/**
 * May a skill be used on a unit, as the two stand: one of the side it is for, within its reach, that the skill
 * can do its part to?
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {object} act                The skill's `act` part
 * @param {TokenDocument} other       The unit it would be used on
 * @param {Item|null} [item]          The skill, for one that has its unit make an attack
 * @returns {boolean}
 */
export function actTakes(token, act, other, item = null) {
  if ( !onMap(token) || !onMap(other) || (token.parent !== other.parent) ) return false;
  const here = tileOf(token);
  const there = tileOf(other);
  const self = token === other;
  const relation = relationTo(token, other);

  // A unit that none of its enemies can make their target for now is one no skill of theirs is used on
  if ( !self && cannotTarget(token.actor, token, other.actor, other) ) return false;

  // A skill for the creatures its unit made is for those alone, and where it may be used in one of two ways
  // one of them must be open: by how near the creature stands, and whether it has acted this turn
  if ( act.target?.made ) {
    const note = creatureOf(other.actor);
    if ( !note || (note.maker !== token.actor.uuid) || !act.target.made.includes(note.skill) ) return false;
  }
  if ( act.instead || act.target?.unacted ) {
    if ( self || !actReaches({ target: { ...act.target, from: 1, within: MAP_REACH } }, relation, tilesApart(here, there)) ) return false;
    if ( !actWaysFor(token, act, other).length ) return false;
  }
  else if ( !actReaches(act, relation, self ? 0 : tilesApart(here, there), (act.target?.within === WEAPON_REACH) ? armedAt(token) : null) ) return false;
  if ( !self && act.target?.clear && !clearBetween(token, other) ) return false;

  // A unit imitates another unit than itself, and only one its skill can imitate
  if ( act.imitates && (self || imitationBar(token, act.imitates, other)) ) return false;

  // Healing is for a unit that has lost HP, and a guarantee for one with a skill that rolls for its effect
  if ( act.heal && !act.grant && !(other.actor.system.hp.value < other.actor.system.hp.max) ) return false;
  if ( act.assures && !activationSkills(other.actor.system.skills?.entries).length ) return false;

  // An attack of its own is made on an enemy the unit may attack at all, with what the skill has it made with
  if ( act.strike ) {
    const strike = item ? strikeOf(token, item) : null;
    if ( !strike ) return false;
    const matchup = planAttack(token.actor, token, other.object ?? { actor: other.actor, document: other }, { extra: strike });
    return !matchup.warning && !matchup.makePlan(matchup.distance).initiator.blocked;
  }
  if ( act.move === "swap" ) {
    return moves(token, other) && swaps(here, there, forcedField(token, { but: [other] }), forcedField(other, { but: [token] }));
  }
  if ( act.move === "maneuver" ) {
    const open = maneuversOf(token, other);
    return open.swap || (open.pivot.length > 0) || (open.place.length > 0);
  }

  // A fight of several rounds is started with an enemy that can counter-attack from where the two stand
  if ( act.fight ) {
    const matchup = planAttack(token.actor, token, other.object ?? { actor: other.actor, document: other });
    if ( matchup.warning ) return false;
    const plan = matchup.makePlan(matchup.distance);
    return !plan.initiator.blocked && !plan.defender.blocked;
  }

  // A unit that no enemy holds in place is not taken hold of, nor one that is held already
  if ( act.grip ) {
    if ( other.actor.system.skills?.rules?.includes(UNFORCED) && (relation !== "friend") ) return false;
    return !heldBy(other);
  }
  return true;
}

/* -------------------------------------------- */

/**
 * The ways a skill may be used on a unit, as the two stand, for a skill that has two.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {object} act
 * @param {TokenDocument} other       The unit it would be used on
 * @returns {("main"|"instead")[]}
 */
export function actWaysFor(token, act, other) {
  const here = tileOf(token);
  const there = tileOf(other);
  if ( !here || !there ) return [];
  return actWays(act, { distance: tilesApart(here, there), acted: hasActed(other.actor) || !!other.actor.system.waiting });
}

/* -------------------------------------------- */

/**
 * The units a skill may be used on from where its unit stands.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @returns {TokenDocument[]}
 */
export function actTargetsOf(token, item) {
  const act = actFor(token, item);
  if ( !act || actArea(act) || !onMap(token) ) return [];
  return unitsOn(token.parent).map((unit) => unit.token).filter((other) => actTakes(token, act, other, item));
}

/* -------------------------------------------- */

/**
 * The units a skill is used on when it is used on all in its reach at once.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {TokenDocument[]}
 */
export function actAllOf(token, item) {
  const act = actFor(token, item);
  if ( !act?.all || !onMap(token) ) return [];
  const all = actForAll(act);
  return unitsOn(token.parent).map((unit) => unit.token).filter((other) => actTakes(token, all, other, item));
}

/* -------------------------------------------- */

/**
 * Why a skill cannot be used on a unit picked on the map right now, if it cannot.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {string|null}     A localization key; null when it can be
 */
export function actBlocked(token, item) {
  const able = canUse(item.system.usage, item.system.state);
  if ( !able.ok ) return `FEO.Usage.blocked.${able.reason}`;
  const act = actFor(token, item);

  // A skill whose stat is picked as it is learnt does nothing until it has been
  if ( act?.grant?.choose && !actGrant(act.grant, { choice: item.system.choice }) ) return "FEO.Act.noPick";
  if ( act?.strike && !strikeOf(token, item) ) return "FEO.Act.noWeapon";
  if ( actArea(act) ) return null;
  return actTargetsOf(token, item).length ? null : "FEO.Act.noTarget";
}

/* -------------------------------------------- */
/*  Using                                       */
/* -------------------------------------------- */

/**
 * @typedef ActOutcome
 * What a skill did to the unit it was used on, for the card of its use.
 * @property {{label: string, value: string, cls?: string}[]} rows
 * @property {Roll[]} rolls
 * @property {{label: string, cls: string}|null} outcome      A headline result, where a check was made
 * @property {boolean} holds                                  Did the unit take hold of its target?
 */

/** What skills did on the map, waiting for the sheet to use them: by the skill's Item. */
const outcomes = new WeakMap();

/**
 * What a skill just did on the map, for the unit sheet that now uses it. It is told once.
 * @param {Item} item
 * @returns {ActOutcome|null}
 */
export function takeOutcome(item) {
  const outcome = outcomes.get(item) ?? null;
  outcomes.delete(item);
  return outcome;
}

/* -------------------------------------------- */

/**
 * Keep what a skill just did on the map for the unit sheet that uses it next.
 * @param {Item} item
 * @param {ActOutcome} outcome
 */
export function keepOutcome(item, outcome) {
  outcomes.set(item, outcome);
}

/* -------------------------------------------- */

/**
 * A skill does its part to the unit it was used on: the two are moved as it says, or its check is rolled and
 * the unit takes hold. What came of it is kept for the unit sheet, which uses the skill next.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @param {TokenDocument} target      The unit it is used on
 * @param {Tile|null} [tile]          The tile that was picked, for a skill that asks for one
 * @param {object} [options]
 * @param {"one"|"all"} [options.mode]    Is it used on every unit in its reach at once, where it may be?
 * @returns {Promise<boolean>}        Whether the skill did its part; false leaves it unused
 */
export async function useAct(token, item, target, tile = null, { mode = "one" } = {}) {
  const written = actFor(token, item);
  if ( !written ) return false;

  // Used on all in reach at once, it does to each what it says of that
  if ( mode === "all" ) {
    const units = actAllOf(token, item);
    if ( !units.length ) return false;
    const all = actForAll(written);
    const outcome = { rows: [], rolls: [], outcome: null, holds: false };
    cutIn([{ actor: token.actor, skill: item.name }]);
    for ( const unit of units ) await actOn(token, item, all, unit, outcome);
    outcomes.set(item, outcome);
    return true;
  }
  let act = written;
  if ( !target || !actTakes(token, act, target, item) ) return false;

  // A skill with two ways: where both are open, which is picked from a short list above the dock
  if ( written.instead ) {
    const ways = actWaysFor(token, written, target);
    let way = ways[0] ?? null;
    if ( ways.length > 1 ) {
      const asked = game.feo.hud?.choose?.({
        token, skill: item.name,
        options: [{ id: "main", label: written.label }, { id: "instead", label: written.instead.label }]
      }) ?? null;
      way = asked ? await asked : null;
    }
    if ( !way ) return false;
    if ( way === "instead" ) act = actInstead(written);
  }

  // A fight of several rounds, and an attack of the skill's own, are fought from the forecast on the map
  if ( act.fight || act.strike ) return false;
  const here = tileOf(token);
  const there = tileOf(target);
  const i18n = game.i18n;
  const outcome = { rows: [], rolls: [], outcome: null, holds: false };

  if ( act.move === "swap" ) {
    if ( !(await moveUnits([{ token, tile: there }, { token: target, tile: here }])) ) return false;
  }
  else if ( act.move === "maneuver" ) {
    const kind = tile ? maneuverAt(maneuversOf(token, target), there, tile) : null;
    const list = (kind === "swap") ? [{ token, tile: there }, { token: target, tile: here }]
      : (kind === "pivot") ? [{ token, tile }]
      : (kind === "place") ? [{ token: target, tile }]
      : null;
    if ( !list || !(await moveUnits(list)) ) return false;
  }

  // The skill flashes over the unit that uses it, before what it does is shown
  cutIn([{ actor: token.actor, skill: item.name }]);

  // An opposed check: the unit's own against the best of its target's
  let success = true;
  if ( act.check ) {
    const mine = token.actor.system.checks?.[act.check.by]?.bonus ?? 0;
    const bonuses = Object.fromEntries(act.check.against.map((key) => [key, target.actor.system.checks?.[key]?.bonus ?? 0]));
    const answer = bestCheck(bonuses, act.check.against);
    const { roll, results } = await rollD100(2);
    const check = opposedCheck({ roll: results[0], bonus: mine }, { roll: results[1], bonus: answer.bonus });
    success = check.success;
    outcome.rolls.push(roll);
    outcome.outcome = { label: i18n.localize(success ? "FEO.Act.success" : "FEO.Act.failure"), cls: success ? "good" : "bad" };
    outcome.rows.push(
      { label: i18n.localize(`FEO.Ability.${act.check.by}`), value: `${results[0]} + ${mine} = ${check.total}` },
      {
        label: `${target.name || target.actor.name}: ${i18n.localize(`FEO.Ability.${answer.key}`)}`,
        value: `${results[1]} + ${answer.bonus} = ${check.against}`
      }
    );
  }
  if ( act.grip && success ) {
    await token.actor.setFlag(FEO.id, GRIP_FLAG, { token: target.id, skill: item.name, item: item.id, home: null });
    outcome.holds = true;
    outcome.rows.push({ label: target.name || target.actor.name, value: i18n.localize("FEO.Grip.held") });
  }

  // Uses it takes off what the target fights with: its Shield, its weapon. What is brought to 0 uses breaks,
  // as it does in a fight; a target this user does not own is seen to by a Game Master
  if ( act.wears && success ) {
    const wears = actWearsOf(token, act);
    const theirs = target.actor.system;
    const change = { uuid: target.actor.uuid };
    const told = [];
    const shield = theirs.equippedShield;
    const guard = shield ? wornDown(shield.system.uses, wears.shield) : null;
    if ( guard?.lost ) {
      change.shield = { id: shield.id, uses: guard.uses };
      outcome.rows.push({ label: shield.name, value: i18n.format("FEO.Exchange.uses", { from: shield.system.uses.value, to: guard.uses }), cls: guard.broke ? "bad" : "" });
      told.push({ text: i18n.format(guard.broke ? "FEO.Exchange.broke" : "FEO.Act.worn", { weapon: shield.name, item: shield.name, amount: guard.lost }), tone: "skill" });
    }
    const weapon = theirs.equippedWeapon;
    const blade = weapon ? wornDown(weapon.system.uses, wears.weapon) : null;
    if ( blade?.lost ) {
      change.weapon = { id: weapon.id, uses: blade.uses };
      outcome.rows.push({ label: weapon.name, value: i18n.format("FEO.Exchange.uses", { from: weapon.system.uses.value, to: blade.uses }), cls: blade.broke ? "bad" : "" });
      told.push({ text: i18n.format(blade.broke ? "FEO.Exchange.broke" : "FEO.Act.worn", { weapon: weapon.name, item: weapon.name, amount: blade.lost }), tone: "skill" });
    }
    if ( (Object.keys(change).length > 1) && (await applyChanges([change])).length ) return false;
    if ( told.length ) pop(target.actor, told);
  }

  // It takes on the attributes of the unit it is used on. Its skill then stays on, as one its unit holds
  // another with does: the cooldown starts once the unit is itself again
  if ( act.imitates && success ) {
    const rows = await imitateUnit(token, item, act.imitates, target);
    if ( !rows ) return false;
    outcome.rows.push(...rows);
    outcome.holds = true;
  }

  // What it restores, deals, leaves and makes sure of
  if ( success ) await actOn(token, item, act, target, outcome);
  outcomes.set(item, outcome);
  return true;
}

/* -------------------------------------------- */

/**
 * A die of a hundred faces.
 * @returns {number}
 */
function d100() {
  return Math.min(Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * 100), 99) + 1;
}

/* -------------------------------------------- */

/**
 * What a skill does to one unit it is used on beyond moving it: the HP it restores or takes, the change it
 * leaves, the skill it makes sure of. Each goes the one way healing, damage and lasting changes come to a
 * unit, so that the unit shows its own number, and what came of it is added to the card of the skill.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @param {object} act                What it does, as it is used now
 * @param {TokenDocument} target      The unit it is used on
 * @param {ActOutcome} outcome
 * @returns {Promise<void>}
 */
export async function actOn(token, item, act, target, outcome) {
  const i18n = game.i18n;
  const name = target.name || target.actor.name;
  const mine = token.name || token.actor.name;
  const read = (value, theirs) => readNumber(value, viewOf(theirs ? target : token), null);
  const told = [];

  // HP it restores
  const heal = actAmount(act.heal, read);
  if ( heal > 0 ) {
    const healed = await healUnit(target.actor, heal, { by: token.actor, byToken: token, token: target });
    if ( healed?.healed > 0 ) told.push(i18n.format("FEO.Act.healed", { amount: healed.healed }));
  }

  // Damage it deals, as a skill's: 1 at least, and the unit's kill where it defeats
  if ( act.damage !== undefined ) {
    const dealt = await damageUnit(target.actor, Math.max(actAmount(act.damage, read), 1), { kind: "skill", by: token.actor, byToken: token, token: target });
    if ( dealt ) told.push(i18n.format("FEO.Act.harmed", { amount: dealt.dealt ?? 0 }));
  }

  // Conditions it gives the unit: what the unit wards off is told as that
  const standing = () => !target.actor.system.defeat?.out && (target.actor.system.hp?.value > 0);
  for ( const condition of standing() ? actInflicts(act.inflicts) : [] ) {
    const given = await afflictUnit(target.actor, condition.id, { by: token.actor, byToken: token, token: target, turns: condition.turns });
    if ( !given ) continue;
    const label = i18n.localize(`FEO.Condition.${condition.id}`);
    told.push((given.success === false) ? i18n.format("FEO.Area.warded", { condition: label }) : label);
  }

  // A mark it leaves on the unit, for what asks whether the unit carries one
  if ( act.mark && standing() ) {
    const mark = buildChange({ name: act.mark.name, effects: [], mark: true, ends: act.mark.ends ?? "map", turns: act.mark.turns }, {
      skill: item.name, from: mine, giver: token.actor.uuid, own: target === token
    });
    await grantUnit(target.actor, [mark], { by: token.actor });
  }

  // A change it leaves on the unit
  const grant = actGrant(act.grant, { choice: item.system.choice });
  if ( grant && !target.actor.system.defeat?.out ) {
    const changes = await changesFor(token, item, act, grant, target);

    // One that a single unit carries at a time is taken off whoever carried it before
    if ( grant.lone ) await dropElsewhere(token, changes.map((change) => change.name), target);
    if ( changes.length ) {
      const given = await grantUnit(target.actor, changes, { by: token.actor });
      if ( grant.also === "self" ) await grantUnit(token.actor, changes.map((change) => ({ ...change, from: "", clock: "", by: "" })));
      if ( given?.length ) {
        // The skill has flashed over its user as it was used: a user who saw that is not told again over the
        // unit it was used on
        pop(target.actor, [{ text: item.name, tone: "skill", seen: true }]);
        const { describeChange } = await import("./timed-context.mjs");
        for ( const change of given ) {
          const { what, lasts } = describeChange(change, i18n);
          told.push([(change.name !== item.name) ? change.name : "", what, lasts].filter(Boolean).join(", "));
        }
      }
      else if ( given && !given.length ) told.push(i18n.localize("FEO.Act.refused"));
    }

    // And what comes of its unit standing in sight of the unit it comes from, looked at once now
    if ( act.watch && changes.some((change) => change.watch) ) await keepWatch(target);
  }

  // A skill of the unit that a die picks is sure to activate in its next fight
  if ( act.assures ) {
    const picked = pickBy(activationSkills(target.actor.system.skills?.entries), d100());
    if ( picked ) {
      const change = buildChange({ name: item.name, effects: [{ assures: [picked] }], ends: "map", once: "fight" }, {
        skill: item.name, from: mine, giver: token.actor.uuid, own: target === token
      });
      await grantUnit(target.actor, [change], { by: token.actor });
      pop(target.actor, [{ text: `${item.name}: ${picked}`, tone: "skill" }]);
      told.push(i18n.format("FEO.Act.assured", { skill: picked }));
    }
  }
  if ( told.length ) outcome.rows.push({ label: name, value: told.join(" · ") });
}

/* -------------------------------------------- */

/**
 * The changes a skill leaves on a unit it is used on, worked out: the stats that are picked for it, by whoever
 * acts for the unit that uses the skill or for the unit it is used on; and the effects it lends for the kinds
 * of weapon a die picks.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item
 * @param {object} act
 * @param {object} grant              The change, with the stats it offers made plain
 * @param {TokenDocument} target
 * @returns {Promise<import("../rules/timed.mjs").TimedChange[]>}
 */
async function changesFor(token, item, act, grant, target) {
  const context = {
    skill: item.name, from: token.name || token.actor.name, giver: token.actor.uuid, own: target === token,
    giverInTurn: true, carrierInTurn: target === token
  };
  const { choose, lends, lone, also, ...plain } = grant;
  // A change that keeps track of its unit standing in sight of the unit it comes from says so
  const build = (name, effects) => buildChange({ ...plain, ...(act.watch ? { watch: true } : {}), name, effects }, context);

  // Stats that are picked as the skill is used: a pick that leaves no choice is made without asking
  if ( choose ) {
    let picked = [];
    if ( new Set(choose.stats).size > pickCount(choose) ) {
      try {
        const { pickStatsFor } = await import("./answers.mjs");
        const asked = (act.asks === "target") ? target : token;
        picked = await pickStatsFor(asked, asked.actor, { skill: item.name, choose });
      } catch(err) {
        console.error(err);
      }
    }
    const effects = chosenEffects(choose, picked, [target.actor.system.statValues ?? {}]);
    return effects.length ? [build(grant.name ?? item.name, effects)] : [];
  }

  // Effects for a kind of weapon that a die picks, or the unit's owner where its own rank lets them
  if ( lends ) {
    const changes = [];
    for ( const lend of lends ) {
      const kind = await lendKind(token, item, lend, target);
      if ( !kind ) continue;
      const label = game.i18n.localize(kind.label);
      const title = game.i18n.format((lend.pick === "foes") ? "FEO.Act.lend.foes" : "FEO.Act.lend.wields", { skill: item.name, weapon: label });
      changes.push(build(title, lentEffects([lend], { [lend.pick]: kind.categories })));
    }
    return changes;
  }
  return [build(grant.name ?? item.name, grant.effects ?? [])];
}

/* -------------------------------------------- */

/**
 * The kind of weapon a skill lends its effects for: one a die picks among the proficiencies its target has a
 * rank in, or among the kinds of weapon the target's enemies on the map hold; or one of the proficiencies the
 * unit that uses the skill has a high enough rank in, where whoever acts for it picks that instead.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {{pick: "wields"|"foes", manual?: string}} lend
 * @param {TokenDocument} target
 * @returns {Promise<{key: string, label: string, categories: string[]}|null>}
 */
async function lendKind(token, item, lend, target) {
  const order = Object.keys(FEO.ranks);
  const ranked = (actor, least) => Object.entries(actor.system.proficiencies ?? {})
    .filter(([, held]) => order.indexOf(held.rank) >= order.indexOf(least)).map(([key]) => key);
  const ofProficiency = (key) => ({
    key,
    label: FEO.proficiencies[key] ?? key,
    categories: Object.entries(FEO.weaponCategories).filter(([, category]) => category.proficiency === key).map(([id]) => id)
  });
  const ofCategory = (key) => ({ key, label: FEO.weaponCategories[key]?.label ?? key, categories: [key] });

  // A tome stands for its whole Magic type, as it does for the skills whose effects are lent, and each type
  // is in the list once
  const typed = (kinds) => kinds.filter((kind) => kind.categories.length).map(weaponTypeOf)
    .filter((kind, index, all) => all.findIndex((other) => other.key === kind.key) === index);
  let pool = [];
  if ( lend.pick === "wields" ) pool = ranked(target.actor, "E").map(ofProficiency);
  else {
    const held = new Set();
    for ( const unit of unitsOn(target.parent) ) {
      if ( relationTo(target, unit.token) !== "foe" ) continue;
      const category = unit.token.actor.system.equippedWeapon?.system.category;
      if ( category ) held.add(category);
    }
    pool = [...held].map(ofCategory);
  }

  // Whoever acts for a unit with the rank for it may pick one of its own proficiencies in place of the die
  const own = lend.manual ? typed(ranked(token.actor, lend.manual).map(ofProficiency)) : [];
  if ( own.length && token.actor.isOwner ) {
    try {
      const { answersAlone } = await import("./answers.mjs");
      if ( !answersAlone(token.actor) ) {
        const i18n = game.i18n;
        const picked = await game.feo.hud?.choose?.({
          token,
          skill: item.name,
          hint: i18n.localize((lend.pick === "foes") ? "FEO.Act.lend.askFoes" : "FEO.Act.lend.askWields"),
          options: [{ id: "", label: i18n.localize("FEO.Act.lend.die") }, ...own.map((kind) => ({ id: kind.key, label: i18n.localize(kind.label) }))]
        });
        const chosen = own.find((kind) => kind.key === picked);
        if ( chosen ) return chosen;
      }
    } catch(err) {
      console.error(err);
    }
  }
  return pickBy(typed(pool), d100());
}

/* -------------------------------------------- */

/**
 * Take a change that one unit carries at a time off every unit of the scene that carries it from this unit,
 * but the one it is now given to.
 * @param {TokenDocument} token       The unit whose skill left it
 * @param {string[]} names            What the changes are called
 * @param {TokenDocument} keep        The unit that now carries them
 * @returns {Promise<void>}
 */
async function dropElsewhere(token, names, keep) {
  const from = token.name || token.actor.name;
  for ( const other of token.parent?.tokens ?? [] ) {
    if ( (other === keep) || (other === token) || (other.actor?.type !== "unit") ) continue;
    const carried = (other.actor.system.timed ?? []).filter((change) => ((change.from ?? "") === from) && names.some((name) => change.name.startsWith(name)));
    if ( !carried.length ) continue;
    const drops = carried.map((change) => buildChange({ drop: "all", name: change.name }, { skill: change.name, from }));
    await grantUnit(other.actor, drops);
  }
}

/* -------------------------------------------- */
/*  Tolls and Watches                           */
/* -------------------------------------------- */

/**
 * A unit has moved of its own accord, or has made an attack in a fight: the changes it carries that take HP
 * off it for that do, as damage of the skill of the unit each comes from.
 * @param {Actor|null} actor
 * @param {"move"|"attack"} when
 * @param {TokenDocument|null} [token]
 * @returns {Promise<number>}         The HP it lost
 */
export async function takeToll(actor, when, token = null) {
  if ( (actor?.type !== "unit") || actor.system.defeat?.state || !(actor.system.hp.value > 0) ) return 0;
  let lost = 0;
  for ( const toll of tollsOf(actor.system.timed, when) ) {
    if ( actor.system.defeat?.state || !(actor.system.hp.value > 0) ) break;
    let by = null;
    try {
      by = toll.by ? await foundry.utils.fromUuid(toll.by) : null;
    } catch(err) {
      by = null;
    }
    const amount = tollOf(toll.toll, d100);
    if ( !(amount > 0) ) continue;
    pop(actor, [{ text: toll.name, tone: "skill" }]);
    const dealt = await damageUnit(actor, amount, { kind: "skill", by: (by?.type === "unit") ? by : null, token });
    lost += dealt?.dealt ?? 0;
  }
  return lost;
}

/* -------------------------------------------- */

/**
 * Does a unit carry a change that takes HP off it as it moves?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function movesAtToll(actor) {
  return tollsOf(actor?.system?.timed, "move").length > 0;
}

/* -------------------------------------------- */

/**
 * Look at whether a unit stands within the Line of Sight of each unit whose change it carries that keeps track
 * of that (see `watch` in `rules/actions.mjs`): the first time it does it is granted what the skill says of
 * that, and as one of its turns starts what the skill says of staying there grows by one, or is emptied by a
 * turn that starts out of sight. Line of Sight is a stat, so many spaces, and what blocks sight between the two
 * blocks it (see `rules/sight.mjs`).
 * @param {TokenDocument|null} token      The unit that is watched
 * @param {object} [options]
 * @param {boolean} [options.turnStart]   Is one of its turns starting?
 * @returns {Promise<void>}
 */
export async function keepWatch(token, { turnStart = false } = {}) {
  const actor = token?.actor;
  if ( !actor || !token.parent || !tileOf(token) ) return;
  for ( const change of (actor.system.timed ?? []).filter((entry) => entry.watch && entry.by) ) {
    try {
      const watcher = token.parent.tokens.find((other) => other.actor?.uuid === change.by);
      const item = watcher?.actor?.items.find((entry) => (entry.type === "skill") && (entry.name === change.name));
      const watch = item ? actFor(watcher, item)?.watch : null;
      if ( !watch ) continue;
      const from = watcher.name || watcher.actor.name;
      const context = { skill: item.name, from, giver: watcher.actor.uuid };
      const sees = onMap(watcher) && inSight(watcher, token);
      const seen = `${item.name} · seen`;
      const stays = game.i18n.format("FEO.Act.inSight", { skill: item.name });
      const changes = [];
      if ( sees && watch.enters && !(actor.system.timed ?? []).some((entry) => entry.mark && (entry.name === seen) && (entry.from === from)) ) {
        changes.push(buildChange({ ...watch.enters, name: game.i18n.format("FEO.Act.sighted", { skill: item.name }) }, context));
        changes.push(buildChange({ name: seen, effects: [], mark: true, ends: "map" }, context));
      }
      if ( turnStart && watch.stays ) {
        changes.push(sees
          ? buildChange({ ...watch.stays, name: stays, ends: "map" }, context)
          : buildChange({ drop: "all", name: stays }, context));
      }
      if ( !changes.length ) continue;
      await grantUnit(actor, changes);
      if ( sees ) pop(actor, [{ text: item.name, tone: "skill" }]);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */
/*  Holding a Unit                              */
/* -------------------------------------------- */

/**
 * A hold ends: the holder no longer has hold of anyone, and the cooldown of the skill it held with starts now.
 * @param {Actor} actor       The unit that held
 * @returns {Promise<boolean>}    Whether there was a hold to end
 */
async function letGo(actor) {
  const grip = gripOf(actor);
  if ( !grip ) return false;
  await actor.unsetFlag(FEO.id, GRIP_FLAG);
  const item = actor.items.get(grip.item);
  const usage = item?.system.usage;
  if ( usage?.kind ) {
    const cooldown = (usage.cooldown > 0) ? cooldownWith(usage.cooldown, cooldownsFor(actor, item)) + FEO.skillUse.cooldownExtra : 0;
    await item.update({ "system.state": { ...item.system.state, active: false, lasting: 0, cooldown } });
  }
  return true;
}

/* -------------------------------------------- */

/**
 * End the hold a unit has on another, whoever asks: its owner at once, anyone else through a Game Master.
 * @param {TokenDocument|null} holder
 * @returns {Promise<boolean>}    Whether the hold was ended
 */
export async function endGrip(holder) {
  const actor = holder?.actor;
  if ( !gripOf(actor) ) return false;
  try {
    if ( actor.isOwner ) return await letGo(actor);
    const gm = game.users.activeGM;
    if ( !gm || !holder.parent ) return false;
    return !!(await gm.query(GRIP_QUERY, { scene: holder.parent.id, token: holder.id }, { timeout: 10000 }));
  } catch(err) {
    console.error(err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Answer a player's request to end a hold: that of a unit whose skill held theirs, which broke free. Runs for
 * a Game Master.
 * @param {{scene: string, token: string}} data
 * @returns {Promise<boolean>}
 */
export async function endGripQuery({ scene: sceneId, token: tokenId } = {}) {
  const token = game.scenes?.get(sceneId)?.tokens.get(tokenId);
  if ( !game.user.isGM || (token?.actor?.type !== "unit") ) return false;
  return letGo(token.actor);
}

/* -------------------------------------------- */

/**
 * End every hold on a scene that no longer stands: one whose two units are no longer next to each other, or
 * of which one has left the fight. Holds this user may not end are left for whoever may.
 * @param {Scene|null} scene
 * @returns {Promise<number>}     How many were ended
 */
export async function settleGrips(scene) {
  let ended = 0;
  for ( const token of scene?.tokens ?? [] ) {
    try {
      if ( (token.actor?.type !== "unit") || !token.actor.isOwner || !gripOf(token.actor) || holding(token) ) continue;
      if ( await letGo(token.actor) ) ended++;
    } catch(err) {
      console.error(err);
    }
  }
  return ended;
}

/* -------------------------------------------- */

/**
 * A unit that is held tries the check again, as each of its turns starts by itself or with its Action: its
 * holder's check against the best of its own. If its total is the higher one, it is free. What was rolled is
 * posted as a card of its own.
 * @param {TokenDocument|null} token      The unit that is held
 * @param {object} [options]
 * @param {boolean} [options.action]      Is this its Action, which it has then taken whatever comes of it?
 * @returns {Promise<boolean|null>}       Whether it broke free; null for a unit that nobody holds
 */
export async function retryGrip(token, { action = false } = {}) {
  const holder = heldBy(token);
  const actor = token?.actor;
  if ( !holder || !actor ) return null;
  const grip = gripOf(holder.actor);
  const act = actOf(holder.actor.items.get(grip.item)?.system);
  const keys = act?.check ?? { by: "athletics", against: ["reflex", "athletics"] };
  const i18n = game.i18n;
  const theirs = holder.actor.system.checks?.[keys.by]?.bonus ?? 0;
  const answer = bestCheck(Object.fromEntries(keys.against.map((key) => [key, actor.system.checks?.[key]?.bonus ?? 0])), keys.against);
  const { roll, results } = await rollD100(2);
  const check = opposedCheck({ roll: results[0], bonus: theirs }, { roll: results[1], bonus: answer.bonus });
  const free = !check.success;
  await postCard(actor, {
    title: i18n.format("FEO.Grip.retry", { skill: grip.skill || i18n.localize("FEO.Grip.label") }),
    subtitle: i18n.localize(action ? "FEO.Grip.retryAction" : "FEO.Grip.retryTurn"),
    outcome: { label: i18n.localize(free ? "FEO.Grip.free" : "FEO.Grip.held"), cls: free ? "good" : "bad" },
    rows: [
      { label: i18n.localize(`FEO.Ability.${answer.key}`), value: `${results[1]} + ${answer.bonus} = ${check.against}` },
      {
        label: `${holder.name || holder.actor.name}: ${i18n.localize(`FEO.Ability.${keys.by}`)}`,
        value: `${results[0]} + ${theirs} = ${check.total}`
      }
    ]
  }, { rolls: [roll] });
  if ( free ) {
    await endGrip(holder);
    pop(actor, [{ text: i18n.localize("FEO.Grip.free"), tone: "skill" }]);
  }
  if ( action ) await takeAction(actor, token, { action: { kind: "other" } });
  return free;
}

/* -------------------------------------------- */

/**
 * A unit that has hold of another has moved, or its move was taken back: the unit it holds is dragged along.
 * It comes to the tile its holder took its last step from, or failing that to the nearest tile next to its
 * holder that it can stand on; with no room there the hold is broken. When the move is taken back it is set
 * back where it stood as the move began. A unit that nothing moves but itself is not dragged: once its holder
 * has left its side, the hold is broken.
 * @param {TokenDocument|null} holder
 * @param {object} [options]
 * @param {Tile|null} [options.from]      The tile the holder took its last step from
 * @param {boolean} [options.fresh]       Is this the first move the holder makes since its last move stood?
 * @param {boolean} [options.back]        Was the holder's move taken back?
 * @returns {Promise<boolean>}            Whether the hold still stands
 */
export async function followGrip(holder, { from = null, fresh = false, back = false } = {}) {
  const grip = gripOf(holder?.actor);
  const held = grip ? holder.parent?.tokens.get(grip.token) : null;
  if ( !grip ) return false;
  if ( !held?.actor || held.actor.system.defeat?.out || !moves(holder, held) ) {
    if ( !holding(holder) ) await endGrip(holder);
    return !!holding(holder);
  }
  const here = tileOf(holder);
  const there = tileOf(held);
  let tile = null;
  if ( back ) tile = grip.home ?? there;
  else {
    const field = forcedField(held);
    tile = dragTo({ holder: here, held: there, from }, field)?.tile ?? null;
  }
  if ( !tile ) {
    await endGrip(holder);
    return false;
  }

  // Where the unit held stood as this move began, to set it back there should the move be taken back
  if ( holder.actor.isOwner ) {
    const home = back ? null : (fresh || !grip.home) ? there : grip.home;
    if ( JSON.stringify(home) !== JSON.stringify(grip.home) ) await holder.actor.setFlag(FEO.id, GRIP_FLAG, { ...grip, home });
  }
  if ( (tile.i !== there.i) || (tile.j !== there.j) ) await moveUnits([{ token: held, tile }]);
  if ( !holding(holder) ) {
    await endGrip(holder);
    return false;
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Does a skill have the unit that uses it pick a tile once its target is picked?
 * @param {Item|null} item
 * @returns {boolean}
 */
export function actAsksTile(item) {
  return actPicksTile(actOf(item?.system));
}

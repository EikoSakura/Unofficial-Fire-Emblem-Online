import { fightsWithStaff } from "../rules/staves.mjs";
import { FEO } from "../config.mjs";
import { gridDistance, parseRange, planExchange, resolveExchange, rollBudget } from "../rules/combat.mjs";
import { conditionConfig } from "../rules/conditions.mjs";
import { relationOf, touchesCorner } from "../rules/positions.mjs";
import { spendSkill } from "../rules/skill-usage.mjs";
import { PROVOKED, armedWith, provokers } from "../rules/actions.mjs";
import { NEUTRAL, TURNED, UNTARGETABLE, weaponIs } from "../rules/skills.mjs";
import { isHumanWeapon } from "../rules/shifting.mjs";
import { isStaggered, staggerInUse } from "../rules/stagger.mjs";
import { shelteredFrom } from "../rules/stances.mjs";
import { AFFINITY_ID } from "../rules/optional.mjs";
import { extraGo } from "./acting.mjs";
import { cooldownsFor, saveAffinity } from "./affinity.mjs";
import { aftermathChanges, exchangeAftermath } from "./aftermath.mjs";
import { withReadiedArt } from "./arts.mjs";
import { captureOutright, settleCapture, withReadiedCapture } from "./capturing.mjs";
import { postCard, rollD100, rollFromResults } from "./chat.mjs";
import { setConditions } from "./conditions.mjs";
import { cutInFight } from "./cut-ins.mjs";
import { mostEarned } from "./earnings.mjs";
import { buildExchangeCard, buildForecast, combatantOf, exchangeChanges } from "./exchange-context.mjs";
import { betweenOn, reachOf } from "./battle-map.mjs";
import { bareFor, lentFor, offersOf, stillHeld, takeUp } from "./lending.mjs";
import { onlyWaits, turnMoveOf } from "./movement.mjs";
import { turnState } from "./phases.mjs";
import { isPlayerUnit } from "./players.mjs";
import { standingOf } from "./positions.mjs";
import { sightFrom } from "./sight.mjs";
import { creatureOf, heirOf as summonerOf } from "./creatures.mjs";
import { STAGGER_SETTLED } from "./stagger.mjs";
import { groundUnder } from "./terrain.mjs";
import { buildChange, splitHp } from "../rules/timed.mjs";
import { cleanWielded } from "../rules/triangle.mjs";
import { grantTimed, loseTemp, setTimed } from "./timed.mjs";
import { breakItem, breakShield } from "./weapons.mjs";

/**
 * @import {ExchangeChange} from "./exchange-context.mjs"
 */

/** The name of the query that asks a Game Master to save changes to units the asking user does not own. */
export const APPLY_QUERY = `${FEO.id}.applyExchange`;

const FORECAST_TEMPLATE = `systems/${FEO.id}/templates/dialog/forecast.hbs`;

/* -------------------------------------------- */
/*  Sides                                       */
/* -------------------------------------------- */

/**
 * Which side a unit fights for, which sets its colour on the sheet and in chat.
 * A side chosen on the sheet wins; otherwise player-owned units are the player side, and the rest follow the
 * disposition of their token.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    The unit's token, if it has one
 * @returns {"player"|"enemy"|"ally"|"other"}
 */
export function armyOf(actor, token) {
  // A unit that a change which lasts on it has stand apart from every side, as a Charm does
  if ( actor.system.skills?.rules?.includes(NEUTRAL) ) return "other";
  if ( actor.system.army ) return actor.system.army;
  if ( isPlayerUnit(actor) ) return "player";
  const disposition = (token ?? actor.prototypeToken)?.disposition;
  const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  if ( disposition === HOSTILE ) return "enemy";
  if ( disposition === FRIENDLY ) return "ally";
  return "other";
}

/* -------------------------------------------- */

/**
 * Is a unit one that another cannot make the target of an attack, a staff or a skill: one that no enemy can
 * target for now, as a skill of its own has it, asked by one of its enemies?
 * @param {Actor|null} actor              The unit that would target it
 * @param {TokenDocument|null} token
 * @param {Actor|null} target             The unit it would target
 * @param {TokenDocument|null} [targetToken]
 * @returns {boolean}
 */
export function cannotTarget(actor, token, target, targetToken = null) {
  return !!targetBar(actor, token, target, targetToken);
}

/* -------------------------------------------- */

/**
 * Why a unit cannot make another the target of an attack, a staff or a skill, if it cannot: the other is one
 * no enemy can target for now, the unit was turned on its own side, or it was forced to target a unit that
 * still stands on the map and this is another of its enemies.
 * @param {Actor|null} actor              The unit that would target it
 * @param {TokenDocument|null} token
 * @param {Actor|null} target             The unit it would target
 * @param {TokenDocument|null} [targetToken]
 * @param {object} [options]
 * @param {boolean} [options.attack]      Is it an attack the unit would make? An enemy that shelters the
 *                                        allies around it only keeps them from being attacked
 * @param {{i: number, j: number}|null} [options.from]    The tile it would attack from, where that is not
 *                                        the one it stands on
 * @returns {{key: string, data: object}|null}    A sentence of the language file and what goes into it
 */
export function targetBar(actor, token, target, targetToken = null, { attack = false, from = null } = {}) {
  if ( !actor || !target ) return null;
  const rules = (unit) => unit.system?.skills?.rules ?? [];
  const enemies = () => relationOf(armyOf(actor, token), armyOf(target, targetToken)) === "enemy";
  const plain = { key: "FEO.Exchange.warn.untargetable", data: {} };

  // A unit that was turned on its own side targets neither its enemies nor another unit that was turned so
  if ( rules(actor).includes(TURNED) && (rules(target).includes(TURNED) || enemies()) ) return plain;
  if ( rules(target).includes(UNTARGETABLE) && enemies() ) return plain;

  // A unit that was forced to target another makes no other enemy its target while that one stands
  if ( rules(actor).includes(PROVOKED) && enemies() ) {
    const forced = provokers(actor.system?.timed);
    if ( forced.length && !forced.includes(target.uuid) ) {
      const scene = token?.parent ?? targetToken?.parent ?? null;
      const standing = (scene?.tokens ?? []).find((other) => {
        return forced.includes(other.actor?.uuid) && !other.actor.system.defeat?.out && (other.actor.system.hp?.value > 0);
      });
      if ( standing ) {
        return { key: "FEO.Act.provoked", data: { name: token?.name || actor.name, by: standing.name || standing.actor.name } };
      }
    }
  }

  // A unit that an ally near it shelters is attacked by no enemy that stands near that ally
  if ( attack ) {
    const tile = from ?? (token ? tokenTile(token) : null);
    const guard = tile ? shelterOver(actor, token, target, targetToken)?.(tile) : null;
    if ( guard ) {
      return { key: "FEO.Act.sheltered", data: { name: token?.name || actor.name, target: targetToken?.name || target.name, by: guard.name, skill: guard.skill } };
    }
  }
  return null;
}

/* -------------------------------------------- */

/**
 * The units that shelter another from the attacks of a unit, as a skill of theirs has it (see `shelteredFrom`
 * in `rules/stances.mjs`): the allies of the target that still stand on its map and keep the enemies near
 * them from attacking it.
 * @param {Actor|null} actor              The unit that would attack
 * @param {TokenDocument|null} token
 * @param {Actor|null} target             The unit it would attack
 * @param {TokenDocument|null} targetToken
 * @returns {((from: {i: number, j: number}) => {name: string, skill: string}|null)|null}
 *          Asked with a tile to attack from, the unit that bars the attack from there and its skill; null
 *          where nobody shelters the target at all
 */
export function shelterOver(actor, token, target, targetToken) {
  const scene = targetToken?.parent ?? null;
  const there = targetToken ? tokenTile(targetToken) : null;
  if ( !actor || !target || !scene || !there ) return null;
  const mine = armyOf(actor, token);
  const theirs = armyOf(target, targetToken);
  if ( relationOf(mine, theirs) !== "enemy" ) return null;
  const guards = [];
  for ( const other of scene.tokens ) {
    const unit = other.actor;
    const shelters = unit?.system?.shelters ?? [];
    if ( !shelters.length || (other === targetToken) || (other === token) || (unit === target) ) continue;
    if ( unit.system.defeat?.out || !(unit.system.hp?.value > 0) ) continue;
    const side = armyOf(unit, other);
    if ( (relationOf(side, theirs) !== "ally") || (relationOf(side, mine) !== "enemy") ) continue;
    const tile = tokenTile(other);
    if ( tile ) guards.push({ tile, name: other.name || unit.name, shelters });
  }
  if ( !guards.length ) return null;
  return (from) => shelteredFrom(guards, there, from);
}

/* -------------------------------------------- */

/**
 * Does the Incapacitation system apply to a unit? It does for the sides listed in the configuration, while
 * the world uses it; units of other sides are simply defeated at 0 HP.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    The unit's token, if it has one
 * @returns {boolean}
 */
export function incapacitates(actor, token = null) {
  // A creature a skill made is no unit that lies down to be saved: it falls
  if ( creatureOf(actor) ) return false;
  return FEO.defeat.enabled && FEO.defeat.armies.includes(armyOf(actor, token ?? actor.token ?? null));
}

/* -------------------------------------------- */

/**
 * Does a unit earn experience? Units of the sides listed in the configuration do, until they reach their level
 * limit in a world that plays with the Level Cap.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    The unit's token, if it has one
 * @returns {boolean}
 */
function earns(actor, token = null) {
  if ( actor.system.atMaxLevel ) return false;

  // A creature a skill made earns nothing of its own; what its skill says its maker earns is seen to apart
  if ( creatureOf(actor) && !creatureOf(actor).keeps ) return false;
  return FEO.exp.armies.includes(armyOf(actor, token ?? actor.token ?? null));
}

/* -------------------------------------------- */
/*  Distance                                    */
/* -------------------------------------------- */

/**
 * Where a token stands and how large it is, as it was last saved. A token counts as standing where it was
 * last moved to; while it is still being moved there, or while the game is paused, the place it is drawn at
 * lags behind.
 * @param {TokenDocument} token
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function placed(token) {
  const saved = token._source ?? token;
  return {
    x: saved.x ?? token.x,
    y: saved.y ?? token.y,
    width: saved.width ?? token.width,
    height: saved.height ?? token.height
  };
}

/* -------------------------------------------- */

/**
 * The tiles a token takes up on a square grid: its top row and left column, and its size in tiles.
 * @param {TokenDocument} token
 * @returns {{i: number, j: number, width: number, height: number}|null}    Null on a map without a square grid
 */
export function tokenTile(token) {
  const grid = token?.parent?.grid;
  if ( !grid?.isSquare ) return null;
  const { x, y, width, height } = placed(token);
  const { i, j } = grid.getOffset({ x: x + (grid.sizeX / 2), y: y + (grid.sizeY / 2) });
  return { i, j, width: Math.max(Math.round(width), 1), height: Math.max(Math.round(height), 1) };
}

/* -------------------------------------------- */

/**
 * Count the tiles between two tokens on the same scene.
 * On a square grid, tiles are counted along rows and columns. On other grids the straight path is measured.
 * @param {TokenDocument|null} a
 * @param {TokenDocument|null} b
 * @returns {number|null}   Null if the two cannot be measured against each other
 */
export function measureDistance(a, b) {
  if ( !a || !b || !a.parent || (a.parent !== b.parent) ) return null;
  const grid = a.parent.grid;
  if ( grid.isSquare ) return Math.max(gridDistance(tokenTile(a), tokenTile(b)), 1);

  const centre = (token) => {
    const { x, y, width, height } = placed(token);
    return { x: x + ((width * grid.sizeX) / 2), y: y + ((height * grid.sizeY) / 2) };
  };
  const path = grid.measurePath([centre(a), centre(b)]);
  const tiles = grid.isGridless ? path.distance / grid.distance : path.spaces;
  return Math.max(Math.round(tiles), 1);
}

/* -------------------------------------------- */
/*  Forecast                                    */
/* -------------------------------------------- */

/**
 * Show the forecast for an exchange and wait for the player to commit to it.
 * The distance can be changed in the dialog, which redraws the forecast.
 * @param {(distance: number) => ExchangePlan} makePlan
 * @param {number} distance             The distance to start from
 * @param {number|null} measured        The distance measured between the tokens, if it could be
 * @returns {Promise<number|string|null>}  The distance to fight at; anything but a number means the attack
 *                                        was called off
 */
async function confirmForecast(makePlan, distance, measured) {
  const { renderTemplate } = foundry.applications.handlebars;
  const render = (tiles) => renderTemplate(FORECAST_TEMPLATE, buildForecast(makePlan(tiles), game.i18n, { measured }));
  const read = (input) => Math.max(Math.floor(input.valueAsNumber) || 1, 1);

  // The dialog takes its content as a bare element and copies what is inside it
  const content = document.createElement("div");
  content.innerHTML = `<div class="feo-forecast">${await render(distance)}</div>`;

  return foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.Exchange.forecast" },
    position: { width: 520 },
    content,
    buttons: [
      {
        action: "attack",
        label: "FEO.Combat.attack",
        icon: "fa-solid fa-dice-d20",
        default: true,
        disabled: !!makePlan(distance).initiator.blocked,
        callback: (event, button) => read(button.form.elements.distance)
      },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const forecast = dialog.element.querySelector(".feo-forecast");
      const input = forecast.querySelector('input[name="distance"]');
      let latest = 0;
      const redraw = async () => {
        const tiles = read(input);
        const turn = ++latest;
        const fresh = document.createElement("div");
        fresh.innerHTML = await render(tiles);
        if ( turn !== latest ) return;
        forecast.querySelector(".matchup").replaceWith(fresh.querySelector(".matchup"));
        const attack = dialog.element.querySelector('button[data-action="attack"]');
        if ( attack ) attack.disabled = !!makePlan(tiles).initiator.blocked;
      };

      // The forecast follows the field as it is edited; the field is tidied once editing is done
      input.addEventListener("input", redraw);
      input.addEventListener("change", () => input.value = read(input));

      // Enter in the field must not commit to an attack
      input.addEventListener("keydown", (keydown) => {
        if ( keydown.key === "Enter" ) keydown.preventDefault();
      });
    }
  });
}

/* -------------------------------------------- */
/*  Applying Results                            */
/* -------------------------------------------- */

/**
 * Save what an exchange changed about one unit.
 * @param {Actor} actor
 * @param {ExchangeChange} change
 * @returns {Promise<void>}
 */
async function applyChange(actor, change) {
  const update = {};
  const system = actor.system;

  // Damage past 0 HP is kept for a unit that can be Incapacitated. A fight counts a unit's temporary HP with
  // its own: what it lost is taken off those first
  let tempLost = 0;
  if ( Number.isInteger(change.hp) ) {
    const temp = system.hp.temp ?? 0;
    const split = temp ? splitHp({ value: system.hp.value, max: system.hp.max, temp }, change.hp) : { value: change.hp, temp: 0 };
    tempLost = temp - split.temp;
    update["system.hp.value"] = incapacitates(actor) ? split.value : Math.max(split.value, 0);
  }
  // A unit that imitates another fought with that unit's weapon ranks, which are not its own to raise: what
  // it earned goes to its own proficiencies of the same kind
  let trained = change.proficiencies ?? {};
  try {
    const { ownProficiencies } = await import("./imitation.mjs");
    trained = ownProficiencies(actor, trained) ?? trained;
  } catch(err) {
    console.error(err);
    trained = (actor.getFlag(FEO.id, "imitation") || actor.getFlag(FEO.id, "levelSync")) ? {} : trained;
  }
  for ( const [key, proficiency] of Object.entries(trained) ) {
    const { rank, wexp } = proficiency ?? {};
    if ( !(key in FEO.proficiencies) || !(rank in FEO.ranks) || !Number.isFinite(wexp) ) continue;
    update[`system.proficiencies.${key}.rank`] = rank;
    update[`system.proficiencies.${key}.wexp`] = Math.max(wexp, 0);
  }

  // Experience earned and Wounds taken. A Wound lowers maximum HP, which current HP cannot exceed
  // No more of either than the unit's own skills can make of one fight
  const most = (Number.isInteger(change.exp) || Number.isInteger(change.gold)) ? mostEarned(actor) : null;
  if ( Number.isInteger(change.exp) && (change.exp > 0) && (change.exp <= most.exp) ) {
    update["system.exp"] = system.exp + change.exp;
  }

  // Gold a skill earned the unit for defeating its foe
  if ( Number.isInteger(change.gold) && (change.gold > 0) && (change.gold <= most.gold) ) {
    update["system.gold"] = (system.gold ?? 0) + change.gold;
  }
  if ( Number.isInteger(change.wounds) && (change.wounds > 0) && (change.wounds <= 9) && incapacitates(actor) ) {
    update["system.wounds"] = system.wounds + change.wounds;
    const max = Math.max(system.hp.max - (change.wounds * FEO.woundPenalty), 0);
    if ( (update["system.hp.value"] ?? system.hp.value) > max ) update["system.hp.value"] = max;
  }

  // A Shift Gauge after the fight, or a stone's transformation used up
  const shift = change.shift;
  const reverted = !!shift && (system.shift?.mode === "gauge") && system.shift.active && (shift.active === false);
  if ( shift && system.shift?.mode ) {
    const count = (value) => Number.isInteger(value) && (value >= 0) && (value <= 99);
    if ( count(shift.value) ) update["system.shift.value"] = Math.min(shift.value, FEO.shift.gauge.max);
    if ( typeof shift.active === "boolean" ) update["system.shift.active"] = shift.active;
    if ( count(shift.fought?.own) ) update["system.shift.fought.own"] = shift.fought.own;
    if ( count(shift.fought?.other) ) update["system.shift.fought.other"] = shift.fought.other;
    if ( count(shift.uses) ) update["system.shift.uses"] = shift.uses;
  }

  // Battalions & Gambits: the unit's Authority once it has earned Authority EXP
  const command = FEO.optional.battalions;
  const earned = change.authority;
  if ( command.enabled && earned && ((earned.rank === "F") || command.ranks.includes(earned.rank))
    && Number.isInteger(earned.exp) && (earned.exp >= 0) && (earned.exp <= 99) ) {
    update["system.authority.rank"] = earned.rank;
    update["system.authority.exp"] = earned.exp;
  }

  // Breaking: whether the unit suffers from Break once the fight is over
  if ( (typeof change.break === "boolean") && (change.break !== !!system.break) ) update["system.break"] = change.break;

  // Stagger: what a fight left of the unit's Stagger bar. A fight follows the bars of its two units by itself,
  // so that the HP this change takes is not taken off the bar a second time
  const settled = staggerInUse() && ("stagger" in change);
  const bar = change.stagger;
  if ( settled && bar ) {
    const count = (value, most) => Number.isInteger(value) && (value >= 0) && (value <= most);
    if ( count(bar.max, 999) && count(bar.value, bar.max) && count(bar.turns, FEO.optional.stagger.turns.own) ) {
      update["system.stagger"] = { value: bar.turns ? 0 : bar.value, max: bar.max, turns: bar.turns };
    }
  }

  // Capturing: an attempt that is no longer readied; a unit that is captured, which is out of the fight and
  // keeps the HP it had; one that is free again, with that HP, or released, which leaves the battle; and the
  // captive a unit holds or has subdued, or holds no longer. `shown` is what the map then has to show of it
  let shown = null;
  if ( FEO.optional.capturing.enabled ) {
    if ( (change.capturing === false) && system.capturing ) update["system.capturing"] = false;
    const taken = change.captured;
    const was = system.defeat?.state === "captured";
    if ( taken && (typeof taken.by === "string") && taken.by && Number.isInteger(taken.hp) && (taken.hp >= 0) && (taken.hp <= 999) ) {
      update["system.defeat"] = { state: "captured", turns: 0, paused: false };
      update["system.captured"] = { by: taken.by, name: String(taken.name ?? ""), hp: taken.hp, held: taken.held === true };
      if ( (update["system.hp.value"] ?? system.hp.value) < 0 ) update["system.hp.value"] = 0;
      shown = { hide: (taken.held === true) ? true : null };
    }
    else if ( was && ((change.freed === true) || (change.released === true)) ) {
      update["system.defeat"] = { state: change.freed ? "" : "retreated", turns: 0, paused: false };
      update["system.captured"] = { by: "", name: "", hp: 0, held: false };
      if ( change.freed ) update["system.hp.value"] = Math.min(Math.max(system.captured?.hp ?? 0, 1), Math.max(system.hp.max, 1));
      shown = { hide: (change.freed && system.captured?.held) ? false : null, at: change.at ?? null };
    }
    if ( "captive" in change ) {
      const held = change.captive;
      const turns = Number.isInteger(held?.turns) ? Math.min(Math.max(held.turns, 0), 9) : 0;
      update["system.captive"] = ((typeof held?.uuid === "string") && held.uuid)
        ? { uuid: held.uuid, name: String(held.name ?? ""), held: held.held === true, turns }
        : { uuid: "", name: "", held: false, turns: 0 };
    }
  }

  // A unit that goes down is told of on the card of the fight; where there is none to tell of it, as after a
  // Gambit, the system posts its own
  if ( Object.keys(update).length ) {
    await actor.update(update, { [FEO.id]: { quietDefeat: change.announce !== true, [STAGGER_SETTLED]: settled } });
  }
  if ( shown ) await settleCapture(actor, shown);

  // What became of the Battalion the unit commands: the HP it has left, its level and EXP, and the uses its
  // Gambit has left
  const squad = actor.items.get(change.battalion?.id);
  if ( command.enabled && (squad?.type === "battalion") ) {
    const { hp, level, exp, uses } = change.battalion;
    const count = (value, most) => Number.isInteger(value) && (value >= 0) && (value <= most);
    const patch = {};
    if ( count(hp, squad.system.hp.max) ) patch["system.hp.value"] = hp;
    if ( count(level, command.levels.max) && (level >= 1) ) patch["system.level"] = level;
    if ( count(exp, command.levels.exp) ) patch["system.exp"] = exp;
    if ( count(uses, squad.system.gambit.uses.max) ) patch["system.gambit.uses.value"] = uses;
    if ( Object.keys(patch).length ) await squad.update(patch);
  }

  // A weapon that spends its last use breaks
  const weapon = actor.items.get(change.weapon?.id);
  if ( (weapon?.type === "weapon") && Number.isInteger(change.weapon.uses) ) {
    const uses = Math.max(change.weapon.uses, 0);
    await weapon.update({ "system.uses.value": uses });
    if ( (uses === 0) && (weapon.system.uses.max > 0) ) await breakItem(weapon);
  }

  // So does another weapon or tome it carries, of which an answer in the middle of the fight spent uses
  for ( const spent of Array.isArray(change.items) ? change.items : [] ) {
    const item = actor.items.get(spent?.id);
    if ( (item?.type !== "weapon") || !Number.isInteger(spent.uses) || !(item.system.uses.max > 0) ) continue;
    const uses = Math.min(Math.max(spent.uses, 0), item.system.uses.value);
    await item.update({ "system.uses.value": uses });
    if ( uses === 0 ) await breakItem(item);
  }

  // So does a Shield: it is a Broken Shield from then on, and is put away
  const shield = actor.items.get(change.shield?.id);
  if ( (shield?.type === "gear") && shield.system.isShield && Number.isInteger(change.shield.uses) && (shield.system.uses.max > 0) ) {
    const uses = Math.min(Math.max(change.shield.uses, 0), shield.system.uses.max);
    await shield.update({ "system.uses.value": uses });
    if ( uses === 0 ) await breakShield(shield);
  }

  // A Laguz whose gauge ran out is back in humanoid form, with what it fights with in that form
  if ( reverted ) {
    const { equipForForm } = await import("./shifting.mjs");
    await equipForForm(actor, false);
  }

  // Declared skills the fight spent: their cooldown starts, a use is counted, and they switch off unless
  // they last. Anything that is not a tracked skill of this unit and a sensible state is dropped
  for ( const spent of change.skills ?? [] ) {
    const skill = actor.items.get(spent?.id);
    const state = spent?.state ?? {};
    const count = (value) => Number.isInteger(value) && (value >= 0) && (value <= 99);
    const sensible = (typeof state.active === "boolean") && count(state.cooldown) && count(state.lasting) && count(state.used);

    // An Affinity its unit chooses when to use keeps where it stands on the unit, not on an Item
    if ( (spent?.id === AFFINITY_ID) && sensible ) {
      await saveAffinity(actor, state);
      continue;
    }
    if ( (skill?.type !== "skill") || !skill.system.usage?.kind ) continue;
    if ( (typeof state.active !== "boolean") || !count(state.cooldown) || !count(state.lasting) || !count(state.used) ) continue;
    await skill.update({
      "system.state": { active: state.active, cooldown: state.cooldown, lasting: state.lasting, used: state.used }
    });
  }

  // The Combat Art the unit performed is no longer readied
  const art = actor.items.get(change.art?.id);
  if ( art?.type === "art" ) await art.update({ "system.readied": false });

  // Changes that last a while: what the unit carries after the fight, or for a unit that only stood near it,
  // what it was granted. Anything that is not a sensible change is dropped
  if ( Array.isArray(change.timed) ) await setTimed(actor, change.timed);
  if ( Array.isArray(change.grants) ) await grantTimed(actor, change.grants);
  if ( tempLost > 0 ) await loseTemp(actor, tempLost);

  // The attacks made against the unit since its own turn began, for a skill that counts them across fights:
  // kept while a battle runs, which is what has turns
  if ( Number.isInteger(change.attacked) && (change.attacked >= 0) && (change.attacked <= 999) && game.combat?.started && actor.inCombat ) {
    await actor.setFlag(FEO.id, "attacked", change.attacked);
  }

  // The weapon the unit attacked with, for one whose skills have a weapon take something from the one used
  // before (see `rules/triangle.mjs`): it has attacked since it was taken in hand, which lasts until a weapon
  // is taken in hand anew, and the unit remembers it as the last of its kind it attacked with
  if ( change.wielded && (typeof change.wielded === "object") ) {
    const held = actor.items.get(change.wielded.id);
    if ( (held?.type === "weapon") && !held.getFlag(FEO.id, "swung") ) await held.setFlag(FEO.id, "swung", true);
    const last = cleanWielded(change.wielded.last);
    if ( last ) await actor.setFlag(FEO.id, "wielded", last);
  }

  // Conditions gained, changed or ended; anything that is not a condition and a sensible number is dropped
  const conditions = {};
  for ( const [id, turns] of Object.entries(change.conditions ?? {}) ) {
    if ( !conditionConfig(id) ) continue;
    if ( (turns === null) || (Number.isInteger(turns) && (turns >= 0) && (turns <= 99)) ) conditions[id] = turns;
  }
  if ( Object.keys(conditions).length ) await setConditions(actor, conditions);
}

/* -------------------------------------------- */

/**
 * Save the changes from an exchange. Units this user owns are updated directly; the rest are handed to an
 * active Game Master.
 * @param {(ExchangeChange & {uuid: string})[]} changes
 * @returns {Promise<string[]>}   The UUIDs of units whose changes could not be saved
 */
export async function applyChanges(changes) {
  const handOver = [];
  for ( const change of changes ) {
    if ( Object.keys(change).length < 2 ) continue;
    const actor = await foundry.utils.fromUuid(change.uuid);
    if ( actor?.isOwner ) await applyChange(actor, change);
    else handOver.push(change);
  }
  if ( !handOver.length ) return [];

  const gm = game.users.activeGM;
  if ( gm ) {
    try {
      const saved = await gm.query(APPLY_QUERY, { changes: handOver }, { timeout: 10000 });
      if ( saved ) return [];
    } catch(err) {
      console.error(err);
    }
  }
  return handOver.map((change) => change.uuid);
}

/* -------------------------------------------- */

/**
 * Say what was blocked in a fight where it happened: "Block" floats over the unit that blocked, for everyone
 * who has its map in view, and a block sounds like one.
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {{initiator: Actor, defender: Actor}} actors
 * @returns {Promise<void>}
 */
async function showBlocks(result, actors) {
  const blocks = result.attacks.filter((attack) => attack.block?.success);
  if ( !blocks.length ) return;
  const { pop } = await import("./events.mjs");
  for ( const attack of blocks ) {
    const text = game.i18n.localize(attack.block.parry?.success ? "FEO.Block.parry" : "FEO.Block.label");
    pop(actors[(attack.side === "initiator") ? "defender" : "initiator"], [{ text, tone: "block" }]);
  }
  const src = FEO.blocking.sound;
  if ( !src ) return;

  // The sound comes with the word, which waits for the fight's cut-ins to be over
  const play = () => foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, true);
  let hold = 0;
  try {
    hold = (await import("./cut-ins.mjs")).cutInHold();
  } catch(err) {
    console.error(err);
  }
  if ( hold > 0 ) setTimeout(play, hold);
  else play();
}

/* -------------------------------------------- */

/**
 * Answer another user's request to save the changes from an exchange. Runs for a Game Master.
 * Only current HP, the uses of a weapon and of a Shield, proficiencies, conditions, experience and gold earned, Wounds taken, the Shift

 * Gauge, the state of declared skills, a Combat Art being readied, the changes that last a while, Authority,
 * what a fight or a Gambit does to the Battalion a unit commands, whether a unit suffers from Break, who is
 * captured, held or free again, and what a fight left of a Stagger bar can be changed this way.
 * @param {{changes: (ExchangeChange & {uuid: string})[]}} data
 * @returns {Promise<boolean>}
 */
export async function applyExchangeQuery({ changes } = {}) {
  if ( !game.user.isGM || !Array.isArray(changes) ) return false;
  for ( const change of changes ) {
    const actor = await foundry.utils.fromUuid(change?.uuid);
    if ( (actor?.documentName !== "Actor") || (actor.type !== "unit") ) continue;
    await applyChange(actor, change);
  }
  return true;
}

/* -------------------------------------------- */
/*  The Exchange                                */
/* -------------------------------------------- */

/**
 * @typedef Matchup
 * @property {string} [warning]           Why the attack cannot be made at all, as a localization key. Nothing
 *                                        else is set then
 * @property {Actor} target               The unit behind the targeted token
 * @property {{initiator: string, defender: string}} names
 * @property {(distance: number, foiled?: object|null, options?: {better?: boolean}) => ExchangePlan} makePlan
 *                                        Plan the exchange at a distance; `foiled` is what a skill brought to
 *                                        nothing before the fight (see `rules/answers.mjs`), and `better` has a
 *                                        lent weapon be the better one its skill names
 * @property {(distance: number) => import("../rules/lending.mjs").LendOffer|null} lent
 *                                        The weapon a skill lends the unit that it attacks with at a distance,
 *                                        if it attacks with one (see `rules/lending.mjs`)
 * @property {number|null} measured       The distance measured between the tokens, if it could be
 * @property {number} distance            The distance to start from
 * @property {{initiator: object, defender: object}|null} ground    What each unit stands on
 */

/**
 * Set up an attack of a unit on a targeted token, without committing to anything: who the two are, where
 * they stand, and how the exchange between them would go at a distance.
 * @param {Actor} actor                   The initiating unit
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Token} targetToken             The targeted token
 * @param {object} [options]
 * @param {{i: number, j: number}|null} [options.from]    A tile to attack from instead of the one the unit
 *                                        stands on, as when it is about to move there
 * @param {{spaces: number, cost: number, passed?: string[]}|null} [options.walk]
 *                                        The way to that tile from where the unit's turn began, and the
 *                                        enemies moved through on it, which its movement this turn is then
 *                                        counted by
 * @param {{initiator: number, defender: number}|null} [options.lost]
 *                                        The HP that way takes off the two before the fight begins, as a
 *                                        skill may have it deal damage along it
 * @param {{rounds: number|"fall", skill?: string}|null} [options.rounds]
 *                                        A fight of several rounds, as a skill used as an action starts one
 *                                        (see `rules/rounds.mjs`)
 * @param {{skill?: string, hit?: number, share?: number, free?: boolean}|null} [options.extra]
 *                                        One attack on another unit beside a fight, as a skill has its unit
 *                                        make it (see `rules/spread.mjs`): it is no Action of the unit's turn
 * @param {{tile: {i: number, j: number}, skill?: string, effects?: object[]}|null} [options.stand]
 *                                        The unit attacked fights in the place of another, as one that stands
 *                                        guard does (see `rules/stances.mjs`): the tile of the unit it stands
 *                                        in for, which the fight is measured to and whose ground it is fought
 *                                        on, and what it has for that fight alone
 * @param {{initiator?: {skill: string, effects: object[]}, defender?: {skill: string, effects: object[]}}|null} [options.lend]
 *                                        What a skill has either unit have for this fight alone
 * @returns {Matchup}
 */
export function planAttack(actor, token, targetToken, { from = null, walk = null, lost = null, rounds = null, extra = null, stand = null, lend = null } = {}) {
  const target = targetToken.actor;
  if ( target?.type !== "unit" ) return { warning: "FEO.Exchange.warn.noUnit" };
  if ( (target === actor) || (token && (targetToken.document === token)) ) return { warning: "FEO.Exchange.warn.self" };

  // A Laguz in humanoid form cannot start a fight, only answer one, unless a skill lets it
  if ( (actor.system.shift?.mode === "gauge") && !actor.system.shift.active && !Number.isFinite(actor.system.shift.bends?.humanFight) ) {
    return { warning: "FEO.Shift.cannotInitiate" };
  }

  // One a skill lets start a fight in that form does so with what a unit fights with there, and nothing else
  if ( (actor.system.shift?.mode === "gauge") && !actor.system.shift.active && !extra?.arm ) {
    const held = actor.system.equippedWeapon;
    if ( held && (held.system.category !== "staff") && !isHumanWeapon(held.name) ) return { warning: "FEO.Shift.fistsOnly" };
  }
  if ( actor.system.defeat?.state ) return { warning: "FEO.Defeat.cannotAttack" };

  // Nobody starts a fight with a staff in its hand but a unit whose skill lets it, or with a staff that says
  // anybody may; and then only against a unit next to it. Anybody answers an attack with one
  const wielded = extra?.arm ? null : actor.system.equippedWeapon;
  if ( (wielded?.system.category === "staff") && !wielded.system.broken ) {
    const data = { name: token?.name || actor.name, staff: wielded.name };
    if ( !fightsWithStaff({ effect: wielded.system.effect }, actor.system.skills?.rules) ) return { warning: "FEO.Staff.noFight", warningData: data };
    const apart = from ? null : measureDistance(token, targetToken.document);
    if ( (apart ?? 1) > 1 ) return { warning: "FEO.Staff.fightBeside", warningData: data };
  }

  // Nobody fights a unit that is out of the fight; one that was captured is another matter
  if ( target.system.defeat?.out && (target.system.defeat.state !== "captured") ) return { warning: "FEO.Defeat.targetOut" };

  // Nor does an enemy attack a unit that none of them can make their target for now, nor a unit that was
  // forced to target another any enemy but that one
  const bar = targetBar(actor, token, target, targetToken.document, { attack: true, from });
  if ( bar ) return { warning: bar.key, warningData: bar.data };

  // A Staggered unit cannot act
  if ( isStaggered(actor.system.stagger) ) return { warning: "FEO.Optional.stagger.cannotAct" };

  // Neither can a unit that a skill leaves nothing but Waiting, as one that has Run, nor one that has taken
  // its Action and is only moving again
  if ( !extra && (turnState(actor, token) === "moving") ) return { warning: "FEO.Canto.only" };

  // Nor one that another unit has hold of
  if ( actor.system.skills?.rules?.includes("gripped") ) return { warning: "FEO.Grip.cannotAct" };

  // Nor does a unit attack on a go that leaves it every Action but that
  if ( !extra && (turnState(actor, token) === "ready") && extraGo(actor)?.bars.includes("attack") ) return { warning: "FEO.Acting.noAttack" };
  if ( !extra && onlyWaits(actor, token, { walk }) ) return { warning: "FEO.Wait.only" };

  const names = { initiator: token?.name || actor.name, defender: targetToken.document.name || target.name };

  // Where both stand as the attack is declared: the units around each, and the auras each receives. A unit
  // without a token on the map has nothing around it, and what hangs on that is shown, not applied
  const places = { initiator: standingOf(token), defender: standingOf(targetToken.document) };

  // The ground under both: what each tile gives the unit on it, and how high it lies. Without a token on a
  // square grid the fight is on open, level ground
  const footing = { initiator: groundUnder(token, from), defender: groundUnder(targetToken.document, stand?.tile ?? null) };
  const ground = (footing.initiator && footing.defender) ? footing : null;

  // A unit that attacks from another tile than its token stands on is asked about the ground of that tile,
  // and stands on it for what is asked about the space it is in
  if ( from && places.initiator && footing.initiator ) {
    const { terrain, effects } = footing.initiator;
    const near = places.initiator.near;
    const tile = near.tile ? { ...near.tile, i: from.i, j: from.j } : near.tile;
    places.initiator = { ...places.initiator, near: { ...near, tile, ground: { terrain, effects } } };
  }

  // And whether the two have each other in their Line of Sight is told from that tile
  if ( from && places.initiator && places.defender ) {
    try {
      Object.assign(places, sightFrom(places, token, targetToken.document, from));
    } catch(err) {
      console.error(err);
    }
  }

  // How both moved this turn: the unit that attacks by the way to the tile it attacks from, the other by what
  // its last turn came to. Outside of a battle that cannot be judged, and what hangs on it is shown, not applied
  const moves = { initiator: turnMoveOf(token, { walk }), defender: turnMoveOf(targetToken.document) };

  // A unit in its own turn that attacks from where it stands is counted from where that turn began, whatever
  // its token has noted
  if ( !walk && token && (turnState(actor, token) === "ready") ) moves.initiator = reachOf(token)?.move ?? moves.initiator;

  // A unit that has readied a Combat Art performs it: it pays the Art's HP as the fight begins. One that has
  // readied an attempt to capture fights to capture its target
  const attacker = (unit) => withReadiedCapture(actor, token, target, targetToken.document, withReadiedArt(actor, unit));

  // What the way to the fight takes off a unit's HP is gone as the fight begins
  const hurt = (unit, amount) => (amount > 0) ? { ...unit, hp: Math.max(unit.hp - amount, 0) } : unit;

  // What a skill has either unit have for this fight alone, as a change that lasts no longer than the fight
  const lent = (given) => given?.effects?.length
    ? [buildChange({ name: given.skill || "Stance", effects: given.effects, ends: "turnEnd" }, { skill: given.skill || "Stance", own: true })]
    : [];
  const lending = { initiator: lent(lend?.initiator), defender: [...lent(lend?.defender), ...lent(stand)] };
  const more = (lending.initiator.length || lending.defender.length) ? lending : null;

  // A weapon a skill lends the unit (see `rules/lending.mjs`): the one it took up, or one that is used by
  // itself from where the weapon in its hand does not reach. One attack a skill has it make is made with
  // what that skill says, and a fight of several rounds with the weapon in hand
  // A further attack a skill has it make beside a fight is made with the lent weapon it took up for that fight
  const told = !!extra && ("arm" in extra);
  const offers = (told || rounds) ? [] : offersOf(actor);
  const lentAt = (distance) => {
    if ( !offers.length ) return null;
    if ( !extra ) return lentFor(actor, distance, { offers, move: moves.initiator }) ?? bareFor(actor, offers);
    return stillHeld(actor, offers);
  };

  // A unit that is attacked with no weapon in its hand attacks back with the one a skill lends its bare hands
  const answering = (unit) => {
    const offer = unit.weapon ? null : bareFor(target);
    return offer ? armedWith(unit, offer.arm) : unit;
  };
  const armed = (unit, distance, better) => {
    const offer = lentAt(distance);
    return offer ? armedWith(unit, (better && offer.better) ? offer.better.arm : offer.arm) : unit;
  };

  // What stands between the two, for a unit whose skill lets it attack from further than its weapon reaches
  // only where nothing does (see `weaponRange` in `rules/skills.mjs`)
  const reaching = (actor.system.skills?.entries ?? []).some((skill) => (skill.effects ?? []).some((effect) => effect?.weaponRange?.open));
  const here = tokenTile(token);
  const own = tokenTile(targetToken.document);
  const stood = (from && here) ? { i: from.i, j: from.j } : here;
  const way = (reaching && stood && own && token?.parent)
    ? { blocked: betweenOn(token.parent, stood, own, { but: [token, targetToken.document] }) }
    : null;
  const makePlan = (distance, foiled = null, { better = false } = {}) => planExchange(
    attacker(armed(hurt(combatantOf(actor, names.initiator, { incapacitates: incapacitates(actor, token), place: places.initiator, move: moves.initiator }), lost?.initiator), distance, better)),
    hurt(answering(combatantOf(target, names.defender, { incapacitates: incapacitates(target, targetToken.document), place: places.defender, move: moves.defender })), lost?.defender),
    { distance, ground, foiled, rounds, extra, more, way }
  );

  // Start from the measured distance, or failing that from as close as the weapon can strike. A unit that
  // fights in the place of another is fought at the distance to that unit's tile
  const there = (stand?.tile && own) ? { ...own, i: stand.tile.i, j: stand.tile.j } : own;
  const measured = ((from || stand?.tile) && here && there)
    ? Math.max(gridDistance(from ? { ...here, i: from.i, j: from.j } : here, there), 1)
    : measureDistance(token, targetToken.document);
  const weapon = actor.system.equippedWeapon;
  const reach = weapon ? parseRange(weapon.system.range, actor.system.statValues) : null;
  const nearest = reach?.min ?? null;

  // A unit whose skill lets it strike a diagonal neighbour in melee fights it as if it stood next to it,
  // with a weapon that does not reach 2 tiles by itself
  const cornered = !from && !stand?.tile && (measured === 2) && !!reach && (reach.max < 2) && !!actor.system.skills?.rules?.includes("diagonalMelee")
    && weaponIs({ name: weapon.name, category: weapon.system.category }, ["melee"])
    && touchesCorner(tokenTile(token), tokenTile(targetToken.document));
  return {
    target, names, makePlan, measured, ground, lent: lentAt,
    distance: cornered ? 1 : (measured ?? Math.max(nearest ?? 1, 1))
  };
}

/* -------------------------------------------- */

/**
 * Fight one exchange between a unit and a targeted token: show the forecast, roll it out on confirmation,
 * save what changed and post the result to chat.
 * @param {Actor} actor                   The initiating unit
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Token} targetToken             The targeted token
 * @param {object} [options]
 * @param {(matchup: Matchup) => Promise<number|null>} [options.confirm]
 *                                        Asks the player to commit to the attack and answers with the distance
 *                                        to fight at, or with anything else to call it off. The forecast
 *                                        dialog asks unless something else is given
 * @param {{moves?: object[], acts?: object[], steps?: object[]}} [options.told]     Filled in with what the fight leaves its unit to do: the
 *                                        `moves` its skills have it make now that the fight is over, the goes
 *                                        they earn it (`acts`), and the `steps` they have units take
 * @param {{rounds: number|"fall", skill?: string, item?: string}|null} [options.rounds]
 *                                        A fight of several rounds, as a skill used as an action starts one:
 *                                        how many, the skill's name, and its Item, which the fight then spends
 * @param {object|null} [options.extra]   One attack a skill used as an action has its unit make in place of a
 *                                        fight (see `strikeOf` in `helpers/actions.mjs`): what it is made
 *                                        with, and the skill's Item, which it then spends
 * @param {object|null} [options.stand]   The unit attacked fights in the place of another (see `planAttack`)
 * @param {object|null} [options.lend]    What a skill has either unit have for this fight alone
 * @returns {Promise<ChatMessage|null>}   The message that was posted, or null if no exchange took place
 */
export async function attackTarget(actor, token, targetToken, { confirm = null, told = null, rounds = null, extra = null, stand = null, lend = null } = {}) {
  const matchup = planAttack(actor, token, targetToken, { rounds, extra, stand, lend });
  if ( matchup.warning ) {
    ui.notifications.warn(game.i18n.format(matchup.warning, matchup.warningData ?? {}));
    return null;
  }
  const { target, names, makePlan } = matchup;
  const distance = confirm
    ? await confirm(matchup)
    : await confirmForecast(makePlan, matchup.distance, matchup.measured);
  if ( !Number.isFinite(distance) ) return null;

  // Plan again from the units as they are now, then roll it out
  let plan = makePlan(distance);

  // A weapon a skill lends the unit may be bettered by a chance of another of its skills, which is rolled as
  // the fight is started: the fight is then planned with the better weapon that skill names
  const offer = matchup.lent?.(distance) ?? null;
  const lentRolls = [];
  const lentDice = [];
  let better = false;
  const chance = offer?.better
    ? (plan.initiator.chances?.lend ?? []).find((proc) => (proc.skill === offer.better.skill) && (proc.betters === offer.skill))
    : null;
  if ( chance && !plan.initiator.blocked ) {
    const sure = chance.chance >= 100;
    const rolled = sure ? null : (await rollD100(1)).results[0];
    better = sure || (rolled <= chance.chance);
    if ( !sure ) lentDice.push(rolled);
    lentRolls.push({ skill: chance.skill, on: "lend", by: "initiator", roll: rolled, chance: chance.chance, success: better, sure });
    if ( better ) plan = makePlan(distance, null, { better });
  }
  const replan = (foiled = null) => makePlan(distance, foiled, { better });

  // Capturing: a target that cannot fight back is captured without a fight by a unit that stands next to it
  const attempt = plan.initiator.unit.capture;
  if ( attempt?.ok && attempt.outright && (plan.distance <= 1) ) {
    return captureOutright(actor, token, target, targetToken.document, attempt.outright);
  }
  if ( plan.initiator.blocked ) {
    ui.notifications.warn(`FEO.Exchange.blocked.${plan.initiator.blocked}`, { localize: true });
    return null;
  }

  // A fight of several rounds is only started with a foe that can counter-attack
  if ( rounds && !plan.rounds ) {
    ui.notifications.warn(game.i18n.format("FEO.Round.noCounter", { skill: rounds.skill ?? "", name: names.defender }));
    return null;
  }

  // A unit that an enemy attacks may change its weapon first, where a skill lets it: whoever acts for it is
  // offered the weapons in its pack on their map, and the fight is planned again with the one they pick
  // One attack a skill has its unit make is not answered, so that nothing is offered
  try {
    const { offerRearm } = await import("./choices.mjs");
    if ( !extra && (await offerRearm(token, targetToken.document, plan.distance)) ) plan = replan();
  } catch(err) {
    console.error(err);
  }
  // What a skill of either unit brings to nothing before the fight: the skills its foe chose for it, and the
  // Combat Art its foe performs. Each is rolled for, and the fight is planned again without what went
  const answering = await import("./answers.mjs");
  let before = { rolls: [], dice: [] };
  try {
    before = await answering.foilBefore(plan, (foiled) => replan(foiled));
    plan = before.plan;
  } catch(err) {
    console.error(err);
  }

  // The dice of the fight are rolled at once. A fight that takes more of them than were rolled rolls on
  const { results } = await rollD100(rollBudget(plan));
  const used = [];
  const next = () => {
    if ( results[used.length] === undefined ) results[used.length] = Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * 100) + 1;
    const rolled = results[used.length];
    used.push(rolled);
    return rolled;
  };

  // The fight is rolled out. Where a skill lets whoever acts for a unit answer in the middle of it (dodge
  // this hit, roll this miss again, come for an ally that would fall), the fight stops, that user is offered
  // it on their map, and the fight is rolled out again from the same dice with what they answered
  const { result, saver } = await answering.rollAnswered(plan, { next, reset: () => (used.length = 0) }, {
    initiator: { token, actor },
    defender: { token: targetToken.document, actor: target }
  });
  if ( lentRolls.length || before.rolls.length ) result.opening = [...lentRolls, ...before.rolls, ...(result.opening ?? [])];
  if ( told ) {
    told.moves = result.moves ?? [];
    told.acts = result.acts ?? [];
    told.steps = result.steps ?? [];
    told.refreshes = result.refreshes ?? [];
    told.loot = result.loot ?? [];
    told.raises = result.raises ?? [];
    told.disarmed = result.disarmed ?? [];
  }

  // What follows from the fight: experience, Wounds, a unit going down, a Shift Gauge moving. What a summoned
  // unit would earn goes to its summoner, if that one earns experience
  const summoners = { initiator: summonerOf(actor), defender: summonerOf(target) };
  const heir = (unit) => (unit ? { name: unit.token?.name ?? unit.name, exp: unit.system.exp } : null);
  const aftermath = exchangeAftermath(plan, result, {
    earns: {
      initiator: summoners.initiator ? earns(summoners.initiator) : earns(actor, token),
      defender: summoners.defender ? earns(summoners.defender) : earns(target, targetToken.document)
    },
    heirs: { initiator: heir(summoners.initiator), defender: heir(summoners.defender) }
  });
  // A Wound a hit would cause may be spared by a skill of the unit that takes it
  const spareDice = await spareWounds(aftermath, { initiator: [actor, token], defender: [target, targetToken.document] });
  const changes = aftermathChanges(exchangeChanges(plan, result), aftermath);

  // The skill that started a fight of several rounds was used: its cooldown starts and a use is counted
  // So was the skill that had its unit make one attack of the skill's own
  // And so was the skill that lent the weapon the unit attacked with, where it counts its uses
  const starter = (plan.rounds && rounds?.item) ? actor.items.get(rounds.item) : extra?.item ? actor.items.get(extra.item)
    : (offer?.spends && offer.id && (plan.initiator.unit.weapon?.lent === offer.skill)) ? actor.items.get(offer.id) : null;
  if ( (starter?.type === "skill") && starter.system.usage?.kind ) {
    const state = spendSkill(starter.system.usage, starter.system.state, { cooldowns: cooldownsFor(actor, starter) });
    changes.initiator.skills = [...(changes.initiator.skills ?? []).filter((entry) => entry.id !== starter.id), { id: starter.id, name: starter.name, state }];
  }
  const inherited = Object.entries(summoners)
    .filter(([side, unit]) => unit && (aftermath[side].exp?.amount > 0))
    .map(([side, unit]) => ({ uuid: unit.uuid, exp: aftermath[side].exp.amount }));

  // A unit that is captured does not go down as one brought to 0 HP otherwise does
  if ( changes.defender.captured ) aftermath.defender.defeat = null;

  // Units around the two that a skill granted something that lasts
  const others = (changes.others ?? []).map((entry) => {
    const near = targetToken.document.parent?.tokens.get(entry.unit)?.actor;
    return near ? { uuid: near.uuid, name: entry.name, grants: entry.grants } : null;
  }).filter(Boolean);

  // The skills that took effect by chance or by choice flash over their units in the order they did, before
  // what the fight did is saved and its numbers are shown
  try {
    cutInFight(result, { initiator: actor, defender: target }, { started: (starter?.type === "skill") ? starter.name : "" });
  } catch(err) {
    console.error(err);
  }
  const unsaved = await applyChanges([
    { uuid: actor.uuid, ...changes.initiator },
    { uuid: target.uuid, ...changes.defender },
    ...others.map(({ uuid, grants }) => ({ uuid, grants })),
    ...inherited
  ]);
  const unapplied = [];
  if ( unsaved.includes(actor.uuid) ) unapplied.push(names.initiator);
  if ( unsaved.includes(target.uuid) ) unapplied.push(names.defender);
  for ( const other of others ) if ( unsaved.includes(other.uuid) ) unapplied.push(other.name);

  // A hit that was blocked says so over the unit that blocked it
  try {
    await showBlocks(result, { initiator: actor, defender: target });
  } catch(err) {
    console.error(err);
  }

  // A unit that loses HP whenever it attacks, as a change on it has it, does now that it has
  try {
    const { takeToll } = await import("./actions.mjs");
    for ( const [side, unit, its] of [["initiator", actor, token], ["defender", target, targetToken.document]] ) {
      if ( result.attacks.some((attack) => attack.side === side) ) await takeToll(unit, "attack", its);
    }
  } catch(err) {
    console.error(err);
  }

  // What was answered in the fight says so over the unit that answered
  try {
    await answering.showAnswers(result, { initiator: actor, defender: target });
  } catch(err) {
    console.error(err);
  }

  // An ally outside the fight that took a hit in a unit's place takes its damage, and one that turned a hit
  // back has its skill used; and a unit that made an attack is in no stance that lasts until it attacks
  let warded = [];
  try {
    const stances = await import("./stances.mjs");
    warded = await stances.takeWards(result, { initiator: token, defender: targetToken.document });
    for ( const [side, its] of [["initiator", token], ["defender", targetToken.document]] ) {
      if ( its && result.attacks.some((attack) => attack.side === side) ) await stances.settleStances(its, { attacked: true });
    }
  } catch(err) {
    console.error(err);
  }

  // The ally that came for a unit moves to it and carries it off, now that the unit stands at 1 HP
  if ( saver ) {
    try {
      await saver.finish();
    } catch(err) {
      console.error(err);
    }
  }

  // What a skill has go to the enemies around the two, now that the fight is over
  let splashed = [];
  try {
    splashed = await answering.takeSplashes(result, { initiator: token, defender: targetToken.document });
  } catch(err) {
    console.error(err);
  }

  // And what skills do to the units around (see `rules/spread.mjs`): each unit caught gets its share through
  // the one way damage, healing and conditions come to a unit, and shows its own number on the map
  let spread = [];
  const further = [];
  try {
    const { takeSpreads } = await import("./spread.mjs");
    spread = await takeSpreads(result, { initiator: token, defender: targetToken.document }, { dice: further });
  } catch(err) {
    console.error(err);
  }

  // The lent weapon it took up is put down again: the next attack is made with the weapon in hand
  if ( offer && !offer.auto ) {
    try {
      await takeUp(actor, null);
    } catch(err) {
      console.error(err);
    }
  }

  const armies = { initiator: armyOf(actor, token), defender: armyOf(target, targetToken.document) };
  // A fight in which nothing was rolled, as one whose only attack was negated, shows no dice
  const dice = [...lentDice, ...before.dice, ...used, ...further, ...spareDice];
  return postCard(actor, buildExchangeCard(plan, result, game.i18n, { armies, unapplied, aftermath, splashed, spread, stood: stand?.ally ? { ally: stand.ally, skill: stand.skill ?? "" } : null }), {
    rolls: dice.length ? [rollFromResults(dice)] : [],
    template: "exchange"
  });
}

/* -------------------------------------------- */

/**
 * The Wounds a fight would cause its units may be spared by their skills (see `saveHarm` in
 * `rules/events.mjs`): each is rolled for, what is left stays in the aftermath, and what was rolled is noted
 * there as `spared` for the card.
 * @param {{initiator: object, defender: object}} aftermath     As `exchangeAftermath` returns it; changed here
 * @param {{initiator: [Actor, TokenDocument|null], defender: [Actor, TokenDocument|null]}} units
 * @returns {Promise<number[]>}     The dice that were rolled
 */
async function spareWounds(aftermath, units) {
  const dice = [];
  for ( const side of ["initiator", "defender"] ) {
    const after = aftermath[side];
    const [unit, its] = units[side];
    if ( !(after?.wounds > 0) || !incapacitates(unit, its) ) continue;
    try {
      const { spareHarm } = await import("./events.mjs");
      const saved = await spareHarm(unit, "wound", after.wounds, { token: its });
      after.wounds = saved.left;
      after.spared = saved.rolls;
      dice.push(...saved.rolls.map((entry) => entry.roll).filter((roll) => Number.isFinite(roll)));
    } catch(err) {
      console.error(err);
    }
  }
  return dice;
}

/* -------------------------------------------- */

/**
 * Have a unit make one attack on another unit beside a fight, as a skill has it (see `rules/spread.mjs`): one
 * attack with the weapon in hand at whatever distance the two stand, with so much more or less Hit and that
 * share of its damage, which the unit attacked does not answer and which sets off no further attack of that
 * kind. It is rolled out and saved as a fight is. The unit earns experience for it only where it defeats the
 * unit attacked, and that unit earns none.
 * @param {Actor} actor                   The unit that attacks
 * @param {TokenDocument|null} token      Its token
 * @param {Token} targetToken             The token it attacks
 * @param {object} [options]
 * @param {string} [options.skill]        The skill that has it attack
 * @param {number} [options.hit]          Added to its Hit
 * @param {number} [options.share]        The share of its damage the attack deals
 * @param {boolean} [options.free]        Does it cost the weapon no use?
 * @param {object|null} [options.extra]   What else the attack is told (see `strikeOf` in `helpers/actions.mjs`):
 *                                        the weapon it is made with, whether it activates skills, what its unit
 *                                        has for it alone
 * @param {boolean} [options.earns]       Does its unit earn experience for it as for any attack, and not only
 *                                        where it defeats the unit attacked?
 * @returns {Promise<{name: string, hit: boolean, crit: boolean, damage: number, kill: boolean, hitChance: number,
 *   hitRoll: number|null, dice: number[]}|null>}     What came of it; null where no attack was made
 */
export async function strikeBeside(actor, token, targetToken, { skill = "", hit = 0, share = 1, free = false, extra = null, earns: always = false } = {}) {
  const { item: spent, ...more } = extra ?? {};
  const matchup = planAttack(actor, token, targetToken, { extra: { ...more, skill, hit, share, free } });
  if ( matchup.warning ) return null;
  const { target, names, makePlan } = matchup;
  const plan = makePlan(matchup.measured ?? matchup.distance);
  if ( plan.initiator.blocked || !plan.order.length ) return null;
  const { results } = await rollD100(rollBudget(plan));
  const used = [];
  const next = () => {
    if ( results[used.length] === undefined ) results[used.length] = Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * 100) + 1;
    const rolled = results[used.length];
    used.push(rolled);
    return rolled;
  };

  // Nobody is asked anything in the middle of it
  const result = resolveExchange(plan, next);
  const made = result.attacks.find((attack) => attack.side === "initiator");
  if ( !made ) return null;
  const kill = !!result.defender.defeated;
  const summoner = summonerOf(actor);
  const heir = summoner ? { name: summoner.token?.name ?? summoner.name, exp: summoner.system.exp } : null;
  const aftermath = exchangeAftermath(plan, result, {
    earns: { initiator: (kill || always) && (summoner ? earns(summoner) : earns(actor, token)), defender: false },
    heirs: { initiator: heir, defender: null }
  });
  used.push(...await spareWounds(aftermath, { initiator: [actor, token], defender: [target, targetToken.document] }));
  const changes = aftermathChanges(exchangeChanges(plan, result), aftermath);
  const inherited = (summoner && (aftermath.initiator.exp?.amount > 0)) ? [{ uuid: summoner.uuid, exp: aftermath.initiator.exp.amount }] : [];
  try {
    cutInFight(result, { initiator: actor, defender: target });
  } catch(err) {
    console.error(err);
  }
  await applyChanges([{ uuid: actor.uuid, ...changes.initiator }, { uuid: target.uuid, ...changes.defender }, ...inherited]);
  try {
    await showBlocks(result, { initiator: actor, defender: target });
  } catch(err) {
    console.error(err);
  }

  // A unit that made an attack is in no stance that lasts until it attacks
  try {
    const { settleStances } = await import("./stances.mjs");
    if ( token ) await settleStances(token, { attacked: true });
  } catch(err) {
    console.error(err);
  }
  return {
    name: names.defender,
    hit: !!made.hit,
    crit: !!made.crit,
    damage: made.hit ? Math.max(Math.min(made.hpBefore ?? made.damage, made.damage), 0) : 0,
    kill,
    hitChance: made.hitChance ?? 0,
    hitRoll: made.hitRoll ?? null,
    dice: used
  };
}

import { FEO } from "../config.mjs";
import { gridDistance, parseRange, planExchange, resolveExchange, rollBudget } from "../rules/combat.mjs";
import { conditionConfig } from "../rules/conditions.mjs";
import { touchesCorner } from "../rules/positions.mjs";
import { weaponIs } from "../rules/skills.mjs";
import { isStaggered, staggerInUse } from "../rules/stagger.mjs";
import { aftermathChanges, exchangeAftermath } from "./aftermath.mjs";
import { withReadiedArt } from "./arts.mjs";
import { captureOutright, settleCapture, withReadiedCapture } from "./capturing.mjs";
import { postCard, rollD100, rollFromResults } from "./chat.mjs";
import { setConditions } from "./conditions.mjs";
import { mostEarned } from "./earnings.mjs";
import { buildExchangeCard, buildForecast, combatantOf, exchangeChanges } from "./exchange-context.mjs";
import { standingOf } from "./positions.mjs";
import { summonerOf } from "./summon.mjs";
import { STAGGER_SETTLED } from "./stagger.mjs";
import { groundUnder } from "./terrain.mjs";
import { grantTimed, setTimed } from "./timed.mjs";
import { breakItem } from "./weapons.mjs";

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
  if ( actor.system.army ) return actor.system.army;
  if ( actor.hasPlayerOwner ) return "player";
  const disposition = (token ?? actor.prototypeToken)?.disposition;
  const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  if ( disposition === HOSTILE ) return "enemy";
  if ( disposition === FRIENDLY ) return "ally";
  return "other";
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

  // Damage past 0 HP is kept for a unit that can be Incapacitated
  if ( Number.isInteger(change.hp) ) update["system.hp.value"] = incapacitates(actor) ? change.hp : Math.max(change.hp, 0);
  for ( const [key, proficiency] of Object.entries(change.proficiencies ?? {}) ) {
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
 * Answer another user's request to save the changes from an exchange. Runs for a Game Master.
 * Only current HP, weapon uses, proficiencies, conditions, experience and gold earned, Wounds taken, the Shift
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
 * @property {(distance: number) => ExchangePlan} makePlan    Plan the exchange at a distance
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
 * @returns {Matchup}
 */
export function planAttack(actor, token, targetToken, { from = null } = {}) {
  const target = targetToken.actor;
  if ( target?.type !== "unit" ) return { warning: "FEO.Exchange.warn.noUnit" };
  if ( (target === actor) || (token && (targetToken.document === token)) ) return { warning: "FEO.Exchange.warn.self" };

  // A Laguz in humanoid form cannot start a fight, only answer one, unless a skill lets it
  if ( (actor.system.shift?.mode === "gauge") && !actor.system.shift.active && !Number.isFinite(actor.system.shift.bends?.humanFight) ) {
    return { warning: "FEO.Shift.cannotInitiate" };
  }
  if ( actor.system.defeat?.state ) return { warning: "FEO.Defeat.cannotAttack" };

  // A Staggered unit cannot act
  if ( isStaggered(actor.system.stagger) ) return { warning: "FEO.Optional.stagger.cannotAct" };

  const names = { initiator: token?.name || actor.name, defender: targetToken.document.name || target.name };

  // Where both stand as the attack is declared: the units around each, and the auras each receives. A unit
  // without a token on the map has nothing around it, and what hangs on that is shown, not applied
  const places = { initiator: standingOf(token), defender: standingOf(targetToken.document) };

  // The ground under both: what each tile gives the unit on it, and how high it lies. Without a token on a
  // square grid the fight is on open, level ground
  const footing = { initiator: groundUnder(token, from), defender: groundUnder(targetToken.document) };
  const ground = (footing.initiator && footing.defender) ? footing : null;

  // A unit that attacks from another tile than its token stands on is asked about the ground of that tile
  if ( from && places.initiator && footing.initiator ) {
    const { terrain, effects } = footing.initiator;
    places.initiator = { ...places.initiator, near: { ...places.initiator.near, ground: { terrain, effects } } };
  }

  // A unit that has readied a Combat Art performs it: it pays the Art's HP as the fight begins. One that has
  // readied an attempt to capture fights to capture its target
  const attacker = (unit) => withReadiedCapture(actor, token, target, targetToken.document, withReadiedArt(actor, unit));
  const makePlan = (distance) => planExchange(
    attacker(combatantOf(actor, names.initiator, { incapacitates: incapacitates(actor, token), place: places.initiator })),
    combatantOf(target, names.defender, { incapacitates: incapacitates(target, targetToken.document), place: places.defender }),
    { distance, ground }
  );

  // Start from the measured distance, or failing that from as close as the weapon can strike
  const here = tokenTile(token);
  const there = tokenTile(targetToken.document);
  const measured = (from && here && there)
    ? Math.max(gridDistance({ ...here, i: from.i, j: from.j }, there), 1)
    : measureDistance(token, targetToken.document);
  const weapon = actor.system.equippedWeapon;
  const reach = weapon ? parseRange(weapon.system.range, actor.system.statValues) : null;
  const nearest = reach?.min ?? null;

  // A unit whose skill lets it strike a diagonal neighbour in melee fights it as if it stood next to it,
  // with a weapon that does not reach 2 tiles by itself
  const cornered = !from && (measured === 2) && !!reach && (reach.max < 2) && !!actor.system.skills?.rules?.includes("diagonalMelee")
    && weaponIs({ name: weapon.name, category: weapon.system.category }, ["melee"])
    && touchesCorner(tokenTile(token), tokenTile(targetToken.document));
  return {
    target, names, makePlan, measured, ground,
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
 * @returns {Promise<ChatMessage|null>}   The message that was posted, or null if no exchange took place
 */
export async function attackTarget(actor, token, targetToken, { confirm = null } = {}) {
  const matchup = planAttack(actor, token, targetToken);
  if ( matchup.warning ) {
    ui.notifications.warn(matchup.warning, { localize: true });
    return null;
  }
  const { target, names, makePlan } = matchup;
  const distance = confirm
    ? await confirm(matchup)
    : await confirmForecast(makePlan, matchup.distance, matchup.measured);
  if ( !Number.isFinite(distance) ) return null;

  // Plan again from the units as they are now, then roll it out
  const plan = makePlan(distance);

  // Capturing: a target that cannot fight back is captured without a fight by a unit that stands next to it
  const attempt = plan.initiator.unit.capture;
  if ( attempt?.ok && attempt.outright && (plan.distance <= 1) ) {
    return captureOutright(actor, token, target, targetToken.document, attempt.outright);
  }
  if ( plan.initiator.blocked ) {
    ui.notifications.warn(`FEO.Exchange.blocked.${plan.initiator.blocked}`, { localize: true });
    return null;
  }
  const { results } = await rollD100(rollBudget(plan));
  const used = [];
  const result = resolveExchange(plan, () => {
    const next = results[used.length];
    used.push(next);
    return next;
  });

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
  const changes = aftermathChanges(exchangeChanges(plan, result), aftermath);
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

  const armies = { initiator: armyOf(actor, token), defender: armyOf(target, targetToken.document) };
  return postCard(actor, buildExchangeCard(plan, result, game.i18n, { armies, unapplied, aftermath }), {
    rolls: [rollFromResults(used)],
    template: "exchange"
  });
}

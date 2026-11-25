import { battleCanvas, movedByClick, registerBattleCanvas } from "../canvas/battle-canvas.mjs";
import { mapTile, mapTools, registerMapLayer } from "../canvas/map-layer.mjs";
import { FEO } from "../config.mjs";
import {
  actAsksTile, actBlocked, actFor, actTargetsOf, endGrip, followGrip, gripOf, heldBy, holding, isGripped, maneuversOf, movesAtToll, retryGrip,
  strikeOf, takeToll, useAct
} from "../helpers/actions.mjs";
import { areaBlocked, areaFor, areaMarks, areaView, shareTo, sharersOf, useArea } from "../helpers/areas.mjs";
import { askMakes } from "../helpers/creatures.mjs";
import { imitationBar, revertUnit } from "../helpers/imitation.mjs";
import { attackAt, attackFrom, harmOf, reachOf, standsTo, threatOf, walkHome, walkOf, warpTilesOf, waypointsTo } from "../helpers/battle-map.mjs";
import { shoveUnit, shovesOf } from "../helpers/forced.mjs";
import { packOptions, stealOf, stealUnit, stealsOf } from "../helpers/stealing.mjs";
import { afterFree, tradeOf, tradeUnit, tradesOf } from "../helpers/trading.mjs";
import { readTrade, tradeRows } from "../rules/trading.mjs";
import { toggleShift } from "../helpers/shifting.mjs";
import { actOnObject, describeAct, objectActOn, objectActsOf, objectName, objectsShown, registerObjects } from "../helpers/objects.mjs";
import { objectOn, objectsOn } from "../helpers/map-objects.mjs";
import { isSpent } from "../rules/objects.mjs";
import { damageUnit, pop } from "../helpers/events.mjs";
import { armyOf, planAttack, targetBar, tokenTile } from "../helpers/exchange.mjs";
import { fightChoices, pickStat, rearmSkill, stepChoice } from "../helpers/choices.mjs";
import { AFFINITY_ID } from "../rules/optional.mjs";
import { fightTarget } from "../helpers/fight.mjs";
import { lentList, takeUp, weaponImage } from "../helpers/lending.mjs";
import { noteMove } from "../helpers/movement.mjs";
import { trapsShown, walkWay } from "../helpers/reactions.mjs";
import { mayGuards, sureGuard } from "../helpers/stances.mjs";
import {
  dropUnit, dropsOf, giveUnit, givesOf, passengerOf, rescueUnit, rescuesOf, riderOf, takeUnit, takesOf
} from "../helpers/rescue.mjs";
import { refreshCount, refreshOf, refreshOptionsOf, refreshUnits, refreshesOf, sings } from "../helpers/refresh.mjs";
import { paintShown, showPaint } from "../helpers/paint.mjs";
import {
  END_PHASE_QUERY, battle, beginBattle, clearBattle, endBattle, endPhaseQuery, fieldOf, foughtHere, inOwnTurn, originOf,
  phaseBegunBy, phaseOf, requestEndPhase, sidesOf, takeAction, turnState, unitsOf
} from "../helpers/phases.mjs";
import { layTilesOf, layTrapItem, trapItemOf, warpTilesFor } from "../helpers/traps.mjs";
import { staffAreaOf, staffMarksOf, staffObjectsOf, staffPlanOf, staffTakesOf, staffTargetsOf, staffTilesOf, staffWhy } from "../helpers/staves.mjs";
import { DEPLOY_ZONE, hasGround, registerGround, tileGround } from "../helpers/terrain.mjs";
import { buildWeather, pickWeather, registerWeather } from "../helpers/weather.mjs";
import { buildMapAffinity, pickMapAffinity, registerMapAffinity } from "../helpers/map-affinity.mjs";
import { staffWarpAllows, staffWarpOf, staffWarpTilesOf, warpToken } from "../helpers/warp.mjs";
import { actModes, actOf, maneuverAt } from "../rules/actions.mjs";
import { sharesCost, sharesTotal } from "../rules/areas.mjs";
import { BONUS_STATS, bonusesOf } from "../rules/choices.mjs";
import { parseRange, planFormations, spreadForecast } from "../rules/combat.mjs";
import { burdened } from "../rules/rescue.mjs";
import { listedSides } from "../rules/phases.mjs";
import { tileKey, tilesApart, wayBetween } from "../rules/reach.mjs";
import { canUse } from "../rules/skill-usage.mjs";
import { passCost } from "../rules/terrain.mjs";
import { staffWarpChosen, warpOf } from "../rules/warp.mjs";
import UnitSheet from "../sheets/unit-sheet.mjs";
import {
  buildDock, buildHover, buildHudForecast, buildPalette, buildPhase, buildSplash, buildTerrain, placeForecast
} from "./battle-hud-context.mjs";
import { clearSplash, playSplash } from "./phase-splash.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${FEO.id}/templates/hud`;

/** The actions of the unit sheet that the dock may ask for by name, each for the selected unit. */
const SHEET_ACTIONS = ["wait", "startTurn", "endTurn", "spendRound", "toggleEquip", "useItem", "useSkill", "switchSkill", "switchAffinity", "guardStance", "toggleForm", "readyArt", "useGambit", "postItem"];

/** Those of Capturing, asked for in the same way: readying an attempt, picking up and releasing a captive. */
const CAPTURE_ACTIONS = ["toggleCapture", "pickUpCaptive", "releaseCaptive"];

/** How long the pointer rests on a tile before the terrain card says more of it, in milliseconds. */
const REST_TIME = 700;

/** The same for whoever is looking at the ground, who is there to read what each tile does. */
const SURVEY_REST_TIME = 200;

/**
 * The Battle HUD: what a player sees and does on the battle map without opening a sheet. A banner says whose
 * Phase it is and who has yet to act; a dock shows the selected unit with its actions; a card names the tile
 * under the pointer; another the unit under it; and an attack started from the map is forecast in a panel of
 * its own. Where the selected unit can go and what it can strike is painted on the grid.
 *
 * The HUD keeps nothing of its own but what the user is in the middle of: which list is open, which unit is
 * being targeted. What it shows is worked out by `battle-hud-context.mjs`; where units can go by
 * `helpers/battle-map.mjs`; and whatever a button does is done by the helpers the unit sheet uses, so that the
 * sheet and the map can never disagree.
 */
export default class BattleHud extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-battle-hud",
    classes: ["feo", "feo-hud"],
    tag: "div",
    window: { frame: false, positioned: false },
    actions: {
      pick: BattleHud.#onPick,
      brush: BattleHud.#onBrush,
      brushShow: BattleHud.#onBrushShow,
      endPhase: BattleHud.#onEndPhase,
      beginBattle: BattleHud.#onBeginBattle,
      endBattle: BattleHud.#onEndBattle,
      weather: BattleHud.#onWeather,
      mapAffinity: BattleHud.#onMapAffinity,
      attack: BattleHud.#onAttack,
      staff: BattleHud.#onFlyout,
      skill: BattleHud.#onFlyout,
      item: BattleHud.#onFlyout,
      equip: BattleHud.#onFlyout,
      lendWeapon: BattleHud.#onLendWeapon,
      sheet: BattleHud.#onSheet,
      undo: BattleHud.#onUndo,
      pickStaff: BattleHud.#onPickStaff,
      pickWarp: BattleHud.#onPickWarp,
      pickAct: BattleHud.#onPickAct,
      revertImitation: BattleHud.#onRevertImitation,
      shove: BattleHud.#onShove,
      steal: BattleHud.#onSteal,
      trade: BattleHud.#onTrade,
      shift: BattleHud.#onShift,
      object: BattleHud.#onObject,
      rescue: BattleHud.#onRescue,
      refresh: BattleHud.#onRefresh,
      pickRefresh: BattleHud.#onPickRefresh,
      sing: BattleHud.#onSing,
      choose: BattleHud.#onChoose,
      forecastSkill: BattleHud.#onForecastSkill,
      forecastStep: BattleHud.#onForecastStep,
      forecastStat: BattleHud.#onForecastStat,
      breakFree: BattleHud.#onBreakFree,
      pass: BattleHud.#onPass,
      confirm: BattleHud.#onConfirm,
      confirmArea: BattleHud.#onConfirmArea,
      cancel: BattleHud.#onCancel,
      ...Object.fromEntries([...SHEET_ACTIONS, ...CAPTURE_ACTIONS].map((name) => [name, BattleHud.#onSheetAction]))
    }
  };

  /** @override */
  static PARTS = {
    phase: { template: `${TEMPLATES}/phase.hbs` },
    terrain: { template: `${TEMPLATES}/terrain.hbs` },
    dock: { template: `${TEMPLATES}/dock.hbs` },
    hover: { template: `${TEMPLATES}/hover.hbs` },
    forecast: { template: `${TEMPLATES}/forecast.hbs` },
    palette: { template: `${TEMPLATES}/palette.hbs` }
  };

  /* -------------------------------------------- */

  /**
   * The one HUD of this client.
   * @type {BattleHud|null}
   */
  static #instance = null;

  /** The selected unit's token: the one token under control, if it is a unit's. @type {Token|null} */
  #token = null;

  /** Where the selected unit can go and what it can strike. @type {import("../helpers/battle-map.mjs").TokenReach|null} */
  #view = null;

  /** The tile under the pointer. @type {{i: number, j: number}|null} */
  #hoverTile = null;

  /** Has the pointer rested on the tile under it long enough for the terrain card to say more of it? */
  #rested = false;

  /** The wait for the pointer to rest on a tile. @type {number|null} */
  #resting = null;

  /** The token under the pointer. @type {Token|null} */
  #hoverToken = null;

  /**
   * Was the token under the pointer found by the tile it stands on, as it is behind the Fire Emblem controls,
   * where the tokens do not hear the pointer themselves?
   */
  #found = false;

  /** The list that is open above the dock: equip, staff, skill or item. @type {string|null} */
  #flyout = null;

  /**
   * What the next click on the map means: `target` for an attack on a token, `staff` for the staff picked, `warp`
   * for a tile to warp to, `shove` for a unit next to the selected one to Shove, `rescue` for an ally next to
   * it to pick up or to take a passenger from, `drop` for a tile to set its passenger down on or an ally to
   * hand it to, `refresh` for an ally to Refresh, `act` for the unit a skill used as an action is used on, and
   * then the tile it asks for.
   * @type {string|null}
   */
  #mode = null;

  /**
   * The Refresh being used: the way it is used, where that is not the regular one, and the allies picked for
   * it so far, where it is used on several.
   * @type {{option: string, picked: Token[]}|null}
   */
  #refresh = null;

  /**
   * A choice a skill leaves the owner of its unit, offered as a short list above the dock until one is picked
   * or it is passed: what is asked, what answers it, and the wait that passes it by itself.
   * @type {{ask: {token: TokenDocument, skill: string, options: {id: string, label: string, hint?: string}[]},
   *   resolve: Function, timer: number}|null}
   */
  #choice = null;

  /**
   * The skill being used on a unit picked on the map: the skill, and its target once that is picked and the
   * skill still asks for a tile. For a skill that takes in an area (`area`), the area is painted where it
   * would lie until a click places or confirms it; `shares` is what a skill that shares HP out gives each unit
   * so far.
   * @type {{skill: string, target: Token|null, area?: boolean, shares?: object|null}|null}
   */
  #act = null;

  /**
   * A step a skill says its unit "may" take, offered on the map until a tile or a unit of it is picked, or it
   * is passed: the offer, what answers it, and the wait that passes it by itself.
   * @type {{offer: import("../helpers/forced.mjs").StepOffer, resolve: Function, timer: number}|null}
   */
  #offer = null;

  /** The staff picked from the list, waiting for a unit to use it on. @type {string|null} */
  #staff = null;

  /**
   * What warps a unit, waiting for a tile to warp it to: a skill of the selected unit, which warps that unit, or
   * one of its staves, which warps the ally it was used on or, with no target, the unit itself.
   * @type {{skill: string}|{staff: string, target: Token|null}|null}
   */
  #warp = null;

  /**
   * The item that traps a space, waiting for the tile to lay it on, and once that is picked, for one that
   * warps, for the tile it sends a unit to.
   * @type {{item: string, at: {i: number, j: number}|null}|null}
   */
  #lay = null;

  /**
   * The attack being forecast: its target, the tile to make it from and the plan of the exchange.
   * @type {{target: Token, from: object, moves: boolean, plan: object, measured: number|null}|null}
   */
  #forecast = null;

  /**
   * Where the forecast was last set on the screen, and what that was worked out for, so that it stays put while
   * the pointer tries the tiles the attack could be made from.
   * @type {{key: string, style: string}|null}
   */
  #forecastSpot = null;

  /** Is something being done that must finish before the next click counts? */
  #busy = false;

  /* -------------------------------------------- */
  /*  Setting Up                                  */
  /* -------------------------------------------- */

  /**
   * Put the HUD on the battle map: the canvas reports clicks and the pointer to it, and it follows whatever
   * changes the units, the ground or the battle.
   */
  static register() {
    registerBattleCanvas();
    registerMapLayer();
    CONFIG.queries[END_PHASE_QUERY] = endPhaseQuery;
    const hud = () => BattleHud.#instance;
    const refresh = foundry.utils.debounce(() => hud()?.refresh(), 30);
    mapTools.listener = () => {
      hud()?.#onSurvey();
      refresh();
    };
    game.feo.hud = {
      app: BattleHud, refresh, beginBattle, endBattle, endPhase: requestEndPhase,
      pickWarp: (token, item) => BattleHud.#pickWarp(token, item),
      pickStaffWarp: (token, item, ally) => BattleHud.#pickStaffWarp(token, item, ally),
      pickStaff: (token, item) => BattleHud.#pickStaff(token, item),
      pickAct: (token, item) => BattleHud.#pickAct(token, item),
      pickTrap: (token, item) => BattleHud.#pickTrap(token, item),
      pickAttack: (token, target) => BattleHud.#pickAttack(token, target),
      ask: (offer) => BattleHud.#ask(offer),
      choose: (ask) => BattleHud.#choose(ask)
    };

    battleCanvas.listener = {
      wantsToken: (token, event) => !!hud()?.#wantsToken(token, event),
      onTokenClick: (token, event) => hud()?.#onTokenClick(token, event),
      onTileClick: (tile, event) => !!hud()?.#onTileClick(tile, event),
      onTileHover: (tile) => hud()?.#onTileHover(tile),
      onGroundRightClick: () => !!hud()?.#onGroundRightClick()
    };

    // The HUD is drawn with the canvas, on maps with a square grid
    Hooks.on("canvasReady", () => {
      const app = BattleHud.#instance ??= new BattleHud();
      app.#reset();
      if ( canvas.scene?.grid?.isSquare ) app.refresh();
      else if ( app.rendered ) app.close();
    });
    Hooks.on("canvasTearDown", () => hud()?.#reset());

    // Whatever changes a unit, where it stands, the ground or the battle is shown at once. So is what the
    // units around a unit, or how it moved, make of its numbers, which is worked out a moment later
    registerGround(refresh);
    registerObjects(refresh);
    registerWeather(refresh);
    registerMapAffinity(refresh);
    Hooks.on(`${FEO.id}.standingChanged`, refresh);
    for ( const hook of [
      "controlToken", "targetToken", "createToken", "updateToken", "deleteToken", "createItem", "updateItem", "deleteItem",
      "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createCombat", "deleteCombat",
      "createCombatant", "deleteCombatant"
    ] ) Hooks.on(hook, refresh);
    Hooks.on("updateActor", (actor, changes) => {
      if ( changes.flags?.[FEO.id] ) battleCanvas.refreshTokens(actor);
      refresh();
    });
    Hooks.on("updateCombat", () => {
      battleCanvas.refreshTokens();
      refresh();
    });
    Hooks.on("hoverToken", (token, hovered) => hud()?.#onTokenHover(hovered ? token : null));

    // A Phase is announced as it begins, and a battle as it ends, on every client alike: each hears of the
    // change to the encounter itself, whoever made it. A client that loads into a battle hears of none
    Hooks.on("updateCombat", (combat, changes, options) => {
      const begun = (battle() === combat) ? phaseBegunBy(combat, changes, options) : null;
      if ( begun ) BattleHud.#announce(begun);
    });
    Hooks.on("deleteCombat", (combat) => {

      // What the battle left on its units goes with it, however it was ended
      clearBattle(combat).catch((err) => console.error(err));
      battleCanvas.refreshTokens();
      try {
        if ( foughtHere(combat) && unitsOf(combat).length && !battle() ) BattleHud.#announce({ round: combat.round });
      } catch(err) {
        console.error(err);
      }
    });
    Hooks.on("canvasTearDown", clearSplash);

    // In a battle a token remembers where its unit's turn began, however it is moved, so that the move can
    // be taken back and counts against its movement; for a unit that moves again after its Action, where it
    // stood as it acted. A unit that a skill warps has not moved
    Hooks.on("preUpdateToken", (token, changes, options, userId) => {
      try {
        if ( (userId !== game.user.id) || !(("x" in changes) || ("y" in changes)) || originOf(token) ) return;
        const mine = options?.[FEO.id];
        if ( mine?.undo || mine?.warp || mine?.forced || !inOwnTurn(token.actor, token) ) return;
        // The place the token was last saved at: the one it is drawn at may lag behind
        const { x, y } = token._source ?? token;
        foundry.utils.setProperty(changes, `flags.${FEO.id}.origin`, { x, y });
      } catch(err) {
        console.error(err);
      }
    });

    // What such a move comes to is noted on the token, as a move made by a click is: the spaces moved and
    // the movement they took, for the skills that ask
    Hooks.on("updateToken", (token, changes, options, userId) => {
      try {
        if ( (userId !== game.user.id) || !(("x" in changes) || ("y" in changes)) ) return;
        const mine = options?.[FEO.id];
        if ( mine?.click || mine?.undo || mine?.warp || mine?.forced || !inOwnTurn(token.actor, token) ) return;
        const view = reachOf(token);
        if ( view ) noteMove(token, (view.moved || view.again || view.go?.base) ? walkOf(view, view.standing) : null).catch((err) => console.error(err));
      } catch(err) {
        console.error(err);
      }
    });

    // In a battle a unit is moved by a click on a tile of its reach and by nothing else, so a move made with
    // the keys, or by dragging it along with other tokens, is not made at all. A Game Master who has lifted the
    // limits on movement puts any unit where they please
    Hooks.on("preMoveToken", (token, move) => {
      try {
        if ( (move.method !== "dragging") && (move.method !== "keyboard") ) return;
        if ( game.user.isGM && game.settings.get("core", "unconstrainedMovement") ) return;
        const grid = token.parent?.grid;
        if ( (token.actor?.type !== "unit") || !grid?.isSquare ) return;
        if ( movedByClick(token) ) return false;

        // Until a battle begins a player sets their units up inside the deployment zone: one that stands in
        // it goes to another of its tiles and nowhere else. The Game Master puts a unit where they please
        if ( !game.user.isGM && move.destination && !battle() ) {
          const from = tokenTile(token);
          const to = grid.getOffset({ x: move.destination.x + (grid.sizeX / 2), y: move.destination.y + (grid.sizeY / 2) });
          const leaves = from && (tileGround(token.parent, from).zone === DEPLOY_ZONE)
            && (tileGround(token.parent, to).zone !== DEPLOY_ZONE);
          if ( leaves ) {
            ui.notifications.warn(game.i18n.format("FEO.Zone.deploy.held", { name: token.name || token.actor.name }));
            return false;
          }
        }

        // Out of a battle a unit is dragged as any token is. Foundry cuts its path short where the ground
        // cannot be crossed, which would leave it standing between two tiles: it stays where it was instead
        const last = (move.pending?.waypoints?.length ? move.pending.waypoints : move.passed?.waypoints)?.at(-1) ?? null;
        const end = last ?? move.destination;
        if ( !end || (last?.explicit !== false) ) return;
        const corner = grid.getTopLeftPoint(grid.getOffset({ x: end.x + (grid.sizeX / 2), y: end.y + (grid.sizeY / 2) }));
        if ( (Math.abs(corner.x - end.x) < 1) && (Math.abs(corner.y - end.y) < 1) ) return;
        ui.notifications.warn(game.i18n.format("FEO.Hud.cannotCross", { name: token.name || token.actor.name }));
        return false;
      } catch(err) {
        console.error(err);
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Play the splash of a Phase that begins, or of a battle that is over.
   * @param {object} event
   * @param {string|null} [event.army]    The side whose Phase begins; none when the battle is over
   * @param {number} event.round          The turn of the battle
   */
  static #announce(event) {
    try {
      playSplash(buildSplash(event, game.i18n));
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /** Forget whatever the user was in the middle of, as when the scene changes. */
  #reset() {
    this.#token = null;
    this.#view = null;
    this.#hoverTile = null;
    this.#hoverToken = null;
    this.#found = false;
    this.#rest(false);
    this.#clear();
    this.#settle(null, { quiet: true });
    this.#answer(null, { quiet: true });
  }

  /* -------------------------------------------- */

  /** Close the open list and call off whatever was being picked or forecast. */
  #clear() {
    this.#flyout = null;
    this.#mode = null;
    this.#staff = null;
    this.#warp = null;
    this.#lay = null;
    this.#act = null;
    this.#refresh = null;
    this.#forecast = null;
  }

  /* -------------------------------------------- */
  /*  Reading the Map                             */
  /* -------------------------------------------- */

  /**
   * Where the selected unit stands in the turn order.
   * @type {"free"|"ready"|"acted"|"down"|"waiting"|null}
   */
  get #state() {
    return this.#token ? turnState(this.#token.actor, this.#token.document) : null;
  }

  /* -------------------------------------------- */

  /**
   * May the user move the selected unit and have it act now?
   * @type {boolean}
   */
  get #acting() {
    const state = this.#state;
    return !!this.#token?.document.isOwner && ((state === "ready") || (state === "free"));
  }

  /* -------------------------------------------- */

  /**
   * May the user move the selected unit once more, now that it has taken its Action, as Canto lets it? It
   * moves or Waits, and does nothing else.
   * @type {boolean}
   */
  get #moving() {
    return !!this.#token?.document.isOwner && (this.#state === "moving");
  }

  /* -------------------------------------------- */

  /**
   * Is the map still being set up: has no battle begun on it, and was the selected unit not told to attack?
   * Its reach is then neither painted nor walked by a click, so that units are put where they should stand,
   * in the deployment zone or anywhere else, with nothing in the way.
   * @type {boolean}
   */
  get #settingUp() {
    return !battle() && (this.#mode !== "target") && !this.#forecast;
  }

  /* -------------------------------------------- */

  /**
   * Read the map again: who is selected, where that unit can go, and whether what the user was in the middle
   * of still stands.
   */
  #sync() {
    const controlled = canvas.tokens?.controlled ?? [];
    const token = ((controlled.length === 1) && (controlled[0].actor?.type === "unit")) ? controlled[0] : null;
    if ( token !== this.#token ) this.#clear();
    this.#token = token;
    this.#view = token ? reachOf(token.document) : null;
    if ( this.#hoverToken?.destroyed ) this.#hoverToken = null;

    // A step that was offered to a unit is passed once another unit is selected, or none
    if ( this.#offer && (token?.document !== this.#offer.offer.token) ) this.#settle(null, { quiet: true });
    if ( this.#choice && (token?.document !== this.#choice.ask.token) ) this.#answer(null, { quiet: true });
    if ( !this.#acting ) {
      this.#mode = null;
      this.#staff = null;
      this.#warp = null;
      this.#act = null;
      this.#refresh = null;
      this.#forecast = null;
    }

    // An ally picked for a Refresh that is gone from the map is picked no longer
    if ( this.#refresh ) this.#refresh.picked = this.#refresh.picked.filter((picked) => !picked.destroyed);

    // An attack being forecast is planned again from the units as they are now, from the tile chosen for it
    const forecast = this.#forecast;
    if ( forecast ) this.#forecast = forecast.target.destroyed ? null : this.#planForecast(forecast.target, forecast.pick);
  }

  /* -------------------------------------------- */

  /**
   * Paint the grid: where the selected unit can go and strike, the threat of a unit that is not acting, and
   * the way a unit would be shoved or carried by a skill.
   */
  #paint() {
    const view = this.#view;
    const paint = { move: [], strike: [], staff: [], warp: [], threat: new Set(), area: [], path: [], marks: [], traps: [] };

    // The traps this user knows of lie on their tiles, whoever is selected
    try {
      paint.traps = trapsShown(canvas.scene);
    } catch(err) {
      console.error(err);
    }

    // So do the doors, chests and Villages of the scene
    try {
      paint.objects = objectsShown(canvas.scene);
    } catch(err) {
      console.error(err);
    }

    // While a step is offered, nothing but its tiles and units is shown: the tiles like those of a warp, the
    // units like those a staff reaches
    if ( this.#offer ) {
      for ( const tile of this.#offer.offer.tiles ?? [] ) paint.warp.push(tileKey(tile));
      for ( const unit of this.#offer.offer.units ?? [] ) {
        const there = tokenTile(unit);
        if ( there ) paint.staff.push(tileKey(there));
      }
    }

    // While a unit to Shove is being chosen: the units it may shove, and for the one under the pointer the
    // way it would slide
    else if ( view && this.#acting && (this.#mode === "shove") ) {
      const hovered = this.#hoverToken?.document ?? null;
      for ( const { target, tried } of shovesOf(this.#token.document) ) {
        const from = tokenTile(target);
        if ( !tried.ok || !from ) continue;
        paint.staff.push(tileKey(from));
        if ( target === hovered ) paint.path = [{ i: from.i, j: from.j }, ...tried.way];
      }
    }

    // While an enemy to Steal from is being chosen: those next to the unit that it may steal from
    else if ( view && this.#acting && (this.#mode === "steal") ) {
      for ( const { target, tried } of stealsOf(this.#token.document) ) {
        const there = tokenTile(target);
        if ( tried.ok && there ) paint.staff.push(tileKey(there));
      }
    }

    // While an ally to Trade with is being chosen: those next to the unit that it may trade with
    else if ( view && this.#acting && (this.#mode === "trade") ) {
      for ( const { target, tried } of tradesOf(this.#token.document) ) {
        const there = tokenTile(target);
        if ( tried.ok && there ) paint.staff.push(tileKey(there));
      }
    }

    // While a door, a chest or a Village is being chosen: those it can act on from where it stands, each with
    // what it would do there
    else if ( view && this.#acting && (this.#mode === "object") ) {
      for ( const act of objectActsOf(this.#token.document) ) {
        const tile = { i: act.object.i, j: act.object.j };
        paint.staff.push(tileKey(tile));
        paint.marks.push({
          tile,
          text: (act.act === "break") ? `−${act.damage}` : game.i18n.localize(`FEO.Objects.mark.${act.act}`),
          tone: ["break", "pillage"].includes(act.act) ? "bad" : "good"
        });
      }
    }

    // While an ally to Rescue is being chosen: those it may pick up, and those whose passenger it may take
    else if ( view && this.#acting && (this.#mode === "rescue") ) {
      for ( const target of [...rescuesOf(this.#token.document), ...takesOf(this.#token.document)] ) {
        const there = tokenTile(target);
        if ( there ) paint.staff.push(tileKey(there));
      }
    }

    // While it chooses what to do with the ally it carries: the tiles to Drop it on, and the allies to Give
    // it to
    else if ( view && this.#acting && (this.#mode === "drop") ) {
      for ( const tile of dropsOf(this.#token.document) ) paint.warp.push(tileKey(tile));
      for ( const target of givesOf(this.#token.document) ) {
        const there = tokenTile(target);
        if ( there ) paint.staff.push(tileKey(there));
      }
    }

    // While an ally to Refresh is being chosen: those it may be used on, in violet where the reach it would
    // be used by leaves out what some of its songs lay over it, and a note over each ally picked so far
    else if ( view && this.#acting && (this.#mode === "refresh") ) {
      for ( const { token: target, bare } of refreshesOf(this.#token.document, { option: this.#refreshOption() }) ) {
        const there = tokenTile(target);
        if ( there ) (bare ? paint.warp : paint.staff).push(tileKey(there));
      }
      for ( const picked of this.#refresh?.picked ?? [] ) {
        const there = tokenTile(picked.document);
        if ( there ) paint.marks.push({ tile: { i: there.i, j: there.j }, text: "\u266a" });
      }
    }

    // While a skill that takes in an area is being used: the area where it would lie, and what each unit in
    // it would get
    else if ( view && this.#acting && (this.#mode === "act") && this.#act?.area ) this.#paintArea(paint);

    // While a skill is being used on a unit: the units it may be used on, and once one is picked, the tiles
    else if ( view && this.#acting && (this.#mode === "act") ) {
      const picked = this.#act?.target ?? null;
      if ( !picked ) for ( const target of this.#actTargets() ) paint.staff.push(tileKey(tokenTile(target.document)));
      else {
        const tiles = this.#actTiles();
        const own = tileKey(tokenTile(picked.document));
        for ( const key of tiles ) (key === own ? paint.staff : paint.warp).push(key);
      }
    }

    // While a tile to warp to is being chosen, nothing but those tiles is shown
    else if ( view && this.#acting && (this.#mode === "warp") ) paint.warp.push(...this.#warpTiles());

    // While a mine or a trap is being laid: the tiles it may be laid on, and for one that warps, once it has
    // its tile, the tiles it may send a unit to
    else if ( view && this.#acting && (this.#mode === "lay") ) {
      for ( const tile of this.#layTiles() ) paint.warp.push(tileKey(tile));
      if ( this.#lay?.at ) paint.marks.push({ tile: this.#lay.at, text: "\u2715", tone: "good" });
    }

    // While a staff waits for what it is used on: how far it reaches, and over each unit it may be used on
    // what it would do there. One for several units shows all it catches at once
    else if ( view && this.#acting && (this.#mode === "staff") ) this.#paintStaff(paint);

    // Where the unit can go and what it can strike from there, once a battle has begun on the map
    else if ( view && (this.#acting || this.#moving) && !this.#settingUp ) {
      const strikes = view.range?.staff ? paint.staff : paint.strike;
      for ( const key of view.reach.stops ) if ( !(view.moved && view.strikes.has(key)) ) paint.move.push(key);
      for ( const key of view.strikes ) if ( view.moved || !view.reach.stops.has(key) ) strikes.push(key);

      // Where a move would end: the tile an attack would be made from, or the tile under the pointer. No line
      // is drawn to it; what the move would do to the units along its way is shown over each of them before
      // it is made
      const hover = this.#hoverTile;
      const goal = this.#forecast?.moves ? this.#forecast.from.tile
        : (hover && view.reach.stops.has(tileKey(hover)) && !this.#forecast) ? hover
        : null;
      if ( goal && !view.fixed ) paint.marks = this.#harmMarks(goal);

      // And the further units the attack being forecast would strike, as a skill has it reach more tiles than
      // the one of its target: their tiles as an area, with the damage and the Hit of the attack on each
      if ( this.#forecast ) {
        const struck = this.#strikeMarks();
        for ( const mark of struck ) paint.area.push(tileKey(mark.tile));
        if ( struck.length ) paint.marks = [...(paint.marks ?? []), ...struck];

        // The allies the unit attacks in formation with are marked where they stand
        const allies = this.#formationMarks();
        if ( allies.length ) paint.marks = [...(paint.marks ?? []), ...allies];
      }
    } else if ( view && (this.#state === "waiting") ) {
      for ( const key of threatOf(this.#token.document) ) paint.threat.add(key);
    }

    // A foe under the pointer shows everything it could strike on its next turn
    const hovered = this.#hoverToken;
    if ( view && hovered && (hovered !== this.#token) && !this.#forecast && (hovered.actor?.type === "unit") ) {
      const foe = standsTo(view.unit, { army: armyOf(hovered.actor, hovered.document) }) === "foe";
      if ( foe && !hovered.actor.system.defeat?.state ) {
        for ( const key of threatOf(hovered.document) ) paint.threat.add(key);
      }
    }
    battleCanvas.draw(paint);
  }

  /* -------------------------------------------- */

  /**
   * Paint the staff that was picked: the tiles it reaches from where its unit stands, and over each unit it
   * may be used on the HP it would restore, the chance it has to hit, or a tick. A staff for several units
   * shows its reach as an area with every unit it catches, and one that opens doors and chests marks those.
   * @param {object} paint      What is painted, filled in here
   */
  #paintStaff(paint) {
    const token = this.#token;
    const item = token.actor.items.get(this.#staff);
    if ( !item ) return;
    try {
      const plan = staffPlanOf(token.actor, item);
      const area = staffAreaOf(token.document, item);
      if ( area ) {
        const covered = new Set(area.tiles);
        for ( const unit of area.units ) covered.add(tileKey(tokenTile(unit)));
        paint.area.push(...covered);
        paint.marks = staffMarksOf(token.document, item, area.units);
        return;
      }
      paint.staff.push(...staffTilesOf(token.document, item, plan));
      if ( plan.on === "object" ) {
        for ( const object of staffObjectsOf(token.document, item) ) {
          paint.marks.push({ tile: { i: object.i, j: object.j }, text: game.i18n.localize("FEO.Objects.mark.open"), tone: "good" });
        }
        return;
      }
      paint.marks = staffMarksOf(token.document, item, staffTargetsOf(token.document, item));
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * The area of the skill being used, as it lies now: around the unit itself, or where the pointer has it.
   * @returns {import("../helpers/areas.mjs").AreaView|null}
   */
  #areaNow() {
    const token = this.#token;
    const item = token?.actor.items.get(this.#act?.skill);
    if ( !item || !this.#act?.area ) return null;
    try {
      return areaView(token.document, item, this.#hoverTile);
    } catch(err) {
      console.error(err);
      return null;
    }
  }

  /* -------------------------------------------- */

  /**
   * Paint the area of the skill being used: the tiles it may be centred on in violet, the tiles it covers
   * where it lies in amber, over each unit it catches what that unit would get, and for a unit that moves
   * through a line the way it goes. A skill that shares HP out shows the units it may give to in green.
   * @param {object} paint      What is painted, filled in here
   */
  #paintArea(paint) {
    const token = this.#token;
    const item = token.actor.items.get(this.#act.skill);
    const lies = this.#areaNow();
    if ( !lies || !item ) return;
    const covered = new Set();
    if ( lies.placed ) {
      const tiles = lies.tiles ?? lies.units.map((unit) => tokenTile(unit)).filter(Boolean);
      for ( const tile of tiles ) covered.add(tileKey(tile));
      paint.marks = areaMarks(token.document, item, lies, this.#act.shares ?? null);
      if ( lies.land ) paint.path = [lies.origin, ...(lies.tiles ?? []), lies.land];
    }
    for ( const tile of lies.centres ?? [] ) if ( !covered.has(tileKey(tile)) ) paint.warp.push(tileKey(tile));
    if ( lies.act.shares ) {
      for ( const unit of sharersOf(lies) ) {
        const key = tileKey(tokenTile(unit));
        covered.delete(key);
        paint.staff.push(key);
      }
    }
    paint.area.push(...covered);
  }

  /* -------------------------------------------- */

  /**
   * What the map shows over the allies the attack being forecast is made in formation with (see
   * `planFormations` in `rules/combat.mjs`): a triangle over each.
   * @returns {{tile: {i: number, j: number}, text: string, tone: string}[]}
   */
  #formationMarks() {
    try {
      const formations = planFormations(this.#forecast?.plan).filter((entry) => entry.by === "initiator");
      return formations.flatMap((entry) => entry.partners).filter((unit) => unit.tile)
        .map((unit) => ({ tile: { i: unit.tile.i, j: unit.tile.j }, text: "\u25b2", tone: "good" }));
    } catch(err) {
      console.error(err);
      return [];
    }
  }

  /* -------------------------------------------- */

  /** The marks last worked out for the attack being forecast, so that they are not planned again as the pointer moves. */
  #struck = { key: "", marks: [] };

  /**
   * What the map shows over the further units the attack being forecast would strike, where a skill of the
   * unit has it attack more units than its target (see `spread` in `rules/spread.mjs`): the damage and the Hit
   * of the attack on each.
   * @returns {{tile: {i: number, j: number}, text: string, tone: string}[]}
   */
  #strikeMarks() {
    const forecast = this.#forecast;
    const token = this.#token;
    if ( !forecast?.plan || !token ) return [];
    try {
      const reached = spreadForecast(forecast.plan).filter((entry) => (entry.by === "initiator") && entry.units.some((unit) => unit.attack));
      if ( !reached.length ) return [];
      const scene = token.document.parent;
      const key = JSON.stringify([
        token.id, forecast.target.id, forecast.from?.tile ?? null, forecast.plan.initiator.unit.weapon?.name ?? "",
        reached.map((entry) => [entry.skill, entry.units.map((unit) => [unit.id, scene.tokens.get(unit.id)?.actor?.system.hp.value ?? 0])])
      ]);
      if ( this.#struck.key === key ) return this.#struck.marks;
      const marks = [];
      for ( const entry of reached ) {
        for ( const share of entry.units ) {
          const other = scene.tokens.get(share.id);
          const tile = other ? tokenTile(other) : null;
          if ( !share.attack || !tile || !other.object ) continue;
          const matchup = planAttack(token.actor, token.document, other.object, {
            from: forecast.moves ? forecast.from.tile : null,
            extra: { skill: entry.skill, hit: share.attack.hit ?? 0, share: share.attack.share ?? 1, free: true }
          });
          if ( matchup.warning ) continue;
          const side = matchup.makePlan(matchup.measured ?? matchup.distance).initiator;
          if ( side.blocked ) continue;
          const blow = side.blows?.[0] ?? side;
          marks.push({ tile: { i: tile.i, j: tile.j }, text: ((blow.hit ?? 100) >= 100) ? `${blow.damage ?? 0}` : `${blow.damage ?? 0}\n${blow.hit ?? 0}%`, tone: "bad" });
        }
      }
      this.#struck = { key, marks };
      return marks;
    } catch(err) {
      console.error(err);
      return [];
    }
  }

  /* -------------------------------------------- */

  /**
   * The HP a move to a tile would take off each unit along its way, to show over them: the enemies the unit
   * moves through or past, and the unit itself.
   * @param {{i: number, j: number}} goal
   * @returns {{tile: {i: number, j: number}, text: string}[]}
   */
  #harmMarks(goal) {
    const view = this.#view;
    const marks = [];
    try {
      const harm = harmOf(view, goal);
      for ( const [id, lost] of Object.entries(harm.shown) ) {
        const tile = id ? harm.units.get(id)?.tile : view.standing;
        if ( tile && (lost > 0) ) marks.push({ tile, text: `-${lost}` });
      }
    } catch(err) {
      console.error(err);
    }
    return marks;
  }

  /* -------------------------------------------- */

  /**
   * Read the map again, paint it, and draw the HUD.
   * @param {object} [options]
   * @param {string[]} [options.parts]    The parts to draw again; all of them unless given
   * @returns {Promise<void>}
   */
  async refresh({ parts } = {}) {
    try {
      if ( !canvas?.ready || !canvas.scene?.grid?.isSquare ) return;
      if ( !parts ) this.#sync();
      this.#paint();
      await this.render({ force: true, parts });
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const i18n = game.i18n;
    const safely = (build) => {
      try {
        return build();
      } catch(err) {
        console.error(err);
        return null;
      }
    };
    return {
      phase: safely(() => this.#phaseContext(i18n)),
      terrain: safely(() => this.#terrainContext(i18n)),
      dock: safely(() => this.#dockContext(i18n)),
      hover: safely(() => this.#hoverContext(i18n)),
      forecast: safely(() => this.#forecastContext(i18n)),
      palette: safely(() => {
        return mapTools.painting ? buildPalette({ brush: mapTools.brush, shown: paintShown(canvas.scene) }, i18n) : null;
      })
    };
  }

  /* -------------------------------------------- */

  /**
   * What a unit's token gives the cards that show it.
   * @param {Token} token
   * @returns {object}
   */
  #describe(token) {
    const actor = token.actor;
    const document = token.document;
    const tile = tokenTile(document);

    // The unit it carries, an ally it Rescued or a captive, and whether that slows it
    const riding = riderOf(actor);
    const rider = riding ? { ...riding, slowed: burdened(actor.system.carry, !riding.captive && !!actor.system.rescuing?.light) } : null;
    return {
      actor,
      rider,
      name: document.name || actor.name,
      img: document.texture?.src || actor.img,
      army: armyOf(actor, document),
      state: turnState(actor, document),
      ground: tile ? tileGround(document.parent, tile) : null,

      // The weapons its skills lend it, which are listed with those it carries (see `rules/lending.mjs`)
      lent: lentList(actor)
    };
  }

  /* -------------------------------------------- */

  /**
   * The Phase banner.
   * @param {Localizer} i18n
   * @returns {object}
   */
  #phaseContext(i18n) {
    const combat = battle();
    const fielded = combat ? 0 : fieldOf(canvas.scene).length;
    // A unit that is out of the fight is not on the roster, and a side with nobody left in it is not listed
    const fights = (unit) => unit.token && !unit.actor.system.defeat?.out && (!unit.token.hidden || game.user.isGM);
    const units = unitsOf(combat).filter(fights).map((unit) => ({
      id: unit.token.id,
      name: unit.token.name || unit.actor.name,
      img: unit.token.texture?.src || unit.actor.img,
      army: unit.army,
      state: turnState(unit.actor, unit.token),
      selected: unit.token === this.#token?.document
    }));
    // The weather of the map: an icon for each kind, and for the unit that is selected whether it is spared
    const picked = this.#token?.actor ?? null;
    const weather = buildWeather(canvas.scene, {
      gm: game.user.isGM,
      unit: picked ? { name: this.#token.document.name || picked.name, proof: !!picked.system.weather?.proof } : null
    }, i18n);

    // The Affinity of the map stands beside its weather: its icon, and for the unit that is selected whether
    // it is of that Affinity
    weather.affinity = buildMapAffinity(canvas.scene, {
      gm: game.user.isGM,
      unit: picked ? { name: this.#token.document.name || picked.name, affinity: picked.system.affinity ?? "" } : null
    }, i18n);
    weather.shown = weather.shown || weather.affinity.shown;
    weather.ambient = (weather.icons.length > 0) || !!weather.affinity.key;
    return {
      ...buildPhase({
        phase: phaseOf(combat),
        round: combat?.round ?? 0,
        sides: listedSides(phaseOf(combat), sidesOf(combat), FEO.phases),
        units,
        gm: game.user.isGM,
        canStart: game.user.isGM && !combat && (fielded > 0),
        fielded
      }, i18n),
      weather
    };
  }

  /* -------------------------------------------- */

  /**
   * The terrain card: the tile under the pointer, else the one the selected unit stands on.
   * @param {Localizer} i18n
   * @returns {object|null}
   */
  #terrainContext(i18n) {
    const view = this.#view;
    if ( !view && !this.#named ) return null;
    const hover = this.#hoverTile;
    const tile = hover ?? view?.standing ?? null;
    if ( !tile ) return null;
    const ground = tileGround(canvas.scene, tile);
    let unit = null;
    if ( view && (this.#acting || this.#moving) ) {
      // What a space of it takes the unit: to cross it, or only to pass through where a skill lets it
      const pass = passCost(ground.terrain, view.mover);
      unit = {
        name: this.#token.document.name || this.#token.actor.name,
        here: (tile.i === view.standing.i) && (tile.j === view.standing.j),
        step: pass.cost,
        through: !pass.stop && Number.isFinite(pass.cost),
        rise: ground.elevation - view.ground(view.standing).elevation
      };
    }

    // A mine or a trap this user knows of that lies on the tile is named
    let lies = null;
    try {
      const found = trapsShown(canvas.scene).find((trap) => (trap.tile.i === tile.i) && (trap.tile.j === tile.j));
      if ( found ) lies = { name: found.skill, icon: "burst", lines: [{ icon: "burst", text: i18n.localize(`FEO.Trap.kind.${found.kind}`) }] };
    } catch(err) {
      console.error(err);
    }

    // What stands on the tile, and what the selected unit could do with it
    let object = null;
    try {
      const found = objectOn(canvas.scene, tile);
      if ( found ) {
        const act = (view && this.#acting) ? objectActOn(this.#token.document, tile) : null;
        const state = found.kind === "door" ? (found.broken ? "broken" : found.open ? "open" : "shut")
          : found.kind === "chest" ? (found.open ? "opened" : "closed")
            : (found.destroyed ? "destroyed" : found.visited ? "visited" : "standing");
        object = {
          name: objectName(found),
          icon: FEO.objects.kinds[found.kind].icon,
          lines: [
            { icon: FEO.objects.kinds[found.kind].icon, text: i18n.format(`FEO.Objects.state.${state}`, { hp: found.hp.value, max: found.hp.max }) },
            ...((act && !isSpent(found)) ? [{ icon: act.ok ? "hand" : "lock", cls: act.ok ? "good" : "", text: describeAct(act) }] : [])
          ]
        };
      }
    } catch(err) {
      console.error(err);
    }
    return buildTerrain({ ...ground, rested: !!hover && this.#rested, unit, object: object ?? lies }, i18n);
  }

  /* -------------------------------------------- */

  /**
   * The dock of the selected unit.
   * @param {Localizer} i18n
   * @returns {object|null}
   */
  #dockContext(i18n) {
    const token = this.#token;
    const view = this.#view;
    if ( !token ) return null;
    const acting = this.#acting;
    const armed = !!view?.range && !view.range.staff;
    const targets = acting && armed && !view.onlyWait && view.units.some((other) => {
      return (standsTo(view.unit, other) === "foe") && !!attackFrom(view, other.token);
    });
    // A unit that another has hold of, and the unit this one has hold of
    const holder = isGripped(token.actor) ? heldBy(token.document) : null;
    const held = gripOf(token.actor) ? holding(token.document) : null;
    const offered = this.#offer?.offer ?? null;
    const using = this.#act ? token.actor.items.get(this.#act.skill) : null;

    // A skill that takes in an area says how it is placed, and one that shares HP out what that comes to
    let area = null;
    if ( using && this.#act.area ) {
      const act = actFor(token.document, using);
      const shares = this.#act.shares ?? null;
      area = {
        kind: act?.shares ? "share" : (areaView(token.document, using)?.centred ?? "self"),
        cost: shares ? sharesCost(shares, act?.shares?.gives ?? 2) : 0,
        total: shares ? sharesTotal(shares) : 0
      };
    }

    // Rescue: for a unit that carries an ally, somewhere to set it down or someone to hand it to; for any
    // other, an ally to pick up or to take a passenger from
    const document = token.document;
    const lifts = acting && !view?.onlyWait && (passengerOf(token.actor)
      ? ((dropsOf(document).length > 0) || (givesOf(document).length > 0))
      : ((rescuesOf(document).length > 0) || (takesOf(document).length > 0)));

    // Refresh, for a unit that has the skill: the ways it may be used now, whether anybody is in reach for
    // any of them, and what has been picked so far
    let refresh = null;
    if ( sings(token.actor) ) {
      const ways = refreshOptionsOf(document).map((way) => ({ ...way, img: token.actor.items.get(way.item)?.img ?? "" }));
      const item = token.actor.items.find((entry) => {
        return (entry.type === "skill") && entry.system.equipped && (entry.system.effects ?? []).some((effect) => effect.refresh?.use);
      });
      const used = this.#refreshOption();
      refresh = {
        skill: item?.name ?? game.i18n.localize("FEO.Refresh.label"),
        img: item?.img ?? "",
        ways,
        open: acting && !view?.onlyWait && [null, ...ways].some((way) => refreshesOf(document, { option: way }).length > 0),
        way: used?.label ?? "",
        picked: this.#refresh?.picked.length ?? 0,
        most: (this.#mode === "refresh") ? Math.min(refreshCount(document), refreshesOf(document, { option: used }).length) : 1,
        all: !Number.isFinite(refreshCount(document))
      };
    }
    const asked = this.#choice?.ask ?? null;

    // Steal, for a unit that has the command; and Open, on a map with a door, a chest or a Village that
    // something can still be done with
    let steals = null;
    let objects = null;
    try {
      if ( token.actor.system.knacks?.steals ) {
        steals = { open: acting && !view?.onlyWait && stealsOf(document).some((entry) => entry.tried.ok) };
      }
      if ( objectsOn(document.parent).some((object) => !isSpent(object)) ) {
        objects = { open: acting && !view?.onlyWait && (objectActsOf(document).length > 0) };
      }
    } catch(err) {
      console.error(err);
    }
    return buildDock({
      ...this.#describe(token),
      lifts,
      trades: acting && tradesOf(document).some((entry) => entry.tried.ok),
      steals,
      objects,
      refresh,
      choice: asked ? { skill: asked.skill, hint: asked.hint ?? "", options: asked.options } : null,
      shoves: acting && !view?.onlyWait && shovesOf(token.document).some((entry) => entry.tried.ok),
      gripped: holder ? { by: holder.name || holder.actor?.name || "" } : null,
      grip: held ? { item: gripOf(token.actor).item, name: held.name || held.actor?.name || "" } : null,
      offer: offered ? { skill: offered.skill, hint: offered.hint ?? "" } : null,
      act: using ? { skill: using.name, tile: !!this.#act.target, area } : null,
      lay: (this.#mode === "lay") ? { item: token.actor.items.get(this.#lay?.item)?.name ?? "", warp: !!this.#lay?.at } : null,
      staff: (this.#mode === "staff") ? this.#staffStatus() : null,
      range: view?.range ?? null,
      movement: view?.movement ?? 0,
      spent: view?.spent ?? 0,
      moved: view?.moved ?? false,
      fixed: view?.fixed ?? false,
      onlyWait: view?.onlyWait ?? false,
      mustAttack: !!view?.mustAttack,
      again: view?.again ?? null,
      go: view?.go ?? null,
      owner: token.document.isOwner,
      targets,
      flyout: this.#flyout,
      mode: this.#mode
    }, i18n);
  }

  /* -------------------------------------------- */

  /**
   * The card of the unit under the pointer, placed beside its token.
   * @param {Localizer} i18n
   * @returns {object|null}
   */
  #hoverContext(i18n) {
    const token = this.#hoverToken;
    if ( !token || token.destroyed || (token === this.#token) || this.#forecast || (token.actor?.type !== "unit") ) return null;
    const unit = this.#describe(token);
    const range = parseRange(token.actor.system.equippedWeapon?.system.range, token.actor.system.statValues);

    // What the selected unit could do to a foe under the pointer
    const view = this.#view;
    let versus = null;
    if ( view && this.#acting && view.range && !view.range.staff && (standsTo(view.unit, unit) === "foe") ) {
      const name = this.#token.document.name || this.#token.actor.name;
      const planned = this.#planForecast(token);
      versus = planned ? { name, plan: planned.plan, cost: planned.from.cost, moves: planned.moves } : { name, out: true };
    }

    // Beside the token, on whichever side has room
    const width = 250;
    const corner = canvas.clientCoordinatesFromCanvas({ x: token.x + token.w, y: token.y });
    const left = (corner.x + width + 12 > window.innerWidth)
      ? canvas.clientCoordinatesFromCanvas({ x: token.x, y: token.y }).x - width - 12
      : corner.x + 12;
    const top = Math.min(Math.max(corner.y - 8, 90), window.innerHeight - 330);
    return { ...buildHover({ ...unit, range, versus }, i18n), style: `left:${Math.round(left)}px;top:${Math.round(top)}px` };
  }

  /* -------------------------------------------- */

  /**
   * The forecast of the attack being considered.
   * @param {Localizer} i18n
   * @returns {object|null}
   */
  #forecastContext(i18n) {
    const forecast = this.#forecast;
    const token = this.#token;
    if ( !forecast || !token ) return null;
    // The unit that is fought, which is another than the one that was clicked where a unit stands guard for it
    const target = forecast.fought ?? forecast.target;
    const name = (unit) => unit.document.name || unit.actor.name;

    // A weapon a skill lends the unit is shown with its own picture, marked with that of the skill
    const lent = forecast.lent ?? null;
    const lender = lent ? token.actor.items.get(lent.id) : null;
    const built = buildHudForecast(forecast.plan, {
        armies: { initiator: armyOf(token.actor, token.document), defender: armyOf(target.actor, target.document) },
        images: {
          initiator: forecast.bout?.strike ? (forecast.bout.strike.image ?? "")
            : lent ? (weaponImage(forecast.plan.initiator.unit.weapon?.name ?? lent.name) || lender?.img || "")
            : (token.actor.system.equippedWeapon?.img ?? ""),
          defender: target.actor.system.equippedWeapon?.img ?? ""
        },
        marks: lent ? { initiator: { img: lender?.img ?? "", tip: lent.skill } } : null,
        measured: forecast.measured,

        // What the unit chooses before the fight: the skills it switches on for it, ticked here, and what its
        // foe has switched on or may still do
        choices: fightChoices(token.actor, forecast.plan.initiator),
        foeChoices: fightChoices(target.actor, forecast.plan.defender).filter((choice) => choice.kind && choice.on),
        foeRearms: !!rearmSkill(target.actor, { nihil: !!token.actor.system.skills?.rules?.includes("nihil") })
          && (standsTo({ army: armyOf(token.actor, token.document) }, { army: armyOf(target.actor, target.document) }) === "foe")
    }, i18n);

    // Who fights in whose place, and who may step in as the attack is made
    const guards = [];
    if ( forecast.stood ) guards.push({
      cls: "stance foe", label: i18n.format("FEO.Stance.forecast.stood", { skill: forecast.stood.skill, name: name(target), ally: name(forecast.target) })
    });
    for ( const offer of forecast.maybe ?? [] ) guards.push({
      cls: "stance foe", label: i18n.format("FEO.Stance.forecast.may", { skill: offer.skill, name: offer.token.name || offer.token.actor.name })
    });

    // The formation the attack is made in, with the two allies that stand in it
    for ( const entry of planFormations(forecast.plan) ) {
      const [first, second] = entry.partners.map((unit) => unit.name);
      guards.push({
        cls: (entry.by === "initiator") ? "spread good" : "spread foe",
        label: i18n.format("FEO.Stance.forecast.formation", { skill: entry.skill, first, second }),
        tip: i18n.format("FEO.Stance.forecast.formationTip", { first, second })
      });
    }
    return {
      ...built,
      notes: [...guards, ...(built.notes ?? [])],

      style: this.#forecastStyle(forecast, token),
      busy: this.#busy
    };
  }

  /* -------------------------------------------- */

  /**
   * Where the forecast stands on the screen: in the middle, between the Phase banner and the dock, and clear
   * of the units of the fight where one of them is there (see `placeForecast`).
   * @param {object} forecast     The attack being forecast
   * @param {Token} token         The selected unit's token
   * @returns {string}            The style that sets the panel there
   */
  #forecastStyle(forecast, token) {
    // It is worked out again for another foe, another tile chosen to attack from, or another view of the map
    const stage = canvas.stage;
    const key = [
      token.id, forecast.target.id, forecast.pick ? tileKey(forecast.pick) : "",
      Math.round(stage.pivot.x), Math.round(stage.pivot.y), stage.scale.x.toFixed(3), window.innerWidth, window.innerHeight
    ].join("|");
    if ( this.#forecastSpot?.key === key ) return this.#forecastSpot.style;
    const style = this.#placeForecast(forecast, token);
    this.#forecastSpot = { key, style };
    return style;
  }

  /* -------------------------------------------- */

  /**
   * Work out where the forecast stands, from where the units of the fight are on the screen.
   * @param {object} forecast
   * @param {Token} token
   * @returns {string}
   */
  #placeForecast(forecast, token) {
    const box = (corner, size) => {
      const from = canvas.clientCoordinatesFromCanvas(corner);
      const to = canvas.clientCoordinatesFromCanvas({ x: corner.x + size.w, y: corner.y + size.h });
      return { left: from.x, top: from.y, right: to.x, bottom: to.y };
    };

    // The units of the fight: the two that fight, the one that was clicked, and the tile the attack is made from
    const units = new Set([token, forecast.target, forecast.fought ?? forecast.target]);
    const boxes = [...units].filter((unit) => unit && !unit.destroyed).map((unit) => box(unit, unit));
    if ( forecast.moves ) boxes.push(box(canvas.grid.getTopLeftPoint(forecast.from.tile), token));

    // The room between the banner and the dock, and the panel as it was last drawn
    const drawn = this.element?.querySelector(".fc")?.getBoundingClientRect();
    const dock = this.element?.querySelector(".dock")?.getBoundingClientRect();
    const bottom = dock?.height ? dock.top - 12 : window.innerHeight - 250;
    const placed = placeForecast(
      { width: window.innerWidth, top: 104, bottom },
      { width: drawn?.width || 286, height: drawn?.height || 340 },
      boxes
    );
    if ( placed.anchor === "above" ) return `bottom:${window.innerHeight - placed.at}px`;
    if ( placed.anchor === "below" ) return `top:${placed.at}px`;
    return `top:${placed.at}px;translate:-50% -50%`;
  }

  /* -------------------------------------------- */
  /*  The Map                                     */
  /* -------------------------------------------- */

  /**
   * Plan the selected unit's attack on a token: the tile to make it from, and the exchange as it would go.
   * The way to that tile is what the unit's movement this turn is counted by, for the skills that ask.
   * @param {Token} target
   * @param {{i: number, j: number}|null} [pick]    The tile chosen to attack from, while the unit can still
   *                                                attack from there; else the map picks one
   * @param {{i: number, j: number}|null} [glance]  A tile to try in its place, as the pointer passes over it
   * @param {{item: string, skill: string, rounds: number|string}|null} [bout]
   *                                                The skill that starts this fight as one of several rounds
   *                                                (see `rules/rounds.mjs`); the forecast of the same target
   *                                                keeps the one it has
   * @returns {{target: Token, from: object, moves: boolean, plan: object, measured: number|null,
   *   pick: object|null, glance: object|null, bout: object|null}|null}
   *   Null if the unit cannot attack the token this turn
   */
  #planForecast(target, pick = null, glance = null, bout = (this.#forecast?.target === target) ? (this.#forecast.bout ?? null) : null) {
    const view = this.#view;
    const token = this.#token;
    if ( !view || !token ) return null;
    // One attack of a skill's own is made from where the unit stands, whatever its weapon reaches
    const strike = bout?.strike ?? null;
    const tried = (glance && !strike) ? attackAt(view, target.document, glance) : null;
    const chosen = (pick && !strike) ? attackAt(view, target.document, pick) : null;
    const from = strike ? { tile: view.standing, spaces: 0, cost: 0, passed: [] } : (tried ?? chosen ?? attackFrom(view, target.document));
    if ( !from ) return null;
    const moves = (from.tile.i !== view.standing.i) || (from.tile.j !== view.standing.j);

    // A unit that stands guard for the target is fought in its place, where the target stands: the forecast
    // is of that fight. One that may step in as the attack is made is only named
    const stood = strike ? null : sureGuard(token.document, target.document);
    const fought = stood?.token.object ?? target;
    const maybe = (strike || stood) ? [] : mayGuards(token.document, target.document);

    // What the way there would cost the two in HP before the fight begins is counted in the forecast
    let lost = null;
    if ( moves ) {
      const harm = harmOf(view, from.tile);
      lost = { initiator: harm.shown[""] ?? 0, defender: harm.shown[fought.document.id] ?? 0 };
    }
    const matchup = planAttack(token.actor, token.document, fought, {
      stand: stood?.stand ?? null,
      from: moves ? from.tile : null,
      walk: moves ? { spaces: from.spaces, cost: from.cost, passed: from.passed } : null,
      lost,
      rounds: bout?.rounds ? { rounds: bout.rounds, skill: bout.skill } : null,
      extra: strike
    });
    if ( matchup.warning ) return null;
    return {
      target, fought, stood, maybe, from, moves, plan: matchup.makePlan(matchup.distance), measured: matchup.measured,
      lent: matchup.lent?.(matchup.distance) ?? null,
      pick: chosen ? chosen.tile : null, glance: tried ? tried.tile : null, bout
    };
  }

  /* -------------------------------------------- */

  /**
   * May a staff be used on a unit, from where the selected unit stands? A staff is for a friend within its
   * reach, and an Offensive Staff for a foe. One that moves a unit is for the units its Effect names: an ally
   * or an enemy, next to its user or within its range.
   * @param {Token} token
   * @param {Item|null} [staff]     The staff that was picked, unless another is given
   * @returns {boolean}
   */
  #staffTakes(token, staff = this.#token?.actor.items.get(this.#staff)) {
    const view = this.#view;
    const there = tokenTile(token.document);
    if ( !view || !staff || !there ) return false;
    if ( staffWarpOf(staff) ) return staffWarpAllows(this.#token.document, staff, token.document);

    // An Offensive Staff is for a foe, one for an enemy or an ally for either, and any other for a friend,
    // within the reach the unit's skills give it
    return staffTakesOf(this.#token.document, staff, token.document).ok;
  }

  /* -------------------------------------------- */

  /**
   * The staff that waits for what it is used on, for the dock: its name, and for one for several units how
   * many it catches, which the dock's button then confirms.
   * @returns {{name: string, kind: "unit"|"area"|"object", count: number}|null}
   */
  #staffStatus() {
    const token = this.#token;
    const item = token?.actor.items.get(this.#staff);
    if ( !item ) return null;
    try {
      const area = staffAreaOf(token.document, item);
      if ( area ) return { name: item.name, kind: "area", count: area.units.length };
      return { name: item.name, kind: (staffPlanOf(token.actor, item).on === "object") ? "object" : "unit", count: 0 };
    } catch(err) {
      console.error(err);
      return null;
    }
  }

  /* -------------------------------------------- */

  /**
   * The tiles that what was picked can warp its unit to: the selected unit with a skill, and with a staff the
   * unit it was used on or the selected unit itself.
   * @returns {Set<string>}
   */
  #warpTiles() {
    const picked = this.#warp;
    const token = this.#token;
    if ( !picked || !token || !this.#view ) return new Set();
    if ( picked.staff ) {
      const moved = picked.target ?? token;
      const staff = token.actor.items.get(picked.staff);
      return (staff && !moved.destroyed) ? staffWarpTilesOf(token.document, staff, moved.document) : new Set();
    }
    const warp = warpOf(token.actor.items.get(picked.skill)?.system);
    return warp ? warpTilesOf(this.#view, warp) : new Set();
  }

  /* -------------------------------------------- */

  /**
   * Would a click on a token mean something for the selected unit: an attack on a foe within reach, or a
   * unit to use the picked staff on?
   * @param {Token} token
   * @param {Event} [event]
   * @returns {boolean}
   */
  #wantsToken(token, event) {
    // While a step is offered, a click on any unit answers it: one of those offered takes it, any other passes
    if ( this.#offer ) return token.actor?.type === "unit";

    // While a choice waits above the dock, the map does nothing
    if ( this.#choice ) return false;
    const view = this.#view;
    if ( !view || !(this.#acting || this.#moving) || this.#busy || (token.actor?.type !== "unit") ) return false;
    if ( (this.#mode === "warp") || (this.#mode === "lay") ) return false;

    // A unit next to the selected one to Shove, or one the skill being used may be used on: the unit that
    // was picked for it stands for trading places with it
    if ( this.#mode === "shove" ) {
      return (token !== this.#token) && shovesOf(this.#token.document).some((entry) => entry.target === token.document);
    }
    // An ally next to the selected unit to pick up or to take a passenger from: any unit next to it answers,
    // so that one it may not pick up is told why. Or an ally to hand its passenger to
    if ( this.#mode === "rescue" ) {
      const there = tokenTile(token.document);
      return (token !== this.#token) && !!there && (tilesApart(view.standing, there) === 1);
    }
    if ( this.#mode === "drop" ) return (token !== this.#token) && givesOf(this.#token.document).includes(token.document);

    // An enemy next to the selected unit to Steal from: any unit next to it answers, so that one it may not
    // steal from is told why
    if ( (this.#mode === "steal") || (this.#mode === "trade") ) {
      const there = tokenTile(token.document);
      return (token !== this.#token) && !!there && (tilesApart(view.standing, there) === 1);
    }

    // A door, a chest or a Village: a unit that stands on one answers for its tile, the selected unit too
    if ( this.#mode === "object" ) {
      const there = tokenTile(token.document);
      return !!there && !!objectOn(canvas.scene, { i: there.i, j: there.j });
    }

    // An ally to Refresh: any other unit answers, so that one it may not be used on is told why
    if ( this.#mode === "refresh" ) return token !== this.#token;
    // While an area is being placed, a click on any unit answers: it places or confirms it, or calls it off
    if ( (this.#mode === "act") && this.#act?.area ) return true;
    if ( this.#mode === "act" ) {
      // A skill that has its unit imitate another: any unit next to it answers, so that one it cannot imitate
      // is told why
      if ( !this.#act?.target && actFor(this.#token.document, this.#token.actor.items.get(this.#act?.skill))?.imitates ) {
        const there = tokenTile(token.document);
        return (token !== this.#token) && !!there && (tilesApart(view.standing, there) === 1);
      }
      return this.#act?.target ? (token === this.#act.target) : this.#actTargets().includes(token);
    }
    // A unit to use the picked staff on: any unit answers, so that one it may not be used on is told why
    if ( this.#mode === "staff" ) return true;
    if ( event?.shiftKey ) return false;
    token = this.#aimedAt(token);
    if ( token === this.#token ) return false;

    // Until a battle begins a click on a unit selects it, and walks nobody
    if ( this.#settingUp ) return false;

    // A unit that may end its move on the tile another stands on walks there when that unit is clicked
    if ( this.#stepOnto(token) && !this.#attacks(token) ) return true;

    // Outside of a battle a click selects as it always has, unless Attack was pressed first
    if ( view.onlyWait || ((this.#state !== "ready") && (this.#mode !== "target")) ) return false;

    // A unit that was forced to target another answers a click on any other enemy by saying so
    if ( this.#barOn(token) ) return true;
    return this.#attacks(token);
  }

  /* -------------------------------------------- */

  /**
   * Why the selected unit can make a unit the target of nothing, where it was forced to target another: the
   * sentence that says so, and what goes into it.
   * @param {Token} token
   * @returns {{key: string, data: object}|null}
   */
  #barOn(token) {
    const mine = this.#token;
    if ( !mine || (token === mine) || (token.actor?.type !== "unit") ) return null;
    const bar = targetBar(mine.actor, mine.document, token.actor, token.document);
    if ( bar?.key === "FEO.Act.provoked" ) return bar;

    // A unit that an ally near it shelters: where that alone keeps the selected unit from attacking it from
    // every tile it could attack from, a click on it says so
    const view = this.#view;
    if ( !view?.range || view.range.staff || attackFrom(view, token.document) ) return null;
    const open = attackFrom(view, token.document, { unsheltered: true });
    if ( !open ) return null;
    const sheltered = targetBar(mine.actor, mine.document, token.actor, token.document, { attack: true, from: open.tile });
    return (sheltered?.key === "FEO.Act.sheltered") ? sheltered : null;
  }

  /* -------------------------------------------- */

  /**
   * The token a click on a token is meant for. Two units may share a tile, and the one on top takes the click:
   * a click on the selected unit is then meant for the unit it shares its tile with.
   * @param {Token} token
   * @returns {Token}
   */
  #aimedAt(token) {
    const view = this.#view;
    if ( !view || (token !== this.#token) ) return token;
    const other = view.units.find((unit) => {
      return (unit.token !== view.unit.token) && (unit.tile.i === view.standing.i) && (unit.tile.j === view.standing.j);
    });
    return other?.token.object ?? token;
  }

  /* -------------------------------------------- */

  /**
   * Could the selected unit attack a token's unit this turn: a foe still in the fight, within its reach?
   * @param {Token} token
   * @returns {boolean}
   */
  #attacks(token) {
    const view = this.#view;
    if ( !view || view.onlyWait || token.actor.system.defeat?.out ) return false;
    const other = { army: armyOf(token.actor, token.document) };
    return (standsTo(view.unit, other) === "foe") && !!attackFrom(view, token.document);
  }

  /* -------------------------------------------- */

  /**
   * The tile of another unit that the selected unit may end its move on, as a skill lets units share a tile.
   * @param {Token} token
   * @returns {{i: number, j: number}|null}     Null where it may not, or stands there already
   */
  #stepOnto(token) {
    const view = this.#view;
    const there = tokenTile(token.document);
    if ( !view || !there || (this.#mode === "target") ) return null;
    const tile = { i: there.i, j: there.j };
    if ( (tile.i === view.standing.i) && (tile.j === view.standing.j) ) return null;
    if ( !view.units.some((unit) => unit.token === token.document) ) return null;
    return view.reach.stops.has(tileKey(tile)) ? tile : null;
  }

  /* -------------------------------------------- */

  /**
   * A token the selected unit can do something to was clicked: a foe has the attack on it forecast, and a unit
   * whose tile the selected unit may share is walked onto. A second click on the foe of the forecast makes the
   * attack from that foe's own tile, where the unit may share it, and a third from where the map had it. With
   * Alt held, a foe is walked onto without attacking it.
   * @param {Token} token
   * @param {Event} [event]
   */
  #onTokenClick(token, event) {
    if ( this.#offer ) {
      const offered = (this.#offer.offer.units ?? []).includes(token.document);
      this.#settle(offered ? { unit: token.document } : null);
      return;
    }
    if ( this.#mode === "shove" ) {
      const target = token.document;
      const shover = this.#token.document;
      this.#clear();
      this.#working(() => shoveUnit(shover, target));
      return;
    }
    // An ally that carries a unit has its passenger taken over; any other is picked up
    if ( this.#mode === "rescue" ) {
      const target = token.document;
      const mine = this.#token.document;
      this.#clear();
      this.#working(() => passengerOf(target.actor) ? takeUnit(mine, target) : rescueUnit(mine, target));
      return;
    }
    if ( this.#mode === "drop" ) {
      const target = token.document;
      const mine = this.#token.document;
      this.#clear();
      this.#working(() => giveUnit(mine, target));
      return;
    }

    // An enemy to Steal from: its pack is listed above the dock, and a click there takes what is picked. One
    // the unit may not steal from says why
    if ( this.#mode === "steal" ) {
      const target = token.document;
      const mine = this.#token.document;
      const tried = stealOf(mine, target);
      const name = target.name || target.actor?.name || "";
      this.#clear();
      if ( !tried?.ok ) {
        ui.notifications.warn(game.i18n.format(`FEO.Steal.blocked.${tried?.why ?? "apart"}`, { name }));
        this.refresh();
        return;
      }
      this.#pickFromPack(mine, target, tried, name);
      return;
    }

    // An ally to Trade with: both packs are listed above the dock, and a click there hands something over.
    // One the unit may not trade with says why
    if ( this.#mode === "trade" ) {
      const target = token.document;
      const mine = this.#token.document;
      const tried = tradeOf(mine, target);
      this.#clear();
      if ( !tried?.ok ) {
        ui.notifications.warn(game.i18n.format(`FEO.Trade.blocked.${tried?.why ?? "apart"}`, { name: target.name || target.actor?.name || "" }));
        this.refresh();
        return;
      }
      this.#tradeWith(mine, target);
      return;
    }
    if ( this.#mode === "object" ) {
      const there = tokenTile(token.document);
      if ( there ) this.#onTileClick({ i: there.i, j: there.j }, event);
      return;
    }
    if ( this.#mode === "refresh" ) {
      this.#pickForRefresh(token);
      return;
    }
    if ( (this.#mode === "act") && this.#act?.area ) {
      const there = tokenTile(token.document);
      if ( there ) this.#onAreaClick({ i: there.i, j: there.j }, token, event);
      return;
    }
    if ( this.#mode === "act" ) {
      const act = this.#act;
      const item = this.#token.actor.items.get(act?.skill);
      if ( !item ) return;

      // A unit the skill cannot have its unit imitate says why
      const imitates = actFor(this.#token.document, item)?.imitates;
      if ( imitates && !this.#actTargets().includes(token) ) {
        const bar = imitationBar(this.#token.document, imitates, token.document)
          ?? { key: "FEO.Imitate.blocked.side", data: { name: token.document.name || token.actor.name } };
        this.#clear();
        ui.notifications.warn(game.i18n.format(bar.key, bar.data));
        this.refresh();
        return;
      }

      // A skill that starts a fight of several rounds shows the forecast of that fight, from where the unit
      // stands: confirming it fights it, and the skill is used then
      const fight = actFor(this.#token.document, item)?.fight;
      if ( fight ) {
        const forecast = this.#planForecast(token, this.#view?.standing ?? null, null, { item: item.id, skill: item.name, rounds: fight.rounds });
        this.#clear();
        if ( forecast && !forecast.plan.initiator.blocked && forecast.plan.rounds ) this.#forecast = forecast;
        else ui.notifications.warn(game.i18n.format("FEO.Round.noCounter", { skill: item.name, name: token.document.name || token.actor.name }));
        this.refresh();
        return;
      }

      // So does one attack of the skill's own: confirming it makes that attack, and the skill is used then
      const strike = strikeOf(this.#token.document, item);
      if ( strike ) {
        const forecast = this.#planForecast(token, null, null, { item: item.id, skill: item.name, strike });
        this.#clear();
        if ( forecast && !forecast.plan.initiator.blocked ) this.#forecast = forecast;
        else ui.notifications.warn(game.i18n.format("FEO.Act.failed", { skill: item.name }));
        this.refresh();
        return;
      }

      // A skill that asks for a tile has it picked next; the unit picked, clicked again, is its own tile
      if ( !act.target && actAsksTile(item) ) {
        this.#act = { skill: act.skill, target: token };
        this.refresh();
      }
      else {
        const there = tokenTile(token.document);
        this.#working(() => this.#useAct(act.skill, token, act.target ? { i: there.i, j: there.j } : null));
      }
      return;
    }

    // A unit that was forced to target another is told so when any other enemy is clicked
    if ( this.#mode !== "staff" ) {
      const bar = this.#barOn(token);
      if ( bar ) {
        ui.notifications.warn(game.i18n.format(bar.key, bar.data));
        return;
      }
    }
    if ( this.#mode === "staff" ) {
      this.#useStaffOn(token).catch((err) => console.error(err));
      return;
    }
    token = this.#aimedAt(token);
    const view = this.#view;
    const step = this.#stepOnto(token);
    const open = this.#forecast;
    if ( open && (open.target === token) && step ) {
      const picked = !!open.pick && (open.pick.i === step.i) && (open.pick.j === step.j);
      if ( picked || attackAt(view, token.document, step) ) {
        this.#forecast = this.#planForecast(token, picked ? null : step) ?? open;
        this.refresh();
        return;
      }
    }
    const forecast = (this.#attacks(token) && !(event?.altKey && step)) ? this.#planForecast(token) : null;
    if ( forecast ) {
      this.#clear();
      this.#forecast = forecast;
      this.refresh();
    }
    else if ( step ) {
      this.#clear();
      this.#working(() => this.#moveTo(step));
    }
  }

  /* -------------------------------------------- */

  /**
   * An empty tile was clicked: the selected unit walks there from where it stands, if the tile is one it can
   * stop on this turn. While a tile to warp to is being chosen, it is warped there instead, and a click on any
   * other tile calls the warp off.
   * @param {{i: number, j: number}} tile
   * @param {Event} [event]
   * @returns {boolean}   Whether the click was used up
   */
  #onTileClick(tile, event) {
    // While a step is offered, a click on one of its tiles takes it, and a click on any other tile passes
    if ( this.#offer ) {
      const picked = (this.#offer.offer.tiles ?? []).find((other) => (other.i === tile.i) && (other.j === tile.j));
      this.#settle(picked ? { tile: { i: picked.i, j: picked.j } } : null);
      return true;
    }
    // While a choice waits above the dock, a click on the map leaves it waiting
    if ( this.#choice ) return true;
    const view = this.#view;
    if ( !view || !(this.#acting || this.#moving) || this.#busy || event?.shiftKey ) return false;

    // While a unit to Shove is being chosen, a click on a tile calls it off. While a skill is being used on a
    // unit, a click on one of the tiles it offers uses it there, and a click on any other calls it off
    if ( (this.#mode === "shove") || (this.#mode === "rescue") || (this.#mode === "refresh") || (this.#mode === "steal") || (this.#mode === "trade") ) {
      this.#clear();
      this.refresh();
      return true;
    }

    // While a door, a chest or a Village is being chosen, a click on one the unit can act on does what it
    // would do there; one it cannot says why, and a click anywhere else calls it off
    if ( this.#mode === "object" ) {
      const mine = this.#token.document;
      const found = objectOn(canvas.scene, tile);
      this.#clear();
      if ( found && !isSpent(found) ) this.#working(() => actOnObject(mine, tile));
      else this.refresh();
      return true;
    }

    // While the ally it carries is to be set down, a click on one of the tiles next to it Drops the ally
    // there, and a click on any other calls it off
    if ( this.#mode === "drop" ) {
      const mine = this.#token.document;
      const picked = dropsOf(mine).find((other) => (other.i === tile.i) && (other.j === tile.j));
      this.#clear();
      if ( picked ) this.#working(() => dropUnit(mine, picked));
      else this.refresh();
      return true;
    }
    if ( (this.#mode === "act") && this.#act?.area ) {
      this.#onAreaClick(tile, null, event);
      return true;
    }
    if ( this.#mode === "act" ) {
      const act = this.#act;
      if ( act?.target && this.#actTiles().has(tileKey(tile)) ) this.#working(() => this.#useAct(act.skill, act.target, tile));
      else {
        this.#clear();
        this.refresh();
      }
      return true;
    }
    if ( this.#mode === "warp" ) {
      if ( this.#warpTiles().has(tileKey(tile)) ) this.#working(() => this.#warpTo(tile));
      else {
        this.#clear();
        this.refresh();
      }
      return true;
    }

    // While a mine or a trap is being laid, a click on a tile it may lie on lays it there; one that warps
    // then asks for the tile it sends a unit to. A click on any other tile calls it off
    if ( this.#mode === "lay" ) {
      const lay = this.#lay;
      const item = lay ? this.#token.actor.items.get(lay.item) : null;
      const trap = trapItemOf(item);
      const picked = this.#layTiles().some((other) => (other.i === tile.i) && (other.j === tile.j));
      if ( !trap || !picked ) {
        this.#clear();
        this.refresh();
      }
      else if ( trap.warp && !lay.at ) {
        this.#lay = { item: lay.item, at: { i: tile.i, j: tile.j } };
        this.refresh();
      }
      else {
        const mine = this.#token.document;
        const at = lay.at ?? { i: tile.i, j: tile.j };
        const warp = lay.at ? { i: tile.i, j: tile.j } : null;
        this.#clear();
        this.#working(async () => {
          // Using the item is the unit's Action
          if ( await layTrapItem(mine, item, at, warp) ) await takeAction(mine.actor, mine, { action: { kind: "item" } });
        });
      }
      return true;
    }

    // While a staff waits for what it is used on, a click on a door or a chest it opens uses it there, and a
    // click on any other tile calls it off
    if ( this.#mode === "staff" ) {
      this.#onStaffTile(tile);
      return true;
    }
    // While an attack is forecast, a click on another tile it could be made from chooses that tile, and a
    // click anywhere else calls the attack off
    if ( this.#forecast ) {
      const chosen = this.#forecast.bout?.strike ? null : attackAt(view, this.#forecast.target.document, tile);
      this.#forecast = chosen ? this.#planForecast(this.#forecast.target, chosen.tile) : null;
      this.refresh();
      return true;
    }

    // Until a battle begins no reach is painted, and a click on the ground walks nobody
    if ( this.#settingUp ) return false;
    const key = tileKey(tile);
    if ( !view.reach.stops.has(key) || ((tile.i === view.standing.i) && (tile.j === view.standing.j)) ) return false;
    this.#working(() => this.#moveTo(tile));
    return true;
  }

  /* -------------------------------------------- */

  /**
   * The ground was right-clicked, off every token. Whatever the user was in the middle of is called off: a
   * list that is open, a unit or a tile being picked, an attack being forecast. With none of that, the
   * selected unit is put down, and what was painted for it goes with it.
   * @returns {boolean}   Whether the click was used up
   */
  #onGroundRightClick() {
    // A step that is offered and a choice that waits are answered where they are asked, and by nothing else
    if ( this.#busy || this.#offer || this.#choice || !this.#token || this.#token.destroyed ) return false;
    if ( this.#flyout || this.#mode || this.#forecast ) {
      this.#clear();
      this.refresh();
      return true;
    }
    this.#token.release();
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Is the tile under the pointer named with no unit selected? It is while a battle is on, on any map whose
   * ground was painted or marked out, and for whoever is looking at the ground. A Game Master, who seldom has
   * one unit in hand, reads the land that way without picking one up first.
   * @type {boolean}
   */
  get #named() {
    return mapTools.surveying || !!battle() || hasGround(canvas.scene);
  }

  /* -------------------------------------------- */

  /**
   * Is the ground looked at from behind the Fire Emblem controls, with the Survey tool and not the brush? The
   * units on it are then named along with it; the brush is left to paint with nothing in its way.
   * @type {boolean}
   */
  get #looking() {
    return mapTools.open && !mapTools.painting;
  }

  /* -------------------------------------------- */

  /**
   * The tile the pointer is over, if it is one to name: a tile of the map itself, not of the padding round it.
   * @param {{i: number, j: number}|null} tile
   * @returns {{i: number, j: number}|null}
   */
  #pointed(tile) {
    if ( !tile ) return null;
    const onMap = this.#view ? this.#view.inside(tile) : (this.#named && !!mapTile(canvas.grid.getCenterPoint(tile)));
    return onMap ? tile : null;
  }

  /* -------------------------------------------- */

  /**
   * The unit that stands on a tile, if this user sees it there.
   * @param {{i: number, j: number}} tile
   * @returns {Token|null}
   */
  #unitOn(tile) {
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      if ( token.destroyed || !token.visible || (token.actor?.type !== "unit") ) continue;
      const at = tokenTile(token.document);
      if ( !at ) continue;
      if ( (tile.i >= at.i) && (tile.i < at.i + at.height) && (tile.j >= at.j) && (tile.j < at.j + at.width) ) return token;
    }
    return null;
  }

  /* -------------------------------------------- */

  /**
   * The ground is looked at, or no longer: whether the tile under the pointer is named goes by that, and a unit
   * that was found under the pointer behind the Fire Emblem controls is let go of once they are left, or the
   * brush is taken up.
   */
  #onSurvey() {
    try {
      this.#hoverTile = this.#pointed(battleCanvas.hover);
      if ( this.#found && !this.#looking ) {
        this.#found = false;
        this.#hoverToken = null;
      }
    } catch(err) {
      console.error(err);
    }
  }

  /* -------------------------------------------- */

  /**
   * The pointer is over another tile.
   * @param {{i: number, j: number}|null} tile
   */
  #onTileHover(tile) {
    this.#hoverTile = this.#pointed(tile);
    const onMap = !!this.#hoverTile;
    const shown = !!this.#view || this.#named;
    this.#rest(onMap && shown, mapTools.surveying ? SURVEY_REST_TIME : REST_TIME);

    // Behind the Fire Emblem controls the tokens do not hear the pointer, so the unit that stands on the tile
    // under it is looked for here, and gets its card as it would under the pointer anywhere else
    if ( this.#looking ) {
      const found = onMap ? this.#unitOn(this.#hoverTile) : null;
      this.#found = !!found;
      this.#onTokenHover(found);
    }
    if ( !shown ) return;

    // While an attack is forecast, a tile it could be made from shows how it would go from there: what the
    // unit's skills make of the way to it is in the numbers. Off such a tile the forecast is as it was
    const forecast = this.#forecast;
    if ( forecast && this.#view && !this.#busy ) {
      const tried = (onMap && attackAt(this.#view, forecast.target.document, tile)) ? tile : null;
      if ( tried || forecast.glance ) {
        this.#forecast = this.#planForecast(forecast.target, forecast.pick, tried) ?? forecast;
        this.refresh({ parts: ["terrain", "forecast"] });
        return;
      }
    }
    this.refresh({ parts: ["terrain"] });
  }

  /* -------------------------------------------- */

  /**
   * The pointer is on another tile, or has left the map: the terrain card goes back to its figures, and says
   * more of the tile only once the pointer has stayed on it for a moment.
   * @param {boolean} onMap     Is the pointer on a tile of the map?
   * @param {number} [wait]     How long it has to stay there, in milliseconds
   */
  #rest(onMap, wait = REST_TIME) {
    clearTimeout(this.#resting);
    this.#resting = null;
    this.#rested = false;
    if ( !onMap ) return;
    this.#resting = setTimeout(() => {
      this.#resting = null;
      this.#rested = true;
      if ( this.rendered ) this.refresh({ parts: ["terrain"] });
    }, wait);
  }

  /* -------------------------------------------- */

  /**
   * The pointer is over another token, or over none.
   * @param {Token|null} token
   */
  #onTokenHover(token) {
    if ( token === this.#hoverToken ) return;
    this.#hoverToken = token;
    this.refresh({ parts: ["hover"] });
  }

  /* -------------------------------------------- */
  /*  Acting                                      */
  /* -------------------------------------------- */

  /**
   * Do something that takes a while, without another click getting in its way, and draw the HUD afterwards.
   * @param {() => Promise<any>} work
   * @returns {Promise<void>}
   */
  async #working(work) {
    if ( this.#busy ) return;
    this.#busy = true;
    try {
      await work();
    } catch(err) {
      console.error(err);
      ui.notifications.error("FEO.Hud.failed", { localize: true });
    } finally {
      this.#busy = false;
      await this.refresh();
    }
  }

  /* -------------------------------------------- */

  /**
   * Walk the selected unit from where it stands to a tile of its reach, by the shortest way there.
   * @param {{i: number, j: number}} tile
   * @returns {Promise<boolean|"halted">}   Whether it arrived; "halted" where its move was ended on the way,
   *                                        or a unit it did not see kept it from going further
   */
  async #moveTo(tile) {
    const token = this.#token;
    const document = token.document;
    const view = this.#view;
    if ( view.fixed ) return false;
    const way = [view.standing, ...wayBetween(view.reach, view.standing, tile)];
    if ( way.length < 2 ) return false;

    // In a battle the token remembers where its turn began, so that the move can be taken back, and so that
    // a unit moved again is still held to the reach it had there. For the move a unit makes after its Action,
    // that is where it stood as it acted
    const origin = originOf(document);
    const inTurn = inOwnTurn(document.actor, document);
    if ( !origin && inTurn ) {
      const { x, y } = document._source ?? document;
      await document.setFlag(FEO.id, "origin", { x, y });
    }

    // Its reach has already said that every step can be taken: Foundry does not weigh the ground again. In
    // its own turn the unit is walked a step at a time wherever something would come of the move: an enemy
    // that watches for it reacts where the unit then stands, a trap is sprung on its tile, and the move may
    // end there (see `helpers/reactions.mjs`)
    const told = { [FEO.id]: { click: true } };
    let walked = { at: way.length - 1, halted: false, blocked: false, failed: false, gone: false };
    if ( inTurn ) walked = await walkWay(document, way, { stands: (place) => view.reach.stops.has(tileKey(place)), told });
    else {
      const points = waypointsTo(document, view.reach, tile, view.standing);
      if ( !points.length || ((await document.move(points, { constrainOptions: { ignoreCost: true }, ...told })) === false) ) walked = { ...walked, at: 0, failed: true };
    }
    if ( walked.failed && (walked.at === 0) ) return false;

    // Where it now stands, which is short of the tile where its move was ended on the way
    const reached = walked.at === (way.length - 1);
    tile = way[walked.at];

    // What the move does to the units along its way
    const harm = harmOf(view, tile);

    // Back where its turn began, the unit has not moved at all
    const home = (tile.i === view.reach.origin.i) && (tile.j === view.reach.origin.j);
    if ( home && originOf(document) ) await document.unsetFlag(FEO.id, "origin");
    if ( walked.gone ) return "halted";

    // What the move comes to, from where the turn began, is noted for the skills that ask how the unit moved:
    // for a unit that moves again after its Action, or on a go that counts on from where its turn began, with
    // what it moved before.
    // A move that deals damage on its way stands: it is neither taken back nor made again
    // So does the move of a unit that loses HP whenever it moves, as a change on it has it
    const stepped = walked.at > 0;
    const tolled = stepped && !home && movesAtToll(document.actor);
    const harms = stepped && !home && (harm.blows.length > 0);
    // So does a move that was ended on its way
    if ( inTurn ) await noteMove(document, home ? walkHome(view) : walkOf(view, tile), { fixed: harms || tolled || (walked.halted && !home) });
    if ( harms ) await this.#dealHarm(token, harm);
    if ( tolled ) {
      try {
        await Promise.race([token.movementAnimationPromise ?? null, new Promise((resolve) => setTimeout(resolve, 3000))]);
        await takeToll(document.actor, "move", document);
      } catch(err) {
        console.error(err);
      }
    }

    // A unit it has hold of is dragged along, to the tile it took its last step from
    if ( gripOf(document.actor) && (walked.at > 0) ) await followGrip(document, { from: way[walked.at - 1] ?? null, fresh: !origin });
    return reached ? true : "halted";
  }

  /* -------------------------------------------- */

  /**
   * Deal the damage of a move to the units along its way, once the unit has arrived: to the enemies it moved
   * through or past, then to the unit itself. Each goes the way of all damage from a skill, so that whatever
   * answers damage does, and its number floats over the unit that takes it.
   * @param {Token} token       The unit that moved
   * @param {import("../rules/passing.mjs").PathHarm & {units: Map<string, object>}} harm
   * @returns {Promise<void>}
   */
  async #dealHarm(token, harm) {
    const actor = token.actor;
    const document = token.document;

    // The token is let arrive first, so that the numbers come up as it does
    try {
      await Promise.race([token.movementAnimationPromise ?? null, new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch(err) {
      console.error(err);
    }
    const names = [...new Set(harm.blows.map((blow) => blow.skill).filter(Boolean))];
    if ( names.length ) pop(actor, names.map((text) => ({ text, tone: "skill" })));
    for ( const blow of harm.blows ) {
      try {
        if ( !blow.id ) await damageUnit(actor, blow.amount, { kind: "skill", nonlethal: blow.nonlethal, token: document });
        else {
          const other = harm.units.get(blow.id);
          if ( !other || other.actor.system.defeat?.state ) continue;
          await damageUnit(other.actor, blow.amount, {
            kind: "skill", by: actor, byToken: document, nonlethal: blow.nonlethal, token: other.token
          });
        }
      } catch(err) {
        console.error(err);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Take back the selected unit's move: it is set back at once where its turn began. A move that dealt damage
   * on its way stands, and is not taken back. Once a unit has taken its Action, only the move it made after
   * it is taken back: it is set back where it stood as it acted.
   * @returns {Promise<void>}
   */
  async #undoMove() {
    const document = this.#token?.document;
    const origin = originOf(document);
    if ( !origin || this.#view?.fixed ) return;
    await document.move({ x: origin.x, y: origin.y, snapped: true, action: "displace" }, {
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
      [FEO.id]: { undo: true }
    });
    await document.unsetFlag(FEO.id, "origin");
    await noteMove(document, walkHome(this.#view));

    // A unit it has hold of is set back where it stood as the move began
    if ( gripOf(document.actor) ) await followGrip(document, { back: true });
  }

  /* -------------------------------------------- */
  /*  Shove, Skills on a Unit, Steps              */
  /* -------------------------------------------- */

  /**
   * The units the skill being used may be used on.
   * @returns {Token[]}
   */
  #actTargets() {
    const token = this.#token;
    const item = token?.actor.items.get(this.#act?.skill);
    if ( !item ) return [];
    return actTargetsOf(token.document, item).map((target) => target.object).filter(Boolean);
  }

  /* -------------------------------------------- */

  /**
   * The tiles the skill being used offers, once its target is picked: for a unit that maneuvers with an ally,
   * that ally's own tile to trade places, the tiles next to the ally to move to, and the tiles next to the
   * unit to set the ally down on.
   * @returns {Set<string>}
   */
  #actTiles() {
    const token = this.#token;
    const picked = this.#act?.target;
    const tiles = new Set();
    if ( !token || !picked || picked.destroyed ) return tiles;
    const open = maneuversOf(token.document, picked.document);
    const there = tokenTile(picked.document);
    if ( open.swap ) tiles.add(tileKey(there));
    for ( const tile of [...open.pivot, ...open.place] ) tiles.add(tileKey(tile));
    return tiles;
  }

  /* -------------------------------------------- */

  /**
   * Begin using one of the selected unit's skills on a unit picked on the map: the units it may be used on are
   * painted, and the next click on one of them uses it there, or has the tile it asks for picked next. A unit
   * that has hold of another lets go of it instead. Whatever stands in the way is said.
   * @param {string} id     The skill
   */
  #beginAct(id) {
    const token = this.#token;
    const item = token?.actor.items.get(id);
    const act = actOf(item?.system);
    this.#clear();
    if ( act && this.#view ) {
      // Picked again while it holds a unit, the skill lets go of it
      if ( act.grip && (gripOf(token.actor)?.item === id) ) {
        this.#working(() => endGrip(token.document));
        return;
      }

      // Picked again while its unit imitates another, it has the unit revert
      if ( act.imitates && (token.actor.system.imitating?.item === id) ) {
        this.#working(() => revertUnit(token.actor));
        return;
      }
      const area = areaFor(token.document, item);
      const blocked = !this.#acting ? "FEO.Hud.warp.notNow" : area ? areaBlocked(token.document, item) : actBlocked(token.document, item);
      if ( blocked ) {
        const why = (typeof blocked === "string") ? { key: blocked } : blocked;
        ui.notifications.warn(game.i18n.format(why.key, { skill: item.name, name: token.document.name || token.actor.name, ...(why.data ?? {}) }));
      }

      // A skill that makes a creature has what it is made with picked first, from a short list above the dock
      else if ( area && actFor(token.document, item)?.makes ) {
        this.#pickMakes(id).catch((err) => console.error(err));
        return;
      }

      // A skill that takes in an area has it painted where it would lie, to be placed or confirmed
      else if ( area ) {
        this.#mode = "act";
        this.#act = { skill: id, target: null, area: true, shares: actFor(token.document, item)?.shares ? {} : null };
      }

      // A skill for one unit or for all in reach has that picked first, from a short list above the dock
      else if ( actModes(actFor(token.document, item)).includes("all") ) {
        this.#pickMode(id).catch((err) => console.error(err));
        return;
      }
      else {
        this.#mode = "act";
        this.#act = { skill: id, target: null };
      }
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * A skill that brings a creature onto the map: what it is made with is picked from a short list above the
   * dock first (which animal, which weapon, how many), and the tiles it may appear on are then offered.
   * Calling a list off calls the skill off.
   * @param {string} id     The skill
   * @returns {Promise<void>}
   */
  async #pickMakes(id) {
    const token = this.#token;
    const item = token?.actor.items.get(id);
    const act = actFor(token?.document, item);
    if ( !act?.makes ) return;
    const picks = await askMakes(token.document, item, act);
    if ( (this.#token !== token) || !this.#acting ) return;
    if ( picks ) {
      this.#mode = "act";
      this.#act = { skill: id, target: null, area: true, shares: null, picks };
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * A skill that is used on one unit or on all in its reach at once: which is picked from a short list above
   * the dock. For one, the units it may be used on are then offered; for all, it is used at once.
   * @param {string} id     The skill
   * @returns {Promise<void>}
   */
  async #pickMode(id) {
    const token = this.#token;
    const item = token?.actor.items.get(id);
    const act = actFor(token?.document, item);
    if ( !act ) return;
    const i18n = game.i18n;
    const amount = (grant) => {
      const value = grant?.choose?.amount;
      return Number.isFinite(value) ? ` (${value > 0 ? "+" : "−"}${Math.abs(value)})` : "";
    };
    const who = (act.target?.who === "enemy") ? "enemy" : "ally";
    const picked = await BattleHud.#choose({
      token: token.document,
      skill: item.name,
      options: [
        { id: "one", label: `${i18n.localize(`FEO.Act.mode.one.${who}`)}${amount(act.grant)}` },
        { id: "all", label: `${i18n.localize(`FEO.Act.mode.all.${who}`)}${amount(act.all?.grant)}` }
      ]
    });
    if ( (this.#token !== token) || !this.#acting ) return;
    if ( picked === "all" ) {
      await this.#working(() => this.#useAct(id, null, null, "all"));
      return;
    }
    if ( picked === "one" ) {
      this.#mode = "act";
      this.#act = { skill: id, target: null };
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Have a unit choose on the map whom one of its skills is used on, as when the skill is used from its sheet:
   * its token is selected, and the units are offered.
   * @param {TokenDocument|null} token    The unit's token
   * @param {Item} item                   The skill
   * @returns {boolean}                   False if the map cannot offer them, as for a unit that is not on it
   */
  static #pickAct(token, item) {
    try {
      const app = BattleHud.#instance;
      const placed = token?.object;
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || !actOf(item?.system) ) return false;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#sync();
      if ( (app.#token !== placed) || !app.#view ) return false;
      app.#beginAct(item.id);
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * The skill being used was given its target, and the tile it asks for: it does its part, and is then used as
   * the unit sheet uses it.
   * @param {string} id               The skill
   * @param {Token} target            The unit it is used on
   * @param {{i: number, j: number}|null} [tile]
   * @param {"one"|"all"} [mode]      Is it used on every unit in its reach at once?
   * @returns {Promise<void>}
   */
  async #useAct(id, target, tile = null, mode = "one") {
    const token = this.#token;
    const item = token?.actor.items.get(id);
    this.#clear();
    const all = mode === "all";
    if ( !item || (!all && (!target || target.destroyed)) ) return;
    if ( !(await useAct(token.document, item, all ? null : target.document, tile, { mode })) ) {
      ui.notifications.warn(game.i18n.format("FEO.Act.failed", { skill: item.name }));
      return;
    }

    // The sheet names the one unit that is targeted on the card of the skill: another unit than its own
    for ( const targeted of Array.from(game.user.targets) ) targeted.setTarget(false, { releaseOthers: false });
    const named = (!all && (target !== token) && !target.destroyed) ? target : null;
    if ( named ) named.setTarget(true, { releaseOthers: true });
    try {
      await this.#sheetAction("useSkill", id, { acted: "true" });
    } finally {
      if ( named && !named.destroyed ) named.setTarget(false, { releaseOthers: false });
    }
  }

  /* -------------------------------------------- */

  /**
   * The map was clicked while the area of a skill is painted. Around the unit itself, a click inside the area,
   * on a unit it catches or on the unit confirms it; one that is centred on a tile or runs through a unit is
   * placed by a click on one of the tiles it may be placed on. A skill that shares HP out has a click on a unit
   * give it all it lacks, or take its share away again (with Shift, a little more; with Ctrl, a little less;
   * with Alt, its Shift Gauge), and a click on the unit itself uses it. A click anywhere else calls it off.
   * @param {{i: number, j: number}} tile     The tile that was clicked
   * @param {Token|null} token                The unit on it that was clicked, if one was
   * @param {Event} [event]
   */
  #onAreaClick(tile, token, event) {
    const act = this.#act;
    const mine = this.#token;
    const item = mine?.actor.items.get(act?.skill);
    if ( !item ) return;
    const on = (list) => (list ?? []).some((other) => (other.i === tile.i) && (other.j === tile.j));
    const lies = areaView(mine.document, item, tile);
    const off = () => {
      this.#clear();
      this.refresh();
    };
    if ( !lies ) return off();

    // Sharing HP out: each click on a unit changes its share, and the unit itself, or the button, uses it
    if ( lies.act.shares ) {
      if ( token === mine ) return void this.#confirmArea();
      const unit = token ? sharersOf(lies).find((other) => other === token.document) : null;
      if ( !unit ) return off();
      const gives = lies.act.shares.gives ?? 2;
      const step = event?.shiftKey ? gives : (event?.ctrlKey || event?.metaKey) ? -gives : "fill";
      act.shares = shareTo(mine.document, item, act.shares ?? {}, unit, { step, gauge: !!event?.altKey });
      this.refresh();
      return;
    }
    if ( lies.centred === "self" ) {
      const inside = (token === mine) || (token ? lies.units.includes(token.document) : (lies.tiles ? on(lies.tiles) : false));
      if ( !inside ) return off();
      this.#working(() => this.#useArea(act.skill, null));
      return;
    }
    if ( !lies.placed ) return off();
    // A trap is laid on a tile with nobody on it, and a creature appears on one; any other skill needs a unit
    // to do its part to
    if ( !lies.units.length && !lies.act.trap && !lies.act.makes ) {
      ui.notifications.warn(game.i18n.format("FEO.Area.empty", { skill: item.name }));
      return;
    }
    this.#working(() => this.#useArea(act.skill, lies.centre));
  }

  /* -------------------------------------------- */

  /**
   * Use the skill whose area is painted where it lies around its unit, as the button of the dock asks: for a
   * skill that shares HP out, with what was shared out.
   */
  #confirmArea() {
    if ( this.#mode === "staff" ) return void this.#confirmStaff();
    const act = this.#act;
    const item = this.#token?.actor.items.get(act?.skill);
    if ( !item || !act?.area || this.#busy ) return;
    if ( act.shares && !sharesTotal(act.shares) ) {
      ui.notifications.warn(game.i18n.format("FEO.Area.noShare", { skill: item.name }));
      return;
    }
    this.#working(() => this.#useArea(act.skill, null));
  }

  /* -------------------------------------------- */

  /**
   * The area of the skill being used was placed or confirmed: the skill does its part to every unit in it, and
   * is then used as the unit sheet uses it.
   * @param {string} id                           The skill
   * @param {{i: number, j: number}|null} at      Where its area was placed; nothing around the unit itself
   * @returns {Promise<void>}
   */
  async #useArea(id, at = null) {
    const token = this.#token;
    const item = token?.actor.items.get(id);
    const shares = this.#act?.shares ?? null;
    const picks = this.#act?.picks ?? null;
    this.#clear();
    if ( !item ) return;
    if ( !(await useArea(token.document, item, at, { shares, picks })) ) {
      ui.notifications.warn(game.i18n.format("FEO.Act.failed", { skill: item.name }));
      return;
    }

    // The card of the skill names no one unit: it has a row for each
    for ( const targeted of Array.from(game.user.targets) ) targeted.setTarget(false, { releaseOthers: false });
    await this.#sheetAction("useSkill", id, { acted: "true" });
  }

  /* -------------------------------------------- */

  /**
   * Offer a step a skill says its unit "may" take: its tiles and units are painted, and the next click on one
   * of them takes it. A click anywhere else passes, and so does the wait running out.
   * @param {import("../helpers/forced.mjs").StepOffer} offer
   * @returns {Promise<{tile?: object, unit?: TokenDocument}|null>|null}
   *          What was picked, or null when it was passed; null at once where the map cannot offer it
   */
  static #ask(offer) {
    try {
      const app = BattleHud.#instance;
      const placed = offer?.token?.object;
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || (offer.token.parent !== canvas.scene) ) return null;
      if ( !offer.tiles?.length && !offer.units?.length ) return null;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#settle(null, { quiet: true });
      return new Promise((resolve) => {
        const timer = setTimeout(() => app.#settle(null), FEO.forced.promptTime);
        app.#offer = { offer, resolve, timer };
        app.refresh();
      });
    } catch(err) {
      console.error(err);
      return null;
    }
  }

  /* -------------------------------------------- */

  /**
   * Answer the step that is offered, and take it off the map.
   * @param {{tile?: object, unit?: TokenDocument}|null} answer     What was picked; null to pass
   * @param {object} [options]
   * @param {boolean} [options.quiet]     Is the HUD being drawn anyway, so that it need not be drawn for this?
   */
  #settle(answer, { quiet = false } = {}) {
    const pending = this.#offer;
    if ( !pending ) return;
    this.#offer = null;
    clearTimeout(pending.timer);
    try {
      pending.resolve(answer);
    } catch(err) {
      console.error(err);
    }
    if ( !quiet ) this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Leave the owner of a unit a choice a skill gives them: a short list above the dock, of which a click
   * picks one. The Pass button passes, and so does the wait running out.
   * @param {{token: TokenDocument, skill: string, options: {id: string, label: string, hint?: string}[]}} ask
   * @returns {Promise<string|null>|null}     The option picked, by its id, or null when it was passed; null at
   *                                          once where the map cannot offer it
   */
  static #choose(ask) {
    try {
      const app = BattleHud.#instance;
      const placed = ask?.token?.object;
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || (ask.token.parent !== canvas.scene) ) return null;
      if ( !ask.options?.length ) return null;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#answer(null, { quiet: true });
      return new Promise((resolve) => {
        // How long it waits may be said with what is asked
        const timer = setTimeout(() => app.#answer(null), Number.isFinite(ask.wait) ? ask.wait : FEO.forced.promptTime);
        app.#choice = { ask, resolve, timer };
        app.refresh();
      });
    } catch(err) {
      console.error(err);
      return null;
    }
  }

  /* -------------------------------------------- */

  /**
   * Answer the choice that waits above the dock, and take it away.
   * @param {string|null} answer    The option picked, by its id; null to pass
   * @param {object} [options]
   * @param {boolean} [options.quiet]     Is the HUD being drawn anyway, so that it need not be drawn for this?
   */
  #answer(answer, { quiet = false } = {}) {
    const pending = this.#choice;
    if ( !pending ) return;
    this.#choice = null;
    clearTimeout(pending.timer);
    try {
      pending.resolve(pending.ask.options.some((option) => (option.id === answer) && !option.disabled) ? answer : null);
    } catch(err) {
      console.error(err);
    }
    if ( !quiet ) this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * The way the Refresh being used is used, where that is not the regular one.
   * @returns {import("../rules/refresh.mjs").RefreshOption|null}
   */
  #refreshOption() {
    const id = this.#refresh?.option;
    if ( !id || !this.#token ) return null;
    return refreshOptionsOf(this.#token.document).find((way) => way.id === id) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * A unit was clicked while an ally to Refresh is being chosen. One the Refresh may not be used on is told
   * why. A Refresh for every ally in reach is used at once; one for several has them picked one by one, and is
   * used once as many are picked as it reaches, or when an ally that is picked is clicked again.
   * @param {Token} token
   */
  #pickForRefresh(token) {
    const mine = this.#token.document;
    const state = this.#refresh;
    if ( !state ) return;
    const option = this.#refreshOption();
    const open = refreshesOf(mine, { option }).map((entry) => entry.token);
    if ( !open.includes(token.document) ) {
      const tried = refreshOf(mine, token.document, { option });
      ui.notifications.warn(game.i18n.format(`FEO.Refresh.blocked.${tried?.why ?? "apart"}`, { name: token.document.name || token.actor?.name || "" }));
      return;
    }
    const most = Math.min(refreshCount(mine), open.length);
    if ( !Number.isFinite(refreshCount(mine)) ) {
      this.#singFor(open.map((target) => target.object).filter(Boolean));
      return;
    }
    if ( state.picked.includes(token) ) {
      this.#singFor(state.picked);
      return;
    }
    state.picked.push(token);
    if ( state.picked.length >= most ) this.#singFor(state.picked);
    else this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Use the Refresh being used on the allies picked for it.
   * @param {Token[]} picked
   */
  #singFor(picked) {
    const mine = this.#token?.document;
    const option = this.#refresh?.option ?? "";
    const targets = (picked ?? []).filter((target) => !target.destroyed).map((target) => target.document);
    this.#clear();
    if ( !mine || !targets.length ) {
      this.refresh();
      return;
    }
    this.#working(() => refreshUnits(mine, targets, { option }));
  }

  /* -------------------------------------------- */

  /**
   * The tiles the click that is waited for may fall on while a mine or a trap is being laid: those it may lie
   * on, or for one that warps and has its tile, those it may send a unit to.
   * @returns {{i: number, j: number}[]}
   */
  #layTiles() {
    const token = this.#token;
    const lay = this.#lay;
    const item = (token && lay) ? token.actor.items.get(lay.item) : null;
    const trap = trapItemOf(item);
    if ( !trap ) return [];
    try {
      return lay.at ? warpTilesFor(token.document.parent, lay.at, trap) : layTilesOf(token.document, item);
    } catch(err) {
      console.error(err);
      return [];
    }
  }

  /* -------------------------------------------- */

  /**
   * Have the selected unit lay a mine or a trap with one of its items: the tiles next to it that it may lie on
   * are painted, and the next click on one of them lays it. Whatever stands in the way is said instead.
   * @param {TokenDocument} token
   * @param {Item} item
   * @returns {boolean}     Whether the map took the pick over
   */
  static #pickTrap(token, item) {
    try {
      const app = BattleHud.#instance;
      const placed = token?.object;
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || (token.parent !== canvas.scene) || !trapItemOf(item) ) return false;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#sync();
      if ( (app.#token !== placed) || !app.#view ) return false;
      app.#clear();
      const name = token.name || token.actor.name;
      if ( !app.#acting || app.#view.onlyWait ) ui.notifications.warn(game.i18n.format("FEO.Trap.notNow", { item: item.name, name }));
      else if ( !layTilesOf(token, item).length ) ui.notifications.warn(game.i18n.format("FEO.Trap.nowhere", { item: item.name, name }));
      else {
        app.#mode = "lay";
        app.#lay = { item: item.id, at: null };
      }
      app.refresh();
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Begin warping the selected unit with one of its skills: the tiles it can land on are painted, and the next
   * click on one of them warps it there. Whatever stands in the way is said instead.
   * @param {string} id     The skill
   */
  #beginWarp(id) {
    const token = this.#token;
    const view = this.#view;
    const item = token?.actor.items.get(id);
    const warp = warpOf(item?.system);
    this.#clear();
    if ( warp && view ) {
      const able = canUse(item.system.usage, item.system.state);
      const blocked = !this.#acting ? "FEO.Hud.warp.notNow"
        : !able.ok ? `FEO.Usage.blocked.${able.reason}`
        : (warp.unmoved && view.moved) ? "FEO.Hud.warp.moved"
        : !warpTilesOf(view, warp).size ? "FEO.Hud.warp.nowhere"
        : null;
      if ( blocked ) {
        ui.notifications.warn(game.i18n.format(blocked, { skill: item.name, name: token.document.name || token.actor.name }));
      } else {
        this.#mode = "warp";
        this.#warp = { skill: id };
      }
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Begin warping a unit with one of the selected unit's staves: the tiles the staff can set it down on are
   * painted, and the next click on one of them uses the staff. Whatever stands in the way is said instead.
   * @param {string} id               The staff
   * @param {Token|null} [target]     The unit it is used on; none for a staff that warps its user
   */
  #beginStaffWarp(id, target = null) {
    const token = this.#token;
    const item = token?.actor.items.get(id);
    const warp = staffWarpOf(item);
    this.#clear();
    if ( warp && this.#view ) {
      const moved = (warp.moves === "self") ? token : target;
      const blocked = !this.#acting ? "FEO.Hud.warp.notNow"
        : !moved ? "FEO.Hud.warp.outOfReach"
        : !staffWarpTilesOf(token.document, item, moved.document).size ? "FEO.Hud.warp.nowhere"
        : null;
      if ( blocked ) {
        ui.notifications.warn(game.i18n.format(blocked, { skill: item.name, name: token.document.name || token.actor.name }));
      } else {
        this.#mode = "warp";
        this.#warp = { staff: id, target: (warp.moves === "self") ? null : target };
      }
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * A tile to warp to was chosen. With a skill the selected unit is set down there at once, whatever lies
   * between, and the skill is used as the unit sheet uses it. A staff is used as the sheet uses it, which sets
   * its unit down there unless the staff fails.
   * @param {{i: number, j: number}} tile
   * @returns {Promise<void>}
   */
  async #warpTo(tile) {
    const document = this.#token?.document;
    const picked = this.#warp;
    this.#clear();
    if ( !document || !picked ) return;
    if ( picked.staff ) {
      await this.#castStaff(picked.staff, picked.target, { warpI: String(tile.i), warpJ: String(tile.j) });
      return;
    }
    const item = document.actor.items.get(picked.skill);
    if ( !item || !canUse(item.system.usage, item.system.state).ok ) return;
    if ( !(await warpToken(document, tile)) ) {
      ui.notifications.warn("FEO.Hud.warp.failed", { localize: true });
      return;
    }
    await this.#sheetAction("useSkill", picked.skill, { warped: "true" });
  }

  /* -------------------------------------------- */

  /**
   * Have a unit choose the tile one of its skills warps it to, as when the skill is used from its sheet: its
   * token is selected, and the tiles are offered on the map.
   * @param {TokenDocument|null} token    The unit's token
   * @param {Item} item                   The skill
   * @returns {boolean}                   False if the map cannot offer the tiles, as for a unit that is not on it
   */
  static #pickWarp(token, item) {
    try {
      const app = BattleHud.#instance;
      const placed = token?.object;
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || !warpOf(item?.system) ) return false;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#sync();
      if ( (app.#token !== placed) || !app.#view ) return false;
      app.#beginWarp(item.id);
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Have a unit choose the tile one of its staves warps a unit to, as when the staff is used from its sheet:
   * its token is selected, and the tiles are offered on the map. A staff that moves another unit is used on the
   * one unit that is targeted; with none targeted, that unit is chosen on the map first. A staff that leaves no
   * tile to choose is used at once.
   * @param {TokenDocument|null} token    The token of the unit that uses the staff
   * @param {Item} item                   The staff
   * @param {Token|null} [ally]           The unit the user has targeted
   * @returns {boolean}                   False if the map cannot offer the tiles, as for a unit that is not on it
   */
  static #pickStaffWarp(token, item, ally = null) {
    try {
      const app = BattleHud.#instance;
      const placed = token?.object;
      const warp = staffWarpOf(item);
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || !warp ) return false;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#sync();
      if ( (app.#token !== placed) || !app.#view ) return false;
      const warn = (key, name) => ui.notifications.warn(game.i18n.format(key, { skill: item.name, name }));
      app.#clear();
      if ( warp.moves === "self" ) app.#beginStaffWarp(item.id);
      else if ( !app.#acting ) warn("FEO.Hud.warp.notNow", token.name || token.actor.name);
      else if ( !ally ) {
        app.#mode = "staff";
        app.#staff = item.id;
      }
      else if ( !app.#staffTakes(ally, item) ) warn("FEO.Hud.warp.outOfReach", ally.document.name || ally.actor.name);
      else if ( staffWarpChosen(warp) ) app.#beginStaffWarp(item.id, ally);
      else app.#working(() => app.#castStaff(item.id, ally, { warpNow: "true" }));
      app.refresh();
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Have the unit sheet's own handler do something for the selected unit, so that the dock and the sheet do
   * exactly the same.
   * @param {string} name             A key of the sheet's actions
   * @param {string|null} [itemId]    The item the action is about, if it is about one
   * @param {object} [data]           What else the clicked element says, as the sheet's own would
   * @returns {Promise<void>}
   */
  async #sheetAction(name, itemId = null, data = {}) {
    const actor = this.#token?.actor;
    const handler = UnitSheet.DEFAULT_OPTIONS.actions[name];
    if ( !actor || (typeof handler !== "function") ) return;
    const sheet = (actor.sheet instanceof UnitSheet) ? actor.sheet : new UnitSheet({ document: actor });

    // The sheet finds the item an action is about from the element that was clicked
    const row = itemId ? { dataset: { itemId } } : null;
    await handler.call(sheet, new Event("click"), { dataset: { ...data, ...(row?.dataset ?? {}) }, closest: () => row });
  }

  /* -------------------------------------------- */

  /**
   * Use the picked staff on a unit, or on nobody if the unit itself was clicked. A staff that moves the unit to
   * a tile of its user's choosing has that tile chosen next, and is used then.
   * @param {Token} token
   * @returns {Promise<void>}
   */
  async #useStaffOn(token) {
    const staff = this.#staff;
    const mine = this.#token;
    const item = mine?.actor.items.get(staff);
    if ( !item ) return;
    const other = token !== mine;
    const plan = staffPlanOf(mine.actor, item);

    // A staff for several units is used on all it catches: a click on one of them, or on its unit, confirms
    // it, and a click on any other unit calls it off
    if ( ["allies", "enemies"].includes(plan.on) ) {
      const area = staffAreaOf(mine.document, item);
      if ( !other || area?.units.includes(token.document) ) this.#confirmStaff();
      else {
        this.#clear();
        this.refresh();
      }
      return;
    }

    // One that opens a door or a chest answers for the tile the unit stands on
    if ( plan.on === "object" ) {
      const there = tokenTile(token.document);
      if ( there ) this.#onStaffTile({ i: there.i, j: there.j });
      return;
    }

    // A unit it may not be used on is told why, and the staff still waits
    if ( plan.on === "unit" ) {
      const tried = staffTakesOf(mine.document, item, token.document);
      if ( !tried.ok ) {
        ui.notifications.warn(staffWhy(mine.document, item, token.document, tried.why, tried.reach));
        return;
      }
    }
    const warp = other ? staffWarpOf(item) : null;
    if ( warp && staffWarpChosen(warp) ) {
      this.#beginStaffWarp(staff, token);
      return;
    }

    // A staff that moves its unit to a tile nobody chooses is used at once, and told that the map is done
    await this.#working(() => this.#castStaff(staff, other ? token : null, warp ? { warpNow: "true" } : {}));
  }

  /* -------------------------------------------- */

  /**
   * A tile was clicked while a staff waits for what it is used on: one that opens doors and chests is used on
   * the one that stands there, if it reaches it; anything else calls the staff off.
   * @param {{i: number, j: number}} tile
   */
  #onStaffTile(tile) {
    const staff = this.#staff;
    const mine = this.#token;
    const item = mine?.actor.items.get(staff);
    const found = item ? staffObjectsOf(mine.document, item).find((object) => (object.i === tile.i) && (object.j === tile.j)) : null;
    if ( found ) this.#working(() => this.#castStaff(staff, null, { objectI: String(tile.i), objectJ: String(tile.j) }));
    else {
      this.#clear();
      this.refresh();
    }
  }

  /* -------------------------------------------- */

  /**
   * Use the staff for several units that was picked on every unit it catches, as a click on one of them or
   * the button of the dock asks. With nobody for it to be used on, that is said instead.
   */
  #confirmStaff() {
    const staff = this.#staff;
    const mine = this.#token;
    const item = mine?.actor.items.get(staff);
    const area = item ? staffAreaOf(mine.document, item) : null;
    if ( !area || this.#busy ) return;
    if ( !area.units.length ) {
      ui.notifications.warn(staffWhy(mine.document, item, null, "nobody", area.reach));
      return;
    }
    this.#working(() => this.#castStaff(staff, null, {}));
  }

  /* -------------------------------------------- */

  /**
   * Have a unit's attack on a foe forecast on the map, as when it attacks from its sheet with that foe targeted:
   * its token is selected, and the forecast opens as it does for a click on the foe, with the same numbers and
   * the same choices. An attack the map cannot make, as on a foe out of reach, is left to whoever asked.
   * @param {TokenDocument|null} token    The token of the unit that attacks
   * @param {Token|null} target           The foe it attacks
   * @returns {boolean}                   Whether the map took it over
   */
  static #pickAttack(token, target) {
    try {
      const app = BattleHud.#instance;
      const placed = token?.object;
      if ( !app || !placed || !target || !canvas?.ready || !canvas.scene?.grid?.isSquare || (token.parent !== canvas.scene) ) return false;
      if ( target.document?.parent !== canvas.scene ) return false;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#sync();
      if ( (app.#token !== placed) || !app.#view || !app.#acting || app.#busy ) return false;
      const forecast = app.#planForecast(target);
      if ( !forecast ) return false;
      app.#clear();
      app.#forecast = forecast;
      app.refresh();
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Have a unit choose on the map what one of its staves is used on, as when the staff is used from its sheet
   * with nothing pointed out: its token is selected, and the staff waits for a click.
   * @param {TokenDocument|null} token    The token of the unit that uses the staff
   * @param {Item} item                   The staff
   * @returns {boolean}                   Whether the map took it over
   */
  static #pickStaff(token, item) {
    try {
      const app = BattleHud.#instance;
      const placed = token?.object;
      if ( !app || !placed || !canvas?.ready || !canvas.scene?.grid?.isSquare || (token.parent !== canvas.scene) ) return false;
      if ( !placed.controlled || (canvas.tokens.controlled.length > 1) ) placed.control({ releaseOthers: true });
      app.#sync();
      if ( (app.#token !== placed) || !app.#view || !app.#acting ) return false;
      app.#clear();
      app.#mode = "staff";
      app.#staff = item.id;
      app.refresh();
      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Have the unit sheet use one of the selected unit's staves, on a unit or on nobody.
   * @param {string} staff            The staff
   * @param {Token|null} [target]     The unit it is used on
   * @param {object} [data]           What else the sheet is told: the tile a staff that warps sets its unit down on
   * @returns {Promise<void>}
   */
  async #castStaff(staff, target = null, data = {}) {

    // The sheet uses a staff on the one unit that is targeted
    for ( const targeted of Array.from(game.user.targets) ) targeted.setTarget(false, { releaseOthers: false });
    if ( target && !target.destroyed ) target.setTarget(true, { releaseOthers: true });
    try {
      await this.#sheetAction("useStaff", staff, data);
    } finally {
      if ( target && !target.destroyed ) target.setTarget(false, { releaseOthers: false });
      this.#clear();
    }
  }

  /* -------------------------------------------- */
  /*  Buttons                                     */
  /* -------------------------------------------- */

  /**
   * Select a unit of the roster.
   * @this {BattleHud}
   */
  static #onPick(event, target) {
    const token = canvas.tokens.get(target.dataset.tokenId);
    if ( !token ) return;
    if ( token.document.isOwner ) token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  }

  /* -------------------------------------------- */

  /**
   * End the running Phase.
   * @this {BattleHud}
   */
  static async #onEndPhase() {
    await this.#working(() => requestEndPhase());
  }

  /* -------------------------------------------- */

  /**
   * Begin a battle with every unit on the scene.
   * @this {BattleHud}
   */
  static async #onBeginBattle() {
    await this.#working(() => beginBattle(canvas.scene));
  }

  /* -------------------------------------------- */

  /**
   * End the battle being fought here, once the Game Master has confirmed it.
   * @this {BattleHud}
   */
  static async #onEndBattle() {
    await this.#working(() => endBattle(battle()));
  }

  /* -------------------------------------------- */

  /**
   * The weather of the map: the Game Master picks the kinds that are switched on.
   * @this {BattleHud}
   */
  static async #onWeather() {
    if ( !game.user.isGM ) return;
    await pickWeather(canvas.scene);
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * The Affinity of the map: the Game Master picks it, or none.
   * @this {BattleHud}
   */
  static async #onMapAffinity() {
    if ( !game.user.isGM ) return;
    await pickMapAffinity(canvas.scene);
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Attack: the next click on a foe within reach opens the forecast. With one foe already targeted, the
   * forecast against it opens at once.
   * @this {BattleHud}
   */
  static #onAttack() {
    if ( !this.#acting ) return;
    const entering = this.#mode !== "target";
    this.#clear();
    if ( entering ) {
      const targets = Array.from(game.user.targets).filter((token) => token !== this.#token);
      const forecast = (targets.length === 1) ? this.#planForecast(targets[0]) : null;
      if ( forecast ) this.#forecast = forecast;
      else this.#mode = "target";
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Shove: the next click on a unit next to the selected one that it may shove slides that unit a space on.
   * @this {BattleHud}
   */
  static #onShove() {
    if ( !this.#acting ) return;
    const entering = this.#mode !== "shove";
    this.#clear();
    if ( entering ) this.#mode = "shove";
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Steal: the next click on an enemy next to the selected unit that it may steal from lists that enemy's pack.
   * @this {BattleHud}
   */
  static #onSteal() {
    if ( !this.#acting ) return;
    const entering = this.#mode !== "steal";
    this.#clear();
    if ( entering ) this.#mode = "steal";
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Open: the next click on a door, a chest or a Village the selected unit can act on from where it stands
   * does what it would do there.
   * @this {BattleHud}
   */
  static #onObject() {
    if ( !this.#acting ) return;
    const entering = this.#mode !== "object";
    this.#clear();
    if ( entering ) this.#mode = "object";
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * List the pack of the enemy a unit steals from above the dock: what it cannot take is greyed, with the
   * reason on hover, and a click on anything else takes it.
   * @param {TokenDocument} mine
   * @param {TokenDocument} target
   * @param {import("../rules/stealing.mjs").StealTry} tried
   * @param {string} name       The enemy's name
   * @returns {Promise<void>}
   */
  async #pickFromPack(mine, target, tried, name) {
    const picked = await BattleHud.#choose({
      token: mine,
      skill: game.i18n.format("FEO.Steal.from", { name }),
      hint: game.i18n.localize("FEO.Steal.hint"),
      options: packOptions(tried.items),
      wait: FEO.stealing.pickTime
    });
    if ( picked ) await this.#working(() => stealUnit(mine, target, picked));
    else this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Refresh: the next click on an ally in reach that has acted has it move and act again. A unit with other
   * ways to use its Refresh picks one from a short list first.
   * @this {BattleHud}
   */
  static #onRefresh() {
    if ( !this.#acting ) return;
    const entering = (this.#mode !== "refresh") && (this.#flyout !== "refresh");
    const ways = entering ? refreshOptionsOf(this.#token.document) : [];
    this.#clear();
    if ( entering && ways.length ) this.#flyout = "refresh";
    else if ( entering ) {
      this.#mode = "refresh";
      this.#refresh = { option: "", picked: [] };
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * A way to use Refresh was picked from the list: the allies it may be used on that way are offered.
   * @this {BattleHud}
   */
  static #onPickRefresh(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId ?? "";
    this.#clear();
    if ( this.#acting ) {
      this.#mode = "refresh";
      this.#refresh = { option: (id === "regular") ? "" : id, picked: [] };
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Refresh the allies picked so far, where more could still be picked.
   * @this {BattleHud}
   */
  static #onSing() {
    this.#singFor(this.#refresh?.picked ?? []);
  }

  /* -------------------------------------------- */

  /**
   * One of the options of a choice that waits above the dock was picked.
   * @this {BattleHud}
   */
  static #onChoose(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId ?? null;

    // What is greyed in the list cannot be picked, and leaves the choice waiting
    if ( this.#choice?.ask.options.some((option) => (option.id === id) && option.disabled) ) return;
    this.#answer(id);
  }

  /* -------------------------------------------- */

  /**
   * A skill was ticked in the forecast: it is switched on for the fight, or off again, as from the list of
   * skills, and the forecast follows.
   * @this {BattleHud}
   */
  static async #onForecastSkill(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId ?? null;
    if ( !id || !this.#forecast || !this.#acting ) return;

    // The unit's Affinity is ticked the same way, and keeps where it stands on the unit
    await this.#working(() => this.#sheetAction((id === AFFINITY_ID) ? "switchAffinity" : "switchSkill", id));
  }

  /* -------------------------------------------- */

  /**
   * The steps picked for a skill in the forecast were changed: one more, one less, or all or none of them.
   * @this {BattleHud}
   */
  static async #onForecastStep(event, target) {
    const item = this.#token?.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    const pick = target.closest("[data-pick]")?.dataset.pick;
    const told = this.#forecast?.plan.initiator.unit.fx?.picks?.[`${item?.name}|${pick}`];
    if ( !item || !pick || !told || !this.#acting ) return;
    await this.#working(() => stepChoice(item, pick, target.dataset.how, told));
  }

  /* -------------------------------------------- */

  /**
   * The stat a skill has its unit pick was clicked in the forecast: the stats are listed above the dock, with
   * what the foe would lose of each, and the one picked is kept on the skill.
   * @this {BattleHud}
   */
  static async #onForecastStat(event, target) {
    const token = this.#token;
    const item = token?.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    const forecast = this.#forecast;
    if ( !item || !forecast || !this.#acting || this.#busy ) return;
    const bonuses = bonusesOf(forecast.plan.defender.unit.fx?.sources ?? []);
    const i18n = game.i18n;
    const picked = await BattleHud.#choose({
      token: token.document,
      skill: item.name,
      options: [
        { id: "best", label: i18n.localize("FEO.Choice.stat.best"), hint: i18n.localize("FEO.Choice.stat.bestHint") },
        ...BONUS_STATS.map((stat) => ({
          id: stat,
          label: i18n.localize(FEO.stats[stat].label),
          hint: bonuses[stat] ? i18n.format("FEO.Choice.stat.bonus", { name: forecast.target.document.name, amount: bonuses[stat] }) : ""
        }))
      ]
    });
    if ( picked ) await pickStat(item, (picked === "best") ? "" : picked);
  }

  /* -------------------------------------------- */

  /**
   * Trade: the next click on an ally next to the selected unit lists what the two carry.
   * @this {BattleHud}
   */
  static #onTrade() {
    if ( !this.#acting ) return;
    const entering = this.#mode !== "trade";
    this.#clear();
    if ( entering ) this.#mode = "trade";
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * List what a unit and the ally it trades with carry above the dock: a click on something of its own gives
   * it, a click on something of the ally's takes it, and the list comes back until it is passed, as a unit
   * trades as often as it likes.
   * @param {TokenDocument} mine
   * @param {TokenDocument} target
   * @returns {Promise<void>}
   */
  async #tradeWith(mine, target) {
    const i18n = game.i18n;
    const name = target.name || target.actor?.name || "";
    for ( let count = 0; count < 40; count++ ) {
      const tried = tradeOf(mine, target);
      if ( !tried?.ok ) break;
      const options = tradeRows(tried).map(({ id, way, item }) => ({
        id,
        label: item.name,
        img: item.img ?? "",
        hint: !item.ok ? i18n.localize(`FEO.Trade.kept.${item.why}`)
          : `${i18n.format((way === "give") ? "FEO.Trade.giveHint" : "FEO.Trade.takeHint", { name })}${item.equipped ? ` · ${i18n.localize("FEO.Trade.inHand")}` : ""}`,
        end: `${item.uses ? `${item.uses} · ` : ""}${i18n.localize((way === "give") ? "FEO.Trade.give" : "FEO.Trade.take")}`,
        disabled: !item.ok,
        tip: item.ok ? "" : i18n.localize(`FEO.Trade.keptTip.${item.why}`)
      }));
      const picked = readTrade(await BattleHud.#choose({
        token: mine, skill: i18n.format("FEO.Trade.with", { name }), hint: i18n.localize("FEO.Trade.pick"), options, wait: FEO.trading.pickTime
      }));
      if ( !picked ) break;
      let done = false;
      await this.#working(async () => { done = await tradeUnit(mine, target, picked.way, picked.item); });
      if ( !done ) break;
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Shift: the selected unit changes into its animal form, or back out of it. It is no Action, but its move
   * ends there unless a skill lets it move on.
   * @this {BattleHud}
   */
  static async #onShift() {
    const token = this.#token;
    if ( !token?.actor?.isOwner ) return;
    this.#clear();
    await this.#working(async () => {
      if ( await toggleShift(token.actor) ) await afterFree(token.document, "shift", game.i18n.localize("FEO.Shift.shift"));
    });
  }

  /* -------------------------------------------- */

  /**
   * Rescue: the next click on an ally next to the selected unit picks it up, or takes over the unit it
   * carries. For a unit that carries an ally, the next click on a tile next to it Drops that ally there, and
   * one on an ally next to it Gives it away.
   * @this {BattleHud}
   */
  static #onRescue() {
    if ( !this.#acting ) return;
    const mode = passengerOf(this.#token?.actor) ? "drop" : "rescue";
    const entering = this.#mode !== mode;
    this.#clear();
    if ( entering ) this.#mode = mode;
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * A unit that another has hold of uses its Action to try to break free.
   * @this {BattleHud}
   */
  static async #onBreakFree() {
    const token = this.#token;
    if ( !token || !this.#acting ) return;
    this.#clear();
    await this.#working(() => retryGrip(token.document, { action: true }));
  }

  /* -------------------------------------------- */

  /**
   * A skill used on a unit was picked from the list: the next click on a unit it may be used on uses it there.
   * @this {BattleHud}
   */
  static #onPickAct(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if ( id ) this.#beginAct(id);
  }

  /* -------------------------------------------- */

  /**
   * The selected unit, which imitates another, reverts to itself: at will, and as no Action.
   * @this {BattleHud}
   */
  static async #onRevertImitation() {
    const token = this.#token;
    if ( !token?.actor?.isOwner ) return;
    this.#clear();
    await this.#working(() => revertUnit(token.actor));
  }

  /* -------------------------------------------- */

  /**
   * Pass the step that is offered.
   * @this {BattleHud}
   */
  static #onPass() {
    this.#settle(null);
    this.#answer(null);
  }

  /* -------------------------------------------- */

  /**
   * Open one of the lists above the dock, or close it.
   * @this {BattleHud}
   */
  static #onFlyout(event, target) {
    const list = target.dataset.action;
    const open = this.#flyout !== list;
    this.#clear();
    if ( open ) this.#flyout = list;
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Open the selected unit's sheet.
   * @this {BattleHud}
   */
  static #onSheet() {
    this.#token?.actor.sheet.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Take back the selected unit's move.
   * @this {BattleHud}
   */
  static async #onUndo() {
    this.#forecast = null;
    await this.#working(() => this.#undoMove());
  }

  /* -------------------------------------------- */

  /**
   * A staff was picked from the list: the next click on a unit within its reach uses it there. A staff that
   * warps its user needs no unit, and has the tile chosen at once.
   * @this {BattleHud}
   */
  static #onPickStaff(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = id ? this.#token?.actor.items.get(id) : null;
    if ( item && (staffWarpOf(item)?.moves === "self") ) {
      this.#beginStaffWarp(id);
      return;
    }

    // A staff that is used on nothing the map shows is used at once
    if ( item && this.#acting && ["nobody", "fallen"].includes(staffPlanOf(this.#token.actor, item).on) ) {
      this.#clear();
      this.#working(() => this.#castStaff(id, null, {}));
      return;
    }
    this.#clear();
    if ( id && this.#acting ) {
      this.#mode = "staff";
      this.#staff = id;
    }
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * A skill that warps the unit was picked from the list: the next click on a tile it reaches warps it there.
   * @this {BattleHud}
   */
  static #onPickWarp(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if ( id ) this.#beginWarp(id);
  }

  /* -------------------------------------------- */

  /**
   * A weapon a skill lends the unit was picked from the list of its weapons: the unit takes it up to attack
   * with, in place of the weapon in its hand, or puts it down again. The list stays open, as for any weapon.
   * @this {BattleHud}
   */
  static async #onLendWeapon(event, target) {
    const token = this.#token;
    const key = target.closest("[data-item-id]")?.dataset.itemId ?? null;
    if ( !token?.actor || !key ) return;
    const entry = lentList(token.actor).find((other) => other.key === key);
    if ( !entry || entry.auto || !entry.ready ) return;
    await this.#working(() => takeUp(token.actor, entry.on ? null : key));
  }

  /* -------------------------------------------- */

  /**
   * One of the unit sheet's actions was asked for from the dock.
   * @this {BattleHud}
   */
  static async #onSheetAction(event, target) {
    const name = target.dataset.action;
    const id = target.closest("[data-item-id]")?.dataset.itemId ?? null;

    // Switching a weapon or a skill leaves the list open, and so does showing something in the chat; anything
    // else is done with it
    if ( !["toggleEquip", "switchSkill", "switchAffinity", "toggleForm", "readyArt", "toggleCapture", "postItem"].includes(name) ) this.#clear();
    const { form } = target.dataset;
    await this.#working(() => this.#sheetAction(name, id, form ? { form } : {}));
  }

  /* -------------------------------------------- */

  /**
   * Commit to the attack being forecast: the unit moves into place if it has to, and the exchange is rolled.
   * @this {BattleHud}
   */
  static async #onConfirm() {
    const forecast = this.#forecast;
    const token = this.#token;
    if ( !forecast || !token || forecast.plan.initiator.blocked ) return;
    await this.#working(async () => {
      // A unit whose move was ended on the way to the tile it would attack from does not attack from there
      const moved = forecast.moves ? await this.#moveTo(forecast.from.tile) : true;
      if ( moved !== true ) {
        if ( !moved ) ui.notifications.warn("FEO.Hud.moveFailed", { localize: true });
        this.#forecast = null;
        return;
      }
      this.#forecast = null;

      // The forecast was shown here, so nothing more is asked before the dice are rolled. A fight a skill
      // starts as one of several rounds is fought that way, and uses the skill
      await fightTarget(token.actor, token.document, forecast.target, {
        confirm: async (matchup) => matchup.distance,
        rounds: forecast.bout?.rounds ? { rounds: forecast.bout.rounds, skill: forecast.bout.skill, item: forecast.bout.item } : null,
        extra: forecast.bout?.strike ?? null
      });
    });
  }

  /* -------------------------------------------- */

  /**
   * Use the skill whose area is painted around its unit.
   * @this {BattleHud}
   */
  static #onConfirmArea() {
    this.#confirmArea();
  }

  /* -------------------------------------------- */

  /**
   * Call off whatever was being picked or forecast.
   * @this {BattleHud}
   */
  static #onCancel() {
    this.#clear();
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Something was picked on the palette of the terrain brush: a kind of terrain, a height, a zone, or the
   * eraser. Picking a kind of terrain or a height puts the eraser down.
   * @this {BattleHud}
   */
  static #onBrush(event, target) {
    const { terrain, elevation, erase, object, zone } = target.dataset;
    const brush = mapTools.brush;

    // A door, a chest or a Village takes the place of the paint, and is put down by picking it again
    if ( object !== undefined ) Object.assign(brush, { object: (brush.object === object) ? null : object, erase: false, zone: null });

    // So does a zone, which the eraser then takes off without touching the ground under it
    else if ( zone !== undefined ) Object.assign(brush, { zone: (brush.zone === zone) ? null : zone, erase: false, object: null });
    else if ( erase !== undefined ) Object.assign(brush, { erase: !brush.erase, object: null });
    else if ( terrain !== undefined ) Object.assign(brush, { terrain: terrain || null, erase: false, object: null, zone: null });
    else if ( elevation !== undefined ) Object.assign(brush, { elevation: elevation === "" ? null : Number(elevation), erase: false, object: null, zone: null });
    this.refresh({ parts: ["palette"] });
  }

  /* -------------------------------------------- */

  /**
   * Draw the painted ground on the map for everyone, or stop doing so.
   * @this {BattleHud}
   */
  static async #onBrushShow() {
    const scene = canvas.scene;
    await this.#working(() => showPaint(scene, !paintShown(scene)));
  }
}

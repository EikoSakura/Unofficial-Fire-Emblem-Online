import { battleCanvas, movedByClick, registerBattleCanvas } from "../canvas/battle-canvas.mjs";
import { mapTile, mapTools, registerMapLayer } from "../canvas/map-layer.mjs";
import { FEO } from "../config.mjs";
import { attackFrom, reachOf, standsTo, threatOf, warpTilesOf, waypointsTo } from "../helpers/battle-map.mjs";
import { armyOf, planAttack, tokenTile } from "../helpers/exchange.mjs";
import { fightTarget } from "../helpers/fight.mjs";
import { paintShown, showPaint } from "../helpers/paint.mjs";
import {
  END_PHASE_QUERY, battle, beginBattle, clearBattle, endBattle, endPhaseQuery, fieldOf, foughtHere, originOf, phaseBegunBy,
  phaseOf, requestEndPhase, sidesOf, turnState, unitsOf
} from "../helpers/phases.mjs";
import { moverOf, registerGround, tileGround } from "../helpers/terrain.mjs";
import { staffWarpAllows, staffWarpOf, staffWarpTilesOf, warpToken } from "../helpers/warp.mjs";
import { parseRange } from "../rules/combat.mjs";
import { tileKey, tilesApart, wayBetween } from "../rules/reach.mjs";
import { canUse } from "../rules/skill-usage.mjs";
import { staffSide } from "../rules/staves.mjs";
import { moveCost } from "../rules/terrain.mjs";
import { staffWarpChosen, warpOf } from "../rules/warp.mjs";
import UnitSheet from "../sheets/unit-sheet.mjs";
import {
  buildDock, buildHover, buildHudForecast, buildPalette, buildPhase, buildSplash, buildTerrain
} from "./battle-hud-context.mjs";
import { clearSplash, playSplash } from "./phase-splash.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${FEO.id}/templates/hud`;

/** The actions of the unit sheet that the dock may ask for by name, each for the selected unit. */
const SHEET_ACTIONS = ["wait", "startTurn", "endTurn", "spendRound", "toggleEquip", "useItem", "useSkill", "switchSkill", "toggleForm", "readyArt", "useGambit"];

/** Those of Capturing, asked for in the same way: readying an attempt, picking up and releasing a captive. */
const CAPTURE_ACTIONS = ["toggleCapture", "pickUpCaptive", "releaseCaptive"];

/** How long the pointer rests on a tile before the terrain card says more of it, in milliseconds. */
const REST_TIME = 700;

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
      attack: BattleHud.#onAttack,
      staff: BattleHud.#onFlyout,
      skill: BattleHud.#onFlyout,
      item: BattleHud.#onFlyout,
      equip: BattleHud.#onFlyout,
      sheet: BattleHud.#onSheet,
      undo: BattleHud.#onUndo,
      pickStaff: BattleHud.#onPickStaff,
      pickWarp: BattleHud.#onPickWarp,
      confirm: BattleHud.#onConfirm,
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

  /** The list that is open above the dock: equip, staff, skill or item. @type {string|null} */
  #flyout = null;

  /**
   * What the next click on the map means: `target` for an attack on a token, `staff` for the staff picked, `warp`
   * for a tile to warp to.
   * @type {string|null}
   */
  #mode = null;

  /** The staff picked from the list, waiting for a unit to use it on. @type {string|null} */
  #staff = null;

  /**
   * What warps a unit, waiting for a tile to warp it to: a skill of the selected unit, which warps that unit, or
   * one of its staves, which warps the ally it was used on or, with no target, the unit itself.
   * @type {{skill: string}|{staff: string, target: Token|null}|null}
   */
  #warp = null;

  /**
   * The attack being forecast: its target, the tile to make it from and the plan of the exchange.
   * @type {{target: Token, from: object, moves: boolean, plan: object, measured: number|null}|null}
   */
  #forecast = null;

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
    mapTools.listener = refresh;
    game.feo.hud = {
      app: BattleHud, refresh, beginBattle, endBattle, endPhase: requestEndPhase,
      pickWarp: (token, item) => BattleHud.#pickWarp(token, item),
      pickStaffWarp: (token, item, ally) => BattleHud.#pickStaffWarp(token, item, ally)
    };

    battleCanvas.listener = {
      wantsToken: (token, event) => !!hud()?.#wantsToken(token, event),
      onTokenClick: (token) => hud()?.#onTokenClick(token),
      onTileClick: (tile, event) => !!hud()?.#onTileClick(tile, event),
      onTileHover: (tile) => hud()?.#onTileHover(tile)
    };

    // The HUD is drawn with the canvas, on maps with a square grid
    Hooks.on("canvasReady", () => {
      const app = BattleHud.#instance ??= new BattleHud();
      app.#reset();
      if ( canvas.scene?.grid?.isSquare ) app.refresh();
      else if ( app.rendered ) app.close();
    });
    Hooks.on("canvasTearDown", () => hud()?.#reset());

    // Whatever changes a unit, where it stands, the ground or the battle is shown at once
    registerGround(refresh);
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
    // be taken back and counts against its movement. A unit that a skill warps has not moved
    Hooks.on("preUpdateToken", (token, changes, options, userId) => {
      try {
        if ( (userId !== game.user.id) || !(("x" in changes) || ("y" in changes)) || originOf(token) ) return;
        const mine = options?.[FEO.id];
        if ( mine?.undo || mine?.warp || (turnState(token.actor, token) !== "ready") ) return;
        // The place the token was last saved at: the one it is drawn at may lag behind
        const { x, y } = token._source ?? token;
        foundry.utils.setProperty(changes, `flags.${FEO.id}.origin`, { x, y });
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
    this.#rest(false);
    this.#clear();
  }

  /* -------------------------------------------- */

  /** Close the open list and call off whatever was being picked or forecast. */
  #clear() {
    this.#flyout = null;
    this.#mode = null;
    this.#staff = null;
    this.#warp = null;
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
    if ( !this.#acting ) {
      this.#mode = null;
      this.#staff = null;
      this.#warp = null;
      this.#forecast = null;
    }

    // An attack being forecast is planned again from the units as they are now
    const forecast = this.#forecast;
    if ( forecast ) this.#forecast = forecast.target.destroyed ? null : this.#planForecast(forecast.target);
  }

  /* -------------------------------------------- */

  /**
   * Paint the grid: where the selected unit can go and strike, the threat of a unit that is not acting, and
   * the path of the move being considered.
   */
  #paint() {
    const view = this.#view;
    const paint = { move: [], strike: [], staff: [], warp: [], threat: new Set(), path: [] };

    // While a tile to warp to is being chosen, nothing but those tiles is shown
    if ( view && this.#acting && (this.#mode === "warp") ) paint.warp.push(...this.#warpTiles());
    else if ( view && this.#acting ) {
      const strikes = view.range?.staff ? paint.staff : paint.strike;
      for ( const key of view.reach.stops ) if ( !(view.moved && view.strikes.has(key)) ) paint.move.push(key);
      for ( const key of view.strikes ) if ( view.moved || !view.reach.stops.has(key) ) strikes.push(key);

      // The path of a move, from where the unit stands: to the tile an attack would be made from, or to the
      // tile under the pointer
      const hover = this.#hoverTile;
      const goal = this.#forecast?.moves ? this.#forecast.from.tile
        : (hover && view.reach.stops.has(tileKey(hover)) && !this.#forecast) ? hover
        : null;
      if ( goal ) paint.path = [view.standing, ...wayBetween(view.reach, view.standing, goal)];
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
    return {
      actor,
      name: document.name || actor.name,
      img: document.texture?.src || actor.img,
      army: armyOf(actor, document),
      state: turnState(actor, document),
      ground: tile ? tileGround(document.parent, tile) : null
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
    const units = unitsOf(combat).filter((unit) => unit.token && (!unit.token.hidden || game.user.isGM)).map((unit) => ({
      id: unit.token.id,
      name: unit.token.name || unit.actor.name,
      img: unit.token.texture?.src || unit.actor.img,
      army: unit.army,
      state: turnState(unit.actor, unit.token),
      selected: unit.token === this.#token?.document
    }));
    return buildPhase({
      phase: phaseOf(combat),
      round: combat?.round ?? 0,
      sides: sidesOf(combat),
      units,
      gm: game.user.isGM,
      canStart: game.user.isGM && !combat && (fielded > 0),
      fielded
    }, i18n);
  }

  /* -------------------------------------------- */

  /**
   * The terrain card: the tile under the pointer, else the one the selected unit stands on.
   * @param {Localizer} i18n
   * @returns {object|null}
   */
  #terrainContext(i18n) {
    const view = this.#view;
    if ( !view && !battle() && !mapTools.surveying ) return null;
    const hover = this.#hoverTile;
    const tile = hover ?? view?.standing ?? null;
    if ( !tile ) return null;
    const ground = tileGround(canvas.scene, tile);
    let unit = null;
    if ( view && this.#acting ) {
      unit = {
        name: this.#token.document.name || this.#token.actor.name,
        here: (tile.i === view.standing.i) && (tile.j === view.standing.j),
        step: moveCost(ground.terrain, moverOf(this.#token.actor)),
        rise: ground.elevation - view.ground(view.standing).elevation
      };
    }
    return buildTerrain({ ...ground, rested: !!hover && this.#rested, unit }, i18n);
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
    const targets = acting && armed && view.units.some((other) => {
      return (standsTo(view.unit, other) === "foe") && !!attackFrom(view, other.token);
    });
    return buildDock({
      ...this.#describe(token),
      range: view?.range ?? null,
      movement: view?.movement ?? 0,
      spent: view?.spent ?? 0,
      moved: view?.moved ?? false,
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
    const target = forecast.target;
    const middle = canvas.clientCoordinatesFromCanvas(target.center);
    return {
      ...buildHudForecast(forecast.plan, {
        armies: { initiator: armyOf(token.actor, token.document), defender: armyOf(target.actor, target.document) },
        images: {
          initiator: token.actor.system.equippedWeapon?.img ?? "",
          defender: target.actor.system.equippedWeapon?.img ?? ""
        },
        measured: forecast.measured
      }, i18n),

      // The panel opens on the side of the map away from the fight
      side: middle.x > (window.innerWidth / 2) ? "left" : "right",
      busy: this.#busy
    };
  }

  /* -------------------------------------------- */
  /*  The Map                                     */
  /* -------------------------------------------- */

  /**
   * Plan the selected unit's attack on a token: the tile to make it from, and the exchange as it would go.
   * @param {Token} target
   * @returns {{target: Token, from: object, moves: boolean, plan: object, measured: number|null}|null}
   *   Null if the unit cannot attack the token this turn
   */
  #planForecast(target) {
    const view = this.#view;
    const token = this.#token;
    if ( !view || !token ) return null;
    const from = attackFrom(view, target.document);
    if ( !from ) return null;
    const moves = (from.tile.i !== view.standing.i) || (from.tile.j !== view.standing.j);
    const matchup = planAttack(token.actor, token.document, target, { from: moves ? from.tile : null });
    if ( matchup.warning ) return null;
    return { target, from, moves, plan: matchup.makePlan(matchup.distance), measured: matchup.measured };
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

    // An Offensive Staff is for a foe, one for an enemy or an ally for either, and any other for a friend
    const side = staffSide({ name: staff.flags?.[FEO.id]?.sheetName ?? staff.name, effect: staff.system.effect });
    const relation = standsTo(view.unit, { army: armyOf(token.actor, token.document) });
    const sides = { offensive: ["foe"], either: ["friend", "foe"] }[side] ?? ["friend"];
    if ( !sides.includes(relation) || token.actor.system.defeat?.out ) return false;
    const range = parseRange(staff.system.range, this.#token.actor.system.statValues);
    if ( !range ) return true;
    const distance = tilesApart(view.standing, there);
    return (distance >= Math.max(range.min, 1)) && (distance <= Math.max(range.max, 1));
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
    const view = this.#view;
    if ( !view || !this.#acting || this.#busy || (token.actor?.type !== "unit") ) return false;
    if ( this.#mode === "warp" ) return false;
    if ( this.#mode === "staff" ) {
      if ( token === this.#token ) return true;
      return this.#staffTakes(token);
    }
    if ( (token === this.#token) || event?.shiftKey ) return false;

    // Outside of a battle a click selects as it always has, unless Attack was pressed first
    if ( (this.#state !== "ready") && (this.#mode !== "target") ) return false;
    if ( token.actor.system.defeat?.out ) return false;
    const other = { army: armyOf(token.actor, token.document) };
    return (standsTo(view.unit, other) === "foe") && !!attackFrom(view, token.document);
  }

  /* -------------------------------------------- */

  /**
   * A token the selected unit can do something to was clicked.
   * @param {Token} token
   */
  #onTokenClick(token) {
    if ( this.#mode === "staff" ) {
      this.#useStaffOn(token).catch((err) => console.error(err));
      return;
    }
    const forecast = this.#planForecast(token);
    if ( !forecast ) return;
    this.#clear();
    this.#forecast = forecast;
    this.refresh();
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
    const view = this.#view;
    if ( !view || !this.#acting || this.#busy || event?.shiftKey ) return false;
    if ( this.#mode === "warp" ) {
      if ( this.#warpTiles().has(tileKey(tile)) ) this.#working(() => this.#warpTo(tile));
      else {
        this.#clear();
        this.refresh();
      }
      return true;
    }
    if ( this.#forecast ) {
      this.#forecast = null;
      this.refresh();
      return true;
    }
    const key = tileKey(tile);
    if ( !view.reach.stops.has(key) || ((tile.i === view.standing.i) && (tile.j === view.standing.j)) ) return false;
    this.#working(() => this.#moveTo(tile));
    return true;
  }

  /* -------------------------------------------- */

  /**
   * The pointer is over another tile.
   * @param {{i: number, j: number}|null} tile
   */
  #onTileHover(tile) {
    // While the ground is surveyed or painted, any tile of the map is named, whether a unit is selected or not
    const surveying = mapTools.surveying;
    const onMap = !tile ? false
      : this.#view ? this.#view.inside(tile)
      : (surveying && !!mapTile(canvas.grid.getCenterPoint(tile)));
    this.#hoverTile = onMap ? tile : null;
    const shown = !!this.#view || !!battle() || surveying;
    this.#rest(onMap && shown);
    if ( !shown ) return;
    this.refresh({ parts: ["terrain"] });
  }

  /* -------------------------------------------- */

  /**
   * The pointer is on another tile, or has left the map: the terrain card goes back to its figures, and says
   * more of the tile only once the pointer has stayed on it for a moment.
   * @param {boolean} onMap     Is the pointer on a tile of the map?
   */
  #rest(onMap) {
    clearTimeout(this.#resting);
    this.#resting = null;
    this.#rested = false;
    if ( !onMap ) return;
    this.#resting = setTimeout(() => {
      this.#resting = null;
      this.#rested = true;
      if ( this.rendered ) this.refresh({ parts: ["terrain"] });
    }, REST_TIME);
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
   * Walk the selected unit from where it stands to a tile of its reach, by the way the arrow shows.
   * @param {{i: number, j: number}} tile
   * @returns {Promise<boolean>}    Whether it arrived
   */
  async #moveTo(tile) {
    const document = this.#token.document;
    const view = this.#view;
    const points = waypointsTo(document, view.reach, tile, view.standing);
    if ( !points.length ) return false;

    // In a battle the token remembers where its turn began, so that the move can be taken back, and so that
    // a unit moved again is still held to the reach it had there
    const origin = originOf(document);
    if ( !origin && (turnState(document.actor, document) === "ready") ) {
      const { x, y } = document._source ?? document;
      await document.setFlag(FEO.id, "origin", { x, y });
    }

    // Its reach has already said that every step can be taken: Foundry does not weigh the ground again
    const arrived = await document.move(points, { constrainOptions: { ignoreCost: true } });
    if ( arrived === false ) return false;

    // Back where its turn began, the unit has not moved at all
    const home = (tile.i === view.reach.origin.i) && (tile.j === view.reach.origin.j);
    if ( origin && home ) await document.unsetFlag(FEO.id, "origin");
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Take back the selected unit's move: it is set back at once where its turn began.
   * @returns {Promise<void>}
   */
  async #undoMove() {
    const document = this.#token?.document;
    const origin = originOf(document);
    if ( !origin ) return;
    await document.move({ x: origin.x, y: origin.y, snapped: true, action: "displace" }, {
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
      [FEO.id]: { undo: true }
    });
    await document.unsetFlag(FEO.id, "origin");
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
    const other = token !== this.#token;
    const warp = other ? staffWarpOf(this.#token?.actor.items.get(staff)) : null;
    if ( warp && staffWarpChosen(warp) ) {
      this.#beginStaffWarp(staff, token);
      return;
    }

    // A staff that moves its unit to a tile nobody chooses is used at once, and told that the map is done
    await this.#working(() => this.#castStaff(staff, other ? token : null, warp ? { warpNow: "true" } : {}));
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
    if ( id && (staffWarpOf(this.#token?.actor.items.get(id))?.moves === "self") ) {
      this.#beginStaffWarp(id);
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
   * One of the unit sheet's actions was asked for from the dock.
   * @this {BattleHud}
   */
  static async #onSheetAction(event, target) {
    const name = target.dataset.action;
    const id = target.closest("[data-item-id]")?.dataset.itemId ?? null;

    // Switching a weapon or a skill leaves the list open; anything else is done with it
    if ( !["toggleEquip", "switchSkill", "toggleForm", "readyArt", "toggleCapture"].includes(name) ) this.#clear();
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
      if ( forecast.moves && !(await this.#moveTo(forecast.from.tile)) ) {
        ui.notifications.warn("FEO.Hud.moveFailed", { localize: true });
        return;
      }
      this.#forecast = null;

      // The forecast was shown here, so nothing more is asked before the dice are rolled
      await fightTarget(token.actor, token.document, forecast.target, { confirm: async (matchup) => matchup.distance });
    });
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
   * Something was picked on the palette of the terrain brush: a kind of terrain, a height, or the eraser.
   * Picking a kind of terrain or a height puts the eraser down.
   * @this {BattleHud}
   */
  static #onBrush(event, target) {
    const { terrain, elevation, erase } = target.dataset;
    const brush = mapTools.brush;
    if ( erase !== undefined ) brush.erase = !brush.erase;
    else if ( terrain !== undefined ) Object.assign(brush, { terrain: terrain || null, erase: false });
    else if ( elevation !== undefined ) Object.assign(brush, { elevation: elevation === "" ? null : Number(elevation), erase: false });
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

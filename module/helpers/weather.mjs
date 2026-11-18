import { FEO } from "../config.mjs";
import { causesFog, rollStrikes, strikeDamage, strikeDice, strikesDue, weatherKinds } from "../rules/weather.mjs";
import { postCard } from "./chat.mjs";
import { WEATHER_FLAG, weatherOf, weatherOn } from "./map-weather.mjs";

/**
 * Weather in Foundry: the Game Master switches kinds of it on and off for a scene, and it then does what the
 * Weather page of the rules says (see `rules/weather.mjs`). What tiles cost more is read where movement is
 * (`moverOf` in `terrain.mjs`), what it does to stats where units stand (`positions.mjs`), and here is the
 * rest: the damage a unit takes as its turn ends, and the bolts that strike the map as a turn of the battle
 * does.
 */

/** The socket the system's clients talk over. */
const SOCKET = `system.${FEO.id}`;

const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/* -------------------------------------------- */
/*  Switching It                                */
/* -------------------------------------------- */

/**
 * Set the kinds of weather of a scene. Runs for a Game Master.
 * @param {Scene} scene
 * @param {string[]} kinds
 * @returns {Promise<string[]>}     The kinds now switched on
 */
export async function setWeather(scene, kinds) {
  if ( !game.user.isGM || !scene ) return weatherOn(scene);
  const next = weatherKinds(kinds);
  if ( next.length ) await scene.setFlag(FEO.id, WEATHER_FLAG, next);
  else if ( scene.flags?.[FEO.id]?.[WEATHER_FLAG] !== undefined ) await scene.unsetFlag(FEO.id, WEATHER_FLAG);
  return next;
}

/* -------------------------------------------- */

/**
 * What a kind of weather does, in a line of plain words, as the banner tells it on hover.
 * @param {string} kind
 * @param {{localize: Function, format: Function}} i18n
 * @returns {string}
 */
export function describeWeather(kind, i18n) {
  const weather = FEO.weather.kinds[kind];
  if ( !weather ) return "";
  const parts = [];
  const move = weather.move ?? {};
  if ( move.infantry || move.mounted ) parts.push(i18n.format("FEO.Weather.does.move", { infantry: move.infantry ?? 0, mounted: move.mounted ?? 0 }));
  if ( move.flying ) parts.push(i18n.format("FEO.Weather.does.fly", { flying: move.flying }));
  for ( const [stat, amount] of Object.entries(weather.stats ?? {}) ) {
    parts.push(i18n.format("FEO.Weather.does.stat", { amount: (amount > 0) ? `+${amount}` : `${amount}`, stat: i18n.localize(`FEO.Stat.${stat}.abbr`) }));
  }
  if ( weather.harm ) parts.push(i18n.format("FEO.Weather.does.harm", { amount: weather.harm }));
  if ( weather.fog ) parts.push(i18n.localize("FEO.Weather.does.fog"));
  if ( weather.los ) parts.push(i18n.format("FEO.Weather.does.los", { los: weather.los }));
  const strike = FEO.weather.strikes[weather.strikes];
  if ( strike ) {
    const more = Object.entries(strike.against ?? {}).map(([quality, amount]) => i18n.format("FEO.Weather.does.against", { quality, amount })).join("");
    parts.push(i18n.format(`FEO.Weather.does.${weather.strikes}`, { damage: strike.damage, dice: strike.dice ?? 1, every: strike.every ?? 1, more }));
  }
  return parts.join(" ");
}

/* -------------------------------------------- */

/**
 * The weather of a scene for the Phase banner: one small icon for each kind that is switched on, with what it
 * does on hover, and for a Game Master a way in to change it.
 * @param {Scene|null} scene
 * @param {object} [options]
 * @param {boolean} [options.gm]              Is the user a Game Master?
 * @param {{name: string, proof: boolean}|null} [options.unit]    The unit that is selected, if one is
 * @param {{localize: Function, format: Function}} i18n
 * @returns {{icons: {kind: string, icon: string, label: string, tip: string}[], gm: boolean, shown: boolean, clear: string}}
 */
export function buildWeather(scene, { gm = false, unit = null } = {}, i18n) {
  const icons = weatherOn(scene).map((kind) => {
    const weather = FEO.weather.kinds[kind];
    const label = i18n.localize(weather.label);
    const spared = (unit?.proof && (weather.move || weather.stats || weather.harm)) ? ` ${i18n.format("FEO.Weather.spared", { name: unit.name })}` : "";
    return { kind, icon: weather.icon, label, tip: `${label}: ${describeWeather(kind, i18n)}${spared}` };
  });
  return { icons, gm, shown: gm || (icons.length > 0), clear: i18n.localize("FEO.Weather.clear") };
}

/* -------------------------------------------- */

/**
 * Have the Game Master pick the weather of a scene from a list of every kind, each with what it does.
 * @param {Scene} scene
 * @returns {Promise<string[]|null>}    The kinds now switched on; null when it was called off
 */
export async function pickWeather(scene) {
  if ( !game.user.isGM || !scene ) return null;
  const on = new Set(weatherOn(scene));
  const escape = foundry.utils.escapeHTML ?? ((text) => text);
  const rows = Object.keys(FEO.weather.kinds).map((kind) => {
    const label = loc(FEO.weather.kinds[kind].label);
    return `<label class="feo-weather-row"><input type="checkbox" name="${kind}" ${on.has(kind) ? "checked" : ""}>`
      + `<span><b>${escape(label)}</b><small>${escape(describeWeather(kind, game.i18n))}</small></span></label>`;
  }).join("");
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.Weather.title" },
    position: { width: 460 },
    content: `<p class="hint">${escape(loc("FEO.Weather.pickHint"))}</p><div class="feo-weather-list">${rows}</div>`,
    buttons: [
      { action: "set", label: "FEO.Weather.set", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "clear", label: "FEO.Weather.clearAll", icon: "fa-solid fa-sun" },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( !answer || (answer === "cancel") ) return null;
  const kinds = (answer === "clear") ? [] : Object.entries(answer).filter(([, picked]) => picked).map(([kind]) => kind);
  const set = await setWeather(scene, kinds);

  // Fog of War is the Game Master's to run: the system says so once, to the one who switched it on
  if ( causesFog(set) && !causesFog(Array.from(on)) ) ui.notifications.info("FEO.Weather.fogNote", { localize: true });
  return set;
}

/* -------------------------------------------- */
/*  A Unit's Turn                               */
/* -------------------------------------------- */

/**
 * A unit's turn ends in the weather of its map: it takes the damage the weather deals, which never brings it
 * below 1 HP. A unit that is down, or off the map, takes none.
 * @param {Actor} actor
 * @returns {Promise<number>}     The HP it lost
 */
export async function weatherTurnFor(actor) {
  if ( (actor?.type !== "unit") || actor.system.defeat?.state || actor.system.defeat?.out ) return 0;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  const scene = token?.parent ?? null;
  if ( !scene || !(actor.system.hp?.value > 1) ) return 0;
  const effect = weatherOf(actor, scene);
  if ( !(effect.harm > 0) ) return 0;
  const { damageUnit, pop } = await import("./events.mjs");
  pop(actor, [{ text: loc(FEO.weather.kinds[effect.by.harm].label), tone: "skill" }]);
  const hurt = await damageUnit(actor, effect.harm, { kind: "terrain", nonlethal: true, token });
  return hurt?.dealt ?? 0;
}

/* -------------------------------------------- */
/*  What Strikes the Map                        */
/* -------------------------------------------- */

/**
 * The tiles of a scene that a bolt can strike: how many rows and columns the map has, and the tile of its
 * top left corner.
 * @param {Scene} scene
 * @returns {{rows: number, cols: number, first: {i: number, j: number}}|null}    Null without a square grid
 */
export function mapSize(scene) {
  const grid = scene?.grid;
  const rect = scene?.dimensions?.sceneRect;
  if ( !grid?.isSquare || !rect ) return null;
  const first = grid.getOffset({ x: rect.x + (grid.sizeX / 2), y: rect.y + (grid.sizeY / 2) });
  return {
    rows: Math.max(Math.round(rect.height / grid.sizeY), 1),
    cols: Math.max(Math.round(rect.width / grid.sizeX), 1),
    first: { i: first.i, j: first.j }
  };
}

/* -------------------------------------------- */

/**
 * The unit that stands on a tile of a scene, if one does: one that is still on the map.
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile
 * @returns {TokenDocument|null}
 */
function unitOn(scene, tile) {
  const grid = scene.grid;
  for ( const token of scene.tokens ) {
    if ( (token.actor?.type !== "unit") || token.actor.system.defeat?.gone || token.actor.system.defeat?.out ) continue;
    const at = grid.getOffset({ x: token.x + (grid.sizeX / 2), y: token.y + (grid.sizeY / 2) });
    const wide = Math.max(Math.round(token.width ?? 1), 1);
    const high = Math.max(Math.round(token.height ?? 1), 1);
    if ( (tile.i >= at.i) && (tile.i < (at.i + high)) && (tile.j >= at.j) && (tile.j < (at.j + wide)) ) return token;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Flash a bolt on a tile of the scene in view, on this client.
 * @param {string} sceneId
 * @param {{i: number, j: number}} tile
 * @param {string} strike     "lightning" or "ballista"
 */
export function flashStrike(sceneId, tile, strike) {
  try {
    if ( !globalThis.canvas?.ready || (canvas.scene?.id !== sceneId) || !FEO.weather.flash ) return;
    const grid = canvas.scene.grid;
    const centre = grid.getCenterPoint({ i: tile.i, j: tile.j });
    const size = Math.max(grid.sizeX, grid.sizeY);
    const colour = (strike === "lightning") ? 0xfff2a0 : 0xffb37a;
    const flash = new PIXI.Graphics();
    flash.beginFill(0xffffff, 0.85).drawRect(-size / 2, -size / 2, size, size).endFill();
    flash.lineStyle(Math.max(size * 0.07, 3), colour, 1).drawRect(-size / 2, -size / 2, size, size);
    flash.position.set(centre.x, centre.y);
    (canvas.interface ?? canvas.tokens).addChild(flash);
    const { CanvasAnimation } = foundry.canvas.animation;
    CanvasAnimation.animate([{ parent: flash, attribute: "alpha", to: 0 }], {
      name: `feo.strike.${tile.i}.${tile.j}.${Math.random().toString(36).slice(2, 8)}`, duration: FEO.weather.flash
    }).catch(() => {}).finally(() => {
      flash.parent?.removeChild(flash);
      flash.destroy();
    });
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */

/**
 * A roll that shows exactly the dice that were used, whatever their faces.
 * @param {{faces: number, result: number}[]} used
 * @returns {Roll|null}
 */
function rollOf(used) {
  if ( !used.length ) return null;
  const { Die, OperatorTerm } = foundry.dice.terms;
  const terms = [];
  for ( const faces of [...new Set(used.map((die) => die.faces))] ) {
    const results = used.filter((die) => die.faces === faces).map((die) => ({ result: die.result, active: true }));
    if ( terms.length ) terms.push(new OperatorTerm({ operator: "+" }));
    terms.push(new Die({ number: results.length, faces, results }));
  }
  return foundry.dice.Roll.fromTerms(terms);
}

/* -------------------------------------------- */

/**
 * A turn of the battle ends in the weather of its map: lightning may strike, and ballista bolts fall every
 * other turn, on tiles picked by rolling the size of the map. A unit on a tile that is struck takes the
 * damage of the bolt, unless the tile is indoors. Runs for the Game Master who ends the Phase.
 * @param {Combat} combat
 * @returns {Promise<object[]>}     What struck, as `rollStrikes` tells it, with what each bolt did
 */
export async function weatherRoundEnd(combat) {
  const scene = combat?.scene ?? null;
  const turn = combat?.round ?? 0;
  const kinds = weatherOn(scene);
  if ( !game.user.isGM || !scene || !strikeDice(kinds, turn) ) return [];
  const size = mapSize(scene);
  if ( !size ) return [];
  const used = [];
  const die = (faces) => {
    const result = Math.floor((CONFIG.Dice.randomUniform?.() ?? Math.random()) * faces) + 1;
    used.push({ faces, result });
    return Math.min(Math.max(result, 1), faces);
  };
  const struck = rollStrikes(kinds, turn, size, die);
  const { tileGround } = await import("./terrain.mjs");
  const { damageUnit } = await import("./events.mjs");
  const rows = [];
  for ( const entry of struck ) {
    const label = loc(FEO.weather.strikes[entry.strike].label);
    if ( !strikesDue(kinds, turn).length ) break;
    if ( !entry.bolts.length ) {
      rows.push({ label, value: loc(`FEO.Weather.card.none.${entry.strike}`) });
      continue;
    }
    if ( entry.strike !== "lightning" ) rows.push({ label, value: loc("FEO.Weather.card.bolts", { count: entry.bolts.length }) });
    for ( const bolt of entry.bolts ) {
      const tile = { i: size.first.i + bolt.row - 1, j: size.first.j + bolt.col - 1 };
      const token = unitOn(scene, tile);
      const ground = tileGround(scene, tile);
      const { damage, indoors } = strikeDamage(entry.strike, token ? { qualities: token.actor.system.specialQualities ?? "" } : null, ground.terrain);
      bolt.tile = tile;
      flashStrike(scene.id, tile, entry.strike);
      game.socket?.emit(SOCKET, { type: "map.strike", scene: scene.id, i: tile.i, j: tile.j, strike: entry.strike });
      const where = { col: bolt.col, row: bolt.row };
      let value = loc(indoors ? "FEO.Weather.card.indoors" : "FEO.Weather.card.empty", where);
      let cls = "";
      if ( token && (damage > 0) ) {
        const hurt = await damageUnit(token.actor, damage, { kind: "terrain", token });
        bolt.unit = token.id;
        bolt.dealt = hurt?.dealt ?? 0;
        value = loc("FEO.Weather.card.hit", { ...where, name: token.name || token.actor.name, amount: bolt.dealt });
        cls = "bad";
      }
      rows.push({ label: (entry.strike === "lightning") ? label : "", value, cls });
    }
  }
  if ( rows.length ) {
    const roll = rollOf(used);
    await postCard(null, {
      title: loc("FEO.Weather.card.title"),
      subtitle: loc("FEO.Weather.card.turn", { turn }),
      rows
    }, { rolls: roll ? [roll] : [] });
  }
  return struck;
}

/* -------------------------------------------- */

/**
 * Register what the weather listens for. Called once, when the system starts.
 * @param {() => void} [changed]    Called once the weather of the scene in view has changed
 */
export function registerWeather(changed = () => {}) {
  Hooks.on("updateScene", (scene, changes) => {
    const flags = changes.flags?.[FEO.id];
    if ( !flags || (scene !== globalThis.canvas?.scene) ) return;
    if ( !((WEATHER_FLAG in flags) || (`-=${WEATHER_FLAG}` in flags)) ) return;
    changed();
  });
  Hooks.once("ready", () => {
    game.socket?.on(SOCKET, (message) => {
      if ( (message?.type !== "map.strike") || !Number.isInteger(message.i) || !Number.isInteger(message.j) ) return;
      flashStrike(String(message.scene ?? ""), { i: message.i, j: message.j }, String(message.strike ?? ""));
    });
  });
}

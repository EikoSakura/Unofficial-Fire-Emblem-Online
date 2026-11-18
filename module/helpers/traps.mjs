import { FEO } from "../config.mjs";
import { relationOf } from "../rules/positions.mjs";
import { disarmerOf } from "../rules/stealing.mjs";
import { flies, terrainType } from "../rules/terrain.mjs";
import { layTiles, makeTrap, normalizeTrap, seesTrap, springs, sprung, trapOfItem, trapsAt, warpReaches } from "../rules/traps.mjs";
import { postCard } from "./chat.mjs";
import { afflictUnit, damageUnit, pop } from "./events.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { awardExp, earnsExp, expRow } from "./experience.mjs";
import { objectOn } from "./map-objects.mjs";
import { moverOf, tileGround } from "./terrain.mjs";
import { warpToken } from "./warp.mjs";

/**
 * The Mines and Traps of the Items tab on a map in Foundry (see `rules/traps.mjs`). They are kept on their
 * scene, each on its tile, whoever laid them: a unit by using the item, or the Game Master with the terrain
 * brush. Only a Game Master writes them, so a player's unit that lays one, springs one or takes one away asks
 * a Game Master to. What walks a unit onto one, and what has it wait on one, is in `reactions.mjs`.
 *
 * @import {ItemTrap, LaidTrap} from "../rules/traps.mjs"
 */

/** The flag, on a scene, that holds the mines and traps that lie on it. */
export const TRAPS_FLAG = "traps";

/** The name of the query that asks a Game Master to lay a trap or to have one sprung. */
export const TRAP_QUERY = `${FEO.id}.trap`;

/** The hook called once a trap was sprung or taken away: the token that did, the trap, and what came of it. */
export const TRAP_HOOK = `${FEO.id}.trapSprung`;

/** What was read of each scene's traps, until its flag changes. */
const read = new WeakMap();

const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const nameOf = (token) => token?.name || token?.actor?.name || "";

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The mines and traps that lie on a scene.
 * @param {Scene|null} scene
 * @returns {LaidTrap[]}
 */
export function laidOn(scene) {
  if ( !scene?.grid?.isSquare ) return [];
  const raw = scene.flags?.[FEO.id]?.[TRAPS_FLAG];
  const known = read.get(scene);
  if ( known && (known.raw === raw) ) return known.list;
  const list = (Array.isArray(raw) ? raw : []).map(normalizeTrap).filter(Boolean);
  read.set(scene, { raw, list });
  return list;
}

/* -------------------------------------------- */

/**
 * The unit that laid a trap, where it is still known.
 * @param {LaidTrap} trap
 * @returns {Actor|null}
 */
function layerOf(trap) {
  if ( !trap?.by ) return null;
  try {
    const found = foundry.utils.fromUuidSync(trap.by);
    return (found?.type === "unit") ? found : null;
  } catch(err) {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * The mines and traps this user is shown on a scene (see `seesTrap`).
 * @param {Scene|null} scene
 * @returns {LaidTrap[]}
 */
export function laidShown(scene) {
  return laidOn(scene).filter((trap) => seesTrap(trap, { gm: game.user.isGM, owns: !!layerOf(trap)?.isOwner }));
}

/* -------------------------------------------- */

/**
 * What an item of a unit does as a trap, if it is one.
 * @param {Item|null} item
 * @returns {ItemTrap|null}
 */
export function trapItemOf(item) {
  return (item?.type === "gear") ? trapOfItem({ name: item.name, effect: item.system.effect }) : null;
}

/* -------------------------------------------- */

/**
 * Describe a unit for the rules of traps.
 * @param {TokenDocument} token
 * @returns {{actor: string, flies: boolean}}
 */
export function trapUnitOf(token) {
  return { actor: token?.actor?.uuid ?? "", flies: flies(moverOf(token?.actor)) };
}

/* -------------------------------------------- */

/**
 * Is a tile inside the map of a scene, on ground a unit could stand on?
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile
 * @returns {boolean}
 */
function standable(scene, tile) {
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  if ( (tile.i < i0) || (tile.i >= i1) || (tile.j < j0) || (tile.j >= j1) ) return false;
  return !terrainType(tileGround(scene, tile).terrain).impassable;
}

/**
 * The tokens of the units that stand on a scene and still hold a tile.
 * @param {Scene} scene
 * @returns {{token: TokenDocument, tile: {i: number, j: number}}[]}
 */
function unitsAt(scene) {
  const units = [];
  for ( const token of scene.tokens ) {
    if ( (token.actor?.type !== "unit") || token.actor.system.defeat?.out ) continue;
    const tile = tokenTile(token);
    if ( tile ) units.push({ token, tile });
  }
  return units;
}

const stands = (units, tile, but = null) => units.some((unit) => (unit.token !== but) && (unit.tile.i === tile.i) && (unit.tile.j === tile.j));

/* -------------------------------------------- */

/**
 * The tiles a unit may lay an item on from where it stands: as far from it as the item says, on ground a unit
 * could stand on, with no unit, no door, chest or Village and no trap this user sees on it.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {{i: number, j: number}[]}
 */
export function layTilesOf(token, item) {
  const scene = token?.parent;
  const trap = trapItemOf(item);
  const from = tokenTile(token);
  if ( !scene?.grid?.isSquare || !trap || !from ) return [];
  const units = unitsAt(scene);
  const seen = laidShown(scene);
  return layTiles(from, trap.range).filter((tile) => {
    return standable(scene, tile) && !stands(units, tile) && !objectOn(scene, tile) && !trapsAt(seen, tile).length;
  });
}

/* -------------------------------------------- */

/**
 * The tiles a trap that warps may send a unit to, from the tile it is laid on.
 * @param {Scene} scene
 * @param {{i: number, j: number}} at       The tile the trap is laid on
 * @param {ItemTrap} trap
 * @returns {{i: number, j: number}[]}
 */
export function warpTilesFor(scene, at, trap) {
  if ( !scene?.grid?.isSquare || !trap?.warp ) return [];
  const tiles = [];
  const reach = trap.warp.within;
  for ( let di = -reach; di <= reach; di++ ) {
    for ( let dj = -reach; dj <= reach; dj++ ) {
      const tile = { i: at.i + di, j: at.j + dj };
      if ( warpReaches(at, tile, trap.warp) && standable(scene, tile) ) tiles.push(tile);
    }
  }
  return tiles;
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

/**
 * Save the traps of a scene. Runs for a Game Master.
 * @param {Scene} scene
 * @param {LaidTrap[]} list
 * @returns {Promise<void>}
 */
async function save(scene, list) {
  if ( list.length ) await scene.update({ [`flags.${FEO.id}.${TRAPS_FLAG}`]: list }, { diff: false, recursive: false });
  else if ( scene.flags?.[FEO.id]?.[TRAPS_FLAG] !== undefined ) await scene.unsetFlag(FEO.id, TRAPS_FLAG);
  read.delete(scene);
}

/**
 * Ask an active Game Master to do something with a trap.
 * @param {object} data
 * @returns {Promise<*>}
 */
async function ask(data) {
  const gm = game.users.activeGM;
  if ( !gm ) return null;
  try {
    return await gm.query(TRAP_QUERY, data, { timeout: 20000 });
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Answer another user's request about a trap: one of their units lays one, springs one or takes one away.
 * Runs for a Game Master, who checks everything again.
 * @param {object} data
 * @returns {Promise<*>}
 */
export async function trapQuery({ op, scene: sceneId, token: tokenId, user: userId, ...data } = {}) {
  const scene = game.scenes?.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  const user = game.users?.get(userId);
  if ( !game.user.isGM || (token?.actor?.type !== "unit") || !user || !token.actor.testUserPermission(user, "OWNER") ) return null;
  if ( op === "lay" ) {
    const item = token.actor.items.get(data.item);
    const warp = (Number.isInteger(data.warp?.i) && Number.isInteger(data.warp?.j)) ? { i: data.warp.i, j: data.warp.j } : null;
    return (item && Number.isInteger(data.i) && Number.isInteger(data.j)) ? layNow(token, item, { i: data.i, j: data.j }, warp) : null;
  }
  if ( op === "spring" ) {
    return (typeof data.trap === "string") ? springNow(token, data.trap, (data.how === "wait") ? "wait" : "walk") : null;
  }
  return null;
}

/* -------------------------------------------- */
/*  Laying One                                  */
/* -------------------------------------------- */

/**
 * A unit lays a trap with an item on a tile next to it: the trap lies there, and the item loses a use. Runs
 * for a Game Master.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {{i: number, j: number}} tile
 * @param {{i: number, j: number}|null} [warp]    The tile a trap that warps sends a unit to
 * @returns {Promise<{name: string, left: number, max: number}|null>}     Null when it could not be laid
 */
async function layNow(token, item, tile, warp = null) {
  const scene = token.parent;
  const actor = token.actor;
  const trap = trapItemOf(item);
  const from = tokenTile(token);
  if ( !trap || !from || item.system.spent ) return null;
  const fits = layTiles(from, trap.range).some((other) => (other.i === tile.i) && (other.j === tile.j));
  if ( !fits || !standable(scene, tile) || stands(unitsAt(scene), tile) || objectOn(scene, tile) ) return null;
  if ( trap.warp && !(warp && warpReaches(tile, warp, trap.warp) && standable(scene, warp)) ) return null;
  const made = makeTrap(trap, tile, {
    id: foundry.utils.randomID(),
    warp,
    by: { actor: actor.uuid, token: token.id, side: armyOf(actor, token) },
    laid: actor.system.knacks?.laid ?? null
  });
  await save(scene, [...laidOn(scene), made]);

  // The item loses a use, and is gone with its last
  const max = item.system.uses?.max ?? 0;
  const left = Math.max((item.system.uses?.value ?? 0) - 1, 0);
  if ( (max > 0) && (left === 0) ) await item.delete();
  else if ( max > 0 ) await item.update({ "system.uses.value": left });
  return { name: item.name, left, max };
}

/* -------------------------------------------- */

/**
 * A unit uses an item that traps a space on a tile next to it. It is the unit's Action, which whoever calls
 * this counts.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {{i: number, j: number}} tile
 * @param {{i: number, j: number}|null} [warp]
 * @returns {Promise<boolean>}    Whether the trap now lies there
 */
export async function layTrapItem(token, item, tile, warp = null) {
  const actor = token?.actor;
  if ( !actor || !trapItemOf(item) ) return false;
  const effect = item.system.effect;
  const name = item.name;
  const laid = game.user.isGM ? await layNow(token, item, tile, warp)
    : await ask({ op: "lay", scene: token.parent.id, token: token.id, user: game.user.id, item: item.id, i: tile.i, j: tile.j, warp });
  if ( !laid ) {
    ui.notifications.warn(loc("FEO.Trap.cannotLay", { item: name }));
    return false;
  }
  pop(actor, [{ text: name, tone: "skill" }]);
  await postCard(actor, {
    title: loc("FEO.Chat.usesItem", { item: name }),
    subtitle: effect,
    rows: [{
      label: loc("FEO.Weapon.uses"),
      value: ((laid.max > 0) && (laid.left === 0)) ? loc("FEO.Chat.usedUp") : `${laid.left} / ${laid.max}`
    }]
  });
  return true;
}

/* -------------------------------------------- */
/*  Springing One                               */
/* -------------------------------------------- */

/**
 * The free tile a unit is set down on by a trap that warps it: the tile the trap names, or failing that the
 * nearest tile around it that a unit could stand on and that nobody holds.
 * @param {TokenDocument} token
 * @param {{i: number, j: number}} to
 * @returns {{i: number, j: number}|null}
 */
function landing(token, to) {
  const scene = token.parent;
  const units = unitsAt(scene);
  const free = (tile) => standable(scene, tile) && !stands(units, tile, token);
  if ( free(to) ) return to;
  for ( let reach = 1; reach <= 3; reach++ ) {
    const found = layTiles(to, reach).find(free);
    if ( found ) return found;
  }
  return null;
}

/* -------------------------------------------- */

/**
 * A unit springs a trap, or takes it away where its skills have it disarm traps. Runs for a Game Master.
 * @param {TokenDocument} token       The unit on its tile
 * @param {string} id                 The trap
 * @param {"walk"|"wait"} how
 * @returns {Promise<{halted: boolean, gone: boolean, disarmed: boolean}>}
 *          `halted`: its move ends there. `gone`: it no longer stands
 */
async function springNow(token, id, how) {
  const scene = token.parent;
  const actor = token.actor;
  const none = { halted: false, gone: false, disarmed: false };
  const trap = laidOn(scene).find((entry) => entry.id === id);
  if ( !trap || !springs(trap, trapUnitOf(token), how) ) return none;
  const without = () => save(scene, laidOn(scene).filter((entry) => entry.id !== id));

  // A unit that disarms traps takes it off its tile, whatever kind it is, and walks on
  const disarmer = disarmerOf(actor.system.knacks ?? null);
  if ( disarmer !== null ) {
    await without();
    pop(actor, [{ text: loc("FEO.Trap.disarmed", { skill: disarmer, trap: trap.name }), tone: "skill" }]);
    Hooks.callAll(TRAP_HOOK, token, trap, { disarmed: true });
    return { ...none, disarmed: true };
  }

  const layer = layerOf(trap);
  const layerToken = trap.token ? (scene.tokens.get(trap.token) ?? null) : null;
  const enemy = !!trap.side && (relationOf(trap.side, armyOf(actor, token)) === "enemy");
  const out = sprung(trap, { enemy });
  if ( out.gone ) await without();
  pop(actor, [{ text: trap.name, tone: "skill" }]);
  const rows = [];

  // Its damage is the ground's, dealt by the unit that laid it where one did
  let hurt = null;
  if ( out.damage > 0 ) {
    hurt = await damageUnit(actor, out.damage, { kind: "terrain", by: layer, byToken: layerToken, token });
    rows.push({ label: loc("FEO.Trap.card.damage"), value: loc("FEO.Act.harmed", { amount: hurt?.dealt ?? 0 }), cls: "bad" });
  }
  const standing = () => (actor.system.hp?.value > 0) && !actor.system.defeat?.state;
  for ( const { id: condition, turns } of standing() ? out.inflicts : [] ) {
    const given = await afflictUnit(actor, condition, { turns, by: layer, byToken: layerToken, token });
    const label = loc(`FEO.Condition.${condition}`);
    rows.push({
      label,
      value: (given?.success === false) ? loc("FEO.Trap.card.warded") : loc((given?.turns === 1) ? "FEO.Trap.card.turn" : "FEO.Trap.card.turns", { turns: given?.turns ?? turns }),
      cls: (given?.success === false) ? "" : "cond"
    });
  }

  // One that warps sets the unit down where it was told to, or as near to there as there is room
  let warped = false;
  if ( out.warp && standing() ) {
    const to = landing(token, out.warp);
    warped = !!to && (await warpToken(token, to));
    rows.push({ label: loc("FEO.Trap.card.warp"), value: loc(warped ? "FEO.Trap.card.warped" : "FEO.Trap.card.noRoom") });
  }

  // What the unit that laid it gains: as an enemy springs it, and as its damage defeats one
  if ( layer && earnsExp(layer, layerToken) ) {
    const amount = out.exp + ((hurt?.defeated && out.kill) ? out.kill : 0);
    if ( amount > 0 ) rows.push({ ...expRow(await awardExp(layer, amount)), label: `${nameOf(layerToken) || layer.name} · ${loc("FEO.Unit.exp")}` });
  }
  await postCard(actor, {
    title: loc((how === "wait") ? "FEO.Trap.card.waited" : "FEO.Trap.card.sprung", { name: nameOf(token) || actor.name, trap: trap.name }),
    subtitle: layer ? loc("FEO.Trap.card.laidBy", { name: nameOf(layerToken) || layer.name }) : "",
    rows
  });
  const result = { halted: out.halts && (warped || !out.warp), gone: !standing(), disarmed: false };
  Hooks.callAll(TRAP_HOOK, token, trap, result);
  return result;
}

/* -------------------------------------------- */

/**
 * A unit springs a trap it walked onto or waits on, or takes it away. A Game Master does it; anyone else asks
 * one to.
 * @param {TokenDocument} token
 * @param {LaidTrap} trap
 * @param {"walk"|"wait"} [how]
 * @returns {Promise<{halted: boolean, gone: boolean, disarmed: boolean}>}
 */
export async function springLaid(token, trap, how = "walk") {
  const none = { halted: false, gone: false, disarmed: false };
  if ( !token?.parent || !trap?.id ) return none;
  if ( game.user.isGM ) return springNow(token, trap.id, how);
  return (await ask({ op: "spring", scene: token.parent.id, token: token.id, user: game.user.id, trap: trap.id, how })) ?? none;
}

/* -------------------------------------------- */
/*  The Game Master's Hand                      */
/* -------------------------------------------- */

let known = null;

/**
 * The items of the Items compendium that trap a space, each with what it does.
 * @returns {Promise<ItemTrap[]>}
 */
export async function trapItems() {
  if ( known ) return known;
  const found = [];
  try {
    const pack = game.packs.get(`${FEO.id}.items`);
    const index = pack ? await pack.getIndex({ fields: ["system.effect"] }) : [];
    for ( const entry of index ) {
      const trap = (entry.type === "gear") ? trapOfItem({ name: entry.name, effect: entry.system?.effect }) : null;
      if ( trap ) found.push(trap);
    }
  } catch(err) {
    console.error(err);
  }
  for ( const item of game.items ?? [] ) {
    const trap = trapItemOf(item);
    if ( trap && !found.some((other) => other.name === trap.name) ) found.push(trap);
  }
  // Mines first, the ones that deal damage ahead and the lightest of them at the head; then the Traps by name
  found.sort((a, b) => {
    const rank = (trap) => (trap.kind === "mine") ? ((trap.damage > 0) ? 0 : 1) : 2;
    return (rank(a) - rank(b)) || (a.damage - b.damage) || a.name.localeCompare(b.name);
  });
  if ( found.length ) known = found;
  return found;
}

/* -------------------------------------------- */

/**
 * Set a trap down on a tile of a scene, or with nothing named take away what lies there. Such a trap belongs
 * to nobody. Runs for a Game Master.
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile
 * @param {ItemTrap|null} item              What it is; null takes the traps of the tile away
 * @param {object} [options]
 * @param {string} [options.id]             The trap it takes the place of
 * @param {{i: number, j: number}|null} [options.warp]
 * @returns {Promise<LaidTrap|null>}
 */
export async function placeTrap(scene, tile, item, { id = "", warp = null } = {}) {
  if ( !game.user.isGM || !scene?.grid?.isSquare ) return null;
  const kept = laidOn(scene).filter((trap) => id ? (trap.id !== id) : !((trap.i === tile.i) && (trap.j === tile.j)));
  const made = item ? makeTrap(item, tile, { id: id || foundry.utils.randomID(), warp }) : null;
  await save(scene, made ? [...kept, made] : kept);
  return made;
}

/* -------------------------------------------- */

/**
 * Have the Game Master say what a trap on the map is: which of the Mines and Traps of the Items tab, and for
 * one that warps, the tile it sends a unit to, counted in columns and rows from the top left of the map.
 * @param {Scene} scene
 * @param {string} id
 * @returns {Promise<LaidTrap|null>}
 */
export async function configureTrap(scene, id) {
  const trap = laidOn(scene).find((entry) => entry.id === id);
  if ( !game.user.isGM || !trap ) return null;
  const items = await trapItems();
  if ( !items.length ) return trap;
  const [i0, j0] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const escape = foundry.utils.escapeHTML ?? ((text) => text);
  const options = items.map((item) => `<option value="${escape(item.name)}" ${(item.name === trap.name) ? "selected" : ""}>${escape(item.name)}</option>`).join("");
  const layer = layerOf(trap);
  const content = `
    <div class="form-group"><label>${escape(loc("FEO.Trap.config.item"))}</label><select name="item">${options}</select></div>
    <div class="form-group"><label>${escape(loc("FEO.Trap.config.warp"))}</label>
      <div class="form-fields">
        <input type="number" name="col" min="1" step="1" placeholder="${escape(loc("FEO.Trap.config.col"))}" value="${trap.warp ? (trap.warp.j - j0 + 1) : ""}">
        <input type="number" name="row" min="1" step="1" placeholder="${escape(loc("FEO.Trap.config.row"))}" value="${trap.warp ? (trap.warp.i - i0 + 1) : ""}">
      </div>
    </div>
    <p class="hint">${escape(layer ? loc("FEO.Trap.config.laidBy", { name: layer.name }) : loc("FEO.Trap.config.nobody"))}</p>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.Trap.config.title" },
    position: { width: 380 },
    content,
    buttons: [
      { action: "save", label: "FEO.Trap.config.save", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "remove", label: "FEO.Trap.config.remove", icon: "fa-solid fa-trash" },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( !answer || (answer === "cancel") ) return trap;
  if ( answer === "remove" ) {
    await save(scene, laidOn(scene).filter((entry) => entry.id !== id));
    return null;
  }
  const item = items.find((entry) => entry.name === answer.item) ?? items[0];
  const col = Number(answer.col);
  const row = Number(answer.row);
  const warp = (item.warp && Number.isInteger(col) && Number.isInteger(row) && (col >= 1) && (row >= 1)) ? { i: i0 + row - 1, j: j0 + col - 1 } : null;
  if ( item.warp && !(warp && standable(scene, warp)) ) ui.notifications.warn("FEO.Trap.config.noWarp", { localize: true });

  // What the unit that laid it gave it stays with it; one of the Game Master's is made anew
  const made = makeTrap(item, { i: trap.i, j: trap.j }, { id: trap.id, warp: (warp && standable(scene, warp)) ? warp : null });
  const next = trap.by ? normalizeTrap({ ...made, by: trap.by, token: trap.token, side: trap.side, exp: trap.exp, kill: trap.kill, more: trap.more }) : made;
  await save(scene, laidOn(scene).map((entry) => ((entry.id === id) ? next : entry)));
  return next;
}

/* -------------------------------------------- */

/**
 * A battle is over: the mines and traps its units laid are gone with it. Those the Game Master set down on the
 * map stay. Runs for a Game Master.
 * @param {Combat} combat
 * @returns {Promise<number>}     How many were taken away
 */
export async function clearLaid(combat) {
  const scene = combat?.scene ?? null;
  if ( !game.user.isGM || !scene ) return 0;
  const all = laidOn(scene);
  const kept = all.filter((trap) => !trap.by);
  if ( kept.length === all.length ) return 0;
  await save(scene, kept);
  return all.length - kept.length;
}

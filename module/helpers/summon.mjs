import { FEO } from "../config.mjs";
import { planAssignment, planUpdate } from "../rules/classes.mjs";
import {
  catchUpExp, drawWeapon, isSummonSkill, levelsBehind, summonLimit, summonTiles, weaponPool
} from "../rules/summon.mjs";
import { embedClass, findItem, grantSkills, knownSkills } from "./classes.mjs";
import { syncStatus } from "./defeat.mjs";
import { tokenTile } from "./exchange.mjs";
import { phaseOf } from "./phases.mjs";
import { SUMMONED_FLAG, alwaysWields } from "./weapons.mjs";

/**
 * Summoning in Foundry: a unit with the Summon skill puts its Phantom on a tile next to it.
 *
 * A Phantom is a unit of its own, made the first time it is summoned and kept from then on, so that it grows
 * with its summoner. It carries the UUID of its summoner in a flag, which is how the two are told to belong
 * together. Making a unit and placing a token are a Game Master's to do, so a player's summoning is asked of
 * one; what is summoned where, and with which weapon, is decided by the pure rules in `rules/summon.mjs`.
 */

/** The name of the query that asks a Game Master to summon a unit for a player. */
export const SUMMON_QUERY = `${FEO.id}.summon`;

/** The flag, on a summoned unit, that holds the UUID of its summoner. */
const SUMMONER_FLAG = "summoner";

/** The flag, on a summoned unit, that holds the weapon type it fights with. */
const CATEGORY_FLAG = "summonWeapon";

const TEMPLATE = `systems/${FEO.id}/templates/dialog/summon.hbs`;

/** The arrow that points to each side of the summoner. */
const ARROWS = { north: "fa-arrow-up", east: "fa-arrow-right", south: "fa-arrow-down", west: "fa-arrow-left" };

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * Does a skill summon?
 * @param {Item|null} item
 * @returns {boolean}
 */
export function isSummon(item) {
  return (item?.type === "skill") && isSummonSkill(item.name);
}

/* -------------------------------------------- */

/**
 * The unit that summoned a unit, if it was summoned and its summoner can still be found.
 * @param {Actor|null} actor
 * @returns {Actor|null}
 */
export function summonerOf(actor) {
  const uuid = actor?.getFlag?.(FEO.id, SUMMONER_FLAG);
  if ( !uuid ) return null;
  try {
    const found = foundry.utils.fromUuidSync(uuid);
    return (found?.documentName === "Actor") && (found.type === "unit") ? found : null;
  } catch(err) {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * The units a unit has summoned before, in the order they were made.
 * @param {Actor} summoner
 * @returns {Actor[]}
 */
export function phantomsOf(summoner) {
  if ( !summoner?.uuid ) return [];
  return game.actors.filter((actor) => (actor.type === "unit") && (actor.getFlag(FEO.id, SUMMONER_FLAG) === summoner.uuid));
}

/* -------------------------------------------- */

/**
 * Is a summoned unit on a map and in the fight?
 * @param {Actor} phantom
 * @param {Scene} scene
 * @returns {boolean}
 */
function standsOn(phantom, scene) {
  if ( phantom.system.defeat?.state || !(phantom.system.hp.value > 0) ) return false;
  return scene.tokens.some((token) => token.actorId === phantom.id);
}

/* -------------------------------------------- */

/**
 * The names of the skills a unit has equipped.
 * @param {Actor} actor
 * @returns {string[]}
 */
function equippedSkills(actor) {
  return actor.items.filter((item) => (item.type === "skill") && item.system.equipped).map((item) => item.name);
}

/* -------------------------------------------- */

/**
 * The tiles next to a token, each marked free or not. A tile is free when it lies on the map and no unit that
 * is still in the fight stands on it; what is summoned crosses any terrain. Hidden tokens are left out, so
 * that a player learns nothing from a tile that looks empty, and so is the token the returning unit left
 * behind when it fell, which goes as it is summoned again.
 * @param {TokenDocument} token
 * @param {Actor|null} [returning]    The unit that is summoned again, if it is not a new one
 * @returns {{side: string, i: number, j: number, free: boolean}[]}
 */
function tilesAround(token, returning = null) {
  const scene = token.parent;
  const taken = [];
  for ( const other of scene.tokens ) {
    if ( other.hidden || other.actor?.system?.defeat?.state ) continue;
    if ( returning && (other.actorId === returning.id) ) continue;
    const tile = tokenTile(other);
    if ( tile ) taken.push(tile);
  }
  const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;
  const onMap = (tile) => {
    const { x, y } = scene.grid.getCenterPoint({ i: tile.i, j: tile.j });
    return (x >= sceneX) && (x < sceneX + sceneWidth) && (y >= sceneY) && (y < sceneY + sceneHeight);
  };
  return summonTiles(tokenTile(token), { taken, onMap });
}

/* -------------------------------------------- */

/**
 * The weapon type a summoned unit fights with: the one it was made with, else the one it has the best rank in.
 * @param {Actor} phantom
 * @returns {string}
 */
function categoryOf(phantom) {
  const kept = phantom.getFlag(FEO.id, CATEGORY_FLAG);
  if ( FEO.summon.categories.includes(kept) ) return kept;
  const order = Object.keys(FEO.ranks);
  const rank = (key) => order.indexOf(phantom.system.proficiencies[key]?.rank);
  return FEO.summon.categories.reduce((best, key) => (rank(key) > rank(best) ? key : best), FEO.summon.categories[0]);
}

/* -------------------------------------------- */
/*  Summoning                                   */
/* -------------------------------------------- */

/**
 * Ask where the summoned unit is to appear, and for one that is yet to be made, what it fights with.
 * @param {Actor} actor                 The summoner
 * @param {TokenDocument} token         Its token
 * @param {{side: string, i: number, j: number, free: boolean}[]} tiles
 * @param {boolean} fresh               Is the unit yet to be made?
 * @returns {Promise<{tile: {i: number, j: number}, category: string|null}|null>}   Null if it was called off
 */
async function askWhere(actor, token, tiles, fresh) {
  const first = tiles.find((tile) => tile.free);
  const content = document.createElement("div");
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    img: token.texture?.src || actor.img,
    tiles: tiles.map((tile) => ({
      side: tile.side,
      label: game.i18n.localize(tile.free ? `FEO.Summon.side.${tile.side}` : "FEO.Summon.dialog.taken"),
      icon: ARROWS[tile.side],
      taken: !tile.free,
      checked: tile === first
    })),
    categories: fresh ? FEO.summon.categories.map((key, index) => ({
      key,
      label: game.i18n.localize(FEO.proficiencies[key]),
      checked: index === 0
    })) : null
  });
  content.innerHTML = `<div class="feo-class-dialog feo-summon">${html}</div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.Summon.dialog.title", { name: token.name || actor.name }) },
    position: { width: 340 },
    content,
    buttons: [
      { action: "summon", label: "FEO.Summon.dialog.confirm", icon: "fa-solid fa-ghost", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( !answer || (answer === "cancel") ) return null;
  const tile = tiles.find((entry) => entry.free && (entry.side === answer.tile));
  if ( !tile ) return null;
  return { tile: { i: tile.i, j: tile.j }, category: fresh ? (answer.category ?? FEO.summon.categories[0]) : null };
}

/* -------------------------------------------- */

/**
 * Summon a unit's Phantom next to it: check that it may, ask where, draw its weapon, and have it placed. A
 * Game Master places it at once; anyone else asks one who is connected.
 * @param {Actor} actor                   The summoner
 * @param {TokenDocument|null} token      Its token on the map
 * @returns {Promise<{rows: {label: string, value: string, cls?: string}[], note: string|null, rolls: Roll[]}|null>}
 *          What the chat card of the skill says of it, or null if nothing was summoned
 */
export async function summon(actor, token) {
  const scene = token?.parent ?? null;
  if ( !scene || !tokenTile(token) ) {
    ui.notifications.warn("FEO.Summon.warn.noToken", { localize: true });
    return null;
  }

  // One Phantom at a time, unless a skill allows more
  const owned = phantomsOf(actor);
  const out = owned.filter((phantom) => standsOn(phantom, scene));
  const limit = summonLimit(equippedSkills(actor), actor.system.level);
  if ( out.length >= limit ) {
    ui.notifications.warn(game.i18n.format(limit === 1 ? "FEO.Summon.warn.limitOne" : "FEO.Summon.warn.limit", { limit }));
    return null;
  }
  const gm = game.user.isGM ? null : game.users.activeGM;
  if ( !game.user.isGM && !gm ) {
    ui.notifications.warn("FEO.Summon.warn.noGM", { localize: true });
    return null;
  }

  // The first of its Phantoms that is not out there returns; else a new one is made
  const phantom = owned.find((entry) => !out.includes(entry)) ?? null;
  const tiles = tilesAround(token, phantom);
  if ( !tiles.some((tile) => tile.free) ) {
    ui.notifications.warn("FEO.Summon.warn.noRoom", { localize: true });
    return null;
  }
  const where = await askWhere(actor, token, tiles, !phantom);
  if ( !where ) return null;

  // Its weapon is drawn from those of its level, with a die that has a face for each
  const category = phantom ? categoryOf(phantom) : where.category;
  const pool = weaponPool(phantom?.system.level ?? 1, category);
  if ( !pool.length ) {
    ui.notifications.warn("FEO.Summon.warn.noWeapon", { localize: true });
    return null;
  }
  const roll = new foundry.dice.Roll(`1d${pool.length}`);
  await roll.evaluate();
  const weapon = drawWeapon(pool, roll.total);

  const base = game.i18n.format("FEO.Summon.name", { name: actor.name });
  const request = {
    summoner: actor.uuid,
    scene: scene.id,
    token: token.id,
    tile: where.tile,
    phantom: phantom?.id ?? null,
    category,
    weapon,
    name: owned.length ? `${base} ${owned.length + 1}` : base
  };
  let result = null;
  try {
    result = game.user.isGM ? await placeSummon(request) : await gm.query(SUMMON_QUERY, request, { timeout: 20000 });
  } catch(err) {
    console.error(err);
  }
  if ( !result?.ok ) {
    ui.notifications.warn(`FEO.Summon.warn.${result?.reason ?? "failed"}`, { localize: true });
    return null;
  }

  const rows = [
    { label: game.i18n.localize("FEO.Summon.row.unit"), value: game.i18n.format("FEO.Summon.row.unitValue", { name: result.name, level: result.level }) },
    { label: game.i18n.localize("FEO.Summon.row.weapon"), value: result.weapon }
  ];
  if ( result.behind > 0 ) {
    rows.push({ label: game.i18n.localize("FEO.Summon.row.behind"), value: String(result.behind), cls: "gold" });
  }
  const { points, barred } = FEO.summon.growth;
  const note = result.created ? game.i18n.format("FEO.Summon.created", {
    name: result.name,
    points,
    barred: barred.map((key) => game.i18n.localize(FEO.growths[key])).join(", ")
  }) : null;
  return { rows, note, rolls: [roll] };
}

/* -------------------------------------------- */
/*  Placing                                     */
/* -------------------------------------------- */

/**
 * Make a summoner's Phantom: a unit of the Phantom class at level 1, in its summoner's hands and on its side,
 * with the class's stats, skills and Special Qualities, a rank in the weapon type it fights with, and no
 * growth rates until its player assigns them.
 * @param {Actor} summoner
 * @param {TokenDocument} token       The summoner's token
 * @param {Item} cls                  The Phantom class
 * @param {string} category           The weapon type it fights with
 * @param {string} name
 * @returns {Promise<Actor>}
 */
async function makePhantom(summoner, token, cls, category, name) {
  const Actor = foundry.documents.Actor.implementation;
  const phantom = await Actor.create({
    name,
    type: "unit",
    img: cls.img,
    folder: summoner.folder?.id ?? null,
    ownership: foundry.utils.deepClone(summoner.ownership),
    system: { army: summoner.system.army, player: summoner.system.player },
    prototypeToken: {
      name,
      actorLink: true,
      disposition: token.disposition,
      texture: { src: cls.img },
      bar1: { attribute: "hp" },
      displayBars: token.displayBars,
      displayName: token.displayName
    },
    flags: { [FEO.id]: { [SUMMONER_FLAG]: summoner.uuid, [CATEGORY_FLAG]: category } }
  });

  const known = await knownSkills();
  const change = planAssignment(phantom._source.system, cls, {
    stats: true,
    weight: true,
    qualities: true,
    proficiencies: { [category]: FEO.startingRanks.first },
    skills: true,
    known
  });
  const owned = await embedClass(phantom, cls);
  const update = { ...planUpdate(change), "system.classId": owned.id };
  for ( const key of Object.keys(phantom._source.system.growths) ) update[`system.growths.${key}`] = 0;
  await phantom.update(update);
  await grantSkills(phantom, change.skills);
  return phantom;
}

/* -------------------------------------------- */

/**
 * Hand a summoned unit the weapon it was summoned with, in place of the one it was handed before.
 * @param {Actor} phantom
 * @param {Item} source       The weapon to copy
 * @returns {Promise<Item>}
 */
async function handWeapon(phantom, source) {
  const old = phantom.items.filter((item) => (item.type === "weapon") && alwaysWields(item)).map((item) => item.id);
  if ( old.length ) await phantom.deleteEmbeddedDocuments("Item", old);
  const held = phantom.items.filter((item) => (item.type === "weapon") && item.system.equipped)
    .map((item) => ({ _id: item.id, "system.equipped": false }));
  if ( held.length ) await phantom.updateEmbeddedDocuments("Item", held);

  const data = source.inCompendium ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
  delete data._id;
  data.system.equipped = true;
  foundry.utils.setProperty(data, `flags.${FEO.id}.${SUMMONED_FLAG}`, true);
  const [item] = await phantom.createEmbeddedDocuments("Item", [data]);
  return item;
}

/* -------------------------------------------- */

/**
 * Place a summoned unit on the map: make it if it does not exist yet, bring it back to full strength, hand it
 * its weapon, put its token on the tile and into the battle fought there. Runs for a Game Master, and checks
 * everything it is asked for against the rules once more.
 * @param {object} request
 * @param {string} request.summoner       The UUID of the summoner
 * @param {string} request.scene          The id of the scene
 * @param {string} request.token          The id of the summoner's token there
 * @param {{i: number, j: number}} request.tile
 * @param {string|null} request.phantom   The id of the unit to summon, or null to make one
 * @param {string} request.category       The weapon type it fights with
 * @param {string} request.weapon         The name of the weapon drawn for it
 * @param {string} request.name           What a unit that is made is called
 * @returns {Promise<{ok: boolean, reason?: string, name?: string, level?: number, weapon?: string,
 *   behind?: number, created?: boolean}>}
 */
export async function placeSummon(request = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if ( !game.user.isGM ) return fail("failed");
  const config = FEO.summon;
  const summoner = (typeof request.summoner === "string") ? await foundry.utils.fromUuid(request.summoner) : null;
  const scene = game.scenes.get(request.scene);
  const token = scene?.tokens.get(request.token);
  if ( (summoner?.documentName !== "Actor") || (summoner.type !== "unit") || !token || (token.actor !== summoner) ) return fail("failed");
  if ( !summoner.items.some((item) => isSummon(item) && item.system.equipped) ) return fail("failed");

  // The unit to summon: one of this summoner's that is not out there, or a new one while it may have another
  const owned = phantomsOf(summoner);
  const out = owned.filter((phantom) => standsOn(phantom, scene));
  if ( out.length >= summonLimit(equippedSkills(summoner), summoner.system.level) ) return fail("limitOne");
  let phantom = request.phantom ? owned.find((entry) => entry.id === request.phantom) : null;
  if ( request.phantom && (!phantom || out.includes(phantom)) ) return fail("failed");

  // Where: a free tile next to the summoner
  const tile = tilesAround(token, phantom).find((entry) => entry.free && (entry.i === request.tile?.i) && (entry.j === request.tile?.j));
  if ( !tile ) return fail("noRoom");

  // With what: a weapon of its type that its level can draw
  const category = phantom ? categoryOf(phantom) : request.category;
  if ( !config.categories.includes(category) ) return fail("failed");
  if ( !weaponPool(phantom?.system.level ?? 1, category).includes(request.weapon) ) return fail("noWeapon");
  const source = await findItem("weapon", request.weapon);
  if ( !source ) return fail("noWeapon");

  const created = !phantom;
  if ( created ) {
    const cls = await findItem("class", config.class);
    if ( !cls ) return fail("noClass");
    const name = String(request.name ?? "").trim().slice(0, 80) || game.i18n.format("FEO.Summon.name", { name: summoner.name });
    phantom = await makePhantom(summoner, token, cls, category, name);
  }

  // It appears whole: on its feet, at full HP, and with the level ups it is behind its summoner waiting
  const behind = levelsBehind(summoner.system.level, phantom.system.level);
  await phantom.update({
    "system.wounds": 0,
    "system.injuries": 0,
    "system.defeat": { state: "", turns: 0, paused: false },
    "system.hp.value": phantom._source.system.hp.max,
    "system.exp": catchUpExp(summoner.system.level, phantom.system.level),
    "system.waiting": false,
    "system.break": false
  });
  await syncStatus(phantom);
  const weapon = await handWeapon(phantom, source);

  // The token it left behind when it fell goes, and a new one stands on the tile
  const left = scene.tokens.filter((other) => other.actorId === phantom.id).map((other) => other.id);
  if ( left.length ) await scene.deleteEmbeddedDocuments("Token", left);
  const { x, y } = scene.grid.getTopLeftPoint({ i: tile.i, j: tile.j });
  const placed = await phantom.getTokenDocument({ x, y, actorLink: true, disposition: token.disposition, hidden: token.hidden });
  const [made] = await scene.createEmbeddedDocuments("Token", [placed.toObject()]);

  // It joins the battle that is being fought there
  const combat = game.combats.find((other) => other.started && phaseOf(other) && (!other.scene || (other.scene === scene)));
  if ( combat && made && !combat.combatants.some((combatant) => combatant.tokenId === made.id) ) {
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: made.id, sceneId: scene.id, actorId: phantom.id, hidden: made.hidden }]);
  }
  return { ok: true, name: phantom.name, level: phantom.system.level, weapon: weapon.name, behind, created };
}

/* -------------------------------------------- */
/*  Keeping in step                             */
/* -------------------------------------------- */

/**
 * A summoner has gained a level: each unit it has summoned has one more level up waiting. Runs once, for the
 * designated Game Master.
 * @param {Actor} actor
 * @param {object} changed
 * @returns {Promise<void>}
 */
async function followLevel(actor, changed) {
  if ( !game.user.isActiveGM || (actor?.type !== "unit") ) return;
  if ( !foundry.utils.hasProperty(changed, "system.level") ) return;
  for ( const phantom of phantomsOf(actor) ) {
    const exp = catchUpExp(actor.system.level, phantom.system.level);
    if ( exp !== phantom.system.exp ) await phantom.update({ "system.exp": exp });
  }
}

/* -------------------------------------------- */

/**
 * Keep summoned units in step with their summoners.
 */
export function registerHooks() {
  Hooks.on("updateActor", (actor, changed) => {
    followLevel(actor, changed).catch((err) => console.error(err));
  });
}

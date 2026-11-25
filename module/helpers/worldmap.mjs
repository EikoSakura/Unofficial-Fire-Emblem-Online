import { FEO } from "../config.mjs";
import { arriveAt, cleanWorldMap, landKey, makeLand, pathBetween, pictureLand, unpackClaims } from "../rules/worldmap.mjs";
import { beginEncounter, readEncounters } from "./encounters.mjs";

/**
 * The World Map in Foundry: what the world remembers of it, and what is done on it at the table. What a world
 * remembers is one world setting, which only a Game Master may write: the Game Master moves the company, and a
 * player can only point at a place, which is told to every client and changes nothing.
 *
 * The land itself is not kept. It is made again from its seed wherever it is shown (see `rules/worldmap.mjs`),
 * or read from the picture the Game Master chose, and held here for as long as the page is open.
 *
 * @import {Land, WorldMapState} from "../rules/worldmap.mjs"
 */

/** The world setting that holds the map. */
export const WORLD_MAP_SETTING = FEO.worldMap.setting;

/** Where clients tell one another what is pointed at and shown. */
const SOCKET = `system.${FEO.id}`;

/* -------------------------------------------- */
/*  Reading and Writing                         */
/* -------------------------------------------- */

/**
 * Register the setting that holds the map, and what clients tell one another about it.
 * @param {object} told
 * @param {() => void} told.changed                             The map changed
 * @param {(place: string, user: User) => void} told.pointed    A user pointed at a place
 * @param {(travel: boolean) => void} told.shown                A Game Master shows the map to everyone, over the
 *                                                              whole screen if `travel` is set
 */
export function registerWorldMap({ changed, pointed, shown }) {
  game.settings.register(FEO.id, WORLD_MAP_SETTING, {
    scope: "world", config: false, type: Object, default: {}, onChange: () => changed()
  });
  game.settings.register(FEO.id, FEO.worldMap.travel, { scope: "client", config: false, type: Boolean, default: false });
  Hooks.once("ready", () => {
    game.socket?.on(SOCKET, (message) => {
      const user = game.users.get(message?.user);
      if ( !user ) return;
      if ( message.type === "worldMap.point" ) pointed(String(message.place ?? ""), user);
      else if ( (message.type === "worldMap.show") && user.isGM ) shown(message.travel === true);
    });
  });
}

/* -------------------------------------------- */

/**
 * Did this user last have the map over the whole screen?
 * @returns {boolean}
 */
export function readTravel() {
  return game.settings.get(FEO.id, FEO.worldMap.travel) === true;
}

/* -------------------------------------------- */

/**
 * Remember whether this user has the map over the whole screen.
 * @param {boolean} on
 * @returns {Promise<void>}
 */
export async function keepTravel(on) {
  await game.settings.set(FEO.id, FEO.worldMap.travel, on === true);
}

/* -------------------------------------------- */

/**
 * What the world remembers of its map.
 * @returns {WorldMapState}
 */
export function readWorldMap() {
  return cleanWorldMap(game.settings.get(FEO.id, WORLD_MAP_SETTING));
}

/* -------------------------------------------- */

/**
 * Keep the map. Runs for a Game Master.
 * @param {WorldMapState} map
 * @returns {Promise<WorldMapState>}
 */
export async function writeWorldMap(map) {
  const clean = cleanWorldMap(map);
  if ( game.user.isGM ) await game.settings.set(FEO.id, WORLD_MAP_SETTING, clean);
  return clean;
}

/* -------------------------------------------- */

/**
 * Change the map as it stands now and keep it, if anything changed. Runs for a Game Master.
 * @param {(map: WorldMapState) => void} change     Changes the map it is given
 * @returns {Promise<WorldMapState>}
 */
export async function changeWorldMap(change) {
  const before = readWorldMap();
  if ( !game.user.isGM ) return before;
  const map = foundry.utils.deepClone(before);
  change(map);
  return JSON.stringify(map) === JSON.stringify(before) ? before : writeWorldMap(map);
}

/* -------------------------------------------- */
/*  The Land                                    */
/* -------------------------------------------- */

/** The lands made on this page, by what each was made from. The last few are kept. */
const lands = new Map();

/**
 * Keep a land for the next time it is asked for.
 * @param {Land} land
 * @returns {Land}
 */
function hold(land) {
  lands.delete(land.key);
  lands.set(land.key, land);
  while ( lands.size > 4 ) lands.delete(lands.keys().next().value);
  return land;
}

/* -------------------------------------------- */

/**
 * Read a picture at the size of the map, filling it and cut where it is too wide or too tall.
 * @param {string} src
 * @returns {Promise<Uint8ClampedArray>}      Red, green, blue and alpha for each point
 */
async function readPicture(src) {
  const { width: W, height: H } = FEO.worldMap;
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`The picture ${src} could not be read`));
    image.src = src;
  });
  const sheet = document.createElement("canvas");
  sheet.width = W;
  sheet.height = H;
  const pen = sheet.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(W / image.naturalWidth, H / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  pen.fillStyle = "#6f96a6";
  pen.fillRect(0, 0, W, H);
  pen.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
  return pen.getImageData(0, 0, W, H).data;
}

/* -------------------------------------------- */

/**
 * The land of a map: the picture it is drawn over if it has one and that can be read, the land made from its
 * seed and shape otherwise.
 * @param {{backdrop?: string, seed: string, shape: string}} map
 * @returns {Promise<Land>}
 */
export async function landOf(map) {
  if ( map.backdrop ) {
    const key = `picture|${map.backdrop}`;
    if ( lands.has(key) ) return lands.get(key);
    try {
      return hold(pictureLand(key, await readPicture(map.backdrop)));
    } catch(err) {
      console.warn(err);
      ui.notifications.warn(game.i18n.format("FEO.WorldMap.warn.picture", { path: map.backdrop }));
    }
  }
  const key = landKey(map);
  return lands.get(key) ?? hold(makeLand(map));
}

/* -------------------------------------------- */

/** The ground last unpacked, which is asked for again each time the map is drawn. */
let unpacked = { text: null, size: 0, claims: null };

/**
 * Whose ground each point of a map is.
 * @param {WorldMapState} map
 * @param {Land} land
 * @returns {Uint8Array}      Not to be changed: it is shared by everything that draws this map
 */
export function claimsOf(map, land) {
  const size = land.width * land.height;
  if ( (unpacked.text !== map.claims) || (unpacked.size !== size) ) {
    unpacked = { text: map.claims, size, claims: unpackClaims(map.claims, size) };
  }
  return unpacked.claims;
}

/* -------------------------------------------- */
/*  At the Table                                */
/* -------------------------------------------- */

/**
 * The company marches to a place along the routes, and arrives. Every client sees the map change and walks the
 * banner there. Runs for a Game Master.
 * @param {string} id
 * @returns {Promise<boolean>}        Did it set out?
 */
export async function marchTo(id) {
  if ( !game.user.isGM ) return false;
  const before = readWorldMap();
  if ( (before.party === id) || !pathBetween(before, before.party, id) ) return false;
  await changeWorldMap((map) => arriveAt(map, id));
  return true;
}

/* -------------------------------------------- */

/**
 * Change one place of the map. Runs for a Game Master.
 * @param {string} id
 * @param {(place: import("../rules/worldmap.mjs").Place) => void} change
 * @returns {Promise<WorldMapState>}
 */
export function changePlace(id, change) {
  return changeWorldMap((map) => {
    const place = map.places.find((other) => other.id === id);
    if ( place ) change(place);
  });
}

/* -------------------------------------------- */

/**
 * The saved encounter of the battle that waits at a place, if it has one that is still kept.
 * @param {{encounter: string}|null} place
 * @returns {import("../rules/encounters.mjs").Encounter|null}
 */
export function encounterAt(place) {
  return place?.encounter ? (readEncounters().find((encounter) => encounter.id === place.encounter) ?? null) : null;
}

/* -------------------------------------------- */

/**
 * Begin the battle that waits at a place, as the Encounter Builder would. Runs for a Game Master.
 * @param {{encounter: string}} place
 * @returns {Promise<Combat|null>}
 */
export async function beginBattleAt(place) {
  const encounter = encounterAt(place);
  return encounter && game.user.isGM ? beginEncounter(encounter) : null;
}

/* -------------------------------------------- */

/**
 * Point at a place: it flashes on every map that is open.
 * @param {string} id
 */
export function pointAt(id) {
  game.socket?.emit(SOCKET, { type: "worldMap.point", place: id, user: game.user.id });
}

/* -------------------------------------------- */

/**
 * Open the map on every client. Runs for a Game Master.
 * @param {boolean} [travel]      Open it over the whole screen
 */
export function showToAll(travel = false) {
  if ( game.user.isGM ) game.socket?.emit(SOCKET, { type: "worldMap.show", user: game.user.id, travel: travel === true });
}

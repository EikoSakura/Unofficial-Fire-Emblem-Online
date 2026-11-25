import { FEO } from "../config.mjs";
import { levelUpShowing, playLevelUp } from "../apps/level-up-splash.mjs";
import { raisedCount, readSplash, splashLine, splashRows } from "../rules/level-up.mjs";
import { growthValue } from "./earnings-context.mjs";
import { armyOf } from "./exchange.mjs";
import { isPlayerUnit } from "./players.mjs";

/**
 * The Level Up splash, in Foundry: putting together what it shows of a level up, playing it for the one who
 * levelled the unit and for those who watch, and each user's own settings for it. What it shows is decided by
 * the pure rules in `rules/level-up.mjs`, and how it looks and moves by `apps/level-up-splash.mjs`.
 *
 * Nothing here decides what a level up does: `showLevelUp` is called by the level up, with the dice already
 * rolled and what they came to already saved.
 *
 * @import {GrowthResult} from "../rules/progression.mjs"
 * @import {LevelUpSplash} from "../apps/level-up-splash.mjs"
 */

/** The socket the system's clients talk over. */
const SOCKET = `system.${FEO.id}`;

/** The client setting for whether this user is shown the splash. */
export const SPLASH_SETTING = "levelUpSplash";

/** The client setting for whether the splash leaves by itself for this user. */
export const AUTO_SETTING = "levelUpAuto";

/* -------------------------------------------- */

/**
 * Read a setting of the system, or nothing where it is not there yet.
 * @param {string} key
 * @returns {*}
 */
function setting(key) {
  try {
    return game.settings.get(FEO.id, key);
  } catch(err) {
    return undefined;
  }
}

/* -------------------------------------------- */

/**
 * Is this user shown the Level Up splash?
 * @returns {boolean}
 */
export function levelUpSplashOn() {
  return setting(SPLASH_SETTING) !== false;
}

/* -------------------------------------------- */

/**
 * What a stat that a level up can raise stands at, as the unit's own number without what is added on top.
 * @param {object} system     The unit's prepared data
 * @param {string} key        A key of FEO.growths
 * @returns {number}
 */
export function standsAt(system, key) {
  if ( key === "hp" ) return system.hp.base ?? system.hp.max;
  if ( key in FEO.abilities ) return system.abilities[key].total;
  if ( key === "wlv" ) return system.weaponLevel?.base ?? 0;
  return system.stats[key]?.base ?? 0;
}

/* -------------------------------------------- */

/**
 * Put together the splash of a level up. It is read from the unit as it stands, so it is called before what
 * the level up raised is saved.
 * @param {Actor} actor
 * @param {object} told
 * @param {number} told.from                The level the unit has
 * @param {number} told.to                  The level it reaches
 * @param {(GrowthResult & {reroll?: {skill: string, first: number}})[]} told.results   The growth rolls, after
 *                                          any that were rolled again; or the points placed by hand
 * @param {number} told.points              The ability points the level gives
 * @param {{label: string, value: string}[]} [told.notes]     What the unit's skills did, as the rows of the
 *                                          level-up card
 * @returns {LevelUpSplash}
 */
export function buildLevelUpSplash(actor, { from, to, results, points, notes = [] }) {
  const i18n = game.i18n;
  const system = actor.system;
  const stood = Object.fromEntries(results.map((result) => [result.key, standsAt(system, result.key)]));
  const rows = splashRows(results, stood).map((row, index) => {
    const result = results[index];
    const rolled = !result.capped && (result.roll !== null) && (result.roll !== undefined);
    return { ...row, label: i18n.localize(FEO.growths[row.key] ?? row.key), tip: rolled ? growthValue(result, i18n) : "" };
  });
  return {
    army: armyOf(actor, actor.token),
    name: actor.token?.name ?? actor.name,
    className: system.className ?? "",
    img: actor.img ?? "",
    from,
    to,
    text: {
      title: i18n.localize("FEO.LevelUp.splash.title"),
      skip: i18n.localize("FEO.LevelUp.splash.skip"),
      auto: i18n.localize("FEO.LevelUp.splash.auto"),
      next: i18n.localize("FEO.LevelUp.splash.next"),
      atCap: i18n.localize("FEO.LevelUp.atCap")
    },
    rows,
    skill: results.find((result) => result.reroll)?.reroll.skill ?? "",
    chips: [
      { label: i18n.localize("FEO.LevelUp.abilityPoints"), value: `+${points}` },
      ...notes.map((note) => ({ label: note.label, value: note.value }))
    ],
    line: splashLine(system.levelLines, raisedCount(rows))
  };
}

/* -------------------------------------------- */

/**
 * Play the splash of a level up: for this user, who levelled the unit, and for everyone else at the table where
 * the unit is a player's. It is over once this user has sent it on, or at once where they have it off.
 * @param {Actor} actor
 * @param {LevelUpSplash} splash
 * @returns {Promise<void>}
 */
export async function showLevelUp(actor, splash) {
  try {
    if ( isPlayerUnit(actor) ) game.socket?.emit(SOCKET, { type: "unit.levelUp", splash });
    if ( !levelUpSplashOn() ) return;
    await playLevelUp(splash, {
      auto: !!setting(AUTO_SETTING),
      onAuto: (auto) => game.settings.set(FEO.id, AUTO_SETTING, auto)
    });
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */
/*  Settings and Hooks                          */
/* -------------------------------------------- */

/**
 * Register each user's own settings for the splash. Called once, when the system starts.
 */
export function registerSettings() {
  game.settings.register(FEO.id, SPLASH_SETTING, {
    name: "FEO.Setting.levelUpSplash.name",
    hint: "FEO.Setting.levelUpSplash.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(FEO.id, AUTO_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
}

/* -------------------------------------------- */

/**
 * Register what the splash listens for: a level up another user made. One that comes while a splash is on the
 * screen is left to the chat card. Called once, when the system starts.
 */
export function registerHooks() {
  Hooks.once("ready", () => {
    game.socket?.on(SOCKET, (message) => {
      if ( (message?.type !== "unit.levelUp") || !levelUpSplashOn() || levelUpShowing() ) return;
      const splash = readSplash(message.splash);
      if ( splash ) playLevelUp(splash, { watch: true });
    });
  });
}

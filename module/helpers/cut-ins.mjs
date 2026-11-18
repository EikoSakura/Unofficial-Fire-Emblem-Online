import { FEO } from "../config.mjs";
import { beatTime, fightCutIns, holdTime, planBeats, plateText, queueBeats } from "../rules/cut-ins.mjs";

/**
 * Skill cut-ins, in Foundry: as a skill takes effect its icon and name flash over its unit's tokens for a
 * moment, with a sound, on every client that has them switched on. They are shown one after the other (see
 * `rules/cut-ins.mjs`), and whatever is floated over units meanwhile waits for them, so that a skill is named
 * before its numbers are shown (see `float` in `helpers/events.mjs`).
 *
 * A cut-in is a small plate laid over the page above the token, in the cloth of the Battle HUD, whose layer it
 * shares the looks of without needing the HUD to be open. It takes no clicks. A user who has asked for less
 * motion is shown the plate standing still. Where the unit has no token on the map in view nothing is shown,
 * and nothing waits.
 *
 * Nothing here decides what a skill does: `cutIn` is called from the places that already tell of one.
 */

/** The socket the system's clients talk over. */
const SOCKET = `system.${FEO.id}`;

/** The client setting for how fast cut-ins are, or that they are off. */
export const SPEED_SETTING = "cutIns";

/** The client setting for whether a cut-in sounds. */
export const SOUND_SETTING = "cutInSound";

/** The world setting for which sound that is. */
export const SOUND_FILE_SETTING = "cutInSoundFile";

/** The id of the layer the plates are laid on. */
const LAYER_ID = "feo-cut-ins";

/** How many cut-ins one message may carry. */
const MOST_SENT = 24;

/** The beats that wait to be shown. @type {import("../rules/cut-ins.mjs").CutInBeat[]} */
let waiting = [];

/** The beat that is showing. @type {import("../rules/cut-ins.mjs").CutInBeat|null} */
let showing = null;

/** When the beat that is showing ends, and the timer that ends it. */
let ends = 0;
let timer = null;

/** The plates on the page, each with the token it stands over. @type {{plate: HTMLElement, token: Token}[]} */
let plates = [];

/** The units cut-ins wait for, by UUID, with the icons of their skills. @type {Map<string, {actor: Actor, icons: Map<string, string>}>} */
const known = new Map();

/** The icons of the skills compendium, by name. @type {Map<string, string>|null} */
let packIcons = null;

/* -------------------------------------------- */
/*  Reading                                     */
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
 * How long one cut-in stays on this client, in milliseconds.
 * @returns {number}      0 where this user has cut-ins off
 */
function timeNow() {
  return beatTime(setting(SPEED_SETTING));
}

/* -------------------------------------------- */

/**
 * Does this user have cut-ins on?
 * @returns {boolean}
 */
export function cutInsOn() {
  return timeNow() > 0;
}

/* -------------------------------------------- */

/**
 * The tokens of a unit this user sees on the map in view.
 * @param {Actor} actor
 * @returns {Token[]}
 */
function tokensOf(actor) {
  if ( !globalThis.canvas?.ready ) return [];
  return (actor?.getActiveTokens?.(true, false) ?? []).filter((token) => !token.destroyed && token.isVisible);
}

/* -------------------------------------------- */

/**
 * The icon of a skill that is named over a unit: that of the skill the unit has, or of the skill of that name
 * in the system's compendium. What is said of a skill after its name ("Skill: Weapon") is left aside.
 * @param {Actor|null} actor
 * @param {string} text
 * @returns {string|null}     Null for what names no skill
 */
export function skillIcon(actor, text) {
  if ( !packIcons ) {
    packIcons = new Map();
    for ( const entry of game.packs?.get(`${FEO.id}.skills`)?.index ?? [] ) if ( entry.name ) packIcons.set(entry.name, entry.img || FEO.cutIns.icon);
  }
  const said = String(text ?? "");
  for ( const name of new Set([said, said.split(": ")[0]]) ) {
    if ( !name ) continue;
    const own = actor?.items?.find?.((item) => (item.type === "skill") && (item.name === name));
    if ( own ) return own.img || FEO.cutIns.icon;
    if ( packIcons.has(name) ) return packIcons.get(name);
  }
  return null;
}

/* -------------------------------------------- */

/**
 * How long what is floated over units waits on this client for the cut-ins to be over.
 * @returns {number}      Milliseconds; 0 where none is showing
 */
export function cutInHold() {
  return (timer === null) ? 0 : holdTime(waiting.length, ends - Date.now(), timeNow());
}

/* -------------------------------------------- */
/*  Showing                                     */
/* -------------------------------------------- */

/**
 * The layer the plates are laid on, made when the first is.
 * @returns {HTMLElement}
 */
function layer() {
  let found = document.getElementById(LAYER_ID);
  if ( !found ) {
    found = document.createElement("div");
    found.id = LAYER_ID;
    found.className = "feo feo-hud feo-cuts";
    found.setAttribute("aria-hidden", "true");
    document.body.append(found);
  }
  return found;
}

/* -------------------------------------------- */

/**
 * Set a plate over its token, wherever the map has been moved to.
 * @param {{plate: HTMLElement, token: Token}} entry
 */
function place({ plate, token }) {
  if ( token.destroyed || !globalThis.canvas?.ready ) return;
  const top = canvas.clientCoordinatesFromCanvas({ x: token.center.x, y: token.center.y - (token.h / 2) });
  plate.style.left = `${Math.round(top.x)}px`;
  plate.style.top = `${Math.round(top.y)}px`;
}

/* -------------------------------------------- */

/**
 * Take the plates off the page.
 */
function clearPlates() {
  for ( const { plate } of plates ) plate.remove();
  plates = [];
}

/* -------------------------------------------- */

/**
 * Lay one plate of a beat over every token of its unit.
 * @param {import("../rules/cut-ins.mjs").CutInPlate} told
 * @param {number} time     How long it stays, in milliseconds
 * @returns {number}        How many were laid
 */
function draw(told, time) {
  const unit = known.get(told.unit);
  const tokens = unit ? tokensOf(unit.actor) : [];
  if ( !tokens.length ) return 0;
  const { names, more } = plateText(told);
  for ( const token of tokens ) {
    const plate = document.createElement("div");
    plate.className = "cut";
    plate.style.setProperty("--feo-cut-time", `${time}ms`);
    const icons = document.createElement("span");
    icons.className = "cut-icons";
    for ( const skill of told.skills.slice(0, names.length) ) {
      const icon = document.createElement("img");
      icon.src = unit.icons.get(skill.name) ?? FEO.cutIns.icon;
      icon.alt = "";
      icons.append(icon);
    }
    const name = document.createElement("b");
    name.className = "cut-name";
    name.textContent = names.join(" · ");
    plate.append(icons, name);
    if ( more ) {
      const rest = document.createElement("small");
      rest.textContent = `+${more}`;
      plate.append(rest);
    }
    const entry = { plate, token };
    place(entry);
    layer().append(plate);
    plates.push(entry);
  }
  return tokens.length;
}

/* -------------------------------------------- */

/**
 * Sound a cut-in on this client, where this user has the sound on. It is one of the interface's sounds, so
 * that it is as loud as the user has those.
 */
function sound() {
  try {
    if ( setting(SOUND_SETTING) === false ) return;
    const src = FEO.cutIns.sounds[setting(SOUND_FILE_SETTING)];
    if ( src ) foundry.audio.AudioHelper.play({ src, volume: FEO.cutIns.volume, autoplay: true, loop: false }, false);
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */

/**
 * Show the next beat that waits, and come back once it has had its time. With none left, everything is put
 * away.
 */
function step() {
  clearPlates();
  const time = timeNow();
  showing = null;
  while ( time && waiting.length ) {
    const beat = waiting.shift();
    let laid = 0;
    for ( const plate of beat ) laid += draw(plate, time);
    if ( !laid ) continue;
    showing = beat;
    sound();
    ends = Date.now() + time;
    timer = setTimeout(step, time);
    return;
  }
  waiting = [];
  timer = null;
  ends = 0;
  known.clear();
}

/* -------------------------------------------- */

/**
 * Is a skill of a unit already showing or waiting to be shown? What tells of it twice in a row is shown once.
 * @param {string} unit
 * @param {string} skill
 * @returns {boolean}
 */
function told(unit, skill) {
  const beats = showing ? [showing, ...waiting] : waiting;
  return beats.some((beat) => beat.some((plate) => (plate.unit === unit) && plate.skills.some((entry) => entry.name === skill)));
}

/* -------------------------------------------- */

/**
 * Flash skills over their units on this client, in the order given, after whatever cut-ins already wait.
 * @param {{actor: Actor|null, skill: string}[]} shown
 * @returns {boolean}     Whether any will be shown
 */
export function showCutIns(shown) {
  if ( !shown?.length || !timeNow() || !globalThis.canvas?.ready ) return false;
  const fresh = [];
  for ( const { actor, skill } of shown ) {
    const name = String(skill ?? "");
    if ( !actor?.uuid || !name || !tokensOf(actor).length || told(actor.uuid, name) ) continue;
    const unit = known.get(actor.uuid) ?? { actor, icons: new Map() };
    known.set(actor.uuid, unit);
    if ( !unit.icons.has(name) ) unit.icons.set(name, skillIcon(actor, name) ?? FEO.cutIns.icon);
    fresh.push({ unit: actor.uuid, skill: name });
  }
  if ( !fresh.length ) {
    if ( timer === null ) known.clear();
    return false;
  }
  waiting = queueBeats(waiting, planBeats(fresh));
  if ( timer === null ) step();
  return true;
}

/* -------------------------------------------- */

/**
 * Flash skills over their units for everyone who has their map in view and cut-ins on, in the order given.
 * @param {{actor: Actor|null, skill: string}[]} shown
 */
export function cutIn(shown) {
  const list = (shown ?? []).filter((entry) => entry?.actor?.uuid && entry.skill).slice(0, MOST_SENT);
  if ( !list.length ) return;
  showCutIns(list);
  game.socket?.emit(SOCKET, { type: "unit.cutIn", shown: list.map(({ actor, skill }) => ({ actor: actor.uuid, skill: String(skill) })) });
}

/* -------------------------------------------- */

/**
 * Flash the skills that took effect in a fight by chance or by choice over the two units, in the order they
 * did (see `fightCutIns`). It is called before what the fight did is saved, so that they come before its
 * numbers.
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {{initiator: Actor, defender: Actor}} actors
 * @param {object} [options]
 * @param {string} [options.started]    The skill that had its unit start the fight, where one did
 */
export function cutInFight(result, actors, { started = "" } = {}) {
  const declared = {};
  for ( const by of ["initiator", "defender"] ) {
    declared[by] = (result?.[by]?.spent ?? []).filter((spent) => {
      const items = actors[by]?.items;
      const item = items?.get(spent.id) ?? items?.find((entry) => (entry.type === "skill") && (entry.name === spent.name));
      const kind = item?.system?.usage?.kind;
      return !!kind && (kind !== "auto");
    }).map((spent) => spent.name);
  }
  if ( started ) declared.initiator = [started, ...declared.initiator];
  cutIn(fightCutIns(result, declared).map(({ by, skill }) => ({ actor: actors[by], skill })));
}

/* -------------------------------------------- */
/*  Settings and Hooks                          */
/* -------------------------------------------- */

/**
 * Register the settings of cut-ins: each user's own speed and sound, and the sound the world has them make.
 * Called once, when the system starts.
 */
export function registerSettings() {
  game.settings.register(FEO.id, SPEED_SETTING, {
    name: "FEO.Setting.cutIns.name",
    hint: "FEO.Setting.cutIns.hint",
    scope: "client",
    config: true,
    type: String,
    choices: { off: "FEO.Setting.off", fast: "FEO.Setting.cutIns.fast", normal: "FEO.Setting.cutIns.normal" },
    default: FEO.cutIns.speed,
    onChange: (value) => {
      if ( !beatTime(value) ) {
        if ( timer !== null ) clearTimeout(timer);
        waiting = [];
        step();
      }
    }
  });
  game.settings.register(FEO.id, SOUND_SETTING, {
    name: "FEO.Setting.cutInSound.name",
    hint: "FEO.Setting.cutInSound.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(FEO.id, SOUND_FILE_SETTING, {
    name: "FEO.Setting.cutInSoundFile.name",
    hint: "FEO.Setting.cutInSoundFile.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "FEO.Setting.cutInSoundFile.none",
      ...Object.fromEntries(Object.keys(FEO.cutIns.sounds).map((key) => [key, `FEO.Setting.cutInSoundFile.${key}`]))
    },
    default: FEO.cutIns.sound
  });
}

/* -------------------------------------------- */

/**
 * Find a unit from what another client sent.
 * @param {*} uuid
 * @returns {Actor|null}
 */
function unitOf(uuid) {
  try {
    const found = ((typeof uuid === "string") && uuid) ? foundry.utils.fromUuidSync(uuid) : null;
    return ((found?.documentName === "Actor") && (found.type === "unit")) ? found : null;
  } catch(err) {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Register what cut-ins listen for. Called once, when the system starts.
 */
export function registerHooks() {
  Hooks.once("ready", () => {
    game.socket?.on(SOCKET, (message) => {
      if ( (message?.type !== "unit.cutIn") || !Array.isArray(message.shown) ) return;
      showCutIns(message.shown.slice(0, MOST_SENT)
        .map((entry) => ({ actor: unitOf(entry?.actor), skill: String(entry?.skill ?? "").slice(0, 60) }))
        .filter((entry) => entry.actor && entry.skill));
    });
  });

  // A plate stays over its token as the map is moved, and goes with the map
  Hooks.on("canvasPan", () => {
    for ( const entry of plates ) place(entry);
  });
  Hooks.on("canvasTearDown", () => {
    if ( timer !== null ) clearTimeout(timer);
    waiting = [];
    step();
  });
}

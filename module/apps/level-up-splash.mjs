import { FEO } from "../config.mjs";
import { rowPlaces } from "../rules/level-up.mjs";

/**
 * The Level Up splash: as a unit levels up it takes the whole screen, with the map showing through. It has
 * three sections. The emblem, a ribbon of the unit's cloth, unrolls with "Level Up" and the level, which turns
 * over to the new one. The board comes in from the right with every stat as it stands, and the gains come in
 * one after the other: a stat that did not rise is passed over. Then the unit has the last word, in the talk
 * box of the Base, beside its portrait.
 *
 * Every die was rolled before the splash begins: it only shows what they came to, so that skipping it changes
 * nothing. The one who levelled the unit sends it on with a click or the space bar, the first of which only
 * skips ahead to the result; or it leaves by itself, where they have asked for that. Those who only watch are
 * shown the same, and it leaves by itself for them. A user who has asked for less motion is shown the result
 * at once.
 *
 * What it says is put together by `buildLevelUpSplash` in `helpers/level-up.mjs`, and how it looks and moves is
 * in `styles/battle-hud.css`. There is never more than one.
 *
 * @typedef LevelUpSplash
 * @property {string} army            The side whose cloth it wears
 * @property {string} name            The unit
 * @property {string} [className]     Its class
 * @property {string} [img]           Its portrait
 * @property {number} from            The level it had
 * @property {number} to              The level it reached
 * @property {{title: string, skip: string, auto: string, next: string, atCap: string}} text
 * @property {{key: string, label: string, value: number, gain: number, pass: 0|1|2, capped: boolean,
 *   tip?: string}[]} rows            Its stats (see `splashRows`), each with its name and what it rolled
 * @property {string} [skill]         The skill that had growth rates rolled again, where one did
 * @property {{label: string, value: string, tip?: string}[]} [chips]     What else the level brought
 * @property {string} [line]          What the unit says
 */

/** The id of the one splash on the page. */
const SPLASH_ID = "feo-level-up";

/** How long each part of the splash takes, in milliseconds. */
const TIMES = { emblem: 850, turn: 850, unit: 700, gain: 340, skill: 520, talk: 350, letter: 24, out: 700 };

/** The splash that is showing, and how to take it away. @type {{close: () => void}|null} */
let showing = null;

/* -------------------------------------------- */

/**
 * Make an element.
 * @param {string} tag
 * @param {string} [cls]
 * @param {string|number} [text]
 * @returns {HTMLElement}
 */
function el(tag, cls = "", text = undefined) {
  const made = document.createElement(tag);
  if ( cls ) made.className = cls;
  if ( text !== undefined ) made.textContent = String(text);
  return made;
}

/* -------------------------------------------- */

/**
 * Is a picture cut out, with nothing behind its figure? One whose top corners are clear is taken to be. It is
 * then stood on the screen as it is; any other picture is set in a frame.
 * @param {HTMLImageElement} img    A picture that has loaded
 * @returns {boolean}
 */
function isCutOut(img) {
  try {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(img, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data;
    const alpha = (x, y) => data[(((y * size) + x) * 4) + 3];
    return [alpha(0, 0), alpha(1, 1), alpha(size - 1, 0), alpha(size - 2, 1)].every((value) => value < 24);
  } catch(err) {
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Is a Level Up splash on the screen?
 * @returns {boolean}
 */
export function levelUpShowing() {
  return !!showing;
}

/* -------------------------------------------- */

/**
 * Take the splash away at once, if one is showing.
 */
export function clearLevelUp() {
  showing?.close();
}

/* -------------------------------------------- */

/**
 * Play a Level Up splash. One that is still showing makes way for it.
 * @param {LevelUpSplash} splash
 * @param {object} [options]
 * @param {boolean} [options.watch]     Is it another user's level up that is watched? It then leaves by itself,
 *                                      and a click sends it off
 * @param {boolean} [options.auto]      Does it leave by itself?
 * @param {(auto: boolean) => void} [options.onAuto]    Told when the user changes that
 * @returns {Promise<void>}             Over once the splash is gone
 */
export function playLevelUp(splash, { watch = false, auto = false, onAuto = null } = {}) {
  clearLevelUp();
  const still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const said = splash.text ?? {};
  let leaves = watch || auto;

  // What is waited for, and what skipping does away with
  let stage = "showing";      // showing, done, leaving, gone
  let fast = still;
  let waiting = [];
  let timer = null;
  const wait = (ms) => (fast || (stage === "gone")) ? Promise.resolve() : new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    waiting.push(() => {
      clearTimeout(id);
      resolve();
    });
  });
  const flush = () => {
    for ( const go of waiting.splice(0) ) go();
  };

  /* ---------- The page ---------- */

  const layer = el("div", "feo feo-hud feo-levelup");
  layer.id = SPLASH_ID;
  layer.dataset.army = splash.army || "other";
  layer.dataset.state = "start";
  layer.setAttribute("role", "status");
  if ( still ) layer.classList.add("lu-fast");
  layer.append(el("div", "lu-backdrop"));

  // Section 1: the emblem
  const emblem = el("section", "lu-emblem");
  const ribbon = el("div", "lu-ribbon");
  const flip = el("div", "lu-flip");
  const reel = el("div", "lu-reel");
  reel.append(el("span", "", splash.from), el("span", "", splash.to));
  flip.append(reel);
  ribbon.append(el("i", "lu-burst"), el("b", "lu-title", said.title), flip);
  const unroll = el("div", "lu-unroll");
  unroll.append(ribbon);
  emblem.append(el("i", "lu-rays"), unroll);
  for ( const at of ["a", "b", "c", "d"] ) emblem.append(el("i", `lu-spark lu-${at}`));

  // Section 2: the board
  const board = el("section", "lu-board");
  const head = el("div", "lu-head");
  head.append(el("b", "", splash.name));
  board.append(head);
  if ( splash.className ) board.append(el("div", "lu-class", splash.className));
  const list = el("ol", "lu-rows");
  const places = rowPlaces(splash.rows.length);
  const rows = splash.rows.map((row, index) => {
    const item = el("li", `lu-row${row.capped ? " lu-capped" : ""}`);
    item.style.gridColumn = String(places[index].column);
    item.style.gridRow = String(places[index].row);
    const stands = el("span", "lu-val", row.value);
    const gained = el("span", "lu-gain");
    item.append(el("b", "lu-abbr", row.label), el("span", "lu-note", row.capped ? said.atCap : ""), stands, gained);
    if ( row.tip ) item.dataset.tooltip = row.tip;
    list.append(item);
    return { ...row, item, stands, gained };
  });
  const foot = el("div", "lu-foot");
  board.append(list, foot);

  // Section 3: the voice
  const voice = el("section", "lu-voice");
  const bust = el("div", "lu-bust");
  if ( splash.img ) {
    const img = el("img");
    img.alt = "";
    img.addEventListener("load", () => {
      bust.classList.add(isCutOut(img) ? "lu-cut" : "lu-framed", "lu-ready");
    });
    img.addEventListener("error", () => layer.classList.add("lu-no-bust"));
    img.src = splash.img;
    bust.append(img);
  }
  else layer.classList.add("lu-no-bust");
  const talk = el("div", "lu-talk");
  const line = el("p");
  talk.append(el("span", "lu-who", splash.name), line, el("i", "lu-more"));
  talk.hidden = true;
  voice.append(bust, talk);

  // The way on, in the corner: for the one who levelled the unit
  const prompts = el("div", "lu-prompts");
  const autoButton = el("button", "lu-auto", said.auto);
  autoButton.type = "button";
  autoButton.setAttribute("aria-pressed", String(leaves));
  if ( !watch ) {
    const skipButton = el("button", "lu-skip");
    skipButton.type = "button";
    skipButton.append(el("kbd", "", "Space"), document.createTextNode(said.skip));
    prompts.append(skipButton, autoButton);
  }

  layer.append(emblem, board, voice, prompts);

  /* ---------- Coming and going ---------- */

  let over = () => {};
  const done = new Promise((resolve) => {
    over = resolve;
  });

  const close = () => {
    if ( stage === "gone" ) return;
    stage = "gone";
    clearTimeout(timer);
    flush();
    window.removeEventListener("keydown", onKey, true);
    layer.remove();
    if ( showing?.close === close ) showing = null;
    over();
  };

  const leave = () => {
    if ( (stage === "leaving") || (stage === "gone") ) return;
    stage = "leaving";
    clearTimeout(timer);
    fast = true;
    flush();
    layer.classList.toggle("lu-fast", still);
    layer.dataset.state = "out";
    timer = setTimeout(close, still ? 0 : TIMES.out);
  };

  const skip = () => {
    fast = true;
    layer.classList.add("lu-fast");
    flush();
  };

  const holdThenLeave = () => {
    clearTimeout(timer);
    if ( leaves && (stage === "done") ) timer = setTimeout(leave, FEO.levelUp.hold);
  };

  // A click, or the space bar: first to the result, then on. One who only watches sends it off at once
  const onward = () => {
    if ( watch ) leave();
    else if ( stage === "showing" ) skip();
    else if ( stage === "done" ) leave();
  };

  function onKey(event) {
    if ( watch || !["Space", "Enter", "NumpadEnter", "Escape"].includes(event.code) ) return;
    if ( event.target?.closest?.("input, textarea, select, button, [contenteditable]") ) return;
    event.preventDefault();
    event.stopPropagation();
    onward();
  }

  layer.addEventListener("click", (event) => {
    if ( event.target.closest(".lu-auto") ) {
      leaves = !leaves;
      autoButton.setAttribute("aria-pressed", String(leaves));
      onAuto?.(leaves);
      if ( leaves ) holdThenLeave();
      else if ( stage === "done" ) clearTimeout(timer);
      return;
    }
    onward();
  });

  /* ---------- The splash itself ---------- */

  const gainIn = (row) => {
    row.item.classList.add("lu-hit");
    if ( row.gain > 1 ) row.item.classList.add("lu-two");
    row.stands.textContent = String(row.value + row.gain);
    row.gained.replaceChildren(document.createTextNode(`+${row.gain}`), el("i", "lu-up"));
  };

  const chip = ({ label, value, tip }, cls = "") => {
    const made = el("span", `lu-chip${cls ? ` ${cls}` : ""}`);
    if ( label ) made.append(document.createTextNode(label));
    if ( value ) made.append(el("b", "", value));
    if ( tip ) made.dataset.tooltip = tip;
    return made;
  };

  const run = async () => {
    // The emblem unrolls with the old level, which turns over to the new; then the unit and its stats
    await wait(TIMES.emblem);
    layer.classList.add("lu-turned");
    await wait(TIMES.turn);
    layer.classList.add("lu-unit");
    await wait(TIMES.unit);

    // The gains come in one at a time; a stat that did not rise is passed over
    for ( const row of rows ) {
      if ( (row.pass !== 1) || (stage === "gone") ) continue;
      gainIn(row);
      await wait(TIMES.gain);
    }
    if ( splash.skill && (stage !== "gone") ) {
      foot.append(chip({ label: splash.skill }, "lu-skill"));
      await wait(TIMES.skill);
      for ( const row of rows ) {
        if ( (row.pass !== 2) || (stage === "gone") ) continue;
        gainIn(row);
        await wait(TIMES.gain);
      }
    }
    if ( stage === "gone" ) return;

    // What else the level brought, and the way on
    for ( const entry of splash.chips ?? [] ) foot.append(chip(entry));
    if ( !watch && !splash.line ) {
      const next = el("button", "lu-next", said.next);
      next.type = "button";
      foot.append(next);
    }
    if ( stage === "showing" ) stage = "done";

    // The unit has the last word
    if ( splash.line ) {
      await wait(TIMES.talk);
      if ( stage === "gone" ) return;
      talk.hidden = false;
      void layer.offsetWidth;
      layer.classList.add("lu-spoken");
      await wait(260);
      for ( const letter of splash.line ) {
        if ( stage === "gone" ) return;
        line.textContent += letter;
        await wait(TIMES.letter);
      }
    }
    holdThenLeave();
  };

  document.body.append(layer);
  showing = { close };
  window.addEventListener("keydown", onKey, true);
  void layer.offsetWidth;
  layer.dataset.state = "in";
  run().catch((err) => {
    console.error(err);
    close();
  });
  return done;
}

/**
 * The splash: a band of a side's cloth that unrolls across the screen as its Phase begins, holds for a moment
 * and runs off the other edge. It is drawn over everything and takes no clicks, so that nobody has to wait for
 * it; and there is never more than one, so that Phases which follow each other quickly do not pile up.
 *
 * What it says is worked out by `buildSplash` in `battle-hud-context.mjs`, and how it looks and moves by
 * `styles/battle-hud.css`. A user who has asked for less motion is shown the band standing still, more briefly.
 */

/** The id of the one splash on the page. */
const SPLASH_ID = "feo-phase-splash";

/** How long the splash stays, in milliseconds: while it moves, and when it stands still. */
const SPLASH_TIME = { moving: 1900, still: 1200 };

/** The timer that takes the splash away again. @type {number|null} */
let leaving = null;

/* -------------------------------------------- */

/**
 * Take the splash away, if one is showing.
 */
export function clearSplash() {
  if ( leaving !== null ) clearTimeout(leaving);
  leaving = null;
  document.getElementById(SPLASH_ID)?.remove();
}

/* -------------------------------------------- */

/**
 * Play a splash across the screen. One that is still showing makes way for it.
 * @param {object} splash
 * @param {string|null} [splash.army]     The side whose cloth it wears; none for a splash that belongs to no side
 * @param {string} [splash.eyebrow]       The small line above the title
 * @param {string} splash.title           What is announced
 * @returns {HTMLElement}                 The splash, which removes itself
 */
export function playSplash({ army = null, eyebrow = "", title = "" }) {
  clearSplash();
  const still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // The layer wears the classes of the Battle HUD, whose colours and cloth it shares
  const layer = document.createElement("div");
  layer.id = SPLASH_ID;
  layer.className = "feo feo-hud feo-splash";
  layer.setAttribute("role", "status");
  layer.style.setProperty("--feo-splash-time", `${SPLASH_TIME.moving}ms`);

  const band = document.createElement("div");
  band.className = "splash";
  if ( army ) band.dataset.army = army;
  const cloth = document.createElement("div");
  cloth.className = "sp-cloth cloth";
  band.append(cloth);
  for ( let line = 0; line < 2; line++ ) {
    const rule = document.createElement("i");
    rule.className = "sp-rule";
    band.append(rule);
  }

  const text = document.createElement("div");
  text.className = "sp-text";
  if ( eyebrow ) {
    const small = document.createElement("small");
    small.textContent = eyebrow;
    text.append(small);
  }
  const name = document.createElement("b");
  name.textContent = title;
  text.append(name);
  band.append(text);
  layer.append(band);

  document.body.append(layer);
  leaving = setTimeout(clearSplash, still ? SPLASH_TIME.still : SPLASH_TIME.moving);
  return layer;
}

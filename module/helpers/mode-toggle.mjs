/**
 * The switch a sheet carries in its window header, between its title and its header buttons: on to edit, off
 * to play a unit or to read an item. The sheet answers its `toggleMode` action.
 */

/**
 * Put the switch in the frame of a sheet's window.
 * @param {HTMLElement} frame     The frame, as `_renderFrame` returns it
 * @returns {HTMLButtonElement}
 */
export function addModeToggle(frame) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "header-control mode-toggle";
  toggle.dataset.action = "toggleMode";
  toggle.setAttribute("role", "switch");
  const label = document.createElement("span");
  label.className = "mode-label";
  label.textContent = game.i18n.localize("FEO.Mode.label");
  const track = document.createElement("span");
  track.className = "track";
  track.setAttribute("aria-hidden", "true");
  toggle.append(label, track);
  frame.querySelector(".window-title")?.insertAdjacentElement("afterend", toggle);
  return toggle;
}

/* -------------------------------------------- */

/**
 * Show on the switch which way it stands.
 * @param {HTMLElement} element   The sheet's window
 * @param {boolean} edit          Is the sheet being edited?
 * @param {string} tooltip        What the switch does from here, as a localization key
 */
export function setModeToggle(element, edit, tooltip) {
  const toggle = element.querySelector(".mode-toggle");
  if ( !toggle ) return;
  toggle.setAttribute("aria-checked", String(edit));
  toggle.dataset.tooltip = game.i18n.localize(tooltip);
}

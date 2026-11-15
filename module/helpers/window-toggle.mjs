/**
 * The button a sheet carries in its window header, beside the one that closes it: it folds the window down to
 * its header, and opens it out again. The sheet answers its `toggleMinimize` action.
 */

/**
 * Put the button in the frame of a sheet's window.
 * @param {HTMLElement} frame     The frame, as `_renderFrame` returns it
 * @returns {HTMLButtonElement}
 */
export function addWindowToggle(frame) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon fa-solid window-toggle";
  button.dataset.action = "toggleMinimize";
  frame.querySelector('.window-header [data-action="close"]')?.insertAdjacentElement("beforebegin", button);
  setWindowToggle(frame, false);
  return button;
}

/* -------------------------------------------- */

/**
 * Show on the button which way it goes from here.
 * @param {HTMLElement} [element]   The sheet's window
 * @param {boolean} minimized       Is the window folded down to its header?
 */
export function setWindowToggle(element, minimized) {
  const button = element?.querySelector(".window-toggle");
  if ( !button ) return;
  const label = game.i18n.localize(minimized ? "FEO.Window.maximize" : "FEO.Window.minimize");
  button.classList.toggle("fa-window-minimize", !minimized);
  button.classList.toggle("fa-window-maximize", minimized);
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
}

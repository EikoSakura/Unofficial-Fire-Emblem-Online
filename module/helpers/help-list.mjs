import { helpSteps } from "../rules/creation.mjs";
import { recordOf } from "./creation.mjs";
import { iconHtml } from "./icons.mjs";

/**
 * Who waits for help, told in the Actors list of the sidebar: a unit on which help has been asked for in the
 * Creator carries a raised hand beside its name, so that nobody has to open sheets one by one to find it.
 * What is asked for is kept by the Creator as `system.creation.help` (see `askHelp` in `helpers/creation.mjs`);
 * nothing is kept here.
 */

/** The class of the mark beside a unit's name. */
const MARK = "feo-help-mark";

/* -------------------------------------------- */

/**
 * The steps of a unit's creation on which help is waited for.
 * @param {Actor} actor
 * @returns {string[]}
 */
export function helpAsked(actor) {
  return actor?.type === "unit" ? helpSteps(recordOf(actor)) : [];
}

/* -------------------------------------------- */

/**
 * Give the row of an Actor its mark, or take it away, as the unit stands now.
 * @param {HTMLElement} row     The Actor's entry in the list
 * @param {Actor} [actor]
 */
function markRow(row, actor) {
  const steps = helpAsked(actor);
  let mark = row.querySelector(`:scope > .${MARK}`);
  if ( !steps.length ) {
    mark?.remove();
    return;
  }
  if ( !mark ) {
    mark = document.createElement("a");
    mark.className = MARK;

    // A click on the hand opens the sheet, as one on the name does
    mark.dataset.action = "activateEntry";
    mark.innerHTML = iconHtml("hand");
    const name = row.querySelector(":scope > .entry-name");
    if ( name ) name.before(mark);
    else row.append(mark);
  }
  const titles = steps.map((step) => game.i18n.localize(`FEO.Creator.step.${step}.title`));
  const tip = game.i18n.format("FEO.Creator.help.listed", { steps: titles.join(", ") });
  mark.dataset.tooltip = tip;
  mark.setAttribute("aria-label", tip);
}

/* -------------------------------------------- */

/**
 * Mark every unit of an Actors list that waits for help.
 * @param {ActorDirectory} list     The list in the sidebar, or the one popped out of it
 */
function markList(list) {
  const root = list?.element;
  if ( !root ) return;
  for ( const row of root.querySelectorAll(".directory-item.entry[data-entry-id]") ) {
    markRow(row, list.collection.get(row.dataset.entryId));
  }
}

/* -------------------------------------------- */

/**
 * Register what the marks listen for. Called once, when the system starts.
 */
export function registerHooks() {

  // The list draws its rows anew whenever an Actor is made, renamed, moved or deleted
  Hooks.on("renderActorDirectory", (list) => markList(list));

  // Asking for help changes nothing the list draws itself again for, so the row is marked where it stands
  Hooks.on("updateActor", (actor, changed) => {
    if ( !Object.keys(changed.system ?? {}).some((key) => key.endsWith("creation")) ) return;
    for ( const list of [ui.actors, ui.actors?.popout] ) {

      // A token's own copy of a unit and one in a compendium go by the same id as the Actor listed
      if ( list?.collection.get(actor.id) !== actor ) continue;
      const row = list.element?.querySelector(`.directory-item.entry[data-entry-id="${actor.id}"]`);
      if ( row ) markRow(row, actor);
    }
  });
}

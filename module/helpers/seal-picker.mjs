import Compendium from "../apps/compendium.mjs";
import { FEO } from "../config.mjs";
import { iconHtml } from "./icons.mjs";
import { addSealClassTo, openSealTree, removeSealClassFrom, sealClassesOf } from "./reclass.mjs";

/**
 * The menu of a unit's Heart Seal Classes on its sheet. The sheet names the class in use on one closed line;
 * opened, it lists the others the unit has, and that is all it does: a class there is read, not pressed. While
 * the sheet is being edited it goes on to every other class a unit can start in, grouped by people, with a field
 * to search them: a class is ticked or unticked where it stands, and the menu stays open so that several can be
 * chosen in one go.
 *
 * @import {SealClass} from "../rules/optional.mjs"
 */

const ANCHOR = '[data-action="sealClasses"]';
const OPEN = "seal-open";
const fold = (text) => String(text ?? "").trim().toLowerCase();

/** The fewest classes worth a field to search them. */
const SEARCH_FROM = 7;

/* -------------------------------------------- */
/*  What the menu lists                         */
/* -------------------------------------------- */

/**
 * @typedef SealChoice
 * @property {string} id        What tells the class from every other
 * @property {string} name
 * @property {string} uuid      The address of the class, where it has one
 * @property {string} img
 * @property {string} note      What it wields, and its folder where another class has its name
 * @property {string} search    The words it is found by
 * @property {boolean} known    Is it a class the compendiums hold?
 */

/**
 * The classes a unit can start in, grouped by people in the order the peoples are listed, each group in the
 * order of the alphabet.
 * @param {object[]} classes                  Classes, as the Compendium reads them
 * @param {object} [options]
 * @param {(key: string) => string} [options.label]   Puts a label into words
 * @returns {{label: string, rows: SealChoice[]}[]}
 */
export function sealChoices(classes, { label = (key) => key } = {}) {
  const base = FEO.classTiers.base.order;
  const starting = (classes ?? []).filter((cls) => cls.order <= base);
  const named = new Map();
  for ( const cls of starting ) named.set(fold(cls.name), (named.get(fold(cls.name)) ?? 0) + 1);

  const groups = [];
  for ( const [race, { label: raceLabel }] of Object.entries(FEO.races) ) {
    const rows = starting.filter((cls) => cls.race === race)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cls) => {
        const wields = (cls.proficiencies?.options ?? []).map((key) => label(FEO.proficiencies[key] ?? key));
        const folder = (named.get(fold(cls.name)) > 1) ? (cls.folder?.name ?? "") : "";
        return {
          id: cls.uuid || cls.id || cls.name,
          name: cls.name,
          uuid: cls.uuid ?? "",
          img: cls.img ?? "",
          note: [folder, wields.join(", ")].filter(Boolean).join(" · "),
          search: fold([cls.name, folder, ...wields].join(" ")),
          known: true
        };
      });
    if ( rows.length ) groups.push({ label: label(raceLabel), rows });
  }
  return groups;
}

/* -------------------------------------------- */

/**
 * What the menu lists for a unit: the classes on its list that it is not in, as the list has them, and then,
 * where classes can be added, every other class by people. The class its own line starts in is named on the
 * closed line, so it is not listed. A class on the list that the compendiums do not hold is listed by its name
 * alone.
 * @param {{label: string, rows: SealChoice[]}[]} groups    As `sealChoices` gives them
 * @param {SealClass[]} held                                The unit's list
 * @param {object} [options]
 * @param {boolean} [options.edit]      Can classes be added?
 * @param {string} [options.label]      What the unit's own classes are headed
 * @returns {{label: string, rows: SealChoice[]}[]}
 */
export function sealMenu(groups, held, { edit = false, label = "" } = {}) {
  const active = new Set((held ?? []).filter((entry) => entry.starting).map((entry) => fold(entry.name)));
  groups = groups.map((group) => ({ ...group, rows: group.rows.filter((choice) => !active.has(fold(choice.name))) }));
  const all = groups.flatMap((group) => group.rows);
  const mine = (held ?? []).filter((entry) => !entry.starting).map((entry) => {
    return (entry.uuid ? all.find((choice) => choice.uuid === entry.uuid) : null)
      ?? all.find((choice) => fold(choice.name) === fold(entry.name))
      ?? { id: `name:${fold(entry.name)}`, name: entry.name, uuid: entry.uuid ?? "", img: "", note: "", search: fold(entry.name), known: false };
  });
  const sections = mine.length ? [{ label, rows: mine }] : [];
  if ( !edit ) return sections;
  const taken = new Set(mine.map((choice) => choice.id));
  for ( const group of groups ) {
    const rows = group.rows.filter((choice) => !taken.has(choice.id));
    if ( rows.length ) sections.push({ label: group.label, rows });
  }
  return sections;
}

/* -------------------------------------------- */

/**
 * Where a menu goes: under what opened it when there is room, else over it, and always inside the screen.
 * @param {{left: number, top: number, bottom: number}} anchor    The box of what opened it
 * @param {{width: number, height: number}} size                  The size the menu would like
 * @param {{width: number, height: number}} screen
 * @param {object} [options]
 * @param {number} [options.gap]      The space between the two
 * @param {number} [options.edge]     The space kept from the edge of the screen
 * @param {number} [options.least]    The least height worth opening under
 * @returns {{left: number, top: number, bottom: number, height: number, below: boolean}}
 *   `top` is where it starts when it opens under, `bottom` how far its foot is from the foot of the screen
 *   when it opens over
 */
export function placeMenu(anchor, size, screen, { gap = 4, edge = 8, least = 220 } = {}) {
  const under = screen.height - anchor.bottom - gap - edge;
  const over = anchor.top - gap - edge;
  const below = (under >= Math.min(size.height, least)) || (under >= over);
  return {
    left: Math.max(edge, Math.min(anchor.left, screen.width - size.width - edge)),
    top: anchor.bottom + gap,
    bottom: screen.height - anchor.top + gap,
    height: Math.max(120, Math.min(size.height, below ? under : over)),
    below
  };
}

/* -------------------------------------------- */
/*  The menu                                    */
/* -------------------------------------------- */

/** The menu that is open, if one is. */
let current = null;

/** Is one being opened? Reading the compendiums the first time takes a moment. */
let opening = false;

/**
 * Close the menu.
 * @param {object} [options]
 * @param {boolean} [options.focus]     Hand the keyboard back to what opened it?
 */
export function closeSealPicker({ focus = false } = {}) {
  current?.close(focus);
}

/* -------------------------------------------- */

/**
 * Open the menu for a unit under the line that shows its list, or close it when it is already open there.
 * @param {Actor} actor
 * @param {HTMLElement} anchor          The line
 * @param {object} [options]
 * @param {boolean} [options.edit]      Can classes be put on the list and taken off it?
 * @returns {Promise<HTMLElement|null>}   The menu, or null when it was closed
 */
export async function toggleSealPicker(actor, anchor, { edit = false } = {}) {
  if ( opening ) return null;
  if ( current ) {
    const same = current.actor === actor;
    current.close(false);
    if ( same ) return null;
  }
  if ( !FEO.optional.heartSeals.enabled ) return null;
  const host = anchor.closest(".application") ?? document.body;
  const i18n = game.i18n;
  const loc = (key) => i18n.localize(key);

  opening = true;
  let sections;
  try {
    const library = await Compendium.library();
    const groups = sealChoices(library.classes, { label: loc });
    sections = sealMenu(groups, sealClassesOf(actor), { edit, label: loc("FEO.HeartSeal.picker.held") });
  } finally {
    opening = false;
  }
  if ( !anchor.isConnected ) anchor = host.querySelector(ANCHOR);
  if ( !anchor ) return null;

  const make = (tag, cls, text) => {
    const element = document.createElement(tag);
    if ( cls ) element.className = cls;
    if ( text !== undefined ) element.textContent = text;
    return element;
  };
  const menu = make("div", edit ? "seal-picker editing" : "seal-picker");
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", loc("FEO.HeartSeal.title"));
  menu.tabIndex = -1;

  // The classes: the unit's own, and under them those it could add. They are pressed only while the sheet is
  // edited, to tick them; otherwise they are a list to read
  const list = make("div", "sp-list");
  if ( edit ) {
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-multiselectable", "true");
  }
  const rows = [];
  for ( const group of sections ) {
    const section = make("div", "sp-group");
    section.setAttribute("role", edit ? "group" : "list");
    section.setAttribute("aria-label", group.label);
    if ( sections.length > 1 ) {
      const head = make("h4", "", group.label);
      head.append(make("small", "", String(group.rows.length)));
      section.append(head);
    }
    for ( const choice of group.rows ) {
      const row = make(edit ? "button" : "div", "sp-row");
      if ( edit ) row.type = "button";
      row.setAttribute("role", edit ? "option" : "listitem");
      const face = choice.img ? make("img") : make("i");
      if ( choice.img ) Object.assign(face, { src: choice.img, alt: "", loading: "lazy" });
      else face.innerHTML = iconHtml("shield");
      const words = make("span", "sp-words");
      words.append(make("b", "", choice.name), make("small", "", choice.note));
      row.append(face, words);
      if ( edit ) {
        const mark = make("span", "sp-tick");
        mark.innerHTML = iconHtml("check");
        row.append(mark);
      }
      section.append(row);
      rows.push({ choice, row });
    }
    list.append(section);
  }
  const none = make("p", "sp-none", loc(rows.length ? "FEO.HeartSeal.picker.none" : (edit ? "FEO.HeartSeal.picker.empty" : "FEO.HeartSeal.picker.others")));
  list.classList.toggle("plain", sections.length < 2);
  none.hidden = rows.length > 0;
  list.append(none);

  // A field to search them, once there are enough to want one
  let field = null;
  if ( rows.length >= SEARCH_FROM ) {
    const find = make("label", "sp-find");
    find.innerHTML = iconHtml("search");
    field = make("input");
    const hint = loc(edit ? "FEO.HeartSeal.picker.searchAdd" : "FEO.HeartSeal.picker.search");
    Object.assign(field, { type: "text", placeholder: hint, autocomplete: "off", spellcheck: false });
    field.setAttribute("aria-label", hint);
    find.append(field);
    menu.append(find);
  }
  menu.append(list);
  if ( edit ) {
    const tree = make("button", "sp-tree");
    tree.type = "button";
    tree.innerHTML = iconHtml("shield");
    tree.append(make("span", "", loc("FEO.HeartSeal.picker.tree")));
    menu.append(tree);
  }

  // What is ticked follows the unit's list
  const refresh = () => {
    if ( !edit ) return;
    const held = new Set(sealClassesOf(actor).map((entry) => fold(entry.name)));
    for ( const { choice, row } of rows ) row.setAttribute("aria-selected", held.has(fold(choice.name)) ? "true" : "false");
  };

  const filter = () => {
    const words = fold(field.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for ( const { choice, row } of rows ) {
      row.hidden = !words.every((word) => choice.search.includes(word));
      if ( !row.hidden ) shown++;
    }
    for ( const section of list.querySelectorAll(".sp-group") ) section.hidden = !section.querySelector(".sp-row:not([hidden])");
    none.hidden = shown > 0;
    list.scrollTop = 0;
  };

  let busy = false;
  const toggle = async (entry) => {
    if ( busy || !entry ) return;
    busy = true;
    try {
      const { choice, row } = entry;
      if ( row.getAttribute("aria-selected") === "true" ) await removeSealClassFrom(actor, choice.name);
      else await addSealClassTo(actor, { name: choice.name, uuid: choice.uuid });
    } finally {
      busy = false;
      refresh();
    }
  };

  // Closing: a press anywhere else, Escape, the wheel turned over something else or the window changing size
  const outside = (event) => {
    if ( menu.contains(event.target) || event.target.closest?.(ANCHOR) ) return;
    close(false);
  };
  const wheeled = (event) => {
    if ( !menu.contains(event.target) ) close(false);
  };
  const resized = () => close(false);
  const close = (focus) => {
    if ( current?.menu !== menu ) return;
    current = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("wheel", wheeled, true);
    window.removeEventListener("resize", resized);
    menu.remove();
    host.classList.remove(OPEN);
    if ( focus ) host.querySelector(ANCHOR)?.focus();
  };

  // A class is ticked while the sheet is edited. The class tree opens only from its own button there
  menu.addEventListener("click", (event) => {
    if ( !edit ) return;
    if ( event.target.closest(".sp-tree") ) {
      close(false);
      openSealTree(actor);
      return;
    }
    toggle(rows.find(({ row }) => row === event.target.closest(".sp-row")));
  });
  field?.addEventListener("input", filter);

  // The keyboard stays in the menu while it is open, and none of it reaches the map. While the sheet is edited
  // the arrows walk the classes and Enter in the field ticks the first one found
  menu.addEventListener("keyup", (event) => event.stopPropagation());
  menu.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if ( event.key === "Escape" ) {
      event.preventDefault();
      close(true);
      return;
    }
    if ( (event.key === "Enter") && field && (event.target === field) ) {
      event.preventDefault();
      const first = rows.find(({ row }) => !row.hidden);
      if ( edit && fold(field.value) ) first?.row.click();
      return;
    }
    if ( !edit || !["ArrowDown", "ArrowUp"].includes(event.key) ) return;
    event.preventDefault();
    const stops = [field, ...rows.filter(({ row }) => !row.hidden).map(({ row }) => row)].filter(Boolean);
    const at = stops.indexOf(document.activeElement);
    const next = stops[Math.max(0, Math.min(stops.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
    next?.scrollIntoView?.({ block: "nearest" });
  });

  // It lies over everything, where the sheet's own edges cannot cut it off, as wide as the line it opens from,
  // and stays where it opened
  refresh();
  host.append(menu);
  if ( typeof menu.showPopover === "function" ) {
    menu.setAttribute("popover", "manual");
    menu.showPopover();
  }
  const box = anchor.getBoundingClientRect();
  menu.style.width = `${Math.max(280, Math.round(box.width))}px`;
  const spot = placeMenu(box, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
  Object.assign(menu.style, { left: `${spot.left}px`, maxHeight: `${spot.height}px` }, spot.below ? { top: `${spot.top}px` } : { bottom: `${spot.bottom}px` });

  current = { actor, menu, close };
  host.classList.add(OPEN);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("wheel", wheeled, { capture: true, passive: true });
  window.addEventListener("resize", resized);
  (field ?? (edit ? rows[0]?.row : null) ?? menu).focus({ preventScroll: true });
  return menu;
}

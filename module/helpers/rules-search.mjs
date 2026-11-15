import { FEO } from "../config.mjs";

/**
 * Searching the rules journal.
 *
 * Foundry's search box on a journal narrows the list of pages by their names. On the rules journal the same box
 * looks through the text of every page instead: while it holds a query, the contents in the sidebar give way to
 * a list of every passage that mentions it, page by page, and choosing one turns to that page and scrolls to
 * the passage. Other journals are left alone.
 *
 * The rules journal is recognised by the key that the build script gives each of its pages, so a copy imported
 * into a world is searched the same way.
 */

/** The name of the highlight painted over matches in the open page. */
const HIGHLIGHT = "feo-rules-search";

/** The shortest query that is searched for. */
const MIN_QUERY = 2;

/** The most passages listed for one query, and the most matches painted in the open pages. */
const MAX_HITS = 250;
const MAX_RANGES = 4000;

/** The length, in characters, that a long passage is cut down to in the list. */
const EXCERPT = 150;

/** Parts of a page that are furniture and not rules text. */
const SKIP = ".feo-kicker, .feo-pager, .feo-source, .feo-callout-label";

/** Components that are listed whole, such as a table row or a condition card, and plain blocks of text. */
const GROUPS = ".feo-cond, .feo-formula, .feo-statline, .feo-meter, .feo-example-head, tr, dl > div";
const BLOCKS = "p, li, dt, dd, h2, h3, h4, figcaption, summary";

/** Tags that run within a line of text, and the components whose children are set side by side all the same. */
const INLINE = new Set(["A", "B", "EM", "I", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "U", "VAR"]);
const STRIPS = ".feo-statline, .feo-cond-head, .feo-meter, .feo-glance > div, .feo-example-head, .feo-formula, "
  + ".feo-cycle-ring, .feo-path > div, figcaption";

const INPUT = ".journal-sidebar search input";

/**
 * @typedef RulesPassage
 * @property {Element} element    The element that holds the passage
 * @property {string} text        Its text as read
 * @property {string} folded      Its text as matched against
 * @property {string} section     The heading it stands under
 * @property {boolean} heading    Whether it is itself a heading
 */

/**
 * @typedef RulesSearchState
 * @property {HTMLElement|null} element   The window the listeners are on
 * @property {string} query               What the search box holds
 * @property {RulesSearchTerm[]} terms    The words searched for
 * @property {string} searched            The query they were read from
 * @property {HTMLElement} panel          The list of results
 * @property {number} scrollTop           How far the list is scrolled
 * @property {Range[]} ranges             The matches painted in the open pages
 * @property {Function} run               Searches again, a moment after the last keystroke
 */

/** @type {WeakMap<object, RulesSearchState>} */
const states = new WeakMap();

/** @type {WeakMap<JournalEntry, object[]>} */
const indexes = new WeakMap();

/* -------------------------------------------- */
/*  Text                                        */
/* -------------------------------------------- */

/**
 * Lower-case a text and drop its accents and typographic quotes, keeping every character in its place so that
 * a position in the result is the same position in the original.
 * @param {string} text
 * @returns {string}
 */
function fold(text) {
  const folded = text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/−/g, "-");
  return folded.length === text.length ? folded : text.toLowerCase();
}

/**
 * @typedef RulesSearchTerm
 * @property {string} full    The word as typed
 * @property {string} find    What is looked for: the word without its plural ending, so that "wounds" also finds
 *                            "Wound" and "injuries" also finds "Injury"
 */

/**
 * The words of a query. A passage matches when it holds all of them.
 * @param {string} query
 * @returns {RulesSearchTerm[]}
 */
function termsOf(query) {
  const folded = fold(query.trim());
  if ( folded.length < MIN_QUERY ) return [];
  const terms = new Map();
  for ( const full of folded.split(/\s+/) ) {
    let find = full;
    if ( /[a-z]{2}ies$/.test(full) ) find = full.slice(0, -3);
    else if ( /[a-z]sses$/.test(full) ) find = full.slice(0, -2);
    else if ( /[a-z]{2}[^s]s$/.test(full) ) find = full.slice(0, -1);
    if ( !terms.has(find) ) terms.set(find, { full, find });
  }
  return [...terms.values()];
}

/**
 * Whether a text holds every term.
 * @param {string} folded
 * @param {RulesSearchTerm[]} terms
 * @returns {boolean}
 */
function holds(folded, terms) {
  return terms.every((term) => folded.includes(term.find));
}

/**
 * Every place a term is found in a text, each as the positions of its start and end. A word found by a term
 * that lost its plural ending is taken to its own end: "Wounds", "Wounded", "Injury".
 * @param {string} folded
 * @param {RulesSearchTerm} term
 * @param {number} [from]
 * @returns {number[][]}
 */
function matchesOf(folded, term, from=0) {
  const matches = [];
  for ( let at = folded.indexOf(term.find, from); at >= 0; ) {
    let end = at + term.find.length;
    if ( term.find !== term.full ) {
      if ( folded.startsWith(term.full, at) ) end = at + term.full.length;
      else {
        let extra = 0;
        while ( (extra < 3) && /[a-z]/.test(folded[end + extra] ?? "") ) extra++;
        if ( !/[a-z]/.test(folded[end + extra] ?? "") ) end += extra;
      }
    }
    matches.push([at, end]);
    at = folded.indexOf(term.find, end);
  }
  return matches;
}

/**
 * The element whose text is listed as one passage for a piece of text inside it.
 * @param {Element} parent    The element the text is in
 * @param {Element} root      The page content
 * @returns {Element}
 */
function passageOf(parent, root) {
  for ( const selector of [GROUPS, BLOCKS] ) {
    const found = parent.closest(selector);
    if ( found && (found !== root) && root.contains(found) ) return found;
  }
  let element = parent;
  while ( INLINE.has(element.tagName) && (element !== root) && element.parentElement ) element = element.parentElement;
  return element;
}

/**
 * The part of a passage that a piece of text belongs to: a table cell, a term or its definition, a chip.
 * Text from two different parts is read with a dot between.
 * @param {Element} parent     The element the text is in
 * @param {Element} passage    The passage it belongs to
 * @returns {Element}
 */
function cellOf(parent, passage) {
  let element = parent;
  while ( (element !== passage) && element.parentElement ) {
    if ( !INLINE.has(element.tagName) || element.parentElement.matches(STRIPS) ) return element;
    element = element.parentElement;
  }
  return passage;
}

/**
 * Read page content as a list of passages, in the order they appear. The same reading of a page's saved text
 * and of the page as displayed gives the same list, which is how a result finds its place on the page.
 * @param {Element} root
 * @returns {RulesPassage[]}
 */
function passagesOf(root) {
  /** @type {Map<Element, {element: Element, text: string, cell: Element|null}>} */
  const found = new Map();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
    if ( !node.data.trim() ) continue;
    const parent = node.parentElement;
    if ( !parent || parent.closest(SKIP) ) continue;
    const element = passageOf(parent, root);
    let passage = found.get(element);
    if ( !passage ) found.set(element, passage = { element, text: "", cell: null });
    const cell = cellOf(parent, element);
    const piece = node.data.replace(/\s+/g, " ");
    if ( passage.text && (cell !== passage.cell) ) passage.text = `${passage.text.trimEnd()} · ${piece.trimStart()}`;
    else passage.text += piece;
    passage.cell = cell;
  }

  let section = "";
  const passages = [];
  for ( const { element, text: raw } of found.values() ) {
    // A link in saved text is still written out as @UUID[id]{label}; only its label is read
    const text = raw.replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").trim();
    const heading = /^H[2-4]$/.test(element.tagName);
    if ( heading && (element.tagName !== "H4") ) section = text;
    passages.push({ element, text, folded: fold(text), section: heading ? "" : section, heading });
  }
  return passages;
}

/* -------------------------------------------- */
/*  Index                                       */
/* -------------------------------------------- */

/**
 * The pages of a journal that the user may read, in the order of the sidebar.
 * @param {object} app    The journal's sheet
 * @returns {{id: string, name: string, number: number}[]}
 */
function pagesOf(app) {
  const listed = Object.values(app._pages ?? {});
  if ( listed.length ) return listed.map(({ id, name, number }) => ({ id, name, number: (number ?? 0) + 1 }));
  return app.document.pages.contents
    .filter((page) => page.testUserPermission(game.user, "OBSERVER"))
    .sort((a, b) => a.sort - b.sort)
    .map((page, index) => ({ id: page.id, name: page.name, number: index + 1 }));
}

/**
 * Every passage of the journal, page by page. Read once and kept until a page changes.
 * @param {object} app    The journal's sheet
 * @returns {object[]}
 */
function indexOf(app) {
  const entry = app.document;
  let index = indexes.get(entry);
  if ( index ) return index;
  const parser = new DOMParser();
  index = pagesOf(app).map(({ id, name, number }) => {
    const page = entry.pages.get(id);
    let passages = [];
    if ( (page?.type === "text") && page.text.content ) {
      const body = parser.parseFromString(page.text.content, "text/html").body;
      passages = passagesOf(body.querySelector(".feo-rules") ?? body);
    }
    return { id, name, number, folded: fold(name), passages };
  });
  indexes.set(entry, index);
  return index;
}

/**
 * Find the passages that hold every term, and the pages named for them.
 * @param {object[]} index
 * @param {RulesSearchTerm[]} terms
 * @returns {{groups: object[], count: number, capped: boolean}}
 */
function search(index, terms) {
  const groups = [];
  let count = 0;
  let capped = false;
  for ( const page of index ) {
    const hits = [];
    for ( const [number, passage] of page.passages.entries() ) {
      if ( !holds(passage.folded, terms) ) continue;
      if ( count >= MAX_HITS ) {
        capped = true;
        break;
      }
      hits.push(number);
      count++;
    }
    if ( hits.length || (!capped && holds(page.folded, terms)) ) groups.push({ page, hits });
    if ( capped ) break;
  }
  return { groups, count, capped };
}

/* -------------------------------------------- */
/*  The list of results                         */
/* -------------------------------------------- */

/**
 * Make an element.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function make(tag, className, text) {
  const element = document.createElement(tag);
  if ( className ) element.className = className;
  if ( text !== undefined ) element.textContent = text;
  return element;
}

/**
 * The part of a passage shown in the list: all of a short one, or the stretch around the first match of a long
 * one, with the matches marked.
 * @param {RulesPassage} passage
 * @param {RulesSearchTerm[]} terms
 * @returns {HTMLElement}
 */
function excerptOf(passage, terms) {
  const { text, folded } = passage;
  const found = terms.map((term) => folded.indexOf(term.find)).filter((at) => at >= 0);
  const first = found.length ? Math.min(...found) : 0;
  let start = 0;
  let end = text.length;
  if ( text.length > EXCERPT ) {
    start = Math.max(0, first - 40);
    if ( start > 0 ) {
      const space = text.indexOf(" ", start);
      if ( (space >= 0) && (space < first) ) start = space + 1;
    }
    end = Math.min(text.length, start + EXCERPT);
    if ( end < text.length ) {
      const space = text.lastIndexOf(" ", end);
      if ( space > start + 80 ) end = space;
    }
  }

  // Where the terms fall within the excerpt, joined where they overlap
  const marks = terms.flatMap((term) => matchesOf(folded, term, start))
    .filter(([from]) => from < end)
    .map(([from, to]) => [from, Math.min(to, end)])
    .sort((a, b) => a[0] - b[0]);

  const element = make("span", "text");
  let at = start;
  if ( start > 0 ) element.append("…");
  for ( const [from, to] of marks ) {
    if ( to <= at ) continue;
    const begin = Math.max(from, at);
    if ( begin > at ) element.append(text.slice(at, begin));
    element.append(make("mark", "", text.slice(begin, to)));
    at = to;
  }
  if ( at < end ) element.append(text.slice(at, end));
  if ( end < text.length ) element.append("…");
  return element;
}

/**
 * Fill the list of results.
 * @param {RulesSearchState} state
 * @param {{groups: object[], count: number, capped: boolean}} results
 */
function fill(state, { groups, count, capped }) {
  const { panel, terms } = state;
  const counted = (key, number) => game.i18n.format(`FEO.RulesSearch.${key}${number === 1 ? "" : "s"}`, { count: number });
  if ( !groups.length ) {
    const none = game.i18n.format("FEO.RulesSearch.none", { query: state.query.trim() });
    panel.replaceChildren(make("p", "feo-search-none", none));
    return;
  }

  const summary = game.i18n.format("FEO.RulesSearch.summary", {
    passages: counted("passage", count),
    pages: counted("page", groups.length)
  });
  const list = make("ol");
  for ( const { page, hits } of groups ) {
    const item = make("li");
    const title = make("a", "feo-search-page");
    title.tabIndex = 0;
    title.dataset.pageId = page.id;
    title.append(make("span", "num", String(page.number)), make("span", "name", page.name));
    if ( hits.length ) title.append(make("span", "count", String(hits.length)));
    item.append(title);

    if ( hits.length ) {
      const passages = make("ol", "feo-search-hits");
      let section = null;
      for ( const number of hits ) {
        const passage = page.passages[number];
        const hit = make("a", `feo-search-hit${passage.heading ? " heading" : ""}`);
        hit.tabIndex = 0;
        hit.dataset.pageId = page.id;
        hit.dataset.passage = String(number);
        if ( passage.section && (passage.section !== section) ) hit.append(make("span", "where", passage.section));
        section = passage.section;
        hit.append(excerptOf(passage, terms));
        const row = make("li");
        row.append(hit);
        passages.append(row);
      }
      item.append(passages);
    }
    list.append(item);
  }

  panel.replaceChildren(make("p", "feo-search-summary", summary), list);
  if ( capped ) {
    panel.append(make("p", "feo-search-more", game.i18n.format("FEO.RulesSearch.capped", { count: MAX_HITS })));
  }
}

/* -------------------------------------------- */
/*  The open page                               */
/* -------------------------------------------- */

/**
 * Paint every match in the pages that are open, without changing them.
 * @param {object} app    The journal's sheet
 * @param {RulesSearchState} state
 */
function paint(app, state) {
  if ( !globalThis.Highlight || !globalThis.CSS?.highlights ) return;
  let highlight = CSS.highlights.get(HIGHLIGHT);
  if ( !highlight ) CSS.highlights.set(HIGHLIGHT, highlight = new Highlight());
  for ( const range of state.ranges ) highlight.delete(range);
  state.ranges = [];
  if ( !state.terms.length || !app.element ) return;

  for ( const root of app.element.querySelectorAll(".journal-entry-page .feo-rules") ) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
      if ( !node.data.trim() || node.parentElement?.closest(SKIP) ) continue;
      const folded = fold(node.data);
      for ( const term of state.terms ) {
        for ( const [from, to] of matchesOf(folded, term) ) {
          if ( state.ranges.length >= MAX_RANGES ) return;
          const range = new Range();
          range.setStart(node, from);
          range.setEnd(node, to);
          highlight.add(range);
          state.ranges.push(range);
        }
      }
    }
  }
}

/**
 * Turn to the page of a result and scroll to its passage.
 * @param {object} app                  The journal's sheet
 * @param {RulesSearchState} state
 * @param {HTMLElement} link            The result that was chosen
 * @returns {Promise<void>}
 */
async function open(app, state, link) {
  const { pageId, passage } = link.dataset;
  state.panel.querySelector(".active")?.classList.remove("active");
  link.classList.add("active");

  // Turning the page draws the sidebar anew; the list goes back in where it was
  state.scrollTop = state.panel.scrollTop;
  await app.goToPage(pageId);
  const article = app.element?.querySelector(`.journal-entry-page[data-page-id="${pageId}"]`);
  if ( !article ) return;
  if ( passage === undefined ) return article.scrollIntoView();

  // Read the displayed page the way the index was read, so that the same passage is at the same place in the
  // list. Should the two ever differ, the first passage that matches is the next best place to land
  const matches = (candidate) => !!candidate && holds(candidate.folded, state.terms);
  const passages = passagesOf(article.querySelector(".feo-rules") ?? article);
  const target = matches(passages[Number(passage)]) ? passages[Number(passage)] : passages.find(matches);
  if ( !target ) return article.scrollIntoView();

  const { element } = target;
  for ( let closed = element.closest("details:not([open])"); closed; closed = closed.closest("details:not([open])") ) {
    closed.open = true;
  }
  element.scrollIntoView({ block: "center" });
  element.classList.remove("feo-search-flash");
  void element.offsetWidth;
  element.classList.add("feo-search-flash");
  element.addEventListener("animationend", () => element.classList.remove("feo-search-flash"), { once: true });
}

/* -------------------------------------------- */
/*  The search box                              */
/* -------------------------------------------- */

/**
 * Search for what the box holds and show what was found, or the contents again when it holds nothing.
 * @param {object} app    The journal's sheet
 * @param {RulesSearchState} state
 */
function refresh(app, state) {
  if ( !app.element ) return;
  state.searched = state.query;
  state.terms = termsOf(state.query);
  const searching = state.terms.length > 0;
  if ( searching ) fill(state, search(indexOf(app), state.terms));
  else state.panel.replaceChildren();
  state.panel.hidden = !searching;
  state.panel.scrollTop = state.scrollTop = 0;
  app.element.querySelector(".journal-sidebar")?.classList.toggle("feo-searching", searching);
  paint(app, state);
}

/**
 * The search of one journal window, made the first time the window is drawn and begun afresh each time it is
 * opened again.
 * @param {object} app             The journal's sheet
 * @param {HTMLElement} element    Its window
 * @returns {RulesSearchState}
 */
function stateOf(app, element) {
  let state = states.get(app);
  if ( !state ) {
    const panel = make("nav", "feo-search");
    panel.hidden = true;
    panel.ariaLabel = game.i18n.localize("FEO.RulesSearch.results");
    state = { element: null, query: "", terms: [], searched: "", panel, scrollTop: 0, ranges: [], run: () => {} };
    state.run = foundry.utils.debounce(() => refresh(app, state), 150);
    panel.addEventListener("scroll", () => state.scrollTop = panel.scrollTop, { passive: true });
    panel.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[data-page-id]");
      if ( link ) open(app, state, link).catch((err) => console.error(err));
    });
    panel.addEventListener("keydown", (event) => {
      if ( (event.key !== "Enter") && (event.key !== " ") ) return;
      const link = event.target.closest?.("a[data-page-id]");
      if ( !link ) return;
      event.preventDefault();
      open(app, state, link).catch((err) => console.error(err));
    });
    states.set(app, state);
  }
  if ( state.element === element ) return state;

  // A window that has just been opened starts with an empty search box
  state.element = element;
  state.query = state.searched = "";
  state.terms = [];
  state.panel.replaceChildren();
  state.panel.hidden = true;

  // The box is heard before Foundry's own filter, which would otherwise narrow the pages by name: it hides the
  // pages it leaves out, and a result may be on any page
  element.addEventListener("input", (event) => {
    if ( !event.target.matches?.(INPUT) ) return;
    event.stopPropagation();
    state.query = event.target.value;
    state.run();
  }, { capture: true });

  // Enter turns to the first result; the down arrow steps into the list
  element.addEventListener("keydown", (event) => {
    if ( !event.target.matches?.(INPUT) || !["Enter", "ArrowDown"].includes(event.key) ) return;
    event.preventDefault();
    event.stopPropagation();
    state.query = event.target.value;
    if ( state.query !== state.searched ) refresh(app, state);
    const first = state.panel.querySelector(".feo-search-hit") ?? state.panel.querySelector(".feo-search-page");
    if ( !first ) return;
    if ( event.key === "Enter" ) open(app, state, first).catch((err) => console.error(err));
    else first.focus();
  }, { capture: true });
  return state;
}

/**
 * Whether a journal is the rules journal or a copy of it.
 * @param {JournalEntry} entry
 * @returns {boolean}
 */
export function isRulesJournal(entry) {
  return !!entry?.pages?.some((page) => page.getFlag(FEO.id, "key"));
}

/**
 * Put the search back in place each time the journal draws itself: Foundry draws the sidebar anew on every
 * turn of the page, with an empty search box and the contents in full.
 * @param {object} app             The journal's sheet
 * @param {HTMLElement} element    Its window
 */
function onRender(app, element) {
  if ( !isRulesJournal(app.document) ) return;
  const sidebar = element.querySelector(".journal-sidebar");
  if ( !sidebar ) return;
  const state = stateOf(app, element);

  const input = sidebar.querySelector("search input");
  if ( input ) {
    if ( input.value !== state.query ) input.value = state.query;
    input.placeholder = input.ariaLabel = game.i18n.localize("FEO.RulesSearch.placeholder");
  }
  if ( state.panel.parentElement !== sidebar ) {
    const scrollTop = state.scrollTop;
    (sidebar.querySelector(".toc") ?? sidebar.querySelector("search"))?.after(state.panel);
    state.panel.scrollTop = state.scrollTop = scrollTop;
  }
  sidebar.classList.toggle("feo-searching", state.terms.length > 0);
  paint(app, state);
}

/**
 * Take the search's paint off the pages of a journal that is closing.
 * @param {object} app    The journal's sheet
 */
function onClose(app) {
  const state = states.get(app);
  if ( !state ) return;
  const highlight = globalThis.CSS?.highlights?.get(HIGHLIGHT);
  for ( const range of state.ranges ) highlight?.delete(range);
  state.ranges = [];
}

/**
 * Make the search box of the rules journal look through the text of every page.
 */
export function registerRulesSearch() {
  Hooks.on("renderJournalEntrySheet", onRender);
  Hooks.on("closeJournalEntrySheet", onClose);

  // A page that is written, rewritten or removed is read again by the next search
  for ( const event of ["create", "update", "delete"] ) {
    Hooks.on(`${event}JournalEntryPage`, (page) => indexes.delete(page.parent));
  }
}

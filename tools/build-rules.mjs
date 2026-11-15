#!/usr/bin/env node
/**
 * Builds the rules journal compendium (packs/rules) from the chapter files in packs-src/rules.
 *
 * Usage:
 *   node tools/build-rules.mjs [--foundry <path>] [--json <file>] [--check]
 *
 *   --foundry <path>   Foundry's "resources/app" folder, which provides the LevelDB library. Defaults to the
 *                      FOUNDRY_APP environment variable, then to the standard install location.
 *   --json <file>      Also write the journal as one JSON file, for inspection.
 *   --check            Validate the sources and stop without writing the compendium.
 *
 * Close the world before building: Foundry keeps the compendium open while a world is running.
 *
 * Source format. Each chapter is one file in packs-src/rules, read in file name order:
 *
 *   <!-- chapter: Battle | icon: sword -->
 *   <section data-page="combat" data-title="Combat" data-source="Rules 3.0, Intro and Basics">
 *     ...page content...
 *   </section>
 *
 * Inside a page:
 *   [[page-id]]            a link to another page, labelled with that page's title
 *   [[page-id|label]]      the same with a label of your choice
 *   <!-- include: tables/file.html -->   the contents of another file under packs-src/rules
 *
 * The chapter line, the pennant, the source line and the previous and next links are added to every page here.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "packs-src", "rules");
const PACK = join(ROOT, "packs", "rules");
const JOURNAL_NAME = "Fire Emblem Online Rules";

/** Tags that Foundry keeps when journal text is saved (a subset of CONST.ALLOWED_HTML_TAGS). */
const ALLOWED_TAGS = new Set([
  "a", "aside", "b", "br", "dd", "details", "div", "dl", "dt", "em", "figcaption", "figure", "h2", "h3", "h4", "i",
  "li", "nav", "ol", "p", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead",
  "tr", "ul", "var"
]);

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"];

/* -------------------------------------------- */
/*  Arguments                                   */
/* -------------------------------------------- */

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const checkOnly = args.includes("--check");
const jsonPath = option("--json");

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * A stable 16-character document id, so that links survive a rebuild.
 * @param {string} key
 * @returns {string}
 */
function stableId(key) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const digest = createHash("sha1").update(`fire-emblem-online.rules.${key}`).digest();
  let id = "";
  for ( let i = 0; i < 16; i++ ) id += alphabet[digest[i] % alphabet.length];
  return id;
}

const decode = (text) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const encode = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const problems = [];
const fail = (message) => problems.push(message);

/* -------------------------------------------- */
/*  Read the sources                            */
/* -------------------------------------------- */

/**
 * @typedef RulesPage
 * @property {string} key       The page's name in links, such as "combat-stats"
 * @property {string} id        Its document id
 * @property {string} title
 * @property {string} source    Where the text comes from
 * @property {string} body      The page content as written
 * @property {number} chapter   Index of its chapter
 */

/** @type {{name: string, icon: string, id: string}[]} */
const chapters = [];
/** @type {RulesPage[]} */
const pages = [];

const includeFile = (file, name) => {
  const path = join(SOURCE, name.trim());
  if ( !existsSync(path) ) {
    fail(`${file}: included file not found: ${name.trim()}`);
    return "";
  }
  return readFileSync(path, "utf8").trim();
};

for ( const file of readdirSync(SOURCE).filter((name) => name.endsWith(".html")).sort() ) {
  const text = readFileSync(join(SOURCE, file), "utf8").replace(/\r\n/g, "\n");
  const head = text.match(/<!--\s*chapter:\s*(.+?)\s*\|\s*icon:\s*([\w-]+)\s*-->/);
  if ( !head ) {
    fail(`${file}: missing the "<!-- chapter: Name | icon: name -->" line`);
    continue;
  }
  const chapter = chapters.length;
  chapters.push({ name: decode(head[1]), icon: head[2], id: stableId(`chapter.${file}`) });

  const pattern = /<section data-page="([^"]+)" data-title="([^"]+)"(?: data-source="([^"]*)")?>\n([\s\S]*?)\n<\/section>/g;
  let found = 0;
  for ( const [, key, title, source = "", body] of text.matchAll(pattern) ) {
    found++;
    if ( pages.some((page) => page.key === key) ) fail(`${file}: the page "${key}" is defined twice`);
    pages.push({
      key,
      id: stableId(`page.${key}`),
      title: decode(title),
      source: decode(source),
      body: body.replace(/<!--\s*include:\s*(.+?)\s*-->/g, (match, name) => includeFile(file, name)),
      chapter
    });
  }
  if ( !found ) fail(`${file}: no pages found`);
  if ( found !== (text.match(/<section /g) ?? []).length ) fail(`${file}: a <section> does not match the page format`);
}

if ( chapters.length > ROMAN.length ) fail("Too many chapters for the Roman numerals in this script.");

/* -------------------------------------------- */
/*  Turn each page into journal content         */
/* -------------------------------------------- */

const byKey = new Map(pages.map((page) => [page.key, page]));
const linkTo = (page, label) => `@UUID[.${page.id}]{${label ?? encode(page.title)}}`;

/**
 * @param {RulesPage} page
 * @param {number} index    Its position among all pages
 * @returns {string}
 */
function renderPage(page, index) {
  const chapter = chapters[page.chapter];

  // Links to other pages
  let body = page.body.replace(/\[\[([\w-]+)(?:\|([^\]]+))?\]\]/g, (match, key, label) => {
    const target = byKey.get(key);
    if ( !target ) {
      fail(`${page.key}: link to an unknown page "${key}"`);
      return label ?? key;
    }
    return linkTo(target, label);
  });

  // Checks
  for ( const [, tag] of body.matchAll(/<\/?([a-zA-Z][\w-]*)/g) ) {
    if ( !ALLOWED_TAGS.has(tag.toLowerCase()) ) fail(`${page.key}: the tag <${tag}> would be removed by Foundry`);
  }
  if ( /<!--/.test(body) ) fail(`${page.key}: comments are not kept in journal text`);
  if ( /\sstyle="[^"]*--/.test(body) ) fail(`${page.key}: set custom properties with a class, not a style attribute`);

  const previous = pages[index - 1];
  const next = pages[index + 1];
  const html = [
    '<div class="feo-rules">',
    `<p class="feo-kicker">${ROMAN[page.chapter]} · ${encode(chapter.name)} `,
    `<span class="pg">· page ${index + 1} of ${pages.length}</span>`,
    `<span class="feo-pennant"><i class="feo-ico ${chapter.icon}"></i></span></p>`,
    body,
    page.source ? `<p class="feo-source">Source: ${encode(page.source)}</p>` : "",
    '<nav class="feo-pager">',
    `<span class="prev">${previous ? linkTo(previous) : ""}</span>`,
    `<span class="next">${next ? linkTo(next) : ""}</span>`,
    "</nav></div>"
  ].join("");

  // Drop the line breaks and indentation between tags
  return html.replace(/>\s*\n\s*</g, "><").replace(/\s*\n\s*/g, " ").trim();
}

const manifest = JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8"));
const now = Date.now();
const stats = {
  compendiumSource: null,
  duplicateSource: null,
  exportSource: null,
  coreVersion: manifest.compatibility?.verified ?? "14",
  systemId: manifest.id,
  systemVersion: manifest.version,
  createdTime: now,
  modifiedTime: now,
  lastModifiedBy: null
};

const entryId = stableId("entry");

const categoryDocuments = chapters.map((chapter, index) => ({
  _id: chapter.id,
  name: chapter.name,
  sort: (index + 1) * 100000,
  flags: {},
  _stats: stats
}));

const pageDocuments = pages.map((page, index) => ({
  _id: page.id,
  name: page.title,
  type: "text",
  title: { show: true, level: 1 },
  image: {},
  text: { format: 1, content: renderPage(page, index), markdown: "" },
  video: { controls: true, volume: 0.5 },
  src: null,
  system: {},
  category: chapters[page.chapter].id,
  sort: (index + 1) * 100000,
  ownership: { default: -1 },
  flags: { [manifest.id]: { key: page.key } },
  _stats: stats
}));

const entryDocument = {
  _id: entryId,
  name: JOURNAL_NAME,
  pages: pageDocuments.map((page) => page._id),
  categories: categoryDocuments.map((category) => category._id),
  folder: null,
  sort: 0,
  ownership: { default: 0 },
  flags: {},
  _stats: stats
};

/* -------------------------------------------- */
/*  Report and write                            */
/* -------------------------------------------- */

if ( problems.length ) {
  console.error(`Found ${problems.length} problem(s):`);
  for ( const problem of problems ) console.error(`  - ${problem}`);
  process.exit(1);
}

const size = pageDocuments.reduce((total, page) => total + page.text.content.length, 0);
console.log(`${chapters.length} chapters, ${pages.length} pages, ${Math.round(size / 1024)} KB of page content.`);

if ( jsonPath ) {
  const json = { ...entryDocument, pages: pageDocuments, categories: categoryDocuments };
  writeFileSync(resolve(jsonPath), JSON.stringify(json, null, 1));
  console.log(`Wrote ${resolve(jsonPath)}`);
}

if ( checkOnly ) process.exit(0);

/**
 * Find the LevelDB library that ships with Foundry.
 * @returns {typeof import("classic-level").ClassicLevel}
 */
function loadLevel() {
  const candidates = [
    option("--foundry"),
    process.env.FOUNDRY_APP,
    "C:/Program Files/Foundry Virtual Tabletop/resources/app",
    "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app"
  ].filter(Boolean);
  const require = createRequire(import.meta.url);
  for ( const app of candidates ) {
    const library = join(app, "node_modules", "classic-level");
    if ( existsSync(library) ) return require(library).ClassicLevel;
  }
  console.error("Could not find Foundry's files. Pass --foundry <path to resources/app> or set FOUNDRY_APP.");
  process.exit(1);
}

const ClassicLevel = loadLevel();
try {
  rmSync(PACK, { recursive: true, force: true });
} catch ( error ) {
  console.error(`Could not replace ${PACK}. Is a world using this system still running?\n${error.message}`);
  process.exit(1);
}
mkdirSync(PACK, { recursive: true });

const database = new ClassicLevel(PACK, { keyEncoding: "utf8", valueEncoding: "json" });
await database.open();
const batch = database.batch();
batch.put(`!journal!${entryId}`, entryDocument);
for ( const category of categoryDocuments ) batch.put(`!journal.categories!${entryId}.${category._id}`, category);
for ( const page of pageDocuments ) batch.put(`!journal.pages!${entryId}.${page._id}`, page);
await batch.write();
await database.compactRange("\x00", "\xff");
await database.close();

console.log(`Built ${PACK}`);

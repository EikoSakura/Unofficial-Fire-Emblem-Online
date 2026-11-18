/**
 * What the compendium build scripts share: arguments, stable ids, validation against Foundry's own document
 * classes, writing a pack, and the report each build prints.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REFERENCES = join(ROOT, "References");
export const REFERENCE_SHEET = join(REFERENCES, "Fire Emblem Online Reference Sheet.xlsx");
export const CLASS_SHEET = join(REFERENCES, "Fire Emblem Online Class Sheet.xlsx");
export const OPTIONAL_SHEET = join(REFERENCES, "Fire Emblem Online Optional Content.xlsx");

export const manifest = JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8"));

/* -------------------------------------------- */
/*  Arguments                                   */
/* -------------------------------------------- */

const args = process.argv.slice(2);

/**
 * The value that follows an option on the command line.
 * @param {string} name
 * @returns {string|undefined}
 */
export function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Is a switch present on the command line?
 * @param {string} name
 * @returns {boolean}
 */
export function flag(name) {
  return args.includes(name);
}

export const USAGE = `
  --foundry <path>   Foundry's "resources/app" folder, which provides the LevelDB library, the document classes
                     used to validate, and the bundled icons. Defaults to the FOUNDRY_APP environment variable,
                     then to the standard install location.
  --json <file>      Also write the built documents as one JSON file, for inspection.
  --check            Build, validate and report, but do not write the compendium.
  --status [file]    Skills only: also print the scoreboard, every skill as done, part or text only, folder by
                     folder with totals (with --quiet, the totals alone), and write it to the file as JSON.
  --out <folder>     Write the compendium to this folder instead of packs/<name>.
  --quiet            Print only the totals and the problems.
  --all              List every example in the report instead of the first few.

Close the world before building: Foundry keeps a compendium open while a world that uses it is running.`;

/* -------------------------------------------- */
/*  Names and ids                               */
/* -------------------------------------------- */

/**
 * A stable 16-character document id, so that links and world copies survive a rebuild.
 * @param {string} pack     The compendium's name
 * @param {string} key      What identifies the document within it
 * @returns {string}
 */
export function stableId(pack, key) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const digest = createHash("sha1").update(`${manifest.id}.${pack}.${key}`).digest();
  let id = "";
  for ( let i = 0; i < 16; i++ ) id += alphabet[digest[i] % alphabet.length];
  return id;
}

/**
 * A name as a lower-case file name: letters and digits, with a dash wherever anything else was.
 * Accents are dropped, so "Gáe Bolg" is "gae-bolg".
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/æ/gi, "ae")
    .replace(/ø/gi, "o").replace(/þ/gi, "th").replace(/ð/gi, "d").replace(/['’]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * A cell's text on one line: line breaks and runs of spaces become one space.
 * @param {string} text
 * @returns {string}
 */
export function oneLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export const encode = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Plain text as HTML paragraphs, one for each line.
 * @param {string} text
 * @returns {string}
 */
export function paragraphs(text) {
  return String(text ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean)
    .map((line) => `<p>${encode(line)}</p>`).join("");
}

/* -------------------------------------------- */
/*  Reading cell values                         */
/* -------------------------------------------- */

/**
 * Read a whole number the way the sheets write them: "45", "45.0", "1,750" or "+2".
 * @param {string} text
 * @returns {number|null}     Null when the cell does not hold a whole number
 */
export function wholeNumber(text) {
  const cleaned = String(text ?? "").trim().replace(/^\+/, "").replace(/(\d),(?=\d{3}\b)/g, "$1");
  if ( !/^-?\d+(\.0+)?$/.test(cleaned) ) return null;
  return Number(cleaned);
}

/**
 * Read a number that may have a fraction, such as a wEXP of 0.5.
 * @param {string} text
 * @returns {number|null}
 */
export function decimalNumber(text) {
  const cleaned = String(text ?? "").trim().replace(/(\d),(?=\d{3}\b)/g, "$1");
  if ( !/^-?\d+(\.\d+)?$/.test(cleaned) ) return null;
  return Number(cleaned);
}

/** Does a cell say that it has no value? */
export const isBlank = (text) => /^(|-+|–|—|n\/?a|none)$/i.test(String(text ?? "").trim());

/* -------------------------------------------- */
/*  Foundry                                     */
/* -------------------------------------------- */

/**
 * Find Foundry's "resources/app" folder.
 * @returns {string}
 */
export function findFoundry() {
  const candidates = [
    option("--foundry"),
    process.env.FOUNDRY_APP,
    "C:/Program Files/Foundry Virtual Tabletop/resources/app",
    "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app"
  ].filter(Boolean);
  for ( const app of candidates ) {
    if ( existsSync(join(app, "node_modules", "classic-level")) && existsSync(join(app, "common")) ) return app;
  }
  console.error("Could not find Foundry's files. Pass --foundry <path to resources/app> or set FOUNDRY_APP.");
  process.exit(1);
}

/**
 * Load Foundry's own document classes and the system's data models, so that built documents can be checked
 * exactly as Foundry would check them.
 * @param {string} app      Foundry's "resources/app" folder
 * @returns {Promise<{FEO: object, models: object, BaseItem: Function, BaseFolder: Function}>}
 */
export async function loadFoundry(app) {
  const core = (path) => import(pathToFileURL(join(app, path)).href);
  await core("common/primitives/_module.mjs");
  globalThis.CONST = await core("common/constants.mjs");
  globalThis.foundry = {
    data: await core("common/data/_module.mjs"),
    abstract: await core("common/abstract/_module.mjs"),
    utils: await core("common/utils/_module.mjs")
  };
  globalThis.foundry.packages = await core("common/packages/_module.mjs");
  globalThis.foundry.documents = await core("common/documents/_module.mjs");

  const { FEO } = await import(pathToFileURL(join(ROOT, "module", "config.mjs")).href);
  const models = await import(pathToFileURL(join(ROOT, "module", "data", "_module.mjs")).href);
  const dataModels = {
    weapon: models.WeaponData,
    skill: models.SkillData,
    gear: models.GearData,
    class: models.ClassData,
    art: models.ArtData,
    battalion: models.BattalionData
  };
  const types = Object.fromEntries(Object.keys(dataModels).map((type) => [type, {}]));
  const version = String(manifest.compatibility?.verified ?? "14");
  globalThis.CONFIG = { Item: { dataModels } };
  globalThis.game = {
    release: { version, generation: Number.parseInt(version, 10) },
    version,
    system: { id: manifest.id, version: manifest.version, documentTypes: { Item: types } },
    model: {
      Item: types,
      Folder: Object.fromEntries(globalThis.CONST.FOLDER_DOCUMENT_TYPES.map((type) => [type, {}]))
    }
  };
  const { BaseItem, BaseFolder } = globalThis.foundry.documents;
  return { FEO, models, BaseItem, BaseFolder };
}

/* -------------------------------------------- */
/*  Documents                                   */
/* -------------------------------------------- */

const now = Date.now();

/** The `_stats` every built document carries. */
export const stats = {
  compendiumSource: null,
  duplicateSource: null,
  exportSource: null,
  coreVersion: String(manifest.compatibility?.verified ?? "14"),
  systemId: manifest.id,
  systemVersion: manifest.version,
  createdTime: now,
  modifiedTime: now,
  lastModifiedBy: null
};

/**
 * The link to a document of a compendium of this system.
 * @param {string} pack
 * @param {string} id
 * @returns {string}
 */
export function uuidOf(pack, id) {
  return `Compendium.${manifest.id}.${pack}.Item.${id}`;
}

/**
 * Build a compendium folder.
 * @param {string} pack
 * @param {object} data
 * @param {string} data.key             What identifies the folder, for its id
 * @param {string} data.name
 * @param {string|null} [data.parent]   The id of the folder it sits in
 * @param {string} [data.description]   HTML
 * @param {number} data.order           Its place among its siblings, from 1
 * @param {string} [data.color]
 * @returns {object}
 */
export function makeFolder(pack, { key, name, parent = null, description = "", order, color = null }) {
  return {
    _id: stableId(pack, `folder.${key}`),
    name,
    type: "Item",
    description,
    folder: parent,
    sorting: "m",
    sort: order * 100000,
    color,
    flags: {},
    _stats: stats
  };
}

/**
 * Compare what was built with what Foundry keeps of it.
 * @param {*} built
 * @param {*} kept
 * @param {string} path
 * @param {string[]} differences
 */
function compare(built, kept, path, differences) {
  if ( (built !== null) && (typeof built === "object") && !Array.isArray(built) ) {
    for ( const key of Object.keys(built) ) {
      if ( (kept === null) || (typeof kept !== "object") || !(key in kept) ) {
        differences.push(`${path}.${key} is not a field of the data model`);
        continue;
      }
      compare(built[key], kept[key], `${path}.${key}`, differences);
    }
    return;
  }
  if ( JSON.stringify(built) !== JSON.stringify(kept) ) {
    differences.push(`${path}: built ${JSON.stringify(built)}, Foundry keeps ${JSON.stringify(kept)}`);
  }
}

/**
 * Check every built document against Foundry's Item and Folder classes and the system's data models.
 * @param {{BaseItem: Function, BaseFolder: Function}} foundry
 * @param {object[]} documents
 * @param {object[]} folders
 * @param {(path: string) => boolean} imageExists     Does an image a document uses exist?
 * @returns {string[]}    What is wrong; empty when everything is valid
 */
export function validate(foundry, documents, folders, imageExists) {
  const problems = [];
  const folderIds = new Set();
  for ( const folder of folders ) {
    try {
      // Foundry tidies what it is given in place, so it is handed a copy
      new foundry.BaseFolder(structuredClone(folder), { strict: true });
    } catch ( error ) {
      problems.push(`Folder "${folder.name}": ${error.message}`);
    }
    if ( folderIds.has(folder._id) ) problems.push(`Folder "${folder.name}": its id is used twice`);
    folderIds.add(folder._id);
  }
  for ( const folder of folders ) {
    if ( folder.folder && !folderIds.has(folder.folder) ) problems.push(`Folder "${folder.name}": its parent is missing`);
  }

  const ids = new Map();
  for ( const document of documents ) {
    const where = `${document.type} "${document.name}"`;
    try {
      const item = new foundry.BaseItem(structuredClone(document), { strict: true });
      const kept = item.toObject();
      const differences = [];
      compare(document.system, kept.system, "system", differences);
      compare(document.flags, kept.flags, "flags", differences);
      for ( const key of ["name", "img", "type", "folder", "sort"] ) compare(document[key], kept[key], key, differences);
      for ( const difference of differences ) problems.push(`${where}: ${difference}`);
    } catch ( error ) {
      problems.push(`${where}: ${error.message.replace(/\s*\n\s*/g, " ")}`);
    }
    if ( ids.has(document._id) ) problems.push(`${where}: shares its id with "${ids.get(document._id)}"`);
    ids.set(document._id, document.name);
    if ( document.folder && !folderIds.has(document.folder) ) problems.push(`${where}: its folder is missing`);
    if ( !imageExists(document.img) ) problems.push(`${where}: its image ${document.img} does not exist`);
  }
  return problems;
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

/**
 * Write a compendium. The new compendium is built beside the old one and swapped in, so that a compendium
 * Foundry has open is left exactly as it was.
 * @param {string} app                  Foundry's "resources/app" folder
 * @param {string} name                 The compendium's name
 * @param {object[]} documents
 * @param {object[]} [folders]
 * @returns {Promise<string>}           The folder written
 */
export async function writePack(app, name, documents, folders = []) {
  const require = createRequire(import.meta.url);
  const { ClassicLevel } = require(join(app, "node_modules", "classic-level"));
  const target = option("--out") ? resolve(option("--out")) : join(ROOT, "packs", name);
  const staging = `${target}.building`;
  const retired = `${target}.replaced`;

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const database = new ClassicLevel(staging, { keyEncoding: "utf8", valueEncoding: "json" });
  await database.open();
  const batch = database.batch();
  for ( const folder of folders ) batch.put(`!folders!${folder._id}`, folder);
  for ( const document of documents ) batch.put(`!items!${document._id}`, document);
  await batch.write();
  await database.compactRange("\x00", "\xff");
  await database.close();

  try {
    rmSync(retired, { recursive: true, force: true });
    if ( existsSync(target) ) renameSync(target, retired);
  } catch ( error ) {
    rmSync(staging, { recursive: true, force: true });
    console.error(`\nCould not replace ${target}.\nIs a world that uses this system still running? Return to `
      + `setup or close Foundry, then run this again. Nothing was changed.\n(${error.message})`);
    process.exit(1);
  }
  renameSync(staging, target);
  rmSync(retired, { recursive: true, force: true });
  return target;
}

/**
 * Write the built documents as one JSON file when asked to.
 * @param {object[]} documents
 * @param {object[]} [folders]
 * @param {object} [options]
 * @param {boolean} [options.documentsOnly]   Write the documents as a plain list, without the folders
 */
export function writeJson(documents, folders = [], { documentsOnly = false } = {}) {
  const path = option("--json");
  if ( !path ) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), JSON.stringify(documentsOnly ? documents : { folders, documents }, null, 1));
  console.log(`Wrote ${resolve(path)}`);
}

/* -------------------------------------------- */
/*  Report                                      */
/* -------------------------------------------- */

/**
 * Collects what a build has to say and prints it at the end.
 */
export class Report {

  /**
   * @param {string} title
   */
  constructor(title) {
    this.title = title;
    this.sections = new Map();
  }

  /**
   * Add a line to a section.
   * @param {string} section
   * @param {string} line
   */
  add(section, line) {
    if ( !this.sections.has(section) ) this.sections.set(section, { lines: [], counts: new Map() });
    this.sections.get(section).lines.push(line);
  }

  /**
   * Count something in a section, optionally noting an example.
   * @param {string} section
   * @param {string} key
   * @param {string} [example]
   */
  count(section, key, example) {
    if ( !this.sections.has(section) ) this.sections.set(section, { lines: [], counts: new Map() });
    const counts = this.sections.get(section).counts;
    const entry = counts.get(key) ?? { total: 0, examples: [] };
    entry.total++;
    if ( example ) entry.examples.push(example);
    counts.set(key, entry);
  }

  /**
   * Print the report.
   * @param {object} [options]
   * @param {number} [options.examples]     How many examples to list beside a count
   */
  print({ examples = 6 } = {}) {
    const quiet = flag("--quiet");
    if ( flag("--all") ) examples = Infinity;
    console.log(`\n${this.title}\n${"=".repeat(this.title.length)}`);
    const first = [...this.sections].filter(([name]) => name === "Totals");
    const rest = [...this.sections].filter(([name]) => name !== "Totals");
    for ( const [name, { lines, counts }] of [...first, ...rest] ) {
      if ( quiet && !/^(Totals|Problems)/.test(name) ) continue;
      console.log(`\n${name}`);
      for ( const [key, { total, examples: list }] of counts ) {
        const shown = list.slice(0, examples).join("; ");
        const more = list.length > examples ? `; and ${list.length - examples} more` : "";
        console.log(`  ${String(total).padStart(5)}  ${key}${shown ? `  (${shown}${more})` : ""}`);
      }
      for ( const line of lines ) console.log(`  ${line}`);
    }
    console.log("");
  }
}

#!/usr/bin/env node
/**
 * Builds the Combat Arts compendium (packs/arts) from the "Combat Arts" tab of the Optional Content Sheet.
 *
 * Usage:
 *   node tools/build-arts.mjs [--foundry <path>] [--json <file>] [--check] [--out <folder>] [--quiet]
 *
 * The tab is read as it is laid out: a row with only its first cell filled is a heading when it is short and a
 * note when it is long. Headings become folders and set the type of the Arts beneath them, and every other row
 * is an Art. Each Art keeps its Effect and its Cost exactly as the sheet words them, which is what the system
 * reads its numbers from (see module/rules/arts.mjs).
 *
 * What the tab's notes say is carried over as follows:
 *   "*" after the name of a Sword, Lance or Rifle Art is taken off the name, and the Art can also be performed
 *   with the weapon type the note names for it;
 *   where an Art is performed from, by its type, is a rule of the system and not kept on each Art;
 *   a stat an Art lowers after combat eases by 1 at the end of each of the target's turns, which the effects of
 *   those Arts say.
 *
 * A row without a name is another way to perform the Art above it, and becomes an Art of its own, named as
 * SECOND_FORMS says.
 *
 * What the system applies of an Art beyond what it reads from the Effect is not read from the text. It is
 * written out by hand in packs-src/arts/effects.json, by the Art's name, in the notation that
 * module/rules/skills.mjs explains, and laid over the Arts here together with what each of them then still
 * leaves to the table. A name in that file that no Art has, or an effect the rules do not know, stops the build.
 *
 * An Art's image comes from assets/icons/arts when a file there is named after it (see the README in
 * assets/icons), and otherwise from the icons that ship with Foundry.
 */

import {
  OPTIONAL_SHEET, ROOT, Report, USAGE, findFoundry, flag, loadFoundry, makeFolder, manifest, oneLine, paragraphs,
  slugify, stableId, stats, validate, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";
import { readWorkbook } from "./lib/xlsx.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readArtItem, readCost } from "../module/rules/arts.mjs";
import { checkEffects } from "../module/rules/skills.mjs";

if ( flag("--help") ) {
  console.log(`Builds packs/arts from the "Combat Arts" tab of the Optional Content Sheet.\n${USAGE}`);
  process.exit(0);
}

const PACK = "arts";
const ARTS_TAB = "Combat Arts";
const COLUMNS = { name: 0, effect: 1, cost: 5, rank: 6 };
const TITLES = { name: "Name", effect: "Effect", cost: "Cost", rank: "Rank" };

/** The headings of the tab and the type of the Arts listed under each. A heading that is not here is reported. */
const SECTIONS = {
  "Universal Arts": "universal",
  "Shared Arts": "universal",
  "Sword Arts": "sword",
  "Knife Arts": "knife",
  "Axe Arts": "axe",
  "Lance Arts": "lance",
  "Pole Arts": "pole",
  "Bow Arts": "bow",
  "Brawl Arts": "brawl",
  "Rifle Arts": "rifle"
};

/** The weapon type that can also perform an Art marked "*", by the Art's own type, as the tab's first note says. */
const ALSO = { sword: "knife", lance: "pole", rifle: "pistol" };

/** What a row without a name is called: the Art above it, performed another way. */
const SECOND_FORMS = { Subdue: "Ranged" };

const app = findFoundry();
const foundry = await loadFoundry(app);
const { FEO } = foundry;
const config = FEO.optional.combatArts;
const report = new Report("Combat Arts compendium");
const problems = [];

if ( !existsSync(OPTIONAL_SHEET) ) {
  console.error(`The Optional Content Sheet is not in References. Save it there as "${OPTIONAL_SHEET.split(/[\\/]/).pop()}".`);
  process.exit(1);
}
const sheet = readWorkbook(OPTIONAL_SHEET).find((candidate) => candidate.name === ARTS_TAB);
if ( !sheet ) throw new Error(`The Optional Content Sheet has no "${ARTS_TAB}" tab.`);
for ( const [key, column] of Object.entries(COLUMNS) ) {
  if ( oneLine(sheet.cell(1, column)) !== TITLES[key] ) {
    problems.push(`Row 1: column ${column + 1} should be "${TITLES[key]}" but is "${oneLine(sheet.cell(1, column))}"`);
  }
}

/** The effects the system applies by itself, by the Art's name. */
const EFFECTS_FILE = join(ROOT, "packs-src", "arts", "effects.json");
const automation = existsSync(EFFECTS_FILE) ? (JSON.parse(readFileSync(EFFECTS_FILE, "utf8")).arts ?? {}) : {};
const automated = new Set();

/* -------------------------------------------- */
/*  Read the Arts                               */
/* -------------------------------------------- */

const sections = [];
const arts = [];
let section = null;
let last = null;
for ( let row = 2; row <= sheet.lastRow; row++ ) {
  const cells = sheet.filled(row);
  if ( !cells.length ) continue;
  const first = oneLine(sheet.cell(row, COLUMNS.name));

  // A heading, or a note
  if ( (cells.length === 1) && (cells[0].column === COLUMNS.name) ) {
    if ( first in SECTIONS ) {
      section = { key: first, name: first, type: SECTIONS[first], count: 0 };
      sections.push(section);
      report.count("Rows that are not Arts", "section headings, made into folders");
    } else if ( (first.length > 40) || first.endsWith(".") ) {
      report.count("Rows that are not Arts", "notes above the first heading, which the system follows as rules", `row ${row}`);
      if ( section ) problems.push(`Row ${row}: a note beneath a heading, which this script does not expect`);
    } else {
      problems.push(`Row ${row}: "${first}" is not a heading this script knows. Add it to SECTIONS.`);
    }
    continue;
  }
  if ( !section ) {
    problems.push(`Row ${row}: "${first}" comes before any section heading`);
    continue;
  }
  if ( cells.some(({ column }) => !Object.values(COLUMNS).includes(column)) ) {
    problems.push(`Row ${row} ${first}: has cells outside the Name, Effect, Cost and Rank columns`);
  }

  // Another way to perform the Art above
  let name = first;
  let marked = false;
  let cost = oneLine(sheet.cell(row, COLUMNS.cost));
  let rank = oneLine(sheet.cell(row, COLUMNS.rank));
  if ( !name ) {
    const form = last ? SECOND_FORMS[last.name] : null;
    if ( !form ) {
      problems.push(`Row ${row}: has no name, and the Art above it has no second form in SECOND_FORMS`);
      continue;
    }
    name = `${last.name} (${form})`;
    cost ||= last.costText;
    rank ||= last.rankText;
    report.count("Values read with care", "a row without a name, made into a second form of the Art above it", name);
  }
  else {
    const match = /^(.*?)\s*(\*?)$/.exec(name);
    name = match[1];
    marked = !!match[2];
  }

  // The Rank an Art is learned at; one that every unit simply has is learned at none
  let learned = "";
  if ( config.ranks.includes(rank) ) learned = rank;
  else if ( /^innate\b/i.test(rank) ) report.count("Values read with care", `Rank "${rank}", kept as an Art that counts for no Rank`, name);
  else problems.push(`Row ${row} ${name}: "${rank}" is not a Rank an Art can have`);

  let also = "";
  if ( marked ) {
    also = ALSO[section.type] ?? "";
    if ( also ) report.count("Name markers", `"*" on a ${section.name.replace(/ Arts$/, "")} Art: also performed with a ${also}`);
    else problems.push(`Row ${row} ${name}: is marked "*", which the notes explain for no ${section.name}`);
  }

  const effect = sheet.cell(row, COLUMNS.effect);
  const price = readCost(cost);
  if ( !price.hp && !price.uses && !/^n\/?a$/i.test(cost) ) problems.push(`Row ${row} ${name}: the Cost "${cost}" could not be read`);

  const system = {
    type: section.type,
    also,
    rank: learned,
    effect,
    cost: /^n\/?a$/i.test(cost) ? "" : cost,
    automate: true,
    effects: [],
    left: "",
    readied: false,
    description: ""
  };

  // What the system applies beyond what it reads from the Effect, from the hand-written list
  const entry = automation[name];
  if ( entry ) {
    automated.add(name);
    const wrong = checkEffects(entry.effects);
    if ( wrong.length ) problems.push(...wrong.map((problem) => `Row ${row} ${name}: effects.json, ${problem}`));
    else if ( !entry.effects?.length ) problems.push(`Row ${row} ${name}: effects.json lists it without effects`);
    else {
      system.effects = entry.effects;
      system.left = entry.left ?? "";
    }
  }

  // How much of the Art the system applies
  const read = readArtItem(system);
  const numbers = ["might", "hit", "critical", "dodge", "critAvoid"].some((key) => read[key]);
  const applies = numbers || (read.strikes > 1) || read.effective.length || read.range || read.noFollowUp || read.foeNoCounter
    || read.persist || read.spare || read.effects.length;
  if ( !read.left ) report.count("Automation", "Arts the system applies in full");
  else if ( applies ) report.count("Automation", "Arts the system applies in part, the rest listed in the fight for the table", `${name}: ${read.left}`);
  else report.count("Automation", "Arts left to the table entirely, apart from their cost", `${name}: ${read.left}`);
  if ( system.effects.length ) report.count("Automation", "Arts with effects of their own from effects.json");

  section.count++;
  last = { row, name, section, system, costText: cost, rankText: rank, marked };
  arts.push(last);
}

/* -------------------------------------------- */
/*  Images                                      */
/* -------------------------------------------- */

const library = new IconLibrary(app);
const picker = new IconPicker(library, PACK);
const from = (folder, pattern, except) => picker.from(folder, pattern, except);

/** The pool for each type of Art. */
const POOLS = {
  universal: from("skills/melee", /^(strike|weapons-crossed|maneuver)/),
  sword: from("skills/melee", /sword|blade/),
  lance: from("skills/melee", /spear|polearm/),
  axe: from("skills/melee", /axe/),
  knife: from("skills/melee", /dagger|knife/),
  brawl: from("skills/melee", /unarmed|hand-grip|punch/),
  pole: from("skills/melee", /polearm|staff|spear/),
  bow: from("skills/ranged", /arrow|bow/),
  rifle: from("skills/ranged", /gun|rifle|bullet|cannon|target/)
};

/* -------------------------------------------- */
/*  Build the documents                         */
/* -------------------------------------------- */

const folders = [];
const folderIds = new Map();
sections.forEach((entry, index) => {
  const folder = makeFolder(PACK, { key: entry.key, name: entry.name, description: "", order: index + 1 });
  folderIds.set(entry.key, folder._id);
  folders.push(folder);
});

const seen = new Map();
for ( const art of arts ) seen.set(art.name.toLowerCase(), (seen.get(art.name.toLowerCase()) ?? 0) + 1);
const documents = arts.map((art, index) => {
  const { name, section: place, system } = art;
  const shared = seen.get(name.toLowerCase()) > 1;
  if ( shared ) problems.push(`Row ${art.row} ${name}: another Art has the same name`);
  const img = picker.pick({
    name,
    slugs: [slugify(name)],
    group: place.name,
    pool: POOLS[system.type] ?? [],
    fallback: "icons/svg/sword.svg",
    materials: false
  });
  const flags = { row: art.row, source: `Optional Content Sheet, ${ARTS_TAB} tab, row ${art.row}` };
  if ( art.marked ) flags.markers = "*";
  return {
    _id: stableId(PACK, name),
    name,
    type: "art",
    img,
    system,
    effects: [],
    folder: folderIds.get(place.key),
    sort: (index + 1) * 100000,
    ownership: { default: 0 },
    flags: { [manifest.id]: flags },
    _stats: stats
  };
});

/* -------------------------------------------- */
/*  Check, report and write                     */
/* -------------------------------------------- */

problems.push(...validate(foundry, documents, folders, (path) => library.exists(path)));
for ( const name of Object.keys(automation) ) {
  if ( !automated.has(name) ) problems.push(`effects.json lists "${name}", which is not the name of any Art`);
}

report.add("Totals", `${documents.length} Combat Arts in ${folders.length} folders, from ${sheet.lastRow} rows of the ${ARTS_TAB} tab.`);
for ( const entry of sections ) {
  report.add("Arts in each folder", `${String(entry.count).padStart(5)}  ${entry.name} (type: ${entry.type})`);
}
report.count("Rows that are not Arts", "the header row");
const withCost = (key) => documents.filter((document) => readCost(document.system.cost)[key] > 0).length;
report.add("Costs", `${withCost("hp")} Arts cost HP, ${withCost("uses")} cost Weapon Uses, `
  + `${documents.filter((document) => !document.system.cost).length} cost nothing.`);
report.add("Automation", `Effect text kept word for word on ${documents.filter((document) => document.system.effect).length} Arts.`);
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every Art and folder passed Foundry's own validation.");
report.print();

writeJson(documents, folders);
if ( problems.length ) {
  console.error("Nothing was written because of the problems above.");
  process.exit(1);
}
if ( !flag("--check") ) {
  if ( !flag("--out") ) picker.writeNames();
  console.log(`Built ${await writePack(app, PACK, documents, folders)}`);
}

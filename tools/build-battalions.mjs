#!/usr/bin/env node
/**
 * Builds the Battalions compendium (packs/battalions) from the "Battalions" and "Gambits" tabs of the Optional
 * Content Sheet.
 *
 * Usage:
 *   node tools/build-battalions.mjs [--foundry <path>] [--json <file>] [--check] [--out <folder>] [--quiet]
 *
 * A Battalion brings one Gambit, which the Battalions tab names and the Gambits tab describes. The two are
 * joined by that name into one item: the Battalion with its Gambit built in, as the system keeps them. A
 * Battalion that names a Gambit the Gambits tab does not have stops the build.
 *
 * The tabs are read as they are laid out:
 *   a row with only its first cell filled is a heading;
 *   a bonus is a number, or what it starts at and what it gains: "5, 1.3 per level up";
 *   "N/A" for a Special Quality or an Effect means there is none;
 *   "-" for a Gambit's Mt means it has none, and a Gambit without a Hit is a Support Gambit: it rolls nothing,
 *   and the system announces it with its Effect for the table to apply.
 *
 * A Gambit's Effect is kept exactly as the sheet words it, which is what the system reads from (see
 * module/rules/battalions.mjs). Its Target Area is a picture in the sheet. The picture itself is not read:
 * its file name says which shape it is, and AREAS says each shape in words.
 *
 * Every Battalion is built as it is when it is bought: level 1, at full HP, with every use of its Gambit, and
 * assigned to nobody. They are sorted into a folder for each Authority rank.
 *
 * A Battalion's image comes from assets/icons/battalions when a file there is named after it (see the README
 * in assets/icons), and otherwise from the icons that ship with Foundry.
 */

import {
  OPTIONAL_SHEET, ROOT, Report, USAGE, decimalNumber, findFoundry, flag, isBlank, loadFoundry, makeFolder, manifest,
  oneLine, slugify, stableId, stats, validate, wholeNumber, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";
import { readWorkbook } from "./lib/xlsx.mjs";
import { existsSync } from "node:fs";
import { bonusKeys, readGambit } from "../module/rules/battalions.mjs";
import { parseRange } from "../module/rules/combat.mjs";

if ( flag("--help") ) {
  console.log(`Builds packs/battalions from the "Battalions" and "Gambits" tabs of the Optional Content Sheet.\n${USAGE}`);
  process.exit(0);
}

const PACK = "battalions";
const BATTALIONS_TAB = "Battalions";
const GAMBITS_TAB = "Gambits";

/** Where each tab keeps what, by the title of its column. */
const BATTALION_COLUMNS = {
  name: [0, "Name"], rank: [2, "Rank"], gambit: [3, "Gambit"], quality: [5, "Quality"], hp: [6, "Battalion HP"],
  str: [7, "STR"], mag: [8, "MAG"], hit: [9, "Hit"], critical: [10, "Critical"], dodge: [11, "Dodge"],
  critAvoid: [12, "Critical Avoid"], def: [13, "DEF"], res: [14, "RES"], cha: [15, "CHA"], cost: [16, "Cost"]
};
const GAMBIT_COLUMNS = {
  name: [0, "Name"], might: [2, "Mt"], hit: [3, "Hit"], uses: [4, "Use"], range: [5, "Range"],
  area: [6, "Target Area"], effect: [7, "Effect"]
};

/** The numbers of a unit the Battalions tab has a column for. */
const BONUS_COLUMNS = ["str", "mag", "hit", "critical", "dodge", "critAvoid", "def", "res", "cha"];

/** The headings of the tabs, which are no Battalion and no Gambit. */
const HEADINGS = ["Battalions", "Gambits"];

/**
 * The shapes a Target Area is drawn as, by the name of the picture, and each in words. A picture that is not
 * here is reported.
 */
const AREAS = {
  line_2: "A line of 2 tiles",
  line_4: "A line of 4 tiles",
  square_3x1: "A block of 3 by 1 tiles",
  square_3x2: "A block of 3 by 2 tiles",
  triangle_5x3: "A triangle of 5 by 3 tiles",
  target_1_radius: "The target and every tile within 1 of it",
  target_2_radius: "The target and every tile within 2 of it",
  ally_1_radius: "Allies within 1 tile",
  ally_2_radius: "Allies within 2 tiles"
};

const app = findFoundry();
const foundry = await loadFoundry(app);
const { FEO } = foundry;
const config = FEO.optional.battalions;
const report = new Report("Battalions compendium");
const problems = [];

if ( !existsSync(OPTIONAL_SHEET) ) {
  console.error(`The Optional Content Sheet is not in References. Save it there as "${OPTIONAL_SHEET.split(/[\\/]/).pop()}".`);
  process.exit(1);
}
const workbook = readWorkbook(OPTIONAL_SHEET);

/**
 * A tab of the sheet, with its column titles checked against what this script expects.
 * @param {string} name
 * @param {Record<string, [number, string]>} columns
 * @returns {import("./lib/xlsx.mjs").Sheet}
 */
function tab(name, columns) {
  const sheet = workbook.find((candidate) => candidate.name === name);
  if ( !sheet ) throw new Error(`The Optional Content Sheet has no "${name}" tab.`);
  for ( const [column, title] of Object.values(columns) ) {
    if ( oneLine(sheet.cell(1, column)) !== title ) {
      problems.push(`${name}, row 1: column ${column + 1} should be "${title}" but is "${oneLine(sheet.cell(1, column))}"`);
    }
  }
  return sheet;
}

/**
 * The rows of a tab that are entries: every filled row after the titles that is not a heading.
 * @param {import("./lib/xlsx.mjs").Sheet} sheet
 * @param {Record<string, [number, string]>} columns
 * @returns {{row: number, name: string, cell: (key: string) => string}[]}
 */
function entries(sheet, columns) {
  const rows = [];
  const known = Object.values(columns).map(([column]) => column);
  for ( let row = 2; row <= sheet.lastRow; row++ ) {
    const cells = sheet.filled(row);
    if ( !cells.length ) continue;
    const name = oneLine(sheet.cell(row, columns.name[0]));
    if ( (cells.length === 1) && (cells[0].column === columns.name[0]) ) {
      if ( HEADINGS.includes(name) ) report.count("Rows that are no entry", `the heading of the ${sheet.name} tab`);
      else problems.push(`${sheet.name}, row ${row}: "${name}" stands alone, and is not a heading this script knows`);
      continue;
    }
    if ( !name ) {
      problems.push(`${sheet.name}, row ${row}: has no name`);
      continue;
    }
    if ( cells.some(({ column }) => !known.includes(column)) ) {
      problems.push(`${sheet.name}, row ${row} ${name}: has cells outside the columns the titles name`);
    }
    rows.push({ row, name, cell: (key) => oneLine(sheet.cell(row, columns[key][0])) });
  }
  return rows;
}

/* -------------------------------------------- */
/*  Read the Gambits                            */
/* -------------------------------------------- */

const gambitSheet = tab(GAMBITS_TAB, GAMBIT_COLUMNS);
const gambits = new Map();
for ( const entry of entries(gambitSheet, GAMBIT_COLUMNS) ) {
  const { row, name } = entry;
  const where = `${GAMBITS_TAB}, row ${row} ${name}`;
  if ( gambits.has(name.toLowerCase()) ) {
    problems.push(`${where}: another Gambit has the same name`);
    continue;
  }

  // A Gambit without a Hit rolls nothing: it is a Support Gambit
  const kind = isBlank(entry.cell("hit")) ? "support" : "offensive";
  const number = (key, title) => {
    const text = entry.cell(key);
    if ( isBlank(text) ) return 0;
    const value = wholeNumber(text);
    if ( value === null ) problems.push(`${where}: the ${title} "${text}" is not a whole number`);
    return value ?? 0;
  };
  const might = number("might", "Mt");
  const hit = number("hit", "Hit");
  const uses = number("uses", "Use");
  if ( !(uses > 0) ) problems.push(`${where}: has no uses`);

  // Range is a number of tiles or a span of them; a whole number is written without its ".0"
  const range = entry.cell("range").replace(/^(\d+)\.0+$/, "$1");
  if ( !parseRange(range) ) problems.push(`${where}: the Range "${range}" could not be read`);

  // The Target Area, from the name of its picture
  let area = "";
  const picture = /\/Gr_fe16_([a-z0-9_]+)\.png/i.exec(gambitSheet.formula(row, GAMBIT_COLUMNS.area[0]))?.[1].toLowerCase();
  if ( picture && (picture in AREAS) ) {
    area = AREAS[picture];
    report.count("Target Areas", `${area}`, name);
  }
  else if ( picture ) problems.push(`${where}: its Target Area is the picture "${picture}", which is not in AREAS`);
  else report.count("Target Areas", "Gambits without a picture of their Target Area, left blank", name);

  const effect = isBlank(entry.cell("effect")) ? "" : gambitSheet.cell(row, GAMBIT_COLUMNS.effect[0]);
  const read = readGambit(effect);
  const applied = [];
  if ( read.magic ) applied.push("magic damage");
  if ( read.effective.length ) applied.push(`effective against ${read.effective.join(", ")}`);
  if ( read.inflicts.length ) applied.push(`inflicts ${read.inflicts.join(", ")}`);
  if ( read.oneRoll ) applied.push("one roll to hit");
  if ( kind === "support" ) report.count("Automation", "Support Gambits, announced with their Effect for the table to apply", name);
  else if ( read.left ) report.count("Automation", "Offensive Gambits applied in part, the rest of the Effect on the card for the table", `${name}: ${read.left}`);
  else report.count("Automation", "Offensive Gambits applied in full", name);
  if ( applied.length ) report.count("What is read from an Effect", applied.join(", "), name);

  gambits.set(name.toLowerCase(), {
    row,
    name,
    used: 0,
    system: { name, kind, might, hit, uses: { value: uses, max: uses }, range, area, effect }
  });
}

/* -------------------------------------------- */
/*  Read the Battalions                         */
/* -------------------------------------------- */

/**
 * Read a bonus: a number, or what it starts at and what it gains per level up.
 * @param {string} text
 * @returns {{base: number, perLevel: number}|null}     Null when the cell says neither
 */
function readBonus(text) {
  const match = /^(-?\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?)\s*per level up\.?)?$/i.exec(text);
  if ( !match ) return null;
  return { base: Number(match[1]), perLevel: match[2] ? Number(match[2]) : 0 };
}

const battalionSheet = tab(BATTALIONS_TAB, BATTALION_COLUMNS);
const battalions = [];
for ( const entry of entries(battalionSheet, BATTALION_COLUMNS) ) {
  const { row, name } = entry;
  const where = `${BATTALIONS_TAB}, row ${row} ${name}`;

  const rank = entry.cell("rank");
  if ( !config.ranks.includes(rank) ) {
    problems.push(`${where}: "${rank}" is not an Authority rank a Battalion can ask for`);
    continue;
  }

  // A Special Quality is one the system knows, so that what is effective against it can be told
  let quality = entry.cell("quality");
  if ( isBlank(quality) ) quality = "";
  else {
    const known = FEO.specialQualities.find((candidate) => candidate.toLowerCase() === quality.toLowerCase());
    if ( !known ) problems.push(`${where}: "${quality}" is not a Special Quality the system knows`);
    else if ( !config.restricted.includes(known) ) {
      report.count("Values read with care", `the Special Quality ${known}, which any unit may command`, name);
    }
    quality = known ?? quality;
    report.count("Special Qualities", quality);
  }

  const hp = wholeNumber(entry.cell("hp"));
  if ( !(hp > 0) ) problems.push(`${where}: the Battalion HP "${entry.cell("hp")}" is not a whole number above 0`);
  const cost = wholeNumber(entry.cell("cost"));
  if ( (cost === null) || (cost < 0) ) problems.push(`${where}: the Cost "${entry.cell("cost")}" is not a whole number`);

  const bonuses = Object.fromEntries(bonusKeys().map((key) => [key, { base: 0, perLevel: 0 }]));
  for ( const key of BONUS_COLUMNS ) {
    const text = entry.cell(key);
    const bonus = readBonus(text);
    if ( !bonus ) {
      problems.push(`${where}: the ${BATTALION_COLUMNS[key][1]} "${text}" is neither a number nor "X, Y per level up"`);
      continue;
    }
    bonuses[key] = bonus;
    if ( bonus.perLevel ) report.count("Bonuses", "bonuses that grow per level up");
    else if ( bonus.base ) report.count("Bonuses", "bonuses that stay as they are");
    if ( bonus.base < 0 ) report.count("Bonuses", "among both, penalties: bonuses that start below 0");
    if ( !Number.isInteger(bonus.base) ) {
      report.count("Values read with care", "a bonus that starts at a fraction, which counts once a level makes it whole", `${name} ${BATTALION_COLUMNS[key][1]} ${text}`);
    }
    if ( /\.$/.test(text) ) report.count("Values read with care", "a full stop after \"per level up\", dropped", name);
  }

  const gambit = gambits.get(entry.cell("gambit").toLowerCase());
  if ( !gambit ) {
    problems.push(`${where}: its Gambit "${entry.cell("gambit")}" is not in the ${GAMBITS_TAB} tab`);
    continue;
  }
  gambit.used++;

  battalions.push({
    row,
    name,
    rank,
    gambitRow: gambit.row,
    system: {
      rank,
      quality,
      hp: { value: hp ?? 0, max: hp ?? 0 },
      level: 1,
      exp: 0,
      bonuses,
      cost: cost ?? 0,
      equipped: false,
      gambit: structuredClone(gambit.system),
      description: ""
    }
  });
}

for ( const gambit of gambits.values() ) {
  if ( !gambit.used ) report.count("Gambits", "Gambits that no Battalion brings, which are not built", gambit.name);
}
report.add("Gambits", `${[...gambits.values()].filter((gambit) => gambit.used).length} of the ${gambits.size} Gambits are brought by a Battalion.`);

/* -------------------------------------------- */
/*  Images                                      */
/* -------------------------------------------- */

const library = new IconLibrary(app);
const picker = new IconPicker(library, PACK);
const people = (pattern) => picker.from("environment/people", pattern);
const banners = picker.from("sundries/flags", /^banner-(flag|standard)/, /pirate|skull|tattered/);

/** What a Battalion's name says it is made of, first match first, and the icons that suit it. */
const SHAPES = [
  [/\b(armored|pavise|heavy)\b/i, people(/armored/)],
  [/\b(pegasus)\b/i, picker.from("environment/creatures", /^horse-white/)],
  [/\b(wyvern)\b/i, banners],
  [/\b(archers|snipers)\b/i, people(/^archer/)],
  [/\b(cavalry|knights)\b/i, people(/^(cavalry|charge)/)],
  [/\b(monks|priests|physicians|sages|magic|dancers)\b/i, people(/^cleric/)],
  [/\b(lance)\b/i, people(/^spearfighter/)]
];
const POOL = people(/^(infantry|group)/).filter((path) => !/armored/.test(path));

/* -------------------------------------------- */
/*  Build the documents                         */
/* -------------------------------------------- */

const folders = [];
const folderIds = new Map();
for ( const rank of config.ranks ) {
  const count = battalions.filter((battalion) => battalion.rank === rank).length;
  if ( !count ) continue;
  const folder = makeFolder(PACK, { key: rank, name: `Authority ${rank}`, description: "", order: folders.length + 1 });
  folderIds.set(rank, folder._id);
  folders.push(folder);
  report.add("Battalions in each folder", `${String(count).padStart(5)}  ${folder.name}`);
}

const seen = new Map();
for ( const { name } of battalions ) seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);
battalions.sort((a, b) => (config.ranks.indexOf(a.rank) - config.ranks.indexOf(b.rank)) || (a.row - b.row));
const documents = battalions.map((battalion, index) => {
  const { name, rank, row, system } = battalion;
  if ( seen.get(name.toLowerCase()) > 1 ) problems.push(`${BATTALIONS_TAB}, row ${row} ${name}: another Battalion has the same name`);
  const img = picker.pick({
    name,
    slugs: [slugify(name)],
    group: `Authority ${rank}`,
    shapes: SHAPES,
    pool: POOL,
    fallback: "icons/svg/mystery-man.svg",
    materials: false
  });
  return {
    _id: stableId(PACK, name),
    name,
    type: "battalion",
    img,
    system,
    effects: [],
    folder: folderIds.get(rank),
    sort: (index + 1) * 100000,
    ownership: { default: 0 },
    flags: {
      [manifest.id]: {
        row,
        source: `Optional Content Sheet, ${BATTALIONS_TAB} tab, row ${row}; ${GAMBITS_TAB} tab, row ${battalion.gambitRow}`
      }
    },
    _stats: stats
  };
});

/* -------------------------------------------- */
/*  Check, report and write                     */
/* -------------------------------------------- */

problems.push(...validate(foundry, documents, folders, (path) => library.exists(path)));

report.add("Totals", `${documents.length} Battalions in ${folders.length} folders, from ${battalionSheet.lastRow} rows of the `
  + `${BATTALIONS_TAB} tab and ${gambitSheet.lastRow} rows of the ${GAMBITS_TAB} tab.`);
report.count("Rows that are no entry", "the title rows");
report.count("Rows that are no entry", "the title rows");
const kinds = (kind) => documents.filter((document) => document.system.gambit.kind === kind).length;
report.add("Gambits", `${kinds("offensive")} Battalions bring an Offensive Gambit, ${kinds("support")} a Support Gambit.`);
report.add("Automation", `Effect text kept word for word on ${documents.filter((document) => document.system.gambit.effect).length} Battalions.`);
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every Battalion and folder passed Foundry's own validation.");
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

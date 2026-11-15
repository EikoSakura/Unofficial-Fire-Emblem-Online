/**
 * Reads the Class Sheet. Each tab lays its classes out as blocks of six columns, up to three side by side, in
 * columns A to F, H to M and O to T: a row with the class's name and description, four rows of stats, then one
 * row for each further line such as "Proficiencies:" or "Promotes to:".
 *
 * A block whose stats are plain numbers is a class a unit starts in; one whose stats are written "+2" or "-" is
 * a class a unit is promoted into. A cell with only a short line of text is a heading, and a long one is a note:
 * for the heading above it, for the classes that start on the next row, or for the class it follows.
 */

import { readWorkbook, columnName } from "./xlsx.mjs";
import { CLASS_SHEET, isBlank, oneLine, wholeNumber } from "./pack.mjs";

const BLOCK_STARTS = [0, 7, 14];
const STAT_ROWS = [["hp", "res", "mov"], ["str", "dex", "con"], ["mag", "spd", "los"], ["def", "luk", "wt"]];
const STAT_LABELS = { hp: "HP", res: "RES", mov: "MOV", str: "STR", dex: "DEX", con: "CON", mag: "MAG", spd: "SPD", los: "LoS", def: "DEF", luk: "LUK", wt: "WT" };

/** The peoples of the tabs and headings. A tab or heading not listed here leaves the race as it was. */
const RACES = {
  "Beorc": "beorc", "Laguz": "laguz", "Manakete": "manakete", "Taguel": "taguel", "Monster Classes": "monster",
  "Misc. Classes": "beorc"
};

/* -------------------------------------------- */
/*  Proficiencies                               */
/* -------------------------------------------- */

const PHYSICAL = ["sword", "lance", "axe", "bow", "knife", "brawl"];
const ANIMA = ["fire", "thunder", "wind", "water", "earth"];
const MAGIC = [...ANIMA, "light", "dark"];
const EVERY = [...PHYSICAL, ...MAGIC, "staff"];
const WORDS = {
  sword: ["sword"], lance: ["lance"], axe: ["axe"], bow: ["bow"], knife: ["knife"], dagger: ["knife"],
  brawl: ["brawl"], fire: ["fire"], thunder: ["thunder"], wind: ["wind"], water: ["water"], earth: ["earth"],
  light: ["light"], dark: ["dark"], staff: ["staff"], anima: ANIMA
};

/**
 * Read one part of a proficiency line, such as "Sword", "any Magic" or "non-Dark magic".
 * @param {string} text
 * @returns {string[]|null}     The proficiencies it names, or null when it names none the system tracks
 */
function proficiencyWords(text) {
  const part = text.trim().toLowerCase().replace(/^(?:\d+x|x\d+)\s+/, "").replace(/^any\s+/, "").replace(/\.$/, "").trim();
  if ( part in WORDS ) return WORDS[part];
  if ( /^(all )?magic$/.test(part) ) return MAGIC;
  if ( /^non-dark magic$/.test(part) ) return MAGIC.filter((key) => key !== "dark");
  if ( /^non-light magic$/.test(part) ) return MAGIC.filter((key) => key !== "light");
  if ( /^(all )?physical( weapons?)?$/.test(part) ) return PHYSICAL;
  if ( /^(all )?weapons?$/.test(part) || (part === "all") || /^\d+ weapons?$/.test(part) ) return EVERY;
  return null;
}

/**
 * Read a "Proficiencies:" or "Proficiencies Gained:" line.
 * @param {string} text
 * @returns {{options: string[], choose: number, note: string, unknown: string[], partly: boolean}}
 *   `unknown` lists the words that name no proficiency the system tracks, and `partly` is true when the line
 *   says more than "all of these" or "this many of these" can hold.
 */
export function readProficiencies(text) {
  const note = oneLine(text);
  const result = { options: [], choose: 0, note: isBlank(note) ? "" : note, unknown: [], partly: false };
  if ( isBlank(note) ) return result;

  // Alternatives such as "or 2x as E Rank" stay in the note
  let main = note.replace(/,?\s*\bor\s+(?:\d+x?|x\d+|both)\s+(?:as|at)\s+[A-Z]\s+rank\b\.?/gi, "")
    .replace(/,?\s*with\s+\d+\s+(?:as|at)\s+[A-Z]\s+rank\b\.?/gi, "").replace(/\.$/, "").trim();

  // What is left out: "except Staff or Bolt", "All except Dark"
  const excluded = [];
  main = main.replace(/,?\s*except\s+(.+)$/i, (match, list) => {
    for ( const word of list.split(/\s+or\s+|,/i) ) excluded.push(...(proficiencyWords(word) ?? []));
    return "";
  }).trim();

  // How many are chosen: "2x …", "x1 …", "Any 1 …"
  let count = null;
  main = main.replace(/^(?:(\d+)x|x(\d+))\s+/i, (match, a, b) => {
    count = Number(a ?? b);
    return "";
  }).replace(/^any\s+(\d+)\s+/i, (match, a) => {
    count = Number(a);
    return "";
  });

  const add = (parts) => {
    for ( const part of parts ) {
      const keys = proficiencyWords(part);
      if ( keys ) result.options.push(...keys);
      else if ( part.trim() ) result.unknown.push(part.trim());
    }
  };
  const hasOr = /\s+or\s+/i.test(main);
  const hasComma = main.includes(",");
  const counted = (part) => /^\s*(?:\d+x|x\d+)\s+/i.test(part);

  if ( count !== null ) {
    add(main.split(/\s+or\s+|,/i));
    result.choose = count;
  } else if ( /^all\b/i.test(main) ) {
    add([main]);
  } else if ( hasOr && hasComma ) {
    // Some for certain and a choice besides: only the certain ones can be listed
    const parts = main.split(",");
    add(parts.filter((part) => !/\s+or\s+/i.test(part) && !counted(part)));
    result.partly = true;
  } else if ( hasOr ) {
    add(main.split(/\s+or\s+/i));
    result.choose = 1;
  } else {
    const parts = main.split(",");
    const chosen = parts.filter(counted);
    if ( chosen.length && (parts.length > 1) ) {
      add(parts.filter((part) => !counted(part)));
      result.partly = true;
    } else if ( chosen.length ) {
      add(parts);
      result.choose = Number(/\d+/.exec(parts[0])[0]);
    } else {
      add(parts);
    }
  }

  result.options = [...new Set(result.options)].filter((key) => !excluded.includes(key));
  if ( result.choose >= result.options.length ) result.choose = 0;
  return result;
}

/* -------------------------------------------- */
/*  Blocks                                      */
/* -------------------------------------------- */

/**
 * Tidy a class's name: a line break after a dash or slash joins the words, any other becomes a space.
 * @param {string} text
 * @returns {string}
 */
function className(text) {
  return oneLine(String(text).replace(/([-/])\s*\n\s*/g, "$1"));
}

/**
 * Read a number cell of a line such as "Starting Shift Gauge:", as the sheet shows it.
 * @param {string} text
 * @returns {string}
 */
function shown(text) {
  const number = /^([+-]?)(\d+)(?:\.0+)?$/.exec(text.trim());
  return number ? `${number[1]}${number[2]}` : oneLine(text);
}

/**
 * @typedef {object} SheetClass
 * @property {string} name
 * @property {string} cell              Where the block starts, such as "Beorc!A2"
 * @property {string} tab
 * @property {number} row
 * @property {number} column
 * @property {string[]} folder          The tab and heading the block sits under
 * @property {"base"|"gains"} kind      Whether the block gives starting stats or promotion gains
 * @property {string} tier
 * @property {string} race
 * @property {string} description
 * @property {string[]} remarks         Notes that belong to the class, for its description
 * @property {Record<string, number>} [base]
 * @property {Record<string, number>} [gains]
 * @property {number} wt
 * @property {Record<string, number>} transformed
 * @property {{options: string[], choose: number, note: string}} proficiencies
 * @property {Record<string, string>} skills
 * @property {string} specialQualities
 * @property {string[]} promotesTo
 * @property {{label: string, value: string}[]} notes
 * @property {string} skillLabel        The label the block's promotion-tier skill was listed under
 */

/**
 * Read every class of the visible tabs.
 * @param {object} [options]
 * @param {string[]} [options.hidden]     Names of hidden tabs to read as well
 * @returns {{classes: SheetClass[], folders: {path: string[], notes: string[]}[], oddities: Map<string, string[]>,
 *   problems: string[], skipped: string[]}}
 */
export function readClassSheet({ hidden = [] } = {}) {
  const classes = [];
  const folders = [];
  const problems = [];
  const skipped = [];
  const oddities = new Map();
  const odd = (kind, example) => {
    if ( !oddities.has(kind) ) oddities.set(kind, []);
    oddities.get(kind).push(example);
  };
  const folderOf = (path) => {
    let folder = folders.find((entry) => entry.path.join("/") === path.join("/"));
    if ( !folder ) {
      folder = { path, notes: [] };
      folders.push(folder);
    }
    return folder;
  };

  for ( const sheet of readWorkbook(CLASS_SHEET) ) {
    if ( sheet.hidden && !hidden.includes(sheet.name) ) {
      skipped.push(`the hidden tab "${sheet.name}" (${sheet.rows.size} rows)`);
      continue;
    }
    const tab = sheet.name;
    let path = [tab];
    let race = RACES[tab] ?? "beorc";
    folderOf(path);
    const isBlockStart = (row, start) => Boolean(sheet.cell(row, start)) && (sheet.cell(row + 1, start) === "HP");
    const filledRows = [...sheet.rows.keys()].sort((a, b) => a - b);
    const tabClasses = [];
    let previousWasHeading = true;      // The top of a tab counts as a heading for a note that follows

    for ( let index = 0; index < filledRows.length; index++ ) {
      const row = filledRows[index];
      const starts = BLOCK_STARTS.filter((start) => isBlockStart(row, start));

      // A row of class names: read each block downwards
      if ( starts.length ) {
        let last = row;
        for ( const start of starts ) {
          const { entry, end } = readBlock(sheet, tab, row, start, race, path, odd, problems);
          classes.push(entry);
          tabClasses.push(entry);
          last = Math.max(last, end);
        }
        while ( (index + 1 < filledRows.length) && (filledRows[index + 1] <= last) ) index++;
        previousWasHeading = false;
        continue;
      }

      // Anything else is a heading or a note
      for ( const { column, text } of sheet.filled(row) ) {
        const line = oneLine(text);
        const where = `${tab}!${columnName(column)}${row}`;
        const short = (line.length <= 40) && !line.endsWith(".") && !line.includes("\n");
        if ( short && (column === 0) && (sheet.filled(row).length === 1) ) {
          path = [tab, line];
          if ( line in RACES ) race = RACES[line];
          folderOf(path);
          previousWasHeading = true;
          continue;
        }
        if ( short ) {
          problems.push(`${where}: "${line}" is neither a class, a heading nor a note`);
          continue;
        }
        const next = filledRows[index + 1];
        const above = tabClasses.filter((entry) => (entry.column === column) && (entry.row < row)).at(-1);
        const followsNote = (index > 0) && (noteRows.get(tab) === filledRows[index - 1]) && above;
        noteRows.set(tab, row);
        if ( previousWasHeading ) {
          folderOf(path).notes.push(text);
          odd("notes kept as the description of a folder", where);
        } else if ( followsNote ) {
          above.remarks.push(text);
          odd("notes kept in the description of the class they follow", `${where} (${above.name})`);
        } else if ( (next !== undefined) && BLOCK_STARTS.some((start) => isBlockStart(next, start)) ) {
          const targets = BLOCK_STARTS.filter((start) => isBlockStart(next, start)).map((start) => `${tab}!${columnName(start)}${next}`);
          pendingRemarks.push({ targets, text });
          odd("notes kept in the description of the classes that follow them", where);
        } else if ( above ) {
          above.remarks.push(text);
          odd("notes kept in the description of the class they follow", `${where} (${above.name})`);
        } else {
          problems.push(`${where}: a note with no class or heading to belong to`);
        }
      }
    }
  }

  for ( const { targets, text } of pendingRemarks.splice(0) ) {
    for ( const cell of targets ) classes.find((entry) => entry.cell === cell)?.remarks.unshift(text);
  }

  assignTiers(classes, problems);
  return { classes, folders, oddities, problems, skipped };
}

/** Notes that belong to classes read after them. */
const pendingRemarks = [];

/** The row of the last note read on each tab, to keep a run of notes together. */
const noteRows = new Map();

/**
 * Read one class block.
 * @returns {{entry: SheetClass, end: number}}    The class and the last row of its block
 */
function readBlock(sheet, tab, row, start, race, path, odd, problems) {
  const cell = `${tab}!${columnName(start)}${row}`;
  const rawName = className(sheet.cell(row, start));
  const starred = /\*$/.test(rawName);
  const name = rawName.replace(/\s*\*+$/, "");
  const where = `${cell} ${name}`;
  if ( starred ) odd("class names with an asterisk the sheet does not explain, read without it", where);

  const entry = {
    name, cell, tab, row, column: start, folder: path, race,
    kind: "base", tier: "base",
    description: oneLine(sheet.cell(row, start + 2)),
    remarks: [],
    wt: 0,
    transformed: {},
    proficiencies: { options: [], choose: 0, note: "" },
    skills: {},
    specialQualities: "",
    promotesTo: [],
    notes: [],
    skillLabel: ""
  };
  if ( !entry.description ) odd("classes with no description on the sheet", where);

  // The four rows of stats
  const values = {};
  for ( let line = 0; line < 4; line++ ) {
    STAT_ROWS[line].forEach((key, position) => {
      const label = sheet.cell(row + 1 + line, start + (position * 2));
      if ( label !== STAT_LABELS[key] ) problems.push(`${where}: expected ${STAT_LABELS[key]} but found "${label}"`);
      values[key] = sheet.cell(row + 1 + line, start + (position * 2) + 1);
    });
  }
  const promoted = Object.entries(values).some(([key, value]) => (key !== "wt") && /^(\+|-$|-\*$)/.test(value));
  entry.kind = promoted ? "gains" : "base";
  const stats = {};
  for ( const [key, value] of Object.entries(values) ) {
    const label = STAT_LABELS[key];
    let number = null;
    const pair = /^([+-]?\d+)\s*,\s*([+-]?\d+)\*$/.exec(value);
    const marked = /^([+-]?\d+|-)\*$/.exec(value);
    if ( pair ) {
      number = Number(pair[1]);
      if ( promoted ) {
        entry.notes.push({ label, value });
        odd("a gain with a second, starred number, kept as a line of the class", `${where}: ${label} ${value}`);
      } else {
        entry.transformed[key] = Number(pair[2]);
      }
    } else if ( marked ) {
      number = marked[1] === "-" ? 0 : Number(marked[1]);
      entry.notes.push({ label, value });
      odd("a stat with an asterisk the sheet does not explain, kept as a line of the class", `${where}: ${label} ${value}`);
    } else if ( promoted && (value === "-") ) {
      number = 0;
    } else if ( /^varies$/i.test(value) ) {
      entry.notes.push({ label, value });
      odd('a stat given as "Varies", left empty and kept as a line of the class', `${where}: ${label}`);
    } else {
      number = wholeNumber(value);
      if ( number === null ) problems.push(`${where}: cannot read ${label} "${value}"`);
    }
    if ( key === "wt" ) entry.wt = number ?? 0;
    else if ( number !== null ) stats[key] = number;
  }
  if ( promoted ) entry.gains = stats;
  else entry.base = stats;
  if ( Object.keys(entry.transformed).length ) odd("classes with a second, starred number for some stats, kept as their transformed values", where);

  // The lines beneath
  let end = row + 4;
  for ( let line = row + 5; line <= sheet.lastRow; line++ ) {
    const label = oneLine(sheet.cell(line, start));
    if ( !label ) break;
    if ( sheet.cell(line + 1, start) === "HP" ) break;
    const value = sheet.cell(line, start + 3);
    const isLine = (label.length <= 60) && (/:$/.test(label) || /^Shift Modifier/.test(label));
    if ( !isLine ) break;
    end = line;
    readLine(entry, label.replace(/:$/, ""), value, where, odd, problems);
  }

  // A block that lists a "Laguz Skill" is a Laguz class wherever it sits, and likewise for the others
  const people = /^(Laguz|Manakete|Taguel) Skill$/.exec(entry.skillLabel)?.[1].toLowerCase();
  if ( people && (people !== entry.race) ) {
    odd(`classes taken as ${entry.skillLabel.split(" ")[0]} because of the skill line they carry`, where);
    entry.race = people;
  }
  return { entry, end };
}

/**
 * Read one labelled line of a class block.
 */
function readLine(entry, label, value, where, odd, problems) {
  const text = oneLine(value);
  const none = isBlank(text);
  const skill = (slot) => {
    if ( none ) return;
    if ( /^(any|depends)\b/i.test(text) ) {
      entry.notes.push({ label, value: text });
      odd("a skill line that names no skill, kept as a line of the class", `${where}: ${label}: ${text}`);
      return;
    }
    if ( entry.skills[slot] ) problems.push(`${where}: has two lines for its ${slot} skill`);
    entry.skills[slot] = text;
  };

  if ( /^Proficiencies( Gained)?$/.test(label) ) {
    const read = readProficiencies(value);
    entry.proficiencies = { options: read.options, choose: read.choose, note: read.note };
    if ( read.unknown.length ) odd("proficiencies the system keeps no rank for, kept in the note only", `${where}: ${read.unknown.join(", ")}`);
    if ( read.partly ) odd("proficiency lines only partly read: the certain ones are listed, the choice is in the note", `${where}: ${read.note}`);
    if ( (label === "Proficiencies") !== (entry.kind === "base") ) {
      odd(`"${label}" on a block whose stats are ${entry.kind === "base" ? "starting stats" : "gains"}`, where);
    }
  } else if ( label === "Starting Skills" ) {
    skill("starting");
  } else if ( /^Class Skills?$/.test(label) ) {
    // A class promoted into from a Trainee learns it at once; a class that does not promote learns it at 21
    skill(entry.kind === "gains" ? "starting" : "promotion");
    entry.skillLabel ||= "Class Skill";
  } else if ( /^(Promotion|Laguz|Manakete|Taguel|Heaven|Monster) Skills?$/.test(label) ) {
    entry.skillLabel = label.replace(/s$/, "");
    skill("promotion");
  } else if ( label === "Occult Skill" ) {
    skill("occult");
  } else if ( label === "Mastery Skill" ) {
    skill("mastery");
    entry.skillLabel ||= "Mastery Skill";
  } else if ( label === "Special Qualities" ) {
    if ( none ) return;
    const cleaned = text.replace(/\*/g, "").replace(/\.$/, "").trim();
    if ( cleaned !== text ) {
      entry.notes.push({ label, value: text });
      odd("Special Qualities with an asterisk or full stop, read without it and kept as a line of the class", `${where}: ${text}`);
    }
    entry.specialQualities = isBlank(cleaned) ? "" : cleaned;
  } else if ( label === "Promotes to" ) {
    if ( none ) return;
    if ( /\*|\bany\b/i.test(text) ) {
      entry.notes.push({ label, value: text });
      odd("a Promotes to line that names no class, kept as a line of the class", `${where}: ${text}`);
      return;
    }
    entry.promotesTo = text.split(",").map((name) => name.trim().replace(/\.$/, "")).filter(Boolean);
  } else {
    entry.notes.push({ label, value: shown(value) });
    if ( !/^(Starting Shift Gauge|Shift Modifier Per (Turn|Combat) \((Humanoid|Animal)\))$/.test(label) ) {
      odd("lines this script has no field for, kept as a line of the class", `${where}: ${label}`);
    }
  }
}

/* -------------------------------------------- */
/*  Tiers                                       */
/* -------------------------------------------- */

const ORDER = { trainee: 0, base: 1, second: 2, third: 3, heaven: 4 };
const TIERS = Object.keys(ORDER);

/**
 * Do two class names mean the same class? "Barbarian/Buccaneer" answers to either name, and
 * "Flier Lord (Pegasus)" to "Flier Lord".
 * @param {string} blockName      The name of a class block
 * @param {string} wanted         The name another class uses for it
 * @returns {boolean}
 */
export function sameClass(blockName, wanted) {
  const tidy = (name) => name.toLowerCase().replace(/\s+/g, " ").trim();
  const target = tidy(wanted);
  const names = [blockName, blockName.replace(/\s*\(.*\)\s*$/, ""), ...blockName.split("/")].map(tidy);
  return names.includes(target);
}

/**
 * Work out the tier of every class.
 * @param {SheetClass[]} classes
 * @param {string[]} problems
 */
function assignTiers(classes, problems) {
  for ( const entry of classes ) {
    const trainees = entry.folder.at(-1) === "Trainee Classes";
    if ( entry.kind === "base" ) entry.tier = trainees ? "trainee" : "base";
    else if ( entry.skillLabel === "Promotion Skill" ) entry.tier = "second";
    else if ( entry.skillLabel === "Heaven Skill" ) entry.tier = "heaven";
    else if ( entry.skillLabel === "Mastery Skill" ) entry.tier = "third";
    else if ( entry.skillLabel === "Class Skill" ) entry.tier = "base";
    else if ( (entry.skillLabel === "") && entry.skills.starting ) entry.tier = "base";
    else entry.tier = null;
  }

  // A class with a "Monster Skill" is one tier above the class that promotes to it
  for ( const entry of classes ) {
    if ( entry.tier !== null ) continue;
    const source = classes.filter((other) => {
      return (other.tab === entry.tab) && (other.row < entry.row) && other.tier
        && other.promotesTo.some((name) => sameClass(entry.name, name));
    }).at(-1);
    const tier = source ? TIERS[ORDER[source.tier] + 1] : null;
    if ( !tier ) {
      problems.push(`${entry.cell} ${entry.name}: cannot tell its tier; no class above it promotes to it`);
      entry.tier = "second";
      continue;
    }
    entry.tier = tier;
    // The skill of a third-tier class is its Mastery Skill
    if ( (tier === "third") && entry.skills.promotion && !entry.skills.mastery ) {
      entry.skills.mastery = entry.skills.promotion;
      delete entry.skills.promotion;
    }
  }
}

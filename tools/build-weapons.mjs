#!/usr/bin/env node
/**
 * Builds the weapon compendium (packs/weapons) from the "Weapons" tab of the Reference Sheet.
 *
 * Usage:
 *   node tools/build-weapons.mjs [--foundry <path>] [--json <file>] [--check] [--out <folder>] [--quiet]
 *
 * The tab is read as it is laid out: a row with only its first cell filled is a heading when it is short and a
 * note when it is long. Headings become folders, notes become the description of the folder they sit under, and
 * every other row is a weapon. Each weapon keeps its Effect text exactly as the sheet words it.
 *
 * How the sheet's ways of writing a value are read:
 *   Rank/Wlv "E, 1"        rank E, Weapon Level 1; "★" is the top rank; "N/A" is read as F, the lowest
 *   Cost "1,750", "240.0"  1750, 240; "N/A" is 0
 *   Uses "N/A", "Unlimited"  no limit, stored as 0 of 0
 *   "-" for Might, Hit or Critical  0
 *   "40 (100)"             a staff's value, then its value when counter-attacking at 1 range
 *   Range "44198.0"        a Range the spreadsheet turned into a date; read back as month-day, here "1-2"
 *   Effect "N/A"           no effect, stored empty
 *
 * A weapon's image comes from assets/icons/weapons when a file there is named after it (see the README in
 * assets/icons), and otherwise from the icons that ship with Foundry.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readWorkbook } from "./lib/xlsx.mjs";
import {
  REFERENCE_SHEET, ROOT, Report, USAGE, decimalNumber, findFoundry, flag, isBlank, loadFoundry, makeFolder, manifest,
  oneLine, paragraphs, slugify, stableId, stats, validate, wholeNumber, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";

if ( flag("--help") ) {
  console.log(`Builds packs/weapons from the "Weapons" tab of the Reference Sheet.\n${USAGE}`);
  process.exit(0);
}

const PACK = "weapons";
const TAB = "Weapons";
const COLUMNS = ["Name", "Might", "Hit", "Critical", "Range", "Weight", "Uses", "Rank/Wlv", "Cost", "wEXP", "Effect"];

/**
 * The headings of the tab. A group holds the headings that follow it; every other heading names the weapon
 * category of the rows beneath it. Broken weapons take the category their name gives.
 */
const GROUPS = ["Physical Weapons", "Magical Weapons", "Non-Beorc"];
const SECTIONS = {
  "Axes": "axe", "Brawl": "brawl", "Lances": "lance", "Bows": "bow", "Crossbows": "crossbow", "Swords": "sword",
  "Knives": "knife", "Broken Weapons": null, "Bolts": "bolt", "Anima": "anima", "Fire": "fire",
  "Thunder": "thunder", "Wind": "wind", "Water": "water", "Ice": "ice", "Earth": "earth", "Light": "light",
  "Dark": "dark", "Staves": "staff", "Laguz": "laguz", "Manakete": "manakete", "Taguel": "taguel",
  "Monster Weapons": "monster"
};
const TOP_LEVEL = ["Monster Weapons"];
const BROKEN = [
  [/crossbow/i, "crossbow"], [/axe/i, "axe"], [/gauntlet/i, "brawl"], [/lance/i, "lance"], [/bow/i, "bow"],
  [/sword/i, "sword"], [/knife/i, "knife"], [/staff/i, "staff"], [/tome/i, "anima"]
];

const app = findFoundry();
const foundry = await loadFoundry(app);
const { FEO } = foundry;
const { parseRange } = await import(pathToFileURL(join(ROOT, "module", "rules", "combat.mjs")).href);
const report = new Report("Weapons compendium");
const problems = [];

/* -------------------------------------------- */
/*  Read the tab                                */
/* -------------------------------------------- */

const sheet = readWorkbook(REFERENCE_SHEET).find((candidate) => candidate.name === TAB);
if ( !sheet ) {
  console.error(`The Reference Sheet has no "${TAB}" tab.`);
  process.exit(1);
}
COLUMNS.forEach((title, column) => {
  if ( oneLine(sheet.cell(1, column)) !== title ) {
    problems.push(`Row 1: column ${column + 1} should be "${title}" but is "${oneLine(sheet.cell(1, column))}"`);
  }
});

/** @type {{key: string, name: string, parent: string|null, notes: string[], category: string|null, count: number}[]} */
const sections = [];
const rows = [];
let group = null;
let section = null;

for ( let row = 2; row <= sheet.lastRow; row++ ) {
  const cells = sheet.filled(row);
  if ( !cells.length ) continue;
  const first = oneLine(sheet.cell(row, 0));

  if ( (cells.length === 1) && (cells[0].column === 0) ) {
    if ( GROUPS.includes(first) ) {
      group = { key: first, name: first, parent: null, notes: [], category: undefined, count: 0 };
      sections.push(group);
      section = null;
      report.count("Rows that are not weapons", "group headings, made into folders");
    } else if ( first in SECTIONS ) {
      const parent = TOP_LEVEL.includes(first) ? null : group?.key ?? null;
      section = { key: first, name: first, parent, notes: [], category: SECTIONS[first], count: 0 };
      sections.push(section);
      report.count("Rows that are not weapons", "section headings, made into folders");
    } else if ( ((first.length > 40) || first.endsWith(".")) && (section ?? group) ) {
      (section ?? group).notes.push(sheet.cell(row, 0));
      report.count("Rows that are not weapons", "notes, kept as the description of their folder", `row ${row}`);
    } else {
      problems.push(`Row ${row}: "${first}" is not a heading this script knows. Add it to SECTIONS.`);
    }
    continue;
  }

  if ( !section ) {
    problems.push(`Row ${row}: "${first}" comes before any section heading`);
    continue;
  }
  rows.push({ row, section });
}

/* -------------------------------------------- */
/*  Read a weapon                               */
/* -------------------------------------------- */

/**
 * Read a value that may carry a second one in parentheses, as a staff's do: "40 (100)".
 * @param {string} text
 * @returns {{main: string, counter: string|null}}
 */
function split(text) {
  const match = /^(.*?)\s*\(\s*([^()]*?)\s*\)?$/.exec(text.trim());
  return match ? { main: match[1].trim(), counter: match[2] } : { main: text.trim(), counter: null };
}

/**
 * Read a Range. Ranges such as "1-2" that the spreadsheet stored as a date are turned back.
 * @param {string} text
 * @param {string} where
 * @returns {string}
 */
function readRange(text, where) {
  const number = decimalNumber(text);
  if ( (number !== null) && (number > 366) ) {
    const date = new Date(Date.UTC(1899, 11, 30) + (number * 86400000));
    const range = `${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
    report.count("Values read with care", "Range stored as a date by the spreadsheet, read back as month-day",
      `${where}: ${text} as ${range}`);
    return range;
  }
  if ( number !== null ) return String(number);
  return oneLine(text);
}

const weapons = [];
const names = new Map();

for ( const { row, section: place } of rows ) {
  const cell = (column) => sheet.cell(row, column);
  const name = oneLine(cell(0));
  const where = `row ${row} ${name}`;
  let category = place.category;
  if ( category === null ) {
    category = BROKEN.find(([expression]) => expression.test(name))?.[1];
    if ( !category ) {
      problems.push(`${where}: cannot tell which kind of weapon this broken weapon is`);
      continue;
    }
    if ( category === "anima" ) {
      report.count("Values read with care", "a broken tome, filed as Anima because the sheet gives it no element", name);
    }
  }
  const isStaff = category === "staff";

  // Might, Hit and Critical, with a staff's counter-attack values
  const combat = {};
  const counter = { might: null, hit: null, crit: null };
  for ( const [key, column] of [["might", 1], ["hit", 2], ["crit", 3]] ) {
    const { main, counter: second } = split(cell(column));
    if ( second !== null ) {
      const value = wholeNumber(second);
      if ( value === null ) problems.push(`${where}: cannot read the ${key} in parentheses, "${cell(column)}"`);
      else if ( !isStaff ) problems.push(`${where}: has a ${key} in parentheses but is not a staff`);
      else counter[key] = value;
      if ( !/\)$/.test(cell(column)) ) {
        report.count("Values read with care", "a value in parentheses with the closing one missing", `${where}: ${cell(column)}`);
      }
    }
    if ( isBlank(main) ) {
      combat[key] = 0;
      if ( !isStaff ) report.count("Values read with care", `"-" for ${key}, stored as 0`, name);
    } else {
      const value = wholeNumber(main);
      if ( value === null ) problems.push(`${where}: cannot read the ${key} "${cell(column)}"`);
      combat[key] = value ?? 0;
    }
  }
  if ( isStaff && Object.values(counter).some((value) => value !== null) ) {
    report.count("Values read with care", "staves with counter-attack values in parentheses, kept in their own fields");
  }

  // Weight
  const weight = wholeNumber(cell(5));
  if ( weight === null ) problems.push(`${where}: cannot read the Weight "${cell(5)}"`);

  // Uses
  let uses = wholeNumber(cell(6));
  if ( uses === null ) {
    if ( isBlank(cell(6)) || /^unlimited$/i.test(cell(6)) ) {
      uses = 0;
      report.count("Values read with care", `Uses "${cell(6)}", stored as no limit`);
    } else {
      problems.push(`${where}: cannot read the Uses "${cell(6)}"`);
    }
  }

  // Rank and Weapon Level
  let rank = "E";
  let level = null;
  const ranked = /^(F|E|D|C|B|A|SS|S|★)(?:\s*,\s*(\d+))?$/.exec(cell(7));
  if ( ranked ) {
    rank = ranked[1] === "★" ? "STAR" : ranked[1];
    level = ranked[2] ? Number(ranked[2]) : null;
  } else if ( isBlank(cell(7)) ) {
    rank = "F";
    report.count("Values read with care", 'Rank "N/A", stored as F, the lowest rank', name);
  } else {
    problems.push(`${where}: cannot read the Rank "${cell(7)}"`);
  }

  // Cost
  let cost = wholeNumber(cell(8));
  if ( cost === null ) {
    if ( isBlank(cell(8)) ) cost = 0;
    else problems.push(`${where}: cannot read the Cost "${cell(8)}"`);
  }

  // Weapon experience
  let wexp = decimalNumber(cell(9));
  if ( wexp === null ) {
    const marked = /^(\d+(?:\.\d+)?)\s*\*$/.exec(cell(9));
    if ( marked ) {
      wexp = Number(marked[1]);
      report.count("Values read with care", "wEXP with an asterisk the sheet does not explain, read without it",
        `${where}: ${cell(9)}`);
    } else {
      problems.push(`${where}: cannot read the wEXP "${cell(9)}"`);
    }
  }

  // Range
  const range = readRange(cell(4), where);
  if ( !parseRange(range) && !/[a-z]/i.test(range) ) {
    report.count("Values read with care", `Range "${range}", which sets no limit the system can read`, name);
  }

  // Effect, word for word
  const effect = /^n\/?a$/i.test(cell(10)) ? "" : cell(10);
  if ( sheet.filled(row).some(({ column }) => column > 10) ) problems.push(`${where}: has cells beyond the Effect column`);

  // The stat that adds to Might
  const magical = Boolean(FEO.weaponCategories[category]?.magic) || isStaff;
  let damageStat = magical ? "mag" : "str";
  let statSource = magical ? "category" : null;
  if ( /can choose to use (MAG|DEX|SPD) not STR/i.test(effect) ) {
    report.count("Left as text", "a choice of damage stat", `${name}: ${effect}`);
  } else {
    const swapped = /\b(MAG|DEX|SPD) not STR\b/i.exec(effect) ?? /\buses (MAG|DEX|SPD) instead of STR\b/i.exec(effect);
    const physical = /\bSTR not MAG\b/i.test(effect) || /\buses STR instead of MAG\b/i.test(effect);
    if ( swapped ) {
      damageStat = swapped[1].toLowerCase();
      statSource = "effect";
    } else if ( physical ) {
      damageStat = "str";
      statSource = "effect";
    }
  }
  if ( statSource === "category" ) report.count("Automation", "damage stat set to MAG by the weapon's category");
  if ( statSource === "effect" ) {
    report.count("Automation", `damage stat set to ${damageStat.toUpperCase()} by the Effect text`);
  }

  const sameName = names.get(`${category}.${name}`) ?? [];
  sameName.push(weapons.length);
  names.set(`${category}.${name}`, sameName);
  place.count++;
  weapons.push({
    row, name, category, section: place, rank, level,
    system: {
      category,
      might: combat.might,
      hit: combat.hit,
      crit: combat.crit,
      range,
      weight: weight ?? 0,
      uses: { value: uses ?? 0, max: uses ?? 0 },
      rank,
      level,
      cost: cost ?? 0,
      wexp: wexp ?? 0,
      damageStat,
      counter,
      effect,
      equipped: false,
      description: ""
    }
  });
}

// Weapons that share a name within a category are told apart by rank, as the Laguz and Manakete ones are
const rankLabel = (rank) => (rank === "STAR" ? "★" : rank);
for ( const [key, indexes] of names ) {
  if ( indexes.length < 2 ) continue;
  const ranks = new Set(indexes.map((index) => weapons[index].rank));
  for ( const index of indexes ) {
    const weapon = weapons[index];
    weapon.sheetName = weapon.name;
    weapon.suffix = ranks.size === indexes.length ? rankLabel(weapon.rank) : `row ${weapon.row}`;
  }
  report.count("Values read with care", "names used by several weapons, given their rank in brackets",
    `${key.split(".")[1]} ×${indexes.length}`);
}

/* -------------------------------------------- */
/*  Images                                      */
/* -------------------------------------------- */

const library = new IconLibrary(app);
const picker = new IconPicker(library, PACK);
const from = (folder, pattern, except) => picker.from(folder, pattern, except);
const gems = (pattern) => from("commodities/gems", pattern);

/** For each category: the pool of icons, and the pools for names that say what the weapon looks like. */
const LOOKS = {
  axe: {
    pool: from("weapons/axes", /^(axe|shortaxe)/),
    shapes: [
      [/poleax|bardiche|voulge|halberd|sparth|doloire/i, from("weapons/polearms", /^(halberd|glaive)/)],
      [/hand axe|hatchet|francisca|tomahawk|short axe/i, [...from("weapons/axes", /tomahawk|shortaxe/), ...from("weapons/thrown", /throwing-axe/)]],
      [/greataxe|battle axe|broadaxe/i, from("weapons/axes", /^axe-(battle|double)/)],
      [/pickaxe/i, from("weapons/axes", /^pickaxe/)],
      [/hammer/i, from("weapons/hammers", /^hammer/)],
      [/\bmace\b/i, from("weapons/maces", /^mace/)],
      [/cleaver|meataxe|log splitter/i, from("weapons/axes", /cleaver|chopping/)]
    ]
  },
  lance: {
    pool: from("weapons/polearms", /^(spear|pike)/),
    shapes: [
      [/javelin|verutum|short spear|saunion|harpoon|spontoon/i, from("weapons/polearms", /javelin|spear-simple|spear-barbed/)],
      [/glaive|partizan|billhook|rhomphaia|hasta/i, from("weapons/polearms", /glaive|halberd/)],
      [/greatlance|heavy|pike|sarissa|longspear|greatspear/i, from("weapons/polearms", /pike|spear-(ornate|flared)/)],
      [/trishula|trident/i, from("weapons/polearms", /trident/)],
      [/standard/i, from("sundries/flags", /banner-standard/)]
    ]
  },
  bow: {
    pool: from("weapons/bows"),
    shapes: [
      [/long|great|tower/i, from("weapons/bows", /longbow/)],
      [/short|slim|backup|horn/i, from("weapons/bows", /shortbow|bow-simple/)]
    ]
  },
  crossbow: {
    pool: from("weapons/crossbows", /^crossbow/),
    shapes: [
      [/hand|bowgun/i, from("weapons/crossbows", /handcrossbow|crossbow-simple/)],
      [/ballista|arbalest|gastraphetes|wallarmbrust/i, from("weapons/crossbows", /heavy|long/)]
    ]
  },
  sword: {
    pool: from("weapons/swords", /^(sword|shortsword)-/, /katana|cane/),
    shapes: [
      [/blade|grandsword|greatsword|claymore|zweih|bastard|longsword|broadsword/i, from("weapons/swords", /greatsword|sword-broad/)],
      [/shortsword|slim|rapier|estoc|florete|spadroon/i, from("weapons/swords", /shortsword|sword-simple|sword-cane|sword-hilt/)],
      [/scimitar|shamshir|shotel|kukri|cutlass|saber|falchion|machete|chopper/i, from("weapons/swords", /scimitar|machete|cutlass/)],
      [/katana|wo dao|killing edge|quickdraw/i, from("weapons/swords", /katana/)]
    ]
  },
  knife: {
    pool: from("weapons/daggers", /^(dagger|knife)/, /kitchen|multitool|butterfly|fan|flat-bar/),
    shapes: [
      [/throwing|chakram/i, from("weapons/thrown", /dagger|shuriken|throwing-knife|throwing-star/)],
      [/\bhook\b/i, from("weapons/fist", /^hook/)],
      [/cleaver/i, from("weapons/axes", /cleaver/)],
      [/stiletto|misericorde|rondel|main gauche/i, from("weapons/daggers", /straight|thin|simple/)]
    ]
  },
  brawl: {
    pool: from("weapons/fist", /knuckles|glove|gauntlet|boxing|fist/),
    shapes: [
      [/claws?\b|fangs?\b|bagh nakh/i, from("weapons/fist", /^claws?-/)],
      [/gauntlets?/i, [...from("weapons/fist", /glove|gauntlet/), ...from("equipment/hand", /^gauntlet/)]],
      [/katar|pata|sainti|sphairai/i, from("weapons/fist", /katar|punch-dagger/)],
      [/^fists$/i, from("skills/melee", /unarmed-punch/)]
    ]
  },
  bolt: {
    pool: [...from("weapons/ammunition", /^arrows?-/), ...from("weapons/artillery", /ballista/)],
    shapes: [
      [/onager|mangonel|lithobolos|stonehoist|pachyderm|springald/i, [...from("weapons/artillery", /catapult|trebuchet/), ...from("weapons/thrown", /^throwing-(rock|stone|brick)/)]]
    ]
  },
  anima: {
    pool: [...from("magic/symbols", /^(runes?|star|triangle|circle|elements|ring)/), ...from("magic/control", /energy-stream/)],
    shapes: [[/tome/i, from("sundries/books", /worn/)]]
  },
  fire: {
    pool: from("magic/fire", /^(projectiles?|explosion|flame|beam|blast|orb)-.*(orange|red|yellow)/, /blue|teal|green|purple|pink|white|tree|skeleton|skull/),
    shapes: [[/meteor/i, from("magic/fire", /meteor.*(orange|red|yellow)/, /blue|teal|green|purple|pink|white/)]]
  },
  thunder: { pool: from("magic/lightning", /^(bolts?|orb|strike|projectiles?)-/), shapes: [] },
  wind: { pool: from("magic/air", /^(wind|air)-/), shapes: [[/fog/i, from("magic/air", /^fog/)]] },
  water: { pool: from("magic/water", /water|waves?-|pseudopod|bubbles|vortex/), shapes: [] },
  ice: { pool: from("magic/water", /ice|snow/), shapes: [] },
  earth: { pool: from("magic/earth"), shapes: [] },
  light: { pool: [...from("magic/light", /^(beams?|explosion|projectiles?|orbs?)-/, /red|shadow|smoke/), ...from("magic/holy", /^(angel|saint|prayer|barrier)/)], shapes: [] },
  dark: { pool: [...from("magic/unholy"), ...from("magic/death", /^(skull|projectile)/)], shapes: [] },
  staff: {
    pool: from("weapons/staves", /^staff/),
    shapes: [[/festal/i, from("weapons/wands", /^wand-(gem|star|carved|crook)/)]]
  },
  laguz: {
    pool: from("creatures/abilities"),
    shapes: [
      [/claw/i, [...from("creatures/claws", /^claw/), ...from("commodities/claws", /^claws?-/)]],
      [/fang/i, [...from("commodities/bones", /^(tooth|teeth)/), ...from("creatures/abilities", /fang/)]],
      [/dirge/i, [...from("skills/trades", /music/), ...from("tools/instruments", /flute|lyre|harp|horn/)]],
      [/beak/i, [...from("commodities/bones", /^beak/), ...from("creatures/birds", /corvid/)]],
      [/talon/i, [...from("commodities/claws", /^talon/), ...from("creatures/claws", /talons/)]],
      [/red breath/i, [...from("creatures/abilities", /dragon-(fire|breath)/), ...from("magic/fire", /^(beam|blast)/)]],
      [/white breath/i, [...from("creatures/abilities", /dragon-ice/), ...from("magic/water", /beam-ice|projectile-ice/)]],
      [/black breath/i, from("magic/unholy", /^(beam|strike-beam)/)]
    ]
  },
  manakete: {
    pool: gems(/^gem-faceted-(diamond|trillion|teardrop|cushion)-/, /red|blue|yellow|green|black|white/),
    shapes: [
      [/fire/i, gems(/^gem-(rough|faceted)-.*-red$/, /pink|white/)],
      [/ice/i, gems(/^gem-(rough|faceted)-.*-blue$/)],
      [/earth/i, gems(/^gem-(amber-.*|rough-.*)-orange$/, /red/)],
      [/thunder/i, gems(/^gem-(rough|faceted)-.*-yellow$/)],
      [/wind/i, gems(/^gem-(rough|faceted|cut)-.*-green$/, /yellow/)],
      [/mage/i, gems(/^gem-(rough|faceted|cut)-.*-(purple|violet)$/, /pink/)],
      [/dark/i, [...gems(/^gem-.*-black$/), ...gems(/^pearl-purple-dark$/)]],
      [/light/i, gems(/^(gem-(rough|faceted)-(oval|cushion|round)-white|pearl-(white-oval|rough-white))$/)]
    ]
  },
  taguel: {
    pool: [...from("commodities/stone", /^(geode|stone-chunk)/), ...gems(/^gem-raw/)],
    shapes: [
      [/boulder/i, from("commodities/stone", /^(boulder|rock)/)],
      [/rune/i, from("commodities/treasure", /token-runed/)]
    ]
  },
  monster: {
    pool: from("creatures/abilities"),
    shapes: [
      [/claws/i, [...from("creatures/claws"), ...from("commodities/claws", /^claws?-/)]],
      [/skull/i, from("commodities/bones", /^skull/)],
      [/bone/i, from("commodities/bones", /^bones?-/)],
      [/eye|oculus/i, [...from("creatures/eyes"), ...from("magic/perception", /eye/)]],
      [/scythe|sickle/i, from("weapons/sickles")],
      [/breath/i, [...from("magic/acid", /^(projectile|pouring)/), ...from("creatures/abilities", /dragon-breath/), ...from("magic/death", /skull-(fire|energy|flames)/)]]
    ]
  }
};

// A broken weapon keeps the look of its kind, worn; the plain kinds of weapon need no narrowing by name
const PLAIN = new Set(["thunder", "water", "ice", "earth", "light", "dark", "fire", "wind", "anima", "staff", "manakete"]);

/* -------------------------------------------- */
/*  Build the documents                         */
/* -------------------------------------------- */

const folders = [];
const folderIds = new Map();
sections.forEach((entry, index) => {
  const folder = makeFolder(PACK, {
    key: entry.key,
    name: entry.name,
    parent: entry.parent ? folderIds.get(entry.parent) : null,
    description: entry.notes.map(paragraphs).join(""),
    order: index + 1
  });
  folderIds.set(entry.key, folder._id);
  folders.push(folder);
});

const documents = weapons.map((weapon, index) => {
  const { name, category, suffix, sheetName } = weapon;
  const look = LOOKS[category];
  const slug = slugify(name);
  const img = picker.pick({
    name,
    slugs: [`${category}-${slug}`, slug],
    group: weapon.section.name,
    shapes: look.shapes,
    pool: look.pool,
    fallback: "icons/svg/sword.svg",
    materials: !PLAIN.has(category) || /broken|drained/i.test(name)
  });
  const flags = { row: weapon.row, source: `Reference Sheet, ${TAB} tab, row ${weapon.row}` };
  if ( sheetName ) flags.sheetName = sheetName;
  return {
    _id: stableId(PACK, `${category}.${name}${suffix ? `.${suffix}` : ""}`),
    name: suffix ? `${name} (${suffix})` : name,
    type: "weapon",
    img,
    system: weapon.system,
    effects: [],
    folder: folderIds.get(weapon.section.key),
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

report.add("Totals", `${documents.length} weapons in ${folders.length} folders, from ${sheet.lastRow} rows of the ${TAB} tab.`);
for ( const entry of sections ) {
  const inside = entry.category === undefined
    ? sections.filter((other) => other.parent === entry.key).reduce((sum, other) => sum + other.count, 0)
    : entry.count;
  const label = `${entry.parent ? `${entry.parent} / ` : ""}${entry.name}`;
  const note = entry.notes.length ? `, ${entry.notes.length} note${entry.notes.length > 1 ? "s" : ""} in its description` : "";
  report.add("Weapons in each folder", `${String(inside).padStart(5)}  ${label}${note}`);
}
report.count("Rows that are not weapons", "the header row");
const withEffect = documents.filter((document) => document.system.effect).length;
report.add("Automation", `Effect text kept word for word on ${withEffect} weapons; ${documents.length - withEffect} have none ("N/A" on the sheet).`);
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every weapon and folder passed Foundry's own validation.");
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

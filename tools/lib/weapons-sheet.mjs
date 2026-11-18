/**
 * Reads the "Weapons" tab of the Reference Sheet. Shared by the weapons build, which makes a weapon of every
 * row, and the skills build, which looks up the weapons a skill lends its unit.
 */

import { readWorkbook } from "./xlsx.mjs";
import { REFERENCE_SHEET, decimalNumber, isBlank, oneLine, wholeNumber } from "./pack.mjs";

export const TAB = "Weapons";
export const COLUMNS = ["Name", "Might", "Hit", "Critical", "Range", "Weight", "Uses", "Rank/Wlv", "Cost", "wEXP", "Effect"];

/**
 * The headings of the tab. A group holds the headings that follow it; every other heading names the weapon
 * category of the rows beneath it. Broken weapons take the category their name gives.
 */
export const GROUPS = ["Physical Weapons", "Magical Weapons", "Non-Beorc"];
export const SECTIONS = {
  "Axes": "axe", "Brawl": "brawl", "Lances": "lance", "Bows": "bow", "Crossbows": "crossbow", "Swords": "sword",
  "Knives": "knife", "Broken Weapons": null, "Bolts": "bolt", "Anima": "anima", "Fire": "fire",
  "Thunder": "thunder", "Wind": "wind", "Water": "water", "Ice": "ice", "Earth": "earth", "Light": "light",
  "Dark": "dark", "Staves": "staff", "Laguz": "laguz", "Manakete": "manakete", "Taguel": "taguel",
  "Monster Weapons": "monster"
};
export const TOP_LEVEL = ["Monster Weapons"];
export const BROKEN = [
  [/crossbow/i, "crossbow"], [/axe/i, "axe"], [/gauntlet/i, "brawl"], [/lance/i, "lance"], [/bow/i, "bow"],
  [/sword/i, "sword"], [/knife/i, "knife"], [/staff/i, "staff"], [/tome/i, "anima"]
];

/**
 * Read the tab as it is laid out: a row with only its first cell filled is a heading when it is short and a
 * note when it is long, and every other row is a weapon.
 * @param {object} options
 * @param {object} options.FEO                  The system's configuration
 * @param {Function} options.parseRange         Reads a Range (see `module/rules/combat.mjs`)
 * @param {{count: Function}} [options.report]  Where what is read with care is counted; nothing is where none is given
 * @returns {{sheet: object, sections: object[], weapons: object[], problems: string[]}}
 */
export function readWeaponsTab({ FEO, parseRange, report = { count() {} } }) {
  const problems = [];

  /* -------------------------------------------- */
  /*  Read the tab                                */
  /* -------------------------------------------- */

  const sheet = readWorkbook(REFERENCE_SHEET).find((candidate) => candidate.name === TAB);
  if ( !sheet ) throw new Error(`The Reference Sheet has no "${TAB}" tab.`);
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


  return { sheet, sections, weapons, problems };
}

/**
 * The name a weapon has in the compendium: its own, with its rank in brackets where several share it.
 * @param {{name: string, suffix?: string}} weapon
 * @returns {string}
 */
export function weaponName(weapon) {
  return weapon.suffix ? `${weapon.name} (${weapon.suffix})` : weapon.name;
}

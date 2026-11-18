/**
 * Reads the "Skills" tab of the Reference Sheet, and the skills of the same tab of the Optional Content Sheet
 * that are in the game (those listed in packs-src/optional-content.json). Shared by the skills build, which
 * makes a skill of every row, and the classes build, which checks the skills a class names against them.
 */

import { readWorkbook } from "./xlsx.mjs";
import { OPTIONAL_SHEET, REFERENCE_SHEET, oneLine, readOptionalList } from "./pack.mjs";

export const SKILLS_TAB = "Skills";
export const SKILL_SOURCES = { reference: "Reference Sheet", optional: "Optional Content Sheet" };
export const SKILL_COLUMNS = { name: 0, effect: 1, prerequisite: 5, capacity: 6 };
export const SKILL_TITLES = { name: "Name", effect: "Effect", prerequisite: "Prerequisite /Class", capacity: "Capacity Cost" };

/**
 * The headings of the tab and the kind of skill listed under each. A heading that is not here is reported.
 * `null` marks a part of the tab that is not a list of skills.
 */
export const SKILL_SECTIONS = {
  "Generic Skills": "generic",
  "Class-Specific Skills": "class",
  "Promotion Skills": "promotion",
  "Occult Skills": "occult",
  "Mastery Skills": "mastery",
  "Misc. Skills": "misc",
  "Monster Skills": "monster",
  "Enemy-Exclusive Skills": "enemy",
  "Wildkin Animal Units": null
};

/**
 * Take the markers off the end of a skill's name. The tab explains them in its first rows:
 * "*" choose when to activate, "**" cannot be put on a Skill Scroll, "***" both, "†" can be put on a scroll but
 * only learnt by units of the same base class, "×" cancelled in combat by Nihil.
 * @param {string} text
 * @returns {{name: string, markers: string, chosen: boolean, scroll: "any"|"sameClass"|"none", nihil: boolean,
 *   conflict: boolean}}
 */
export function readSkillName(text) {
  const match = /^(.*?)\s*([*†×]*)$/.exec(oneLine(text));
  const markers = match[2];
  const stars = (markers.match(/\*/g) ?? []).length;
  const dagger = markers.includes("†");
  const unscrollable = stars >= 2;
  return {
    name: match[1],
    markers,
    chosen: (stars === 1) || (stars >= 3),
    scroll: unscrollable ? "none" : dagger ? "sameClass" : "any",
    nihil: markers.includes("×"),
    conflict: (unscrollable && dagger) || (stars > 3)
  };
}

/**
 * @typedef {object} SkillSection
 * @property {string} key           The heading without its words in brackets
 * @property {string} name
 * @property {string|null} kind     The kind of skill listed, or null for a part that lists none
 * @property {string[]} notes       The heading's words in brackets and the notes beneath it
 * @property {number} count
 */

/**
 * Read the tab.
 * @returns {{sheet: object, sections: SkillSection[], preamble: {row: number, text: string}[],
 *   rows: {row: number, section: SkillSection, from: object, source: string}[],
 *   extras: {row: number, section: SkillSection}[], problems: string[]}}
 *   `rows` are the skills, each with the tab it is on (`from`) and the sheet that tab is of (`source`);
 *   `extras` the rows of parts that list no skills, `preamble` the notes above the first heading. `sheet` is
 *   the tab of the Reference Sheet.
 */
export function readSkillsTab() {
  const sheet = readWorkbook(REFERENCE_SHEET).find((candidate) => candidate.name === SKILLS_TAB);
  if ( !sheet ) throw new Error(`The Reference Sheet has no "${SKILLS_TAB}" tab.`);
  const problems = [];
  for ( const [key, column] of Object.entries(SKILL_COLUMNS) ) {
    if ( oneLine(sheet.cell(1, column)) !== SKILL_TITLES[key] ) {
      problems.push(`Row 1: column ${column + 1} should be "${SKILL_TITLES[key]}" but is "${oneLine(sheet.cell(1, column))}"`);
    }
  }

  const sections = [];
  const preamble = [];
  const rows = [];
  const extras = [];
  let section = null;
  for ( let row = 2; row <= sheet.lastRow; row++ ) {
    const cells = sheet.filled(row);
    if ( !cells.length ) continue;
    const first = oneLine(sheet.cell(row, 0));

    if ( (cells.length === 1) && (cells[0].column === 0) ) {
      const bracketed = /^([^()]{1,40}?)\s*\((.+)\)$/.exec(first);
      const heading = bracketed ? bracketed[1] : first;
      if ( heading in SKILL_SECTIONS ) {
        section = { key: heading, name: heading, kind: SKILL_SECTIONS[heading], notes: bracketed ? [bracketed[2]] : [], count: 0 };
        sections.push(section);
      } else if ( (first.length > 40) || first.endsWith(".") ) {
        if ( section ) section.notes.push(sheet.cell(row, 0));
        else preamble.push({ row, text: sheet.cell(row, 0) });
      } else {
        problems.push(`Row ${row}: "${first}" is not a heading this script knows. Add it to SKILL_SECTIONS.`);
      }
      continue;
    }
    if ( !section ) {
      problems.push(`Row ${row}: "${first}" comes before any section heading`);
      continue;
    }
    if ( section.kind === null ) extras.push({ row, section });
    else rows.push({ row, section, from: sheet, source: SKILL_SOURCES.reference });
  }

  // The skills of the Optional Content Sheet that are in the game: only those the list names are read, each
  // into the part of the tab it stands in there, which has the headings of the Reference Sheet's
  const optional = readOptionalList();
  problems.push(...optional.problems);
  const extra = (optional.skills.length && !optional.problems.length)
    ? readWorkbook(OPTIONAL_SHEET).find((candidate) => candidate.name === SKILLS_TAB) : null;
  if ( optional.skills.length && !optional.problems.length && !extra ) problems.push(`The ${SKILL_SOURCES.optional} has no "${SKILLS_TAB}" tab.`);
  if ( extra ) {
    for ( const [key, column] of Object.entries(SKILL_COLUMNS) ) {
      if ( oneLine(extra.cell(1, column)) !== SKILL_TITLES[key] ) {
        problems.push(`${SKILL_SOURCES.optional}, row 1: column ${column + 1} should be "${SKILL_TITLES[key]}" but is "${oneLine(extra.cell(1, column))}"`);
      }
    }
    const found = new Set();
    let place = null;
    for ( let row = 2; row <= extra.lastRow; row++ ) {
      const cells = extra.filled(row);
      if ( !cells.length ) continue;
      const first = oneLine(extra.cell(row, 0));
      if ( (cells.length === 1) && (cells[0].column === 0) ) {
        // A note says nothing of where the rows beneath it belong; any other line is a heading, and one this
        // tab alone has ends the part before it
        const bracketed = /^([^()]{1,40}?)\s*\((.+)\)$/.exec(first);
        const heading = bracketed ? bracketed[1] : first;
        if ( !(heading in SKILL_SECTIONS) && ((first.length > 40) || first.endsWith(".")) ) continue;
        place = sections.find((entry) => (entry.key === heading) && (entry.kind !== null)) ?? null;
        continue;
      }
      if ( !place ) continue;
      const { name } = readSkillName(extra.cell(row, SKILL_COLUMNS.name));
      if ( !optional.skills.includes(name) ) continue;
      if ( found.has(name) ) problems.push(`${SKILL_SOURCES.optional}, row ${row}: a second skill named "${name}"`);
      found.add(name);
      rows.push({ row, section: place, from: extra, source: SKILL_SOURCES.optional });
    }
    for ( const name of optional.skills ) {
      if ( !found.has(name) ) problems.push(`optional-content.json: the ${SKILLS_TAB} tab of the ${SKILL_SOURCES.optional} has no skill named "${name}"`);
    }
  }
  return { sheet, sections, preamble, rows, extras, problems };
}

/**
 * The names of every skill on the tab, without their markers, in lower case.
 * @returns {Map<string, {name: string, kind: string, row: number}[]>}
 */
export function readSkillNames() {
  const { rows } = readSkillsTab();
  const names = new Map();
  for ( const { row, section, from } of rows ) {
    const { name } = readSkillName(from.cell(row, SKILL_COLUMNS.name));
    const key = name.toLowerCase();
    if ( !names.has(key) ) names.set(key, []);
    names.get(key).push({ name, kind: section.kind, row });
  }
  return names;
}

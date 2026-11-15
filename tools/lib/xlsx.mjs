/**
 * A small reader for .xlsx workbooks, enough to pull cell text out of the reference spreadsheets.
 * It needs nothing beyond Node itself: a workbook is a zip archive of XML files.
 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/* -------------------------------------------- */
/*  Zip                                         */
/* -------------------------------------------- */

/**
 * Read every file of a zip archive.
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}     File contents by path
 */
function unzip(buffer) {
  let end = -1;
  for ( let i = buffer.length - 22; i >= 0; i-- ) {
    if ( buffer.readUInt32LE(i) === 0x06054b50 ) { end = i; break; }
  }
  if ( end < 0 ) throw new Error("Not a zip archive");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for ( let i = 0; i < count; i++ ) {
    if ( buffer.readUInt32LE(offset) !== 0x02014b50 ) throw new Error("Damaged zip directory");
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files.set(name, method === 0 ? data : inflateRawSync(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/* -------------------------------------------- */
/*  XML                                         */
/* -------------------------------------------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Replace XML entities with the characters they stand for.
 * @param {string} text
 * @returns {string}
 */
function decode(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, code) => {
    if ( code.startsWith("#x") ) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if ( code.startsWith("#") ) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? match;
  }).replace(/_x([0-9A-Fa-f]{4})_/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * The text of a string item: every <t> run joined, without phonetic hints.
 * @param {string} xml
 * @returns {string}
 */
function runs(xml) {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for ( const match of plain.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g) ) text += decode(match[1] ?? "");
  return text.replace(/\r\n?/g, "\n");
}

const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/* -------------------------------------------- */
/*  Workbook                                    */
/* -------------------------------------------- */

/**
 * Turn a column's letters into its number, starting from 0 for A.
 * @param {string} letters
 * @returns {number}
 */
export function columnIndex(letters) {
  let index = 0;
  for ( const letter of letters ) index = (index * 26) + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Turn a column's number into its letters.
 * @param {number} index
 * @returns {string}
 */
export function columnName(index) {
  let name = "";
  for ( let n = index + 1; n > 0; n = Math.floor((n - 1) / 26) ) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * @typedef {object} Sheet
 * @property {string} name
 * @property {boolean} hidden
 * @property {Map<number, Map<number, string>>} rows    Cell text by row number (from 1) then column (from 0)
 * @property {number} lastRow
 * @property {(row: number, column: number|string) => string} cell    A cell's text, trimmed; "" when empty
 * @property {(row: number) => {column: number, text: string}[]} filled    The filled cells of a row, in order
 * @property {(row: number, column: number|string) => string} formula    A cell's formula, without its "=";
 *   "" when it has none. A formula shared by several cells is given as its first cell writes it
 */

/**
 * Read a workbook's sheets.
 * @param {string} path
 * @returns {Sheet[]}
 */
export function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  const text = (name) => files.get(name)?.toString("utf8") ?? "";

  const shared = [];
  for ( const match of text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g) ) {
    shared.push(runs(match[1] ?? ""));
  }

  const targets = new Map();
  for ( const match of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g) ) {
    targets.set(attribute(match[0], "Id"), attribute(match[0], "Target"));
  }

  const sheets = [];
  for ( const match of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g) ) {
    const target = targets.get(attribute(match[0], "r:id")) ?? "";
    const file = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const rows = new Map();
    const formulas = new Map();
    const sharedFormulas = new Map();
    let lastRow = 0;
    for ( const row of text(file).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g) ) {
      const number = Number(attribute(row[1], "r"));
      const cells = new Map();
      for ( const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g) ) {
        const reference = attribute(cell[1], "r");
        const type = attribute(cell[1], "t");
        const body = cell[2] ?? "";
        const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];

        // A formula is kept beside the cell's text. The cells that share one name it by number, and only the
        // first of them writes it out
        const formula = body.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
        if ( formula ) {
          const group = attribute(formula[1], "si");
          let written = decode(formula[2] ?? "");
          if ( group !== undefined ) {
            if ( written ) sharedFormulas.set(group, written);
            else written = sharedFormulas.get(group) ?? "";
          }
          if ( written ) formulas.set(`${number}:${columnIndex(reference.match(/^[A-Z]+/)[0])}`, written);
        }
        let content = "";
        if ( type === "inlineStr" ) content = runs(body);
        else if ( value === undefined ) content = "";
        else if ( type === "s" ) content = shared[Number(value)] ?? "";
        else if ( type === "b" ) content = value === "1" ? "TRUE" : "FALSE";
        else content = decode(value);
        if ( content.trim() === "" ) continue;
        cells.set(columnIndex(reference.match(/^[A-Z]+/)[0]), content);
      }
      if ( cells.size ) {
        rows.set(number, cells);
        lastRow = Math.max(lastRow, number);
      }
    }
    const index = (column) => typeof column === "string" ? columnIndex(column) : column;
    sheets.push({
      name: decode(attribute(match[0], "name") ?? ""),
      hidden: ["hidden", "veryHidden"].includes(attribute(match[0], "state")),
      rows,
      lastRow,
      cell: (row, column) => (rows.get(row)?.get(index(column)) ?? "").trim(),
      filled: (row) => [...(rows.get(row) ?? [])].sort((a, b) => a[0] - b[0]).map(([column, value]) => {
        return { column, text: value.trim() };
      }),
      formula: (row, column) => formulas.get(`${row}:${index(column)}`) ?? ""
    });
  }
  return sheets;
}

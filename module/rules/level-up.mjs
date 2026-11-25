/**
 * The Level Up splash, for Fire Emblem Online: what it shows of a level up, the line its unit says, and what a
 * client takes of one that another client sends. Pure functions of plain data, so that they can be tested
 * outside of Foundry. How it looks and moves is `apps/level-up-splash.mjs`.
 *
 * @import {GrowthResult} from "./progression.mjs"
 */
import { FEO } from "../config.mjs";

/**
 * @typedef SplashRow
 * One stat on the splash.
 * @property {string} key       The stat
 * @property {number} value     What it stood at before the level up
 * @property {number} gain      Points gained
 * @property {0|1|2} pass       When the gain is shown: with the growth rolls (1), with those a skill had rolled
 *                              again (2), or never, for a stat that did not rise (0)
 * @property {boolean} capped   Was the stat at its cap?
 */

/**
 * The stats a level up shows, in the order they were rolled.
 * @param {(GrowthResult & {reroll?: {skill: string, first: number}})[]} results    The growth rolls, after any
 *                                          that were rolled again; or the points placed by hand, in their shape
 * @param {Record<string, number>} values   What each stat stood at before the level up
 * @returns {SplashRow[]}
 */
export function splashRows(results, values) {
  return (results ?? []).map((result) => {
    const gain = Math.max(Math.trunc(result.gain) || 0, 0);
    return {
      key: result.key,
      value: Math.trunc(values?.[result.key]) || 0,
      gain,
      pass: !gain ? 0 : (result.reroll ? 2 : 1),
      capped: !!result.capped
    };
  });
}

/* -------------------------------------------- */

/**
 * How many stats a level up raised.
 * @param {{gain: number}[]} rows
 * @returns {number}
 */
export function raisedCount(rows) {
  return (rows ?? []).filter((row) => row.gain > 0).length;
}

/* -------------------------------------------- */

/**
 * How a level up went, by how many stats it raised.
 * @param {number} raised
 * @param {{great: number, fair: number}} [thresholds]    FEO.levelUp.lines
 * @returns {"great"|"fair"|"poor"}
 */
export function levelMood(raised, thresholds = FEO.levelUp.lines) {
  if ( raised >= thresholds.great ) return "great";
  if ( raised >= thresholds.fair ) return "fair";
  return "poor";
}

/* -------------------------------------------- */

/**
 * The line a unit says as it levels up. A unit that has none written for how the level went says nothing.
 * @param {Partial<Record<"great"|"fair"|"poor", string>>|null} lines     The lines written on its sheet
 * @param {number} raised                   How many stats rose
 * @param {{great: number, fair: number}} [thresholds]
 * @returns {string}
 */
export function splashLine(lines, raised, thresholds = FEO.levelUp.lines) {
  return String(lines?.[levelMood(raised, thresholds)] ?? "").trim();
}

/* -------------------------------------------- */

/**
 * Where each stat stands on the board: the first has a row of its own, and the others stand under it in two
 * columns, read down the left and then down the right.
 * @param {number} count    How many stats there are
 * @returns {{column: 1|2, row: number}[]}      One for each, from 1
 */
export function rowPlaces(count) {
  const left = Math.ceil((count - 1) / 2);
  return Array.from({ length: Math.max(count, 0) }, (unused, index) => {
    if ( index === 0 ) return { column: 1, row: 1 };
    const under = index - 1;
    return (under < left) ? { column: 1, row: under + 2 } : { column: 2, row: under - left + 2 };
  });
}

/* -------------------------------------------- */

/**
 * Does a level wait for a unit: has it the experience of one, and is it under its level limit?
 * @param {{exp?: number, atMaxLevel?: boolean}|null} unit    The unit's data
 * @param {number} [perLevel]     FEO.expPerLevel
 * @returns {boolean}
 */
export function levelWaits(unit, perLevel = FEO.expPerLevel) {
  return !!unit && !unit.atMaxLevel && (Number(unit.exp) >= perLevel);
}

/* -------------------------------------------- */

/**
 * Who levels a unit up as it does so by itself: the level up is rolled, and shown, on one client only, and every
 * client names the same one. A unit that is someone's is theirs to level: the user whose character it is before
 * a player who owns it, among those at the table. While none of them is, it waits for one to join. A unit that
 * is nobody's is levelled by the Game Master who runs the table.
 * @param {{id: string, active?: boolean, gm?: boolean, owner?: boolean, character?: boolean}[]} users
 *                                    Every user of the world: is it at the table, is it a Game Master, does it
 *                                    own the unit, and is the unit the character it chose?
 * @param {string|null} [activeGM]    The Game Master who runs the table, where one does
 * @returns {string|null}             The id of that user, or null where the level up waits
 */
export function levelsUnit(users, activeGM = null) {
  const theirs = (users ?? []).filter((user) => user.character || (!user.gm && user.owner));
  if ( !theirs.length ) return activeGM ?? null;
  const here = theirs.filter((user) => user.active).sort((a, b) => {
    return (Number(!!b.character) - Number(!!a.character)) || String(a.id).localeCompare(String(b.id));
  });
  return here[0]?.id ?? null;
}

/* -------------------------------------------- */

/**
 * Read a splash another client sent: only what a splash is made of is kept, cut to size, and one that names no
 * unit or shows no stat is none at all.
 * @param {*} sent
 * @param {{rows: number, chips: number, text: number}} [most]    FEO.levelUp.most
 * @returns {object|null}     The splash, as `apps/level-up-splash.mjs` plays it
 */
export function readSplash(sent, most = FEO.levelUp.most) {
  if ( !sent || (typeof sent !== "object") ) return null;
  const text = (value) => ((typeof value === "string") || (typeof value === "number")) ? String(value).slice(0, most.text) : "";
  const whole = (value, least = 0, top = 9999) => Math.min(Math.max(Math.trunc(Number(value)) || 0, least), top);
  const rows = (Array.isArray(sent.rows) ? sent.rows : []).slice(0, most.rows).map((row) => ({
    key: text(row?.key),
    label: text(row?.label),
    value: whole(row?.value),
    gain: whole(row?.gain, 0, 99),
    pass: whole(row?.pass, 0, 2),
    capped: !!row?.capped,
    tip: text(row?.tip)
  })).filter((row) => row.label);
  const name = text(sent.name);
  if ( !name || !rows.length ) return null;
  const said = (sent.text && (typeof sent.text === "object")) ? sent.text : {};
  return {
    army: ((typeof sent.army === "string") && Object.hasOwn(FEO.armies, sent.army)) ? sent.army : "other",
    name,
    className: text(sent.className),
    img: (typeof sent.img === "string") ? sent.img.slice(0, 500) : "",
    from: whole(sent.from),
    to: whole(sent.to),
    text: Object.fromEntries(["title", "skip", "auto", "next", "atCap"].map((key) => [key, text(said[key])])),
    rows,
    skill: text(sent.skill),
    chips: (Array.isArray(sent.chips) ? sent.chips : []).slice(0, most.chips)
      .map((chip) => ({ label: text(chip?.label), value: text(chip?.value), tip: text(chip?.tip) }))
      .filter((chip) => chip.label || chip.value),
    line: text(sent.line)
  };
}

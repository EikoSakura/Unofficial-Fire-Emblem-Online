#!/usr/bin/env node
/**
 * Builds the class compendium (packs/classes) from the Class Sheet, with any hand-kept classes in
 * packs-src/classes laid over it.
 *
 * Usage:
 *   node tools/build-classes.mjs [--foundry <path>] [--json <file>] [--check] [--out <folder>] [--quiet]
 *                                [--hidden <tab>]
 *
 *   --foundry <path>   Foundry's "resources/app" folder, which provides the LevelDB library, the document classes
 *                      used to validate, and the bundled icons. Defaults to the FOUNDRY_APP environment variable,
 *                      then to the standard install location.
 *   --json <file>      Also write the built Items as one JSON file, for inspection.
 *   --check            Build, validate and report, but do not write the compendium.
 *   --out <folder>     Write the compendium to this folder instead of packs/classes.
 *   --quiet            Print only the totals and the problems.
 *   --hidden <tab>     Also read a hidden tab of the Class Sheet, such as "FE3H Classes". Hidden tabs are left
 *                      out unless named here.
 *
 * Close the world before building: Foundry keeps the compendium open while a world is running.
 *
 * The Class Sheet. Every visible tab is read; tools/lib/class-sheet.mjs says how a tab is laid out and read.
 * Tabs and their headings become folders. A class's "Promotes to" names are linked to the classes they mean,
 * and the skills it names are checked against the Skills tab of the Reference Sheet, taking that tab's spelling.
 *
 * Hand-kept classes. Each file in packs-src/classes holds one group of classes in the format below. A class
 * there replaces the one the Class Sheet gives for the same cell, and a class at a cell the sheet does not have
 * is added. The report says where a hand-kept class differs from the sheet.
 *
 *   {
 *     "source": "Fire Emblem Online Class Sheet, Beorc tab, rows 2 to 30",
 *     "classes": [
 *       {
 *         "name": "Archer",
 *         "cell": "Beorc!A2",                where the class block starts, to tell apart classes that share a name
 *         "tier": "base",                    trainee, base, second, third or heaven
 *         "race": "beorc",                   beorc, laguz, manakete, taguel or monster
 *         "description": "...",
 *         "base": { "hp": 17, ... },         a starting class: its stats; leave a stat out where the sheet gives no number
 *         "gains": { "hp": 2, ... },         a promoted class: its gains; a dash on the sheet is 0
 *         "wt": 0,                           Class Weight, as the sheet lists it
 *         "transformed": { "mov": 9 },       optional: the second, starred number of a stat
 *         "caps": { "str": 30 },             optional: stat caps
 *         "proficiencies": { "options": ["bow"], "choose": 0, "note": "Bow" },
 *         "skills": { "starting": "Observant", "promotion": "", "occult": "", "mastery": "" },
 *         "specialQualities": "",
 *         "promotesTo": ["Ranger", "Sniper", "Bowgunner"],
 *         "notes": [{ "label": "Starting Shift Gauge", "value": "0" }]     optional: other lines of the block
 *       }
 *     ]
 *   }
 *
 * `proficiencies.options` lists the proficiencies the class gives, `choose` how many of them a unit takes (0 for
 * all) and `note` the line as the sheet words it. A class whose one higher proficiency starts at other than D Rank
 * ("All Weapons, with 1 at C rank") adds `"firstRank": "C"`. A class of the first tier may give `gains` in place of `base`:
 * it is one a Trainee promotes into.
 *
 * A class's image comes from assets/icons/classes when a file there is named after it (see the README in
 * assets/icons), and otherwise from the icons that ship with Foundry.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, Report, findFoundry, flag, loadFoundry, makeFolder, manifest, oneLine, option, paragraphs, slugify,
  stableId, stats, uuidOf, validate, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";
import { readClassSheet, sameClass } from "./lib/class-sheet.mjs";
import { readSkillNames } from "./lib/skills-sheet.mjs";

if ( flag("--help") ) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}

const SOURCE = join(ROOT, "packs-src", "classes");
const PACK = "classes";

const app = findFoundry();
const foundry = await loadFoundry(app);
const { FEO } = foundry;
const report = new Report("Classes compendium");
const problems = [];
const fail = (message) => problems.push(message);

const STATS = FEO.classStats;
const SKILLS = ["starting", "promotion", "occult", "mastery"];
const order = (tier) => FEO.classTiers[tier]?.order ?? 0;

/* -------------------------------------------- */
/*  Read the Class Sheet                        */
/* -------------------------------------------- */

const read = readClassSheet({ hidden: option("--hidden") ? [option("--hidden")] : [] });
problems.push(...read.problems);
for ( const line of read.skipped ) report.count("Left out", line);
for ( const [kind, examples] of read.oddities ) {
  for ( const example of examples ) report.count("Values read with care", kind, example.length > 90 ? `${example.slice(0, 90)}…` : example);
}

/**
 * @type {{entry: object, source: string, id: string, handKept: boolean}[]}
 */
const classes = read.classes.map((entry) => ({
  entry,
  source: `Class Sheet, ${entry.tab} tab, row ${entry.row}`,
  id: stableId(PACK, `${entry.cell}.${entry.name}`),
  handKept: false
}));

/* -------------------------------------------- */
/*  Lay the hand-kept classes over it           */
/* -------------------------------------------- */

const COMPARED = ["name", "tier", "race", "description", "base", "gains", "wt", "transformed", "caps", "proficiencies",
  "skills", "specialQualities", "promotesTo", "notes"];

/**
 * A value in a form that compares equal however its keys are ordered and whether or not empty parts are given.
 * @param {*} value
 * @returns {string}
 */
function comparable(value) {
  if ( Array.isArray(value) ) return JSON.stringify(value.map((item) => JSON.parse(comparable(item) ?? "null")));
  if ( value && (typeof value === "object") ) {
    const entries = Object.entries(value).filter(([, item]) => (item !== "") && (item !== undefined) && (item !== null));
    return JSON.stringify(Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, JSON.parse(comparable(item) ?? "null")])));
  }
  return JSON.stringify(value ?? null);
}
const emptyValue = (value) => ["null", "{}", "[]", '""'].includes(comparable(value));

const files = existsSync(SOURCE) ? readdirSync(SOURCE).filter((name) => name.endsWith(".json")).sort() : [];
for ( const file of files ) {
  let group;
  try {
    group = JSON.parse(readFileSync(join(SOURCE, file), "utf8"));
  } catch ( error ) {
    fail(`${file}: not valid JSON (${error.message})`);
    continue;
  }
  if ( !Array.isArray(group.classes) || !group.classes.length ) {
    fail(`${file}: no classes found`);
    continue;
  }
  for ( const kept of group.classes ) {
    const where = `${file}: ${kept.name ?? "(unnamed)"}`;
    if ( !kept.name ) fail(`${where}: a class needs a name`);
    if ( !kept.cell ) {
      fail(`${where}: "cell" is missing; it says where on the Class Sheet the class is`);
      continue;
    }
    const id = stableId(PACK, `${kept.cell}.${kept.name}`);
    const [tab, reference = ""] = kept.cell.split("!");
    const place = /^([A-Z]+)(\d+)$/.exec(reference);
    const sheetEntry = classes.find((other) => other.entry.cell === kept.cell);
    const entry = {
      tab,
      row: place ? Number(place[2]) : 0,
      column: 0,
      folder: sheetEntry?.entry.folder ?? [tab],
      kind: kept.gains ? "gains" : "base",
      remarks: sheetEntry?.entry.remarks ?? [],
      ...kept
    };
    if ( sheetEntry ) {
      const differences = COMPARED.filter((key) => {
        if ( emptyValue(kept[key]) && emptyValue(sheetEntry.entry[key]) ) return false;
        return comparable(kept[key]) !== comparable(sheetEntry.entry[key]);
      });
      if ( differences.length ) {
        report.add("Hand-kept classes", `${kept.cell} ${kept.name} (${file}) differs from the Class Sheet in: ${differences.join(", ")}. The hand-kept one is used.`);
      } else {
        report.count("Hand-kept classes", `the same as the Class Sheet gives (${file})`);
      }
      Object.assign(sheetEntry, { entry, source: group.source ?? sheetEntry.source, id, handKept: true });
    } else {
      report.add("Hand-kept classes", `${kept.cell} ${kept.name} (${file}) is not on the Class Sheet and was added.`);
      if ( classes.some((other) => other.id === id) ) fail(`${where}: defined twice (same name and cell)`);
      classes.push({ entry, source: group.source ?? "", id, handKept: true });
    }
  }
}

/* -------------------------------------------- */
/*  Check each class                            */
/* -------------------------------------------- */

for ( const { entry } of classes ) {
  const where = `${entry.cell} ${entry.name}`;
  if ( !(entry.tier in FEO.classTiers) ) fail(`${where}: unknown tier "${entry.tier}"`);
  if ( !(entry.race in FEO.races) ) fail(`${where}: unknown race "${entry.race}"`);
  for ( const part of ["base", "gains", "caps"] ) {
    for ( const [key, value] of Object.entries(entry[part] ?? {}) ) {
      if ( !STATS.includes(key) ) fail(`${where}: "${part}" has an unknown stat "${key}"`);
      if ( !Number.isInteger(value) ) fail(`${where}: "${part}.${key}" must be a whole number`);
    }
  }
  for ( const [key, value] of Object.entries(entry.transformed ?? {}) ) {
    if ( !STATS.includes(key) && (key !== "wt") ) fail(`${where}: "transformed" has an unknown stat "${key}"`);
    if ( !Number.isInteger(value) ) fail(`${where}: "transformed.${key}" must be a whole number`);
  }
  if ( !Number.isInteger(entry.wt) ) fail(`${where}: "wt" must be a whole number`);
  const starting = order(entry.tier) <= FEO.classTiers.base.order;
  if ( !entry.base && !entry.gains ) fail(`${where}: needs "base" stats or "gains"`);
  if ( (entry.tier === "trainee") && !entry.base ) fail(`${where}: a Trainee class needs "base" stats`);
  if ( !starting && !entry.gains ) fail(`${where}: a promoted class needs "gains"`);
  for ( const key of entry.proficiencies?.options ?? [] ) {
    if ( !(key in FEO.proficiencies) ) fail(`${where}: unknown proficiency "${key}"`);
  }
  const firstRank = entry.proficiencies?.firstRank;
  if ( firstRank && !(firstRank in FEO.ranks) ) fail(`${where}: unknown rank "${firstRank}" for "firstRank"`);
  if ( firstRank ) report.count("Values read with care", "a proficiency that starts at other than the usual rank", `${where}: ${firstRank} Rank`);
  for ( const key of Object.keys(entry.skills ?? {}) ) {
    if ( !SKILLS.includes(key) ) fail(`${where}: unknown skill slot "${key}"`);
  }
}
const ids = new Map();
for ( const { entry, id } of classes ) {
  if ( ids.has(id) ) fail(`${entry.cell} ${entry.name}: defined twice (same name and cell)`);
  ids.set(id, entry.name);
}

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

const skillNames = readSkillNames();

/**
 * How many single-letter changes turn one word into another.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (unused, index) => index);
  for ( let i = 1; i <= a.length; i++ ) {
    let previous = row[0];
    row[0] = i;
    for ( let j = 1; j <= b.length; j++ ) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = above;
    }
  }
  return row[b.length];
}

/**
 * Find the skill a class means by a name.
 * @param {string} name
 * @returns {{name: string, exact: boolean}|null}
 */
function findSkill(name) {
  const wanted = name.toLowerCase();
  if ( skillNames.has(wanted) ) return { name: skillNames.get(wanted)[0].name, exact: skillNames.get(wanted)[0].name === name };
  if ( wanted.length < 6 ) return null;
  const close = [...skillNames.keys()].filter((key) => (Math.abs(key.length - wanted.length) <= 2) && (distance(key, wanted) <= 2));
  return close.length === 1 ? { name: skillNames.get(close[0])[0].name, exact: false } : null;
}

/**
 * Check the skills a class names against the Skills tab, taking that tab's spelling.
 * @param {object} entry        The class
 * @param {string} slot         Which of its skills
 * @returns {string}            The line with each name as the Skills tab spells it
 */
function resolveSkills(entry, slot) {
  const text = oneLine(entry.skills?.[slot] ?? "");
  if ( !text ) return "";
  const where = `${entry.name} (${entry.cell})`;
  const whole = findSkill(text);
  if ( whole?.exact ) {
    report.count("Skills", "names that match a skill of the Skills tab");
    if ( text.includes(",") ) report.count("Skills", "a skill whose own name has commas, which the class rules read as one name", `${where}: ${text}`);
    return whole.name;
  }
  const parts = text.split(/(\s*,\s*|\s+or\s+)/i);
  const names = parts.filter((part, index) => index % 2 === 0);
  if ( names.length > 1 && /\s+or\s+/i.test(text) ) {
    report.count("Skills", "a choice between skills, which the unit picks from when it learns the skill", `${where}: ${text}`);
  }
  return parts.map((part, index) => {
    if ( index % 2 ) return part;
    const found = findSkill(part);
    if ( !found ) {
      report.count("Skills", "names that match no skill of the Skills tab", `${where}: ${part}`);
      return part;
    }
    if ( found.name === part ) report.count("Skills", "names that match a skill of the Skills tab");
    else report.count("Skills", "names spelled differently on the two sheets; the Skills tab's spelling is used", `${where}: "${part}" is "${found.name}"`);
    return found.name;
  }).join("");
}

/* -------------------------------------------- */
/*  Promotions                                  */
/* -------------------------------------------- */

/**
 * Link a class named in "Promotes to" to the classes it means: those of that name one tier up that a unit is
 * promoted into. Where the name is shared, a class on the same tab is preferred, then the nearest one below.
 * @param {object} entry    The class that promotes
 * @param {string} name     The class it promotes to
 * @returns {{name: string, uuid: string}[]}
 */
function promotion(entry, name) {
  const where = `${entry.name} (${entry.cell})`;
  let found = classes.filter(({ entry: other }) => {
    return sameClass(other.name, name) && (other.kind === "gains") && (order(other.tier) === order(entry.tier) + 1);
  });
  if ( !found.length && name.includes("/") ) {
    report.count("Promotions", "names that cover several classes, each linked", `${where} to ${name}`);
    return name.split("/").flatMap((part) => promotion(entry, part.trim()));
  }
  if ( !found.length ) {
    const elsewhere = classes.filter(({ entry: other }) => sameClass(other.name, name));
    const why = elsewhere.length
      ? `there is a ${name} but not one tier up to promote into (${elsewhere.map(({ entry: other }) => `${other.cell}, ${other.tier}`).join("; ")})`
      : "no class has that name";
    report.count("Promotions", "names left to be found by name when a unit promotes", `${where} to ${name}: ${why}`);
    return [{ name, uuid: "" }];
  }
  if ( found.some(({ entry: other }) => other.tab === entry.tab) ) found = found.filter(({ entry: other }) => other.tab === entry.tab);
  const distinct = new Set(found.map(({ entry: other }) => other.name));
  if ( (found.length > 1) && (distinct.size === 1) ) {
    const below = found.filter(({ entry: other }) => other.row > entry.row).sort((a, b) => a.entry.row - b.entry.row);
    const chosen = below[0] ?? found[0];
    report.count("Promotions", "names shared by several classes, linked to the nearest one below", `${where} to ${name} at ${chosen.entry.cell}`);
    found = [chosen];
  } else if ( found.length > 1 ) {
    report.count("Promotions", "names that cover several classes, each linked", `${where} to ${[...distinct].join(" and ")}`);
  }
  for ( const target of found ) {
    report.count("Promotions", "links made");
    if ( target.entry.name !== name ) report.count("Promotions", "links to a class whose block goes by a longer name", `${name} is ${target.entry.name}`);
  }
  return found.map((target) => ({ name: target.entry.name === name ? name : target.entry.name, uuid: uuidOf(PACK, target.id) }));
}

/* -------------------------------------------- */
/*  Images                                      */
/* -------------------------------------------- */

const library = new IconLibrary(app);
const picker = new IconPicker(library, PACK);
const from = (folder, pattern, except) => picker.from(folder, pattern, except);
const HEAD = "equipment/head";

/** Pools for what a class's name, Special Qualities and proficiencies say about it. The first match wins. */
const SHAPES = [
  [/manakete|dragon|wyvern|wyrm|nidhogg|drake/i, [...from("creatures/reptiles", /dragon|serpent/), ...from("creatures/abilities", /dragon/)]],
  [/heron|raven|hawk/i, from("creatures/birds", /corvid|raptor|songbird|dove/)],
  [/\bcat\b|tiger|\bwolf|taguel|fauskin|beaskin/i, [...from("creatures/mammals", /cat|wolf|fox|rabbit/), ...from("creatures/abilities", /cougar|wolf|lion|paw/)]],
  [/revenant|ghoul|entombed|goliath|tomblord|bonewalker|wight|wraith|lich|phantom|spect|undead|zombie|skeleton/i,
    [...from("magic/death", /^(undead|skeleton|skull-humanoid)/), ...from("creatures/magical", /spirit-undead/)]],
  [/mogall|gorgon|cyclops|gargoyle|demon|fiend|cantor|diabolist|monster|necro|\bterror\b/i,
    [...from("creatures/unholy"), ...from("creatures/magical", /gargoyle|golem|spirit-fear/), ...from("creatures/eyes")]],
  [/pegasus|falco|flier|sky|angel|seraph|griffon|valkyr|chanteuse|\bflying\b/i, [...from("creatures/abilities", /^wing/), ...from("magic/control", /buff-flight/)]],
  [/lord|king|emperor|baron|noble|prince|deity|master knight/i, [...from(HEAD, /^crown/), ...from("commodities/treasure", /^crown/)]],
  [/bard|dancer|skald|minstrel|songstress|troubadour/i, from("tools/instruments", /harp|lute|flute|horn-(red|white)|drum-hand/)],
  [/cleric|priest|bishop|monk|saint|vestal|chaplain|acolyte|friar|ezer|healer|templar|crusader|paladin/i,
    [...from("magic/holy"), ...from("magic/life", /^(cross|ankh)/)]],
  [/mage|magus|sage|wizard|sorcer|shaman|druid|warlock|witch|scholar|arcan|enchant|summoner|magier|occult|tactician|grandmaster|spellblade|dark knight/i,
    [...from(HEAD, /^hat-pointed/), ...from("sundries/books", /^book-(symbol|embossed|tooled)/)]],
  [/thief|rogue|assassin|outlaw|\bspy\b|trickster|ninja|burglar|whisper|shade|bandit|cutthroat/i, from(HEAD, /^(hood|mask-hood|mask-knit)/)],
  [/archer|sniper|ranger|hunter|huntress|marksman|ballist|bowgun|arbalest|horseman|nomad|warden|trooper|chasseur|tiratore|bersagliere|\bbow\b/i,
    [...from("skills/ranged", /person-archery|archery-bow|bow-arrows|arrows?-/), ...from("weapons/bows", /bow-(simple|recurve)|longbow-recurve$/)]],
  [/brigand|pirate|berserker|barbarian|buccaneer|raider|viking|corsair|marauder|boss|thug|brute|deserter/i,
    [...from(HEAD, /viking|horned|helm-norman|bandana|headwrap/), ...from("weapons/axes", /^axe-battle-(simple|worn)/)]],
  [/knight|general|armor|cavalier|guard|sentinel|marshal|hoplite|ritter|vanguard|picket|vedette|fortress|\barmored\b|\bmounted\b/i,
    from(HEAD, /^(helm-(barbute|sallet|bassinet|basinet|spangen|armored|plated|kettle)|greathelm)/)],
  [/fighter|warrior|hero|mercenary|myrmidon|swordmaster|soldier|lancer|halberdier|duelist|recruit|officer|pikeman|skirmisher|wrestler|grappler|brawler/i,
    [...from("skills/melee", /^(weapons-crossed|hand-grip|maneuver)/), ...from(HEAD, /^helm-(norman|spangen)/)]]
];
const POOL = [...from(HEAD, /^(cap-(simple|leather|steel)|helm-(norman|spangen)|hood-(cloth|simple))/), ...from("sundries/flags", /^banner-(standard|flag)/)];

/* -------------------------------------------- */
/*  Build the documents                         */
/* -------------------------------------------- */

const folders = [];
const folderIds = new Map();
const folderCounts = new Map();
for ( const { entry } of classes ) {
  for ( let depth = 1; depth <= entry.folder.length; depth++ ) {
    const path = entry.folder.slice(0, depth).join(" / ");
    if ( folderIds.has(path) ) continue;
    const notes = read.folders.find((folder) => folder.path.join(" / ") === path)?.notes ?? [];
    const folder = makeFolder(PACK, {
      key: path,
      name: entry.folder[depth - 1],
      parent: depth > 1 ? folderIds.get(entry.folder.slice(0, depth - 1).join(" / ")) : null,
      description: notes.map(paragraphs).join(""),
      order: folders.length + 1
    });
    folderIds.set(path, folder._id);
    folders.push(folder);
  }
  const path = entry.folder.join(" / ");
  folderCounts.set(path, (folderCounts.get(path) ?? 0) + 1);
}

const fill = (keys, values, empty) => Object.fromEntries(keys.map((key) => [key, values?.[key] ?? empty]));
const names = new Map();
for ( const { entry } of classes ) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);

const documents = classes.map(({ entry, source, id }, index) => {
  const about = `${entry.name} | ${entry.specialQualities ?? ""} | ${entry.proficiencies?.note ?? ""}`;
  const slug = slugify(entry.name);
  const shared = names.get(entry.name) > 1;
  if ( shared ) report.count("Values read with care", "a name used by more than one class; the folder tells them apart", `${entry.name} (${entry.cell})`);
  const img = picker.pick({
    name: about,
    slugs: shared ? [`${slug}-${slugify(entry.cell.split("!")[1] ?? "")}`, slug] : [slug],
    group: entry.folder.join(" / "),
    shapes: SHAPES,
    pool: POOL,
    fallback: "icons/svg/item-bag.svg",
    materials: false
  });
  picker.listing.at(-1).name = entry.name;
  const description = [entry.description ? `<p>${entry.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : "",
    ...(entry.remarks ?? []).map(paragraphs)].join("");
  report.count("Classes of each tier", `${entry.tier}${entry.gains && order(entry.tier) <= 1 ? " (promoted into from a Trainee)" : ""}`);
  return {
    _id: id,
    name: entry.name,
    type: "class",
    img,
    system: {
      tier: entry.tier,
      race: entry.race,
      base: fill(STATS, entry.base, null),
      gains: fill(STATS, entry.gains, 0),
      wt: entry.wt,
      transformed: fill([...STATS, "wt"], entry.transformed, null),
      caps: fill(STATS, entry.caps, null),
      proficiencies: {
        options: entry.proficiencies?.options ?? [],
        choose: entry.proficiencies?.choose ?? 0,
        firstRank: entry.proficiencies?.firstRank ?? "",
        note: entry.proficiencies?.note ?? ""
      },
      skills: Object.fromEntries(SKILLS.map((slot) => [slot, resolveSkills(entry, slot)])),
      specialQualities: entry.specialQualities ?? "",
      promotesTo: (entry.promotesTo ?? []).flatMap((name) => promotion(entry, name)),
      notes: (entry.notes ?? []).map((note) => ({ label: String(note.label), value: String(note.value) })),
      description
    },
    effects: [],
    folder: folderIds.get(entry.folder.join(" / ")) ?? null,
    sort: (index + 1) * 100000,
    ownership: { default: 0 },
    flags: { [manifest.id]: { cell: entry.cell, source } },
    _stats: stats
  };
});

/* -------------------------------------------- */
/*  Check, report and write                     */
/* -------------------------------------------- */

problems.push(...validate(foundry, documents, folders, (path) => library.exists(path)));

report.add("Totals", `${documents.length} classes in ${folders.length} folders: ${read.classes.length} read from the Class Sheet, `
  + `${classes.filter((entry) => entry.handKept).length} of them hand-kept in packs-src/classes.`);
for ( const folder of folders ) {
  const path = [...folderIds].find(([, id]) => id === folder._id)[0];
  const inside = [...folderCounts].filter(([key]) => (key === path) || key.startsWith(`${path} / `)).reduce((sum, [, count]) => sum + count, 0);
  report.add("Classes in each folder", `${String(inside).padStart(5)}  ${path}${folder.description ? ", with a note in its description" : ""}`);
}
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every class and folder passed Foundry's own validation.");
report.print({ examples: 8 });

writeJson(documents, folders, { documentsOnly: true });
if ( problems.length ) {
  console.error("Nothing was written because of the problems above.");
  process.exit(1);
}
if ( !flag("--check") ) {
  if ( !flag("--out") ) picker.writeNames();
  console.log(`Built ${await writePack(app, PACK, documents, folders)}`);
}

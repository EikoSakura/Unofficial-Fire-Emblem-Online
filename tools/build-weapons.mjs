#!/usr/bin/env node
/**
 * Builds the weapon compendium (packs/weapons) from the "Weapons" tab of the Reference Sheet, with the weapons
 * of the Optional Content Sheet that packs-src/optional-content.json lists.
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
import {
  ROOT, Report, USAGE, findFoundry, flag, loadFoundry, makeFolder, manifest, paragraphs, slugify, stableId, stats, validate,
  writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";
import { TAB, readWeaponsTab, weaponName } from "./lib/weapons-sheet.mjs";

if ( flag("--help") ) {
  console.log(`Builds packs/weapons from the "Weapons" tab of the Reference Sheet.\n${USAGE}`);
  process.exit(0);
}

const PACK = "weapons";
const app = findFoundry();
const foundry = await loadFoundry(app);
const { FEO } = foundry;
const { parseRange } = await import(pathToFileURL(join(ROOT, "module", "rules", "combat.mjs")).href);
const report = new Report("Weapons compendium");

/* -------------------------------------------- */
/*  Read the tab                                */
/* -------------------------------------------- */

let read;
try {
  read = readWeaponsTab({ FEO, parseRange, report });
} catch(err) {
  console.error(err.message);
  process.exit(1);
}
const { sheet, sections, weapons, problems } = read;

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
  katana: { pool: from("weapons/swords", /katana/), shapes: [] },
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
  const flags = { row: weapon.row, source: `${weapon.source}, ${TAB} tab, row ${weapon.row}` };
  if ( sheetName ) flags.sheetName = sheetName;
  return {
    _id: stableId(PACK, `${category}.${name}${suffix ? `.${suffix}` : ""}`),
    name: weaponName(weapon),
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

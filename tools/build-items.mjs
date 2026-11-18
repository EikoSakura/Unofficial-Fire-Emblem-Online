#!/usr/bin/env node
/**
 * Builds the item compendium (packs/items) from the "Items" tab of the Reference Sheet.
 *
 * Usage:
 *   node tools/build-items.mjs [--foundry <path>] [--json <file>] [--check] [--out <folder>] [--quiet]
 *
 * The tab is read as it is laid out: a row with only its first cell filled is a heading when it is short and a
 * note when it is long. Headings become folders, a heading's words in brackets and the notes beneath it become
 * the folder's description, and every other row is an item. Each item keeps its Effect text exactly as the
 * sheet words it.
 *
 * How the sheet's ways of writing a value are read:
 *   Uses "3.0"             3 uses
 *   Uses "Equip"           an equipped item with no limit on its uses
 *   Uses "Equip/25"        an equipped item with 25 uses
 *   Uses "-", "N/A", "Infinite"   no limit, stored as 0 of 0
 *   Cost "600.0"           600; "N/A" is 0
 *
 * A Shield (an item of the "Shields" section) has what its Effect says of blocking read into fields: its Block
 * chance and what DEX adds to it, what it blocks and by how much, the Weight it adds as Attack Speed is worked
 * out, the uses a block costs it, and its chance to parry (see module/rules/blocking.mjs). What else its Effect
 * says stays in the text, and is listed in the report.
 *
 * An item's image comes from assets/icons/items when a file there is named after it (see the README in
 * assets/icons), and otherwise from the icons that ship with Foundry.
 */

import { readShield } from "../module/rules/blocking.mjs";
import { readWorkbook } from "./lib/xlsx.mjs";
import {
  REFERENCE_SHEET, Report, USAGE, findFoundry, flag, isBlank, loadFoundry, makeFolder, manifest, oneLine,
  paragraphs, slugify, stableId, stats, validate, wholeNumber, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";

if ( flag("--help") ) {
  console.log(`Builds packs/items from the "Items" tab of the Reference Sheet.\n${USAGE}`);
  process.exit(0);
}

const PACK = "items";
const TAB = "Items";
const COLUMNS = { name: 0, effect: 1, uses: 6, cost: 7 };
const TITLES = { name: "Name", effect: "Effect", uses: "Uses", cost: "Cost" };

const app = findFoundry();
const foundry = await loadFoundry(app);
const report = new Report("Items compendium");
const problems = [];

/* -------------------------------------------- */
/*  Read the tab                                */
/* -------------------------------------------- */

const sheet = readWorkbook(REFERENCE_SHEET).find((candidate) => candidate.name === TAB);
if ( !sheet ) {
  console.error(`The Reference Sheet has no "${TAB}" tab.`);
  process.exit(1);
}
for ( const [key, column] of Object.entries(COLUMNS) ) {
  if ( oneLine(sheet.cell(1, column)) !== TITLES[key] ) {
    problems.push(`Row 1: column ${column + 1} should be "${TITLES[key]}" but is "${oneLine(sheet.cell(1, column))}"`);
  }
}

/** @type {{key: string, name: string, notes: string[], count: number}[]} */
const sections = [];
const items = [];
let section = null;

for ( let row = 2; row <= sheet.lastRow; row++ ) {
  const cells = sheet.filled(row);
  if ( !cells.length ) continue;
  const first = oneLine(sheet.cell(row, 0));

  if ( (cells.length === 1) && (cells[0].column === 0) ) {
    const bracketed = /^([^()]{1,40}?)\s*\((.+)\)$/.exec(first);
    if ( bracketed ) {
      section = { key: bracketed[1], name: bracketed[1], notes: [bracketed[2]], count: 0 };
      sections.push(section);
      report.count("Rows that are not items", "section headings, made into folders");
    } else if ( (first.length <= 40) && !first.endsWith(".") ) {
      section = { key: first, name: first, notes: [], count: 0 };
      sections.push(section);
      report.count("Rows that are not items", "section headings, made into folders");
    } else if ( section ) {
      section.notes.push(sheet.cell(row, 0));
      report.count("Rows that are not items", "notes, kept as the description of their folder", `row ${row}`);
    } else {
      problems.push(`Row ${row}: a note comes before any section heading`);
    }
    continue;
  }
  if ( !section ) {
    problems.push(`Row ${row}: "${first}" comes before any section heading`);
    continue;
  }

  const name = first;
  const where = `row ${row} ${name}`;
  const effect = /^n\/?a$/i.test(sheet.cell(row, COLUMNS.effect)) ? "" : sheet.cell(row, COLUMNS.effect);
  if ( !name ) {
    problems.push(`Row ${row}: has no name`);
    continue;
  }
  const stray = cells.filter(({ column }) => !Object.values(COLUMNS).includes(column));
  if ( stray.length ) problems.push(`${where}: has cells outside the Name, Effect, Uses and Cost columns`);

  // Uses
  const usesText = sheet.cell(row, COLUMNS.uses);
  let uses = wholeNumber(usesText);
  let equip = false;
  const equipped = /^equip(?:\s*\/\s*(\d+))?$/i.exec(usesText);
  if ( equipped ) {
    equip = true;
    uses = equipped[1] ? Number(equipped[1]) : 0;
    report.count("Values read with care", equipped[1]
      ? 'Uses "Equip/N": an equipped item with N uses'
      : 'Uses "Equip": an equipped item with no limit on its uses');
  } else if ( uses === null ) {
    if ( isBlank(usesText) || /^infinite$/i.test(usesText) ) {
      uses = 0;
      report.count("Values read with care", `Uses "${usesText}", stored as no limit`, name);
    } else {
      problems.push(`${where}: cannot read the Uses "${usesText}"`);
    }
  }

  // Cost
  const costText = sheet.cell(row, COLUMNS.cost);
  let cost = wholeNumber(costText);
  if ( cost === null ) {
    if ( isBlank(costText) ) {
      cost = 0;
      report.count("Values read with care", `Cost "${costText}", stored as 0`, name);
    } else {
      problems.push(`${where}: cannot read the Cost "${costText}"`);
    }
  }

  // HP restored to the user, where the Effect says so in as many words
  let restore = 0;
  const restores = /(?:^|\.\s+)Restores (\d+) HP\.(?=\s|$)/.exec(effect);
  if ( restores ) {
    restore = Number(restores[1]);
    const alone = effect.trim() === restores[0].trim();
    report.count("Automation", alone
      ? 'HP Restored filled from an Effect that is exactly "Restores N HP."'
      : 'HP Restored filled from an Effect that begins "Restores N HP." and goes on', alone ? undefined : name);
  } else if ( /restores?\b.*\bHP\b/i.test(effect) ) {
    report.count("Left as text", "healing that is not a plain number of HP for the user", name);
  }

  // A Shield: what its Effect says of blocking, read into fields. What it says beyond that stays text
  let shield = null;
  if ( /^shields$/i.test(section.name) ) {
    shield = readShield(effect);
    if ( !shield ) problems.push(`${where}: is listed among the Shields, but its Effect names no chance to block`);
    else {
      const summary = shield.blocks.map((rule) => {
        const about = [rule.kind, rule.range, rule.element, rule.notElement ? `not ${rule.notElement}` : "", rule.from ? `from ${rule.from}` : "",
          rule.weapon, rule.effective ? "effective" : ""].filter(Boolean).join(" ");
        const amount = rule.negate ? "all" : (rule.to !== undefined) ? `to ${rule.to}` : (rule.percent !== undefined) ? `${rule.percent}%` : rule.reduce;
        return `${about} ${amount}`;
      }).join("; ");
      report.add("Shields", `${name}: ${shield.chance}${shield.dexDiv ? ` + DEX/${shield.dexDiv}` : ""}; ${summary}; Weight ${shield.weight}`
        + `${shield.wearPhysical > 1 ? `; ${shield.wearPhysical} uses for a physical block` : ""}${shield.parry ? `; parry ${shield.parry.chance} + DEX/${shield.parry.dexDiv}` : ""}`);

      // What the Effect says beyond blocking, which the table still applies by hand
      const extra = /(?:when blocking|grants |cannot be forcibly|reflects|negates effectivity|prevents the death|unit gains|chance to damage themselves|to enemy when blocking)[^.]*\./i.exec(effect);
      if ( extra ) report.count("Left as text", "what a Shield does beyond blocking", name);
    }
  }

  section.count++;
  items.push({
    row, name, section,
    system: {
      effect,
      uses: { value: uses ?? 0, max: uses ?? 0 },
      cost: cost ?? 0,
      equip,
      restore,
      ...(shield ? { shield: { ...shield, parry: shield.parry ?? { chance: 0, dexDiv: 0, uses: 0 } } } : {}),
      description: ""
    }
  });

}

/* -------------------------------------------- */
/*  Images                                      */
/* -------------------------------------------- */

const library = new IconLibrary(app);
const picker = new IconPicker(library, PACK);
const from = (folder, pattern, except) => picker.from(folder, pattern, except);
const POTIONS = "consumables/potions";
const drinkable = from(POTIONS, /^(potion|bottle|flask|vial)/, /poison|skull|empty/);

/** Pools for names that say what the item looks like, whatever section it is in. The first match wins. */
const SHAPES = [
  [/\bkey\b/i, from("sundries/misc", /^key-/)],
  [/lockpick/i, [...from("tools/hand", /lockpicks/), ...from("skills/trades", /lockpicking/)]],
  [/\bring\b/i, from("equipment/finger", /^ring/)],
  [/\bband\b|bangle|armlet|bracelet|cuffs/i, from("equipment/wrist", /^(bracer|bracelet|wrap)/)],
  [/\bkit\b/i, [...from("tools/medical", /medkit/), ...from("tools/smithing", /hammer|tongs/)]],
  [/powder|dust|salts|shavings|incense/i, [...from("commodities/materials", /powder/), ...from("tools/laboratory", /powder/)]],
  [/water|\btears\b|\boil\b|grease|ooze|wax|\bpolish\b|resin|ointment/i, from(POTIONS, /jar|jug|bottle-round|vial/)],
  [/shield|guard\b|\bward\b|\bdhal\b/i, from("equipment/shield")],
  [/mirror/i, from("sundries/survival", /mirror/)],
  [/vulnerary/i, from(POTIONS, /^(potion|bottle)-.*-red$/)],
  [/elixir/i, from(POTIONS, /ornate|fancy|decorated/)],
  [/concoction/i, from(POTIONS, /bubbling|conical/)],
  [/venin|toxin|malice|bleeding serum/i, from(POTIONS, /poison|skull/)],
  [/wine|chardonnay|cabernet|sauvignon|liqueur|vintage port|muscat|shiraz|cream spirit|fire water|mead|laudanum|liquid courage/i,
    from("consumables/drinks", /wine|alcohol/)],
  [/\btea\b|coffee/i, from("consumables/drinks", /tea|coffee/)],
  [/tonic|potion|tincture|cordial|draught|philter|serum|ether|ichor|antitoxin|panacea|perfume/i, drinkable],
  [/bandage/i, from("tools/medical", /bandage/)],
  [/pastilles|painkillers|stimulant|sedative|antiplegic|bolus|medicine|pellets/i, from("tools/medical", /medication|pills/)],
  [/herb|grass|leaf|lily|blossom|clover|moss/i, from("consumables/plants", /herb|leaf|grass|sprout/)],
  [/fruit|pepper/i, from("consumables/fruit")],
  [/mushroom/i, from("consumables/mushrooms")],
  [/flesh|heart/i, from("consumables/meat", /steak|shank|ribs/)],
  [/prawn|jelly|spice/i, from("consumables/food")],
  [/needle/i, from("tools/hand", /needle/)],
  [/bomb|grenade|alchemist's fire/i, from("weapons/thrown", /^(bomb|grenade)-/, /tech|energy|timer|detonator|pressure/)],
  [/\bmine\b/i, from("weapons/ammunition", /explosive-mine/)],
  [/trap/i, from("environment/traps", /trap-jaw|spike|pressure|plated/)],
  [/\bcard\b/i, from("sundries/gaming", /card/)],
  [/dice/i, from("sundries/gaming", /dice/)],
  [/nails/i, from("tools/fasteners", /^nails?-/)],
  [/spiked ball/i, from("weapons/thrown", /ball-spiked/)],
  [/bolas/i, from("weapons/thrown", /bolas/)],
  [/\bhorn\b/i, from("commodities/bones", /^horn/)],
  [/lyre/i, from("tools/instruments", /harp|lute/)],
  [/lantern/i, from("sundries/lights", /lantern-(iron|steel|bullseye)/)],
  [/torch/i, from("sundries/lights", /torch/)],
  [/crown|circlet/i, [...from("equipment/head", /^crown-gold/), ...from("commodities/treasure", /^crown/)]],
  [/\bseal\b|contract|\bsign\b/i, from("sundries/documents", /sealed/)],
  [/scroll/i, from("sundries/scrolls", /^scroll-(bound|runed|rolled)/)],
  [/tome|book|manual/i, from("sundries/books", /^book-/, /mimic|notebook|notes/)],
  [/crest|medallion|memento|\bicon\b/i, from("commodities/treasure", /^(medal|brooch|token)/)],
  [/whip/i, from("weapons/misc", /whip/)],
  [/\bbolt\b/i, from("weapons/ammunition", /^arrow/)],
  [/talisman|charm|netsuke|amulet|pendant/i, from("equipment/neck", /^(amulet|pendant|necklace)/)],
  [/gloves?\b/i, from("equipment/hand", /^gloves?-/)],
  [/breastplate/i, from("equipment/chest", /^breastplate/)],
  [/robe/i, from("equipment/chest", /^robe/)],
  [/\bcane\b/i, from("weapons/staves", /^staff-simple/)],
  [/sphere/i, [...from("commodities/materials", /glass-orb/), ...from("commodities/gems", /^pearl/)]],
  [/pearl/i, from("commodities/gems", /^pearl/)],
  [/gem|ruby|diamond|scalestone|morphstone|repairstone|philosopher/i, from("commodities/gems", /^gem-(faceted|cut|rough)/)],
  [/stone|pebbles/i, [...from("commodities/stone", /^(stone|geode|rock)/), ...from("commodities/gems", /^gem-raw/)]],
  [/bullion/i, from("commodities/metal", /^ingot/)],
  [/coin/i, from("commodities/currency", /^coins?-/)],
  [/pouch/i, from("containers/bags", /^pouch/)],
  [/satchel/i, from("containers/bags", /^satchel/)],
  [/rucksack|pack\b|carryall|\bbag\b/i, from("containers/bags", /^(pack|sack)/)],
  [/soles|boots/i, from("equipment/feet", /^boots-(leather|simple)/)],
  [/wing/i, from("commodities/materials", /^feather/)],
  [/binoculars/i, from("tools/navigation", /spyglass/)],
  [/statue|goddess/i, from("commodities/treasure", /^(statue|figurine-goddess|figurine-idol)/)],
  [/laguzbane|sapper|smasher/i, from("commodities/gems", /shattered|fragment/)],
  [/drops?\b/i, from("commodities/materials", /^liquid/)]
];

/** The pool for each section's other items. A section not listed here uses the pool for "Misc. Items". */
const POOLS = {
  "Healing": drinkable,
  "Buffing Items": drinkable,
  "Combat Items": from("weapons/thrown", /^(bomb|grenade|throwing|bolas|ball)/, /tech|energy|timer|detonator|pressure/),
  "Keys": from("sundries/misc", /^key-/),
  "Promotion": [...from("commodities/treasure", /^(medal|token-gold|brooch-crown)/), ...from("sundries/documents", /sealed/)],
  "Laguz, Manakete, Taguel": from("commodities/gems", /^gem-(rough|raw)/),
  "Barter": [...from("commodities/gems", /^gem-faceted/), ...from("commodities/currency", /^coins-/)],
  "Accessories": [...from("equipment/neck", /^(amulet|pendant)/), ...from("commodities/treasure", /^(brooch|trinket)/)],
  "Storage": from("containers/bags", /^(pack|sack|satchel|pouch)/),
  "Shields": from("equipment/shield"),
  "Stat Boosters": [...from("commodities/treasure", /^(token|trinket|figurine)/), ...drinkable],
  "Misc. Items": [...from("sundries/misc", /^(admission|badge|horseshoe|hourglass)/), ...from("commodities/treasure", /^token/)]
};

/* -------------------------------------------- */
/*  Build the documents                         */
/* -------------------------------------------- */

const folders = [];
const folderIds = new Map();
sections.forEach((entry, index) => {
  const folder = makeFolder(PACK, {
    key: entry.key,
    name: entry.name,
    description: entry.notes.map(paragraphs).join(""),
    order: index + 1
  });
  folderIds.set(entry.key, folder._id);
  folders.push(folder);
  if ( !(entry.name in POOLS) ) report.add("Images", `The section "${entry.name}" has no pool of its own and uses the one for Misc. Items.`);
});

const seen = new Map();
for ( const item of items ) seen.set(item.name, (seen.get(item.name) ?? 0) + 1);
const sectionCounts = new Map();
for ( const item of items ) {
  const key = `${item.section.key}.${item.name}`;
  sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
}

const documents = items.map((item, index) => {
  const { name, section: place } = item;
  const slug = slugify(name);
  const shared = seen.get(name) > 1;
  const twice = sectionCounts.get(`${place.key}.${name}`) > 1;
  if ( shared ) report.count("Values read with care", "a name used by more than one item", `${name} (row ${item.row})`);
  const key = twice ? `${place.key}.${name}.row${item.row}` : shared ? `${place.key}.${name}` : name;
  const img = picker.pick({
    name,
    slugs: shared ? [`${slugify(place.name)}-${slug}`, slug] : [slug],
    group: place.name,
    shapes: SHAPES,
    pool: POOLS[place.name] ?? POOLS["Misc. Items"],
    fallback: "icons/svg/item-bag.svg"
  });
  return {
    _id: stableId(PACK, key),
    name,
    type: "gear",
    img,
    system: item.system,
    effects: [],
    folder: folderIds.get(place.key),
    sort: (index + 1) * 100000,
    ownership: { default: 0 },
    flags: { [manifest.id]: { row: item.row, source: `Reference Sheet, ${TAB} tab, row ${item.row}` } },
    _stats: stats
  };
});

/* -------------------------------------------- */
/*  Check, report and write                     */
/* -------------------------------------------- */

problems.push(...validate(foundry, documents, folders, (path) => library.exists(path)));

report.add("Totals", `${documents.length} items in ${folders.length} folders, from ${sheet.lastRow} rows of the ${TAB} tab.`);
for ( const entry of sections ) {
  const note = entry.notes.length ? `, ${entry.notes.length} note${entry.notes.length > 1 ? "s" : ""} in its description` : "";
  report.add("Items in each folder", `${String(entry.count).padStart(5)}  ${entry.name}${note}`);
}
report.count("Rows that are not items", "the header row");
const withEffect = documents.filter((document) => document.system.effect).length;
report.add("Automation", `Effect text kept word for word on ${withEffect} items; ${documents.length - withEffect} have none.`);
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every item and folder passed Foundry's own validation.");
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

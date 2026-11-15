#!/usr/bin/env node
/**
 * Builds the skill compendium (packs/skills) from the "Skills" tab of the Reference Sheet.
 *
 * Usage:
 *   node tools/build-skills.mjs [--foundry <path>] [--json <file>] [--check] [--out <folder>] [--quiet]
 *
 * The tab is read as it is laid out: a row with only its first cell filled is a heading when it is short and a
 * note when it is long. Headings become folders and set the kind of the skills beneath them, a heading's words in
 * brackets and the notes beneath it become the folder's description, and every other row is a skill. Each skill
 * keeps its Effect text exactly as the sheet words it.
 *
 * The markers after a skill's name are taken off the name and kept as fields, as the first rows of the tab
 * explain them: "*" choose when to activate, "**" cannot be put on a Skill Scroll, "***" both, "†" can be put on
 * a scroll but only learnt by units of the same base class, "×" cancelled in combat by Nihil.
 *
 * What is filled in from the Effect text, and only when the text leaves no doubt:
 *   an Effect that is nothing but a flat bonus, such as "+5 Hit" or "+2 RES", fills the skill's boosts;
 *   an Effect that begins with a chance such as "DEX%" or "DEX/2%" fills the skill's activation.
 *
 * What the system applies by itself for a skill is not read from the text. It is written out by hand in
 * packs-src/skills/effects.json, by skill name, in the notation that module/rules/skills.mjs explains, and
 * laid over the skills here, together with how a skill that is chosen when to activate is used (its `usage`,
 * which module/rules/skill-usage.mjs explains). A name in that file that no skill has, or an effect or usage
 * the rules do not know, stops the build.
 *
 * The animals listed under "Wildkin Animal Units" at the foot of the tab are not skills; they are added to the
 * description of the Wildkin skill, which points to them.
 *
 * A skill's image comes from assets/icons/skills when a file there is named after it (see the README in
 * assets/icons), and otherwise from the icons that ship with Foundry.
 */

import {
  Report, USAGE, encode, findFoundry, flag, isBlank, loadFoundry, makeFolder, manifest, oneLine, paragraphs,
  slugify, stableId, stats, validate, wholeNumber, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";
import { SKILLS_TAB, SKILL_COLUMNS, readSkillName, readSkillsTab } from "./lib/skills-sheet.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/pack.mjs";
import { checkEffects, choicesOf } from "../module/rules/skills.mjs";
import { checkUsage } from "../module/rules/skill-usage.mjs";

if ( flag("--help") ) {
  console.log(`Builds packs/skills from the "Skills" tab of the Reference Sheet.\n${USAGE}`);
  process.exit(0);
}

const PACK = "skills";

const app = findFoundry();
const foundry = await loadFoundry(app);
const { FEO } = foundry;
const report = new Report("Skills compendium");

const { sheet, sections, preamble, rows, extras, problems } = readSkillsTab();

/** The effects the system applies by itself, by skill name. */
const EFFECTS_FILE = join(ROOT, "packs-src", "skills", "effects.json");
const automation = existsSync(EFFECTS_FILE) ? (JSON.parse(readFileSync(EFFECTS_FILE, "utf8")).skills ?? {}) : {};
const automated = new Set();

/* -------------------------------------------- */
/*  Reading an Effect                           */
/* -------------------------------------------- */

/** The words the sheet uses for the boosts a skill can carry. */
const STAT_WORDS = {
  "str": "str", "mag": "mag", "def": "def", "res": "res", "dex": "dex", "spd": "spd", "luk": "luk", "mov": "mov",
  "con": "con", "los": "los", "line of sight": "los"
};
const COMBAT_WORDS = {
  "hit": "hit", "critical": "critical", "critical rate": "critical", "dodge": "dodge",
  "critical avoid": "critAvoid", "damage": "damage"
};

/**
 * Read an Effect that is nothing but one flat bonus, such as "+5 Hit" or "+2 RES".
 * @param {string} effect
 * @returns {{group: "stats"|"combat", key: string, value: number}|null}
 */
function flatBonus(effect) {
  const match = /^\+(\d+)\s+([A-Za-z ]+?)\.?$/.exec(effect.trim());
  if ( !match ) return null;
  const word = match[2].trim().toLowerCase();
  if ( word in STAT_WORDS ) return { group: "stats", key: STAT_WORDS[word], value: Number(match[1]) };
  if ( word in COMBAT_WORDS ) return { group: "combat", key: COMBAT_WORDS[word], value: Number(match[1]) };
  return null;
}

/**
 * Read the chance an Effect begins with, such as "DEX%" or "DEX/2%".
 * @param {string} effect
 * @returns {{stat: string, divisor: number}|{unread: string}|null}   `unread` is a chance the system has no
 *                                                                    way to store
 */
function leadingChance(effect) {
  const match = /^([A-Za-z]+)\s*(?:([/*])\s*(\d+(?:\.\d+)?))?\s*%/.exec(effect.trim());
  if ( !match ) return null;
  const stat = match[1].toLowerCase();
  const whole = !match[2] || ((match[2] === "/") && /^\d+$/.test(match[3]));
  if ( !(stat in FEO.activationStats) || !whole ) return { unread: match[0] };
  return { stat, divisor: match[3] ? Number(match[3]) : 1 };
}

/* -------------------------------------------- */
/*  Read the skills                             */
/* -------------------------------------------- */

for ( const { row, text } of preamble ) {
  report.count("Rows that are not skills", "notes above the first heading that explain the name markers", `row ${row}`);
  if ( !/^Note:/i.test(text) ) problems.push(`Row ${row}: a note above the first heading does not begin "Note:"`);
}

const skills = [];
for ( const { row, section } of rows ) {
  const cell = (key) => sheet.cell(row, SKILL_COLUMNS[key]);
  const read = readSkillName(cell("name"));
  const { name } = read;
  const where = `row ${row} ${name}`;
  if ( !name ) {
    problems.push(`Row ${row}: has no name`);
    continue;
  }
  if ( read.conflict ) problems.push(`${where}: its markers "${read.markers}" contradict each other`);
  if ( read.markers ) report.count("Name markers", `"${read.markers}"`);
  if ( sheet.filled(row).some(({ column }) => !Object.values(SKILL_COLUMNS).includes(column)) ) {
    problems.push(`${where}: has cells outside the Name, Effect, Prerequisite and Capacity Cost columns`);
  }

  const effect = /^n\/?a$/i.test(cell("effect")) ? "" : cell("effect");
  const prerequisite = isBlank(cell("prerequisite")) ? "" : oneLine(cell("prerequisite"));

  let capacity = wholeNumber(cell("capacity"));
  if ( capacity === null ) {
    capacity = 0;
    if ( isBlank(cell("capacity")) ) report.count("Values read with care", `Capacity Cost "${cell("capacity")}", stored as 0`);
    else report.count("Values read with care", "Capacity Cost that is not a number, stored as 0", `${name}: ${cell("capacity")}`);
  }

  const system = {
    kind: section.kind,
    equipped: true,
    effect,
    prerequisite,
    capacity,
    chosen: read.chosen,
    scroll: read.scroll,
    nihil: read.nihil,
    activation: { stat: "", divisor: 1 },
    stats: Object.fromEntries(Object.keys(FEO.stats).map((key) => [key, 0])),
    combat: Object.fromEntries(Object.keys(FEO.combatBoosts).map((key) => [key, 0])),
    effects: [],
    choice: "",
    automate: true,
    usage: { kind: "", cooldown: 0, lasts: 0, uses: 0, per: "" },
    state: { active: false, cooldown: 0, lasting: 0, used: 0 },
    description: ""
  };

  // What the system applies by itself, from the hand-written list
  const entry = automation[name];
  if ( entry ) {
    automated.add(name);
    const wrong = [...checkEffects(entry.effects), ...checkUsage(entry.usage)];
    if ( wrong.length ) problems.push(...wrong.map((problem) => `${where}: effects.json, ${problem}`));
    else {
      system.effects = entry.effects;
      if ( entry.usage ) {
        system.usage = { ...system.usage, ...entry.usage };
        report.count("Automation", `skills tracked as chosen when to activate: ${entry.usage.kind}`);
      }
      const variants = choicesOf(entry.effects).length;
      if ( entry.effects.length ) report.count("Automation", variants ? "effects applied by the system, once a variant is chosen" : "effects applied by the system");
      if ( entry.left ) report.count("Automation", "effects applied by the system with a part left to the table", `${name}: ${entry.left}`);
    }
  }

  const bonus = flatBonus(effect);
  if ( bonus ) {
    system[bonus.group][bonus.key] = bonus.value;
    report.count("Automation", `a flat bonus filled in as a ${bonus.group === "stats" ? "stat" : "combat"} boost`, `${name}: ${effect}`);
  } else if ( /^[+-]\d+\s+[A-Za-z ]+\.?$/.test(effect.trim()) ) {
    report.count("Left as text", "a flat bonus to something a skill has no boost for", `${name}: ${effect}`);
  }

  const chance = leadingChance(effect);
  if ( chance?.stat ) {
    system.activation = chance;
    report.count("Automation", "activation filled in from an Effect that begins with a chance");
    report.count("Activation chances", `${chance.stat.toUpperCase()}${chance.divisor > 1 ? `/${chance.divisor}` : ""}%`);
  } else if ( chance?.unread ) {
    report.count("Left as text", "a leading chance the activation fields cannot hold", `${name}: ${chance.unread}`);
  } else if ( /\b(STR|MAG|DEF|RES|DEX|SPD|LUK)\s*(\/\s*[\d.]+)?\s*%/.test(effect) ) {
    report.count("Left as text", "a chance that is only part of what the skill does", name);
  }

  section.count++;
  skills.push({ row, name, section, system, markers: read.markers });
}

/* -------------------------------------------- */
/*  The animals of the Wildkin skill            */
/* -------------------------------------------- */

for ( const section of sections.filter((entry) => entry.kind === null) ) {
  const table = extras.filter((entry) => entry.section === section);
  const target = skills.find((skill) => skill.name.toLowerCase() === section.name.split(" ")[0].toLowerCase());
  if ( !target ) {
    problems.push(`"${section.name}": found no skill named ${section.name.split(" ")[0]} to attach these rows to`);
    continue;
  }
  const lines = table.map(({ row }) => {
    const cells = sheet.filled(row).map(({ text }) => {
      const number = Number(text);
      const shown = (text !== "") && Number.isFinite(number)
        ? ((number > 0) && (number < 1) ? `${Math.round(number * 100)}%` : String(number))
        : oneLine(text);
      return shown;
    });
    return cells;
  });
  const [head, ...body] = lines;
  const html = [
    `<h3>${encode(section.name)}</h3>`,
    "<table>",
    `<thead><tr>${head.map((text) => `<th>${encode(text)}</th>`).join("")}</tr></thead>`,
    `<tbody>${body.map((cells) => `<tr>${cells.map((text) => `<td>${encode(text)}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>",
    section.notes.map(paragraphs).join("")
  ].join("");
  target.system.description = html;
  for ( let i = 0; i < table.length + section.notes.length; i++ ) {
    report.count("Rows that are not skills", `rows of "${section.name}", added to the description of ${target.name}`);
  }
  report.count("Values read with care", `fractions in "${section.name}" shown as percentages, as its note says they are`);
}

/* -------------------------------------------- */
/*  Images                                      */
/* -------------------------------------------- */

const library = new IconLibrary(app);
const picker = new IconPicker(library, PACK);
const from = (folder, pattern, except) => picker.from(folder, pattern, except);

/** Pools for names that say what the skill is about. The first match wins. */
const SHAPES = [
  [/shot|\bbow|arrow|archer|marksm|sniper|deadeye|hawkeye|quiver|volley/i, from("skills/ranged", /arrow|bow|archery/)],
  [/hit\b|accura|\baim|focus|precis|certain|sure/i, from("skills/targeting")],
  [/shield|guard|defen|\bward|barrier|aegis|pavise|rampart|armor|bulwark|fortress|bastion|wall|protect/i,
    [...from("magic/defensive", /^shield-barrier/), ...from("skills/melee", /^shield-block/)]],
  [/heal|renew|mend|recover|\bcure|balm|\bsol\b|lifetaker|live to serve|amaterasu|medic|triage/i, from("magic/life", /^(heart|cross)/)],
  [/fire|blaze|burn|flame|arson|pyro|ember|inferno|scorch/i, from("magic/fire", /^flame-burning/)],
  [/thunder|shock|lightning|\bbolt|storm|static/i, from("magic/lightning", /^bolt-(strike|forked)/)],
  [/wind|gale|squall|billow|breeze|jetstream|vortex|whirlwind/i, from("magic/air", /^wind-/)],
  [/\bice\b|frost|freez|chill|cold|glaci/i, from("magic/water", /ice|snow/)],
  [/water|tide|\bflow|wave|drown|damp/i, from("magic/water", /water|wave/)],
  [/earth|quake|stone|tremor|mountain/i, from("magic/earth", /^(projectile|strike|barrier)-/)],
  [/poison|venom|toxi|infect|plague|malaise/i, [...from("skills/toxins"), ...from("magic/acid", /^dissolve/)]],
  [/bleed|blood|wound|maim|rend\b|gore/i, from("skills/wounds", /blood|injury/)],
  [/dragon|wyrm|wyvern|scale/i, from("creatures/abilities", /dragon/)],
  [/beast|wolf|claw|fang|roar|howl|feral|primal|pounce|savage|tiger|cat\b|pack hunter|untamed|predator/i,
    from("creatures/abilities", /wolf|cougar|bear|lion|paw|fang|mouth-teeth/)],
  [/\bwing|flight|fly|flier|soar|sky|pegasus|aerial|air superiority/i, [...from("creatures/abilities", /^wing/), ...from("magic/control", /buff-flight/)]],
  [/dark|shadow|curse|\bhex|doom|death|grim|vengeance|nihil|demon|fiend|terror|undead|necro|eclipse|night|bane\b/i,
    from("magic/unholy", /^(orb|hand|silhouette|strike)/)],
  [/light|holy|bless|divine|miracle|grace|faith|pray|saint|sacred|heaven|angel|righteous|aureola|dawn|sun|star/i,
    [...from("magic/holy"), ...from("magic/light", /^(explosion-star|beam-rays)/)]],
  [/luck|fortun|bargain|gold|plunder|pillage|despoil|greed|rich|profit|haggle|merchant/i,
    [...from("magic/control", /luck/), ...from("skills/social", /trading/), ...from("commodities/currency", /^coins-(plain|assorted)/)]],
  [/thief|steal|pick|lock|pass\b|stealth|sneak|hide|assassin|lethal|silent|shade/i,
    [...from("skills/social", /theft/), ...from("skills/trades", /security/), ...from("magic/nature", /stealth/), ...from("magic/perception", /stealth/)]],
  [/charm|rally|inspir|lead|authority|command|charisma|lord|noble|tactic|pomp|lineage|altesse|advisor|general/i,
    [...from("skills/social", /diplomacy|intimidation|peace/), ...from("sundries/flags", /banner-(standard|symbol)/)]],
  [/song|sing|danc|refresh|galdr|verse|music|melody|perform|bard|dirge|reverberate|lullaby/i,
    [...from("skills/trades", /music/), ...from("tools/instruments", /harp|lute|flute/)]],
  [/eye|sight|vision|observ|watch|scout|vigil|perce|seer|insight|foresight|glare/i, from("magic/perception", /eye/)],
  [/wrath|fury|rage|berserk|\bire\b|anger|frenzy|reckless|brutal|ruthless|cruel/i, from("magic/control", /fear-fright/)],
  [/time|quick|haste|speed|swift|fleet|rush|dash|celerity|galeforce|alacrity/i,
    [...from("magic/time"), ...from("magic/movement", /trail|acceleration/), ...from("skills/movement", /feet-winged|figure-running/)]],
  [/dodge|avoid|evasi|nimble|canto|move|foot|acrobat|step|shove|smite|swap|reposition|pivot|mountaineer|privateer|sojourner|trample|charge/i,
    from("skills/movement")],
  [/critical|crit\b|vital|killer|slayer|execut|lethality/i, from("skills/melee", /^(strike-blade|blade-tip|blood-slash)/)],
  [/axe|chop|cleave|hew/i, from("skills/melee", /strike-axe/)],
  [/lance|spear|pierce|impale|thrust|skewer/i, from("skills/melee", /spear|polearm/)],
  [/sword|blade|slash|duel|parry|riposte|fenc|\bcut\b|edge|astra|luna|aether/i, from("skills/melee", /sword|swords|blade/)],
  [/fist|punch|brawl|unarmed|grappl|wrestl|knuckle|pummel/i, from("skills/melee", /unarmed|hand-grip/)],
  [/staff|stave|magic|mage|spell|tome|arcan|sorcer|mana|anima|wizard|sage|mystic|rune/i,
    [...from("magic/symbols", /^(runes?|star|circle)/), ...from("sundries/books", /^book-symbol/)]],
  [/blow|strike|smash|assault|aggressor|adept|barrage|attack|combat|battle|warrior|fighter|vantage|pursuit|desperation/i,
    from("skills/melee", /^(strike|weapons-crossed|maneuver)/)]
];

/** The pool for each kind of skill. */
const POOLS = {
  generic: [...from("skills/melee", /^(weapons-crossed|hand-grip|strike-weapons|maneuver)/), ...from("skills/social"), ...from("skills/targeting")],
  class: [...from("skills/melee", /^(hand-grip|weapons-crossed|sword-shield|maneuver)/), ...from("skills/trades", /academics|smithing|construction/)],
  promotion: [...from("magic/control", /^buff-/), ...from("magic/defensive", /^shield-barrier/)],
  occult: [...from("magic/symbols", /^(runes?|triangle|circle|star)/), ...from("magic/perception", /^(third-eye|orb)/)],
  mastery: [...from("magic/light", /^explosion-star/), ...from("magic/symbols", /^(star|cog|fleur)/)],
  misc: from("sundries/scrolls", /^scroll-(bound|runed|symbol)/),
  monster: [...from("creatures/abilities", /mouth|stinger|tail|fang/), ...from("creatures/unholy")],
  enemy: [...from("magic/death", /^skull-/), ...from("magic/control", /^debuff-chains/)]
};

/* -------------------------------------------- */
/*  Build the documents                         */
/* -------------------------------------------- */

const folders = [];
const folderIds = new Map();
sections.filter((entry) => entry.kind !== null).forEach((entry, index) => {
  const folder = makeFolder(PACK, {
    key: entry.key,
    name: entry.name,
    description: entry.notes.map(paragraphs).join(""),
    order: index + 1
  });
  folderIds.set(entry.key, folder._id);
  folders.push(folder);
});

const seen = new Map();
for ( const skill of skills ) seen.set(skill.name.toLowerCase(), (seen.get(skill.name.toLowerCase()) ?? 0) + 1);
const perKind = new Map();
for ( const skill of skills ) {
  const key = `${skill.system.kind}.${skill.name.toLowerCase()}`;
  perKind.set(key, (perKind.get(key) ?? 0) + 1);
}

const documents = skills.map((skill, index) => {
  const { name, section: place, system } = skill;
  const slug = slugify(name);
  const shared = seen.get(name.toLowerCase()) > 1;
  const twice = perKind.get(`${system.kind}.${name.toLowerCase()}`) > 1;
  if ( shared ) {
    report.count("Values read with care", "a name used by more than one skill",
      `${name} (row ${skill.row}, ${place.name}${system.prerequisite ? `, ${system.prerequisite}` : ""})`);
  }
  const key = twice ? `${system.kind}.${name}.row${skill.row}` : shared ? `${system.kind}.${name}` : name;
  const img = picker.pick({
    name,
    slugs: shared ? [`${system.kind}-${slug}`, slug] : [slug],
    group: place.name,
    shapes: SHAPES,
    pool: POOLS[system.kind],
    fallback: "icons/svg/aura.svg",
    materials: false
  });
  const flags = { row: skill.row, source: `Reference Sheet, ${SKILLS_TAB} tab, row ${skill.row}` };
  if ( skill.markers ) flags.markers = skill.markers;
  return {
    _id: stableId(PACK, key),
    name,
    type: "skill",
    img,
    system,
    effects: [],
    folder: folderIds.get(place.key),
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

for ( const name of Object.keys(automation) ) {
  if ( !automated.has(name) ) problems.push(`effects.json lists "${name}", which is not the name of any skill`);
}

report.add("Totals", `${documents.length} skills in ${folders.length} folders, from ${sheet.lastRow} rows of the ${SKILLS_TAB} tab.`);
for ( const entry of sections ) {
  if ( entry.kind === null ) continue;
  const note = entry.notes.length ? `, ${entry.notes.length} note${entry.notes.length > 1 ? "s" : ""} in its description` : "";
  report.add("Skills in each folder", `${String(entry.count).padStart(5)}  ${entry.name} (kind: ${entry.kind})${note}`);
  report.count("Rows that are not skills", "section headings, made into folders");
}
report.count("Rows that are not skills", "the header row");
const count = (test) => documents.filter(test).length;
report.add("Name markers", `${count((d) => d.system.chosen)} skills are Choose when to activate, ${count((d) => d.system.nihil)} are cancelled by Nihil, `
  + `${count((d) => d.system.scroll === "none")} cannot be put on a scroll and ${count((d) => d.system.scroll === "sameClass")} only for the same base class.`);
const withEffect = count((document) => document.system.effect);
report.add("Automation", `Effect text kept word for word on ${withEffect} skills; ${documents.length - withEffect} have none.`);
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every skill and folder passed Foundry's own validation.");
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

#!/usr/bin/env node
/**
 * Builds the skill compendium (packs/skills) from the "Skills" tab of the Reference Sheet.
 *
 * Usage:
 *   node tools/build-skills.mjs [--foundry <path>] [--json <file>] [--check] [--status [file]] [--out <folder>]
 *                               [--quiet]
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
 * which module/rules/skill-usage.mjs explains). Skills of different kinds that share a name are listed there as
 * "kind.Name", which is read before the name alone. A name in that file that no skill has, or an effect or
 * usage the rules do not know, stops the build. So does a skill with an Effect that has neither effects, nor a
 * flat bonus read from its text, nor a usage, nor a `note` that says why it needs none.
 *
 * A listed skill can carry two lines of text beside its effects. `left` says what the table still does by hand,
 * and `note` says how the system reads the skill where its Effect leaves room, or how it is used, with nothing
 * left to do. From them each skill is given a state, which it carries as `system.coverage` together with both
 * lines, and which the Compendium shows as a small mark:
 *   done        the system applies the whole Effect: a listed skill without a `left`, a skill whose Effect is
 *               nothing but a flat bonus, or a skill without an Effect;
 *   part        a listed skill with a `left`;
 *   text only   a skill with an Effect that is neither listed nor a flat bonus.
 * --status prints the scoreboard: every skill with its state, folder by folder, with the totals of each folder
 * and of them all (with --quiet, the totals alone). Given a file, it also writes there, as JSON, the totals, the
 * folders, and the list of skills with their name, kind, folder, state, `left` and `note`. It goes together
 * with --check.
 *
 * The animals listed under "Wildkin Animal Units" at the foot of the tab are not skills; they are added to the
 * description of the Wildkin skill, which points to them.
 *
 * A skill that lends its unit a weapon, or has it attack with one, names that weapon as the Weapons tab does
 * (see module/rules/lending.mjs). The build looks each up on that tab and writes its numbers into the skill, so
 * that no number of a weapon is written by hand. The weapons that skills name are also kept, with those
 * numbers, in packs-src/skills/lent-weapons.json, which the tests read: the build writes that file anew
 * whenever it has changed, with --check too. It is not edited by hand.
 *
 * A skill that brings a creature onto the map (see module/rules/creatures.mjs) names the weapon it hands it as
 * the Weapons tab does, and the build stops where that tab has no such weapon. A creature that is picked from a
 * table lists its options in effects.json; where the tab has a table under the skill's name, as Wildkin has,
 * the build compares the two and stops where they differ.
 *
 * A skill's image comes from assets/icons/skills when a file there is named after it (see the README in
 * assets/icons), and otherwise from the icons that ship with Foundry.
 */

import {
  Report, USAGE, encode, findFoundry, flag, isBlank, loadFoundry, makeFolder, manifest, oneLine, option, paragraphs,
  slugify, stableId, stats, validate, wholeNumber, writeJson, writePack
} from "./lib/pack.mjs";
import { IconLibrary, IconPicker } from "./lib/icons.mjs";
import { SKILLS_TAB, SKILL_COLUMNS, readSkillName, readSkillsTab } from "./lib/skills-sheet.mjs";
import { TAB as WEAPONS_TAB, readWeaponsTab, weaponName } from "./lib/weapons-sheet.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ROOT } from "./lib/pack.mjs";
import { checkEffects, choicesOf, coverageOf, unaccounted } from "../module/rules/skills.mjs";
import { checkPicks } from "../module/rules/picks.mjs";
import { checkUsage } from "../module/rules/skill-usage.mjs";
import { armData, withArms } from "../module/rules/lending.mjs";
import { checkTable, makesIn, makesWeapons } from "../module/rules/creatures.mjs";
import { parseRange } from "../module/rules/combat.mjs";

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

/**
 * The weapons a skill may name, as the Weapons tab has them: read only once a skill names one. A weapon is
 * known by the name it has in the compendium, which for one that shares its name is that name with its rank.
 */
const LENT_FILE = join(ROOT, "packs-src", "skills", "lent-weapons.json");
let arsenal = null;
const lent = { weapons: {}, tomes: {} };
const weaponsOf = () => {
  if ( arsenal ) return arsenal;
  const read = readWeaponsTab({ FEO, parseRange });
  arsenal = read.weapons.map((weapon) => armData(weaponName(weapon), weapon.system));
  return arsenal;
};
const weaponLookup = {
  named: (name) => {
    const arm = weaponsOf().find((weapon) => weapon.name === name) ?? null;
    if ( arm ) lent.weapons[name] = arm;
    return arm;
  },
  tomes: ({ category, range }) => {
    const arms = weaponsOf().filter((weapon) => (weapon.category === category) && ((range === undefined) || (weapon.range === range)));
    lent.tomes[`${category}|${range ?? ""}`] = arms.map((arm) => arm.name);
    for ( const arm of arms ) lent.weapons[arm.name] = arm;
    return arms;
  }
};

/** What an entry of that list may hold beside its effects. */
const ENTRY_KEYS = ["effects", "usage", "picks", "left", "note"];

/**
 * Check the lines of text of an entry of that list, and that it holds nothing the build does not read.
 * @param {object} entry
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
function checkEntry(entry) {
  const wrong = [];
  for ( const key of Object.keys(entry) ) {
    if ( !ENTRY_KEYS.includes(key) ) wrong.push(`an entry cannot say "${key}"`);
  }
  for ( const key of ["left", "note"] ) {
    if ( (entry[key] !== undefined) && ((typeof entry[key] !== "string") || !entry[key].trim()) ) {
      wrong.push(`"${key}" is a line of text, and is left out when there is nothing to say`);
    }
  }
  return wrong;
}

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

  // A note pinned to the Effect is part of it: the lists an Effect says are "listed in notes"
  const pinned = sheet.note(row, SKILL_COLUMNS.effect);
  if ( pinned ) report.count("Values read with care", "a note pinned to an Effect, added to it", name);
  const written = /^n\/?a$/i.test(cell("effect")) ? "" : cell("effect");
  const effect = [written, pinned].filter(Boolean).join("\n\n");
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
    picks: [],
    raises: 0,
    automate: true,
    coverage: { state: "", left: "", note: "" },
    usage: { kind: "", cooldown: 0, lasts: 0, uses: 0, per: "" },
    state: { active: false, cooldown: 0, lasting: 0, used: 0 },
    description: ""
  };

  // What the system applies by itself, from the hand-written list. Skills of different kinds that share a
  // name are told apart there by their kind
  const listed = [`${section.kind}.${name}`, name].find((key) => key in automation);
  const entry = listed ? automation[listed] : null;
  if ( entry ) {
    automated.add(listed);
    const wrong = [...checkEffects(entry.effects), ...checkUsage(entry.usage), ...checkPicks(entry.picks, entry.effects), ...checkEntry(entry)];

    // The weapons its effects name are looked up on the Weapons tab, and their numbers written in
    const names = JSON.stringify(entry.effects ?? []);
    const armed = (!wrong.length && (names.includes('"lend"') || names.includes('"weapon":"') || names.includes('"weapon": "')))
      ? withArms(entry.effects, weaponLookup) : { effects: entry.effects, problems: [] };
    // The weapons a creature it makes is handed are on that tab as they are named
    for ( const makes of wrong.length ? [] : makesIn(entry.effects) ) {
      const { named, ranked } = makesWeapons(makes);
      const listed = new Set(weaponsOf().map((weapon) => weapon.name.toLowerCase()));
      for ( const weapon of named ) if ( !listed.has(weapon.toLowerCase()) ) wrong.push(`the ${WEAPONS_TAB} tab has no weapon named ${weapon}`);
      for ( const weapon of ranked ) if ( !listed.has(`${weapon} (E)`.toLowerCase()) ) wrong.push(`the ${WEAPONS_TAB} tab has no weapon named ${weapon} (E)`);
      if ( named.length || ranked.length ) report.count("Automation", `skills that hand a creature a weapon of the ${WEAPONS_TAB} tab`, name);

      // And the picture it is given is one that ships with Foundry
      for ( const img of [makes.img, ...(makes.options ?? []).map((option) => option.img)].filter(Boolean) ) {
        if ( !existsSync(join(app, "public", img)) ) wrong.push(`found no picture ${img} among those that ship with Foundry`);
      }
    }
    if ( armed.effects !== entry.effects ) report.count("Automation", `skills that name weapons of the ${WEAPONS_TAB} tab, with their numbers written in`, name);
    wrong.push(...armed.problems);
    if ( wrong.length ) problems.push(...wrong.map((problem) => `${where}: effects.json, ${problem}`));
    else {
      system.effects = armed.effects;
      system.picks = entry.picks ?? [];
      system.coverage.left = entry.left ?? "";
      system.coverage.note = entry.note ?? "";
      if ( entry.usage ) {
        system.usage = { ...system.usage, ...entry.usage };
        report.count("Automation", `skills tracked as chosen when to activate: ${entry.usage.kind}`);
      }
      const variants = choicesOf(entry.effects).length;
      if ( entry.picks ) report.count("Automation", "skills that say what their unit picks as they are learnt", name);
      if ( entry.effects.length ) report.count("Automation", variants ? "effects applied by the system, once a variant is chosen" : "effects applied by the system");
      if ( entry.left ) report.count("Automation", "effects applied by the system with a part left to the table", `${name}: ${entry.left}`);
      if ( entry.note ) report.count("Automation", "skills with a note on how the system reads them", `${name}: ${entry.note}`);
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

  // How far the system applies the Effect by itself
  system.coverage.state = coverageOf({ effect, listed: !!entry, left: system.coverage.left, boost: !!bonus });

  // A skill with an Effect has something behind it, or says why not: nothing is done by being listed alone
  if ( unaccounted({ effect, effects: system.effects, boost: !!bonus, usage: system.usage.kind, note: system.coverage.note, left: system.coverage.left }) ) {
    problems.push(`${where}: has an Effect and neither effects, nor a flat bonus, nor a usage, nor a note in effects.json saying why`);
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

  // The options the skill lists for the creature it makes are those rows
  for ( const makes of makesIn(target.system.effects).filter((entry) => entry.body === "table") ) {
    for ( const problem of checkTable(makes.options, head, body) ) problems.push(`"${section.name}": effects.json, ${target.name}: ${problem}`);
    report.count("Automation", `options of a creature checked against "${section.name}"`, target.name);
  }
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

// The weapons that skills name, kept with their numbers for the tests: written anew whenever it has changed
const sorted = (table) => Object.fromEntries(Object.keys(table).sort().map((key) => [key, table[key]]));
const lentText = `${JSON.stringify({
  note: "Written by tools/build-skills.mjs from the Weapons tab of the Reference Sheet: the weapons that skills in effects.json name, with their numbers. Do not edit by hand.",
  weapons: sorted(lent.weapons),
  tomes: sorted(lent.tomes)
}, null, 1)}\n`;
if ( !problems.length && (!existsSync(LENT_FILE) || (readFileSync(LENT_FILE, "utf8") !== lentText)) ) {
  writeFileSync(LENT_FILE, lentText);
  report.add("Automation", `Wrote ${Object.keys(lent.weapons).length} weapons that skills name to packs-src/skills/lent-weapons.json.`);
}
const count = (test) => documents.filter(test).length;
report.add("Name markers", `${count((d) => d.system.chosen)} skills are Choose when to activate, ${count((d) => d.system.nihil)} are cancelled by Nihil, `
  + `${count((d) => d.system.scroll === "none")} cannot be put on a scroll and ${count((d) => d.system.scroll === "sameClass")} only for the same base class.`);
const withEffect = count((document) => document.system.effect);
report.add("Automation", `Effect text kept word for word on ${withEffect} skills; ${documents.length - withEffect} have none.`);
for ( const line of picker.summary() ) report.add("Images", line);
if ( problems.length ) for ( const problem of problems ) report.add(`Problems (${problems.length})`, problem);
else report.add("Problems", "None. Every skill and folder passed Foundry's own validation.");
report.print();

/* -------------------------------------------- */
/*  The scoreboard                              */
/* -------------------------------------------- */

if ( flag("--status") ) {
  const WORDS = { done: "done", part: "part", text: "text only" };
  const tally = (rows) => Object.fromEntries(Object.keys(WORDS).map((state) => [state, rows.filter((row) => row.state === state).length]));
  const line = (counts) => Object.keys(WORDS).map((state) => `${counts[state]} ${WORDS[state]}`).join(", ");
  const boards = sections.filter((entry) => entry.kind !== null).map((entry) => {
    const rows = skills.filter((skill) => skill.section === entry).map(({ name, system }) => ({
      name, kind: system.kind, folder: entry.name, state: system.coverage.state, left: system.coverage.left, note: system.coverage.note
    }));
    return { name: entry.name, kind: entry.kind, skills: rows.length, ...tally(rows), rows };
  });
  const all = boards.flatMap((board) => board.rows);
  const totals = { skills: all.length, ...tally(all) };

  console.log("Scoreboard\n==========");
  for ( const board of boards ) {
    console.log(`\n${board.name}: ${board.skills} skills, ${line(board)}`);
    if ( !flag("--quiet") ) for ( const row of board.rows ) console.log(`  ${WORDS[row.state].padEnd(9)}  ${row.name}`);
  }
  console.log(`\nAll skills: ${totals.skills} skills, ${line(totals)}\n`);

  const path = option("--status");
  if ( path && !path.startsWith("--") ) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(resolve(path), JSON.stringify({
      totals,
      folders: boards.map(({ rows, ...board }) => board),
      skills: all
    }, null, 1));
    console.log(`Wrote ${resolve(path)}`);
  }
}

writeJson(documents, folders);
if ( problems.length ) {
  console.error("Nothing was written because of the problems above.");
  process.exit(1);
}
if ( !flag("--check") ) {
  if ( !flag("--out") ) picker.writeNames();
  console.log(`Built ${await writePack(app, PACK, documents, folders)}`);
}

import { FEO } from "../config.mjs";
import { ICONS } from "../helpers/icons.mjs";
import { TREE, layoutClassTree, lightClassTree, sameClassName } from "../rules/class-tree.mjs";
import { splitNames } from "../rules/classes.mjs";

/**
 * Display data for the Compendium: the class tree and its class sheet, the roll of skills and its skill sheet,
 * and the armoury.
 *
 * Nothing here touches Foundry, so that it can be exercised outside of it. Documents are first read into plain
 * entries, the entries are gathered into a library, and each part of the window is built from the library.
 * Where text has to be put together, it is localized through whatever `i18n` is passed in.
 *
 * @import {Localizer} from "../helpers/exchange-context.mjs"
 * @import {ClassTree} from "../rules/class-tree.mjs"
 */

/* -------------------------------------------- */
/*  Tables                                      */
/* -------------------------------------------- */

const BASE = FEO.classTiers.base.order;

/** The icon of each proficiency, drawn as the charge of a crest. */
const PROFICIENCY_ICONS = {
  sword: "sword", lance: "lance", axe: "axe", bow: "bow", knife: "knife", brawl: "fist", fire: "flame",
  thunder: "bolt", wind: "wind", water: "drop", earth: "peak", light: "sun", dark: "moon", staff: "staff"
};

/** The proficiencies that are magic. A class that may choose among many of one sort is drawn with one icon. */
const MAGIC = new Set(["fire", "thunder", "wind", "water", "earth", "light", "dark", "staff"]);

/** The icon of a Special Quality, for a class that lists no proficiency. */
const QUALITY_ICONS = {
  flying: "wing", mounted: "horseshoe", armored: "shield", beast: "paw", dragon: "claw", laguz: "claw",
  ballistician: "target", terror: "moon"
};

/** The dye of a line's cloth, from the first proficiency of the class the line is named after. */
export const PROFICIENCY_DYES = {
  sword: "crimson", lance: "blue", axe: "amber", bow: "green", knife: "plum", brawl: "umber", fire: "violet",
  thunder: "violet", wind: "violet", water: "violet", earth: "violet", light: "teal", dark: "indigo",
  staff: "teal"
};
export const RACE_DYES = { laguz: "umber", manakete: "indigo", taguel: "green", monster: "plum" };

/** The icon of each weapon category in the armoury. */
export const CATEGORY_ICONS = {
  fire: "flame", thunder: "bolt", wind: "wind", water: "drop", ice: "snow", earth: "peak", light: "sun",
  dark: "moon"
};

/** The icon of a group of items, told by its name. */
export const GEAR_ICONS = [
  [/heal/i, "flask"], [/key/i, "key"], [/promot/i, "crown"], [/shield/i, "shield"], [/stat/i, "up"],
  [/accessor/i, "ring"], [/combat/i, "burst"], [/barter/i, "coin"], [/storage/i, "hammer"]
];

/** The icon of each kind of skill. */
export const KIND_ICONS = {
  generic: "spark", class: "shield", promotion: "up", occult: "scroll", mastery: "crown", misc: "ring",
  monster: "claw", enemy: "flame"
};

/** The icon of each skill a class lists, by where it is kept. */
export const SLOT_ICONS = { starting: "spark", promotion: "up", occult: "scroll", mastery: "crown" };
export const SLOT_LABELS = {
  starting: "FEO.Class.skill.starting",
  promotion: "FEO.Class.skill.promotion",
  occult: "FEO.Class.skill.occult",
  mastery: "FEO.Class.skill.mastery"
};

/** The shield of a crest, plainer for the lower tiers. */
const SHIELDS = [
  "M6 7h36v20c0 11-7 18-18 23C13 45 6 38 6 27V7z",
  "M5 6h38v22c0 11-7.5 18.5-19 24C12.5 46.5 5 39 5 28V6z",
  "M5 8c4 0 7-1.5 9.5-4 2.5 2 6 3 9.5 3s7-1 9.5-3c2.5 2.5 5.5 4 9.5 4v20c0 11-7.5 18.5-19 24C12.5 46.5 5 39 5 28V8z",
  "M4 9c4.5 0 8-2 10.5-5 2.5 2 6 3.2 9.5 3.2S31 6 33.5 4c2.5 3 6 5 10.5 5-1.5 3-1.5 6 0 9v10c0 11-8 18.5-20 24C12 46.5 4 39 4 28V18c1.5-3 1.5-6 0-9z"
];

/* -------------------------------------------- */
/*  Small Things                                */
/* -------------------------------------------- */

const fold = (text) => String(text ?? "").trim().toLowerCase();
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const number = (value) => Number(value).toLocaleString("en-US");

/** A number with its sign, using a true minus. */
const signed = (value) => (value >= 0 ? `+${value}` : String(value).replace("-", "−"));

/**
 * The text of a piece of HTML, as one line.
 * @param {string} html
 * @returns {string}
 */
export function plainText(html) {
  return String(html ?? "").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

/**
 * An icon as inline SVG markup. Unlike `iconHtml`, a name the set does not have draws nothing.
 * @param {string} name
 * @returns {string}
 */
export function icon(name) {
  const body = ICONS[name];
  return body ? `<svg class="feo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>` : "";
}

/* -------------------------------------------- */
/*  Reading Documents                           */
/* -------------------------------------------- */

/**
 * @typedef {object} FolderInfo
 * @property {string} id
 * @property {string} name
 * @property {string} note        Its description, as text
 * @property {number} index       Its place among the folders, reading the tree of folders from the top
 */

/**
 * Put the folders of a compendium in the order they are read in: each folder, then the folders inside it.
 * @param {{id: string, name: string, description?: string, sort?: number, parent?: string|null}[]} folders
 * @returns {Map<string, FolderInfo>}
 */
export function orderFolders(folders) {
  const ordered = new Map();
  const walk = (parent) => {
    const children = folders.filter((folder) => (folder.parent ?? null) === parent)
      .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name));
    for ( const folder of children ) {
      ordered.set(folder.id, { id: folder.id, name: folder.name, note: plainText(folder.description), index: ordered.size });
      walk(folder.id);
    }
  };
  walk(null);
  return ordered;
}

/** What every entry keeps of its document. `doc` is a Document or its plain data. */
function readCommon(doc, folders) {
  const folderId = (typeof doc.folder === "string") ? doc.folder : (doc.folder?.id ?? null);
  return {
    id: doc._id ?? doc.id,
    uuid: doc.uuid ?? null,
    name: doc.name,
    img: doc.img,
    folder: folders?.get(folderId) ?? null,
    sort: doc.sort ?? 0
  };
}

/**
 * Read a class.
 * @param {object} doc                          An Item of type "class", or its plain data
 * @param {Map<string, FolderInfo>} [folders]
 * @returns {object}
 */
export function readClass(doc, folders) {
  const system = doc.system;
  const tier = FEO.classTiers[system.tier] ?? FEO.classTiers.base;
  const pick = (object) => Object.fromEntries(FEO.classStats.map((key) => [key, object?.[key] ?? null]));
  return {
    ...readCommon(doc, folders),
    tier: system.tier,
    order: tier.order,
    race: system.race,
    base: pick(system.base),
    gains: pick(system.gains),
    wt: system.wt ?? 0,
    transformed: { ...pick(system.transformed), wt: system.transformed?.wt ?? null },
    proficiencies: {
      options: [...(system.proficiencies?.options ?? [])],
      choose: system.proficiencies?.choose ?? 0,
      note: system.proficiencies?.note ?? ""
    },
    skills: { ...system.skills },
    qualities: splitNames(system.specialQualities),
    promotesTo: (system.promotesTo ?? []).map((target) => ({
      name: target.name,
      id: target.uuid ? target.uuid.split(".").pop() : null
    })),
    notes: (system.notes ?? []).map((note) => ({ label: note.label, value: note.value })),
    description: plainText(system.description)
  };
}

/**
 * Read a skill.
 * @param {object} doc
 * @param {Map<string, FolderInfo>} [folders]
 * @returns {object}
 */
export function readSkill(doc, folders) {
  const system = doc.system;
  return {
    ...readCommon(doc, folders),
    kind: system.kind,
    effect: system.effect ?? "",
    prerequisite: system.prerequisite ?? "",
    capacity: system.capacity ?? 0,
    chosen: !!system.chosen,
    scroll: system.scroll ?? "any",
    nihil: !!system.nihil
  };
}

/**
 * Read a weapon.
 * @param {object} doc
 * @param {Map<string, FolderInfo>} [folders]
 * @returns {object}
 */
export function readWeapon(doc, folders) {
  const system = doc.system;
  return {
    ...readCommon(doc, folders),
    category: system.category,
    might: system.might,
    hit: system.hit,
    crit: system.crit,
    range: system.range,
    weight: system.weight,
    uses: system.uses?.max ?? 0,
    rank: system.rank,
    level: system.level ?? null,
    cost: system.cost ?? 0,
    counter: { ...system.counter },
    effect: system.effect ?? ""
  };
}

/**
 * Read a carried item.
 * @param {object} doc
 * @param {Map<string, FolderInfo>} [folders]
 * @returns {object}
 */
export function readGear(doc, folders) {
  const system = doc.system;
  return {
    ...readCommon(doc, folders),
    effect: system.effect ?? "",
    uses: system.uses?.max ?? 0,
    equip: !!system.equip,
    cost: system.cost ?? 0
  };
}

/* -------------------------------------------- */
/*  The Library                                 */
/* -------------------------------------------- */

/** Entries in the order their compendium lists them: folder by folder, then as each folder sorts them. */
function inOrder(entries) {
  const place = (entry) => entry.folder?.index ?? Number.MAX_SAFE_INTEGER;
  return [...entries].sort((a, b) => (place(a) - place(b)) || (a.sort - b.sort) || a.name.localeCompare(b.name));
}

/**
 * Is this the second listing of a starting class: what a Trainee gains on promoting into it? The Class Sheet
 * lists such a class again with gains and no stats of its own.
 */
const isTraineeListing = (cls) => (cls.order === BASE) && FEO.classStats.every((key) => cls.base[key] === null);

/**
 * The names a class lists for one of its skills. "A or B" offers a choice, and "A, B" gives both; a skill
 * whose own name has a comma or an "or" in it is known by being a skill.
 * @param {string} text
 * @param {(name: string) => boolean} known
 * @returns {{names: string[], choice: boolean}}
 */
function skillNames(text, known) {
  const whole = String(text ?? "").trim();
  if ( !whole || /^(none|-+|–|—|n\/a)$/i.test(whole) ) return { names: [], choice: false };
  if ( known(whole) ) return { names: [whole], choice: false };
  const options = whole.split(/\s+or\s+/i).map((name) => name.trim()).filter(Boolean);
  if ( options.length > 1 ) return { names: options, choice: true };
  const all = whole.split(/\s*,\s*/).filter(Boolean);
  return { names: all.every(known) ? all : [whole], choice: false };
}

/**
 * Gather entries into a library: the classes with their second listings folded in and their promotions found,
 * the skills by name with the classes that teach them, and the weapons and items in their groups.
 * @param {object} entries
 * @param {object[]} [entries.classes]
 * @param {object[]} [entries.skills]
 * @param {object[]} [entries.weapons]
 * @param {object[]} [entries.gear]
 * @returns {object}
 */
export function buildLibrary({ classes = [], skills = [], weapons = [], gear = [] } = {}) {
  // Skills, by name
  const skillList = inOrder(skills);
  const skillByName = new Map();
  for ( const skill of skillList ) if ( !skillByName.has(fold(skill.name)) ) skillByName.set(fold(skill.name), skill);
  const skillById = new Map(skillList.map((skill) => [skill.id, skill]));
  const knownSkill = (name) => skillByName.has(fold(name));

  // Classes. A second listing is folded into the class it repeats, which keeps its gains
  const listed = inOrder(classes).map((cls, index) => ({ ...cls, sort: index }));
  const mains = listed.filter((cls) => !isTraineeListing(cls));
  const alias = new Map();
  const kept = [];
  for ( const cls of listed ) {
    const main = isTraineeListing(cls)
      ? mains.find((other) => (other.race === cls.race) && (other.order === cls.order) && sameClassName(other.name, cls.name))
      : null;
    if ( main ) {
      alias.set(cls.id, main.id);
      main.fromTrainee = cls.gains;
    } else kept.push(cls);
  }
  const byId = new Map(kept.map((cls) => [cls.id, cls]));

  // What each class promotes to: the class it links, or else the one of that name, the next tier first. A name
  // that speaks of several forms of a class at once reaches all of them
  const targetsOf = new Map();
  const parentsOf = new Map(kept.map((cls) => [cls.id, []]));
  for ( const cls of kept ) {
    const found = [];
    for ( const target of cls.promotesTo ) {
      const linked = byId.get(alias.get(target.id) ?? target.id);
      const named = kept.filter((other) => (other.race === cls.race) && (other.order > cls.order)
        && sameClassName(other.name, target.name))
        .sort((a, b) => (a.order - b.order) || (a.sort - b.sort));
      const next = named.filter((other) => other.order === named[0].order);
      if ( linked ) found.push(linked, ...next.filter((other) => other.order === linked.order));
      else found.push(...next);
    }
    const unique = [...new Set(found)].filter((other) => other !== cls);
    targetsOf.set(cls.id, unique);
    for ( const target of unique ) parentsOf.get(target.id).push(cls);
  }

  // The skills each class lists, and the classes that teach each skill
  const taughtBy = new Map();
  for ( const cls of kept ) {
    cls.slots = {};
    for ( const slot of Object.keys(SLOT_LABELS) ) {
      const listing = skillNames(cls.skills?.[slot], knownSkill);
      cls.slots[slot] = listing;
      for ( const name of listing.names ) {
        if ( !taughtBy.has(fold(name)) ) taughtBy.set(fold(name), []);
        taughtBy.get(fold(name)).push(cls);
      }
    }
  }

  // The skills that come with a Special Quality: the tab lists them for reference, each naming its qualities
  const qualities = new Set(kept.flatMap((cls) => cls.qualities.map(fold)));
  const qualitySkills = new Map();
  for ( const skill of skillList ) {
    const match = /^(.*?)\s*special qualit(?:y|ies)\b/i.exec(skill.prerequisite);
    if ( !match ) continue;
    for ( const name of match[1].split(/\s*,\s*|\s+and\s+/i).map(fold).filter((quality) => qualities.has(quality)) ) {
      if ( !qualitySkills.has(name) ) qualitySkills.set(name, []);
      qualitySkills.get(name).push(skill);
    }
  }

  // The armoury, group by group
  const groupsOf = (entries) => {
    const groups = new Map();
    for ( const entry of inOrder(entries) ) {
      const key = entry.folder?.id ?? "";
      if ( !groups.has(key) ) groups.set(key, { key, name: entry.folder?.name ?? "", note: entry.folder?.note ?? "", rows: [] });
      groups.get(key).rows.push(entry);
    }
    return [...groups.values()];
  };

  const races = Object.keys(FEO.races).filter((race) => kept.some((cls) => cls.race === race));
  return {
    classes: kept,
    byId,
    alias,
    targetsOf,
    parentsOf,
    races,
    skills: skillList,
    skillById,
    skillByName,
    taughtBy,
    qualitySkills,
    weaponGroups: groupsOf(weapons),
    gearGroups: groupsOf(gear),
    weaponsById: new Map(weapons.map((weapon) => [weapon.id, weapon])),
    gearById: new Map(gear.map((item) => [item.id, item])),
    trees: new Map()
  };
}

/**
 * Find a class of the library by its id, by the id of a second listing folded into it, or by its name.
 * @param {object} library
 * @param {string} key
 * @returns {object|null}
 */
export function findClass(library, key) {
  if ( !key ) return null;
  return library.byId.get(library.alias.get(key) ?? key)
    ?? library.classes.find((cls) => fold(cls.name) === fold(key))
    ?? library.classes.find((cls) => sameClassName(cls.name, key))
    ?? null;
}

/**
 * Find a skill of the library by its id or its name.
 * @param {object} library
 * @param {string} key
 * @returns {object|null}
 */
export function findSkill(library, key) {
  if ( !key ) return null;
  return library.skillById.get(key) ?? library.skillByName.get(fold(key)) ?? null;
}

/* -------------------------------------------- */
/*  Crests                                      */
/* -------------------------------------------- */

/** Is a class one of those the Class Sheet lists for enemies and other characters the Game Master plays? */
const isNpc = (cls) => /\b(npc|enemy)\b/i.test(cls.folder?.name ?? "");

/** The charge a list of proficiencies is drawn with, if it is drawn with any. */
function chargeOf(options) {
  if ( !options.length ) return null;
  if ( options.length > 2 ) return options.every((option) => MAGIC.has(option)) ? "tome" : "crossed";
  return PROFICIENCY_ICONS[options[0]] ?? null;
}

/** The charge of a Special Quality a class has, if any is drawn. */
function qualityCharge(cls) {
  for ( const quality of cls.qualities ) {
    const charge = QUALITY_ICONS[fold(quality)];
    if ( charge ) return charge;
  }
  return null;
}

/**
 * How a class is drawn: the dye of its line's cloth and the charge on its shield. The charge is the
 * proficiency the class brings; a class that brings none shows a Special Quality, or what its line began with.
 * @param {object} cls
 * @param {object} [lead]     The class its line is named after
 * @returns {{dye: string, charge: string}}
 */
export function heraldry(cls, lead = cls) {
  const dye = isNpc(lead) ? "slate"
    : (PROFICIENCY_DYES[lead.proficiencies.options[0]] ?? RACE_DYES[lead.race] ?? "slate");
  const charge = chargeOf(cls.proficiencies.options) ?? qualityCharge(cls)
    ?? chargeOf(lead.proficiencies.options) ?? qualityCharge(lead) ?? "star";
  return { dye, charge };
}

/**
 * The crest of a class as inline SVG: a shield in its line's dye, rimmed in its tier's metal.
 * @param {{order: number, dye: string, charge: string}} arms
 * @returns {string}
 */
export function crestHtml({ order, dye, charge }) {
  const tier = Math.max(0, Math.min(4, order));
  const shape = SHIELDS[Math.min(tier, SHIELDS.length - 1)];
  return `<svg class="cp-crest t${tier}" data-dye="${dye}" viewBox="0 0 48 56" aria-hidden="true" focusable="false">`
    + `<path class="rim" d="${shape}"/><path class="shine" d="${shape}"/>`
    + `<path class="inner" d="${shape}" transform="translate(24 28) scale(.8) translate(-24 -28)"/>`
    + `<g class="charge" transform="translate(12 ${tier <= 1 ? 14 : 16})">${ICONS[charge] ?? ICONS.star}</g>`
    + (tier >= 3 ? `<circle class="gem" cx="24" cy="7" r="3"/>` : "")
    + `</svg>`;
}

/* -------------------------------------------- */
/*  The Class Tree                              */
/* -------------------------------------------- */

/**
 * The tree of one people, laid out once and kept.
 * @param {object} library
 * @param {string} race
 * @returns {{tree: ClassTree, arms: Map<string, {dye: string, charge: string}>, classes: object[]}}
 */
export function treeOf(library, race) {
  if ( library.trees.has(race) ) return library.trees.get(race);
  const classes = library.classes.filter((cls) => cls.race === race);
  const tree = layoutClassTree(classes.map((cls) => ({
    id: cls.id,
    name: cls.name,
    order: cls.order,
    sort: cls.sort,
    targets: library.targetsOf.get(cls.id).map((target) => target.id)
  })), { floor: BASE });
  const arms = new Map();
  for ( const node of tree.nodes ) {
    const line = tree.lines[node.line];
    arms.set(node.id, heraldry(library.byId.get(node.id), library.byId.get(line.lead)));
  }
  const built = { tree, arms, classes };
  library.trees.set(race, built);
  return built;
}

/** The levels a tier covers, as words. */
function tierLevels(tier, race, i18n) {
  if ( FEO.races[race]?.milestones || (tier.order > FEO.classTiers.third.order) ) return "";
  const from = tier.startLevel ?? 1;
  if ( tier.promoteAt ) return i18n.format("FEO.Class.levels", { from, to: tier.promoteAt });
  return i18n.format("FEO.Class.levelsFrom", { from });
}

/**
 * Build the display data of the tree of one people.
 * @param {object} library
 * @param {string} race
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildTreeContext(library, race, i18n) {
  const { tree, arms, classes } = treeOf(library, race);
  const tiers = Object.values(FEO.classTiers);
  const byOrder = (order) => tiers.find((tier) => tier.order === order) ?? FEO.classTiers.base;
  const half = TREE.column / 2;
  const ground = tree.tiers.filter((row) => row.order >= BASE).pop() ?? tree.tiers.at(-1);
  return {
    race,
    empty: !classes.length,
    width: tree.width,
    height: tree.height,
    // Where the view comes to rest: the foot of the lowest tier that makes lines
    ground: ground ? ground.y + TREE.node + 40 : tree.height,
    tiers: tree.tiers.map((row) => {
      const tier = byOrder(row.order);
      return {
        label: i18n.localize(tier.label),
        levels: tierLevels(tier, race, i18n),
        ribbon: row.y + 22,
        divider: row.divider
      };
    }),
    lines: tree.lines.filter((line) => !line.loose && (line.size > 1)).map((line) => {
      const lead = library.byId.get(line.lead);
      const { dye } = arms.get(lead.id);
      return {
        id: lead.id,
        // A line one class wide has room for its name and no more
        label: line.width > TREE.column ? i18n.format("FEO.Compendium.line", { name: lead.name }) : lead.name,
        icon: icon(chargeOf(lead.proficiencies.options) ?? qualityCharge(lead) ?? "banner"),
        dye,
        x: line.x - 6,
        width: line.width + 12,
        top: line.top - 40,
        height: line.bottom - line.top + 52,
        middle: line.x + (line.width / 2)
      };
    }),
    nodes: tree.nodes.map((node) => {
      const cls = library.byId.get(node.id);
      const tier = byOrder(cls.order);
      return {
        id: cls.id,
        uuid: cls.uuid,
        name: cls.name,
        left: node.x - half,
        top: node.y,
        crest: crestHtml({ order: cls.order, ...arms.get(cls.id) }),
        npc: isNpc(cls),
        hint: `${cls.name} · ${i18n.localize(tier.label)}${cls.description ? ` · ${cls.description}` : ""}`
      };
    })
  };
}

/**
 * What lighting the roads of a class draws: the state of every class, the roads from the faintest to the
 * brightest, and the level tags.
 * @param {object} library
 * @param {string} race
 * @param {string} id
 * @param {Localizer} i18n
 * @returns {{nodes: Record<string, string>, routes: string, tags: string}}
 */
export function buildTreeLight(library, race, id, i18n) {
  const { tree } = treeOf(library, race);
  const light = lightClassTree(tree, id);
  const strength = ["", "from2", "to2", "from", "to"];
  const routes = tree.roads.map((road, index) => ({ road, mode: light.roads[index] }))
    .sort((a, b) => strength.indexOf(a.mode) - strength.indexOf(b.mode))
    .map(({ road, mode }) => `<g class="${mode}"><path class="${road.outside ? "outside" : ""}" d="${road.d}"/>`
      + `<path class="head" d="${road.head}"/></g>`).join("");
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const tags = [...light.tags].map(([source, mode]) => {
    const node = nodes.get(source);
    const level = Object.values(FEO.classTiers).find((tier) => tier.order === library.byId.get(source).order)?.promoteAt;
    if ( !node || !level ) return "";
    return `<span class="cp-level ${mode}" style="left:${node.x}px;top:${node.y - 9}px">`
      + `${escape(i18n.format("FEO.Compendium.levelTag", { level }))}</span>`;
  }).join("");
  return { nodes: Object.fromEntries(light.nodes), routes, tags };
}

/**
 * Where a class stands on the tree of its people, and where its line does.
 * @param {object} library
 * @param {string} id
 * @returns {{x: number, y: number}|null}
 */
export function standingOf(library, id) {
  const cls = library.byId.get(id);
  if ( !cls ) return null;
  const node = treeOf(library, cls.race).tree.nodes.find((entry) => entry.id === id);
  return node ? { x: node.x, y: node.y } : null;
}

/* -------------------------------------------- */
/*  The Class Sheet                             */
/* -------------------------------------------- */

/** A class as a chip that leads to it. */
function classChip(library, cls, note = "") {
  const { arms } = treeOf(library, cls.race);
  return {
    id: cls.id,
    name: cls.name,
    crest: crestHtml({ order: cls.order, ...(arms.get(cls.id) ?? heraldry(cls)) }),
    note
  };
}

/** When a class's skill of a slot is learned, as words. */
function slotWhen(cls, slot, i18n) {
  if ( slot === "starting" ) return i18n.localize("FEO.Compendium.when.start");
  if ( slot === "occult" ) return i18n.format("FEO.Class.occultAt", { from: FEO.occultLevel });
  if ( FEO.classTiers[cls.tier]?.skill === slot ) return i18n.localize("FEO.Compendium.when.promotion");
  const level = Object.entries(FEO.milestoneLevels).find(([, learned]) => learned === slot)?.[0];
  return level ? i18n.format("FEO.Class.level", { from: level }) : "";
}

/**
 * Build the display data of the class sheet: one self-contained panel for one class.
 * @param {object} library
 * @param {string} id
 * @param {Localizer} i18n
 * @returns {object|null}
 */
export function buildClassSheet(library, id, i18n) {
  const cls = findClass(library, id);
  if ( !cls ) return null;
  const tier = FEO.classTiers[cls.tier] ?? FEO.classTiers.base;
  const { arms, tree } = treeOf(library, cls.race);
  const coat = arms.get(cls.id) ?? heraldry(cls);
  const starting = cls.order <= BASE;
  const listing = isTraineeListing(cls);
  const targets = library.targetsOf.get(cls.id);
  const parents = library.parentsOf.get(cls.id);
  const lineOf = (other) => tree.nodes.find((node) => node.id === other.id)?.line;

  const cells = (values, gains) => FEO.classStats.map((key) => {
    const value = values[key];
    const note = cls.notes.find((entry) => fold(entry.label) === key);
    return {
      abbr: i18n.localize(`FEO.Stat.${key}.abbr`),
      label: i18n.localize(`FEO.Stat.${key}.label`),
      value: value === null ? (note?.value ?? "–") : (gains ? signed(value) : value),
      css: value === null ? (note ? "word" : "nil") : (gains ? (value > 0 ? "up" : value < 0 ? "down" : "nil") : "")
    };
  });
  const hasTransformed = Object.values(cls.transformed).some((value) => value !== null);

  // Proficiencies, and the weapon types they open in the armoury when every one of them has a group there
  const groups = cls.proficiencies.options.map((option) => {
    const group = library.weaponGroups.find((entry) => entry.rows[0]?.category === option);
    return group ? { key: group.key, label: group.name, icon: icon(CATEGORY_ICONS[option] ?? FEO.categoryIcons[option]) } : null;
  });
  const proficiencyLinks = (groups.length && (groups.length <= 3) && groups.every(Boolean)) ? groups : [];

  // Skills, slot by slot
  const skills = Object.keys(SLOT_LABELS).filter((slot) => cls.slots[slot].names.length).map((slot) => {
    const { names, choice } = cls.slots[slot];
    return {
      slot,
      icon: icon(SLOT_ICONS[slot]),
      intro: choice ? i18n.format("FEO.Compendium.sheet.oneOf", {
        label: i18n.localize(SLOT_LABELS[slot]),
        count: names.length
      }) : "",
      rows: names.map((name) => {
        const skill = library.skillByName.get(fold(name));
        return {
          name,
          id: skill?.id ?? "",
          label: choice ? i18n.localize("FEO.Compendium.sheet.option") : i18n.localize(SLOT_LABELS[slot]),
          when: slotWhen(cls, slot, i18n),
          effect: skill?.effect ?? ""
        };
      })
    };
  });

  const promoteAt = (other) => FEO.classTiers[other.tier]?.promoteAt ?? null;
  const fromLevels = [...new Set(parents.map(promoteAt).filter(Boolean))];
  return {
    id: cls.id,
    uuid: cls.uuid,
    name: cls.name,
    dye: coat.dye,
    crest: crestHtml({ order: cls.order, ...coat }),
    tier: i18n.localize(tier.label),
    sub: [...new Set([cls.folder?.name, i18n.localize(FEO.races[cls.race]?.label ?? "")].filter(Boolean))].join(" · "),
    description: cls.description,
    stats: {
      title: i18n.localize(starting && !listing ? "FEO.Class.base" : "FEO.Class.gains"),
      hint: i18n.localize(listing ? "FEO.Class.gainsFromTrainee" : starting ? "FEO.Class.baseHint" : "FEO.Class.gainsHint"),
      cells: cells(starting && !listing ? cls.base : cls.gains, !starting || listing)
    },
    wt: cls.wt,
    fromTrainee: cls.fromTrainee ? cells(cls.fromTrainee, true) : null,
    transformed: hasTransformed ? [
      ...FEO.classStats.map((key) => ({ abbr: i18n.localize(`FEO.Stat.${key}.abbr`), value: cls.transformed[key] ?? "–" })),
      { abbr: i18n.localize("FEO.Stat.wt.abbr"), value: cls.transformed.wt ?? "–" }
    ] : null,
    proficiencies: {
      title: i18n.localize(starting ? "FEO.Class.proficiencies" : "FEO.Class.proficienciesGained"),
      text: cls.proficiencies.note,
      none: i18n.localize(starting ? "FEO.Compendium.sheet.noProficiencies" : "FEO.Compendium.sheet.noProficienciesGained"),
      links: proficiencyLinks
    },
    skills,
    qualities: cls.qualities.map((quality) => ({
      name: quality,
      skills: (library.qualitySkills.get(fold(quality)) ?? []).map((skill) => ({ id: skill.id, name: skill.name }))
    })),
    notes: cls.notes.filter((note) => !FEO.classStats.includes(fold(note.label))),
    from: parents.map((parent) => classChip(library, parent,
      (parent.order >= BASE) && (lineOf(parent) !== lineOf(cls)) ? i18n.localize("FEO.Compendium.sheet.outside") : "")),
    fromLevel: fromLevels.length === 1 ? i18n.format("FEO.Compendium.levelTag", { level: fromLevels[0] }) : "",
    fromNone: i18n.localize(starting ? "FEO.Compendium.sheet.startsHere" : "FEO.Compendium.sheet.noneLeadHere"),
    to: targets.map((target) => classChip(library, target)),
    toLevel: tier.promoteAt ? i18n.format("FEO.Compendium.levelTag", { level: tier.promoteAt }) : "",
    toNone: i18n.localize(FEO.races[cls.race]?.milestones || (starting && skills.some((group) => group.slot !== "starting"))
      ? "FEO.Class.noPromotions" : "FEO.Compendium.sheet.lastTier")
  };
}

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

/** Does an entry answer to what was typed in a search box? */
const answers = (query, ...texts) => !query || texts.some((text) => fold(text).includes(query));

/**
 * Build the display data of the roll of skills: the kinds to choose among, and the skills of the kind chosen
 * that answer to the search, under a heading for each kind.
 * @param {object} library
 * @param {object} state
 * @param {string} [state.kind]
 * @param {string} [state.query]
 * @param {string} [state.selected]
 * @param {(skill: object) => {chosen?: boolean, barred?: boolean}} [state.describe]    How each skill stands
 *   with whoever is taking one from the roll: the one they have, and those that are not for them
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildSkillList(library, { kind = "all", query = "", selected = "", describe = null } = {}, i18n) {
  const wanted = fold(query);
  const matches = library.skills.filter((skill) => answers(wanted, skill.name, skill.effect, skill.prerequisite));
  const kinds = Object.keys(FEO.skillKinds).filter((key) => library.skills.some((skill) => skill.kind === key));
  const shown = matches.filter((skill) => (kind === "all") || (skill.kind === kind));
  return {
    kinds: [
      { key: "all", label: i18n.localize("FEO.Compendium.all"), count: matches.length, pressed: kind === "all" },
      ...kinds.map((key) => ({
        key,
        label: i18n.localize(FEO.skillKinds[key]),
        count: matches.filter((skill) => skill.kind === key).length,
        pressed: kind === key,
        dot: true
      }))
    ],
    groups: kinds.map((key) => ({
      kind: key,
      label: i18n.format("FEO.Compendium.skills.group", { kind: i18n.localize(FEO.skillKinds[key]) }),
      rows: shown.filter((skill) => skill.kind === key).map((skill) => {
        const standing = describe?.(skill);
        return {
          id: skill.id,
          uuid: skill.uuid,
          name: skill.name,
          effect: skill.effect,
          capacity: skill.capacity || "",
          pressed: skill.id === selected,
          taken: !!standing?.chosen,
          barred: !!standing?.barred
        };
      })
    })).filter((group) => group.rows.length),
    empty: !shown.length
  };
}

/**
 * What the markers after a skill's name on the reference sheet say about it, each with a line that explains it.
 * @param {{chosen?: boolean, scroll?: string, nihil?: boolean}} skill    A skill as read, or its system data
 * @param {Localizer} i18n
 * @returns {{css: string, label: string, text: string}[]}
 */
export function skillMarks(skill, i18n) {
  const marks = [];
  if ( skill.chosen ) marks.push({ css: "", label: "FEO.Compendium.mark.chosen", text: "FEO.Compendium.mark.chosenText" });
  if ( skill.scroll === "none" ) marks.push({ css: "quiet", label: "FEO.Compendium.mark.noScroll", text: "FEO.Compendium.mark.noScrollText" });
  if ( skill.scroll === "sameClass" ) marks.push({ css: "quiet", label: "FEO.Compendium.mark.sameClass", text: "FEO.Compendium.mark.sameClassText" });
  if ( skill.nihil ) marks.push({ css: "bane", label: "FEO.Compendium.mark.nihil", text: "FEO.Compendium.mark.nihilText" });
  return marks.map((mark) => ({ css: mark.css, label: i18n.localize(mark.label), text: i18n.localize(mark.text) }));
}

/**
 * The prerequisite a skill states, or nothing where the reference sheet writes that it has none.
 * @param {string} text
 * @returns {string}
 */
export function statedPrerequisite(text) {
  const stated = String(text ?? "").trim();
  return /^(|n\/?a|none|-+)$/i.test(stated) ? "" : stated;
}

/**
 * Build the display data of the skill sheet.
 * @param {object} library
 * @param {string} id
 * @param {Localizer} i18n
 * @returns {object|null}
 */
export function buildSkillSheet(library, id, i18n) {
  const skill = findSkill(library, id);
  if ( !skill ) return null;

  const tierOf = (cls) => i18n.localize(FEO.classTiers[cls.tier]?.label ?? "");
  const quality = [...library.qualitySkills].filter(([, skills]) => skills.includes(skill)).map(([name]) => name);
  const bearers = library.classes.filter((cls) => cls.qualities.some((name) => quality.includes(fold(name))));
  return {
    id: skill.id,
    uuid: skill.uuid,
    name: skill.name,
    kind: skill.kind,
    icon: icon(KIND_ICONS[skill.kind] ?? "spark"),
    kindLabel: i18n.format("FEO.Compendium.skills.kind", { kind: i18n.localize(FEO.skillKinds[skill.kind] ?? "") }),
    capacity: skill.capacity
      ? i18n.format("FEO.Compendium.skills.capacity", { cost: skill.capacity })
      : i18n.localize("FEO.Compendium.skills.noCapacity"),
    effect: skill.effect,
    marks: skillMarks(skill, i18n),
    prerequisite: statedPrerequisite(skill.prerequisite),
    taught: (library.taughtBy.get(fold(skill.name)) ?? []).map((cls) => classChip(library, cls, tierOf(cls))),
    quality: quality.length ? i18n.format("FEO.Compendium.skills.comesWith", {
      quality: bearers[0]?.qualities.find((name) => quality.includes(fold(name))) ?? quality[0]
    }) : "",
    bearers: bearers.map((cls) => classChip(library, cls, tierOf(cls)))
  };
}

/* -------------------------------------------- */
/*  Equipment                                   */
/* -------------------------------------------- */

/** A number of uses as the armoury shows it: none at all is no limit. */
const usesText = (uses) => (uses > 0 ? String(uses) : "∞");

/** A value with the one a staff counters with at 1 range, as the reference sheet writes them. */
const withCounter = (value, counter) => ((counter ?? null) === null ? String(value) : `${value} (${counter})`);

/**
 * The name of the icon a group of the armoury is drawn with: by the type of its weapons, or by what its name
 * says of its items.
 * @param {{name: string, rows: object[]}} group
 * @param {boolean} weapons     Is it a group of weapons?
 * @returns {string}
 */
function groupIcon(group, weapons) {
  if ( weapons ) {
    const category = group.rows[0]?.category;
    return CATEGORY_ICONS[category] ?? FEO.categoryIcons[category] ?? "sword";
  }
  return GEAR_ICONS.find(([pattern]) => pattern.test(group.name))?.[1] ?? "flask";
}

/**
 * Build the display data of the armoury: the weapons or the items of the type chosen that answer to the
 * search, group by group.
 * @param {object} library
 * @param {object} state
 * @param {string} [state.tab]
 * @param {string} [state.type]
 * @param {string} [state.query]
 * @param {(entry: object) => {sold: boolean, can: boolean, fit: boolean, unfit: string}} [state.describe]
 *   How each entry stands with whoever is buying from the armoury: whether it is for sale, whether they can pay
 *   for it, and whether it suits them, with a word on why not
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildEquipment(library, { tab = "weapons", type = "", query = "", describe = null } = {}, i18n) {
  const weapons = tab === "weapons";
  const shop = !!describe;
  const offer = (row) => {
    if ( !shop ) return {};
    const standing = describe(row);
    return { sold: standing.sold, can: standing.sold && standing.can, unfit: standing.unfit ?? "" };
  };
  const suits = (row) => {
    const standing = describe(row);
    return standing.sold && standing.fit;
  };
  const wanted = fold(query);
  const source = weapons ? library.weaponGroups : library.gearGroups;
  const iconOf = (group) => icon(groupIcon(group, weapons));
  const name = (group) => group.name || i18n.localize("FEO.Compendium.equipment.loose");
  const groups = source.map((group) => ({
    group,
    rows: group.rows.filter((row) => answers(wanted, row.name, row.effect, group.name))
  }));
  const known = (type === "all") || groups.some(({ group }) => group.key === type);
  const chosen = known ? type : (wanted ? "all" : (groups[0]?.group.key ?? "all"));

  const weaponRow = (row) => ({
    id: row.id,
    uuid: row.uuid,
    name: row.name,
    rank: i18n.localize(FEO.ranks[row.rank] ?? row.rank),
    high: ["S", "SS", "STAR"].includes(row.rank),
    level: row.level ?? "",
    might: withCounter(row.might, row.counter?.might),
    hit: withCounter(row.hit, row.counter?.hit),
    crit: withCounter(row.crit, row.counter?.crit),
    range: row.range,
    weight: row.weight,
    uses: usesText(row.uses),
    cost: row.cost ? number(row.cost) : "–",
    effect: row.effect,
    ...offer(row)
  });
  const gearRow = (row) => ({
    id: row.id,
    uuid: row.uuid,
    name: row.name,
    effect: row.effect,
    uses: row.equip
      ? (row.uses > 0 ? i18n.format("FEO.Compendium.equipment.equipUses", { uses: row.uses }) : i18n.localize("FEO.Compendium.equipment.equip"))
      : usesText(row.uses),
    cost: row.cost ? number(row.cost) : "–",
    ...offer(row)
  });

  return {
    weapons,
    shop,
    type: chosen,
    types: [
      {
        key: "all",
        label: i18n.localize("FEO.Compendium.all"),
        count: groups.reduce((sum, { rows }) => sum + rows.length, 0),
        pressed: chosen === "all"
      },
      ...groups.map(({ group, rows }) => ({
        key: group.key,
        label: name(group),
        icon: iconOf(group),
        count: rows.length,
        pressed: chosen === group.key,
        fit: shop && weapons && group.rows.some(suits)
      }))
    ],
    groups: groups.filter(({ group, rows }) => rows.length && ((chosen === "all") || (group.key === chosen)))
      .map(({ group, rows }) => ({
        name: name(group),
        icon: iconOf(group),
        note: group.note,
        count: wanted
          ? i18n.format("FEO.Compendium.equipment.countOf", { shown: rows.length, total: group.rows.length })
          : i18n.format("FEO.Compendium.equipment.count", { total: group.rows.length }),
        rows: rows.map(weapons ? weaponRow : gearRow)
      })),
    empty: !groups.some(({ rows }) => rows.length)
  };
}

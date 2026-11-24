import { FEO } from "../config.mjs";
import { findSkill, plainText } from "./compendium-context.mjs";

/**
 * What the NPC Builder's window shows, worked out from what was chosen for a unit and what that comes to.
 * Nothing here touches Foundry: each function takes what is known and answers with what the template needs.
 *
 * @import {NpcSpec} from "../rules/npc.mjs"
 * @import {NpcView} from "../helpers/npc.mjs"
 * @typedef {{localize: (key: string) => string, format: (key: string, data: object) => string}} Localizer
 */

/** The stats a unit is told by, in the order of the sheet. */
const SHOWN = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk"];

/** The combat stats shown beside a unit, with the words for each. */
const COMBAT = [
  ["damage", "FEO.Npc.combat.damage"], ["accuracy", "FEO.Npc.combat.accuracy"], ["critical", "FEO.Npc.combat.critical"],
  ["attackSpeed", "FEO.Npc.combat.attackSpeed"], ["dodge", "FEO.Npc.combat.dodge"], ["critAvoid", "FEO.Npc.combat.critAvoid"]
];

/** The icon of each proficiency and of each kind of weapon. */
export const WEAPON_ICONS = {
  sword: "sword", katana: "sword", lance: "lance", axe: "axe", bow: "bow", crossbow: "bow", knife: "knife", brawl: "fist",
  fire: "flame", thunder: "bolt", wind: "wind", water: "drop", ice: "snow", earth: "peak", light: "sun", dark: "moon",
  anima: "tome", staff: "staff", laguz: "claw", manakete: "claw", taguel: "paw", monster: "fang", bolt: "target"
};

/** A number with its sign. */
const signed = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "");

/**
 * The icon a unit is drawn with: that of the weapon in its hand, or of what its class fights with.
 * @param {string|null} category      The kind of weapon in its hand
 * @param {object|null} [cls]         Its class, as the class rules read one
 * @returns {string}
 */
export function unitIcon(category, cls = null) {
  return WEAPON_ICONS[category] ?? WEAPON_ICONS[cls?.system.proficiencies?.options?.[0]] ?? "shield";
}

/* -------------------------------------------- */

/**
 * The window of the NPC Builder.
 * @param {object} state
 * @param {NpcSpec} state.spec
 * @param {NpcView|null} state.view         What the unit comes to; null for one without a class
 * @param {object} state.library            The Compendium's library
 * @param {object[]} [state.parents]        The classes its second class can be reached from, as the library has
 *                                          them, where there are several
 * @param {object[]} [state.promotions]     The classes its last class promotes to
 * @param {boolean} [state.saved]           Is it a unit that exists already?
 * @param {string} [state.encounter]        The name of the encounter it is made for
 * @param {number|null} [state.partyLevel]  The Level of the party of that encounter
 * @param {string} [state.say]              What the window has to say just now
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildNpcBuilder({ spec, view, library, parents = [], promotions = [], saved = false, encounter = "", partyLevel = null, say = "" }, i18n) {
  const loc = (key) => i18n.localize(key);
  const context = {
    army: spec.side,
    name: spec.name,
    saved,
    say,
    encounter,
    hasClass: !!view,
    sides: FEO.npc.sides.map((key) => ({ key, label: loc(`FEO.Npc.side.${key}`), on: key === spec.side })),
    boss: spec.boss,
    recruit: spec.recruit,
    where: encounter
      ? i18n.format(saved ? "FEO.Npc.foot.inEncounter" : "FEO.Npc.foot.forEncounter", { encounter })
      : loc(saved ? "FEO.Npc.foot.saved" : "FEO.Npc.foot.fresh")
  };
  if ( !view ) return context;

  const { build, span, combat } = view;
  const unit = build.unit;
  const last = build.classes.at(-1);
  const first = build.classes[0];
  const tone = spec.boss ? "boss" : spec.recruit ? "recruit" : "";
  const stat = (key) => unit.stats[key]?.base ?? 0;
  const armed = view.weapon && (view.weapon.category !== "staff");

  // The banner: the unit as it stands
  context.placeholder = build.className;
  context.rail = {
    level: build.level,
    name: spec.name || build.className,
    tone,
    className: build.className,
    race: loc(FEO.races[last.system.race]?.label ?? ""),
    hp: unit.hp.max,
    quick: [
      { label: loc("FEO.Stat.mov.abbr"), value: stat("mov") },
      { label: loc("FEO.Stat.con.abbr"), value: stat("con") },
      { label: loc("FEO.Npc.wt"), value: view.wt },
      { label: loc("FEO.Stat.los.abbr"), value: stat("los") }
    ],
    held: view.weapon ? i18n.format("FEO.Npc.with", { weapon: view.weapon.name }) : loc("FEO.Npc.unarmed"),
    combat: COMBAT.map(([key, label]) => ({
      label: loc(label),
      value: (!armed && ["damage", "critical"].includes(key)) || (!view.weapon && (key === "accuracy")) ? "–" : (combat[key] ?? 0)
    })),
    chips: [
      ...(spec.boss ? [{ icon: "crown", label: loc("FEO.Npc.boss") }] : []),
      ...(spec.recruit ? [{ icon: "hand", label: loc("FEO.Npc.recruit") }] : []),
      ...String(unit.specialQualities ?? "").split(",").map((quality) => quality.trim()).filter(Boolean).map((label) => ({ icon: "spark", label }))
    ]
  };

  // Class
  const atCap = span.promotes && (build.level >= span.to);
  context.cls = {
    name: build.className,
    icon: unitIcon(null, first),
    note: (build.classes.length > 1)
      ? i18n.format("FEO.Npc.class.cameFrom", { from: build.classes.slice(0, -1).map((cls) => cls.name).join(" → ") })
      : span.promotes ? i18n.format("FEO.Npc.class.promotesAt", { level: span.to + 1 }) : loc("FEO.Npc.class.levelsOn"),
    parents: (parents.length > 1) ? parents.map((entry) => ({ id: entry.id, name: entry.name, on: entry.id === first.id })) : [],
    promotions: atCap ? promotions.map((entry) => ({ id: entry.id, name: entry.name })) : [],
    promoteHint: atCap ? i18n.format(promotions.length ? "FEO.Npc.class.promoteTo" : "FEO.Npc.class.noPromotion", { level: span.to }) : ""
  };

  // Level
  const top = span.promotes ? span.to : FEO.npc.limit;
  context.level = {
    value: build.level,
    atFloor: build.level <= 1,
    atTop: build.level >= top,
    party: Number.isFinite(partyLevel) ? partyLevel : null
  };

  // Stats, each with where it comes from on hover
  const varies = spec.vary && (build.levels > 0);
  context.stats = SHOWN.map((key) => {
    const part = build.parts[key];
    const total = (key === "hp") ? unit.hp.max : stat(key);
    const [low, high] = build.span[key] ?? [total, total];
    const spans = varies && (low !== high);
    const terms = [
      i18n.format("FEO.Npc.part.base", { value: part.base }),
      part.levels ? i18n.format("FEO.Npc.part.levels", { value: signed(part.levels) }) : "",
      part.promotion ? i18n.format("FEO.Npc.part.promotion", { value: signed(part.promotion) }) : "",
      part.adjust ? i18n.format("FEO.Npc.part.adjust", { value: signed(part.adjust) }) : "",
      i18n.format("FEO.Npc.part.growth", { value: unit.growths[key] ?? 0 })
    ];
    return {
      key,
      label: loc(`FEO.Stat.${key}.abbr`),
      spans,
      value: spans ? `${low}~${high}` : total - part.adjust,
      adjust: spans ? "" : signed(part.adjust),
      up: part.adjust > 0,
      title: terms.filter(Boolean).join(" · ")
    };
  });
  context.mode = { average: spec.mode !== "rolled", rolled: spec.mode === "rolled" };
  context.vary = spec.vary;
  context.growth = {
    levels: build.levels
      ? i18n.format(build.promotions ? "FEO.Npc.growth.levelsPromoted" : "FEO.Npc.growth.levels", { levels: build.levels, promotions: build.promotions })
      : loc("FEO.Npc.growth.none"),
    rates: SHOWN.map((key) => ({ label: loc(`FEO.Stat.${key}.abbr`), value: unit.growths[key] ?? 0 })),
    conOpen: build.conOpen,
    con: stat("con")
  };

  // Weapon ranks and what it carries
  context.ranks = build.ranks.map(({ key, rank, byHand }) => ({
    key,
    label: loc(FEO.proficiencies[key]),
    icon: WEAPON_ICONS[key] ?? "sword",
    rank: loc(FEO.ranks[rank]),
    byHand
  }));
  context.pack = view.carried.map((row, index) => {
    const entry = row.entry;
    let detail = loc("FEO.Npc.pack.unknown");
    if ( entry && row.weapon && (entry.category === "staff") ) detail = entry.effect || loc(FEO.weaponCategories.staff.label);
    else if ( entry && row.weapon ) {
      detail = i18n.format("FEO.Npc.pack.weapon", {
        might: entry.might, hit: entry.hit, crit: entry.crit, weight: entry.weight, range: entry.range, rank: loc(FEO.ranks[entry.rank] ?? "")
      });
    }
    else if ( entry ) detail = entry.effect ?? "";
    return {
      index,
      name: row.name,
      detail,
      weapon: row.weapon,
      hand: row.hand,
      unfit: row.weapon && !row.fit,
      drop: row.drop,
      dropLabel: loc(`FEO.Npc.drop.${row.drop || "keeps"}`)
    };
  });

  // Skills, each with where it comes from
  context.skills = build.skills.map((skill) => {
    const own = ["boss", "builtIn", "extra"].includes(skill.source);
    const found = findSkill(library, skill.name);
    return {
      name: skill.name,
      source: own ? skill.source : skill.kind,
      label: own ? loc(`FEO.Npc.source.${skill.source}`) : loc(FEO.skillKinds[skill.kind] ?? "FEO.SkillKind.class"),
      text: found ? plainText(found.effect) : loc("FEO.Npc.skill.unknown"),
      choice: skill.choice ?? "",
      options: (skill.options?.length ?? 0) > 1 ? skill.options.length : 0,
      removable: (skill.source === "generic") ? "generic" : (skill.source === "extra") ? "extra" : ""
    };
  });
  context.generic = { allowed: build.generic, has: build.skills.some((skill) => skill.source === "generic") };
  return context;
}

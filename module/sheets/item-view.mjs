import { FEO } from "../config.mjs";
import {
  CATEGORY_ICONS, GEAR_ICONS, KIND_ICONS, PROFICIENCY_DYES, RACE_DYES, SLOT_ICONS, SLOT_LABELS,
  crestHtml, heraldry, icon, plainText, readClass, skillMarks, statedPrerequisite
} from "../apps/compendium-context.mjs";
import { growthPickFields } from "../helpers/earnings-context.mjs";
import { bonusLabel, gambitReading } from "../helpers/battalion-context.mjs";
import { readArtItem, readCost } from "../rules/arts.mjs";
import { bonusAt, bonusKeys, hasRetreated, readGambit } from "../rules/battalions.mjs";
import { activationOf, choicesOf, rolledProc } from "../rules/skills.mjs";
import { buildClassContext } from "./class-context.mjs";

/**
 * Display data for an item's sheet while it is read and not edited: one panel, laid out as the Compendium lays
 * out a class or a skill, with a banner, the item's Effect on parchment, and a section for each thing worth
 * knowing. A section that would have nothing to say is left out.
 *
 * Nothing here touches Foundry, so that it can be exercised outside of it. Text is localized through whatever
 * `i18n` is passed in.
 *
 * @import {Localizer} from "../helpers/exchange-context.mjs"
 */

/**
 * @typedef {object} ViewSection
 * @property {string} title
 * @property {string} [hint]                A few words beside the title
 * @property {{abbr: string, label?: string, value: string|number, css?: string, box?: string}[]} [cells]
 *                                          Numbers in a row of boxes
 * @property {{label: string, value: string|number}[]} [pairs]      Labels with their values
 * @property {{css: string, label: string, text: string}[]} [marks]
 * @property {{slot: string, icon: string, name: string, label: string}[]} [skills]    A class's skills
 * @property {{name: string, quality?: boolean, index?: number, linked?: boolean, note?: string}[]} [chips]
 * @property {string} [text]                A line of text
 * @property {boolean} [none]               Does the line say that there is nothing?
 * @property {string} [prose]               Enriched HTML
 */

/**
 * @typedef {object} ItemView
 * @property {string} name
 * @property {string} [kind]                The kind of a skill, which colours the banner
 * @property {string} [dye]                 The dye of the banner of anything else
 * @property {string} [crest]               A class's crest, as SVG markup
 * @property {string} [art]                 The item's own image, when it has one worth showing
 * @property {string} emblem                An icon to show when it has neither, as SVG markup
 * @property {string} ribbon                What the item is, on the ribbon over its name
 * @property {string} sub                   The line under its name
 * @property {string} [effect]              Its Effect, as text
 * @property {string} [lore]                A class's description, as enriched HTML
 * @property {ViewSection[]} sections
 */

/* -------------------------------------------- */
/*  Small Things                                */
/* -------------------------------------------- */

/** A number with its sign, using a true minus. */
const signed = (value) => (value > 0 ? `+${value}` : String(value).replace("-", "−"));

/** A number of Gold, or a dash for something that is not sold. */
const gold = (value) => (value ? Number(value).toLocaleString("en-US") : "–");

/** How a gain is coloured. */
const gainCss = (value) => (value > 0 ? "up" : value < 0 ? "down" : "nil");

/** What is left of a number of uses. None at all is no limit. */
const usesLeft = (uses) => (uses.max > 0 ? `${uses.value}/${uses.max}` : "∞");

/** An item's own image, unless it is one of the stock symbols every new item is given. */
const artOf = (item) => (item.img && !item.img.startsWith("icons/svg/") ? item.img : "");

/** The words of the line under the name, joined. A folder named after what it holds is not said twice. */
const line = (...parts) => [...new Set(parts.filter(Boolean))].join(" · ");

/** A section for the item's description, if it has one. */
function describe(sections, description, i18n) {
  if ( plainText(description) ) sections.push({ title: i18n.localize("FEO.Weapon.description"), prose: description });
}

/* -------------------------------------------- */
/*  Weapons                                     */
/* -------------------------------------------- */

/**
 * @param {object} item
 * @param {Localizer} i18n
 * @param {string} description
 * @returns {ItemView}
 */
function weaponView(item, i18n, description) {
  const system = item.system;
  const category = FEO.weaponCategories[system.category] ?? {};
  const sections = [];

  sections.push({
    title: i18n.localize("FEO.Section.weaponStats"),
    cells: [
      { abbr: i18n.localize("FEO.Weapon.mightAbbr"), label: i18n.localize("FEO.Weapon.might"), value: system.might },
      { abbr: i18n.localize("FEO.Weapon.hit"), value: system.hit },
      { abbr: i18n.localize("FEO.Weapon.critAbbr"), label: i18n.localize("FEO.Weapon.crit"), value: system.crit },
      {
        abbr: i18n.localize("FEO.Weapon.rangeAbbr"),
        label: i18n.localize("FEO.Weapon.range"),
        value: system.range || "–",
        css: String(system.range).length > 4 ? "word" : ""
      },
      { abbr: i18n.localize("FEO.Weapon.weightAbbr"), label: i18n.localize("FEO.Weapon.weight"), value: system.weight },
      {
        abbr: i18n.localize("FEO.Weapon.uses"),
        label: i18n.localize("FEO.Weapon.usesCurrent"),
        value: usesLeft(system.uses),
        css: (system.uses.max > 0) && (system.uses.value <= 0) ? "down" : ""
      }
    ]
  });

  // What a staff counter-attacks with at 1 range
  const counter = system.counter ?? {};
  if ( Object.values(counter).some((value) => (value ?? null) !== null) ) {
    sections.push({
      title: i18n.localize("FEO.Weapon.counter"),
      cells: [
        { abbr: i18n.localize("FEO.Weapon.mightAbbr"), label: i18n.localize("FEO.Weapon.might"), value: counter.might ?? "–" },
        { abbr: i18n.localize("FEO.Weapon.hit"), value: counter.hit ?? "–" },
        { abbr: i18n.localize("FEO.Weapon.critAbbr"), label: i18n.localize("FEO.Weapon.crit"), value: counter.crit ?? "–" }
      ]
    });
  }

  const pairs = [{ label: i18n.localize("FEO.Weapon.rank"), value: i18n.localize(FEO.ranks[system.rank] ?? system.rank) }];
  if ( (system.level ?? null) !== null ) pairs.push({ label: i18n.localize("FEO.Weapon.level"), value: system.level });
  pairs.push(
    { label: i18n.localize("FEO.Weapon.damageStat"), value: i18n.localize(FEO.damageStats[system.damageStat] ?? "") },
    { label: i18n.localize("FEO.Weapon.cost"), value: gold(system.cost) },
    { label: i18n.localize("FEO.Weapon.wexp"), value: system.wexp }
  );
  if ( FEO.optional?.weaponKills?.enabled ) pairs.push({ label: i18n.localize("FEO.Optional.kills.source"), value: system.kills });
  sections.push({ title: i18n.localize("FEO.Section.itemDetails"), pairs });
  describe(sections, description, i18n);

  return {
    name: item.name,
    dye: PROFICIENCY_DYES[category.proficiency ?? system.category] ?? RACE_DYES[system.category]
      ?? (category.magic ? "violet" : "slate"),
    art: artOf(item),
    emblem: icon(CATEGORY_ICONS[system.category] ?? FEO.categoryIcons[system.category] ?? "sword"),
    ribbon: i18n.localize(category.label ?? "TYPES.Item.weapon"),
    sub: line(
      i18n.format("FEO.Weapon.rankOf", { rank: i18n.localize(FEO.ranks[system.rank] ?? system.rank) }),
      item.actor && system.equipped ? i18n.localize("FEO.Combat.equipped") : ""
    ),
    effect: system.effect,
    sections
  };
}

/* -------------------------------------------- */
/*  Carried Items                               */
/* -------------------------------------------- */

/**
 * @param {object} item
 * @param {Localizer} i18n
 * @param {string} description
 * @returns {ItemView}
 */
function gearView(item, i18n, description) {
  const system = item.system;
  const sections = [];
  const pairs = [];
  if ( !system.equip || (system.uses.max > 0) ) pairs.push({ label: i18n.localize("FEO.Weapon.uses"), value: usesLeft(system.uses) });
  pairs.push({ label: i18n.localize("FEO.Weapon.cost"), value: gold(system.cost) });
  if ( system.restore > 0 ) pairs.push({ label: i18n.localize("FEO.Item.restore"), value: system.restore });
  sections.push({ title: i18n.localize("FEO.Section.itemDetails"), pairs });
  describe(sections, description, i18n);

  return {
    name: item.name,
    dye: "umber",
    art: artOf(item),
    emblem: icon(GEAR_ICONS.find(([pattern]) => pattern.test(item.folder?.name ?? ""))?.[1] ?? "flask"),
    ribbon: i18n.localize("TYPES.Item.gear"),
    sub: system.equip ? i18n.localize("FEO.Item.equip") : "",
    effect: system.effect,
    sections
  };
}

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

/**
 * How a skill that is chosen when to activate is used and, on a unit, where it stands. A skill that is not
 * chosen when to activate has nothing to say.
 * @param {object} item
 * @param {Localizer} i18n
 * @returns {{label: string, value: string|number}[]}
 */
export function usagePairs(item, i18n) {
  const { usage, state } = item.system;
  if ( !usage?.kind ) return [];
  const turns = (count) => i18n.format("FEO.Usage.turns", { turns: count });
  const pairs = [{ label: i18n.localize("FEO.Usage.kindLabel"), value: i18n.localize(FEO.skillUsage[usage.kind] ?? "") }];
  if ( usage.cooldown > 0 ) pairs.push({ label: i18n.localize("FEO.Usage.cooldownRow"), value: turns(usage.cooldown) });
  if ( usage.lasts > 0 ) pairs.push({ label: i18n.localize("FEO.Usage.lastsRow"), value: turns(usage.lasts) });
  if ( usage.uses > 0 ) {
    pairs.push({
      label: i18n.localize("FEO.Usage.usesRow"),
      value: usage.per ? `${usage.uses} ${i18n.localize(FEO.skillPeriods[usage.per] ?? "")}` : usage.uses
    });
  }
  if ( item.actor && state ) {
    if ( usage.kind === "toggle" ) {
      pairs.push({
        label: i18n.localize("FEO.Usage.activeState"),
        value: i18n.localize(state.active ? "FEO.Usage.on" : "FEO.Usage.off")
      });
    }
    if ( state.cooldown > 0 ) pairs.push({ label: i18n.localize("FEO.Usage.cooldownState"), value: turns(state.cooldown) });
    if ( state.lasting > 0 ) pairs.push({ label: i18n.localize("FEO.Usage.lastingState"), value: turns(state.lasting) });
    if ( (usage.uses > 0) && (state.used > 0) ) {
      pairs.push({ label: i18n.localize("FEO.Usage.usedState"), value: `${state.used}/${usage.uses}` });
    }
  }
  return pairs;
}

/* -------------------------------------------- */

/**
 * What a chance to activate is read from, in words: "DEX", "DEX ÷ 2", "LVL".
 * @param {{stat?: string, div?: number, times?: number}} basis     As `activationOf` gives it
 * @param {Localizer} i18n
 * @returns {string}
 */
export function basisLabel({ stat, div = 1, times = 1 }, i18n) {
  const rule = FEO.optional.alternateActivation;
  const key = FEO.activationStats[stat] ?? FEO.stats[stat]?.abbr ?? ((stat === rule.level) ? rule.levelAbbr : null);
  let label = i18n.localize(key ?? stat ?? "");
  if ( times !== 1 ) label = `${label} × ${times}`;
  return (div > 1) ? `${label} ÷ ${div}` : label;
}

/* -------------------------------------------- */

/**
 * @param {object} item
 * @param {Localizer} i18n
 * @param {string} description
 * @returns {ItemView}
 */
function skillView(item, i18n, description) {
  const system = item.system;
  const sections = [];

  const marks = skillMarks(system, i18n);
  if ( marks.length ) sections.push({ title: i18n.localize("FEO.Compendium.skills.marks"), marks });

  const prerequisite = statedPrerequisite(system.prerequisite);
  sections.push({
    title: i18n.localize("FEO.Skill.prerequisite"),
    text: prerequisite || i18n.localize("FEO.Compendium.skills.noPrerequisite"),
    none: !prerequisite
  });

  // How a skill that is chosen when to activate is used and, on a unit, where it stands
  const used = usagePairs(item, i18n);
  if ( used.length ) sections.push({ title: i18n.localize("FEO.Usage.title"), pairs: used });

  // Its chance to activate, which only a skill on a unit has. Where the world plays with Alternate Skill
  // Activation the stat is the one the chance is read from then, and the section says so
  const chance = system.chance ?? null;
  const rolls = system.activation?.stat;
  if ( rolls || (chance !== null) ) {
    const pairs = [];
    const proc = rolledProc(system);
    let changed = proc ? activationOf(proc).changed : false;
    if ( rolls ) {
      const basis = activationOf({ stat: system.activation.stat, div: system.activation.divisor });
      changed ||= basis.changed;
      pairs.push({ label: i18n.localize("FEO.Column.stat"), value: basisLabel(basis, i18n) });
    }
    if ( chance !== null ) pairs.push({ label: i18n.localize("FEO.Skill.chanceLabel"), value: `${chance}%` });
    sections.push({
      title: i18n.localize("FEO.Skill.activation"),
      ...(changed ? { hint: i18n.localize("FEO.Optional.alternateActivation.title") } : {}),
      pairs
    });
  }

  // Flat boosts while it is equipped
  const stats = Object.entries(FEO.stats).filter(([key]) => system.stats?.[key]);
  if ( stats.length ) {
    sections.push({
      title: i18n.localize("FEO.Skill.statBoosts"),
      hint: i18n.localize("FEO.Skill.boostHint"),
      cells: stats.map(([key, config]) => ({
        abbr: i18n.localize(config.abbr),
        label: i18n.localize(config.label),
        value: signed(system.stats[key]),
        css: gainCss(system.stats[key])
      }))
    });
  }
  const combat = Object.entries(FEO.combatBoosts).filter(([key]) => system.combat?.[key]);
  if ( combat.length ) {
    sections.push({
      title: i18n.localize("FEO.Section.combatBoosts"),
      hint: i18n.localize("FEO.Skill.boostHint"),
      pairs: combat.map(([key, label]) => ({ label: i18n.localize(label), value: signed(system.combat[key]) }))
    });
  }

  // What the system applies by itself, and what has been chosen for it to apply
  const effects = system.effects ?? [];
  if ( effects.length ) {
    const pairs = [];
    const unchosen = i18n.localize("FEO.Skill.choiceNone");
    if ( choicesOf(effects).length ) pairs.push({ label: i18n.localize("FEO.Skill.choice"), value: system.choice || unchosen });
    for ( const pick of growthPickFields(effects, system.choice) ?? [] ) {
      pairs.push({
        label: i18n.format("FEO.Skill.pick", { number: pick.number }),
        value: pick.value ? i18n.localize(pick.options[pick.value] ?? pick.value) : unchosen
      });
    }
    sections.push({
      title: i18n.localize("FEO.Skill.automation"),
      text: system.automate === false
        ? i18n.localize("FEO.Skill.automateOff")
        : i18n.format("FEO.Skill.effectsCount", { count: effects.length }),
      pairs
    });
  }
  describe(sections, description, i18n);

  const kind = i18n.localize(FEO.skillKinds[system.kind] ?? "");
  return {
    name: item.name,
    kind: system.kind,
    art: artOf(item),
    emblem: icon(KIND_ICONS[system.kind] ?? "spark"),
    ribbon: i18n.format("FEO.Compendium.skills.kind", { kind }),
    sub: line(
      system.capacity
        ? i18n.format("FEO.Compendium.skills.capacity", { cost: system.capacity })
        : i18n.localize("FEO.Compendium.skills.noCapacity"),
      item.actor && system.equipped ? i18n.localize("FEO.Combat.equipped") : ""
    ),
    effect: system.effect,
    sections
  };
}

/* -------------------------------------------- */
/*  Classes                                     */
/* -------------------------------------------- */

/**
 * @param {object} item
 * @param {Localizer} i18n
 * @param {string} description
 * @returns {ItemView}
 */
function classView(item, i18n, description) {
  const system = item.system;
  const cls = readClass(item);
  const context = buildClassContext(item);
  const tier = FEO.classTiers[system.tier] ?? FEO.classTiers.base;
  const sections = [];

  const cell = (stat, value, css = "") => ({ abbr: i18n.localize(stat.abbr), label: i18n.localize(stat.label), value, css });
  const stated = (stat) => cell(stat, stat.value ?? "–", stat.value === null ? "nil" : "");
  const weight = { abbr: i18n.localize("FEO.Compendium.sheet.classWt"), label: i18n.localize("FEO.Unit.classWt"), value: system.wt, box: "wt" };

  // Its numbers: what a new unit starts with, what promoting into it adds, or both
  const hasBase = context.showBase && context.base.some((stat) => stat.value !== null);
  const hasGains = context.showGains && (!hasBase || context.gains.some((stat) => stat.value));
  if ( hasBase ) {
    sections.push({
      title: i18n.localize("FEO.Class.base"),
      hint: i18n.localize("FEO.Class.baseHint"),
      cells: [...context.base.map(stated), weight]
    });
  }
  if ( hasGains ) {
    sections.push({
      title: i18n.localize("FEO.Class.gains"),
      hint: i18n.localize(context.gainsHint),
      cells: [...context.gains.map((stat) => cell(stat, signed(stat.value), gainCss(stat.value))), ...(hasBase ? [] : [weight])]
    });
  }
  if ( context.transformed.some((stat) => stat.value !== null) ) {
    sections.push({ title: i18n.localize("FEO.Class.transformed"), cells: context.transformed.map(stated) });
  }
  if ( context.caps.some((stat) => stat.value !== null) ) {
    sections.push({ title: i18n.localize("FEO.Class.caps"), cells: context.caps.map(stated) });
  }

  // Proficiencies, as the Class Sheet words them or else by name
  const { options, choose, note } = system.proficiencies;
  const proficiencies = note || options.map((key) => i18n.localize(FEO.proficiencies[key] ?? key)).join(", ");
  sections.push({
    title: i18n.localize(context.showBase ? "FEO.Class.proficiencies" : "FEO.Class.proficienciesGained"),
    text: proficiencies || i18n.localize(context.showBase ? "FEO.Compendium.sheet.noProficiencies" : "FEO.Compendium.sheet.noProficienciesGained"),
    none: !proficiencies,
    pairs: proficiencies && (choose > 0) ? [{ label: i18n.localize("FEO.Class.choose"), value: choose }] : []
  });

  const skills = Object.keys(SLOT_LABELS).filter((slot) => String(system.skills[slot] ?? "").trim()).map((slot) => ({
    slot,
    icon: icon(SLOT_ICONS[slot]),
    name: system.skills[slot].trim(),
    label: i18n.localize(SLOT_LABELS[slot])
  }));
  sections.push({
    title: i18n.localize("FEO.Compendium.sheet.skills"),
    skills,
    text: skills.length ? "" : i18n.localize("FEO.Compendium.sheet.noSkills"),
    none: true
  });

  sections.push({
    title: i18n.localize("FEO.Unit.specialQualities"),
    chips: cls.qualities.map((name) => ({ name, quality: true })),
    text: cls.qualities.length ? "" : i18n.localize("FEO.Compendium.sheet.noQualities"),
    none: true
  });

  const notes = cls.notes.filter((entry) => entry.label || entry.value);
  if ( notes.length ) sections.push({ title: i18n.localize("FEO.Class.notes"), pairs: notes });

  // The classes it promotes to. One that is linked opens from here. A class that promotes to none either
  // keeps levelling, as those of a people that does not promote do, or is of the last tier
  const levelsOn = FEO.races[system.race]?.milestones || (context.showBase && skills.some((skill) => skill.slot !== "starting"));
  const targets = system.promotesTo.map((target, index) => ({
    name: target.name,
    index,
    linked: !!target.uuid,
    note: target.uuid ? "" : i18n.localize("FEO.Class.byName")
  })).filter((target) => target.name);
  sections.push({
    title: i18n.localize("FEO.Class.promotesTo"),
    chips: targets,
    text: targets.length ? "" : i18n.localize(levelsOn ? "FEO.Class.noPromotions" : "FEO.Compendium.sheet.lastTier"),
    none: true
  });

  const coat = heraldry(cls);
  return {
    name: item.name,
    dye: coat.dye,
    crest: crestHtml({ order: tier.order, ...coat }),
    emblem: "",
    ribbon: i18n.localize(tier.label),
    sub: line(item.folder?.name, i18n.localize(FEO.races[system.race]?.label ?? "")),
    lore: plainText(description) ? description : "",
    sections
  };
}

/* -------------------------------------------- */
/*  Combat Arts                                 */
/* -------------------------------------------- */

/**
 * What the system reads from a Combat Art's Effect, in words: each part it applies by itself, and the text it
 * leaves to the table.
 * @param {object} system         The Art's data
 * @param {Localizer} i18n
 * @returns {{applied: string[], left: string}}
 */
export function artReading(system, i18n) {
  if ( system.automate === false ) return { applied: [], left: system.effect ?? "" };
  const read = readArtItem(system);
  const part = (key, data = {}) => i18n.format(`FEO.Optional.combatArts.reads.${key}`, data);
  const applied = [];
  for ( const key of ["might", "hit", "critical", "dodge", "critAvoid"] ) {
    if ( read[key] ) applied.push(part(key, { amount: signed(read[key]) }));
  }
  if ( read.strikes > 1 ) applied.push(part("strikes", { strikes: read.strikes }));
  if ( read.effective.length ) applied.push(part("effective", { qualities: read.effective.join(", ") }));
  if ( read.range?.add ) applied.push(part("rangeAdd", { amount: read.range.add }));
  if ( read.range?.max ) {
    applied.push(part("range", { range: (read.range.min === read.range.max) ? read.range.max : `${read.range.min}–${read.range.max}` }));
  }
  if ( read.noFollowUp ) applied.push(part("noFollowUp"));
  if ( read.foeNoCounter ) applied.push(part("foeNoCounter"));
  if ( read.spare ) applied.push(part("spare"));
  if ( read.persist ) applied.push(part("persist"));
  if ( read.effects.length ) applied.push(part("effects", { count: read.effects.length }));
  return { applied, left: read.left };
}

/* -------------------------------------------- */

/**
 * @param {object} item
 * @param {Localizer} i18n
 * @param {string} description
 * @returns {ItemView}
 */
function artView(item, i18n, description) {
  const system = item.system;
  const config = FEO.optional.combatArts;
  const cost = readCost(system.cost);
  const price = [];
  if ( cost.hp > 0 ) price.push(i18n.format("FEO.Optional.combatArts.cost.hp", { amount: cost.hp }));
  if ( cost.uses > 0 ) price.push(i18n.format("FEO.Optional.combatArts.cost.uses", { amount: cost.uses }));

  const pairs = [
    { label: i18n.localize("FEO.Optional.combatArts.field.type"), value: i18n.localize(config.types[system.type] ?? "") },
    {
      label: i18n.localize("FEO.Weapon.rank"),
      value: system.rank ? i18n.localize(FEO.ranks[system.rank]) : i18n.localize("FEO.Optional.combatArts.innate")
    },
    { label: i18n.localize("FEO.Optional.combatArts.field.cost"), value: price.length ? price.join(", ") : i18n.localize("FEO.Optional.combatArts.cost.none") }
  ];
  if ( system.also ) pairs.push({ label: i18n.localize("FEO.Optional.combatArts.field.also"), value: system.also });
  const sections = [{ title: i18n.localize("FEO.Optional.combatArts.title"), pairs }];

  // What the system applies of it by itself, and what it leaves to the table
  const reading = artReading(system, i18n);
  if ( reading.applied.length ) sections.push({ title: i18n.localize("FEO.Optional.combatArts.applied"), text: reading.applied.join(" · ") });
  if ( reading.left ) sections.push({ title: i18n.localize("FEO.Optional.combatArts.byHand"), text: reading.left });
  describe(sections, description, i18n);

  return {
    name: item.name,
    dye: "umber",
    art: artOf(item),
    emblem: icon("crossed"),
    ribbon: i18n.localize("TYPES.Item.art"),
    sub: (item.actor && system.readied) ? i18n.localize("FEO.Optional.combatArts.readied") : "",
    effect: system.effect,
    sections
  };
}

/* -------------------------------------------- */
/*  Battalions                                  */
/* -------------------------------------------- */

/**
 * @param {object} item
 * @param {Localizer} i18n
 * @param {string} description
 * @returns {ItemView}
 */
function battalionView(item, i18n, description) {
  const system = item.system;
  const config = FEO.optional.battalions;
  const at = (key, data = {}) => i18n.format(`FEO.Optional.battalions.${key}`, data);
  const gambit = system.gambit;
  const offensive = gambit.kind === "offensive";

  const pairs = [
    { label: at("authorityRank"), value: i18n.localize(FEO.ranks[system.rank] ?? "") },
    { label: i18n.localize("FEO.Unit.level"), value: (system.level >= config.levels.max) ? system.level : at("levelOf", { level: system.level, exp: system.exp, next: config.levels.exp }) },
    { label: at("field.hpMax"), value: `${system.hp.value} / ${system.hp.max}` }
  ];
  if ( system.quality ) pairs.push({ label: at("field.quality"), value: system.quality });
  if ( system.cost ) pairs.push({ label: i18n.localize("FEO.Weapon.cost"), value: gold(system.cost) });
  const sections = [{ title: i18n.localize("TYPES.Item.battalion"), pairs }];

  // What it adds to its commander at its level, with what each number gains per level up
  const cells = bonusKeys().filter((key) => system.bonuses[key].base || system.bonuses[key].perLevel).map((key) => {
    const now = bonusAt(system.bonuses[key], system.level);
    const grows = system.bonuses[key].perLevel;
    return {
      abbr: i18n.localize(bonusLabel(key)),
      label: grows ? at("perLevelUp", { amount: grows }) : "",
      value: signed(now),
      css: gainCss(now)
    };
  });
  if ( cells.length ) sections.push({ title: at("field.bonuses"), hint: at("levelShort", { level: system.level }), cells });

  // Its Gambit, what the system applies of the Effect by itself, and what it leaves to the table
  const about = [{ label: at("field.kind"), value: i18n.localize(config.gambit.kinds[gambit.kind] ?? "") }];
  if ( offensive ) about.push(
    { label: i18n.localize("FEO.Weapon.might"), value: gambit.might },
    { label: i18n.localize("FEO.Combat.hit"), value: gambit.hit }
  );
  about.push(
    { label: i18n.localize("FEO.Weapon.uses"), value: usesLeft(gambit.uses) },
    { label: i18n.localize("FEO.Weapon.range"), value: gambit.range || "–" }
  );
  if ( gambit.area ) about.push({ label: at("field.area"), value: gambit.area });
  sections.push({ title: gambit.name ? `${at("gambit")}: ${gambit.name}` : at("gambit"), pairs: about, text: gambit.effect });
  const reading = gambitReading(readGambit(gambit.effect), i18n);
  if ( reading.applied.length ) sections.push({ title: i18n.localize("FEO.Optional.combatArts.applied"), text: reading.applied.join(" · ") });
  if ( reading.left ) sections.push({ title: i18n.localize("FEO.Optional.combatArts.byHand"), text: reading.left });
  describe(sections, description, i18n);

  return {
    name: item.name,
    dye: "slate",
    art: artOf(item),
    emblem: icon("company"),
    ribbon: i18n.localize("TYPES.Item.battalion"),
    sub: hasRetreated(system) ? at("retreated") : (item.actor && system.equipped) ? at("assigned") : "",
    sections
  };
}

/* -------------------------------------------- */
/*  Any Item                                    */
/* -------------------------------------------- */

/**
 * Build the display data of an item's sheet while it is read.
 * @param {object} item                   An Item, or anything shaped like one: its name, image, type, system
 *                                        data, and the actor that carries it if one does
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {string} [options.description]  Its description, as enriched HTML
 * @returns {ItemView}
 */
export function buildItemView(item, i18n, { description = "" } = {}) {
  const build = { weapon: weaponView, skill: skillView, class: classView, art: artView, battalion: battalionView }[item.type] ?? gearView;
  return build(item, i18n, description);
}

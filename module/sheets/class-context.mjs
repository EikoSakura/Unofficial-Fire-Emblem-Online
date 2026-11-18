import { FEO } from "../config.mjs";
import {
  checkGrowths, classSkills, increaseGrowths, levelsOn, lineProficiencies, lineStats, planReclass, splitNames,
  startingProficiencies
} from "../rules/classes.mjs";

/**
 * Display data for classes: the class sheet, the class path on a unit's Growth tab, the dialogs for taking a
 * class and for promoting, and the chat card that lists what changed.
 * Nothing here touches Foundry, so that it can be exercised outside of it. Where text has to be put together,
 * it is localized through whatever `i18n` is passed in.
 *
 * @import {ClassChange, ClassLike} from "../rules/classes.mjs"
 * @import {Localizer} from "../helpers/exchange-context.mjs"
 */

/** The label of a stat key, which may be "hp" or "wt". */
const statAbbr = (key) => `FEO.Stat.${key}.abbr`;
const statLabel = (key) => `FEO.Stat.${key}.label`;

/** The label of each skill a class lists, by where it is kept. */
const SKILL_LABELS = {
  starting: "FEO.Class.skill.starting",
  promotion: "FEO.Class.skill.promotion",
  occult: "FEO.Class.skill.occult",
  mastery: "FEO.Class.skill.mastery"
};

/** A number with its sign, using a true minus. */
const signed = (value) => (value > 0 ? `+${value}` : String(value).replace("-", "−"));

/* -------------------------------------------- */
/*  Class Sheet                                 */
/* -------------------------------------------- */

/**
 * Build the display data for a class's own sheet.
 * @param {ClassLike} item
 * @returns {object}
 */
export function buildClassContext(item) {
  const system = item.system;
  const tier = FEO.classTiers[system.tier];
  const starting = tier.order <= FEO.classTiers.base.order;
  const cells = (object, keys = FEO.classStats) => keys.map((key) => ({
    key,
    abbr: statAbbr(key),
    label: statLabel(key),
    value: object[key]
  }));
  const transformed = cells(system.transformed, [...FEO.classStats, "wt"]);

  return {
    tiers: Object.fromEntries(Object.entries(FEO.classTiers).map(([key, config]) => [key, config.label])),
    races: Object.fromEntries(Object.entries(FEO.races).map(([key, config]) => [key, config.label])),
    showBase: starting,
    showGains: tier.order >= FEO.classTiers.base.order,
    gainsHint: starting ? "FEO.Class.gainsFromTrainee" : "FEO.Class.gainsHint",
    showTransformed: !!FEO.races[system.race]?.milestones || transformed.some((cell) => cell.value !== null),
    base: cells(system.base),
    gains: cells(system.gains),
    caps: cells(system.caps),
    transformed,
    proficiencyChoices: Object.entries(FEO.proficiencies).map(([key, label]) => ({
      key,
      label,
      checked: system.proficiencies.options.includes(key)
    })),
    rankChoices: Object.fromEntries(Object.entries(FEO.ranks).slice(1)),
    skillFields: Object.entries(SKILL_LABELS).map(([key, label]) => ({ key, label, value: system.skills[key] })),
    promotesTo: system.promotesTo.map((target, index) => ({ index, name: target.name, uuid: target.uuid })),
    notes: system.notes.map((note, index) => ({ index, label: note.label, value: note.value }))
  };
}

/* -------------------------------------------- */
/*  Class Path                                  */
/* -------------------------------------------- */

/**
 * The levels a unit spends in a class of a tier.
 * @param {object} tier                 An entry of FEO.classTiers
 * @param {boolean} promotes            Does the class promote?
 * @returns {{label: string, from: number, to: number|null}}
 */
function levelSpan(tier, promotes) {
  const from = tier.startLevel ?? 1;
  const to = promotes ? (tier.promoteAt ?? null) : null;
  return { label: to === null ? "FEO.Class.levelsFrom" : "FEO.Class.levels", from, to };
}

/**
 * One class as a step on the path.
 * @param {ClassLike} cls
 * @param {"done"|"now"|"option"} state
 * @returns {object}
 */
function classStep(cls, state) {
  const system = cls.system;
  const tier = FEO.classTiers[system.tier] ?? FEO.classTiers.base;
  const promotes = system.promotesTo.length > 0;
  const slot = tier.skill ?? "starting";
  const tag = { promotion: null, mastery: "FEO.SkillKind.mastery", starting: null }[slot];
  const skills = splitNames(system.skills[slot]).map((name) => ({ name, tag }));
  const span = levelSpan(tier, promotes);
  return {
    state,
    name: cls.name,
    itemId: state === "option" ? null : (cls.id ?? null),
    removable: state === "done",
    levels: state === "option" ? { label: "FEO.Class.level", from: span.from, to: null } : span,
    skills,
    gained: tier.order > FEO.classTiers.base.order ? system.proficiencies.options.map((key) => FEO.proficiencies[key]) : [],
    gainedLabel: state === "option" ? "FEO.Class.gainsProficiency" : "FEO.Class.gained",
    missing: false
  };
}

/**
 * Build the class path card: the classes a unit has been, the one it is, and what comes next.
 * @param {object} system                 Prepared UnitData
 * @param {object[]} classes              The unit's class Items
 * @param {(ClassLike|{name: string, missing: true})[]} [promotions]   The classes its current class promotes
 *                                        to, resolved by the sheet; those that could not be found carry only
 *                                        their name
 * @returns {object}
 */
export function buildClassPath(system, classes, promotions = []) {
  const current = classes.find((item) => item.id === system.classId) ?? null;
  if ( !current ) return { hasClass: false, steps: [], current: null, canPromote: false, promoteReady: false };
  const order = (item) => FEO.classTiers[item.system.tier]?.order ?? 0;
  const earlier = classes.filter((item) => item !== current).sort((a, b) => order(a) - order(b));
  const steps = [...earlier.map((item) => classStep(item, "done")), classStep(current, "now")];
  const promotes = current.system.promotesTo.length > 0;

  // What comes next: the classes it may promote to, or the skills it learns by levelling on
  if ( promotes ) {
    for ( const target of promotions ) {
      if ( target.missing ) {
        steps.push({ state: "option", name: target.name, itemId: null, levels: null, skills: [], gained: [], missing: true });
      }
      else steps.push(classStep(target, "option"));
    }
  }
  else if ( levelsOn(current) ) {
    for ( const [level, slot] of Object.entries(FEO.milestoneLevels) ) {
      const names = splitNames(current.system.skills[slot]);
      if ( !names.length ) continue;
      steps.push({
        state: system.level >= Number(level) ? "done" : "later",
        name: names.join(", "),
        itemId: null,
        levels: { label: "FEO.Class.level", from: Number(level), to: null },
        skills: [],
        gained: [],
        tag: SKILL_LABELS[slot],
        missing: false
      });
    }
  }

  // The Occult Skill belongs to the current class or, past the second tier, to the class before it
  const occult = [current, ...earlier.slice().reverse()].map((item) => splitNames(item.system.skills.occult))
    .find((names) => names.length);
  if ( occult ) {
    steps.push({
      state: system.level >= FEO.occultLevel ? "done" : "later",
      name: occult.join(", "),
      itemId: null,
      levels: { label: "FEO.Class.occultAt", from: FEO.occultLevel, to: null },
      skills: [],
      gained: [],
      tag: SKILL_LABELS.occult,
      missing: false
    });
  }

  const promoteAt = FEO.classTiers[current.system.tier]?.promoteAt ?? null;
  return {
    hasClass: true,
    steps,
    current: { itemId: current.id, name: current.name },
    canPromote: promotes && (promoteAt !== null),
    promoteReady: promotes && (promoteAt !== null) && (system.level >= promoteAt)
  };
}

/* -------------------------------------------- */
/*  Dialogs                                     */
/* -------------------------------------------- */

/**
 * A class's stats as a short list for a dialog.
 * @param {Record<string, number|null>} values
 * @param {object} [options]
 * @param {boolean} [options.gains]     Show values as gains, leaving out those that are zero
 * @returns {{abbr: string, value: string}[]}
 */
function statList(values, { gains = false } = {}) {
  return FEO.classStats.filter((key) => (gains ? values[key] : values[key] !== null)).map((key) => ({
    abbr: statAbbr(key),
    value: gains ? signed(values[key]) : String(values[key])
  }));
}

/**
 * Build the dialog that offers to apply a class to a unit.
 * @param {object} unit         The unit's saved data
 * @param {ClassLike} cls
 * @param {object} [options]
 * @param {boolean} [options.fresh]   Is this a new unit, so that everything is ticked to begin with?
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @returns {object}
 */
export function buildAssignDialog(unit, cls, { fresh = true, known = null } = {}) {
  const system = cls.system;
  const tier = FEO.classTiers[system.tier];
  const starting = tier.order <= FEO.classTiers.base.order;
  const ranks = startingProficiencies(cls);
  const choices = Object.fromEntries(["E", "D", "C"].map((rank) => [rank, FEO.ranks[rank]]));
  const qualities = splitNames(system.specialQualities);
  const { names: skills, choice: skillChoice } = classSkills(system.skills.starting, known);
  return {
    name: cls.name,
    tierLabel: tier.label,
    raceLabel: FEO.races[system.race]?.label,
    starting,
    fresh,
    replaces: unit.className && (unit.className !== cls.name) ? unit.className : null,
    stats: statList(system.base),
    hasStats: starting && FEO.classStats.some((key) => system.base[key] !== null),
    weight: system.wt,
    qualities: qualities.join(", "),
    hasQualities: qualities.length > 0,
    proficiencies: system.proficiencies.options.map((key) => ({
      key,
      label: FEO.proficiencies[key],
      rank: ranks[key] ?? "",
      choices
    })),
    hasProficiencies: starting && (system.proficiencies.options.length > 0),
    proficiencyNote: system.proficiencies.note,
    choose: system.proficiencies.choose,
    skills: skills.join(", "),
    skillOptions: skillChoice ? skills : null,
    hasSkills: starting && (skills.length > 0)
  };
}

/* -------------------------------------------- */

/**
 * Build the promotion dialog: one card per class the unit may promote to, and the growth rates to set.
 * @param {object} unit               The unit's saved data
 * @param {ClassLike|null} from       The class being left
 * @param {ClassLike[]} targets       The classes on offer
 * @param {object} [options]
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @param {string[]} [options.raisable]     The skills the unit has that can be raised in place of the skill of
 *                                          its new class
 * @returns {object}
 */
export function buildPromotionDialog(unit, from, targets, { known = null, raisable = [] } = {}) {
  const lowest = Object.keys(FEO.ranks)[0];
  const classes = targets.map((cls, index) => {
    const system = cls.system;
    const tier = FEO.classTiers[system.tier] ?? {};
    const { options, choose } = system.proficiencies;
    const skill = classSkills(system.skills[tier.skill], known);
    const open = options.filter((key) => unit.proficiencies[key]?.rank === lowest);
    const mustChoose = (choose > 0) && (open.length > choose);
    return {
      index,
      name: cls.name,
      checked: index === 0,
      description: String(system.description ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      tierLabel: tier.label,
      gains: statList(system.gains, { gains: true }),
      weight: system.wt,
      proficiencies: options.map((key, position) => ({
        key,
        label: FEO.proficiencies[key],
        known: !open.includes(key),
        checked: !mustChoose || (open.indexOf(key) < choose && open.includes(key)),
        position
      })),
      proficiencyNote: system.proficiencies.note,
      anyNew: open.length > 0,
      mustChoose,
      choose,
      newRank: FEO.ranks[tier.newRank] ?? null,
      skill: skill.names.join(", "),
      skillOptions: skill.choice ? skill.names : null,
      skillLabel: SKILL_LABELS[tier.skill] ?? SKILL_LABELS.promotion,
      generic: !!tier.generic,
      occult: splitNames(system.skills.occult).length ? String(system.skills.occult).trim() : "",
      qualities: splitNames(system.specialQualities).join(", ")
    };
  });

  const rule = FEO.promotionGrowth;
  const even = increaseGrowths(unit.growths, rule);
  const growths = Object.keys(FEO.growths).map((key) => ({
    key,
    abbr: FEO.growths[key],
    from: unit.growths[key],
    to: even[key],
    rises: rule.stats.includes(key)
  }));
  const check = checkGrowths(unit.growths, even);
  return {
    from: from?.name ?? unit.className ?? "",
    level: unit.level,
    classes,
    anyGeneric: classes.some((cls) => cls.generic),
    raisable,
    // A class that started the unit without a Generic Skill: it takes one now, in place of its starting skill
    genericFor: FEO.classTiers[from?.system.tier]?.noGeneric ? (classSkills(from.system.skills?.starting, known).names.join(", ") || "–") : "",
    growths,
    expected: check.expected,
    gain: rule.gain,
    reallocate: rule.reallocate,
    capBreak: rule.capBreak
  };
}

/* -------------------------------------------- */

/**
 * Build the dialog that asks which of the skills a class offers a unit learns.
 * @param {{names: string[], kind: string}} choice    One of a change's `choices`
 * @returns {object}
 */
export function buildSkillPickDialog(choice) {
  return {
    kindLabel: FEO.skillKinds[choice.kind] ?? FEO.skillKinds.class,
    options: choice.names.map((name, index) => ({ name, checked: index === 0 }))
  };
}

/* -------------------------------------------- */
/*  Chat Card                                   */
/* -------------------------------------------- */

/**
 * Build the dialog that offers the classes a unit can reclass into, each with what it changes.
 * @param {object} unit                 The unit's saved data
 * @param {ClassLike[]} from            The line of classes it holds, lowest tier first
 * @param {ClassLike[][]} lines         The lines it can reclass into, each ending in the class it would take
 * @param {object} [options]
 * @param {((name: string) => boolean)|null} [options.known]    Is this the name of a skill? See `classSkills`
 * @returns {object}
 */
export function buildReclassDialog(unit, from, lines, { known = null } = {}) {
  const before = lineStats(from);
  const held = lineProficiencies(from).options.filter((key) => unit.proficiencies[key]);
  const classes = lines.map((line, index) => {
    const target = line.at(-1);
    const system = target.system;
    const after = lineStats(line);
    const comparable = before.known && after.known;
    const offered = lineProficiencies(line);

    // What the reclass brings before any proficiency is traded: its skills, and the choices among them
    const plan = planReclass(unit, from, line, { known });
    return {
      index,
      name: target.name,
      checked: index === 0,
      line: line.map((cls) => cls.name).join(" → "),
      tierLabel: FEO.classTiers[system.tier]?.label,
      comparable,
      shifts: comparable ? FEO.classStats.filter((key) => after.stats[key] !== before.stats[key]).map((key) => ({
        abbr: statAbbr(key),
        value: signed(after.stats[key] - before.stats[key]),
        cls: after.stats[key] < before.stats[key] ? "bad" : ""
      })) : [],
      weight: signed(after.wt - before.wt) || "0",
      proficiencies: offered.options.map((key) => ({
        key,
        label: FEO.proficiencies[key],
        rank: FEO.ranks[unit.proficiencies[key]?.rank] ?? null
      })),
      most: offered.most,
      skills: (plan?.skills ?? []).map((skill) => skill.name).join(", "),
      choices: (plan?.choices ?? []).map((choice, at) => ({ at, names: choice.names })),
      occultWaits: plan?.occultWaits ?? "",
      qualities: plan?.qualities ? (plan.qualities.to || "–") : ""
    };
  });
  return {
    from: from.map((cls) => cls.name).join(" → ") || unit.className || "",
    classes,
    held: held.map((key) => ({ key, label: FEO.proficiencies[key], rank: FEO.ranks[unit.proficiencies[key].rank] ?? null })),
    occultLevel: FEO.occultLevel
  };
}

/* -------------------------------------------- */

/**
 * Build the chat card that lists everything a change did to a unit.
 * @param {ClassChange} change
 * @param {Localizer} i18n
 * @param {object} [options]
 * @param {string} [options.title]        The headline; one is chosen from the kind of change when left out
 * @param {string} [options.subtitle]
 * @param {string[]} [options.blank]      Names of learned skills that were added with nothing but a name
 * @param {string[]} [options.notes]      Lines to add at the foot of the card
 * @returns {{title: string, subtitle?: string, groups: {label: string, rows: object[]}[], notes: string[]}}
 */
export function buildChangeCard(change, i18n, { title, subtitle, blank = [], notes = [] } = {}) {
  const arrow = (from, to) => i18n.format("FEO.Class.card.fromTo", { from, to });
  const groups = [];
  const group = (label, rows) => {
    if ( rows.length ) groups.push({ label: i18n.localize(label), rows });
  };

  const general = [];
  if ( change.level ) general.push({ label: i18n.localize("FEO.Unit.level"), value: arrow(change.level.from, change.level.to) });
  if ( change.weight ) {
    general.push({ label: i18n.localize("FEO.Unit.classWt"), value: arrow(change.weight.from, change.weight.to) });
  }
  if ( change.qualities ) {
    const swapped = change.qualities.removed?.length > 0;
    general.push({
      label: i18n.localize("FEO.Unit.specialQualities"),
      value: swapped
        ? arrow(change.qualities.from || "–", change.qualities.to || "–")
        : i18n.format("FEO.Class.card.added", { names: change.qualities.added.join(", ") }),
      cls: swapped ? "" : "good"
    });
  }
  group("FEO.Class.card.general", general);

  const stats = [];
  const statRow = (key, from, to) => ({
    label: i18n.localize(statAbbr(key)),
    value: `${arrow(from, to)} (${signed(to - from)})`,
    cls: to > from ? "good" : to < from ? "bad" : ""
  });
  if ( change.hpMax ) stats.push(statRow("hp", change.hpMax.from, change.hpMax.to));
  for ( const stat of change.stats ) stats.push(statRow(stat.key, stat.from, stat.to));
  group("FEO.Section.stats", stats);

  group("FEO.Section.ranks", change.proficiencies.map((proficiency) => ({
    label: i18n.localize(FEO.proficiencies[proficiency.key]),
    value: ["raised", "lowered"].includes(proficiency.reason)
      ? arrow(i18n.localize(FEO.ranks[proficiency.from]), i18n.localize(FEO.ranks[proficiency.to]))
      : i18n.format("FEO.Class.card.newRank", { rank: i18n.localize(FEO.ranks[proficiency.to]) }),
    cls: proficiency.reason === "raised" ? "" : (proficiency.reason === "lowered" ? "bad" : "good")
  })));

  group("FEO.Class.card.growths", change.growths.map((growth) => ({
    label: i18n.localize(FEO.growths[growth.key]),
    value: `${arrow(`${growth.from}%`, `${growth.to}%`)} (${signed(growth.to - growth.from)})`,
    cls: growth.to < growth.from ? "bad" : ""
  })));

  const skills = change.skills.map((skill) => ({
    label: i18n.localize(FEO.skillKinds[skill.kind] ?? FEO.skillKinds.class),
    value: skill.name,
    cls: "good"
  }));
  if ( change.genericSkill ) {
    skills.push({ label: i18n.localize("FEO.SkillKind.generic"), value: i18n.localize("FEO.Class.card.genericChoice") });
  }
  const forgets = change.forgets ?? [];
  for ( const name of forgets ) skills.push({ label: i18n.localize("FEO.Class.card.givenUp"), value: name, cls: "bad" });
  group("FEO.Section.skills", skills);

  const foot = [...notes];
  if ( blank.length ) foot.push(i18n.format("FEO.Class.card.blankSkills", { names: blank.join(", ") }));
  for ( const choice of change.choices ?? [] ) {
    foot.push(i18n.format("FEO.Class.card.choiceLeft", { names: choice.names.join(", ") }));
  }
  if ( change.genericSkill ) {
    foot.push(forgets.length ? i18n.format("FEO.Class.card.genericFor", { names: forgets.join(", ") }) : i18n.localize("FEO.Class.card.genericNote"));
  }

  const headline = title ?? i18n.format({
    assign: "FEO.Class.card.became",
    promote: "FEO.Class.card.promoted",
    milestone: "FEO.Class.card.gains",
    reclass: "FEO.Class.card.reclassed"
  }[change.kind], { name: change.className ?? "" });
  return { title: headline, subtitle, groups, notes: foot };
}

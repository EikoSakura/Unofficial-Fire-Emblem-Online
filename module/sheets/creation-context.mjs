import { findSkill } from "../apps/compendium-context.mjs";
import { FEO } from "../config.mjs";
import { startingRanksOf } from "../rules/classes.mjs";
import { isArmed } from "../rules/creation-fit.mjs";
import { abilityTotals, boonWorth, classOpen, creationState, pointCost, savedStat } from "../rules/creation.mjs";
import { AFFINITY_RANK, affinityEffectMode, affinityRankOf } from "../rules/optional.mjs";
import { givenSteps, raisedRank, readGiven } from "../rules/skill-ranks.mjs";

/**
 * What the Character Creator shows: its steps and where each stands, the step in view laid out for its
 * template, the notes left on it, and who else is looking.
 * Nothing here touches Foundry. A unit is read from its saved data, and the compendiums from the library the
 * Compendium keeps of them.
 *
 * @import {CreationRecord, TakenSkill} from "../rules/creation.mjs"
 */

const abbr = (key) => `FEO.Stat.${key}.abbr`;
const number = (value) => Number(value ?? 0).toLocaleString("en-US");
const signed = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "");

/** What the effect an Affinity builds into its unit goes by: "Tome Affinity". */
const affinityName = (affinity, i18n) => {
  return i18n.format("FEO.Optional.affinityEffect.name", { affinity: i18n.localize(FEO.affinities[affinity] ?? "") });
};

/* -------------------------------------------- */
/*  The header button and the banner            */
/* -------------------------------------------- */

/**
 * What the Creator's button in the window header shows of a unit, and the banner over its sheet when there is
 * something to pick up.
 * @param {object} options
 * @param {object} options.unit               The unit's saved data
 * @param {CreationRecord} options.record
 * @param {object|null} options.cls           The class the unit has
 * @param {TakenSkill[]} [options.skills]     The skills the Creator added to the unit, as they are now
 * @param {boolean} options.isGM
 * @param {object} options.i18n
 * @returns {{started: boolean, done: number, total: number, percent: number, finished: boolean, fresh: number,
 *   help: number, hint: string, banner: object|null, first: string}}
 */
export function creatorSummary({ unit, record, cls, skills = [], isGM, i18n }) {
  const state = creationState({ unit, record, cls, taken: skills });
  const started = !!record.status;
  const title = (id) => i18n.localize(`FEO.Creator.step.${id}.title`);
  const first = state.pending[0] ?? "review";
  const blank = !cls && (unit.hp.max === 0) && Object.values(unit.stats).every((stat) => stat.base === 0);

  let banner = null;
  if ( record.status === "draft" ) {
    banner = {
      kind: "draft",
      title: i18n.localize("FEO.Creator.banner.draft"),
      text: i18n.format("FEO.Creator.banner.draftText", { done: state.done, total: state.total, step: title(first) }),
      button: i18n.localize("FEO.Creator.banner.resume")
    };
  } else if ( (record.status === "complete") && state.pending.length ) {
    banner = {
      kind: "new",
      title: i18n.format(state.pending.length === 1 ? "FEO.Creator.banner.one" : "FEO.Creator.banner.many", { count: state.pending.length }),
      text: i18n.format(state.fresh.length ? "FEO.Creator.banner.rules" : "FEO.Creator.banner.open", { steps: state.pending.map(title).join(", ") }),
      button: i18n.localize("FEO.Creator.banner.openCreator")
    };
  } else if ( !started && blank ) {
    banner = {
      kind: "start",
      title: i18n.localize("FEO.Creator.banner.start"),
      text: i18n.localize("FEO.Creator.banner.startText"),
      button: i18n.localize("FEO.Creator.banner.begin")
    };
  }

  return {
    started,
    done: state.done,
    total: state.total,
    percent: started ? Math.round((state.done / state.total) * 100) : 0,
    finished: (record.status === "complete") && state.ready,
    fresh: started ? state.fresh.length : 0,
    help: isGM ? state.help.length : 0,
    hint: started ? i18n.format("FEO.Creator.button.hint", { done: state.done, total: state.total }) : i18n.localize("FEO.Creator.button.start"),
    banner,
    first
  };
}

/* -------------------------------------------- */
/*  The Creator                                 */
/* -------------------------------------------- */

/**
 * Build everything the Creator's template shows.
 * @param {object} options
 * @param {string} options.name               The unit's name
 * @param {object} options.unit               The unit's saved data
 * @param {CreationRecord} options.record
 * @param {object|null} options.cls           The class the unit has: an Item, or anything shaped like one
 * @param {TakenSkill[]} [options.skills]     The skills the Creator added to the unit, as they are now
 * @param {object} options.view               What this window is looking at: `step` and `draft`
 * @param {object|null} options.library       The Compendium's library, for what the unit's skills do
 * @param {{id: string, name: string, color: string, step: string}[]} options.watchers    Who else is looking
 * @param {{id: string, isGM: boolean}} options.user
 * @param {object} options.i18n
 * @returns {object}
 */
export function buildCreator({ name, unit, record, cls, skills = [], view, library, watchers = [], user, i18n }) {
  const state = creationState({ unit, record, cls, taken: skills });
  const steps = state.steps;
  const at = Math.max(steps.findIndex((step) => step.id === view.step), 0);
  const current = steps[at];
  const totals = abilityTotals(unit);
  const loc = (key) => i18n.localize(key);
  const title = (id) => loc(`FEO.Creator.step.${id}.title`);
  const rankLabel = (key) => loc(FEO.ranks[key] ?? key);
  const profLabel = (key) => loc(FEO.proficiencies[key] ?? key);
  const start = startingRanksOf(cls);

  // What the class gives, with the ranks the unit's skills add on top
  const extra = givenSteps(unit.skillRanks);
  const taken = record.ranks.take.map((key) => {
    return `${profLabel(key)} ${rankLabel(raisedRank(key === record.ranks.first ? start.first : start.others, extra[key]))}`;
  });
  const gradeLabel = (grade) => loc(`FEO.Optional.grade.${grade}`);
  const bloodName = record.holyBlood.lineage
    ? `${gradeLabel(record.holyBlood.grade)} ${loc(`FEO.Optional.blood.names.${record.holyBlood.lineage}`)}` : "";
  const crestName = record.crest.id ? `${gradeLabel(record.crest.grade)} ${loc(`FEO.Optional.crest.names.${record.crest.id}`)}` : "";

  // What each step says of itself in the list
  const noteData = (step) => {
    switch ( step.note ) {
      case "sources": return { cha: loc(abbr(unit.abilities.cha.source)), int: loc(abbr(unit.abilities.int.source)) };
      case "skills": return { skills: [record.skills.class.name, record.skills.generic.name].filter(Boolean).join(" · ") || "–" };
      case "ranks": return { ranks: taken.join(" · ") || "–" };
      case "goldLeft": case "goldToSpend": return { gold: number(unit.gold) };
      case "boonBane": return { boon: loc(abbr(unit.boon)), bane: loc(abbr(unit.bane)) };
      case "affinity": return { affinity: loc(FEO.affinities[unit.affinity] ?? "") };
      case "granted": case "waiting": return { name: step.id === "holyBlood" ? bloodName : crestName };
      default: return step.data;
    }
  };
  const there = (id) => watchers.filter((watcher) => watcher.step === id);

  const list = steps.map((step, index) => ({
    id: step.id,
    number: index + 1,
    title: title(step.id),
    note: i18n.format(`FEO.Creator.state.${step.note}`, noteData(step)),
    state: step.state,
    done: step.state === "done",
    mark: step.state === "issue" ? "!" : step.state === "wait" ? "…" : index + 1,
    current: step.id === current.id,
    locked: step.locked,
    fresh: step.fresh,
    module: !step.fresh && (!!step.module || step.extended),
    help: !!record.help[step.id],
    watchers: there(step.id)
  }));
  const work = list.filter((step) => step.id !== "review");

  // The step in view
  const moduleKey = current.module ?? (current.extended ? current.extendedBy : null);
  const setting = Object.entries(FEO.optionalSettings).find(([, key]) => key === moduleKey)?.[0];
  const context = { unit, record, cls, skills, state, totals, view, library, user, i18n, loc, name, taken, bloodName, crestName };
  const panel = current.locked ? { locked: true } : (PANELS[current.id]?.(context) ?? {});

  const asked = record.help[current.id] ?? "";
  const last = record.last.user && (record.last.user !== user.id) && record.last.step
    ? i18n.format("FEO.Creator.last", { name: record.last.name, step: title(record.last.step) }) : "";

  return {
    title: loc("FEO.Creator.title"),
    done: state.done,
    total: state.total,
    progress: i18n.format("FEO.Creator.progress", { done: state.done, total: state.total }),
    segments: work.map((step) => ({ state: step.state, current: step.current })),
    steps: list,
    step: {
      id: current.id,
      eyebrow: current.id === "review" ? loc("FEO.Creator.lastStep") : i18n.format("FEO.Creator.stepOf", { number: at + 1, total: state.total }),
      title: title(current.id),
      lead: panel.lead ?? loc(`FEO.Creator.step.${current.id}.lead`),
      module: setting ? i18n.format(current.module ? "FEO.Creator.module" : "FEO.Creator.extended", { name: loc(`FEO.Setting.${setting}.name`) }) : "",
      review: current.id === "review"
    },
    is: { [current.id]: true },
    panel,
    assist: {
      asked: !!asked,
      mine: asked === user.id,
      isGM: user.isGM,
      notes: record.notes.filter((note) => note.step === current.id),
      draft: view.draft ?? ""
    },
    watchers: watchers.map((watcher) => ({
      ...watcher,
      text: i18n.format("FEO.Creator.watching", { name: watcher.name, step: title(watcher.step) })
    })),
    alone: !watchers.length,
    last,
    hasPrev: at > 0,
    hasNext: (at < steps.length - 1) && !!cls,
    prev: steps[at - 1]?.id ?? "",
    next: steps[at + 1]?.id ?? ""
  };
}

/* -------------------------------------------- */
/*  The steps                                   */
/* -------------------------------------------- */

/** What the template of each step is given, by step. */
const PANELS = {

  class({ record, cls, i18n, loc }) {
    const open = classOpen(cls);
    if ( !cls ) return { open, none: true };
    const system = cls.system;
    // A CON that varies is shown once the unit's highest proficiency has given it
    const cells = FEO.classStats.map((key) => ({ abbr: loc(abbr(key)), value: system.base?.[key] ?? (((key === "con") && record.con) || "–") }));
    return {
      open,
      chosen: {
        name: cls.name,
        id: cls.id,
        sub: [FEO.classTiers[system.tier]?.label, FEO.races[system.race]?.label].filter(Boolean).map(loc).join(" · "),
        cells,
        proficiencies: system.proficiencies?.note ?? "",
        skills: system.skills?.starting ?? "",
        qualities: system.specialQualities ?? ""
      },
      wt: {
        base: system.wt ?? 0,
        total: (system.wt ?? 0) + record.wt,
        shown: signed(record.wt) || "0",
        canUp: record.wt < FEO.creation.weight,
        canDown: record.wt > -FEO.creation.weight,
        hint: i18n.format("FEO.Creator.class.weightHint", { amount: FEO.creation.weight })
      }
    };
  },

  sources({ unit, totals, i18n, loc }) {
    const abilities = Object.entries(FEO.abilities).map(([key, ability]) => {
      const mine = unit.abilities[key];
      const others = Object.keys(FEO.abilities).filter((other) => other !== key).map((other) => unit.abilities[other].source);
      return {
        key,
        label: i18n.format("FEO.Creator.sources.from", { ability: loc(ability.label) }),
        options: ability.sources.map((stat) => ({
          stat,
          abbr: loc(abbr(stat)),
          value: unit.stats[stat].base,
          pressed: mine.source === stat,
          disabled: others.includes(stat)
        })),
        formula: i18n.format(mine.increase ? "FEO.Creator.sources.formulaBonus" : "FEO.Creator.sources.formula", {
          ability: loc(ability.abbr), total: totals[key], stat: loc(abbr(mine.source)), value: unit.stats[mine.source].base, bonus: mine.increase
        })
      };
    });
    return { abilities };
  },

  skills({ record, cls, state, library, i18n, loc }) {
    const effect = (skill) => (library ? findSkill(library, skill)?.effect : "") ?? "";
    const offered = state.skills;

    // What a skill taken has its unit choose is asked right under it
    // A long list, or one whose options say what they do, is picked in the Compendium, as a class is
    const variants = (slot) => state.variants.filter((variant) => variant.slot === slot).map((variant) => {
      const growths = variant.kind === "growths";
      const data = { name: variant.label ? `${variant.name} · ${variant.label}` : variant.name, count: variant.count, picked: variant.picked.length };
      const options = variant.options.map((option) => ({
        value: option.value,
        label: option.localize ? loc(option.label) : option.label,
        hint: option.hint,
        pressed: variant.picked.includes(option.value)
      }));
      return {
        id: variant.id,
        index: variant.index,
        open: variant.open,
        long: (options.length > 4) || options.some((option) => option.hint),
        picked: options.filter((option) => option.pressed).map((option) => option.label).join(", "),
        title: i18n.format(`FEO.Creator.skills.${growths ? "growths" : variant.open ? "variantOpen" : "variant"}`, data),
        options
      };
    });
    const classSkills = {
      title: i18n.format(offered.choice ? "FEO.Creator.skills.chooseClass" : "FEO.Creator.skills.fromClass", { name: cls.name }),
      choice: offered.choice,
      none: !offered.names.length,
      variants: variants("class"),
      rows: offered.names.map((skill) => ({ name: skill, effect: effect(skill), pressed: !offered.choice || (record.skills.class.name === skill) }))
    };

    // The Generic Skill is taken from the Compendium's roll of skills; the step shows the one taken
    const chosen = record.skills.generic.name;
    const skill = library ? findSkill(library, chosen) : null;
    const picked = chosen ? {
      name: chosen,
      effect: skill?.effect ?? "",
      capacity: skill?.capacity ? i18n.format("FEO.Creator.skills.capacity", { cost: skill.capacity }) : ""
    } : null;

    // A Trainee starts without one. One taken before the unit became a Trainee is shown, to be given up
    if ( !state.generic ) {
      return { classSkills, lead: i18n.localize("FEO.Creator.step.skills.leadNoGeneric"), generic: null, surplus: picked };
    }
    return { classSkills, generic: { picked, missing: !library, variants: variants("generic") } };
  },

  ranks({ unit, record, cls, skills, taken, i18n, loc }) {
    const { options = [], choose = 0, note = "" } = cls.system.proficiencies ?? {};
    const label = (key) => loc(FEO.proficiencies[key] ?? key);

    // The ranks the starting skills have added, so that a rank above what the class gives explains itself
    const names = new Map(skills.map((skill) => [skill.id, skill.name]));
    if ( unit.affinity ) names.set(AFFINITY_RANK, affinityName(unit.affinity, i18n));
    const raised = readGiven(unit.skillRanks).filter((entry) => names.has(entry.item)).map((entry) => {
      return i18n.format("FEO.Creator.ranks.raised", { skill: names.get(entry.item), proficiency: label(entry.key), steps: entry.steps });
    });

    // A Trainee's proficiencies all start at the same rank, so none is chosen to start higher
    const start = startingRanksOf(cls);
    const level = start.first === start.others;

    // Where the class's CON varies: what each proficiency stands for, and what the unit has for its highest
    const conOf = (key) => {
      const con = cls.system.conBy?.[key] ?? null;
      return (cls.system.base?.con ?? null) === null && (con !== null) ? `${loc(abbr("con"))} ${con}` : "";
    };
    return {
      lead: level ? i18n.format("FEO.Creator.step.ranks.leadLevel", { rank: loc(FEO.ranks[start.others] ?? "") }) : undefined,
      note: note ? i18n.format("FEO.Creator.ranks.gives", { name: cls.name, note }) : "",
      choose: choose > 0 ? {
        title: i18n.format("FEO.Creator.ranks.take", { count: choose }),
        options: options.map((key) => ({ key, label: label(key), con: conOf(key), pressed: record.ranks.take.includes(key) }))
      } : null,
      first: !level && (record.ranks.take.length > 1)
        ? record.ranks.take.map((key) => ({ key, label: label(key), con: conOf(key), pressed: record.ranks.first === key })) : null,
      firstTitle: i18n.format("FEO.Creator.ranks.first", { rank: loc(FEO.ranks[start.first] ?? "") }),
      result: record.ranks.take.map((key) => ({ label: label(key), rank: loc(FEO.ranks[unit.proficiencies[key]?.rank] ?? "") })),
      con: record.con ? { label: loc(abbr("con")), value: record.con } : null,
      raised,
      none: !options.length,
      taken
    };
  },

  gold({ unit, record, cls, taken }) {
    // Weapons and items are bought from the Compendium's armoury; the step shows the Gold left and what was
    // bought. A unit that has taken no proficiency yet finds next to nothing it can wield, and is told why
    return {
      left: number(unit.gold),
      total: number(FEO.creation.gold),
      purchases: record.purchases.map((purchase) => ({ ...purchase, cost: number(purchase.cost) })),
      wields: taken.join(" · "),
      unranked: !isArmed(unit, cls)
    };
  },

  bonus({ unit, record, state, totals, i18n, loc }) {
    const rule = FEO.creation.bonus;
    const rows = rule.stats.map((key) => {
      const points = record.bonus[key] ?? 0;
      const cost = pointCost(key);
      const mind = key in FEO.abilities;
      const now = mind ? totals[key] : savedStat(unit, key);
      return {
        key,
        abbr: loc(abbr(key)),
        doubled: cost > 1 ? `×${cost}` : "",
        from: now - points,
        to: points ? now : null,
        source: mind ? i18n.format("FEO.Creator.bonus.from", { stat: loc(abbr(unit.abilities[key].source)) }) : "",
        points,
        canUp: (points < rule.perStat) && (state.bonusLeft >= cost),
        canDown: points > 0
      };
    });
    return {
      left: state.bonusLeft,
      placed: state.bonusLeft === 0,
      points: rule.points,
      perStat: i18n.format("FEO.Creator.bonus.perStat", { count: rule.perStat }),
      costly: rule.costly.length
        ? i18n.format("FEO.Creator.bonus.costly", { stats: rule.costly.map((key) => loc(abbr(key))).join(", "), cost: rule.cost })
        : "",
      rows
    };
  },

  growths({ state, i18n, loc }) {
    const budget = state.growth;
    const step = FEO.creation.growth.step;
    const rows = budget.rows.map((row) => {
      const room = budget.freeLeft + (row.mind ? budget.abilityLeft : 0);
      return {
        key: row.key,
        abbr: loc(abbr(row.key)),
        value: row.value,
        cap: i18n.format("FEO.Creator.growths.cap", { cap: row.cap }),
        percent: Math.min(row.value / row.cap, 1) * 100,
        shift: row.shift ? i18n.format(row.shift > 0 ? "FEO.Creator.growths.boon" : "FEO.Creator.growths.bane", { amount: Math.abs(row.shift) }) : "",
        module: row.key in FEO.optionalGrowths,
        canUp: (row.value + step <= row.cap) && (room >= step),
        canDown: row.value - step >= row.start
      };
    });
    return {
      free: budget.freeLeft,
      freeTotal: budget.freeTotal,
      freeDone: budget.freeLeft === 0,
      abilities: budget.abilityLeft,
      abilitiesTotal: FEO.creation.growth.abilities,
      abilitiesDone: budget.abilityLeft === 0,
      total: budget.total,
      rows
    };
  },

  boon({ unit, i18n, loc }) {
    const growth = FEO.creation.boon.growth;
    const effect = (key, sign) => {
      if ( !key ) return loc("FEO.Creator.boon.none");
      return i18n.format("FEO.Creator.boon.effect", {
        sign, amount: boonWorth(key), stat: loc(abbr(key)), growth, cap: FEO.boonCap[key] ?? FEO.boonCap.default
      });
    };
    const side = (which, sign) => {
      const other = which === "boon" ? unit.bane : unit.boon;
      return {
        which,
        title: loc(`FEO.Growth.${which}`),
        options: [
          { key: "", label: loc("FEO.Creator.none"), pressed: !unit[which], disabled: false },
          ...FEO.boonStats.map((key) => ({
            key,
            label: loc(abbr(key)),
            pressed: unit[which] === key,
            disabled: (key === other) || ((which === "bane") && (unit[which] !== key) && (savedStat(unit, key) <= 0))
          }))
        ],
        effect: effect(unit[which], sign)
      };
    };
    return { sides: [side("boon", "+"), side("bane", "−")] };
  },

  abilities({ unit, state, totals, i18n, loc }) {
    const budget = state.points;
    const groups = Object.entries(FEO.abilityGroups).map(([group, label]) => ({
      label: loc(label),
      rows: Object.entries(FEO.abilityChecks).filter(([, check]) => check.group === group).map(([key]) => {
        const check = unit.checks[key];
        const room = budget.generalLeft + (group === "saves" ? budget.savesLeft : 0);
        return {
          key,
          label: loc(`FEO.Ability.${key}`),
          stat: loc(abbr(check.stat)),
          points: check.points,
          canUp: (check.points < budget.limit) && (room > 0),
          canDown: check.points > 0
        };
      })
    }));
    const higher = totals.cha >= totals.int ? "cha" : "int";
    return {
      general: budget.generalLeft,
      generalTotal: budget.general,
      generalDone: budget.generalLeft === 0,
      saves: budget.savesLeft,
      savesTotal: budget.saves,
      savesDone: budget.savesLeft === 0,
      limit: budget.limit,
      basis: i18n.format("FEO.Creator.abilities.basis", { per: FEO.creation.pointsPer, ability: loc(abbr(higher)), value: totals[higher] }),
      groups
    };
  },

  affinity({ unit, i18n, loc }) {
    const boosts = (key) => Object.entries(FEO.affinityBoosts[key] ?? {}).map(([boost, amount]) => {
      return `+${amount} ${loc(`FEO.Creator.boost.${boost}`)}`;
    }).join(", ");
    // Additional Affinity Effects: what each Affinity builds into its unit, and how much of it the system does
    const effect = (key) => {
      const mode = affinityEffectMode(key);
      return mode ? `${loc(`FEO.Optional.affinityEffect.text.${key}`)} ${loc(`FEO.Optional.affinityEffect.mode.${mode}`)}` : "";
    };
    const tile = ([key, label]) => ({
      key, label: loc(label), icon: FEO.affinityIcons?.[key] ?? "spark", boosts: boosts(key), pressed: unit.affinity === key,
      effect: effect(key)
    });

    // The Optional Affinities are set apart from the ten of the rulebook's own chapter, under a heading
    const entries = Object.entries(FEO.affinities);
    const core = entries.filter(([key]) => !(key in FEO.optionalAffinities));
    const optional = entries.filter(([key]) => key in FEO.optionalAffinities);
    const chosen = unit.affinity ? effect(unit.affinity) : "";

    // An Affinity that gives a rank in a proficiency of the unit's choice has it chosen here
    const gives = affinityRankOf(unit);
    const data = { name: affinityName(unit.affinity, i18n), steps: gives?.steps };
    return {
      tiles: core.map(tile),
      more: optional.length ? { label: loc("FEO.Setting.optionalAffinities.name"), tiles: optional.map(tile) } : null,
      chosen: chosen ? { label: loc(FEO.affinities[unit.affinity] ?? ""), effect: chosen } : null,
      rank: gives ? {
        open: !gives.choice,
        title: i18n.format(`FEO.Creator.affinity.${gives.choice ? "rank" : "rankOpen"}`, data),
        options: gives.options.map((key) => ({ value: key, label: loc(FEO.proficiencies[key]), pressed: gives.choice === key }))
      } : null
    };
  },

  heartSeals({ unit, cls, i18n }) {
    const picks = FEO.optional.heartSeals.picks;
    const chosen = (unit.heartSeals ?? []).map((entry) => ({ name: entry.name }));
    const left = Math.max(picks - chosen.length, 0);
    return {
      starting: cls?.name ?? "",
      chosen,
      left,
      full: left === 0,
      tally: i18n.format("FEO.Creator.heartSeals.left", { left, total: picks })
    };
  },

  holyBlood({ record, user, i18n, loc, bloodName }) {
    const config = FEO.optional.holyBlood;
    const choice = record.holyBlood;
    const lineage = config.lineages[choice.lineage];
    const times = choice.grade === "major" ? config.majorMultiplier : 1;
    const rank = lineage ? loc(FEO.proficiencies[lineage.rank] ?? "") : "";
    return {
      options: [
        { key: "", label: loc("FEO.Creator.none"), pressed: !choice.lineage },
        ...Object.entries(config.lineages).map(([key, entry]) => ({
          key, label: loc(`FEO.Optional.blood.names.${key}`), small: loc(FEO.proficiencies[entry.rank] ?? ""), pressed: choice.lineage === key
        }))
      ],
      grades: lineage ? Object.keys(config.grades).map((grade) => ({ grade, label: loc(config.grades[grade]), pressed: choice.grade === grade })) : null,
      effect: lineage ? {
        title: bloodName,
        growths: Object.entries(lineage.growths).map(([key, amount]) => ({ abbr: loc(abbr(key)), amount: amount * times })),
        rank: choice.grade === "major"
          ? i18n.format("FEO.Optional.blood.rankMajor", { rank, top: loc(FEO.ranks[config.majorRank]) })
          : i18n.format("FEO.Optional.blood.rankMinor", { steps: config.minorRanks, rank })
      } : null,
      approval: approval(choice.lineage, choice.approved, user, loc)
    };
  },

  crest({ record, user, loc }) {
    const config = FEO.optional.crests;
    const choice = record.crest;
    return {
      none: { pressed: !choice.id, label: loc("FEO.Creator.crest.none") },
      grades: Object.keys(config.grades).map((grade) => ({ grade, label: loc(config.grades[grade]), pressed: choice.grade === grade })),
      rows: Object.entries(config.crests).map(([key, chances]) => ({
        key,
        label: loc(`FEO.Optional.crest.names.${key}`),
        chance: chances[choice.grade] ?? 0,
        effect: loc(`FEO.Optional.crest.effects.${key}`),
        pressed: choice.id === key
      })),
      approval: approval(choice.id, choice.approved, user, loc)
    };
  },

  profile({ unit, name, loc }) {
    const field = (path, label, value) => ({ path, fl: path.replace(/^system./, ""), label: loc(label), value: value ?? "" });
    const profile = (key) => field(`system.profile.${key}`, `FEO.Profile.${key}`, unit.profile[key]);
    return {
      fields: [field("name", "FEO.Unit.name", name), field("system.player", "FEO.Unit.player", unit.player), ...["age", "gender", "homeland", "allegiance", "occupation"].map(profile)],
      wide: ["lines", "veils"].map(profile)
    };
  },

  review({ unit, record, cls, state, totals, taken, bloodName, crestName, i18n, loc }) {
    const growth = (key) => (key in FEO.growths ? `${unit.growths[key]}%` : "–");
    const rows = FEO.creation.bonus.stats.map((key) => {
      const mind = key in FEO.abilities;
      const mark = ((unit.boon === key ? 1 : 0) - (unit.bane === key ? 1 : 0)) * boonWorth(key);
      return {
        abbr: loc(abbr(key)),
        base: mind ? i18n.format("FEO.Creator.bonus.from", { stat: loc(abbr(unit.abilities[key].source)) }) : (cls.system.base?.[key] ?? (((key === "con") && record.con) || "–")),
        bonus: signed(record.bonus[key] ?? 0),
        mark: signed(mark),
        markCss: mark > 0 ? "up" : mark < 0 ? "down" : "",
        now: mind ? totals[key] : savedStat(unit, key),
        growth: growth(key)
      };
    });
    const pending = state.steps.filter((step) => (step.id !== "review") && (step.state !== "done")).map((step) => ({
      id: step.id,
      title: loc(`FEO.Creator.step.${step.id}.title`),
      waiting: step.state === "wait",
      note: i18n.format(`FEO.Creator.state.${step.note}`, step.data)
    }));
    const summary = [
      { label: loc("FEO.Unit.class"), value: `${cls.name} · ${loc("FEO.Unit.classWt")} ${unit.wt.class}` },
      { label: loc("FEO.Section.skills"), value: [record.skills.class.name, record.skills.generic.name].filter(Boolean).join(", ") || "–" },
      { label: loc("FEO.Creator.step.ranks.title"), value: taken.join(", ") || "–" },
      { label: loc("FEO.Creator.review.gear"), value: i18n.format("FEO.Creator.review.gearValue", { items: record.purchases.map((purchase) => purchase.name).join(", ") || loc("FEO.Creator.review.nothing"), gold: number(unit.gold) }) },
      { label: loc("FEO.Unit.affinity"), value: loc(FEO.affinities[unit.affinity] ?? "") || "–" }
    ];
    if ( FEO.optional.heartSeals.enabled ) {
      const names = [cls?.name, ...(unit.heartSeals ?? []).map((entry) => entry.name)].filter(Boolean);
      summary.push({ label: loc("FEO.HeartSeal.title"), value: names.join(", ") || loc("FEO.Creator.none"), module: true });
    }
    if ( FEO.optional.holyBlood.enabled ) summary.push({ label: loc("FEO.Optional.blood.title"), value: bloodName || loc("FEO.Creator.none"), module: true });
    if ( FEO.optional.crests.enabled ) summary.push({ label: loc("FEO.Optional.crest.title"), value: crestName || loc("FEO.Creator.none"), module: true });
    return { rows, pending, summary, ready: state.ready, complete: record.status === "complete" };
  }
};

/* -------------------------------------------- */

/**
 * Where something the Game Master gives stands, for whoever is looking at it.
 * @param {string} picked       What was chosen; blank for nothing
 * @param {boolean} approved
 * @param {{isGM: boolean}} user
 * @param {(key: string) => string} loc
 * @returns {{none: boolean, approved: boolean, isGM: boolean, text: string}}
 */
function approval(picked, approved, user, loc) {
  const key = !picked ? "none" : user.isGM ? (approved ? "gmApproved" : "gmAsked") : (approved ? "approved" : "waiting");
  return { none: !picked, approved, isGM: user.isGM, text: loc(`FEO.Creator.approval.${key}`) };
}

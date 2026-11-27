import { FEO } from "../config.mjs";
import { KIND_ICONS } from "../apps/compendium-context.mjs";
import { performerOf } from "../helpers/arts.mjs";
import { battalionData, bonusParts } from "../helpers/battalion-context.mjs";
import { captureView } from "../helpers/capture-context.mjs";
import { prepareConditions, prepareReminders } from "../helpers/condition-context.mjs";
import { artsAllowed, canPerform, readArtItem } from "../rules/arts.mjs";
import {
  authorityBonus, authorityNext, authorityRank, battalionBonuses, canAssign, canGambit, hasRetreated, readGambit
} from "../rules/battalions.mjs";
import { breakInUse } from "../rules/breaking.mjs";
import { promotesAt } from "../rules/classes.mjs";
import { blockTip } from "../helpers/block-context.mjs";
import { doublesAtOrBelow } from "../rules/combat-stats.mjs";
import { earnsSkillExp } from "../rules/experience.mjs";
import { affinityCooldown, affinityEffectMode, affinityRankOf, hasCooldown } from "../rules/optional.mjs";
import { countsAsSkill, formsOf } from "../rules/skills.mjs";
import { staggerInUse } from "../rules/stagger.mjs";
import { sellValue } from "../rules/progression.mjs";
import { resold } from "../rules/stealing.mjs";
import { atFork, isReady, isTop, kinBonus, ladder, pointsForNext, rankBelow, rankProgress } from "../rules/supports.mjs";
import { canWield, countedRank, repairCost, wieldLevel } from "../rules/weapons.mjs";
import { picksOf } from "../helpers/picks.mjs";
import { prepareUsage } from "../helpers/skill-usage-context.mjs";
import { staffTags } from "../helpers/staff-context.mjs";
import { timedRows } from "../helpers/timed-context.mjs";
import { buildClassPath } from "./class-context.mjs";
import { prepareOptional, weaponKills } from "./optional-context.mjs";

/**
 * Build the display data for a Unit sheet.
 * This depends only on configuration and the unit's prepared data, so it can be exercised outside of Foundry.
 *
 * @param {object} actor              An Actor, or anything shaped like one
 * @param {string} actor.name
 * @param {string} actor.img
 * @param {object} actor.system       Prepared UnitData
 * @param {Iterable<object>} actor.items
 * @param {Iterable<object>} [actor.effects]
 * @param {object} [options]
 * @param {object[]} [options.promotions]   The classes the unit's class promotes to, found by the sheet
 * @returns {object}
 */
export function buildUnitContext(actor, { promotions = [], optional = {} } = {}) {
  const system = actor.system;
  const items = Array.from(actor.items ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const ofType = (type) => items.filter((item) => item.type === type);

  const weapons = ofType("weapon").map((item) => prepareWeapon(item, system));
  const equipped = weapons.find((weapon) => weapon.equipped) ?? null;
  const skills = ofType("skill").map((item) => prepareSkill(item, system));
  const arts = prepareArts(ofType("art"), actor);
  const battalions = prepareBattalions(ofType("battalion"), actor);

  // Skills with an effect that is shown and not applied, and what the units around give this one
  const checks = system.skills?.checks ?? [];
  for ( const skill of skills ) {
    const noted = skill.equipped ? checks.find((entry) => entry.skill === skill.name) : null;
    if ( !noted ) continue;
    skill.check = noted.unseen
      ? { label: "FEO.Skill.unseen", hint: "FEO.Skill.unseenHint" }
      : { label: "FEO.Skill.check", hint: "FEO.Skill.checkHint" };
  }
  const nearby = (system.skills?.auras ?? []).map((aura) => ({
    skill: aura.skill,
    giver: aura.giver,
    check: checks.some((entry) => entry.skill === aura.name)
  }));

  const level = prepareLevel(system);
  const bonds = prepareBonds(system);
  const classPath = buildClassPath(system, ofType("class"), promotions);

  // Promoting ahead of time is offered unless the Level Up button is about to promote anyway
  classPath.early = classPath.canPromote && !(level.promotes && level.ready);

  return {
    vitals: prepareVitals(system),
    defeat: prepareDefeat(system),
    shift: prepareShift(system),
    conditions: prepareConditions(actor.effects, system.conditions ?? {}),
    conditionChoices: Object.fromEntries(
      Object.entries(FEO.conditions).filter(([, condition]) => !condition.combatOnly)
        .map(([id]) => [id, `FEO.Condition.${id}`])
    ),
    reminders: [
      ...prepareReminders(system.conditions ?? {}, equipped),

      // Breaking: a unit that suffers from Break is reminded of it as of a condition, though it is none
      ...((breakInUse() && system.break) ? [{ id: "break", name: "FEO.Optional.breaking.break", hint: "FEO.Optional.breaking.hint" }] : []),

      // Stagger: so is a unit that is Staggered
      ...(system.stagger?.staggered ? [{ id: "staggered", name: "FEO.Optional.stagger.staggered", hint: "FEO.Optional.stagger.hint" }] : [])
    ],

    // Whether it suffers from Break, where the world plays with it, for the chip that says so
    breaking: breakInUse() ? { on: !!system.break } : null,

    // Stagger: its Stagger bar and whether it is Staggered, where the world plays with it
    stagger: prepareStagger(system),

    // Capturing: the attempt it has readied, the captive it holds or has subdued, and who holds it
    capture: captureView(system),
    affinity: system.affinity ? {
      icon: FEO.affinityIcons[system.affinity],
      label: FEO.affinities[system.affinity],

      // Additional Affinity Effects: what the Affinity builds into the unit, and how much of it the system does
      effect: affinityEffectMode(system.affinity) ? {
        text: `FEO.Optional.affinityEffect.text.${system.affinity}`,
        mode: `FEO.Optional.affinityEffect.mode.${affinityEffectMode(system.affinity)}`
      } : null,

      // An Affinity that gives a rank in a proficiency of the unit's choice: what can be chosen
      rank: affinityRankOf(system) ? {
        text: `FEO.Optional.affinityEffect.text.${system.affinity}`,
        options: Object.fromEntries(affinityRankOf(system).options.map((key) => [key, FEO.proficiencies[key]]))
      } : null,

      // One its unit chooses when to use: the button that switches it on, and where it stands
      use: prepareAffinityUse(system),

      // One that shortens the cooldown of a skill of the unit's choice: the skills it has equipped that have one
      skill: prepareAffinitySkill(actor)
    } : null,

    forecast: prepareForecast(system, equipped, skills),
    stats: prepareStats(system),
    weapons,
    gear: ofType("gear").map((item) => prepareGear(item, system)),
    ranks: prepareRanks(system),

    skills,
    arts,
    battalions,
    nearby,
    lasting: timedRows(system.timed),
    // What its Effect says is not a skill takes no slot
    skillSlots: {
      used: skills.filter((skill) => skill.equipped && !skill.granted && countsAsSkill(skill.effect)).length,
      total: system.skillSlots ?? FEO.skillSlots,

      // With Skill Capacity: the Capacity Points spent and had, and the tier they are those of
      capacity: system.skillRoom?.capacity ? {
        spent: system.skillRoom.spent,
        limit: system.skillRoom.limit,
        over: system.skillRoom.spent > system.skillRoom.limit,
        tier: system.skillRoom.tier ? FEO.optional.skillCapacity.labels[system.skillRoom.tier] : null
      } : null
    },

    growth: prepareGrowth(system),
    level,

    // A unit under a Level Sync: the Level it is synced to, its own, and what to say of where that comes from
    synced: system.synced ? {
      level: system.synced.level,
      own: system.synced.own,
      tip: globalThis.game?.i18n ? game.i18n.format(system.synced.exact ? "FEO.LevelSync.sheet.exact" : "FEO.LevelSync.sheet.estimated", {
        level: system.synced.level, from: system.synced.from, name: system.synced.name
      }) : ""
    } : null,
    classPath,
    boonChoices: Object.fromEntries(FEO.boonStats.map((key) => [key, `FEO.Stat.${key}.abbr`])),
    boosts: Object.entries(FEO.combatBoosts).map(([key, label]) => ({ key, label, value: system.combatBoosts[key] })),
    calcModes: Object.entries(FEO.calcModes).map(([key, choices]) => ({
      key,
      label: `FEO.Combat.${key}`,
      choices,
      value: system.calc[key]
    })),

    checks: prepareChecks(system),
    bonds,
    supports: prepareSupports(system, bonds),
    optional: prepareOptional(actor, optional)
  };
}

/* -------------------------------------------- */

/**
 * Health, experience and the small readouts on the rail. Wounds, Injuries and their treatment belong to the
 * Incapacitation system, and `health` says whether the world plays with it.
 * @param {object} system
 * @returns {object}
 */
/**
 * The button and the note for an Affinity its unit chooses when to use, as for a skill that is.
 * @param {object} system
 * @returns {object|null}     Null for an Affinity that is always there
 */
function prepareAffinityUse(system) {
  const way = system.affinityWay ?? null;
  const usage = way ? prepareUsage({ usage: way.usage, state: system.affinityUse, equipped: true }) : null;
  if ( !usage ) return null;
  return { ...usage, action: "switchAffinity", hint: `FEO.Optional.affinityEffect.use.${way.spentBy}` };
}

/* -------------------------------------------- */

/**
 * The skills an Affinity may shorten the cooldown of, as Key does: those the unit has equipped that have one.
 * @param {Actor} actor
 * @returns {{text: string, options: Record<string, string>}|null}    Null for an Affinity that shortens none
 */
function prepareAffinitySkill(actor) {
  const system = actor.system;
  if ( !affinityCooldown({ affinity: system.affinity, affinitySkill: "any", glory: system.glory }) ) return null;
  const options = {};
  for ( const item of actor.items ) {
    if ( (item.type === "skill") && item.system.equipped && hasCooldown(item.system) ) options[item.id] = item.name;
  }
  return { text: `FEO.Optional.affinityEffect.text.${system.affinity}`, options };
}

/* -------------------------------------------- */

function prepareVitals(system) {
  const { value, max } = system.hp;
  const hpPct = max > 0 ? Math.min(Math.max(value / max, 0), 1) * 100 : 0;
  const perGrave = FEO.woundsPerGraveWound;
  const expPct = Math.min(system.exp / FEO.expPerLevel, 1) * 100;
  return {
    hpPct,
    hpState: hpPct > 50 ? "high" : hpPct > 25 ? "mid" : "low",
    expPct,
    expPerLevel: FEO.expPerLevel,
    health: FEO.defeat.enabled,
    woundPips: Array.from({ length: perGrave }, (_, index) => ({
      number: index + 1,
      on: index < (system.wounds % perGrave)
    })),
    graveWounds: system.graveWounds,
    woundThreshold: system.hp.woundThreshold ?? 0,
    treatable: FEO.defeat.enabled && ((system.wounds > 0) || (system.injuries > 0))
  };
}

/* -------------------------------------------- */

/**
 * A unit's Stagger bar, for the rail, where the world plays with Stagger. A bar that was not made yet follows
 * the unit's HP, and is shown without a field to type in.
 * @param {object} system
 * @returns {{value: number, max: number, pct: number, staggered: boolean, sized: boolean}|null}
 */
function prepareStagger(system) {
  if ( !staggerInUse() || !system.stagger ) return null;
  const { value, max, staggered, sized } = system.stagger;
  return {
    value,
    max,
    pct: max > 0 ? Math.min(Math.max(value / max, 0), 1) * 100 : 0,
    staggered: !!staggered,
    sized: !!sized
  };
}

/* -------------------------------------------- */

/**
 * What became of a unit brought to 0 HP, for the block the rail shows while there is something to show.
 * @param {object} system
 * @returns {object}
 */
function prepareDefeat(system) {
  const defeat = system.defeat ?? { state: "", turns: 0, paused: false, fate: [] };
  const fate = defeat.fate ?? [];
  return {
    show: !!defeat.state || (fate.length > 0),
    state: defeat.state,
    stateLabel: defeat.state ? `FEO.Defeat.state.${defeat.state}` : null,
    down: defeat.state === "incapacitated",
    out: (defeat.state === "retreated") || (defeat.state === "dead"),

    // Capturing: a captured unit is out of the fight, and is set free rather than returned or killed
    captured: defeat.state === "captured",
    turns: defeat.turns,
    paused: defeat.paused,
    canSpend: (defeat.state === "incapacitated") && (defeat.turns > 0),
    fate: fate.map((reason) => `FEO.Defeat.reason.${reason}`),
    mustChoose: fate.length > 0,
    hp: system.hp.value,
    deathThreshold: system.hp.deathThreshold ?? 0
  };
}

/* -------------------------------------------- */

/**
 * How a unit changes form, for the block the rail shows for units that do.
 * @param {object} system
 * @returns {object|null}   Null for a unit that does not change form
 */
function prepareShift(system) {
  const shift = system.shift;
  const choices = {
    kinds: { gauge: FEO.shift.modes.gauge, stone: FEO.shift.modes.stone, none: "FEO.Shift.mode.none" },
    percents: Object.fromEntries(FEO.shift.percents.map((percent) => [percent, `${percent}%`]))
  };
  if ( !shift?.mode ) return { mode: null, kind: shift?.kind ?? "", choices };
  const { max, shiftAt } = FEO.shift.gauge;
  const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
  const bonuses = Object.entries(shift.bonuses ?? {}).map(([key, amount]) => ({
    label: FEO.stats[key]?.abbr ?? key,
    amount: signed(amount)
  }));
  return {
    mode: shift.mode,
    kind: shift.kind,
    choices,
    isGauge: shift.mode === "gauge",
    isStone: shift.mode === "stone",
    active: shift.active,
    transformed: shift.transformed,
    value: shift.value,
    max,
    shiftAt,
    pct: Math.min(Math.max(shift.value / max, 0), 1) * 100,
    markPct: (shiftAt / max) * 100,
    ready: !shift.active && ((shift.value >= shiftAt) || !!shift.bends?.atWill),
    share: shift.share,
    percent: shift.percent,
    bonuses,
    profile: Object.entries(shift.profile ?? {}).map(([key, value]) => ({
      key,
      label: `FEO.Shift.profile.${key}`,
      value,
      display: key === "start" ? String(value) : signed(value),
      own: system._source?.shift?.[key] ?? shift[key] ?? null
    })),
    turnChange: signed(shift.active ? shift.profile.turnAnimal : shift.profile.turnHuman),
    combatChange: signed(shift.active ? shift.profile.combatAnimal : shift.profile.combatHuman),
    uses: shift.uses,
    left: shift.left,
    limit: shift.limit,
    usesMax: shift.usesMax,

    // A stone that a skill lets transform its bearer any number of times never runs out
    endless: !!shift.bends?.endless,
    limitText: shift.bends?.endless ? "∞" : String(shift.limit),
    pips: Array.from({ length: Math.min(shift.limit, 12) }, (_, index) => !!shift.bends?.endless || (index < shift.left)),
    boosted: shift.boosted,

    // The skills that change how the unit changes form
    skills: (shift.bends?.skills ?? []).join(", ")
  };
}

/* -------------------------------------------- */

/**
 * A weapon row, with the combat stats the unit would have wielding it.
 * @param {object} item
 * @param {object} system     The owning unit's data
 * @returns {object}
 */
function prepareWeapon(item, system) {
  const weapon = item.system;
  const { value, max } = weapon.uses;
  const ratio = max > 0 ? Math.min(value / max, 1) : 1;
  const original = item.flags?.[FEO.id]?.original ?? null;
  // A weapon handed to a summoned unit is one it wields whatever its rank
  const wield = (FEO.weapons.rankCheck && !item.flags?.[FEO.id]?.summoned)
    ? canWield(system.proficiencies, weapon, { above: system.skills?.wield ?? 0, level: wieldLevel(system) }) : { ok: true };
  return {
    ...weaponKills(weapon),
    wieldable: wield.ok,
    needsRank: FEO.ranks[weapon.rank],
    needsLevel: wield.level?.needs ?? null,
    isStaff: weapon.category === "staff",
    wasBroken: !!original,
    originalName: original?.name ?? null,
    repair: original ? weapon.cost : repairCost(weapon.cost, value, max),
    canRepair: !!original || ((max > 0) && (value < max)),
    sell: original ? 0 : resold(sellValue(weapon.cost, value, max), system.knacks?.resale ?? 0),
    id: item.id,
    name: item.name,
    img: item.img,
    icon: FEO.categoryIcons[weapon.category] ?? "sword",
    equipped: weapon.equipped,
    broken: weapon.broken,
    category: weapon.category,
    categoryLabel: FEO.weaponCategories[weapon.category]?.label,
    rankLabel: FEO.ranks[weapon.rank],
    might: weapon.might,
    hit: weapon.hit,
    crit: weapon.crit,
    range: weapon.range,
    weight: weapon.weight,
    effect: weapon.effect,
    uses: value,
    max,
    usesPct: ratio * 100,
    usesState: max > 0 ? (ratio <= 0.15 ? "crit" : ratio <= 0.35 ? "low" : "") : ""
  };
}

/* -------------------------------------------- */

/**
 * A carried item row.
 * @param {object} item
 * @param {object} [system]     The unit's data, for what its skills add to what it sells for
 * @returns {object}
 */
function prepareGear(item, system = null) {
  const { value, max } = item.system.uses;

  // A Shield is equipped like a weapon, wears out like one, and is repaired like one
  const shield = !!item.system.isShield;
  const accessory = !!item.system.isAccessory;
  const original = shield ? (item.flags?.[FEO.id]?.original ?? null) : null;
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    effect: item.system.effect,
    uses: value,
    max,
    dots: (max > 0) && (max <= 6) ? Array.from({ length: max }, (_, index) => index < value) : null,
    sell: original ? 0 : resold(sellValue(item.system.cost, value, max), system?.knacks?.resale ?? 0),
    spent: item.system.spent,
    shield,

    // An accessory is worn, one at a time, and what it gives counts while it is. One that restores HP when
    // it is Used, as a Goddess Ring does, has its button while it is worn
    accessory,
    worn: shield || accessory,
    usable: accessory && (item.system.restore > 0) && !!item.system.equipped,
    equipped: (shield || accessory) && !!item.system.equipped,
    wasBroken: !!original,
    originalName: original?.name ?? null,
    repair: original ? item.system.cost : repairCost(item.system.cost, value, max),
    canRepair: shield && (!!original || ((max > 0) && (value < max)))
  };
}


/* -------------------------------------------- */

/**
 * The Combat Arts a unit has learned, where the world plays with Combat Arts: each with what it costs this
 * unit, whether it is readied, and why it cannot be performed now if it cannot; and how many the unit has
 * learned of those its Weapon Ranks allow.
 * @param {object[]} items      The unit's Arts
 * @param {object} actor
 * @returns {object|null}       Null where the world does not play with Combat Arts
 */
function prepareArts(items, actor) {
  const config = FEO.optional.combatArts;
  if ( !config.enabled ) return null;
  const performer = performerOf(actor);
  const list = items.map((item) => {
    const art = item.system;
    const able = canPerform({ type: art.type, also: art.also, cost: art.cost }, performer);
    const read = (art.automate === false) ? null : readArtItem(art);
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      type: config.types[art.type],
      rank: art.rank ? FEO.ranks[art.rank] : null,
      cost: able.cost,
      free: !able.cost.hp && !able.cost.uses,
      effect: art.effect,
      readied: !!art.readied,
      blocked: able.ok ? null : `FEO.Optional.combatArts.blocked.${able.why}`,

      // An Art the system applies only in part, or not at all, is marked for the table
      byHand: !read ? "FEO.Optional.combatArts.manual" : (read.left ? "FEO.Optional.combatArts.partly" : null)
    };
  });

  // An Art without a Rank is one the unit simply has, and counts for none of its Ranks. With Weapon Levels
  // there are no Ranks to count
  const known = items.filter((item) => item.system.rank).length;
  const allowed = FEO.optional.weaponLevel.enabled ? null : artsAllowed(actor.system.proficiencies);
  return { list, known, allowed, over: (allowed !== null) && (known > allowed) };
}

/* -------------------------------------------- */

/**
 * Battalions & Gambits: the unit's Authority, and the Battalions it carries, each with what it adds at its
 * level, how much HP it has left, whether the unit commands it or why it cannot, and its Gambit with why that
 * cannot be used now if it cannot.
 * @param {object[]} items      The unit's Battalions
 * @param {object} actor
 * @returns {object|null}       Null where the world does not play with Battalions
 */
function prepareBattalions(items, actor) {
  const config = FEO.optional.battalions;
  if ( !config.enabled ) return null;
  const system = actor.system;
  const authority = system.authority ?? {};
  const counted = authorityRank(authority.rank);
  const list = items.map((item) => {
    const squad = item.system;
    const data = battalionData(item);
    const able = canAssign(data, { authority: authority.rank, qualities: system.specialQualities });
    const usable = canGambit(data, { conditions: system.conditions ?? {}, down: !!system.defeat?.state });
    const gambit = squad.gambit;
    const offensive = gambit.kind === "offensive";
    const retreated = hasRetreated(squad);
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      rank: FEO.ranks[squad.rank],
      quality: squad.quality,
      level: squad.level,
      hp: { value: squad.hp.value, max: squad.hp.max },
      full: (squad.hp.value >= squad.hp.max) && (gambit.uses.value >= gambit.uses.max),
      assigned: !!squad.equipped,
      retreated,

      // Why the unit cannot command it, said when it is asked to
      blocked: able.ok ? null : {
        key: `FEO.Optional.battalions.cannot.${able.why}Short`,
        needs: able.needs ? FEO.ranks[able.needs] : "",
        qualities: (able.lacks ?? []).join(", ")
      },

      // What it adds at its level; one that has retreated adds none of it until it is replenished
      bonuses: bonusParts(battalionBonuses({ ...data, hp: { value: 0, max: 0 } })),
      gambit: {
        name: gambit.name,
        kind: config.gambit.kinds[gambit.kind],
        offensive,
        might: gambit.might,
        hit: gambit.hit,
        range: gambit.range,
        effect: gambit.effect,
        uses: (gambit.uses.max > 0) ? { value: gambit.uses.value, max: gambit.uses.max } : null,
        blocked: usable.ok ? null : `FEO.Optional.battalions.blocked.${usable.why}`,

        // A Gambit the system applies only in part is marked for the table
        byHand: !offensive || !!readGambit(gambit.effect).left
      }
    };
  });
  return {
    list,
    authority: {
      rank: counted,
      label: FEO.ranks[counted],
      exp: authority.exp ?? 0,
      next: authorityNext(authority.rank),
      bonus: authorityBonus(authority.rank),
      choices: Object.fromEntries(["F", ...config.ranks].map((rank) => [rank, FEO.ranks[rank]]))
    }
  };
}

/* -------------------------------------------- */

/**
 * A skill card.
 * @param {object} item
 * @param {object} system     The unit's data
 * @returns {object}
 */
function prepareSkill(item, system) {
  const skill = item.system;
  const picking = picksOf(item);
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    // Its kind dyes its card and picks its emblem, as in the Compendium
    kind: skill.kind,
    icon: KIND_ICONS[skill.kind] ?? "spark",
    kindLabel: FEO.skillKinds[skill.kind],
    equipped: skill.equipped,

    // The piece of gear that grants it, for a skill its unit has only while that gear is equipped
    granted: item.flags?.[FEO.id]?.grantedBy?.name ?? null,
    capacity: (FEO.optional.skillCapacity.enabled && !item.flags?.[FEO.id]?.grantedBy) ? (skill.capacity ?? 0) : null,
    effect: skill.effect,
    chance: skill.chance,
    // A skill used as an action has its own button, which also earns what the skill experience table gives
    usable: skill.equipped && earnsSkillExp(item.name) && (skill.usage?.kind !== "action"),
    usage: prepareUsage(skill),
    // A skill the system only announces is not marked as applied by it
    automated: (skill.automate !== false) && (skill.effects ?? []).some((effect) => !effect.remind),
    check: null,
    // What the skill had its unit pick as it was learnt: still to be picked, and whether this user may
    choice: skill.choice ?? "",
    needsChoice: picking.open,
    canPick: picking.can,

    // The Special Qualities an equipped skill lets the unit take on and put off, each with its switch
    forms: skill.equipped && (skill.automate !== false) ? formsOf(skill.effects, system.specialQualities) : [],

  };
}

/* -------------------------------------------- */

/**
 * The combat forecast for the equipped weapon.
 * @param {object} system
 * @param {object|null} equipped    The prepared weapon row in hand
 * @param {object[]} skills         Prepared skill cards
 * @returns {object}
 */
function prepareForecast(system, equipped, skills) {
  const combat = system.combat;
  const cells = [
    ["damage", "FEO.Combat.damage", true],
    ["accuracy", "FEO.Combat.hit", true],
    ["critical", "FEO.Combat.critAbbr", true],
    ["attackSpeed", "FEO.Combat.attackSpeedShort", false],
    ["dodge", "FEO.Combat.dodge", false],
    ["critAvoid", "FEO.Combat.critAvoid", false]
  ].map(([key, label, lead]) => ({
    key,
    label,
    lead,
    value: combat[key].value,
    terms: combat[key].terms.map((term) => ({
      ...term,
      display: formatTerm(term),
      cls: term.modifier ? (term.value < 0 ? "neg" : "pos") : ""
    }))
  }));

  const triangle = FEO.triangle[equipped?.category];
  const label = (category) => FEO.weaponCategories[category]?.label;
  const staff = equipped?.category === "staff";
  const doubles = doublesAtOrBelow(combat.attackSpeed.value + (system.haste ?? 0), FEO.doubleThreshold);

  // Additional Staff Effects: what they make of the staff in hand, where the world plays with any of them
  const held = staff ? system.equippedWeapon : null;
  const shown = (chance) => ((chance === null) ? null : { value: chance });
  const extras = held ? staffTags({
    name: held.name,
    sheetName: held.flags?.[FEO.id]?.sheetName ?? held.name,
    effect: held.system.effect,
    hit: held.system.hit,
    broken: held.system.broken
  }, {
    stats: system.statValues,
    hitBonus: combat.accuracy.terms.reduce((sum, term) => sum + (term.modifier ? term.value : 0), 0)
  }) : null;

  return {
    weapon: equipped,
    cells,
    doubles,
    canDouble: doubles !== null,
    beats: triangle?.beats.map(label) ?? null,
    losesTo: triangle?.losesTo.map(label) ?? null,
    outsideTriangle: !!equipped && !triangle,
    procs: skills.filter((skill) => skill.equipped && (skill.chance !== null)),
    staffHit: staff ? combat.staffHit.value : null,
    hasStaffHit: staff,
    staffExtras: extras ? { hit: shown(extras.hit), critical: shown(extras.critical), double: shown(extras.double), passive: extras.passive } : null,
    staffAvoid: combat.staffAvoid.value,

    // What it blocks with, and how likely, with the sum behind the chance
    block: system.block ? {
      chance: system.block.chance,
      tip: globalThis.game?.i18n ? blockTip(system.block, game.i18n) : system.block.name
    } : null,
    endurance: system.endurance,

    haste: system.haste,
    activation: system.support?.activation
  };
}

/**
 * Format the value of a breakdown term: halves keep one decimal, and modifiers carry a sign.
 * @param {{value: number, modifier?: boolean}} term
 * @returns {string}
 */
function formatTerm(term) {
  const number = Number.isInteger(term.value) ? String(term.value) : term.value.toFixed(1);
  return (term.modifier && (term.value > 0)) ? `+${number}` : number.replace("-", "−");
}

/* -------------------------------------------- */

/**
 * The stat gauges on the Battle tab.
 * @param {object} system
 * @returns {object[]}
 */
function prepareStats(system) {
  return ["str", "mag", "dex", "spd", "luk", "def", "res", "con"].map((key) => {
    const stat = system.stats[key];
    const shift = stat.total - stat.base;
    const scale = stat.cap ?? Math.max(30, stat.total);
    const basePct = scale > 0 ? Math.min(Math.min(stat.base, stat.total) / scale, 1) * 100 : 0;
    const boostPct = (shift > 0) && (scale > 0) ? Math.min(shift / scale, 1 - (basePct / 100)) * 100 : 0;
    return {
      key,
      abbr: FEO.stats[key].abbr,
      label: FEO.stats[key].label,
      total: stat.total,
      base: stat.base,
      shift,
      cap: stat.cap,
      hasCap: stat.cap !== null,
      capped: stat.capped,
      state: stat.capped ? "capped" : shift > 0 ? "boosted" : shift < 0 ? "reduced" : "",
      basePct,
      boostPct,
      boon: system.boon === key,
      bane: system.bane === key,
      growth: system.growthRates?.[key] ?? system.growths[key] ?? null,
      hasGrowth: key in FEO.growths
    };
  });
}

/* -------------------------------------------- */

/**
 * Weapon proficiency rings.
 * @param {object} system
 * @returns {{all: object[], known: object[]}}
 */
function prepareRanks(system) {
  const order = Object.keys(FEO.ranks);
  const levelled = system.weaponLevel?.used ? system.weaponLevel : null;
  const all = Object.entries(FEO.proficiencies).map(([key, label]) => {
    const proficiency = system.proficiencies[key];
    const proficient = proficiency.rank !== "F";

    // With Weapon Levels only a unit that is not yet proficient still earns weapon experience
    const next = (levelled && proficient) ? null : proficiency.next;
    const nextRank = order[order.indexOf(proficiency.rank) + 1];
    return {
      key,
      label,
      rank: proficiency.rank,
      rankLabel: FEO.ranks[countedRank(proficiency.rank, levelled?.rank ?? null)],
      wexp: proficiency.wexp,
      next,
      nextRankLabel: (nextRank && next) ? FEO.ranks[nextRank] : null,
      pct: next ? Math.min(proficiency.wexp / next, 1) * 100 : 100,
      proficient
    };
  });
  return {
    all,
    known: all.filter((rank) => rank.proficient),
    level: levelled ? { value: levelled.base, cap: levelled.cap, rankLabel: FEO.ranks[levelled.rank] } : null
  };
}

/* -------------------------------------------- */

/**
 * The editable stat and growth table.
 * @param {object} system
 * @returns {object[]}
 */
function prepareGrowth(system) {
  const growthPct = (key) => Math.min((system.growths[key] ?? 0) / 100, 1) * 100;
  const mark = (key) => (system.boon === key ? "boon" : system.bane === key ? "bane" : "");

  // What the table leaves to a hover over the total: the change wounds, skills and conditions make, and the cap.
  // The total is tinted by that change, so the row itself carries one number instead of three.
  const behind = (change, cap) => {
    const tips = [];
    if ( change ) tips.push({ label: "FEO.Growth.auto", value: change > 0 ? `+${change}` : `−${-change}` });
    if ( (cap ?? null) !== null ) tips.push({ label: "FEO.Growth.capAt", value: cap });
    return { tone: change > 0 ? "up" : change < 0 ? "down" : "", tips };
  };

  const rows = [{
    key: "hp",
    abbr: "FEO.Stat.hp.abbr",
    label: "FEO.Stat.hp.label",
    path: "system.hp.max",
    base: system.hp.base,
    capPath: "system.hp.cap",
    cap: system.hp.cap,
    capManual: system._source?.hp?.cap ?? system.hp.cap,
    capFromClass: system.hp.capSource === "class",
    total: system.hp.max,
    capped: system.hp.capped,
    mark: mark("hp"),
    growth: system.growths.hp,
    growthPct: growthPct("hp"),
    growthSkills: system.growthSkills?.hp || null,
    ...behind(-(system.hp.lost || 0), system.hp.cap)
  }];

  // A rule is drawn where one kind of row gives way to the next: stats that grow, stats that do not, abilities
  let grew = true;
  for ( const [key, config] of Object.entries(FEO.stats) ) {
    const stat = system.stats[key];
    const hasGrowth = key in FEO.growths;
    const group = grew && !hasGrowth;
    grew = hasGrowth;
    rows.push({
      group,
      key,
      abbr: config.abbr,
      label: config.label,
      path: `system.stats.${key}.base`,
      base: stat.base,
      boostPath: `system.stats.${key}.boost`,
      boost: stat.boost,
      capPath: `system.stats.${key}.cap`,
      cap: stat.cap,
      capManual: stat.capSource === "module" ? null : (system._source?.stats?.[key]?.cap ?? stat.cap),
      capDefault: stat.capSource === "module" ? stat.cap : null,
      capFromClass: stat.capSource === "class",
      total: stat.total,
      capped: stat.capped,
      mark: mark(key),
      growth: hasGrowth ? system.growths[key] : null,
      growthPct: hasGrowth ? growthPct(key) : null,
      growthSkills: system.growthSkills?.[key] || null,
      ...behind(stat.modifier || 0, stat.cap)
    });
  }

  let first = true;
  for ( const [key, config] of Object.entries(FEO.abilities) ) {
    const ability = system.abilities[key];
    rows.push({
      group: first,
      key,
      abbr: config.abbr,
      label: config.label,
      sourcePath: `system.abilities.${key}.source`,
      source: ability.source,
      sources: Object.fromEntries(config.sources.map((source) => [source, FEO.stats[source].abbr])),
      path: `system.abilities.${key}.increase`,
      base: ability.increase,
      boostPath: `system.abilities.${key}.boost`,
      boost: ability.boost,
      total: ability.total,
      mark: "",
      growth: system.growths[key],
      growthPct: growthPct(key),
      growthSkills: system.growthSkills?.[key] || null,
      ...behind(0, null)
    });
    first = false;
  }

  if ( system.weaponLevel?.used ) {
    const levelled = system.weaponLevel;
    rows.push({
      group: true,
      key: "wlv",
      abbr: "FEO.Stat.wlv.abbr",
      label: "FEO.Stat.wlv.label",
      path: "system.weaponLevel.base",
      base: levelled.base,
      capFixed: levelled.cap,
      total: levelled.base,
      capped: levelled.capped,
      mark: "",
      growth: system.growths.wlv,
      growthPct: growthPct("wlv"),
      growthSkills: system.growthSkills?.wlv || null,
      ...behind(0, levelled.cap)
    });
  }
  return rows;
}

/* -------------------------------------------- */

/**
 * Level and experience.
 * @param {object} system
 * @returns {object}
 */
function prepareLevel(system) {
  const needed = FEO.expPerLevel;

  // With the Level Cap, a unit at its level limit has no next level to reach
  // A unit under a Level Sync levels up once it is over, from its own Level
  const capped = system.atMaxLevel === true;
  return {
    expPct: Math.min(system.exp / needed, 1) * 100,
    toNext: Math.max(needed - system.exp, 0),
    next: (system.synced?.own ?? system.level) + 1,
    ready: !capped && !system.synced && (system.exp >= needed),
    capped,
    limit: system.maxLevel ?? null,
    promotion: !system.classItem && FEO.promotionLevels.includes(system.level),
    promotes: promotesAt(system.level, system.classItem ?? null),
    growthTotal: Object.keys(FEO.growths).reduce((total, key) => total + (system.growths[key] ?? 0), 0)
  };
}

/* -------------------------------------------- */

/**
 * Ability checks and saving throws, grouped for display.
 * @param {object} system
 * @returns {object}
 */
function prepareChecks(system) {
  const statLabel = (key) => (FEO.stats[key] ?? FEO.abilities[key]).abbr;
  const groups = Object.entries(FEO.abilityGroups).map(([group, label]) => ({
    key: group,
    label,
    checks: Object.entries(FEO.abilityChecks).filter(([, config]) => config.group === group).map(([key, config]) => {
      const check = system.checks[key];
      return {
        key,
        label: `FEO.Ability.${key}`,
        stat: check.stat,
        statLabel: statLabel(check.stat),
        choices: config.stats.length > 1
          ? Object.fromEntries(config.stats.map((stat) => [stat, statLabel(stat)]))
          : null,
        points: check.points,
        bonus: check.bonus
      };
    })
  }));

  const group = (key) => groups.find((entry) => entry.key === key);
  return {
    groups,
    columns: [[group("physical"), group("saves")], [group("knowledge")], [group("social")]],
    cha: { total: system.abilities.cha.total, source: FEO.stats[system.abilities.cha.source].abbr },
    int: { total: system.abilities.int.total, source: FEO.stats[system.abilities.int.source].abbr },
    spent: system.checkPointsSpent,
    pool: system.checkPoints,
    over: system.checkPointsSpent > system.checkPoints,
    perLevel: system.checkPointsPerLevel,
    limit: system.checkPointLimit
  };
}

/* -------------------------------------------- */

/**
 * Support partners.
 * @param {object} system
 * @returns {object[]}
 */
function prepareBonds(system) {
  const level = (rank) => FEO.supportRanks[rank]?.level ?? 0;
  return system.bonds.map((bond, index) => {
    const parts = Object.entries(FEO.supportBoosts)
      .map(([key, label]) => ({ label, amount: bond.bonus[key] }))
      .filter((part) => part.amount);
    return {
      index,
      name: bond.name,
      uuid: bond.uuid,
      affinity: bond.affinity,
      affinityLabel: FEO.affinities[bond.affinity] ?? null,
      icon: FEO.affinityIcons[bond.affinity] ?? "ring",
      rank: bond.rank,
      rankLabel: FEO.supportRanks[bond.rank]?.label,
      level: level(bond.rank),
      points: bond.points,
      pointsNext: pointsForNext(bond.rank),
      inRange: bond.inRange,
      adjacent: !!bond.adjacent,
      kin: !!bond.kin,
      linked: !!bond.uuid,
      parts,

      // Its bar: a part for each rank it climbs through, and how full each is
      steps: rankProgress(bond).map((share) => ({ pct: Math.round(share * 100) })),

      // What moving it by hand comes to: a rank down, a rank up, or at A the choice between the highest ranks
      canLower: rankBelow(bond.rank) !== null,
      canRaise: !isTop(bond.rank) && !atFork(bond.rank),
      atFork: atFork(bond.rank),
      ready: isReady(bond)
    };
  });
}

/* -------------------------------------------- */

/**
 * What a unit's supports come to for its sheet: the partners in range, closest support first, every partner
 * it keeps a record of in the order they are managed in, and what those in range give it together.
 * @param {object} system
 * @param {object[]} bonds      Its bonds, as `prepareBonds` gives them
 * @returns {{near: object[], kept: object[], totals: {label: string, amount: number}[], scale: string[]}}
 */
function prepareSupports(system, bonds) {
  const byRank = (a, b) => (b.level - a.level) || String(a.name).localeCompare(String(b.name));
  const sum = {};
  system.bonds.forEach((bond) => {
    if ( !bond.inRange ) return;
    for ( const key of Object.keys(FEO.supportBoosts) ) sum[key] = (sum[key] ?? 0) + (bond.bonus[key] ?? 0);

    // Partners in a Bond Support gain more while side by side
    for ( const [key, amount] of Object.entries(kinBonus(bond) ?? {}) ) sum[key] = (sum[key] ?? 0) + amount;
  });
  return {
    near: bonds.filter((bond) => bond.inRange).sort(byRank),
    kept: bonds.slice().sort(byRank),
    totals: Object.entries(FEO.supportBoosts).map(([key, label]) => ({ label, amount: sum[key] ?? 0 })).filter((part) => part.amount),

    // The ranks along the bar, said once over the records: those it climbs through, then the highest
    scale: [...ladder().map((rank) => FEO.supportRanks[rank].label), "FEO.Bond.tops"]
  };
}

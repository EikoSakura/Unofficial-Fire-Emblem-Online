import { FEO } from "../config.mjs";
import {
  atLevelLimit, crestOf, killBonus, leadershipBonus, levelLimit, livesState, powerMode, starChance
} from "../rules/optional.mjs";
import { followUpCritical, followUpTimes } from "../rules/variants.mjs";

/**
 * Display data for the Optional Modules on a Unit sheet and in chat. Like the rest of the sheet's display data
 * this depends only on configuration and the unit's prepared data, so it can be exercised outside of Foundry.
 * A module that the world does not use gives null, and the sheet shows nothing for it.
 *
 * @import {Localizer} from "../helpers/exchange-context.mjs"
 */

const COMBAT_LABELS = {
  hit: "FEO.Combat.hit",
  dodge: "FEO.Combat.dodge",
  critical: "FEO.Combat.critical",
  critAvoid: "FEO.Combat.critAvoid",
  damage: "FEO.Combat.damage",
  attackSpeed: "FEO.Combat.attackSpeed"
};

/**
 * Turn combat bonuses into labelled amounts.
 * @param {Record<string, number>|null} bonus
 * @returns {{label: string, amount: number}[]}
 */
function parts(bonus) {
  return Object.entries(bonus ?? {}).map(([key, amount]) => ({ label: COMBAT_LABELS[key] ?? key, amount }));
}

/* -------------------------------------------- */

/**
 * Build what the sheet shows for the Optional Modules in use.
 * @param {object} actor                Anything shaped like an Actor
 * @param {object} [options]
 * @param {string|null} [options.army]  The side the unit fights for, which decides whether it starts with lives
 * @param {{uuid: string, name: string}[]} [options.leaders]    The units that could be this unit's Authority
 * @returns {object}
 */
export function prepareOptional(actor, { army = null, leaders = [] } = {}) {
  const system = actor.system;
  const config = FEO.optional;
  const optional = {
    lives: config.lives.enabled ? prepareLives(system, army) : null,
    stars: config.movementStars.enabled ? prepareStars(system) : null,
    fcm: config.followUpCritical.enabled ? prepareFcm(system) : null,
    blood: config.holyBlood.enabled ? prepareBlood(system) : null,
    crest: config.crests.enabled ? prepareCrest(system) : null,
    leadership: config.leadership.enabled ? prepareLeadership(system, leaders) : null,
    levelCap: config.levelCap.enabled ? prepareLevelCap(system) : null,
    glory: config.glory.enabled ? prepareGlory(system) : null,
    stagger: (config.stagger.enabled && system.stagger) ? {
      max: system._source?.stagger?.max ?? 0,
      value: system.stagger.value,
      size: system.stagger.max,
      sized: !!system.stagger.sized
    } : null,
    capacity: config.skillCapacity.enabled ? {
      own: system.skillCapacity ?? null,
      usual: config.skillCapacity.points[system.skillRoom?.tier ?? "base"],
      limit: system.skillRoom?.limit ?? null,
      spent: system.skillRoom?.spent ?? 0
    } : null,
    growthBonus: Object.fromEntries(Object.entries(system.growthBonus ?? {}).filter(([, amount]) => amount)),
    growthCaps: {
      ...(config.growths.enabled ? config.growths.caps : {}),
      ...(config.weaponLevel.enabled ? { wlv: config.weaponLevel.growthCap } : {})
    },
    procs: []
  };

  // What a unit may roll for during a fight, shown beside its skills
  if ( optional.stars?.chance ) optional.procs.push({
    key: "movementStars",
    icon: "star",
    label: "FEO.Optional.stars.title",
    localize: true,
    chance: optional.stars.chance,
    hint: "FEO.Optional.stars.rollHint"
  });
  if ( optional.crest?.borne ) optional.procs.push({
    key: "crest",
    icon: "shield",
    label: optional.crest.borne.label,
    localize: optional.crest.borne.localize,
    chance: optional.crest.borne.chance,
    hint: "FEO.Optional.crest.rollHint"
  });
  return optional;
}

/* -------------------------------------------- */

/**
 * Additional Lives.
 * @param {object} system
 * @param {string|null} army
 * @returns {object}
 */
function prepareLives(system, army) {
  const state = livesState(system.lives, { applies: FEO.optional.lives.armies.includes(army) });
  return {
    ...state,
    value: system.lives?.value ?? null,
    max: system.lives?.max ?? null,
    pips: Array.from({ length: Math.min(state.limit, 12) }, (_, index) => index < state.left),
    last: state.used && (state.left === 1),
    none: state.used && (state.left === 0)
  };
}

/* -------------------------------------------- */

/**
 * The Level Cap: the unit's level limit, and the limit typed on its sheet in place of the world's cap.
 * @param {object} system
 * @returns {object}
 */
function prepareLevelCap(system) {
  const limit = levelLimit(system.levelLimit);
  return {
    value: system.levelLimit ?? null,
    limit,
    cap: FEO.optional.levelCap.cap,
    reached: atLevelLimit(system.level, limit)
  };
}

/* -------------------------------------------- */

/**
 * Movement Stars.
 * @param {object} system
 * @returns {object}
 */
function prepareStars(system) {
  const { max } = FEO.optional.movementStars;
  const value = system.movementStars ?? 0;

  // Those its Powers add count with its own
  const total = system.starsTotal ?? value;
  return {
    value,
    bonus: total - value,
    chance: starChance(total),
    pips: Array.from({ length: max }, (_, index) => index < total)
  };
}

/* -------------------------------------------- */

/**
 * The Follow-up Critical Multiplier: the unit's FCM, and its Critical with the weapon in hand as a follow-up
 * attack counts it, before the foe's Critical Avoid is taken off.
 * @param {object} system
 * @returns {object}
 */
function prepareFcm(system) {
  const { base, max } = FEO.optional.followUpCritical;
  const times = followUpTimes(system.fcm);
  const critical = system.combat?.critical?.value ?? 0;
  return {
    value: system.fcm ?? base,
    min: base,
    max,
    times,
    raised: times > base,
    critical,
    followUp: followUpCritical(critical, system.fcm)
  };
}

/* -------------------------------------------- */

/**
 * Glory: what the unit has to spend, what it gives when brought down, and the Powers, cheapest first, with
 * those it holds and those it can pay for.
 * @param {object} system
 * @returns {object}
 */
function prepareGlory(system) {
  const config = FEO.optional.glory;
  const glory = system.glory ?? {};
  const value = glory.value ?? 0;
  const held = new Set(glory.powers ?? []);
  const powers = Object.entries(config.powers).map(([id, power]) => ({
    id,
    cost: power.cost,
    name: `FEO.Optional.glory.powers.${id}.name`,
    text: `FEO.Optional.glory.powers.${id}.text`,
    mode: `FEO.Optional.glory.mode.${powerMode(id)}`,
    held: held.has(id),
    affordable: !held.has(id) && (value >= power.cost)
  }));
  return {
    value,
    bounty: glory.bounty ?? 0,
    held: powers.filter((power) => power.held),
    open: powers.filter((power) => !power.held),
    any: held.size > 0
  };
}

/* -------------------------------------------- */

/**
 * Holy Blood: the chart of lineages, and what the ones a unit holds give it.
 * @param {object} system
 * @returns {object}
 */
function prepareBlood(system) {
  const config = FEO.optional.holyBlood;
  const held = system.holyBlood?.lineages ?? {};
  const rows = Object.entries(config.lineages).map(([key, lineage]) => {
    const grade = held[key] ?? "";
    const major = grade === "major";
    const times = major ? config.majorMultiplier : 1;
    return {
      key,
      label: `FEO.Optional.blood.names.${key}`,
      path: `system.holyBlood.lineages.${key}`,
      grade,
      gradeLabel: grade ? config.grades[grade] : null,
      held: !!grade,
      major,
      growths: Object.entries(lineage.growths).map(([stat, amount]) => ({
        label: `FEO.Stat.${stat}.abbr`,
        amount: amount * times
      })),
      rank: FEO.proficiencies[lineage.rank],
      rankNote: major ? "FEO.Optional.blood.rankMajor" : "FEO.Optional.blood.rankMinor",
      topRank: FEO.ranks[config.majorRank],
      steps: config.minorRanks
    };
  });
  return {
    rows,
    any: rows.some((row) => row.held),
    gradeChoices: config.grades
  };
}

/* -------------------------------------------- */

/**
 * The Crest a unit bears.
 * @param {object} system
 * @returns {object}
 */
function prepareCrest(system) {
  const config = FEO.optional.crests;
  const crest = system.crest ?? {};
  const borne = crestOf(crest);
  const choices = Object.fromEntries(Object.keys(config.crests).map((key) => [key, `FEO.Optional.crest.names.${key}`]));
  choices[config.custom] = "FEO.Optional.crest.custom";
  return {
    id: crest.id ?? "",
    grade: crest.grade ?? "minor",
    name: crest.name ?? "",
    effect: crest.effect ?? "",
    chance: crest.chance ?? null,
    custom: crest.id === config.custom,
    choices,
    gradeChoices: config.grades,
    borne: borne ? {
      chance: borne.chance,
      gradeLabel: config.grades[borne.grade],
      label: borne.custom ? (borne.name || "FEO.Optional.crest.custom") : `FEO.Optional.crest.names.${borne.id}`,
      localize: !borne.custom || !borne.name,
      effect: borne.custom ? borne.effect : `FEO.Optional.crest.effects.${borne.id}`,
      effectLocalize: !borne.custom
    } : null
  };
}

/* -------------------------------------------- */

/**
 * Authority & Leadership.
 * @param {object} system
 * @param {{uuid: string, name: string}[]} leaders
 * @returns {object}
 */
function prepareLeadership(system, leaders) {
  const config = FEO.optional.leadership;
  const leadership = system.leadership ?? {};
  const authority = leadership.authority ?? "";
  const choices = Object.fromEntries(leaders.map((leader) => [leader.uuid, leader.name]));
  return {
    stars: leadership.stars ?? 0,
    max: config.max,
    authority,
    choices,
    linked: !!authority,
    missing: !!authority && !(authority in choices),
    received: leadership.received ?? 0,
    own: parts(leadershipBonus(leadership.stars)),
    lent: parts(leadershipBonus(leadership.received))
  };
}

/* -------------------------------------------- */

/**
 * What a weapon row shows for the Weapon Kill Critical Bonus.
 * @param {object} weapon     Weapon system data
 * @returns {{kills: number|null, killBonus: number, killsToGo: number}}   `kills` is null while the world does
 *          not use the module
 */
export function weaponKills(weapon) {
  const config = FEO.optional.weaponKills;
  if ( !config.enabled ) return { kills: null, killBonus: 0, killsToGo: 0 };
  const kills = weapon.kills ?? 0;
  return { kills, killBonus: killBonus(kills), killsToGo: Math.max(config.threshold + 1 - kills, 0) };
}

/* -------------------------------------------- */
/*  Chat Cards                                  */
/* -------------------------------------------- */

/**
 * The card for a unit that lost a life, lost its last one, or came back with one.
 * @param {"lost"|"last"|"revived"} event
 * @param {{name: string, left: number, limit: number}} data
 * @param {Localizer} i18n
 * @returns {import("../helpers/chat.mjs").ChatCard}
 */
export function buildLifeCard(event, { name, left, limit }, i18n) {
  const good = event === "revived";
  return {
    title: i18n.format(`FEO.Optional.lives.card.${event}`, { name }),
    outcome: {
      label: i18n.format("FEO.Optional.lives.card.left", { left, limit }),
      cls: good ? "good" : "bad"
    },
    note: i18n.localize(`FEO.Optional.lives.card.${event}Note`)
  };
}

/* -------------------------------------------- */

/**
 * The card for a chance rolled from the sheet: Movement Stars or a Crest.
 * @param {object} data
 * @param {string} data.title
 * @param {string} [data.subtitle]
 * @param {number} data.roll        The d100
 * @param {number} data.chance      In percent
 * @param {boolean} data.success
 * @param {string} data.yes         What to say when it comes up
 * @param {string} data.no          What to say when it does not
 * @param {string} [data.note]
 * @param {Localizer} i18n
 * @returns {import("../helpers/chat.mjs").ChatCard}
 */
export function buildChanceCard({ title, subtitle, roll, chance, success, yes, no, note }, i18n) {
  return {
    title,
    subtitle,
    outcome: { label: success ? yes : no, cls: success ? "good" : "bad" },
    rows: [{
      label: i18n.localize("FEO.Optional.chance"),
      value: i18n.format("FEO.Chat.rolledAgainst", { roll, target: chance })
    }],
    note
  };
}

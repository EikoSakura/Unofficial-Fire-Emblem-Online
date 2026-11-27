import { FEO } from "../config.mjs";

/**
 * The Optional Modules that are a world setting and a few fields on the unit: Additional Affinity Effects,
 * Additional Lives, Additional
 * Growth Rates, Movement Stars, Holy Blood, Crests, Authority & Leadership, the Weapon Kill Critical Bonus and
 * the Level Cap. Pure functions, so that they can be tested outside of Foundry. Every number comes from the Optional Modules
 * section of the configuration.
 */

/* -------------------------------------------- */
/*  Additional Affinity Effects                 */
/* -------------------------------------------- */

/**
 * Does a moment of an effect only tell the table that the effect takes place, or mark it as one to check?
 * @param {object} effect
 * @returns {boolean}
 */
function onlyReminds(effect) {
  return !!effect.remind && Object.keys(effect).every((key) => ["proc", "when", "damaged", "ifHit", "ifStruck", "remind"].includes(key));
}

/**
 * The effects an Affinity builds into its unit, as the system applies them in this world. A condition the
 * world does not play with cannot be inflicted: its moment is then announced, for the table to apply.
 * @param {string} affinity
 * @param {object} [options]
 * @param {object} [options.config]         FEO.optional.affinityEffects
 * @param {object} [options.affinities]     The affinities in use: FEO.affinities
 * @param {object} [options.conditions]     The conditions in use: FEO.conditions
 * @returns {object[]}      Effects in the notation of skill effects; none for an Affinity that is left to the
 *                          table, and none while the world does not play with the module
 */
export function affinityEffects(affinity, { config = FEO.optional.affinityEffects, affinities = FEO.affinities, conditions = FEO.conditions } = {}) {
  if ( !config.enabled || !affinity || !(affinity in affinities) ) return [];
  return (config.effects[affinity] ?? []).map((effect) => {
    const unknown = (effect.inflicts ?? []).some((entry) => !(((typeof entry === "string") ? entry : entry?.id) in conditions));
    if ( !unknown ) return effect;
    const { inflicts, ...rest } = effect;
    return { ...rest, remind: true };
  });
}

/* -------------------------------------------- */

/**
 * What an Affinity builds into its unit, as one more skill of the unit: an entry the skill rules read like
 * that of an equipped skill, which Nihil does not cancel.
 * @param {string} affinity
 * @param {string} name             What it goes by in fights and on cards
 * @param {object} [options]        As for `affinityEffects`
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}|null}    Null for an Affinity with
 *          nothing for the system to apply or announce
 */
export function affinityEntry(affinity, name, options = {}) {
  const effects = affinityEffects(affinity, options);
  return effects.length ? { name, innate: true, nihil: false, effects } : null;
}

/* -------------------------------------------- */

/**
 * How much of an Affinity's effect the system takes care of: "auto" when it applies it, "announced" when it
 * only says that it takes place or lists it as one to check, "manual" when it is left to the table entirely.
 * @param {string} affinity
 * @param {object} [options]        As for `affinityEffects`
 * @returns {"auto"|"announced"|"manual"|null}      Null while the module is off, or for no Affinity
 */
export function affinityEffectMode(affinity, options = {}) {
  const config = options.config ?? FEO.optional.affinityEffects;
  if ( !config.enabled || !affinity || !(affinity in (options.affinities ?? FEO.affinities)) ) return null;
  const effects = affinityEffects(affinity, options);
  if ( !effects.length ) {
    const built = affinityRankOf({ affinity }, options) || config.activationExp?.[affinity] || config.cooldown?.[affinity];
    return built ? "auto" : "manual";
  }
  return effects.every(onlyReminds) ? "announced" : "auto";
}

/* -------------------------------------------- */

/** What the effect of an Affinity goes by among its unit's skills, in place of the id an Item has. */
export const AFFINITY_ID = "affinity";

/**
 * How an Affinity its unit chooses when to use is used, as a skill says it (see `skill-usage.mjs`), and what
 * spends it.
 * @param {string} affinity
 * @param {object} [options]        As for `affinityEffects`
 * @returns {{usage: object, spentBy: "fight"|"move"|"shove"}|null}     Null for an Affinity that is always
 *          there, for no Affinity, and while the world does not play with the module
 */
export function affinityUsage(affinity, { config = FEO.optional.affinityEffects, affinities = FEO.affinities } = {}) {
  if ( !config.enabled || !affinity || !(affinity in affinities) ) return null;
  const usage = config.usage?.[affinity];
  if ( !usage?.kind ) return null;
  return { usage: { ...usage }, spentBy: config.spentBy?.[affinity] ?? "fight" };
}

/* -------------------------------------------- */

/**
 * The experience an Affinity gives its unit for the Skills of that unit that rolled to activate and did, as
 * Emblem does: so much for each, by what the Skill divides its stat by. A Skill that divides it by something
 * the Affinity does not name gives nothing.
 * @param {string} affinity
 * @param {number[]} [grades]       What each Skill that activated divides its stat by; 1 for one that reads
 *                                  the whole stat
 * @param {object} [options]        As for `affinityEffects`
 * @returns {number}
 */
export function activationExp(affinity, grades = [], { config = FEO.optional.affinityEffects, affinities = FEO.affinities } = {}) {
  if ( !config.enabled || !affinity || !(affinity in affinities) ) return 0;
  const table = config.activationExp?.[affinity];
  if ( !table?.length ) return 0;
  return (grades ?? []).reduce((sum, grade) => {
    return sum + (table.find((row) => Math.abs(row.div - Number(grade)) < 0.01)?.exp ?? 0);
  }, 0);
}

/* -------------------------------------------- */

/**
 * What a chance to activate divides its stat by, for what counts the Skills that activated: 1 for a chance
 * that is the whole stat, 1.5 for one that is the stat by 1.5, and so on. Only a chance read from a stat of
 * the unit has one: not a plain percent, not one that needs no roll, not an answer.
 * @param {object} [proc]           The `proc` of a skill effect, as the skill words it
 * @returns {number|null}
 */
export function activationGrade(proc) {
  if ( !proc || proc.sure || proc.may || proc.fixed || (proc.percent != null) ) return null;
  if ( (typeof proc.stat !== "string") || proc.stat.includes(":") ) return null;
  const grade = (Number(proc.div) || 1) / (Number(proc.times) || 1);
  return (grade > 0) ? Math.round(grade * 100) / 100 : null;
}

/* -------------------------------------------- */

/**
 * Does a skill have a cooldown: one of its own, one for a use beyond the uses it has, or one a part of its
 * effects names?
 * @param {object} skill            A skill's data: usage, effects
 * @returns {boolean}
 */
export function hasCooldown(skill) {
  const usage = skill?.usage;
  if ( !usage?.kind ) return false;
  if ( (usage.cooldown > 0) || (usage.over?.cooldown > 0) ) return true;
  return (skill.effects ?? []).some((effect) => (effect?.refresh?.option?.cooldown > 0) || (effect?.step?.cooldown?.stay > 0));
}

/* -------------------------------------------- */

/**
 * What an Affinity takes off the cooldown of the one skill its unit chose for it, as Key does.
 * @param {object} unit
 * @param {string} unit.affinity
 * @param {string} [unit.affinitySkill]     The skill chosen, by the id of its Item
 * @param {object} [options]        As for `affinityEffects`
 * @returns {{skill: string, turns: number}|null}   Null for an Affinity that takes nothing off, and while no
 *          skill is chosen
 */
export function affinityCooldown(unit, { config = FEO.optional.affinityEffects, affinities = FEO.affinities } = {}) {
  const affinity = unit?.affinity;
  const inUse = config.enabled || !!unit?.glory?.extras?.resonance;
  if ( !inUse || !affinity || !(affinity in affinities) ) return null;
  const turns = Math.trunc(Number(config.cooldown?.[affinity])) || 0;
  return (turns && unit.affinitySkill) ? { skill: String(unit.affinitySkill), turns } : null;
}

/* -------------------------------------------- */

/** What a unit keeps the rank of its Affinity under, among the ranks its skills have given. */
export const AFFINITY_RANK = "affinity";

/**
 * The rank an Affinity gives in a proficiency of its unit's choice, as Tome's "+1 Rank in a magic Proficiency
 * of their choice" does. Nothing is given until the choice is made.
 *
 * A unit whose Affinity counts at all times, as a Power of Glory has it, is given the rank whether or not the
 * world plays with the Additional Affinity Effects.
 * @param {object} unit
 * @param {string} unit.affinity
 * @param {string} [unit.affinityRank]      The proficiency chosen; blank while none is
 * @param {object} [options]
 * @param {object} [options.config]         FEO.optional.affinityEffects
 * @param {object} [options.affinities]     The affinities in use: FEO.affinities
 * @param {object} [options.proficiencies]  The proficiencies in use: FEO.proficiencies
 * @returns {{options: string[], steps: number, choice: string, wanted: Record<string, number>}|null}
 *   What can be chosen, the ranks it gives, what is chosen, and the ranks that gives by proficiency; null for
 *   an Affinity that gives no rank, and while the world does not play with the module
 */
export function affinityRankOf(unit, { config = FEO.optional.affinityEffects, affinities = FEO.affinities, proficiencies = FEO.proficiencies } = {}) {
  const affinity = unit?.affinity;
  const inUse = config.enabled || !!unit?.glory?.extras?.resonance;
  if ( !inUse || !affinity || !(affinity in affinities) ) return null;
  const rule = config.ranks?.[affinity];
  const options = (rule?.options ?? []).filter((key) => key in proficiencies);
  const steps = Math.max(Math.trunc(Number(rule?.steps)) || 0, 0);
  if ( !options.length || !steps ) return null;
  const choice = options.includes(unit.affinityRank) ? unit.affinityRank : "";
  return { options, steps, choice, wanted: choice ? { [choice]: steps } : {} };
}

/* -------------------------------------------- */
/*  Skill Capacity                              */
/* -------------------------------------------- */

/**
 * The tier a unit has reached, for its Capacity Points: that of its class, or for a class that does not
 * promote, and for a unit without one, the tier a promotion would have brought by its level.
 * @param {object} unit
 * @param {string|null} [unit.tier]         The tier of its class, a key of FEO.classTiers
 * @param {boolean} [unit.promotes]         Does its class promote?
 * @param {number} [unit.level]
 * @param {object} [options]
 * @param {object} [options.tiers]          FEO.classTiers
 * @param {number[]} [options.levels]       FEO.promotionLevels
 * @returns {"base"|"second"|"third"}
 */
export function capacityTier({ tier = null, promotes = false, level = 1 } = {}, { tiers = FEO.classTiers, levels = FEO.promotionLevels } = {}) {
  const names = ["base", "second", "third"];
  const byLevel = levels.filter((at) => level > at).length;
  const order = tiers[tier]?.order ?? null;
  if ( (order === null) || (!promotes && (order <= tiers.base.order)) ) return names[Math.min(byLevel, 2)];
  return names[Math.min(Math.max(order - tiers.base.order, 0), 2)];
}

/* -------------------------------------------- */

/**
 * @typedef SkillRoom
 * The room a unit has for skills.
 * @property {boolean} capacity     Does Skill Capacity limit them?
 * @property {number} slots         The skills it may have equipped at once
 * @property {number} used          Those it has equipped
 * @property {number|null} limit    Its Capacity Points; null without Skill Capacity
 * @property {number} spent         The Capacity Costs of the skills it has equipped
 * @property {string|null} tier     The tier its Capacity Points are those of; null where they are typed on
 *                                  its sheet, or without Skill Capacity
 */

/**
 * The room a unit has for skills: its slots, and with Skill Capacity its Capacity Points.
 * @param {object} unit
 * @param {number[]} unit.costs             The Capacity Costs of the skills it has equipped that take a slot
 * @param {number} [unit.slots]             Slots its skills add
 * @param {number} [unit.capacity]          Capacity Points its skills add
 * @param {number|null} [unit.own]          Capacity Points typed on its sheet
 * @param {string|null} [unit.tier]         As for `capacityTier`
 * @param {boolean} [unit.promotes]
 * @param {number} [unit.level]
 * @param {object} [options]
 * @param {object} [options.config]         FEO.optional.skillCapacity
 * @param {number} [options.usual]          FEO.skillSlots
 * @returns {SkillRoom}
 */
export function skillRoom({ costs = [], slots = 0, capacity = 0, own = null, tier = null, promotes = false, level = 1 } = {},
  { config = FEO.optional.skillCapacity, usual = FEO.skillSlots } = {}) {
  const used = costs.length;
  if ( !config.enabled ) return { capacity: false, slots: usual + slots, used, limit: null, spent: 0, tier: null };
  const reached = capacityTier({ tier, promotes, level });
  return {
    capacity: true,
    slots: config.slots + slots,
    used,
    limit: (own ?? config.points[reached]) + capacity,
    spent: costs.reduce((sum, cost) => sum + (cost ?? 0), 0),
    tier: (own === null) ? reached : null
  };
}

/* -------------------------------------------- */

/**
 * Has a unit room to equip one more skill?
 * @param {SkillRoom} room
 * @param {number} [cost]       The skill's Capacity Cost
 * @returns {{ok: boolean, why: "slots"|"capacity"|null}}
 */
export function skillFits(room, cost = 0) {
  if ( room.used >= room.slots ) return { ok: false, why: "slots" };
  if ( room.capacity && ((room.spent + (cost ?? 0)) > room.limit) ) return { ok: false, why: "capacity" };
  return { ok: true, why: null };
}

/* -------------------------------------------- */
/*  Glory                                       */
/* -------------------------------------------- */

/**
 * The Powers a unit holds, as the configuration knows them: each once, in the order of the table.
 * @param {string[]} [held]         The Powers the unit keeps
 * @param {object} [config]         FEO.optional.glory
 * @returns {string[]}
 */
export function heldPowers(held, config = FEO.optional.glory) {
  const mine = new Set(held ?? []);
  return Object.keys(config.powers).filter((id) => mine.has(id));
}

/* -------------------------------------------- */

/**
 * What a Power does, in the notation of skill effects, as the system applies it in this world. What it adds to
 * its unit's chances of inflicting conditions is written out for every condition the world plays with.
 * @param {string} id
 * @param {object} [options]
 * @param {object} [options.config]         FEO.optional.glory
 * @param {object} [options.conditions]     The conditions in use: FEO.conditions
 * @returns {object[]}
 */
export function powerEffects(id, { config = FEO.optional.glory, conditions = FEO.conditions } = {}) {
  const power = config.powers[id];
  if ( !power ) return [];
  const effects = [...(power.effects ?? [])];
  if ( power.afflict ) {
    const chances = Object.fromEntries(Object.keys(conditions).map((key) => {
      return [key, power.afflict.conditions.includes(key) ? power.afflict.more : power.afflict.amount];
    }));
    if ( Object.keys(chances).length ) effects.push({ inflictChance: chances });
  }
  return effects;
}

/* -------------------------------------------- */

/**
 * The Powers a unit holds as skills of the unit, each named after its Power: entries the skill rules read like
 * those of equipped skills, which Nihil does not cancel. A Power with nothing for the system to apply or
 * announce has none.
 * @param {string[]} held                   The Powers the unit keeps
 * @param {(id: string) => string} name     What a Power goes by in fights and on cards
 * @param {object} [options]                As for `powerEffects`
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}[]}   None while the module is off
 */
export function powerEntries(held, name, options = {}) {
  const config = options.config ?? FEO.optional.glory;
  if ( !config.enabled ) return [];
  return heldPowers(held, config).map((id) => ({ name: name(id), innate: true, nihil: false, effects: powerEffects(id, options) }))
    .filter((entry) => entry.effects.length);
}

/* -------------------------------------------- */

/**
 * How much of a Power the system takes care of: "auto" when it applies it, "partly" when a part of it is left
 * to the table, "announced" when it only says that it takes place or lists it as one to check, and "manual"
 * when it is left to the table entirely.
 * @param {string} id
 * @param {object} [options]        As for `powerEffects`
 * @returns {"auto"|"partly"|"announced"|"manual"|null}     Null for a Power the configuration does not know
 */
export function powerMode(id, options = {}) {
  const power = (options.config ?? FEO.optional.glory).powers[id];
  if ( !power ) return null;
  const effects = powerEffects(id, options);
  const more = !!power.stars || !!power.resonance;
  if ( !effects.length && !more ) return "manual";
  if ( !more && effects.every(onlyReminds) ) return "announced";
  return power.partly ? "partly" : "auto";
}

/* -------------------------------------------- */

/**
 * What a unit's Powers add outside of the skill rules: Movement Stars, and whether its Affinity counts for it
 * at all times.
 * @param {string[]} held           The Powers the unit keeps
 * @param {object} [config]         FEO.optional.glory
 * @returns {{stars: number, resonance: boolean}}   Nothing while the module is off
 */
export function powerExtras(held, config = FEO.optional.glory) {
  const extras = { stars: 0, resonance: false };
  if ( !config.enabled ) return extras;
  for ( const id of heldPowers(held, config) ) {
    extras.stars += config.powers[id].stars ?? 0;
    extras.resonance ||= !!config.powers[id].resonance;
  }
  return extras;
}

/* -------------------------------------------- */

/**
 * Unlock a Power with a unit's Glory, or give one up and have its Glory back.
 * @param {{value: number, powers: string[]}} glory     What the unit keeps
 * @param {string} id
 * @param {object} [config]         FEO.optional.glory
 * @returns {{value: number, powers: string[]}|null}    What it keeps afterwards, or null when nothing changes:
 *          an unknown Power, one it already holds, or more than its Glory pays for
 */
export function buyPower(glory, id, config = FEO.optional.glory) {
  const power = config.powers[id];
  const held = glory?.powers ?? [];
  if ( !power || held.includes(id) || ((glory?.value ?? 0) < power.cost) ) return null;
  return { value: glory.value - power.cost, powers: heldPowers([...held, id], config) };
}

export function refundPower(glory, id, config = FEO.optional.glory) {
  const power = config.powers[id];
  const held = glory?.powers ?? [];
  if ( !power || !held.includes(id) ) return null;
  return { value: (glory?.value ?? 0) + power.cost, powers: held.filter((other) => other !== id) };
}

/* -------------------------------------------- */

/**
 * The Glory a unit earns for a fight: what its foe gives, when the fight brought the foe down.
 * @param {number} before       The foe's HP before the fight
 * @param {number} after        Its HP after it
 * @param {number} [bounty]     The Glory the foe gives when it is brought down
 * @param {object} [config]     FEO.optional.glory
 * @returns {number}
 */
export function gloryEarned(before, after, bounty = 0, config = FEO.optional.glory) {
  if ( !config.enabled || !felled(before, after) ) return 0;
  return Math.max(Math.trunc(bounty) || 0, 0);
}

/* -------------------------------------------- */
/*  Heart Seals and Reclassing                  */
/* -------------------------------------------- */

/** Fold a class name, to tell whether two entries name the same class. */
const foldName = (name) => String(name ?? "").trim().toLowerCase();

/**
 * @typedef SealClass
 * One of a unit's Heart Seal Classes: a class it starts in, by its name and where it was taken from.
 * @property {string} name
 * @property {string} uuid          Blank for one that is only known by name
 * @property {boolean} [starting]   Is it the class the unit's own line starts in, which is always on the list?
 */

/**
 * A unit's Heart Seal Classes: the class its own line starts in, then the classes chosen for it.
 * @param {{name: string, uuid: string}[]} [chosen]     What the unit keeps
 * @param {{name: string, uuid?: string}|null} [starting]   The class its line starts in, if it has one
 * @returns {SealClass[]}
 */
export function sealClasses(chosen, starting = null) {
  const list = [];
  const seen = new Set();
  const add = (entry, own) => {
    const key = foldName(entry?.name);
    if ( !key || seen.has(key) ) return;
    seen.add(key);
    list.push(own ? { name: entry.name, uuid: entry.uuid ?? "", starting: true } : { name: entry.name, uuid: entry.uuid ?? "" });
  };
  if ( starting ) add(starting, true);
  for ( const entry of chosen ?? [] ) add(entry, false);
  return list;
}

/* -------------------------------------------- */

/**
 * Put a class on a unit's list of Heart Seal Classes.
 * @param {{name: string, uuid: string}[]} [chosen]     What the unit keeps
 * @param {{name: string, uuid?: string}} cls
 * @param {object} [options]
 * @param {{name: string}|null} [options.starting]      The class its line starts in, which needs no entry
 * @param {number|null} [options.limit]                 The most it may choose; null for no limit
 * @returns {{name: string, uuid: string}[]|null}       The list to keep, or null when nothing changes: the
 *          class is on it already, or the list is full
 */
export function addSealClass(chosen, cls, { starting = null, limit = null } = {}) {
  const key = foldName(cls?.name);
  const kept = (chosen ?? []).map((entry) => ({ name: entry.name, uuid: entry.uuid ?? "" }));
  if ( !key || (foldName(starting?.name) === key) || kept.some((entry) => foldName(entry.name) === key) ) return null;
  if ( (limit !== null) && (kept.length >= limit) ) return null;
  return [...kept, { name: cls.name, uuid: cls.uuid ?? "" }];
}

/* -------------------------------------------- */

/**
 * Take a class off a unit's list of Heart Seal Classes.
 * @param {{name: string, uuid: string}[]} [chosen]
 * @param {string} name
 * @returns {{name: string, uuid: string}[]|null}       The list to keep, or null when the class is not on it
 */
export function removeSealClass(chosen, name) {
  const key = foldName(name);
  const kept = (chosen ?? []).filter((entry) => foldName(entry.name) !== key).map((entry) => ({ name: entry.name, uuid: entry.uuid ?? "" }));
  return kept.length === (chosen ?? []).length ? null : kept;
}

/* -------------------------------------------- */

/**
 * What a reclass leaves of a unit's Heart Seal Classes. The class the old line started in stays on the list,
 * and the class the new line starts in needs no entry there. A class that is not one of the unit's own, which
 * a Second Seal took it into, is its guest: it is not kept on the list once the unit leaves it.
 * @param {{name: string, uuid: string}[]} [chosen]     What the unit keeps
 * @param {object} change
 * @param {{name: string, uuid?: string}|null} [change.left]    The class the old line started in
 * @param {{name: string}} change.entered           The class the new line starts in
 * @param {string} [change.guest]                   The class the unit was a guest of until now
 * @returns {{list: {name: string, uuid: string}[], guest: string}}     The list to keep, and the class the
 *          unit is a guest of from now on, if it is one
 */
export function sealClassesAfter(chosen, { left = null, entered, guest = "" } = {}) {
  const kept = (chosen ?? []).map((entry) => ({ name: entry.name, uuid: entry.uuid ?? "" }));
  const [was, old, now] = [foldName(guest), foldName(left?.name), foldName(entered?.name)];
  const own = (old && (old !== was) && (old === now)) || kept.some((entry) => foldName(entry.name) === now);
  let list = kept;
  if ( old && (old !== was) ) list = addSealClass(list, left) ?? list;
  list = removeSealClass(list, entered?.name) ?? list;
  return { list, guest: (now && !own) ? String(entered.name) : "" };
}

/* -------------------------------------------- */
/*  Additional Lives                            */
/* -------------------------------------------- */

/**
 * @typedef LivesState
 * @property {boolean} used     Does the unit have lives at all?
 * @property {number} limit     Its total lives
 * @property {number} left      The lives it has left
 */

/**
 * The lives a unit has. A unit whose total is left empty follows its side: the sides that use lives start with
 * the usual number, the others have none. A total typed by hand always counts.
 * @param {{value: number|null, max: number|null}} [lives]    The unit's own fields
 * @param {object} [options]
 * @param {boolean} [options.applies]     Does the unit's side use lives?
 * @param {object} [options.config]       FEO.optional.lives
 * @returns {LivesState}
 */
export function livesState(lives, { applies = false, config = FEO.optional.lives } = {}) {
  const limit = Math.max(lives?.max ?? (applies ? config.start : 0), 0);
  const left = Math.min(Math.max(lives?.value ?? limit, 0), limit);
  return { used: config.enabled && (limit > 0), limit, left };
}

/* -------------------------------------------- */

/**
 * A unit that would die loses a life instead, and leaves the battle. One that loses its last life is dead.
 * @param {LivesState} state
 * @returns {{left: number, dead: boolean}|null}    Null for a unit with no life to lose
 */
export function loseLife(state) {
  if ( !state?.used || (state.left <= 0) ) return null;
  const left = state.left - 1;
  return { left, dead: left <= 0 };
}

/* -------------------------------------------- */

/**
 * Change the lives a unit has left by an amount, within its total.
 * @param {LivesState} state
 * @param {number} delta
 * @returns {number}    The lives left afterwards
 */
export function adjustLives(state, delta) {
  return Math.min(Math.max(state.left + delta, 0), state.limit);
}

/* -------------------------------------------- */

/**
 * Promoting grants one more life in total and restores one.
 * @param {LivesState} state
 * @param {{max: number, restore: number}} [gain]   FEO.optional.lives.promotion
 * @returns {{max: number, value: number}|null}     Null for a unit without lives
 */
export function promotionLives(state, gain = FEO.optional.lives.promotion) {
  if ( !state?.used ) return null;
  const max = state.limit + gain.max;
  return { max, value: Math.min(state.left + gain.restore, max) };
}

/* -------------------------------------------- */

/**
 * A unit brought back from death returns with one life.
 * @param {LivesState} state
 * @param {number} [lives]    FEO.optional.lives.revive
 * @returns {number|null}     The lives it comes back with, or null when nothing changes
 */
export function reviveLives(state, lives = FEO.optional.lives.revive) {
  if ( !state?.used || (state.left >= lives) ) return null;
  return Math.min(lives, state.limit);
}

/* -------------------------------------------- */
/*  Level Cap                                   */
/* -------------------------------------------- */

/**
 * The highest level a unit can reach: the world's cap, or the limit typed on its sheet, which always counts.
 * @param {number|null} [own]     The unit's own limit; empty to follow the world's cap
 * @param {object} [config]       FEO.optional.levelCap
 * @returns {number|null}         Null while the world plays without a cap
 */
export function levelLimit(own, config = FEO.optional.levelCap) {
  if ( !config.enabled ) return null;
  return Math.max(own ?? config.cap, 1);
}

/* -------------------------------------------- */

/**
 * Has a unit reached its level limit? One that has gains no further level and earns no experience.
 * @param {number} level
 * @param {number|null} limit     As `levelLimit` gives it
 * @returns {boolean}
 */
export function atLevelLimit(level, limit) {
  return (limit !== null) && (limit !== undefined) && ((level ?? 1) >= limit);
}

/* -------------------------------------------- */
/*  Growth Rates                                */
/* -------------------------------------------- */

/**
 * The growth rates a unit rolls on a level up: its own, raised by what its Holy Blood adds. The CON and MOV
 * growth rates of the Additional Growth Rates module are held to their caps.
 * @param {Record<string, number>} growths          The unit's own growth rates
 * @param {Record<string, number>} [bonus]          What is added to them
 * @param {object} [options]
 * @param {string[]} [options.keys]                 The growth rates in use, in order: the keys of FEO.growths
 * @param {Record<string, number>} [options.caps]   FEO.optional.growths.caps
 * @returns {Record<string, number>}
 */
export function effectiveGrowths(growths, bonus = {}, { keys = Object.keys(FEO.growths), caps = FEO.optional.growths.caps } = {}) {
  const rates = {};
  for ( const key of keys ) {
    const own = growths?.[key] ?? 0;
    const held = key in caps ? Math.min(own, caps[key]) : own;
    rates[key] = held + (bonus[key] ?? 0);
  }
  return rates;
}

/* -------------------------------------------- */

/**
 * The cap the Additional Growth Rates module gives a stat that has none of its own.
 * @param {string} key              A stat
 * @param {number|null} cap         The cap the unit's class or its sheet gives
 * @param {object} [config]         FEO.optional.growths
 * @returns {number|null}           The module's cap, or null where it gives none or the stat has its own
 */
export function moduleCap(key, cap, config = FEO.optional.growths) {
  if ( !config.enabled || (cap !== null) || !(key in config.statCaps) ) return null;
  return config.statCaps[key];
}

/* -------------------------------------------- */
/*  Movement Stars, Crests and other chances    */
/* -------------------------------------------- */

/**
 * The chance, in percent, that a unit with Movement Stars acts again after an action.
 * @param {number} stars
 * @param {{max: number, perStar: number}} [config]   FEO.optional.movementStars
 * @returns {number}
 */
export function starChance(stars, config = FEO.optional.movementStars) {
  return Math.min(Math.max(stars ?? 0, 0), config.max) * config.perStar;
}

/* -------------------------------------------- */

/**
 * Does a d100 roll come in at or under a chance?
 * @param {number} roll       1 to 100
 * @param {number} chance     In percent
 * @returns {boolean}
 */
export function activates(roll, chance) {
  return (chance > 0) && (roll <= chance);
}

/* -------------------------------------------- */

/**
 * The Crest a unit bears and its chance to activate.
 * @param {{id: string, grade: string, name?: string, effect?: string, chance?: number|null}} [crest]
 * @param {object} [config]       FEO.optional.crests
 * @returns {{id: string, grade: string, custom: boolean, chance: number, name: string|null, effect: string|null}|null}
 *          `name` and `effect` are set for a Crest of the table's own making; null for a unit without a Crest
 */
export function crestOf(crest, config = FEO.optional.crests) {
  if ( !crest?.id ) return null;
  const grade = crest.grade in config.grades ? crest.grade : "minor";
  if ( crest.id === config.custom ) {
    return { id: crest.id, grade, custom: true, chance: Math.max(crest.chance ?? 0, 0), name: crest.name ?? "", effect: crest.effect ?? "" };
  }
  const entry = config.crests[crest.id];
  if ( !entry ) return null;
  return { id: crest.id, grade, custom: false, chance: entry[grade] ?? 0, name: null, effect: null };
}

/* -------------------------------------------- */
/*  Holy Blood                                  */
/* -------------------------------------------- */

/**
 * The growth rate bonuses a unit's Holy Blood gives: those of each lineage it holds, doubled for Major blood.
 * @param {Record<string, string>} [lineages]   "minor" or "major" by lineage; blank for none
 * @param {object} [config]                     FEO.optional.holyBlood
 * @returns {Record<string, number>}            Percent added, by growth rate
 */
export function bloodGrowths(lineages, config = FEO.optional.holyBlood) {
  const bonus = {};
  for ( const [key, grade] of Object.entries(lineages ?? {}) ) {
    const lineage = config.lineages[key];
    if ( !lineage || !(grade in config.grades) ) continue;
    const times = grade === "major" ? config.majorMultiplier : 1;
    for ( const [stat, amount] of Object.entries(lineage.growths) ) bonus[stat] = (bonus[stat] ?? 0) + (amount * times);
  }
  return bonus;
}

/* -------------------------------------------- */

/**
 * @typedef BloodRank
 * What Holy Blood has done to one proficiency, so that it can be undone.
 * @property {number} steps     Ranks added by Minor blood
 * @property {string} from      The rank Major blood raised it from; blank when no Major blood holds it
 */

/**
 * Work out the ranks a unit's Holy Blood gives. Each Minor lineage raises its weapon's rank by one; Major blood
 * sets it to the highest rank. What was given before is taken back first, so changing or removing a lineage
 * leaves the rank where the unit earned it.
 * @param {Record<string, string>} ranks            The unit's rank in each proficiency
 * @param {Record<string, BloodRank>} records       What Holy Blood has already done, by proficiency
 * @param {Record<string, string>} lineages         "minor" or "major" by lineage, as they are to be
 * @param {object} [options]
 * @param {object} [options.config]                 FEO.optional.holyBlood
 * @param {string[]} [options.order]                Ranks from lowest to highest
 * @returns {{ranks: Record<string, string>, records: Record<string, BloodRank>}}   Only what changes
 */
export function bloodRanks(ranks, records, lineages, { config = FEO.optional.holyBlood, order = Object.keys(FEO.ranks) } = {}) {
  const wanted = {};
  for ( const [key, grade] of Object.entries(lineages ?? {}) ) {
    const proficiency = config.lineages[key]?.rank;
    if ( !proficiency || !(grade in config.grades) ) continue;
    const entry = (wanted[proficiency] ??= { minors: 0, major: false });
    if ( grade === "major" ) entry.major = true;
    else entry.minors += config.minorRanks;
  }

  const top = order.length - 1;
  const changed = { ranks: {}, records: {} };
  const touched = new Set([...Object.keys(wanted), ...Object.keys(records ?? {})]);
  for ( const proficiency of touched ) {
    const current = ranks[proficiency];
    if ( !order.includes(current) ) continue;
    const record = records?.[proficiency] ?? { steps: 0, from: "" };
    const want = wanted[proficiency] ?? { minors: 0, major: false };

    // The rank the unit holds by its own doing
    const earned = order.includes(record.from)
      ? order.indexOf(record.from)
      : Math.max(order.indexOf(current) - (record.steps ?? 0), 0);
    const target = want.major ? Math.max(order.indexOf(config.majorRank), earned) : Math.min(earned + want.minors, top);
    const next = {
      steps: want.major ? 0 : target - earned,
      from: want.major ? order[earned] : ""
    };

    if ( order[target] !== current ) changed.ranks[proficiency] = order[target];
    if ( (next.steps !== (record.steps ?? 0)) || (next.from !== (record.from ?? "")) ) changed.records[proficiency] = next;
  }
  return changed;
}

/* -------------------------------------------- */

/**
 * The proficiencies Holy Blood can raise, which is where a unit keeps what its blood has done.
 * @param {object} [config]     FEO.optional.holyBlood
 * @returns {string[]}
 */
export function bloodProficiencies(config = FEO.optional.holyBlood) {
  return Array.from(new Set(Object.values(config.lineages).map((lineage) => lineage.rank)));
}

/* -------------------------------------------- */
/*  Authority & Leadership                      */
/* -------------------------------------------- */

/**
 * What Leadership Stars add to a unit's combat stats: the amount each star gives, for its own stars and for
 * those of its Authority that reach it.
 * @param {number} stars            Stars lending their bonus
 * @param {object} [config]         FEO.optional.leadership
 * @returns {Record<string, number>|null}     Combat stat bonuses, or null when there are none
 */
export function leadershipBonus(stars, config = FEO.optional.leadership) {
  const count = Math.min(Math.max(stars ?? 0, 0), config.max);
  const perStar = config.perStar[config.mode];
  if ( !count || !perStar ) return null;
  return Object.fromEntries(Object.entries(perStar).map(([key, amount]) => [key, amount * count]));
}

/* -------------------------------------------- */

/**
 * Do the stars of a unit's Authority reach it? Within range of the Authority in the usual reading; anywhere on
 * the same map in the other.
 * @param {number|null} distance    Tiles between the unit and its Authority; null when they are not on a map together
 * @param {object} [config]         FEO.optional.leadership
 * @returns {boolean}
 */
export function leaderReaches(distance, config = FEO.optional.leadership) {
  if ( distance === null ) return false;
  return (config.mode === "map") || (distance <= config.range);
}

/* -------------------------------------------- */

/**
 * The named combat modifiers the Optional Modules give a unit, for its list of sources: its own Leadership
 * Stars, those of its Authority, and the kills made with the weapon it has in hand.
 * @param {object} system             UnitData
 * @param {object|null} [weapon]      The system data of the weapon in hand
 * @param {object} [config]           FEO.optional
 * @returns {{label: string, localize: boolean, combat: object}[]}
 */
export function optionalSources(system, weapon = null, config = FEO.optional) {
  const sources = [];
  const veteran = killModifier(weapon, config.weaponKills);
  if ( veteran ) sources.push(veteran);
  if ( config.leadership.enabled ) {
    const own = leadershipBonus(system.leadership?.total ?? system.leadership?.stars, config.leadership);
    if ( own ) sources.push({ label: "FEO.Optional.leadership.own", localize: true, combat: own });
    const lent = leadershipBonus(system.leadership?.received, config.leadership);
    if ( lent ) sources.push({ label: "FEO.Optional.leadership.fromAuthority", localize: true, combat: lent });
  }
  return sources;
}

/* -------------------------------------------- */
/*  Weapon Kill Critical Bonus                  */
/* -------------------------------------------- */

/**
 * The Critical a weapon gives for the kills made with it: one for every kill past the threshold, up to the cap.
 * @param {number} kills
 * @param {{threshold: number, cap: number, perKill: number}} [config]    FEO.optional.weaponKills
 * @returns {number}
 */
export function killBonus(kills, config = FEO.optional.weaponKills) {
  const counted = Math.min(kills ?? 0, config.cap) - config.threshold;
  return Math.max(counted, 0) * config.perKill;
}

/* -------------------------------------------- */

/**
 * The combat modifier a weapon's kills give the unit wielding it.
 * @param {{kills?: number}|null} weapon    Weapon system data
 * @param {object} [config]                 FEO.optional.weaponKills
 * @returns {{label: string, localize: boolean, combat: {critical: number}}|null}
 */
export function killModifier(weapon, config = FEO.optional.weaponKills) {
  if ( !config.enabled || !weapon ) return null;
  const critical = killBonus(weapon.kills, config);
  return critical ? { label: "FEO.Optional.kills.source", localize: true, combat: { critical } } : null;
}

/* -------------------------------------------- */

/**
 * Did a fight bring a unit down? It did when the unit went from above 0 HP to 0 HP or below.
 * @param {number} before     HP before the fight
 * @param {number} after      HP after it
 * @returns {boolean}
 */
export function felled(before, after) {
  return (before > 0) && (after <= 0);
}

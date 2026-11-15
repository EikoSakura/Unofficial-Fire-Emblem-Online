/**
 * Changing form for Fire Emblem Online: the Laguz Shift Gauge, the stones of Manaketes and Taguel, and the
 * stats of a transformed unit, as the Non-Beorc tab of the rules and the character sheet give them.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";

/**
 * @typedef ShiftState
 * @property {number} value                           The Shift Gauge
 * @property {boolean} active                         Is the unit transformed?
 * @property {{own: number, other: number}} fought    Combats since the unit's turn began: those it started,
 *                                                    which fall in its own phase, and those it was drawn into
 */

/**
 * @typedef GaugeProfile
 * @property {number} start           The gauge at the beginning of a map
 * @property {number} turnHuman       Change at the start of each of the unit's turns in humanoid form
 * @property {number} turnAnimal      The same while transformed
 * @property {number} combatHuman     Change after a combat in humanoid form
 * @property {number} combatAnimal    The same while transformed
 */

const PROFILE_KEYS = ["start", "turnHuman", "turnAnimal", "combatHuman", "combatAnimal"];

/**
 * @typedef ShiftBends
 * What a unit's skills change about how it changes form.
 * @property {number|null} percent      The share added to its stats while transformed, in place of its usual
 *                                      one: the lowest any skill names, or null when none does
 * @property {number} add               Added to that share
 * @property {number} times             What the share is multiplied by, once everything is added
 * @property {Partial<GaugeProfile>} gauge    Added to the values of its Shift Gauge
 * @property {number} transforms        More times a turn that a stone transforms it
 * @property {boolean} endless          Does its stone transform it any number of times a turn?
 * @property {boolean} atWill           Can it Shift whatever its Shift Gauge holds?
 * @property {boolean} keep             Does its Shift Gauge start a map where the last one left it?
 * @property {number|null} humanFight   Set for a unit that may start a fight in humanoid form: the share, in
 *                                      percent, of what such a fight usually does to its gauge
 * @property {string[]} skills          The skills that had a say
 */

/** The parts of a `shift` an effect can carry, by what each is. */
export const SHIFT_PARTS = {
  numbers: ["percent", "add", "times", "transforms", "humanFight", ...PROFILE_KEYS],
  flags: ["endless", "atWill", "keep"]
};

/**
 * Nothing changed about how a unit changes form.
 * @returns {ShiftBends}
 */
export function emptyShiftBends() {
  return { percent: null, add: 0, times: 1, gauge: {}, transforms: 0, endless: false, atWill: false, keep: false, humanFight: null, skills: [] };
}

/* -------------------------------------------- */

/**
 * What a unit's skills change about how it changes form: every `shift` part among their effects. Such a part is
 * always there, or waits for its skill to be switched on; nothing else is asked of it, so that it can be read
 * before the unit's numbers are.
 * @param {{name: string, active?: boolean, effects?: object[]}[]} skills     The unit's equipped skills
 * @returns {ShiftBends}
 */
export function shiftBends(skills) {
  const bends = emptyShiftBends();
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      const part = effect?.shift;
      if ( !part || (typeof part !== "object") || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( Number.isFinite(part.percent) ) bends.percent = (bends.percent === null) ? part.percent : Math.min(bends.percent, part.percent);
      if ( Number.isFinite(part.add) ) bends.add += part.add;
      if ( Number.isFinite(part.times) ) bends.times *= part.times;
      if ( Number.isFinite(part.transforms) ) bends.transforms += part.transforms;
      for ( const key of PROFILE_KEYS ) if ( Number.isFinite(part[key]) ) bends.gauge[key] = (bends.gauge[key] ?? 0) + part[key];
      for ( const key of SHIFT_PARTS.flags ) if ( part[key] ) bends[key] = true;
      if ( Number.isFinite(part.humanFight) ) bends.humanFight = (bends.humanFight === null) ? part.humanFight : Math.max(bends.humanFight, part.humanFight);
      if ( !bends.skills.includes(skill.name) ) bends.skills.push(skill.name);
    }
  }
  return bends;
}

/* -------------------------------------------- */

/**
 * How a unit changes form, if it does.
 * @param {string} [race]     The people of its class, a key of FEO.races
 * @param {string} [choice]   What its sheet says: blank to follow the class, a key of FEO.shift.modes, or "none"
 * @returns {"gauge"|"stone"|null}
 */
export function shiftMode(race, choice = "") {
  if ( choice === "none" ) return null;
  if ( choice in FEO.shift.modes ) return choice;
  return FEO.shift.byRace[race] ?? null;
}

/* -------------------------------------------- */

/**
 * Read a tribe's Shift Gauge values from the notes of its class, with the unit's own values laid over them.
 * @param {{label: string, value: string}[]} [notes]      The notes of the class
 * @param {Partial<Record<keyof GaugeProfile, number|null>>} [overrides]
 * @param {Partial<GaugeProfile>} [more]      What the unit's skills add to the values of its class. A value
 *                                            of the unit's own is used as it is
 * @returns {GaugeProfile}
 */
export function gaugeProfile(notes = [], overrides = {}, more = {}) {
  const fold = (text) => String(text ?? "").replace(/[:\s]+$/, "").trim().toLowerCase();
  const profile = {};
  for ( const key of PROFILE_KEYS ) {
    const extra = Number.isFinite(more?.[key]) ? more[key] : 0;
    const own = overrides?.[key];
    if ( Number.isFinite(own) ) {
      profile[key] = own;
      continue;
    }
    const note = notes.find((entry) => fold(entry.label) === fold(FEO.shift.notes[key]));
    const number = Number(String(note?.value ?? "").replace(/[−–]/g, "-").match(/[+-]?\d+/)?.[0]);
    profile[key] = (Number.isFinite(number) ? number : 0) + extra;
  }
  return profile;
}

/* -------------------------------------------- */

const clampGauge = (value) => Math.min(Math.max(value, 0), FEO.shift.gauge.max);

/**
 * Can a unit Shift? It needs enough gauge, and must not be transformed already.
 * @param {ShiftState} state
 * @param {object} [options]
 * @param {boolean} [options.atWill]    Can it Shift whatever its gauge holds, as some skills allow?
 * @returns {boolean}
 */
export function canShift(state, { atWill = false } = {}) {
  return !state.active && (atWill || (state.value >= FEO.shift.gauge.shiftAt));
}

/* -------------------------------------------- */

/**
 * Change a gauge by an amount. A transformed unit whose gauge runs out reverts.
 * @param {ShiftState} state
 * @param {number} delta
 * @returns {{value: number, active: boolean, delta: number, reverted: boolean}}
 */
export function changeGauge(state, delta) {
  const value = clampGauge((state.value ?? 0) + (delta ?? 0));
  const reverted = !!state.active && (value <= 0);
  return { value, active: !!state.active && !reverted, delta: value - (state.value ?? 0), reverted };
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: its gauge fills in humanoid form and drains while transformed, and its count of
 * combats starts again.
 * @param {ShiftState} state
 * @param {GaugeProfile} profile
 * @returns {{value: number, active: boolean, delta: number, reverted: boolean, fought: {own: number, other: number}}}
 */
export function gaugeTurnStart(state, profile) {
  const change = changeGauge(state, state.active ? profile.turnAnimal : profile.turnHuman);
  return { ...change, fought: { own: 0, other: 0 } };
}

/* -------------------------------------------- */

/**
 * A combat ends: the gauge changes by the full amount for the first combat of a phase and by a single point
 * for every later one. Combats the unit starts fall in its own phase; the rest fall in another.
 * @param {ShiftState} state
 * @param {GaugeProfile} profile
 * @param {object} [options]
 * @param {boolean} [options.initiated]   Did the unit start the combat?
 * @param {number|null} [options.humanFight]    For a unit that may start a fight in humanoid form: the share,
 *                                              in percent, of the usual change that such a fight gives it
 * @param {number} [options.gained]       Points a skill gave the gauge during the combat, counted first
 * @returns {{value: number, active: boolean, delta: number, reverted: boolean, fought: {own: number, other: number},
 *   first: boolean, gained?: number, partial?: boolean}}   `gained`, when a skill gave points, is what of
 *          them the gauge could hold; `partial` is set when only a share of the usual change was given
 */
export function gaugeAfterCombat(state, profile, { initiated = false, humanFight = null, gained = 0 } = {}) {
  const phase = initiated ? "own" : "other";
  const fought = { own: state.fought?.own ?? 0, other: state.fought?.other ?? 0 };
  const first = fought[phase] === 0;
  const full = state.active ? profile.combatAnimal : profile.combatHuman;
  let delta = first ? full : Math.sign(full) * Math.min(Math.abs(full), FEO.shift.gauge.laterCombat);

  // A fight the unit started in humanoid form, which only a skill lets it do, gives a share of that, rounded down
  const partial = initiated && !state.active && Number.isFinite(humanFight);
  if ( partial ) delta = Math.sign(delta) * Math.floor(((Math.abs(delta) * humanFight) / 100) + 1e-9);
  fought[phase] += 1;
  const charged = changeGauge(state, Math.max(gained ?? 0, 0));
  const after = changeGauge({ ...state, value: charged.value }, delta);
  return {
    ...after,
    delta: after.value - (state.value ?? 0),
    fought,
    first,
    ...((gained > 0) ? { gained: charged.delta } : {}),
    ...(partial ? { partial } : {})
  };
}

/* -------------------------------------------- */

/**
 * The share added to a transformed unit's stats, in percent.
 * @param {number|null} [percent]     The unit's own amount, or null for the usual one
 * @param {boolean} [boosted]         Did the unit start its turn beside another Non-Beorc ally?
 * @param {ShiftBends|null} [bends]   What its skills change about the usual amount: a share in its place,
 *                                    points added to it, and what the whole is multiplied by, rounded down.
 *                                    An amount of the unit's own is used as it is
 * @returns {number}
 */
export function shiftPercent(percent = null, boosted = false, bends = null) {
  const boost = boosted ? FEO.shift.allyBonus : 0;
  if ( Number.isFinite(percent) ) return percent + boost;
  const share = (Number.isFinite(bends?.percent) ? bends.percent : FEO.shift.percent) + boost + (bends?.add ?? 0);
  return Math.max(Math.floor((share * (bends?.times ?? 1)) + 1e-9), 0);
}

/* -------------------------------------------- */

/**
 * What transforming adds to each stat: the base value grows by a share, and the result is rounded down once
 * boosts are added, as the character sheet does.
 * @param {Record<string, {base: number, boost: number}>} stats
 * @param {number} percent
 * @returns {Record<string, number>}    The amount added to each stat that changes
 */
export function shiftedBonuses(stats, percent) {
  const bonuses = {};
  for ( const key of FEO.shift.stats ) {
    const { base = 0, boost = 0 } = stats[key] ?? {};
    const gain = Math.floor((base * (100 + percent) / 100) + boost) - (base + boost);
    if ( gain ) bonuses[key] = gain;
  }
  return bonuses;
}

/* -------------------------------------------- */

/**
 * What a class gives or takes while its unit is transformed, beyond the share added to stats: the difference
 * between the second and first number of the stats the class lists twice.
 * @param {object|null} cls     Class data
 * @returns {{stats: Record<string, number>, wt: number}}
 */
export function formBonuses(cls) {
  const stats = {};
  let wt = 0;
  const transformed = cls?.transformed ?? {};
  for ( const [key, value] of Object.entries(transformed) ) {
    if ( !Number.isFinite(value) ) continue;
    if ( key === "wt" ) wt = value - (cls.wt ?? 0);
    else if ( Number.isFinite(cls.base?.[key]) && (value !== cls.base[key]) ) stats[key] = value - cls.base[key];
  }
  return { stats, wt };
}

/* -------------------------------------------- */

/**
 * How many times a stone can still transform its bearer this turn.
 * @param {number} used             Transformations used since the unit's turn began
 * @param {number|null} [max]       The unit's own limit, or null for the usual one
 * @returns {number}
 */
export function transformsLeft(used, max = null) {
  const limit = Number.isFinite(max) ? max : FEO.shift.stone.uses;
  return Math.max(limit - Math.max(used ?? 0, 0), 0);
}

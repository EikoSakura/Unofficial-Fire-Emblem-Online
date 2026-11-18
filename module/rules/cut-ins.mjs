import { FEO } from "../config.mjs";

/**
 * Skill cut-ins: which skills of a fight flash over their units and in what order, and how the ones that wait
 * are paced. As a skill takes effect its icon and name are shown over its unit for a moment, one after the
 * other, so that each can be read; when more wait than can be shown quickly they are shown together. Nothing
 * here decides what a skill does: it only tells of what was already worked out.
 *
 * A cut-in is `{ unit, skill }`: who it is shown over (any key that tells units apart) and the name of the
 * skill. A beat is what is shown at one time: a list of plates, one for each unit, each naming one skill or
 * several.
 *
 * @typedef {{unit: string, skill: string}} CutIn
 * @typedef {{unit: string, skills: {name: string, count: number}[]}} CutInPlate
 * @typedef {CutInPlate[]} CutInBeat
 */

/** The moment at which a skill brings something of its foe's to nothing, which always says so. */
const FOIL = "foil";

/** The moment at which a skill only betters a number, which the card does not tag either. */
const QUIET = "upgrade";

/* -------------------------------------------- */

/**
 * How long one cut-in stays, in milliseconds, for the speed a user asked for.
 * @param {string} speed      A key of `FEO.cutIns.speeds`; anything else is off
 * @returns {number}          0 where cut-ins are off
 */
export function beatTime(speed) {
  return Object.hasOwn(FEO.cutIns.speeds, speed) ? FEO.cutIns.speeds[speed] : 0;
}

/* -------------------------------------------- */

/**
 * The skills that took effect in a fight by chance or by choice, in the order they did: the skills that were
 * declared for it and spent, the chances rolled as it began, then attack by attack what was answered and the
 * chances that came up, and what was rolled once the fighting was over. A skill that is simply always on, or
 * sure of its moment, is not among them; one that brought something to nothing always is.
 * @param {import("./combat.mjs").ExchangeResult} result
 * @param {{initiator?: string[], defender?: string[]}} [declared]    The names of the declared skills the
 *                                                  fight spent for each unit
 * @returns {{by: "initiator"|"defender", skill: string}[]}
 */
export function fightCutIns(result, declared = {}) {
  const shown = [];

  // A declared skill whose chance then comes up is told of once, where it was declared
  const head = new Set();
  const add = (by, skill) => {
    if ( ((by !== "initiator") && (by !== "defender")) || (typeof skill !== "string") || !skill ) return;
    if ( !head.has(`${by}.${skill}`) ) shown.push({ by, skill });
  };
  const chances = (procs) => {
    for ( const proc of procs ?? [] ) {
      if ( !proc?.success || (proc.on === QUIET) ) continue;
      if ( !proc.sure || (proc.on === FOIL) ) add(proc.by, proc.skill);
    }
  };
  for ( const by of ["initiator", "defender"] ) {
    const names = [...new Set(declared?.[by] ?? [])];
    for ( const skill of names ) add(by, skill);
    for ( const skill of names ) head.add(`${by}.${skill}`);
  }
  chances(result?.opening);
  for ( const attack of result?.attacks ?? [] ) {
    for ( const answer of attack.answers ?? [] ) add(answer.by, answer.skill);
    chances(attack.procs);
  }
  for ( const answer of result?.answers ?? [] ) add(answer.by, answer.skill);
  chances(result?.turning);
  chances(result?.closing);
  return shown;
}

/* -------------------------------------------- */

/**
 * Add a skill to a plate, counting one it already names.
 * @param {CutInPlate} plate
 * @param {string} name
 * @param {number} [count]
 */
function name(plate, name, count = 1) {
  const had = plate.skills.find((skill) => skill.name === name);
  if ( had ) had.count += count;
  else plate.skills.push({ name, count });
}

/* -------------------------------------------- */

/**
 * Show every beat of a list at one time: one plate for each unit, in the order the units first came, naming
 * all its skills.
 * @param {CutInBeat[]} beats
 * @returns {CutInBeat[]}     One beat, or none
 */
export function squashBeats(beats) {
  const plates = [];
  for ( const plate of beats.flat() ) {
    let own = plates.find((other) => other.unit === plate.unit);
    if ( !own ) plates.push(own = { unit: plate.unit, skills: [] });
    for ( const skill of plate.skills ) name(own, skill.name, skill.count);
  }
  return plates.length ? [plates] : [];
}

/* -------------------------------------------- */

/**
 * Lay cut-ins out as beats. Each is shown by itself in the order it came, a skill that took effect several
 * times running once with its count. Where that makes more beats than may wait, what a unit does in a row is
 * shown on one plate; and where that is still too many, every unit shows all of its own at one time.
 * @param {CutIn[]} shown
 * @param {number} [most]     How many beats there may be
 * @returns {CutInBeat[]}
 */
export function planBeats(shown, most = FEO.cutIns.most) {
  const told = (shown ?? []).filter((entry) => entry?.unit && entry.skill);
  const beats = [];
  for ( const { unit, skill } of told ) {
    const last = beats.at(-1)?.[0];
    if ( (last?.unit === unit) && (last.skills.length === 1) && (last.skills[0].name === skill) ) last.skills[0].count += 1;
    else beats.push([{ unit, skills: [{ name: skill, count: 1 }] }]);
  }
  if ( beats.length <= most ) return beats;

  // What one unit does in a row is one plate
  const runs = [];
  for ( const [plate] of beats ) {
    const last = runs.at(-1)?.[0];
    if ( last?.unit === plate.unit ) for ( const skill of plate.skills ) name(last, skill.name, skill.count);
    else runs.push([{ unit: plate.unit, skills: plate.skills.map((skill) => ({ ...skill })) }]);
  }
  return (runs.length <= most) ? runs : squashBeats(runs);
}

/* -------------------------------------------- */

/**
 * Add beats to those that already wait. Where more would wait than may, all that wait are shown together.
 * @param {CutInBeat[]} waiting     The beats that have not been shown yet
 * @param {CutInBeat[]} beats       The beats that join them
 * @param {number} [most]
 * @returns {CutInBeat[]}           What waits now
 */
export function queueBeats(waiting, beats, most = FEO.cutIns.most) {
  const all = [...(waiting ?? []), ...(beats ?? [])];
  return (all.length <= most) ? all : squashBeats(all);
}

/* -------------------------------------------- */

/**
 * How long what happens to units waits for the cut-ins to be over, so that a skill is named before its
 * numbers are shown.
 * @param {number} waiting    How many beats have not been shown yet
 * @param {number} left       The milliseconds the beat that is showing still stays
 * @param {number} time       How long one beat stays
 * @returns {number}          Milliseconds; 0 where nothing is showing or waiting
 */
export function holdTime(waiting, left, time) {
  return Math.max(left ?? 0, 0) + (Math.max(waiting ?? 0, 0) * Math.max(time ?? 0, 0));
}

/* -------------------------------------------- */

/**
 * What a plate says: the skills it names, and how many more it only counts.
 * @param {CutInPlate} plate
 * @param {number} [most]     How many skills it names
 * @returns {{names: string[], more: number}}
 */
export function plateText(plate, most = FEO.cutIns.names) {
  const skills = plate?.skills ?? [];
  const names = skills.slice(0, most).map((skill) => (skill.count > 1) ? `${skill.name} ×${skill.count}` : skill.name);
  return { names, more: Math.max(skills.length - most, 0) };
}

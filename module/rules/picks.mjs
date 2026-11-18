/**
 * What a skill has its unit pick as it is learnt, for Fire Emblem Online: one of several variants, a stat, a
 * kind of weapon, a few growth rates, one effect from a list. The pick is made once, kept on the skill as its
 * `choice`, and read from there by everything else. Pure functions of plain data, so that they can be tested
 * outside of Foundry.
 *
 * A skill whose effects carry a `choice` offers those as variants without saying more, and one that raises
 * growth rates of its unit's picking (`growths: { pick: 3 }`) offers the growth rates. Anything else a skill
 * declares in its `picks`, a list with one entry for each thing picked:
 *
 *   picks: [{
 *     id: "order",                      // what the pick is called among the skill's picks
 *     label: "Order",                   // its heading, where it is shown
 *     options: ["Male", "Female"],      // what can be picked; or with what each does, and what it costs:
 *     options: [{ value: "Weißritter", hint: "+4 Skill Activation Rate, +1.5 RES", cost: 1 }],
 *     from: "stats",                    // in place of `options`, a list the unit gives: "stats", "growths",
 *                                       // "proficiencies"; or "start", the proficiency the unit started with,
 *                                       // which is only asked of a unit the Character Creator did not make
 *     count: 3,                         // how many are picked, 1 when left out
 *     points: 4                         // in place of `count`: points to spend on options by their `cost`
 *   }]
 *
 * A pick without `options` or `from` offers the variants of the skill's effects, so that a skill can give its
 * variants a heading and say what each does (`hints: { "Sword": "…" }`).
 *
 * What is picked is written as the skill's `choice`: the values of one pick joined by ", ", and those of
 * several picks by "; " in the order the picks are declared ("HP, STR, SPD"; "Fire; Forest, Hill"). An effect
 * marked `choice: "Forest"` applies while "Forest" is among what is picked.
 *
 * A pick that is complete is locked: a player changes it no more, while the Game Master still can. In the
 * Character Creator nothing is locked until the unit is finished.
 */
import { FEO } from "../config.mjs";

/** The lists a unit gives a pick to choose from. */
export const PICK_LISTS = ["stats", "growths", "proficiencies", "start"];

/**
 * @typedef Pick
 * One thing a skill has its unit pick.
 * @property {string} id
 * @property {string} label           Its heading; blank where the skill gives none
 * @property {string} from            The list it picks from, when it is one the unit gives
 * @property {number} count           How many are picked
 * @property {number} points          Points to spend in place of a count; 0 without
 * @property {PickOption[]|null} options      What can be picked, when the pick itself says so
 */

/**
 * @typedef PickOption
 * @property {string} value
 * @property {string} label           What it is shown as: the value, or a key of the language file
 * @property {boolean} localize       Is the label a key of the language file?
 * @property {string} hint            What it does, in words
 * @property {number} cost            Points it costs, where the pick spends points
 */

/**
 * @typedef PickUnit
 * What a pick may need to know of the unit that makes it. Everything is optional.
 * @property {string[]} [stats]             The stats in use
 * @property {string[]} [growths]           The growth rates in use
 * @property {string[]} [proficiencies]     The proficiencies it may pick from
 * @property {string} [start]               The proficiency it started with, when the Creator kept one
 * @property {boolean} [creating]           Is it being made in the Character Creator?
 */

/**
 * @typedef PickState
 * A pick as it stands on a skill.
 * @property {Pick} pick
 * @property {PickOption[]} options
 * @property {string[]} picked        What is picked of what can be
 * @property {number} spent           Points spent
 * @property {boolean} given          Is it settled without being asked, as a starting proficiency the Creator kept?
 * @property {boolean} open           Is something still to be picked?
 */

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The variants a skill's effects offer.
 * @param {object[]} [effects]
 * @returns {string[]}
 */
export function variantsOf(effects = []) {
  return [...new Set((effects ?? []).map((effect) => effect?.choice).filter(Boolean))];
}

/* -------------------------------------------- */

/**
 * Bring an option into shape.
 * @param {string|object} option
 * @param {Record<string, string>} [hints]
 * @returns {PickOption}
 */
function optionOf(option, hints = {}) {
  const value = String((typeof option === "object" ? option?.value : option) ?? "").trim();
  return {
    value,
    label: String(option?.label ?? value),
    localize: false,
    hint: String(option?.hint ?? hints?.[value] ?? ""),
    cost: Math.max(Math.trunc(Number(option?.cost)) || 1, 1)
  };
}

/* -------------------------------------------- */

/**
 * The picks a skill has its unit make: those it declares, or those its effects imply.
 * @param {{effects?: object[], picks?: object[], automate?: boolean}} skill
 * @returns {Pick[]}      None for a skill the table runs by hand
 */
export function picksOf(skill) {
  if ( !skill || (skill.automate === false) ) return [];
  const variants = variantsOf(skill.effects);
  const declared = Array.isArray(skill.picks) ? skill.picks.filter((pick) => pick && (typeof pick === "object")) : [];
  if ( declared.length ) {
    return declared.map((pick, index) => {
      const from = PICK_LISTS.includes(pick.from) ? pick.from : "";
      const listed = Array.isArray(pick.options) ? pick.options : (from ? null : variants);
      return {
        id: String(pick.id ?? `pick${index + 1}`),
        label: String(pick.label ?? ""),
        from,
        count: Math.max(Math.trunc(Number(pick.count)) || 1, 1),
        points: Math.max(Math.trunc(Number(pick.points)) || 0, 0),
        options: listed ? listed.map((option) => optionOf(option, pick.hints)).filter((option) => option.value) : null
      };
    });
  }
  if ( variants.length ) return [{ id: "variant", label: "", from: "", count: 1, points: 0, options: variants.map((value) => optionOf(value)) }];
  const growths = (skill.effects ?? []).reduce((most, effect) => Math.max(most, Number(effect?.growths?.pick) || 0), 0);
  if ( growths ) return [{ id: "growths", label: "", from: "growths", count: growths, points: 0, options: null }];
  return [];
}

/* -------------------------------------------- */

/**
 * What a pick offers a unit.
 * @param {Pick} pick
 * @param {PickUnit} [unit]
 * @returns {PickOption[]}
 */
export function optionsOf(pick, unit = {}) {
  if ( pick.options ) return pick.options;
  const from = (keys, labels, upper = false) => (keys ?? []).map((key) => ({
    value: upper ? key.toUpperCase() : key,
    label: labels?.[key] ?? key,
    localize: !!labels?.[key],
    hint: "",
    cost: 1
  }));
  switch ( pick.from ) {
    case "stats": return from(unit.stats ?? Object.keys(FEO.stats), Object.fromEntries(Object.entries(FEO.stats).map(([key, stat]) => [key, stat.abbr])), true);
    case "growths": return from(unit.growths ?? Object.keys(FEO.growths), FEO.growths, true);
    case "proficiencies":
    case "start": return from(unit.proficiencies ?? Object.keys(FEO.proficiencies), FEO.proficiencies);
    default: return [];
  }
}

/* -------------------------------------------- */

/**
 * What a skill's choice says is picked, pick by pick, as it is written.
 * @param {string} [choice]
 * @param {number} [picks]      How many picks the skill has
 * @returns {string[][]}
 */
export function readChoice(choice, picks = 1) {
  const text = String(choice ?? "");
  const values = (part) => part.split(/[,;/+]/).map((value) => value.trim()).filter(Boolean);
  if ( picks <= 1 ) return [values(text)];
  const parts = text.split(";");
  return Array.from({ length: picks }, (unused, index) => values(parts[index] ?? ""));
}

/* -------------------------------------------- */

/**
 * Write what is picked as a skill's choice.
 * @param {string[][]} picked     What is picked, pick by pick
 * @returns {string}
 */
export function writeChoice(picked) {
  const parts = (picked ?? []).map((values) => [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))].join(", "));
  if ( parts.length <= 1 ) return parts[0] ?? "";
  return parts.some(Boolean) ? parts.join("; ") : "";
}

/* -------------------------------------------- */

/**
 * Everything picked on a skill, whatever pick it belongs to: what an effect marked with a `choice` is held
 * against.
 * @param {{choice?: string}} skill
 * @returns {string[]}
 */
export function chosenOf(skill) {
  const text = String(skill?.choice ?? "").trim();
  if ( !text ) return [];
  return [...new Set([text, ...text.split(/[,;]/).map((value) => value.trim()).filter(Boolean)])];
}

/* -------------------------------------------- */

/**
 * The picks of a skill as they stand.
 * @param {{effects?: object[], picks?: object[], choice?: string, automate?: boolean}} skill
 * @param {PickUnit} [unit]
 * @returns {PickState[]}
 */
export function pickStates(skill, unit = {}) {
  const picks = picksOf(skill);
  const written = readChoice(skill?.choice, picks.length);
  return picks.map((pick, index) => {
    const options = optionsOf(pick, unit);
    const find = (value) => options.find((option) => option.value.toLowerCase() === value.toLowerCase());

    // The proficiency a unit started with is the Creator's to say, where it made the unit
    if ( (pick.from === "start") && (unit.start || unit.creating) ) {
      return { pick, options, picked: unit.start ? [unit.start] : [], spent: 0, given: true, open: false };
    }
    let picked = [...new Set(written[index].map((value) => find(value)?.value).filter(Boolean))];
    let spent = 0;
    if ( pick.points ) {
      const kept = [];
      for ( const value of picked ) {
        const cost = find(value).cost;
        if ( spent + cost > pick.points ) continue;
        kept.push(value);
        spent += cost;
      }
      picked = kept;
      const cheapest = options.filter((option) => !picked.includes(option.value)).reduce((least, option) => Math.min(least, option.cost), Infinity);
      return { pick, options, picked, spent, given: false, open: (pick.points - spent) >= cheapest };
    }
    picked = picked.slice(0, pick.count);
    return { pick, options, picked, spent: picked.length, given: false, open: picked.length < Math.min(pick.count, options.length) };
  });
}

/* -------------------------------------------- */

/**
 * Is something still to be picked on a skill?
 * @param {object} skill
 * @param {PickUnit} [unit]
 * @returns {boolean}
 */
export function picksOpen(skill, unit = {}) {
  return pickStates(skill, unit).some((state) => state.open);
}

/* -------------------------------------------- */

/**
 * What one pick of a skill holds, by its id: the first pick when none is named.
 * @param {object} skill
 * @param {string} [id]
 * @param {PickUnit} [unit]
 * @returns {string[]}
 */
export function pickedOf(skill, id = "", unit = {}) {
  const states = pickStates(skill, unit);
  return (id ? states.find((state) => state.pick.id === id) : states[0])?.picked ?? [];
}

/* -------------------------------------------- */
/*  Picking                                     */
/* -------------------------------------------- */

/**
 * Plan a pick: take an option, or give one up. Where one is picked the new one takes its place; where several
 * are, the one picked longest ago makes room; where points are spent, an option that costs too much is refused.
 * @param {object} skill
 * @param {number} index          Which of the skill's picks
 * @param {string} value          The option to take or give up
 * @param {PickUnit} [unit]
 * @returns {string|null}         The skill's choice, or null when nothing changes
 */
export function planPick(skill, index, value, unit = {}) {
  const states = pickStates(skill, unit);
  const state = states[index];
  const option = state?.options.find((entry) => entry.value.toLowerCase() === String(value ?? "").toLowerCase());
  if ( !option || state.given ) return null;
  let next;
  if ( state.picked.includes(option.value) ) {
    if ( (state.pick.count === 1) && !state.pick.points ) return null;
    next = state.picked.filter((entry) => entry !== option.value);
  }
  else if ( state.pick.points ) {
    if ( state.spent + option.cost > state.pick.points ) return null;
    next = [...state.picked, option.value];
  }
  else {
    next = [...state.picked, option.value];
    while ( next.length > state.pick.count ) next.shift();
  }
  const choice = writeChoice(states.map((entry, at) => (at === index ? next : (entry.given ? [] : entry.picked))));
  return (choice === String(skill.choice ?? "")) ? null : choice;
}

/* -------------------------------------------- */

/**
 * Are a skill's picks locked for someone? Once every pick is made they are, for all but the Game Master, and
 * not while the unit is still being made in the Character Creator. A skill with nothing to pick is not locked.
 * @param {object} skill
 * @param {object} [who]
 * @param {boolean} [who.gm]          Is it the Game Master who asks?
 * @param {boolean} [who.creating]    Is the unit being made in the Character Creator?
 * @param {PickUnit} [unit]
 * @returns {boolean}
 */
export function picksLocked(skill, { gm = false, creating = false } = {}, unit = {}) {
  if ( gm || creating ) return false;
  const states = pickStates(skill, unit).filter((state) => !state.given);
  return (states.length > 0) && states.every((state) => !state.open);
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check the picks a skill declares, so that a typing mistake does not pass silently.
 * @param {object[]} [picks]
 * @param {object[]} [effects]      The skill's effects, whose variants a pick may offer
 * @returns {string[]}              What is wrong, in plain words; empty when nothing is
 */
export function checkPicks(picks, effects = []) {
  if ( picks === undefined ) return [];
  if ( !Array.isArray(picks) || !picks.length ) return ['"picks" is a list of what the unit picks, and is left out when it picks nothing'];
  const problems = [];
  const parts = ["id", "label", "options", "hints", "from", "count", "points"];
  const variants = variantsOf(effects);
  const ids = new Set();
  const taken = new Set();
  picks.forEach((pick, index) => {
    const at = `pick ${index + 1}`;
    if ( !pick || (typeof pick !== "object") ) return problems.push(`${at}: must say what is picked`);
    for ( const key of Object.keys(pick) ) if ( !parts.includes(key) ) problems.push(`${at}: unknown part "${key}"`);
    if ( !pick.id || (typeof pick.id !== "string") ) problems.push(`${at}: needs an "id"`);
    else if ( ids.has(pick.id) ) problems.push(`${at}: the id "${pick.id}" is used twice`);
    ids.add(pick.id);
    if ( (pick.from !== undefined) && !PICK_LISTS.includes(pick.from) ) problems.push(`${at}: picks "from" ${PICK_LISTS.map((list) => `"${list}"`).join(", ")}, not "${pick.from}"`);
    if ( (pick.from !== undefined) && (pick.options !== undefined) ) problems.push(`${at}: has "options" or a list to pick "from", not both`);
    for ( const key of ["count", "points"] ) {
      if ( (pick[key] !== undefined) && !(Number.isInteger(pick[key]) && (pick[key] >= 1)) ) problems.push(`${at}: "${key}" is a whole number from 1`);
    }
    if ( (pick.count !== undefined) && (pick.points !== undefined) ) problems.push(`${at}: picks a "count" or spends "points", not both`);
    const options = (pick.options ?? (pick.from ? [] : variants)).map((option) => optionOf(option, pick.hints));
    if ( (pick.options !== undefined) && (!Array.isArray(pick.options) || !pick.options.length) ) problems.push(`${at}: "options" lists what can be picked`);
    if ( (pick.options === undefined) && (pick.from === undefined) && !variants.length ) problems.push(`${at}: needs "options", a list to pick "from", or effects with a "choice"`);
    for ( const option of options ) {
      if ( !option.value ) problems.push(`${at}: an option has no value`);
      else if ( /[,;]/.test(option.value) ) problems.push(`${at}: the option "${option.value}" cannot have a comma or a semicolon`);
      else if ( taken.has(option.value.toLowerCase()) ) problems.push(`${at}: the option "${option.value}" is offered twice`);
      taken.add(option.value.toLowerCase());
    }
    for ( const key of Object.keys(pick.hints ?? {}) ) {
      if ( !options.some((option) => option.value === key) ) problems.push(`${at}: a hint is for "${key}", which is not an option`);
    }
    return null;
  });

  // A variant no pick offers could never be chosen
  const offered = picks.flatMap((pick) => (pick?.options ?? (pick?.from ? [] : variants)).map((option) => optionOf(option).value));
  const listed = picks.some((pick) => pick?.from);
  for ( const variant of variants ) {
    if ( !listed && !offered.includes(variant) ) problems.push(`the variant "${variant}" of its effects is not among what is picked`);
  }
  return problems;
}

/**
 * Refresh: a unit sings or dances for an ally that has acted, and that ally may move and act again this turn.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * Refresh is a command of the unit that has the skill. It is the unit's Action. Whom it may be used on:
 *
 *   an ally, in the fight and standing, within its reach (next to the unit, unless a skill says otherwise),
 *   that has taken its Action this Phase, that has no Refresh of its own, and that no skill keeps from being
 *   given its Action back (`rules: ["noRefresh"]`, see `acting.mjs`).
 *
 * A skill gives the command, and reshapes it, with a `refresh` part, which like `carry` is always there: never
 * at a moment or as an aura, though it may hang on what its skill's unit picked as it learnt the skill, on its
 * skill being switched on, and on the unit itself (its form, its class tier):
 *
 *   refresh: { use: true }                        // its unit has the command
 *   refresh: { range: { max: 2 } }                // how far it reaches; `min: 1` is understood
 *   refresh: { range: { max: 3, without: ["Inspiring Song"] } }
 *                                                 // it reaches that far too, but what those skills would lay
 *                                                 // over it is left out for an ally only this range reaches
 *   refresh: { targets: 2 }                       // how many allies it is used on at once; "all" for every
 *                                                 // ally in reach
 *   refresh: { gives: { effects: [{ stats: { str: 3 } }], ends: "turnStart" } }
 *                                                 // a change that lasts on each ally it is used on (see
 *                                                 // `timed.mjs`); `hp: 10` for temporary HP, `at: { max: 1 }`
 *                                                 // only for an ally that near (also `min`), `turns`
 *   refresh: { curses: { within: 4, effects: [{ stats: { str: -3 } }], ends: "turnEnd" } }
 *                                                 // a change that lasts on the enemy nearest to the unit,
 *                                                 // within so many spaces
 *   refresh: { option: { id: "heal", label: "Heal", instead: true, heal: { of: "mag" } } }
 *                                                 // another way to use it, picked each time it is used. With
 *                                                 // `instead` the ally is not given its Action back, and what
 *                                                 // the option does is all that is done to it: `heal` (HP),
 *                                                 // `cure: "all"` (or a list of conditions), `gauge: "turn"`
 *                                                 // (its Shift Gauge fills as in a turn in humanoid form), and
 *                                                 // `gives`, one change or several. Without `instead` its
 *                                                 // `gives` come on top of the Action given back. `alone: true`
 *                                                 // leaves out what other skills lay over the Refresh, and
 *                                                 // `cooldown: 3` puts its skill on cooldown for so many turns
 *                                                 // and keeps the option away until that is over
 *   refresh: { self: true }                       // when a skill of its unit Refreshes the allies around it,
 *                                                 // the unit is Refreshed too: for an Action or for a move
 *
 * A number may be read from the unit that sings, as everywhere: `heal: { of: "mag" }`; inside the effects of a
 * change it is marked `giver: true`, as in every lasting change.
 *
 * A skill can also hand out a Refresh as something else is done, with a `refreshes` part at a moment: its unit
 * defeating a foe ("kill"), the end of a fight it started ("after"), or its unit using a staff ("staff"). What
 * its unit's skills lay over a Refresh comes with it:
 *
 *   { proc: { on: "kill", sure: true }, refreshes: { to: "near", once: "turn" } }
 *                                                 // "near": every ally next to the unit, or every ally next
 *                                                 // to the foe it defeated, as its owner picks
 *   { proc: { on: "after", stat: "dex", div: 1.5 }, refreshes: { to: "self", once: "turn", times: 2 } }
 *                                                 // "self": the unit itself moves and acts again; at most
 *                                                 // `times` in a turn (once unless given)
 *   { proc: { on: "staff", sure: true, ally: true }, refreshes: { to: "target" } }
 *                                                 // "target": the ally the staff was used on
 *   { proc: { on: "staff", sure: true, foe: true }, refreshes: { to: "pick", within: "staff", may: true } }
 *                                                 // "pick": one ally within so many spaces, or within the
 *                                                 // reach of the "staff", picked on the map by its owner,
 *                                                 // who may pass
 *
 * @import {TimedChange} from "./timed.mjs"
 */
import { NO_REFRESH } from "./acting.mjs";
import { TIMED_ENDS } from "./timed.mjs";

/** What the `refresh` part of an effect can say. */
export const REFRESH_PARTS = ["use", "range", "targets", "gives", "curses", "option", "self"];

/** What each of its parts can say. */
export const RANGE_PARTS = ["min", "max", "without"];
export const GIVE_PARTS = ["effects", "ends", "turns", "hp", "at"];
export const CURSE_PARTS = ["within", "effects", "ends", "turns"];
export const OPTION_PARTS = ["id", "label", "hint", "instead", "alone", "cooldown", "heal", "cure", "gauge", "gives"];

/** What the `refreshes` part of an effect can say, whom it can be for, and the moments it can wait for. */
export const REFRESHES_PARTS = ["to", "within", "may", "once", "times"];
export const REFRESH_TARGETS = ["self", "target", "near", "pick"];
export const REFRESH_MOMENTS = ["kill", "after", "staff"];

/** What the command goes by where no skill names it. */
export const REFRESH_NAME = "Refresh";

/**
 * The rule that keeps a unit from using Refresh though it has the skill: `rules: ["noSong"]`, as on a unit
 * that only has it because it took on the shape of another.
 */
export const NO_SONG = "noSong";

/* -------------------------------------------- */
/*  What Skills Make of It                      */
/* -------------------------------------------- */

/**
 * @typedef RefreshRange
 * @property {number} min
 * @property {number} max
 * @property {string[]} without       Skills whose changes are left out for an ally only this range reaches
 * @property {string} skill           The skill that gives it; blank for the reach the command has by itself
 *
 * @typedef RefreshGive
 * A change that lasts on a unit a Refresh is used on, or on the enemy nearest to the singer.
 * @property {string} skill
 * @property {object[]} effects
 * @property {string} ends
 * @property {number} [turns]
 * @property {number} [hp]            Temporary HP
 * @property {{min?: number, max?: number}} [at]      Only for an ally this far from the singer
 * @property {number} [within]        For an enemy: how near to the singer it must be
 *
 * @typedef RefreshOption
 * Another way to use Refresh, picked each time.
 * @property {string} id
 * @property {string} skill           The skill that offers it
 * @property {string} [item]          That skill, by what tells it apart on its unit
 * @property {string} label
 * @property {string} hint
 * @property {boolean} instead        Does it take the place of giving the ally its Action back?
 * @property {boolean} alone          Is what other skills lay over the Refresh left out?
 * @property {number} cooldown        Turns its skill is on cooldown afterwards; 0 for none
 * @property {number} heal            HP the ally regains
 * @property {"all"|string[]|null} cure       Conditions the ally is cured of
 * @property {"turn"|number|null} gauge       What its Shift Gauge fills by
 * @property {RefreshGive[]} gives
 *
 * @typedef Refreshing
 * What a unit's skills make of Refresh.
 * @property {boolean} use            Does it have the command?
 * @property {string} skill           The skill that gives it
 * @property {RefreshRange[]} ranges  How far it reaches, beyond the unit's neighbours
 * @property {number} targets         How many allies it is used on at once; Infinity for all in reach
 * @property {RefreshGive[]} gives
 * @property {RefreshGive[]} curses
 * @property {RefreshOption[]} options
 * @property {boolean} self           Is the unit Refreshed too when its own skill Refreshes those around it?
 * @property {{targets: string, self: string}} skills     The skills that give it each
 */

/**
 * What Refresh comes to for a unit without a skill that speaks of it.
 * @returns {Refreshing}
 */
export function emptyRefresh() {
  return { use: false, skill: "", ranges: [], targets: 1, gives: [], curses: [], options: [], self: false, skills: { targets: "", self: "" } };
}

/* -------------------------------------------- */

const whole = (value, least = 0) => Math.max(Math.floor(Number(value) || 0), least);

/**
 * Bring a change a skill lays over a Refresh into shape.
 * @param {object} give
 * @param {string} skill
 * @returns {RefreshGive}
 */
function giveOf(give, skill) {
  const shaped = { skill, effects: Array.isArray(give?.effects) ? give.effects : [], ends: give?.ends ?? "turnStart" };
  if ( Number.isInteger(give?.turns) ) shaped.turns = give.turns;
  if ( whole(give?.hp) > 0 ) shaped.hp = whole(give.hp);
  if ( give?.at && (typeof give.at === "object") ) shaped.at = { ...give.at };
  if ( Number.isFinite(give?.within) ) shaped.within = whole(give.within, 1);
  return shaped;
}

/* -------------------------------------------- */

/**
 * Add what one skill makes of Refresh: reaches and changes add up, and of several numbers of allies the
 * highest counts. Numbers that are read from the unit must have been worked out already.
 * @param {Refreshing} total
 * @param {object} part               The `refresh` part of an effect
 * @param {object} [options]
 * @param {string} [options.skill]    The skill it comes from
 * @param {string} [options.item]     That skill, by what tells it apart on its unit
 * @returns {Refreshing}              `total`, changed
 */
export function addRefresh(total, part, { skill = "", item = "" } = {}) {
  if ( part?.use === true ) {
    total.use = true;
    total.skill ||= skill;
  }
  if ( part?.range && (typeof part.range === "object") && (whole(part.range.max) >= 1) ) {
    total.ranges.push({
      min: whole(part.range.min ?? 1, 1),
      max: whole(part.range.max, 1),
      without: Array.isArray(part.range.without) ? part.range.without.map(String) : [],
      skill
    });
  }
  const many = (part?.targets === "all") ? Infinity : whole(part?.targets);
  if ( many > total.targets ) {
    total.targets = many;
    total.skills.targets = skill;
  }
  if ( part?.gives ) for ( const give of [].concat(part.gives) ) total.gives.push(giveOf(give, skill));
  if ( part?.curses ) for ( const curse of [].concat(part.curses) ) total.curses.push(giveOf({ within: 1, ends: "turnEnd", ...curse }, skill));
  if ( part?.option && (typeof part.option === "object") && part.option.id ) {
    const option = part.option;
    total.options.push({
      id: `${skill}:${option.id}`,
      skill,
      item,
      label: String(option.label ?? option.id),
      hint: String(option.hint ?? ""),
      instead: option.instead === true,
      alone: option.alone === true,
      cooldown: whole(option.cooldown),
      heal: whole(option.heal),
      cure: (option.cure === "all") ? "all" : Array.isArray(option.cure) ? option.cure.map(String) : null,
      gauge: (option.gauge === "turn") ? "turn" : Number.isFinite(option.gauge) ? option.gauge : null,
      gives: [].concat(option.gives ?? []).map((give) => giveOf(give, skill))
    });
  }
  if ( (part?.self === true) && !total.self ) {
    total.self = true;
    total.skills.self = skill;
  }
  return total;
}

/* -------------------------------------------- */
/*  Reach                                       */
/* -------------------------------------------- */

/**
 * The reaches a unit's Refresh has: that of the command itself, the unit's neighbours, and those its skills add.
 * @param {Refreshing} refreshing
 * @returns {RefreshRange[]}
 */
export function refreshRanges(refreshing) {
  return [{ min: 1, max: 1, without: [], skill: "" }, ...(refreshing?.ranges ?? [])];
}

/* -------------------------------------------- */

/**
 * The farthest a unit's Refresh reaches.
 * @param {Refreshing} refreshing
 * @returns {number}
 */
export function farthest(refreshing) {
  return refreshRanges(refreshing).reduce((most, range) => Math.max(most, range.max), 1);
}

/* -------------------------------------------- */

/**
 * The reach by which a unit's Refresh is used on an ally so many spaces away: of those that cover the
 * distance, the one that leaves the least out.
 * @param {Refreshing} refreshing
 * @param {number} distance
 * @returns {RefreshRange|null}       Null for an ally out of reach
 */
export function rangeAt(refreshing, distance) {
  let best = null;
  for ( const range of refreshRanges(refreshing) ) {
    if ( !Number.isFinite(distance) || (distance < range.min) || (distance > range.max) ) continue;
    if ( !best || (range.without.length < best.without.length) ) best = range;
  }
  return best;
}

/* -------------------------------------------- */
/*  Who Is Refreshed                            */
/* -------------------------------------------- */

/**
 * @typedef RefreshCheck
 * @property {boolean} ok
 * @property {"self"|"side"|"out"|"apart"|"singer"|"barred"|"ready"|"phase"|"full"|"well"|"gauge"|null} why
 *                                            Why not, when it may not
 * @property {RefreshRange|null} [range]      The reach it is used by
 */

/**
 * May a unit's Refresh be used on another?
 * @param {Refreshing} refreshing             What the unit's skills make of Refresh
 * @param {object} target                     The unit it would be used on
 * @param {"friend"|"foe"|"apart"|"self"} target.relation     How the unit stands to it
 * @param {number} target.distance            The spaces between the two
 * @param {boolean} [target.out]              Is it out of the fight, or down?
 * @param {"ready"|"moving"|"acted"|"waiting"|"free"|"down"} [target.state]   Where it stands in the turn order
 * @param {boolean} [target.sings]            Has it the Refresh command itself?
 * @param {Iterable<string>|null} [target.rules]      The rules its skills give it
 * @param {boolean} [target.hurt]             Is it below its maximum HP?
 * @param {boolean} [target.afflicted]        Does it suffer from a condition?
 * @param {boolean} [target.gauge]            Has it a Shift Gauge?
 * @param {object} [options]
 * @param {RefreshOption|null} [options.option]       The way it is used, other than the regular one. One that
 *                                            is used instead of giving the Action back is for any ally in
 *                                            reach that it does something for
 * @param {boolean} [options.near]            Must it be within the reach of the command? Not where a skill
 *                                            hands the Refresh out as something else is done
 * @returns {RefreshCheck}
 */
export function canRefresh(refreshing, target, { option = null, near = true } = {}) {
  const no = (why) => ({ ok: false, why, range: null });
  if ( target?.relation === "self" ) return no("self");
  if ( target?.relation !== "friend" ) return no("side");
  if ( target.out || (target.state === "down") ) return no("out");
  const range = near ? rangeAt(refreshing, target.distance) : null;
  if ( near && !range ) return no("apart");
  if ( option?.instead ) {
    // Something it does must be of use to the ally: a change always is
    const idle = [];
    if ( (option.heal > 0) && (target.hurt === false) ) idle.push("full");
    if ( option.cure && (target.afflicted === false) ) idle.push("well");
    if ( (option.gauge !== null) && (option.gauge !== undefined) && (target.gauge === false) ) idle.push("gauge");
    const does = ((option.heal > 0) ? 1 : 0) + (option.cure ? 1 : 0) + (((option.gauge !== null) && (option.gauge !== undefined)) ? 1 : 0) + ((option.gives ?? []).length ? 1 : 0);
    if ( idle.length && (idle.length >= does) ) return no(idle[0]);
    return { ok: true, why: null, range };
  }
  if ( target.sings ) return no("singer");
  if ( Array.from(target.rules ?? []).includes(NO_REFRESH) ) return no("barred");
  if ( (target.state !== "acted") && (target.state !== "moving") ) return no((target.state === "ready") ? "ready" : "phase");
  return { ok: true, why: null, range };
}

/* -------------------------------------------- */
/*  What Is Laid Over It                        */
/* -------------------------------------------- */

/**
 * Put the changes of one skill that end alike together, so that each is one change on the unit that carries it.
 * @param {RefreshGive[]} parts
 * @returns {(RefreshGive & {name: string})[]}
 */
function gathered(parts) {
  const groups = [];
  for ( const part of parts ) {
    const found = groups.find((group) => (group.skill === part.skill) && (group.ends === part.ends) && ((group.turns ?? 1) === (part.turns ?? 1)));
    if ( found ) {
      found.effects.push(...part.effects);
      if ( part.hp ) found.hp = (found.hp ?? 0) + part.hp;
      continue;
    }
    const group = { skill: part.skill, effects: [...part.effects], ends: part.ends };
    if ( part.turns ) group.turns = part.turns;
    if ( part.hp ) group.hp = part.hp;
    if ( part.within ) group.within = part.within;
    groups.push(group);
  }

  // A skill that lays several changes over one Refresh has them told apart by a number
  const count = new Map();
  return groups.map((group) => {
    const nth = (count.get(group.skill) ?? 0) + 1;
    count.set(group.skill, nth);
    return { ...group, name: (nth > 1) ? `${group.skill} ${nth}` : group.skill };
  });
}

/* -------------------------------------------- */

/**
 * The changes a unit's Refresh lays over an ally it is used on: what its skills give, less what the reach it
 * is used by leaves out, and what the way it is used adds or leaves out.
 * @param {Refreshing} refreshing
 * @param {object} [use]
 * @param {number} [use.distance]             The spaces between the two
 * @param {RefreshRange|null} [use.range]     The reach it is used by
 * @param {RefreshOption|null} [use.option]   The way it is used, other than the regular one
 * @returns {(RefreshGive & {name: string})[]}        Each to be granted as a lasting change of that name
 */
export function songsFor(refreshing, { distance = 1, range = null, option = null } = {}) {
  const at = (span) => !span || ((distance >= (span.min ?? 1)) && (distance <= (span.max ?? Infinity)));
  const left = range?.without ?? [];
  const parts = [];
  if ( !option?.alone ) parts.push(...(refreshing?.gives ?? []).filter((give) => !left.includes(give.skill) && at(give.at)));
  parts.push(...(option?.gives ?? []).filter((give) => at(give.at)));
  return gathered(parts).filter((give) => give.effects.length || give.hp);
}

/* -------------------------------------------- */

/**
 * The changes a unit's Refresh puts on the enemy nearest to it: one for each skill, with how near that enemy
 * must be.
 * @param {Refreshing} refreshing
 * @param {RefreshOption|null} [option]       The way it is used, other than the regular one
 * @returns {(RefreshGive & {name: string, within: number})[]}
 */
export function cursesFor(refreshing, option = null) {
  if ( option?.alone ) return [];
  return gathered(refreshing?.curses ?? []).filter((curse) => curse.effects.length);
}

/* -------------------------------------------- */

/**
 * The enemies nearest to a unit, within so many spaces: those that stand equally near, of which one is picked.
 * @param {{id: string, distance: number}[]} foes     The unit's enemies on the map
 * @param {number} within
 * @returns {{id: string, distance: number}[]}
 */
export function nearest(foes, within) {
  const near = (foes ?? []).filter((foe) => Number.isFinite(foe?.distance) && (foe.distance >= 1) && (foe.distance <= within));
  const least = near.reduce((best, foe) => Math.min(best, foe.distance), Infinity);
  return near.filter((foe) => foe.distance === least);
}

/* -------------------------------------------- */

/**
 * The ways a unit may use its Refresh now: the regular one, and those its skills offer that are not waiting
 * for a cooldown to run out.
 * @param {Refreshing} refreshing
 * @param {(option: RefreshOption) => boolean} [ready]    Says whether the skill of an option can be used now
 * @returns {RefreshOption[]}         Without the regular way, which is always open
 */
export function optionsOf(refreshing, ready = () => true) {
  return (refreshing?.options ?? []).filter((option) => !option.cooldown || ready(option));
}

/* -------------------------------------------- */
/*  Handed Out by Other Things                  */
/* -------------------------------------------- */

/**
 * Has a skill that hands out a Refresh done so as often as it may this turn?
 * @param {string} skill
 * @param {object} part                           The `refreshes` part of its effect
 * @param {Record<string, number>} [used]         How often each skill has, this turn
 * @returns {boolean}
 */
export function refreshSpent(skill, part, used = {}) {
  if ( part?.once !== "turn" ) return false;
  return (used?.[skill] ?? 0) >= Math.max(part.times ?? 1, 1);
}

/* -------------------------------------------- */

/**
 * Which of two groups of allies a skill Refreshes, where it is for the allies next to its unit or for those
 * next to the foe it defeated: the only one with anybody in it, either where they are the same, and otherwise
 * its owner's pick.
 * @param {string[]} mine         The allies next to the unit that can be Refreshed
 * @param {string[]} theirs       Those next to the foe
 * @returns {{group: "self"|"foe"|null, ask: boolean}}
 */
export function nearGroup(mine = [], theirs = []) {
  if ( !mine.length && !theirs.length ) return { group: null, ask: false };
  if ( !theirs.length ) return { group: "self", ask: false };
  if ( !mine.length ) return { group: "foe", ask: false };
  const same = (mine.length === theirs.length) && mine.every((id) => theirs.includes(id));
  return same ? { group: "self", ask: false } : { group: null, ask: true };
}

/* -------------------------------------------- */

/**
 * The group a click on an ally stands for, where two are offered: the one that ally is in, and for an ally in
 * both, the larger.
 * @param {string} id
 * @param {string[]} mine
 * @param {string[]} theirs
 * @returns {"self"|"foe"|null}
 */
export function groupOf(id, mine = [], theirs = []) {
  const here = mine.includes(id);
  const there = theirs.includes(id);
  if ( here && there ) return (theirs.length > mine.length) ? "foe" : "self";
  return here ? "self" : there ? "foe" : null;
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

const isObject = (value) => !!value && (typeof value === "object") && !Array.isArray(value);
const isNumber = (value) => Number.isFinite(value) || (isObject(value) && (value.of !== undefined));

/**
 * Check a change a skill lays over a Refresh.
 * @param {any} give
 * @param {string} what       What it is, in plain words
 * @param {string[]} parts    What it can say
 * @returns {string[]}
 */
function checkGive(give, what, parts) {
  if ( !isObject(give) ) return [`${what} says what it does and when it ends`];
  const problems = [];
  for ( const key of Object.keys(give) ) if ( !parts.includes(key) ) problems.push(`${what} cannot say "${key}"`);
  const effects = give.effects;
  if ( (effects !== undefined) && !Array.isArray(effects) ) problems.push(`${what}: "effects" is a list`);
  if ( !(Array.isArray(effects) && effects.length) && (give.hp === undefined) ) problems.push(`${what} needs effects, or temporary HP`);
  if ( !TIMED_ENDS.includes(give.ends) ) problems.push(`${what} ends at ${TIMED_ENDS.map((end) => `"${end}"`).join(", ")}, not "${give.ends}"`);
  if ( (give.turns !== undefined) && !(Number.isInteger(give.turns) && (give.turns >= 1)) ) problems.push(`${what} lasts a whole number of turns`);
  if ( (give.hp !== undefined) && !isNumber(give.hp) ) problems.push(`${what}: temporary HP are a number`);
  if ( give.at !== undefined ) {
    if ( !isObject(give.at) || !Object.keys(give.at).length ) problems.push(`${what}: "at" names the spaces between the two, "min" and "max"`);
    else for ( const [key, value] of Object.entries(give.at) ) {
      if ( !["min", "max"].includes(key) || !(Number.isInteger(value) && (value >= 1)) ) problems.push(`${what}: "at" names whole spaces, "min" and "max"`);
    }
  }
  if ( (give.within !== undefined) && !(Number.isInteger(give.within) && (give.within >= 1)) ) problems.push(`${what}: "within" is a whole number of spaces`);
  return problems;
}

/* -------------------------------------------- */

/**
 * Check how a skill says it reshapes Refresh, so that a typing mistake does not pass silently. The effects of
 * the changes it lays over a Refresh are checked with all others (see `checkEffects`).
 * @param {any} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkRefresh(part) {
  if ( !isObject(part) || !Object.keys(part).length ) return ["refresh must say what the skill makes of Refresh"];
  const problems = [];
  for ( const key of Object.keys(part) ) if ( !REFRESH_PARTS.includes(key) ) problems.push(`refresh cannot say "${key}"`);
  for ( const key of ["use", "self"] ) {
    if ( (part[key] !== undefined) && (part[key] !== true) ) problems.push(`the "${key}" of refresh is true, not "${part[key]}"`);
  }
  if ( part.range !== undefined ) {
    const range = part.range;
    if ( !isObject(range) ) problems.push("the range of a Refresh says how far it reaches: \"max\"");
    else {
      for ( const key of Object.keys(range) ) if ( !RANGE_PARTS.includes(key) ) problems.push(`the range of a Refresh cannot say "${key}"`);
      if ( !isNumber(range.max) || (Number.isFinite(range.max) && !(Number.isInteger(range.max) && (range.max >= 1))) ) {
        problems.push("the range of a Refresh reaches a whole number of spaces: \"max\"");
      }
      if ( (range.min !== undefined) && !(Number.isInteger(range.min) && (range.min >= 1)) ) problems.push("the range of a Refresh starts at a whole number of spaces");
      if ( (range.without !== undefined) && !(Array.isArray(range.without) && range.without.length && range.without.every((name) => (typeof name === "string") && name)) ) {
        problems.push("the range of a Refresh lists the skills it is \"without\" by name");
      }
    }
  }
  if ( (part.targets !== undefined) && (part.targets !== "all") && !(Number.isInteger(part.targets) && (part.targets >= 2)) ) {
    problems.push("a Refresh is used on a whole number of allies, 2 or more, or on \"all\"");
  }
  for ( const give of [].concat(part.gives ?? []) ) problems.push(...checkGive(give, "what a Refresh gives", GIVE_PARTS));
  for ( const curse of [].concat(part.curses ?? []) ) {
    problems.push(...checkGive(curse, "what a Refresh does to an enemy", CURSE_PARTS));
    if ( isObject(curse) && (curse.within === undefined) ) problems.push("what a Refresh does to an enemy says how near that enemy must be: \"within\"");
  }
  if ( part.option !== undefined ) {
    const option = part.option;
    if ( !isObject(option) ) problems.push("an option of Refresh says what it is: \"id\"");
    else {
      for ( const key of Object.keys(option) ) if ( !OPTION_PARTS.includes(key) ) problems.push(`an option of Refresh cannot say "${key}"`);
      if ( (typeof option.id !== "string") || !option.id ) problems.push("an option of Refresh has an \"id\"");
      for ( const key of ["label", "hint"] ) if ( (option[key] !== undefined) && (typeof option[key] !== "string") ) problems.push(`the "${key}" of an option is text`);
      for ( const key of ["instead", "alone"] ) {
        if ( (option[key] !== undefined) && (option[key] !== true) ) problems.push(`the "${key}" of an option is true, not "${option[key]}"`);
      }
      if ( (option.cooldown !== undefined) && !(Number.isInteger(option.cooldown) && (option.cooldown >= 1)) ) problems.push("the cooldown of an option is a whole number of turns");
      if ( (option.heal !== undefined) && !isNumber(option.heal) ) problems.push("the HP an option restores are a number");
      if ( (option.cure !== undefined) && (option.cure !== "all") && !(Array.isArray(option.cure) && option.cure.length) ) problems.push("an option cures \"all\" conditions, or a list of them");
      if ( (option.gauge !== undefined) && (option.gauge !== "turn") && !Number.isFinite(option.gauge) ) problems.push("an option fills the Shift Gauge as a \"turn\" does, or by a number");
      for ( const give of [].concat(option.gives ?? []) ) problems.push(...checkGive(give, "what an option gives", GIVE_PARTS));
      const does = ["heal", "cure", "gauge", "gives"].some((key) => option[key] !== undefined);
      if ( !does ) problems.push("an option of Refresh does something: \"heal\", \"cure\", \"gauge\" or \"gives\"");
      for ( const key of ["heal", "cure", "gauge"] ) {
        if ( (option[key] !== undefined) && (option.instead !== true) ) problems.push(`an option that has "${key}" is used "instead" of the Action given back`);
      }
    }
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * Check the `refreshes` part of a skill effect and the moment it waits for.
 * @param {any} part
 * @param {object|null} [proc]      The moment the effect waits for
 * @returns {string[]}              What is wrong, in plain words; empty when nothing is
 */
export function checkRefreshes(part, proc = null) {
  if ( !isObject(part) ) return ["refreshes must say whom the skill Refreshes: \"to\""];
  const problems = [];
  for ( const key of Object.keys(part) ) if ( !REFRESHES_PARTS.includes(key) ) problems.push(`refreshes cannot say "${key}"`);
  if ( !REFRESH_TARGETS.includes(part.to) ) problems.push(`refreshes is for ${REFRESH_TARGETS.map((to) => `"${to}"`).join(", ")}, not "${part.to}"`);
  const on = proc?.on;
  if ( !REFRESH_MOMENTS.includes(on) ) problems.push(`refreshes: a Refresh is handed out on ${REFRESH_MOMENTS.map((moment) => `"${moment}"`).join(", ")}`);
  if ( ["target", "pick"].includes(part.to) && (on !== "staff") ) problems.push(`refreshes: "${part.to}" is for the moment a "staff" is used`);
  if ( (part.to === "near") && (on !== "kill") ) problems.push("refreshes: \"near\" is for the moment a foe is defeated, \"kill\"");
  if ( (part.to === "self") && (on === "staff") ) problems.push("refreshes: \"self\" is for a moment of a fight");
  if ( part.within !== undefined ) {
    if ( part.to !== "pick" ) problems.push("refreshes: only a \"pick\" says how near the ally must be");
    else if ( (part.within !== "staff") && !(Number.isInteger(part.within) && (part.within >= 1)) ) problems.push("refreshes: \"within\" is a whole number of spaces, or \"staff\"");
  }
  else if ( part.to === "pick" ) problems.push("refreshes: a \"pick\" says how near the ally must be, \"within\"");
  if ( (part.may !== undefined) && ((part.may !== true) || (part.to !== "pick")) ) problems.push("refreshes: \"may\" is true, and only for a \"pick\"");
  if ( (part.once !== undefined) && (part.once !== "turn") ) problems.push(`refreshes: once a "turn", not "${part.once}"`);
  if ( part.times !== undefined ) {
    if ( part.once !== "turn" ) problems.push("refreshes: \"times\" counts what is limited to once a \"turn\"");
    if ( !(Number.isInteger(part.times) && (part.times >= 1)) ) problems.push("refreshes: \"times\" is a whole number");
  }
  return problems;
}

/**
 * Skills used as an action on a unit picked on the map: who may be picked, what the skill then does, and the
 * opposed Ability check some of them ask for first. Pure functions of plain data, so that they can be tested
 * outside of Foundry.
 *
 * A skill used as an action (`usage.kind: "action"`, see `skill-usage.mjs`) says what it does to its target
 * with an `act` part, which stands alone in an effect and is always there:
 *
 *   act: {
 *     target: { who: "ally", within: 5,      // whom it may be used on: an "ally", an "enemy" or "any" unit at
 *               from: 1,                     // most `within` tiles away (1 unless given) and at least `from`;
 *               clear: true },               // `clear`: only where a straight line between the two crosses no
 *                                            // tile that nothing passes, and no wall. `within: "weapon"`: a
 *                                            // unit the weapon in its hand could attack from where it stands
 *     move: "swap",                          // the two trade places; "maneuver": they trade places, the unit
 *                                            // moves to a tile next to the target, or the target is set down
 *                                            // on a tile next to the unit, as the tile picked next says
 *     check: { by: "athletics", against: ["reflex", "athletics"] },
 *                                            // an opposed Ability check first: the unit's against the best of
 *                                            // the target's. On a failure the skill is used and does nothing
 *     grip: true,                            // the unit takes hold of the target (see below)
 *     wears: { shield: { of: "attack", per: 10 } },
 *                                            // uses the target's Shield loses, or its `weapon`: a number, or
 *                                            // one read from the unit that uses the skill. What is brought to
 *                                            // 0 uses breaks
 *     grant: { effects: [{ rules: ["noShield"] }], ends: "turnEnd", turns: 2 },
 *                                            // a change that lasts on the target (see `timed.mjs`)
 *     fight: { rounds: 5 }                   // the unit starts a fight with the target that goes on for so
 *                                            // many rounds, or with "fall" until a unit falls (see
 *                                            // `rounds.mjs`): only against a target that can counter-attack.
 *                                            // The map shows the forecast of that fight, and it is the
 *                                            // unit's attack for the turn
 *   }
 *
 * A target may also be anywhere on the map (`within: "map"`), and the unit itself may be among those picked
 * (`self: true`). What else a skill does to the unit it is used on:
 *
 *   heal: 5                                  // HP it restores: only a unit that has lost some is offered
 *   damage: { of: "hpMax", div: 10, theirs: true }     // damage it deals, as a skill's damage is dealt: a
 *                                            // number, one read from its unit, or with `theirs` from the target
 *   grant: {                                 // the change it leaves may say more than above:
 *     choose: { stats: ["str", "mag"], amount: -6 },   // a stat picked as the skill is used, by whoever acts
 *                                            // for its unit, or with `asks: "target"` beside the grant by
 *                                            // whoever acts for the target; `stats: "learnt"` for the stat
 *                                            // that was picked as the skill was learnt (its `choice`)
 *     clock: "giver",                        // it lasts by the turns of the unit that used the skill
 *     lone: true,                            // one unit carries it at a time: used on another, the first loses it
 *     also: "self",                          // the unit that uses the skill carries the same change
 *     by: true,                              // it remembers the unit it comes from (see `provokes` below)
 *     mark: true, once: "fight",             // as any lasting change (see `timed.mjs`)
 *     toll: { move: 1, attack: { dice: 4 } },          // HP its unit loses each time it moves, and after each
 *                                            // fight in which it attacked: a number, or a die of so many faces
 *     lends: [{ pick: "wields", effects: [{ when: { weapon: "$" }, combat: { hit: 20 } }] }]
 *                                            // effects for a kind of weapon that a die picks as the skill is
 *                                            // used: among those the target has a rank with ("wields"), or
 *                                            // those its enemies on the map hold ("foes"); a tome stands
 *                                            // for its whole Magic type (`weaponTypeOf` in `skills.mjs`). `"$"` stands for
 *                                            // the kind picked. `manual: "B"` beside it lets whoever acts for
 *                                            // the unit pick a proficiency it has that rank in instead
 *   }
 *   all: { grant: { ... } }                  // in place of one unit, every unit in reach at once, with what
 *                                            // this says in place of the above: picked from a short list
 *   assures: true                            // a die picks one of the target's skills that roll a chance in a
 *                                            // fight: it is sure to activate in the next fight of that unit
 *   watch: { enters: { effects, ends }, stays: { effects, max } }      // beside a grant with `by`: the first
 *                                            // time its unit stands within the Line of Sight of the unit it
 *                                            // comes from it is granted `enters`, and `stays` grows by one
 *                                            // with each of its turns that starts there and is emptied by one
 *                                            // that starts outside (LoS is a stat: so many spaces)
 *   strike: {                                // one attack on the target, shown in the forecast first: it is
 *     might: 0, hit: 50, critical: 5,        // not answered, is no follow-up and strikes once. With numbers of
 *     effect: "50% to Stun",                 // its own it is made with what gives those numbers and not with
 *     stat: "str",                           // the weapon in hand (as a weapon would be written: its Effect,
 *     plain: true,                           // the stat it adds); `plain`: none of its unit's skills takes
 *     weapon: ["brawl"],                     // effect at a moment of it. `weapon`: it is made with a weapon of
 *     share: 50,                             // that kind the unit carries, at this share of its damage;
 *     effects: [{ against: "lower" }]        // `effects`: what its unit has for that attack alone
 *   }
 *
 * A skill that takes in an area of the map says so with an `area` in place of the `target` (see `areas.mjs`
 * for its shapes): every unit the area catches then gets what the skill says of one unit. Beside that:
 *
 *   area: { shape: "radius", radius: 2, who: "any", self: true },
 *   inflicts: ["rattled", { id: "burn", turns: 2 }],  // conditions each unit is given (also of one target)
 *   mark: { name: "Holy War · foe", ends: "map" },    // each carries a mark of that name from the skill's unit,
 *                                            // which shows nowhere (see `foeMarked` in `skills.mjs`)
 *   strike: { hand: true, plain: true },     // one attack on each with the weapon in its unit's hand; with
 *                                            // `only: ["bolt"]` that must be of one of these kinds, and with
 *                                            // `combat: true` one that attacks (it has a Hit of its own). A
 *                                            // `grant` beside it is left on each unit that was attacked
 *   user: { grant: { effects, ends, turns }, each: true },
 *                                            // a change its own unit carries: with `each`, so many times over
 *                                            // as units were caught, and none where none was
 *   through: true,                           // along a line: its unit moves through the units caught and onto
 *                                            // the first tile past them, where it must be able to stand
 *   shares: { gives: 2 },                    // its unit gives up HP of its own, as many as whoever acts for it
 *                                            // sets, and each restores so many HP, or points of a Shift Gauge,
 *                                            // shared out among the units caught as they are clicked
 *   trap: { costs: { weapon: ["magic"], uses: 1 }, most: 2, strike: true },
 *                                            // on a tile that is picked: a trap is laid there, which halts
 *                                            // whoever moves onto it and has its unit make one attack on that
 *                                            // unit (see `reactions.mjs`)
 *   again: { pays: { of: "hpMax", div: 4 }, grant: { effects: [{ rules: ["onlyWait"] }], ends: "turnEnd" } }
 *                                            // as the next turn of its unit starts, whoever acts for it may have
 *                                            // the skill do its part once more without using it: its unit pays
 *                                            // that much HP, carries that change, and may do so turn after turn
 *   makes: { kind: "undead", body: "maker", share: [3, 4] }
 *                                            // on a tile that is picked: a creature appears there (see
 *                                            // `creatures.mjs`, which has all a `makes` part can say)
 *
 * A skill may have its unit imitate the unit it is used on:
 *
 *   imitates: { turns: 5, not: ["laguz"], rules: ["noSong"] }
 *                                            // its unit takes on that unit's attributes for so many turns, or
 *                                            // until it reverts at will; its cooldown starts then (see
 *                                            // `imitation.mjs`, which has all an `imitates` part can say)
 *
 * A skill may be for the creatures its unit has made alone, and may do one of two things to the one picked:
 *
 *   target: { who: "ally", within: 3,
 *             made: ["Rise", "Reanimate"],   // only a creature its unit made with one of these skills
 *             unacted: true },               // and only one that has yet to act this turn
 *   label: "Take control of it",             // what its first way is called, where it has two
 *   instead: { within: 1, label: "Have it fight in your place", grant: { ... } }
 *                                            // in place of all the above, on a target that near: the change it
 *                                            // then leaves. Where both ways are open whoever acts for its unit
 *                                            // picks one from a short list
 *
 * A skill may say what it does in more than one way, each in an effect of its own that asks something of its
 * unit (`when: { skill: "Influence" }`, `when: { tier: { min: 3 } }`): the first that holds is what it does.
 *
 * A change that carries the rule `provoked` and remembers whom it comes from has its unit make no other enemy
 * the target of an attack, a staff or a skill while that unit stands on the map (see `provokers`).
 *
 * The map offers the skill's targets when it is picked from the unit's menu: a unit the skill could do nothing
 * to is not among them. Once the target is picked, and a tile where the skill asks for one, the skill does its
 * part and is then used as any skill is: its cooldown starts, it is the unit's Action. What a later skill does
 * to its target beyond moving it is one more part here, and one more line where the parts are applied (see
 * `helpers/actions.mjs`).
 *
 * A unit that has hold of another carries who it holds. The unit held can neither move, act nor dodge, is
 * dragged along when its holder moves, tries the check again as each of its turns starts and may use its
 * Action to try it once more. It is held for as long as the two stand next to each other and its holder stands;
 * a holder may let go. All of that is read from the holder alone: the unit held receives it as an aura that
 * is only for it (see `gripEntry` and `auras.mjs`), so that nothing has to be taken off it when the hold ends.
 *
 * @import {ForcedField} from "./forced.mjs"
 * @import {Tile} from "./reach.mjs"
 */
import { FEO } from "../config.mjs";
import { checkArea } from "./areas.mjs";
import { checkTrap } from "./reactions.mjs";
import { checkMakes } from "./creatures.mjs";
import { checkImitates } from "./imitation.mjs";
import { HELD, beside, blocks, swaps } from "./forced.mjs";
import { tileKey, tilesApart } from "./reach.mjs";

/** The rule a unit that is held by another carries: it takes no Action but to try to break free, or to Wait. */
export const GRIPPED = "gripped";

/** How an action skill can move its unit and its target. */
export const ACT_MOVES = ["swap", "maneuver"];

/** What the `act` part of an effect can say, and what its `target` can. */
export const ACT_PARTS = ["target", "area", "move", "check", "grip", "wears", "grant", "fight", "heal", "damage", "all", "asks", "assures", "watch", "strike",
  "inflicts", "mark", "user", "through", "shares", "again", "trap", "makes", "instead", "label", "imitates"];

/** What an action skill does to its target, of which it needs one at least. */
const ACT_DOES = ["move", "grip", "wears", "grant", "fight", "heal", "damage", "assures", "strike", "inflicts", "mark", "user", "shares", "trap", "makes", "imitates"];

/** What only a skill that takes in an area says, and what such a skill cannot say. */
const AREA_ONLY = ["user", "through", "shares", "again", "trap", "makes"];
const AREA_BARS = ["move", "check", "grip", "wears", "fight", "all", "asks", "assures", "watch", "imitates"];

/** How far a skill reaches that is used on a unit its unit's weapon could attack. */
export const WEAPON_REACH = "weapon";

/** How far a skill reaches that is used on a unit anywhere on the map. */
export const MAP_REACH = "map";
export const TARGET_PARTS = ["who", "within", "from", "clear", "self", "made", "unacted"];

/** The stat a change has picked that was picked as its skill was learnt. */
export const LEARNT = "learnt";

/** The rule a unit carries that another has forced to target it, and the one that lets it always answer. */
export const PROVOKED = "provoked";
export const ANSWERS = "answers";

/** What stands for the kind of weapon a die picked, in the effects a skill lends. */
export const LENT = "$";

/** Where a skill that lends effects for a kind of weapon has the kind picked from. */
export const LEND_PICKS = ["wields", "foes"];

/** The stats a change a skill leaves may raise or lower by a pick. */
export const ACT_STATS = ["str", "mag", "dex", "spd", "luk", "def", "res"];

/** The moments of a skill that are no moment of a fight. */
const NO_FIGHT_MOMENTS = ["turnStart", "turnEnd", "wait", "use", "levelUp", "staff", "action"];

/**
 * What a skill does to a unit picked on the map, if it is used that way. A skill that says so in several
 * ways, each asking something of its unit, does what the first of them that holds says.
 * @param {{effects?: object[], automate?: boolean, usage?: object}|null} skill     Skill data
 * @param {((when: object) => boolean)|null} [meets]    Does the skill's unit meet what an effect asks of it?
 *                                                      Without it, the way that asks nothing is taken
 * @returns {object|null}   Its `act` part; null for a skill without one, or one the table would rather run by hand
 */
export function actOf(skill, meets = null) {
  if ( !skill || (skill.automate === false) || (skill.usage?.kind !== "action") ) return null;
  const ways = (skill.effects ?? []).filter((entry) => entry?.act && (typeof entry.act === "object"));
  const effect = ways.find((entry) => !entry.when || !!meets?.(entry.when)) ?? (meets ? null : ways[0]);
  return effect?.act ?? null;
}

/* -------------------------------------------- */

/**
 * The area a skill takes in, for one that is used on every unit in an area and not on a unit that is picked.
 * @param {object|null} act
 * @returns {object|null}
 */
export function actArea(act) {
  return (act?.area && (typeof act.area === "object")) ? act.area : null;
}

/* -------------------------------------------- */

/**
 * The conditions a skill gives a unit it is used on: each with the turns it lasts, where the skill says so.
 * @param {(string|{id: string, turns?: number})[]} [inflicts]
 * @returns {{id: string, turns?: number}[]}
 */
export function actInflicts(inflicts) {
  const list = [];
  for ( const entry of inflicts ?? [] ) {
    const id = (typeof entry === "string") ? entry : entry?.id;
    if ( !id ) continue;
    list.push(Number.isInteger(entry?.turns) ? { id, turns: entry.turns } : { id });
  }
  return list;
}

/* -------------------------------------------- */

/**
 * The change a skill that takes in an area leaves on its own unit: as it says, or so many times over as units
 * were caught.
 * @param {{grant: object, each?: boolean}|null} user
 * @param {number} caught       How many units the area caught
 * @returns {object|null}       The grant, ready to be built; null where there is none, or nobody was caught
 */
export function userGrant(user, caught) {
  if ( !user?.grant ) return null;
  if ( !user.each ) return user.grant;
  return (caught > 0) ? { ...user.grant, stacks: caught } : null;
}

/* -------------------------------------------- */

/**
 * The ways a skill may be used on the map: on "one" unit, or where it says so on "all" in reach at once.
 * @param {object|null} act
 * @returns {("one"|"all")[]}
 */
export function actModes(act) {
  if ( !act ) return [];
  return act.all ? ["one", "all"] : ["one"];
}

/* -------------------------------------------- */

/**
 * A skill as it is used on every unit in its reach at once: what it says of that, in place of what it does to
 * one unit.
 * @param {object} act
 * @returns {object}
 */
export function actForAll(act) {
  const { all, ...one } = act ?? {};
  return all ? { ...one, ...all } : one;
}

/* -------------------------------------------- */

/**
 * The stats that were picked as a skill was learnt, as its `choice` has them ("STR", "STR, SPD").
 * @param {string} [choice]
 * @param {string[]} [stats]      The stats there are
 * @returns {string[]}
 */
export function learntStats(choice, stats = Object.keys(FEO.stats)) {
  return String(choice ?? "").split(/[;,]/).map((part) => part.trim().toLowerCase()).filter((key) => stats.includes(key));
}

/* -------------------------------------------- */

/**
 * The change a skill leaves on a unit it is used on, with the stats it has picked made plain: those picked as
 * the skill was learnt, where it says so.
 * @param {object|null} grant
 * @param {object} [options]
 * @param {string} [options.choice]   What was picked as the skill was learnt
 * @returns {object|null}             Null for a skill without a change, or one whose stat was never picked
 */
export function actGrant(grant, { choice = "" } = {}) {
  if ( !grant ) return null;
  if ( !grant.choose ) return grant;
  const stats = (grant.choose.stats === LEARNT) ? learntStats(choice) : [...(grant.choose.stats ?? [])];
  return stats.length ? { ...grant, choose: { ...grant.choose, stats } } : null;
}

/* -------------------------------------------- */

/**
 * The HP a skill restores to a unit or takes off it, as a number.
 * @param {number|object|undefined} value     A number, or one read from a unit; with `theirs`, from the target
 * @param {(value: number|object, theirs: boolean) => number} read
 * @returns {number}
 */
export function actAmount(value, read) {
  if ( value === undefined ) return 0;
  const { theirs = false, ...rest } = (value && (typeof value === "object")) ? value : {};
  const amount = (typeof value === "number") ? value : read(rest, !!theirs);
  return Math.max(Math.floor(amount) || 0, 0);
}

/* -------------------------------------------- */

/**
 * What a change takes off its unit's HP as it moves or once it has attacked: a number, or a die.
 * @param {number|{dice: number}|undefined} toll
 * @param {() => number} d100       A die of a hundred faces
 * @returns {number}
 */
export function tollOf(toll, d100) {
  if ( Number.isFinite(toll) ) return Math.max(Math.floor(toll), 0);
  const faces = Math.floor(Number(toll?.dice) || 0);
  if ( !(faces > 0) ) return 0;
  return Math.min(Math.floor(((Math.min(Math.max(d100(), 1), 100) - 1) * faces) / 100) + 1, faces);
}

/* -------------------------------------------- */

/**
 * The skills of a unit that roll a chance to activate in a fight, by name: those one of which another unit's
 * skill may make sure of.
 * @param {{name: string, effects?: object[], timed?: boolean, aura?: boolean}[]} [skills]
 * @returns {string[]}
 */
export function activationSkills(skills) {
  const names = [];
  for ( const skill of skills ?? [] ) {
    if ( skill.timed || skill.aura || names.includes(skill.name) ) continue;
    const rolls = (skill.effects ?? []).some((effect) => {
      const proc = effect?.proc;
      if ( !proc || proc.sure || proc.may || proc.fixed || NO_FIGHT_MOMENTS.includes(proc.on) ) return false;
      return (proc.stat !== undefined) || (proc.percent !== undefined);
    });
    if ( rolls ) names.push(skill.name);
  }
  return names;
}

/* -------------------------------------------- */

/**
 * One of a list, as a die of a hundred faces picks it.
 * @template T
 * @param {T[]} list
 * @param {number} roll       1 to 100
 * @returns {T|null}
 */
export function pickBy(list, roll) {
  if ( !list?.length ) return null;
  return list[Math.min(Math.floor(((Math.min(Math.max(roll, 1), 100) - 1) * list.length) / 100), list.length - 1)];
}

/* -------------------------------------------- */

/**
 * The effects a skill lends for the kinds of weapon that were picked: each list of effects with the kind
 * picked for it written in. A list for which no kind could be picked lends nothing.
 * @param {{pick: string, effects: object[]}[]} [lends]
 * @param {Record<string, string|string[]|null>} [picked]      The kind picked for each `pick`: a category of
 *                                                    weapon, the categories one proficiency wields, or the
 *                                                    words of a Magic type (see `weaponTypeOf` in `skills.mjs`)
 * @returns {object[]}
 */
export function lentEffects(lends, picked = {}) {
  const write = (value, kinds) => {
    if ( value === LENT ) return [...kinds];
    if ( Array.isArray(value) ) return value.flatMap((entry) => (entry === LENT) ? kinds : [entry]);
    return value;
  };
  const effects = [];
  for ( const lend of lends ?? [] ) {
    const kind = [].concat(picked?.[lend.pick] ?? []);
    if ( !kind.length ) continue;
    for ( const effect of lend.effects ?? [] ) {
      const when = Object.fromEntries(Object.entries(effect.when ?? {}).map(([key, value]) => [key, write(value, kind)]));
      effects.push({ ...effect, when });
    }
  }
  return effects;
}

/* -------------------------------------------- */

/**
 * The units a unit was forced to target, of which it may make no other enemy its target: those whose change
 * with the rule `provoked` it carries.
 * @param {{effects?: object[], by?: string, wait?: number}[]} [timed]    The changes that last on it
 * @returns {string[]}        Those units, by their UUID
 */
export function provokers(timed) {
  return (timed ?? [])
    .filter((change) => change?.by && !((change.wait ?? 0) > 0) && (change.effects ?? []).some((effect) => effect.rules?.includes(PROVOKED)))
    .map((change) => change.by);
}

/* -------------------------------------------- */

/**
 * The weapon an attack with numbers of its own is made with, as a fight reads a weapon: what a skill says of
 * its `strike`, with the numbers read from its unit worked out.
 * @param {object} strike                     The `strike` of its `act` part
 * @param {object} options
 * @param {string} options.name               What it is called: the skill
 * @param {(value: number|object) => number} options.number     Works out a number read from the unit
 * @param {{min: number, max: number}} options.reach            How far away its target may stand
 * @returns {{weapon: object, bare: {hit: number, crit: number, weight: number, rank: string}}}
 */
export function strikeWeapon(strike, { name, number, reach }) {
  const amount = (value) => Math.max(Math.floor(number(value ?? 0)) || 0, 0);
  return {
    weapon: {
      id: null,
      name,
      category: "",
      might: amount(strike.might),
      range: (reach.min === reach.max) ? String(reach.max) : `${reach.min}-${reach.max}`,
      effect: String(strike.effect ?? ""),
      damageStat: strike.stat ?? "str",
      wexp: 0,
      uses: { value: 0, max: 0 }
    },
    bare: { hit: amount(strike.hit), crit: amount(strike.critical), weight: 0, rank: "E" }
  };
}

/* -------------------------------------------- */

/**
 * A unit as it fights with another weapon than the one in its hand: for one attack a skill has it make.
 * @param {object} unit       The unit, as a fight reads it (see `combat.mjs`)
 * @param {{weapon: object, bare: object}} arm
 * @returns {object}
 */
export function armedWith(unit, arm) {
  if ( !arm?.weapon ) return unit;
  return { ...unit, weapon: arm.weapon, bare: unit.bare ? { ...unit.bare, weapon: arm.bare ?? unit.bare.weapon } : unit.bare };
}

/* -------------------------------------------- */

/**
 * A unit without what its skills do at a moment of a fight, for an attack that activates none of them: what
 * they always do stays.
 * @param {object} unit
 * @returns {object}
 */
export function withoutMoments(unit) {
  const plain = (skills) => (skills ?? []).map((skill) => ({ ...skill, effects: (skill.effects ?? []).filter((effect) => !effect.proc) }));
  return { ...unit, skills: unit.skills ? plain(unit.skills) : unit.skills };
}

/* -------------------------------------------- */

/**
 * Does a skill reach a unit: one of the side it is for, standing as far away as it asks?
 * @param {object} act
 * @param {"friend"|"foe"|"apart"} relation   How the unit stands to the one that uses the skill
 * @param {number} distance                   Tiles between the two
 * @param {((distance: number) => boolean)|null} [armed]
 *                                            For a skill that reaches as far as its unit's weapon: does the
 *                                            weapon in its hand attack at that distance? Without it, no unit
 *                                            is in such a skill's reach
 * @returns {boolean}
 */
export function actReaches(act, relation, distance, armed = null) {
  const target = act?.target ?? {};

  // The unit itself, for a skill that may be used on it
  if ( relation === "self" ) return !!target.self;
  const sides = { ally: ["friend"], enemy: ["foe"], any: ["friend", "foe", "apart"] }[target.who] ?? [];
  if ( !sides.includes(relation) ) return false;
  if ( target.within === WEAPON_REACH ) return (distance >= 1) && !!armed?.(distance);
  if ( target.within === MAP_REACH ) return distance >= Math.max(target.from ?? 1, 1);
  return (distance >= Math.max(target.from ?? 1, 1)) && (distance <= Math.max(target.within ?? 1, 1));
}

/* -------------------------------------------- */

/**
 * The ways a skill may be used on a unit it is for: the first, what it says of every target; and the other,
 * what it says "instead" of a target that stands near enough.
 * @param {object|null} act
 * @param {object} target
 * @param {number} target.distance      How far it stands from the skill's unit
 * @param {boolean} [target.acted]      Has it acted this turn?
 * @returns {("main"|"instead")[]}
 */
export function actWays(act, { distance, acted = false } = {}) {
  if ( !act ) return [];
  const ways = [];
  const target = act.target ?? {};
  const from = Math.max(target.from ?? 1, 1);
  const within = (target.within === MAP_REACH) ? Infinity : Math.max(target.within ?? 1, 1);
  if ( (distance >= from) && (distance <= within) && !(target.unacted && acted) ) ways.push("main");
  if ( act.instead && (distance >= 1) && (distance <= Math.max(act.instead.within ?? 1, 1)) ) ways.push("instead");
  return ways;
}

/* -------------------------------------------- */

/**
 * A skill as it is used the other way it has: what it says "instead", in place of what it does otherwise.
 * @param {object} act
 * @returns {object}
 */
export function actInstead(act) {
  const { instead, label, heal, damage, grant, inflicts, mark, assures, ...rest } = act ?? {};
  if ( !instead ) return act;
  const { within, label: named, ...does } = instead;
  return { ...rest, ...does, target: { ...(rest.target ?? {}), within: within ?? 1, unacted: undefined } };
}

/* -------------------------------------------- */

/**
 * The uses a skill takes off its target's weapon and Shield, as numbers.
 * @param {{weapon?: number|object, shield?: number|object}|null} wears     The `wears` of its `act` part
 * @param {(value: number|object) => number} number   Works out a number that may be read from the unit that
 *                                                    uses the skill
 * @returns {{weapon: number, shield: number}}
 */
export function actWears(wears, number) {
  const amount = (value) => (value === undefined) ? 0 : Math.max(Math.floor(number(value)) || 0, 0);
  return { weapon: amount(wears?.weapon), shield: amount(wears?.shield) };
}

/* -------------------------------------------- */

/**
 * What is left of the uses of a weapon or a Shield once a skill has worn it down. One that never wears out
 * loses none.
 * @param {{value: number, max: number}|null} uses
 * @param {number} amount
 * @returns {{uses: number, lost: number, broke: boolean}}
 */
export function wornDown(uses, amount) {
  const value = Math.max(uses?.value ?? 0, 0);
  if ( !(uses?.max > 0) || !(amount > 0) ) return { uses: value, lost: 0, broke: false };
  const lost = Math.min(Math.floor(amount), value);
  return { uses: value - lost, lost, broke: (lost > 0) && ((value - lost) <= 0) };
}

/* -------------------------------------------- */

/**
 * Does a skill have its user pick a tile once its target is picked?
 * @param {object|null} act
 * @returns {boolean}
 */
export function actPicksTile(act) {
  return act?.move === "maneuver";
}

/* -------------------------------------------- */

/**
 * @typedef Maneuver
 * What a unit can do with an ally next to it.
 * @property {boolean} swap       May the two trade places?
 * @property {Tile[]} pivot       The tiles next to the ally that the unit can move to
 * @property {Tile[]} place       The tiles next to the unit that the ally can be set down on
 */

/**
 * What a unit can do with an ally next to it: trade places with it, move to another tile next to it, or set
 * it down on another tile next to the unit itself.
 * @param {Tile} unit
 * @param {Tile} ally
 * @param {object} fields
 * @param {ForcedField} fields.unit       The map, as the unit would stand on it
 * @param {ForcedField|null} fields.ally  The map, as the ally would; null for an ally that is not moved
 * @returns {Maneuver}
 */
export function maneuvers(unit, ally, fields) {
  const own = tileKey(unit);
  const theirs = tileKey(ally);
  const free = (tiles) => tiles.filter((tile) => (tileKey(tile) !== own) && (tileKey(tile) !== theirs));
  return {
    swap: !!fields.ally && swaps(unit, ally, fields.unit, fields.ally),
    pivot: free(beside(ally, fields.unit)),
    place: fields.ally ? free(beside(unit, fields.ally)) : []
  };
}

/* -------------------------------------------- */

/**
 * What a click on a tile means for a unit that maneuvers with an ally.
 * @param {Maneuver} options
 * @param {Tile} ally       Where the ally stands
 * @param {Tile} tile       The tile that was clicked
 * @returns {"swap"|"pivot"|"place"|null}
 */
export function maneuverAt(options, ally, tile) {
  const key = tileKey(tile);
  if ( options.swap && (key === tileKey(ally)) ) return "swap";
  if ( options.pivot.some((other) => tileKey(other) === key) ) return "pivot";
  return options.place.some((other) => tileKey(other) === key) ? "place" : null;
}

/* -------------------------------------------- */
/*  Opposed Checks                              */
/* -------------------------------------------- */

/**
 * The best of a unit's bonuses to some Ability checks.
 * @param {Record<string, number>} bonuses    Its bonus to each check, by key
 * @param {string[]} keys                     The checks it may answer with
 * @returns {{key: string, bonus: number}}
 */
export function bestCheck(bonuses, keys) {
  let best = { key: keys[0] ?? "", bonus: bonuses?.[keys[0]] ?? 0 };
  for ( const key of keys.slice(1) ) {
    const bonus = bonuses?.[key] ?? 0;
    if ( bonus > best.bonus ) best = { key, bonus };
  }
  return best;
}

/* -------------------------------------------- */

/**
 * An opposed Ability check: the target number is the total of the check that answers it, and the unit that
 * asks succeeds unless the answer is higher.
 * @param {{roll: number, bonus: number}} asked     The d100 and bonus of the unit that makes the check
 * @param {{roll: number, bonus: number}} answer    Those of the unit that opposes it
 * @returns {{total: number, against: number, success: boolean}}
 */
export function opposedCheck(asked, answer) {
  const total = (asked.roll ?? 0) + (asked.bonus ?? 0);
  const against = (answer.roll ?? 0) + (answer.bonus ?? 0);
  return { total, against, success: total >= against };
}

/* -------------------------------------------- */
/*  Holding a Unit                              */
/* -------------------------------------------- */

/**
 * What a unit that has hold of another gives the unit it holds, read as one more skill of the holder: an aura
 * that is only for that unit, and only while it stands next to its holder.
 * @param {string} name       What it goes by among the held unit's numbers: the skill's name
 * @param {string} target     The unit held, by what tells its token from the others
 * @returns {{name: string, innate: true, nihil: false, effects: object[]}}
 */
export function gripEntry(name, target) {
  return {
    name,
    innate: true,
    nihil: false,
    effects: [{ aura: { who: "any", within: FEO.grip.reach, only: [target] }, rules: [HELD, GRIPPED], calc: { dodgeBy: "none" } }]
  };
}

/* -------------------------------------------- */

/**
 * Does a hold still stand? The two must both be in the fight, next to each other.
 * @param {{tile: Tile|null, out?: boolean}|null} holder
 * @param {{tile: Tile|null, out?: boolean}|null} held
 * @returns {boolean}
 */
export function gripHolds(holder, held) {
  if ( !holder?.tile || !held?.tile || holder.out || held.out ) return false;
  return tilesApart(holder.tile, held.tile) <= FEO.grip.reach;
}

/* -------------------------------------------- */

/**
 * Where a unit that is held is dragged to as its holder moves: nowhere while it still stands next to its
 * holder; else the tile its holder came from, where it can stand there; else the nearest tile next to its
 * holder that it can.
 * @param {object} move
 * @param {Tile} move.holder          Where the holder now stands
 * @param {Tile} move.held            Where the unit it holds stands
 * @param {Tile|null} [move.from]     The tile the holder took its last step from
 * @param {ForcedField} field         The map, as the unit held would stand on it
 * @returns {{tile: Tile, moved: boolean}|null}     Null when there is no room for it: the hold is then broken
 */
export function dragTo({ holder, held, from = null }, field) {
  if ( tilesApart(holder, held) === 1 ) return { tile: { i: held.i, j: held.j }, moved: false };
  if ( from && (tilesApart(holder, from) === 1) && !blocks(holder, from, field) ) return { tile: { i: from.i, j: from.j }, moved: true };
  const open = beside(holder, field).sort((a, b) => tilesApart(a, held) - tilesApart(b, held));
  return open.length ? { tile: open[0], moved: true } : null;
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check how a skill says what it does to a unit picked on the map, so that a typing mistake does not pass
 * silently.
 * @param {any} act
 * @param {object} [options]
 * @param {string[]} [options.checks]     The Ability checks there are
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkAct(act, { checks = Object.keys(FEO.abilityChecks) } = {}) {
  if ( !act || (typeof act !== "object") || Array.isArray(act) ) return ["act must say what the skill does to its target"];
  const problems = [];
  for ( const key of Object.keys(act) ) {
    if ( !ACT_PARTS.includes(key) ) problems.push(`act cannot say "${key}"`);
  }
  const target = act.target;
  const area = act.area;
  if ( area !== undefined ) {
    for ( const problem of checkArea(area) ) problems.push(problem);
    if ( target !== undefined ) problems.push("act: a skill is used on a target or takes in an area, not both");
    for ( const key of AREA_BARS ) if ( act[key] !== undefined ) problems.push(`act: a skill that takes in an area cannot say "${key}"`);
    if ( act.through && (area?.shape !== "line") ) problems.push("act: only a skill that takes in a line moves its unit through it");
  }
  else {
    for ( const key of AREA_ONLY ) if ( act[key] !== undefined ) problems.push(`act: only a skill that takes in an area says "${key}"`);
    if ( !target || (typeof target !== "object") ) problems.push("act: a target says whom the skill is used on");
  }
  if ( target && (typeof target === "object") ) {
    for ( const key of Object.keys(target) ) if ( !TARGET_PARTS.includes(key) ) problems.push(`act: a target cannot say "${key}"`);
    if ( !["ally", "enemy", "any"].includes(target.who) ) problems.push(`act: a target is an "ally", an "enemy" or "any" unit, not "${target.who}"`);
    for ( const key of ["within", "from"] ) {
      if ( (key === "within") && [WEAPON_REACH, MAP_REACH].includes(target.within) ) continue;
      if ( (target[key] !== undefined) && !(Number.isInteger(target[key]) && (target[key] >= 1)) ) problems.push(`act: "${key}" is a whole number of tiles`);
    }
    if ( (target.within === WEAPON_REACH) && ((target.from !== undefined) || (target.clear !== undefined)) ) problems.push("act: a target in weapon range says nothing else of the way to it");
    if ( (target.clear !== undefined) && (target.clear !== true) ) problems.push("act: \"clear\" is true or left out");
    if ( (target.self !== undefined) && (target.self !== true) ) problems.push("act: \"self\" is true or left out");
    if ( (target.made !== undefined) && !(Array.isArray(target.made) && target.made.length && target.made.every((name) => (typeof name === "string") && name)) ) {
      problems.push("act: \"made\" lists the skills that made the creatures the skill is for");
    }
    if ( (target.unacted !== undefined) && (target.unacted !== true) ) problems.push("act: \"unacted\" is true or left out");
  }

  // The other way it may be used on a target that stands near enough
  if ( act.instead !== undefined ) {
    const instead = act.instead;
    if ( !instead || (typeof instead !== "object") || Object.keys(instead).some((key) => !["within", "label", "grant"].includes(key)) || !instead.grant ) {
      problems.push("act: \"instead\" says the change it leaves in place of the rest: { within, label, grant }");
    }
    else {
      for ( const problem of checkActGrant(instead.grant) ) problems.push(problem);
      if ( (instead.within !== undefined) && !(Number.isInteger(instead.within) && (instead.within >= 1)) ) problems.push("act: \"instead\" reaches a whole number of tiles");
      if ( (typeof instead.label !== "string") || !instead.label || (typeof act.label !== "string") || !act.label ) problems.push("act: a skill with two ways gives each a \"label\"");
    }
    if ( area ) problems.push("act: only a skill that is used on a target has another way");
  }
  else if ( act.label !== undefined ) problems.push("act: \"label\" names the first of two ways");

  // A skill that has its unit imitate the unit it is used on does nothing else to that unit
  if ( act.imitates !== undefined ) {
    for ( const problem of checkImitates(act.imitates) ) problems.push(`act: ${problem}`);
    if ( ACT_DOES.some((key) => (key !== "imitates") && (act[key] !== undefined)) ) problems.push("act: a skill that imitates its target does nothing else to it");
    if ( target?.self ) problems.push("act: a unit does not imitate itself");
  }

  // A creature appears on a tile that is picked, and on nothing else
  if ( act.makes !== undefined ) {
    for ( const problem of checkMakes(act.makes, { at: "act" }) ) problems.push(`act: ${problem}`);
    if ( area && ((area.centre !== "tile") || (area.radius !== 0)) ) problems.push("act: a creature appears on one tile that is picked");
    if ( ["grant", "heal", "damage", "strike", "inflicts", "trap", "shares", "user"].some((key) => act[key] !== undefined) ) problems.push("act: a skill that makes a creature does nothing else on that tile");
  }
  if ( (act.move !== undefined) && !ACT_MOVES.includes(act.move) ) problems.push(`act: unknown move "${act.move}"`);

  // A trap is laid on a tile that is picked, and on nothing else
  if ( act.trap !== undefined ) {
    for ( const problem of checkTrap(act.trap) ) problems.push(`act: ${problem}`);
    if ( area && (area.centre !== "tile") ) problems.push("act: a trap is laid on a tile that is picked");
  }
  if ( act.check !== undefined ) {
    const check = act.check;
    if ( !check || (typeof check !== "object") || Object.keys(check).some((key) => !["by", "against"].includes(key)) ) {
      problems.push("act: a check names the unit's own check and those that answer it: { by, against }");
    }
    else {
      if ( !checks.includes(check.by) ) problems.push(`act: unknown Ability check "${check.by}"`);
      if ( !Array.isArray(check.against) || !check.against.length ) problems.push("act: a check is answered by a list of Ability checks");
      else for ( const key of check.against ) if ( !checks.includes(key) ) problems.push(`act: unknown Ability check "${key}"`);
    }
  }
  if ( (act.grip !== undefined) && (act.grip !== true) ) problems.push("act: \"grip\" is true or left out");

  // Uses it takes off the target's gear, and a change it leaves on the target
  if ( act.wears !== undefined ) {
    const wears = act.wears;
    const amount = (value) => (Number.isFinite(value) && (value >= 0)) || (value && (typeof value === "object") && (value.of !== undefined));
    if ( !wears || (typeof wears !== "object") || !["weapon", "shield"].some((key) => wears[key] !== undefined) ) problems.push("act: wears names the target's \"weapon\" or \"shield\"");
    else for ( const [key, value] of Object.entries(wears) ) {
      if ( !["weapon", "shield"].includes(key) ) problems.push(`act: wears cannot say "${key}"`);
      else if ( !amount(value) ) problems.push(`act: wears: "${key}" is a number of uses`);
    }
  }
  for ( const problem of checkActGrant(act.grant) ) problems.push(problem);

  // What it does to every unit in reach at once, in place of what it does to one
  if ( act.all !== undefined ) {
    const all = act.all;
    if ( !all || (typeof all !== "object") || !Object.keys(all).length || Object.keys(all).some((key) => !["grant", "heal", "damage"].includes(key)) ) {
      problems.push("act: \"all\" says what every unit in reach gets instead: a grant, heal or damage");
    }
    else for ( const problem of checkActGrant(all.grant) ) problems.push(problem);
    if ( [WEAPON_REACH, MAP_REACH].includes(target?.within) ) problems.push("act: a skill for all units in reach reaches a number of tiles");
  }
  const amount = (value) => (Number.isFinite(value) && (value > 0)) || (value && (typeof value === "object") && (value.of !== undefined));
  for ( const key of ["heal", "damage"] ) {
    for ( const value of [act[key], act.all?.[key]] ) if ( (value !== undefined) && !amount(value) ) problems.push(`act: "${key}" is a number of HP`);
  }
  if ( (act.asks !== undefined) && (act.asks !== "target") ) problems.push("act: \"asks\" is \"target\" or left out");
  if ( (act.asks !== undefined) && !act.grant?.choose ) problems.push("act: only a change that has a stat picked asks somebody");
  if ( (act.assures !== undefined) && (act.assures !== true) ) problems.push("act: \"assures\" is true or left out");

  // Conditions it gives, a mark it leaves, and what a skill that takes in an area says beside
  if ( act.inflicts !== undefined ) {
    if ( !Array.isArray(act.inflicts) || !act.inflicts.length ) problems.push("act: inflicts is a list of conditions");
    else for ( const entry of act.inflicts ) {
      const id = (typeof entry === "string") ? entry : entry?.id;
      if ( !(id in FEO.conditions) && !(id in (FEO.optionalConditions ?? {})) ) problems.push(`act: unknown condition "${id}"`);
      if ( (typeof entry === "object") && (entry?.turns !== undefined) && !(Number.isInteger(entry.turns) && (entry.turns >= 1)) ) problems.push("act: the turns of a condition are a whole number");
    }
  }
  if ( act.mark !== undefined ) {
    const mark = act.mark;
    if ( !mark || (typeof mark !== "object") || Object.keys(mark).some((key) => !["name", "ends", "turns"].includes(key)) || (typeof mark.name !== "string") || !mark.name ) {
      problems.push("act: a mark says what it is called and when it ends: { name, ends }");
    }
  }
  if ( act.user !== undefined ) {
    const user = act.user;
    if ( !user || (typeof user !== "object") || Object.keys(user).some((key) => !["grant", "each"].includes(key)) || !user.grant ) {
      problems.push("act: \"user\" says the change the skill's own unit carries: { grant, each }");
    }
    else {
      for ( const problem of checkActGrant(user.grant) ) problems.push(problem);
      if ( (user.each !== undefined) && (user.each !== true) ) problems.push("act: \"each\" is true or left out");
    }
  }
  if ( (act.through !== undefined) && (act.through !== true) ) problems.push("act: \"through\" is true or left out");
  if ( act.shares !== undefined ) {
    const shares = act.shares;
    if ( !shares || (typeof shares !== "object") || Object.keys(shares).some((key) => key !== "gives") || !(Number.isInteger(shares.gives) && (shares.gives >= 1)) ) {
      problems.push("act: shares says what each HP its unit gives up restores: { gives: 2 }");
    }
    if ( ["grant", "heal", "damage", "strike", "inflicts"].some((key) => act[key] !== undefined) ) problems.push("act: a skill that shares HP out does nothing else to the units it catches");
  }
  if ( act.again !== undefined ) {
    const again = act.again;
    const cost = (value) => (Number.isFinite(value) && (value > 0)) || (value && (typeof value === "object") && (value.of !== undefined));
    if ( !again || (typeof again !== "object") || Object.keys(again).some((key) => !["pays", "grant"].includes(key)) || !cost(again.pays) ) {
      problems.push("act: \"again\" says what its unit pays to have the skill do its part once more: { pays, grant }");
    }
    else for ( const problem of checkActGrant(again.grant) ) problems.push(problem);
  }

  // What it does as its target comes into the Line of Sight of its unit, and stays there
  if ( act.watch !== undefined ) {
    const watch = act.watch;
    if ( !watch || (typeof watch !== "object") || Object.keys(watch).some((key) => !["enters", "stays"].includes(key)) || !(watch.enters || watch.stays) ) {
      problems.push("act: a watch says what its target gets as it \"enters\" the Line of Sight of the unit and while it \"stays\" there");
    }
    else {
      for ( const key of ["enters", "stays"] ) {
        const part = watch[key];
        if ( part === undefined ) continue;
        if ( !part || !Array.isArray(part.effects) || !part.effects.length ) problems.push(`act: watch: "${key}" needs effects`);
        else if ( Object.keys(part).some((name) => !["effects", "ends", "turns", "max"].includes(name)) ) problems.push(`act: watch: "${key}" says its effects, and when it ends or how far it grows`);
      }
      if ( (watch.stays !== undefined) && !(Number.isInteger(watch.stays?.max) && (watch.stays.max >= 1)) ) problems.push("act: watch: what stays grows up to a \"max\"");
    }
    if ( !act.grant?.by ) problems.push("act: a watch goes with a grant that remembers whom it comes from (by: true)");
  }

  // One attack it has its unit make on the target
  if ( act.strike !== undefined ) {
    const strike = act.strike;
    const parts = ["might", "hit", "critical", "effect", "stat", "plain", "weapon", "share", "effects", "hand", "only", "combat"];
    if ( !strike || (typeof strike !== "object") ) problems.push("act: a strike says what the attack is made with");
    else {
      for ( const key of Object.keys(strike) ) if ( !parts.includes(key) ) problems.push(`act: a strike cannot say "${key}"`);
      const own = ["might", "hit", "critical", "effect", "stat"].some((key) => strike[key] !== undefined);
      const ways = [own, strike.weapon !== undefined, strike.hand !== undefined].filter(Boolean).length;
      if ( ways !== 1 ) problems.push("act: a strike has numbers of its own (might, hit), names the kind of \"weapon\" it is made with, or is made with the weapon in \"hand\"");
      if ( (strike.hand !== undefined) && (strike.hand !== true) ) problems.push("act: \"hand\" is true or left out");
      if ( own && ((strike.might === undefined) || (strike.hit === undefined)) ) problems.push("act: a strike with numbers of its own says its might and its hit");
      if ( (strike.weapon !== undefined) && (!Array.isArray(strike.weapon) || !strike.weapon.length) ) problems.push("act: a strike lists the kinds of weapon it is made with");
      if ( (strike.share !== undefined) && !(Number.isFinite(strike.share) && (strike.share > 0)) ) problems.push("act: the share of the damage of a strike is a number of percent");
      if ( (strike.stat !== undefined) && !(strike.stat in FEO.stats) ) problems.push(`act: a strike adds a stat, not "${strike.stat}"`);
      if ( (strike.plain !== undefined) && (strike.plain !== true) ) problems.push("act: \"plain\" is true or left out");
      if ( (strike.effects !== undefined) && !Array.isArray(strike.effects) ) problems.push("act: the effects of a strike are a list");

      // With the weapon in hand: only one of these kinds, and only one that attacks
      if ( (strike.only !== undefined) && !(strike.hand && Array.isArray(strike.only) && strike.only.length) ) problems.push("act: \"only\" lists the kinds of weapon a strike with the weapon in hand is made with");
      if ( (strike.combat !== undefined) && !(strike.hand && (strike.combat === true)) ) problems.push("act: \"combat\" is true, for a strike with the weapon in hand");
    }

    // A skill that strikes every unit of an area may leave a change on each it attacked, once that is done
    const others = ["move", "check", "grip", "wears", "fight", "heal", "damage", "all", "assures", "inflicts", ...(area ? [] : ["grant"])];
    if ( others.some((key) => act[key] !== undefined) ) problems.push("act: a skill that strikes does nothing else to its target");
    if ( !area && (target?.who !== "enemy") ) problems.push("act: a strike is made on an \"enemy\"");
    if ( !area && [WEAPON_REACH, MAP_REACH].includes(target?.within) ) problems.push("act: a strike reaches a number of tiles");
    if ( strike?.hand && !area ) problems.push("act: only a skill that takes in an area strikes with the weapon in hand");
  }

  // A fight of several rounds it starts with the target, which stands alone among what a skill does
  if ( act.fight !== undefined ) {
    const fight = act.fight;
    const rounds = fight?.rounds;
    if ( !fight || (typeof fight !== "object") || Object.keys(fight).some((key) => key !== "rounds") || !((Number.isInteger(rounds) && (rounds >= 2)) || (rounds === "fall")) ) {
      problems.push("act: a fight goes on for a whole number of rounds, 2 at least, or until a unit falls: { rounds: 5 } or { rounds: \"fall\" }");
    }
    if ( ["move", "check", "grip", "wears", "grant"].some((key) => act[key] !== undefined) ) problems.push("act: a skill that starts a fight does nothing else to its target");
    if ( target?.who !== "enemy" ) problems.push("act: a fight is started with an \"enemy\"");
  }
  if ( ACT_DOES.every((key) => act[key] === undefined) ) problems.push("act must say what the skill does: a move, a grip, wears, a grant, a fight, heal, damage, conditions or a strike");
  return problems;
}

/* -------------------------------------------- */

/**
 * Check the change a skill leaves on the unit it is used on.
 * @param {any} grant
 * @returns {string[]}
 */
function checkActGrant(grant) {
  if ( grant === undefined ) return [];
  const problems = [];
  const parts = ["name", "effects", "ends", "turns", "next", "choose", "clock", "lone", "also", "by", "mark", "once", "toll", "lends", "stance"];
  const made = ["effects", "choose", "lends"].filter((key) => grant?.[key] !== undefined);
  if ( !grant || (typeof grant !== "object") || !made.length ) return ["act: a grant needs effects"];
  for ( const key of Object.keys(grant) ) if ( !parts.includes(key) ) problems.push(`act: a grant cannot say "${key}"`);
  if ( grant.effects !== undefined ) {
    if ( !Array.isArray(grant.effects) || (!grant.effects.length && !grant.mark && !grant.toll && (made.length < 2)) ) problems.push("act: a grant needs effects");
    else if ( grant.effects.some((effect) => effect?.proc || effect?.aura || effect?.grant) ) problems.push("act: the effects of a grant cannot wait for a moment, be an aura or grant another");
  }
  if ( (grant.turns !== undefined) && !(Number.isInteger(grant.turns) && (grant.turns >= 1)) ) problems.push("act: a grant lasts a whole number of turns");
  if ( (grant.clock !== undefined) && (grant.clock !== "giver") ) problems.push("act: a grant lasts by the turns of its own unit, or of the \"giver\"");
  for ( const key of ["lone", "by", "mark"] ) if ( (grant[key] !== undefined) && (grant[key] !== true) ) problems.push(`act: "${key}" of a grant is true or left out`);
  if ( (grant.also !== undefined) && (grant.also !== "self") ) problems.push("act: a grant is \"also\" for \"self\", or for nobody else");
  if ( grant.choose !== undefined ) {
    const choose = grant.choose;
    const listed = (choose?.stats === LEARNT) || (Array.isArray(choose?.stats) && choose.stats.length && choose.stats.every((key) => key in FEO.stats));
    if ( !choose || !listed ) problems.push("act: a grant picks among stats, or the one \"learnt\"");
    if ( !Number.isFinite(choose?.amount) || !choose.amount ) problems.push("act: a grant adds an amount to the stat that is picked");
    if ( Object.keys(choose ?? {}).some((key) => !["stats", "amount", "pick"].includes(key)) ) problems.push("act: a pick of stats says its stats, its amount and how many are picked");
  }
  if ( grant.toll !== undefined ) {
    const toll = grant.toll;
    const cost = (value) => (Number.isInteger(value) && (value >= 1)) || (Number.isInteger(value?.dice) && (value.dice >= 2));
    if ( !toll || (typeof toll !== "object") || !Object.keys(toll).length || Object.entries(toll).some(([key, value]) => !["move", "attack"].includes(key) || !cost(value)) ) {
      problems.push("act: a toll is HP lost on a \"move\" or after an \"attack\": a number, or { dice }");
    }
  }
  if ( grant.lends !== undefined ) {
    if ( !Array.isArray(grant.lends) || !grant.lends.length ) problems.push("act: lends is a list");
    else for ( const lend of grant.lends ) {
      if ( !LEND_PICKS.includes(lend?.pick) ) problems.push(`act: lends picks a kind of weapon the target "wields" or one its "foes" hold, not "${lend?.pick}"`);
      if ( !Array.isArray(lend?.effects) || !lend.effects.length ) problems.push("act: lends needs effects");
      if ( (lend?.manual !== undefined) && !(lend.manual in FEO.ranks) ) problems.push(`act: lends: "manual" is a weapon rank, not "${lend.manual}"`);
      if ( Object.keys(lend ?? {}).some((key) => !["pick", "effects", "manual"].includes(key)) ) problems.push("act: lends says its pick, its effects and the rank that picks by hand");
    }
  }
  return problems;
}

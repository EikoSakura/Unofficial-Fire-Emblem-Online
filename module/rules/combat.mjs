/**
 * Combat resolution for Fire Emblem Online: one exchange between an initiator and a defender.
 *
 * Ported from the "Actions, Combat and the Weapon Triangle" section of the rules, the notes in the weapon
 * reference sheet and the rulings in the Book of Stipulations. Everything here works on plain data and takes
 * its dice as a function, so that it can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";
import { breakInUse, wouldBreak } from "./breaking.mjs";
import {
  applyCondition, attackElement, blocksWeapon, conditionConfig, endOnHit, heldBy, inflictions, resolveHit, restrictions,
  strikeNumbers, wardOff
} from "./conditions.mjs";
import { takeHit } from "./defeat.mjs";
import { unitsNear, unitsNearFoe } from "./positions.mjs";
import { followsUp } from "./progression.mjs";
import { prepareSkills, weaponStrikes } from "./skill-combat.mjs";
import { PROC_TRIGGERS, hpHolds, readsDealt, resolveDealt } from "./skills.mjs";
import { isStaggered, staggerHit, staggerInUse, staggerTimes } from "./stagger.mjs";
import { heightBlocks, heightEdge } from "./terrain.mjs";
import { buildChange } from "./timed.mjs";
import { followUpTimes } from "./variants.mjs";

/**
 * @typedef ExchangeWeapon
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} category        A key of FEO.weaponCategories
 * @property {number} might
 * @property {string} range           As written on the weapon: "1", "1-2", "2-3", "1-MAG/2", "Midrange"
 * @property {string} [effect]
 * @property {string} damageStat      One of str, mag, spd, dex
 * @property {number} wexp            Weapon experience earned per hit
 * @property {{value: number, max: number}} uses    A maximum of 0 means the weapon never wears out
 */

/**
 * @typedef Combatant
 * @property {string} [name]
 * @property {number} hp                          Current HP
 * @property {Record<string, number>} stats       Stat totals, at least def and res
 * @property {number} [endurance]                 Damage reduction from support partners in range
 * @property {number} [haste]                     Attack Speed counted towards the unit's own follow-up attack
 *                                                and nothing else, from support partners in range
 * @property {number} [activation]                What support partners in range add to the Skill Activation
 *                                                rate, on top of what the unit's skills add
 * @property {number} [gold]                      The gold the unit carries, for what counts it
 * @property {string|null} [wlvRank]              With Weapon Levels: the rank its Weapon Level counts as
 * @property {Record<"accuracy"|"damage"|"critical"|"attackSpeed"|"dodge"|"critAvoid", number>} combat
 *                                                Combat stats with the weapon in hand
 * @property {ExchangeWeapon|null} weapon         The weapon in hand
 * @property {Record<string, {rank: string, wexp: number}>} [proficiencies]
 * @property {string} [qualities]                 Special Qualities, as free text
 * @property {boolean} [noCounter]                Is the unit prevented from counter-attacking?
 * @property {boolean} [break]                    Does the unit suffer from Break, which takes its counter-attack
 *                                                (see `breaking.mjs`)? Only read where the world plays with it
 * @property {import("./stagger.mjs").StaggerBar} [stagger]
 *                                                The unit's Stagger bar as it stands (see `stagger.mjs`). Only
 *                                                read where the world plays with Stagger
 * @property {number} [fcm]                       Its Follow-up Critical Multiplier, which its Critical is
 *                                                multiplied by on a follow-up attack (see `variants.mjs`). Only
 *                                                read where the world plays with it
 * @property {boolean} [noDodge]                Is the unit prevented from dodging? Only read for a unit
 *                                                given without `conditions`, which say so themselves
 * @property {number} [hpMax]                     Maximum HP, which healing during the exchange stops at
 * @property {import("./conditions.mjs").ConditionState} [conditions]
 *                                                The unit's conditions and the turns each has left
 * @property {boolean} [incapacitated]            Is the unit down? It can still be attacked, is always hit and
 *                                                makes no attack of its own
 * @property {number} [resilience]                What is taken off damage past 0 HP, which is then kept as
 *                                                negative HP. Without it HP stops at 0
 * @property {import("./skills.mjs").SkillEntry[]} [skills]   The unit's equipped skills and their effects
 * @property {object} [bare]                      The unit's numbers without any skill effect, which the skills
 *                                                are then added to: stats, base, boosts, calc, modifiers, accuracy
 * @property {number} [level]
 * @property {import("./positions.mjs").Surroundings|null} [near]
 *                                                What the unit has around it on the map; null when it has no
 *                                                token there, and what hangs on that is then only shown
 * @property {import("./auras.mjs").AuraEntry[]} [auras]
 *                                                What the unit receives from the skills of the units around it
 * @property {import("./timed.mjs").TimedChange[]} [timed]
 *                                                The changes that last a while which the unit carries
 * @property {string} [uuid]                      What tells the unit from all others, kept on the lasting
 *                                                changes it grants that end by its own turns
 * @property {import("./arts.mjs").FightArt} [art]    The Combat Art it performs if it initiates the fight, whose
 *                                                HP it has paid already (see `readyArt`)
 * @property {{name: string, why: string}} [artBlocked]   The Art it had readied and cannot perform, and why
 */

/**
 * @typedef ExchangeSide
 * @property {Combatant} unit
 * @property {string|null} blocked      Why this side makes no attack, or null if it attacks: one of down,
 *                                      targetDown, unarmed, broken, outOfRange, elevation, midrange, condition,
 *                                      silenced, noCombat, skill, artRange, break, staggered
 * @property {boolean} breaks          Does a hit of this side that deals damage Break its foe? Only ever the
 *                                      side that begins the fight, with weapon triangle advantage
 * @property {number} strikes           How many times each of this side's attacks strikes
 * @property {number} openStrikes       How many times its first attack strikes, which a Combat Art may raise
 * @property {import("./arts.mjs").FightArt|null} art
 *                                      The Combat Art this side performs, for the initiator that attacks
 * @property {{accuracy: number, critical: number, damage: number, dodge: number, critAvoid: number}|null} opener
 *                                      What a Combat Art adds to the numbers of this side's first attack alone:
 *                                      its own Art to its Hit, Critical and damage, the foe's Art to the Dodge
 *                                      and Critical Avoid it attacks against
 * @property {string[]} skills          The skills that changed something for this side
 * @property {string[]} auras           The auras of units around that changed something for this side, each
 *                                      named with its skill and the unit that gives it
 * @property {string[]} lasting         The changes that last a while which this side carries into the fight
 * @property {{skill: string, unseen: boolean}[]} checks
 *                                      This side's skills that are shown and not applied, for the table to
 *                                      check by hand; `unseen` when the unit is not on the map
 * @property {{id?: string, name: string}[]} declared
 *                                      The skills this side declared for the fight, which the fight spends
 * @property {Record<string, object[]>} chances
 *                                      This side's skills that wait for a moment of the fight, by that moment
 *                                      (see PROC_TRIGGERS): on each of its attacks, on each hit it takes, as
 *                                      the fight begins, when it hits, misses, dodges or defeats, and afterwards
 * @property {number} power             Damage of a hit before the target's defence
 * @property {number} resisted          What the target's defence takes off it
 * @property {{height: number, hit: number, damage: number, dodge: number, cover: number}} ground
 *                                      What the ground does to this side's attacks: `height` is 1 for a ranged
 *                                      attack from above and -1 from below, with what that adds to Hit and
 *                                      damage; `dodge` and `cover` are what the target's tile adds to its
 *                                      Dodge and takes off the damage
 * @property {number} hit               Chance to hit with the first attack, 0 to 100
 * @property {number} crit              Chance of a critical hit with the first attack, 0 to 100
 * @property {number} [fcm]             What this side's Critical is multiplied by on its follow-up attack, before
 *                                      the foe's Critical Avoid is taken off. Only set for a side that follows
 *                                      up with a Follow-up Critical Multiplier above 1
 * @property {number} [critFollow]      Chance of a critical hit with that follow-up attack, 0 to 100, set
 *                                      along with `fcm`
 * @property {number} damage          Damage dealt by a first hit that is not critical
 * @property {number} damageLater       Damage dealt by a later hit, once the first has ended the target's
 *                                      conditions that end on being hit
 * @property {object} base              The numbers both units bring to every strike, before conditions
 * @property {object} strike            What kind of attack this side makes: initiating, distance, physical,
 *                                      element, noDodge
 * @property {import("./conditions.mjs").Infliction[]} inflicts   Conditions the weapon inflicts on a hit
 * @property {import("./conditions.mjs").StrikeNote[]} notes      What conditions change about the first attack
 * @property {string[]} warnings        This side's conditions that limit what it can do
 * @property {number} attacks           Attacks this side makes if nothing cuts the exchange short
 * @property {boolean} doubles          Does this side have the Attack Speed lead for a follow-up?
 * @property {number} triangle          1 with weapon triangle advantage, -1 at a disadvantage, otherwise 0
 * @property {number} triangleHit       The triangle's adjustment to Hit
 * @property {number} triangleDamage    The triangle's adjustment to damage
 * @property {string[]} effective       The target's Special Qualities this weapon is effective against
 * @property {number} mightMultiplier   What the weapon's Might is multiplied by, 1 unless effective
 * @property {"def"|"res"} defence      The stat the target resists this weapon with
 * @property {{chance: number, both: boolean, halved: boolean}|null} backfire
 *                                      Set when this side's attacks may backfire, as a Devil weapon does:
 *                                      the chance in percent of an attack that lands damaging its own unit
 *                                      instead of the target; `both` when it then damages the target as
 *                                      well, `halved` when the unit only takes half of it
 * @property {boolean} evaded           Would this side's first hit be fatal to a foe that dodges every such
 *                                      hit? Its Hit is then held to the cap for such attacks, and it misses
 */

/**
 * @typedef ExchangePlan
 * @property {number} distance                    Tiles between the two units
 * @property {{advantage: "initiator"|"defender"|null, rank: string|null, hit: number, damage: number}} triangle
 * @property {("initiator"|"defender")[]} order   Who attacks, in order
 * @property {number[]} [scale]                   What the damage of each attack in `order` is multiplied by,
 *                                                when any of them is not a full attack
 * @property {boolean[]} [followUps]              Which of the attacks in `order` are follow-up attacks whose
 *                                                Critical is multiplied, when any of them is
 * @property {ExchangeSide} initiator
 * @property {ExchangeSide} defender
 */

/**
 * @typedef ExchangeAttack
 * @property {"initiator"|"defender"} side    Who attacked
 * @property {number} hitRoll
 * @property {number} hitChance
 * @property {boolean} hit
 * @property {number|null} critRoll           Null when no critical roll was made
 * @property {number} critChance
 * @property {number} [fcm]                   What the attacker's Critical was multiplied by before the target's
 *                                            Critical Avoid was taken off, for a follow-up attack of a unit with
 *                                            a Follow-up Critical Multiplier above 1
 * @property {boolean} crit
 * @property {number} damage                  Damage dealt, before capping at the target's remaining HP
 * @property {number} hpBefore                The target's HP before the attack
 * @property {number} hpAfter                 The target's HP after the attack
 * @property {boolean} kill                   Did the attack bring the target to 0 HP?
 * @property {boolean} useSpent               Did the attack cost the weapon a use?
 * @property {boolean} broke                  Did the attack spend the weapon's last use?
 * @property {number} wexp                    Weapon experience earned by the attack
 * @property {object|null} conditions         What a hit did to the target's conditions, as `resolveHit` returns
 *                                            it, with `healed` for the HP it returned to the attacker and
 *                                            `returned` for the conditions the target's skills gave the attacker.
 *                                            One of those that was nullified has `success: false` and `warded`,
 *                                            and one handed back for a condition inflicted names its `skill`
 * @property {{skill: string, on: string, by: string, roll: number, chance: number, success: boolean,
 *   condition?: string}[]} [procs]           The chances to activate that were rolled for this attack, and by
 *                                            which side. One with `on: "upgrade"` is the roll for a condition
 *                                            to turn into the worse one named by `condition`
 * @property {number} [reflected]             Damage the attacker took back from the target's skills
 * @property {{skill: string, by: string, to: string, amount: number}[]} [harm]
 *                                            Damage skills dealt outside of the attack itself, after a miss
 * @property {{roll: number, chance: number, success: boolean, damage: number, both: boolean}} [backfire]
 *                                            The roll for an attack that landed to backfire, and the damage
 *                                            its own unit took if it did. Unless `both` is set the target
 *                                            then took none, and `damage` above is 0
 * @property {boolean} [evaded]               Did the target dodge the attack because its hit would have been
 *                                            fatal, whatever was rolled?
 * @property {boolean} [staggered]            Did what the attack took from a unit empty its Stagger bar, so that
 *                                            the unit is Staggered from here on?
 * @property {boolean} [added]                Was the attack added by a skill that activated?
 * @property {string} [skill]                 The skill that added it
 */

/**
 * @typedef ProficiencyGain
 * @property {string} key                             The proficiency
 * @property {{rank: string, wexp: number}} before
 * @property {{rank: string, wexp: number}} after
 * @property {number} rankUps                         Ranks gained
 */

/**
 * @typedef ExchangeOutcome
 * @property {number} hpStart
 * @property {number} hp                    HP after the exchange
 * @property {boolean} defeated             Was the unit brought to 0 HP?
 * @property {number|null} usesStart        Weapon uses before the exchange, or null when unarmed
 * @property {number|null} uses             Weapon uses after the exchange
 * @property {number} usesSpent
 * @property {boolean} broke                Did the weapon run out of uses?
 * @property {number} wexp                  Weapon experience earned
 * @property {ProficiencyGain[]} proficiencies
 * @property {import("./conditions.mjs").ConditionState} conditionsStart   Conditions before the exchange
 * @property {import("./conditions.mjs").ConditionState} conditions        Conditions after the exchange
 * @property {number} healed                HP regained during the exchange
 * @property {boolean} held                 Did a condition gained in the exchange stop its remaining attacks?
 * @property {boolean} break                Did the unit come to suffer from Break in the exchange?
 * @property {import("./stagger.mjs").StaggerBar|null} stagger
 *                                          The unit's Stagger bar after the exchange, or null for a unit whose
 *                                          bar the exchange leaves alone: the one that began it, and any unit
 *                                          where the world does not play with Stagger
 * @property {boolean} staggered            Did the unit come to be Staggered in the exchange?
 * @property {{id?: string, name: string}[]} spent   The declared skills the fight spent, and for a skill that
 *                                          takes effect by itself one entry for each time it did
 */

/**
 * @typedef ExchangeResult
 * @property {ExchangeAttack[]} attacks
 * @property {{skill: string, on: string, by: string, roll: number, chance: number, success: boolean}[]} [opening]
 *                                            The chances rolled as the fight began
 * @property {object[]} [closing]             The same for what skills do once the fighting is over
 * @property {{skill: string, by: string, damage?: number, inflicted?: object[]}[]} [after]
 *                                            What those skills did to the foe of their unit
 * @property {{skill: string, by: string}[]} [reminders]
 *                                            Skills that took effect in a way the table has to apply
 * @property {{skill: string, by: string, gold: number}[]} [earned]
 *                                            Gold skills earned their unit for defeating the foe
 * @property {{skill: string, by: string, amount: number}[]} [charged]
 *                                            Points skills gave their unit's Shift Gauge
 * @property {{by: string, to: "initiator"|"defender"|null, unit: string|null, name: string,
 *   change: import("./timed.mjs").TimedChange}[]} [granted]
 *                                            Changes that last a while which skills granted: to one of the
 *                                            two units (`to`), or to a unit around them (`unit`, as its
 *                                            surroundings name it)
 * @property {ExchangeOutcome} initiator
 * @property {ExchangeOutcome} defender
 */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** The moments of a skill that only come up through its unit's own attacks. */
const OWN_ATTACKS = ["attack", "hit", "crit", "miss", "kill"];
const other = (side) => side === "initiator" ? "defender" : "initiator";

/* -------------------------------------------- */
/*  Range                                       */
/* -------------------------------------------- */

/**
 * Read a weapon's Range as the nearest and farthest distance it attacks at.
 * A bound may be a number or a stat, optionally divided: "1-MAG/2" reaches half the wielder's Magic.
 * @param {string|number} range
 * @param {Record<string, number>} [stats]    The wielder's stat totals, for ranges that depend on one
 * @returns {{min: number, max: number, midrangeOnly: boolean}|null}  Null if the Range sets no limit that
 *                                                                    can be read
 */
export function parseRange(range, stats = {}) {
  const text = String(range ?? "").trim().toLowerCase();
  if ( !text ) return null;
  if ( text.includes("midrange") ) return { min: 1, max: 1, midrangeOnly: true };

  const bound = (part) => {
    const match = part.trim().match(/^(\d+(?:\.\d+)?|[a-z]+)(?:\s*\/\s*(\d+))?/);
    if ( !match ) return null;
    const value = /^\d/.test(match[1]) ? Number(match[1]) : stats[match[1]];
    if ( !Number.isFinite(value) ) return null;
    return Math.floor(value / (match[2] ? Number(match[2]) : 1));
  };
  const parts = text.split(/\s*(?:-|–|\bto\b|\band\b)\s*/).filter(Boolean);
  if ( !parts.length ) return null;
  const min = bound(parts[0]);
  const max = bound(parts.at(-1));
  if ( (min === null) || (max === null) ) return null;
  return { min, max: Math.max(max, min), midrangeOnly: false };
}

/* -------------------------------------------- */

/**
 * Is a weapon Midrange? Midrange weapons strike adjacent tiles from just out of reach, so that weapons which
 * only reach 1 tile cannot answer them. Every crossbow is Midrange.
 * @param {ExchangeWeapon|null} weapon
 * @returns {boolean}
 */
export function isMidrange(weapon) {
  if ( !weapon ) return false;
  return (weapon.category === "crossbow") || /midrange/i.test(weapon.range ?? "")
    || /midrange/i.test(weapon.effect ?? "");
}

/* -------------------------------------------- */

/**
 * A weapon's Range as its wielder's skills make it: the farthest raised to at least each `max` and by every
 * `add`, the nearest lowered to each `min`.
 * @param {string|number} range
 * @param {Record<string, number>} [stats]    The wielder's stat totals
 * @param {{add?: number, min?: number, max?: number}[]} [changes]    What the wielder's skills say
 * @returns {{min: number, max: number, midrangeOnly: boolean}|null}   Null if the Range sets no limit
 */
export function rangeWith(range, stats = {}, changes = []) {
  const own = parseRange(range, stats);
  if ( !own || !changes?.length ) return own;
  let { min, max } = own;
  for ( const change of changes ) {
    if ( Number.isFinite(change.max) ) max = Math.max(max, change.max);
    if ( Number.isFinite(change.min) ) min = Math.min(min, change.min);
  }
  for ( const change of changes ) max += Number.isFinite(change.add) ? change.add : 0;
  return { min, max: Math.max(max, min), midrangeOnly: own.midrangeOnly && (max <= 1) };
}

/* -------------------------------------------- */

/**
 * Can a weapon attack a target a number of tiles away?
 * @param {ExchangeWeapon} weapon
 * @param {number} distance
 * @param {Record<string, number>} [stats]    The wielder's stat totals
 * @param {object[]} [changes]                What the wielder's skills change about the weapon's Range
 * @returns {boolean}
 */
export function reaches(weapon, distance, stats, changes = []) {
  const range = rangeWith(weapon.range, stats, changes);
  if ( !range ) return true;
  if ( (distance === 1) && isMidrange(weapon) ) return true;
  return (distance >= range.min) && (distance <= range.max);
}

/* -------------------------------------------- */

/**
 * Can a weapon answer an attack made from a number of tiles away?
 * At 2 tiles or more the weapon simply has to reach. Next to the attacker, a Midrange attack can only be
 * answered by another Midrange weapon or one that reaches both 1 tile and beyond, and an ordinary attack only
 * by a weapon whose own Range includes 1.
 * @param {ExchangeWeapon} weapon           The defender's weapon
 * @param {ExchangeWeapon} attackWeapon     The weapon it is being attacked with
 * @param {number} distance
 * @param {Record<string, number>} [stats]  The defender's stat totals
 * @param {object} [options]
 * @param {object[]} [options.changes]      What the defender's skills change about its weapon's Range
 * @param {boolean} [options.midrange]      Does a skill make the attack a Midrange one?
 * @param {boolean} [options.answers]       Does a skill let the defender answer a Midrange attack from next
 *                                          to it with a weapon that only reaches 1 tile?
 * @returns {boolean}
 */
export function canCounter(weapon, attackWeapon, distance, stats, { changes = [], midrange = false, answers = false } = {}) {
  const range = rangeWith(weapon.range, stats, changes);
  if ( !range ) return true;
  const inRange = (distance >= range.min) && (distance <= range.max);
  if ( distance !== 1 ) return inRange;
  if ( midrange || isMidrange(attackWeapon) ) return isMidrange(weapon) || (inRange && ((range.max > 1) || answers));
  return inRange && !range.midrangeOnly;
}

/* -------------------------------------------- */

/**
 * The number of tiles between two units on a square grid. Units move and reach along rows and columns, so a
 * diagonal neighbour is 2 tiles away. Units larger than one tile are measured from their nearest edges.
 * @param {{i: number, j: number, width?: number, height?: number}} a   Top-left row and column, and size in tiles
 * @param {{i: number, j: number, width?: number, height?: number}} b
 * @returns {number}
 */
export function gridDistance(a, b) {
  const gap = (start1, size1, start2, size2) => {
    return Math.max(start2 - (start1 + size1 - 1), start1 - (start2 + size2 - 1), 0);
  };
  return gap(a.j, a.width ?? 1, b.j, b.width ?? 1) + gap(a.i, a.height ?? 1, b.i, b.height ?? 1);
}

/* -------------------------------------------- */
/*  Weapon Triangle and Effectiveness           */
/* -------------------------------------------- */

/**
 * Which of two weapon categories has weapon triangle advantage?
 * @param {string} [category]   This unit's weapon category
 * @param {string} [against]    The foe's weapon category
 * @returns {number}            1 with advantage, -1 at a disadvantage, otherwise 0
 */
export function triangleAdvantage(category, against) {
  if ( !category || !against ) return 0;
  if ( FEO.triangle[category]?.beats.includes(against) ) return 1;
  if ( FEO.triangle[against]?.beats.includes(category) ) return -1;
  return 0;
}

/* -------------------------------------------- */

/**
 * The proficiencies a weapon category is wielded with: its own, or for Anima every anima proficiency.
 * @param {string} category
 * @returns {string[]}
 */
export function proficienciesFor(category) {
  if ( category === "anima" ) return FEO.animaProficiencies;
  const proficiency = FEO.weaponCategories[category]?.proficiency;
  return proficiency ? [proficiency] : [];
}

/* -------------------------------------------- */

/**
 * A unit's rank with a weapon category. Anima uses the highest of its ranks; a category without a
 * proficiency counts as the lowest rank.
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @param {string} category
 * @returns {string}
 */
export function weaponRank(proficiencies, category) {
  const order = Object.keys(FEO.ranks);
  const ranks = proficienciesFor(category).map((key) => order.indexOf(proficiencies?.[key]?.rank));
  return order[Math.max(...ranks, 0)];
}

/* -------------------------------------------- */

/**
 * The Special Qualities of a target that a weapon is effective against: those named in the weapon's Effect.
 * @param {string} [effect]       The weapon's Effect
 * @param {string} [qualities]    The target's Special Qualities, as free text
 * @returns {string[]}
 */
export function effectiveAgainst(effect, qualities) {
  if ( !effect || !qualities ) return [];
  const listed = qualities.split(/[,;/&\n]|\band\b/i).map((quality) => quality.trim()).filter((quality) => {
    return quality && !/^(none|n\/?a|-+)$/i.test(quality);
  });
  const names = (text, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(text);
  };
  const found = new Map();
  for ( const quality of [...FEO.specialQualities, ...listed] ) {
    const key = quality.toLowerCase();
    if ( !found.has(key) && names(qualities, quality) && names(effect, quality) ) found.set(key, quality);
  }
  return Array.from(found.values());
}

/* -------------------------------------------- */

/**
 * Does a weapon backfire, as Devil weapons do? Its Effect then gives a chance, "(31-LUK)%", of damaging the
 * wielder instead of the target.
 * @param {string} [effect]     The weapon's Effect
 * @returns {number|null}       What the wielder's LUK is taken from for the chance, or null for other weapons
 */
export function backfires(effect) {
  const match = String(effect ?? "").match(/\(\s*(\d+)\s*[-−–]\s*LUK\s*\)\s*%[^.,;]*damaging\s+(?:the\s+)?wielder/i);
  return match ? Number(match[1]) : null;
}

/* -------------------------------------------- */

/**
 * The stat a target resists a weapon with. Tomes and anything that adds Magic to its Might are resisted with
 * RES, even a tome that has been made to use Strength; everything else is resisted with DEF.
 * @param {ExchangeWeapon} weapon
 * @returns {"def"|"res"}
 */
export function defenceAgainst(weapon) {
  return (FEO.weaponCategories[weapon.category]?.magic || (weapon.damageStat === "mag")) ? "res" : "def";
}

/* -------------------------------------------- */

/**
 * The conditions a weapon inflicts as its wielder's skills make them: a chance below 100% raised by what the
 * skills add to that condition's chances, and turns added to those they make last longer.
 * @param {import("./conditions.mjs").Infliction[]} list
 * @param {import("./conditions.mjs").ConditionBends|null} [bends]
 * @returns {import("./conditions.mjs").Infliction[]}
 */
export function inflictsWith(list, bends = null) {
  if ( !bends ) return list;
  return list.map((entry) => {
    const bonus = (entry.chance < 100) ? (bends.inflictChance[entry.id] ?? 0) : 0;
    const more = bends.inflictTurns[entry.id] ?? 0;
    if ( !bonus && !more ) return entry;
    return { ...entry, chance: clamp(entry.chance + bonus, 0, 100), ...(more ? { more } : {}) };
  });
}

/* -------------------------------------------- */
/*  Durability and Weapon Experience            */
/* -------------------------------------------- */

/**
 * Is a weapon out of uses? A weapon with no maximum never wears out.
 * @param {ExchangeWeapon} weapon
 * @returns {boolean}
 */
export function isBroken(weapon) {
  return (weapon.uses?.max > 0) && (weapon.uses.value <= 0);
}

/* -------------------------------------------- */

/**
 * Does an attack cost the weapon a use?
 * Melee and thrown weapons only wear on a hit. Bows, crossbows, bolts and tomes wear on every attack. A staff
 * wears on every attack too, except when it is swung at an adjacent foe.
 * @param {ExchangeWeapon} weapon
 * @param {boolean} hit           Did the attack land?
 * @param {number} distance       Tiles between attacker and target
 * @returns {boolean}
 */
export function spendsUse(weapon, hit, distance) {
  if ( !(weapon.uses?.max > 0) ) return false;
  if ( weapon.category === "staff" ) return distance > 1;
  const category = FEO.weaponCategories[weapon.category];
  return (category?.ranged || category?.magic) ? true : hit;
}

/* -------------------------------------------- */

/**
 * Add weapon experience to a proficiency, advancing its rank each time the amount needed is reached.
 * What is left over carries into the new rank. The highest rank earns nothing further.
 * @param {{rank: string, wexp: number}} proficiency
 * @param {number} amount
 * @param {object} [options]
 * @param {string|null} [options.ceiling]   The rank at which weapon experience stops counting. With Weapon
 *                                          Levels that is the first rank that counts as proficient: a training
 *                                          weapon still takes a unit there, and nothing is earned after it
 * @returns {{rank: string, wexp: number, rankUps: number}}
 */
export function gainWexp(proficiency, amount, { ceiling = FEO.optional.weaponLevel.enabled ? Object.keys(FEO.ranks)[1] : null } = {}) {
  const order = Object.keys(FEO.ranks);
  let rank = proficiency.rank;
  let wexp = proficiency.wexp;
  let rankUps = 0;
  const done = (at) => (FEO.wexpToNext[at] == null) || ((ceiling !== null) && (order.indexOf(at) >= order.indexOf(ceiling)));
  if ( done(rank) ) return { rank, wexp, rankUps };
  wexp += Math.max(amount ?? 0, 0);
  while ( !done(rank) && (wexp >= FEO.wexpToNext[rank]) ) {
    wexp -= FEO.wexpToNext[rank];
    rank = order[order.indexOf(rank) + 1];
    rankUps++;
  }
  if ( done(rank) ) wexp = 0;
  return { rank, wexp, rankUps };
}

/* -------------------------------------------- */

/**
 * The proficiencies that earn weapon experience from a weapon. An Anima tome trains every anima proficiency
 * the unit has a rank in.
 * @param {Record<string, {rank: string, wexp: number}>} [proficiencies]
 * @param {string} category
 * @returns {string[]}
 */
export function wexpProficiencies(proficiencies, category) {
  const keys = proficienciesFor(category).filter((key) => proficiencies?.[key]);
  if ( category !== "anima" ) return keys;
  return keys.filter((key) => proficiencies[key].rank !== "F");
}

/* -------------------------------------------- */
/*  The Exchange                                */
/* -------------------------------------------- */

/**
 * The numbers of one strike. An attack on a unit that is down always hits.
 * @param {object} base       The numbers both units bring to every strike
 * @param {object} context    What kind of attack it is and the conditions on both units
 * @returns {{hit: number, crit: number, damage: number, notes: object[]}}
 */
function numbersFor(base, context) {
  const numbers = strikeNumbers(base, context);
  if ( context.autoHit ) numbers.hit = 100;
  if ( context.autoCrit ) numbers.crit = 100;
  if ( context.noCrit ) numbers.crit = 0;
  if ( (context.damageScale ?? 1) !== 1 ) numbers.damage = Math.floor(numbers.damage * context.damageScale);
  return numbers;
}

/* -------------------------------------------- */

/**
 * Work out an exchange before any dice are rolled: who attacks, in what order, and with what chances.
 * @param {Combatant} initiator
 * @param {Combatant} defender
 * @param {object} [options]
 * @param {number} [options.distance=1]   Tiles between the two units
 * @param {{initiator?: object, defender?: object}|null} [options.ground]
 *                                        What each unit stands on: the `def`, `res` and `dodge` its tile
 *                                        gives it and the `elevation` it stands at (see rules/terrain.mjs).
 *                                        Without it the fight is on open, level ground
 * @returns {ExchangePlan}
 */
export function planExchange(initiator, defender, { distance = 1, ground = null } = {}) {
  const tiles = Math.max(Math.floor(Number(distance)) || 1, 1);
  const heights = { initiator: ground?.initiator?.elevation ?? 0, defender: ground?.defender?.elevation ?? 0 };

  // Skills first change what each unit brings to the fight; those that ask who can counter-attack are read
  // once that is settled below
  const skills = prepareSkills(initiator, defender, tiles, {
    initiator: initiator.weapon ? parseRange(initiator.weapon.range, initiator.stats) : null,
    defender: defender.weapon ? parseRange(defender.weapon.range, defender.stats) : null
  });
  let units = skills ? skills.units : { initiator, defender };
  const rules = (key) => units[key].fx?.rules ?? new Set();
  const either = (rule) => rules("initiator").has(rule) || rules("defender").has(rule);

  // The weapon triangle goes by the weapons in hand, with the size of the bonus set by the advantaged unit.
  // Skills can cancel it, turn it around, or hand their unit the advantage whatever the weapons
  let advantage = triangleAdvantage(initiator.weapon?.category, defender.weapon?.category);
  if ( rules("initiator").has("reverseTriangle") !== rules("defender").has("reverseTriangle") ) advantage = -advantage;
  const always = (rules("initiator").has("alwaysAdvantage") ? 1 : 0) - (rules("defender").has("alwaysAdvantage") ? 1 : 0);
  if ( always && initiator.weapon && defender.weapon ) advantage = always;
  if ( either("noTriangle") ) advantage = 0;
  const advantaged = advantage > 0 ? "initiator" : advantage < 0 ? "defender" : null;
  // With Weapon Levels the rank a unit counts as having is the one its Weapon Level counts as
  const counted = (unit, held) => {
    const order = Object.keys(FEO.ranks);
    return (unit.wlvRank && (order.indexOf(held) > 0) && (held !== order.at(-1))) ? unit.wlvRank : held;
  };
  let rank = advantaged ? counted(units[advantaged], weaponRank(units[advantaged].proficiencies, units[advantaged].weapon.category)) : null;

  // A skill may have its unit's highest rank in any proficiency set the size of the bonus
  if ( advantaged && rules(advantaged).has("bestRankTriangle") ) {
    const order = Object.keys(FEO.ranks);
    for ( const proficiency of Object.values(units[advantaged].proficiencies ?? {}) ) {
      const held = counted(units[advantaged], proficiency.rank);
      if ( order.indexOf(held) > order.indexOf(rank ?? order[0]) ) rank = held;
    }
  }
  const bonus = rank ? FEO.triangleBonus[rank] : { hit: 0, damage: 0 };
  const conditions = { initiator: initiator.conditions ?? {}, defender: defender.conditions ?? {} };

  // Why a side makes no attack at all
  const unable = (unit) => {
    if ( unit.hp <= 0 ) return "down";
    if ( !unit.weapon ) return "unarmed";
    if ( isBroken(unit.weapon) ) return "broken";
    return null;
  };
  const blocked = { initiator: unable(initiator), defender: null };

  // A Staggered unit cannot act: it begins no fight and answers none, and takes more from every hit
  const staggered = { initiator: isStaggered(initiator.stagger), defender: isStaggered(defender.stagger) };
  if ( !blocked.initiator && staggered.initiator ) blocked.initiator = "staggered";
  if ( !blocked.initiator && (defender.hp <= 0) && !defender.incapacitated ) blocked.initiator = "targetDown";
  if ( !blocked.initiator && !reaches(initiator.weapon, tiles, initiator.stats, units.initiator.fx?.ranges) ) blocked.initiator = "outOfRange";
  // Melee attacks cannot be made against targets at different elevations
  if ( !blocked.initiator && heightBlocks(tiles, heights.initiator, heights.defender) ) blocked.initiator = "elevation";
  if ( !blocked.initiator && rules("initiator").has("noCombat") ) blocked.initiator = "skill";

  // A Combat Art is performed from where its kind of weapon strikes, or from the Range it names
  const artReach = initiator.art?.reach ?? null;
  if ( !blocked.initiator && artReach && ((tiles < artReach.min) || (tiles > artReach.max)) ) blocked.initiator = "artRange";
  if ( blocked.initiator ) blocked.defender = "noCombat";
  else {
    blocked.defender = unable(defender);
    if ( !blocked.defender && (defender.noCounter || heldBy(conditions.defender)) ) blocked.defender = "condition";
    if ( !blocked.defender && blocksWeapon(conditions.defender, defender.weapon) ) blocked.defender = "silenced";
    if ( !blocked.defender && (rules("defender").has("noCombat") || rules("initiator").has("foeNoCounter")) ) {
      blocked.defender = "skill";
    }
    // A unit that suffers from Break makes no counter-attack
    if ( !blocked.defender && defender.break && breakInUse() ) blocked.defender = "break";
    if ( !blocked.defender && staggered.defender ) blocked.defender = "staggered";
    // Skills may change how far the defender's weapon reaches, make the attack a Midrange one, or let the
    // defender answer a Midrange attack with a weapon that only reaches 1 tile
    const answer = {
      changes: units.defender.fx?.ranges,
      midrange: rules("initiator").has("midrange"),
      answers: rules("defender").has("counterMidrange")
    };
    if ( !blocked.defender && !canCounter(defender.weapon, initiator.weapon, tiles, units.defender.stats, answer) ) {
      // Some skills let a unit answer from a distance its weapon does not reach
      const reach = (tiles === 1) ? rules("defender").has("closeCounter") : rules("defender").has("distantCounter");
      const adjacent = (tiles === 1) && reaches(defender.weapon, tiles, units.defender.stats, answer.changes);
      if ( !reach ) blocked.defender = adjacent ? "midrange" : "outOfRange";
    }
  }
  if ( skills ) units = skills.settle({ initiator: !blocked.initiator, defender: !blocked.defender });

  const side = (key) => {
    const unit = units[key];
    const foe = units[other(key)];
    const weapon = unit.weapon;
    const triangle = (key === "initiator" ? advantage : -advantage) || 0;
    const fx = unit.fx;
    const foeFx = foe.fx;

    // Effective damage: from the weapon's Effect, and from skills that make their unit's attacks effective
    let effective = weapon ? effectiveAgainst(weapon.effect, foe.qualities) : [];
    if ( weapon && fx?.effective.length ) {
      const extra = effectiveAgainst(fx.effective.join(", "), foe.qualities);
      effective = [...effective, ...extra.filter((quality) => !effective.includes(quality))];
    }
    if ( foeFx?.rules.has("noEffective") ) effective = [];
    // A Combat Art the initiator performs (see `arts.mjs`). Unless its effects persist through the fight, what
    // it adds to Might, Hit and Critical is for its unit's first attack alone, and what it adds to Dodge and
    // Critical Avoid counts against the first attack the foe makes. An Art that is effective against the foe
    // multiplies the weapon's Might as an effective weapon does, for as long as the Art lasts
    const art = ((key === "initiator") && !blocked[key]) ? (unit.art ?? null) : null;
    const foeArt = ((key === "defender") && !blocked.initiator) ? (foe.art ?? null) : null;
    const artful = (art && weapon && art.effective.length && !foeFx?.rules.has("noEffective"))
      ? effectiveAgainst(art.effective.join(", "), foe.qualities).filter((quality) => !effective.includes(quality))
      : [];
    if ( art?.persist ) effective = [...effective, ...artful];
    const times = (list) => list.length
      ? (fx?.effectiveMultiplier ?? FEO.effectiveMight[weapon.category] ?? FEO.effectiveMight.default)
      : 1;
    const mightMultiplier = times(effective);
    const defence = weapon ? defenceAgainst(weapon) : "def";
    const wielded = (weapon?.might ?? 0) + (fx?.might ?? 0);
    const power = Math.max(
      unit.combat.damage + (wielded * (mightMultiplier - 1)) + (triangle * bonus.damage)
        + (art?.persist ? art.might * mightMultiplier : 0),
      0
    );
    const artTimes = times([...effective, ...artful]);
    const opener = {
      accuracy: (art && !art.persist) ? art.hit : 0,
      critical: (art && !art.persist) ? art.critical : 0,
      damage: (art && !art.persist) ? (art.might * artTimes) + (wielded * (artTimes - mightMultiplier)) : 0,
      dodge: (foeArt && !foeArt.persist) ? foeArt.dodge : 0,
      critAvoid: (foeArt && !foeArt.persist) ? foeArt.critAvoid : 0
    };

    // A follow-up goes by Attack Speed, unless a skill grants one or rules one out. A unit that performs a
    // Combat Art makes none where the world has it make that one attack, or where the Art says so
    let doubles = followsUp(unit.combat.attackSpeed, foe.combat.attackSpeed, FEO.doubleThreshold, (unit.haste ?? 0) + (fx?.haste ?? 0));
    const barred = !!(fx?.rules.has("noFollowUp") || foeFx?.rules.has("noFollowUp") || foeFx?.rules.has("foeNoFollowUp"));
    const sure = !!fx?.rules.has("sureFollowUp");
    if ( sure !== barred ) doubles = sure;
    if ( art?.noFollowUp ) doubles = false;

    // The numbers every strike starts from, and what the conditions on both units make of the first one
    const resisted = Math.floor((((foe.stats[defence] ?? 0) * (100 - (fx?.ignoreDefence ?? 0))) / 100) + 1e-9);

    // The ground: the tile the foe stands on adds to its Dodge and to the stat it resists with, and a ranged
    // attack gains from higher ground and loses from lower
    const footing = ground?.[other(key)] ?? null;
    const edge = heightEdge(tiles, heights[key], heights[other(key)]);
    const cover = footing?.[defence] ?? 0;

    // Critical a unit gains for its own chance of being critically hit, up to what its skills allow: none
    // against a foe that makes no attack or no critical hit
    const spared = !!blocked[other(key)] || !!foeFx?.rules.has("noCrit") || !!fx?.rules.has("foeNoCrit");
    const exposed = spared ? 0 : clamp(foe.combat.critical - unit.combat.critAvoid, 0, 100);
    const mirrored = Math.min(exposed, fx?.mirrorCrit ?? 0);
    const base = {
      accuracy: unit.combat.accuracy + (triangle * bonus.hit) + edge.hit + (art?.persist ? art.hit : 0),
      dodge: foe.combat.dodge + (footing?.dodge ?? 0) + (foeArt?.persist ? foeArt.dodge : 0),
      critical: unit.combat.critical + mirrored + (art?.persist ? art.critical : 0),
      critAvoid: foe.combat.critAvoid + (foeArt?.persist ? foeArt.critAvoid : 0),
      damage: power - resisted - cover - (foe.endurance ?? 0) + (foeFx?.taken ?? 0) + edge.damage
    };

    // The numbers of this side's first attack alone, where a Combat Art changes them
    const opens = Object.values(opener).some(Boolean);
    const opening = opens ? Object.fromEntries(Object.entries(base).map(([name, value]) => [name, value + opener[name]])) : base;
    const strike = {
      initiating: key === "initiator",
      distance: tiles,
      physical: defence === "def",
      element: attackElement(weapon),
      noDodge: !!foe.noDodge && !foe.conditions,
      autoHit: !!foe.incapacitated || !!fx?.rules.has("sureHit"),
      autoCrit: !!fx?.rules.has("sureCrit"),
      noCrit: !!fx?.rules.has("noCrit") || !!foeFx?.rules.has("foeNoCrit"),
      damageScale: (fx?.damageMultiplier ?? 1) * (foeFx?.takenMultiplier ?? 1) * staggerTimes(foe.stagger)
    };
    // An Art that strikes more than once does not add to what the weapon or a skill already gives, and
    // unless it persists only its unit's first attack strikes that often
    const usual = blocked[key] ? 1 : Math.max(weaponStrikes(weapon?.effect, strike), fx?.strikes ?? 1);
    const strikes = art?.persist ? Math.max(usual, art.strikes) : usual;
    const openStrikes = art ? Math.max(strikes, art.strikes) : strikes;
    const mine = conditions[key];
    const theirs = conditions[other(key)];

    // Attacks that may backfire: with a Devil weapon, under a skill of the unit or of its foe that says so,
    // or under the condition that does. One chance however many of these there are, by the unit's own LUK
    let backfire = null;
    const devil = weapon ? backfires(weapon.effect) : null;
    const cursed = !!fx?.rules.has("backfire") || !!foeFx?.rules.has("foeBackfire") || (FEO.backfire.condition in mine);
    if ( !blocked[key] && ((devil !== null) || cursed) ) {
      const chance = clamp((devil ?? FEO.backfire.base) - (unit.stats[FEO.backfire.stat] ?? 0), 0, 100);
      if ( chance > 0 ) backfire = {
        chance,
        both: (devil !== null) && !!fx?.rules.has("backfireBoth"),
        halved: !!fx?.rules.has("halfBackfire")
      };
    }
    const first = numbersFor(opening, { ...strike, attacker: mine, target: theirs });
    const later = numbersFor(base, { ...strike, attacker: mine, target: endOnHit(theirs, strike).state });

    // Follow-up Critical Multiplier: a side that follows up has its Critical multiplied for that attack, before
    // the foe's Critical Avoid is taken off. Everything the attack counts as its unit's Critical is multiplied
    const fcm = (!blocked[key] && doubles) ? followUpTimes(unit.fcm) : 1;
    const follow = (fcm > 1)
      ? numbersFor(base, { ...strike, attacker: mine, target: endOnHit(theirs, strike).state, fcm })
      : null;

    // A foe that dodges every hit that would be fatal to it: the Hit of such an attack is held to a cap, and
    // it misses whatever is rolled
    const evaded = !blocked[key] && !!foeFx?.rules.has("dodgeFatal") && (foe.hp > 0) && (first.damage >= foe.hp);
    return {
      unit,
      blocked: blocked[key],
      breaks: (key === "initiator") && !blocked[key] && wouldBreak({ triangle, foe }),
      hit: evaded ? Math.min(first.hit, FEO.fatalDodge.hitCap) : first.hit,
      evaded,
      crit: first.crit,
      ...(follow ? { fcm, critFollow: follow.crit } : {}),
      damage: first.damage,
      damageLater: later.damage,
      base,
      strike,
      inflicts: weapon ? inflictsWith(inflictions(weapon.effect), fx?.bends) : [],
      notes: first.notes,
      warnings: restrictions(mine, weapon),
      attacks: blocked[key] ? 0 : openStrikes + (doubles ? strikes : 0),
      strikes,
      openStrikes,
      opener: opens ? opener : null,
      art,
      skills: fx?.applied ?? [],
      auras: fx?.auras ?? [],
      lasting: fx?.lasting ?? [],
      checks: fx?.checks ?? [],
      declared: blocked[key] ? [] : (fx?.declared ?? []),
      // A side that makes no attack has no use for what its attacks would set off, and a unit that is down
      // activates nothing
      chances: Object.fromEntries(PROC_TRIGGERS.map((on) => {
        const idle = OWN_ATTACKS.includes(on) ? !!blocked[key] : !(unit.hp > 0);
        return [on, idle ? [] : (fx?.chances?.[on] ?? [])];
      })),
      power,
      resisted,
      ground: { height: edge.height, hit: edge.hit, damage: edge.damage, dodge: footing?.dodge ?? 0, cover },
      doubles,
      triangle,
      triangleHit: triangle * bonus.hit,
      triangleDamage: triangle * bonus.damage,
      effective,
      mightMultiplier,
      defence,
      backfire
    };
  };
  const sides = { initiator: side("initiator"), defender: side("defender") };

  // The initiator attacks, the defender answers, then whoever is fast enough attacks again. A defender whose
  // skill lets it go first does. Each attack strikes as many times as the weapon or a skill makes it, and
  // attacks that skills add come after all the others, at the share of their damage the skill gives. Of them
  // all only the attack a side makes for being fast enough is a follow-up, with every strike of it
  const order = [];
  const scale = [];
  const followUps = [];
  const attack = (key, share = 1, strikes = sides[key].strikes, follow = false) => {
    for ( let n = 0; n < strikes; n++ ) {
      order.push(key);
      scale.push(share);
      followUps.push(follow);
    }
  };
  if ( !blocked.initiator ) {
    const first = !blocked.defender && rules("defender").has("first") && !rules("initiator").has("first");
    const opening = first ? ["defender", "initiator"] : ["initiator", "defender"];
    for ( const key of opening ) if ( !blocked[key] ) attack(key, 1, sides[key].openStrikes);
    for ( const key of ["initiator", "defender"] ) {
      if ( !blocked[key] && sides[key].doubles ) attack(key, 1, sides[key].strikes, (sides[key].fcm ?? 1) > 1);
    }
    for ( const key of ["initiator", "defender"] ) {
      if ( blocked[key] ) continue;
      for ( const extra of units[key].fx?.extraAttacks ?? [] ) {
        attack(key, extra.percent / 100, 1);
        sides[key].attacks += 1;
      }
    }
  }

  const plan = {
    distance: tiles,
    triangle: { advantage: advantaged, rank, hit: bonus.hit, damage: bonus.damage },
    order,
    ...sides
  };
  if ( scale.some((share) => share !== 1) ) plan.scale = scale;
  if ( followUps.some(Boolean) ) plan.followUps = followUps;
  return plan;
}

/* -------------------------------------------- */

/**
 * The most d100s rolling out a planned exchange can need: for every attack one to hit and one for a critical,
 * one more if the target has or may gain a condition that can burst, and one for each chance and each die
 * among the conditions the weapon inflicts. Skills with a chance to activate add one for each chance of the
 * attacker, one for each of the target when it is hit, one where a condition may turn into a worse one, and
 * all of an attack's rolls again for every attack a skill can add to it. A unit whose skills have a chance to
 * nullify conditions adds one for each of them and each condition that may be applied to it. An attack that a
 * unit dodges because its hit would be fatal may have rolled for its critical before it counts as a miss.
 * @param {ExchangePlan} plan
 * @returns {number}
 */
export function rollBudget(plan) {
  const bursts = (id) => !!conditionConfig(id)?.burst;
  const parts = (proc) => [proc, ...(proc.sequence ?? [])];

  // The chances a side has of nullifying a condition, each of which is rolled for
  const wards = (key) => (plan[key].unit.fx?.bends?.nullify ?? []).filter((ward) => (ward.percent > 0) && (ward.percent < 100)).length;
  const handsBack = (key) => (plan[key].chances?.afflicted ?? []).some((proc) => proc.returns > 0);
  const rolled = (list) => (list ?? []).filter((proc) => !proc.sure).length;
  const upgrades = (list) => list.reduce((count, proc) => {
    return count + parts(proc).reduce((sum, part) => sum + part.inflicts.filter((entry) => entry.upgrade).length, 0);
  }, 0);

  // The most one attack of a side can roll, apart from the chances rolled before it: when it lands, and when
  // it misses
  const strike = (key) => {
    const mine = plan[key].chances ?? {};
    const target = plan[other(key)];
    const inflicts = plan[key].inflicts ?? [];
    const landing = [...(mine.hit ?? []), ...(mine.crit ?? [])];

    // The target may hold a condition that can burst: from the start, from the attacker's weapon or skills, or
    // handed back by the attacker's skills when the target struck it
    const mayBurst = Object.keys(target.unit.conditions ?? {}).some(bursts)
      || inflicts.some((entry) => bursts(entry.id))
      || [...(mine.attack ?? []), ...landing].some((proc) => parts(proc).some((part) => {
        return part.inflicts.some((entry) => bursts(entry.id) || bursts(entry.upgrade?.id) || (entry.anyOf ?? []).some(bursts));
      }))
      || (mine.struck ?? []).some((proc) => proc.inflictsAttacker.some(bursts));

    let landed = 2 + rolled(landing) + upgrades(landing) + rolled(target.chances?.struck) + rolled(mine.kill) + (mayBurst ? 1 : 0)
      + (plan[key].backfire ? 1 : 0);
    for ( const entry of inflicts ) landed += (entry.chance < 100 ? 1 : 0) + (entry.dice ? 1 : 0);
    // A die for the turns a condition lasts, and one for each pick among several conditions or changes
    for ( const proc of [...(mine.attack ?? []), ...landing] ) {
      for ( const part of parts(proc) ) landed += part.inflicts.filter((entry) => entry.dice).length + part.inflicts.filter((entry) => entry.anyOf).length;
      landed += (proc.grants ?? []).filter((grant) => grant.pick).length;
    }

    // Conditions that may be applied to the target, and those its skills may give the attacker in return
    const given = inflicts.length + (mayBurst ? 1 : 0) + [...(mine.attack ?? []), ...landing].reduce((sum, proc) => {
      return sum + parts(proc).reduce((count, part) => count + part.inflicts.length, 0);
    }, 0);
    const back = (target.chances?.struck ?? []).reduce((sum, proc) => sum + proc.inflictsAttacker.length, 0)
      + (handsBack(other(key)) ? given : 0);
    landed += (given * wards(other(key))) + (back * wards(key));
    const dodged = target.unit.fx?.rules?.has("dodgeFatal") ? 2 : 1;
    return { landed, missed: dodged + rolled(mine.miss) + rolled(target.chances?.dodged) };
  };

  const fight = plan.order.reduce((total, key) => {
    const chances = plan[key].chances?.attack ?? [];
    const own = strike(key);

    // An attack that misses may be answered at once by an attack of the unit that dodged
    const target = plan[other(key)];
    const answers = target.blocked ? 0 : (target.chances?.dodged ?? []).filter((proc) => proc.attack).length;
    const back = strike(other(key));
    const most = Math.max(own.landed, own.missed + (answers * Math.max(back.landed, back.missed)));

    // An attack that skills turn into several rolls for each of them
    const attacks = 1 + chances.reduce((sum, proc) => sum + Math.max((proc.sequence?.length ?? 1) - 1, 0), 0);
    return total + rolled(chances) + upgrades(chances) + (most * attacks);
  }, 0);
  if ( !plan.order.length ) return fight;
  return fight + ["initiator", "defender"].reduce((sum, key) => {
    const given = (plan[key].chances?.after ?? []).reduce((count, proc) => count + proc.inflicts.length, 0);
    const warded = (given * wards(other(key))) + (handsBack(other(key)) ? given * wards(key) : 0);
    return sum + rolled(plan[key].chances?.start) + rolled(plan[key].chances?.after) + warded;
  }, 0);
}

/* -------------------------------------------- */

/**
 * Roll out a planned exchange.
 * Each attack rolls to hit, and a hit that can be critical rolls again for that. The exchange ends as soon as
 * either unit is at 0 HP, and a unit whose weapon runs out of uses makes no further attacks. A unit that was
 * already down when the exchange began takes every attack planned against it.
 * Conditions are followed strike by strike: one that ends when its unit is hit stops applying from the next
 * strike, one inflicted by a hit applies from the next strike, and a unit that gains a condition which stops
 * it from counter-attacking makes no further attacks. The stats each unit fights with stay as they were when
 * the exchange began. Where the world plays with Stagger, a unit whose Stagger bar is emptied makes no further
 * attacks either, and takes more from the very next hit on.
 * @param {ExchangePlan} plan
 * @param {() => number} d100   Returns a whole number from 1 to 100
 * @returns {ExchangeResult}
 */
export function resolveExchange(plan, d100) {
  const state = {};
  for ( const key of ["initiator", "defender"] ) {
    const { hp, weapon, conditions } = plan[key].unit;
    state[key] = {
      hp,
      uses: weapon ? weapon.uses.value : null,
      usesSpent: 0,
      broke: false,
      wexp: 0,
      conditions: { ...(conditions ?? {}) },
      healed: 0,
      held: false,
      break: false,
      staggered: false,
      next: { hit: 0, damage: 0, critical: 0 },
      landed: false,
      struck: false,
      swung: false,

      // What the damage of the hits it takes is multiplied by for the rest of the fight, for what was
      // granted to it during the fight and counts at once
      takenNow: 1,
      nowBy: new Set(),
      unharmed: false,

      // The skills that take effect by themselves and count their uses, once for each time one did
      counted: []
    };
  }

  // How each side's skills bend the rules of conditions, whether a side takes no damage from skills outside
  // of an attack, and a penalty a foe's skill puts on a side's numbers, less what its skills take off
  const bendsOf = (key) => plan[key].unit.fx?.bends ?? null;
  const unharmed = (key) => !!plan[key].unit.fx?.rules?.has("noSkillDamage") || state[key].unharmed;
  const eased = (to, amount) => {
    const relief = bendsOf(to)?.debuffs;
    if ( !relief || !(amount < 0) ) return amount;
    return relief.negate ? 0 : Math.min(amount + relief.combat, 0);
  };

  const attacks = [];
  let shifted = false;
  const lose = (unit, hp, damage) => {
    const staying = unit.resilience;
    return Number.isFinite(staying) ? takeHit(hp, damage, staying).hp : Math.max(hp - damage, 0);
  };
  const roll = (proc, by) => {
    const rolled = d100();
    return { skill: proc.skill, on: proc.on, by, roll: rolled, chance: proc.chance, success: rolled <= proc.chance };
  };

  // Stagger: the bar of the unit that did not begin the fight, which the HP it loses comes off, whatever took
  // it. The unit that began the fight takes no Stagger damage in it. A unit whose bar is emptied is Staggered
  // at once: it makes no further attack, and everything it takes from here on is multiplied
  const bars = (staggerInUse() && plan.defender.unit.stagger) ? { defender: { ...plan.defender.unit.stagger } } : {};
  const weak = (key) => staggerTimes(bars[key]);
  const jolt = (key, lost) => {
    if ( !bars[key] ) return false;
    const after = staggerHit(bars[key], lost, { standing: state[key].hp > 0 });
    bars[key] = { value: after.value, max: after.max, turns: after.turns };
    if ( !after.staggered ) return false;
    state[key].staggered = true;
    state[key].takenNow *= FEO.optional.stagger.taken;
    shifted = true;
    return true;
  };

  // Does a skill take effect now that its moment has come? One that is sure does without a roll, and one that
  // only has its moment once in a fight has had it after the first time
  const spent = new Set();
  const fire = (proc, by, into) => {
    if ( proc.once ) {
      if ( spent.has(proc) ) return false;
      spent.add(proc);
    }

    // A skill that counts its own uses takes effect no more often than it has uses left
    const same = (entry) => (entry.id ?? entry.name) === (proc.uses.id ?? proc.uses.name);
    if ( proc.uses && (proc.uses.left !== null) && (state[by].counted.filter(same).length >= proc.uses.left) ) return false;
    let success = true;
    if ( proc.sure ) into.push({ skill: proc.skill, on: proc.on, by, roll: null, chance: 100, success: true, sure: true });
    else {
      const rolled = roll(proc, by);
      into.push(rolled);
      success = rolled.success;
    }
    if ( success && proc.uses ) state[by].counted.push({ id: proc.uses.id ?? undefined, name: proc.uses.name });
    return success;
  };

  // What the system only announces, once for each skill of each side
  const reminders = [];

  // Gold a skill earns its unit for defeating the foe
  const earned = [];

  // Points a skill gives its unit's Shift Gauge
  const charged = [];

  // Changes that last a while which a skill grants as it takes effect: to its unit, to the foe if it still
  // stands, or to the units around. The initiator is in its own turn, which counts for how long they last.
  // Where the units around cannot be seen the skill is announced instead
  // `part` gives only what is for the skill's own side ("own") or for its foe's ("foe"); `dealt` is the damage
  // of the hit that grants it, for a change that is read from it
  const granted = [];
  const foeSide = (grant) => (grant.to === "foe") || (grant.around === "foe");
  const give = (proc, by, { part = null, dealt = null } = {}) => {
    const giver = plan[by].unit;
    for ( let grant of proc.grants ?? [] ) {
      if ( part && ((part === "foe") !== foeSide(grant)) ) continue;

      // One of several changes, picked by a die
      if ( grant.pick?.length ) {
        const { pick, ...rest } = grant;
        const count = pick.length;
        grant = { ...rest, ...pick[Math.min(Math.floor(((d100() - 1) * count) / 100), count - 1)] };
      }

      // A change read from the damage of the hit: one that hit made nothing of is not granted
      if ( readsDealt(grant.effects) ) {
        if ( !(dealt > 0) ) continue;
        grant = { ...grant, effects: resolveDealt(grant.effects, dealt) };
      }
      const about = { skill: proc.source ?? proc.skill, giver: giver.uuid ?? "", giverInTurn: by === "initiator" };
      if ( grant.reach ) {
        const found = (grant.around === "foe")
          ? unitsNearFoe(giver.near ?? null, plan[other(by)].unit.near ?? null, grant.reach)
          : unitsNear(giver.near ?? null, grant.reach);
        if ( !found ) {
          if ( !reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) reminders.push({ skill: proc.skill, by });
          continue;
        }
        for ( const unit of found.filter((entry) => (entry.hp ?? 1) > 0) ) {
          granted.push({ by, to: null, unit: unit.id, name: unit.name, change: buildChange(grant, { ...about, from: giver.name ?? "" }) });
        }
        continue;
      }
      const to = (grant.to === "foe") ? other(by) : by;
      if ( state[to].hp <= 0 ) continue;

      // A unit that negates what would be put on it is given nothing by its foe
      if ( (to !== by) && bendsOf(to)?.debuffs.negate ) continue;

      // What it adds to the damage its unit takes may count at once, for the rest of this fight
      const called = `${grant.name ?? proc.source ?? proc.skill}|${by}`;
      if ( grant.now && !state[to].nowBy.has(called) ) {
        state[to].nowBy.add(called);
        for ( const effect of grant.effects ?? [] ) {
          if ( effect.takenPercent ) state[to].takenNow *= Math.max(1 + (effect.takenPercent / 100), 0);
          if ( effect.rules?.includes("noSkillDamage") ) state[to].unharmed = true;
          if ( effect.calc?.dodgeBy === "none" ) state[to].dodgeless = true;
        }
        shifted = true;
      }

      // What an aura handed this unit comes from the unit that has the skill
      const own = (to === by) && !proc.giver;
      granted.push({
        by,
        to,
        unit: null,
        name: plan[to].unit.name ?? "",
        change: buildChange(grant, { ...about, from: proc.giver || (giver.name ?? ""), own, carrierInTurn: to === "initiator" })
      });
    }
  };
  const remind = (proc, by, about = {}) => {
    give(proc, by, about);
    if ( !proc.remind || ((proc.remind === "foe") && (state[other(by)].hp <= 0)) ) return;
    if ( !reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) reminders.push({ skill: proc.skill, by });
  };

  // A condition a skill gives a unit outside of the hit itself. What guards the unit may nullify it; `keep`
  // is for one handed back for a few turns, which never cuts short what the unit already suffers
  const afflict = (to, id, { turns, more = 0, keep = false } = {}) => {
    const config = conditionConfig(id);
    const target = state[to];
    if ( !config || config.combatOnly || (target.hp <= 0) ) return null;
    const warded = wardOff(bendsOf(to)?.nullify, id, d100);
    if ( warded.at(-1)?.success ) return { id, success: false, warded };
    const tried = warded.length ? { warded } : {};
    const has = target.conditions[id];
    if ( keep && !config.stacks && ((has ?? -1) >= turns) ) return { id, turns: has, previous: has, stacked: false, ...tried };
    const amount = ((turns !== undefined) || more) ? (turns ?? config.turns) + more : undefined;
    const applied = applyCondition(target.conditions, id, { turns: amount });
    target.conditions = applied.state;
    if ( config.noCounter ) target.held = true;
    shifted = true;
    return { id, turns: applied.turns, previous: applied.previous, stacked: applied.stacked, ...tried };
  };

  // One side has given the other a condition: the skills of the giver that wait for that take effect, and
  // those of the unit that suffers it may hand it back. What is handed back sets off nothing further.
  // `record` is what the card reads the conditions handed back from
  const passOn = (by, inflicted, into, record) => {
    const to = other(by);
    for ( const proc of plan[by].chances?.inflict ?? [] ) {
      if ( proc.conditions && !proc.conditions.includes(inflicted.id) ) continue;
      if ( !fire(proc, by, into) ) continue;

      // A change that lasts as long as the condition does, counted from the afflicted unit's next turn
      const turns = Math.max(inflicted.turns ?? 1, 1);
      const grants = (proc.grants ?? []).map((grant) => (grant.turns === "condition") ? { ...grant, turns, next: true } : grant);
      remind({ ...proc, grants }, by);
    }
    for ( const proc of (state[to].hp > 0) ? (plan[to].chances?.afflicted ?? []) : [] ) {
      if ( proc.conditions && !proc.conditions.includes(inflicted.id) ) continue;
      if ( !fire(proc, to, into) ) continue;
      remind(proc, to);
      if ( !(proc.returns > 0) ) continue;
      const back = afflict(by, inflicted.id, { turns: proc.returns, keep: true });
      if ( back ) (record.returned ??= []).push({ ...back, skill: proc.skill });
    }
  };

  // Damage a skill deals to the foe of its unit outside of an attack
  const harm = (proc, by, into) => {
    const to = other(by);
    const target = state[to];
    if ( !(proc.retaliate > 0) || (target.hp <= 0) || unharmed(to) ) return;
    const before = target.hp;
    const amount = proc.retaliate * weak(to);
    target.hp = proc.nonlethal ? Math.max(before - amount, 1) : lose(plan[to].unit, before, amount);
    into.push({ skill: proc.skill, by, to, amount: proc.nonlethal ? before - target.hp : amount });
    jolt(to, before - target.hp);
  };

  // What a skill sets aside for its unit's next attack; `margin` is by how much the attack it dodged missed
  const gain = (proc, by, margin = null) => {
    const bonus = (proc.near && (margin !== null) && (margin <= proc.near.within)) ? proc.near.next : proc.next;
    for ( const [stat, amount] of Object.entries(bonus) ) state[by].next[stat] = (state[by].next[stat] ?? 0) + amount;
  };

  // Chances to activate as the fight begins change a side's numbers for all of it
  const boost = { initiator: { hit: 0, damage: 0, critical: 0, dodge: 0 }, defender: { hit: 0, damage: 0, critical: 0, dodge: 0 } };
  const opening = [];
  if ( plan.order.length ) {
    for ( const key of ["initiator", "defender"] ) {
      for ( const proc of plan[key].chances?.start ?? [] ) {
        if ( !fire(proc, key, opening) ) continue;
        remind(proc, key);
        shifted = true;
        for ( const [stat, amount] of Object.entries(proc.combat) ) boost[key][stat] = (boost[key][stat] ?? 0) + amount;
        for ( const [stat, amount] of Object.entries(proc.foeCombat) ) boost[other(key)][stat] = (boost[other(key)][stat] ?? 0) + eased(other(key), amount);
        boost[key].damage += proc.damage;
        if ( proc.freeUses ) state[key].freeUses = true;

        // HP the skill restores to its unit before the first attack
        const restored = Math.max(Math.min(proc.recover, (plan[key].unit.hpMax ?? Infinity) - state[key].hp), 0);
        state[key].hp += restored;
        state[key].healed += restored;
      }
    }
  }

  // Every attack that is planned. A skill that activates can turn one into several, which join the queue.
  // `added` names the skill that added an attack, and `groups` the runs of attacks that share one weapon use.
  // `follow` marks a follow-up attack whose Critical is multiplied, and the attacks a skill turns it into
  const queue = plan.order.map((key, index) => {
    return { key, share: plan.scale?.[index] ?? 1, part: null, added: null, groups: [], follow: !!plan.followUps?.[index] };
  });
  for ( let index = 0; index < queue.length; index++ ) {
    const entry = queue[index];
    const key = entry.key;
    const side = plan[key];
    const mine = state[key];
    const foe = state[other(key)];
    if ( (mine.hp <= 0) || ((foe.hp <= 0) && !plan[other(key)].unit.incapacitated) ) break;

    // A weapon that broke makes no further attack, unless the attack belongs to a run its last use paid for.
    // Neither does a unit that a condition holds, or that has come to suffer from Break or to be Staggered
    const paid = entry.groups.some((group) => group.spent);
    if ( (mine.broke && !paid) || mine.held || mine.break || mine.staggered ) continue;
    const weapon = side.unit.weapon;
    const procs = [];

    // This side's chances to activate on an attack. An attack a skill added rolls none of its own
    // What such a skill grants its own side comes at once; what it grants its foe waits for the attack to land
    const parts = entry.part ? [entry.part] : [];
    const fired = [];
    if ( !entry.added && side.base ) {
      // The attacks a skill adds keep the share of the attack they came from, as it was planned
      const planned = entry.share;
      let next = index + 1;
      for ( const proc of side.chances?.attack ?? [] ) {
        if ( !fire(proc, key, procs) ) continue;
        give(proc, key, { part: "own" });
        fired.push(proc);
        if ( !proc.sequence ) {
          parts.push(proc);
          continue;
        }
        const [first, ...rest] = proc.sequence;
        const group = proc.oneUse ? { spent: false } : null;
        parts.push(first);
        if ( first.share !== null ) entry.share *= first.share;
        if ( group ) entry.groups.push(group);
        queue.splice(next, 0, ...rest.map((part) => {
          return { key, share: (part.share ?? 1) * planned, part, added: proc.skill, groups: group ? [group] : [], follow: entry.follow };
        }));
        next += rest.length;
      }
    }

    // The plan's numbers hold until something changes them: a skill that activated, or a strike that changed
    // somebody's conditions. After that the numbers are worked out again for this attack
    let numbers = side;
    let sure = false;

    // What earlier moments of the fight set aside for this side's next attack is spent on this one
    const pending = mine.next;
    mine.next = { hit: 0, damage: 0, critical: 0 };

    // What a Combat Art changes about this side's first attack alone: the plan's numbers are those of that
    // attack, and every later one is worked out without it
    const opens = !mine.swung;
    const opener = opens ? side.opener : null;
    mine.swung = true;

    // Follow-up Critical Multiplier: what this side's Critical is multiplied by for a follow-up attack, before
    // the foe's Critical Avoid is taken off. It changes the chance of a critical hit, not what one deals
    const fcm = entry.follow ? (side.fcm ?? 1) : 1;
    const changed = parts.length || Object.values(boost[key]).some(Boolean) || boost[other(key)].dodge
      || Object.values(pending).some(Boolean) || !!side.opener || (fcm !== 1);
    if ( side.base && (shifted || changed) ) {
      const base = { ...side.base };
      for ( const [name, amount] of Object.entries(opener ?? {}) ) base[name] += amount;
      base.accuracy += boost[key].hit + (pending.hit ?? 0);
      base.critical += boost[key].critical + (pending.critical ?? 0);
      base.damage += boost[key].damage + (pending.damage ?? 0);
      base.dodge += boost[other(key)].dodge;

      // A target that a skill has left no Dodge in this fight
      if ( foe.dodgeless ) base.dodge = 0;
      let scale = (side.strike.damageScale ?? 1) * foe.takenNow;
      let ignored = 0;
      for ( const part of parts ) {
        base.damage += part.damage + Math.floor(((side.power ?? 0) * part.damagePercent) / 100)
          + Math.floor(((Math.max(foe.hp, 0) * (part.foeHpPercent ?? 0)) / 100) + 1e-9);
        base.accuracy += part.hit;
        base.critical += part.critical;
        scale *= part.damageMultiplier;
        const kind = side.strike.physical ? "def" : "res";
        if ( part.ignore && (!part.ignore.stat || (part.ignore.stat === kind)) ) ignored = Math.max(ignored, part.ignore.percent);
        if ( part.sureHit === true ) sure = true;
        else if ( part.sureHit ) sure ||= part.sureHit;
      }

      // What is left of the target's defence is rounded down, as it is for a skill that always ignores a share
      const resisted = side.resisted ?? 0;
      base.damage += resisted - Math.floor(((resisted * (100 - ignored)) / 100) + 1e-9);
      numbers = numbersFor(base, { ...side.strike, damageScale: scale, attacker: mine.conditions, target: foe.conditions, fcm });
      if ( (sure === true) || ((sure === "ifAny") && (numbers.hit >= 1)) ) numbers.hit = 100;
    }

    // A target that dodges every hit that would be fatal to it: the Hit of an attack whose plain hit would be
    // is held to a cap, and the attack misses whatever is rolled; one that only a critical hit makes fatal
    // misses once that is rolled
    const critTimes = side.unit.fx?.critMultiplier ?? FEO.critMultiplier;
    const blow = (critical) => Math.floor((numbers.damage * (critical ? critTimes : 1) * entry.share) + 1e-9);
    const dodges = !!plan[other(key)].unit.fx?.rules?.has("dodgeFatal") && (foe.hp > 0);
    const fatal = dodges && (blow(false) >= foe.hp);
    const hitChance = fatal ? Math.min(numbers.hit, FEO.fatalDodge.hitCap) : numbers.hit;
    const hitRoll = d100();
    let hit = hitRoll <= hitChance;
    const critRoll = (hit && !fatal && (numbers.crit > 0)) ? d100() : null;
    let crit = (critRoll !== null) && (critRoll <= numbers.crit);
    const evaded = hit && dodges && (blow(crit) >= foe.hp);
    if ( evaded ) {
      hit = false;
      crit = false;
    }
    let damage = hit ? blow(crit) : 0;
    const hpBefore = foe.hp;

    // An attack that lands may backfire: its unit takes the damage it would have dealt, whatever its own
    // defence, and unless a skill says otherwise the target takes none and is not hit at all
    let backfire = null;
    if ( hit && side.backfire ) {
      const rolled = d100();
      backfire = { roll: rolled, chance: side.backfire.chance, success: rolled <= side.backfire.chance, damage: 0, both: false };
      if ( backfire.success ) {
        backfire.damage = side.backfire.halved ? Math.floor(damage / 2) : damage;
        backfire.both = side.backfire.both;
        if ( !backfire.both ) damage = 0;
      }
    }
    const lands = hit && (!backfire?.success || backfire.both);

    // What the attack sets off once it is known to land, to be critical, or to miss: for its own side, and
    // after a miss for the unit that dodged it
    const landing = [];
    const harms = [];
    let recovered = 0;
    if ( lands ) {
      mine.landed = true;
      for ( const proc of [...(side.chances?.hit ?? []), ...(crit ? (side.chances?.crit ?? []) : [])] ) {
        if ( proc.damaged && !(damage > 0) ) continue;
        if ( !fire(proc, key, procs) ) continue;
        landing.push(proc);
        gain(proc, key);

        // HP the hit restores to its unit, and what it does to the foe's numbers for the rest of the fight
        recovered += proc.recover;
        for ( const [stat, amount] of Object.entries(proc.foeCombat) ) {
          const less = eased(other(key), amount);
          if ( !less ) continue;
          boost[other(key)][stat] = (boost[other(key)][stat] ?? 0) + less;
          shifted = true;
        }

        // Points for the unit's Shift Gauge: a share of what the hit would have dealt had it not been critical
        const points = crit ? Math.floor(((blow(false) * proc.gaugeOfDamage) / 100) + 1e-9) : 0;
        if ( points > 0 ) charged.push({ skill: proc.skill, by: key, amount: points });
      }
    }
    else if ( !hit ) {
      for ( const proc of side.chances?.miss ?? [] ) {
        if ( proc.damaged && !(numbers.damage > 0) ) continue;
        if ( !fire(proc, key, procs) ) continue;
        harm(proc, key, harms);
        remind(proc, key);
      }
      for ( const proc of (hpBefore > 0) ? (plan[other(key)].chances?.dodged ?? []) : [] ) {
        if ( !fire(proc, other(key), procs) ) continue;
        harm(proc, other(key), harms);
        gain(proc, other(key), hitRoll - hitChance);
        remind(proc, other(key));

        // One more attack at once, if the unit can attack. An attack added for a dodge sets off no other
        if ( proc.attack && !entry.answer && !plan[other(key)].blocked ) {
          queue.splice(index + 1, 0, { key: other(key), share: 1, part: null, added: proc.skill, groups: [], answer: true });
        }
      }
    }

    // The target's chances to activate when it is hit. A skill that saves its unit from a fatal blow is read
    // last, once the others have lessened the hit, and only if the hit is still fatal
    let reflected = 0;
    let lent = 0;
    const returns = [];
    const answers = [];
    const taking = [];
    if ( lands && (hpBefore > 0) ) {
      const struck = plan[other(key)].chances?.struck ?? [];

      // Of the skills that save from a fatal blow, one that costs a use is read after those that cost none
      const saving = struck.filter((chance) => chance.survive);
      const savers = [...saving.filter((chance) => !chance.uses), ...saving.filter((chance) => chance.uses)];
      for ( const proc of [...struck.filter((chance) => !chance.survive), ...savers] ) {
        if ( proc.survive ) {
          if ( damage < foe.hp ) continue;

          // Halving a blow does nothing for a unit at 1 HP; being left at 1 HP hangs on the HP it had
          const target = plan[other(key)].unit;
          if ( (proc.survive === true) ? (foe.hp <= 1) : !hpHolds(proc.survive.hp, foe.hp, target.hpMax ?? target.hp) ) continue;
        }
        if ( proc.damaged && !(damage > 0) ) continue;
        if ( !fire(proc, other(key), procs) ) continue;
        if ( proc.survive ) {
          if ( proc.survive === true ) damage = Math.floor(damage / 2);
          if ( damage >= foe.hp ) damage = foe.hp - 1;
          remind(proc, other(key));
          continue;
        }

        // What the attacker takes in return goes by the hit as it stands before this skill lessens it
        const back = Math.floor(((damage * proc.reflect) / 100) + 1e-9) + proc.retaliate;
        if ( back > 0 ) returns.push({ amount: back, nonlethal: proc.nonlethal });
        if ( proc.negate ) damage = Math.floor(((damage * (100 - proc.negate)) / 100) + 1e-9);
        if ( proc.reduce ) damage = Math.max(damage - proc.reduce, 0);

        // A defence lent for this hit, where it is more than the unit's own: the hit is lessened by the
        // difference, counted once however many lend theirs, and as often as the hit counts its damage
        if ( proc.shield ) {
          const kind = side.defence ?? "def";
          const more = Math.max((proc.shield[kind] ?? 0) - (plan[other(key)].unit.stats?.[kind] ?? 0), 0);
          const extra = Math.max(more - lent, 0);
          lent = Math.max(lent, more);
          damage = Math.max(damage - Math.floor((extra * (crit ? critTimes : 1) * entry.share) + 1e-9), 0);
        }
        answers.push(...proc.inflictsAttacker);
        gain(proc, other(key));
        remind(proc, other(key));
        taking.push(proc);
      }
      foe.struck = true;
    }

    // A Combat Art that spares its foe leaves it with 1 HP where the blow would have been fatal
    if ( lands && side.art?.spare && (side.art.persist || opens) && (foe.hp > 0) && (damage >= foe.hp) ) damage = foe.hp - 1;

    // Damage past 0 HP is kept for a unit that can be Incapacitated; otherwise HP stops at 0
    foe.hp = lose(plan[other(key)].unit, foe.hp, damage);
    const kill = lands && (hpBefore > 0) && (foe.hp <= 0);
    if ( backfire?.success && (backfire.damage > 0) ) {
      const had = mine.hp;
      mine.hp = lose(side.unit, mine.hp, backfire.damage);
      jolt(key, had - mine.hp);
    }

    // Stagger: what the hit took comes off the bar of a unit that did not begin the fight
    const jolted = jolt(other(key), hpBefore - foe.hp);

    // A share of the damage of the hit, set aside for the next attack of the unit that took it
    const taken = Math.max(Math.min(hpBefore, damage), 0);

    // Break: a hit that deals damage, from the unit that began the fight with weapon triangle advantage, takes
    // the counter-attack from a foe that still stands, from here on
    if ( lands && side.breaks && (taken > 0) && (foe.hp > 0) ) foe.break = true;
    for ( const proc of taking ) {
      for ( const [stat, percent] of Object.entries(proc.nextOfDamage) ) {
        foe.next[stat] = (foe.next[stat] ?? 0) + Math.floor(((taken * percent) / 100) + 1e-9);
      }
    }

    // What landing the hit leaves for the table is said once it is known whether the foe still stands, and
    // what a skill that activated for this attack grants its foe is granted now that the attack has landed
    for ( const proc of landing ) remind(proc, key, { dealt: taken });
    if ( lands ) for ( const proc of fired ) remind(proc, key, { part: "foe", dealt: taken });

    // What defeating the foe sets off
    if ( kill ) {
      for ( const proc of side.chances?.kill ?? [] ) {
        if ( !fire(proc, key, procs) ) continue;
        recovered += proc.recover;
        if ( proc.gold > 0 ) earned.push({ skill: proc.skill, by: key, gold: proc.gold });
        remind(proc, key);
      }
    }

    // What the hit does to the target's conditions, and what they give back to the attacker
    let effects = null;
    if ( lands ) {
      const inflicts = [...(side.inflicts ?? [])];
      for ( const part of [...parts, ...landing] ) {
        for ( const infliction of part.inflicts ) {
          let id = infliction.id;

          // One of several conditions, picked by a die
          if ( infliction.anyOf?.length ) {
            const count = infliction.anyOf.length;
            id = infliction.anyOf[Math.min(Math.floor(((d100() - 1) * count) / 100), count - 1)];
          }
          if ( infliction.upgrade ) {
            const rolled = d100();
            const success = rolled <= infliction.upgrade.chance;
            procs.push({
              skill: part.skill,
              on: "upgrade",
              by: key,
              roll: rolled,
              chance: infliction.upgrade.chance,
              success,
              condition: infliction.upgrade.id
            });
            if ( success ) id = infliction.upgrade.id;
          }
          if ( !inflicts.some((listed) => (listed.id === id) && (listed.chance >= 100)) ) {
            const more = bendsOf(key)?.inflictTurns[id] ?? 0;
            const dice = infliction.dice ?? null;
            const set = (infliction.turns && (id === infliction.id)) ? { turns: infliction.turns } : {};
            inflicts.push(more ? { id, chance: 100, dice, otherwise: false, more, ...set } : { id, chance: 100, dice, otherwise: false, ...set });
          }
        }
      }
      const { target, ...rest } = resolveHit(foe.conditions, {
        ...(side.strike ?? {}),
        damage: Math.max(Math.min(hpBefore, damage), 0),
        alive: foe.hp > 0,
        inflicts,
        wards: bendsOf(other(key))?.nullify,
        burstHarm: bendsOf(key)?.burstHarm,
        suffers: bendsOf(other(key))?.suffers
      }, d100);
      foe.conditions = target;
      if ( rest.ended.length || rest.inflicted.some((inflicted) => inflicted.success && !inflicted.combatOnly) ) shifted = true;
      if ( rest.held ) foe.held = true;

      // A burst that a skill makes hurt deals the turns the condition had as damage, whatever the defence. It
      // can defeat the unit, and is nobody's kill
      if ( rest.burst?.harm ) {
        if ( (foe.hp > 0) && !unharmed(other(key)) ) {
          const had = foe.hp;
          rest.burst.harm *= weak(other(key));
          foe.hp = lose(plan[other(key)].unit, foe.hp, rest.burst.harm);
          harms.push({ skill: rest.burst.skill, by: key, to: other(key), amount: rest.burst.harm });
          jolt(other(key), had - foe.hp);
        }
        else delete rest.burst.harm;
      }

      // Healing: what the target's conditions give back, the share of the damage a skill turns into HP, and
      // what a skill restores for defeating the foe
      const share = [...parts, ...landing].reduce((most, part) => Math.max(most, part.heal), 0);
      const drained = Math.floor((taken * share) / 100);
      const healed = Math.max(Math.min(rest.leech + drained + recovered, (side.unit.hpMax ?? Infinity) - mine.hp), 0);
      mine.hp += healed;
      mine.healed += healed;
      effects = { ...rest, healed };

      // What the target's skills do to the attacker in return; damage that cannot kill leaves 1 HP
      for ( const { amount, nonlethal } of unharmed(key) ? [] : returns ) {
        if ( mine.hp <= 0 ) break;
        const before = mine.hp;
        mine.hp = nonlethal ? Math.max(before - amount, 1) : lose(side.unit, before, amount);
        reflected += nonlethal ? before - mine.hp : amount;
        jolt(key, before - mine.hp);
      }

      // What inflicting a condition sets off for both units, for each one the hit gave the target
      for ( const inflicted of rest.inflicted ) {
        if ( inflicted.success && !inflicted.combatOnly ) passOn(key, inflicted, procs, effects);
      }

      // The conditions the target's skills give the attacker in return, which the target then inflicted
      for ( const id of answers ) {
        const given = afflict(key, id, { more: bendsOf(other(key))?.inflictTurns[id] ?? 0 });
        if ( !given ) continue;
        (effects.returned ??= []).push(given);
        if ( given.success !== false ) passOn(other(key), given, procs, effects);
      }
    }

    // A run of attacks that only costs one use spends it on the first of them that would cost one
    // Skills may spare the weapon: for the whole fight, after its first use in it, or for the attack that
    // defeats the foe
    const thrift = side.unit.fx?.rules;
    const free = !!mine.freeUses || (kill && !!thrift?.has("freeKill"));
    const spared = free || (!!thrift?.has("oneUsePerFight") && mine.used);
    const useSpent = !paid && !spared && spendsUse(weapon, hit, plan.distance);
    if ( useSpent ) {
      mine.uses -= 1;
      mine.usesSpent += 1;
      mine.used = true;
      mine.broke = mine.uses <= 0;
      for ( const group of entry.groups ) group.spent = true;
    }

    // A skill of the target may wear the weapon further with every hit it takes, unless the attack costs the
    // weapon nothing at all
    const wear = plan[other(key)].unit.fx?.foeWear;
    const worn = (lands && !free && wear && (weapon?.uses?.max > 0)) ? Math.min((damage > 0) ? wear.hit : wear.noDamage, Math.max(mine.uses, 0)) : 0;
    if ( worn > 0 ) {
      mine.uses -= worn;
      mine.usesSpent += worn;
      mine.broke = mine.uses <= 0;
    }
    const wexp = lands ? (weapon.wexp ?? 0) * (kill ? 2 : 1) * (side.unit.fx?.rules?.has("doubleWexp") ? 2 : 1) : 0;
    mine.wexp += wexp;

    const attack = {
      side: key,
      hitRoll,
      hitChance,
      hit,
      critRoll,
      critChance: numbers.crit,
      crit,
      damage,
      hpBefore,
      hpAfter: foe.hp,
      kill,
      useSpent,
      broke: (useSpent || (worn > 0)) && mine.broke,
      wexp,
      conditions: effects
    };
    if ( procs.length ) attack.procs = procs;
    if ( fcm !== 1 ) attack.fcm = fcm;
    if ( evaded ) attack.evaded = true;
    if ( backfire ) attack.backfire = backfire;
    if ( jolted ) attack.staggered = true;
    if ( reflected > 0 ) attack.reflected = reflected;
    if ( harms.length ) attack.harm = harms;
    if ( entry.added ) {
      attack.added = true;
      attack.skill = entry.added;
    }
    attacks.push(attack);

    // A skill that ends the fight with the attack it was declared for
    if ( lands && parts.some((part) => part.end) ) break;
  }

  const outcome = (key) => {
    const { hp, weapon, proficiencies } = plan[key].unit;
    const mine = state[key];
    const gains = [];
    if ( weapon && (mine.wexp > 0) ) {
      for ( const proficiency of wexpProficiencies(proficiencies, weapon.category) ) {
        const { rank, wexp } = proficiencies[proficiency];
        const { rankUps, ...after } = gainWexp({ rank, wexp }, mine.wexp);

        // A proficiency that earns nothing, as with Weapon Levels once a unit is proficient, has nothing to tell
        if ( (after.rank === rank) && (after.wexp === wexp) ) continue;
        gains.push({ key: proficiency, before: { rank, wexp }, after, rankUps });
      }
    }
    return {
      hpStart: hp,
      hp: mine.hp,
      defeated: (hp > 0) && (mine.hp <= 0),
      usesStart: weapon ? weapon.uses.value : null,
      uses: mine.uses,
      usesSpent: mine.usesSpent,
      broke: mine.broke,
      wexp: mine.wexp,
      proficiencies: gains,
      conditionsStart: { ...(plan[key].unit.conditions ?? {}) },
      conditions: mine.conditions,
      healed: mine.healed,
      held: mine.held,
      break: mine.break,
      stagger: bars[key] ?? null,
      staggered: mine.staggered,
      spent: [...(attacks.length ? (plan[key].declared ?? []) : []), ...mine.counted]
    };
  };

  // What skills do once the fighting is over, for the units that still stand: damage to the foe, a condition
  // on it, or something for the table to apply
  const closing = [];
  const after = [];
  for ( const key of attacks.length ? ["initiator", "defender"] : [] ) {
    const mine = state[key];
    const foe = state[other(key)];
    for ( const proc of plan[key].chances?.after ?? [] ) {
      if ( mine.hp <= 0 ) break;
      if ( (proc.ifHit && !mine.landed) || (proc.ifStruck && !mine.struck) ) continue;
      const needsFoe = (proc.retaliate > 0) || (proc.inflicts.length > 0) || (proc.remind === "foe")
        || ((proc.grants?.length > 0) && proc.grants.every((grant) => (grant.to === "foe") && !grant.reach));
      if ( needsFoe && (foe.hp <= 0) ) continue;
      if ( !fire(proc, key, closing) ) continue;
      const entry = { skill: proc.skill, by: key };

      // HP the skill restores to its unit now that the fight is over
      const restored = Math.max(Math.min(proc.recover, (plan[key].unit.hpMax ?? Infinity) - mine.hp), 0);
      mine.hp += restored;
      mine.healed += restored;
      const harms = [];
      harm(proc, key, harms);
      if ( harms.length ) entry.damage = harms[0].amount;
      for ( const { id } of (foe.hp > 0) ? proc.inflicts : [] ) {
        const given = afflict(other(key), id, { more: bendsOf(key)?.inflictTurns[id] ?? 0 });
        if ( !given ) continue;
        (entry.inflicted ??= []).push(given);
        if ( given.success !== false ) passOn(key, given, closing, entry);
      }
      remind(proc, key);
      if ( ("damage" in entry) || entry.inflicted ) after.push(entry);
    }
  }

  const result = { attacks, initiator: outcome("initiator"), defender: outcome("defender") };
  if ( opening.length ) result.opening = opening;
  if ( closing.length ) result.closing = closing;
  if ( after.length ) result.after = after;
  if ( reminders.length ) result.reminders = reminders;
  if ( earned.length ) result.earned = earned;
  if ( charged.length ) result.charged = charged;
  if ( granted.length ) result.granted = granted;
  return result;
}

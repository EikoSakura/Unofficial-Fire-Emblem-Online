/**
 * Skill effects for Fire Emblem Online: what a unit's equipped skills add to its stats and combat stats, and
 * which combat rules they bend, read from the structured effects each skill carries beside its Effect text.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill effect says when it applies and what it does:
 *
 *   {
 *     choice: "mighty",                 // only while the skill's chosen variant is this one
 *     when: {                           // every part that is given must hold
 *       role: "initiating",             // or "defending"
 *       hp: { op: "le", percent: 50 },  // the unit's HP: le, lt, ge, gt, full, notFull
 *       foeHp: { op: "full" },          // the foe's HP, the same way
 *       weapon: ["sword"],              // the unit's weapon: categories or groups (see `weaponIs`)
 *       quality: ["Armored"],           // the unit itself has any of these Special Qualities
 *       lacks: ["Mounted"],             // the unit itself has none of these Special Qualities
 *       skill: "Plunder",               // the unit has this skill equipped; `noSkill` when it has not
 *       foeWeapon: ["magic"],           // the foe's weapon
 *       foeWeaponNot: ["blessed"],      // the foe's weapon is none of these
 *       foeQuality: ["Flying"],         // the foe has any of these Special Qualities
 *       foeNoQuality: true,             // the foe has no Special Quality
 *       foeCounters: false,             // whether the foe can answer in this fight
 *       counters: false,                // whether the unit itself can
 *       range: { min: 2 },              // tiles between the two
 *       compare: { left: "str", right: "str", margin: 4 },   // the unit's value less the foe's is at least this;
 *                                                            // with `reverse`, the foe's less the unit's
 *       foeAfflicted: true,             // the foe suffers from a condition
 *       foeLacks: ["Terror"],           // the foe has none of these Special Qualities
 *       near: { who: "ally", within: 2 },         // units around the unit (see below)
 *       foeNear: { who: "ally", within: 1 },      // the unit's allies (or enemies) around the unit it fights
 *       flanking: true,                 // an ally stands right behind the foe, straight across from the unit
 *       sameSpace: true,                // the unit and the foe stand in one space
 *       terrain: true,                  // the unit stands on terrain with effects (see `terrain.mjs`)
 *       noModule: "leadership"          // the Optional Module of this name is not in use
 *     },
 *     stats: { str: 3 },                // added to stats
 *     statPercent: { str: 50 },         // a share of the stat's total added to it
 *     combat: { hit: 5 },               // added to combat stats; `activation` is the Skill Activation rate
 *     might: 4,                         // added to the weapon's Might
 *     taken: -2,                        // added to the damage of every hit the unit takes
 *     takenPercent: -25,                // the same as a share
 *     endurance: 2,                     // END: taken off the damage of every hit the unit takes
 *     haste: 1,                         // HST: counted as Attack Speed for the unit's own follow-up attack
 *     mirrorCrit: 15,                   // Critical for its own chance of being critically hit, up to this much
 *     critMultiplier: 3.5,              // what the damage of its critical hits is multiplied by, in place of the
 *                                       // usual amount
 *     slots: 1,                         // more skills the unit may have equipped at once
 *     capacity: 20,                     // more Capacity Points, where the world plays with Skill Capacity
 *     artCost: -1,                      // added to each cost, in HP and in Weapon Uses, of the Combat Arts the
 *                                       // unit performs, where the world plays with Combat Arts
 *     dealtPercent: 5,                  // a share added to the damage of the unit's hits
 *     hpMax: 5,                         // added to maximum HP
 *     calc: { accuracy: "bruteForce" }, // another formula for a combat stat; `damageBy`, `accuracyBy` and
 *                                       // `criticalBy: "lowest"` work it out from the lowest of a few stats, and
 *                                       // `dodgeBy: "none"` leaves no Dodge (see `SKILL_CALC`)
 *     foeStats: { spd: -2 },            // added to the stats the foe fights with, in this fight only
 *     rules: ["closeCounter"],          // combat rules the skill bends (see RULES)
 *     effective: ["Beast"],             // Special Qualities the unit's attacks are effective against
 *     effectiveMultiplier: 4,           // what an effective weapon's Might is multiplied by
 *     damageMultiplier: 2,              // what the damage of the unit's hits is multiplied by
 *     ignoreDefence: 33,                // the share of the foe's defence the unit's attacks ignore
 *     strikes: 2,                       // how many times each of the unit's attacks strikes
 *     extraAttack: { percent: 50 },     // one more attack after all others, at a share of its damage
 *     scale: { of: "hpMissingPercent", per: 25, max: 3 }     // the numbers above are multiplied by this
 *   }
 *
 * An effect that asks for a Special Quality of the unit can be marked `form: true`: the skill then lets its
 * unit take that quality on and put it off at will, with a switch for it on the skill (see `formsOf`).
 *
 * A number may also be read from the unit: { of: "con", div: 3 } is a third of its Constitution, rounded down;
 * { of: ["def", "res"], div: 2 } adds several up first.
 *
 * Skills that ask where units stand read what the unit has around it (see `positions.mjs`). A condition
 * `near` names the units asked about and how many of them there must be:
 *
 *   near: { who: "ally", within: 2 }                 // an ally at most 2 tiles away (`min: 1` is understood)
 *   near: { who: "ally", within: 2, max: 0 }         // no ally within 2 tiles
 *   near: { who: "ally", within: 3, quality: ["Mounted"] }     // also: `from` (at least this far), `class`
 *
 * and a number can count them: { count: { who: "enemy" }, div: 2 } is half the enemies on the map. For a unit
 * that is not on the map none of this can be judged; the skill is then shown as one to check by hand, and
 * nothing of that effect is applied. The same is said of an effect marked `remind: "check"`, for what hangs
 * on something the system cannot see at all, such as terrain or movement.
 *
 * An effect with an `aura` is not for the unit that has the skill but for the units around it:
 *
 *   {
 *     aura: { who: "ally", within: 3,   // who receives it; `from: 2` leaves out those nearer than that,
 *             self: true,               // `self` gives it to the unit itself as well,
 *             when: { role: "defending" } },         // and `when` is a condition each receiver must meet
 *     when: { hp: { op: "full" } },     // a condition the giver must meet, outside of any fight
 *     combat: { hit: 10, dodge: 10 },   // what each receiver gains: any part of an effect, a chance or a
 *     stats: { def: { of: "def", div: 4, giver: true } }     // moment included. A number is read from the
 *   }                                                        // receiver, or with `giver` from the giver
 *
 * (see `auras.mjs`). At a moment of its own turn a skill can instead reach for the units around its unit:
 *
 *   { proc: { on: "turnStart", sure: true }, reach: { who: "ally", within: 1 }, recover: { of: "mag" } }
 *
 * restores that much HP to every ally next to the unit, and with `remind` names them for the table. With
 * nobody in reach it does nothing.
 *
 * At any moment, of a fight or of a turn, a skill can also grant a change that lasts a while, to its unit, to
 * its foe or to the units around: `grant: { to: "foe", effects: [{ stats: { str: -6 } }], ends: "turnEnd",
 * turns: 2 }` (see `timed.mjs`). The unit that carries it then has it as a skill entry of its own until it ends.
 *
 * An effect with a `proc` is not always there: it has a chance to activate, rolled during an exchange.
 *
 *   {
 *     proc: { on: "attack", stat: "dex", div: 2 },   // rolled for each of the unit's attacks, at DEX/2 %;
 *                                                    // `on: "struck"` for each hit the unit takes, and
 *                                                    // `on: "start"` once as the fight begins;
 *                                                    // `percent: 25` for a fixed chance; `times: 1.5`
 *     when: { ... },                    // as above; an effect whose condition fails is never rolled
 *
 *     // on an attack, for that attack:
 *     damage: { of: "def", times: 0.4 },             // added to its damage; a list is added up
 *     damagePercent: 30,                // a share of the damage before the foe's defence, added to it
 *     damageOfFoeHp: 20,                // a share of the HP the foe has as the attack is made, added to it
 *     damageMultiplier: 2,              // what its damage is multiplied by
 *     statTimes: { str: 2 },            // the stat counted this many times, when the weapon adds that stat
 *     ignore: { percent: 100, stat: "def" },         // the share of the foe's DEF (or RES) it ignores
 *     hit: 5, critical: 5,              // added to its Hit and Critical
 *     heal: 100,                        // the share of the damage dealt that heals the unit
 *     sureHit: true,                    // it cannot miss; "ifAny" when it needs some chance to hit
 *     inflicts: ["burn", { id: "bleed", upgrade: { id: "heavyBleed", stat: "dex", div: 2 } }],
 *                                       // `{ id: "smoke", dice: 3 }` rolls a die of that many faces for the turns,
 *                                       // `{ id: "silence", turns: 1 }` sets them, and
 *                                       // `{ anyOf: ["poison", "stun"] }` inflicts one of them, picked by a die
 *     grant: { to: "foe", ... },        // what it grants its foe, or the units around its foe, waits for the
 *                                       // attack to land; what it grants its own side comes at once. On an
 *                                       // attack and on a hit, a number of such a change can be read from the
 *                                       // damage dealt: { of: "dealt", cap: 20, times: -1 } is that damage, held
 *                                       // at 20, taken off; a change it would make nothing of is not granted.
 *                                       // `pick: [{ name, effects }, ...]` in place of `effects` grants one of
 *                                       // several changes, picked by a die
 *     remind: "foe",                    // the system says so once the attack has landed
 *     sequence: [{}, { share: 0.5 }],   // the attack becomes this many attacks in a row, each with its own
 *                                       // parts from the list above and its share of the damage. The attacks
 *                                       // it adds roll no chances of their own
 *     oneUse: true,                     // a sequence only costs the weapon one use
 *
 *     // when struck, for that hit:
 *     negate: 30,                       // the share of the damage that is negated
 *     reduce: 10,                       // taken off the damage
 *     reflect: 100,                     // the share of the damage the attacker takes too, counted before
 *                                       // this effect negates or reduces it
 *     retaliate: { of: "mag", times: 0.8 }, resist: "res",   // damage to the attacker, less its RES
 *     inflictsAttacker: ["poison"],
 *     survive: true,                    // a fatal hit is halved, and leaves 1 HP if it is still fatal
 *     survive: { hp: { op: "gt", percent: 50 } },    // a fatal hit leaves 1 HP instead, for a unit whose HP
 *                                       // before that hit passes this test; `{ op: "above", value: 1 }`
 *                                       // asks for more HP than a plain number
 *
 *     // at the start, for the whole fight:
 *     combat: { damage: 5, critical: 20 },           // added to the unit's Hit, damage, Critical and Dodge
 *     foeCombat: { hit: -20, dodge: -20 },           // added to the foe's Hit and Dodge
 *     recover: 10                                    // HP the unit regains before the first attack
 *   }
 *
 * The chance of an effect given by an aura is the receiver's own, unless its `proc` says `giver: true`: it is
 * then worked out for the unit that has the skill, with its Skill Activation rate, and nothing of the receiver
 * changes it.
 *
 * Where the world plays with Alternate Skill Activation, a chance read from a stat is read as that module has
 * it (see `activationOf`): from the whole stat, or from the unit's level in place of its Dexterity. The second
 * roll of an `upgrade` is no activation, and stays as it is written.
 *
 * Some effects need no luck, only their moment: `proc: { on: "crit", sure: true }` rolls nothing. The moments
 * beyond the three above, each open to a chance or to `sure`:
 *
 *   on: "hit"       each of the unit's attacks that lands, and "crit" each that is a critical hit:
 *                   inflicts, heal, recover, foeCombat (for the rest of the fight), next, remind
 *   on: "miss"      each of the unit's attacks that misses: retaliate, remind
 *   on: "dodged"    each attack against the unit that misses: retaliate, next, near, attack, remind
 *   on: "kill"      the unit's attack defeats the foe: recover, remind
 *   on: "after"     once after the fight, for a unit that still stands: retaliate, inflicts, recover, remind
 *
 *   {
 *     next: { hit: 10, damage: 2, critical: 3 },     // added to the unit's next attack in this fight
 *     nextOfDamage: { critical: 50 },                // the same, as a share of the damage of the hit taken
 *     near: { within: 10, next: { damage: 3 } },     // `next` instead, when the attack missed by this or less
 *     retaliate: { of: "foeHpMax", times: 0.1 },     // damage to the foe, less its `resist` when one is named
 *     nonlethal: true,                               // that damage leaves the foe at 1 HP at least
 *     recover: { of: "hpMax", times: 0.25 },         // HP the unit regains
 *     attack: true,                                  // the unit makes one more attack at once, if it can attack
 *     remind: true,                                  // the system only says that the skill takes effect, for
 *                                                    // the table to apply; "foe" when that needs the foe standing
 *     damaged: true,                                 // only for an attack that deals damage, or would have
 *     ifHit: true, ifStruck: true                    // after the fight: only if the unit landed a hit, or took one
 *   }
 *
 * A number can be rounded up instead of down with `round: "up"`.
 *
 * Outside of a fight a skill can wait for a moment of its unit's turn, again with a chance or with `sure`:
 *
 *   on: "turnStart"   the unit's turn starts        on: "turnEnd"   it ends        on: "wait"   the unit Waits
 *
 *   {
 *     proc: { on: "turnStart", sure: true },
 *     recover: { of: "hpMax", times: 0.1 },          // HP the unit regains
 *     cure: ["poison"],                              // conditions the unit is cured of; "all" for every one
 *     remind: true                                   // the system only says so; "check" when the effect hangs on
 *   }                                                // something it cannot see, and then `recover` is shown, not applied
 *
 * A unit that has Waited is `waiting` until its next turn starts, which a condition can ask for:
 * `when: { waiting: true }`. `foeActivation: -10` is added to the Skill Activation rate of a foe in a fight.
 *
 * A skill its unit chooses when to activate (see `skill-usage.mjs`) only applies its effects marked
 * `when: { declared: true }` while it is switched on. For such a skill two more parts help:
 *
 *   proc: { on: "attack", sure: true, once: true }   // `once`: only the first time its moment comes in a fight
 *   end: true                                        // on an attack: the fight ends there if the attack hits
 *
 * Some skills change how far a weapon reaches, how it wears, or who may wield it:
 *
 *   when: { weaponReach: { min: 2 } }   // the weapon in hand itself attacks at 2 tiles or more
 *   when: { beyondReach: true }         // the fight is fought from further than the weapon itself reaches
 *   weaponRange: { add: 1 }             // the farthest the weapon attacks at, raised by this much; `max: 3`
 *                                       // raises it to at least that, `min: 1` lowers the nearest to that
 *   damageStat: "mag"                   // the stat added to the weapon's Might, which also sets whether DEF or
 *                                       // RES resists it
 *   foeWear: { hit: 1, noDamage: 2 }    // uses a foe's weapon loses on top for each hit on the unit: one that
 *                                       // dealt damage, one that dealt none
 *   wield: 1                            // weapon ranks above its own the unit may wield, where it has a rank
 *   proc: { on: "start", stat: "luk" }, freeUses: true     // the unit's weapon loses no use in this fight
 *
 * Some skills change no number of a fight but what their unit earns (see `earnings.mjs`): `expMultiplier: 1.5`
 * multiplies the experience it earns, `staffExp: "unpromoted"` names the column of the staff table it earns by,
 * `growths: { hp: 10 }` is added to the growth rates a level up rolls, `gold: 50` at `on: "kill"` is gold for
 * defeating the foe, and `on: "levelUp"` is the moment its unit levels up.
 *
 * Some skills give a weapon rank for good (see `skill-ranks.mjs`). The rank is saved on the unit as the skill
 * is taken, and taken back as it goes:
 *
 *   rank: { fire: 1 }                   // ranks added, by proficiency
 *   rank: { start: 1 }                  // in the proficiency the unit started with
 *
 * Some skills bend the rules of conditions (see `conditions.mjs`). These parts are always there, never at a
 * moment or as an aura:
 *
 *   inflictChance: { burn: 10 }         // added to every chance below 100% the unit has of inflicting it: that
 *                                       // of its weapon, and that of each skill it rolls for which inflicts it
 *   inflictTurns: { squall: 1 }         // turns it lasts longer when the unit inflicts it
 *   nullify: 50                         // the chance in percent that a condition which would be applied to the
 *   nullify: { percent: 100, only: "damaging" }    // unit in a fight is not; `only` for those that deal damage
 *                                       // at the start of a turn, or for a list of conditions
 *   suffers: { burn: { damage: 0.5, penalties: -1 } }      // what a condition does to the unit that has it: its
 *                                       // damage at the start of a turn and its penalties are multiplied by
 *                                       // these, so 0.5 halves, 0 takes away and -1 turns around (the damage
 *                                       // heals, the penalties are bonuses); `tick: 5` adds to the percent of
 *                                       // maximum HP it deals, `stays: true` keeps it from running out, and
 *                                       // `burst: true` has it deal its turns as damage when it bursts
 *   recovery: 2                         // turns each of the unit's conditions loses as its turn starts
 *   debuffs: { stats: 4, combat: 5 }    // taken off every penalty to a stat or a combat stat that a condition,
 *                                       // a lasting change from another unit or an aura puts on the unit;
 *                                       // `negate: true` for all of it
 *   burstHarm: ["tremor"]               // a condition the unit bursts deals its turns as damage to its unit
 *
 * and two moments of a fight, always `sure`, come when a condition is inflicted by an attack or a skill:
 *
 *   on: "inflict"     the unit gave its foe a condition       on: "afflicted"   its foe gave it one
 *
 *   {
 *     proc: { on: "inflict", sure: true, condition: ["stun"] },    // `condition`: only for these
 *     grant: { to: "foe", effects: [...], ends: "turnEnd", turns: "condition" },   // lasts as long as the
 *     remind: true,                     // condition inflicted; or the system only says so
 *     returns: 1                        // when afflicted: the foe gains the same condition for this many turns
 *   }
 *
 * Some skills speak to staves (see `staves.mjs`). A staff that heals one unit restores its HP when it is used;
 * these parts are always there:
 *
 *   staffHeal: { more: 50, plus: 5,     // the unit heals allies for this share more (with staves and items),
 *                self: 100, both: 25 }  // heals this much more with staves, regains this share of the HP its
 *                                       // staff restored to its target, and regains this share more from a
 *                                       // staff that heals user and target
 *   staffHealed: { healer: 100, both: 25 }    // the same two shares, for the ally that heals this unit
 *   staffRange: { times: 2 }            // the farthest its staves reach, multiplied; `max: 10` raises it to that
 *   rules: ["selfStaff", "staffFreeUses"]     // a staff that heals heals its user when used on nobody; its
 *                                             // staves lose no use
 *
 * and the moment a staff is used, `sure` or with a chance that is rolled before the staff heals, can grant
 * what lasts, be announced, heal more, or harm:
 *
 *   {
 *     proc: { on: "staff", sure: true, ally: true },   // `ally`: only when used on an ally; `heals`: only
 *                                                      // when it restored HP to one
 *     healPlus: { of: "def", times: 0.6 },             // HP a staff that heals one unit restores on top
 *     grant: { to: "target", effects: [{ stats: { str: 2 } }], ends: "turnStart", clock: "giver" },
 *     harmNear: { within: 2, percent: 50 },            // that share of the HP restored, as damage to the enemy
 *     remind: true                                     // nearest to the unit healed, within so many tiles
 *   }
 *
 * There a number can be read from `healed`, the HP the staff restored to the ally it was used on.
 *
 * A skill that takes effect by itself a limited number of times (`usage.kind: "auto"`, see `skill-usage.mjs`)
 * counts a use each time one of its moments of a fight takes effect, and does nothing once its uses are spent.
 *
 * What a Special Quality builds into its unit is written the same way (Rampart, Rouse, Greed). Three parts
 * serve it:
 *
 *   proc: { on: "struck", percent: 90, fixed: true }       // `fixed`: a plain chance, which the Skill
 *                                                          // Activation rate does not change; what the unit's
 *                                                          // skills add to its chances of inflicting a
 *                                                          // condition still counts
 *   shield: { def: 12, res: 9 }         // when struck: the hit is dealt as if the unit had this much DEF (or
 *                                       // RES) where that is more than its own; given by an aura, the
 *                                       // numbers are the giver's (`{ of: "def", giver: true }`)
 *   gold: { of: "levelsApart", times: 50 }     // `levelsApart`: the levels between the unit and its foe, 1
 *                                              // at least
 *
 * Some skills change how their unit changes form (see `shifting.mjs`). A `shift` part is always there, or waits
 * only for its skill to be switched on (`when: { declared: true }`):
 *
 *   shift: {
 *     percent: 25,        // the share added to its stats while transformed, in place of the usual one
 *     add: 10,            // points added to that share
 *     times: 2,           // what the share is multiplied by
 *     start: 5,           // added to its starting Shift Gauge; `turnHuman`, `turnAnimal`, `combatHuman` and
 *                         // `combatAnimal` add to what the gauge changes by
 *     transforms: 1,      // more times a turn that its stone transforms it; `endless: true` for any number
 *     atWill: true,       // it Shifts whatever its Shift Gauge holds
 *     keep: true,         // its Shift Gauge starts a map where the last one left it
 *     humanFight: 50      // it may start a fight in humanoid form, for this share of the usual change to its gauge
 *   }
 *
 * `when: { shifted: true }` asks whether the unit is transformed: Shifted, or with a stone that still transforms
 * it for a fight. On a critical hit, `gaugeOfDamage: 100` gives the Shift Gauge that share of the damage the hit
 * would have dealt had it not been critical.
 *
 * A skill used as an action can put its unit somewhere else on the map (see `warp.mjs`). Its `warp` part stands
 * alone in an effect and is always there:
 *
 *   warp: { within: "mov", unmoved: true }     // onto a free tile at most its MOV away, whatever lies between,
 *                                              // and only before it has moved; `clear: 3` for a tile with no
 *                                              // enemy within 3 tiles, anywhere on the map without `within`
 *   rules: ["actAfterWarp"]                    // warping does not end the unit's turn
 */
import { FEO } from "../config.mjs";
import { SKILL_CALC } from "./combat-stats.mjs";
import { conditionModifiers } from "./conditions.mjs";
import { alliesOpposite, countHolds, countNear, sharesSpace, unitsNear, unitsNearFoe } from "./positions.mjs";
import { SHIFT_PARTS } from "./shifting.mjs";
import { usesLeft } from "./skill-usage.mjs";
import { buildChange } from "./timed.mjs";
import { ACT_AFTER_WARP, checkWarp } from "./warp.mjs";

/**
 * @typedef SkillEntry
 * @property {string} name
 * @property {boolean} [nihil]        Is the skill cancelled in combat by a foe with Nihil?
 * @property {string} [choice]        The variant chosen for the skill, when it has several
 * @property {object[]} effects       Its structured effects
 */

/**
 * @typedef SkillSelf
 * What a skill can ask about its own unit.
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} level
 * @property {Record<string, number>} stats       Stat totals without any skill effect
 * @property {Record<string, number>} [base]      Base stat values
 * @property {object|null} weapon                 The weapon in hand: category, weight, might, hit, crit, rank,
 *                                                range, name
 * @property {number} [accuracy]                  Accuracy without any skill effect, for effects that read it
 * @property {import("./positions.mjs").Surroundings|null} [near]
 *                                                What the unit has around it; null when it is not on the map
 * @property {Record<string, number>} [conditions]    The conditions it suffers from, and the turns each has left
 * @property {string} [qualities]                 Its Special Qualities, as free text
 * @property {boolean} [shifted]                  Is it transformed: Shifted, or with a stone that transforms it?
 * @property {string[]} [skills]                The names of the skills it has equipped; filled in from the
 *                                                skills read where it is not given
 */

/**
 * @typedef SkillFight
 * What a skill can ask about the fight its unit is in.
 * @property {"initiating"|"defending"} role
 * @property {number} distance
 * @property {SkillSelf & {qualities?: string, afflicted?: boolean}} foe
 * @property {boolean|null} [foeCounters]     Can the foe answer? Null while that is not known yet
 * @property {boolean|null} [counters]        Can the unit itself?
 */

/** The combat rules a skill can bend. */
export const RULES = [
  "nihil", "closeCounter", "distantCounter", "noTriangle", "reverseTriangle", "alwaysAdvantage", "noFollowUp",
  "foeNoFollowUp", "sureFollowUp", "first", "sureHit", "sureCrit", "foeNoCounter", "noCombat", "noEffective",
  "alwaysActivate", "noCrit",

  // The unit's highest rank in any proficiency sets the size of its weapon triangle bonus, and it earns
  // twice the weapon experience
  "bestRankTriangle", "doubleWexp",

  // Backfiring, as Devil weapons do: the unit's attacks may, its foe's may, a backfire of its Devil weapon
  // damages the target as well, and the unit takes half of what backfires on it
  "backfire", "foeBackfire", "backfireBoth", "halfBackfire",

  // Reach and wear: the unit answers a Midrange attack from next to it with a weapon that only reaches 1 tile,
  // its own attack from next to its foe counts as Midrange, it fights a diagonal neighbour in melee as if
  // next to it, its weapon loses no more than one use in a fight, and none for the attack that defeats its foe
  "counterMidrange", "midrange", "diagonalMelee", "oneUsePerFight", "freeKill",

  // The unit takes no damage that a skill deals outside of an attack: what is reflected or dealt in return,
  // on a miss, after the fight, or by a condition that bursts
  "noSkillDamage",

  // Staves: one that heals heals its user when it is used on nobody, and the unit's staves lose no use
  "selfStaff", "staffFreeUses",

  // Staying alive: the unit's foe makes no critical hit, and the unit dodges every attack whose hit would be
  // fatal to it
  "foeNoCrit", "dodgeFatal",

  // Warping: the unit keeps its turn when a skill has warped it
  ACT_AFTER_WARP
];

/** When a proc is rolled. */
export const PROC_TRIGGERS = ["attack", "struck", "start", "hit", "crit", "miss", "dodged", "kill", "after", "inflict", "afflicted"];

/** The moments of a fight that come when a condition is inflicted: for the unit that did, and for its foe. */
export const CONDITION_MOMENTS = ["inflict", "afflicted"];

/** The moment a unit uses a staff, which is no moment of a fight or of a turn. */
export const STAFF_MOMENTS = ["staff"];

/** The parts of an effect that speak to staves. */
const STAFF_KEYS = ["staffHeal", "staffHealed", "staffRange"];

/** The rules that only staves read, which give a skill nothing to tell in a fight. */
const STAFF_RULES = ["selfStaff", "staffFreeUses"];

/** The rules that are read outside of fights altogether, and so give a skill nothing to tell in one. */
const QUIET_RULES = [...STAFF_RULES, ACT_AFTER_WARP];

/** The parts of an effect that bend the rules of conditions. */
const BEND_KEYS = ["inflictChance", "inflictTurns", "nullify", "suffers", "recovery", "debuffs", "burstHarm"];

/** The moments of a unit's turn a skill can wait for. */
export const TURN_MOMENTS = ["turnStart", "turnEnd", "wait"];

/** The moments outside of fights and turns a skill can wait for: its unit levelling up. */
export const LEVEL_MOMENTS = ["levelUp"];

/** The parts of a condition that can only be judged in a fight. */
const FIGHT_KEYS = ["role", "foeHp", "foeWeapon", "foeWeaponNot", "foeQuality", "foeNoQuality", "foeCounters", "counters", "range", "compare", "foeAfflicted",
  "foeLacks", "foeNear", "flanking", "sameSpace", "beyondReach"];

/** The parts of a condition that ask where units stand. */
const PLACE_KEYS = ["near", "foeNear", "flanking", "sameSpace", "terrain"];

/** The parts of a condition that wait until it is known who can counter-attack. */
const LATE_KEYS = ["foeCounters", "counters"];

const COMBAT_KEYS = ["hit", "damage", "critical", "attackSpeed", "dodge", "critAvoid", "activation"];

/** The parts of an effect that make its skill worth naming in a forecast, even without a condition. */
const NOTABLE = ["rules", "effective", "effectiveMultiplier", "damageMultiplier", "ignoreDefence", "strikes", "extraAttack", "taken", "takenPercent", "scale",
  "weaponRange", "damageStat", "foeWear", "inflictChance", "inflictTurns", "nullify", "burstHarm", "mirrorCrit", "critMultiplier"];

/* -------------------------------------------- */
/*  Reading Conditions                          */
/* -------------------------------------------- */

/**
 * Does a weapon belong to one of the listed categories or groups?
 * Groups: `magic` for every tome, `physical` for every weapon that is neither a tome nor a staff, `melee` for
 * those of them that are not bows or their kin, `anima` for Anima and its elements, `fists` for bare hands and
 * the weapon named Fists, `unarmed` for no weapon at all, `blessed` for a weapon whose name or Effect says it
 * is Blessed, `nonBeorc` for what Laguz, Manaketes and Taguel attack with (both set by `sacredWeapons` in the
 * configuration).
 * @param {object|null} weapon
 * @param {string[]} list
 * @returns {boolean}
 */
export function weaponIs(weapon, list) {
  const category = weapon?.category;
  const config = FEO.weaponCategories[category];
  return list.some((entry) => {
    switch ( entry ) {
      case "unarmed": return !weapon;
      case "fists": return !weapon || (String(weapon.name ?? "").trim().toLowerCase() === "fists");
      case "magic": return !!config?.magic;
      case "physical": return !!weapon && !config?.magic && (category !== "staff");
      case "melee": return !!weapon && !config?.magic && !config?.ranged && (category !== "staff");
      case "anima": return (category === "anima") || (category === "ice") || FEO.animaProficiencies.includes(category);
      case "blessed": return !!weapon && new RegExp(FEO.sacredWeapons.blessed, "i").test(`${weapon.name ?? ""}\n${weapon.effect ?? ""}`);
      case "nonBeorc": return FEO.sacredWeapons.nonBeorc.includes(category);
      default: return category === entry;
    }
  });
}

/* -------------------------------------------- */

/**
 * Compare HP with a threshold.
 * @param {{op: string, percent?: number}} test
 * @param {number} hp
 * @param {number} hpMax
 * @returns {boolean}
 */
export function hpHolds(test, hp, hpMax) {
  const share = hpMax > 0 ? (hp / hpMax) * 100 : 0;
  switch ( test.op ) {
    case "le": return share <= test.percent;
    case "lt": return share < test.percent;
    case "ge": return share >= test.percent;
    case "gt": return share > test.percent;
    case "above": return hp > (test.value ?? 0);
    case "full": return hp >= hpMax;
    case "notFull": return hp < hpMax;
    default: return true;
  }
}

/* -------------------------------------------- */

/**
 * Does a Special Quality appear in a unit's qualities, written as free text?
 * @param {string} [qualities]
 * @param {string} quality
 * @returns {boolean}
 */
function hasQuality(qualities, quality) {
  const escaped = quality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(qualities ?? "");
}

/**
 * Does a unit have any Special Quality at all?
 * @param {string} [qualities]
 * @returns {boolean}
 */
function anyQuality(qualities) {
  return String(qualities ?? "").split(/[,;/&\n]/).some((part) => {
    const text = part.trim();
    return text && !/^(none|n\/?a|-+)$/i.test(text);
  });
}

/* -------------------------------------------- */

/**
 * A unit with the names of its own skills, for the conditions that ask whether it has one. What it only
 * receives from units around it, or carries for a while, is no skill of its own.
 * @param {SkillSelf} self
 * @param {SkillEntry[]} skills
 * @param {boolean} [foeNihil]      Does the foe cancel the skills that Nihil cancels? Those then do not count
 * @returns {SkillSelf}
 */
function withSkillNames(self, skills, foeNihil = false) {
  if ( Array.isArray(self?.skills) ) return self;
  const names = (skills ?? []).filter((skill) => !skill.aura && !skill.timed && !(foeNihil && skill.nihil)).map((skill) => skill.name);
  return { ...self, skills: names };
}

/* -------------------------------------------- */

/**
 * Does a skill take one of a unit's skill slots? Not what its Effect says is not a skill: what a Special
 * Quality builds into a unit, and the actions every unit has, are listed among the skills for reference only.
 * @param {string} [effect]     The Effect text
 * @returns {boolean}
 */
export function countsAsSkill(effect) {
  return !/\bnot a skill\b/i.test(String(effect ?? ""));
}

/* -------------------------------------------- */

/**
 * A value a comparison can read from a unit.
 * @param {SkillSelf} unit
 * @param {string} key
 * @returns {number}
 */
function readValue(unit, key) {
  switch ( key ) {
    case "hp": return unit.hp ?? 0;
    case "level": return unit.level ?? 1;
    case "attack": return unit.attack ?? 0;
    case "weaponWeight": return unit.weapon?.weight ?? 0;
    case "weaponMight": return unit.weapon?.might ?? 0;
    default: return unit.stats?.[key] ?? 0;
  }
}

/* -------------------------------------------- */

/**
 * Does an effect's condition need a fight to be judged?
 * @param {object} [when]
 * @returns {boolean}
 */
export function needsFight(when) {
  return FIGHT_KEYS.some((key) => (when?.[key] !== undefined) && (when[key] !== null) && (when[key] !== ""));
}

/* -------------------------------------------- */

/**
 * Does an effect's condition wait until it is known who can counter-attack?
 * @param {object} [when]
 * @returns {boolean}
 */
export function isLate(when) {
  return LATE_KEYS.some((key) => typeof when?.[key] === "boolean");
}

/* -------------------------------------------- */

/**
 * Does a condition hold?
 * @param {object} [when]
 * @param {SkillSelf} self
 * @param {SkillFight|null} [fight]     Null outside a fight, where a condition that needs one does not hold
 * @returns {boolean}
 */
export function holds(when, self, fight = null) {
  if ( !when ) return true;
  if ( when.hp && !hpHolds(when.hp, self.hp, self.hpMax) ) return false;
  if ( when.weapon?.length && !weaponIs(self.weapon, when.weapon) ) return false;
  if ( when.quality?.length && !when.quality.some((quality) => hasQuality(self.qualities, quality)) ) return false;
  if ( when.lacks?.length && when.lacks.some((quality) => hasQuality(self.qualities, quality)) ) return false;
  if ( when.skill && !(self.skills ?? []).includes(when.skill) ) return false;
  if ( when.noSkill && (self.skills ?? []).includes(when.noSkill) ) return false;
  if ( (typeof when.waiting === "boolean") && (!!self.waiting !== when.waiting) ) return false;
  if ( (typeof when.shifted === "boolean") && (!!self.shifted !== when.shifted) ) return false;
  if ( when.noModule && FEO.optional?.[when.noModule]?.enabled ) return false;
  if ( when.near && !countHolds(countNear(self.near ?? null, when.near), when.near) ) return false;
  if ( (typeof when.terrain === "boolean") && (!!self.near?.ground?.effects !== when.terrain) ) return false;
  if ( when.weaponReach ) {
    const reach = self.weapon?.reach;
    if ( !reach || (reach.max < (when.weaponReach.min ?? 0)) || (reach.max > (when.weaponReach.max ?? Infinity)) ) return false;
  }
  if ( !needsFight(when) ) return true;
  if ( !fight ) return false;

  const foe = fight.foe;
  if ( when.role && (when.role !== fight.role) ) return false;
  if ( when.foeHp && !hpHolds(when.foeHp, foe.hp, foe.hpMax) ) return false;
  if ( when.foeWeapon?.length && !weaponIs(foe.weapon, when.foeWeapon) ) return false;
  if ( when.foeWeaponNot?.length && weaponIs(foe.weapon, when.foeWeaponNot) ) return false;
  if ( when.foeQuality?.length && !when.foeQuality.some((quality) => hasQuality(foe.qualities, quality)) ) return false;
  if ( when.foeNoQuality && anyQuality(foe.qualities) ) return false;
  if ( (typeof when.foeCounters === "boolean") && (fight.foeCounters !== when.foeCounters) ) return false;
  if ( (typeof when.counters === "boolean") && (fight.counters !== when.counters) ) return false;
  if ( when.range ) {
    if ( (when.range.min != null) && (fight.distance < when.range.min) ) return false;
    if ( (when.range.max != null) && (fight.distance > when.range.max) ) return false;
  }
  if ( when.compare ) {
    const { left, right = left, margin = 1, reverse = false } = when.compare;
    const lead = readValue(self, left) - readValue(foe, right);
    if ( (reverse ? -lead : lead) < margin ) return false;
  }
  if ( when.foeAfflicted && !foe.afflicted ) return false;
  if ( when.foeLacks?.length && when.foeLacks.some((quality) => hasQuality(foe.qualities, quality)) ) return false;
  if ( when.foeNear ) {
    const found = unitsNearFoe(self.near ?? null, foe.near ?? null, when.foeNear);
    if ( !countHolds(found ? found.length : null, when.foeNear) ) return false;
  }
  if ( when.flanking && !alliesOpposite(self.near ?? null, foe.near ?? null)?.length ) return false;
  if ( when.sameSpace && !sharesSpace(self.near?.tile ?? null, foe.near?.tile ?? null) ) return false;
  if ( when.beyondReach && !(fight.distance > (self.weapon?.reach?.max ?? Infinity)) ) return false;
  return true;
}

/* -------------------------------------------- */
/*  Where Units Stand                           */
/* -------------------------------------------- */

/**
 * The units an effect counts for its numbers: every `count` among its parts.
 * @param {object} effect
 * @returns {import("./positions.mjs").NearFilter[]}
 */
export function placeCounts(effect) {
  const found = [];
  const search = (value, key) => {
    if ( Array.isArray(value) ) for ( const entry of value ) search(entry);
    else if ( value && (typeof value === "object") ) {
      if ( (key !== "when") && (key !== "aura") && value.count ) found.push(value.count);
      for ( const [name, entry] of Object.entries(value) ) if ( name !== "count" ) search(entry, name);
    }
  };
  search(effect);
  return found;
}

/* -------------------------------------------- */

/**
 * Does an effect hang on where units stand: a condition on the units around, a number that counts them, an
 * aura for them or a reach for them?
 * @param {object} effect
 * @returns {boolean}
 */
export function needsPlace(effect) {
  if ( !effect ) return false;
  if ( effect.aura || effect.reach ) return true;
  if ( [].concat(effect.grant ?? []).some((grant) => grant?.reach) ) return true;
  if ( PLACE_KEYS.some((key) => effect.when?.[key]) ) return true;
  return placeCounts(effect).length > 0;
}

/* -------------------------------------------- */

/**
 * Can it be judged where the units an effect asks about stand? Not for a unit that is not on the map, nor for
 * what is asked about a foe that is not, nor for sides of a foe on a map without a square grid.
 * @param {object} effect
 * @param {SkillSelf} self
 * @param {SkillFight|null} [fight]
 * @returns {boolean}
 */
export function seesPlace(effect, self, fight = null) {
  if ( !self.near ) return false;
  const when = effect.when ?? {};
  if ( (when.terrain !== undefined) && !self.near.ground ) return false;
  if ( fight && (when.foeNear || when.flanking || when.sameSpace) && !fight.foe.near ) return false;
  if ( fight && (when.flanking || when.sameSpace) && (!self.near.tile || !fight.foe.near.tile) ) return false;
  return true;
}

/* -------------------------------------------- */

/**
 * A condition without its parts that ask where units stand.
 * @param {object} [when]
 * @returns {object}
 */
export function withoutPlace(when) {
  return Object.fromEntries(Object.entries(when ?? {}).filter(([key]) => !PLACE_KEYS.includes(key)));
}

/* -------------------------------------------- */
/*  Reading Numbers                             */
/* -------------------------------------------- */

/**
 * Something a number can be read from.
 * @param {string} source
 * @param {SkillSelf} self
 * @param {SkillFight|null} fight
 * @returns {number}
 */
function readSource(source, self, fight) {
  if ( source?.startsWith?.("foe:") ) return fight?.foe.stats?.[source.slice(4)] ?? 0;
  if ( source?.startsWith?.("combat:") ) return self.combat?.[source.slice(7)] ?? 0;
  switch ( source ) {
    case "hp": return Math.max(self.hp ?? 0, 0);
    case "hpMax": return Math.max(self.hpMax ?? 0, 0);
    case "healed": return Math.max(self.healed ?? 0, 0);
    case "foeHpMax": return Math.max(fight?.foe.hpMax ?? 0, 0);
    case "attack": return self.combat?.damage ?? self.attack ?? 0;
    case "foeAttack": return fight?.foe.attack ?? 0;
    case "level": return self.level ?? 1;
    case "gold": return Math.max(self.gold ?? 0, 0);
    case "defOrRes": return Math.max(self.stats?.def ?? 0, self.stats?.res ?? 0);
    case "levelsApart": return Math.max(Math.abs((self.level ?? 1) - (fight?.foe.level ?? self.level ?? 1)), 1);
    case "weaponWeight": return self.weapon?.weight ?? 0;
    case "weaponMight": return self.weapon?.might ?? 0;
    case "hpMissing": return Math.max((self.hpMax ?? 0) - (self.hp ?? 0), 0);
    case "hpMissingPercent": return self.hpMax > 0 ? Math.max(((self.hpMax - self.hp) / self.hpMax) * 100, 0) : 0;
    case "accuracyOver100": return Math.max((self.accuracy ?? 0) - 100, 0);
    case "distanceBeyond1": return Math.max((fight?.distance ?? 1) - 1, 0);
    case "foeWeaponMight": return fight?.foe.weapon?.might ?? 0;
    case "foeWeaponHit": return fight?.foe.weapon?.hit ?? 0;
    case "foeWeaponCrit": return fight?.foe.weapon?.crit ?? 0;
    default: return self.stats?.[source] ?? 0;
  }
}

/* -------------------------------------------- */

/**
 * Work out a number an effect gives: a plain number, or one read from the unit.
 * `{ of, base, times, div, per, max, round }`: the source (its base value when `base` is set; several sources
 * added up when `of` is a list; with `count`, the number of units around the unit that it names), divided by
 * `div`, or counted in whole steps of `per`, then multiplied by `times`, rounded down (up with `round: "up"`),
 * with `plus` added and held at `max`.
 * @param {number|object} value
 * @param {SkillSelf} self
 * @param {SkillFight|null} [fight]
 * @returns {number}
 */
export function readNumber(value, self, fight = null) {
  if ( typeof value === "number" ) return value;
  if ( !value || (typeof value !== "object") ) return 0;
  let amount;
  if ( value.count ) amount = countNear(self.near ?? null, value.count) ?? 0;
  else if ( value.base ) amount = self.base?.[value.of] ?? 0;
  else if ( Array.isArray(value.of) ) amount = value.of.reduce((sum, source) => sum + readSource(source, self, fight), 0);
  else amount = readSource(value.of, self, fight);
  if ( value.per ) amount = Math.floor(amount / value.per);
  if ( value.div ) amount /= value.div;
  amount *= value.times ?? 1;
  amount = ((value.round === "up") ? Math.ceil(amount - 1e-9) : Math.floor(amount)) + (value.plus ?? 0);
  return (value.max != null) ? Math.min(amount, value.max) : amount;
}

/* -------------------------------------------- */

/**
 * Work out the numbers that are to be read from the unit that gives something to another: every number
 * marked `giver: true` among the parts given, however deep.
 * @param {*} value                   An effect, a part of one, or a list of them
 * @param {SkillSelf|(() => SkillSelf)} giver     The unit that gives it, or what describes it when asked
 * @returns {*}                       The same with those numbers worked out
 */
export function resolveGiven(value, giver) {
  if ( Array.isArray(value) ) return value.map((entry) => resolveGiven(entry, giver));
  if ( !value || (typeof value !== "object") ) return value;
  if ( value.giver ) {
    const { giver: marked, ...number } = value;
    return readNumber(number, (typeof giver === "function") ? giver() : giver, null);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveGiven(entry, giver)]));
}

/* -------------------------------------------- */

/**
 * Does a lasting change have a number that is read from the damage of the hit that grants it?
 * @param {*} value       A `grant`, a part of one, or a list of them
 * @returns {boolean}
 */
export function readsDealt(value) {
  if ( Array.isArray(value) ) return value.some(readsDealt);
  if ( !value || (typeof value !== "object") ) return false;
  return (value.of === "dealt") || Object.values(value).some(readsDealt);
}

/* -------------------------------------------- */

/**
 * Work out the numbers that are read from the damage a hit dealt: `{ of: "dealt", cap, div, times }` is that
 * damage, held at `cap`, divided, multiplied and rounded towards zero.
 * @param {*} value           The effects of a lasting change, a part of them, or a list
 * @param {number} dealt      The damage the hit dealt
 * @returns {*}               The same with those numbers worked out
 */
export function resolveDealt(value, dealt) {
  if ( Array.isArray(value) ) return value.map((entry) => resolveDealt(entry, dealt));
  if ( !value || (typeof value !== "object") ) return value;
  if ( value.of === "dealt" ) {
    const amount = (Math.min(Math.max(dealt, 0), value.cap ?? Infinity) / (value.div ?? 1)) * (value.times ?? 1);
    return Math.trunc(amount + (Math.sign(amount) * 1e-9));
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveDealt(entry, dealt)]));
}

/* -------------------------------------------- */
/*  Gathering Effects                           */
/* -------------------------------------------- */

/**
 * @typedef SkillTotals
 * What a unit's skills add up to.
 * @property {{name: string, stats?: object, combat?: object}[]} sources    What each skill adds to stats and
 *                                                                          combat stats, for the breakdowns
 * @property {Record<string, number>} stats
 * @property {Record<string, number>} combat      Including `activation`
 * @property {number} might
 * @property {number} taken
 * @property {number} takenMultiplier             What the damage of hits the unit takes is multiplied by
 * @property {number} foeActivation               Added to the Skill Activation rate of a foe in a fight
 * @property {number} haste                       Counted as Attack Speed for the unit's own follow-up attack
 * @property {number} mirrorCrit                  The most Critical the unit gains for its own chance of being
 *                                                critically hit
 * @property {number|null} critMultiplier         What the damage of its critical hits is multiplied by, when a
 *                                                skill says so
 * @property {number} slots                       More skills it may have equipped at once
 * @property {number} capacity                    More Capacity Points
 * @property {number} artCost                     Added to each cost of the Combat Arts it performs
 * @property {number} hpMax
 * @property {Record<string, string>} calc
 * @property {{skill: string, stats: Record<string, number>}[]} foeStats
 *                                                What each skill adds to the stats the foe fights with
 * @property {Set<string>} rules
 * @property {string[]} effective
 * @property {number|null} effectiveMultiplier
 * @property {number} damageMultiplier
 * @property {number} ignoreDefence               A share, in percent
 * @property {number} strikes
 * @property {{name: string, percent: number}[]} extraAttacks
 * @property {{skill: string, effect: object}[]} procs    The effects that have a chance to activate, as written
 * @property {{id?: string, name: string}[]} declared     The declared skills that had a say, which a fight spends
 * @property {string[]} applied                   The names of the skills that did something worth telling:
 *                                                an effect with a condition, or one that bends a rule. A boost
 *                                                that is simply always there is not listed
 * @property {string[]} auras                     The auras of units around that changed the unit's numbers,
 *                                                each named with its skill and the unit that gives it
 * @property {string[]} lasting                   The changes that last a while which changed the unit's
 *                                                numbers, each named with its skill and where it comes from
 * @property {{skill: string, unseen: boolean}[]} checks
 *                                                The skills with an effect that is shown and not applied, for
 *                                                the table to check: `unseen` when that is because the unit
 *                                                is not on the map
 * @property {{add?: number, min?: number, max?: number}[]} ranges
 *                                                What changes how far the weapon in hand attacks
 * @property {string|null} damageStat             The stat added to the weapon's Might, when a skill names one
 * @property {{hit: number, noDamage: number}} foeWear
 *                                                Uses a foe's weapon loses on top for each hit on the unit
 * @property {number} wield                       Weapon ranks above its own the unit may wield
 * @property {import("./conditions.mjs").ConditionBends} bends
 *                                                How the unit's skills bend the rules of conditions
 */

/**
 * Nothing bent about the rules of conditions.
 * @returns {import("./conditions.mjs").ConditionBends}
 */
export function emptyBends() {
  return {
    inflictChance: {}, inflictTurns: {}, nullify: [], suffers: {}, recovery: 1,
    debuffs: { stats: 0, combat: 0, negate: false, skills: [] }, burstHarm: {}
  };
}

/* -------------------------------------------- */

/**
 * How a unit's skills bend the rules of conditions: what they add to the chances and the turns of those it
 * inflicts, what may nullify those that would be applied to it, what those it suffers from do to it, how fast
 * they run out, and what is taken off the penalties put on it. Read from the effects that are always there and
 * whose condition holds. What is taken off penalties is the unit's own to give: neither an aura nor a change
 * from another unit grants it.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @param {object} [options]
 * @param {SkillFight|null} [options.fight]
 * @param {boolean} [options.foeNihil]      Does the foe cancel the skills that Nihil cancels?
 * @returns {import("./conditions.mjs").ConditionBends}
 */
export function conditionBends(skills, self, { fight = null, foeNihil = false } = {}) {
  self = withSkillNames(self, skills, foeNihil);
  const bends = emptyBends();
  const note = (list, name) => {
    if ( !list.includes(name) ) list.push(name);
  };
  for ( const skill of skills ?? [] ) {
    if ( foeNihil && skill.nihil ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc || effect.aura || !BEND_KEYS.some((key) => effect[key] !== undefined) ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self, fight) ) continue;
      for ( const [id, amount] of Object.entries(effect.inflictChance ?? {}) ) bends.inflictChance[id] = (bends.inflictChance[id] ?? 0) + amount;
      for ( const [id, amount] of Object.entries(effect.inflictTurns ?? {}) ) bends.inflictTurns[id] = (bends.inflictTurns[id] ?? 0) + amount;
      if ( effect.nullify !== undefined ) {
        const ward = (typeof effect.nullify === "number") ? { percent: effect.nullify } : (effect.nullify ?? {});
        bends.nullify.push({ skill: skill.name, percent: ward.percent ?? 0, ...(ward.only ? { only: ward.only } : {}) });
      }
      for ( const [id, bend] of Object.entries(effect.suffers ?? {}) ) {
        const into = (bends.suffers[id] ??= { damage: 1, penalties: 1, tick: 0, stays: false, burst: null, damageBy: [], penaltiesBy: [] });
        into.damage *= bend.damage ?? 1;
        into.penalties *= bend.penalties ?? 1;
        into.tick += bend.tick ?? 0;
        into.stays ||= !!bend.stays;
        if ( bend.burst ) into.burst ??= skill.name;
        if ( ((bend.damage ?? 1) !== 1) || bend.tick ) note(into.damageBy, skill.name);
        if ( (bend.penalties ?? 1) !== 1 ) note(into.penaltiesBy, skill.name);
      }
      if ( effect.recovery > bends.recovery ) Object.assign(bends, { recovery: effect.recovery, recoveryBy: skill.name });
      if ( effect.debuffs && !skill.aura && !skill.foreign ) {
        bends.debuffs.stats += effect.debuffs.stats ?? 0;
        bends.debuffs.combat += effect.debuffs.combat ?? 0;
        bends.debuffs.negate ||= !!effect.debuffs.negate;
        note(bends.debuffs.skills, skill.name);
      }
      for ( const id of effect.burstHarm ?? [] ) bends.burstHarm[id] ??= skill.name;
    }
  }
  return bends;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of the penalties of the conditions it suffers from, as what they add back to the
 * numbers the conditions lower: a penalty multiplied as a skill says, then lessened by what is taken off
 * incoming penalties. One source for each condition that is bent, named after the skills that bend it.
 * @param {import("./conditions.mjs").ConditionBends} bends
 * @param {Record<string, number>} [conditions]     The unit's conditions and the turns each has left
 * @returns {{name: string, stats: Record<string, number>, combat: Record<string, number>, skills: string[]}[]}
 */
export function sufferedSources(bends, conditions) {
  const sources = [];
  for ( const { id, stats, combat } of conditionModifiers(conditions ?? {}) ) {
    const bend = bends.suffers[id];
    const factor = bend?.penalties ?? 1;
    const skills = [];
    const note = (list) => {
      for ( const name of list ?? [] ) if ( !skills.includes(name) ) skills.push(name);
    };

    // What a penalty becomes, less what it was. A share of a penalty is rounded down, the usual way
    const change = (kind, amount) => {
      if ( !(amount < 0) ) return 0;
      let now = amount;
      if ( factor !== 1 ) {
        const share = Math.floor((-amount * Math.abs(factor)) + 1e-9);
        now = (factor < 0) ? share : -share;
        note(bend.penaltiesBy);
      }
      if ( now < 0 ) {
        const less = bends.debuffs.negate ? -now : Math.min(bends.debuffs[kind] ?? 0, -now);
        if ( less > 0 ) {
          now += less;
          note(bends.debuffs.skills);
        }
      }
      return now - amount;
    };
    const source = { name: "", stats: {}, combat: {}, skills };
    for ( const [key, amount] of Object.entries(stats ?? {}) ) {
      const more = change("stats", amount);
      if ( more ) source.stats[key] = more;
    }
    for ( const [key, amount] of Object.entries(combat ?? {}) ) {
      const more = change("combat", amount);
      if ( more ) source.combat[key] = more;
    }
    if ( !Object.keys(source.stats).length && !Object.keys(source.combat).length ) continue;
    source.name = skills.join(", ");
    sources.push(source);
  }
  return sources;
}

/**
 * An empty set of totals.
 * @returns {SkillTotals}
 */
export function emptyTotals() {
  return {
    sources: [], stats: {}, combat: {}, might: 0, taken: 0, takenMultiplier: 1, foeActivation: 0, hpMax: 0, calc: {}, rules: new Set(),
    haste: 0, mirrorCrit: 0, critMultiplier: null, slots: 0, capacity: 0, artCost: 0,
    effective: [], effectiveMultiplier: null, damageMultiplier: 1, ignoreDefence: 0, strikes: 1, extraAttacks: [],
    procs: [], declared: [], applied: [], auras: [], lasting: [], checks: [], foeStats: [],
    ranges: [], damageStat: null, foeWear: { hit: 0, noDamage: 0 }, wield: 0, bends: emptyBends()
  };
}

/* -------------------------------------------- */

/**
 * The effects of a skill as the rules read them: its structured effects that match its chosen variant, with
 * the flat boosts typed on the skill itself as one more effect that always applies.
 * @param {object} skill      Skill data: effects, choice, stats, combat
 * @returns {object[]}
 */
export function effectsOf(skill) {
  const effects = (skill.effects ?? []).filter((effect) => !effect.choice || (effect.choice === skill.choice));
  const nonZero = (object) => Object.fromEntries(Object.entries(object ?? {}).filter(([, value]) => value));
  const stats = nonZero(skill.stats);
  const combat = nonZero(skill.combat);
  if ( Object.keys(stats).length || Object.keys(combat).length ) effects.unshift({ stats, combat });
  return effects;
}

/* -------------------------------------------- */

/**
 * The variants a skill offers, read from its effects.
 * @param {object[]} [effects]
 * @returns {string[]}
 */
export function choicesOf(effects = []) {
  return [...new Set(effects.map((effect) => effect.choice).filter(Boolean))];
}

/* -------------------------------------------- */

/**
 * The Special Qualities a skill lets its unit take on and put off at will, read from its effects, and whether
 * the unit has each of them now.
 * @param {object[]} [effects]
 * @param {string} [qualities]    The unit's Special Qualities, as free text
 * @returns {{name: string, on: boolean}[]}
 */
export function formsOf(effects = [], qualities = "") {
  const names = effects.filter((effect) => effect?.form).flatMap((effect) => effect.when?.quality ?? []);
  return [...new Set(names)].map((name) => ({ name, on: hasQuality(qualities, name) }));
}

/* -------------------------------------------- */

/**
 * A unit's Special Qualities once it takes one on that it has not, or puts off one that it has.
 * @param {string} [qualities]    The unit's Special Qualities, as free text
 * @param {string} quality
 * @returns {string}
 */
export function switchForm(qualities, quality) {
  const parts = String(qualities ?? "").split(/[,;\n]/).map((part) => part.trim());
  const kept = (part) => part && !/^(none|n\/?a|-+|–|—)$/i.test(part);
  if ( !hasQuality(qualities, quality) ) return [...parts.filter(kept), quality].join(", ");

  // The quality may stand beside another in one part, as in "Mounted/Flying"
  const escaped = quality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^a-z])${escaped}(?=[^a-z]|$)`, "ig");
  return parts.map((part) => {
    return part.replace(word, "$1").replace(/\s*([/&])[\s/&]*/g, "$1").replace(/^[\s/&]+|[\s/&]+$/g, "").replace(/\s{2,}/g, " ");
  }).filter(kept).join(", ");
}

/* -------------------------------------------- */

/**
 * Add up what a unit's skills do.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @param {object} [options]
 * @param {SkillFight|null} [options.fight]       The fight the unit is in, if any
 * @param {boolean} [options.foeNihil]            Does the foe cancel the skills that Nihil cancels?
 * @param {"early"|"late"|"all"} [options.phase]  Which effects to read: those that do not wait for the
 *                                                counter-attacks to be settled, those that do, or all
 * @param {SkillTotals} [options.into]            Totals to add to
 * @returns {SkillTotals}
 */
export function skillTotals(skills, self, { fight = null, foeNihil = false, phase = "all", into = null } = {}) {
  self = withSkillNames(self, skills, foeNihil);
  const totals = into ?? emptyTotals();
  const add = (target, key, amount) => {
    if ( amount ) target[key] = (target[key] ?? 0) + amount;
  };
  const check = (name, unseen) => {
    const noted = totals.checks.find((entry) => entry.skill === name);
    if ( noted ) noted.unseen ||= unseen;
    else totals.checks.push({ skill: name, unseen });
  };

  // How the skills bend the rules of conditions is read first: what they take off incoming penalties is
  // needed as the rest is read. What they make of the penalties of the unit's own conditions is added to its
  // numbers like any other skill effect
  if ( !into ) {
    totals.bends = conditionBends(skills, self, { fight, foeNihil });
    for ( const { skills: names, ...source } of sufferedSources(totals.bends, self.conditions) ) {
      for ( const [key, amount] of Object.entries(source.stats) ) add(totals.stats, key, amount);
      for ( const [key, amount] of Object.entries(source.combat) ) add(totals.combat, key, amount);
      totals.sources.push(source);
      for ( const name of names ) if ( !totals.applied.includes(name) ) totals.applied.push(name);
    }
  }

  for ( const skill of skills ?? [] ) {
    if ( foeNihil && skill.nihil ) continue;

    // A skill that takes effect by itself and counts its uses does nothing once they are spent
    const left = (skill.usage?.kind === "auto") ? usesLeft(skill.usage, skill.state) : undefined;
    if ( left === 0 ) continue;
    const source = { name: skill.name, stats: {}, combat: {} };
    let applied = false;
    let notable = false;

    // A penalty that comes from elsewhere, an aura or a change another unit left on this one, is lessened by
    // what the unit's skills take off incoming penalties
    const incoming = !!(skill.aura || skill.foreign);
    const ease = (kind, amount) => {
      const relief = totals.bends?.debuffs;
      if ( !incoming || !relief || !(amount < 0) ) return amount;
      const eased = relief.negate ? 0 : Math.min(amount + (relief[kind] ?? 0), 0);
      if ( eased !== amount ) for ( const name of relief.skills ) if ( !totals.applied.includes(name) ) totals.applied.push(name);
      return eased;
    };

    for ( const effect of skill.effects ?? [] ) {
      const late = isLate(effect.when);
      if ( (phase === "early") && late ) continue;
      if ( (phase === "late") && !late ) continue;

      // An effect of a skill that is chosen when to activate waits for the skill to be switched on
      if ( effect.when?.declared && !skill.active ) continue;

      // What hangs on where units stand cannot be judged for a unit that is not on the map: the skill is
      // shown as one to check by hand. Only what an aura gives its own unit applies all the same
      // A moment that only reaches for the units around with what it grants still comes: its unit's own share
      // is given, and the rest is announced when the moment does
      const placed = needsPlace(effect);
      const reaching = !!effect.proc && !effect.aura && !effect.reach && !PLACE_KEYS.some((key) => effect.when?.[key]) && !placeCounts(effect).length;
      if ( placed && !reaching && !seesPlace(effect, self, fight) ) {
        if ( holds(withoutPlace(effect.when), self, fight) ) check(skill.name, true);
        if ( !effect.aura?.self ) continue;
      }
      if ( !holds(effect.when, self, fight) ) continue;

      // What an aura gives is for the units around, which receive it as an effect of their own
      if ( effect.aura && !effect.aura.self ) continue;

      // What hangs on something the system cannot see at all is shown, not applied
      if ( (effect.remind === "check") && !effect.proc ) {
        check(skill.name, false);
        continue;
      }

      // A number that counts the units around adds nothing when there are none
      const counted = placeCounts(effect);
      if ( counted.length && counted.every((filter) => !countNear(self.near ?? null, filter)) ) continue;
      if ( effect.when?.declared && skill.spends && !totals.declared.some((entry) => entry.name === skill.name) ) {
        totals.declared.push({ id: skill.id, name: skill.name });
      }

      // An effect with a chance to activate is kept for the fight to roll
      if ( effect.proc ) {
        // What comes from the aura of another unit keeps the name of its skill and of that unit. A skill that
        // counts its own uses says how many it has left
        const counted = (left !== undefined) ? { uses: { id: skill.id ?? null, name: skill.name, left } } : {};
        totals.procs.push(skill.aura ? { skill: skill.name, effect, source: skill.skill, giver: skill.giver } : { skill: skill.name, effect, ...counted });
        continue;
      }

      // What a skill changes about how its unit changes form is read ahead of its numbers (see `shifting.mjs`),
      // and gives the skill nothing to tell here
      if ( (effect.shift !== undefined) && Object.keys(effect).every((key) => ["shift", "when", "choice"].includes(key)) ) continue;

      // Where a skill warps its unit to is read when the skill is used (see `warp.mjs`)
      if ( (effect.warp !== undefined) && Object.keys(effect).every((key) => key === "warp") ) continue;

      // What only speaks to staves is read when a staff is used (see `staves.mjs`)
      if ( STAFF_KEYS.some((key) => effect[key] !== undefined) && Object.keys(effect).every((key) => [...STAFF_KEYS, "when", "choice"].includes(key)) ) continue;
      applied = true;
      notable ||= placed || (Object.keys(effect.when ?? {}).length > 0)
        || NOTABLE.some((key) => {
          if ( (effect[key] === undefined) || (effect[key] === null) ) return false;
          return (key !== "rules") || !effect.rules.every((rule) => QUIET_RULES.includes(rule));
        });
      const scale = effect.scale ? readNumber(effect.scale, self, fight) : 1;
      const number = (value) => readNumber(value, self, fight) * scale;

      for ( const [key, value] of Object.entries(effect.stats ?? {}) ) {
        const amount = ease("stats", number(value));
        add(source.stats, key, amount);
        add(totals.stats, key, amount);
      }
      for ( const [key, percent] of Object.entries(effect.statPercent ?? {}) ) {
        const amount = ease("stats", Math.floor(((self.stats?.[key] ?? 0) * percent) / 100) * scale);
        add(source.stats, key, amount);
        add(totals.stats, key, amount);
      }
      for ( const [key, value] of Object.entries(effect.combat ?? {}) ) {
        if ( !COMBAT_KEYS.includes(key) ) continue;
        const amount = ease("combat", number(value));
        add(source.combat, key, amount);
        add(totals.combat, key, amount);
      }
      if ( effect.might ) {
        add(source.combat, "damage", number(effect.might));
        totals.might += number(effect.might);
      }
      if ( effect.taken ) totals.taken += number(effect.taken);
      if ( effect.takenPercent ) totals.takenMultiplier *= Math.max(1 + (effect.takenPercent / 100), 0);
      if ( effect.endurance ) totals.taken -= number(effect.endurance);
      if ( effect.haste ) totals.haste += number(effect.haste);
      if ( effect.mirrorCrit ) totals.mirrorCrit = Math.max(totals.mirrorCrit, number(effect.mirrorCrit));
      if ( effect.critMultiplier ) totals.critMultiplier = Math.max(totals.critMultiplier ?? 0, effect.critMultiplier);
      if ( effect.slots ) totals.slots += number(effect.slots);
      if ( effect.capacity ) totals.capacity += number(effect.capacity);
      if ( effect.artCost ) totals.artCost += number(effect.artCost);
      if ( effect.dealtPercent ) totals.damageMultiplier *= Math.max(1 + ((effect.dealtPercent * scale) / 100), 0);
      if ( effect.foeActivation ) totals.foeActivation += number(effect.foeActivation);
      if ( effect.hpMax ) totals.hpMax += number(effect.hpMax);
      Object.assign(totals.calc, effect.calc ?? {});
      if ( effect.foeStats && fight ) {
        const lowered = Object.fromEntries(Object.entries(effect.foeStats).map(([key, value]) => [key, number(value)]));
        totals.foeStats.push({ skill: skill.name, stats: lowered });
      }
      for ( const rule of effect.rules ?? [] ) totals.rules.add(rule);
      for ( const quality of effect.effective ?? [] ) {
        if ( !totals.effective.includes(quality) ) totals.effective.push(quality);
      }
      if ( effect.effectiveMultiplier ) {
        totals.effectiveMultiplier = Math.max(totals.effectiveMultiplier ?? 0, effect.effectiveMultiplier);
      }
      if ( effect.damageMultiplier ) totals.damageMultiplier *= effect.damageMultiplier;
      if ( effect.ignoreDefence ) totals.ignoreDefence = Math.max(totals.ignoreDefence, effect.ignoreDefence);
      if ( effect.strikes ) totals.strikes = Math.max(totals.strikes, effect.strikes);
      if ( effect.extraAttack ) totals.extraAttacks.push({ name: skill.name, percent: effect.extraAttack.percent ?? 100 });
      if ( effect.weaponRange ) totals.ranges.push({ ...effect.weaponRange });
      if ( effect.damageStat ) totals.damageStat = effect.damageStat;
      if ( effect.foeWear ) {
        totals.foeWear.hit += effect.foeWear.hit ?? 0;
        totals.foeWear.noDamage += effect.foeWear.noDamage ?? 0;
      }
      if ( effect.wield ) totals.wield += number(effect.wield);
    }

    if ( !applied ) continue;
    if ( skill.aura ) {
      if ( !totals.auras.includes(skill.name) ) totals.auras.push(skill.name);
    }
    else if ( skill.timed ) {
      if ( !totals.lasting.includes(skill.name) ) totals.lasting.push(skill.name);
    }
    else if ( notable && !totals.applied.includes(skill.name) ) totals.applied.push(skill.name);
    if ( Object.keys(source.stats).length || Object.keys(source.combat).length ) totals.sources.push(source);
  }
  return totals;
}

/* -------------------------------------------- */

/**
 * Does any of a unit's skills cancel the foe's skills, as Nihil does?
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @returns {boolean}
 */
export function hasNihil(skills, self) {
  return (skills ?? []).some((skill) => (skill.effects ?? []).some((effect) => {
    return effect.rules?.includes("nihil") && holds(effect.when, self, null);
  }));
}

/* -------------------------------------------- */
/*  Chances to Activate                         */
/* -------------------------------------------- */

/**
 * @typedef ProcPart
 * What an activated proc does to one attack.
 * @property {number} damage              Added to the attack's damage
 * @property {number} damagePercent       A share of the damage before defence, added to it
 * @property {number} damageMultiplier
 * @property {{percent: number, stat?: "def"|"res"}|null} ignore
 * @property {number} hit
 * @property {number} critical
 * @property {number} heal                A share of the damage dealt, in percent
 * @property {boolean|"ifAny"} sureHit
 * @property {{id: string, upgrade?: {id: string, chance: number}, dice?: number}[]} inflicts
 * @property {number|null} share          What the attack's damage is multiplied by, in a sequence
 * @property {boolean} end                Does the fight end there if the attack hits?
 * @property {string} skill               The skill the part belongs to
 */

/**
 * @typedef {ProcPart & object} Proc
 * A chance to activate, with every number worked out for the fight at hand.
 * @property {string} skill
 * @property {"attack"|"struck"|"start"|"hit"|"crit"|"miss"|"dodged"|"kill"|"after"} on
 * @property {number} chance                      In percent, with the unit's Skill Activation rate
 * @property {boolean} sure                       Does it happen without a roll?
 * @property {Record<string, number>} next        Added to the unit's next attack: hit, damage, critical
 * @property {Record<string, number>} nextOfDamage    The same, as shares of the damage of the hit taken
 * @property {{within: number, next: Record<string, number>}|null} near
 * @property {boolean} nonlethal
 * @property {number} recover
 * @property {number} gold                        Gold the unit gains
 * @property {number} gaugeOfDamage               On a critical hit: the share, in percent, of the damage the hit
 *                                                would have dealt uncritical that its Shift Gauge gains
 * @property {boolean} freeUses                 Does the unit's weapon lose no use in this fight?
 * @property {boolean} attack
 * @property {boolean|"foe"} remind
 * @property {boolean} damaged
 * @property {boolean} ifHit
 * @property {boolean} ifStruck
 * @property {ProcPart[]|null} sequence           The attacks an attack turns into
 * @property {boolean} oneUse
 * @property {number} negate
 * @property {number} reduce
 * @property {number} reflect
 * @property {number} retaliate
 * @property {string[]} inflictsAttacker
 * @property {boolean|{hp: {op: string, percent?: number}}} survive
 *                                                A fatal hit is halved and leaves 1 HP if it is still fatal;
 *                                                or, with an HP test, leaves 1 HP for a unit that passes it
 * @property {{id: string|null, name: string, left: number|null}|null} uses
 *                                                Set for a skill that counts a use each time it takes effect:
 *                                                how often it still can, null for no limit
 * @property {Record<string, number>} combat
 * @property {Record<string, number>} foeCombat
 * @property {{def?: number, res?: number}|null} shield
 *                                                The DEF and RES a hit is dealt against where they are more
 *                                                than the unit's own
 */

/**
 * What a chance that is read from a stat is read from: the stat, what it is divided by and what it is
 * multiplied by. That is what the skill says, unless the world plays with Alternate Skill Activation. A chance
 * that comes to less than the whole stat is then the whole stat, and in the reading by level a chance read
 * from Dexterity is read from the unit's level instead. Only a unit's own stats are meant: a chance read from
 * a combat stat or from the foe stays as the skill words it.
 * @param {{stat?: string, div?: number, times?: number}} proc
 * @returns {{stat: string|undefined, div: number, times: number, changed: boolean}}
 *          `changed` when the module made something else of it
 */
export function activationOf(proc) {
  const basis = { stat: proc.stat, div: proc.div ?? 1, times: proc.times ?? 1, changed: false };
  const rule = FEO.optional?.alternateActivation;
  if ( !rule?.enabled || !basis.stat || String(basis.stat).includes(":") ) return basis;
  if ( (basis.times / basis.div) < 1 ) Object.assign(basis, { div: 1, times: 1, changed: true });
  if ( (rule.mode === "level") && (basis.stat === rule.replaces) ) Object.assign(basis, { stat: rule.level, changed: true });
  return basis;
}

/* -------------------------------------------- */

/**
 * The chance a skill rolls to activate with, as the skill words it: that of the first of its effects the
 * system rolls for or, for a skill without one, that of its activation fields.
 * @param {object} skill                A skill's data
 * @param {object[]} [skill.effects]
 * @param {string} [skill.choice]       The variant taken of a skill that offers several
 * @param {boolean} [skill.automate]    False for a skill the table runs by hand, whose effects are not read
 * @param {{stat?: string, divisor?: number}} [skill.activation]
 * @returns {object|null}               Null for a skill that does not roll to activate
 */
export function rolledProc({ effects = [], choice = "", automate = true, activation = null } = {}) {
  const rolled = (automate !== false)
    ? (effects ?? []).find((effect) => effect.proc && !effect.proc.sure && (!effect.choice || (effect.choice === choice)))
    : null;
  if ( rolled ) return rolled.proc;
  return activation?.stat ? { stat: activation.stat, div: activation.divisor ?? 1 } : null;
}

/* -------------------------------------------- */

/**
 * The chance of a proc, in percent: a fixed one, or a stat divided and multiplied as the skill says, with the
 * unit's Skill Activation rate added and the whole held between 0 and 100. A chance marked `fixed` is what it
 * says, whatever that rate and whatever makes skills always activate. Where the world plays with Alternate
 * Skill Activation, a chance read from a stat is read as that module has it (see `activationOf`).
 * @param {{percent?: number, stat?: string, div?: number, times?: number, fixed?: boolean}} proc
 * @param {SkillSelf & {combat?: object}} self
 * @param {SkillFight|null} [fight]
 * @param {object} [options]
 * @param {number} [options.activation]     The unit's Skill Activation rate
 * @param {boolean} [options.always]        Do the unit's skills always activate?
 * @param {number} [options.raised]         What the unit's skills add to its chance of inflicting the
 *                                          condition this one inflicts, which a fixed chance gains as well
 * @param {boolean} [options.asWritten]     Is the chance no activation of a skill, so that it is read as
 *                                          the skill words it whatever the world plays with?
 * @returns {number}
 */
export function chanceOf(proc, self, fight = null, { activation = 0, always = false, raised = 0, asWritten = false } = {}) {
  if ( proc.sure ) return 100;
  if ( proc.fixed ) return Math.min(Math.max((proc.percent ?? 0) + raised, 0), 100);
  if ( always ) return 100;
  let rate = proc.percent;
  if ( rate == null ) {
    const { stat, div, times } = asWritten ? { stat: proc.stat, div: proc.div ?? 1, times: proc.times ?? 1 } : activationOf(proc);
    rate = Math.floor((readSource(stat, self, fight) / div) * times);
  }
  return Math.min(Math.max(rate + activation + raised, 0), 100);
}

/* -------------------------------------------- */

/**
 * Work out a chance to activate for the fight at hand.
 * @param {{skill: string, effect: object}} raw     As `skillTotals` collects it
 * @param {SkillSelf & {combat?: object}} self      The unit, with the stats and combat stats it fights with
 * @param {SkillFight|null} fight
 * @param {object} [options]
 * @param {number} [options.activation]     The unit's Skill Activation rate
 * @param {boolean} [options.always]        Do the unit's skills always activate?
 * @param {Record<string, number>} [options.inflictChance]
 *                                          What the unit's skills add to its chances of inflicting conditions
 * @returns {Proc}
 */
export function resolveProc({ skill, effect, source = null, giver = "", uses = null }, self, fight, { activation = 0, always = false, inflictChance = null } = {}) {
  const proc = effect.proc;
  const number = (value) => {
    if ( Array.isArray(value) ) return value.reduce((sum, entry) => sum + readNumber(entry, self, fight), 0);
    return readNumber(value ?? 0, self, fight);
  };

  // A chance that is rolled for and inflicts a condition gains what the unit's skills add to that condition's
  // chances: the most any of the conditions it inflicts gains
  const inflicted = [effect, ...(effect.sequence ?? [])].flatMap((part) => part.inflicts ?? [])
    .flatMap((entry) => ((typeof entry === "string") ? entry : (entry?.anyOf ?? entry?.id))).concat(effect.inflictsAttacker ?? []);
  const raised = (proc.sure || !inflictChance) ? 0 : inflicted.reduce((most, id) => Math.max(most, inflictChance[id] ?? 0), 0);
  const chance = chanceOf(proc, self, fight, { activation, always, raised });

  // The second roll of a condition that may turn into a worse one is no activation of the skill: it does not
  // gain the Skill Activation rate, and Alternate Skill Activation leaves it as the skill words it
  const part = (given) => {
    let damage = number(given.damage);
    for ( const [stat, times] of Object.entries(given.statTimes ?? {}) ) {
      if ( (self.weapon?.damageStat ?? "str") === stat ) damage += (self.stats?.[stat] ?? 0) * (times - 1);
    }
    return {
      damage,
      damagePercent: given.damagePercent ?? 0,
      foeHpPercent: given.damageOfFoeHp ?? 0,
      damageMultiplier: given.damageMultiplier ?? 1,
      ignore: given.ignore ?? null,
      hit: number(given.hit),
      critical: number(given.critical),
      heal: given.heal ?? 0,
      sureHit: given.sureHit ?? false,
      inflicts: (given.inflicts ?? []).map((entry) => {
        if ( typeof entry === "string" ) return { id: entry };

        // One of several, picked by a die when the attack lands
        if ( entry.anyOf ) return { id: entry.anyOf[0], anyOf: [...entry.anyOf] };
        const upgrade = entry.upgrade ? { id: entry.upgrade.id, chance: chanceOf(entry.upgrade, self, fight, { always, asWritten: true }) } : undefined;
        const dice = entry.dice ? { dice: entry.dice } : (entry.turns ? { turns: entry.turns } : {});
        return upgrade ? { id: entry.id, upgrade, ...dice } : { id: entry.id, ...dice };
      }),
      share: given.share ?? null,
      end: !!given.end,
      skill
    };
  };
  const numbers = (object) => Object.fromEntries(Object.entries(object ?? {}).map(([key, value]) => [key, number(value)]));
  const retaliate = effect.retaliate
    ? Math.max(number(effect.retaliate) - (effect.resist ? (fight?.foe.stats?.[effect.resist] ?? 0) : 0), 0)
    : 0;

  return {
    skill,
    on: proc.on,
    chance,
    sure: !!proc.sure,
    once: !!proc.once,

    // At the moments a condition is inflicted: the conditions the skill waits for, and for how many turns the
    // unit hands the condition back to its foe
    conditions: (proc.condition !== undefined) ? [].concat(proc.condition) : null,
    returns: effect.returns ?? 0,
    next: numbers(effect.next),
    nextOfDamage: { ...(effect.nextOfDamage ?? {}) },
    near: effect.near ? { within: effect.near.within ?? 0, next: numbers(effect.near.next) } : null,
    nonlethal: !!effect.nonlethal,
    recover: number(effect.recover),
    gold: Math.max(number(effect.gold), 0),
    gaugeOfDamage: effect.gaugeOfDamage ?? 0,
    freeUses: !!effect.freeUses,
    attack: !!effect.attack,
    remind: effect.remind ?? false,

    // Changes that last a while, with the numbers that are read from this unit worked out
    grants: [].concat(effect.grant ?? []).map((grant) => {
      const given = { ...grant, effects: resolveGiven(grant.effects ?? [], self) };
      if ( grant.pick ) given.pick = grant.pick.map((option) => ({ ...option, effects: resolveGiven(option.effects ?? [], self) }));
      return given;
    }),
    source: source ?? skill,
    giver,
    damaged: !!effect.damaged,
    ifHit: !!effect.ifHit,
    ifStruck: !!effect.ifStruck,
    ...part(effect),
    sequence: effect.sequence ? effect.sequence.map(part) : null,
    oneUse: !!effect.oneUse,
    negate: effect.negate ?? 0,
    reduce: number(effect.reduce),
    reflect: effect.reflect ?? 0,
    retaliate,
    inflictsAttacker: effect.inflictsAttacker ?? [],
    survive: (effect.survive && (typeof effect.survive === "object")) ? { hp: { ...(effect.survive.hp ?? {}) } } : !!effect.survive,
    uses,
    shield: effect.shield ? numbers(effect.shield) : null,
    combat: numbers(effect.combat),
    foeCombat: numbers(effect.foeCombat)
  };
}

/* -------------------------------------------- */
/*  Moments of a Turn                           */
/* -------------------------------------------- */

/**
 * The effects of a unit's skills that wait for a moment of its turn and whose condition holds.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf & {waiting?: boolean}} self
 * @param {"turnStart"|"turnEnd"|"wait"} moment
 * @param {object} [options]
 * @param {Record<string, number>|null} [options.conditions]    The conditions the unit suffers from, where
 *                                                              that is known
 * @returns {{skill: string, effect: object, unseen?: boolean}[]}   `unseen` for an effect that hangs on where
 *          units stand, of a unit that is not on the map: it is shown, for the table to check
 */
export function turnEffects(skills, self, moment, { conditions = null } = {}) {
  self = withSkillNames(self, skills);
  const found = [];
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.when?.declared && !skill.active ) continue;

      // What an aura gives at a moment of a turn comes at that moment of the turn of each unit that receives it
      if ( (effect.proc?.on !== moment) || effect.aura ) continue;
      const unseen = needsPlace(effect) && !seesPlace(effect, self, null);
      if ( !holds(unseen ? withoutPlace(effect.when) : effect.when, self, null) ) continue;

      // What only cures conditions has nothing to do for a unit that suffers from none of them
      const curesOnly = (effect.cure !== undefined) && Object.keys(effect).every((key) => ["proc", "when", "cure"].includes(key));
      if ( curesOnly && conditions && !curedOf(effect.cure, conditions).length ) continue;

      // With nobody in reach there is nothing to do
      if ( effect.reach && !unseen && !reached(self, effect.reach).length ) continue;
      const grants = [].concat(effect.grant ?? []);
      if ( grants.length && !unseen && grants.every((grant) => grant.reach && !reached(self, grant.reach).length) ) continue;
      const entry = unseen ? { skill: skill.name, effect, unseen } : { skill: skill.name, effect };
      if ( skill.aura ) Object.assign(entry, { source: skill.skill, giver: skill.giver });
      found.push(entry);
    }
  }
  return found;
}

/* -------------------------------------------- */

/**
 * The units around a unit that an effect reaches at a moment of its turn: those that still stand.
 * @param {SkillSelf} self
 * @param {import("./positions.mjs").NearFilter} reach
 * @returns {import("./positions.mjs").Neighbour[]}
 */
function reached(self, reach) {
  return (unitsNear(self.near ?? null, reach) ?? []).filter((other) => (other.hp ?? 1) > 0);
}

/* -------------------------------------------- */

/**
 * The conditions a unit suffers from that an effect cures it of.
 * @param {"all"|string[]} cure                   Every condition, or the ones named
 * @param {Record<string, number>} conditions     The conditions the unit suffers from
 * @returns {string[]}
 */
function curedOf(cure, conditions) {
  const suffered = Object.keys(conditions ?? {});
  return (cure === "all") ? suffered : suffered.filter((id) => [].concat(cure ?? []).includes(id));
}

/* -------------------------------------------- */

/**
 * @typedef TurnMoment
 * @property {number} hpBefore
 * @property {number} hp                      HP once the skills have healed the unit
 * @property {number} healed
 * @property {{skill: string, sure: boolean, roll: number|null, chance: number, success: boolean, recover: number,
 *   healed: number, remind: boolean|string, cured?: string[],
 *   reached?: {id: string, name: string, hpBefore: number, hp: number, healed: number}[],
 *   granted?: {unit: string|null, name: string, change: import("./timed.mjs").TimedChange}[]}[]} entries
 *           Each skill that had its moment: its roll if it made one, the HP it would restore and the HP it
 *           did, and whether its effect is left for the table. `cured` lists the conditions it cures the unit
 *           of; `reached` lists the units around that it
 *           reached instead of its own, with the HP each regains; `granted` the changes that last a while
 *           which it grants, each for the unit itself (`unit: null`) or for one of the units around
 */

/**
 * What a unit's skills do at a moment of its turn. A skill that is sure of the moment rolls nothing, the
 * others roll their chance. A unit without HP does nothing.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf & {waiting?: boolean, name?: string, uuid?: string}} self
 *                                                  The unit, with the stats it has now; its name and UUID
 *                                                  are kept on the changes it grants to others
 * @param {"turnStart"|"turnEnd"|"wait"} moment
 * @param {() => number} d100                       Returns a whole number from 1 to 100
 * @param {object} [options]
 * @param {number} [options.activation]             The unit's Skill Activation rate
 * @param {boolean} [options.always]                Do the unit's skills always activate?
 * @param {Record<string, number>|null} [options.conditions]    The conditions the unit suffers from, where
 *                                                  that is known: an effect cures it of none otherwise
 * @returns {TurnMoment}
 */
export function turnMoment(skills, self, moment, d100, { activation = 0, always = false, conditions = null } = {}) {
  const hpBefore = self.hp ?? 0;
  let hp = hpBefore;
  const entries = [];
  const amount = (value, unit) => {
    if ( Array.isArray(value) ) return value.reduce((sum, part) => sum + readNumber(part, unit, null), 0);
    return readNumber(value ?? 0, unit, null);
  };
  for ( const { skill, effect, unseen, source, giver } of (hpBefore > 0) ? turnEffects(skills, self, moment, { conditions }) : [] ) {
    const sure = !!effect.proc.sure;
    const chance = chanceOf(effect.proc, self, null, { activation, always });
    const roll = sure ? null : d100();
    const remind = unseen ? "check" : (effect.remind ?? false);
    const entry = { skill, sure, roll, chance, success: sure || (roll <= chance), recover: 0, healed: 0, remind };
    if ( entry.success ) {
      entry.recover = amount(effect.recover, { ...self, hp });

      // What reaches for the units around restores their HP, not the unit's own
      if ( effect.reach && !unseen ) {
        entry.reached = reached(self, effect.reach).map((other) => {
          const healed = (remind === "check") ? 0 : Math.max(Math.min(entry.recover, (other.hpMax ?? Infinity) - other.hp), 0);
          return { id: other.id, name: other.name, hpBefore: other.hp, hp: other.hp + healed, healed };
        });
      }

      // What hangs on something the system cannot see is shown, not applied
      else if ( (remind !== "check") && !effect.reach ) {
        entry.healed = Math.max(Math.min(entry.recover, (self.hpMax ?? Infinity) - hp), 0);
        hp += entry.healed;
      }

      // Conditions the unit is cured of
      if ( (effect.cure !== undefined) && (remind !== "check") ) entry.cured = curedOf(effect.cure, conditions);

      // Changes that last a while: for the unit itself, which is in its turn as it starts, or for the units
      // around. Those for units that cannot be seen are left to the table
      // A skill whose own condition asks where units stand grants nothing while that cannot be seen
      const granted = [];
      const blind = unseen && PLACE_KEYS.some((key) => effect.when?.[key]);
      for ( const grant of blind ? [] : [].concat(effect.grant ?? []) ) {
        const given = { ...grant, effects: resolveGiven(grant.effects ?? [], { ...self, hp }) };
        const inTurn = moment === "turnStart";
        if ( !grant.reach ) granted.push({
          unit: null,
          name: self.name ?? "",
          change: buildChange(given, { skill: source ?? skill, from: giver ?? "", own: !giver, carrierInTurn: inTurn })
        });
        else if ( !unseen ) {
          for ( const other of reached(self, grant.reach) ) granted.push({
            unit: other.id,
            name: other.name,
            change: buildChange(given, { skill: source ?? skill, from: self.name ?? "", giver: self.uuid ?? "", giverInTurn: inTurn })
          });
        }
      }
      if ( granted.length ) entry.granted = granted;
    }
    entries.push(entry);
  }
  return { hpBefore, hp, healed: hp - hpBefore, entries };
}

/* -------------------------------------------- */
/*  Describing Effects                          */
/* -------------------------------------------- */

/**
 * Check a list of effects for parts the rules do not know, so that a typing mistake does not pass silently.
 * @param {object[]} effects
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkEffects(effects) {
  const problems = [];
  const known = ["choice", "when", "stats", "statPercent", "combat", "might", "taken", "takenPercent", "hpMax", "calc",
    "rules", "effective", "effectiveMultiplier", "damageMultiplier", "ignoreDefence", "strikes", "extraAttack", "scale",
    "foeActivation", "endurance", "haste", "mirrorCrit", "critMultiplier", "slots", "capacity", "artCost", "dealtPercent", "aura", "expMultiplier", "staffExp", "growths",
    "weaponRange", "damageStat", "foeWear", "wield", "rank", "shift", "form", "warp", "foeStats", ...BEND_KEYS, ...STAFF_KEYS];
  const procParts = ["damage", "damagePercent", "damageOfFoeHp", "healPlus", "statTimes", "ignore", "hit", "critical", "heal", "sureHit", "inflicts",
    "sequence", "oneUse", "negate", "reduce", "reflect", "retaliate", "resist", "inflictsAttacker", "survive", "foeCombat",
    "next", "nextOfDamage", "near", "nonlethal", "recover", "attack", "remind", "damaged", "ifHit", "ifStruck", "end", "reach", "grant",
    "gold", "goldPerGain", "reroll", "freeUses", "returns", "harmNear", "shield", "gaugeOfDamage", "cure"];
  const staffing = (effect) => STAFF_MOMENTS.includes(effect?.proc?.on);
  const grantParts = ["to", "reach", "around", "name", "effects", "pick", "ends", "turns", "next", "clock", "max", "stacks", "fades", "gained", "now"];

  // The moments of an attack whose damage a lasting change can be read from, or that can pick one by a die
  const striking = (effect) => ["attack", "hit", "crit"].includes(effect?.proc?.on);
  const isCondition = (id) => (id in FEO.conditions) || (id in FEO.optionalConditions);
  const afflicting = (effect) => CONDITION_MOMENTS.includes(effect?.proc?.on);
  const levelling = (effect) => LEVEL_MOMENTS.includes(effect?.proc?.on);
  const nextParts = ["hit", "damage", "critical"];
  const procCombat = ["hit", "damage", "critical", "dodge"];
  const sequenceParts = ["damage", "damagePercent", "damageMultiplier", "statTimes", "ignore", "hit", "critical", "heal",
    "sureHit", "inflicts", "share", "end"];
  const conditions = ["hp", "weapon", "quality", "lacks", "skill", "noSkill", "waiting", "shifted", "declared", "near", "terrain", "noModule", "weaponReach", ...FIGHT_KEYS];
  const ops = ["le", "lt", "ge", "gt", "full", "notFull"];
  const filterParts = ["who", "within", "from", "quality", "class", "min", "max"];
  const auraParts = ["who", "within", "from", "self", "when"];
  if ( !Array.isArray(effects) ) return ["effects must be a list"];

  // The units around a unit that a skill names
  const checkFilter = (filter, at, what, parts = filterParts) => {
    if ( !filter || (typeof filter !== "object") ) return problems.push(`${at}: ${what} must say which units`);
    if ( !["ally", "enemy"].includes(filter.who) ) problems.push(`${at}: ${what} is for "ally" or "enemy", not "${filter.who}"`);
    for ( const key of Object.keys(filter) ) if ( !parts.includes(key) ) problems.push(`${at}: ${what} cannot say "${key}"`);
    return null;
  };
  effects.forEach((effect, index) => {
    const at = `effect ${index + 1}`;
    const proc = effect?.proc;
    for ( const key of Object.keys(effect ?? {}) ) {
      if ( known.includes(key) || (key === "proc") || (proc && procParts.includes(key)) ) continue;

      // Without a moment, a reminder can only mark an effect as one to check by hand
      if ( (key === "remind") && (effect.remind === "check") ) continue;
      problems.push(`${at}: unknown part "${key}"`);
    }
    // A quality the unit takes on at will is the one the effect asks for, and its boosts are always there
    if ( effect?.form !== undefined ) {
      if ( effect.form !== true ) problems.push(`${at}: "form" is true or left out, not "${effect.form}"`);
      if ( !effect.when?.quality?.length ) problems.push(`${at}: a form needs the Special Quality it asks for`);
      if ( proc || effect.aura ) problems.push(`${at}: a form is always there, not at a moment or as an aura`);
    }
    if ( effect?.when?.near ) checkFilter(effect.when.near, at, "near");
    if ( effect?.when?.foeNear ) checkFilter(effect.when.foeNear, at, "foeNear");
    if ( effect?.reach ) checkFilter(effect.reach, at, "reach");

    // A change that lasts a while: who carries it, when it ends, and effects that are themselves in order
    for ( const grant of [].concat(effect?.grant ?? []) ) {
      for ( const key of Object.keys(grant ?? {}) ) if ( !grantParts.includes(key) ) problems.push(`${at}: a lasting change cannot say "${key}"`);
      if ( grant?.reach ) checkFilter(grant.reach, at, "the reach of a lasting change");
      else if ( (grant?.to === "target") && staffing(effect) ) {
        // The unit a staff is used on
      }
      else if ( !["self", "foe"].includes(grant?.to) ) problems.push(`${at}: a lasting change is for "self", "foe" or a reach, not "${grant?.to}"`);
      if ( !["turnStart", "turnEnd", "map"].includes(grant?.ends) ) problems.push(`${at}: a lasting change ends at "turnStart", "turnEnd" or "map", not "${grant?.ends}"`);
      if ( ![undefined, "giver"].includes(grant?.clock) ) problems.push(`${at}: the turns of a lasting change are its unit's or the "giver"'s, not "${grant.clock}"`);
      if ( ![undefined, "foe"].includes(grant?.around) ) problems.push(`${at}: a lasting change reaches around the unit or around the "foe", not "${grant.around}"`);

      // One that lasts as long as a condition does is granted as that condition is inflicted
      if ( (grant?.turns === "condition") && !afflicting(effect) ) problems.push(`${at}: a lasting change lasts as long as a "condition" only where one is inflicted`);
      else if ( (grant?.turns !== undefined) && (grant.turns !== "condition") && !(Number.isInteger(grant.turns) && (grant.turns >= 1)) ) {
        problems.push(`${at}: a lasting change lasts a whole number of turns, not "${grant.turns}"`);
      }
      // One of several changes, picked by a die as an attack is made or lands: each is checked as a change
      // of its own
      if ( grant?.pick !== undefined ) {
        if ( !striking(effect) ) problems.push(`${at}: a lasting change is picked by a die on an "attack", a "hit" or a "crit"`);
        if ( grant.effects !== undefined ) problems.push(`${at}: a lasting change has "effects" or a "pick" of them, not both`);
        if ( !Array.isArray(grant.pick) || (grant.pick.length < 2) ) problems.push(`${at}: a "pick" lists the changes to pick from`);
        else grant.pick.forEach((option) => {
          for ( const key of Object.keys(option ?? {}) ) if ( !["name", "effects"].includes(key) ) problems.push(`${at}: a change to pick cannot say "${key}"`);
          if ( !Array.isArray(option?.effects) || !option.effects.length ) problems.push(`${at}: a change to pick needs effects`);
          else if ( option.effects.some((part) => part.proc || part.aura || part.grant) ) problems.push(`${at}: the effects of a lasting change cannot wait for a moment, be an aura or grant another`);
          else for ( const problem of checkEffects(option.effects) ) problems.push(`${at}: in a change to pick, ${problem}`);
        });
        continue;
      }
      if ( readsDealt(grant) && !striking(effect) ) problems.push(`${at}: a lasting change is read from the damage "dealt" on an "attack", a "hit" or a "crit"`);
      const inner = Array.isArray(grant?.effects) ? grant.effects : null;

      // At a level up a lasting change can be a boost in every stat the level up raised, for the unit itself
      if ( grant?.gained !== undefined ) {
        if ( !levelling(effect) ) problems.push(`${at}: only a level up has stats it raised to boost`);
        else if ( !Number.isFinite(grant.gained) || inner ) problems.push(`${at}: a boost in the stats a level up raised is a number, without effects`);
        else if ( grant.to !== "self" ) problems.push(`${at}: a boost in the stats a level up raised is for "self"`);
        continue;
      }
      if ( levelling(effect) && (grant?.reach || (grant?.to !== "self")) ) problems.push(`${at}: at a level up a lasting change is for "self"`);
      if ( !inner?.length ) problems.push(`${at}: a lasting change needs effects`);
      else if ( inner.some((part) => part.proc || part.aura || part.grant) ) problems.push(`${at}: the effects of a lasting change cannot wait for a moment, be an aura or grant another`);
      else for ( const problem of checkEffects(inner) ) problems.push(`${at}: in its lasting change, ${problem}`);
    }
    for ( const filter of placeCounts(effect ?? {}) ) checkFilter(filter, at, "count");
    if ( effect?.when?.noModule && !(effect.when.noModule in (FEO.optional ?? {})) ) problems.push(`${at}: unknown module "${effect.when.noModule}"`);
    if ( effect?.aura ) {
      checkFilter(effect.aura, at, "aura", auraParts);
      for ( const key of Object.keys(effect.aura.when ?? {}) ) if ( !conditions.includes(key) ) problems.push(`${at}: unknown condition "${key}" for the units in the aura`);

      // The unit that gives an aura is judged outside of any fight, and not by what it has around it
      for ( const key of Object.keys(effect.when ?? {}) ) {
        if ( FIGHT_KEYS.includes(key) || PLACE_KEYS.includes(key) ) problems.push(`${at}: the giver of an aura cannot be asked "${key}"`);
      }
    }
    // Staves: what the unit heals for, what it regains, and how far its staves reach
    for ( const key of STAFF_KEYS ) {
      if ( effect?.[key] === undefined ) continue;
      const parts = { staffHeal: ["more", "plus", "self", "both"], staffHealed: ["healer", "both"], staffRange: ["times", "max"] }[key];
      const table = effect[key];

      // Only the share a unit heals allies more for can come from the unit beside it
      const shared = effect.aura && (key === "staffHeal") && Object.keys(table ?? {}).every((part) => part === "more");
      if ( proc || (effect.aura && !shared) ) problems.push(`${at}: "${key}" is always there, not at a moment; as an aura it only gives "more" healing`);
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: ${key} must say what changes`);
      else for ( const [part, value] of Object.entries(table) ) {
        if ( !parts.includes(part) ) problems.push(`${at}: ${key} cannot say "${part}"`);
        else if ( !Number.isFinite(value) || (value < 0) ) problems.push(`${at}: the "${part}" of ${key} is a number, not "${value}"`);
      }
    }

    // How a skill bends the rules of conditions: always there, for the skill's own unit
    for ( const key of BEND_KEYS ) {
      if ( (effect?.[key] !== undefined) && (proc || effect.aura) ) problems.push(`${at}: "${key}" is always there, not at a moment or as an aura`);
    }
    for ( const key of ["inflictChance", "inflictTurns"] ) {
      if ( effect?.[key] === undefined ) continue;
      const table = effect[key];
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: ${key} must name conditions`);
      else for ( const [id, amount] of Object.entries(table) ) {
        if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        else if ( !Number.isFinite(amount) || ((key === "inflictTurns") && !Number.isInteger(amount)) ) problems.push(`${at}: ${key} gives "${id}" a number, not "${amount}"`);
      }
    }
    if ( effect?.nullify !== undefined ) {
      const ward = (typeof effect.nullify === "number") ? { percent: effect.nullify } : effect.nullify;
      if ( !ward || (typeof ward !== "object") || !Number.isFinite(ward.percent) || (ward.percent <= 0) || (ward.percent > 100) ) {
        problems.push(`${at}: nullify is a chance from 1 to 100`);
      }
      else {
        for ( const key of Object.keys(ward) ) if ( !["percent", "only"].includes(key) ) problems.push(`${at}: nullify cannot say "${key}"`);
        if ( (ward.only !== undefined) && (ward.only !== "damaging") ) {
          if ( !Array.isArray(ward.only) || !ward.only.length ) problems.push(`${at}: nullify is "only" for "damaging" conditions or for a list of them`);
          else for ( const id of ward.only ) if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        }
      }
    }
    if ( effect?.suffers !== undefined ) {
      const table = effect.suffers;
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: suffers must name conditions`);
      else for ( const [id, bend] of Object.entries(table) ) {
        if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        if ( !bend || (typeof bend !== "object") || !Object.keys(bend).length ) {
          problems.push(`${at}: suffers must say what "${id}" does`);
          continue;
        }
        for ( const [key, value] of Object.entries(bend) ) {
          if ( ["damage", "penalties", "tick"].includes(key) ) {
            if ( !Number.isFinite(value) ) problems.push(`${at}: the "${key}" of "${id}" is a number, not "${value}"`);
          }
          else if ( ["stays", "burst"].includes(key) ) {
            if ( typeof value !== "boolean" ) problems.push(`${at}: "${key}" is true or false, not "${value}"`);
          }
          else problems.push(`${at}: a condition suffered cannot say "${key}"`);
        }
      }
    }
    // Conditions a unit is cured of at a moment of its turn
    if ( effect?.cure !== undefined ) {
      if ( !TURN_MOMENTS.includes(proc?.on) ) problems.push(`${at}: conditions are cured at a moment of the unit's turn`);
      if ( effect.cure !== "all" ) {
        if ( !Array.isArray(effect.cure) || !effect.cure.length ) problems.push(`${at}: cure is "all" or lists conditions`);
        else for ( const id of effect.cure ) if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
      }
    }
    if ( (effect?.recovery !== undefined) && !(Number.isInteger(effect.recovery) && (effect.recovery >= 1)) ) {
      problems.push(`${at}: conditions run out by a whole number of turns, not "${effect.recovery}"`);
    }
    if ( effect?.debuffs !== undefined ) {
      const relief = effect.debuffs;
      if ( !relief || (typeof relief !== "object") || !Object.keys(relief).length ) problems.push(`${at}: debuffs must say what is taken off penalties`);
      else for ( const [key, value] of Object.entries(relief) ) {
        if ( key === "negate" ) {
          if ( typeof value !== "boolean" ) problems.push(`${at}: "negate" is true or false, not "${value}"`);
        }
        else if ( !["stats", "combat"].includes(key) ) problems.push(`${at}: penalties cannot be lessened by "${key}"`);
        else if ( !Number.isFinite(value) || (value < 0) ) problems.push(`${at}: penalties are lessened by a number, not "${value}"`);
      }
    }
    if ( effect?.burstHarm !== undefined ) {
      if ( !Array.isArray(effect.burstHarm) || !effect.burstHarm.length ) problems.push(`${at}: burstHarm lists conditions`);
      else for ( const id of effect.burstHarm ) {
        if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        else if ( !(FEO.conditions[id] ?? FEO.optionalConditions[id]).burst ) problems.push(`${at}: "${id}" does not burst`);
      }
    }

    // How far a weapon reaches, how it wears and what resists it
    if ( effect?.weaponRange !== undefined ) {
      const range = effect.weaponRange;
      if ( !range || (typeof range !== "object") || !Object.keys(range).length ) problems.push(`${at}: weaponRange must say how the range changes`);
      else for ( const [key, value] of Object.entries(range) ) {
        if ( !["add", "min", "max"].includes(key) ) problems.push(`${at}: a weapon's range cannot change by "${key}"`);
        else if ( !Number.isInteger(value) || (value < 0) ) problems.push(`${at}: a weapon's range changes by whole tiles, not "${value}"`);
      }
    }
    if ( (effect?.damageStat !== undefined) && !(effect.damageStat in FEO.damageStats) ) problems.push(`${at}: unknown damage stat "${effect.damageStat}"`);

    // Weapon ranks given for good: saved on the unit once, so never at a moment, as an aura or on a condition
    if ( effect?.rank !== undefined ) {
      const table = effect.rank;
      if ( proc || effect.aura || effect.when ) problems.push(`${at}: a rank is given for good, not at a moment, as an aura or on a condition`);
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: rank must name proficiencies`);
      else for ( const [key, value] of Object.entries(table) ) {
        if ( (key !== "start") && !(key in FEO.proficiencies) ) problems.push(`${at}: unknown proficiency "${key}"`);
        else if ( !Number.isInteger(value) || (value < 1) ) problems.push(`${at}: a rank rises by whole ranks, not "${value}"`);
      }
    }
    if ( effect?.foeWear !== undefined ) {
      for ( const [key, value] of Object.entries(effect.foeWear ?? {}) ) {
        if ( !["hit", "noDamage"].includes(key) ) problems.push(`${at}: a foe's weapon cannot wear by "${key}"`);
        else if ( !Number.isInteger(value) || (value < 0) ) problems.push(`${at}: a foe's weapon wears by whole uses, not "${value}"`);
      }
    }
    if ( ("freeUses" in (effect ?? {})) && (proc?.on !== "start") ) problems.push(`${at}: a weapon is spared its uses as the fight begins, "start"`);

    // The unit's own Special Qualities and skills, a plain chance, and a defence lent for a hit
    const own = effect?.when ?? {};
    for ( const key of ["quality", "lacks"] ) {
      if ( (own[key] !== undefined) && !(Array.isArray(own[key]) && own[key].length && own[key].every((quality) => typeof quality === "string")) ) {
        problems.push(`${at}: "${key}" lists Special Qualities`);
      }
    }
    for ( const key of ["skill", "noSkill"] ) {
      if ( (own[key] !== undefined) && !((typeof own[key] === "string") && own[key]) ) problems.push(`${at}: "${key}" names one skill`);
    }
    if ( (proc?.fixed !== undefined) && !((proc.fixed === true) && Number.isFinite(proc.percent)) ) problems.push(`${at}: a "fixed" chance is a percent`);
    if ( "shield" in (effect ?? {}) ) {
      const lent = effect.shield;
      if ( proc?.on !== "struck" ) problems.push(`${at}: a defence is lent for a hit, when "struck"`);
      if ( !lent || (typeof lent !== "object") || !Object.keys(lent).length ) problems.push(`${at}: shield must give "def" or "res"`);
      else for ( const key of Object.keys(lent) ) if ( !["def", "res"].includes(key) ) problems.push(`${at}: a shield lends "def" or "res", not "${key}"`);
    }

    // Changing form: what a skill changes about it is always there or waits for its skill to be switched on,
    // and points for the Shift Gauge come with a critical hit
    if ( effect?.shift !== undefined ) {
      const form = effect.shift;
      if ( proc || effect.aura ) problems.push(`${at}: "shift" is always there, not at a moment or as an aura`);
      for ( const key of Object.keys(effect.when ?? {}) ) if ( key !== "declared" ) problems.push(`${at}: "shift" waits for nothing but its skill being switched on, not for "${key}"`);
      if ( !form || (typeof form !== "object") || !Object.keys(form).length ) problems.push(`${at}: shift must say what changes`);
      else for ( const [key, value] of Object.entries(form) ) {
        if ( SHIFT_PARTS.flags.includes(key) ) {
          if ( value !== true ) problems.push(`${at}: the "${key}" of shift is true, not "${value}"`);
        }
        else if ( !SHIFT_PARTS.numbers.includes(key) ) problems.push(`${at}: shift cannot say "${key}"`);
        else if ( !Number.isFinite(value) || (["percent", "times", "humanFight"].includes(key) && (value < 0)) || ((key === "transforms") && !Number.isInteger(value)) ) {
          problems.push(`${at}: the "${key}" of shift is a number, not "${value}"`);
        }
      }
    }
    // Warping: where the unit may land, in an effect of its own
    if ( effect?.warp !== undefined ) {
      if ( Object.keys(effect).length > 1 ) problems.push(`${at}: "warp" stands alone in its effect`);
      for ( const problem of checkWarp(effect.warp) ) problems.push(`${at}: ${problem}`);
    }
    if ( (own.shifted !== undefined) && (typeof own.shifted !== "boolean") ) problems.push(`${at}: "shifted" is true or false`);
    if ( "gaugeOfDamage" in (effect ?? {}) ) {
      if ( proc?.on !== "crit" ) problems.push(`${at}: the Shift Gauge gains a share of a hit's damage on a "crit"`);
      if ( !Number.isFinite(effect.gaugeOfDamage) || (effect.gaugeOfDamage <= 0) ) problems.push(`${at}: gaugeOfDamage is a share in percent, not "${effect.gaugeOfDamage}"`);
    }

    // Surviving a fatal hit: as Miracle does, or left at 1 HP by an HP test
    if ( "survive" in (effect ?? {}) ) {
      const saved = effect.survive;
      if ( proc?.on !== "struck" ) problems.push(`${at}: a fatal hit is survived when "struck"`);
      if ( saved !== true ) {
        if ( !saved || (typeof saved !== "object") || ![...ops, "above"].includes(saved.hp?.op) ) problems.push(`${at}: survive is true, or an "hp" test the unit must pass`);
        else for ( const key of Object.keys(saved) ) if ( key !== "hp" ) problems.push(`${at}: survive cannot say "${key}"`);
      }
    }
    if ( effect?.when?.weaponReach && !Object.keys(effect.when.weaponReach).every((key) => ["min", "max"].includes(key)) ) {
      problems.push(`${at}: a weapon's own reach is asked by "min" or "max"`);
    }

    // What a unit earns: experience multiplied, the column of the staff table, growth rates raised
    if ( (effect?.expMultiplier !== undefined) && !(Number.isFinite(effect.expMultiplier) && (effect.expMultiplier >= 0)) ) {
      problems.push(`${at}: experience is multiplied by a number, not "${effect.expMultiplier}"`);
    }
    if ( (effect?.staffExp !== undefined) && !["unpromoted", "promoted"].includes(effect.staffExp) ) {
      problems.push(`${at}: staves earn "unpromoted" or "promoted" experience, not "${effect.staffExp}"`);
    }
    if ( effect?.growths !== undefined ) {
      const growths = effect.growths;
      const rates = { ...FEO.growths, ...(FEO.optionalGrowths ?? {}) };
      if ( !growths || (typeof growths !== "object") ) problems.push(`${at}: growths must say which growth rates`);
      else if ( proc || effect.aura ) problems.push(`${at}: growth rates are raised all the time, and only for the skill's own unit`);
      else if ( "pick" in growths ) {
        if ( !Number.isInteger(growths.pick) || (growths.pick < 1) || !Number.isFinite(growths.amount) ) problems.push(`${at}: picked growth rates need a whole "pick" and an "amount"`);
        for ( const key of Object.keys(growths) ) if ( !["pick", "amount"].includes(key) ) problems.push(`${at}: picked growth rates cannot say "${key}"`);
      }
      else for ( const [key, amount] of Object.entries(growths) ) {
        if ( !(key in rates) ) problems.push(`${at}: unknown growth rate "${key}"`);
        else if ( !Number.isFinite(amount) ) problems.push(`${at}: the growth rate "${key}" is raised by a number`);
      }
    }
    if ( proc ) {
      if ( !PROC_TRIGGERS.includes(proc.on) && !TURN_MOMENTS.includes(proc.on) && !LEVEL_MOMENTS.includes(proc.on) && !STAFF_MOMENTS.includes(proc.on) ) {
        problems.push(`${at}: unknown trigger "${proc.on}"`);
      }

      // A staff being used only knows a few things to do
      if ( staffing(effect) ) {
        const parts = ["proc", "when", "choice", "grant", "remind", "harmNear", "healPlus"];
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: a staff being used cannot do "${key}"`);
        for ( const grant of [].concat(effect.grant ?? []) ) {
          if ( grant?.reach || !["self", "target"].includes(grant?.to) ) problems.push(`${at}: as a staff is used a lasting change is for "self" or the "target"`);
        }
        if ( effect.harmNear !== undefined ) {
          const harm = effect.harmNear;
          if ( !harm || !Number.isInteger(harm.within) || (harm.within < 1) || !Number.isFinite(harm.percent) || (harm.percent <= 0) ) {
            problems.push(`${at}: harmNear needs "within", in whole tiles, and a "percent"`);
          }
          for ( const key of Object.keys(harm ?? {}) ) if ( !["within", "percent"].includes(key) ) problems.push(`${at}: harmNear cannot say "${key}"`);
        }
      }
      else {
        for ( const key of ["ally", "heals"] ) if ( proc[key] !== undefined ) problems.push(`${at}: only a staff being used asks "${key}"`);
        for ( const key of ["harmNear", "healPlus"] ) if ( key in effect ) problems.push(`${at}: only a staff being used can do "${key}"`);
      }
      if ( (proc.percent == null) && !proc.stat && !proc.sure ) problems.push(`${at}: a chance needs a stat or a percent`);

      // A chance worked out for the unit that gives an aura, and what only an attack can add to its damage
      if ( (proc.giver !== undefined) && !((proc.giver === true) && effect.aura && !proc.sure) ) problems.push(`${at}: the "giver" rolls the chance of an aura, and only one that is rolled`);
      if ( "damageOfFoeHp" in effect ) {
        if ( proc.on !== "attack" ) problems.push(`${at}: a share of the foe's HP is added to the damage of an "attack"`);
        if ( !Number.isFinite(effect.damageOfFoeHp) || (effect.damageOfFoeHp <= 0) ) problems.push(`${at}: damageOfFoeHp is a share in percent, not "${effect.damageOfFoeHp}"`);
      }
      if ( ("recover" in effect) && (proc.on === "attack") ) problems.push(`${at}: an "attack" restores HP by a share of its damage, "heal"`);

      // A level up is not rolled for, and only knows what a level up can do; gold is for a level up or a kill
      if ( levelling(effect) ) {
        const parts = ["proc", "when", "choice", "reroll", "recover", "gold", "goldPerGain", "grant"];
        if ( !proc.sure ) problems.push(`${at}: a level up is not rolled for, its moment is "sure"`);
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: a level up cannot do "${key}"`);
      }
      else for ( const key of ["reroll", "goldPerGain"] ) if ( key in effect ) problems.push(`${at}: only a level up can do "${key}"`);

      // A condition being inflicted is not rolled for either, and only knows a few things to do
      if ( afflicting(effect) ) {
        const parts = ["proc", "when", "choice", "grant", "remind", "returns"];
        if ( !proc.sure ) problems.push(`${at}: a condition being inflicted is not rolled for, its moment is "sure"`);
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: a condition being inflicted cannot do "${key}"`);
        for ( const id of [].concat(proc.condition ?? []) ) if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
      }
      else if ( proc.condition !== undefined ) problems.push(`${at}: only "inflict" and "afflicted" wait for certain conditions`);
      if ( ("returns" in effect) && ((proc.on !== "afflicted") || !Number.isInteger(effect.returns) || (effect.returns < 1)) ) {
        problems.push(`${at}: a condition is handed back when "afflicted", for a whole number of turns`);
      }
      if ( ("gold" in effect) && !levelling(effect) && (proc.on !== "kill") ) problems.push(`${at}: gold is gained on a "kill" or at a "levelUp"`);
      for ( const key of [...Object.keys(effect.next ?? {}), ...Object.keys(effect.nextOfDamage ?? {}), ...Object.keys(effect.near?.next ?? {})] ) {
        if ( !nextParts.includes(key) ) problems.push(`${at}: the next attack cannot gain "${key}"`);
      }
      if ( ![undefined, true, false, "foe", "check"].includes(effect.remind) ) problems.push(`${at}: unknown reminder "${effect.remind}"`);
      for ( const part of effect.sequence ?? [] ) {
        for ( const key of Object.keys(part ?? {}) ) {
          if ( !sequenceParts.includes(key) ) problems.push(`${at}: an attack of a sequence cannot have "${key}"`);
        }
      }
      for ( const part of [effect, ...(effect.sequence ?? [])] ) {
        if ( part?.ignore && !["def", "res", undefined].includes(part.ignore.stat) ) problems.push(`${at}: unknown defence "${part.ignore.stat}"`);
        for ( const key of Object.keys(part?.statTimes ?? {}) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
      }
      for ( const entry of [...(effect.inflicts ?? []), ...(effect.inflictsAttacker ?? []), ...(effect.sequence ?? []).flatMap((part) => part.inflicts ?? [])] ) {
        const ids = (typeof entry === "string") ? [entry] : (entry?.anyOf !== undefined) ? [].concat(entry.anyOf) : [entry?.id];
        for ( const id of ids ) if ( !(id in FEO.conditions) && !(id in FEO.optionalConditions) ) problems.push(`${at}: unknown condition "${id}"`);
        if ( entry?.anyOf === undefined ) continue;
        if ( !["attack", "hit", "crit"].includes(proc.on) ) problems.push(`${at}: one of several conditions is picked by a die on an "attack", a "hit" or a "crit"`);
        if ( !Array.isArray(entry.anyOf) || (entry.anyOf.length < 2) || (Object.keys(entry).length > 1) ) problems.push(`${at}: "anyOf" lists the conditions to pick from, and nothing else`);
      }
      for ( const key of [...Object.keys(effect.combat ?? {}), ...Object.keys(effect.foeCombat ?? {})] ) {
        if ( !procCombat.includes(key) ) problems.push(`${at}: a chance at the start of a fight cannot change "${key}"`);
      }
    }
    for ( const key of Object.keys(effect?.when ?? {}) ) if ( !conditions.includes(key) ) problems.push(`${at}: unknown condition "${key}"`);
    for ( const key of ["hp", "foeHp"] ) {
      const test = effect?.when?.[key];
      if ( test && !ops.includes(test.op) ) problems.push(`${at}: unknown HP test "${test.op}"`);
    }
    if ( effect?.when?.role && !["initiating", "defending"].includes(effect.when.role) ) problems.push(`${at}: unknown role "${effect.when.role}"`);
    for ( const key of Object.keys(effect?.stats ?? {}) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
    for ( const key of Object.keys(effect?.statPercent ?? {}) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
    for ( const key of Object.keys(effect?.combat ?? {}) ) if ( !COMBAT_KEYS.includes(key) ) problems.push(`${at}: unknown combat stat "${key}"`);
    for ( const rule of effect?.rules ?? [] ) if ( !RULES.includes(rule) ) problems.push(`${at}: unknown rule "${rule}"`);
    for ( const [key, mode] of Object.entries(effect?.calc ?? {}) ) {
      if ( !FEO.calcModes[key]?.[mode] && !SKILL_CALC[key]?.includes(mode) ) problems.push(`${at}: unknown formula "${key}: ${mode}"`);
    }

    // What a skill takes off the stats its foe fights with: always there, for the skill's own unit
    if ( effect?.foeStats !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "foeStats" is always there, not at a moment or as an aura`);
      if ( !effect.foeStats || (typeof effect.foeStats !== "object") || !Object.keys(effect.foeStats).length ) problems.push(`${at}: foeStats must name stats`);
      else for ( const key of Object.keys(effect.foeStats) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
    }
  });
  return problems;
}

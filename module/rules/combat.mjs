/**
 * Combat resolution for Fire Emblem Online: one exchange between an initiator and a defender.
 *
 * Ported from the "Actions, Combat and the Weapon Triangle" section of the rules, the notes in the weapon
 * reference sheet and the rulings in the Book of Stipulations. Everything here works on plain data and takes
 * its dice as a function, so that it can be tested outside of Foundry.
 */
import { FEO } from "../config.mjs";
import { FALL, Pending, WORST_HIT, answerKind } from "./answers.mjs";
import { BLOW, wardOffers } from "./stances.mjs";
import { guardOf, lessen } from "./blocking.mjs";
import { breakInUse, wouldBreak } from "./breaking.mjs";
import { loneAttack } from "./choices.mjs";
import {
  attackElement, blocksWeapon, conditionConfig, endOnHit, heldBy, inflictions, resolveHit, restrictions, strikeNumbers
} from "./conditions.mjs";
import { takeHit } from "./defeat.mjs";
import { receiveCondition } from "./events.mjs";
import { plainEffect } from "./gear.mjs";
import { formationAround, reachable, unitsNear, unitsNearFoe } from "./positions.mjs";
import { spreadGrant, spreadOut, spreadTo } from "./spread.mjs";
import { followsUp } from "./progression.mjs";
import { ROUND_MOMENT, STRIKES_ALWAYS, countsEvery, defenderLeads, lineUp, roundsOf, speedSteps } from "./rounds.mjs";
import { combatWith, prepareSkills, weaponStrikes } from "./skill-combat.mjs";
import { HIT_SOURCES, NO_CRIT_MOMENT, NO_LETHALITY, PROC_TRIGGERS, hpHolds, readNumber, readsDealt, resolveDealt, surpassed, weaponIs } from "./skills.mjs";
import { isStaggered, staggerHit, staggerInUse, staggerTimes } from "./stagger.mjs";
import { heightBlocks, heightEdge, withoutBonuses } from "./terrain.mjs";
import { armedWith, withoutMoments } from "./actions.mjs";
import { ONCE_STRIKE, buildChange, chosenEffects, grantChange, pickCount, randomDice, randomEffects, usedName } from "./timed.mjs";
import { handedOver, settleTriangle, triangleAdvantage, triangleSwing } from "./triangle.mjs";
import { followUpTimes } from "./variants.mjs";
import { amplified } from "./stealing.mjs";

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
 * @property {import("./blocking.mjs").Shield|null} [shield]
 *                                                The Shield it has equipped, which may block a hit it takes
 * @property {string} [kin]                       What the unit is beyond its Special Qualities, as text: its
 *                                                race and its class, for a Shield that asks
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
 * @property {import("./movement.mjs").Movement|null} [move]
 *                                                How the unit moved this turn, counted to the tile it fights
 *                                                from; null when that cannot be judged, and what hangs on it is
 *                                                then only shown
 * @property {string[]} [goes]                    The skills that have given it all the goes their limit allows,
 *                                                and so earn it no other in this fight (see `acting.mjs`)
 * @property {import("./auras.mjs").AuraEntry[]} [auras]
 *                                                What the unit receives from the skills of the units around it
 * @property {import("./timed.mjs").TimedChange[]} [timed]
 *                                                The changes that last a while which the unit carries
 * @property {string} [uuid]                      What tells the unit from all others, kept on the lasting
 *                                                changes it grants that end by its own turns
 * @property {import("./arts.mjs").FightArt} [art]    The Combat Art it performs if it initiates the fight, whose
 *                                                HP it has paid already (see `readyArt`)
 * @property {{name: string, why: string}} [artBlocked]   The Art it had readied and cannot perform, and why
 * @property {number} [attacked]                  The attacks that were made against it since its own turn began,
 *                                                for a skill that counts them across fights (see `rounds.mjs`)
 * @property {number} [unusable]                    The weapons it carries and cannot wield, for a skill that counts
 *                                                them
 * @property {{id: string, name: string, img?: string, category: string, might: number, effect?: string,
 *   uses: {value: number, max: number}}[]} [carried]
 *                                                The weapons and tomes it carries, the one in hand among them,
 *                                                for an answer that spends the uses of one (see `answers.mjs`)
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
 *                                      What is added to the numbers of this side's first attack alone: its own
 *                                      Combat Art to its Hit, Critical and damage, the foe's Art to the Dodge
 *                                      and Critical Avoid it attacks against, and the Might its skills give
 *                                      that attack to its damage
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
 * @property {import("./blocking.mjs").Guard|null} block
 *                                      What the foe blocks this side's attacks with, and how likely: its
 *                                      Shield, a weapon that acts as one, or the weapon it guards with (see
 *                                      `blocking.mjs`). Null when nothing does
 * @property {{first: object[], last: object[]}|null} critUse
 *                                      The skills that have the attack which costs this side's weapon its
 *                                      first use, or its last, be a critical hit
 * @property {number} [critPlain]       The chance of a critical hit without that, set where `crit` counts it
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
 * @property {{skill: boolean, defence: boolean, through: boolean}} curb
 *                                      What curbs every hit of this side: a `skill` of the foe that is always
 *                                      there takes something off it, the foe's `defence` leaves half its
 *                                      damage or less; and whether it would get `through` without that skill
 * @property {boolean} [denied]         For the defender: did a skill take a counter-attack it would have made?
 * @property {Record<"def"|"res", {resisted: number, cover: number}>} resists
 *                                      What each of the foe's defences, and its tile, would take off a hit of
 *                                      this side, for an attack that is resisted by another than the usual
 * @property {number} effectiveMore     What effective damage would add to a hit of this side that is not
 *                                      effective by itself
 * @property {{skill: string, attacks: number, hit: number, critical: number, damage: number}|null} lone
 *                                      Set for a side that makes one attack in place of several (see
 *                                      `choices.mjs`): the skill, the attacks it would have made, and what
 *                                      the one gains
 * @property {number|null} cap          The most a hit of this side takes off its foe, where a skill of the
 *                                      foe caps it, and `cappedBy` the skills that do
 * @property {boolean} folded           Do the plan's numbers count what this side's skills are sure to do
 *                                      for its first attack alone?
 * @property {{damage: [string, number][], hit: [string, number][], critical: [string, number][]}} named
 *                                      What those skills add to the numbers of that attack, by their names
 * @property {string[]} idle            The skills this side switched on whose choice comes to nothing in
 *                                      this fight, which the fight does not spend
 * @property {string[]} stopped         The skills this side chose that a skill of its foe stops
 * @property {string[]} chose           The skills that are chosen when to activate which this side switched on
 *                                      for this fight, and `foiled` those of them a skill of its foe brought
 *                                      to nothing (see `answers.mjs`)
 * @property {object|null} artFoiled    The Combat Art this side would have performed, where a skill of its foe
 *                                      brought it to nothing: it is paid for, and does nothing
 * @property {boolean} worst            Does this side roll each of its Hit rolls twice and take the worse?
 * @property {{hit: number, crit: number, damage: number, kind: string, eased?: string[]}[]} blows
 *                                      What each attack this side makes in a round deals if it lands without a
 *                                      critical hit, with its chances, one after the other: the first as
 *                                      `damage`, `hit` and `crit` have it, the later ones with what its skills
 *                                      are sure to add from a later attack on, and each with what a skill of
 *                                      the foe is sure to take off every so many attacks (`eased` names it).
 *                                      `kind` is what the attack is in the round: "open", "follow" or "extra"
 * @property {{name: string, percent: number}[]} extras
 *                                      The attacks skills have this side make after all others
 * @property {{skill: string, damage: number, hit: number, critical: number}|null} led
 *                                      What it gains for the Attack Speed it has over a foe it follows up on
 * @property {boolean} joins            May it yet make an attack with the weapon in hand, though that weapon
 *                                      does not reach, where a skill of its takes effect as the fight begins?
 * @property {{skill: string, percent: number, floor: number, element: string|null, held: number, plus: number,
 *   negated: boolean}[]} echoes        What every hit of this side that deals damage deals again as damage of an
 *                                      element (see `echoDamage`). Each of its `blows` counts it in its damage
 *                                      and tells it as `echo`
 * @property {boolean} speedFollows     Does this side follow up, or not, by its Attack Speed alone? Only then
 *                                      does Attack Speed gained as the fight begins change that
 * @property {number} hasteAll          The HST it counts towards its follow-up
 * @property {{skill: string, combat: {hit: number, damage: number, critical: number}}[]} denial
 *                                      For the unit that began the fight: what its skills give it from the
 *                                      moment its foe loses its counter-attack in the middle of the fight
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
 * @property {string|null} [parity]               The skill that cancels what terrain, supports, weapons,
 *                                                equipment and skills do in this fight, where one does
 * @property {("open"|"follow"|"extra")[]} kinds  What each attack in `order` is: the attack a side makes
 *                                                first, its follow-up, or one a skill adds after all others
 * @property {{count: number, skill: string, until: "fall"|null}} [rounds]
 *                                                For a fight of several rounds, as a skill used as an action
 *                                                starts one: how many it goes on for at most, the skill, and
 *                                                whether it goes on until a unit falls (see `rounds.mjs`)
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
 * @property {{skill: string, by: string, to: string, amount: number, element?: string, cut?: "share"|"kill"}[]} [harm]
 *                                            Damage skills dealt outside of the attack itself: after a miss, in
 *                                            return, or beside a hit. One with an `element` is what the hit
 *                                            dealt again as damage of that element, and one marked `cut` what
 *                                            took a share of the HP its target had left, or all of it
 * @property {{roll: number, chance: number, success: boolean, damage: number, both: boolean}} [backfire]
 *                                            The roll for an attack that landed to backfire, and the damage
 *                                            its own unit took if it did. Unless `both` is set the target
 *                                            then took none, and `damage` above is 0
 * @property {boolean} [evaded]               Did the target dodge the attack because its hit would have been
 *                                            fatal, whatever was rolled?
 * @property {boolean} [staggered]            Did what the attack took from a unit empty its Stagger bar, so that
 *                                            the unit is Staggered from here on?
 * @property {{by: "shield"|"weapon", name: string, roll: number|null, chance: number, success: boolean,
 *   parry?: {roll: number, chance: number, success: boolean}, amount?: number, negated?: string, all?: string,
 *   uses?: number, broke?: boolean}} [block]
 *                                            What the target blocked with and the roll for it, for a hit it
 *                                            could block: the `amount` a block took off the damage, the skill
 *                                            of the attacker that `negated` it, the skill that had it take
 *                                            `all`, the `uses` it cost and whether that `broke` what blocked.
 *                                            A `parry` is rolled first by a Shield that can, and takes all
 * @property {boolean} [asCrit]               Did the attack count as a critical hit for what waits for one,
 *                                            without being one?
 * @property {{skill: string, roll: number, dice: number, amount: number, took: boolean}} [instead]
 *                                            The share of the target's maximum HP a die had the hit deal in
 *                                            place of its damage: the roll, what it came to, and whether it was
 *                                            dealt (it is not where the hit's own damage was as much or more)
 * @property {string} [slain]                 The skill by which the hit killed outright: it dealt at least the
 *                                            HP its target had
 * @property {string[]} [capped]              The skills of the target that held what the hit took off it to a
 *                                            share of its HP
 * @property {boolean} [added]                Was the attack added by a skill that activated?
 * @property {string} [skill]                 The skill that added it
 * @property {{hit: number, might: number}} [own]
 *                                            For an attack made with numbers of its own and not with the weapon
 *                                            in hand: the Hit and the Might it had in place of the weapon's
 * @property {{skill: string, by: string, on: string, what: string, amount?: number, item?: string, cost?: number,
 *   foiled?: string}[]} [answers]            The answers that were taken for this attack (see `answers.mjs`):
 *                                            the skill, the side whose it is, its moment and what it did; one a
 *                                            skill of the foe brought to nothing names that skill as `foiled`
 * @property {{skill: string, roll: "hit"|"crit", first: number}[]} [rerolls]
 *                                            The rolls that were made again, each with the roll it replaced
 * @property {number[]} [hitRolls]            Both Hit rolls of a unit that rolls twice and takes the worse
 * @property {string} [dodged]                The skill by which the target dodged an attack that would have hit
 * @property {string} [critFoiled]            The skill of the target that brought a critical hit to nothing
 * @property {string} [plain]                 The skill by which a critical hit was dealt without its damage
 * @property {{skill: string, by: string}} [negated]
 *                                            For an attack that was made and did nothing: the skill of its
 *                                            target that negated it. Nothing was rolled for it
 * @property {number} [round]                 The round of the fight the attack was made in, from the 2nd on
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
 * @property {{usesStart: number, uses: number, spent: number, broke: boolean}|null} shield
 *                                          The uses of the Shield the unit has equipped, before and after, or
 *                                          null for a unit without one
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
 * @property {number[]} [sparked]           What each Skill of its own that rolled to activate and did divides
 *                                          its stat by, for an Affinity that counts them
 * @property {{id: string, spent: number}[]} [items]    The uses its answers took off items it carries, other
 *                                          than the weapon in hand
 * @property {number} [faced]               The attacks that were made against it in the fight, for a unit whose
 *                                          skill counts them through its turn
 */

/**
 * @typedef ExchangeResult
 * @property {ExchangeAttack[]} attacks
 * @property {{skill: string, on: string, by: string, roll: number, chance: number, success: boolean}[]} [opening]
 *                                            The chances rolled as the fight began
 * @property {object[]} [closing]             The same for what skills do once the fighting is over
 * @property {{skill: string, by: string, damage?: number, inflicted?: object[]}[]} [after]
 *                                            What those skills did to the foe of their unit
 * @property {{skill: string, by: string, canto: object}[]} [moves]
 *                                            Skills that have the unit that started the fight move again now
 *                                            that it is over, each with its `canto` part (see `canto.mjs`)
 * @property {{skill: string, by: string, acts: object}[]} [acts]
 *                                            Skills that earn the unit that started the fight another go in its
 *                                            turn, if it still stands, each with its `acts` part (see
 *                                            `acting.mjs`)
 * @property {{skill: string, by: string, refreshes: object}[]} [refreshes]
 *                                            Skills of the unit that started the fight that hand out a Refresh
 *                                            now that it is over, each with its `refreshes` part (see
 *                                            `refresh.mjs`)
 * @property {{skill: string, id?: string, by: string, step: object}[]} [steps]
 *                                            Skills that move units now that the fight is over, each with its
 *                                            `step` part (see `forced.mjs`) and the side whose skill it is
 * @property {{skill: string, by: string}[]} [reminders]
 *                                            Skills that took effect in a way the table has to apply
 * @property {{skill: string, by: string, gold: number}[]} [earned]
 *                                            Gold skills earned their unit for defeating the foe
 * @property {{skill: string, by: string, amount: number}[]} [charged]
 *                                            Points skills gave their unit's Shift Gauge
 * @property {{skill: string, by: string, to: string, weapon: number, shield: number}[]} [worn]
 *                                            Uses skills took off a foe's weapon and Shield, one entry for each
 *                                            skill of each side: whose skill it was (`by`) and whose gear (`to`)
 * @property {{side: string, skill: string, by: string}[]} [cancelled]
 *                                            Attacks that were not made because a skill of the foe cancelled
 *                                            them: whose attack it was, and the skill
 * @property {{skill: string, id?: string, by: string, on: string, makes: object}[]} [raises]
 *                                            The creatures skills raise from the foe once the fight is over:
 *                                            each with its `makes` part (see `creatures.mjs`) and the side
 *                                            whose skill it is
 * @property {{skill: string, id?: string, by: string, on: string, loot: object}[]} [loot]
 *                                            What skills take from the foe now that the fight is over, each
 *                                            with its `loot` part (see `stealing.mjs`) and the side whose
 *                                            skill it is
 * @property {{side: string, skill: string, by: string}[]} [disarmed]
 *                                            The sides a skill of the foe had put down their weapon and their
 *                                            Shield: whose gear it was, and the skill
 * @property {{side: string, skill: string, forgoExp: boolean}} [fled]
 *                                            The side whose skill ended the fight before it was over, and
 *                                            whether its unit earns no experience from it
 * @property {{skill: string, by: string, amount: number, count: number, units: {id: string, name: string}[]}[]} [splashes]
 *                                            Damage a skill has go to other enemies around the two once the
 *                                            fight is over: how much, to how many, and the units it may go to
 * @property {{skill: string, by: string, on: string, at?: number, units: import("./spread.mjs").SpreadShare[],
 *   choose?: number, open?: object[], rolled?: number[], element?: string, nonlethal?: boolean,
 *   push?: {spaces: number, blocked: number}, attack?: {free: boolean}}[]} [spreads]
 *                                            What skills do to the units around the two (see `spread.mjs`): the
 *                                            skill, the side whose it is, its moment, and what each unit caught
 *                                            gets once the fight is saved. The unit that is fought (`foe`) has
 *                                            had its share already, but for a push. `choose` is how many of the
 *                                            units listed as `open` whoever acts for the unit may pick instead
 * @property {{skill: string, by: string, inflicted: object[]}[]} [before]
 *                                            The conditions skills put on the foe of their unit as the fight began
 * @property {object[]} [answers]             Answers taken outside of any attack
 * @property {{round: number, skill: string, by: string}[]} [rounds]
 *                                            The rounds the fight went on for beyond the first, each with the
 *                                            skill that had it fought and the side whose skill it is
 * @property {object[]} [turning]             The chances that were rolled as rounds ended, each with its `round`
 * @property {{side: string, skill: string, round: number}} [stopped]
 *                                            The side whose owner ended the fight before a further round, the
 *                                            skill that let them, and the last round that was fought
 * @property {{by: string, to: "initiator"|"defender"|null, unit: string|null, name: string,
 *   change: import("./timed.mjs").TimedChange, now?: boolean, at?: number, counted?: boolean}[]} [granted]
 *                                            Changes that last a while which skills granted: to one of the
 *                                            two units (`to`), or to a unit around them (`unit`, as its
 *                                            surroundings name it). One that counts for the rest of the fight
 *                                            says so (`now`), with the attack it was granted at (`at`, counted
 *                                            from 0) and whether the fight was planned again with it (`counted`)
 * @property {ExchangeOutcome} initiator
 * @property {ExchangeOutcome} defender
 */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** The moments of a skill that only come up through its unit's own attacks. */
const OWN_ATTACKS = ["attack", "hit", "crit", "miss", "kill", "critMiss"];
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
  if ( (distance < range.min) || (distance > range.max) ) return false;

  // What a skill adds to its reach from some distance on leaves out the tiles between the weapon's own reach
  // and that distance
  const hole = rangeHole(weapon.range, stats, changes);
  return !hole || (distance <= hole.above) || (distance >= hole.from);
}

/* -------------------------------------------- */

/**
 * The distances a weapon does not attack at though they lie within its Range as its wielder's skills make it:
 * where a skill adds to its reach only from some distance on (`from`), those beyond what the weapon reaches
 * without that skill and nearer than that distance.
 * @param {string|number} range
 * @param {Record<string, number>} [stats]
 * @param {{add?: number, min?: number, max?: number, from?: number}[]} [changes]
 * @returns {{above: number, from: number}|null}    Null where there are none
 */
export function rangeHole(range, stats = {}, changes = []) {
  const far = (changes ?? []).filter((change) => Number.isFinite(change.from));
  if ( !far.length ) return null;
  const near = rangeWith(range, stats, changes.filter((change) => !far.includes(change)));
  if ( !near ) return null;
  const from = Math.min(...far.map((change) => change.from));
  return (from > (near.max + 1)) ? { above: near.max, from } : null;
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

// Which of two weapon categories has weapon triangle advantage is worked out in `triangle.mjs`, with what
// skills make of it
export { triangleAdvantage };

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
 * The Might a weapon gains for each space its unit moved, as a Hasta does: "its next attack gains +1 Might per
 * space moved".
 * @param {string} [effect]     The weapon's Effect
 * @returns {number}            0 for other weapons
 */
export function chargeMight(effect) {
  const match = String(effect ?? "").match(/\+\s*(\d+(?:\.\d+)?)\s*Might\s+per\s+space\s+moved/i);
  return match ? Number(match[1]) : 0;
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

  // A weapon that is swung with the numbers of another, as a skill lends them, wears as its own kind does
  const category = FEO.weaponCategories[weapon.wears ?? weapon.category];
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

  // The least the chance of a critical hit is, where a skill of the unit says so, whatever its foe's Critical
  // Avoid takes off it
  if ( context.critFloor > 0 ) numbers.crit = Math.max(numbers.crit, Math.min(context.critFloor, 100));
  if ( context.noCrit ) numbers.crit = 0;
  if ( (context.damageScale ?? 1) !== 1 ) numbers.damage = Math.floor(numbers.damage * context.damageScale);
  return numbers;
}

/* -------------------------------------------- */

/**
 * Add to the numbers of an attack what the skills that take effect for it do: damage, Hit and Critical, a
 * share of the foe's defence ignored, effective damage, and another defence to resist it.
 * @param {object} base         The numbers the attack starts from, which are changed
 * @param {object[]} parts      What each skill does for this attack, as `resolveProc` works it out
 * @param {object} from         The side that attacks, or an attack with numbers of its own: `power`,
 *                              `resisted`, `defence`, `resists`, `effectiveMore` and `strike`
 * @param {number} foeHp        The HP the foe has as the attack is made
 * @returns {{times: number, sure: boolean|"ifAny", crit: boolean, kind: "def"|"res"}}
 *          What the damage is multiplied by, whether the attack cannot miss, whether it is a critical hit if
 *          it lands, and what resists it in the end
 */
function applyParts(base, parts, from, foeHp) {
  let times = 1;
  let ignored = 0;
  let sure = false;
  let crit = false;
  let kind = from.defence ?? (from.strike?.physical ? "def" : "res");
  let resisted = from.resisted ?? 0;

  // Stats of the foe that count otherwise for this attack: what that takes off its Dodge, its Critical Avoid
  // and what it resists the attack with
  const shift = { dodge: 0, critAvoid: 0, def: 0, res: 0 };
  for ( const part of parts ) for ( const [key, amount] of Object.entries(part.foeShift ?? {}) ) shift[key] = (shift[key] ?? 0) + amount;
  base.dodge += shift.dodge;
  base.critAvoid += shift.critAvoid;

  // What resists the attack: another defence than the usual one takes off what it and the foe's tile do
  for ( const part of from.resists ? parts : [] ) {
    if ( !part.against ) continue;
    const left = (stat) => from.resists[stat].resisted + from.resists[stat].cover;
    const to = (part.against === "lower") ? ((left("res") < left("def")) ? "res" : "def") : part.against;
    if ( to === kind ) continue;
    base.damage += left(kind) - left(to);
    kind = to;
    resisted = from.resists[to].resisted;
  }
  if ( shift[kind] ) {
    const held = Math.max(resisted + shift[kind], 0);
    base.damage += resisted - held;
    resisted = held;
  }
  for ( const part of parts ) {
    // Might a skill gives the attack counts as the weapon's own does, so an effective weapon multiplies it
    base.damage += Math.floor(((part.might ?? 0) * (from.mightMultiplier ?? 1)) + 1e-9) + part.damage + Math.floor(((from.power ?? 0) * part.damagePercent) / 100)
      + Math.floor(((Math.max(foeHp, 0) * (part.foeHpPercent ?? 0)) / 100) + 1e-9)
      + (part.effective ? (from.effectiveMore ?? 0) : 0);

    // What a skill makes of the weapon triangle for this attack: what it gives its unit multiplied, what it
    // takes off it lessened. An attack with numbers of its own has no triangle to bend
    if ( part.triangle ) {
      const swing = triangleSwing(part.triangle, { hit: from.triangleHit ?? 0, damage: from.triangleDamage ?? 0 });
      base.accuracy += swing.hit;
      base.damage += swing.damage;
    }
    base.accuracy += part.hit;
    base.critical += part.critical;
    times *= part.damageMultiplier;
    if ( part.ignore && (!part.ignore.stat || (part.ignore.stat === kind)) ) ignored = Math.max(ignored, part.ignore.percent);
    if ( part.sureHit === true ) sure = true;
    else if ( part.sureHit ) sure ||= part.sureHit;
    if ( part.sureCrit ) crit = true;
  }

  // What is left of the target's defence is rounded down, as it is for a skill that always ignores a share
  base.damage += resisted - Math.floor(((resisted * (100 - ignored)) / 100) + 1e-9);
  return { times, sure, crit, kind };
}

/* -------------------------------------------- */

/**
 * What a hit deals again as damage of an element, where a skill of its unit has it so: a share of the damage
 * the hit dealt, less what the target resists it with, and no less than a smaller share of that damage.
 * @param {{percent: number, floor: number, held: number, plus: number, negated: boolean}} echo
 *        The shares, what the target's defence and its tile take off, what its conditions add to damage of that
 *        element, and whether they negate it
 * @param {number} damage     The damage the hit dealt
 * @returns {number}
 */
export function echoDamage(echo, damage) {
  if ( !(damage > 0) || echo.negated ) return 0;
  const share = Math.floor(((damage * echo.percent) / 100) + 1e-9);
  const least = Math.floor(((damage * echo.floor) / 100) + 1e-9);
  return Math.max(Math.max(share - echo.held, least) + echo.plus, 0);
}

/* -------------------------------------------- */

/**
 * What a skill does for an attack once its numbers have mounted: what it adds to that attack's Might, damage,
 * Hit and Critical, counted so many times over.
 * @param {object} proc       The moment as `resolveProc` works it out
 * @param {number} times
 * @returns {object}
 */
function mounted(proc, times) {
  if ( times === 1 ) return proc;
  return {
    ...proc,
    might: (proc.might ?? 0) * times,
    damage: proc.damage * times,
    damagePercent: proc.damagePercent * times,
    hit: proc.hit * times,
    critical: proc.critical * times
  };
}

/**
 * What a side's skills are sure to do for the attack it makes as its nth of a fight, of those that only begin
 * with a later attack than the first (see `rounds.mjs`).
 * @param {object[]} procs    The side's moments on an attack
 * @param {number} n          Which attack of the fight it is for that side, counted from 1
 * @returns {object[]}
 */
function partsFrom(procs, n) {
  return (procs ?? []).filter((proc) => proc.sure && proc.from && (n >= proc.from) && !proc.sequence && (!proc.uses || (proc.uses.left !== 0)))
    .map((proc) => (proc.mounts ? mounted(proc, n - proc.from + 1) : proc));
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
 * @param {{initiator?: string[], defender?: string[], art?: boolean}|null} [options.foiled]
 *                                        What a skill of the foe brought to nothing before the fight (see
 *                                        `foilsBefore` in `answers.mjs`): the skills each unit chose for it,
 *                                        and the Combat Art the initiator performs
 * @param {{rounds: number|"fall", skill?: string}|null} [options.rounds]
 *                                        A fight of several rounds, as a skill used as an action starts one:
 *                                        how many, or "fall" for one that goes on until a unit falls
 * @param {{initiator?: import("./timed.mjs").TimedChange[], defender?: import("./timed.mjs").TimedChange[]}|null} [options.more]
 *                                        Changes that last a while which a unit was given in the middle of
 *                                        this fight and which count for the rest of it: the fight is planned
 *                                        with each unit carrying them on top of what it carried into it
 * @param {{initiator?: string[], defender?: string[]}|null} [options.lapsed]
 *                                        The parts of the fight that are over for a unit, for what lasts only
 *                                        until then: "followUp" once it has made its follow-up attack
 * @returns {ExchangePlan}
 */
export function planExchange(initiator, defender, { distance = 1, ground = null, foiled = null, rounds = null, more = null, lapsed = null, primed = false, extra = null, way = null } = {}) {
  const tiles = Math.max(Math.floor(Number(distance)) || 1, 1);

  // The fight as it was handed in, so that it can be planned again from the same units once something that
  // counts at once has changed in the middle of it (see `rollExchange`)
  const given = { initiator, defender, options: { distance, ground, foiled, rounds, extra, way } };

  // One attack on another unit, as a skill has its unit make it beside a fight (see `spread.mjs`): it is made
  // whatever the weapon reaches, with so much more or less Hit, and the unit attacked makes no counter-attack
  // What a skill has its unit have for that attack alone counts the same way
  if ( extra?.hit || extra?.effects?.length ) {
    const effects = [...(extra.hit ? [{ combat: { hit: extra.hit } }] : []), ...(extra.effects ?? [])];
    const lent = buildChange({ name: extra.skill || "Attack", effects, ends: "turnEnd" }, { skill: extra.skill || "Attack", own: true });
    more = { ...(more ?? {}), initiator: [...(more?.initiator ?? []), lent] };
  }

  // It may be made with another weapon than the one in hand, or with numbers of its own in place of a weapon,
  // and may activate none of its unit's skills (see `rules/actions.mjs`)
  if ( extra?.arm ) initiator = armedWith(initiator, extra.arm);
  if ( extra?.plain ) initiator = withoutMoments(initiator);
  const carrying = (unit, changes) => {
    if ( !changes?.length ) return unit;
    return { ...unit, timed: changes.reduce((list, change) => grantChange(list, change).list, unit.timed ?? []) };
  };
  initiator = carrying(initiator, more?.initiator);
  defender = carrying(defender, more?.defender);
  const heights = { initiator: ground?.initiator?.elevation ?? 0, defender: ground?.defender?.elevation ?? 0 };

  // Skills first change what each unit brings to the fight; those that ask who can counter-attack are read
  // once that is settled below
  const skills = prepareSkills(initiator, defender, tiles, {
    initiator: initiator.weapon ? parseRange(initiator.weapon.range, initiator.stats) : null,
    defender: defender.weapon ? parseRange(defender.weapon.range, defender.stats) : null
  }, { foiled, lapsed });
  let units = skills ? skills.units : { initiator, defender };

  // Parity: a unit may cancel what terrain, supports, weapons, equipment and skills do in this fight, for both
  // units. Of a weapon's Effect only what it is stays: the stat it adds to its Might, what it counts as, that
  // it may backfire and that it is Midrange, and effective damage that comes with its kind
  const parity = skills?.parity ?? null;
  const says = (weapon) => (parity ? "" : plainEffect(weapon));
  const inborn = (weapon) => ((parity && FEO.parity.inherent.includes(weapon?.category)) ? plainEffect(weapon) : says(weapon));
  const rules = (key) => units[key].fx?.rules ?? new Set();

  // The weapon triangle goes by the weapons in hand, with the size of the bonus set by the advantaged unit.
  // Skills can cancel it, turn it around, hand their unit the advantage whatever the weapons, keep their unit
  // from a disadvantage, multiply what it gives and takes, and negate a part of it (see `triangle.mjs`)
  const settled = settleTriangle(
    { category: initiator.weapon?.category, rules: rules("initiator"), parts: units.initiator.fx?.triangle ?? [] },
    { category: defender.weapon?.category, rules: rules("defender"), parts: units.defender.fx?.triangle ?? [] }
  );
  const advantage = settled.advantage;
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
  const ranked = rank ? FEO.triangleBonus[rank] : { hit: 0, damage: 0 };
  const bonus = { hit: Math.floor((ranked.hit * settled.hit) + 1e-9), damage: Math.floor((ranked.damage * settled.damage) + 1e-9) };
  const conditions = { initiator: initiator.conditions ?? {}, defender: defender.conditions ?? {} };

  // Why a side makes no attack at all
  const unable = (unit) => {
    if ( unit.hp <= 0 ) return "down";
    if ( !unit.weapon ) return "unarmed";
    if ( isBroken(unit.weapon) ) return "broken";
    return null;
  };
  const blocked = { initiator: unable(initiator), defender: null };

  // Did a skill take a counter-attack the defender would have made?
  let denied = false;

  // A Staggered unit cannot act: it begins no fight and answers none, and takes more from every hit
  const staggered = { initiator: isStaggered(initiator.stagger), defender: isStaggered(defender.stagger) };
  if ( !blocked.initiator && staggered.initiator ) blocked.initiator = "staggered";
  if ( !blocked.initiator && (defender.hp <= 0) && !defender.incapacitated ) blocked.initiator = "targetDown";
  if ( !blocked.initiator && !extra && !reaches(initiator.weapon, tiles, initiator.stats, units.initiator.fx?.ranges) ) blocked.initiator = "outOfRange";
  // Melee attacks cannot be made against targets at different elevations
  if ( !blocked.initiator && heightBlocks(tiles, heights.initiator, heights.defender) ) blocked.initiator = "elevation";

  // A skill that lets a weapon attack from further than it reaches by itself may do so only where nothing
  // stands between the two, which the map tells
  if ( !blocked.initiator && !extra && way?.blocked && (units.initiator.fx?.ranges ?? []).some((change) => change.open) ) {
    const own = parseRange(initiator.weapon.range, initiator.stats);
    if ( own && (tiles > own.max) ) blocked.initiator = "obstructed";
  }
  if ( !blocked.initiator && rules("initiator").has("noCombat") ) blocked.initiator = "skill";

  // A Combat Art is performed from where its kind of weapon strikes, or from the Range it names
  const artReach = initiator.art?.reach ?? null;
  if ( !blocked.initiator && artReach && ((tiles < artReach.min) || (tiles > artReach.max)) ) blocked.initiator = "artRange";
  if ( blocked.initiator ) blocked.defender = "noCombat";
  else {
    blocked.defender = unable(defender);
    if ( !blocked.defender && extra ) blocked.defender = "skill";
    // A unit that answers whatever would keep it from it is stopped by neither a condition nor a skill
    const answers = rules("defender").has("answers");
    if ( !blocked.defender && !answers && (defender.noCounter || heldBy(conditions.defender)) ) blocked.defender = "condition";
    if ( !blocked.defender && blocksWeapon(conditions.defender, defender.weapon) ) blocked.defender = "silenced";
    if ( !blocked.defender && !answers && (rules("defender").has("noCombat") || rules("defender").has("noCounter") || rules("initiator").has("foeNoCounter")) ) {
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
    const reached = () => canCounter(defender.weapon, initiator.weapon, tiles, units.defender.stats, answer)
      || ((tiles === 1) ? rules("defender").has("closeCounter") : rules("defender").has("distantCounter"));
    denied = (blocked.defender === "skill") && reached();
    if ( !blocked.defender && !canCounter(defender.weapon, initiator.weapon, tiles, units.defender.stats, answer) ) {
      // Some skills let a unit answer from a distance its weapon does not reach
      const reach = (tiles === 1) ? rules("defender").has("closeCounter") : rules("defender").has("distantCounter");
      const adjacent = (tiles === 1) && reaches(defender.weapon, tiles, units.defender.stats, answer.changes);
      if ( !reach ) blocked.defender = adjacent ? "midrange" : "outOfRange";
    }
  }
  // What a side's attacks are effective against, by the Effect of its weapon and by its skills; and the
  // Special Qualities of its foe they are effective for, which a skill of the foe may keep them from
  const names = (text, word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(text ?? "");
  const slaysOf = (key, all) => {
    const unit = all[key];
    if ( !unit.weapon ) return [];
    const text = `${inborn(unit.weapon)}, ${(unit.fx?.effective ?? []).join(", ")}`;
    return FEO.specialQualities.filter((quality) => names(text, quality));
  };
  const effectiveOf = (key, all) => {
    const unit = all[key];
    const foe = all[other(key)];
    const weapon = unit.weapon;
    let effective = weapon ? effectiveAgainst(inborn(weapon), foe.qualities) : [];
    if ( weapon && unit.fx?.effective.length ) {
      const extra = effectiveAgainst(unit.fx.effective.join(", "), foe.qualities);
      effective = [...effective, ...extra.filter((quality) => !effective.includes(quality))];
    }
    if ( foe.fx?.rules.has("noEffective") ) return [];
    const spared = (foe.fx?.uneffective ?? []).map((quality) => quality.toLowerCase());
    return effective.filter((quality) => !spared.includes(quality.toLowerCase()));
  };

  // Whether a side follows up: by its Attack Speed, unless a skill grants a follow-up or rules one out
  const followsOf = (key, all) => {
    if ( blocked[key] ) return false;
    const unit = all[key];
    const foe = all[other(key)];
    const swift = followsUp(unit.combat.attackSpeed, foe.combat.attackSpeed, FEO.doubleThreshold, (unit.haste ?? 0) + (unit.fx?.haste ?? 0));
    const barred = !!(unit.fx?.rules.has("noFollowUp") || foe.fx?.rules.has("noFollowUp") || foe.fx?.rules.has("foeNoFollowUp"));
    const sure = !!unit.fx?.rules.has("sureFollowUp");
    if ( (key === "initiator") && !foiled?.art && unit.art?.noFollowUp ) return false;
    return (sure !== barred) ? sure : swift;
  };
  if ( skills ) {
    const both = (read) => ({ initiator: read("initiator", units), defender: read("defender", units) });
    units = skills.settle({ initiator: !blocked.initiator, defender: !blocked.defender }, {
      slays: both(slaysOf), effective: both(effectiveOf), follows: both(followsOf), blocked: { ...blocked }
    });
  }

  // What works out the numbers of a side's nth attack of the fight, once the order of attacks is known
  const numbersAt = {};

  const side = (key) => {
    const unit = units[key];
    const foe = units[other(key)];
    const weapon = unit.weapon;
    const triangle = (key === "initiator" ? advantage : -advantage) || 0;

    // What the triangle adds to this side's Hit and damage, or takes off them
    const triangleHit = (triangle * bonus.hit) || 0;
    const triangleDamage = (triangle * bonus.damage) || 0;
    const fx = unit.fx;
    const foeFx = foe.fx;

    // Is the unit kept from attacking for a reason that is not its weapon: down, Staggered, a skill, and for
    // the unit that is attacked, whatever takes its counter-attack?
    const kept = (unit.hp <= 0) || !!unit.incapacitated || staggered[key] || !!fx?.rules.has("noCombat")
      || ((key === "defender") && (!!blocked.initiator || !!unit.noCounter || heldBy(conditions[key]) || !!fx?.rules.has("noCounter")
        || !!foeFx?.rules.has("foeNoCounter") || (!!unit.break && breakInUse())));

    // What a skill may have this side do from the start of the fight (see `rounds.mjs`). One more attack with
    // the weapon in hand is for a unit that makes none because that weapon does not reach; a change to the
    // order of the round is for a unit that attacks, and attacking first for one that would not anyway
    const reachless = ["outOfRange", "midrange"].includes(blocked[key]);
    const starting = (fx?.chances?.start ?? []).filter((proc) => {
      if ( proc.attack && !proc.strike ) return reachless && !kept && !!weapon && !isBroken(weapon) && !blocksWeapon(conditions[key], weapon);
      if ( proc.order === "first" ) return !blocked[key] && !blocked[other(key)] && (key !== "initiator");
      if ( proc.order ) return !blocked[key];
      return true;
    });
    const joins = starting.some((proc) => proc.attack && !proc.strike);

    // Does this side make an attack in the fight, or may it yet?
    const fights = !blocked[key] || joins;

    // Effective damage: from the weapon's Effect, and from skills that make their unit's attacks effective,
    // save for the Special Qualities a skill of the foe keeps it from
    let effective = effectiveOf(key, units);
    // A Combat Art the initiator performs (see `arts.mjs`). Unless its effects persist through the fight, what
    // it adds to Might, Hit and Critical is for its unit's first attack alone, and what it adds to Dodge and
    // Critical Avoid counts against the first attack the foe makes. An Art that is effective against the foe
    // multiplies the weapon's Might as an effective weapon does, for as long as the Art lasts
    // One that a skill of the foe brought to nothing does none of that
    const art = ((key === "initiator") && !blocked[key] && !foiled?.art) ? (unit.art ?? null) : null;
    const foeArt = ((key === "defender") && !blocked.initiator && !foiled?.art) ? (foe.art ?? null) : null;
    const immune = (foeFx?.uneffective ?? []).map((quality) => quality.toLowerCase());
    const artful = (art && weapon && art.effective.length && !foeFx?.rules.has("noEffective"))
      ? effectiveAgainst(art.effective.join(", "), foe.qualities).filter((quality) => !effective.includes(quality) && !immune.includes(quality.toLowerCase()))
      : [];
    if ( art?.persist ) effective = [...effective, ...artful];
    // A foe whose skills lessen effective damage has the Might multiplied by no more than they say
    const lessened = (multiplier) => Number.isFinite(foeFx?.effectiveTaken) ? Math.min(multiplier, Math.max(foeFx.effectiveTaken, 1)) : multiplier;
    const times = (list) => list.length
      ? lessened(fx?.effectiveMultiplier ?? FEO.effectiveMight[weapon.category] ?? FEO.effectiveMight.default)
      : 1;
    const mightMultiplier = times(effective);

    // The ground: the tile the foe stands on adds to its Dodge and to the stat it resists with, and a ranged
    // attack gains from higher ground and loses from lower. A skill of the unit may negate what the foe's
    // tile gives it, and Parity cancels what the ground does altogether
    const tile = parity ? null : (ground?.[other(key)] ?? null);
    const footing = fx?.rules.has("foeNoTerrain") ? withoutBonuses(tile) : tile;
    const edge = parity ? { height: 0, hit: 0, damage: 0 } : heightEdge(tiles, heights[key], heights[other(key)]);

    // What resists the weapon: DEF or RES by its kind, unless a skill has the unit's attacks resisted by the
    // other, or by whichever of the two leaves more damage with what the foe's tile adds. A skill that has its
    // unit ignore a share of its foe's defence takes that off DEF, and leaves RES as it is
    const usual = weapon ? defenceAgainst(weapon) : "def";
    const resists = Object.fromEntries(["def", "res"].map((stat) => [stat, {
      resisted: Math.floor((((foe.stats[stat] ?? 0) * (100 - ((stat === "def") ? (fx?.ignoreDefence ?? 0) : 0))) / 100) + 1e-9),
      cover: footing?.[stat] ?? 0
    }]));
    const weaker = ((resists.res.resisted + resists.res.cover) < (resists.def.resisted + resists.def.cover)) ? "res" : "def";
    const defence = !weapon ? "def" : (fx?.against === "lower") ? weaker : (fx?.against ?? usual);
    const wielded = (weapon?.might ?? 0) + (fx?.might ?? 0);
    let power = Math.max(
      unit.combat.damage + Math.floor((wielded * (mightMultiplier - 1)) + 1e-9) + triangleDamage
        + (art?.persist ? Math.floor((art.might * mightMultiplier) + 1e-9) : 0),
      0
    );

    // What effective damage would add to a hit that is not effective by itself, for a skill that has an
    // attack deal it
    const effectiveMore = (weapon && (mightMultiplier === 1) && !foeFx?.rules.has("noEffective")) ? Math.floor((wielded * (times(["any"]) - 1)) + 1e-9) : 0;
    const artTimes = times([...effective, ...artful]);

    // Might a skill gives the first attack alone counts as the weapon's own does for that attack. So does what
    // a weapon such as a Hasta gains for each space its unit moved, when it starts the fight with the weapon it
    // held as its turn began
    const charge = (weapon && (key === "initiator") && unit.move?.kept) ? chargeMight(says(weapon)) * unit.move.spaces : 0;
    const firstMight = (weapon && !blocked[key]) ? (fx?.firstMight ?? 0) + Math.floor(charge + 1e-9) : 0;

    // And so does what the weapon in hand takes from the one its unit attacked with before, for the first
    // attack it makes since it was taken in hand (see `triangle.mjs`): Might, Hit and Critical
    const handed = (weapon && !blocked[key]) ? handedOver(fx?.handovers, unit.wielded ?? null) : null;

    // And what a skill, or a change that waits for its unit's next attack, gives the first attack alone
    const firstly = (weapon && !blocked[key]) ? (fx?.firstAttack ?? null) : null;
    const opener = {
      accuracy: ((art && !art.persist) ? art.hit : 0) + (handed?.hit ?? 0) + (firstly?.hit ?? 0),
      critical: ((art && !art.persist) ? art.critical : 0) + (handed?.critical ?? 0) + (firstly?.critical ?? 0),
      damage: Math.floor((((art && !art.persist) ? (art.might * artTimes) + (wielded * (artTimes - mightMultiplier)) : 0) + ((firstMight + (handed?.might ?? 0)) * artTimes)) + 1e-9)
        + (firstly?.damage ?? 0),
      dodge: (foeArt && !foeArt.persist) ? foeArt.dodge : 0,
      critAvoid: (foeArt && !foeArt.persist) ? foeArt.critAvoid : 0
    };

    // A follow-up goes by Attack Speed, unless a skill grants one or rules one out. A unit that performs a
    // Combat Art makes none where the world has it make that one attack, or where the Art says so
    const swift = followsUp(unit.combat.attackSpeed, foe.combat.attackSpeed, FEO.doubleThreshold, (unit.haste ?? 0) + (fx?.haste ?? 0));
    let doubles = swift;
    const barred = !!(fx?.rules.has("noFollowUp") || foeFx?.rules.has("noFollowUp") || foeFx?.rules.has("foeNoFollowUp"));
    const sure = !!fx?.rules.has("sureFollowUp");
    if ( sure !== barred ) doubles = sure;
    if ( art?.noFollowUp ) doubles = false;

    // What a unit gains for the Attack Speed it has over a foe it follows up on, beyond what a follow-up
    // takes: so much for every few points of it
    const led = { skills: [], damage: 0, hit: 0, critical: 0 };
    for ( const lead of (!blocked[key] && doubles) ? (fx?.speedLead ?? []) : [] ) {
      const steps = speedSteps(unit.combat.attackSpeed, foe.combat.attackSpeed, lead.per);
      if ( !steps ) continue;
      led.skills.push(lead.skill);
      led.damage += steps * lead.damage;
      led.hit += steps * lead.hit;
      led.critical += steps * lead.critical;
    }
    power = Math.max(power + led.damage, 0);

    // The numbers every strike starts from, and what the conditions on both units make of the first one
    const resisted = resists[defence].resisted;
    const cover = resists[defence].cover;

    // How many times each attack strikes. An Art that strikes more than once does not add to what the weapon
    // or a skill already gives, and unless it persists only its unit's first attack strikes that often
    // What a weapon strikes "when initiating combat" it strikes for a unit whose skill has it so whoever began
    const starts = (key === "initiator") || !!fx?.rules.has(STRIKES_ALWAYS);
    const often = !fights ? 1 : Math.max(weaponStrikes(says(weapon), { initiating: starts, distance: tiles }), fx?.strikes ?? 1);
    let strikes = art?.persist ? Math.max(often, art.strikes) : often;
    let openStrikes = art ? Math.max(strikes, art.strikes) : strikes;

    // The attacks skills add after all others: for every unit, for one that would make so many attacks without
    // them, or for one that follows up by its Attack Speed, whatever a skill grants it
    const extras = blocked[key] ? [] : (fx?.extraAttacks ?? []).filter((extra) => {
      if ( extra.attacks && ((openStrikes + (doubles ? strikes : 0)) < extra.attacks) ) return false;
      return !extra.follows || (swift && !barred && !art?.noFollowUp);
    });

    // One attack in place of several, where a skill the unit switched on has it so: for each attack given up
    // it deals a share more of its damage before the foe's defence
    const planned = blocked[key] ? 0 : openStrikes + (doubles ? strikes : 0) + extras.length;
    const alone = (weapon && !blocked[key]) ? loneAttack(fx?.single ?? null, { attacks: planned, power, stats: unit.stats, damageStat: weapon.damageStat }) : null;
    const lone = alone ? { skill: fx.single.skill, attacks: planned, ...alone } : null;
    if ( lone ) {
      power += lone.damage;
      doubles = false;
      strikes = 1;
      openStrikes = 1;
    }

    // Critical a unit gains for its own chance of being critically hit, up to what its skills allow: none
    // against a foe that makes no attack or no critical hit
    const spared = !!blocked[other(key)] || !!foeFx?.rules.has("noCrit") || !!fx?.rules.has("foeNoCrit");
    const exposed = spared ? 0 : clamp(foe.combat.critical - unit.combat.critAvoid, 0, 100);
    const mirrored = Math.min(exposed, fx?.mirrorCrit ?? 0);
    const base = {
      accuracy: unit.combat.accuracy + triangleHit + edge.hit + (art?.persist ? art.hit : 0) + (lone?.hit ?? 0) + led.hit,
      dodge: foe.combat.dodge + (footing?.dodge ?? 0) + (foeArt?.persist ? foeArt.dodge : 0),
      critical: unit.combat.critical + mirrored + (art?.persist ? art.critical : 0) + (lone?.critical ?? 0) + led.critical,
      critAvoid: foe.combat.critAvoid + (foeArt?.persist ? foeArt.critAvoid : 0),
      damage: power - resisted - cover - (foe.endurance ?? 0) + (foeFx?.taken ?? 0) + edge.damage
    };

    // The numbers of this side's first attack alone, where a Combat Art changes them
    const opens = Object.values(opener).some(Boolean);
    const opening = opens ? Object.fromEntries(Object.entries(base).map(([name, value]) => [name, value + opener[name]])) : base;
    const strike = {
      initiating: key === "initiator",
      distance: tiles,
      physical: usual === "def",
      element: attackElement(weapon),
      noDodge: !!foe.noDodge && !foe.conditions,
      autoHit: !!foe.incapacitated || !!fx?.rules.has("sureHit"),
      autoCrit: !!fx?.rules.has("sureCrit"),
      critFloor: fx?.critFloor ?? 0,
      noCrit: !!fx?.rules.has("noCrit") || !!foeFx?.rules.has("foeNoCrit"),
      damageScale: (fx?.damageMultiplier ?? 1) * (foeFx?.takenMultiplier ?? 1) * staggerTimes(foe.stagger)
    };
    const mine = conditions[key];
    const theirs = conditions[other(key)];

    // Attacks that may backfire: with a Devil weapon, under a skill of the unit or of its foe that says so,
    // or under the condition that does. One chance however many of these there are, by the unit's own LUK
    let backfire = null;
    const devil = weapon ? backfires(weapon.effect) : null;
    const cursed = !!fx?.rules.has("backfire") || !!foeFx?.rules.has("foeBackfire") || (FEO.backfire.condition in mine);
    if ( fights && ((devil !== null) || cursed) ) {
      const chance = clamp((devil ?? FEO.backfire.base) - (unit.stats[FEO.backfire.stat] ?? 0), 0, 100);
      if ( chance > 0 ) backfire = {
        chance,
        both: (devil !== null) && !!fx?.rules.has("backfireBoth"),
        halved: !!fx?.rules.has("halfBackfire")
      };
    }
    // The first or the last use of the weapon, where a skill has the attack that costs it be a critical hit:
    // the first attack to land is, with a weapon that has lost no use yet, or has one left
    const worn = (weapon?.uses?.max > 0) ? weapon.uses : null;
    const critUse = (worn && fights && (fx?.weaponUse?.first.length || fx?.weaponUse?.last.length)) ? fx.weaponUse : null;
    const critNow = !!critUse && !strike.noCrit
      && (((worn.value >= worn.max) && (critUse.first.length > 0)) || ((worn.value === 1) && (critUse.last.length > 0)));

    // A stat of the foe that counts otherwise for one attack of this side, as one that is brought to 0 for it:
    // what that takes off the foe's Dodge and Critical Avoid, and off what it resists the attack with. A foe
    // whose skills negate what is put on it loses nothing
    const shiftFor = (timesBy) => {
      const stats = { ...foe.stats };
      for ( const [stat, by] of Object.entries(timesBy) ) stats[stat] = Math.max(Math.floor(((stats[stat] ?? 0) * by) + 1e-9), 0);
      const was = combatWith(foe, foe.stats);
      const then = was ? combatWith(foe, stats) : null;
      const held = (stat) => Math.floor((((stats[stat] ?? 0) * (100 - ((stat === "def") ? (fx?.ignoreDefence ?? 0) : 0))) / 100) + 1e-9) - resists[stat].resisted;
      return { dodge: then ? then.dodge - was.dodge : 0, critAvoid: then ? then.critAvoid - was.critAvoid : 0, def: held("def"), res: held("res") };
    };
    for ( const proc of foeFx?.bends?.debuffs?.negate ? [] : (fx?.chances?.attack ?? []) ) {
      for ( const part of [proc, ...(proc.sequence ?? [])] ) if ( part.foeStatTimes ) part.foeShift = shiftFor(part.foeStatTimes);
    }

    // What this side's skills are sure to do for its first attack alone, as a skill that was declared for one
    // attack does, is counted in the numbers of that attack, so that the forecast shows them
    const shape = { power, resisted, defence, resists, effectiveMore, strike, mightMultiplier, triangleHit, triangleDamage };
    const sureParts = blocked[key] ? [] : (fx?.chances?.attack ?? []).filter((proc) => {
      return proc.sure && proc.once && !proc.from && !proc.sequence && (!proc.uses || (proc.uses.left !== 0));
    });
    const numbered = (given, context) => {
      if ( !sureParts.length ) return numbersFor(given, context);
      const folded = { ...given };
      const { times: more, sure, crit: sureCrit } = applyParts(folded, sureParts, shape, foe.hp);
      const numbers = numbersFor(folded, { ...context, damageScale: (context.damageScale ?? 1) * more, autoCrit: context.autoCrit || sureCrit });
      if ( (sure === true) || ((sure === "ifAny") && (numbers.hit >= 1)) ) numbers.hit = 100;
      return numbers;
    };
    const first = numbered(opening, { ...strike, autoCrit: strike.autoCrit || critNow, attacker: mine, target: theirs });
    const later = numbersFor(base, { ...strike, attacker: mine, target: endOnHit(theirs, strike).state });

    // What those skills add to the numbers of that attack, by their names, for the sums behind them
    const named = { damage: [], hit: [], critical: [] };
    if ( sureParts.length ) {
      const plain = numbersFor(opening, { ...strike, autoCrit: strike.autoCrit || critNow, attacker: mine, target: theirs });
      const names = [...new Set(sureParts.map((proc) => proc.skill))].join(", ");
      if ( first.damage !== plain.damage ) named.damage.push([names, first.damage - plain.damage]);
      if ( first.hit !== plain.hit ) named.hit.push([names, first.hit - plain.hit]);
      if ( first.crit !== plain.crit ) named.critical.push([names, first.crit - plain.crit]);
    }

    // What every hit of this side that deals damage deals again as damage of an element, where a skill has it
    // so: the shares, with what the foe resists it with and what its conditions make of that element
    const echoes = (fights && weapon) ? (fx?.echoes ?? []).map((echo) => {
      const felt = strikeNumbers({ accuracy: 0, dodge: 0, critical: 0, critAvoid: 0, damage: 1000 }, { target: theirs, element: echo.element, physical: false });
      return {
        skill: echo.skill,
        percent: echo.percent,
        floor: echo.floor,
        element: echo.element,
        held: echo.resist ? (foe.stats[echo.resist] ?? 0) + (footing?.[echo.resist] ?? 0) : 0,
        plus: (felt.damage > 0) ? felt.damage - 1000 : 0,
        negated: !(felt.damage > 0)
      };
    }) : [];

    // A foe whose skill holds what a hit takes off it to a share of its maximum HP
    const cap = (fights && foeFx?.hitCap) ? Math.max(Math.floor((((foe.hpMax ?? foe.hp) * foeFx.hitCap) / 100) + 1e-9), 1) : null;

    // The skills this side switched on whose choice comes to nothing in this fight
    const idle = [...(fx?.idle ?? []), ...((fx?.single && !lone) ? [fx.single.skill] : [])];

    // What the foe blocks an attack of this side with: its Shield, a weapon that acts as one, or the weapon it
    // guards with. A unit that is down blocks nothing
    const guardFor = (about, held = null) => ((foe.hp > 0) && !foe.incapacitated) ? guardOf({
      shield: foe.shield ?? null,
      weapon: (parity && foe.weapon) ? { ...foe.weapon, effect: "" } : foe.weapon,
      stats: foe.stats,
      block: foeFx?.block ?? null
    }, {
      ...about,
      distance: tiles,
      kin: `${unit.qualities ?? ""} ${unit.kin ?? ""}`
    }, { block: fx?.block ?? null, weapon: (parity && held) ? { ...held, effect: "" } : held }) : null;
    const block = (fights && weapon)
      ? guardFor({ physical: usual === "def", element: strike.element, effective: effective.length > 0, weaponName: weapon.name ?? "" }, weapon)
      : null;

    // What curbs every hit of this side: a skill of the foe that is always there, and a defence that leaves
    // half the damage or less. `through` is whether a hit would deal damage without that skill
    const curbOf = (might, held, lee) => ({
      skill: ((foeFx?.taken ?? 0) < 0) || ((foeFx?.takenMultiplier ?? 1) < 1),
      defence: (Math.max(might - held - lee, 0) * 2) <= might,
      through: (might - held - lee - (foe.endurance ?? 0) + edge.damage) > 0
    });

    // An attack with numbers of its own that a skill has this side make at once, as it blocks or dodges. It
    // is made with what gives those numbers, not with the weapon in hand: a physical attack, without weapon
    // triangle, effective damage or anything the weapon's Effect says. A unit whose weapon cannot answer may
    // still make it, from as near as it reaches; one that is kept from attacking at all may not
    // So it is for an attack of that kind a skill has it make in every round, from the start of the fight
    // One that a skill has it make beside an attack of its own may be no physical one: it then says what
    // resists it, the element it is of and what it is effective against
    // And so it is for one a skill has it make as it is hit, with a weapon it was lent (see `lending.mjs`):
    // that is made from as far as that weapon reaches, and no nearer than it does
    for ( const proc of [...(fx?.chances?.block ?? []), ...(fx?.chances?.dodged ?? []), ...starting, ...(fx?.chances?.attack ?? []), ...(fx?.chances?.struck ?? [])] ) {
      const own = proc.strike;
      if ( !own?.combat ) continue;
      const resists = (own.against === "res") ? "res" : "def";
      const held = Math.floor((((foe.stats[resists] ?? 0) * (100 - ((resists === "def") ? (fx?.ignoreDefence ?? 0) : 0))) / 100) + 1e-9);
      const lee = footing?.[resists] ?? 0;
      const slain = (own.effect && !foeFx?.rules.has("noEffective"))
        ? effectiveAgainst(own.effect, foe.qualities).filter((quality) => !immune.includes(quality.toLowerCase()))
        : [];
      const might = own.combat.damage + (slain.length ? Math.floor((own.might * (lessened(fx?.effectiveMultiplier ?? FEO.effectiveMight.default) - 1)) + 1e-9) : 0);
      own.able = !kept && (tiles <= own.range) && (tiles >= (own.from ?? 1)) && !heightBlocks(tiles, heights[key], heights[other(key)]);
      own.plan = {
        base: {
          accuracy: own.combat.accuracy + edge.hit,
          dodge: base.dodge,
          critical: own.combat.critical + mirrored,
          critAvoid: base.critAvoid,
          damage: might - held - lee - (foe.endurance ?? 0) + (foeFx?.taken ?? 0) + edge.damage
        },
        strike: { ...strike, physical: resists === "def", element: own.element ?? null },
        power: might,
        resisted: held,
        curb: curbOf(might, held, lee),
        block: guardFor({ physical: resists === "def", element: own.element ?? null, effective: slain.length > 0, weaponName: "" }),

        // The conditions its Effect has it inflict, as a weapon's would
        inflicts: own.effect ? inflictsWith(inflictions(own.effect), fx?.bends) : []
      };
    }

    // Follow-up Critical Multiplier: a side that follows up has its Critical multiplied for that attack, before
    // the foe's Critical Avoid is taken off. Everything the attack counts as its unit's Critical is multiplied
    const fcm = (!blocked[key] && doubles) ? followUpTimes(unit.fcm) : 1;
    const follow = (fcm > 1)
      ? numbersFor(base, { ...strike, attacker: mine, target: endOnHit(theirs, strike).state, fcm })
      : null;

    // The numbers of this side's nth attack of the fight, if nothing but its skills' sure doing changes them:
    // those of its first as they are planned, and those of a later one with what begins with a later attack
    const steady = fights ? (fx?.chances?.attack ?? []) : [];
    // `shift` is Dodge and Critical Avoid the foe gains against that attack alone
    numbersAt[key] = (n, followUp = false, shift = null) => {
      const shifted = (given) => (shift ? { ...given, dodge: given.dodge + (shift.dodge ?? 0), critAvoid: given.critAvoid + (shift.critAvoid ?? 0) } : given);
      if ( n <= 1 ) {
        if ( !shift ) return { hit: first.hit, crit: first.crit, damage: first.damage };
        const now = numbered(shifted(opening), { ...strike, autoCrit: strike.autoCrit || critNow, attacker: mine, target: theirs });
        return { hit: now.hit, crit: now.crit, damage: now.damage };
      }
      const context = { ...strike, attacker: mine, target: endOnHit(theirs, strike).state, ...((followUp && (fcm > 1)) ? { fcm } : {}) };
      const parts = partsFrom(steady, n);
      if ( !parts.length ) return numbersFor(shifted(base), context);
      const folded = { ...shifted(base) };
      const made = applyParts(folded, parts, shape, foe.hp);
      const numbers = numbersFor(folded, { ...context, damageScale: (context.damageScale ?? 1) * made.times, autoCrit: context.autoCrit || made.crit });
      if ( (made.sure === true) || ((made.sure === "ifAny") && (numbers.hit >= 1)) ) numbers.hit = 100;
      return numbers;
    };

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
      block,
      curb: curbOf(power, resisted, cover),
      ...(((key === "defender") && denied) ? { denied: true } : {}),
      critUse,
      ...(critNow ? { critPlain: numbered(opening, { ...strike, attacker: mine, target: theirs }).crit } : {}),
      ...(follow ? { fcm, critFollow: follow.crit } : {}),
      damage: first.damage,
      damageLater: later.damage,
      base,
      strike,
      inflicts: weapon ? inflictsWith(inflictions(says(weapon)), fx?.bends) : [],
      notes: first.notes,
      warnings: restrictions(mine, weapon),
      attacks: blocked[key] ? 0 : openStrikes + (doubles ? strikes : 0),
      strikes,
      openStrikes,
      opener: opens ? opener : null,
      ...(handed ? { handed: { ...handed, damage: Math.floor((handed.might * artTimes) + 1e-9) } } : {}),
      art,
      skills: fx?.applied ?? [],
      auras: fx?.auras ?? [],
      lasting: fx?.lasting ?? [],
      checks: fx?.checks ?? [],

      // A skill whose choice comes to nothing is not spent, and a side that makes no attack only spends what
      // did something for it without one
      declared: (fx?.declared ?? []).filter((entry) => !idle.includes(entry.name) && (!blocked[key] || (entry.attacks === false))),
      idle,
      stopped: fx?.stopped ?? [],
      chose: fx?.chose ?? [],
      foiled: fx?.foiled ?? [],
      artFoiled: ((key === "initiator") && !blocked[key] && foiled?.art) ? (unit.art ?? null) : null,
      worst: !!fx?.rules.has(WORST_HIT),
      lone,

      // What the round of the fight is made of beyond the usual (see `rounds.mjs`): the attacks skills add
      // after all others, what this side gains for its lead in Attack Speed, and whether it may yet attack
      // though its weapon does not reach
      extras,
      led: led.skills.length ? { skill: led.skills.join(", "), damage: led.damage, hit: led.hit, critical: led.critical } : null,
      joins,

      // What an attack deals beyond its own damage (see `echoDamage`); whether this side follows up by its
      // Attack Speed alone, with the HST it counts for that, for what changes that speed as the fight begins;
      // and what it gains from the moment its foe loses its counter-attack in the middle of the fight
      echoes,
      speedFollows: !blocked[key] && !barred && !sure && !art?.noFollowUp && !lone,
      hasteAll: (unit.haste ?? 0) + (fx?.haste ?? 0),
      denial: ((key === "initiator") && !blocked[key] && !blocked[other(key)]) ? (fx?.denied ?? []).filter((entry) => !fx.applied.includes(entry.skill)) : [],
      cap,
      cappedBy: (cap !== null) ? (foeFx.cappers ?? []) : [],
      folded: sureParts.length > 0,
      named,
      resists,
      effectiveMore,
      // A side that makes no attack has no use for what its attacks would set off, and a unit that is down
      // activates nothing
      chances: Object.fromEntries(PROC_TRIGGERS.map((on) => {
        // Nor has a moment that asks for more Attack Speed than the foe has, for a unit without it
        // One that may yet attack, though its weapon does not reach, keeps what its attacks set off
        const idle = OWN_ATTACKS.includes(on) ? !fights : !(unit.hp > 0);
        const faster = unit.combat.attackSpeed > foe.combat.attackSpeed;
        const waiting = (on === "start") ? starting : (fx?.chances?.[on] ?? []);

        // Nor has one that bends the weapon triangle for an attack, where the triangle does nothing to bend
        const bends = (proc) => {
          if ( !proc.triangle ) return true;
          const swing = triangleSwing(proc.triangle, { hit: triangleHit, damage: triangleDamage });
          return !!(swing.hit || swing.damage);
        };
        // An attack a skill has its unit make on another unit beside a fight reaches for nobody in turn
        return [on, idle ? [] : waiting.filter((proc) => (!proc.faster || faster) && !(proc.strike && (on === "start") && !proc.strike.able) && bends(proc) && !(extra && proc.spread))];
      })),
      power,
      resisted,
      ground: { height: edge.height, hit: edge.hit, damage: edge.damage, dodge: footing?.dodge ?? 0, cover },
      doubles,
      triangle,
      triangleHit,
      triangleDamage,
      effective,
      mightMultiplier,
      defence,
      backfire
    };
  };
  const sides = { initiator: side("initiator"), defender: side("defender") };

  // The initiator attacks, the defender answers, then whoever is fast enough attacks again. A defender whose
  // skill lets it go first does, and so does one whose foe's skill has its enemy attack first. Each attack strikes as many times as the weapon or a skill makes it, and
  // attacks that skills add come after all the others, at the share of their damage the skill gives. Of them
  // all only the attack a side makes for being fast enough is a follow-up, with every strike of it
  // `kinds` says what each attack in the order is: the attack a side makes first ("open"), its follow-up
  // ("follow"), or one a skill adds after all others ("extra"), for what reorders a round (see `rounds.mjs`)
  const order = [];
  const scale = [];
  const followUps = [];
  const kinds = [];
  const attack = (key, share = 1, strikes = sides[key].strikes, follow = false, kind = "open") => {
    for ( let n = 0; n < strikes; n++ ) {
      order.push(key);
      scale.push(share);
      followUps.push(follow);
      kinds.push(kind);
    }
  };
  if ( !blocked.initiator ) {
    const first = !blocked.defender && defenderLeads(rules("initiator"), rules("defender"));
    const opening = first ? ["defender", "initiator"] : ["initiator", "defender"];
    for ( const key of opening ) if ( !blocked[key] ) attack(key, 1, sides[key].openStrikes);
    for ( const key of ["initiator", "defender"] ) {
      if ( !blocked[key] && sides[key].doubles ) attack(key, 1, sides[key].strikes, (sides[key].fcm ?? 1) > 1, "follow");
    }
    for ( const key of ["initiator", "defender"] ) {
      if ( blocked[key] ) continue;
      // A side that makes one attack in place of several makes none that a skill would add
      for ( const extra of sides[key].lone ? [] : sides[key].extras ) {
        attack(key, extra.percent / 100, 1, false, "extra");
        sides[key].attacks += 1;
      }
    }
  }

  // An attack on another unit beside a fight is one attack, at the share of its damage the skill gives
  if ( extra && order.length ) {
    order.length = scale.length = followUps.length = kinds.length = 1;
    scale[0] = extra.share ?? 1;
    followUps[0] = false;
    kinds[0] = "open";
  }

  // What lasts only until a side has made its follow-up attack is over as that attack is made: the attacks
  // from there on are those of the fight planned without it
  const lapses = Object.fromEntries(["initiator", "defender"].map((key) => {
    return [key, (units[key].fx?.lapses ?? []).filter((part) => !lapsed?.[key]?.includes(part))];
  }));
  const followAt = (key) => order.findIndex((who, index) => (who === key) && (kinds[index] === "follow"));
  const lapsing = ["initiator", "defender"].filter((key) => lapses[key].includes("followUp") && (followAt(key) >= 0));
  const lapseAt = lapsing.length ? Math.min(...lapsing.map(followAt)) : -1;
  const late = lapsing.length ? planExchange(given.initiator, given.defender, {
    ...given.options, more,
    lapsed: Object.fromEntries(["initiator", "defender"].map((key) => [key, [...(lapsed?.[key] ?? []), ...(lapsing.includes(key) ? ["followUp"] : [])]]))
  }) : null;

  // What a side's skills are sure to give it against an attack that would take a share of its maximum HP off
  // it: Dodge and Critical Avoid, with the skills that give them
  const foreseen = (target, damage) => {
    const most = target.unit.hpMax ?? target.unit.hp ?? 0;
    const seen = { dodge: 0, critAvoid: 0, skills: [] };
    for ( const proc of (most > 0) ? (target.chances?.attacked ?? []) : [] ) {
      if ( !proc.sure || !proc.threat || (proc.uses && (proc.uses.left === 0)) ) continue;
      const times = Math.floor(((damage * 100) / (most * proc.threat)) + 1e-9);
      if ( !(times > 0) ) continue;
      seen.dodge += (proc.combat?.dodge ?? 0) * times;
      seen.critAvoid += (proc.combat?.critAvoid ?? 0) * times;
      if ( !seen.skills.includes(proc.skill) ) seen.skills.push(proc.skill);
    }
    return seen.skills.length ? seen : null;
  };

  // What each attack of a side deals if it lands without a critical hit, with its chances, one after the
  // other as the round is planned: the first as its numbers stand, the later ones with what its skills are
  // sure to add from a later attack on, and each with what a skill of the foe is sure to take off every so
  // many attacks made against it, counted from the start of the foe's turn
  for ( const key of ["initiator", "defender"] ) {
    const mine = sides[key];
    const foe = sides[other(key)];
    const eases = (foe.chances?.struck ?? []).filter((proc) => {
      return proc.sure && proc.every && !proc.survive && !proc.attack && (proc.negate || proc.reduce) && (!proc.uses || (proc.uses.left !== 0));
    });
    // And what a skill of the foe that counts its uses is sure to take off a hit while it has one left: the
    // first hits that deal damage, as many as it has uses
    const limited = (foe.chances?.struck ?? []).filter((proc) => {
      return proc.sure && !proc.every && !proc.may && !proc.survive && !proc.attack && (proc.negate || proc.reduce) && (proc.uses?.left > 0);
    });
    const spent = new Map();
    const before = foe.unit.attacked ?? 0;
    const blows = [];
    order.forEach((who, index) => {
      if ( who !== key ) return;
      const n = blows.length + 1;

      // An attack that comes once a part of the fight is over is as the fight planned without that part has it
      const after = (late && (index >= lapseAt)) ? late[key].blows?.[n - 1] : null;
      if ( after ) {
        blows.push({ ...after, lapsed: true });
        return;
      }
      let numbers = numbersAt[key](n, followUps[index]);

      // What the foe's skills are sure to give it against an attack that would take so much of its HP: Dodge
      // and Critical Avoid, once for every share of its maximum HP the attack would take off it
      const seen = foreseen(foe, Math.floor((numbers.damage * scale[index]) + 1e-9));
      if ( seen ) {
        numbers = numbersAt[key](n, followUps[index], seen);
        if ( n === 1 ) {
          mine.hit = mine.evaded ? Math.min(numbers.hit, FEO.fatalDodge.hitCap) : numbers.hit;
          mine.crit = numbers.crit;
          mine.foreseen = seen;
        }
      }
      let damage = Math.floor((numbers.damage * scale[index]) + 1e-9);
      const eased = [];
      for ( const proc of eases ) {
        if ( !countsEvery(before + n - 1, proc.every) ) continue;
        if ( proc.negate ) damage = Math.floor(((damage * (100 - proc.negate)) / 100) + 1e-9);
        if ( proc.reduce ) damage = Math.max(damage - proc.reduce, 0);
        eased.push(proc.skill);
      }
      for ( const proc of limited ) {
        if ( ((spent.get(proc) ?? 0) >= proc.uses.left) || (proc.damaged && !(damage >= Number(proc.damaged))) ) continue;
        spent.set(proc, (spent.get(proc) ?? 0) + 1);
        if ( proc.negate ) damage = Math.floor(((damage * (100 - proc.negate)) / 100) + 1e-9);
        if ( proc.reduce ) damage = Math.max(damage - proc.reduce, 0);
        eased.push(proc.skill);
      }
      if ( (mine.cap !== null) && (mine.cap !== undefined) ) damage = Math.min(damage, mine.cap);

      // What the hit deals again as damage of an element is counted with it, and told beside it
      const echo = (mine.echoes ?? []).reduce((sum, part) => sum + echoDamage(part, damage), 0);
      blows.push({
        hit: (n === 1) ? mine.hit : numbers.hit, crit: numbers.crit, damage: damage + echo, kind: kinds[index],
        ...(eased.length ? { eased } : {}), ...(echo ? { echo } : {})
      });
    });
    mine.blows = blows;
  }

  // What waits for its unit to be struck while it makes no attack, or none that would deal damage
  for ( const key of ["initiator", "defender"] ) {
    const mine = sides[key];
    if ( !mine.chances?.struck?.some((proc) => proc.unable) ) continue;
    const harms = mine.blows.some((blow) => blow.damage > 0);
    mine.chances.struck = mine.chances.struck.filter((proc) => !proc.unable || !harms);
  }

  const plan = {
    distance: tiles,
    triangle: {
      advantage: advantaged, rank, hit: bonus.hit, damage: bonus.damage,

      // What skills made of it: what it is multiplied by, the skills that had a say, and those that kept a
      // unit from a disadvantage it would have had
      ...((settled.times !== 1) ? { times: settled.times } : {}),
      ...(settled.skills.length ? { skills: settled.skills } : {}),
      ...(settled.by.spared.length ? { spared: settled.by.spared } : {}),
      ...(settled.by.negated.length ? { negated: settled.by.negated } : {})
    },
    order,
    kinds,
    ...sides
  };
  if ( scale.some((share) => share !== 1) ) plan.scale = scale;
  if ( followUps.some(Boolean) ) plan.followUps = followUps;
  if ( parity ) plan.parity = parity;
  if ( extra ) plan.extra = { skill: extra.skill ?? "", free: !!extra.free };

  // What the fight was planned from, and the parts of it that what a side does lasts until
  plan.given = given;
  if ( lapses.initiator.length || lapses.defender.length ) plan.lapses = lapses;

  // A fight of several rounds, as a skill used as an action starts one: only against a foe that answers
  const bout = order.length ? roundsOf(rounds) : null;
  if ( bout ) plan.rounds = bout;

  // A change that is sure to be granted as the fight begins and counts at once: the fight is planned with its
  // unit carrying it, so that the forecast shows what the fight will be
  if ( !primed && order.length ) {
    const sure = { initiator: [], defender: [] };
    for ( const key of ["initiator", "defender"] ) {
      const giver = units[key];
      for ( const proc of sides[key].chances?.start ?? [] ) {
        if ( !proc.sure || proc.may || (proc.uses && (proc.uses.left === 0)) ) continue;
        for ( const grant of proc.grants ?? [] ) {
          if ( !grant.now || grant.reach || grant.pick || grant.choose || grant.random || grant.kill || grant.drop || readsDealt(grant) ) continue;
          if ( !["self", "foe"].includes(grant.to) ) continue;
          const to = (grant.to === "foe") ? other(key) : key;
          if ( (units[to].hp <= 0) || ((to !== key) && units[to].fx?.bends?.debuffs.negate) ) continue;
          sure[to].push(buildChange(grant, {
            skill: proc.source ?? proc.skill, giver: giver.uuid ?? "", giverInTurn: key === "initiator",
            from: proc.giver || (giver.name ?? ""), own: (to === key) && !proc.giver, carrierInTurn: to === "initiator"
          }));
        }
      }
    }
    if ( sure.initiator.length || sure.defender.length ) {
      return planExchange(given.initiator, given.defender, {
        ...given.options, lapsed, primed: true,
        more: { initiator: [...(more?.initiator ?? []), ...sure.initiator], defender: [...(more?.defender ?? []), ...sure.defender] }
      });
    }
  }
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

    // A hit the target may block: the roll for it, one more for a Shield that may parry, and the chances of
    // both sides that wait for a block. Wearing down a foe's gear by a die rolls it
    const guard = plan[key].block ?? null;
    const dice = (list) => (list ?? []).reduce((sum, proc) => {
      return sum + (proc.wears ? ["weapon", "shield"].filter((item) => proc.wears[item]?.dice).length : 0);
    }, 0);
    if ( guard ) {
      landed += 1 + (guard.parry ? 1 : 0) + rolled(mine.blocked) + rolled(target.chances?.block) + dice(mine.blocked) + dice(target.chances?.block)
        + rolled(target.chances?.blockFail) + dice(target.chances?.blockFail);
    }

    // What a hit comes to in the end: the chances of the attacker whose hit was curbed, and of a target that
    // took no damage
    landed += rolled(mine.curbed) + dice(mine.curbed) + rolled(target.chances?.unhurt);
    landed += dice([...(mine.attack ?? []), ...landing]);

    // A die for a share of the target's maximum HP dealt in place of the damage
    landed += (mine.attack ?? []).reduce((sum, proc) => sum + parts(proc).filter((part) => part.instead).length, 0);
    for ( const entry of inflicts ) landed += (entry.chance < 100 ? 1 : 0) + (entry.dice ? 1 : 0);
    // A die for the turns a condition lasts, and one for each pick among several conditions or changes
    for ( const proc of [...(mine.attack ?? []), ...landing] ) {
      for ( const part of parts(proc) ) landed += part.inflicts.filter((entry) => entry.dice).length + part.inflicts.filter((entry) => entry.anyOf).length;
      landed += (proc.grants ?? []).filter((grant) => grant.pick).length;

      // The dice that pick the stats of a change, for its unit or for each of a few units around
      landed += (proc.grants ?? []).reduce((sum, grant) => sum + (grant.random ? randomDice(grant.random) * (grant.reach ? 8 : 1) : 0), 0);
    }

    // Conditions that may be applied to the target, and those its skills may give the attacker in return
    const given = inflicts.length + (mayBurst ? 1 : 0) + [...(mine.attack ?? []), ...landing].reduce((sum, proc) => {
      return sum + parts(proc).reduce((count, part) => count + part.inflicts.length, 0);
    }, 0);
    const back = (target.chances?.struck ?? []).reduce((sum, proc) => sum + proc.inflictsAttacker.length, 0)
      + (handsBack(other(key)) ? given : 0);
    landed += (given * wards(other(key))) + (back * wards(key));
    const dodged = target.unit.fx?.rules?.has("dodgeFatal") ? 2 : 1;

    // Answers, and what is rolled in their place: a roll that is made again, a Hit roll that is made twice,
    // the chances of the target as it is attacked and as a hit would land, and the chances of either side to
    // bring to nothing a critical hit, a block, an answer or a skill of the other that activated
    const every = (chances) => Object.values(chances ?? {}).flat();
    const again = [...(mine.miss ?? []), ...(mine.critMiss ?? [])].filter((proc) => proc.reroll).length;
    const foils = ((target.chances?.foil ?? []).length * (2 + every(mine).length)) + ((mine.foil ?? []).length * (1 + every(target.chances).length));
    // A condition the target's skills give the attacker for attacking it, hit or miss, may be nullified
    const glared = (target.chances?.attacked ?? []).reduce((sum, proc) => sum + (proc.inflictsAttacker?.length ?? 0), 0) * wards(key);
    const more = 1 + (again * 4) + rolled(mine.critMiss) + rolled(target.chances?.attacked) + rolled(target.chances?.landing) + foils + glared;
    landed += more;
    return { landed, missed: dodged + more + rolled(mine.miss) + rolled(target.chances?.dodged) };
  };
  const afterDice = (key) => (plan[key].chances?.after ?? []).reduce((sum, proc) => {
    return sum + (proc.wears ? ["weapon", "shield"].filter((item) => proc.wears[item]?.dice).length : 0);
  }, 0);

  const fight = plan.order.reduce((total, key) => {
    const chances = plan[key].chances?.attack ?? [];
    const own = strike(key);

    // An attack that misses may be answered at once by an attack of the unit that dodged
    const target = plan[other(key)];
    const answers = target.blocked ? 0 : (target.chances?.dodged ?? []).filter((proc) => proc.attack).length;
    const back = strike(other(key));

    // So may one that is blocked. An attack with numbers of its own may be made by a unit that makes no other,
    // and may be blocked in turn
    const bashes = !plan[key].block ? [] : (target.chances?.block ?? []).filter((proc) => proc.attack && (proc.strike ? proc.strike.able : !target.blocked));
    const ripostes = bashes.length;
    const guarded = bashes.some((proc) => proc.strike?.plan?.block)
      ? 2 + rolled(plan[key].chances?.block) + rolled(plan[key].chances?.blockFail) + rolled(target.chances?.blocked)
      : 0;
    const reply = Math.max(back.landed, back.missed) + guarded;

    // And one that lands may be answered at once by an attack of the unit it hit
    const unarmed = !!target.blocked && !target.joins;
    const avenges = (target.chances?.struck ?? []).filter((proc) => proc.attack && (proc.strike ? proc.strike.able : !unarmed)).length;
    const most = Math.max(own.landed + ((ripostes + avenges) * reply), own.missed + (answers * reply));

    // An attack that skills turn into several rolls for each of them, and so does one that begins a chain of
    // attacks, for as many as the chain may come to
    const links = [...(plan[key].chances?.hit ?? []), ...(plan[key].chances?.crit ?? [])].reduce((sum, proc) => sum + (proc.chain?.most ?? 0), 0);
    const attacks = 1 + links + chances.reduce((sum, proc) => sum + Math.max((proc.sequence?.length ?? 1) - 1, 0), 0);
    return total + rolled(chances) + upgrades(chances) + (most * attacks);
  }, 0);
  if ( !plan.order.length ) return fight;

  // Damage that is no hit of an attack may be survived as a fatal hit may, each time it would be fatal, and a
  // unit that defeats its foe with it rolls what it rolls for defeating a foe
  const both = ["initiator", "defender"];
  const saves = both.reduce((sum, key) => sum + rolled((plan[key].chances?.struck ?? []).filter((proc) => proc.survive)), 0);
  const hurts = both.reduce((sum, key) => {
    const mine = plan[key].chances ?? {};
    const dealing = [...(mine.miss ?? []), ...(mine.dodged ?? []), ...(mine.struck ?? []), ...(mine.after ?? []),
      ...(mine.block ?? []), ...(mine.blocked ?? []), ...(mine.blockFail ?? []), ...(mine.curbed ?? []), ...(mine.unhurt ?? [])];
    // So does what a hit deals again, what cuts the HP its target has left, and what a hit that dealt no
    // damage deals in its place
    const beside = (plan[key].echoes ?? []).length + (mine.attack ?? []).filter((proc) => proc.cut).length
      + [...(mine.hit ?? []), ...(mine.crit ?? [])].filter((proc) => proc.harmless && (proc.retaliate > 0)).length;
    return sum + beside + dealing.filter((proc) => (proc.retaliate > 0) || (proc.reflect > 0) || proc.excess?.retaliate).length;
  }, 0);
  const outside = (saves * ((plan.order.length * (hurts + 2)) + hurts)) + both.reduce((sum, key) => sum + rolled(plan[key].chances?.kill), 0);

  // An attack a skill may have a side make in every round from the start of the fight: one that joins in, or
  // one made for pressing on
  const joined = both.reduce((sum, key) => {
    const count = (plan[key].chances?.start ?? []).filter((proc) => proc.attack || (proc.order === "press")).length;
    if ( !count ) return sum;
    const own = strike(key);
    const back = strike(other(key));
    return sum + (count * (Math.max(own.landed, own.missed) + Math.max(back.landed, back.missed) + rolled(plan[key].chances?.attack)));
  }, 0);

  // A fight of several rounds rolls the dice of each: all of them for the first few rounds, and the rest as
  // they are needed (the fight is handed more dice than were rolled where it runs longer). So it is for a
  // round a skill may have fought again, which is rolled for as each round ends
  const repeats = both.reduce((sum, key) => sum + (plan[key].chances?.[ROUND_MOMENT] ?? []).length, 0);
  const rounds = Math.max(Math.min(plan.rounds?.count ?? 1, FEO.rounds.rolled), repeats ? 2 : 1);

  // What skills do to the units around: the dice that pick a random one each time the moment may come, and
  // what may nullify a condition they put on the foe itself, as the fight begins or as they catch it
  const reaching = both.reduce((sum, key) => {
    const all = Object.values(plan[key].chances ?? {}).flat();
    const picks = all.reduce((count, proc) => count + ((proc.spread?.pick === "random") ? (proc.spread.targets ?? 1) : 0), 0);
    const laid = all.reduce((count, proc) => count + ((proc.spread?.foe && proc.spread.inflicts) ? proc.spread.inflicts.length : 0), 0)
      + (plan[key].chances?.start ?? []).reduce((count, proc) => count + (proc.inflicts?.length ?? 0), 0);
    return sum + (picks * Math.max(plan.order.length, 1)) + (laid * (1 + wards(other(key))));
  }, 0);
  return reaching + outside + ((fight + joined) * rounds) + (repeats * rounds) + both.reduce((sum, key) => {
    const given = (plan[key].chances?.after ?? []).reduce((count, proc) => count + proc.inflicts.length, 0);
    const warded = (given * wards(other(key))) + (handsBack(other(key)) ? given * wards(key) : 0);
    return sum + rolled(plan[key].chances?.start) + rolled(plan[key].chances?.after) + afterDice(key) + warded;
  }, 0);
}

/* -------------------------------------------- */

/**
 * The formations that stand in a planned fight (see `formationAround` in `positions.mjs`): each skill of a unit
 * whose attack is sure to take effect because the unit and two of its allies stand around its foe, with those
 * allies, for a forecast to name them and a map to mark them.
 * @param {ExchangePlan} plan
 * @returns {{skill: string, by: "initiator"|"defender", partners: {id: string, name: string, tile: object}[]}[]}
 */
export function planFormations(plan) {
  const list = [];
  if ( !plan?.order?.length ) return list;
  for ( const key of ["initiator", "defender"] ) {
    const side = plan[key];
    const mine = side?.unit;
    const foe = plan[other(key)]?.unit;
    if ( !mine || !foe ) continue;
    const taking = new Set((side.chances?.attack ?? []).filter((proc) => proc.sure).map((proc) => proc.source ?? proc.skill));
    for ( const skill of mine.skills ?? [] ) {
      if ( !taking.has(skill.name) || list.some((entry) => (entry.by === key) && (entry.skill === skill.name)) ) continue;
      const formation = (skill.effects ?? []).find((effect) => effect?.when?.formation && effect.proc)?.when.formation;
      const partners = formation ? formationAround(mine.near ?? null, foe.near ?? null, formation) : null;
      if ( !partners?.length ) continue;
      list.push({ skill: skill.name, by: key, partners: partners.map((unit) => ({ id: unit.id, name: unit.name, tile: unit.tile })) });
    }
  }
  return list;
}

/* -------------------------------------------- */

/**
 * What the skills of both units would do to the units around them in a planned fight (see `spread.mjs`), for a
 * forecast to name: each skill, the side whose it is, its moment, whether it is sure of it, and what each unit
 * it would catch would get as things stand. What is read from the damage of a hit goes by the first attack
 * as it is planned, and a random unit is not picked: every unit that could be is listed.
 * @param {ExchangePlan} plan
 * @returns {{skill: string, by: "initiator"|"defender", on: string, sure: boolean, chance: number, may: boolean,
 *   picks: number, units: import("./spread.mjs").SpreadShare[]}[]}
 */
export function spreadForecast(plan) {
  const list = [];
  if ( !plan?.order?.length || plan.extra ) return list;
  for ( const key of ["initiator", "defender"] ) {
    const side = plan[key];
    const foe = plan[other(key)];
    const mine = side?.unit;
    if ( !mine || !foe?.unit ) continue;
    const dealt = Math.max(Math.min(side.damage ?? 0, foe.unit.hp ?? 0), 0);
    for ( const on of ["start", "attack", "hit", "crit", "kill", "after"] ) {
      for ( const proc of side.chances?.[on] ?? [] ) {
        if ( !proc.spread ) continue;

        // Every unit it could go to, where dice or its owner pick among them
        const { targets, pick, ...open } = proc.spread;
        const picked = (targets !== undefined) && ["random", "choose"].includes(pick);
        const out = spreadOut(picked ? open : proc.spread, mine.near ?? null, foe.unit.near ?? null, {
          dealt,
          weaponReach: mine.weapon ? (parseRange(mine.weapon.range, mine.stats)?.max ?? 1) : 1,
          read: (value, unit) => readNumber(value, unit ?? mine, null)
        });
        if ( !out?.units.length ) continue;
        list.push({
          skill: proc.source ?? proc.skill,
          by: key,
          on,
          sure: !!proc.sure && ["start", "after"].includes(on),
          chance: proc.sure ? 100 : (proc.chance ?? 0),
          may: !!proc.may,
          picks: picked ? targets : 0,
          units: out.units
        });
      }
    }
  }
  return list;
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
 *
 * A fight may go on for more rounds than one (see `rounds.mjs`): where a skill used as an action started it so,
 * or where a skill of either unit has the round fought again. Each further round makes the attacks of the first
 * again, in the order the fight has them, with dice of its own; whoever acts for a unit may end the fight before
 * one where its skill says so, which is an answer like any other.
 *
 * An ally may come for a unit as the blow that would defeat it falls, as Guardian has it (see `rescue.mjs`).
 * Whether one does is only known once the fight has been rolled, so the fight is then rolled out again with
 * the same dice and `saved` naming the side that is come for: the attack that would have defeated it leaves
 * it with 1 HP instead, is marked `saved` with what was handed in, and ends the fight; nothing is done to that
 * unit or by it afterwards.
 * @param {ExchangePlan} plan
 * @param {() => number} d100   Returns a whole number from 1 to 100
 * @param {object} [options]
 *
 * A moment a skill marks `may` is an answer (see `answers.mjs`): whoever acts for its unit takes it or leaves
 * it. With `answers` given the fight stops at the first point it has no answer for, and `{ pending }` is
 * returned with that point; rolled out again from the same dice with one more answer it goes on from there
 * (see `playExchange`). Without `answers` nobody is asked, and every answer is left.
 * @param {ExchangePlan} plan
 * @param {() => number} d100   Returns a whole number from 1 to 100
 * @param {object} [options]
 * @param {{initiator?: {skill: string, by: string}, defender?: {skill: string, by: string}}|null} [options.saved]
 *                              The sides an ally comes for, each with the skill and the name of that ally
 * @param {(string|null)[]|null} [options.answers]
 *                              What was answered at each point so far, in order: the key of the offer that
 *                              was taken, or null for a pass
 * @param {{initiator?: {key: string, skill: string, by: string}[], defender?: object[]}|null} [options.standby]
 *                              The allies that could come for each side as the blow that would defeat it
 *                              falls, which is then an answer of theirs. One that says `at: "blow"` stands by
 *                              to take a hit that would land on that side, or to turn it back (see
 *                              `stances.mjs`): an answer of its own, at each hit that deals damage
 * @returns {ExchangeResult|{pending: import("./answers.mjs").AnswerPoint}}
 */
export function resolveExchange(plan, d100, options = {}) {
  try {
    return rollExchange(plan, d100, options);
  } catch(err) {
    if ( err instanceof Pending ) return { pending: err.point };
    throw err;
  }
}

/* -------------------------------------------- */

/**
 * Roll out a planned exchange for whoever plays it: each time an answer is awaited, `decide` is asked for it,
 * and the fight is rolled out again from the same dice with what was answered so far.
 * @param {ExchangePlan} plan
 * @param {(index: number) => number} at      The d100 at a place in the row of dice, counted from 0
 * @param {(point: import("./answers.mjs").AnswerPoint) => string|null} [decide]
 *                                            The key of the offer taken at a point, or null to pass
 * @param {object} [options]                  As for `resolveExchange`
 * @returns {{result: ExchangeResult, answers: (string|null)[], used: number}}
 *          The fight, what was answered, and how many dice it used
 */
export function playExchange(plan, at, decide = () => null, options = {}) {
  const answers = [];
  for ( let turn = 0; turn < 500; turn++ ) {
    let used = 0;
    const result = resolveExchange(plan, () => at(used++), { ...options, answers });
    if ( !result.pending ) return { result, answers, used };
    answers.push(decide(result.pending) ?? null);
  }
  throw new Error("An exchange asked for more answers than a fight can have.");
}

/* -------------------------------------------- */

/**
 * Roll out a planned exchange as far as it goes (see `resolveExchange`): an answer that is awaited stops it.
 * @param {ExchangePlan} plan
 * @param {() => number} d100
 * @param {object} [options]
 * @returns {ExchangeResult}
 */
function rollExchange(plan, d100, { saved = null, answers = null, standby = null } = {}) {
  // The sides an ally comes for: those named, and those an ally answers for as the blow falls
  const come = { ...(saved ?? {}) };

  // The hits an ally outside the fight took in a unit's place or turned back, and the allies that have
  const warding = [];
  const wardedBy = new Set();

  // What stands, among the chances of a unit that is struck, for the halving of a hit that would be fatal
  const HALVE = Symbol("halve");

  // And for the point at which the owner of a unit that is struck may answer the hit
  const ASK = Symbol("ask");

  // And for the point at which an attack that kills outright does, once the hit is lessened
  const SLAY = Symbol("slay");

  // A unit that nothing kills outright, and whose HP nothing cuts by a share
  const deathless = (key) => !!plan[key].unit.fx?.rules?.has(NO_LETHALITY);
  const state = {};
  for ( const key of ["initiator", "defender"] ) {
    const { hp, weapon, conditions, shield } = plan[key].unit;
    state[key] = {
      hp,
      uses: weapon ? weapon.uses.value : null,
      usesSpent: 0,
      broke: false,

      // The Shield it has equipped: the uses it has left, and what the fight cost it
      shieldUses: shield ? (shield.uses?.value ?? 0) : null,
      shieldSpent: 0,
      shieldBroke: false,
      wexp: 0,
      conditions: { ...(conditions ?? {}) },
      healed: 0,
      held: false,
      break: false,
      staggered: false,
      next: { hit: 0, damage: 0, critical: 0 },

      // What of that waits for its next attack in a later fight, by the skill that set it aside
      kept: {},
      landed: false,
      hits: 0,
      struck: false,
      swung: false,

      // The attacks it has made in this fight and those that were made against it, for what counts them, and
      // the share a skill has it take less from the later ones (see `rounds.mjs`)
      made: 0,
      faced: 0,
      cuts: null,

      // What the damage of the hits it takes is multiplied by for the rest of the fight, for what was
      // granted to it during the fight and counts at once
      takenNow: 1,
      takenGrant: 1,
      nowBy: new Set(),
      unharmed: false,

      // The skills of its foe that cancelled its next attacks, one for each attack it will not make
      cancelled: [],

      // A skill of its foe had it put down its weapon and its Shield: it attacks no more and blocks nothing
      disarmed: false,

      // The skills that take effect by themselves and count their uses, once for each time one did
      counted: [],

      // The skills of which a moment took effect, for one that is only spent by a fight in which that came about
      fired: new Set(),

      // What each Skill of its own that rolled to activate and did divides its stat by, for what counts them
      sparked: [],

      // The skills that answered in this fight, for one that answers once in it; whether the unit rolls its
      // Hit rolls twice from here on; and the uses its answers took off the items it carries, by item
      answered: new Set(),
      worst: false,
      items: {}
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

  // The fight planned again in the middle of it (see `planExchange`), once a unit was given a change that
  // counts for the rest of the fight, or once what lasted only a part of it is over: each side's numbers are
  // then those of the new plan, from its next attack on. Who attacks, in what order and with which chances
  // stays as the fight began. A plan that does not say what it was planned from cannot be planned again
  const NUMBERS = ["base", "strike", "power", "resisted", "resists", "defence", "effectiveMore", "mightMultiplier", "triangleHit", "triangleDamage",
    "curb", "cap", "cappedBy", "echoes", "block", "fcm", "critFollow"];
  const given = plan.given ?? null;
  const counting = { initiator: [], defender: [] };
  const over = { initiator: [], defender: [] };
  const renewed = { initiator: null, defender: null };
  const renew = () => {
    if ( !given ) return false;
    // What was sure to be granted as the fight began is among what counts by now: it is not counted again
    const fresh = planExchange(given.initiator, given.defender, { ...given.options, more: counting, lapsed: over, primed: true });
    for ( const key of ["initiator", "defender"] ) {
      renewed[key] = { ...plan[key], fresh: fresh[key] };
      for ( const name of NUMBERS ) renewed[key][name] = fresh[key][name];
    }
    shifted = true;
    return true;
  };

  // A change that was granted counts from here on: its unit carries it into the fight as it is planned again
  const countNow = (to, change) => {
    if ( !given ) return false;
    counting[to] = [...counting[to], change];
    return renew();
  };

  // An attack with numbers of its own, as they stand once the fight was planned again
  const ownOf = (entry) => {
    const own = entry.strike?.plan ?? null;
    const fresh = own ? renewed[entry.key]?.fresh : null;
    if ( !fresh ) return own;
    for ( const on of ["block", "dodged", "start", "attack", "struck"] ) {
      const found = (fresh.chances?.[on] ?? []).find((proc) => (proc.skill === entry.added) && proc.strike?.plan);
      if ( found ) return found.strike.plan;
    }
    return own;
  };

  // Which attack of the fight is being made, for a change that says where it began to count
  let current = null;
  const lose = (unit, hp, damage) => {
    const staying = unit.resilience;
    return Number.isFinite(staying) ? takeHit(hp, damage, staying).hp : Math.max(hp - damage, 0);
  };
  const roll = (proc, by, plus = 0) => {
    const rolled = d100();
    const chance = plus ? clamp(proc.chance + plus, 0, 100) : proc.chance;
    return { skill: proc.skill, on: proc.on, by, roll: rolled, chance, success: rolled <= chance };
  };

  // A die of so many faces, read from a d100
  const die = (faces) => Math.min(Math.floor(((d100() - 1) * faces) / 100), faces - 1) + 1;

  // A skill wears down what a unit fights with: uses its weapon and its Shield lose, now or, where the skill
  // says so, once the fight is over. A weapon or Shield that never wears out loses none
  // `skill` names the skill that does it, which is told with what it took: one entry for each skill of a side
  const wearing = [];
  const worn = [];
  const wearDown = (to, wears, { later = false, skill = "" } = {}) => {
    if ( !wears ) return;
    if ( wears.after && !later ) {
      wearing.push({ to, wears, skill });
      return;
    }
    const target = state[to];
    const amount = (value) => (value && (typeof value === "object")) ? die(value.dice) : (value ?? 0);
    const took = { weapon: 0, shield: 0 };
    const blade = amount(wears.weapon);
    if ( (blade > 0) && (plan[to].unit.weapon?.uses?.max > 0) ) {
      const lost = Math.min(blade, Math.max(target.uses, 0));
      target.uses -= lost;
      target.usesSpent += lost;
      if ( lost > 0 ) target.broke = target.uses <= 0;
      took.weapon = lost;
    }
    const guard = amount(wears.shield);
    if ( (guard > 0) && (plan[to].unit.shield?.uses?.max > 0) ) {
      const lost = Math.min(guard, Math.max(target.shieldUses, 0));
      target.shieldUses -= lost;
      target.shieldSpent += lost;
      if ( lost > 0 ) target.shieldBroke = target.shieldUses <= 0;
      took.shield = lost;
    }
    if ( !skill || !(took.weapon || took.shield) ) return;
    const told = worn.find((entry) => (entry.skill === skill) && (entry.to === to));
    if ( told ) {
      told.weapon += took.weapon;
      told.shield += took.shield;
    }
    else worn.push({ skill, by: other(to), to, ...took });
  };

  // Attacks that were not made because a skill of the foe cancelled them
  const cancelled = [];

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

  // A skill may bring to nothing something its unit's foe does: a critical hit, a block, a skill that is
  // chosen when to activate, one that rolled to activate and did. `by` is the side that does it, whose foe
  // rolls for each of its chances that can, until one comes; the skill that did is returned
  const foil = (kind, by, into, what = "") => {
    const foe = other(by);
    if ( state[foe].hp <= 0 ) return null;
    for ( const proc of plan[foe].chances?.foil ?? [] ) {
      if ( !proc.foils?.includes(kind) ) continue;
      const rolled = proc.sure ? { skill: proc.skill, on: proc.on, by: foe, roll: null, chance: 100, success: true, sure: true } : roll(proc, foe);
      rolled.foils = kind;
      if ( what ) rolled.what = what;
      into.push(rolled);
      if ( !rolled.success ) continue;
      state[foe].fired.add(proc.skill);
      if ( proc.grade && !proc.sure ) state[foe].sparked.push(proc.grade);
      return proc.skill;
    }
    return null;
  };

  // Answers (see `answers.mjs`). A moment marked `may` is offered to whoever acts for its unit: the fight
  // stops at a point it has no answer for yet, and takes what was answered where it has one. `noted` is where
  // the answers taken for the attack in hand are told, and `about` what an offer says of that attack
  let asked = 0;
  const loose = [];
  let noted = loose;
  let about = null;

  // The damage of the attack in hand before its target's defence, for an answer that deals a share of it
  let might = 0;

  // Can a skill answer now? Not once it has answered in a fight it answers once in, nor without a use left
  const usable = (proc, by) => {
    if ( !proc.may ) return false;

    // What reaches for the units around is only offered where it reaches one
    if ( proc.spread && !spreadReach(proc, by).length ) return false;
    if ( proc.once && state[by].answered.has(proc.skill) ) return false;
    if ( !proc.uses || (proc.uses.left === null) ) return true;
    const same = (entry) => (entry.id ?? entry.name) === (proc.uses.id ?? proc.uses.name);
    return state[by].counted.filter(same).length < proc.uses.left;
  };

  // The units a spread of a side would reach as things stand (see `spread.mjs`)
  const spreadReach = (proc, by) => {
    if ( plan.extra ) return [];
    const mine = plan[by].unit;
    return spreadTo(proc.spread, mine.near ?? null, plan[other(by)].unit.near ?? null, {
      weaponReach: mine.weapon ? (parseRange(mine.weapon.range, mine.stats)?.max ?? 1) : 1
    }) ?? [];
  };

  // The other enemies of a unit that stand next to it or next to its foe, for a share of a hit to go to
  const splashUnits = (by, splash) => {
    const mine = plan[by].unit.near ?? null;
    const theirs = plan[other(by)].unit.near ?? null;
    const found = new Map();
    const add = (list) => {
      for ( const unit of list ?? [] ) {
        if ( (unit.id !== theirs?.id) && reachable({ ...unit, relation: "enemy" }) && !found.has(unit.id) ) found.set(unit.id, unit);
      }
    };
    if ( splash.around !== "foe" ) add(unitsNear(mine, { who: "enemy", within: 1 }));
    if ( splash.around !== "self" ) add(unitsNearFoe(mine, theirs, { who: "enemy", within: 1 }));
    return [...found.values()];
  };
  const splashAmount = (splash) => Math.floor(((might * splash.percent) / 100) + 1e-9);

  // What an answer comes to as an offer: one, or one for each item its unit could spend the uses of
  const offersOf = (proc, by) => {
    const mine = state[by];
    const costs = proc.costs;
    const offer = { key: proc.skill, skill: proc.skill, id: proc.uses?.id ?? null, what: answerKind(proc), proc };
    if ( costs?.item ) {
      return (plan[by].unit.carried ?? []).filter((item) => weaponIs(item, costs.item)).map((item) => {
        const wears = item.uses?.max > 0;
        const left = (item.id === plan[by].unit.weapon?.id) ? mine.uses : (item.uses?.value ?? 0) - (mine.items[item.id] ?? 0);
        if ( wears && (left < costs.uses) ) return null;
        return {
          ...offer,
          key: `${proc.skill}|${item.id}`,
          item: { id: item.id, name: item.name ?? "", img: item.img ?? "" },
          cost: wears ? costs.uses : 0,
          amount: proc.reduceItem ? (item.might ?? 0) : proc.reduce
        };
      }).filter(Boolean);
    }
    if ( costs?.weapon ) {
      const weapon = plan[by].unit.weapon;
      const wears = weapon?.uses?.max > 0;
      if ( !weapon || (wears && (mine.uses <= costs.weapon)) ) return [];
      offer.cost = wears ? costs.weapon : 0;
    }
    if ( offer.what === "dodgeMore" ) offer.amount = proc.combat.dodge;
    else if ( offer.what === "reduce" ) offer.amount = proc.reduce;
    else if ( offer.what === "harm" ) offer.amount = proc.retaliate;
    else if ( (offer.what === "plain") && proc.splash ) {
      offer.amount = splashAmount(proc.splash);
      offer.others = Math.min(splashUnits(by, proc.splash).length, proc.splash.count);
    }
    else if ( offer.what === "spread" ) {
      const reached = spreadReach(proc, by).length;
      offer.others = Number.isInteger(proc.spread.targets) ? Math.min(reached, proc.spread.targets) : reached;
    }
    return [offer];
  };

  // Ask a side which of its offers it takes. Nobody is asked where the fight is rolled out without answers
  // `more` is what else the point tells of, as where the two stand when a round ends
  const ask = (on, by, offers, more = null) => {
    if ( !answers || !offers.length ) return null;
    const index = asked++;
    if ( index >= answers.length ) {
      throw new Pending({ index, on, side: by, attack: about ? { ...about } : null, offers: offers.map(({ proc, ...told }) => told), ...(more ?? {}) });
    }
    return offers.find((offer) => offer.key === answers[index]) ?? null;
  };

  // An answer is taken: its skill is spent as one that takes effect by itself is, what it costs is paid, and
  // it is told with the attack in hand. One of a skill that is chosen when to activate may be brought to
  // nothing by a skill of the foe: it is spent and paid for all the same
  const take = (offer, by, into) => {
    const proc = offer.proc;
    const mine = state[by];
    if ( proc.uses ) mine.counted.push({ id: proc.uses.id ?? undefined, name: proc.uses.name });
    if ( proc.once ) mine.answered.add(proc.skill);
    mine.fired.add(proc.skill);
    const told = { skill: proc.skill, by, on: proc.on, what: offer.what };
    if ( offer.amount !== undefined ) told.amount = offer.amount;
    noted.push(told);
    const pay = (amount) => {
      const lost = Math.min(amount, Math.max(mine.uses ?? 0, 0));
      mine.uses -= lost;
      mine.usesSpent += lost;
      if ( lost > 0 ) mine.broke = mine.uses <= 0;
    };
    if ( offer.item ) {
      told.item = offer.item.name;
      told.cost = offer.cost;
      if ( (offer.cost > 0) && (offer.item.id === plan[by].unit.weapon?.id) ) pay(offer.cost);
      else if ( offer.cost > 0 ) mine.items[offer.item.id] = (mine.items[offer.item.id] ?? 0) + offer.cost;
    }
    else if ( offer.cost > 0 ) {
      told.cost = offer.cost;
      pay(offer.cost);
    }
    if ( proc.chosen ) {
      const foiled = foil("choose", by, into, proc.skill);
      if ( foiled ) {
        told.foiled = foiled;
        return null;
      }
    }
    return told;
  };

  // Offer a side its answers to a point, together. One is taken at a time, and the rest are offered again for
  // as long as `apply` does not say the point is gone; each is offered once. `procs` may be a function, for
  // a point whose answers change with what was taken. The last one taken is returned
  const answer = (on, by, procs, into, apply = null) => {
    const done = new Set();
    let taken = null;
    for ( ;; ) {
      const open = ((typeof procs === "function") ? procs() : (procs ?? [])).filter((proc) => !done.has(proc) && usable(proc, by));
      if ( !open.length ) break;
      const offer = ask(on, by, open.flatMap((proc) => offersOf(proc, by)));
      if ( !offer ) break;
      done.add(offer.proc);
      if ( !take(offer, by, into) ) continue;
      taken = offer;
      if ( apply && (apply(offer) === false) ) break;
    }
    return taken;
  };

  // A skill cancels its foe's next attacks in this fight: no more of them wait at a time than it says
  const cancel = (proc, by) => {
    const waiting = state[other(by)].cancelled;
    for ( let n = waiting.filter((skill) => skill === proc.skill).length; n < proc.cancels; n++ ) waiting.push(proc.skill);
  };

  // Does a skill take effect now that its moment has come? One that is sure does without a roll, and one that
  // only has its moment once in a fight has had it after the first time. One its owner may take or leave is
  // offered. One that rolled to activate and did may be brought to nothing by a skill of the foe
  const spent = new Set();

  // What skills take from the foe, for once the fight is over (see `stealing.mjs`), and the sides a skill of
  // the foe had put down what they hold
  const looted = [];
  const disarmed = [];

  // The creatures skills raise from the foe once the fight is over (see `creatures.mjs`)
  const raised = [];
  const fire = (proc, by, into, plus = 0) => {
    if ( proc.may ) return !!answer(proc.on, by, [proc], into);
    if ( proc.once ) {
      if ( spent.has(proc) ) return false;
      spent.add(proc);
    }

    // What takes from the foe once for each enemy, or one item of its pack, has done so after the first time
    if ( (proc.loot?.once || proc.loot?.steal) && looted.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) return false;

    // A skill that counts its own uses takes effect no more often than it has uses left
    const same = (entry) => (entry.id ?? entry.name) === (proc.uses.id ?? proc.uses.name);
    if ( proc.uses && (proc.uses.left !== null) && (state[by].counted.filter(same).length >= proc.uses.left) ) return false;
    let success = true;
    if ( proc.sure ) into.push({ skill: proc.skill, on: proc.on, by, roll: null, chance: 100, success: true, sure: true });
    else {
      const rolled = roll(proc, by, plus);
      into.push(rolled);
      success = rolled.success;
      const foiled = (success && !proc.fixed) ? foil("activation", by, into, proc.skill) : null;
      if ( foiled ) {
        rolled.success = false;
        rolled.foiled = foiled;
        success = false;
      }
    }
    // A step its owner may take or leave uses its skill only once it is taken, which the map sees to
    // And so does an item of the foe's pack its owner picks once the fight is over
    // And so does a creature raised from the foe, which the map sees to once it is known what became of the foe
    if ( success && proc.uses && !proc.step?.may && !proc.loot?.steal && !proc.makes ) state[by].counted.push({ id: proc.uses.id ?? undefined, name: proc.uses.name });
    if ( success ) state[by].fired.add(proc.skill);
    if ( success && proc.grade && !proc.sure ) state[by].sparked.push(proc.grade);
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

  // The stats a change has its unit pick: whoever acts for the unit is asked for each in turn, as for an answer
  // (see `answers.mjs`), and what they leave open is picked for them, by the stats of the units that are to
  // carry the change
  const choose = (choice, by, carriers, skill) => {
    const picked = [];
    const count = pickCount(choice);
    while ( picked.length < count ) {
      const offers = [...new Set(choice.stats)].filter((stat) => !picked.includes(stat)).map((stat) => {
        return { key: `${skill}|${stat}`, skill, id: null, what: "pick", stat, amount: choice.amount, left: count - picked.length };
      });
      const offer = ask("pick", by, offers);
      if ( !offer ) break;
      picked.push(offer.stat);
    }
    return chosenEffects(choice, picked, carriers);
  };
  // `reading` leaves out what is read from the hit ("skip") or gives nothing else ("only"), for what a unit
  // that is struck is granted before and after the hit is dealt
  const give = (proc, by, { part = null, dealt = null, reading = null } = {}) => {
    const giver = plan[by].unit;
    const amounts = (typeof dealt === "number") ? { dealt } : (dealt ?? {});

    // Stats that dice pick, anew for each unit that is to carry the change
    const diced = (grant) => {
      if ( !grant.random ) return grant;
      const { effects, stats } = randomEffects(grant.random, die);
      if ( !effects.length ) return null;
      const name = grant.random.apart ? `${grant.name ?? proc.source ?? proc.skill} (${stats.map((key) => key.toUpperCase()).join(", ")})` : grant.name;
      return { ...grant, effects, ...(name ? { name } : {}) };
    };
    for ( let grant of proc.grants ?? [] ) {
      if ( part && ((part === "foe") !== foeSide(grant)) ) continue;

      // One that waits for its unit to defeat its foe in this fight
      if ( grant.kill && (state[other(by)].hp > 0) ) continue;

      // One of several changes, picked by a die
      if ( grant.pick?.length ) {
        const { pick, ...rest } = grant;
        const count = pick.length;
        grant = { ...rest, ...pick[Math.min(Math.floor(((d100() - 1) * count) / 100), count - 1)] };
      }

      // A change read from the hit, its damage or what a skill took off it: one that hit made nothing of is
      // not granted
      const reads = HIT_SOURCES.filter((source) => readsDealt(grant.effects, [source]) || readsDealt(grant.mend, [source]) || readsDealt(grant.grows, [source]));
      if ( reads.length ) {
        if ( (reading === "skip") || reads.some((source) => !(amounts[source] > 0)) ) continue;
        grant = { ...grant, effects: resolveDealt(grant.effects, amounts) };
        if ( grant.mend && (typeof grant.mend === "object") ) grant.mend = resolveDealt(grant.mend, amounts);

        // What a tally grows by, read from the hit: one that hit adds nothing to is not granted
        if ( grant.grows && (typeof grant.grows === "object") ) {
          grant.grows = resolveDealt(grant.grows, amounts);
          if ( !(grant.grows > 0) ) continue;
        }
      }
      else if ( reading === "only" ) continue;
      const about = { skill: proc.source ?? proc.skill, giver: giver.uuid ?? "", giverInTurn: by === "initiator" };

      // What an aura grants the unit it comes from, which stands outside of the fight: that unit's own change.
      // An aura that is given once a turn is used up by it until the Phase ends
      if ( grant.to === "giver" ) {
        if ( !proc.giverId ) continue;
        const theirs = { skill: proc.source ?? proc.skill, own: true };
        granted.push({ by, to: null, unit: proc.giverId, name: proc.giver ?? "", change: buildChange(grant, theirs) });
        if ( proc.limit === "turn" ) {
          const used = buildChange({ name: usedName(proc.source ?? proc.skill), effects: [], ends: "phaseEnd", mark: true }, theirs);
          granted.push({ by, to: null, unit: proc.giverId, name: proc.giver ?? "", change: used, mark: true });
        }
        continue;
      }
      if ( grant.reach ) {
        const found = (grant.around === "foe")
          ? unitsNearFoe(giver.near ?? null, plan[other(by)].unit.near ?? null, grant.reach)
          : unitsNear(giver.near ?? null, grant.reach);
        if ( !found ) {
          if ( !reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) reminders.push({ skill: proc.skill, by });
          continue;
        }
        // Of the units in reach, only those whose stat is lower than the giver's, where the change says so
        const reached = surpassed(giver, found.filter((entry) => reachable({ ...entry, relation: grant.reach.who })), grant.over);
        if ( !reached.length ) continue;
        if ( grant.choose ) {
          grant = { ...grant, effects: choose(grant.choose, by, reached.map((entry) => entry.totals ?? entry.stats ?? {}), proc.source ?? proc.skill) };
          if ( !grant.effects.length ) continue;
        }
        for ( const unit of reached ) {
          const theirs = diced(grant);
          if ( theirs ) granted.push({ by, to: null, unit: unit.id, name: unit.name, change: buildChange(theirs, { ...about, from: giver.name ?? "" }) });
        }
        continue;
      }
      const to = (grant.to === "foe") ? other(by) : by;
      if ( state[to].hp <= 0 ) continue;

      // A unit that negates what would be put on it is given nothing by its foe
      if ( (to !== by) && bendsOf(to)?.debuffs.negate ) continue;
      grant = diced(grant);
      if ( !grant ) continue;

      // Stats that whoever acts for the giver picks, or that are picked for them
      if ( grant.choose ) {
        grant = { ...grant, effects: choose(grant.choose, by, [plan[to].unit.stats ?? {}], proc.source ?? proc.skill) };
        if ( !grant.effects.length ) continue;
      }

      // What an aura handed this unit comes from the unit that has the skill
      const own = (to === by) && !proc.giver;
      const change = buildChange(grant, { ...about, from: proc.giver || (giver.name ?? ""), own, carrierInTurn: to === "initiator" });

      // It may count at once, for the rest of this fight: the fight is planned again with its unit carrying
      // it. Where it cannot be, what it adds to the damage its unit takes counts all the same
      const called = `${grant.name ?? proc.source ?? proc.skill}|${by}`;
      let counted = false;
      if ( grant.now ) {
        counted = countNow(to, change);
        if ( !state[to].nowBy.has(called) ) {
          state[to].nowBy.add(called);
          for ( const effect of grant.effects ?? [] ) {
            if ( effect.takenPercent ) state[to].takenGrant *= Math.max(1 + (effect.takenPercent / 100), 0);
            if ( effect.rules?.includes("noSkillDamage") ) state[to].unharmed = true;
            if ( effect.calc?.dodgeBy === "none" ) state[to].dodgeless = true;
            if ( effect.rules?.includes(WORST_HIT) ) state[to].worst = true;
          }
        }
        shifted = true;
      }
      granted.push({
        by,
        to,
        unit: null,
        name: plan[to].unit.name ?? "",
        change,

        // Where it began to count in this fight: after which attack, for the card to say so there
        ...(grant.now ? { now: true, ...((current !== null) ? { at: current } : {}), ...(counted ? { counted: true } : {}) } : {})
      });
    }
  };
  // Another go a skill earns the unit that started the fight, for its turn once the fight is over
  const goes = [];

  // A Refresh a skill of that unit hands out once the fight is over (see `refresh.mjs`)
  const sung = [];

  // How skills move units once the fight is over, each once for its side
  const steps = [];
  const remind = (proc, by, about = {}) => {
    give(proc, by, about);

    // What it does to the units around, once for each time its moment comes
    if ( !about.part ) spreadNow(proc, by, about);
    if ( proc.step && !steps.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) {
      steps.push({ skill: proc.skill, ...(proc.uses?.id ? { id: proc.uses.id } : {}), by, step: proc.step });
    }
    if ( proc.acts && (by === "initiator") && !goes.some((entry) => entry.skill === proc.skill) ) goes.push({ skill: proc.skill, by, acts: proc.acts });

    // What it takes from the foe: each time its moment comes, or once where it says so
    if ( proc.loot && !about.part ) {
      const single = !!(proc.loot.once || proc.loot.steal);
      if ( !single || !looted.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) {
        looted.push({ skill: proc.skill, ...(proc.uses?.id ? { id: proc.uses.id } : {}), by, on: proc.on, loot: proc.loot });
      }
    }

    // The creature it raises from the foe it defeated, once for each skill
    if ( proc.makes && !about.part && !raised.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) {
      raised.push({ skill: proc.skill, ...(proc.uses?.id ? { id: proc.uses.id } : {}), by, on: proc.on, makes: proc.makes });
    }

    // The attack it was rolled for has landed: the foe puts down its weapon and its Shield, if it still stands
    if ( proc.unequips && (about.part === "foe") && (state[other(by)].hp > 0) && !state[other(by)].disarmed ) {
      state[other(by)].disarmed = true;
      disarmed.push({ side: other(by), skill: proc.skill, by });
    }

    // A Refresh the skill hands out: to the unit that started the fight, or to the allies around it
    if ( proc.refreshes && (by === "initiator") && !sung.some((entry) => entry.skill === proc.skill) ) sung.push({ skill: proc.skill, by, refreshes: proc.refreshes });
    if ( !proc.remind || ((proc.remind === "foe") && (state[other(by)].hp <= 0)) ) return;
    if ( !reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) reminders.push({ skill: proc.skill, by });
  };

  // A condition a skill gives a unit outside of the hit itself. What guards the unit may nullify it; `keep`
  // is for one handed back for a few turns, which never cuts short what the unit already suffers
  // It goes by the same rule as a condition put on a unit outside of a fight (see `events.mjs`)
  const afflict = (to, id, { turns, more = 0, keep = false } = {}) => {
    const target = state[to];
    const given = receiveCondition({ conditions: target.conditions, hp: target.hp, wards: bendsOf(to)?.nullify }, id, { turns, more, keep }, d100);
    if ( !given ) return null;
    const { state: suffered, held, ...told } = given;
    if ( told.success === false ) return told;
    if ( suffered[id] !== target.conditions[id] ) shifted = true;
    target.conditions = suffered;
    if ( held ) target.held = true;
    return told;
  };

  // One side has given the other a condition: the skills of the giver that wait for that take effect, and
  // those of the unit that suffers it may hand it back. What is handed back sets off nothing further.
  // `record` is what the card reads the conditions handed back from
  const passOn = (by, inflicted, into, record) => {
    const to = other(by);
    for ( const proc of plan[by].chances?.inflict ?? [] ) {
      if ( proc.conditions && !proc.conditions.includes(inflicted.id) ) continue;
      if ( !fire(proc, by, into) ) continue;

      // HP its unit regains for inflicting it
      const mine = state[by];
      const restored = (mine.hp > 0) ? Math.max(Math.min(proc.recover ?? 0, (plan[by].unit.hpMax ?? Infinity) - mine.hp), 0) : 0;
      mine.hp += restored;
      mine.healed += restored;

      // A change that lasts as long as the condition does, counted from the afflicted unit's next turn
      const turns = Math.max(inflicted.turns ?? 1, 1);
      // It ends with the condition if that is cured early
      const grants = (proc.grants ?? []).map((grant) => (grant.turns === "condition") ? { ...grant, turns, next: true, while: inflicted.id } : grant);
      remind({ ...proc, grants }, by, { inflicted });
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

  // A unit has defeated its foe by something other than the hit of an attack: what its skills give it for
  // defeating a foe is given all the same
  const slain = [];
  const slay = (by, rolls) => {
    slain.push({ by });
    for ( const proc of plan[by].chances?.kill ?? [] ) {
      if ( !fire(proc, by, rolls) ) continue;
      const mine = state[by];
      const restored = (mine.hp > 0) ? Math.max(Math.min(proc.recover, (plan[by].unit.hpMax ?? Infinity) - mine.hp), 0) : 0;
      mine.hp += restored;
      mine.healed += restored;
      if ( proc.gold > 0 ) earned.push({ skill: proc.skill, by, gold: proc.gold });
      remind(proc, by);
    }
  };

  // Damage that is no hit of an attack: what a skill deals, a condition that bursts, a weapon that backfires.
  // A blow of that kind that would be fatal may be survived as a fatal hit may, a unit that takes no damage
  // for now takes none of its own weapon either, and the unit whose skill brings its foe down has defeated it.
  // `rolls` is where the chances that were rolled for it are told; the damage that was dealt is returned
  const hurt = (to, amount, { kind = "skill", nonlethal = false, by = null, rolls = [] } = {}) => {
    const target = state[to];
    const unit = plan[to].unit;
    const before = target.hp;
    let damage = Math.max(amount, 0);
    if ( (kind !== "skill") && ((target.takenNow * target.takenGrant) === 0) ) damage = 0;
    if ( !(damage > 0) || (before <= 0) ) return 0;
    if ( !nonlethal && (damage >= before) ) {
      // A blow that would be fatal is halved for a unit whose skills say so, before anything is rolled to
      // survive it; it may be fatal still
      if ( unit.fx?.rules?.has("halveFatal") ) damage = Math.floor(damage / 2);
      const saving = (plan[to].chances?.struck ?? []).filter((chance) => chance.survive);
      for ( const proc of [...saving.filter((chance) => !chance.uses), ...saving.filter((chance) => chance.uses)] ) {
        if ( damage < before ) break;
        if ( (proc.survive === true) ? (before <= 1) : !hpHolds(proc.survive.hp, before, unit.hpMax ?? unit.hp) ) continue;
        if ( !fire(proc, to, rolls) ) continue;
        if ( proc.survive === true ) damage = Math.floor(damage / 2);
        if ( damage >= before ) damage = before - 1;
        remind(proc, to);
      }
    }
    target.hp = nonlethal ? Math.max(before - damage, 1) : lose(unit, before, damage);
    jolt(to, before - target.hp);
    if ( by && (target.hp <= 0) ) slay(by, rolls);
    return nonlethal ? before - target.hp : damage;
  };

  // Damage a skill deals to the foe of its unit outside of an attack
  const harm = (proc, by, into, rolls = []) => {
    const to = other(by);
    const target = state[to];
    if ( !(proc.retaliate > 0) || (target.hp <= 0) || unharmed(to) ) return;
    const amount = hurt(to, proc.retaliate * weak(to), { nonlethal: proc.nonlethal, by, rolls });
    into.push({ skill: proc.skill, by, to, amount });
  };

  // What a skill does to the units around the two as it takes effect (see `spread.mjs`). The unit that is
  // fought is dealt with at once, inside the fight; what the others get is told, for whoever rolls the fight
  // out to deal once it is saved, each through the one way damage, healing and conditions come to a unit. An
  // attack a skill has its unit make on another unit beside a fight sets off none of its own
  const spreads = [];
  const spreadRolls = [];
  const spreadNow = (proc, by, { dealt = 0, inflicted = null } = {}) => {
    if ( !proc.spread || plan.extra ) return;
    const spread = proc.spread;
    const mine = plan[by].unit;
    const to = other(by);
    const skill = proc.source ?? proc.skill;
    const out = spreadOut(spread, mine.near ?? null, plan[to].unit.near ?? null, {
      dealt: (typeof dealt === "number") ? dealt : (dealt?.dealt ?? 0),
      inflicted,
      die,
      weaponReach: mine.weapon ? (parseRange(mine.weapon.range, mine.stats)?.max ?? 1) : 1,
      read: (value, unit) => readNumber(value, unit ?? mine, null)
    });

    // Where it cannot be seen who stands around, the skill is announced instead
    if ( !out ) {
      if ( !reminders.some((entry) => (entry.skill === proc.skill) && (entry.by === by)) ) reminders.push({ skill: proc.skill, by });
      return;
    }
    const about = { skill, from: mine.name ?? "", giver: mine.uuid ?? "", giverInTurn: by === "initiator" };
    const left = (share) => (spread.grant ? buildChange(spreadGrant(spread.grant, share.inflicts), about) : null);
    const settle = (share) => {
      const change = left(share);
      return change ? { ...share, change } : share;
    };
    const units = [];
    for ( const share of out.units ) {
      if ( !share.foe ) {
        units.push(settle(share));
        continue;
      }

      // The unit that is fought takes its share at once
      const target = state[to];
      if ( (target.hp <= 0) || target.away ) continue;
      const told = { id: share.id, name: share.name, foe: true };
      if ( (share.damage > 0) && !unharmed(to) ) told.damage = hurt(to, share.damage * weak(to), { nonlethal: !!spread.nonlethal, by, rolls: spreadRolls });
      for ( const entry of (target.hp > 0) ? (share.inflicts ?? []) : [] ) {
        const given = afflict(to, entry.id, { turns: entry.turns, more: entry.passed ? 0 : (bendsOf(by)?.inflictTurns[entry.id] ?? 0) });
        if ( !given ) continue;
        (told.inflicted ??= []).push(given);

        // A condition that is passed on sets off nothing further
        if ( (given.success !== false) && !entry.passed && (proc.on !== "inflict") ) passOn(by, given, spreadRolls, told);
      }
      const change = ((target.hp > 0) && !bendsOf(to)?.debuffs.negate) ? left(share) : null;
      if ( change ) granted.push({ by, to, unit: null, name: plan[to].unit.name ?? "", change });
      if ( share.push && (target.hp > 0) ) told.push = true;
      if ( (told.damage > 0) || told.inflicted || told.push || change ) units.push(told);
    }
    if ( !units.length ) return;
    spreads.push({
      skill,
      by,
      on: proc.on,
      ...((current !== null) ? { at: current } : {}),
      units,
      ...(out.choose ? { choose: out.choose, open: (out.open ?? []).map(settle) } : {}),
      ...(out.rolled ? { rolled: out.rolled } : {}),
      ...(spread.element ? { element: spread.element } : {}),
      ...(spread.nonlethal ? { nonlethal: true } : {}),
      ...(spread.push ? { push: { spaces: spread.push.spaces ?? 1, blocked: spread.push.blocked ?? 0 } } : {}),
      ...(spread.attack ? { attack: { free: !!spread.attack.free } } : {})
    });
  };

  // What a skill sets aside for its unit's next attack; `margin` is by how much the attack it dodged missed
  // What a skill marks `keep` waits for that attack in a later fight, where its unit makes no other in this one
  const aside = (proc, by, bonus) => {
    for ( const [stat, amount] of Object.entries(bonus) ) {
      if ( !amount ) continue;
      state[by].next[stat] = (state[by].next[stat] ?? 0) + amount;
      if ( proc.keep ) (state[by].kept[proc.skill] ??= {})[stat] = (state[by].kept[proc.skill][stat] ?? 0) + amount;
    }
  };
  const gain = (proc, by, margin = null) => {
    aside(proc, by, (proc.near && (margin !== null) && (margin <= proc.near.within)) ? proc.near.next : proc.next);
  };

  // What a unit pays for a skill of its own: damage that is no hit of an attack, which with `nonlethal`
  // leaves it 1 HP at the least. A unit that takes no damage from skills pays nothing
  const costs = [];
  const pay = (proc, by, rolls, at) => {
    if ( !(proc.pays > 0) || (state[by].hp <= 0) || unharmed(by) ) return;
    const amount = hurt(by, proc.pays, { nonlethal: proc.nonlethal, rolls });
    if ( amount > 0 ) costs.push({ skill: proc.skill, by, amount, at });
  };

  // Chances to activate as the fight begins change a side's numbers for all of it
  const boost = { initiator: { hit: 0, damage: 0, critical: 0, dodge: 0 }, defender: { hit: 0, damage: 0, critical: 0, dodge: 0 } };
  const opening = [];

  // What skills did to the foe of their unit as the fight began
  const begun = [];

  // An attack a skill has its unit make on another unit beside a fight may cost its weapon nothing
  if ( plan.extra?.free ) state.initiator.freeUses = true;

  // What skills change about the round as the fight begins (see `rounds.mjs`): the side that attacks first
  // though its foe began the fight, the sides that make their follow-up before their foe's counter-attack, and
  // the attacks a side joins in with where it would make none, or beside its own
  let leads = null;
  const pressing = [];
  const joining = { initiator: [], defender: [] };

  // Attack Speed a side gains as the fight begins, and what that makes of its follow-up and of its foe's,
  // where those go by Attack Speed alone: true for one it now makes, false for one it no longer does
  const quick = { initiator: 0, defender: 0 };
  const swift = { initiator: null, defender: null };
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
        cancel(proc, key);
        if ( proc.order === "first" ) leads = key;
        if ( (proc.order === "press") && !pressing.some((entry) => entry.key === key) ) pressing.push({ key, skill: proc.skill });
        if ( proc.cuts ) state[key].cuts = { ...proc.cuts, skill: proc.skill };
        if ( proc.attack ) joining[key].push({ skill: proc.skill, strike: proc.strike ?? null });

        // Stats for the whole fight: what they add to its combat stats, and to its Attack Speed for who
        // follows up. Critical Avoid is taken off the Critical of its foe
        if ( proc.statCombat ) {
          const more = proc.statCombat;
          for ( const stat of ["hit", "damage", "critical", "dodge"] ) boost[key][stat] = (boost[key][stat] ?? 0) + (more[stat] ?? 0);
          boost[other(key)].critical -= more.critAvoid ?? 0;
          quick[key] += more.attackSpeed ?? 0;
        }

        // Conditions it puts on its foe as the fight begins: one that holds a unit keeps it from attacking in
        // this fight
        for ( const entry of proc.inflicts ?? [] ) {
          if ( state[other(key)].hp <= 0 ) break;
          const given = afflict(other(key), entry.id, { turns: entry.turns, more: bendsOf(key)?.inflictTurns[entry.id] ?? 0 });
          if ( !given ) continue;
          let told = begun.find((found) => (found.skill === proc.skill) && (found.by === key));
          if ( !told ) begun.push(told = { skill: proc.skill, by: key, inflicted: [] });
          told.inflicted.push(given);
          if ( given.success !== false ) passOn(key, given, opening, told);
        }

        // HP the skill restores to its unit before the first attack
        const restored = Math.max(Math.min(proc.recover, (plan[key].unit.hpMax ?? Infinity) - state[key].hp), 0);
        state[key].hp += restored;
        state[key].healed += restored;

        // And what its unit pays for it as the fight begins
        pay(proc, key, opening, "start");
      }
    }
  }

  if ( quick.initiator || quick.defender ) {
    for ( const key of ["initiator", "defender"] ) {
      const side = plan[key];
      if ( !side.speedFollows || side.blocked || !side.unit.combat ) continue;
      const speed = (who) => (plan[who].unit.combat?.attackSpeed ?? 0) + quick[who];
      const now = followsUp(speed(key), speed(other(key)), FEO.doubleThreshold, side.hasteAll ?? 0);
      if ( now !== !!side.doubles ) swift[key] = now;
    }
  }

  // The side whose skill ended the fight before it was over, and what skills have go to the enemies around
  let ended = null;
  const splashes = [];

  // Every attack that is planned. A skill that activates can turn one into several, which join the queue.
  // `added` names the skill that added an attack, and `groups` the runs of attacks that share one weapon use.
  // `follow` marks a follow-up attack whose Critical is multiplied, and the attacks a skill turns it into
  // The attacks of a round, in the order skills left them in as the fight began (see `rounds.mjs`): a side may
  // attack first though its foe began the fight, make its follow-up before its foe's counter-attack (or one
  // more attack there, where it has no follow-up to make), and join in with an attack it would not make
  // otherwise. `full` marks an attack a skill added that is made as its unit's attacks are, with every chance
  // they roll; `round` is the round of the fight the attack belongs to
  const lineOf = (round) => {
    let entries = plan.order.map((key, index) => {
      return { key, kind: plan.kinds?.[index] ?? "open", share: plan.scale?.[index] ?? 1, follow: !!plan.followUps?.[index] };
    });

    // A follow-up a side lost or gained with the Attack Speed it or its foe was given as the fight began: one
    // that is gained comes where follow-ups do, that of the unit that began the fight first
    for ( const key of ["initiator", "defender"] ) {
      if ( swift[key] === false ) entries = entries.filter((entry) => !((entry.key === key) && (entry.kind === "follow")));
      if ( swift[key] !== true ) continue;
      const added = Array.from({ length: Math.max(plan[key].strikes ?? 1, 1) }, () => ({ key, kind: "follow", share: 1, follow: false }));
      let at = entries.findIndex((entry) => entry.kind === "extra");
      if ( at < 0 ) at = entries.length;
      const theirs = (key === "initiator") ? entries.findIndex((entry) => (entry.kind === "follow") && (entry.key === "defender")) : -1;
      entries.splice((theirs >= 0) ? theirs : at, 0, ...added);
    }
    const press = {};
    for ( const { key, skill } of pressing ) {
      press[key] = Array.from({ length: Math.max(plan[key].strikes ?? 1, 1) }, () => ({ key, kind: "press", share: 1, follow: false, added: skill }));
    }
    const joins = Object.fromEntries(["initiator", "defender"].map((key) => {
      return [key, joining[key].map(({ skill, strike }) => ({ key, kind: "join", share: 1, follow: false, added: skill, strike }))];
    }));
    return lineUp(entries, { first: leads, press, pressing: pressing.map((entry) => entry.key), joins }).map((entry) => {
      return {
        key: entry.key, kind: entry.kind, share: entry.share, part: null, added: entry.added ?? null, groups: [], follow: entry.follow, round,
        ...(entry.strike ? { strike: entry.strike } : {}),
        ...((entry.added && !entry.strike) ? { full: true } : {})
      };
    });
  };

  // A fight goes on for another round where something has it so (see `rounds.mjs`): a skill used as an action
  // that starts a fight of several rounds, or a skill of either unit that has the round fought again, by a
  // chance or by itself. Whoever acts for such a unit may end the fight instead, where the skill says so,
  // before any attack of the further round is made. Nothing has a fight go on once a unit has fallen, once
  // it was ended, or after a round in which nobody attacked
  let round = 1;
  let roundFrom = 0;
  let stopped = null;
  let halted = false;
  const further = [];
  const turning = [];
  const repeated = { initiator: {}, defender: {} };
  const standing = (key) => {
    const sum = (who) => (plan[who].blows ?? []).reduce((total, blow) => total + ((blow.hit > 0) ? blow.damage : 0), 0);
    return { next: round + 1, hp: state[key].hp, foeHp: state[other(key)].hp, deals: sum(key), takes: sum(other(key)) };
  };
  const another = () => {
    if ( round >= (FEO.rounds?.most ?? 50) ) return null;
    if ( plan.rounds && (round < plan.rounds.count) ) return { skill: plan.rounds.skill, by: "initiator" };
    for ( const key of ["initiator", "defender"] ) {
      const mine = state[key];
      for ( const proc of plan[key].chances?.[ROUND_MOMENT] ?? [] ) {
        if ( !proc.again || (mine.hp <= 0) ) continue;
        if ( proc.healthier && !(mine.hp > state[other(key)].hp) ) continue;
        if ( (repeated[key][proc.skill] ?? 0) >= proc.again.most ) continue;
        const fired = fire(proc, key, turning);
        if ( turning.length ) turning.at(-1).round = round;
        if ( !fired ) continue;
        if ( proc.again.stop ) {
          const offer = ask(ROUND_MOMENT, key, [{ key: proc.skill, skill: proc.skill, id: proc.uses?.id ?? null, what: "stop" }], { round: standing(key) });
          if ( offer ) {
            stopped = { side: key, skill: proc.skill, round };
            return null;
          }
        }
        repeated[key][proc.skill] = (repeated[key][proc.skill] ?? 0) + 1;
        return { skill: proc.skill, by: key };
      }
    }
    return null;
  };
  const queue = lineOf(round);
  const goesOn = () => {
    noted = loose;
    about = null;
    if ( ended || halted || stopped || (attacks.length === roundFrom) ) return false;
    if ( ["initiator", "defender"].some((key) => (state[key].hp <= 0) || state[key].away) ) return false;
    const more = another();
    if ( !more ) return false;
    round += 1;
    roundFrom = attacks.length;
    further.push({ round, ...more });
    queue.push(...lineOf(round));
    return true;
  };
  for ( let index = 0; (index < queue.length) || goesOn(); index++ ) {
    const entry = queue[index];
    const key = entry.key;
    const side = plan[key];
    const mine = state[key];
    const foe = state[other(key)];
    if ( (mine.hp <= 0) || ((foe.hp <= 0) && !plan[other(key)].unit.incapacitated) ) break;
    const target = other(key);
    noted = [];
    about = null;
    current = attacks.length;

    // What lasted only until this side's follow-up attack is over as that attack is made: the fight is planned
    // again without it, for this attack and those still to come
    if ( (entry.kind === "follow") && plan.lapses?.[key]?.includes("followUp") && !over[key].includes("followUp") ) {
      over[key] = [...over[key], "followUp"];
      renew();
    }

    // A weapon that broke makes no further attack, unless the attack belongs to a run its last use paid for.
    // Neither does a unit that a condition holds, or that has come to suffer from Break or to be Staggered
    // An attack with numbers of its own is not made with the weapon: it needs none, costs it nothing, and has
    // nothing of what the weapon or the weapon triangle brings
    // The numbers are those of the fight as it was planned last
    const own = ownOf(entry);
    const cur = renewed[key] ?? side;

    // A unit that a change granted in this fight keeps from fighting makes no further attack in it
    if ( cur.fresh?.unit.fx?.rules?.has("noCombat") && !side.unit.fx?.rules?.has("noCombat") ) continue;
    const from = own ?? cur;
    const paid = entry.groups.some((group) => group.spent);
    if ( (mine.broke && !paid && !own) || mine.held || mine.break || mine.staggered ) continue;

    // Neither does a unit that was made to put down its weapon
    if ( mine.disarmed ) continue;

    // An attack a skill of the foe cancelled is not made
    if ( mine.cancelled.length ) {
      cancelled.push({ side: key, skill: mine.cancelled.shift(), by: other(key) });
      continue;
    }
    const weapon = own ? null : side.unit.weapon;
    const procs = [];

    // A foe that has lost its counter-attack in the middle of the fight: what this side's skills give it
    // against a foe that is kept from one counts from here on
    if ( side.denial?.length && !mine.pressed && (foe.break || foe.held || foe.staggered || foe.broke || foe.disarmed) ) {
      mine.pressed = true;
      for ( const { skill, combat } of side.denial ) {
        for ( const [stat, amount] of Object.entries(combat) ) boost[key][stat] = (boost[key][stat] ?? 0) + amount;
        procs.push({ skill, on: "attack", by: key, roll: null, chance: 100, success: true, sure: true });
      }
    }

    // The attack is made: it is this side's nth of the fight, and one more that its foe has had made against it
    mine.made += 1;
    foe.faced += 1;
    const nth = mine.made;

    // This side's chances to activate on an attack. An attack a skill added rolls none of its own, unless it
    // is made as the unit's attacks are
    // What such a skill grants its own side comes at once; what it grants its foe waits for the attack to land
    const parts = entry.part ? [entry.part] : [];
    const fired = [];
    if ( (!entry.added || entry.full) && side.base ) {
      // The attacks a skill adds keep the share of the attack they came from, as it was planned
      const planned = entry.share;
      let next = index + 1;
      for ( const proc of side.chances?.attack ?? [] ) {
        // What only begins with a later attack of the fight, or once its unit has been hit in it, is read
        // below, for every attack
        if ( proc.from || proc.hurt ) continue;
        if ( !fire(proc, key, procs) ) continue;
        give(proc, key, { part: "own" });
        spreadNow(proc, key);
        fired.push(proc);
        cancel(proc, key);

        // One more attack with numbers of its own, made right after this one. It sets off no other
        if ( proc.attack && proc.strike?.able && !entry.answer ) {
          queue.splice(next, 0, { key, share: 1, part: null, added: proc.skill, groups: [], answer: true, strike: proc.strike, round: entry.round });
          next += 1;
        }
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
          return { key, share: (part.share ?? 1) * planned, part, added: proc.skill, groups: group ? [group] : [], follow: entry.follow, round: entry.round };
        }));
        next += rest.length;
      }
    }

    // What its skills are sure to do from a later attack of the fight on, for whatever attack this is: one
    // of a round, one a skill added, one made in answer. What mounts counts once more for each attack since
    for ( const proc of side.base ? partsFrom(side.chances?.attack, nth) : [] ) {
      parts.push(proc);
      procs.push({ skill: proc.skill, on: proc.on, by: key, roll: null, chance: 100, success: true, sure: true });
      mine.fired.add(proc.skill);
    }

    // And what they are sure to do for every attack once an attack has landed on their unit in this fight
    for ( const proc of (side.base && mine.struck) ? (side.chances?.attack ?? []) : [] ) {
      if ( !proc.hurt || !proc.sure || proc.sequence || (proc.uses && (proc.uses.left === 0)) ) continue;
      parts.push(proc);
      procs.push({ skill: proc.skill, on: proc.on, by: key, roll: null, chance: 100, success: true, sure: true });
      mine.fired.add(proc.skill);
    }

    // The plan's numbers hold until something changes them: a skill that activated, or a strike that changed
    // somebody's conditions. After that the numbers are worked out again for this attack
    let numbers = own ? null : cur;
    let sure = false;

    // What resists it in the end, which a skill that took effect for it may have changed
    let resisting = own ? (entry.strike?.against ?? "def") : (cur.defence ?? "def");

    // What earlier moments of the fight set aside for this side's next attack is spent on this one
    const pending = mine.next;
    mine.next = { hit: 0, damage: 0, critical: 0 };
    mine.kept = {};

    // What a Combat Art changes about this side's first attack alone: the plan's numbers are those of that
    // attack, and every later one is worked out without it
    const opens = !mine.swung && !own;
    const opener = opens ? side.opener : null;
    if ( !own ) mine.swung = true;

    // Follow-up Critical Multiplier: what this side's Critical is multiplied by for a follow-up attack, before
    // the foe's Critical Avoid is taken off. It changes the chance of a critical hit, not what one deals
    const fcm = entry.follow ? (cur.fcm ?? 1) : 1;
    const changed = parts.length || Object.values(boost[key]).some(Boolean) || boost[other(key)].dodge
      || Object.values(pending).some(Boolean) || !!side.opener || !!side.folded || !!side.foreseen || (fcm !== 1);
    // `dodgeMore` is Dodge the target gains against this attack alone, as it answers it, and `avoidMore`
    // Critical Avoid
    const figure = (dodgeMore = 0, avoidMore = 0) => {
      if ( !from.base ) {
        if ( dodgeMore || avoidMore ) {
          numbers = { ...numbers, hit: clamp(numbers.hit - dodgeMore, 0, 100), crit: clamp((numbers.crit ?? 0) - avoidMore, 0, 100) };
        }
        return;
      }
      if ( !(shifted || changed || own || dodgeMore || avoidMore) ) return;
      const base = { ...from.base };
      for ( const [name, amount] of Object.entries(opener ?? {}) ) base[name] += amount;
      base.accuracy += boost[key].hit + (pending.hit ?? 0);
      base.critical += boost[key].critical + (pending.critical ?? 0);
      base.damage += boost[key].damage + (pending.damage ?? 0);
      base.dodge += boost[other(key)].dodge + dodgeMore;
      base.critAvoid += avoidMore;

      // A target that a skill has left no Dodge in this fight
      if ( foe.dodgeless ) base.dodge = 0;
      const made = applyParts(base, parts, from, foe.hp);
      // What a change granted in this fight has its target take more or less of is in the plan where the fight
      // was planned again with it, and counted here where it could not be
      const scale = (from.strike.damageScale ?? 1) * foe.takenNow * (given ? 1 : foe.takenGrant) * made.times;
      sure = made.sure;
      if ( !own ) resisting = made.kind;
      numbers = numbersFor(base, { ...from.strike, damageScale: scale, attacker: mine.conditions, target: foe.conditions, fcm, autoCrit: !!from.strike.autoCrit || made.crit });
      if ( (sure === true) || ((sure === "ifAny") && (numbers.hit >= 1)) ) numbers.hit = 100;
    };

    // An attack that is made at a share of its final accuracy, as each attack of a chain is: the share is
    // taken of the Hit it comes to once everything else is counted, each time that is worked out
    let unshared = null;
    const work = (dodgeMore = 0, avoidMore = 0) => {
      if ( unshared ) numbers = unshared;
      figure(dodgeMore, avoidMore);
      if ( (entry.hitTimes === undefined) || !numbers ) return;
      unshared = numbers;
      numbers = { ...numbers, hit: clamp(Math.floor((numbers.hit * entry.hitTimes) + 1e-9), 0, 100) };
    };
    work();
    might = from.power ?? 0;
    const critTimes = side.unit.fx?.critMultiplier ?? FEO.critMultiplier;
    const blow = (critical) => Math.floor((numbers.damage * (critical ? critTimes : 1) * entry.share) + 1e-9);

    // The attack is about to be made: what the skills of its target make of that. It may gain Dodge against
    // this attack alone, negate it, so that it is made and does nothing, or end the fight here. What takes
    // effect by itself comes first, then what its owner may answer with
    let dodgeMore = 0;
    let avoidMore = 0;
    let negated = null;
    let fled = null;

    // Conditions the target's skills give the attacker for attacking it, once the attack is made
    const glared = [];
    if ( foe.hp > 0 ) {
      about = { side: key, hitChance: numbers.hit, hitRoll: null, crit: false, critChance: numbers.crit, critRoll: null, damage: blow(false), margin: null, hp: foe.hp };
      // `times` is how many times over it counts, for what counts once for every share of its unit's HP
      const meet = (proc, times = 1) => {
        if ( proc.end ) {
          fled = proc;
          return false;
        }
        if ( proc.cancel ) {
          negated = proc.skill;
          return false;
        }
        if ( proc.combat?.dodge || proc.combat?.critAvoid ) {
          dodgeMore += (proc.combat.dodge ?? 0) * times;
          avoidMore += (proc.combat.critAvoid ?? 0) * times;
          work(dodgeMore, avoidMore);
          about = { ...about, hitChance: numbers.hit, critChance: numbers.crit, damage: blow(false) };
        }
        glared.push(...(proc.inflictsAttacker ?? []));
        remind(proc, target);
        return true;
      };
      const facing = plan[target].chances?.attacked ?? [];

      // What waits for an attack that would take a share of its unit's maximum HP off it counts once for
      // every such share, by the damage the attack deals if it lands without a critical hit
      const heavy = blow(false);
      const most = plan[target].unit.hpMax ?? plan[target].unit.hp ?? 0;
      for ( const proc of facing.filter((chance) => !chance.may) ) {
        const times = !proc.threat ? 1 : (most > 0) ? Math.floor(((heavy * 100) / (most * proc.threat)) + 1e-9) : 0;
        if ( !(times > 0) ) continue;
        if ( fire(proc, target, procs) && (meet(proc, times) === false) ) break;
      }
      if ( !negated && !fled ) answer("attacked", target, facing, procs, (offer) => meet(offer.proc));
    }
    if ( fled ) {
      ended = { side: target, skill: fled.skill, forgoExp: fled.forgoExp };
      loose.push(...noted);
      break;
    }
    if ( negated ) {
      // An attack that is negated was made: a weapon that wears with every attack loses its use
      const lost = !paid && !mine.freeUses && !own && !(side.unit.fx?.rules?.has("oneUsePerFight") && mine.used) && spendsUse(weapon, false, plan.distance);
      if ( lost ) {
        mine.uses -= 1;
        mine.usesSpent += 1;
        mine.used = true;
        mine.broke = mine.uses <= 0;
        for ( const group of entry.groups ) group.spent = true;
      }
      const attack = {
        side: key, hitRoll: null, hitChance: numbers.hit, hit: false, critRoll: null, critChance: numbers.crit, crit: false, damage: 0,
        hpBefore: foe.hp, hpAfter: foe.hp, kill: false, useSpent: lost, broke: lost && mine.broke, wexp: 0, conditions: null,
        negated: { skill: negated, by: target }
      };
      if ( procs.length ) attack.procs = procs;
      if ( noted.length ) attack.answers = noted;
      if ( entry.added ) {
        attack.added = true;
        attack.skill = entry.added;
      }
      if ( round > 1 ) attack.round = round;
      attacks.push(attack);
      continue;
    }

    // A target that dodges every hit that would be fatal to it: the Hit of an attack whose plain hit would be
    // is held to a cap, and the attack misses whatever is rolled; one that only a critical hit makes fatal
    // misses once that is rolled
    const dodges = !!plan[other(key)].unit.fx?.rules?.has("dodgeFatal") && (foe.hp > 0);
    const fatal = dodges && (blow(false) >= foe.hp);
    const hitChance = fatal ? Math.min(numbers.hit, FEO.fatalDodge.hitCap) : numbers.hit;

    // A unit that rolls its Hit rolls twice takes the worse of the two
    const twice = !!side.worst || mine.worst;
    const throwHit = () => {
      const first = d100();
      if ( !twice ) return { roll: first, pair: null };
      const second = d100();
      return { roll: Math.max(first, second), pair: [first, second] };
    };
    let thrown = throwHit();
    let hitRoll = thrown.roll;
    let hit = hitRoll <= hitChance;

    // A roll that failed may be made again, where a skill of its unit lets it: by its owner's say, or by itself
    const rerolls = [];
    const again = (proc) => {
      rerolls.push({ skill: proc.skill, roll: "hit", first: hitRoll });
      thrown = throwHit();
      hitRoll = thrown.roll;
      hit = hitRoll <= hitChance;
      about = { ...(about ?? {}), hitRoll, margin: hitRoll - hitChance };
      return !hit;
    };
    if ( !hit ) {
      about = { ...(about ?? { side: key, hp: foe.hp }), hitChance, hitRoll, damage: blow(false), margin: hitRoll - hitChance };
      const near = () => (side.chances?.miss ?? []).filter((proc) => !hit && proc.reroll && ((proc.within === null) || ((hitRoll - hitChance) <= proc.within)));
      for ( const proc of near().filter((chance) => !chance.may) ) {
        if ( hit ) break;
        if ( fire(proc, key, procs) ) again(proc);
      }
      answer("miss", key, near, procs, (offer) => again(offer.proc));
    }

    // A skill may have the attack that costs the weapon its first use, or its last, be a critical hit, unless
    // something keeps this side from critical hits altogether. Such an attack rolls nothing for it
    const paying = !paid && !mine.freeUses && !(side.unit.fx?.rules?.has("oneUsePerFight") && mine.used);
    let usedFor = null;
    if ( hit && !fatal && !own && side.critUse && !side.strike?.noCrit && paying && spendsUse(weapon, true, plan.distance) ) {
      const open = (entry) => {
        if ( !entry.uses || (entry.uses.left === null) ) return true;
        return mine.counted.filter((counted) => (counted.id ?? counted.name) === (entry.uses.id ?? entry.uses.name)).length < entry.uses.left;
      };
      usedFor = [...((mine.uses >= weapon.uses.max) ? side.critUse.first : []), ...((mine.uses === 1) ? side.critUse.last : [])].find(open) ?? null;
      if ( usedFor ) {
        procs.push({ skill: usedFor.skill, on: "use", by: key, roll: null, chance: 100, success: true, sure: true });
        if ( usedFor.uses ) mine.counted.push({ id: usedFor.uses.id ?? undefined, name: usedFor.uses.name });
      }
    }
    const critChance = usedFor ? 100 : ((numbers === side) && (side.critPlain !== undefined)) ? side.critPlain : numbers.crit;

    let critRoll = (hit && !fatal && !usedFor && (critChance > 0)) ? d100() : null;
    let crit = !!usedFor || ((critRoll !== null) && (critRoll <= critChance));

    // A hit that failed its critical roll: the roll may be made again, or its unit may make something else of
    // it, which comes once the hit is dealt
    const later = [];
    if ( hit && (critRoll !== null) && !crit ) {
      about = { ...(about ?? { side: key, hp: foe.hp }), hitChance, hitRoll, critChance, critRoll, damage: blow(false), margin: critRoll - critChance };
      const near = () => (side.chances?.critMiss ?? []).filter((proc) => !crit && ((proc.within === null) || ((critRoll - critChance) <= proc.within)));
      const second = (proc) => {
        if ( !proc.reroll ) {
          later.push(proc);
          return true;
        }
        rerolls.push({ skill: proc.skill, roll: "crit", first: critRoll });
        critRoll = d100();
        crit = critRoll <= critChance;
        about = { ...about, critRoll, margin: critRoll - critChance };
        return !crit;
      };
      for ( const proc of near().filter((chance) => !chance.may) ) {
        if ( crit ) break;
        if ( fire(proc, key, procs) ) second(proc);
      }
      answer("critMiss", key, near, procs, (offer) => second(offer.proc));
    }

    // A critical hit may be brought to nothing by a skill of its target: the hit lands without the damage of one
    const critFoiled = (hit && crit && (foe.hp > 0)) ? foil("crit", key, procs) : null;
    if ( critFoiled ) crit = false;
    const evaded = hit && dodges && (blow(crit) >= foe.hp);
    if ( evaded ) {
      hit = false;
      crit = false;
    }

    // A hit that would land: a skill of its target may have it dodge the attack instead
    let dodgedBy = null;
    if ( hit && (foe.hp > 0) ) {
      about = { ...(about ?? { side: key }), hitChance, hitRoll, crit, critChance, critRoll, damage: blow(crit), margin: null, hp: foe.hp };
      const slip = (proc) => {
        dodgedBy = proc.skill;
        return false;
      };
      const slipping = (plan[target].chances?.landing ?? []).filter((proc) => proc.dodge);
      for ( const proc of slipping.filter((chance) => !chance.may) ) {
        if ( fire(proc, target, procs) && (slip(proc) === false) ) break;
      }
      if ( !dodgedBy ) answer("landing", target, slipping, procs, (offer) => slip(offer.proc));
      if ( dodgedBy ) {
        hit = false;
        crit = false;
      }
    }

    // A critical hit its unit may deal without the damage of one, for what its skill makes of it instead:
    // only where that comes to something
    let plain = null;
    if ( hit && crit ) {
      about = { ...about, crit: true, damage: blow(true) };
      const forgoing = (side.chances?.crit ?? []).filter((proc) => proc.may && proc.plain && (!proc.splash || splashUnits(key, proc.splash).length));
      answer("crit", key, forgoing, procs, (offer) => {
        plain = offer.proc;
        return false;
      });
    }
    const heavy = crit && !plain;
    let damage = hit ? blow(heavy) : 0;
    const hpBefore = foe.hp;

    // A share of the target's maximum HP, by a die, in place of the damage, unless the damage is more. A unit
    // whose HP nothing cuts takes the damage, and nothing is rolled
    let instead = null;
    for ( const part of (hit && (hpBefore > 0) && !deathless(target)) ? parts.filter((entry) => entry.instead) : [] ) {
      const rolled = die(part.instead.dice);
      const amount = Math.floor((((plan[target].unit.hpMax ?? plan[target].unit.hp) * rolled) / part.instead.dice) + 1e-9);
      instead = { skill: part.skill, roll: rolled, dice: part.instead.dice, amount, took: amount > damage };
      if ( instead.took ) damage = amount;
    }

    // An attack that kills if it lands, unless nothing kills its target outright
    const slaying = (hit && (hpBefore > 0) && !deathless(target)) ? (parts.find((entry) => entry.slay) ?? null) : null;
    let slain = null;

    // An attack that lands may backfire: its unit takes the damage it would have dealt, whatever its own
    // defence, and unless a skill says otherwise the target takes none and is not hit at all
    let backfire = null;
    if ( hit && side.backfire && !own ) {
      const rolled = d100();
      backfire = { roll: rolled, chance: side.backfire.chance, success: rolled <= side.backfire.chance, damage: 0, both: false };
      if ( backfire.success ) {
        backfire.damage = side.backfire.halved ? Math.floor(damage / 2) : damage;
        backfire.both = side.backfire.both;
        if ( !backfire.both ) damage = 0;
      }
    }
    const lands = hit && (!backfire?.success || backfire.both);
    const landing = [];
    const harms = [];

    // This side's moments that wait for its hit to have dealt no damage
    const empty = [];
    let recovered = 0;

    // A hit that lands may be blocked: by the Shield its target has equipped, by a weapon that acts as one, or
    // by the weapon it guards with, while that has a use left and the attack does not go past it. A Shield
    // that can parry rolls for that first; else the Block chance is rolled. A block takes its amount off the
    // damage and costs what blocked a use. Both units' skills that wait for a block then have their moment:
    // the attacker's may negate it
    let block = null;
    const guard = (own ? own.block : cur.block) ?? null;
    const past = parts.some((part) => part.noBlock === "all") ? "all" : parts.some((part) => part.noBlock === "shield") ? "shield" : null;
    const guardLeft = !guard ? 0 : (guard.wears === "shield") ? foe.shieldUses : foe.uses;
    const guards = !!guard && lands && (hpBefore > 0) && ((guard.uses.max > 0) ? (guardLeft > 0) : true)
      && !((guard.wears === "weapon") && foe.broke) && !foe.disarmed && !((past === "all") || ((past === "shield") && (guard.kind === "shield")));
    if ( guards ) {
      const blocker = other(key);
      block = { by: guard.kind, name: guard.name, roll: null, chance: guard.chance, success: false };
      let cost = guard.cost;
      let parried = false;
      if ( guard.parry ) {
        const rolled = d100();
        block.parry = { roll: rolled, chance: guard.parry.chance, success: rolled <= guard.parry.chance };
        parried = block.parry.success;
      }
      if ( parried ) {
        block.success = true;
        cost = guard.parry.uses;
      }
      else {
        block.roll = d100();
        block.success = block.roll <= guard.chance;
      }

      // The attacker's skills that wait for its attack to be blocked: one that negates the block comes first,
      // and a block that is negated is none for anything else
      const waiting = (list) => (list ?? []).filter((proc) => !proc.by || (proc.by === guard.kind));
      const answering = waiting(side.chances?.blocked);
      for ( const proc of block.success ? answering.filter((chance) => chance.unblock) : [] ) {
        if ( !fire(proc, key, procs) ) continue;
        block.success = false;
        block.negated = proc.skill;
        wearDown(blocker, proc.wears, { skill: proc.skill });
        remind(proc, key);
        break;
      }

      // So may a skill of its that brings to nothing what its foe does
      if ( block.success ) {
        const foiled = foil("block", blocker, procs);
        if ( foiled ) {
          block.success = false;
          block.negated = foiled;
        }
      }

      // A block that was rolled for and did not come: the skills of the unit that failed to block
      if ( !block.success && !block.negated ) {
        for ( const proc of waiting(plan[blocker].chances?.blockFail) ) {
          if ( !fire(proc, blocker, procs) ) continue;
          harm(proc, blocker, harms, procs);
          gain(proc, blocker);
          wearDown(key, proc.wears, { skill: proc.skill });
          remind(proc, blocker);
        }
      }
      if ( block.success ) {
        let times = 1;
        let less = 0;
        for ( const proc of waiting(plan[blocker].chances?.block) ) {
          // An attack with numbers of its own that cannot be made here has no moment: its skill stays quiet
          if ( proc.strike && (!proc.strike.able || entry.answer) ) continue;
          if ( !fire(proc, blocker, procs) ) continue;
          times *= proc.blockTimes;
          harm(proc, blocker, harms, procs);
          gain(proc, blocker);
          wearDown(key, proc.wears, { skill: proc.skill });
          remind(proc, blocker);

          // One more attack at once, if the unit can attack; one with numbers of its own, if it can make that.
          // An attack added for a block sets off no other
          if ( proc.attack && !entry.answer && (proc.strike ? proc.strike.able : !plan[blocker].blocked) ) {
            queue.splice(index + 1, 0, { key: blocker, share: 1, part: null, added: proc.skill, groups: [], answer: true, strike: proc.strike });
          }

          // The attacker's next attacks in this fight that the block cancels
          for ( let n = 0; n < proc.cancels; n++ ) mine.cancelled.push(proc.skill);
        }
        for ( const proc of answering.filter((chance) => !chance.unblock) ) {
          if ( !fire(proc, key, procs) ) continue;
          less += proc.blockLess;
          harm(proc, key, harms, procs);
          gain(proc, key);
          wearDown(blocker, proc.wears, { skill: proc.skill });
          remind(proc, key);
        }

        // What the block takes off. A hit that is blocked is dealt as if the target went without the DEF or
        // RES a skill gives it only while it does not block; and a skill may have the first use of a Shield,
        // or its last, take everything
        let after = 0;
        if ( !parried ) {
          const worn = guard.uses.max > 0;
          const open = (taking) => {
            if ( !taking.uses || (taking.uses.left === null) ) return true;
            return foe.counted.filter((counted) => (counted.id ?? counted.name) === (taking.uses.id ?? taking.uses.name)).length < taking.uses.left;
          };
          const all = worn
            ? [...((guardLeft >= guard.uses.max) ? guard.first : []), ...((guardLeft <= cost) ? guard.last : [])].find(open) ?? null
            : null;
          if ( all ) {
            block.all = all.skill;
            procs.push({ skill: all.skill, on: "use", by: blocker, roll: null, chance: 100, success: true, sure: true });
            if ( all.uses ) foe.counted.push({ id: all.uses.id ?? undefined, name: all.uses.name });
          }
          else {
            const bared = damage + Math.floor((guard.lost * (heavy ? critTimes : 1) * entry.share) + 1e-9);
            after = lessen(bared, guard.rule, { times, less });
          }
        }
        block.amount = Math.max(damage - after, 0);
        damage = after;

        // The use it costs
        if ( guard.uses.max > 0 ) {
          const lost = Math.min(cost, Math.max(guardLeft, 0));
          if ( guard.wears === "shield" ) {
            foe.shieldUses -= lost;
            foe.shieldSpent += lost;
            foe.shieldBroke = foe.shieldUses <= 0;
            block.broke = foe.shieldBroke;
          }
          else {
            foe.uses -= lost;
            foe.usesSpent += lost;
            foe.broke = foe.uses <= 0;
            block.broke = foe.broke;
          }
          block.uses = lost;
        }
      }
    }

    // What the attack sets off once it is known to land, to be critical, or to miss: for its own side, and
    // after a miss for the unit that dodged it
    // An attack may count as a critical hit for what waits for one, without the damage of one: by a skill
    // that took effect for the attack, or by one that does as it lands
    let asCrit = parts.some((part) => part.asCrit);
    if ( lands ) {
      mine.landed = true;
      mine.hits += 1;
      const waiting = [...(side.chances?.hit ?? []), ...(side.chances?.crit ?? [])];
      for ( const proc of waiting ) {
        if ( (proc.on === "crit") && !(crit || asCrit) ) continue;
        if ( proc.damaged && !(damage >= Number(proc.damaged)) ) continue;

        // What waits for a hit that deals no damage is read once the hit is dealt
        if ( proc.harmless ) {
          empty.push(proc);
          continue;
        }

        // A chain of attacks is begun by an attack of the round and carried on by the attacks it added: by
        // none another skill added, by none made with numbers of its own, and where it says so, only by a
        // unit that makes no follow-up attack in this fight
        if ( proc.chain ) {
          const link = entry.chain ?? null;
          if ( link ? (link.skill !== proc.skill) : !!entry.added ) continue;
          if ( own || (link && !(link.left > 0)) ) continue;
          if ( proc.chain.lone && ((swift[key] !== null) ? swift[key] : !!plan[key].doubles) ) continue;
        }

        // What its unit made of a critical hit in place of its damage was answered as the hit was rolled
        if ( proc.may && proc.plain ) {
          if ( proc !== plain ) continue;
        }
        else if ( !fire(proc, key, procs) ) continue;
        if ( proc.asCrit ) asCrit = true;

        // The next attack of the chain, made at once at its share of the Hit it comes to. It sets off no
        // attack in answer, and is not made if this hit brings the foe down
        if ( proc.chain ) {
          queue.splice(index + 1, 0, {
            key, share: 1, part: null, added: proc.skill, groups: [], answer: true, round: entry.round,
            hitTimes: proc.chain.hit, chain: { skill: proc.skill, left: (entry.chain?.left ?? proc.chain.most) - 1 }
          });
        }

        // A share of the hit that goes to other enemies around the two, once the fight is over
        if ( proc.splash ) {
          const units = splashUnits(key, proc.splash);
          const amount = splashAmount(proc.splash);
          if ( units.length && (amount > 0) ) splashes.push({ skill: proc.skill, by: key, amount, count: proc.splash.count, units: units.map(({ id, name }) => ({ id, name })) });
        }
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
        const points = (crit || asCrit) ? Math.floor(((blow(false) * proc.gaugeOfDamage) / 100) + 1e-9) : 0;
        if ( points > 0 ) charged.push({ skill: proc.skill, by: key, amount: points });
        wearDown(other(key), proc.wears, { skill: proc.skill });
      }
      for ( const proc of fired ) wearDown(other(key), proc.wears, { skill: proc.skill });
    }
    else if ( !hit ) {
      for ( const proc of side.chances?.miss ?? [] ) {
        // A roll that is made again was, before the attack was known to miss
        if ( proc.reroll ) continue;
        if ( proc.damaged && !(numbers.damage >= Number(proc.damaged)) ) continue;
        if ( !fire(proc, key, procs) ) continue;
        harm(proc, key, harms, procs);
        remind(proc, key);
      }
      for ( const proc of (hpBefore > 0) ? (plan[other(key)].chances?.dodged ?? []) : [] ) {
        if ( proc.strike && (!proc.strike.able || entry.answer) ) continue;
        if ( !fire(proc, other(key), procs) ) continue;
        harm(proc, other(key), harms, procs);
        gain(proc, other(key), dodgedBy ? null : hitRoll - hitChance);
        remind(proc, other(key));

        // One more attack at once, if the unit can attack. An attack added for a dodge sets off no other
        if ( proc.attack && !entry.answer && (proc.strike ? proc.strike.able : !plan[other(key)].blocked) ) {
          queue.splice(index + 1, 0, { key: other(key), share: 1, part: null, added: proc.skill, groups: [], answer: true, strike: proc.strike });
        }
      }
    }

    // An attack that was made and is no critical hit, whether it missed or landed: what this side's skills
    // make of that. One that counts as a critical hit for what waits for one is none of these
    if ( !(lands && (crit || asCrit)) ) {
      for ( const proc of side.chances?.[NO_CRIT_MOMENT] ?? [] ) {
        if ( fire(proc, key, procs) ) remind(proc, key);
      }
    }

    // The target's chances to activate when it is hit. A skill that saves its unit from a fatal blow is read
    // last, once the others have lessened the hit, and only if the hit is still fatal
    let reflected = 0;
    let lent = 0;
    let halved = false;
    const returns = [];
    const answers = [];
    const taking = [];

    // What each skill of the target took off the hit
    const tookOff = new Map();

    // The hit as it stands before the target's skills lessen it, to tell whether they did
    const whole = damage;
    if ( lands && (hpBefore > 0) ) {
      // What has its unit attack at once is read once the hit is dealt, and what takes effect for every so
      // many attacks made against its unit only for an attack that counts, from the start of that unit's turn
      const before = (plan[target].unit.attacked ?? 0) + foe.faced - 1;
      const struck = (plan[other(key)].chances?.struck ?? []).filter((chance) => !chance.attack && (!chance.every || countsEvery(before, chance.every)));

      // A share less damage from every attack after the first that is made against it, where a skill has it
      // so for this fight; and from the one attack of a foe that makes no other, a smaller share
      if ( foe.cuts ) {
        const share = (foe.faced > 1) ? foe.cuts.later : ((side.attacks <= 1) && !plan.rounds) ? foe.cuts.lone : 0;
        if ( share > 0 ) {
          damage = Math.floor(((damage * (100 - share)) / 100) + 1e-9);
          procs.push({ skill: foe.cuts.skill, on: "struck", by: target, roll: null, chance: 100, success: true, sure: true });
        }
      }

      // Of the skills that save from a fatal blow, one that costs a use is read after those that cost none
      const saving = struck.filter((chance) => chance.survive);
      const savers = [...saving.filter((chance) => !chance.uses), ...saving.filter((chance) => chance.uses)];

      // Between the two, a hit that would be fatal is halved for a unit whose skills, or a change that lasts
      // on it, say so; it may be fatal still
      const halving = plan[other(key)].unit.fx?.rules?.has("halveFatal") ? [HALVE] : [];

      // What a skill of the target makes of the hit: what the attacker takes in return, what it negates or
      // takes off, a defence it lends. `reduce` is what it takes off, where that is not the skill's own number
      const lessenBy = (proc, reduce = proc.reduce) => {
        const stood = damage;

        // What the attacker takes in return goes by the hit as it stands before this skill lessens it
        const back = Math.floor(((damage * proc.reflect) / 100) + 1e-9) + proc.retaliate;
        if ( back > 0 ) returns.push({ amount: back, nonlethal: proc.nonlethal });
        if ( proc.negate ) damage = Math.floor(((damage * (100 - proc.negate)) / 100) + 1e-9);
        if ( reduce ) {
          // What it takes off beyond the damage there was: dealt to the attacker, or added to the unit's
          // numbers for the rest of the fight
          const over = Math.max(reduce - damage, 0);
          damage = Math.max(damage - reduce, 0);
          if ( (over > 0) && proc.excess?.retaliate ) returns.push({ amount: over, nonlethal: proc.nonlethal });
          for ( const stat of (over > 0) ? (proc.excess?.combat ?? []) : [] ) {
            boost[other(key)][stat] = (boost[other(key)][stat] ?? 0) + over;
            shifted = true;
          }
        }

        // A defence lent for this hit, where it is more than the unit's own: the hit is lessened by the
        // difference, counted once however many lend theirs, and as often as the hit counts its damage
        if ( proc.shield ) {
          const kind = own ? "def" : (cur.defence ?? "def");
          const more = Math.max((proc.shield[kind] ?? 0) - (plan[other(key)].unit.stats?.[kind] ?? 0), 0);
          const extra = Math.max(more - lent, 0);
          lent = Math.max(lent, more);
          damage = Math.max(damage - Math.floor((extra * (heavy ? critTimes : 1) * entry.share) + 1e-9), 0);
        }
        // A defence raised for this hit, where it is the one that resists it: as often as the hit counts
        // its damage
        const raised = proc.defend?.[resisting] ?? 0;
        if ( raised > 0 ) damage = Math.max(damage - Math.floor((raised * (heavy ? critTimes : 1) * entry.share) + 1e-9), 0);
        answers.push(...proc.inflictsAttacker);
        gain(proc, other(key));

        // What it grants that is read from the hit waits until the hit is dealt
        remind(proc, other(key), { reading: "skip" });
        taking.push(proc);
        tookOff.set(proc, Math.max(stood - damage, 0));
      };

      // What takes effect by itself comes first; then what the target's owner may answer the hit with, which
      // is offered with the hit as it then stands; then what saves from a blow that is still fatal
      const plainly = struck.filter((chance) => !chance.survive);
      const lessens = (chance) => !!(chance.reduce || chance.reduceItem || chance.negate);
      for ( const proc of [...plainly.filter((chance) => !chance.may), ASK, ...(slaying ? [SLAY] : []), ...halving, ...savers] ) {
        // An attack that kills deals the HP its target has, whatever was taken off the hit; what halves a
        // fatal blow, or saves from one, may still
        if ( proc === SLAY ) {
          if ( damage < foe.hp ) damage = foe.hp;
          slain = slaying.skill;
          continue;
        }
        if ( proc === ASK ) {
          about = { ...(about ?? { side: key }), hitChance, hitRoll, crit, damage, margin: null, hp: foe.hp };
          answer("struck", target, () => plainly.filter((chance) => chance.may && (!chance.damaged || (damage >= Number(chance.damaged))) && (!lessens(chance) || (damage > 0))), procs, (offer) => {
            lessenBy(offer.proc, offer.amount ?? offer.proc.reduce);
            about = { ...about, damage };
            return true;
          });
          continue;
        }
        if ( proc === HALVE ) {
          if ( damage >= foe.hp ) {
            damage = Math.floor(damage / 2);
            halved = true;
          }
          continue;
        }
        if ( proc.survive ) {
          if ( damage < foe.hp ) continue;

          // Halving a blow does nothing for a unit at 1 HP; being left at 1 HP hangs on the HP it had
          const target = plan[other(key)].unit;
          if ( (proc.survive === true) ? (foe.hp <= 1) : !hpHolds(proc.survive.hp, foe.hp, target.hpMax ?? target.hp) ) continue;
        }
        if ( proc.damaged && !(damage >= Number(proc.damaged)) ) continue;

        // A chance that is higher for a hit that was blocked with a Shield
        if ( !fire(proc, other(key), procs, (block?.success && (block.by === "shield")) ? proc.blockedChance : 0) ) continue;
        if ( proc.survive ) {
          if ( proc.survive === true ) damage = Math.floor(damage / 2);
          if ( damage >= foe.hp ) damage = foe.hp - 1;
          remind(proc, other(key));
          continue;
        }

        lessenBy(proc);
      }
      foe.struck = true;
    }

    // A target whose skill holds what a hit takes off it to a share of its maximum HP
    const capped = lands && (cur.cap !== null) && (cur.cap !== undefined) && (damage > cur.cap);
    if ( capped ) damage = cur.cap;

    // A Combat Art that spares its foe leaves it with 1 HP where the blow would have been fatal
    if ( lands && side.art?.spare && (side.art.persist || opens) && (foe.hp > 0) && (damage >= foe.hp) ) damage = foe.hp - 1;

    // An ally that stands by takes the hit in the target's place, worked out with its own defence, or turns
    // it back on the attacker (see `stances.mjs`): an answer of that ally's, at the point where a hit that
    // deals damage would land. The target then takes nothing of it
    let warded = null;
    if ( lands && (foe.hp > 0) && (damage > 0) && standby?.[target]?.some((ally) => ally.at === BLOW) ) {
      const offers = wardOffers(standby[target], {
        damage, hp: foe.hp, against: resisting, defence: plan[other(key)].unit.stats?.[resisting] ?? 0,
        times: (heavy ? critTimes : 1) * entry.share
      }, wardedBy);
      about = { ...(about ?? { side: key }), hitChance, hitRoll, crit, damage, margin: null, hp: foe.hp };
      const offer = offers.length ? ask(BLOW, target, offers) : null;
      if ( offer ) {
        wardedBy.add(offer.key);
        warded = { key: offer.key, skill: offer.skill, by: offer.by, what: offer.what, amount: offer.amount, side: target, negated: damage };
        if ( (offer.what === "rebuke") && (offer.amount > 0) ) returns.push({ amount: offer.amount, nonlethal: false });
        warding.push(warded);
        damage = 0;
      }
    }

    // An ally comes for the target as the blow falls, as Guardian has it: the target is left with 1 HP and
    // carried off, and the fight ends with this attack
    // Where allies stand by, the blow is theirs to answer as it falls: the first that comes carries it off
    const rescuers = (standby?.[target] ?? []).filter((ally) => ally.at !== BLOW);
    if ( lands && !come[target] && rescuers.length && (foe.hp > 0) && (damage >= foe.hp) ) {
      about = { ...(about ?? { side: key }), hitChance, hitRoll, crit, damage, margin: null, hp: foe.hp };
      const offer = ask(FALL, target, rescuers.map((ally) => ({ key: ally.key, skill: ally.skill, what: "save", by: ally.by })));
      if ( offer ) come[target] = { skill: offer.skill, by: offer.by };
    }
    const carriedOff = lands && !!come[target] && (foe.hp > 0) && (damage >= foe.hp);
    if ( carriedOff ) {
      damage = foe.hp - 1;
      foe.away = true;
    }

    // Damage past 0 HP is kept for a unit that can be Incapacitated; otherwise HP stops at 0
    foe.hp = lose(plan[other(key)].unit, foe.hp, damage);
    const kill = lands && (hpBefore > 0) && (foe.hp <= 0);
    if ( backfire?.success && (backfire.damage > 0) ) backfire.damage = hurt(key, backfire.damage, { kind: "backfire", rolls: procs });

    // Stagger: what the hit took comes off the bar of a unit that did not begin the fight
    const jolted = jolt(other(key), hpBefore - foe.hp);

    // A share of the damage of the hit, set aside for the next attack of the unit that took it
    const taken = Math.max(Math.min(hpBefore, damage), 0);

    // Break: a hit that deals damage, from the unit that began the fight with weapon triangle advantage, takes
    // the counter-attack from a foe that still stands, from here on
    if ( lands && side.breaks && !own && (taken > 0) && (foe.hp > 0) ) foe.break = true;
    for ( const proc of taking ) {
      const off = tookOff.get(proc) ?? 0;
      const share = (amount, percent) => Math.floor(((amount * percent) / 100) + 1e-9);
      aside(proc, target, Object.fromEntries(Object.entries(proc.nextOfDamage).map(([stat, percent]) => [stat, share(taken, percent)])));

      // A share of what the skill took off the hit, for its unit's next attack, and the changes it grants that
      // are read from the hit: from what it took off, or from what the hit dealt in the end
      aside(proc, target, Object.fromEntries(Object.entries(proc.nextOfNegated ?? {}).map(([stat, percent]) => [stat, share(off, percent)])));
      give(proc, target, { dealt: { negated: off, taken }, reading: "only" });
    }

    // What landing the hit leaves for the table is said once it is known whether the foe still stands, and
    // what a skill that activated for this attack grants its foe is granted now that the attack has landed
    for ( const proc of landing ) remind(proc, key, { dealt: taken });
    if ( lands ) for ( const proc of fired ) remind(proc, key, { part: "foe", dealt: taken });

    // What defeating the foe sets off
    if ( kill ) {
      for ( const proc of side.chances?.kill ?? [] ) {
        if ( !fire(proc, key, procs) ) continue;

        // HP it restores to its unit: a number, and a share of the damage the killing blow dealt
        recovered += proc.recover + Math.floor(((taken * (proc.heal ?? 0)) / 100) + 1e-9);
        if ( proc.gold > 0 ) earned.push({ skill: proc.skill, by: key, gold: proc.gold });
        remind(proc, key);
      }
    }

    // What its unit made of a hit that failed its critical roll: damage to the target, now that the hit is dealt
    for ( const proc of lands ? later : [] ) {
      harm(proc, key, harms, procs);
      remind(proc, key);
    }

    // What a hit that dealt damage deals again as damage of an element: a second blow, which can defeat the
    // target and is its unit's kill
    for ( const echo of (lands && !own && (taken > 0)) ? (cur.echoes ?? []) : [] ) {
      if ( foe.hp <= 0 ) break;
      const amount = echoDamage(echo, taken);
      if ( !(amount > 0) ) continue;
      harms.push({ skill: echo.skill, by: key, to: target, amount: hurt(target, amount, { by: key, rolls: procs }), ...(echo.element ? { element: echo.element } : {}) });
    }

    // What cuts the HP the target has left once the damage is dealt: a share of it, or all of it for a target
    // that has no more than so much. That is a blow of its own too, which can be survived as a fatal blow can
    for ( const part of (lands && !deathless(target)) ? parts.filter((entry) => entry.cut) : [] ) {
      if ( foe.hp <= 0 ) break;
      const kills = foe.hp <= part.cut.killAt;
      const amount = kills ? foe.hp : Math.floor(((foe.hp * part.cut.percent) / 100) + 1e-9);
      if ( !(amount > 0) ) continue;
      harms.push({ skill: part.skill, by: key, to: target, amount: hurt(target, amount, { by: key, rolls: procs }), cut: kills ? "kill" : "share" });
    }

    // What its unit makes of a hit that dealt no damage: damage of its own to the target
    for ( const proc of (lands && !(taken > 0) && (hpBefore > 0)) ? empty : [] ) {
      if ( foe.hp <= 0 ) break;
      if ( !fire(proc, key, procs) ) continue;
      harm(proc, key, harms, procs);
      remind(proc, key);
    }

    // A unit that is hit may attack at once, where its skill has it so, by a chance that may be read from the
    // damage the hit dealt: if it still stands and can attack. An attack made in answer sets off no other
    if ( lands && (hpBefore > 0) && (foe.hp > 0) && !entry.answer && !carriedOff ) {
      const armed = !plan[target].blocked || joining[target].some((join) => !join.strike);
      const able = armed && !foe.broke && !foe.held && !foe.break && !foe.staggered && !foe.disarmed;
      // One made with numbers of its own, as with a weapon the unit was lent, needs no weapon in hand that
      // can answer: only that it reaches, and that nothing keeps its unit from attacking
      const free = !foe.held && !foe.break && !foe.staggered;
      for ( const proc of (plan[target].chances?.struck ?? []).filter((chance) => chance.attack) ) {
        if ( proc.strike ? !(free && proc.strike.able) : !able ) continue;
        if ( proc.perDamage && !(taken > 0) ) continue;
        if ( !fire(proc, target, procs, proc.perDamage * taken) ) continue;
        gain(proc, target);
        remind(proc, target);
        queue.splice(index + 1, 0, {
          key: target, share: proc.strike?.share ?? 1, part: null, added: proc.skill, groups: [], answer: true,
          ...(proc.strike ? { strike: proc.strike } : {})
        });
      }
    }

    // What the hit came to in the end. One that was curbed (blocked, lessened by a skill of its target, or
    // left with half its damage or less by the target's defence) sets off what its unit's skills make of that;
    // it was stopped if it dealt no damage and a block or a skill took something off it. And one that dealt no
    // damage sets off what the skills of its target make of that
    if ( lands && (hpBefore > 0) ) {
      const lessened = damage < whole;
      const curb = from.curb ?? {};
      const causes = [];
      if ( block?.success ) causes.push("block");
      if ( lessened || curb.skill ) causes.push("skill");
      if ( curb.defence ) causes.push("defence");
      const stopped = !(damage > 0) && ((block?.amount > 0) || lessened || (!!curb.skill && !!curb.through));
      for ( const proc of causes.length ? (side.chances?.curbed ?? []) : [] ) {
        if ( proc.curbs && !proc.curbs.some((cause) => causes.includes(cause)) ) continue;
        if ( (proc.stopped !== null) && (proc.stopped !== stopped) ) continue;
        if ( !fire(proc, key, procs) ) continue;
        gain(proc, key);
        harm(proc, key, harms, procs);
        wearDown(other(key), proc.wears, { skill: proc.skill });
        remind(proc, key);
      }
      for ( const proc of (!(damage > 0) && (foe.hp > 0)) ? (plan[other(key)].chances?.unhurt ?? []) : [] ) {
        if ( !fire(proc, other(key), procs) ) continue;
        gain(proc, other(key));
        harm(proc, other(key), harms, procs);
        remind(proc, other(key));
      }
    }

    // What the hit does to the target's conditions, and what they give back to the attacker
    let effects = null;
    if ( lands ) {
      let inflicts = own ? [...(own.inflicts ?? [])] : [...(side.inflicts ?? [])];

      // What a skill makes of the weapon's Effect for this attack: its chances so much higher, and what it
      // inflicts for so many more turns (see `amplified`)
      const amp = parts.reduce((most, part) => Math.max(most, part.amplify ?? 0), 0);
      if ( amp > 0 ) {
        inflicts = inflicts.map((entry) => ({ ...entry, chance: (entry.chance < 100) ? amplified(entry.chance, amp, { most: 100 }) : entry.chance, amp }));
      }
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
        ...(from.strike ?? {}),
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
          rest.burst.harm = hurt(other(key), rest.burst.harm * weak(other(key)), { rolls: procs });
          harms.push({ skill: rest.burst.skill, by: key, to: other(key), amount: rest.burst.harm });
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
        reflected += hurt(key, amount, { nonlethal, by: other(key), rolls: procs });
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

    // The conditions the target's skills gave the attacker for attacking it, whether the attack landed or not
    for ( const id of (mine.hp > 0) ? glared : [] ) {
      const given = afflict(key, id, { more: bendsOf(other(key))?.inflictTurns[id] ?? 0 });
      if ( !given ) continue;
      effects ??= { ended: [], inflicted: [], healed: 0 };
      (effects.returned ??= []).push(given);
      if ( given.success !== false ) passOn(other(key), given, procs, effects);
    }

    // A run of attacks that only costs one use spends it on the first of them that would cost one
    // Skills may spare the weapon: for the whole fight, after its first use in it, or for the attack that
    // defeats the foe
    const thrift = side.unit.fx?.rules;
    const free = !!mine.freeUses || (kill && !!thrift?.has("freeKill"));
    const spared = free || (!!thrift?.has("oneUsePerFight") && mine.used);
    const useSpent = !paid && !spared && !own && spendsUse(weapon, hit, plan.distance);
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
    const wexp = (lands && weapon) ? (weapon.wexp ?? 0) * (kill ? 2 : 1) * (side.unit.fx?.rules?.has("doubleWexp") ? 2 : 1) : 0;
    mine.wexp += wexp;

    const attack = {
      side: key,
      hitRoll,
      hitChance,
      hit,
      critRoll,
      critChance,
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
    if ( own ) attack.own = { hit: entry.strike.hit, might: entry.strike.might };
    if ( halved ) attack.halved = true;
    if ( lands && asCrit && !crit ) attack.asCrit = true;
    if ( instead ) attack.instead = instead;
    if ( slain && lands ) attack.slain = slain;
    if ( capped ) attack.capped = [...(cur.cappedBy ?? [])];
    if ( block ) attack.block = block;
    if ( carriedOff ) attack.saved = { ...come[target] };
    if ( warded ) attack.warded = warded;
    if ( noted.length ) attack.answers = noted;
    if ( rerolls.length ) attack.rerolls = rerolls;
    if ( thrown.pair ) attack.hitRolls = thrown.pair;
    if ( dodgedBy ) attack.dodged = dodgedBy;
    if ( critFoiled ) attack.critFoiled = critFoiled;
    if ( plain && lands ) attack.plain = plain.skill;
    if ( round > 1 ) attack.round = round;
    attacks.push(attack);

    // A skill that ends the fight with the attack it was declared for, and a target that is carried off
    if ( carriedOff || (lands && parts.some((part) => part.end)) ) {
      halted = true;
      break;
    }
  }

  noted = loose;
  about = null;
  current = null;

  // What skills wear off a foe's gear once the fight is over
  for ( const { to, wears, skill } of wearing ) wearDown(to, wears, { later: true, skill });

  const outcome = (key) => {
    const { hp, weapon, proficiencies, shield } = plan[key].unit;
    const mine = state[key];
    const gains = [];
    if ( weapon && (mine.wexp > 0) ) {
      // A weapon that is swung with the numbers of another trains the proficiency of its own kind
      for ( const proficiency of wexpProficiencies(proficiencies, weapon.trains ?? weapon.category) ) {
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
      shield: shield ? { usesStart: shield.uses?.value ?? 0, uses: mine.shieldUses, spent: mine.shieldSpent, broke: mine.shieldBroke } : null,
      wexp: mine.wexp,
      proficiencies: gains,
      conditionsStart: { ...(plan[key].unit.conditions ?? {}) },
      conditions: mine.conditions,
      healed: mine.healed,

      // The attacks it made, and whether one landed on it, for the changes on it that a fight of that kind
      // uses up
      made: mine.made,
      struck: mine.struck,
      held: mine.held,
      break: mine.break,
      stagger: bars[key] ?? null,
      staggered: mine.staggered,

      // A skill that waits for a moment to be spent is spent only where that moment took effect
      spent: [
        ...(attacks.length ? (plan[key].declared ?? []) : []).filter((entry) => !entry.waits || mine.fired.has(entry.name))
          .map(({ id, name }) => ({ id, name })),
        ...mine.counted
      ],

      // What each Skill of its own that rolled to activate and did divides its stat by
      ...(mine.sparked.length ? { sparked: [...mine.sparked] } : {}),
      ...(Object.keys(mine.items).length ? { items: Object.entries(mine.items).map(([id, lost]) => ({ id, spent: lost })) } : {}),

      // The attacks that were made against it, for a unit whose skill counts them through its turn
      ...((plan[key].chances?.struck ?? []).some((proc) => proc.every) ? { faced: mine.faced } : {}),

      // That it attacked with the weapon in hand, for a unit whose skills have one weapon hand something to
      // the next (see `triangle.mjs`)
      ...((mine.swung && plan[key].unit.fx?.hands) ? { swung: true } : {})
    };
  };

  // What skills do once the fighting is over, for the units that still stand: damage to the foe, a condition
  // on it, or something for the table to apply
  const closing = [];
  const after = [];

  // The moves a skill has the unit that started the fight make now that it is over, as Canto has it
  const moves = [];
  for ( const key of attacks.length ? ["initiator", "defender"] : [] ) {
    const mine = state[key];
    const foe = state[other(key)];
    for ( const proc of plan[key].chances?.after ?? [] ) {
      // A unit that was carried off is out of the fight, and nothing more is done to it or by it
      if ( (mine.hp <= 0) || mine.away ) break;
      if ( (proc.ifHit && !mine.landed) || (proc.ifStruck && !mine.struck) ) continue;
      if ( proc.hits && (mine.hits < proc.hits) ) continue;
      const needsFoe = (proc.retaliate > 0) || (proc.inflicts.length > 0) || (proc.remind === "foe")
        || ((proc.grants?.length > 0) && proc.grants.every((grant) => (grant.to === "foe") && !grant.reach));
      if ( needsFoe && ((foe.hp <= 0) || foe.away) ) continue;
      if ( !fire(proc, key, closing) ) continue;
      const entry = { skill: proc.skill, by: key };

      // HP the skill restores to its unit now that the fight is over
      const restored = Math.max(Math.min(proc.recover, (plan[key].unit.hpMax ?? Infinity) - mine.hp), 0);
      mine.hp += restored;
      mine.healed += restored;
      const harms = [];
      harm(proc, key, harms, closing);
      if ( harms.length ) entry.damage = harms[0].amount;
      for ( const { id } of (foe.hp > 0) ? proc.inflicts : [] ) {
        const given = afflict(other(key), id, { more: bendsOf(key)?.inflictTurns[id] ?? 0 });
        if ( !given ) continue;
        (entry.inflicted ??= []).push(given);
        if ( given.success !== false ) passOn(key, given, closing, entry);
      }
      remind(proc, key);
      if ( (foe.hp > 0) && !foe.away ) wearDown(other(key), proc.wears, { later: true, skill: proc.skill });
      if ( proc.canto && (key === "initiator") ) moves.push({ skill: proc.skill, by: key, canto: proc.canto });

      // What its unit pays for it now that the fight is over
      pay(proc, key, closing, "after");

      if ( ("damage" in entry) || entry.inflicted ) after.push(entry);
    }
  }

  // What was set aside for a unit's next attack and found none in this fight waits for it in a later one: a
  // change that the next fight in which the unit makes an attack uses up
  for ( const key of ["initiator", "defender"] ) {
    const mine = state[key];
    if ( (mine.hp <= 0) || mine.away ) continue;
    for ( const [skill, bonus] of Object.entries(mine.kept) ) {
      const first = Object.fromEntries(Object.entries(bonus).filter(([, amount]) => amount));
      if ( !Object.keys(first).length ) continue;
      granted.push({
        by: key, to: key, unit: null, name: plan[key].unit.name ?? "", kept: true,
        change: buildChange({ name: skill, effects: [{ firstAttack: first }], ends: "map", once: ONCE_STRIKE }, { skill, own: true })
      });
    }
  }

  const result = { attacks, initiator: outcome("initiator"), defender: outcome("defender") };
  if ( costs.length ) result.paid = costs;
  if ( opening.length ) result.opening = opening;
  if ( closing.length ) result.closing = closing;
  if ( after.length ) result.after = after;
  if ( begun.length ) result.before = begun;
  if ( moves.length ) result.moves = moves;

  // A step is taken by a unit that still stands, and one that moves its foe needs that foe standing too. What
  // an attack that landed did to the units around its target it did, whatever came after
  const taken = steps.filter((entry) => {
    const move = entry.step.move;
    if ( (move !== "scatter") && ((state[entry.by].hp <= 0) || state[entry.by].away) ) return false;
    return !["swap", "shove", "place"].includes(move) || ((state[other(entry.by)].hp > 0) && !state[other(entry.by)].away);
  });
  if ( taken.length ) result.steps = taken;
  if ( goes.length && (state.initiator.hp > 0) ) result.acts = goes;
  if ( sung.length && (state.initiator.hp > 0) && !state.initiator.away ) result.refreshes = sung;
  if ( reminders.length ) result.reminders = reminders;
  if ( earned.length ) result.earned = earned;
  if ( slain.length ) result.slain = slain;
  if ( charged.length ) result.charged = charged;
  if ( granted.length ) result.granted = granted;
  if ( worn.length ) result.worn = worn;
  if ( cancelled.length ) result.cancelled = cancelled;

  // What is taken from a foe is taken by a unit that still stands
  const takes = looted.filter((entry) => (state[entry.by].hp > 0) && !state[entry.by].away);
  if ( takes.length ) result.loot = takes;

  // And a foe is raised by a unit that still stands
  const raises = raised.filter((entry) => (state[entry.by].hp > 0) && !state[entry.by].away);
  if ( raises.length ) result.raises = raises;
  if ( disarmed.length ) result.disarmed = disarmed;
  if ( ended ) result.fled = ended;

  // The rounds the fight went on for beyond the first, each with what had it fought; the chances that were
  // rolled as rounds ended; and the side whose owner ended the fight before a further round
  if ( further.length ) result.rounds = further;
  if ( turning.length ) result.turning = turning;
  if ( stopped ) result.stopped = stopped;
  if ( splashes.length ) result.splashes = splashes;
  if ( warding.length ) result.wards = warding;
  if ( spreads.length ) result.spreads = spreads;
  if ( spreadRolls.length ) result.closing = [...(result.closing ?? []), ...spreadRolls];
  if ( loose.length ) result.answers = loose;
  return result;
}

/* -------------------------------------------- */

/**
 * What an attack is sure to deal if it lands: a critical hit that is certain, as one a skill makes of the
 * attack or one at a Critical of 100, is counted as one. What the hit deals again as damage of an element is
 * not multiplied.
 * @param {{damage: number, crit?: number, echo?: number}} blow     An attack as the plan has it
 * @param {number} times                                             What a critical hit multiplies damage by
 * @returns {number}
 */
export function sureCritical(blow, times) {
  const damage = blow?.damage ?? 0;
  if ( !((blow?.crit ?? 0) >= 100) ) return damage;
  const echo = Math.min(blow.echo ?? 0, damage);
  return Math.floor(((damage - echo) * times) + 1e-9) + echo;
}

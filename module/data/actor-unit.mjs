import { FEO } from "../config.mjs";
import { authorityBonus, authorityNext, authorityRank, battalionBonuses, hasRetreated } from "../rules/battalions.mjs";
import { guardOf, shieldsBarred } from "../rules/blocking.mjs";
import { abilityScore, computeCombat, statTotal, unitWeight } from "../rules/combat-stats.mjs";
import { cantoPlusEntry } from "../rules/canto.mjs";
import { carryEntry } from "../rules/capturing.mjs";
import { resolveCaps } from "../rules/classes.mjs";
import { parseRange } from "../rules/combat.mjs";
import { canWield, countedRank, levelRank, weaponEntry, wieldLevel } from "../rules/weapons.mjs";
import { conditionModifiers, readConditions } from "../rules/conditions.mjs";
import { deathThreshold, fateReasons, leavesMap, outOfFight, resilience, woundThreshold } from "../rules/defeat.mjs";
import { skillGrowths } from "../rules/earnings.mjs";
import {
  AFFINITY_ID, affinityCooldown, affinityEntry, affinityUsage, hasCooldown, atLevelLimit, bloodGrowths, bloodProficiencies, effectiveGrowths, levelLimit, moduleCap, optionalSources,
  powerEntries, powerExtras, skillRoom
} from "../rules/optional.mjs";
import { abilityBonus, abilityPointsPerLevel, supportBonus, supportTotals } from "../rules/progression.mjs";
import { burdened } from "../rules/rescue.mjs";
import { staggerInUse, staggerOf, staggerTimes } from "../rules/stagger.mjs";
import { formBonuses, gaugeProfile, shiftBends, shiftMode, shiftPercent, shiftedBonuses, transformsLeft } from "../rules/shifting.mjs";
import { IMITATION_FLAG, overlay, readImitation } from "../rules/imitation.mjs";
import { gripEntry } from "../rules/actions.mjs";
import {
  bestRankOf, countsAsSkill, effectsOf, multiplyStats, skillCanto, skillCarry, skillCrossing, skillKnacks, skillPassing, skillRule, skillShove, skillStanding, skillStars, skillTotals, unitTier
} from "../rules/skills.mjs";
import { addKnacks, gearKnacks } from "../rules/stealing.mjs";
import { staffPassiveEntry } from "../rules/staves.mjs";
import { usedUp } from "../rules/skill-usage.mjs";
import { kinBonus } from "../rules/supports.mjs";
import { WEATHERPROOF } from "../rules/weather.mjs";
import { TIMED_ENDS, TIMED_ONCE, skillCounts, tempHp, timedEntries } from "../rules/timed.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, ObjectField, SchemaField, StringField } = foundry.data.fields;

/**
 * A required integer field.
 * @param {number} initial
 * @param {object} [options]
 * @returns {NumberField}
 */
function integer(initial = 0, options = {}) {
  return new NumberField({ required: true, nullable: false, integer: true, initial, ...options });
}

/**
 * An optional stat cap. Null means the stat has no cap.
 * @returns {NumberField}
 */
function cap() {
  return new NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null });
}

/**
 * An integer that may be left empty.
 * @param {object} [options]
 * @returns {NumberField}
 */
function optional(options = {}) {
  return new NumberField({ required: true, nullable: true, integer: true, initial: null, ...options });
}

/**
 * A single line of free text.
 * @returns {StringField}
 */
function text() {
  return new StringField({ required: true, blank: true });
}

/**
 * Build a SchemaField with one entry per key.
 * @param {string[]} keys
 * @param {(key: string) => DataField} factory
 * @returns {SchemaField}
 */
function keyed(keys, factory) {
  return new SchemaField(Object.fromEntries(keys.map((key) => [key, factory(key)])));
}

/**
 * Every affinity a unit can hold. Those of the Optional Affinities module are kept on a unit whether or not
 * the world plays with them, like the fields of the other Optional Modules.
 */
const AFFINITIES = Object.keys({ ...FEO.affinities, ...FEO.optionalAffinities });

/**
 * What a Power goes by among its unit's skills, in fights and on cards.
 * @param {string} id
 * @returns {string}
 */
function powerName(id) {
  const i18n = globalThis.game?.i18n;
  return i18n?.localize ? i18n.localize(`FEO.Optional.glory.powers.${id}.name`) : id;
}

/**
 * What the effect an Affinity builds into its unit goes by among the unit's skills, in fights and on cards:
 * "Fire Affinity".
 * @param {string} affinity
 * @returns {string}
 */
function affinityEffectName(affinity) {
  const i18n = globalThis.game?.i18n;
  const label = FEO.affinities[affinity];
  if ( !label || !i18n?.format ) return affinity ?? "";
  return i18n.format("FEO.Optional.affinityEffect.name", { affinity: i18n.localize(label) });
}

/**
 * What the effect of Canto+ that a Laguz has in its animal form goes by among the unit's skills: "Transformed".
 * @returns {string}
 */
function shiftedName() {
  const i18n = globalThis.game?.i18n;
  return i18n?.localize ? i18n.localize("FEO.Shift.transformed") : "Transformed";
}

/**
 * What carrying a captive goes by among the unit's skills and numbers: "Captive: Brigand".
 * @param {string} name     The captive's name
 * @returns {string}
 */
function captiveName(name) {
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format("FEO.Optional.capturing.carrying", { name }) : name;
}

/**
 * What carrying an ally goes by among the unit's skills and numbers: "Carrying: Lyn".
 * @param {string} name     The ally's name
 * @returns {string}
 */
function carriedName(name) {
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format("FEO.Rescue.carrying", { name }) : name;
}

/**
 * What an equipped staff goes by among the unit's skills and numbers, for what it does while it is equipped:
 * "Heal, equipped".
 * @param {string} name     The staff's name
 * @returns {string}
 */
function equippedStaffName(name) {
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format("FEO.Optional.staffPassives.entry", { staff: name }) : name;
}

/**
 * The data model for a Unit: any combatant on the map, player-controlled or otherwise.
 */
export default class UnitData extends foundry.abstract.TypeDataModel {

  /**
   * Tells where a unit stands: the units around it on the map in view and the auras it receives from their
   * skills, as `standing` in the aura rules returns them, or null for a unit that is not on that map. Set
   * when the system starts; while it is not, no unit has anything around it.
   * @type {((actor: object) => {near: object, auras: object[]}|null)|null}
   */
  static standing = null;

  /**
   * Tells how a unit moved this turn, as its token on the map in view has noted it (see `rules/movement.mjs`),
   * or null where that cannot be judged: for a unit that is not on that map, and outside of a battle. Set when
   * the system starts; while it is not, no unit's movement can be judged.
   * @type {((actor: object, options: {mov: number, weapon: string}) => object|null)|null}
   */
  static moving = null;

  /** @override */
  static defineSchema() {
    return {
      player: text(),
      className: text(),
      classId: text(),
      level: integer(1, { min: 1 }),
      exp: integer(0, { min: 0 }),
      gold: integer(0, { min: 0 }),
      affinity: new StringField({ required: true, blank: true, choices: AFFINITIES }),

      // The proficiency chosen for an Affinity that gives a rank in one of its unit's choice, as Tome does
      affinityRank: new StringField({ required: true, blank: true, choices: Object.keys(FEO.proficiencies) }),

      // The skill chosen for an Affinity that shortens the cooldown of one of its unit's choice, as Key does:
      // the id of its Item
      affinitySkill: text(),

      // Where an Affinity its unit chooses when to use stands, as a skill keeps it (see `rules/skill-usage.mjs`):
      // switched on, the turn starts until it can be used again and until it switches itself off, and the
      // times it was spent since its uses last came back
      affinityUse: new SchemaField({
        active: new BooleanField(),
        cooldown: integer(0, { min: 0 }),
        lasting: integer(0, { min: 0 }),
        used: integer(0, { min: 0 })
      }),
      specialQualities: text(),
      army: new StringField({ required: true, blank: true, choices: Object.keys(FEO.armies) }),

      hp: new SchemaField({
        value: integer(0),
        max: integer(0, { min: 0 }),
        cap: cap()
      }),
      wounds: integer(0, { min: 0 }),
      injuries: integer(0, { min: 0 }),

      // Has the unit Waited? It counts as Waiting until its next turn starts, which some skills ask for
      waiting: new BooleanField(),

      // Does the unit suffer from Break? It then makes no counter-attack in its next fight, and is rid of it
      // once that fight is over or its own turn starts (see the Breaking rules)
      break: new BooleanField(),

      // Stagger: what is left of the unit's Stagger bar, its full size, which is 0 until the bar is made, and
      // for a Staggered unit the ends of its own turn left before it recovers (see the Stagger rules)
      stagger: new SchemaField({
        value: integer(0, { min: 0 }),
        max: integer(0, { min: 0 }),
        turns: integer(0, { min: 0, max: FEO.optional.stagger.turns.own })
      }),

      // Capturing: whether the unit's next attack is an attempt to capture; the unit it holds captive, or has
      // subdued and may pick up for `turns` more ends of its own turn; and for a unit that was captured, who
      // by, whether it is carried, and the HP it had before, which it returns with if it gets free
      capturing: new BooleanField(),
      captive: new SchemaField({
        uuid: text(),
        name: text(),
        held: new BooleanField(),
        turns: integer(0, { min: 0 })
      }),
      captured: new SchemaField({
        by: text(),
        name: text(),
        hp: integer(0, { min: 0 }),
        held: new BooleanField()
      }),

      // Rescue: the ally the unit carries, by its Actor and its token, whether that ally is no load to it as
      // the ally's own skills have it, and whether the unit could not carry it by its Weight, as when a skill
      // had it come for the ally: it then sets the ally down as its next turn starts. And for a unit that is
      // carried, who carries it
      rescuing: new SchemaField({
        uuid: text(),
        token: text(),
        name: text(),
        light: new BooleanField(),
        over: new BooleanField()
      }),
      rescued: new SchemaField({
        by: text(),
        token: text(),
        name: text()
      }),

      // What became of a unit brought to 0 HP: blank while it is in the fight
      defeat: new SchemaField({
        state: new StringField({ required: true, blank: true, choices: FEO.defeat.states }),
        turns: integer(0, { min: 0 }),
        paused: new BooleanField()
      }),

      // Changing form. `kind` is blank to follow the class; the gauge values are empty to use the class's own
      shift: new SchemaField({
        kind: new StringField({ required: true, blank: true, choices: [...Object.keys(FEO.shift.modes), "none"] }),
        value: integer(0, { min: 0 }),
        active: new BooleanField(),
        percent: optional({ min: 0 }),
        start: optional(),
        turnHuman: optional(),
        turnAnimal: optional(),
        combatHuman: optional(),
        combatAnimal: optional(),
        fought: new SchemaField({ own: integer(0, { min: 0 }), other: integer(0, { min: 0 }) }),
        uses: integer(0, { min: 0 }),
        usesMax: optional({ min: 0 }),
        boosted: new BooleanField()
      }),

      stats: keyed(Object.keys(FEO.stats), () => new SchemaField({
        base: integer(0, { min: 0 }),
        boost: integer(0),
        cap: cap()
      })),
      boon: new StringField({ required: true, blank: true, choices: FEO.boonStats }),
      bane: new StringField({ required: true, blank: true, choices: FEO.boonStats }),

      wt: new SchemaField({
        class: integer(0)
      }),

      abilities: keyed(Object.keys(FEO.abilities), (key) => new SchemaField({
        source: new StringField({
          required: true,
          choices: FEO.abilities[key].sources,
          initial: FEO.abilities[key].sources[0]
        }),
        increase: integer(0),
        boost: integer(0)
      })),

      growths: keyed(Object.keys({ ...FEO.growths, ...FEO.optionalGrowths, ...FEO.weaponLevelGrowth }), (key) => {
        return integer(key in FEO.optionalGrowths ? 0 : FEO.baseGrowth, { min: 0 });
      }),

      combatBoosts: keyed(Object.keys(FEO.combatBoosts), () => integer(0)),

      calc: keyed(Object.keys(FEO.calcModes), (key) => new StringField({
        required: true,
        choices: Object.keys(FEO.calcModes[key]),
        initial: "normal"
      })),

      proficiencies: keyed(Object.keys(FEO.proficiencies), () => new SchemaField({
        rank: new StringField({ required: true, choices: Object.keys(FEO.ranks), initial: "F" }),
        wexp: new NumberField({ required: true, nullable: false, min: 0, initial: 0 })
      })),

      // The ranks skills have added to proficiencies, by the Item each skill is, so that a rank is given once
      // and can be taken back (see the skill rank rules)
      skillRanks: new ArrayField(new SchemaField({
        item: text(),
        key: text(),
        steps: integer(0, { min: 0 })
      })),

      checks: keyed(Object.keys(FEO.abilityChecks), (key) => new SchemaField({
        points: integer(0, { min: 0 }),
        stat: new StringField({
          required: true,
          choices: FEO.abilityChecks[key].stats,
          initial: FEO.abilityChecks[key].stats[0]
        })
      })),
      checkPoints: integer(0, { min: 0 }),

      // Changes that last a while, granted by skills: what each does, and when it ends (see the timed rules)
      timed: new ArrayField(new SchemaField({
        name: text(),
        from: text(),
        effects: new ArrayField(new ObjectField()),
        ends: new StringField({ required: true, choices: TIMED_ENDS, initial: "turnEnd" }),
        turns: integer(1, { min: 0 }),
        clock: text(),
        stacks: integer(1, { min: 0 }),
        max: integer(0, { min: 0 }),
        fades: new BooleanField(),

        // Temporary HP it still holds for its unit: lost before the unit's own, and gone with the change
        hp: integer(0, { min: 0 }),

        // The condition it lasts with, if any: it ends when its unit suffers from that condition no longer
        while: text(),

        // The fight that uses it up, if one does: the next it is attacked in and would have answered, the next
        // it starts, or the next of either kind
        once: new StringField({ required: true, blank: true, choices: TIMED_ONCE }),

        // The turns of its unit still to start before it begins, whether it is granted again once it has, the
        // HP it restores as each of those turns starts, whether a second one spoils it and whether one has,
        // and whether it only keeps count of something for a skill
        wait: integer(0, { min: 0 }),
        lone: new BooleanField(),
        mend: integer(0, { min: 0 }),

        // The damage it deals to its unit as each of its turns starts, and the unit whose skill deals it
        harm: integer(0, { min: 0 }),
        by: text(),
        spoils: new BooleanField(),
        spoiled: new BooleanField(),
        mark: new BooleanField(),

        // The HP it takes off its unit as it moves and once it has attacked, and whether it keeps track of its
        // unit standing in sight of the unit it comes from (see the rules of action skills)
        toll: new ObjectField(),
        watch: new BooleanField(),

        // The stance it is, for one its unit is in until something ends it (see the rules of stances)
        stance: new ObjectField({ required: false })
      })),

      bonds: new ArrayField(new SchemaField({
        name: text(),
        affinity: new StringField({ required: true, blank: true, choices: AFFINITIES }),
        rank: new StringField({ required: true, choices: Object.keys(FEO.supportRanks), initial: "E" }),
        points: integer(0, { min: 0 }),
        inRange: new BooleanField(),

        // `uuid` links the bond to its partner's Actor; `kin` marks a Bond Support; `auto` lets the tokens on
        // the scene decide whether the partner is in range and side by side
        uuid: text(),
        kin: new BooleanField(),
        adjacent: new BooleanField(),
        auto: new BooleanField({ initial: true })
      })),

      // Optional Modules. These are kept on every unit and used only while the world setting for each is on
      lives: new SchemaField({ value: optional({ min: 0 }), max: optional({ min: 0 }) }),
      levelLimit: optional({ min: 1 }),
      movementStars: integer(0, { min: 0 }),

      // Follow-up Critical Multiplier: what the unit's Critical is multiplied by on its follow-up attacks
      fcm: integer(FEO.optional.followUpCritical.base, {
        min: FEO.optional.followUpCritical.base,
        max: FEO.optional.followUpCritical.max
      }),
      holyBlood: new SchemaField({
        lineages: keyed(Object.keys(FEO.optional.holyBlood.lineages), () => new StringField({
          required: true,
          blank: true,
          choices: Object.keys(FEO.optional.holyBlood.grades)
        })),

        // What Holy Blood has done to the rank of each proficiency, so that it can be taken back
        ranks: keyed(bloodProficiencies(), () => new SchemaField({
          steps: integer(0, { min: 0 }),
          from: new StringField({ required: true, blank: true, choices: Object.keys(FEO.ranks) })
        }))
      }),
      crest: new SchemaField({
        id: new StringField({
          required: true,
          blank: true,
          choices: [...Object.keys(FEO.optional.crests.crests), FEO.optional.crests.custom]
        }),
        grade: new StringField({ required: true, choices: Object.keys(FEO.optional.crests.grades), initial: "minor" }),
        name: text(),
        effect: text(),
        chance: optional({ min: 0, max: 100 })
      }),
      // Skill Capacity: Capacity Points typed for this unit, in place of those of the tier it has reached
      skillCapacity: optional({ min: 0 }),

      // Weapon Level, which takes the place of rising weapon ranks where the world plays with it
      weaponLevel: new SchemaField({ base: integer(FEO.optional.weaponLevel.start, { min: 0 }) }),

      // Glory: what the unit has to spend, what it gives the unit that brings it down, and the Powers it holds
      glory: new SchemaField({
        value: integer(0, { min: 0 }),
        bounty: integer(0, { min: 0 }),
        powers: new ArrayField(new StringField({ required: true, choices: Object.keys(FEO.optional.glory.powers) }))
      }),

      // Heart Seal Classes chosen for the unit, beside the class its own line starts in
      heartSeals: new ArrayField(new SchemaField({ name: text(), uuid: text() })),
      leadership: new SchemaField({
        stars: integer(0, { min: 0 }),
        authority: text(),
        received: integer(0, { min: 0 })
      }),

      // Battalions & Gambits: Authority, the proficiency that commanding a Battalion takes, and the Authority
      // EXP the unit has toward its next rank. Not the Authority of Authority & Leadership above, which is the
      // leader a unit answers to
      authority: new SchemaField({
        rank: new StringField({ required: true, choices: ["F", ...FEO.optional.battalions.ranks], initial: "F" }),
        exp: integer(0, { min: 0 })
      }),

      profile: new SchemaField({
        gender: text(),
        age: text(),
        race: text(),
        homeland: text(),
        allegiance: text(),
        occupation: text(),
        lines: text(),
        veils: text()
      }),
      biography: new HTMLField(),

      // What the unit says on the Level Up splash, by how the level went (see `rules/level-up.mjs`)
      levelLines: new SchemaField({
        great: text(),
        fair: text(),
        poor: text()
      }),

      // The Character Creator's record of what was chosen for the unit, read by `module/rules/creation.mjs`
      creation: new ObjectField()
    };
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  /**
   * A unit that imitates another has what it took on of that unit laid over its own data, each time it is
   * prepared and before its Items are: its own is what is saved, and is never written over (see
   * `rules/imitation.mjs`). `imitating` says whom it imitates and with which skill; null for a unit that is
   * itself.
   * @override
   */
  prepareBaseData() {
    const note = readImitation(this.parent?.flags?.[FEO.id]?.[IMITATION_FLAG]);
    this.imitating = null;
    if ( !note ) return;

    // The class it took on is an Item of its own; one that is gone leaves it the name of that class
    const cls = note.classId ? (this.parent?.items?.get?.(note.classId) ?? null) : null;
    overlay(this, note.taken, { classId: (cls?.type === "class") ? note.classId : "" });
    this.imitating = { name: note.ally, of: note.of, skill: note.name, item: note.skill, change: note.change };
  }

  /* -------------------------------------------- */

  /** @override */
  prepareDerivedData() {
    const items = Array.from(this.parent?.items ?? []);
    const statuses = this.parent?.statuses ?? new Set();

    // Health: under the Incapacitation system, Wounds and Injuries lower maximum HP, and every few Wounds add
    // a Grave Wound. A world that does not play with it keeps what a unit was given but counts none of it
    const health = FEO.defeat.enabled;
    this.graveWounds = health ? Math.floor(this.wounds / FEO.woundsPerGraveWound) : 0;
    // A unit that imitates another has that unit's maximum HP for as long as it does
    this.hp.base = this.imitating ? this.hp.max : this._source.hp.max;
    this.hp.lost = health ? (this.wounds * FEO.woundPenalty) + (this.injuries * FEO.injuryPenalty) : 0;
    this.hp.max = Math.max(this.hp.base - this.hp.lost, 0);
    this.hp.woundThreshold = health ? woundThreshold(this.hp.base) : 0;

    // Temporary HP: what the changes that last on the unit hold for it, on top of its own and lost first
    this.hp.temp = tempHp(this.timed);
    this.hp.deathThreshold = deathThreshold(this.hp.base);

    // Class: its name is shown as the unit's class, and the caps it gives take the place of hand-typed ones
    const cls = this.classItem;
    if ( cls ) this.className = cls.name;
    const manualCaps = { hp: this.hp.cap };
    for ( const [key, stat] of Object.entries(this.stats) ) manualCaps[key] = stat.cap;
    const caps = resolveCaps({ classCaps: cls?.system.caps, manualCaps, boon: this.boon, bane: this.bane });
    this.hp.cap = caps.hp.value;
    this.hp.capSource = caps.hp.source;
    for ( const [key, stat] of Object.entries(this.stats) ) {
      stat.cap = caps[key].value;
      stat.capSource = caps[key].source;
    }

    // Optional Modules: the caps the extra growth rates come with, and the growth rates a level up rolls,
    // which Holy Blood raises
    for ( const [key, stat] of Object.entries(this.stats) ) {
      const limit = moduleCap(key, stat.cap);
      if ( limit === null ) continue;
      stat.cap = limit;
      stat.capSource = "module";
    }
    this.growthBonus = FEO.optional.holyBlood.enabled ? bloodGrowths(this.holyBlood.lineages) : {};
    this.growthRates = effectiveGrowths(this.growths, this.growthBonus);

    // Weapon Level: whether it is in use, where it stops, and the rank it counts as
    const levelled = this.weaponLevel;
    levelled.used = FEO.optional.weaponLevel.enabled;
    levelled.cap = FEO.optional.weaponLevel.cap;
    levelled.capped = levelled.base >= levelled.cap;
    levelled.rank = levelRank(levelled.base);

    // The Level Cap: the highest level the unit can reach, and whether it is there. Null without a cap
    this.maxLevel = levelLimit(this.levelLimit);
    this.atMaxLevel = atLevelLimit(this.level, this.maxLevel);

    // Conditions and the turns each has left, read from the unit's active effects
    this.conditions = readConditions(this.parent?.effects, statuses);

    // Changing form: how this unit does it, its gauge values, and what being transformed adds
    const shift = this.shift;
    shift.mode = shiftMode(cls?.system.race, shift.kind);

    // What the unit's skills change about it is read here, ahead of its other skill effects, since the stats
    // of a transformed unit are among the numbers those are worked out from
    // A change that lasts on it may say so too, as one that lets it Shift at will for a turn
    shift.bends = shiftBends([
      ...items.filter((item) => (item.type === "skill") && item.system.equipped && (item.system.automate !== false)).map((item) => {
        return { name: item.name, active: !!item.system.usage?.kind && !!item.system.state?.active, effects: effectsOf(item.system) };
      }),
      ...timedEntries(this.timed).map((entry) => ({ name: entry.name, active: true, effects: entry.effects }))
    ]);
    shift.profile = gaugeProfile(cls?.system.notes, shift, shift.bends.gauge);
    shift.limit = shift.usesMax ?? (FEO.shift.stone.uses + shift.bends.transforms);
    shift.left = shift.bends.endless ? Math.max(transformsLeft(shift.uses, shift.limit), 1) : transformsLeft(shift.uses, shift.limit);
    shift.transformed = (shift.mode === "gauge") ? shift.active : (shift.mode === "stone") && (shift.left > 0);
    shift.share = shiftPercent(shift.percent, shift.boosted, shift.bends);
    const form = formBonuses(cls?.system ?? null);
    shift.bonuses = shift.mode ? { ...shiftedBonuses(this.stats, shift.share), ...form.stats } : {};
    shift.inCombat = {};

    // Glory: the Movement Stars its Powers add to the unit's own, and whether its Affinity counts at all times
    const extras = this.glory.extras = powerExtras(this.glory.powers);
    this.starsTotal = this.movementStars + extras.stars;

    // Battalions & Gambits: the rank the unit's Authority counts as with what that takes and gives, and the
    // Battalion it commands with what that adds to it. What a Battalion adds to Charm is counted where Charm is
    const authority = this.authority;
    authority.counted = authorityRank(authority.rank);
    authority.next = authorityNext(authority.rank);
    authority.bonus = authorityBonus(authority.rank);
    const squad = FEO.optional.battalions.enabled
      ? (items.find((item) => (item.type === "battalion") && item.system.equipped) ?? null)
      : null;
    this.battalion = squad ? {
      id: squad.id,
      name: squad.name,
      retreated: hasRetreated(squad.system),
      granted: battalionBonuses(squad.system)
    } : null;
    for ( const [key, ability] of Object.entries(this.abilities) ) ability.modifier = this.battalion?.granted.abilities[key] ?? 0;

    // What skills ask of the unit beyond its numbers: its class tier, counted by its level where its class
    // does not promote, and whether its highest weapon rank is a physical or a magical one
    this.classTier = unitTier({ tier: cls?.system.tier ?? null, promotes: (cls?.system.promotesTo?.length ?? 0) > 0, level: this.level });
    this.bestRank = bestRankOf(Object.fromEntries(Object.entries(this.proficiencies).map(([key, proficiency]) => [key, proficiency.rank])));

    // Authority & Leadership: the Leadership Stars the unit's skills are count with those typed on its sheet
    const leadership = this.leadership;
    leadership.fromSkills = FEO.optional.leadership.enabled
      ? skillStars(items.filter((item) => (item.type === "skill") && item.system.equipped && (item.system.automate !== false))
        .map((item) => ({ effects: effectsOf(item.system) })))
      : 0;
    leadership.total = leadership.stars + leadership.fromSkills;

    // Collect everything that adjusts stats or combat stats
    const sources = this.#collectSources(items);

    // Supports in range: the damage they take off every hit, the Attack Speed they count towards a follow-up
    // attack, and what they add to the Skill Activation rate
    const support = this.support = supportTotals(this.bonds);
    if ( extras.resonance ) {
      for ( const key of Object.keys(support) ) support[key] += Math.floor(FEO.affinityBoosts[this.affinity]?.[key] ?? 0);
    }
    this.endurance = support.end;
    this.haste = support.hst;
    if ( shift.transformed && Object.keys(shift.bonuses).length ) {
      // A Shift lasts, so it changes the unit's stats; a stone only transforms its bearer for a combat
      if ( shift.mode === "gauge" ) sources.push({ label: "FEO.Shift.transformed", localize: true, stats: shift.bonuses });
      else shift.inCombat = shift.bonuses;
    }

    // Stat totals
    const total = () => {
      for ( const [key, stat] of Object.entries(this.stats) ) {
        stat.modifier = sources.reduce((sum, source) => sum + (source.stats?.[key] ?? 0), 0);
        stat.total = statTotal(stat.base, stat.boost, stat.modifier);
        if ( this.graveWounds && FEO.graveWoundStats.includes(key) ) {
          stat.total = Math.max(stat.total - this.graveWounds, 1);
          stat.modifier -= this.graveWounds;
        }
        stat.capped = (stat.cap !== null) && (stat.base >= stat.cap);
      }
    };
    total();
    this.hp.capped = (this.hp.cap !== null) && (this.hp.base >= this.hp.cap);

    // Skills. What the equipped ones add outside a fight is worked out from the unit's numbers without them,
    // which are kept so that a fight can work everything out again once it is known who fights whom
    const weapon = this.equippedWeapon;
    const bareModifiers = sources.filter((source) => source.combat).map((source) => ({
      label: source.label,
      localize: source.localize,

      // What a support partner in range adds, which a fight may cancel (see `rules/choices.mjs`)
      ...(source.support ? { support: true } : {}),
      ...source.combat
    }));
    const mastery = this.masteryFor(weapon?.system ?? null);
    const bareStats = this.statValues;
    this.bare = {
      stats: bareStats,
      base: Object.fromEntries(Object.entries(this.stats).map(([key, stat]) => [key, stat.base])),
      modifiers: bareModifiers,
      accuracy: computeCombat({
        stats: bareStats,
        boosts: this.combatBoosts,
        calc: this.calc,
        modifiers: mastery ? [mastery, ...bareModifiers] : bareModifiers
      }, weapon?.system ?? null).accuracy.value
    };
    // What the unit's Affinity takes off the cooldown of the one skill chosen for it, as Key does
    const affinityIn = extras.resonance ? { config: { ...FEO.optional.affinityEffects, enabled: true } } : {};
    const keyed = affinityCooldown(this, affinityIn);
    const entries = items.filter((item) => (item.type === "skill") && item.system.equipped).map((item) => {
      const { stats, combat, effects, choice, raises, automate, nihil, chosen, usage, state } = item.system;
      return {
        id: item.id,
        name: item.name,
        nihil,

        // Turns added to the cooldown of this skill alone
        ...(((keyed?.skill === item.id) && hasCooldown(item.system)) ? { cooldowns: keyed.turns } : {}),

        // Is it chosen when to activate, as the reference sheet marks it, and what did its unit pick for a
        // fight (see `rules/choices.mjs`)?
        chosen: !!chosen,
        picked: { ...(state?.picked ?? {}) },
        choice,
        effects: effectsOf(automate === false ? { stats, combat } : {
          stats, combat, effects, choice, raises, early: !!state?.early, over: !!usage?.over && usedUp(usage, state)
        }),

        // A skill that is chosen when to activate: is it switched on, and does a fight spend it?
        active: !!usage?.kind && !!state?.active,
        spends: usage?.kind === "declare",
        usage: usage?.kind ? { ...usage } : null,
        state: usage?.kind ? { ...state } : null
      };
    });

    // Additional Affinity Effects: what the unit's Affinity builds into it is read as one more skill, named
    // after the Affinity, which Nihil does not cancel and which takes none of its skill slots. It is marked
    // `innate`, as everything here is that is no skill of the unit: what cancels skills in a fight leaves it
    // A unit whose Affinity counts at all times has that effect whether or not the world plays with them
    // One its unit chooses when to use is switched on and spent as such a skill is, and keeps where it stands
    // on the unit: it goes by `AFFINITY_ID` in place of the id an Item has
    const innate = affinityEntry(this.affinity, affinityEffectName(this.affinity), affinityIn);
    const chosenUse = innate ? affinityUsage(this.affinity, affinityIn) : null;
    this.affinityWay = chosenUse ? { ...chosenUse, name: innate.name, on: !!this.affinityUse.active } : null;
    if ( innate && chosenUse ) {
      entries.push({
        ...innate, innate: true, id: AFFINITY_ID, active: !!this.affinityUse.active, spends: chosenUse.spentBy === "fight",
        usage: chosenUse.usage, state: { ...this.affinityUse }
      });
    }
    else if ( innate ) entries.push({ ...innate, innate: true, active: false, spends: false, usage: null, state: null });

    // Glory: each Power the unit holds is one more skill of the same kind, named after the Power
    for ( const power of powerEntries(this.glory.powers, powerName) ) {
      entries.push({ ...power, innate: true, active: false, spends: false, usage: null, state: null });
    }

    // Changing form: a Laguz in its animal form has the effect of Canto+, which is read as one more skill of
    // the same kind
    if ( (shift.mode === "gauge") && shift.active ) {
      entries.push({ ...cantoPlusEntry(shiftedName()), innate: true, active: false, spends: false, usage: null, state: null });
    }

    // What the unit's skills, and the changes that last on it, make of carrying a unit and of being carried
    const lasting = timedEntries(this.timed);
    this.carry = skillCarry([...entries, ...lasting], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: bareStats,
      weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: shift.transformed,
      waiting: this.waiting
    });

    // Rescue: a unit that carries an ally is slowed by it, which is read as one more skill of its own, named
    // after the ally; unless its skills make nothing of the load, or the ally is no load to anyone
    if ( this.rescuing.uuid && burdened(this.carry, this.rescuing.light) ) {
      entries.push({ ...carryEntry(carriedName(this.rescuing.name)), innate: true, active: false, spends: false, usage: null, state: null });
    }

    // Capturing: a unit that carries a captive is slowed by it as by a Rescued unit, which is read as one more
    // skill of the same kind, named after the captive
    if ( FEO.optional.capturing.enabled && this.captive.held && this.captive.uuid && burdened(this.carry) ) {
      entries.push({ ...carryEntry(captiveName(this.captive.name)), innate: true, active: false, spends: false, usage: null, state: null });
    }

    // A unit that has hold of another, as Death Grip has it, gives the unit it holds what being held comes to:
    // read as one more skill of the same kind, named after the skill it holds with, whose aura is only for
    // that unit and lasts while the two stand next to each other
    const grip = this.parent?.flags?.[FEO.id]?.grip;
    if ( (typeof grip?.token === "string") && grip.token ) {
      entries.push({ ...gripEntry(grip.skill || "Death Grip", grip.token), innate: true, active: false, spends: false, usage: null, state: null });
    }

    // Passive Staff Effects: what the staff a unit has equipped does for it, for as long as it is, is read as
    // one more skill of the same kind, named after the staff
    if ( weapon?.system.category === "staff" ) {
      const held = staffPassiveEntry({
        name: weapon.flags?.[FEO.id]?.sheetName ?? weapon.name,
        effect: weapon.system.effect,
        broken: weapon.system.broken
      }, equippedStaffName(weapon.name));
      if ( held ) entries.push({ ...held, active: false, spends: false, usage: null, state: null });
    }

    // What the weapon in hand gives its unit for as long as it is equipped (the Dodge its Effect adds, and
    // what every weapon of its kind does, as Katanas do) is read as one more skill of the same kind, named
    // after the weapon
    if ( weapon ) {
      const given = weaponEntry({ category: weapon.system.category, effect: weapon.system.effect, broken: weapon.system.broken }, weapon.name);
      if ( given ) entries.push({ ...given, active: false, spends: false, usage: null, state: null });
    }

    // How the unit crosses terrain, as its skills and the changes that last on it have it. It is worked out
    // ahead of where the unit stands, since what its tile is to it hangs on this
    this.crossing = skillCrossing([...entries, ...lasting], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: bareStats,
      weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: shift.transformed,
      waiting: this.waiting
    });

    // Whether its skills spare it the effects of weather, and the Line of Sight it has without the weather:
    // both are known ahead of where it stands, since what the weather of its map gives it comes with that
    this.weather = {
      proof: skillRule([...entries, ...lasting], WEATHERPROOF, {
        hp: this.hp.value,
        hpMax: this.hp.max,
        level: this.level,
        tier: this.classTier,
        stats: bareStats,
        weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
        conditions: this.conditions,
        qualities: this.specialQualities,
        shifted: shift.transformed,
        waiting: this.waiting
      }),
      los: bareStats.los ?? 0
    };

    // Where the unit stands: what it has around it, and what the skills of those units give it. Their auras
    // are read as skills of its own, each named after its skill and the unit it comes from
    const place = (this.parent ? UnitData.standing?.(this.parent) : null) ?? null;
    const auras = place?.auras ?? [];

    // How it moved this turn, for the skills that ask. The MOV it has left is counted from its MOV with what
    // its skills add, so that these are read again where they add any
    const rooted = !!this.defeat.state || Object.keys(this.conditions ?? {}).some((id) => FEO.conditions[id]?.noMove);
    const moving = (mov) => {
      if ( !this.parent || !UnitData.moving ) return null;
      return UnitData.moving(this.parent, { mov: rooted ? 0 : Math.max(mov ?? 0, 0), weapon: weapon?.id ?? "" }) ?? null;
    };
    // The weapons it carries and cannot wield, for a skill that counts them: by its ranks, with the ranks above
    // its own that its skills let it wield, which are only known once they are read
    const cannotWield = (above) => !FEO.weapons.rankCheck ? 0 : items.filter((item) => {
      if ( (item.type !== "weapon") || item.system.broken || item.flags?.[FEO.id]?.summoned ) return false;
      return !canWield(this.proficiencies, item.system, { above, level: wieldLevel(this) }).ok;
    }).length;
    let unusable = cannotWield(0);

    // The turn of the battle it is in and the Phase that is running, for the skills that ask
    const clock = (this.parent ? UnitData.clock?.(this.parent) : null) ?? null;
    const read = (move) => skillTotals([...entries, ...lasting, ...auras], {
      unusable,
      proficiencies: this.proficiencies,
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      gold: this.gold,
      stats: bareStats,
      base: this.bare.base,
      accuracy: this.bare.accuracy,
      waiting: this.waiting,
      weapon: weapon ? { name: weapon.name, ...weapon.system, reach: parseRange(weapon.system.range, bareStats) } : null,
      shield: this.equippedShield?.system.asShield ?? null,
      near: place?.near ?? null,
      move,
      clock,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: shift.transformed
    });
    const move = moving(bareStats.mov);
    let skills = read(move);
    let walked = move;
    if ( move && skills.stats.mov ) {
      walked = moving((bareStats.mov ?? 0) + skills.stats.mov);
      skills = read(walked);
    }
    if ( skills.wield && (cannotWield(skills.wield) !== unusable) ) {
      unusable = cannotWield(skills.wield);
      skills = read(walked);
    }
    this.unusable = unusable;

    // And the weapons and tomes it carries and may wield, for what the units around count of them
    this.wieldable = items.filter((item) => {
      if ( (item.type !== "weapon") || item.system.broken ) return false;
      return !FEO.weapons.rankCheck || canWield(this.proficiencies, item.system, { above: skills.wield ?? 0, level: wieldLevel(this) }).ok;
    }).map((item) => ({ category: item.system.category, name: item.name }));
    sources.unshift(...skills.sources.map((source) => {
      return { label: source.name, localize: false, stats: source.stats, combat: source.combat };
    }));
    if ( skills.sources.length ) total();

    // Stats that are multiplied once everything is added to them, as one that is halved for a while is: what
    // that comes to is one more source, under the names of the skills that do so
    const multiplied = multiplyStats(Object.fromEntries(Object.entries(this.stats).map(([key, stat]) => [key, stat.total])), skills.statTimes, skills.bends?.debuffs);
    if ( Object.keys(multiplied.change).length ) {
      sources.unshift({ label: multiplied.names.join(", "), localize: false, stats: multiplied.change });
      total();
    }
    this.hp.max += skills.hpMax;
    this.haste += skills.haste ?? 0;
    for ( const [key, amount] of Object.entries(skills.abilities ?? {}) ) {
      if ( this.abilities[key] ) this.abilities[key].modifier = (this.abilities[key].modifier ?? 0) + amount;
    }
    // The room it has for skills: its slots, and with Skill Capacity its Capacity Points
    this.skillRoom = skillRoom({
      costs: items.filter((item) => (item.type === "skill") && item.system.equipped && countsAsSkill(item.system.effect))
        .map((item) => item.system.capacity ?? 0),
      slots: skills.slots ?? 0,
      capacity: skills.capacity ?? 0,
      own: this.skillCapacity,
      tier: cls?.system.tier ?? null,
      promotes: (cls?.system.promotesTo?.length ?? 0) > 0,
      level: this.level
    });
    this.skillSlots = this.skillRoom.slots;
    for ( const [key, mode] of Object.entries(skills.calc) ) this.calc[key] = mode;
    this.skills = {
      entries,
      auras,
      timed: lasting,

      // The turn of the battle the unit is in, and what its skills keep count of, by skill (see the timed rules)
      clock,
      counts: skillCounts(this.timed),
      lasting: skills.lasting,
      near: place?.near ?? null,
      received: skills.auras,
      checks: skills.checks,
      applied: skills.applied,
      might: skills.might,
      activation: (skills.combat.activation ?? 0) + support.activation,
      wield: skills.wield ?? 0,
      artCost: skills.artCost ?? 0,
      rules: Array.from(skills.rules),

      // How the skills bend the rules of conditions, which the start of a turn reads
      bends: skills.bends,

      // What they make of blocking (see `rules/blocking.mjs`)
      block: skills.block,

      // Turns they add to the cooldown of every skill the unit uses (see `rules/choices.mjs`)
      cooldowns: skills.cooldowns ?? 0,

      // The combat stats they multiply once everything is added, each under the name of its skill
      combatTimes: (skills.combatTimes ?? []).map(({ skill, key, times }) => ({ label: skill, key, times }))
    };

    // What the unit blocks a physical attack from next to it with, outside of any fight: its Shield, a weapon
    // that acts as one or the weapon it guards with, and how likely. Null when it blocks with nothing
    this.block = guardOf({
      shield: this.equippedShield?.system.asShield ?? null,
      weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
      stats: this.statValues,
      block: skills.block
    });

    // Growth rates that skills raise, on top of what Holy Blood adds. `growthPicks` lists the skills whose
    // growth rates are still to be picked
    const raised = skillGrowths(entries);
    this.growthSkills = raised.bonus;
    this.growthPicks = raised.missing;
    if ( Object.keys(raised.bonus).length ) {
      const bonus = { ...this.growthBonus };
      for ( const [key, amount] of Object.entries(raised.bonus) ) bonus[key] = (bonus[key] ?? 0) + amount;
      this.growthRates = effectiveGrowths(this.growths, bonus);
    }

    // Weight
    const shiftedWt = (shift.mode === "gauge") && shift.active ? form.wt : 0;
    this.wt.total = unitWeight(this.stats.con.total, this.wt.class + shiftedWt);

    // Charm and Intelligence
    for ( const ability of Object.values(this.abilities) ) {
      ability.total = abilityScore(this.stats[ability.source]?.base, ability.increase, ability.boost + (ability.modifier ?? 0));
    }

    // Proficiency progress
    for ( const proficiency of Object.values(this.proficiencies) ) {
      proficiency.next = FEO.wexpToNext[proficiency.rank] ?? null;
    }

    // Ability checks and saving throws
    const values = this.statValues;
    this.checkPointsSpent = 0;
    for ( const [key, check] of Object.entries(this.checks) ) {
      const extra = FEO.abilityChecks[key].extra;
      check.bonus = abilityBonus(values[check.stat], values.luk, check.points, extra ? values[extra] : 0);
      this.checkPointsSpent += check.points;
    }
    this.checkPointsPerLevel = abilityPointsPerLevel(values.cha, values.int, values.luk);
    this.checkPointLimit = 5 + this.level;

    // How units stand in its way, and it in theirs, as its skills and the changes that last on it have it: read
    // by the map as it works out where units can go. Its numbers may be read from the unit's level, its Weight
    // and its ability checks, so it is worked out once those are
    this.passing = skillPassing([...(this.skills?.entries ?? []), ...(this.skills?.timed ?? [])], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: values,
      weight: this.wt.total,
      checks: Object.fromEntries(Object.entries(this.checks).map(([key, check]) => [key, check.bonus])),
      weapon: this.equippedWeapon ? { name: this.equippedWeapon.name, ...this.equippedWeapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: !!this.shift?.transformed,
      waiting: this.waiting
    });

    // Whether it may move again after an Action, as Canto has it, and how it curbs that for its enemies: read
    // by the map as an Action is taken
    this.canto = skillCanto([...(this.skills?.entries ?? []), ...(this.skills?.timed ?? [])], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: values,
      weapon: this.equippedWeapon ? { name: this.equippedWeapon.name, ...this.equippedWeapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: !!this.shift?.transformed,
      waiting: this.waiting
    });

    // What its skills let it do with gear and with the things on a map: steal, open doors and chests without
    // a key, disarm traps, destroy Villages, buy for less, make items as a map starts. What it wears adds to
    // them: an accessory is worn while it is carried (see `rules/stealing.mjs`)
    this.knacks = skillKnacks([...(this.skills?.entries ?? []), ...(this.skills?.timed ?? [])], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: values,
      weapon: this.equippedWeapon ? { name: this.equippedWeapon.name, ...this.equippedWeapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: !!this.shift?.transformed,
      waiting: this.waiting
    });
    for ( const item of this.parent?.items ?? [] ) {
      if ( (item.type !== "gear") || !item.system.equip || item.system.isShield ) continue;
      const gives = gearKnacks(item.system.effect);
      if ( gives ) addKnacks(this.knacks, gives, { skill: item.name });
    }

    // What its skills make of its Shove: how far it pushes, and whether shoving an enemy takes movement in
    // place of its Action. Read by the map as the unit shoves
    this.shoving = skillShove([...(this.skills?.entries ?? []), ...(this.skills?.timed ?? [])], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: values,
      weapon: this.equippedWeapon ? { name: this.equippedWeapon.name, ...this.equippedWeapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: !!this.shift?.transformed,
      waiting: this.waiting
    });

    // What it does for its side outside of its own turn, as its skills and the stances it is in have it: the
    // allies it fights in the place of, the hits on an ally it takes or turns back, and what it reacts to.
    // Read by the map as an enemy attacks or moves
    const standing = skillStanding([...(this.skills?.entries ?? []), ...(this.skills?.timed ?? [])], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      tier: this.classTier,
      gender: this.profile?.gender ?? "",
      bestRank: this.bestRank,
      stats: values,
      weapon: this.equippedWeapon ? { name: this.equippedWeapon.name, ...this.equippedWeapon.system } : null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: !!this.shift?.transformed,
      waiting: this.waiting
    });
    this.guard = standing.guard;
    this.wards = standing.wards;
    this.reacts = standing.reacts;

    // And the allies around it that it shelters: an enemy that stands near it attacks none of them
    this.shelters = standing.shelters;

    // Defeat: how long the unit stays down, what is taken off damage past 0 HP, and whether it must now choose
    const defeat = this.defeat;
    defeat.resilience = resilience(...FEO.defeat.resilience.checks.map((key) => this.checks[key]?.bonus));
    defeat.down = defeat.state === "incapacitated";
    // A unit left at 0 HP with nothing said of what became of it is out of the fight all the same
    // So is one that an ally carries, for as long as it is carried: it rides on that ally's token
    defeat.carried = !!this.rescued.by;
    defeat.out = outOfFight({ state: defeat.state, hp: this.hp.value, hpMax: this.hp.base, carried: defeat.carried });
    defeat.gone = leavesMap(defeat.state, { carried: defeat.carried });
    defeat.fate = FEO.defeat.enabled ? fateReasons({
      hp: this.hp.value,
      hpMax: this.hp.base,
      injuries: this.injuries,
      defeat
    }) : [];

    // Stagger: the bar as it stands, which follows the unit's HP until it is made; whether the unit is
    // Staggered; and what the damage it takes is then multiplied by
    const stagger = this.stagger;
    stagger.used = staggerInUse();
    stagger.sized = (this._source.stagger?.max ?? 0) > 0;
    Object.assign(stagger, staggerOf(this._source.stagger, this.hp.value));
    stagger.staggered = stagger.used && (stagger.turns > 0);
    stagger.times = staggerTimes(stagger);

    // Combat stats with the equipped weapon
    this.modifiers = sources.filter((source) => source.combat).map((source) => ({
      label: source.label,
      localize: source.localize,
      ...source.combat
    }));
    this.combat = this.combatWith(this.equippedWeapon?.system ?? null);
  }

  /* -------------------------------------------- */

  /**
   * Gather the named things that adjust this unit's stats or combat stats, apart from its skills: conditions
   * and support partners in range.
   * @param {Item[]} items
   * @returns {{label: string, localize: boolean, stats?: object, combat?: object}[]}
   */
  #collectSources(items) {
    const sources = [];

    // Conditions, some of which grow or shrink with the turns they have left
    for ( const { id, stats, combat } of conditionModifiers(this.conditions) ) {
      sources.push({
        label: `FEO.Condition.${id}`,
        localize: true,
        stats: stats ?? undefined,
        combat: combat ?? undefined
      });
    }

    // Supports: what each partner gives at its rank, and the combat stats those in range add to. Endurance,
    // Haste and the Skill Activation rate are not combat stats, and are summed where the unit is prepared
    for ( const bond of this.bonds ) {
      bond.level = FEO.supportRanks[bond.rank]?.level ?? 0;
      bond.bonus = supportBonus(FEO.affinityBoosts[this.affinity], FEO.affinityBoosts[bond.affinity], bond.level);
      if ( !bond.inRange ) continue;
      const { atk, hit, dodge, critical, critAvoid } = bond.bonus;
      if ( !atk && !hit && !dodge && !critical && !critAvoid ) continue;
      sources.push({
        label: bond.name || "FEO.Bond.unnamed",
        localize: !bond.name,
        support: true,
        combat: { damage: atk, hit, dodge, critical, critAvoid }
      });
    }

    // Glory: a unit whose Affinity counts at all times has its boosts once over, with nobody near
    if ( this.glory.extras?.resonance ) {
      const own = FEO.affinityBoosts[this.affinity] ?? {};
      const combat = {
        damage: Math.floor(own.atk ?? 0), hit: Math.floor(own.hit ?? 0), dodge: Math.floor(own.dodge ?? 0),
        critical: Math.floor(own.critical ?? 0), critAvoid: Math.floor(own.critAvoid ?? 0)
      };
      if ( Object.values(combat).some(Boolean) ) {
        sources.push({ label: "FEO.Optional.glory.powers.affinityResonance.name", localize: true, combat });
      }
    }

    // Partners in a Bond Support gain more while side by side
    for ( const bond of this.bonds ) {
      const bonus = kinBonus(bond);
      if ( bonus ) sources.push({ label: "FEO.Bond.kinBonus", localize: true, support: true, combat: bonus });
    }

    // Optional Modules: Leadership Stars, and the kills made with the weapon in hand
    sources.push(...optionalSources(this, this.equippedWeapon?.system ?? null));

    // The Battalion the unit commands, under its own name
    const granted = this.battalion?.granted;
    if ( granted && (Object.keys(granted.stats).length || Object.keys(granted.combat).length) ) {
      sources.push({ label: this.battalion.name, localize: false, stats: granted.stats, combat: granted.combat });
    }
    return sources;
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * The Item that is this unit's current class, if it has one. A unit without one still has a class name.
   * @type {Item|null}
   */
  get classItem() {
    if ( !this.classId ) return null;
    const items = this.parent?.items;
    if ( !items ) return null;
    return items.find((item) => (item.type === "class") && (item.id === this.classId)) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * The weapon this unit currently has equipped, if any.
   * @type {Item|null}
   */
  get equippedWeapon() {
    const items = this.parent?.items;
    if ( !items ) return null;
    return items.find((item) => (item.type === "weapon") && item.system.equipped) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * The Shield this unit currently has equipped, if any. One that is out of uses blocks nothing, and is put
   * away as it breaks. A unit that a lasting change keeps from equipping Shields has none for as long as that
   * lasts: the Shield it had is in its hands again once the change is over.
   * @type {Item|null}
   */
  get equippedShield() {
    const items = this.parent?.items;
    if ( !items || this.shieldsBarred ) return null;
    return items.find((item) => (item.type === "gear") && item.system.equipped && item.system.isShield && !item.system.spent) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Is this unit kept from having a Shield equipped, by a change that lasts on it?
   * @type {boolean}
   */
  get shieldsBarred() {
    return shieldsBarred(this.timed);
  }

  /* -------------------------------------------- */

  /**
   * Every stat total by key, including Charm and Intelligence.
   * @type {Record<string, number>}
   */
  get statValues() {
    const values = {};
    for ( const [key, stat] of Object.entries(this.stats) ) {
      values[key] = stat.total ?? statTotal(stat.base, stat.boost);
    }
    for ( const [key, ability] of Object.entries(this.abilities) ) {
      values[key] = ability.total
        ?? abilityScore(this.stats[ability.source]?.base, ability.increase, ability.boost + (ability.modifier ?? 0));
    }
    return values;
  }

  /* -------------------------------------------- */

  /**
   * Every stat total as the unit fights with it: the same as its stat totals, except for a unit that a stone
   * transforms for each combat.
   * @type {Record<string, number>}
   */
  get battleValues() {
    const values = this.statValues;
    for ( const [key, bonus] of Object.entries(this.shift?.inCombat ?? {}) ) {
      if ( key in values ) values[key] = Math.max(values[key] + bonus, 0);
    }
    return values;
  }

  /* -------------------------------------------- */

  /**
   * The bonuses this unit earns for mastering the weapon type of a given weapon.
   * @param {object|null} weapon    Weapon system data
   * @returns {import("../rules/combat-stats.mjs").CombatModifier|null}
   */
  masteryFor(weapon) {
    const proficiency = FEO.weaponCategories[weapon?.category]?.proficiency;
    const rank = countedRank(this.proficiencies[proficiency]?.rank, this.weaponLevel?.used ? this.weaponLevel.rank : null);
    const table = proficiency === "staff" ? FEO.mastery.staff : FEO.mastery.weapon;
    const bonus = table[rank];
    return bonus ? { label: "FEO.Term.mastery", localize: true, ...bonus } : null;
  }

  /* -------------------------------------------- */

  /**
   * Compute this unit's combat stats as if wielding a given weapon.
   * @param {object|null} weapon    Weapon system data, or null when unarmed
   * @returns {import("../rules/combat-stats.mjs").CombatBreakdown}
   */
  combatWith(weapon) {
    const mastery = this.masteryFor(weapon);
    const modifiers = mastery ? [mastery, ...(this.modifiers ?? [])] : (this.modifiers ?? []);

    // The Shield it has equipped adds to its Weight as Attack Speed is worked out, armed or not
    const burden = this.equippedShield?.system.shield.weight ?? 0;
    const held = !burden ? weapon : weapon ? { ...weapon, weight: (weapon.weight ?? 0) + burden } : { weight: burden };
    return computeCombat({ stats: this.battleValues, boosts: this.combatBoosts, calc: this.calc, modifiers, times: this.skills?.combatTimes ?? [] }, held);

  }
}

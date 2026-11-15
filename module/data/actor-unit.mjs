import { FEO } from "../config.mjs";
import { authorityBonus, authorityNext, authorityRank, battalionBonuses, hasRetreated } from "../rules/battalions.mjs";
import { abilityScore, computeCombat, statTotal, unitWeight } from "../rules/combat-stats.mjs";
import { carryEntry } from "../rules/capturing.mjs";
import { resolveCaps } from "../rules/classes.mjs";
import { parseRange } from "../rules/combat.mjs";
import { countedRank, levelRank } from "../rules/weapons.mjs";
import { conditionModifiers, readConditions } from "../rules/conditions.mjs";
import { deathThreshold, fateReasons, resilience, woundThreshold } from "../rules/defeat.mjs";
import { skillGrowths } from "../rules/earnings.mjs";
import {
  affinityEntry, atLevelLimit, bloodGrowths, bloodProficiencies, effectiveGrowths, levelLimit, moduleCap, optionalSources,
  powerEntries, powerExtras, skillRoom
} from "../rules/optional.mjs";
import { abilityBonus, abilityPointsPerLevel, supportBonus, supportTotals } from "../rules/progression.mjs";
import { formBonuses, gaugeProfile, shiftBends, shiftMode, shiftPercent, shiftedBonuses, transformsLeft } from "../rules/shifting.mjs";
import { countsAsSkill, effectsOf, skillTotals } from "../rules/skills.mjs";
import { kinBonus } from "../rules/supports.mjs";
import { TIMED_ENDS, timedEntries } from "../rules/timed.mjs";

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
 * What carrying a captive goes by among the unit's skills and numbers: "Captive: Brigand".
 * @param {string} name     The captive's name
 * @returns {string}
 */
function captiveName(name) {
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format("FEO.Optional.capturing.carrying", { name }) : name;
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
        fades: new BooleanField()
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

      // The Character Creator's record of what was chosen for the unit, read by `module/rules/creation.mjs`
      creation: new ObjectField()
    };
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  /** @override */
  prepareDerivedData() {
    const items = Array.from(this.parent?.items ?? []);
    const statuses = this.parent?.statuses ?? new Set();

    // Health: under the Incapacitation system, Wounds and Injuries lower maximum HP, and every few Wounds add
    // a Grave Wound. A world that does not play with it keeps what a unit was given but counts none of it
    const health = FEO.defeat.enabled;
    this.graveWounds = health ? Math.floor(this.wounds / FEO.woundsPerGraveWound) : 0;
    this.hp.base = this._source.hp.max;
    this.hp.lost = health ? (this.wounds * FEO.woundPenalty) + (this.injuries * FEO.injuryPenalty) : 0;
    this.hp.max = Math.max(this.hp.base - this.hp.lost, 0);
    this.hp.woundThreshold = health ? woundThreshold(this.hp.base) : 0;
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
    shift.bends = shiftBends(items.filter((item) => (item.type === "skill") && item.system.equipped && (item.system.automate !== false)).map((item) => {
      return { name: item.name, active: !!item.system.usage?.kind && !!item.system.state?.active, effects: effectsOf(item.system) };
    }));
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
    const entries = items.filter((item) => (item.type === "skill") && item.system.equipped).map((item) => {
      const { stats, combat, effects, choice, automate, nihil, usage, state } = item.system;
      return {
        id: item.id,
        name: item.name,
        nihil,
        choice,
        effects: effectsOf(automate === false ? { stats, combat } : { stats, combat, effects, choice }),

        // A skill that is chosen when to activate: is it switched on, and does a fight spend it?
        active: !!usage?.kind && !!state?.active,
        spends: usage?.kind === "declare",
        usage: usage?.kind ? { ...usage } : null,
        state: usage?.kind ? { ...state } : null
      };
    });

    // Additional Affinity Effects: what the unit's Affinity builds into it is read as one more skill, named
    // after the Affinity, which Nihil does not cancel and which takes none of its skill slots
    // A unit whose Affinity counts at all times has that effect whether or not the world plays with them
    const innate = affinityEntry(this.affinity, affinityEffectName(this.affinity),
      extras.resonance ? { config: { ...FEO.optional.affinityEffects, enabled: true } } : {});
    if ( innate ) entries.push({ ...innate, active: false, spends: false, usage: null, state: null });

    // Glory: each Power the unit holds is one more skill of the same kind, named after the Power
    for ( const power of powerEntries(this.glory.powers, powerName) ) {
      entries.push({ ...power, active: false, spends: false, usage: null, state: null });
    }

    // Capturing: a unit that carries a captive is slowed by it as by a Rescued unit, which is read as one more
    // skill of the same kind, named after the captive
    if ( FEO.optional.capturing.enabled && this.captive.held && this.captive.uuid ) {
      entries.push({ ...carryEntry(captiveName(this.captive.name)), active: false, spends: false, usage: null, state: null });
    }

    // Where the unit stands: what it has around it, and what the skills of those units give it. Their auras
    // are read as skills of its own, each named after its skill and the unit it comes from
    const place = (this.parent ? UnitData.standing?.(this.parent) : null) ?? null;
    const auras = place?.auras ?? [];
    const lasting = timedEntries(this.timed);
    const skills = skillTotals([...entries, ...lasting, ...auras], {
      hp: this.hp.value,
      hpMax: this.hp.max,
      level: this.level,
      gold: this.gold,
      stats: bareStats,
      base: this.bare.base,
      accuracy: this.bare.accuracy,
      waiting: this.waiting,
      weapon: weapon ? { name: weapon.name, ...weapon.system, reach: parseRange(weapon.system.range, bareStats) } : null,
      near: place?.near ?? null,
      conditions: this.conditions,
      qualities: this.specialQualities,
      shifted: shift.transformed
    });
    sources.unshift(...skills.sources.map((source) => {
      return { label: source.name, localize: false, stats: source.stats, combat: source.combat };
    }));
    if ( skills.sources.length ) total();
    this.hp.max += skills.hpMax;
    this.haste += skills.haste ?? 0;
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
      bends: skills.bends
    };

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

    // Defeat: how long the unit stays down, what is taken off damage past 0 HP, and whether it must now choose
    const defeat = this.defeat;
    defeat.resilience = resilience(...FEO.defeat.resilience.checks.map((key) => this.checks[key]?.bonus));
    defeat.down = defeat.state === "incapacitated";
    defeat.out = ["retreated", "dead", "captured"].includes(defeat.state);
    defeat.fate = FEO.defeat.enabled ? fateReasons({
      hp: this.hp.value,
      hpMax: this.hp.base,
      injuries: this.injuries,
      defeat
    }) : [];

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
      if ( bonus ) sources.push({ label: "FEO.Bond.kinBonus", localize: true, combat: bonus });
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
    return computeCombat({ stats: this.battleValues, boosts: this.combatBoosts, calc: this.calc, modifiers }, weapon);
  }
}

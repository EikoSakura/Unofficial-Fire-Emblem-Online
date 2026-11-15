import { FEO } from "../config.mjs";
import { chanceOf, rolledProc } from "../rules/skills.mjs";
import { USAGE_KINDS, USAGE_PERIODS } from "../rules/skill-usage.mjs";

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
 * The data model for a Skill: a power or technique a unit can equip.
 */
export default class SkillData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      kind: new StringField({ required: true, choices: Object.keys(FEO.skillKinds), initial: "generic" }),
      equipped: new BooleanField({ initial: true }),
      effect: new StringField({ required: true, blank: true }),
      prerequisite: new StringField({ required: true, blank: true }),
      capacity: integer(0, { min: 0 }),

      // What the markers after a skill's name on the reference sheet say about it
      chosen: new BooleanField(),
      scroll: new StringField({ required: true, choices: Object.keys(FEO.skillScrolls), initial: "any" }),
      nihil: new BooleanField(),

      // A chance to activate, as a percentage of a stat. A blank stat means the skill is always on or chosen.
      activation: new SchemaField({
        stat: new StringField({ required: true, blank: true, choices: Object.keys(FEO.activationStats) }),
        divisor: integer(1, { min: 1 })
      }),

      // What the system does with the skill by itself, read by `module/rules/skills.mjs`: when each effect
      // applies and what it adds or which combat rule it bends. `choice` is the variant taken of a skill that
      // offers several, and `automate` switches the effects off for a skill the table would rather run by hand
      effects: new ArrayField(new ObjectField()),
      choice: new StringField({ required: true, blank: true }),
      automate: new BooleanField({ initial: true }),

      // How a skill that is chosen when to activate is used, and where it stands, as `module/rules/
      // skill-usage.mjs` explains: declared for a fight, switched on and off, or used as an action; its
      // cooldown, how long it lasts and how often it can be used
      usage: new SchemaField({
        kind: new StringField({ required: true, blank: true, choices: USAGE_KINDS }),
        cooldown: integer(0, { min: 0 }),
        lasts: integer(0, { min: 0 }),
        uses: integer(0, { min: 0 }),
        per: new StringField({ required: true, blank: true, choices: USAGE_PERIODS })
      }),
      state: new SchemaField({
        active: new BooleanField(),
        cooldown: integer(0, { min: 0 }),
        lasting: integer(0, { min: 0 }),
        used: integer(0, { min: 0 })
      }),

      // Flat adjustments granted while the skill is equipped
      stats: new SchemaField(Object.fromEntries(Object.keys(FEO.stats).map((key) => [key, integer(0)]))),
      combat: new SchemaField(Object.fromEntries(Object.keys(FEO.combatBoosts).map((key) => [key, integer(0)]))),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /**
   * This skill's chance to activate for its owner, in percent, or null if it does not roll to activate.
   * The owner's Skill Activation rate is part of it. A skill the system rolls for shows the chance it is
   * rolled with; any other shows the chance of its activation fields. Either is read as Alternate Skill
   * Activation has it where the world plays with that module.
   * @type {number|null}
   */
  get chance() {
    const owner = this.parent?.actor?.system;
    if ( !owner?.stats ) return null;
    const options = {
      activation: owner.skills?.activation ?? 0,
      always: !!owner.skills?.rules?.includes("alwaysActivate")
    };
    const self = { hp: owner.hp?.value ?? 0, hpMax: owner.hp?.max ?? 0, level: owner.level, stats: owner.statValues };

    const proc = rolledProc(this);
    if ( !proc ) return null;

    // The activation fields, which wait for no moment, name a stat the unit must have
    if ( (proc.on === undefined) && (self.stats[proc.stat] === undefined) ) return null;
    return chanceOf(proc, self, null, options);
  }
}

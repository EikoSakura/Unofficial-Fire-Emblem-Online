import { FEO } from "../config.mjs";
import { COVERAGE, chanceOf, rolledProc } from "../rules/skills.mjs";
import { IMITATED_FLAG, IMITATION_FLAG, speaksOfImitation } from "../rules/imitation.mjs";
import { SYNC_FLAG, syncedOff } from "../rules/level-sync.mjs";
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

      // What the skill has its unit pick as it is learnt, where its effects do not say so by themselves (see
      // `module/rules/picks.mjs`); what is picked is kept as `choice`. `raises` counts the times the skill has
      // been raised in place of another, as Authority is on promoting
      picks: new ArrayField(new ObjectField()),
      raises: integer(0, { min: 0 }),
      automate: new BooleanField({ initial: true }),

      // How far the system applies the Effect by itself, as the skills build works it out: all of it ("done"),
      // some of it ("part", with `left` saying what the table still does by hand) or none ("text"). `note`
      // says how the system reads the skill. Blank on a skill that did not come from the skills compendium
      coverage: new SchemaField({
        state: new StringField({ required: true, blank: true, choices: COVERAGE }),
        left: new StringField({ required: true, blank: true }),
        note: new StringField({ required: true, blank: true })
      }),

      // How a skill that is chosen when to activate is used, and where it stands, as `module/rules/
      // skill-usage.mjs` explains: declared for a fight, switched on and off, or used as an action; its
      // cooldown, how long it lasts and how often it can be used
      usage: new SchemaField({
        kind: new StringField({ required: true, blank: true, choices: USAGE_KINDS }),
        cooldown: integer(0, { min: 0 }),
        lasts: integer(0, { min: 0 }),
        uses: integer(0, { min: 0 }),
        per: new StringField({ required: true, blank: true, choices: USAGE_PERIODS }),

        // For an action: using it is not the unit's Action; it is used before the unit moves; and it may be
        // used while on cooldown, at the price of a condition
        free: new BooleanField(),
        unmoved: new BooleanField(),
        early: new ObjectField({ required: false, nullable: true, initial: null }),

        // It may be used beyond the uses it has, each such use starting a cooldown of its own
        over: new ObjectField({ required: false, nullable: true, initial: null })
      }),
      state: new SchemaField({
        active: new BooleanField(),
        cooldown: integer(0, { min: 0 }),
        lasting: integer(0, { min: 0 }),
        used: integer(0, { min: 0 }),
        early: new BooleanField(),

        // What its unit picked for a fight: the steps of a trade or of something spent, and a stat (see
        // `module/rules/choices.mjs`)
        picked: new ObjectField()
      }),

      // Flat adjustments granted while the skill is equipped
      stats: new SchemaField(Object.fromEntries(Object.keys(FEO.stats).map((key) => [key, integer(0)]))),
      combat: new SchemaField(Object.fromEntries(Object.keys(FEO.combatBoosts).map((key) => [key, integer(0)]))),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /**
   * A unit that imitates another has that unit's skills in place of its own: its own are set aside for as long
   * as it does, all but those that speak of imitation, which are what it imitates with. A skill that is set
   * aside counts as not equipped while its unit is prepared; what is saved of it stays as it is.
   * @override
   */
  prepareBaseData() {
    const item = this.parent;
    const actor = item?.actor ?? null;
    this.setAside = false;

    // So is a skill its unit did not have yet at the Level it is synced to (see `rules/level-sync.mjs`)
    this.syncedOff = syncedOff(actor?.flags?.[FEO.id]?.[SYNC_FLAG], item?.id);
    if ( this.syncedOff ) {
      this.setAside = !!this.equipped;
      this.equipped = false;
      return;
    }
    if ( !actor?.flags?.[FEO.id]?.[IMITATION_FLAG] || item.flags?.[FEO.id]?.[IMITATED_FLAG] ) return;
    if ( speaksOfImitation(this.effects) ) return;
    this.setAside = !!this.equipped;
    this.equipped = false;
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
    const self = { hp: owner.hp?.value ?? 0, hpMax: owner.hp?.max ?? 0, level: owner.level, tier: owner.classTier, stats: owner.statValues };

    const proc = rolledProc(this);
    if ( !proc ) return null;

    // The activation fields, which wait for no moment, name a stat the unit must have
    if ( (proc.on === undefined) && (self.stats[proc.stat] === undefined) ) return null;
    return chanceOf(proc, self, null, options);
  }
}

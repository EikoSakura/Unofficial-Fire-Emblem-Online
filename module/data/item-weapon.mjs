import { FEO } from "../config.mjs";

const { BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

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
 * The data model for a Weapon: anything a unit attacks with, including tomes and staves.
 */
export default class WeaponData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      category: new StringField({ required: true, choices: Object.keys(FEO.weaponCategories), initial: "sword" }),
      might: integer(0),
      hit: integer(0),
      crit: integer(0),
      range: new StringField({ required: true, blank: true, initial: "1" }),
      weight: integer(0, { min: 0 }),
      uses: new SchemaField({
        value: integer(0, { min: 0 }),
        max: integer(0, { min: 0 })
      }),
      rank: new StringField({ required: true, choices: Object.keys(FEO.ranks), initial: "E" }),

      // Weapon Level, the number beside the Rank on the reference sheet. Empty where the sheet gives none.
      level: new NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null }),
      cost: integer(0, { min: 0 }),
      wexp: new NumberField({ required: true, nullable: false, min: 0, initial: 1 }),
      damageStat: new StringField({ required: true, choices: Object.keys(FEO.damageStats), initial: "str" }),

      // The values a staff uses to counter-attack at 1 range: the numbers the sheet gives in parentheses.
      // Empty where the sheet gives none.
      counter: new SchemaField({
        might: new NumberField({ required: true, nullable: true, integer: true, initial: null }),
        hit: new NumberField({ required: true, nullable: true, integer: true, initial: null }),
        crit: new NumberField({ required: true, nullable: true, integer: true, initial: null })
      }),
      effect: new StringField({ required: true, blank: true }),

      // Kills made with this weapon, which the Weapon Kill Critical Bonus of the Optional Modules counts
      kills: integer(0, { min: 0 }),
      equipped: new BooleanField(),
      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /**
   * A weapon that is taken in hand has yet to attack: what a skill has it take from the weapon its unit attacked
   * with before waits for its first attack again (see `module/rules/triangle.mjs`).
   * @override
   */
  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if ( allowed === false ) return false;
    if ( (changes.system?.equipped === true) && !this.equipped && this.parent?.getFlag?.(FEO.id, "swung") ) {
      foundry.utils.setProperty(changes, `flags.${FEO.id}.swung`, false);
    }
    return allowed;
  }

  /* -------------------------------------------- */

  /**
   * The proficiency this weapon is wielded with, or null if its category has none.
   * @type {string|null}
   */
  get proficiency() {
    return FEO.weaponCategories[this.category]?.proficiency ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Is this weapon out of uses?
   * @type {boolean}
   */
  get broken() {
    return (this.uses.max > 0) && (this.uses.value <= 0);
  }
}

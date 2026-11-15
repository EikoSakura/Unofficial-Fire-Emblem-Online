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
 * The data model for a carried Item: healing supplies, keys, stat boosters and other things a unit can Use.
 */
export default class GearData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      effect: new StringField({ required: true, blank: true }),
      uses: new SchemaField({
        value: integer(1, { min: 0 }),
        max: integer(1, { min: 0 })
      }),
      cost: integer(0, { min: 0 }),

      // Worn or carried for its effect rather than Used: the sheet lists "Equip" in place of a number of uses
      equip: new BooleanField(),

      // HP restored to the user when the item is Used. Zero for items that do something else.
      restore: integer(0, { min: 0 }),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /**
   * Is this item out of uses?
   * @type {boolean}
   */
  get spent() {
    return (this.uses.max > 0) && (this.uses.value <= 0);
  }
}

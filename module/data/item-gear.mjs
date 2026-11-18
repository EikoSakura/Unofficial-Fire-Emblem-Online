import { readShield } from "../rules/blocking.mjs";

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

      // A Shield (see `rules/blocking.mjs`): its Block chance before DEX and what DEX is divided by, what it
      // blocks and by how much, what it adds to Weight as Attack Speed is worked out, the uses a block of a
      // physical attack costs it, and its chance to parry. An item with nothing in `blocks` is no Shield
      shield: new SchemaField({
        chance: integer(0, { min: 0 }),
        dexDiv: integer(0, { min: 0 }),
        blocks: new ArrayField(new ObjectField()),
        weight: integer(0, { min: 0 }),
        wearPhysical: integer(1, { min: 1 }),
        parry: new SchemaField({
          chance: integer(0, { min: 0 }),
          dexDiv: integer(0, { min: 0 }),
          uses: integer(0, { min: 0 })
        })
      }),

      // Is it equipped? Only a Shield is, one at a time
      equipped: new BooleanField(),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /** @override */
  prepareBaseData() {
    // A Shield made before Shields were read into fields is read from its Effect
    if ( !this.shield.blocks.length && this.equip ) {
      const read = readShield(this.effect);
      if ( read ) Object.assign(this.shield, { ...read, parry: read.parry ?? { chance: 0, dexDiv: 0, uses: 0 } });
    }
  }

  /* -------------------------------------------- */

  /**
   * Is this item a Shield?
   * @type {boolean}
   */
  get isShield() {
    return this.shield.blocks.length > 0;
  }

  /* -------------------------------------------- */

  /**
   * This Shield as the rules of blocking read it, or null for any other item.
   * @type {import("../rules/blocking.mjs").Shield|null}
   */
  get asShield() {
    if ( !this.isShield ) return null;
    const { chance, dexDiv, blocks, weight, wearPhysical, parry } = this.shield;
    return {
      id: this.parent?.id ?? "",
      name: this.parent?.name ?? "",
      chance,
      dexDiv,
      blocks: blocks.map((rule) => ({ ...rule })),
      weight,
      wearPhysical,
      parry: (parry.chance > 0) ? { ...parry } : null,
      uses: { value: this.uses.value, max: this.uses.max }
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

import { FEO } from "../config.mjs";
import { writtenFirstRank } from "../rules/classes.mjs";

const { ArrayField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

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
 * An integer that may be left empty, for a value the class does not give.
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
 * The data model for a Class, laid out as the Class Sheet lists one.
 *
 * A starting class fills in `base`; a class that is promoted into fills in `gains`. Skills, Special Qualities
 * and the classes it promotes to are kept as the names the Class Sheet gives. Lines of a class block that have
 * no field of their own, such as a Laguz's Shift Gauge, go in `notes`.
 */
export default class ClassData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      tier: new StringField({ required: true, choices: Object.keys(FEO.classTiers), initial: "base" }),
      race: new StringField({ required: true, choices: Object.keys(FEO.races), initial: "beorc" }),

      // Stats of a new unit of this class. Empty where the Class Sheet gives no single number.
      base: keyed(FEO.classStats, () => optional({ min: 0 })),

      // Added to a unit's stats when it promotes into this class
      gains: keyed(FEO.classStats, () => integer(0)),

      // Class Weight. A promoted class lists its own Weight, not a gain.
      wt: integer(0),

      // Values while transformed, for classes that list a second number. Kept for reference.
      transformed: keyed([...FEO.classStats, "wt"], () => optional()),

      // Stat caps. Empty where the class sets none.
      caps: keyed(FEO.classStats, () => optional({ min: 0 })),

      // Proficiencies granted. `choose` is how many of the options a unit takes; 0 means all of them.
      // `firstRank` is the rank one of them starts at for a new unit, left blank for the usual one.
      proficiencies: new SchemaField({
        options: new ArrayField(new StringField({ required: true, choices: Object.keys(FEO.proficiencies) })),
        choose: integer(0, { min: 0 }),
        firstRank: new StringField({ required: true, blank: true, choices: Object.keys(FEO.ranks), initial: "" }),
        note: text()
      }),

      skills: new SchemaField({
        starting: text(),
        promotion: text(),
        occult: text(),
        mastery: text()
      }),

      specialQualities: text(),

      // The classes this one promotes to. A link is used when present; otherwise the class is found by name.
      promotesTo: new ArrayField(new SchemaField({
        name: text(),
        uuid: text()
      })),

      notes: new ArrayField(new SchemaField({
        label: text(),
        value: text()
      })),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /** @override */
  static migrateData(source) {
    // A class saved before `firstRank` was kept says it only in the line as written
    const proficiencies = source.proficiencies;
    if ( proficiencies && (proficiencies.firstRank === undefined) ) {
      const rank = writtenFirstRank(proficiencies.note);
      if ( rank ) proficiencies.firstRank = rank;
    }
    return super.migrateData(source);
  }

  /* -------------------------------------------- */

  /**
   * Is this a class a unit starts in, as opposed to one it is promoted into?
   * @type {boolean}
   */
  get isStarting() {
    return FEO.classTiers[this.tier].order <= FEO.classTiers.base.order;
  }

  /* -------------------------------------------- */

  /**
   * Does this class promote, as opposed to levelling on and learning its skills at set levels?
   * @type {boolean}
   */
  get promotes() {
    return this.promotesTo.length > 0;
  }
}

import { FEO } from "../config.mjs";
import { battalionBonuses, bonusKeys, hasRetreated, readGambit } from "../rules/battalions.mjs";

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
 * A required number that may carry a fraction, as what a Battalion gains "per level up" does.
 * @param {object} [options]
 * @returns {NumberField}
 */
function amount(options = {}) {
  return new NumberField({ required: true, nullable: false, initial: 0, ...options });
}

/**
 * A single line of free text.
 * @param {object} [options]
 * @returns {StringField}
 */
function text(options = {}) {
  return new StringField({ required: true, blank: true, ...options });
}

/**
 * The data model for a Battalion: a squadron a unit commands, with the Battalions & Gambits module. It adds to
 * its commander's numbers, has HP of its own, levels, and brings one Gambit.
 */
export default class BattalionData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const config = FEO.optional.battalions;
    return {
      // The Authority rank a unit needs to command it, and the Special Quality it has, if any
      rank: new StringField({ required: true, choices: config.ranks, initial: config.ranks[0] }),
      quality: text(),

      // Battalion HP, which the list of Battalions gives when full
      hp: new SchemaField({
        value: integer(0, { min: 0 }),
        max: integer(0, { min: 0 })
      }),

      // Its level, and the EXP it has toward the next
      level: integer(1, { min: 1, max: config.levels.max }),
      exp: integer(0, { min: 0 }),

      // What it adds to its commander: for each number what it starts at and what it gains per level up
      bonuses: new SchemaField(Object.fromEntries(bonusKeys().map((key) => [key, new SchemaField({
        base: amount(),
        perLevel: amount({ min: 0 })
      })]))),

      cost: integer(0, { min: 0 }),

      // Assigned: the unit that carries it commands it. A unit commands one Battalion at a time
      equipped: new BooleanField(),

      // Its Gambit, written as the list of Gambits writes them. `module/rules/battalions.mjs` reads from the
      // Effect what the system applies by itself. `area` is the Target Area, which the table lays out
      gambit: new SchemaField({
        name: text(),
        kind: new StringField({ required: true, choices: Object.keys(config.gambit.kinds), initial: "offensive" }),
        might: integer(0),
        hit: integer(0),
        uses: new SchemaField({
          value: integer(0, { min: 0 }),
          max: integer(0, { min: 0 })
        }),
        range: text({ initial: "1" }),
        area: text(),
        effect: text()
      }),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /** @override */
  async _preCreate(data, options, user) {
    // A Battalion that changes hands is nobody's yet: the unit that receives it is assigned it anew, so that
    // its Authority and its Special Qualities are asked about
    if ( this.equipped ) this.parent.updateSource({ "system.equipped": false });
    return super._preCreate(data, options, user);
  }

  /* -------------------------------------------- */

  /**
   * Has the Battalion been defeated? It has retreated then, and gives nothing until it is replenished.
   * @type {boolean}
   */
  get retreated() {
    return hasRetreated(this);
  }

  /* -------------------------------------------- */

  /**
   * What the Battalion adds to its commander at its level.
   * @type {{stats: Record<string, number>, abilities: Record<string, number>, combat: Record<string, number>}}
   */
  get granted() {
    return battalionBonuses(this);
  }

  /* -------------------------------------------- */

  /**
   * What the system applies of the Gambit's Effect, and what it leaves to the table.
   * @type {import("../rules/battalions.mjs").GambitReading}
   */
  get reading() {
    return readGambit(this.gambit.effect);
  }
}

import { FEO } from "../config.mjs";
import { readArtItem, readCost } from "../rules/arts.mjs";

const { ArrayField, BooleanField, HTMLField, ObjectField, StringField } = foundry.data.fields;

/**
 * The data model for a Combat Art: a technique a unit has learned and may perform when it initiates a fight,
 * with the Combat Arts module.
 */
export default class ArtData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const config = FEO.optional.combatArts;
    return {
      // The weapons that perform it: those of its type, with any weapon for a Universal Art, and the other
      // weapon types its list names besides
      type: new StringField({ required: true, choices: Object.keys(config.types), initial: config.universal }),
      also: new StringField({ required: true, blank: true }),

      // The Weapon Rank it is learned at; blank for one a unit simply has, which counts for no Rank
      rank: new StringField({ required: true, blank: true, choices: config.ranks, initial: config.ranks[0] }),

      // Its Effect and its Cost, written as the lists of Arts write them. `module/rules/arts.mjs` reads from
      // them what the system applies by itself, and `automate` switches that off for an Art the table would
      // rather run by hand
      effect: new StringField({ required: true, blank: true }),
      cost: new StringField({ required: true, blank: true }),
      automate: new BooleanField({ initial: true }),

      // What the system applies of it beyond that, as effects in the notation of skill effects, and what such
      // an Art still leaves of its text for the table
      effects: new ArrayField(new ObjectField()),
      left: new StringField({ required: true, blank: true }),

      // Readied: the unit performs it in the next fight it initiates
      readied: new BooleanField(),

      description: new HTMLField()
    };
  }

  /* -------------------------------------------- */

  /**
   * What the system applies of the Art: what it reads from the Effect and the effects the Art carries. With
   * `automate` off, nothing but the text itself.
   * @type {import("../rules/arts.mjs").ArtReading & {effects: object[]}}
   */
  get reading() {
    return readArtItem(this);
  }

  /* -------------------------------------------- */

  /**
   * What the Art costs as it is written, before anything its unit has changes that.
   * @type {{hp: number, uses: number}}
   */
  get price() {
    return readCost(this.cost);
  }
}

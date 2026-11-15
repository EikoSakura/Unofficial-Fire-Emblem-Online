import { FEO } from "../config.mjs";
import { moverOf } from "../helpers/terrain.mjs";
import { moveCost } from "../rules/terrain.mjs";

const { NumberField, StringField } = foundry.data.fields;

/**
 * A Region behaviour that says what the ground inside the Region is: a kind of terrain from the table in The
 * Map, and how high it lies. A Game Master paints the terrain of a battle map with Regions that carry it.
 *
 * Either part may be left out: a Region may give only a kind of terrain, or only an elevation. Where Regions
 * overlap, the smallest one that says something about a tile has the say for it.
 *
 * The behaviour also tells Foundry what the terrain costs to cross, so that the ruler of a dragged token
 * counts movement as the rules do.
 *
 * @property {string} terrain           A key of FEO.terrain.types, or blank
 * @property {number|null} elevation    How high the ground lies, or null to leave that to other Regions
 */
export default class TerrainRegionBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {

  /** @override */
  static LOCALIZATION_PREFIXES = ["FEO.TerrainBehavior", "BEHAVIOR.TYPES.base"];

  /* -------------------------------------------- */

  /** @override */
  static defineSchema() {
    return {
      terrain: new StringField({
        required: true,
        blank: true,
        choices: () => Object.fromEntries(Object.entries(FEO.terrain.types).map(([key, type]) => {
          return [key, game.i18n.localize(type.label)];
        }))
      }),
      elevation: new NumberField({ required: true, nullable: true, integer: true, min: 0, max: 9, initial: null })
    };
  }

  /* -------------------------------------------- */

  /**
   * What crossing this ground costs the token, for Foundry's own measuring of movement. Terrain a unit cannot
   * cross at all is given as impassable.
   * @override
   */
  _getTerrainEffects(token, segment, options) {
    try {
      if ( !this.terrain || (token?.actor?.type !== "unit") ) return [];
      const difficulty = moveCost(this.terrain, moverOf(token.actor));
      return difficulty === 1 ? [] : [{ name: "difficulty", difficulty }];
    } catch(err) {
      console.error(err);
      return [];
    }
  }
}

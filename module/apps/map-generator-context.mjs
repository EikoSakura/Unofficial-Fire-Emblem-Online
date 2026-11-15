import { FEO } from "../config.mjs";
import { MAP_LIMITS, MAP_SIZES, MAP_TYPES, mapCounts } from "../rules/mapgen.mjs";

/**
 * What the map generator's window shows, worked out from what was chosen in it and the map that makes. Nothing
 * here touches Foundry: each function takes what is known and answers with what the template needs.
 *
 * @import {BattleMap} from "../rules/mapgen.mjs"
 * @typedef {{localize: (key: string) => string, format: (key: string, data: object) => string}} Localizer
 */

/** The name of the size that is set by hand. */
export const CUSTOM_SIZE = "custom";

/* -------------------------------------------- */

/**
 * What a generated scene is called unless it is given a name: its kind of battlefield and its seed.
 * @param {BattleMap} map
 * @param {Localizer} i18n
 * @returns {string}
 */
export function mapName(map, i18n) {
  return `${i18n.localize(`FEO.MapGen.type.${map.type}.label`)} ${map.seed}`;
}

/* -------------------------------------------- */

/**
 * The window of the map generator.
 * @param {object} chosen
 * @param {string} chosen.type        A key of MAP_TYPES
 * @param {string} chosen.size        A key of MAP_SIZES, or `custom`
 * @param {string} chosen.name        The name given to the scene, blank for the one it gets by itself
 * @param {BattleMap} chosen.map      The map as it would be made
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildMapGenerator({ type, size, name, map }, i18n) {
  const sizes = Object.entries(MAP_SIZES).map(([key, { columns, rows }]) => ({
    key,
    label: `${i18n.localize(`FEO.MapGen.size.${key}`)} · ${columns} × ${rows}`,
    selected: key === size
  }));
  sizes.push({ key: CUSTOM_SIZE, label: i18n.localize("FEO.MapGen.size.custom"), selected: size === CUSTOM_SIZE });
  return {
    types: Object.keys(MAP_TYPES).map((key) => ({
      key,
      label: i18n.localize(`FEO.MapGen.type.${key}.label`),
      hint: i18n.localize(`FEO.MapGen.type.${key}.hint`),
      on: key === type
    })),
    sizes,
    custom: size === CUSTOM_SIZE,
    columns: map.columns,
    rows: map.rows,
    limits: MAP_LIMITS,
    seed: map.seed,
    name,
    placeholder: mapName(map, i18n),
    summary: i18n.format("FEO.MapGen.summary", { columns: map.columns, rows: map.rows }),
    legend: mapCounts(map).map(({ terrain, count }) => ({
      label: i18n.localize(FEO.terrain.types[terrain]?.label ?? terrain).split(",")[0],
      tint: FEO.terrain.tints[terrain] ?? "",
      count
    }))
  };
}

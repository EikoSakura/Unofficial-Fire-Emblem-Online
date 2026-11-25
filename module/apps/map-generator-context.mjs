import { FEO } from "../config.mjs";
import { MAP_LIMITS, MAP_SIZES, MAP_TYPES, mapCounts } from "../rules/mapgen.mjs";

/**
 * What the map generator's window shows, worked out from what was chosen in it and the map that makes. Nothing
 * here touches Foundry: each function takes what is known and answers with what the template needs.
 *
 * @import {BattleMap} from "../rules/mapgen.mjs"
 * @import {LandMap, Lie} from "../rules/mapgen-land.mjs"
 * @import {Nation, Place} from "../rules/worldmap.mjs"
 * @typedef {{localize: (key: string) => string, format: (key: string, data: object) => string}} Localizer
 */

/** The name of the size that is set by hand. */
export const CUSTOM_SIZE = "custom";

/** What a map can be made from: the ground round a point of the World Map, or a kind of battlefield. */
export const MAP_SOURCES = ["world", "kind"];

/* -------------------------------------------- */

/**
 * The lie of the land in a word or two: what there is most to say of it.
 * @param {Lie} lie
 * @param {Localizer} i18n
 * @returns {string}
 */
export function lieTitle(lie, i18n) {
  const key = lie.peaks > 0.18 ? "mountains" : lie.sea > 0.12 ? "coast" : lie.arid > 0.5 ? "desert" : lie.wood > 0.4 ? "woods"
    : lie.hills > 0.3 ? "hills" : "open";
  return i18n.localize(`FEO.MapGen.lie.${key}`);
}

/* -------------------------------------------- */

/**
 * What the World Map shows of the ground a map was made from, each as a chip: the sea and the side it is on,
 * high ground, woods, dry and cold land, and the roads and sea lanes that cross the map.
 * @param {LandMap} map
 * @param {Localizer} i18n
 * @returns {{icon: string, label: string}[]}
 */
export function lieChips(map, i18n) {
  const { lie, tracks } = map;
  const word = (key, data) => (data ? i18n.format(`FEO.MapGen.chip.${key}`, data) : i18n.localize(`FEO.MapGen.chip.${key}`));
  const chips = [];
  if ( lie.sea > 0.04 ) {
    chips.push({
      icon: "wave",
      label: lie.seaSide === "around" ? word("seaAround") : word("seaTo", { wind: i18n.localize(`FEO.MapGen.wind.${lie.seaSide}`) })
    });
  }
  if ( lie.peaks > 0.12 ) chips.push({ icon: "peak", label: word("mountains") });
  else if ( lie.hills > 0.2 ) chips.push({ icon: "peak", label: word("hills") });
  if ( lie.wood > 0.5 ) chips.push({ icon: "tree", label: word("deepWoods") });
  else if ( lie.wood > 0.15 ) chips.push({ icon: "tree", label: word("woods") });
  if ( lie.arid > 0.4 ) chips.push({ icon: "sun", label: word("dry") });
  if ( lie.frost > 0.4 ) chips.push({ icon: "snow", label: word("cold") });
  const lanes = tracks.filter((track) => track.sea).length;
  const roads = tracks.length - lanes;
  if ( roads ) chips.push({ icon: "route", label: roads === 1 ? word("road") : word("roads", { count: roads }) });
  if ( lanes ) chips.push({ icon: "wave", label: lanes === 1 ? word("lane") : word("lanes", { count: lanes }) });
  return chips;
}

/* -------------------------------------------- */

/**
 * The roads and sea lanes that leave a map, each as a name for its margin: the side of the map it leaves by,
 * and how far along that side, in tiles.
 * @param {LandMap} map
 * @returns {{to: string, icon: string, company: boolean, side: "top"|"bottom"|"left"|"right", at: number}[]}
 */
export function exitTags(map) {
  return map.exits.map((exit) => {
    const { i, j } = exit.tile;
    const [side] = [["top", i], ["bottom", map.rows - 1 - i], ["left", j], ["right", map.columns - 1 - j]].sort((a, b) => a[1] - b[1])[0];
    return {
      to: exit.to,
      icon: exit.company ? "banner" : exit.kind === "sea" ? "wave" : "route",
      company: exit.company,
      side,
      at: ((side === "top") || (side === "bottom") ? j : i) + 0.5
    };
  });
}

/* -------------------------------------------- */

/**
 * What a generated scene is called unless it is given a name: the place it was made of, or its kind of
 * battlefield or the lie of its land and its seed.
 * @param {BattleMap|LandMap} map
 * @param {Localizer} i18n
 * @param {Place|null} [place]        The place a map from the World Map was made of
 * @returns {string}
 */
export function mapName(map, i18n, place = null) {
  if ( !map.lie ) return `${i18n.localize(`FEO.MapGen.type.${map.type}.label`)} ${map.seed}`;
  return place?.name || `${lieTitle(map.lie, i18n)} ${map.seed}`;
}

/* -------------------------------------------- */

/**
 * The window of the map generator.
 * @param {object} chosen
 * @param {string} chosen.source      One of MAP_SOURCES
 * @param {string} chosen.type        A key of MAP_TYPES
 * @param {string} chosen.size        A key of MAP_SIZES, or `custom`
 * @param {string} chosen.name        The name given to the scene, blank for the one it gets by itself
 * @param {BattleMap|LandMap} chosen.map      The map as it would be made
 * @param {boolean} [chosen.laid]     Is the World Map laid over the map on show?
 * @param {object} [chosen.world]     What is known of the World Map
 * @param {boolean} chosen.world.made         Has this world one?
 * @param {Place|null} [chosen.world.place]   The place the map is made of, if it is one
 * @param {string} [chosen.world.nation]      The nation that holds the ground there, by its full name
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildMapGenerator({ source = "kind", type, size, name, map, laid = false, world = { made: false } }, i18n) {
  const loc = (key) => i18n.localize(`FEO.MapGen.${key}`);
  const from = (source === "world") && !!map.lie;
  const place = from ? (world.place ?? null) : null;
  const sizes = Object.entries(MAP_SIZES).map(([key, { columns, rows }]) => ({
    key,
    label: `${loc(`size.${key}`)} · ${columns} × ${rows}`,
    selected: key === size
  }));
  sizes.push({ key: CUSTOM_SIZE, label: loc("size.custom"), selected: size === CUSTOM_SIZE });
  const holder = world.nation || i18n.localize("FEO.WorldMap.unclaimed");
  return {
    sources: MAP_SOURCES.map((key) => ({
      key,
      label: loc(`source.${key}`),
      on: from === (key === "world"),
      off: (key === "world") && !world.made,
      hint: (key === "world") && !world.made ? loc("source.noWorld") : ""
    })),
    world: from ? {
      over: place ? `${i18n.localize(`FEO.WorldMap.kind.${place.kind}`)} · ${holder}` : holder,
      name: place?.name || lieTitle(map.lie, i18n),
      chips: lieChips(map, i18n),
      exits: exitTags(map)
    } : null,
    laid: from && laid,
    types: Object.keys(MAP_TYPES).map((key) => ({
      key,
      label: loc(`type.${key}.label`),
      hint: loc(`type.${key}.hint`),
      on: key === type
    })),
    sizes,
    custom: size === CUSTOM_SIZE,
    columns: map.columns,
    rows: map.rows,
    limits: MAP_LIMITS,
    seed: map.seed,
    name,
    placeholder: mapName(map, i18n, place),
    note: loc(from ? "worldNote" : "note"),
    ends: { from: loc(from ? "ends.company" : "ends.joined"), to: loc("ends.leads") },
    summary: i18n.format("FEO.MapGen.summary", { columns: map.columns, rows: map.rows }),
    legend: mapCounts(map).map(({ terrain, count }) => ({
      label: i18n.localize(FEO.terrain.types[terrain]?.label ?? terrain).split(",")[0],
      tint: FEO.terrain.tints[terrain] ?? "",
      count
    }))
  };
}

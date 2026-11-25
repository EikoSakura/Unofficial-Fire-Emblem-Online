import { FEO } from "../config.mjs";
import { nationAt, nationFacts, pathBetween } from "../rules/worldmap.mjs";
import { glyphSvg } from "./world-map-draw.mjs";

/**
 * What the World Map and its Creator show around the map itself, worked out from the map and from what was
 * chosen in the window. Nothing here touches Foundry: each function takes what is known and answers with what
 * the templates need.
 *
 * @import {Land, Nation, Place, WorldMapState} from "../rules/worldmap.mjs"
 * @typedef {{localize: (key: string) => string, format: (key: string, data: object) => string}} Localizer
 */

/** The colour of a nation, as CSS. */
const colorOf = (nation) => `rgb(${(FEO.worldMap.colors[nation?.color] ?? [143, 132, 108]).join(", ")})`;

/**
 * The words of the World Map in the reader's language.
 * @param {Localizer} i18n
 * @returns {(key: string, data?: object) => string}
 */
const words = (i18n) => (key, data) => (data ? i18n.format(`FEO.WorldMap.${key}`, data) : i18n.localize(`FEO.WorldMap.${key}`));

/**
 * A nation by its full name, such as "Kingdom of Aldia".
 * @param {Nation} nation
 * @param {Localizer} i18n
 * @returns {string}
 */
export function nationTitle(nation, i18n) {
  return i18n.format(`FEO.WorldMap.style.${nation.style}`, { name: nation.name });
}

/**
 * Puts a made-up name into words, for the maker of a map (see `makeWorld` in rules/worldmap.mjs).
 * @param {Localizer} i18n
 * @returns {(key: string, name: string) => string}
 */
export function phraser(i18n) {
  return (key, name) => i18n.format(`FEO.WorldMap.phrase.${key}`, { name });
}

/* -------------------------------------------- */
/*  At the Table                                */
/* -------------------------------------------- */

/**
 * The window of the World Map.
 * @param {object} known
 * @param {WorldMapState} known.map
 * @param {Land} known.land
 * @param {Uint8Array} known.claims
 * @param {string} [known.selected]       The place that is picked out
 * @param {number} [known.spotlight]      The nation that is picked out
 * @param {boolean} known.isGM
 * @param {boolean} [known.marching]      Is the company on its way?
 * @param {boolean} [known.arrived]       Has the company just come to where it is?
 * @param {(place: Place) => {name: string, objectives: Record<string, boolean>}|null} [known.encounterOf]
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildWorldMap({ map, land, claims, selected = "", spotlight = 0, isGM, marching = false, arrived = false, encounterOf = () => null }, i18n) {
  const loc = words(i18n);
  if ( !map.made ) return { made: false, isGM, none: loc(isGM ? "none.gm" : "none.player") };
  const shown = (place) => isGM || place.seen;
  const context = {
    made: true,
    isGM,
    name: map.name || loc("title"),
    summary: loc("summary", { nations: map.nations.length, places: map.places.filter(shown).length }),
    legend: map.nations.map((nation) => ({ id: nation.id, name: nation.name, color: colorOf(nation), on: nation.id === spotlight })),
    plate: null,
    splash: arrived ? buildArrival({ map, land, claims, isGM, encounterOf }, i18n) : null
  };
  const party = map.places.find((place) => place.id === map.party);
  const place = map.places.find((other) => (other.id === selected) && shown(other)) ?? party;
  if ( !place ) return context;

  const here = place.id === map.party;
  const home = place.id === map.base;
  const nation = map.nations.find((other) => other.id === nationAt(land, claims, place.x, place.y));
  const encounter = place.battle ? encounterOf(place) : null;
  const objective = Object.keys(encounter?.objectives ?? {}).find((key) => encounter.objectives[key]);
  const way = here ? null : pathBetween(map, map.party, place.id, shown);

  const chips = [];
  if ( here ) chips.push({ icon: "banner", label: loc("chip.here"), cls: "wm-home" });
  if ( home ) chips.push({ icon: "tent", label: loc("chip.base"), cls: "wm-home" });
  if ( place.market ) chips.push({ icon: "coin", label: loc("chip.market") });
  if ( place.battle ) {
    chips.push({
      icon: "crossed", cls: "wm-battle", label: encounter?.name || loc("chip.battle"),
      strong: objective ? i18n.localize(`FEO.Encounter.objective.${objective}.label`) : ""
    });
  }
  if ( isGM && !place.seen ) chips.push({ icon: "eyeOff", label: loc("chip.hidden"), cls: "wm-veil" });

  const actions = [];
  if ( isGM ) {
    if ( !here ) {
      actions.push({ action: "veil", icon: place.seen ? "eyeOff" : "eye", label: loc(place.seen ? "act.hide" : "act.show"), cls: "small quiet" });
      actions.push({ action: "march", icon: "right", label: loc("act.march"), cls: "primary", disabled: !way || marching });
    }
    if ( here && place.battle ) {
      actions.push({ action: "won", icon: "check", label: loc("act.won"), cls: "small" });
      actions.push({ action: "begin", icon: "crossed", label: loc("act.begin"), cls: "primary", disabled: !encounter, hint: encounter ? "" : loc("act.beginNone") });
    }
    if ( here && !home && map.base ) actions.push({ action: "home", icon: "tent", label: loc("act.home"), cls: "small", disabled: marching });
  }
  else if ( !here ) actions.push({ action: "point", icon: "hand", label: loc("act.point"), cls: "primary" });
  if ( here && home ) actions.push({ action: "base", icon: "tent", label: loc("act.base"), cls: "primary" });

  context.plate = {
    id: place.id,
    name: place.name || loc(`kind.${place.kind}`),
    over: `${loc(`kind.${place.kind}`)} · ${nation ? nationTitle(nation, i18n) : loc("unclaimed")}`,
    color: colorOf(nation),
    glyph: glyphSvg(home ? "base" : place.kind),
    chips,
    actions,
    away: here ? null : way ? { count: way.legs.length, text: loc(way.legs.length === 1 ? "stop" : "stops") } : { count: "", text: loc("noWay") }
  };
  return context;
}

/* -------------------------------------------- */

/**
 * What is shown across the map when the company arrives at a place: where it has come to, and what may be done
 * there at once. A battle that waits is begun by the Game Master from its saved encounter; at the Base anyone
 * may go in. An arrival that offers neither asks nothing, and does not stay.
 * @param {object} known
 * @param {WorldMapState} known.map
 * @param {Land} known.land
 * @param {Uint8Array} known.claims
 * @param {boolean} known.isGM
 * @param {(place: Place) => {name: string}|null} [known.encounterOf]
 * @param {Localizer} i18n
 * @returns {{tone: string, over: string, name: string, under: string, actions: object[], stays: boolean}|null}
 *   Null where the company is nowhere
 */
export function buildArrival({ map, land, claims, isGM, encounterOf = () => null }, i18n) {
  const loc = words(i18n);
  const place = map.places.find((other) => other.id === map.party);
  if ( !map.made || !place ) return null;
  const home = place.id === map.base;
  const tone = place.battle ? "battle" : home ? "home" : "plain";
  const nation = map.nations.find((other) => other.id === nationAt(land, claims, place.x, place.y));
  const encounter = place.battle ? encounterOf(place) : null;
  const where = `${loc(`kind.${place.kind}`)} · ${nation ? nationTitle(nation, i18n) : loc("unclaimed")}`;

  const actions = [];
  if ( place.battle ) {
    if ( isGM && encounter ) {
      actions.push({ action: "begin", icon: "crossed", label: loc("act.begin"), cls: "primary" });
      actions.push({ action: "dismiss", label: loc("arrive.later"), cls: "" });
    }
  }
  else if ( home ) {
    actions.push({ action: "base", icon: "tent", label: loc("act.base"), cls: "primary" });
    actions.push({ action: "dismiss", label: loc("arrive.stay"), cls: "" });
  }

  return {
    tone,
    over: loc(`arrive.${tone}`),
    name: place.name || loc(`kind.${place.kind}`),
    under: encounter?.name ? `${encounter.name} · ${where}` : where,
    actions,
    stays: actions.length > 0
  };
}

/* -------------------------------------------- */
/*  The Creator                                 */
/* -------------------------------------------- */

/** The tools of the Creator, each with its icon. */
export const CREATOR_TOOLS = { land: "peak", nations: "brush", places: "pin", routes: "route" };

/**
 * The tools of the World Map Creator.
 * @param {object} chosen
 * @param {WorldMapState} chosen.draft            The map as it is being made; its `claims` are not used
 * @param {Land} chosen.land
 * @param {Uint8Array} chosen.claims              Whose ground each point is
 * @param {number} chosen.count                   How many nations a new map is made with
 * @param {string} chosen.tool                    A key of CREATOR_TOOLS
 * @param {number} chosen.nation                  The nation the brush paints, 0 for nobody's
 * @param {string} chosen.brush                   A key of FEO.worldMap.brushes
 * @param {string} chosen.kind                    The kind of place a click adds
 * @param {string} [chosen.selected]              The place being edited
 * @param {string} [chosen.linking]               The place a route is being drawn from
 * @param {boolean} [chosen.unsaved]
 * @param {{id: string, name: string}[]} [chosen.encounters]     The saved encounters a battle can be
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildCreator({ draft, land, claims, count, tool, nation, brush, kind, selected = "", linking = "", unsaved = false, encounters = [] }, i18n) {
  const loc = words(i18n);
  const config = FEO.worldMap;
  const facts = nationFacts(land, claims, draft.nations, draft.places);
  const context = {
    tool,
    unsaved,
    tabs: Object.entries(CREATOR_TOOLS).map(([key, icon]) => ({ key, icon, label: loc(`tool.${key}`), on: key === tool })),
    hint: loc(`hint.${tool}`)
  };

  if ( tool === "land" ) {
    context.land = {
      picture: !!draft.backdrop,
      backdrop: draft.backdrop,
      shapes: Object.keys(config.shapes).map((key) => ({ key, label: loc(`shape.${key}`), on: key === draft.shape })),
      count,
      fewer: count > config.nations.least,
      more: count < config.nations.most,
      densities: Object.keys(config.density).map((key) => ({ key, label: loc(`density.${key}`), on: key === draft.density })),
      seed: draft.seed,
      name: draft.name
    };
  }

  else if ( tool === "nations" ) {
    const picked = draft.nations.find((other) => other.id === nation);
    context.nations = {
      rows: draft.nations.map((other) => ({
        id: other.id, name: other.name, color: colorOf(other), on: other.id === nation,
        places: loc("placesHeld", { count: facts.get(other.id)?.places ?? 0 })
      })),
      nobody: nation === 0,
      canAdd: draft.nations.length < config.nations.most,
      brushes: Object.keys(config.brushes).map((key) => ({ key, label: loc(`brush.${key}`), on: key === brush })),
      picked: picked ? {
        id: picked.id,
        name: picked.name,
        title: nationTitle(picked, i18n),
        styles: config.styles.map((key) => ({ key, label: i18n.format(`FEO.WorldMap.style.${key}`, { name: "…" }), on: key === picked.style })),
        canRemove: draft.nations.length > 1
      } : null
    };
  }

  else if ( tool === "places" ) {
    const place = draft.places.find((other) => other.id === selected);
    const kinds = (on) => config.kinds.map((key) => ({ key, label: loc(`kind.${key}`), glyph: glyphSvg(key), on: key === on }));
    if ( place ) {
      const holder = draft.nations.find((other) => other.id === nationAt(land, claims, place.x, place.y));
      context.place = {
        id: place.id,
        name: place.name,
        kinds: kinds(place.kind),
        nation: holder ? nationTitle(holder, i18n) : loc("unclaimed"),
        color: holder ? colorOf(holder) : "",
        base: place.id === draft.base,
        market: place.market,
        battle: place.battle,
        encounters: [{ id: "", name: loc("place.noEncounter"), on: !place.encounter },
          ...encounters.map((encounter) => ({ id: encounter.id, name: encounter.name || loc("place.unnamed"), on: encounter.id === place.encounter }))],
        seen: place.seen,
        visited: place.visited
      };
    }
    else context.adding = { kinds: kinds(kind), any: draft.places.length > 0 };
  }

  else {
    const lanes = draft.routes.filter((route) => route.kind === "sea").length;
    const from = draft.places.find((other) => other.id === linking);
    context.routes = {
      count: loc("routes.count", { roads: draft.routes.length - lanes, lanes, places: draft.places.length }),
      next: from ? loc("routes.from", { name: from.name || loc(`kind.${from.kind}`) }) : loc("routes.start"),
      canJoin: draft.places.length > 1
    };
  }
  return context;
}

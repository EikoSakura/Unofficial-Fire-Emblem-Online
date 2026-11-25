/**
 * Tests for `module/rules/mapgen-land.mjs`: a battle map made of the ground round a place or a point of the
 * World Map. The last of them try what the Map Generator shows of such a map, which is worked out without
 * Foundry too.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAP_SOURCES, buildMapGenerator, exitTags, lieChips, lieTitle, mapName } from "../module/apps/map-generator-context.mjs";
import { FEO } from "../module/config.mjs";
import { MAP_SIZES, generateMap, mapPaint, walkable, walksTo } from "../module/rules/mapgen.mjs";
import { MOST_SEA, WINDS, generateFromLand, lensOf, lieAt, lieOf, surveyLens } from "../module/rules/mapgen-land.mjs";
import { makeLand, makeWorld, neighbours, pathBetween, pictureLand, stopsFrom } from "../module/rules/worldmap.mjs";

const { width: W, height: H } = FEO.worldMap;
const chosen = { seed: "ASTER", shape: "continent", count: 5, density: "settled" };
const land = makeLand(chosen);
const world = makeWorld(land, chosen);
const medium = MAP_SIZES.medium;

/** The first place of a kind. */
const first = (kind, of = world) => of.places.find((place) => place.kind === kind);

/** A map of a place, as the Map Generator would ask for it. */
function fieldOf(place, { size = medium, seed = "T1", of = world, on = land } = {}) {
  const way = place.id !== of.party ? pathBetween(of, of.party, place.id) : null;
  return generateFromLand({
    land: on, world: of, point: place, place, ...size, seed, cameBy: way?.stops.at(-2) ?? "", rank: stopsFrom(of, of.party)
  });
}

/** How many tiles of a map are of a kind of terrain. */
const count = (map, kind) => map.tiles.flat().filter((tile) => tile === kind).length;

test("a land knows where it is dry and where it is cold", () => {
  assert.equal(land.arid.length, W * H);
  assert.equal(land.frost.length, W * H);
  let dry = 0;
  let cold = 0;
  for ( let i = 0; i < W * H; i++ ) {
    dry += land.arid[i];
    cold += land.frost[i];
    if ( land.arid[i] || land.frost[i] ) assert.ok(land.land[i], "the sea is neither dry nor cold");
    if ( land.arid[i] ) assert.equal(land.wood[i], 0, "no woods stand on dry land");
  }
  assert.ok(dry > 0, "some of the land is dry");
  assert.ok(cold > 0, "some of it is cold");
  const picture = pictureLand("maps/own.webp", new Uint8ClampedArray(W * H * 4));
  assert.equal(picture.arid.length, W * H);
  assert.ok(!picture.arid.some(Boolean) && !picture.frost.some(Boolean));
});

test("the lens is a box round the point, kept on the map", () => {
  const scale = FEO.worldMap.lens;
  assert.deepEqual(lensOf(land, { x: 600, y: 375 }, medium), {
    x0: 600 - (12 * scale), y0: 375 - (8 * scale), w: 24 * scale, h: 16 * scale, scale, rows: 16, columns: 24
  });
  const corner = lensOf(land, { x: 2, y: H - 1 }, medium);
  assert.equal(corner.x0, 0);
  assert.equal(corner.y0, H - corner.h);
  assert.equal(lensOf(land, { x: 600, y: 375 }, MAP_SIZES.vast).w, 40 * scale, "a larger map takes in more of the land");
});

test("the same land, point, size and seed give the same map", () => {
  const port = first("port");
  const map = fieldOf(port);
  assert.deepEqual(fieldOf(port), map);
  assert.equal(map.type, "land");
  assert.equal(map.seed, "T1");
  assert.equal(map.rows, 16);
  assert.equal(map.columns, 24);

  // Another seed keeps the lie of the land and changes the detail
  const other = fieldOf(port, { seed: "T2" });
  assert.notDeepEqual(other.tiles, map.tiles);
  assert.deepEqual(other.lens, map.lens);
  assert.deepEqual(other.lie, map.lie);
  assert.deepEqual(other.tracks, map.tracks);
});

test("the sea lies on the map where the World Map shows it", () => {
  const port = first("port");
  const map = fieldOf(port);
  const read = surveyLens(land, map.lens);
  let wet = 0;
  for ( let i = 0; i < map.rows; i++ ) {
    for ( let j = 0; j < map.columns; j++ ) {
      if ( read.sea[i][j] >= 0.5 ) {
        wet++;

        // But for a jetty, a causeway, or where a way had to be made
        assert.ok(["water", "plain"].includes(map.tiles[i][j]), `sea at ${i},${j} is ${map.tiles[i][j]}`);
      }
      else assert.notEqual(map.tiles[i][j], "water", `land at ${i},${j} is water`);
    }
  }
  assert.ok(wet > 10, "a port lies by the sea");
  assert.ok(count(map, "water") > wet * 0.8);
  assert.ok(Math.abs(map.lie.sea - (wet / (map.rows * map.columns))) < 1e-9);
  assert.ok([...WINDS, "around"].includes(map.lie.seaSide));
});

test("the lie of the land says which side the sea is on", () => {
  const field = (sea) => Array.from({ length: 8 }, (_, i) => Array.from({ length: 12 }, (__, j) => (sea(i, j) ? 1 : 0)));
  const none = field(() => false);
  const read = (sea) => ({ sea: field(sea), rise: none, wood: none, arid: none, frost: none });
  assert.equal(lieOf(read((i) => i >= 6)).seaSide, "south");
  assert.equal(lieOf(read((i, j) => j <= 2)).seaSide, "west");
  assert.equal(lieOf(read((i, j) => (i <= 2) && (j >= 8))).seaSide, "northEast");
  assert.equal(lieOf(read((i, j) => (i === 0) || (i === 7) || (j === 0) || (j === 11))).seaSide, "around");
  assert.deepEqual(lieOf(read(() => false)), { sea: 0, seaSide: "", wood: 0, hills: 0, peaks: 0, arid: 0, frost: 0 });
  assert.equal(lieOf(read((i) => i >= 6)).sea, 0.25);
});

test("woods, high ground and dry land fall where the World Map has them", () => {
  // Over many places, the more of something the World Map shows, the more of it the map has
  const places = [];
  for ( const [seed, shape] of [["ASTER", "continent"], ["OAK", "twin"]] ) {
    const on = seed === "ASTER" ? land : makeLand({ seed, shape });
    const of = seed === "ASTER" ? world : makeWorld(on, { ...chosen, seed, shape });
    for ( const place of of.places ) if ( !["capital", "town", "fort"].includes(place.kind) ) places.push(fieldOf(place, { of, on }));
  }
  const share = (map, kinds) => kinds.reduce((sum, kind) => sum + count(map, kind), 0) / Math.max((map.rows * map.columns) - count(map, "water"), 1);
  const mean = (maps, kinds) => maps.reduce((sum, map) => sum + share(map, kinds), 0) / Math.max(maps.length, 1);
  for ( const [key, kinds] of [["wood", ["forest", "thicket"]], ["hills", ["hill", "mountain", "cliff"]], ["arid", ["desert"]]] ) {
    const much = places.filter((map) => map.lie[key] > 0.5);
    const little = places.filter((map) => map.lie[key] < 0.1);
    assert.ok(much.length && little.length, `some places have much ${key} and some little`);
    assert.ok(mean(much, kinds) > mean(little, kinds) + 0.15, `${key}: ${mean(much, kinds).toFixed(2)} against ${mean(little, kinds).toFixed(2)}`);
  }
});

test("every place of a world gives a map a unit on foot can cross, at every size", () => {
  for ( const [seed, shape] of [["ASTER", "continent"], ["BRINE", "isles"], ["Q7", "inner"]] ) {
    const on = seed === "ASTER" ? land : makeLand({ seed, shape });
    const of = seed === "ASTER" ? world : makeWorld(on, { ...chosen, seed, shape });
    for ( const place of of.places ) {
      for ( const size of Object.values(MAP_SIZES) ) {
        const map = fieldOf(place, { size, of, on });
        const where = `${place.name} (${seed}, ${size.columns} × ${size.rows})`;
        assert.ok(map.tiles.flat().every((tile) => tile in FEO.terrain.types), `${where} has a tile of no known kind`);
        assert.ok(walkable(map.tiles[map.ends.from.i][map.ends.from.j]), `${where}: the company cannot stand where it comes in`);
        assert.ok(walksTo(map, map.ends.from, map.ends.to), `${where}: there is no way across`);
      }
    }
  }
});

test("what stands at the place stands at the heart of the map", () => {
  const heart = { i: 8, j: 12 };
  for ( const kind of ["capital", "fort", "town", "village", "port", "ruins"] ) {
    const place = first(kind);
    if ( !place ) continue;
    const map = fieldOf(place);
    assert.deepEqual(map.ends.to, heart, `the battle at a ${kind} leads to its heart`);
    if ( kind === "capital" ) assert.ok((count(map, "house") > 20) && (count(map, "cliff") >= 8), "a capital is a town round a keep");
    if ( kind === "fort" ) assert.ok(count(map, "cliff") >= 16, "a fortress has its walls");
    if ( ["capital", "fort", "ruins"].includes(kind) ) assert.equal(map.tiles[heart.i][heart.j], "fort", `a ${kind} has its throne`);
    if ( kind === "town" ) assert.ok((count(map, "house") > 12) && (count(map, "healhedge") === 1), "a town has its houses and its square");
    if ( kind === "village" ) assert.ok(count(map, "house") >= 3, "a village has its houses");
    if ( kind === "port" ) assert.ok((count(map, "house") >= 3) && (count(map, "fort") >= 1), "a port has its houses and its fort");
    if ( kind === "ruins" ) assert.ok(count(map, "cover") >= 3, "ruins have their broken walls");
  }
});

test("a fortress has a gate wherever a road meets its walls", () => {
  const fort = first("fort");
  const map = fieldOf(fort);
  const roads = map.exits.filter((exit) => exit.kind === "road").length;
  assert.ok(roads >= 1);

  // The throne is one fort, and each road that comes in passes a gate
  assert.ok(count(map, "fort") >= 1 + Math.min(roads, 1));
  for ( const exit of map.exits.filter((other) => other.kind === "road") ) {
    assert.ok(walksTo(map, exit.tile, map.ends.to), `the road from ${exit.to} leads to the throne`);
  }
});

test("the roads leave the map as the routes leave the place, and the company comes in by its own", () => {
  const far = world.places.find((place) => (place.id !== world.party) && (stopsFrom(world, world.party).get(place.id) >= 2));
  const map = fieldOf(far);
  const routes = neighbours(world, far.id);
  for ( const { id, route } of routes ) {
    const exit = map.exits.find((other) => other.id === id);
    assert.ok(exit, "each route of the place leaves the map");
    assert.equal(exit.kind, route.kind);
    assert.equal(exit.to, world.places.find((place) => place.id === id).name);
    const { i, j } = exit.tile;
    assert.ok((i === 0) || (j === 0) || (i === map.rows - 1) || (j === map.columns - 1), "it leaves by an edge");
  }
  assert.ok(map.tracks.length >= routes.length);
  for ( const track of map.tracks ) for ( const point of [track.a, track.c, track.b] ) assert.ok(point.every(Number.isFinite));

  // The company comes by the last place on its way here
  const cameBy = pathBetween(world, world.party, far.id).stops.at(-2);
  const company = map.exits.filter((exit) => exit.company);
  assert.equal(company.length, 1);
  assert.equal(company[0].id, cameBy);
  if ( company[0].kind === "road" ) assert.deepEqual(map.ends.from, company[0].tile);

  // Where the company stands already, it is taken to come by the road that leads nearest
  const here = fieldOf(world.places.find((place) => place.id === world.party));
  assert.equal(here.exits.filter((exit) => exit.company).length, 1);
});

test("bare ground gives a map with nothing built at its heart, that leads to the road out", () => {
  const a = world.places.find((place) => place.id === world.routes.find((route) => route.kind === "road").a);
  const b = world.places.find((place) => place.id === world.routes.find((route) => route.kind === "road").b);
  const point = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  const map = generateFromLand({ land, world, point, ...medium, seed: "T1", rank: stopsFrom(world, world.party) });
  assert.ok(walksTo(map, map.ends.from, map.ends.to));
  assert.ok(count(map, "house") <= 1);
  assert.ok(count(map, "cliff") + count(map, "cover") < 40);
  assert.ok(map.tracks.length >= 1);

  // The open sea is nothing to fight over
  assert.ok(lieAt(land, { x: 4, y: 4 }, medium).sea > MOST_SEA);
  assert.ok(lieAt(land, first("capital"), medium).sea <= MOST_SEA);
});

test("a world drawn over a picture gives open country, with the place and its roads", () => {
  const picture = pictureLand("maps/own.webp", new Uint8ClampedArray(W * H * 4));
  const town = first("town");
  const map = fieldOf(town, { on: picture });
  assert.equal(count(map, "water") + count(map, "desert") + count(map, "mountain"), 0);
  assert.equal(map.lie.sea, 0);
  assert.ok(count(map, "house") > 12);
  assert.ok(map.exits.length >= 1);
  assert.ok(walksTo(map, map.ends.from, map.ends.to));
});

test("a map from the World Map is painted on a scene as any other is", () => {
  const map = fieldOf(first("port"));
  const paint = mapPaint(map, { top: 2, left: 3, open: true });
  let tiles = 0;
  for ( const keys of paint.terrain.values() ) tiles += keys.size;
  assert.equal(tiles, map.rows * map.columns);
  assert.ok(paint.terrain.get("water").size > 10);
});

/* -------------------------------------------- */
/*  What the window shows                       */
/* -------------------------------------------- */

/** Words that say which they are, so that a test can tell what was asked for. */
const i18n = {
  localize: (key) => key.replace(/^FEO\./, ""),
  format: (key, data) => `${key.replace(/^FEO\./, "")}(${Object.values(data).join(",")})`
};

test("the lie of the land is told in a word, and in chips", () => {
  const lie = { sea: 0, seaSide: "", wood: 0, hills: 0, peaks: 0, arid: 0, frost: 0 };
  assert.equal(lieTitle(lie, i18n), "MapGen.lie.open");
  assert.equal(lieTitle({ ...lie, hills: 0.4 }, i18n), "MapGen.lie.hills");
  assert.equal(lieTitle({ ...lie, hills: 0.4, wood: 0.5 }, i18n), "MapGen.lie.woods");
  assert.equal(lieTitle({ ...lie, wood: 0.5, arid: 0.6 }, i18n), "MapGen.lie.desert");
  assert.equal(lieTitle({ ...lie, arid: 0.6, sea: 0.2 }, i18n), "MapGen.lie.coast");
  assert.equal(lieTitle({ ...lie, sea: 0.2, peaks: 0.2 }, i18n), "MapGen.lie.mountains");

  const track = (sea) => ({ a: [0, 0], c: [1, 1], b: [2, 2], sea });
  const labels = (map) => lieChips(map, i18n).map((chip) => chip.label);
  assert.deepEqual(labels({ lie, tracks: [] }), []);
  assert.deepEqual(labels({ lie: { ...lie, sea: 0.3, seaSide: "southWest", wood: 0.6, hills: 0.3, frost: 0.5 }, tracks: [track(false), track(true)] }),
    ["MapGen.chip.seaTo(MapGen.wind.southWest)", "MapGen.chip.hills", "MapGen.chip.deepWoods", "MapGen.chip.cold", "MapGen.chip.road", "MapGen.chip.lane"]);
  assert.deepEqual(labels({ lie: { ...lie, sea: 0.3, seaSide: "around", peaks: 0.2, wood: 0.2, arid: 0.5 }, tracks: [track(false), track(false), track(false)] }),
    ["MapGen.chip.seaAround", "MapGen.chip.mountains", "MapGen.chip.woods", "MapGen.chip.dry", "MapGen.chip.roads(3)"]);
});

test("the roads that leave a map are named in its margin, each beside its tile", () => {
  const exit = (i, j, more = {}) => ({ tile: { i, j }, id: "p", to: "P", kind: "road", company: false, ...more });
  const tags = exitTags({ rows: 16, columns: 24, exits: [exit(0, 5), exit(15, 20, { company: true }), exit(7, 0, { kind: "sea" }), exit(3, 23)] });
  assert.deepEqual(tags.map((tag) => [tag.side, tag.at, tag.icon]), [["top", 5.5, "route"], ["bottom", 20.5, "banner"], ["left", 7.5, "wave"], ["right", 3.5, "route"]]);
  assert.equal(tags[1].company, true);
});

test("the Map Generator shows a map from the World Map by its place, and one of a kind as it did", () => {
  const port = first("port");
  const map = fieldOf(port);
  const shown = buildMapGenerator({
    source: "world", type: "plains", size: "medium", name: "", map, laid: true, world: { made: true, place: port, nation: "Kingdom of Aldia" }
  }, i18n);
  assert.deepEqual(shown.sources.map((source) => [source.key, source.on, source.off]), [["world", true, false], ["kind", false, false]]);
  assert.deepEqual(MAP_SOURCES, ["world", "kind"]);
  assert.equal(shown.world.name, port.name);
  assert.equal(shown.world.over, "WorldMap.kind.port · Kingdom of Aldia");
  assert.ok(shown.world.chips.some((chip) => chip.icon === "wave"));
  assert.equal(shown.world.exits.length, map.exits.length);
  assert.equal(shown.placeholder, port.name);
  assert.equal(shown.laid, true);
  assert.equal(shown.note, "MapGen.worldNote");
  assert.equal(shown.ends.from, "MapGen.ends.company");
  assert.equal(shown.seed, "T1");
  assert.ok(shown.legend.some((entry) => entry.label === "Terrain.water"));
  assert.equal(mapName(map, i18n, port), port.name);
  assert.equal(mapName(map, i18n), `${lieTitle(map.lie, i18n)} T1`);

  // Bare ground is named for the lie of its land, and for nobody where nobody holds it
  const bare = buildMapGenerator({ source: "world", type: "plains", size: "medium", name: "", map, world: { made: true } }, i18n);
  assert.equal(bare.world.name, lieTitle(map.lie, i18n));
  assert.equal(bare.world.over, "WorldMap.unclaimed");
  assert.equal(bare.laid, false);

  // A map of a kind of battlefield, in a world with a World Map and in one without
  const plains = generateMap({ type: "plains", ...medium, seed: "T1" });
  const kind = buildMapGenerator({ source: "kind", type: "plains", size: "medium", name: "Mine", map: plains, laid: true, world: { made: true } }, i18n);
  assert.equal(kind.world, null);
  assert.equal(kind.laid, false);
  assert.deepEqual(kind.sources.map((source) => source.on), [false, true]);
  assert.equal(kind.placeholder, "MapGen.type.plains.label T1");
  assert.equal(kind.note, "MapGen.note");
  assert.equal(kind.ends.from, "MapGen.ends.joined");
  assert.equal(kind.types.find((type) => type.on).key, "plains");
  const none = buildMapGenerator({ source: "kind", type: "plains", size: "medium", name: "", map: plains }, i18n);
  assert.deepEqual(none.sources.map((source) => [source.off, source.hint]), [[true, "MapGen.source.noWorld"], [false, ""]]);
});

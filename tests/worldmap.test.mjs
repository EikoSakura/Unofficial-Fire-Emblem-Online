/**
 * Tests for `module/rules/worldmap.mjs`: the land of a World Map, the nations, places and routes laid over it,
 * how the ground each nation holds is kept, and how the company gets from place to place. The last of them try
 * what the World Map and its Creator show of a map, which is worked out without Foundry too.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArrival, buildCreator, buildWorldMap, holderTitle, nationTitle } from "../module/apps/world-map-context.mjs";
import { PLACE_GLYPHS, overlayMarkup } from "../module/apps/world-map-draw.mjs";
import { FEO } from "../module/config.mjs";
import { seededRandom } from "../module/rules/mapgen.mjs";
import {
  alongRoute, arriveAt, cleanWorldMap, isLand, joinPlaces, kindAt, madeName, makeLand, makeWorld, nationAt, nationFacts,
  neighbours, packClaims, paintClaims, pathBetween, pictureLand, placeName, removePlace, routeKind, stopsFrom, toggleRoute,
  unpackClaims
} from "../module/rules/worldmap.mjs";

const { width: W, height: H } = FEO.worldMap;
const chosen = { seed: "ASTER", shape: "continent", count: 5, density: "settled" };
const land = makeLand(chosen);
const world = makeWorld(land, chosen);

/** A map as a world would keep it. */
const kept = (made = world) => cleanWorldMap({
  made: true, ...chosen, name: made.name, nations: made.nations, claims: packClaims(made.claims),
  places: made.places, routes: made.routes, base: made.base, party: made.party
});

test("a land has the share of land its shape asks for, and none at its edges", () => {
  for ( const [shape, { land: share }] of Object.entries(FEO.worldMap.shapes) ) {
    const made = shape === chosen.shape ? land : makeLand({ seed: "ASTER", shape });
    let count = 0;
    for ( const point of made.land ) count += point;
    assert.ok(Math.abs((count / (W * H)) - share) < 0.03, `${shape} is ${(count / (W * H)).toFixed(3)} land`);
    for ( let x = 0; x < W; x++ ) assert.equal(made.land[x] + made.land[((H - 1) * W) + x], 0, `${shape} reaches an edge`);
    assert.equal(made.paint.length, W * H * 3);
    assert.ok(made.marks.length > 50, `${shape} has peaks and woods`);
  }
});

test("the same seed and shape give the same land, and another seed another", () => {
  const again = makeLand(chosen);
  assert.deepEqual(again.land, land.land);
  assert.deepEqual(again.paint, land.paint);
  assert.deepEqual(again.marks, land.marks);
  assert.notDeepEqual(makeLand({ ...chosen, seed: "EMBER" }).land, land.land);
  assert.equal(makeLand({ seed: "ASTER", shape: "nowhere" }).key, land.key, "an unknown shape is a continent");
});

test("a world has its nations, each with a capital on its own ground", () => {
  assert.equal(world.nations.length, 5);
  assert.deepEqual(world.nations.map((nation) => nation.id), [1, 2, 3, 4, 5]);
  assert.equal(new Set(world.nations.map((nation) => nation.style)).size, 5);
  const capitals = world.places.filter((place) => place.kind === "capital");
  assert.equal(capitals.length, 5);
  capitals.forEach((capital, n) => assert.equal(nationAt(land, world.claims, capital.x, capital.y), n + 1));
  for ( const nation of world.nations ) assert.ok(nation.name && FEO.worldMap.styles.includes(nation.style));
  const facts = nationFacts(land, world.claims, world.nations, world.places);
  for ( const nation of world.nations ) {
    assert.ok(facts.get(nation.id).area > 5000, `${nation.name} holds ground`);
    assert.ok(facts.get(nation.id).places >= 1);
  }
});

test("the same choices give the same world, and asking again gives another on the same land", () => {
  const again = makeWorld(land, chosen);
  assert.deepEqual(again.places, world.places);
  assert.deepEqual(again.routes, world.routes);
  assert.deepEqual(again.claims, world.claims);
  const other = makeWorld(land, { ...chosen, turn: 1 });
  assert.notDeepEqual(other.places, world.places);
  for ( const count of [2, 8] ) assert.equal(makeWorld(land, { ...chosen, count }).nations.length, count);
  assert.equal(makeWorld(land, { ...chosen, count: 40 }).nations.length, 8);
});

test("places stand on land, apart from one another, and every one can be reached", () => {
  const { apart, most } = FEO.worldMap.density.settled;
  assert.ok(world.places.length > 12 && world.places.length <= most);
  for ( const place of world.places ) {
    assert.ok(isLand(land, place.x, place.y), `${place.name} is in the sea`);
    assert.ok(FEO.worldMap.kinds.includes(place.kind));
    assert.ok(place.name);
    assert.equal(place.market, FEO.worldMap.market.includes(place.kind));
  }
  const others = world.places.filter((place) => place.kind !== "capital");
  for ( const a of others ) for ( const b of others ) {
    if ( a !== b ) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= apart);
  }
  assert.equal(stopsFrom(world, world.base).size, world.places.length);
  for ( const route of world.routes ) {
    const [a, b] = [route.a, route.b].map((id) => world.places.find((place) => place.id === id));
    assert.equal(route.kind, routeKind(land, a, b));
    if ( route.kind === "sea" ) for ( const end of [a, b] ) assert.ok(["port", "capital"].includes(end.kind));
  }
  const crowded = makeWorld(land, { ...chosen, density: "crowded" });
  assert.ok(crowded.places.length > world.places.length);
  assert.equal(stopsFrom(crowded, crowded.base).size, crowded.places.length);
});

test("an archipelago is joined by sea lanes", () => {
  const isles = makeLand({ seed: "ASTER", shape: "isles" });
  const made = makeWorld(isles, { ...chosen, shape: "isles" });
  assert.equal(stopsFrom(made, made.base).size, made.places.length);
  assert.ok(made.routes.some((route) => route.kind === "sea"));
});

test("the Base is in the first nation, and the players know the land around it", () => {
  const base = world.places.find((place) => place.id === world.base);
  assert.equal(world.party, world.base);
  assert.equal(nationAt(land, world.claims, base.x, base.y), 1);
  assert.ok(base.visited && base.seen);
  const stops = stopsFrom(world, world.base);
  for ( const place of world.places ) {
    assert.equal(place.seen, (place.kind === "capital") || (stops.get(place.id) <= FEO.worldMap.known), place.name);
    assert.equal(place.battle, false);
  }
  assert.ok(world.places.some((place) => !place.seen), "some of the land is still to be found");
});

test("names are made up, and put into words by whoever asks", () => {
  const random = seededRandom("names");
  for ( let n = 0; n < 300; n++ ) {
    const name = madeName(random, n % 2 ? "nation" : "place");
    assert.match(name, /^[A-Z][a-z]{2,9}$/);
  }
  const phrase = (key, name) => `<${key}:${name}>`;
  assert.match(placeName(seededRandom("a"), "port", phrase), /^<port\.[01]:[A-Z][a-z]+>$/);
  assert.match(placeName(seededRandom("a"), "ruins", phrase), /^<ruins:[A-Z][a-z]+>$/);
  assert.match(placeName(seededRandom("a"), "town", phrase), /^[A-Z][a-z]+$/);
  assert.match(makeWorld(land, chosen, { phrase }).name, /^<world\.continent:[A-Z][a-z]+>$/);
});

test("whose ground is whose is packed into a text and comes back the same", () => {
  const text = packClaims(world.claims);
  assert.ok(text.length < 120000, `the ground packs into ${text.length} signs`);
  assert.deepEqual(unpackClaims(text, W * H), world.claims);
  assert.deepEqual(unpackClaims("", 6), new Uint8Array(6));
  assert.deepEqual(unpackClaims("A2C3", 6), Uint8Array.from([0, 0, 2, 2, 2, 0]));
  assert.deepEqual(unpackClaims("C9", 4), Uint8Array.from([2, 2, 2, 2]), "a run stops at the edge of the map");
  assert.deepEqual(unpackClaims("Z3B1", 4), Uint8Array.from([0, 0, 0, 1]), "a nation there cannot be is nobody");
  assert.equal(packClaims(Uint8Array.from([0, 0, 2, 2, 2, 0])), "A2C3A1");
});

test("the brush paints land into a nation and leaves the sea alone", () => {
  const claims = world.claims.slice();
  const capital = world.places[1];
  const box = paintClaims(land, claims, capital.x, capital.y, 26, 1);
  assert.equal(nationAt(land, claims, capital.x, capital.y), 1);
  assert.equal(nationAt(land, world.claims, capital.x, capital.y), 2);
  assert.deepEqual(box, { x0: capital.x - 26, y0: capital.y - 26, x1: capital.x + 27, y1: capital.y + 27 });
  for ( let i = 0; i < claims.length; i++ ) if ( !land.land[i] ) assert.equal(claims[i], 0);
  const sea = claims.slice();
  paintClaims(land, sea, 3, 3, 14, 4);
  assert.deepEqual(sea, claims);
  paintClaims(land, claims, capital.x, capital.y, 26, 0);
  assert.equal(nationAt(land, claims, capital.x, capital.y), 0);
});

test("the shortest way follows the routes, and only through the places it may", () => {
  const map = {
    places: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, { id: "c", x: 200, y: 0 }, { id: "d", x: 100, y: 150 }, { id: "e", x: 500, y: 500 }],
    routes: [{ a: "a", b: "b" }, { a: "c", b: "b" }, { a: "a", b: "d" }, { a: "d", b: "c" }]
  };
  const way = pathBetween(map, "a", "c");
  assert.deepEqual(way.stops, ["a", "b", "c"]);
  assert.deepEqual(way.legs.map((leg) => [leg.from, leg.to]), [["a", "b"], ["b", "c"]]);
  assert.equal(way.legs[1].route, map.routes[1]);
  assert.equal(way.length, 200);
  assert.deepEqual(pathBetween(map, "a", "c", (place) => place.id !== "b").stops, ["a", "d", "c"]);
  assert.equal(pathBetween(map, "a", "e"), null);
  assert.equal(pathBetween(map, "a", "nowhere"), null);
  assert.deepEqual(pathBetween(map, "a", "a"), { stops: ["a"], legs: [], length: 0 });
  assert.deepEqual(neighbours(map, "b").map((next) => next.id), ["a", "c"]);
  assert.deepEqual([...stopsFrom(map, "a")], [["a", 0], ["b", 1], ["d", 1], ["c", 2]]);
});

test("a route bows the same way whichever end it is followed from", () => {
  const a = { x: 10, y: 20 };
  const b = { x: 110, y: 60 };
  assert.deepEqual(alongRoute(a, b, 0.2, 0), a);
  assert.deepEqual(alongRoute(a, b, 0.2, 1), b);
  const there = alongRoute(a, b, 0.2, 0.25);
  const back = alongRoute(b, a, -0.2, 0.75);
  assert.ok(Math.abs(there.x - back.x) < 1e-9 && Math.abs(there.y - back.y) < 1e-9);
  assert.deepEqual(alongRoute(a, b, 0, 0.5), { x: 60, y: 40 });
});

test("joining places by hand, and taking one away", () => {
  const map = kept();
  const [a, b] = map.places;
  const before = map.routes.length;
  const joined = toggleRoute(land, map, a.id, b.id, () => 0.5);
  assert.equal(map.routes.length, before + (joined ? 1 : -1));
  assert.equal(toggleRoute(land, map, b.id, a.id), !joined, "the same pair the other way round is the same route");
  assert.equal(map.routes.length, before);
  assert.equal(toggleRoute(land, map, a.id, a.id), false);
  assert.equal(toggleRoute(land, map, a.id, "nowhere"), false);

  removePlace(map, map.base);
  assert.ok(!map.places.some((place) => place.id === world.base));
  assert.ok(!map.routes.some((route) => [route.a, route.b].includes(world.base)));
  assert.equal(map.base, map.places[0].id);
  assert.equal(map.party, map.base);
});

test("arriving shows the place and the places a route away", () => {
  const map = kept();
  const hidden = map.places.find((place) => !place.seen);
  const near = neighbours(map, hidden.id).map((next) => map.places.find((place) => place.id === next.id));
  const elsewhere = map.places.filter((place) => !place.seen && (place !== hidden) && !near.includes(place));
  arriveAt(map, hidden.id);
  assert.equal(map.party, hidden.id);
  assert.ok(hidden.seen && hidden.visited);
  for ( const place of near ) assert.ok(place.seen);
  for ( const place of elsewhere ) assert.ok(!place.seen);
  assert.equal(arriveAt(map, "nowhere").party, hidden.id);
});

test("what a world keeps is put right", () => {
  assert.deepEqual(cleanWorldMap(), {
    made: false, name: "", backdrop: "", seed: "", shape: "continent", density: "settled", turn: 0, nations: [], claims: "",
    places: [], routes: [], base: "", party: ""
  });
  assert.deepEqual(cleanWorldMap(null).places, []);
  const map = kept();
  assert.deepEqual(cleanWorldMap(JSON.parse(JSON.stringify(map))), map, "a kept map comes back as it was");
  assert.equal(map.places.length, world.places.length);
  assert.equal(map.routes.length, world.routes.length);

  const odd = cleanWorldMap({
    made: 1, shape: "moon", density: "empty", turn: -3,
    nations: [{ id: 2, name: " Two ", style: "republic" }, { id: 2, name: "Again" }, { id: 12, name: "Far" }, { id: 1, name: "One", color: 99 }],
    places: [
      { id: "a", x: -5, y: 9000, kind: "castle", name: " A ", seen: 1 }, { id: "a", x: 1, y: 1 }, { x: 2, y: 2 },
      { id: "b", x: 10.6, y: 20.2, kind: "port", battle: true, encounter: " e1 ", scene: " s1 ", market: true }
    ],
    routes: [{ a: "a", b: "b", kind: "sea", bend: 4 }, { a: "b", b: "a" }, { a: "a", b: "a" }, { a: "a", b: "c" }],
    base: "zzz", party: "b"
  });
  assert.deepEqual(odd.nations, [{ id: 1, name: "One", style: "kingdom", color: 7 }, { id: 2, name: "Two", style: "kingdom", color: 1 }]);
  assert.deepEqual(odd.places, [
    { id: "a", x: 0, y: H - 1, kind: "village", name: "A", seen: true, visited: false, battle: false, encounter: "", scene: "", market: false },
    { id: "b", x: 11, y: 20, kind: "port", name: "", seen: false, visited: false, battle: true, encounter: "e1", scene: "s1", market: true }
  ]);
  assert.deepEqual(odd.routes, [{ a: "a", b: "b", kind: "sea", bend: 0.3 }]);
  assert.equal(odd.made, true);
  assert.equal(odd.shape, "continent");
  assert.equal(odd.density, "settled");
  assert.equal(odd.turn, 0);
  assert.equal(odd.base, "a");
  assert.equal(odd.party, "b");
});

test("a picture of the Game Master's own is land all over", () => {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for ( let i = 0; i < W * H; i++ ) pixels.set([i % 256, 10, 20, 255], i * 4);
  const picture = pictureLand("maps/own.webp", pixels);
  assert.equal(picture.picture, true);
  assert.equal(picture.key, "maps/own.webp");
  assert.ok(isLand(picture, 0, 0) && isLand(picture, W - 1, H - 1));
  assert.ok(!isLand(picture, W, 0));
  assert.deepEqual([...picture.paint.slice(3, 6)], [1, 10, 20]);
  assert.equal(picture.marks.length, 0);
  assert.equal(routeKind(picture, { x: 10, y: 10 }, { x: 900, y: 600 }), "road");
  const routes = joinPlaces(picture, [{ id: "a", x: 10, y: 10 }, { id: "b", x: 300, y: 40 }, { id: "c", x: 200, y: 500 }], 86, seededRandom("x"));
  assert.equal(stopsFrom({ places: [], routes }, "a").size, 3);
});

/* -------------------------------------------- */
/*  What the windows show                       */
/* -------------------------------------------- */

/** Words that say which they are, so that a test can tell what was asked for. */
const i18n = {
  localize: (key) => key.replace(/^FEO\./, ""),
  format: (key, data) => `${key.replace(/^FEO\./, "")}(${Object.values(data).join(",")})`
};

test("a place may lie at sea, where it is waters", () => {
  const capital = world.places[0];
  assert.ok(FEO.worldMap.kinds.includes("waters"));
  assert.ok(!isLand(land, 40, 40));
  assert.equal(kindAt(land, 40, 40, "town"), "waters", "at sea a new place is waters whatever was picked");
  assert.equal(kindAt(land, capital.x, capital.y, "town"), "town");
  assert.equal(kindAt(land, capital.x, capital.y, "waters"), "waters", "waters can be put on land by picking them");
  assert.equal(kindAt(pictureLand("maps/own.webp", new Uint8ClampedArray(W * H * 4)), 40, 40, "town"), "town", "a picture is land all over");
  const named = placeName(seededRandom("w"), "waters", (key, name) => `${key}:${name}`);
  assert.match(named, /^waters\.[01]:[A-Z][a-z]+$/);
  assert.ok(PLACE_GLYPHS.waters);

  // It is kept as any other place is, joined to the shore by a sea lane, and can be marched to
  const draft = kept();
  draft.places.push({ id: "sea1", x: 40, y: 40, kind: "waters", name: "Aldmere Strait", seen: true });
  const port = draft.places.find((place) => place.kind === "port");
  assert.equal(toggleRoute(land, draft, port.id, "sea1", () => 0.5), true);
  const map = cleanWorldMap(draft);
  const waters = map.places.find((place) => place.id === "sea1");
  assert.deepEqual([waters.kind, waters.x, waters.y], ["waters", 40, 40]);
  assert.equal(map.routes.at(-1).kind, "sea");
  assert.ok(pathBetween(map, map.party, "sea1"));
  arriveAt(map, "sea1");
  assert.equal(map.party, "sea1");

  // It is nobody's, and is said to lie in the sea
  const claims = unpackClaims(map.claims, W * H);
  assert.equal(nationAt(land, claims, 40, 40), 0);
  assert.equal(holderTitle(null, land, waters, i18n), "WorldMap.sea");
  assert.equal(holderTitle(null, land, { x: 0, y: 0 }, i18n), "WorldMap.sea");
  assert.equal(holderTitle(map.nations[0], land, waters, i18n), nationTitle(map.nations[0], i18n));
  const plate = buildWorldMap({ map, land, claims, isGM: true }, i18n).plate;
  assert.equal(plate.over, "WorldMap.kind.waters · WorldMap.sea");
  assert.equal(buildArrival({ map, land, claims, isGM: true }, i18n).under, "WorldMap.kind.waters · WorldMap.sea");
  const editing = buildCreator({ draft: map, land, claims, count: 5, nation: 0, brush: "medium", kind: "town", tool: "places", selected: "sea1" }, i18n).place;
  assert.equal(editing.nation, "WorldMap.sea");
  assert.equal(editing.kinds.find((kind) => kind.on).key, "waters");
  assert.equal(editing.kinds.length, FEO.worldMap.kinds.length);

  // Open sea a Game Master picked out is named for what it is
  const lie = { sea: 1, seaSide: "around", wood: 0, hills: 0, peaks: 0, arid: 0, frost: 0 };
  const bare = buildWorldMap({ map, land, claims, isGM: true, ground: { x: 60, y: 50, lie } }, i18n).plate;
  assert.deepEqual([bare.name, bare.over], ["MapGen.lie.sea", "WorldMap.sea"]);
});

test("the plate tells of the place picked out, and offers what the reader may do there", () => {
  const map = kept();
  const claims = unpackClaims(map.claims, W * H);
  const seen = map.places.find((place) => place.seen && (place.id !== map.party));
  const hidden = map.places.find((place) => !place.seen);
  const acts = (context) => context.plate.actions.map((act) => act.action);
  const chips = (context) => context.plate.chips.map((chip) => chip.label);
  const act = (context, action) => context.plate.actions.find((other) => other.action === action);

  // Nothing picked: the place the company is at, which is the Base
  const home = buildWorldMap({ map, land, claims, isGM: true }, i18n);
  assert.equal(home.plate.id, map.party);
  assert.deepEqual(chips(home), ["WorldMap.chip.here", "WorldMap.chip.base"]);
  assert.deepEqual(acts(home), ["field", "base"]);
  assert.equal(home.plate.away, null);
  assert.equal(home.legend.length, 5);
  assert.equal(home.summary, `WorldMap.summary(5,${map.places.length})`);

  // The Game Master sends the company; a player can only point
  const gm = buildWorldMap({ map, land, claims, selected: seen.id, isGM: true }, i18n);
  assert.deepEqual(acts(gm), ["field", "veil", "march"]);
  assert.ok(gm.plate.away.count >= 1);
  assert.ok(!act(gm, "march").disabled);
  assert.ok(act(buildWorldMap({ map, land, claims, selected: seen.id, isGM: true, marching: true }, i18n), "march").disabled);
  const player = buildWorldMap({ map, land, claims, selected: seen.id, isGM: false }, i18n);
  assert.deepEqual(acts(player), ["point"]);
  assert.equal(player.summary, `WorldMap.summary(5,${map.places.filter((place) => place.seen).length})`);

  // A place the players have not found is the Game Master's alone
  assert.ok(chips(buildWorldMap({ map, land, claims, selected: hidden.id, isGM: true }, i18n)).includes("WorldMap.chip.hidden"));
  assert.equal(buildWorldMap({ map, land, claims, selected: hidden.id, isGM: false }, i18n).plate.id, map.party);

  // A battle where the company stands: begun from its saved encounter, or marked as won
  const there = map.places.find((place) => place.id === map.party);
  Object.assign(there, { battle: true, encounter: "e1" });
  const encounterOf = () => ({ name: "Bandits on the road", objectives: { seize: false, rout: true } });
  const battle = buildWorldMap({ map, land, claims, isGM: true, encounterOf }, i18n);
  assert.deepEqual(acts(battle), ["field", "won", "begin", "base"]);
  assert.ok(!act(battle, "begin").disabled);
  assert.deepEqual(battle.plate.chips.at(-1), { icon: "crossed", cls: "wm-battle", label: "Bandits on the road", strong: "Encounter.objective.rout.label" });
  const byHand = buildWorldMap({ map, land, claims, isGM: true }, i18n);
  assert.ok(act(byHand, "begin").disabled, "a battle with no encounter is run by hand");
  assert.deepEqual(acts(buildWorldMap({ map, land, claims, isGM: false, encounterOf }, i18n)), ["base"]);

  // A battlefield made of a place is told to the Game Master, who can pick bare ground out to make one of
  const fieldOf = (place) => place.id === seen.id;
  assert.ok(chips(buildWorldMap({ map, land, claims, selected: seen.id, isGM: true, fieldOf }, i18n)).includes("WorldMap.chip.field"));
  assert.ok(!chips(buildWorldMap({ map, land, claims, selected: seen.id, isGM: false, fieldOf }, i18n)).includes("WorldMap.chip.field"));
  const lie = { sea: 0.3, seaSide: "south", wood: 0, hills: 0, peaks: 0, arid: 0, frost: 0 };
  const bare = buildWorldMap({ map, land, claims, selected: seen.id, isGM: true, ground: { x: seen.x + 9, y: seen.y, lie } }, i18n);
  assert.equal(bare.plate.id, "");
  assert.equal(bare.plate.name, "MapGen.lie.coast");
  assert.deepEqual(acts(bare), ["field"]);
  assert.equal(buildWorldMap({ map, land, claims, selected: seen.id, isGM: false, ground: { x: 5, y: 5, lie } }, i18n).plate.id, seen.id);

  // A world with no map yet
  assert.deepEqual(buildWorldMap({ map: cleanWorldMap(), isGM: false }, i18n), { made: false, isGM: false, none: "WorldMap.none.player" });
});

test("an arrival names the place the company has come to, and offers what may be done there at once", () => {
  const map = kept();
  const claims = unpackClaims(map.claims, W * H);
  const acts = (splash) => splash.actions.map((act) => act.action);

  // Nothing is shown across the map until the company has just arrived
  assert.equal(buildWorldMap({ map, land, claims, isGM: true }, i18n).splash, null);

  // At the Base anyone may go in, so the arrival waits for an answer
  const home = buildWorldMap({ map, land, claims, isGM: false, arrived: true }, i18n).splash;
  assert.equal(home.tone, "home");
  assert.equal(home.over, "WorldMap.arrive.home");
  assert.deepEqual(acts(home), ["base", "dismiss"]);
  assert.ok(home.stays);

  // Anywhere else it tells where the company is, asks nothing, and does not stay
  const away = map.places.find((place) => place.id !== map.base);
  arriveAt(map, away.id);
  const plain = buildArrival({ map, land, claims, isGM: true }, i18n);
  assert.equal(plain.tone, "plain");
  assert.equal(plain.name, away.name);
  assert.ok(plain.under.startsWith(`WorldMap.kind.${away.kind} · `));
  assert.deepEqual(plain.actions, []);
  assert.ok(!plain.stays);

  // A battle is begun by the Game Master from its saved encounter; a player is only told of it
  Object.assign(away, { battle: true, encounter: "e1" });
  const encounterOf = () => ({ name: "Bandits on the road", objectives: {} });
  const battle = buildArrival({ map, land, claims, isGM: true, encounterOf }, i18n);
  assert.equal(battle.tone, "battle");
  assert.equal(battle.under, `Bandits on the road · ${plain.under}`);
  assert.deepEqual(acts(battle), ["begin", "dismiss"]);
  const told = buildArrival({ map, land, claims, isGM: false, encounterOf }, i18n);
  assert.equal(told.under, battle.under);
  assert.ok(!told.stays);
  const byHand = buildArrival({ map, land, claims, isGM: true }, i18n);
  assert.equal(byHand.over, "WorldMap.arrive.battle");
  assert.ok(!byHand.stays, "a battle with no encounter is run by hand");

  // A world with no map has nowhere to arrive
  assert.equal(buildArrival({ map: cleanWorldMap(), isGM: true }, i18n), null);
});

test("the Creator's tools show what the tool in hand works on", () => {
  const draft = kept();
  const claims = unpackClaims(draft.claims, W * H);
  const chosen = { draft, land, claims, count: 5, nation: 2, brush: "medium", kind: "town" };

  const made = buildCreator({ ...chosen, tool: "land" }, i18n);
  assert.deepEqual(made.tabs.map((tab) => tab.on), [true, false, false, false]);
  assert.equal(made.land.shapes.find((shape) => shape.on).key, "continent");
  assert.ok(made.land.fewer && made.land.more);
  assert.ok(!buildCreator({ ...chosen, count: 8, tool: "land" }, i18n).land.more);

  const nations = buildCreator({ ...chosen, tool: "nations" }, i18n).nations;
  assert.deepEqual(nations.rows.map((row) => row.on), [false, true, false, false, false]);
  assert.equal(nations.picked.title, nationTitle(draft.nations[1], i18n));
  assert.equal(nations.rows.reduce((sum, row) => sum + Number(row.places.match(/\d+/)[0]), 0),
    draft.places.filter((place) => nationAt(land, claims, place.x, place.y)).length);
  assert.ok(buildCreator({ ...chosen, nation: 0, tool: "nations" }, i18n).nations.nobody);

  const adding = buildCreator({ ...chosen, tool: "places" }, i18n);
  assert.equal(adding.adding.kinds.find((kind) => kind.on).key, "town");
  const place = draft.places[3];
  const editing = buildCreator({ ...chosen, tool: "places", selected: place.id, encounters: [{ id: "e1", name: "" }] }, i18n).place;
  assert.equal(editing.name, place.name);
  assert.equal(editing.base, place.id === draft.base);
  assert.deepEqual(editing.encounters.map((encounter) => encounter.name), ["WorldMap.place.noEncounter", "WorldMap.place.unnamed"]);

  const routes = buildCreator({ ...chosen, tool: "routes", linking: place.id }, i18n).routes;
  const lanes = draft.routes.filter((route) => route.kind === "sea").length;
  assert.equal(routes.count, `WorldMap.routes.count(${draft.routes.length - lanes},${lanes},${draft.places.length})`);
  assert.equal(routes.next, `WorldMap.routes.from(${place.name})`);
});

test("what lies over the map is drawn for whoever looks at it", () => {
  const map = kept();
  const claims = unpackClaims(map.claims, W * H);
  map.places[0].name = "<Keep & \"Hold\">";
  const draw = (shown) => overlayMarkup({
    places: map.places, routes: map.routes, nations: map.nations, facts: nationFacts(land, claims, map.nations), base: map.base,
    party: map.party, shown, veiled: (place) => !place.seen, named: () => false, selected: map.places[0].id
  });
  const all = draw(() => true);
  const some = draw((place) => place.seen);
  const count = (text, part) => text.split(part).length - 1;
  assert.equal(count(all.places, 'class="wm-node'), map.places.length);
  assert.equal(count(some.places, 'class="wm-node'), map.places.filter((place) => place.seen).length);
  assert.equal(count(all.routes, 'class="wm-route'), map.routes.length);
  assert.ok(count(some.routes, 'class="wm-route') < map.routes.length);
  assert.equal(count(some.routes, "wm-veiled"), 0);
  assert.ok(count(all.places, "wm-veiled") > 0);
  assert.equal(count(all.names, "<text"), 5);
  assert.equal(count(all.places, "wm-home"), 1);
  assert.ok(all.places.includes("&lt;Keep &amp; &quot;Hold&quot;&gt;") && !all.places.includes("<Keep"));
  assert.ok(all.party.includes("wm-party"));
});

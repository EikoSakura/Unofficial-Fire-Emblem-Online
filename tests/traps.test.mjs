/**
 * Tests for `module/rules/traps.mjs` and what reads it: the Mines and Traps of the Items tab as things that
 * lie on a map, what a skill adds to those its unit lays (Sapper), and the skill that takes them away
 * (Thievery), both as they are written in effects.json. Run with `node --test tests/` or
 * `node tests/traps.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { eventsAlong } from "../module/rules/reactions.mjs";
import { checkEffects, skillKnacks } from "../module/rules/skills.mjs";
import { checkKnacks, disarmerOf } from "../module/rules/stealing.mjs";
import {
  addLaid, checkLaid, emptyLaid, isMine, layTiles, makeTrap, normalizeTrap, seesTrap, springs, sprung, trapOfItem, trapsAt,
  warpReaches
} from "../module/rules/traps.mjs";
import { builtEffects, skill } from "./lib/fixtures.mjs";

/** The Mines and Traps of the Items tab, with their Effects as the tab words them. */
const ITEMS = {
  "Mine": "Traps 1 adjacent space: Units passing over the trapped space are halted and take 10 damage. Lasts until it is activated.",
  "Frey Bomb": "Traps 1 adjacent space: Units passing over the trapped space are halted and take 20 damage. Lasts until it is activated.",
  "Bear Trap": "Traps 1 adjacent space: Units passing over the trapped space are halted and take 3 damage, and inflicted with Bleed and Bind. Lasts until it is activated.",
  "Warp Trap": "Traps 1 adjacent space: Warps units crossing over the trap to a tile set by \nthe unit placing the trap within a range of  1-8 of the trap. Environmental \nwarp traps can warp a unit to any space. Lasts for the rest of the map.",
  "Silence Trap": "Traps 1 adjacent space: Units passing over the trapped space are halted and\ngiven the Silence condition. Lasts until it is activated.",
  "Stun Mine": "Traps 1 adjacent space: Units passing over the trapped space are halted and\ngiven the Stun condition. Lasts until it is activated.",
  "Sleep Trap": "Traps 1 adjacent space: Units passing over the trapped space are halted and\ngiven the Sleep condition. Lasts until it is activated.",
  "Poison Trap": "Traps 1 adjacent space: Units passing over the trapped space are halted and\ngiven the Poison condition. Lasts until it is activated."
};
const item = (name) => trapOfItem({ name, effect: ITEMS[name] });
const knacksOf = (...names) => skillKnacks(names.map((name) => skill(name)), { hp: 20, hpMax: 20, level: 5, stats: {} });
const sapper = () => knacksOf("Sapper").laid;
const hero = { actor: "Actor.hero", token: "tokenHero", side: "player" };

/* -------------------------------------------- */
/*  Reading the Items                           */
/* -------------------------------------------- */

test("each Mine and Trap of the Items tab is read from its Effect", () => {
  assert.deepEqual(item("Mine"), { name: "Mine", kind: "mine", range: 1, halts: true, damage: 10, inflicts: [], warp: null, lasts: "sprung" });
  assert.deepEqual([item("Frey Bomb").kind, item("Frey Bomb").damage], ["mine", 20]);
  const bear = item("Bear Trap");
  assert.deepEqual([bear.kind, bear.damage, [...bear.inflicts].sort(), bear.halts], ["trap", 3, ["bind", "bleed"], true]);
  for ( const [name, condition] of [["Silence Trap", "silence"], ["Stun Mine", "stun"], ["Sleep Trap", "sleep"], ["Poison Trap", "poison"]] ) {
    assert.deepEqual([item(name).inflicts, item(name).damage, item(name).halts], [[condition], 0, true], name);
  }
  const warp = item("Warp Trap");
  assert.deepEqual([warp.warp, warp.lasts, warp.damage, warp.inflicts], [{ from: 1, within: 8 }, "map", 0, []]);
});

test("an item that traps no space is no trap, and a Mine is told from a Trap by its name", () => {
  assert.equal(trapOfItem({ name: "Vulnerary", effect: "Restores 10 HP." }), null);
  assert.equal(trapOfItem({ name: "Door Key", effect: "Opens a door." }), null);
  assert.equal(trapOfItem(null), null);
  assert.deepEqual(["Mine", "Frey Bomb", "Stun Mine"].map(isMine), [true, true, true]);
  assert.deepEqual(["Bear Trap", "Warp Trap", "Sleep Trap", "Miner's Pick"].map(isMine), [false, false, false, false]);
});

/* -------------------------------------------- */
/*  Laying, Seeing and Springing                */
/* -------------------------------------------- */

test("a trap is laid on one of the four tiles next to its unit", () => {
  const tiles = layTiles({ i: 5, j: 5 }, 1).map((tile) => `${tile.i},${tile.j}`).sort();
  assert.deepEqual(tiles, ["4,5", "5,4", "5,6", "6,5"]);
});

test("a trap lies hidden from the other side: only the Game Master and the side that laid it see it", () => {
  const mine = makeTrap(item("Mine"), { i: 2, j: 3 }, { id: "m", by: hero });
  assert.equal(seesTrap(mine, { gm: true }), true);
  assert.equal(seesTrap(mine, {}), true, "a player sees what the players' side laid");
  const theirs = makeTrap(item("Mine"), { i: 2, j: 3 }, { id: "e", by: { actor: "Actor.bandit", token: "t", side: "enemy" } });
  assert.equal(seesTrap(theirs, {}), false);
  assert.equal(seesTrap(theirs, { owns: true }), true);
  assert.equal(seesTrap(theirs, { gm: true }), true);
  const allied = makeTrap(item("Mine"), { i: 2, j: 3 }, { id: "a", by: { actor: "Actor.ally", token: "t", side: "ally" } });
  assert.equal(seesTrap(allied, {}), true, "allies of the players' side lay theirs in the open");

  // One the Game Master set down belongs to nobody, and only the Game Master sees it
  const set = makeTrap(item("Mine"), { i: 2, j: 3 }, { id: "g" });
  assert.deepEqual([set.by, set.side], ["", ""]);
  assert.equal(seesTrap(set, {}), false);
  assert.equal(seesTrap(set, { gm: true }), true);
});

test("a unit springs a trap by walking onto it or waiting on it; one that flies only by waiting, its layer never", () => {
  const mine = makeTrap(item("Mine"), { i: 2, j: 3 }, { id: "m", by: hero });
  const walker = { actor: "Actor.bandit", flies: false };
  const flier = { actor: "Actor.wyvern", flies: true };
  assert.equal(springs(mine, walker, "walk"), true);
  assert.equal(springs(mine, walker, "wait"), true);
  assert.equal(springs(mine, flier, "walk"), false);
  assert.equal(springs(mine, flier, "wait"), true);
  assert.equal(springs(mine, { actor: "Actor.hero", flies: false }, "walk"), false);
  assert.equal(springs(mine, { actor: "Actor.hero", flies: false }, "wait"), false);

  // A unit of the side that laid it springs it all the same, and so does anyone one that nobody laid
  assert.equal(springs(mine, { actor: "Actor.friend", flies: false }, "walk"), true);
  assert.equal(springs(makeTrap(item("Mine"), { i: 0, j: 0 }), walker, "walk"), true);
});

test("a walking unit is caught on the tile the trap lies on, and its move ends there", () => {
  const mine = makeTrap(item("Mine"), { i: 0, j: 2 }, { id: "m", by: hero });
  const way = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 0, j: 3 }];
  const trap = { id: mine.id, tile: { i: mine.i, j: mine.j }, by: mine.token, skill: mine.name, who: "any", halts: mine.halts, strike: false, laid: mine };
  const events = eventsAlong(way, { traps: [trap] });
  assert.deepEqual(events.map((event) => [event.kind, event.at]), [["trap", 2]]);
  assert.equal(sprung(mine).halts, true);
  assert.equal(eventsAlong(way.slice(0, 2), { traps: [trap] }).length, 0);
});

test("what each kind does when it is sprung", () => {
  const out = (name, options) => sprung(makeTrap(item(name), { i: 0, j: 0 }, { id: name }), options);
  assert.deepEqual([out("Mine").damage, out("Mine").inflicts, out("Mine").halts, out("Mine").gone], [10, [], true, true]);
  assert.equal(out("Frey Bomb").damage, 20);
  const bear = out("Bear Trap");
  assert.equal(bear.damage, 3);
  assert.deepEqual(bear.inflicts.map((entry) => [entry.id, entry.turns]).sort(), [["bind", FEO.conditions.bind.turns], ["bleed", FEO.conditions.bleed.turns]]);
  assert.deepEqual(out("Silence Trap").inflicts, [{ id: "silence", turns: FEO.conditions.silence.turns }]);
  assert.deepEqual(out("Stun Mine").inflicts, [{ id: "stun", turns: FEO.conditions.stun.turns }]);
  assert.deepEqual(out("Sleep Trap").inflicts, [{ id: "sleep", turns: FEO.conditions.sleep.turns }]);
  assert.deepEqual(out("Poison Trap").inflicts, [{ id: "poison", turns: FEO.conditions.poison.turns }]);
});

test("a Warp Trap sends a unit to the tile picked as it was laid, 1 to 8 spaces from it, and stays for the map", () => {
  const at = { i: 5, j: 5 };
  const warp = item("Warp Trap").warp;
  assert.equal(warpReaches(at, { i: 5, j: 6 }, warp), true);
  assert.equal(warpReaches(at, { i: 9, j: 9 }, warp), true);
  assert.equal(warpReaches(at, { i: 5, j: 14 }, warp), false);
  assert.equal(warpReaches(at, at, warp), false);
  const laid = makeTrap(item("Warp Trap"), at, { id: "w", warp: { i: 9, j: 9 }, by: hero });
  const out = sprung(laid);
  assert.deepEqual([out.warp, out.gone, out.halts, out.damage], [{ i: 9, j: 9 }, false, true, 0]);

  // A trap that does not warp keeps no tile to warp to, whatever it is told
  assert.equal(makeTrap(item("Mine"), at, { warp: { i: 1, j: 1 } }).warp, null);
});

test("what lies on a tile is found by its tile, and a trap that was saved is read back as it was", () => {
  const a = makeTrap(item("Mine"), { i: 1, j: 1 }, { id: "a", by: hero, laid: sapper() });
  const b = makeTrap(item("Sleep Trap"), { i: 1, j: 2 }, { id: "b" });
  assert.deepEqual(trapsAt([a, b], { i: 1, j: 2 }).map((trap) => trap.id), ["b"]);
  assert.deepEqual(trapsAt([a, b], { i: 3, j: 3 }), []);
  assert.deepEqual(normalizeTrap(JSON.parse(JSON.stringify(a))), a);
  assert.equal(normalizeTrap({ name: "Mine" }), null);
  assert.equal(normalizeTrap({ i: 0, j: 0, name: "Mine", inflicts: ["nonsense"] }).inflicts.length, 0);
});

/* -------------------------------------------- */
/*  Sapper                                      */
/* -------------------------------------------- */

test("the effects of Sapper pass the build's checks, and are read as what its unit's mines and traps have more", () => {
  assert.deepEqual(checkEffects(builtEffects("Sapper")), []);
  assert.deepEqual(sapper(), { mines: 5, turns: 1, exp: 10, kill: 25, skill: "Sapper" });
  assert.deepEqual(knacksOf().laid, emptyLaid());
  assert.ok(checkLaid({ mine: 5 }).length > 0);
  assert.ok(checkLaid({ mines: 0 }).length > 0);
  assert.ok(checkKnacks({ laid: {} }).length > 0);
  assert.deepEqual(addLaid(addLaid(emptyLaid(), { mines: 5 }, { skill: "A" }), { mines: 2, exp: 3 }, { skill: "B" }), { mines: 7, turns: 0, exp: 3, kill: 0, skill: "A" });
});

test("Sapper: its unit's Mines deal +5 damage", () => {
  const by = { by: hero, laid: sapper() };
  assert.equal(makeTrap(item("Mine"), { i: 0, j: 0 }, by).damage, 15);
  assert.equal(makeTrap(item("Frey Bomb"), { i: 0, j: 0 }, by).damage, 25);

  // A Bear Trap is no Mine, and a Stun Mine deals no damage to add to
  assert.equal(makeTrap(item("Bear Trap"), { i: 0, j: 0 }, by).damage, 3);
  assert.equal(makeTrap(item("Stun Mine"), { i: 0, j: 0 }, by).damage, 0);
  assert.equal(makeTrap(item("Mine"), { i: 0, j: 0 }, { by: hero }).damage, 10);
});

test("Sapper: the conditions its unit's Traps give last one turn longer", () => {
  const by = { by: hero, laid: sapper() };
  const turns = (name, options) => Object.fromEntries(sprung(makeTrap(item(name), { i: 0, j: 0 }, options)).inflicts.map((entry) => [entry.id, entry.turns]));
  assert.deepEqual(turns("Sleep Trap", by), { sleep: FEO.conditions.sleep.turns + 1 });
  assert.deepEqual(turns("Bear Trap", by), { bleed: FEO.conditions.bleed.turns + 1, bind: FEO.conditions.bind.turns + 1 });
  assert.deepEqual(turns("Stun Mine", by), { stun: FEO.conditions.stun.turns + 1 });
  assert.deepEqual(turns("Sleep Trap", { by: hero }), { sleep: FEO.conditions.sleep.turns });
});

test("Sapper: +10 EXP as an enemy springs one, and +25 as a Mine's damage defeats one", () => {
  const by = { by: hero, laid: sapper() };
  const mine = makeTrap(item("Mine"), { i: 0, j: 0 }, by);
  assert.deepEqual([sprung(mine, { enemy: true }).exp, sprung(mine, { enemy: true }).kill], [10, 25]);

  // A unit that is no enemy of its springs it for nothing
  assert.deepEqual([sprung(mine, { enemy: false }).exp, sprung(mine, { enemy: false }).kill], [0, 0]);

  // A Trap earns the 10, and nothing for a kill; a Stun Mine has no damage to defeat anyone with
  const bear = makeTrap(item("Bear Trap"), { i: 0, j: 0 }, by);
  assert.deepEqual([sprung(bear, { enemy: true }).exp, sprung(bear, { enemy: true }).kill], [10, 0]);
  assert.equal(sprung(makeTrap(item("Stun Mine"), { i: 0, j: 0 }, by), { enemy: true }).kill, 0);

  // One the Game Master set down earns nobody anything, and one laid without the skill neither
  assert.equal(sprung(makeTrap(item("Mine"), { i: 0, j: 0 }, { laid: sapper() }), { enemy: true }).exp, 0);
  assert.equal(sprung(makeTrap(item("Mine"), { i: 0, j: 0 }, { by: hero }), { enemy: true }).exp, 0);
});

/* -------------------------------------------- */
/*  Thievery                                    */
/* -------------------------------------------- */

test("Thievery: its unit disarms the mines and traps it walks over or waits on, and nothing is left of it", () => {
  assert.deepEqual(checkEffects(builtEffects("Thievery")), []);
  const thief = knacksOf("Thievery");
  assert.equal(disarmerOf(thief), "Thievery");
  assert.equal(disarmerOf(knacksOf("Sapper")), null);

  // It is asked wherever a trap would be sprung: walking onto it, and waiting on it
  const mine = makeTrap(item("Mine"), { i: 0, j: 0 }, { id: "m", by: { actor: "Actor.bandit", token: "t", side: "enemy" } });
  assert.equal(springs(mine, { actor: "Actor.thief", flies: false }, "walk"), true);
  assert.equal(springs(mine, { actor: "Actor.thief", flies: false }, "wait"), true);

  // The steal command and the doors and chests it opens are as they were
  assert.deepEqual([thief.steals, thief.opens, thief.disarms], [true, ["door", "chest"], true]);
});

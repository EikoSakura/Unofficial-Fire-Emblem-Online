/**
 * Tests for trading and the free commands of a turn (`module/rules/trading.mjs`): who may trade with whom,
 * what changes hands, when a Trade or a Shift ends its unit's move; and for the forecast's count of a critical
 * hit that is certain (`sureCritical` in `module/rules/combat.mjs`). Run with `node --test tests/` or
 * `node tests/trading.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { CANTO_ACTIONS, addCanto, emptyCanto } from "../module/rules/canto.mjs";
import { planExchange, resolveExchange, sureCritical } from "../module/rules/combat.mjs";
import { surroundings } from "../module/rules/positions.mjs";
import { FREE_COMMANDS, canTrade, endsMove, readTrade, tradable, tradeRows } from "../module/rules/trading.mjs";
import { fighter, skill } from "./lib/fixtures.mjs";

const at = (i, j) => ({ i, j });
const sword = { id: "s1", name: "Iron Sword", type: "weapon", weight: 5, equipped: true };
const vulnerary = { id: "v1", name: "Vulnerary", type: "gear" };
const fists = { id: "f1", name: "Summoned Blade", type: "weapon", bound: true };

/* -------------------------------------------- */
/*  Who Trades With Whom                        */
/* -------------------------------------------- */

test("a unit trades with an ally next to it, and with nobody else", () => {
  const mine = { tile: at(2, 2), items: [sword] };
  const ally = { tile: at(2, 3), relation: "friend", items: [vulnerary] };
  assert.equal(canTrade(mine, ally).ok, true);

  // Two spaces away, or corner to corner
  assert.equal(canTrade(mine, { ...ally, tile: at(2, 4) }).why, "apart");
  assert.equal(canTrade(mine, { ...ally, tile: at(3, 3) }).why, "apart");

  // An enemy, and a unit of a side that fights with nobody
  assert.equal(canTrade(mine, { ...ally, relation: "foe" }).why, "side");
  assert.equal(canTrade(mine, { ...ally, relation: "apart" }).why, "side");

  // A unit that is out of the fight
  assert.equal(canTrade(mine, { ...ally, out: true }).why, "out");

  // A pack that is locked, on either side
  assert.equal(canTrade({ ...mine, locked: true }, ally).why, "locked");
  assert.equal(canTrade(mine, { ...ally, locked: true }).why, "locked");
});

test("one of the two must carry something that changes hands", () => {
  const mine = { tile: at(0, 0), items: [] };
  const ally = { tile: at(0, 1), relation: "friend", items: [] };
  assert.equal(canTrade(mine, ally).why, "empty");
  assert.equal(canTrade({ ...mine, items: [fists] }, ally).why, "nothing");

  // An ally with an empty pack can still be given something
  assert.equal(canTrade({ ...mine, items: [vulnerary] }, ally).ok, true);

  // And a unit with an empty pack can take
  assert.equal(canTrade(mine, { ...ally, items: [sword] }).ok, true);
});

test("anything in a pack may be traded, also what is in hand, save what never changes hands", () => {
  assert.deepEqual(tradable(sword), { ok: true, why: null });
  assert.deepEqual(tradable({ ...vulnerary, worn: true }), { ok: true, why: null });
  assert.deepEqual(tradable(fists), { ok: false, why: "bound" });
});

test("the rows of a trade say which way each item goes, and are read back", () => {
  const tried = canTrade({ tile: at(0, 0), items: [sword, fists] }, { tile: at(1, 0), relation: "friend", items: [vulnerary] });
  const rows = tradeRows(tried);
  assert.deepEqual(rows.map((row) => [row.id, row.way, row.item.ok]), [["give:s1", "give", true], ["give:f1", "give", false], ["take:v1", "take", true]]);
  assert.deepEqual(readTrade("give:s1"), { way: "give", item: "s1" });
  assert.deepEqual(readTrade("take:v1"), { way: "take", item: "v1" });
  assert.equal(readTrade(null), null);
  assert.equal(readTrade("steal:v1"), null);
  assert.equal(readTrade("give:"), null);
});

/* -------------------------------------------- */
/*  What a Free Command Leaves of the Move      */
/* -------------------------------------------- */

test("Trade and Shift are free commands that Canto knows of", () => {
  for ( const kind of FREE_COMMANDS ) assert.ok(CANTO_ACTIONS.includes(kind), kind);
});

test("a Trade or a Shift ends its unit's move, unless a skill lets it move on after it", () => {
  // No skill at all
  assert.equal(endsMove(null, "trade"), true);
  assert.equal(endsMove(emptyCanto(), "shift"), true);

  // Canto+ as the rulebook lists it: after trading, but Shifting only with Feral Instincts
  const plus = addCanto(emptyCanto(), { after: ["attack", "item", "trade", "rescue"] }, { skill: "Canto+" });
  assert.equal(endsMove(plus, "trade"), false);
  assert.equal(endsMove(plus, "shift"), true);

  // A skill that names Shifting lets its unit move on after a Shift it makes at will, as with Feral Instincts,
  // and after no other
  const feral = addCanto(emptyCanto(), { after: ["shift"] }, { skill: "Canto+" });
  assert.equal(endsMove(feral, "shift"), true);
  assert.equal(endsMove(feral, "shift", { atWill: true }), false);
  assert.equal(endsMove(emptyCanto(), "shift", { atWill: true }), true);
  assert.equal(endsMove(feral, "trade"), true);

  // Leave to move after any Action covers both, unless it leaves one out
  const any = addCanto(emptyCanto(), { after: "any" }, { skill: "Canto" });
  assert.equal(endsMove(any, "trade"), false);
  const but = addCanto(emptyCanto(), { after: "any", not: ["trade"] }, { skill: "Canto" });
  assert.equal(endsMove(but, "trade"), true);
  assert.equal(endsMove(but, "shift"), true);
  assert.equal(endsMove(but, "shift", { atWill: true }), false);

  // Anything that is no free command ends no move by this rule
  assert.equal(endsMove(null, "attack"), false);
});

test("Canto+ as the system has it lets its unit move on after trading", () => {
  const entry = FEO.cantoPlus;
  const canto = addCanto(emptyCanto(), { after: entry.after, not: entry.not, except: entry.except }, { skill: "Canto+" });
  assert.equal(endsMove(canto, "trade"), false);
});

/* -------------------------------------------- */
/*  A Critical Hit That Is Certain              */
/* -------------------------------------------- */

test("the forecast counts a critical hit that is certain, and no other", () => {
  assert.equal(sureCritical({ damage: 10, crit: 100 }, 3), 30);
  assert.equal(sureCritical({ damage: 10, crit: 99 }, 3), 10);
  assert.equal(sureCritical({ damage: 10 }, 3), 10);
  assert.equal(sureCritical({ damage: 7, crit: 100 }, 3.5), 24);

  // What the hit deals again as damage of an element is not multiplied
  assert.equal(sureCritical({ damage: 12, crit: 100, echo: 2 }, 3), 32);
  assert.equal(sureCritical(null, 3), 0);
});

test("a Triangle Attack is forecast as the critical hit the fight then deals", () => {
  const measure = (a, b) => Math.abs(a.tile.i - b.tile.i) + Math.abs(a.tile.j - b.tile.j);
  const token = (id, side, tile, more = {}) => ({ id, actor: `Actor.${id}`, name: id.toUpperCase(), side, tile: at(...tile), hp: 20, hpMax: 20, level: 5, stats: {}, skills: [], ...more });
  const units = [
    token("a", "player", [1, 0]), token("b", "enemy", [1, 1]),
    token("p", "player", [0, 1], { skills: [skill("Triangle Attack")] }), token("q", "player", [1, 2], { skills: [skill("Triangle Attack")] })
  ];
  const a = { ...fighter({ name: "A", skills: [skill("Triangle Attack")], weapon: { hit: 60 }, stats: { spd: 20 } }), near: surroundings(units, "a", measure) };
  const b = { ...fighter({ name: "B", hp: 60, hpMax: 60 }), near: surroundings(units, "b", measure) };
  const plan = planExchange(a, b, { distance: 1 });
  const result = resolveExchange(plan, () => 99);
  const first = result.attacks.find((attack) => attack.side === "initiator");
  assert.equal(first.crit, true);
  assert.equal(sureCritical(plan.initiator.blows[0], FEO.critMultiplier), first.damage);

  // The attack after it is no certain critical hit, and is counted as it was
  assert.equal(sureCritical(plan.initiator.blows[1], FEO.critMultiplier), plan.initiator.blows[1].damage);
});

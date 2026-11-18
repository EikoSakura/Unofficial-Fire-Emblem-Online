/**
 * Tests for reactions (`module/rules/reactions.mjs`): what a unit reacts to and how often, what comes of a move
 * along its way, the traps laid on a tile, the units that strike an enemy which hurt an ally, and the units
 * enemies do not see.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planExchange } from "../module/rules/combat.mjs";
import {
  HIDDEN, RALLY_MARK, avengersOf, checkReacts, checkTrap, eventsAlong, halfMov, haltsAfter, layTrap, noteReact, reactOf, reactsLeft,
  trapCatches, trapOf, unseenBy, withinSpaces
} from "../module/rules/reactions.mjs";
import { RULES, checkEffects, skillStanding, useMoment } from "../module/rules/skills.mjs";
import { buildChange, cleanChange, timedEntries } from "../module/rules/timed.mjs";
import { fighter, skill } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../packs-src/skills/effects.json", import.meta.url)), "utf8")).skills;

const WHO = { name: "Picket", uuid: "Actor.Picket", hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null, near: null };
const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = (options = {}) => fighter({ name: "B", hp: 30, hpMax: 30, ...options });

/** What a unit reacts with once it has used a skill that has it Hold, with the skills it has equipped. */
function holding(name, equipped = []) {
  const used = useMoment(skill(name), WHO, () => 100);
  const [change] = used.entries.flatMap((entry) => entry.granted.map((given) => given.change));
  return skillStanding([...equipped, ...timedEntries([change])], WHO).reacts;
}

/** A row of tiles, from one column to another. */
const row = (i, from, to) => Array.from({ length: Math.abs(to - from) + 1 }, (_, n) => ({ i, j: from + (Math.sign(to - from) * n) }));

/** A unit that watches from a tile with a weapon that reaches so far. */
const watcher = (id, tile, react, { min = 1, max = 1 } = {}) => ({
  id, tile, react,
  covers: (place) => withinSpaces(tile, place, min, max) || ((react.near > 0) && withinSpaces(tile, place, 1, react.near))
});

/* -------------------------------------------- */
/*  What a Unit Reacts With                     */
/* -------------------------------------------- */

test("a reaction says what it is to, how far it reaches and what its unit does", () => {
  assert.equal(reactOf(null), null);
  assert.equal(reactOf({ to: "dance" }), null);
  assert.deepEqual(checkReacts({ to: "move", within: "weapon", fight: true, halts: "hurt", once: "turn", may: true }), []);
  assert.deepEqual(checkReacts({ to: "allyHurt", within: "weapon", strike: true }), []);
  assert.deepEqual(checkReacts({ to: "pass", strike: true, moves: "half" }), []);
  assert.equal(checkReacts({ to: "move", within: "weapon" }).length, 2, "a reaction does something, and to a move that is a fight");
  assert.equal(checkReacts({ to: "move", fight: true, strike: true }).length, 1);
  assert.equal(checkReacts({ to: "move", fight: true, halts: "maybe" }).length, 1);
  assert.equal(checkReacts({ to: "enters", within: "mov", fight: true }).length, 1);
  assert.equal(checkReacts({ to: "move", fight: true, within: "sight" }).length, 1);
  assert.ok(RULES.includes(HIDDEN));

  // It is always there: not at a moment, not as an aura, and not hanging on a fight
  assert.equal(checkEffects([{ proc: { on: "start", sure: true }, reacts: { to: "allyHurt", strike: true } }]).length > 0, true);
  assert.equal(checkEffects([{ when: { role: "defending" }, reacts: { to: "allyHurt", strike: true } }]).length > 0, true);
  assert.deepEqual(checkEffects([{ when: { skill: "Overwatch" }, reacts: { to: "allyHurt", strike: true } }]), []);
});

test("Overwatch: an enemy that moves through, into or out of its attack range is stopped on the first tile within it", () => {
  const [react] = holding("Overwatch");
  const sentinel = watcher("sentinel", { i: 5, j: 5 }, react);

  // Walking past: it is stopped next to the unit, on the first tile the weapon reaches
  const past = eventsAlong(row(4, 2, 8), { watchers: [sentinel] });
  assert.deepEqual(past.map(({ kind, at, id, prevented }) => ({ kind, at, id, prevented })), [{ kind: "move", at: 3, id: "sentinel", prevented: false }]);
  assert.deepEqual(past[0].tile, { i: 4, j: 5 });

  // Setting out from a tile within range: the move is prevented before a step is taken
  const leaving = eventsAlong(row(4, 5, 8), { watchers: [sentinel] });
  assert.equal(leaving[0].at, 0);
  assert.equal(leaving[0].prevented, true);

  // Never coming within range: nothing; and a tile it only passes through an ally on is none it is stopped on
  assert.deepEqual(eventsAlong(row(2, 2, 8), { watchers: [sentinel] }), []);
  const lance = watcher("sentinel", { i: 5, j: 5 }, react, { min: 1, max: 2 });
  const through = eventsAlong(row(4, 2, 8), { watchers: [lance], stands: (tile) => tile.j !== 4 });
  assert.equal(through[0].at, 3, "the first tile within range that it can stand on");
  assert.deepEqual(eventsAlong(row(4, 2, 8), { watchers: [sentinel], done: ["sentinel|Overwatch"] }), [], "a reaction that was dealt with is not offered again");

  // Once a turn; an enemy that lost HP is halted, one that lost none walks on
  assert.deepEqual(reactsLeft(react, null, "foe"), { ok: true, halt: true });
  const noted = noteReact(null, react, "foe");
  assert.deepEqual(noted, { Overwatch: { count: 1, foes: ["foe"], halted: [] } });
  assert.equal(reactsLeft(react, noted, "foe").ok, false);
  assert.equal(reactsLeft(react, noted, "other").ok, false, "not against another enemy either");
  assert.equal(haltsAfter(react, { hurt: true }), true);
  assert.equal(haltsAfter(react, { hurt: false }), false);
});

test("Avert: it also reacts to an enemy that comes within 2 spaces, and that enemy's move ends whatever the fight took", () => {
  const [react] = holding("Avert");
  assert.equal(react.near, 2);
  assert.equal(react.halts, "always");
  assert.equal(react.once, "turn");
  const knight = watcher("knight", { i: 5, j: 5 }, react);
  const events = eventsAlong(row(3, 2, 8), { watchers: [knight] });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].tile, { i: 3, j: 5 }, "two spaces away, where a sword does not reach");
  assert.deepEqual(eventsAlong(row(2, 2, 8), { watchers: [knight] }), [], "three spaces away is too far");
  assert.equal(haltsAfter(react, { hurt: false }), true);
});

test("Sentry: it reacts to every enemy once and halts none; with Overwatch it fights better and may halt one", () => {
  const [plain] = holding("Sentry");
  assert.equal(plain.once, "foe");
  assert.equal(plain.halts, "never");
  assert.deepEqual(plain.effects, []);
  assert.equal(haltsAfter(plain, { hurt: true, picked: true }), false);
  let record = noteReact(null, plain, "one");
  assert.equal(reactsLeft(plain, record, "one").ok, false, "once with each enemy");
  assert.equal(reactsLeft(plain, record, "two").ok, true);
  record = noteReact(record, plain, "two");
  assert.equal(record.Sentry.count, 2);

  const [better, ...rest] = holding("Sentry", [skill("Overwatch")]);
  assert.equal(rest.length, 0, "one way or the other, not both");
  assert.deepEqual(better.effects, [{ combat: { hit: 10, damage: 2 } }]);
  assert.equal(better.halts, "pick");
  assert.deepEqual(reactsLeft(better, null, "one"), { ok: true, halt: true });
  const halted = noteReact(null, better, "one", { halted: true });
  assert.deepEqual(reactsLeft(better, halted, "two"), { ok: true, halt: false }, "a single target of its choice");
  assert.equal(haltsAfter(better, { picked: true }), true);
  assert.equal(haltsAfter(better, { hurt: true, picked: false }), false);

  // What it has for those fights is lent to it as the fight is planned
  const lent = buildChange({ name: "Sentry", effects: better.effects, ends: "turnEnd" }, { skill: "Sentry", own: true });
  const base = planExchange(A(), B());
  const fought = planExchange(A(), B(), { more: { initiator: [lent] } });
  assert.equal(fought.initiator.damage, base.initiator.damage + 2);
  assert.equal(fought.initiator.hit, Math.min(base.initiator.hit + 10, 100));
});

/* -------------------------------------------- */
/*  Once a Fight Is Over                        */
/* -------------------------------------------- */

test("Suppress: twice a turn, one attack on an enemy within its reach that hurt an ally", () => {
  assert.deepEqual(listed.Suppress.usage, { kind: "auto", uses: 2, per: "turn" });
  const [react] = skillStanding([skill("Suppress")], WHO).reacts;
  assert.deepEqual({ to: react.to, within: react.within, strike: react.strike, may: react.may, id: react.id }, { to: "allyHurt", within: "weapon", strike: true, may: true, id: "suppress" });
  assert.equal(skillStanding([skill("Suppress", { used: 1 })], WHO).reacts.length, 1);
  assert.equal(skillStanding([skill("Suppress", { used: 2 })], WHO).reacts.length, 0, "not a third time in a turn");

  const reach = (tile) => (other, place) => withinSpaces(tile, place, 1, 2);
  const unit = (id, i, j, side, more = {}) => ({ id, side, tile: { i, j }, ...more });
  const guard = unit("guard", 5, 5, "player", { reacts: [react], covers: reach({ i: 5, j: 5 }) });
  const ally = unit("ally", 5, 6, "player");
  const foe = unit("foe", 5, 7, "enemy");
  const far = unit("far", 5, 9, "enemy");
  assert.deepEqual(avengersOf([guard, ally, foe], { hurt: "ally", by: "foe" }).map((found) => found.id), ["guard"]);
  assert.deepEqual(avengersOf([guard, ally, far], { hurt: "ally", by: "far" }), [], "the enemy must stand within its reach");
  assert.deepEqual(avengersOf([guard, ally, foe], { hurt: "guard", by: "foe" }), [], "an attack on the unit itself is none on an ally");
  assert.deepEqual(avengersOf([guard, ally, foe], { hurt: "foe", by: "ally" }), [], "nor does it strike its own side");
  assert.deepEqual(avengersOf([guard, ally, { ...foe, out: true }], { hurt: "ally", by: "foe" }), [], "an enemy that fell is struck no more");
  assert.deepEqual(avengersOf([{ ...guard, out: true }, ally, foe], { hurt: "ally", by: "foe" }), []);
});

/* -------------------------------------------- */
/*  As an Enemy Comes Into Reach                */
/* -------------------------------------------- */

test("Alarm: three times a turn, the allies in its movement range gain against an enemy that comes into it", () => {
  assert.deepEqual(listed.Alarm.usage, { kind: "auto", uses: 3, per: "turn" });
  const [react] = skillStanding([skill("Alarm")], WHO).reacts;
  assert.equal(react.to, "enters");
  assert.equal(react.within, "mov");
  assert.equal(skillStanding([skill("Alarm", { used: 3 })], WHO).reacts.length, 0);

  // The step that takes the enemy in from outside counts, and one that starts inside does not
  const range = (tile) => withinSpaces({ i: 5, j: 5 }, tile, 0, 3);
  const picket = { id: "picket", tile: { i: 5, j: 5 }, react, covers: range };
  const coming = eventsAlong(row(5, 10, 6), { watchers: [picket] });
  assert.deepEqual(coming.map(({ kind, at }) => ({ kind, at })), [{ kind: "enters", at: 2 }]);
  assert.deepEqual(eventsAlong(row(5, 7, 9), { watchers: [picket] }), [], "an enemy that leaves does not come in");
  assert.deepEqual(eventsAlong(row(5, 8, 6), { watchers: [picket] }), [], "nor one that was inside already");

  // What the allies carry is against the enemy that carries the mark, and against no other
  const mark = "Alarm · Picket";
  const effects = JSON.parse(JSON.stringify(react.rallies.effects).replaceAll(JSON.stringify(RALLY_MARK), JSON.stringify(mark)));
  const change = buildChange({ name: "Alarm", effects, ends: "phaseEnd" }, { skill: "Alarm", from: "Picket", giver: "Actor.Picket" });
  assert.ok(cleanChange(change, checkEffects));
  assert.equal(change.ends, "phaseEnd");
  const marked = buildChange({ name: mark, effects: [], ends: "phaseEnd", mark: true }, { skill: mark, own: true });
  const plain = planExchange(A(), B());
  const warned = planExchange({ ...A(), timed: [marked] }, { ...B(), timed: [change] });
  assert.equal(warned.initiator.damage, plain.initiator.damage - 2, "+2 DEF against that enemy");
  assert.equal(warned.initiator.hit, plain.initiator.hit - 10, "+10 Dodge");
  assert.equal(warned.initiator.crit, Math.max(plain.initiator.crit - 5, 0), "+5 Critical Avoid");
  const other = planExchange(A(), { ...B(), timed: [change] });
  assert.equal(other.initiator.damage, plain.initiator.damage, "nothing against an enemy that did not come in");
});

/* -------------------------------------------- */
/*  Traps                                       */
/* -------------------------------------------- */

test("Spell Trap: laid with a use of a Tome, two at most, and whoever moves onto its tile is halted and struck", () => {
  assert.deepEqual(listed["Spell Trap"].usage, { kind: "action" });
  const part = listed["Spell Trap"].effects[0].act.trap;
  assert.deepEqual(checkTrap(part), []);
  const trap = trapOf(part);
  assert.deepEqual(trap, { costs: { weapon: ["magic"], uses: 1 }, most: 2, who: "any", halts: true, strike: true });
  assert.equal(checkTrap({ strike: true }).length, 1, "a trap that strikes is laid with a weapon");
  assert.equal(checkTrap({ halts: false }).length, 1);
  assert.equal(checkTrap({ costs: { weapon: ["magic"] }, who: "ally" }).length, 1);

  // A third takes the place of the oldest, and one laid on a tile again takes the place of the one there
  const lay = (list, id, i, j) => layTrap(list, { id, tile: { i, j }, by: "hexer", skill: "Spell Trap", ...trap }, trap.most);
  let lying = lay([], "a", 3, 3).list;
  lying = lay(lying, "b", 3, 4).list;
  const third = lay(lying, "c", 3, 5);
  assert.deepEqual(third.list.map((entry) => entry.id), ["b", "c"]);
  assert.deepEqual(third.dropped.map((entry) => entry.id), ["a"]);
  assert.deepEqual(lay(lying, "d", 3, 4).list.map((entry) => entry.id), ["a", "d"]);

  // Any unit but the one that laid it, friend or foe; with `who: "enemy"`, only an enemy
  const [one] = lying;
  assert.equal(trapCatches(one, "hexer", null), false);
  assert.equal(trapCatches(one, "ally", "ally"), true);
  assert.equal(trapCatches(one, "foe", "enemy"), true);
  assert.equal(trapCatches({ ...one, who: "enemy" }, "ally", "ally"), false);
  assert.equal(trapCatches({ ...one, who: "enemy" }, "foe", "enemy"), true);

  // It catches the unit on its tile, whether the unit would have stopped there or walked on
  const events = eventsAlong(row(3, 0, 6), { traps: lying });
  assert.deepEqual(events.map(({ kind, at, trap: sprung }) => ({ kind, at, id: sprung.id })), [{ kind: "trap", at: 3, id: "a" }, { kind: "trap", at: 4, id: "b" }]);
  assert.deepEqual(eventsAlong(row(4, 0, 6), { traps: lying }), [], "not beside it");
  assert.deepEqual(eventsAlong(row(3, 3, 6), { traps: [one] }), [], "a unit that sets out from the tile does not spring it");

  // A trap and a unit that watches the same tile: the trap comes first
  const [react] = holding("Overwatch");
  const both = eventsAlong(row(3, 0, 6), { traps: [one], watchers: [watcher("sentinel", { i: 4, j: 3 }, react)] });
  assert.deepEqual(both.map((event) => event.kind), ["trap", "move"]);
  assert.equal(both[0].at, both[1].at);
});

/* -------------------------------------------- */
/*  Unseen                                      */
/* -------------------------------------------- */

test("Camouflage: its unit is unseen by enemies, and one that walks into it is stopped on the tile before", () => {
  assert.equal(unseenBy(["hidden"], "enemy"), true);
  assert.equal(unseenBy(new Set(["hidden"]), "foe"), true);
  assert.equal(unseenBy(["hidden"], "ally"), false);
  assert.equal(unseenBy(["hidden"], "friend"), false);
  assert.equal(unseenBy(["untargetable"], "foe"), false);
  assert.equal(unseenBy(null, "foe"), false);

  const used = useMoment(skill("Camouflage"), WHO, () => 100);
  const [change] = used.entries.flatMap((entry) => entry.granted.map((given) => given.change));
  const [react] = skillStanding(timedEntries([change]), WHO).reacts;
  const scout = { id: "scout", tile: { i: 5, j: 5 }, react };
  const events = eventsAlong(row(5, 2, 8), { watchers: [scout] });
  assert.deepEqual(events.map(({ kind, at, onto }) => ({ kind, at, onto })), [{ kind: "pass", at: 2, onto: 3 }]);
  assert.deepEqual(events[0].tile, { i: 5, j: 4 });
  assert.deepEqual(eventsAlong(row(4, 2, 8), { watchers: [scout] }), [], "walking past it is no walking into it");
  const ending = eventsAlong(row(5, 2, 5), { watchers: [scout] });
  assert.equal(ending[0].onto, 3, "ending the move on its tile is trying to pass as well");

  // Where the tile before is one the enemy only passes through, it stops on the last it can stand on
  const crowded = eventsAlong(row(5, 2, 8), { watchers: [scout], stands: (tile) => tile.j !== 4 });
  assert.equal(crowded[0].at, 1);
  assert.equal(halfMov(5), 2);
  assert.equal(halfMov(6), 3);
  assert.equal(halfMov(0), 0);
});

/**
 * Tests for `module/rules/skill-usage.mjs`: skills a unit chooses when to activate, their cooldowns, and a
 * skill that may be used before its cooldown is over, at a penalty.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { canUse, checkUsage, resetSkill, spendSkill, switchSkill, tickSkill } from "../module/rules/skill-usage.mjs";

const READY = { active: false, cooldown: 0, lasting: 0, used: 0 };

test("a skill on cooldown cannot be used, and comes back turn by turn", () => {
  const usage = { kind: "action", cooldown: 3 };
  assert.deepEqual(canUse(usage, READY), { ok: true, reason: null });
  const spent = spendSkill(usage, READY);
  assert.deepEqual(spent, { active: false, lasting: 0, cooldown: 3 + FEO.skillUse.cooldownExtra, used: 0 });
  assert.deepEqual(canUse(usage, spent), { ok: false, reason: "cooldown" });
  let state = spent;
  for ( let turn = 0; turn < spent.cooldown; turn++ ) state = tickSkill(usage, state).state;
  assert.equal(canUse(usage, state).ok, true);
  assert.equal(switchSkill({ kind: "toggle" }, READY).state.active, true);
});

test("a skill that may be used early can be while it is on cooldown, and its cooldown starts anew", () => {
  const usage = { kind: "action", cooldown: 3, lasts: 1, free: true, unmoved: true, early: { condition: "burn", turns: 1 } };
  assert.deepEqual(checkUsage(usage), []);
  assert.deepEqual(canUse(usage, READY), { ok: true, reason: null });

  // The first use is the usual one: it lasts until the unit's next turn, and the cooldown starts
  const first = spendSkill(usage, READY);
  assert.equal(first.active, true);
  assert.equal(first.early, false);
  assert.equal(canUse(usage, first).ok, false, "not a second time while it lasts");

  // Its next turn starts: what it did is over, the cooldown is not, and it may be used early
  const next = tickSkill(usage, first).state;
  assert.equal(next.active, false);
  assert.equal(next.cooldown > 0, true);
  assert.deepEqual(canUse(usage, next), { ok: true, reason: null, early: true });
  const again = spendSkill(usage, next, { early: true });
  assert.equal(again.early, true);
  assert.equal(again.cooldown, first.cooldown, "the cooldown starts again");

  // Once that use is over it is no longer marked, and a new map clears it as well
  assert.equal(tickSkill(usage, again).state.early, false);
  assert.equal(resetSkill(usage, again).state.early, false);

  // A skill without the leave is simply on cooldown
  assert.deepEqual(canUse({ kind: "action", cooldown: 3 }, next), { ok: false, reason: "cooldown" });
});

test("how a skill is used is checked", () => {
  assert.deepEqual(checkUsage({ kind: "toggle" }), []);
  assert.equal(checkUsage({ kind: "toggle", free: true }).length, 1);
  assert.equal(checkUsage({ kind: "action", early: { condition: "burn" } }).length, 1, "early needs a cooldown");
  assert.equal(checkUsage({ kind: "action", cooldown: 2, early: { condition: "wet" } }).length, 1);
  assert.equal(checkUsage({ kind: "action", cooldown: 2, early: { turns: 0 } }).length, 1);
  assert.equal(checkUsage({ kind: "action", sometimes: true }).length, 1);
});

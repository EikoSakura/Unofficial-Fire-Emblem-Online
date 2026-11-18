/**
 * Tests for `module/rules/timed.mjs`: a lasting change that lasts with a condition.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEffects } from "../module/rules/skills.mjs";
import { buildChange, cleanChange, endWith, grantChange } from "../module/rules/timed.mjs";

const grant = { to: "foe", effects: [{ takenPercent: 50 }], ends: "turnEnd", turns: 2, next: true, while: "stun" };

test("a change granted for as long as a condition lasts remembers the condition", () => {
  const change = buildChange(grant, { skill: "Stagger", from: "Brute", giver: "Actor.brute" });
  assert.equal(change.while, "stun");
  assert.equal(buildChange({ ...grant, while: undefined }, { skill: "Stagger" }).while, undefined);
});

test("it ends when its unit no longer suffers from that condition", () => {
  const tied = buildChange(grant, { skill: "Stagger", from: "Brute" });
  const loose = buildChange({ to: "self", effects: [{ stats: { str: 2 } }], ends: "turnEnd" }, { skill: "Rally", own: true });
  const list = grantChange(grantChange([], tied).list, loose).list;
  assert.deepEqual(endWith(list, { stun: 1 }), { list, ended: [], changed: false });
  const cured = endWith(list, { poison: 2 });
  assert.deepEqual(cured.list.map((change) => change.name), ["Rally"]);
  assert.deepEqual(cured.ended.map((change) => change.name), ["Stagger"]);
  assert.equal(cured.changed, true);
});

test("the condition is kept when a change is saved, and nothing else is let through", () => {
  const change = buildChange(grant, { skill: "Stagger", from: "Brute" });
  assert.equal(cleanChange(change, checkEffects).while, "stun");
  assert.equal(cleanChange({ ...change, while: undefined }, checkEffects).while, "");
  assert.equal(cleanChange({ ...change, while: 5 }, checkEffects), null);
});

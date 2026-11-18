/**
 * Tests for `module/rules/experience.mjs`: who earns what from a fight once a foe can be brought down by a
 * skill's damage, and by a unit that gives no experience.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { exchangeExp } from "../module/rules/experience.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

const levels = { initiator: 5, defender: 5 };

/** Roll out a fight with dice that come up as told, then always 100. */
function awards(initiator, defender, rolls = []) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  let rolled = 0;
  const result = resolveExchange(plan, () => rolls[rolled++] ?? 100);
  return { result, exp: exchangeExp(plan, result, levels) };
}

test("a unit earns kill experience for a foe its attack defeats", () => {
  const { result, exp } = awards(fighter({ name: "A", stats: { str: 40 } }), fighter({ name: "B", hp: 4 }), [1]);
  assert.equal(result.attacks[0].kill, true);
  assert.equal(exp.initiator.reason, "kill");
  assert.ok(exp.initiator.amount > 0);
});

test("and for a foe the damage of one of its skills defeats", () => {
  const sting = made("Sting", [{ proc: { on: "after", sure: true }, retaliate: 10 }]);
  const { result, exp } = awards(fighter({ name: "A", skills: [sting] }), fighter({ name: "B", hp: 4, stats: { def: 30 } }));
  assert.equal(result.attacks.some((attack) => attack.kill), false);
  assert.equal(exp.initiator.reason, "kill");

  // The unit that was brought down earns as it would have: it could attack and dealt nothing
  assert.equal(exp.defender.reason, "pity");
});

test("defeating a Noncombatant earns nothing, by an attack or by a skill", () => {
  const civilian = () => fighter({ name: "B", hp: 4, stats: { def: 30 }, skills: [skill("Noncombatant")] });
  const struck = awards(fighter({ name: "A", stats: { str: 60 } }), civilian(), [1]);
  assert.deepEqual(struck.exp.initiator, { amount: 0, reason: "noExp", gap: 0 });
  const sting = made("Sting", [{ proc: { on: "after", sure: true }, retaliate: 10 }]);
  const stung = awards(fighter({ name: "A", skills: [sting] }), civilian());
  assert.deepEqual(stung.exp.initiator, { amount: 0, reason: "noExp", gap: 0 });
});

test("fighting it without defeating it earns what any fight does", () => {
  const { exp } = awards(fighter({ name: "A" }), fighter({ name: "B", hp: 40, hpMax: 40, stats: { def: 30 }, skills: [skill("Noncombatant")] }));
  assert.equal(exp.initiator.reason, "pity");
});

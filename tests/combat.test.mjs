/**
 * Tests for `module/rules/combat.mjs`: what Step 2 changed about a fight the
 * system rolls. Damage that is no hit of an attack can be survived and counts as a kill, and a condition goes
 * by the same rule as outside of a fight.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { exchangeExp } from "../module/rules/experience.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/** Roll out a fight with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], rest = 100) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  let rolled = 0;
  const result = resolveExchange(plan, () => rolls[rolled++] ?? (rolled++, rest));
  return { plan, result, rolled, budget: rollBudget(plan) };
}

const levels = { initiator: 5, defender: 5 };
const sting = (amount, extra = {}) => made("Sting", [{ proc: { on: "after", sure: true }, retaliate: amount, ...extra }]);
const thorns = (amount) => made("Thorns", [{ proc: { on: "struck", sure: true }, retaliate: amount }]);

test("a foe brought down by a skill's damage after the fight is defeated by that skill's unit", () => {
  const { plan, result, rolled, budget } = fight(
    fighter({ name: "A", skills: [skill("Loot"), sting(10)] }),
    fighter({ name: "B", hp: 4, stats: { def: 30 } })
  );
  assert.equal(result.attacks.some((attack) => attack.kill), false);
  assert.equal(result.defender.hp, 0);
  assert.deepEqual(result.slain, [{ by: "initiator" }]);
  assert.deepEqual(result.earned, [{ skill: "Loot", by: "initiator", gold: 50 }]);
  assert.equal(exchangeExp(plan, result, levels).initiator.reason, "kill");
  assert.ok(rolled <= budget, `rolled ${rolled} of ${budget}`);
});

test("so is an attacker brought down by what its target deals in return", () => {
  const { plan, result, rolled, budget } = fight(
    fighter({ name: "A", hp: 3 }),
    fighter({ name: "B", hp: 30, hpMax: 30, skills: [skill("Loot"), thorns(5)] }),
    [1]
  );
  assert.equal(result.initiator.hp, 0);
  assert.deepEqual(result.slain, [{ by: "defender" }]);
  assert.deepEqual(result.earned, [{ skill: "Loot", by: "defender", gold: 50 }]);
  assert.equal(exchangeExp(plan, result, levels).defender.reason, "kill");
  assert.ok(rolled <= budget, `rolled ${rolled} of ${budget}`);
});

test("damage that cannot kill defeats nobody", () => {
  const { result } = fight(
    fighter({ name: "A", skills: [skill("Loot"), sting(10, { nonlethal: true })] }),
    fighter({ name: "B", hp: 4, stats: { def: 30 } })
  );
  assert.equal(result.defender.hp, 1);
  assert.equal(result.slain, undefined);
  assert.equal(result.earned, undefined);
});

test("Favored survives a skill's damage that would be fatal, and then takes none", () => {
  const { result, rolled, budget } = fight(
    fighter({ name: "A", skills: [sting(50), made("Second Sting", [{ proc: { on: "after", sure: true }, retaliate: 50 }])] }),
    fighter({ name: "B", hp: 20, hpMax: 20, stats: { def: 30 }, skills: [skill("Favored")] })
  );
  assert.equal(result.defender.hp, 1);
  assert.equal(result.slain, undefined);
  assert.deepEqual(result.defender.spent.map((spent) => spent.name), ["Favored"]);
  assert.equal(result.granted.filter((entry) => entry.to === "defender").length, 1);
  assert.ok(rolled <= budget, `rolled ${rolled} of ${budget}`);
});

test("Miracle is rolled for a skill's damage that would be fatal, within the dice set aside", () => {
  const saved = fight(
    fighter({ name: "A", skills: [sting(30)] }),
    fighter({ name: "B", hp: 20, hpMax: 20, stats: { def: 30, luk: 100 }, skills: [skill("Miracle")] })
  );
  assert.equal(saved.result.defender.hp, 5);
  assert.ok(saved.rolled <= saved.budget, `rolled ${saved.rolled} of ${saved.budget}`);
});

test("a unit that gives no experience gives none when it is defeated", () => {
  const { plan, result } = fight(
    fighter({ name: "A", stats: { str: 40 } }),
    fighter({ name: "B", hp: 4, skills: [skill("Noncombatant")] }),
    [1]
  );
  assert.equal(result.attacks[0].kill, true);
  assert.deepEqual(exchangeExp(plan, result, levels).initiator, { amount: 0, reason: "noExp", gap: 0 });

  const plain = fight(fighter({ name: "A", stats: { str: 40 } }), fighter({ name: "B", hp: 4 }), [1]);
  assert.equal(exchangeExp(plain.plan, plain.result, levels).initiator.reason, "kill");
});

test("a Stun inflicted in a fight leaves a change that lasts with it", () => {
  const stunning = made("Stunner", [{ proc: { on: "hit", sure: true }, inflicts: ["stun"] }]);
  const { result } = fight(
    fighter({ name: "A", skills: [skill("Stagger"), stunning] }),
    fighter({ name: "B", hp: 60, hpMax: 60 }),
    [1]
  );
  assert.ok(result.defender.conditions.stun >= 1);
  const [granted] = result.granted.filter((entry) => entry.to === "defender");
  assert.equal(granted.change.name, "Stagger");
  assert.equal(granted.change.while, "stun");
});

test("a condition a skill gives after the fight is nullified by the same rule as anywhere else", () => {
  const poisoner = made("Venom", [{ proc: { on: "after", sure: true }, inflicts: ["poison"] }]);
  const immune = fight(fighter({ name: "A", skills: [poisoner] }), fighter({ name: "B", stats: { def: 30 }, skills: [skill("Dragonskin")] }));
  assert.equal(immune.result.defender.conditions.poison, undefined);
  assert.equal(immune.result.after[0].inflicted[0].success, false);
  const plain = fight(fighter({ name: "A", skills: [poisoner] }), fighter({ name: "B", stats: { def: 30 } }));
  assert.ok(plain.result.defender.conditions.poison > 0);
});

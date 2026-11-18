/**
 * Tests for the Wounds and Injuries a unit's luck spares it (`saveHarm` in `module/rules/events.mjs`), read
 * through the skills as they are written in effects.json. Run with `node --test tests/` or
 * `node tests/luck.test.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FOILS, HARM_FOILS, foilsBefore } from "../module/rules/answers.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { woundThreshold } from "../module/rules/defeat.mjs";
import { damageWounds, harmDice, harmSavers, saveHarm, sufferDamage } from "../module/rules/events.mjs";
import { checkEffects } from "../module/rules/skills.mjs";
import { buildDefeatCard, buildSpareCard, spareLines } from "../module/helpers/defeat-context.mjs";
import { builtEffects, dice, fighter, made, skill, unit } from "./lib/fixtures.mjs";

const i18n = {
  localize: (key) => key,
  format: (key, data) => `${key}|${Object.entries(data ?? {}).map(([name, value]) => `${name}=${value}`).join(",")}`
};

test("the effects of Glance and Down Not Out pass the build's checks", () => {
  for ( const name of ["Glance", "Down Not Out"] ) assert.deepEqual(checkEffects(builtEffects(name)), [], name);
  assert.ok(HARM_FOILS.every((kind) => FOILS.includes(kind)));
});

test("Glance spares its unit a Wound at LUK%, rolled for each Wound by itself", () => {
  const who = unit({ stats: { luk: 30 }, skills: [skill("Glance")] });
  assert.equal(harmSavers(who, "wound").length, 1);
  assert.equal(harmSavers(who, "wound")[0].chance, 30);
  assert.equal(harmDice(who, "wound", 2), 2);

  const spared = saveHarm(who, "wound", 1, dice(30));
  assert.deepEqual([spared.left, spared.spared], [0, 1]);
  assert.deepEqual(spared.rolls, [{ skill: "Glance", roll: 30, chance: 30, success: true, sure: false, foils: "wound" }]);

  const kept = saveHarm(who, "wound", 1, dice(31));
  assert.deepEqual([kept.left, kept.spared, kept.rolls[0].success], [1, 0, false]);

  // Two Wounds from one fight: one die each
  const two = saveHarm(who, "wound", 2, dice(12, 77));
  assert.deepEqual([two.left, two.spared, two.rolls.length], [1, 1, 2]);
});

test("Glance does nothing about an Injury, and Down Not Out nothing about a Wound", () => {
  const glance = unit({ stats: { luk: 30 }, skills: [skill("Glance")] });
  assert.equal(harmDice(glance, "injury"), 0);
  assert.deepEqual(saveHarm(glance, "injury", 1, dice()).left, 1);
  const down = unit({ stats: { luk: 30 }, skills: [skill("Down Not Out")] });
  assert.equal(harmDice(down, "wound"), 0);
  assert.deepEqual(saveHarm(down, "wound", 1, dice()).left, 1);
});

test("Down Not Out spares its unit an Injury at LUK/2%", () => {
  const who = unit({ stats: { luk: 31 }, skills: [skill("Down Not Out")] });
  assert.equal(harmSavers(who, "injury")[0].chance, 15);
  assert.equal(saveHarm(who, "injury", 1, dice(15)).left, 0);
  assert.equal(saveHarm(who, "injury", 1, dice(16)).left, 1);
});

test("a unit without such a skill rolls nothing and takes what it is given", () => {
  const who = unit({ stats: { luk: 30 } });
  assert.equal(harmDice(who, "wound", 3), 0);
  const out = saveHarm(who, "wound", 3, dice());
  assert.deepEqual([out.left, out.spared, out.rolls.length], [3, 0, 0]);
});

test("a sure chance spares every one without a die, and is tried before one that is rolled", () => {
  const sure = made("Charmed", [{ proc: { on: "foil", sure: true }, foils: ["wound", "injury"] }]);
  const who = unit({ stats: { luk: 30 }, skills: [skill("Glance"), sure] });
  const out = saveHarm(who, "wound", 2, dice());
  assert.deepEqual([out.left, out.spared], [0, 2]);
  assert.ok(out.rolls.every((entry) => (entry.skill === "Charmed") && entry.sure && (entry.roll === null)));
});

test("a hit of an attack that deals maximum HP divided by 1.5 or more is a Wound, and other damage is none", () => {
  const who = unit({ hp: 30, hpMax: 30, resilience: 2 });
  assert.equal(woundThreshold(30), 20);
  assert.equal(damageWounds(sufferDamage(who, 20, { kind: "attack" }, dice()), 30), 1);
  assert.equal(damageWounds(sufferDamage(who, 19, { kind: "attack" }, dice()), 30), 0);
  for ( const kind of ["skill", "condition", "backfire", "terrain"] ) {
    assert.equal(damageWounds(sufferDamage(who, 25, { kind }, dice()), 30), 0, kind);
  }
});

test("in a fight the chance is not listed among what its unit may bring to nothing, and nothing is rolled for it", () => {
  const lucky = fighter({ name: "Lucky", stats: { luk: 30 }, skills: [skill("Glance"), skill("Down Not Out")] });
  const foe = fighter({ name: "Foe" });
  const plan = planExchange(foe, lucky, { distance: 1 });
  assert.deepEqual(foilsBefore(plan), []);
  const result = resolveExchange(plan, () => 1);
  const rolled = [...(result.opening ?? []), ...result.attacks.flatMap((attack) => attack.procs ?? [])];
  assert.equal(rolled.some((proc) => ["Glance", "Down Not Out"].includes(proc.skill)), false);
});

test("the roll is told where the Wound or the Injury would have been", () => {
  const rolls = [
    { skill: "Glance", roll: 12, chance: 30, success: true, sure: false, foils: "wound" },
    { skill: "Glance", roll: 80, chance: 30, success: false, sure: false, foils: "wound" }
  ];
  const lines = spareLines(rolls, "Hero", i18n);
  assert.equal(lines[0].label, "FEO.Defeat.spared.wound|skill=Glance,roll=12,chance=30,name=Hero");
  assert.equal(lines[0].cls, "good");
  assert.ok(lines[1].label.startsWith("FEO.Defeat.spared.woundFail|"));
  const card = buildSpareCard("Hero", rolls, i18n);
  assert.equal(card.outcome.cls, "good");
  assert.ok(card.note.startsWith("FEO.Defeat.spared.woundFail|"));

  const injury = [{ skill: "Down Not Out", roll: 9, chance: 15, success: true, sure: false, foils: "injury" }];
  const back = buildDefeatCard("recovered", { name: "Hero", injuries: 2, spared: injury }, i18n);
  assert.deepEqual(back.rows[0], { label: "Down Not Out", value: "9 / 15", cls: "good" });
  assert.equal(back.rows[1].value, 2);
  assert.ok(back.note.startsWith("FEO.Defeat.spared.injury|"));
  const plain = buildDefeatCard("recovered", { name: "Hero", injuries: 3 }, i18n);
  assert.equal(plain.rows.length, 1);
  assert.equal(plain.rows[0].cls, "bad");
});

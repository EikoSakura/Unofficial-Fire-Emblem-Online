/**
 * Tests for `module/helpers/chat-context.mjs`: what a chat card shows on its face, and what it keeps for the
 * window that opens when it is inspected.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardFace, cardRecord, diceOf, onFace } from "../module/helpers/chat-context.mjs";

/** A localizer that answers with the key it was asked for, and what it was given. */
const i18n = {
  localize: (key) => key,
  format: (key, data = {}) => `${key}(${Object.values(data).join(", ")})`,
  has: () => true
};

test("a row that is marked as a result is shown on the card, the rest are kept back", () => {
  assert.equal(onFace({ label: "HP", value: "20 → 14", cls: "strong" }), true);
  assert.equal(onFace({ label: "Gold", value: "+300", cls: "good" }), true);
  assert.equal(onFace({ label: "Poison", value: "−3", cls: "bad extra" }), true);
  assert.equal(onFace({ label: "d100", value: 41 }), false);
  assert.equal(onFace({ label: "Ended", value: "", cls: "muted" }), false);
});

test("a row may settle for itself whether it is shown", () => {
  assert.equal(onFace({ label: "Uses", value: "3 / 5", face: true }), true);
  assert.equal(onFace({ label: "HP", value: 12, cls: "strong", face: false }), false);
});

test("a card keeps its headline and its results, and says whether it kept anything back", () => {
  const card = {
    title: "Strength",
    outcome: { label: "57", cls: "total" },
    rows: [{ label: "d100", value: 45 }, { label: "Bonus", value: "+12" }],
    note: "A remark"
  };
  const { face, more } = cardFace(card);
  assert.equal(face.title, "Strength");
  assert.deepEqual(face.outcome, card.outcome);
  assert.deepEqual(face.rows, []);
  assert.equal(face.note, "A remark");
  assert.equal(more, true);
  assert.equal(card.rows.length, 2, "the card it was given is left as it was");

  const plain = cardFace({ title: "Sold", rows: [{ label: "Gold", value: "+300", cls: "good" }] });
  assert.equal(plain.face.rows.length, 1);
  assert.equal(plain.more, false);
  assert.equal(cardFace({ title: "Staggered" }).more, false);
});

test("the record of a card has every row, in order, with its remark", () => {
  const record = cardRecord({
    title: "Strength",
    subtitle: "Physical",
    outcome: { label: "57", cls: "total" },
    rows: [{ label: "d100", value: 45 }, { label: "Bonus", value: "+12", cls: "good" }],
    note: "A remark"
  }, "card", i18n);
  assert.equal(record.title, "Strength");
  assert.equal(record.subtitle, "Physical");
  assert.deepEqual(record.outcome, { label: "57", cls: "total" });
  assert.deepEqual(record.sections, [{
    label: "",
    rows: [{ label: "d100", value: "45", cls: "" }, { label: "Bonus", value: "+12", cls: "good" }]
  }]);
  assert.deepEqual(record.notes, ["A remark"]);
  assert.deepEqual(cardRecord({ title: "Staggered" }, "card", i18n), { title: "Staggered", sections: [], notes: [] });
});

test("the record of a fight sorts its details into what was in play, the dice and what came after", () => {
  const card = {
    sides: [{ name: "Eirika", army: "player" }, { name: "Brigand", army: "enemy" }],
    strikes: [],
    notable: [{ label: "Brigand is defeated", cls: "" }],
    details: [
      { label: "Range", value: 1, group: "setup" },
      { label: "1. Eirika", value: "Hit 12 / 85", group: "dice" },
      { label: "Rapier", value: "40 → 39", group: "after" },
      { label: "Eirika · Skills", value: "Luna" }
    ],
    notes: ["Brigand could not counter"]
  };
  const { face, more } = cardFace(card, "exchange");
  assert.equal(face, card);
  assert.equal(more, true);

  const record = cardRecord(card, "exchange", i18n);
  assert.equal(record.title, "FEO.Chat.versus(Eirika, Brigand)");
  assert.equal(record.army, "player");
  assert.deepEqual(record.sections.map((section) => section.label), ["FEO.Chat.record.setup", "FEO.Chat.record.dice", "FEO.Chat.record.after"]);
  assert.deepEqual(record.sections[0].rows.map((row) => row.label), ["Range", "Eirika · Skills"]);
  assert.deepEqual(record.sections[1].rows, [{ label: "1. Eirika", value: "Hit 12 / 85", cls: "" }]);
  assert.deepEqual(record.notes, ["Brigand could not counter"]);
});

test("a card of what a class changed tells each change in a word or two, and keeps the rows", () => {
  const card = {
    title: "Promoted to Paladin",
    groups: [
      { label: "Stats", rows: [
        { label: "Str", value: "9 → 11 (+2)", cls: "good", chip: { label: "Str", value: "+2" } },
        { label: "Def", value: "7 → 7 (+0)", cls: "", chip: null }
      ] },
      { label: "Growth rates", rows: [{ label: "Strength", value: "45% → 50% (+5)", cls: "" }] },
      { label: "Skills", rows: [{ label: "Class", value: "Canto", cls: "good", chip: { label: "Canto", value: "" } }] }
    ],
    notes: ["A choice is left"]
  };
  const { face, more } = cardFace(card, "class-change");
  assert.deepEqual(face.groups, [
    { label: "Stats", chips: [{ label: "Str", value: "+2", cls: "good" }] },
    { label: "Skills", chips: [{ label: "Canto", value: "", cls: "good" }] }
  ]);
  assert.equal(more, true);

  const record = cardRecord(card, "class-change", i18n);
  assert.deepEqual(record.sections.map((section) => section.rows.length), [2, 1, 1]);
  assert.deepEqual(record.sections[0].rows[0], { label: "Str", value: "9 → 11 (+2)", cls: "good" });
  assert.deepEqual(record.notes, ["A choice is left"]);
});

test("a card that keeps nothing back by its nature has no record", () => {
  const skill = { name: "Luna", rows: [{ label: "Cooldown", value: "2 turns" }] };
  assert.equal(cardRecord(skill, "skill", i18n), null);
  assert.deepEqual(cardFace(skill, "skill"), { face: skill, more: false });
});

test("the dice of a message are listed as they fell", () => {
  const rolls = [
    { dice: [{ results: [{ result: 34, active: true }, { result: 87, active: true }] }] },
    { dice: [{ results: [{ result: 12 }, { result: 99, active: false }] }] }
  ];
  assert.deepEqual(diceOf(rolls), [34, 87, 12]);
  assert.deepEqual(diceOf([]), []);
  assert.deepEqual(diceOf(), []);
});

/**
 * Tests for imitation (see `module/rules/imitation.mjs`) and for what is left of changing form (see
 * `module/rules/shifting.mjs`): a unit that takes on another's attributes and is itself again, exactly; whom
 * it may not imitate; what its other skills change about that; and the Laguz that Shift side by side, fight
 * with their Fists, and gain Haste from the Beast quality.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { actOf, checkAct } from "../module/rules/actions.mjs";
import { gainWexp, planExchange } from "../module/rules/combat.mjs";
import { builtInSkills } from "../module/rules/events.mjs";
import {
  checkImitates, checkImitation, givenBack, handFor, heldBack, imitateBar, imitatesOf, imitationBends, imitationGrant, imitationOver, keptGrant,
  overlay, ownWexp, readImitation, speaksOfImitation, takenFrom
} from "../module/rules/imitation.mjs";
import { gaugeAfterCombat, isHumanWeapon, shiftBends, shiftLapses } from "../module/rules/shifting.mjs";
import { checkEffects, coverageOf, skillTotals, turnMoment } from "../module/rules/skills.mjs";
import { canUse, checkUsage, turnsToSitOut } from "../module/rules/skill-usage.mjs";
import { buildChange, cleanChange, grantChange, tickChanges, timedEntries } from "../module/rules/timed.mjs";
import { changeParts } from "../module/helpers/timed-context.mjs";
import { dice, fighter, skill } from "./lib/fixtures.mjs";

const listed = JSON.parse(readFileSync(new URL("../packs-src/skills/effects.json", import.meta.url), "utf8")).skills;

const STEP = ["Imitate", "Greater Imitate", "Lasting Imitate", "Imitiation Defense", "Gregarious", "Aggression", "Rouse"];
const IMITATES = imitatesOf({ effects: listed.Imitate.effects });

const A = (options = {}) => fighter({ name: "A", hp: 30, hpMax: 30, ...options });
const B = ({ timed = [], ...options } = {}) => ({ ...fighter({ name: "B", hp: 30, hpMax: 30, ...options }), timed });

/** A unit's data as it is saved: what `takenFrom` reads and `overlay` is laid over. */
function saved(over = {}) {
  const stat = (base, boost = 0) => ({ base, boost, cap: null });
  return {
    className: "Freelancer",
    classId: "own-class",
    level: 7,
    exp: 40,
    gold: 300,
    affinity: "fire",
    specialQualities: "",
    hp: { value: 24, max: 26, cap: null },
    stats: { str: stat(8), mag: stat(3), def: stat(6), res: stat(4), dex: stat(9), spd: stat(10), luk: stat(7), mov: stat(5), con: stat(7), los: stat(6) },
    boon: "spd",
    bane: "mag",
    wt: { class: 0 },
    abilities: Object.fromEntries(Object.keys(FEO.abilities).map((key) => [key, { source: FEO.abilities[key].sources[0], increase: 1, boost: 0 }])),
    growths: { hp: 60, str: 40 },
    combatBoosts: Object.fromEntries(Object.keys(FEO.combatBoosts).map((key) => [key, 0])),
    calc: Object.fromEntries(Object.keys(FEO.calcModes).map((key) => [key, "normal"])),
    proficiencies: Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => [key, { rank: (key === "sword") ? "C" : "F", wexp: (key === "sword") ? 12 : 0 }])),
    weaponLevel: { base: 0 },
    fcm: FEO.optional.followUpCritical.base,
    movementStars: 0,
    timed: [],
    bonds: [{ name: "Lyn", rank: "C" }],
    wounds: 1,
    ...over
  };
}

/** A unit's data as it is prepared from what is saved: with what it has taken on laid over, if anything. */
function prepared(source, note = null) {
  const system = structuredClone(source);
  const read = readImitation(note);
  return read ? overlay(system, read.taken, { classId: read.classId }) : system;
}

const KNIGHT = saved({
  className: "Great Knight", classId: "their-class", level: 24, exp: 5, gold: 9, affinity: "ice", specialQualities: "Armored, Mounted",
  hp: { value: 3, max: 41, cap: 60 },
  stats: Object.fromEntries(Object.entries({ str: 17, mag: 1, def: 19, res: 6, dex: 11, spd: 7, luk: 5, mov: 7, con: 15, los: 6 }).map(([key, base]) => [key, { base, boost: (key === "def") ? 2 : 0, cap: 30 }])),
  boon: "def", bane: "spd", wt: { class: 12 },
  proficiencies: Object.fromEntries(Object.keys(FEO.proficiencies).map((key) => [key, { rank: (key === "lance") ? "A" : (key === "axe") ? "B" : "F", wexp: 3 }])),
  growths: { hp: 90, str: 55 }, bonds: [], wounds: 0
});

/* -------------------------------------------- */
/*  The Parts                                   */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know, with nothing left for the table", () => {
  for ( const name of STEP ) {
    const entry = listed[name];
    assert.ok(entry, `${name} is listed`);
    assert.deepEqual(checkEffects(entry.effects), [], name);
    assert.deepEqual(checkUsage(entry.usage), [], name);
    assert.equal(entry.left, undefined, `${name} leaves nothing to the table`);
    assert.equal(coverageOf({ effect: "Something.", listed: true, left: entry.left }), "done");
    assert.ok(entry.note, `${name} says how it is read`);
  }
});

test("a mistyped imitation does not pass", () => {
  assert.deepEqual(checkImitates({ turns: 5, not: ["laguz"], rules: ["noSong"] }), []);
  assert.ok(checkImitates({ turns: 0 }).length);
  assert.ok(checkImitates({ turns: 5, not: ["elf"] }).length);
  assert.ok(checkImitates({ turns: 5, forever: true }).length);
  assert.ok(checkImitates(null).length);
  assert.deepEqual(checkImitation({ turns: 1, effects: [{ stats: { str: 2 } }] }, { checkEffects }), []);
  assert.deepEqual(checkImitation({ keeps: { share: 50, stats: ["str"], turns: 1 } }), []);
  assert.ok(checkImitation({}).length);
  assert.ok(checkImitation({ keeps: { share: 150, stats: ["str"] } }).length);
  assert.ok(checkImitation({ keeps: { share: 50, stats: ["strength"] } }).length);
  assert.ok(checkImitation({ effects: [{ proc: { on: "hit" }, damage: 2 }] }, { checkEffects }).length, "always there while it lasts");
  assert.ok(checkImitation({ effects: [{ statz: { str: 2 } }] }, { checkEffects }).length, "its effects are checked as effects");

  const act = { target: { who: "ally", within: 1 }, imitates: { turns: 5 } };
  assert.deepEqual(checkAct(act), []);
  assert.ok(checkAct({ ...act, heal: 5 }).length, "it does nothing else to its target");
  assert.ok(checkAct({ target: { who: "ally", within: 1, self: true }, imitates: { turns: 5 } }).length, "nobody imitates itself");
  assert.ok(checkEffects([{ proc: { on: "hit" }, imitation: { turns: 1 } }]).length, "always there");
  assert.ok(checkEffects([{ effectiveTaken: 0.5 }]).length);
  assert.ok(checkEffects([{ shift: { brief: 1 } }]).length);
});

/* -------------------------------------------- */
/*  Imitate                                     */
/* -------------------------------------------- */

test("Imitate is used as an action on an ally next to its unit, and its 2 turns of cooldown start as it reverts", () => {
  const act = actOf({ effects: listed.Imitate.effects, usage: listed.Imitate.usage });
  assert.deepEqual(act.target, { who: "ally", within: 1 });
  assert.equal(IMITATES.turns, 5);
  assert.equal(listed.Imitate.usage.kind, "action");
  assert.equal(listed.Imitate.usage.cooldown, 2);
  assert.equal(listed.Imitate.usage.lasts, undefined, "the change it leaves counts the turns, and may count one more");

  // While it imitates the skill is on with no cooldown; as it reverts the cooldown is set, and sits out 2 turns
  assert.equal(canUse(listed.Imitate.usage, { active: true, cooldown: 0 }).ok, true);
  const reverted = { active: false, lasting: 0, cooldown: listed.Imitate.usage.cooldown + FEO.skillUse.cooldownExtra, used: 0 };
  assert.equal(canUse(listed.Imitate.usage, reverted).ok, false);
  assert.equal(turnsToSitOut(reverted), 2);
});

test("Imitate cannot copy Laguz, Manaketes or Taguel, by their class, their way of changing form or their quality", () => {
  assert.equal(imitateBar(IMITATES, { race: "beorc", shifts: null, qualities: "Armored, Mounted" }), null);
  assert.equal(imitateBar(IMITATES, { race: "", shifts: null, qualities: "" }), null, "a unit with no class Item");
  assert.equal(imitateBar(IMITATES, { race: "monster", qualities: "Terror" }), null);
  for ( const people of ["laguz", "manakete", "taguel"] ) {
    assert.deepEqual(imitateBar(IMITATES, { race: people }), { why: "people", people });
  }
  assert.equal(imitateBar(IMITATES, { race: "beorc", shifts: "gauge" })?.people, "laguz", "a Shift Gauge set by hand");
  assert.equal(imitateBar(IMITATES, { race: "", shifts: "stone" })?.people, "manakete", "a stone set by hand");
  assert.equal(imitateBar(IMITATES, { race: "beorc", qualities: "Beast, Laguz" })?.people, "laguz", "the Laguz Special Quality");
  assert.equal(imitateBar(IMITATES, { race: "beorc", qualities: "Beast" }), null, "a Beast that is no Laguz");
  assert.equal(imitateBar({ turns: 5 }, { race: "laguz" }), null, "a skill that bars nobody");
});

test("a unit that imitates has the other's attributes laid over its own, and is itself again exactly", () => {
  const own = saved();
  const before = structuredClone(own);
  const taken = takenFrom(KNIGHT, { className: "Great Knight" });
  const note = { skill: "item", name: "Imitate", of: "Actor.Knight", ally: "Oswin", change: "Imitate", taken, classId: "copied-class", hand: "sword", held: 0, tokens: [] };

  // While it imitates
  const now = prepared(own, note);
  assert.equal(now.hp.max, 41);
  assert.equal(now.hp.cap, 60);
  assert.deepEqual(now.stats.def, { base: 19, boost: 2, cap: 30 });
  assert.equal(now.stats.mov.base, 7);
  assert.equal(now.specialQualities, "Armored, Mounted");
  assert.equal(now.className, "Great Knight");
  assert.equal(now.classId, "copied-class", "the class it took on, as an Item of its own");
  assert.equal(now.proficiencies.lance.rank, "A");
  assert.equal(now.proficiencies.sword.rank, "F", "its own ranks are set aside");
  assert.equal(now.wt.class, 12);
  assert.equal(now.boon, "def");

  // What stays its own
  assert.equal(now.hp.value, 24, "its HP");
  assert.equal(now.level, 7);
  assert.equal(now.exp, 40);
  assert.equal(now.gold, 300);
  assert.equal(now.affinity, "fire");
  assert.deepEqual(now.growths, { hp: 60, str: 40 });
  assert.deepEqual(now.bonds, [{ name: "Lyn", rank: "C" }]);
  assert.equal(now.wounds, 1);

  // Nothing of its own was written over, and without the note it is prepared as it was
  assert.deepEqual(own, before);
  assert.deepEqual(prepared(own, null), before);
  assert.deepEqual(prepared(own, {}), before, "a note with nothing taken on is none");

  // What was taken on no longer hangs on the unit it was taken from
  KNIGHT.stats.str.base = 99;
  assert.equal(prepared(own, note).stats.str.base, 17);
  KNIGHT.stats.str.base = 17;
});

test("only attributes are laid over, whatever else a note says", () => {
  const own = saved();
  const now = prepared(own, { taken: { ...takenFrom(KNIGHT), level: 99, exp: 99, gold: 0, hp: { max: 41, cap: 60, value: 1 }, timed: [{ name: "x" }], bonds: [] }, classId: "c" });
  assert.equal(now.level, 7);
  assert.equal(now.gold, 300);
  assert.equal(now.hp.value, 24);
  assert.deepEqual(now.timed, []);
  assert.equal(now.bonds.length, 1);
  assert.equal(readImitation(null), null);
  assert.equal(readImitation({ taken: "all of it" }), null);
});

test("a unit that imitates one that itself imitates takes on what that one took on", () => {
  const taken = takenFrom(KNIGHT);
  const copy = prepared(saved(), { taken, classId: "c" });
  assert.deepEqual(takenFrom(copy).stats, taken.stats);
  assert.equal(takenFrom(copy).specialQualities, "Armored, Mounted");
});

test("HP above the maximum it takes on are set aside, and return as it reverts", () => {
  assert.deepEqual(heldBack(24, 41), { value: 24, held: 0 }, "a higher maximum leaves its HP as they are");
  assert.deepEqual(heldBack(24, 18), { value: 18, held: 6 });
  assert.equal(givenBack(18, 6, 26), 24, "unhurt, it has what it had");
  assert.equal(givenBack(10, 6, 26), 16, "hurt meanwhile, it gets back what was set aside");
  assert.equal(givenBack(25, 6, 26), 26, "never more than its own maximum");
  assert.equal(givenBack(0, 6, 26), 0, "a unit that is down gains nothing");
  assert.equal(givenBack(12, 0, 26), 12);
});

test("the change it carries counts 5 turn starts, keeps it from using a copied Refresh, and its end is the end of the imitation", () => {
  const change = buildChange(imitationGrant(IMITATES, imitationBends([]), { skill: "Imitate" }), { skill: "Imitate", own: true, carrierInTurn: true });
  assert.equal(change.name, "Imitate");
  assert.equal(change.ends, "turnStart");
  assert.equal(change.turns, 5);
  assert.ok(cleanChange(change, checkEffects), "a change the unit can carry");
  const totals = skillTotals([skill("Refresh"), ...timedEntries([change])], { hp: 20, hpMax: 20, stats: {} });
  assert.ok(totals.rules.has("noSong"));
  assert.ok(changeParts(change).some((part) => part.label === "FEO.Timed.rule.noSong"), "told on its chip");

  const note = readImitation({ name: "Imitate", change: "Imitate", taken: takenFrom(KNIGHT) });
  let list = grantChange([], change).list;
  for ( let turn = 1; turn <= 4; turn++ ) {
    list = tickChanges(list, "turnStart").list;
    assert.equal(imitationOver(note, list), false, `still imitating after ${turn} turn starts`);
    assert.equal(list[0].turns, 5 - turn, "the chip counts down");
  }
  list = tickChanges(list, "turnStart").list;
  assert.equal(imitationOver(note, list), true, "it reverts as its fifth turn starts");
  assert.equal(imitationOver(note, [{ name: "Imitate", from: "Somebody" }]), true, "a change of that name from another unit is not it");
  assert.equal(imitationOver(null, []), false, "a unit that is itself has nothing to revert");
});

test("Imitate, and the skills that change it, stay its unit's own; the skills it takes on are the other unit's", () => {
  for ( const name of ["Imitate", "Greater Imitate", "Lasting Imitate", "Imitiation Defense"] ) {
    assert.equal(speaksOfImitation(listed[name].effects), true, name);
  }
  for ( const name of ["Refresh", "Rouse", "Aggression", "Canto+"] ) assert.equal(speaksOfImitation(listed[name].effects), false, name);
  assert.equal(imitatesOf({ effects: listed.Refresh.effects }), null);
});

test("a weapon it can no longer wield is put away for one it can, and what it held is in hand again afterwards", () => {
  const pack = (sword, lance, held) => [
    { id: "sword", equipped: held === "sword", wields: sword },
    { id: "lance", equipped: held === "lance", wields: lance }
  ];
  assert.deepEqual(handFor(pack(true, false, "sword")), { equip: null, unequip: [] }, "one it may still wield stays in hand");
  assert.deepEqual(handFor(pack(false, true, "sword")), { equip: "lance", unequip: ["sword"] }, "as it imitates a lance wielder");
  assert.deepEqual(handFor(pack(false, false, "sword")), { equip: null, unequip: ["sword"] }, "nothing it can wield: unarmed");
  assert.deepEqual(handFor(pack(true, false, "lance"), "sword"), { equip: "sword", unequip: ["lance"] }, "as it reverts");
  assert.deepEqual(handFor(pack(true, true, null), "lance"), { equip: "lance", unequip: [] }, "the one it held before, of two it can wield");
  assert.deepEqual(handFor([], "sword"), { equip: null, unequip: [] });
});

test("weapon experience earned while imitating goes to its own proficiency of that kind", () => {
  const own = saved().proficiencies;
  const gain = (proficiency, amount) => gainWexp(proficiency, amount, { ceiling: null });
  assert.deepEqual(ownWexp([{ key: "sword", amount: 2 }], own, gain), { sword: { rank: "C", wexp: 14 } });
  assert.deepEqual(ownWexp([{ key: "lance", amount: 2 }], own, gain), {}, "a kind it has no rank in earns nothing");
  assert.deepEqual(ownWexp([], own, gain), {});
  const most = FEO.wexpToNext.C;
  assert.equal(ownWexp([{ key: "sword", amount: most }], own, gain).sword.rank, "B", "its own rank rises by it");
});

/* -------------------------------------------- */
/*  Greater Imitate, Lasting Imitate, Imitiation Defense */
/* -------------------------------------------- */

test("Greater Imitate has Imitate last one more turn and gives +2 to seven stats while it lasts", () => {
  const bends = imitationBends([skill("Imitate"), skill("Greater Imitate")]);
  assert.equal(bends.turns, 1);
  assert.deepEqual(bends.skills, ["Greater Imitate"]);
  const change = buildChange(imitationGrant(IMITATES, bends, { skill: "Imitate" }), { skill: "Imitate", own: true, carrierInTurn: true });
  assert.equal(change.turns, 6);
  const totals = skillTotals(timedEntries([change]), { hp: 20, hpMax: 20, stats: {} });
  for ( const key of ["str", "mag", "dex", "spd", "luk", "def", "res"] ) assert.equal(totals.stats[key], 2, key);
  assert.equal(totals.stats.con ?? 0, 0);
  assert.equal(totals.stats.mov ?? 0, 0);

  // By itself the skill adds nothing: only the change its unit carries while it imitates does
  assert.equal(skillTotals([skill("Greater Imitate")], { hp: 20, hpMax: 20, stats: {} }).stats.str ?? 0, 0);
  assert.equal(imitationBends([skill("Imitate")]).turns, 0);
});

test("Lasting Imitate keeps half of the stats gained through Imitate for 1 turn after reverting", () => {
  const { keeps } = imitationBends([skill("Lasting Imitate")]);
  assert.equal(keeps.share, 50);
  assert.equal(keeps.turns, 1);
  const before = { str: 19, mag: 3, def: 23, res: 8, dex: 13, spd: 9, luk: 7, mov: 7, con: 15 };
  const after = { str: 8, mag: 3, def: 6, res: 4, dex: 9, spd: 10, luk: 7, mov: 5, con: 7 };
  const grant = keptGrant(keeps, before, after);
  assert.deepEqual(grant.effects, [{ stats: { str: 5, def: 8, res: 2, dex: 2 } }], "half of 11, 17, 4 and 4, rounded down; nothing for SPD, which fell");
  assert.equal(grant.name, "Lasting Imitate");
  const change = buildChange(grant, { skill: grant.name, own: true, carrierInTurn: true });
  assert.equal(change.ends, "turnStart");
  assert.equal(change.turns, 1);
  assert.equal(tickChanges([change], "turnStart").list.length, 0, "gone as its next turn starts");
  assert.equal(keptGrant(keeps, after, after), null, "nothing gained, nothing kept");
  assert.equal(keptGrant(null, before, after), null, "a unit without the skill keeps nothing");
  assert.equal(imitationBends([skill("Imitate")]).keeps, null);
});

test("Imitiation Defense holds effective damage to 1.5x while its unit imitates one with a Special Quality", () => {
  const HAMMER = { name: "Hammer", effect: "Effective against Armored units." };
  const bends = imitationBends([skill("Imitate"), skill("Imitiation Defense")]);
  const change = buildChange(imitationGrant(IMITATES, bends, { skill: "Imitate" }), { skill: "Imitate", own: true, carrierInTurn: true });
  const plain = buildChange(imitationGrant(IMITATES, imitationBends([skill("Imitate")]), { skill: "Imitate" }), { skill: "Imitate", own: true, carrierInTurn: true });

  assert.equal(planExchange(A({ weapon: HAMMER }), B({ qualities: "Armored" })).initiator.damage, 19, "three times the Might of 5");
  assert.equal(planExchange(A({ weapon: HAMMER }), B({ qualities: "Armored", timed: [plain] })).initiator.damage, 19, "imitating without the skill");
  const held = planExchange(A({ weapon: HAMMER }), B({ qualities: "Armored", timed: [change] }));
  assert.equal(held.initiator.damage, 11, "one and a half times 5 is 7, rounded down");
  assert.deepEqual(held.initiator.effective, ["Armored"], "it is still effective damage");
  assert.equal(planExchange(A({ weapon: HAMMER }), B({ timed: [change] })).initiator.damage, 9, "imitating a unit without a Special Quality");
  assert.equal(planExchange(A(), B({ qualities: "Armored", timed: [change] })).initiator.damage, 9, "a weapon that is not effective");
  assert.ok(changeParts(change).some((part) => (part.label === "FEO.Timed.effectiveTaken") && (part.value === "×1.5")));

  // What already multiplies by less is left alone
  const totals = skillTotals(timedEntries([change]), { hp: 20, hpMax: 20, stats: {}, qualities: "Flying" });
  assert.equal(totals.effectiveTaken, 1.5);
  assert.equal(skillTotals(timedEntries([change]), { hp: 20, hpMax: 20, stats: {}, qualities: "" }).effectiveTaken, null);
});

/* -------------------------------------------- */
/*  Gregarious, Aggression, Rouse               */
/* -------------------------------------------- */

const around = (id, others) => ({ id, side: "player", tile: null, others });
const beside = (id, qualities, distance = 1, relation = "ally") => ({ id, name: id, relation, distance, hp: 20, hpMax: 20, stats: {}, totals: {}, qualities });

test("Gregarious lets its unit and the allied Laguz next to it Shift whatever their gauge holds, until its next turn starts", () => {
  const self = { name: "Lethe", uuid: "Actor.Lethe", hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null, qualities: "Beast, Laguz", near: around("lethe", [beside("mordecai", "Beast, Laguz"), beside("ike", "")]) };
  const moment = turnMoment([skill("Gregarious")], self, "turnStart", dice());
  const granted = moment.entries[0].granted;
  assert.equal(granted.length, 2);
  const mine = granted.find((entry) => !entry.unit).change;
  const theirs = granted.find((entry) => entry.unit === "mordecai").change;
  assert.deepEqual(mine.effects, [{ shift: { atWill: true, brief: true } }]);
  assert.equal(mine.ends, "turnStart");
  assert.equal(mine.turns, 1);
  assert.deepEqual(theirs.effects, mine.effects);
  assert.equal(theirs.clock, "Actor.Lethe", "until the start of this unit's next turn");
  assert.ok(cleanChange(mine, checkEffects));

  // The change is what lets each Shift, and what a Shift made that way ends with
  const bends = shiftBends(timedEntries([mine]).map((entry) => ({ name: entry.name, active: true, effects: entry.effects })));
  assert.equal(bends.atWill, true);
  assert.equal(bends.brief, true);
  assert.ok(changeParts(mine).some((part) => part.label === "FEO.Timed.shiftAtWill"));
  assert.equal(shiftBends([]).atWill, false);

  // Nobody to Shift with
  for ( const others of [[beside("ike", "")], [beside("mordecai", "Beast, Laguz", 2)], [beside("foe", "Laguz", 1, "enemy")]] ) {
    const alone = turnMoment([skill("Gregarious")], { ...self, near: around("lethe", others) }, "turnStart", dice());
    assert.equal(alone.entries.length, 0);
  }
  assert.deepEqual(builtInSkills("Beast, Laguz"), ["Rouse", "Gregarious"], "built into the Laguz Special Quality");
});

test("a Shift made at will through Gregarious ends with it, unless the gauge then holds enough", () => {
  assert.equal(shiftLapses({ value: 8, active: true }, { lent: true, atWill: false }), true);
  assert.equal(shiftLapses({ value: 8, active: true }, { lent: true, atWill: true }), false, "still next to a Laguz as the turn starts");
  assert.equal(shiftLapses({ value: FEO.shift.gauge.shiftAt, active: true }, { lent: true, atWill: false }), false, "it could Shift by itself now");
  assert.equal(shiftLapses({ value: 8, active: true }, { lent: false, atWill: false }), false, "a Shift of its own");
  assert.equal(shiftLapses({ value: 8, active: false }, { lent: true, atWill: false }), false, "in humanoid form already");
});

test("Aggression lets its unit start a fight in humanoid form, with Fists, for half the usual Shift", () => {
  const bends = shiftBends([{ name: "Aggression", active: false, effects: skill("Aggression").effects }]);
  assert.equal(bends.humanFight, 50);
  assert.equal(isHumanWeapon("Fists"), true);
  assert.equal(isHumanWeapon(" fists "), true);
  assert.equal(isHumanWeapon("Claw"), false);
  assert.equal(isHumanWeapon(""), false);
  const profile = { start: 0, turnHuman: 4, turnAnimal: -2, combatHuman: 5, combatAnimal: -3 };
  const fought = gaugeAfterCombat({ value: 10, active: false, fought: { own: 0, other: 0 } }, profile, { initiated: true, humanFight: bends.humanFight });
  assert.equal(fought.value, 12, "half of 5, rounded down");
  assert.equal(fought.partial, true);
});

test("Rouse gives the Beast Special Quality +1 ATK and +1 HST, and the Laguz +1 ATK and +1 END", () => {
  const who = (qualities) => ({ hp: 20, hpMax: 20, stats: {}, qualities });
  const beast = skillTotals([skill("Rouse", { active: true })], who("Beast"));
  assert.equal(beast.haste, 1);
  assert.equal(beast.combat.damage, 1);
  assert.equal(beast.endurance, 0);
  const laguz = skillTotals([skill("Rouse", { active: true })], who("Beast, Laguz"));
  assert.equal(laguz.haste, 1);
  assert.equal(laguz.combat.damage, 2);
  assert.equal(laguz.endurance, 1);
  assert.equal(skillTotals([skill("Rouse")], who("Beast")).haste, 0, "only while it is used");
  assert.equal(skillTotals([skill("Rouse", { active: true })], who("Armored")).haste, 0);

  // Haste is counted as Attack Speed for its own follow-up attack
  const fast = { stats: { spd: 11 } };
  assert.equal(planExchange(A(fast), B()).initiator.attacks, 1, "3 Attack Speed ahead is one short");
  assert.equal(planExchange(A({ ...fast, qualities: "Beast", skills: [skill("Rouse", { active: true })] }), B()).initiator.attacks, 2);
});

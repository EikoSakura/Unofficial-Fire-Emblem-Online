/**
 * Tests for `module/rules/staves.mjs` and what Step 30 gave the skills: what each staff of the Weapons tab
 * does, whom it may be used on and how far it reaches, staves for several units with what the skills of the
 * units make of each unit healed, Offensive Staves, healing by any means, and who may fight with a staff.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import { bonusesOf, settleBonuses } from "../module/rules/choices.mjs";
import { RULES, checkEffects, skillTotals } from "../module/rules/skills.mjs";
import {
  STAFF_COMBAT, castStaff, fightsWithStaff, healMoments, healingShare, nearestEnemies, staffBends, staffCatches, staffDamage, staffDamageTo,
  staffDice, staffHalving, staffMending, staffPlan, staffReach, staffReaches, staffRepair, staffTakes
} from "../module/rules/staves.mjs";
import { boostChange, buildChange, cleanChange } from "../module/rules/timed.mjs";
import { dice, made, skill } from "./lib/fixtures.mjs";

const STEP = ["Live to Serve", "Reciprocity", "Selfstaff", "Maim & Mend", "Requiescat", "Metal Medicine", "Venerable", "Ambulance", "Prevail",
  "Blessing", "Staff Savant", "Staff Fighter", "Balm", "Greater Terror"];

/** The staves of the Weapons tab: their Range and their Effect, word for word. */
const STAVES = {
  "Broken Staff": ["1", "Combat can be initiated with staff even if\nuser does not have Staff Training."],
  Treat: ["1", "Heals target by 5 + MAG/2."],
  Soothe: ["1", "Heals target by 5 + MAG."],
  "Bloom Festal": ["1-2", "Heals target by 5 + MAG/2."],
  Heal: ["1", "Heals target by 10 + MAG."],
  Refresh: ["1", "Target heals 5 + MAG/2 at the start of their turn for 3 turns."],
  Push: ["1-MAG", "Moves an enemy OR ally by 1 space, in any direction. Guaranteed to hit against allies."],
  Balmwood: ["1", "Heals user and target by 5 + MAG."],
  Venom: ["1-MAG/2", "Target is afflicted with Poison."],
  Freeze: ["1-7", "Target’s Movement is reduced to 0 until the next turn, Target’s Dodge is also reduced by 20."],
  Mend: ["1", "Heals target by 20 + MAG."],
  "Sun Festal": ["1-2", "Heals target by 15 + MAG/2."],
  Remedy: ["1", "Target heals 7 + MAG at the start of their turn for 3 turns."],
  Restore: ["1", "Removes all Conditions."],
  Pain: ["2", "10 + MAG/2 damage lowered by RES."],
  Speed: ["1", "Target gains +3 SPD until this unit's next turn."],
  Strength: ["1", "Target gains +3 STR and MAG until this unit’s next turn."],
  Illume: ["1-MAG/2", "1 space in range gains a LOS of 5 decreasing by 1 every turn until normal."],
  Unlock: ["1-MAG", "Opens a Door or Chest."],
  Disarm: ["2", "Target cannot counterattack for 3 turns."],
  Absorb: ["2", "6 + MAG/2 damage lowered by RES. Unit receives half of damage dealt as healing."],
  Enfeeble: ["1-5", "All of the target’s stats are reduced by 3 until the end of the turn."],
  Repair: ["1", "Restores half uses to 1 weapon or shield. Cannot restore a Repair, Hammerne or Helarn."],
  Panic: ["1-5", "Any bonuses on the target become penalties until the end of the turn."],
  Assault: ["2", "10 + MAG damage lowered by RES."],
  "Wane Festal": ["1-MAG", "Heals target by 15 + MAG/2."],
  Physic: ["1-MAG/2", "Heals target by 10 + MAG."],
  Clear: ["1", "Heals target by 10 + MAG and clears target's stat debuffs."],
  "Star Festal": ["1", "Heals all adjacent allies for 10 + MAG."],
  Rescue: ["1-MAG", "Teleports ally in range to an adjacent space."],
  Return: ["1", "Teleports target back to it's starting space."],
  Barrier: ["1", "+7 RES, Decreases by 1 each turn until normal."],
  Blind: ["1-MAG/2", "Target's Accuracy is halved until the start of this unit's next turn."],
  Catharsis: ["1-MAG/2", "Heals target by 20 + MAG."],
  Disturb: ["1-5", "Targets each enemy in range seperately, targets get the Rattled Condition."],
  Bind: ["1-MAG/2", "Target is afflicted with Bind."],
  Inaction: ["1-MAG/2", "Target is afflicted with Disable."],
  Renew: ["1", "Target heals 10 + MAG/2 at the start of their turn for 3 turns."],
  Ensorcel: ["1", "+7 MAG, Decreases by 1 each turn until normal."],
  Charm: ["1-10", "Target becomes a neutral unit for 3 turns that does not attack allies or foes."],
  Defense: ["1", "Halves the amount of damage target receives until this unit's next turn."],
  Crest: ["1", "Target gains +15 Skill activation chance for 2 turns."],
  Entrap: ["1-MAG/2", "Teleports enemy unit in range to a space\nadjacent to the user."],
  Hammerne: ["1", "Restores all uses to 1 weapon or shield. Cannot restore a Repair, Hammerne or Helarn."],
  Hex: ["1-3", "Target's HP is halved. Kills if target's HP is 1."],
  "Moon Festal": ["1-2", "Heals 35 + MAG/2."],
  Recover: ["1", "Heals all HP."],
  Empower: ["1-5", "All of the target’s stats are increased by 3 until the end of the turn."],
  Silence: ["1-MAG/2", "Target is afflicted with Silence."],
  Expel: ["1-MAG/2", "Targets each enemy in range seperately,\nTarget is instantly killed if they have the\nTerror special quality. No effect on Non-\nTerror units and Terrors with the Greater\nTerror skill."],
  Thief: ["1-MAG/2", "Steals 1 weapon or item from target."],
  Warp: ["1-MAG/2", "Teleports an adjacent ally to a space in range."],
  Agony: ["1-2", "10 + MAG damage lowered by RES. Enemies adjacent to target receive half of the damage taken."],
  Fortify: ["1-5", "Restore all HP to all allies in range."],
  Reinforce: ["1-5", "All allies in range heal 5 + MAG/2 at the start of their turn for 3 turns."],
  "Great Festal": ["1-10", "Heals 3 + MAG to all allies in range."],
  Regenerate: ["1", "Target heals 15 + MAG/2 at the start \nof their turn for 3 turns."],
  Obscure: ["1-MAG/2", "Target cannot be targeted by enemies until the start of this unit's next turn."],
  Watch: ["-", "Reveals the entire map during Fog of War for 3 turns."],
  Haste: ["1", "Target gains +8 SPD and +2 MOV until this unit's next turn."],
  Rewarp: ["1-MAG/2", "Teleports unit to a space in range."],
  Miswarp: ["1-MAG/2", "Teleports target to a random space within the staff's range. After target is teleported, their HP is halved."],
  Nightmare: ["1-5", "Targets each enemy in range seperately, targets get the Sleep Condition."],
  Again: ["1", "Target can perform two actions after moving."],
  Berserk: ["1-MAG/2", "Target is afflicted with Berserk."],
  Sleep: ["1-MAG/2", "Target is afflicted with Sleep."],
  Petrify: ["1-MAG/2", "Target is afflicted with Petrification."],
  Aid: ["1-MAG/2", "Ally unit is reduced to 1 HP instead from\nnext lethal attack until next turn."],
  Kia: ["1-2", "Removes all Conditions and prevents targeted ally from receiving Conditions for the rest of the map."],
  Anew: ["-", "Grants all allies 1 additional movement\nand action this turn."],
  "Ashera Staff": ["-", "Restores all HP to all allies, +5 DEF."],
  Valkyria: ["-", "Brings a fallen ally back up to 100% HP, placing them adjacent to user. That unit can take no actions this turn. Can be used out of combat."],
  Helarn: ["1", "Gives a weapon infinite uses. Cannot be\nused on a Repair, Hammerne or other Helarn staff."],
  Latona: ["-", "Completely heals all allies and restores them to normal condition."]
};

/** A staff of that table, as the rules are handed one. */
const staff = (name) => ({ name, range: STAVES[name][0], effect: STAVES[name][1], hit: 50 });

/** What a staff of that table does in the hands of a unit with 10 MAG. */
const plan = (name) => staffPlan(staff(name), { mag: 10 });

/** A unit that uses a staff. */
const caster = (skills = [], more = {}) => ({
  name: "Healer", uuid: "Actor.healer", hp: 20, hpMax: 30, level: 5, stats: { mag: 10, dex: 12, def: 10, luk: 6 }, conditions: {}, skills, ...more
});

/** An ally a staff is used on, hurt unless told otherwise. */
const ally = (id, more = {}) => ({ id, name: id, hp: 5, hpMax: 40, level: 5, stats: {}, conditions: {}, skills: [], ally: true, distance: 1, ...more });

/** A unit as a staff finds it on the map. */
const mark = (more = {}) => ({ id: "x", relation: "ally", distance: 1, ...more });

test("every staff of the Weapons tab is read, and all are applied by the system but Aid, Illume and Watch", () => {
  const text = Object.keys(STAVES).filter((name) => !plan(name).applied);
  assert.deepEqual(text.sort(), ["Aid", "Broken Staff", "Illume", "Watch"], "what stays on the card");
  const on = (kind) => Object.keys(STAVES).filter((name) => plan(name).on === kind).sort();
  assert.deepEqual(on("allies"), ["Anew", "Ashera Staff", "Fortify", "Great Festal", "Latona", "Reinforce", "Star Festal"]);
  assert.deepEqual(on("enemies"), ["Disturb", "Expel", "Nightmare"]);
  assert.deepEqual(on("self"), ["Rewarp"]);
  assert.deepEqual(on("object"), ["Unlock"]);
  assert.deepEqual(on("fallen"), ["Valkyria"]);
  assert.deepEqual(on("nobody"), ["Illume", "Watch"]);
  assert.equal(plan("Star Festal").span, "adjacent");
  assert.equal(plan("Fortify").span, "range");
});

test("a staff's parts: healing, healing over turns, cures, conditions, damage, changes and the rest", () => {
  assert.deepEqual(plan("Heal").heal, { amount: 20, full: false, user: false });
  assert.deepEqual(plan("Balmwood").heal, { amount: 15, full: false, user: true });
  assert.deepEqual(plan("Latona").heal, { amount: null, full: true, user: false });
  assert.equal(plan("Latona").cure, "all");
  assert.equal(plan("Restore").cure, "all");
  assert.equal(plan("Kia").cure, "all");
  assert.deepEqual(staffMending(STAVES.Refresh[1], { mag: 10 }), { amount: 10, turns: 3 });
  assert.deepEqual(plan("Regenerate").mend, { amount: 20, turns: 3 }, "a line break in the Effect is no matter");
  assert.deepEqual(plan("Reinforce").mend, { amount: 10, turns: 3 });
  assert.equal(plan("Refresh").heal, null, "healing over turns is no healing at once");
  for ( const [name, id] of [["Venom", "poison"], ["Bind", "bind"], ["Inaction", "disable"], ["Silence", "silence"], ["Berserk", "berserk"],
    ["Sleep", "sleep"], ["Petrify", "petrification"], ["Disturb", "rattled"], ["Nightmare", "sleep"]] ) {
    assert.deepEqual(plan(name).inflicts, [id], name);
  }
  assert.deepEqual(staffDamage(STAVES.Pain[1], { mag: 10 }), { amount: 15 });
  assert.equal(staffDamageTo(plan("Assault"), { res: 6 }), 14);
  assert.equal(staffDamageTo(plan("Pain"), { res: 40 }), 0, "never below nothing");
  assert.equal(plan("Absorb").drain, 50);
  assert.deepEqual(plan("Agony").splash, { within: 1, percent: 50 });
  assert.equal(staffHalving(plan("Hex"), 21), 11, "half, rounded down, is left");
  assert.equal(staffHalving(plan("Hex"), 1), 1, "and 1 HP is a kill");
  assert.deepEqual(plan("Expel").slays, ["Terror"]);
  assert.equal(plan("Thief").steals, true);
  assert.deepEqual(plan("Again").again, { mov: "none" });
  assert.deepEqual(plan("Anew").again, { mov: "full" });
  assert.equal(plan("Warp").warp.moves, "ally");
  assert.equal(plan("Charm").change.effects[0].rules.includes("neutral"), true, "Charm's change is the one skills grant");
  assert.equal(plan("Heal").inflicts.length, 0);
  assert.equal(plan("Restore").inflicts.length, 0, "a staff for allies inflicts nothing");
});

test("the changes staves leave are ones the system keeps", () => {
  for ( const name of Object.keys(STAVES) ) {
    const change = plan(name).change;
    if ( !change ) continue;
    assert.deepEqual(checkEffects(change.effects), [], name);
    const built = buildChange(change, { skill: name, from: "Healer", giver: "Actor.healer", giverInTurn: true });
    assert.ok(cleanChange(built, checkEffects), `${name} is kept`);
  }
  const barrier = buildChange(plan("Barrier").change, { skill: "Barrier", from: "Healer", giver: "Actor.healer" });
  assert.equal(barrier.stacks, 7, "+7 RES");
  assert.equal(barrier.fades, true, "less 1 each turn");
  const speed = buildChange(plan("Speed").change, { skill: "Speed", from: "Healer", giver: "Actor.healer", giverInTurn: true });
  assert.equal(speed.clock, "Actor.healer", "until its user's next turn");
  assert.equal(buildChange(plan("Empower").change, { skill: "Empower", from: "Healer" }).ends, "phaseEnd");
  const mend = cleanChange(buildChange({ name: "Refresh", effects: [], mend: 10, ends: "turnStart", turns: 3 }, { skill: "Refresh", from: "Healer" }), checkEffects);
  assert.equal(mend.mend, 10);
  assert.equal(mend.turns, 3);
});

test("Panic turns a unit's own bonuses around in a fight", () => {
  const panic = { name: "Panic", effects: plan("Panic").change.effects };
  const totals = skillTotals([made("Rally", [{ stats: { str: 4, spd: 2 } }]), panic], { hp: 20, hpMax: 20, stats: {}, conditions: {} }, { fight: { role: "defending", distance: 1 } });
  assert.deepEqual(totals.ownBonus.map((entry) => entry.times), [-1]);
  const settled = settleBonuses(totals.ownBonus, bonusesOf(totals.sources));
  assert.deepEqual(settled.stats, { str: -8, spd: -4 }, "+4 becomes -4");
});

test("whom a staff may be used on, and why not", () => {
  const reach = { min: 1, max: 5 };
  const heal = plan("Physic");
  assert.deepEqual(staffTakes(heal, mark({ distance: 5 }), { reach }), { ok: true, why: null });
  assert.equal(staffTakes(heal, mark({ distance: 6 }), { reach }).why, "out");
  assert.equal(staffTakes(heal, mark({ relation: "enemy" }), { reach }).why, "ally");
  assert.equal(staffTakes(heal, mark({ out: true }), { reach }).why, "down");
  assert.equal(staffTakes(heal, mark({ self: true, distance: 0 }), { reach }).why, "self");
  assert.equal(staffTakes(heal, mark({ self: true, distance: 0 }), { reach, selfStaff: true }).ok, true, "Selfstaff");
  assert.equal(staffTakes(plan("Warp"), mark({ self: true, distance: 0 }), { reach, selfStaff: true }).why, "selfNot", "it still needs Rewarp");
  assert.equal(staffTakes(plan("Sleep"), mark({ self: true, distance: 0 }), { reach, selfStaff: true }).why, "selfNot");
  const sleep = plan("Sleep");
  assert.equal(staffTakes(sleep, mark({ relation: "enemy", distance: 3 }), { reach }).ok, true);
  assert.equal(staffTakes(sleep, mark({ relation: "ally", distance: 3 }), { reach }).why, "enemy");
  assert.equal(staffTakes(sleep, mark({ relation: "enemy", distance: 3, untargetable: true }), { reach }).why, "barred");
  assert.equal(staffTakes(plan("Push"), mark({ relation: "enemy", distance: 2 }), { reach }).ok, true, "for an enemy or an ally");
  assert.equal(staffTakes(plan("Push"), mark({ relation: "enemy", distance: 2, unforced: true }), { reach }).why, "unmoved");
  assert.equal(staffTakes(plan("Warp"), mark({ distance: 2 }), { reach }).why, "beside");
  assert.equal(staffTakes(heal, mark({ distance: 40 }), { reach: null }).ok, true, "a Range that sets no limit");
  assert.equal(staffReaches({ min: 2, max: 2 }, 1), false);
});

test("Blessing doubles a staff's reach and Staff Savant raises it to 10, and a staff is refused beyond it", () => {
  const stats = { mag: 8 };
  const blessed = staffBends([skill("Blessing")], {}).ranges;
  const savant = staffBends([skill("Staff Savant")], {});
  assert.deepEqual(staffReach("1-MAG/2", stats, blessed), { min: 1, max: 8, changed: true });
  assert.deepEqual(staffReach("1", stats, blessed), { min: 1, max: 2, changed: true });
  assert.deepEqual(staffReach("1", stats, savant.ranges), { min: 1, max: 10, changed: true });
  assert.equal(savant.rules.staffFreeUses, "Staff Savant", "and its staves lose no use");
  const heal = plan("Heal");
  assert.equal(staffTakes(heal, mark({ distance: 2 }), { reach: staffReach("1", stats, []) }).why, "out");
  assert.equal(staffTakes(heal, mark({ distance: 2 }), { reach: staffReach("1", stats, blessed) }).ok, true);
  assert.equal(staffTakes(heal, mark({ distance: 3 }), { reach: staffReach("1", stats, blessed) }).why, "out");
  assert.equal(staffTakes(heal, mark({ distance: 10 }), { reach: staffReach("1", stats, savant.ranges) }).ok, true);
  assert.equal(staffTakes(heal, mark({ distance: 11 }), { reach: staffReach("1", stats, savant.ranges) }).why, "out");
});

test("Greater Terror is left out of Expel, and Expel does nothing to a unit that is no Terror", () => {
  const expel = plan("Expel");
  const immune = staffBends([skill("Greater Terror")], {}).immune;
  assert.deepEqual(immune, ["Expel"]);
  const reach = { min: 1, max: 5 };
  const terror = mark({ id: "t", relation: "enemy", distance: 2, qualities: "Monster, Terror" });
  const greater = mark({ id: "g", relation: "enemy", distance: 2, qualities: "Terror", immune });
  const soldier = mark({ id: "s", relation: "enemy", distance: 2, qualities: "Armored" });
  assert.equal(staffTakes(expel, terror, { reach }).ok, true);
  assert.equal(staffTakes(expel, greater, { reach }).why, "immune");
  assert.equal(staffTakes(expel, soldier, { reach }).why, "nothing");
  assert.deepEqual(staffCatches(expel, [terror, greater, soldier, mark({ id: "far", relation: "enemy", distance: 9, qualities: "Terror" })], { reach }).map((unit) => unit.id), ["t"]);
  assert.equal(staffTakes(plan("Sleep"), greater, { reach }).ok, true, "any other staff still reaches it");

  // The staff is rolled against the enemies it was handed, and no other
  const cast = castStaff({
    staff: staff("Expel"), caster: caster([], { staffHit: 80 }), enemies: [{ id: "t", name: "Terror", staffAvoid: 10, distance: 2 }], d100: dice(40)
  });
  assert.deepEqual(cast.reached.map((entry) => [entry.id, entry.success, entry.chance]), [["t", true, 66]]);
});

test("a staff for several units catches every ally in reach, and its user with Selfstaff", () => {
  const units = [mark({ id: "me", self: true, distance: 0 }), mark({ id: "a", distance: 1 }), mark({ id: "b", distance: 5 }), mark({ id: "c", distance: 6 }),
    mark({ id: "foe", relation: "enemy", distance: 2 }), mark({ id: "down", distance: 2, out: true })];
  const ids = (name, options) => staffCatches(plan(name), units, options).map((unit) => unit.id);
  assert.deepEqual(ids("Fortify", { reach: { min: 1, max: 5 } }), ["a", "b"]);
  assert.deepEqual(ids("Fortify", { reach: { min: 1, max: 5 }, selfStaff: true }), ["me", "a", "b"], "Selfstaff");
  assert.deepEqual(ids("Star Festal", { reach: { min: 1, max: 1 } }), ["a"]);
  assert.deepEqual(ids("Star Festal", { reach: { min: 1, max: 10 } }), ["a"], "adjacent stays adjacent whatever the reach");
  assert.deepEqual(ids("Latona", { reach: null }), ["a", "b", "c"], "a Range that sets no limit");
  assert.deepEqual(ids("Nightmare", { reach: { min: 1, max: 5 } }), ["foe"]);
  assert.deepEqual(ids("Heal", { reach: { min: 1, max: 1 } }), [], "a staff for one unit catches nobody");
});

test("a staff for several units heals each ally for its own amount", () => {
  const cast = castStaff({
    staff: staff("Great Festal"), caster: caster(), patients: [ally("a", { hp: 30 }), ally("b", { hp: 39 }), ally("c", { hp: 40 })]
  });
  assert.deepEqual(cast.units.map((part) => [part.id, part.amount, part.restored]), [["a", 13, 10], ["b", 13, 1], ["c", 13, 0]]);
  const full = castStaff({ staff: staff("Fortify"), caster: caster(), patients: [ally("a", { hp: 30 }), ally("b", { hp: 1 })] });
  assert.deepEqual(full.units.map((part) => part.restored), [10, 39], "all its HP, each");
  assert.equal(full.casts.length, 0);
  assert.equal(castStaff({ staff: staff("Reinforce"), caster: caster(), patients: [ally("a")] }).mend.amount, 10);
  assert.ok(staffDice(4, { staffMissing: { enabled: true } }) >= 8, "a die to reach each, and one for a critical for each");
});

test("Staff Missing and Heal Criticals roll for each unit of a staff for several", () => {
  const rules = { ...FEO.optional, staffMissing: { ...FEO.optional.staffMissing, enabled: true }, healCriticals: { ...FEO.optional.healCriticals, enabled: true } };

  // Hit 50 + DEX 12 x 3 = 86; the critical is LUK 6 / 2 = 3
  const cast = castStaff({
    staff: staff("Great Festal"), caster: caster(), patients: [ally("a"), ally("b")], d100: dice(90, 10, 3), rules
  });
  assert.deepEqual(cast.reached.map((entry) => entry.success), [false, true]);
  assert.deepEqual(cast.units.map((part) => [part.landed, part.restored]), [[false, 0], [true, 35]], "missed, and a critical for 13 x 3 held at what it lacks");
  assert.equal(cast.missed, false);
});

test("Live to Serve and Reciprocity: the user regains its share once, as much as the ally that regained the most", () => {
  const patients = () => [ally("a", { hp: 36 }), ally("b", { hp: 20 })];
  const served = castStaff({ staff: staff("Great Festal"), caster: caster([skill("Live to Serve")]), patients: patients() });
  assert.deepEqual(served.user, { amount: 13, restored: 10, skills: ["Live to Serve"] }, "13 once, of which it lacks 10");
  const one = castStaff({ staff: staff("Heal"), caster: caster([skill("Live to Serve")]), target: ally("a", { hp: 36 }), distance: 1 });
  assert.equal(one.user.amount, 4, "with one target: what that one regained");
  const balm = castStaff({ staff: staff("Balmwood"), caster: caster([skill("Live to Serve")]), target: ally("a"), distance: 1 });
  assert.equal(balm.user.amount, 18, "and a quarter more from Balmwood");

  const given = castStaff({
    staff: staff("Great Festal"), caster: caster(), patients: [ally("a", { hp: 36, skills: [skill("Reciprocity")] }), ally("b", { hp: 20, skills: [skill("Reciprocity")] })]
  });
  assert.deepEqual(given.user, { amount: 13, restored: 10, skills: ["Reciprocity"] }, "once, however many have the skill");
  const none = castStaff({ staff: staff("Great Festal"), caster: caster(), patients: patients() });
  assert.equal(none.user, null);
  const unhurt = castStaff({
    staff: staff("Great Festal"), caster: caster(), patients: [ally("a", { hp: 40, skills: [skill("Reciprocity")] }), ally("b", { hp: 20 })]
  });
  assert.equal(unhurt.user, null, "an ally with the skill that regained nothing gives nothing back");
});

test("Selfstaff: a staff for one ally is used on its user, and a staff for several is for it too", () => {
  const skills = [skill("Selfstaff"), skill("Live to Serve")];
  const self = castStaff({ staff: staff("Heal"), caster: caster(skills) });
  assert.equal(self.patient, "self");
  assert.equal(self.heal.restored, 10);
  assert.equal(castStaff({ staff: staff("Speed"), caster: caster(skills) }).patient, "self", "a staff that does not heal as well");
  assert.equal(castStaff({ staff: staff("Sleep"), caster: caster(skills) }).patient, null, "not one against enemies");
  assert.equal(castStaff({ staff: staff("Warp"), caster: caster(skills) }).patient, null, "nor one that moves a unit");
  assert.equal(castStaff({ staff: staff("Heal"), caster: caster() }).patient, null, "nor without the skill");
  const several = castStaff({
    staff: staff("Great Festal"), caster: caster(skills), patients: [{ ...caster(skills), id: "me", self: true, distance: 0 }, ally("a")]
  });
  assert.deepEqual(several.units.map((part) => [part.id, part.self, part.restored]), [["me", true, 10], ["a", false, 13]]);
  assert.equal(several.user, null, "it is healed with the others, and regains nothing on top");
});

test("Maim & Mend: half as much again for each ally, with staves for several and over turns too", () => {
  const change = skill("Maim & Mend").effects[0].grant.effects;
  const skills = [made("Maim & Mend", change)];
  const cast = castStaff({ staff: staff("Great Festal"), caster: caster(skills), patients: [ally("a"), ally("b", { hp: 30 })] });
  assert.deepEqual(cast.units.map((part) => [part.amount, part.restored]), [[19, 19], [19, 10]], "13 x 1.5, rounded down");
  assert.deepEqual(cast.heal.skills, ["Maim & Mend"]);
  const mend = castStaff({ staff: staff("Refresh"), caster: caster(skills), target: ally("a"), distance: 1 }).mend;
  assert.deepEqual(mend, { amount: 15, own: 10, turns: 3 });
});

test("Metal Medicine is rolled once for a staff for several units, and counts for each ally healed", () => {
  const skills = [skill("Metal Medicine")];
  const patients = () => [ally("a"), ally("b", { hp: 30 }), ally("c", { hp: 40 })];
  const hit = castStaff({ staff: staff("Great Festal"), caster: caster(skills), patients: patients(), d100: dice(6) });
  assert.deepEqual(hit.units.map((part) => part.amount), [19, 19, 19], "13 + 60% of DEF 10");
  const granted = hit.moments.find((moment) => moment.skill === "Metal Medicine").granted;
  assert.deepEqual(granted.map((grant) => [grant.to, grant.id, grant.change.effects[0].stats.def]), [["target", "a", 6], ["target", "b", 6]], "not the ally that regained nothing");
  const miss = castStaff({ staff: staff("Great Festal"), caster: caster(skills), patients: patients(), d100: dice(7) });
  assert.deepEqual(miss.units.map((part) => part.amount), [13, 13, 13], "one roll for all of them");
  assert.equal(miss.moments.find((moment) => moment.skill === "Metal Medicine").granted.length, 0);
});

test("Venerable gains a fifth of the most HP one ally regained, once", () => {
  const cast = castStaff({ staff: staff("Great Festal"), caster: caster([skill("Venerable")]), patients: [ally("a", { hp: 36 }), ally("b")] });
  const granted = cast.moments.find((moment) => moment.skill === "Venerable").granted;
  assert.equal(granted.length, 1);
  assert.deepEqual(granted[0].change.effects[0].stats, { def: 2, res: 2 }, "13 / 5");
  const none = castStaff({ staff: staff("Great Festal"), caster: caster([skill("Venerable")]), patients: [ally("a", { hp: 40 })] });
  assert.equal(none.moments.length, 0, "nobody was healed");
});

test("Ambulance: +5 HP for each unit healed, and its END once", () => {
  const plus = skill("Ambulance").effects[0].grant.effects;
  const skills = [skill("Ambulance"), made("Ambulance", plus)];
  const cast = castStaff({ staff: staff("Great Festal"), caster: caster(skills), patients: [ally("a"), ally("b")] });
  assert.deepEqual(cast.units.map((part) => part.amount), [18, 18]);
  const end = cast.moments.filter((moment) => moment.skill === "Ambulance").flatMap((moment) => moment.granted);
  assert.deepEqual(end.map((grant) => [grant.to, grant.change.name]), [["self", "Ambulance (END)"]]);
});

test("Balm buffs every ally a staff for several units is used on", () => {
  const skills = [skill("Balm", { choice: "Fire Balm" })];
  const several = castStaff({ staff: staff("Fortify"), caster: caster(skills), patients: [ally("a"), ally("b", { hp: 40 }), ally("c")] });
  const granted = several.moments.find((moment) => moment.skill === "Balm").granted;
  assert.deepEqual(granted.map((grant) => [grant.id, grant.change.name, grant.change.effects[0].stats.str]), [["a", "Fire Balm", 2], ["b", "Fire Balm", 2], ["c", "Fire Balm", 2]]);
  const one = castStaff({ staff: staff("Speed"), caster: caster(skills), target: ally("a"), distance: 1 });
  assert.deepEqual(one.moments[0].granted.map((grant) => grant.id), ["a"]);
  const rules = { ...FEO.optional, staffMissing: { ...FEO.optional.staffMissing, enabled: true } };
  const missed = castStaff({ staff: staff("Fortify"), caster: caster(skills), patients: [ally("a"), ally("b")], d100: dice(99, 1), rules });
  assert.deepEqual(missed.moments[0].granted.map((grant) => grant.id), ["b"], "not an ally the staff missed");
});

test("Prevail doubles what the allies around it heal for, and the bonuses they give", () => {
  const aura = skill("Prevail").effects[0];
  assert.deepEqual(aura.aura, { who: "ally", within: 3 });
  const { aura: reach, ...received } = aura;
  const near = [made("Prevail", [received])];
  const self = { hp: 20, hpMax: 20, stats: {}, conditions: {} };
  assert.equal(healingShare(near, self), 100, "healing by any means");
  assert.equal(healingShare([skill("Prevail")], self), 0, "not its own unit's");
  assert.equal(healingShare([skill("Maim & Mend")], self), 0, "staves and items only");
  const cast = castStaff({ staff: staff("Great Festal"), caster: caster(near), patients: [ally("a"), ally("b", { hp: 30 })] });
  assert.deepEqual(cast.units.map((part) => part.amount), [26, 26]);
  const one = castStaff({ staff: staff("Heal"), caster: caster(near), target: ally("a"), distance: 1 });
  assert.equal(one.heal.amount, 40);

  // The bonuses of a change it gives are doubled, what it takes off is not
  const change = buildChange({ effects: [{ stats: { str: 3, def: -2 }, combat: { hit: 10 }, might: 1 }], ends: "turnEnd" }, { skill: "Rally", from: "Healer" });
  const boosted = boostChange(change, received.buffs.times);
  assert.deepEqual(boosted.effects[0], { stats: { str: 6, def: -2 }, combat: { hit: 20 }, might: 2 });
  assert.equal(boostChange(change, 1), change, "nothing to multiply");
  assert.ok(cleanChange(boosted, checkEffects));
});

test("Requiescat: healing an ally by any means harms the enemy nearest to it, and a tie is for its owner to pick", () => {
  const healer = caster([skill("Requiescat")]);
  const foe = (id, distance, more = {}) => ({ id, name: id, relation: "enemy", distance, hp: 20, ...more });
  const near = (...others) => ({ others });
  const one = healMoments({ healer, patient: { near: near(foe("far", 2), foe("close", 1), { id: "friend", relation: "ally", distance: 1, hp: 9 }) }, healed: 13 });
  assert.deepEqual(one.harms, [{ skill: "Requiescat", amount: 6, within: 2, units: [{ id: "close", name: "close", hp: 20, distance: 1 }] }]);
  const tie = healMoments({ healer, patient: { near: near(foe("x", 2), foe("y", 2), foe("z", 3)) }, healed: 9 });
  assert.deepEqual(tie.harms[0].units.map((unit) => unit.id), ["x", "y"], "both, for whoever acts to pick");
  assert.equal(tie.harms[0].amount, 4);
  assert.deepEqual(healMoments({ healer, patient: { near: near(foe("z", 3)) }, healed: 9 }).harms, [], "nobody within 2");
  assert.deepEqual(healMoments({ healer, patient: { near: near(foe("x", 1)) }, healed: 1 }).harms, [], "half of 1 is nothing");
  assert.deepEqual(healMoments({ healer: caster(), patient: { near: near(foe("x", 1)) }, healed: 9 }).harms, []);
  assert.deepEqual(nearestEnemies(near(foe("gone", 1, { out: true }), foe("hid", 1, { untargetable: true }), foe("x", 2)), 2).map((unit) => unit.id), ["x"]);

  // A staff no longer deals it itself: it comes with the healing, once for each ally healed
  const cast = castStaff({ staff: staff("Heal"), caster: healer, target: ally("a", { near: near(foe("x", 1)) }), distance: 1 });
  assert.deepEqual(cast.moments, []);
});

test("Staff Fighter: only its unit starts a fight with a staff, a Broken Staff aside", () => {
  assert.ok(RULES.includes(STAFF_COMBAT));
  const rules = skillTotals([skill("Staff Fighter")], { hp: 20, hpMax: 20, stats: {}, conditions: {} }).rules;
  assert.equal(fightsWithStaff(staff("Heal"), rules), true);
  assert.equal(fightsWithStaff(staff("Heal"), []), false);
  assert.equal(fightsWithStaff(staff("Broken Staff"), []), true, "its Effect says anybody may");
  const fighting = skillTotals([skill("Staff Fighter")], { hp: 20, hpMax: 20, stats: {}, conditions: {}, weapon: { name: "Heal", category: "staff" } }, { fight: { role: "initiating", distance: 1 } });
  assert.equal(fighting.might, 4);
  assert.equal(fighting.combat.critical, 10);
});

test("a staff that repairs gives back half or all the uses, and never its own kind", () => {
  assert.deepEqual(staffRepair(plan("Repair"), { name: "Iron Sword", uses: { value: 3, max: 45 } }), { value: 25, max: 45 });
  assert.deepEqual(staffRepair(plan("Repair"), { name: "Iron Sword", uses: { value: 40, max: 45 } }), { value: 45, max: 45 });
  assert.deepEqual(staffRepair(plan("Hammerne"), { name: "Silver Lance", uses: { value: 0, max: 20 } }), { value: 20, max: 20 });
  assert.deepEqual(staffRepair(plan("Helarn"), { name: "Silver Lance", uses: { value: 7, max: 20 } }), { value: 0, max: 0 }, "no uses to lose");
  assert.equal(staffRepair(plan("Repair"), { name: "Iron Sword", uses: { value: 45, max: 45 } }), null, "nothing to repair");
  assert.equal(staffRepair(plan("Repair"), { name: "Fists", uses: { value: 0, max: 0 } }), null, "nor a weapon without uses");
  for ( const name of ["Repair", "Hammerne", "Helarn"] ) {
    assert.equal(staffRepair(plan("Hammerne"), { name, uses: { value: 0, max: 3 } }), null, name);
  }
  assert.equal(staffRepair(plan("Heal"), { name: "Iron Sword", uses: { value: 3, max: 45 } }), null);
});

test("an Offensive Staff for each enemy rolls for each, and the staff of one enemy still follows up", () => {
  const foes = [{ id: "a", name: "A", staffAvoid: 0, distance: 1 }, { id: "b", name: "B", staffAvoid: 30, distance: 5 }, { id: "c", name: "C", staffAvoid: 0, distance: 6 }];
  const cast = castStaff({ staff: staff("Nightmare"), caster: caster([], { staffHit: 60 }), enemies: foes, d100: dice(58, 21) });
  assert.deepEqual(cast.reached.map((entry) => [entry.id, entry.chance, entry.success]), [["a", 58, true], ["b", 20, false]], "the enemy 6 tiles away is out of its Range");
  assert.equal(cast.missed, false);
  const nobody = castStaff({ staff: staff("Nightmare"), caster: caster([], { staffHit: 60 }), enemies: [], d100: dice() });
  assert.equal(nobody.missed, false, "nobody to roll for is no miss");

  const foe = { id: "f", name: "Foe", hp: 20, hpMax: 20, stats: {}, conditions: {}, skills: [], enemy: true, staffAvoid: 0, attackSpeed: 2 };
  const mage = caster([skill("Staff Mage")], { staffHit: 50, attackSpeed: 5 });
  const twice = castStaff({ staff: staff("Pain"), caster: mage, target: foe, distance: 2, d100: dice(10, 90) });
  assert.deepEqual(twice.casts.map((part) => part.hit.success), [true, false], "a second cast with its own roll");
  const status = castStaff({ staff: staff("Sleep"), caster: mage, target: foe, distance: 2, d100: dice(10, 10) });
  assert.equal(status.casts.length, 1, "a status staff that landed is not cast again");
});

test("each skill of the step has what the system applies written out, with nothing left for the table", () => {
  for ( const name of STEP ) {
    const entry = skill(name, name === "Balm" ? { choice: "Fire Balm" } : {});
    assert.ok(entry.effects.length > 0, `${name} has effects`);
    assert.deepEqual(checkEffects(entry.effects), [], name);
  }
});

/**
 * Tests for `module/rules/movement.mjs` and what Step 4 gave skills to read: how a unit moved this turn, as
 * conditions and as numbers, counted to the tile it attacks from.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chargeMight, planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { moveHolds, movementFacts, needsMove, walkTo } from "../module/rules/movement.mjs";
import { reachFrom, strikeFrom } from "../module/rules/reach.mjs";
import { checkEffects, skillTotals } from "../module/rules/skills.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/** An open field of 12 by 12 tiles, with tiles that cost more to enter where told. */
function field(costly = {}) {
  return {
    inside: (tile) => (tile.i >= 0) && (tile.i < 12) && (tile.j >= 0) && (tile.j < 12),
    cost: (tile) => costly[`${tile.i},${tile.j}`] ?? 1
  };
}

/** A turn's movement: so many spaces on open ground with so much MOV. */
const moved = (spaces, mov = 5, extra = {}) => movementFacts({ spaces, cost: spaces, mov, ...extra });

/** The forecast of an attack on a foe that stands still and has no skills. */
function forecast(attacker, options = {}) {
  return planExchange(attacker, fighter({ name: "Foe", hp: 60, hpMax: 60, stats: { def: 0, spd: 0 }, ...options }), { distance: 1 });
}

test("the way to a tile is counted in spaces and in the movement they take", () => {
  const reach = reachFrom({ i: 5, j: 5 }, 5, field({ "5,6": 2 }));
  assert.deepEqual(walkTo(reach, { i: 5, j: 5 }), { spaces: 0, cost: 0 });
  assert.deepEqual(walkTo(reach, { i: 5, j: 7 }), { spaces: 2, cost: 3 });
  assert.deepEqual(walkTo(reach, { i: 5, j: 3 }), { spaces: 2, cost: 2 });

  // A tile out of reach, as for a unit set down by hand, counts the tiles between
  assert.deepEqual(walkTo(reach, { i: 5, j: 11 }), { spaces: 6, cost: 6 });
});

test("a turn's movement says what is left, whether it was a full movement and whether the weapon was kept", () => {
  assert.deepEqual(movementFacts({ spaces: 0, cost: 0, mov: 5 }), { spaces: 0, cost: 0, mov: 5, left: 5, moved: false, full: false, kept: true, passed: [], canto: 0 });
  assert.equal(movementFacts({ spaces: 3, cost: 3, mov: 5 }).left, 2);
  assert.equal(movementFacts({ spaces: 3, cost: 5, mov: 5 }).full, true);
  assert.equal(movementFacts({ spaces: 0, cost: 0, mov: 0 }).full, false);
  assert.equal(movementFacts({ held: "lance", weapon: "lance" }).kept, true);
  assert.equal(movementFacts({ held: "sword", weapon: "lance" }).kept, false);
  assert.equal(movementFacts({ held: "", weapon: "lance" }).kept, false);
  assert.equal(moveHolds({ movLeft: { max: 2 } }, moved(3)), true);
  assert.equal(moveHolds({ movLeft: { max: 2 } }, moved(2)), false);
  assert.equal(moveHolds({ moved: false }, null), false);
});

test("the movement parts of an effect are checked like any other", () => {
  assert.deepEqual(checkEffects([{ when: { moved: true, fullMove: true, weaponKept: true, movLeft: { min: 1 } }, firstMight: { of: "spacesMoved" } }]), []);
  assert.equal(checkEffects([{ when: { movLeft: { atLeast: 1 } }, might: 1 }]).length, 1);
  assert.equal(checkEffects([{ aura: { who: "ally", within: 2, when: { moved: true } }, might: 1 }]).length, 1);
  assert.equal(needsMove({ when: { role: "initiating" }, combat: { hit: { of: "movLeft", times: 4 } } }), true);
  assert.equal(needsMove({ when: { role: "initiating" }, combat: { hit: 4 } }), false);
});

test("Momentum adds half a point of damage for every space moved, and changes with the tile attacked from", () => {
  const damage = (spaces) => forecast(fighter({ skills: [skill("Momentum")], move: moved(spaces) })).initiator.damage;
  const plain = forecast(fighter({ move: moved(4) })).initiator.damage;
  assert.equal(damage(0), plain);
  assert.equal(damage(1), plain);
  assert.equal(damage(2), plain + 1);
  assert.equal(damage(5), plain + 2);

  // Nothing for the unit that is attacked
  const answer = planExchange(fighter({ name: "Foe" }), fighter({ skills: [skill("Momentum")], move: moved(5) }), { distance: 1 });
  assert.equal(answer.defender.damage, planExchange(fighter({ name: "Foe" }), fighter(), { distance: 1 }).defender.damage);
});

test("Giant Swing, Agility and Leonine Lunge count the MOV the unit has left", () => {
  const plain = forecast(fighter({ move: moved(2) }));
  const swing = forecast(fighter({ skills: [skill("Giant Swing")], move: moved(2) }));
  assert.equal(swing.initiator.base.accuracy, plain.initiator.base.accuracy + 12);
  assert.equal(swing.initiator.base.critical, plain.initiator.base.critical + 6);
  assert.deepEqual(swing.initiator.skills, ["Giant Swing"]);

  const lunge = forecast(fighter({ skills: [skill("Leonine Lunge")], move: moved(1) }));
  assert.equal(lunge.initiator.damage, plain.initiator.damage + 4);

  const nimble = forecast(fighter({ skills: [skill("Agility")], move: moved(0) }));
  assert.equal(nimble.defender.base.dodge, plain.defender.base.dodge + 15);

  // With no MOV left they add nothing, and are not named
  const spent = forecast(fighter({ skills: [skill("Giant Swing"), skill("Agility"), skill("Leonine Lunge")], move: moved(5) }));
  assert.equal(spent.initiator.damage, plain.initiator.damage);
  assert.deepEqual(spent.initiator.skills, []);
});

test("Charge adds a quarter to the damage after a full movement only", () => {
  const plain = forecast(fighter({ move: moved(5) })).initiator.damage;
  assert.equal(forecast(fighter({ skills: [skill("Charge")], move: moved(5) })).initiator.damage, Math.floor(plain * 1.25));
  assert.equal(forecast(fighter({ skills: [skill("Charge")], move: moved(4) })).initiator.damage, plain);
  assert.equal(forecast(fighter({ skills: [skill("Charge")], move: moved(0) })).initiator.damage, plain);
});

test("Moxie raises STR and the weapon's Might for a unit that has yet to move", () => {
  const plain = forecast(fighter({ move: moved(0) })).initiator.damage;

  // STR 10 gains 3, and a weapon of 5 Might gains 2
  assert.equal(forecast(fighter({ skills: [skill("Moxie")], move: moved(0) })).initiator.damage, plain + 5);
  assert.equal(forecast(fighter({ skills: [skill("Moxie")], move: moved(1) })).initiator.damage, plain);
});

test("Outrider counts the spaces moved for the unit that attacks and for the one attacked", () => {
  const plain = forecast(fighter({ move: moved(3) }));
  const rider = forecast(fighter({ skills: [skill("Outrider")], move: moved(3) }));
  assert.equal(rider.initiator.base.critical, plain.initiator.base.critical + 9);
  assert.equal(rider.defender.base.dodge, plain.defender.base.dodge + 9);

  // What it moved in its turn still counts when it is attacked afterwards
  const attacked = planExchange(fighter({ name: "Foe" }), fighter({ skills: [skill("Outrider")], move: moved(4) }), { distance: 1 });
  const usual = planExchange(fighter({ name: "Foe" }), fighter({ move: moved(4) }), { distance: 1 });
  assert.equal(attacked.initiator.base.dodge, usual.initiator.base.dodge + 12);
});

test("Perfect Shot reaches one tile further for a unit that has not moved", () => {
  const bow = { name: "Iron Bow", category: "bow", range: "2" };
  const shot = (move) => planExchange(fighter({ skills: [skill("Perfect Shot")], weapon: bow, move }), fighter({ name: "Foe" }), { distance: 3 });
  assert.equal(shot(moved(0)).initiator.blocked, null);
  assert.equal(shot(moved(1)).initiator.blocked, "outOfRange");

  // A weapon that only reaches 1 tile gains nothing
  const sword = planExchange(fighter({ skills: [skill("Perfect Shot")], move: moved(0) }), fighter({ name: "Foe" }), { distance: 2 });
  assert.equal(sword.initiator.blocked, "outOfRange");
});

test("Hastilude adds Might to the first attack alone, with a Lance held since the turn began", () => {
  const lance = { name: "Iron Lance", category: "lance" };
  const jouster = (move, weapon = lance) => forecast(fighter({ skills: [skill("Hastilude")], weapon, stats: { spd: 20 }, move }));
  const plain = forecast(fighter({ weapon: lance, stats: { spd: 20 }, move: moved(4) })).initiator;
  const charged = jouster(moved(4)).initiator;
  assert.equal(charged.doubles, true);
  assert.equal(charged.damage, plain.damage + 2);
  assert.equal(charged.damageLater, plain.damage);
  assert.equal(jouster(moved(4, 5, { held: "other", weapon: "Fighter-weapon" })).initiator.damage, plain.damage);

  // Another weapon than a Lance gains nothing
  assert.equal(jouster(moved(4), {}).initiator.damage, forecast(fighter({ stats: { spd: 20 }, move: moved(4) })).initiator.damage);

  // Rolled out, the first hit has it and the follow-up has not
  const plan = jouster(moved(4));
  const result = resolveExchange(plan, () => 50);
  const hits = result.attacks.filter((attack) => attack.side === "initiator");
  assert.deepEqual(hits.map((attack) => attack.damage), [plain.damage + 2, plain.damage]);
});

test("a Hasta gains its own Might for each space moved, on top of Hastilude", () => {
  assert.equal(chargeMight("If weapon was equipped at the start of unit's turn, it's next attack gains +1 Might per space moved."), 1);
  assert.equal(chargeMight("+5 DEX. If weapon was equipped at the start of unit's turn, it's next attack gains +2 Might per space moved."), 2);
  assert.equal(chargeMight("2x Strikes when initiating combat"), 0);
  const hasta = { name: "Iron Hasta", category: "lance", effect: "If weapon was equipped at the start of unit's turn, it's next attack gains +1 Might per space moved." };
  const plain = forecast(fighter({ weapon: hasta, move: moved(0) })).initiator.damage;
  assert.equal(forecast(fighter({ weapon: hasta, move: moved(3) })).initiator.damage, plain + 3);
  assert.equal(forecast(fighter({ weapon: hasta, skills: [skill("Hastilude")], move: moved(4) })).initiator.damage, plain + 6);
  assert.equal(forecast(fighter({ weapon: hasta, move: null })).initiator.damage, plain);
});

test("a unit whose movement cannot be judged has its skill named to check by hand, and nothing applied", () => {
  const plain = forecast(fighter()).initiator;
  const blind = forecast(fighter({ skills: [skill("Momentum"), skill("Charge"), skill("Outrider")] })).initiator;
  assert.equal(blind.damage, plain.damage);
  assert.deepEqual(blind.skills, []);
  assert.deepEqual(blind.checks.map((entry) => entry.skill), ["Momentum", "Charge", "Outrider"]);

  // What does not hold anyway is not named: Momentum is for the unit that starts the fight
  const attacked = planExchange(fighter({ name: "Foe" }), fighter({ skills: [skill("Momentum")] }), { distance: 1 });
  assert.deepEqual(attacked.defender.checks, []);
});

test("Run adds 3 MOV while it is on, and leaves nothing but Waiting once any of it is used", () => {
  const self = (move) => ({ hp: 20, hpMax: 20, level: 5, stats: { mov: 5 }, weapon: null, move });
  const run = skill("Run", { active: true });
  const off = skillTotals([skill("Run")], self(moved(0, 5)));
  assert.equal(off.stats.mov ?? 0, 0);
  assert.equal(off.rules.has("onlyWait"), false);

  const fresh = skillTotals([run], self(moved(0, 8)));
  assert.equal(fresh.stats.mov, 3);
  assert.equal(fresh.rules.has("onlyWait"), false);
  assert.equal(skillTotals([run], self(moved(5, 8))).rules.has("onlyWait"), false);
  assert.equal(skillTotals([run], self(moved(6, 8))).rules.has("onlyWait"), true);
  assert.equal(skillTotals([run], self(moved(8, 8))).rules.has("onlyWait"), true);
});

test("Full Tilt grants MOV and HST on a critical hit, up to three times over", () => {
  const plan = forecast(fighter({ skills: [skill("Full Tilt")], weapon: { crit: 200 } }));
  const result = resolveExchange(plan, () => 1);
  const granted = (result.granted ?? []).filter((entry) => entry.change.name === "Full Tilt");
  assert.ok(granted.length >= 1);
  assert.deepEqual(granted[0].change.effects, [{ stats: { mov: 1 }, haste: 2 }]);
  assert.equal(granted[0].change.max, 3);
  assert.equal(granted[0].change.ends, "map");

  // Carried three times over it is +3 MOV and +6 HST
  const carried = skillTotals([made("Full Tilt", [{ stats: { mov: 1 }, haste: 2, scale: 3 }])], { hp: 20, hpMax: 20, level: 5, stats: {}, weapon: null });
  assert.equal(carried.stats.mov, 3);
  assert.equal(carried.haste, 6);
});

test("a weapon that reaches further for a unit that stays put is only counted from where it stands", () => {
  const reach = reachFrom({ i: 5, j: 5 }, 3, field());
  const bow = { min: 2, max: 3 };
  const walking = { min: 2, max: 2 };

  // From where it stands the foe 3 tiles away is in reach; a foe 5 tiles away is struck from 2 tiles, not 3
  assert.deepEqual(strikeFrom(reach, { i: 5, j: 5 }, { i: 5, j: 8 }, bow, { walking }), { tile: { i: 5, j: 5 }, cost: 0 });
  assert.equal(strikeFrom(reach, { i: 5, j: 5 }, { i: 5, j: 10 }, bow, { walking }).cost, 3);
  assert.equal(strikeFrom(reach, { i: 5, j: 5 }, { i: 5, j: 11 }, bow, { walking }), null);
  assert.equal(strikeFrom(reach, { i: 5, j: 5 }, { i: 5, j: 11 }, bow).cost, 3);
});

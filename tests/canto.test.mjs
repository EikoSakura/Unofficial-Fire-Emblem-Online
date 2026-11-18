/**
 * Tests for `module/rules/canto.mjs` and what Step 7 gave the map and the skills: the move a unit makes after
 * its Action, which Actions bring it about, what it has to move with, how enemies curb it, and what the spaces
 * moved that way are worth.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEO } from "../module/config.mjs";
import {
  CANTO_ACTIONS, addCanto, addCurb, cantoGrant, cantoPlus, cantoPlusEntry, checkCanto, checkCurb, curbOf, emptyCanto, follows,
  joinWalks, mergeCrossing, moveAfter
} from "../module/rules/canto.mjs";
import { planExchange, resolveExchange } from "../module/rules/combat.mjs";
import { movementFacts, needsMove } from "../module/rules/movement.mjs";
import { powerEffects } from "../module/rules/optional.mjs";
import { reachFrom, tileKey } from "../module/rules/reach.mjs";
import { checkEffects, skillCanto, skillCrossing, skillTotals } from "../module/rules/skills.mjs";
import { moveCost } from "../module/rules/terrain.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/** What a unit with these skills makes of moving again after an Action. */
const cantoOf = (...names) => skillCanto(names.map((name) => skill(name)));

/** The Actions the system has a unit take. */
const attack = { kind: "attack" };
const staff = { kind: "staff" };
const item = { kind: "item" };
const using = (name) => ({ kind: "skill", name });

/** An enemy so many spaces away, with Constraint or without. */
const foe = (distance, constrains = true) => ({ distance, curbs: constrains ? cantoOf("Constraint").curbs : null });

/** Roll out a fight in which every die comes up as told. */
function fight(initiator, defender, roll) {
  const plan = planExchange(initiator, defender, { distance: 1 });
  return resolveExchange(plan, () => roll);
}

/* -------------------------------------------- */
/*  What Skills Say                             */
/* -------------------------------------------- */

test("the skills of the step are written in parts the rules know", () => {
  for ( const name of ["Canto", "Canto+", "Canto++", "Footwork", "Constraint", "Adieu", "Forager", "Hit and Run"] ) {
    assert.deepEqual(checkEffects(skill(name).effects), [], name);
  }
});

test("a typing mistake in a canto part does not pass silently", () => {
  assert.deepEqual(checkCanto({ after: ["attack"] }), []);
  assert.deepEqual(checkCanto({ after: "any", not: ["attack"] }), []);
  assert.deepEqual(checkCanto({ gear: true }), []);
  assert.deepEqual(checkCanto({ mov: "full", recover: 1 }, { moment: true }), []);
  assert.equal(checkCanto({ after: ["atack"] }).length, 1);
  assert.equal(checkCanto({ after: [] }).length, 1);
  assert.equal(checkCanto({}).length, 1);
  assert.equal(checkCanto({ not: ["attack"], after: ["staff"] }).length, 1);
  assert.equal(checkCanto({ mov: "full" }).length, 1, "a move needs the Actions it follows");
  assert.equal(checkCanto({ after: ["attack"], mov: "half" }).length, 1);
  assert.equal(checkCanto({ after: ["attack"] }, { moment: true }).length, 1, "a moment of a fight names no Actions");
  assert.equal(checkCanto({ crossing: { free: ["lava lake"] } }).length, 1);
  assert.deepEqual(checkCurb({ halve: 3, forbid: 1 }), []);
  assert.equal(checkCurb({ halve: 0 }).length, 1);
  assert.equal(checkCurb({ within: 3 }).length, 1);

  // In an effect: only after a fight, never as an aura, and not on a condition that needs a fight or a place
  const problems = (effect) => checkEffects([effect]).length;
  assert.equal(problems({ proc: { on: "after", stat: "dex" }, canto: { mov: "full" } }), 0);
  assert.equal(problems({ proc: { on: "hit", sure: true }, canto: { mov: "full" } }), 1);
  assert.equal(problems({ aura: { who: "ally", within: 2 }, canto: { after: ["attack"] } }), 1);
  assert.equal(problems({ when: { role: "initiating" }, canto: { after: ["attack"] } }), 1);
  assert.equal(problems({ when: { quality: ["Mounted"] }, canto: { after: ["attack"] } }), 0);
  assert.equal(problems({ proc: { on: "turnStart", sure: true }, curbsCanto: { halve: 3 } }), 1);
});

test("what skills say about moving again is added up", () => {
  const none = skillCanto([skill("Charge")]);
  assert.deepEqual(none, emptyCanto());

  const rider = cantoOf("Canto", "Canto++", "Forager");
  assert.deepEqual(rider.grants.map((grant) => grant.skill), ["Canto"]);
  assert.equal(rider.gear, true);
  assert.deepEqual(rider.crossing.free, ["forest", "thicket", "wardwood"]);
  assert.equal(rider.curbs, null);

  // Canto++ and Forager grant no move themselves
  assert.deepEqual(cantoOf("Canto++", "Forager").grants, []);
  assert.deepEqual(cantoOf("Constraint").curbs, { halve: 3, forbid: 1, skill: "Constraint" });

  // A part may hang on what the unit is, and a lasting change may carry one
  const mounted = made("Saddle", [{ when: { quality: ["Mounted"] }, canto: { after: ["attack"] } }]);
  assert.equal(skillCanto([mounted], { qualities: "Armored" }).grants.length, 0);
  assert.equal(skillCanto([mounted], { qualities: "Mounted" }).grants.length, 1);

  // What a moment of a fight brings about is no leave that is always there
  assert.deepEqual(cantoOf("Hit and Run").grants, []);
});

test("Canto+ is what the rulebook lists for Mounted, Flying and Ballistician units", () => {
  const [effect] = skill("Canto+").effects;
  assert.deepEqual(effect.canto, cantoPlus());
  assert.deepEqual([...effect.canto.after].sort(), [...CANTO_ACTIONS].sort());
  for ( const quality of ["Mounted", "Flying", "Ballistician"] ) assert.equal(FEO.qualitySkills[quality], "Canto+");

  // What gains "the effect of Canto+" without the skill reads the same list
  assert.deepEqual(powerEffects("gallivant"), [{ canto: cantoPlus() }]);
  assert.deepEqual(skillCanto([cantoPlusEntry("Transformed")]).grants[0].after, cantoPlus().after);
});

/* -------------------------------------------- */
/*  Which Actions                               */
/* -------------------------------------------- */

test("Canto follows an attack, Canto+ its longer list, Footwork everything but an attack", () => {
  const [canto] = cantoOf("Canto").grants;
  assert.equal(follows(canto, attack), true);
  assert.equal(follows(canto, staff), false);
  assert.equal(follows(canto, item), false);

  const [plus] = cantoOf("Canto+").grants;
  for ( const kind of ["attack", "staff", "item", "trade", "rescue", "refresh", "shift", "object", "visit", "arrive", "seize"] ) {
    assert.equal(follows(plus, { kind }), true, kind);
  }
  assert.equal(follows(plus, using("Rally")), true);
  assert.equal(follows(plus, using("Hold")), false);
  assert.equal(follows(plus, using("bastion")), false);
  assert.equal(follows(plus, { kind: "other" }), false);

  const [footwork] = cantoOf("Footwork").grants;
  assert.equal(follows(footwork, attack), false);
  assert.equal(follows(footwork, staff), true);
  assert.equal(follows(footwork, using("Hold")), true);
  assert.equal(follows(footwork, { kind: "other" }), true);

  // Waiting ends the turn, whatever the skill
  for ( const grant of [canto, plus, footwork] ) assert.equal(follows(grant, { kind: "wait" }), false);
});

/* -------------------------------------------- */
/*  The Move                                    */
/* -------------------------------------------- */

test("a unit moves again with the movement it has not spent", () => {
  const canto = cantoOf("Canto");
  assert.deepEqual(moveAfter(canto, attack, { mov: 7, spent: 4 }), {
    skill: "Canto", mov: 3, full: false, recover: 0, gear: false, crossing: null, curbed: ""
  });
  assert.equal(moveAfter(canto, attack, { mov: 7, spent: 0 }).mov, 7);

  // Nothing left, nothing to move with: its turn ends with its Action
  assert.equal(moveAfter(canto, attack, { mov: 7, spent: 7 }), null);
  assert.equal(moveAfter(canto, attack, { mov: 7, spent: 9 }), null);

  // Neither does a unit move again that is down or held in place, whose MOV is nothing
  assert.equal(moveAfter(canto, attack, { mov: 0, spent: 0 }), null);

  // Nor after an Action its skill does not list, nor without the skill
  assert.equal(moveAfter(canto, staff, { mov: 7, spent: 2 }), null);
  assert.equal(moveAfter(emptyCanto(), attack, { mov: 7, spent: 2 }), null);
  assert.equal(moveAfter(null, attack, { mov: 7, spent: 2 }), null);
  assert.equal(moveAfter(cantoOf("Canto+"), { kind: "wait" }, { mov: 7, spent: 2 }), null);
  assert.equal(moveAfter(cantoOf("Footwork"), staff, { mov: 5, spent: 2 }).skill, "Footwork");
});

test("Canto++ lets the unit change what it holds on that move, and Forager eases its ground", () => {
  const again = moveAfter(cantoOf("Canto", "Canto++", "Forager"), attack, { mov: 6, spent: 2 });
  assert.equal(again.gear, true);
  assert.deepEqual(again.crossing.free, ["forest", "thicket", "wardwood"]);
  assert.equal(moveAfter(cantoOf("Canto"), attack, { mov: 6, spent: 2 }).gear, false);

  // Without a skill that grants the move, they bring none about
  assert.equal(moveAfter(cantoOf("Canto++", "Forager"), attack, { mov: 6, spent: 2 }), null);
});

test("Constraint halves the movement left of enemies within 3 spaces and forbids the move to those next to it", () => {
  const canto = cantoOf("Canto");
  const left = (foes, spent = 2) => moveAfter(canto, attack, { mov: 7, spent, foes });
  assert.equal(left([foe(4)]).mov, 5);
  assert.equal(left([foe(4)]).curbed, "");
  assert.equal(left([foe(3)]).mov, 2);
  assert.equal(left([foe(3)]).curbed, "Constraint");
  assert.equal(left([foe(2)]).mov, 2);
  assert.equal(left([foe(1)]), null);

  // An enemy without the skill curbs nothing, however near
  assert.equal(left([foe(1, false)]).mov, 5);

  // Several halve it once; one next to the unit forbids it whoever else is near
  assert.equal(left([foe(2), foe(3)]).mov, 2);
  assert.equal(left([foe(3), foe(1)]), null);

  // Half of 1 is nothing to move with
  assert.equal(left([foe(3)], 6), null);
  assert.deepEqual(curbOf([]), { forbidden: false, halved: false, skill: "" });

  // It applies to skills such as Footwork too
  assert.equal(moveAfter(cantoOf("Footwork"), staff, { mov: 6, spent: 0, foes: [foe(3)] }).mov, 3);
  assert.equal(moveAfter(cantoOf("Footwork"), staff, { mov: 6, spent: 0, foes: [foe(1)] }), null);
});

test("the widest reach of each curb counts", () => {
  const total = addCurb(addCurb(emptyCanto(), { halve: 3, forbid: 1 }, { skill: "A" }), { halve: 5 }, { skill: "B" });
  assert.deepEqual(total.curbs, { halve: 5, forbid: 1, skill: "A" });
});

/* -------------------------------------------- */
/*  A Fight That Has Its Unit Move              */
/* -------------------------------------------- */

test("Hit and Run has the unit that started the fight move its full movement once it is over", () => {
  const runner = () => fighter({ name: "A", hp: 60, hpMax: 60, skills: [skill("Hit and Run")], stats: { dex: 20 } });
  const wall = () => fighter({ name: "B", hp: 60, hpMax: 60, stats: { def: 30, str: 0 } });

  // Rolled at DEX/2: a roll that passes brings the move about, one that fails does not
  const lucky = fight(runner(), wall(), 1);
  assert.deepEqual(lucky.moves, [{ skill: "Hit and Run", by: "initiator", canto: { mov: "full", recover: 1 } }]);
  assert.equal(fight(runner(), wall(), 100).moves, undefined);

  // Not for the unit that was attacked, and not for one that did not survive the fight
  assert.equal(fight(wall(), runner(), 1).moves, undefined);
  const slain = fight(fighter({ name: "A", hp: 1, skills: [skill("Hit and Run")], stats: { dex: 20, def: 0 } }),
    fighter({ name: "B", hp: 60, hpMax: 60, stats: { def: 30, str: 30, spd: 30 } }), 1);
  assert.equal(slain.initiator.hp <= 0, true);
  assert.equal(slain.moves, undefined);

  // The move is of its whole MOV, whatever it had spent, with 1 HP for each space
  const grants = lucky.moves.map((move) => cantoGrant(move.skill, move.canto));
  assert.deepEqual(moveAfter(emptyCanto(), attack, { mov: 6, spent: 6, grants }), {
    skill: "Hit and Run", mov: 6, full: true, recover: 1, gear: false, crossing: null, curbed: ""
  });

  // Beside Canto, the move that leaves the most movement is the one made
  assert.equal(moveAfter(cantoOf("Canto"), attack, { mov: 6, spent: 4, grants }).skill, "Hit and Run");
  assert.equal(moveAfter(cantoOf("Canto"), attack, { mov: 6, spent: 0, grants }).recover, 1);

  // An enemy with Constraint curbs it as it does Canto
  assert.equal(moveAfter(emptyCanto(), attack, { mov: 6, spent: 6, grants, foes: [foe(2)] }).mov, 3);
  assert.equal(moveAfter(emptyCanto(), attack, { mov: 6, spent: 6, grants, foes: [foe(1)] }), null);
});

/* -------------------------------------------- */
/*  The Turn's Movement                         */
/* -------------------------------------------- */

test("the second move is added to the first, and counted apart", () => {
  const base = { spaces: 3, cost: 4, passed: ["a"] };
  assert.deepEqual(joinWalks(base, { spaces: 2, cost: 2, passed: ["b", "a"] }), { spaces: 5, cost: 6, passed: ["a", "b"], canto: 2 });

  // Back where it stood as it acted, the turn's movement is what it was
  assert.deepEqual(joinWalks(base, null), { spaces: 3, cost: 4, passed: ["a"], canto: 0 });
  assert.deepEqual(joinWalks(null, { spaces: 2, cost: 3 }), { spaces: 2, cost: 3, passed: [], canto: 2 });

  const facts = movementFacts({ ...joinWalks(base, { spaces: 2, cost: 2 }), mov: 7 });
  assert.equal(facts.spaces, 5);
  assert.equal(facts.left, 1);
  assert.equal(facts.canto, 2);

  // The spaces moved after the Action are never more than the spaces moved
  assert.equal(movementFacts({ spaces: 1, cost: 1, mov: 5, canto: 4 }).canto, 1);
});

test("Adieu gives 2 Dodge for each tile moved using Canto", () => {
  const adieu = skill("Adieu");
  assert.equal(needsMove(adieu.effects[0]), true);
  const dodge = (move) => skillTotals([adieu], { hp: 20, hpMax: 20, stats: {}, move }).combat.dodge ?? 0;
  assert.equal(dodge(movementFacts({ spaces: 5, cost: 5, mov: 7, canto: 3 })), 6);
  assert.equal(dodge(movementFacts({ spaces: 5, cost: 5, mov: 7, canto: 0 })), 0);

  // What it moved before its Action is not counted
  assert.equal(dodge(movementFacts({ spaces: 4, cost: 4, mov: 7 })), 0);

  // Off a battle map movement cannot be judged: the skill is named to check by hand
  const unseen = skillTotals([adieu], { hp: 20, hpMax: 20, stats: {}, move: null });
  assert.equal(unseen.combat.dodge ?? 0, 0);
  assert.deepEqual(unseen.checks.map((entry) => entry.skill), ["Adieu"]);
});

test("Forager crosses Forests, Thickets and Wardwood as open ground on the Canto move alone", () => {
  const forager = skill("Forager");
  const usual = { qualities: "", skills: [], crossing: skillCrossing([forager]) };
  assert.equal(moveCost("forest", usual), 2);
  assert.equal(moveCost("thicket", usual), 3);

  const again = moveAfter(skillCanto([skill("Canto"), forager]), attack, { mov: 6, spent: 3 });
  const moving = { ...usual, crossing: mergeCrossing(usual.crossing, again.crossing) };
  assert.equal(moveCost("forest", moving), 1);
  assert.equal(moveCost("thicket", moving), 1);
  assert.equal(moveCost("wardwood", moving), 1);
  assert.equal(moveCost("hill", moving), moveCost("hill", usual));
  assert.equal(moveCost("mountain", moving), Infinity);

  // What the unit's skills change at all times is kept
  const climber = { cost: { mountain: 3 }, kinds: ["mountain"], free: [], all: false, flier: false, phase: null };
  const both = mergeCrossing(climber, again.crossing);
  assert.deepEqual(both.kinds, ["mountain"]);
  assert.equal(both.cost.mountain, 3);
  assert.equal(mergeCrossing(climber, null), climber);

  // With 3 movement left it gets three Forest tiles deep, where it would otherwise get one
  const woods = (mover) => ({
    inside: (tile) => (tile.i === 0) && (tile.j >= 0) && (tile.j < 6),
    cost: () => moveCost("forest", mover)
  });
  assert.equal(reachFrom({ i: 0, j: 0 }, again.mov, woods(moving)).stops.has(tileKey({ i: 0, j: 3 })), true);
  assert.equal(reachFrom({ i: 0, j: 0 }, again.mov, woods(usual)).stops.has(tileKey({ i: 0, j: 2 })), false);
});

test("the second move counts the enemies moved through before the Action", () => {
  // One enemy a turn may be moved through: a unit that has moved through one already is stopped by the next
  const pass = { ways: [{ limit: 1, extra: 0 }], free: 0, share: false, diagonal: 0, zone: false, hits: [], brushes: [] };
  const row = (passed) => ({
    inside: (tile) => (tile.i === 0) && (tile.j >= 0) && (tile.j < 5),
    cost: () => 1,
    foe: (tile) => tile.j === 1,
    taken: (tile) => tile.j === 1,
    pass,
    passed
  });
  assert.equal(reachFrom({ i: 0, j: 0 }, 3, row(0)).stops.has(tileKey({ i: 0, j: 2 })), true);
  assert.equal(reachFrom({ i: 0, j: 0 }, 3, row(1)).stops.has(tileKey({ i: 0, j: 2 })), false);
});

test("a part that only bends the move adds to whatever grants it", () => {
  const total = addCanto(addCanto(emptyCanto(), { after: ["attack"] }, { skill: "A" }), { gear: true }, { skill: "B" });
  assert.equal(total.grants.length, 1);
  assert.equal(total.gear, true);
  assert.equal(follows(cantoGrant("Moment", { mov: "full" }), { kind: "other" }), true, "a grant without Actions follows whatever brought it about");
});

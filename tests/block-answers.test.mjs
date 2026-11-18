/**
 * Tests for the skills that answer a block or wear gear down, in a fight the system rolls
 * (`module/rules/combat.mjs`): an attack made at once with numbers of its own, an attack that is cancelled, the
 * moments of a block that failed and of what a hit comes to in the end, a tally kept on the unit
 * (`module/rules/timed.mjs`), uses taken off a foe's weapon and Shield, and the action that does the same
 * (`module/rules/actions.mjs`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { actReaches, actWears, checkAct, wornDown } from "../module/rules/actions.mjs";
import { readShield, shieldAmount, shieldsBarred } from "../module/rules/blocking.mjs";
import { planExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { checkEffects, readNumber } from "../module/rules/skills.mjs";
import { buildChange, cleanChange, grantChange, spendOnce, timedEntries } from "../module/rules/timed.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

const ROUND = "Has a 40 + DEX/2% chance to block physical attacks, reducing them by 4. Adds 1 Weight during Attack Speed calculation. 30 Uses.";
const BUCKLER = "Has a 25 + DEX/2% chance to block physical attacks, reducing them by 20%, and a 10 + DEX/2% chance to instead parry a melee attack, completely negating it but consuming 2 uses. Adds 1 Weight during Attack Speed calculation. 30 Uses.";
const TOWER = "Has a 40 + DEX/2% chance to block physical attacks, reducing them by 30. Adds 1 Weight during Attack Speed calculation. 30 Uses.";

/** A Shield as a unit has it equipped, read from the words of the Items tab. */
function shield(name = "Round Shield", effect = ROUND, uses = 30, left = uses) {
  return { id: name.toLowerCase().replace(/[^a-z]+/g, "-"), name, ...readShield(effect), uses: { value: left, max: uses } };
}

/** Roll out a fight with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  let rolled = 0;
  const result = resolveExchange(plan, () => {
    rolled += 1;
    return rolls[rolled - 1] ?? rest;
  });
  assert.ok(rolled <= rollBudget(plan), `rolled ${rolled} of ${rollBudget(plan)}`);
  return { plan, result, rolled };
}

/** The changes a fight granted one of its two units, as that unit carries them afterwards. */
function carried(result, key, list = []) {
  let now = [...list];
  for ( const entry of result.granted ?? [] ) if ( entry.to === key ) now = grantChange(now, entry.change).list;
  return now;
}

/** A foe that never answers, so that a fight is the attacks of the unit that starts it. */
const quiet = (options = {}) => fighter({ name: "B", hp: 40, hpMax: 40, weapon: null, ...options });

/* -------------------------------------------- */
/*  An Attack with Numbers of Its Own           */
/* -------------------------------------------- */

test("Shield Bash: a block is answered at once with 70 Hit and the Shield's Might, before the counter-attack", () => {
  const basher = fighter({ name: "B", hp: 40, hpMax: 40, shield: shield(), skills: [skill("Shield Bash")] });
  const { result } = fight(fighter({ name: "A", hp: 40, hpMax: 40 }), basher, [1, 100, 1, 1, 100, 1, 100]);
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "defender", "defender"]);
  const bash = result.attacks[1];
  assert.equal(result.attacks[0].block.success, true);
  assert.equal(bash.added, true);
  assert.equal(bash.skill, "Shield Bash");
  assert.deepEqual(bash.own, { hit: 70, might: 4 });

  // DEX x2 + LUK + 70 against a Dodge of 21; STR 10 + 4 against a DEF of 6
  assert.equal(bash.hitChance, 70);
  assert.equal(bash.damage, 8);
  assert.equal(bash.useSpent, false);
  assert.equal(bash.wexp, 0);

  // The block cost the Shield its use, the bash none; the weapon paid for the counter-attack alone
  assert.deepEqual(result.defender.shield, { usesStart: 30, uses: 29, spent: 1, broke: false });
  assert.equal(result.defender.usesSpent, 1);
  assert.equal(result.attacks[2].added, undefined);
});

test("Shield Bash: no block, no bash; and it needs a Shield in hand", () => {
  const basher = fighter({ name: "B", shield: shield(), skills: [skill("Shield Bash")] });
  const { result } = fight(fighter({ name: "A" }), basher, [1, 100, 100, 1, 100]);
  assert.equal(result.attacks.length, 2);
  assert.equal(result.attacks.some((attack) => attack.added), false);
  assert.equal(planExchange(fighter({ name: "A" }), fighter({ name: "B", skills: [skill("Shield Bash")] })).defender.chances.block.length, 0);
});

test("Shield Bash: made by a unit whose weapon cannot answer, and by one without a weapon; only from next to the foe", () => {
  const archer = fighter({ name: "B", shield: shield(), skills: [skill("Shield Bash")], weapon: { category: "bow", range: "2", name: "Iron Bow" } });
  const near = fight(fighter({ name: "A" }), archer, [1, 100, 1, 1, 100]);
  assert.ok(near.plan.defender.blocked);
  assert.deepEqual(near.result.attacks.map((attack) => attack.side), ["initiator", "defender"]);
  assert.equal(near.result.attacks[1].damage, 8);
  assert.equal(near.result.defender.usesSpent, 0);

  const bare = fight(fighter({ name: "A" }), quiet({ shield: shield(), skills: [skill("Shield Bash")] }), [1, 100, 1, 1, 100]);
  assert.equal(bare.result.attacks[1].own.might, 4);

  const far = fight(fighter({ name: "A", weapon: { range: "1-2" } }), fighter({ name: "B", shield: shield(), skills: [skill("Shield Bash")] }), [1, 100, 1], { distance: 2 });
  assert.equal(far.result.attacks.length, 1);

  // Where it cannot be made its skill stays quiet: it is not told of as having taken effect
  assert.equal((far.result.attacks[0].procs ?? []).some((proc) => proc.skill === "Shield Bash"), false);
  assert.equal(near.result.attacks[0].procs.some((proc) => (proc.skill === "Shield Bash") && proc.success), true);
});

test("Shield Bash: a unit that is kept from attacking does not bash, and a bash sets off no other", () => {
  const held = fighter({ name: "B", shield: shield(), skills: [skill("Shield Bash"), made("Pacifist", [{ rules: ["noCounter"] }])] });
  assert.equal(fight(fighter({ name: "A" }), held, [1, 100, 1]).result.attacks.length, 1);

  // Both bash: the one made in answer to a block is blocked in turn, and answered by nothing
  const a = fighter({ name: "A", hp: 40, hpMax: 40, shield: shield(), skills: [skill("Shield Bash")] });
  const b = quiet({ shield: shield(), skills: [skill("Shield Bash")] });
  const { result } = fight(a, b, [1, 100, 1, 1, 100, 1]);
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "defender"]);
  assert.equal(result.attacks[1].block.success, true);
  assert.equal(result.attacks[1].damage, 4);
  assert.equal(result.initiator.shield.spent, 1);
});

test("the Might of a bash is what the Shield takes off a physical attack, with what skills add to it", () => {
  assert.equal(shieldAmount(shield()), 4);
  assert.equal(shieldAmount(shield("Buckler", BUCKLER)), 0);
  assert.equal(shieldAmount(null), 0);
  assert.equal(shieldAmount(shield(), { amount: [{ name: "Shield Affinity", amount: 1, kind: "shield" }, { name: "Guard", amount: 2, kind: "weapon" }] }), 5);
  assert.equal(readNumber({ of: "shieldBlock" }, { shieldBlock: 4 }), 4);
});

/* -------------------------------------------- */
/*  An Attack That Is Cancelled                 */
/* -------------------------------------------- */

test("Wappenschild: a block cancels the enemy's next attack, and its next counter-attack after the fight", () => {
  const knecht = fighter({ name: "B", hp: 40, hpMax: 40, shield: shield(), skills: [skill("Wappenschild")] });
  const fast = fighter({ name: "A", hp: 40, hpMax: 40, stats: { spd: 20 } });
  const { plan, result } = fight(fast, knecht, [1, 100, 1, 1, 1, 100]);
  assert.equal(plan.initiator.attacks, 2);

  // DEX 8 x 1.5 = 12%
  assert.equal(plan.defender.chances.block[0].chance, 12);
  assert.deepEqual(result.attacks.map((attack) => attack.side), ["initiator", "defender"]);
  assert.deepEqual(result.cancelled, [{ side: "initiator", skill: "Wappenschild", by: "defender" }]);
  assert.equal(result.initiator.usesSpent, 1);

  const left = carried(result, "initiator");
  assert.equal(left.length, 1);
  assert.equal(left[0].once, "defend");
  assert.equal(left[0].from, "B");
  assert.deepEqual(left[0].effects, [{ rules: ["noCounter"] }]);
});

test("Wappenschild: nothing to cancel where the enemy has no attack left, and nothing without the block", () => {
  const knecht = fighter({ name: "B", hp: 40, hpMax: 40, shield: shield(), skills: [skill("Wappenschild")] });
  const once = fight(fighter({ name: "A" }), knecht, [1, 100, 1, 1, 1, 100]);
  assert.equal(once.result.cancelled, undefined);
  assert.equal(carried(once.result, "initiator").length, 1);
  const missed = fight(fighter({ name: "A", stats: { spd: 20 } }), knecht, [1, 100, 1, 99]);
  assert.equal(missed.result.cancelled, undefined);
  assert.equal(missed.result.granted, undefined);
});

test("a counter-attack a skill takes is told apart from one the unit could not have made", () => {
  const cursed = (weapon = {}) => ({
    ...fighter({ name: "B", weapon }),
    timed: [{ name: "Wappenschild", from: "K", effects: [{ rules: ["noCounter"] }], ends: "map", turns: 0, clock: "", stacks: 1, max: 0, fades: false, once: "defend" }]
  });
  const near = planExchange(fighter({ name: "A" }), cursed());
  assert.equal(near.defender.blocked, "skill");
  assert.equal(near.defender.denied, true);
  const far = planExchange(fighter({ name: "A", weapon: { category: "bow", range: "2" } }), cursed(), { distance: 2 });
  assert.equal(far.defender.blocked, "skill");
  assert.equal(far.defender.denied, undefined);
  assert.equal(planExchange(fighter({ name: "A" }), fighter({ name: "B" })).defender.denied, undefined);
});

test("a change that a fight uses up: by defending, by attacking, by either", () => {
  const change = (once) => ({ name: once, from: "", effects: [], ends: "map", turns: 0, stacks: 1, max: 0, fades: false, once });
  const list = [change("defend"), change("attack"), change("fight"), { ...change(""), name: "plain" }];
  assert.deepEqual(spendOnce(list, "defend").list.map((entry) => entry.name), ["attack", "plain"]);
  assert.deepEqual(spendOnce(list, "attack").list.map((entry) => entry.name), ["defend", "plain"]);
  assert.deepEqual(spendOnce(list, "fight").list.map((entry) => entry.name), ["defend", "attack", "plain"]);
  assert.equal(spendOnce(list, null).changed, false);
  assert.equal(buildChange({ effects: [{ rules: ["noCounter"] }], ends: "map", once: "defend" }, { skill: "W" }).once, "defend");
  assert.equal(buildChange({ effects: [], ends: "map", once: "never" }, { skill: "W" }).once, undefined);
  assert.equal(cleanChange({ ...change("defend"), clock: "" }, () => []).once, "defend");
  assert.equal(cleanChange({ ...change("sometime"), clock: "" }, () => []), null);
});

/* -------------------------------------------- */
/*  A Block, and a Block That Failed            */
/* -------------------------------------------- */

test("Phalanx: a Shield takes off twice as much", () => {
  const armored = quiet({ shield: shield(), skills: [skill("Phalanx")] });
  const doubled = fight(fighter({ name: "A" }), armored, [1, 100, 1, 1]);
  assert.equal(doubled.result.attacks[0].block.amount, 8);
  assert.equal(doubled.result.attacks[0].damage, 1);
  const plain = fight(fighter({ name: "A" }), armored, [1, 100, 1, 99]);
  assert.equal(plain.result.attacks[0].block.amount, 4);
});

test("Rencounter: a block is +1 ATK until the end of the unit's next turn, as a dodge is", () => {
  const knight = quiet({ shield: shield(), skills: [skill("Rencounter")] });
  const { result } = fight(fighter({ name: "A", stats: { spd: 20 } }), knight, [1, 100, 1, 1, 100, 1]);
  const left = carried(result, "defender");
  assert.equal(left.length, 1);
  assert.equal(left[0].name, "Rencounter (ATK)");
  assert.equal(left[0].stacks, 2);
  assert.deepEqual(timedEntries(left)[0].effects, [{ combat: { damage: 1 }, scale: 2 }]);
});

test("Unerring: +1 DEF and RES for a block with a Shield, 1 less for a roll that fails", () => {
  const spartan = quiet({ shield: shield(), skills: [skill("Unerring")] });
  const fast = fighter({ name: "A", stats: { spd: 20 } });

  // Two blocks
  const both = fight(fast, spartan, [1, 100, 1, 1, 100, 1]);
  const two = carried(both.result, "defender");
  assert.equal(two[0].stacks, 2);
  assert.equal(two[0].ends, "map");
  assert.deepEqual(timedEntries(two)[0].effects, [{ stats: { def: 1, res: 1 }, scale: 2 }]);

  // A block, then a failure: back to nothing
  const mixed = fight(fast, spartan, [1, 100, 1, 1, 100, 99]);
  assert.equal(mixed.result.granted.length, 2);
  assert.equal(mixed.result.granted[1].change.drop, 1);
  assert.deepEqual(carried(mixed.result, "defender"), []);

  // Two failures on top of a tally of 3 leave 1; on top of nothing, nothing
  const failed = fight(fast, spartan, [1, 100, 99, 1, 100, 99]);
  assert.equal(carried(failed.result, "defender", [{ ...two[0], stacks: 3 }])[0].stacks, 1);
  assert.deepEqual(carried(failed.result, "defender"), []);

  // And it is held at +10
  assert.equal(carried(both.result, "defender", [{ ...two[0], stacks: 9 }])[0].stacks, 10);
});

test("Unerring: a hit its Shield cannot block, and a block the foe negates, change nothing", () => {
  const spartan = quiet({ shield: shield(), skills: [skill("Unerring")] });
  const mage = fighter({ name: "A", weapon: { category: "fire", damageStat: "mag", name: "Fire", range: "1-2" } });
  assert.equal(fight(mage, spartan, [1, 100]).result.granted, undefined);

  // Blockbreaker: LUK% to negate a Shield's block
  const breaker = fighter({ name: "A", skills: [skill("Blockbreaker")] });
  const { result } = fight(breaker, spartan, [1, 100, 1, 1]);
  assert.equal(result.attacks[0].block.negated, "Blockbreaker");
  assert.equal(result.granted, undefined);
});

test("a tally drops by what a skill takes from it, never below nothing", () => {
  const tally = buildChange({ to: "self", effects: [{ stats: { def: 1 } }], ends: "map", max: 10 }, { skill: "Unerring", own: true });
  const drop = buildChange({ to: "self", drop: 1 }, { skill: "Unerring", own: true });
  assert.equal(drop.drop, 1);
  assert.equal(drop.name, "Unerring");
  let list = grantChange(grantChange(grantChange([], tally).list, tally).list, tally).list;
  assert.equal(list[0].stacks, 3);
  list = grantChange(list, drop).list;
  assert.equal(list[0].stacks, 2);
  assert.deepEqual(grantChange(list, buildChange({ to: "self", drop: "all" }, { skill: "Unerring", own: true })).list, []);
  assert.deepEqual(grantChange([], drop), { list: [], change: null, renewed: false });
  assert.equal(cleanChange(drop, () => []).drop, 1);
  assert.equal(cleanChange({ ...drop, drop: 0 }, () => []), null);

  // Only the tally of that name, from that unit
  const other = { ...tally, name: "Runemail" };
  assert.deepEqual(grantChange([other], drop).list, [other]);
});

/* -------------------------------------------- */
/*  What a Hit Comes to                         */
/* -------------------------------------------- */

test("Transpierce: a hit that is blocked deals DEX/4 more and leaves -3 DEF", () => {
  const marksman = fighter({ name: "A", stats: { dex: 12 }, skills: [skill("Transpierce")], weapon: { category: "bow", range: "2", name: "Iron Bow" } });
  const { result } = fight(marksman, quiet({ shield: shield() }), [1, 100, 1], { distance: 2 });
  const attack = result.attacks[0];
  assert.equal(attack.damage, 5);
  assert.deepEqual(attack.harm, [{ skill: "Transpierce", by: "initiator", to: "defender", amount: 3 }]);
  assert.equal(result.defender.hp, 40 - 5 - 3);
  const left = carried(result, "defender");
  assert.deepEqual(left[0].effects, [{ stats: { def: -3 } }]);
  assert.equal(left[0].from, "A");
});

test("Transpierce: a hit that a block stops deals DEX/3 and leaves -6 DEF instead", () => {
  const marksman = fighter({ name: "A", stats: { dex: 12 }, skills: [skill("Transpierce")], weapon: { category: "bow", range: "2", name: "Iron Bow" } });
  const { result } = fight(marksman, quiet({ shield: shield("Tower Shield", TOWER) }), [1, 100, 1], { distance: 2 });
  assert.equal(result.attacks[0].damage, 0);
  assert.equal(result.attacks[0].harm[0].amount, 4);
  assert.deepEqual(carried(result, "defender")[0].effects, [{ stats: { def: -6 } }]);
  assert.equal(result.granted.length, 1);
});

test("Transpierce: a skill of the target, or half the damage gone to DEF, set it off too; a clean hit does not", () => {
  const marksman = (weapon = {}) => fighter({ name: "A", stats: { dex: 12 }, skills: [skill("Transpierce")], weapon: { category: "bow", range: "2", name: "Iron Bow", ...weapon } });
  const at = (foe, rolls = [1, 100]) => fight(marksman(), foe, rolls, { distance: 2 }).result;

  // Nothing curbs it: STR 10 + 5 against DEF 6
  const clean = at(quiet());
  assert.equal(clean.attacks[0].harm, undefined);
  assert.equal(clean.granted, undefined);

  // A skill that takes effect on that hit
  const warded = at(quiet({ skills: [made("Ward", [{ proc: { on: "struck", sure: true }, reduce: 3 }])] }));
  assert.equal(warded.attacks[0].damage, 6);
  assert.equal(warded.attacks[0].harm[0].amount, 3);
  assert.deepEqual(carried(warded, "defender")[0].effects, [{ stats: { def: -3 } }]);

  // One that takes all of it: stopped
  const walled = at(quiet({ skills: [made("Wall", [{ proc: { on: "struck", sure: true }, reduce: 99 }])] }));
  assert.equal(walled.attacks[0].harm[0].amount, 4);
  assert.deepEqual(carried(walled, "defender")[0].effects, [{ stats: { def: -6 } }]);

  // One that is always there
  const tough = at(quiet({ skills: [made("Tough", [{ endurance: 2 }])] }));
  assert.equal(tough.attacks[0].harm[0].amount, 3);

  // DEF that leaves half or less: 15 against 8, and against 20, where no block or skill is to thank
  const sturdy = at(quiet({ stats: { def: 8 } }));
  assert.equal(sturdy.attacks[0].damage, 7);
  assert.equal(sturdy.attacks[0].harm[0].amount, 3);
  const stone = at(quiet({ stats: { def: 20 } }));
  assert.equal(stone.attacks[0].damage, 0);
  assert.equal(stone.attacks[0].harm[0].amount, 3);
  assert.deepEqual(carried(stone, "defender")[0].effects, [{ stats: { def: -3 } }]);

  // A miss is no hit, and a tome is no physical attack
  assert.equal(at(quiet({ shield: shield() }), [100]).attacks[0].harm, undefined);
  const tome = fight(fighter({ name: "A", skills: [skill("Transpierce")], weapon: { category: "fire", damageStat: "mag", range: "1-2" } }), quiet({ stats: { res: 20 } }), [1, 100]);
  assert.equal(tome.result.attacks[0].harm, undefined);
});

test("Transpierce: its damage can defeat the target, which its unit then has defeated", () => {
  const marksman = fighter({ name: "A", stats: { dex: 12 }, skills: [skill("Transpierce")], weapon: { category: "bow", range: "2" } });
  const { result } = fight(marksman, quiet({ hp: 7, shield: shield() }), [1, 100, 1], { distance: 2 });
  assert.equal(result.defender.hp, 0);
  assert.equal(result.defender.defeated, true);
  assert.deepEqual(result.slain, [{ by: "initiator" }]);
  assert.equal(result.granted, undefined);
});

test("Scale Shield: what STR takes off beyond the damage is dealt to the attacker", () => {
  const dragon = quiet({ stats: { str: 10 }, skills: [skill("Scale Shield")] });
  const mage = fighter({ name: "A", weapon: { category: "fire", damageStat: "mag", name: "Fire", range: "1-2" } });

  // MAG 4 + 5 against RES 3 is 6; STR/2 = 5% to take 10 off
  const { result } = fight(mage, dragon, [1, 100, 1]);
  assert.equal(result.attacks[0].damage, 0);
  assert.equal(result.attacks[0].reflected, 4);
  assert.equal(result.initiator.hp, 16);

  // A hit it only lessens gives nothing back
  const strong = fight({ ...mage, stats: { ...mage.stats, mag: 14 }, bare: { ...mage.bare, stats: { ...mage.bare.stats, mag: 14 } } }, dragon, [1, 100, 1]);
  assert.equal(strong.result.attacks[0].damage, 6);
  assert.equal(strong.result.attacks[0].reflected, undefined);
});

test("Shieldstrike: each point of damage below zero is +1 Hit, Dodge and Critical until the fight ends", () => {
  const skogul = fighter({ name: "B", hp: 40, hpMax: 40, skills: [skill("Shieldstrike")] });
  const plain = fight(fighter({ name: "A", hp: 40, hpMax: 40, stats: { spd: 20 } }), skogul, [1, 100, 99, 1, 100, 1, 100]);
  const struck = fight(fighter({ name: "A", hp: 40, hpMax: 40, stats: { spd: 20 } }), skogul, [1, 100, 1, 1, 100, 1, 100]);

  // 9 damage less 20: 11 below zero
  assert.equal(struck.result.attacks[0].damage, 0);
  const [, counter, again] = struck.result.attacks;
  const [, before, later] = plain.result.attacks;
  assert.equal(counter.hitChance, Math.min(before.hitChance + 11, 100));
  assert.equal(counter.critChance, before.critChance + 11);
  assert.equal(again.hitChance, later.hitChance - 11);
});

test("Runemail: +1 MAG for a hit, and 1 more for one that dealt no damage", () => {
  const knight = (options = {}) => quiet({ skills: [skill("Runemail")], ...options });
  const hurt = fight(fighter({ name: "A" }), knight(), [1, 100]);
  assert.equal(carried(hurt.result, "defender")[0].stacks, 1);
  const unhurt = fight(fighter({ name: "A" }), knight({ stats: { def: 30 } }), [1, 100]);
  assert.equal(unhurt.result.attacks[0].damage, 0);
  const left = carried(unhurt.result, "defender");
  assert.equal(left[0].stacks, 2);
  assert.deepEqual(timedEntries(left)[0].effects, [{ stats: { mag: 1 }, scale: 2 }]);
  assert.equal(carried(unhurt.result, "defender", [{ ...left[0], stacks: 7 }])[0].stacks, 8);
  assert.equal(fight(fighter({ name: "A" }), knight(), [100]).result.granted, undefined);
});

/* -------------------------------------------- */
/*  Wearing Gear Down                           */
/* -------------------------------------------- */

test("Corrosion: the foe's weapon and Shield lose uses equal to the unit's level, and the fight says so", () => {
  const acid = fighter({ name: "A", level: 7, skills: [skill("Corrosion")] });
  const { result } = fight(acid, fighter({ name: "B", hp: 40, hpMax: 40, shield: shield() }), [1, 1, 100, 99, 100]);
  assert.deepEqual(result.worn, [{ skill: "Corrosion", by: "initiator", to: "defender", weapon: 7, shield: 7 }]);
  assert.equal(result.defender.uses, 33);
  assert.deepEqual(result.defender.shield, { usesStart: 30, uses: 23, spent: 7, broke: false });

  // Not for an attack that misses, nor for a chance that does not come
  assert.equal(fight(acid, fighter({ name: "B", shield: shield() }), [1, 100]).result.worn, undefined);
  assert.equal(fight(acid, fighter({ name: "B", shield: shield() }), [99, 1, 100, 99]).result.worn, undefined);
});

test("Corrosion: gear brought to 0 uses breaks, and a weapon that breaks attacks no more", () => {
  const acid = fighter({ name: "A", level: 7, skills: [skill("Corrosion")] });
  const worn = fighter({ name: "B", hp: 40, hpMax: 40, shield: shield("Round Shield", ROUND, 30, 3), weapon: { uses: { value: 5, max: 40 } } });
  const { result } = fight(acid, worn, [1, 1, 100, 99]);
  assert.deepEqual(result.worn, [{ skill: "Corrosion", by: "initiator", to: "defender", weapon: 5, shield: 3 }]);
  assert.equal(result.defender.broke, true);
  assert.equal(result.defender.shield.broke, true);
  assert.equal(result.attacks.length, 1);
});

test("Batter: the foe's Shield loses the tens place of ATK", () => {
  const brawler = fighter({ name: "A", stats: { str: 21 }, skills: [skill("Batter")] });
  const plan = planExchange(brawler, quiet({ shield: shield() }));
  assert.equal(plan.initiator.chances.attack[0].chance, 21);
  assert.deepEqual(plan.initiator.chances.attack[0].wears, { weapon: 0, shield: 2, after: false });
  const { result } = fight(brawler, quiet({ shield: shield() }), [1, 1, 100, 99]);
  assert.deepEqual(result.worn, [{ skill: "Batter", by: "initiator", to: "defender", weapon: 0, shield: 2 }]);
  assert.equal(result.defender.shield.uses, 28);

  // A foe without a Shield loses nothing
  assert.equal(fight(brawler, quiet(), [1, 1, 100]).result.worn, undefined);
});

/* -------------------------------------------- */
/*  The Action                                  */
/* -------------------------------------------- */

test("Batter as an action: an enemy the weapon in hand could attack, its Shield worn down, no Shield for 2 turns", () => {
  const act = skill("Batter").effects.find((effect) => effect.act).act;
  assert.deepEqual(checkAct(act), []);
  const armed = (distance) => distance <= 2;
  assert.equal(actReaches(act, "foe", 2, armed), true);
  assert.equal(actReaches(act, "foe", 3, armed), false);
  assert.equal(actReaches(act, "friend", 1, armed), false);
  assert.equal(actReaches(act, "foe", 1), false);

  const view = { combat: { damage: 37 }, stats: {} };
  assert.deepEqual(actWears(act.wears, (value) => readNumber(value, view)), { weapon: 0, shield: 3 });
  assert.deepEqual(wornDown({ value: 30, max: 30 }, 3), { uses: 27, lost: 3, broke: false });
  assert.deepEqual(wornDown({ value: 2, max: 30 }, 3), { uses: 0, lost: 2, broke: true });
  assert.deepEqual(wornDown({ value: 0, max: 0 }, 3), { uses: 0, lost: 0, broke: false });

  const change = buildChange({ ...act.grant, name: "Batter" }, { skill: "Batter", from: "A" });
  assert.equal(change.turns, 2);
  assert.equal(change.ends, "turnEnd");
  assert.equal(shieldsBarred([change]), true);
  assert.equal(shieldsBarred([{ ...change, effects: [{ stats: { def: -1 } }] }]), false);
  assert.equal(shieldsBarred([]), false);
});

test("an action skill says what it wears and what it leaves, and nothing else", () => {
  const target = { who: "enemy", within: "weapon" };
  assert.deepEqual(checkAct({ target, wears: { shield: 2 } }), []);
  assert.deepEqual(checkAct({ target, grant: { effects: [{ rules: ["noShield"] }], ends: "turnEnd" } }), []);
  assert.ok(checkAct({ target }).length);
  assert.ok(checkAct({ target, wears: { helm: 2 } }).length);
  assert.ok(checkAct({ target, wears: { shield: "lots" } }).length);
  assert.ok(checkAct({ target, grant: { effects: [] } }).length);
  assert.ok(checkAct({ target: { ...target, clear: true }, wears: { shield: 1 } }).length);
});

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

test("the effects of the step's skills are in order", () => {
  for ( const name of ["Shield Bash", "Wappenschild", "Phalanx", "Unerring", "Rencounter", "Transpierce", "Batter", "Corrosion", "Scale Shield", "Shieldstrike", "Runemail"] ) {
    assert.deepEqual(checkEffects(skill(name).effects), [], name);
  }
});

test("a typing mistake in the new parts does not pass", () => {
  const wrong = (effect) => assert.ok(checkEffects([effect]).length, JSON.stringify(effect));
  wrong({ proc: { on: "hit", sure: true }, attack: { hit: 70, might: 4 } });
  wrong({ proc: { on: "block", sure: true }, attack: { hit: 70 } });
  wrong({ proc: { on: "block", sure: true }, attack: { hit: 70, might: 4, crit: 5 } });
  wrong({ proc: { on: "blocked", sure: true }, cancels: 1 });
  wrong({ proc: { on: "block", sure: true }, cancels: 0 });
  wrong({ proc: { on: "struck", sure: true }, excess: { retaliate: true } });
  wrong({ proc: { on: "struck", sure: true }, reduce: 5, excess: { combat: ["luck"] } });
  wrong({ proc: { on: "hit", sure: true, stopped: true }, remind: true });
  wrong({ proc: { on: "curbed", sure: true, by: ["luck"] }, remind: true });
  wrong({ proc: { on: "block", sure: true }, grant: { to: "self", drop: 0 } });
  wrong({ proc: { on: "block", sure: true }, grant: { to: "self", drop: 1, effects: [] } });
  wrong({ proc: { on: "block", sure: true }, grant: { to: "foe", effects: [{ rules: ["noCounter"] }], ends: "map", once: "ever" } });
  assert.deepEqual(checkEffects([{ proc: { on: "curbed", sure: true, by: ["block", "skill"], stopped: true }, retaliate: 2 }]), []);
  assert.deepEqual(checkEffects([{ proc: { on: "blockFail", stat: "luk", by: "shield" }, next: { hit: 10 } }]), []);
  assert.deepEqual(checkEffects([{ proc: { on: "unhurt", sure: true }, retaliate: 1 }]), []);
  assert.deepEqual(checkEffects([{ proc: { on: "dodged", sure: true }, attack: { hit: 80, might: { of: "str" }, range: 2 } }]), []);
});

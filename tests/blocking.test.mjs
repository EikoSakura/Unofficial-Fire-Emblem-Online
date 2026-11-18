/**
 * Tests for `module/rules/blocking.mjs` and for what a block is in a fight the system rolls
 * (`module/rules/combat.mjs`): reading a Shield from its Effect, the Block chance and its sum, the block itself
 * with the use it costs, Weapon Guard, and the skills that raise, lower or reshape all of it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { blockRule, blocksMagic, checkBlock, guardOf, lessen, readShield, weaponBlocking } from "../module/rules/blocking.mjs";
import { planExchange, resolveExchange, rollBudget } from "../module/rules/combat.mjs";
import { checkEffects } from "../module/rules/skills.mjs";
import { fighter, made, skill } from "./lib/fixtures.mjs";

/** A Shield as a unit has it equipped, read from the words of the Items tab. */
function shield(name, effect, uses = 30, left = uses) {
  return { id: name.toLowerCase().replace(/[^a-z]+/g, "-"), name, ...readShield(effect), uses: { value: left, max: uses } };
}

const ROUND = "Has a 40 + DEX/2% chance to block physical attacks, reducing them by 4. Adds 1 Weight during Attack Speed calculation. 30 Uses.";
const ENCHANTED = "Has a 35 + DEX/2% chance to block attacks. Reduces physical attacks by 1, reduces magical attacks by 4. Loses 2 uses when blocking physical attacks. Adds 1 Weight during Attack Speed calculation. 25 Uses.";
const BUCKLER = "Has a 25 + DEX/2% chance to block physical attacks, reducing them by 20%, and a 10 + DEX/2% chance to instead parry a melee attack, completely negating it but consuming 2 uses. Adds 1 Weight during Attack Speed calculation. 30 Uses.";

/** Roll out a fight with dice that come up as told, then always as `rest`. */
function fight(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  let rolled = 0;
  const result = resolveExchange(plan, () => rolls[rolled++] ?? rest);
  assert.ok(rolled <= rollBudget(plan), `rolled ${rolled} of ${rollBudget(plan)}`);

  return { plan, result, rolled };
}

/** A foe that never answers, so that a fight is the attacks of the unit that starts it. */
const target = (options = {}) => fighter({ name: "B", hp: 40, hpMax: 40, weapon: null, ...options });

/* -------------------------------------------- */
/*  Reading a Shield                            */
/* -------------------------------------------- */

test("a Shield is read from its Effect: chance, DEX, amount, Weight", () => {
  assert.deepEqual(readShield(ROUND), {
    chance: 40, dexDiv: 2, blocks: [{ kind: "physical", reduce: 4 }], weight: 1, wearPhysical: 1, parry: null
  });
  assert.equal(readShield("Restores 10 HP."), null);
});

test("a Broken Shield has a plain chance, and Jaivardhan brings a hit down to 1", () => {
  const broken = readShield("Has a 15% chance to block physical attacks, reducing them by 1. Adds 5 Weight during Attack Speed calculation.");
  assert.equal(broken.dexDiv, 0);
  assert.equal(broken.weight, 5);
  const best = readShield("Has a 60 + DEX/2% chance to block physical attacks, reducing them to 1 damage. Adds 5 Weight during Attack Speed calculation. 50 Uses.");
  assert.deepEqual(best.blocks, [{ kind: "physical", to: 1 }]);
  assert.equal(lessen(30, best.blocks[0]), 1);
});

test("a Shield for physical and magical attacks, which wears faster on physical ones", () => {
  const read = readShield(ENCHANTED);
  assert.deepEqual(read.blocks, [{ kind: "physical", reduce: 1 }, { kind: "magical", reduce: 4 }]);
  assert.equal(read.wearPhysical, 2);
  assert.equal(blocksMagic(read), true);
  assert.equal(blocksMagic(readShield(ROUND)), false);
});

test("a share of the damage, and a chance to parry", () => {
  const read = readShield(BUCKLER);
  assert.deepEqual(read.blocks, [{ kind: "physical", percent: 20 }]);
  assert.deepEqual(read.parry, { chance: 10, dexDiv: 2, uses: 2 });
  assert.equal(lessen(14, read.blocks[0]), 12);
});

test("melee and ranged, elements, and who attacks: the rule that takes the most is used", () => {
  const aegis = readShield("Has a 45 + DEX/2% chance to block physical attacks. Reduces melee attacks by 5, reduces ranged attacks by 10. Adds 4 Weight during Attack Speed calculation. 30 Uses.");
  assert.equal(blockRule(aegis.blocks, { physical: true, distance: 1 }).reduce, 5);
  assert.equal(blockRule(aegis.blocks, { physical: true, distance: 2 }).reduce, 10);
  assert.equal(blockRule(aegis.blocks, { physical: false, distance: 2 }), null);

  const fire = readShield("Has a 45 + DEX/2 chance to block attacks. Reduces physical and magical attacks by 3, reduces Fire attacks by 10. Loses 2 uses when blocking physical attacks. Adds 2 Weight during Attack speed calculation. 25 Uses.");
  assert.equal(blockRule(fire.blocks, { physical: false, element: "fire" }).reduce, 10);
  assert.equal(blockRule(fire.blocks, { physical: false, element: "wind" }).reduce, 3);

  const wyrm = readShield("Has a 55 + DEX/2% chance to block physical and non-Thunder magical attacks, reducing them by 10. Adds 2 Weight during Attack Speed calculation. 50 Uses.");
  assert.equal(blockRule(wyrm.blocks, { physical: false, element: "thunder" }), null);
  assert.equal(blockRule(wyrm.blocks, { physical: false, element: "fire" }).reduce, 10);

  const sacred = readShield("Has a 50 + DEX/2% chance to block attacks. Reduces physical attacks by 4, reduces physical attacks from Terrors by 8 and nullifies Dark magic and Eye attacks. Adds 3 Weight during Attack Speed calculation. 25 Uses.");
  assert.equal(blockRule(sacred.blocks, { physical: true, kin: "Terror, Flying" }).reduce, 8);
  assert.equal(blockRule(sacred.blocks, { physical: true, kin: "Mounted" }).reduce, 4);
  assert.equal(blockRule(sacred.blocks, { physical: false, element: "dark" }).negate, true);
  assert.equal(blockRule(sacred.blocks, { physical: false, element: "light" }), null);

  const aiantos = readShield("Has a 45 + DEX/2% chance to block physical attacks. Reduces melee attacks by 7, negates ranged attacks. Adds 3 Weight during Attack Speed calculation. 35 Uses.");
  assert.equal(blockRule(aiantos.blocks, { physical: true, distance: 3 }).negate, true);

  const lampos = readShield("Has a 45 + DEX/2% chance to block physical attacks, reducing them by 8. Negates effectivity on all attacks to the unit for being Mounted at the cost of 1 Use on hit, regardless of blocking or not. Effective attacks that are blocked are instead reduced by 10, including magical attacks. Adds 3 Weight during Attack Speed calculation. 40 Uses.");
  assert.equal(blockRule(lampos.blocks, { physical: true, effective: true }).reduce, 10);
  assert.equal(blockRule(lampos.blocks, { physical: false, effective: true }).reduce, 10);
  assert.equal(blockRule(lampos.blocks, { physical: false }), null);
});

test("what a weapon's Effect says of blocking", () => {
  const targe = weaponBlocking("Acts as a Shield against physical attacks, with 40+DEX/2 Block rate and 3 DEF.");
  assert.equal(targe.shield.chance, 40);
  assert.deepEqual(targe.shield.blocks, [{ kind: "physical", reduce: 3 }]);
  assert.equal(weaponBlocking("+5 DEF, +10 Block rate.").chance, 10);
  assert.equal(weaponBlocking("Ignores DEF and Shields.").negates, true);
  assert.deepEqual(weaponBlocking("Brave."), { shield: null, chance: 0, negates: false });
});

/* -------------------------------------------- */
/*  The Block Chance                            */
/* -------------------------------------------- */

test("the Block chance is the Shield's own plus half of DEX, with its sum", () => {
  const guard = guardOf({ shield: shield("Round Shield", ROUND), stats: { dex: 9 } });
  assert.equal(guard.chance, 44);
  assert.deepEqual(guard.parts, [{ label: "Round Shield", value: 40 }, { label: "FEO.Stat.dex.abbr", key: true, value: 4 }]);
  assert.equal(guard.kind, "shield");
  assert.equal(guard.cost, 1);
});

test("a Shield blocks only what it can, and not once it is out of uses", () => {
  const round = shield("Round Shield", ROUND);
  assert.equal(guardOf({ shield: round, stats: {} }, { physical: false, distance: 2 }), null);
  assert.equal(guardOf({ shield: shield("Round Shield", ROUND, 30, 0), stats: {} }), null);
  assert.equal(guardOf({ shield: null, stats: {} }), null);
});

test("a weapon that goes past Shields is blocked by none", () => {
  const foe = { weapon: { name: "Kris", effect: "Ignores DEF and Shields." } };
  assert.equal(guardOf({ shield: shield("Round Shield", ROUND), stats: {} }, null, foe), null);
});

test("Blockade and Defensive raise it, and Defensive counts the whole of DEX", () => {
  const plan = (skills) => planExchange(fighter({ name: "A" }), fighter({ name: "B", shield: shield("Round Shield", ROUND), skills }));
  assert.equal(plan([]).initiator.block.chance, 44);
  assert.equal(plan([skill("Blockade")]).initiator.block.chance, 54);
  const defensive = plan([skill("Defensive")]).initiator.block;
  assert.equal(defensive.chance, 58);
  assert.deepEqual(defensive.parts.map((part) => [part.label, part.value]), [["Round Shield", 40], ["FEO.Stat.dex.abbr", 8], ["Defensive", 10]]);
});

test("Blockbreaker and Splitting Slice lower a foe's Shield Block chance, and are named in its sum", () => {
  const guarded = fighter({ name: "B", shield: shield("Round Shield", ROUND) });
  const breaker = planExchange(fighter({ name: "A", skills: [skill("Blockbreaker")] }), guarded).initiator.block;
  assert.equal(breaker.chance, 34);
  assert.deepEqual(breaker.parts.at(-1), { label: "Blockbreaker", value: -10 });
  const slice = planExchange(fighter({ name: "A", skills: [skill("Splitting Slice")], weapon: { might: 12 } }), guarded).initiator.block;
  assert.equal(slice.chance, 32);
});

test("Knightly Tactics: Grauritter adds 4 Shield Block Rate for each class tier when attacked", () => {
  const knight = (tier) => fighter({ name: "B", tier, shield: shield("Round Shield", ROUND), skills: [skill("Knightly Tactics", { choice: "Grauritter" })] });
  assert.equal(planExchange(fighter({ name: "A" }), knight(1)).initiator.block.chance, 48);
  assert.equal(planExchange(fighter({ name: "A" }), knight(3)).initiator.block.chance, 56);

  // Not when it starts the fight itself
  assert.equal(planExchange(knight(3), fighter({ name: "A" })).defender.block.chance, 44);
});

test("what an ally's aura gives counts as a skill of the unit's own", () => {
  const wall = { name: "Shieldwall (Ally)", aura: true, skill: "Shieldwall", giver: "Ally", effects: [{ block: { chance: 10 } }] };
  const defender = { ...fighter({ name: "B", shield: shield("Round Shield", ROUND) }), auras: [wall] };
  const block = planExchange(fighter({ name: "A" }), defender).initiator.block;
  assert.equal(block.chance, 54);
  assert.deepEqual(block.parts.at(-1), { label: "Shieldwall (Ally)", value: 10 });
});

test("a Shield adds to its bearer's Weight as Attack Speed is worked out", () => {
  const heavy = shield("Heavy Shield", "Has a 55 + DEX/2% chance to block physical attacks, reducing them by 7. Adds 5 Weight during Attack Speed calculation. 40 Uses.", 40);
  const bare = planExchange(fighter({ name: "A" }), fighter({ name: "B" }));
  const laden = planExchange(fighter({ name: "A" }), fighter({ name: "B", shield: heavy }));
  assert.equal(laden.defender.unit.combat.attackSpeed, bare.defender.unit.combat.attackSpeed - 2);
});

/* -------------------------------------------- */
/*  The Block in a Fight                        */
/* -------------------------------------------- */

test("a hit that is blocked loses the Shield's amount, and the Shield a use", () => {
  const { plan, result } = fight(fighter({ name: "A" }), target({ shield: shield("Round Shield", ROUND) }), [1, 100, 30]);
  const [attack] = result.attacks;
  assert.equal(plan.initiator.block.chance, 44);
  assert.deepEqual(attack.block, { by: "shield", name: "Round Shield", roll: 30, chance: 44, success: true, amount: 4, broke: false, uses: 1 });
  assert.equal(attack.damage, plan.initiator.damage - 4);
  assert.deepEqual(result.defender.shield, { usesStart: 30, uses: 29, spent: 1, broke: false });
});

test("a block that fails takes nothing off, and a miss is not rolled for", () => {
  const missed = fight(fighter({ name: "A" }), target({ shield: shield("Round Shield", ROUND) }), [1, 100, 45]);
  assert.equal(missed.result.attacks[0].block.success, false);
  assert.equal(missed.result.attacks[0].damage, missed.plan.initiator.damage);
  assert.equal(missed.result.defender.shield.spent, 0);
  const wide = fight(fighter({ name: "A" }), target({ shield: shield("Round Shield", ROUND) }), [100]);
  assert.equal(wide.result.attacks[0].block, undefined);
  assert.equal(wide.rolled, 1);
});

test("a Shield that spends its last use blocks no further hit", () => {
  const fast = fighter({ name: "A", stats: { spd: 20 } });
  const { result } = fight(fast, target({ shield: shield("Round Shield", ROUND, 30, 1) }), [1, 100, 1, 1, 100]);
  assert.equal(result.attacks.length, 2);
  assert.equal(result.attacks[0].block.broke, true);
  assert.equal(result.attacks[1].block, undefined);
  assert.deepEqual(result.defender.shield, { usesStart: 1, uses: 0, spent: 1, broke: true });
});

test("blocking a physical attack costs an Enchanted Shield 2 uses, a magical one 1", () => {
  const guarded = () => target({ shield: shield("Enchanted Shield", ENCHANTED, 25) });
  assert.equal(fight(fighter({ name: "A" }), guarded(), [1, 100, 1]).result.defender.shield.spent, 2);
  const mage = fighter({ name: "A", stats: { mag: 12 }, weapon: { name: "Fire", category: "fire", damageStat: "mag", range: "1-2" } });
  const cast = fight(mage, guarded(), [1, 100, 1]);
  assert.equal(cast.result.attacks[0].block.amount, 4);
  assert.equal(cast.result.defender.shield.spent, 1);
});

test("a Buckler parries a melee attack: all of the damage, for 2 uses", () => {
  const { plan, result } = fight(fighter({ name: "A" }), target({ shield: shield("Buckler", BUCKLER) }), [1, 100, 14]);
  assert.deepEqual(plan.initiator.block.parry, { chance: 14, uses: 2 });
  assert.equal(result.attacks[0].damage, 0);
  assert.equal(result.attacks[0].block.parry.success, true);
  assert.equal(result.defender.shield.spent, 2);

  // A parry that fails leaves the block to be rolled
  const blocked = fight(fighter({ name: "A" }), target({ shield: shield("Buckler", BUCKLER) }), [1, 100, 15, 29]);
  assert.equal(blocked.result.attacks[0].block.success, true);
  assert.equal(blocked.result.attacks[0].block.parry.success, false);
  assert.equal(blocked.result.defender.shield.spent, 1);
});

/* -------------------------------------------- */
/*  Weapon Guard                                */
/* -------------------------------------------- */

test("Weapon Guard blocks with the weapon in hand, by half its Might, for a use of it", () => {
  const guarding = fighter({ name: "B", hp: 40, hpMax: 40, skills: [skill("Weapon Guard", { active: true })], weapon: { might: 9, uses: { value: 10, max: 10 } } });
  const { plan, result } = fight(fighter({ name: "A" }), guarding, [1, 100, 34]);
  const guard = plan.initiator.block;
  assert.equal(guard.kind, "weapon");
  assert.equal(guard.chance, 34);
  assert.equal(result.attacks[0].block.amount, 4);
  assert.equal(result.defender.usesSpent >= 1, true);
  assert.equal(result.defender.shield, null);
});

test("it is nothing while switched off, blocks no magic with a sword, and Blockade raises it", () => {
  const off = fighter({ name: "B", skills: [skill("Weapon Guard")] });
  assert.equal(planExchange(fighter({ name: "A" }), off).initiator.block, null);
  const on = (skills = []) => fighter({ name: "B", skills: [skill("Weapon Guard", { active: true }), ...skills] });
  const mage = fighter({ name: "A", weapon: { name: "Fire", category: "fire", damageStat: "mag", range: "1-2" } });
  assert.equal(planExchange(mage, on()).initiator.block, null);
  assert.equal(planExchange(fighter({ name: "A" }), on([skill("Blockade")])).initiator.block.chance, 44);

  // A tome blocks magical attacks
  const caster = fighter({ name: "B", skills: [skill("Weapon Guard", { active: true })], weapon: { name: "Thunder", category: "thunder", damageStat: "mag", might: 6, range: "1-2" } });
  assert.equal(planExchange(mage, caster).initiator.block.rule.reduce, 3);
  assert.equal(planExchange(fighter({ name: "A" }), caster).initiator.block, null);
});

test("a Shield that can block the attack blocks before the weapon does", () => {
  const both = fighter({ name: "B", shield: shield("Round Shield", ROUND), skills: [skill("Weapon Guard", { active: true })] });
  assert.equal(planExchange(fighter({ name: "A" }), both).initiator.block.kind, "shield");
});

test("the stance: +20, and no counter-attack", () => {
  const stance = { name: "Weapon Guard", from: "", effects: [{ block: { guard: { chance: 30 }, chance: 20 }, rules: ["noCounter"] }], ends: "turnStart", turns: 1, clock: "", stacks: 1, max: 0, fades: false };
  const guarding = { ...fighter({ name: "B" }), timed: [stance] };
  const plan = planExchange(fighter({ name: "A" }), guarding);
  assert.equal(plan.initiator.block.chance, 54);
  assert.equal(plan.defender.blocked, "skill");
});

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

test("Blockbreaker negates a Shield's block on a roll of LUK, and wears the Shield 1d6 more", () => {
  const breaker = fighter({ name: "A", skills: [skill("Blockbreaker")], stats: { luk: 20 } });
  // hit, no crit, block (34), Blockbreaker (20), the die: 51 of 100 on six faces is a 4
  const { plan, result } = fight(breaker, target({ shield: shield("Round Shield", ROUND) }), [1, 100, 30, 20, 51]);
  const [attack] = result.attacks;
  assert.equal(attack.block.success, false);
  assert.equal(attack.block.negated, "Blockbreaker");
  assert.equal(attack.damage, plan.initiator.damage);
  assert.equal(result.defender.shield.spent, 4);

  // A roll above LUK leaves the block standing
  const stood = fight(breaker, target({ shield: shield("Round Shield", ROUND) }), [1, 100, 30, 21]);
  assert.equal(stood.result.attacks[0].block.success, true);
  assert.equal(stood.result.defender.shield.spent, 1);
});

test("Blockbreaker leaves a guarding weapon alone", () => {
  const breaker = fighter({ name: "A", skills: [skill("Blockbreaker")], stats: { luk: 100 } });
  const guarding = fighter({ name: "B", hp: 40, hpMax: 40, skills: [skill("Weapon Guard", { active: true })] });
  const { plan, result } = fight(breaker, guarding, [1, 100, 1]);
  assert.equal(plan.initiator.block.chance, 34);
  assert.equal(result.attacks[0].block.success, true);
});

test("Splitting Slice: a blocked attack costs the Shield a tenth of the weapon's Might more", () => {
  const slicer = fighter({ name: "A", skills: [skill("Splitting Slice")], weapon: { might: 25 } });
  const { result } = fight(slicer, target({ shield: shield("Round Shield", ROUND) }), [1, 100, 1]);
  assert.equal(result.attacks[0].block.success, true);
  assert.equal(result.defender.shield.spent, 3);
});

test("Sky-Clearing Cut goes past a Shield on the one attack it is declared for", () => {
  const cutter = fighter({ name: "A", stats: { spd: 20 }, skills: [skill("Sky-Clearing Cut", { active: true })] });
  const { result } = fight(cutter, target({ shield: shield("Round Shield", ROUND) }), [1, 100, 1, 100, 1]);
  assert.equal(result.attacks[0].block, undefined);
  assert.equal(result.attacks[1].block.success, true);
});

test("Shatter goes past a Shield, lowers DEF and RES for 2 turns and takes 20 uses off the Shield afterwards", () => {
  const shatterer = fighter({ name: "A", skills: [skill("Shatter", { active: true })] });
  const { result } = fight(shatterer, target({ shield: shield("Round Shield", ROUND) }), [1, 100]);
  assert.equal(result.attacks[0].block, undefined);
  assert.deepEqual(result.defender.shield, { usesStart: 30, uses: 10, spent: 20, broke: false });
  const [granted] = result.granted;
  assert.equal(granted.to, "defender");
  assert.deepEqual(granted.change.effects, [{ stats: { def: -5, res: -5 } }]);
  assert.equal(granted.change.turns, 2);

  // An attack that misses does neither
  const missed = fight(shatterer, target({ shield: shield("Round Shield", ROUND) }), [100]);
  assert.equal(missed.result.defender.shield.spent, 0);
  assert.equal(missed.result.granted, undefined);
});

test("Panoply's chance is 10 higher for a hit that was blocked with a Shield", () => {
  const armored = (extra = {}) => target({ skills: [skill("Panoply")], stats: { dex: 10 }, ...extra });
  const plain = fight(fighter({ name: "A" }), armored(), [1, 100, 11]);
  assert.equal(plain.result.attacks[0].procs.find((proc) => proc.skill === "Panoply").chance, 10);
  const blocked = fight(fighter({ name: "A" }), armored({ shield: shield("Round Shield", ROUND) }), [1, 100, 1, 20]);
  const proc = blocked.result.attacks[0].procs.find((entry) => entry.skill === "Panoply");
  assert.equal(proc.chance, 20);
  assert.equal(proc.success, true);
  assert.equal(blocked.result.attacks[0].damage, Math.max(blocked.plan.initiator.damage - 4 - 10, 0));
});

test("Resilience: +2 DEF with a Shield, which a hit that is blocked goes without", () => {
  const plain = planExchange(fighter({ name: "A" }), target()).initiator.damage;
  const resilient = () => target({ shield: shield("Round Shield", ROUND), skills: [skill("Resilience")] });
  const open = fight(fighter({ name: "A" }), resilient(), [1, 100, 100]);
  assert.equal(open.plan.initiator.damage, plain - 2);
  assert.equal(open.result.attacks[0].damage, plain - 2);
  const blocked = fight(fighter({ name: "A" }), resilient(), [1, 100, 1]);
  assert.equal(blocked.result.attacks[0].damage, plain - 4);

  // No bonus without a Shield, and RES only with one that blocks magic
  assert.equal(planExchange(fighter({ name: "A" }), target({ skills: [skill("Resilience")] })).initiator.damage, plain);
  const warded = target({ shield: shield("Enchanted Shield", ENCHANTED, 25), skills: [skill("Resilience")] });
  assert.equal(planExchange(fighter({ name: "A" }), warded).defender.unit.stats.res, 5);
  assert.equal(planExchange(fighter({ name: "A" }), resilient()).defender.unit.stats.res, 3);
});

test("Fresh Start: the first use of a weapon is a critical hit, and the skill is spent", () => {
  const fresh = fighter({ name: "A", stats: { spd: 20 }, skills: [skill("Fresh Start")] });
  const { plan, result, rolled } = fight(fresh, target(), [1, 1]);
  assert.equal(plan.initiator.crit, 100);
  assert.equal(result.attacks[0].crit, true);
  assert.equal(result.attacks[0].critRoll, null);
  assert.equal(result.attacks[1].crit, false);
  assert.deepEqual(result.initiator.spent.map((entry) => entry.name), ["Fresh Start"]);
  assert.equal(rolled, 3);

  // Not with a weapon that has lost a use already
  const used = fighter({ name: "A", skills: [skill("Fresh Start")], weapon: { uses: { value: 39, max: 40 } } });
  assert.ok(planExchange(used, target()).initiator.crit < 100);

});

test("with a melee weapon the first use is the first attack that lands", () => {
  const fresh = fighter({ name: "A", stats: { spd: 20 }, skills: [skill("Fresh Start")] });
  const { result } = fight(fresh, target(), [100, 1]);
  assert.equal(result.attacks[0].hit, false);
  assert.equal(result.attacks[1].crit, true);
});

test("Fresh Start: the first use of a Shield takes everything off the hit it blocks", () => {
  const fresh = target({ shield: shield("Round Shield", ROUND), skills: [skill("Fresh Start")] });
  const { result } = fight(fighter({ name: "A", stats: { spd: 20 } }), fresh, [1, 100, 1, 1, 100, 1]);
  assert.equal(result.attacks[0].damage, 0);
  assert.equal(result.attacks[0].block.all, "Fresh Start");
  assert.equal(result.attacks[1].block.amount, 4);
  assert.deepEqual(result.defender.spent.map((entry) => entry.name), ["Fresh Start"]);
});

test("Make It Count: the last use of a weapon is a critical hit, the last of a Shield takes everything", () => {
  const last = fighter({ name: "A", skills: [skill("Make It Count")], weapon: { uses: { value: 1, max: 40 } } });
  const struck = fight(last, target(), [1]);
  assert.equal(struck.result.attacks[0].crit, true);
  assert.equal(struck.result.initiator.broke, true);

  const worn = target({ shield: shield("Round Shield", ROUND, 30, 1), skills: [skill("Make It Count")] });
  const blocked = fight(fighter({ name: "A" }), worn, [1, 100, 1]);
  assert.equal(blocked.result.attacks[0].damage, 0);
  assert.equal(blocked.result.attacks[0].block.all, "Make It Count");
  assert.equal(blocked.result.defender.shield.broke, true);
});

test("Wave The Flag: no counter-attack in Flag stance", () => {
  const bearer = fighter({ name: "B", skills: [skill("Wave The Flag", { active: true })] });
  assert.equal(planExchange(fighter({ name: "A" }), bearer).defender.blocked, "skill");
  assert.equal(planExchange(fighter({ name: "A" }), fighter({ name: "B", skills: [skill("Wave The Flag")] })).defender.blocked, null);
});

/* -------------------------------------------- */
/*  The Moments of a Block                      */
/* -------------------------------------------- */

test("a skill can wait for its unit to block: more taken off, and an attack in answer", () => {
  const phalanx = made("Doubler", [{ proc: { on: "block", sure: true }, blockTimes: 2 }]);
  const bash = made("Basher", [{ proc: { on: "block", sure: true, by: "shield" }, attack: true }]);
  const guarded = fighter({ name: "B", hp: 40, hpMax: 40, shield: shield("Round Shield", ROUND), skills: [phalanx, bash] });
  const { plan, result } = fight(fighter({ name: "A", hp: 40, hpMax: 40 }), guarded, [1, 100, 1, 1, 100]);
  assert.equal(result.attacks[0].block.amount, Math.min(8, plan.initiator.damage));
  assert.equal(result.attacks[1].side, "defender");
  assert.equal(result.attacks[1].added, true);
  assert.equal(result.attacks[1].skill, "Basher");
});

test("and for its own attack to be blocked: less taken off, and wear on the foe's weapon and Shield", () => {
  const punch = made("Puncher", [{ proc: { on: "blocked", sure: true }, blockLess: 3, wears: { shield: 2, weapon: 1 } }]);
  const guarded = fighter({ name: "B", hp: 40, hpMax: 40, shield: shield("Round Shield", ROUND), weapon: { uses: { value: 20, max: 20 } } });
  const { result } = fight(fighter({ name: "A", hp: 40, hpMax: 40, skills: [punch] }), guarded, [1, 100, 1, 100]);
  assert.equal(result.attacks[0].block.amount, 1);
  assert.equal(result.defender.shield.spent, 3);
  assert.equal(result.defender.usesSpent, 1);
});

test("the notation is checked", () => {
  assert.deepEqual(checkBlock({ chance: 10, kind: "shield" }), []);
  assert.equal(checkBlock({ chance: "many" }).length, 1);
  assert.equal(checkBlock({ kind: "helmet" }).length, 1);
  assert.equal(checkBlock({ guard: {} }).length, 1);
  assert.deepEqual(checkEffects([{ proc: { on: "blocked", stat: "luk", by: "shield" }, unblock: true, wears: { shield: { dice: 6 } } }]), []);
  assert.equal(checkEffects([{ proc: { on: "hit", sure: true }, unblock: true }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "start", sure: true }, wears: { shield: 1 } }]).length, 1);
  assert.equal(checkEffects([{ proc: { on: "attack", sure: true }, block: { chance: 5 } }]).length, 1);
  assert.equal(checkEffects([{ when: { shield: "big" }, stats: { def: 1 } }]).length, 1);
  assert.deepEqual(checkEffects([{ weaponUse: { first: "crit" } }, { when: { shield: true }, stats: { def: 2 }, lostOnBlock: true }]), []);
});

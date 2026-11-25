/**
 * Tests for what worn and wielded gear gives its unit (`module/rules/gear.mjs`, `module/rules/weapons.mjs`): the
 * Effect of a weapon, an accessory or a Shield read clause by clause, what a fight makes of it, and what is
 * left of a weapon's Effect for the readers that take it as words.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveAgainst, planExchange, playExchange } from "../module/rules/combat.mjs";
import { inflictions } from "../module/rules/conditions.mjs";
import { gearCoverage, gearEntry, grantedSkills, isStorage, plainEffect, readGear, wornRestore } from "../module/rules/gear.mjs";
import { weaponStrikes } from "../module/rules/skill-combat.mjs";
import { checkEffects, skillKnacks, skillTotals } from "../module/rules/skills.mjs";
import { weaponCarried, weaponEntry, weaponGives } from "../module/rules/weapons.mjs";
import { fighter, made } from "./lib/fixtures.mjs";

const read = (effect, kind = "weapon") => readGear(effect, { kind });
const worn = (name, effect, kind = "accessory") => {
  const entry = gearEntry(name, structuredClone(readGear(effect, { kind }).effects));
  return entry ? { ...entry, active: false, spends: false, usage: null, state: null } : null;
};
const wielded = (weapon) => {
  const entry = weaponEntry(weapon, weapon.name);
  return entry ? [{ ...entry, active: false, spends: false, usage: null, state: null }] : [];
};

/** A unit with a weapon in hand, and what that weapon gives it as one more skill of its own. */
const armed = (weapon, options = {}) => fighter({
  ...options, weapon, skills: [...wielded({ category: "sword", ...weapon }), ...(options.skills ?? [])],
  stats: { dex: 6, ...(options.stats ?? {}) }
});
const foe = (options = {}) => fighter({ name: "Foe", hp: 40, hpMax: 40, ...options, stats: { dex: 6, ...(options.stats ?? {}) } });
const self = { hp: 20, hpMax: 20, level: 5, stats: { str: 10, mag: 4, def: 6, res: 3, dex: 8, spd: 8, luk: 5, mov: 5, con: 8, los: 6 }, weapon: null };

function play(initiator, defender, rolls = [], { rest = 100, distance = 1 } = {}) {
  const plan = planExchange(initiator, defender, { distance });
  const { result } = playExchange(plan, (index) => rolls[index] ?? rest, () => null, {});
  return { plan, result };
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

test("bonuses are read with what they are added to, however the tabs list them", () => {
  assert.deepEqual(read("+5 SPD").effects, [{ stats: { spd: 5 } }]);
  assert.deepEqual(read("+3 DEF and RES").effects, [{ stats: { def: 3, res: 3 } }]);
  assert.deepEqual(read("-2 DEF and RES").effects, [{ stats: { def: -2, res: -2 } }]);
  assert.deepEqual(read("+4 DEF/RES, +10 Block Chance.").effects, [{ stats: { def: 4, res: 4 }, block: { chance: 10 } }]);
  assert.deepEqual(read("+1 ATK, +5 Hit.", "accessory").effects, [{ combat: { damage: 1, hit: 5 } }]);
  assert.deepEqual(read("+1 END, +5 Dodge.", "accessory").effects, [{ endurance: 1, combat: { dodge: 5 } }]);
  assert.deepEqual(read("+1 HST, +5 Critical.", "accessory").effects, [{ haste: 1, combat: { critical: 5 } }]);
  assert.deepEqual(read("Unit gains +2 STR, MAG, DEF, RES, DEX, SPD and LUK.", "accessory").effects,
    [{ stats: { str: 2, mag: 2, def: 2, res: 2, dex: 2, spd: 2, luk: 2 } }]);
  assert.deepEqual(read("+2 to all stats", "accessory").effects, [{ stats: { str: 2, mag: 2, def: 2, res: 2, dex: 2, spd: 2, luk: 2 } }]);
  assert.deepEqual(read("Unit gains +3 STR, MAG, SPD and DEX and loses -5 DEF and RES.", "accessory").effects,
    [{ stats: { str: 3, mag: 3, spd: 3, dex: 3, def: -5, res: -5 } }]);
  assert.deepEqual(read("Unit gains +15 Skill activation rate.", "accessory").effects, [{ combat: { activation: 15 } }]);
  assert.deepEqual(read("-20 Critical Avoid").effects, [{ combat: { critAvoid: -20 } }]);
  assert.deepEqual(read("Unit gains +2 LoS.", "accessory").effects, [{ stats: { los: 2 } }]);
  assert.deepEqual(read("Unit gains +10 Max HP.", "accessory").effects, [{ hpMax: 10 }]);
  assert.deepEqual(read("Unit gains +15% Max HP.", "accessory").effects, [{ hpMax: { of: "hpMax", times: 0.15 } }]);
});

test("a bonus that hangs on something says so", () => {
  assert.deepEqual(read("+4 Might against Mounted units.").effects, [{ when: { foeQuality: ["Mounted"] }, might: 4 }]);
  assert.deepEqual(read("+5 damage against Sword-wielding enemies").effects, [{ when: { foeWeapon: ["sword"] }, combat: { damage: 5 } }]);
  assert.deepEqual(read("+3 RES against Dark magic and Eye").effects, [{ when: { foeWeapon: ["dark", "eye"] }, stats: { res: 3 } }]);
  assert.deepEqual(read("+5 STR when at 50% HP or less.").effects, [{ when: { hp: { op: "le", percent: 50 } }, stats: { str: 5 } }]);
  assert.deepEqual(read("+5 MAG when this unit has 100% HP").effects, [{ when: { hp: { op: "full" } }, stats: { mag: 5 } }]);
  assert.deepEqual(read("+5 STR and DEF if the enemy initiates combat").effects, [{ when: { role: "defending" }, stats: { str: 5, def: 5 } }]);
  assert.deepEqual(read("-30 Hit at 1 Range.").effects, [{ when: { range: { min: 1, max: 1 } }, combat: { hit: -30 } }]);
  assert.deepEqual(read("Unit gains +5 Might and +10 Hit/Critical with Light tomes.", "accessory").effects,
    [{ when: { weapon: ["light"] }, might: 5, combat: { hit: 10, critical: 10 } }]);
  assert.deepEqual(read("Unit gains +10 Critical with all weapons.", "accessory").effects, [{ combat: { critical: 10 } }]);
  assert.deepEqual(read("User gains +20 Dodge against physical ranged attacks.").effects,
    [{ when: { foeWeapon: ["physical"], range: { min: 2 } }, combat: { dodge: 20 } }]);
});

test("growth rates are read from a Band, and from a Ward beside its stats", () => {
  assert.deepEqual(read("Increases DEF and RES growths by 5%.", "accessory").effects, [{ growths: { def: 5, res: 5 } }]);
  assert.deepEqual(read("Increases HP, MAG, RES, DEX, SPD and LUK growths by 3%.", "accessory").effects,
    [{ growths: { hp: 3, mag: 3, res: 3, dex: 3, spd: 3, luk: 3 } }]);
  assert.deepEqual(read("Increases HP growth by 10%", "accessory").effects, [{ growths: { hp: 10 } }]);
  assert.deepEqual(read("Unit gains +2 DEF and RES, as well as +15% SPD growth rate.", "accessory").effects,
    [{ stats: { def: 2, res: 2 }, growths: { spd: 15 } }]);
});

test("a clause is divided where its commas divide it, and one that holds commas is read whole", () => {
  const sharanga = read("Flying, +10 SPD, increases user's MOV by 50% and grants Canto+.");
  assert.deepEqual(sharanga.effects, [{ stats: { spd: 10 } }, { statPercent: { mov: 50 } }]);
  assert.deepEqual(sharanga.grants, [{ name: "Canto+", while: "equipped" }]);
  assert.equal(sharanga.kept, "Flying");
  assert.deepEqual(sharanga.left, []);

  const raider = read("Inflicts -5 DEF on foe, until the end of their next turn, 2x Strikes when initiating combat.");
  assert.deepEqual(raider.effects, [{ proc: { on: "hit", sure: true }, grant: { to: "foe", effects: [{ stats: { def: -5 } }], ends: "turnEnd", next: true } }]);
  assert.equal(raider.kept, "2x Strikes when initiating combat");

  const parashu = read("+5 CON, Adds unit's CON to Might, Hit and Critical. Grants Gigas Grip.");
  assert.deepEqual(parashu.effects, [{ stats: { con: 5 } }, { might: { of: "con" }, combat: { hit: { of: "con" }, critical: { of: "con" } } }]);
  assert.deepEqual(parashu.grants, [{ name: "Gigas Grip", while: "equipped" }]);
});

test("skills are granted by name, and a Special Quality after one is no skill", () => {
  assert.deepEqual(read("Grants Miracle, Renewal, Close Call and Amaterasu.", "accessory").grants.map((grant) => grant.name),
    ["Miracle", "Renewal", "Close Call", "Amaterasu"]);
  assert.deepEqual(read("Grants Miracle to unit.", "accessory").grants, [{ name: "Miracle", while: "equipped" }]);
  const yewfelle = read("+5 STR and SPD, Grants Renewal, Flying");
  assert.deepEqual(yewfelle.grants, [{ name: "Renewal", while: "equipped" }]);
  assert.equal(yewfelle.kept, "Flying");
  assert.deepEqual(read("Flying, grants Overwatch, Midrange").grants, [{ name: "Overwatch", while: "equipped" }]);
  assert.deepEqual(read("Grants Cold Rain when not equipped.").grants, [{ name: "Cold Rain", while: "stowed" }]);
  assert.deepEqual(read("Flying, +3 SPD, Grants Fencer's Grace. 35% to Squall.").grants, [{ name: "Fencer's Grace", while: "equipped" }]);
});

test("what a weapon gives while it is only carried is kept apart", () => {
  const tome = read("Armored, +3 RES, Grants +3 STR when in inventory, 50% to Tremor.");
  assert.deepEqual(tome.effects, [{ stats: { res: 3 } }]);
  assert.deepEqual(tome.carried, [{ stats: { str: 3 } }]);
  assert.equal(tome.kept, "Armored, 50% to Tremor");
  const weapon = { category: "earth", effect: "Armored, +3 RES, Grants +3 STR when in inventory, 50% to Tremor." };
  assert.deepEqual(weaponGives(weapon), [{ stats: { res: 3 } }, { stats: { str: 3 } }], "in hand it gives both");
  assert.deepEqual(weaponCarried(weapon), [{ stats: { str: 3 } }]);
  assert.deepEqual(weaponCarried({ ...weapon, broken: true }), []);
  assert.deepEqual(read("Increases all growth rates by 5% while in inventory. Loses one use if unequipped when user levels up.").carried,
    [{ growths: { hp: 5, str: 5, mag: 5, def: 5, res: 5, dex: 5, spd: 5, luk: 5 } }]);
});

test("what the readers of a weapon's Effect take stays in it, and what was turned into an effect does not", () => {
  // Effective damage, conditions, strikes and the rest are read where they are used, as they always were
  const flame = "Beast, MAG not STR, Fire for magic weapon triangle, 25% to Burn.";
  assert.deepEqual(read(flame).effects, []);
  assert.deepEqual(read(flame).left, []);
  assert.deepEqual(effectiveAgainst(plainEffect({ effect: flame }), "Beast"), ["Beast"]);
  assert.deepEqual(inflictions(plainEffect({ effect: flame })).map((entry) => [entry.id, entry.chance]), [["burn", 25]]);
  assert.equal(weaponStrikes(plainEffect({ effect: "2x Strikes, +5 SPD" })), 2);

  // A weapon that only names a quality in a bonus is not effective against it
  assert.deepEqual(effectiveAgainst("+4 Might against Mounted units.", "Mounted"), ["Mounted"], "as the words alone read");
  assert.deepEqual(effectiveAgainst(plainEffect({ effect: "+4 Might against Mounted units." }), "Mounted"), []);
  assert.deepEqual(effectiveAgainst(plainEffect({ effect: "Increases final damage by 1.15x against targets without the Armored quality." }), "Armored"), []);
  assert.deepEqual(effectiveAgainst(plainEffect({ effect: "+1 Dragon Form/Turn, +3 STR, Beast, 50% Burn." }), "Dragon, Beast"), ["Beast"]);
  assert.deepEqual(effectiveAgainst(plainEffect({ effect: "Does not damage Flying units." }), "Flying"), []);
  assert.deepEqual(effectiveAgainst(plainEffect({ effect: "Dragon. +10 DEF and RES against Dragon units." }), "Dragon"), ["Dragon"]);

  // A staff's Effect says what it does to its target, and is left as it is
  assert.equal(plainEffect({ category: "staff", effect: "+7 RES, Decreases by 1 each turn until normal." }), "+7 RES, Decreases by 1 each turn until normal.");
  assert.deepEqual(weaponGives({ category: "staff", effect: "+7 RES, Decreases by 1 each turn until normal." }), []);
});

test("what is not read is left to the table, in its own words", () => {
  const hauteclere = read("As an action: Remove any number of weapon uses from this weapon to gain 10 HP per use.");
  assert.deepEqual(hauteclere.effects, []);
  assert.deepEqual(hauteclere.left, ["As an action: Remove any number of weapon uses from this weapon to gain 10 HP per use"]);
  assert.deepEqual(gearCoverage("As an action: Remove any number of weapon uses from this weapon to gain 10 HP per use."), { state: "text", left: hauteclere.left });

  const theseus = read("Mounted, After unit is healed, weapon gains Mt equivalent to the amount of HP healed, until the next turn.");
  assert.deepEqual(theseus.left, ["After unit is healed, weapon gains Mt equivalent to the amount of HP healed, until the next turn"]);
  assert.equal(gearCoverage("Mounted, After unit is healed, weapon gains Mt equivalent to the amount of HP healed, until the next turn.").state, "part");
  assert.equal(gearCoverage("+5 SPD").state, "done");
  assert.equal(gearCoverage("").state, "done");
  assert.deepEqual(gearCoverage("Grants Fiery Blood.", { hasSkill: () => false }), { state: "text", left: ["Grants Fiery Blood (no skill of that name)"] });
  assert.equal(gearCoverage("Grants Miracle.", { hasSkill: () => true }).state, "done");
});

test("every effect the reader writes is one the skill rules know", () => {
  const samples = [
    "Unit makes +2 additional attacks.", "Unit makes an additional attack after their first with 1/3rd final damage.", "Targets RES.",
    "Targets DEF instead of RES.", "Ignores DEF and Shields.", "Ignores foe's RES.", "Reverses Weapon Triangle", "Negates Weapon Triangle",
    "Doubles Weapon Triangle effects on unit and foe.", "Gain HP equal to damage", "Gain HP equal to ½ damage.", "Heal HP equal to damage dealt.",
    "Unit restores 5 HP each turn", "Critical hits deal 4x damage instead of 3x", "Effectiveness deals 4x Might instead of 3x.",
    "Negates foe's terrain effects on Forests/Thickets/Wardwood.", "Halves any damage this unit would take.", "always hits",
    "Unit always goes first in combat.", "Unit attacks last in combat.", "Unit can follow-up before foe can counter-attack.",
    "Foes cannot counterattack.", "If unit initiates combat, target cannot counter- attack", "Cannot Critical or Follow-Up.", "Cannot double.",
    "Negates enemy's counterattacks when this unit's RES is higher.", "Effective against Sword-wielding enemies.",
    "effective against units wielding Dark magic or Eye.", "Effective against units without any Special Qualities.",
    "Increases final damage by 1.2x against targets without the Armored quality.", "Counter-attacks deal 2x damage.",
    "Might is doubled when counterattacking", "User has a DEX% chance to halve magical damage.", "Deals ½ to enemy units adjacent to the target.",
    "If this unit initiates combat, enemy receives 5 damage after combat.", "User takes 15 damage when initiating combat.",
    "Adds 1/4th, half, and all of unit's CON to Might, Critical and Hit respectively.", "adds 50% of SPD to Might.", "CON is added to Might.",
    "+5 Mt for each ally in a 2 space radius", "Increase Might by the amount of stat debuffs on foe.", "Mt = Enemy's Mt",
    "inflicts -2 SPD on hit.", "inflicts -5 SPD on target after combat for a turn.", "Inflicts -3 LUK on enemy until user's next turn.",
    "Inflicts -15 Dodge on enemy until user's next turn.", "Halves target's MOV for a turn on hit.",
    "After this unit initiates combat, this unit gets +5 DEF and RES until it's next turn.",
    "After this unit initiates combat, target gets -5 DEF and RES until it's next turn.",
    "+3 to STR, DEX, SPD and LUK after landing a critical hit until the end of the unit's next turn.",
    "At start of this unit's turn, enemies in a 2-space radius lose -5 STR and MAG until the end of the turn.",
    "If unit initiates combat, enemy is knocked backwards by 1 tile.", "Pushes enemy backwards 1 tile after combat if unit lands an attack",
    "User can traverse Water/Sea/Ocean/River tiles at no movement penalty.", "increases user's MOV by 50%",
    "Steals gold from target upon a successful hit, once per enemy. Amount stolen is determined by the GM.", "User gains 2x EXP.",
    "Increases Skill activation chance by 15.", "Grants +2 STR/MAG/DEX/SPD to allies within 2 spaces.", "+2 Dragon Form/Turn",
    "+2 Shift gauge/turn, combat consumes 1 shift gauge less", "5x Strikes, using only 1 Use.", "Activates Aether every attack."
  ];
  for ( const effect of samples ) {
    const gear = read(effect);
    assert.ok(gear.effects.length || gear.carried.length, `${effect}: nothing was read`);
    assert.deepEqual(gear.left, [], `${effect}: something was left`);
    assert.deepEqual(checkEffects([...gear.effects, ...gear.carried]), [], effect);
  }
  const worn = [
    "Unit negates 10% of foe's DEF/RES.", "Unit is immune to Rattled.", "Doubles the effects of all restorative items.",
    "Unit can use the Steal action.", "Negates bonus damage against the unit with this item equipped.", "Halves damage taken from Laguz units.",
    "Negates any critical hits against the unit with this item equipped.", "Negates criticals, effective damage and grants +10 RES.",
    "+5 RES. Halves damage taken during combat.", "+10 Max HP. Heals unit for 15 HP at the start of each turn.",
    "+2 to all stats. Unit's attacks do not consume weapon uses.", "Unit gains a second full action and movement every turn.",
    "Unit gains +1 Range with Bows and Bolts.", "Unit receives a 25% discount in Shops. Stacks with the Bargain skill.",
    "Unit heals 5 HP at the start of their turn. Halves damage taken from units with the Terror special quality.",
    "Unit gains a 15% chance to make an immediate additional attack when attacking. Other additional attacks (i.e from Adept) can happen during these.",
    "Unit gains +3 RES and heals 5 HP at the start of their turn.", "Unit gains 50% to Burn on hit.",
    "Unit heals self and allies for 25% more with Staves and Healing items.",
    "Unit can move the remainder of it's Movement after most actions, as though it had the Mounted or Flying special qualities.",
    "Unit gains double wEXP.", "Increases the range of all magic tomes by 1.", "Unit gains double EXP.",
    "Negates all Status Conditions and stat debuffs."
  ];
  for ( const effect of worn ) {
    const gear = read(effect, "accessory");
    assert.ok(gear.effects.length, `${effect}: nothing was read`);
    assert.deepEqual(gear.left, [], `${effect}: something was left`);
    assert.deepEqual(checkEffects(gear.effects), [], effect);
  }
});

test("an accessory is told from a Storage item, and a Goddess Ring is Used for its HP", () => {
  assert.ok(isStorage("Holds up to two weapons/items. Adds 1 Weight during Attack Speed calculation when storing atleast one item."));
  assert.ok(isStorage("Holds an unlimited amount of weapons/items."));
  assert.ok(!isStorage("Unit gains +5 SPD."));
  assert.equal(wornRestore("Unit can restore 10 HP to themselves as an action."), 10);
  assert.equal(wornRestore("Restores 10 HP."), 0);
  assert.deepEqual(read("Unit can restore 10 HP to themselves as an action.", "accessory").left, []);
});

test("of a Shield only what it does beyond blocking is read", () => {
  const binding = read("Has a 55 + DEX/2% chance to block attacks, reducing them by 6, and negates attacks from Manaketes. Grants +2 to STR, MAG, DEF, RES, DEX, SPD and LUK. Adds 4 Weight during Attack Speed calculation. 50 Uses.", "shield");
  assert.deepEqual(binding.effects, [{ stats: { str: 2, mag: 2, def: 2, res: 2, dex: 2, spd: 2, luk: 2 } }]);
  assert.deepEqual(binding.left, []);
  assert.deepEqual(read("Has a 45 + DEX/2% chance to block physical attacks, reducing them by 5. Grants Authority. Adds 3 Weight during Attack Speed calculation. 25 Uses.", "shield").grants,
    [{ name: "Authority", while: "equipped" }]);
  assert.deepEqual(read("Has a 45 + DEX/2% chance to block physical attacks, reducing them by 7. User cannot be forcibly moved. Adds 3 Weight during Attack Speed calculation. 35 Uses.", "shield").effects,
    [{ rules: ["rooted"] }]);
  assert.deepEqual(read("Has a 45 + DEX/2% chance to block physical attacks, reducing them by 8. Negates effectivity on all attacks to the unit for being Mounted at the cost of 1 Use on hit, regardless of blocking or not. Effective attacks that are blocked are instead reduced by 10, including magical attacks. Adds 3 Weight during Attack Speed calculation. 40 Uses.", "shield").effects,
    [{ uneffective: ["Mounted"] }]);
});

/* -------------------------------------------- */
/*  Granting Skills                             */
/* -------------------------------------------- */

test("a skill is granted by the gear in use, and by a tome that grants it while it is put away", () => {
  const gear = [
    { name: "Miracle Sword", kind: "weapon", category: "sword", effect: "Grants Miracle.", equipped: true },
    { name: "Tyrfing", kind: "weapon", category: "sword", effect: "+5 RES, grants Miracle.", equipped: false },
    { name: "Downpour", kind: "weapon", category: "water", effect: "Grants Cold Rain when not equipped.", equipped: false },
    { name: "Circlet", kind: "accessory", effect: "Grants Miracle, Renewal, Close Call and Amaterasu.", equipped: true },
    { name: "Tearstone Ring", kind: "accessory", effect: "Grants Resolve.", equipped: false },
    { name: "Officer's Shield", kind: "shield", effect: "Has a 45 + DEX/2% chance to block physical attacks, reducing them by 5. Grants Authority.", equipped: true },
    { name: "Greatsword", kind: "weapon", category: "sword", effect: "Grants Guts.", equipped: true, broken: true }
  ];
  assert.deepEqual(grantedSkills(gear), [
    { skill: "Miracle", from: "Miracle Sword" },
    { skill: "Cold Rain", from: "Downpour" },
    { skill: "Renewal", from: "Circlet" },
    { skill: "Close Call", from: "Circlet" },
    { skill: "Amaterasu", from: "Circlet" },
    { skill: "Authority", from: "Officer's Shield" }
  ]);
  assert.deepEqual(grantedSkills([{ name: "Downpour", kind: "weapon", category: "water", effect: "Grants Cold Rain when not equipped.", equipped: true }]), []);
});

/* -------------------------------------------- */
/*  In a Fight                                  */
/* -------------------------------------------- */

test("a Glaive adds 4 Might against a Mounted unit, and is not effective against it", () => {
  const glaive = { name: "Iron Glaive", category: "lance", might: 7, effect: "+4 Might against Mounted units." };
  const plain = planExchange(armed({ ...glaive, effect: "" }), foe({ qualities: "Mounted" })).initiator;
  const mounted = planExchange(armed(glaive), foe({ qualities: "Mounted" })).initiator;
  const afoot = planExchange(armed(glaive), foe()).initiator;
  assert.deepEqual(mounted.effective, []);
  assert.equal(mounted.blows[0].damage, plain.blows[0].damage + 4);
  assert.equal(afoot.blows[0].damage, plain.blows[0].damage);
});

test("a Scimitar deals its share more to a unit that is not Armored", () => {
  const scimitar = { name: "Steel Scimitar", might: 8, effect: "Increases final damage by 1.2x against targets without the Armored quality." };
  const plain = planExchange(armed({ ...scimitar, effect: "" }), foe()).initiator.blows[0].damage;
  assert.equal(planExchange(armed(scimitar), foe()).initiator.blows[0].damage, Math.floor(plain * 1.2));
  const armoured = planExchange(armed(scimitar), foe({ qualities: "Armored" })).initiator;
  assert.equal(armoured.blows[0].damage, plain);
  assert.deepEqual(armoured.effective, []);
});

test("what a weapon adds to stats counts in the fight: Speed follows up, Defence takes less", () => {
  assert.deepEqual(planExchange(armed({ name: "Iron Sword" }, { stats: { spd: 8 } }), foe()).order, ["initiator", "defender"]);
  const garm = wielded({ name: "Garm", category: "axe", effect: "+5 SPD" });
  const totals = skillTotals(garm, self);
  assert.deepEqual(totals.stats, { spd: 5 });
  const guard = wielded({ name: "Rearguard", category: "axe", effect: "+7 DEF" });
  assert.deepEqual(skillTotals(guard, self).stats, { def: 7 });
});

test("a Knight weapon makes one more attack, and a Brymranger two", () => {
  const knight = { name: "Knight Sword", effect: "Unit makes +1 additional attack." };
  assert.deepEqual(planExchange(armed(knight), foe()).order, ["initiator", "defender", "initiator"]);
  const two = planExchange(armed({ name: "Brymranger", effect: "-50 Dodge, unit makes +2 additional attacks." }), foe());
  assert.equal(two.order.filter((side) => side === "initiator").length, 3);
  assert.equal(planExchange(armed({ name: "Iron Sword" }), foe()).order.filter((side) => side === "initiator").length, 1);
});

test("a Runesword heals its wielder for the damage it deals", () => {
  const rune = { name: "Runesword", effect: "Gain HP equal to damage" };
  const { result, plan } = play(armed(rune, { hp: 10, hpMax: 40 }), foe({ weapon: null }), [1]);
  const dealt = plan.initiator.blows[0].damage;
  assert.ok(dealt > 0);
  assert.equal(result.initiator.hp, 10 + dealt);
});

test("a Reaver turns the Weapon Triangle around, and a Superior weapon cancels it", () => {
  const usual = planExchange(armed({ name: "Iron Sword" }), foe({ weapon: { name: "Iron Lance", category: "lance" } })).triangle.advantage;
  const reaver = planExchange(armed({ name: "Lancereaver", effect: "Reverses Weapon Triangle, +5 Damage against Lance-wielding enemies" }),
    foe({ weapon: { name: "Iron Lance", category: "lance" } }));
  assert.ok(usual && reaver.triangle.advantage && (reaver.triangle.advantage !== usual), "the advantage changes sides");
  const superior = planExchange(armed({ name: "Superior Sword", effect: "Negates Weapon Triangle, +5 Damage against Sword-wielding enemies." }),
    foe({ weapon: { name: "Iron Lance", category: "lance" } }));
  assert.equal(superior.triangle.advantage, null);
});

test("a weapon that targets RES is resisted with it", () => {
  const plain = planExchange(armed({ name: "Iron Axe", category: "axe" }), foe({ stats: { def: 9, res: 1 } })).initiator;
  const mystic = planExchange(armed({ name: "Mystic Axe", category: "axe", effect: "Targets RES." }), foe({ stats: { def: 9, res: 1 } })).initiator;
  assert.equal(mystic.blows[0].damage, plain.blows[0].damage + 8);
});

test("Parity cancels what gear gives, as it cancels skills", () => {
  const ring = worn("Strength Ring", "Unit gains +5 STR.");
  const parity = { ...made("Parity", [{ when: { declared: true }, rules: ["parity"] }]), active: true, chosen: true };
  const base = planExchange(armed({ name: "Iron Sword" }), foe()).initiator.blows[0].damage;
  assert.equal(planExchange(armed({ name: "Iron Sword" }, { skills: [ring] }), foe()).initiator.blows[0].damage, base + 5);
  assert.equal(planExchange(armed({ name: "Iron Sword" }, { skills: [ring] }), foe({ skills: [parity] })).initiator.blows[0].damage, base);
});

test("an accessory's knacks are its unit's while it is worn", () => {
  const glove = worn("Thief Glove", "Unit can use the Steal action.");
  const ring = worn("Bargain Ring", "Unit receives a 25% discount in Shops. Stacks with the Bargain skill.");
  const knacks = skillKnacks([glove, ring], self);
  assert.equal(knacks.steals, true);
  assert.equal(knacks.skills.steals, "Thief Glove");
  assert.equal(knacks.discount, 25);
});

test("a Hoplon Guard keeps its wearer from critical hits, and a Full Guard from effective damage", () => {
  const sharp = { name: "Killing Edge", crit: 60 };
  const open = planExchange(armed(sharp, { stats: { dex: 20 } }), foe()).initiator;
  assert.ok(open.crit > 0);
  const hoplon = worn("Hoplon Guard", "Negates any critical hits against the unit with this item equipped.");
  assert.equal(planExchange(armed(sharp, { stats: { dex: 20 } }), foe({ skills: [hoplon] })).initiator.crit, 0);

  const slayer = { name: "Ridersbane", category: "lance", might: 7, effect: "Mounted" };
  const guard = worn("Full Guard", "Negates bonus damage against the unit with this item equipped.");
  assert.deepEqual(planExchange(armed(slayer), foe({ qualities: "Mounted" })).initiator.effective, ["Mounted"]);
  assert.deepEqual(planExchange(armed(slayer), foe({ qualities: "Mounted", skills: [guard] })).initiator.effective, []);
});

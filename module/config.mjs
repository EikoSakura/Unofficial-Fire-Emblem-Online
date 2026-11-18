/**
 * Static configuration for the Fire Emblem Online system.
 * Exposed at runtime as CONFIG.FEO.
 */
export const FEO = {};

/** The system id, matching system.json and the folder name. */
FEO.id = "fire-emblem-online";

/* -------------------------------------------- */
/*  Sides                                       */
/* -------------------------------------------- */

/** The side a unit fights for, which colours its sheet. A unit with no side set is coloured automatically. */
FEO.armies = {
  player: "FEO.Army.player",
  enemy: "FEO.Army.enemy",
  ally: "FEO.Army.ally",
  other: "FEO.Army.other"
};

/* -------------------------------------------- */
/*  Stats                                       */
/* -------------------------------------------- */

/**
 * Stats that have a base value and a boost, in sheet order.
 * HP is tracked separately as a resource; WT, CHA and INT are derived.
 */
FEO.stats = {
  str: { label: "FEO.Stat.str.label", abbr: "FEO.Stat.str.abbr" },
  mag: { label: "FEO.Stat.mag.label", abbr: "FEO.Stat.mag.abbr" },
  def: { label: "FEO.Stat.def.label", abbr: "FEO.Stat.def.abbr" },
  res: { label: "FEO.Stat.res.label", abbr: "FEO.Stat.res.abbr" },
  dex: { label: "FEO.Stat.dex.label", abbr: "FEO.Stat.dex.abbr" },
  spd: { label: "FEO.Stat.spd.label", abbr: "FEO.Stat.spd.abbr" },
  luk: { label: "FEO.Stat.luk.label", abbr: "FEO.Stat.luk.abbr" },
  mov: { label: "FEO.Stat.mov.label", abbr: "FEO.Stat.mov.abbr" },
  con: { label: "FEO.Stat.con.label", abbr: "FEO.Stat.con.abbr" },
  los: { label: "FEO.Stat.los.label", abbr: "FEO.Stat.los.abbr" }
};

/** Stats that have a growth rate, in sheet order. */
FEO.growths = {
  hp: "FEO.Stat.hp.abbr",
  str: "FEO.Stat.str.abbr",
  mag: "FEO.Stat.mag.abbr",
  def: "FEO.Stat.def.abbr",
  res: "FEO.Stat.res.abbr",
  dex: "FEO.Stat.dex.abbr",
  spd: "FEO.Stat.spd.abbr",
  luk: "FEO.Stat.luk.abbr",
  cha: "FEO.Stat.cha.abbr",
  int: "FEO.Stat.int.abbr"
};

/** Default growth rate for every stat, in percent. */
FEO.baseGrowth = 10;

/**
 * Charm and Intelligence are derived from one of three base stats.
 * The first entry of each list is the default.
 */
FEO.abilities = {
  cha: { label: "FEO.Stat.cha.label", abbr: "FEO.Stat.cha.abbr", sources: ["spd", "dex", "def"] },
  int: { label: "FEO.Stat.int.label", abbr: "FEO.Stat.int.abbr", sources: ["mag", "dex", "res"] }
};

/* -------------------------------------------- */
/*  Proficiency                                 */
/* -------------------------------------------- */

/** Proficiency ranks, lowest to highest. */
FEO.ranks = {
  F: "FEO.Rank.F",
  E: "FEO.Rank.E",
  D: "FEO.Rank.D",
  C: "FEO.Rank.C",
  B: "FEO.Rank.B",
  A: "FEO.Rank.A",
  S: "FEO.Rank.S",
  SS: "FEO.Rank.SS",
  STAR: "FEO.Rank.STAR"
};

/** Weapon experience needed to advance from each rank to the next. */
FEO.wexpToNext = {
  F: 45,
  E: 40,
  D: 60,
  C: 70,
  B: 80,
  A: 90,
  S: 100,
  SS: 250,
  STAR: null
};

/** Weapon types a unit tracks a proficiency rank in. */
FEO.proficiencies = {
  sword: "FEO.WeaponType.sword",
  lance: "FEO.WeaponType.lance",
  axe: "FEO.WeaponType.axe",
  bow: "FEO.WeaponType.bow",
  knife: "FEO.WeaponType.knife",
  brawl: "FEO.WeaponType.brawl",
  fire: "FEO.WeaponType.fire",
  thunder: "FEO.WeaponType.thunder",
  wind: "FEO.WeaponType.wind",
  water: "FEO.WeaponType.water",
  earth: "FEO.WeaponType.earth",
  light: "FEO.WeaponType.light",
  dark: "FEO.WeaponType.dark",
  staff: "FEO.WeaponType.staff"
};

/* -------------------------------------------- */
/*  Weapons                                     */
/* -------------------------------------------- */

/**
 * Weapon categories, as grouped in the reference sheet.
 * `proficiency` names the proficiency a category is wielded with, when it has one.
 * `ranged` marks bows and their kin and `magic` marks tomes: both lose a use on every attack rather than only
 * on a hit, and tomes are resisted with RES whatever stat they add to their Might.
 */
FEO.weaponCategories = {
  sword: { label: "FEO.WeaponType.sword", proficiency: "sword" },
  lance: { label: "FEO.WeaponType.lance", proficiency: "lance" },
  axe: { label: "FEO.WeaponType.axe", proficiency: "axe" },
  bow: { label: "FEO.WeaponType.bow", proficiency: "bow", ranged: true },
  crossbow: { label: "FEO.WeaponType.crossbow", proficiency: "bow", ranged: true },
  knife: { label: "FEO.WeaponType.knife", proficiency: "knife" },
  brawl: { label: "FEO.WeaponType.brawl", proficiency: "brawl" },
  bolt: { label: "FEO.WeaponType.bolt", proficiency: null, ranged: true },
  anima: { label: "FEO.WeaponType.anima", proficiency: null, magic: true },
  fire: { label: "FEO.WeaponType.fire", proficiency: "fire", magic: true },
  thunder: { label: "FEO.WeaponType.thunder", proficiency: "thunder", magic: true },
  wind: { label: "FEO.WeaponType.wind", proficiency: "wind", magic: true },
  water: { label: "FEO.WeaponType.water", proficiency: "water", magic: true },
  ice: { label: "FEO.WeaponType.ice", proficiency: "water", magic: true },
  earth: { label: "FEO.WeaponType.earth", proficiency: "earth", magic: true },
  light: { label: "FEO.WeaponType.light", proficiency: "light", magic: true },
  dark: { label: "FEO.WeaponType.dark", proficiency: "dark", magic: true },
  staff: { label: "FEO.WeaponType.staff", proficiency: "staff" },
  laguz: { label: "FEO.WeaponType.laguz", proficiency: null },
  manakete: { label: "FEO.WeaponType.manakete", proficiency: null },
  taguel: { label: "FEO.WeaponType.taguel", proficiency: null },
  monster: { label: "FEO.WeaponType.monster", proficiency: null }
};

/**
 * The proficiencies an Anima tome draws on. It is wielded at the highest of these ranks, and the weapon
 * experience it earns goes to every one of them the unit is proficient in.
 */
FEO.animaProficiencies = ["fire", "thunder", "wind", "water", "earth"];

/**
 * The three weapon types Magic falls into for a skill that is for one weapon type, as Weapon Focus is: each
 * with the words `weaponIs` knows it by. The Reference Sheet names kinds the system has no weapons for yet
 * (Astral, Scrolls, Magicite, Arcanima, Chaos); they are listed so that they count once it has.
 */
FEO.magicTypes = {
  anima: { label: "FEO.WeaponType.anima", kinds: ["anima"] },
  darkLight: { label: "FEO.WeaponType.darkLight", kinds: ["dark", "light", "astral"] },
  scrolls: { label: "FEO.WeaponType.scrolls", kinds: ["scroll", "magicite", "arcanima", "chaos"] }
};

/** The stat a weapon adds to its Might when dealing damage. */
FEO.damageStats = {
  str: "FEO.Stat.str.abbr",
  mag: "FEO.Stat.mag.abbr",
  spd: "FEO.Stat.spd.abbr",
  dex: "FEO.Stat.dex.abbr"
};

/* -------------------------------------------- */
/*  Combat Calculation Modes                    */
/* -------------------------------------------- */

/** Alternate formulas granted by skills, selected per unit. */
FEO.calcModes = {
  accuracy: {
    normal: "FEO.Calc.normal",
    bruteForce: "FEO.Calc.bruteForce",
    weaponFinesse: "FEO.Calc.weaponFinesse"
  },
  critical: {
    normal: "FEO.Calc.normal",
    fencersGrace: "FEO.Calc.fencersGrace"
  },
  dodge: {
    normal: "FEO.Calc.normal",
    parry: "FEO.Calc.parry"
  }
};

/** Flat bonuses applied on top of the combat formulas. */
FEO.combatBoosts = {
  hit: "FEO.Combat.hit",
  damage: "FEO.Combat.damage",
  critical: "FEO.Combat.critical",
  attackSpeed: "FEO.Combat.attackSpeed",
  dodge: "FEO.Combat.dodge",
  critAvoid: "FEO.Combat.critAvoid"
};

/* -------------------------------------------- */
/*  Affinity                                    */
/* -------------------------------------------- */

FEO.affinities = {
  fire: "FEO.Affinity.fire",
  thunder: "FEO.Affinity.thunder",
  wind: "FEO.Affinity.wind",
  water: "FEO.Affinity.water",
  dark: "FEO.Affinity.dark",
  light: "FEO.Affinity.light",
  ice: "FEO.Affinity.ice",
  anima: "FEO.Affinity.anima",
  heaven: "FEO.Affinity.heaven",
  earth: "FEO.Affinity.earth"
};

/**
 * The boosts each affinity grants per support level. ATK adds damage; END reduces damage taken. The Optional
 * Affinities add three more: Critical and Critical Avoid, HST (Haste), which counts as Attack Speed for making
 * a follow-up attack and for nothing else, and the Skill Activation rate.
 */
FEO.affinityBoosts = {
  fire: { atk: 1, hit: 2.5 },
  thunder: { end: 1, dodge: 2.5 },
  wind: { hit: 2.5, dodge: 2.5 },
  water: { atk: 1, end: 1 },
  dark: { atk: 1, dodge: 2.5 },
  light: { end: 1, hit: 2.5 },
  ice: { end: 2 },
  anima: { atk: 2 },
  heaven: { hit: 5 },
  earth: { dodge: 5 }
};

/**
 * The Optional Affinities of the Optional Modules, added to the affinities above when the world setting for
 * them is on. A unit keeps the one it was given while the setting is off, where it counts for nothing.
 */
FEO.optionalAffinities = {
  blade: "FEO.Affinity.blade",
  moon: "FEO.Affinity.moon",
  sun: "FEO.Affinity.sun",
  blood: "FEO.Affinity.blood",
  bone: "FEO.Affinity.bone",
  shield: "FEO.Affinity.shield",
  wood: "FEO.Affinity.wood",
  metal: "FEO.Affinity.metal",
  jewel: "FEO.Affinity.jewel",
  smoke: "FEO.Affinity.smoke",
  glass: "FEO.Affinity.glass",
  breath: "FEO.Affinity.breath",
  muscle: "FEO.Affinity.muscle",
  sinew: "FEO.Affinity.sinew",
  beast: "FEO.Affinity.beast",
  avian: "FEO.Affinity.avian",
  venom: "FEO.Affinity.venom",
  serum: "FEO.Affinity.serum",
  emblem: "FEO.Affinity.emblem",
  key: "FEO.Affinity.key",
  lock: "FEO.Affinity.lock",
  thorn: "FEO.Affinity.thorn",
  bloom: "FEO.Affinity.bloom",
  tome: "FEO.Affinity.tome",
  staff: "FEO.Affinity.staff",
  coin: "FEO.Affinity.coin",
  universe: "FEO.Affinity.universe"
};

/** The boosts each Optional Affinity grants per support level, in the keys of the boosts above. */
FEO.optionalAffinityBoosts = {
  blade: { critical: 3 },
  moon: { dodge: 2.5, critical: 1.5 },
  sun: { hit: 2.5, critical: 1.5 },
  blood: { atk: 1, critical: 1.5 },
  bone: { end: 1, critical: 1.5 },
  shield: { critAvoid: 3 },
  wood: { end: 1, critAvoid: 1.5 },
  metal: { atk: 1, critAvoid: 1.5 },
  jewel: { hit: 2.5, critAvoid: 1.5 },
  smoke: { dodge: 2.5, critAvoid: 1.5 },
  glass: { critical: 1.5, critAvoid: 1.5 },
  breath: { hst: 1.5 },
  muscle: { hst: 0.5, hit: 2.5 },
  sinew: { hst: 0.5, dodge: 2.5 },
  beast: { hst: 0.5, critical: 1.5 },
  avian: { hst: 0.5, critAvoid: 1.5 },
  venom: { hst: 0.5, atk: 1 },
  serum: { hst: 0.5, end: 1 },
  emblem: { activation: 3 },
  key: { activation: 1.5, hit: 2.5 },
  lock: { activation: 1.5, dodge: 2.5 },
  thorn: { activation: 1.5, critical: 1.5 },
  bloom: { activation: 1.5, critAvoid: 1.5 },
  tome: { activation: 1.5, atk: 1 },
  staff: { activation: 1.5, end: 1 },
  coin: { activation: 1.5, hst: 0.5 },
  universe: { hit: 1, dodge: 1, critical: 1, critAvoid: 1, activation: 1, end: 0.5, atk: 0.5, hst: 0.5 }
};

/** What each boost of an affinity is called where a support's bonuses are listed, in the order they are shown. */
FEO.supportBoosts = {
  atk: "FEO.Bond.atk",
  end: "FEO.Bond.end",
  hit: "FEO.Combat.hit",
  dodge: "FEO.Combat.dodge",
  critical: "FEO.Combat.critAbbr",
  critAvoid: "FEO.Combat.critAvoid",
  hst: "FEO.Bond.hst",
  activation: "FEO.Bond.activation"
};

/* -------------------------------------------- */
/*  Supports                                    */
/* -------------------------------------------- */

/** Support ranks and the level each one multiplies affinity boosts by. E is a starting point with no bonus. */
FEO.supportRanks = {
  E: { label: "FEO.SupportRank.E", level: 0 },
  D: { label: "FEO.SupportRank.D", level: 1 },
  C: { label: "FEO.SupportRank.C", level: 2 },
  B: { label: "FEO.SupportRank.B", level: 3 },
  A: { label: "FEO.SupportRank.A", level: 4 },
  S: { label: "FEO.SupportRank.S", level: 5 }
};

/** The radius, in spaces, within which support partners boost each other. */
FEO.supportRange = 3;

/* -------------------------------------------- */
/*  Weapon Triangle and Mastery                 */
/* -------------------------------------------- */

/**
 * For each weapon category in a triangle: the categories it beats and the categories it loses to.
 * Categories that are absent have neither advantage nor disadvantage.
 */
FEO.triangle = {
  sword: { beats: ["axe"], losesTo: ["lance"] },
  axe: { beats: ["lance"], losesTo: ["sword"] },
  lance: { beats: ["sword"], losesTo: ["axe"] },
  light: { beats: ["dark"], losesTo: ["anima"] },
  dark: { beats: ["anima"], losesTo: ["light"] },
  anima: { beats: ["light", "fire", "wind", "thunder"], losesTo: ["dark"] },
  fire: { beats: ["wind"], losesTo: ["water", "anima"] },
  wind: { beats: ["earth"], losesTo: ["fire", "anima"] },
  earth: { beats: ["thunder"], losesTo: ["wind"] },
  thunder: { beats: ["water"], losesTo: ["earth", "anima"] },
  water: { beats: ["fire"], losesTo: ["thunder"] }
};

/** Cumulative bonuses for mastering a weapon type. Staves follow their own table. */
FEO.mastery = {
  weapon: {
    S: { hit: 10, critical: 5, damage: 1 },
    SS: { hit: 20, critical: 5, damage: 3 },
    STAR: { hit: 20, critical: 10, damage: 3 }
  },
  staff: {
    S: { hit: 10 },
    SS: { hit: 20 },
    STAR: { hit: 20, critAvoid: 5 }
  }
};

/**
 * Weapon triangle bonuses to Hit and Damage, by the proficiency rank of the unit with advantage.
 * The unit at a disadvantage takes the same amounts as a penalty.
 */
FEO.triangleBonus = {
  F: { hit: 5, damage: 1 },
  E: { hit: 10, damage: 1 },
  D: { hit: 10, damage: 2 },
  C: { hit: 15, damage: 2 },
  B: { hit: 15, damage: 3 },
  A: { hit: 20, damage: 3 },
  S: { hit: 20, damage: 4 },
  SS: { hit: 30, damage: 4 },
  STAR: { hit: 40, damage: 5 }
};

/** A unit doubles a foe when its Attack Speed is at least this much higher. */
FEO.doubleThreshold = 4;

/** A critical hit multiplies final damage by this much. */
FEO.critMultiplier = 3;

/**
 * Special Qualities as they are written in weapon effects. A weapon whose Effect names a quality its target
 * has deals effective damage.
 */
FEO.specialQualities = [
  "Armored", "Mounted", "Dragon", "Flying", "Beast", "Laguz", "Ballistician", "Terror", "Bandit"
];

/** Effective damage multiplies a weapon's Might by this much, keyed by weapon category. */
FEO.effectiveMight = {
  default: 3,
  earth: 2
};

/** The icon drawn for each weapon category. */
FEO.categoryIcons = {
  sword: "sword", lance: "lance", axe: "axe", bow: "bow", crossbow: "bow", knife: "knife", brawl: "fist",
  bolt: "bow", anima: "tome", fire: "tome", thunder: "tome", wind: "tome", water: "tome", ice: "tome",
  earth: "tome", light: "tome", dark: "tome", staff: "staff", laguz: "claw", manakete: "claw",
  taguel: "claw", monster: "claw"
};

/**
 * Map Affinity: what a unit adds to its Hit and Dodge on a map whose Affinity is the same as its own.
 */
FEO.mapAffinity = { hit: 5, dodge: 5 };

/** The icon drawn for each affinity. */
FEO.affinityIcons = {
  fire: "flame", thunder: "bolt", wind: "wind", water: "drop", dark: "moon", light: "sun",
  ice: "snow", anima: "spark", heaven: "star", earth: "peak",

  // The Optional Affinities
  blade: "sword", moon: "crescent", sun: "sunrise", blood: "blood", bone: "bone", shield: "shield",
  wood: "tree", metal: "anvil", jewel: "gem", smoke: "smoke", glass: "glass", breath: "wave",
  muscle: "fist", sinew: "bow", beast: "paw", avian: "wing", venom: "fang", serum: "flask",
  emblem: "banner", key: "key", lock: "lock", thorn: "burst", bloom: "flower", tome: "tome",
  staff: "staff", coin: "coin", universe: "orbit"
};

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

FEO.skillKinds = {
  generic: "FEO.SkillKind.generic",
  class: "FEO.SkillKind.class",
  promotion: "FEO.SkillKind.promotion",
  occult: "FEO.SkillKind.occult",
  mastery: "FEO.SkillKind.mastery",
  misc: "FEO.SkillKind.misc",
  monster: "FEO.SkillKind.monster",
  enemy: "FEO.SkillKind.enemy"
};

/** Whether a skill can be put on a Skill Scroll, as the markers after its name on the reference sheet say. */
FEO.skillScrolls = {
  any: "FEO.SkillScroll.any",
  sameClass: "FEO.SkillScroll.sameClass",
  none: "FEO.SkillScroll.none"
};

/** The number of skills a unit may have equipped at once. */
FEO.skillSlots = 4;

/**
 * Skills that are chosen when to activate. A cooldown of N turns keeps a skill out of use for the unit's next
 * N turns: `cooldownExtra` is the turn start that passes before those turns are counted. Set it to 0 to have
 * a skill ready again on the unit's Nth turn after the one it was used in.
 */
FEO.skillUse = { cooldownExtra: 1 };

/**
 * Creatures that skills bring onto the map (see `module/rules/creatures.mjs`): how long whoever uses such a
 * skill has for what it has picked first, in milliseconds; how long the flash lasts in which a creature
 * appears, in milliseconds, 0 for none; and the step by which the growth rates of one that grows are assigned.
 */
FEO.creatures = { promptTime: 60000, flash: 450, growthStep: 5 };

/**
 * The weapon a summoned unit draws for its level, as the Phantom of the Class Sheet has it (see
 * `module/rules/summon.mjs`). A creature whose skill has its weapon drawn by level (`weapon: { draw: "level" }`,
 * see `module/rules/creatures.mjs`) fights with one of `categories`, and each time it is made it is handed one
 * weapon of that type, drawn with even odds from the `draws` of the last of `bands` its level has reached.
 * `weapons` names each draw by weapon type; a draw without a weapon of its type is left out.
 */
FEO.summon = {
  categories: ["sword", "lance", "axe"],
  weapons: {
    bronze: { sword: "Bronze Sword", lance: "Bronze Lance", axe: "Bronze Axe" },
    glass: { sword: "Glass Sword", lance: "Glass Lance", axe: "Glass Axe" },
    devil: { sword: "Devil Sword", lance: "Devil Lance", axe: "Devil Axe" },
    slim: { sword: "Slim Sword", lance: "Slim Lance", axe: "Slim Axe" },
    iron: { sword: "Iron Sword", lance: "Iron Lance", axe: "Iron Axe" },
    ironKukri: { sword: "Iron Kukri" },
    ironStrong: { sword: "Iron Blade", lance: "Iron Greatlance", axe: "Iron Poleax" },
    steel: { sword: "Steel Sword", lance: "Steel Lance", axe: "Steel Axe" },
    steelKukri: { sword: "Steel Kukri" },
    steelStrong: { sword: "Steel Blade", lance: "Steel Greatlance", axe: "Steel Poleax" },
    silver: { sword: "Silver Sword", lance: "Silver Lance", axe: "Silver Axe" },
    silverKukri: { sword: "Silver Kukri" },
    silverStrong: { sword: "Silver Blade", lance: "Silver Greatlance", axe: "Silver Poleax" },
    reach1: { sword: "Wind Edge", lance: "Javelin", axe: "Hand Axe" },
    reach2: { sword: "Storm Sword", lance: "Short Spear", axe: "Short Axe" },
    reach3: { sword: "Tempest Blade", lance: "Spear", axe: "Tomahawk" },
    killer: { sword: "Killing Edge", lance: "Killer Lance", axe: "Killer Axe" },
    quick: { sword: "Quick Sword", lance: "Quick Lance", axe: "Quick Axe" },
    reaver: { sword: "Lancereaver", lance: "Axereaver", axe: "Swordreaver" },
    brave: { sword: "Brave Sword", lance: "Brave Lance", axe: "Brave Axe" },
    slayer: { sword: "Lanceslayer", lance: "Axeslayer", axe: "Swordslayer" },
    meister: { sword: "Meisterschwert", lance: "Meisterlanze", axe: "Meisteraxt" }
  },
  bands: [
    { from: 1, draws: ["bronze", "glass", "devil", "slim", "iron"] },
    { from: 6, draws: ["devil", "glass", "iron", "ironKukri", "ironStrong", "reach1", "steel"] },
    { from: 11, draws: ["devil", "glass", "ironKukri", "ironStrong", "reach1", "reach2", "steel", "steelKukri", "steelStrong", "killer", "quick"] },
    { from: 16, draws: ["devil", "glass", "steelKukri", "steelStrong", "reach2", "silver", "killer", "quick"] },
    { from: 21, draws: ["devil", "glass", "silver", "silverKukri", "silverStrong", "reach3", "killer", "reaver", "brave"] },
    { from: 41, draws: ["devil", "glass", "silver", "silverKukri", "silverStrong", "reach3", "killer", "brave", "slayer", "meister"] }
  ]
};

/**
 * Who stands with whom, for skills that ask about allies and enemies near a unit. Sides with the same camp are
 * allies of each other, sides with different camps are enemies, and a side without a camp is neither to
 * anybody, its own units included.
 */
FEO.camps = { player: "player", ally: "player", enemy: "enemy", other: null };

/**
 * Skills that change the numbers of the units around their own.
 * `stack`: do two units with the same skill each give it to a unit that stands near both? When off, only the
 * nearest one does.
 * `inverted`: a unit with this condition gives its auras turned around, penalties for boosts.
 * `hidden`: do hidden tokens count as standing on the map?
 */
FEO.auras = { stack: true, inverted: "corrupt", hidden: false };

/**
 * Attacks that backfire, as those of Devil weapons do: an attack that lands has a chance of `base` less the
 * unit's `stat`, in percent, to damage its own unit instead of the target. A Devil weapon states its own
 * number in its Effect; `base` is for the skills that speak of the same chance, and for the unit that
 * suffers from `condition`.
 */
FEO.backfire = { base: 31, stat: "luk", condition: "bedevil" };

/**
 * The weapons that can damage a unit which only some weapons can. A weapon is considered Blessed when
 * `blessed`, a pattern, is found in its name or in its Effect: the Blessed weapons and the tome Blessing, and
 * any weapon the table writes "Blessed" into the Effect of. `nonBeorc` lists the weapon types that Laguz,
 * Manaketes and Taguel attack with.
 */
FEO.sacredWeapons = { blessed: "\\bbless(ed|ing)\\b", nonBeorc: ["laguz", "manakete", "taguel"] };

/** Weapons that are told apart by their name alone: what a monster's Eye weapons are called. */
FEO.namedWeapons = { eye: "\\beyes?\\b" };

/**
 * What a Special Quality builds into its unit: the skill of that name is given to a unit that has the quality,
 * and taken off again when the quality goes. It is listed among the skills for reference and takes no slot.
 */
FEO.qualitySkills = {
  Armored: "Rampart", Bandit: ["Greed", "Pillage"], Beast: "Rouse", Laguz: "Gregarious", Mounted: "Canto+", Flying: "Canto+", Ballistician: "Canto+"
};

/**
 * Canto+, as the rulebook has it for Mounted, Flying and Ballistician units: the Actions after which the unit
 * may move the rest of its movement (see `rules/canto.mjs`), and the skills used as an Action that it does not
 * follow. What "gains the effect of Canto+" without being the skill of that name reads it from here.
 */
FEO.cantoPlus = {
  after: ["attack", "item", "trade", "rescue", "refresh", "staff", "skill", "shift", "object", "visit", "arrive", "seize"],
  except: ["Hold", "Bastion"]
};

/**
 * Shove, the Action every unit has: it pushes a unit next to it `spaces` on, unless that unit's Weight is
 * above its own by `margin` or more (see `module/rules/forced.mjs`).
 */
FEO.shove = { margin: 3, spaces: 1 };

/**
 * Rescue, the Action every unit has: it picks up an ally next to it whose Weight is no more than its own, and
 * carries it (see `module/rules/rescue.mjs`). While it does, its stats are changed by the shares in `carry`;
 * a unit that carries a captive is slowed in the same way. A unit with a Special Quality in `barred` is never
 * picked up. `fade` is how long the token of a unit that is picked up takes to leave the map, in
 * milliseconds, and `badge` how large the portrait of a unit that is carried is drawn on its carrier's token,
 * as a share of a tile, with the colours of its ring for an ally and for a captive.
 */
FEO.rescue = {
  carry: { spd: -50, dex: -50 },
  barred: ["Ballistician"],
  fade: 250,
  badge: { size: 0.42, ally: 0x8FC7FF, captive: 0xE0705F }
};

/**
 * Stealing and loot (see `module/rules/stealing.mjs`). `gold` is what a unit that steals gold from a foe
 * takes where that foe carries none of its own; the world's setting of the same name stands in for it.
 * `discountMost` is the most the discounts of a unit's skills and gear take off a price together, in percent.
 * `bullion` is the item a skill that gives a Bullion gives, by its name on the Items tab. `ask` is how long,
 * in milliseconds, the Game Master is given to pick the item a skill takes from a fallen foe, and `pickTime`
 * how long the list of an enemy's pack stays open for a unit that Steals.
 */
FEO.stealing = { gold: 50, discountMost: 100, bullion: "Bullion", ask: 30000, pickTime: 60000 };

/**
 * Trading (see `module/rules/trading.mjs`). `pickTime` is how long, in milliseconds, the list of the two packs
 * stays open for a unit that Trades before it closes by itself.
 */
FEO.trading = { pickTime: 120000 };

/**
 * The things that stand on a map and that a unit can act on (see `module/rules/objects.mjs`): doors, chests
 * and Villages. `doors` are the kinds of door of the table in The Map, each with the HP it is broken down
 * through. `shut` is the terrain a shut door makes of its tile, and `standing` the one a Village that stands
 * does. `tints` are the colours each is drawn in.
 */
FEO.objects = {
  kinds: {
    door: { label: "FEO.Objects.kind.door", icon: "lock" },
    chest: { label: "FEO.Objects.kind.chest", icon: "chest" },
    village: { label: "FEO.Objects.kind.village", icon: "house" },

    // A mine or a trap of the Items tab, which is no thing a unit acts on: it lies hidden on its tile until
    // it is sprung, and is kept apart from the others (see rules/traps.mjs)
    trap: { label: "FEO.Objects.kind.trap", icon: "burst" }
  },
  doors: {
    wooden: { label: "FEO.Objects.door.wooden", hp: 25 },
    reinforcedWooden: { label: "FEO.Objects.door.reinforcedWooden", hp: 40 },
    iron: { label: "FEO.Objects.door.iron", hp: 50 },
    reinforcedIron: { label: "FEO.Objects.door.reinforcedIron", hp: 65 },
    portcullis: { label: "FEO.Objects.door.portcullis", hp: 80 },
    castle: { label: "FEO.Objects.door.castle", hp: 100 }
  },
  shut: "wall",
  standing: "house",
  tints: { door: 0xC9A66B, chest: 0xF2C14E, village: 0xE08A5A, trap: 0xE05A5A, spent: 0x8B8F9C }
};

/**
 * Moving a unit against its will: how long, in milliseconds, the map waits for the owner of a unit to pick a
 * tile for a step a skill says it "may" take once a fight is over, before it passes.
 */
FEO.forced = { promptTime: 30000 };

/**
 * Parity, the skill that cancels what terrain, supports, weapons, equipment and skills do in a fight: the kinds
 * of weapon whose effective damage comes with the kind and is not cancelled.
 */
FEO.parity = { inherent: ["bow", "crossbow", "bolt", "wind"] };

/**
 * What a unit chooses before a fight: how long, in milliseconds, the map waits for the owner of a unit that is
 * attacked to pick another weapon, where a skill lets it, before the fight goes on with the one in hand.
 */
FEO.choices = { promptTime: 20000 };

/**
 * Answers in the middle of a fight (see `rules/answers.mjs`): how long, in milliseconds, a fight waits for the
 * owner of a unit to take or leave what its skill offers, before it goes on as if it was left; whether the
 * units no player owns answer by themselves (the world setting "gmAnswers" sets it); and the share of the HP it
 * has left, in percent, that a hit must take for such a unit to keep it off or lessen it by itself.
 */
FEO.answers = { promptTime: 15000, alone: { enabled: true, share: 25 } };

/**
 * The rounds of a fight (see `rules/rounds.mjs`): the most a fight goes on for, whatever has it go on, and for
 * how many of them the dice are rolled before the fight is worked out (the rest are rolled as they are needed).
 */
FEO.rounds = { most: 50, rolled: 5 };

/**
 * What a staff does to its target, as a change that lasts on it (see `rules/timed.mjs`): a skill that inflicts
 * "the effect of" a staff grants that change, and so can the staff itself. Charm: its target becomes a neutral
 * unit for 3 of its turns, which attacks neither allies nor foes.
 */
FEO.staffChanges = {
  charm: { name: "Charm", effects: [{ rules: ["neutral", "noCombat"] }], ends: "turnEnd", turns: 3, next: true, now: true }
};

/**
 * What the staves of the Reference Sheet do beyond what their Effect is read for word by word (healing, healing
 * over turns, curing, conditions, damage, moving a unit: see `rules/staves.mjs`), by the name the sheet gives
 * them. Each part is one the system applies by itself:
 *
 *   change     a change that lasts on the unit the staff is used on, in the notation of a skill's `grant`
 *              (see `rules/timed.mjs`); a name of `FEO.staffChanges` for one that is written there
 *   cure       "all": the unit is cured of every condition
 *   clears     the changes that lower its stats, left on it by its enemies, are taken off it
 *   halves     its HP are halved, rounded down; `killAt`: with no more HP than this it is killed
 *   slays      it is killed outright if it has one of these Special Qualities, and nothing happens to any other
 *   drain      the share of the damage dealt that heals the user, in percent
 *   splash     the share of the damage taken that the user's enemies `within` so many tiles of the target take
 *   steals     the user takes one weapon or item out of its pack
 *   again      it is given another go this turn, with the movement named: at once if it has acted, and else
 *              once it has
 *   repairs    one weapon or Shield of its pack regains this share of its uses; "endless" takes its uses away
 *   unlocks    it opens a door or a chest within the staff's reach, in place of being used on a unit
 *   revives    it brings an ally that has fallen back, at full HP, next to its user, with its turn over
 *   text       what it does has no mechanic yet: it stays on the staff's card. With `on: "nobody"` it is
 *              used on no unit either
 */
FEO.staves = {
  Speed: { change: { effects: [{ stats: { spd: 3 } }], ends: "turnStart", clock: "giver" } },
  Strength: { change: { effects: [{ stats: { str: 3, mag: 3 } }], ends: "turnStart", clock: "giver" } },
  Haste: { change: { effects: [{ stats: { spd: 8, mov: 2 } }], ends: "turnStart", clock: "giver" } },
  Barrier: { change: { effects: [{ stats: { res: 1 } }], ends: "turnStart", stacks: 7, fades: true } },
  Ensorcel: { change: { effects: [{ stats: { mag: 1 } }], ends: "turnStart", stacks: 7, fades: true } },
  Defense: { change: { effects: [{ takenPercent: -50 }], ends: "turnStart", clock: "giver" } },
  Crest: { change: { effects: [{ combat: { activation: 15 } }], ends: "turnEnd", turns: 2 } },
  Empower: { change: { effects: [{ stats: { str: 3, mag: 3, dex: 3, spd: 3, luk: 3, def: 3, res: 3 } }], ends: "phaseEnd" } },
  Enfeeble: { change: { effects: [{ stats: { str: -3, mag: -3, dex: -3, spd: -3, luk: -3, def: -3, res: -3 } }], ends: "phaseEnd" } },
  Panic: { change: { effects: [{ bonuses: { times: -1 } }], ends: "phaseEnd" } },
  Freeze: { change: { effects: [{ rules: ["held"], combat: { dodge: -20 } }], ends: "turnStart", clock: "giver" } },
  Disarm: { change: { effects: [{ rules: ["noCounter"] }], ends: "turnEnd", turns: 3 } },
  Blind: { change: { effects: [{ combatTimes: { hit: 0.5 } }], ends: "turnStart", clock: "giver" } },
  Obscure: { change: { effects: [{ rules: ["untargetable"] }], ends: "turnStart", clock: "giver" } },
  Aid: { text: true },
  Charm: { change: "charm" },
  Kia: { cure: "all", change: { effects: [{ nullify: 100 }], ends: "map" } },
  "Ashera Staff": { change: { effects: [{ stats: { def: 5 } }], ends: "turnStart", clock: "giver" } },
  Clear: { clears: true },
  Hex: { halves: { killAt: 1 } },
  Expel: { slays: ["Terror"] },
  Absorb: { drain: 50 },
  Agony: { splash: { within: 1, percent: 50 } },
  Thief: { steals: true },
  Again: { again: { mov: "none" } },
  Anew: { again: { mov: "full" } },
  Repair: { repairs: 0.5, spares: ["Repair", "Hammerne", "Helarn"] },
  Hammerne: { repairs: 1, spares: ["Repair", "Hammerne", "Helarn"] },
  Helarn: { repairs: "endless", spares: ["Repair", "Hammerne", "Helarn"] },
  Unlock: { unlocks: ["door", "chest"] },
  Valkyria: { revives: true },
  Illume: { text: true, on: "nobody" },
  Watch: { text: true, on: "nobody" }
};

/** Holding a unit, as Death Grip does: how near the two must stand for the hold to last, in tiles. */
FEO.grip = { reach: 1 };

/** A unit that dodges every hit that would be fatal to it: the most the Hit of such an attack can be. */
FEO.fatalDodge = { hitCap: 99 };

/** The ways a skill that is chosen when to activate is used, and what its limited uses are counted per. */
FEO.skillUsage = {
  declare: "FEO.Usage.kind.declare",
  toggle: "FEO.Usage.kind.toggle",
  action: "FEO.Usage.kind.action",
  auto: "FEO.Usage.kind.auto"
};
FEO.skillPeriods = {
  turn: "FEO.Usage.per.turn",
  map: "FEO.Usage.per.map"
};

/** Stats a skill's activation chance may be based on. */
FEO.activationStats = {
  dex: "FEO.Stat.dex.abbr",
  luk: "FEO.Stat.luk.abbr",
  str: "FEO.Stat.str.abbr",
  mag: "FEO.Stat.mag.abbr",
  spd: "FEO.Stat.spd.abbr",
  def: "FEO.Stat.def.abbr",
  res: "FEO.Stat.res.abbr"
};

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

/**
 * Conditions a unit can suffer. Every number the condition rules use is kept here.
 *
 * `turns` is how many of the unit's own turns a condition lasts. Applying it again resets that, except for
 * conditions with `stacks`, where each application adds its turns up to `stacks.max` (null for no limit).
 * `countdown: false` keeps a condition from counting down by itself.
 *
 * While it lasts:
 * - `stats` and `combat` adjust stats and combat stats by a flat amount.
 * - `statLoss` lowers a stat by `perTurn` for each turn left, rounded down, and by at least `min`.
 * - `noMove`, `noAct` and `moveOrAct` say what the unit cannot do on its turn; `limits` is true for other
 *   limits that are only spelled out in the condition's reminder. These are reminders and block nothing.
 * - `noCounter` and `noDodge` stop the unit from counter-attacking or dodging.
 * - `blocks` names the weapons the unit cannot use: `magic` for every tome, `categories` for the rest.
 * - `ranged` adjusts the unit's Hit when it attacks from at least `from` tiles away.
 * - `hitCap` is the highest chance to hit the unit's attacks can have.
 *
 * At the start of each of the unit's turns:
 * - `tick` deals `percent` of maximum HP, plus `perTurn` percent for each turn the condition has left,
 *   rounded as `round` says.
 *
 * When the unit is attacked:
 * - `taken` adjusts the damage of attacks of an element, in the way Endurance does.
 * - `takenMultiplier.physical` multiplies the damage of attacks resisted with DEF, and `negates` lists the
 *   elements whose damage is reduced to nothing.
 * - `foeInitiating` is added to the Hit and Critical of a foe who initiates combat against the unit.
 * - `leech` is the share of damage taken, in percent, that heals the attacker.
 * - `chanceAgainst` raises the chance of weapons to inflict the listed conditions on the unit.
 * - `endsOnHit` ends the condition when the unit is hit by an attack of one of the listed kinds: `physical`,
 *   an element, or `any`.
 * - `burst` gives a hit of kind `on` that deals damage a chance of `chancePerTurn` percent for each turn left
 *   to inflict `inflicts`, push the unit back `push` tiles and end the condition.
 *
 * `aliases` are other names a weapon's Effect may use for the condition, and `combatOnly` marks a condition
 * that only lasts for the exchange it is inflicted in and is never kept on the unit.
 *
 * `around` is what a condition does to the allies of the unit that suffers it while they stand within
 * `within` spaces of it: `stats` they lose, and a `tick` of their own maximum HP they take once in each of
 * their turns, as it starts where they stand that near, or else as it ends. `name` is what it goes by among
 * their numbers.
 */
FEO.conditions = {
  stun: { img: "icons/svg/unconscious.svg", turns: 1, noMove: true, noAct: true, noCounter: true, noDodge: true },
  bind: { img: "icons/svg/net.svg", turns: 3, noMove: true },
  disable: { img: "icons/svg/paralysis.svg", turns: 2, noAct: true },
  bleed: {
    img: "icons/svg/blood.svg",
    turns: 5,
    combat: { critAvoid: -5 },
    tick: { percent: 10, round: "up" }
  },
  heavyBleed: {
    img: "icons/svg/degen.svg",
    turns: 5,
    combat: { critAvoid: -5 },
    tick: { percent: 30, round: "up" }
  },
  poison: {
    img: "icons/svg/poison.svg",
    turns: 5,
    combat: { hit: -10, dodge: -10 },
    tick: { percent: 10, round: "up" }
  },
  deepPoison: {
    img: "icons/svg/biohazard.svg",
    turns: 5,
    combat: { hit: -10, dodge: -10 },
    tick: { percent: 30, round: "up" }
  },
  rattled: {
    img: "icons/svg/terror.svg",
    turns: 1,
    stats: { str: -2, mag: -2, def: -2, res: -2, dex: -2, spd: -2, mov: -2 },
    limits: true
  },
  burn: {
    img: "icons/svg/fire.svg",
    turns: 1,
    stacks: { max: null },
    combat: { damage: -2 },
    tick: { percent: 10, perTurn: 1, round: "up" }
  },
  daze: { img: "icons/svg/daze.svg", turns: 1, moveOrAct: true },
  squall: {
    img: "icons/svg/windmill.svg",
    turns: 1,
    combat: { dodge: -10 },
    stats: { mov: -2 },
    ranged: { from: 2, hit: -15 }
  },
  damp: {
    img: "icons/svg/waterfall.svg",
    turns: 3,
    taken: { thunder: 4, fire: -4 },
    chanceAgainst: { freeze: 5, frostbite: 5, squall: 5 }
  },
  foam: { img: "icons/svg/acid.svg", turns: 3, stats: { spd: -2 }, leech: 25 },
  freeze: {
    img: "icons/svg/frozen.svg",
    turns: 2,
    noAct: true,
    takenMultiplier: { physical: 2 },
    negates: ["fire"],
    endsOnHit: ["physical", "fire"]
  },
  frostbite: {
    img: "icons/svg/ice-aura.svg",
    turns: 3,
    stats: { spd: -4, mov: -1 },
    tick: { percent: 10, round: "down" },
    endsOnHit: ["fire"]
  },
  tremor: {
    img: "icons/svg/stone-path.svg",
    turns: 1,
    stacks: { max: 20 },
    statLoss: { def: { perTurn: 0.5, min: 1 } },
    burst: { on: "physical", chancePerTurn: 5, inflicts: "rattled", push: 1 }
  },
  brighten: { img: "icons/svg/light.svg", turns: 2, foeInitiating: { hit: 15, critical: 5 } },
  darken: { img: "icons/svg/light-off.svg", turns: 2, combat: { hit: -15, critical: -5 } },
  sleep: {
    img: "icons/svg/sleep.svg",
    turns: 3,
    noMove: true,
    noAct: true,
    noCounter: true,
    noDodge: true,
    endsOnHit: ["any"]
  },
  silence: { img: "icons/svg/silenced.svg", turns: 4, blocks: { magic: true, categories: ["staff"] } },
  berserk: { img: "icons/svg/explosion.svg", turns: 3, limits: true },
  malaise: {
    img: "icons/svg/aura.svg",
    turns: 3,
    stats: { dex: -4, spd: -4 },
    tick: { percent: 10, round: "down" },
    around: { name: "Malaise", within: 3, stats: { dex: -2, spd: -2 }, tick: { percent: 10, round: "down" } }
  },
  petrification: {
    img: "icons/svg/statue.svg",
    turns: 5,
    combat: { critAvoid: -30 },
    stats: { def: 10 },
    noMove: true,
    noAct: true,
    noCounter: true,
    noDodge: true,
    aliases: ["Petrify"]
  }
};

/**
 * The Additional Conditions of the Optional Modules, added to the conditions above when the world setting for
 * them is on. Their durations, stacking and the few effects the system can apply are automatic; the rest of
 * each rule is shown as a reminder and left to the table.
 */
FEO.optionalConditions = {
  dazzle: { img: "icons/svg/sun.svg", turns: 1, noCounter: true, combatOnly: true },
  brand: { img: "icons/svg/fire-shield.svg", turns: 1, stacks: { max: 15 }, countdown: false, limits: true },
  sanction: { img: "icons/svg/hazard.svg", turns: 3, limits: true },
  boundary: { img: "icons/svg/circle.svg", turns: 3, limits: true },
  smoke: { img: "icons/svg/invisible.svg", turns: 1, stacks: { max: 10 }, limits: true },
  corrupt: { img: "icons/svg/radiation.svg", turns: 3, limits: true },
  oil: { img: "icons/svg/barrel.svg", turns: 3, limits: true },
  conduit: { img: "icons/svg/lightning.svg", turns: 3, limits: true },
  fear: { img: "icons/svg/wingfoot.svg", turns: 1, limits: true },
  sap: { img: "icons/svg/pill.svg", turns: 3, limits: true },
  misfortune: { img: "icons/svg/card-joker.svg", turns: 3, limits: true },
  confuse: { img: "icons/svg/stoned.svg", turns: 2, limits: true },
  blind: { img: "icons/svg/blind.svg", turns: 3, hitCap: 10 },
  beckon: { img: "icons/svg/walk.svg", turns: 2, noAct: true, limits: true },
  idiot: { img: "icons/svg/book.svg", turns: 3, limits: true },
  sedate: { img: "icons/svg/tankard.svg", turns: 3, limits: true },
  heavy: { img: "icons/svg/anchor.svg", turns: 2, limits: true },
  zombie: { img: "icons/svg/bones.svg", turns: 2, limits: true },
  feeble: { img: "icons/svg/downgrade.svg", turns: 2, limits: true },
  seduce: { img: "icons/svg/angel.svg", turns: 3, limits: true },
  bomb: { img: "icons/svg/trap.svg", turns: 3, limits: true },
  bedevil: { img: "icons/svg/cowled.svg", turns: 3, limits: true },
  disease: { img: "icons/svg/cancel.svg", turns: 3, limits: true },
  expose: { img: "icons/svg/target.svg", turns: 1, limits: true },
  squishy: { img: "icons/svg/falling.svg", turns: 2, limits: true },
  doom: { img: "icons/svg/skull.svg", turns: 3, limits: true },
  backfire: { img: "icons/svg/thrust.svg", turns: 1, limits: true },
  curse: { img: "icons/svg/eye.svg", turns: 2, limits: true },
  stop: { img: "icons/svg/padlock.svg", turns: 3, noMove: true, noAct: true },
  control: { img: "icons/svg/card-hand.svg", turns: 1, limits: true },
  oblivion: { img: "icons/svg/portal.svg", turns: 1, limits: true }
};

/**
 * The elements an attack can carry, which some conditions react to. A weapon's element is its category when
 * that is one of these, or the element its Effect names for the magic weapon triangle.
 */
FEO.attackElements = ["fire", "thunder", "wind", "water", "ice", "earth", "light", "dark"];

/* -------------------------------------------- */
/*  Health and Progression                      */
/* -------------------------------------------- */

/** Each Wound lowers maximum HP by this much. */
FEO.woundPenalty = 1;

/** Each Injury lowers maximum HP by this much. */
FEO.injuryPenalty = 2;

/** A Grave Wound is gained for every this many Wounds. */
FEO.woundsPerGraveWound = 5;

/** Stats lowered by 1, to a minimum of 1, for each Grave Wound. */
FEO.graveWoundStats = ["str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con"];

/** Experience needed to gain a level. */
FEO.expPerLevel = 100;

/** Levels at which Beorc promote instead of levelling normally. */
FEO.promotionLevels = [20, 40];

/** Stats that may carry a Boon or Bane. */
FEO.boonStats = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "con"];

/* -------------------------------------------- */
/*  Ability Checks                              */
/* -------------------------------------------- */

/**
 * Abilities and saving throws. The first entry of `stats` is the default; abilities with several
 * let the unit pick. `extra` names a further stat added in full.
 */
FEO.abilityChecks = {
  acrobatics: { group: "physical", stats: ["spd"] },
  athletics: { group: "physical", stats: ["str"] },
  disableDevice: { group: "physical", stats: ["dex"] },
  escapeArtist: { group: "physical", stats: ["dex"] },
  sleightOfHand: { group: "physical", stats: ["dex"] },
  stealth: { group: "physical", stats: ["spd"] },
  appraise: { group: "knowledge", stats: ["int"] },
  arcana: { group: "knowledge", stats: ["mag"] },
  craft: { group: "knowledge", stats: ["dex"] },
  engineering: { group: "knowledge", stats: ["int"] },
  geography: { group: "knowledge", stats: ["int"] },
  history: { group: "knowledge", stats: ["int"] },
  local: { group: "knowledge", stats: ["int"] },
  nature: { group: "knowledge", stats: ["int"] },
  nobility: { group: "knowledge", stats: ["int"] },
  medicine: { group: "knowledge", stats: ["int"] },
  profession: { group: "knowledge", stats: ["dex", "int", "cha"] },
  religion: { group: "knowledge", stats: ["int", "mag"] },
  survival: { group: "knowledge", stats: ["int"] },
  warfare: { group: "knowledge", stats: ["int", "dex"] },
  deception: { group: "social", stats: ["cha"] },
  diplomacy: { group: "social", stats: ["cha"] },
  handleAnimal: { group: "social", stats: ["cha"] },
  intimidate: { group: "social", stats: ["str", "mag", "cha"] },
  intuition: { group: "social", stats: ["cha"] },
  perception: { group: "social", stats: ["int"], extra: "los" },
  performance: { group: "social", stats: ["dex", "cha"] },
  endurance: { group: "saves", stats: ["def"] },
  reflex: { group: "saves", stats: ["spd"] },
  willpower: { group: "saves", stats: ["res"] }
};

FEO.abilityGroups = {
  physical: "FEO.AbilityGroup.physical",
  knowledge: "FEO.AbilityGroup.knowledge",
  social: "FEO.AbilityGroup.social",
  saves: "FEO.AbilityGroup.saves"
};

/* -------------------------------------------- */
/*  Classes and Promotion                       */
/* -------------------------------------------- */

/** Stats a class gives a starting value or a promotion gain for. Class Weight is kept apart from these. */
FEO.classStats = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con", "los"];

/**
 * Class tiers.
 * `promoteAt` is the level at which a unit of this tier promotes on its next level up, when its class promotes.
 * The rest describes promoting into the tier: `startLevel` is the level the unit becomes (`resetLevel` sets it
 * even when the unit is above it), `newRank` is the rank of newly gained proficiencies, `skill` names which of
 * the class's skills is learned, and `generic` allows a Generic Skill to be taken in its place.
 *
 * A tier may also say how a new unit of it starts apart from the rest. `noGeneric` marks a tier whose units start
 * without the Generic Skill every other unit starts with: they take one on promoting out of the tier, in place
 * of the skill their class started them with. `growthPoints` is the growth points they place freely, in place of
 * `FEO.creation.growth.free`, and `firstRank` the rank of the one proficiency that would start higher, in place
 * of `FEO.startingRanks.first`.
 */
FEO.classTiers = {
  trainee: { label: "FEO.Tier.trainee", order: 0, promoteAt: 10, noGeneric: true, growthPoints: 205, firstRank: "E" },
  base: { label: "FEO.Tier.base", order: 1, promoteAt: 20, startLevel: 1, resetLevel: true, newRank: "D", skill: "starting" },
  second: { label: "FEO.Tier.second", order: 2, promoteAt: 40, startLevel: 21, newRank: "D", skill: "promotion", generic: true },
  third: { label: "FEO.Tier.third", order: 3, startLevel: 41, newRank: "C", skill: "mastery" },
  heaven: { label: "FEO.Tier.heaven", order: 4, newRank: "B", skill: "promotion" }
};

/**
 * The peoples a class belongs to. Those marked `milestones` do not promote: they keep levelling and receive
 * the milestone gains below at each level where a Beorc would have promoted.
 */
FEO.races = {
  beorc: { label: "FEO.Race.beorc" },
  laguz: { label: "FEO.Race.laguz", milestones: true },
  manakete: { label: "FEO.Race.manakete", milestones: true },
  taguel: { label: "FEO.Race.taguel", milestones: true },
  monster: { label: "FEO.Race.monster" }
};

/** The levels at which a class that does not promote learns a skill, and which of its skills that is. */
FEO.milestoneLevels = { 21: "promotion", 41: "mastery" };

/** What a Laguz, Manakete or Taguel gains at each milestone level, on top of the growth increase. */
FEO.milestoneGains = { str: 2, mag: 2, def: 2, res: 2, dex: 2, spd: 2, luk: 2, mov: 1 };

/** The level at which a unit learns its Occult Skill without an Occult Scroll. */
FEO.occultLevel = 50;

/**
 * Growth rates on promotion: each of `stats` rises by `gain`. A player may instead spread that total as they
 * like, and move up to `reallocate` points of their existing growths, without taking a growth more than
 * `capBreak` above its cap.
 */
FEO.promotionGrowth = {
  stats: ["hp", "str", "mag", "def", "res", "dex", "spd", "luk"],
  gain: 5,
  reallocate: 40,
  capBreak: 5
};

/** The highest a growth rate may be set to at character creation, in percent. */
FEO.growthCaps = { default: 60, hp: 80 };

/** How far a Boon raises, and a Bane lowers, the cap of its stat. */
FEO.boonCap = { default: 2, hp: 5, luk: 5 };

/** The ranks a new unit's class proficiencies start at: one of the player's choice, then every other. */
FEO.startingRanks = { first: "D", others: "E" };

/**
 * Character creation, as the "Character Creation" tab of the rules gives it. A GM may tailor these to a
 * campaign.
 *
 * `gold` is what every unit starts with to buy equipment. `bonus` is the bonus points: how many there are, how
 * far they may raise one of `stats` (`perStat`), and the `costly` stats that take `cost` of them for each point
 * they rise. `growth` is the growth points on top of what every rate starts at: `free` to place anywhere and
 * `abilities` that may only go to Charm or Intelligence, in steps of `step`. `weight` is how far Class Weight may
 * be raised or lowered. `boon` is what a Boon adds to its stat and its growth rate, and a Bane takes away: 1 to
 * the stat, or `doubledBy` to the `doubled` ones. `savePoints` are the ability points that may only be spent on
 * saving throws, and `pointsPer` the ability points for each point of the higher of Charm and Intelligence.
 */
FEO.creation = {
  gold: 1500,
  bonus: {
    points: 5,
    perStat: 2,
    stats: ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "con", "cha", "int"],
    costly: ["hp", "luk"],
    cost: 2
  },
  growth: { free: 245, abilities: 25, step: 5 },
  weight: 3,
  boon: { growth: 5, doubled: ["hp", "luk"], doubledBy: 2 },
  pointsPer: 5,
  savePoints: 5
};

/* -------------------------------------------- */
/*  Experience                                  */
/* -------------------------------------------- */

/**
 * Experience awards, as the EXP tab of the rules gives them.
 *
 * `combat` is read by the gap between the unit's level and its foe's (the unit's level minus the foe's), which
 * is held between `gap.min` and `gap.max`: `kill` for defeating the foe, `hit` for a combat in which the unit
 * dealt damage. `pity` goes to a unit that could attack but dealt no damage.
 * `armies` lists the sides whose units earn experience.
 * A unit counts as promoted, for the staff and skill tables, from `promotedLevel` on.
 * In `staves` and `skills` each row lists the names it covers and what an unpromoted and a promoted unit earn;
 * null means the row gives that kind of unit nothing. `perTerror` is added for each Terror a staff slays.
 */
FEO.exp = {
  armies: ["player"],
  gap: { min: -6, max: 6 },
  combat: {
    kill: { "-6": 59, "-5": 57, "-4": 53, "-3": 47, "-2": 41, "-1": 35, "0": 30, "1": 25, "2": 19, "3": 13, "4": 7, "5": 3, "6": 1 },
    hit: { "-6": 20, "-5": 19, "-4": 18, "-3": 16, "-2": 14, "-1": 12, "0": 10, "1": 8, "2": 6, "3": 4, "4": 2, "5": 1, "6": 0 }
  },
  pity: 1,
  promotedLevel: 21,
  itemOnAlly: 10,
  staves: [
    { names: ["Treat", "Celestia"], unpromoted: 7, promoted: 4 },
    { names: ["Soothe"], unpromoted: 10, promoted: 5 },
    { names: ["Heal", "Bloom Festal", "Star Festal", "Refresh", "Balmwood", "Push"], unpromoted: 11, promoted: 5 },
    { names: ["Mend", "Sun Festal", "Remedy", "Reanimate", "Etemmu"], unpromoted: 14, promoted: 7 },
    { names: ["Illume"], unpromoted: 15, promoted: 7 },
    { names: ["Venom", "Pain", "Misfortune", "Rejuvenate"], unpromoted: 16, promoted: 8 },
    { names: ["Unlock", "Barrier", "Ensorcel", "Speed", "Strength", "Renew"], unpromoted: 17, promoted: 8 },
    { names: ["Confuse"], unpromoted: 18, promoted: 9 },
    { names: ["Repair", "Restore", "Absorb", "Clear", "Bind"], unpromoted: 20, promoted: 10 },
    { names: ["Expel"], unpromoted: 20, promoted: 10, perTerror: 5 },
    { names: ["Assault", "Revive"], unpromoted: 21, promoted: 10 },
    { names: ["Physic", "Wane Festal"], unpromoted: 22, promoted: 11 },
    { names: ["Freeze", "Inaction", "Heavy", "Bomb"], unpromoted: 25, promoted: 12 },
    { names: ["Catharsis", "Regenerate"], unpromoted: 26, promoted: 13 },
    { names: ["Panic", "Recover", "Moon Festal", "Agony", "Silence", "Blind", "Disarm", "Sedate"], unpromoted: 30, promoted: 15 },
    { names: ["Return", "Charm", "Defense", "Sleep", "Disturb", "Crest"], unpromoted: 35, promoted: 17 },
    { names: ["Rescue", "Hammerne", "Enfeeble", "Empower", "Entrap", "Hex", "Thief", "Haste", "Zombie"], unpromoted: 40, promoted: 20 },
    { names: ["Nightmare", "Aid", "Obscure"], unpromoted: 45, promoted: 22 },
    { names: ["Anew", "Kia", "Berserk", "Petrify", "Miswarp", "Rewarp", "Stop"], unpromoted: 50, promoted: 25 },
    { names: ["Fortify", "Great Festal", "Reinforce", "Again", "Doom"], unpromoted: 60, promoted: 30 },
    { names: ["Warp"], unpromoted: 85, promoted: 42 },
    { names: ["Valkyria", "Helarn", "Latona", "Ashera Staff"], unpromoted: 100, promoted: 100 }
  ],
  skills: [
    { names: ["Salve"], unpromoted: 5, promoted: 5 },
    { names: ["Refresh", "Thievery", "Apothecary", "Perform"], unpromoted: 10, promoted: 10 },
    {
      names: ["Imitate", "Summon", "Cheer", "Jeer", "Provoke", "Zugzwang", "Bubble", "Pixie Dust", "Eye of Bale",
        "Loving Embrace", "Loving Embace"],
      unpromoted: 10,
      promoted: 5
    },
    { names: ["Harsh Command", "Howl", "Wildkin", "Sacrifice", "Spirit Call", "Conjure"], unpromoted: null, promoted: 5 },
    { names: ["Benediction"], unpromoted: null, promoted: 15 }
  ]
};

/**
 * What skills change about what a unit earns.
 * `expStack`: how several experience multipliers combine. "multiply" applies one after the other (1.25x and
 * doubled make 2.5x); "add" adds their extras up (+25% and +100% make 2.25x). Either way the result is rounded
 * down once, after all of them.
 * `goldPerGain`: what counts as one stat increase for a skill that pays for each at a level up: "stat" for
 * every stat that rose, "point" for every point gained (a growth rate above 100% can give two).
 * `levelsApart`: the most levels two units are taken to be apart, which bounds the gold a skill that pays by
 * the levels between its unit and the foe may hand out for one kill.
 */
FEO.earnings = {
  expStack: "multiply",
  goldPerGain: "stat",
  levelsApart: 60
};

/* -------------------------------------------- */
/*  Defeat                                      */
/* -------------------------------------------- */

/**
 * The Incapacitation system of the Death tab.
 *
 * `enabled` follows the world setting of the same name. With it off every unit is simply defeated at 0 HP.
 * `armies` lists the sides whose units go down and choose their fate; a unit of any other side is simply
 * defeated at 0 HP. A unit that is dead or has retreated leaves the map, its token fading over `fade`
 * milliseconds.
 * A single hit of maximum HP ÷ `woundDivisor` or more causes a Wound.
 * A unit brought to 0 HP is Incapacitated for the higher of the `resilience.checks` ÷ `resilience.divisor`
 * turns, less `perGraveWound` for each Grave Wound. The same number is taken off damage past 0 HP.
 * A unit must choose between retreat and death at `injuryLimit` Injuries, when its HP is `deathMultiplier`
 * times its maximum HP below zero, or when its turns run out.
 * `treat` holds the Medicine checks that heal Wounds and Injuries: the base target number, what each Wound or
 * Injury adds to it, and the experience the healer earns for each one healed. One is healed for every
 * `perMedicine` points of the healer's Medicine.
 * `states` are what a unit can be once it is out of the fight; `status` is the token status shown while a unit
 * is Incapacitated. `captured` is only ever reached with the Capturing module.
 */
FEO.defeat = {
  enabled: true,
  armies: ["player"],
  woundDivisor: 1.5,
  deathMultiplier: 3,
  injuryLimit: 5,
  resilience: { checks: ["endurance", "willpower"], divisor: 10 },
  perGraveWound: 1,
  treat: {
    check: "medicine",
    perMedicine: 10,
    wounds: { dc: 60, perCount: 5, exp: 5 },
    injuries: { dc: 70, perCount: 5, exp: 10 }
  },
  states: ["incapacitated", "retreated", "dead", "captured"],
  status: { id: "incapacitated", img: "icons/svg/falling.svg" },
  fade: 600
};

/* -------------------------------------------- */
/*  Weapon Handling                             */
/* -------------------------------------------- */

/**
 * Shield Block (see `rules/blocking.mjs`). `broken` is what a Shield turns into when it runs out of uses, as
 * the Items tab of the Reference Sheet words the Broken Shield; it never wears out, and remembers what it was
 * so that it can be repaired for its price. `sound` is played when a hit is blocked.
 */
FEO.blocking = {
  broken: {
    name: "Broken Shield",
    effect: "Has a 15% chance to block physical attacks, reducing them by 1. Adds 5 Weight during Attack Speed calculation."
  },
  sound: "sounds/doors/metal/test.ogg"
};

/* -------------------------------------------- */

/**
 * Skill cut-ins (see `rules/cut-ins.mjs`): as a skill takes effect its icon and name flash over its unit.
 * `speeds` is how long one stays, in milliseconds, by what a user asks for; `most` is how many may wait their
 * turn before those waiting are shown together, and `names` how many skills one of them names before it only
 * counts the rest. `sounds` are the sounds that come with Foundry which a world may pick from, `sound` the one
 * it has unless it picks, and `volume` how loud it is played beside the interface's other sounds. `icon` is
 * shown for a skill that has none.
 */
FEO.cutIns = {
  speeds: { fast: 320, normal: 560 },
  speed: "normal",
  most: 3,
  names: 3,
  sounds: {
    spark: "sounds/doors/futuristic/test-forcefield.ogg",
    magic: "sounds/doors/magic/test.ogg",
    chime: "sounds/notify.wav",
    hit: "sounds/combat/epic-turn-1hit.ogg",
    lock: "sounds/lock.wav"
  },
  sound: "spark",
  volume: 0.6,
  icon: "icons/svg/aura.svg"
};

/**
 * What becomes of a weapon that runs out of uses, and what repairs cost.

 *
 * `rankCheck` stops a unit from equipping a weapon above its proficiency rank outside Edit mode.
 * `unequipOnBreak` follows the note on the weapon reference sheet; the Book of Stipulations instead lets a
 * unit keep its broken weapon in hand, which is what false gives.
 * `broken` gives, by weapon category, the broken version a weapon turns into, with the numbers of the Broken
 * Weapons table. `magic` covers every tome. A category with no entry keeps its numbers and is only marked
 * broken.
 */
FEO.weapons = {
  rankCheck: true,
  unequipOnBreak: true,
  broken: {
    axe: { name: "Broken Axe", might: 0, hit: 30, crit: 0, range: "1", weight: 20, wexp: 1, effect: "" },
    brawl: { name: "Broken Gauntlets", might: 0, hit: 30, crit: 0, range: "1", weight: 15, wexp: 1, effect: "" },
    lance: { name: "Broken Lance", might: 0, hit: 30, crit: 0, range: "1", weight: 18, wexp: 1, effect: "" },
    bow: { name: "Broken Bow", might: 0, hit: 30, crit: 0, range: "2", weight: 16, wexp: 1, effect: "" },
    crossbow: { name: "Broken Crossbow", might: 0, hit: 30, crit: 0, range: "1", weight: 18, wexp: 1, effect: "" },
    sword: { name: "Broken Sword", might: 0, hit: 30, crit: 0, range: "1", weight: 17, wexp: 1, effect: "" },
    knife: { name: "Broken Knife", might: 0, hit: 30, crit: 0, range: "1", weight: 15, wexp: 1, effect: "" },
    staff: {
      name: "Broken Staff", might: 0, hit: 30, crit: 0, range: "1", weight: 15, wexp: 1,
      effect: "Combat can be initiated with staff even if user does not have Staff Training."
    },
    magic: {
      name: "Drained Tome", might: 0, hit: 30, crit: 0, range: "1", weight: 15, wexp: 1, effect: "STR not MAG.",
      damageStat: "str"
    }
  }
};

/* -------------------------------------------- */
/*  Support Points                              */
/* -------------------------------------------- */

/**
 * How supports grow. `method` follows the world setting of the same name:
 * - `manual`: the Game Master raises ranks by hand.
 * - `chapters`: a point for every battle two partners are fielded in together. Points are never reset, and a
 *   rank is reached at the totals in `chapters.thresholds`.
 * - `points`: points for what partners do together, as listed in `events`. A rank is gained at `points.perRank`
 *   and the points start again from what is left over.
 * `topRankLimit` is how many supports of the highest rank a unit may hold: one A+ and one S.
 * `bondStart` is the rank a Bond Support begins at, and `bondAdjacent` what its partners gain side by side.
 * `fightRange` is how close a partner must be for a fight to earn points.
 */
FEO.supports = {
  method: "chapters",
  methods: {
    manual: "FEO.Support.method.manual",
    chapters: "FEO.Support.method.chapters",
    points: "FEO.Support.method.points"
  },
  chapters: { perBattle: 1, thresholds: { D: 2, C: 5, B: 10, A: 15, S: 20 } },
  points: { perRank: 80 },
  events: {
    adjacent: 4,
    shove: 2,
    assist: 6,
    rescue: 5,
    fight: 5,
    chapter: 10
  },
  fightRange: 2,
  topRankLimit: 2,
  bondStart: "D",
  bondAdjacent: { hit: 10, dodge: 10, critical: 5 }
};

/* -------------------------------------------- */
/*  The Base                                    */
/* -------------------------------------------- */

/**
 * The Base, where the company rests between battles, as the Off the Map section of the rules gives it.
 *
 * `posts` are the places to visit there, in the order they are listed; the camp itself is never shut.
 * `limit` is how many units may march to a battle until the Game Master says otherwise.
 * `forge`: each of `stats` can be raised or lowered by its `step` up to `max` times, each increment costing
 * `cost` more than the last; weapons of the `barred` categories cannot be forged.
 * `spar`: how many `bouts` a unit may fight before the next battle, and what the `loser` earns on top.
 * `buyMost` is the most of one ware that can be bought at once.
 * `wares` are the groups a ledger lists weapons and items under, with the icon of each; `stock` are the
 * categories a stall is filled from when the Game Master asks for arms, staves or supplies.
 * `stalls` are the shops a new Base opens with.
 */
FEO.base = {
  posts: {
    camp: { icon: "tent" },
    roster: { icon: "company" },
    convoy: { icon: "chest" },
    market: { icon: "coin" },
    forge: { icon: "anvil" },
    supports: { icon: "heart" },
    training: { icon: "crossed" },
    board: { icon: "scroll" }
  },
  limit: 8,
  forge: {
    stats: { might: { step: 1 }, hit: { step: 5 }, crit: { step: 3 }, weight: { step: 1 } },
    max: 5,
    cost: 150,
    barred: ["staff", "laguz", "manakete", "taguel"]
  },
  spar: { bouts: 3, loser: 10 },
  buyMost: 9,
  wares: {
    sword: "sword", lance: "lance", axe: "axe", bow: "bow", knife: "knife", brawl: "fist", tome: "tome",
    staff: "staff", other: "claw", item: "flask"
  },
  stalls: [
    { key: "armory", icon: "sword" },
    { key: "vendor", icon: "flask" }
  ]
};

/* -------------------------------------------- */
/*  Shifting                                    */
/* -------------------------------------------- */

/**
 * Laguz, Manakete and Taguel.
 *
 * `modes` are the two ways of changing form: a Shift Gauge, or a stone that transforms its bearer for each
 * combat a limited number of times a turn. `byRace` says which one the units of a people use.
 * While transformed, each of `stats` is its base value times (100 + `percent`)%, rounded down after boosts are
 * added. `percents` are the amounts the character sheet offers; `allyBonus` is added for a Manakete or Taguel
 * that started its turn beside another Non-Beorc ally.
 * `gauge`: the most it holds, what a unit needs to Shift, and what later combats in the same phase change it by.
 * `notes` are the labels a class block uses for a tribe's gauge values, which a unit can override.
 * `stone.uses` is how many times a turn a stone transforms its bearer.
 * `humanWeapon` is what a unit fights with in humanoid form, and `weaponCategories` what it wields transformed.
 */
FEO.shift = {
  modes: { gauge: "FEO.Shift.mode.gauge", stone: "FEO.Shift.mode.stone" },
  byRace: { laguz: "gauge", manakete: "stone", taguel: "stone" },
  stats: ["str", "mag", "def", "res", "dex", "spd"],
  percent: 50,
  percents: [15, 25, 35, 45, 50, 60],
  allyBonus: 10,
  gauge: { max: 30, shiftAt: 20, laterCombat: 1 },
  notes: {
    start: "Starting Shift Gauge",
    turnHuman: "Shift Modifier Per Turn (Humanoid)",
    turnAnimal: "Shift Modifier Per Turn (Animal)",
    combatHuman: "Shift Modifier Per Combat (Humanoid)",
    combatAnimal: "Shift Modifier Per Combat (Animal)"
  },
  stone: { uses: 4 },
  humanWeapon: "Fists",
  weaponCategories: ["laguz", "manakete", "taguel"]
};

/* -------------------------------------------- */
/*  Optional Modules                            */
/* -------------------------------------------- */

/**
 * The world setting that switches each of these Optional Modules on, and the entry of the modules below it
 * belongs to. A module with `modes` is a choice between them rather than a plain switch.
 */
FEO.optionalSettings = {
  optionalAffinities: "affinities",
  affinityEffects: "affinityEffects",
  additionalLives: "lives",
  additionalGrowths: "growths",
  movementStars: "movementStars",
  holyBlood: "holyBlood",
  crests: "crests",
  heartSeals: "heartSeals",
  glory: "glory",
  manualGains: "manualGains",
  weaponLevel: "weaponLevel",
  skillCapacity: "skillCapacity",
  alternateActivation: "alternateActivation",
  combatArts: "combatArts",
  battalions: "battalions",
  breaking: "breaking",
  capturing: "capturing",
  stagger: "stagger",
  staffPassives: "staffPassives",
  healCriticals: "healCriticals",
  doubleCast: "doubleCast",
  staffMissing: "staffMissing",
  followUpCritical: "followUpCritical",
  leadership: "leadership",
  weaponKills: "weaponKills",
  levelCap: "levelCap"
};

/**
 * The world settings gathered in the Optional Rules menu of the system settings, group by group, in the order
 * they are listed there. They are kept out of the main list of settings.
 */
FEO.settingsMenu = {
  play: ["incapacitation", "supportMethod"],
  characters: ["optionalAffinities", "affinityEffects", "additionalLives", "additionalGrowths", "holyBlood", "crests", "heartSeals", "glory", "manualGains", "weaponLevel", "skillCapacity", "alternateActivation", "levelCap"],
  combat: ["combatArts", "battalions", "breaking", "additionalConditions", "capturing", "stagger", "staffPassives", "healCriticals", "doubleCast", "staffMissing", "followUpCritical", "movementStars", "leadership", "weaponKills"]
};

/** The growth rate the Weapon Level module adds to the growth rates above when the world uses it. */
FEO.weaponLevelGrowth = {
  wlv: "FEO.Stat.wlv.abbr"
};

/** The growth rates the Additional Growth Rates module adds to the growth rates above when the world uses it. */
FEO.optionalGrowths = {
  con: "FEO.Stat.con.abbr",
  mov: "FEO.Stat.mov.abbr"
};

/**
 * The Optional Modules that are a world setting and a few fields on the unit. `enabled` follows the setting.
 *
 * `affinities` (Optional Affinities): the affinities of `FEO.optionalAffinities` can be chosen, and give
 * supports the boosts of `FEO.optionalAffinityBoosts`.
 *
 * `affinityEffects` (Additional Affinity Effects): every unit gains the innate effect of its Affinity, for
 * itself only. `effects` holds them in the notation of skill effects (see `module/rules/skills.mjs`), and each
 * unit carries its own as one more skill, named after its Affinity. Their chances are `fixed`: they are no
 * skills, so the Skill Activation rate does not change them. An Affinity with an empty list is left to the
 * table entirely; an effect that only reminds is announced or listed for the table to apply:
 * - Wind, Bone and Beast keep what a dodge gives them until their unit's next turn starts.
 * - What Dark and Light put on a foe lasts through the foe's next turn, and counts at once in the same fight.
 * - Thorn's 1d2 is 1 damage, and 1 more half of the time.
 * - Sinew counts the hits its unit takes in fights it did not start, and restores that much HP as its next
 *   turn starts. Staff heals one ally next to its unit, picked by a die, for each hit that deals damage.
 *   Shield adds to the Block chance of a Shield and to what its blocks take off (see `blocking.mjs`).
 * - Avian is a move of one space after any Action, onto any tile next to its unit that it can stand on.
 *
 * `usage` holds the Affinities their unit chooses when to use, as a skill says how it is used (see
 * `module/rules/skill-usage.mjs`). Each is switched on from the unit's sheet or the Battle HUD, and its state is
 * kept on the unit. `spentBy` says what spends it: a "fight" its declared effect had a say in, as Anima; a
 * "move" that made use of it, as Wood (a move over terrain that would have cost more, or a turn ended on a
 * tile that takes something off its unit) and Breath (an attack from a tile only the extra space reached); or a
 * "shove" that needed it, as Muscle. One that is switched on and not used by the end of its unit's turn is
 * switched off again, and has no cooldown.
 *
 * `activationExp` is the experience an Affinity gives its unit each time one of that unit's own Skills rolls
 * to activate and does, by what the Skill divides its stat by. `cooldown` is what an Affinity takes off the
 * cooldown of one skill its unit chooses, kept on the unit as `affinitySkill`.

 * `ranks` holds the Affinities that give a rank in a proficiency of their unit's choice: `steps` ranks in one
 * of `options`. The choice is kept on the unit, and the rank is given like one a skill gives (see
 * `module/rules/skill-ranks.mjs`): once, and taken back when the choice or the Affinity changes.
 *
 * `lives` (Additional Lives): the sides in `armies` start with `start` lives; a unit of any side has them when
 * a total is typed on its sheet. A unit that would die loses a life and leaves the battle instead, and is dead
 * once it has none left. `promotion` is what promoting adds to the total and restores; `revive` is the lives a
 * unit brought back from death returns with.
 *
 * `growths` (Additional Growth Rates): `caps` are the highest the CON and MOV growth rates count for, in
 * percent, and `statCaps` the caps of the stats themselves where neither the class nor the sheet gives one.
 *
 * `movementStars`: each star is `perStar` percent to act again after an action, for up to `max` stars.
 *
 * `holyBlood`: each lineage gives `growths` (percent added to growth rates) and one more rank in the `rank`
 * proficiency. Major blood multiplies the growths by `majorMultiplier` and sets the rank to `majorRank`; Minor
 * blood raises it by `minorRanks`.
 *
 * `crests`: the chance of each Crest to activate, in percent, for Major and Minor bearers. `custom` is the
 * choice for a Crest of the table's own making, whose name, effect and chance are typed on the sheet.
 *
 * `heartSeals` (Heart Seals/Reclassing): a new unit chooses `picks` classes which, with the class it starts
 * in, are its Heart Seal Classes. It can reclass into the line of any of them, at the tier it is in. A player
 * spends an item named `item` to do so, where the unit carries one; the Game Master needs none. Reaching the
 * support rank `supportRank` with a partner lets a unit add one of the partner's Heart Seal Classes to its own.
 *
 * `glory` (Glory): the unit that brings down a unit with Glory to give gains that much, to spend on Powers.
 * Each of `powers` has its `cost` and what it does: `effects` in the notation of skill effects (see
 * `module/rules/skills.mjs`), which its unit carries as one more skill named after the Power; `stars`, Movement
 * Stars added to its own; `afflict`, what is added to its chances of inflicting conditions (`amount` for all of
 * them, `more` for those listed); and `resonance`, which gives it the boosts of its own Affinity at all times
 * and its Additional Affinity Effect. A Power with none of these is left to the table entirely, one whose
 * effects only remind is announced or listed in a fight, and one marked `partly` leaves a part of what it says
 * to the table.
 *
 * `manualGains` (Manual Stat Gains): a level up gives `points` to place on stats in place of the growth rolls,
 * one to a stat. The stats in `all` take every point there is. In the `open` reading growth rates are still
 * rolled, and a stat whose rate came up may take a second point; in the `double` reading such a stat rises by
 * two for its one point. In those two readings a new unit has `growthPoints` to assign as it likes, in place of
 * the usual amount. `mode` follows the world setting.
 *
 * `weaponLevel` (Weapon Level): a unit has a Weapon Level in place of rising ranks. It starts at `start`, grows
 * by a growth rate of its own that is held to `growthCap`, and stops at `cap`. In every weapon type it has a
 * rank in at all, the unit wields the weapons whose own Weapon Level is no higher than its own, and its
 * proficiencies earn no weapon experience once they are past the lowest rank. `ranks` is the Weapon Level from
 * which a unit counts as having each rank, for what goes by rank: the bonuses for mastering a weapon type,
 * which the rulebook sets at 20 and 25, and the weapon triangle, for which the rest are the levels at which
 * most weapons of each rank on the Reference Sheet can be wielded. `perRank` is what a skill that lets a unit
 * wield a rank above its own is worth in Weapon Levels.
 *
 * `skillCapacity` (Skill Capacity): a unit may have `slots` skills equipped, as long as their Capacity Costs
 * add up to no more than its Capacity Points: those of `points` for the tier it has reached, or the number typed
 * on its sheet. A unit whose class does not promote reaches the later tiers at the levels a promotion would
 * have come at.
 *
 * `alternateActivation` (Alternate Skill Activation): a chance to activate that is read from a stat is read
 * from the whole stat, whatever the skill divides it by. In the `level` reading a chance read from the stat
 * `replaces` is read from the unit's level instead, which is `level` to the skill rules and is written
 * `levelAbbr`; in the `dex` reading every chance keeps its stat. A chance that is a plain percent, one that is
 * not a Skill's own (`fixed`), and the second roll of a condition that may turn into a worse one stay as they
 * are. `mode` follows the world setting.
 *
 * `combatArts` (Combat Arts): a unit that initiates a fight may perform a Combat Art it has learned (see
 * `module/rules/arts.mjs`). In the `single` reading it then makes that one attack; in the `followUp` reading
 * it follows up as usual, and only its first attack carries the Art. `mode` follows the world setting.
 * `types` are the kinds of Arts there are; a `universal` one goes with any weapon. A weapon performs the Arts
 * of its own type, of the type its proficiency is, and of the types `uses` lists for it; those in `barred`
 * perform none. The weapons in `natural` are part of their unit's body: they pay an Art's HP but cannot pay
 * Weapon Uses. A unit under a condition in `blockedBy` performs no Art. A unit learns one Art for every Weapon
 * Rank it reaches, except in the weapon types of `noLearning`. `ranks` are the Ranks an Art can have. The
 * Arts of the types in `melee` are performed from next to the foe, those of the types in `ranged` from 2 tiles
 * or more, unless an Art names a Range of its own. A weapon type's Ranks teach the Arts of its own type and of
 * the types `teaches` lists for it, from the Rank `typedFrom` on, and Universal Arts from the first; the Art
 * learned is of the Rank reached or a lower one. `pack` is the compendium the Arts are learned from.
 *
 * `battalions` (Battalions & Gambits): a unit may be assigned a Battalion (see `module/rules/battalions.mjs`),
 * which adds to the stats, the abilities and the combat stats listed in `bonuses`, and gives its unit a Gambit
 * to use. `mode` follows the world setting, and is the rank Authority starts at: a unit never counts as having
 * less. `ranks` are the Authority ranks a Battalion can ask for. `authority` holds the Authority EXP needed to
 * leave each rank (`toNext`), what each rank above the lowest adds to hitting with a Gambit and to avoiding one
 * (`perRank`), and what earns Authority EXP (`exp`): using an Offensive Gambit, hitting with one or using a
 * Support Gambit, which take the place of that, defeating a unit or a Battalion with one, which is added,
 * dodging one, and defeating a Battalion without one. In `gambit`, `charm` is how Charm counts: a point of
 * damage for every `damageDivisor` of the user's, and `hitPer` to hit for each point of difference with the
 * target's, up to `hitCap` either way; `inflicts` is the condition every Offensive Gambit inflicts on a hit;
 * a unit under a condition in `blockedBy` uses none; and `effective` is what a Gambit's Might is multiplied by
 * against a Special Quality its Effect names. In `health`, a Battalion takes `share` percent of the damage its
 * commander takes in a fight, `effective` times that from what is effective against the Battalion's own Special
 * Quality, and never more than `cap` percent of its full HP in one fight. A Battalion with one of the
 * `restricted` Special Qualities can only be assigned to a unit that has it. `levels` is how a Battalion
 * levels: the highest level, the EXP a level takes, and the EXP for using its Gambit and for defeating a unit
 * or a Battalion with it. `pack` is the compendium a unit takes its Battalions from.
 *
 * `breaking` (Breaking and Extended Weapon Triangle): two rules that a world uses together or one without the
 * other, which `mode` follows the world setting for. Break is in use in the modes of `breaks`: a unit that
 * begins a fight with weapon triangle advantage and lands a hit that deals damage takes the counter-attack
 * from its foe, for the rest of that fight and the foe's next one, or until the foe's next turn starts. A unit
 * with a Special Quality in `immune` never suffers from it. The extended triangle is in use in the modes of
 * `extended`, and then takes the place of `FEO.triangle`: `beats` lists for each weapon category the
 * categories it has the advantage over, every tome has it over those in `magicBeats`, and the categories in
 * `apart` stay outside of all of it. The lists name every category of the rule; those the system has no
 * weapons for count for nothing until it has (see `module/rules/breaking.mjs`).
 *
 * `capturing` (Capturing): a unit may attempt to capture the unit it attacks instead of killing it (see
 * `module/rules/capturing.mjs`). It needs more Weight than its target, and fights the attempt with every stat
 * but those in `spared` changed by `percent`. A target brought to 0 HP from next to it is captured and carried,
 * which slows its captor as Rescuing does (`FEO.rescue.carry`); from further away it is subdued instead,
 * and comes to with the HP it had unless it is picked up before `subdued` turns of its captor have ended. A
 * unit with a Special Quality in `barred` is never captured, nor is one that rides or flies (`riders`), nor
 * one that changes form while it is transformed or has transformations left. A target under a condition in
 * `outright`, or with nothing to fight back with but the weapon every Laguz has in humanoid form, is captured
 * without a fight, rider or not.
 *
 * `stagger` (Stagger): every unit has a Stagger bar beside its HP (see `module/rules/stagger.mjs`), as large as
 * `share` percent of the HP it has when the bar is made. The HP a unit loses comes off the bar, except in a
 * fight the unit began. A unit whose bar is empty is Staggered: what it takes in damage is multiplied by
 * `taken`, and it cannot act until its own turn has ended as often as `turns` says: `away` when it was
 * Staggered outside of its turn, `own` when it was during it. The bar regains `regain` percent of its full
 * size as each of the unit's turns starts, and is full again once the unit recovers.
 *
 * The four Additional Staff Effects, each a rule of its own (see `module/rules/staves.mjs`):
 *
 * `staffPassives` (Passive Staff Effects): a staff does something for the unit that has it equipped, read as
 * one more skill of that unit in the notation of skill effects (see `module/rules/skills.mjs`). `staves` holds
 * what the staves the rule names do, by the name the Reference Sheet gives them. Of the others, a staff that
 * restores HP gives its unit `heal` as each of its turns starts, one that inflicts a condition cures its unit
 * of that condition then, and one that removes all conditions cures its unit of them all. The rest do nothing.
 *
 * `healCriticals` (Heal Criticals): a staff that heals may score a critical, at the user's `stat` divided by
 * `divisor` in percent, which heals for `times` the amount.
 *
 * `doubleCast` (Double-Cast): a staff that heals may be cast a second time at once, at the sum of the user's
 * `stats` divided by `divisor` in percent, unless its target is at full HP after the first.
 *
 * `staffMissing` (Staff Missing): a staff that is not used against an enemy may miss. It succeeds at the
 * staff's Hit plus `times` the user's `stat`, in percent. `offensive` names the staves of the Reference Sheet
 * that are used against enemies, which keep the hit rate of their own.
 *
 * `followUpCritical` (Follow-up Critical Multiplier): one of the combat variants, which each change a single
 * rule of combat (see `module/rules/variants.mjs`). Every unit has an FCM, from `base` to `max`. On a follow-up
 * attack its Critical is multiplied by its FCM before the foe's Critical Avoid is taken off. An FCM of `base`
 * changes nothing. It changes the chance of a critical hit, never what a critical hit deals.
 *
 * `leadership` (Authority & Leadership): each Leadership Star gives `perStar` of the reading in use to its
 * bearer and to the units that have its bearer as their Authority. `range` is how close the Authority must be
 * in the `range` reading; in the `map` reading it reaches every such unit on the map. `mode` follows the world
 * setting.
 *
 * `weaponKills` (Weapon Kill Critical Bonus): a weapon gives `perKill` Critical for every kill past
 * `threshold`, counting kills up to `cap`.
 *
 * `levelCap` (Level Cap): a rule of this system rather than of the rulebook, which names no highest level. A
 * unit stops levelling at `cap`, or at the limit typed on its sheet, which is where a Seal of Eternity is
 * counted. A unit at its limit earns no experience.
 */
FEO.optional = {
  affinities: {
    enabled: false
  },
  affinityEffects: {
    enabled: false,
    effects: {
      fire: [{ proc: { on: "hit", percent: 25, fixed: true }, inflicts: ["burn"] }],
      thunder: [{ proc: { on: "hit", percent: 10, fixed: true }, inflicts: ["daze"] }],
      wind: [{
        proc: { on: "dodged", sure: true },
        grant: { to: "self", effects: [{ haste: 1 }], ends: "turnStart", max: 4 }
      }],
      water: [{ proc: { on: "hit", percent: 10, fixed: true }, inflicts: ["foam"] }],
      dark: [{
        proc: { on: "hit", sure: true },
        foeCombat: { hit: -3 },
        grant: { to: "foe", effects: [{ combat: { hit: -3 } }], ends: "turnEnd", next: true, max: 99 }
      }],
      light: [{
        proc: { on: "hit", sure: true },
        foeCombat: { dodge: -3 },
        grant: { to: "foe", effects: [{ combat: { dodge: -3 } }], ends: "turnEnd", next: true, max: 99 }
      }],
      ice: [
        { proc: { on: "hit", percent: 10, fixed: true }, inflicts: ["frostbite"] },
        { proc: { on: "hit", percent: 5, fixed: true }, inflicts: ["freeze"] }
      ],
      anima: [{ when: { declared: true }, against: "lower" }],
      heaven: [{ when: { terrain: true }, combat: { damage: 2 } }],
      earth: [{ when: { terrain: true }, endurance: 2 }],
      blade: [],
      moon: [{ ignoreDefence: 10 }],
      sun: [{ proc: { on: "hit", sure: true }, damaged: true, recover: 1 }],
      blood: [{ proc: { on: "hit", percent: 20, fixed: true }, inflicts: ["bleed"] }],
      bone: [{
        proc: { on: "dodged", sure: true },
        grant: { to: "self", effects: [{ endurance: 1 }], ends: "turnStart", max: 4 }
      }],
      shield: [{ block: { chance: 5, amount: 1, kind: "shield" } }],
      wood: [{ when: { declared: true }, crossing: { free: "all", steady: true } }],
      metal: [{ proc: { on: "struck", percent: 25, fixed: true }, when: { foeWeapon: ["physical"] }, reduce: 2 }],
      jewel: [{ proc: { on: "struck", percent: 25, fixed: true }, when: { foeWeapon: ["magic"] }, reduce: 2 }],
      smoke: [{
        proc: { on: "hit", percent: 30, fixed: true },
        inflicts: [{ id: "smoke", dice: 3 }],
        foeCombat: { hit: -10 }
      }],
      glass: [{ mirrorCrit: 15 }],
      breath: [{ when: { declared: true }, stats: { mov: 1 } }],
      muscle: [{ when: { declared: true }, shove: { any: true, more: 1 } }],
      sinew: [{
        proc: { on: "struck", sure: true },
        when: { role: "defending" },
        damaged: 2,
        grant: { to: "self", effects: [], mend: 1, max: 99, ends: "turnStart" }
      }],
      beast: [{
        proc: { on: "dodged", sure: true },
        grant: { to: "self", effects: [{ combat: { damage: 1 } }], ends: "turnStart", max: 4 }
      }],
      avian: [{ canto: { after: "any", spaces: 1 } }],
      venom: [{ proc: { on: "hit", percent: 10, fixed: true }, inflicts: ["disease"] }],
      serum: [{ nullify: { percent: 100, only: ["poison", "deepPoison"] } }],
      emblem: [],
      key: [],
      lock: [{ proc: { on: "hit", percent: 10, fixed: true }, inflicts: ["disable"] }],
      thorn: [
        { proc: { on: "struck", sure: true }, damaged: true, retaliate: 1, nonlethal: true },
        { proc: { on: "struck", percent: 50, fixed: true }, damaged: true, retaliate: 1, nonlethal: true }
      ],
      bloom: [{
        proc: { on: "turnStart", sure: true },
        when: { terrain: true },
        recover: { of: "hpMax", times: 0.1 }
      }],
      tome: [],
      staff: [{
        proc: { on: "hit", sure: true },
        damaged: true,
        spread: { who: "ally", around: "self", within: 1, targets: 1, pick: "random", heal: 1 }
      }],
      coin: [{
        combat: { hit: { of: "gold", per: 300, times: 2 }, dodge: { of: "gold", per: 300, times: 2 } }
      }],
      universe: [{ proc: { on: "hit", percent: 10, fixed: true }, inflicts: ["dazzle"] }]
    },
    ranks: {
      blade: { steps: 1, options: ["sword", "lance", "axe", "knife", "brawl"] },
      tome: { steps: 1, options: ["fire", "thunder", "wind", "water", "earth", "light", "dark"] }
    },
    usage: {
      anima: { kind: "declare", uses: 2, per: "map" },
      wood: { kind: "declare", cooldown: 2, lasts: 1 },
      breath: { kind: "declare", cooldown: 3 },
      muscle: { kind: "declare", cooldown: 2 }
    },
    spentBy: { anima: "fight", wood: "move", breath: "move", muscle: "shove" },
    activationExp: { emblem: [{ div: 1, exp: 5 }, { div: 1.5, exp: 7 }, { div: 2, exp: 10 }] },
    cooldown: { key: -1 }
  },
  lives: {
    enabled: false,
    armies: ["player"],
    start: 3,
    promotion: { max: 1, restore: 1 },
    revive: 1
  },
  growths: {
    enabled: false,
    caps: { con: 20, mov: 5 },
    statCaps: { con: 30, mov: 20 }
  },
  movementStars: {
    enabled: false,
    max: 5,
    perStar: 5
  },
  holyBlood: {
    enabled: false,
    grades: { minor: "FEO.Optional.grade.minor", major: "FEO.Optional.grade.major" },
    majorMultiplier: 2,
    majorRank: "STAR",
    minorRanks: 1,
    lineages: {
      baldr: { growths: { hp: 20, str: 10, dex: 10, luk: 10 }, rank: "sword" },
      od: { growths: { hp: 20, dex: 30 }, rank: "sword" },
      hezul: { growths: { hp: 20, str: 30 }, rank: "sword" },
      njorun: { growths: { hp: 20, str: 10, spd: 10, def: 10 }, rank: "lance" },
      dainn: { growths: { hp: 20, spd: 30 }, rank: "lance" },
      neir: { growths: { hp: 20, def: 30 }, rank: "axe" },
      ullr: { growths: { hp: 20, luk: 30 }, rank: "bow" },
      fjalar: { growths: { hp: 20, mag: 30 }, rank: "fire" },
      thrud: { growths: { hp: 20, dex: 30 }, rank: "thunder" },
      forseti: { growths: { hp: 20, spd: 30 }, rank: "wind" },
      naga: { growths: { hp: 10, mag: 20, res: 20 }, rank: "light" },
      loptous: { growths: { hp: 10, mag: 20, res: 20 }, rank: "dark" },
      bragi: { growths: { res: 20, hp: 10, mag: 10, luk: 10 }, rank: "staff" }
    }
  },
  crests: {
    enabled: false,
    grades: { minor: "FEO.Optional.grade.minor", major: "FEO.Optional.grade.major" },
    custom: "custom",
    crests: {
      ernest: { major: 20, minor: 10 },
      macuil: { major: 30, minor: 15 },
      seiros: { major: 20, minor: 10 },
      dominic: { major: 30, minor: 15 },
      fraldarius: { major: 30, minor: 15 },
      noa: { major: 20, minor: 10 },
      cethleann: { major: 30, minor: 15 },
      daphnel: { major: 20, minor: 10 },
      blaiddyd: { major: 20, minor: 10 },
      gloucester: { major: 20, minor: 10 },
      goneril: { major: 30, minor: 15 },
      cichol: { major: 30, minor: 15 },
      aubin: { major: 20, minor: 10 },
      gautier: { major: 30, minor: 20 },
      indech: { major: 30, minor: 15 },
      beast: { major: 25, minor: 10 },
      charon: { major: 20, minor: 10 },
      timetheos: { major: 20, minor: 10 },
      riegan: { major: 30, minor: 15 },
      chevalier: { major: 30, minor: 15 },
      lamine: { major: 30, minor: 20 },
      flames: { major: 20, minor: 10 }
    }
  },
  heartSeals: {
    enabled: false,
    picks: 3,
    item: "Heart Seal",
    supportRank: "S"
  },
  glory: {
    enabled: false,
    powers: {
      vigor: { cost: 1, effects: [{ hpMax: 3, growths: { hp: 5 } }] },
      instinct: { cost: 1, effects: [{ stats: { str: 1 }, growths: { str: 5 } }] },
      insight: { cost: 1, effects: [{ stats: { mag: 1 }, growths: { mag: 5 } }] },
      fortitude: { cost: 1, effects: [{ stats: { def: 1 }, growths: { def: 5 } }] },
      temperance: { cost: 1, effects: [{ stats: { res: 1 }, growths: { res: 5 } }] },
      prudence: { cost: 1, effects: [{ stats: { dex: 2 }, growths: { dex: 5 } }] },
      justice: { cost: 1, effects: [{ stats: { spd: 1 }, growths: { spd: 5 } }] },
      serendipity: { cost: 1, effects: [{ stats: { luk: 3 }, growths: { luk: 5 } }] },
      gusto: { cost: 2, effects: [{ stats: { con: 1 }, growths: { con: 5 } }] },
      legerity: { cost: 2, effects: [{ stats: { mov: 1 }, growths: { mov: 5 } }] },
      redTears: { cost: 1, effects: [{ when: { hp: { op: "le", percent: 25 } }, stats: { str: 3, mag: 3 } }] },
      blueTears: { cost: 1, effects: [{ when: { hp: { op: "le", percent: 25 } }, stats: { def: 3, res: 3 } }] },
      greenTears: { cost: 1, effects: [{ when: { hp: { op: "le", percent: 25 } }, stats: { spd: 3, dex: 5 } }] },
      flawlessEtiquette: { cost: 2, effects: [] },
      triangulation: { cost: 2, effects: [{ rules: ["bestRankTriangle"] }] },
      void: { cost: 2, effects: [{ remind: "check" }] },
      harvest: { cost: 2, effects: [{ proc: { on: "kill", sure: true }, when: { role: "initiating" }, remind: true }] },
      adaptiveTactics: { cost: 2, effects: [{ remind: "check" }] },
      palisade: { cost: 2, effects: [{ remind: "check" }] },
      smash: {
        cost: 2,
        effects: [{ proc: { on: "after", sure: true }, when: { role: "initiating" }, ifHit: true, remind: "foe" }]
      },
      chargeForth: { cost: 2, effects: [{ when: { role: "initiating" }, remind: "check" }] },
      deathlyAffliction: {
        cost: 2,
        afflict: {
          amount: 5,
          more: 10,
          conditions: ["bleed", "poison", "burn", "frostbite", "brighten", "darken", "brand", "damp", "squall", "rattled", "smoke"]
        }
      },
      encore1: { cost: 2, stars: 1 },
      encore2: { cost: 2, stars: 1 },
      encore3: { cost: 2, stars: 1 },
      spikewall: {
        cost: 3,
        effects: [{ proc: { on: "struck", sure: true, once: true }, damaged: true, retaliate: { of: "defOrRes", div: 2 } }]
      },
      affinityResonance: { cost: 3, resonance: true, partly: true },
      quickLearner: { cost: 3, effects: [{ rules: ["doubleWexp"] }], partly: true },
      bloodyArtistry: { cost: 3, effects: [{ artCost: -1 }] },
      criticalEdge: { cost: 3, effects: [{ critMultiplier: 3.5 }] },
      qualityKiller: { cost: 3, effects: [{ when: { foeQuality: [...FEO.specialQualities] }, damageMultiplier: 1.5 }] },
      generosity: { cost: 3, effects: [{ staffHeal: { more: 50 } }] },
      rejuvenation: {
        cost: 3,
        effects: [{
          proc: { on: "levelUp", sure: true },
          recover: { of: "hpMax" },
          grant: { to: "self", gained: 1, ends: "turnEnd" }
        }]
      },
      etherealStrikes: { cost: 3, effects: [{ when: { role: "initiating" }, remind: "check" }] },
      gallivant: {
        cost: 3,
        effects: [{ canto: { after: [...FEO.cantoPlus.after], except: [...FEO.cantoPlus.except] } }]
      },
      skillSavant: { cost: 4, effects: [{ slots: 1, capacity: 20 }] },
      rangemaster: { cost: 4, effects: [{ rules: ["closeCounter", "distantCounter", "counterMidrange"] }] },
      metalHeart: { cost: 4, effects: [{ remind: "check" }] },
      fudger: { cost: 4, effects: [{ remind: "check" }] },
      triadTechnique: { cost: 5, effects: [{ remind: "check" }] },
      erosion: {
        cost: 5,
        effects: [{
          proc: { on: "start", sure: true },
          when: { role: "initiating" },
          grant: { to: "foe", effects: [{ statPercent: { def: -10, res: -10 } }], ends: "map", max: 3 }
        }]
      },
      exponentiality: { cost: 5, effects: [{ expMultiplier: 1.25 }] },
      fullBloom: {
        cost: 5,
        effects: [{
          growths: Object.fromEntries([...Object.keys(FEO.growths), ...Object.keys(FEO.optionalGrowths)].map((key) => [key, 5]))
        }]
      },
      killerEye: { cost: 6, effects: [{ remind: "check" }] },
      hoplonRibcage: { cost: 6, effects: [{ rules: ["foeNoCrit"] }] },
      manslayer: { cost: 8, effects: [{ dealtPercent: 50 }] },
      immortal: {
        cost: 10,
        effects: [{ proc: { on: "struck", sure: true }, survive: { hp: { op: "above", value: 1 } } }]
      }
    }
  },
  manualGains: {
    enabled: false,
    mode: "points",
    modes: {
      points: "FEO.Optional.manualGains.mode.points",
      open: "FEO.Optional.manualGains.mode.open",
      double: "FEO.Optional.manualGains.mode.double"
    },
    points: 3,
    growthPoints: 125,
    all: ["con", "mov"]
  },
  weaponLevel: {
    enabled: false,
    start: 5,
    cap: 30,
    growthCap: 70,
    ranks: { E: 1, D: 4, C: 7, B: 10, A: 15, S: 20, SS: 25 },
    perRank: 5
  },
  skillCapacity: {
    enabled: false,
    slots: 9,
    points: { base: 20, second: 40, third: 80 },
    labels: { base: "FEO.Optional.capacity.class.base", second: "FEO.Optional.capacity.class.second", third: "FEO.Optional.capacity.class.third" }
  },
  alternateActivation: {
    enabled: false,
    mode: "dex",
    modes: { dex: "FEO.Optional.alternateActivation.mode.dex", level: "FEO.Optional.alternateActivation.mode.level" },
    replaces: "dex",
    level: "level",
    levelAbbr: "FEO.Optional.alternateActivation.lvl"
  },
  combatArts: {
    enabled: false,
    mode: "single",
    modes: { single: "FEO.Optional.combatArts.mode.single", followUp: "FEO.Optional.combatArts.mode.followUp" },
    universal: "universal",
    types: {
      universal: "FEO.Optional.combatArts.type.universal",
      sword: "FEO.WeaponType.sword",
      lance: "FEO.WeaponType.lance",
      axe: "FEO.WeaponType.axe",
      bow: "FEO.WeaponType.bow",
      knife: "FEO.WeaponType.knife",
      brawl: "FEO.WeaponType.brawl",
      pole: "FEO.Optional.combatArts.type.pole",
      rifle: "FEO.Optional.combatArts.type.rifle"
    },
    uses: { bolt: ["bow"] },
    melee: ["sword", "lance", "axe", "brawl", "knife", "pole"],
    ranged: ["bow", "rifle"],
    barred: ["staff"],
    natural: ["laguz", "manakete", "taguel"],
    blockedBy: ["rattled"],
    noLearning: ["staff"],
    teaches: { knife: ["sword"], pole: ["lance"], bolt: ["bow"] },
    typedFrom: "D",
    pack: "arts",
    ranks: ["E", "D", "C", "B", "A", "S", "SS"]
  },
  battalions: {
    enabled: false,
    mode: "F",
    modes: { F: "FEO.Optional.battalions.mode.F", E: "FEO.Optional.battalions.mode.E" },
    ranks: ["E", "D", "C", "B", "A", "S", "SS"],
    authority: {
      toNext: { F: 15, E: 20, D: 25, C: 35, B: 45, A: 55, S: 70 },
      perRank: 5,
      exp: { use: 1, hit: 3, support: 3, defeat: 3, dodge: 2, battalion: 1 }
    },
    bonuses: {
      stats: ["str", "mag", "def", "res", "luk", "los"],
      abilities: ["cha"],
      combat: ["hit", "critical", "dodge", "critAvoid", "attackSpeed"]
    },
    gambit: {
      kinds: { offensive: "FEO.Optional.battalions.kind.offensive", support: "FEO.Optional.battalions.kind.support" },
      charm: { damageDivisor: 5, hitPer: 5, hitCap: 30 },
      inflicts: "rattled",
      blockedBy: ["rattled"],
      effective: 3
    },
    health: { share: 50, cap: 50, effective: 1.5 },
    restricted: ["Flying", "Mounted", "Terror", "Beast", "Laguz"],
    levels: { max: 5, exp: 10, use: 1, defeat: 3 },
    pack: "battalions"
  },
  breaking: {
    enabled: false,
    mode: "both",
    modes: {
      break: "FEO.Optional.breaking.mode.break",
      triangle: "FEO.Optional.breaking.mode.triangle",
      both: "FEO.Optional.breaking.mode.both"
    },
    breaks: ["break", "both"],
    extended: ["triangle", "both"],
    immune: ["Armored"],
    beats: {
      sword: ["axe", "mace"],
      katana: ["axe", "mace"],
      axe: ["lance", "scythe", "pole"],
      mace: ["lance", "scythe", "pole"],
      lance: ["sword", "katana"],
      scythe: ["sword", "katana"],
      pole: ["sword", "katana"],
      brawl: ["bow", "crossbow"],
      whip: ["bow", "crossbow"],
      bow: ["knife"],
      crossbow: ["knife"],
      knife: ["brawl", "whip"],
      pistol: ["knife", "brawl"],
      rifle: ["pistol", "bow", "crossbow"],
      handcannon: ["pistol", "bow", "crossbow"],
      anima: ["light", "fire", "wind", "thunder"],
      arcanima: ["anima"],
      light: ["dark", "blood", "arcanima"],
      dark: ["anima", "arcanima"],
      blood: ["anima"],
      fire: ["wind"],
      wind: ["earth"],
      earth: ["thunder"],
      thunder: ["water"],
      water: ["fire"]
    },
    magicBeats: ["rifle", "handcannon"],
    apart: ["astral", "scroll", "magicite"]
  },
  capturing: {
    enabled: false,
    spared: ["luk"],
    percent: -50,
    subdued: 2,
    barred: ["Ballistician", "Terror"],
    riders: ["Mounted", "Flying"],
    outright: ["sleep", "stun", "petrification", "freeze", "beckon", "seduce", "stop", "control"]
  },
  stagger: {
    enabled: false,
    share: 60,
    regain: 20,
    taken: 2,
    turns: { away: 1, own: 2 }
  },
  staffPassives: {
    enabled: false,
    heal: [{ proc: { on: "turnStart", sure: true }, recover: { of: "mag", div: 3, plus: 5 } }],
    staves: {
      Speed: [{ stats: { spd: 2 } }],
      Strength: [{ stats: { str: 2 } }],
      Ensorcel: [{ stats: { mag: 2 } }],
      Barrier: [{ stats: { res: 2 } }],
      Defense: [{ stats: { def: 2 } }],
      Enfeeble: [{ stats: { str: 1, mag: 1, def: 1, res: 1, dex: 1, spd: 1, luk: 1 } }],
      Empower: [{ stats: { str: 1, mag: 1, def: 1, res: 1, dex: 1, spd: 1, luk: 1 } }],
      Freeze: [{ combat: { dodge: 10 } }],
      Obscure: [{ combat: { dodge: 10 } }],
      Blind: [{ combat: { hit: 10 } }],
      Candlelight: [{ combat: { attackSpeed: 1 } }],
      Torch: [{ stats: { los: 1 } }],
      Crest: [{ combat: { activation: 5 } }],
      Haste: [{ stats: { spd: 4 } }],
      Anew: [{ stats: { mov: 1 } }],
      Expel: [{ when: { foeQuality: ["Terror"] }, taken: -3 }]
    }
  },
  healCriticals: {
    enabled: false,
    stat: "luk",
    divisor: 2,
    times: 3
  },
  doubleCast: {
    enabled: false,
    stats: ["dex", "spd", "luk"],
    divisor: 2
  },
  staffMissing: {
    enabled: false,
    stat: "dex",
    times: 3,
    offensive: ["Venom", "Freeze", "Pain", "Disarm", "Absorb", "Enfeeble", "Panic", "Assault", "Blind", "Disturb", "Bind",
      "Inaction", "Charm", "Entrap", "Hex", "Silence", "Expel", "Thief", "Agony", "Miswarp", "Nightmare", "Berserk",
      "Sleep", "Petrify"]
  },
  followUpCritical: {
    enabled: false,
    base: 1,
    max: 5
  },
  leadership: {
    enabled: false,
    mode: "range",
    modes: { range: "FEO.Optional.leadership.mode.range", map: "FEO.Optional.leadership.mode.map" },
    max: 5,
    range: 3,
    perStar: {
      range: { hit: 10, dodge: 10 },
      map: { hit: 3, dodge: 5 }
    }
  },
  weaponKills: {
    enabled: false,
    threshold: 50,
    cap: 100,
    perKill: 1
  },
  levelCap: {
    enabled: false,
    cap: 60
  }
};

/**
 * Optional Modules of the rulebook that the system does not have yet, by the key each will go by, which a
 * skill may already ask for (`when: { module: "dismounting" }`). Such an effect holds for nobody until its
 * module is built as an entry of `FEO.optional`, and its name is then taken off this list.
 */
FEO.optionalAwaited = ["dismounting"];

/* -------------------------------------------- */
/*  The Map                                     */
/* -------------------------------------------- */

/**
 * Terrain, as the table in The Map gives it. Each kind stands for every name on its row of the table.
 * - `def`, `res` and `dodge` are what a unit standing there gains.
 * - `cost` is how many spaces of movement each space of it takes.
 * - `heal` is the share of its total HP, in percent, a unit standing there gains each turn.
 * - `needs` lists the skills of which a unit needs one to cross it at all. A skill whose effects open that
 *   kind to its unit serves as well (see `crossing` in rules/terrain.mjs).
 * - `slow` raises the cost for units with any of the Special Qualities it lists; `free` names who crosses it
 *   as if it were open ground.
 * - `impassable` marks what nobody crosses, whether on foot or flying: the walls, buildings and rock-faces a
 *   map is fenced in with. It is no row of the table, which leaves such obstacles to the map.
 * - `los` is what a unit standing there gains or loses of its Line of Sight, and `hides` marks ground on
 *   which a unit is seen only by a unit next to it. What is `impassable` blocks Line of Sight (see
 *   rules/sight.mjs).
 * `elevation` is what a ranged attack gains against a unit on lower ground and loses against one on higher
 * ground. `flying` is the Special Quality whose units ignore terrain, except for healing.
 */
FEO.terrain = {
  types: {
    plain: { label: "FEO.Terrain.plain", icon: "grass", cost: 1 },
    forest: { label: "FEO.Terrain.forest", icon: "tree", def: 1, dodge: 15, cost: 2 },
    thicket: { label: "FEO.Terrain.thicket", icon: "tree", dodge: 30, cost: 3, los: -1, hides: true, note: "FEO.Terrain.note.thicket" },
    hill: { label: "FEO.Terrain.hill", icon: "peak", def: 2, dodge: 20, cost: 3 },
    mountain: {
      label: "FEO.Terrain.mountain", icon: "peak", def: 3, dodge: 25, cost: 4, needs: ["Mountaineer", "Climber"]
    },
    cliff: { label: "FEO.Terrain.cliff", icon: "peak", dodge: -15, cost: 5, needs: ["Mountaineer", "Climber"] },
    fort: { label: "FEO.Terrain.fort", icon: "fort", def: 2, dodge: 20, cost: 1, heal: 20 },
    house: { label: "FEO.Terrain.house", icon: "house", dodge: 10, cost: 1, note: "FEO.Terrain.note.house" },
    river: { label: "FEO.Terrain.river", icon: "wave", dodge: 10, cost: 2 },
    water: { label: "FEO.Terrain.water", icon: "wave", dodge: 10, cost: 2, needs: ["Privateer", "Sailor"] },
    desert: {
      label: "FEO.Terrain.desert", icon: "sun", dodge: 5, cost: 2,
      slow: { qualities: ["Armored", "Mounted"], cost: 3 },
      free: { magic: true, shifted: true, classes: ["Thief"] },
      note: "FEO.Terrain.note.desert"
    },
    healhedge: { label: "FEO.Terrain.healhedge", icon: "heart", dodge: 10, cost: 1, heal: 10 },
    wardwood: { label: "FEO.Terrain.wardwood", icon: "tree", res: 5, cost: 2 },
    cover: { label: "FEO.Terrain.cover", icon: "shield", def: 5, cost: 2 },
    wall: { label: "FEO.Terrain.wall", icon: "lock", cost: 1, impassable: true, note: "FEO.Terrain.note.wall" }
  },
  default: "plain",
  elevation: { hit: 20, damage: 1 },
  flying: "Flying",

  // The colour each kind of terrain is painted in on the map, by the terrain brush and when the ground is
  // surveyed
  tints: {
    plain: "#a9c27a", forest: "#2f8a46", thicket: "#1f5f3c", hill: "#b08a4a", mountain: "#8c6f5a", cliff: "#6e5a52",
    fort: "#9aa3b5", house: "#c97b4a", river: "#4aa3d8", water: "#2f6fc0", desert: "#e0c074", healhedge: "#6fd08a",
    wardwood: "#7a5fc0", cover: "#a8a08a", wall: "#4b4f5c"
  }
};

/**
 * Weather, as the Weather page of The Map gives it (see rules/weather.mjs). A map has the kinds its scene
 * lists, which the Game Master switches on and off from the Phase banner. Of each kind:
 * - `move` is what a tile costs more to cross: for `infantry` (a unit that neither flies nor is mounted), for
 *   a `mounted` unit and for a `flying` one.
 * - `stats` is what a unit's stats change by, and `harm` the damage it takes as its turn ends, which never
 *   brings it below 1 HP.
 * - `fatigue` is the Fatigue it gains as its turn ends, which waits for the Fatigue Optional Module.
 * - `fog` marks a kind that causes Fog of War, which the system does not draw; `los` is the Line of Sight
 *   every unit has at the least.
 * - `strikes` names what strikes tiles picked by dice as a turn of the battle ends.
 * `strikes` has those: `every` how many turns they come, `dice` the die of bolts (a coin where none is given,
 * which strikes once on tails), `damage` what a bolt deals the unit on its tile, and `against` what it deals a
 * unit with a Special Quality instead. `indoors` lists the kinds of terrain a bolt does nothing on, and
 * `mounted` and `flying` are the Special Qualities weather tells units by.
 */
FEO.weather = {
  kinds: {
    rain: { label: "FEO.Weather.kind.rain", icon: "drop", move: { infantry: 1, mounted: 2 } },
    snowstorm: { label: "FEO.Weather.kind.snowstorm", icon: "snow", move: { infantry: 1, mounted: 2 } },
    thunderstorm: { label: "FEO.Weather.kind.thunderstorm", icon: "bolt", move: { infantry: 1, mounted: 2 }, strikes: "lightning" },
    windstorm: { label: "FEO.Weather.kind.windstorm", icon: "wind", move: { flying: 1 } },
    hail: { label: "FEO.Weather.kind.hail", icon: "gem", harm: 1 },
    heatWave: { label: "FEO.Weather.kind.heatWave", icon: "sun", stats: { spd: -3 }, harm: 1, fatigue: 1 },
    fog: { label: "FEO.Weather.kind.fog", icon: "smoke", fog: true },
    sandstorm: { label: "FEO.Weather.kind.sandstorm", icon: "smoke", fog: true },
    darkness: { label: "FEO.Weather.kind.darkness", icon: "moon", fog: true },
    ashStorm: { label: "FEO.Weather.kind.ashStorm", icon: "smoke", fog: true },
    mist: { label: "FEO.Weather.kind.mist", icon: "eye", fog: true, los: 4 },
    ballista: { label: "FEO.Weather.kind.ballista", icon: "target", strikes: "ballista" }
  },
  strikes: {
    lightning: { label: "FEO.Weather.strike.lightning", every: 1, damage: 10, against: { Dragon: 15 } },
    ballista: { label: "FEO.Weather.strike.ballista", every: 2, dice: 5, damage: 10 }
  },
  indoors: ["house"],
  mounted: "Mounted",
  flying: "Flying",

  // How long the flash of a bolt lasts on the map, in milliseconds
  flash: 500
};

/** The order in which the sides of a battle take their Phases. */
FEO.phases = ["player", "enemy", "ally", "other"];

/** Which sides fight together. Units of a side in neither list stand apart from everyone. */
FEO.alliances = [["player", "ally"], ["enemy"]];

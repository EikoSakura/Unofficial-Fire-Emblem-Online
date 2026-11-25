/**
 * What worn and wielded gear gives its unit, for Fire Emblem Online: the weapon in its hand, the accessory it
 * wears and the Shield on its arm, read from the Effect each carries as the Weapons and Items tabs word it.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * An Effect is read clause by clause, where its full stops and commas divide it, and each clause is one of
 * four things:
 *
 *   - something the system applies as an effect in the notation of skill effects (see `skills.mjs`): "+5 SPD",
 *     "Halves any damage this unit would take", "Reverses Weapon Triangle". Its unit has those effects as one
 *     more skill for as long as the gear is equipped, named after the gear;
 *   - a skill the gear grants, "Grants Miracle": its unit has that skill while the gear is equipped (see
 *     `helpers/gear.mjs`, which puts it on the unit and takes it off again);
 *   - something that is read where it is used, as it always was: what a weapon is effective against, the
 *     conditions it inflicts, that it may backfire, how often it strikes, that it is Midrange, the stat it
 *     adds and the element it counts as, that it acts as a Shield. Such a clause is `kept`;
 *   - something the table still does by hand, which is `left`.
 *
 * A clause that is turned into an effect is taken out of what the older readers see, so that "+4 Might against
 * Mounted units" is no longer mistaken for a weapon that is effective against Mounted units.
 *
 * A few clauses count while their gear is only carried ("Grants +3 STR when in inventory"), and a skill may be
 * granted while it is carried and not equipped ("Grants Cold Rain when not equipped").
 */
import { FEO } from "../config.mjs";
import { inflictions } from "./conditions.mjs";

/**
 * @typedef GearGrant
 * A skill that gear grants its unit.
 * @property {string} name                    The skill, by its name
 * @property {"equipped"|"stowed"} while      While the gear is equipped, or while it is carried and not equipped
 */

/**
 * @typedef GearReading
 * What the system reads from the Effect of a weapon, an accessory or a Shield.
 * @property {object[]} effects       What its unit has while it is equipped, in the notation of skill effects
 * @property {object[]} carried       What its unit has while it carries it, equipped or not
 * @property {GearGrant[]} grants     The skills it grants
 * @property {string[]} left          The clauses that are left to the table
 * @property {string} kept            What is left of the Effect for the readers of a weapon's Effect: the
 *                                    clauses that were not turned into effects
 * @property {number} read            How many clauses the system reads, here or where they are used
 */

/** The flag on a skill Item that says which piece of gear grants it: the id of that Item. */
export const GRANTED_FLAG = "grantedBy";

/** What an item that holds other items says, which is how a Storage item is told from an accessory. */
const STORAGE = /^\s*holds (?:up to \w+|an unlimited amount of) weapons\/items\b/i;

/**
 * Is an item that is equipped for its effect a Storage item, by what its Effect says?
 * @param {string} [effect]
 * @returns {boolean}
 */
export function isStorage(effect) {
  return STORAGE.test(String(effect ?? ""));
}

/**
 * The HP an item that is equipped for its effect restores to its unit when it is Used, as a Goddess Ring does:
 * "Unit can restore 10 HP to themselves as an action."
 * @param {string} [effect]
 * @returns {number}        0 for an item that is not Used so
 */
export function wornRestore(effect) {
  const found = /\bcan restore (\d+) HP to themselves as an action\b/i.exec(String(effect ?? ""));
  return found ? Number(found[1]) : 0;
}

/** The seven stats "all stats" stands for. */
const ALL_STATS = ["str", "mag", "def", "res", "dex", "spd", "luk"];

/** What a number of a bonus is added to, by the name the tabs give it. Longer names come first. */
const NAMES = [
  ["all stats", { all: true }],
  ["max hp", { hpMax: true }],
  ["critical avoid", { combat: "critAvoid" }],
  ["skill activation rate", { combat: "activation" }],
  ["skill activation chance", { combat: "activation" }],
  ["block chance", { block: true }],
  ["accuracy", { combat: "hit" }],
  ["critical", { combat: "critical" }],
  ["damage", { combat: "damage" }],
  ["might", { might: true }],
  ["dodge", { combat: "dodge" }],
  ["crit", { combat: "critical" }],
  ["hit", { combat: "hit" }],
  ["atk", { combat: "damage" }],
  ["end", { endurance: true }],
  ["hst", { haste: true }],
  ["str", { stat: "str" }],
  ["mag", { stat: "mag" }],
  ["def", { stat: "def" }],
  ["res", { stat: "res" }],
  ["dex", { stat: "dex" }],
  ["spd", { stat: "spd" }],
  ["luk", { stat: "luk" }],
  ["mov", { stat: "mov" }],
  ["con", { stat: "con" }],
  ["los", { stat: "los" }],
  ["mt", { might: true }],
  ["hp", { growthOnly: "hp" }]
];
const NAME = `(?:${NAMES.map(([name]) => name.replace(/ /g, "\\s+")).join("|")})\\b`;
const NAME_LIST = `${NAME}(?:\\s*(?:,\\s*and\\b|,|/|&|\\band\\b)\\s*${NAME})*`;

/** One number for one or more of those, at the head of a text: "+3 DEF and RES", "+15% SPD growth rate". */
const BONUS = new RegExp(`^(?:\\s*(?:,|\\band\\b|\\bas well as\\b))*\\s*([+\\-\\u2212\\u2013])\\s*(\\d+)(%?)\\s*(?:to\\s+)?(${NAME_LIST})(\\s+growths?(?:\\s+rates?)?)?`, "i");

/** The kinds of weapon the tabs name, as a condition of a skill names them (see `weaponIs`). */
const KINDS = {
  sword: ["sword"], swords: ["sword"], lance: ["lance"], lances: ["lance"], axe: ["axe"], axes: ["axe"],
  bow: ["bow", "crossbow"], bows: ["bow", "crossbow"], crossbow: ["crossbow"], crossbows: ["crossbow"],
  bolt: ["bolt"], bolts: ["bolt"], knife: ["knife"], knives: ["knife"], staff: ["staff"], staves: ["staff"],
  anima: ["anima"], fire: ["fire"], thunder: ["thunder"], wind: ["wind"], water: ["water", "ice"], ice: ["ice"],
  earth: ["earth"], light: ["light"], dark: ["dark"], magic: ["magic"], eye: ["eye"]
};

/** The skills a clause may grant are written as names: capitals, and nothing that looks like a number. */
const SKILL_NAME = /^[A-Z][A-Za-z' -]*\+?$/;

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const number = (sign, digits) => Number(digits) * ((sign === "+") ? 1 : -1);

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

/**
 * Read a list of kinds of weapon: "Bows and Bolts", "Dark magic and Eye", "any Magic", "Light magic and Staves".
 * @param {string} text
 * @returns {string[]|null}     Null where a word of it is no kind of weapon; empty for "all weapons"
 */
function readKinds(text) {
  const bare = clean(text).replace(/\b(?:tomes?|weapons?|magic users|users)\b/gi, (word) => (/magic/i.test(word) ? "magic" : "")).trim();
  if ( /^all$/i.test(bare) ) return [];
  const kinds = [];
  for ( const part of bare.split(/\s*(?:,|\band\b|\bor\b|\/)\s*/).filter(Boolean) ) {
    const word = part.replace(/^any\s+/i, "").replace(/\s+magic$/i, "").trim().toLowerCase();
    const found = KINDS[word];
    if ( !found ) return null;
    for ( const kind of found ) if ( !kinds.includes(kind) ) kinds.push(kind);
  }
  return kinds.length ? kinds : null;
}

/**
 * Read a list of Special Qualities: "Mounted", "Laguz, Beast", "Armored and Mounted".
 * @param {string} text
 * @returns {string[]|null}     Null where a word of it is no Special Quality
 */
function readQualities(text) {
  const found = [];
  for ( const part of clean(text).split(/\s*(?:,|\band\b|\bor\b|\/)\s*/).filter(Boolean) ) {
    const quality = FEO.specialQualities.find((name) => name.toLowerCase() === part.toLowerCase());
    if ( !quality ) return null;
    found.push(quality);
  }
  return found.length ? found : null;
}

/**
 * Read what a bonus hangs on, as the words after its numbers say: "with Light tomes", "against Mounted units",
 * "when at 50% HP or less", "at 1 range".
 * @param {string} text
 * @returns {{when: object, carried?: boolean}|null}      Null where the words say something else
 */
function readWhen(text) {
  const words = clean(text).replace(/[.]$/, "");
  if ( !words ) return { when: {} };
  let match;
  if ( /^while equipped$/i.test(words) ) return { when: {} };
  if ( /^(?:when|while) in (?:the )?inventory$/i.test(words) ) return { when: {}, carried: true };
  if ( (match = /^(?:(?:when|while)\s+)?(?:using|with)\s+(.+)$/i.exec(words)) ) {
    const kinds = readKinds(match[1]);
    return kinds ? { when: kinds.length ? { weapon: kinds } : {} } : null;
  }
  if ( (match = /^when at (\d+)% (?:hp|health) or (?:less|lower|below)$/i.exec(words)) ) return { when: { hp: { op: "le", percent: Number(match[1]) } } };
  if ( /^when (?:this )?(?:unit|user) (?:has|is at) (?:100% hp|full hp)$/i.test(words) ) return { when: { hp: { op: "full" } } };
  if ( /^(?:if|when) (?:the )?(?:enemy|foe) initiates(?: combat)?$/i.test(words) ) return { when: { role: "defending" } };
  if ( /^(?:when|if) (?:(?:this )?(?:unit|user) )?(?:initiating|initiates)(?: combat)?$/i.test(words) ) return { when: { role: "initiating" } };
  if ( /^when counter-?attacking$/i.test(words) ) return { when: { role: "defending" } };
  if ( (match = /^at (\d+) range$/i.exec(words)) ) return { when: { range: { min: Number(match[1]), max: Number(match[1]) } } };
  if ( !(match = /^against\s+(.+)$/i.exec(words)) ) return null;

  const foe = match[1];
  if ( /^targets in water$/i.test(foe) ) return { when: { foeOn: ["water", "river"] } };
  if ( /^physical ranged attacks$/i.test(foe) ) return { when: { foeWeapon: ["physical"], range: { min: 2 } } };
  let kinds = null;
  if ( (match = /^(.+?)-wielding (?:enemies|units|foes)$/i.exec(foe)) ) kinds = readKinds(match[1]);
  else if ( (match = /^(?:units |enemies |foes )?wielding (.+)$/i.exec(foe)) ) kinds = readKinds(match[1]);
  else if ( /^magic users$/i.test(foe) ) kinds = ["magic"];
  else if ( /\bmagic\b/i.test(foe) ) kinds = readKinds(foe);
  if ( kinds?.length ) return { when: { foeWeapon: kinds } };
  if ( (match = /^(.+?)\s+(?:units?|enemies|foes)$/i.exec(foe)) ) {
    const qualities = readQualities(match[1]);
    if ( qualities ) return { when: { foeQuality: qualities } };
  }
  return null;
}

/* -------------------------------------------- */
/*  Bonuses                                     */
/* -------------------------------------------- */

/**
 * Read a clause that is nothing but bonuses and what they hang on: "+5 SPD", "Unit gains +3 Might, +5 Critical
 * and +10 Hit/Dodge when using Anima tomes", "+10 DEF and RES against Dragon units", "+15% Max HP".
 * @param {string} text
 * @returns {{effects: object[], carried?: boolean}|null}     Null for a clause that says something else
 */
function readBonus(text) {
  let rest = clean(text).replace(/^(?:(?:this\s+)?(?:unit|user|wielder)\s+)?(?:gains?|gets|has|grants?)\s+/i, "");
  rest = rest.replace(/\s+and\s+loses\s+(?=[-−–])/i, ", ");
  const effect = {};
  const put = (key, part, amount) => {
    effect[key] ??= {};
    effect[key][part] = (effect[key][part] ?? 0) + amount;
  };
  let found = 0;
  for ( let match = BONUS.exec(rest); match; match = BONUS.exec(rest) ) {
    const amount = number(match[1], match[2]);
    const percent = !!match[3];
    const growth = !!match[5];
    for ( const [name, what] of NAMES ) {
      if ( !new RegExp(`(^|[^a-z])${name.replace(/ /g, "\\s+")}([^a-z]|$)`, "i").test(match[4]) ) continue;

      // A longer name holds a shorter one: "Critical Avoid" is no Critical, "Max HP" no growth of HP
      if ( (name === "critical") && /critical\s+avoid/i.test(match[4]) && !/critical(?!\s+avoid)/i.test(match[4]) ) continue;
      if ( (name === "hp") && /max\s+hp/i.test(match[4]) ) continue;
      if ( growth ) {
        const key = what.stat ?? what.growthOnly;
        if ( !percent || !key ) return null;
        put("growths", key, amount);
        continue;
      }
      if ( what.hpMax ) {
        effect.hpMax = percent ? { of: "hpMax", times: amount / 100 } : (effect.hpMax ?? 0) + amount;
        continue;
      }
      if ( percent || what.growthOnly ) return null;
      if ( what.all ) for ( const key of ALL_STATS ) put("stats", key, amount);
      else if ( what.stat ) put("stats", what.stat, amount);
      else if ( what.combat ) put("combat", what.combat, amount);
      else if ( what.might ) effect.might = (effect.might ?? 0) + amount;
      else if ( what.endurance ) effect.endurance = (effect.endurance ?? 0) + amount;
      else if ( what.haste ) effect.haste = (effect.haste ?? 0) + amount;
      else if ( what.block ) put("block", "chance", amount);
    }
    rest = rest.slice(match[0].length);
    found++;
  }
  if ( !found ) return null;
  const hangs = readWhen(rest.replace(/^\s*,\s*/, ""));
  if ( !hangs ) return null;

  // Growth rates are no part of a fight: a condition on them cannot be judged
  if ( effect.growths && Object.keys(hangs.when).length ) return null;
  const out = Object.keys(hangs.when).length ? { when: hangs.when, ...effect } : effect;
  return { effects: [out], ...(hangs.carried ? { carried: true } : {}) };
}

/* -------------------------------------------- */
/*  Phrases                                     */
/* -------------------------------------------- */

/** A list of stats, as "STR and MAG" or "DEF/RES", as the keys of a lasting change. */
function statList(text, amount) {
  const stats = {};
  for ( const part of clean(text).split(/\s*(?:,|\band\b|\/)\s*/).filter(Boolean) ) {
    const key = part.toLowerCase();
    if ( !(key in FEO.stats) ) return null;
    stats[key] = amount;
  }
  return Object.keys(stats).length ? stats : null;
}

/** What a debuff a hit leaves on the foe is written as: a combat number or stats. */
function foeChange(names, amount) {
  if ( /^dodge$/i.test(names) ) return { combat: { dodge: amount } };
  if ( /^hit$/i.test(names) ) return { combat: { hit: amount } };
  const stats = statList(names, amount);
  return stats ? { stats } : null;
}

const done = (...effects) => ({ effects });
const KEPT = { kept: true };
const NOTE = { note: true };
const TABLE = { table: true };
const sure = (on) => ({ on, sure: true });

/** The move a Mounted or Flying unit makes after most Actions, as Canto+ has it. */
const CANTO_PLUS = {
  canto: { after: ["attack", "item", "trade", "rescue", "refresh", "staff", "skill", "shift", "object", "visit", "arrive", "seize"], except: ["Hold", "Bastion"] }
};

/**
 * What a clause can be, tried in this order: the pattern it matches whole, and what it then is. A reader may
 * return null for a clause that only looks the part.
 * @type {[RegExp, (match: RegExpExecArray, about: {kind: string}) => object|null][]}
 */
const PHRASES = [
  // Read where a weapon's Effect is used, as they always were
  [/^\(\s*\d+\s*[-−–]\s*LUK\s*\)\s*%\s*(?:chance\s+)?of damaging (?:the )?wielder instead of (?:the )?target$/i, () => KEPT],
  [/^(?:can only attack at )?midrange$/i, () => KEPT],
  [/^\d+\s*x\s+strikes(?:\s+when\s+(?:initiating(?:\s+combat)?|attacking\s+at\s+\d+\s+range))?$/i, () => KEPT],
  [/^(?:mag not str|str not mag|uses str instead of mag)$/i, () => KEPT],
  [/^[a-z]+ for magic(?:al)? weapon triangle$/i, () => KEPT],
  [/^acts as a shield against physical attacks, with .+ block rate and \d+ def$/i, () => KEPT],
  [/^if weapon was equipped at the start of unit's turn, it'?s next attack gains \+\d+ might per space moved$/i, () => KEPT],
  [/^can be equipped without \w+ rank$/i, () => KEPT],
  [/^combat can be initiated with (?:this )?staff even if user does not have staff training$/i, () => KEPT],

  // What only says how the rest is read
  [/^amount stolen is determined by the gm$/i, () => NOTE],
  [/^negated by forecast$/i, () => NOTE],
  [/^enemy still makes a follow-?up if they can$/i, () => NOTE],

  // What is done by Using the item, which the sheet sees to (see `GearData`)
  [/^unit can restore \d+ hp to themselves as an action$/i, () => ({ used: true })],
  [/^which causes \d+% damage per turn instead of \d+%$/i, () => NOTE],
  [/^stacks with the bargain skill$/i, () => NOTE],
  [/^other additional attacks \(.*\) can happen during these$/i, () => NOTE],
  [/^if unit has smite or (?:a )?similar skill, increase knockback by \+1$/i, () => NOTE],

  // What the table still does by hand, and no reader of a weapon's Effect should take for anything else
  [/^can be used to counter-?attack while holding .+$/i, () => TABLE],
  [/^does not damage flying units$/i, () => TABLE],
  [/^rock is armored$/i, () => TABLE],
  [/^effective against non-terror units$/i, () => TABLE],
  [/^if unit has the flying quality, they suffer double the effects of squall$/i, () => TABLE],

  // Skills
  [/^grants? (.+?)( to (?:the )?unit)?( when not equipped)?$/i, (match) => {
    const names = match[1].split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
    if ( !names.length || names.some((name) => !SKILL_NAME.test(name) || readQualities(name) || /^midrange$/i.test(name)) ) return null;
    return { grants: names.map((name) => ({ name, while: match[3] ? "stowed" : "equipped" })) };
  }],
  [/^activates (.+?) every attack$/i, (match) => (SKILL_NAME.test(match[1])
    ? { grants: [{ name: match[1], while: "equipped" }], effects: [{ assures: [match[1]] }] } : null)],

  // The fight: who attacks, how often and in what order
  [/^(?:unit|user) makes \+(\d) additional attacks?$/i, (match) => done(...Array.from({ length: Number(match[1]) }, () => ({ extraAttack: { percent: 100 } })))],
  [/^unit makes an additional attack after their first with 1\/3rd final damage$/i, () => done({ extraAttack: { percent: 100 / 3 } })],
  [/^using only 1 use$/i, () => done({ rules: ["oneUsePerFight"] })],
  [/^unit always goes first in combat$/i, () => done({ rules: ["first"] })],
  [/^unit attacks last in combat$/i, () => done({ rules: ["foeFirst"] })],
  [/^unit can follow-?up before foe can counter-?attack$/i, () => done({ proc: sure("start"), order: "press" })],
  [/^(?:foes?|enem(?:y|ies)) cannot counter-?attack$/i, () => done({ rules: ["foeNoCounter"] })],
  [/^if unit initiates combat, target cannot counter-?\s*attack$/i, () => done({ when: { role: "initiating" }, rules: ["foeNoCounter"] })],
  [/^negates enemy'?s counter-?attacks when this unit'?s res is higher$/i, () => done({ when: { compare: { left: "res", right: "res", margin: 1 } }, rules: ["foeNoCounter"] })],
  [/^unit and foe cannot counter-?attack$/i, () => done({ rules: ["noCounter", "foeNoCounter"] })],
  [/^cannot (?:double|follow-?up)$/i, () => done({ rules: ["noFollowUp"] })],
  [/^cannot crit(?:ical)?$/i, () => done({ rules: ["noCrit"] })],
  [/^cannot crit(?:ical)? or follow-?up$/i, () => done({ rules: ["noCrit", "noFollowUp"] })],
  [/^cannot critical, follow-?up or activate skills$/i, () => ({ effects: [{ rules: ["noCrit", "noFollowUp"] }], also: "activating no skills with it" })],
  [/^always hits$/i, () => done({ rules: ["sureHit"] })],

  // The Weapon Triangle
  [/^reverses (?:weapon triangle|magic triangle|anima pentagon)$/i, () => done({ rules: ["reverseTriangle"] })],
  [/^negates weapon triangle$/i, () => done({ rules: ["noTriangle"] })],
  [/^doubles weapon triangle effects on unit and foe$/i, () => done({ triangle: { times: 2 } })],

  // What an attack is resisted with, and what it ignores
  [/^targets res(?: instead of def| not def)?$/i, () => done({ against: "res" })],
  [/^targets def(?: instead of res| not res)?$/i, () => done({ against: "def" })],
  [/^ignores def and shields$/i, () => ({ effects: [{ ignoreDefence: 100 }], kept: true })],
  [/^ignore'?s? foe'?s res$/i, () => done({ proc: sure("attack"), ignore: { percent: 100, stat: "res" } })],
  [/^unit negates (\d+)% of foe'?s def\/res$/i, (match) => done({ proc: sure("attack"), ignore: { percent: Number(match[1]) } })],

  // Effective damage
  [/^effective against (.+)$/i, (match) => {
    const hangs = readWhen(`against ${match[1]}`);
    return hangs?.when.foeWeapon ? done({ proc: sure("attack"), when: hangs.when, effective: true }) : null;
  }],
  [/^effective against units without any special qualities$/i, () => done({ proc: sure("attack"), when: { foeNoQuality: true }, effective: true })],
  [/^effectiveness deals (\d)x might instead of 3x$/i, (match) => done({ effectiveMultiplier: Number(match[1]) })],
  [/^negates bonus damage against the unit with this item equipped$/i, () => done({ rules: ["noEffective"] })],
  [/^negates effectivity on all attacks to the unit for being (\w+) at the cost of 1 use on hit, regardless of blocking or not$/i, (match) => {
    const quality = readQualities(match[1]);
    return quality ? { effects: [{ uneffective: quality }], also: "the Use each such hit costs the Shield" } : null;
  }],

  // Critical hits
  [/^critical hits deal (\d)x damage instead of 3x(?: damage)?$/i, (match) => done({ critMultiplier: Number(match[1]) })],
  [/^negates any critical hits against the unit with this item equipped$/i, () => done({ rules: ["foeNoCrit"] })],
  [/^negates criticals, effective damage and grants \+(\d+) (res|def)$/i, (match) => done({ rules: ["foeNoCrit", "noEffective"], stats: { [match[2].toLowerCase()]: Number(match[1]) } })],
  [/^negates foe'?s critical hits and activation skills$/i, () => ({ effects: [{ rules: ["foeNoCrit"] }], also: "negating the foe's activation skills" })],
  [/^unit'?s critical chance cannot go below (\d+)%$/i, (match) => done({ critFloor: Number(match[1]) })],

  // Damage dealt and taken
  [/^halves (?:any )?damage (?:this unit would take|taken during combat)$/i, () => done({ takenPercent: -50 })],
  [/^halves damage taken from (?:units with the )?(\w+)(?: units| special quality)$/i, (match) => {
    const quality = readQualities(match[1]);
    return quality ? done({ when: { foeQuality: quality }, takenPercent: -50 }) : null;
  }],
  [/^increases final damage by 1\.(\d+)x against targets without the (\w+) quality$/i, (match) => {
    const quality = readQualities(match[2]);
    return quality ? done({ when: { foeLacks: quality }, dealtPercent: Number(match[1].padEnd(2, "0")) }) : null;
  }],
  [/^counter-?attacks deal 2x damage$/i, () => done({ when: { role: "defending" }, damageMultiplier: 2 })],
  [/^might is doubled when counter-?attacking$/i, () => done({ when: { role: "defending" }, might: { of: "weaponMight" } })],
  [/^(?:user|unit) has a dex% chance to halve magical damage$/i, () => done({ proc: { on: "struck", stat: "dex" }, when: { foeWeapon: ["magic"] }, negate: 50 })],
  [/^deals ½ to enemy units adjacent to the target$/i, () => done({
    proc: sure("hit"), damaged: true, spread: { who: "enemy", around: "foe", within: 1, damage: { of: "dealt", div: 2 } }
  })],
  [/^if this unit initiates combat, enemy receives (\d+) damage after combat$/i, (match) => done({ proc: sure("after"), when: { role: "initiating" }, retaliate: Number(match[1]) })],
  [/^user takes (\d+) damage when initiating combat$/i, (match) => done({ proc: sure("start"), when: { role: "initiating" }, pays: Number(match[1]) })],

  // Might read from the unit
  [/^adds 1\/4th, half, and all of unit'?s con to might, critical and hit respectively$/i, () => done({
    might: { of: "con", div: 4 }, combat: { critical: { of: "con", div: 2 }, hit: { of: "con" } }
  })],
  [/^adds unit'?s con to might, hit and critical$/i, () => done({ might: { of: "con" }, combat: { hit: { of: "con" }, critical: { of: "con" } } })],
  [/^con is added to might$/i, () => done({ might: { of: "con" } })],
  [/^adds 50% of spd to might$/i, () => done({ might: { of: "spd", div: 2 } })],
  [/^\+(\d+) mt for each ally in a (\d+) space radius$/i, (match) => done({ might: { count: { who: "ally", within: Number(match[2]) }, times: Number(match[1]) } })],
  [/^increases? might by the amount of stat debuffs on foe$/i, () => done({ might: { of: "foeDebuffs" } })],
  [/^mt = enemy'?s mt$/i, () => done({ might: { of: "foeWeaponMight" } })],

  // Healing
  [/^(?:gain|heal) hp equal to (½ |half (?:of )?)?(?:the )?damage(?: dealt)?$/i, (match) => done({ proc: sure("attack"), heal: match[1] ? 50 : 100 })],
  [/^unit heals for damage dealt$/i, () => done({ proc: sure("attack"), heal: 100 })],
  [/^unit heals (\d+) hp on hit$/i, (match) => done({ proc: sure("hit"), recover: Number(match[1]) })],
  [/^(?:unit )?(?:restores|heals) (\d+) hp (?:each turn|per turn|at the start of (?:their|each|its) turn)$/i, (match) => done({ proc: sure("turnStart"), recover: Number(match[1]) })],
  [/^heals unit for (\d+) hp at the start of each turn$/i, (match) => done({ proc: sure("turnStart"), recover: Number(match[1]) })],
  [/^doubles the effects of all restorative items$/i, () => done({ proc: sure("itemHeal"), healTimes: 2 })],
  [/^unit heals self and allies for (\d+)% more with staves and healing items$/i, (match) => done({ staffHeal: { more: Number(match[1]) } })],

  // What a hit leaves on the foe
  [/^inflicts (-\d+) ([a-z/ ,]+?) on (?:foe|enemy|target)(?:, | )until the end of their next turn$/i, (match) => {
    const change = foeChange(match[2], Number(match[1]));
    return change ? done({ proc: sure("hit"), grant: { to: "foe", effects: [change], ends: "turnEnd", next: true } }) : null;
  }],
  [/^inflicts (-\d+) ([a-z/ ,]+?) on hit$/i, (match) => {
    const change = foeChange(match[2], Number(match[1]));
    return change ? done({ proc: sure("hit"), grant: { to: "foe", effects: [change], ends: "turnEnd", next: true } }) : null;
  }],
  [/^inflicts (-\d+) ([a-z/ ,]+?) on (?:target|enemy|foe) after combat for a turn$/i, (match) => {
    const change = foeChange(match[2], Number(match[1]));
    return change ? done({ proc: sure("after"), ifHit: true, grant: { to: "foe", effects: [change], ends: "turnEnd", next: true } }) : null;
  }],
  [/^inflicts (-\d+) ([a-z/ ,]+?) on enemy until user'?s next turn$/i, (match) => {
    const change = foeChange(match[2], Number(match[1]));
    return change ? done({ proc: sure("hit"), grant: { to: "foe", effects: [change], ends: "turnStart", clock: "giver" } }) : null;
  }],
  [/^halves target'?s mov for a turn on hit$/i, () => done({
    proc: sure("hit"), grant: { to: "foe", effects: [{ statTimes: { mov: 0.5 } }], ends: "turnEnd", next: true }
  })],
  [/^after this unit initiates combat, target gets (-\d+) ([a-z/ ]+?) until it'?s next turn$/i, (match) => {
    const stats = statList(match[2], Number(match[1]));
    return stats ? done({ proc: sure("after"), when: { role: "initiating" }, grant: { to: "foe", effects: [{ stats }], ends: "turnStart" } }) : null;
  }],

  [/^at start of this unit'?s turn, enemies in a (\d+)-space radius lose (-\d+) ([a-z ]+?) until the end of the turn$/i, (match) => {
    const stats = statList(match[3], Number(match[2]));
    return stats ? done({ proc: sure("turnStart"), grant: { reach: { who: "enemy", within: Number(match[1]) }, effects: [{ stats }], ends: "turnEnd" } }) : null;
  }],

  // What a fight leaves on the unit
  [/^after this unit initiates combat, this unit gets \+(\d+) ([a-z/ ]+?) until it'?s next turn$/i, (match) => {
    const stats = statList(match[2], Number(match[1]));
    return stats ? done({ proc: sure("after"), when: { role: "initiating" }, grant: { to: "self", effects: [{ stats }], ends: "turnStart" } }) : null;
  }],
  [/^\+(\d+) to ([a-z, ]+?) after landing a critical hit until the end of the unit'?s next turn$/i, (match) => {
    const stats = statList(match[2], Number(match[1]));
    return stats ? done({ proc: sure("crit"), grant: { to: "self", effects: [{ stats }], ends: "turnEnd", next: true } }) : null;
  }],

  // Moving units
  [/^if unit initiates combat, enemy is knocked backwards by 1 tile$/i, () => done({ proc: sure("after"), when: { role: "initiating" }, step: { move: "shove" } })],
  [/^if unit hits enemy during combat, enemy is knocked backwards by 1 tile, or increases their knockback by \+1$/i, () => done({ proc: sure("after"), ifHit: true, step: { move: "shove" } })],
  [/^pushes enemy backwards 1 tile after combat if unit lands an attack$/i, () => done({ proc: sure("after"), ifHit: true, step: { move: "shove" } })],
  [/^user cannot be forcibly moved$/i, () => done({ rules: ["rooted"] })],

  // Terrain and movement
  [/^negates foe'?s terrain effects on forests\/thickets\/wardwood$/i, () => done({ when: { foeOn: ["forest", "thicket", "wardwood"] }, rules: ["foeNoTerrain"] })],
  [/^negates foe'?s terrain effects$/i, () => done({ rules: ["foeNoTerrain"] })],
  [/^user can traverse water\/sea\/ocean\/river tiles at no movement penalty$/i, () => done({ crossing: { kinds: ["water"], free: ["water", "river"] } })],
  [/^increases user'?s mov by (\d+)%$/i, (match) => done({ statPercent: { mov: Number(match[1]) } })],
  [/^unit can move the remainder of it'?s movement after most actions, as though it had the mounted or flying special qualities$/i, () => done(CANTO_PLUS)],
  [/^unit gains a second full action and movement every turn$/i, () => done({ proc: sure("action"), acts: { mov: "full", once: "turn" } })],

  // Reach
  [/^(?:unit gains )?\+(\d+) range with (.+)$/i, (match) => {
    const kinds = readKinds(match[2]);
    return kinds?.length ? done({ when: { weapon: kinds }, weaponRange: { add: Number(match[1]) } }) : null;
  }],
  [/^increases the range of all magic tomes by (\d+)$/i, (match) => done({ when: { weapon: ["magic"] }, weaponRange: { add: Number(match[1]) } })],

  // Wear, gold and experience
  [/^unit'?s attacks do not consume weapon uses$/i, () => done({ proc: sure("start"), freeUses: true })],
  [/^steals gold from target upon a successful hit, once per enemy$/i, () => done({
    proc: sure("hit"), when: { foeUnmarked: "Robbed" }, loot: { gold: "foe", once: "foe" },
    grant: { to: "foe", name: "Robbed", mark: true, effects: [], ends: "map" }
  })],
  [/^(?:user|unit) gains (?:2x|double) exp$/i, () => done({ expMultiplier: 2 })],
  [/^unit gains double wexp$/i, () => done({ rules: ["doubleWexp"] })],
  [/^increases (.+?) growths? by (\d+)%$/i, (match) => {
    const growths = {};
    for ( const part of match[1].split(/\s*(?:,|\band\b)\s*/).filter(Boolean) ) {
      const key = part.toLowerCase();
      if ( (key !== "hp") && (!(key in FEO.stats) || ["mov", "con", "los"].includes(key)) ) return null;
      growths[key] = Number(match[2]);
    }
    return Object.keys(growths).length ? done({ growths }) : null;
  }],
  [/^increases all growth rates by (\d+)% while in inventory$/i, (match) => ({
    effects: [{ growths: Object.fromEntries(["hp", ...ALL_STATS].map((key) => [key, Number(match[1])])) }], carried: true
  })],
  [/^increases skill activation chance by (\d+)$/i, (match) => done({ combat: { activation: Number(match[1]) } })],

  // Conditions
  [/^unit is immune to (\w+)$/i, (match) => {
    const id = Object.keys(FEO.conditions).find((key) => key.toLowerCase() === match[1].toLowerCase());
    return id ? done({ nullify: { percent: 100, only: [id] } }) : null;
  }],
  [/^negates all status conditions and stat debuffs$/i, () => done({ nullify: 100 }, { debuffs: { negate: true } })],
  [/^unit gains (\d+)% to burn on hit$/i, (match) => done({ proc: { on: "hit", percent: Number(match[1]), fixed: true }, inflicts: ["burn"] })],

  // Chances of an accessory's own
  [/^unit gains a (\d+)% chance to make an immediate additional attack when attacking$/i, (match) => done({
    proc: { on: "attack", percent: Number(match[1]), fixed: true }, sequence: [{}, {}]
  })],

  // Knacks, which the map and the Market read
  [/^unit can use the steal action$/i, () => done({ steal: { use: true } })],
  [/^unit receives a (\d+)% discount in shops$/i, (match) => done({ discount: Math.min(Number(match[1]), 100) })],

  // The units around
  [/^grants \+(\d+) ([a-z/]+) to allies within (\d+) spaces$/i, (match) => {
    const stats = statList(match[2], Number(match[1]));
    return stats ? done({ aura: { who: "ally", within: Number(match[3]) }, stats }) : null;
  }],
  [/^boosts unit'?s and adjacent allies'? hit and critical by (\d+)$/i, (match) => done({
    aura: { who: "ally", within: 1, self: true }, combat: { hit: Number(match[1]), critical: Number(match[1]) }
  })],

  // Changing form
  [/^\+(\d+) (?:dragon|beast) form\/turn$/i, (match) => done({ shift: { transforms: Number(match[1]) } })],
  [/^\+(\d+) shift gauge\/turn$/i, (match) => done({ shift: { turnHuman: Number(match[1]), turnAnimal: Number(match[1]) } })],
  [/^combat consumes (\d+) shift gauge less$/i, (match) => done({ shift: { combatAnimal: Number(match[1]) } })],

  // The Lantern: its light counts while it is equipped; its fuel and its throw are the table's
  [/^grants \+(\d+) los while equipped for up to \d+ turns, refuelable using lantern oil$/i, (match) => ({
    effects: [{ stats: { los: Number(match[1]) } }], also: "its 6 Turns of fuel and refuelling it with Lantern Oil"
  })]
];

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * What one clause is: the first phrase it matches whole, a bonus, something another reader takes, or nothing.
 * @param {string} clause
 * @param {{kind: string}} about
 * @returns {object|null}
 */
function readClause(clause, about) {
  const text = clean(clause).replace(/[.]$/, "");
  if ( !text ) return NOTE;
  for ( const [pattern, make] of PHRASES ) {
    const match = pattern.exec(text);
    const made = match ? make(match, about) : null;
    if ( made ) return made;
  }
  const bonus = readBonus(text);
  if ( bonus ) return bonus;

  // Read where a weapon's Effect is used: the Special Qualities it is effective against, in a clause of their
  // own, and the conditions it inflicts
  if ( about.kind === "weapon" ) {
    if ( readQualities(text) ) return KEPT;
    if ( !text.includes(",") && inflictions(text).length ) return KEPT;
  }
  return null;
}

const cache = new Map();

/**
 * Read the Effect of a weapon, an accessory or a Shield.
 * @param {string} [effect]
 * @param {object} [about]
 * @param {"weapon"|"accessory"|"shield"} [about.kind]
 * @returns {GearReading}
 */
export function readGear(effect, { kind = "weapon" } = {}) {
  const key = `${kind}\n${effect ?? ""}`;
  if ( cache.has(key) ) return cache.get(key);
  const read = { effects: [], carried: [], grants: [], left: [], kept: "", read: 0 };
  const kept = [];
  const about = { kind };
  const take = (made, text, into) => {
    read.read += made.note ? 0 : 1;
    if ( made.kept ) into.push(text);
    if ( made.table ) read.left.push(text);
    if ( made.also ) read.left.push(made.also);
    for ( const one of made.effects ?? [] ) (made.carried ? read.carried : read.effects).push(structuredClone(one));
    for ( const grant of made.grants ?? [] ) read.grants.push({ ...grant });
  };

  for ( const sentence of String(effect ?? "").replace(/\s*\n\s*/g, " ").split(/[.;](?:\s+|$)/) ) {
    const whole = clean(sentence);
    if ( !/[a-z]/i.test(whole) ) continue;
    const into = [];

    // A sentence is one clause where it reads as one; otherwise its commas divide it, and so does an "and"
    // that begins something of its own. A clause may hold commas itself, so the longest run that reads wins
    const all = (whole.includes(",") || /\s+and\s+/i.test(whole)) ? readClause(whole, about) : null;
    if ( all ) take(all, whole, into);
    else {
      const pieces = whole.split(/,\s*/).flatMap((piece) => {
        return piece.split(/\s+and\s+(?=(?:(?:unit|user)\s+)?(?:heals|grants|gains|inflicts|negates|increases)\b)/i);
      }).map((piece) => clean(piece).replace(/^and\s+/i, "")).filter(Boolean);
      const parts = [];
      for ( let start = 0; start < pieces.length; ) {
        let end = pieces.length;
        let made = null;
        for ( ; end > start; end-- ) {
          made = readClause(pieces.slice(start, end).join(", "), about);
          if ( made ) break;
        }
        if ( !made ) end = start + 1;
        parts.push({ made, text: pieces.slice(start, end).join(", ") });
        start = end;
      }

      // A sentence nothing of which reads is left whole, in its own words; what does not read of one that
      // partly does is left piece by piece. Either way the readers of a weapon's Effect still see it
      if ( parts.every((part) => !part.made) ) {
        read.left.push(whole);
        into.push(whole);
      }
      else {
        let open = null;
        for ( const part of parts ) {
          if ( part.made ) {
            take(part.made, part.text, into);
            open = null;
            continue;
          }
          if ( open === null ) open = read.left.push(part.text) - 1;
          else read.left[open] += `, ${part.text}`;
          into.push(part.text);
        }
      }
    }
    if ( into.length ) kept.push(into.join(", "));
  }
  read.kept = kept.join(". ");

  // Of a Shield only what it does beyond blocking is read here; its blocking is read by `readShield`
  if ( kind === "shield" ) read.left = [];
  cache.set(key, read);
  return read;
}

/* -------------------------------------------- */

/**
 * What is left of a weapon's Effect for whoever reads it as words: what it is effective against, the
 * conditions it inflicts, how often it strikes. The clauses that were turned into effects are gone from it.
 * A staff's Effect says what it does to its target, and is left whole.
 * @param {{category?: string, effect?: string}|null} weapon
 * @returns {string}
 */
export function plainEffect(weapon) {
  if ( !weapon?.effect ) return "";
  if ( weapon.category === "staff" ) return weapon.effect;
  return readGear(weapon.effect, { kind: "weapon" }).kept;
}

/* -------------------------------------------- */

/**
 * What a piece of gear gives its unit as one more skill of the unit: an entry the skill rules read like that of
 * an equipped skill, which Nihil does not cancel and which takes none of its skill slots, but which is gear,
 * so that what cancels equipment in a fight cancels it.
 * @param {string} name               What it goes by in fights and on cards: the name of the gear
 * @param {object[]} effects
 * @returns {{name: string, innate: true, gear: true, nihil: false, effects: object[]}|null}    Null for gear
 *          that gives nothing
 */
export function gearEntry(name, effects) {
  return effects?.length ? { name, innate: true, gear: true, nihil: false, effects } : null;
}

/* -------------------------------------------- */

/**
 * The skills a unit's gear grants it, by name: those of what it has equipped, and those of what it carries
 * that are granted while it is not equipped. A skill is listed once, under the first piece of gear that grants it.
 * @param {{name: string, kind: "weapon"|"accessory"|"shield", effect?: string, category?: string, equipped?: boolean,
 *   broken?: boolean}[]} gear      What the unit carries that may grant skills
 * @returns {{skill: string, from: string}[]}
 */
export function grantedSkills(gear = []) {
  const found = [];
  for ( const piece of gear ) {
    if ( piece.broken || (piece.category === "staff") ) continue;
    for ( const grant of readGear(piece.effect, { kind: piece.kind }).grants ) {
      if ( (grant.while === "equipped") !== !!piece.equipped ) continue;
      if ( !found.some((entry) => entry.skill.toLowerCase() === grant.name.toLowerCase()) ) found.push({ skill: grant.name, from: piece.name });
    }
  }
  return found;
}

/* -------------------------------------------- */

/**
 * How far the system applies the Effect of a piece of gear by itself: all of it ("done"), some of it ("part")
 * or none ("text"), with what is left to the table.
 * @param {string} [effect]
 * @param {object} [about]
 * @param {"weapon"|"accessory"|"shield"} [about.kind]
 * @param {(name: string) => boolean} [about.hasSkill]     Is there a skill of this name to grant?
 * @returns {{state: "done"|"part"|"text", left: string[]}}
 */
export function gearCoverage(effect, { kind = "weapon", hasSkill = () => true } = {}) {
  const read = readGear(effect, { kind });
  const missing = read.grants.filter((grant) => !hasSkill(grant.name)).map((grant) => `Grants ${grant.name} (no skill of that name)`);
  const left = [...read.left, ...missing];
  if ( !left.length ) return { state: "done", left };
  return { state: (read.read - missing.length) > 0 ? "part" : "text", left };
}

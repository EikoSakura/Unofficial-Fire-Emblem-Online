/**
 * Creatures a skill brings onto the map for Fire Emblem Online: a Phantom, an undead minion, an enemy raised as
 * it falls, an animal, a Spirit, a Mogall, Terrors, reinforcements. What a creature is, where it appears, how
 * many its maker may have and when it goes are all said by the skill, in a `makes` part; nothing here knows a
 * skill by its name. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A `makes` part stands in one of two places. In the `act` of a skill used as an action, beside an area that is
 * one tile picked on the map, the creature appears on that tile:
 *
 *   act: { area: { shape: "radius", radius: 0, centre: "tile", range: { from: 1, within: 1 } }, makes: { ... } }
 *
 * and at the moment its unit defeats an enemy, where the creature is that enemy, raised on the tile it fell on:
 *
 *   { proc: { on: "kill", sure: true }, makes: { body: "slain", ... } }
 *
 * What it says:
 *
 *   makes: {
 *     kind: "undead",                    // what it is among its maker's creatures: limits count by it, and
 *                                        // other skills name it (`creatures`, below)
 *     name: "Undead Minion",             // what it is called, where its class or its original does not say
 *     img: "icons/…/ghost.webp",          // the picture it has, where its class or its original gives none:
 *                                        // one that ships with Foundry; an option of a table may have its own
 *     body: "maker",                     // what it is made from:
 *                                        //   "class"     a unit of `class` at level 1
 *                                        //   "maker"     its maker's numbers
 *                                        //   "slain"     the enemy its maker has just defeated
 *                                        //   "table"     one of `options`, picked as the skill is used
 *                                        //   "prepared"  units the Game Master has prepared, picked by them
 *     class: "Mogall",                   // the class it is: its Special Qualities, and its MOV, CON and LoS
 *     share: [3, 4],                     // its HP, STR, MAG, DEF, RES, DEX, SPD and LUK are that share of its
 *                                        // original's as they stand, rounded down; MOV, CON and LoS are not
 *                                        // shared out: they are its class's, or its original's
 *     stats: { str: { of: "mag" }, hp: 30, def: { share: [1, 2] } },
 *                                        // a stat that goes another way: a number; read from another stat
 *                                        // (or from "weight"); or a share of its own
 *     hp: 1,                             // the HP it appears with, where that is not all it has
 *     skills: false,                     // "slain": it keeps none of its skills
 *     pack: false,                       // "slain": it keeps nothing of what it carried
 *     options: [{ name: "Bear", stats: { ... }, qualities: ["Beast"], weapon: "Tiger Fang" }],
 *                                        // "table": what can be picked, each with stats as above
 *     weapon: "Claws",                   // the weapon it is handed, by its name on the Weapons tab; or
 *     weapon: { pick: ["Steel Sword", "Steel Lance", "Steel Axe"] },
 *                                        // one of these, picked as the skill is used (`labels` may name them
 *                                        // otherwise); or
 *     weapon: { draw: "level", pick: ["sword", "lance", "axe"] },
 *                                        // one of a kind picked once, drawn anew each time for its level
 *                                        // from `FEO.summon`; or
 *     weapon: { ranked: true },          // "table": the weapon its option names, of the rank of its maker's
 *                                        // best proficiency ("Talon (C)", "Great Talon (S)")
 *     qualities: ["Terror"],             // Special Qualities it has beside its own
 *     effects: [{ triangle: { loses: ["light"] } }],
 *                                        // what it always has, as a skill's effects are written
 *     control: "gm",                     // who acts for it: its "maker"'s owner (as when left out), or the
 *                                        // Game Master. It is always on its maker's side
 *     most: 3,                           // how many of its kind its maker may have standing at once
 *     field: true,                       // ... counted over the whole map, whoever made them
 *     many: 5,                           // how many one use may make, picked as the skill is used: the first
 *                                        // appears on the tile picked, the others on the free tiles nearest to it
 *     costs: { hp: 5 },                  // what each costs its maker
 *     locked: true,                      // its pack cannot be manipulated: nothing is traded with it, taken
 *                                        // from it or sold, and it wields nothing but what it came with
 *     keeps: true,                       // it is kept from one battle to the next and comes back when it is
 *                                        // made again; its fights earn its maker the experience (`exp`), it
 *                                        // keeps to its maker's level (`level: "maker"`), and may say
 *     growth: { points: 200, barred: ["hp", "def", "res"] },      // growth rates assigned once, by hand
 *     gains: { level: 21, stats: { con: 2, mov: 1 } },            // stats it gains once as it reaches a level
 *     lasts: "stays",                    // it is an ordinary unit from then on; otherwise it is gone as the
 *                                        // battle ends
 *     asks: true                         // at a "kill": whoever acts for its maker is asked first
 *   }
 *
 * And a skill may speak of the creatures another skill of its unit makes, with a `creatures` part that is
 * always there:
 *
 *   creatures: { kind: "phantom", more: 1, levels: [26, 31] }      // its unit may have one more of that kind
 *                                        // standing, and one more again for each of those levels it has reached
 *   creatures: { kind: "phantom", skill: "generic" }               // each creature of that kind has one skill
 *                                        // of that sort, picked once by whoever acts for its maker
 */
import { FEO } from "../config.mjs";
import { tileKey, tilesApart } from "./reach.mjs";

/** What a creature can be made from. */
export const BODIES = ["class", "maker", "slain", "table", "prepared"];

/** Who acts for a creature. */
export const CONTROLS = ["maker", "gm"];

/** The stats a creature has a share of; its MOV, CON and LoS are not shared out. */
export const SHARED = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk"];

/** The stats a creature has that are not shared out. */
export const KEPT = ["mov", "con", "los"];

/** What stands for the Weight of the original, where a stat is read from it. */
export const WEIGHT = "weight";

/** What a `makes` part can say. */
export const MAKES_PARTS = ["kind", "name", "body", "class", "share", "stats", "hp", "skills", "pack", "options", "weapon", "qualities", "effects",
  "control", "most", "field", "many", "costs", "locked", "keeps", "exp", "level", "growth", "gains", "lasts", "asks", "img"];

/** What a `creatures` part can say. */
export const CREATURES_PARTS = ["kind", "more", "levels", "skill"];

/** The rule a unit carries while the unit a change comes from acts for it in place of whoever does. */
export const POSSESSED = "possessed";

/** The flag a creature carries: what it is, who made it and what becomes of it. */
export const CREATURE_FLAG = "creature";

const whole = (value) => Number.isInteger(value);
const fraction = (value) => Array.isArray(value) && (value.length === 2) && whole(value[0]) && whole(value[1]) && (value[0] >= 0) && (value[1] > 0);
const fold = (name) => String(name ?? "").trim().toLowerCase();

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * What a skill makes as it is used on a tile, if it makes anything.
 * @param {object|null} act     The skill's `act` part
 * @returns {object|null}
 */
export function actMakes(act) {
  return (act?.makes && (typeof act.makes === "object")) ? act.makes : null;
}

/* -------------------------------------------- */

/**
 * Who acts for a creature: the owner of its maker, or the Game Master.
 * @param {object} makes
 * @returns {"maker"|"gm"}
 */
export function controlOf(makes) {
  return (makes?.control === "gm") ? "gm" : "maker";
}

/* -------------------------------------------- */

/**
 * What is noted on a creature of what made it, so that everything later is read from the creature alone.
 * @param {object} makes
 * @param {object} about
 * @param {string} about.maker        The UUID of the unit that made it
 * @param {string} about.skill        The skill that made it
 * @param {string} [about.scene]      The scene it was made on
 * @param {string} [about.option]     What was picked for it, where its skill had something picked
 * @param {boolean} [about.own]       Has it an Actor of its own, which goes with it?
 * @returns {object}
 */
export function creatureNote(makes, { maker, skill, scene = "", option = "", own = true } = {}) {
  return {
    kind: String(makes?.kind ?? ""),
    maker: String(maker ?? ""),
    skill: String(skill ?? ""),
    scene,
    control: controlOf(makes),
    locked: !!makes?.locked,
    keeps: !!makes?.keeps,
    exp: (makes?.exp === "maker") ? "maker" : "",
    lasts: (makes?.lasts === "stays") ? "stays" : "battle",
    own: !!own,
    ...(option ? { option } : {}),
    ...(makes?.level === "maker" ? { level: "maker" } : {}),
    ...(makes?.growth ? { growth: { points: makes.growth.points, barred: [...(makes.growth.barred ?? [])], due: true } } : {}),
    ...(makes?.gains ? { gains: { level: makes.gains.level, stats: { ...makes.gains.stats }, given: false } } : {})
  };
}

/* -------------------------------------------- */
/*  Stats                                       */
/* -------------------------------------------- */

/**
 * @typedef Original
 * The unit a creature's numbers are read from, as it stands.
 * @property {number} hp                      Its maximum HP
 * @property {Record<string, number>} stats   Its stats as they stand
 * @property {number} [weight]                Its Weight
 */

/**
 * The stats a creature is made with: a share of its original's, with what its skill says of single stats, and
 * for one that is picked from a table, what its row says.
 * @param {object} makes
 * @param {Original} original
 * @param {object} [options]
 * @param {object|null} [options.option]      The row picked, for a creature picked from a table
 * @param {Record<string, number>|null} [options.classBase]     The base stats of the class it is, if it is one
 * @returns {{hp: number, stats: Record<string, number>}}
 */
export function creatureStats(makes, original, { option = null, classBase = null } = {}) {
  const share = fraction(makes?.share) ? makes.share : [1, 1];
  const said = { ...(makes?.stats ?? {}), ...(option?.stats ?? {}) };
  const from = (key) => {
    if ( key === "hp" ) return original?.hp ?? 0;
    if ( key === WEIGHT ) return original?.weight ?? 0;
    return original?.stats?.[key] ?? 0;
  };
  const part = (amount, [times, over]) => Math.max(Math.floor((Math.max(amount, 0) * times) / over), 0);
  const read = (key) => {
    const rule = said[key];
    if ( Number.isFinite(rule) ) return Math.max(Math.floor(rule), 0);
    const shared = SHARED.includes(key);
    if ( rule && (typeof rule === "object") ) {
      const source = from(rule.of ?? key);
      if ( fraction(rule.share) ) return part(source, rule.share);
      return shared ? part(source, share) : Math.max(Math.floor(source), 0);
    }
    if ( shared ) return part(from(key), share);
    return Math.max(Math.floor(classBase?.[key] ?? from(key)), 0);
  };
  const stats = {};
  for ( const key of [...SHARED.filter((stat) => stat !== "hp"), ...KEPT] ) stats[key] = read(key);
  return { hp: Math.max(read("hp"), 1), stats };
}

/* -------------------------------------------- */

/**
 * The HP a creature appears with.
 * @param {object} makes
 * @param {number} hpMax
 * @returns {number}
 */
export function creatureHp(makes, hpMax) {
  return Number.isFinite(makes?.hp) ? Math.min(Math.max(Math.floor(makes.hp), 1), Math.max(hpMax, 1)) : Math.max(hpMax, 1);
}

/* -------------------------------------------- */

/**
 * Special Qualities with more added to them, each once.
 * @param {string} [text]         Special Qualities, as free text
 * @param {string[]} [more]
 * @returns {string}
 */
export function withQualities(text, more = []) {
  const list = String(text ?? "").split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  for ( const quality of more ?? [] ) {
    if ( quality && !list.some((entry) => fold(entry) === fold(quality)) ) list.push(quality);
  }
  return list.join(", ");
}

/* -------------------------------------------- */
/*  Weapons                                     */
/* -------------------------------------------- */

/**
 * How a creature comes by its weapon.
 * @param {object} makes
 * @returns {"none"|"named"|"pick"|"draw"|"ranked"}
 */
export function weaponWay(makes) {
  const weapon = makes?.weapon;
  if ( !weapon ) return "none";
  if ( typeof weapon === "string" ) return "named";
  if ( weapon.draw ) return "draw";
  if ( weapon.ranked ) return "ranked";
  return Array.isArray(weapon.pick) ? "pick" : "none";
}

/* -------------------------------------------- */

/**
 * The names under which a weapon that comes in ranks may be listed on the Weapons tab, the likeliest first:
 * "Talon (C)", and for the highest ranks "Great Talon (S)".
 * @param {string} name       The weapon without its rank
 * @param {string} rank       The rank wanted
 * @param {string[]} [ranks]  The ranks there are, lowest first
 * @returns {string[]}
 */
export function rankedNames(name, rank, ranks = Object.keys(FEO.ranks)) {
  const names = [];
  let at = ranks.indexOf(rank);
  if ( at < 0 ) at = 0;

  // A weapon no rank below E is listed for is looked for from E; one whose rank is missing, the next below
  const lowest = Math.max(ranks.indexOf("E"), 0);
  for ( let n = Math.max(at, lowest); n >= lowest; n-- ) names.push(`${name} (${ranks[n]})`, `Great ${name} (${ranks[n]})`);
  return names;
}

/**
 * The `makes` parts of a skill's effects: what it makes as it is used, and what it raises at a kill.
 * @param {object[]} [effects]
 * @returns {object[]}
 */
export function makesIn(effects) {
  const list = [];
  for ( const effect of effects ?? [] ) {
    if ( effect?.act?.makes && (typeof effect.act.makes === "object") ) list.push(effect.act.makes);
    if ( effect?.makes && (typeof effect.makes === "object") ) list.push(effect.makes);
  }
  return list;
}

/* -------------------------------------------- */

/**
 * The weapons a `makes` part names, for whoever checks them against the Weapons tab: those named as they are
 * listed, and those that come in ranks, named without their rank.
 * @param {object} makes
 * @returns {{named: string[], ranked: string[]}}
 */
export function makesWeapons(makes) {
  const way = weaponWay(makes);
  if ( way === "named" ) return { named: [makes.weapon], ranked: [] };
  if ( way === "pick" ) return { named: [...makes.weapon.pick], ranked: [] };
  if ( way === "ranked" ) return { named: [], ranked: (makes.options ?? []).map((option) => option.weapon).filter(Boolean) };
  return { named: [], ranked: [] };
}

/* -------------------------------------------- */

/** The columns of a table of creatures that are shares of their maker's stats, by their heading. */
const TABLE_SHARES = { hp: "HP", str: "STR", mag: "MAG", def: "DEF", res: "RES", dex: "DEX", spd: "SPD", luk: "LUK" };

/**
 * Check the options of a creature that is picked from a table against that table as the sheet has it, so that
 * a number typed over from it cannot drift from it. Fractions on the sheet are shares of the maker's stat, and
 * for WT of its Weight; MOV and LoS are whole numbers.
 * @param {object[]} options          The options, as the skill lists them
 * @param {string[]} head             The headings of the table
 * @param {string[][]} rows           Its rows, cell by cell as the sheet has them
 * @returns {string[]}                What differs, in plain words; empty when nothing does
 */
export function checkTable(options, head, rows) {
  const problems = [];
  const column = (name) => head.findIndex((text) => fold(text) === fold(name));
  const number = (row, name) => {
    const text = String(row[column(name)] ?? "").replace("%", "");
    const value = Number(text);
    if ( (text === "") || !Number.isFinite(value) ) return null;
    return String(row[column(name)]).includes("%") ? value / 100 : value;
  };
  const percent = (value) => Math.round(value * 100);
  if ( (options ?? []).length !== rows.length ) problems.push(`the table has ${rows.length} rows and the skill ${(options ?? []).length} options`);
  for ( const row of rows ) {
    const name = String(row[0] ?? "").trim();
    const option = (options ?? []).find((entry) => fold(entry?.name) === fold(name));
    if ( !option ) {
      problems.push(`the skill lists no option "${name}"`);
      continue;
    }
    for ( const [key, heading] of Object.entries(TABLE_SHARES) ) {
      const listed = number(row, heading);
      const share = option.stats?.[key]?.share;
      if ( (listed === null) || !share || (share[1] !== 100) || (share[0] !== percent(listed)) ) problems.push(`${name}: ${heading} is ${listed === null ? "missing" : `${percent(listed)}%`} on the sheet`);
    }
    for ( const [key, heading] of [["mov", "MOV"], ["los", "LoS"]] ) {
      const listed = number(row, heading);
      if ( (listed === null) || (option.stats?.[key] !== listed) ) problems.push(`${name}: ${heading} is ${listed ?? "missing"} on the sheet`);
    }
    const weight = number(row, "WT");
    const con = option.stats?.con;
    if ( (weight === null) || (con?.of !== WEIGHT) || (con.share?.[1] !== 100) || (con.share[0] !== percent(weight)) ) problems.push(`${name}: WT is ${weight ?? "missing"} on the sheet`);
    const quality = String(row[column("Special Quality")] ?? "").trim();
    if ( fold((option.qualities ?? []).join(", ")) !== fold(quality) ) problems.push(`${name}: its Special Quality is ${quality || "none"} on the sheet`);
  }
  return problems;
}

/* -------------------------------------------- */
/*  What Is Asked First                         */
/* -------------------------------------------- */

/**
 * @typedef Question
 * Something whoever acts for the maker picks before the creature appears.
 * @property {"option"|"weapon"|"count"} id
 * @property {{id: string, label: string, localize?: boolean}[]} options
 */

/**
 * What is picked before a creature appears: which of a table, which weapon, how many.
 * @param {object} makes
 * @param {object} [state]
 * @param {boolean} [state.returning]     Is it one that was made before and comes back?
 * @param {number} [state.room]           How many more its maker may make now
 * @returns {Question[]}
 */
export function questionsOf(makes, { returning = false, room = 1 } = {}) {
  const questions = [];
  if ( makes?.body === "table" ) {
    questions.push({ id: "option", options: (makes.options ?? []).map((option) => ({ id: option.name, label: option.name })) });
  }
  const way = weaponWay(makes);
  if ( (way === "pick") || ((way === "draw") && !returning && Array.isArray(makes.weapon.pick)) ) {
    const labels = makes.weapon.labels ?? {};
    questions.push({
      id: "weapon",
      options: makes.weapon.pick.map((name) => (way === "draw")
        ? { id: name, label: FEO.proficiencies[name] ?? name, localize: true }
        : { id: name, label: labels[name] ?? name })
    });
  }
  const most = Math.min(Math.max(Math.floor(makes?.many ?? 1), 1), Math.max(room, 0));
  if ( (makes?.body !== "prepared") && ((makes?.many ?? 1) > 1) && (most > 1) ) {
    questions.push({ id: "count", options: Array.from({ length: most }, (unused, n) => ({ id: String(n + 1), label: String(n + 1) })) });
  }
  return questions.filter((question) => question.options.length > 0);
}

/* -------------------------------------------- */
/*  How Many                                    */
/* -------------------------------------------- */

/**
 * @typedef Standing
 * A creature that stands on the map.
 * @property {string} kind
 * @property {string} maker       The UUID of the unit that made it
 */

/**
 * What a unit's skills say of the creatures its other skills make: how many more of a kind it may have, and
 * the sort of skill each of that kind is given.
 * @param {{name: string, effects?: object[], choice?: string}[]} [skills]     Its equipped skills
 * @param {string} kind
 * @param {number} [level]        Its level, counted on through its promotions
 * @returns {{more: number, skills: {from: string, sort: string, picked: string}[]}}
 */
export function creatureExtras(skills, kind, level = 1) {
  const out = { more: 0, skills: [] };
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill?.effects ?? [] ) {
      const part = effect?.creatures;
      if ( !part || (fold(part.kind) !== fold(kind)) ) continue;
      if ( Number.isFinite(part.more) ) {
        out.more += Math.max(Math.floor(part.more), 0) + (part.levels ?? []).filter((reached) => level >= reached).length;
      }
      if ( part.skill ) out.skills.push({ from: skill.name, sort: part.skill, picked: String(skill.choice ?? "").trim() });
    }
  }
  return out;
}

/* -------------------------------------------- */

/**
 * How many more creatures of a kind a unit may make right now.
 * @param {object} makes
 * @param {Standing[]} standing       The creatures that stand on the map
 * @param {string} maker              The UUID of the unit that would make one
 * @param {number} [more]             How many more of them its other skills let it have
 * @returns {number}                  Infinity where nothing limits it
 */
export function creatureRoom(makes, standing, maker, more = 0) {
  if ( !Number.isFinite(makes?.most) ) return Infinity;
  const counted = (standing ?? []).filter((entry) => (fold(entry.kind) === fold(makes.kind)) && (makes.field || (entry.maker === maker)));
  return Math.max(Math.floor(makes.most) + (makes.field ? 0 : Math.max(more, 0)) - counted.length, 0);
}

/* -------------------------------------------- */

/**
 * How many creatures one use of a skill may make: no more than it says, than its maker may still have, than
 * its maker can pay for, and than there are tiles for.
 * @param {object} makes
 * @param {object} state
 * @param {number} state.room         How many more its maker may have
 * @param {number} state.hp           The HP its maker has
 * @param {number} state.tiles        The free tiles there are for them
 * @returns {number}
 */
export function creatureCount(makes, { room = Infinity, hp = Infinity, tiles = Infinity } = {}) {
  const each = Math.max(Math.floor(makes?.costs?.hp ?? 0), 0);

  // What is paid in HP leaves its maker 1 at least
  const afford = each > 0 ? Math.floor(Math.max(hp - 1, 0) / each) : Infinity;
  return Math.max(Math.min(Math.max(Math.floor(makes?.many ?? 1), 1), room, afford, tiles), 0);
}

/* -------------------------------------------- */

/**
 * What making so many creatures costs their maker.
 * @param {object} makes
 * @param {number} count
 * @returns {{hp: number}}
 */
export function creatureCost(makes, count) {
  return { hp: Math.max(Math.floor(makes?.costs?.hp ?? 0), 0) * Math.max(count, 0) };
}

/* -------------------------------------------- */
/*  Where                                       */
/* -------------------------------------------- */

/**
 * The tiles several creatures appear on: the tile that was picked, then the free tiles nearest to it, those
 * nearer to their maker first.
 * @param {{i: number, j: number}} first              The tile that was picked
 * @param {number} count                              How many appear
 * @param {{i: number, j: number}[]} free             The tiles a creature may appear on
 * @param {{i: number, j: number}|null} [origin]      Where their maker stands
 * @returns {{i: number, j: number}[]}                As many as there is room for, the picked tile first
 */
export function spotsFor(first, count, free, origin = null) {
  const seen = new Set();
  const open = (free ?? []).filter((tile) => {
    const key = tileKey(tile);
    if ( seen.has(key) ) return false;
    seen.add(key);
    return true;
  });
  const start = open.find((tile) => (tile.i === first?.i) && (tile.j === first?.j));
  if ( !start ) return [];
  const rest = open.filter((tile) => tile !== start).map((tile, index) => ({
    tile, index, near: tilesApart(tile, start), home: origin ? tilesApart(tile, origin) : 0
  })).sort((a, b) => (a.near - b.near) || (a.home - b.home) || (a.index - b.index));
  return [start, ...rest.map((entry) => entry.tile)].slice(0, Math.max(count, 0)).map((tile) => ({ i: tile.i, j: tile.j }));
}

/* -------------------------------------------- */
/*  Raising the Fallen                          */
/* -------------------------------------------- */

/**
 * May a unit that was brought down be raised as a creature? Only one that died of it: a unit that is merely
 * down, that left the battle with a life to spare or that was captured was not killed.
 * @param {{hp: number, state: string}} victim      Its HP and what became of it (see the defeat rules)
 * @returns {boolean}
 */
export function raisable(victim) {
  return !(victim?.hp > 0) && (victim?.state === "dead");
}

/* -------------------------------------------- */
/*  Going                                       */
/* -------------------------------------------- */

/**
 * What becomes of a creature as something ends: the battle it was made in, or its token being taken away.
 * @param {object|null} note                  What is noted on it (see `creatureNote`)
 * @param {"battle"|"token"|"sweep"} event    The battle is over; its token was deleted; or it is found with
 *                                            no token anywhere
 * @returns {{token: boolean, actor: boolean}}    Does its token go, and the Actor it has of its own?
 */
export function creatureEnds(note, event) {
  if ( !note || (note.lasts === "stays") ) return { token: false, actor: false };
  const actor = !!note.own && !note.keeps;
  if ( event === "battle" ) return { token: true, actor };
  return { token: false, actor };
}

/* -------------------------------------------- */
/*  Growing                                     */
/* -------------------------------------------- */

/**
 * Check growth rates assigned to a creature by hand: all its points are spent, none where none may go, each
 * a whole number that is 0 at least.
 * @param {Record<string, number>} growths
 * @param {{points: number, barred?: string[]}} rule
 * @returns {{spent: number, left: number, valid: boolean, barred: string[]}}
 */
export function checkGrowth(growths, rule) {
  let spent = 0;
  let sound = true;
  const barred = [];
  for ( const [key, value] of Object.entries(growths ?? {}) ) {
    const amount = Number(value) || 0;
    if ( !whole(amount) || (amount < 0) ) sound = false;
    if ( (amount > 0) && (rule?.barred ?? []).includes(key) ) barred.push(key);
    spent += Math.max(amount, 0);
  }
  const left = (rule?.points ?? 0) - spent;
  return { spent, left, valid: sound && !barred.length && (left === 0), barred };
}

/* -------------------------------------------- */

/**
 * The stats a creature gains for the level it has reached, if it has not been given them yet.
 * @param {{level: number, stats: Record<string, number>, given?: boolean}|null} gains
 * @param {number} level
 * @returns {Record<string, number>|null}
 */
export function gainsDue(gains, level) {
  if ( !gains || gains.given || !((level ?? 1) >= gains.level) ) return null;
  return { ...gains.stats };
}

/* -------------------------------------------- */
/*  Checking                                    */
/* -------------------------------------------- */

/**
 * Check a `makes` part.
 * @param {object} makes
 * @param {object} [options]
 * @param {"act"|"kill"} [options.at]     Where it stands: in an action, or at the moment of a kill
 * @param {(effects: object[]) => string[]} [options.checkEffects]      Checks the effects it always has
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkMakes(makes, { at = "act", checkEffects = null } = {}) {
  if ( !makes || (typeof makes !== "object") || Array.isArray(makes) ) return [`"makes" says what creature its skill brings onto the map`];
  const problems = [];
  for ( const key of Object.keys(makes) ) if ( !MAKES_PARTS.includes(key) ) problems.push(`"makes" cannot say "${key}"`);
  if ( !makes.kind || (typeof makes.kind !== "string") ) problems.push(`"makes" names the "kind" of creature`);
  if ( !BODIES.includes(makes.body) ) problems.push(`a creature is made from ${BODIES.map((body) => `"${body}"`).join(", ")}, not "${makes.body}"`);
  if ( (at === "kill") && (makes.body !== "slain") ) problems.push(`at a kill the creature is the "slain" unit`);
  if ( (at !== "kill") && (makes.body === "slain") ) problems.push(`a "slain" unit is raised at a "kill"`);
  if ( (makes.body === "class") && !makes.class ) problems.push(`a creature made from a class names its "class"`);
  if ( (makes.share !== undefined) && !fraction(makes.share) ) problems.push(`"share" is two whole numbers, as [3, 4]`);
  const statKeys = [...SHARED, ...KEPT];
  const checkStats = (stats, where) => {
    if ( !stats || (typeof stats !== "object") ) return problems.push(`${where} lists stats`);
    for ( const [key, rule] of Object.entries(stats) ) {
      if ( !statKeys.includes(key) ) problems.push(`${where}: a creature has no stat "${key}"`);
      if ( Number.isFinite(rule) ) continue;
      if ( !rule || (typeof rule !== "object") ) problems.push(`${where}: "${key}" is a number, or says "of" or "share"`);
      else {
        if ( (rule.of !== undefined) && ![...statKeys, WEIGHT].includes(rule.of) ) problems.push(`${where}: "${key}" cannot be read from "${rule.of}"`);
        if ( (rule.share !== undefined) && !fraction(rule.share) ) problems.push(`${where}: the share of "${key}" is two whole numbers`);
        if ( (rule.of === undefined) && (rule.share === undefined) ) problems.push(`${where}: "${key}" says "of" or "share"`);
      }
    }
  };
  if ( makes.stats !== undefined ) checkStats(makes.stats, `"stats"`);
  if ( (makes.hp !== undefined) && !(whole(makes.hp) && (makes.hp >= 1)) ) problems.push(`"hp" is the HP it appears with, 1 at least`);
  if ( makes.body === "table" ) {
    if ( !Array.isArray(makes.options) || !makes.options.length ) problems.push(`a creature picked from a table lists its "options"`);
    for ( const option of makes.options ?? [] ) {
      if ( !option?.name ) problems.push(`each option has a "name"`);
      if ( option?.stats !== undefined ) checkStats(option.stats, `option "${option?.name}"`);
      for ( const key of Object.keys(option ?? {}) ) {
        if ( !["name", "stats", "qualities", "weapon", "img"].includes(key) ) problems.push(`option "${option?.name}" cannot say "${key}"`);
      }
    }
  }
  else if ( makes.options !== undefined ) problems.push(`only a creature picked from a "table" has "options"`);
  const weapon = makes.weapon;
  if ( (weapon !== undefined) && (typeof weapon !== "string") ) {
    if ( !weapon || (typeof weapon !== "object") ) problems.push(`"weapon" names a weapon, or says how it is come by`);
    else {
      for ( const key of Object.keys(weapon) ) if ( !["pick", "labels", "draw", "ranked"].includes(key) ) problems.push(`"weapon" cannot say "${key}"`);
      if ( (weapon.pick !== undefined) && !(Array.isArray(weapon.pick) && weapon.pick.length && weapon.pick.every((name) => typeof name === "string")) ) {
        problems.push(`"weapon.pick" lists what is picked among`);
      }
      if ( (weapon.draw !== undefined) && (weapon.draw !== "level") ) problems.push(`a weapon is drawn by "level"`);
      if ( weapon.draw && !Array.isArray(weapon.pick) ) problems.push(`a weapon that is drawn lists the kinds to "pick" from`);
      if ( weapon.ranked && (makes.body !== "table") ) problems.push(`a "ranked" weapon is the one an option of a table names`);
      if ( weapon.ranked && (makes.options ?? []).some((option) => !option?.weapon) ) problems.push(`with a "ranked" weapon each option names its "weapon"`);
      if ( !weapon.pick && !weapon.draw && !weapon.ranked ) problems.push(`"weapon" says "pick", "draw" or "ranked"`);
    }
  }
  if ( (makes.qualities !== undefined) && !(Array.isArray(makes.qualities) && makes.qualities.every((quality) => (typeof quality === "string") && quality)) ) {
    problems.push(`"qualities" lists Special Qualities`);
  }
  if ( makes.effects !== undefined ) {
    if ( !Array.isArray(makes.effects) ) problems.push(`"effects" is a list of effects`);
    else if ( checkEffects ) for ( const problem of checkEffects(makes.effects) ) problems.push(`"makes" effects: ${problem}`);
  }
  if ( (makes.control !== undefined) && !CONTROLS.includes(makes.control) ) problems.push(`a creature is controlled by ${CONTROLS.map((who) => `"${who}"`).join(" or ")}`);
  if ( (makes.most !== undefined) && !(whole(makes.most) && (makes.most >= 1)) ) problems.push(`"most" is how many may stand at once, 1 at least`);
  if ( makes.field && (makes.most === undefined) ) problems.push(`"field" counts "most" over the whole map`);
  if ( (makes.many !== undefined) && !(whole(makes.many) && (makes.many >= 1)) ) problems.push(`"many" is how many one use may make, 1 at least`);
  if ( (makes.many > 1) && (at === "kill") ) problems.push(`one unit is raised at a kill`);
  if ( makes.costs !== undefined ) {
    if ( !makes.costs || (typeof makes.costs !== "object") || !(whole(makes.costs.hp) && (makes.costs.hp > 0)) || (Object.keys(makes.costs).length !== 1) ) {
      problems.push(`"costs" says the "hp" each creature costs`);
    }
  }
  if ( (makes.lasts !== undefined) && !["battle", "stays"].includes(makes.lasts) ) problems.push(`a creature lasts the "battle", or "stays"`);
  if ( (makes.exp !== undefined) && (makes.exp !== "maker") ) problems.push(`what a creature earns goes to its "maker", or nowhere`);
  if ( (makes.level !== undefined) && (makes.level !== "maker") ) problems.push(`a creature keeps to the level of its "maker", or to its own`);
  if ( makes.growth !== undefined ) {
    if ( !makes.keeps ) problems.push(`only a creature that is kept grows`);
    if ( !(whole(makes.growth?.points) && (makes.growth.points > 0)) ) problems.push(`"growth" says the "points" to assign`);
    for ( const key of makes.growth?.barred ?? [] ) if ( !(key in FEO.growths) ) problems.push(`"growth" bars no growth rate "${key}"`);
  }
  if ( makes.gains !== undefined ) {
    if ( !makes.keeps ) problems.push(`only a creature that is kept gains stats at a level`);
    if ( !(whole(makes.gains?.level) && (makes.gains.level > 1)) ) problems.push(`"gains" says the "level" it gains them at`);
    if ( !makes.gains?.stats || Object.entries(makes.gains.stats).some(([key, amount]) => !KEPT.concat(SHARED).includes(key) || !whole(amount)) ) {
      problems.push(`"gains" lists the "stats" it gains, in whole numbers`);
    }
  }
  if ( makes.keeps && (makes.body !== "class") ) problems.push(`only a creature made from a class is kept`);
  if ( makes.asks && (at !== "kill") ) problems.push(`"asks" is for a creature raised at a kill`);
  return problems;
}

/* -------------------------------------------- */

/**
 * Check a `creatures` part.
 * @param {object} part
 * @returns {string[]}
 */
export function checkCreatures(part) {
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return [`"creatures" says something of the creatures its unit makes`];
  const problems = [];
  for ( const key of Object.keys(part) ) if ( !CREATURES_PARTS.includes(key) ) problems.push(`"creatures" cannot say "${key}"`);
  if ( !part.kind || (typeof part.kind !== "string") ) problems.push(`"creatures" names their "kind"`);
  if ( (part.more === undefined) && (part.skill === undefined) ) problems.push(`"creatures" says "more" or "skill"`);
  if ( (part.more !== undefined) && !(whole(part.more) && (part.more >= 1)) ) problems.push(`"more" is how many more may stand, 1 at least`);
  if ( (part.levels !== undefined) && (!Array.isArray(part.levels) || part.levels.some((level) => !whole(level) || (level < 1)) || (part.more === undefined)) ) {
    problems.push(`"levels" lists the levels at which one more may stand, beside "more"`);
  }
  if ( (part.skill !== undefined) && !(part.skill in FEO.skillKinds) ) problems.push(`"skill" names a kind of skill, not "${part.skill}"`);
  return problems;
}

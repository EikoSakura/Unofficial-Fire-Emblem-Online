/**
 * Reactions for Fire Emblem Online: what a unit does, outside of its own turn, about an enemy that moves or
 * that has hurt an ally; the traps laid on a tile; and the units enemies neither see nor target. Pure functions
 * of plain data, so that they can be tested outside of Foundry.
 *
 * A unit reacts with a `reacts` part, which is always there: on a skill, or among the effects of a stance (see
 * `stances.mjs`), so that it lasts as long as the stance does.
 *
 *   reacts: {
 *     to: "move",                  // an enemy moves through, into or out of a tile within its reach
 *     within: "weapon",            // its reach: the tiles the weapon in its hand attacks from where it stands;
 *                                  // "mov" for the tiles it could move to, or a number of spaces
 *     near: 2,                     // and an enemy that comes within so many spaces: its unit then moves to
 *                                  // where its weapon reaches that enemy
 *     fight: true,                 // it starts a fight with that enemy, where the enemy stands as it reacts
 *     halts: "hurt",               // the enemy's move ends there: `true` always, "hurt" where the fight took
 *                                  // HP off it, "pick" for one enemy a turn whoever acts for the unit picks;
 *                                  // an enemy that is not halted moves on
 *     once: "turn",                // it reacts once a turn; "foe": once a turn to each enemy
 *     may: true,                   // whoever acts for the unit is asked first, in one click
 *     effects: [{ combat: { hit: 10 } }]       // what its unit has for that fight alone
 *   }
 *   reacts: { to: "enters", within: "mov",     // an enemy's move takes it into the reach from outside:
 *             rallies: { effects: [{ when: { foeMarked: "$" }, stats: { def: 2 } }] } }
 *                                  // every ally of the unit that stands in that reach carries the change until
 *                                  // the Phase ends. `"$"` stands for the mark the enemy carries meanwhile, so
 *                                  // that what the change does is against that enemy alone
 *   reacts: { to: "pass", strike: true, moves: "half", may: true }
 *                                  // an enemy would move onto the tile its unit stands on, as one that does
 *                                  // not see it may: the enemy stops before it, and the unit makes one attack
 *                                  // that is not answered, or moves away by half its MOV and lets it by
 *   reacts: { to: "allyHurt", within: "weapon", strike: true, may: true }
 *                                  // a fight has ended in which an enemy within its reach took HP off an
 *                                  // ally: one attack on that enemy, which is not answered
 *
 * A skill that reacts and counts its uses (`usage.kind: "auto"`, so many a turn) spends one each time it does.
 *
 * A trap is laid by a skill used as an action on a tile picked next to its unit (see `areas.mjs` for the pick):
 *
 *   act: { area: { shape: "radius", radius: 0, centre: "tile", range: { from: 1, within: 1 } },
 *          trap: { costs: { weapon: ["magic"], uses: 1 },  // the weapon in hand must be of this kind, and
 *                                                          // loses so many uses as the trap is laid
 *                  most: 2,                                // how many its unit may have lying: one more
 *                                                          // takes the place of the oldest
 *                  who: "any",                             // whom it catches: "any" unit but its own, or
 *                                                          // only an "enemy" of its unit
 *                  halts: true,                            // a unit that moves onto its tile stops there
 *                  strike: true } }                        // and its unit makes one attack on it with the
 *                                                          // weapon the trap was laid with, from wherever it
 *                                                          // stands; the trap is then gone
 *
 * And a unit with the rule `hidden` is one its enemies do not see: they cannot make it the target of anything,
 * its token is not shown to them, and it is not in their way on the map, so that one of them may try to move
 * onto its tile (see `to: "pass"` above).
 *
 * @import {Tile} from "./reach.mjs"
 */
import { FEO } from "../config.mjs";
import { tileKey, tilesApart } from "./reach.mjs";

/** What a unit can react to. */
export const REACTS_TO = ["move", "enters", "pass", "allyHurt"];

/** What a `reacts` part can say. */
export const REACT_PARTS = ["to", "within", "near", "fight", "strike", "halts", "once", "may", "effects", "rallies", "moves"];

/** How far a reaction reaches where that is no number of spaces. */
export const REACT_REACH = ["weapon", "mov"];

/** What a `trap` can say. */
export const TRAP_PARTS = ["costs", "most", "who", "halts", "strike"];

/** The rule a unit carries that its enemies neither see nor target. */
export const HIDDEN = "hidden";

/** What stands, in a change a reaction rallies allies with, for the mark the enemy carries meanwhile. */
export const RALLY_MARK = "$";

/* -------------------------------------------- */
/*  What a Unit Reacts With                     */
/* -------------------------------------------- */

/**
 * @typedef Reacting
 * One reaction a unit has.
 * @property {string} skill           The skill, or the stance, it comes from
 * @property {string} id              The skill Item, where it is a skill's own
 * @property {"move"|"enters"|"pass"|"allyHurt"} to
 * @property {"weapon"|"mov"|number} within
 * @property {number} near            An enemy this near has the unit move to attack it; 0 for none
 * @property {boolean} fight          Does it start a fight?
 * @property {boolean} strike         Does it make one attack that is not answered?
 * @property {"always"|"hurt"|"pick"|"never"} halts
 * @property {"turn"|"foe"|""} once
 * @property {boolean} may
 * @property {object[]} effects       What its unit has for that fight alone
 * @property {object|null} rallies    The change its allies in reach are given
 * @property {"half"|""} moves        The move it may make in place of the attack
 */

/**
 * One `reacts` part as the rules keep it.
 * @param {object} part
 * @param {{skill?: string, id?: string}} [about]
 * @returns {Reacting|null}       Null for a part that reacts to nothing
 */
export function reactOf(part, { skill = "", id = "" } = {}) {
  if ( !part || (typeof part !== "object") || !REACTS_TO.includes(part.to) ) return null;
  const within = REACT_REACH.includes(part.within) ? part.within : Math.max(Math.floor(Number(part.within) || 0), 0);
  return {
    skill, id,
    to: part.to,
    within: (part.to === "pass") ? 0 : (within || "weapon"),
    near: Math.max(Math.floor(Number(part.near) || 0), 0),
    fight: !!part.fight,
    strike: !!part.strike,
    halts: (part.halts === true) ? "always" : ["hurt", "pick"].includes(part.halts) ? part.halts : "never",
    once: ["turn", "foe"].includes(part.once) ? part.once : "",
    may: !!part.may,
    effects: Array.isArray(part.effects) ? part.effects : [],
    rallies: (part.rallies && (typeof part.rallies === "object")) ? part.rallies : null,
    moves: (part.moves === "half") ? "half" : ""
  };
}

/* -------------------------------------------- */

/**
 * Check a `reacts` part for what the rules do not know.
 * @param {any} part
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkReacts(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ['"reacts" says what its unit reacts to, and how'];
  for ( const key of Object.keys(part) ) if ( !REACT_PARTS.includes(key) ) problems.push(`reacts cannot say "${key}"`);
  if ( !REACTS_TO.includes(part.to) ) problems.push(`reacts: a unit reacts to ${REACTS_TO.map((to) => `"${to}"`).join(", ")}, not to "${part.to}"`);
  if ( (part.within !== undefined) && !REACT_REACH.includes(part.within) && !(Number.isInteger(part.within) && (part.within >= 1)) ) {
    problems.push('reacts: "within" is "weapon", "mov" or a number of spaces');
  }
  if ( (part.near !== undefined) && !(Number.isInteger(part.near) && (part.near >= 1)) ) problems.push('reacts: "near" is a number of spaces');
  if ( (part.halts !== undefined) && ![true, false, "hurt", "pick"].includes(part.halts) ) problems.push('reacts: "halts" is true, "hurt" or "pick"');
  if ( (part.once !== undefined) && !["turn", "foe"].includes(part.once) ) problems.push('reacts: "once" is "turn" or "foe"');
  if ( (part.moves !== undefined) && (part.moves !== "half") ) problems.push('reacts: "moves" is "half"');
  if ( (part.effects !== undefined) && !Array.isArray(part.effects) ) problems.push('reacts: "effects" is a list of effects');
  const does = ["fight", "strike", "rallies", "moves"].filter((key) => part[key]);
  if ( !does.length ) problems.push("reacts: a reaction is a fight, a strike, a move or a change for the allies in reach");
  if ( part.fight && part.strike ) problems.push("reacts: a reaction is a fight or one attack, not both");
  if ( (part.to === "move") && !part.fight ) problems.push('reacts: to a "move" a unit reacts with a fight');
  if ( (part.to === "enters") && !part.rallies ) problems.push('reacts: as an enemy "enters" its reach a unit rallies its allies');
  if ( (part.to === "allyHurt") && !part.strike ) problems.push('reacts: to "allyHurt" a unit reacts with a strike');
  if ( (part.to === "pass") && !(part.strike || part.moves) ) problems.push('reacts: to a "pass" a unit reacts with a strike or a move');
  if ( part.rallies !== undefined ) {
    if ( !part.rallies || (typeof part.rallies !== "object") || !Array.isArray(part.rallies.effects) ) problems.push('reacts: "rallies" is a change with its effects');
    else for ( const key of Object.keys(part.rallies) ) if ( !["effects", "name"].includes(key) ) problems.push(`reacts: "rallies" cannot say "${key}"`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * @typedef ReactRecord
 * What a unit has reacted with since its turn last started, by skill.
 * @type {Record<string, {count: number, foes: string[], halted: string[]}>}
 */

/**
 * May a unit still react to an enemy this turn, and may it halt that enemy?
 * @param {Reacting} react
 * @param {ReactRecord|null} record       What it has reacted with since its turn last started
 * @param {string} foe                    The enemy, by what tells it from the others
 * @returns {{ok: boolean, halt: boolean}}    `halt`: for one that halts an enemy of its choice, whether that
 *                                            choice is still open
 */
export function reactsLeft(react, record, foe) {
  const done = record?.[react.skill] ?? { count: 0, foes: [], halted: [] };
  let ok = true;
  if ( (react.once === "turn") && (done.count > 0) ) ok = false;
  if ( (react.once === "foe") && (done.foes ?? []).includes(foe) ) ok = false;
  return { ok, halt: (react.halts === "pick") ? !(done.halted ?? []).length : (react.halts !== "never") };
}

/* -------------------------------------------- */

/**
 * Note that a unit has reacted to an enemy.
 * @param {ReactRecord|null} record
 * @param {Reacting} react
 * @param {string} foe
 * @param {object} [options]
 * @param {boolean} [options.halted]      Did it pick that enemy to halt?
 * @returns {ReactRecord}
 */
export function noteReact(record, react, foe, { halted = false } = {}) {
  const done = record?.[react.skill] ?? { count: 0, foes: [], halted: [] };
  return {
    ...(record ?? {}),
    [react.skill]: {
      count: (done.count ?? 0) + 1,
      foes: [...new Set([...(done.foes ?? []), foe])],
      halted: halted ? [...new Set([...(done.halted ?? []), foe])] : [...(done.halted ?? [])]
    }
  };
}

/* -------------------------------------------- */

/**
 * Is the enemy's move over once a unit has reacted to it?
 * @param {Reacting} react
 * @param {object} [came]
 * @param {boolean} [came.hurt]       Did the reaction take HP off the enemy?
 * @param {boolean} [came.picked]     Was the enemy picked to be halted?
 * @returns {boolean}
 */
export function haltsAfter(react, { hurt = false, picked = false } = {}) {
  if ( react?.halts === "always" ) return true;
  if ( react?.halts === "hurt" ) return !!hurt;
  if ( react?.halts === "pick" ) return !!picked;
  return false;
}

/* -------------------------------------------- */

/**
 * How far a unit moves that gets out of an enemy's way: half its MOV, rounded down.
 * @param {number} mov
 * @returns {number}
 */
export function halfMov(mov) {
  return Math.max(Math.floor((Number(mov) || 0) / 2), 0);
}

/* -------------------------------------------- */
/*  Along a Way                                 */
/* -------------------------------------------- */

/**
 * @typedef Watcher
 * A unit that may react to a move, as the map knows it.
 * @property {string} id              What tells it from the others: its token
 * @property {Tile} tile              Where it stands
 * @property {Reacting} react
 * @property {(tile: Tile) => boolean} [covers]     Is a tile within the reach of that reaction?
 */

/**
 * @typedef Trap
 * A trap that lies on a tile.
 * @property {string} id              What tells it from the others
 * @property {Tile} tile
 * @property {string} by              The unit that laid it, by its token
 * @property {string} skill           The skill it was laid with
 * @property {string} [weapon]        The weapon it was laid with, by its Item
 * @property {"any"|"enemy"} who
 * @property {boolean} halts
 * @property {boolean} strike
 */

/**
 * @typedef WayEvent
 * Something that comes of a move, at a tile of its way.
 * @property {"move"|"enters"|"pass"|"trap"} kind
 * @property {number} at              The place in the way where the mover stands as it comes about
 * @property {Tile} tile              That tile
 * @property {string} [id]            The unit that reacts
 * @property {Reacting} [react]
 * @property {Trap} [trap]
 * @property {boolean} [prevented]    For a reaction to a move: it comes before the mover has left its tile
 * @property {number} [onto]          For a "pass": the place in the way of the tile the mover would step onto
 */

/** The order in which what comes about on one tile is dealt with. */
const EVENT_ORDER = ["enters", "trap", "move", "pass"];

/**
 * What comes of a move along its way: the reactions of the units that watch it and the traps it crosses, each
 * at the first tile where it comes about, in the order the mover meets them. A unit reacts where the mover
 * can stand: on the tile it sets out from, if that lies within the reach already (the move is then prevented),
 * or on the first tile of the way within the reach that it could stop on. As an enemy "enters" a reach, the
 * step that takes it in from outside counts, wherever it could stop. A unit it would step onto has it stop on
 * the last tile before that one where it can stand. A trap catches it on the tile it lies on.
 * @param {Tile[]} way                The tiles of the move, from the one the mover stands on to its last
 * @param {object} [field]
 * @param {Watcher[]} [field.watchers]
 * @param {Trap[]} [field.traps]      The traps that catch this mover
 * @param {(tile: Tile, index: number) => boolean} [field.stands]     Could the mover stop on that tile?
 * @param {string[]} [field.done]     The reactions already dealt with on this move, each as `id|skill`
 * @returns {WayEvent[]}
 */
export function eventsAlong(way, { watchers = [], traps = [], stands = () => true, done = [] } = {}) {
  const events = [];
  if ( !Array.isArray(way) || (way.length < 2) ) return events;
  const settled = new Set(done);
  const stops = (index) => (index === 0) || !!stands(way[index], index);
  for ( const watcher of watchers ) {
    const react = watcher?.react;
    if ( !react || settled.has(`${watcher.id}|${react.skill}`) ) continue;
    const covers = watcher.covers ?? (() => false);
    if ( react.to === "move" ) {
      const at = way.findIndex((tile, index) => covers(tile) && stops(index));
      if ( at >= 0 ) events.push({ kind: "move", at, tile: way[at], id: watcher.id, react, prevented: at === 0 });
    }
    else if ( react.to === "enters" ) {
      const at = way.findIndex((tile, index) => (index > 0) && covers(tile) && !covers(way[index - 1]));
      if ( at > 0 ) events.push({ kind: "enters", at, tile: way[at], id: watcher.id, react });
    }
    else if ( react.to === "pass" ) {
      const onto = way.findIndex((tile, index) => (index > 0) && (tileKey(tile) === tileKey(watcher.tile)));
      if ( onto > 0 ) {
        let at = onto - 1;
        while ( (at > 0) && !stops(at) ) at--;
        events.push({ kind: "pass", at, tile: way[at], id: watcher.id, react, onto });
      }
    }
  }
  for ( const trap of traps ) {
    const at = way.findIndex((tile, index) => (index > 0) && (tileKey(tile) === tileKey(trap.tile)) && stops(index));
    if ( at > 0 ) events.push({ kind: "trap", at, tile: way[at], trap });
  }
  return events.sort((a, b) => (a.at - b.at) || (EVENT_ORDER.indexOf(a.kind) - EVENT_ORDER.indexOf(b.kind)));
}

/* -------------------------------------------- */

/**
 * Is a tile within so many spaces of another, counted along rows and columns: at least `min` and at most
 * `max` away?
 * @param {Tile} from
 * @param {Tile} tile
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
export function withinSpaces(from, tile, min, max) {
  const apart = tilesApart(from, tile);
  return (apart >= min) && (apart <= max);
}

/* -------------------------------------------- */

/**
 * The units that may strike an enemy once a fight has ended in which it took HP off one of their allies: each
 * with the reaction that lets it, where that enemy stands within the reaction's reach. Neither the unit that
 * was hurt nor one that fought in the fight is among them.
 * @param {{id: string, side: string, tile: Tile, out?: boolean, reacts?: Reacting[], covers?: (react: Reacting, tile: Tile) => boolean}[]} units
 *                                            The units on the map
 * @param {object} fight
 * @param {string} fight.hurt                 The unit that lost HP
 * @param {string} fight.by                   The unit that took it off
 * @param {object} [options]
 * @param {(a: string, b: string) => "ally"|"enemy"|null} [options.relation]    What two sides are to each other
 * @returns {{id: string, react: Reacting}[]}
 */
export function avengersOf(units, { hurt, by }, { relation = null } = {}) {
  const camps = FEO.camps ?? {};
  const stands = relation ?? ((a, b) => {
    const mine = camps[a] ?? null;
    const theirs = camps[b] ?? null;
    return (!mine || !theirs) ? null : (mine === theirs) ? "ally" : "enemy";
  });
  const victim = (units ?? []).find((unit) => unit.id === hurt);
  const foe = (units ?? []).find((unit) => unit.id === by);
  if ( !victim || !foe || foe.out ) return [];
  const found = [];
  for ( const unit of units ) {
    if ( unit.out || (unit.id === hurt) || (unit.id === by) ) continue;
    if ( (stands(unit.side, victim.side) !== "ally") || (stands(unit.side, foe.side) !== "enemy") ) continue;
    for ( const react of unit.reacts ?? [] ) {
      if ( (react.to !== "allyHurt") || !unit.covers?.(react, foe.tile) ) continue;
      found.push({ id: unit.id, react });
      break;
    }
  }
  return found;
}

/* -------------------------------------------- */
/*  Traps                                       */
/* -------------------------------------------- */

/**
 * What a skill's trap is, with nothing else on it.
 * @param {any} part      The `trap` of an `act`
 * @returns {{costs: {weapon: string[], uses: number}|null, most: number, who: "any"|"enemy", halts: boolean, strike: boolean}|null}
 */
export function trapOf(part) {
  if ( !part || (typeof part !== "object") ) return null;
  const kinds = [].concat(part.costs?.weapon ?? []).filter((kind) => typeof kind === "string");
  return {
    costs: part.costs ? { weapon: kinds, uses: Math.max(Math.floor(Number(part.costs.uses) || 1), 1) } : null,
    most: Math.max(Math.floor(Number(part.most) || 0), 0),
    who: (part.who === "enemy") ? "enemy" : "any",
    halts: part.halts !== false,
    strike: !!part.strike
  };
}

/* -------------------------------------------- */

/**
 * Check a `trap` for what the rules do not know.
 * @param {any} part
 * @returns {string[]}
 */
export function checkTrap(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ["a trap says what it costs and what it does"];
  for ( const key of Object.keys(part) ) if ( !TRAP_PARTS.includes(key) ) problems.push(`a trap cannot say "${key}"`);
  if ( part.costs !== undefined ) {
    const kinds = [].concat(part.costs?.weapon ?? []);
    if ( !kinds.length || kinds.some((kind) => typeof kind !== "string") ) problems.push('trap: "costs" names the kind of weapon it is laid with');
    if ( (part.costs?.uses !== undefined) && !(Number.isInteger(part.costs.uses) && (part.costs.uses >= 1)) ) problems.push('trap: "uses" is a number');
  }
  if ( (part.most !== undefined) && !(Number.isInteger(part.most) && (part.most >= 1)) ) problems.push('trap: "most" is how many may lie at once');
  if ( (part.who !== undefined) && !["any", "enemy"].includes(part.who) ) problems.push('trap: it catches "any" unit or an "enemy"');
  if ( !part.strike && (part.halts === false) ) problems.push("trap: a trap halts, strikes or both");
  if ( part.strike && !part.costs ) problems.push("trap: a trap that strikes is laid with a weapon");
  return problems;
}

/* -------------------------------------------- */

/**
 * Lay a trap among those a unit has lying. One more than it may have takes the place of the oldest.
 * @param {Trap[]} [list]             The traps it has lying, oldest first
 * @param {Trap} trap
 * @param {number} [most]             How many it may have; 0 for any number
 * @returns {{list: Trap[], dropped: Trap[]}}
 */
export function layTrap(list, trap, most = 0) {
  const lying = [...(list ?? []).filter((other) => tileKey(other.tile) !== tileKey(trap.tile)), trap];
  const over = (most > 0) ? Math.max(lying.length - most, 0) : 0;
  return { list: lying.slice(over), dropped: lying.slice(0, over) };
}

/* -------------------------------------------- */

/**
 * Does a trap catch a unit that moves onto its tile? Never the unit that laid it; any other, or only an enemy
 * of that unit.
 * @param {Trap} trap
 * @param {string} mover                              The unit that moves, by its token
 * @param {"ally"|"enemy"|null} [relation]            What it is to the unit that laid the trap
 * @returns {boolean}
 */
export function trapCatches(trap, mover, relation = null) {
  if ( !trap || (trap.by === mover) ) return false;
  return (trap.who === "enemy") ? (relation === "enemy") : true;
}

/* -------------------------------------------- */
/*  Unseen                                      */
/* -------------------------------------------- */

/**
 * Is a unit one that another does not see: one that is hidden, asked by one of its enemies?
 * @param {string[]|Set<string>|null} rules           The rules the unit's skills and stances bend
 * @param {"ally"|"enemy"|"friend"|"foe"|null} relation   What the unit that looks is to it
 * @returns {boolean}
 */
export function unseenBy(rules, relation) {
  const has = (rules instanceof Set) ? rules.has(HIDDEN) : !!rules?.includes?.(HIDDEN);
  return has && ((relation === "enemy") || (relation === "foe"));
}

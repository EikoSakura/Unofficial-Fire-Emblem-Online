/**
 * Standing guard for Fire Emblem Online: the stances a unit enters and keeps until something ends them, the
 * units that fight in another's place, and the units that take a hit meant for another or turn it back. Pure
 * functions of plain data, so that they can be tested outside of Foundry.
 *
 * A stance is a lasting change (see `timed.mjs`) that says so: a skill used as an action grants it to its unit
 * with a `stance` beside what the change does, and the unit keeps it until its change ends or until something
 * the stance names comes about, whichever is first:
 *
 *   { proc: { on: "use", sure: true },
 *     grant: { to: "self", ends: "turnStart",
 *       stance: { state: "Hold",                 // what the state is called, where the rules name one: Canto
 *                                                // then does not follow the skill, where it excepts that state
 *                 until: ["move", "alone"],      // what ends it early: its unit "move"s (however it is moved),
 *                                                // stands "alone" (no ally next to it), makes an "attack", or
 *                                                // stands on another kind of "terrain" than those of `on`
 *                 on: ["forest", "thicket"],     // the kinds of terrain it is kept on, and entered on
 *                 mark: "hold" },                // the small mark on its token: "hold", "guard" or "hidden"
 *       effects: [...] } }                       // what it does while it lasts, as any change says it
 *
 * A unit fights in another's place with a `guards` part, which is always there: on a skill, or among the
 * effects of a stance, so that it lasts as long as the stance does. When an enemy starts a fight with a unit
 * that has a guard, the guard is fought instead, at the distance and on the ground of the unit it stands in for:
 *
 *   guards: { who: "ally", within: 1 }           // it takes the place of an ally next to it
 *   guards: { who: "ally", within: 1, may: true, // `may`: whoever acts for it is asked as the attack is made
 *             swap: true,                        // the two trade places once the fight is over
 *             effects: [{ endurance: 3 }] }      // what the guard has for that fight alone
 *   guards: { who: "ally", within: 1, self: true, may: true,
 *             through: { quality: ["Terror"], within: 1 } }
 *                                                // not its unit but an ally of that quality next to it fights:
 *                                                // in the place of its unit (`self`), or of an ally that
 *                                                // stands next to that stand-in as well
 *   guards: { who: "ally", within: 1, only: "giver" }      // in a change another unit left: it takes the
 *                                                // place of that unit alone
 *
 * A guard that stands by a stance is known before the attack is made, and the forecast shows it as the target;
 * one that `may` is asked in one click as the attack is confirmed, and a unit that answers by itself steps in
 * where that spares its side (see `stepsInAlone`).
 *
 * And a unit takes a hit meant for an ally, or turns it back, with a `wards` part, which is always there too.
 * It is an answer in the middle of somebody else's fight (see `answers.mjs`), at the point where a hit that
 * deals damage would land on the ally:
 *
 *   wards: { who: "ally", within: 1, takes: true }         // its unit takes the damage instead, worked out
 *                                                // again with its own DEF or RES
 *   wards: { who: "ally", within: 1, negate: true, returns: 50, heavy: 50 }
 *                                                // the hit is negated and that share of it dealt to the
 *                                                // attacker; `heavy`: only a hit that takes this share of
 *                                                // the HP the ally has left, or more
 *
 * A skill that wards counts its uses and its cooldown as one that takes effect by itself does
 * (`usage.kind: "auto"`): each answer taken is a use.
 *
 * And a unit shelters the allies around it with a `shelters` part, which is always there as well and says
 * nothing of a fight: an enemy that stands near its unit attacks none of them from there, which the map sees
 * to as it offers targets and tiles to attack from:
 *
 *   { when: { hp: { op: "lt", percent: 50 } }, shelters: { who: "ally", within: 2, from: 2 } }
 *                                                // while its unit is below half its HP: an enemy within 2
 *                                                // tiles of it cannot attack an ally within 2 tiles of it.
 *                                                // The unit itself can be attacked, and so can those allies
 *                                                // from further away than `from`
 *
 * @import {Tile} from "./reach.mjs"
 */
import { FEO } from "../config.mjs";
import { tilesApart } from "./reach.mjs";

/** What can end a stance before its change does. */
export const STANCE_ENDS = ["move", "alone", "attack", "terrain"];

/** The marks a stance can put on its unit's token. */
export const STANCE_MARKS = ["hold", "guard", "hidden"];

/** What a `stance` can say. */
export const STANCE_PARTS = ["state", "until", "on", "mark"];

/** What a `guards` part can say, and a `wards` part. */
export const GUARD_PARTS = ["who", "within", "may", "swap", "effects", "through", "self", "only"];
export const WARD_PARTS = ["who", "within", "takes", "negate", "returns", "heavy"];

/** What a `shelters` part can say. */
export const SHELTER_PARTS = ["who", "within", "from"];

/** The point of a fight at which a unit outside it may take a hit meant for an ally, or turn it back. */
export const BLOW = "blow";

/* -------------------------------------------- */
/*  Stances                                     */
/* -------------------------------------------- */

/**
 * @typedef Stance
 * @property {string} state           What the state is called; empty for one without a name of its own
 * @property {string[]} until         What ends it early (see `STANCE_ENDS`)
 * @property {string[]} on            The kinds of terrain it is kept on
 * @property {string} mark            The mark on its unit's token (see `STANCE_MARKS`)
 */

/**
 * A stance as a lasting change keeps it, with nothing else on it.
 * @param {any} stance      As a `grant` says it
 * @returns {Stance|null}   Null for none
 */
export function stanceOf(stance) {
  if ( !stance || (typeof stance !== "object") ) return null;

  // One that says nothing at all is none, as a change that is no stance is saved
  if ( !stance.state && !stance.mark && !stance.until?.length && !stance.on?.length ) return null;
  const list = (value) => (Array.isArray(value) ? value : []).filter((entry) => (typeof entry === "string") && entry);
  const until = list(stance.until).filter((entry) => STANCE_ENDS.includes(entry));
  const on = list(stance.on);
  return {
    state: (typeof stance.state === "string") ? stance.state : "",
    until: (on.length && !until.includes("terrain")) ? [...until, "terrain"] : until,
    on,
    mark: STANCE_MARKS.includes(stance.mark) ? stance.mark : "hold"
  };
}

/* -------------------------------------------- */

/**
 * Check a `stance` for what the rules do not know.
 * @param {any} stance
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkStance(stance) {
  const problems = [];
  if ( !stance || (typeof stance !== "object") || Array.isArray(stance) ) return ["a stance says what it is called, what ends it and how it is marked"];
  for ( const key of Object.keys(stance) ) if ( !STANCE_PARTS.includes(key) ) problems.push(`a stance cannot say "${key}"`);
  if ( (stance.state !== undefined) && ((typeof stance.state !== "string") || !stance.state) ) problems.push('stance: "state" is what the state is called');
  if ( stance.until !== undefined ) {
    if ( !Array.isArray(stance.until) ) problems.push('stance: "until" lists what ends it');
    else for ( const end of stance.until ) if ( !STANCE_ENDS.includes(end) ) problems.push(`stance: nothing ends a stance at "${end}"`);
  }
  if ( stance.on !== undefined ) {
    if ( !Array.isArray(stance.on) || !stance.on.length ) problems.push('stance: "on" lists kinds of terrain');
    else for ( const kind of stance.on ) if ( !(kind in (FEO.terrain?.types ?? {})) ) problems.push(`stance: "${kind}" is no kind of terrain`);
  }
  if ( (stance.mark !== undefined) && !STANCE_MARKS.includes(stance.mark) ) problems.push(`stance: "${stance.mark}" is no mark`);
  return problems;
}

/* -------------------------------------------- */

/**
 * The stances a unit is in: each change it carries that is one and has begun.
 * @param {import("./timed.mjs").TimedChange[]} [list]      What the unit carries
 * @returns {{name: string, from: string, stance: Stance}[]}
 */
export function stancesOf(list) {
  return (list ?? []).filter((change) => stanceOf(change?.stance) && !((change.wait ?? 0) > 0) && !change.spoiled)
    .map((change) => ({ name: change.name, from: change.from ?? "", stance: stanceOf(change.stance) }));
}

/* -------------------------------------------- */

/**
 * @typedef StanceFacts
 * What has come about for a unit, of the things that end a stance. Only what is given is judged.
 * @property {boolean} [moved]        It was moved, by itself or by anything else
 * @property {number} [allies]        How many allies stand next to it
 * @property {boolean} [attacked]     It made an attack
 * @property {string} [terrain]       The kind of terrain it stands on
 */

/**
 * Does a stance end with what has come about?
 * @param {Stance|null} stance
 * @param {StanceFacts} [facts]
 * @returns {boolean}
 */
export function stanceLapses(stance, facts = {}) {
  if ( !stance ) return false;
  const until = stance.until ?? [];
  if ( until.includes("move") && facts.moved ) return true;
  if ( until.includes("alone") && (facts.allies !== undefined) && !(facts.allies > 0) ) return true;
  if ( until.includes("attack") && facts.attacked ) return true;
  if ( until.includes("terrain") && (facts.terrain !== undefined) && stance.on?.length && !stance.on.includes(facts.terrain) ) return true;
  return false;
}

/* -------------------------------------------- */

/**
 * The changes a unit keeps once something has come about that may end its stances.
 * @param {import("./timed.mjs").TimedChange[]} [list]      What the unit carries
 * @param {StanceFacts} [facts]
 * @returns {{list: object[], ended: object[], changed: boolean}}
 */
export function keepStances(list, facts = {}) {
  const kept = [];
  const ended = [];
  for ( const change of list ?? [] ) {
    if ( stanceLapses(stanceOf(change?.stance), facts) ) ended.push(change);
    else kept.push(change);
  }
  return { list: kept, ended, changed: ended.length > 0 };
}

/* -------------------------------------------- */

/**
 * The states a skill has its unit enter as it is used, by name: what Canto asks, where it does not follow a
 * skill that enters a state it excepts.
 * @param {object[]} [effects]      The skill's effects
 * @returns {string[]}
 */
export function statesEntered(effects) {
  const states = [];
  for ( const effect of effects ?? [] ) {
    const state = (effect?.proc?.on === "use") ? stanceOf(effect.grant?.stance)?.state : "";
    if ( state && !states.includes(state) ) states.push(state);
  }
  return states;
}

/* -------------------------------------------- */

/**
 * The kinds of terrain a skill's stance is entered on, where it names any: its unit must stand on one of them
 * to use the skill.
 * @param {object[]} [effects]      The skill's effects
 * @returns {string[]}              Empty for a skill that asks for none
 */
export function stanceGround(effects) {
  const kinds = [];
  for ( const effect of effects ?? [] ) {
    if ( effect?.proc?.on !== "use" ) continue;
    for ( const kind of stanceOf(effect.grant?.stance)?.on ?? [] ) if ( !kinds.includes(kind) ) kinds.push(kind);
  }
  return kinds;
}

/* -------------------------------------------- */
/*  Fighting in Another's Place                 */
/* -------------------------------------------- */

/**
 * @typedef Guarding
 * One way a unit has of having an ally fought for.
 * @property {string} skill           The skill, or the stance, it comes from
 * @property {string} [id]            The skill Item, where there is one
 * @property {number} within          How near the ally must stand to the unit that fights for it
 * @property {boolean} may            Is whoever acts for the unit asked, as the attack is made?
 * @property {boolean} swap           Do the two trade places once the fight is over?
 * @property {object[]} effects       What the guard has for that fight alone
 * @property {{quality: string[], within: number}|null} through
 *                                    Not the unit itself but an ally of such a quality next to it fights
 * @property {boolean} self           With `through`: the unit itself may be stood in for
 * @property {string} only            The one unit it stands in for, by its UUID; empty for any ally
 */

/**
 * One `guards` part as the rules keep it.
 * @param {object} part
 * @param {object} [about]
 * @param {string} [about.skill]      The skill it comes from
 * @param {string} [about.id]         That skill's Item
 * @param {string} [about.by]         For a part in a change another unit left: that unit, by its UUID
 * @returns {Guarding|null}           Null for a part that guards nobody
 */
export function guardOf(part, { skill = "", id = "", by = "" } = {}) {
  if ( !part || (typeof part !== "object") ) return null;
  if ( (part.only === "giver") && !by ) return null;
  const through = (part.through && (typeof part.through === "object")) ? {
    quality: [].concat(part.through.quality ?? []).filter((quality) => typeof quality === "string"),
    within: Math.max(Math.floor(Number(part.through.within) || 1), 1)
  } : null;
  return {
    skill, id,
    within: Math.max(Math.floor(Number(part.within) || 1), 1),
    may: !!part.may,
    swap: !!part.swap,
    effects: Array.isArray(part.effects) ? part.effects : [],
    through: through?.quality.length ? through : null,
    self: !!part.self && !!through,
    only: (part.only === "giver") ? by : ""
  };
}

/* -------------------------------------------- */

/**
 * Check a `guards` part for what the rules do not know.
 * @param {any} part
 * @returns {string[]}
 */
export function checkGuards(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ['"guards" says whose place its unit takes'];
  for ( const key of Object.keys(part) ) if ( !GUARD_PARTS.includes(key) ) problems.push(`guards cannot say "${key}"`);
  if ( part.who !== "ally" ) problems.push('guards: a unit takes the place of an "ally"');
  if ( (part.within !== undefined) && !(Number.isInteger(part.within) && (part.within >= 1)) ) problems.push('guards: "within" is a number of tiles');
  if ( (part.effects !== undefined) && !Array.isArray(part.effects) ) problems.push('guards: "effects" is a list of effects');
  if ( (part.only !== undefined) && (part.only !== "giver") ) problems.push('guards: "only" names the "giver" of the change it is in');
  if ( part.through !== undefined ) {
    const quality = [].concat(part.through?.quality ?? []);
    if ( !quality.length || quality.some((entry) => typeof entry !== "string") ) problems.push('guards: "through" names the Special Qualities of the unit that fights');
    for ( const key of Object.keys(part.through ?? {}) ) if ( !["quality", "within"].includes(key) ) problems.push(`guards: "through" cannot say "${key}"`);
  }
  if ( part.self && !part.through ) problems.push('guards: "self" goes with "through", for a unit that has another fight in its own place');
  return problems;
}

/* -------------------------------------------- */

/**
 * @typedef GuardUnit
 * A unit on the map, as the rules of guarding know it.
 * @property {string} id              What tells it from the others: its token
 * @property {string} [uuid]          The unit itself, for a guard that stands in for one unit alone
 * @property {Tile} tile              Where it stands
 * @property {string} side            The side it fights for, a key of `FEO.camps`
 * @property {boolean} [out]          Has it left the fight, is it down or without HP?
 * @property {string} [qualities]     Its Special Qualities
 * @property {Guarding[]} [guard]     The ways it has of having an ally fought for
 */

/**
 * @typedef GuardOffer
 * A unit that may be fought in another's place.
 * @property {string} guard           The unit that would fight, by what tells it from the others
 * @property {string} holder          The unit whose skill or stance has it so: the guard itself, or the unit
 *                                    that has another fight for it; whoever acts for it is asked
 * @property {string} skill
 * @property {string} id              The skill Item of the holder, where there is one
 * @property {boolean} may
 * @property {boolean} swap
 * @property {object[]} effects
 */

/**
 * Does a unit have any of a list of Special Qualities?
 * @param {string} [qualities]
 * @param {string[]} list
 * @returns {boolean}
 */
function hasAny(qualities, list) {
  const held = String(qualities ?? "").split(",").map((quality) => quality.trim().toLowerCase()).filter(Boolean);
  return list.some((quality) => held.includes(String(quality).trim().toLowerCase()));
}

/**
 * The units that may be fought in the place of a unit an enemy starts a fight with: those that stand guard for
 * it first, in the order they are listed, then those that may step in if whoever acts for them says so. A unit
 * is listed once, nobody stands in for a guard in its turn, and neither the unit attacked nor its attacker
 * stands in for anyone.
 * @param {GuardUnit} target                  The unit the attack is made on
 * @param {GuardUnit} attacker                The unit that makes it
 * @param {GuardUnit[]} units                 The units on the map
 * @param {object} [options]
 * @param {(a: string, b: string) => "ally"|"enemy"|null} [options.relation]    What two sides are to each other
 * @returns {GuardOffer[]}
 */
export function guardsFor(target, attacker, units, { relation = null } = {}) {
  const camps = FEO.camps ?? {};
  const stands = relation ?? ((a, b) => {
    const mine = camps[a] ?? null;
    const theirs = camps[b] ?? null;
    return (!mine || !theirs) ? null : (mine === theirs) ? "ally" : "enemy";
  });
  if ( !target || !attacker || (stands(attacker.side, target.side) !== "enemy") ) return [];
  const fights = (unit) => !!unit && !unit.out && (unit.id !== attacker.id) && (stands(unit.side, attacker.side) === "enemy");
  const sure = [];
  const asked = [];
  const listed = new Set();
  const offer = (guard, holder, way) => {
    if ( listed.has(guard.id) ) return;
    listed.add(guard.id);
    (way.may ? asked : sure).push({ guard: guard.id, holder: holder.id, skill: way.skill, id: way.id ?? "", may: way.may, swap: way.swap, effects: way.effects });
  };
  for ( const holder of units ?? [] ) {
    if ( !fights(holder) || (stands(holder.side, target.side) !== "ally") ) continue;
    for ( const way of holder.guard ?? [] ) {
      if ( way.only && (way.only !== target.uuid) ) continue;

      // The unit itself fights in the place of an ally near it
      if ( !way.through ) {
        if ( (holder.id === target.id) || (tilesApart(holder.tile, target.tile) > way.within) ) continue;
        offer(holder, holder, way);
        continue;
      }

      // Another unit fights: an ally of the right kind near the holder, in the holder's place or in that of an
      // ally which stands near that unit as well
      for ( const standIn of units ) {
        if ( !fights(standIn) || (standIn.id === holder.id) || (standIn.id === target.id) ) continue;
        if ( (stands(standIn.side, holder.side) !== "ally") || !hasAny(standIn.qualities, way.through.quality) ) continue;
        if ( tilesApart(standIn.tile, holder.tile) > way.through.within ) continue;
        const own = holder.id === target.id;
        if ( own ? !way.self : (tilesApart(standIn.tile, target.tile) > way.within) ) continue;
        offer(standIn, holder, way);
      }
    }
  }
  return [...sure, ...asked];
}

/* -------------------------------------------- */

/**
 * What the attacks of a side come to if they all land: the damage of each, added up.
 * @param {{damage?: number, hit?: number}[]} [blows]     The attacks it would make (see `side.blows` of a plan)
 * @returns {number}
 */
export function blowsTotal(blows) {
  return (blows ?? []).reduce((sum, blow) => sum + (((blow?.hit ?? 100) > 0) ? Math.max(blow?.damage ?? 0, 0) : 0), 0);
}

/* -------------------------------------------- */

/**
 * Does a unit that answers by itself step into the place of an ally? It does where the attacks would not
 * defeat it, and would either defeat the ally or take more off the ally than off itself.
 * @param {object} fight
 * @param {{hp: number, takes: number}} fight.ally      The HP the ally has, and what the attacks would take
 * @param {{hp: number, takes: number}} fight.guard     The same for the unit that would step in
 * @returns {boolean}
 */
export function stepsInAlone({ ally, guard } = {}) {
  if ( !ally || !guard || !(ally.takes > 0) ) return false;
  if ( guard.takes >= guard.hp ) return false;
  return (ally.takes >= ally.hp) || (guard.takes < ally.takes);
}

/* -------------------------------------------- */
/*  Taking a Hit Meant for Another              */
/* -------------------------------------------- */

/**
 * @typedef Warding
 * One way a unit has of answering a hit that would land on an ally.
 * @property {string} skill
 * @property {string} [id]            The skill Item
 * @property {number} within          How near the ally must stand
 * @property {boolean} takes          Does it take the damage itself, worked out again with its own defence?
 * @property {boolean} negate         Is the hit negated?
 * @property {number} returns         The share of the hit, in percent, that is dealt to the attacker
 * @property {number} heavy           The share of the HP its ally has left, in percent, the hit must take
 */

/**
 * One `wards` part as the rules keep it.
 * @param {object} part
 * @param {{skill?: string, id?: string}} [about]
 * @returns {Warding|null}
 */
export function wardOf(part, { skill = "", id = "" } = {}) {
  if ( !part || (typeof part !== "object") || !(part.takes || part.negate) ) return null;
  return {
    skill, id,
    within: Math.max(Math.floor(Number(part.within) || 1), 1),
    takes: !!part.takes,
    negate: !!part.negate && !part.takes,
    returns: Math.min(Math.max(Number(part.returns) || 0, 0), 1000),
    heavy: Math.min(Math.max(Number(part.heavy) || 0, 0), 100)
  };
}

/* -------------------------------------------- */
/*  Sheltering the Allies Around                */
/* -------------------------------------------- */

/**
 * @typedef Sheltering
 * One way a unit has of keeping the enemies near it from attacking the allies around it.
 * @property {string} skill           The skill, or the stance, it comes from
 * @property {string} [id]            The skill Item, where there is one
 * @property {number} within          How near to the unit an ally must stand to be sheltered
 * @property {number} from            How near to the unit an enemy must stand to be kept from attacking it
 */

/**
 * One `shelters` part as the rules keep it.
 * @param {object} part
 * @param {object} [about]
 * @param {string} [about.skill]      The skill it comes from
 * @param {string} [about.id]         That skill's Item
 * @returns {Sheltering|null}         Null for a part that shelters nobody
 */
export function shelterOf(part, { skill = "", id = "" } = {}) {
  if ( !part || (typeof part !== "object") ) return null;
  const within = Math.max(Math.floor(Number(part.within) || 1), 1);
  return { skill, id, within, from: Math.max(Math.floor(Number(part.from) || within), 1) };
}

/* -------------------------------------------- */

/**
 * Check a `shelters` part for what the rules do not know.
 * @param {any} part
 * @returns {string[]}
 */
export function checkShelters(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ['"shelters" says which allies its unit shelters'];
  for ( const key of Object.keys(part) ) if ( !SHELTER_PARTS.includes(key) ) problems.push(`shelters cannot say "${key}"`);
  if ( part.who !== "ally" ) problems.push('shelters: a unit shelters an "ally"');
  for ( const key of ["within", "from"] ) {
    if ( (part[key] !== undefined) && !(Number.isInteger(part[key]) && (part[key] >= 1)) ) problems.push(`shelters: "${key}" is a number of tiles`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * The unit that keeps another from being attacked from a tile, if one does: a unit of the target's side whose
 * skill shelters the allies around it, with the target near enough to it and the tile near enough as well.
 * @param {{tile: Tile, name?: string, shelters: Sheltering[]}[]} guards    The units of the target's side that
 *                                      shelter their allies and still stand, the target itself left out
 * @param {Tile} target                 The tile of the unit that would be attacked
 * @param {Tile} from                   The tile it would be attacked from
 * @returns {{name: string, skill: string}|null}
 */
export function shelteredFrom(guards, target, from) {
  for ( const guard of guards ?? [] ) {
    for ( const shelter of guard.shelters ?? [] ) {
      if ( (tilesApart(guard.tile, target) <= shelter.within) && (tilesApart(guard.tile, from) <= shelter.from) ) {
        return { name: guard.name ?? "", skill: shelter.skill };
      }
    }
  }
  return null;
}

/* -------------------------------------------- */

/**
 * Check a `wards` part for what the rules do not know.
 * @param {any} part
 * @returns {string[]}
 */
export function checkWards(part) {
  const problems = [];
  if ( !part || (typeof part !== "object") || Array.isArray(part) ) return ['"wards" says what its unit does about a hit on an ally'];
  for ( const key of Object.keys(part) ) if ( !WARD_PARTS.includes(key) ) problems.push(`wards cannot say "${key}"`);
  if ( part.who !== "ally" ) problems.push('wards: a unit answers a hit on an "ally"');
  if ( (part.within !== undefined) && !(Number.isInteger(part.within) && (part.within >= 1)) ) problems.push('wards: "within" is a number of tiles');
  if ( !part.takes && !part.negate ) problems.push('wards: its unit "takes" the hit, or has it "negate"d');
  if ( part.takes && part.negate ) problems.push('wards: a hit is taken or negated, not both');
  for ( const key of ["returns", "heavy"] ) {
    if ( (part[key] !== undefined) && !(Number.isFinite(part[key]) && (part[key] > 0)) ) problems.push(`wards: "${key}" is a share in percent`);
  }
  return problems;
}

/* -------------------------------------------- */

/**
 * @typedef WardStandby
 * A unit that stands by as a fight is rolled, to answer a hit that would land on its ally (see `combat.mjs`).
 * @property {string} key             What tells it from the others: its token and its skill
 * @property {string} skill
 * @property {string} by              Its name
 * @property {"blow"} at              The point it answers
 * @property {boolean} takes
 * @property {boolean} negate
 * @property {number} returns
 * @property {number} heavy
 * @property {number} hp              The HP it has
 * @property {{def: number, res: number}} stats     What it resists a hit with
 */

/**
 * What a hit comes to for the unit that takes it in its ally's place: the same hit, worked out with that
 * unit's DEF or RES in place of the ally's, as often as the hit counts its damage.
 * @param {number} damage             What the hit would deal to the ally
 * @param {number} allyDefence        The DEF or RES the ally resists it with
 * @param {number} ownDefence         The same stat of the unit that takes it
 * @param {number} [times]            How often the hit counts its damage: more for a critical hit, less for an
 *                                    attack that deals a share of it
 * @returns {number}
 */
export function hitRedirected(damage, allyDefence, ownDefence, times = 1) {
  return Math.max(damage + Math.floor((((allyDefence ?? 0) - (ownDefence ?? 0)) * times) + 1e-9), 0);
}

/* -------------------------------------------- */

/**
 * What the units that stand by offer as a hit that deals damage would land on their ally: each once in a
 * fight, and one that asks for a heavy hit only for a hit that takes that share of the HP the ally has left.
 * @param {WardStandby[]} [standby]           The units that stand by for the side that is hit
 * @param {object} hit
 * @param {number} hit.damage                 What it would deal
 * @param {number} hit.hp                     The HP its target has
 * @param {"def"|"res"} [hit.against]         What resists it
 * @param {number} [hit.defence]              That stat of its target
 * @param {number} [hit.times]                How often it counts its damage
 * @param {Set<string>|string[]} [used]       The keys of those that have answered in this fight
 * @returns {{key: string, skill: string, what: "redirect"|"rebuke", amount: number, by: string, hp: number}[]}
 */
export function wardOffers(standby, { damage = 0, hp = 0, against = "def", defence = 0, times = 1 } = {}, used = []) {
  const spent = new Set(used);
  if ( !(damage > 0) || !(hp > 0) ) return [];
  const offers = [];
  for ( const ally of standby ?? [] ) {
    if ( (ally?.at !== BLOW) || spent.has(ally.key) ) continue;
    if ( (ally.heavy > 0) && ((damage * 100) < (hp * ally.heavy)) ) continue;
    if ( ally.takes ) {
      offers.push({ key: ally.key, skill: ally.skill, what: "redirect", amount: hitRedirected(damage, defence, ally.stats?.[against] ?? 0, times), by: ally.by, hp: ally.hp ?? 0 });
    }
    else if ( ally.negate ) {
      offers.push({ key: ally.key, skill: ally.skill, what: "rebuke", amount: Math.floor(((damage * (ally.returns ?? 0)) / 100) + 1e-9), by: ally.by, hp: ally.hp ?? 0 });
    }
  }
  return offers;
}

/* -------------------------------------------- */

/**
 * Does a unit that answers by itself take a hit meant for its ally, or turn it back? It turns back whatever
 * it can; it takes a hit that would not defeat it, where that hit would defeat its ally or takes less off it
 * than off the ally.
 * @param {{what: string, amount?: number, hp?: number}} offer
 * @param {{damage: number, hp: number}} hit      The hit as it would land on the ally
 * @returns {boolean}
 */
export function wardsAlone(offer, hit) {
  if ( offer?.what === "rebuke" ) return true;
  if ( offer?.what !== "redirect" ) return false;
  const amount = offer.amount ?? 0;
  if ( amount >= (offer.hp ?? 0) ) return false;
  return ((hit?.damage ?? 0) >= (hit?.hp ?? 0)) || (amount < (hit?.damage ?? 0));
}

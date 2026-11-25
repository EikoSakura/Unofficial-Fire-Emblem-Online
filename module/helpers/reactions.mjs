import { FEO } from "../config.mjs";
import { relationOf } from "../rules/positions.mjs";
import { keyTile, tileKey, tilesApart } from "../rules/reach.mjs";
import {
  RALLY_MARK, avengersOf, eventsAlong, halfMov, haltsAfter, layTrap, noteReact, reactsLeft, trapCatches, trapOf, unseenBy,
  withinSpaces
} from "../rules/reactions.mjs";
import { weaponIs } from "../rules/skills.mjs";
import { disarmerOf } from "../rules/stealing.mjs";
import { buildChange } from "../rules/timed.mjs";
import { rangeOf, reachOf, standsTo, unitsOn } from "./battle-map.mjs";
import { postCard, rollFromResults } from "./chat.mjs";
import { grantUnit, noteFor, pop, spendFor } from "./events.mjs";
import { armyOf, planAttack, strikeBeside, tokenTile } from "./exchange.mjs";
import { laidOn, laidShown, springLaid, trapUnitOf } from "./traps.mjs";
import { springs } from "../rules/traps.mjs";
import { fightTarget } from "./fight.mjs";
import { moveUnits, steps } from "./forced.mjs";
import { movOf, rangesWith, turnMoveOf } from "./movement.mjs";
import { inOwnTurn } from "./phases.mjs";
import { breakItem } from "./weapons.mjs";

/**
 * Reactions in Foundry (see `rules/reactions.mjs`): finding who watches a move and what lies on its way, having
 * each react where the mover stands as it comes about, laying and springing traps, rallying the allies of a
 * unit as an enemy comes into its reach, and striking an enemy that has hurt an ally once their fight is over.
 * The Battle HUD steps a move along its way with this; nothing here decides where a unit may go.
 *
 * @import {Tile} from "../rules/reach.mjs"
 * @import {Reacting, Trap, WayEvent} from "../rules/reactions.mjs"
 */

/** The name by which a unit is called on the map. */
const nameOf = (token) => token?.name || token?.actor?.name || "";

/**
 * The tile a token stands on.
 * @param {TokenDocument|null} token
 * @returns {Tile|null}
 */
function tileOf(token) {
  const tile = tokenTile(token);
  return tile ? { i: tile.i, j: tile.j } : null;
}

/* -------------------------------------------- */

/**
 * Can a unit react at all: one that stands, is not Staggered and suffers from nothing that keeps it from acting?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
function canReact(actor) {
  const system = actor?.system;
  if ( !system || system.defeat?.out || system.defeat?.down || !(system.hp?.value > 0) || system.stagger?.staggered ) return false;
  return !Object.keys(system.conditions ?? {}).some((id) => FEO.conditions[id]?.noAct);
}

/* -------------------------------------------- */

/**
 * What a unit has reacted with since its turn last started.
 * @param {Actor|null} actor
 * @returns {import("../rules/reactions.mjs").ReactRecord}
 */
export function reactedOf(actor) {
  return actor?.getFlag?.(FEO.id, "reacted") ?? {};
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: what it has reacted with is forgotten, so that each of its reactions is open again.
 * @param {Actor|null} actor
 * @returns {Promise<void>}
 */
export async function forgetReacted(actor) {
  if ( (actor?.type === "unit") && actor.getFlag(FEO.id, "reacted") ) await noteFor(actor, "reacted", null);
}

/* -------------------------------------------- */

/**
 * How far the weapon in a unit's hand attacks from where it stands, with what its skills make of its reach:
 * nothing for a unit without a weapon to attack with.
 * @param {TokenDocument} token
 * @returns {{min: number, max: number}|null}
 */
function weaponReach(token) {
  const actor = token.actor;
  const weapon = actor.system.equippedWeapon;
  if ( !weapon || weapon.system.broken || ((weapon.system.uses?.max > 0) && !(weapon.system.uses.value > 0)) ) return null;
  const range = rangeOf(actor, rangesWith(actor, turnMoveOf(token)));
  return (range && !range.staff) ? { min: range.min, max: range.max } : null;
}

/* -------------------------------------------- */

/**
 * The tiles within the reach of a unit's reaction, as it stands: those the weapon in its hand attacks, those it
 * could move to, or those within so many spaces. A unit that would move to attack an enemy that comes near it
 * reaches the tiles that near as well.
 * @param {TokenDocument} token
 * @param {Reacting} react
 * @returns {((tile: Tile) => boolean)|null}      Null for a reaction that reaches nothing right now
 */
export function coversOf(token, react) {
  const here = tileOf(token);
  if ( !here ) return null;
  if ( react.within === "weapon" ) {
    const range = weaponReach(token);
    if ( !range ) return null;
    const near = (react.near && steps(token)) ? react.near : 0;
    return (tile) => withinSpaces(here, tile, range.min, range.max) || ((near > 0) && withinSpaces(here, tile, 1, near));
  }
  if ( react.within === "mov" ) {
    const view = reachOf(token, { fresh: true });
    // Every tile it could walk onto or through, so that an ally who stands in its way stands in its range
    const tiles = new Set([...(view?.reach.cost?.keys() ?? []), ...(view?.reach.stops ?? []), tileKey(here)]);
    return (tile) => tiles.has(tileKey(tile));
  }
  const spaces = Number(react.within) || 0;
  return (spaces > 0) ? ((tile) => withinSpaces(here, tile, 1, spaces)) : null;
}

/**
 * A unit reacts with one attack that is not answered: the attack is made, floats its number over the unit it
 * is made on, and a short card tells what was rolled.
 * @param {TokenDocument} token       The unit that attacks
 * @param {TokenDocument} target      The unit it attacks
 * @param {string} skill              The skill that has it attack
 * @param {object} [options]          What `strikeBeside` is told beside the skill
 * @returns {Promise<object|null>}    What came of it (see `strikeBeside`); null where no attack was made
 */
async function strike(token, target, skill, options = {}) {
  const actor = token.actor;
  if ( !target.object ) return null;
  pop(actor, [{ text: skill, tone: "skill" }]);
  const struck = await strikeBeside(actor, token, target.object, { skill, earns: true, ...options });
  if ( !struck ) return null;
  try {
    const i18n = game.i18n;
    const sure = (struck.hitChance ?? 0) >= 100;
    const told = !struck.hit ? i18n.format("FEO.Area.attack.miss", { hit: struck.hitChance })
      : i18n.format(struck.crit ? "FEO.Area.attack.crit" : sure ? "FEO.Area.attack.sure" : "FEO.Area.attack.hit", { damage: struck.damage, hit: struck.hitChance });
    if ( !struck.hit ) pop(target.actor, [{ text: i18n.localize("FEO.Area.miss"), tone: "skill" }]);
    await postCard(actor, {
      title: i18n.format("FEO.Chat.usesItemOn", { item: skill, target: nameOf(target) }),
      rows: [{ label: nameOf(target), value: struck.kill ? `${told}, ${i18n.localize("FEO.Spread.down")}` : told, cls: struck.hit ? "" : "bad" }]
    }, { rolls: struck.dice?.length ? [rollFromResults(struck.dice)] : [] });
  } catch(err) {
    console.error(err);
  }
  return struck;
}

/* -------------------------------------------- */
/*  Traps                                       */
/* -------------------------------------------- */

/**
 * The traps that lie on a scene: those a skill laid, of every unit that still stands on it, and the mines and
 * traps of the Items tab, which lie there whoever laid them (see `helpers/traps.mjs`). One of those carries
 * what it is as `laid`.
 * @param {Scene|null} scene
 * @returns {(Trap & {token: TokenDocument|null, laid?: import("../rules/traps.mjs").LaidTrap})[]}
 */
export function trapsOn(scene) {
  const traps = [];
  if ( !scene?.grid?.isSquare ) return traps;
  for ( const laid of laidOn(scene) ) {
    traps.push({
      id: laid.id, tile: { i: laid.i, j: laid.j }, by: laid.token, skill: laid.name, who: "any", halts: laid.halts, strike: false,
      laid, token: laid.token ? (scene.tokens.get(laid.token) ?? null) : null
    });
  }
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( (actor?.type !== "unit") || actor.system.defeat?.out ) continue;
    for ( const trap of actor.getFlag(FEO.id, "traps") ?? [] ) {
      if ( (trap?.scene !== scene.id) || !Number.isInteger(trap.i) || !Number.isInteger(trap.j) ) continue;
      traps.push({ ...trap, tile: { i: trap.i, j: trap.j }, by: token.id, token });
    }
  }
  return traps;
}

/* -------------------------------------------- */

/**
 * Does a trap catch a unit, as it walks onto its tile or as it waits on it? One a skill laid catches whom its
 * skill says, however the unit came to stand there; a mine or a trap of the Items tab every unit but the one
 * that laid it, and one that flies only as it waits there.
 * @param {Trap & {token: TokenDocument|null, laid?: object}} trap
 * @param {TokenDocument} mover
 * @param {"walk"|"wait"} [how]
 * @returns {boolean}
 */
function catches(trap, mover, how = "walk") {
  if ( trap.laid ) return springs(trap.laid, trapUnitOf(mover), how);
  if ( !trap.token?.actor ) return false;
  return trapCatches(trap, mover.id, relationOf(armyOf(trap.token.actor, trap.token), armyOf(mover.actor, mover)));
}

/* -------------------------------------------- */

/**
 * The traps this user is shown on a scene: every one for a Game Master, and for a player those of the units
 * they own and of the units that fight on the players' side.
 * @param {Scene|null} scene
 * @returns {{tile: Tile, skill: string}[]}
 */
export function trapsShown(scene) {
  const seen = new Set(laidShown(scene).map((trap) => trap.id));
  return trapsOn(scene).filter(({ token, laid }) => {
    if ( laid ) return seen.has(laid.id);
    return game.user.isGM || token.isOwner || ((FEO.camps[armyOf(token.actor, token)] ?? null) === FEO.camps.player);
  }).map(({ tile, skill, laid }) => ({ tile, skill, kind: laid ? laid.kind : "skill" }));
}

/* -------------------------------------------- */

/**
 * Why a unit cannot lay a trap with a skill right now, if it cannot: the weapon in its hand is not of the kind
 * the trap is laid with, or has too few uses left.
 * @param {TokenDocument} token
 * @param {object} act        The skill's `act` part
 * @returns {string|null}     A localization key; null when it can
 */
export function trapBlocked(token, act) {
  const trap = trapOf(act?.trap);
  if ( !trap?.costs ) return null;
  const weapon = token.actor.system.equippedWeapon;
  if ( !weapon || weapon.system.broken || !weaponIs({ name: weapon.name, category: weapon.system.category }, trap.costs.weapon) ) return "FEO.Trap.noWeapon";
  if ( (weapon.system.uses?.max > 0) && (weapon.system.uses.value < trap.costs.uses) ) return "FEO.Trap.noUses";
  return null;
}

/* -------------------------------------------- */

/**
 * May a trap be laid on a tile: one with no unit on it, and no trap of the same unit already?
 * @param {TokenDocument} token       The unit that lays it
 * @param {Tile} tile
 * @returns {boolean}
 */
export function trapFits(token, tile) {
  const scene = token.parent;
  if ( unitsOn(scene).some((unit) => (unit.tile.i === tile.i) && (unit.tile.j === tile.j)) ) return false;
  return !trapsOn(scene).some((trap) => (trap.by === token.id) && (trap.tile.i === tile.i) && (trap.tile.j === tile.j));
}

/* -------------------------------------------- */

/**
 * A unit lays a trap on a tile with a skill: the weapon in its hand loses the uses the trap costs, and the
 * trap lies there, remembering that weapon, until a unit moves onto it. One more than the unit may have lying
 * takes the place of the oldest.
 * @param {TokenDocument} token
 * @param {Item} item         The skill
 * @param {object} act        Its `act` part
 * @param {Tile} tile
 * @returns {Promise<{label: string, value: string}[]|null>}      Rows for the card of the skill; null where no
 *                                                                trap was laid
 */
export async function layTrapAt(token, item, act, tile) {
  const trap = trapOf(act?.trap);
  const actor = token.actor;
  const scene = token.parent;
  if ( !trap || !scene || trapBlocked(token, act) || !trapFits(token, tile) ) return null;
  const weapon = trap.costs ? actor.system.equippedWeapon : null;
  const rows = [];

  // The weapon as it is now is what the trap strikes with, whatever becomes of it afterwards
  const arm = weapon ? {
    weapon: {
      id: weapon.id, name: weapon.name, category: weapon.system.category, might: weapon.system.might, range: weapon.system.range,
      effect: weapon.system.effect, damageStat: weapon.system.damageStat, wexp: weapon.system.wexp,
      uses: { value: weapon.system.uses.value, max: weapon.system.uses.max }
    },
    bare: { hit: weapon.system.hit, crit: weapon.system.crit, weight: weapon.system.weight, rank: weapon.system.rank }
  } : null;
  if ( weapon && (weapon.system.uses?.max > 0) ) {
    const left = Math.max(weapon.system.uses.value - trap.costs.uses, 0);
    await weapon.update({ "system.uses.value": left });
    rows.push({ label: weapon.name, value: game.i18n.format("FEO.Trap.spent", { uses: trap.costs.uses, left }) });
    if ( left <= 0 ) await breakItem(weapon);
  }
  const all = actor.getFlag(FEO.id, "traps") ?? [];
  const here = all.filter((other) => other?.scene === scene.id).map((other) => ({ ...other, tile: { i: other.i, j: other.j } }));
  const made = {
    id: foundry.utils.randomID(), scene: scene.id, i: tile.i, j: tile.j, tile: { i: tile.i, j: tile.j },
    skill: item.name, who: trap.who, halts: trap.halts, strike: trap.strike, arm
  };
  const { list, dropped } = layTrap(here, made, trap.most);
  const kept = [...all.filter((other) => other?.scene !== scene.id), ...list.map(({ tile: at, ...rest }) => rest)];
  await noteFor(actor, "traps", kept);
  pop(actor, [{ text: item.name, tone: "skill" }]);
  rows.push({ label: item.name, value: game.i18n.format(dropped.length ? "FEO.Trap.moved" : "FEO.Trap.laid", { count: list.length, most: trap.most || list.length }) });
  return rows;
}

/* -------------------------------------------- */

/**
 * A trap is gone: it was sprung, or the battle it was laid in is over.
 * @param {TokenDocument|null} token      The unit that laid it
 * @param {string|null} [id]              The trap; every trap of the unit without one
 * @returns {Promise<void>}
 */
export async function dropTraps(token, id = null) {
  const actor = token?.actor;
  const all = actor?.getFlag?.(FEO.id, "traps") ?? [];
  if ( !all.length ) return;
  const kept = id ? all.filter((trap) => trap?.id !== id) : [];
  await noteFor(actor, "traps", kept.length ? kept : null);
}

/* -------------------------------------------- */
/*  A Move, Step by Step                        */
/* -------------------------------------------- */

/**
 * What comes of a unit's move along its way, as the units stand now: the reactions of the enemies that watch
 * it and the traps it crosses, each at the tile where it comes about, in the order the unit meets them (see
 * `eventsAlong`). A unit its enemies do not see is watched by none of them.
 * @param {TokenDocument} mover           The unit that moves
 * @param {Tile[]} way                    The tiles of the move, from the one it stands on
 * @param {object} [options]
 * @param {(tile: Tile) => boolean} [options.stands]      Could it stop on that tile?
 * @param {string[]} [options.done]       The reactions already dealt with on this move, each as `id|skill`
 * @returns {WayEvent[]}
 */
export function moveEvents(mover, way, { stands = () => true, done = [] } = {}) {
  const scene = mover?.parent;
  if ( !scene?.grid?.isSquare || (mover.actor?.type !== "unit") || !Array.isArray(way) || (way.length < 2) ) return [];
  const me = { army: armyOf(mover.actor, mover) };
  const unseen = unseenBy(mover.actor.system.skills?.rules, "foe");
  const watchers = [];
  for ( const other of unitsOn(scene) ) {
    if ( (other.token === mover) || unseen || (standsTo(me, other) !== "foe") || !canReact(other.actor) ) continue;
    const record = reactedOf(other.actor);
    for ( const react of other.actor.system.reacts ?? [] ) {
      if ( !["move", "enters", "pass"].includes(react.to) || !reactsLeft(react, record, mover.id).ok ) continue;
      if ( react.to === "pass" ) {
        // Only a unit the mover does not see is walked into
        if ( unseenBy(other.actor.system.skills?.rules, "foe") ) watchers.push({ id: other.token.id, tile: other.tile, react });
        continue;
      }
      const covers = coversOf(other.token, react);
      if ( covers ) watchers.push({ id: other.token.id, tile: other.tile, react, covers });
    }
  }
  const traps = trapsOn(scene).filter((trap) => catches(trap, mover, "walk"));
  if ( !watchers.length && !traps.length ) return [];
  return eventsAlong(way, { watchers, traps, stands, done });
}

/* -------------------------------------------- */

/**
 * Something comes of a unit's move where it now stands: a unit reacts to it, or a trap is sprung. Whoever acts
 * for a unit that may react is asked in one click, and a unit that answers by itself reacts.
 * @param {TokenDocument} mover           The unit that moves
 * @param {WayEvent} event
 * @returns {Promise<{halted: boolean, blocked: boolean, gone: boolean}>}
 *          `halted`: its move ends here and stands. `blocked`: the tile it would step onto next is still held,
 *          so that it goes no further this way. `gone`: it no longer stands
 */
export async function reactTo(mover, event) {
  let came = { halted: false, blocked: false };
  try {
    if ( event.kind === "trap" ) came = { ...came, ...(await spring(mover, event.trap)) };
    else if ( event.kind === "enters" ) await rally(mover, event);
    else if ( event.kind === "move" ) came = { ...came, ...(await watch(mover, event)) };
    else if ( event.kind === "pass" ) came = { ...came, ...(await bump(mover, event)) };
  } catch(err) {
    console.error(err);
  }
  const system = mover.actor?.system;
  return { ...came, gone: !system || !!system.defeat?.out || !!system.defeat?.down || !(system.hp?.value > 0) };
}

/* -------------------------------------------- */

/**
 * Offer a unit that may react what it may do, in one click, to whoever acts for it.
 * @param {TokenDocument} token           The unit that may react
 * @param {string} about                  The line above the offers
 * @param {{key: string, skill: string, what: string, amount?: number}[]} offers
 * @param {string} foe                    The unit it reacts to, by name
 * @returns {Promise<string|null>}        The key of the offer taken, or null
 */
async function offer(token, about, offers, foe) {
  const { askFor } = await import("./answers.mjs");
  const point = { index: 0, on: "react", side: "initiator", attack: null, about, offers };
  return askFor({ token, actor: token.actor }, point, foe, { alone: false });
}

/* -------------------------------------------- */

/**
 * A unit that watches for an enemy's move reacts to one: it starts a fight with the enemy where that enemy
 * stands, after moving to where its weapon reaches it if its skill has it so. Whether the enemy's move ends
 * there is the skill's to say.
 * @param {TokenDocument} mover
 * @param {WayEvent} event
 * @returns {Promise<{halted: boolean}>}
 */
async function watch(mover, { id, react }) {
  const token = mover.parent.tokens.get(id);
  const actor = token?.actor;
  if ( !actor || !mover.object || !canReact(actor) ) return { halted: false };
  const record = reactedOf(actor);
  const left = reactsLeft(react, record, mover.id);
  if ( !left.ok ) return { halted: false };
  const here = tileOf(token);
  const there = tileOf(mover);
  const range = weaponReach(token);
  if ( !here || !there || !range ) return { halted: false };

  // From where it stands if its weapon reaches the enemy; else from the tile that takes it the least movement
  let from = null;
  if ( !withinSpaces(here, there, range.min, range.max) ) {
    if ( !react.near || !steps(token) ) return { halted: false };
    const view = reachOf(token, { fresh: true });
    const tiles = [...(view?.reach.stops ?? [])].map(keyTile).filter((tile) => {
      return withinSpaces(tile, there, range.min, range.max) && view.allows(tile, there, tilesApart(tile, there));
    }).sort((a, b) => (view.reach.cost.get(tileKey(a)) ?? 0) - (view.reach.cost.get(tileKey(b)) ?? 0));
    from = tiles[0] ?? null;
    if ( !from ) return { halted: false };
  }
  const lend = react.effects.length ? { initiator: { skill: react.skill, effects: react.effects } } : null;
  const matchup = planAttack(actor, token, mover.object, { from, lend });
  if ( matchup.warning || matchup.makePlan(matchup.distance).initiator.blocked ) return { halted: false };

  // One that may halt an enemy of its choice says so as it reacts
  const { answersAlone } = await import("./answers.mjs");
  const picks = (react.halts === "pick") && left.halt;
  let answer = picks ? "halt" : "fight";
  if ( !answersAlone(actor) && (react.may || picks) ) {
    const offers = [
      ...(picks ? [{ key: "halt", skill: react.skill, what: "reactHalt" }] : []),
      { key: "fight", skill: react.skill, what: (react.halts === "always") ? "reactHalt" : "react" }
    ];
    answer = await offer(token, game.i18n.format("FEO.Stance.about.move", { foe: nameOf(mover) }), offers, nameOf(mover));
    if ( !answer ) return { halted: false };
  }
  if ( from && !(await moveUnits([{ token, tile: from }])) ) return { halted: false };
  await noteFor(actor, "reacted", noteReact(record, react, mover.id, { halted: answer === "halt" }));
  if ( react.id ) await spendFor(actor, react.id);
  pop(actor, [{ text: react.skill, tone: "skill" }]);
  const before = mover.actor.system.hp.value;
  const message = await fightTarget(actor, token, mover.object, { confirm: async (found) => found.distance, lend });
  if ( !message ) return { halted: false };
  const hurt = (mover.actor.system.hp.value < before) || !!mover.actor.system.defeat?.out;
  return { halted: haltsAfter(react, { hurt, picked: answer === "halt" }) };
}

/* -------------------------------------------- */

/**
 * An enemy is about to step onto the tile of a unit it does not see: that unit makes one attack on it that is
 * not answered, or moves out of its way by half its MOV, as whoever acts for it picks. Where it neither moves
 * away nor is brought down, the enemy goes no further this way.
 * @param {TokenDocument} mover
 * @param {WayEvent} event
 * @returns {Promise<{blocked: boolean}>}
 */
async function bump(mover, { id, react }) {
  const token = mover.parent.tokens.get(id);
  const actor = token?.actor;
  if ( !actor || !mover.object || !canReact(actor) ) return { blocked: true };
  const here = tileOf(token);
  const strikes = react.strike && !planAttack(actor, token, mover.object, { extra: { skill: react.skill } }).warning && !!weaponReach(token);
  const half = (react.moves === "half") ? halfMov(movOf(actor)) : 0;
  const view = ((half > 0) && steps(token)) ? reachOf(token, { fresh: true }) : null;
  const tiles = [...(view?.reach.stops ?? [])].map(keyTile).filter((tile) => {
    return (tileKey(tile) !== tileKey(here)) && ((view.reach.cost.get(tileKey(tile)) ?? Infinity) <= half);
  });
  if ( !strikes && !tiles.length ) return { blocked: true };
  const { answersAlone } = await import("./answers.mjs");
  let answer = strikes ? "strike" : "slip";
  if ( !answersAlone(actor) ) {
    const offers = [
      ...(strikes ? [{ key: "strike", skill: react.skill, what: "strike" }] : []),
      ...(tiles.length ? [{ key: "slip", skill: react.skill, what: "slip", amount: half }] : [])
    ];
    answer = await offer(token, game.i18n.format("FEO.Stance.about.pass", { foe: nameOf(mover), name: nameOf(token) }), offers, nameOf(mover));
  }
  if ( answer === "strike" ) {
    await strike(token, mover, react.skill);
    return { blocked: true };
  }
  if ( answer === "slip" ) {
    const { askOwner } = await import("./rescue.mjs");
    const picked = answersAlone(actor) ? { tile: tiles[0] } : await askOwner(token, { skill: react.skill, tiles, hint: "FEO.Stance.hint.slip" });
    if ( picked?.tile && (await moveUnits([{ token, tile: picked.tile }])) ) {
      pop(actor, [{ text: react.skill, tone: "skill" }]);
      return { blocked: false };
    }
  }
  return { blocked: true };
}

/* -------------------------------------------- */

/**
 * An enemy's move takes it into a unit's reach: every ally of that unit which stands in the reach carries the
 * change the reaction rallies them with, against that enemy alone, until the Phase ends.
 * @param {TokenDocument} mover
 * @param {WayEvent} event
 * @returns {Promise<void>}
 */
async function rally(mover, { id, react }) {
  const token = mover.parent.tokens.get(id);
  const actor = token?.actor;
  if ( !actor || !react.rallies || !canReact(actor) ) return;
  const covers = coversOf(token, react);
  const me = { army: armyOf(actor, token) };
  const allies = covers ? unitsOn(token.parent).filter((other) => {
    return (other.token !== token) && !other.down && (standsTo(me, other) === "friend") && covers(other.tile);
  }) : [];
  if ( !allies.length ) return;

  // The enemy carries a mark of the unit's skill, and what the change does is against a unit that carries it
  const mark = `${react.skill} · ${nameOf(token)}`;
  const effects = JSON.parse(JSON.stringify(react.rallies.effects ?? []).replaceAll(JSON.stringify(RALLY_MARK), JSON.stringify(mark)));
  const change = buildChange({ name: react.rallies.name ?? react.skill, effects, ends: "phaseEnd" }, { skill: react.skill, from: nameOf(token), giver: actor.uuid });
  pop(actor, [{ text: react.skill, tone: "skill" }]);
  if ( react.id ) await spendFor(actor, react.id);
  await grantUnit(mover.actor, [buildChange({ name: mark, effects: [], ends: "phaseEnd", mark: true }, { skill: mark, own: true })]);
  for ( const ally of allies ) await grantUnit(ally.actor, [change], { by: actor });
}

/* -------------------------------------------- */

/**
 * A unit moves onto a trap: the trap is gone, the unit that laid it makes one attack on the unit caught with
 * the weapon the trap was laid with, from wherever it stands, and the move ends there. A unit whose skill has
 * it disarm traps takes the trap away instead and walks on (see `disarmerOf` in `rules/stealing.mjs`).
 * @param {TokenDocument} mover
 * @param {Trap & {token: TokenDocument, arm?: object}} trap
 * @param {"walk"|"wait"} [how]       Did the unit walk onto it, or end its turn on it?
 * @returns {Promise<{halted: boolean, gone?: boolean}>}
 */
async function spring(mover, trap, how = "walk") {
  // A mine or a trap of the Items tab does what its item says, which a Game Master sees to
  if ( trap.laid ) {
    const came = await springLaid(mover, trap.laid, how);
    return { halted: !!came.halted, gone: !!came.gone };
  }
  const layer = trap.token ?? mover.parent.tokens.get(trap.by);

  // A unit that disarms the traps it walks over takes this one off its tile, and walks on
  const disarmer = disarmerOf(mover.actor?.system.knacks ?? null);
  if ( disarmer !== null ) {
    await dropTraps(layer, trap.id);
    pop(mover.actor, [{ text: game.i18n.format("FEO.Trap.disarmed", { skill: disarmer, trap: trap.skill }), tone: "skill" }]);
    return { halted: false };
  }
  await dropTraps(layer, trap.id);
  pop(mover.actor, [{ text: trap.skill, tone: "skill" }]);
  if ( trap.strike && layer?.actor && mover.object && canReact(layer.actor) ) {
    // The weapon is the one it was laid with, as it was then; one the unit no longer carries is no Item
    let arm = trap.arm ?? null;
    if ( arm?.weapon?.id && !layer.actor.items.get(arm.weapon.id) ) arm = { ...arm, weapon: { ...arm.weapon, id: null } };
    await strike(layer, mover, trap.skill, { free: true, extra: arm ? { arm } : null });
  }
  return { halted: trap.halts !== false };
}

/* -------------------------------------------- */

/**
 * A unit's turn ends on a tile: a trap that lies there and catches it is sprung, or taken away by a unit
 * whose skill has it disarm traps, as it waits on it. This is how a unit that flies springs one at all.
 * @param {Actor} actor
 * @returns {Promise<number>}     How many traps it sprang or took away
 */
export async function waitOnTraps(actor) {
  if ( (actor?.type !== "unit") || actor.system.defeat?.out ) return 0;
  const mover = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  const here = mover ? tileOf(mover) : null;
  if ( !here || !mover.parent?.grid?.isSquare ) return 0;
  let count = 0;
  for ( const trap of trapsOn(mover.parent) ) {
    if ( (tileKey(trap.tile) !== tileKey(here)) || !catches(trap, mover, "wait") ) continue;
    try {
      await spring(mover, trap, "wait");
      count += 1;
    } catch(err) {
      console.error(err);
    }
    if ( actor.system.defeat?.out || !(actor.system.hp?.value > 0) ) break;
  }
  return count;
}

/* -------------------------------------------- */
/*  Once a Fight Is Over                        */
/* -------------------------------------------- */

/**
 * A fight has ended in which a unit took HP off another: every ally of the unit that was hurt whose skill lets
 * it, with that enemy within its reach, may make one attack on it that is not answered. Whoever acts for such
 * a unit is asked in one click, and a unit that answers by itself strikes.
 * @param {TokenDocument|null} hurt       The unit that lost HP
 * @param {TokenDocument|null} by         The unit that took it off
 * @returns {Promise<void>}
 */
export async function avenge(hurt, by) {
  const scene = hurt?.parent;
  if ( !scene?.grid?.isSquare || (by?.parent !== scene) || !hurt.actor || !by.actor ) return;
  const units = scene.tokens.filter((token) => (token.actor?.type === "unit") && tileOf(token)).map((token) => ({
    id: token.id,
    side: armyOf(token.actor, token),
    tile: tileOf(token),
    out: (token === hurt) ? false : (token === by) ? (!(token.actor.system.hp?.value > 0) || !!token.actor.system.defeat?.out) : !canReact(token.actor),
    reacts: (token.actor.system.reacts ?? []).filter((react) => react.to === "allyHurt"),
    covers: (react, tile) => !!coversOf(token, react)?.(tile)
  }));
  if ( !units.some((unit) => unit.reacts.length) ) return;
  const { answersAlone } = await import("./answers.mjs");
  for ( const { id, react } of avengersOf(units, { hurt: hurt.id, by: by.id }) ) {
    const system = by.actor.system;
    if ( system.defeat?.out || system.defeat?.down || !(system.hp?.value > 0) || !by.object ) break;
    const token = scene.tokens.get(id);
    const actor = token?.actor;
    try {
      if ( !actor || planAttack(actor, token, by.object, { extra: { skill: react.skill } }).warning ) continue;
      if ( !answersAlone(actor) && react.may ) {
        const about = game.i18n.format("FEO.Stance.about.hurt", { foe: nameOf(by), ally: nameOf(hurt) });
        const answer = await offer(token, about, [{ key: "strike", skill: react.skill, what: "strike" }], nameOf(by));
        if ( answer !== "strike" ) continue;
      }
      if ( react.id ) await spendFor(actor, react.id);
      await strike(token, by, react.skill);
    } catch(err) {
      console.error(err);
    }
  }
}

/* -------------------------------------------- */
/*  Walking a Way                               */
/* -------------------------------------------- */

/**
 * @typedef Walked
 * What came of a move that was stepped along its way.
 * @property {number} at          The place in the way where the unit now stands
 * @property {boolean} halted     Did something end its move there? The move then stands
 * @property {boolean} blocked    Did a unit it did not see keep it from going further this way?
 * @property {boolean} failed     Could a step of it not be made?
 * @property {boolean} gone       Does the unit no longer stand?
 */

/**
 * Walk a unit along a way, stopping it wherever something comes of its move (see `moveEvents`): it walks as
 * far as the first tile where an enemy reacts or a trap lies, that is dealt with where it stands, and it walks
 * on unless its move has ended there. A unit whose move was ended cannot move for the rest of its turn; one
 * that no enemy stops on its way walks on whatever was dealt with.
 * @param {TokenDocument} mover           The unit that moves, in its own turn
 * @param {Tile[]} way                    The tiles of the move, from the one it stands on
 * @param {object} [options]
 * @param {(tile: Tile) => boolean} [options.stands]      Could it stop on that tile?
 * @param {object} [options.told]         What the update of each step is told, beside what Foundry is
 * @returns {Promise<Walked>}
 */
export async function walkWay(mover, way, { stands = () => true, told = {} } = {}) {
  const grid = mover.parent.grid;
  const done = [];
  const sprung = new Set();
  const free = !!mover.actor?.system.skills?.rules?.includes("unforced");
  const walked = { at: 0, halted: false, blocked: false, failed: false, gone: false };
  const walk = async (to) => {
    if ( to <= walked.at ) return true;
    const points = way.slice(walked.at + 1, to + 1).map((tile) => ({ ...grid.getTopLeftPoint(tile), snapped: true }));
    const arrived = await mover.move(points, { constrainOptions: { ignoreCost: true }, ...told });
    if ( arrived === false ) return false;
    walked.at = to;
    return true;
  };
  for ( let turn = 0; turn < 200; turn++ ) {
    let events = [];
    try {
      events = moveEvents(mover, way.slice(walked.at), { stands, done }).filter((event) => !(event.trap && sprung.has(event.trap.id)));
    } catch(err) {
      console.error(err);
    }
    const next = events[0];
    if ( !next ) break;
    if ( next.trap ) sprung.add(next.trap.id);
    else done.push(`${next.id}|${next.react.skill}`);

    // What only gives the units around something is dealt with as the unit passes; for everything else it
    // stands on the tile first, and is let arrive there
    if ( next.kind !== "enters" ) {
      if ( !(await walk(walked.at + next.at)) ) {
        walked.failed = true;
        break;
      }
      try {
        await Promise.race([mover.object?.movementAnimationPromise ?? null, new Promise((resolve) => setTimeout(resolve, 3000))]);
      } catch(err) {
        console.error(err);
      }
    }
    const came = await reactTo(mover, next);
    if ( came.gone ) {
      walked.gone = true;
      walked.halted = true;
      break;
    }
    if ( came.halted && !free ) {
      walked.halted = true;
      try {
        const from = next.trap ? nameOf(next.trap.token) : nameOf(mover.parent.tokens.get(next.id));
        const name = game.i18n.format("FEO.Stance.halted", { skill: next.trap?.skill ?? next.react?.skill ?? "" });
        await grantUnit(mover.actor, [buildChange({ name, effects: [{ rules: ["held"] }], ends: "turnEnd" }, { skill: name, from })]);
      } catch(err) {
        console.error(err);
      }
      break;
    }
    if ( came.blocked ) {
      walked.blocked = true;
      break;
    }
  }
  if ( !walked.halted && !walked.blocked && !walked.failed && !(await walk(way.length - 1)) ) walked.failed = true;
  return walked;
}

/* -------------------------------------------- */

/**
 * The tiles a token crosses on a move that was not made by a click on the map, as when it is dragged: from
 * the tile it stands on through each point of the move, a tile at a time along rows and columns.
 * @param {TokenDocument} token
 * @param {{x: number, y: number}[]} points       The points of the move, as Foundry has them
 * @returns {Tile[]}
 */
export function tilesThrough(token, points) {
  const grid = token.parent?.grid;
  const start = tileOf(token);
  if ( !grid?.isSquare || !start ) return [];
  const way = [start];
  for ( const point of points ?? [] ) {
    const goal = grid.getOffset({ x: point.x + (grid.sizeX / 2), y: point.y + (grid.sizeY / 2) });
    let here = way.at(-1);
    for ( let guard = 0; (guard < 500) && ((here.i !== goal.i) || (here.j !== goal.j)); guard++ ) {
      const di = Math.sign(goal.i - here.i);
      const dj = Math.sign(goal.j - here.j);

      // The longer leg first, so that the way keeps close to the line that was drawn
      here = (Math.abs(goal.i - here.i) >= Math.abs(goal.j - here.j)) ? { i: here.i + di, j: here.j } : { i: here.i, j: here.j + dj };
      way.push(here);
    }
  }
  return way;
}

/* -------------------------------------------- */

/**
 * Register what reactions listen for. Called once, when the system starts.
 */
export function registerHooks() {
  // A unit that is dragged in its own turn, as a Game Master who has lifted the limits on movement drags it,
  // is watched like one that is moved by a click: where something would come of the move, the drag is not
  // made, and the unit is walked along the same way instead, a step at a time. A drag begun with Ctrl held
  // only puts the unit somewhere: it is no move, and nothing comes of it
  Hooks.on("preMoveToken", (token, move, options) => {
    try {
      if ( (move.method !== "dragging") && (move.method !== "keyboard") ) return;
      if ( options?.[FEO.id]?.free ) return;
      if ( !game.user.isGM || !game.settings.get("core", "unconstrainedMovement") ) return;
      if ( (token.actor?.type !== "unit") || !token.parent?.grid?.isSquare || !inOwnTurn(token.actor, token) ) return;
      const points = [...(move.passed?.waypoints ?? []), ...(move.pending?.waypoints ?? [])];
      const way = tilesThrough(token, points.length ? points : [move.destination].filter(Boolean));
      if ( way.length < 2 ) return;
      const taken = new Set(unitsOn(token.parent).filter((unit) => unit.token !== token).map((unit) => tileKey(unit.tile)));
      const stands = (tile) => !taken.has(tileKey(tile));
      if ( !moveEvents(token, way, { stands }).length ) return;
      walkWay(token, way, { stands, told: { constrainOptions: { ignoreWalls: true, ignoreCost: true } } }).catch((err) => console.error(err));
      return false;
    } catch(err) {
      console.error(err);
    }
  });
}

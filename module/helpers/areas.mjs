import { FEO } from "../config.mjs";
import { actAmount, actArea, actGrant, actInflicts, userGrant } from "../rules/actions.mjs";
import { WEAPON_RANGE, areaCentre, areaCentres, areaTiles, areaUnits, lineArea, shareWith, sharesCost, sharesTotal } from "../rules/areas.mjs";
import { rangeWith } from "../rules/combat.mjs";
import { blocks } from "../rules/forced.mjs";
import { tileKey } from "../rules/reach.mjs";
import { readNumber, resolveGiven } from "../rules/skills.mjs";
import { canUse } from "../rules/skill-usage.mjs";
import { buildChange } from "../rules/timed.mjs";
import { actFor, actOn, keepOutcome, strikeOf } from "./actions.mjs";
import { forcedField, unitsOn } from "./battle-map.mjs";
import { rollFromResults } from "./chat.mjs";
import { damageUnit, grantUnit, healUnit, pop } from "./events.mjs";
import { cannotTarget, planAttack, strikeBeside, tokenTile } from "./exchange.mjs";
import { moveUnits, onMap, relationTo, steps } from "./forced.mjs";
import { rangesWith, turnMoveOf } from "./movement.mjs";
import { layTrapAt, trapBlocked, trapFits } from "./reactions.mjs";
import { freeAmong, makeAt, makesBlocked } from "./creatures.mjs";
import { adjustGauge } from "./shifting.mjs";
import { losOf, sightField } from "./sight.mjs";
import { changeTone, describeChange } from "./timed-context.mjs";

/**
 * Skills used as an action that take in an area of the map, in Foundry (see `rules/areas.mjs`): which tiles an
 * area covers and which units it catches as the units stand, what the map shows over each of them before the
 * skill is used, and doing its part to each once it is. The Battle HUD paints the area and has it placed; the
 * unit sheet then uses the skill as it uses any other, so that its cooldown, its card and the unit's Action
 * are the same wherever it was used from.
 *
 * @import {Tile} from "../rules/reach.mjs"
 * @import {Shares} from "../rules/areas.mjs"
 */

/**
 * @typedef AreaView
 * An area as it lies on the map.
 * @property {object} act                 What the skill does
 * @property {object} area                Its area
 * @property {"self"|"tile"|"unit"} centred
 * @property {Tile} origin                Where the unit that uses the skill stands
 * @property {Tile[]|null} centres        The tiles it may be centred on, or for a line the tiles next to the
 *                                        unit it may run through; null for an area around the unit itself
 * @property {Tile|null} centre           Where it is placed; null while it is not
 * @property {boolean} placed             Is it placed, so that it can be used?
 * @property {Tile[]|null} tiles          The tiles it covers; null for the whole map
 * @property {TokenDocument[]} units      The units it catches, the nearest first
 * @property {Tile|null} land             For a unit that moves through a line: the tile it lands on
 */

/** The tile a token stands on. */
const tileOf = (token) => {
  const tile = tokenTile(token);
  return tile ? { i: tile.i, j: tile.j } : null;
};

/** Is the unit behind a token still in the fight? */
const standing = (token) => !!token?.actor && !token.actor.system.defeat?.out && (token.actor.system.hp?.value > 0);

/** Do two tiles lie on each other? */
const same = (a, b) => !!a && !!b && (a.i === b.i) && (a.j === b.j);

/**
 * A unit as a number of a skill is read from it.
 * @param {TokenDocument} token
 * @returns {object}
 */
function viewOf(token) {
  const system = token.actor.system;
  return {
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    stats: system.statValues,
    combat: Object.fromEntries(Object.entries(system.combat ?? {}).map(([key, stat]) => [key, stat.value])),
    weapon: system.equippedWeapon ? { name: system.equippedWeapon.name, ...system.equippedWeapon.system } : null
  };
}

/* -------------------------------------------- */

/**
 * The proficiencies a unit has a rank in: E or higher, since F is the rank of one it cannot wield.
 * @param {Actor} actor
 * @returns {string[]}
 */
function ranksOf(actor) {
  const order = Object.keys(FEO.ranks);
  return Object.entries(actor.system.proficiencies ?? {}).filter(([, held]) => order.indexOf(held?.rank) >= order.indexOf("E")).map(([key]) => key);
}

/* -------------------------------------------- */

/**
 * What a unit lacks that another could restore to it by giving up HP of its own: HP, and for a unit with a
 * Shift Gauge the points that gauge is short of full.
 * @param {TokenDocument} token
 * @returns {{hp: number, gauge: number}}
 */
export function lacksOf(token) {
  const system = token.actor.system;
  const gauge = (system.shift?.mode === "gauge") ? Math.max(FEO.shift.gauge.max - (system.shift.value ?? 0), 0) : 0;
  return { hp: Math.max(system.hp.max - system.hp.value, 0), gauge };
}

/* -------------------------------------------- */
/*  Where It Lies                               */
/* -------------------------------------------- */

/**
 * The area a skill takes in, as its unit stands.
 * @param {TokenDocument|null} token
 * @param {Item|null} item
 * @returns {object|null}     Null for a skill that takes in none
 */
export function areaFor(token, item) {
  return actArea(actFor(token, item));
}

/* -------------------------------------------- */

/**
 * An area as it lies on the map: where it may be placed, and once it is, the tiles it covers and the units it
 * catches. An enemy that cannot be made the target of anything is passed over.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @param {Tile|null} [at]            The tile it would be centred on, or for a line the tile next to the unit
 *                                    it would run through; nothing for an area around the unit itself
 * @returns {AreaView|null}           Null for a skill that takes in no area, or a unit that is not on the map
 */
export function areaView(token, item, at = null) {
  const act = actFor(token, item);
  const written = actArea(act);
  if ( !written || !onMap(token) ) return null;

  // An area that is placed as far away as the weapon in hand attacks: that weapon's Range, with what the
  // unit's skills make of it; without a weapon that attacks it is placed nowhere
  let area = written;
  if ( written.range === WEAPON_RANGE ) {
    const held = token.actor.system.equippedWeapon;
    const reach = (held && !held.system.broken && (held.system.category !== "staff"))
      ? rangeWith(held.system.range, token.actor.system.statValues, rangesWith(token.actor, turnMoveOf(token))) : null;
    area = { ...written, range: reach ? { from: Math.max(reach.min, 0), within: Math.max(reach.max, 0) } : { from: 1, within: 0 } };
  }
  const scene = token.parent;
  const origin = tileOf(token);
  const sight = sightField(scene);
  const inside = sight.inside;
  const placedUnits = unitsOn(scene);
  const described = placedUnits.map((unit) => ({
    id: unit.token.id, token: unit.token, tile: unit.tile, relation: relationTo(token, unit.token),
    qualities: unit.actor.system.specialQualities ?? "", ranks: ranksOf(unit.actor)
  })).filter((unit) => (unit.relation === "self") || !cannotTarget(token.actor, token, unit.token.actor, unit.token));
  const centred = areaCentre(area);
  const field = {
    inside, los: losOf(token.actor), sight,
    holds: (tile) => areaUnits(area, [tile], described).length > 0
  };

  // A unit that moves through a line lands past it: only a line with a tile there that it can stand on, and
  // with no wall across it, is one it can take
  const moving = act.through ? forcedField(token, { units: placedUnits }) : null;
  const landing = (through) => {
    const line = lineArea(origin, through, { reach: area.reach ?? 1, holds: field.holds, inside });
    if ( !line.tiles.length || !line.beyond ) return null;
    const way = [origin, ...line.tiles, line.beyond];
    for ( let n = 1; n < way.length; n++ ) if ( moving.wall?.(way[n - 1], way[n]) ) return null;
    return blocks(line.tiles.at(-1), line.beyond, moving) ? null : line.beyond;
  };
  let centres = null;
  if ( centred === "tile" ) centres = areaCentres(area, origin, inside);

  // A trap is laid on a tile with nobody on it, where its unit has none lying yet, and not on a tile nothing
  // crosses
  if ( act.trap && centres ) centres = centres.filter((tile) => !sight.blocked?.(tile) && trapFits(token, tile));

  // A creature appears on a tile nobody stands on, and that something can stand on
  else if ( act.makes && centres ) centres = freeAmong(scene, centres);
  else if ( centred === "unit" ) {
    centres = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([di, dj]) => ({ i: origin.i + di, j: origin.j + dj }))
      .filter((tile) => inside(tile) && field.holds(tile) && (!act.through || (steps(token) && !!landing(tile))));
  }
  const centre = (centred === "self") ? origin : ((at && centres.some((tile) => same(tile, at))) ? { i: at.i, j: at.j } : null);
  const placed = !!centre;
  const tiles = placed ? areaTiles(area, origin, centre, field) : [];
  const units = placed ? areaUnits(area, tiles, described, origin).map((unit) => unit.token) : [];
  const land = (placed && act.through && (centred === "unit")) ? landing(centre) : null;
  return { act, area, centred, origin, centres, centre, placed, tiles, units, land };
}

/* -------------------------------------------- */

/**
 * The units a skill that shares HP out may give something: those its area catches that lack HP, or points of a
 * Shift Gauge.
 * @param {AreaView} view
 * @returns {TokenDocument[]}
 */
export function sharersOf(view) {
  return (view?.units ?? []).filter((unit) => {
    const lacks = lacksOf(unit);
    return (lacks.hp > 0) || (lacks.gauge > 0);
  });
}

/* -------------------------------------------- */

/**
 * Change what a unit is given of the HP another shares out, as a click on it says: all it lacks, or nothing
 * where it had a share; with `step`, so much more or less.
 * @param {TokenDocument} token       The unit that shares out
 * @param {Item} item                 The skill
 * @param {Shares} shares             What is shared out so far
 * @param {TokenDocument} unit        The unit that was clicked
 * @param {object} [options]
 * @param {number|"fill"} [options.step]
 * @param {boolean} [options.gauge]   Is it its Shift Gauge that is restored, where it has one?
 * @returns {Shares}
 */
export function shareTo(token, item, shares, unit, { step = "fill", gauge = false } = {}) {
  const act = actFor(token, item);
  const lacks = lacksOf(unit);
  const kind = ((gauge || !(lacks.hp > 0)) && (lacks.gauge > 0)) ? "gauge" : "hp";
  return shareWith(shares, unit.id, kind, step, { lacks: lacks[kind], hp: token.actor.system.hp.value, gives: act?.shares?.gives ?? 2 });
}

/* -------------------------------------------- */

/**
 * Why a skill that takes in an area cannot be used right now, if it cannot.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {string|{key: string, data?: object}|null}     A localization key, with what it is formatted with
 *                                                        where it says more; null when it can be
 */
export function areaBlocked(token, item) {
  const able = canUse(item.system.usage, item.system.state);
  if ( !able.ok ) return `FEO.Usage.blocked.${able.reason}`;
  const view = areaView(token, item);
  if ( !view ) return "FEO.Act.noTarget";
  const { act } = view;
  if ( act.strike && !strikeOf(token, item) ) return "FEO.Act.noWeapon";
  if ( act.grant?.choose && !actGrant(act.grant, { choice: item.system.choice }) ) return "FEO.Act.noPick";
  if ( act.trap ) {
    const barred = trapBlocked(token, act);
    if ( barred ) return barred;
    return view.centres?.length ? null : "FEO.Trap.noTile";
  }

  // A creature its unit may have no more of, has no tile for or cannot pay for: said with what it is short of
  if ( act.makes ) return makesBlocked(token, act, view.centres?.length ?? 0);
  if ( view.centred !== "self" ) return view.centres.length ? null : "FEO.Area.nobody";
  if ( act.shares ) return sharersOf(view).length ? null : "FEO.Area.nobody";
  return (view.units.length || (act.user && !act.user.each)) ? null : "FEO.Area.nobody";
}

/* -------------------------------------------- */
/*  What the Map Shows                          */
/* -------------------------------------------- */

/** The marks last worked out, so that the map does not plan every attack again as the pointer moves. */
let lastMarks = { key: "", marks: [] };

/**
 * What the map shows over each unit an area catches before the skill is used: the damage and the chance of
 * an attack, the HP a unit would regain or lose, the conditions it would be given, an arrow down or up for a
 * change that lowers or raises its numbers. And over the unit that uses the skill, what it would get itself.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {AreaView} view
 * @param {Shares|null} [shares]      For a skill that shares HP out: what is shared out so far
 * @returns {{tile: Tile, text: string, tone: "bad"|"good"}[]}
 */
export function areaMarks(token, item, view, shares = null) {
  if ( !view?.placed ) return [];
  const key = JSON.stringify([
    item.uuid, view.centre, view.units.map((unit) => [unit.id, unit.actor.system.hp.value]), token.actor.system.hp.value, shares,
    token.actor.system.equippedWeapon?.id ?? ""
  ]);
  if ( lastMarks.key === key ) return lastMarks.marks;
  const marks = [];
  const { act } = view;
  const i18n = game.i18n;
  const mine = viewOf(token);
  const strike = act.strike ? strikeOf(token, item) : null;
  const grant = actGrant(act.grant, { choice: item.system.choice });
  const tone = grant ? changeTone(buildChange({ ...grant, effects: grant.effects ?? [] }, { skill: item.name })) : "";
  for ( const unit of view.units ) {
    const tile = tileOf(unit);
    if ( !tile ) continue;
    const parts = [];
    let good = false;
    try {
      if ( act.shares ) {
        const share = shares?.[unit.id];
        const amount = (share?.hp ?? 0) + (share?.gauge ?? 0);
        const lacks = lacksOf(unit);
        if ( !(lacks.hp > 0) && !(lacks.gauge > 0) ) continue;
        parts.push(share?.gauge ? `+${amount} ${i18n.localize("FEO.Area.gauge")}` : `+${amount}`);
        good = true;
      }
      if ( strike && unit.object ) {
        const matchup = planAttack(token.actor, token, unit.object, { extra: strike });
        if ( !matchup.warning ) {
          const side = matchup.makePlan(matchup.measured ?? matchup.distance).initiator;
          const blow = side.blows?.[0] ?? side;
          // The damage, and under it the chance of an attack that may miss, so that both stay within the tile
          parts.push(((blow.hit ?? 100) >= 100) ? `${blow.damage ?? 0}` : `${blow.damage ?? 0}\n${blow.hit ?? 0}%`);
        }
      }
      const read = (value, theirs) => readNumber(value, theirs ? viewOf(unit) : mine, null);
      if ( act.damage !== undefined ) parts.push(`−${Math.max(actAmount(act.damage, read), 1)}`);
      if ( act.heal !== undefined ) {
        const lost = Math.max(unit.actor.system.hp.max - unit.actor.system.hp.value, 0);
        const amount = Math.min(actAmount(act.heal, read), lost);
        if ( amount > 0 ) {
          parts.push(`+${amount}`);
          good = true;
        }
      }
      for ( const condition of actInflicts(act.inflicts) ) {
        const label = i18n.localize(`FEO.Condition.${condition.id}`);
        parts.push(condition.turns ? `${label} ${condition.turns}` : label);
      }
      if ( grant ) {
        parts.push((tone === "up") ? "▲" : (tone === "down") ? "▼" : "◆");
        if ( tone === "up" ) good = true;
      }
      else if ( act.mark && !parts.length ) parts.push("◆");
    } catch(err) {
      console.error(err);
    }
    if ( parts.length ) marks.push({ tile, text: parts.join(" "), tone: good ? "good" : "bad" });
  }

  // What the unit itself gets: a change so many times over as units were caught, the HP it gives up
  const own = [];
  const more = userGrant(act.user, view.units.length);
  if ( more ) own.push((more.stacks > 1) ? `▲×${more.stacks}` : "▲");
  if ( act.shares && shares && sharesTotal(shares) ) own.push(`−${sharesCost(shares, act.shares.gives)}`);
  if ( own.length && !view.units.includes(token) ) marks.push({ tile: view.origin, text: own.join(" "), tone: act.shares ? "bad" : "good" });
  lastMarks = { key, marks };
  return marks;
}

/* -------------------------------------------- */
/*  Using                                       */
/* -------------------------------------------- */

/**
 * A skill does its part to every unit its area catches, placed where it was clicked: each gets what the skill
 * says through the one way damage, healing, conditions and lasting changes come to a unit, so that each shows
 * its own number, and an attack on each is rolled by itself. What came of it is kept for the unit sheet, which
 * uses the skill next and puts one row for each unit on its card.
 * @param {TokenDocument} token       The unit that uses the skill
 * @param {Item} item                 The skill
 * @param {Tile|null} [at]            Where its area was placed; nothing for one around the unit itself
 * @param {object} [options]
 * @param {Shares|null} [options.shares]      For a skill that shares HP out: what each unit is given
 * @param {boolean} [options.again]   Is it done once more as its unit's turn starts, without being used?
 * @param {object|null} [options.picks]   For a skill that makes a creature: what was picked for it beforehand
 * @returns {Promise<boolean>}        Whether the skill did its part; false leaves it unused
 */
export async function useArea(token, item, at = null, { shares = null, again = false, picks = null } = {}) {
  const view = areaView(token, item, at);
  if ( !view?.placed ) return false;
  const { act, units } = view;
  const actor = token.actor;
  const i18n = game.i18n;
  const mine = token.name || actor.name;
  const outcome = { rows: [], rolls: [], outcome: null, holds: false };

  // A trap is laid on the tile that was picked, whoever stands around it
  if ( act.trap ) {
    const rows = await layTrapAt(token, item, act, view.centre);
    if ( !rows ) return false;
    outcome.rows.push(...rows);
    keepOutcome(item, outcome);
    return true;
  }

  // A creature appears on the tile that was picked
  if ( act.makes ) {
    const made = await makeAt(token, item, act, view.centre, picks);
    if ( !made ) return false;
    outcome.rows.push(...made.rows);
    outcome.rolls.push(...made.rolls);
    keepOutcome(item, outcome);
    return true;
  }
  if ( !units.length && !(act.user && !act.user.each) ) return false;

  // HP its unit gives up, restored so many times over among the units it was shared out to
  if ( act.shares ) {
    const cost = sharesCost(shares, act.shares.gives);
    const given = units.filter((unit) => (shares?.[unit.id]?.hp > 0) || (shares?.[unit.id]?.gauge > 0));
    if ( !(cost > 0) || !given.length || (cost >= actor.system.hp.value) ) return false;
    pop(actor, [{ text: item.name, tone: "skill" }]);
    const paid = await damageUnit(actor, cost, { kind: "skill", nonlethal: true, token });
    outcome.rows.push({ label: mine, value: i18n.format("FEO.Act.harmed", { amount: paid?.dealt ?? cost }) });
    for ( const unit of given ) {
      const share = shares[unit.id];
      const told = [];
      if ( share.hp > 0 ) {
        const healed = await healUnit(unit.actor, share.hp, { by: actor, byToken: token, token: unit });
        if ( healed?.healed > 0 ) told.push(i18n.format("FEO.Act.healed", { amount: healed.healed }));
      }
      if ( share.gauge > 0 ) {
        await adjustGauge(unit.actor, share.gauge);
        told.push(i18n.format("FEO.Area.gaugeUp", { amount: share.gauge }));
        pop(unit.actor, [{ text: i18n.format("FEO.Area.gaugeUp", { amount: share.gauge }), tone: "skill" }]);
      }
      if ( told.length ) outcome.rows.push({ label: unit.name || unit.actor.name, value: told.join(" · ") });
    }
    keepOutcome(item, outcome);
    return true;
  }

  // One attack on each, rolled by itself: the first costs the weapon a use and earns as an attack does
  if ( act.strike ) {
    const extra = strikeOf(token, item);
    if ( !extra ) return false;
    pop(actor, [{ text: item.name, tone: "skill" }]);
    const dice = [];
    const struckUnits = [];
    let made = 0;
    for ( const unit of units ) {
      if ( !unit.object || !standing(unit) || !(actor.system.hp.value > 0) ) continue;
      const struck = await strikeBeside(actor, token, unit.object, {
        skill: item.name, share: extra.share ?? 1, free: !!extra.free || (made > 0), extra, earns: made === 0
      });
      if ( !struck ) continue;
      made++;
      struckUnits.push(unit);
      dice.push(...struck.dice);
      const sure = (struck.hitChance ?? 0) >= 100;
      const told = !struck.hit ? i18n.format("FEO.Area.attack.miss", { hit: struck.hitChance })
        : i18n.format(struck.crit ? "FEO.Area.attack.crit" : sure ? "FEO.Area.attack.sure" : "FEO.Area.attack.hit", { damage: struck.damage, hit: struck.hitChance });
      outcome.rows.push({
        label: unit.name || unit.actor.name,
        value: struck.kill ? `${told}, ${i18n.localize("FEO.Spread.down")}` : told,
        cls: struck.hit ? "" : "bad"
      });
      if ( !struck.hit ) pop(unit.actor, [{ text: i18n.localize("FEO.Area.miss"), tone: "skill" }]);
      else if ( struck.crit ) pop(unit.actor, [{ text: i18n.localize("FEO.Area.crit"), tone: "skill" }]);
    }
    if ( !made ) return false;
    if ( dice.length ) outcome.rolls.push(rollFromResults(dice));

    // And what it leaves on each unit it attacked, hit or missed, once the attacks are made
    if ( act.grant ) {
      const left = { grant: resolveGiven(act.grant, () => viewOf(token)) };
      for ( const unit of struckUnits ) {
        if ( standing(unit) ) await actOn(token, item, left, unit, outcome);
      }
    }
  }

  // Or what it says of one unit, done to each: numbers that are read from its own unit are worked out first
  else if ( units.length ) {
    const { area, user, through, again: more, ...one } = act;
    const each = one.grant ? { ...one, grant: resolveGiven(one.grant, () => viewOf(token)) } : one;
    for ( const unit of units ) {
      if ( !standing(unit) ) continue;
      await actOn(token, item, each, unit, outcome);
    }
  }

  // What its own unit carries for it: so many times over as units were caught, where the skill says so
  const grant = userGrant(act.user, units.length);
  if ( grant && standing(token) ) {
    const change = buildChange({ ...resolveGiven(grant, () => viewOf(token)), name: grant.name ?? item.name }, { skill: item.name, own: true, carrierInTurn: true });
    const given = await grantUnit(actor, [change]);
    for ( const kept of given ?? [] ) {
      const { what, lasts } = describeChange(kept, i18n);
      outcome.rows.push({ label: mine, value: [what, lasts].filter(Boolean).join(", ") });
    }
  }

  // It moves through the units it struck and onto the first tile past them
  if ( act.through && view.land && standing(token) ) await moveUnits([{ token, tile: view.land }]);

  // And it may do its part once more as its unit's next turn starts: a mark on the unit says so until then
  if ( act.again && !again ) {
    const mark = buildChange({ name: againName(item.name), effects: [], mark: true, ends: "turnStart", turns: 1 }, { skill: item.name, own: true });
    await grantUnit(actor, [mark]);
  }
  keepOutcome(item, outcome);
  return true;
}

/* -------------------------------------------- */
/*  Once More                                   */
/* -------------------------------------------- */

/**
 * What the mark is called that a unit carries while one of its skills may do its part once more as its next
 * turn starts.
 * @param {string} skill
 * @returns {string}
 */
export function againName(skill) {
  return `${skill} · again`;
}

/* -------------------------------------------- */

/**
 * The skills of a unit that may do their part once more as its turn starts: those it carries the mark of.
 * Read before what lasted until this turn is over, since the mark is among that.
 * @param {Actor|null} actor
 * @returns {string[]}    What the marks are called
 */
export function againOffers(actor) {
  return (actor?.system?.timed ?? []).filter((change) => change.mark && !change.from && change.name.endsWith(" · again")).map((change) => change.name);
}

/* -------------------------------------------- */

/**
 * A unit's turn starts: a skill that may do its part once more (see `again` in `rules/actions.mjs`) is offered
 * to whoever acts for the unit, above its dock. Taken, its unit pays what the skill says, which may bring it
 * down, the skill does its part again without being used, and the unit carries what the skill says for that
 * turn. A unit that answers by itself lets it pass. Asked once what lasted until this turn has ended.
 * @param {Actor} actor
 * @param {string[]} offers       The marks it carried as the turn started (see `againOffers`)
 * @returns {Promise<{skill: string, paid: number}[]>}    What was taken
 */
export async function offerAgain(actor, offers) {
  const taken = [];
  if ( (actor?.type !== "unit") || !actor.isOwner || actor.system.defeat?.state || !(actor.system.hp?.value > 0) ) return taken;
  const marks = (offers ?? []).map((name) => ({ name }));
  if ( !marks.length ) return taken;
  const { tokenInView } = await import("./positions.mjs");
  const token = actor.token ?? tokenInView(actor);
  if ( !token || !onMap(token) ) return taken;
  const { answersAlone } = await import("./answers.mjs");
  const i18n = game.i18n;
  for ( const mark of marks ) {
    const item = actor.items.find((entry) => (entry.type === "skill") && entry.system.equipped && (againName(entry.name) === mark.name));
    const act = item ? actFor(token, item) : null;
    if ( !act?.again || !actArea(act) || answersAlone(actor) ) continue;
    const cost = Math.max(actAmount(act.again.pays, (value) => readNumber(value, viewOf(token), null)), 1);
    let picked = null;
    try {
      picked = await game.feo.hud?.choose?.({
        token,
        skill: item.name,
        hint: i18n.localize("FEO.Area.again.hint"),
        options: [
          { id: "again", label: i18n.format("FEO.Area.again.yes", { amount: cost }), hint: i18n.localize("FEO.Area.again.yesHint") },
          { id: "no", label: i18n.localize("FEO.Area.again.no") }
        ]
      });
    } catch(err) {
      console.error(err);
    }
    if ( picked !== "again" ) continue;
    pop(actor, [{ text: item.name, tone: "skill" }]);
    const paid = await damageUnit(actor, cost, { kind: "skill", token });
    const rows = [{ label: token.name || actor.name, value: i18n.format("FEO.Act.harmed", { amount: paid?.dealt ?? cost }) }];
    if ( standing(token) ) {
      if ( await useArea(token, item, null, { again: true }) ) {
        const { takeOutcome } = await import("./actions.mjs");
        rows.push(...(takeOutcome(item)?.rows ?? []));
      }
      const changes = [buildChange({ name: againName(item.name), effects: [], mark: true, ends: "turnStart", turns: 1 }, { skill: item.name, own: true })];
      if ( act.again.grant ) changes.push(buildChange({ ...act.again.grant, name: act.again.grant.name ?? i18n.format("FEO.Area.again.name", { skill: item.name }) }, { skill: item.name, own: true, carrierInTurn: true }));
      await grantUnit(actor, changes);
    }
    const { postCard } = await import("./chat.mjs");
    await postCard(actor, { title: i18n.format("FEO.Area.again.title", { skill: item.name }), subtitle: item.system.effect, rows });
    taken.push({ skill: item.name, paid: paid?.dealt ?? cost });
  }
  return taken;
}

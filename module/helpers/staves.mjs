import { FEO } from "../config.mjs";
import { refuses } from "../rules/forced.mjs";
import { isSpent } from "../rules/objects.mjs";
import { relationOf } from "../rules/positions.mjs";
import { tileKey, tilesApart } from "../rules/reach.mjs";
import {
  castStaff, offensiveStaffChance, staffBends, staffCatches, staffChances, staffDamageTo, staffDice, staffHalving, staffPlan, staffReach,
  staffReaches, staffRepair, staffTakes
} from "../rules/staves.mjs";
import { moveCost } from "../rules/terrain.mjs";
import { buildChange } from "../rules/timed.mjs";
import { rollD100, rollFromResults } from "./chat.mjs";
import { afflictUnit, againUnit, cureUnit, damageUnit, grantUnit, healUnit, mendFor, pop, restUnit } from "./events.mjs";
import { armyOf, cannotTarget, measureDistance, tokenTile } from "./exchange.mjs";
import { objectsOn } from "./map-objects.mjs";
import { standingOf, tokenInView } from "./positions.mjs";
import { reachText, staffRows } from "./staff-context.mjs";
import { describeChange } from "./timed-context.mjs";
import { grantTimed } from "./timed.mjs";

/**
 * Staves in Foundry. A staff does what its Effect says to the unit it is used on, or to every unit it is for:
 * it restores HP at once or over the turns that follow, cures, leaves a change that lasts, and against an
 * enemy it hits inflicts its condition, deals its damage or does whatever else it does. All of it goes the
 * way of every other healing, damage, condition and lasting change (see `events.mjs`), so that the skills of
 * the units have their say. On a battle map a staff is used on the units it reaches and may be used on, and on
 * no other. Where the world plays with the Additional Staff Effects, the dice they need are rolled here.
 *
 * @import {StaffCast, StaffMark, StaffPlan, StaffUnit} from "../rules/staves.mjs"
 */

/**
 * Describe a unit as it is now for the staff rules: its numbers, the skills it has equipped, the lasting
 * changes it carries and the auras it receives from the units around it, and what it has around it.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    Its token, if it has one on a map
 * @returns {StaffUnit}
 */
export function staffUnitOf(actor, token = null) {
  const system = actor.system;
  const place = standingOf(token);
  return {
    name: token?.name || actor.name,
    uuid: actor.uuid ?? "",
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    tier: system.classTier,
    stats: system.statValues,
    conditions: system.conditions ?? {},
    qualities: system.specialQualities ?? "",
    skills: [...(system.skills?.entries ?? []), ...(system.skills?.timed ?? []), ...(place?.auras ?? [])],
    near: place?.near ?? null,

    // For the skills that roll to take effect as a staff is used
    activation: system.skills?.activation ?? 0,
    always: !!system.skills?.rules?.includes("alwaysActivate")
  };
}

/* -------------------------------------------- */

/**
 * A unit as the conditions of its skills see it when it has a staff in hand.
 * @param {StaffUnit} unit
 * @param {Item|null} [item]      The staff
 * @returns {object}
 */
function viewOf(unit, item = null) {
  return {
    hp: unit.hp, hpMax: unit.hpMax, level: unit.level, tier: unit.tier, stats: unit.stats, conditions: unit.conditions, near: unit.near,
    weapon: item ? { name: item.name, category: "staff" } : null
  };
}

/* -------------------------------------------- */

/**
 * What a unit heals an ally for with something that restores a fixed amount, such as an item: the amount
 * with the share its skills add to what it heals allies for, rounded down.
 * @param {Actor} actor
 * @param {number} amount
 * @returns {number}
 */
export function healsMore(actor, amount) {
  const unit = staffUnitOf(actor, actor.token ?? tokenInView(actor));
  const { more } = staffBends(unit.skills, unit);
  return more ? Math.floor(((amount * (100 + more)) / 100) + 1e-9) : amount;
}

/* -------------------------------------------- */
/*  What a Staff Does, and Whom It Reaches      */
/* -------------------------------------------- */

/**
 * A staff as the rules read it.
 * @param {Item} item
 * @returns {{name: string, sheetName: string, effect: string, range: string|number, hit: number}}
 */
export function staffOf(item) {
  return {
    name: item.name,
    sheetName: item.flags?.[FEO.id]?.sheetName ?? item.name,
    effect: item.system.effect,
    range: item.system.range,
    hit: item.system.hit
  };
}

/* -------------------------------------------- */

/**
 * What a staff does in the hands of a unit.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {StaffPlan}
 */
export function staffPlanOf(actor, item) {
  return staffPlan(staffOf(item), actor.system.statValues);
}

/* -------------------------------------------- */

/**
 * How far a staff reaches in the hands of a unit, as its skills make it.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @param {Item} item
 * @returns {{min: number, max: number, changed: boolean}|null}   Null if its Range sets no limit
 */
export function staffReachOf(actor, token, item) {
  const unit = staffUnitOf(actor, token);
  return staffReach(item.system.range, unit.stats, staffBends(unit.skills, viewOf(unit, item)).ranges);
}

/* -------------------------------------------- */

/**
 * Does a unit stand on a battle map, where a staff reaches so many tiles?
 * @param {TokenDocument|null} token
 * @returns {boolean}
 */
function onGrid(token) {
  return !!token?.parent?.grid?.isSquare && !!tokenTile(token);
}

/* -------------------------------------------- */

/**
 * A unit as a staff finds it on the map.
 * @param {TokenDocument} user      The token of the unit that uses the staff
 * @param {TokenDocument} other
 * @param {StaffPlan} plan
 * @returns {StaffMark}
 */
function markOf(user, other, plan) {
  const target = other.actor;
  const self = other === user;
  const relation = self ? "ally" : (relationOf(armyOf(user.actor, user), armyOf(target, other)) ?? "other");
  const unit = staffUnitOf(target, other);
  return {
    id: other.id,
    self,
    relation,
    distance: self ? 0 : (measureDistance(user, other) ?? tilesApart(tokenTile(user), tokenTile(other))),
    out: !!target.system.defeat?.out,
    untargetable: !self && cannotTarget(user.actor, user, target, other),
    unforced: !!plan.warp && !self && refuses(target.system.skills?.rules, (relation === "ally") ? "friend" : "foe"),
    immune: staffBends(unit.skills, viewOf(unit)).immune,
    qualities: target.system.specialQualities ?? ""
  };
}

/* -------------------------------------------- */

/**
 * The units of a scene a staff could be asked to do something to: those that are units, and that this user
 * sees.
 * @param {TokenDocument} token
 * @returns {TokenDocument[]}
 */
function unitsAround(token) {
  return (token.parent?.tokens ?? []).filter((other) => {
    return (other.actor?.type === "unit") && !!tokenTile(other) && (!other.hidden || game.user.isGM);
  });
}

/* -------------------------------------------- */

/**
 * May a staff be used on a unit, from where its user stands? Off a battle map nothing keeps it from that.
 * @param {TokenDocument|null} token      The token of the unit that uses the staff
 * @param {Item} item                     The staff
 * @param {TokenDocument|null} target     The token it would be used on; the user's own for itself
 * @returns {{ok: boolean, why: string|null, plan: StaffPlan, reach: object|null}}
 */
export function staffTakesOf(token, item, target) {
  const actor = token?.actor ?? item.parent;
  const plan = staffPlanOf(actor, item);
  if ( !onGrid(token) || !target?.actor || (target.parent !== token.parent) || !tokenTile(target) ) return { ok: true, why: null, plan, reach: null };
  const reach = staffReachOf(actor, token, item);
  const selfStaff = !!actor.system.skills?.rules?.includes("selfStaff");
  return { ...staffTakes(plan, markOf(token, target, plan), { reach, selfStaff }), plan, reach };
}

/* -------------------------------------------- */

/**
 * Why a staff cannot be used on a unit, in words.
 * @param {TokenDocument|null} token      The token of the unit that would use it
 * @param {Item} item
 * @param {TokenDocument|null} target
 * @param {string} why                    As `staffTakes` names it
 * @param {object|null} [reach]           How far the staff reaches
 * @returns {string}
 */
export function staffWhy(token, item, target, why, reach = null) {
  const range = !reach ? "" : (Math.max(reach.min, 1) === reach.max) ? String(reach.max) : `${Math.max(reach.min, 1)}-${reach.max}`;
  return game.i18n.format(`FEO.Staff.why.${why}`, {
    staff: item.name,
    user: token?.name || token?.actor?.name || item.parent?.name || "",
    name: target?.name || target?.actor?.name || "",
    range
  });
}

/* -------------------------------------------- */

/**
 * The units a staff for one unit may be used on from where its user stands.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {TokenDocument[]}
 */
export function staffTargetsOf(token, item) {
  if ( !onGrid(token) ) return [];
  const plan = staffPlanOf(token.actor, item);
  if ( plan.on !== "unit" ) return [];
  const reach = staffReachOf(token.actor, token, item);
  const selfStaff = !!token.actor.system.skills?.rules?.includes("selfStaff");
  return unitsAround(token).filter((other) => staffTakes(plan, markOf(token, other, plan), { reach, selfStaff }).ok);
}

/* -------------------------------------------- */

/**
 * The tiles a staff reaches from where its user stands. One whose Range sets no limit has none to show: it
 * reaches the whole map.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {StaffPlan} [plan]
 * @returns {string[]}      The tiles, by name
 */
export function staffTilesOf(token, item, plan = staffPlanOf(token.actor, item)) {
  const scene = token?.parent;
  const here = tokenTile(token);
  if ( !onGrid(token) || !here || (plan.on === "nobody") || (plan.on === "fallen") ) return [];
  const reach = (plan.span === "adjacent") || (plan.warp?.from === "adjacent") ? { min: 1, max: 1 } : staffReachOf(token.actor, token, item);
  if ( !reach ) return [];
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  const tiles = [];
  for ( let i = Math.max(here.i - reach.max, i0); i <= Math.min(here.i + reach.max, i1 - 1); i++ ) {
    for ( let j = Math.max(here.j - reach.max, j0); j <= Math.min(here.j + reach.max, j1 - 1); j++ ) {
      if ( staffReaches(reach, tilesApart(here, { i, j })) ) tiles.push(tileKey({ i, j }));
    }
  }
  return tiles;
}

/* -------------------------------------------- */

/**
 * What a staff for several units catches from where its user stands: every ally it reaches, with its user
 * where a skill has its staves for several target it too, or every enemy it reaches that it does anything to.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {{plan: StaffPlan, reach: object|null, units: TokenDocument[], tiles: string[]}|null}
 *          Null for a staff that is not for several units, or a unit that stands on no battle map
 */
export function staffAreaOf(token, item) {
  if ( !onGrid(token) ) return null;
  const plan = staffPlanOf(token.actor, item);
  if ( !["allies", "enemies"].includes(plan.on) ) return null;
  const reach = staffReachOf(token.actor, token, item);
  const selfStaff = !!token.actor.system.skills?.rules?.includes("selfStaff");
  const around = unitsAround(token);
  const marks = around.map((other) => markOf(token, other, plan));
  const caught = new Set(staffCatches(plan, marks, { reach, selfStaff }).map((mark) => mark.id));
  return { plan, reach, units: around.filter((other) => caught.has(other.id)), tiles: staffTilesOf(token, item, plan) };
}

/* -------------------------------------------- */

/**
 * The doors and chests a staff that opens them reaches from where its user stands.
 * @param {TokenDocument} token
 * @param {Item} item
 * @returns {{i: number, j: number, id: string, kind: string}[]}
 */
export function staffObjectsOf(token, item) {
  const plan = staffPlanOf(token.actor, item);
  const here = tokenTile(token);
  if ( !onGrid(token) || !plan.unlocks || !here ) return [];
  const reach = staffReachOf(token.actor, token, item);
  return objectsOn(token.parent).filter((object) => {
    if ( !plan.unlocks.includes(object?.kind) || isSpent(object) ) return false;
    return staffReaches(reach, tilesApart(here, { i: object.i, j: object.j }));
  }).map((object) => ({ i: object.i, j: object.j, id: object.id, kind: object.kind }));
}

/* -------------------------------------------- */

/** The marks last worked out, so that they are not worked out again as the pointer moves. */
let lastMarks = { key: "", marks: [] };

/**
 * What the map shows over each unit a staff would be used on before it is: the HP it would regain, the damage
 * it would take and the chance of an Offensive Staff to hit it, or a tick for a staff that does something else.
 * @param {TokenDocument} token
 * @param {Item} item
 * @param {TokenDocument[]} units     The units it may be used on, or those a staff for several catches
 * @returns {{tile: {i: number, j: number}, text: string, tone: "good"|"bad"}[]}
 */
export function staffMarksOf(token, item, units) {
  const actor = token.actor;
  const key = JSON.stringify([item.uuid, token.id, tokenTile(token), actor.system.hp.value,
    units.map((unit) => [unit.id, unit.actor.system.hp.value, unit.actor.system.hp.max, tokenTile(unit)?.i, tokenTile(unit)?.j])]);
  if ( lastMarks.key === key ) return lastMarks.marks;
  const marks = [];
  try {
    const plan = staffPlanOf(actor, item);
    const caster = staffUnitOf(actor, token);
    const staff = staffOf(item);
    const staffHit = actor.system.combatWith(item.system).staffHit.value;
    const describe = (other) => ({ ...staffUnitOf(other.actor, other), id: other.id, distance: measureDistance(token, other) ?? 0 });
    const several = (plan.on === "allies")
      ? castStaff({ staff, caster, patients: units.map((other) => ({ ...describe(other), ally: other !== token, self: other === token })) })
      : null;
    for ( const other of units ) {
      const there = tokenTile(other);
      if ( !there ) continue;
      const parts = [];
      const foe = (other !== token) && (relationOf(armyOf(actor, token), armyOf(other.actor, other)) === "enemy");
      if ( foe ) {
        if ( plan.damage ) parts.push(`−${staffDamageTo(plan, other.actor.system.statValues)}`);
        const avoid = other.actor.system.combat?.staffAvoid?.value ?? 0;
        parts.push(`${offensiveStaffChance(staffHit, avoid, measureDistance(token, other) ?? 0)}%`);
      }
      else if ( several ) {
        const part = several.units?.find((entry) => entry.id === other.id);
        parts.push(part ? `+${part.restored}` : several.mend ? `+${(other === token) ? several.mend.own : several.mend.amount}` : "✓");
      }
      else {
        const one = castStaff({
          staff, caster,
          target: (other === token) ? null : { ...describe(other), ally: true },
          distance: (other === token) ? null : measureDistance(token, other)
        });
        parts.push(one.heal ? `+${one.heal.restored}` : one.mend ? `+${(other === token) ? one.mend.own : one.mend.amount}` : "✓");
      }
      marks.push({ tile: { i: there.i, j: there.j }, text: parts.join("\n"), tone: foe ? "bad" : "good" });
    }
  } catch(err) {
    console.error(err);
  }
  lastMarks = { key, marks };
  return marks;
}

/* -------------------------------------------- */
/*  Using a Staff                               */
/* -------------------------------------------- */

/**
 * Ask whoever acts for a unit to pick one of a few things on the map, where the map can ask: the first is
 * taken where it cannot, or where nobody answers.
 * @param {TokenDocument|null} token
 * @param {string} skill
 * @param {{id: string, label: string, hint?: string}[]} options
 * @returns {Promise<string|null>}    The id picked; null with nothing to pick from
 */
async function pickOne(token, skill, options) {
  if ( !options.length ) return null;
  if ( (options.length === 1) || !token?.isOwner ) return options[0].id;
  let picked = null;
  try {
    picked = await game.feo?.hud?.choose?.({ token, skill, options });
  } catch(err) {
    console.error(err);
  }
  return options.some((option) => option.id === picked) ? picked : options[0].id;
}

/* -------------------------------------------- */

/**
 * A staff does its part to one unit: what it restores over the turns that follow, what it cures and clears,
 * the change it leaves, the conditions it inflicts, the damage it deals and whatever else it does. What cannot
 * be saved is said to be applied by hand.
 * @param {object} use                    The staff as it is used: who uses it, the staff, what it does and what
 *                                        using it came to, with the rows of its card
 * @param {Actor} unit                    The unit it does its part to
 * @param {TokenDocument|null} unitToken
 * @returns {Promise<void>}
 */
async function serve(use, unit, unitToken) {
  const { actor, token, item, plan, cast, rows } = use;
  const i18n = game.i18n;
  const self = unit === actor;
  const name = unitToken?.name || unit.name;
  const say = (key, data = {}, cls = "") => rows.push({ label: name, value: i18n.format(`FEO.Staff.${key}`, { name, ...data }), cls });
  const from = token?.name || actor.name;
  const give = (change) => (self ? grantTimed(actor, [change]) : grantUnit(unit, [change], { by: actor }));
  if ( unit.system.defeat?.state && !plan.revives ) return void say("byHand", {}, "bad");

  // HP as each of its next turns starts
  if ( cast.mend ) {
    const amount = self ? cast.mend.own : cast.mend.amount;
    const given = await give(buildChange({ name: item.name, effects: [], mend: amount, ends: "turnStart", turns: cast.mend.turns }, {
      skill: item.name, from, giver: actor.uuid, own: self
    }));
    say(given?.length ? "mended" : "byHand", { amount, turns: cast.mend.turns }, given?.length ? "good" : "bad");
  }

  // Conditions cured, and what its enemies left on it that lowers its numbers taken off
  if ( plan.cure ) {
    const cured = Object.keys(unit.system.conditions ?? {}).length ? await cureUnit(unit, "all") : [];
    if ( cured === null ) say("byHand", {}, "bad");
    else if ( cured.length ) say("cured", { conditions: cured.map((id) => i18n.localize(`FEO.Condition.${id}`)).join(", ") }, "good");
  }
  if ( plan.clears ) {
    const lowers = (change) => !!change.from && (change.effects ?? []).some((effect) => {
      return Object.values(effect.stats ?? {}).some((value) => value < 0) || Object.values(effect.combat ?? {}).some((value) => value < 0)
        || Object.values(effect.statTimes ?? {}).some((value) => value < 1);
    });
    const cleared = [];
    for ( const change of (unit.system.timed ?? []).filter(lowers) ) {
      const gone = await grantUnit(unit, [buildChange({ name: change.name, drop: "all" }, { skill: change.name, from: change.from })]);
      if ( gone ) cleared.push(change.name);
    }
    if ( cleared.length ) say("cleared", { changes: [...new Set(cleared)].join(", ") }, "good");
  }

  // The change it leaves on the unit
  if ( plan.change ) {
    const change = buildChange(plan.change, { skill: item.name, from, giver: actor.uuid, own: self, giverInTurn: true, carrierInTurn: self });
    const given = await give(change);
    if ( given === null ) say("byHand", {}, "bad");
    else if ( !given.length ) say("refused", {}, "muted");
    else {
      const { what, lasts } = describeChange(given[0], i18n);
      say("given", { what, lasts });
      pop(unit, [{ text: item.name, tone: "skill" }]);
    }
  }

  // Conditions, which what guards the unit may nullify
  for ( const id of plan.inflicts ) {
    const condition = i18n.localize(`FEO.Condition.${id}`);
    const told = await afflictUnit(unit, id, { by: actor, byToken: token, token: unitToken });
    if ( !told ) say("byHand", {}, "bad");
    else if ( told.success === false ) say("warded", { condition, skill: told.warded?.at(-1)?.skill ?? "" }, "muted");
    else say("afflicted", { condition });
  }

  // Damage, less its RES: an attack made with the staff. What the staff has its user regain of it, and what
  // the enemies beside its target take of it
  if ( plan.damage ) {
    const amount = staffDamageTo(plan, unit.system.statValues);
    const hurt = (amount > 0) ? await damageUnit(unit, amount, {
      kind: "attack", by: actor, byToken: token, token: unitToken, weapon: { name: item.name, ...item.system }, resist: "res"
    }) : { dealt: 0 };
    if ( !hurt ) say("byHand", {}, "bad");
    else {
      const dealt = Math.max(hurt.dealt ?? 0, 0);
      say("damaged", { amount: dealt }, dealt ? "" : "muted");
      const back = Math.floor(((dealt * plan.drain) / 100) + 1e-9);
      if ( back > 0 ) {
        const healed = await healUnit(actor, back, { down: true });
        rows.push({ label: i18n.localize("FEO.Chat.restored"), value: i18n.format("FEO.Staff.healed", { name: from, amount: healed?.healed ?? 0 }), cls: "good" });
      }
      const share = plan.splash ? Math.floor(((dealt * plan.splash.percent) / 100) + 1e-9) : 0;
      if ( (share > 0) && unitToken && onGrid(unitToken) ) {
        for ( const other of unitsAround(unitToken) ) {
          if ( (other === unitToken) || (other === token) || other.actor.system.defeat?.out ) continue;
          if ( relationOf(armyOf(actor, token), armyOf(other.actor, other)) !== "enemy" ) continue;
          if ( (measureDistance(unitToken, other) ?? Infinity) > plan.splash.within ) continue;
          const splashed = await damageUnit(other.actor, share, { kind: "skill", by: actor, byToken: token, token: other });
          rows.push({
            label: other.name || other.actor.name,
            value: i18n.format(splashed ? "FEO.Staff.damaged" : "FEO.Staff.byHand", { amount: splashed?.dealt ?? share }),
            cls: splashed ? "" : "bad"
          });
        }
      }
    }
  }

  // HP halved, and a unit killed outright
  if ( plan.halves ) {
    const hp = unit.system.hp.value;
    const amount = staffHalving(plan, hp);
    const hurt = (amount > 0) ? await damageUnit(unit, amount, { kind: "skill", by: actor, byToken: token, token: unitToken, settled: true }) : null;
    say(hurt ? "halved" : "byHand", { from: hp, to: hurt ? Math.max(hurt.hp ?? (hp - amount), 0) : 0 }, hurt ? "" : "bad");
  }
  if ( plan.slays ) {
    const all = unit.system.hp.value + (unit.system.hp.temp ?? 0);
    const hurt = (all > 0) ? await damageUnit(unit, all, { kind: "skill", by: actor, byToken: token, token: unitToken, settled: true }) : null;
    if ( hurt?.defeated ) use.slain += 1;
    say(hurt ? (hurt.defeated ? "slain" : "damaged") : "byHand", { amount: hurt?.dealt ?? 0 }, hurt ? "" : "bad");
  }

  // One weapon or item out of its pack, for the user to pick
  if ( plan.steals ) {
    const { handOver, packOf } = await import("./stealing.mjs");
    const pack = packOf(unit).filter((entry) => !entry.bound);
    const picked = await pickOne(token, item.name, pack.map((entry) => ({ id: entry.id, label: entry.name, hint: entry.uses })));
    const taken = picked ? await handOver(unit, picked, actor) : null;
    if ( taken ) pop(actor, [{ text: i18n.format("FEO.Steal.took", { item: taken }), tone: "gold" }]);
    say(taken ? "stolen" : pack.length ? "byHand" : "nothingToTake", { item: taken ?? "" }, taken ? "good" : "muted");
  }

  // Another go this turn
  if ( plan.again ) {
    const now = await againUnit(unit, { skill: item.name, mov: plan.again.mov });
    say((now === null) ? "byHand" : now ? "again" : "againLater", {}, (now === null) ? "bad" : "good");
  }

  // One weapon or Shield of its pack, for the user to pick
  if ( plan.repairs ) {
    const worn = [];
    for ( const owned of unit.items ) {
      if ( (owned.type !== "weapon") && !((owned.type === "gear") && owned.system.isShield) ) continue;
      const original = owned.flags?.[FEO.id]?.original ?? null;
      const uses = staffRepair(plan, original
        ? { name: original.name, uses: { value: 0, max: original.system?.uses?.max ?? 0 } }
        : { name: owned.flags?.[FEO.id]?.sheetName ?? owned.name, uses: owned.system.uses });
      if ( uses ) worn.push({ id: owned.id, label: original?.name ?? owned.name, hint: uses.max ? `${uses.value} / ${uses.max}` : "∞", uses });
    }
    const picked = await pickOne(token, item.name, worn);
    const chosen = worn.find((entry) => entry.id === picked) ?? null;
    const mended = chosen ? await mendFor(unit, chosen.id, chosen.uses) : null;
    if ( !chosen ) say("nothingToRepair", {}, "muted");
    else if ( !mended ) say("byHand", {}, "bad");
    else say(chosen.uses.max ? "repaired" : "endless", { item: mended, value: chosen.uses.value, max: chosen.uses.max }, "good");
  }
}

/* -------------------------------------------- */

/**
 * A staff brings an ally that has fallen back: it is at full HP again, stands next to the unit that used the
 * staff, and has had its turn. With several fallen, whoever acts for the unit picks one.
 * @param {object} use                        The staff as it is used
 * @param {TokenDocument|null} [chosen]       The fallen ally it is used on, where one was pointed out
 * @returns {Promise<void>}
 */
async function revive(use, chosen = null) {
  const { actor, token, item, rows } = use;
  const i18n = game.i18n;
  const fallen = (other) => {
    const state = other.actor?.system.defeat?.state;
    return (other.actor?.type === "unit") && !!state && (state !== "captured") && (relationOf(armyOf(actor, token), armyOf(other.actor, other)) === "ally");
  };
  const lying = chosen ? [chosen].filter(fallen) : (token?.parent?.tokens ?? []).filter((other) => (other !== token) && fallen(other));
  if ( !lying.length ) return void rows.push({ label: item.name, value: i18n.localize("FEO.Staff.nobodyFallen"), cls: "muted" });
  const picked = await pickOne(token, item.name, lying.map((other) => ({ id: other.id, label: other.name || other.actor.name })));
  const raised = lying.find((other) => other.id === picked);
  const unit = raised.actor;
  const name = raised.name || unit.name;
  const healed = await healUnit(unit, unit.system.hp.max + Math.max(-unit.system.hp.value, 0), { down: true, fromZero: true });

  // A unit raised above 0 HP is back on its feet a moment later, once its HP have been followed
  for ( let wait = 0; healed && unit.system.defeat?.state && (wait < 15); wait++ ) await new Promise((resolve) => setTimeout(resolve, 100));
  if ( !healed || unit.system.defeat?.state ) {
    rows.push({ label: name, value: i18n.format("FEO.Staff.byHand", { name }), cls: "bad" });
    return;
  }
  rows.push({ label: name, value: i18n.format("FEO.Staff.revived", { name }), cls: "good" });

  // It stands next to the unit that used the staff: on the free tile whoever acts for it picks
  if ( onGrid(token) ) {
    const { unitsOn } = await import("./battle-map.mjs");
    const { moverOf, tileGround } = await import("./terrain.mjs");
    const { warpToken } = await import("./warp.mjs");
    const scene = token.parent;
    const here = tokenTile(token);
    const taken = new Set(unitsOn(scene).filter((entry) => entry.token !== raised).map((entry) => tileKey(entry.tile)));
    const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
    const mover = moverOf(unit);
    const free = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([di, dj]) => ({ i: here.i + di, j: here.j + dj })).filter((tile) => {
      if ( (tile.i < i0) || (tile.i >= i1) || (tile.j < j0) || (tile.j >= j1) || taken.has(tileKey(tile)) ) return false;
      return Number.isFinite(moveCost(tileGround(scene, tile).terrain, mover));
    });
    let land = free[0] ?? null;
    if ( (free.length > 1) && token.isOwner ) {
      const answer = await game.feo?.hud?.ask?.({ token, skill: item.name, hint: "FEO.Staff.pickTile", tiles: free });
      if ( answer?.tile && free.some((tile) => (tile.i === answer.tile.i) && (tile.j === answer.tile.j)) ) land = answer.tile;
    }
    if ( !land || !(await warpToken(raised, land)) ) rows.push({ label: name, value: i18n.localize("FEO.Staff.warpUnsaved"), cls: "bad" });
  }
  await restUnit(unit);
}

/* -------------------------------------------- */

/**
 * A unit uses a staff: every unit it is used on gets what the staff does, and the skills of the units have
 * their say. A unit this user may not change is handed to a Game Master; what nobody can save is left for
 * the table and said to be.
 * @param {Actor} actor                   The unit that uses the staff
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Item} item                     The staff
 * @param {Token|null} [ally]             The one other unit the user has targeted, if any
 * @param {Token[]} [others]              Every other unit the user has targeted, for a staff for several units
 *                                        used off a battle map
 * @param {object} [options]
 * @param {{i: number, j: number}|null} [options.object]    The door or chest a staff that opens one is used on
 * @returns {Promise<{cast: StaffCast, rows: object[], range: string|null, freeUse: boolean, rolls: Roll[], slain: number,
 *   on: Token|null, allies: TokenDocument[]}>}
 *          What happened, the rows for the staff's card, the staff's Range as skills make it when they
 *          change it, whether the staff is spared its use, the dice that were used, the units it killed
 *          outright, the one unit it was used on and the allies a staff for several units caught
 */
export async function castStaffFor(actor, token, item, ally = null, others = [], { object = null } = {}) {
  // A unit that none of its enemies can make their target for now is not the target of their staves: the
  // staff is then used on nobody
  if ( ally?.actor && cannotTarget(actor, token, ally.actor, ally.document ?? null) ) {
    ui.notifications.warn("FEO.Exchange.warn.untargetable", { localize: true });
    ally = null;
  }
  const plan = staffPlanOf(actor, item);

  // A staff for several units, or one that is used on no unit, has no one target
  if ( ["allies", "enemies", "nobody", "object", "self"].includes(plan.on) ) ally = null;
  const target = ally?.actor ?? null;
  const targetToken = ally?.document ?? null;
  const names = { caster: token?.name || actor.name, target: targetToken?.name || target?.name || "" };
  const caster = staffUnitOf(actor, token);

  // Additional Staff Effects: a staff that may miss counts what is added to its user's Hit whatever it
  // attacks with, and a staff for several units rolls for each. Every die that may be needed is rolled at
  // once, and the message shows the ones that were used
  if ( FEO.optional.staffMissing.enabled ) {
    const terms = actor.system.combatWith(item.system).accuracy.terms;
    caster.hitBonus = terms.reduce((sum, term) => sum + (term.modifier ? term.value : 0), 0);
  }

  // On a battle map a staff for several units is used on every unit it catches; off one, on the units that
  // are targeted, of which only the names are known
  const area = staffAreaOf(token, item);
  const several = (plan.on === "allies") && !area ? others.filter((other) => other?.actor) : [];
  const describe = (other) => ({ ...staffUnitOf(other.actor, other), id: other.id, distance: measureDistance(token, other) ?? 0 });
  const patients = (area && (plan.on === "allies"))
    ? area.units.map((other) => ({ ...describe(other), ally: other !== token, self: other === token }))
    : null;

  // An Offensive Staff rolls to hit the enemy it is used on, and one for each enemy in range rolls for every
  // enemy it reaches and does anything to: Offensive Staff Hit against the Offensive Staff Avoid of each
  const relation = target ? relationOf(armyOf(actor, token), armyOf(target, targetToken)) : null;
  const avoidOf = (unit) => unit?.system.combat?.staffAvoid?.value ?? 0;
  caster.staffHit = actor.system.combatWith(item.system).staffHit.value;

  // Attack Speed, for a unit whose skill lets it follow up with an Offensive Staff: its own with the staff in
  // hand and the HST its supports give it, and the enemy's as it stands
  caster.attackSpeed = actor.system.combatWith(item.system).attackSpeed?.value;
  caster.haste = actor.system.support?.hst ?? 0;
  const enemies = (area && (plan.on === "enemies"))
    ? area.units.map((other) => ({ id: other.id, name: other.name || other.actor.name, staffAvoid: avoidOf(other.actor), distance: measureDistance(token, other) ?? 0 }))
    : [];
  const needed = staffDice(Math.max(several.length, patients?.length ?? 0), FEO.optional) + staffChances(caster.skills)
    + ((relation === "enemy") ? 2 : 0) + enemies.length;
  const { results } = needed ? await rollD100(needed) : { results: [] };
  const used = [];
  const cast = castStaff({
    staff: staffOf(item),
    caster,
    target: target ? {
      ...staffUnitOf(target, targetToken), id: targetToken?.id ?? null, ally: relation === "ally", enemy: relation === "enemy",
      staffAvoid: avoidOf(target), attackSpeed: target.system.combat?.attackSpeed?.value
    } : null,
    targets: several.map((other) => ({ name: other.document?.name || other.actor.name })),
    patients,
    enemies,
    distance: (token && targetToken) ? measureDistance(token, targetToken) : null,
    d100: needed ? () => {
      const next = results[used.length];
      used.push(next);
      return next;
    } : null
  });
  const standing = (unit) => !!unit && !unit.system.defeat?.state;
  const use = { actor, token, item, plan, cast, rows: [], slain: 0 };
  const scene = token?.parent ?? null;
  const healing = { fromZero: true, by: actor, byToken: token, counted: true };

  // HP restored: to the unit the staff is used on, or to its user. It goes the way of all healing; a unit
  // that is down, or that nobody here may change, is left for the table
  if ( cast.heal && !cast.heal.several ) {
    const patient = (cast.patient === "self") ? actor : target;
    const healed = ((cast.heal.restored > 0) && standing(patient))
      ? await healUnit(patient, cast.heal.restored, { ...healing, token: (patient === actor) ? token : targetToken })
      : null;
    if ( !standing(patient) || ((cast.heal.restored > 0) && !healed) ) cast.heal.unsaved = true;
  }

  // And to every ally a staff for several units reached, each for its own amount
  for ( const part of cast.units ?? [] ) {
    const other = scene?.tokens.get(part.id) ?? null;
    if ( !part.landed || !(part.restored > 0) ) continue;
    const healed = standing(other?.actor) ? await healUnit(other.actor, part.restored, { ...healing, token: other }) : null;
    if ( !healed ) part.unsaved = true;
  }
  if ( cast.user?.restored > 0 ) await healUnit(actor, cast.user.restored, { down: true });

  // What else the staff does, to each unit it did its part to: the one it was used on, unless it failed; its
  // user, where a skill has the staff used on it; every ally a staff for several units reached; and each
  // enemy an Offensive Staff hit, once for each cast that did
  if ( plan.applied ) {
    if ( (plan.on === "allies") && area ) {
      const reached = (other) => (cast.reached ?? []).find((entry) => entry.id === other.id)?.success ?? true;
      for ( const other of area.units ) if ( reached(other) ) await serve(use, other.actor, other);
    }
    else if ( plan.on === "enemies" ) {
      for ( const entry of cast.reached ?? [] ) {
        const other = scene?.tokens.get(entry.id) ?? null;
        if ( entry.offensive && entry.success && other?.actor ) await serve(use, other.actor, other);
      }
    }
    else if ( target && (relation === "enemy") ) {
      const hits = cast.casts.filter((part) => part.offensive && part.hit?.success).length;
      for ( let hit = 0; hit < hits; hit++ ) await serve(use, target, targetToken);
    }
    else if ( plan.revives ) {
      if ( !cast.missed ) await revive(use, targetToken);
    }
    else if ( target && !cast.missed ) await serve(use, target, targetToken);
    else if ( (cast.patient === "self") && !cast.missed ) await serve(use, actor, token);
  }

  // A door or a chest it opens
  if ( plan.unlocks && object && token && !cast.missed ) {
    const { unlockObject } = await import("./objects.mjs");
    const opened = await unlockObject(token, object, item);
    use.rows.push({ label: item.name, value: game.i18n.localize(opened ? "FEO.Staff.unlocked" : "FEO.Staff.byHandPlain"), cls: opened ? "good" : "bad" });
  }

  // Changes that last a while, which the skills of the user grant: to itself, and to each unit the staff did
  // its part to
  for ( const moment of cast.moments ) {
    const own = moment.granted.filter((granted) => granted.to === "self").map((granted) => granted.change);
    if ( own.length ) await grantTimed(actor, own);
    for ( const granted of moment.granted ) {
      if ( granted.to !== "target" ) continue;
      const carrier = (granted.id && scene?.tokens.get(granted.id)?.actor) || target;
      const given = standing(carrier) ? await grantUnit(carrier, [granted.change], { by: actor }) : null;
      if ( !given ) granted.unsaved = true;
      else if ( given[0] ) granted.change = given[0];
    }
  }
  return {
    cast,
    rows: [...staffRows(cast, game.i18n, names), ...use.rows],
    range: reachText(cast),
    freeUse: !!cast.freeUse,
    rolls: used.length ? [rollFromResults(used)] : [],
    slain: use.slain,

    // The one unit it was used on, if it was, and the allies a staff for several units caught
    on: ally,
    allies: (area && (plan.on === "allies")) ? area.units.filter((other) => other !== token) : []
  };
}

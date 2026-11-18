import { FEO } from "../config.mjs";
import { clockOf } from "./clock.mjs";
import { defenceAgainst } from "../rules/combat.mjs";
import { attackElement, conditionConfig, readConditions, resolveHit } from "../rules/conditions.mjs";
import {
  builtInChanges, conditionMoments, damageDice, damageWounds, harmDice, keptConditions, killDice, killMoments,
  receiveCondition, regainHp, saveHarm, sufferDamage, wardDice
} from "../rules/events.mjs";
import { relationOf } from "../rules/positions.mjs";
import { healMoments, healingShare } from "../rules/staves.mjs";
import { boostChange, endWith, spendTemp, splitHp } from "../rules/timed.mjs";
import { earnGo, goesSpent } from "./acting.mjs";
import { postCard, rollD100 } from "./chat.mjs";
import { grantSkills } from "./classes.mjs";
import { setConditions } from "./conditions.mjs";
import { cutInHold, cutInsOn, showCutIns, skillIcon } from "./cut-ins.mjs";
import { HP_BEFORE } from "./defeat.mjs";
import { armyOf, incapacitates, measureDistance } from "./exchange.mjs";
import { turnState } from "./phases.mjs";
import { standingOf, tokenInView } from "./positions.mjs";
import { buffTimesOf, grantTimed, timedOf } from "./timed.mjs";

/**
 * What happens to a unit, in Foundry: one path each for damage, for healing, for a condition being put on it,
 * for a foe it defeats and for gold it is given. Whatever the source (the damage of a skill, a staff, an item,
 * a condition as a turn starts, the ground, a number typed in by hand) it goes through here, where the unit's
 * skills are asked what they make of it (see `rules/events.mjs`), the result is saved, and every client shows
 * it over the unit's tokens. A fight the system rolls asks the same rules as it is rolled out, and saves what
 * came of it in one go (see `exchange.mjs`).
 *
 * A unit the user may not change is handed to an active Game Master.
 *
 * @import {DamageOutcome, EventUnit} from "../rules/events.mjs"
 * @import {TimedChange} from "../rules/timed.mjs"
 */

/** The name of the query that asks a Game Master to let something happen to a unit the asking user does not own. */
export const EVENT_QUERY = `${FEO.id}.unitEvent`;

/** The socket the system's clients talk over. */
const SOCKET = `system.${FEO.id}`;

/** The update option that says a condition was put on a unit by the system, with its skills already asked. */
const SETTLED = { [FEO.id]: { settled: true } };

/** Where the update of a unit notes the temporary HP it had before, as `HP_BEFORE` does its own. */
const TEMP_BEFORE = "feoTempBefore";

/** What is floated over a unit's tokens, by what it tells of. */
const TONES = { damage: "#ff6257", heal: "#73e08a", gold: "#ffd866", exp: "#8fd0ff", skill: "#ffffff", block: "#9fc3e8" };


/* -------------------------------------------- */
/*  Reading Units                               */
/* -------------------------------------------- */

/**
 * The token a unit stands with: its own, or the one linked to it on the scene in view.
 * @param {Actor} actor
 * @returns {TokenDocument|null}
 */
function tokenOf(actor) {
  return actor?.token ?? tokenInView(actor);
}

/* -------------------------------------------- */

/**
 * Describe a unit as it is now for the rules of events: its numbers, its skills with the changes it carries
 * and the auras it receives, and whether it is its turn.
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]    Its token, if it has one on a map
 * @returns {EventUnit}
 */
export function eventUnitOf(actor, token = tokenOf(actor)) {
  const system = actor.system;
  const place = standingOf(token);
  const weapon = system.equippedWeapon;
  const conditions = { ...(system.conditions ?? {}) };
  const state = turnState(actor, token);
  return {
    name: token?.name || actor.name,
    uuid: actor.uuid,
    hp: system.hp.value,
    hpMax: system.hp.max,
    level: system.level,
    stats: system.statValues,
    conditions,
    skills: [...(system.skills?.entries ?? []), ...(system.skills?.timed ?? []), ...(place?.auras ?? [])],
    bends: system.skills?.bends ?? null,
    activation: system.skills?.activation ?? 0,
    always: !!system.skills?.rules?.includes("alwaysActivate"),
    times: system.stagger?.times ?? 1,
    resilience: incapacitates(actor, token) ? (system.defeat?.resilience ?? 0) : undefined,
    inTurn: (state === "ready") || (state === "moving") || (state === "acted"),

    // The marks skills of other units left on it, for a skill that asks for its own
    marks: (system.timed ?? []).filter((change) => change.mark).map((change) => ({ name: change.name, from: change.from ?? "" })),
    self: {
      goes: goesSpent(actor),
      hp: system.hp.value,
      hpMax: system.hp.max,
      level: system.level,
      tier: system.classTier,
      gender: system.profile?.gender ?? "",
      bestRank: system.bestRank ?? "",
      gold: system.gold ?? 0,
      stats: system.bare?.stats ?? system.statValues,
      base: system.bare?.base ?? {},
      waiting: !!system.waiting,
      weapon: weapon ? { name: weapon.name, ...weapon.system } : null,
      near: place?.near ?? null,
      clock: clockOf(actor, token),
      conditions,
      qualities: system.specialQualities ?? "",
      shifted: !!system.shift?.transformed
    }
  };
}

/* -------------------------------------------- */

/**
 * The one other unit the user has selected on the map, which is the unit that acts when something is done to
 * a unit by hand: the one that attacks it, gives it a condition, or defeats it.
 * @param {Actor} actor     The unit something is done to
 * @returns {{actor: Actor, token: TokenDocument}|null}     Null unless exactly one other unit is selected
 */
export function selectedOther(actor) {
  const picked = (globalThis.canvas?.tokens?.controlled ?? []).filter((token) => (token.actor?.type === "unit") && (token.actor !== actor));
  return (picked.length === 1) ? { actor: picked[0].actor, token: picked[0].document } : null;
}

/* -------------------------------------------- */
/*  Showing                                     */
/* -------------------------------------------- */

/**
 * Float lines of text over a unit's tokens on the map in view, on this client.
 * @param {Actor|null} actor
 * @param {{text: string, tone?: string}[]} lines
 */
function float(actor, lines) {
  if ( !globalThis.canvas?.ready || !actor || !lines?.length ) return;
  if ( !cutInsOn() ) return scroll(actor, lines);

  // Where this user has cut-ins on, a skill that is named flashes its icon and name over the unit instead, one
  // that was already told of that way is left out, and whatever else is floated waits for the cut-ins to be over
  const rest = [];
  const flashed = [];
  for ( const line of lines ) {
    if ( line.tone !== "skill" ) rest.push(line);
    else if ( line.seen ) continue;
    else if ( skillIcon(actor, line.text) ) flashed.push({ actor, skill: String(line.text) });
    else rest.push(line);
  }
  if ( flashed.length ) showCutIns(flashed);
  if ( !rest.length ) return;
  const wait = cutInHold();
  if ( wait > 0 ) setTimeout(() => scroll(actor, rest), wait);
  else scroll(actor, rest);
}

/* -------------------------------------------- */

/**
 * Scroll lines of text up or down from a unit's tokens on the map in view, on this client.
 * @param {Actor} actor
 * @param {{text: string, tone?: string}[]} lines
 */
function scroll(actor, lines) {
  if ( !globalThis.canvas?.ready ) return;
  const { TOP, BOTTOM } = CONST.TEXT_ANCHOR_POINTS;
  for ( const token of actor.getActiveTokens?.(true, false) ?? [] ) {
    if ( token.destroyed || (token.document.hidden && !game.user.isGM) ) continue;
    lines.forEach((line, index) => {
      const origin = { x: token.center.x, y: token.center.y - (token.h / 2) - (index * 26) };
      canvas.interface.createScrollingText(origin, String(line.text), {
        anchor: BOTTOM,
        direction: (line.tone === "damage") ? BOTTOM : TOP,
        distance: token.h * 0.75,
        duration: 2200,
        fontSize: (line.tone === "skill") ? 24 : 32,
        fill: TONES[line.tone] ?? TONES.skill,
        stroke: 0x000000,
        strokeThickness: 4,
        jitter: 0.2
      })?.catch?.(() => {});
    });
  }
}

/* -------------------------------------------- */

/**
 * Float lines of text over a unit's tokens for everyone who has its map in view. A line that names a skill
 * (`tone: "skill"`) is shown as a cut-in by a user who has those on (see `helpers/cut-ins.mjs`); `seen` marks
 * one that a cut-in has already told of, which such a user is not told twice.
 * @param {Actor} actor
 * @param {{text: string, tone?: "damage"|"heal"|"gold"|"exp"|"skill"|"block", seen?: boolean}[]} lines
 */
export function pop(actor, lines) {
  const told = (lines ?? []).filter((line) => line?.text);
  if ( !actor || !told.length ) return;
  float(actor, told);
  game.socket?.emit(SOCKET, { type: "unit.pop", actor: actor.uuid, lines: told });
}

/* -------------------------------------------- */

/**
 * After a unit's HP has changed, whatever changed it, float what it lost or regained over its tokens. Runs on
 * every client.
 * @param {Actor} actor
 * @param {object} changed
 * @param {object} options
 */
export function showHp(actor, changed, options) {
  if ( actor?.type !== "unit" ) return;

  // HP that are only set aside or given back, as those of a unit that imitates another, are neither damage
  // nor healing
  if ( options?.[FEO.id]?.quietHp ) return;
  const own = foundry.utils.hasProperty(changed, "system.hp.value");
  const lent = foundry.utils.hasProperty(changed, "system.timed") && (options?.[TEMP_BEFORE]?.[actor.uuid] !== undefined);
  if ( !own && !lent ) return;

  // What it lost or gained of its own HP, and of the temporary HP it has on top of them
  const delta = (own ? actor.system.hp.value - options?.[HP_BEFORE]?.[actor.uuid] : 0)
    + (lent ? (actor.system.hp.temp ?? 0) - options[TEMP_BEFORE][actor.uuid] : 0);
  if ( !Number.isFinite(delta) || !delta ) return;
  float(actor, [{ text: (delta > 0) ? `+${delta}` : `${delta}`, tone: (delta > 0) ? "heal" : "damage" }]);
}

/* -------------------------------------------- */
/*  Handing Over                                */
/* -------------------------------------------- */

/**
 * Ask an active Game Master to let something happen to a unit this user may not change.
 * @param {string} type       What happens: "damage", "heal", "wound", "afflict", "cure", "grant", "again", "rest", "mend",
 *                            "kill", "spend" or "note"
 * @param {Actor} actor
 * @param {object} data
 * @returns {Promise<*>}      What came of it, or null when nobody could do it
 */
async function handOver(type, actor, data = {}) {
  const gm = game.users.activeGM;
  if ( !gm ) return null;
  const about = { ...(data.about ?? {}) };
  about.by = about.by?.uuid ?? null;
  about.byToken = about.byToken?.uuid ?? null;
  delete about.token;
  try {
    return await gm.query(EVENT_QUERY, { ...data, type, uuid: actor.uuid, about }, { timeout: 10000 });
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Answer another user's request to let something happen to a unit. Runs for a Game Master. Only damage,
 * healing, a condition, a change that lasts a while and what a unit's skills give it for defeating a foe can
 * be asked for this way.
 * @param {{type: string, uuid: string, about?: object}} data
 * @returns {Promise<*>}
 */
export async function unitEventQuery({ type, uuid, about = {}, ...data } = {}) {
  if ( !game.user.isGM ) return null;
  const unit = async (id) => {
    const found = (typeof id === "string") && id ? await foundry.utils.fromUuid(id) : null;
    return ((found?.documentName === "Actor") && (found.type === "unit")) ? found : null;
  };
  const actor = await unit(uuid);
  if ( !actor ) return null;
  const known = { ...(about ?? {}) };
  known.by = await unit(known.by);
  known.byToken = ((typeof known.byToken === "string") && known.byToken) ? await foundry.utils.fromUuid(known.byToken) : null;
  if ( known.byToken?.documentName !== "Token" ) known.byToken = null;
  const whole = (value) => Number.isInteger(value) && (value > 0) && (value <= 9999);
  switch ( type ) {
    case "damage": return whole(data.amount) ? damageUnit(actor, data.amount, known) : null;
    case "heal": return whole(data.amount) ? healUnit(actor, data.amount, known) : null;
    case "wound": return (whole(data.amount) && (data.amount <= 9)) ? woundUnit(actor, data.amount) : null;
    case "cure": return ((data.ids === "all") || Array.isArray(data.ids)) ? cureUnit(actor, data.ids) : null;
    case "again": return (typeof data.grant?.skill === "string") ? againUnit(actor, { skill: data.grant.skill, mov: data.grant.mov }) : null;
    case "rest": return restUnit(actor);
    case "mend": return (typeof data.item === "string") ? mendFor(actor, data.item, data.uses) : null;
    case "afflict": return (typeof data.id === "string") ? afflictUnit(actor, data.id, known) : null;
    case "grant": return Array.isArray(data.changes) ? grantUnit(actor, data.changes, known) : null;
    case "kill": {
      const victim = await unit(data.victim);
      return victim ? creditKill(actor, victim) : null;
    }
    case "spend": return (typeof data.item === "string") ? spendFor(actor, data.item) : null;
    case "note": return (typeof data.key === "string") ? noteFor(actor, data.key, data.value) : null;
    default: return null;
  }
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * A unit takes damage, from whatever source. Its skills, and those of the allies around it, are asked what
 * they make of it; a hit of an attack does to its conditions what a hit does; and a unit that is brought down
 * by another has been defeated by it.
 * @param {Actor} actor
 * @param {number} amount                 The damage as it comes
 * @param {object} [about]
 * @param {"attack"|"skill"|"condition"|"backfire"|"terrain"} [about.kind]    An attack unless given
 * @param {Actor|null} [about.by]         The unit that deals it, where one is known
 * @param {TokenDocument|null} [about.byToken]
 * @param {object|null} [about.weapon]    The weapon of an attack; that of the unit that deals it unless given
 * @param {string|null} [about.element]   The element of the damage, where no weapon is known
 * @param {"def"|"res"|null} [about.resist]   The defence the damage was counted against
 * @param {boolean} [about.nonlethal]     Does it leave the unit 1 HP at least?
 * @param {boolean} [about.settled]       Are shares and immunities already counted in the amount?
 * @param {boolean} [about.quiet]         Is a unit going down told of elsewhere, so that no card says so?
 * @returns {Promise<DamageOutcome|null>} What came of it; null when it could not be saved
 */
export async function damageUnit(actor, amount, about = {}) {
  if ( (actor?.type !== "unit") || !(amount > 0) ) return null;
  if ( !actor.isOwner ) return handOver("damage", actor, { amount: Math.floor(amount), about });
  const token = about.token ?? tokenOf(actor);
  const unit = eventUnitOf(actor, token);

  // Temporary HP count with the unit's own as it is hurt: they are what it loses first
  const own = { value: actor.system.hp.value, max: actor.system.hp.max, temp: actor.system.hp.temp ?? 0 };
  if ( own.temp > 0 ) {
    unit.hp += own.temp;
    unit.hpMax += own.temp;
    unit.self = { ...unit.self, hp: unit.self.hp + own.temp, hpMax: unit.self.hpMax + own.temp };
  }
  const kind = about.kind ?? "attack";
  const by = ((about.by?.type === "unit") && (about.by !== actor)) ? about.by : null;
  const byToken = by ? (about.byToken ?? tokenOf(by)) : null;
  const dealer = by ? eventUnitOf(by, byToken) : null;

  // An attack is made with the weapon its unit has in hand, unless another is named
  const weapon = about.weapon ?? ((kind === "attack") ? (dealer?.self.weapon ?? null) : null);
  const struck = (kind === "attack") && !!weapon && !about.settled;
  const facts = {
    kind,
    weapon,
    element: about.element ?? null,
    resist: about.resist ?? (((kind === "attack") && weapon) ? defenceAgainst(weapon) : null),
    nonlethal: !!about.nonlethal,
    settled: !!about.settled,
    distance: ((token && byToken) ? measureDistance(token, byToken) : null) ?? 1,
    by: dealer ? { ...dealer.self, stats: dealer.stats } : null
  };

  // Every die that may be needed is rolled at once: the unit's chances, and for a hit a condition that may
  // burst with what may nullify the one it bursts into
  const wards = unit.bends?.nullify ?? [];
  const bursting = struck ? Object.keys(unit.conditions).filter((id) => conditionConfig(id)?.burst).length : 0;
  const needed = damageDice(unit, facts) + (bursting * (1 + wardDice(wards)));
  const { results } = needed ? await rollD100(needed) : { results: [] };
  let used = 0;
  const d100 = () => results[used++] ?? 100;
  const outcome = sufferDamage(unit, amount, facts, d100);

  // What the hit does to the conditions of its target: those that end on being hit end, one that can burst
  // may, and what it leeches goes to the attacker
  const hit = (struck && (unit.hp > 0)) ? resolveHit(unit.conditions, {
    physical: defenceAgainst(weapon) === "def",
    element: attackElement(weapon),
    damage: Math.max(Math.min(unit.hp, outcome.dealt), 0),
    alive: outcome.hp > 0,
    inflicts: [],
    wards,
    burstHarm: dealer?.bends?.burstHarm ?? null,
    suffers: unit.bends?.suffers ?? null
  }, d100) : null;

  // The skills that made something else of it are named before what the unit lost is shown
  const names = [...new Set(outcome.steps.map((step) => step.skill))];
  if ( names.length ) pop(actor, names.map((text) => ({ text, tone: "skill" })));
  if ( outcome.hp !== unit.hp ) {
    const left = own.temp ? splitHp(own, outcome.hp) : { value: outcome.hp, temp: 0 };
    const update = {};
    if ( left.value !== own.value ) update["system.hp.value"] = left.value;
    if ( left.temp < own.temp ) update["system.timed"] = spendTemp(timedOf(actor), own.temp - left.temp).list;
    if ( Object.keys(update).length ) await actor.update(update, { [FEO.id]: { quietDefeat: about.quiet === true } });
  }

  // Skills that count their uses, and what they grant their unit as they take effect
  for ( const spent of outcome.used ) {
    const item = actor.items.get(spent.id) ?? actor.items.find((entry) => (entry.type === "skill") && (entry.name === spent.name));
    if ( item?.system.usage?.kind ) await item.update({ "system.state.used": (item.system.state?.used ?? 0) + 1 });
  }
  if ( outcome.grants.length ) await grantTimed(actor, outcome.grants);

  if ( hit ) {
    const changes = {};
    for ( const id of Object.keys(unit.conditions) ) if ( !Object.hasOwn(hit.target, id) ) changes[id] = null;
    for ( const [id, turns] of Object.entries(hit.target) ) if ( unit.conditions[id] !== turns ) changes[id] = turns;
    if ( Object.keys(changes).length ) await setConditions(actor, changes);
    if ( (hit.leech > 0) && by ) await healUnit(by, hit.leech);

    // A burst that a skill makes hurt deals the turns the condition had as damage. It is nobody's kill
    if ( hit.burst?.harm && (outcome.hp > 0) ) {
      pop(actor, [{ text: hit.burst.skill, tone: "skill" }]);
      await damageUnit(actor, hit.burst.harm, { kind: "skill", token });
    }
  }
  // A hit that deals enough at once causes a unit that can be Wounded a Wound, as in a fight
  let wounded = null;
  if ( incapacitates(actor, token) ) {
    const wounds = damageWounds(outcome, actor.system.hp.base ?? actor.system.hp.max);
    if ( wounds > 0 ) wounded = await woundUnit(actor, wounds, { token });
  }
  if ( outcome.defeated && by ) await creditKill(by, actor, { byToken, token });
  return { ...outcome, hit, ...(wounded ? { wounds: wounded.wounds, spared: wounded.rolls } : {}) };
}

/* -------------------------------------------- */
/*  Wounds and Injuries                         */
/* -------------------------------------------- */

/**
 * A unit would be given Wounds, or Injuries: the chances its skills give it to take none are rolled, each
 * Wound or Injury by itself, and a skill that spares it one says so over the unit.
 * @param {Actor} actor
 * @param {"wound"|"injury"} what
 * @param {number} [count]
 * @param {object} [options]
 * @param {TokenDocument|null} [options.token]
 * @returns {Promise<{left: number, spared: number, rolls: object[], roll: Roll|null}>}
 *          How many it is still given, what was rolled (see `saveHarm`), and the dice for a card
 */
export async function spareHarm(actor, what, count = 1, { token = null } = {}) {
  const none = { left: Math.max(count ?? 0, 0), spared: 0, rolls: [], roll: null };
  if ( (actor?.type !== "unit") || !(count > 0) ) return none;
  const unit = eventUnitOf(actor, token ?? tokenOf(actor));
  const needed = harmDice(unit, what, count);
  const { roll, results } = needed ? await rollD100(needed) : { roll: null, results: [] };
  let used = 0;
  const saved = saveHarm(unit, what, count, () => results[used++] ?? 100);
  const names = [...new Set(saved.rolls.filter((entry) => entry.success).map((entry) => entry.skill))];
  if ( names.length ) pop(actor, names.map((text) => ({ text, tone: "skill" })));
  return { left: saved.left, spared: saved.spared, rolls: saved.rolls, roll: used ? roll : null };
}

/* -------------------------------------------- */

/**
 * A unit that can be Wounded takes Wounds outside of a fight the system rolls, where the fight's own card
 * tells of them: its skills may spare it each, what it is left with is saved and said over the unit, and a
 * roll that was made is shown on a short card.
 * @param {Actor} actor
 * @param {number} count
 * @param {object} [options]
 * @param {TokenDocument|null} [options.token]
 * @param {boolean} [options.quiet]     Is it told of elsewhere, so that no card is posted?
 * @returns {Promise<{wounds: number, rolls: object[], roll: Roll|null}|null>}
 */
export async function woundUnit(actor, count, { token = null, quiet = false } = {}) {
  if ( (actor?.type !== "unit") || !(count > 0) ) return null;
  if ( !actor.isOwner ) return handOver("wound", actor, { amount: Math.floor(count) });
  const saved = await spareHarm(actor, "wound", count, { token });
  if ( saved.left > 0 ) {
    const system = actor.system;
    const update = { "system.wounds": system.wounds + saved.left };
    // A Wound lowers maximum HP, which current HP cannot exceed
    const max = Math.max(system.hp.max - (saved.left * FEO.woundPenalty), 0);
    if ( system.hp.value > max ) update["system.hp.value"] = max;
    await actor.update(update, { [FEO.id]: { quietHp: true } });
    pop(actor, [{ text: game.i18n.localize("FEO.Defeat.woundShort"), tone: "damage" }]);
  }
  if ( saved.rolls.length && !quiet ) {
    try {
      const { buildSpareCard } = await import("./defeat-context.mjs");
      await postCard(actor, buildSpareCard((token ?? tokenOf(actor))?.name || actor.name, saved.rolls, game.i18n), { rolls: saved.roll ? [saved.roll] : [] });
    } catch(err) {
      console.error(err);
    }
  }
  return { wounds: saved.left, rolls: saved.rolls, roll: saved.roll };
}

/* -------------------------------------------- */

/**
 * HP is changed by hand, with the sheet's buttons, its HP field or a token's bar: what is taken off is an
 * attack by the unit selected on the map, or plain damage with nobody selected, and what is added is healing.
 * @param {Actor} actor
 * @param {number} delta      What HP changes by
 * @returns {Promise<object|null>}
 */
export async function changeHpByHand(actor, delta) {
  const amount = Math.trunc(delta ?? 0);
  if ( (actor?.type !== "unit") || !amount ) return null;
  if ( amount > 0 ) return healUnit(actor, amount, { down: true });
  const by = selectedOther(actor);
  return damageUnit(actor, -amount, { kind: "attack", by: by?.actor ?? null, byToken: by?.token ?? null });
}

/* -------------------------------------------- */

/**
 * A token's HP bar is edited: the change goes the way of every other change made by hand.
 * @param {{attribute: string, value: number, isDelta: boolean, isBar: boolean}} change
 * @param {object} updates
 * @param {Actor} actor
 * @returns {boolean}     False once the change has been taken over
 */
export function onModifyTokenAttribute({ attribute, value, isDelta, isBar } = {}, updates, actor) {
  if ( (actor?.type !== "unit") || (attribute !== "hp") || !isBar || !Number.isFinite(value) ) return true;
  const current = actor.system.hp.value;
  const target = isDelta ? current + value : value;
  changeHpByHand(actor, Math.min(target, actor.system.hp.max) - current).catch((err) => console.error(err));
  return false;
}

/* -------------------------------------------- */
/*  Healing                                     */
/* -------------------------------------------- */

/**
 * A unit regains HP, from whatever source, up to its maximum. Where another unit heals it, an ally of its own,
 * that unit's skills are asked what they make of it: the share they add to all its healing, and what healing
 * an ally sets off (see `healMoments` in `rules/staves.mjs`).
 * @param {Actor} actor
 * @param {number} amount
 * @param {object} [about]
 * @param {boolean} [about.down]        Is a unit that is down healed all the same? Otherwise it is left as it is
 * @param {boolean} [about.fromZero]    Is a unit below 0 HP healed from 0, as a staff heals it?
 * @param {Actor|null} [about.by]       The unit that heals it, where one does
 * @param {TokenDocument|null} [about.byToken]
 * @param {boolean} [about.counted]     Is what that unit's skills add to its healing already in the amount?
 * @returns {Promise<{hpBefore: number, hp: number, healed: number, down?: boolean}|null>}
 *          What it regained; `down` for a unit that was left as it is; null when it could not be saved
 */
export async function healUnit(actor, amount, about = {}) {
  if ( (actor?.type !== "unit") || !(amount > 0) ) return null;
  const by = ((about.by?.type === "unit") && (about.by !== actor)) ? about.by : null;
  const byToken = by ? (about.byToken ?? tokenOf(by)) : null;
  const token = about.token ?? tokenOf(actor);
  const allied = !!by && (relationOf(armyOf(by, byToken), armyOf(actor, token)) === "ally");
  let given = amount;
  if ( allied && !about.counted ) {
    const healer = eventUnitOf(by, byToken);
    const share = healingShare(healer.skills, healer.self);
    if ( share ) given = Math.floor(((amount * (100 + share)) / 100) + 1e-9);
  }
  let result = null;
  if ( !actor.isOwner ) result = await handOver("heal", actor, { amount: Math.floor(given), about: { down: !!about.down, fromZero: !!about.fromZero } });
  else {
    const { value, max } = actor.system.hp;
    if ( actor.system.defeat?.state && !about.down ) return { hpBefore: value, hp: value, healed: 0, down: true };
    result = regainHp({ hp: value, hpMax: max }, given, { fromZero: !!about.fromZero });
    if ( result.hp !== value ) await actor.update({ "system.hp.value": result.hp });
  }

  // What healing an ally sets off for the unit that healed it, where the user who acts for it sees it
  if ( allied && (result?.healed > 0) ) {
    try {
      await healedAlly(by, byToken, token, result.healed);
    } catch(err) {
      console.error(err);
    }
  }
  return result;
}

/* -------------------------------------------- */

/**
 * A unit has healed an ally: what its skills make of that. Damage to the enemy nearest to that ally is dealt
 * to it as the damage of a skill; where several stand equally near, whoever acts for the unit picks one on the
 * map, and the first is taken where nobody does.
 * @param {Actor} by                      The unit that healed
 * @param {TokenDocument|null} byToken
 * @param {TokenDocument|null} token      The token of the ally it healed
 * @param {number} healed                 The HP that ally regained
 * @returns {Promise<void>}
 */
async function healedAlly(by, byToken, token, healed) {
  const scene = token?.parent;
  if ( !scene ) return;
  const healer = eventUnitOf(by, byToken);
  const { harms } = healMoments({ healer: { ...healer, ...healer.self, skills: healer.skills }, patient: { near: standingOf(token)?.near ?? null }, healed });
  for ( const harm of harms ) {
    const tokens = harm.units.map((unit) => scene.tokens.get(unit.id)).filter((other) => other?.actor && !other.actor.system.defeat?.out);
    if ( !tokens.length ) continue;
    let picked = tokens[0];
    if ( (tokens.length > 1) && byToken?.isOwner ) {
      const answer = await game.feo?.hud?.ask?.({ token: byToken, skill: harm.skill, hint: "FEO.Staff.pickFoe", units: tokens });
      if ( answer?.unit && tokens.includes(answer.unit) ) picked = answer.unit;
    }
    pop(by, [{ text: harm.skill, tone: "skill" }]);
    await damageUnit(picked.actor, harm.amount, { kind: "skill", by, byToken, token: picked });
  }
}

/* -------------------------------------------- */

/**
 * A unit is cured of conditions, by whatever cures it.
 * @param {Actor} actor
 * @param {"all"|string[]} ids      The conditions; "all" for every one it suffers from
 * @returns {Promise<string[]|null>}    The conditions it was cured of; null when it could not be saved
 */
export async function cureUnit(actor, ids = "all") {
  if ( actor?.type !== "unit" ) return null;
  if ( !actor.isOwner ) return handOver("cure", actor, { ids });
  const had = Object.keys(actor.system.conditions ?? {});
  const cured = (ids === "all") ? had : had.filter((id) => ids.includes(id));
  if ( cured.length ) await setConditions(actor, Object.fromEntries(cured.map((id) => [id, null])));
  return cured;
}

/* -------------------------------------------- */

/**
 * A unit is given another go in its turn by something another unit does for it: at once if it has acted, and
 * else once it has taken its Action.
 * @param {Actor} actor
 * @param {{skill: string, mov?: "full"|"left"|"none"}} grant     What gives it, and the movement of the go
 * @returns {Promise<boolean|null>}     Whether it has the go at once; null when it could not be saved
 */
export async function againUnit(actor, grant = {}) {
  if ( actor?.type !== "unit" ) return null;
  if ( !actor.isOwner ) return handOver("again", actor, { grant: { skill: grant.skill, mov: grant.mov } });
  const mov = ["full", "left", "none"].includes(grant.mov) ? grant.mov : "full";
  return earnGo(actor, tokenOf(actor), [{ skill: String(grant.skill ?? ""), acts: { mov } }]);
}

/* -------------------------------------------- */

/**
 * A unit has had its turn for this Phase without taking it, as one that was just brought back has.
 * @param {Actor} actor
 * @returns {Promise<boolean|null>}
 */
export async function restUnit(actor) {
  if ( actor?.type !== "unit" ) return null;
  if ( !actor.isOwner ) return handOver("rest", actor, {});
  if ( !game.combat?.started ) return false;
  await actor.setFlag(FEO.id, "acted", true);
  return true;
}

/* -------------------------------------------- */

/**
 * A weapon or a Shield of a unit has its uses set, as a staff that repairs it does. A broken one is what it
 * was again.
 * @param {Actor} actor
 * @param {string} itemId
 * @param {{value: number, max: number}} uses
 * @returns {Promise<string|null>}    The name of what was repaired; null when it could not be saved
 */
export async function mendFor(actor, itemId, uses) {
  if ( actor?.type !== "unit" ) return null;
  const whole = (value) => Number.isInteger(value) && (value >= 0) && (value <= 9999);
  if ( !whole(uses?.value) || !whole(uses?.max) || (uses.value > uses.max) ) return null;
  if ( !actor.isOwner ) return handOver("mend", actor, { item: itemId, uses: { value: uses.value, max: uses.max } });
  const item = actor.items.get(itemId);
  if ( !item || !["weapon", "gear"].includes(item.type) ) return null;
  const { mendItem } = await import("./weapons.mjs");
  return mendItem(item, { value: uses.value, max: uses.max });
}

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

/**
 * A condition is put on a unit, from whatever source. What guards the unit may nullify it; the skills of the
 * unit that inflicts it make it last longer and leave their mark; and the unit that suffers it may hand it back.
 * @param {Actor} actor
 * @param {string} id                     A key of FEO.conditions
 * @param {object} [about]
 * @param {Actor|null} [about.by]         The unit that inflicts it, where one is known
 * @param {TokenDocument|null} [about.byToken]
 * @param {number} [about.turns]          Turns to apply, instead of the condition's usual amount
 * @param {boolean} [about.keep]          For one handed back: it never cuts short what the unit already suffers
 * @param {boolean} [about.down]          Is it put on a unit without HP all the same?
 * @param {boolean} [about.returned]      Was it handed back? It then sets off nothing further
 * @param {boolean} [about.passed]        Was it passed on from another unit that was given it? It then lasts
 *                                        as it was passed on, and sets off nothing further either
 * @returns {Promise<object|null>}        The condition as it was applied; `success: false` when it was
 *                                        nullified; null for what is no condition, or could not be saved
 */
export async function afflictUnit(actor, id, about = {}) {
  const config = conditionConfig(id);
  if ( (actor?.type !== "unit") || !config || config.combatOnly ) return null;
  if ( !actor.isOwner ) return handOver("afflict", actor, { id, about });
  const token = about.token ?? tokenOf(actor);
  const unit = eventUnitOf(actor, token);
  const by = ((about.by?.type === "unit") && (about.by !== actor)) ? about.by : null;
  const byToken = by ? (about.byToken ?? tokenOf(by)) : null;
  const giver = by ? eventUnitOf(by, byToken) : null;

  const wards = unit.bends?.nullify ?? [];
  const needed = wardDice(wards);
  const { results } = needed ? await rollD100(needed) : { results: [] };
  let used = 0;
  const given = receiveCondition({ conditions: unit.conditions, hp: unit.hp, wards }, id, {
    turns: Number.isInteger(about.turns) ? about.turns : undefined,
    more: about.passed ? 0 : (giver?.bends?.inflictTurns?.[id] ?? 0),
    keep: !!about.keep,
    down: !!about.down
  }, () => results[used++] ?? 100);
  if ( !given ) return null;
  const { state, held, ...told } = given;
  if ( told.success === false ) {
    pop(actor, [{ text: told.warded.at(-1).skill, tone: "skill" }]);
    return told;
  }
  if ( state[id] !== unit.conditions[id] ) await setConditions(actor, { [id]: state[id] });
  if ( about.returned || about.passed ) return told;

  // What giving the condition sets off for both units
  const moments = conditionMoments({
    giver,
    target: { ...unit, conditions: state },
    inflicted: told,
    distance: ((token && byToken) ? measureDistance(token, byToken) : null) ?? 1
  });
  for ( const { to, change } of moments.grants ) await grantUnit((to === "target") ? actor : by, [change]);

  // HP the unit that inflicted it regains for that
  if ( by && (moments.recover > 0) ) await healUnit(by, moments.recover);
  for ( const back of moments.returned ) {
    pop(actor, [{ text: back.skill, tone: "skill" }]);
    await afflictUnit(by, back.id, { turns: back.turns, keep: true, returned: true, token: byToken });
  }

  // What the skills of the unit that inflicted it do to the units around the one afflicted
  if ( by && byToken && token && moments.spreads?.length ) {
    try {
      const { castSpread } = await import("./spread.mjs");
      for ( const { skill, spread } of moments.spreads ) await castSpread(byToken, { skill, spread, foe: token, inflicted: told });
    } catch(err) {
      console.error(err);
    }
  }
  return told;
}

/* -------------------------------------------- */

/**
 * A status is about to be put on a unit by something other than the system, such as the status palette of a
 * token: a condition goes the way of every other condition put on by hand instead.
 * @param {ActiveEffect} effect
 * @param {object} data
 * @param {object} options
 * @returns {boolean}     False once the condition has been taken over
 */
export function onPreCreateEffect(effect, data, options) {
  const actor = effect?.parent;
  if ( (actor?.documentName !== "Actor") || (actor.type !== "unit") || options?.[FEO.id]?.settled ) return true;
  const ids = Array.from(effect.statuses ?? []).filter((id) => conditionConfig(id) && !conditionConfig(id).combatOnly);
  if ( !ids.length ) return true;
  const by = selectedOther(actor);
  (async () => {
    for ( const id of ids ) await afflictUnit(actor, id, { by: by?.actor ?? null, byToken: by?.token ?? null, down: true });
  })().catch((err) => console.error(err));
  return false;
}

/* -------------------------------------------- */

/**
 * A condition has gone from a unit, however that came about: what was left on the unit for as long as that
 * condition lasts goes with it. Runs for the user who took it off.
 * @param {ActiveEffect} effect
 * @param {object} options
 * @param {string} userId
 * @returns {Promise<string[]>}     The names of the changes that ended
 */
export async function onDeleteEffect(effect, options, userId) {
  const actor = effect?.parent;
  if ( (userId !== game.user.id) || (actor?.documentName !== "Actor") || (actor.type !== "unit") ) return [];
  if ( !Array.from(effect.statuses ?? []).some((id) => conditionConfig(id)) ) return [];
  const list = timedOf(actor);
  if ( !list.some((change) => change.while) ) return [];
  const left = readConditions(actor.effects.filter((other) => other.id !== effect.id));
  const { list: kept, ended, changed } = endWith(list, left);
  if ( changed ) await actor.update({ "system.timed": kept });
  return ended.map((change) => change.name);
}

/* -------------------------------------------- */

/**
 * Give a unit the conditions its skills say it always has, if it has them no longer.
 * @param {Actor} actor
 * @returns {Promise<string[]>}     The conditions it was given
 */
export async function keepConditions(actor) {
  if ( (actor?.type !== "unit") || !actor.isOwner || actor.system.defeat?.out ) return [];
  const ids = keptConditions(actor.system.skills?.bends ?? null, actor.system.conditions ?? {});
  if ( ids.length ) await setConditions(actor, Object.fromEntries(ids.map((id) => [id, conditionConfig(id).turns])));
  return ids;
}

/* -------------------------------------------- */
/*  Uses and Notes                              */
/* -------------------------------------------- */

/**
 * A skill of a unit has taken effect outside of a fight, as one that reacts to an enemy does: its use is
 * counted and its cooldown starts, as for any skill that takes effect by itself.
 * @param {Actor|null} actor
 * @param {string} itemId     The skill
 * @returns {Promise<boolean>}    Whether it was counted
 */
export async function spendFor(actor, itemId) {
  if ( actor?.type !== "unit" ) return false;
  if ( !actor.isOwner ) return !!(await handOver("spend", actor, { item: itemId }));
  const item = actor.items.get(itemId);
  if ( (item?.type !== "skill") || !item.system.usage?.kind ) return false;
  const { spendSkill } = await import("../rules/skill-usage.mjs");
  const { cooldownsFor } = await import("./affinity.mjs");
  await item.update({ "system.state": spendSkill(item.system.usage, item.system.state, { cooldowns: cooldownsFor(actor, item) }) });
  return true;
}

/* -------------------------------------------- */

/** What can be noted on a unit this way: what it has reacted to this turn, and the traps it has lying. */
const NOTES = ["reacted", "traps"];

/**
 * Note something on a unit that the map keeps for it: what it has reacted to since its turn last started, the
 * traps it has lying. Nothing else can be noted this way.
 * @param {Actor|null} actor
 * @param {string} key        "reacted" or "traps"
 * @param {object|object[]|null} value      Plain data; null to forget it
 * @returns {Promise<boolean>}
 */
export async function noteFor(actor, key, value) {
  if ( (actor?.type !== "unit") || !NOTES.includes(key) ) return false;
  if ( !actor.isOwner ) return !!(await handOver("note", actor, { key, value }));
  let plain = null;
  try {
    plain = (value === null) || (value === undefined) ? null : JSON.parse(JSON.stringify(value));
  } catch(err) {
    return false;
  }
  if ( (plain !== null) && ((typeof plain !== "object") || (JSON.stringify(plain).length > 20000)) ) return false;
  if ( plain === null ) await actor.unsetFlag(FEO.id, key);
  else await actor.update({ [`flags.${FEO.id}.${key}`]: plain }, { diff: false, recursive: false });
  return true;
}

/* -------------------------------------------- */
/*  Lasting Changes                             */
/* -------------------------------------------- */

/**
 * Give a unit changes that last a while, on behalf of another unit's skill. A unit that negates what would be
 * put on it takes nothing from an enemy.
 * @param {Actor|null} actor
 * @param {TimedChange[]} changes
 * @param {object} [about]
 * @param {Actor|null} [about.by]     The unit whose skill grants them
 * @returns {Promise<TimedChange[]|null>}     The changes that were given; null when they could not be saved
 */
export async function grantUnit(actor, changes, about = {}) {
  if ( (actor?.type !== "unit") || !changes?.length ) return [];
  if ( !actor.isOwner ) return handOver("grant", actor, { changes, about });
  const by = about.by ?? null;

  // What the unit that gives them makes of the bonuses it gives, as an ally beside it may have it
  // What it gives itself is seen to as it is saved
  const times = (by && (by !== actor)) ? buffTimesOf(by) : 1;
  if ( times !== 1 ) changes = changes.map((change) => (change?.from && !change.mark && !change.drop) ? boostChange(change, times) : change);
  if ( by && (by !== actor) && actor.system.skills?.bends?.debuffs?.negate
    && (relationOf(armyOf(by, tokenOf(by)), armyOf(actor, tokenOf(actor))) === "enemy") ) {
    pop(actor, actor.system.skills.bends.debuffs.skills.slice(0, 1).map((text) => ({ text, tone: "skill" })));
    return [];
  }
  return grantTimed(actor, changes);
}

/* -------------------------------------------- */
/*  Defeat and Gold                             */
/* -------------------------------------------- */

/**
 * A unit has brought an enemy down by something other than an attack the system rolled: what its skills give
 * it for defeating a foe is given.
 * @param {Actor} by          The unit that did
 * @param {Actor} victim      The unit that went down
 * @param {object} [about]
 * @param {TokenDocument|null} [about.byToken]
 * @param {TokenDocument|null} [about.token]      The token of the unit that went down
 * @returns {Promise<import("../rules/events.mjs").KillMoments|null>}
 */
export async function creditKill(by, victim, about = {}) {
  if ( (by?.type !== "unit") || (victim?.type !== "unit") || (by === victim) ) return null;
  const byToken = about.byToken ?? tokenOf(by);
  const token = about.token ?? tokenOf(victim);
  if ( relationOf(armyOf(by, byToken), armyOf(victim, token)) !== "enemy" ) return null;
  if ( !by.isOwner ) return handOver("kill", by, { victim: victim.uuid });
  const killer = eventUnitOf(by, byToken);
  const foe = eventUnitOf(victim, token);
  const needed = killDice(killer, foe);
  const { results } = needed ? await rollD100(needed) : { results: [] };
  let used = 0;
  const moments = killMoments(killer, foe, () => results[used++] ?? 100, {
    distance: ((token && byToken) ? measureDistance(token, byToken) : null) ?? 1
  });
  if ( moments.goldTotal > 0 ) await awardGold(by, moments.goldTotal);
  if ( (moments.recover > 0) && !by.system.defeat?.state ) await healUnit(by, moments.recover);
  if ( moments.grants.length ) await grantTimed(by, moments.grants);

  // What its skills take from the foe it defeated (see `helpers/stealing.mjs`)
  if ( byToken && token && moments.loot?.length ) {
    try {
      const { lootFoe } = await import("./stealing.mjs");
      await lootFoe(byToken, token, moments.loot);
    } catch(err) {
      console.error(err);
    }
  }

  // What its skills raise from the foe it defeated (see `helpers/creatures.mjs`)
  if ( byToken && token && moments.raises?.length ) {
    try {
      const { raiseFor } = await import("./creatures.mjs");
      await raiseFor(byToken, token, moments.raises);
    } catch(err) {
      console.error(err);
    }
  }

  // What its skills do to the units around for that
  if ( byToken && moments.spreads?.length ) {
    try {
      const { castSpread } = await import("./spread.mjs");
      for ( const { skill, spread } of moments.spreads ) await castSpread(byToken, { skill, spread, foe: token });
    } catch(err) {
      console.error(err);
    }
  }

  // A Refresh its skills hand out for that: the allies around act again at once, and what it gives the unit
  // itself is one more go it has earned
  const acts = [...(moments.acts ?? [])];
  if ( moments.refreshes?.length ) {
    try {
      const own = await game.feo.refresh?.sideRefreshes?.(byToken, moments.refreshes, { foe: token });
      acts.push(...(own?.acts ?? []), ...(own?.moves ?? []).map((move) => ({ skill: move.skill, acts: { mov: "full" } })));
    } catch(err) {
      console.error(err);
    }
  }

  // Another go in its turn, for a unit that defeats a foe by other means than the fight it started
  if ( acts.length ) await earnGo(by, byToken, acts);
  const names = [...new Set([...moments.gold.map((entry) => entry.skill), ...moments.reminders])];
  if ( names.length ) pop(by, names.map((text) => ({ text, tone: "skill" })));
  return moments;
}

/* -------------------------------------------- */

/**
 * Give a unit gold, or take some from it.
 * @param {Actor} actor
 * @param {number} amount     Less than 0 to take gold; a unit never has less than none
 * @returns {Promise<number>} What its gold changed by
 */
export async function awardGold(actor, amount) {
  const change = Math.trunc(amount ?? 0);
  if ( (actor?.type !== "unit") || !actor.isOwner || !change ) return 0;
  const had = actor.system.gold ?? 0;
  const gold = Math.max(had + change, 0);
  if ( gold === had ) return 0;
  await actor.update({ "system.gold": gold });
  const unit = game.i18n.localize("FEO.Unit.goldUnit");
  pop(actor, [{ text: `${(gold > had) ? "+" : ""}${gold - had} ${unit}`, tone: "gold" }]);
  return gold - had;
}

/* -------------------------------------------- */
/*  What a Special Quality Builds In            */
/* -------------------------------------------- */

/** The units whose built-in skills are being brought in step right now. */
const syncing = new Set();

/**
 * Bring a unit's skills in step with its Special Qualities: it is given what they build into it (Rampart for
 * Armored, Greed for Bandit, Rouse for Beast), and what it was given that way goes with the quality.
 * @param {Actor} actor
 * @returns {Promise<{add: string[], remove: string[]}|null>}     What changed, or null for a unit that was left
 */
export async function syncBuiltIn(actor) {
  if ( (actor?.type !== "unit") || !actor.isOwner || actor.pack || syncing.has(actor.uuid) ) return null;

  // A unit that imitates another has that unit's Special Qualities, and its skills with them, for a while:
  // what its own build into it is left as it is
  if ( actor.getFlag(FEO.id, "imitation") ) return null;
  const flag = (item) => !!item.getFlag(FEO.id, "builtIn");
  const held = actor.items.filter((item) => item.type === "skill").map((item) => ({ id: item.id, name: item.name, builtIn: flag(item) }));
  const { add, remove } = builtInChanges(actor.system.specialQualities, held);
  if ( !add.length && !remove.length ) return null;
  syncing.add(actor.uuid);
  try {
    const gone = held.filter((skill) => skill.builtIn && remove.includes(skill.name)).map((skill) => skill.id);
    if ( gone.length ) await actor.deleteEmbeddedDocuments("Item", gone);
    if ( add.length ) {
      await grantSkills(actor, add.map((name) => ({ name, kind: "class" })));
      const made = actor.items.filter((item) => (item.type === "skill") && add.includes(item.name) && !flag(item));
      if ( made.length ) await actor.updateEmbeddedDocuments("Item", made.map((item) => ({ _id: item.id, [`flags.${FEO.id}.builtIn`]: true })));
    }
  } finally {
    syncing.delete(actor.uuid);
  }
  return { add, remove };
}

/* -------------------------------------------- */

/**
 * A battle begins: every unit in it has what its Special Qualities build into it, and the conditions its
 * skills say it always has. Runs for the user who begins the encounter.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function startBattleEvents(combat) {
  const seen = new Set();
  for ( const combatant of combat?.combatants ?? [] ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || seen.has(actor) || !actor.isOwner ) continue;
    seen.add(actor);
    await syncBuiltIn(actor);
    await keepConditions(actor);
  }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register what the paths of events listen for. Called once, when the system starts.
 */
export function registerHooks() {
  // What a unit loses or regains is floated over its tokens for everyone: its own HP, and the temporary HP
  // the changes that last on it hold for it, which are noted before those changes are saved
  const noteTemp = (actor, changes, options) => {
    if ( (actor?.type !== "unit") || !options || !foundry.utils.hasProperty(changes, "system.timed") ) return;
    (options[TEMP_BEFORE] ??= {})[actor.uuid] = actor.system.hp?.temp ?? 0;
  };
  Hooks.on("preUpdateActor", noteTemp);
  Hooks.on("preUpdateActorDelta", (delta, changes, options) => noteTemp(delta.syntheticActor, changes, options));
  Hooks.on("updateActor", (actor, changed, options) => showHp(actor, changed, options));
  Hooks.once("ready", () => {
    game.socket?.on(SOCKET, async (message) => {
      if ( (message?.type !== "unit.pop") || !Array.isArray(message.lines) ) return;
      const actor = await foundry.utils.fromUuid(message.actor).catch(() => null);
      const lines = message.lines.slice(0, 6).map((line) => ({ text: String(line?.text ?? "").slice(0, 60), tone: line?.tone, seen: line?.seen === true }));
      if ( actor?.type === "unit" ) float(actor, lines.filter((line) => line.text));
    });

    // Units made before their quality built anything into them are brought in step by the Game Master's client
    if ( game.user.isActiveGM ) {
      (async () => {
        for ( const actor of game.actors ) await syncBuiltIn(actor);
      })().catch((err) => console.error(err));
    }
  });

  // HP typed into a token's bar, and a condition picked from a token's status palette, go the way of every
  // other change made by hand
  Hooks.on("modifyTokenAttribute", onModifyTokenAttribute);
  Hooks.on("preCreateActiveEffect", onPreCreateEffect);
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    onDeleteEffect(effect, options, userId).catch((err) => console.error(err));
  });

  // A unit that gains or loses a Special Quality gains or loses what the quality builds into it
  Hooks.on("createActor", (actor, options, userId) => {
    if ( userId === game.user.id ) syncBuiltIn(actor).catch((err) => console.error(err));
  });
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( (userId !== game.user.id) || !foundry.utils.hasProperty(changed, "system.specialQualities") ) return;
    syncBuiltIn(actor).catch((err) => console.error(err));
  });
}

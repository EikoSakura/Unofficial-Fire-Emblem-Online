import { FEO } from "../config.mjs";
import { exchangeWounds, fateReasons, hpTransition } from "../rules/defeat.mjs";
import { earnerOf, expSources, scaleExp } from "../rules/earnings.mjs";
import { activationExp } from "../rules/optional.mjs";
import { exchangeExp, gainExp } from "../rules/experience.mjs";
import { gaugeAfterCombat } from "../rules/shifting.mjs";
import { spareLines } from "./defeat-context.mjs";
import { expTimes } from "./earnings-context.mjs";

/**
 * What follows from an exchange beyond HP, weapon uses and conditions: experience, Wounds, a unit going down,
 * and what the fight does to a Shift Gauge or a stone. Nothing here touches Foundry, so that it can be tested
 * outside of it; strings are localized through whatever `i18n` is passed in.
 *
 * @import {Combatant, ExchangePlan, ExchangeResult} from "../rules/combat.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * @typedef UnitRecord
 * What the rules after an exchange need to know about a unit, carried on its Combatant as `record`.
 * @property {number} level
 * @property {number} exp
 * @property {string} [affinity]                          Its Affinity, for one that gives experience
 * @property {boolean} [affinityAlways]                   Does its Affinity count whatever the world plays with?
 * @property {number} hpBase                              Maximum HP before Wounds and Injuries
 * @property {number} injuries
 * @property {number} graveWounds
 * @property {import("../rules/defeat.mjs").DefeatState} defeat
 * @property {{mode: string|null, value: number, active: boolean, fought: {own: number, other: number},
 *   uses: number, left: number, limit: number, profile: object}} shift
 */

/**
 * @typedef Aftermath
 * @property {import("../rules/experience.mjs").ExpAward & {total: number, ready: boolean, base?: number,
 *   times?: number, sources?: {skill: string, times: number}[]}|null} exp
 *           Experience earned, or null for a unit that earns none. When skills multiplied it: what it was
 *           before (`base`), by how much (`times`) and which skills did
 * @property {number} wounds                Wounds caused by the hits the unit took
 * @property {object[]} [spared]            What was rolled to spare it those Wounds (see `saveHarm` in
 *                                          `rules/events.mjs`), set by whoever rolls the fight
 * @property {{event: string, turns: number, fate: string[]}|null} defeat   Set when the unit went down
 * @property {object|null} shift            What the fight did to the unit's Shift Gauge or stone
 */

const SIDES = ["initiator", "defender"];

/**
 * Describe a unit for the rules that follow an exchange.
 * @param {Actor} actor
 * @returns {UnitRecord}
 */
export function recordOf(actor) {
  const system = actor.system;
  const shift = system.shift ?? {};
  return {
    level: system.level,
    exp: system.exp,
    affinity: system.affinity ?? "",
    affinityAlways: !!system.glory?.extras?.resonance,
    hpBase: system.hp.base ?? system.hp.max,
    injuries: system.injuries,
    graveWounds: system.graveWounds ?? 0,
    defeat: { state: system.defeat?.state ?? "", turns: system.defeat?.turns ?? 0, paused: system.defeat?.paused ?? false },
    shift: {
      mode: shift.mode ?? null,
      value: shift.value ?? 0,
      active: shift.active ?? false,
      fought: { own: shift.fought?.own ?? 0, other: shift.fought?.other ?? 0 },
      uses: shift.uses ?? 0,
      left: shift.left ?? 0,
      limit: shift.limit ?? 0,
      profile: shift.profile ?? {},

      // What the unit's skills change: a stone that never runs out, and fights started in humanoid form
      endless: !!shift.bends?.endless,
      humanFight: shift.bends?.humanFight ?? null
    }
  };
}

/* -------------------------------------------- */

/**
 * Work out what follows from an exchange for each unit.
 * @param {ExchangePlan} plan       A plan whose units carry a `record`
 * @param {ExchangeResult} result
 * @param {object} [options]
 * @param {{initiator?: boolean, defender?: boolean}} [options.earns]   Which sides earn experience
 * @param {{initiator?: {name: string, exp: number}|null, defender?: {name: string, exp: number}|null}} [options.heirs]
 *          For a side whose experience goes to another unit, as a summoned unit's goes to its summoner: that
 *          unit's name and the experience it has
 * @returns {{initiator: Aftermath, defender: Aftermath}}
 */
export function exchangeAftermath(plan, result, { earns = {}, heirs = {} } = {}) {
  const record = (side) => plan[side].unit.record ?? {};
  const fought = result.attacks.length > 0;
  const awards = exchangeExp(plan, result, { initiator: record("initiator").level, defender: record("defender").level });
  const wounds = exchangeWounds(result, { initiator: record("initiator").hpBase, defender: record("defender").hpBase });

  const one = (side) => {
    const unit = plan[side].unit;
    const info = record(side);
    const outcome = result[side];
    const aftermath = { exp: null, wounds: 0, defeat: null, shift: null };

    // A unit whose skill ended the fight early may earn nothing from it
    const forgone = (result.fled?.side === side) && !!result.fled.forgoExp;
    if ( earns[side] && fought && !forgone ) {
      // Skills of the unit, and of the units around it, can multiply what it earns
      const earner = earnerOf(unit);

      // An Affinity gives experience for the unit's own Skills that rolled to activate and did, as Emblem does
      const sparked = activationExp(info.affinity, outcome.sparked ?? [], info.affinityAlways ? { config: { ...FEO.optional.affinityEffects, enabled: true } } : {});
      const scaled = scaleExp(awards[side].amount + sparked, expSources(earner.skills, earner.self));
      // What a summoned unit earns is added to what its summoner has
      const heir = heirs[side] ?? null;
      const { exp, ready } = gainExp(heir ? heir.exp : info.exp, scaled.amount);
      aftermath.exp = { ...awards[side], amount: scaled.amount, total: exp, ready };
      if ( sparked > 0 ) aftermath.exp.sparked = { amount: sparked, skills: outcome.sparked.length };
      if ( heir ) aftermath.exp.to = heir.name;
      if ( scaled.sources.length && (scaled.base > 0) ) Object.assign(aftermath.exp, { base: scaled.base, times: scaled.times, sources: scaled.sources });
    }

    if ( Number.isFinite(unit.resilience) && info.defeat ) {
      aftermath.wounds = wounds[side].wounds;
      const profile = {
        hpMax: info.hpBase,
        resilience: unit.resilience ?? 0,
        graveWounds: info.graveWounds,
        injuries: info.injuries,
        defeat: info.defeat
      };
      const change = hpTransition(profile, outcome.hpStart, outcome.hp);
      if ( change?.event === "down" ) {
        aftermath.defeat = {
          event: "down",
          turns: change.defeat.turns,
          fate: fateReasons({ ...profile, hp: outcome.hp, defeat: change.defeat })
        };
      }
      else if ( info.defeat.state === "incapacitated" ) {
        const fate = fateReasons({ ...profile, hp: outcome.hp });
        if ( fate.length ) aftermath.defeat = { event: "struck", turns: info.defeat.turns, fate };
      }
    }

    const shift = info.shift;
    if ( fought && (shift?.mode === "gauge") ) {
      // Points a skill gave the gauge during the fight are counted before what the fight itself does to it
      const charged = (result.charged ?? []).filter((entry) => entry.by === side);
      const after = gaugeAfterCombat(shift, shift.profile, {
        initiated: side === "initiator",
        humanFight: shift.humanFight ?? null,
        gained: charged.reduce((sum, entry) => sum + entry.amount, 0)
      });
      aftermath.shift = { mode: "gauge", from: shift.value, ...after };
      if ( charged.length ) aftermath.shift.charged = charged.map((entry) => ({ skill: entry.skill, amount: entry.amount }));
    }
    else if ( fought && (shift?.mode === "stone") && (shift.left > 0) && !shift.endless ) {
      aftermath.shift = { mode: "stone", uses: shift.uses + 1, limit: shift.limit };
    }
    return aftermath;
  };
  return Object.fromEntries(SIDES.map((side) => [side, one(side)]));
}

/* -------------------------------------------- */

/**
 * Add what follows from an exchange to the changes it saves.
 * @param {{initiator: object, defender: object}} changes     As `exchangeChanges` returns them
 * @param {{initiator: Aftermath, defender: Aftermath}} aftermath
 * @returns {{initiator: object, defender: object}}           The same changes, added to
 */
export function aftermathChanges(changes, aftermath) {
  for ( const side of SIDES ) {
    const after = aftermath[side];
    const change = changes[side];
    // Experience that goes to another unit is saved on that unit, by whoever saves the changes
    if ( (after.exp?.amount > 0) && !after.exp.to ) change.exp = after.exp.amount;
    if ( after.wounds > 0 ) change.wounds = after.wounds;
    if ( after.shift?.mode === "gauge" ) {
      change.shift = { value: after.shift.value, active: after.shift.active, fought: after.shift.fought };
    }
    else if ( after.shift?.mode === "stone" ) change.shift = { uses: after.shift.uses + (change.transforms ?? 0) };

    // Transformations a unit gave up for damage are counted with the one the fight used, and nowhere else
    delete change.transforms;
  }
  return changes;
}

/* -------------------------------------------- */

/**
 * The lines an exchange card shows for what follows from the exchange.
 * @param {ExchangePlan} plan
 * @param {{initiator: Aftermath, defender: Aftermath}} aftermath
 * @param {Localizer} i18n
 * @returns {{notable: {label: string, cls: string}[], details: {label: string, value: string}[],
 *   down: Record<string, boolean>}}    `down` names the sides whose defeat is already told here
 */
export function aftermathLines(plan, aftermath, i18n) {
  const notable = [];
  const details = [];
  const down = {};

  for ( const side of SIDES ) {
    const name = plan[side].unit.name;
    const after = aftermath[side];

    if ( after.defeat?.event === "down" ) {
      down[side] = true;
      notable.push({
        label: i18n.format(after.defeat.turns === 1 ? "FEO.Defeat.downTurn" : "FEO.Defeat.downTurns", {
          name,
          turns: after.defeat.turns
        }),
        cls: "bad"
      });
    }
    if ( after.defeat?.fate.length ) notable.push({
      label: i18n.format("FEO.Defeat.fateDue", {
        name,
        reason: after.defeat.fate.map((reason) => i18n.localize(`FEO.Defeat.reason.${reason}`)).join(", ")
      }),
      cls: "bad"
    });
    if ( after.wounds > 0 ) notable.push({
      label: i18n.format(after.wounds === 1 ? "FEO.Defeat.wound" : "FEO.Defeat.wounds", { name, count: after.wounds }),
      cls: "bad"
    });

    // A Wound a skill spared the unit is told where the Wound would have been, with its roll; a roll that
    // failed is among the details
    const spared = after.spared ?? [];
    notable.push(...spareLines(spared.filter((entry) => entry.success), name, i18n));
    for ( const entry of spared.filter((roll) => !roll.success) ) details.push({
      label: `${name} · ${entry.skill}`,
      value: spareLines([entry], name, i18n)[0].label
    });

    if ( after.exp ) {
      const { amount, reason, total, ready } = after.exp;

      // A summoned unit's experience is its summoner's, and is told of as that
      const earner = after.exp.to ?? name;
      if ( amount > 0 ) notable.push({
        label: i18n.format(ready ? "FEO.Exp.gainsReady" : "FEO.Exp.gains", { name: earner, amount }),
        cls: "gold"
      });

      // Why, and what skills multiplied it by
      const times = expTimes(after.exp, i18n);
      const sparked = after.exp.sparked ? i18n.format("FEO.Exp.activations", after.exp.sparked) : "";
      const why = [i18n.localize(`FEO.Exp.reason.${reason}`), sparked].filter(Boolean).join(", ");
      if ( (amount > 0) || (reason !== "none") ) details.push({
        label: `${earner} · ${i18n.localize("FEO.Unit.exp")}`,
        value: i18n.format("FEO.Exp.detail", {
          amount,
          reason: times ? `${why}, ${times}` : why,
          total,
          next: FEO.expPerLevel
        })
      });
    }

    const shift = after.shift;
    if ( shift?.mode === "gauge" ) {
      for ( const entry of shift.charged ?? [] ) {
        notable.push({ label: i18n.format("FEO.Shift.gained", { name, amount: entry.amount, skill: entry.skill }), cls: "cond" });
      }
      if ( shift.reverted ) notable.push({ label: i18n.format("FEO.Shift.revertsNamed", { name }), cls: "cond" });
      const told = shift.partial ? "FEO.Shift.gaugeChangeHuman" : shift.first ? "FEO.Shift.gaugeChange" : "FEO.Shift.gaugeChangeLater";
      details.push({
        label: `${name} · ${i18n.localize("FEO.Shift.gauge")}`,
        value: i18n.format(told, {
          from: shift.from,
          to: shift.value,
          max: FEO.shift.gauge.max,
          share: plan[side].unit.record?.shift?.humanFight ?? 100
        })
      });
    }
    else if ( shift?.mode === "stone" ) details.push({
      label: `${name} · ${i18n.localize("FEO.Shift.transforms")}`,
      value: i18n.format("FEO.Shift.usesOf", { used: shift.uses, limit: shift.limit })
    });
  }
  return { notable, details, down };
}

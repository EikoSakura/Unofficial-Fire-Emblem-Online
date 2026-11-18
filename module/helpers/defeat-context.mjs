import { FEO } from "../config.mjs";

/**
 * Display data for defeat: the chat cards posted when a unit goes down, gets back up, runs out of time or is
 * treated. Nothing here touches Foundry, so that it can be tested outside of it; strings are localized through
 * whatever `i18n` is passed in.
 *
 * @import {ChatCard} from "./chat.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * The line that tells a unit it must choose, with the reasons why.
 * @param {string[]} fate
 * @param {Localizer} i18n
 * @returns {string}
 */
function fateNote(fate, i18n) {
  const reasons = fate.map((reason) => i18n.localize(`FEO.Defeat.reason.${reason}`)).join(", ");
  return i18n.format("FEO.Defeat.fateNote", { reason: reasons });
}

/* -------------------------------------------- */

/**
 * The lines that tell of the chances a unit's skills gave it to take no Wound, or no Injury (see `saveHarm`
 * in `rules/events.mjs`): one for each roll, as the skill, the roll against its chance and what came of it.
 * @param {{skill: string, roll: number|null, chance: number, success: boolean, sure?: boolean, foils: string}[]} rolls
 * @param {string} name       The unit's name
 * @param {Localizer} i18n
 * @returns {{label: string, cls: string}[]}
 */
export function spareLines(rolls, name, i18n) {
  return (rolls ?? []).map((entry) => {
    const key = `FEO.Defeat.spared.${entry.foils}${entry.sure ? "Sure" : entry.success ? "" : "Fail"}`;
    return { label: i18n.format(key, { skill: entry.skill, roll: entry.roll ?? "", chance: entry.chance, name }), cls: entry.success ? "good" : "" };
  });
}

/* -------------------------------------------- */

/**
 * Build the card for a unit whose skills spared it a Wound outside of a fight, or tried to.
 * @param {string} name
 * @param {Parameters<typeof spareLines>[0]} rolls
 * @param {Localizer} i18n
 * @returns {ChatCard}
 */
export function buildSpareCard(name, rolls, i18n) {
  const lines = spareLines(rolls, name, i18n);
  const spared = lines.filter((line) => line.cls);
  const failed = lines.filter((line) => !line.cls);
  const head = spared[0] ?? failed.shift();
  return {
    title: name,
    subtitle: i18n.localize("FEO.Defeat.spared.title"),
    outcome: head ? { label: head.label, cls: head.cls } : undefined,
    rows: [],
    note: [...spared.slice(1), ...failed].map((line) => line.label).join(" ") || undefined
  };
}

/* -------------------------------------------- */

/**
 * Build the card for something that happened to a unit's defeat state.
 * @param {"down"|"recovered"|"paused"|"resumed"|"tick"|"spent"|"retreated"|"dead"|"returned"} event
 * @param {object} data
 * @param {string} data.name          The unit's name
 * @param {number} [data.turns]       Turns of Incapacitation left
 * @param {number} [data.injuries]    Injuries the unit now has
 * @param {number} [data.hp]          The unit's HP
 * @param {string[]} [data.fate]      Why the unit must now choose, if it must
 * @param {object[]} [data.spared]    What was rolled to spare it the Injury of recovering (see `spareLines`)
 * @param {Localizer} i18n
 * @returns {ChatCard}
 */
export function buildDefeatCard(event, { name, turns = 0, injuries = 0, hp = 0, fate = [], spared = [] }, i18n) {
  const rows = [];
  const turnsRow = () => rows.push({ label: i18n.localize("FEO.Defeat.turnsLeft"), value: turns, cls: turns ? "" : "bad" });
  let outcome;
  let note;

  switch ( event ) {
    case "down":
      outcome = { label: i18n.localize("FEO.Defeat.incapacitated"), cls: "bad" };
      turnsRow();
      if ( hp < 0 ) rows.push({ label: i18n.localize("FEO.Stat.hp.abbr"), value: hp });
      note = i18n.localize("FEO.Defeat.downNote");
      break;
    case "recovered":
      outcome = { label: i18n.localize("FEO.Defeat.recovered"), cls: "good" };
      // The roll of a skill that may spare it the Injury stands where the Injury is told of
      for ( const entry of spared ) rows.push({
        label: entry.skill,
        value: entry.sure ? "" : `${entry.roll} / ${entry.chance}`,
        cls: entry.success ? "good" : ""
      });
      rows.push({ label: i18n.localize("FEO.Health.injuries"), value: injuries, cls: spared.some((entry) => entry.success) ? "" : "bad" });
      note = spared.some((entry) => entry.success)
        ? spareLines(spared.filter((entry) => entry.success), name, i18n)[0].label
        : i18n.format("FEO.Defeat.recoveredNote", { penalty: FEO.injuryPenalty });
      break;
    case "paused":
      outcome = { label: i18n.localize("FEO.Defeat.paused"), cls: "" };
      turnsRow();
      note = i18n.localize("FEO.Defeat.pausedNote");
      break;
    case "resumed":
      outcome = { label: i18n.localize("FEO.Defeat.resumed"), cls: "" };
      turnsRow();
      break;
    case "tick":
      outcome = { label: i18n.localize("FEO.Defeat.incapacitated"), cls: "bad" };
      turnsRow();
      break;
    case "spent":
      outcome = { label: i18n.localize("FEO.Defeat.spent"), cls: "" };
      turnsRow();
      note = i18n.localize("FEO.Defeat.spentNote");
      break;
    case "retreated":
      outcome = { label: i18n.localize("FEO.Defeat.state.retreated"), cls: "" };
      note = i18n.localize("FEO.Defeat.retreatedNote");
      break;
    case "dead":
      outcome = { label: i18n.localize("FEO.Defeat.state.dead"), cls: "bad" };
      break;
    case "returned":
      outcome = { label: i18n.localize("FEO.Defeat.returned"), cls: "good" };
      break;
  }

  if ( fate.length ) note = fateNote(fate, i18n);
  return { title: name, subtitle: i18n.localize("FEO.Defeat.title"), outcome, rows, note };
}

/* -------------------------------------------- */

/**
 * Build the card for a Medicine check to heal Wounds and Injuries.
 * @param {object} data
 * @param {string} data.healer
 * @param {string} data.patient
 * @param {number} data.roll                                        The d100
 * @param {number} data.medicine                                    The healer's Medicine bonus
 * @param {ReturnType<import("../rules/defeat.mjs").treat>} data.result
 * @param {Localizer} i18n
 * @returns {ChatCard}
 */
export function buildTreatCard({ healer, patient, roll, medicine, result }, i18n) {
  const rows = [{
    label: i18n.localize("FEO.Ability.medicine"),
    value: i18n.format("FEO.Treat.roll", { roll, bonus: medicine, total: result.total })
  }];
  const part = (kind, outcome) => {
    if ( !outcome ) return;
    rows.push({
      label: i18n.localize(`FEO.Health.${kind}`),
      value: outcome.success
        ? i18n.format("FEO.Treat.healed", { dc: outcome.dc, healed: outcome.healed, left: outcome.left })
        : i18n.format("FEO.Treat.failed", { dc: outcome.dc }),
      cls: outcome.success ? "good" : "bad"
    });
  };
  part("wounds", result.wounds);
  part("injuries", result.injuries);
  const healed = (result.wounds?.healed ?? 0) + (result.injuries?.healed ?? 0);
  return {
    title: i18n.format("FEO.Treat.title", { healer, patient }),
    subtitle: i18n.localize("FEO.Treat.subtitle"),
    outcome: {
      label: i18n.localize(healed ? "FEO.Treat.success" : "FEO.Treat.failure"),
      cls: healed ? "good" : "bad"
    },
    rows
  };
}

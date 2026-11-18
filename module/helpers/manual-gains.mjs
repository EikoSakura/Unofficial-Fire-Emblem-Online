import { FEO } from "../config.mjs";
import { gainRows, planGains, rollGrowths } from "../rules/progression.mjs";
import { rollD100 } from "./chat.mjs";
import { rerollFailed } from "./earnings.mjs";
import { standsAt } from "./level-up.mjs";

/**
 * Manual Stat Gains, as a level up happens in Foundry: rolling the growth rates where the reading in use still
 * rolls them, asking where the points go, and telling the level up what each stat gains. What a stat may take
 * is decided by the pure rules in `rules/progression.mjs`.
 *
 * @import {GainRow, GrowthResult} from "../rules/progression.mjs"
 */

const TEMPLATE = `systems/${FEO.id}/templates/dialog/manual-gains.hbs`;

/**
 * What the dialog shows for each stat.
 * @param {GainRow[]} rows
 * @param {object} system     The unit's prepared data
 * @returns {object[]}
 */
export function buildGainRows(rows, system) {
  return rows.map((row) => ({
    ...row,
    label: FEO.growths[row.key],
    value: standsAt(system, row.key),
    note: row.capped ? "FEO.LevelUp.atCap"
      : row.all ? "FEO.Optional.manualGains.dialog.all"
        : (row.proc && (row.most > 1)) ? "FEO.Optional.manualGains.dialog.opened"
          : (row.proc && (row.per > 1)) ? "FEO.Optional.manualGains.dialog.doubled" : ""
  }));
}

/* -------------------------------------------- */

/**
 * Bring the dialog to life: keeping the tally of points current, and holding the button until they add up.
 * @param {HTMLElement} element     The dialog's element
 * @param {GainRow[]} rows
 */
function activate(element, rows) {
  const root = element.querySelector(".feo-manual-gains");
  if ( !root || root.dataset.live ) return;
  root.dataset.live = "true";
  const form = root.closest("form");
  const confirm = element.querySelector('button[data-action="level"]');
  const tally = root.querySelector("[data-tally]");
  const list = root.querySelector("[data-problems]");
  const refresh = () => {
    const points = Math.max(Math.trunc(root.querySelector('input[name="points"]')?.valueAsNumber) || 0, 0);
    const spend = {};
    for ( const input of root.querySelectorAll("input[data-gain]") ) spend[input.dataset.gain] = input.valueAsNumber;
    const plan = planGains(rows, spend, points);
    tally.textContent = game.i18n.format("FEO.Optional.manualGains.dialog.tally", { spent: plan.spent, points });
    tally.classList.toggle("bad", !plan.valid);
    list.replaceChildren(...plan.problems.map((problem) => {
      const item = document.createElement("li");
      item.textContent = game.i18n.format(`FEO.Optional.manualGains.dialog.problem.${problem.code}`, {
        stat: problem.key ? game.i18n.localize(FEO.growths[problem.key]) : "",
        points
      });
      return item;
    }));
    if ( confirm ) confirm.disabled = !plan.valid;
  };
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  refresh();
}

/* -------------------------------------------- */

/**
 * The growth part of a level up with Manual Stat Gains: the growth rates are rolled where the reading in use
 * rolls them, and the player places the level's points.
 * @param {Actor} actor
 * @param {string[]} capped     The stats at their cap
 * @returns {Promise<{results: GrowthResult[], rows: {label: string, value: string, cls: string}[], rolls: Roll[]}|null>}
 *          What each stat gains, in the shape of growth rolls; the rows for the level-up card; and the dice that
 *          were rolled. Null if the level up was called off, which only a reading without dice allows
 */
export async function manualLevelUp(actor, capped) {
  const config = FEO.optional.manualGains;
  const system = actor.system;
  const i18n = game.i18n;
  const keys = Object.keys(FEO.growths);
  const rates = system.growthRates ?? system.growths;
  const rolls = [];

  // Where growth rates still count they are rolled first: one that comes up opens its stat, or doubles its point
  let rolled = null;
  if ( config.mode !== "points" ) {
    const { roll, results } = await rollD100(keys.length - capped.filter((key) => keys.includes(key)).length);
    rolls.push(roll);
    const queue = results.slice();
    const again = await rerollFailed(actor, rollGrowths(rates, capped, () => queue.shift()));
    if ( again.roll ) rolls.push(again.roll);
    rolled = again.results;
  }
  const procs = (rolled ?? []).filter((result) => result.gain > 0).map((result) => result.key);
  const rows = gainRows(keys, { capped, procs, mode: config.mode, all: config.all });

  const content = document.createElement("div");
  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    rows: buildGainRows(rows, system),
    points: config.points,
    isGM: game.user.isGM,
    lead: `FEO.Optional.manualGains.dialog.lead.${config.mode}`
  });
  content.innerHTML = `<div class="feo-class-dialog feo-promotion feo-manual-gains">${html}</div>`;

  // Once dice have been rolled the level up is seen through: closing the dialog only brings it back
  let answer = null;
  do {
    answer = await foundry.applications.api.DialogV2.wait({
      window: { title: i18n.format("FEO.Optional.manualGains.dialog.title", { name: actor.name, level: system.level + 1 }) },
      position: { width: 520 },
      content: content.cloneNode(true),
      buttons: [{
        action: "level", label: "FEO.LevelUp.button", icon: "fa-solid fa-angles-up", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      }],
      rejectClose: false,
      render: (event, app) => activate(app.element, rows)
    });
    if ( !answer && rolled ) ui.notifications.warn("FEO.Optional.manualGains.dialog.finish", { localize: true });
  } while ( !answer && rolled );
  if ( !answer ) return null;

  const points = game.user.isGM ? Math.max(Math.trunc(answer.points) || 0, 0) : config.points;
  const spend = Object.fromEntries(rows.map((row) => [row.key, answer[`gain.${row.key}`]]));
  const plan = planGains(rows, spend, points);
  const gains = plan.valid ? plan.gains : {};

  // What each stat gains, in the shape of the growth rolls a level up otherwise makes
  const results = rows.map((row) => {
    const found = rolled?.find((result) => result.key === row.key);
    return { key: row.key, growth: rates[row.key] ?? 0, roll: found?.roll ?? null, gain: gains[row.key] ?? 0, capped: row.capped };
  });
  const cardRows = [];
  for ( const row of rows ) {
    const label = i18n.localize(FEO.growths[row.key]);
    const found = rolled?.find((result) => result.key === row.key);
    const gain = gains[row.key] ?? 0;
    if ( row.capped ) cardRows.push({ label, value: i18n.localize("FEO.LevelUp.atCap"), cls: "muted" });
    else if ( gain || row.proc ) {
      const parts = [];
      if ( found && row.proc ) parts.push(i18n.format("FEO.Optional.manualGains.card.roll", { roll: found.roll, growth: found.growth }));
      parts.push(gain ? i18n.format("FEO.Optional.manualGains.card.gain", { gain }) : i18n.localize("FEO.Optional.manualGains.card.unused"));
      cardRows.push({ label, value: parts.join(" · "), cls: gain ? "good" : "muted" });
    }
  }
  if ( plan.left > 0 ) cardRows.push({
    label: i18n.localize("FEO.Optional.manualGains.card.pointsLabel"),
    value: i18n.format("FEO.Optional.manualGains.card.left", { left: plan.left }),
    cls: "muted"
  });
  return { results, rows: cardRows, rolls };
}

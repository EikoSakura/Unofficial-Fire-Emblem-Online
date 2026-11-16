import { FEO } from "../config.mjs";
import { canAssign, gambitBudget, planGambit, replenished, resolveGambit } from "../rules/battalions.mjs";
import { battalionData, buildGambitCard, buildTakeChoices, gambitChanges, gambitForecast, gambitUnitOf } from "./battalion-context.mjs";
import { postCard, rollD100, rollFromResults } from "./chat.mjs";
import { applyChanges, incapacitates, measureDistance } from "./exchange.mjs";
import { takeAction } from "./phases.mjs";
import { staggerStops } from "./stagger.mjs";

/**
 * Battalions & Gambits in Foundry: the Battalion a unit commands, assigning one and standing it down again,
 * using its Gambit on the units that are targeted, and replenishing it between battles.
 */

/**
 * The Battalion a unit commands, where the world plays with Battalions.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function battalionOf(actor) {
  if ( !FEO.optional.battalions.enabled ) return null;
  return actor.items.find((item) => (item.type === "battalion") && item.system.equipped) ?? null;
}

/* -------------------------------------------- */

/**
 * Can a unit command a Battalion it carries? It needs the Authority rank the Battalion asks for, and the
 * Special Quality of a Battalion that cannot do without it.
 * @param {Item} item
 * @returns {ReturnType<typeof canAssign>}
 */
export function assignCheck(item) {
  const system = item.actor?.system;
  return canAssign(battalionData(item), { authority: system?.authority?.rank, qualities: system?.specialQualities });
}

/* -------------------------------------------- */

/**
 * Assign a Battalion to the unit that carries it, or stand it down again. A unit commands one Battalion at a
 * time, and only one it has the Authority and the Special Quality for.
 * @param {Item} item         A Battalion a unit carries
 * @param {object} [options]
 * @param {boolean} [options.force]   Assign it whatever the unit's Authority and Special Qualities, with a
 *                                    warning, as the sheet's Edit mode does
 * @returns {Promise<boolean>}        Whether anything changed
 */
export async function assignBattalion(item, { force = false } = {}) {
  const actor = item?.actor;
  if ( !actor || (item.type !== "battalion") ) return false;
  if ( item.system.equipped ) {
    await item.update({ "system.equipped": false });
    return true;
  }
  const able = assignCheck(item);
  if ( !able.ok ) {
    const key = `FEO.Optional.battalions.cannot.${able.why}${(force && (able.why !== "off")) ? "Edit" : ""}`;
    ui.notifications.warn(game.i18n.format(key, {
      battalion: item.name,
      name: actor.name,
      needs: able.needs ? game.i18n.localize(FEO.ranks[able.needs]) : "",
      has: able.has ? game.i18n.localize(FEO.ranks[able.has]) : "",
      qualities: (able.lacks ?? []).join(", ")
    }));
    if ( !force || (able.why === "off") ) return false;
  }
  const others = actor.items.filter((other) => (other.type === "battalion") && other.system.equipped && (other !== item));
  await actor.updateEmbeddedDocuments("Item", [
    ...others.map((other) => ({ _id: other.id, "system.equipped": false })),
    { _id: item.id, "system.equipped": true }
  ]);
  return true;
}

/* -------------------------------------------- */

/**
 * Let a unit take a Battalion from the compendium: a dialog lists the Battalions its Authority and its Special
 * Qualities let it command and that it does not have yet, and the one picked is added to the unit, as it is
 * when it is bought: level 1, at full HP, assigned to nobody. The dialog is the one a Combat Art is learned in.
 * @param {Actor} actor
 * @returns {Promise<Item|null>}    The Battalion it took, if it took one
 */
export async function takeBattalion(actor) {
  const config = FEO.optional.battalions;
  const pack = game.packs.get(`${FEO.id}.${config.pack}`);
  if ( !pack ) {
    ui.notifications.warn("FEO.Optional.battalions.take.noPack", { localize: true });
    return null;
  }
  const documents = (await pack.getDocuments()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const choices = buildTakeChoices(
    documents.map((document) => ({ id: document.id, name: document.name, folder: document.folder?.name ?? "", system: document.system.toObject() })),
    {
      authority: actor.system.authority?.rank,
      qualities: actor.system.specialQualities,
      has: actor.items.filter((item) => item.type === "battalion").map((item) => item.name)
    },
    game.i18n
  );
  if ( !choices.count ) {
    ui.notifications.info("FEO.Optional.battalions.take.none", { localize: true });
    return null;
  }

  // The dialog takes its content as a bare element and copies what is inside it
  const content = document.createElement("div");
  content.innerHTML = await foundry.applications.handlebars.renderTemplate(`systems/${FEO.id}/templates/dialog/learn-art.hbs`, {
    ...choices,
    lead: game.i18n.localize("FEO.Optional.battalions.take.lead"),
    pick: game.i18n.localize("TYPES.Item.battalion")
  });
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("FEO.Optional.battalions.take.title", { name: actor.name }) },
    position: { width: 460 },
    content,
    buttons: [
      {
        action: "take", label: "FEO.Optional.battalions.take.button", icon: "fa-solid fa-flag", default: true,
        callback: (event, button) => button.form.elements.art.value
      },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const select = dialog.element.querySelector('select[name="art"]');
      const preview = dialog.element.querySelector(".art-preview");
      const show = () => preview.textContent = choices.effects[select.value] ?? "";
      select.addEventListener("change", show);
      show();
    }
  });
  const source = documents.find((document) => document.id === picked);
  if ( !source ) return null;
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  data.system.equipped = false;
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  return item ?? null;
}

/* -------------------------------------------- */

/**
 * Replenish a Battalion, as is done between battles: it is back at full HP, and its Gambit has every use
 * again.
 * @param {Item} item
 * @returns {Promise<boolean>}    Whether anything changed
 */
export async function replenishBattalion(item) {
  if ( item?.type !== "battalion" ) return false;
  const { hp, uses } = replenished(item.system);
  if ( (item.system.hp.value === hp) && (item.system.gambit.uses.value === uses) ) return false;
  await item.update({ "system.hp.value": hp, "system.gambit.uses.value": uses });
  return true;
}

/* -------------------------------------------- */

/**
 * Ask whether to use a Gambit, showing what it would do to each target.
 * @param {import("../rules/battalions.mjs").GambitPlan} plan
 * @returns {Promise<boolean>}
 */
async function confirmGambit(plan) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `systems/${FEO.id}/templates/chat/card.hbs`,
    gambitForecast(plan, game.i18n)
  );
  const answer = await foundry.applications.api.DialogV2.confirm({
    window: { title: "FEO.Optional.battalions.useGambit" },
    position: { width: 420 },
    content,
    rejectClose: false
  });
  return answer === true;
}

/* -------------------------------------------- */

/**
 * A unit uses the Gambit of the Battalion it commands on the units that are targeted. An Offensive Gambit
 * rolls to hit each of them, deals its damage and inflicts its conditions, with no answer from anybody; a
 * Support Gambit is announced with its Effect for the table to apply. Either way the Gambit spends a use, the
 * unit earns Authority EXP and its Battalion EXP, and using it is the unit's Action.
 * @param {Actor} actor                   The unit that uses the Gambit
 * @param {TokenDocument|null} token      Its token, if it has one on the scene
 * @param {Token[]} [targetTokens]        The targeted tokens. The table lays the Gambit's Target Area out by
 *                                        targeting the units it covers
 * @param {object} [options]
 * @param {(plan: object) => Promise<boolean>} [options.confirm]    Asks whether to go ahead; a dialog asks
 *                                        unless something else is given
 * @returns {Promise<ChatMessage|null>}   The message that was posted, or null if no Gambit was used
 */
export async function useGambit(actor, token, targetTokens = [], { confirm = confirmGambit } = {}) {
  // A Staggered unit cannot act
  if ( staggerStops(actor) ) return null;

  // One entry for each unit that is targeted, whatever tokens stand for it
  const targets = [];
  for ( const target of targetTokens ) {
    const unit = target?.actor;
    if ( (unit?.type !== "unit") || (unit === actor) || targets.some((entry) => entry.actor === unit) ) continue;
    targets.push({ actor: unit, token: target.document ?? null, name: target.document?.name || unit.name });
  }

  // The Gambit's Range is counted to the nearest of them, where it can be measured
  const apart = targets.map((target) => (token && target.token) ? measureDistance(token, target.token) : null)
    .filter((distance) => distance !== null);
  const makePlan = () => planGambit(
    gambitUnitOf(actor, token?.name || actor.name),
    targets.map((target) => gambitUnitOf(target.actor, target.name, { keepsDamage: incapacitates(target.actor, target.token) })),
    { distance: apart.length ? Math.min(...apart) : null }
  );
  const blocked = (plan) => {
    if ( plan.blocked ) ui.notifications.warn(`FEO.Optional.battalions.blocked.${plan.blocked}`, { localize: true });
    return !!plan.blocked;
  };
  if ( blocked(makePlan()) ) return null;
  if ( !(await confirm(makePlan())) ) return null;

  // Plan again from the units as they are now, then roll it out
  const plan = makePlan();
  if ( blocked(plan) ) return null;
  const budget = gambitBudget(plan);
  const results = budget ? (await rollD100(budget)).results : [];
  const used = [];
  const result = resolveGambit(plan, () => {
    const next = results[used.length];
    used.push(next);
    return next;
  });

  const changes = gambitChanges(plan, result);
  const unsaved = await applyChanges([
    { uuid: actor.uuid, ...changes.user },
    ...targets.map((target, index) => ({ uuid: target.actor.uuid, ...changes.targets[index] }))
  ]);
  const unapplied = [];
  if ( unsaved.includes(actor.uuid) ) unapplied.push(plan.user.name);
  for ( const target of targets ) if ( unsaved.includes(target.actor.uuid) ) unapplied.push(target.name);

  const message = await postCard(actor, buildGambitCard(plan, result, game.i18n, { unapplied }), {
    rolls: used.length ? [rollFromResults(used)] : []
  });

  // Using a Gambit is the unit's Action
  await takeAction(actor, token);
  return message;
}

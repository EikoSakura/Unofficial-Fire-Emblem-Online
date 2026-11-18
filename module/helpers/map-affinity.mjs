import { FEO } from "../config.mjs";
import { mapAffinityBonus } from "../rules/progression.mjs";

/**
 * Map Affinity: a map may have an Affinity of its own, and a unit whose Affinity is the same receives a bonus
 * to Hit and Dodge on it (see the Affinity page of the rules). The Game Master sets it from the Phase banner;
 * what it gives a unit is read where units stand (`positions.mjs`), as the weather of the map is.
 */

/** The flag of a scene that keeps its Affinity. */
export const MAP_AFFINITY_FLAG = "affinity";

/**
 * The Affinity of a scene: one of those in use in this world.
 * @param {Scene|null} scene
 * @returns {string}      A key of FEO.affinities; blank for a map without one
 */
export function mapAffinityOf(scene) {
  const key = scene?.flags?.[FEO.id]?.[MAP_AFFINITY_FLAG];
  return ((typeof key === "string") && (key in FEO.affinities)) ? key : "";
}

/* -------------------------------------------- */

/**
 * What the Affinity of a scene gives a unit, as an entry its numbers read like the auras it receives.
 * @param {Scene|null} scene
 * @param {Actor|null} actor
 * @returns {object[]}    One entry for a unit of the map's Affinity, none for any other
 */
export function mapAffinityAuras(scene, actor) {
  const bonus = mapAffinityBonus(mapAffinityOf(scene), actor?.system?.affinity ?? "", FEO.mapAffinity);
  if ( !bonus ) return [];
  const name = globalThis.game?.i18n?.localize("FEO.MapAffinity.title") ?? "Map Affinity";
  return [{
    name, skill: name, from: "", giver: "", aura: true, map: true,
    nihil: false, sourceNihil: false, inverted: false, effects: [{ combat: { ...bonus } }]
  }];
}

/* -------------------------------------------- */

/**
 * Set the Affinity of a scene. Runs for a Game Master.
 * @param {Scene} scene
 * @param {string} affinity     A key of FEO.affinities; blank for none
 * @returns {Promise<string>}   The Affinity it now has
 */
export async function setMapAffinity(scene, affinity) {
  if ( !game.user.isGM || !scene ) return mapAffinityOf(scene);
  const next = (affinity in FEO.affinities) ? affinity : "";
  if ( next ) await scene.setFlag(FEO.id, MAP_AFFINITY_FLAG, next);
  else if ( scene.flags?.[FEO.id]?.[MAP_AFFINITY_FLAG] !== undefined ) await scene.unsetFlag(FEO.id, MAP_AFFINITY_FLAG);
  return next;
}

/* -------------------------------------------- */

/**
 * The Affinity of a scene for the Phase banner: its icon, with what it gives on hover, and for a Game Master a
 * way in to change it.
 * @param {Scene|null} scene
 * @param {object} [options]
 * @param {boolean} [options.gm]              Is the user a Game Master?
 * @param {{name: string, affinity: string}|null} [options.unit]    The unit that is selected, if one is
 * @param {{localize: Function, format: Function}} i18n
 * @returns {{key: string, icon: string, label: string, tip: string, shown: boolean}}
 */
export function buildMapAffinity(scene, { gm = false, unit = null } = {}, i18n) {
  const key = mapAffinityOf(scene);
  if ( !key ) return { key: "", icon: "spark", label: i18n.localize("FEO.MapAffinity.title"), tip: i18n.localize("FEO.MapAffinity.none"), shown: gm };
  const affinity = i18n.localize(FEO.affinities[key]);
  const gains = (unit && (unit.affinity === key)) ? ` ${i18n.format("FEO.MapAffinity.gains", { name: unit.name })}` : "";
  return {
    key,
    icon: FEO.affinityIcons[key] ?? "spark",
    label: `${i18n.localize("FEO.MapAffinity.title")}: ${affinity}`,
    tip: `${i18n.format("FEO.MapAffinity.tip", { affinity, ...FEO.mapAffinity })}${gains}`,
    shown: true
  };
}

/* -------------------------------------------- */

/**
 * Have the Game Master pick the Affinity of a scene from those in use.
 * @param {Scene} scene
 * @returns {Promise<string|null>}    The Affinity it now has, blank for none; null when it was called off
 */
export async function pickMapAffinity(scene) {
  if ( !game.user.isGM || !scene ) return null;
  const now = mapAffinityOf(scene);
  const escape = foundry.utils.escapeHTML ?? ((text) => text);
  const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
  const options = [`<option value=""${now ? "" : " selected"}>${escape(loc("FEO.MapAffinity.noneOption"))}</option>`]
    .concat(Object.entries(FEO.affinities).map(([key, label]) => `<option value="${key}"${(key === now) ? " selected" : ""}>${escape(loc(label))}</option>`));
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.MapAffinity.title" },
    position: { width: 380 },
    content: `<p class="hint">${escape(loc("FEO.MapAffinity.pickHint", FEO.mapAffinity))}</p>`
      + `<div class="form-group"><label>${escape(loc("FEO.Unit.affinity"))}</label><select name="affinity">${options.join("")}</select></div>`,
    buttons: [
      { action: "set", label: "FEO.MapAffinity.set", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => String(button.form.elements.affinity?.value ?? "") },
      { action: "cancel", label: "COMMON.Cancel" }
    ],
    rejectClose: false
  });
  if ( (answer === null) || (answer === undefined) || (answer === "cancel") ) return null;
  return setMapAffinity(scene, answer);
}

/* -------------------------------------------- */

/**
 * Register what the Affinity of a map listens for. Called once, when the system starts.
 * @param {() => void} [changed]    Called once the Affinity of the scene in view has changed
 */
export function registerMapAffinity(changed = () => {}) {
  Hooks.on("updateScene", (scene, changes) => {
    const flags = changes.flags?.[FEO.id];
    if ( !flags || (scene !== globalThis.canvas?.scene) ) return;
    if ( !((MAP_AFFINITY_FLAG in flags) || (`-=${MAP_AFFINITY_FLAG}` in flags)) ) return;
    changed();
  });
}

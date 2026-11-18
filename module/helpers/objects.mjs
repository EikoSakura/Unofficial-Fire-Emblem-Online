import { FEO } from "../config.mjs";
import { actOn, actsFor, afterAct, blocksWay, isSpent, normalizeObject, yieldOf } from "../rules/objects.mjs";
import { OBJECTS_FLAG, forgetObjects, objectOn, objectsOn } from "./map-objects.mjs";
import { relationOf } from "../rules/positions.mjs";
import { keyOpens } from "../rules/stealing.mjs";
import { rangeOf } from "./battle-map.mjs";
import { postCard } from "./chat.mjs";
import { awardGold, pop } from "./events.mjs";
import { armyOf, tokenTile } from "./exchange.mjs";
import { onMap } from "./forced.mjs";
import { takeAction } from "./phases.mjs";
import { staffObjectsOf } from "./staves.mjs";
import { breakItem } from "./weapons.mjs";

/**
 * Doors, chests and Villages in Foundry (see `rules/objects.mjs`): where a scene keeps them, what a unit can
 * do with them from where it stands, and doing it.
 *
 * A scene keeps its map objects in a flag, which only a Game Master may write: whatever a player's unit does
 * with one is asked of an active Game Master, whose client does it. A Game Master places them with the terrain
 * brush (see `canvas/map-layer.mjs`) and sets what each holds in a small dialog.
 *
 * @import {MapObject, ObjectAct, ObjectUnit} from "../rules/objects.mjs"
 */

/** The name of the query that asks a Game Master to have a unit act on a map object for a player. */
export const OBJECT_QUERY = `${FEO.id}.mapObject`;

export { OBJECTS_FLAG, objectOn, objectsOn };

/** The name of the hook called once a unit has acted on a map object: with its token, the object and what it did. */
export const OBJECT_HOOK = `${FEO.id}.objectActed`;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The map objects this user is shown on a scene, each with how it stands: shut or open, whole or spent.
 * @param {Scene|null} scene
 * @returns {{tile: {i: number, j: number}, kind: string, spent: boolean, shut: boolean, hp: {value: number, max: number}|null}[]}
 */
export function objectsShown(scene) {
  return objectsOn(scene).map((object) => ({
    tile: { i: object.i, j: object.j },
    kind: object.kind,
    spent: isSpent(object),
    shut: blocksWay(object),
    ruined: object.destroyed,
    hp: ((object.kind === "door") && blocksWay(object) && (object.hp.value < object.hp.max)) ? { ...object.hp } : null
  }));
}

/* -------------------------------------------- */

/**
 * What a map object is called.
 * @param {MapObject} object
 * @returns {string}
 */
export function objectName(object) {
  if ( object.name ) return object.name;
  if ( object.kind === "door" ) return game.i18n.localize(FEO.objects.doors[object.door]?.label ?? FEO.objects.kinds.door.label);
  return game.i18n.localize(FEO.objects.kinds[object.kind].label);
}

/* -------------------------------------------- */

/**
 * A unit as the rules of map objects read it.
 * @param {TokenDocument} token
 * @param {{i: number, j: number}|null} [tile]    Another tile to stand it on
 * @returns {ObjectUnit|null}
 */
export function objectUnitOf(token, tile = null) {
  const actor = token?.actor;
  const here = tile ?? tokenTile(token);
  if ( (actor?.type !== "unit") || !here ) return null;
  const system = actor.system;
  const knacks = system.knacks ?? {};
  const keys = [];
  for ( const item of actor.items ) {
    if ( (item.type !== "gear") || item.system.spent ) continue;
    const opens = keyOpens(item.system.effect);
    if ( opens.length ) keys.push({ id: item.id, name: item.name, opens, uses: (item.system.uses.max > 0) ? item.system.uses.value : null });
  }
  const range = rangeOf(actor);
  const army = armyOf(actor, token);
  return {
    tile: { i: here.i, j: here.j },
    opens: knacks.opens ?? [],
    opensBy: knacks.skills?.opens ?? "",
    keys,
    pillages: !!knacks.pillages,
    raider: relationOf(army, "player") !== "ally",
    damage: system.combat?.damage?.value ?? 0,
    range: (range && !range.staff) ? { min: range.min, max: range.max } : null
  };
}

/* -------------------------------------------- */

/**
 * Everything on the map a unit can act on from where it stands, each with what it would do.
 * @param {TokenDocument} token
 * @returns {ObjectAct[]}
 */
export function objectActsOf(token) {
  if ( !onMap(token) ) return [];
  const objects = objectsOn(token.parent);
  if ( !objects.length ) return [];
  const unit = objectUnitOf(token);
  return unit ? actsFor(unit, objects) : [];
}

/* -------------------------------------------- */

/**
 * What a unit would do with the map object on a tile, and whether it can.
 * @param {TokenDocument} token
 * @param {{i: number, j: number}} tile
 * @returns {ObjectAct|null}      Null where no map object stands
 */
export function objectActOn(token, tile) {
  const object = objectOn(token?.parent, tile);
  const unit = object ? objectUnitOf(token) : null;
  return unit ? actOn(unit, object) : null;
}

/* -------------------------------------------- */

/**
 * In a few words, what an act on a map object comes to: for the map to say under the pointer.
 * @param {ObjectAct} act
 * @returns {string}
 */
export function describeAct(act) {
  const i18n = game.i18n;
  const name = objectName(act.object);
  if ( !act.ok ) return i18n.format(`FEO.Objects.blocked.${act.why}`, { name });
  switch ( act.act ) {
    case "open": return i18n.format((act.by === "key") ? "FEO.Objects.hint.openKey" : "FEO.Objects.hint.openSkill", { name, by: act.name ?? "" });
    case "break": return i18n.format("FEO.Objects.hint.break", { name, damage: act.damage, left: act.left, max: act.object.hp.max });
    case "visit": return i18n.format("FEO.Objects.hint.visit", { name });
    case "pillage": return i18n.format("FEO.Objects.hint.pillage", { name });
    default: return name;
  }
}

/* -------------------------------------------- */
/*  Acting                                      */
/* -------------------------------------------- */

/**
 * Save the map objects of a scene. Runs for a Game Master.
 * @param {Scene} scene
 * @param {MapObject[]} list
 * @returns {Promise<void>}
 */
async function save(scene, list) {
  if ( list.length ) await scene.update({ [`flags.${FEO.id}.${OBJECTS_FLAG}`]: list }, { diff: false, recursive: false });
  else await scene.unsetFlag(FEO.id, OBJECTS_FLAG);
}

/* -------------------------------------------- */

/**
 * A unit acts on a map object, as the rules have it as things stand: the object changes, a key or a weapon
 * loses a use, and the unit is given what a chest held or a Village gives. Runs for a Game Master.
 * @param {TokenDocument} token
 * @param {string} id       The map object
 * @returns {Promise<ObjectAct|null>}     What was done; null when nothing could be
 */
async function apply(token, id, staff = null) {
  const scene = token?.parent;
  const actor = token?.actor;
  const objects = objectsOn(scene);
  const object = objects.find((entry) => entry.id === id);
  const unit = object ? objectUnitOf(token) : null;
  if ( !unit ) return null;

  // A staff that opens doors and chests opens one it reaches, whatever its unit stands next to or carries
  const act = staff ? staffOpens(token, object, staff) : actOn(unit, object);
  if ( !act?.ok ) return null;
  const i18n = game.i18n;
  const name = objectName(object);

  // A key loses a use, and is gone with its last; a weapon that strikes a door loses one as well
  if ( act.key ) {
    const key = actor.items.get(act.key);
    if ( key && (key.system.uses.max > 0) ) {
      const left = Math.max(key.system.uses.value - 1, 0);
      if ( left ) await key.update({ "system.uses.value": left });
      else await key.delete();
    }
  }
  if ( act.act === "break" ) {
    const weapon = actor.system.equippedWeapon;
    if ( weapon && (weapon.system.uses?.max > 0) ) {
      const left = Math.max(weapon.system.uses.value - 1, 0);
      await weapon.update({ "system.uses.value": left });
      if ( !left ) await breakItem(weapon);
    }
  }

  const next = afterAct(object, act);
  await save(scene, objects.map((entry) => ((entry === object) ? next : entry)));

  // What it says over the unit, and what the unit is given
  const said = (act.act === "break")
    ? i18n.format(next.broken ? "FEO.Objects.done.broken" : "FEO.Objects.done.struck", { name, damage: act.damage, left: next.hp.value })
    : i18n.format(`FEO.Objects.done.${act.act}`, { name });
  pop(actor, [{ text: said, tone: (act.act === "pillage") ? "damage" : "skill" }]);
  const gains = yieldOf(object, act);
  if ( gains.gold > 0 ) await awardGold(actor, gains.gold);
  if ( gains.items.length ) {
    const made = gains.items.map((item) => {
      const data = foundry.utils.deepClone(item);
      delete data._id;
      if ( data.system && ("equipped" in data.system) ) data.system.equipped = false;
      return data;
    });
    await actor.createEmbeddedDocuments("Item", made);
    pop(actor, made.map((item) => ({ text: i18n.format("FEO.Steal.took", { item: item.name }), tone: "gold" })));
  }

  // What a Village tells its visitor is kept in the log
  if ( (act.act === "visit") && gains.note ) {
    await postCard(actor, {
      title: i18n.format("FEO.Objects.card.visit", { name: token.name || actor.name, village: name }),
      note: gains.note
    });
  }
  Hooks.callAll(OBJECT_HOOK, token, next, { act: act.act });
  return { ...act, object: next };
}

/* -------------------------------------------- */

/**
 * Answer a player's request to have a unit of theirs act on a map object. Runs for a Game Master; what is
 * asked for is checked against the rules like any other.
 * @param {{scene?: string, token?: string, object?: string, user?: string}} data
 * @returns {Promise<{act: string}|null>}
 */
export async function objectQuery({ scene: sceneId, token: tokenId, object, user: userId, staff = null } = {}) {
  const scene = game.scenes?.get(sceneId);
  const token = scene?.tokens.get(tokenId) ?? null;
  const user = game.users.get(userId);
  if ( !game.user.isGM || !token?.actor || (typeof object !== "string") ) return null;
  if ( user && !token.actor.testUserPermission(user, "OWNER") ) return null;
  try {
    const item = (typeof staff === "string") ? token.actor.items.get(staff) : null;
    if ( staff && !item ) return null;
    const done = await apply(token, object, item);
    return done ? { act: done.act } : null;
  } catch(err) {
    console.error(err);
    return null;
  }
}

/* -------------------------------------------- */

/**
 * A unit acts on the map object on a tile: it Opens a door or a chest, strikes a door it cannot open, Visits
 * a Village or Destroys it. It is the unit's Action. Whatever keeps it from that is said instead.
 * @param {TokenDocument} token
 * @param {{i: number, j: number}} tile
 * @returns {Promise<boolean>}      Whether it did
 */
export async function actOnObject(token, tile) {
  const actor = token?.actor;
  const act = objectActOn(token, tile);
  if ( !act ) return false;
  if ( !act.ok ) {
    ui.notifications.warn(describeAct(act));
    return false;
  }
  let done = null;
  if ( game.user.isGM ) done = await apply(token, act.object.id);
  else {
    const gm = game.users.activeGM;
    if ( gm ) {
      try {
        done = await gm.query(OBJECT_QUERY, { scene: token.parent.id, token: token.id, object: act.object.id, user: game.user.id }, { timeout: 15000 });
      } catch(err) {
        console.error(err);
      }
    }
  }
  if ( !done ) {
    ui.notifications.warn(game.i18n.format("FEO.Objects.failed", { name: objectName(act.object) }));
    return false;
  }

  // Doors and chests are objects a unit interacts with; a Village is Visited
  await takeAction(actor, token, { action: { kind: ["visit", "pillage"].includes(done.act) ? "visit" : "object" } });
  return true;
}

/* -------------------------------------------- */

/**
 * What a staff that opens doors and chests does with a map object: it opens one of a kind it opens that it
 * reaches, and that is still shut.
 * @param {TokenDocument} token     The token of the unit that uses the staff
 * @param {MapObject} object
 * @param {Item} item               The staff
 * @returns {ObjectAct|null}        Null for a staff that opens nothing, or an object it does not reach
 */
function staffOpens(token, object, item) {
  if ( (item?.type !== "weapon") || (item.system.category !== "staff") || isSpent(object) ) return null;
  const reached = staffObjectsOf(token, item).some((entry) => entry.id === object.id);
  return reached ? { object, act: "open", ok: true, why: null, by: "skill", name: item.name } : null;
}

/* -------------------------------------------- */

/**
 * A staff opens the door or the chest on a tile, as one that opens them does for whatever of the kind it
 * reaches. Its unit is given what a chest held. Using the staff is the unit's Action, which whoever uses it
 * sees to.
 * @param {TokenDocument} token       The token of the unit that uses the staff
 * @param {{i: number, j: number}} tile
 * @param {Item} item                 The staff
 * @returns {Promise<boolean>}        Whether it was opened
 */
export async function unlockObject(token, tile, item) {
  const object = objectOn(token?.parent, tile);
  if ( !object || !staffOpens(token, object, item) ) return false;
  let done = null;
  if ( game.user.isGM ) done = await apply(token, object.id, item);
  else {
    const gm = game.users.activeGM;
    if ( gm ) {
      try {
        done = await gm.query(OBJECT_QUERY, { scene: token.parent.id, token: token.id, object: object.id, user: game.user.id, staff: item.id }, { timeout: 15000 });
      } catch(err) {
        console.error(err);
      }
    }
  }
  return !!done;
}

/* -------------------------------------------- */
/*  Placing                                     */
/* -------------------------------------------- */

/**
 * Place a map object on a tile of a scene, in place of whatever stood there; or with no kind, take away what
 * stands there. Runs for a Game Master.
 * @param {Scene} scene
 * @param {{i: number, j: number}} tile
 * @param {"door"|"chest"|"village"|null} kind
 * @param {object} [data]       What else is known of it
 * @returns {Promise<MapObject|null>}     What stands there now
 */
export async function placeObject(scene, tile, kind, data = {}) {
  if ( !game.user.isGM || !scene?.grid?.isSquare ) return null;
  const kept = objectsOn(scene).filter((object) => !((object.i === tile.i) && (object.j === tile.j)));
  const made = kind ? normalizeObject({ ...data, id: foundry.utils.randomID(), kind, i: tile.i, j: tile.j }) : null;
  await save(scene, made ? [...kept, made] : kept);
  return made;
}

/* -------------------------------------------- */

/**
 * Change a map object of a scene. Runs for a Game Master.
 * @param {Scene} scene
 * @param {string} id
 * @param {object} changes
 * @returns {Promise<MapObject|null>}
 */
export async function updateObject(scene, id, changes) {
  if ( !game.user.isGM ) return null;
  const objects = objectsOn(scene);
  const object = objects.find((entry) => entry.id === id);
  if ( !object ) return null;
  const next = normalizeObject({ ...object, ...changes, id: object.id, kind: object.kind, i: object.i, j: object.j });
  await save(scene, objects.map((entry) => ((entry === object) ? next : entry)));
  return next;
}

/* -------------------------------------------- */

/**
 * The data of a weapon or an item as a chest or a Village keeps it: a copy, fresh of what told it apart
 * where it lay.
 * @param {Item} item
 * @returns {object}
 */
function kept(item) {
  const data = item.inCompendium ? game.items.fromCompendium(item, { clearFolder: true }) : item.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  if ( data.system && ("equipped" in data.system) ) data.system.equipped = false;
  return data;
}

/* -------------------------------------------- */

/**
 * Have a Game Master set what a map object is and holds, in a small dialog: a door's kind, HP and whether it
 * stands open; the gold and the items of a chest or a Village, which are dropped onto the dialog from the
 * Items sidebar, a compendium or a sheet; what a Village tells its visitor.
 * @param {Scene} scene
 * @param {string} id
 * @returns {Promise<MapObject|null>}     The object as it was saved; null when the dialog was closed
 */
export async function configureObject(scene, id) {
  if ( !game.user.isGM ) return null;
  const object = objectsOn(scene).find((entry) => entry.id === id);
  if ( !object ) return null;
  const { DialogV2 } = foundry.applications.api;
  const i18n = game.i18n;
  const encode = foundry.utils.escapeHTML ?? ((text) => String(text));
  const items = object.items.map((item) => foundry.utils.deepClone(item));
  const door = object.kind === "door";
  const village = object.kind === "village";
  const rows = () => items.map((item, index) => {
    return `<li><img src="${encode(item.img ?? "")}" alt=""><span>${encode(item.name)}</span><button type="button" data-drop="${index}" aria-label="${encode(i18n.localize("FEO.Objects.config.remove"))}">&times;</button></li>`;
  }).join("") || `<li class="none">${encode(i18n.localize("FEO.Objects.config.noItems"))}</li>`;
  const doors = Object.entries(FEO.objects.doors).map(([key, entry]) => {
    return `<option value="${key}" ${key === object.door ? "selected" : ""}>${encode(i18n.localize(entry.label))} (${entry.hp})</option>`;
  }).join("");
  const field = (label, input) => `<div class="form-group"><label>${encode(i18n.localize(label))}</label><div class="form-fields">${input}</div></div>`;
  const content = `<div class="feo-object-config">
    ${field("FEO.Objects.config.name", `<input type="text" name="name" value="${encode(object.name)}" placeholder="${encode(objectName({ ...object, name: "" }))}">`)}
    ${door ? field("FEO.Objects.config.door", `<select name="door">${doors}</select>`) : ""}
    ${door ? field("FEO.Objects.config.hp", `<input type="number" name="hp" min="0" step="1" value="${object.hp.value}" placeholder="${object.hp.max}">`) : ""}
    ${door ? field("FEO.Objects.config.open", `<input type="checkbox" name="open" ${(object.open || object.broken) ? "checked" : ""}>`) : ""}
    ${!door ? field("FEO.Objects.config.gold", `<input type="number" name="gold" min="0" step="1" value="${object.gold}">`) : ""}
    ${!door ? `<div class="form-group stacked"><label>${encode(i18n.localize(village ? "FEO.Objects.config.reward" : "FEO.Objects.config.contents"))}</label>
      <ul class="feo-object-items" data-items>${rows()}</ul><p class="hint">${encode(i18n.localize("FEO.Objects.config.dropHint"))}</p></div>` : ""}
    ${village ? field("FEO.Objects.config.note", `<textarea name="note" rows="3">${encode(object.note)}</textarea>`) : ""}
    ${!door ? field(village ? "FEO.Objects.config.spentVillage" : "FEO.Objects.config.spentChest", `<select name="state">
      <option value="" ${!isSpent(object) ? "selected" : ""}>${encode(i18n.localize("FEO.Objects.config.whole"))}</option>
      ${village ? `<option value="visited" ${object.visited ? "selected" : ""}>${encode(i18n.localize("FEO.Objects.config.visited"))}</option>
      <option value="destroyed" ${object.destroyed ? "selected" : ""}>${encode(i18n.localize("FEO.Objects.config.destroyed"))}</option>`
      : `<option value="open" ${object.open ? "selected" : ""}>${encode(i18n.localize("FEO.Objects.config.opened"))}</option>`}
    </select>`) : ""}
  </div>`;

  const result = await DialogV2.wait({
    window: { title: i18n.format("FEO.Objects.config.title", { name: objectName(object) }) },
    content,
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element ?? event.target?.element ?? event.target;
      const list = root?.querySelector?.("[data-items]");
      if ( !list ) return;
      const redraw = () => (list.innerHTML = rows());
      list.addEventListener("click", (click) => {
        const index = click.target.closest("[data-drop]")?.dataset.drop;
        if ( index === undefined ) return;
        items.splice(Number(index), 1);
        redraw();
      });
      root.addEventListener("dragover", (drag) => drag.preventDefault());
      root.addEventListener("drop", async (drop) => {
        drop.preventDefault();
        try {
          const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(drop);
          if ( data?.type !== "Item" ) return;
          const item = await foundry.documents.Item.implementation.fromDropData(data);
          if ( !["weapon", "gear"].includes(item?.type) ) return;
          items.push(kept(item));
          redraw();
        } catch(err) {
          console.error(err);
        }
      });
    },
    buttons: [
      {
        action: "save", label: "FEO.Objects.config.save", default: true,
        callback: (event, button) => {
          const form = button.form;
          const read = (name) => form.elements[name];
          return {
            name: read("name")?.value ?? "",
            door: read("door")?.value ?? object.door,
            hp: read("hp")?.value ?? "",
            open: !!read("open")?.checked,
            gold: Number(read("gold")?.value ?? 0) || 0,
            note: read("note")?.value ?? "",
            state: read("state")?.value ?? ""
          };
        }
      },
      { action: "remove", label: "FEO.Objects.config.delete", callback: () => "remove" }
    ]
  });
  if ( !result ) return null;
  if ( result === "remove" ) {
    await placeObject(scene, { i: object.i, j: object.j }, null);
    return null;
  }
  const changes = { name: result.name, gold: result.gold, items, note: result.note };
  if ( door ) {
    const max = FEO.objects.doors[result.door]?.hp ?? object.hp.max;
    const typed = Number.parseInt(result.hp, 10);
    const value = (result.door !== object.door) ? max : (Number.isInteger(typed) ? Math.min(Math.max(typed, 0), max) : max);
    Object.assign(changes, { door: result.door, hp: { value: result.open ? value : Math.max(value, 1), max }, open: result.open, broken: false });
  }
  else Object.assign(changes, { open: result.state === "open", visited: result.state === "visited", destroyed: result.state === "destroyed" });
  return updateObject(scene, id, changes);
}

/* -------------------------------------------- */

/**
 * Keep what was read of a scene's map objects in step with its flag, and tell whoever shows them.
 * @param {() => void} [changed]    Called once the map objects of a scene may have changed
 */
export function registerObjects(changed = () => {}) {
  Hooks.on("updateScene", (scene, changes) => {
    if ( changes.flags?.[FEO.id] === undefined ) return;
    forgetObjects(scene);
    changed(scene);
  });
}

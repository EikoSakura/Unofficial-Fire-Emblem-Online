import { FEO } from "../config.mjs";
import {
  addPoints, bondsWithin, eventPoints, isReady, isTop, namesPartner, openTops, rangeState, takeTop, takenTops
} from "../rules/supports.mjs";
import { postCard } from "./chat.mjs";
import { measureDistance } from "./exchange.mjs";

/**
 * Supports on units in Foundry: finding out from the tokens on a scene which partners are in range, handing
 * out support points, showing a heart over partners that grow closer, and letting them choose between the
 * highest ranks.
 */

/** The socket the system's clients talk over. */
const SOCKET = `system.${FEO.id}`;

/** The query that asks the player of a unit which of the highest ranks one of its supports takes. */
export const TOP_QUERY = `${FEO.id}.supportTop`;

/** The query that asks a Game Master to give a partner's record of a support the highest rank the two chose. */
export const MIRROR_QUERY = `${FEO.id}.supportMirror`;

/**
 * Describe the unit behind a token for the support rules.
 * @param {TokenDocument} token
 * @returns {{token: TokenDocument, actor: Actor, uuid: string, uuids: string[], names: string[], bonds: object[]}}
 */
function unitOf(token) {
  const actor = token.actor;
  return {
    token,
    actor,
    uuid: actor.uuid,
    uuids: [token.baseActor?.uuid].filter(Boolean),
    names: [token.name, actor.name],
    bonds: actor.system.bonds
  };
}

/**
 * The units with a token on a scene that are still in the fight.
 * @param {Scene} scene
 * @returns {ReturnType<typeof unitOf>[]}
 */
function unitsOn(scene) {
  return scene.tokens.filter((token) => (token.actor?.type === "unit") && !token.actor.system.defeat?.out).map(unitOf);
}

const nameOf = (actor) => actor.token?.name ?? actor.name;

/**
 * Describe a unit for the support rules by its Actor alone.
 * @param {Actor} actor
 * @returns {{uuid: string, uuids: string[], names: string[]}}
 */
function describe(actor) {
  return {
    uuid: actor.uuid,
    uuids: [actor.token?.baseActor?.uuid].filter(Boolean),
    names: [actor.token?.name, actor.name].filter(Boolean)
  };
}

/**
 * The unit a bond is linked to, if it is linked to one.
 * @param {{uuid?: string}} bond
 * @returns {Actor|null}
 */
function partnerOf(bond) {
  if ( !bond?.uuid ) return null;
  let found = null;
  try {
    found = foundry.utils.fromUuidSync(bond.uuid);
  } catch(err) {
    return null;
  }
  return ((found?.documentName === "Actor") && (found.type === "unit")) ? found : null;
}

/**
 * Which of a unit's bonds is its record of the support it has with another unit.
 * @param {Actor} actor
 * @param {Actor} partner
 * @returns {number}    -1 if it has none
 */
function recordOf(actor, partner) {
  const unit = describe(partner);
  return (actor.system.bonds ?? []).findIndex((bond) => namesPartner(bond, unit));
}

const rankLabel = (rank) => game.i18n.localize(FEO.supportRanks[rank]?.label ?? "");

/* -------------------------------------------- */
/*  Range                                       */
/* -------------------------------------------- */

/**
 * Work out, for every unit with a token on a scene, which of its support partners are in range and which are
 * side by side, and save what changed. Bonds whose range is set by hand are left alone. Runs for the active
 * Game Master only, so that it happens once.
 * @param {Scene} scene
 * @returns {Promise<number>}   How many units were updated
 */
export async function refreshRanges(scene) {
  if ( !scene || !game.users.activeGM?.isSelf ) return 0;
  const units = unitsOn(scene);
  const done = new Set();
  let updated = 0;

  for ( const unit of units ) {
    if ( done.has(unit.uuid) ) continue;
    done.add(unit.uuid);
    const mine = units.filter((other) => other.uuid === unit.uuid);
    const bonds = foundry.utils.deepClone(unit.actor._source.system.bonds);
    let changed = false;

    for ( const bond of bonds ) {
      if ( !bond.auto ) continue;
      let nearest = null;
      for ( const partner of units ) {
        if ( (partner.uuid === unit.uuid) || !namesPartner(bond, partner) ) continue;
        for ( const own of mine ) {
          const distance = measureDistance(own.token, partner.token);
          if ( (distance !== null) && ((nearest === null) || (distance < nearest)) ) nearest = distance;
        }
      }
      const { inRange, adjacent } = rangeState(nearest);
      if ( (bond.inRange !== inRange) || (bond.adjacent !== adjacent) ) {
        bond.inRange = inRange;
        bond.adjacent = adjacent;
        changed = true;
      }
    }
    if ( changed ) {
      await unit.actor.update({ "system.bonds": bonds });
      updated++;
    }
  }
  return updated;
}

/* -------------------------------------------- */

const pending = new Map();

/**
 * Ask for a scene's support ranges to be worked out again shortly, so that a burst of token changes is
 * answered once.
 * @param {Scene} scene
 */
export function queueRanges(scene) {
  if ( !scene || !game.users.activeGM?.isSelf ) return;
  clearTimeout(pending.get(scene.id));
  pending.set(scene.id, setTimeout(() => {
    pending.delete(scene.id);
    refreshRanges(scene).catch((err) => console.error(err));
  }, 150));
}

/* -------------------------------------------- */

/**
 * Work out ranges again for the scenes a unit has a token on, after its bonds were edited.
 * @param {Actor} actor
 */
export function queueRangesFor(actor) {
  for ( const token of actor.getActiveTokens(false, true) ) queueRanges(token.parent);
}

/* -------------------------------------------- */
/*  Points                                      */
/* -------------------------------------------- */

/**
 * @typedef SupportGain     What one of a unit's bonds gained
 * @property {Actor} actor          The unit whose record of the support it is
 * @property {number} index         Which of its bonds
 * @property {Actor|null} other     Its partner, where the partner is known as a unit
 * @property {string} name
 * @property {string} partner       The partner's name, as the bond has it
 * @property {number} amount        The points it was given
 * @property {number} gained        The points that counted
 * @property {string} rank
 * @property {number} points
 * @property {number} rankUps
 * @property {boolean} ready        Is one of the highest ranks there for its partners to choose?
 * @property {boolean} held         Has it earned the highest rank with both of them taken?
 * @property {boolean} ripened      Did it come to that with these points?
 * @property {string[]} open        The highest ranks open to it
 */

/**
 * Add support points to some of a unit's bonds and raise their ranks as far as the points carry them.
 * @param {Actor} actor
 * @param {number[]} indexes      Which of the unit's bonds
 * @param {number} amount
 * @param {object} [options]
 * @param {Record<number, Actor>} [options.partners]    The partner of each bond, where the tokens on the map
 *                                                      tell; a linked bond's own otherwise
 * @returns {Promise<SupportGain[]>}      What each bond gained
 */
export async function grantPoints(actor, indexes, amount, { partners = {} } = {}) {
  if ( !(amount > 0) || !indexes.length ) return [];
  const bonds = foundry.utils.deepClone(actor._source.system.bonds);
  const gains = [];
  for ( const index of new Set(indexes) ) {
    const bond = bonds[index];
    if ( !bond ) continue;
    const other = partners[index] ?? partnerOf(bond);

    // A highest rank is open to the two only if neither holds it with somebody else
    const theirs = other ? takenTops(other.system.bonds, recordOf(other, actor)) : [];
    const after = addPoints(bond, amount, { taken: [...takenTops(bonds, index), ...theirs] });
    bond.rank = after.rank;
    bond.points = after.points;
    gains.push({ actor, index, other, name: nameOf(actor), partner: bond.name, amount, ...after });
  }
  if ( gains.some((gain) => gain.gained || gain.rankUps) ) await actor.update({ "system.bonds": bonds });
  return gains;
}

/* -------------------------------------------- */

/**
 * Report support gains in one chat card: new ranks, and a support that is ready for one of the highest. Points
 * alone are only listed when asked for. What both partners gained alike is said once.
 * @param {Actor} speaker
 * @param {SupportGain[]} gains
 * @param {object} [options]
 * @param {string} [options.reason]     A translation key for what the points were for
 * @param {boolean} [options.all]       List every gain, not only new ranks
 * @returns {Promise<void>}
 */
export async function reportGains(speaker, gains, { reason = null, all = false } = {}) {
  const i18n = game.i18n;
  const rows = [];
  const said = new Set();
  const say = (gain, value, cls) => {
    const partner = gain.partner || i18n.localize("FEO.Bond.unnamed");
    const key = `${[gain.name, partner].sort().join("|")}|${value}`;
    if ( said.has(key) ) return;
    said.add(key);
    rows.push({ label: `${gain.name} · ${partner}`, value, cls });
  };
  for ( const gain of gains ) {
    if ( gain.rankUps ) say(gain, i18n.format("FEO.Support.rankUp", { rank: rankLabel(gain.rank) }), "good");
    if ( gain.ripened && gain.ready ) {
      say(gain, i18n.format("FEO.Support.ready", { ranks: gain.open.map(rankLabel).join(i18n.localize("FEO.Support.or")) }), "good");
    }
    else if ( gain.ripened && gain.held ) say(gain, i18n.localize("FEO.Support.held"), "muted");
    else if ( all && !gain.rankUps ) {
      say(gain, gain.gained
        ? i18n.format("FEO.Support.gained", { amount: gain.gained, points: gain.points })
        : i18n.localize("FEO.Support.full"), "");
    }
  }
  if ( !rows.length ) return;
  await postCard(speaker, {
    title: i18n.localize("FEO.Support.title"),
    subtitle: reason ? i18n.localize(reason) : undefined,
    rows
  });
}

/* -------------------------------------------- */

/**
 * See to what support gains bring with them: a heart over the partners that grew closer, a chat card for what
 * is worth telling, and the choice between the highest ranks for a support that is ready for one.
 * @param {Actor} speaker
 * @param {SupportGain[]} gains
 * @param {object} [options]            As for `reportGains`
 * @returns {Promise<void>}
 */
export async function settleGains(speaker, gains, options = {}) {
  if ( !gains?.length ) return;

  // One heart for each unit, the larger where a rank was gained
  const hearts = new Map();
  for ( const gain of gains ) {
    if ( !gain.gained && !gain.rankUps ) continue;
    const heart = gain.rankUps ? { kind: "rank", text: rankLabel(gain.rank) } : { kind: "points", text: "" };
    for ( const unit of [gain.actor, gain.other] ) {
      if ( !unit ) continue;
      if ( (heart.kind === "rank") || !hearts.has(unit.uuid) ) hearts.set(unit.uuid, { unit, ...heart });
    }
  }
  for ( const { unit, kind, text } of hearts.values() ) popHeart(unit, { kind, text });
  await reportGains(speaker, gains, options);

  // A support that has just become ready is put to one of its partners, a player's unit before any other
  const pairs = new Map();
  for ( const gain of gains ) {
    if ( !gain.ripened || !gain.ready ) continue;
    const key = [gain.actor.uuid, gain.other?.uuid ?? `${gain.actor.uuid}:${gain.index}`].sort().join("|");
    if ( !pairs.has(key) || (!playerOf(pairs.get(key).actor) && playerOf(gain.actor)) ) pairs.set(key, gain);
  }
  for ( const gain of pairs.values() ) askTop(gain.actor, gain.index);
}

/* -------------------------------------------- */
/*  Hearts                                      */
/* -------------------------------------------- */

/** How a heart looks, by what it tells of: points gained, a new rank, one of the highest ranks. */
const HEARTS = {
  points: { size: 0.3, fill: 0xff7fa8, line: 0x5a1030, ink: 0xffffff, time: 1 },
  rank: { size: 0.38, fill: 0xff7fa8, line: 0x5a1030, ink: 0xffffff, time: 1.35 },
  top: { size: 0.44, fill: 0xffd866, line: 0x6a4a05, ink: 0xffe9a8, time: 1.35 }
};

/**
 * Draw a heart around its middle.
 * @param {number} size     Its width, in pixels
 * @param {{fill: number, line: number}} look
 * @returns {PIXI.Graphics}
 */
function drawHeart(size, look) {
  const w = size;
  const h = size * 0.92;
  const top = -h / 2;
  const dip = top + (h * 0.3);
  const belly = top + ((h + (h * 0.3)) / 2);
  const heart = new PIXI.Graphics();
  heart.lineStyle(Math.max(size * 0.09, 1.5), look.line, 1).beginFill(look.fill, 1);
  heart.moveTo(0, dip);
  heart.bezierCurveTo(0, top, -w / 2, top, -w / 2, dip);
  heart.bezierCurveTo(-w / 2, belly, 0, belly, 0, top + h);
  heart.bezierCurveTo(0, belly, w / 2, belly, w / 2, dip);
  heart.bezierCurveTo(w / 2, top, 0, top, 0, dip);
  heart.endFill();
  return heart;
}

/* -------------------------------------------- */

/**
 * Pop a heart over a unit's tokens on the map in view, on this client: it springs up over the unit's head,
 * rises and fades.
 * @param {Actor|null} actor
 * @param {object} [heart]
 * @param {"points"|"rank"|"top"} [heart.kind]
 * @param {string} [heart.text]     The rank reached, shown beside it
 */
function showHeart(actor, { kind = "points", text = "" } = {}) {
  try {
    const duration = FEO.supports.heart;
    if ( !globalThis.canvas?.ready || !actor || !(duration > 0) ) return;
    const look = HEARTS[kind] ?? HEARTS.points;
    const layer = canvas.interface ?? canvas.tokens;
    for ( const token of actor.getActiveTokens?.(false, false) ?? [] ) {
      if ( token.destroyed || (token.document.hidden && !game.user.isGM) ) continue;
      const size = Math.max(token.h * look.size, 16);
      const pop = new PIXI.Container();
      const heart = pop.addChild(drawHeart(size, look));
      if ( text ) {
        const Text = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
        const style = CONFIG.canvasTextStyle.clone();
        Object.assign(style, { fontSize: Math.round(size * 0.9), fill: look.ink, stroke: 0x000000, strokeThickness: 4 });
        const label = pop.addChild(new Text(String(text), style));
        label.anchor.set(0, 0.5);
        const gap = size * 0.12;
        heart.x = -(label.width + gap) / 2;
        label.x = heart.x + (size / 2) + gap;
      }
      const from = token.center.y - (token.h / 2) - (size * 0.25);
      const rise = token.h * 0.55;
      pop.position.set(token.center.x, from);
      pop.zIndex = 1200;
      pop.alpha = 0;
      layer.addChild(pop);

      const ticker = canvas.app.ticker;
      const length = duration * look.time;
      const started = performance.now();
      const step = () => {
        if ( pop.destroyed ) return ticker.remove(step);
        const t = Math.min((performance.now() - started) / length, 1);

        // It springs up larger than it is, settles, then drifts up and fades
        const scale = (t < 0.14) ? 0.2 + ((t / 0.14) * 1.1) : (t < 0.3) ? 1.3 - (((t - 0.14) / 0.16) * 0.3) : 1;
        pop.scale.set(scale);
        pop.y = from - (rise * (1 - ((1 - t) ** 2)));
        pop.alpha = (t < 0.08) ? t / 0.08 : (t > 0.7) ? Math.max(1 - ((t - 0.7) / 0.3), 0) : 1;
        if ( t < 1 ) return;
        ticker.remove(step);
        pop.parent?.removeChild(pop);
        pop.destroy({ children: true });
      };
      ticker.add(step);
    }
  } catch(err) {
    console.error(err);
  }
}

/* -------------------------------------------- */

/**
 * Pop a heart over a unit's tokens for everyone who has its map in view.
 * @param {Actor|null} actor
 * @param {{kind?: "points"|"rank"|"top", text?: string}} [heart]
 */
export function popHeart(actor, { kind = "points", text = "" } = {}) {
  if ( !actor ) return;
  showHeart(actor, { kind, text });
  game.socket?.emit(SOCKET, { type: "support.heart", actor: actor.uuid, kind, text });
}

/* -------------------------------------------- */
/*  The Highest Ranks                           */
/* -------------------------------------------- */

/**
 * The player who is connected and to whom a unit belongs, if there is one.
 * @param {Actor} actor
 * @returns {User|null}
 */
function playerOf(actor) {
  return game.users.find((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER")) ?? null;
}

/* -------------------------------------------- */

/**
 * Put the choice between the highest ranks to whoever plays a unit: its player where one is connected, and
 * otherwise this user, if the unit is theirs to change. Nothing waits on the answer.
 * @param {Actor} actor
 * @param {number} index      Which of its bonds
 */
function askTop(actor, index) {
  const player = playerOf(actor);
  if ( player && !player.isSelf ) {
    player.query(TOP_QUERY, { actor: actor.uuid, bond: index }, { timeout: 10000 }).catch(() => {});
    return;
  }
  if ( actor.isOwner ) offerTop(actor, index).catch((err) => console.error(err));
}

/* -------------------------------------------- */

/**
 * Answer a request to choose between the highest ranks for a unit of this user's. The choice is put to the
 * user, and the request is answered at once.
 * @param {{actor: string, bond: number}} data
 * @returns {Promise<boolean>}
 */
export async function topQuery({ actor: uuid, bond } = {}) {
  const actor = (typeof uuid === "string") ? await foundry.utils.fromUuid(uuid).catch(() => null) : null;
  if ( (actor?.documentName !== "Actor") || (actor.type !== "unit") || !actor.isOwner || !Number.isInteger(bond) ) return false;
  offerTop(actor, bond).catch((err) => console.error(err));
  return true;
}

/* -------------------------------------------- */

/**
 * The highest ranks open to one of a unit's supports: those neither it nor its partner holds with somebody else.
 * @param {Actor} actor
 * @param {number} index      Which of its bonds
 * @returns {string[]}
 */
export function openTopsOf(actor, index) {
  const bonds = actor.system.bonds ?? [];
  const other = partnerOf(bonds[index]);
  return openTops(takenTops(bonds, index), other ? takenTops(other.system.bonds, recordOf(other, actor)) : []);
}

/* -------------------------------------------- */

/**
 * Ask the user which of the highest ranks a support that is ready for one takes, and give it that rank.
 * @param {Actor} actor
 * @param {number} index      Which of its bonds
 * @returns {Promise<string|null>}    The rank chosen, or null when none was
 */
export async function offerTop(actor, index) {
  const bond = actor.system.bonds?.[index];
  if ( !bond || !isReady(bond) ) return null;
  const open = openTopsOf(actor, index);
  if ( !open.length ) return null;
  const i18n = game.i18n;
  const escape = foundry.utils.escapeHTML;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n.localize("FEO.Support.top.title") },
    position: { width: 420 },
    content: `<p>${i18n.format("FEO.Support.top.lead", {
      name: escape(nameOf(actor)), partner: escape(bond.name || i18n.localize("FEO.Bond.unnamed"))
    })}</p><p class="hint">${i18n.localize("FEO.Support.top.hint")}</p>`,
    buttons: [
      ...open.map((rank, at) => ({ action: rank, label: rankLabel(rank), default: at === 0 })),
      { action: "later", label: "FEO.Support.top.later" }
    ],
    rejectClose: false
  });
  if ( !open.includes(answer) ) return null;
  return (await chooseTop(actor, index, answer)) ? answer : null;
}

/* -------------------------------------------- */

/**
 * A support at A takes one of the highest ranks, on both partners' records of it: a heart pops over the two,
 * and a chat card says so. A partner this user may not change is handed to an active Game Master.
 * @param {Actor} actor
 * @param {number} index      Which of its bonds
 * @param {string} top        The rank chosen
 * @param {object} [options]
 * @param {boolean} [options.force]     Is it taken whether or not the support has the points, as by a Game Master?
 * @returns {Promise<boolean>}          Whether the support took the rank
 */
export async function chooseTop(actor, index, top, { force = false } = {}) {
  if ( (actor?.type !== "unit") || !actor.isOwner ) return false;
  const bonds = foundry.utils.deepClone(actor._source.system.bonds);
  const bond = bonds[index];
  if ( !bond ) return false;
  const other = partnerOf(bond);
  const theirs = other ? takenTops(other.system.bonds, recordOf(other, actor)) : [];
  const after = takeTop(bond, top, { taken: [...takenTops(bonds, index), ...theirs], force });
  if ( !after ) return false;
  Object.assign(bond, after);
  await actor.update({ "system.bonds": bonds });

  // The partner's record of the support follows
  if ( other ) {
    try {
      if ( other.isOwner ) await mirrorTop(other, actor, top);
      else await game.users.activeGM?.query(MIRROR_QUERY, { actor: other.uuid, of: actor.uuid, top }, { timeout: 10000 });
    } catch(err) {
      console.error(err);
    }
  }
  for ( const unit of [actor, other] ) if ( unit ) popHeart(unit, { kind: "top", text: rankLabel(top) });
  await postCard(actor, {
    title: game.i18n.localize("FEO.Support.title"),
    rows: [{
      label: `${nameOf(actor)} · ${bond.name || game.i18n.localize("FEO.Bond.unnamed")}`,
      value: game.i18n.format("FEO.Support.rankUp", { rank: rankLabel(top) }),
      cls: "good"
    }]
  });
  return true;
}

/* -------------------------------------------- */

/**
 * Give a unit's record of its support with a partner the highest rank the two chose, if it can take it.
 * @param {Actor} actor       The unit whose record it is
 * @param {Actor} partner
 * @param {string} top
 * @returns {Promise<boolean>}
 */
async function mirrorTop(actor, partner, top) {
  const index = recordOf(actor, partner);
  const bonds = foundry.utils.deepClone(actor._source.system.bonds);
  const bond = bonds[index];
  if ( !bond || !isTop(top) || isTop(bond.rank) || takenTops(bonds, index).includes(top) ) return false;
  bond.rank = top;
  if ( FEO.supports.method === "points" ) bond.points = 0;
  await actor.update({ "system.bonds": bonds });
  return true;
}

/* -------------------------------------------- */

/**
 * Answer a request to give a unit's record of a support the highest rank its partner's record has taken. Runs
 * for a Game Master, and only follows what the partner's record already says.
 * @param {{actor: string, of: string, top: string}} data
 * @returns {Promise<boolean>}
 */
export async function mirrorQuery({ actor: uuid, of, top } = {}) {
  if ( !game.user.isGM || !isTop(top) ) return false;
  const unit = async (id) => {
    const found = (typeof id === "string") && id ? await foundry.utils.fromUuid(id).catch(() => null) : null;
    return ((found?.documentName === "Actor") && (found.type === "unit")) ? found : null;
  };
  const actor = await unit(uuid);
  const partner = await unit(of);
  if ( !actor || !partner || (actor === partner) ) return false;
  if ( partner.system.bonds?.[recordOf(partner, actor)]?.rank !== top ) return false;
  return mirrorTop(actor, partner, top);
}

/* -------------------------------------------- */

/**
 * Register what supports listen for. Called once, when the system starts.
 */
export function registerHooks() {
  CONFIG.queries[TOP_QUERY] = topQuery;
  CONFIG.queries[MIRROR_QUERY] = mirrorQuery;
  Hooks.once("ready", () => {
    game.socket?.on(SOCKET, async (message) => {
      if ( message?.type !== "support.heart" ) return;
      const actor = await foundry.utils.fromUuid(message.actor).catch(() => null);
      const kind = (message.kind in HEARTS) ? message.kind : "points";
      if ( actor?.type === "unit" ) showHeart(actor, { kind, text: String(message.text ?? "").slice(0, 4) });
    });
  });
}

/* -------------------------------------------- */
/*  Events                                      */
/* -------------------------------------------- */

/* -------------------------------------------- */

/**
 * A battle begins: every pair of partners fielded in it together gains what the world's method gives for that.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function awardBattle(combat) {
  const amount = eventPoints("battle");
  if ( !amount ) return;
  const units = [];
  for ( const combatant of combat.combatants ) {
    if ( (combatant.actor?.type !== "unit") || !combatant.token ) continue;
    if ( !units.some((unit) => unit.uuid === combatant.actor.uuid) ) units.push(unitOf(combatant.token));
  }
  const gains = await grantWithin(units, bondsWithin(units), amount);
  const speaker = units[0]?.actor;
  if ( speaker ) await settleGains(speaker, gains, { reason: "FEO.Support.event.battle" });
}

/* -------------------------------------------- */

/**
 * Give the bonds found among a group of units their points, each unit's in one go.
 * @param {ReturnType<typeof unitOf>[]} units
 * @param {{unit: number, bond: number, partner: number}[]} found     As `bondsWithin` finds them
 * @param {number} amount
 * @returns {Promise<SupportGain[]>}
 */
async function grantWithin(units, found, amount) {
  const byUnit = new Map();
  for ( const { unit, bond, partner } of found ) {
    const entry = byUnit.get(unit) ?? { indexes: [], partners: {} };
    entry.indexes.push(bond);
    entry.partners[bond] = units[partner].actor;
    byUnit.set(unit, entry);
  }
  const gains = [];
  for ( const [index, { indexes, partners }] of byUnit ) {
    if ( !units[index].actor.isOwner ) continue;
    gains.push(...await grantPoints(units[index].actor, indexes, amount, { partners }));
  }
  return gains;
}

/* -------------------------------------------- */

/**
 * The Player Phase ends: partners that stand side by side as it does grow closer, where the world counts
 * points for that. Runs for the Game Master who ends the Phase.
 * @param {Combat} combat
 * @param {string} army       The side whose Phase ends
 * @returns {Promise<void>}
 */
export async function awardBeside(combat, army) {
  const amount = eventPoints("adjacent");
  if ( (army !== "player") || !amount ) return;

  // A unit that is off the map, as one an ally carries, stands next to nobody
  const units = [];
  for ( const combatant of combat.combatants ) {
    const actor = combatant.actor;
    if ( (actor?.type !== "unit") || !combatant.token || actor.system.defeat?.out ) continue;
    if ( !units.some((unit) => unit.uuid === actor.uuid) ) units.push(unitOf(combatant.token));
  }
  const beside = bondsWithin(units).filter(({ unit, partner }) => {
    const distance = measureDistance(units[unit].token, units[partner].token);
    return (distance !== null) && (distance <= 1);
  });
  const gains = await grantWithin(units, beside, amount);
  const speaker = units[0]?.actor;
  if ( speaker ) await settleGains(speaker, gains, { reason: "FEO.Support.event.adjacent" });
}

/* -------------------------------------------- */

/**
 * Something two partners did together earns them points, when the world counts points for it. Each of the
 * two units gains on its own record of the bond, where the user may change it.
 * @param {string} event              A key of FEO.supports.events
 * @param {TokenDocument} token       The unit that did it
 * @param {object} [options]
 * @param {number} [options.range]            Only partners within this many tiles count
 * @param {TokenDocument} [options.only]      Only this partner counts
 * @param {boolean} [options.mutual=true]     Do the partners gain on their records too?
 * @returns {Promise<void>}
 */
export async function awardEvent(event, token, { range = null, only = null, mutual = true } = {}) {
  const amount = eventPoints(event);
  if ( !amount || !token?.parent || (token.actor?.type !== "unit") ) return;
  const me = unitOf(token);
  const others = only ? [unitOf(only)] : unitsOn(token.parent).filter((unit) => unit.uuid !== me.uuid);
  const gains = [];

  for ( const partner of others ) {
    if ( partner.actor?.type !== "unit" ) continue;
    if ( range !== null ) {
      const distance = measureDistance(token, partner.token);
      if ( (distance === null) || (distance > range) ) continue;
    }
    const toward = (indexes, unit) => ({ partners: Object.fromEntries(indexes.map((index) => [index, unit.actor])) });
    const mine = me.bonds.map((bond, index) => namesPartner(bond, partner) ? index : -1).filter((index) => index >= 0);
    if ( mine.length && me.actor.isOwner ) gains.push(...await grantPoints(me.actor, mine, amount, toward(mine, partner)));
    if ( !mutual || !partner.actor.isOwner ) continue;
    const theirs = partner.bonds.map((bond, index) => namesPartner(bond, me) ? index : -1).filter((index) => index >= 0);
    if ( theirs.length ) gains.push(...await grantPoints(partner.actor, theirs, amount, toward(theirs, me)));
  }
  await settleGains(me.actor, gains, { reason: `FEO.Support.event.${event}` });
}

/* -------------------------------------------- */

/**
 * Record a new support with another unit, linked to its Actor.
 * @param {Actor} actor
 * @param {Actor} partner
 * @returns {Promise<boolean>}    False if the unit already has a bond with the partner
 */
export async function linkBond(actor, partner) {
  if ( (partner?.type !== "unit") || (partner === actor) ) return false;
  const bonds = foundry.utils.deepClone(actor._source.system.bonds);
  const uuid = partner.token?.baseActor?.uuid ?? partner.uuid;
  const unit = { uuid, uuids: [partner.uuid], names: [partner.name] };
  const existing = bonds.find((bond) => namesPartner(bond, unit));
  if ( existing ) {
    if ( existing.uuid ) return false;
    existing.uuid = uuid;
  }
  else bonds.push({
    name: partner.name, affinity: partner.system.affinity ?? "", rank: "E", points: 0,
    inRange: false, adjacent: false, auto: true, kin: false, uuid
  });
  await actor.update({ "system.bonds": bonds });
  queueRangesFor(actor);
  return true;
}

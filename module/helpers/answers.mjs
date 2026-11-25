import { FEO } from "../config.mjs";
import { FALL, FOIL_MOMENT, answerAlone, foilsBefore, settleFoils } from "../rules/answers.mjs";
import { resolveExchange } from "../rules/combat.mjs";
import { BLOW } from "../rules/stances.mjs";
import { pickCount } from "../rules/timed.mjs";
import { rollD100 } from "./chat.mjs";
import { isPlayerUnit } from "./players.mjs";

/**
 * Answers in the middle of a fight, in Foundry (see `rules/answers.mjs`): a fight the system rolls stops where
 * a skill lets whoever acts for a unit answer, that user is offered it on their own map with one click to take
 * it, and the fight is rolled out again from the same dice with what was answered. No answer in time is a no.
 * Units no player owns answer by themselves, unless the world has its Game Master asked.
 */

/** The name of the query that offers a unit's answers on the client of whoever acts for it. */
export const ANSWER_QUERY = `${FEO.id}.answer`;

/** The world setting that has the units no player owns answer by themselves. */
export const ALONE_SETTING = "gmAnswers";

const other = (side) => (side === "initiator") ? "defender" : "initiator";

/* -------------------------------------------- */

/**
 * Does a unit answer by itself, without anybody being asked? One that no player owns does, where the world
 * has it so: its Game Master would otherwise be asked for every such unit in every fight of a Phase.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function answersAlone(actor) {
  return !!FEO.answers.alone.enabled && !!actor && !isPlayerUnit(actor);
}

/* -------------------------------------------- */
/*  Offering                                    */
/* -------------------------------------------- */

/**
 * What an offer says: the skill, and in a few words what it would do to the attack at hand.
 * @param {import("../rules/answers.mjs").AnswerOffer} offer
 * @param {import("../rules/answers.mjs").AnswerPoint} point
 * @param {{name?: string, foe?: string}} [names]     The unit that may answer and the unit it fights
 * @returns {{id: string, label: string, hint: string, img?: string}}
 */
function describe(offer, point, names = {}) {
  const i18n = game.i18n;
  const attack = point.attack ?? {};

  // A stat to pick for a change that lasts: the stat, and what the change does to it
  if ( offer.what === "pick" ) {
    const stat = i18n.localize(FEO.stats[offer.stat]?.abbr ?? offer.stat ?? "");
    const amount = offer.amount ?? 0;
    return { id: offer.key, label: stat, hint: i18n.format("FEO.Timed.pick.hint", { stat, amount: `${amount > 0 ? "+" : "−"}${Math.abs(amount)}` }) };
  }

  // An item to take from a foe's pack: the item, and the uses it has
  if ( offer.what === "take" ) return { id: offer.key, label: offer.item?.name ?? offer.skill, hint: offer.hint ?? "", img: offer.item?.img ?? "" };
  const data = {
    // Where the two stand as a round ends, for the offer to end the fight before the next
    name: names.name ?? "",
    foe: names.foe ?? "",

    // The ally a unit outside the fight would answer for, where it is one of those
    ally: offer.ally ?? point.ally ?? "",
    by: offer.by ?? "",
    next: point.round?.next ?? 0,
    hp: point.round?.hp ?? 0,
    foeHp: point.round?.foeHp ?? 0,
    amount: offer.amount ?? 0,
    cost: offer.cost ?? 0,
    others: offer.others ?? 0,
    item: offer.item?.name ?? "",
    damage: attack.damage ?? 0,
    hit: attack.hitChance ?? 0,
    after: Math.max((attack.hitChance ?? 0) - (offer.amount ?? 0), 0),
    margin: attack.margin ?? 0,
    left: Math.max((attack.damage ?? 0) - (offer.amount ?? 0), 0)
  };
  let key = `FEO.Answer.hint.${offer.what}`;
  if ( (offer.what === "dodge") && attack.crit ) key = "FEO.Answer.hint.dodgeCrit";
  else if ( (offer.what === "reroll") && (point.on === "critMiss") ) key = "FEO.Answer.hint.rerollCrit";
  else if ( (offer.what === "reduce") && offer.item ) key = (offer.cost > 0) ? "FEO.Answer.hint.reduceItem" : "FEO.Answer.hint.reduceFree";
  else if ( (offer.what === "harm") && !(offer.cost > 0) ) key = "FEO.Answer.hint.harmFree";
  const option = { id: offer.key, label: offer.item ? `${offer.skill}: ${offer.item.name}` : offer.skill, hint: i18n.has(key) ? i18n.format(key, data) : i18n.localize("FEO.Answer.hint.use") };
  if ( offer.item?.img ) option.img = offer.item.img;
  return option;
}

/* -------------------------------------------- */

/**
 * Offer a unit this user acts for its answers to a point of a fight, on this client: a short list above the
 * dock on its map, or a small dialog where the map cannot show it. No answer in time is a no.
 * @param {TokenDocument|null} token      The unit that may answer
 * @param {Actor} actor
 * @param {string} foe                    The unit it fights, by name
 * @param {import("../rules/answers.mjs").AnswerPoint} point
 * @returns {Promise<string|null>}        The key of the offer taken, or null
 */
async function askHere(token, actor, foe, point) {
  if ( !actor?.isOwner || !point?.offers?.length ) return null;
  const i18n = game.i18n;
  const options = point.offers.map((offer) => describe(offer, point, { name: token?.name || actor.name, foe }));
  const mine = point.attack ? (point.attack.side === point.side) : null;

  // What the list is about: the attack at hand, or the round that has just ended
  const picking = (point.on === "pick") ? (point.offers[0]?.left ?? 1) : 0;
  const hint = point.about ? String(point.about)
    : picking ? i18n.format((picking > 1) ? "FEO.Timed.pick.more" : "FEO.Timed.pick.one", { left: picking })
    : point.round ? i18n.format("FEO.Round.about", { round: Math.max((point.round.next ?? 2) - 1, 1) })
    : (mine === null) ? "" : i18n.format(mine ? "FEO.Answer.about.own" : "FEO.Answer.about.foe", { name: token?.name || actor.name, foe });
  const title = (new Set(point.offers.map((offer) => offer.skill)).size === 1) ? point.offers[0].skill : i18n.localize("FEO.Answer.title");
  const wait = FEO.answers.promptTime;

  // The list takes the place of whatever the user had selected, which is theirs again once it is answered
  const before = (globalThis.canvas?.tokens?.controlled ?? []).slice();
  let asked = token ? (game.feo.hud?.choose?.({ token, skill: title, hint, options, wait }) ?? null) : null;
  const onMap = !!asked;
  if ( !asked ) asked = askInDialog(title, hint, options, wait);
  const picked = await asked;
  if ( onMap ) {
    try {
      const own = token.object;
      if ( before.length && !((before.length === 1) && (before[0] === own)) ) {
        own?.release();
        for ( const kept of before ) if ( !kept.destroyed ) kept.control({ releaseOthers: false });
      }
    } catch(err) {
      console.error(err);
    }
  }
  return options.some((option) => option.id === picked) ? picked : null;
}

/* -------------------------------------------- */

/**
 * The same offer as a small dialog, for a unit without a token on the map in view.
 * @param {string} title
 * @param {string} hint
 * @param {{id: string, label: string, hint: string}[]} options
 * @param {number} wait     How long it waits, in milliseconds
 * @returns {Promise<string|null>}
 */
async function askInDialog(title, hint, options, wait) {
  const { DialogV2 } = foundry.applications.api;
  const encode = foundry.utils.escapeHTML ?? ((text) => String(text));
  const lines = options.map((option) => `<p><strong>${encode(option.label)}</strong>: ${encode(option.hint)}</p>`).join("");
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const end = (value) => {
      if ( done ) return;
      done = true;
      clearTimeout(timer);
      resolve(value ?? null);
    };
    const dialog = new DialogV2({
      window: { title },
      content: `<div class="feo-answer">${hint ? `<p>${encode(hint)}</p>` : ""}${lines}</div>`,
      buttons: [
        ...options.map((option, index) => ({ action: `take${index}`, label: option.label, default: index === 0, callback: () => option.id })),
        { action: "pass", label: "FEO.Answer.pass", callback: () => null }
      ],
      submit: (result) => end(result),
      rejectClose: false
    });
    dialog.addEventListener("close", () => end(null), { once: true });
    timer = setTimeout(() => {
      end(null);
      dialog.close().catch(() => {});
    }, wait);
    dialog.render({ force: true }).catch((err) => {
      console.error(err);
      end(null);
    });
  });
}

/* -------------------------------------------- */

/**
 * Answer another client's request to offer a unit this user acts for its answers to a point of a fight. Only a
 * unit this user owns is offered anything.
 * @param {{scene?: string, token?: string, actor?: string, foe?: string, point?: object}} data
 * @returns {Promise<string|null>}
 */
export async function answerQuery({ scene: sceneId, token: tokenId, actor: actorId, foe, point } = {}) {
  const token = game.scenes?.get(sceneId)?.tokens.get(tokenId) ?? null;
  const actor = token?.actor ?? (((typeof actorId === "string") && actorId) ? await foundry.utils.fromUuid(actorId) : null);
  if ( (actor?.documentName !== "Actor") || !actor.isOwner || !Array.isArray(point?.offers) ) return null;
  const offers = point.offers.filter((offer) => (typeof offer?.key === "string") && (typeof offer.skill === "string") && (typeof offer.what === "string"));
  return askHere(token, actor, String(foe ?? ""), { ...point, offers });
}

/* -------------------------------------------- */

/**
 * Have a point of a fight answered: by the unit itself where it answers alone, else by whoever acts for it,
 * on whichever client they sit.
 * @param {import("../rules/answers.mjs").AnswerPoint} point
 * @param {{initiator: {token: TokenDocument|null, actor: Actor}, defender: {token: TokenDocument|null, actor: Actor}}} units
 * @returns {Promise<string|null>}    The key of the offer taken, or null for a pass
 */
async function decide(point, units) {
  const foe = units[other(point.side)];
  return askFor(units[point.side] ?? {}, point, foe?.token?.name || foe?.actor?.name || "");
}

/* -------------------------------------------- */

/**
 * Have a unit answer a point: by itself where it answers alone, else by whoever acts for it, on whichever
 * client they sit. The unit need not be one of the two that fight: an ally that stands by answers the same way
 * (see `helpers/stances.mjs`), and so does a unit that may react to an enemy's move (`helpers/reactions.mjs`).
 * @param {{token?: TokenDocument|null, actor?: Actor}} unit      The unit that may answer
 * @param {import("../rules/answers.mjs").AnswerPoint & {about?: string, ally?: string}} point
 *                                        `about` is the line above its offers, where the point is none of a
 *                                        fight; `ally` the unit it would answer for
 * @param {string} [foeName]              The unit it is about, by name
 * @param {object} [options]
 * @param {boolean} [options.alone]       Is a unit that answers by itself left to pass? Whoever asks has then
 *                                        answered for it already
 * @returns {Promise<string|null>}        The key of the offer taken, or null for a pass
 */
export async function askFor({ token = null, actor = null } = {}, point, foeName = "", { alone = true } = {}) {
  if ( !actor ) return null;
  if ( answersAlone(actor) ) return alone ? answerAlone(point) : null;
  const { actsFor } = await import("./rescue.mjs");
  const user = actsFor(actor);
  if ( !user ) return null;
  if ( user === game.user ) return askHere(token, actor, foeName, point);
  const picked = await user.query(ANSWER_QUERY, {
    scene: token?.parent?.id ?? null, token: token?.id ?? null, actor: actor.uuid, foe: foeName, point
  }, { timeout: FEO.answers.promptTime + 5000 });
  return point.offers.some((offer) => offer.key === picked) ? picked : null;
}

/* -------------------------------------------- */

/**
 * Have the stats of a change that lasts picked outside of a fight, as at a moment of a unit's turn: whoever
 * acts for the unit is offered them above the dock on their own map, one pick at a time, as an answer in a
 * fight is. A unit that answers by itself picks none, and neither does one whose owner gives no answer: the
 * stats are then picked for it (see `chosenEffects` in `rules/timed.mjs`).
 * @param {TokenDocument|null} token      The unit that grants the change
 * @param {Actor} actor
 * @param {{skill: string, choose: {stats: string[], pick?: number, amount: number}}} asked
 * @returns {Promise<string[]>}           The stats picked, which may be fewer than are asked for
 */
export async function pickStatsFor(token, actor, { skill, choose }) {
  if ( !actor || answersAlone(actor) ) return [];
  const { actsFor } = await import("./rescue.mjs");
  const user = actsFor(actor);
  if ( !user ) return [];
  const count = pickCount(choose);
  const picked = [];
  while ( picked.length < count ) {
    const offers = [...new Set(choose.stats)].filter((stat) => !picked.includes(stat)).map((stat) => {
      return { key: `${skill}|${stat}`, skill, id: null, what: "pick", stat, amount: choose.amount, left: count - picked.length };
    });
    const point = { index: picked.length, on: "pick", side: "initiator", attack: null, offers };
    let key = null;
    try {
      key = (user === game.user) ? await askHere(token, actor, "", point) : await user.query(ANSWER_QUERY, {
        scene: token?.parent?.id ?? null, token: token?.id ?? null, actor: actor.uuid, foe: "", point
      }, { timeout: FEO.answers.promptTime + 5000 });
    } catch(err) {
      console.error(err);
    }
    const offer = offers.find((entry) => entry.key === key);
    if ( !offer ) break;
    picked.push(offer.stat);
  }
  return picked;
}

/* -------------------------------------------- */
/*  Rolling a Fight Out                         */
/* -------------------------------------------- */

/**
 * What a skill brings to nothing before a fight is planned: the skills the foe chose for it, and the Combat Art
 * the foe performs (see `foilsBefore`). Each is rolled for; where one comes, the fight is planned again without
 * what was brought to nothing.
 * @param {import("../rules/combat.mjs").ExchangePlan} plan
 * @param {(foiled: object) => import("../rules/combat.mjs").ExchangePlan} replan
 * @returns {Promise<{plan: object, rolls: object[], dice: number[]}>}    The plan to fight by, the chances as
 *          they were rolled, and the dice they took
 */
export async function foilBefore(plan, replan) {
  const list = foilsBefore(plan);
  if ( !list.length ) return { plan, rolls: [], dice: [] };
  const needed = list.filter((entry) => !entry.sure).length;
  const { results } = needed ? await rollD100(needed) : { results: [] };
  const dice = [];
  const { rolls, foiled } = settleFoils(list, () => {
    const rolled = results[dice.length] ?? 100;
    dice.push(rolled);
    return rolled;
  });
  return { plan: foiled ? replan(foiled) : plan, rolls, dice };
}

/* -------------------------------------------- */

/**
 * Roll a planned fight out, stopping for every answer a skill lets somebody give: the fight is rolled as far as
 * it goes, the point it stops at is answered, and it is rolled again from the same dice with that answer, until
 * it runs through.
 * @param {import("../rules/combat.mjs").ExchangePlan} plan
 * @param {object} dice
 * @param {() => number} dice.next        The next d100 of the row that was rolled for the fight
 * @param {() => void} dice.reset         Starts the row over
 * @param {{initiator: {token: TokenDocument|null, actor: Actor}, defender: {token: TokenDocument|null, actor: Actor}}} units
 * @returns {Promise<{result: import("../rules/combat.mjs").ExchangeResult, saver: object|null}>}
 *          The fight, and the ally that came for a unit as it fell, to have it come once the fight is saved
 */
export async function rollAnswered(plan, { next, reset }, units) {
  const rescue = await import("./rescue.mjs");
  const tokens = { initiator: units.initiator.token, defender: units.defender.token };

  // The allies that could come for either unit as the blow that would defeat it falls
  const waiting = { initiator: [], defender: [] };
  try {
    for ( const side of ["initiator", "defender"] ) waiting[side] = rescue.standbyFor(tokens[side], tokens[other(side)]);
  } catch(err) {
    console.error(err);
  }
  // And those that could take a hit meant for either unit, or turn it back (see `helpers/stances.mjs`)
  const stances = await import("./stances.mjs");
  const warding = { initiator: [], defender: [] };
  try {
    for ( const side of ["initiator", "defender"] ) warding[side] = stances.wardStandby(tokens[side], tokens[other(side)]);
  } catch(err) {
    console.error(err);
  }
  const standby = Object.fromEntries(Object.entries(waiting).map(([side, list]) => {
    return [side, [...list.map(({ key, skill, by }) => ({ key, skill, by })), ...warding[side].map(({ token, item, ...told }) => told)]];
  }));
  const answers = [];
  let saver = null;
  for ( let turn = 0; turn < 500; turn++ ) {
    reset();
    const result = resolveExchange(plan, next, { answers, standby });
    if ( !result.pending ) return { result, saver };
    const point = result.pending;
    let key = null;
    try {
      if ( point.on === FALL ) {
        saver = await rescue.comeTo(waiting[point.side], tokens[point.side], point.side);
        key = saver?.key ?? null;
      }
      else if ( point.on === BLOW ) key = await stances.answerBlow(point, warding[point.side], units);
      else key = await decide(point, units);
    } catch(err) {
      console.error(err);
    }
    answers.push(key);
  }
  throw new Error("A fight asked for more answers than it can have.");
}

/* -------------------------------------------- */
/*  Showing                                     */
/* -------------------------------------------- */

/**
 * Say what was answered in a fight where it happened: the name of each skill that answered floats over its
 * unit, and that of a skill that brought something to nothing over the unit that has it. A user who has
 * cut-ins on has already been shown them, in their place among the fight's (see `cutInFight`).
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {{initiator: Actor, defender: Actor}} actors
 * @returns {Promise<void>}
 */
export async function showAnswers(result, actors) {
  const { pop } = await import("./events.mjs");
  const told = [...result.attacks.flatMap((attack) => attack.answers ?? []), ...(result.answers ?? [])];
  for ( const answer of told ) {
    pop(actors[answer.by], [{ text: answer.item ? `${answer.skill}: ${answer.item}` : answer.skill, tone: "skill", seen: true }]);
  }
  const foils = [...(result.opening ?? []), ...result.attacks.flatMap((attack) => attack.procs ?? [])].filter((proc) => (proc.on === FOIL_MOMENT) && proc.success);
  for ( const proc of foils ) pop(actors[proc.by], [{ text: proc.skill, tone: "skill", seen: true }]);
}

/* -------------------------------------------- */

/**
 * Deal what a skill has go to the enemies around a fight once it is over (see `ExchangeResult.splashes`), each
 * through the one way damage is dealt, so that every unit hit shows its own number. Where more units stand
 * there than it goes to, whoever acts for the unit picks them on the map, and those nearest are taken where
 * they do not.
 * @param {import("../rules/combat.mjs").ExchangeResult} result
 * @param {{initiator: TokenDocument|null, defender: TokenDocument|null}} tokens
 * @returns {Promise<{skill: string, by: string, amount: number, units: string[]}[]>}   What was dealt, and to whom
 */
export async function takeSplashes(result, tokens) {
  const dealt = [];
  if ( !result.splashes?.length ) return dealt;
  const { damageUnit, pop } = await import("./events.mjs");
  const { askOwner } = await import("./rescue.mjs");
  for ( const splash of result.splashes ) {
    const token = tokens[splash.by];
    const scene = token?.parent;
    if ( !scene || !token.actor || (result[splash.by].hp <= 0) ) continue;
    const standing = (unit) => !!unit?.actor && !unit.actor.system.defeat?.out && (unit.actor.system.hp?.value > 0);
    let open = splash.units.map((unit) => scene.tokens.get(unit.id)).filter(standing);
    const picked = [];
    while ( (picked.length < splash.count) && (open.length > (splash.count - picked.length)) ) {
      const answer = answersAlone(token.actor) ? null : await askOwner(token, {
        skill: splash.skill, units: open, hint: game.i18n.format("FEO.Answer.splash.hint", { amount: splash.amount, left: splash.count - picked.length })
      });
      if ( !answer?.unit || !open.includes(answer.unit) ) break;
      picked.push(answer.unit);
      open = open.filter((unit) => unit !== answer.unit);
    }
    picked.push(...open.slice(0, splash.count - picked.length));
    if ( !picked.length ) continue;
    pop(token.actor, [{ text: splash.skill, tone: "skill" }]);
    for ( const target of picked ) {
      if ( standing(target) ) await damageUnit(target.actor, splash.amount, { kind: "skill", by: token.actor, byToken: token, token: target });
    }
    dealt.push({ skill: splash.skill, by: splash.by, amount: splash.amount, units: picked.map((unit) => unit.name || unit.actor.name) });
  }
  return dealt;
}

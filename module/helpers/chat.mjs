import { FEO } from "../config.mjs";
import { cardFace, cardRecord } from "./chat-context.mjs";
import { armyOf } from "./exchange.mjs";

/** The flag a message keeps its record under: everything its card has to tell (see `chat-context.mjs`). */
export const RECORD_FLAG = "card";

/**
 * @typedef ChatCard
 * @property {string} title
 * @property {string} [subtitle]
 * @property {{label: string, cls?: string}} [outcome]   A headline result
 * @property {{label: string, value: string|number, cls?: string, face?: boolean}[]} [rows]
 *                                Only the rows that are marked as results (`strong`, `good`, `bad`) are shown
 *                                on the card; the rest are kept for the window that opens when the card is
 *                                inspected. `face` settles it for a row either way
 * @property {string} [note]
 * @property {string} [cls]      A class for the card, for styles of its own
 */

/**
 * Post a system chat card on behalf of an Actor. Every string is expected to be localized already.
 *
 * The card shows its headline and its results; everything else it was given is kept with the message, and is
 * shown by inspecting it: a right-click on the message, or the magnifying glass on the card.
 * @param {Actor} actor
 * @param {ChatCard|object} card      The data for the card's template
 * @param {object} [options]
 * @param {Roll[]} [options.rolls]    Evaluated rolls to attach to the message
 * @param {string} [options.template] The chat template to render, by file name without its extension
 * @param {string[]} [options.whisper] The users to show the card to, by id, in place of everyone
 * @returns {Promise<ChatMessage>}
 */
export async function postCard(actor, card, { rolls = [], template = "card", whisper = null } = {}) {
  const ChatMessage = foundry.documents.ChatMessage.implementation;

  // The card wears the colours of the side its unit fights for
  const army = (actor?.type === "unit") ? armyOf(actor, actor.token ?? null) : "";
  const { face, more } = cardFace(card, template);
  const record = cardRecord(card, template, game.i18n);
  const inspect = !!record && (more || (rolls.length > 0));
  const content = await foundry.applications.handlebars.renderTemplate(
    `systems/${FEO.id}/templates/chat/${template}.hbs`,
    { ...face, army, inspect }
  );
  const data = { speaker: ChatMessage.getSpeaker({ actor }), content, rolls };
  if ( inspect ) data.flags = { [FEO.id]: { [RECORD_FLAG]: { army, ...record } } };
  if ( rolls.length ) data.sound = CONFIG.sounds.dice;
  if ( whisper?.length ) data.whisper = whisper;
  return ChatMessage.create(data);
}

/* -------------------------------------------- */

/**
 * Roll a number of d100s at once and return the results in order.
 * @param {number} count
 * @returns {Promise<{roll: Roll, results: number[]}>}
 */
export async function rollD100(count = 1) {
  const roll = new foundry.dice.Roll(`${count}d100`);
  await roll.evaluate();
  return { roll, results: roll.dice[0].results.map((result) => result.result) };
}

/* -------------------------------------------- */

/**
 * Build an evaluated roll from d100 results that have already been rolled, so that a message can show exactly
 * the dice that were used.
 * @param {number[]} results
 * @returns {Roll}
 */
export function rollFromResults(results) {
  const die = new foundry.dice.terms.Die({
    number: results.length,
    faces: 100,
    results: results.map((result) => ({ result, active: true }))
  });
  return foundry.dice.Roll.fromTerms([die]);
}

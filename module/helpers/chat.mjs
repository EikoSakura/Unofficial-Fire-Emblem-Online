import { FEO } from "../config.mjs";

/**
 * @typedef ChatCard
 * @property {string} title
 * @property {string} [subtitle]
 * @property {{label: string, cls?: string}} [outcome]   A headline result
 * @property {{label: string, value: string|number, cls?: string}[]} [rows]
 * @property {string} [note]
 * @property {string} [cls]      A class for the card, for styles of its own
 */

/**
 * Post a system chat card on behalf of an Actor. Every string is expected to be localized already.
 * @param {Actor} actor
 * @param {ChatCard|object} card      The data for the card's template
 * @param {object} [options]
 * @param {Roll[]} [options.rolls]    Evaluated rolls to attach to the message
 * @param {string} [options.template] The chat template to render, by file name without its extension
 * @returns {Promise<ChatMessage>}
 */
export async function postCard(actor, card, { rolls = [], template = "card" } = {}) {
  const ChatMessage = foundry.documents.ChatMessage.implementation;
  const content = await foundry.applications.handlebars.renderTemplate(
    `systems/${FEO.id}/templates/chat/${template}.hbs`,
    card
  );
  const data = { speaker: ChatMessage.getSpeaker({ actor }), content, rolls };
  if ( rolls.length ) data.sound = CONFIG.sounds.dice;
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

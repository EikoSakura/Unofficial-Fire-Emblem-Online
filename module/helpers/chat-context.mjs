/**
 * What a chat card shows, and what it keeps for those who ask.
 *
 * A card in the chat is read at a glance in the middle of play: who did what, and what came of it. So its face
 * carries the headline and the results that matter, and everything else that was worked out or rolled is kept
 * with the message as a record. Right-clicking the message, or the magnifying glass on the card, opens that
 * record in a window of its own (see `apps/chat-inspector.mjs`).
 *
 * Nothing here touches Foundry, so that it can be exercised outside of it. Text is localized through whatever
 * `i18n` is passed in.
 *
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * @typedef CardRecord
 * @property {string} title
 * @property {string} [subtitle]
 * @property {{label: string, cls: string}} [outcome]
 * @property {{label: string, rows: {label: string, value: string, cls: string}[]}[]} sections
 * @property {string[]} notes
 * @property {string} [army]      The side whose colours the record wears
 */

/** The classes that mark a row as a result worth showing on the card itself. */
const HEADLINE = new Set(["strong", "good", "bad", "crit"]);

/** The groups the details of a fight are sorted into, in the order they are shown. */
const FIGHT_GROUPS = ["setup", "dice", "after"];

/* -------------------------------------------- */

/**
 * Does a row belong on the face of its card? One that is marked as a result (`strong`, `good`, `bad`, `crit`)
 * does; the rest are kept for the record. A row may settle it for itself with `face`.
 * @param {{cls?: string, face?: boolean}} row
 * @returns {boolean}
 */
export function onFace(row) {
  if ( typeof row?.face === "boolean" ) return row.face;
  return String(row?.cls ?? "").split(/\s+/).some((cls) => HEADLINE.has(cls));
}

/* -------------------------------------------- */

/**
 * What a card's template is given: the card with only what belongs on its face.
 * @param {object} card                 The card as its builder made it
 * @param {string} [template]           The chat template it is for
 * @returns {{face: object, more: boolean}}   The card for the template, and whether anything was kept back
 */
export function cardFace(card, template = "card") {
  switch ( template ) {
    case "card": {
      const rows = (card.rows ?? []).filter(onFace);
      return { face: { ...card, rows }, more: rows.length < (card.rows ?? []).length };
    }
    case "exchange":
      return { face: card, more: ((card.details ?? []).length + (card.notes ?? []).length) > 0 };
    case "class-change": {
      // Each group is told in a word or two: a stat with what it gained, a rank, the name of a skill
      const groups = (card.groups ?? []).map((group) => ({
        label: group.label,
        chips: group.rows.filter((row) => row.chip).map((row) => ({ ...row.chip, cls: row.cls ?? "" }))
      })).filter((group) => group.chips.length);
      return { face: { ...card, groups }, more: (card.groups ?? []).some((group) => group.rows.length) };
    }
    default:
      return { face: card, more: false };
  }
}

/* -------------------------------------------- */

/**
 * A row as the record keeps it.
 * @param {{label?: string, value?: string|number, cls?: string}} row
 * @returns {{label: string, value: string, cls: string}}
 */
function kept(row) {
  return { label: String(row.label ?? ""), value: String(row.value ?? ""), cls: String(row.cls ?? "") };
}

/* -------------------------------------------- */

/**
 * Everything a card has to tell, for the window that opens when it is inspected.
 * @param {object} card                 The card as its builder made it
 * @param {string} [template]           The chat template it is for
 * @param {Localizer} i18n
 * @returns {CardRecord|null}           Null for a card that keeps nothing back by its nature
 */
export function cardRecord(card, template = "card", i18n) {
  switch ( template ) {
    case "card": {
      const rows = (card.rows ?? []).map(kept);
      const record = { title: card.title ?? "", sections: rows.length ? [{ label: "", rows }] : [], notes: card.note ? [card.note] : [] };
      if ( card.subtitle ) record.subtitle = card.subtitle;
      if ( card.outcome?.label ) record.outcome = { label: card.outcome.label, cls: card.outcome.cls ?? "" };
      return record;
    }
    case "exchange": {
      const [first, second] = card.sides ?? [];
      const sections = FIGHT_GROUPS.map((group) => ({
        label: i18n.localize(`FEO.Chat.record.${group}`),
        rows: (card.details ?? []).filter((row) => (row.group ?? "setup") === group).map(kept)
      })).filter((section) => section.rows.length);
      return {
        title: i18n.format("FEO.Chat.versus", { first: first?.name ?? "", second: second?.name ?? "" }),
        sections,
        notes: [...(card.notes ?? [])],
        army: first?.army ?? ""
      };
    }
    case "class-change": {
      const record = {
        title: card.title ?? "",
        sections: (card.groups ?? []).map((group) => ({ label: group.label, rows: group.rows.map(kept) })),
        notes: [...(card.notes ?? [])]
      };
      if ( card.subtitle ) record.subtitle = card.subtitle;
      return record;
    }
    default:
      return null;
  }
}

/* -------------------------------------------- */

/**
 * The dice of a message as they fell, in the order they were rolled.
 * @param {{dice?: {results?: {result: number, active?: boolean}[]}[]}[]} rolls    The rolls of the message
 * @returns {number[]}
 */
export function diceOf(rolls = []) {
  return rolls.flatMap((roll) => (roll?.dice ?? []).flatMap((die) => {
    return (die.results ?? []).filter((result) => result.active !== false).map((result) => result.result);
  }));
}

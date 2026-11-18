import { FEO } from "../config.mjs";
import { RECORD_FLAG } from "../helpers/chat.mjs";
import { diceOf } from "../helpers/chat-context.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The window that opens when a chat card is inspected: everything the card was given, of which the card itself
 * shows only the headline and the results. It lists every row, the remarks, and the dice as they fell.
 *
 * It is opened by right-clicking a message and choosing Inspect, or with the magnifying glass on the card.
 * What it shows is the record `postCard` kept with the message (see `helpers/chat-context.mjs`), so a message
 * from before there were records has nothing to inspect.
 */
export default class ChatInspector extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {object} options
   * @param {ChatMessage} options.message     The message to inspect
   */
  constructor({ message, ...options } = {}) {
    super(options);
    this.message = message;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["feo-inspector"],
    window: {
      title: "FEO.Chat.inspect",
      icon: "fa-solid fa-magnifying-glass",
      resizable: true
    },
    position: { width: 400, height: "auto" }
  };

  /** @override */
  static PARTS = {
    record: {
      template: `systems/${FEO.id}/templates/chat/inspect.hbs`
    }
  };

  /* -------------------------------------------- */

  /**
   * The record a message keeps, if it keeps one.
   * @param {ChatMessage|null} message
   * @returns {import("../helpers/chat-context.mjs").CardRecord|null}
   */
  static recordOf(message) {
    return message?.getFlag(FEO.id, RECORD_FLAG) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Open the record of a message, or bring it to the front where it is open already.
   * @param {ChatMessage|null} message
   * @returns {ChatInspector|null}      Null for a message that keeps no record, or one this user may not read
   */
  static open(message) {
    if ( !ChatInspector.recordOf(message) || !message.isContentVisible ) return null;
    const id = `feo-inspect-${message.id}`;
    const open = foundry.applications.instances.get(id);
    if ( open ) {
      open.bringToFront();
      return open;
    }
    const inspector = new ChatInspector({ id, message });
    inspector.render({ force: true });
    return inspector;
  }

  /* -------------------------------------------- */

  /**
   * Add Inspect to the menu of a chat message, and have the magnifying glass on a card open it too.
   */
  static register() {
    const messageOf = (element) => game.messages.get(element?.closest?.("[data-message-id]")?.dataset.messageId);
    Hooks.on("getChatMessageContextOptions", (log, entries) => {
      entries.unshift({
        label: "FEO.Chat.inspect",
        icon: "fa-solid fa-magnifying-glass",
        visible: (li) => {
          const message = messageOf(li);
          return !!ChatInspector.recordOf(message) && message.isContentVisible;
        },
        onClick: (event, li) => ChatInspector.open(messageOf(li))
      });
    });
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-feo-inspect]");
      if ( !button ) return;
      event.preventDefault();
      ChatInspector.open(messageOf(button));
    });
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    const record = ChatInspector.recordOf(this.message);
    const inspect = game.i18n.localize("FEO.Chat.inspect");
    return record?.title ? `${inspect}: ${record.title}` : inspect;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const record = ChatInspector.recordOf(this.message) ?? { title: "", sections: [], notes: [] };
    return { ...record, dice: diceOf(this.message.rolls) };
  }
}

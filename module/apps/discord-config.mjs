import { FEO } from "../config.mjs";
import { parseWebhook } from "../rules/discord.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Discord menu of the system's settings: the webhook that pages of the rules journal are sent to.
 *
 * Anyone who has a webhook's address can post to its channel, so the address is kept in the browser of the Game
 * Master who entered it and nowhere else: not in the world, where every player's browser could read it. Once
 * saved it is not shown again, only replaced or forgotten.
 */
export default class DiscordConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** The setting that holds the webhook's address. */
  static WEBHOOK = "discordWebhook";

  /** The setting that remembers which messages each page was last sent as, so that they can be updated. */
  static POSTS = "discordPosts";

  /** The setting for whether a page's title, tables and diagrams are sent as pictures. */
  static PICTURES = "discordPictures";

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-discord-config",
    tag: "form",
    classes: ["feo-discord-config"],
    window: {
      title: "FEO.Discord.menu.name",
      contentClasses: ["standard-form"],
      icon: "fa-brands fa-discord"
    },
    form: {
      closeOnSubmit: false,
      handler: DiscordConfig.#onSubmit
    },
    position: { width: 520 }
  };

  /** @override */
  static PARTS = {
    form: {
      template: `systems/${FEO.id}/templates/settings/discord.hbs`
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /* -------------------------------------------- */

  /**
   * Add the menu and what it keeps to the system's settings.
   */
  static register() {
    game.settings.register(FEO.id, DiscordConfig.WEBHOOK, {
      scope: "client",
      config: false,
      type: String,
      default: ""
    });
    game.settings.register(FEO.id, DiscordConfig.POSTS, {
      scope: "client",
      config: false,
      type: Object,
      default: {}
    });
    game.settings.register(FEO.id, DiscordConfig.PICTURES, {
      scope: "client",
      config: false,
      type: Boolean,
      default: true
    });
    game.settings.registerMenu(FEO.id, "discord", {
      name: "FEO.Discord.menu.name",
      label: "FEO.Discord.menu.label",
      hint: "FEO.Discord.menu.hint",
      icon: "fa-brands fa-discord",
      type: DiscordConfig,
      restricted: true
    });
  }

  /* -------------------------------------------- */

  /**
   * The webhook saved in this browser, if there is one.
   * @returns {import("../rules/discord.mjs").DiscordWebhook|null}
   */
  static get webhook() {
    return parseWebhook(game.settings.get(FEO.id, DiscordConfig.WEBHOOK));
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const saved = DiscordConfig.webhook;
    return {
      id: this.id,
      saved: !!saved,
      status: saved
        ? game.i18n.format("FEO.Discord.webhook.saved", { tail: saved.id.slice(-4) })
        : game.i18n.localize("FEO.Discord.webhook.none"),
      pictures: game.settings.get(FEO.id, DiscordConfig.PICTURES) !== false,
      buttons: [
        { type: "submit", label: "SETTINGS.Save", icon: "fa-solid fa-floppy-disk" }
      ]
    };
  }

  /* -------------------------------------------- */

  /**
   * Save the address that was entered, or forget the one that was saved, and whether pictures are wanted. An
   * address that is not a Discord webhook is turned away and the window stays open.
   * @this {DiscordConfig}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const address = String(formData.object.webhook ?? "").trim();
    if ( address && !parseWebhook(address) ) {
      ui.notifications.error("FEO.Discord.webhook.invalid", { localize: true });
      return;
    }
    await game.settings.set(FEO.id, DiscordConfig.PICTURES, formData.object.pictures === true);
    if ( address ) {
      await game.settings.set(FEO.id, DiscordConfig.WEBHOOK, address);
      ui.notifications.info("FEO.Discord.webhook.kept", { localize: true });
    }
    else if ( formData.object.forget ) {
      await game.settings.set(FEO.id, DiscordConfig.WEBHOOK, "");
      ui.notifications.info("FEO.Discord.webhook.forgotten", { localize: true });
    }
    await this.close();
  }
}

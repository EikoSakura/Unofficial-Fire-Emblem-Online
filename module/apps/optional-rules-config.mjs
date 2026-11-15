import { FEO } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Optional Rules menu of the system's settings: every rule a world may choose to play with, in one window.
 *
 * The rules are ordinary world settings that are kept out of the main list of settings. `FEO.settingsMenu`
 * names them, group by group; each is shown as the tick box or the choice its registration describes.
 */
export default class OptionalRulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "feo-optional-rules",
    tag: "form",
    classes: ["feo-optional-rules"],
    window: {
      title: "FEO.Setting.menu.name",
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-book-open"
    },
    form: {
      closeOnSubmit: true,
      handler: OptionalRulesConfig.#onSubmit
    },
    position: { width: 600, height: 720 },
    actions: {
      reset: OptionalRulesConfig.#onReset
    }
  };

  /** @override */
  static PARTS = {
    form: {
      template: `systems/${FEO.id}/templates/settings/optional-rules.hbs`,
      scrollable: [""]
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /* -------------------------------------------- */

  /**
   * Add the menu to the system's settings.
   */
  static register() {
    game.settings.registerMenu(FEO.id, "optionalRules", {
      name: "FEO.Setting.menu.name",
      label: "FEO.Setting.menu.label",
      hint: "FEO.Setting.menu.hint",
      icon: "fa-solid fa-book-open",
      type: OptionalRulesConfig,
      restricted: true
    });
  }

  /* -------------------------------------------- */

  /**
   * The settings of the menu as they are registered.
   * @returns {object[]}
   */
  static get settings() {
    return Object.values(FEO.settingsMenu).flat()
      .map((key) => game.settings.settings.get(`${FEO.id}.${key}`))
      .filter(Boolean);
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const groups = Object.entries(FEO.settingsMenu).map(([group, keys]) => ({
      label: `FEO.Setting.group.${group}`,
      settings: keys.flatMap((key) => {
        const setting = game.settings.settings.get(`${FEO.id}.${key}`);
        if ( !setting ) return [];
        return [{
          key,
          id: `${this.id}-${key}`,
          name: setting.name,
          hint: setting.hint,
          value: game.settings.get(FEO.id, key),
          choices: setting.choices ?? null
        }];
      })
    }));
    return {
      groups: groups.filter((group) => group.settings.length),
      buttons: [
        { type: "button", label: "FEO.Setting.menu.reset", icon: "fa-solid fa-arrow-rotate-left", action: "reset" },
        { type: "submit", label: "SETTINGS.Save", icon: "fa-solid fa-floppy-disk" }
      ]
    };
  }

  /* -------------------------------------------- */

  /**
   * Put every rule back to how a new world starts. Nothing is saved until the form is.
   * @this {OptionalRulesConfig}
   */
  static #onReset() {
    for ( const setting of OptionalRulesConfig.settings ) {
      const input = this.form.elements[setting.key];
      if ( !input ) continue;
      if ( input.type === "checkbox" ) input.checked = setting.default === true;
      else input.value = setting.default;
    }
    ui.notifications.info("SETTINGS.ResetInfo", { localize: true });
  }

  /* -------------------------------------------- */

  /**
   * Save the rules that were changed. The system reads them as the world loads, so a change asks for a reload.
   * @this {OptionalRulesConfig}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    let reload = false;
    for ( const setting of OptionalRulesConfig.settings ) {
      if ( !(setting.key in formData.object) ) continue;
      const value = formData.object[setting.key];
      if ( value === game.settings.get(FEO.id, setting.key) ) continue;
      try {
        await game.settings.set(FEO.id, setting.key, value);
        reload ||= !!setting.requiresReload;
      } catch(err) {
        ui.notifications.error(err);
      }
    }
    if ( reload ) await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  }
}

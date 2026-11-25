import { FEO } from "../config.mjs";
import { icon } from "../apps/compendium-context.mjs";
import { buildItemView } from "../sheets/item-view.mjs";
import { buildSkillCard } from "./skill-card-context.mjs";

/**
 * Display data for an item shown to the table as a card in the chat: what it is and what it does, for those who
 * do not have its sheet open. Showing an item uses nothing of it.
 *
 * Nothing here touches Foundry, so that it can be exercised outside of it. Text is localized through whatever
 * `i18n` is passed in.
 *
 * @import {Localizer} from "./exchange-context.mjs"
 */

/**
 * @typedef {object} ItemCard
 * @property {string} name
 * @property {string} icon        The icon of what it is, as SVG markup
 * @property {string} img         Its own image, when it has one worth showing in place of the icon
 * @property {string} kind        What it is, in words
 * @property {string} effect      Its Effect, as text
 * @property {{label: string, value: string|number, cls: string, tip: string}[]} cells    Its numbers, a box each
 * @property {{label: string, value: string|number}[]} rows     What else is worth knowing of it, a line each
 * @property {string} [note]      What the last of those lines does: the Effect of a Battalion's Gambit
 */

/** The words of a line, joined. */
const line = (...parts) => parts.filter(Boolean).join(" · ");

/** The boxes of the first section of an item's sheet that has any. */
function cellsOf(view) {
  const section = view.sections.find((entry) => entry.cells?.length);
  return (section?.cells ?? []).map((cell) => ({
    label: cell.abbr,
    value: cell.value,
    cls: cell.css ?? "",
    tip: cell.label ?? ""
  }));
}

/* -------------------------------------------- */

/**
 * Build the card of an item, with the chat template it is for. A skill is shown on the card skills have of
 * their own; anything else on the one built here.
 * @param {object} item           An Item, or anything shaped like one: its name, image, type, system data, and
 *                                the actor that carries it if one does
 * @param {Localizer} i18n
 * @returns {{template: string, card: ItemCard|object}}
 */
export function buildItemCard(item, i18n) {
  if ( item.type === "skill" ) return { template: "skill", card: buildSkillCard(item, i18n) };

  // What the item's sheet says of it while it is read, cut down to what a card has room for
  const view = buildItemView(item, i18n);
  const system = item.system;
  const card = {
    name: view.name,
    icon: view.emblem || icon("banner"),
    img: view.art ?? "",
    kind: line(view.ribbon, view.sub),
    effect: view.effect ?? "",
    cells: [],
    rows: []
  };

  switch ( item.type ) {
    case "weapon":
      card.cells = cellsOf(view);
      break;

    case "art":
      card.rows = [...(view.sections[0]?.pairs ?? [])];
      break;

    // A Battalion: where it stands, what it adds to its commander, and its Gambit
    case "battalion": {
      const gambit = system.gambit;
      const at = (key, data = {}) => i18n.format(`FEO.Optional.battalions.${key}`, data);
      card.cells = cellsOf(view);
      card.rows = [
        { label: at("authorityRank"), value: i18n.localize(FEO.ranks[system.rank] ?? "") },
        { label: i18n.localize("FEO.Unit.level"), value: system.level },
        { label: i18n.localize("FEO.Stat.hp.abbr"), value: `${system.hp.value} / ${system.hp.max}` }
      ];
      card.rows.push(
        {
          label: gambit.name || at("gambit"),
          value: (gambit.kind === "offensive")
            ? at("gambitLine", { might: gambit.might, hit: gambit.hit })
            : i18n.localize(FEO.optional.battalions.gambit.kinds[gambit.kind] ?? "")
        },
        { label: i18n.localize("FEO.Weapon.range"), value: gambit.range || "–" }
      );
      if ( gambit.uses.max > 0 ) {
        card.rows.push({ label: i18n.localize("FEO.Weapon.uses"), value: `${gambit.uses.value} / ${gambit.uses.max}` });
      }
      card.note = gambit.effect ?? "";
      break;
    }

    case "class":
      break;

    // Anything carried: what is left of it, and what it restores
    default:
      card.kind = view.sub || view.ribbon;
      if ( !system.equip || (system.uses.max > 0) ) {
        card.rows.push({
          label: i18n.localize("FEO.Weapon.uses"),
          value: (system.uses.max > 0) ? `${system.uses.value} / ${system.uses.max}` : "∞"
        });
      }
      if ( system.restore > 0 ) card.rows.push({ label: i18n.localize("FEO.Item.restore"), value: system.restore });
  }
  return { template: "item", card };
}

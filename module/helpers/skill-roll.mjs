import Compendium from "../apps/compendium.mjs";
import { findSkill } from "../apps/compendium-context.mjs";
import { readPrerequisite } from "../rules/creation-fit.mjs";

/**
 * Taking a Generic Skill from the Compendium's roll of skills: for a new unit in the Character Creator, and for a
 * unit that gains one on promoting.
 */

/** What the roll says to whoever takes a skill from it, where the taker gives no words of their own. */
const TEXT = "FEO.Creator.roll";

/**
 * Open the Compendium at the roll of skills, with a button on its skill sheet that takes a Generic Skill for a
 * unit. Taking another gives up the one taken before.
 * @param {Actor} actor
 * @param {object} taker
 * @param {() => {name: string, items: string[]}} taker.had   The Generic Skill taken so far, and the Items it
 *                                                            was added as; a blank name for none
 * @param {(skill: object) => Promise<any>} taker.choose      Takes a skill of the roll
 * @param {() => string} [taker.refuse]       Why the unit may take none, in words; blank when it may
 * @param {Record<string, string>} [taker.text]   Keys of the words to use in place of those under
 *                                                FEO.Creator.roll, by their last part
 * @returns {Promise<Compendium>}
 */
export function openGenericRoll(actor, { had, choose, refuse = () => "", text = {} }) {
  const i18n = game.i18n;
  const say = (key, data) => i18n.format(text[key] ?? `${TEXT}.${key}`, data);
  const describe = (skill, library) => {
    const unit = actor.name;
    const taken = had();
    const refused = refuse();
    if ( refused ) return { can: false, barred: true, text: refused };
    if ( skill.kind !== "generic" ) return { can: false, barred: true, text: say("notGeneric", { unit }) };
    if ( taken.name === skill.name ) return { can: false, chosen: true, text: say("chosen", { unit }) };

    // What the unit has apart from the Generic Skill this one would take the place of
    const owned = actor.items.filter((item) => (item.type === "skill") && !taken.items.includes(item.id)).map((item) => item.name);
    if ( owned.some((name) => name.toLowerCase() === skill.name.toLowerCase()) ) {
      return { can: false, barred: true, text: say("owned", { unit }) };
    }
    const need = readPrerequisite(skill.prerequisite, {
      unit: actor._source.system,
      cls: actor.system.classItem,
      isSkill: (name) => !!findSkill(library, name),
      owned
    });
    const unmet = need.state === "unmet";
    return {
      can: true,
      barred: unmet,
      text: unmet ? say("unmet", { unit, what: need.text.replace(/\.$/, "") })
        : taken.name ? say("change", { from: taken.name }) : say("take", { unit }),
      label: say(taken.name ? "changeTo" : "choose", { name: skill.name })
    };
  };
  const banner = () => {
    const taken = had().name;
    return {
      text: say("banner", { unit: actor.name }),
      tags: taken ? [{ label: say("has"), value: taken }] : [],
      note: say("note")
    };
  };
  return Compendium.open({
    view: "skills",
    kind: "generic",
    skill: had().name,
    chooser: { takes: "skill", actor: actor.uuid, describe, choose, banner }
  });
}

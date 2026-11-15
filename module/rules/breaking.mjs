/**
 * Breaking and the Extended Weapon Triangle, an Optional Module of two rules that a world uses together or one
 * without the other. Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * Break: a unit that begins a fight with weapon triangle advantage and lands a hit that deals at least 1
 * damage takes the counter-attack from its foe. The foe makes no further attack in that fight, and no
 * counter-attack in its next fight, unless its own turn starts first. Break is no condition: nothing cures it,
 * and it is kept on the unit as a mark of its own. Armored units never suffer from it.
 *
 * The extended triangle gives more weapon types an advantage over one another, so that they can Break too:
 *
 *   Swords and Katanas beat Axes and Maces, which beat Lances, Scythes and Poles, which beat Swords and Katanas
 *   Brawl and Whips beat Bows and Crossbows, which beat Knives, which beat Brawl and Whips
 *   Anima beats Light, which beats Dark and Blood, which beat Anima
 *   Pistols beat Knives and Brawl; Rifles and Handcannons beat Pistols, Bows and Crossbows; magic beats Rifles
 *   and Handcannons; Arcanima beats Anima, and Dark and Light beat Arcanima
 *
 * with the five elements of Anima as they were. The system has weapons for only some of these types, and the
 * others count for nothing until it has weapons for them.
 */
import { FEO } from "../config.mjs";

/**
 * Does the world play with Break?
 * @returns {boolean}
 */
export function breakInUse() {
  const config = FEO.optional.breaking;
  return config.enabled && config.breaks.includes(config.mode);
}

/* -------------------------------------------- */

/**
 * Does the world play with the extended weapon triangle?
 * @returns {boolean}
 */
export function extendedInUse() {
  const config = FEO.optional.breaking;
  return config.enabled && config.extended.includes(config.mode);
}

/* -------------------------------------------- */

/**
 * The extended weapon triangle, laid out as `FEO.triangle` is: for each weapon category the categories it
 * beats and those it loses to. Only the categories the system has weapons for are in it.
 * @param {Record<string, {magic?: boolean}>} [categories]    The weapon categories there are
 * @returns {Record<string, {beats: string[], losesTo: string[]}>}
 */
export function extendedTriangle(categories = FEO.weaponCategories) {
  const config = FEO.optional.breaking;
  const known = (category) => category in categories;
  const beats = {};
  for ( const [category, beaten] of Object.entries(config.beats) ) {
    if ( known(category) ) beats[category] = beaten.filter(known);
  }

  // Every tome has the advantage over the firearms magic beats, except the kinds that stand apart
  const magicBeats = config.magicBeats.filter(known);
  for ( const [category, data] of magicBeats.length ? Object.entries(categories) : [] ) {
    if ( !data.magic || config.apart.includes(category) ) continue;
    beats[category] = [...new Set([...(beats[category] ?? []), ...magicBeats])];
  }

  const table = {};
  for ( const category of Object.keys(categories) ) {
    const wins = beats[category] ?? [];
    const losesTo = Object.keys(beats).filter((other) => beats[other].includes(category));
    if ( wins.length || losesTo.length ) table[category] = { beats: wins, losesTo };
  }
  return table;
}

/* -------------------------------------------- */

/**
 * Is a unit immune to Break by one of its Special Qualities?
 * @param {string} [qualities]    Its Special Qualities, as free text
 * @returns {boolean}
 */
export function immuneToBreak(qualities) {
  return FEO.optional.breaking.immune.some((quality) => {
    return new RegExp(`(^|[^a-z])${quality}([^a-z]|$)`, "i").test(qualities ?? "");
  });
}

/* -------------------------------------------- */

/**
 * Would the hits of the unit that begins a fight Break its foe? It needs weapon triangle advantage, and a foe
 * that still stands and is not immune.
 * @param {object} fight
 * @param {number} fight.triangle           1 when the unit that begins the fight has the advantage
 * @param {{hp?: number, incapacitated?: boolean, qualities?: string}} fight.foe
 * @returns {boolean}
 */
export function wouldBreak({ triangle, foe }) {
  return breakInUse() && (triangle > 0) && ((foe?.hp ?? 0) > 0) && !foe.incapacitated && !immuneToBreak(foe.qualities);
}

/* -------------------------------------------- */

/**
 * Does a unit suffer from Break once a fight it took part in is over? The Break it carried into the fight ends
 * with it, and one it came to suffer from in the fight stays for its next. A unit that fell carries none.
 * @param {object} unit
 * @param {boolean} [unit.gained]     Did it come to suffer from Break in this fight?
 * @param {number} [unit.hp]          The HP it has left
 * @returns {boolean}
 */
export function breakAfter({ gained = false, hp = 0 } = {}) {
  return breakInUse() && gained && (hp > 0);
}

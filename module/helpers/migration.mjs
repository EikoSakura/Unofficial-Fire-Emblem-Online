import { FEO } from "../config.mjs";
import { planRefresh, shelve, sourceOf } from "../rules/migration.mjs";
import { pickedOf, picksOpen } from "../rules/picks.mjs";
import { START, givesRanks, rankSteps, readGiven } from "../rules/skill-ranks.mjs";
import { postCard } from "./chat.mjs";
import { pickUnit } from "./picks.mjs";

/**
 * Bringing the skills units already have up to date with the skills compendium, as it is done in Foundry: when
 * a Game Master opens a world whose skills compendium has changed since the world last looked, every skill in
 * the Items sidebar, on a unit and on a token of its own takes from its entry what the skill is, and keeps
 * what is its unit's own. What a skill takes is decided by the pure rules in `rules/migration.mjs`.
 *
 * It can be run again at any time with `game.feo.migration.refreshSkills()`.
 */

/** The world setting that keeps which skills compendium the world's skills were last brought up to date with. */
const SETTING = "skillsRefreshed";

/**
 * What marks an update as one of these, for whoever listens to skills changing: a skill that is brought up to
 * date gives no weapon rank it had not given (see `helpers/skill-ranks.mjs`).
 */
const REFRESHED = { [FEO.id]: { refreshed: true } };

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The compendiums of the system that hold skills.
 * @returns {CompendiumCollection[]}
 */
function skillPacks() {
  return game.packs.filter((pack) => {
    return (pack.documentName === "Item") && (pack.metadata.packageType === "system")
      && (pack.metadata.packageName === FEO.id) && pack.index.some((entry) => entry.type === "skill");
  });
}

/* -------------------------------------------- */

/**
 * What tells one build of the skills compendium from another: the version of the system, and when its skills
 * were last written.
 * @param {CompendiumCollection[]} packs
 * @returns {Promise<string>}
 */
async function stampOf(packs) {
  let written = 0;
  for ( const pack of packs ) {
    const index = await pack.getIndex({ fields: ["_stats.modifiedTime"] });
    for ( const entry of index ) {
      if ( entry.type === "skill" ) written = Math.max(written, Number(entry._stats?.modifiedTime) || 0);
    }
  }
  return `${game.system.version}:${written}`;
}

/* -------------------------------------------- */

/**
 * Read the skills of the compendiums.
 * @param {CompendiumCollection[]} packs
 * @returns {Promise<import("../rules/migration.mjs").SkillShelf>}
 */
async function readShelf(packs) {
  const entries = [];
  for ( const pack of packs ) {
    for ( const document of await pack.getDocuments() ) {
      if ( document.type !== "skill" ) continue;
      entries.push({ uuid: document.uuid, name: document.name, img: document.img, system: document.toObject().system });
    }
  }
  return shelve(entries);
}

/* -------------------------------------------- */

/**
 * What each skill among some Items takes from its entry.
 * @param {Iterable<Item>} items
 * @param {import("../rules/migration.mjs").SkillShelf} shelf
 * @returns {{item: Item, update: object}[]}    The skills that change, each with what to save
 */
function plansOf(items, shelf) {
  const { ForcedReplacement } = foundry.data.operators;
  const prefix = `Compendium.${FEO.id}.`;
  const plans = [];
  for ( const item of items ) {
    if ( item.type !== "skill" ) continue;
    const { entry } = sourceOf(item._source, shelf, { prefix });
    const plan = entry ? planRefresh(item._source, entry) : null;
    if ( !plan ) continue;

    // A list or an object is put in place of the old one whole, so that nothing of the old one is left in it
    const update = { _id: item.id };
    const fields = Object.entries(plan.system).map(([key, value]) => {
      const copy = foundry.utils.deepClone(value);
      return [key, (copy !== null) && (typeof copy === "object") ? new ForcedReplacement(copy) : copy];
    });
    if ( fields.length ) update.system = Object.fromEntries(fields);
    if ( plan.img ) update.img = plan.img;
    if ( plan.link ) update._stats = { compendiumSource: plan.link };
    plans.push({ item, update });
  }
  return plans;
}

/* -------------------------------------------- */
/*  Saving                                      */
/* -------------------------------------------- */

/**
 * Bring the skills of one unit up to date.
 * @param {Actor} actor       A unit of the Actors list, or the unit of a token of its own
 * @param {string} name       What to call it
 * @param {import("../rules/migration.mjs").SkillShelf} shelf
 * @param {(item: Item) => boolean} [mine]    Which of its skills to look at; all of them when left out
 * @returns {Promise<{name: string, skills: string[], picks: string[], ranks: string[]}|null>}
 *   The skills that changed; among them those that now ask for a pick, and those that give a weapon rank the
 *   unit was not given; null when nothing changed
 */
async function refreshUnit(actor, name, shelf, mine = () => true) {
  const plans = plansOf(actor.items.filter(mine), shelf);
  if ( !plans.length ) return null;
  await actor.updateEmbeddedDocuments("Item", plans.map((plan) => plan.update), REFRESHED);

  const unit = pickUnit(actor);
  const given = new Set(readGiven(actor.system.skillRanks).map((entry) => entry.item));
  const kept = actor.system.creation?.ranks?.first ?? "";
  const report = { name, skills: [], picks: [], ranks: [] };
  for ( const { item } of plans ) {
    report.skills.push(item.name);
    if ( picksOpen(item.system, unit) ) report.picks.push(item.name);
    if ( !givesRanks(item.system) || given.has(item.id) ) continue;
    const start = kept || (pickedOf(item.system, START)[0] ?? "");
    if ( Object.keys(rankSteps(item.system, { start })).length ) report.ranks.push(item.name);
  }
  return report;
}

/* -------------------------------------------- */

/**
 * Bring every skill of the world up to date with the skills compendium: those in the Items sidebar, those of
 * the units in the Actors list, and those of tokens that are units of their own. A Game Master's to do.
 * @param {object} [options]
 * @param {boolean} [options.tell]    Post what changed to the Game Masters?
 * @returns {Promise<{world: string[], units: {name: string, skills: string[], picks: string[], ranks: string[]}[]}|null>}
 *   The skills of the Items sidebar that changed, and the units whose skills did; null for a player
 */
export async function refreshSkills({ tell = true } = {}) {
  if ( !game.user.isGM ) return null;
  const packs = skillPacks();
  const shelf = await readShelf(packs);
  const report = { world: [], units: [] };

  const attempt = async (what, work) => {
    try {
      return await work();
    } catch(err) {
      console.error(`${FEO.id} | The skills of ${what} could not be brought up to date.`, err);
      return null;
    }
  };

  const world = plansOf(game.items, shelf);
  if ( world.length ) {
    await attempt("the Items sidebar", async () => {
      await foundry.documents.Item.implementation.updateDocuments(world.map((plan) => plan.update), REFRESHED);
      report.world = world.map((plan) => plan.item.name);
    });
  }

  for ( const actor of game.actors ) {
    if ( actor.type !== "unit" ) continue;
    const told = await attempt(actor.name, () => refreshUnit(actor, actor.name, shelf));
    if ( told ) report.units.push(told);
  }

  // A token that is a unit of its own has the skills of its Actor, which are up to date by now, but for those
  // it keeps a copy of for itself: only these are looked at, so that it is given no copy it did not have
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      const actor = token.actorLink ? null : token.actor;
      if ( actor?.type !== "unit" ) continue;
      const own = new Set((token.delta?._source?.items ?? []).filter((item) => !item._tombstone).map((item) => item._id));
      if ( !own.size ) continue;
      const name = `${token.name} (${scene.name})`;
      const told = await attempt(name, () => refreshUnit(actor, name, shelf, (item) => own.has(item.id)));
      if ( told ) report.units.push(told);
    }
  }

  if ( tell ) await tellRefreshed(report);
  return report;
}

/* -------------------------------------------- */

/**
 * Tell the Game Masters what was brought up to date: how much on the card, and unit by unit behind it.
 * @param {{world: string[], units: {name: string, skills: string[], picks: string[], ranks: string[]}[]}} report
 * @returns {Promise<ChatMessage|null>}     Null when nothing changed
 */
async function tellRefreshed(report) {
  const i18n = game.i18n;
  const skills = report.world.length + report.units.reduce((count, unit) => count + unit.skills.length, 0);
  if ( !skills ) return null;

  const rows = report.units.map((unit) => ({ label: unit.name, value: unit.skills.join(", ") }));
  if ( report.world.length ) rows.unshift({ label: i18n.localize("FEO.Migration.world"), value: report.world.join(", ") });

  // What is left for the table to see to
  const listed = (key) => report.units.filter((unit) => unit[key].length)
    .map((unit) => `${unit.name}: ${unit[key].join(", ")}`).join("; ");
  const notes = [];
  const picks = listed("picks");
  const ranks = listed("ranks");
  if ( picks ) notes.push(i18n.format("FEO.Migration.picks", { list: picks }));
  if ( ranks ) notes.push(i18n.format("FEO.Migration.ranks", { list: ranks }));

  return postCard(null, {
    title: i18n.localize("FEO.Migration.title"),
    subtitle: i18n.format("FEO.Migration.count", { skills, units: report.units.length }),
    rows,
    note: notes.join(" ")
  }, { whisper: game.users.filter((user) => user.isGM).map((user) => user.id) });
}

/* -------------------------------------------- */
/*  Registering                                 */
/* -------------------------------------------- */

/**
 * Bring the world's skills up to date if the skills compendium is not the one they were last brought up to
 * date with: after the system is updated, and after the compendium is built again.
 * @returns {Promise<boolean>}    Was there anything to look at?
 */
async function refreshIfStale() {
  const stamp = await stampOf(skillPacks());
  if ( game.settings.get(FEO.id, SETTING) === stamp ) return false;
  await refreshSkills();
  await game.settings.set(FEO.id, SETTING, stamp);
  return true;
}

/* -------------------------------------------- */

/**
 * Register the setting the world remembers its skills compendium by, and have one Game Master look as the
 * world opens. Called once, when the system starts.
 */
export function registerMigration() {
  game.settings.register(FEO.id, SETTING, { scope: "world", config: false, type: String, default: "" });
  Hooks.once("ready", () => {
    if ( game.users.activeGM?.isSelf ) refreshIfStale().catch((err) => console.error(err));
  });
}

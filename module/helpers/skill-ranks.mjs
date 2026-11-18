import { FEO } from "../config.mjs";
import { AFFINITY_RANK, affinityRankOf } from "../rules/optional.mjs";
import { pickedOf } from "../rules/picks.mjs";
import { START, givesRanks, planSkillRanks, rankSteps, readGiven, readsStart } from "../rules/skill-ranks.mjs";

/**
 * The weapon ranks skills give, as they are saved in Foundry: a unit's rank rises when it takes such a skill or
 * chooses its variant, and falls back when the skill goes or the choice changes. What changes is decided by the
 * pure rules in `rules/skill-ranks.mjs`.
 *
 * Only the skill that was just added, changed or removed is looked at, so a unit whose rank was raised by hand
 * before the system did it is left as it is.
 *
 * The rank an Affinity gives in a proficiency of its unit's choice is kept the same way, as if the Affinity
 * were one more skill (see `affinityRankOf` in `rules/optional.mjs`).
 */

/** What is still being saved for each unit, so that one change follows another. */
const queue = new Map();

/** What the table is told of a rank a skill raised, and of one that fell back. */
const SKILL_NEWS = { raised: "FEO.Skill.rankRaised", lowered: "FEO.Skill.rankLowered" };

/** The same for the rank of an Affinity. */
const AFFINITY_NEWS = { raised: "FEO.Skill.rankRaised", lowered: "FEO.Optional.affinityEffect.rankLowered" };

/**
 * Wait until the ranks a unit's skills give are saved. Whoever sets ranks from what the unit holds waits for
 * this first.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export function settled(actor) {
  return queue.get(actor.uuid) ?? Promise.resolve();
}

/* -------------------------------------------- */

/**
 * The unit a skill is on, when it is on one. A token that is not linked keeps its Items on its delta.
 * @param {Item} item
 * @returns {Actor|null}
 */
function unitOf(item) {
  if ( item.type !== "skill" ) return null;
  const parent = item.parent;
  const actor = parent?.documentName === "ActorDelta" ? parent.syntheticActor : parent;
  return (actor?.documentName === "Actor") && (actor.type === "unit") ? actor : null;
}

/* -------------------------------------------- */

/**
 * Save what some givers of ranks change about a unit, once whatever is still being saved for it is.
 * @param {Actor} actor
 * @param {() => {item: string, name?: string, wanted?: Record<string, number>}[]} read
 *   The givers to look at, as they are by the time their turn comes: see `planSkillRanks`
 * @param {{raised: string, lowered: string}} news    What to tell the table, as keys of the language file
 * @returns {Promise<void>}
 */
function save(actor, read, news) {
  const work = async () => {
    const system = actor.system;
    const ranks = Object.fromEntries(Object.entries(system.proficiencies).map(([key, proficiency]) => [key, proficiency.rank]));
    const held = {};
    for ( const [key, record] of Object.entries(system.holyBlood?.ranks ?? {}) ) if ( record.from ) held[key] = record.from;
    const plan = planSkillRanks(ranks, system.skillRanks, read(), { held });
    if ( !plan ) return;

    const update = { "system.skillRanks": plan.given };
    for ( const [key, rank] of Object.entries(plan.ranks) ) update[`system.proficiencies.${key}.rank`] = rank;
    for ( const [key, rank] of Object.entries(plan.held) ) update[`system.holyBlood.ranks.${key}.from`] = rank;
    await actor.update(update);

    // The table is told of the ranks that rose; of those that fell only when none did, as a rank that moves
    // from one proficiency to another is one piece of news
    const i18n = game.i18n;
    const order = Object.keys(FEO.ranks);
    const rose = (change) => order.indexOf(change.to) > order.indexOf(change.from);
    const told = plan.changes.some(rose) ? plan.changes.filter(rose) : plan.changes;
    for ( const change of told ) {
      ui.notifications.info(i18n.format(rose(change) ? news.raised : news.lowered, {
        unit: actor.name,
        skill: change.skill,
        proficiency: i18n.localize(FEO.proficiencies[change.key] ?? change.key),
        from: i18n.localize(FEO.ranks[change.from] ?? change.from),
        to: i18n.localize(FEO.ranks[change.to] ?? change.to)
      }));
    }
  };
  const run = settled(actor).then(work).catch((error) => console.error(error));
  queue.set(actor.uuid, run);
  run.then(() => {
    if ( queue.get(actor.uuid) === run ) queue.delete(actor.uuid);
  });
  return run;
}

/* -------------------------------------------- */

/**
 * Give a unit the ranks some of its skills give and have not given yet, and take back what they no longer give.
 * @param {Actor} actor
 * @param {{id: string, name: string}[]} skills     The skills to look at; one that is gone gives nothing
 * @returns {Promise<void>}
 */
export function syncSkillRanks(actor, skills) {
  return save(actor, () => {
    // The proficiency the unit started with: the one the Creator kept or, for a unit it did not make, the one
    // picked on the skill as it was learnt
    const kept = actor.system.creation?.ranks?.first ?? "";
    return skills.map(({ id, name }) => {
      const item = actor.items.get(id);
      const start = kept || (item ? (pickedOf(item.system, START)[0] ?? "") : "");
      return { item: id, name: item?.name ?? name, wanted: item ? rankSteps(item.system, { start }) : {} };
    });
  }, SKILL_NEWS);
}

/* -------------------------------------------- */

/**
 * Give a unit the rank its Affinity gives in the proficiency chosen for it, and take back what it gave before:
 * for another choice, or for an Affinity the unit no longer has.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export function syncAffinityRank(actor) {
  return save(actor, () => {
    const system = actor.system;
    const label = FEO.affinities[system.affinity];
    const name = label
      ? game.i18n.format("FEO.Optional.affinityEffect.name", { affinity: game.i18n.localize(label) }) : "";
    return [{ item: AFFINITY_RANK, name, wanted: affinityRankOf(system)?.wanted ?? {} }];
  }, AFFINITY_NEWS);
}

/* -------------------------------------------- */

/**
 * Register what the ranks of skills listen for. Called once, when the system starts. Whoever made a change is
 * the one who saves what follows from it.
 */
export function registerHooks() {
  const gave = (actor, id) => readGiven(actor.system.skillRanks).some((entry) => entry.item === id);
  const look = (item, userId, wanted) => {
    if ( userId !== game.user.id ) return;

    // A skill a unit took on as it imitates another gives it no rank: the ranks it took on already count it
    if ( item.flags?.[FEO.id]?.imitated ) return;
    const actor = unitOf(item);
    if ( actor && wanted(actor) ) syncSkillRanks(actor, [{ id: item.id, name: item.name }]);
  };
  Hooks.on("createItem", (item, options, userId) => look(item, userId, () => givesRanks(item.system)));
  Hooks.on("deleteItem", (item, options, userId) => look(item, userId, (actor) => gave(actor, item.id)));
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if ( !["choice", "effects", "automate"].some((key) => key in (changed.system ?? {})) ) return;
    look(item, userId, (actor) => givesRanks(item.system) || gave(actor, item.id));
  });

  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( (userId !== game.user.id) || (actor.type !== "unit") ) return;

    // The proficiency a unit started with is chosen in the Creator, after its skills
    if ( changed.system?.creation?.ranks ) {
      const skills = actor.items.filter((item) => (item.type === "skill") && readsStart(item.system));
      if ( skills.length ) syncSkillRanks(actor, skills.map((item) => ({ id: item.id, name: item.name })));
    }

    // The rank of an Affinity follows the Affinity and the proficiency chosen for it
    if ( ["affinity", "affinityRank"].some((key) => key in (changed.system ?? {})) ) syncAffinityRank(actor);
  });

  // A world that begins or ceases to play with the Additional Affinity Effects has the ranks follow, which is
  // one Game Master's to see to as the world opens
  Hooks.once("ready", () => {
    if ( !game.users.activeGM?.isSelf ) return;
    for ( const actor of game.actors ) {
      if ( actor.type !== "unit" ) continue;
      if ( actor.system.affinityRank || gave(actor, AFFINITY_RANK) ) syncAffinityRank(actor);
    }
  });
}

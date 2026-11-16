import { FEO } from "../config.mjs";
import { givesRanks, planSkillRanks, rankSteps, readGiven, readsStart } from "../rules/skill-ranks.mjs";

/**
 * The weapon ranks skills give, as they are saved in Foundry: a unit's rank rises when it takes such a skill or
 * chooses its variant, and falls back when the skill goes or the choice changes. What changes is decided by the
 * pure rules in `rules/skill-ranks.mjs`.
 *
 * Only the skill that was just added, changed or removed is looked at, so a unit whose rank was raised by hand
 * before the system did it is left as it is.
 */

/** What is still being saved for each unit, so that one change follows another. */
const queue = new Map();

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
 * Give a unit the ranks some of its skills give and have not given yet, and take back what they no longer give.
 * @param {Actor} actor
 * @param {{id: string, name: string}[]} skills     The skills to look at; one that is gone gives nothing
 * @returns {Promise<void>}
 */
export function syncSkillRanks(actor, skills) {
  const work = async () => {
    const system = actor.system;
    const start = system.creation?.ranks?.first ?? "";
    const ranks = Object.fromEntries(Object.entries(system.proficiencies).map(([key, proficiency]) => [key, proficiency.rank]));
    const held = {};
    for ( const [key, record] of Object.entries(system.holyBlood?.ranks ?? {}) ) if ( record.from ) held[key] = record.from;
    const plan = planSkillRanks(ranks, system.skillRanks, skills.map(({ id, name }) => {
      const item = actor.items.get(id);
      return { item: id, name: item?.name ?? name, wanted: item ? rankSteps(item.system, { start }) : {} };
    }), { held });
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
    const news = plan.changes.some(rose) ? plan.changes.filter(rose) : plan.changes;
    for ( const change of news ) {
      ui.notifications.info(i18n.format(rose(change) ? "FEO.Skill.rankRaised" : "FEO.Skill.rankLowered", {
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
 * Register what the ranks of skills listen for. Called once, when the system starts. Whoever made a change is
 * the one who saves what follows from it.
 */
export function registerHooks() {
  const gave = (actor, item) => readGiven(actor.system.skillRanks).some((entry) => entry.item === item.id);
  const look = (item, userId, wanted) => {
    if ( userId !== game.user.id ) return;
    const actor = unitOf(item);
    if ( actor && wanted(actor) ) syncSkillRanks(actor, [{ id: item.id, name: item.name }]);
  };
  Hooks.on("createItem", (item, options, userId) => look(item, userId, () => givesRanks(item.system)));
  Hooks.on("deleteItem", (item, options, userId) => look(item, userId, (actor) => gave(actor, item)));
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if ( !["choice", "effects", "automate"].some((key) => key in (changed.system ?? {})) ) return;
    look(item, userId, (actor) => givesRanks(item.system) || gave(actor, item));
  });

  // The proficiency a unit started with is chosen in the Creator, after its skills
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if ( (userId !== game.user.id) || (actor.type !== "unit") || !changed.system?.creation?.ranks ) return;
    const skills = actor.items.filter((item) => (item.type === "skill") && readsStart(item.system));
    if ( skills.length ) syncSkillRanks(actor, skills.map((item) => ({ id: item.id, name: item.name })));
  });
}

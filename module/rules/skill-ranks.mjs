import { FEO } from "../config.mjs";

/**
 * The weapon ranks a skill gives its unit for good, as Aspected's "+1 Rank in chosen Magic type" and Practiced's
 * "starting proficiency increases by +1 Rank" do.
 *
 * A skill says so with a `rank` part on one of its effects: ranks added, by proficiency. `start` stands for
 * the proficiency the unit started with, which is the one the Character Creator has start higher.
 *
 *   rank: { fire: 1 }      // one rank in Fire
 *   rank: { start: 1 }     // one rank in the proficiency the unit started with
 *
 * A rank given this way is saved on the unit like any other, and what each skill has given is kept beside it,
 * so that it is given once and can be taken back when the skill goes or its choice changes. A skill gives its
 * ranks whether or not it is equipped: a rank learned is not lost for want of a slot.
 *
 * Nothing here touches Foundry: `helpers/skill-ranks.mjs` saves what these plans say.
 */

/** What a `rank` part calls the proficiency a unit started with. */
export const START = "start";

/**
 * @typedef GivenRank
 * What one skill has added to one proficiency.
 * @property {string} item      The Item the skill is on its unit
 * @property {string} key       The proficiency
 * @property {number} steps     Ranks added
 */

/* -------------------------------------------- */

/**
 * Does a skill give ranks at all, whatever is chosen on it?
 * @param {{effects?: object[], automate?: boolean}} skill
 * @returns {boolean}
 */
export function givesRanks(skill) {
  if ( skill?.automate === false ) return false;
  return (skill?.effects ?? []).some((effect) => effect?.rank && (typeof effect.rank === "object"));
}

/* -------------------------------------------- */

/**
 * Does a skill raise the proficiency its unit started with? Such a skill is looked at again when that changes.
 * @param {{effects?: object[], automate?: boolean}} skill
 * @returns {boolean}
 */
export function readsStart(skill) {
  return givesRanks(skill) && skill.effects.some((effect) => START in (effect?.rank ?? {}));
}

/* -------------------------------------------- */

/**
 * The ranks a skill gives as it is now: those of its effects that match its chosen variant.
 * @param {{effects?: object[], choice?: string, automate?: boolean}} skill
 * @param {object} [options]
 * @param {string} [options.start]      The proficiency the unit started with; blank when none is known
 * @param {string[]} [options.keys]     The proficiencies in use: the keys of FEO.proficiencies
 * @returns {Record<string, number>}    Ranks added, by proficiency
 */
export function rankSteps(skill, { start = "", keys = Object.keys(FEO.proficiencies) } = {}) {
  const steps = {};
  if ( !givesRanks(skill) ) return steps;
  for ( const effect of skill.effects ) {
    if ( !effect?.rank || (typeof effect.rank !== "object") || effect.proc || effect.aura ) continue;
    if ( effect.choice && (effect.choice !== skill.choice) ) continue;
    for ( const [name, amount] of Object.entries(effect.rank) ) {
      const key = name === START ? start : name;
      const added = Math.trunc(Number(amount)) || 0;
      if ( keys.includes(key) && (added > 0) ) steps[key] = (steps[key] ?? 0) + added;
    }
  }
  return steps;
}

/* -------------------------------------------- */

/**
 * Read what a unit keeps of the ranks its skills have given.
 * @param {object[]} [given]      What the unit keeps as `system.skillRanks`
 * @returns {GivenRank[]}
 */
export function readGiven(given) {
  return (Array.isArray(given) ? given : []).flatMap((entry) => {
    const steps = Math.trunc(Number(entry?.steps)) || 0;
    return entry?.item && entry?.key && (steps > 0) ? [{ item: String(entry.item), key: String(entry.key), steps }] : [];
  });
}

/* -------------------------------------------- */

/**
 * The ranks a unit's skills have added to each proficiency, all told.
 * @param {object[]} [given]      What the unit keeps as `system.skillRanks`
 * @returns {Record<string, number>}
 */
export function givenSteps(given) {
  const steps = {};
  for ( const entry of readGiven(given) ) steps[entry.key] = (steps[entry.key] ?? 0) + entry.steps;
  return steps;
}

/* -------------------------------------------- */

/**
 * A rank some steps above another, no higher than the highest.
 * @param {string} rank
 * @param {number} steps
 * @param {string[]} [order]      Ranks from lowest to highest
 * @returns {string}
 */
export function raisedRank(rank, steps, order = Object.keys(FEO.ranks)) {
  const from = order.indexOf(rank);
  if ( (from < 0) || !steps ) return rank;
  return order[Math.min(Math.max(from + steps, 0), order.length - 1)];
}

/* -------------------------------------------- */

/**
 * Plan what skills change about a unit's ranks: each is given what it now gives and has not given yet, and
 * what it gave and no longer gives is taken back.
 *
 * A rank at its highest cannot rise, and then nothing is noted as given. Where Major Holy Blood holds a
 * proficiency at the highest rank, it is the rank the unit holds underneath that moves.
 * @param {Record<string, string>} ranks            The unit's rank in each proficiency
 * @param {object[]} given                          What the unit keeps as `system.skillRanks`
 * @param {{item: string, name?: string, wanted?: Record<string, number>}[]} skills
 *   The skills to look at: the Item each is, and the ranks it gives now; none for a skill that is gone
 * @param {object} [options]
 * @param {Record<string, string>} [options.held]   The rank underneath, by proficiency that Holy Blood holds
 * @param {string[]} [options.order]                Ranks from lowest to highest
 * @returns {{ranks: Record<string, string>, held: Record<string, string>, given: GivenRank[],
 *   changes: {skill: string, key: string, from: string, to: string}[]}|null}
 *   The ranks that change, the ranks underneath that change, everything given once it is saved, and what to
 *   tell the table; null when nothing changes
 */
export function planSkillRanks(ranks, given, skills, { held = {}, order = Object.keys(FEO.ranks) } = {}) {
  const top = order.length - 1;
  const plan = { ranks: {}, held: {}, given: readGiven(given), changes: [] };
  let noted = false;

  for ( const { item, name = "", wanted = {} } of skills ?? [] ) {
    const had = {};
    for ( const entry of plan.given ) {
      if ( entry.item === item ) had[entry.key] = (had[entry.key] ?? 0) + entry.steps;
    }
    for ( const key of new Set([...Object.keys(wanted), ...Object.keys(had)]) ) {
      const want = Math.max(Math.trunc(Number(wanted[key])) || 0, 0);
      const before = had[key] ?? 0;
      if ( want === before ) continue;

      // The rank that moves: the unit's own, or the one underneath what Holy Blood holds
      const under = order.includes(plan.held[key] ?? held[key]);
      const current = under ? (plan.held[key] ?? held[key]) : (plan.ranks[key] ?? ranks[key]);
      const from = order.indexOf(current);
      if ( from < 0 ) continue;
      const to = Math.min(Math.max(from + want - before, 0), top);
      const steps = want > before ? before + (to - from) : want;

      if ( steps !== before ) {
        plan.given = plan.given.filter((entry) => (entry.item !== item) || (entry.key !== key));
        if ( steps > 0 ) plan.given.push({ item, key, steps });
        noted = true;
      }
      if ( to === from ) continue;
      if ( under ) plan.held[key] = order[to];
      else {
        plan.ranks[key] = order[to];
        plan.changes.push({ skill: name, key, from: order[from], to: order[to] });
      }
    }
  }

  // A rank that moved and moved back is no change
  for ( const key of Object.keys(plan.ranks) ) if ( plan.ranks[key] === ranks[key] ) delete plan.ranks[key];
  for ( const key of Object.keys(plan.held) ) if ( plan.held[key] === held[key] ) delete plan.held[key];
  if ( !noted && !Object.keys(plan.ranks).length && !Object.keys(plan.held).length ) return null;
  return plan;
}

/**
 * Staves for Fire Emblem Online: what using a staff on a unit does that the system applies by itself, and what
 * the skills of the two units make of it. A staff whose Effect heals one target restores that much HP; every
 * other Effect stays on the staff's card for the table. Pure functions of plain data, so that they can be
 * tested outside of Foundry.
 *
 * Skills speak to it with the parts explained at the top of `skills.mjs`: `staffHeal`, `staffHealed`,
 * `staffRange`, the rules `selfStaff` and `staffFreeUses`, and the moment `staff`.
 *
 * @import {SkillEntry} from "./skills.mjs"
 * @import {TimedChange} from "./timed.mjs"
 */
import { parseRange } from "./combat.mjs";
import { holds, resolveGiven } from "./skills.mjs";
import { buildChange } from "./timed.mjs";

/**
 * @typedef StaffUnit
 * A unit that uses a staff, or that one is used on.
 * @property {string} [name]
 * @property {string} [uuid]
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} [level]
 * @property {Record<string, number>} [stats]         Stat totals
 * @property {Record<string, number>} [conditions]
 * @property {SkillEntry[]} [skills]                  Its equipped skills, and the lasting changes it carries
 * @property {import("./positions.mjs").Surroundings|null} [near]     What it has around it on the map
 * @property {boolean} [ally]                         For the unit a staff is used on: is it the user's ally?
 */

/**
 * @typedef StaffCast
 * What using a staff did.
 * @property {"target"|"self"|null} patient           Who the staff healed, if it heals one unit
 * @property {{amount: number, restored: number, full: boolean, skills: string[]}|null} heal
 *           What the staff heals for, the HP the patient regains, and the skills that raised the amount
 * @property {{amount: number, restored: number, skills: string[]}|null} user
 *           The HP the user itself regains: from a staff that heals user and target, or by a skill
 * @property {{skill: string, remind: boolean, granted: {to: "self"|"target", name: string, change: TimedChange}[],
 *   harm: {amount: number, within: number, seen: boolean, units: {id: string, name: string, hp: number}[]}|null}[]} moments
 *           The skills that took effect as the staff was used: what they announce, the changes that last a
 *           while which they grant, and the damage they deal to the nearest enemy of the unit healed
 * @property {string|null} freeUse                    The skill that spares the staff its use
 * @property {{min: number, max: number, changed: boolean}|null} reach
 *           How far the staff reaches as the user's skills make it
 */

/* -------------------------------------------- */

/**
 * What a staff heals, as its Effect says: "Heals target by 10 + MAG", "Heals 35 + MAG/2", "Heals user and
 * target by 5 + MAG", "Heals all HP". Healing over several turns is not read, and a staff for several units at
 * once is marked `area`.
 * @param {string} [effect]                   The staff's Effect
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @returns {{amount: number|null, full: boolean, user: boolean, area: boolean}|null}   Null for a staff that
 *          does not heal at once
 */
export function staffHealing(effect, stats = {}) {
  const first = String(effect ?? "").trim().split(/[.;\n]/)[0];
  const area = /\ball\s+(?:adjacent\s+)?allies\b/i.test(first);
  if ( /^(?:heals?|restores?)\s+all\s+HP\b/i.test(first) ) return { amount: null, full: true, user: false, area };
  const match = first.match(/^heals?\s+(?:(user\s+and\s+target|target)\s+)?(?:all\s+(?:adjacent\s+)?allies\s+)?(?:by\s+|for\s+)?(\d+)\s*\+\s*MAG(?:\s*\/\s*(\d+))?/i);
  if ( !match ) return null;
  const amount = Number(match[2]) + Math.floor(Math.max(stats.mag ?? 0, 0) / (match[3] ? Number(match[3]) : 1));
  return { amount, full: false, user: /^user/i.test(match[1] ?? ""), area };
}

/* -------------------------------------------- */

/**
 * What a unit's skills say about staves: what they add to the HP it heals, what it regains itself, how far
 * its staves reach, and the rules they bend. Read from the effects that are always there and whose condition
 * holds.
 * @param {SkillEntry[]} skills
 * @param {object} self                 The unit, as the conditions of skills see it
 * @param {object|null} [fight]         The use of the staff as a condition sees it: the distance and the target
 * @returns {{more: number, plus: number, echo: number, both: number, healer: number, healerBoth: number,
 *   ranges: object[], rules: Record<string, string>, by: Record<string, string[]>}}
 */
export function staffBends(skills, self, fight = null) {
  const bends = {
    more: 0, plus: 0, echo: 0, both: 0, healer: 0, healerBoth: 0, ranges: [], rules: {},
    by: { more: [], plus: [], echo: [], both: [], healer: [], healerBoth: [], range: [] }
  };
  const add = (key, amount, name) => {
    if ( !amount ) return;
    bends[key] += amount;
    if ( !bends.by[key].includes(name) ) bends.by[key].push(name);
  };
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc || effect.aura ) continue;
      if ( !effect.staffHeal && !effect.staffHealed && !effect.staffRange && !effect.rules ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self, fight) ) continue;
      add("more", effect.staffHeal?.more, skill.name);
      add("plus", effect.staffHeal?.plus, skill.name);
      add("both", effect.staffHeal?.both, skill.name);
      add("healerBoth", effect.staffHealed?.both, skill.name);

      // The user regains the same HP only once, whoever of the two has the skill for it
      for ( const [key, share] of [["echo", effect.staffHeal?.self], ["healer", effect.staffHealed?.healer]] ) {
        if ( !(share > 0) ) continue;
        bends[key] = Math.max(bends[key], share);
        if ( !bends.by[key].includes(skill.name) ) bends.by[key].push(skill.name);
      }
      if ( effect.staffRange ) {
        bends.ranges.push({ ...effect.staffRange });
        if ( !bends.by.range.includes(skill.name) ) bends.by.range.push(skill.name);
      }
      for ( const rule of effect.rules ?? [] ) bends.rules[rule] ??= skill.name;
    }
  }
  return bends;
}

/* -------------------------------------------- */

/**
 * How far a staff reaches as its user's skills make it: the farthest multiplied by each `times`, then raised
 * to at least each `max`.
 * @param {string|number} range
 * @param {Record<string, number>} [stats]    The user's stat totals
 * @param {{times?: number, max?: number}[]} [changes]
 * @returns {{min: number, max: number, changed: boolean}|null}   Null if the Range sets no limit
 */
export function staffReach(range, stats = {}, changes = []) {
  const own = parseRange(range, stats);
  if ( !own ) return null;
  let max = own.max;
  for ( const change of changes ?? [] ) if ( Number.isFinite(change.times) ) max = Math.floor(max * change.times);
  for ( const change of changes ?? [] ) if ( Number.isFinite(change.max) ) max = Math.max(max, change.max);
  return { min: own.min, max, changed: max !== own.max };
}

/* -------------------------------------------- */

/**
 * Describe a unit for the conditions and numbers of its skills as a staff is used.
 * @param {StaffUnit} unit
 * @param {{name?: string}|null} [staff]    The staff in its hand, for the unit that uses it
 * @returns {object}
 */
function viewOf(unit, staff = null) {
  return {
    hp: unit.hp ?? 0,
    hpMax: unit.hpMax ?? unit.hp ?? 0,
    level: unit.level ?? 1,
    stats: unit.stats ?? {},
    conditions: unit.conditions ?? {},
    weapon: staff ? { name: staff.name ?? "", category: "staff" } : null,
    near: unit.near ?? null
  };
}

/* -------------------------------------------- */

/**
 * A unit uses a staff, on another unit or on nobody in particular. A staff that heals one unit restores its
 * HP: to the unit it is used on, or to its user where a skill lets it be its own target. The user's skills
 * that wait for a staff to be used take effect.
 * @param {object} cast
 * @param {{name?: string, effect?: string, range?: string|number}} cast.staff
 * @param {StaffUnit} cast.caster               The unit that uses it, which is in its own turn
 * @param {StaffUnit|null} [cast.target]        The unit it is used on
 * @param {number|null} [cast.distance]         Tiles between the two, if that is known
 * @returns {StaffCast}
 */
export function castStaff({ staff, caster, target = null, distance = null }) {
  const self = viewOf(caster, staff);
  const fight = {
    role: "initiating",
    distance: distance ?? 1,
    foe: target ? { ...viewOf(target), qualities: target.qualities ?? "", afflicted: Object.keys(target.conditions ?? {}).length > 0 } : viewOf({ hp: 0, hpMax: 0 })
  };
  const mine = staffBends(caster.skills, self, target ? fight : null);
  const theirs = target ? staffBends(target.skills, viewOf(target), null) : null;
  const ally = !!target?.ally;
  const selfCast = !target && !!mine.rules.selfStaff;
  const healing = staffHealing(staff?.effect, caster.stats);
  const missing = (unit) => Math.max((unit.hpMax ?? 0) - Math.max(unit.hp ?? 0, 0), 0);
  const result = {
    patient: null,
    heal: null,
    user: null,
    moments: [],
    freeUse: mine.rules.staffFreeUses ?? null,
    reach: staffReach(staff?.range, caster.stats, mine.ranges)
  };

  // Healing, for a staff that heals one unit. What a skill adds for allies is rounded down
  let restored = 0;
  if ( healing && !healing.area && (target || selfCast) ) {
    const patient = target ?? caster;
    const skills = [];
    let amount = missing(patient);
    if ( !healing.full ) {
      amount = healing.amount + mine.plus;
      if ( mine.plus ) skills.push(...mine.by.plus);
      if ( ally && mine.more ) {
        amount = Math.floor(((amount * (100 + mine.more)) / 100) + 1e-9);
        skills.push(...mine.by.more);
      }
    }
    restored = Math.min(amount, missing(patient));
    result.patient = target ? "target" : "self";
    result.heal = { amount, restored, full: healing.full, skills };

    // What the user regains itself: its share of a staff that heals both, raised by the skills that say so,
    // or the HP its target regained where a skill of either unit has it heal the same
    if ( target ) {
      const by = [];
      let own = 0;
      if ( healing.user ) {
        const bonus = mine.both + (ally ? theirs.healerBoth : 0);
        own = healing.full ? missing(caster) : Math.floor((((healing.amount + mine.plus) * (100 + bonus)) / 100) + 1e-9);
        if ( mine.both ) by.push(...mine.by.both);
        if ( ally && theirs.healerBoth ) by.push(...theirs.by.healerBoth);
      }
      else {
        const share = Math.max(mine.echo, ally ? theirs.healer : 0);
        own = Math.floor(((restored * share) / 100) + 1e-9);
        if ( mine.echo ) by.push(...mine.by.echo);
        else if ( ally && theirs.healer ) by.push(...theirs.by.healer);
      }
      if ( healing.user || (own > 0) ) result.user = { amount: own, restored: Math.min(own, missing(caster)), skills: by };
    }
  }

  // The user's skills that wait for a staff to be used. One may ask for the staff to be used on an ally, or
  // to have restored HP to one
  const view = { ...self, healed: (target && ally) ? restored : 0 };
  for ( const skill of caster.skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc?.on !== "staff" ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( effect.proc.ally && !ally ) continue;
      if ( effect.proc.heals && !(view.healed > 0) ) continue;
      if ( !holds(effect.when, view, fight) ) continue;
      const entry = { skill: skill.name, remind: !!effect.remind, granted: [], harm: null };

      // Changes that last a while, for the user or for the unit the staff is used on. One whose numbers all
      // come to nothing is not granted
      for ( const grant of [].concat(effect.grant ?? []) ) {
        const to = (grant.to === "target") ? "target" : "self";
        if ( (to === "target") && !target ) continue;
        const effects = resolveGiven(grant.effects ?? [], view);
        const empty = effects.every((part) => Object.entries(part).every(([key, value]) => {
          return (key === "stats") && Object.values(value ?? {}).every((amount) => amount === 0);
        }));
        if ( empty ) continue;
        entry.granted.push({
          to,
          name: (to === "self") ? (caster.name ?? "") : (target.name ?? ""),
          change: buildChange({ ...grant, effects }, {
            skill: skill.name,
            from: caster.name ?? "",
            giver: caster.uuid ?? "",
            own: to === "self",
            giverInTurn: true,
            carrierInTurn: to === "self"
          })
        });
      }

      // Damage to the enemy nearest to the unit healed: a share of the HP restored, rounded down. Where
      // several stand equally near, the table picks
      if ( effect.harmNear && target ) {
        const within = effect.harmNear.within ?? 1;
        const amount = Math.floor(((view.healed * (effect.harmNear.percent ?? 100)) / 100) + 1e-9);
        const enemies = (target.near?.others ?? []).filter((other) => {
          return (other.relation === "enemy") && (other.distance <= within) && ((other.hp ?? 1) > 0);
        });
        const nearest = enemies.filter((other) => other.distance === enemies[0].distance);
        if ( (amount > 0) && (!target.near || nearest.length) ) entry.harm = {
          amount,
          within,
          seen: !!target.near,
          units: nearest.map((other) => ({ id: other.id, name: other.name, hp: other.hp ?? 0 }))
        };
      }
      if ( entry.remind || entry.granted.length || entry.harm ) result.moments.push(entry);
    }
  }
  return result;
}

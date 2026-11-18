import { FEO } from "../config.mjs";
import { countedAt, readsCount, resolveCount } from "../rules/timed.mjs";

/**
 * Display data for changes that last a while: what one does, in a few words, and how long it still lasts.
 * Nothing here touches Foundry, so that it can be tested outside of it; strings are localized through
 * whatever `i18n` is passed in, or by the template that shows the rows.
 *
 * @import {TimedChange} from "../rules/timed.mjs"
 * @import {Localizer} from "./exchange-context.mjs"
 */

/** The rules a change can bend that are told of where it is shown, each by a line of the language file. */
const TOLD_RULES = ["foeNoCrit", "halveFatal", "noRefresh", "noTurn", "held", "noCounter", "noShield", "worstHit", "neutral", "noCombat", "untargetable", "turned", "provoked", "answers", "unforced", "onlyWait", "hidden", "possessed", "noSong"];

/** Of those, the rules that are good for the unit that carries the change; the others hold it back. */
const GOOD_RULES = ["foeNoCrit", "halveFatal", "untargetable", "answers", "unforced", "hidden"];

/** The moments a tally can grow at that have words of their own for what it counts. */
const COUNTED = ["kill", "dodged", "noCrit", "inflict", "start", "block", "blockFail", "unhurt", "hit", "crit", "struck"];

/** Write a number with its sign. */
const signed = (value) => `${value > 0 ? "+" : "−"}${Math.abs(value)}`;

/**
 * What a change does, as amounts with the key of what each is an amount of. A number that is read from the
 * unit when it is needed is shown by its sign alone.
 * @param {TimedChange} change
 * @returns {{value: string, label: string}[]}
 */
export function changeParts(change) {
  const held = Math.max(change.stacks ?? 1, 1);

  // What an effect that reads the count of its tally comes to is worked out from the count, and not multiplied
  // by it as well
  let stacks = held;
  const amount = (value, suffix = "") => {
    if ( typeof value === "number" ) return `${signed(value * stacks)}${suffix}`;
    return ((value?.times ?? 1) < 0) ? "−" : "+";
  };
  const parts = [];

  // Temporary HP it still holds for its unit, and the HP it restores as each of its unit's turns starts
  if ( change.hp > 0 ) parts.push({ value: `+${change.hp}`, label: "FEO.Timed.tempHp" });
  // A tally restores what it restores once for each time it was granted
  if ( (change.mend > 0) && !change.spoiled ) parts.push({ value: `+${change.mend * ((change.max > 0) ? Math.max(change.stacks ?? 1, 1) : 1)}`, label: "FEO.Timed.mend" });

  // And the damage it deals to its unit as its next turn starts
  if ( change.harm > 0 ) parts.push({ value: `−${change.harm}`, label: "FEO.Timed.harm" });
  for ( const written of change.effects ?? [] ) {
    const counted = readsCount(written);
    const effect = counted ? resolveCount(written, held) : written;
    stacks = counted ? 1 : held;
    for ( const [key, value] of Object.entries(effect.stats ?? {}) ) parts.push({ value: amount(value), label: FEO.stats[key]?.abbr ?? key });
    for ( const [key, value] of Object.entries(effect.statPercent ?? {}) ) parts.push({ value: amount(value, "%"), label: FEO.stats[key]?.abbr ?? key });

    // A stat that is multiplied once everything is added to it: halved, brought to 0
    for ( const [key, value] of Object.entries(effect.statTimes ?? {}) ) {
      parts.push({ value: `×${Math.round(Math.pow(value, stacks) * 100) / 100}`, label: FEO.stats[key]?.abbr ?? key });
    }

    // Combat stats that are worked out from the lowest of a few stats
    if ( Object.values(effect.calc ?? {}).includes("lowest") ) parts.push({ value: "", label: "FEO.Timed.lowest" });
    for ( const [key, value] of Object.entries(effect.combat ?? {}) ) {
      parts.push({ value: amount(value), label: (key === "activation") ? "FEO.Skill.activation" : (FEO.combatBoosts[key] ?? key) });
    }
    if ( effect.hpMax ) parts.push({ value: amount(effect.hpMax), label: "FEO.Stat.hp.abbr" });
    for ( const [key, value] of Object.entries(effect.abilities ?? {}) ) parts.push({ value: amount(value), label: FEO.abilities[key]?.abbr ?? key });
    if ( effect.might ) parts.push({ value: amount(effect.might), label: "FEO.Weapon.might" });

    // What the first attack its unit makes in a fight gains, and what it adds to the numbers of its foes
    if ( effect.firstMight ) parts.push({ value: amount(effect.firstMight), label: "FEO.Timed.first.might" });
    for ( const [key, value] of Object.entries(effect.firstAttack ?? {}) ) parts.push({ value: amount(value), label: `FEO.Timed.first.${key}` });
    for ( const [key, value] of Object.entries(effect.foeCombat ?? {}) ) parts.push({ value: amount(value), label: `FEO.Timed.foe.${key}` });
    if ( effect.endurance ) parts.push({ value: amount(effect.endurance), label: "FEO.Timed.endurance" });
    if ( effect.haste ) parts.push({ value: amount(effect.haste), label: "FEO.Bond.hst" });
    if ( effect.taken ) parts.push({ value: amount(effect.taken), label: "FEO.Timed.taken" });
    if ( effect.takenPercent ) parts.push({ value: amount(effect.takenPercent, "%"), label: "FEO.Timed.taken" });
    if ( effect.dealtPercent ) parts.push({ value: amount(effect.dealtPercent, "%"), label: "FEO.Timed.dealt" });

    // What it adds to the Block chance of its unit
    if ( effect.block?.chance ) parts.push({ value: amount(effect.block.chance), label: "FEO.Block.label" });

    // What it multiplies the weapon triangle by, and the weapons it is always at a disadvantage against
    if ( Number.isFinite(effect.triangle?.times) ) parts.push({ value: `×${effect.triangle.times}`, label: "FEO.Exchange.triangle" });
    for ( const kind of effect.triangle?.loses ?? [] ) parts.push({ value: "", label: "FEO.Timed.triangleLoses", stat: FEO.proficiencies[kind] ?? kind });

    // What it holds effective damage to, and that it lets its unit Shift whatever its gauge holds
    if ( Number.isFinite(effect.effectiveTaken) ) parts.push({ value: `×${effect.effectiveTaken}`, label: "FEO.Timed.effectiveTaken" });
    if ( effect.shift?.atWill ) parts.push({ value: "", label: "FEO.Timed.shiftAtWill" });


    // The rules it bends that are worth a word
    // A counter-attack it only loses against a foe it does not outdo in a stat is told so
    for ( const rule of effect.rules ?? [] ) {
      if ( !TOLD_RULES.includes(rule) ) continue;
      const weaker = (rule === "noCounter") && !!effect.when?.compare;
      parts.push(weaker
        ? { value: "", label: "FEO.Timed.rule.noCounterWeaker", stat: FEO.stats[effect.when.compare.left]?.abbr ?? "" }
        : { value: "", label: `FEO.Timed.rule.${rule}` });
    }

    // What it adds to the HP its unit heals with staves
    if ( effect.staffHeal?.plus ) parts.push({ value: amount(effect.staffHeal.plus), label: "FEO.Staff.healing" });
    if ( effect.staffHeal?.more ) parts.push({ value: amount(effect.staffHeal.more, "%"), label: "FEO.Staff.healing" });

    // What it makes of a condition its unit suffers from: more damage at the start of a turn, named by the
    // condition, and damage when the condition bursts
    for ( const [id, bend] of Object.entries(effect.suffers ?? {}) ) {
      if ( bend.tick ) parts.push({ value: amount(bend.tick, "%"), label: `FEO.Condition.${id}` });
      if ( bend.burst ) parts.push({ value: "+", label: "FEO.Timed.burst" });
    }

    // What it adds to the stats of its unit's foes, the penalties it turns around, the skill it makes sure
    // of, and the kind of weapon what it does is for
    for ( const [key, value] of Object.entries(effect.foeStats ?? {}) ) parts.push({ value: amount(value), label: "FEO.Timed.foeStat", stat: FEO.stats[key]?.abbr ?? key });
    if ( effect.debuffs?.turn ) parts.push({ value: "", label: "FEO.Timed.debuffsTurned" });

    // A skill's name stands where a stat's would, and is its own word in every language
    for ( const name of effect.assures ?? [] ) parts.push({ value: "", label: "FEO.Timed.assures", stat: name });

    // What its unit does for its side while it lasts: whose place it takes, what it reacts to
    if ( effect.guards ) parts.push({ value: "", label: effect.guards.through ? "FEO.Stance.does.guardsThrough" : effect.guards.only ? "FEO.Stance.does.guardsGiver" : "FEO.Stance.does.guards" });
    if ( effect.wards ) parts.push({ value: "", label: effect.wards.takes ? "FEO.Stance.does.takes" : "FEO.Stance.does.negates" });
    if ( effect.reacts ) parts.push({ value: "", label: `FEO.Stance.does.${effect.reacts.to}` });
  }

  // The HP it takes off its unit as it moves, and once it has attacked
  const cost = (value) => Number.isFinite(value) ? `−${value}` : `−1–${value?.dice ?? 1}`;
  if ( change.toll?.move ) parts.push({ value: cost(change.toll.move), label: "FEO.Timed.toll.move" });
  if ( change.toll?.attack ) parts.push({ value: cost(change.toll.attack), label: "FEO.Timed.toll.attack" });
  return parts;
}

/* -------------------------------------------- */

/**
 * Whether a change is one its unit is the worse for or the better: "down" where everything it does lowers its
 * numbers or holds it back, "up" where everything it does raises them or guards it, and neither for one that
 * does both or nothing that can be told.
 * @param {TimedChange} change
 * @returns {"down"|"up"|""}
 */
export function changeTone(change) {
  let good = 0;
  let bad = 0;
  const count = (value, { more = true } = {}) => {
    const sign = (typeof value === "number") ? Math.sign(value) : (((value?.times ?? 1) < 0) ? -1 : 1);
    if ( !sign ) return;
    if ( (sign > 0) === more ) good += 1;
    else bad += 1;
  };
  if ( (change.hp > 0) || ((change.mend > 0) && !change.spoiled) ) good += 1;
  if ( change.harm > 0 ) bad += 1;
  if ( change.toll?.move || change.toll?.attack ) bad += 1;
  for ( const effect of change.effects ?? [] ) {
    for ( const value of Object.values(effect.foeStats ?? {}) ) count(value, { more: false });
    if ( effect.debuffs?.turn || effect.assures?.length ) good += 1;
    if ( effect.firstMight ) count(effect.firstMight);
    for ( const value of Object.values(effect.firstAttack ?? {}) ) count(value);
    for ( const value of Object.values(effect.foeCombat ?? {}) ) count(value, { more: false });
    for ( const key of ["stats", "statPercent", "combat", "abilities"] ) for ( const value of Object.values(effect[key] ?? {}) ) count(value);
    for ( const value of Object.values(effect.statTimes ?? {}) ) count(value - 1);
    for ( const key of ["hpMax", "might", "endurance", "haste", "dealtPercent"] ) if ( effect[key] ) count(effect[key]);
    for ( const key of ["taken", "takenPercent"] ) if ( effect[key] ) count(effect[key], { more: false });
    if ( effect.block?.chance ) count(effect.block.chance);
    if ( Object.values(effect.calc ?? {}).some((mode) => ["lowest", "none"].includes(mode)) ) bad += 1;
    for ( const rule of effect.rules ?? [] ) {
      if ( GOOD_RULES.includes(rule) ) good += 1;
      else if ( TOLD_RULES.includes(rule) ) bad += 1;
    }
  }
  return (bad && !good) ? "down" : (good && !bad) ? "up" : "";
}

/* -------------------------------------------- */

/**
 * How long a change still lasts, as the key of a sentence and the number that goes into it.
 * @param {TimedChange} change
 * @returns {{key: string, turns: number}}
 */
export function changeLasts(change) {
  // One that waits for a turn of its unit to begin says from when it counts
  if ( (change.wait ?? 0) > 0 ) return { key: (change.wait > 1) ? "FEO.Timed.lasts.waitMany" : "FEO.Timed.lasts.wait", turns: change.wait };

  // One that the next fight of a kind uses up says so, where nothing ends it sooner
  if ( change.once && (change.ends === "map") ) return { key: `FEO.Timed.lasts.once.${change.once}`, turns: 0 };
  if ( change.ends === "map" ) return { key: "FEO.Timed.lasts.map", turns: 0 };
  if ( change.ends === "never" ) return { key: "FEO.Timed.lasts.never", turns: 0 };
  if ( change.ends === "phaseEnd" ) return { key: "FEO.Timed.lasts.phaseEnd", turns: 1 };
  const turns = change.fades ? Math.max(change.stacks ?? 1, 1) : Math.max(change.turns ?? 1, 1);
  const whose = change.clock ? "giver" : "own";
  if ( change.fades ) return { key: "FEO.Timed.lasts.fades", turns };
  return { key: `FEO.Timed.lasts.${change.ends}.${whose}${turns > 1 ? "Many" : ""}`, turns };
}

/* -------------------------------------------- */

/**
 * A change in a few words, for a chat card: what it does, and how long it lasts.
 * @param {TimedChange} change
 * @param {Localizer} i18n
 * @returns {{what: string, lasts: string}}
 */
export function describeChange(change, i18n) {
  const lasts = changeLasts(change);

  // A stance ends with what it names as well: one that otherwise lasts the map says only that
  const until = (change.stance?.until ?? []).map((end) => i18n.localize(`FEO.Stance.until.${end}`)).join(i18n.localize("FEO.Stance.until.or"));
  const told = i18n.format(lasts.key, { turns: lasts.turns, from: change.from });
  return {
    what: changeParts(change).filter((part) => !/^[+−]0%?$/.test(part.value)).map((part) => {
      const label = part.stat ? i18n.format(part.label, { stat: i18n.localize(part.stat) }) : i18n.localize(part.label);
      return `${part.value} ${label}`.trim();
    }).join(", "),
    lasts: !until ? told : (change.ends === "map") ? i18n.format("FEO.Stance.lasts.only", { until }) : i18n.format("FEO.Stance.lasts.also", { lasts: told, until })
  };
}

/* -------------------------------------------- */

/**
 * The small number a skill shows for what it keeps count of on its unit: how much its tally holds, and on hover
 * what that is a count of, what it gives and how long it is kept.
 * @param {{name: string, effects?: object[]}} skill      The skill, with its effects
 * @param {Record<string, {count: number, max: number, waits: boolean, change: TimedChange}>} [counts]
 *                                                        What the unit's skills keep count of, by skill (see
 *                                                        `skillCounts`)
 * @param {Localizer} i18n
 * @returns {{value: number, most: number|null, tip: string}|null}    Null for a skill that keeps count of nothing
 *                                                        right now
 */
export function skillCount(skill, counts, i18n) {
  const kept = counts?.[skill?.name];
  if ( !kept ) return null;
  const at = countedAt(skill.effects, skill.name);
  const of = at?.dealt ? "dealt" : (COUNTED.includes(at?.on) ? at.on : "other");
  const { what, lasts } = describeChange(kept.change, i18n);
  const most = (kept.max < 99) && !at?.dealt ? kept.max : null;
  const counted = i18n.format(`FEO.Timed.count.of.${of}`, { count: kept.count });
  const said = [most ? i18n.format("FEO.Timed.count.most", { counted, most }) : counted, [what, lasts].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return { value: kept.count, most, tip: `${skill.name} · ${said}` };
}

/* -------------------------------------------- */

/**
 * The changes a unit carries, as rows for its sheet.
 * @param {TimedChange[]} [changes]
 * @returns {{index: number, name: string, from: string, parts: {value: string, label: string}[],
 *   lasts: {key: string, turns: number}}[]}
 */
export function timedRows(changes) {
  // One that only keeps count of something for a skill has nothing to show
  return (changes ?? []).map((change, index) => ({ change, index })).filter(({ change }) => !change.mark).map(({ change, index }) => ({
    index,
    name: change.name,
    from: change.from ?? "",
    parts: changeParts(change).filter((part) => !/^[+−]0%?$/.test(part.value)),
    lasts: changeLasts(change),

    // What a tally holds, where it counts to more than the turns it lasts
    count: ((change.max ?? 0) > 0) ? (change.stacks ?? 1) : null
  }));
}

import { FEO } from "../config.mjs";
import {
  encounterChecks, expOnOffer, hitsToFell, partyLevel, protectedGroup, readDifficulty
} from "../rules/encounters.mjs";
import { killExp } from "../rules/experience.mjs";
import { unitIcon } from "./npc-builder-context.mjs";

/**
 * What the Encounter Builder's window shows, worked out from an encounter, the units it is made of and the party
 * that goes. Nothing here touches Foundry: each function takes what is known and answers with what the template
 * needs.
 *
 * @import {Blow, Encounter, EncounterGroup} from "../rules/encounters.mjs"
 * @typedef {{localize: (key: string) => string, format: (key: string, data: object) => string}} Localizer
 */

/** The stats a unit is told by, in the order of the sheet. */
const SHOWN = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk"];

/** The combat stats of a unit's card, with the words for each. */
const COMBAT = [
  ["damage", "FEO.Npc.combat.damage"], ["accuracy", "FEO.Npc.combat.accuracy"], ["critical", "FEO.Npc.combat.critical"],
  ["attackSpeed", "FEO.Npc.combat.attackSpeed"], ["dodge", "FEO.Npc.combat.dodge"], ["critAvoid", "FEO.Npc.combat.critAvoid"]
];

/** The numbers a Level Sync is told by: two rows of five. */
const SYNCED = ["hp", "str", "mag", "def", "res", "dex", "spd", "luk", "mov", "con"];

/** The sides a Game Master plays, in the order their rows are listed. */
const SIDES = ["enemy", "ally", "other"];

const signed = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "");

/** How a unit's name is coloured: a Boss, or one that may be recruited. */
const toneOf = (unit) => (unit?.boss ? "boss" : unit?.recruit ? "recruit" : "");

/* -------------------------------------------- */

/**
 * The squares of a row of the read: what one side does to each unit of the other, as the hits it takes to fell it.
 * @param {(Blow|null)[]} blows       One for each unit across
 * @param {number[]} hp               The HP of each of those units
 * @param {(index: number) => string} who     Who attacks whom, in words, for the unit across at an index
 * @param {(index: number) => string} [more]  What else to say of it
 * @param {boolean} narrow            Are the squares too narrow for more than a digit?
 * @param {Localizer} i18n
 * @returns {{text: string, tier: string, title: string}[]}
 */
function strip(blows, hp, who, more, narrow, i18n) {
  return hp.map((health, index) => {
    const blow = blows[index] ?? null;
    if ( !blow ) return { text: "–", tier: "", title: i18n.format("FEO.Encounter.read.noAttack", { who: who(index) }) };
    const hits = hitsToFell(blow, health);
    const tier = (hits === Infinity) ? "" : (hits <= 1) ? "d1" : (hits === 2) ? "d2" : (hits === 3) ? "d3" : "d4";
    const title = i18n.format("FEO.Encounter.read.cell", {
      who: who(index),
      damage: blow.damage,
      hit: Math.min(Math.max(Math.round(blow.hit), 0), 100),
      crit: Math.min(Math.max(Math.round(blow.crit), 0), 100)
    }) + ((blow.attacks > 1) ? ` · ${i18n.format("FEO.Encounter.read.attacks", { attacks: blow.attacks })}` : "") + (more ? more(index) : "");
    return { text: (hits === Infinity) ? "–" : (hits > 9) ? (narrow ? "9" : "9+") : String(hits), tier, title };
  });
}

/* -------------------------------------------- */

/**
 * The window of the Encounter Builder.
 * @param {object} state
 * @param {Encounter} state.encounter
 * @param {{id: string, name: string}[]} state.encounters     Every encounter the world keeps
 * @param {{id: string, name: string}[]} state.scenes
 * @param {{columns: number, rows: number}|null} state.map    The map of its scene, if it has one that can be shown
 * @param {{group: EncounterGroup, unit: object|null, placed: number}[]} state.groups
 *                                        Its groups, each with its unit as `describeUnit` reads it and how many of
 *                                        its units found a tile to stand on
 * @param {object[]} state.pool           The player units of the world: each as `describeUnit` reads it, with
 *                                        `player`, `online` and `going`
 * @param {object[]} state.npcs           The units that may be added: each with `id`, `name`, `className`, `level`
 * @param {{dealt: (Blow|null)[][], taken: (Blow|null)[][]}} state.blows
 *                                        What the units that go and the groups of enemies do to one another: by
 *                                        unit then by group, and by group then by unit
 * @param {string} state.selected         The id of the group in hand
 * @param {"read"|"unit"} state.tab
 * @param {"in"|"out"} state.way          Which way the read looks
 * @param {boolean} state.partyOpen
 * @param {string} state.partyUnit        The unit of the party whose Level Sync is on show, by its id
 * @param {object|null} state.preview     That unit as the encounter would sync it, as `previewSync` reads it
 * @param {boolean} state.syncRunning     Is the Level Sync of this encounter running on its map?
 * @param {"group"|"goal"} state.placing  What a click on the map places
 * @param {number} state.onMap            How many tokens the encounter has on its scene
 * @param {string} state.say
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildEncounterBuilder({
  encounter, encounters = [], scenes = [], map = null, groups = [], pool = [], npcs = [], blows = { dealt: [], taken: [] },
  selected = "", tab = "read", way = "in", partyOpen = false, partyUnit = "", preview = null, syncRunning = false,
  placing = "group", onMap = 0, say = ""
}, i18n) {
  const loc = (key) => i18n.localize(key);
  const config = FEO.encounter;
  const known = groups.map(({ group, unit, placed }) => ({
    id: group.id,
    name: unit?.name ?? loc("FEO.Encounter.gone"),
    side: unit?.side ?? "enemy",
    count: group.count,
    turn: group.turn,
    placed: placed >= group.count,
    missing: !unit,
    boss: !!unit?.boss,
    recruit: !!unit?.recruit,
    unarmed: !!unit?.unarmed,
    unfit: unit?.unfit ?? []
  }));
  const picked = groups.find(({ group }) => group.id === selected) ?? null;
  const kept = protectedGroup(encounter, known);
  const marked = config.marked.some((key) => encounter.objectives[key]);

  // The forces, side by side
  const sides = SIDES.map((key) => {
    const mine = groups.filter(({ unit }) => (unit?.side ?? "enemy") === key);
    return {
      key,
      label: loc(`FEO.Npc.side.${key}`),
      total: mine.reduce((sum, { group }) => sum + group.count, 0),
      rows: mine.map(({ group, unit }) => ({
        id: group.id,
        name: unit?.name ?? loc("FEO.Encounter.gone"),
        missing: !unit,
        tone: toneOf(unit),
        icon: unitIcon(unit?.weapon?.category ?? null),
        boss: !!unit?.boss,
        sub: unit ? [unit.className, i18n.format("FEO.Encounter.lv", { level: unit.level }), unit.weapon?.name].filter(Boolean).join(" · ") : loc("FEO.Encounter.goneHint"),
        recruit: !!unit?.recruit,
        drops: (unit?.carried ?? []).filter((item) => item.drop).map((item) => ({
          drop: item.drop, title: i18n.format(`FEO.Npc.drops.${item.drop}`, { item: item.name })
        })),
        turn: group.turn,
        turnTitle: group.turn ? i18n.format("FEO.Encounter.arrivesOn", { turn: group.turn }) : "",
        count: group.count,
        single: !!unit && (unit.boss || unit.recruit),
        atLeast: group.count <= 1,
        atMost: group.count >= config.count,
        selected: group.id === selected,
        kept: kept?.id === group.id
      }))
    };
  }).filter((side) => side.rows.length || (side.key === "enemy"));

  // The party that goes
  const going = pool.filter((unit) => unit.going);
  const levels = going.map((unit) => unit.level);
  const level = partyLevel(levels);
  const low = Math.min(...levels);
  const high = Math.max(...levels);
  // The Levels the encounter is for, and how the party stands to them
  const band = encounter.sync ?? { on: false, min: 1, max: 1 };
  const down = going.filter((unit) => unit.stand === "sync").length;
  const under = going.filter((unit) => unit.stand === "under").length;
  const sync = {
    on: band.on,
    state: loc(band.on ? "FEO.LevelSync.on" : "FEO.LevelSync.off"),
    min: band.min,
    max: band.max,
    minLeast: band.min <= 1,
    minMost: band.min >= band.max,
    maxLeast: band.max <= band.min,
    maxMost: band.max >= FEO.levelSync.most,
    hint: !band.on ? loc("FEO.LevelSync.hintOff")
      : i18n.format((band.min > 1) ? "FEO.LevelSync.hintOn" : "FEO.LevelSync.hintOnTop", { min: band.min, max: band.max }),
    running: syncRunning
  };
  const stood = (unit) => {
    if ( unit.stand === "sync" ) return i18n.format("FEO.LevelSync.chip.synced", { own: unit.own ?? unit.level, level: unit.syncLevel ?? unit.level });
    if ( unit.stand === "under" ) return i18n.format("FEO.LevelSync.chip.under", { own: unit.own ?? unit.level, min: band.min });
    return "";
  };
  const party = {
    open: partyOpen,
    summary: !going.length ? loc("FEO.Encounter.party.nobody")
      : i18n.format((low === high) ? "FEO.Encounter.party.same" : "FEO.Encounter.party.spread", { count: going.length, low, high, level }),
    syncLine: [
      down ? i18n.format("FEO.LevelSync.party.synced", { count: down, max: band.max }) : "",
      under ? i18n.format("FEO.LevelSync.party.under", { count: under, min: band.min }) : ""
    ].filter(Boolean).join(" · "),
    chips: going.map((unit) => ({
      id: unit.id,
      name: unit.name,
      level: unit.level,
      own: unit.own ?? unit.level,
      synced: unit.stand === "sync",
      under: unit.stand === "under",
      estimated: (unit.stand === "sync") && (unit.exact === false),
      selected: unit.id === partyUnit,
      title: [unit.className, unit.player, stood(unit), ((unit.stand === "sync") && (unit.exact === false)) ? loc("FEO.LevelSync.estimated") : ""].filter(Boolean).join(" · ")
    })),
    pool: pool.map((unit) => ({
      id: unit.id,
      name: unit.name,
      sub: [unit.className, i18n.format("FEO.Encounter.lv", { level: unit.own ?? unit.level })].filter(Boolean).join(" · "),
      synced: (unit.stand === "sync") ? (unit.syncLevel ?? unit.level) : 0,
      under: unit.stand === "under",
      title: stood(unit),
      player: unit.player ?? "",
      online: !!unit.online,
      going: !!unit.going
    })),
    empty: !pool.length,
    preview: null
  };

  // The unit of the party that is shown as the encounter would sync it
  const previewed = preview ? going.find((unit) => unit.id === partyUnit) : null;
  if ( preview && previewed ) {
    party.preview = {
      name: previewed.name,
      level: preview.level,
      className: preview.className,
      was: (preview.ownClassName && (preview.ownClassName !== preview.className)) ? preview.ownClassName : "",
      exact: preview.exact,
      source: loc(preview.exact ? "FEO.LevelSync.exact" : "FEO.LevelSync.estimated"),
      sourceHint: preview.exact ? i18n.format("FEO.LevelSync.exactHint", { name: previewed.name })
        : i18n.format("FEO.LevelSync.estimatedHint", { level: preview.level, from: preview.from }),
      stats: SYNCED.map((key) => {
        const stat = preview.stats.find((other) => other.key === key) ?? { value: 0, cut: 0 };
        return { label: loc(`FEO.Stat.${key}.abbr`), value: stat.value, cut: stat.cut };
      }),
      skills: preview.skills,
      weapons: preview.weapons.map((weapon) => ({
        ...weapon, title: weapon.off ? i18n.format("FEO.LevelSync.preview.needs", { rank: weapon.needs }) : ""
      })),
      note: i18n.format("FEO.LevelSync.preview.note", { level: preview.level, own: preview.own, name: previewed.name })
    };
  }

  // How it reads against that party
  const foes = groups.filter(({ unit }) => unit && (unit.side === "enemy"));
  const now = foes.filter(({ group }) => !group.turn).reduce((sum, { group }) => sum + group.count, 0);
  const later = foes.reduce((sum, { group }) => sum + group.count, 0) - now;
  let read = { nobody: !going.length };
  if ( going.length ) {
    const cell = (going.length <= 7) ? 22 : (going.length <= 9) ? 17 : 13;
    const narrow = cell < 20;
    const found = readDifficulty({
      party: going.map((unit) => ({ hp: unit.hp, heals: unit.heals })),
      foes: foes.map(({ group, unit }) => ({ count: group.count, hp: unit.hp, silent: unit.silent })),
      dealt: blows.dealt,
      taken: blows.taken
    });
    const exp = expOnOffer(foes.map(({ group, unit }) => ({ level: unit.level, count: group.count, silent: unit.silent })), level);
    const bands = config.difficulty.bands;
    const atRisk = found?.risk ? going[found.risk.index] : null;
    const line = [
      i18n.format(later ? "FEO.Encounter.read.foesLater" : "FEO.Encounter.read.foes", { foes: now + later, party: going.length, later }),
      !found ? "" : atRisk
        ? i18n.format((found.risk.many === 1) ? "FEO.Encounter.read.riskOne" : "FEO.Encounter.read.risk", { name: atRisk.name, many: found.risk.many, hits: config.difficulty.fellIn })
        : i18n.format("FEO.Encounter.read.noRisk", { hits: config.difficulty.fellIn })
    ].filter(Boolean).join(" ");
    read = {
      nobody: false,
      cell,
      way,
      inward: way === "in",
      difficulty: found ? {
        key: found.key,
        label: loc(`FEO.Encounter.difficulty.${found.key}`),
        steps: bands.map((band, index) => ({ label: loc(`FEO.Encounter.difficulty.${band.key}`), on: index <= found.step, now: index === found.step })),
        line
      } : null,
      line,
      tiles: [
        { value: !found ? "–" : (found.turns > 99) ? "99+" : Math.max(Math.round(found.turns), 1), label: loc("FEO.Encounter.read.turns"), title: loc("FEO.Encounter.read.turnsHint") },
        { value: !found ? "–" : (found.share > 9.99) ? "999%+" : `${Math.round(found.share * 100)}%`, label: loc("FEO.Encounter.read.share"), title: loc("FEO.Encounter.read.shareHint") },
        { value: exp, label: i18n.format("FEO.Encounter.read.exp", { levels: (exp / going.length / FEO.expPerLevel).toFixed(1) }), title: i18n.format("FEO.Encounter.read.expHint", { level }) }
      ],
      heads: going.map((unit) => ({
        short: unit.name.slice(0, narrow ? 1 : 2),
        title: [unit.name, unit.className, i18n.format("FEO.Encounter.lv", { level: unit.level }), `${loc("FEO.Stat.hp.abbr")} ${unit.hp}`].filter(Boolean).join(" · ")
      })),
      rows: foes.map(({ group, unit }, index) => {
        const gap = unit.level - level;
        const inward = way === "in";
        const cells = inward
          ? strip(blows.taken[index] ?? [], going.map((other) => other.hp),
            (at) => i18n.format("FEO.Encounter.read.against", { attacker: unit.name, target: going[at].name }), null, narrow, i18n)
          : strip(going.map((other, at) => blows.dealt[at]?.[index] ?? null), going.map(() => unit.hp),
            (at) => i18n.format("FEO.Encounter.read.against", { attacker: going[at].name, target: unit.name }),
            (at) => (unit.silent ? "" : ` · ${i18n.format("FEO.Encounter.read.killExp", { exp: killExp(going[at].level, unit.level) })}`), narrow, i18n);
        return {
          id: group.id,
          name: unit.name,
          count: group.count > 1 ? group.count : 0,
          tone: toneOf(unit),
          level: unit.level,
          gap: gap ? signed(gap) : loc("FEO.Encounter.read.even"),
          gapTone: gap > 0 ? "up" : gap < 0 ? "down" : "",
          exp: unit.silent ? 0 : killExp(level, unit.level),
          cells
        };
      })
    };
  }

  // What is in order and what is not
  const checks = encounterChecks(encounter, known).map((check) => ({
    ok: check.ok,
    text: i18n.format(`FEO.Encounter.check.${check.code}`, {
      ...check.data,
      objective: check.data.objective ? loc(`FEO.Encounter.objective.${check.data.objective}.label`) : ""
    })
  }));
  if ( !map ) checks.unshift({ ok: false, text: loc(encounter.scene ? "FEO.Encounter.check.noGrid" : "FEO.Encounter.check.noScene") });

  // The unit in hand
  let card = null;
  if ( picked?.unit ) {
    const unit = picked.unit;
    const value = (key) => (key === "hp" ? unit.hp : (unit.stats[key] ?? 0));

    // A unit with nothing in its hand deals nothing, and one with a staff heals with it
    const blank = !unit.weapon ? ["damage", "accuracy", "critical"] : unit.weapon.staff ? ["damage", "critical"] : [];
    card = {
      id: picked.group.id,
      army: unit.side,
      name: unit.name,
      tone: toneOf(unit),
      icon: unitIcon(unit.weapon?.category ?? null),
      boss: unit.boss,
      sub: [unit.className, ...unit.qualities].filter(Boolean).join(" · "),
      level: unit.level,
      vary: unit.vary,
      stats: SHOWN.map((key) => ({ label: loc(`FEO.Stat.${key}.abbr`), value: value(key) })),
      small: [
        { label: loc("FEO.Stat.mov.abbr"), value: value("mov") }, { label: loc("FEO.Stat.con.abbr"), value: value("con") },
        { label: loc("FEO.Npc.wt"), value: unit.wt }, { label: loc("FEO.Stat.los.abbr"), value: value("los") }
      ],
      combat: COMBAT.map(([key, label]) => ({ label: loc(label), value: blank.includes(key) ? "–" : (unit.combat[key] ?? 0) })),
      carried: unit.carried.map((item) => ({
        name: item.name, drop: item.drop, title: item.drop ? i18n.format(`FEO.Npc.drops.${item.drop}`, { item: item.name }) : ""
      })),
      skills: unit.skills.join(" · "),
      later: picked.group.turn > 0,
      turn: picked.group.turn,
      atFirstTurn: picked.group.turn <= 2,
      made: unit.made,
      canProtect: !!encounter.objectives.protect && (unit.side !== "enemy"),
      kept: kept?.id === picked.group.id,
      placed: picked.placed,
      count: picked.group.count,
      loose: !!picked.loose,
      short: !picked.loose && (picked.placed < picked.group.count)
    };
  }
  else if ( picked ) card = { id: picked.group.id, missing: true };

  const unitTab = (tab === "unit") && !!picked;
  return {
    name: encounter.name,
    encounters: encounters.map((other) => ({ id: other.id, name: other.name || loc("FEO.Encounter.unnamed"), selected: other.id === encounter.id })),
    several: encounters.length > 1,
    scenes: [
      { id: "", name: loc("FEO.Encounter.map.none"), selected: !encounter.scene },
      ...scenes.map((scene) => ({ id: scene.id, name: scene.name, selected: scene.id === encounter.scene }))
    ],
    hasMap: !!map,
    mapSize: map ? i18n.format("FEO.Encounter.map.size", { columns: map.columns, rows: map.rows }) : "",
    objectives: config.objectives.map((key) => ({
      key,
      label: loc(`FEO.Encounter.objective.${key}.label`),
      hint: loc(`FEO.Encounter.objective.${key}.hint`),
      on: !!encounter.objectives[key],
      turns: ((key === "survive") && encounter.objectives.survive) ? encounter.survive : 0
    })),
    surviveOn: !!encounter.objectives.survive,
    survive: encounter.survive,
    surviveLeast: encounter.survive <= 1,
    affinities: [
      { key: "", label: loc("FEO.Encounter.none"), selected: !encounter.affinity },
      ...Object.entries(FEO.affinities).map(([key, label]) => ({ key, label: loc(label), selected: key === encounter.affinity }))
    ],
    weathers: [
      { key: "", label: loc("FEO.Encounter.clear"), selected: !encounter.weather },
      ...Object.entries(FEO.weather.kinds).map(([key, kind]) => ({ key, label: loc(kind.label), selected: key === encounter.weather }))
    ],
    phases: FEO.phases.map((key) => ({ key, label: loc(`FEO.Npc.side.${key}`) })),
    sides,
    noForces: !groups.length,
    npcs: npcs.map((unit) => ({
      id: unit.id,
      label: [unit.name, unit.className, i18n.format("FEO.Encounter.lv", { level: unit.level })].filter(Boolean).join(" · ")
    })),
    placingGoal: placing === "goal",
    canMark: marked,
    goal: encounter.goal ? i18n.format("FEO.Encounter.map.goalAt", { column: encounter.goal.j + 1, row: encounter.goal.i + 1 }) : "",
    sync,
    mapHint: !map ? "" : (placing === "goal") ? loc("FEO.Encounter.map.hintGoal")
      : picked?.unit ? i18n.format("FEO.Encounter.map.hintGroup", { name: picked.unit.name }) : loc("FEO.Encounter.map.hint"),
    party,
    tabRead: !unitTab,
    tabUnit: unitTab,
    unitTab: picked?.unit?.name ?? loc("FEO.Encounter.unit.tab"),
    read,
    checks,
    card,
    say,
    onMap,
    footNote: onMap ? i18n.format("FEO.Encounter.foot.onMap", { count: onMap }) : loc("FEO.Encounter.foot.kept"),
    placeLabel: loc(onMap ? "FEO.Encounter.foot.placeAgain" : "FEO.Encounter.foot.place")
  };
}

import { fightsWithStaff } from "../rules/staves.mjs";
import { FEO } from "../config.mjs";
import { artData, performerOf } from "../helpers/arts.mjs";
import { blockAmount, blockLines, blockTip } from "../helpers/block-context.mjs";
import { artCostLabel, buildForecast, elementName, triangleLabel } from "../helpers/exchange-context.mjs";
import { battalionData } from "../helpers/battalion-context.mjs";
import { captureView } from "../helpers/capture-context.mjs";
import { changeLasts, changeTone, describeChange, skillCount } from "../helpers/timed-context.mjs";
import { forecastSpreads } from "../helpers/spread-context.mjs";
import { spreadForecast } from "../rules/combat.mjs";
import { prepareUsage } from "../helpers/skill-usage-context.mjs";
import { readsCount } from "../rules/timed.mjs";
import { actOf } from "../rules/actions.mjs";
import { guardOf, guardStanceOf } from "../rules/blocking.mjs";
import { canPerform } from "../rules/arts.mjs";
import { canGambit } from "../rules/battalions.mjs";
import { breakInUse } from "../rules/breaking.mjs";
import { brushHolds } from "../rules/paint.mjs";
import { formsOf } from "../rules/skills.mjs";
import { staggerInUse } from "../rules/stagger.mjs";
import { terrainType } from "../rules/terrain.mjs";
import { warpOf } from "../rules/warp.mjs";

/**
 * What the Battle HUD shows, worked out from what its application read of the world. Nothing here touches the
 * canvas or changes anything: each function takes what is known and answers with what a template needs.
 *
 * @typedef {{localize: (key: string) => string, format: (key: string, data: object) => string}} Localizer
 */

/**
 * The share of a bar that is filled, in percent.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function share(value, max) {
  return max > 0 ? Math.min(Math.max(Math.round((value / max) * 100), 0), 100) : 0;
}

/**
 * How healthy a unit looks: its HP bar turns amber at half, and red at a quarter.
 * @param {number} value
 * @param {number} max
 * @returns {"good"|"warn"|"bad"}
 */
function tone(value, max) {
  const part = max > 0 ? value / max : 0;
  return part > 0.5 ? "good" : part > 0.25 ? "warn" : "bad";
}

/**
 * A number with its sign, as "+2" or "−2".
 * @param {number} value
 * @returns {string}
 */
function signed(value) {
  return value > 0 ? `+${value}` : `${value}`.replace("-", "−");
}

/**
 * A weapon's Range as it is shown: "2", or "1–2".
 * @param {{min: number, max: number}|null} range
 * @param {string} written      The Range as written on the weapon, shown when it cannot be read
 * @returns {string}
 */
function rangeText(range, written) {
  if ( !range ) return String(written ?? "");
  return range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
}

/* -------------------------------------------- */
/*  Ground                                      */
/* -------------------------------------------- */

/**
 * What a tile gives a unit standing on it, as short tags.
 * @param {object} type           An entry of FEO.terrain.types
 * @param {Localizer} i18n
 * @returns {string[]}
 */
export function bonusTags(type, i18n) {
  const tags = [];
  if ( type.def ) tags.push(`${signed(type.def)} ${i18n.localize("FEO.Stat.def.abbr")}`);
  if ( type.res ) tags.push(`${signed(type.res)} ${i18n.localize("FEO.Stat.res.abbr")}`);
  if ( type.dodge ) tags.push(`${signed(type.dodge)} ${i18n.localize("FEO.Combat.dodge")}`);
  return tags;
}

/* -------------------------------------------- */

/**
 * The terrain card: the tile under the pointer, or under the selected unit. The card holds the name of the
 * tile and a handful of figures, with a mark where there is more to know. Whatever takes a sentence to say
 * is kept in `detail`, which the card opens once the pointer has rested on the tile.
 * @param {object} tile
 * @param {string} tile.terrain             A key of FEO.terrain.types
 * @param {number} tile.elevation
 * @param {boolean} [tile.rested]           Has the pointer rested on the tile?
 * @param {{name: string, icon: string, lines: object[]}|null} [tile.object]   The door, chest or Village that
 *                                          stands on it: its name and icon, and what is said of it
 * @param {object|null} [tile.unit]         What the tile means for the selected unit, if one can act: its
 *                                          `name`, whether it is `here` already, the cost of one space of the
 *                                          terrain for it as `step`, whether it only passes `through` it, and
 *                                          the `rise` of the tile above the unit
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildTerrain({ terrain, elevation, rested = false, unit = null, object = null }, i18n) {
  const type = terrainType(terrain);
  const label = i18n.localize(type.label);
  const name = label.split(",")[0];
  const away = (unit && !unit.here) ? unit : null;
  const barred = !!away && !Number.isFinite(away.step);
  const rise = away?.rise ?? 0;

  // What a unit standing there gains, and what each space of it costs to cross
  const bonus = (stat, value = 0) => ({
    label: i18n.localize(stat), value: value ? signed(value) : "–", cls: value > 0 ? "good" : value < 0 ? "bad" : "none"
  });
  const figures = [
    bonus("FEO.Stat.def.abbr", type.def),
    bonus("FEO.Stat.res.abbr", type.res),
    bonus("FEO.Hud.ddg", type.dodge),
    {
      label: i18n.localize("FEO.Terrain.costAbbr"),
      value: (barred || (!unit && type.impassable)) ? "✕" : `${(unit && Number.isFinite(unit.step)) ? unit.step : type.cost}`,
      cls: barred ? "bad" : "",
      locked: !unit && !!type.needs?.length
    }
  ];

  // What the marks on the card stand for, in words
  const detail = [];
  if ( type.heal ) detail.push({ icon: "heart", text: i18n.format("FEO.Terrain.healsEach", { percent: type.heal }) });
  if ( barred ) detail.push({ icon: "lock", cls: "bad", text: i18n.format("FEO.Hud.cannotCross", { name: away.name }) });
  else if ( away?.through ) detail.push({ icon: "lock", text: i18n.format("FEO.Hud.passesThrough", { name: away.name }) });
  if ( type.impassable && (barred || !unit) ) detail.push({ icon: "lock", text: i18n.localize("FEO.Terrain.impassable") });
  if ( type.needs?.length && (barred || !unit) ) {
    detail.push({ icon: "lock", text: i18n.format("FEO.Terrain.needs", { skills: type.needs.join(", ") }) });
  }
  if ( type.note && !object ) detail.push({ icon: "spark", text: i18n.localize(type.note) });

  // What stands on the tile: how it stands, and what the selected unit could do with it
  for ( const line of object?.lines ?? [] ) detail.push(line);
  if ( rise ) {
    detail.push({
      icon: "peak",
      cls: rise > 0 ? "bad" : "good",
      text: i18n.format(rise > 0 ? "FEO.Hud.higher" : "FEO.Hud.lower", {
        name: away.name,
        levels: Math.abs(rise),
        hit: FEO.terrain.elevation.hit,
        damage: FEO.terrain.elevation.damage
      })
    });
  }
  return {
    name: object?.name ?? name,
    icon: object?.icon ?? type.icon,
    figures,
    heal: type.heal ? `${type.heal}%` : "",
    noted: !!type.note || !!object,

    // The height is worth a mark on raised ground, and on any ground that is not level with the unit
    elevation: (elevation || rise) ? { value: elevation, cls: rise > 0 ? "bad" : rise < 0 ? "good" : "" } : null,

    // The other names of the terrain head what is said of it
    title: object ? label : ((name !== label) ? label : ""),
    detail,
    open: rested && !!detail.length
  };
}

/* -------------------------------------------- */
/*  Units                                       */
/* -------------------------------------------- */

/**
 * The conditions on a unit, with the turns each has left.
 * @param {Record<string, number>} conditions
 * @param {Localizer} i18n
 * @returns {{id: string, label: string, turns: number, img: string}[]}
 */
function conditionChips(conditions, i18n) {
  return Object.entries(conditions ?? {}).map(([id, turns]) => ({
    id,
    label: i18n.localize(`FEO.Condition.${id}`),
    turns: Number.isFinite(turns) ? turns : "",
    img: FEO.conditions[id]?.img ?? ""
  }));
}

/* -------------------------------------------- */

/**
 * The changes that last on a unit, as chips beside its conditions: each by its name, with what it does and
 * how long it lasts on hover.
 * @param {import("../rules/timed.mjs").TimedChange[]} [changes]
 * @param {Localizer} i18n
 * @returns {{id: string, label: string, turns: string, img: string, tip: string}[]}
 */
function lastingChips(changes, i18n, imitating = null) {
  // One that only keeps count of something for a skill, or that was spoilt, has nothing to show
  const quiet = (change) => readsCount(change.effects) && !describeChange(change, i18n).what;

  // One that only lets its unit do something, with no number to it, is told once however many units gave it:
  // two Laguz side by side each let the other Shift, and that is one thing to know
  const allows = (change) => (change.effects ?? []).length > 0
    && change.effects.every((effect) => Object.keys(effect ?? {}).every((key) => ["shift", "rules", "when"].includes(key)));
  const said = new Set();
  const twice = (change) => {
    if ( !allows(change) ) return false;
    const key = `${change.name}|${describeChange(change, i18n).what}`;
    if ( said.has(key) ) return true;
    said.add(key);
    return false;
  };
  return (changes ?? []).map((change, index) => ({ change, index })).filter(({ change }) => !change.mark && !change.spoiled && !quiet(change) && !twice(change)).map(({ change, index }) => {
    const { what, lasts } = describeChange(change, i18n);
    const tone = changeTone(change);

    // The turns it still lasts count down on the chip; one that lasts with the map or the Phase shows none
    const left = (["turnStart", "turnEnd"].includes(change.ends) && !(change.wait > 0)) ? changeLasts(change).turns : "";
    const told = [what, lasts].filter(Boolean).join(" ");

    // The change that counts the turns of an imitation names the unit that is imitated
    if ( imitating && (change.name === imitating.change) && !change.from ) {
      return {
        id: `lasting-${index}`,
        label: change.name,
        wide: i18n.format("FEO.Imitate.chip", { name: imitating.name }),
        imitation: true,
        count: "",
        turns: left,
        img: "",
        tone: "",
        arrow: "",
        tip: i18n.format("FEO.Imitate.chipTip", { skill: change.name, name: imitating.name, what: what ? ` (${what})` : "", lasts })
      };
    }
    return {
      id: `lasting-${index}`,
      label: change.name,

      // What a tally holds, as a small number beside its name
      count: ((change.max ?? 0) > 0) ? (change.stacks ?? 1) : "",
      turns: left,
      img: "",
      tone,
      arrow: (tone === "down") ? "▼" : (tone === "up") ? "▲" : "",
      tip: change.from ? i18n.format("FEO.Timed.chipFrom", { skill: change.name, from: change.from, what: told }) : `${change.name}: ${told}`
    };
  });
}

/* -------------------------------------------- */

/**
 * The few things about a unit that both the dock and the hover card show.
 * @param {object} unit
 * @param {Actor} unit.actor
 * @param {string} unit.name                  The name on its token
 * @param {string} unit.img                   The picture of its token
 * @param {string} unit.army                  A key of FEO.armies
 * @param {{min: number, max: number}|null} unit.range    How far its weapon reaches
 * @param {{terrain: string, elevation: number}|null} unit.ground     What it stands on
 * @param {{name: string, img: string, captive: boolean, slowed: boolean}|null} [unit.rider]
 *                                            The unit it carries: an ally it Rescued or a captive, and whether
 *                                            that slows it
 * @param {Localizer} i18n
 * @returns {object}
 */
function unitSummary({ actor, name, img, army, range, ground, rider = null, lent = [] }, i18n) {
  const system = actor.system;
  const weapon = system.equippedWeapon;

  // A weapon a skill lends it, which it took up to attack with in place of the one in its hand
  const taken = (lent ?? []).find((entry) => entry.on) ?? null;
  const type = ground ? terrainType(ground.terrain) : null;
  return {
    army,
    name,
    img,
    className: system.className ?? "",
    level: system.level,
    // Temporary HP are counted with its own, and told apart on hover
    hp: {
      value: system.hp.value + (system.hp.temp ?? 0),
      max: system.hp.max,

      // Temporary HP are a second stretch of the bar beside its own, which makes room for them where the two
      // come to more than its maximum
      percent: share(system.hp.value, Math.max(system.hp.max, system.hp.value + (system.hp.temp ?? 0))),
      tempPercent: share(system.hp.temp ?? 0, Math.max(system.hp.max, system.hp.value + (system.hp.temp ?? 0))),
      tone: tone(system.hp.value, system.hp.max),
      temp: system.hp.temp ?? 0,
      tip: (system.hp.temp > 0) ? i18n.format("FEO.Timed.tempHpTip", { own: system.hp.value, temp: system.hp.temp }) : ""
    },

    // Stagger: the unit's Stagger bar, shown under its HP where the world plays with it
    stagger: (staggerInUse() && system.stagger) ? {
      value: system.stagger.value,
      max: system.stagger.max,
      percent: share(system.stagger.value, system.stagger.max),
      staggered: !!system.stagger.staggered,
      label: i18n.format("FEO.Optional.stagger.barLine", { value: system.stagger.value, max: system.stagger.max })
    } : null,
    conditions: [
      // The unit it carries rides among its conditions, though it is none: with what that costs it on hover
      ...(rider ? [{
        id: "carrying",
        label: i18n.format(rider.captive ? "FEO.Optional.capturing.carrying" : "FEO.Rescue.carrying", { name: rider.name }),
        turns: "",
        img: rider.img,
        tip: i18n.localize(rider.slowed ? "FEO.Rescue.slowed" : "FEO.Rescue.unslowed")
      }] : []),
      // A unit that changes form shows the form it is in with its Shift Gauge, or the transformations it has
      // left this turn
      ...((system.shift?.mode === "gauge") ? [{
        id: "shift",
        label: i18n.localize(system.shift.active ? "FEO.Shift.animal" : "FEO.Shift.humanoid"),
        turns: `${system.shift.value}/${FEO.shift.gauge.max}`,
        img: "",
        tone: system.shift.active ? "good" : "",
        tip: i18n.format("FEO.Hud.shiftGauge", { value: system.shift.value, max: FEO.shift.gauge.max, at: FEO.shift.gauge.shiftAt })
      }] : (system.shift?.mode === "stone") ? [{
        id: "shift",
        label: i18n.localize("FEO.Shift.transforms"),
        turns: system.shift.bends?.endless ? "∞" : `${system.shift.left}/${system.shift.limit}`,
        img: "",
        tip: i18n.format("FEO.Shift.stoneHint", { limit: system.shift.bends?.endless ? "∞" : system.shift.limit })
      }] : []),
      ...conditionChips(system.conditions, i18n),

      // What skills have left on it for a while, as a song does: what each does is told on hover
      ...lastingChips(system.timed, i18n, system.imitating ?? null),

      // Breaking: a unit that suffers from Break shows it among its conditions, though it is none
      ...((breakInUse() && system.break) ? [{ id: "break", label: i18n.localize("FEO.Optional.breaking.break"), turns: "", img: "" }] : []),

      // Stagger: so does a unit that is Staggered
      ...(system.stagger?.staggered ? [{ id: "staggered", label: i18n.localize("FEO.Optional.stagger.staggered"), turns: "", img: "" }] : [])
    ],
    weapon: taken ? {
      id: "",
      name: taken.name,
      img: taken.img,
      mark: taken.mark,
      lender: taken.skill,
      staff: false,
      might: taken.might,
      hit: taken.hit,
      crit: taken.crit ?? 0,
      range: taken.range,
      uses: "",
      broken: false
    } : weapon ? {
      id: weapon.id,
      name: weapon.name,
      img: weapon.img,
      // A staff is no weapon to attack with, but for a unit that may start a fight with one
      staff: (weapon.system.category === "staff") && !fightsWithStaff({ effect: weapon.system.effect }, system.skills?.rules),
      might: weapon.system.might,
      hit: weapon.system.hit,
      crit: weapon.system.crit,
      range: rangeText(range, weapon.system.range),
      uses: weapon.system.uses.max > 0 ? `${weapon.system.uses.value}/${weapon.system.uses.max}` : "",
      broken: !!weapon.system.broken
    } : null,
    tile: type ? {
      name: i18n.localize(type.label).split(",")[0],
      icon: type.icon,
      elevation: ground.elevation,
      bonus: bonusTags(type, i18n).join(" · ")
    } : null
  };
}

/* -------------------------------------------- */

/**
 * The dock: the selected unit, what it has in hand, and what it can do.
 * @param {object} unit                       As for `unitSummary`, and:
 * @param {"free"|"ready"|"moving"|"acted"|"down"|"waiting"} unit.state    Where it stands in the turn order
 * @param {number} unit.movement              Its MOV
 * @param {number} unit.spent                 Movement spent to get where it stands
 * @param {boolean} unit.moved                Has it moved since its turn began?
 * @param {boolean} [unit.fixed]              Does that move stand, so that it is not taken back?
 * @param {boolean} [unit.onlyWait]           Do its skills leave it nothing to do but Wait?
 * @param {boolean} [unit.mustAttack]         Did it move a space its Affinity added, so that it must attack?
 * @param {object|null} [unit.again]          The move it may make after the Action it has taken, as Canto lets
 *                                            it: the `skill` that grants it, the enemy skill that `curbed` it,
 *                                            and whether it may change its `gear` meanwhile. Its `movement` and
 *                                            what it has `spent` are then those of that move
 * @param {object|null} [unit.go]             The go it is on beyond the first of its turn, as a skill earned
 *                                            it: the `skill`, the movement it came with (`kind`), and the
 *                                            Actions it `bars`
 * @param {boolean} [unit.shoves]             Is a unit next to it that it may Shove?
 * @param {{open: boolean}|null} [unit.steals]    For a unit that has the Steal command: is an enemy next to it
 *                                            that it may steal from?
 * @param {{open: boolean}|null} [unit.objects]   On a map with doors, chests or Villages: is one in its reach
 *                                            that it can act on?
 * @param {boolean} [unit.lifts]              Is there something for it to do with Rescue: an ally next to it
 *                                            to pick up or to take a passenger from, or for a unit that
 *                                            carries one, a tile to Drop it on or an ally to Give it to?
 * @param {{by: string}|null} [unit.gripped]  The unit that has hold of it, by name: it then takes no Action but
 *                                            to try to break free, or to Wait
 * @param {{item: string, name: string}|null} [unit.grip]     The unit it has hold of, and the skill it holds it
 *                                            with
 * @param {{skill: string, hint: string}|null} [unit.offer]   A step a skill says it "may" take, offered on the
 *                                            map: nothing else is done until it is taken or passed
 * @param {{skill: string, tile: boolean, area?: {kind: string, cost: number, total: number}|null}|null} [unit.act]    The skill being used on a unit picked on the map,
 *                                            and whether its target is picked and a tile is asked for
 * @param {object|null} [unit.refresh]        For a unit that has the Refresh command: the `skill` that gives
 *                                            it and its picture (`img`), the other `ways` it may be used now,
 *                                            whether anybody is in reach for it (`open`), and while it is being
 *                                            used, the `way` picked, how many allies are `picked` and the `most`
 *                                            that may be, or that it is for `all` in reach
 * @param {{skill: string, options: {id: string, label: string, hint?: string}[]}|null} [unit.choice]
 *                                            A choice a skill leaves its owner, listed above the dock: nothing
 *                                            else is done until one is picked or it is passed
 * @param {boolean} unit.owner                May the user act for it?
 * @param {boolean} unit.targets              Is a foe within its reach this turn?
 * @param {string|null} unit.flyout           The list that is open: equip, staff, skill or item
 * @param {string|null} unit.mode             What the next click on the map means: target, staff or warp
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildDock(unit, i18n) {
  const { actor, state, movement, spent, moved, owner } = unit;
  const system = actor.system;
  const summary = unitSummary(unit, i18n);

  // A unit that imitates another reverts at will, with a button on the chip that counts its turns
  if ( owner && system.imitating ) {
    const usage = actor.items.get(system.imitating.item)?.system.usage;
    summary.conditions = summary.conditions.map((chip) => !chip.imitation ? chip : {
      ...chip,
      action: "revertImitation",
      button: i18n.localize("FEO.Imitate.revert"),
      hint: i18n.format((usage?.cooldown > 0) ? "FEO.Imitate.revertHint" : "FEO.Imitate.revertFree", { skill: system.imitating.skill, turns: usage?.cooldown ?? 0 })
    });
  }
  const combat = system.combat ?? {};
  const armed = !!summary.weapon && !summary.weapon.staff && !summary.weapon.broken;
  // While a step is offered to it on the map, or a choice waits above the dock, nothing else is done
  const offer = owner ? (unit.offer ?? null) : null;
  const choice = owner ? (unit.choice ?? null) : null;
  const acting = owner && !offer && !choice && ((state === "ready") || (state === "free"));

  // A unit that has taken its Action and may still move, as Canto lets it, moves or Waits and nothing else
  const moving = owner && !offer && !choice && (state === "moving");

  // Refresh, for a unit that has the skill
  const song = unit.refresh ?? null;
  const again = moving ? (unit.again ?? null) : null;

  // A unit that a skill has act again is ready like any other, save for what that go leaves out
  // One that only keeps count of what the unit has moved, as after it spent movement to Shove, is not told of
  const went = (owner && (state === "ready")) ? (unit.go ?? null) : null;
  const go = went?.quiet ? null : went;
  const barred = !!went?.bars?.includes("attack");
  const goText = !go ? "" : i18n.format(
    (go.kind === "none") ? (barred ? "FEO.Hud.status.goBarred" : "FEO.Hud.status.goStill") : (barred ? "FEO.Hud.status.goNoAttack" : "FEO.Hud.status.go"),
    { skill: go.skill }
  );

  // A Staggered unit cannot act, though it may still move, change what it holds and Wait. Neither can one
  // that a skill leaves nothing but Waiting, as a unit that has Run
  const staggered = !!system.stagger?.staggered;
  const onlyWait = acting && !!unit.onlyWait;

  // A unit that another has hold of takes no Action but to try to break free, or to Wait
  const gripped = acting ? (unit.gripped ?? null) : null;
  const able = acting && !staggered && !onlyWait && !gripped;

  // A unit that moved a space its Affinity added, as Breath lets it, attacks an enemy that space brought within
  // its reach and does nothing else: the move can still be taken back
  const lunged = acting && !!unit.mustAttack;
  const free = able && !lunged;

  // An Affinity its unit chooses when to use stands first in the list of its skills, to be switched on
  const way = system.affinityWay ?? null;
  const affinityUse = way ? prepareUsage({ usage: way.usage, state: system.affinityUse, equipped: true }) : null;
  const affinityRows = affinityUse ? [{
    action: "switchAffinity", id: "", img: "", icon: FEO.affinityIcons[system.affinity] ?? "", name: way.name,
    sub: i18n.localize(`FEO.Optional.affinityEffect.text.${system.affinity}`), on: way.on,
    end: affinityUse.note ? i18n.format(affinityUse.note, { turns: affinityUse.turns, left: affinityUse.left, uses: affinityUse.uses })
      : i18n.localize(way.on ? "FEO.Hud.flyout.declared" : "FEO.Hud.flyout.declare"),
    disabled: !acting || affinityUse.blocked
  }] : [];
  const weapons = actor.items.filter((item) => item.type === "weapon");
  const staves = weapons.filter((item) => item.system.category === "staff");

  // Shields are equipped with the weapons; everything else among the items is Used
  const shields = actor.items.filter((item) => (item.type === "gear") && item.system.isShield);
  const gear = actor.items.filter((item) => (item.type === "gear") && !item.system.isShield);
  // A skill that takes effect by itself is not for its unit to switch or use
  const skills = actor.items.filter((item) => {
    return (item.type === "skill") && item.system.equipped && item.system.usage?.kind && (item.system.usage.kind !== "auto");
  });

  // The skills that keep count of something on the unit, or take effect by themselves a limited number of
  // times: each is listed with its number, for the unit to look at, not to use
  const watched = actor.items.filter((item) => (item.type === "skill") && item.system.equipped && !skills.includes(item)).map((item) => {
    const count = skillCount({ name: item.name, effects: item.system.effects }, system.skills?.counts, i18n);
    const usage = (item.system.usage?.kind === "auto") ? prepareUsage(item.system) : null;
    const limited = usage?.note ? i18n.format(usage.note, { turns: usage.turns, left: usage.left, uses: usage.uses }) : "";
    if ( !count && !limited ) return null;
    return {
      action: "", id: item.id, img: item.img, name: item.name, watch: true, disabled: true,
      sub: count ? count.tip.slice(item.name.length + 3) : (item.system.effect ?? ""),
      end: count ? `${count.value}${count.most ? `/${count.most}` : ""}` : limited
    };
  }).filter(Boolean);

  // The Combat Arts it has learned, where the world plays with them, to ready one before it attacks
  const arts = FEO.optional.combatArts.enabled ? actor.items.filter((item) => item.type === "art") : [];
  const performer = arts.length ? performerOf(actor) : null;

  // The Battalion it commands, where the world plays with them, to use its Gambit on the units targeted
  const squad = FEO.optional.battalions.enabled
    ? (actor.items.find((item) => (item.type === "battalion") && item.system.equipped) ?? null)
    : null;

  // Capturing, where the world plays with it: the attempt it has readied and the captive it has
  const capture = captureView(system);

  // The Special Qualities its skills let the unit take on and put off at will
  const forms = actor.items.filter((item) => (item.type === "skill") && item.system.equipped && (item.system.automate !== false))
    .flatMap((item) => formsOf(item.system.effects, system.specialQualities).map((form) => ({ item, form })));
  const value = (stat) => combat[stat]?.value ?? 0;

  // The ally it carries, which it may Drop or Give; a captive is released from the Skill list instead
  const carried = (unit.rider && !unit.rider.captive) ? unit.rider : null;

  // What carrying a unit takes off its numbers is told where they stand
  const slowed = unit.rider?.slowed
    ? `${i18n.format(unit.rider.captive ? "FEO.Optional.capturing.carrying" : "FEO.Rescue.carrying", { name: unit.rider.name })}. ${i18n.localize("FEO.Rescue.slowed")}`
    : "";

  // Why the unit cannot act, when it cannot
  const phase = (state === "waiting") ? i18n.localize(`FEO.Phase.name.${summary.army}`) : "";
  const status = !owner ? { icon: "lock", text: i18n.localize("FEO.Hud.status.notYours"), locked: true }
    : offer ? { icon: "spark", text: `${offer.skill}: ${i18n.localize(offer.hint || "FEO.Forced.hint.pick")}`, pass: true }
    : choice ? { icon: "spark", text: `${choice.skill}: ${i18n.localize("FEO.Hud.status.choose")}`, pass: true }
    : state === "down" ? { icon: "moon", text: i18n.format("FEO.Hud.status.down", { turns: system.defeat?.turns ?? 0 }), locked: true }
    : state === "acted" ? { icon: "check", text: i18n.localize("FEO.Hud.status.acted"), locked: true }
    : state === "moving" ? {
      icon: "boot",
      text: i18n.format(again?.curbed ? "FEO.Hud.status.movingCurbed" : "FEO.Hud.status.moving", { skill: again?.skill ?? "", by: again?.curbed ?? "" })
    }
    : state === "waiting" ? { icon: "lock", text: i18n.format("FEO.Hud.status.waiting", { phase }), locked: true }
    : staggered ? { icon: "lock", text: i18n.localize("FEO.Optional.stagger.status") }
    : gripped ? { icon: "lock", text: i18n.format("FEO.Grip.status", { name: gripped.by }) }
    : onlyWait ? { icon: "boot", text: i18n.localize("FEO.Hud.status.onlyWait") }
    : unit.mode === "target" ? { icon: "target", text: i18n.localize("FEO.Hud.status.target") }
    : (unit.mode === "staff") && (unit.staff?.kind === "area") ? {
      icon: "staff", text: i18n.format("FEO.Hud.status.staffArea", { staff: unit.staff.name, count: unit.staff.count }), confirm: unit.staff.count > 0
    }
    : (unit.mode === "staff") && (unit.staff?.kind === "object") ? { icon: "staff", text: i18n.format("FEO.Hud.status.staffObject", { staff: unit.staff.name }) }
    : unit.mode === "staff" ? { icon: "staff", text: i18n.localize("FEO.Hud.status.staff") }
    : unit.mode === "warp" ? { icon: "spark", text: i18n.localize("FEO.Hud.status.warp") }
    : unit.mode === "lay" ? { icon: "burst", text: i18n.format(unit.lay?.warp ? "FEO.Hud.status.layWarp" : "FEO.Hud.status.lay", { item: unit.lay?.item ?? "" }) }
    : unit.mode === "shove" ? { icon: "hand", text: i18n.localize("FEO.Hud.status.shove") }
    : unit.mode === "steal" ? { icon: "coin", text: i18n.localize("FEO.Hud.status.steal") }
    : unit.mode === "object" ? { icon: "key", text: i18n.localize("FEO.Hud.status.object") }
    : unit.mode === "rescue" ? { icon: "heart", text: i18n.localize("FEO.Hud.status.rescue") }
    : unit.mode === "drop" ? { icon: "heart", text: i18n.format("FEO.Hud.status.drop", { name: carried?.name ?? "" }) }
    : unit.mode === "refresh" ? {
      icon: "note",
      text: i18n.format(song?.all ? "FEO.Hud.status.refreshAll" : (song?.most > 1) ? "FEO.Hud.status.refreshMany" : "FEO.Hud.status.refresh", {
        skill: song?.way || song?.skill || "", picked: song?.picked ?? 0, most: song?.most ?? 1
      }),
      sing: (song?.picked ?? 0) > 0
    }
    : (unit.mode === "act") && unit.act?.area ? {
      icon: "spark",
      text: i18n.format(`FEO.Hud.status.area.${unit.act.area.kind}`, { skill: unit.act.skill ?? "", cost: unit.act.area.cost ?? 0, total: unit.act.area.total ?? 0 }),
      confirm: (unit.act.area.kind === "self") || ((unit.act.area.kind === "share") && (unit.act.area.total > 0))
    }
    : unit.mode === "act" ? {
      icon: "spark", text: i18n.format(unit.act?.tile ? "FEO.Hud.status.actTile" : "FEO.Hud.status.act", { skill: unit.act?.skill ?? "" })
    }
    : unit.mode === "trade" ? { icon: "swap", text: i18n.localize("FEO.Hud.status.trade") }
    : lunged ? { icon: "target", text: i18n.format("FEO.Hud.status.mustAttack", { skill: way?.name ?? "" }) }
    : moved ? { icon: "boot", text: i18n.format("FEO.Hud.status.moved", { spent, movement }) }
    : go ? { icon: "spark", text: goText }

    // A unit whose move has ended, as after it Traded, changed form or handed a passenger on, is not told to move
    : ((state === "ready") && !(movement > 0)) ? { icon: "right", text: i18n.localize("FEO.Hud.status.stand") }
    : { icon: "right", text: i18n.localize(state === "free" ? "FEO.Hud.status.free" : "FEO.Hud.status.ready") };
  const why = free ? "" : status.text;
  const action = (id, icon, label, enabled, extra = {}) => ({
    id, icon, label: i18n.localize(label), disabled: !enabled, tooltip: enabled ? (extra.tip ?? "") : (extra.why ?? why),
    primary: !!extra.primary && enabled, open: unit.flyout === id, on: !!extra.on
  });

  // A unit with a Shift Gauge changes form from the dock: it Shifts on its own turn once the gauge holds enough,
  // or whatever it holds where a skill lets it, and reverts at any time
  const gauge = (system.shift?.mode === "gauge") ? system.shift : null;
  const shiftTip = gauge ? i18n.format("FEO.Hud.shiftGauge", { value: gauge.value, max: FEO.shift.gauge.max, at: FEO.shift.gauge.shiftAt }) : "";
  const shifts = !gauge ? false
    : gauge.active ? (owner && !offer && !choice && (state !== "down"))
      : (acting && ((gauge.value >= FEO.shift.gauge.shiftAt) || !!gauge.bends?.atWill));

  // The list that is open above the dock
  let flyout = null;
  const usesOf = (item) => item.system.uses?.max > 0 ? `${item.system.uses.value}/${item.system.uses.max}` : "";
  if ( unit.flyout === "equip" ) flyout = {
    side: "mid",
    title: i18n.localize("FEO.Hud.flyout.arsenal"),
    aside: i18n.localize("FEO.Hud.flyout.equipFree"),
    rows: [
      ...weapons.map((item) => ({
        action: "toggleEquip", id: item.id, img: item.img, name: item.name, on: item.system.equipped,
        sub: item.system.category === "staff"
          ? i18n.localize("FEO.WeaponType.staff")
          : `${i18n.localize("FEO.Hud.might")} ${item.system.might} · ${i18n.localize("FEO.Combat.hit")} ${item.system.hit}`,
        end: usesOf(item), disabled: !(acting || (moving && !!again?.gear))
      })),

      // The weapons its skills lend it, each marked with its skill: one is taken up to attack with in place of
      // the weapon in hand; one that is lent to the hand is used by itself from where that weapon does not reach
      ...(unit.lent ?? []).map((entry) => ({
        action: "lendWeapon", id: entry.key, img: entry.img, mark: entry.mark, name: entry.name, on: entry.on, lent: true,
        tip: entry.skill,
        sub: entry.auto
          ? i18n.format("FEO.Lend.auto", { skill: entry.skill, range: entry.range })
          : `${i18n.localize("FEO.Hud.might")} ${entry.might} · ${i18n.localize("FEO.Combat.hit")} ${entry.hit} · ${i18n.localize("FEO.Hud.range")} ${entry.range}`,
        end: entry.ready ? "" : (entry.reason === "cooldown") ? i18n.format("FEO.Lend.wait", { turns: Math.max(entry.wait, 1) }) : i18n.localize("FEO.Lend.spent"),
        disabled: !acting || !entry.ready || entry.auto
      })),

      // A Shield, with the chance this unit would block at with it and what a block takes off
      ...shields.map((item) => {
        const guard = item.system.spent ? null : guardOf({ shield: item.system.asShield, stats: system.statValues, block: system.skills?.block ?? null });
        // A unit that is kept from equipping Shields has none in hand, and can take none up
        const barred = !!system.shieldsBarred;
        return {
          action: "toggleEquip", id: item.id, img: item.img, name: item.name, on: item.system.equipped && !barred,
          sub: barred ? i18n.localize("FEO.Timed.rule.noShield")
            : guard ? `${i18n.localize("FEO.Block.label")} ${guard.chance}% · ${blockAmount(guard, i18n)}` : i18n.localize("FEO.Block.shield"),
          end: usesOf(item), disabled: !(acting || (moving && !!again?.gear)) || !!item.system.spent || barred
        };
      })
    ]
  };
  else if ( unit.flyout === "staff" ) flyout = {
    side: "right",
    title: i18n.localize("FEO.Hud.flyout.staves"),
    aside: i18n.localize("FEO.Hud.flyout.isAction"),
    foot: i18n.localize("FEO.Hud.flyout.staffHint"),
    rows: staves.map((item) => ({
      action: "pickStaff", id: item.id, img: item.img, name: item.name, sub: item.system.effect ?? "",
      end: usesOf(item), disabled: !acting || !!item.system.broken
    }))
  };
  else if ( unit.flyout === "item" ) flyout = {
    side: "right",
    title: i18n.localize("FEO.Hud.flyout.items"),
    aside: i18n.localize("FEO.Hud.flyout.isAction"),
    foot: i18n.localize("FEO.Hud.flyout.itemHint"),
    rows: gear.map((item) => ({
      action: "useItem", id: item.id, img: item.img, name: item.name, sub: item.system.effect ?? "",
      end: usesOf(item), disabled: !acting || !!item.system.spent
    }))
  };
  else if ( unit.flyout === "skill" ) flyout = {
    side: "right",
    title: i18n.localize("FEO.Hud.flyout.skills"),
    aside: i18n.localize("FEO.Hud.flyout.skillsAside"),
    rows: [
      ...affinityRows,
      ...skills.map((item) => {
        const asAction = item.system.usage.kind === "action";

        // A skill that warps the unit has its tile chosen on the map first, and one that is used on a unit
        // has that unit chosen there. A skill the unit holds another with lets go of it when picked again
        const use = warpOf(item.system) ? "pickWarp" : actOf(item.system) ? "pickAct" : "useSkill";
        const holds = asAction && (unit.grip?.item === item.id);

        // So does a skill its unit imitates another with: picked again, the unit reverts
        const imitates = asAction && (system.imitating?.item === item.id);
        return {
          action: asAction ? use : "switchSkill", id: item.id, img: item.img, name: item.name,
          sub: item.system.effect ?? "", on: holds || imitates || (!asAction && !!item.system.state?.active),
          end: holds ? i18n.format("FEO.Grip.release", { name: unit.grip.name })
            : imitates ? i18n.localize("FEO.Imitate.revert")
            : i18n.localize(asAction ? "FEO.Hud.flyout.asAction" : item.system.state?.active ? "FEO.Hud.flyout.declared" : "FEO.Hud.flyout.declare"),
          disabled: !acting
        };
      }),

      // A guard a skill lets the unit take up as its Action, as Weapon Guard does, beside switching it on
      ...skills.filter((item) => guardStanceOf(item.system)).map((item) => ({
        action: "guardStance", id: item.id, img: item.img, name: i18n.format("FEO.Block.stance.name", { skill: item.name }),
        sub: i18n.format("FEO.Block.stance.hint", { bonus: guardStanceOf(item.system).stance }),
        end: i18n.localize("FEO.Hud.flyout.asAction"), disabled: !able || !armed
      })),
      ...forms.map(({ item, form }) => ({
        action: "toggleForm", id: item.id, form: form.name, img: item.img, name: form.name, sub: item.name,
        on: form.on, end: i18n.localize(form.on ? "FEO.Usage.on" : "FEO.Usage.off"), disabled: !acting
      })),

      // What its skills keep count of, and what they have left of what they do by themselves
      ...watched,
      ...arts.map((item) => {
        const able = canPerform(artData(item), performer);
        const readied = !!item.system.readied;
        return {
          action: "readyArt", id: item.id, img: item.img, name: item.name, sub: item.system.effect ?? "", on: readied,
          end: readied ? i18n.localize("FEO.Optional.combatArts.readied")
            : able.ok ? artCostLabel(able.cost, i18n) : i18n.localize(`FEO.Optional.combatArts.blocked.${able.why}`),
          disabled: !acting || (!able.ok && !readied)
        };
      }),
      ...(squad ? [squad] : []).map((item) => {
        const gambit = item.system.gambit;
        const able = canGambit(battalionData(item), { conditions: system.conditions ?? {}, down: !!system.defeat?.state });
        return {
          action: "useGambit", id: item.id, img: item.img, name: gambit.name || i18n.localize("FEO.Optional.battalions.gambit"),
          sub: gambit.effect || item.name,
          end: !able.ok ? i18n.localize(`FEO.Optional.battalions.blocked.${able.why}`)
            : (gambit.uses.max > 0) ? i18n.format("FEO.Optional.battalions.usesLine", { value: gambit.uses.value, max: gambit.uses.max })
              : i18n.localize("FEO.Hud.flyout.asAction"),
          disabled: !acting || !able.ok || barred
        };
      }),

      // Capturing: an attempt to ready before the unit attacks, a unit it subdued to pick up, and a captive
      // to let go
      ...(capture ? [{
        action: "toggleCapture", id: "", img: "", name: i18n.localize("FEO.Optional.capturing.attempt"),
        sub: i18n.localize("FEO.Optional.capturing.readyHint"), on: capture.readied,
        end: i18n.localize(capture.readied ? "FEO.Optional.capturing.readied"
          : capture.captive ? "FEO.Optional.capturing.cannot.holding" : "FEO.Optional.capturing.ready"),
        disabled: !acting || (!!capture.captive && !capture.readied)
      }] : []),
      ...((capture?.captive && !capture.captive.held) ? [{
        action: "pickUpCaptive", id: "", img: "", name: i18n.format("FEO.Optional.capturing.pickUpNamed", { name: capture.captive.name }),
        sub: i18n.localize("FEO.Optional.capturing.pickUpHint"), end: i18n.localize("FEO.Hud.flyout.asAction"), disabled: !acting
      }] : []),
      ...(capture?.captive ? [{
        action: "releaseCaptive", id: "", img: "", name: i18n.format("FEO.Optional.capturing.releaseNamed", { name: capture.captive.name }),
        sub: i18n.localize(capture.captive.held ? "FEO.Optional.capturing.releaseHint" : "FEO.Optional.capturing.letGoHint"),
        end: "", disabled: !owner
      }] : [])
    ]
  };

  // The ways a unit may use its Refresh, of which one is picked before the allies are
  else if ( (unit.flyout === "refresh") && song ) flyout = {
    side: "right",
    title: song.skill,
    aside: i18n.localize("FEO.Hud.flyout.isAction"),
    rows: [
      { action: "pickRefresh", id: "regular", img: song.img, name: song.skill, sub: i18n.localize("FEO.Refresh.regular"), end: "", disabled: !acting },
      ...song.ways.map((way) => ({
        action: "pickRefresh", id: way.id, img: way.img, name: way.label, sub: way.hint,
        end: way.cooldown ? i18n.format("FEO.Refresh.cooldown", { turns: way.cooldown }) : i18n.localize(way.instead ? "FEO.Refresh.instead" : "FEO.Refresh.onTop"),
        disabled: !acting
      }))
    ]
  };

  // A choice a skill leaves the unit's owner takes the place of whatever list was open
  if ( choice ) flyout = {
    side: "right",
    title: choice.skill,
    aside: choice.hint ?? "",
    rows: choice.options.map((option) => ({
      action: "choose", id: option.id, img: option.img ?? "", name: option.label, sub: option.hint ?? "", end: option.end ?? "",

      // What cannot be picked is greyed, and says why on hover
      dim: !!option.disabled, tip: option.tip ?? ""
    }))
  };
  if ( flyout && !flyout.rows.length ) flyout.empty = i18n.localize("FEO.Hud.flyout.none");

  const left = Math.max(movement - (moved ? spent : 0), 0);
  return {
    ...summary,
    numbers: [
      { label: i18n.localize("FEO.Hud.atk"), value: armed ? value("damage") : "–" },
      { label: i18n.localize("FEO.Combat.hit"), value: armed ? value("accuracy") : "–", tip: slowed },
      { label: i18n.localize("FEO.Combat.critAbbr"), value: armed ? value("critical") : "–", tip: slowed },
      { label: i18n.localize("FEO.Hud.as"), value: value("attackSpeed"), tip: slowed },
      { label: i18n.localize("FEO.Hud.ddg"), value: value("dodge"), tip: slowed },

      // Its Block chance, for a unit that blocks with something: the sum behind it is told on hover
      ...(system.block ? [{ label: i18n.localize("FEO.Block.abbr"), value: system.block.chance, tip: blockTip(system.block, i18n) }] : [])
    ],
    blocks: !!system.block,
    canSwap: (weapons.length + shields.length + (unit.lent?.length ?? 0)) > 1,
    equipOpen: unit.flyout === "equip",
    mov: {
      pips: Array.from({ length: Math.min(movement, 12) }, (_, index) => ({ off: index >= left })),
      left
    },
    canUndo: (acting || moving) && moved && !unit.fixed,
    status,
    actions: [
      action("attack", "crossed", "FEO.Combat.attack", able && armed && !barred, {
        primary: unit.targets, on: unit.mode === "target",
        why: !able ? why : barred ? i18n.localize("FEO.Acting.noAttack") : i18n.localize("FEO.Exchange.blocked.unarmed")
      }),
      action("staff", "staff", "FEO.WeaponType.staff", free && !!staves.length, { why: free ? i18n.localize("FEO.Hud.noStaff") : why }),
      action("skill", "spark", "FEO.Hud.skill", able && !!(affinityRows.length || skills.length || forms.length || arts.length || squad || capture || watched.length), { why: able ? i18n.localize("FEO.Hud.noSkill") : why }),
      action("item", "flask", "FEO.Hud.item", free && !!gear.length, { why: free ? i18n.localize("FEO.Hud.noItem") : why }),

      // Shove, which every unit has; for a unit that another has hold of, its try to break free stands there
      gripped ? action("breakFree", "burst", "FEO.Grip.breakFree", !staggered)
        : action("shove", "hand", "FEO.Shove.label", free && !!unit.shoves, {
          on: unit.mode === "shove", why: free ? i18n.localize("FEO.Shove.nobody") : why
        }),

      // Rescue, which every unit has as well: it picks up an ally or takes one over, and for a unit that
      // carries one it stands for setting it down or handing it on
      action("rescue", "heart", carried ? "FEO.Rescue.drop" : "FEO.Rescue.label", free && !!unit.lifts, {
        on: (unit.mode === "rescue") || (unit.mode === "drop"),
        why: !free ? why : carried ? i18n.format("FEO.Rescue.nowhere", { name: carried.name }) : i18n.localize("FEO.Rescue.nobody")
      }),

      // Trade, which every unit has too: a weapon or an item goes to an ally next to it, or comes from it. It
      // is no Action, so a unit that cannot act may still trade
      action("trade", "swap", "FEO.Trade.label", acting && !lunged && !!unit.trades, {
        on: unit.mode === "trade", tip: i18n.localize("FEO.Trade.hint"), why: (acting && !lunged) ? i18n.localize("FEO.Trade.nobody") : why
      }),

      // Shift, for a unit with a Shift Gauge: into its animal form, or back out of it
      ...(gauge ? [action("shift", "paw", gauge.active ? "FEO.Shift.revert" : "FEO.Shift.shift", shifts, {
        on: gauge.active, tip: `${i18n.localize("FEO.Shift.noMove")} ${shiftTip}`,
        why: (acting || gauge.active) ? `${i18n.format("FEO.Shift.notEnough", { needed: FEO.shift.gauge.shiftAt })} ${shiftTip}` : status.text
      })] : []),

      // Refresh, for a unit that has the skill: an ally in reach that has acted moves and acts again
      ...(song ? [action("refresh", "note", "FEO.Refresh.label", free && song.open, {
        on: unit.mode === "refresh", why: free ? i18n.localize("FEO.Refresh.nobody") : why
      })] : []),

      // Steal, for a unit that has the command: an enemy next to it whose pack it takes from
      ...(unit.steals ? [action("steal", "coin", "FEO.Steal.label", free && unit.steals.open, {
        on: unit.mode === "steal", why: free ? i18n.localize("FEO.Steal.nobody") : why
      })] : []),

      // Open, on a map with doors, chests or Villages: one it can act on from where it stands
      ...(unit.objects ? [action("object", "key", "FEO.Objects.label", free && unit.objects.open, {
        on: unit.mode === "object", why: free ? i18n.localize("FEO.Objects.nothing") : why
      })] : []),
      action("wait", "hourglass", "FEO.Wait.label", (acting && !lunged) || moving),
      action("sheet", "scroll", "FEO.Hud.sheet", true)
    ],

    // The commands stand in two rows of five at the most; where a skill or the map adds more than that, they
    // run on into a third row, since a sixth column leaves no room for their names. With an odd number of
    // them Wait takes two places
    ...(() => {
      const count = 9 + (gauge ? 1 : 0) + (song ? 1 : 0) + (unit.steals ? 1 : 0) + (unit.objects ? 1 : 0);
      return { columns: Math.min(Math.ceil(count / 2), 5), wide: (count % 2) === 1 };
    })(),
    showTurn: owner && (state === "free"),
    canSpend: owner && (state === "down") && ((system.defeat?.turns ?? 0) > 0),
    flyout
  };
}

/* -------------------------------------------- */

/**
 * The hover card: a unit the pointer is on, and what the selected unit could do to it.
 * @param {object} unit               As for `unitSummary`, and:
 * @param {string} unit.state         Where it stands in the turn order
 * @param {object|null} [unit.versus] The selected unit's attack on it: the attacker's `name`, the `plan` of the
 *                                    exchange, the movement `cost` to get in place and whether it has to
 *                                    move; or `{name, out: true}` when it cannot be reached this turn
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildHover(unit, i18n) {
  const summary = unitSummary(unit, i18n);

  // A unit that imitates another says whom, where nothing can be hovered for more
  summary.conditions = summary.conditions.map((chip) => chip.imitation ? { ...chip, label: chip.wide } : chip);
  let versus = null;
  if ( unit.versus?.out ) versus = { out: i18n.format("FEO.Hud.outOfReach", { name: unit.versus.name }) };
  else if ( unit.versus?.plan ) {
    const { initiator, defender } = unit.versus.plan;
    versus = {
      lead: i18n.format(unit.versus.moves ? "FEO.Hud.attacksAfter" : "FEO.Hud.attacks", {
        name: unit.versus.name, cost: unit.versus.cost
      }),
      blocked: initiator.blocked ? i18n.localize(`FEO.Exchange.blocked.${initiator.blocked}`) : null,
      damage: initiator.damage,
      times: initiator.attacks > 1 ? initiator.attacks : null,
      hit: initiator.hit,
      crit: initiator.crit,
      counter: defender.blocked
        ? i18n.localize("FEO.Hud.noCounter")
        : i18n.format("FEO.Hud.counter", { damage: defender.damage, hit: defender.hit })
    };
  }
  return {
    ...summary,
    boss: false,
    stateLabel: unit.state === "acted" ? i18n.localize("FEO.Hud.status.acted")
      : unit.state === "down" ? i18n.localize("FEO.Defeat.incapacitated") : "",
    versus
  };
}

/* -------------------------------------------- */
/*  Forecast                                    */
/* -------------------------------------------- */

/**
 * The lines of a sum, dropping those that add nothing, and what is left over once they are all counted.
 * @param {[string, number][]} parts      Each part of the sum; the first is what it starts from
 * @param {number} result                 What the sum comes to in the end
 * @param {Localizer} i18n
 * @param {string} [rest]                 What is left over is told under, where something names it
 * @returns {{label: string, value: string, cls: string}[]}
 */
function sumLines(parts, result, i18n, rest = "FEO.Hud.sum.other") {
  const lines = [];
  let total = 0;
  parts.forEach(([label, value, always], index) => {
    total += value;

    // A part that comes to nothing is left out, unless it is there to name what brought it to nothing
    if ( (index > 0) && !value && !always ) return;
    lines.push({
      label: i18n.localize(label),
      value: ((index === 0) || !value) ? `${value}` : signed(value),
      cls: ((index === 0) || !value) ? "" : value > 0 ? "pos" : "neg"
    });
  });

  // Conditions, skills and the limits of a chance are not itemised here
  const left = result - total;
  if ( left ) lines.push({ label: i18n.localize(rest), value: signed(left), cls: left > 0 ? "pos" : "neg" });
  return lines;
}

/* -------------------------------------------- */

/**
 * What each of a unit's skills adds to one of its numbers in a fight, by the skill's name, for the sum behind
 * that number. A skill that raises the stat a weapon adds to its Might is counted for the damage.
 * @param {object} unit                   The unit as it fights, with what its skills came to
 * @param {string} key                    The combat stat: damage, hit, critical, dodge or critAvoid
 * @param {number} [sign]                 -1 for what is taken off the foe's number
 * @returns {[string, number][]}
 */
/**
 * The skill of a unit that bends a combat rule, by name, for what names it; "Skills" when none is found.
 * @param {object} unit
 * @param {string} rule
 * @param {Localizer} i18n
 * @returns {string}
 */
function ruleName(unit, rule, i18n) {
  const found = [...(unit.skills ?? []), ...(unit.timed ?? [])].find((skill) => (skill.effects ?? []).some((effect) => effect.rules?.includes(rule)));
  return found?.name ?? i18n.localize("FEO.Section.skills");
}

/* -------------------------------------------- */

function skillParts(unit, key, sign = 1) {
  const stat = (key === "damage") ? (unit.weapon?.damageStat ?? "str") : null;
  const parts = [];
  for ( const source of unit.fx?.sources ?? [] ) {
    const amount = (source.combat?.[key] ?? 0) + (stat ? (source.stats?.[stat] ?? 0) : 0);
    if ( amount ) parts.push([source.name, sign * amount]);
  }
  return parts;
}

const total = (parts) => parts.reduce((sum, [, amount]) => sum + amount, 0);

/* -------------------------------------------- */

/**
 * The forecast of an attack started from the map: two names, two weapons, and HP, damage, Hit and Crit for
 * each side. What the ground does and what each skill adds is in the numbers, and in the sum behind each.
 * @param {import("../rules/combat.mjs").ExchangePlan} plan
 * @param {object} extra
 * @param {{initiator: string, defender: string}} extra.armies
 * @param {{initiator: string, defender: string}} [extra.images]    The pictures of the weapons in hand
 * @param {{initiator?: {img: string, tip: string}}|null} [extra.marks]
 *                                    The skill that lends a unit the weapon it attacks with: its picture and name
 * @param {number|null} [extra.measured]
 * @param {import("../helpers/choices.mjs").ForecastChoice[]} [extra.choices]
 *                                        The skills the unit that attacks chooses for a fight, ticked in the
 *                                        forecast (see `rules/choices.mjs`)
 * @param {import("../helpers/choices.mjs").ForecastChoice[]} [extra.foeChoices]
 *                                        Those its foe has switched on
 * @param {boolean} [extra.foeRearms]     May its foe change its weapon before the fight is rolled?
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildHudForecast(plan, { armies, images = {}, marks = null, measured = null, choices = [], foeChoices = [], foeRearms = false }, i18n) {
  const forecast = buildForecast(plan, i18n, { measured });

  // The weapon triangle as skills left it: named with what multiplies it and the skills that had a say, and
  // kept in the sums at 0 where a skill negated what it would have given or taken
  const triangle = triangleLabel(plan, i18n);
  const bent = !!plan.triangle?.spared?.length || !!plan.triangle?.negated?.length;
  const sides = forecast.sides.map((shown) => {
    const side = plan[shown.key];
    const unit = side.unit;
    const ground = side.ground ?? { hit: 0, damage: 0, dodge: 0, cover: 0 };
    const max = unit.hpMax ?? unit.hp;

    // What each skill adds, by its name: this side's to its own numbers, the foe's to what it defends with.
    // Might for the first attack alone, and a share more damage, are named after the skills that give them
    const foe = plan[shown.key === "initiator" ? "defender" : "initiator"].unit;
    const mine = { damage: skillParts(unit, "damage"), hit: skillParts(unit, "hit"), critical: skillParts(unit, "critical") };
    const theirs = { dodge: skillParts(foe, "dodge", -1), critAvoid: skillParts(foe, "critAvoid", -1) };

    // What a unit that makes one attack in place of several gains for it, what its skills are sure to do for
    // its first attack alone, and what a skill of the foe holds a hit to, each under the name of its skill
    // So is what it gains for its lead in Attack Speed over a foe it follows up on
    const lone = side.lone ?? null;
    const led = side.led ?? null;
    const gained = (key) => [lone, led].filter((entry) => entry?.[key]).map((entry) => [entry.skill, entry[key]]);
    // And what its weapon takes from the one it attacked with before, for its first attack
    const handed = side.handed ?? null;
    const taken = (key) => (handed?.[key] ? [[`${handed.skill} (${handed.weapon})`, handed[key]]] : []);
    const extra = {
      damage: [...gained("damage"), ...(side.named?.damage ?? []), ...taken("damage")],
      hit: [...gained("hit"), ...(side.named?.hit ?? []), ...taken("hit")],
      critical: [...gained("critical"), ...(side.named?.critical ?? []), ...taken("critical")]
    };

    // What a skill of the foe is sure to take off the first attack, as one that halves every second attack
    // made against its unit does when this is such an attack
    // What the first hit deals again as damage of an element is counted in the number, and named behind it
    const echo = side.blows?.[0]?.echo ?? 0;
    const struck = shown.damage - echo;
    const echoed = echo ? [[(side.echoes ?? []).map((part) => i18n.format("FEO.Formula.echoSum", { skill: part.skill, element: elementName(part.element, i18n) })).join(", "), echo]] : [];
    const capped = ((side.cap !== null) && (side.cap !== undefined)) ? Math.min(side.damage, side.cap) : side.damage;
    const easing = side.blows?.[0]?.eased ?? [];
    const eased = (easing.length && (struck !== capped)) ? [[easing.join(", "), struck - capped]] : [];

    // What each attack deals where they do not all deal the same, or differ in their chances: one line for
    // each, behind the number
    const strikes = shown.strikes ?? [];
    const differs = strikes.some((strike) => (strike.damage !== strikes[0].damage) || (strike.hit !== strikes[0].hit) || (strike.crit !== strikes[0].crit));
    const strikeLines = differs ? strikes.map((strike) => {
      const notes = [];
      if ( strike.hit !== strikes[0].hit ) notes.push(`${i18n.localize("FEO.Combat.hit")} ${strike.hit}`);
      if ( strike.crit !== strikes[0].crit ) notes.push(`${i18n.localize("FEO.Combat.critAbbr")} ${strike.crit}`);
      if ( strike.eased.length ) notes.push(strike.eased.join(", "));
      return { label: i18n.format("FEO.Round.strike", { n: strike.n }), value: `${strike.damage}`, note: notes.join(" · ") };
    }) : [];
    const held = (side.cap !== null) && (side.cap !== undefined) && (side.damage > side.cap)
      ? [[(side.cappedBy ?? []).join(", ") || "FEO.Hud.sum.other", side.cap - side.damage]] : [];
    // What the first attack alone gains from a skill, or from a change that waits for the unit's next attack,
    // is named after it
    const firstBy = (unit.fx?.firstBy ?? []).join(", ");
    const firstly = side.art ? {} : (unit.fx?.firstAttack ?? {});
    for ( const key of ["hit", "critical"] ) if ( firstly[key] ) extra[key].push([firstBy || "FEO.Hud.sum.other", firstly[key]]);
    const opening = (side.opener?.damage ?? 0) - (handed?.damage ?? 0);
    const charged = (opening && !side.art) ? [[[...new Set([...(unit.fx?.applied ?? []).filter((name) => {
      return (unit.skills ?? []).some((skill) => (skill.name === name) && (skill.effects ?? []).some((effect) => effect.firstMight));
    }), ...(unit.fx?.firstBy ?? [])])].join(", ") || unit.weapon?.name || "FEO.Hud.sum.other", opening]] : [];

    // And what the foe's skills give it against this attack for the HP it would take off it
    const seen = side.foreseen ?? null;
    const seenDodge = seen?.dodge ? [[seen.skills.join(", "), -seen.dodge]] : [];
    const seenAvoid = seen?.critAvoid ? [[seen.skills.join(", "), -seen.critAvoid]] : [];
    const scale = side.strike?.damageScale ?? 1;
    const before = (scale > 1) ? Math.ceil((struck / scale) - 1e-9) : struck;
    const scaled = ((struck !== before) && unit.fx?.scalers?.length && ((foe.fx?.takenMultiplier ?? 1) === 1))
      ? [[unit.fx.scalers.join(", "), struck - before]] : [];

    // What the foe's skills do to the hit, each under its name: what they add to the stat that resists it,
    // what they take off every hit, and, where nothing of this side's multiplies its damage, the share less
    // (or more) they have their unit take, which is what is left over once everything else is counted
    const kind = (side.defence === "res") ? "res" : "def";
    const warded = ((unit.fx?.ignoreDefence > 0) && (kind === "def")) ? [] : (foe.fx?.sources ?? []).filter((source) => source.stats?.[kind]).map((source) => [source.name, -source.stats[kind]]);
    const lessened = (foe.fx?.takenBy ?? []).map(({ skill, amount }) => [skill, amount]);
    const shared = (((foe.fx?.takenMultiplier ?? 1) !== 1) && foe.fx?.takers?.length && !unit.fx?.scalers?.length) ? foe.fx.takers.join(", ") : undefined;
    const sums = shown.active ? {
      damage: sumLines([
        ["FEO.Hud.sum.power", side.power - side.triangleDamage - total(mine.damage) - (lone?.damage ?? 0) - (led?.damage ?? 0)],
        ...mine.damage,
        ...extra.damage,
        ...charged,
        [triangle, side.triangleDamage, bent],
        [ground.damage > 0 ? "FEO.Hud.sum.highGround" : "FEO.Hud.sum.lowGround", ground.damage],
        // What resists the attack is named: the foe's DEF or its RES, as the weapon or a skill has it
        [(kind === "res") ? "FEO.Hud.sum.res" : "FEO.Hud.sum.def", -side.resisted - total(warded)],
        ...warded,
        ["FEO.Hud.sum.tile", -ground.cover],
        ...lessened,
        ...scaled,
        ...held,
        ...eased,
        ...echoed
      ], shown.damage, i18n, shared),
      hit: sumLines([
        ["FEO.Combat.accuracy", side.base.accuracy - side.triangleHit - ground.hit - total(mine.hit) - (lone?.hit ?? 0) - (led?.hit ?? 0)],
        ...mine.hit,
        ...extra.hit,
        [triangle, side.triangleHit, bent],
        [ground.hit > 0 ? "FEO.Hud.sum.highGround" : "FEO.Hud.sum.lowGround", ground.hit],
        ["FEO.Hud.sum.dodge", -(side.base.dodge - ground.dodge) - total(theirs.dodge)],
        ...theirs.dodge,
        ...seenDodge,
        ["FEO.Hud.sum.tile", -ground.dodge]
      ], shown.hit, i18n),
      crit: sumLines([
        ["FEO.Combat.critical", side.base.critical - total(mine.critical) - (lone?.critical ?? 0) - (led?.critical ?? 0)],
        ...mine.critical,
        ...extra.critical,
        ["FEO.Hud.sum.critAvoid", -side.base.critAvoid - total(theirs.critAvoid)],
        ...theirs.critAvoid,
        ...seenAvoid
      ], shown.crit, i18n),

      // The chance that the foe blocks a hit of this side: what it blocks with, its DEX, and what each skill
      // of the two adds or takes, then what a block takes off
      block: side.block ? [
        ...blockLines(side.block, i18n),
        { label: i18n.localize("FEO.Block.takes.label"), value: blockAmount(side.block, i18n), cls: "" },
        ...(side.block.parry ? [{ label: i18n.localize("FEO.Block.parry"), value: `${side.block.parry.chance}`, cls: "" }] : [])
      ] : []
    } : null;
    return {
      key: shown.key,
      army: armies[shown.key],
      name: shown.name,
      weapon: shown.weapon,
      weaponImg: images[shown.key] ?? "",

      // The skill that lends the weapon, where one does: its picture beside the weapon's, its name on hover
      weaponMark: marks?.[shown.key]?.img ?? "",
      weaponBy: marks?.[shown.key]?.tip ?? "",
      triangleUp: side.triangle > 0,
      triangleDown: side.triangle < 0,

      // What skills multiply it by, beside the arrow, and behind it the skills that made it what it is
      triangleTimes: (side.triangle && (plan.triangle?.times !== undefined)) ? `×${plan.triangle.times}` : "",
      triangleTip: triangle,
      active: shown.active,
      blocked: shown.blocked,
      hp: shown.hp,
      hpAfter: shown.hpAfter,
      hpChanges: shown.hpChanges,
      hpTone: tone(shown.hp, max),
      hpLeft: share(Math.max(shown.hpAfter, 0), max),
      hpLost: share(Math.max(shown.hp, 0), max) - share(Math.max(shown.hpAfter, 0), max),
      damage: shown.damage,
      times: shown.repeats ? shown.attacks : null,

      // What follows the first attack, in a few signs ("× 2", or "+ 10 + 11" where the attacks differ), and
      // behind the number what each attack deals
      more: shown.more ?? "",
      strikeLines,
      hit: shown.hit,
      crit: shown.crit,
      block: shown.block,

      // Follow-up Critical Multiplier: the chance of a critical hit with the follow-up attack where it is
      // another, and behind the number what it comes from
      critFollow: shown.critFollow,
      critFollowLine: (shown.active && side.fcm)
        ? { label: i18n.format("FEO.Optional.fcm.sum", { times: side.fcm }), value: `${side.critFollow}` }
        : null,
      sums
    };
  });
  const [attacker, defender] = sides;

  // What the unit that attacks chooses for the fight: each skill a tick, with what it picks for it beside it.
  // A skill a foe's skill stops cannot be ticked, and says why
  const token = (key) => i18n.localize(`FEO.Choice.token.${key}`);
  const stops = !!plan.defender.unit.fx?.rules?.has("nihil") || !!plan.initiator.stopped?.length;
  const nihil = stops ? ruleName(plan.defender.unit, "nihil", i18n) : "";
  const ticks = choices.map((choice) => {
    const stopped = choice.stopped || (!!nihil && !!choice.kind && !choice.innate);
    const blocked = !choice.on && !choice.able.ok;
    const tip = stopped ? i18n.format("FEO.Choice.stopped", { skill: nihil, name: plan.defender.unit.name })
      : blocked ? i18n.format(`FEO.Usage.blocked.${choice.able.reason}`, { skill: choice.name })
        : choice.idle ? i18n.localize("FEO.Choice.idle")
          : !choice.kind ? i18n.localize("FEO.Choice.always")
            : i18n.localize(`FEO.Usage.hint.${choice.kind}`);
    return {
      id: choice.id,
      name: choice.name,
      img: choice.img,
      on: choice.on && !stopped && !choice.idle,
      dim: stopped || blocked || choice.idle,
      fixed: !choice.kind,
      disabled: !choice.kind || stopped || blocked,
      tip,
      end: stopped ? nihil
        : (blocked && (choice.able.reason === "cooldown")) ? i18n.format("FEO.Choice.cooldown", { turns: choice.turns })
          : (choice.usesLeft !== null) ? `×${choice.usesLeft}` : "",
      picks: (choice.on && !stopped) ? choice.picks.map((pick) => {
        if ( pick.kind === "stat" ) {
          return { id: pick.id, stat: true, label: "", value: pick.stat ? i18n.localize(FEO.stats[pick.stat].abbr) : i18n.localize("FEO.Choice.stat.auto") };
        }
        const from = Object.keys(pick.give ?? pick.cost ?? {}).map(token).join("/");
        const to = Object.keys(pick.gain ?? {}).map(token).join("/");
        return { id: pick.id, steps: true, label: `${from} → ${to}`, value: pick.steps ?? 0, none: !(pick.most > 0), most: pick.most ?? 0 };
      }).filter((pick) => pick.stat || (pick.most !== null)) : []
    };
  });

  // What the foe has switched on for the fight, that it may change its weapon before it is rolled, and what
  // cancels skills for both
  const notes = [
    ...foeChoices.filter((choice) => !choice.stopped && !choice.idle).map((choice) => ({ label: `${defender.name}: ${choice.name}`, cls: "foe" })),
    ...(foeRearms ? [{ label: i18n.format("FEO.Choice.rearm.note", { name: defender.name }), cls: "foe" }] : []),

    // A fight of several rounds says how many, or that it goes on until a unit falls
    ...(forecast.rounds ? [{ label: forecast.rounds, cls: "both rounds" }] : []),

    // One attack a skill has its unit make in place of a fight says which skill
    ...(plan.extra?.skill ? [{ label: plan.extra.skill, cls: "both rounds" }] : []),
    ...(plan.parity ? [{ label: i18n.format("FEO.Choice.parity", { skill: plan.parity }), cls: "both" }] : []),

    // What a skill of either would do to the units around: named in a few words, with every unit it would
    // catch and what that unit would get behind the hover
    ...forecastSpreads(spreadForecast(plan), i18n).map((entry) => {
      return { label: entry.label, tip: entry.hint, cls: `spread ${entry.tone}${(entry.by === "defender") ? " foe" : ""}` };
    })
  ];
  return {
    canAttack: forecast.canAttack,
    blocked: attacker.blocked,
    names: sides,
    choices: ticks,
    notes,
    rows: [
      { label: i18n.localize("FEO.Stat.hp.abbr"), hp: true, cells: [attacker, defender] },
      ...[["damage", "FEO.Hud.dmg"], ["hit", "FEO.Combat.hit"], ["crit", "FEO.Combat.critAbbr"]].map(([stat, label]) => {
        const cell = (side) => ({
          active: side.active, value: side[stat], times: stat === "damage" ? side.times : null,
          more: stat === "damage" ? side.more : "", strikes: stat === "damage" ? side.strikeLines : [],
          lead: stat === "damage", lines: side.sums?.[stat] ?? [], result: side[stat], blocked: side.blocked,
          then: stat === "crit" ? side.critFollow : null, after: stat === "crit" ? side.critFollowLine : null
        });
        return { label: i18n.localize(label), cells: [cell(attacker), cell(defender)] };
      }),

      // The chance that a hit is blocked, only where either side blocks with something
      ...(sides.some((side) => side.block !== null) ? [{
        label: i18n.localize("FEO.Block.abbr"),
        cells: sides.map((side) => ({
          active: side.active, value: side.block ?? "–", lines: side.sums?.block ?? [], result: side.block ?? "–",
          blocked: side.blocked, bare: side.block === null
        }))
      }] : [])
    ]
  };

}

/* -------------------------------------------- */
/*  Phases                                      */
/* -------------------------------------------- */

/**
 * The Phase banner: whose Phase it is, which units of that side have yet to act, and the order of the sides.
 * @param {object} battle
 * @param {string|null} battle.phase          Whose Phase it is, or null when no battle is running
 * @param {number} battle.round               The turn of the battle
 * @param {string[]} battle.sides             The sides in the battle, in the order of their Phases
 * @param {{id: string, name: string, img: string, army: string, state: string, selected: boolean}[]} battle.units
 * @param {boolean} battle.gm                 Is the user a Game Master?
 * @param {boolean} battle.canStart           May the user begin a battle on this scene?
 * @param {number} [battle.fielded]           How many units would take the field if one began
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildPhase({ phase, round, sides, units, gm, canStart, fielded = 0 }, i18n) {
  if ( !phase ) return { battle: false, canBegin: canStart, fielded };
  const mine = units.filter((unit) => unit.army === phase);

  // A unit that has acted and may still move, as Canto lets it, has not finished its turn
  const open = (unit) => (unit.state === "ready") || (unit.state === "moving");
  const left = mine.filter(open).length;
  return {
    battle: true,
    phase,
    turnLabel: i18n.format("FEO.Phase.turn", { turn: round }),
    phaseLabel: i18n.localize(`FEO.Phase.name.${phase}`),
    roster: mine.map((unit) => ({
      id: unit.id,
      army: unit.army,
      img: unit.img,
      state: unit.state,
      selected: unit.selected,
      mark: unit.state === "acted" ? "check" : unit.state === "down" ? "moon" : null,
      tooltip: `${unit.name}: ${i18n.localize(`FEO.Phase.state.${open(unit) ? "ready" : unit.state === "down" ? "down" : "acted"}`)}`
    })),
    left,
    allActed: left === 0,
    canEnd: gm || (phase === "player"),
    canClose: gm,
    sides: sides.map((army) => ({ army, label: i18n.localize(`FEO.Phase.side.${army}`), now: army === phase }))
  };
}

/* -------------------------------------------- */

/**
 * The splash that crosses the screen as a Phase begins, or as a battle ends.
 * @param {object} event
 * @param {string|null} [event.army]    The side whose Phase begins; none when the battle is over
 * @param {number} event.round          The turn of the battle
 * @param {Localizer} i18n
 * @returns {{army: string|null, eyebrow: string, title: string}}
 */
export function buildSplash({ army = null, round }, i18n) {
  return {
    army,
    eyebrow: i18n.format("FEO.Phase.turn", { turn: round }),
    title: i18n.localize(army ? `FEO.Phase.name.${army}` : "FEO.Phase.over")
  };
}

/* -------------------------------------------- */
/*  The Terrain Brush                           */
/* -------------------------------------------- */

/** The heights the terrain brush can lay down. */
const BRUSH_LEVELS = Array.from({ length: 10 }, (_, level) => level);

/**
 * The palette of the terrain brush: every kind of terrain and every height to pick from, which of them the
 * brush holds, the eraser, and whether the painted ground is drawn on the map for everyone.
 * @param {object} palette
 * @param {import("../rules/paint.mjs").Brush} palette.brush
 * @param {boolean} [palette.shown]     Is the painted ground of the scene shown to the players?
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildPalette({ brush, shown = false }, i18n) {
  const holds = brushHolds(brush);
  const swatches = Object.entries(FEO.terrain.types).map(([key, type]) => {
    const says = [...bonusTags(type, i18n), `${i18n.localize("FEO.Terrain.moveCost")} ${type.impassable ? "✕" : type.cost}`];
    return {
      key,
      icon: type.icon,
      tint: FEO.terrain.tints[key] ?? "",
      on: holds.terrain === key,
      label: `${i18n.localize(type.label)}: ${says.join(", ")}`
    };
  });
  swatches.push({ key: "", icon: "minus", none: true, on: holds.terrain === null, label: i18n.localize("FEO.Paint.keepTerrain") });
  const levels = [
    { value: "", text: "–", on: holds.elevation === null, label: i18n.localize("FEO.Paint.keepElevation") },
    ...BRUSH_LEVELS.map((level) => ({
      value: level, text: level, on: holds.elevation === level, label: i18n.format("FEO.Paint.elevation", { level })
    }))
  ];

  // What the brush holds, in a word or two
  const parts = [];
  if ( holds.terrain ) parts.push(i18n.localize(FEO.terrain.types[holds.terrain]?.label ?? holds.terrain).split(",")[0]);
  if ( holds.elevation !== null ) parts.push(`${i18n.localize("FEO.Terrain.elevAbbr")} ${holds.elevation}`);

  // The doors, chests and Villages it can set down in place of paint
  const placing = (brush.object in FEO.objects.kinds) ? brush.object : null;
  const objects = Object.entries(FEO.objects.kinds).map(([key, kind]) => ({
    key, icon: kind.icon, on: placing === key, label: i18n.localize(kind.label), tip: i18n.localize(`FEO.Objects.place.${key}`)
  }));
  return {
    summary: i18n.localize(holds.erase ? "FEO.Paint.erase" : "FEO.Paint.nothing"),
    holds: placing ? i18n.localize(FEO.objects.kinds[placing].label) : ((holds.erase || holds.idle) ? "" : parts.join(" · ")),
    erase: holds.erase,
    placing: !!placing,
    shown,
    swatches: placing ? swatches.map((swatch) => ({ ...swatch, on: false })) : swatches,
    levels: placing ? levels.map((level) => ({ ...level, on: false })) : levels,
    objects,
    hint: i18n.localize(placing ? "FEO.Objects.place.hint" : "FEO.Paint.hint")
  };
}

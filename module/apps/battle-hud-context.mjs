import { FEO } from "../config.mjs";
import { artData, performerOf } from "../helpers/arts.mjs";
import { artCostLabel, buildForecast } from "../helpers/exchange-context.mjs";
import { battalionData } from "../helpers/battalion-context.mjs";
import { captureView } from "../helpers/capture-context.mjs";
import { canPerform } from "../rules/arts.mjs";
import { canGambit } from "../rules/battalions.mjs";
import { breakInUse } from "../rules/breaking.mjs";
import { brushHolds } from "../rules/paint.mjs";
import { formsOf } from "../rules/skills.mjs";
import { terrainType } from "../rules/terrain.mjs";

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
 * @param {object|null} [tile.unit]         What the tile means for the selected unit, if one can act: its
 *                                          `name`, whether it is `here` already, the cost of one space of the
 *                                          terrain for it as `step`, and the `rise` of the tile above the unit
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildTerrain({ terrain, elevation, rested = false, unit = null }, i18n) {
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
      value: barred ? "✕" : `${(unit && Number.isFinite(unit.step)) ? unit.step : type.cost}`,
      cls: barred ? "bad" : "",
      locked: !unit && !!type.needs?.length
    }
  ];

  // What the marks on the card stand for, in words
  const detail = [];
  if ( type.heal ) detail.push({ icon: "heart", text: i18n.format("FEO.Terrain.healsEach", { percent: type.heal }) });
  if ( barred ) detail.push({ icon: "lock", cls: "bad", text: i18n.format("FEO.Hud.cannotCross", { name: away.name }) });
  if ( type.needs?.length && (barred || !unit) ) {
    detail.push({ icon: "lock", text: i18n.format("FEO.Terrain.needs", { skills: type.needs.join(", ") }) });
  }
  if ( type.note ) detail.push({ icon: "spark", text: i18n.localize(type.note) });
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
    name,
    icon: type.icon,
    figures,
    heal: type.heal ? `${type.heal}%` : "",
    noted: !!type.note,

    // The height is worth a mark on raised ground, and on any ground that is not level with the unit
    elevation: (elevation || rise) ? { value: elevation, cls: rise > 0 ? "bad" : rise < 0 ? "good" : "" } : null,

    // The other names of the terrain head what is said of it
    title: (name !== label) ? label : "",
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
 * The few things about a unit that both the dock and the hover card show.
 * @param {object} unit
 * @param {Actor} unit.actor
 * @param {string} unit.name                  The name on its token
 * @param {string} unit.img                   The picture of its token
 * @param {string} unit.army                  A key of FEO.armies
 * @param {{min: number, max: number}|null} unit.range    How far its weapon reaches
 * @param {{terrain: string, elevation: number}|null} unit.ground     What it stands on
 * @param {Localizer} i18n
 * @returns {object}
 */
function unitSummary({ actor, name, img, army, range, ground }, i18n) {
  const system = actor.system;
  const weapon = system.equippedWeapon;
  const type = ground ? terrainType(ground.terrain) : null;
  return {
    army,
    name,
    img,
    className: system.className ?? "",
    level: system.level,
    hp: {
      value: system.hp.value,
      max: system.hp.max,
      percent: share(system.hp.value, system.hp.max),
      tone: tone(system.hp.value, system.hp.max)
    },
    conditions: [
      ...conditionChips(system.conditions, i18n),

      // Breaking: a unit that suffers from Break shows it among its conditions, though it is none
      ...((breakInUse() && system.break) ? [{ id: "break", label: i18n.localize("FEO.Optional.breaking.break"), turns: "", img: "" }] : [])
    ],
    weapon: weapon ? {
      id: weapon.id,
      name: weapon.name,
      img: weapon.img,
      staff: weapon.system.category === "staff",
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
 * @param {"free"|"ready"|"acted"|"down"|"waiting"} unit.state    Where it stands in the turn order
 * @param {number} unit.movement              Its MOV
 * @param {number} unit.spent                 Movement spent to get where it stands
 * @param {boolean} unit.moved                Has it moved since its turn began?
 * @param {boolean} unit.owner                May the user act for it?
 * @param {boolean} unit.targets              Is a foe within its reach this turn?
 * @param {string|null} unit.flyout           The list that is open: equip, staff, skill or item
 * @param {string|null} unit.mode             What the next click on the map means: target or staff
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildDock(unit, i18n) {
  const { actor, state, movement, spent, moved, owner } = unit;
  const system = actor.system;
  const summary = unitSummary(unit, i18n);
  const combat = system.combat ?? {};
  const armed = !!summary.weapon && !summary.weapon.staff && !summary.weapon.broken;
  const acting = owner && ((state === "ready") || (state === "free"));
  const weapons = actor.items.filter((item) => item.type === "weapon");
  const staves = weapons.filter((item) => item.system.category === "staff");
  const gear = actor.items.filter((item) => item.type === "gear");
  const skills = actor.items.filter((item) => (item.type === "skill") && item.system.equipped && item.system.usage?.kind);

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

  // Why the unit cannot act, when it cannot
  const phase = (state === "waiting") ? i18n.localize(`FEO.Phase.name.${summary.army}`) : "";
  const status = !owner ? { icon: "lock", text: i18n.localize("FEO.Hud.status.notYours"), locked: true }
    : state === "down" ? { icon: "moon", text: i18n.format("FEO.Hud.status.down", { turns: system.defeat?.turns ?? 0 }), locked: true }
    : state === "acted" ? { icon: "check", text: i18n.localize("FEO.Hud.status.acted"), locked: true }
    : state === "waiting" ? { icon: "lock", text: i18n.format("FEO.Hud.status.waiting", { phase }), locked: true }
    : unit.mode === "target" ? { icon: "target", text: i18n.localize("FEO.Hud.status.target") }
    : unit.mode === "staff" ? { icon: "staff", text: i18n.localize("FEO.Hud.status.staff") }
    : moved ? { icon: "boot", text: i18n.format("FEO.Hud.status.moved", { spent, movement }) }
    : { icon: "right", text: i18n.localize(state === "free" ? "FEO.Hud.status.free" : "FEO.Hud.status.ready") };
  const why = acting ? "" : status.text;
  const action = (id, icon, label, enabled, extra = {}) => ({
    id, icon, label: i18n.localize(label), disabled: !enabled, tooltip: enabled ? "" : (extra.why ?? why),
    primary: !!extra.primary && enabled, open: unit.flyout === id, on: !!extra.on
  });

  // The list that is open above the dock
  let flyout = null;
  const usesOf = (item) => item.system.uses?.max > 0 ? `${item.system.uses.value}/${item.system.uses.max}` : "";
  if ( unit.flyout === "equip" ) flyout = {
    side: "mid",
    title: i18n.localize("FEO.Hud.flyout.arsenal"),
    aside: i18n.localize("FEO.Hud.flyout.equipFree"),
    rows: weapons.map((item) => ({
      action: "toggleEquip", id: item.id, img: item.img, name: item.name, on: item.system.equipped,
      sub: item.system.category === "staff"
        ? i18n.localize("FEO.WeaponType.staff")
        : `${i18n.localize("FEO.Hud.might")} ${item.system.might} · ${i18n.localize("FEO.Combat.hit")} ${item.system.hit}`,
      end: usesOf(item), disabled: !acting
    }))
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
      ...skills.map((item) => {
        const asAction = item.system.usage.kind === "action";
        return {
          action: asAction ? "useSkill" : "switchSkill", id: item.id, img: item.img, name: item.name,
          sub: item.system.effect ?? "", on: !asAction && !!item.system.state?.active,
          end: i18n.localize(asAction ? "FEO.Hud.flyout.asAction" : item.system.state?.active ? "FEO.Hud.flyout.declared" : "FEO.Hud.flyout.declare"),
          disabled: !acting
        };
      }),
      ...forms.map(({ item, form }) => ({
        action: "toggleForm", id: item.id, form: form.name, img: item.img, name: form.name, sub: item.name,
        on: form.on, end: i18n.localize(form.on ? "FEO.Usage.on" : "FEO.Usage.off"), disabled: !acting
      })),
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
          disabled: !acting || !able.ok
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
  if ( flyout && !flyout.rows.length ) flyout.empty = i18n.localize("FEO.Hud.flyout.none");

  const left = Math.max(movement - (moved ? spent : 0), 0);
  return {
    ...summary,
    numbers: [
      { label: i18n.localize("FEO.Hud.atk"), value: armed ? value("damage") : "–" },
      { label: i18n.localize("FEO.Combat.hit"), value: armed ? value("accuracy") : "–" },
      { label: i18n.localize("FEO.Combat.critAbbr"), value: armed ? value("critical") : "–" },
      { label: i18n.localize("FEO.Hud.as"), value: value("attackSpeed") },
      { label: i18n.localize("FEO.Hud.ddg"), value: value("dodge") }
    ],
    canSwap: weapons.length > 1,
    equipOpen: unit.flyout === "equip",
    mov: {
      pips: Array.from({ length: Math.min(movement, 12) }, (_, index) => ({ off: index >= left })),
      left
    },
    canUndo: acting && moved,
    status,
    actions: [
      action("attack", "crossed", "FEO.Combat.attack", acting && armed, {
        primary: unit.targets, on: unit.mode === "target", why: acting ? i18n.localize("FEO.Exchange.blocked.unarmed") : why
      }),
      action("staff", "staff", "FEO.WeaponType.staff", acting && !!staves.length, { why: acting ? i18n.localize("FEO.Hud.noStaff") : why }),
      action("skill", "spark", "FEO.Hud.skill", acting && !!(skills.length || forms.length || arts.length || squad || capture), { why: acting ? i18n.localize("FEO.Hud.noSkill") : why }),
      action("item", "flask", "FEO.Hud.item", acting && !!gear.length, { why: acting ? i18n.localize("FEO.Hud.noItem") : why }),
      action("wait", "hourglass", "FEO.Wait.label", acting),
      action("sheet", "scroll", "FEO.Hud.sheet", true)
    ],
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
 * @returns {{label: string, value: string, cls: string}[]}
 */
function sumLines(parts, result, i18n) {
  const lines = [];
  let total = 0;
  parts.forEach(([label, value], index) => {
    total += value;
    if ( (index > 0) && !value ) return;
    lines.push({
      label: i18n.localize(label),
      value: index === 0 ? `${value}` : signed(value),
      cls: index === 0 ? "" : value > 0 ? "pos" : "neg"
    });
  });

  // Conditions, skills and the limits of a chance are not itemised here
  const rest = result - total;
  if ( rest ) lines.push({ label: i18n.localize("FEO.Hud.sum.other"), value: signed(rest), cls: rest > 0 ? "pos" : "neg" });
  return lines;
}

/* -------------------------------------------- */

/**
 * The forecast of an attack started from the map: two names, two weapons, and HP, damage, Hit and Crit for
 * each side. What the ground does is in the numbers, and in the sum behind each of them.
 * @param {import("../rules/combat.mjs").ExchangePlan} plan
 * @param {object} extra
 * @param {{initiator: string, defender: string}} extra.armies
 * @param {{initiator: string, defender: string}} [extra.images]    The pictures of the weapons in hand
 * @param {number|null} [extra.measured]
 * @param {Localizer} i18n
 * @returns {object}
 */
export function buildHudForecast(plan, { armies, images = {}, measured = null }, i18n) {
  const forecast = buildForecast(plan, i18n, { measured });
  const sides = forecast.sides.map((shown) => {
    const side = plan[shown.key];
    const unit = side.unit;
    const ground = side.ground ?? { hit: 0, damage: 0, dodge: 0, cover: 0 };
    const max = unit.hpMax ?? unit.hp;
    const sums = shown.active ? {
      damage: sumLines([
        ["FEO.Hud.sum.power", side.power - side.triangleDamage],
        ["FEO.Exchange.triangle", side.triangleDamage],
        [ground.damage > 0 ? "FEO.Hud.sum.highGround" : "FEO.Hud.sum.lowGround", ground.damage],
        ["FEO.Hud.sum.defence", -side.resisted],
        ["FEO.Hud.sum.tile", -ground.cover]
      ], shown.damage, i18n),
      hit: sumLines([
        ["FEO.Combat.accuracy", side.base.accuracy - side.triangleHit - ground.hit],
        ["FEO.Exchange.triangle", side.triangleHit],
        [ground.hit > 0 ? "FEO.Hud.sum.highGround" : "FEO.Hud.sum.lowGround", ground.hit],
        ["FEO.Hud.sum.dodge", -(side.base.dodge - ground.dodge)],
        ["FEO.Hud.sum.tile", -ground.dodge]
      ], shown.hit, i18n),
      crit: sumLines([
        ["FEO.Combat.critical", side.base.critical],
        ["FEO.Hud.sum.critAvoid", -side.base.critAvoid]
      ], shown.crit, i18n)
    } : null;
    return {
      key: shown.key,
      army: armies[shown.key],
      name: shown.name,
      weapon: shown.weapon,
      weaponImg: images[shown.key] ?? "",
      triangleUp: side.triangle > 0,
      triangleDown: side.triangle < 0,
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
      hit: shown.hit,
      crit: shown.crit,
      sums
    };
  });
  const [attacker, defender] = sides;
  return {
    canAttack: forecast.canAttack,
    blocked: attacker.blocked,
    names: sides,
    rows: [
      { label: i18n.localize("FEO.Stat.hp.abbr"), hp: true, cells: [attacker, defender] },
      ...[["damage", "FEO.Hud.dmg"], ["hit", "FEO.Combat.hit"], ["crit", "FEO.Combat.critAbbr"]].map(([stat, label]) => {
        const cell = (side) => ({
          active: side.active, value: side[stat], times: stat === "damage" ? side.times : null,
          lead: stat === "damage", lines: side.sums?.[stat] ?? [], result: side[stat], blocked: side.blocked
        });
        return { label: i18n.localize(label), cells: [cell(attacker), cell(defender)] };
      })
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
  const left = mine.filter((unit) => unit.state === "ready").length;
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
      tooltip: `${unit.name}: ${i18n.localize(`FEO.Phase.state.${unit.state === "ready" ? "ready" : unit.state === "down" ? "down" : "acted"}`)}`
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
    const says = [...bonusTags(type, i18n), `${i18n.localize("FEO.Terrain.moveCost")} ${type.cost}`];
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
  return {
    summary: i18n.localize(holds.erase ? "FEO.Paint.erase" : "FEO.Paint.nothing"),
    holds: (holds.erase || holds.idle) ? "" : parts.join(" · "),
    erase: holds.erase,
    shown,
    swatches,
    levels
  };
}

import { FEO } from "../config.mjs";
import { levelUpShowing } from "../apps/level-up-splash.mjs";
import { promotesAt } from "../rules/classes.mjs";
import { IMITATION_FLAG } from "../rules/imitation.mjs";
import { SYNC_FLAG } from "../rules/level-sync.mjs";
import { levelWaits, levelsUnit } from "../rules/level-up.mjs";
import { rollGrowths } from "../rules/progression.mjs";
import { postCard, rollD100 } from "./chat.mjs";
import { applyLevelGains, promoteUnit } from "./classes.mjs";
import { levelUpSkills, rerollFailed } from "./earnings.mjs";
import { growthValue } from "./earnings-context.mjs";
import { growthBar } from "./imitation.mjs";
import { buildLevelUpSplash, showLevelUp } from "./level-up.mjs";
import { manualLevelUp } from "./manual-gains.mjs";
import { promotionLifeUpdate } from "./optional.mjs";
import { grantTimed } from "./timed.mjs";

/**
 * Levelling a unit up, in Foundry: the level up itself, which the Level Up button of the sheet asks for, and
 * the level up that comes by itself as a unit reaches the experience of a level.
 *
 * One that comes by itself is the same level up, begun by the system in place of the button: on the client of
 * whoever the unit belongs to (see `levelsUnit` in `rules/level-up.mjs`), a moment after the experience was
 * saved, and one unit at a time where several are due. A unit that cannot level up just now, because it
 * imitates another or is under a Level Sync, does so once it is itself again. One whose player backs out of a
 * choice the level up asks for is left alone until it earns experience again, and can still be levelled from
 * its sheet.
 */

const { DialogV2 } = foundry.applications.api;

/** The world setting for whether units level up by themselves. */
export const AUTO_SETTING = "levelUpOnExp";

/** The notes on a unit that keep it from levelling up: it does so as the last of them goes. */
const BARS = [IMITATION_FLAG, SYNC_FLAG];

/** The units that are being levelled on this client, by uuid. @type {Set<string>} */
const busy = new Set();

/** The units that wait their turn to level up by themselves on this client, by uuid. @type {string[]} */
const queue = [];

/** The units whose level up was backed out of, by uuid: they are not asked again for the same experience. */
const declined = new Set();

/** Is the queue being worked through? */
let turning = false;

/* -------------------------------------------- */
/*  The Level Up                                */
/* -------------------------------------------- */

/**
 * Level a unit up: grant ability points, then roll every growth rate. What they came to is shown on the Level Up
 * splash, and then told in chat.
 * A unit whose class promotes at this level promotes instead. A unit with only a class name is asked whether
 * to promote, which skips the growth rolls and leaves the new class to be applied by hand. With the Level
 * Cap, a unit at its level limit does neither.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Did it gain the level? Not where it has no level to gain, may not level up
 *                                just now, or its player backed out
 */
export async function levelUpUnit(actor) {
  if ( !levelWaits(actor?.system) || busy.has(actor.uuid) ) return false;

  // A unit that imitates another levels up once it is itself again
  const waits = growthBar(actor);
  if ( waits ) {
    ui.notifications.warn(waits);
    return false;
  }
  busy.add(actor.uuid);
  try {
    return await levelUp(actor);
  } finally {
    busy.delete(actor.uuid);
  }
}

/* -------------------------------------------- */

/**
 * The level up of a unit that has one to gain.
 * @param {Actor} actor
 * @returns {Promise<boolean>}    Did it gain the level?
 */
async function levelUp(actor) {
  const system = actor.system;
  const source = actor._source.system;
  const cls = system.classItem;
  if ( promotesAt(system.level, cls) ) return !!(await promoteUnit(actor, { levelUp: true }));

  let promote = false;
  if ( !cls && FEO.promotionLevels.includes(system.level) ) {
    const choice = await DialogV2.wait({
      window: { title: "FEO.LevelUp.promotionTitle" },
      content: `<p>${game.i18n.format("FEO.LevelUp.promotionPrompt", { level: system.level })}</p>`,
      buttons: [
        { action: "promote", label: "FEO.LevelUp.promote", default: true },
        { action: "level", label: "FEO.LevelUp.levelNormally" }
      ],
      rejectClose: false
    });
    if ( !choice ) return false;
    promote = choice === "promote";
  }

  const level = system.level + 1;
  const points = system.checkPointsPerLevel;
  const update = {
    "system.level": level,
    "system.exp": system.exp - FEO.expPerLevel,
    "system.checkPoints": system.checkPoints + points
  };
  const rows = [{
    label: game.i18n.localize("FEO.LevelUp.abilityPoints"),
    value: `+${points}`
  }];
  const rolls = [];
  let lasting = [];
  let splash = null;

  if ( !promote ) {
    const capped = Object.entries(system.stats).filter(([, stat]) => stat.capped).map(([key]) => key);
    if ( system.hp.capped ) capped.push("hp");
    if ( system.weaponLevel?.used && system.weaponLevel.capped ) capped.push("wlv");
    const growths = Object.keys(FEO.growths);
    let gained;

    // With Manual Stat Gains the level's points are placed by hand, in place of what the growth rates roll
    if ( FEO.optional.manualGains.enabled ) {
      const manual = await manualLevelUp(actor, capped);
      if ( !manual ) return false;
      rolls.push(...manual.rolls);
      rows.push(...manual.rows);
      gained = manual.results;
    }
    else {
      const { roll, results } = await rollD100(growths.length - capped.filter((key) => growths.includes(key)).length);
      rolls.push(roll);
      const dice = results.slice();

      // A skill may let the growth rates that failed be rolled once more
      const again = await rerollFailed(actor, rollGrowths(system.growthRates ?? system.growths, capped, () => dice.shift()));
      if ( again.roll ) rolls.push(again.roll);
      gained = again.results;
      for ( const result of gained ) {
        const label = game.i18n.localize(FEO.growths[result.key]);
        if ( result.capped ) rows.push({ label, value: game.i18n.localize("FEO.LevelUp.atCap"), cls: "muted" });
        else rows.push({ label, value: growthValue(result, game.i18n), cls: result.gain ? "good" : "muted" });
      }
    }
    for ( const result of gained ) {
      if ( result.capped || !result.gain ) continue;
      if ( result.key === "hp" ) {
        update["system.hp.max"] = source.hp.max + result.gain;
        update["system.hp.value"] = system.hp.value + result.gain;
      }
      else if ( result.key in FEO.abilities ) {
        update[`system.abilities.${result.key}.increase`] = source.abilities[result.key].increase + result.gain;
      }
      else if ( result.key === "wlv" ) {
        update["system.weaponLevel.base"] = Math.min(source.weaponLevel.base + result.gain, system.weaponLevel.cap);
      }
      else update[`system.stats.${result.key}.base`] = source.stats[result.key].base + result.gain;
    }

    // What the unit's skills do at a level up: gold, HP restored, a boost that lasts a while
    const skills = levelUpSkills(actor, gained, update);
    Object.assign(update, skills.update);
    rows.push(...skills.rows);
    lasting = skills.grants;

    // The Level Up splash is put together from the unit as it stands, before what it gained is saved
    splash = buildLevelUpSplash(actor, { from: system.level, to: level, results: gained, points, notes: skills.rows });
  }
  else {
    // A promotion that takes the place of a level up is one to the unit's skills. Its class is applied by
    // hand, so nothing is known of the stats it raises
    const skills = levelUpSkills(actor, [], update);
    Object.assign(update, skills.update);
    rows.push(...skills.rows);
    lasting = skills.grants;
  }

  // With Additional Lives, promoting grants one more life in total and restores one
  const lives = promote ? promotionLifeUpdate(actor) : {};
  if ( "system.lives.max" in lives ) {
    Object.assign(update, lives);
    rows.push({
      label: game.i18n.localize("FEO.Optional.lives.title"),
      value: `${lives["system.lives.value"]} / ${lives["system.lives.max"]}`,
      cls: "good"
    });
  }
  await actor.update(update);

  // The splash shows what the dice came to before the card tells of it in chat
  if ( splash ) await showLevelUp(actor, splash);
  await postCard(actor, {
    title: game.i18n.format(promote ? "FEO.LevelUp.promotedTo" : "FEO.LevelUp.reached", { level }),
    rows,
    note: promote ? game.i18n.localize("FEO.LevelUp.promotionNote") : undefined
  }, { rolls });
  if ( lasting.length ) await grantTimed(actor, lasting);

  // A class that does not promote learns its skills, and may gain stats, on reaching certain levels
  if ( cls ) await applyLevelGains(actor, level);
  return true;
}

/* -------------------------------------------- */
/*  Levelling Up by Itself                      */
/* -------------------------------------------- */

/**
 * Do units level up by themselves in this world?
 * @returns {boolean}
 */
export function autoLevelUpOn() {
  try {
    return game.settings.get(FEO.id, AUTO_SETTING) !== false;
  } catch(err) {
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Can a unit level up right now: does a level wait for it, and is it itself?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function canLevelUp(actor) {
  if ( (actor?.type !== "unit") || actor.inCompendium || !levelWaits(actor.system) ) return false;
  return !growthBar(actor);
}

/* -------------------------------------------- */

/**
 * The user on whose client a unit levels up by itself.
 * @param {Actor} actor
 * @returns {User|null}     Null where it waits for its player to join
 */
export function levelsUp(actor) {
  const id = levelsUnit(game.users.map((user) => ({
    id: user.id,
    active: user.active,
    gm: user.isGM,
    owner: actor.testUserPermission(user, "OWNER"),
    character: user.character?.id === actor.id
  })), game.users.activeGM?.id ?? null);
  return id ? (game.users.get(id) ?? null) : null;
}

/* -------------------------------------------- */

/**
 * Is a unit this user's to level up by itself, right now?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
function isDue(actor) {
  return autoLevelUpOn() && canLevelUp(actor) && !declined.has(actor.uuid) && !!levelsUp(actor)?.isSelf;
}

/* -------------------------------------------- */

/**
 * Have a unit level up by itself, where it is this user's to level and a level waits for it. It takes its turn
 * behind the units that wait already.
 * @param {Actor|null} actor
 * @returns {boolean}     Was it put in line?
 */
export function queueLevelUp(actor) {
  if ( !isDue(actor) || queue.includes(actor.uuid) ) return false;
  queue.push(actor.uuid);
  workQueue().catch((err) => console.error(err));
  return true;
}

/* -------------------------------------------- */

/** Wait a while. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Level up the units that wait, one after the other. Each waits a moment first, so that what earned it the
 * experience is shown before its level up, and for a Level Up splash that is on the screen to leave.
 * @returns {Promise<void>}
 */
async function workQueue() {
  if ( turning ) return;
  turning = true;
  try {
    while ( queue.length ) {
      await wait(FEO.levelUp.wait);
      while ( levelUpShowing() ) await wait(250);
      const uuid = queue.shift();
      try {
        const actor = await foundry.utils.fromUuid(uuid);
        if ( !isDue(actor) ) continue;
        if ( !(await levelUpUnit(actor)) ) declined.add(uuid);
      } catch(err) {
        console.error(err);
        declined.add(uuid);
      }
    }
  } finally {
    turning = false;
  }
}

/* -------------------------------------------- */
/*  Settings and Hooks                          */
/* -------------------------------------------- */

/**
 * Register the world's setting for levelling up by itself. Called once, when the system starts.
 */
export function registerSettings() {
  game.settings.register(FEO.id, AUTO_SETTING, {
    name: "FEO.Setting.levelUpOnExp.name",
    hint: "FEO.Setting.levelUpOnExp.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

/* -------------------------------------------- */

/**
 * Register what has units level up by themselves: a unit that earns experience, or is itself again after it
 * imitated another or was under a Level Sync, is looked at on every client, and levelled on the one it belongs
 * to. A user who joins is asked for the units of their own that waited meanwhile. Called once, when the system
 * starts.
 */
export function registerHooks() {
  Hooks.on("updateActor", (actor, changed) => {
    try {
      if ( actor.type !== "unit" ) return;
      const earned = foundry.utils.hasProperty(changed, "system.exp");
      if ( earned ) declined.delete(actor.uuid);

      // A note that is taken off a unit is told as its key, with or without the mark of a key to delete
      const freed = Object.keys(changed.flags?.[FEO.id] ?? {}).some((key) => BARS.includes(key.replace(/^-=/, "")));
      if ( earned || freed ) queueLevelUp(actor);
    } catch(err) {
      console.error(err);
    }
  });
  Hooks.once("ready", () => {
    for ( const actor of game.actors ) {
      const mine = (game.user.character?.id === actor.id) || (!game.user.isGM && actor.isOwner);
      if ( mine ) queueLevelUp(actor);
    }
  });
}

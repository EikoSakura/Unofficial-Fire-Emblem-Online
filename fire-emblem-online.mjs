import Base from "./module/apps/base.mjs";
import BattleHud from "./module/apps/battle-hud.mjs";
import MapGenerator from "./module/apps/map-generator.mjs";
import Compendium from "./module/apps/compendium.mjs";
import OptionalRulesConfig from "./module/apps/optional-rules-config.mjs";
import { FEO } from "./module/config.mjs";
import * as models from "./module/data/_module.mjs";
import TerrainRegionBehavior from "./module/data/region-terrain.mjs";
import FeoCombat from "./module/documents/combat.mjs";
import * as captureHelpers from "./module/helpers/capturing.mjs";
import * as conditionHelpers from "./module/helpers/conditions.mjs";
import * as creationHelpers from "./module/helpers/creation.mjs";
import * as defeatHelpers from "./module/helpers/defeat.mjs";
import { registerDiscord } from "./module/helpers/discord.mjs";
import { APPLY_QUERY, applyExchangeQuery } from "./module/helpers/exchange.mjs";
import * as experienceHelpers from "./module/helpers/experience.mjs";
import * as optionalHelpers from "./module/helpers/optional.mjs";
import * as reclassHelpers from "./module/helpers/reclass.mjs";
import * as positionHelpers from "./module/helpers/positions.mjs";
import * as optionalRules from "./module/rules/optional.mjs";
import { registerRulesSearch } from "./module/helpers/rules-search.mjs";
import { iconHtml } from "./module/helpers/icons.mjs";
import * as shiftHelpers from "./module/helpers/shifting.mjs";
import * as skillRankHelpers from "./module/helpers/skill-ranks.mjs";
import * as summonHelpers from "./module/helpers/summon.mjs";
import * as staggerHelpers from "./module/helpers/stagger.mjs";
import * as supportHelpers from "./module/helpers/supports.mjs";
import * as turnHelpers from "./module/helpers/turns.mjs";
import { WARP_QUERY, onCombatantCreated, warpQuery } from "./module/helpers/warp.mjs";
import * as weaponHelpers from "./module/helpers/weapons.mjs";
import * as breaking from "./module/rules/breaking.mjs";
import * as capturing from "./module/rules/capturing.mjs";
import * as combat from "./module/rules/combat-stats.mjs";
import * as classes from "./module/rules/classes.mjs";
import * as conditions from "./module/rules/conditions.mjs";
import * as creation from "./module/rules/creation.mjs";
import * as exchange from "./module/rules/combat.mjs";
import * as defeat from "./module/rules/defeat.mjs";
import * as experience from "./module/rules/experience.mjs";
import * as progression from "./module/rules/progression.mjs";
import * as shifting from "./module/rules/shifting.mjs";
import * as stagger from "./module/rules/stagger.mjs";
import * as supports from "./module/rules/supports.mjs";
import * as weapons from "./module/rules/weapons.mjs";
import FeoItemSheet from "./module/sheets/item-sheet.mjs";
import UnitSheet from "./module/sheets/unit-sheet.mjs";

Hooks.once("init", () => {
  CONFIG.FEO = FEO;
  game.feo = {
    config: FEO,
    models,
    rules: {
      ...combat, ...exchange, ...progression, ...classes, ...conditions,
      ...experience, ...defeat, ...weapons, ...supports, ...shifting
    },
    conditions: conditionHelpers,
    experience: experienceHelpers,
    defeat: defeatHelpers,
    weapons: weaponHelpers,
    supports: supportHelpers,
    shifting: shiftHelpers,
    turns: turnHelpers,
    optional: optionalHelpers,
    reclass: reclassHelpers,
    positions: positionHelpers,
    creation: creationHelpers
  };
  Object.assign(game.feo.rules, optionalRules, creation, breaking, capturing, stagger);
  game.feo.capturing = captureHelpers;
  game.feo.stagger = staggerHelpers;

  // The rules a world may choose to play with are world settings, set from one menu of the system settings
  // rather than listed among them one by one
  OptionalRulesConfig.register();

  // The Additional Conditions of the Optional Modules join the core ones when the world asks for them
  game.settings.register(FEO.id, "additionalConditions", {
    name: "FEO.Setting.additionalConditions.name",
    hint: "FEO.Setting.additionalConditions.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: true
  });
  if ( game.settings.get(FEO.id, "additionalConditions") ) Object.assign(FEO.conditions, FEO.optionalConditions);

  // How the world handles defeat and how supports grow
  game.settings.register(FEO.id, "incapacitation", {
    name: "FEO.Setting.incapacitation.name",
    hint: "FEO.Setting.incapacitation.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: FEO.defeat.enabled,
    requiresReload: true
  });
  FEO.defeat.enabled = game.settings.get(FEO.id, "incapacitation");
  game.settings.register(FEO.id, "supportMethod", {
    name: "FEO.Setting.supportMethod.name",
    hint: "FEO.Setting.supportMethod.hint",
    scope: "world",
    config: false,
    type: String,
    choices: FEO.supports.methods,
    default: FEO.supports.method,
    requiresReload: true
  });
  const method = game.settings.get(FEO.id, "supportMethod");
  if ( method in FEO.supports.methods ) FEO.supports.method = method;

  // The Optional Modules that are a setting and a few fields on the unit. Each is off until the world asks for
  // it; one that can be read in more than one way is a choice between its readings
  for ( const [setting, key] of Object.entries(FEO.optionalSettings) ) {
    const module = FEO.optional[key];
    const modes = module.modes ?? null;
    game.settings.register(FEO.id, setting, {
      name: `FEO.Setting.${setting}.name`,
      hint: `FEO.Setting.${setting}.hint`,
      scope: "world",
      config: false,
      requiresReload: true,
      ...(modes
        ? { type: String, choices: { off: "FEO.Setting.off", ...modes }, default: "off" }
        : { type: Boolean, default: false })
    });
    const value = game.settings.get(FEO.id, setting);
    module.enabled = modes ? (value in modes) : (value === true);
    if ( module.enabled && modes ) module.mode = value;
  }
  if ( FEO.optional.affinities.enabled ) {
    Object.assign(FEO.affinities, FEO.optionalAffinities);
    Object.assign(FEO.affinityBoosts, FEO.optionalAffinityBoosts);
  }
  if ( FEO.optional.manualGains.enabled && (FEO.optional.manualGains.mode !== "points") ) {
    FEO.creation.growth.free = FEO.optional.manualGains.growthPoints;
  }
  if ( FEO.optional.weaponLevel.enabled ) {
    Object.assign(FEO.growths, FEO.weaponLevelGrowth);
    FEO.growthCaps.wlv = FEO.optional.weaponLevel.growthCap;
    if ( !FEO.creation.bonus.stats.includes("wlv") ) FEO.creation.bonus.stats.push("wlv");
  }
  if ( FEO.optional.growths.enabled ) {
    Object.assign(FEO.growths, FEO.optionalGrowths);
    Object.assign(FEO.growthCaps, FEO.optional.growths.caps);
  }

  // The extended weapon triangle takes the place of the core one where the world asks for it
  if ( breaking.extendedInUse() ) Object.assign(FEO.triangle, breaking.extendedTriangle());
  optionalHelpers.registerHooks();
  reclassHelpers.registerHooks();

  // A skill that gives a weapon rank raises it as the skill is taken, and takes it back as the skill goes
  skillRankHelpers.registerHooks();

  // Stagger: whatever lowers a unit's HP lowers its Stagger bar, which tokens show beside their HP while the
  // world plays with it
  staggerHelpers.registerHooks();

  // The search box of the rules journal looks through the text of every page
  registerRulesSearch();

  // A Game Master can send any page of the rules journal to a Discord channel, through a webhook set up in the
  // system's settings
  registerDiscord();

  // The Compendium: the class tree, the skills and the equipment of the system's compendiums in one window,
  // opened from the Fire Emblem controls or with game.feo.compendium.open()
  Compendium.register();

  // The Base: where the company rests between battles, with its roster, convoy, market, forge, supports,
  // training grounds and notice board, opened from the Fire Emblem controls or with game.feo.base.open()
  Base.register();

  // The battle map: a Game Master paints terrain and elevation with the terrain brush of the Fire Emblem
  // controls, or with Regions that carry the Terrain behaviour, and the Battle HUD shows whose Phase it is,
  // the selected unit and its actions, where it can go and what it can strike, the ground under the pointer
  // and the forecast of an attack started from the map
  CONFIG.RegionBehavior.dataModels.terrain = TerrainRegionBehavior;
  CONFIG.RegionBehavior.typeIcons.terrain = "fa-solid fa-mountain-sun";
  BattleHud.register();

  // The map generator: a battlefield made up from a kind, a size and a seed, looked at and rerolled in a window
  // and then made into a scene of its own, opened from the Fire Emblem controls or with
  // game.feo.mapGenerator.open()
  MapGenerator.register();

  // The Character Creator: who is looking at which step of a unit, and calls for help
  Hooks.once("ready", () => creationHelpers.registerCreation());

  // Encounters count down conditions as the turns of units start and end
  CONFIG.Combat.documentClass = FeoCombat;

  // Lets a player's attack save its results to units only a Game Master may change
  CONFIG.queries[APPLY_QUERY] = applyExchangeQuery;

  // Lets a player's staff warp a unit whose token only a Game Master may move, and has a unit that joins a
  // battle under way remember where it took the field
  CONFIG.queries[WARP_QUERY] = warpQuery;
  Hooks.on("createCombatant", onCombatantCreated);

  // Lets a player's Summon make its Phantom and place its token, which only a Game Master may do; a Phantom
  // keeps to the level of its summoner
  CONFIG.queries[summonHelpers.SUMMON_QUERY] = summonHelpers.placeSummon;
  summonHelpers.registerHooks();
  game.feo.summon = summonHelpers;

  // Data models
  CONFIG.Actor.dataModels.unit = models.UnitData;
  CONFIG.Item.dataModels.weapon = models.WeaponData;
  CONFIG.Item.dataModels.skill = models.SkillData;
  CONFIG.Item.dataModels.gear = models.GearData;
  CONFIG.Item.dataModels.class = models.ClassData;
  CONFIG.Item.dataModels.art = models.ArtData;
  CONFIG.Item.dataModels.battalion = models.BattalionData;

  // Token resource bars and trackable values
  CONFIG.Actor.trackableAttributes = {
    unit: {
      bar: FEO.optional.stagger.enabled ? ["hp", "stagger"] : ["hp"],
      value: ["level", "exp", "gold"]
    }
  };

  // Conditions replace the core status effects; "dead" is kept so that defeated tokens still work.
  // The turns a condition has left are kept in a flag and counted by the system, so the effects are given no
  // duration for the core round clock to expire
  const defeated = CONFIG.statusEffects.find((status) => status.id === CONFIG.specialStatusEffects.DEFEATED);
  const lasting = Object.entries(FEO.conditions).filter(([, condition]) => !condition.combatOnly);
  const statuses = lasting.map(([id, condition]) => ({
    id,
    name: `FEO.Condition.${id}`,
    img: condition.img,
    flags: { [FEO.id]: { turns: condition.turns } }
  }));
  // A unit that is down is marked on its token; the system keeps the mark in step with the unit
  const down = { id: FEO.defeat.status.id, name: "FEO.Defeat.incapacitated", img: FEO.defeat.status.img };
  CONFIG.statusEffects.length = 0;
  for ( const status of [defeated, down, ...statuses] ) {
    if ( status ) CONFIG.statusEffects[status.id] = status;
  }

  // Whatever changes a unit's HP, the system works out what that means for it
  Hooks.on("preUpdateActor", (actor, changes, options) => defeatHelpers.rememberHp(actor, changes, options));
  Hooks.on("preUpdateActorDelta", (delta, changes, options) => {
    defeatHelpers.rememberHp(delta.syntheticActor, changes, options);
  });
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    defeatHelpers.followHp(actor, changed, options, userId).catch((err) => console.error(err));
  });

  // A unit that is out of the fight holds its captive no longer
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    captureHelpers.followCaptor(actor, changed, options, userId).catch((err) => console.error(err));
  });

  // Support partners are in range when their tokens are
  const moved = ["x", "y", "width", "height", "elevation"];
  Hooks.on("updateToken", (token, changes) => {
    if ( moved.some((key) => key in changes) ) supportHelpers.queueRanges(token.parent);
  });
  Hooks.on("createToken", (token) => supportHelpers.queueRanges(token.parent));
  Hooks.on("deleteToken", (token) => supportHelpers.queueRanges(token.parent));
  Hooks.on("canvasReady", () => supportHelpers.queueRanges(canvas.scene));

  // A unit's token does not turn: its rotation is locked as the unit is made and as a token of it is placed,
  // and tokens that were on a map before are locked by the Game Master's client as the map is drawn
  Hooks.on("preCreateActor", (actor) => {
    if ( actor.type === "unit" ) actor.updateSource({ prototypeToken: { lockRotation: true } });
  });
  Hooks.on("preCreateToken", (token) => {
    if ( game.actors.get(token.actorId)?.type === "unit" ) token.updateSource({ lockRotation: true });
  });
  Hooks.on("canvasReady", () => {
    if ( !game.user.isActiveGM || !canvas.scene ) return;
    const updates = canvas.scene.tokens
      .filter((token) => !token.lockRotation && (game.actors.get(token.actorId)?.type === "unit"))
      .map((token) => ({ _id: token.id, lockRotation: true }));
    if ( updates.length ) canvas.scene.updateEmbeddedDocuments("Token", updates).catch((err) => console.error(err));
  });

  // Skills that ask where units stand, and auras, follow the tokens of the scene in view
  positionHelpers.registerHooks(models.UnitData);

  // Template helpers
  Handlebars.registerHelper("feoIcon", (name) => new Handlebars.SafeString(iconHtml(name)));

  // Sheets
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, FEO.id, UnitSheet, {
    types: ["unit"],
    makeDefault: true,
    label: "FEO.Sheet.unit"
  });
  DocumentSheetConfig.registerSheet(foundry.documents.Item, FEO.id, FeoItemSheet, {
    types: ["weapon", "skill", "gear", "class", "art", "battalion"],
    makeDefault: true,
    label: "FEO.Sheet.item"
  });
});

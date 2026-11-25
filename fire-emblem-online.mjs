import Base from "./module/apps/base.mjs";
import BattleHud from "./module/apps/battle-hud.mjs";
import ChatInspector from "./module/apps/chat-inspector.mjs";
import EncounterBuilder from "./module/apps/encounter-builder.mjs";
import MapGenerator from "./module/apps/map-generator.mjs";
import NpcBuilder from "./module/apps/npc-builder.mjs";
import Compendium from "./module/apps/compendium.mjs";
import OptionalRulesConfig from "./module/apps/optional-rules-config.mjs";
import WorldMap from "./module/apps/world-map.mjs";
import { FEO } from "./module/config.mjs";
import * as models from "./module/data/_module.mjs";
import TerrainRegionBehavior from "./module/data/region-terrain.mjs";
import FeoCombat from "./module/documents/combat.mjs";
import * as captureHelpers from "./module/helpers/capturing.mjs";
import * as conditionHelpers from "./module/helpers/conditions.mjs";
import * as creationHelpers from "./module/helpers/creation.mjs";
import * as defeatHelpers from "./module/helpers/defeat.mjs";
import * as helpListHelpers from "./module/helpers/help-list.mjs";
import { registerDiscord } from "./module/helpers/discord.mjs";
import * as eventHelpers from "./module/helpers/events.mjs";
import * as cutInHelpers from "./module/helpers/cut-ins.mjs";
import * as levelSyncHelpers from "./module/helpers/level-sync.mjs";
import * as levelUpHelpers from "./module/helpers/level-up.mjs";
import * as linkingHelpers from "./module/helpers/linking.mjs";
import * as migrationHelpers from "./module/helpers/migration.mjs";
import * as npcHelpers from "./module/helpers/npc.mjs";
import { APPLY_QUERY, applyExchangeQuery } from "./module/helpers/exchange.mjs";
import * as experienceHelpers from "./module/helpers/experience.mjs";
import * as optionalHelpers from "./module/helpers/optional.mjs";
import * as pickHelpers from "./module/helpers/picks.mjs";
import * as reclassHelpers from "./module/helpers/reclass.mjs";
import * as positionHelpers from "./module/helpers/positions.mjs";
import * as clockHelpers from "./module/helpers/clock.mjs";
import * as movementHelpers from "./module/helpers/movement.mjs";
import * as cantoHelpers from "./module/helpers/canto.mjs";
import * as actingHelpers from "./module/helpers/acting.mjs";
import * as actionHelpers from "./module/helpers/actions.mjs";
import * as forcedHelpers from "./module/helpers/forced.mjs";
import * as optionalRules from "./module/rules/optional.mjs";
import { registerRulesSearch } from "./module/helpers/rules-search.mjs";
import { iconHtml } from "./module/helpers/icons.mjs";
import * as rescueHelpers from "./module/helpers/rescue.mjs";
import * as reactionHelpers from "./module/helpers/reactions.mjs";
import * as stanceHelpers from "./module/helpers/stances.mjs";
import * as lendingHelpers from "./module/helpers/lending.mjs";
import * as gearHelpers from "./module/helpers/gear.mjs";
import * as stealingHelpers from "./module/helpers/stealing.mjs";
import * as tradingHelpers from "./module/helpers/trading.mjs";
import * as objectHelpers from "./module/helpers/objects.mjs";
import * as trapHelpers from "./module/helpers/traps.mjs";
import * as weatherHelpers from "./module/helpers/weather.mjs";
import * as choiceHelpers from "./module/helpers/choices.mjs";
import * as answerHelpers from "./module/helpers/answers.mjs";
import * as refreshHelpers from "./module/helpers/refresh.mjs";
import * as shiftHelpers from "./module/helpers/shifting.mjs";
import * as skillRankHelpers from "./module/helpers/skill-ranks.mjs";
import * as creatureHelpers from "./module/helpers/creatures.mjs";
import * as imitationHelpers from "./module/helpers/imitation.mjs";
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
import * as events from "./module/rules/events.mjs";
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
    movement: movementHelpers,
    canto: cantoHelpers,
    acting: actingHelpers,
    creation: creationHelpers
  };
  Object.assign(game.feo.rules, optionalRules, creation, breaking, capturing, stagger, events);
  game.feo.events = eventHelpers;
  game.feo.picks = pickHelpers;
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

  // Supports: the heart that pops over two partners as they grow closer, and their choice between A+ and S
  supportHelpers.registerHooks();

  // A skill that gives a weapon rank raises it as the skill is taken, and takes it back as the skill goes
  skillRankHelpers.registerHooks();

  // Stagger: whatever lowers a unit's HP lowers its Stagger bar, which tokens show beside their HP while the
  // world plays with it
  staggerHelpers.registerHooks();

  // The search box of the rules journal looks through the text of every page
  registerRulesSearch();

  // A chat card shows its headline and its results. Everything else it was given is kept with the message,
  // and opens in a window of its own from the message's right-click menu or the magnifying glass on the card
  ChatInspector.register();

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

  // The NPC Builder and the Encounter Builder: a unit for the Game Master to play, made from a class, a Level
  // and a side; and a battle prepared ahead of the session, with who is in it, where they stand, what the party
  // has to do and how hard that reads for the party that goes. Both open from the Fire Emblem controls, or with
  // game.feo.npcBuilder.open() and game.feo.encounterBuilder.open()
  NpcBuilder.register();
  EncounterBuilder.register();
  npcHelpers.registerHooks();
  game.feo.npcs = npcHelpers;

  // The World Map: the land of the campaign with a dot for each place, routes between them and the ground of
  // each nation, on which the Game Master sends the company from place to place; and its Creator, in which the
  // map is made and changed. They open from the Fire Emblem controls, or with game.feo.worldMap.open() and
  // game.feo.worldMap.creator.open()
  WorldMap.register();

  // The Character Creator: who is looking at which step of a unit, and calls for help
  Hooks.once("ready", () => creationHelpers.registerCreation());

  // A unit that waits for help in its Creator carries a raised hand beside its name in the Actors list
  helpListHelpers.registerHooks();

  // Encounters count down conditions as the turns of units start and end
  CONFIG.Combat.documentClass = FeoCombat;

  // Lets a player's attack save its results to units only a Game Master may change
  CONFIG.queries[APPLY_QUERY] = applyExchangeQuery;

  // Damage, healing, conditions and kills from any source go one way each, where the unit's skills are asked
  // what they make of them; a player's staff or skill reaches a unit only a Game Master may change through it
  CONFIG.queries[eventHelpers.EVENT_QUERY] = eventHelpers.unitEventQuery;
  eventHelpers.registerHooks();

  // Skill cut-ins: as a skill takes effect its icon and name flash over its unit, for each user as fast as
  // they ask, or not at all
  cutInHelpers.registerSettings();
  cutInHelpers.registerHooks();
  game.feo.cutIns = cutInHelpers;

  // The Level Up splash: a level up is shown over the whole screen, to the one who levelled the unit and to
  // those who watch, each as they ask
  levelUpHelpers.registerSettings();
  levelUpHelpers.registerHooks();
  game.feo.levelUp = levelUpHelpers;

  // A skill that picks something as it is learnt asks for it once, wherever it is gained, and keeps it
  pickHelpers.registerHooks();

  // Skills that units learnt from an older skills compendium are brought up to date with the one the system
  // now has, as a Game Master opens the world; game.feo.migration.refreshSkills() does it again when asked
  migrationHelpers.registerMigration();
  game.feo.migration = migrationHelpers;

  // A player's unit stands on the map as itself: its token is linked to its sheet as it is made or handed to a
  // player, and the units players had before are linked once; game.feo.linking.linkPlayerUnits() does it again
  linkingHelpers.registerHooks();
  game.feo.linking = linkingHelpers;

  // Lets a player's staff warp a unit whose token only a Game Master may move, and has a unit that joins a
  // battle under way remember where it took the field
  CONFIG.queries[WARP_QUERY] = warpQuery;

  // Moving a unit against its will, and ending the hold one unit has on another, for a player who does not
  // own that unit
  CONFIG.queries[forcedHelpers.FORCED_QUERY] = forcedHelpers.forcedQuery;
  CONFIG.queries[actionHelpers.GRIP_QUERY] = actionHelpers.endGripQuery;
  game.feo.forced = forcedHelpers;
  game.feo.actions = actionHelpers;

  // Rescue: picking up, handing over and setting down a unit this user does not own, offering something on
  // the map of whoever acts for a unit, and what follows a carrier wherever it goes
  CONFIG.queries[rescueHelpers.CARRY_QUERY] = rescueHelpers.carryQuery;
  CONFIG.queries[rescueHelpers.OFFER_QUERY] = rescueHelpers.offerQuery;
  rescueHelpers.registerHooks();
  game.feo.rescue = rescueHelpers;

  // Standing guard and stepping in: a stance ends with what it names, as units move and fall; and a unit that
  // is dragged in its own turn is watched like one that is moved by a click
  stanceHelpers.registerHooks();
  reactionHelpers.registerHooks();
  game.feo.stances = stanceHelpers;
  game.feo.reactions = reactionHelpers;

  // Weapons a skill lends its unit: one that was taken up is put down as a weapon of its own is taken in hand
  lendingHelpers.registerHooks();

  // Skills that gear grants: a weapon, an accessory or a Shield that grants a skill gives its unit that skill
  // for as long as it is equipped
  gearHelpers.registerHooks();
  game.feo.gear = gearHelpers;

  // Stealing and loot, and the doors, chests and Villages of a map: a player whose unit takes from a unit
  // that is not theirs, or acts on something that stands on the scene, asks a Game Master to do it
  CONFIG.queries[stealingHelpers.STEAL_QUERY] = stealingHelpers.stealQuery;
  CONFIG.queries[stealingHelpers.CRAFT_QUERY] = stealingHelpers.craftQuery;
  CONFIG.queries[objectHelpers.OBJECT_QUERY] = objectHelpers.objectQuery;

  // Mines and Traps: a player's unit that lays one, springs one or takes one away asks a Game Master to
  CONFIG.queries[trapHelpers.TRAP_QUERY] = trapHelpers.trapQuery;
  game.feo.traps = trapHelpers;
  game.feo.weather = weatherHelpers;
  stealingHelpers.registerSettings();
  game.feo.stealing = stealingHelpers;
  game.feo.trading = tradingHelpers;
  game.feo.objects = objectHelpers;
  game.feo.lending = lendingHelpers;

  // What a unit chooses before a fight: offering a unit that is attacked another weapon is done on the client
  // of whoever acts for it
  CONFIG.queries[choiceHelpers.REARM_QUERY] = choiceHelpers.rearmQuery;
  game.feo.choices = choiceHelpers;

  // Answers in the middle of a fight: a unit's answers are offered on the client of whoever acts for it. The
  // units no player owns answer by themselves, unless the world has its Game Master asked for them
  CONFIG.queries[answerHelpers.ANSWER_QUERY] = answerHelpers.answerQuery;
  game.feo.answers = answerHelpers;
  game.settings.register(FEO.id, answerHelpers.ALONE_SETTING, {
    name: "FEO.Setting.gmAnswers.name",
    hint: "FEO.Setting.gmAnswers.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: FEO.answers.alone.enabled,
    onChange: (value) => (FEO.answers.alone.enabled = !!value)
  });
  FEO.answers.alone.enabled = !!game.settings.get(FEO.id, answerHelpers.ALONE_SETTING);

  // Refresh: giving its Action back to a unit this user does not own is done by a Game Master
  CONFIG.queries[refreshHelpers.REFRESH_QUERY] = refreshHelpers.refreshQuery;
  game.feo.refresh = refreshHelpers;
  Hooks.on("createCombatant", onCombatantCreated);

  // Lets a player's Summon make its Phantom and place its token, which only a Game Master may do; a Phantom
  // keeps to the level of its summoner
  CONFIG.queries[creatureHelpers.CREATURE_QUERY] = creatureHelpers.placeCreature;
  creatureHelpers.registerHooks();
  game.feo.creatures = creatureHelpers;

  // Imitation: a unit that took on another's attributes is itself again when its turns run out
  imitationHelpers.registerHooks();
  game.feo.imitation = imitationHelpers;

  // Level Sync: a unit keeps a record of what it was at each Level, and one above the Levels an encounter is
  // for fights in it as it was at the top of them
  levelSyncHelpers.registerHooks();
  game.feo.levelSync = levelSyncHelpers;

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

  // Skills that ask how their unit moved this turn follow what its token has noted of it
  movementHelpers.registerHooks(models.UnitData);

  // Skills that ask the turn of the battle follow its encounter
  clockHelpers.registerHooks(models.UnitData);

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

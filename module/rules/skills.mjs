/**
 * Skill effects for Fire Emblem Online: what a unit's equipped skills add to its stats and combat stats, and
 * which combat rules they bend, read from the structured effects each skill carries beside its Effect text.
 * Pure functions of plain data, so that they can be tested outside of Foundry.
 *
 * A skill effect says when it applies and what it does:
 *
 *   {
 *     choice: "mighty",                 // only while the skill's chosen variant is this one
 *     when: {                           // every part that is given must hold
 *       role: "initiating",             // or "defending"
 *       hp: { op: "le", percent: 50 },  // the unit's HP: le, lt, ge, gt, full, notFull
 *       foeHp: { op: "full" },          // the foe's HP, the same way. Both are read once, as the fight is
 *                                       // planned: what holds then holds for every attack of that fight,
 *                                       // whatever the fight does to the HP of the two
 *       weapon: ["sword"],              // the unit's weapon: categories or groups (see `weaponIs`)
 *       quality: ["Armored"],           // the unit itself has any of these Special Qualities
 *       lacks: ["Mounted"],             // the unit itself has none of these Special Qualities
 *       skill: "Plunder",               // the unit has this skill equipped; `noSkill` when it has not
 *       carries: "Wealth Of Power (Red Gem)",    // the unit carries a lasting change of its own by this name
 *       foeWeapon: ["magic"],           // the foe's weapon
 *       foeWeaponNot: ["blessed"],      // the foe's weapon is none of these
 *       foeQuality: ["Flying"],         // the foe has any of these Special Qualities
 *       foeNoQuality: true,             // the foe has no Special Quality
 *       foeCounters: false,             // whether the foe can answer in this fight
 *       counters: false,                // whether the unit itself can
 *       range: { min: 2 },              // tiles between the two
 *       compare: { left: "str", right: "str", margin: 4 },   // the unit's value less the foe's is at least this;
 *                                                            // with `reverse`, the foe's less the unit's
 *       foeAfflicted: true,             // the foe suffers from a condition
 *       foeLacks: ["Terror"],           // the foe has none of these Special Qualities
 *       near: { who: "ally", within: 2 },         // units around the unit (see below)
 *       foeNear: { who: "ally", within: 1 },      // the unit's allies (or enemies) around the unit it fights
 *       flanking: true,                 // an ally stands right behind the foe, straight across from the unit
 *       sameSpace: true,                // the unit and the foe stand in one space
 *       terrain: true,                  // the unit stands on terrain with effects (see `terrain.mjs`); `false`
 *                                       // for terrain without any
 *       standsOn: ["forest", "thicket"],          // it stands on one of these kinds of terrain
 *       foeTerrain: true,               // the same two, asked of the tile its foe stands on
 *       foeOn: ["forest", "thicket"],
 *       noModule: "leadership",         // the Optional Module of this name is not in use; `module` when it is
 *       tier: { min: 2 },               // the unit's class tier (see below); also `max`
 *       gender: "male",                 // the unit is of this gender, or of neither: "male" or "female"
 *       bestRank: "physical"            // its highest weapon rank is in a physical proficiency, or "magical";
 *                                       // a tie between the two counts for both
 *     },
 *     stats: { str: 3 },                // added to stats
 *     statPercent: { str: 50 },         // a share of the stat's total added to it
 *     combat: { hit: 5 },               // added to combat stats; `activation` is the Skill Activation rate
 *     might: 4,                         // added to the weapon's Might
 *     taken: -2,                        // added to the damage of every hit the unit takes
 *     takenPercent: -25,                // the same as a share
 *     endurance: 2,                     // END: taken off the damage of every hit the unit takes
 *     haste: 1,                         // HST: counted as Attack Speed for the unit's own follow-up attack
 *     mirrorCrit: 15,                   // Critical for its own chance of being critically hit, up to this much
 *     critMultiplier: 3.5,              // what the damage of its critical hits is multiplied by, in place of the
 *                                       // usual amount
 *     abilities: { cha: 1 },            // added to Charm and Intelligence
 *     slots: 1,                         // more skills the unit may have equipped at once
 *     capacity: 20,                     // more Capacity Points, where the world plays with Skill Capacity
 *     artCost: -1,                      // added to each cost, in HP and in Weapon Uses, of the Combat Arts the
 *                                       // unit performs, where the world plays with Combat Arts
 *     dealtPercent: 5,                  // a share added to the damage of the unit's hits
 *     hpMax: 5,                         // added to maximum HP
 *     calc: { accuracy: "bruteForce" }, // another formula for a combat stat; `damageBy`, `accuracyBy` and
 *                                       // `criticalBy: "lowest"` work it out from the lowest of a few stats, and
 *                                       // `dodgeBy: "none"` leaves no Dodge (see `SKILL_CALC`)
 *     foeStats: { spd: -2 },            // added to the stats the foe fights with, in this fight only
 *     rules: ["closeCounter"],          // combat rules the skill bends (see RULES)
 *     effective: ["Beast"],             // Special Qualities the unit's attacks are effective against
 *     effectiveMultiplier: 4,           // what an effective weapon's Might is multiplied by
 *     damageMultiplier: 2,              // what the damage of the unit's hits is multiplied by
 *     ignoreDefence: 33,                // the share of the foe's DEF the unit's attacks ignore; an attack that
 *                                       // is resisted by RES ignores nothing of it
 *     strikes: 2,                       // how many times each of the unit's attacks strikes
 *     extraAttack: { percent: 50 },     // one more attack after all others, at a share of its damage
 *     scale: { of: "hpMissingPercent", per: 25, max: 3 }     // the numbers above are multiplied by this
 *   }
 *
 * An effect that asks for a Special Quality of the unit can be marked `form: true`: the skill then lets its
 * unit take that quality on and put it off at will, with a switch for it on the skill (see `formsOf`).
 *
 * A number may also be read from the unit: { of: "con", div: 3 } is a third of its Constitution, rounded down;
 * { of: ["def", "res"], div: 2 } adds several up first. Beside its stats, `{ of: "hp" }` is the HP it has and
 * `{ of: "hpMax" }` its maximum, `{ of: "combat:dodge" }` one of its combat stats as it fights with them, and
 * `{ of: "attack" }` its ATK: the damage of its attacks before the foe's defence is taken off. In a fight,
 * `{ of: "foe:res" }` is a stat of the foe and `{ of: "foeAttack" }` the foe's ATK. A chance reads its `stat` the
 * same way, so that `proc: { on: "struck", stat: "hp" }` is as many percent as the unit has HP. (`readSource`
 * lists every name there is.)
 *
 * A unit's class tier is a number: 1 for a base class, 2 once promoted, 3 for a third-tier class (a Trainee is
 * 0, and a class that does not promote, or a unit without a class, counts the promotions its level would have
 * brought). `{ of: "tier", times: 5 }` reads it, as 1 at least, so that `scale: { of: "tier" }` multiplies an
 * effect by 2 at Tier 2 and by 3 at Tier 3; `{ of: "tiersBelow" }` is how many tiers the foe is below the
 * unit and `{ of: "tiersAbove" }` how many it is above, 0 at least; `compare: { left: "tier", right: "tier" }`
 * holds the two against each other.
 *
 * A skill that picks something as it is learnt (see `picks.mjs`) keeps what is picked as its `choice`, and an
 * effect marked `choice: "Forest"` applies while that is among what is picked. A skill can also be raised, as
 * Authority is in place of a skill on promoting: `{ of: "raises", times: 10, plus: 10 }` is read from how many
 * times its own skill has been, wherever a number stands. `stars: 1` is a Leadership Star, where the world
 * plays with Authority & Leadership.
 *
 * Skills that ask where units stand read what the unit has around it (see `positions.mjs`). A condition
 * `near` names the units asked about and how many of them there must be:
 *
 *   near: { who: "ally", within: 2 }                 // an ally at most 2 tiles away (`min: 1` is understood)
 *   near: { who: "ally", within: 2, max: 0 }         // no ally within 2 tiles
 *   near: { who: "ally", within: 3, quality: ["Mounted"] }     // also: `from` (at least this far), `class`
 *
 * and a number can count them: { count: { who: "enemy" }, div: 2 } is half the enemies on the map. For a unit
 * that is not on the map none of this can be judged; the skill is then shown as one to check by hand, and
 * nothing of that effect is applied. The same is said of an effect marked `remind: "check"`, for what hangs
 * on something the system cannot see at all.
 *
 * Skills that ask what their unit stands on read the tile under it (see `terrain.mjs`): its kind, a key of
 * `FEO.terrain.types`, and whether that is terrain with effects for the unit. In a forecast that is the tile
 * the unit would attack from. A kind the unit picks as it learns the skill is one effect for each kind on
 * offer, marked with that `choice`:
 *
 *   { choice: "Forest", when: { standsOn: ["forest"] }, combat: { hit: 15, damage: 1 } }
 *   { when: { foeOn: ["forest", "thicket"] }, rules: ["foeNoTerrain"] }     // the tile its foe stands on
 *                                                                           // adds nothing to the foe's
 *                                                                           // DEF, RES or Dodge in this fight
 *   { proc: { on: "turnStart", sure: true }, when: { terrain: false },      // what the tile a turn starts on
 *     grant: { to: "self", effects: [{ stats: { mov: 2 } }], ends: "turnEnd" } }      // gives for that turn
 *
 * And a skill changes how its unit crosses terrain with a `crossing` part, which is always there, never at a
 * moment or as an aura, and is read by the map as it works out where the unit can go:
 *
 *   crossing: { kinds: ["water"] }                    // it crosses kinds that ask for a skill
 *   crossing: { cost: { mountain: 3, cliff: 3 } }     // a space of a kind takes it this much at most
 *   crossing: { free: ["river"] }                     // a space of a kind takes it 1; `free: "all"` for every
 *                                                     // kind it can cross
 *   crossing: { flier: true }                         // it crosses terrain as a Flying unit does, and gains
 *                                                     // nothing from the tile it stands on but healing
 *   crossing: { phase: 2 }                            // it passes through tiles it cannot cross at this much
 *                                                     // movement each, without ending its movement on one
 *
 * Skills that ask how their unit moved this turn read its movement (see `movement.mjs`), which is counted in a
 * battle on the map from where the unit's turn began, to the tile it stands on or would attack from, and
 * still counts once its turn is over, until its next turn starts:
 *
 *   when: { moved: true }               // it has moved this turn; `false` for one that has yet to move
 *   when: { fullMove: true }            // it made a full movement: it moved, and has no MOV left
 *   when: { movLeft: { max: 2 } }       // the MOV it has left; also `min`
 *   when: { weaponKept: true }          // the weapon in hand is the one it held as its turn began
 *   combat: { hit: { of: "movLeft", times: 4 } }          // the MOV it has left, wherever a number stands
 *   combat: { damage: { of: "spacesMoved", times: 0.5 } } // and the spaces it moved
 *   firstMight: { of: "spacesMoved", times: 0.5 }         // added to the weapon's Might for the first attack
 *                                                         // its unit makes in a fight, and no other
 *   rules: ["onlyWait"]                 // its unit takes no action but to Wait: the map offers nothing else
 *
 * For a unit that is not on a battle map, or not in a battle, movement cannot be judged either: the skill is
 * shown as one to check by hand, and nothing of that effect is applied.
 *
 * Skills also change how units stand in each other's way (see `passing.mjs`) with a `passing` part, which like
 * `crossing` is always there and is read by the map as it works out where a unit can go; it may wait for its
 * skill to be switched on, and its numbers may be read from the unit:
 *
 *   passing: { through: "all" }                       // it moves through enemies as though they were allies
 *   passing: { through: 1 }                           // through that many enemies a turn
 *   passing: { through: "all", extra: 2 }             // each enemy moved through takes 2 more movement
 *   passing: { free: 1 }                              // the first enemy moved through takes no movement but
 *                                                     // what the terrain under it adds
 *   passing: { share: true }                          // it may end its move on a tile one other unit stands
 *                                                     // on, any unit may end its move on its tile, and while
 *                                                     // it shares a tile it is in no enemy's way
 *   passing: { diagonal: { of: "level", ... } }       // steps of a move it may take diagonally
 *   passing: { zone: true }                           // an enemy that enters a tile next to it stops there
 *   passing: { hits: { percent: 10 } }                // damage to each enemy it moves through, as a share of
 *                                                     // that enemy's maximum HP, an `amount`, or both
 *   passing: { brushes: { amount: 4, self: 2, nonlethal: true } }     // damage to each enemy next to its
 *                                                     // way, and to itself for each enemy damaged; with
 *                                                     // `nonlethal` neither goes below 1 HP
 *
 * The damage is shown over the units before the move is made, and dealt as it ends. What the move came to is
 * then asked like any other movement:
 *
 *   when: { movedThrough: true }        // it moved through an enemy this turn
 *   when: { movedThroughFoe: true }     // in a fight: the unit it fights is an enemy it moved through
 *
 * For such parts a number can be read from the unit's Weight, `{ of: "weight", div: 8 }`, and from its bonus to
 * an ability check, `{ of: "check:warfare" }` (a key of `FEO.abilityChecks`); `best: true` beside a list of
 * sources takes the highest of them in place of their sum. Anywhere, `{ of: "classLevel" }` is the unit's level
 * counted from its last promotion (level 26 is the 6th of a promoted class), and `less: 1` is taken off a
 * source before it is divided.
 *
 * A skill lets its unit move again after an Action, as Canto does (see `canto.mjs`), with a `canto` part, which
 * like `crossing` is always there. The map gives the unit its range back from where it stands, for the movement
 * it has not spent, once it has taken one of the Actions named:
 *
 *   canto: { after: ["attack"] }                      // "attack", "staff", "item", "trade", "rescue", "refresh",
 *                                                     // "skill", "shift", "object", "visit", "arrive", "seize"
 *   canto: { after: "any", not: ["attack"] }          // after every Action but those left out
 *   canto: { after: ["skill"], except: ["Hold"] }     // skills used as an Action that it does not follow
 *   canto: { gear: true }                             // grants no move: the unit may change the weapon it holds
 *                                                     // while it moves again
 *   canto: { crossing: { free: ["forest"] } }         // grants none either: how the unit crosses terrain on
 *                                                     // that move alone
 *   { proc: { on: "after", stat: "dex", div: 2 }, canto: { mov: "full", recover: 1 } }
 *                                                     // at the end of a fight its unit started: a move of its
 *                                                     // whole MOV, and HP regained for each space of it
 *   curbsCanto: { halve: 3, forbid: 1 }               // enemies within 3 spaces have the movement of such a
 *                                                     // move halved, and those within 1 space make none
 *   combat: { dodge: { of: "cantoSpaces", times: 2 } }      // the spaces moved that way, wherever a number
 *                                                           // stands, until the unit's next turn starts
 *
 * A skill earns its unit another go in its turn, as Galeforce does (see `acting.mjs`), with an `acts` part at
 * a moment: a "hit", a "crit", a "kill" or "after" in a fight its unit started, a "kill" by other means in its
 * own turn, or the moment that is only for this, "action", which comes once the unit has taken an Action:
 *
 *   { proc: { on: "kill", sure: true }, acts: { mov: "full", once: "turn" } }
 *                                                     // the go has its "full" MOV anew, what is "left" of it
 *                                                     // (so it is unless given) or "none"; at most once a
 *                                                     // "turn" or once a "map"
 *   { proc: { on: "kill", sure: true }, acts: { mov: "none", bars: ["attack"], once: "turn" } }
 *                                                     // `bars`: Actions it may not take in that go
 *   { proc: { on: "action", sure: true, after: ["staff"] }, acts: { mov: "full", once: "turn" } }
 *                                                     // `after`: only once it has taken one of these Actions
 *   { proc: { on: "action", stat: "luk", stars: true }, acts: { mov: "full", once: "turn" } }
 *                                                     // `stars`: the chance of its Movement Stars is added
 *   rules: ["noTurn"]                                 // its unit loses its turn
 *   rules: ["noRefresh"]                              // no other unit gives it its Action back
 *   rules: ["noSong"]                                 // it cannot use Refresh, though it has the skill
 *
 * An effect with an `aura` is not for the unit that has the skill but for the units around it:
 *
 *   {
 *     aura: { who: "ally", within: 3,   // who receives it ("any" for every unit, whatever its side); `from: 2`
 *                                       // leaves out those nearer than that,
 *             self: true,               // `self` gives it to the unit itself as well,
 *             when: { role: "defending" } },         // and `when` is a condition each receiver must meet
 *     when: { hp: { op: "full" } },     // a condition the giver must meet, outside of any fight
 *     combat: { hit: 10, dodge: 10 },   // what each receiver gains: any part of an effect, a chance or a
 *     stats: { def: { of: "def", div: 4, giver: true } }     // moment included. A number is read from the
 *   }                                                        // receiver, or with `giver` from the giver
 *
 * (see `auras.mjs`). At a moment of its own turn a skill can instead reach for the units around its unit:
 *
 *   { proc: { on: "turnStart", sure: true }, reach: { who: "ally", within: 1 }, recover: { of: "mag" } }
 *
 * restores that much HP to every ally next to the unit, and with `remind` names them for the table. With
 * nobody in reach it does nothing.
 *
 * And at any moment, of a fight or of a turn, a skill does something to the units around with a `spread` part
 * (see `spread.mjs`, which has the list): around the unit it fights, around its own, or in a line behind its
 * foe; all of them, the nearest, a random one or those its owner picks; damage, healing, conditions, a
 * condition passed on, a lasting change, a push, or an attack of its unit on each:
 *
 *   { proc: { on: "after", sure: true }, when: { role: "initiating" },
 *     spread: { who: "enemy", around: "foe", within: 2, damage: { of: "hpMax", div: 5, theirs: true } } }
 *   { proc: { on: "turnStart", stat: "luk" },
 *     spread: { who: "ally", around: "self", within: 3, heal: { of: "hpMax", div: 5, theirs: true } } }
 *
 * Every unit caught gets its share through the one way damage, healing and conditions come to a unit (see
 * `events.mjs`), so that each shows its own number on the map, and a unit brought down is defeated by the
 * skill's unit. A unit that has left the fight is passed over, and so is an enemy that cannot be targeted:
 * by a spread, by a `reach`, by a change granted to the units around, and by an aura of an enemy.
 *
 * An aura may be given through the units its unit has summoned in place of its unit (`through: "summon"`), be
 * kept from summoned units (`unsummoned: true`), and not add up with the same aura of another unit
 * (`stack: false`); a condition `near` and a number `count` may ask for units that carry a weapon of some kind
 * which they may wield (`carries: ["magic"]`); `{ of: "weaponStat" }` is the stat the weapon in hand adds to its
 * Might; at the `start` of a fight `inflicts` puts conditions on the foe before the first attack; and beside an
 * `attack` of its unit a skill may have it make one more with numbers of its own, which then also says its
 * `critical`, the `stat` it adds, what it is resisted `against`, its `element` and an `effect` worded as a
 * weapon's Effect is, for what it is effective against and may inflict:
 * `attack: { hit: 80, might: 5, critical: 5, range: 2, stat: "dex", against: "res", element: "wind", effect: "Flying, 25% to Squall" }`.
 * A lasting change may deal damage as the next turn of its unit starts (`harm`, see `timed.mjs`), and may be
 * nothing but a `mark: true` that a skill of the same unit asks for later: `when: { foeMarked: "Omen" }` holds
 * against a unit that carries the mark of that name from this unit. `rules: ["turned"]` has its unit make the
 * target of an attack, a staff or a skill neither an enemy of its own nor another unit that carries the rule.
 *
 * At any moment, of a fight or of a turn, a skill can also grant a change that lasts a while, to its unit, to
 * its foe or to the units around: `grant: { to: "foe", effects: [{ stats: { str: -6 } }], ends: "turnEnd",
 * turns: 2 }` (see `timed.mjs`). The unit that carries it then has it as a skill entry of its own until it ends.
 * In a fight, how many times over it starts can be read from the unit: `stacks: { of: "tier", plus: 2 }`.
 *
 * An effect with a `proc` is not always there: it has a chance to activate, rolled during an exchange.
 *
 *   {
 *     proc: { on: "attack", stat: "dex", div: 2 },   // rolled for each of the unit's attacks, at DEX/2 %;
 *                                                    // `on: "struck"` for each hit the unit takes, and
 *                                                    // `on: "start"` once as the fight begins;
 *                                                    // `percent: 25` for a fixed chance; `times: 1.5`
 *     when: { ... },                    // as above; an effect whose condition fails is never rolled
 *
 *     // on an attack, for that attack:
 *     damage: { of: "def", times: 0.4 },             // added to its damage; a list is added up
 *     damagePercent: 30,                // a share of the damage before the foe's defence, added to it
 *     damageOfFoeHp: 20,                // a share of the HP the foe has as the attack is made, added to it
 *     damageMultiplier: 2,              // what its damage is multiplied by
 *     statTimes: { str: 2 },            // the stat counted this many times, when the weapon adds that stat
 *     ignore: { percent: 100, stat: "def" },         // the share of the foe's DEF (or RES) it ignores
 *     hit: 5, critical: 5,              // added to its Hit and Critical
 *     heal: 100,                        // the share of the damage dealt that heals the unit
 *     sureHit: true,                    // it cannot miss; "ifAny" when it needs some chance to hit
 *     inflicts: ["burn", { id: "bleed", upgrade: { id: "heavyBleed", stat: "dex", div: 2 } }],
 *                                       // `{ id: "smoke", dice: 3 }` rolls a die of that many faces for the turns,
 *                                       // `{ id: "silence", turns: 1 }` sets them, and
 *                                       // `{ anyOf: ["poison", "stun"] }` inflicts one of them, picked by a die
 *     grant: { to: "foe", ... },        // what it grants its foe, or the units around its foe, waits for the
 *                                       // attack to land; what it grants its own side comes at once. On an
 *                                       // attack and on a hit, a number of such a change can be read from the
 *                                       // damage dealt: { of: "dealt", cap: 20, times: -1 } is that damage, held
 *                                       // at 20, taken off; a change it would make nothing of is not granted.
 *                                       // `pick: [{ name, effects }, ...]` in place of `effects` grants one of
 *                                       // several changes, picked by a die
 *     remind: "foe",                    // the system says so once the attack has landed
 *     sequence: [{}, { share: 0.5 }],   // the attack becomes this many attacks in a row, each with its own
 *                                       // parts from the list above and its share of the damage. The attacks
 *                                       // it adds roll no chances of their own
 *     oneUse: true,                     // a sequence only costs the weapon one use
 *
 *     // when struck, for that hit:
 *     negate: 30,                       // the share of the damage that is negated
 *     reduce: 10,                       // taken off the damage
 *     reflect: 100,                     // the share of the damage the attacker takes too, counted before
 *                                       // this effect negates or reduces it
 *     retaliate: { of: "mag", times: 0.8 }, resist: "res",   // damage to the attacker, less its RES
 *     inflictsAttacker: ["poison"],
 *     survive: true,                    // a fatal hit is halved, and leaves 1 HP if it is still fatal; not
 *                                       // for a unit that has no more than 1 HP as the hit lands
 *     survive: { hp: { op: "gt", percent: 50 } },    // a fatal hit leaves 1 HP instead, for a unit whose HP
 *                                       // before that hit passes this test; `{ op: "above", value: 1 }`
 *                                       // asks for more HP than a plain number
 *
 *     // at the start, for the whole fight:
 *     combat: { damage: 5, critical: 20 },           // added to the unit's Hit, damage, Critical and Dodge
 *     damage: { of: "def", div: 4 },                 // at the start, `damage` by itself does the same as
 *                                                    // `combat: { damage }`: it is added to every attack
 *                                                    // the unit makes in that fight
 *     foeCombat: { hit: -20, dodge: -20 },           // added to the foe's Hit and Dodge
 *     recover: 10                                    // HP the unit regains before the first attack
 *   }
 *
 * The chance of an effect given by an aura is the receiver's own, unless its `proc` says `giver: true`: it is
 * then worked out for the unit that has the skill, with its Skill Activation rate, and nothing of the receiver
 * changes it.
 *
 * Where the world plays with Alternate Skill Activation, a chance read from a stat is read as that module has
 * it (see `activationOf`): from the whole stat, or from the unit's level in place of its Dexterity. The second
 * roll of an `upgrade` is no activation, and stays as it is written.
 *
 * Some effects need no luck, only their moment: `proc: { on: "crit", sure: true }` rolls nothing. The moments
 * beyond the three above, each open to a chance or to `sure`:
 *
 *   on: "hit"       each of the unit's attacks that lands, and "crit" each that is a critical hit:
 *                   inflicts, heal, recover, foeCombat (for the rest of the fight), next, remind
 *   on: "miss"      each of the unit's attacks that misses: retaliate, remind
 *   on: "dodged"    each attack against the unit that misses: retaliate, next, near, attack, remind
 *   on: "kill"      the unit's attack defeats the foe: recover, heal (a share of the damage the killing blow
 *                   dealt, as on an attack), remind
 *   on: "after"     once after the fight, for a unit that still stands: retaliate, inflicts, recover, remind,
 *                   canto (for the unit that started the fight)
 *
 *   {
 *     next: { hit: 10, damage: 2, critical: 3 },     // added to the unit's next attack in this fight
 *     nextOfDamage: { critical: 50 },                // the same, as a share of the damage of the hit taken
 *     near: { within: 10, next: { damage: 3 } },     // `next` instead, when the attack missed by this or less
 *     retaliate: { of: "foeHpMax", times: 0.1 },     // damage to the foe, less its `resist` when one is named
 *     nonlethal: true,                               // that damage leaves the foe at 1 HP at least
 *     recover: { of: "hpMax", times: 0.25 },         // HP the unit regains
 *     attack: true,                                  // the unit makes one more attack at once, if it can attack
 *     remind: true,                                  // the system only says that the skill takes effect, for
 *                                                    // the table to apply; "foe" when that needs the foe standing
 *     damaged: true,                                 // only for an attack that deals damage, or would have;
 *                                                    // `damaged: 2` for one that deals that much at least
 *     ifHit: true, ifStruck: true                    // after the fight: only if the unit landed a hit, or took one
 *   }
 *
 * A number can be rounded up instead of down with `round: "up"`.
 *
 * Outside of a fight a skill can wait for a moment of its unit's turn, again with a chance or with `sure`:
 *
 *   on: "turnStart"   the unit's turn starts        on: "turnEnd"   it ends        on: "wait"   the unit Waits
 *
 *   {
 *     proc: { on: "turnStart", sure: true },
 *     recover: { of: "hpMax", times: 0.1 },          // HP the unit regains
 *     gold: 5,                                       // gold the unit gains (see `earnings.mjs`)
 *     cure: ["poison"],                              // conditions the unit is cured of; "all" for every one
 *     inflicts: ["poison"],                          // conditions the unit is given; from an aura, by its giver
 *     remind: true                                  // the system only says so; "check" when the effect hangs on
 *   }                                                // something it cannot see, and then `recover` is shown, not applied
 *
 * A unit that has Waited is `waiting` until its next turn starts, which a condition can ask for:
 * `when: { waiting: true }`. `foeActivation: -10` is added to the Skill Activation rate of a foe in a fight.
 *
 * A skill its unit chooses when to activate (see `skill-usage.mjs`) only applies its effects marked
 * `when: { declared: true }` while it is switched on. One that may be used before its cooldown is over, at a
 * penalty, marks what it does then `when: { early: true }` and what it does otherwise `when: { early: false }`.
 * For such a skill two more parts help:
 *
 *   proc: { on: "attack", sure: true, once: true }   // `once`: only the first time its moment comes in a fight
 *   end: true                                        // on an attack: the fight ends there if the attack hits
 *
 * Some skills change how far a weapon reaches, how it wears, or who may wield it:
 *
 *   when: { weaponReach: { min: 2 } }   // the weapon in hand itself attacks at 2 tiles or more
 *   when: { beyondReach: true }         // the fight is fought from further than the weapon itself reaches
 *   weaponRange: { add: 1 }             // the farthest the weapon attacks at, raised by this much; `max: 3`
 *                                       // raises it to at least that, `min: 1` lowers the nearest to that;
 *                                       // with `clear: true` it only attacks from further than the weapon
 *                                       // itself reaches where its unit could step into the space between
 *                                       // the two, which the map sees to; with `open: true` only where
 *                                       // nothing stands between the two: no unit, no tile that nothing
 *                                       // crosses and no wall, which the map sees to and tells the fight;
 *                                       // with `from: 3` what it adds is only from that distance on, so
 *                                       // that the tiles between the weapon's own reach and it are left out
 *   damageStat: "mag"                   // the stat added to the weapon's Might, which also sets whether DEF or
 *                                       // RES resists it
 *   foeWear: { hit: 1, noDamage: 2 }    // uses a foe's weapon loses on top for each hit on the unit: one that
 *                                       // dealt damage, one that dealt none
 *   wield: 1                            // weapon ranks above its own the unit may wield, where it has a rank
 *   proc: { on: "start", stat: "luk" }, freeUses: true     // the unit's weapon loses no use in this fight
 *
 * Some skills change no number of a fight but what their unit earns (see `earnings.mjs`): `expMultiplier: 1.5`
 * multiplies the experience it earns (with `bexp: false` beside it, not what it is given as Bonus EXP),
 * `staffExp: "unpromoted"` names the column of the staff table it earns by,
 * `growths: { hp: 10 }` is added to the growth rates a level up rolls, `gold: 50` at `on: "kill"` is gold for
 * defeating the foe, and `on: "levelUp"` is the moment its unit levels up.
 *
 * Some skills give a weapon rank for good (see `skill-ranks.mjs`). The rank is saved on the unit as the skill
 * is taken, and taken back as it goes:
 *
 *   rank: { fire: 1 }                   // ranks added, by proficiency
 *   rank: { start: 1 }                  // in the proficiency the unit started with
 *
 * Some skills bend the rules of conditions (see `conditions.mjs`). These parts are always there, never at a
 * moment or as an aura:
 *
 *   inflictChance: { burn: 10 }         // added to every chance below 100% the unit has of inflicting it: that
 *                                       // of its weapon, and that of each skill it rolls for which inflicts it
 *   inflictTurns: { squall: 1 }         // turns it lasts longer when the unit inflicts it
 *   nullify: 50                         // the chance in percent that a condition which would be applied to the
 *   nullify: { percent: 100, only: "damaging" }    // unit in a fight is not; `only` for those that deal damage
 *                                       // at the start of a turn, or for a list of conditions
 *   suffers: { burn: { damage: 0.5, penalties: -1 } }      // what a condition does to the unit that has it: its
 *                                       // damage at the start of a turn and its penalties are multiplied by
 *                                       // these, so 0.5 halves, 0 takes away and -1 turns around (the damage
 *                                       // heals, the penalties are bonuses); `tick: 5` adds to the percent of
 *                                       // maximum HP it deals, `stays: true` keeps it from running out, and
 *                                       // `burst: true` has it deal its turns as damage when it bursts
 *   recovery: 2                         // turns each of the unit's conditions loses as its turn starts
 *   debuffs: { stats: 4, combat: 5 }    // taken off every penalty to a stat or a combat stat that a condition,
 *                                       // a lasting change from another unit or an aura puts on the unit;
 *                                       // `negate: true` for all of it, `turn: true` for penalties to stats
 *                                       // that count as bonuses of their size instead; `lent: true` where a
 *                                       // change an ally left on the unit says so
 *   burstHarm: ["tremor"]               // a condition the unit bursts deals its turns as damage to its unit
 *
 * and two moments of a fight, always `sure`, come when a condition is inflicted by an attack or a skill:
 *
 *   on: "inflict"     the unit gave its foe a condition       on: "afflicted"   its foe gave it one
 *                     (`recover`: HP it regains for that)
 *
 *   {
 *     proc: { on: "inflict", sure: true, condition: ["stun"] },    // `condition`: only for these
 *     grant: { to: "foe", effects: [...], ends: "turnEnd", turns: "condition" },   // lasts as long as the
 *     remind: true,                     // condition inflicted; or the system only says so
 *     returns: 1                        // when afflicted: the foe gains the same condition for this many turns
 *   }
 *
 * Some skills speak to staves (see `staves.mjs`). A staff that heals one unit restores its HP when it is used;
 * these parts are always there:
 *
 *   staffHeal: { more: 50, plus: 5,     // the unit heals allies for this share more (with staves and items),
 *                self: 100, both: 25 }  // heals this much more with staves, regains this share of the HP its
 *                                       // staff restored to its target, and regains this share more from a
 *                                       // staff that heals user and target
 *   staffHealed: { healer: 100, both: 25 }    // the same two shares, for the ally that heals this unit
 *   staffRange: { times: 2 }            // the farthest its staves reach, multiplied; `max: 10` raises it to that
 *   rules: ["selfStaff", "staffFreeUses"]     // a staff for an ally is used on its own unit when used on
 *                                             // nobody, and a staff for several allies is for it too; its
 *                                             // staves lose no use
 *   rules: ["staffCombat"]              // its unit may start a fight with a staff in its hand
 *   staffImmune: ["Expel"]              // the staves of these names do nothing to its unit, which is left out
 *                                       // where they pick their targets
 *   healing: { more: 100 }              // the unit heals other units for this share more by whatever means: a
 *                                       // staff, an item, a skill. As an aura, the units that receive it do
 *   buffs: { times: 2 }                 // the bonuses to stats and combat stats in the lasting changes its
 *                                       // unit gives, to itself or to others, are multiplied. As an aura,
 *                                       // those the units that receive it give
 *   bonuses: { times: -1 }              // in a lasting change: the bonuses to its unit's own stats are turned
 *                                       // around in a fight (-1), or cancelled (0), as `foeBonus` does
 *
 * and the moment a staff is used, `sure` or with a chance that is rolled once before the staff heals, can
 * grant what lasts, be announced or heal more:
 *
 *   {
 *     proc: { on: "staff", sure: true, ally: true },   // `ally`: only when used on an ally; `heals`: only
 *                                                      // when it restored HP to one
 *     healPlus: { of: "def", times: 0.6 },             // HP a staff that heals restores on top
 *     grant: { to: "target", effects: [{ stats: { str: 2 } }], ends: "turnStart", clock: "giver" },
 *     remind: true
 *   }
 *
 * There a number can be read from `healed`, the HP the staff restored to the ally it was used on. A staff for
 * several units is used on every ally it reaches: a change for its "target" is for each of them (with `heals`,
 * each it restored HP to), one for the unit itself is given once, and `healed` is the most HP any one of them
 * regained. And the moment a unit has healed an ally, with a staff, an item or a skill, can harm:
 *
 *   { proc: { on: "heal", sure: true }, harmNear: { within: 2, percent: 50 } }
 *                                       // that share of the HP the ally regained, as damage to the enemy
 *                                       // nearest to it, within so many tiles; whoever acts for the unit
 *                                       // picks between enemies that stand equally near
 *
 * A skill that takes effect by itself a limited number of times (`usage.kind: "auto"`, see `skill-usage.mjs`)
 * counts a use each time one of its moments of a fight takes effect, and does nothing once its uses are spent.
 *
 * And the moment an item restores HP to its unit, `on: "itemHeal"`, is one more that is no moment of a fight
 * or of a turn (see `items.mjs`): `sure`, or an answer whoever Uses the item `may` give before it heals. It
 * grants a change read from `healed`, the HP the item restored, and may multiply those HP: `healTimes: 0.5`.
 * A `consumes` part, which stands alone in its effect and is always there, has its unit use up an item of a
 * name for a change that lasts, as Wealth Of Power does with Gems (see `items.mjs`).
 *
 * What a Special Quality builds into its unit is written the same way (Rampart, Rouse, Greed). Three parts
 * serve it:
 *
 *   proc: { on: "struck", percent: 90, fixed: true }       // `fixed`: a plain chance, which the Skill
 *                                                          // Activation rate does not change; what the unit's
 *                                                          // skills add to its chances of inflicting a
 *                                                          // condition still counts
 *   shield: { def: 12, res: 9 }         // when struck: the hit is dealt as if the unit had this much DEF (or
 *                                       // RES) where that is more than its own; given by an aura, the
 *                                       // numbers are the giver's (`{ of: "def", giver: true }`)
 *   gold: { of: "levelsApart", times: 50 }     // `levelsApart`: the levels between the unit and its foe, 1
 *                                              // at least
 *
 * Some skills change how their unit changes form (see `shifting.mjs`). A `shift` part is always there, or waits
 * only for its skill to be switched on (`when: { declared: true }`):
 *
 *   shift: {
 *     percent: 25,        // the share added to its stats while transformed, in place of the usual one
 *     add: 10,            // points added to that share
 *     times: 2,           // what the share is multiplied by
 *     start: 5,           // added to its starting Shift Gauge; `turnHuman`, `turnAnimal`, `combatHuman` and
 *                         // `combatAnimal` add to what the gauge changes by
 *     transforms: 1,      // more times a turn that its stone transforms it; `endless: true` for any number
 *     atWill: true,       // it Shifts whatever its Shift Gauge holds
 *     keep: true,         // its Shift Gauge starts a map where the last one left it
 *     brief: true,        // beside `atWill`, in a change that lasts: a Shift its unit could only make at will
 *                         // ends as that change does, unless its gauge then holds enough to Shift by itself
 *     humanFight: 50      // it may start a fight in humanoid form, for this share of the usual change to its gauge
 *   }
 *
 * `when: { shifted: true }` asks whether the unit is transformed: Shifted, or with a stone that still transforms
 * it for a fight. On a critical hit, `gaugeOfDamage: 100` gives the Shift Gauge that share of the damage the hit
 * would have dealt had it not been critical.
 *
 * What happens to a unit outside of a fight the system rolls goes by the same parts (see `events.mjs`): damage
 * of any kind is lessened by `takenPercent`, a unit with `rules: ["noSkillDamage"]` takes none from skills, a
 * fatal blow of any kind may be survived, a condition put on it by any means may be nullified, handed back
 * (`returns`) or made to last longer by the unit that inflicts it, and defeating a foe by any means is a
 * `kill`. A lasting change granted for as long as a condition lasts ends with it if it is cured early.
 * `rules: ["noExp"]` has its unit give no experience to the unit that defeats it.
 *
 * A skill used as an action can put its unit somewhere else on the map (see `warp.mjs`). Its `warp` part stands
 * alone in an effect and is always there:
 *
 *   warp: { within: "mov", unmoved: true }     // onto a free tile at most its MOV away, whatever lies between,
 *                                              // and only before it has moved; `clear: 3` for a tile with no
 *                                              // enemy within 3 tiles, anywhere on the map without `within`
 *   rules: ["actAfterWarp"]                    // warping does not end the unit's turn
 *
 * Units are also moved against their will (see `forced.mjs`): shoved, pulled, swapped, set down next to
 * someone. Shove is a command every unit has, and a skill changes it with a `shove` part, which like
 * `crossing` is always there and may wait for its skill to be switched on; a skill moves units as a fight
 * ends with a `step` part at a moment of that fight; and three rules say who is not moved:
 *
 *   shove: { spaces: 2 }                       // its Shove pushes this many spaces
 *   shove: { moving: 1, holds: 1 }             // shoving an enemy takes 1 movement in place of its Action,
 *                                              // and that enemy cannot move until the end of its next turn
 *   { proc: { on: "after", sure: true }, step: { move: "forward" } }       // "forward", "back", "swap",
 *                                              // "shove", "scatter" or "place"; with `may: true` only if its
 *                                              // owner picks the tile on the map
 *   proc: { on: "after", sure: true, hits: 2 } // `hits`: only once its unit has landed this many attacks
 *   rules: ["rooted"]                          // nothing moves its unit but the unit itself
 *   rules: ["unforced"]                        // no enemy moves its unit, holds it in place, lowers its MOV
 *                                              // or stops it on its way
 *   rules: ["held"]                            // its unit cannot move
 *
 * A skill used as an action on a unit picked on the map says whom it is for and what it does with an `act`
 * part, which stands alone in its effect (see `actions.mjs`, which has the list: a move, a hold, healing,
 * damage, a lasting change with a stat that is picked, for one unit or all in reach, an attack with numbers of
 * its own through the forecast, a mark on one unit of the map):
 *
 *   act: { target: { who: "ally", within: 5, clear: true }, move: "swap" }
 *   act: { target: { who: "enemy" }, check: { by: "athletics", against: ["reflex", "athletics"] }, grip: true }
 *   act: { target: { who: "ally", within: 1, self: true }, heal: 5 }
 *   act: { target: { who: "enemy", from: 2, within: 3 }, strike: { might: 0, hit: 50, critical: 5 } }
 *   { when: { skill: "Influence" }, act: { ... } }      // another way to use it, for a unit that has that skill
 *
 * One that takes in an area says so with an `area` in place of the `target` (see `areas.mjs` for its shapes: a
 * radius or a square around the unit or around a tile that is picked, a line through a unit next to it, the
 * tiles in its Line of Sight, the whole map), and every unit the area catches gets what the skill says of one:
 *
 *   act: { area: { shape: "radius", radius: 2, who: "enemy" }, inflicts: ["stun"] }
 *   act: { area: { shape: "radius", radius: 2, centre: "tile", range: { from: 1, within: 3 } }, grant: { ... } }
 *   act: { area: { shape: "square", radius: 1, who: "any" }, strike: { hand: true } }
 *   act: { area: { shape: "line", reach: "units" }, strike: { hand: true, plain: true }, through: true }
 *   act: { area: { shape: "sight" }, grant: { ... } }
 *   act: { area: { shape: "map", who: "ally" }, grant: { ... }, user: { grant: { ... }, each: true } }
 *
 * Line of Sight is a unit's LoS counted in spaces, with nothing between the two that blocks sight (see
 * `sight.mjs`): `when: { inSight: true }` asks it of the foe, `foeNear: { who: "ally", sees: true }` of an ally
 * that has the foe in its own. A condition may reach the allies of the unit that suffers it (see `around` in
 * the conditions table and `conditionsAround` in `conditions.mjs`).
 *
 * Beside it: `when: { near: { who: "ally", within: 2, marked: "Loyalty" } }` asks for a unit that carries the
 * mark of that name; `assures: ["Astra"]`, in a lasting change, has those skills of its unit activate whenever
 * their moment of a fight comes; `rules: ["provoked"]` in a change that remembers whom it comes from has its
 * unit target no other enemy, and `rules: ["answers"]` has it counter-attack whatever would keep it from one.
 *
 * Rescue is a command every unit has as well (see `rescue.mjs`): it picks up an ally next to it whose Weight
 * is no more than its own, carries it with its DEX and SPD halved, and sets it down again or hands it on. A
 * skill changes that with a `carry` part, which like `shove` is always there:
 *
 *   carry: { weight: 6 }                       // its unit counts as this much heavier when it picks a unit
 *                                              // up, to Rescue it or to capture it
 *   carry: { free: true }                      // carrying a unit, and an attempt to capture one, cost it nothing
 *   carry: { light: true }                     // a unit that carries this one is not slowed by it
 *   carry: { heals: 15 }                       // the ally it carries regains this share of its HP as each of
 *                                              // that ally's turns starts
 *   carry: { drops: { effects: [{ rules: ["halveFatal"] }], ends: "turnStart" } }      // a change that
 *                                              // lasts on the ally it sets down, until that ally's next turn
 *                                              // starts: here, a blow that would be fatal to it is halved
 *   carry: { saves: true }                     // it may come for an ally within its movement that an attack
 *                                              // would defeat: the ally is left with 1 HP and carried off
 *
 * A unit stands guard with a stance: a lasting change that says so, which a skill used as an action grants its
 * unit and which lasts until something it names ends it (see `stances.mjs`, which has the list). While it
 * lasts, and for a skill at all times, three parts that are always there say what its unit does for its side
 * outside of its own turn (see `stances.mjs` and `reactions.mjs`):
 *
 *   { proc: { on: "use", sure: true },
 *     grant: { to: "self", ends: "turnStart", stance: { state: "Hold", until: ["move"], mark: "hold" },
 *              effects: [{ reacts: { to: "move", within: "weapon", fight: true, halts: "hurt", once: "turn" } }] } }
 *                                              // a stance, and what its unit does while it is in it
 *   guards: { who: "ally", within: 1 }         // an enemy that starts a fight with an ally next to its unit
 *                                              // fights its unit instead; `may`, `swap`, `effects`, `through`
 *   wards: { who: "ally", within: 1, takes: true }         // it takes a hit that would land on an ally next to
 *                                              // it, worked out with its own DEF or RES; or `negate`, `returns`
 *   reacts: { to: "move", within: "weapon", fight: true, halts: true }     // it attacks an enemy that moves
 *                                              // within its reach, and the move ends there; also "enters",
 *                                              // "pass" and "allyHurt"
 *   rules: ["hidden"]                          // its enemies neither see nor target it, and it is not in their
 *                                              // way on the map
 *   shelters: { who: "ally", within: 2, from: 2 }          // an enemy within 2 tiles of its unit cannot attack
 *                                              // an ally within 2 tiles of it
 *
 * A skill used as an action lays a trap on a tile next to its unit with `act: { area, trap }`.
 *
 * Refresh is the command of the skill of that name (see `refresh.mjs`): an ally next to its unit that has
 * acted may move and act again. A skill gives the command, and reshapes it, with a `refresh` part, which like
 * `carry` is always there; and a skill hands a Refresh out as something else is done with a `refreshes` part
 * at a moment:
 *
 *   refresh: { use: true }                     // its unit has the command
 *   refresh: { range: { max: 2 } }             // how far it reaches; `without: ["Inspiring Song"]` leaves out
 *                                              // what those skills lay over it for an ally only it reaches
 *   refresh: { targets: 2 }                    // how many allies it is used on at once, or "all" in reach
 *   refresh: { gives: { effects: [{ stats: { str: 3 } }], ends: "turnStart" } }      // a change that lasts on
 *                                              // each ally it is used on; `hp: 10` for temporary HP, `at:
 *                                              // { max: 1 }` only for an ally that near
 *   refresh: { curses: { within: 4, effects: [{ stats: { str: -3 } }], ends: "turnEnd" } }     // a change on
 *                                              // the enemy nearest to its unit, within so many spaces
 *   refresh: { option: { id: "heal", label: "Heal", instead: true, heal: { of: "mag" } } }     // another way
 *                                              // to use it, picked each time: `instead` of the Action given
 *                                              // back it may `heal`, `cure`, fill a Shift `gauge` or lay a
 *                                              // change (`gives`); `alone` leaves out what other skills lay
 *                                              // over it, and `cooldown: 3` is counted on its skill
 *   refresh: { self: true }                    // its unit is Refreshed too, for an Action or a move, when
 *                                              // its own skill Refreshes the allies around it
 *   { proc: { on: "kill", sure: true }, refreshes: { to: "near", once: "turn" } }
 *                                              // to: "self", the "target" of a staff, the allies "near" the
 *                                              // unit or the foe it defeated, or one to "pick" `within` so
 *                                              // many spaces (or the reach of the "staff"); `times: 2` with
 *                                              // `once: "turn"` for twice a turn
 *
 * A lasting change may hold temporary HP for its unit (`hp: 10` in a `grant`, see `timed.mjs`): they are lost
 * before its own, and gone with the change. In a fight a grant marked `kill: true` is only given where its
 * unit defeated its foe.
 *
 * A hit that lands may be blocked (see `blocking.mjs`): by the Shield its target has equipped, by a weapon that
 * acts as one, or by the weapon a skill has its unit guard with. What a skill makes of that it says with a
 * `block` part, which is always there (the list is at the top of `blocking.mjs`), and a few parts beside it:
 *
 *   block: { chance: 10 }                             // added to the unit's own Block chance
 *   block: { foeChance: { of: "weaponMight", times: -1 }, kind: "shield" }     // and to its foe's
 *   when: { shield: true }                            // the unit has a Shield equipped; "magic" for one that
 *                                                     // can block magical attacks, `false` for none
 *   { when: { shield: true }, stats: { def: 2 }, lostOnBlock: true }           // a hit that is blocked is
 *                                                     // dealt as if the unit went without that DEF or RES
 *   weaponUse: { first: "crit" }                      // the attack that costs its weapon its first use is a
 *   weaponUse: { last: "crit" }                       // critical hit, or the one that costs it its last
 *   rules: ["noCounter"]                              // its unit makes no counter-attack
 *
 * Two moments of a fight come with a block, each open to a chance or to `sure`:
 *
 *   on: "block"       the unit blocked a hit              on: "blocked"     an attack of the unit was blocked
 *
 *   {
 *     proc: { on: "blocked", stat: "luk", by: "shield" },   // `by`: only a block with a "shield", or with
 *                                                           // the "weapon" in hand
 *     unblock: true,                    // when blocked: the block is negated, and the hit dealt whole
 *     blockLess: 2,                     // when blocked: taken off what the block takes off the hit
 *     blockTimes: 2,                    // on a block: what the block takes off the hit is multiplied by this
 *     attack: true,                     // on a block: the unit makes one more attack at once, if it can attack
 *     next, retaliate, grant, remind    // at either, as at the other moments of a fight
 *   }
 *
 * and a skill wears down what its foe fights with, at either of them, on an "attack", a "hit", a "crit" or
 * "after" the fight:
 *
 *   wears: { shield: { dice: 6 } }      // uses the foe's Shield loses: a number, one read from the unit, or a
 *   wears: { weapon: 2, shield: 2 }     // die of that many faces; `weapon` for the weapon it holds
 *   wears: { shield: 20, after: true }  // `after`: once the fight is over
 *
 * On an "attack", `noBlock: "shield"` has that attack go past the foe's Shield (`true`: past a guarding weapon
 * as well); and a chance `on: "struck"` may say `blocked: 10`, which is added to it for a hit that was blocked
 * with a Shield.
 *
 * A block can be answered further, and so can what a hit comes to in the end:
 *
 *   on: "blockFail"   the unit rolled to block a hit, and did not (a block its foe's skill negated is neither a
 *                     block nor a failure): next, retaliate, wears, grant, remind
 *   on: "curbed"      a hit of the unit landed and was curbed: blocked, lessened by a skill of its target, or
 *                     left with half its damage or less by the target's defence: next, retaliate, wears, grant,
 *                     remind. Its damage is dealt once the hit's own is, and can defeat the target
 *   on: "unhurt"      a hit landed on the unit and dealt no damage: next, retaliate, grant, remind
 *
 *   {
 *     proc: { on: "block", sure: true },
 *     attack: { hit: 70, might: { of: "shieldBlock" } },     // on a block or on "dodged": the attack made at
 *                                       // once has numbers of its own. It is made with what gives those, not
 *                                       // with the weapon in hand: a physical attack with that Hit and Might
 *                                       // in place of the weapon's, which reaches 1 tile (`range`), costs the
 *                                       // weapon no use, earns no weapon experience and has none of the
 *                                       // weapon's Effect, and which a unit can make whose weapon cannot
 *                                       // answer. `shieldBlock` is what its Shield takes off a physical attack
 *     cancels: 1,                       // on a block: the attacker's next attack in this fight is not made
 *   }
 *   { proc: { on: "struck", stat: "dex", div: 2 }, reduce: 20,
 *     excess: { combat: ["hit", "dodge", "critical"] } }     // what `reduce` takes off beyond the damage there
 *                                       // was is added to these for the rest of the fight; `retaliate: true`
 *                                       // deals it to the attacker as damage
 *   proc: { on: "curbed", sure: true, by: ["block", "skill"] }     // `by`: only for a hit curbed by one of
 *                                       // these: a "block", a "skill" of the target, its "defence"
 *   proc: { on: "curbed", sure: true, stopped: true }        // `stopped`: only for a hit that dealt no damage
 *                                       // and that a block or a skill took something off; `false` for every
 *                                       // other hit that was curbed
 *
 * A change a moment grants may be a tally (see `timed.mjs`): with `max` it grows by one each time it is granted,
 * `grant: { to: "self", drop: 1 }` takes one from it again, and `once: "defend"` has the next fight its unit is
 * attacked in use it up. `rules: ["noShield"]` in such a change keeps its unit from having a Shield equipped.
 *
 * What a unit chooses before a fight is written with the parts `choices.mjs` explains, most of them on an
 * effect that waits for its skill to be switched on:
 *
 *   trade: { id: "dodge", give: { dodge: 3 }, gain: { critical: 1, hit: 2 }, pick: true }      // one combat
 *                                       // number for another, in steps its unit picks or all at once
 *   spend: { id: "hp", hp: 3, gain: { might: 1 } }    // HP, or transformations left this turn, for damage
 *   single: { hit: 15, critical: 10, damagePercent: 25 }      // one attack in place of several
 *   noWeight: true                      // no Weight as Attack Speed is worked out
 *   against: "res"                      // what resists its attacks: "def", "res" or the "lower" of the two
 *   hitCap: 45                          // the share of its maximum HP a hit takes off it at most
 *   foeBonus: { stats: ["spd", "res"], times: -1 }    // the foe's bonuses to stats cancelled (0) or turned
 *                                       // around (-1); `stats: "pick"` for one stat its unit picks
 *   cooldowns: -1                       // turns added to the cooldown of every skill its unit uses
 *   rearm: true                         // it may change its weapon before a fight an enemy starts
 *   rules: ["parity"]                   // terrain, supports, weapons, equipment and skills do nothing in
 *                                       // this fight, for either unit, but for what was declared before it
 *   { proc: { on: "hit", sure: true, once: true, spends: true }, asCrit: true }
 *                                       // the hit counts as a critical hit for what waits for one, and the
 *                                       // skill is spent only by a fight in which that came about; on an
 *                                       // "attack", `effective: true` and `against` change that attack
 *   { of: "offStat", div: 2 }           // a number read from Magic where the weapon adds Strength, and from
 *                                       // Strength where it adds Magic
 *
 * A unit whose skill cancels its foe's skills, as Nihil does, also stops what the foe's skills that are chosen
 * when to activate do in the fight: their effects that wait to be switched on, and their moments. Such a skill
 * is listed as `stopped`, and a fight does not spend it.
 *
 * A moment of a fight may be an answer: with `may: true` in place of a chance or of `sure`, whoever acts for
 * the unit is asked, in the middle of the fight, whether its skill takes effect (see `answers.mjs`, which has
 * the list). Three moments are there for that, and a fourth for what a skill brings to nothing by itself:
 *
 *   on: "attacked"    an attack is about to be made against the unit: combat: { dodge }, cancel, end, forgoExp
 *   on: "landing"     an attack against it would land: dodge
 *   on: "critMiss"    a hit of the unit failed its critical roll: reroll, retaliate, costs
 *   on: "foil"        its foe does something it may bring to nothing: foils
 *
 *   { proc: { on: "landing", may: true }, dodge: true }
 *   { proc: { on: "miss", may: true, within: 10 }, reroll: true }       // `within`: the margin it failed by
 *   { proc: { on: "foil", stat: "luk" }, foils: ["crit", "choose", "activation", "block", "art"] }
 *   { proc: { on: "foil", stat: "luk", div: 2 }, foils: ["injury"] }    // or a "wound": what the defeat rules
 *                                                                       // would give its own unit, in a fight
 *                                                                       // or out of one
 *   { proc: { on: "attack", stat: "dex" }, cancels: 1 }                 // the foe's next attack is not made
 *   rules: ["worstHit"]                 // its unit rolls each Hit roll twice and takes the worse
 *
 * And skills reshape the round of a fight: who attacks first, how often, with what each attack after the first
 * gains, and whether the round is fought again (see `rounds.mjs`, which has the list):
 *
 *   extraAttack: { percent: 100, attacks: 2 }         // one more attack after all others, for a unit that would
 *                                                     // make 2 without it; `follows: true` for one that follows
 *                                                     // up by its Attack Speed
 *   speedLead: { per: 3, damage: 1, hit: 3, critical: 3 }      // for every 3 Attack Speed over what a follow-up
 *                                                     // takes, against a foe it follows up on
 *   rules: ["strikesAlways"]                          // "2x Strikes when initiating combat" whoever began it
 *   { proc: { on: "start", stat: "luk" }, order: "first" }     // it attacks first; "press": its follow-up comes
 *                                                     // before its foe's counter-attack
 *   { proc: { on: "start", stat: "dex" }, cuts: { later: 50, lone: 25 } }  // less damage from later attacks
 *   { proc: { on: "start", stat: "dex" }, attack: true }       // one attack in a round where it would make none
 *   { proc: { on: "attack", sure: true, from: 2, mounts: true }, might: 1, critical: 3 }
 *                                                     // from its 2nd attack on, once more for each attack since
 *   { proc: { on: "struck", sure: true, every: 2 }, negate: 50 }           // every 2nd attack against it, counted
 *                                                     // from the start of its own turn
 *   { proc: { on: "struck", perDamage: 3 }, attack: true, next: { hit: 15 } }      // a chance from the damage
 *                                                     // taken to attack at once
 *   { proc: { on: "round", stat: "dex", div: 1.5 }, again: { most: 20, stop: true } }      // the round again
 *   when: { inSight: true }                           // its foe stands within its Line of Sight: no further
 *                                                     // away than its LoS counts spaces, with nothing that
 *                                                     // blocks sight in between (see `sight.mjs`)
 *   when: { foeNear: { who: "ally", sees: true } }    // an ally of the unit has its foe in its Line of Sight
 *   when: { formation: { with: "Triangle Attack", others: 2, from: 1, within: 2 } }
 *                                                     // its unit and two allies that have that skill equipped
 *                                                     // stand in a triangle around its foe, each of the three
 *                                                     // 1 or 2 spaces from it (see `formationAround` in
 *                                                     // `positions.mjs`, which says what a triangle is)
 *                                                     // (`seen`: the foe has that ally in its own)
 *   { of: "weaponHit" }                               // the Hit of the weapon in hand, wherever a number stands
 *
 * And skills bend the Weapon Triangle, and have one weapon hand something to the next (see `triangle.mjs`,
 * which has the list). A `triangle` part is always there, as `block` is, unless it stands on an attack; a
 * `handover` part is always there and never an aura:
 *
 *   triangle: { times: 2 }                            // what the triangle gives and takes, multiplied for both
 *   triangle: { beats: ["fire"] }                     // its unit has the advantage against these weapons; with
 *                                                     // "outside", against those outside its weapon's triangle
 *   triangle: { safe: true }                          // its unit is never at a disadvantage
 *   triangle: { negates: "hit", at: "disadvantage" }  // what it does to Hit negated for both, while its unit
 *                                                     // is at a disadvantage
 *   { proc: { on: "attack", stat: "dex" }, triangle: { boon: 4, bane: 0 } }        // for that attack alone
 *   { when: { weapon: ["light"] }, handover: { from: ["dark"], might: 50, hit: 25, critical: 50 } }
 *                                                     // the first attack with a weapon since it was taken in
 *                                                     // hand gains shares of the last weapon of those kinds
 *
 * An Optional Module the system does not have yet can already be asked for, where the rulebook names it
 * (`FEO.optionalAwaited`): `when: { module: "dismounting" }` holds for nobody until it is built. And
 * `when: { dismounted: false }` asks that its unit has not dismounted, which holds for every unit until that
 * module tells a unit's `dismounted`.
 *
 * And skills lend their unit weapons it does not carry (see `lending.mjs`, which has the list): a `lend` part
 * stands alone in its effect and is always there. `{ proc: { on: "lend", stat: "dex" }, betters: "Breath Weapon" }`
 * is a chance rolled as its unit starts a fight with a weapon that skill lends, which then is the better one
 * that skill names. A skill that may be used beyond the uses it has (`usage.over`, see `skill-usage.mjs`) marks
 * what it does then `when: { over: true }`. An attack a skill has its unit make at a moment may be made with a
 * weapon of the Weapons tab in place of numbers written out: `attack: { weapon: "Elwind" }`, or
 * `attack: { lent: true, hit: -10, share: 50 }` for the weapon that was picked for its skill, also when its
 * unit is "struck": that one is made at once, from as far as the weapon reaches and no nearer than it does.
 *
 * And skills take things: Steal is a command a skill gives its unit, and what a unit's skills let it do with
 * gear and with the doors, chests and Villages of a map are parts that are always there, as `shove` and
 * `carry` are (see `stealing.mjs` and `objects.mjs`, which have the lists; `skillKnacks` adds them up):
 *
 *   steal: { use: true }                // its unit has the Steal command
 *   opens: ["door", "chest"]            // it opens these without a key
 *   disarms: true                       // it disarms the traps and mines it walks over
 *   pillages: true                      // it can destroy Villages
 *   discount: 25                        // what it buys in a shop costs it this many percent less
 *   laid: { mines: 5, turns: 1, exp: 10, kill: 25 }      // the Mines its unit lays deal that much more damage,
 *                                       // the conditions its mines and traps give last that many turns
 *                                       // longer, and it gains that much EXP as an enemy springs one and as
 *                                       // a Mine of its defeats one (see `traps.mjs`)
 *   crafts: { items: 2, cost: 1000, folders: ["Buffing Items", "Combat Items"], uses: { of: "dex", div: 10 } }
 *                                       // the items it makes as a map starts
 *   rules: ["unstolen"]                 // nothing is stolen from its unit
 *   rules: ["uncaptured"]               // its unit cannot be captured
 *   { proc: { on: "hit", stat: "dex" }, when: { foeUnmarked: "Mug" }, loot: { gold: "foe", once: "foe" } }
 *                                       // what it takes from the foe at a hit or a kill: gold, an item by
 *                                       // name, one of the foe's own, what a die picks, or an item of the
 *                                       // foe's pack that could be stolen; `foeUnmarked` holds against a
 *                                       // unit that does not carry that mark from this unit
 *   { proc: { on: "attack", stat: "dex" }, unequips: true }      // once the attack lands the foe puts down
 *                                       // its weapon and its Shield, and attacks no more in that fight
 *   { proc: { on: "attack", stat: "dex", div: 2 }, amplify: 50 } // what the weapon's Effect inflicts comes
 *                                       // at half as much chance again (rounded down), for half as many
 *                                       // turns again (rounded up)
 *
 * A skill has its unit imitate another with the `imitates` part of its `act`, and another skill of the unit
 * changes that with an `imitation` part, which is always there (see `imitation.mjs` for both):
 *
 *   imitation: { turns: 1, effects: [{ stats: { str: 2 } }] }     // it lasts a turn longer, and its unit has
 *                                       // these effects while it imitates
 *   imitation: { keeps: { share: 50, stats: ["str"], turns: 1 } } // what it keeps for a turn afterwards
 *
 * And skills bring creatures onto the map (see `creatures.mjs`, which has all a `makes` part can say). A skill
 * used as an action says so in its `act`, beside one tile that is picked; here a skill raises the enemy its unit
 * defeats, and speaks of the creatures another skill of its unit makes, which is always there:
 *
 *   { proc: { on: "kill", sure: true }, makes: { kind: "undead", body: "slain", hp: 1, qualities: ["Terror"] } }
 *                                       // the enemy stands up on the tile it fell on, on its unit's side
 *   creatures: { kind: "phantom", more: 1, levels: [26, 31] }     // its unit may have one more of that kind
 *                                       // out, and one more again at each of those levels
 *   creatures: { kind: "phantom", skill: "generic" }              // each of that kind has one skill of that
 *                                       // sort, picked once
 *   rules: ["possessed"]                // in a change that remembers whom it comes from: whoever acts for
 *                                       // that unit acts for this one while it lasts
 *   triangle: { loses: ["light"] }      // its unit is at a Weapon Triangle disadvantage against these weapons
 *
 * And skills change what an attack deals and to whom it deals it. Conditions that ask about the weapons:
 *
 *   when: { weaponNot: ["bolt"] }       // the unit's weapon is none of these
 *   when: { weaponSlays: ["Flying"] }   // the Effect of the weapon in hand makes it effective against one of
 *                                       // these Special Qualities, whatever its unit's skills add
 *   when: { foeWeaponRank: ["E", "D"] } // the rank written on the foe's weapon
 *   when: { foeWeaponKnown: true }      // the foe wields a kind of weapon the unit has a rank with
 *   when: { overkill: true }            // the unit's Might and stat, less the foe's defence and before any
 *                                       // skill, come to more than the HP the foe has
 *
 * and conditions that wait, as `foeCounters` does, until the fight is known that far (they hold nowhere else):
 *
 *   when: { foeSlays: ["Terror"] }      // the foe's attacks are effective against one of these qualities, by
 *                                       // its weapon's Effect or by its skills; `foeSlaysNot` when they are not
 *   when: { foeEffective: false }       // whether the foe's attacks deal effective damage to this unit
 *   when: { foeDenied: true }           // the foe makes no counter-attack though its weapon would reach: it is
 *                                       // unarmed, kept from it, or cannot answer a Midrange attack. Where it
 *                                       // loses its counter-attack in the middle of the fight, what such an
 *                                       // effect adds to Hit, damage and Critical counts from then on
 *   when: { foeFollows: false }         // whether the foe makes a follow-up attack
 *   when: { foeDebuffed: true }         // a stat of the foe is lowered by a condition, by a change that lasts
 *                                       // on it, by an aura or by a skill of its foe; `{ of: "foeDebuffs" }` is
 *                                       // how many of its stats are, and `{ of: "foeDebuffSum" }` by how much
 *                                       // in all
 *
 * Numbers: `{ of: "lead:con" }` is what the unit has more of a stat than its foe, `{ of: "conOverWeight" }` its
 * Constitution over the Weight of the weapon in hand, `{ of: "unusable" }` the weapons it carries and cannot
 * wield. Parts that are always there:
 *
 *   uneffective: ["Armored"]            // no attack deals effective damage to its unit for these qualities
 *   effectiveTaken: 1.5                 // an attack that is effective against its unit multiplies the Might of
 *                                       // its weapon by this much at most, rounded down
 *   combatTimes: { critical: 2 }        // a combat stat of its unit multiplied, once everything is added
 *   foeCombat: { critical: 20 }         // added to the combat stats of its foe, for the whole fight
 *   echo: { percent: 50, element: "fire", resist: "res", floor: 25 }
 *                                       // every hit of its unit that deals damage deals a share of that damage
 *                                       // again, as damage of that element, less the foe's RES, and no less
 *                                       // than the smaller share
 *
 * on an attack, for that attack:
 *
 *   statPlus: { str: { of: "hp", div: 2 } }      // added to a stat, where the weapon adds that stat
 *   effective: ["Terror"]               // it deals effective damage to a foe with one of these qualities
 *   slay: true                          // if it lands it kills: it deals at least the HP its target has
 *   instead: { dice: 100, of: "hpMax" } // if it lands, a die is rolled: it deals that share of its target's
 *                                       // maximum HP in place of its damage, unless its damage is more
 *   cut: { percent: 50, killAt: 1 }     // once its damage is dealt, its target loses that share of the HP it
 *                                       // has left, or is killed if it has no more than `killAt`
 *
 * (`rules: ["noLethality"]` keeps the last three from a unit), and at other moments:
 *
 *   { proc: { on: "struck", stat: "dex" }, defend: { def: { of: "str", div: 3 } } }      // added to the DEF (or
 *                                       // RES) the hit is resisted with, where that is the one
 *   { proc: { on: "struck", sure: true, unable: true }, retaliate: ... }     // `unable`: only while its unit
 *                                       // makes no attack in the fight, or none that would deal damage
 *   { proc: { on: "crit", sure: true, harmless: true }, retaliate: ... }     // `harmless`: only for a hit that
 *                                       // dealt no damage; what it deals is dealt to the target
 *   { proc: { on: "start", stat: "dex" }, stats: { spd: 5 } }                // stats for the whole fight: what
 *                                       // they add to its combat stats, and to who follows up
 *
 * And skills leave changes on a foe that last (see `timed.mjs` for a `grant`), which these parts round off:
 *
 *   statTimes: { def: 0.5, luk: 0 }     // always there, as in a lasting change: the stat is multiplied by this
 *                                       // once everything else is added to it, each time it is read, and
 *                                       // rounded down; several multiply together, so a stat that is halved
 *                                       // twice is a quarter. What another unit puts on its unit is eased by
 *                                       // what its skills take off incoming penalties (`debuffs`)
 *   until: "followUp"                   // beside what is always there, in a fight: only until its unit has
 *                                       // made its follow-up attack, and for the whole fight if it makes none
 *   { proc: { on: "attack", stat: "spd" }, foeStatTimes: { luk: 0 } }     // on an attack: the foe's stat
 *                                       // counts so many times for that attack alone, in its Dodge, its
 *                                       // Critical Avoid and what it resists the attack with
 *   { proc: { on: "attacked", stat: "str" }, inflictsAttacker: ["stun"] } // as its unit is attacked, whether
 *                                       // the attack then lands or not: the condition comes once it is made
 *   grant: { to: "foe", now: true, ... }           // the change counts for the rest of that fight as well
 *   grant: { to: "foe", choose: { stats: ["str", "def"], pick: 2, amount: -5 }, ends: "turnEnd" }
 *                                       // whoever acts for its unit picks the stats (see `timed.mjs`)
 *   grant: { to: "foe", staff: "charm" }           // what that staff does to its target (`FEO.staffChanges`)
 *   grant: { reach: { who: "enemy", within: 2 }, over: "res", ... }       // of the units in reach, only those
 *                                       // whose stat is lower than its unit's own
 *   rules: ["neutral"]                  // its unit stands apart from every side: nobody's ally, nobody's enemy
 *
 * And skills leave things on their own unit and its allies, with a `grant` (see `timed.mjs` for what one may
 * say: `wait`, `lone`, `mend`, `spoils`, `random`, `when`, `once: "strike" | "struck"`, `to: "giver"`) and
 * these parts:
 *
 *   firstAttack: { hit: 20, critical: 15, damage: 4 }      // always there, as `firstMight` is: added to the
 *                                       // first attack its unit makes in a fight, and to no other. In a change
 *                                       // that is used up `once: "strike"` it is the unit's next attack
 *   { proc: { on: "dodged", stat: "dex" }, next: { hit: 20 }, keep: true }     // `keep`: what is set aside for
 *                                       // the unit's next attack waits for it in a later fight, where it makes
 *                                       // no other in this one
 *   nextOfNegated: { damage: 100 }      // when struck: a share of what this effect took off the hit, set
 *                                       // aside for the unit's next attack
 *   { of: "negated" }, { of: "taken" }  // in a change granted when struck: what this effect took off the hit,
 *                                       // and the damage the hit dealt in the end; as `{ of: "dealt" }` they
 *                                       // take `cap`, `div` and `times`, and a hit that made nothing of
 *                                       // them grants nothing
 *   pays: 5                             // at the start of a fight or after it: damage its own unit takes,
 *   pays: { of: "hp", div: 2 }          // which with `nonlethal` leaves it 1 HP at the least
 *   { proc: { on: "attacked", sure: true, perHp: 25 }, combat: { dodge: 10, critAvoid: 5 } }
 *                                       // `perHp`: once for every so many percent of its unit's maximum HP
 *                                       // that the attack would take off it, and not at all for less
 *   when: { lasting: false }            // beside `declared`: only in the fight that spends its skill, not in
 *                                       // those the skill lasts into; `true` for only those
 *   when: { equal: ["mag", "res"] }     // these stats of its unit are the same
 *   when: { foeGiver: false }           // in a lasting change: the unit fought is not the one it comes from
 *   aura: { who: "ally", within: 2, once: "turn" }         // an aura that is given once a turn: a moment of it
 *                                       // that grants its giver something (`to: "giver"`) uses it up until
 *                                       // the Phase ends
 *   { proc: { on: "use", sure: true }, grant: { to: "self", hp: 10, effects: [], ends: "turnStart", turns: 3 } }
 *                                       // the moment its skill is used as an action: a change for its unit
 *
 * And skills read the turn clock of a battle (see `clock.mjs`) and keep count of things (see `timed.mjs` for
 * a tally):
 *
 *   when: { turn: "odd" }               // the turn of the battle is odd-numbered, or "even"; `{ min, max }`
 *                                       // for a span of turns
 *   when: { phase: ["enemy", "other"] } // the Phase that is running is one of these sides'
 *   combat: { hit: { of: "turnsPast", times: -1, plus: 15, min: 0 } }      // `turn`: the turn of the battle;
 *                                       // `turnsPast`: the turns that are over since the map began. Any number
 *                                       // may be held at a `min` as at a `max`
 *   grant: { to: "self", max: 999, ends: "never", ... }      // a tally that lasts between maps
 *   grant: { to: "self", max: 50, grows: { of: "dealt" }, wait: 1, effects: [{ combat: { damage: { of: "count", div: 10 } } }], ends: "turnEnd" }
 *                                       // a tally that grows by the damage of the hit that grants it, counts
 *                                       // through one turn and gives what it came to in the next: `count` is
 *                                       // what a tally holds, read in its own effects
 *   on: "noCrit"                        // a moment of a fight: an attack of its unit was made and was no
 *                                       // critical hit, whether it missed or landed: grant, remind
 *   { proc: { on: "attack", sure: true, once: true }, sureHit: true, sureCrit: true }
 *                                       // `sureCrit`: the attack is a critical hit if it lands, unless
 *                                       // something keeps its unit from critical hits
 *   { proc: { on: "struck", sure: true }, forfeit: true }    // the moment does nothing but count as a use of its
 *                                       // skill, for one that takes effect by itself a limited number of
 *                                       // times: what the skill had left to give is given up
 *   critFloor: 1                        // always there: the chance of its unit's attacks to be critical hits
 *                                       // is this much at the least, whatever its foe's Critical Avoid, unless
 *                                       // something keeps it from critical hits altogether
 *   rules: ["untargetable"]             // no enemy can make its unit the target of an attack, a staff or a
 *                                       // skill, which the map sees to
 *   rules: ["weatherproof"]             // its unit is spared the effects of the weather of its map: what
 *                                       // tiles cost more, what its stats lose, the damage of a turn's end.
 *                                       // Not Fog of War, nor a bolt that strikes its tile (see `weather.mjs`)
 *
 * A skill that takes effect by itself a limited number of times (`usage.kind: "auto"`) counts its moments of a
 * turn as it does those of a fight: with a cooldown of 1 it has its moment in no two turns running, and with
 * one use a turn or a map it has it once.
 */
import { FEO } from "../config.mjs";
import { CLOCK_KEYS, CLOCK_SOURCES, checkClock, clockHolds, needsClock, readClock, withoutClock } from "./clock.mjs";
import { ACTION_MOMENT, NO_REFRESH, NO_TURN, checkActionMoment, checkActs } from "./acting.mjs";
import { ANSWER_MOMENTS, FOILS, FOIL_MOMENT, SPLASH_AROUND, WORST_HIT, checkAnswer } from "./answers.mjs";
import { BLOCK_KINDS, NO_SHIELD, addBlock, blocksMagic, checkBlock, emptyBlock } from "./blocking.mjs";
import { AGAINST, BONUS_STATS, PARITY, checkFoeBonus, checkSingle, checkSpend, checkTrade, forAttacksOnly, pickedSteps } from "./choices.mjs";
import { addCanto, addCurb, checkCanto, checkCurb, emptyCanto } from "./canto.mjs";
import { SKILL_CALC } from "./combat-stats.mjs";
import { conditionModifiers } from "./conditions.mjs";
import { MOVE_KEYS, moveHolds, moveNumbers, movedThroughHolds, needsMove, withoutMove } from "./movement.mjs";
import { activationGrade } from "./optional.mjs";
import { addPassing, checkPassing, emptyPassing } from "./passing.mjs";
import { chosenOf, variantsOf } from "./picks.mjs";
import { alliesOpposite, countHolds, countNear, formationAround, reachable, sharesSpace, unitsNear, unitsNearFoe } from "./positions.mjs";
import { SHIFT_PARTS } from "./shifting.mjs";
import { addCrossing, checkCrossing, emptyCrossing } from "./terrain.mjs";
import { checkSpread, spreadGrant, spreadOut, spreadTo, spreadWaits } from "./spread.mjs";
import { usesLeft } from "./skill-usage.mjs";
import { COUNT_MOST, COUNT_SOURCE, TIMED_ENDS, TIMED_ONCE, buildChange, chosenEffects, dieFrom, expandGrant, randomEffects } from "./timed.mjs";
import { ACT_AFTER_WARP, checkWarp } from "./warp.mjs";
import { ANSWERS, GRIPPED, PROVOKED, checkAct } from "./actions.mjs";
import { POSSESSED, checkCreatures, checkMakes } from "./creatures.mjs";
import { checkImitation } from "./imitation.mjs";
import { HELD, ROOTED, UNFORCED, addShove, checkShove, checkStep, emptyShove } from "./forced.mjs";
import { addCarry, checkCarry, emptyCarry } from "./rescue.mjs";
import { HIDDEN, checkReacts, reactOf } from "./reactions.mjs";
import { WEATHERPROOF } from "./weather.mjs";
import { checkGuards, checkShelters, checkStance, checkWards, guardOf, shelterOf, wardOf } from "./stances.mjs";
import { NO_SONG, addRefresh, checkRefresh, checkRefreshes, emptyRefresh } from "./refresh.mjs";
import { FOE_FIRST, ORDERS, ROUND_MOMENT, STRIKES_ALWAYS, checkRounds } from "./rounds.mjs";
import { plainEffect } from "./gear.mjs";
import { ITEM_MOMENT, checkConsumes, checkItemMoment } from "./items.mjs";
import { OUTSIDE, addTriangle, checkHandover, checkTriangle, outsideTriangle } from "./triangle.mjs";
import { attackWith, castArm, checkLend } from "./lending.mjs";
import { KNACK_KEYS, UNCAPTURED, UNSTOLEN, addKnacks, checkKnacks, checkLoot, emptyKnacks } from "./stealing.mjs";

/**
 * @typedef SkillEntry
 * @property {string} name
 * @property {boolean} [nihil]        Is the skill cancelled in combat by a foe with Nihil?
 * @property {string} [choice]        The variant chosen for the skill, when it has several
 * @property {object[]} effects       Its structured effects
 */

/**
 * @typedef SkillSelf
 * What a skill can ask about its own unit.
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} level
 * @property {Record<string, number>} stats       Stat totals without any skill effect
 * @property {Record<string, number>} [base]      Base stat values
 * @property {object|null} weapon                 The weapon in hand: category, weight, might, hit, crit, rank,
 *                                                range, name
 * @property {number} [accuracy]                  Accuracy without any skill effect, for effects that read it
 * @property {import("./positions.mjs").Surroundings|null} [near]
 *                                                What the unit has around it; null when it is not on the map
 * @property {Record<string, number>} [conditions]    The conditions it suffers from, and the turns each has left
 * @property {string} [qualities]                 Its Special Qualities, as free text
 * @property {boolean} [shifted]                  Is it transformed: Shifted, or with a stone that transforms it?
 * @property {string[]} [skills]                The names of the skills it has equipped; filled in from the
 *                                                skills read where it is not given
 * @property {number} [tier]                      Its class tier, as `unitTier` has it; counted from its level
 *                                                where it is not given
 * @property {string} [gender]                    Its gender, as free text
 * @property {"physical"|"magical"|"both"|""} [bestRank]
 *                                                Where its highest weapon rank lies, as `bestRankOf` has it
 * @property {import("./movement.mjs").Movement|null} [move]
 *                                                How it moved this turn; null when that cannot be judged
 * @property {string[]} [goes]                    The skills that have given it all the goes their limit allows
 *                                                (see `acting.mjs`): they earn it no other for now
 * @property {import("./clock.mjs").Clock|null} [clock]
 *                                                The turn of the battle it is in and the Phase that is running;
 *                                                null outside of a battle
 */

/**
 * @typedef SkillFight
 * What a skill can ask about the fight its unit is in.
 * @property {"initiating"|"defending"} role
 * @property {number} distance
 * @property {SkillSelf & {qualities?: string, afflicted?: boolean}} foe
 * @property {boolean|null} [foeCounters]     Can the foe answer? Null while that is not known yet
 * @property {boolean|null} [counters]        Can the unit itself?
 */

/** The rule that keeps a unit from being killed outright, or from having its HP cut by a share. */
export const NO_LETHALITY = "noLethality";

/** The rule that keeps every enemy from making a unit the target of an attack, a staff or a skill. */
export const UNTARGETABLE = "untargetable";

/** The rule that has a unit stand apart from every side, as a neutral unit does. */
export const NEUTRAL = "neutral";

/**
 * The rule that turns a unit on its own side: it makes the target of an attack, a staff or a skill neither an
 * enemy of its own nor another unit that was turned so.
 */
export const TURNED = "turned";

/** What a part of a fight an effect lasts until: its unit's follow-up attack. */
export const UNTIL = ["followUp"];

/** The moment a unit starts a fight with a weapon a skill lends it (see `lending.mjs`). */
export const LEND_MOMENT = "lend";

/** The combat rules a skill can bend. */
export const RULES = [
  "nihil", "closeCounter", "distantCounter", "noTriangle", "reverseTriangle", "alwaysAdvantage", "noFollowUp",
  "foeNoFollowUp", "sureFollowUp", "first", "sureHit", "sureCrit", "foeNoCounter", "noCombat", "noEffective",
  "alwaysActivate", "noCrit",

  // The unit makes no counter-attack, though it may still start a fight
  "noCounter",

  // The unit's highest rank in any proficiency sets the size of its weapon triangle bonus, and it earns
  // twice the weapon experience
  "bestRankTriangle", "doubleWexp",

  // Backfiring, as Devil weapons do: the unit's attacks may, its foe's may, a backfire of its Devil weapon
  // damages the target as well, and the unit takes half of what backfires on it
  "backfire", "foeBackfire", "backfireBoth", "halfBackfire",

  // Reach and wear: the unit answers a Midrange attack from next to it with a weapon that only reaches 1 tile,
  // its own attack from next to its foe counts as Midrange, it fights a diagonal neighbour in melee as if
  // next to it, its weapon loses no more than one use in a fight, and none for the attack that defeats its foe
  "counterMidrange", "midrange", "diagonalMelee", "oneUsePerFight", "freeKill",

  // The unit takes no damage that a skill deals outside of an attack: what is reflected or dealt in return,
  // on a miss, after the fight, or by a condition that bursts
  "noSkillDamage",

  // Staves: one that heals heals its user when it is used on nobody, and the unit's staves lose no use
  "selfStaff", "staffFreeUses",

  // Its unit may start a fight with a staff in its hand
  "staffCombat",

  // Staying alive: the unit's foe makes no critical hit, the unit dodges every attack whose hit would be
  // fatal to it (the Hit of such an attack is shown as no more than `FEO.fatalDodge.hitCap`, and the attack
  // misses whatever is rolled), and a blow of any kind that would be fatal to it is halved, which may leave
  // it fatal still
  "foeNoCrit", "dodgeFatal", "halveFatal",

  // Earnings: the unit gives no experience to the unit that defeats it
  "noExp",

  // Movement: the unit takes no action but to Wait, which the map sees to
  "onlyWait",

  // Terrain: the tile the unit's foe stands on adds nothing to the foe's Defence, Resistance or Dodge
  "foeNoTerrain",

  // Warping: the unit keeps its turn when a skill has warped it
  ACT_AFTER_WARP,

  // Acting again: the unit loses its turn, and no other unit gives it its Action back, which the turn order
  // sees to
  NO_TURN, NO_REFRESH,

  // Refresh: the unit cannot use it, though it has the skill
  NO_SONG,

  // Forced movement: nothing moves the unit but the unit itself, no enemy moves it or keeps it from moving,
  // it cannot move, and it is held by another unit, which the map sees to
  ROOTED, UNFORCED, HELD, GRIPPED,

  // Shields: the unit has none equipped and can equip none, for as long as a change that says so lasts on it
  NO_SHIELD,

  // Parity: what terrain, supports, weapons, equipment and skills do is cancelled in the fight, for both units
  PARITY,

  // The unit rolls each of its Hit rolls twice and takes the worse of the two
  WORST_HIT,

  // What the unit's weapon strikes "when initiating combat" it strikes whoever began the fight
  STRIKES_ALWAYS,

  // The unit's foe attacks first in a fight the unit starts (see `rounds.mjs`)
  FOE_FIRST,

  // Nothing kills the unit outright or cuts its HP by a share, as Lethality and Bane do: an attack that would
  // deals its damage and no more
  NO_LETHALITY,

  // The unit stands apart from every side, which the map sees to
  NEUTRAL,

  // No enemy can make the unit its target, which the map sees to
  UNTARGETABLE,

  // The unit targets neither its enemies nor others that were turned as it was, which the map sees to
  TURNED,

  // The unit was forced to target the unit a change on it comes from: it makes no other enemy the target of an
  // attack, a staff or a skill, which the map sees to
  PROVOKED,

  // The unit makes its counter-attack whatever skill or condition would keep it from one
  ANSWERS,

  // The unit is one its enemies do not see: its token is not shown to them, and it is not in their way on the
  // map, which sees to both (see `reactions.mjs`)
  HIDDEN,

  // Nothing is stolen from the unit, and it is not captured: the map and the fight see to both (see
  // `stealing.mjs`)
  UNSTOLEN,
  UNCAPTURED,

  // The unit is spared the effects of weather, but for Fog of War and what strikes the map (see `weather.mjs`)
  WEATHERPROOF,

  // The unit a change on it comes from acts for it in place of whoever does, which the map sees to (see
  // `creatures.mjs`)
  POSSESSED
];

/** The stats whose lowering counts as a stat debuff, for what counts those on a foe. */
export const DEBUFF_STATS = ["str", "mag", "dex", "spd", "luk", "def", "res", "con"];

/** When a proc is rolled. */
export const PROC_TRIGGERS = ["attack", "struck", "start", "hit", "crit", "miss", "dodged", "kill", "after", "inflict", "afflicted", "block", "blocked",
  "blockFail", "curbed", "unhurt", "noCrit", ...ANSWER_MOMENTS, FOIL_MOMENT, ROUND_MOMENT, LEND_MOMENT];

/** The moment of a fight that comes for each attack a unit makes which is no critical hit, hit or miss. */
export const NO_CRIT_MOMENT = "noCrit";

/**
 * The moments of a fight that come with a block: for the unit that blocked, for the one whose attack was, and
 * for the unit that rolled to block a hit and did not.
 */
export const BLOCK_MOMENTS = ["block", "blocked", "blockFail"];

/**
 * The moments of a fight that come once it is known what a hit that landed dealt: for the unit whose hit was
 * curbed (blocked, lessened by a skill of its target, or left with half its damage or less by the target's
 * defence), and for the unit that took a hit which dealt no damage.
 */
export const DAMAGE_MOMENTS = ["curbed", "unhurt"];

/** What can curb a hit, for a moment that asks: a block, a skill of the target, or the target's defence. */
export const CURBS = ["block", "skill", "defence"];

/** The moments of a fight that come when a condition is inflicted: for the unit that did, and for its foe. */
export const CONDITION_MOMENTS = ["inflict", "afflicted"];

/**
 * The moment a unit uses a staff, and the moment it has healed an ally by whatever means, which are no moments
 * of a fight or of a turn.
 */
export const STAFF_MOMENTS = ["staff", "heal"];

/** The parts of an effect that speak to staves, to healing and to the changes a unit gives. */
const STAFF_KEYS = ["staffHeal", "staffHealed", "staffRange", "staffFollow", "healing", "buffs", "staffImmune"];

/** The rules that only staves read, which give a skill nothing to tell in a fight. */
const STAFF_RULES = ["selfStaff", "staffFreeUses", "staffCombat"];

/** The rules that are read outside of fights altogether, and so give a skill nothing to tell in one. */
const QUIET_RULES = [...STAFF_RULES, ACT_AFTER_WARP, "onlyWait", NO_TURN, NO_REFRESH, NO_SONG, ROOTED, UNFORCED, HELD, GRIPPED, NO_SHIELD, NEUTRAL, UNTARGETABLE, TURNED, PROVOKED, HIDDEN, UNSTOLEN, UNCAPTURED, POSSESSED, WEATHERPROOF];

/** The moment a unit has taken an Action of its turn, which is no moment of a fight either (see `acting.mjs`). */
export const ACTION_MOMENTS = [ACTION_MOMENT];

/** The parts of an effect that bend the rules of conditions. */
const BEND_KEYS = ["inflictChance", "inflictTurns", "nullify", "suffers", "recovery", "debuffs", "burstHarm"];

/** The parts that say what a unit does for its side outside of its own turn (see `stances.mjs`). */
const STANDING_KEYS = ["guards", "wards", "reacts", "shelters"];

/** The moment a skill is used as an action, for what it then leaves on its unit. */
export const USE_MOMENT = "use";

/** What a number in a lasting change can be read from of the hit that grants it. */
export const HIT_SOURCES = ["dealt", "negated", "taken"];

/** The moments of a unit's turn a skill can wait for. */
export const TURN_MOMENTS = ["turnStart", "turnEnd", "wait"];

/** The moments outside of fights and turns a skill can wait for: its unit levelling up. */
export const LEVEL_MOMENTS = ["levelUp"];

/** The parts of a condition that can only be judged in a fight. */
const FIGHT_KEYS = ["foeMarked", "foeUnmarked", "foeGiver", "role", "foeHp", "foeWeapon", "foeWeaponNot", "foeQuality", "foeNoQuality", "foeCounters", "counters", "range", "compare", "foeAfflicted",
  "foeLacks", "foeNear", "flanking", "formation", "sameSpace", "beyondReach", "foeTerrain", "foeOn", "movedThroughFoe", "inSight",
  "foeWeaponRank", "foeWeaponKnown", "overkill", "foeSlays", "foeSlaysNot", "foeEffective", "foeDenied", "foeFollows", "foeDebuffed"];

/** The parts of a condition that ask where units stand. */
const PLACE_KEYS = ["near", "foeNear", "flanking", "formation", "sameSpace", "terrain", "standsOn", "foeTerrain", "foeOn"];

/** Those of them that ask what the unit stands on, and what its foe does. */
const GROUND_KEYS = ["terrain", "standsOn"];
const FOE_GROUND_KEYS = ["foeTerrain", "foeOn"];

/**
 * Does a condition ask where units stand? An answer of `false`, as for terrain without effects, is asked too.
 * @param {object} [when]
 * @returns {boolean}
 */
function asksPlace(when) {
  return PLACE_KEYS.some((key) => (when?.[key] !== undefined) && (when[key] !== null));
}

/** The parts of a condition that wait until it is known who can counter-attack. */
const LATE_KEYS = ["foeCounters", "counters"];

/**
 * Those that wait for more of the fight to be known: what the foe's attacks are effective against, why it makes
 * no counter-attack, whether it follows up, and which of its stats are lowered.
 */
const KNOWN_LATE = ["foeSlays", "foeSlaysNot", "foeEffective", "foeDenied", "foeFollows", "foeDebuffed"];

/** Why a unit makes no counter-attack, where that is not for being kept from one: its weapon does not reach. */
const UNREACHED = ["outOfRange", "noCombat", "down", "targetDown", "elevation", "artRange"];

const COMBAT_KEYS = ["hit", "damage", "critical", "attackSpeed", "dodge", "critAvoid", "activation"];

/** The parts of an effect that make its skill worth naming in a forecast, even without a condition. */
const NOTABLE = ["rules", "effective", "effectiveMultiplier", "damageMultiplier", "ignoreDefence", "strikes", "extraAttack", "taken", "takenPercent", "scale",
  "uneffective", "combatTimes", "foeCombat", "echo",
  "weaponRange", "damageStat", "foeWear", "inflictChance", "inflictTurns", "nullify", "burstHarm", "mirrorCrit", "critMultiplier", "firstMight", "weaponUse",
  "trade", "spend", "single", "noWeight", "against", "hitCap", "foeBonus", "speedLead", "handover", "critFloor"];

/** The parts of an effect that are read outside of fights, and give a skill nothing to tell in one. */
const QUIET_PARTS = ["cooldowns", "rearm"];

/** The moments of a fight that come once it is over, which nothing that cancels skills in the fight cancels. */
const LATE_MOMENTS = ["kill", "after"];

/* -------------------------------------------- */
/*  Reading Conditions                          */
/* -------------------------------------------- */

/**
 * Does a weapon belong to one of the listed categories or groups?
 * Groups: `magic` for every tome, `physical` for every weapon that is neither a tome nor a staff, `melee` for
 * those of them that are not bows or their kin, `anima` for Anima and its elements, `fists` for bare hands and
 * the weapon named Fists, `unarmed` for no weapon at all, `blessed` for a weapon whose name or Effect says it
 * is Blessed, `nonBeorc` for what Laguz, Manaketes and Taguel attack with (both set by `sacredWeapons` in the
 * configuration), `eye` for a monster's Eye weapons, told by their name (`namedWeapons`).
 * Any other word is a category by its key, and holds for its sub-categories too: what is for Swords is for
 * Katanas (`kin` in `FEO.weaponCategories`), while what is for Katanas is for them alone. The Reference Sheet
 * names kinds of weapon the system has no category for yet (`astral`, `scroll`, `magicite`, `arcanima`,
 * `chaos`): they may be listed, and hold for no weapon until there is one of that category.
 * @param {object|null} weapon
 * @param {string[]} list
 * @returns {boolean}
 */
export function weaponIs(weapon, list) {
  const category = weapon?.category;
  const config = FEO.weaponCategories[category];
  return list.some((entry) => {
    switch ( entry ) {
      case "unarmed": return !weapon;
      case "fists": return !weapon || (String(weapon.name ?? "").trim().toLowerCase() === "fists");
      case "magic": return !!config?.magic;
      case "physical": return !!weapon && !config?.magic && (category !== "staff");
      case "melee": return !!weapon && !config?.magic && !config?.ranged && (category !== "staff");
      case "anima": return (category === "anima") || (category === "ice") || FEO.animaProficiencies.includes(category);
      case "blessed": return !!weapon && new RegExp(FEO.sacredWeapons.blessed, "i").test(`${weapon.name ?? ""}\n${weapon.effect ?? ""}`);
      case "nonBeorc": return FEO.sacredWeapons.nonBeorc.includes(category);
      case "eye": return !!weapon && new RegExp(FEO.namedWeapons.eye, "i").test(String(weapon.name ?? ""));
      default: return (category === entry) || (!!config?.kin && (config.kin === entry));
    }
  });
}

/* -------------------------------------------- */

/**
 * The weapon type a kind of weapon belongs to, for a skill that is for one weapon type: Magic comes in three
 * types (`FEO.magicTypes`), so that a kind picked among tomes stands for its whole type, as it does for the
 * skills whose effects are lent (Anima for Fire; Dark and Light for either). Any other kind is its own type.
 * @param {{key: string, label: string, categories: string[]}} kind     A proficiency or a category of weapon,
 *                                                    with the categories it wields
 * @returns {{key: string, label: string, categories: string[]}}        The same, or the Magic type it is of
 */
export function weaponTypeOf(kind) {
  for ( const [key, type] of Object.entries(FEO.magicTypes) ) {
    if ( (kind?.categories ?? []).some((category) => weaponIs({ category }, type.kinds)) ) return { key, label: type.label, categories: [...type.kinds] };
  }
  return kind;
}

/* -------------------------------------------- */

/**
 * Compare HP with a threshold.
 * @param {{op: string, percent?: number}} test
 * @param {number} hp
 * @param {number} hpMax
 * @returns {boolean}
 */
export function hpHolds(test, hp, hpMax) {
  const share = hpMax > 0 ? (hp / hpMax) * 100 : 0;
  switch ( test.op ) {
    case "le": return share <= test.percent;
    case "lt": return share < test.percent;
    case "ge": return share >= test.percent;
    case "gt": return share > test.percent;
    case "above": return hp > (test.value ?? 0);
    case "full": return hp >= hpMax;
    case "notFull": return hp < hpMax;
    default: return true;
  }
}

/* -------------------------------------------- */

/**
 * Does a Special Quality appear in a unit's qualities, written as free text?
 * @param {string} [qualities]
 * @param {string} quality
 * @returns {boolean}
 */
function hasQuality(qualities, quality) {
  const escaped = quality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(qualities ?? "");
}

/**
 * Does a unit have any Special Quality at all?
 * @param {string} [qualities]
 * @returns {boolean}
 */
function anyQuality(qualities) {
  return String(qualities ?? "").split(/[,;/&\n]/).some((part) => {
    const text = part.trim();
    return text && !/^(none|n\/?a|-+)$/i.test(text);
  });
}

/* -------------------------------------------- */

/**
 * A unit with the names of its own skills, for the conditions that ask whether it has one. What it only
 * receives from units around it, or carries for a while, is no skill of its own.
 * @param {SkillSelf} self
 * @param {SkillEntry[]} skills
 * @param {boolean} [foeNihil]      Does the foe cancel the skills that Nihil cancels? Those then do not count
 * @returns {SkillSelf}
 */
function withSkillNames(self, skills, foeNihil = false) {
  // The changes of its own that it carries, for a skill that asks for one by name
  const carried = Array.isArray(self?.carried) ? self.carried : carriedBy(skills);
  if ( Array.isArray(self?.skills) ) return Array.isArray(self.carried) ? self : { ...self, carried };
  const names = (skills ?? []).filter((skill) => !skill.aura && !skill.timed && !(foeNihil && skill.nihil)).map((skill) => skill.name);
  return { ...self, skills: names, carried };
}

/* -------------------------------------------- */

/**
 * The names of the lasting changes of its own that a unit carries, read from its skills as they are handed
 * to the rules: the entries its changes are read as (see `timedEntries` in `timed.mjs`).
 * @param {SkillEntry[]} [skills]
 * @returns {string[]}
 */
export function carriedBy(skills) {
  return (skills ?? []).filter((skill) => skill.timed && !skill.foreign).map((skill) => skill.change ?? skill.name);
}

/* -------------------------------------------- */

/**
 * Does a skill take one of a unit's skill slots? Not what its Effect says is not a skill: what a Special
 * Quality builds into a unit, and the actions every unit has, are listed among the skills for reference only.
 * @param {string} [effect]     The Effect text
 * @returns {boolean}
 */
export function countsAsSkill(effect) {
  return !/\bnot a skill\b/i.test(String(effect ?? ""));
}

/* -------------------------------------------- */

/**
 * A value a comparison can read from a unit.
 * @param {SkillSelf} unit
 * @param {string} key
 * @returns {number}
 */
function readValue(unit, key) {
  switch ( key ) {
    case "hp": return unit.hp ?? 0;
    case "level": return unit.level ?? 1;
    case "tier": return tierOf(unit);
    case "attack": return unit.attack ?? 0;
    case "weaponWeight": return unit.weapon?.weight ?? 0;
    case "weaponMight": return unit.weapon?.might ?? 0;
    default: return unit.stats?.[key] ?? 0;
  }
}

/* -------------------------------------------- */

/**
 * Does an effect's condition need a fight to be judged?
 * @param {object} [when]
 * @returns {boolean}
 */
export function needsFight(when) {
  return FIGHT_KEYS.some((key) => (when?.[key] !== undefined) && (when[key] !== null) && (when[key] !== ""));
}

/* -------------------------------------------- */

/**
 * Does an effect's condition wait until it is known who can counter-attack?
 * @param {object} [when]
 * @returns {boolean}
 */
export function isLate(when) {
  return LATE_KEYS.some((key) => typeof when?.[key] === "boolean")
    || KNOWN_LATE.some((key) => (when?.[key] !== undefined) && (when[key] !== null));
}

/* -------------------------------------------- */

/**
 * Does a condition hold?
 * @param {object} [when]
 * @param {SkillSelf} self
 * @param {SkillFight|null} [fight]     Null outside a fight, where a condition that needs one does not hold
 * @returns {boolean}
 */
export function holds(when, self, fight = null) {
  if ( !when ) return true;
  if ( when.hp && !hpHolds(when.hp, self.hp, self.hpMax) ) return false;
  if ( when.weapon?.length && !weaponIs(self.weapon, when.weapon) ) return false;
  if ( when.weaponNot?.length && weaponIs(self.weapon, when.weaponNot) ) return false;
  if ( when.weaponSlays?.length && !when.weaponSlays.some((quality) => hasQuality(plainEffect(self.weapon), quality)) ) return false;
  if ( when.quality?.length && !when.quality.some((quality) => hasQuality(self.qualities, quality)) ) return false;
  if ( when.lacks?.length && when.lacks.some((quality) => hasQuality(self.qualities, quality)) ) return false;
  if ( when.skill && !(self.skills ?? []).includes(when.skill) ) return false;
  if ( when.noSkill && (self.skills ?? []).includes(when.noSkill) ) return false;
  if ( (when.carries !== undefined) && !(self.carried ?? []).includes(when.carries) ) return false;
  if ( (typeof when.waiting === "boolean") && (!!self.waiting !== when.waiting) ) return false;
  if ( (typeof when.shifted === "boolean") && (!!self.shifted !== when.shifted) ) return false;
  if ( when.noModule && FEO.optional?.[when.noModule]?.enabled ) return false;
  if ( when.module && !FEO.optional?.[when.module]?.enabled ) return false;
  if ( when.tier ) {
    const tier = tierOf(self);
    if ( (tier < (when.tier.min ?? -Infinity)) || (tier > (when.tier.max ?? Infinity)) ) return false;
  }
  // Dismounting: whether the unit has dismounted. No unit has until that Optional Module is built, which is to
  // tell a unit's `dismounted` where it describes one for its skills
  if ( (typeof when.dismounted === "boolean") && (!!self.dismounted !== when.dismounted) ) return false;
  if ( when.gender && ![when.gender, ""].includes(genderOf(self.gender)) ) return false;
  if ( when.bestRank && ![when.bestRank, "both"].includes(self.bestRank ?? "") ) return false;

  // Stats of the unit that are the same
  if ( when.equal?.length && (new Set(when.equal.map((key) => self.stats?.[key] ?? 0)).size > 1) ) return false;
  if ( (when.shield !== undefined) && (when.shield !== null) ) {
    const has = !!self.shield;
    if ( (when.shield === "magic") ? !(has && blocksMagic(self.shield)) : (has !== !!when.shield) ) return false;
  }
  if ( when.near &&!countHolds(countNear(self.near ?? null, when.near), when.near) ) return false;
  if ( (typeof when.terrain === "boolean") && (!!self.near?.ground?.effects !== when.terrain) ) return false;
  if ( when.standsOn && ![].concat(when.standsOn).includes(self.near?.ground?.terrain) ) return false;
  if ( when.weaponReach ) {
    const reach = self.weapon?.reach;
    if ( !reach || (reach.max < (when.weaponReach.min ?? 0)) || (reach.max > (when.weaponReach.max ?? Infinity)) ) return false;
  }
  if ( !moveHolds(when, self.move ?? null) ) return false;

  // The turn of the battle and the Phase that is running: neither holds outside of a battle
  if ( !clockHolds(when, self.clock ?? null) ) return false;
  if ( !needsFight(when) ) return true;
  if ( !fight ) return false;

  const foe = fight.foe;
  if ( when.role && (when.role !== fight.role) ) return false;
  if ( when.foeHp && !hpHolds(when.foeHp, foe.hp, foe.hpMax) ) return false;
  if ( when.foeWeapon?.length && !weaponIs(foe.weapon, when.foeWeapon) ) return false;
  if ( when.foeWeaponNot?.length && weaponIs(foe.weapon, when.foeWeaponNot) ) return false;
  if ( when.foeQuality?.length && !when.foeQuality.some((quality) => hasQuality(foe.qualities, quality)) ) return false;
  if ( when.foeNoQuality && anyQuality(foe.qualities) ) return false;
  if ( (typeof when.foeCounters === "boolean") && (fight.foeCounters !== when.foeCounters) ) return false;
  if ( (typeof when.counters === "boolean") && (fight.counters !== when.counters) ) return false;
  if ( when.range ) {
    if ( (when.range.min != null) && (fight.distance < when.range.min) ) return false;
    if ( (when.range.max != null) && (fight.distance > when.range.max) ) return false;
  }
  if ( when.compare ) {
    const { left, right = left, margin = 1, reverse = false } = when.compare;
    const lead = readValue(self, left) - readValue(foe, right);
    if ( (reverse ? -lead : lead) < margin ) return false;
  }
  if ( when.foeAfflicted && !foe.afflicted ) return false;

  // The unit fought carries the mark of that name which a skill of this unit left on it
  if ( when.foeMarked !== undefined ) {
    const mine = (mark) => (mark.name === when.foeMarked) && (!mark.from || !self.name || (mark.from === self.name));
    if ( !(foe.marks ?? []).some(mine) ) return false;
  }

  // Or does not carry it: as a skill that takes effect once for each enemy asks
  if ( when.foeUnmarked !== undefined ) {
    const mine = (mark) => (mark.name === when.foeUnmarked) && (!mark.from || !self.name || (mark.from === self.name));
    if ( (foe.marks ?? []).some(mine) ) return false;
  }
  if ( when.foeLacks?.length && when.foeLacks.some((quality) => hasQuality(foe.qualities, quality)) ) return false;
  if ( when.foeNear ) {
    const found = unitsNearFoe(self.near ?? null, foe.near ?? null, when.foeNear);
    if ( !countHolds(found ? found.length : null, when.foeNear) ) return false;
  }
  if ( when.flanking && !alliesOpposite(self.near ?? null, foe.near ?? null)?.length ) return false;
  if ( when.formation && !formationAround(self.near ?? null, foe.near ?? null, when.formation)?.length ) return false;
  if ( when.sameSpace && !sharesSpace(self.near?.tile ?? null, foe.near?.tile ?? null) ) return false;
  if ( !movedThroughHolds(when, self.move ?? null, foe.near?.id ?? null) ) return false;
  if ( when.beyondReach && !(fight.distance > (self.weapon?.reach?.max ?? Infinity)) ) return false;

  // The foe stands within the unit's Line of Sight: no further away than that stat counts spaces
  // and with nothing between the two that blocks sight, where the map is known
  if ( when.inSight ) {
    const seen = (self.near?.others ?? []).find((other) => other.id === foe.near?.id)?.seen;
    if ( !(seen ?? (fight.distance <= (self.stats?.los ?? 0))) ) return false;
  }
  if ( (typeof when.foeTerrain === "boolean") && (!!foe.near?.ground?.effects !== when.foeTerrain) ) return false;
  if ( when.foeOn && ![].concat(when.foeOn).includes(foe.near?.ground?.terrain) ) return false;

  // The weapons of the two: the rank written on the foe's, whether the unit has a rank with its kind, and
  // whether the unit's Might and stat alone, less the foe's defence, come to more than the HP the foe has
  if ( when.foeWeaponRank?.length && !when.foeWeaponRank.includes(foe.weapon?.rank) ) return false;
  if ( (typeof when.foeWeaponKnown === "boolean") && (ranksWith(self.proficiencies, foe.weapon?.category) !== when.foeWeaponKnown) ) return false;
  if ( (typeof when.overkill === "boolean") && ((baseDamage(self, foe) > Math.max(foe.hp ?? 0, 0)) !== when.overkill) ) return false;

  // What is only known once the fight is planned that far, and holds nowhere else
  if ( when.foeSlays?.length && !(fight.foeSlays && when.foeSlays.some((quality) => hasQuality(fight.foeSlays.join(", "), quality))) ) return false;
  if ( when.foeSlaysNot?.length && !(fight.foeSlays && !when.foeSlaysNot.some((quality) => hasQuality(fight.foeSlays.join(", "), quality))) ) return false;
  if ( (typeof when.foeEffective === "boolean") && !(fight.foeEffective && ((fight.foeEffective.length > 0) === when.foeEffective)) ) return false;
  if ( when.foeDenied && !((fight.foeCounters === false) && !!fight.foeBlocked && !UNREACHED.includes(fight.foeBlocked)) ) return false;
  if ( (typeof when.foeFollows === "boolean") && (fight.foeFollows !== when.foeFollows) ) return false;
  if ( when.foeDebuffed && !(fight.foeDebuffs?.count > 0) ) return false;
  return true;
}

/* -------------------------------------------- */

/**
 * Does a unit have a rank with a kind of weapon? Anima goes by any of its proficiencies, and a kind without a
 * proficiency, as a Laguz's claws, is one nobody has a rank with.
 * @param {Record<string, {rank: string}>} [proficiencies]
 * @param {string} [category]
 * @returns {boolean}
 */
export function ranksWith(proficiencies, category) {
  const keys = (category === "anima") ? FEO.animaProficiencies : [FEO.weaponCategories[category]?.proficiency];
  const order = Object.keys(FEO.ranks);
  return keys.some((key) => !!key && (order.indexOf(proficiencies?.[key]?.rank) > 0));
}

/**
 * What a unit's weapon deals to a foe before any skill, tile or triangle: its Might and the stat it adds, less
 * the defence that resists it.
 * @param {SkillSelf} self
 * @param {SkillSelf} foe
 * @returns {number}
 */
export function baseDamage(self, foe) {
  const weapon = self.weapon;
  if ( !weapon ) return 0;
  const added = weapon.damageStat ?? "str";
  const resists = (FEO.weaponCategories[weapon.category]?.magic || (added === "mag")) ? "res" : "def";
  return Math.max((weapon.might ?? 0) + (self.stats?.[added] ?? 0) - (foe.stats?.[resists] ?? 0), 0);
}

/* -------------------------------------------- */
/*  Where Units Stand                           */
/* -------------------------------------------- */

/**
 * The units an effect counts for its numbers: every `count` among its parts.
 * @param {object} effect
 * @returns {import("./positions.mjs").NearFilter[]}
 */
export function placeCounts(effect) {
  const found = [];
  const search = (value, key) => {
    if ( Array.isArray(value) ) for ( const entry of value ) search(entry);
    else if ( value && (typeof value === "object") ) {
      if ( (key !== "when") && (key !== "aura") && value.count ) found.push(value.count);
      for ( const [name, entry] of Object.entries(value) ) if ( name !== "count" ) search(entry, name);
    }
  };
  search(effect);
  return found;
}

/* -------------------------------------------- */

/**
 * Does an effect hang on where units stand: a condition on the units around, a number that counts them, an
 * aura for them or a reach for them?
 * @param {object} effect
 * @returns {boolean}
 */
export function needsPlace(effect) {
  if ( !effect ) return false;
  if ( effect.aura || effect.reach || effect.spread ) return true;
  if ( [].concat(effect.grant ?? []).some((grant) => grant?.reach) ) return true;
  if ( asksPlace(effect.when) ) return true;
  return placeCounts(effect).length > 0;
}

/* -------------------------------------------- */

/**
 * Can it be judged where the units an effect asks about stand? Not for a unit that is not on the map, nor for
 * what is asked about a foe that is not, nor for sides of a foe on a map without a square grid.
 * @param {object} effect
 * @param {SkillSelf} self
 * @param {SkillFight|null} [fight]
 * @returns {boolean}
 */
export function seesPlace(effect, self, fight = null) {
  if ( !self.near ) return false;
  const when = effect.when ?? {};
  if ( GROUND_KEYS.some((key) => when[key] !== undefined) && !self.near.ground ) return false;
  if ( fight && FOE_GROUND_KEYS.some((key) => when[key] !== undefined) && !fight.foe.near?.ground ) return false;
  if ( fight && (when.foeNear || when.flanking || when.formation || when.sameSpace) && !fight.foe.near ) return false;
  if ( fight && (when.flanking || when.formation || when.sameSpace) && (!self.near.tile || !fight.foe.near.tile) ) return false;
  return true;
}

/* -------------------------------------------- */

/**
 * A condition without its parts that ask where units stand.
 * @param {object} [when]
 * @returns {object}
 */
export function withoutPlace(when) {
  return Object.fromEntries(Object.entries(when ?? {}).filter(([key]) => !PLACE_KEYS.includes(key)));
}

/* -------------------------------------------- */
/*  Class Tier, Gender and Ranks                */
/* -------------------------------------------- */

/**
 * The class tier a unit of some level would have reached by promoting when it could.
 * @param {number} [level]
 * @param {number[]} [levels]     FEO.promotionLevels
 * @returns {number}              1 for a base class, 2 once promoted, 3 after the second promotion
 */
export function tierByLevel(level = 1, levels = FEO.promotionLevels) {
  return 1 + levels.filter((at) => (level ?? 1) > at).length;
}

/**
 * A unit's class tier as a number skills can read: that of its class (0 for a Trainee, 1 for a base class, 2
 * and 3 for the tiers above, 4 for a Heaven class), or for a class that does not promote, and for a unit
 * without one, the tier a promotion would have brought by its level.
 * @param {object} unit
 * @param {string|null} [unit.tier]         The tier of its class, a key of FEO.classTiers
 * @param {boolean} [unit.promotes]         Does its class promote?
 * @param {number} [unit.level]
 * @param {object} [options]
 * @param {object} [options.tiers]          FEO.classTiers
 * @param {number[]} [options.levels]       FEO.promotionLevels
 * @returns {number}
 */
export function unitTier({ tier = null, promotes = false, level = 1 } = {}, { tiers = FEO.classTiers, levels = FEO.promotionLevels } = {}) {
  const order = tiers[tier]?.order ?? null;
  if ( (order === null) || (!promotes && (order <= tiers.base.order)) ) return tierByLevel(level, levels);
  return order;
}

/**
 * The class tier of a unit as its skills are asked about it.
 * @param {SkillSelf} unit
 * @returns {number}
 */
function tierOf(unit) {
  return Number.isFinite(unit?.tier) ? unit.tier : tierByLevel(unit?.level);
}

/**
 * Read a unit's gender from what is typed on its sheet.
 * @param {string} [text]
 * @returns {"male"|"female"|""}      Blank for neither: nothing typed, or anything else
 */
export function genderOf(text) {
  const word = String(text ?? "").trim().toLowerCase();
  if ( /^(m|male|man|boy|he|he\/him|masc(uline)?)$/.test(word) ) return "male";
  if ( /^(f|female|woman|girl|she|she\/her|fem(inine)?)$/.test(word) ) return "female";
  return "";
}

/**
 * Where a unit's highest weapon rank lies: in a physical proficiency, in a magical one (tomes and staves), or
 * in both when the two are tied.
 * @param {Record<string, string>} [ranks]      Its rank in each proficiency
 * @param {object} [options]
 * @param {string[]} [options.order]            Ranks from lowest to highest; the lowest is no rank at all
 * @param {object} [options.categories]         FEO.weaponCategories
 * @returns {"physical"|"magical"|"both"|""}   Blank for a unit without any rank
 */
export function bestRankOf(ranks, { order = Object.keys(FEO.ranks), categories = FEO.weaponCategories } = {}) {
  const best = { physical: 0, magical: 0 };
  for ( const [key, rank] of Object.entries(ranks ?? {}) ) {
    const side = (categories[key]?.magic || (key === "staff")) ? "magical" : "physical";
    best[side] = Math.max(best[side], order.indexOf(rank));
  }
  if ( !best.physical && !best.magical ) return "";
  return (best.physical === best.magical) ? "both" : (best.physical > best.magical) ? "physical" : "magical";
}

/* -------------------------------------------- */
/*  Reading Numbers                             */
/* -------------------------------------------- */

/**
 * A unit's level counted from its last promotion: 1 to 20 in each tier, so that level 26 is the 6th level of
 * a promoted class.
 * @param {number} [level]
 * @param {number[]} [levels]     FEO.promotionLevels
 * @returns {number}
 */
export function levelInTier(level = 1, levels = FEO.promotionLevels) {
  const whole = Math.max(level ?? 1, 1);
  return whole - Math.max(0, ...levels.filter((at) => whole > at));
}

/**
 * Something a number can be read from.
 * @param {string} source
 * @param {SkillSelf} self
 * @param {SkillFight|null} fight
 * @returns {number}
 */
function readSource(source, self, fight) {
  if ( source?.startsWith?.("foe:") ) return fight?.foe.stats?.[source.slice(4)] ?? 0;
  if ( source?.startsWith?.("combat:") ) return self.combat?.[source.slice(7)] ?? 0;
  if ( source?.startsWith?.("check:") ) return self.checks?.[source.slice(6)] ?? 0;

  // The turn of the battle, and the turns that are over since the map began
  if ( CLOCK_SOURCES.includes(source) ) return readClock(source, self.clock ?? null);

  // What the unit has more of a stat than its foe
  if ( source?.startsWith?.("lead:") ) return fight ? Math.max((self.stats?.[source.slice(5)] ?? 0) - (fight.foe.stats?.[source.slice(5)] ?? 0), 0) : 0;
  switch ( source ) {
    case "hp": return Math.max(self.hp ?? 0, 0);
    case "hpMax": return Math.max(self.hpMax ?? 0, 0);
    case "healed": return Math.max(self.healed ?? 0, 0);
    case "foeHpMax": return Math.max(fight?.foe.hpMax ?? 0, 0);
    case "attack": return self.combat?.damage ?? self.attack ?? 0;
    case "foeAttack": return fight?.foe.attack ?? 0;
    case "level": return self.level ?? 1;
    case "classLevel": return levelInTier(self.level);
    case "tier": return Math.max(tierOf(self), 1);
    case "tiersBelow": return fight ? Math.max(tierOf(self) - tierOf(fight.foe), 0) : 0;
    case "tiersAbove": return fight ? Math.max(tierOf(fight.foe) - tierOf(self), 0) : 0;
    case "raises": return Math.max(self.raises ?? 0, 0);
    case "gold": return Math.max(self.gold ?? 0, 0);
    case "defOrRes": return Math.max(self.stats?.def ?? 0, self.stats?.res ?? 0);
    case "levelsApart": return Math.max(Math.abs((self.level ?? 1) - (fight?.foe.level ?? self.level ?? 1)), 1);
    case "weaponWeight": return self.weapon?.weight ?? 0;
    case "weaponMight": return self.weapon?.might ?? 0;
    case "weaponHit": return self.weapon?.hit ?? 0;

    // Its Constitution over the Weight of the weapon in hand, the weapons it carries and cannot wield, and the
    // stats of its foe that are lowered: how many, and by how much in all
    case "conOverWeight": return self.weapon ? Math.max((self.stats?.con ?? 0) - (self.weapon.weight ?? 0), 0) : 0;
    case "unusable": return Math.max(self.unusable ?? 0, 0);
    case "foeDebuffs": return Math.max(fight?.foeDebuffs?.count ?? 0, 0);
    case "foeDebuffSum": return Math.max(fight?.foeDebuffs?.sum ?? 0, 0);
    case "hpMissing": return Math.max((self.hpMax ?? 0) - (self.hp ?? 0), 0);
    case "hpMissingPercent": return self.hpMax > 0 ? Math.max(((self.hpMax - self.hp) / self.hpMax) * 100, 0) : 0;
    case "accuracyOver100": return Math.max((self.accuracy ?? 0) - 100, 0);
    case "distanceBeyond1": return Math.max((fight?.distance ?? 1) - 1, 0);
    case "spacesMoved": return Math.max(self.move?.spaces ?? 0, 0);
    case "movLeft": return Math.max(self.move?.left ?? 0, 0);
    case "cantoSpaces": return Math.max(self.move?.canto ?? 0, 0);
    case "weight": return Math.max(self.weight ?? 0, 0);
    case "foeWeaponMight": return fight?.foe.weapon?.might ?? 0;
    case "foeWeaponHit": return fight?.foe.weapon?.hit ?? 0;
    case "foeWeaponCrit": return fight?.foe.weapon?.crit ?? 0;

    // What the Shield the unit has equipped takes off a physical attack from next to it
    case "shieldBlock": return Math.max(self.shieldBlock ?? 0, 0);

    // The stat the weapon in hand adds to its Might: Strength, unless the weapon says another
    case "weaponStat": return self.stats?.[self.weapon?.damageStat ?? "str"] ?? 0;

    // The other of Strength and Magic than the one the weapon in hand adds to its Might
    case "offStat": {
      const added = self.weapon?.damageStat ?? "str";
      return (added === "str") ? (self.stats?.mag ?? 0) : (added === "mag") ? (self.stats?.str ?? 0) : 0;
    }
    default: return self.stats?.[source] ?? 0;
  }
}

/* -------------------------------------------- */

/**
 * Work out a number an effect gives: a plain number, or one read from the unit.
 * `{ of, base, times, div, per, max, round }`: the source (its base value when `base` is set; several sources
 * added up when `of` is a list, or the highest of them with `best`; with `count`, the number of units around
 * the unit that it names), with `less` taken off, divided by
 * `div`, or counted in whole steps of `per`, then multiplied by `times`, rounded down (up with `round: "up"`),
 * with `plus` added and held at `max`, and at `min` where one is given.
 * @param {number|object} value
 * @param {SkillSelf} self
 * @param {SkillFight|null} [fight]
 * @returns {number}
 */
export function readNumber(value, self, fight = null) {
  if ( typeof value === "number" ) return value;
  if ( !value || (typeof value !== "object") ) return 0;
  let amount;
  if ( value.count ) amount = countNear(self.near ?? null, value.count) ?? 0;
  else if ( value.base ) amount = self.base?.[value.of] ?? 0;
  else if ( Array.isArray(value.of) && value.best ) amount = Math.max(...value.of.map((source) => readSource(source, self, fight)), 0);
  else if ( Array.isArray(value.of) ) amount = value.of.reduce((sum, source) => sum + readSource(source, self, fight), 0);
  else amount = readSource(value.of, self, fight);
  if ( value.less ) amount -= value.less;
  if ( value.per ) amount = Math.floor(amount / value.per);
  if ( value.div ) amount /= value.div;
  amount *= value.times ?? 1;
  amount = ((value.round === "up") ? Math.ceil(amount - 1e-9) : Math.floor(amount)) + (value.plus ?? 0);
  if ( value.max != null ) amount = Math.min(amount, value.max);
  return (value.min != null) ? Math.max(amount, value.min) : amount;
}

/* -------------------------------------------- */

/**
 * Work out the numbers that are to be read from the unit that gives something to another: every number
 * marked `giver: true` among the parts given, however deep.
 * @param {*} value                   An effect, a part of one, or a list of them
 * @param {SkillSelf|(() => SkillSelf)} giver     The unit that gives it, or what describes it when asked
 * @returns {*}                       The same with those numbers worked out
 */
export function resolveGiven(value, giver) {
  if ( Array.isArray(value) ) return value.map((entry) => resolveGiven(entry, giver));
  if ( !value || (typeof value !== "object") ) return value;
  if ( value.giver ) {
    const { giver: marked, ...number } = value;
    return readNumber(number, (typeof giver === "function") ? giver() : giver, null);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveGiven(entry, giver)]));
}

/* -------------------------------------------- */

/**
 * Does a lasting change have a number that is read from the hit that grants it: its damage, what an effect took
 * off it, or what it dealt in the end?
 * @param {*} value       A `grant`, a part of one, or a list of them
 * @param {string[]} [sources]    Which of those are asked about; all of them unless given
 * @returns {boolean}
 */
export function readsDealt(value, sources = HIT_SOURCES) {
  if ( Array.isArray(value) ) return value.some((entry) => readsDealt(entry, sources));
  if ( !value || (typeof value !== "object") ) return false;
  return sources.includes(value.of) || Object.values(value).some((entry) => readsDealt(entry, sources));
}

/* -------------------------------------------- */

/**
 * Work out the numbers that are read from the damage a hit dealt: `{ of: "dealt", cap, div, times }` is that
 * damage, held at `cap`, divided, multiplied and rounded towards zero.
 * For a hit its unit took, `{ of: "negated" }` is what the effect took off it and `{ of: "taken" }` the damage
 * it dealt in the end.
 * @param {*} value           The effects of a lasting change, a part of them, or a list
 * @param {number|{dealt?: number, negated?: number, taken?: number}} dealt
 *                            The damage the hit dealt, or what each source comes to
 * @returns {*}               The same with those numbers worked out
 */
export function resolveDealt(value, dealt) {
  if ( Array.isArray(value) ) return value.map((entry) => resolveDealt(entry, dealt));
  if ( !value || (typeof value !== "object") ) return value;
  if ( HIT_SOURCES.includes(value.of) ) {
    const read = (typeof dealt === "number") ? ((value.of === "dealt") ? dealt : 0) : (dealt?.[value.of] ?? 0);
    const amount = (Math.min(Math.max(read, 0), value.cap ?? Infinity) / (value.div ?? 1)) * (value.times ?? 1);
    return Math.trunc(amount + (Math.sign(amount) * 1e-9));
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveDealt(entry, dealt)]));
}

/* -------------------------------------------- */
/*  Gathering Effects                           */
/* -------------------------------------------- */

/**
 * @typedef SkillTotals
 * What a unit's skills add up to.
 * @property {{name: string, stats?: object, combat?: object}[]} sources    What each skill adds to stats and
 *                                                                          combat stats, for the breakdowns
 * @property {Record<string, number>} stats
 * @property {Record<string, number>} abilities   Added to Charm and Intelligence
 * @property {Record<string, number>} combat      Including `activation`
 * @property {number} might
 * @property {number} taken
 * @property {number} takenMultiplier             What the damage of hits the unit takes is multiplied by
 * @property {number} foeActivation               Added to the Skill Activation rate of a foe in a fight
 * @property {number} haste                       Counted as Attack Speed for the unit's own follow-up attack
 * @property {number} critFloor                   The least the chance of its attacks to be critical hits is
 * @property {number} mirrorCrit                  The most Critical the unit gains for its own chance of being
 *                                                critically hit
 * @property {number|null} critMultiplier         What the damage of its critical hits is multiplied by, when a
 *                                                skill says so
 * @property {number} slots                       More skills it may have equipped at once
 * @property {number} capacity                    More Capacity Points
 * @property {number} artCost                     Added to each cost of the Combat Arts it performs
 * @property {number} hpMax
 * @property {Record<string, string>} calc
 * @property {{skill: string, stats: Record<string, number>}[]} foeStats
 *                                                What each skill adds to the stats the foe fights with
 * @property {Set<string>} rules
 * @property {string[]} effective
 * @property {number|null} effectiveMultiplier
 * @property {number|null} effectiveTaken         The most an attack that is effective against the unit
 *                                                multiplies the Might of its weapon by; null for no limit
 * @property {number} damageMultiplier
 * @property {number} ignoreDefence               A share, in percent
 * @property {number} strikes
 * @property {{name: string, percent: number}[]} extraAttacks
 * @property {{skill: string, effect: object}[]} procs    The effects that have a chance to activate, as written
 * @property {{id?: string, name: string}[]} declared     The declared skills that had a say, which a fight spends
 * @property {string[]} applied                   The names of the skills that did something worth telling:
 *                                                an effect with a condition, or one that bends a rule. A boost
 *                                                that is simply always there is not listed
 * @property {string[]} auras                     The auras of units around that changed the unit's numbers,
 *                                                each named with its skill and the unit that gives it
 * @property {string[]} lasting                   The changes that last a while which changed the unit's
 *                                                numbers, each named with its skill and where it comes from
 * @property {{skill: string, unseen: boolean}[]} checks
 *                                                The skills with an effect that is shown and not applied, for
 *                                                the table to check: `unseen` when that is because the unit
 *                                                is not on the map
 * @property {{add?: number, min?: number, max?: number}[]} ranges
 *                                                What changes how far the weapon in hand attacks
 * @property {string|null} damageStat             The stat added to the weapon's Might, when a skill names one
 * @property {{hit: number, noDamage: number}} foeWear
 *                                                Uses a foe's weapon loses on top for each hit on the unit
 * @property {number} wield                       Weapon ranks above its own the unit may wield
 * @property {import("./conditions.mjs").ConditionBends} bends
 *                                                How the unit's skills bend the rules of conditions
 * @property {number} endurance                   The END its skills give it, which `taken` already counts
 * @property {import("./choices.mjs").TradeEntry[]} trades    One combat number traded for another
 * @property {{skill: string, spend: object, steps: number|null}[]} spends    What it spends for damage
 * @property {{skill: string, hit?: number, critical?: number, damagePercent?: number, stat?: string[]}|null} single
 *                                                What it gains for one attack in place of several
 * @property {boolean} noWeight                   Do its weapon and Shield weigh nothing for Attack Speed?
 * @property {"def"|"res"|"lower"|null} against   What resists its attacks, when a skill says so
 * @property {number|null} hitCap                 The share of its maximum HP a hit takes off it at most
 * @property {string[]} cappers                   The skills that say so
 * @property {{skill: string, stats: string[], times: number}[]} foeBonus
 *                                                What becomes of the bonuses of the foe to its stats
 * @property {number} cooldowns                   Turns added to the cooldown of every skill it uses
 * @property {string[]} stopped                   Its skills that are chosen when to activate and that a skill of
 *                                                its foe stopped in this fight
 */

/**
 * Nothing bent about the rules of conditions.
 * @returns {import("./conditions.mjs").ConditionBends}
 */
export function emptyBends() {
  return {
    inflictChance: {}, inflictTurns: {}, nullify: [], suffers: {}, recovery: 1,
    debuffs: { stats: 0, combat: 0, negate: false, turn: false, skills: [] }, burstHarm: {}
  };
}

/* -------------------------------------------- */

/**
 * How a unit's skills bend the rules of conditions: what they add to the chances and the turns of those it
 * inflicts, what may nullify those that would be applied to it, what those it suffers from do to it, how fast
 * they run out, and what is taken off the penalties put on it. Read from the effects that are always there and
 * whose condition holds. What is taken off penalties is the unit's own to give: neither an aura nor a change
 * from another unit grants it.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @param {object} [options]
 * @param {SkillFight|null} [options.fight]
 * @param {boolean} [options.foeNihil]      Does the foe cancel the skills that Nihil cancels?
 * @returns {import("./conditions.mjs").ConditionBends}
 */
export function conditionBends(skills, self, { fight = null, foeNihil = false } = {}) {
  self = withSkillNames(self, skills, foeNihil);
  const bends = emptyBends();
  const note = (list, name) => {
    if ( !list.includes(name) ) list.push(name);
  };
  for ( const skill of skills ?? [] ) {
    if ( foeNihil && skill.nihil ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.proc || effect.aura || !BEND_KEYS.some((key) => effect[key] !== undefined) ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(effect.when, self, fight) ) continue;
      for ( const [id, amount] of Object.entries(effect.inflictChance ?? {}) ) bends.inflictChance[id] = (bends.inflictChance[id] ?? 0) + amount;
      for ( const [id, amount] of Object.entries(effect.inflictTurns ?? {}) ) bends.inflictTurns[id] = (bends.inflictTurns[id] ?? 0) + amount;
      if ( effect.nullify !== undefined ) {
        const ward = (typeof effect.nullify === "number") ? { percent: effect.nullify } : (effect.nullify ?? {});
        bends.nullify.push({ skill: skill.name, percent: ward.percent ?? 0, ...(ward.only ? { only: ward.only } : {}) });
      }
      for ( const [id, bend] of Object.entries(effect.suffers ?? {}) ) {
        const into = (bends.suffers[id] ??= { damage: 1, penalties: 1, tick: 0, stays: false, burst: null, damageBy: [], penaltiesBy: [] });
        into.damage *= bend.damage ?? 1;
        into.penalties *= bend.penalties ?? 1;
        into.tick += bend.tick ?? 0;
        into.stays ||= !!bend.stays;
        if ( bend.burst ) into.burst ??= skill.name;
        if ( ((bend.damage ?? 1) !== 1) || bend.tick ) note(into.damageBy, skill.name);
        if ( (bend.penalties ?? 1) !== 1 ) note(into.penaltiesBy, skill.name);
      }
      if ( effect.recovery > bends.recovery ) Object.assign(bends, { recovery: effect.recovery, recoveryBy: skill.name });
      // What takes penalties off may come with a change an ally left on the unit, where that change says so
      if ( effect.debuffs && !skill.aura && (!skill.foreign || effect.debuffs.lent) ) {
        bends.debuffs.stats += effect.debuffs.stats ?? 0;
        bends.debuffs.combat += effect.debuffs.combat ?? 0;
        bends.debuffs.negate ||= !!effect.debuffs.negate;
        bends.debuffs.turn ||= !!effect.debuffs.turn;
        note(bends.debuffs.skills, skill.name);
      }
      for ( const id of effect.burstHarm ?? [] ) bends.burstHarm[id] ??= skill.name;
    }
  }
  return bends;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of the penalties of the conditions it suffers from, as what they add back to the
 * numbers the conditions lower: a penalty multiplied as a skill says, then lessened by what is taken off
 * incoming penalties. One source for each condition that is bent, named after the skills that bend it.
 * @param {import("./conditions.mjs").ConditionBends} bends
 * @param {Record<string, number>} [conditions]     The unit's conditions and the turns each has left
 * @returns {{name: string, stats: Record<string, number>, combat: Record<string, number>, skills: string[]}[]}
 */
export function sufferedSources(bends, conditions) {
  const sources = [];
  for ( const { id, stats, combat } of conditionModifiers(conditions ?? {}) ) {
    const bend = bends.suffers[id];
    const factor = bend?.penalties ?? 1;
    const skills = [];
    const note = (list) => {
      for ( const name of list ?? [] ) if ( !skills.includes(name) ) skills.push(name);
    };

    // What a penalty becomes, less what it was. A share of a penalty is rounded down, the usual way
    const change = (kind, amount) => {
      if ( !(amount < 0) ) return 0;
      let now = amount;
      if ( factor !== 1 ) {
        const share = Math.floor((-amount * Math.abs(factor)) + 1e-9);
        now = (factor < 0) ? share : -share;
        note(bend.penaltiesBy);
      }
      if ( now < 0 ) {
        // A penalty to a stat that is turned around is a bonus of that size
        const less = (bends.debuffs.turn && (kind === "stats")) ? (-now * 2) : bends.debuffs.negate ? -now : Math.min(bends.debuffs[kind] ?? 0, -now);
        if ( less > 0 ) {
          now += less;
          note(bends.debuffs.skills);
        }
      }
      return now - amount;
    };
    const source = { name: "", stats: {}, combat: {}, skills };
    for ( const [key, amount] of Object.entries(stats ?? {}) ) {
      const more = change("stats", amount);
      if ( more ) source.stats[key] = more;
    }
    for ( const [key, amount] of Object.entries(combat ?? {}) ) {
      const more = change("combat", amount);
      if ( more ) source.combat[key] = more;
    }
    if ( !Object.keys(source.stats).length && !Object.keys(source.combat).length ) continue;
    source.name = skills.join(", ");
    sources.push(source);
  }
  return sources;
}

/**
 * An empty set of totals.
 * @returns {SkillTotals}
 */
export function emptyTotals() {
  return {
    sources: [], stats: {}, abilities: {}, combat: {}, might: 0, taken: 0, takenMultiplier: 1, foeActivation: 0, hpMax: 0, calc: {}, rules: new Set(), assured: new Set(),
    haste: 0, mirrorCrit: 0, critFloor: 0, critMultiplier: null, slots: 0, capacity: 0, artCost: 0, firstMight: 0, firstAttack: { hit: 0, critical: 0, damage: 0 }, firstBy: [], scalers: [],
    effective: [], effectiveMultiplier: null, damageMultiplier: 1, ignoreDefence: 0, strikes: 1, extraAttacks: [],
    procs: [], declared: [], applied: [], auras: [], lasting: [], checks: [], foeStats: [],
    ranges: [], damageStat: null, foeWear: { hit: 0, noDamage: 0 }, wield: 0, bends: emptyBends(),
    block: emptyBlock(), weaponUse: { first: [], last: [] },

    // What the unit chose before the fight (see `choices.mjs`)
    endurance: 0, trades: [], spends: [], single: null, noWeight: false, against: null, hitCap: null, cappers: [], foeBonus: [], ownBonus: [], cooldowns: 0,
    stopped: [],

    // What the unit gains for the Attack Speed it has over a foe it follows up on (see `rounds.mjs`)
    speedLead: [],

    // What the unit's skills make of the weapon triangle, and what its weapon takes from the one it attacked
    // with before (see `triangle.mjs`); `hands` is whether any of its skills has a weapon do so, whatever it
    // holds now
    triangle: [], handovers: [], hands: false,

    // The skills that are chosen when to activate which the unit chose for this fight, and those of them a
    // skill of its foe brought to nothing (see `answers.mjs`)
    chose: [], foiled: [],

    // What an attack deals and to whom: the Special Qualities no attack is effective against its unit for, the
    // combat stats that are multiplied once everything is added, what is added to the combat stats of its foe,
    // the share of a hit its unit deals again as damage of an element, what counts from the moment its foe
    // loses its counter-attack in the middle of the fight, and the stats of the unit that something outside
    // of it lowers, by how much each
    uneffective: [], effectiveTaken: null, combatTimes: [], foeCombat: [], echoes: [], denied: [], lowered: {},

    // The stats that are multiplied once everything is added to them: by the unit's own skills, and by what
    // comes from outside of it, with the skills that do so; and the parts of a fight its effects last until
    statTimes: { own: {}, incoming: {}, by: {} }, lapses: [],

    // What its skills add to the damage of every hit it takes, each under its name, and the skills that have
    // it take a share more or less, for the sums behind a forecast
    takenBy: [], takers: []
  };
}

/* -------------------------------------------- */

/**
 * What multiplying stats comes to once everything else is added to them: each stat a skill multiplies is
 * multiplied and rounded down, first by what the unit's own skills say, then by what comes from outside of it,
 * which is eased by what its skills take off incoming penalties.
 * @param {Record<string, number>} stats      The stats with everything added
 * @param {{own: Record<string, number>, incoming: Record<string, number>, by: Record<string, string[]>}} [times]
 *                                            What multiplies them, as `skillTotals` adds it up
 * @param {{stats?: number, negate?: boolean}|null} [relief]    What the unit's skills take off incoming penalties
 * @returns {{stats: Record<string, number>, change: Record<string, number>, lowered: Record<string, number>,
 *   names: string[]}}    The stats as they then stand, what each changed by, what of that came from outside
 *                        of the unit and lowers it, and the skills that had a part in it
 */
export function multiplyStats(stats, times = null, relief = null) {
  const out = { ...(stats ?? {}) };
  const change = {};
  const lowered = {};
  const names = [];
  const floor = (value) => Math.max(Math.floor(value + 1e-9), 0);
  for ( const key of new Set([...Object.keys(times?.own ?? {}), ...Object.keys(times?.incoming ?? {})]) ) {
    const before = out[key] ?? 0;
    let after = floor(before * (times.own?.[key] ?? 1));
    let less = floor(after * (times.incoming?.[key] ?? 1)) - after;
    if ( (less < 0) && relief ) less = relief.negate ? 0 : Math.min(less + (relief.stats ?? 0), 0);
    after += less;
    if ( after === before ) continue;
    out[key] = after;
    change[key] = after - before;
    if ( less < 0 ) lowered[key] = less;
    for ( const name of times.by?.[key] ?? [] ) if ( !names.includes(name) ) names.push(name);
  }
  return { stats: out, change, lowered, names };
}

/* -------------------------------------------- */

/**
 * Work out the numbers of an effect that are read from its own skill: `{ of: "raises" }`, how many times the
 * skill has been raised.
 * @param {*} value           An effect, a part of one, or a list of them
 * @param {number} raises
 * @returns {*}
 */
function resolveOwn(value, raises) {
  if ( Array.isArray(value) ) return value.map((entry) => resolveOwn(entry, raises));
  if ( !value || (typeof value !== "object") ) return value;
  if ( value.of === "raises" ) return readNumber(value, { raises }, null);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveOwn(entry, raises)]));
}

/**
 * Can a skill be raised: does any of its numbers read how many times it has been?
 * @param {*} value       The skill's effects, a part of them, or a list
 * @returns {boolean}
 */
export function readsRaises(value) {
  if ( Array.isArray(value) ) return value.some(readsRaises);
  if ( !value || (typeof value !== "object") ) return false;
  return (value.of === "raises") || Object.values(value).some(readsRaises);
}

/* -------------------------------------------- */

/**
 * The effects of a skill as the rules read them: its structured effects that match what is picked on it, with
 * the flat boosts typed on the skill itself as one more effect that always applies.
 * @param {object} skill      Skill data: effects, choice, stats, combat, raises, `early` for one that
 *                            was used before its cooldown was over, and `over` for one that is used beyond
 *                            the uses it has
 * @returns {object[]}
 */
export function effectsOf(skill) {
  const chosen = chosenOf(skill);
  let effects = (skill.effects ?? []).filter((effect) => !effect.choice || chosen.includes(effect.choice));

  // What a skill does when it is used early, or only when it is not
  const early = !!(skill.early ?? skill.state?.early);
  effects = effects.filter((effect) => (typeof effect.when?.early !== "boolean") || (effect.when.early === early));

  // And what a skill does when it is used beyond the uses it has, where it may be (see `skill-usage.mjs`)
  const over = !!skill.over;
  effects = effects.filter((effect) => (typeof effect.when?.over !== "boolean") || (effect.when.over === over));

  // A skill that has been raised has the numbers read from that worked out here; one that has not reads 0
  if ( skill.raises > 0 ) effects = resolveOwn(effects, skill.raises);
  const nonZero = (object) => Object.fromEntries(Object.entries(object ?? {}).filter(([, value]) => value));
  const stats = nonZero(skill.stats);
  const combat = nonZero(skill.combat);
  if ( Object.keys(stats).length || Object.keys(combat).length ) effects.unshift({ stats, combat });
  return effects;
}

/* -------------------------------------------- */

/**
 * The variants a skill offers, read from its effects.
 * @param {object[]} [effects]
 * @returns {string[]}
 */
export function choicesOf(effects = []) {
  return variantsOf(effects);
}

/* -------------------------------------------- */

/**
 * The Special Qualities a skill lets its unit take on and put off at will, read from its effects, and whether
 * the unit has each of them now.
 * @param {object[]} [effects]
 * @param {string} [qualities]    The unit's Special Qualities, as free text
 * @returns {{name: string, on: boolean}[]}
 */
export function formsOf(effects = [], qualities = "") {
  const names = effects.filter((effect) => effect?.form).flatMap((effect) => effect.when?.quality ?? []);
  return [...new Set(names)].map((name) => ({ name, on: hasQuality(qualities, name) }));
}

/* -------------------------------------------- */

/**
 * A unit's Special Qualities once it takes one on that it has not, or puts off one that it has.
 * @param {string} [qualities]    The unit's Special Qualities, as free text
 * @param {string} quality
 * @returns {string}
 */
export function switchForm(qualities, quality) {
  const parts = String(qualities ?? "").split(/[,;\n]/).map((part) => part.trim());
  const kept = (part) => part && !/^(none|n\/?a|-+|–|—)$/i.test(part);
  if ( !hasQuality(qualities, quality) ) return [...parts.filter(kept), quality].join(", ");

  // The quality may stand beside another in one part, as in "Mounted/Flying"
  const escaped = quality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^a-z])${escaped}(?=[^a-z]|$)`, "ig");
  return parts.map((part) => {
    return part.replace(word, "$1").replace(/\s*([/&])[\s/&]*/g, "$1").replace(/^[\s/&]+|[\s/&]+$/g, "").replace(/\s{2,}/g, " ");
  }).filter(kept).join(", ");
}

/* -------------------------------------------- */

/**
 * Add up what a unit's skills do.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @param {object} [options]
 * @param {SkillFight|null} [options.fight]       The fight the unit is in, if any
 * @param {boolean} [options.foeNihil]            Does the foe cancel the skills that Nihil cancels?
 * @param {"early"|"late"|"all"} [options.phase]  Which effects to read: those that do not wait for the
 *                                                counter-attacks to be settled, those that do, or all
 * @param {SkillTotals} [options.into]            Totals to add to
 * @param {boolean} [options.parity]              Is what skills do cancelled in this fight, as Parity has it?
 *                                                Only what was declared before it, what comes once it is over
 *                                                and what is no skill at all is then read
 * @param {string[]|null} [options.foiled]        The skills the unit chose for this fight that a skill of its
 *                                                foe brought to nothing (see `answers.mjs`): what waits for
 *                                                them to be switched on, and their moments, are not read; the
 *                                                fight spends them all the same
 * @returns {SkillTotals}
 */
export function skillTotals(skills, self, { fight = null, foeNihil = false, phase = "all", into = null, parity = false, foiled = null, lapsed = null } = {}) {
  self = withSkillNames(self, skills, foeNihil);
  const totals = into ?? emptyTotals();
  const add = (target, key, amount) => {
    if ( amount ) target[key] = (target[key] ?? 0) + amount;
  };
  const check = (name, unseen) => {
    const noted = totals.checks.find((entry) => entry.skill === name);
    if ( noted ) noted.unseen ||= unseen;
    else totals.checks.push({ skill: name, unseen });
  };

  // How the skills bend the rules of conditions is read first: what they take off incoming penalties is
  // needed as the rest is read. What they make of the penalties of the unit's own conditions is added to its
  // numbers like any other skill effect
  if ( !into ) {
    totals.bends = conditionBends(parity ? (skills ?? []).filter((skill) => (skill.innate && !skill.gear) || skill.art) : skills, self, { fight, foeNihil });
    for ( const { skills: names, ...source } of sufferedSources(totals.bends, self.conditions) ) {
      for ( const [key, amount] of Object.entries(source.stats) ) add(totals.stats, key, amount);
      for ( const [key, amount] of Object.entries(source.combat) ) add(totals.combat, key, amount);
      totals.sources.push(source);
      for ( const name of names ) if ( !totals.applied.includes(name) ) totals.applied.push(name);
    }
  }

  // Is the unit one that no enemy keeps from moving, as one of its own skills has it?
  const unforced = (skills ?? []).some((skill) => {
    if ( skill.aura || skill.timed || (foeNihil && skill.nihil) ) return false;
    return (skill.effects ?? []).some((effect) => effect.rules?.includes(UNFORCED) && !effect.proc && !effect.aura && holds(withoutMove(withoutPlace(effect.when)), self, null));
  });

  for ( const skill of skills ?? [] ) {
    // A unit one of whose skills has a weapon take something from the one used before keeps track of what
    // it attacks with, whatever it holds now and whatever cancels the skill in this fight
    if ( !skill.aura && !skill.timed && (skill.effects ?? []).some((effect) => effect.handover) ) totals.hands = true;
    if ( foeNihil && skill.nihil ) continue;

    // A skill that takes effect by itself and counts its uses does nothing once they are spent
    const left = (skill.usage?.kind === "auto") ? usesLeft(skill.usage, skill.state) : undefined;
    if ( left === 0 ) continue;
    const source = { name: skill.name, stats: {}, combat: {} };
    let applied = false;
    let notable = false;

    // A penalty that comes from elsewhere, an aura or a change another unit left on this one, is lessened by
    // what the unit's skills take off incoming penalties
    const incoming = !!(skill.aura || skill.foreign);
    const ease = (kind, amount) => {
      const relief = totals.bends?.debuffs;
      if ( !incoming || !relief || !(amount < 0) ) return amount;
      const eased = (relief.turn && (kind === "stats")) ? -amount : relief.negate ? 0 : Math.min(amount + (relief[kind] ?? 0), 0);
      if ( eased !== amount ) for ( const name of relief.skills ) if ( !totals.applied.includes(name) ) totals.applied.push(name);
      return eased;
    };

    // Where skills are cancelled in the fight, only what is no skill, aura or lasting change is read whole
    // What gear gives is cancelled with them: Parity cancels weapons and equipment as it does skills
    const cancelled = parity && (!skill.innate || skill.gear) && !skill.art;
    for ( const effect of skill.effects ?? [] ) {
      const late = isLate(effect.when);
      if ( (phase === "early") && late ) continue;
      if ( (phase === "late") && !late ) continue;

      // An effect of a skill that is chosen when to activate waits for the skill to be switched on
      if ( effect.when?.declared && !skill.active ) continue;

      // One that is only for the fight that spends its skill, or only for those the skill lasts into
      if ( (typeof effect.when?.lasting === "boolean") && (((skill.state?.lasting ?? 0) > 0) !== effect.when.lasting) ) continue;

      // What a change that lasts on the unit does against every unit but the one it comes from, or only against it
      if ( (typeof effect.when?.foeGiver === "boolean") && fight ) {
        const same = !!skill.from && (skill.from === (fight.foe?.name ?? ""));
        if ( same !== effect.when.foeGiver ) continue;
      }

      // Of a skill that is cancelled in the fight, what was declared before it stays, and what comes after it
      if ( cancelled && !effect.when?.declared && !(effect.proc && LATE_MOMENTS.includes(effect.proc.on)) ) continue;

      // What hangs on where units stand cannot be judged for a unit that is not on the map: the skill is
      // shown as one to check by hand. Only what an aura gives its own unit applies all the same
      // A moment that only reaches for the units around with what it grants still comes: its unit's own share
      // is given, and the rest is announced when the moment does
      const placed = needsPlace(effect);
      const reaching = !!effect.proc && !effect.aura && !effect.reach && !asksPlace(effect.when) && !placeCounts(effect).length;
      if ( placed && !reaching && !seesPlace(effect, self, fight) ) {
        if ( holds(withoutPlace(effect.when), self, fight) ) check(skill.name, true);
        if ( !effect.aura?.self ) continue;
      }

      // Nor can what hangs on how the unit moved be judged for one that is not in a battle on the map
      if ( !self.move && needsMove(effect) ) {
        if ( !effect.proc && holds(withoutMove(withoutPlace(effect.when)), self, fight) ) check(skill.name, !self.near);
        continue;
      }
      // Nor can what hangs on the turn of the battle or on the Phase that is running, outside of a battle
      if ( !self.clock && needsClock(effect) ) {
        if ( !effect.proc && holds(withoutClock(withoutMove(withoutPlace(effect.when))), self, fight) ) check(skill.name, false);
        continue;
      }
      // What lasts only a part of a fight is over once that part is
      if ( effect.until && !effect.proc ) {
        if ( lapsed?.includes(effect.until) ) continue;
        if ( fight && holds(effect.when, self, fight) && !totals.lapses.includes(effect.until) ) totals.lapses.push(effect.until);
      }
      if ( !holds(effect.when, self, fight) ) {
        // What is for a foe that is kept from its counter-attack waits, against one that makes it, for that to
        // be taken from it in the middle of the fight: what it adds to Hit, damage and Critical counts from then
        const waits = effect.when?.foeDenied && !effect.proc && !effect.aura && fight && (fight.foeCounters === true) && effect.combat
          && holds({ ...effect.when, foeDenied: undefined }, self, fight);
        if ( waits ) {
          const combat = Object.fromEntries(["hit", "damage", "critical"].map((key) => [key, readNumber(effect.combat[key] ?? 0, self, fight)]));
          if ( Object.values(combat).some(Boolean) ) totals.denied.push({ skill: skill.name, combat });
        }
        continue;
      }

      // What an aura gives is for the units around, which receive it as an effect of their own
      if ( effect.aura && !effect.aura.self ) continue;

      // A foe that cancels skills, as Nihil does, stops what a skill that is chosen when to activate does in
      // the fight: what waits for it to be switched on, and its moments. The skill is not spent
      // What is no skill of its unit, as the effect of its Affinity, is left as it is
      if ( foeNihil && fight && !skill.aura && !skill.timed && !skill.innate && (effect.when?.declared || (effect.proc && skill.chosen)) ) {
        if ( !totals.stopped.includes(skill.name) ) totals.stopped.push(skill.name);
        continue;
      }

      // A skill that is chosen when to activate and does something in this fight is one the unit chose for it,
      // which a skill of its foe may bring to nothing. One that was is spent, and does nothing
      const chose = !!fight && !!skill.chosen && !skill.aura && !skill.timed && (!!effect.when?.declared || !!effect.proc);
      if ( chose && effect.when?.declared && !totals.chose.includes(skill.name) ) totals.chose.push(skill.name);
      if ( chose && foiled?.includes(skill.name) ) {
        if ( effect.when?.declared && skill.spends && !totals.declared.some((other) => other.name === skill.name) ) {
          totals.declared.push({ id: skill.id, name: skill.name, waits: false, attacks: false });
        }
        if ( !totals.foiled.includes(skill.name) ) totals.foiled.push(skill.name);
        continue;
      }

      // What hangs on something the system cannot see at all is shown, not applied
      if ( (effect.remind === "check") && !effect.proc ) {
        check(skill.name, false);
        continue;
      }

      // A number that counts the units around adds nothing when there are none, unless it is one part of a
      // sum that has a plain number beside it
      const counted = placeCounts(effect);
      const summed = Object.values(effect).some((value) => Array.isArray(value) && value.some((part) => part?.count) && value.some((part) => typeof part === "number"));
      if ( counted.length && !summed && counted.every((filter) => !countNear(self.near ?? null, filter)) ) continue;

      // Nor does one that counts the spaces moved or the MOV left when there are none
      const walked = effect.proc ? [] : moveNumbers(effect);
      if ( walked.length && walked.every((value) => !readNumber(value, self, fight)) ) continue;
      // What only has a weapon reach further does nothing in a fight the weapon reaches by itself: such a
      // fight does not spend a skill that is switched on for it
      const idleReach = !!effect.weaponRange && !!fight && !(fight.distance > (self.weapon?.reach?.max ?? Infinity))
        && Object.keys(effect).every((key) => ["weaponRange", "when", "choice"].includes(key));
      if ( effect.when?.declared && skill.spends && !idleReach ) {
        // A skill that waits for a moment to be spent is spent only by a fight in which that came about, and
        // one that only does something for its unit's attacks only by a fight in which its unit attacks
        let entry = totals.declared.find((other) => other.name === skill.name);
        if ( !entry ) {
          entry = { id: skill.id, name: skill.name, waits: true, attacks: true };
          totals.declared.push(entry);
        }
        if ( !effect.proc?.spends ) entry.waits = false;
        if ( !forAttacksOnly(effect) ) entry.attacks = false;
      }

      // An effect with a chance to activate is kept for the fight to roll
      if ( effect.proc ) {
        // One that earns its unit another go has nothing to give once its limit is used up
        // nor has one that hands out a Refresh, once it has as often as it may
        if ( (effect.acts || effect.refreshes) && self.goes?.includes(skill.name) ) continue;

        // What comes from the aura of another unit keeps the name of its skill and of that unit. A skill that
        // counts its own uses says how many it has left
        const counted = (left !== undefined) ? { uses: { id: skill.id ?? null, name: skill.name, left } } : {};

        // An attack made with the weapon that was picked for its skill (see `lending.mjs`) is made with that
        // weapon's numbers; a skill that has none to cast makes no such attack
        const cast = effect.attack?.lent ? { arm: castArm(skill.effects, skill.picked, self.proficiencies) } : {};
        if ( effect.attack?.lent && !cast.arm ) continue;
        totals.procs.push(skill.aura
          ? { skill: skill.name, effect, source: skill.skill, giver: skill.giver, giverId: skill.from ?? null, limit: skill.limit ?? null }
          : { skill: skill.name, effect, chosen: !!skill.chosen, mine: !skill.innate && !skill.art && !skill.timed, ...counted, ...cast });
        continue;
      }

      // What a skill lends its unit is read as the unit picks a weapon (see `skillLends`)
      if ( (effect.lend !== undefined) && Object.keys(effect).every((key) => ["lend", "when", "choice"].includes(key)) ) continue;

      // What a skill changes about how its unit changes form is read ahead of its numbers (see `shifting.mjs`),
      // and gives the skill nothing to tell here
      if ( (effect.shift !== undefined) && Object.keys(effect).every((key) => ["shift", "when", "choice"].includes(key)) ) continue;

      // Where a skill warps its unit to is read when the skill is used (see `warp.mjs`)
      if ( (effect.warp !== undefined) && Object.keys(effect).every((key) => key === "warp") ) continue;

      // So is what it does to a unit picked on the map (see `actions.mjs`), and what it makes of its unit's
      // Shove is read as the unit shoves (see `skillShove`)
      if ( (effect.act !== undefined) && Object.keys(effect).every((key) => ["act", "when"].includes(key)) ) continue;
      if ( (effect.shove !== undefined) && Object.keys(effect).every((key) => ["shove", "when", "choice"].includes(key)) ) continue;

      // And what it makes of carrying a unit is read as the unit picks one up (see `skillCarry`)
      if ( (effect.carry !== undefined) && Object.keys(effect).every((key) => ["carry", "when", "choice"].includes(key)) ) continue;

      // What it changes about its unit's imitation is read as the unit imitates (see `imitation.mjs`)
      if ( (effect.imitation !== undefined) && Object.keys(effect).every((key) => ["imitation", "when", "choice"].includes(key)) ) continue;

      // What it says of the creatures its unit makes is read as one is made (see `creatures.mjs`)
      if ( (effect.creatures !== undefined) && Object.keys(effect).every((key) => ["creatures", "when", "choice"].includes(key)) ) continue;

      // What it lets its unit do with gear and with the things on a map is read by the map and by the Market
      // (see `skillKnacks`)
      if ( KNACK_KEYS.some((key) => effect[key] !== undefined) && Object.keys(effect).every((key) => [...KNACK_KEYS, "when", "choice"].includes(key)) ) continue;

      // What it does for its side outside of its own turn is read by the map (see `skillGuard`, `skillWards`
      // and `skillReacts`)
      if ( STANDING_KEYS.some((key) => effect[key] !== undefined) && Object.keys(effect).every((key) => [...STANDING_KEYS, "when", "choice"].includes(key)) ) continue;

      // And what it makes of Refresh is read as the unit sings (see `skillRefresh`)
      if ( (effect.refresh !== undefined) && Object.keys(effect).every((key) => ["refresh", "when", "choice"].includes(key)) ) continue;

      // How a skill has its unit cross terrain is read by the map (see `skillCrossing`), and so is how it
      // has units stand in each other's way (see `skillPassing`)
      if ( (effect.crossing !== undefined) && Object.keys(effect).every((key) => ["crossing", "when", "choice"].includes(key)) ) continue;
      if ( (effect.passing !== undefined) && Object.keys(effect).every((key) => ["passing", "when", "choice"].includes(key)) ) continue;

      // Whether a skill has its unit move again after an Action, and how it curbs that for its enemies, is
      // read as an Action is taken (see `skillCanto`)
      if ( ((effect.canto !== undefined) || (effect.curbsCanto !== undefined))
        && Object.keys(effect).every((key) => ["canto", "curbsCanto", "when", "choice"].includes(key)) ) continue;

      // What only speaks to staves is read when a staff is used (see `staves.mjs`)
      if ( STAFF_KEYS.some((key) => effect[key] !== undefined) && Object.keys(effect).every((key) => [...STAFF_KEYS, "when", "choice"].includes(key)) ) continue;

      // What a skill adds to every cooldown is read as a skill is spent, and whether its unit may change its
      // weapon before a fight as that fight is about to begin (see `choices.mjs`)
      if ( effect.cooldowns ) totals.cooldowns += readNumber(effect.cooldowns, self, fight);
      if ( QUIET_PARTS.some((key) => effect[key] !== undefined) && Object.keys(effect).every((key) => [...QUIET_PARTS, "when", "choice"].includes(key)) ) continue;
      applied = true;
      notable ||= placed || (Object.keys(effect.when ?? {}).length > 0)
        || NOTABLE.some((key) => {
          if ( (effect[key] === undefined) || (effect[key] === null) ) return false;
          return (key !== "rules") || !effect.rules.every((rule) => QUIET_RULES.includes(rule));
        });
      const scale = effect.scale ? readNumber(effect.scale, self, fight) : 1;
      const number = (value) => readNumber(value, self, fight) * scale;

      for ( const [key, value] of Object.entries(effect.stats ?? {}) ) {
        let amount = ease("stats", number(value));

        // A unit that no enemy keeps from moving loses no MOV to what another unit puts on it
        if ( (key === "mov") && (amount < 0) && incoming && unforced ) amount = 0;
        add(source.stats, key, amount);
        add(totals.stats, key, amount);

        // A stat that something outside of the unit lowers is a stat debuff, for what counts those
        if ( incoming && (amount < 0) ) add(totals.lowered, key, amount);
      }
      for ( const [key, percent] of Object.entries(effect.statPercent ?? {}) ) {
        const amount = ease("stats", Math.floor(((self.stats?.[key] ?? 0) * percent) / 100) * scale);
        add(source.stats, key, amount);
        add(totals.stats, key, amount);
      }

      // A stat that is multiplied once everything is added to it: several multiply together, and one that
      // applies several times over multiplies that often. What comes from outside of the unit is kept apart,
      // for what its skills take off incoming penalties; one that negates them is not lowered at all
      for ( const [key, times] of Object.entries(effect.statTimes ?? {}) ) {
        const by = Math.pow(Math.max(Number(times) || 0, 0), Math.max(scale, 1));
        const lowers = incoming && (by < 1);
        if ( lowers && (totals.bends?.debuffs?.negate || totals.bends?.debuffs?.turn) ) {
          for ( const name of totals.bends.debuffs.skills ?? [] ) if ( !totals.applied.includes(name) ) totals.applied.push(name);
          continue;
        }
        const kept = lowers ? totals.statTimes.incoming : totals.statTimes.own;
        kept[key] = (kept[key] ?? 1) * by;
        const named = (totals.statTimes.by[key] ??= []);
        if ( !named.includes(skill.name) ) named.push(skill.name);
      }
      for ( const [key, value] of Object.entries(effect.combat ?? {}) ) {
        if ( !COMBAT_KEYS.includes(key) ) continue;
        const amount = ease("combat", number(value));
        add(source.combat, key, amount);
        add(totals.combat, key, amount);
      }
      for ( const [key, value] of Object.entries(effect.abilities ?? {}) ) add(totals.abilities, key, number(value));
      if ( effect.might ) {
        add(source.combat, "damage", number(effect.might));
        totals.might += number(effect.might);
      }
      if ( effect.firstMight ) totals.firstMight += number(effect.firstMight);

      // What the first attack its unit makes in a fight gains, and no other
      if ( effect.firstAttack ) {
        for ( const key of ["hit", "critical", "damage"] ) totals.firstAttack[key] += number(effect.firstAttack[key] ?? 0);
      }
      if ( (effect.firstAttack || (effect.firstMight && skill.timed)) && !totals.firstBy.includes(skill.name) ) totals.firstBy.push(skill.name);
      if ( effect.taken ) totals.taken += number(effect.taken);
      if ( effect.takenPercent ) totals.takenMultiplier *= Math.max(1 + (effect.takenPercent / 100), 0);
      if ( effect.takenPercent && !totals.takers.includes(skill.name) ) totals.takers.push(skill.name);
      if ( effect.endurance ) {
        totals.taken -= number(effect.endurance);
        totals.endurance += number(effect.endurance);
      }
      const eased = number(effect.taken ?? 0) - number(effect.endurance ?? 0);
      if ( eased ) totals.takenBy.push({ skill: skill.name, amount: eased });
      if ( effect.haste ) totals.haste += number(effect.haste);
      if ( effect.mirrorCrit ) totals.mirrorCrit = Math.max(totals.mirrorCrit, number(effect.mirrorCrit));
      if ( effect.critFloor ) totals.critFloor = Math.max(totals.critFloor, readNumber(effect.critFloor, self, fight));
      if ( effect.critMultiplier ) totals.critMultiplier = Math.max(totals.critMultiplier ?? 0, effect.critMultiplier);
      if ( effect.slots ) totals.slots += number(effect.slots);
      if ( effect.capacity ) totals.capacity += number(effect.capacity);
      if ( effect.artCost ) totals.artCost += number(effect.artCost);
      if ( effect.dealtPercent ) totals.damageMultiplier *= Math.max(1 + ((effect.dealtPercent * scale) / 100), 0);
      if ( (effect.dealtPercent || effect.damageMultiplier) && !totals.scalers.includes(skill.name) ) totals.scalers.push(skill.name);
      if ( effect.foeActivation ) totals.foeActivation += number(effect.foeActivation);
      if ( effect.hpMax ) totals.hpMax += number(effect.hpMax);
      Object.assign(totals.calc, effect.calc ?? {});
      if ( effect.foeStats && fight ) {
        const lowered = Object.fromEntries(Object.entries(effect.foeStats).map(([key, value]) => [key, number(value)]));
        totals.foeStats.push({ skill: skill.name, stats: lowered });
      }
      for ( const rule of effect.rules ?? [] ) totals.rules.add(rule);

      // The skills another unit made sure of: each activates whenever its moment of a fight comes
      for ( const name of effect.assures ?? [] ) totals.assured.add(name);
      for ( const quality of effect.effective ?? [] ) {
        if ( !totals.effective.includes(quality) ) totals.effective.push(quality);
      }
      if ( effect.effectiveMultiplier ) {
        totals.effectiveMultiplier = Math.max(totals.effectiveMultiplier ?? 0, effect.effectiveMultiplier);
      }
      if ( effect.damageMultiplier ) totals.damageMultiplier *= effect.damageMultiplier;
      if ( effect.ignoreDefence ) totals.ignoreDefence = Math.max(totals.ignoreDefence, effect.ignoreDefence);
      if ( effect.strikes ) totals.strikes = Math.max(totals.strikes, effect.strikes);
      // One more attack after all others: for every unit, or only for one that would make so many attacks
      // without it, or that follows up by its Attack Speed (see `rounds.mjs`)
      if ( effect.extraAttack ) {
        totals.extraAttacks.push({
          name: skill.name, percent: effect.extraAttack.percent ?? 100, attacks: effect.extraAttack.attacks ?? 0, follows: !!effect.extraAttack.follows
        });
      }
      if ( effect.speedLead ) {
        totals.speedLead.push({
          skill: skill.name, per: effect.speedLead.per, damage: effect.speedLead.damage ?? 0, hit: effect.speedLead.hit ?? 0, critical: effect.speedLead.critical ?? 0
        });
      }
      if ( effect.weaponRange ) totals.ranges.push({ ...effect.weaponRange });
      if ( effect.damageStat ) totals.damageStat = effect.damageStat;
      if ( effect.foeWear ) {
        totals.foeWear.hit += effect.foeWear.hit ?? 0;
        totals.foeWear.noDamage += effect.foeWear.noDamage ?? 0;
      }
      if ( effect.wield ) totals.wield += number(effect.wield);

      // What the unit chose before the fight (see `choices.mjs`): the fight works out what it comes to, once
      // the unit's numbers are known
      if ( effect.trade ) totals.trades.push({ skill: skill.name, trade: effect.trade, steps: effect.trade.pick ? pickedSteps(skill.picked, effect.trade.id) : null });
      if ( effect.spend ) totals.spends.push({ skill: skill.name, spend: effect.spend, steps: pickedSteps(skill.picked, effect.spend.id) });
      if ( effect.single && !totals.single ) totals.single = { skill: skill.name, ...effect.single };
      if ( effect.noWeight ) totals.noWeight = true;
      if ( effect.against ) totals.against = effect.against;
      if ( effect.hitCap ) {
        totals.hitCap = Math.min(totals.hitCap ?? Infinity, number(effect.hitCap));
        if ( !totals.cappers.includes(skill.name) ) totals.cappers.push(skill.name);
      }
      // What becomes of the bonuses to its own stats, as a change an enemy left on it may have it
      if ( effect.bonuses && fight ) totals.ownBonus.push({ skill: skill.name, stats: [...BONUS_STATS], times: effect.bonuses.times });
      if ( effect.foeBonus && fight ) {
        const picked = BONUS_STATS.includes(skill.picked?.stat) ? skill.picked.stat : "best";
        totals.foeBonus.push({ skill: skill.name, stats: (effect.foeBonus.stats === "pick") ? [picked] : [...effect.foeBonus.stats], times: effect.foeBonus.times });
      }

      // What it makes of blocking (see `blocking.mjs`): its unit's Block chance and its foe's, what a block
      // takes off, and the DEF and RES of this effect that a hit which is blocked goes without. What it adds
      // to a Block chance is named in the sum behind that chance
      const counts = (left !== undefined) ? { id: skill.id ?? null, name: skill.name, left } : null;
      if ( effect.block ) {
        const before = totals.block.chance.length + totals.block.foeChance.length;
        addBlock(totals.block, effect.block, { name: skill.name, number, uses: counts });
        if ( (totals.block.chance.length + totals.block.foeChance.length) === before ) notable ||= Object.keys(effect.block).some((key) => !["chance", "foeChance", "kind"].includes(key));
      }
      if ( effect.lostOnBlock ) {
        for ( const key of ["def", "res"] ) totals.block.lost[key] += Math.max(number(effect.stats?.[key] ?? 0), 0);
      }

      // And of the first and the last use of its weapon
      for ( const key of ["first", "last"] ) {
        if ( effect.weaponUse?.[key] ) totals.weaponUse[key].push({ skill: skill.name, uses: counts });
      }

      // What it makes of the weapon triangle (see `triangle.mjs`), which only a fight has: the advantage it
      // hands its unit goes by the weapon its foe wields. A skill and the change it left on its unit go by
      // the skill's name, so that the two count once
      if ( effect.triangle && fight ) {
        const beats = (list) => (list === OUTSIDE)
          ? outsideTriangle(self.weapon?.category, fight.foe?.weapon?.category)
          : !!fight.foe?.weapon && weaponIs(fight.foe.weapon, [].concat(list));
        if ( addTriangle(totals.triangle, effect.triangle, { name: skill.name, beats }) ) notable = true;
      }

      // And what the weapon in hand takes from the one its unit attacked with before
      if ( effect.handover ) totals.handovers.push({ skill: skill.name, ...effect.handover });

      // What an attack deals and to whom: the Special Qualities nothing is effective against its unit for, a
      // combat stat multiplied once everything is added, what is added to the combat stats of its foe, and a
      // share of every hit dealt again as damage of an element
      for ( const quality of effect.uneffective ?? [] ) {
        if ( !totals.uneffective.includes(quality) ) totals.uneffective.push(quality);
      }
      if ( Number.isFinite(effect.effectiveTaken) ) {
        totals.effectiveTaken = (totals.effectiveTaken === null) ? effect.effectiveTaken : Math.min(totals.effectiveTaken, effect.effectiveTaken);
      }
      for ( const [key, times] of Object.entries(effect.combatTimes ?? {}) ) totals.combatTimes.push({ skill: skill.name, key, times });
      if ( effect.foeCombat && fight ) {
        totals.foeCombat.push({ skill: skill.name, combat: Object.fromEntries(Object.entries(effect.foeCombat).map(([key, value]) => [key, number(value)])) });
      }
      if ( effect.echo ) {
        totals.echoes.push({
          skill: skill.name, percent: effect.echo.percent ?? 0, element: effect.echo.element ?? null, resist: effect.echo.resist ?? null, floor: effect.echo.floor ?? 0
        });
      }
    }

    if ( !applied ) continue;
    if ( skill.aura ) {
      if ( !totals.auras.includes(skill.name) ) totals.auras.push(skill.name);
    }
    else if ( skill.timed ) {
      if ( !totals.lasting.includes(skill.name) ) totals.lasting.push(skill.name);
    }
    else if ( notable && !totals.applied.includes(skill.name) ) totals.applied.push(skill.name);
    if ( Object.keys(source.stats).length || Object.keys(source.combat).length ) totals.sources.push(source);
  }
  return totals;
}

/* -------------------------------------------- */

/**
 * What a unit's skills change about how it crosses terrain (see `terrain.mjs`): every `crossing` part that is
 * always there and whose condition holds outside of any fight. What such a condition asks about where units
 * stand is not judged, since where a unit can stand hangs on this.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {import("./terrain.mjs").Crossing}
 */
export function skillCrossing(skills, self = {}) {
  self = withSkillNames(self, skills);
  const crossing = emptyCrossing();
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.crossing === undefined) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      addCrossing(crossing, effect.crossing);
    }
  }
  return crossing;
}

/* -------------------------------------------- */

/**
 * Does a rule hold for a unit whatever fight it is in: is it among the `rules` of an effect of its skills that
 * is always there and whose condition holds outside of any fight? What such a condition asks about where
 * units stand or how the unit moved is not judged, as for `skillCrossing`, since it is asked before either is
 * known.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it
 * @param {string} rule
 * @param {SkillSelf} [self]
 * @returns {boolean}
 */
export function skillRule(skills, rule, self = {}) {
  self = withSkillNames(self, skills);
  return (skills ?? []).some((skill) => {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) return false;
    return (skill.effects ?? []).some((effect) => {
      if ( !effect?.rules?.includes(rule) || effect.proc || effect.aura ) return false;
      if ( effect.when?.declared && !skill.active ) return false;
      return holds(withoutMove(withoutPlace(effect.when)), self, null);
    });
  });
}

/* -------------------------------------------- */

/**
 * What a unit's skills change about how units stand in its way, and it in theirs (see `passing.mjs`): every
 * `passing` part that is always there and whose condition holds outside of any fight, with its numbers read
 * from the unit. What such a condition asks about where units stand or how the unit moved is not judged,
 * since where a unit can go hangs on this.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]          With its `weight` and its bonuses to ability `checks`, for the numbers
 *                                    that read them
 * @returns {import("./passing.mjs").Passing}
 */
export function skillPassing(skills, self = {}) {
  self = withSkillNames(self, skills);
  const passing = emptyPassing();
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.passing === undefined) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      addPassing(passing, effect.passing, { skill: skill.name, read: (value) => readNumber(value, self, null) });
    }
  }
  return passing;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of moving again after an Action (see `canto.mjs`): every `canto` and `curbsCanto`
 * part that is always there and whose condition holds outside of any fight. What such a condition asks about
 * where units stand or how the unit moved is not judged. What a moment of a fight brings about is read from
 * the fight instead.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {import("./canto.mjs").Canto}
 */
export function skillCanto(skills, self = {}) {
  self = withSkillNames(self, skills);
  const canto = emptyCanto();
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( ((effect?.canto === undefined) && (effect?.curbsCanto === undefined)) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      if ( effect.canto !== undefined ) addCanto(canto, effect.canto, { skill: skill.name });
      if ( effect.curbsCanto !== undefined ) addCurb(canto, effect.curbsCanto, { skill: skill.name });
    }
  }
  return canto;
}

/* -------------------------------------------- */

/**
 * What a unit's skills change about how far its weapon reaches when it starts a fight, read before any fight
 * is planned: every `weaponRange` part that asks for nothing of a fight but that its unit starts it. The map
 * adds them to what the unit's skills make of its weapon's Range at all times, so that it offers the attacks
 * such a skill allows.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {{add?: number, min?: number, max?: number, clear?: boolean}[]}
 */
export function attackRanges(skills, self = {}) {
  self = withSkillNames(self, skills);
  const ranges = [];
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( !effect?.weaponRange || effect.proc || effect.aura || (effect.when?.role !== "initiating") ) continue;
      const { role, ...rest } = effect.when;
      if ( needsFight(rest) || (effect.when.declared && !skill.active) ) continue;
      if ( (!self.move && needsMove({ when: rest })) || !holds(rest, self, null) ) continue;
      ranges.push({ ...effect.weaponRange });
    }
  }
  return ranges;
}

/* -------------------------------------------- */

/**
 * What a unit's skills lend it (see `lending.mjs`): every `lend` part whose effect holds for the unit as it
 * stands, outside of any fight. A part whose effect asks something only a fight can answer lends nothing.
 * @param {SkillEntry[]} skills       The unit's equipped skills, with their effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {{skill: string, id: string|null, lend: object, usage: object|null, state: object|null, picked: object}[]}
 */
export function skillLends(skills, self = {}) {
  self = withSkillNames(self, skills);
  const lends = [];
  for ( const skill of skills ?? [] ) {
    if ( skill.aura || skill.timed ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( !effect?.lend || effect.proc ) continue;
      const when = effect.when ?? {};
      if ( needsFight(when) || (when.declared && !skill.active) ) continue;
      if ( (!self.move && needsMove({ when })) || !holds(when, self, null) ) continue;
      lends.push({ skill: skill.name, id: skill.id ?? null, lend: effect.lend, usage: skill.usage ?? null, state: skill.state ?? null, picked: skill.picked ?? {} });
    }
  }
  return lends;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of its Shove (see `forced.mjs`): every `shove` part that is always there and
 * whose condition holds outside of any fight. What such a condition asks about where units stand or how the
 * unit moved is not judged.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {import("./forced.mjs").Shoving}
 */
export function skillShove(skills, self = {}) {
  self = withSkillNames(self, skills);
  const shove = emptyShove();
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.shove === undefined) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      addShove(shove, effect.shove, { skill: skill.name });
    }
  }
  return shove;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of carrying a unit, and of being carried (see `rescue.mjs`): every `carry` part
 * that is always there and whose condition holds outside of any fight. What such a condition asks about where
 * units stand or how the unit moved is not judged. A skill that counts its uses and has none left gives
 * nothing.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {import("./rescue.mjs").Carrying}
 */
export function skillCarry(skills, self = {}) {
  self = withSkillNames(self, skills);
  const carry = emptyCarry();
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.carry === undefined) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      addCarry(carry, effect.carry, { skill: skill.name });
    }
  }
  return carry;
}

/* -------------------------------------------- */

/**
 * What a unit's skills let it do with gear and with the things on a map (see `stealing.mjs`): every `steal`,
 * `opens`, `disarms`, `pillages`, `discount` and `crafts` part that is always there and whose condition holds
 * outside of any fight. What such a condition asks about where units stand or how the unit moved is not
 * judged.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {import("./stealing.mjs").Knacks}
 */
export function skillKnacks(skills, self = {}) {
  self = withSkillNames(self, skills);
  const knacks = emptyKnacks();
  for ( const skill of skills ?? [] ) {
    if ( (skill.usage?.kind === "auto") && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( !effect || effect.proc || effect.aura || !KNACK_KEYS.some((key) => effect[key] !== undefined) ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      addKnacks(knacks, effect, { skill: skill.name, number: (value) => readNumber(value, self, null) });
    }
  }
  return knacks;
}

/* -------------------------------------------- */

/**
 * What a unit does for its side outside of its own turn, as its skills and the stances it is in have it (see
 * `stances.mjs` and `reactions.mjs`): every `guards`, `wards`, `reacts` and `shelters` part that is always
 * there and whose condition holds outside of any fight. What such a condition asks about where units stand or how the unit
 * moved is not judged. A skill that counts its uses and has none left, or that is on cooldown, does nothing.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]
 * @returns {{guard: import("./stances.mjs").Guarding[], wards: import("./stances.mjs").Warding[],
 *   reacts: import("./reactions.mjs").Reacting[], shelters: import("./stances.mjs").Sheltering[]}}
 */
export function skillStanding(skills, self = {}) {
  self = withSkillNames(self, skills);
  const standing = { guard: [], wards: [], reacts: [], shelters: [] };
  for ( const skill of skills ?? [] ) {
    if ( skill.usage?.kind === "auto" ) {
      if ( (usesLeft(skill.usage, skill.state) === 0) || ((skill.state?.cooldown ?? 0) > 0) ) continue;
    }
    for ( const effect of skill.effects ?? [] ) {
      if ( !STANDING_KEYS.some((key) => effect?.[key] !== undefined) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;

      // A stance goes by its own name, and a skill by its Item
      const about = { skill: skill.timed ? (skill.change ?? skill.name) : skill.name, id: skill.timed ? "" : (skill.id ?? ""), by: skill.by ?? "" };
      const guard = guardOf(effect.guards, about);
      if ( guard ) standing.guard.push(guard);
      const ward = wardOf(effect.wards, about);
      if ( ward ) standing.wards.push(ward);
      const react = reactOf(effect.reacts, about);
      if ( react ) standing.reacts.push({ ...react, stance: !!skill.timed });
      const shelter = shelterOf(effect.shelters, about);
      if ( shelter ) standing.shelters.push(shelter);
    }
  }
  return standing;
}

/* -------------------------------------------- */

/**
 * What a unit's skills make of Refresh (see `refresh.mjs`): every `refresh` part that is always there and
 * whose condition holds outside of any fight, with the numbers that are read from the unit worked out. What
 * such a condition asks about where units stand or how the unit moved is not judged.
 * @param {SkillEntry[]} skills       The unit's equipped skills and the changes that last on it, with their
 *                                    effects as `effectsOf` reads them
 * @param {SkillSelf} [self]          The unit, with the stats it has now
 * @returns {import("./refresh.mjs").Refreshing}
 */
export function skillRefresh(skills, self = {}) {
  self = withSkillNames(self, skills);
  const refresh = emptyRefresh();
  const number = (value) => ((value !== undefined) && (typeof value === "object")) ? readNumber(value, self, null) : value;
  const give = (part) => ({ ...part, effects: resolveGiven(part.effects ?? [], self), ...((part.hp !== undefined) ? { hp: number(part.hp) } : {}) });
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.refresh === undefined) || effect.proc || effect.aura ) continue;
      if ( effect.when?.declared && !skill.active ) continue;
      if ( !holds(withoutMove(withoutPlace(effect.when)), self, null) ) continue;
      const part = { ...effect.refresh };
      if ( part.range ) part.range = { ...part.range, max: number(part.range.max) };
      if ( part.gives ) part.gives = [].concat(part.gives).map(give);
      if ( part.curses ) part.curses = [].concat(part.curses).map(give);
      if ( part.option ) {
        part.option = { ...part.option };
        if ( part.option.heal !== undefined ) part.option.heal = number(part.option.heal);
        if ( part.option.gives ) part.option.gives = [].concat(part.option.gives).map(give);
      }
      addRefresh(refresh, part, { skill: skill.name, item: skill.id ?? "" });
    }
  }
  return refresh;
}

/* -------------------------------------------- */

/**
 * The Leadership Stars a unit's skills are, where the world plays with Authority & Leadership: every `stars`
 * part that is always there and whose condition holds outside of any fight.
 * @param {{effects: object[]}[]} skills      The unit's equipped skills, with their effects as `effectsOf` reads them
 * @returns {number}
 */
export function skillStars(skills) {
  let stars = 0;
  for ( const skill of skills ?? [] ) {
    for ( const effect of skill.effects ?? [] ) {
      if ( (effect?.stars === undefined) || effect.proc || effect.aura || !holds(effect.when, {}, null) ) continue;
      stars += readNumber(effect.stars, {}, null);
    }
  }
  return Math.max(stars, 0);
}

/* -------------------------------------------- */

/**
 * Does any of a unit's skills cancel the foe's skills, as Nihil does?
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @returns {boolean}
 */
export function hasNihil(skills, self) {
  return (skills ?? []).some((skill) => (skill.effects ?? []).some((effect) => {
    return effect.rules?.includes("nihil") && holds(effect.when, self, null);
  }));
}

/* -------------------------------------------- */

/**
 * Does a unit cancel what terrain, supports, weapons, equipment and skills do in a fight, as Parity does? Only
 * with a skill it has switched on, which a foe that cancels skills stops as it stops any that is chosen.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf} self
 * @param {boolean} [foeNihil]      Does the foe cancel skills, as Nihil does?
 * @returns {string|null}           The name of the skill that does, or null
 */
export function hasParity(skills, self, foeNihil = false) {
  if ( foeNihil ) return null;
  const found = (skills ?? []).find((skill) => !skill.aura && !skill.timed && (skill.effects ?? []).some((effect) => {
    if ( !effect.rules?.includes(PARITY) || effect.proc ) return false;
    if ( effect.when?.declared && !skill.active ) return false;
    return holds(withoutMove(withoutPlace(effect.when)), self, null);
  }));
  return found?.name ?? null;
}

/* -------------------------------------------- */
/*  Chances to Activate                         */
/* -------------------------------------------- */

/**
 * @typedef ProcPart
 * What an activated proc does to one attack.
 * @property {number} damage              Added to the attack's damage
 * @property {number} damagePercent       A share of the damage before defence, added to it
 * @property {number} damageMultiplier
 * @property {{percent: number, stat?: "def"|"res"}|null} ignore
 * @property {number} hit
 * @property {number} critical
 * @property {number} heal                A share of the damage dealt, in percent
 * @property {boolean|"ifAny"} sureHit
 * @property {{id: string, upgrade?: {id: string, chance: number}, dice?: number}[]} inflicts
 * @property {number|null} share          What the attack's damage is multiplied by, in a sequence
 * @property {boolean} end                Does the fight end there if the attack hits?
 * @property {string} skill               The skill the part belongs to
 */

/**
 * @typedef {ProcPart & object} Proc
 * A chance to activate, with every number worked out for the fight at hand.
 * @property {string} skill
 * @property {"attack"|"struck"|"start"|"hit"|"crit"|"miss"|"dodged"|"kill"|"after"} on
 * @property {number} chance                      In percent, with the unit's Skill Activation rate
 * @property {boolean} sure                       Does it happen without a roll?
 * @property {Record<string, number>} next        Added to the unit's next attack: hit, damage, critical
 * @property {Record<string, number>} nextOfDamage    The same, as shares of the damage of the hit taken
 * @property {{within: number, next: Record<string, number>}|null} near
 * @property {boolean} nonlethal
 * @property {number} recover
 * @property {number} gold                        Gold the unit gains
 * @property {number} gaugeOfDamage               On a critical hit: the share, in percent, of the damage the hit
 *                                                would have dealt uncritical that its Shift Gauge gains
 * @property {boolean} freeUses                 Does the unit's weapon lose no use in this fight?
 * @property {boolean} attack
 * @property {boolean|"foe"} remind
 * @property {object|null} canto                  After the fight: the `canto` part that has its unit move again
 * @property {object|null} acts                   The `acts` part that earns its unit another go in its turn
 * @property {boolean} damaged
 * @property {boolean} ifHit
 * @property {boolean} ifStruck
 * @property {ProcPart[]|null} sequence           The attacks an attack turns into
 * @property {boolean} oneUse
 * @property {number} negate
 * @property {number} reduce
 * @property {number} reflect
 * @property {number} retaliate
 * @property {string[]} inflictsAttacker
 * @property {boolean|{hp: {op: string, percent?: number}}} survive
 *                                                A fatal hit is halved and leaves 1 HP if it is still fatal;
 *                                                or, with an HP test, leaves 1 HP for a unit that passes it
 * @property {{id: string|null, name: string, left: number|null}|null} uses
 *                                                Set for a skill that counts a use each time it takes effect:
 *                                                how often it still can, null for no limit
 * @property {Record<string, number>} combat
 * @property {Record<string, number>} foeCombat
 * @property {{def?: number, res?: number}|null} shield
 *                                                The DEF and RES a hit is dealt against where they are more
 *                                                than the unit's own
 */

/**
 * What a chance that is read from a stat is read from: the stat, what it is divided by and what it is
 * multiplied by. That is what the skill says, unless the world plays with Alternate Skill Activation. A chance
 * that comes to less than the whole stat is then the whole stat, and in the reading by level a chance read
 * from Dexterity is read from the unit's level instead. Only a unit's own stats are meant: a chance read from
 * a combat stat or from the foe stays as the skill words it.
 * @param {{stat?: string, div?: number, times?: number}} proc
 * @returns {{stat: string|undefined, div: number, times: number, changed: boolean}}
 *          `changed` when the module made something else of it
 */
export function activationOf(proc) {
  const basis = { stat: proc.stat, div: proc.div ?? 1, times: proc.times ?? 1, changed: false };
  const rule = FEO.optional?.alternateActivation;
  if ( !rule?.enabled || !basis.stat || String(basis.stat).includes(":") ) return basis;
  if ( (basis.times / basis.div) < 1 ) Object.assign(basis, { div: 1, times: 1, changed: true });
  if ( (rule.mode === "level") && (basis.stat === rule.replaces) ) Object.assign(basis, { stat: rule.level, changed: true });
  return basis;
}

/* -------------------------------------------- */

/**
 * The chance a skill rolls to activate with, as the skill words it: that of the first of its effects the
 * system rolls for or, for a skill without one, that of its activation fields.
 * @param {object} skill                A skill's data
 * @param {object[]} [skill.effects]
 * @param {string} [skill.choice]       The variant taken of a skill that offers several
 * @param {boolean} [skill.automate]    False for a skill the table runs by hand, whose effects are not read
 * @param {{stat?: string, divisor?: number}} [skill.activation]
 * @returns {object|null}               Null for a skill that does not roll to activate
 */
export function rolledProc({ effects = [], choice = "", automate = true, activation = null } = {}) {
  const chosen = chosenOf({ choice });
  const rolled = (automate !== false)
    ? (effects ?? []).find((effect) => effect.proc && !effect.proc.sure && (!effect.choice || chosen.includes(effect.choice)))
    : null;
  if ( rolled ) return rolled.proc;
  return activation?.stat ? { stat: activation.stat, div: activation.divisor ?? 1 } : null;
}

/* -------------------------------------------- */

/**
 * The chance of a proc, in percent: a fixed one, or a stat divided and multiplied as the skill says, with the
 * unit's Skill Activation rate added and the whole held between 0 and 100. A chance marked `fixed` is what it
 * says, whatever that rate and whatever makes skills always activate. Where the world plays with Alternate
 * Skill Activation, a chance read from a stat is read as that module has it (see `activationOf`).
 * @param {{percent?: number, stat?: string, div?: number, times?: number, fixed?: boolean}} proc
 * @param {SkillSelf & {combat?: object}} self
 * @param {SkillFight|null} [fight]
 * @param {object} [options]
 * @param {number} [options.activation]     The unit's Skill Activation rate
 * @param {boolean} [options.always]        Do the unit's skills always activate?
 * @param {number} [options.raised]         What the unit's skills add to its chance of inflicting the
 *                                          condition this one inflicts, which a fixed chance gains as well
 * @param {boolean} [options.asWritten]     Is the chance no activation of a skill, so that it is read as
 *                                          the skill words it whatever the world plays with?
 * @returns {number}
 */
export function chanceOf(proc, self, fight = null, { activation = 0, always = false, raised = 0, asWritten = false } = {}) {
  if ( proc.sure ) return 100;

  // An answer is taken or left by whoever acts for the unit, and never rolled for
  if ( proc.may ) return 0;
  if ( proc.fixed ) return Math.min(Math.max((proc.percent ?? 0) + raised, 0), 100);
  if ( always ) return 100;
  let rate = proc.percent;
  if ( rate == null ) {
    const { stat, div, times } = asWritten ? { stat: proc.stat, div: proc.div ?? 1, times: proc.times ?? 1 } : activationOf(proc);
    rate = Math.floor((readSource(stat, self, fight) / div) * times);
  }
  return Math.min(Math.max(rate + activation + raised, 0), 100);
}

/* -------------------------------------------- */

/**
 * Work out a chance to activate for the fight at hand.
 * @param {{skill: string, effect: object}} raw     As `skillTotals` collects it
 * @param {SkillSelf & {combat?: object}} self      The unit, with the stats and combat stats it fights with
 * @param {SkillFight|null} fight
 * @param {object} [options]
 * @param {number} [options.activation]     The unit's Skill Activation rate
 * @param {boolean} [options.always]        Do the unit's skills always activate?
 * @param {Record<string, number>} [options.inflictChance]
 *                                          What the unit's skills add to its chances of inflicting conditions
 * @returns {Proc}
 */
export function resolveProc({ skill, effect, source = null, giver = "", giverId = null, limit = null, uses = null, chosen = false, arm = null, mine = false }, self, fight, { activation = 0, always = false, inflictChance = null } = {}) {
  const proc = effect.proc;

  // An attack with numbers of its own, as it is written; one made with a weapon of the Weapons tab has that
  // weapon's numbers (see `lending.mjs`): the weapon the build wrote in, or the one picked for the skill
  const own = (effect.attack && (typeof effect.attack === "object"))
    ? ((effect.attack.arm || effect.attack.lent || effect.attack.weapon) ? attackWith(effect.attack, effect.attack.arm ?? arm) : effect.attack)
    : null;
  const number = (value) => {
    if ( Array.isArray(value) ) return value.reduce((sum, entry) => sum + readNumber(entry, self, fight), 0);
    return readNumber(value ?? 0, self, fight);
  };

  // A chance that is rolled for and inflicts a condition gains what the unit's skills add to that condition's
  // chances: the most any of the conditions it inflicts gains
  const inflicted = [effect, ...(effect.sequence ?? [])].flatMap((part) => part.inflicts ?? [])
    .flatMap((entry) => ((typeof entry === "string") ? entry : (entry?.anyOf ?? entry?.id))).concat(effect.inflictsAttacker ?? []);
  const raised = (proc.sure || !inflictChance) ? 0 : inflicted.reduce((most, id) => Math.max(most, inflictChance[id] ?? 0), 0);
  const chance = chanceOf(proc, self, fight, { activation, always, raised });

  // The second roll of a condition that may turn into a worse one is no activation of the skill: it does not
  // gain the Skill Activation rate, and Alternate Skill Activation leaves it as the skill words it
  const part = (given) => {
    let damage = number(given.damage);
    for ( const [stat, times] of Object.entries(given.statTimes ?? {}) ) {
      if ( (self.weapon?.damageStat ?? "str") === stat ) damage += (self.stats?.[stat] ?? 0) * (times - 1);
    }

    // Another stat added to the weapon's Might for this attack, in place of the one the weapon adds
    const added = self.weapon?.damageStat ?? "str";
    if ( given.stat && (given.stat !== added) ) damage += (self.stats?.[given.stat] ?? 0) - (self.stats?.[added] ?? 0);

    // What is added to a stat for this attack counts where the weapon adds that stat
    if ( given.statPlus?.[added] !== undefined ) damage += number(given.statPlus[added]);
    return {
      damage,

      // Might for this attack, which counts as the weapon's own does
      might: number(given.might),
      damagePercent: given.damagePercent ?? 0,
      foeHpPercent: given.damageOfFoeHp ?? 0,
      damageMultiplier: given.damageMultiplier ?? 1,
      ignore: given.ignore ?? null,
      hit: number(given.hit),
      critical: number(given.critical),
      heal: given.heal ?? 0,
      sureHit: given.sureHit ?? false,

      // It is a critical hit if it lands
      sureCrit: given.sureCrit === true,

      // What the weapon's Effect inflicts comes at so many percent more chance, for so many percent more turns
      amplify: Math.max(Number(given.amplify) || 0, 0),
      inflicts: (given.inflicts ?? []).map((entry) => {
        if ( typeof entry === "string" ) return { id: entry };

        // One of several, picked by a die when the attack lands
        if ( entry.anyOf ) return { id: entry.anyOf[0], anyOf: [...entry.anyOf] };
        const upgrade = entry.upgrade ? { id: entry.upgrade.id, chance: chanceOf(entry.upgrade, self, fight, { always, asWritten: true }) } : undefined;
        const dice = entry.dice ? { dice: entry.dice } : (entry.turns ? { turns: entry.turns } : {});
        return upgrade ? { id: entry.id, upgrade, ...dice } : { id: entry.id, ...dice };
      }),
      share: given.share ?? null,
      end: !!given.end,

      // The attack goes past the foe's Shield, or past whatever it blocks with
      noBlock: (given.noBlock === true) ? "all" : (given.noBlock === "shield") ? "shield" : null,

      // It counts as a critical hit for what waits for one, deals effective damage, and is resisted by another
      // defence than the weapon's (see `choices.mjs`)
      asCrit: !!given.asCrit,
      effective: (given.effective === true)
        || (Array.isArray(given.effective) && given.effective.some((quality) => hasQuality(fight?.foe.qualities, quality))),

      // It kills if it lands, deals a share of its target's maximum HP in place of its damage, or cuts the HP
      // its target has left once its damage is dealt
      slay: given.slay === true,
      instead: (given.instead && (typeof given.instead === "object")) ? { dice: Math.max(given.instead.dice ?? 100, 1) } : null,
      cut: (given.cut && (typeof given.cut === "object")) ? { percent: given.cut.percent ?? 0, killAt: given.cut.killAt ?? 0 } : null,
      against: AGAINST.includes(given.against) ? given.against : null,

      // What it makes of the weapon triangle for this attack (see `triangle.mjs`)
      triangle: (given.triangle && (typeof given.triangle === "object")) ? { boon: given.triangle.boon ?? 1, bane: given.triangle.bane ?? 1 } : null,

      // Stats of the foe that count so many times for this attack: the fight works out what that takes off
      // its Dodge, its Critical Avoid and its defence (see `combat.mjs`)
      foeStatTimes: (given.foeStatTimes && (typeof given.foeStatTimes === "object")) ? { ...given.foeStatTimes } : null,
      skill
    };
  };

  // Uses the foe's weapon and Shield lose: a number, or a die of so many faces that the fight rolls
  const wear = (value) => (value && (typeof value === "object") && value.dice) ? { dice: value.dice } : Math.max(number(value), 0);
  const numbers = (object) => Object.fromEntries(Object.entries(object ?? {}).map(([key, value]) => [key, number(value)]));
  const retaliate = effect.retaliate
    ? Math.max(number(effect.retaliate) - (effect.resist ? (fight?.foe.stats?.[effect.resist] ?? 0) : 0), 0)
    : 0;

  return {
    skill,
    on: proc.on,
    chance,
    sure: !!proc.sure,
    once: !!proc.once,

    // An answer: whoever acts for the unit takes it or leaves it as its moment comes (see `answers.mjs`). The
    // margin a roll may have failed by, whether its unit must have more Attack Speed than its foe, whether its
    // skill is one that is chosen when to activate, and what it does
    may: !!proc.may,
    within: Number.isFinite(proc.within) ? proc.within : null,
    faster: !!proc.faster,
    fixed: !!proc.fixed,
    chosen: !!chosen,
    dodge: effect.dodge === true,

    // It does nothing but count as a use of its skill
    forfeit: effect.forfeit === true,
    cancel: effect.cancel === true,
    reroll: effect.reroll === true,
    plain: effect.plain === true,
    forgoExp: !!effect.forgoExp,
    splash: (effect.splash && (typeof effect.splash === "object")) ? {
      percent: effect.splash.percent ?? 0,
      count: Math.max(effect.splash.targets ?? 1, 1),
      around: SPLASH_AROUND.includes(effect.splash.around) ? effect.splash.around : "both"
    } : null,
    costs: (effect.costs && (typeof effect.costs === "object")) ? {
      weapon: Math.max(effect.costs.weapon ?? 0, 0),
      item: effect.costs.item ? [...effect.costs.item] : null,
      uses: Math.max(effect.costs.uses ?? 0, 0)
    } : null,
    reduceItem: effect.reduce?.of === "itemMight",

    // What of its foe's it may bring to nothing
    foils: (proc.on === FOIL_MOMENT) ? [].concat(effect.foils ?? []).filter((kind) => FOILS.includes(kind)) : [],

    // The round of a fight (see `rounds.mjs`): the attack of the fight a moment begins with and whether its
    // numbers mount with each attack since; every how many attacks against its unit it takes effect; a chance
    // read from the damage of a hit; whether its unit must have more HP than its foe as a round ends; the
    // round fought again; and what it changes as the fight begins
    from: Number.isInteger(proc.from) ? Math.max(proc.from, 1) : 0,
    mounts: !!proc.mounts,

    // Whether it waits for an attack to have landed on its unit in the fight, and the chain of attacks a hit
    // begins: how many in a row, at what share of the Hit each comes to, and whether only for a unit that makes
    // no follow-up attack
    hurt: !!proc.hurt,
    chain: (effect.chain && (typeof effect.chain === "object")) ? {
      most: Math.max(Math.floor(Number(effect.chain.most) || 1), 1),
      hit: Math.min(Math.max(Number(effect.chain.hit ?? 100), 0), 100) / 100,
      lone: !!effect.chain.lone
    } : null,
    every: Number.isInteger(proc.every) ? Math.max(proc.every, 0) : 0,
    perDamage: Number.isFinite(proc.perDamage) ? Math.max(proc.perDamage, 0) : 0,
    healthier: !!proc.healthier,
    again: (effect.again && (typeof effect.again === "object")) ? { most: Math.max(effect.again.most ?? 1, 1), stop: !!effect.again.stop } : null,
    order: ORDERS.includes(effect.order) ? effect.order : null,
    cuts: (effect.cuts && (typeof effect.cuts === "object")) ? { later: effect.cuts.later ?? 0, lone: effect.cuts.lone ?? 0 } : null,

    // Is its skill, where it was declared, spent only by a fight in which this takes effect?
    spends: !!proc.spends,

    // Whether its unit must be one that makes no attack in the fight, or none that would deal damage; whether
    // the hit must have dealt no damage; what is added to the defence a hit is resisted with; and the stats it
    // adds for the whole fight, which the fight makes combat stats of (see `skill-combat.mjs`)
    unable: !!proc.unable,
    harmless: !!proc.harmless,
    defend: (effect.defend && (typeof effect.defend === "object")) ? numbers(effect.defend) : null,
    stats: ((proc.on === "start") && effect.stats) ? numbers(effect.stats) : null,

    // At the moments a condition is inflicted: the conditions the skill waits for, and for how many turns the
    // unit hands the condition back to its foe
    conditions: (proc.condition !== undefined) ? [].concat(proc.condition) : null,
    returns: effect.returns ?? 0,
    next: numbers(effect.next),
    nextOfDamage: { ...(effect.nextOfDamage ?? {}) },

    // When struck: a share of what this effect took off the hit, for its unit's next attack; whether what is
    // set aside for that attack waits for it in a later fight; damage its own unit takes as the fight begins
    // or once it is over; and, as its unit is attacked, how many percent of its maximum HP the attack must
    // take off it for the effect to count once
    nextOfNegated: { ...(effect.nextOfNegated ?? {}) },
    keep: !!effect.keep,
    pays: Math.max(number(effect.pays), 0),
    threat: Number.isFinite(proc.perHp) ? Math.max(proc.perHp, 0) : 0,

    // The unit an aura comes from, where this is one, and how often that aura is given
    giverId,
    limit,
    near: effect.near ? { within: effect.near.within ?? 0, next: numbers(effect.near.next) } : null,
    nonlethal: !!effect.nonlethal,
    recover: number(effect.recover),
    gold: Math.max(number(effect.gold), 0),
    gaugeOfDamage: effect.gaugeOfDamage ?? 0,
    freeUses: !!effect.freeUses,
    attack: !!effect.attack,

    // An attack with numbers of its own: the Hit and the Might it has in place of the weapon's, and how far it
    // reaches. The fight works out what the unit makes of them (see `skill-combat.mjs`)
    strike: own ? {
      hit: number(own.hit),
      might: Math.max(number(own.might), 0),
      range: Number.isInteger(own.range) ? Math.max(own.range, 1) : 1,

      // What an attack that is no physical one says of itself: its Critical, the stat it adds to its Might,
      // what resists it, its element, and an Effect as a weapon has one: the Special Qualities it is effective
      // against and the conditions it may inflict
      ...(Number.isFinite(own.critical) ? { crit: own.critical } : {}),
      ...(own.stat ? { stat: own.stat } : {}),
      ...((own.against === "res") ? { against: "res" } : {}),
      ...(own.element ? { element: own.element } : {}),
      ...((typeof own.effect === "string") ? { effect: own.effect } : {}),

      // One made with a weapon: the nearest it is made from, the weapon's name, and the share of its damage it
      // deals where the attack says so
      ...((Number.isInteger(own.from) && (own.from > 1)) ? { from: own.from } : {}),
      ...(own.name ? { name: own.name } : {}),
      ...(Number.isFinite(effect.attack.share) ? { share: Math.max(effect.attack.share, 0) / 100 } : {})
    } : null,

    // The skill whose lent weapon this one's chance betters, as a fight is started with it (see `lending.mjs`)
    betters: (typeof effect.betters === "string") ? effect.betters : null,

    // What it does to the units around (see `spread.mjs`): the numbers that are read from this unit are worked
    // out, those read from the hit or from a unit that is caught wait for them; and the change it leaves on
    // each is made ready as every lasting change is
    spread: (effect.spread && (typeof effect.spread === "object")) ? (() => {
      const ready = (value) => {
        const parts = [].concat(value).map((entry) => (((typeof entry === "number") || spreadWaits(entry)) ? entry : number(entry)));
        return Array.isArray(value) ? parts : parts[0];
      };
      const spread = { ...effect.spread };
      for ( const key of ["damage", "heal"] ) if ( spread[key] !== undefined ) spread[key] = ready(spread[key]);
      if ( spread.grant ) {
        const grant = expandGrant(spread.grant);
        spread.grant = { ...grant, effects: resolveGiven(grant.effects ?? [], self) };
        if ( grant.harm && (typeof grant.harm === "object") ) spread.grant.harm = Math.max(readNumber(grant.harm, self, fight), 0);
        if ( grant.mend && (typeof grant.mend === "object") ) spread.grant.mend = Math.max(readNumber(grant.mend, self, fight), 0);
      }
      return spread;
    })() : null,

    // On a block: how many of the attacker's next attacks in this fight are cancelled
    cancels: Math.max(number(effect.cancels), 0),

    // When struck: what the unit makes of what `reduce` takes off beyond the damage there was
    excess: (effect.excess && (typeof effect.excess === "object")) ? {
      retaliate: !!effect.excess.retaliate,
      combat: [].concat(effect.excess.combat ?? [])
    } : null,

    // When its hit was curbed: what must have curbed it, and whether it must have dealt no damage for a block
    // or a skill
    curbs: (proc.by !== undefined) && (proc.on === "curbed") ? [].concat(proc.by) : null,
    stopped: (typeof proc.stopped === "boolean") ? proc.stopped : null,
    remind: effect.remind ?? false,

    // What it takes from the foe (see `stealing.mjs`), and whether the foe puts down what it holds once the
    // attack has landed
    loot: (effect.loot && (typeof effect.loot === "object")) ? { ...effect.loot } : null,
    unequips: effect.unequips === true,

    // The creature it raises from the foe its unit has defeated (see `creatures.mjs`)
    makes: (effect.makes && (typeof effect.makes === "object")) ? effect.makes : null,

    // After the fight: the move its unit may then make, as Canto has it (see `canto.mjs`)
    canto: (effect.canto && (typeof effect.canto === "object")) ? { ...effect.canto } : null,

    // Another go in its turn, for the unit that started the fight (see `acting.mjs`)
    acts: (effect.acts && (typeof effect.acts === "object")) ? { ...effect.acts } : null,

    // How it moves units once the fight is over (see `forced.mjs`), and the attacks its unit must have
    // landed for its moment to come
    step: (effect.step && (typeof effect.step === "object")) ? { ...effect.step } : null,
    hits: Number.isInteger(proc.hits) ? Math.max(proc.hits, 0) : 0,

    // A Refresh it hands out, to its unit or to the allies around (see `refresh.mjs`)
    refreshes: (effect.refreshes && (typeof effect.refreshes === "object")) ? { ...effect.refreshes } : null,

    // Changes that last a while, with the numbers that are read from this unit worked out
    grants: [].concat(effect.grant ?? []).filter((written) => !written?.when || holds(written.when, self, fight)).map((written) => {
      // One that names a staff does what that staff does to its target
      const { when: asked, ...grant } = expandGrant(written);
      const given = { ...grant, effects: resolveGiven(grant.effects ?? [], self) };

      // The HP it restores as each turn of its unit starts, where that is read from the unit and not from the
      // hit that grants it
      if ( grant.mend && (typeof grant.mend === "object") && !readsDealt(grant.mend) ) given.mend = Math.max(readNumber(grant.mend, self, fight), 0);

      // And the damage its unit takes as its next turn starts
      if ( grant.harm && (typeof grant.harm === "object") ) given.harm = Math.max(readNumber(grant.harm, self, fight), 0);

      // How many times over a change starts can be read from the unit, as from its class tier
      if ( grant.stacks && (typeof grant.stacks === "object") ) given.stacks = Math.max(readNumber(grant.stacks, self, fight), 1);

      // So can the temporary HP it holds
      if ( grant.hp && (typeof grant.hp === "object") ) given.hp = Math.max(readNumber(grant.hp, self, fight), 0);
      if ( grant.pick ) given.pick = grant.pick.map((option) => ({ ...option, effects: resolveGiven(option.effects ?? [], self) }));
      return given;
    }),
    source: source ?? skill,
    giver,
    // Only for an attack that deals damage, or that much of it
    damaged: (Number.isInteger(effect.damaged) && (effect.damaged > 1)) ? effect.damaged : !!effect.damaged,

    // What its chance divides its stat by, for a Skill of the unit's own that rolls to activate
    grade: mine ? activationGrade(proc) : null,
    ifHit: !!effect.ifHit,
    ifStruck: !!effect.ifStruck,
    ...part(effect),
    sequence: effect.sequence ? effect.sequence.map(part) : null,
    oneUse: !!effect.oneUse,
    negate: effect.negate ?? 0,
    reduce: (effect.reduce?.of === "itemMight") ? 0 : number(effect.reduce),
    reflect: effect.reflect ?? 0,
    retaliate,
    inflictsAttacker: effect.inflictsAttacker ?? [],
    survive: (effect.survive && (typeof effect.survive === "object")) ? { hp: { ...(effect.survive.hp ?? {}) } } : !!effect.survive,
    uses,
    shield: effect.shield ? numbers(effect.shield) : null,

    // At the moments of a block (see `blocking.mjs`): which kind of block the skill waits for, whether it
    // negates the block, what it takes off or multiplies what the block takes off; and when struck, what a
    // hit that was blocked with a Shield adds to the chance
    by: (BLOCK_MOMENTS.includes(proc.on) && BLOCK_KINDS.includes(proc.by)) ? proc.by : null,
    unblock: !!effect.unblock,
    blockLess: Math.max(number(effect.blockLess), 0),
    blockTimes: (effect.blockTimes !== undefined) ? Math.max(number(effect.blockTimes), 0) : 1,
    blockedChance: Number.isFinite(proc.blocked) ? proc.blocked : 0,

    // Uses the foe's weapon and Shield lose, at once or once the fight is over
    wears: (effect.wears && (typeof effect.wears === "object")) ? {
      weapon: wear(effect.wears.weapon),
      shield: wear(effect.wears.shield),
      after: !!effect.wears.after
    } : null,
    combat: numbers(effect.combat),
    foeCombat: numbers(effect.foeCombat)
  };
}

/* -------------------------------------------- */
/*  Moments of a Turn                           */
/* -------------------------------------------- */

/**
 * The effects of a unit's skills that wait for a moment of its turn and whose condition holds.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf & {waiting?: boolean}} self
 * @param {"turnStart"|"turnEnd"|"wait"} moment
 * @param {object} [options]
 * @param {Record<string, number>|null} [options.conditions]    The conditions the unit suffers from, where
 *                                                              that is known
 * @returns {{skill: string, effect: object, unseen?: boolean}[]}   `unseen` for an effect that hangs on where
 *          units stand, of a unit that is not on the map: it is shown, for the table to check
 */
export function turnEffects(skills, self, moment, { conditions = null } = {}) {
  self = withSkillNames(self, skills);
  const found = [];
  for ( const skill of skills ?? [] ) {
    // A skill that takes effect by itself and counts its uses has no moment once they are spent, or while its
    // cooldown runs
    const counts = (skill.usage?.kind === "auto") && !skill.aura && !skill.timed;
    if ( counts && (usesLeft(skill.usage, skill.state) === 0) ) continue;
    for ( const effect of skill.effects ?? [] ) {
      if ( effect.when?.declared && !skill.active ) continue;

      // What an aura gives at a moment of a turn comes at that moment of the turn of each unit that receives it
      if ( (effect.proc?.on !== moment) || effect.aura ) continue;
      const unseen = needsPlace(effect) && !seesPlace(effect, self, null);
      if ( !holds(unseen ? withoutPlace(effect.when) : effect.when, self, null) ) continue;

      // What only cures conditions has nothing to do for a unit that suffers from none of them
      const curesOnly = (effect.cure !== undefined) && Object.keys(effect).every((key) => ["proc", "when", "cure"].includes(key));
      if ( curesOnly && conditions && !curedOf(effect.cure, conditions).length ) continue;

      // With nobody in reach there is nothing to do
      if ( effect.reach && !unseen && !reached(self, effect.reach).length ) continue;
      if ( effect.spread && !unseen && !(spreadTo(effect.spread, self.near ?? null, null)?.length) ) continue;
      const grants = [].concat(effect.grant ?? []);
      if ( grants.length && !unseen && grants.every((grant) => grant.reach && !reachedBy(self, grant).length) ) continue;

      // Nor is there with a change that its unit is not granted as things stand, where that is all it does
      const only = Object.keys(effect).every((key) => ["proc", "when", "grant", "choice"].includes(key));
      if ( grants.length && only && grants.every((grant) => grant.when && !holds(grant.when, self, null)) ) continue;
      const entry = unseen ? { skill: skill.name, effect, unseen } : { skill: skill.name, effect };
      if ( skill.aura ) Object.assign(entry, { source: skill.skill, giver: skill.giver, from: skill.from });

      // A Skill of the unit's own, for what counts those that rolled to activate and did
      else if ( !skill.innate && !skill.timed && !skill.art ) entry.mine = true;
      if ( counts ) entry.uses = { id: skill.id ?? null, name: skill.name };
      found.push(entry);
    }
  }
  return found;
}

/* -------------------------------------------- */

/**
 * The units around a unit that an effect reaches at a moment of its turn: those that still stand.
 * @param {SkillSelf} self
 * @param {import("./positions.mjs").NearFilter} reach
 * @returns {import("./positions.mjs").Neighbour[]}
 */
function reached(self, reach) {
  return (unitsNear(self.near ?? null, reach) ?? []).filter((other) => reachable(other));
}

/* -------------------------------------------- */

/**
 * Of the units a lasting change reaches for, those whose stat is lower than that of the unit that grants it,
 * where the change is only for those: each by its stat as it stands.
 * @param {{stats?: Record<string, number>}} giver        The unit that grants it, with its stats as they stand
 * @param {import("./positions.mjs").Neighbour[]} units
 * @param {string} [over]                                 The stat that is held against the giver's
 * @returns {import("./positions.mjs").Neighbour[]}
 */
export function surpassed(giver, units, over) {
  if ( !over ) return units ?? [];
  const mine = giver?.stats?.[over] ?? 0;
  return (units ?? []).filter((other) => mine > ((other.totals ?? other.stats)?.[over] ?? 0));
}

/**
 * The units around a unit that a lasting change it grants at a moment of its turn is for.
 * @param {SkillSelf} self
 * @param {{reach: import("./positions.mjs").NearFilter, over?: string}} grant
 * @returns {import("./positions.mjs").Neighbour[]}
 */
function reachedBy(self, grant) {
  return surpassed(self, reached(self, grant.reach), grant.over);
}

/* -------------------------------------------- */

/**
 * The conditions a unit suffers from that an effect cures it of.
 * @param {"all"|string[]} cure                   Every condition, or the ones named
 * @param {Record<string, number>} conditions     The conditions the unit suffers from
 * @returns {string[]}
 */
function curedOf(cure, conditions) {
  const suffered = Object.keys(conditions ?? {});
  return (cure === "all") ? suffered : suffered.filter((id) => [].concat(cure ?? []).includes(id));
}

/* -------------------------------------------- */

/**
 * @typedef TurnMoment
 * @property {number} hpBefore
 * @property {number} hp                      HP once the skills have healed the unit
 * @property {number} healed
 * @property {{skill: string, sure: boolean, roll: number|null, chance: number, success: boolean, recover: number,
 *   healed: number, remind: boolean|string, cured?: string[], gold?: number,
 *   reached?: {id: string, name: string, hpBefore: number, hp: number, healed: number}[],
 *   granted?: {unit: string|null, name: string, change: import("./timed.mjs").TimedChange}[]}[]} entries
 *           Each skill that had its moment: its roll if it made one, the HP it would restore and the HP it
 *           did, and whether its effect is left for the table. `gold` is the gold it gives its unit, before
 *           what a map allows of it is counted (see `earnings.mjs`). `cured` lists the conditions it cures the unit
 *           of; `reached` lists the units around that it
 *           reached instead of its own, with the HP each regains; `granted` the changes that last a while
 *           which it grants, each for the unit itself (`unit: null`) or for one of the units around
 */

/**
 * What a unit's skills do at a moment of its turn. A skill that is sure of the moment rolls nothing, the
 * others roll their chance. A unit without HP does nothing.
 * @param {SkillEntry[]} skills
 * @param {SkillSelf & {waiting?: boolean, name?: string, uuid?: string}} self
 *                                                  The unit, with the stats it has now; its name and UUID
 *                                                  are kept on the changes it grants to others
 * @param {"turnStart"|"turnEnd"|"wait"} moment
 * @param {() => number} d100                       Returns a whole number from 1 to 100
 * @param {object} [options]
 * @param {number} [options.activation]             The unit's Skill Activation rate
 * @param {boolean} [options.always]                Do the unit's skills always activate?
 * @param {Record<string, number>|null} [options.conditions]    The conditions the unit suffers from, where
 *                                                  that is known: an effect cures it of none otherwise
 * @returns {TurnMoment}
 */
export function turnMoment(skills, self, moment, d100, { activation = 0, always = false, conditions = null, picks = null } = {}) {
  const hpBefore = self.hp ?? 0;
  let hp = hpBefore;
  const entries = [];
  const die = dieFrom(d100);
  const amount = (value, unit) => {
    if ( Array.isArray(value) ) return value.reduce((sum, part) => sum + readNumber(part, unit, null), 0);
    return readNumber(value ?? 0, unit, null);
  };
  // The skills that count their uses and have had their moment: each takes effect once at a moment of a turn
  const spent = new Set();
  for ( const { skill, effect, unseen, source, giver, from, uses, mine } of (hpBefore > 0) ? turnEffects(skills, self, moment, { conditions }) : [] ) {
    if ( uses && spent.has(uses.id ?? uses.name) ) continue;
    const sure = !!effect.proc.sure;
    const chance = chanceOf(effect.proc, self, null, { activation, always });
    const roll = sure ? null : d100();
    const remind = unseen ? "check" : (effect.remind ?? false);
    const entry = { skill, sure, roll, chance, success: sure || (roll <= chance), recover: 0, healed: 0, remind };

    // What its chance divides its stat by, for a Skill of the unit's own that rolled to activate and did
    const grade = (mine && !sure && entry.success) ? activationGrade(effect.proc) : null;
    if ( grade ) entry.grade = grade;

    // A skill that counts its uses is spent by the moment that takes effect, which whoever saves it sees to
    if ( uses && entry.success ) {
      entry.uses = uses;
      spent.add(uses.id ?? uses.name);
    }
    if ( entry.success ) {
      entry.recover = amount(effect.recover, { ...self, hp });

      // What reaches for the units around restores their HP, not the unit's own
      if ( effect.reach && !unseen ) {
        entry.reached = reached(self, effect.reach).map((other) => {
          const healed = (remind === "check") ? 0 : Math.max(Math.min(entry.recover, (other.hpMax ?? Infinity) - other.hp), 0);
          return { id: other.id, name: other.name, hpBefore: other.hp, hp: other.hp + healed, healed };
        });
      }

      // What hangs on something the system cannot see is shown, not applied
      else if ( (remind !== "check") && !effect.reach ) {
        entry.healed = Math.max(Math.min(entry.recover, (self.hpMax ?? Infinity) - hp), 0);
        hp += entry.healed;
      }

      // What it does to the units around (see `spread.mjs`): each unit caught, with what it gets and the change
      // it is left with, for whoever saves the moment to deal
      if ( effect.spread && !unseen && (remind !== "check") ) {
        const written = effect.spread;
        const mine = { ...self, hp };
        const out = spreadOut(written, self.near ?? null, null, { die, read: (value, unit) => readNumber(value, unit ?? mine, null) });
        if ( out?.units.length ) {
          let grant = null;
          if ( written.grant ) {
            const expanded = expandGrant(written.grant);
            grant = { ...expanded, effects: resolveGiven(expanded.effects ?? [], mine) };
            for ( const key of ["harm", "mend"] ) if ( expanded[key] && (typeof expanded[key] === "object") ) grant[key] = Math.max(readNumber(expanded[key], mine, null), 0);
          }
          const about = { skill: source ?? skill, from: self.name ?? "", giver: self.uuid ?? "", giverInTurn: (moment === "turnStart") || (moment === USE_MOMENT) };
          const settle = (share) => (grant ? { ...share, change: buildChange(spreadGrant(grant, share.inflicts), about) } : share);
          entry.spread = {
            units: out.units.map(settle),
            ...(out.choose ? { choose: out.choose, open: (out.open ?? []).map(settle) } : {}),
            ...(out.rolled ? { rolled: out.rolled } : {}),
            ...(written.element ? { element: written.element } : {}),
            ...(written.nonlethal ? { nonlethal: true } : {}),
            ...(written.push ? { push: { spaces: written.push.spaces ?? 1, blocked: written.push.blocked ?? 0 } } : {})
          };
        }
      }

      // Gold it gives its unit, as Income does: what hangs on something the system cannot see gives none.
      // It is told even where it comes to nothing, as for a unit that did not move
      if ( (effect.gold !== undefined) && (remind !== "check") && !effect.reach ) {
        entry.gold = Math.max(Math.floor(amount(effect.gold, { ...self, hp })), 0);
      }

      // Conditions the unit is cured of
      if ( (effect.cure !== undefined) && (remind !== "check") ) entry.cured = curedOf(effect.cure, conditions);

      // Conditions the unit is given: what an aura gives it is inflicted by the unit the aura comes from
      if ( effect.inflicts?.length && (remind !== "check") ) {
        entry.inflicts = effect.inflicts.map((given) => ((typeof given === "string") ? given : given.id)).filter(Boolean);
        if ( from ) entry.from = from;
      }

      // Changes that last a while: for the unit itself, which is in its turn as it starts, or for the units
      // around. Those for units that cannot be seen are left to the table
      // A skill whose own condition asks where units stand grants nothing while that cannot be seen
      const granted = [];
      const blind = unseen && asksPlace(effect.when);
      for ( const written of blind ? [] : [].concat(effect.grant ?? []) ) {
        // One that asks something of its giver is granted only where that holds
        if ( written?.when && !holds(written.when, { ...self, hp }, null) ) continue;
        const { when: asked, ...grant } = expandGrant(written);

        // What is for the unit an aura comes from is given in a fight alone
        if ( grant.to === "giver" ) continue;
        const found = (grant.reach && !unseen) ? reachedBy(self, grant) : [];

        // Stats its unit picks: those picked for it, unless `picks` names what whoever acts for it picked
        const carriers = grant.reach ? found.map((other) => other.totals ?? other.stats ?? {}) : [self.stats ?? {}];
        const effects = grant.choose ? chosenEffects(grant.choose, picks?.[source ?? skill] ?? [], carriers) : resolveGiven(grant.effects ?? [], { ...self, hp });
        if ( grant.choose && !effects.length ) continue;
        const given = { ...grant, effects };

        // Temporary HP and HP restored turn by turn that are read from the unit
        if ( grant.hp && (typeof grant.hp === "object") ) given.hp = Math.max(readNumber(grant.hp, { ...self, hp }, null), 0);
        if ( grant.mend && (typeof grant.mend === "object") ) given.mend = Math.max(readNumber(grant.mend, { ...self, hp }, null), 0);

        // Stats that dice pick, anew for each unit that is to carry the change
        const rolled = () => {
          if ( !grant.random ) return given;
          const { effects: gained, stats } = randomEffects(grant.random, die);
          if ( !gained.length ) return null;
          const name = grant.random.apart ? `${grant.name ?? source ?? skill} (${stats.map((key) => key.toUpperCase()).join(", ")})` : grant.name;
          return { ...given, effects: gained, ...(name ? { name } : {}) };
        };
        const choose = grant.choose ? { choose: { ...grant.choose } } : {};
        const inTurn = (moment === "turnStart") || (moment === USE_MOMENT);
        if ( !grant.reach ) {
          const mine = rolled();
          if ( mine ) granted.push({
            unit: null,
            name: self.name ?? "",
            change: buildChange(mine, { skill: source ?? skill, from: giver ?? "", own: !giver, carrierInTurn: inTurn }),
            ...choose
          });
        }
        else {
          for ( const other of found ) {
            const theirs = rolled();
            if ( theirs ) granted.push({
              unit: other.id,
              name: other.name,
              change: buildChange(theirs, { skill: source ?? skill, from: self.name ?? "", giver: self.uuid ?? "", giverInTurn: inTurn }),
              ...choose
            });
          }
        }
      }
      if ( granted.length ) entry.granted = granted;
    }
    entries.push(entry);
  }
  return { hpBefore, hp, healed: hp - hpBefore, entries };
}

/* -------------------------------------------- */

/**
 * The d100s a moment of a unit's turn may need: one for each skill that rolls for it, and those of the changes
 * whose stats dice pick, for the unit itself or for a few units around.
 * @param {{effect: object}[]} waiting      The effects that have their moment, as `turnEffects` lists them
 * @returns {number}
 */
export function momentDice(waiting) {
  return (waiting ?? []).reduce((sum, { effect }) => {
    const dice = [].concat(effect.grant ?? []).reduce((count, grant) => {
      if ( !grant?.random ) return count;
      const each = ((typeof grant.random.pick === "object") ? 1 : 0)
        + (Math.min(grant.random.pick?.dice ?? grant.random.pick ?? 1, (grant.random.stats ?? []).length) * ((typeof grant.random.amount === "object") ? 2 : 1));
      return count + (each * (grant.reach ? 8 : 1));
    }, 0);

    // And the dice that pick the units a spread goes to
    const picks = (effect.spread?.pick === "random") ? (effect.spread.targets ?? 1) : 0;
    return sum + (effect.proc?.sure ? 0 : 1) + dice + picks;
  }, 0);
}

/* -------------------------------------------- */

/**
 * What a skill leaves on its unit as it is used as an action: the changes it grants at that moment.
 * @param {SkillEntry} skill                        The skill that is used
 * @param {SkillSelf & {name?: string, uuid?: string}} self
 * @param {() => number} d100                       Returns a whole number from 1 to 100
 * @returns {TurnMoment}
 */
export function useMoment(skill, self, d100) {
  return turnMoment([{ ...skill, active: true }], self, USE_MOMENT, d100);
}

/* -------------------------------------------- */
/*  Describing Effects                          */
/* -------------------------------------------- */

/**
 * How far the system applies a skill's Effect by itself: "done" when it applies all of it, "part" when it
 * applies some and the table does the rest by hand, "text" when it only shows the Effect.
 */
export const COVERAGE = ["done", "part", "text"];

/**
 * How far the system applies a skill's Effect by itself.
 * @param {object} [skill]
 * @param {string} [skill.effect]     Its Effect text
 * @param {boolean} [skill.listed]    Are its effects written out for the system?
 * @param {string} [skill.left]       What the table still does by hand
 * @param {boolean} [skill.boost]     Is its Effect nothing but a flat bonus, kept in its boosts?
 * @returns {"done"|"part"|"text"}
 */
export function coverageOf({ effect = "", listed = false, left = "", boost = false } = {}) {
  if ( left ) return "part";
  if ( listed || boost || !String(effect).trim() ) return "done";
  return "text";
}

/* -------------------------------------------- */

/**
 * Does a skill have an Effect that nothing accounts for? One with Effect text has effects the system applies,
 * or a flat bonus read from its text, or a way it is used, or a `note` that says why it needs none of them
 * (or a `left` that says what the table does by hand). The build stops at a skill that has none of these, so
 * that none is counted as done with nothing behind it.
 * @param {object} [skill]
 * @param {string} [skill.effect]     Its Effect text
 * @param {object[]} [skill.effects]  What the system applies for it
 * @param {boolean} [skill.boost]     Is its Effect nothing but a flat bonus, kept in its boosts?
 * @param {string} [skill.usage]      How it is used, where it is chosen when to activate: its `usage.kind`
 * @param {string} [skill.note]       How the system reads it
 * @param {string} [skill.left]       What the table still does by hand
 * @returns {boolean}
 */
export function unaccounted({ effect = "", effects = [], boost = false, usage = "", note = "", left = "" } = {}) {
  if ( !String(effect).trim() ) return false;
  return !(effects?.length || boost || usage || String(note).trim() || String(left).trim());
}

/**
 * Check a list of effects for parts the rules do not know, so that a typing mistake does not pass silently.
 * @param {object[]} effects
 * @returns {string[]}      What is wrong, in plain words; empty when nothing is
 */
export function checkEffects(effects) {
  const problems = [];
  const known = ["consumes", "choice", "when", "stats", "abilities", "statPercent", "combat", "might", "taken", "takenPercent", "hpMax", "calc",
    "rules", "effective", "effectiveMultiplier", "damageMultiplier", "ignoreDefence", "strikes", "extraAttack", "scale",
    "foeActivation", "endurance", "haste", "mirrorCrit", "critMultiplier", "slots", "capacity", "artCost", "dealtPercent", "aura", "expMultiplier", "bexp", "staffExp", "growths",
    "weaponRange", "damageStat", "foeWear", "wield", "rank", "shift", "form", "warp", "foeStats", "stars", "firstMight", "crossing", "passing", "canto", "curbsCanto",
    "shove", "act", "carry", "refresh", "block", "lostOnBlock", "weaponUse", "trade", "spend", "single", "noWeight", "against", "hitCap", "foeBonus",
    "cooldowns", "rearm", "speedLead", "triangle", "handover", "uneffective", "effectiveTaken", "combatTimes", "foeCombat", "echo", "statTimes", "until", "firstAttack", "critFloor", "assures", "lend", "creatures", "imitation", "bonuses", ...KNACK_KEYS, ...STANDING_KEYS, ...BEND_KEYS, ...STAFF_KEYS];
  const procParts = ["sureCrit", "forfeit", "nextOfNegated", "keep", "pays", "unblock", "blockLess", "blockTimes", "wears", "noBlock", "cancels", "excess", "again", "order", "cuts", "stat", "chain", "healTimes",
    "damage", "damagePercent", "damageOfFoeHp", "healPlus", "statTimes", "ignore", "hit", "critical", "heal", "sureHit", "inflicts",
    "sequence", "oneUse", "negate", "reduce", "reflect", "retaliate", "resist", "inflictsAttacker", "survive", "foeCombat",
    "next", "nextOfDamage", "near", "nonlethal", "recover", "attack", "remind", "damaged", "ifHit", "ifStruck", "end", "reach", "grant",
    "gold", "goldPerGain", "reroll", "freeUses", "returns", "harmNear", "shield", "gaugeOfDamage", "cure", "acts", "step", "refreshes", "asCrit",
    "dodge", "cancel", "plain", "forgoExp", "splash", "costs", "foils", "statPlus", "slay", "instead", "cut", "defend", "foeStatTimes", "spread", "betters",
    "loot", "unequips", "amplify", "makes"];
  const staffing = (effect) => STAFF_MOMENTS.includes(effect?.proc?.on);
  const grantParts = ["to", "reach", "around", "name", "effects", "pick", "ends", "turns", "next", "clock", "max", "stacks", "fades", "gained", "now", "hp", "kill", "once", "drop",
    "choose", "staff", "over", "wait", "lone", "mend", "spoils", "random", "when", "grows", "harm", "mark", "stance", "unique"];

  // The moments of an attack whose damage a lasting change can be read from, or that can pick one by a die
  const striking = (effect) => ["attack", "hit", "crit"].includes(effect?.proc?.on);
  const isCondition = (id) => (id in FEO.conditions) || (id in FEO.optionalConditions);
  const afflicting = (effect) => CONDITION_MOMENTS.includes(effect?.proc?.on);
  const levelling = (effect) => LEVEL_MOMENTS.includes(effect?.proc?.on);
  const nextParts = ["hit", "damage", "critical"];
  const procCombat = ["hit", "damage", "critical", "dodge"];
  const using = (effect) => effect?.proc?.on === USE_MOMENT;
  const sequenceParts = ["damage", "damagePercent", "damageMultiplier", "statTimes", "ignore", "hit", "critical", "heal",
    "sureHit", "sureCrit", "inflicts", "share", "end", "noBlock", "asCrit", "effective", "against", "might", "stat"];
  const conditions = ["shield", "hp", "weapon", "weaponNot", "weaponSlays", "quality", "lacks", "skill", "noSkill", "carries", "waiting", "shifted", "declared", "early", "near", "terrain", "standsOn", "noModule", "module", "tier",
    "gender", "bestRank", "weaponReach", "lasting", "equal", "over", "dismounted", ...CLOCK_KEYS, ...MOVE_KEYS, ...FIGHT_KEYS];
  const ops = ["le", "lt", "ge", "gt", "full", "notFull"];
  const filterParts = ["who", "within", "from", "quality", "class", "min", "max", "carries", "marked", "sees", "seen"];
  const auraParts = ["who", "within", "from", "self", "when", "once", "through", "unsummoned", "stack"];
  if ( !Array.isArray(effects) ) return ["effects must be a list"];

  // The units around a unit that a skill names
  const checkFilter = (filter, at, what, parts = filterParts) => {
    if ( !filter || (typeof filter !== "object") ) return problems.push(`${at}: ${what} must say which units`);

    // Only an aura can be for every unit around, whatever its side
    const sides = (parts === auraParts) ? ["ally", "enemy", "any"] : ["ally", "enemy"];
    if ( !sides.includes(filter.who) ) problems.push(`${at}: ${what} is for ${sides.map((side) => `"${side}"`).join(" or ")}, not "${filter.who}"`);
    for ( const key of Object.keys(filter) ) if ( !parts.includes(key) ) problems.push(`${at}: ${what} cannot say "${key}"`);
    return null;
  };
  effects.forEach((effect, index) => {
    const at = `effect ${index + 1}`;
    const proc = effect?.proc;
    for ( const key of Object.keys(effect ?? {}) ) {
      if ( known.includes(key) || (key === "proc") || (proc && procParts.includes(key)) ) continue;

      // Without a moment, a reminder can only mark an effect as one to check by hand
      if ( (key === "remind") && (effect.remind === "check") ) continue;
      problems.push(`${at}: unknown part "${key}"`);
    }
    // A quality the unit takes on at will is the one the effect asks for, and its boosts are always there
    if ( effect?.form !== undefined ) {
      if ( effect.form !== true ) problems.push(`${at}: "form" is true or left out, not "${effect.form}"`);
      if ( !effect.when?.quality?.length ) problems.push(`${at}: a form needs the Special Quality it asks for`);
      if ( proc || effect.aura ) problems.push(`${at}: a form is always there, not at a moment or as an aura`);
    }
    if ( effect?.when?.near ) checkFilter(effect.when.near, at, "near");
    if ( effect?.when?.foeNear ) checkFilter(effect.when.foeNear, at, "foeNear");
    if ( effect?.when?.formation !== undefined ) {
      const formation = effect.when.formation;
      const spaces = (value) => (value === undefined) || (Number.isInteger(value) && (value >= 1));
      if ( !formation || (typeof formation !== "object") || (typeof formation.with !== "string") || !formation.with ) {
        problems.push(`${at}: formation names the skill the allies of it have: { with: "Skill", others: 2, from: 1, within: 2 }`);
      }
      else {
        if ( (formation.others ?? 2) !== 2 ) problems.push(`${at}: a formation is the unit and 2 others`);
        if ( !spaces(formation.from) || !spaces(formation.within) ) problems.push(`${at}: formation: from and within are whole numbers of spaces`);
        for ( const key of Object.keys(formation) ) if ( !["with", "others", "from", "within"].includes(key) ) problems.push(`${at}: formation: unknown part "${key}"`);
      }
    }
    if ( effect?.reach ) checkFilter(effect.reach, at, "reach");

    // What it does to the units around (see `spread.mjs`), with the change it leaves on each
    if ( effect?.spread !== undefined ) {
      for ( const problem of checkSpread(effect.spread, proc ?? null, { conditions: [...Object.keys(FEO.conditions), ...Object.keys(FEO.optionalConditions ?? {})] }) ) problems.push(`${at}: ${problem}`);
      if ( effect.aura ) problems.push(`${at}: a spread is its own unit's, not an aura`);
      const left = effect.spread?.grant;
      if ( left !== undefined ) {
        if ( !left || (typeof left !== "object") || Array.isArray(left) ) problems.push(`${at}: the change a spread leaves is one lasting change`);
        else {
          for ( const key of Object.keys(left) ) if ( !["name", "effects", "ends", "turns", "next", "harm", "mend", "mark", "hp"].includes(key) ) problems.push(`${at}: the change a spread leaves cannot say "${key}"`);
          if ( !TIMED_ENDS.includes(left.ends) ) problems.push(`${at}: the change a spread leaves ends at ${TIMED_ENDS.map((end) => `"${end}"`).join(", ")}`);
          if ( (left.turns === "condition") ? !effect.spread.inflicts?.length : ((left.turns !== undefined) && !(Number.isInteger(left.turns) && (left.turns >= 1))) ) {
            problems.push(`${at}: the change a spread leaves lasts a whole number of turns, or as long as the "condition" it inflicts`);
          }
          if ( (left.effects ?? []).some((part) => part.proc || part.aura || part.grant) ) problems.push(`${at}: the effects of a lasting change cannot wait for a moment, be an aura or grant another`);
          else for ( const problem of checkEffects(left.effects ?? []) ) problems.push(`${at}: in the change its spread leaves, ${problem}`);
        }
      }
    }

    // A change that lasts a while: who carries it, when it ends, and effects that are themselves in order
    for ( const grant of [].concat(effect?.grant ?? []) ) {
      for ( const key of Object.keys(grant ?? {}) ) if ( !grantParts.includes(key) ) problems.push(`${at}: a lasting change cannot say "${key}"`);
      if ( grant?.reach ) checkFilter(grant.reach, at, "the reach of a lasting change");
      else if ( (grant?.to === "target") && staffing(effect) ) {
        // The unit a staff is used on
      }
      else if ( (grant?.to === "giver") && effect?.aura && !TURN_MOMENTS.includes(effect?.proc?.on) ) {
        // The unit an aura comes from, which is granted its own change in a fight of the unit that receives it
      }
      else if ( !["self", "foe"].includes(grant?.to) ) problems.push(`${at}: a lasting change is for "self", "foe" or a reach, not "${grant?.to}"`);

      // One that only takes from a tally says whose it is and by how much
      if ( grant?.drop !== undefined ) {
        if ( !((Number.isInteger(grant.drop) && (grant.drop >= 1)) || (grant.drop === "all")) ) problems.push(`${at}: a tally drops by a whole number, or "all"`);
        for ( const key of Object.keys(grant) ) if ( !["to", "reach", "around", "name", "drop", "now"].includes(key) ) problems.push(`${at}: what takes from a tally cannot say "${key}"`);
        continue;
      }
      // A stance is entered by the skill's own unit, as the skill is used
      if ( grant?.stance !== undefined ) {
        for ( const problem of checkStance(grant.stance) ) problems.push(`${at}: ${problem}`);
        if ( (grant.to !== "self") || !using(effect) ) problems.push(`${at}: a stance is entered by the skill's own unit as the skill is used`);
      }
      if ( (grant?.once !== undefined) && !TIMED_ONCE.includes(grant.once) ) problems.push(`${at}: a lasting change is used up "once" by a fight its unit will ${TIMED_ONCE.map((kind) => `"${kind}"`).join(", ")}, not "${grant.once}"`);
      // One that does what a staff does to its target lasts as that staff says, unless it says otherwise
      if ( grant?.staff !== undefined ) {
        if ( !(grant.staff in (FEO.staffChanges ?? {})) ) problems.push(`${at}: no staff's doing is written as a lasting change under "${grant.staff}"`);
        if ( (grant.effects !== undefined) || (grant.pick !== undefined) || (grant.choose !== undefined) ) problems.push(`${at}: a lasting change does what a "staff" does, or has effects of its own, not both`);
        if ( (grant.ends !== undefined) && !TIMED_ENDS.includes(grant.ends) ) problems.push(`${at}: a lasting change ends at ${TIMED_ENDS.map((end) => `"${end}"`).join(", ")}, not "${grant.ends}"`);
        continue;
      }
      if ( (grant?.over !== undefined) && (!grant.reach || !(grant.over in FEO.stats)) ) problems.push(`${at}: "over" names the stat the units in reach must have less of than the unit`);
      if ( !TIMED_ENDS.includes(grant?.ends) ) problems.push(`${at}: a lasting change ends at ${TIMED_ENDS.map((end) => `"${end}"`).join(", ")}, not "${grant?.ends}"`);

      // Temporary HP it holds for its unit, and in a fight, whether it waits for the foe to be defeated
      if ( (grant?.hp !== undefined) && !(Number.isFinite(grant.hp) || (grant.hp && (typeof grant.hp === "object") && (grant.hp.of !== undefined))) ) {
        problems.push(`${at}: the temporary HP of a lasting change are a number`);
      }
      if ( (grant?.kill !== undefined) && ((grant.kill !== true) || !["after", "hit", "crit", "attack"].includes(effect?.proc?.on)) ) {
        problems.push(`${at}: a lasting change waits for a "kill" only at a moment of a fight, and then says true`);
      }
      if ( ![undefined, "giver"].includes(grant?.clock) ) problems.push(`${at}: the turns of a lasting change are its unit's or the "giver"'s, not "${grant.clock}"`);
      if ( ![undefined, "foe"].includes(grant?.around) ) problems.push(`${at}: a lasting change reaches around the unit or around the "foe", not "${grant.around}"`);

      // One that lasts as long as a condition does is granted as that condition is inflicted
      if ( (grant?.turns === "condition") && !afflicting(effect) ) problems.push(`${at}: a lasting change lasts as long as a "condition" only where one is inflicted`);
      else if ( (grant?.turns !== undefined) && (grant.turns !== "condition") && !(Number.isInteger(grant.turns) && (grant.turns >= 1)) ) {
        problems.push(`${at}: a lasting change lasts a whole number of turns, not "${grant.turns}"`);
      }
      // One of several changes, picked by a die as an attack is made or lands: each is checked as a change
      // of its own
      if ( grant?.pick !== undefined ) {
        if ( !striking(effect) ) problems.push(`${at}: a lasting change is picked by a die on an "attack", a "hit" or a "crit"`);
        if ( grant.effects !== undefined ) problems.push(`${at}: a lasting change has "effects" or a "pick" of them, not both`);
        if ( !Array.isArray(grant.pick) || (grant.pick.length < 2) ) problems.push(`${at}: a "pick" lists the changes to pick from`);
        else grant.pick.forEach((option) => {
          for ( const key of Object.keys(option ?? {}) ) if ( !["name", "effects"].includes(key) ) problems.push(`${at}: a change to pick cannot say "${key}"`);
          if ( !Array.isArray(option?.effects) || !option.effects.length ) problems.push(`${at}: a change to pick needs effects`);
          else if ( option.effects.some((part) => part.proc || part.aura || part.grant) ) problems.push(`${at}: the effects of a lasting change cannot wait for a moment, be an aura or grant another`);
          else for ( const problem of checkEffects(option.effects) ) problems.push(`${at}: in a change to pick, ${problem}`);
        });
        continue;
      }
      // Stats picked by whoever acts for the unit that grants it, in a fight or at a moment of its turn
      if ( grant?.choose !== undefined ) {
        const choose = grant.choose;
        if ( grant.effects !== undefined ) problems.push(`${at}: a lasting change has "effects" or has stats chosen, not both`);
        if ( staffing(effect) || levelling(effect) || afflicting(effect) ) problems.push(`${at}: stats are chosen for a lasting change in a fight or at a moment of a turn`);
        if ( !choose || (typeof choose !== "object") ) problems.push(`${at}: "choose" lists the stats to pick from, how many, and the amount`);
        else {
          for ( const key of Object.keys(choose) ) if ( !["stats", "pick", "amount"].includes(key) ) problems.push(`${at}: "choose" cannot say "${key}"`);
          if ( !Array.isArray(choose.stats) || (choose.stats.length < 2) || choose.stats.some((key) => !(key in FEO.stats)) ) problems.push(`${at}: "choose" lists two stats or more to pick from`);
          else if ( (choose.pick !== undefined) && !(Number.isInteger(choose.pick) && (choose.pick >= 1) && (choose.pick < choose.stats.length)) ) {
            problems.push(`${at}: "choose" picks fewer stats than it lists, one at least`);
          }
          if ( !Number.isFinite(choose.amount) || !choose.amount ) problems.push(`${at}: "choose" names the amount added to each stat picked`);
        }
        continue;
      }
      if ( readsDealt(grant, ["dealt"]) && !striking(effect) ) problems.push(`${at}: a lasting change is read from the damage "dealt" on an "attack", a "hit" or a "crit"`);

      // A tally that grows by more than one at a time, and one whose effects read what it holds
      if ( grant?.grows !== undefined ) {
        const amount = grant.grows;
        const read = amount && (typeof amount === "object") && HIT_SOURCES.includes(amount.of);
        if ( !(read || (Number.isInteger(amount) && (amount >= 1) && (amount <= COUNT_MOST))) ) problems.push(`${at}: a tally "grows" by a whole number, or by one read from the hit that grants it`);
        if ( !(grant.max > 0) ) problems.push(`${at}: what "grows" is a tally, which names the most it counts to as "max"`);
      }
      if ( (grant?.max !== undefined) && !(Number.isInteger(grant.max) && (grant.max >= 1) && (grant.max <= COUNT_MOST)) ) {
        problems.push(`${at}: a tally counts to a whole "max", ${COUNT_MOST} at the most`);
      }
      const counted = (value) => {
        if ( Array.isArray(value) ) return value.some(counted);
        return !!value && (typeof value === "object") && ((value.of === COUNT_SOURCE) || Object.values(value).some(counted));
      };
      if ( counted(grant?.effects) && !(grant.max > 0) ) problems.push(`${at}: only the effects of a tally, which names its "max", read its "count"`);
      if ( readsDealt(grant, ["negated", "taken"]) && (effect?.proc?.on !== "struck") ) problems.push(`${at}: a lasting change is read from what was "negated" or "taken" when its unit is "struck"`);

      // One that waits for a turn to begin, restores HP turn by turn, is spoilt by a second, or asks something
      // of its giver
      if ( (grant?.wait !== undefined) && !(Number.isInteger(grant.wait) && (grant.wait >= 1)) ) problems.push(`${at}: a lasting change waits a whole number of turns to begin`);
      if ( (grant?.wait !== undefined) && (grant.ends === "phaseEnd") ) problems.push(`${at}: a lasting change that waits for a turn to begin ends by turns, or with the map`);
      if ( (grant?.lone !== undefined) && !((grant.lone === true) && grant.wait) ) problems.push(`${at}: "lone" is true, beside "wait"`);
      if ( (grant?.spoils !== undefined) && (grant.spoils !== true) ) problems.push(`${at}: "spoils" is true or left out`);
      if ( (grant?.mend !== undefined) && !(Number.isFinite(grant.mend) || (grant.mend && (typeof grant.mend === "object") && (grant.mend.of !== undefined))) ) {
        problems.push(`${at}: what a lasting change restores each turn is a number, or one read from the unit`);
      }
      if ( (grant?.harm !== undefined) && !(Number.isFinite(grant.harm) || (grant.harm && (typeof grant.harm === "object") && (grant.harm.of !== undefined))) ) {
        problems.push(`${at}: the damage a lasting change deals as the next turn of its unit starts is a number, or one read from the unit`);
      }
      if ( (grant?.mark !== undefined) && (grant.mark !== true) ) problems.push(`${at}: "mark" is true or left out`);
      if ( grant?.when !== undefined ) {
        if ( !grant.when || (typeof grant.when !== "object") ) problems.push(`${at}: what a lasting change asks of its giver is a condition`);
        else for ( const key of Object.keys(grant.when) ) if ( !conditions.includes(key) ) problems.push(`${at}: unknown condition "${key}"`);
      }

      // Stats that dice pick
      if ( grant?.random !== undefined ) {
        const random = grant.random;
        const diced = (value) => (Number.isInteger(value) && (value >= 1)) || (value && (typeof value === "object") && Number.isInteger(value.dice) && (value.dice >= 2) && (Object.keys(value).length === 1));
        if ( (grant.effects !== undefined) || (grant.pick !== undefined) || (grant.choose !== undefined) ) problems.push(`${at}: a lasting change has "effects" or has dice pick its stats, not both`);
        if ( !random || (typeof random !== "object") ) problems.push(`${at}: "random" lists the stats, how many dice pick and what each gains`);
        else {
          for ( const key of Object.keys(random) ) if ( !["stats", "pick", "amount", "apart"].includes(key) ) problems.push(`${at}: stats that dice pick cannot say "${key}"`);
          if ( !Array.isArray(random.stats) || !random.stats.length || random.stats.some((key) => !(key in FEO.stats)) ) problems.push(`${at}: "random" lists stats`);
          if ( (random.pick !== undefined) && !diced(random.pick) ) problems.push(`${at}: how many stats dice pick is a whole number, or a die: { dice: 3 }`);
          if ( !(diced(random.amount) || (Number.isInteger(random.amount) && (random.amount !== 0))) ) problems.push(`${at}: what a stat dice pick gains is a whole number, or a die: { dice: 5 }`);
          if ( (random.apart !== undefined) && (random.apart !== true) ) problems.push(`${at}: "apart" is true or left out`);
        }
      }
      const inner = Array.isArray(grant?.effects) ? grant.effects : null;

      // At a level up a lasting change can be a boost in every stat the level up raised, for the unit itself
      if ( grant?.gained !== undefined ) {
        if ( !levelling(effect) ) problems.push(`${at}: only a level up has stats it raised to boost`);
        else if ( !Number.isFinite(grant.gained) || inner ) problems.push(`${at}: a boost in the stats a level up raised is a number, without effects`);
        else if ( grant.to !== "self" ) problems.push(`${at}: a boost in the stats a level up raised is for "self"`);
        continue;
      }
      if ( levelling(effect) && (grant?.reach || (grant?.to !== "self")) ) problems.push(`${at}: at a level up a lasting change is for "self"`);
      if ( !inner?.length && (grant?.hp === undefined) && (grant?.random === undefined) && (grant?.mend === undefined) && (grant?.harm === undefined) && !grant?.mark ) problems.push(`${at}: a lasting change needs effects`);
      else if ( (inner ?? []).some((part) => part.proc || part.aura || part.grant) ) problems.push(`${at}: the effects of a lasting change cannot wait for a moment, be an aura or grant another`);
      else for ( const problem of checkEffects(inner ?? []) ) problems.push(`${at}: in its lasting change, ${problem}`);
    }
    // A stat multiplied once everything is added to it; on an attack, a stat counted so many times for it
    if ( effect?.statTimes !== undefined ) {
      const times = Object.entries(effect.statTimes ?? {});
      if ( !times.length || times.some(([key, value]) => !(key in FEO.stats) || !Number.isFinite(value) || (value < 0)) ) problems.push(`${at}: "statTimes" multiplies stats by numbers, 0 at least`);
      if ( !proc && effect.aura ) problems.push(`${at}: a stat is multiplied for the skill's own unit or in a lasting change, not by an aura`);
    }
    if ( effect?.foeStatTimes !== undefined ) {
      const times = Object.entries(effect.foeStatTimes ?? {});
      if ( proc?.on !== "attack" ) problems.push(`${at}: a stat of the foe counts so many times for an attack, on an "attack"`);
      if ( !times.length || times.some(([key, value]) => !(key in FEO.stats) || !Number.isFinite(value) || (value < 0)) ) problems.push(`${at}: "foeStatTimes" multiplies stats of the foe by numbers, 0 at least`);
    }

    // What lasts only a part of a fight is always there until then
    if ( effect?.until !== undefined ) {
      if ( !UNTIL.includes(effect.until) ) problems.push(`${at}: an effect lasts "until" ${UNTIL.map((key) => `"${key}"`).join(", ")}, not "${effect.until}"`);
      if ( proc || effect.aura ) problems.push(`${at}: what lasts "until" a part of a fight is always there, not at a moment or as an aura`);
    }

    // A condition for the attacker comes when its attack lands, or as its unit is attacked
    if ( effect?.inflictsAttacker !== undefined && proc && !["struck", "attacked"].includes(proc.on) ) {
      problems.push(`${at}: a condition is given to the attacker when "struck", or as the unit is "attacked"`);
    }
    for ( const filter of placeCounts(effect ?? {}) ) checkFilter(filter, at, "count");
    for ( const key of ["noModule", "module"] ) {
      const named = effect?.when?.[key];
      if ( named && !(named in (FEO.optional ?? {})) && !(FEO.optionalAwaited ?? []).includes(named) ) problems.push(`${at}: unknown module "${named}"`);
    }

    // The unit's class tier, its gender and where its highest weapon rank lies, asked of the unit itself or
    // of each unit in an aura
    for ( const asked of [effect?.when, effect?.aura?.when] ) {
      if ( asked?.tier !== undefined ) {
        const bounds = Object.entries(asked.tier ?? {});
        if ( !bounds.length || bounds.some(([key, value]) => !["min", "max"].includes(key) || !Number.isInteger(value)) ) {
          problems.push(`${at}: a class tier is asked by a whole "min" or "max"`);
        }
      }
      if ( (asked?.gender !== undefined) && !["male", "female"].includes(asked.gender) ) problems.push(`${at}: gender is "male" or "female", not "${asked.gender}"`);
      if ( (asked?.bestRank !== undefined) && !["physical", "magical"].includes(asked.bestRank) ) {
        problems.push(`${at}: the highest weapon rank is "physical" or "magical", not "${asked.bestRank}"`);
      }
    }
    if ( effect?.stars !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: Leadership Stars are always there, not at a moment or as an aura`);
    }

    // The turn of the battle and the Phase that is running, asked of the skill's own unit or of each unit in
    // an aura; and what only a moment of a fight or a skill that counts its uses can say
    for ( const asked of [effect?.when, effect?.aura?.when] ) {
      for ( const problem of checkClock(asked, Object.keys(FEO.armies ?? {})) ) problems.push(`${at}: ${problem}`);
    }
    if ( effect?.critFloor !== undefined ) {
      if ( proc ) problems.push(`${at}: "critFloor" is always there, not at a moment`);
      if ( !(Number.isFinite(effect.critFloor) && (effect.critFloor > 0) && (effect.critFloor <= 100)) && !(effect.critFloor && (typeof effect.critFloor === "object")) ) {
        problems.push(`${at}: "critFloor" is a chance in percent`);
      }
    }
    if ( effect?.sureCrit !== undefined ) {
      if ( (effect.sureCrit !== true) || (proc?.on !== "attack") ) problems.push(`${at}: "sureCrit" is true, on an "attack"`);
    }
    if ( effect?.forfeit !== undefined ) {
      if ( (effect.forfeit !== true) || !proc?.sure || !PROC_TRIGGERS.includes(proc.on) ) problems.push(`${at}: "forfeit" is true, at a sure moment of a fight`);
      if ( Object.keys(effect).some((key) => !["proc", "when", "choice", "forfeit"].includes(key)) ) problems.push(`${at}: a moment that gives its skill up stands alone in its effect`);
    }
    if ( (proc?.on === NO_CRIT_MOMENT) && (!proc.sure || Object.keys(effect).some((key) => !["proc", "when", "choice", "grant", "remind"].includes(key))) ) {
      problems.push(`${at}: an attack that is no critical hit is a sure moment, which grants a lasting change or is announced`);
    }

    // How the unit moved this turn: asked of the skill's own unit, in plain answers
    const walk = effect?.when ?? {};
    for ( const key of ["moved", "fullMove", "weaponKept", "movedThrough", "movedThroughFoe", "early", "over", "dismounted"] ) {
      if ( (walk[key] !== undefined) && (typeof walk[key] !== "boolean") ) problems.push(`${at}: "${key}" is true or false`);
    }

    // What a skill lends its unit (see `lending.mjs`), and the chance of another skill that betters it
    if ( effect?.lend !== undefined ) for ( const problem of checkLend(effect.lend, effect) ) problems.push(`${at}: ${problem}`);
    if ( (proc?.on === LEND_MOMENT) || (effect?.betters !== undefined) ) {
      if ( (proc?.on !== LEND_MOMENT) || (typeof effect.betters !== "string") || !effect.betters ) {
        problems.push(`${at}: as a fight is started with a "lend"-ed weapon, a chance "betters" the weapon of the skill it names`);
      }
      for ( const key of Object.keys(effect) ) if ( !["proc", "when", "choice", "betters"].includes(key) ) problems.push(`${at}: what betters a lent weapon cannot say "${key}"`);
    }
    if ( walk.movLeft !== undefined ) {
      const bounds = Object.entries(walk.movLeft ?? {});
      if ( !bounds.length || bounds.some(([key, value]) => !["min", "max"].includes(key) || !Number.isInteger(value)) ) {
        problems.push(`${at}: the MOV left is asked by a whole "min" or "max"`);
      }
    }
    for ( const key of MOVE_KEYS ) {
      if ( effect?.aura?.when?.[key] !== undefined ) problems.push(`${at}: the units in an aura cannot be asked "${key}"`);
    }
    if ( (effect?.firstMight !== undefined) && (proc || effect.aura) ) {
      problems.push(`${at}: "firstMight" is always there, not at a moment or as an aura`);
    }

    // What a skill makes of the weapon triangle: always there, or for one attack, where it stands alone. And
    // what one weapon hands to the next, which is the unit's own
    if ( effect?.triangle !== undefined ) {
      for ( const problem of checkTriangle(effect.triangle, { moment: !!proc }) ) problems.push(`${at}: ${problem}`);
      if ( proc && (proc.on !== "attack") ) problems.push(`${at}: at a moment the triangle is bent on an "attack"`);
      if ( proc && Object.keys(effect).some((key) => !["proc", "when", "choice", "triangle"].includes(key)) ) {
        problems.push(`${at}: what bends the triangle for an attack stands alone in its effect`);
      }
    }
    if ( effect?.handover !== undefined ) {
      for ( const problem of checkHandover(effect.handover) ) problems.push(`${at}: ${problem}`);
      if ( proc || effect.aura ) problems.push(`${at}: "handover" is always there, not at a moment or as an aura`);
    }

    // What units stand on: asked of the skill's own unit and of its foe, by kinds of terrain the table knows
    for ( const key of ["terrain", "foeTerrain"] ) {
      if ( (walk[key] !== undefined) && (typeof walk[key] !== "boolean") ) problems.push(`${at}: "${key}" is true or false`);
    }
    for ( const key of ["standsOn", "foeOn"] ) {
      if ( walk[key] === undefined ) continue;
      if ( !Array.isArray(walk[key]) || !walk[key].length ) problems.push(`${at}: "${key}" lists kinds of terrain`);
      else for ( const kind of walk[key] ) if ( !(kind in FEO.terrain.types) ) problems.push(`${at}: unknown terrain "${kind}"`);
    }
    for ( const key of ["standsOn", ...FOE_GROUND_KEYS] ) {
      if ( effect?.aura?.when?.[key] !== undefined ) problems.push(`${at}: the units in an aura cannot be asked "${key}"`);
    }

    // How the unit crosses terrain: always there, and judged before it is known where the unit stands
    if ( effect?.crossing !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "crossing" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "crossing" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkCrossing(effect.crossing) ) problems.push(`${at}: ${problem}`);
    }

    // How units stand in its way: always there too, and judged before it is known where the unit can go
    if ( effect?.passing !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "passing" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "passing" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkPassing(effect.passing) ) problems.push(`${at}: ${problem}`);
    }
    // Moving again after an Action: always there, or at the end of a fight its unit started; and how a unit
    // curbs that for its enemies, which is always there
    if ( effect?.canto !== undefined ) {
      if ( effect.aura ) problems.push(`${at}: "canto" is for the skill's own unit, not an aura`);
      if ( proc && (proc.on !== "after") ) problems.push(`${at}: a fight has its unit move again once it is over, "after"`);
      if ( !proc && (needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect)) ) {
        problems.push(`${at}: "canto" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkCanto(effect.canto, { moment: !!proc }) ) problems.push(`${at}: ${problem}`);
    }
    if ( effect?.curbsCanto !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "curbsCanto" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "curbsCanto" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkCurb(effect.curbsCanto) ) problems.push(`${at}: ${problem}`);
    }
    if ( effect?.aura ) {
      checkFilter(effect.aura, at, "aura", auraParts);
      for ( const key of Object.keys(effect.aura.when ?? {}) ) if ( !conditions.includes(key) ) problems.push(`${at}: unknown condition "${key}" for the units in the aura`);

      // The unit that gives an aura is judged outside of any fight, and not by what it has around it
      for ( const key of Object.keys(effect.when ?? {}) ) {
        if ( FIGHT_KEYS.includes(key) || PLACE_KEYS.includes(key) ) problems.push(`${at}: the giver of an aura cannot be asked "${key}"`);
      }
    }
    // Staves: what the unit heals for, what it regains, and how far its staves reach
    for ( const key of STAFF_KEYS ) {
      // Following up with a staff is checked with the round of a fight (see `rounds.mjs`)
      if ( (effect?.[key] === undefined) || (key === "staffFollow") ) continue;
      // The staves a unit is immune to are a list of their names
      if ( key === "staffImmune" ) {
        if ( proc || effect.aura ) problems.push(`${at}: "staffImmune" is always there, for the skill's own unit`);
        if ( !Array.isArray(effect.staffImmune) || !effect.staffImmune.length || effect.staffImmune.some((name) => (typeof name !== "string") || !name) ) {
          problems.push(`${at}: staffImmune lists the staves its unit is immune to, by name`);
        }
        continue;
      }
      const parts ={ staffHeal: ["more", "plus", "self", "both"], staffHealed: ["healer", "both"], staffRange: ["times", "max"], healing: ["more"], buffs: ["times"] }[key];
      const table = effect[key];

      // Only the share a unit heals allies more for, and what it gives multiplied, can come from the unit beside it
      const shared = effect.aura && (["healing", "buffs"].includes(key) || ((key === "staffHeal") && Object.keys(table ?? {}).every((part) => part === "more")));
      if ( proc || (effect.aura && !shared) ) problems.push(`${at}: "${key}" is always there, not at a moment; as an aura it only gives "more" healing`);
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: ${key} must say what changes`);
      else for ( const [part, value] of Object.entries(table) ) {
        if ( !parts.includes(part) ) problems.push(`${at}: ${key} cannot say "${part}"`);
        else if ( !Number.isFinite(value) || (value < 0) ) problems.push(`${at}: the "${part}" of ${key} is a number, not "${value}"`);
      }
    }

    // How a skill bends the rules of conditions: always there, for the skill's own unit
    for ( const key of BEND_KEYS ) {
      if ( (effect?.[key] !== undefined) && (proc || effect.aura) ) problems.push(`${at}: "${key}" is always there, not at a moment or as an aura`);
    }
    for ( const key of ["inflictChance", "inflictTurns"] ) {
      if ( effect?.[key] === undefined ) continue;
      const table = effect[key];
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: ${key} must name conditions`);
      else for ( const [id, amount] of Object.entries(table) ) {
        if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        else if ( !Number.isFinite(amount) || ((key === "inflictTurns") && !Number.isInteger(amount)) ) problems.push(`${at}: ${key} gives "${id}" a number, not "${amount}"`);
      }
    }
    if ( effect?.nullify !== undefined ) {
      const ward = (typeof effect.nullify === "number") ? { percent: effect.nullify } : effect.nullify;
      if ( !ward || (typeof ward !== "object") || !Number.isFinite(ward.percent) || (ward.percent <= 0) || (ward.percent > 100) ) {
        problems.push(`${at}: nullify is a chance from 1 to 100`);
      }
      else {
        for ( const key of Object.keys(ward) ) if ( !["percent", "only"].includes(key) ) problems.push(`${at}: nullify cannot say "${key}"`);
        if ( (ward.only !== undefined) && (ward.only !== "damaging") ) {
          if ( !Array.isArray(ward.only) || !ward.only.length ) problems.push(`${at}: nullify is "only" for "damaging" conditions or for a list of them`);
          else for ( const id of ward.only ) if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        }
      }
    }
    if ( effect?.suffers !== undefined ) {
      const table = effect.suffers;
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: suffers must name conditions`);
      else for ( const [id, bend] of Object.entries(table) ) {
        if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        if ( !bend || (typeof bend !== "object") || !Object.keys(bend).length ) {
          problems.push(`${at}: suffers must say what "${id}" does`);
          continue;
        }
        for ( const [key, value] of Object.entries(bend) ) {
          if ( ["damage", "penalties", "tick"].includes(key) ) {
            if ( !Number.isFinite(value) ) problems.push(`${at}: the "${key}" of "${id}" is a number, not "${value}"`);
          }
          else if ( ["stays", "burst"].includes(key) ) {
            if ( typeof value !== "boolean" ) problems.push(`${at}: "${key}" is true or false, not "${value}"`);
          }
          else problems.push(`${at}: a condition suffered cannot say "${key}"`);
        }
      }
    }
    // Conditions a unit is cured of at a moment of its turn
    if ( effect?.cure !== undefined ) {
      if ( !TURN_MOMENTS.includes(proc?.on) ) problems.push(`${at}: conditions are cured at a moment of the unit's turn`);
      if ( effect.cure !== "all" ) {
        if ( !Array.isArray(effect.cure) || !effect.cure.length ) problems.push(`${at}: cure is "all" or lists conditions`);
        else for ( const id of effect.cure ) if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
      }
    }
    if ( (effect?.recovery !== undefined) && !(Number.isInteger(effect.recovery) && (effect.recovery >= 1)) ) {
      problems.push(`${at}: conditions run out by a whole number of turns, not "${effect.recovery}"`);
    }
    if ( effect?.debuffs !== undefined ) {
      const relief = effect.debuffs;
      if ( !relief || (typeof relief !== "object") || !Object.keys(relief).length ) problems.push(`${at}: debuffs must say what is taken off penalties`);
      else for ( const [key, value] of Object.entries(relief) ) {
        if ( ["negate", "turn", "lent"].includes(key) ) {
          if ( typeof value !== "boolean" ) problems.push(`${at}: "${key}" is true or false, not "${value}"`);
        }
        else if ( !["stats", "combat"].includes(key) ) problems.push(`${at}: penalties cannot be lessened by "${key}"`);
        else if ( !Number.isFinite(value) || (value < 0) ) problems.push(`${at}: penalties are lessened by a number, not "${value}"`);
      }
    }
    if ( effect?.burstHarm !== undefined ) {
      if ( !Array.isArray(effect.burstHarm) || !effect.burstHarm.length ) problems.push(`${at}: burstHarm lists conditions`);
      else for ( const id of effect.burstHarm ) {
        if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
        else if ( !(FEO.conditions[id] ?? FEO.optionalConditions[id]).burst ) problems.push(`${at}: "${id}" does not burst`);
      }
    }

    // How far a weapon reaches, how it wears and what resists it
    if ( effect?.weaponRange !== undefined ) {
      const range = effect.weaponRange;
      if ( !range || (typeof range !== "object") || !Object.keys(range).length ) problems.push(`${at}: weaponRange must say how the range changes`);
      else for ( const [key, value] of Object.entries(range) ) {
        if ( ["clear", "open"].includes(key) ) {
          if ( value !== true ) problems.push(`${at}: the "${key}" of a weapon's range is true or left out`);
        }
        else if ( !["add", "min", "max", "from"].includes(key) ) problems.push(`${at}: a weapon's range cannot change by "${key}"`);
        else if ( !Number.isInteger(value) || (value < 0) ) problems.push(`${at}: a weapon's range changes by whole tiles, not "${value}"`);
      }
    }
    if ( (effect?.damageStat !== undefined) && !(effect.damageStat in FEO.damageStats) ) problems.push(`${at}: unknown damage stat "${effect.damageStat}"`);

    // Weapon ranks given for good: saved on the unit once, so never at a moment, as an aura or on a condition
    if ( effect?.rank !== undefined ) {
      const table = effect.rank;
      if ( proc || effect.aura || effect.when ) problems.push(`${at}: a rank is given for good, not at a moment, as an aura or on a condition`);
      if ( !table || (typeof table !== "object") || !Object.keys(table).length ) problems.push(`${at}: rank must name proficiencies`);
      else for ( const [key, value] of Object.entries(table) ) {
        if ( (key !== "start") && !(key in FEO.proficiencies) ) problems.push(`${at}: unknown proficiency "${key}"`);
        else if ( !Number.isInteger(value) || (value < 1) ) problems.push(`${at}: a rank rises by whole ranks, not "${value}"`);
      }
    }
    if ( effect?.foeWear !== undefined ) {
      for ( const [key, value] of Object.entries(effect.foeWear ?? {}) ) {
        if ( !["hit", "noDamage"].includes(key) ) problems.push(`${at}: a foe's weapon cannot wear by "${key}"`);
        else if ( !Number.isInteger(value) || (value < 0) ) problems.push(`${at}: a foe's weapon wears by whole uses, not "${value}"`);
      }
    }
    if ( ("freeUses" in (effect ?? {})) && (proc?.on !== "start") ) problems.push(`${at}: a weapon is spared its uses as the fight begins, "start"`);

    // The unit's own Special Qualities and skills, a plain chance, and a defence lent for a hit
    const own = effect?.when ?? {};
    for ( const key of ["quality", "lacks"] ) {
      if ( (own[key] !== undefined) && !(Array.isArray(own[key]) && own[key].length && own[key].every((quality) => typeof quality === "string")) ) {
        problems.push(`${at}: "${key}" lists Special Qualities`);
      }
    }
    for ( const key of ["skill", "noSkill"] ) {
      if ( (own[key] !== undefined) && !((typeof own[key] === "string") && own[key]) ) problems.push(`${at}: "${key}" names one skill`);
    }
    if ( (proc?.fixed !== undefined) && !((proc.fixed === true) && Number.isFinite(proc.percent)) ) problems.push(`${at}: a "fixed" chance is a percent`);
    if ( "shield" in (effect ?? {}) ) {
      const lent = effect.shield;
      if ( proc?.on !== "struck" ) problems.push(`${at}: a defence is lent for a hit, when "struck"`);
      if ( !lent || (typeof lent !== "object") || !Object.keys(lent).length ) problems.push(`${at}: shield must give "def" or "res"`);
      else for ( const key of Object.keys(lent) ) if ( !["def", "res"].includes(key) ) problems.push(`${at}: a shield lends "def" or "res", not "${key}"`);
    }

    // Changing form: what a skill changes about it is always there or waits for its skill to be switched on,
    // and points for the Shift Gauge come with a critical hit
    if ( effect?.shift !== undefined ) {
      const form = effect.shift;
      if ( proc || effect.aura ) problems.push(`${at}: "shift" is always there, not at a moment or as an aura`);
      for ( const key of Object.keys(effect.when ?? {}) ) if ( key !== "declared" ) problems.push(`${at}: "shift" waits for nothing but its skill being switched on, not for "${key}"`);
      if ( !form || (typeof form !== "object") || !Object.keys(form).length ) problems.push(`${at}: shift must say what changes`);
      else for ( const [key, value] of Object.entries(form) ) {
        if ( SHIFT_PARTS.flags.includes(key) ) {
          if ( value !== true ) problems.push(`${at}: the "${key}" of shift is true, not "${value}"`);
        }
        else if ( !SHIFT_PARTS.numbers.includes(key) ) problems.push(`${at}: shift cannot say "${key}"`);
        else if ( !Number.isFinite(value) || (["percent", "times", "humanFight"].includes(key) && (value < 0)) || ((key === "transforms") && !Number.isInteger(value)) ) {
          problems.push(`${at}: the "${key}" of shift is a number, not "${value}"`);
        }
      }
    }
    // Warping: where the unit may land, in an effect of its own
    if ( effect?.warp !== undefined ) {
      if ( Object.keys(effect).length > 1 ) problems.push(`${at}: "warp" stands alone in its effect`);
      for ( const problem of checkWarp(effect.warp) ) problems.push(`${at}: ${problem}`);
    }

    // What a skill used as an action does to a unit picked on the map, in an effect of its own too
    if ( effect?.act !== undefined ) {
      // Beside it an effect says only what it asks of its unit, where a skill is used in more ways than one
      if ( Object.keys(effect).some((key) => !["act", "when"].includes(key)) ) problems.push(`${at}: "act" stands alone in its effect`);
      if ( effect.when && Object.keys(effect.when).some((key) => !["skill", "noSkill", "tier"].includes(key)) ) {
        problems.push(`${at}: beside "act" an effect asks only for a skill of its unit, or for its tier`);
      }
      for ( const problem of checkAct(effect.act) ) problems.push(`${at}: ${problem}`);
      const act = effect.act ?? {};
      if ( Array.isArray(act.makes?.effects) ) {
        for ( const problem of checkEffects(act.makes.effects) ) problems.push(`${at}: in what the creature always has, ${problem}`);
      }
      const lasting = [act.grant?.effects, act.instead?.grant?.effects, act.all?.grant?.effects, act.watch?.enters?.effects, act.watch?.stays?.effects,
        ...(act.grant?.lends ?? []).map((lend) => (lend?.effects ?? []).map((part) => {
          // The kind of weapon a die picks is written in as the skill is used
          const when = Object.fromEntries(Object.entries(part?.when ?? {}).map(([key, value]) => [key, (value === "$") ? ["sword"] : value]));
          return { ...part, when };
        }))];
      for ( const list of lasting ) {
        if ( !Array.isArray(list) ) continue;
        for ( const problem of checkEffects(list) ) problems.push(`${at}: in the change it leaves on its target, ${problem}`);
      }
      if ( Array.isArray(act.strike?.effects) ) {
        for ( const problem of checkEffects(act.strike.effects) ) problems.push(`${at}: in what its unit has for that attack, ${problem}`);
      }
    }
    if ( (effect?.assures !== undefined) && (!Array.isArray(effect.assures) || effect.assures.some((name) => typeof name !== "string")) ) {
      problems.push(`${at}: "assures" lists skills by name`);
    }

    // What a skill makes of its unit's Shove: always there, and judged outside of any fight
    if ( effect?.shove !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "shove" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "shove" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkShove(effect.shove) ) problems.push(`${at}: ${problem}`);
    }

    // What a unit does for its side outside of its own turn: always there, and judged outside of any fight.
    // What its unit has for a fight it fights that way is written as any effect is
    for ( const [key, check] of [["guards", checkGuards], ["wards", checkWards], ["reacts", checkReacts], ["shelters", checkShelters]] ) {
      if ( effect?.[key] === undefined ) continue;
      if ( proc || effect.aura ) problems.push(`${at}: "${key}" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "${key}" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of check(effect[key]) ) problems.push(`${at}: ${problem}`);
      for ( const list of [effect[key]?.effects, effect[key]?.rallies?.effects] ) {
        if ( !Array.isArray(list) ) continue;
        const written = list.map((part) => {
          // The mark the enemy carries meanwhile is written in as the change is given
          const when = Object.fromEntries(Object.entries(part?.when ?? {}).map(([name, value]) => [name, (value === "$") ? "mark" : value]));
          return part?.when ? { ...part, when } : part;
        });
        for ( const problem of checkEffects(written) ) problems.push(`${at}: in what "${key}" lends, ${problem}`);
      }
    }

    // What a skill makes of carrying a unit: always there too, and what it leaves on a unit that is set down
    // is written as any effect is
    if ( effect?.carry !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "carry" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "carry" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkCarry(effect.carry) ) problems.push(`${at}: ${problem}`);
      if ( Array.isArray(effect.carry?.drops?.effects) ) {
        for ( const problem of checkEffects(effect.carry.drops.effects) ) problems.push(`${at}: set down, ${problem}`);
      }
    }

    // What a skill lets its unit do with gear and with the things on a map: always there as well
    if ( KNACK_KEYS.some((key) => effect?.[key] !== undefined) ) {
      const named = KNACK_KEYS.filter((key) => effect[key] !== undefined).map((key) => `"${key}"`).join(", ");
      if ( proc || effect.aura ) problems.push(`${at}: ${named} is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: ${named} cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkKnacks(effect) ) problems.push(`${at}: ${problem}`);
    }

    // The creature a skill raises from a foe its unit defeats, and what it says of those its unit makes
    if ( effect?.makes !== undefined ) {
      if ( proc?.on !== "kill" ) problems.push(`${at}: "makes" raises the foe at a "kill"; a skill used as an action says it in its "act"`);
      for ( const problem of checkMakes(effect.makes, { at: "kill", checkEffects }) ) problems.push(`${at}: ${problem}`);
    }
    if ( effect?.creatures !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "creatures" is always there, not at a moment or as an aura`);
      for ( const problem of checkCreatures(effect.creatures) ) problems.push(`${at}: ${problem}`);
    }

    // What a skill changes about its unit's imitation
    if ( effect?.imitation !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "imitation" is always there, not at a moment or as an aura`);
      if ( Object.keys(effect).some((key) => key !== "imitation") ) problems.push(`${at}: "imitation" stands alone in its effect`);
      for ( const problem of checkImitation(effect.imitation, { checkEffects }) ) problems.push(`${at}: ${problem}`);
    }

    // What a skill takes from the foe in a fight, and what it has the foe put down
    if ( effect?.loot !== undefined ) {
      if ( !proc ) problems.push(`${at}: "loot" is taken at a moment of a fight`);
      for ( const problem of checkLoot(effect.loot, proc?.on ?? "") ) problems.push(`${at}: ${problem}`);
    }
    if ( effect?.unequips !== undefined ) {
      if ( (effect.unequips !== true) || (proc?.on !== "attack") ) problems.push(`${at}: "unequips" is true, on an "attack"`);
    }
    if ( effect?.amplify !== undefined ) {
      if ( !(Number.isFinite(effect.amplify) && (effect.amplify > 0)) || (proc?.on !== "attack") ) problems.push(`${at}: "amplify" is a share in percent, on an "attack"`);
    }
    if ( (effect?.when?.foeUnmarked !== undefined) && ((typeof effect.when.foeUnmarked !== "string") || !effect.when.foeUnmarked) ) {
      problems.push(`${at}: "foeUnmarked" names a mark`);
    }

    // What a skill makes of Refresh: always there as well, and the changes it lays over a Refresh are written
    // as any effect is
    if ( effect?.refresh !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "refresh" is always there, not at a moment or as an aura`);
      if ( needsFight(effect.when) || asksPlace(effect.when) || needsMove(effect) ) {
        problems.push(`${at}: "refresh" cannot hang on a fight, on where units stand or on how the unit moved`);
      }
      for ( const problem of checkRefresh(effect.refresh) ) problems.push(`${at}: ${problem}`);
      const part = effect.refresh ?? {};
      const laid = [...[].concat(part.gives ?? []), ...[].concat(part.curses ?? []), ...[].concat(part.option?.gives ?? [])];
      for ( const give of laid ) {
        if ( !Array.isArray(give?.effects) ) continue;
        if ( give.effects.some((inner) => inner.proc || inner.aura || inner.grant) ) problems.push(`${at}: what a Refresh lays over a unit cannot wait for a moment, be an aura or grant another`);
        else for ( const problem of checkEffects(give.effects) ) problems.push(`${at}: over a Refresh, ${problem}`);
      }
    }

    // A Refresh a skill hands out as something else is done
    if ( effect?.refreshes !== undefined ) {
      if ( effect.aura ) problems.push(`${at}: "refreshes" is for the skill's own unit, not an aura`);
      for ( const problem of checkRefreshes(effect.refreshes, proc ?? null) ) problems.push(`${at}: ${problem}`);
    }

    // How a skill moves units as a fight ends, and the hits its moment may wait for
    if ( effect?.step !== undefined ) {
      if ( effect.aura ) problems.push(`${at}: "step" is for the skill's own unit, not an aura`);
      for ( const problem of checkStep(effect.step, proc ?? null) ) problems.push(`${at}: ${problem}`);
    }
    if ( proc?.hits !== undefined ) {
      if ( !Number.isInteger(proc.hits) || (proc.hits < 1) ) problems.push(`${at}: "hits" is a whole number of attacks landed`);
      if ( proc.on !== "after" ) problems.push(`${at}: only a moment "after" the fight waits for "hits"`);
    }
    if ( (own.shifted !== undefined) && (typeof own.shifted !== "boolean") ) problems.push(`${at}: "shifted" is true or false`);
    if ( "gaugeOfDamage" in (effect ?? {}) ) {
      if ( proc?.on !== "crit" ) problems.push(`${at}: the Shift Gauge gains a share of a hit's damage on a "crit"`);
      if ( !Number.isFinite(effect.gaugeOfDamage) || (effect.gaugeOfDamage <= 0) ) problems.push(`${at}: gaugeOfDamage is a share in percent, not "${effect.gaugeOfDamage}"`);
    }

    // Surviving a fatal hit: as Miracle does, or left at 1 HP by an HP test
    if ( "survive" in (effect ?? {}) ) {
      const saved = effect.survive;
      if ( proc?.on !== "struck" ) problems.push(`${at}: a fatal hit is survived when "struck"`);
      if ( saved !== true ) {
        if ( !saved || (typeof saved !== "object") || ![...ops, "above"].includes(saved.hp?.op) ) problems.push(`${at}: survive is true, or an "hp" test the unit must pass`);
        else for ( const key of Object.keys(saved) ) if ( key !== "hp" ) problems.push(`${at}: survive cannot say "${key}"`);
      }
    }
    if ( effect?.when?.weaponReach && !Object.keys(effect.when.weaponReach).every((key) => ["min", "max"].includes(key)) ) {
      problems.push(`${at}: a weapon's own reach is asked by "min" or "max"`);
    }

    // What a unit earns: experience multiplied, the column of the staff table, growth rates raised
    if ( (effect?.expMultiplier !== undefined) && !(Number.isFinite(effect.expMultiplier) && (effect.expMultiplier >= 0)) ) {
      problems.push(`${at}: experience is multiplied by a number, not "${effect.expMultiplier}"`);
    }
    if ( (effect?.bexp !== undefined) && !((effect.bexp === false) && (effect.expMultiplier !== undefined)) ) {
      problems.push(`${at}: "bexp" is false, beside the "expMultiplier" that Bonus EXP is not multiplied by`);
    }
    if ( (effect?.inflicts !== undefined) && TURN_MOMENTS.includes(proc?.on) && !effect.inflicts.every((entry) => typeof entry === "string") ) {
      problems.push(`${at}: at a moment of a turn "inflicts" lists conditions by name`);
    }
    if ( (effect?.staffExp !== undefined) && !["unpromoted", "promoted"].includes(effect.staffExp) ) {
      problems.push(`${at}: staves earn "unpromoted" or "promoted" experience, not "${effect.staffExp}"`);
    }
    if ( effect?.growths !== undefined ) {
      const growths = effect.growths;
      const rates = { ...FEO.growths, ...(FEO.optionalGrowths ?? {}) };
      if ( !growths || (typeof growths !== "object") ) problems.push(`${at}: growths must say which growth rates`);
      else if ( proc || effect.aura ) problems.push(`${at}: growth rates are raised all the time, and only for the skill's own unit`);
      else if ( "pick" in growths ) {
        if ( !Number.isInteger(growths.pick) || (growths.pick < 1) || !Number.isFinite(growths.amount) ) problems.push(`${at}: picked growth rates need a whole "pick" and an "amount"`);
        for ( const key of Object.keys(growths) ) if ( !["pick", "amount"].includes(key) ) problems.push(`${at}: picked growth rates cannot say "${key}"`);
      }
      else for ( const [key, amount] of Object.entries(growths) ) {
        if ( !(key in rates) ) problems.push(`${at}: unknown growth rate "${key}"`);
        else if ( !Number.isFinite(amount) ) problems.push(`${at}: the growth rate "${key}" is raised by a number`);
      }
    }
    // Blocking: what the skill makes of it, the DEF and RES a blocked hit goes without, the first and the last
    // use of the weapon, and the condition that asks for a Shield
    if ( effect?.block !== undefined ) {
      for ( const problem of checkBlock(effect.block) ) problems.push(`${at}: ${problem}`);
      if ( proc ) problems.push(`${at}: "block" is always there, not at a moment`);
    }
    if ( effect?.lostOnBlock !== undefined ) {
      if ( effect.lostOnBlock !== true ) problems.push(`${at}: "lostOnBlock" is true or left out`);
      if ( proc || effect.aura || !["def", "res"].some((key) => effect.stats?.[key] !== undefined) ) problems.push(`${at}: "lostOnBlock" is for DEF or RES its own unit always has`);
    }
    if ( effect?.weaponUse !== undefined ) {
      const use = effect.weaponUse;
      if ( !use || (typeof use !== "object") || !Object.keys(use).length || Object.entries(use).some(([key, value]) => !["first", "last"].includes(key) || (value !== "crit")) ) {
        problems.push(`${at}: weaponUse has the "first" or the "last" use of a weapon "crit"`);
      }
      if ( proc || effect.aura ) problems.push(`${at}: "weaponUse" is always there, not at a moment or as an aura`);
    }
    if ( ![undefined, null, true, false, "magic"].includes(effect?.when?.shield) ) problems.push(`${at}: "shield" asks true, false or "magic"`);

    // What a unit chooses before a fight (see `choices.mjs`): always there, for the skill's own unit
    for ( const key of ["trade", "spend", "single", "noWeight", "hitCap", "foeBonus", "cooldowns", "rearm"] ) {
      if ( (effect?.[key] !== undefined) && (proc || effect.aura) ) problems.push(`${at}: "${key}" is always there, not at a moment or as an aura`);
    }
    if ( effect?.trade !== undefined ) for ( const problem of checkTrade(effect.trade) ) problems.push(`${at}: ${problem}`);
    if ( effect?.spend !== undefined ) for ( const problem of checkSpend(effect.spend) ) problems.push(`${at}: ${problem}`);
    if ( effect?.single !== undefined ) for ( const problem of checkSingle(effect.single) ) problems.push(`${at}: ${problem}`);
    if ( effect?.foeBonus !== undefined ) for ( const problem of checkFoeBonus(effect.foeBonus) ) problems.push(`${at}: ${problem}`);
    if ( (effect?.bonuses !== undefined) && (proc || effect.aura || ![0, -1].includes(effect.bonuses?.times)) ) {
      problems.push(`${at}: "bonuses" is always there and says what becomes of its unit's own bonuses to stats: "times" 0 cancels them, -1 turns them around`);
    }
    for ( const key of ["noWeight", "rearm"] ) if ( ![undefined, true].includes(effect?.[key]) ) problems.push(`${at}: "${key}" is true or left out`);
    if ( (effect?.hitCap !== undefined) && !(Number.isFinite(effect.hitCap) && (effect.hitCap > 0) && (effect.hitCap <= 100)) ) {
      problems.push(`${at}: hitCap is a share of maximum HP, from 1 to 100`);
    }
    if ( (effect?.cooldowns !== undefined) && !Number.isInteger(effect.cooldowns) ) problems.push(`${at}: cooldowns change by a whole number of turns`);
    if ( effect?.against !== undefined ) {
      if ( !AGAINST.includes(effect.against) ) problems.push(`${at}: an attack is resisted by ${AGAINST.map((key) => `"${key}"`).join(", ")}, not "${effect.against}"`);
      if ( effect.aura || (proc && (proc.on !== "attack")) ) problems.push(`${at}: "against" is always there, or for an "attack"`);
    }
    const qualities = (list) => Array.isArray(list) && (list.length > 0) && list.every((quality) => (typeof quality === "string") && quality);
    if ( proc && ("effective" in effect) && !(((effect.effective === true) || qualities(effect.effective)) && (proc.on === "attack")) ) {
      problems.push(`${at}: an "attack" deals effective damage with "effective: true", or to the Special Qualities it lists`);
    }

    // What an attack deals and to whom: conditions on the weapons of the two and on what the fight has come to,
    // and the parts that are always there
    const asked = effect?.when ?? {};
    for ( const key of ["weaponNot", "weaponSlays", "foeWeaponRank", "foeSlays", "foeSlaysNot"] ) {
      if ( (asked[key] !== undefined) && !qualities(asked[key]) ) problems.push(`${at}: "${key}" is a list`);
    }
    for ( const rank of [].concat(asked.foeWeaponRank ?? []) ) if ( !(rank in FEO.ranks) ) problems.push(`${at}: unknown weapon rank "${rank}"`);
    for ( const key of ["foeWeaponKnown", "overkill", "foeEffective", "foeFollows"] ) {
      if ( (asked[key] !== undefined) && (typeof asked[key] !== "boolean") ) problems.push(`${at}: "${key}" is true or false`);
    }
    for ( const key of ["foeDenied", "foeDebuffed"] ) {
      if ( (asked[key] !== undefined) && (asked[key] !== true) ) problems.push(`${at}: "${key}" is true or left out`);
    }
    for ( const key of KNOWN_LATE ) {
      if ( (asked[key] !== undefined) && effect.aura ) problems.push(`${at}: the giver of an aura cannot be asked "${key}"`);
    }
    for ( const key of ["uneffective", "effectiveTaken", "combatTimes", "echo"] ) {
      if ( (effect?.[key] !== undefined) && (proc || effect.aura) ) problems.push(`${at}: "${key}" is always there, not at a moment or as an aura`);
    }
    if ( (effect?.effectiveTaken !== undefined) && !(Number.isFinite(effect.effectiveTaken) && (effect.effectiveTaken >= 1)) ) {
      problems.push(`${at}: "effectiveTaken" is what effective damage multiplies Might by at most, 1 or more`);
    }
    if ( (effect?.uneffective !== undefined) && !qualities(effect.uneffective) ) problems.push(`${at}: "uneffective" lists Special Qualities`);
    if ( effect?.combatTimes !== undefined ) {
      const table = Object.entries(effect.combatTimes ?? {});
      if ( !table.length ) problems.push(`${at}: combatTimes must name a combat stat`);
      for ( const [key, times] of table ) {
        if ( !["hit", "damage", "critical", "dodge", "critAvoid"].includes(key) ) problems.push(`${at}: unknown combat stat "${key}" to multiply`);
        else if ( !Number.isFinite(times) || (times < 0) ) problems.push(`${at}: a combat stat is multiplied by a number, not "${times}"`);
      }
    }
    if ( (effect?.foeCombat !== undefined) && !proc ) {
      const table = Object.keys(effect.foeCombat ?? {});
      if ( effect.aura ) problems.push(`${at}: "foeCombat" is for the foe of the skill's own unit, not an aura`);
      if ( !table.length ) problems.push(`${at}: foeCombat must name a combat stat`);
      for ( const key of table ) if ( !["hit", "damage", "critical", "dodge", "critAvoid", "attackSpeed"].includes(key) ) problems.push(`${at}: unknown combat stat "${key}" for a foe`);
    }
    if ( effect?.echo !== undefined ) {
      const echo = effect.echo;
      if ( !echo || (typeof echo !== "object") ) problems.push(`${at}: echo must say what share of a hit is dealt again`);
      else {
        for ( const key of Object.keys(echo) ) if ( !["percent", "element", "resist", "floor"].includes(key) ) problems.push(`${at}: echo cannot say "${key}"`);
        if ( !Number.isFinite(echo.percent) || (echo.percent <= 0) ) problems.push(`${at}: echo deals a "percent" of the hit again`);
        if ( (echo.floor !== undefined) && !(Number.isFinite(echo.floor) && (echo.floor >= 0) && (echo.floor <= echo.percent)) ) problems.push(`${at}: the "floor" of an echo is a smaller share of the hit`);
        if ( ![undefined, "def", "res"].includes(echo.resist) ) problems.push(`${at}: an echo is resisted by "def" or "res", not "${echo.resist}"`);
        if ( (echo.element !== undefined) && !FEO.attackElements.includes(echo.element) ) problems.push(`${at}: unknown element "${echo.element}"`);
      }
    }
    if ( !proc && (effect?.effective !== undefined) && !Array.isArray(effect.effective) ) problems.push(`${at}: "effective" lists Special Qualities`);
    if ( ("asCrit" in (effect ?? {})) && !((effect.asCrit === true) && ["attack", "hit"].includes(proc?.on)) ) {
      problems.push(`${at}: an "attack" or a "hit" counts as a critical hit with "asCrit: true"`);
    }
    if ( (proc?.spends !== undefined) && !((proc.spends === true) && effect.when?.declared) ) {
      problems.push(`${at}: "spends" is true, on a moment of a skill that waits to be switched on`);
    }
    if ( proc ) {
      if ( !PROC_TRIGGERS.includes(proc.on) && !TURN_MOMENTS.includes(proc.on) && !LEVEL_MOMENTS.includes(proc.on) && !STAFF_MOMENTS.includes(proc.on)
        && !ACTION_MOMENTS.includes(proc.on) && (proc.on !== USE_MOMENT) && (proc.on !== ITEM_MOMENT) ) {
        problems.push(`${at}: unknown trigger "${proc.on}"`);
      }

      // An item that restores HP to its unit only knows a few things to do (see `items.mjs`)
      for ( const problem of checkItemMoment(effect) ) problems.push(`${at}: ${problem}`);
    }

    // An item its unit uses up for something that lasts (see `items.mjs`), and the change of its own a
    // condition asks its unit to carry
    for ( const problem of checkConsumes(effect, checkEffects) ) problems.push(`${at}: ${problem}`);
    if ( (effect?.when?.carries !== undefined) && ((typeof effect.when.carries !== "string") || !effect.when.carries) ) {
      problems.push(`${at}: "carries" names the lasting change its unit must carry`);
    }
    if ( proc ) {

      // A skill being used as an action leaves a change on its unit, or does something to the units around,
      // and nothing else
      if ( using(effect) ) {
        for ( const key of Object.keys(effect) ) if ( !["proc", "when", "choice", "grant", "spread"].includes(key) ) problems.push(`${at}: as a skill is used it cannot do "${key}"`);
        if ( !proc.sure ) problems.push(`${at}: what a skill leaves as it is used is sure`);
        if ( effect.aura ) problems.push(`${at}: what a skill leaves as it is used is for its own unit, not an aura`);
        if ( needsFight(effect.when) ) problems.push(`${at}: a skill being used cannot hang on a fight`);
        if ( (effect.grant === undefined) && (effect.spread === undefined) ) problems.push(`${at}: as a skill is used it grants a lasting change, or reaches for the units around`);
        for ( const grant of [].concat(effect.grant ?? []) ) if ( grant?.reach || (grant?.to !== "self") ) problems.push(`${at}: as a skill is used a lasting change is for "self"`);
      }

      // What a unit pays, what waits for its next attack in a later fight, and what is read from a hit it took
      if ( "pays" in effect ) {
        if ( !["start", "after"].includes(proc.on) ) problems.push(`${at}: a unit "pays" at the "start" of a fight or "after" it`);
        if ( !(Number.isFinite(effect.pays) ? (effect.pays > 0) : (effect.pays && (typeof effect.pays === "object") && (effect.pays.of !== undefined))) ) {
          problems.push(`${at}: what a unit "pays" is damage: a number, or one read from the unit`);
        }
        if ( effect.aura ) problems.push(`${at}: a unit "pays" for its own skill, not for an aura`);
      }
      if ( ("keep" in effect) && !((effect.keep === true) && (effect.next || effect.nextOfDamage || effect.nextOfNegated || effect.near?.next)) ) {
        problems.push(`${at}: "keep" is true, beside what is set aside for the next attack`);
      }
      if ( "nextOfNegated" in effect ) {
        if ( proc.on !== "struck" ) problems.push(`${at}: "nextOfNegated" is for a hit its unit is "struck" by`);
        if ( !effect.negate && !effect.reduce ) problems.push(`${at}: "nextOfNegated" goes with "negate" or "reduce"`);
        for ( const [key, share] of Object.entries(effect.nextOfNegated ?? {}) ) {
          if ( !nextParts.includes(key) || !(Number.isFinite(share) && (share > 0)) ) problems.push(`${at}: "nextOfNegated" gives "hit", "damage" or "critical" a share in percent`);
        }
      }

      // The moments of a block, and what only they or an attack can do
      const blocking = BLOCK_MOMENTS.includes(proc.on);
      const curbing = proc.on === "curbed";
      if ( (proc.by !== undefined) && curbing ) {
        if ( ![].concat(proc.by).length || ![].concat(proc.by).every((cause) => CURBS.includes(cause)) ) problems.push(`${at}: a hit is "curbed" by ${CURBS.map((cause) => `"${cause}"`).join(", ")}`);
      }
      else if ( (proc.by !== undefined) && !(blocking && BLOCK_KINDS.includes(proc.by)) ) problems.push(`${at}: only the moments of a block ask what blocked, a "shield" or a "weapon"`);
      if ( (proc.stopped !== undefined) && !(curbing && (typeof proc.stopped === "boolean")) ) problems.push(`${at}: only a hit that was "curbed" asks whether it was "stopped", true or false`);

      // What an attack deals: a stat raised where the weapon adds it, a kill, a share of the target's maximum
      // HP in place of the damage, and a cut of the HP the target has left; what a hit is resisted with; and
      // stats for the whole fight
      const amount = (value) => Number.isFinite(value) || (value && (typeof value === "object") && ((value.of !== undefined) || (value.count !== undefined)));
      for ( const key of ["statPlus", "slay", "instead", "cut"] ) {
        if ( (key in effect) && (proc.on !== "attack") ) problems.push(`${at}: "${key}" is for an "attack"`);
      }
      if ( "statPlus" in effect ) {
        const table = Object.entries(effect.statPlus ?? {});
        if ( !table.length ) problems.push(`${at}: statPlus must name a stat`);
        for ( const [key, value] of table ) {
          if ( !(key in FEO.damageStats) ) problems.push(`${at}: unknown damage stat "${key}"`);
          else if ( !amount(value) ) problems.push(`${at}: statPlus adds a number to "${key}"`);
        }
      }
      if ( ("slay" in effect) && (effect.slay !== true) ) problems.push(`${at}: "slay" is true or left out`);
      if ( "instead" in effect ) {
        const instead = effect.instead;
        if ( !instead || (typeof instead !== "object") || !(Number.isInteger(instead.dice) && (instead.dice >= 2)) || (instead.of !== "hpMax") ) {
          problems.push(`${at}: "instead" rolls "dice" for a share "of" the target's "hpMax"`);
        }
        else for ( const key of Object.keys(instead) ) if ( !["dice", "of"].includes(key) ) problems.push(`${at}: "instead" cannot say "${key}"`);
      }
      if ( "cut" in effect ) {
        const cut = effect.cut;
        if ( !cut || (typeof cut !== "object") || !(Number.isFinite(cut.percent) && (cut.percent > 0) && (cut.percent < 100)) ) problems.push(`${at}: "cut" takes a "percent" of the HP the target has left`);
        else {
          for ( const key of Object.keys(cut) ) if ( !["percent", "killAt"].includes(key) ) problems.push(`${at}: "cut" cannot say "${key}"`);
          if ( (cut.killAt !== undefined) && !(Number.isInteger(cut.killAt) && (cut.killAt >= 1)) ) problems.push(`${at}: "killAt" is a whole number of HP`);
        }
      }
      if ( "defend" in effect ) {
        const table = Object.entries(effect.defend ?? {});
        if ( proc.on !== "struck" ) problems.push(`${at}: a defence is raised for a hit, when "struck"`);
        if ( !table.length ) problems.push(`${at}: defend must give "def" or "res"`);
        for ( const [key, value] of table ) {
          if ( !["def", "res"].includes(key) ) problems.push(`${at}: a hit is resisted with "def" or "res", not "${key}"`);
          else if ( !amount(value) ) problems.push(`${at}: defend adds a number to "${key}"`);
        }
      }
      if ( (effect.stats !== undefined) && !effect.aura && PROC_TRIGGERS.includes(proc.on) && (proc.on !== "start") ) {
        problems.push(`${at}: at a moment of a fight stats are given from the "start", for all of it`);
      }
      if ( (proc.unable !== undefined) && !((proc.unable === true) && (proc.on === "struck")) ) problems.push(`${at}: "unable" is true, for a unit that is "struck"`);
      if ( (proc.harmless !== undefined) && !((proc.harmless === true) && ["hit", "crit"].includes(proc.on) && (effect.retaliate !== undefined)) ) {
        problems.push(`${at}: "harmless" is true, on a "hit" or a "crit" that deals damage of its own with "retaliate"`);
      }

      // An attack made at once: as the unit's attacks are, or with numbers of its own
      if ( "attack" in effect ) {
        const own = effect.attack;
        const amount = (value) => Number.isFinite(value) || (value && (typeof value === "object") && (value.of !== undefined));
        if ( !["block", "dodged", "struck", "start", "attack"].includes(proc.on) ) problems.push(`${at}: one more attack is made on a "block", on "dodged", when "struck", on an "attack" or from the "start" of a fight`);
        // One made with a weapon of the Weapons tab takes its numbers from that weapon (see `lending.mjs`)
        const armed = !!own && (typeof own === "object") && ((own.weapon !== undefined) || (own.lent !== undefined) || (own.arm !== undefined));
        if ( (proc.on === "struck") && (own !== true) && !armed ) problems.push(`${at}: a unit that is "struck" attacks at once as its attacks are, "attack: true", or with a weapon it is lent`);
        if ( (proc.on === "attack") && !(own && (typeof own === "object")) ) problems.push(`${at}: the attack a unit makes beside one of its "attack"s has numbers of its own`);
        if ( armed ) {
          for ( const key of Object.keys(own) ) if ( !["weapon", "lent", "arm", "hit", "might", "range", "share"].includes(key) ) problems.push(`${at}: an attack with a weapon of the Weapons tab cannot say "${key}"`);
          if ( (own.weapon !== undefined) === (own.lent !== undefined) ) problems.push(`${at}: an attack is made with a "weapon" that is named, or with the one "lent" to its skill`);
          if ( (own.weapon !== undefined) && ((typeof own.weapon !== "string") || !own.weapon) ) problems.push(`${at}: the "weapon" of an attack is named as it is on the Weapons tab`);
          if ( (own.lent !== undefined) && (own.lent !== true) ) problems.push(`${at}: "lent" is true or left out`);
          if ( (own.lent === true) && !effects.some((other) => other?.lend?.cast) ) problems.push(`${at}: an attack with the weapon "lent" to its skill needs a "lend" part that is "cast"`);
          for ( const key of ["hit", "might", "share"] ) if ( (own[key] !== undefined) && !Number.isFinite(own[key]) ) problems.push(`${at}: the "${key}" of an attack with a weapon is a number`);
          if ( (own.range !== undefined) && !(Number.isInteger(own.range) && (own.range >= 1)) ) problems.push(`${at}: the "range" of an attack of its own is a whole number of tiles`);
        }
        else if ( own && (typeof own === "object") ) {
          for ( const key of Object.keys(own) ) if ( !["hit", "might", "range", "critical", "stat", "against", "element", "effect"].includes(key) ) problems.push(`${at}: an attack of its own cannot say "${key}"`);
          if ( (own.critical !== undefined) && !Number.isFinite(own.critical) ) problems.push(`${at}: the "critical" of an attack of its own is a number`);
          if ( (own.stat !== undefined) && !(own.stat in FEO.stats) ) problems.push(`${at}: the "stat" of an attack of its own is one it adds to its Might`);
          if ( (own.against !== undefined) && !["def", "res"].includes(own.against) ) problems.push(`${at}: an attack of its own is resisted "against" "def" or "res"`);
          if ( (own.element !== undefined) && ((typeof own.element !== "string") || !own.element) ) problems.push(`${at}: the "element" of an attack of its own is a name`);
          if ( (own.effect !== undefined) && (typeof own.effect !== "string") ) problems.push(`${at}: the "effect" of an attack of its own is worded as a weapon's Effect is`);
          if ( !amount(own.hit) || !amount(own.might) ) problems.push(`${at}: an attack of its own has a "hit" and a "might"`);
          if ( (own.range !== undefined) && !(Number.isInteger(own.range) && (own.range >= 1)) ) problems.push(`${at}: the "range" of an attack of its own is a whole number of tiles`);
        }
        else if ( own !== true ) problems.push(`${at}: "attack" is true, or the "hit" and "might" of an attack of its own`);
      }
      if ( ("cancels" in effect) && !(["block", "attack", "start"].includes(proc.on) && Number.isInteger(effect.cancels) && (effect.cancels >= 1)) ) {
        problems.push(`${at}: a "block", an "attack" or the "start" of a fight cancels a whole number of the foe's next attacks`);
      }
      if ( "excess" in effect ) {
        const excess = effect.excess;
        if ( (proc.on !== "struck") || (effect.reduce === undefined) ) problems.push(`${at}: "excess" is what "reduce" takes off beyond the damage, when "struck"`);
        if ( !excess || (typeof excess !== "object") || !Object.keys(excess).length ) problems.push(`${at}: excess says what becomes of it: "retaliate" or "combat"`);
        else {
          for ( const key of Object.keys(excess) ) if ( !["retaliate", "combat"].includes(key) ) problems.push(`${at}: excess cannot say "${key}"`);
          if ( ![undefined, true].includes(excess.retaliate) ) problems.push(`${at}: excess: "retaliate" is true or left out`);
          if ( (excess.combat !== undefined) && !(Array.isArray(excess.combat) && excess.combat.length && excess.combat.every((key) => procCombat.includes(key))) ) {
            problems.push(`${at}: excess: "combat" lists what it is added to: ${procCombat.join(", ")}`);
          }
        }
      }
      if ( (proc.blocked !== undefined) && !((proc.on === "struck") && Number.isFinite(proc.blocked)) ) problems.push(`${at}: "blocked" is added to a chance when "struck"`);
      if ( ("unblock" in effect) && ((proc.on !== "blocked") || (effect.unblock !== true)) ) problems.push(`${at}: a block is negated, "unblock: true", when "blocked"`);
      if ( ("blockLess" in effect) && (proc.on !== "blocked") ) problems.push(`${at}: "blockLess" is for an attack that was "blocked"`);
      if ( ("blockTimes" in effect) && (proc.on !== "block") ) problems.push(`${at}: "blockTimes" is for the unit that makes a "block"`);
      if ( ("noBlock" in effect) && ((proc.on !== "attack") || ![true, "shield"].includes(effect.noBlock)) ) problems.push(`${at}: an "attack" goes past a "shield" or, with true, past every block`);
      if ( "wears" in effect ) {
        const wears = effect.wears;
        const amount = (value) => Number.isFinite(value) || (value && (typeof value === "object") && ((value.of !== undefined) || (Number.isInteger(value.dice) && (value.dice >= 2))));
        if ( ![...BLOCK_MOMENTS, ...DAMAGE_MOMENTS, "attack", "hit", "crit", "after"].includes(proc.on) ) problems.push(`${at}: a foe's gear is worn down on an attack, a hit, a block or after the fight`);
        if ( !wears || (typeof wears !== "object") || !["weapon", "shield"].some((key) => wears[key] !== undefined) ) problems.push(`${at}: wears names the foe's "weapon" or "shield"`);
        else {
          for ( const key of Object.keys(wears) ) if ( !["weapon", "shield", "after"].includes(key) ) problems.push(`${at}: wears cannot say "${key}"`);
          for ( const key of ["weapon", "shield"] ) if ( (wears[key] !== undefined) && !amount(wears[key]) ) problems.push(`${at}: wears: "${key}" is a number of uses, or a die`);
          if ( ![undefined, true].includes(wears.after) ) problems.push(`${at}: wears: "after" is true or left out`);
        }
      }

      // Another go in the unit's turn: what it comes with, and the moment that earns it. An Action that has
      // been taken earns nothing else, and is judged outside of any fight
      if ( effect.acts !== undefined ) {
        if ( effect.aura ) problems.push(`${at}: "acts" is for the skill's own unit, not an aura`);
        for ( const problem of checkActs(effect.acts, proc) ) problems.push(`${at}: ${problem}`);
      }
      for ( const problem of checkActionMoment(proc) ) problems.push(`${at}: ${problem}`);
      if ( ACTION_MOMENTS.includes(proc.on) ) {
        const parts = ["proc", "when", "choice", "acts"];
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: an Action that has been taken cannot do "${key}"`);
        if ( effect.acts === undefined ) problems.push(`${at}: an Action that has been taken earns another go, "acts"`);
        if ( needsFight(effect.when) ) problems.push(`${at}: an Action that has been taken cannot hang on a fight`);
      }

      // A staff being used only knows a few things to do
      if ( staffing(effect) ) {
        const parts = (proc.on === "heal") ? ["proc", "when", "choice", "harmNear"] : ["proc", "when", "choice", "grant", "remind", "healPlus", "refreshes"];
        if ( (proc.on === "heal") && !proc.sure ) problems.push(`${at}: what follows healing an ally is "sure"`);
        if ( (proc.on === "heal") && (effect.harmNear === undefined) ) problems.push(`${at}: healing an ally can harm the enemy nearest to it, "harmNear"`);
        if ( (proc.foe !== undefined) && (proc.foe !== true) ) problems.push(`${at}: "foe" is true or left out`);
        if ( proc.foe && proc.ally ) problems.push(`${at}: a staff is used on an "ally" or on a "foe", not both`);
        if ( (proc.reach !== undefined) && ((typeof proc.reach !== "string") || !proc.reach) ) problems.push(`${at}: "reach" is the Range a staff has, as it is written`);
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: a staff being used cannot do "${key}"`);
        for ( const grant of [].concat(effect.grant ?? []) ) {
          if ( grant?.reach || !["self", "target"].includes(grant?.to) ) problems.push(`${at}: as a staff is used a lasting change is for "self" or the "target"`);
        }
        if ( effect.harmNear !== undefined ) {
          const harm = effect.harmNear;
          if ( !harm || !Number.isInteger(harm.within) || (harm.within < 1) || !Number.isFinite(harm.percent) || (harm.percent <= 0) ) {
            problems.push(`${at}: harmNear needs "within", in whole tiles, and a "percent"`);
          }
          for ( const key of Object.keys(harm ?? {}) ) if ( !["within", "percent"].includes(key) ) problems.push(`${at}: harmNear cannot say "${key}"`);
        }
      }
      else {
        for ( const key of ["ally", "heals", "foe", "reach"] ) if ( proc[key] !== undefined ) problems.push(`${at}: only a staff being used asks "${key}"`);
        for ( const key of ["harmNear", "healPlus"] ) if ( key in effect ) problems.push(`${at}: only a staff being used can do "${key}"`);
      }
      if ( (proc.percent == null) && !proc.stat && !proc.sure && !proc.may && !proc.perDamage ) problems.push(`${at}: a chance needs a stat or a percent`);
      for ( const problem of checkAnswer(effect) ) problems.push(`${at}: ${problem}`);

      // A chance worked out for the unit that gives an aura, and what only an attack can add to its damage
      if ( (proc.giver !== undefined) && !((proc.giver === true) && effect.aura && !proc.sure) ) problems.push(`${at}: the "giver" rolls the chance of an aura, and only one that is rolled`);
      if ( "damageOfFoeHp" in effect ) {
        if ( proc.on !== "attack" ) problems.push(`${at}: a share of the foe's HP is added to the damage of an "attack"`);
        if ( !Number.isFinite(effect.damageOfFoeHp) || (effect.damageOfFoeHp <= 0) ) problems.push(`${at}: damageOfFoeHp is a share in percent, not "${effect.damageOfFoeHp}"`);
      }
      if ( ("recover" in effect) && (proc.on === "attack") ) problems.push(`${at}: an "attack" restores HP by a share of its damage, "heal"`);

      // A level up is not rolled for, and only knows what a level up can do; gold is for a level up or a kill
      if ( levelling(effect) ) {
        const parts = ["proc", "when", "choice", "reroll", "recover", "gold", "goldPerGain", "grant"];
        if ( !proc.sure ) problems.push(`${at}: a level up is not rolled for, its moment is "sure"`);
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: a level up cannot do "${key}"`);
      }
      else {
        if ( ("reroll" in effect) && !["miss", "critMiss"].includes(proc.on) ) problems.push(`${at}: a roll is made again at a level up, on a "miss" or on a "critMiss"`);
        if ( "goldPerGain" in effect ) problems.push(`${at}: only a level up can do "goldPerGain"`);
      }

      // A condition being inflicted is not rolled for either, and only knows a few things to do
      if ( afflicting(effect) ) {
        const parts = ["proc", "when", "choice", "grant", "remind", "returns", ...((proc.on === "inflict") ? ["recover", "spread"] : [])];
        if ( !proc.sure ) problems.push(`${at}: a condition being inflicted is not rolled for, its moment is "sure"`);
        for ( const key of Object.keys(effect) ) if ( !parts.includes(key) ) problems.push(`${at}: a condition being inflicted cannot do "${key}"`);
        for ( const id of [].concat(proc.condition ?? []) ) if ( !isCondition(id) ) problems.push(`${at}: unknown condition "${id}"`);
      }
      else if ( proc.condition !== undefined ) problems.push(`${at}: only "inflict" and "afflicted" wait for certain conditions`);
      if ( ("returns" in effect) && ((proc.on !== "afflicted") || !Number.isInteger(effect.returns) || (effect.returns < 1)) ) {
        problems.push(`${at}: a condition is handed back when "afflicted", for a whole number of turns`);
      }
      if ( ("gold" in effect) && !levelling(effect) && (proc.on !== "kill") && !TURN_MOMENTS.includes(proc.on) ) problems.push(`${at}: gold is gained on a "kill", at a "levelUp" or at a moment of a turn`);
      if ( ("gold" in effect) && TURN_MOMENTS.includes(proc.on) && (effect.aura || effect.reach) ) problems.push(`${at}: gold at a moment of a turn is for the skill's own unit`);
      for ( const key of [...Object.keys(effect.next ?? {}), ...Object.keys(effect.nextOfDamage ?? {}), ...Object.keys(effect.near?.next ?? {})] ) {
        if ( !nextParts.includes(key) ) problems.push(`${at}: the next attack cannot gain "${key}"`);
      }
      if ( ![undefined, true, false, "foe", "check"].includes(effect.remind) ) problems.push(`${at}: unknown reminder "${effect.remind}"`);
      for ( const part of effect.sequence ?? [] ) {
        for ( const key of Object.keys(part ?? {}) ) {
          if ( !sequenceParts.includes(key) ) problems.push(`${at}: an attack of a sequence cannot have "${key}"`);
        }
      }
      for ( const part of [effect, ...(effect.sequence ?? [])] ) {
        if ( part?.ignore && !["def", "res", undefined].includes(part.ignore.stat) ) problems.push(`${at}: unknown defence "${part.ignore.stat}"`);
        for ( const key of Object.keys(part?.statTimes ?? {}) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
      }
      for ( const entry of [...(effect.inflicts ?? []), ...(effect.inflictsAttacker ?? []), ...(effect.sequence ?? []).flatMap((part) => part.inflicts ?? [])] ) {
        const ids = (typeof entry === "string") ? [entry] : (entry?.anyOf !== undefined) ? [].concat(entry.anyOf) : [entry?.id];
        for ( const id of ids ) if ( !(id in FEO.conditions) && !(id in FEO.optionalConditions) ) problems.push(`${at}: unknown condition "${id}"`);
        if ( entry?.anyOf === undefined ) continue;
        if ( !["attack", "hit", "crit"].includes(proc.on) ) problems.push(`${at}: one of several conditions is picked by a die on an "attack", a "hit" or a "crit"`);
        if ( !Array.isArray(entry.anyOf) || (entry.anyOf.length < 2) || (Object.keys(entry).length > 1) ) problems.push(`${at}: "anyOf" lists the conditions to pick from, and nothing else`);
      }
      for ( const key of [...Object.keys(effect.combat ?? {}), ...Object.keys(effect.foeCombat ?? {})] ) {
        if ( (proc.on === "attacked") && (key === "critAvoid") ) continue;
        if ( !procCombat.includes(key) ) problems.push(`${at}: a chance at the start of a fight cannot change "${key}"`);
      }
    }
    // The round of a fight: who attacks when and how often, and a round fought again (see `rounds.mjs`)
    for ( const problem of checkRounds(effect) ) problems.push(`${at}: ${problem}`);
    for ( const key of Object.keys(effect?.when ?? {}) ) if ( !conditions.includes(key) ) problems.push(`${at}: unknown condition "${key}"`);
    if ( (effect?.when?.lasting !== undefined) && !((typeof effect.when.lasting === "boolean") && effect.when.declared) ) {
      problems.push(`${at}: "lasting" is true or false, beside "declared"`);
    }
    if ( (effect?.when?.equal !== undefined) && !(Array.isArray(effect.when.equal) && (effect.when.equal.length >= 2) && effect.when.equal.every((key) => key in FEO.stats)) ) {
      problems.push(`${at}: "equal" lists the stats that must be the same`);
    }
    if ( (effect?.when?.foeGiver !== undefined) && (typeof effect.when.foeGiver !== "boolean") ) problems.push(`${at}: "foeGiver" is true or false`);
    if ( (effect?.aura?.once !== undefined) && (effect.aura.once !== "turn") ) problems.push(`${at}: an aura is given "once" a "turn", or always`);

    // What the first attack of a fight gains, and no other
    if ( effect?.firstAttack !== undefined ) {
      const first = effect.firstAttack;
      if ( proc || effect.aura ) problems.push(`${at}: "firstAttack" is always there, not at a moment or as an aura`);
      if ( !first || (typeof first !== "object") || !Object.keys(first).length ) problems.push(`${at}: "firstAttack" names what the first attack gains`);
      else for ( const key of Object.keys(first) ) if ( !["hit", "critical", "damage"].includes(key) ) problems.push(`${at}: the first attack cannot gain "${key}"`);
    }
    for ( const key of ["hp", "foeHp"] ) {
      const test = effect?.when?.[key];
      if ( test && !ops.includes(test.op) ) problems.push(`${at}: unknown HP test "${test.op}"`);
    }
    if ( effect?.when?.role && !["initiating", "defending"].includes(effect.when.role) ) problems.push(`${at}: unknown role "${effect.when.role}"`);
    for ( const key of Object.keys(effect?.stats ?? {}) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
    for ( const key of Object.keys(effect?.statPercent ?? {}) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
    for ( const key of Object.keys(effect?.abilities ?? {}) ) if ( !(key in FEO.abilities) ) problems.push(`${at}: "abilities" are Charm ("cha") and Intelligence ("int"), not "${key}"`);
    for ( const key of Object.keys(effect?.combat ?? {}) ) if ( !COMBAT_KEYS.includes(key) ) problems.push(`${at}: unknown combat stat "${key}"`);
    for ( const rule of effect?.rules ?? [] ) if ( !RULES.includes(rule) ) problems.push(`${at}: unknown rule "${rule}"`);
    for ( const [key, mode] of Object.entries(effect?.calc ?? {}) ) {
      if ( !FEO.calcModes[key]?.[mode] && !SKILL_CALC[key]?.includes(mode) ) problems.push(`${at}: unknown formula "${key}: ${mode}"`);
    }

    // What a skill takes off the stats its foe fights with: always there, for the skill's own unit
    if ( effect?.foeStats !== undefined ) {
      if ( proc || effect.aura ) problems.push(`${at}: "foeStats" is always there, not at a moment or as an aura`);
      if ( !effect.foeStats || (typeof effect.foeStats !== "object") || !Object.keys(effect.foeStats).length ) problems.push(`${at}: foeStats must name stats`);
      else for ( const key of Object.keys(effect.foeStats) ) if ( !(key in FEO.stats) ) problems.push(`${at}: unknown stat "${key}"`);
    }
  });
  return problems;
}

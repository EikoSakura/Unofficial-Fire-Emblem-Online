/**
 * Tests for `module/rules/players.mjs`: a Game Master who joins as a temporary player on The Forge, and the
 * character of their own user.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOf, handedOwnership, isTemporary, mayTakeOver, ownUserOf, playerAmong } from "../module/rules/players.mjs";

const OWNER = 3;
const forge = (data) => ({ "forge-vtt": data });

/** A Game Master with a character, the temporary player The Forge logs them in as, and two others. */
const gm = { id: "gm1", active: false, character: "ike", flags: forge({ player: "acc-1" }) };
const temp = { id: "tmp1", active: true, character: null, flags: forge({ player: "acc-1", temporary: true }) };
const other = { id: "gm2", active: true, character: "soren", flags: forge({ player: "acc-2" }) };
const player = { id: "pl1", active: true, character: "mist", flags: forge({ player: "acc-3" }) };
const users = [other, gm, player, temp];

test("a temporary player is told by the mark The Forge puts on them", () => {
  assert.equal(isTemporary(temp), true);
  assert.equal(isTemporary(gm), false);
  assert.equal(isTemporary({ id: "x" }), false);
  assert.equal(isTemporary(null), false);
  assert.equal(accountOf(gm), "acc-1");
  assert.equal(accountOf({ id: "x", flags: forge({ player: 42 }) }), "42");
  assert.equal(accountOf({ id: "x", flags: {} }), "");
});

test("a temporary player is the user of the same account the rest of the time", () => {
  assert.equal(ownUserOf(temp, users)?.id, "gm1");
  // Other temporary players of the same account are not that user
  const older = { id: "tmp0", flags: forge({ player: "acc-1", temporary: true }) };
  assert.equal(ownUserOf(temp, [older, ...users])?.id, "gm1");
  // Nobody else of the account, and anyone who is not temporary, has none
  assert.equal(ownUserOf(temp, [other, player, temp]), null);
  assert.equal(ownUserOf(gm, users), null);
});

test("the account a client is logged in with goes before the one noted on the temporary player", () => {
  const unmarked = { id: "tmp2", flags: forge({ temporary: true }) };
  assert.equal(ownUserOf(unmarked, users), null);
  assert.equal(ownUserOf(unmarked, users, "acc-2")?.id, "gm2");
  assert.equal(ownUserOf(temp, users, "acc-2")?.id, "gm2");
});

test("a temporary player may take over the character of a user of their own account only", () => {
  assert.equal(mayTakeOver(temp, gm), true);
  assert.equal(mayTakeOver(temp, other), false);
  assert.equal(mayTakeOver(temp, { ...gm, character: null }), false);
  assert.equal(mayTakeOver(gm, other), false, "only a temporary player is handed one");
  assert.equal(mayTakeOver(temp, temp), false);
  assert.equal(mayTakeOver(temp, null), false);
  // Where The Forge notes no account on one of the two, the client is taken at its word
  assert.equal(mayTakeOver({ id: "tmp2", flags: forge({ temporary: true }) }, other), true);
});

test("of those who chose a unit, whoever is in the game plays it", () => {
  const both = [gm, { ...temp, character: "ike" }, other];
  assert.equal(playerAmong(both, "ike")?.id, "tmp1");
  // Their own user before the temporary one where both, or neither, are in the game
  assert.equal(playerAmong([{ ...temp, character: "ike", active: false }, gm], "ike")?.id, "gm1");
  assert.equal(playerAmong([{ ...temp, character: "ike" }, { ...gm, active: true }], "ike")?.id, "gm1");
  assert.equal(playerAmong(users, "soren")?.id, "gm2");
  assert.equal(playerAmong(users, "nobody"), null);
  assert.equal(playerAmong(users, ""), null);
});

test("a unit handed to a temporary player is theirs, and no longer that of users who are gone", () => {
  const ids = users.map((user) => user.id);
  assert.deepEqual(handedOwnership({ default: 0, gm1: OWNER }, "tmp1", ids, OWNER), { default: 0, gm1: OWNER, tmp1: OWNER });
  assert.deepEqual(handedOwnership({ default: 0, gone: OWNER, pl1: 2 }, "tmp1", ids, OWNER), { default: 0, pl1: 2, tmp1: OWNER });
  assert.equal(handedOwnership({ default: 0, tmp1: OWNER }, "tmp1", ids, OWNER), null, "nothing to change");
  assert.deepEqual(handedOwnership(undefined, "tmp1", ids, OWNER), { tmp1: OWNER });
});

# Tests

Tests for the pure rules in `module/rules/`, one file for each rules module. They need nothing but Node (22 or
later) and read the skills as they are written in `packs-src/skills/effects.json`.

Run them all from the system's folder:

```
node --test "tests/*.test.mjs"
```

or one file by itself:

```
node tests/events.test.mjs
```

`tests/lib/fixtures.mjs` has what they share: a skill by its name, a unit to try it on, a fighter for a fight
the system rolls, and dice that come up as told.

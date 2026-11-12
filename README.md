# Elden Ring Infusion Calculator

Pick a weapon, enter your stats, and see the attack rating (AR) of every infusion side by side:
Standard, Heavy, Keen, Quality, Fire, Flame Art, Lightning, Sacred, Magic, Cold, Poison, Blood
and Occult. It covers all 488 weapons in patch 1.17 (Shadow of the Erdtree included), with
status buildup and staff/seal spell scaling.

## Use it

Open `dist/elden-ring-infusion-calculator.html` in a browser. It is a single file with the weapon
database embedded, so it works offline and can be hosted anywhere. Only the two web fonts come
from Google Fonts, and system fonts stand in without them.

- **Weapon**: type part of a name, a weapon type ("katana") or "dlc", then pick with the arrow
  keys and Enter. Clear the box to browse every weapon by type.
- **Upgrade level**: one slider for regular (+25) and somber (+10) weapons. Switching weapons
  carries the level across the way the game's smithing tables line up (+25 ↔ +10).
- **Grip**: two-handing counts Strength as 1.5×. Bows, greatbows and ballistae are always held in
  two hands; paired weapons never get the bonus.
- **Attributes**: STR, DEX, INT, FAI and ARC as your status screen shows them, before the
  two-handed bonus.

The page shows the best infusion and its damage split, then a table of every infusion with AR,
damage per type, status buildup and scaling letters. Select a row to see where its damage comes
from (base value plus each stat's bonus). Inputs are remembered in the browser.

## How attack rating is calculated

For each damage type (physical, magic, fire, lightning, holy) of one weapon and infusion:

```
base     = base attack × upgrade attack multiplier         (ReinforceParamWeapon)
scaling  = attribute scaling × upgrade scaling multiplier
AR(type) = base × (1 + Σ curve(stat) × scaling[stat])     over the stats that type scales with
```

- Which stats a damage type scales with comes from AttackElementCorrectParam. For example Fire
  makes physical damage scale with STR, while Flame Art makes fire damage scale with FAI.
- `curve(stat)` is that type's CalcCorrectGraph curve, the source of the soft caps.
- Two-handing multiplies STR by 1.5, rounded down, before requirements and scaling are applied.
- An unmet requirement removes the scaling from every damage type that scales with that stat and
  multiplies those types by 0.6 instead.
- Status buildup (bleed, frost, poison, rot, sleep, madness, blight) comes from the weapon's
  SpEffect slots. Bleed, poison, sleep and madness scale with Arcane; frost, rot and blight don't.
- Staves and seals: spell scaling is 100 × the same multiplier. Sorceries use the magic row and
  incantations the holy row.
- Numbers are rounded down like the in-game status screen. The total is the rounded-down sum of the
  unrounded parts, so it can be 1 higher than the shown parts added up.

AR is the number on the equipment screen, not the damage an attack deals: enemy defense and
negation apply per damage type, and each attack has its own motion value. Ammunition damage for
bows and crossbows isn't included.

## Data

`data/weapons.json` is built from the regulation export that ships with Tom Clark's open-source
[Elden Ring weapon calculator](https://github.com/ThomasJClark/elden-ring-weapon-calculator)
(MIT license, live at [eldenring.tclark.io](https://eldenring.tclark.io)). That export holds the
game's own params from `regulation.bin`, patch 1.17. `meta.source` records the upstream file,
commit and SHA-256; `data/source/` keeps a copy of the export and its license.

| Key | Contents |
| --- | --- |
| `meta` | Patch, weapon and infusion counts, source repo, commit and hash, notes |
| `affinities` | `[id, name]` in in-game order; `-1` is Unique (can't be infused) |
| `weaponTypes` | `[id, name]` in in-game menu order |
| `scalingTiers` | `[threshold, letter]` for the S, A, B, C, D and E scaling grades |
| `curves` | CalcCorrectGraph id → five `[stat, growth, exponent]` stages |
| `elementCorrect` | AttackElementCorrectParam id → damage type → `{ stat: true }`, or a number for the few weapons that override the scaling (Smithscript weapons, Golem Fist) |
| `reinforce` | ReinforceParamWeapon id → one row per upgrade level: `attack[5]` (physical, magic, fire, lightning, holy), `scaling[5]` (str, dex, int, fai, arc), `statusOffsets[3]` |
| `statusEffects` | SpEffectParam id → `{ status: buildup }` |
| `weapons` | One entry per weapon, described below |

Each weapon has `name`, `type`, `requirements` (`{ str, dex, int, fai, arc }`, omitted when 0),
`wiki`, and `dlc`, `paired`, `sorcery` or `incantation` when true. Its `infusions` array holds
one entry per form (13, or 1 for unique weapons):

| Field | Contents |
| --- | --- |
| `affinity`, `name` | Affinity id and full in-game name, e.g. `11`, `"Blood Uchigatana"` |
| `attack` | Base damage at +0 per type, e.g. `{ "physical": 99, "fire": 64 }` |
| `scaling` | Attribute scaling at +0, e.g. `{ "str": 0.25, "dex": 0.38 }` (0.5 = 50%) |
| `reinforce` | Key into `reinforce` |
| `elementCorrect` | Key into `elementCorrect` |
| `curves` | Curve id per damage type and status effect |
| `statusEffects` | Three SpEffect ids, when the weapon has buildup; add `reinforce[…][level].statusOffsets[slot]` |

## Build and test

Needs Node 18 or newer; there are no dependencies to install.

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the engine tests. `npm run build` bundles `src/` and the database into
`dist/elden-ring-infusion-calculator.html` and `dist/artifact.html` (the same page without the
`<html>`/`<head>`/`<body>` wrapper, for hosts that add their own).

To regenerate the database, or rebuild it from a newer regulation export:

```bash
node scripts/build-db.mjs data/source/regulation-vanilla-v1.17.json data/weapons.json
```

## Verification

- `tests/engine.test.mjs` has 14 tests: database coverage, stat curves, upgrade multipliers,
  the requirement penalty, two-handing, paired weapons and bows, infusion damage splits, status
  buildup, Smithscript scaling overrides, catalysts and the +25 ↔ +10 level mapping.
- On 2026-11-11 the results were compared with [eldenring.tclark.io](https://eldenring.tclark.io)
  for 234 weapon and infusion rows over four builds: a one-handed DEX build; a low-stat two-handed
  build with unmet requirements, paired weapons, bows and somber weapons; casters; and every status
  type. All 4,662 values matched.

## Files

| Path | What it is |
| --- | --- |
| `src/engine.js` | The AR math. Loads as `window.ArEngine` in a page or with `require` in Node |
| `src/app.js` | Page logic: weapon search, inputs, results table and breakdowns |
| `src/page.html`, `src/styles.css` | Page template and styles |
| `scripts/build-db.mjs` | Builds `data/weapons.json` from the regulation export |
| `scripts/build-page.mjs` | Bundles everything into `dist/` |
| `data/weapons.json` | The weapon database |
| `data/source/` | Upstream regulation export and its MIT license |
| `tests/engine.test.mjs` | Engine tests |

## Credits

Game data © FromSoftware. Data extraction and format by Tom Clark, used under the MIT license
(`data/source/LICENSE-upstream.txt`). A fan-made tool, not affiliated with FromSoftware or
Bandai Namco.

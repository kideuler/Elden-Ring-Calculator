# Elden Ring Infusion Calculator

Pick a weapon, enter your stats, and see the attack rating (AR) of every infusion side by side:
Standard, Heavy, Keen, Quality, Fire, Flame Art, Lightning, Sacred, Magic, Cold, Poison, Blood
and Occult. It covers all 488 weapons in patch 1.17 (Shadow of the Erdtree included), with
status buildup and staff/seal spell scaling.

Pick a boss as well and the infusions are ranked by how fast they kill it instead: the boss's
defense, damage negation and status resistance are all counted, so the infusion with the highest
AR isn't always the winner.

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
- **Boss** (optional): one of 84 boss fights. A card shows its HP, defense, damage negation per
  type and the buildup each status needs for every proc in turn (e.g. bleed 293 / 335 / 433 / 723
  / 1,180 for the Divine Beast Dancing Lion at Belurat). **Fight settings** set the physical damage type of your
  hits (by default the weapon class's usual one, e.g. slash for katanas), your pace in seconds per
  hit and the attack's motion value.

The page shows the best infusion and its damage split, then a table of every infusion with AR,
damage per type, status buildup and scaling letters. With a boss picked it shows DPS, hits and
time to kill, damage per hit and status procs instead. Select a row to see where its damage comes
from (base value plus each stat's bonus, and with a boss, what its defenses take off). Inputs are
remembered in the browser.

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

## Damage against a boss: the DPS metric

With a boss picked, each infusion is scored by **DPS = boss HP ÷ seconds to kill it**, from a
simulated fight at a steady pace (one hit every 2 seconds by default, motion value 100):

1. **One hit.** For each damage type, `attack = AR × motion value / 100`. Defense lets a share of
   it through that depends on `attack / defense`: 10% at 1/8 of defense or less, 40% at equal
   values, 70% at 2.5× and 90% at 8× or more, with quadratic curves in between. Negation then
   removes its percentage. Physical damage uses the negation of the hit's physical type
   (standard, slash, strike or pierce). This is why damage split across two types, or put into a
   type the boss resists, deals less than its AR suggests.
2. **Status procs.** Each hit adds its buildup. When a meter reaches the boss's resistance it
   procs, empties, and the next proc needs the next (higher) threshold from the boss's list:
   - Bleed: 15% of max HP + 100 at once.
   - Frost: 10% of max HP + 30 at once, then the boss takes 20% more damage for 30 seconds.
   - Poison: 0.07% of max HP + 7 per second for 90 seconds.
   - Scarlet rot: 0.18% of max HP + 15 per second for 90 seconds.

   Bosses take 50–70% of the usual bleed and frost damage (`statusDamage`). Frost, poison and
   rot can't build up again while active. Sleep and madness procs are counted but deal nothing.
3. **Kill time.** Hits land until HP runs out, poison and rot ticking in between; only the part of
   the last swing that was needed counts, so with no status effects DPS is exactly damage per hit
   ÷ seconds per hit.

Ties are broken by damage per hit. Every infusion of a weapon shares its moveset, so the pace
scales them all alike and the ranking mostly holds at other paces. The exceptions are the timed
effects: poison and scarlet rot tick per second, so they count for more at a slow pace, and
frostbite's 30-second bonus covers more hits at a fast one.

Limits:

- New Game numbers only (no NG+ scaling). The data has 84 boss fights; some bosses are missing,
  and a second phase with its own health bar, like Malenia's, isn't added on.
- One damage type for all physical hits, while real movesets mix them. Pick the type in Fight
  settings to match how you fight.
- Status buildup is assumed not to decay between hits, and spells, weapon skills, buffs and
  ammunition aren't modeled.

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

### Boss data

`data/bosses.json` is built by `scripts/build-bosses.mjs` from
`data/source/bosses-fextralife.jsonl`, a transcription of the boss pages on the
[Elden Ring Wiki](https://eldenring.wiki.fextralife.com/Bosses). The wiki's combat tables come
from the game params through nex3's [BossDataExtractor](https://github.com/nex3/BossDataExtractor).
Proc damage follows the wiki's Hemorrhage, Frostbite, Poison and Scarlet Rot pages.

Each boss has `id`, `name`, `label` (the name plus the location when a boss has several),
`location`, `dlc`, `hp`, `wiki`, and:

| Field | Contents |
| --- | --- |
| `defense` | `{ physical, magic, fire, lightning, holy }`; the same for every type except on armored bosses such as Rakshasa |
| `negation` | Percent removed per type: `standard`, `slash`, `strike`, `pierce`, `magic`, `fire`, `lightning`, `holy` (negative = takes extra) |
| `status` | `{ poison, rot, bleed, frost, sleep, madness }`: buildup needed for the 1st proc, 2nd, 3rd and so on; procs past the end of the list need its last value, and a single value never rises. `null` = immune |
| `statusDamage` | Share of normal bleed and frost damage the boss takes: 0.7, 0.65 or 0.5 |

## Build and test

Needs Node 18 or newer; there are no dependencies to install.

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the engine and boss tests. `npm run build` bundles `src/` and the database into
`dist/elden-ring-infusion-calculator.html` and `dist/artifact.html` (the same page without the
`<html>`/`<head>`/`<body>` wrapper, for hosts that add their own).

To regenerate the database, or rebuild it from a newer regulation export:

```bash
node scripts/build-db.mjs data/source/regulation-vanilla-v1.17.json data/weapons.json
```

To rebuild the boss database after editing `data/source/bosses-fextralife.jsonl`:

```bash
npm run build:bosses
```

## Verification

- `tests/engine.test.mjs` has 14 tests: database coverage, stat curves, upgrade multipliers,
  the requirement penalty, two-handing, paired weapons and bows, infusion damage splits, status
  buildup, Smithscript scaling overrides, catalysts and the +25 ↔ +10 level mapping.
- On 2026-11-11 the results were compared with [eldenring.tclark.io](https://eldenring.tclark.io)
  for 234 weapon and infusion rows over four builds: a one-handed DEX build; a low-stat two-handed
  build with unmet requirements, paired weapons, bows and somber weapons; casters; and every status
  type. All 4,662 values matched.
- `tests/boss.test.mjs` has 10 tests: the boss database's shape and spot values, the defense
  curve, per-type defense and negation, kill time with and without bleed, frost and poison,
  rising proc thresholds (against the Dancing Lion, bleed procs land on hits 3, 7, 11, 18, 29 and
  40 instead of every 3 hits), immunities, and Blood beating Keen only against a boss that can
  bleed.

## Files

| Path | What it is |
| --- | --- |
| `src/engine.js` | The AR math. Loads as `window.ArEngine` in a page or with `require` in Node |
| `src/engine.js` (boss part) | `hitDamage` and `fightBoss`: one hit against a boss, and the fight simulation behind DPS |
| `src/app.js` | Page logic: weapon search, inputs, boss picker, results table and breakdowns |
| `src/page.html`, `src/styles.css` | Page template and styles |
| `scripts/build-db.mjs` | Builds `data/weapons.json` from the regulation export |
| `scripts/build-bosses.mjs` | Builds `data/bosses.json` from the boss transcription |
| `scripts/build-page.mjs` | Bundles everything into `dist/` |
| `data/weapons.json` | The weapon database |
| `data/bosses.json` | The boss database |
| `data/source/` | Upstream regulation export and its MIT license, and the boss transcription |
| `tests/engine.test.mjs` | Engine tests |
| `tests/boss.test.mjs` | Boss damage and fight tests |

## Credits

Game data © FromSoftware. Weapon data extraction and format by Tom Clark, used under the MIT
license (`data/source/LICENSE-upstream.txt`). Boss numbers from the Elden Ring Wiki on Fextralife,
extracted from the game by nex3's BossDataExtractor. A fan-made tool, not affiliated with FromSoftware or
Bandai Namco.

# Elden Ring Infusion Calculator

Enter four things: your weapon (with its upgrade level), your attributes, your talismans and,
optionally, a boss. The page shows the attack rating (AR) of every infusion side by side:
Standard, Heavy, Keen, Quality, Fire, Flame Art, Lightning, Sacred, Magic, Cold, Poison, Blood
and Occult. It covers all 488 weapons in patch 1.17 (Shadow of the Erdtree included), with
status buildup and staff/seal spell scaling.

Pick a boss and the infusions are ranked by how fast they kill it instead, over 300 simulated
fights. The boss's defense, damage negation, rising status resistance and how much room it
leaves to attack are all counted, and so are your stamina and talismans. The calculator works
out the rest itself: which grip to use, which attacks to throw in each opening, and how long the
fight takes, with a range. The infusion with the highest AR often isn't the winner.

## Use it

Open `dist/elden-ring-infusion-calculator.html` in a browser. It is a single file (about 2 MB)
with all the data and icons embedded, so it works offline and can be hosted anywhere. Only the
two web fonts come from Google Fonts, and system fonts stand in without them.

Weapons and talismans show their in-game icons: in the weapon box and its list, in each talisman
slot (an empty slot shows a dashed ring) and beside the winning infusion's name.

- **Weapon**: type part of a name, a weapon type ("katana") or "dlc", then pick with the arrow
  keys and Enter. Clear the box to browse every weapon by type.
- **Upgrade level**: one slider for regular (+25) and somber (+10) weapons. Switching weapons
  carries the level across the way the game's smithing tables line up (+25 ↔ +10).
- **Attributes**: Endurance, Strength, Dexterity, Intelligence, Faith and Arcane, as your
  level-up screen shows them. Endurance sets your stamina (121 at 25), which limits how many
  attacks fit in one opening. The calculator applies the two-handed Strength bonus itself.
- **Talismans**: up to four, from the 33 that change these numbers:
  - attributes: Radagon's and Marika's Scarseal and Soreseal, and the five +5 heirlooms;
  - attack: Axe (charged heavies), Claw (jump attacks), Twinblade (the last light attack of a
    chain), Two-Handed Sword, the four elemental Scorpion Charms, Ritual Sword and
    Red-Feathered Branchsword;
  - during the fight: Winged Sword Insignia, Rotten Winged Sword Insignia, Millicent's
    Prosthesis, Lord of Blood's Exultation, Kindred of Rot's Exultation, St. Trina's Smile and
    Aged One's Exultation;
  - stamina: Viridian Amber Medallion and Erdtree's Favor.

  As in the game, two versions of one talisman can't be worn together. Counter-hit (Spear),
  guard counter, critical hit, mounted, dash, roll and weapon skill or spell talismans aren't
  counted, because the fight model has no counter-hits, blocks, crits, mount or skills.
- **Boss** (optional): one of 84 boss fights. A card shows its HP, defense, damage negation per
  type, the buildup each status needs for every proc in turn (e.g. bleed 293 / 335 / 433 / 723
  / 1,180 for the Divine Beast Dancing Lion at Belurat) and how much room it leaves to attack.

Without a boss, the page shows the best infusion by AR and its damage split, then a table of every
infusion with AR, damage per type, AR two-handed, status buildup and scaling letters. With a boss
it shows the fastest-killing infusion with its DPS. Below that it says which grip it uses, what it
usually does with an opening, the average kill time and the range 8 of 10 fights fall in. It also
gives the lead over the runner-up and how often each infusion was the first to kill. The table
shows every infusion's DPS, grip, kill time, status procs and, for the four physical infusions,
DPS with their best grease.

Select a row for the breakdown: base damage plus each attribute's bonus. With a boss it also
shows DPS in each grip, the attack strings it plays and how often, one hit against the boss's
defense and negation, and the status procs. Last comes the weapon's moveset, with motion values,
damage type, timing and stamina cost of each attack. Inputs are remembered in the browser.

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
- Talismans' attribute points are added first, capped at 99, and count toward requirements.
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

## Against a boss: the fight model

Each infusion is scored by **DPS = boss HP ÷ average time to kill it** over 300 simulated fights.
The only inputs are the four above; everything else comes from game data, is worked out by the
model, or is averaged over.

### The fights

A fight is a run of cycles: the boss attacks for a while (the gap), then leaves an opening you can
attack in. Opening and gap lengths are random: each is Gamma distributed (shape 3) around the
fight's own averages. Those averages vary from fight to fight, log-normally with σ = 0.25, around
the boss's tempo. No one has published how long bosses leave themselves open, so each boss is
placed in one of five classes by how its fight plays. These numbers are estimates, not game data:

| Class | Opening | Gap | Bosses | |
| --- | --- | --- | --- | --- |
| Typical | 2.0 s | 3.0 s | 19 | Trades combos for clear openings |
| Aggressive | 1.5 s | 3.5 s | 31 | Long combos and short openings (Margit, Malenia, the Dancing Lion) |
| Slow and heavy | 2.8 s | 3.5 s | 15 | Big, slow attacks with long recoveries (Fire Giant, Putrid Avatar) |
| Keeps its distance | 3.0 s | 6.0 s | 10 | Long openings once you reach it, long waits in between (most dragons, Rennala) |
| Evasive | 1.8 s | 5.0 s | 9 | Keeps moving, so openings are short and far apart |

Openings are counted in whole frames (30 per second) and cut at 12 s. Every infusion meets the same
300 fights, drawn from a seed per boss, so differences between infusions aren't sampling noise.
That also gives a second score: the share of fights in which each infusion is the first to kill.

### What you do with an opening

Attacks come from the weapon's moveset in five families: the R1 chain (through every R1 of the
moveset), uncharged heavies, charged heavies, jump R1s and jump R2s. In one opening you play the
first n attacks of one family, repeating it when it runs out, up to 16 attacks. A string fits
when two things hold:

- **Time:** each attack but the last has reached the frame where the next can start, and the last
  has reached the frame where you can dodge, within the opening.
- **Stamina:** the string costs less than your maximum stamina, so some is left to dodge with.
  Stamina refills between openings.

Of each family the longest string that fits is considered, and the one worth the most is
played. Its worth is its direct damage plus its status buildup, valued at what the next proc
deals per point of buildup it still needs. Buildup is worth nothing while that status is still
active and can't build up. Frost's worth includes frostbite's extra damage over a typical
opening. So a weapon with buildup leans toward many quick hits, and a weapon without leans
toward the biggest hits, which also get more of their attack through defense.

The game's animation data starts uncharged heavies at the release and jump attacks at the
landing. Two fixed estimates fill the gap: 0.3 s of wind-up before an uncharged heavy, and 0.9 s
in the air before a jump attack (a normal jump has about 25 frames of i-frames). A jump attack
can't start until the previous one's dodge frame. Running, rolling and backstep attacks and guard
counters need a setup first, so they are listed but not planned.

### One hit

For each damage type of a hit:

```
attack = (AR + grease) × motion value / 100 × talisman multipliers
dealt  = attack × defenseMultiplier(attack / defense) × (1 − negation)
```

The defense multiplier lets 10% through at 1/8 of defense or less, 40% at equal values, 70% at
2.5× and 90% at 8× or more, with quadratic curves in between. Negation removes its percentage;
physical damage uses the negation of the hit's own physical type (standard, slash, strike or
pierce, from the game data: the one-handed katana R2 is a thrust, for example). Damage split
across two types, or put into a type the boss resists, deals less than its AR suggests, and an
attack multiplier is worth more than its percentage.

### Status procs

Each hit adds the weapon's full buildup, whatever its motion value. When a meter reaches the
boss's resistance it procs, empties, and the next proc needs the next (higher) threshold from the
boss's list; past its end, the last value:

- Bleed: 15% of max HP + 100 at once.
- Frost: 10% of max HP + 30 at once, then the boss takes 20% more damage for 30 seconds. A hit
  with fire damage ends frostbite early.
- Poison: 0.07% of max HP + 7 per second for 90 seconds.
- Scarlet rot: 0.18% of max HP + 15 per second for 90 seconds.

Bosses take 50–70% of the usual bleed and frost damage (`statusDamage`). Frost, poison and rot
can't build up again while active. Sleep and madness procs are counted but deal nothing (they can
still trigger St. Trina's Smile and Aged One's Exultation).

### Talismans in the fight

- Attack talismans multiply the attack of their kind of attack before defense; the Scorpion Charms
  multiply one damage type.
- **Winged Sword Insignia, Rotten Winged Sword Insignia and Millicent's Prosthesis** count points:
  8 for an R1 or jump R1, 10 for an R2 or jump R2, 14 for a charged heavy, at most 60. Holding
  17, 30 or 45 points gives the first, second or third bonus. Points drain one at a time while
  you aren't hitting, every 0.5, 1, 0.7 or 0.4 s depending on how many you hold. The wiki lists
  those four intervals without saying which range each belongs to, so they are read in threshold
  order (an assumption). Millicent's and the Rotten insignia are assumed to work like the
  Winged Sword Insignia, whose page documents the mechanics.
- **Lord of Blood's Exultation, Kindred of Rot's Exultation, St. Trina's Smile and Aged One's
  Exultation** switch on for 20 or 30 seconds after their status procs.
- **Ritual Sword Talisman and Red-Feathered Branchsword** depend on your HP, which the calculator
  can't know: they count for half and a tenth of the fight.

### Grip, grease and the score

- Each infusion fights one-handed and two-handed and keeps the faster. Paired weapons only fight
  one-handed; bows only two-handed.
- The four physical infusions (Standard, Heavy, Keen, Quality) of an infusable weapon also fight
  with their best grease: +85 attack of fire, lightning, magic or holy. The best one is whichever
  adds the most to a 100 motion value hit against this boss. Greases last 60 seconds in game but
  are assumed to stay on all fight. The grease result is shown beside the infusion, not ranked.
- A fight ends on the killing hit, or the moment poison or rot finishes the boss. A weapon that
  can't kill within 4,000 openings counts as unable to.
- DPS is HP ÷ the mean kill time. The page also gives the 10th to 90th percentile of kill times,
  the median number of openings, and each infusion's share of fights won. Ties go to the higher
  AR.

### How much the tempo guess matters

The tempo classes are the model's weakest input, so the ranking was checked against them on
2026-11-12: 26 infusable weapons × 21 bosses × 2 builds, 1,092 matchups. The table shows what
happens when every boss's openings or gaps are off by a factor of 1.5:

| Change | Same winner | Changed, and the old winner is >5% slower | Kill time (median) |
| --- | --- | --- | --- |
| Openings × 0.67 | 91.8% | 2.5% | × 1.64 |
| Openings × 1.5 | 95.6% | 0.3% | × 0.71 |
| Gaps × 0.67 | 98.1% | 0.0% | × 0.77 |
| Gaps × 1.5 | 97.2% | 0.4% | × 1.35 |
| Every boss "Typical" | 96.5% | 0.4% | × 0.70 |

Kill times move with the guess; which infusion wins mostly doesn't, and when it does change the
two were close.

### Limits

- New Game numbers only (no NG+ scaling). The data has 84 boss fights; some bosses are missing,
  and a second phase with its own health bar, like Malenia's, isn't added on.
- You never get hit, heal or miss. Stance breaks and ripostes, counter-hits, buffs, weapon
  skills, spells, spirit ashes and Powerstance (paired L1) attacks aren't modeled. Neither are
  projectiles or shockwaves that some attacks add (Wing of Astel, Golem Fist).
- Status buildup doesn't drain between hits (no published rates).
- Staffs, seals, bows and Unarmed have no moveset data and fall back to one 100 motion value
  hit per second of opening.
- 96 of the 4,182 attack entries have no timing in the frame data, and a family with one of them
  can't be planned. 99 have no stamina cost and count as free.

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

`data/bosses.json` is built by `scripts/build-bosses.mjs` from two files in `data/source/`:

- `bosses-fextralife.jsonl`: a transcription of the boss pages on the
  [Elden Ring Wiki](https://eldenring.wiki.fextralife.com/Bosses). The wiki's combat tables come
  from the game params through nex3's [BossDataExtractor](https://github.com/nex3/BossDataExtractor).
  Proc damage follows the wiki's Hemorrhage, Frostbite, Poison and Scarlet Rot pages.
- `boss-tempo.json`: this calculator's own estimate of how much room each boss leaves to attack.
  It holds the five classes (`opening` and `gap` in seconds, a label and a description), the
  shared `shape` and `spread`, and a class for every boss name. The build fails if a boss has no
  class or the file names a boss that doesn't exist. Replace the classes with measured values
  when there are any.

Each boss has `id`, `name`, `label` (the name plus the location when a boss has several),
`location`, `dlc`, `hp`, `wiki`, and:

| Field | Contents |
| --- | --- |
| `defense` | `{ physical, magic, fire, lightning, holy }`; the same for every type except on armored bosses such as Rakshasa |
| `negation` | Percent removed per type: `standard`, `slash`, `strike`, `pierce`, `magic`, `fire`, `lightning`, `holy` (negative = takes extra) |
| `status` | `{ poison, rot, bleed, frost, sleep, madness }`: buildup needed for the 1st proc, 2nd, 3rd and so on; procs past the end of the list need its last value, and a single value never rises. `null` = immune |
| `statusDamage` | Share of normal bleed and frost damage the boss takes: 0.7, 0.65 or 0.5 |
| `tempo` | Its tempo class: `standard`, `aggressive`, `heavy`, `distant` or `evasive`; `meta.tempo` holds the classes |

### Moveset data

`data/attacks.json` is built by `scripts/build-attacks.mjs` from two sources in `data/source/`:

- `motion-values.csv`: the community
  [Elden Ring Motion Values and Attack Data](https://docs.google.com/spreadsheets/d/1j4bpTbsnp5Xsgw9TP2xv6d8R4qk0ErpE9r_5LGIDraU/edit#gid=0)
  sheet (patch 1.16), exported as CSV. Motion values per weapon and attack, one per hit
  (`50 + 110` is a two-hit attack). Projectile, shockwave and alternative values in parentheses
  aren't counted.
- `frame-data.json`: frame data read from the game files (patch 1.17.3) by AtomechLLC's
  [game-animation-library](https://github.com/AtomechLLC/game-animation-library/tree/main/frame-data),
  whose move names follow sovietspaceship's [Elden Ring Frame Data Explorer](https://er-frame-data.nyasu.business/).
  Trimmed to the one- and two-handed attacks used here: each attack's physical damage type, its
  stamina cost, and two frames at 30 fps: the one from which the next attack can start, and the
  one from which you can dodge.

Motion values come from the sheet because it has every hit of multi-hit attacks and the weapons
whose attacks differ from the rest of their class (Alabaster Lord's Sword, Bloodhound's Fang); the
frame data records only the first hit, keyed by animation. Where both have a single-hit value
they agree on 11,828 of 11,980 (99%). The sheet fills the attacks the frame data has no motion
value for (the Greatsword's two-handed R1s, for example), and the frame data fills 29 the sheet
leaves blank.

424 weapons have a moveset (135 distinct ones). The file is `{ meta, movesets, weapons }`:
`weapons` maps a weapon name to its index in `movesets`, and each moveset has a `1h` and `2h`
list of `[attack, [motion value per hit], physical type, next, dodge, stamina]`, for example
`["R1 1", [100], "slash", 17, 25, 12]`: the next attack can start after 17 frames, you can dodge
after 25, and it costs 12 stamina. The last three are `null` when the frame data doesn't cover
that attack's animation (a few unique weapons). The attacks are R1 1–6, R2 1–2, Charged R2 1–2,
Running R1/R2, Rolling R1, Backstep R1, Jumping R1/R2 and Guard Counter.

### Talisman data

`data/talismans.json` is written by hand from the
[Elden Ring Wiki](https://eldenring.wiki.fextralife.com/Talismans) and
[Eldenpedia](https://eldenring.wiki.gg/wiki/Talismans) (retrieved 2026-11-12). `meta` documents
the fields and lists the talismans that aren't counted. Each of the 33 entries has `name`,
`category` (`attributes`, `attack`, `fight` or `stamina`), `effect` (the text the page shows),
`dlc` when true, `group` (versions that can't be worn together) and one or more of:

| Field | Contents |
| --- | --- |
| `stats` | Attribute points added, e.g. `{ "end": 5, "str": 5, "dex": 5 }` |
| `stamina` | Multiplier on maximum stamina, e.g. `1.17` |
| `damage` | Multiplier on one damage type's attack, e.g. `{ "fire": 1.12 }` |
| `attack` | `{ kind, multiplier }` for one kind of attack: `charged`, `jump`, `finisher` or `two-handed` |
| `successive` | Multipliers at the three stages of the successive-attack effect |
| `after` | `{ status: [...], multiplier, seconds }`: a boost after one of these statuses procs |
| `assumed` | `{ multiplier, share }`: an HP-dependent boost counted for a fixed share of the fight |

### Icons

`data/icons.webp` is a sprite of the in-game icon of every weapon and talisman: 521 icons in
64-pixel cells, 32 to a row (2048 × 1088 pixels, about 600 KB). `scripts/build-icons.py` reads
each item's page on [Eldenpedia](https://eldenring.wiki.gg) (the page `data/weapons.json` links
for a weapon; the talisman's name for a talisman), takes the image in the page's infobox,
downloads it at 128 pixels and scales it into its cell. Two pairs of weapons use the same icon
on the wiki: the two Greatswords of Radahn, and the Butchering Knife with the Bonny Butchering
Knife.

`data/icons.json` says which cell holds which item:

| Field | Contents |
| --- | --- |
| `meta` | Source, retrieval date, `cell` size, `columns` and `rows` |
| `weapons`, `talismans` | Name to cell number, counted left to right and top to bottom from 0 |
| `files` | The wiki file each icon came from |
| `missing` | Items the wiki had no icon for (none at present); the page leaves a blank space |

The page puts the sprite into one CSS rule as a data URI, so the browser decodes it once for
every icon. Each icon is a `<span class="icon">` whose `--x` and `--y` (column and row) pick its
cell by percentage, which works at any display size.

## Build and test

Needs Node 18 or newer; there are no dependencies to install. Refreshing the icons also needs
Python 3 with Pillow.

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the engine, boss, attack, fight and icon tests. `npm run build` bundles `src/` and the
data into `dist/elden-ring-infusion-calculator.html` and `dist/artifact.html` (the same page
without the `<html>`/`<head>`/`<body>` wrapper, for hosts that add their own).

To regenerate the database, or rebuild it from a newer regulation export:

```bash
node scripts/build-db.mjs data/source/regulation-vanilla-v1.17.json data/weapons.json
```

To rebuild the boss database after editing `data/source/bosses-fextralife.jsonl` or
`data/source/boss-tempo.json`:

```bash
npm run build:bosses
```

To rebuild the moveset data, from `data/source/` or from fresh downloads of the frame data's
`elden-ring.json` and the motion value sheet's first tab as CSV:

```bash
npm run build:attacks
```

```bash
node scripts/build-attacks.mjs --import path/to/elden-ring.json path/to/motion-values.csv
```

To fetch the icons again, after adding weapons or talismans or to pick up the wiki's changes.
It makes about 25 requests to the wiki's API, then downloads the icons it doesn't have yet into a
cache folder (by default one in the system temp folder; pass `--cache DIR` to choose):

```bash
npm run build:icons
```

## Verification

`npm test` runs 41 tests.

- `tests/engine.test.mjs` (14): database coverage, stat curves, upgrade multipliers, the
  requirement penalty, two-handing, paired weapons and bows, infusion damage splits, status
  buildup, Smithscript scaling overrides, catalysts and the +25 ↔ +10 level mapping.
- On 2026-11-11 the AR results were compared with [eldenring.tclark.io](https://eldenring.tclark.io)
  for 234 weapon and infusion rows over four builds: a one-handed DEX build; a low-stat two-handed
  build with unmet requirements, paired weapons, bows and somber weapons; casters; and every status
  type. All 4,662 values matched.
- `tests/boss.test.mjs` (4): the boss database's shape, spot values and tempo classes; the defense
  curve; per-type defense and negation; and talisman multipliers and a grease's flat attack in
  one hit.
- `tests/attacks.test.mjs` (7): the moveset file's shape and spot values (the Uchigatana's R1
  chain with its frames and stamina, its thrusting one-handed R2, the two-hit Serpentbone Blade
  R2, weapon-specific values); attack families with the wind-up and airtime estimates, the
  finisher and untimed attacks left out; stamina by Endurance against the wiki's values; and
  talisman data and effects.
- `tests/fight.test.mjs` (14): fights with every opening and gap the same length, so each kill
  time can be worked out by hand and is matched exactly:
  - gaps, openings and strings, and openings too short to use;
  - the stamina limit;
  - the bleed ladder: against the Dancing Lion, bleed alone procs on hits 3, 7, 11, 18, 29, 40
    and every 11 hits after, three times slower than if the threshold stayed at 293;
  - frostbite's 20%, frost building up again after it, and a fire hit thawing it;
  - poison ticking without a break;
  - immunities;
  - Lord of Blood's Exultation and the successive-attack stages, hit by hit;
  - the choice of attacks with and without buildup.

  It also checks that the random fights are reproducible and the same for everything compared,
  that they average out to the boss's tempo, and that rankInfusions keeps the faster grip, picks
  the right grease and shares out first kills. Blood beats Keen only against a boss that can
  bleed.
- `tests/icons.test.mjs` (2): every weapon and talisman has a cell of its own inside the sprite,
  whose size matches the index; and spot checks that icons come from the item's own page (an
  infobox written on one line, and the Beast Claw weapon rather than the disambiguation page).
- The page was checked in a browser at desktop, tablet and phone widths, in light and dark
  themes, with and without a boss and with talismans, with no console errors. Re-ranking every
  infusion against a boss takes 12–84 ms; opening the full weapon list with its 488 icons takes
  about 20 ms.

## Files

| Path | What it is |
| --- | --- |
| `src/engine.js` | The AR math (`calculate`). Loads as `window.ArEngine` in a page or with `require` in Node |
| `src/engine.js` (boss part) | `hitDamage`: one hit against a boss's defense and negation |
| `src/engine.js` (fight part) | `attackFamilies`, `staminaFor`, `talismanEffects`, `createFights`, `prepareFighter`, `simulate` and `rankInfusions`: the fight model behind DPS |
| `src/app.js` | Page logic: weapon search, the four inputs, results table and breakdowns |
| `src/page.html`, `src/styles.css` | Page template and styles |
| `scripts/build-db.mjs` | Builds `data/weapons.json` from the regulation export |
| `scripts/build-bosses.mjs` | Builds `data/bosses.json` from the boss transcription and the tempo classes |
| `scripts/build-attacks.mjs` | Builds `data/attacks.json` from the motion value sheet and the frame data |
| `scripts/build-icons.py` | Fetches the weapon and talisman icons and packs them into `data/icons.webp` |
| `scripts/build-page.mjs` | Bundles everything into `dist/` |
| `data/weapons.json` | The weapon database |
| `data/bosses.json` | The boss database |
| `data/attacks.json` | The moveset data |
| `data/talismans.json` | The talismans the calculator counts |
| `data/icons.webp`, `data/icons.json` | The icon sprite and which cell holds which item |
| `data/source/` | Upstream regulation export and its MIT license, the boss transcription, the tempo classes, the motion value sheet and the trimmed frame data |
| `tests/engine.test.mjs` | AR tests |
| `tests/boss.test.mjs` | Boss data and hit damage tests |
| `tests/attacks.test.mjs` | Moveset, stamina and talisman tests |
| `tests/fight.test.mjs` | Fight model tests |
| `tests/icons.test.mjs` | Icon sprite tests |

## Credits

Game data © FromSoftware. Weapon data extraction and format by Tom Clark, used under the MIT
license (`data/source/LICENSE-upstream.txt`). Boss numbers from the Elden Ring Wiki on Fextralife,
extracted from the game by nex3's BossDataExtractor. Talisman effects from the Elden Ring Wiki
and Eldenpedia. Weapon and talisman icons are FromSoftware's artwork, taken from the item
pages of Eldenpedia (eldenring.wiki.gg). Motion values from the community Elden Ring Motion Values and Attack Data sheet;
attack timing, stamina costs and damage types from AtomechLLC's game-animation-library frame
data, which follows sovietspaceship's Elden Ring Frame Data Explorer. Neither of those two
sources states a license, so they're credited here and in the page footer. A fan-made tool, not
affiliated with FromSoftware or Bandai Namco.

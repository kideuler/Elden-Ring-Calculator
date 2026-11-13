# Elden Ring Infusion Calculator

Enter your weapon (with its upgrade level), your attributes, your talismans and, optionally, a
boss (with your Scadutree Blessing for a Shadow of the Erdtree boss) and a second weapon for the
left hand. The page shows the attack rating (AR) of every
infusion side by side: Standard, Heavy, Keen, Quality, Fire, Flame Art, Lightning, Sacred,
Magic, Cold, Poison, Blood and Occult. It covers all 488 weapons in patch 1.17 (Shadow of the
Erdtree included), with status buildup and staff/seal spell scaling.

Pick a boss and the infusions are ranked by how fast they kill it instead, over 300 simulated
fights. The boss's defense, damage negation, rising status resistance and how much room it
leaves to attack are all counted, and so are your stamina, your talismans and, in Shadow of the
Erdtree, your Scadutree Blessing. The calculator works
out the rest itself: which grip to use, whether powerstancing with the left-hand weapon beats it
and that weapon's best infusion, which attacks to throw in each opening, and how long the fight
takes, with a range. The infusion with the highest AR often isn't the winner.

Or let it search: with a boss picked, one button fights every weapon against it with your
attributes and talismans, pairs weapons of a type to powerstance, and lists the 10 that kill it
fastest. Each comes with its best infusion and grip, or with the partner it powerstances with.

## Use it

Open `dist/elden-ring-infusion-calculator.html` in a browser. It is a single file (about 2 MB)
with all the data and icons embedded, so it works offline and can be hosted anywhere. Only the
two web fonts come from Google Fonts, and system fonts stand in without them.

Weapons and talismans show their in-game icons: in the weapon box and its list, the Left hand
box, each talisman slot (an empty slot shows a dashed ring), beside the winning infusion's name
and in the search's list, where a partner's icon sits on the corner of its right-hand weapon's.

- **Weapon**: type part of a name, a weapon type ("katana") or "dlc", then pick with the arrow
  keys and Enter. Clear the box to browse every weapon by type.
- **Upgrade level**: one slider for regular (+25) and somber (+10) weapons. Switching weapons
  carries the level across the way the game's smithing tables line up (+25 ↔ +10).
- **Left hand** (optional): a second weapon to powerstance with. Powerstance attacks need a
  weapon of the same type in each hand, so the list holds only weapons of the right-hand weapon's
  type that can powerstance, the weapon itself first (holding two of it needs two copies). The
  left weapon takes the matching upgrade level, and you don't pick its infusion: the calculator
  finds the one that kills fastest beside each right-hand infusion, and the note under the box
  names the winner's. A warning appears there if your attributes miss the left weapon's
  requirements.
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
- **Scadutree Blessing**: shown under a Shadow of the Erdtree boss. Set your level, 0 to 20. It
  multiplies the attack of every hit, ×1.65 at 10 and ×2.05 at 20, while status buildup and proc
  damage stay the same (see [One hit](#one-hit)). As in the game, it counts only in the Land of
  Shadow, so base-game bosses ignore it.

Without a boss, the page shows the best infusion by AR and its damage split, then a table of every
infusion with AR, damage per type, AR two-handed, status buildup and scaling letters. With a boss
it shows the fastest-killing infusion with its DPS. Below that it says which grip it uses
(one-handed, two-handed or powerstanced, with the left hand's infusion), what it usually does
with an opening, the average kill time and the range 8 of 10 fights fall in. It also gives the
lead over the runner-up and how often each infusion was the first to kill. With a left-hand
weapon it says how much powerstancing gains over the best without it, or how much it loses. The
table shows every infusion's DPS, grip, kill time, status procs (from both hands' buildup when
powerstanced) and, for the four physical infusions, DPS with their best grease.

Select a row for the breakdown: base damage plus each attribute's bonus, and the same for the
left-hand weapon when that infusion powerstances. With a boss it also shows DPS in each grip, the
attack strings it plays and how often, one hit against the boss's defense and negation (from the
hand that lands it), and the status procs. Last comes the weapon's moveset, with motion values,
damage type, timing and stamina cost of each attack, and, when it powerstances, the powerstance
attacks with the hand that lands each hit. Inputs are remembered in the browser.

With a boss picked, the **Best weapons** panel searches every weapon. It runs only when you press
its button. It fights each of the 418 weapons with moveset data in every infusion it takes and
both grips, and powerstanced with the best partners of its type, using your attributes,
talismans, upgrade level (somber weapons at the matching +10 level) and, against a Shadow of the
Erdtree boss, Scadutree Blessing. Then it lists the 10
that kill the boss fastest. Each row gives the weapon, with its partner when powerstancing wins,
the best infusions and grip, the kill time with its range, and the DPS. It also notes a grease
that would do better and any requirement you don't meet. Select a row to load that weapon, and
its partner into the left hand. A pair of the same weapon needs two copies of it. A search takes
from about a second to over ten, depending on how long the boss takes to kill, and you can stop
it. The list stays until the next search, and is marked out of date if you change your
attributes, talismans, upgrade level or Blessing.

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
The only inputs are the ones above; everything else comes from game data, is worked out by the
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
moveset), uncharged heavies, charged heavies, jump R1s and jump R2s. Powerstanced, two more join
them: the L1 chain and jump L1s (see [Powerstance](#powerstance)). In one opening you play the
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
can't start until the previous one's dodge frame. Running, rolling and backstep attacks (R1 and
L1) and guard counters need a setup first, so they are listed but not planned.

### One hit

For each damage type of a hit:

```
attack = (AR + grease) × motion value / 100 × talisman multipliers × Scadutree Blessing
dealt  = attack × defenseMultiplier(attack / defense) × (1 − negation)
```

The defense multiplier lets 10% through at 1/8 of defense or less, 40% at equal values, 70% at
2.5× and 90% at 8× or more, with quadratic curves in between. Negation removes its percentage;
physical damage uses the negation of the hit's own physical type (standard, slash, strike or
pierce, from the game data: the one-handed katana R2 is a thrust, for example). Damage split
across two types, or put into a type the boss resists, deals less than its AR suggests, and an
attack multiplier is worth more than its percentage.

The Scadutree Blessing counts only against Shadow of the Erdtree bosses, since it has no effect
outside the Land of Shadow. It multiplies attack by 1.10 at level 1, 1.65 at 10, 1.92 at 15 and
2.05 at 20: the values since patch 1.12.2, from the wiki's
[table](https://eldenring.wiki.fextralife.com/About_the_Scadutree_Blessing). FromSoftware's patch
notes call it attack, so it applies before defense, as attack talismans do. Status buildup and
proc damage stay the same, since bleed and frost procs are a share of the boss's HP. So the
higher your Blessing, the more hit damage counts against status buildup.

Take Jori, Elder Inquisitor, with Bandit's and Scavenger's Curved Swords powerstanced at 19 STR
and 21 DEX. At 10 Faith, Blood with a Cold left hand wins at every Blessing level, but Flame Art
in both hands goes from 23% less DPS at Blessing 0 to 13% less at 20. At 50 Faith, Flame Art with
a Cold left hand is level with Blood at Blessing 0, and Flame Art in both hands is 14% ahead at 20.

### Status procs

Each hit adds the full buildup of the weapon that lands it (powerstanced, the weapon in that
hand), whatever its motion value. When a meter reaches the boss's resistance it procs, empties,
and the next proc needs the next (higher) threshold from the boss's list; past its end, the last
value:

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
  8 for an R1, L1, jump R1 or jump L1, 10 for an R2 or jump R2, 14 for a charged heavy, at most
  60. Holding 17, 30 or 45 points gives the first, second or third bonus. Points drain one at a
  time while you aren't hitting, every 0.5, 1, 0.7 or 0.4 s depending on how many you hold. The
  wiki lists those four intervals without saying which range each belongs to, so they are read
  in threshold order (an assumption). Millicent's and the Rotten insignia are assumed to work
  like the Winged Sword Insignia, whose page documents the mechanics.
- **Lord of Blood's Exultation, Kindred of Rot's Exultation, St. Trina's Smile and Aged One's
  Exultation** switch on for 20 or 30 seconds after their status procs.
- **Ritual Sword Talisman and Red-Feathered Branchsword** depend on your HP, which the calculator
  can't know: they count for half and a tenth of the fight.

### Powerstance

With a weapon of the same type in each hand, L1 swings both. The moveset data has every weapon's
powerstance attacks (the L1 chain, running, rolling, backstep and jump L1) and, for each hit, the
hand that lands it: the Scimitar's first L1 is two 92 motion value slashes, left then right, and
its jump L1 lands four hits, right, left, right, left. Powerstanced, a weapon fights with its
one-handed attacks plus the L1 chain and jump L1s:

- Each hit uses its own hand's weapon: that weapon's attack rating and status buildup, and its
  motion value for the same attack. Timing, damage type and stamina cost come from the
  right-hand weapon's attack. Where the two weapons' attacks have a different number of hits,
  the right-hand weapon's motion values stand for both.
- Both weapons are held in one hand, so neither gets the two-handing Strength bonus. Grease goes
  on the right-hand weapon only.
- Talismans count L1s as they count R1s: jump L1s are jump attacks for the Claw Talisman, each L1
  adds 8 points to the successive-attack talismans, and the last L1 of the chain is its finishing
  hit for the Twinblade Talisman.
- Each infusion of the right-hand weapon fights one-handed, two-handed and powerstanced, and
  keeps the fastest. Powerstanced, the left weapon's infusion is the one that kills fastest beside
  it: every infusion of the left weapon fights the first 24 fights, and the closest two fight all
  300. Checked against fighting every one of them over every fight, this pick was the best in
  99.4% of 158,000 cases, and 6.2% slower at worst (see
  [Searching every weapon](#searching-every-weapon)).
- Only weapons of the same type powerstance, so the Left hand box lists only those. A left-hand
  weapon of another type isn't modeled.

Paired weapons (fists, claws, backhand blades, beast claws, hand-to-hand arts and a few others)
come as a pair. Held in both hands they swing both of the pair, which the page calls **Paired**:
the two-handed moveset plus the powerstance attacks with the same weapon in each hand, without
the Strength bonus. Another paired weapon of the type in the left hand powerstances with it like
any other pair.

Two weapons with different statuses build both up, each with its own hand's hits. Fire and cold
build on each other in the model: a fire hit ends frostbite (see [Status procs](#status-procs)),
so frost can build up again straight away. Against a boss with a lot of HP, hits that deal fire
alongside hits that build up frost proc frost far more often than frost alone. That works with
one weapon that does both (Fire Knight's Shortsword keeps 19 fire when infused with Cold) and
with a fire weapon and a cold one in the two hands. Against Rykard, Fire Knight's Shortsword
(Cold or Blood) with a cold dagger in the left hand tops the search for each of the four builds
in [Searching every weapon](#searching-every-weapon), at about 900 DPS. Whether the game lets
frost build up again that soon after a fire hit hasn't been checked in game.

### Grip, grease and the score

- Each infusion fights one-handed and two-handed (bows only two-handed) and, with a left-hand
  weapon, powerstanced, and keeps the fastest.
- The four physical infusions (Standard, Heavy, Keen, Quality) of an infusable weapon also fight
  with their best grease: +85 attack of fire, lightning, magic or holy. The best one is whichever
  adds the most to a 100 motion value hit against this boss. Greases last 60 seconds in game but
  are assumed to stay on all fight. The grease result is shown beside the infusion, not ranked.
- A fight ends on the killing hit, or the moment poison or rot finishes the boss. A weapon that
  can't kill within 4,000 openings counts as unable to.
- DPS is HP ÷ the mean kill time. The page also gives the 10th to 90th percentile of kill times,
  the median number of openings, and each infusion's share of fights won. Infusions that kill at
  the same moment share that fight: against a boss that bleeds or freezes, several often kill on
  the same proc. Equal kill times are ranked by AR.

### Searching every weapon

The search fights each weapon the way the page fights one. Doing that for all 418 weapons over
all 300 fights takes too long (up to 41 seconds), and every pair of weapons of a type far longer,
so it goes in three stages:

1. **Screen**: every weapon, in every infusion and grip, over the first 24 of the boss's 300
   fights, without greases.
2. **Pairs**: within each type that can powerstance, over the same 24 fights. Each one-handed
   infusion from the screen is a hand. The most promising hands are paired every way round, a
   weapon with itself too: the 5 fastest one-handed, the 5 whose single hit is worth most against
   this boss (damage, plus status buildup valued at what a proc deals), and the one worth most
   for each status. The 3 that made the best pairs as the left hand then partner every other hand
   of the type. That makes 7,700–9,100 pairs, depending on the boss and build.
3. **Final**: the 30 fastest, alone or as the right hand of a pair, over all 300 fights and with
   greases, exactly as the page fights them: alone, and with the partner of their best pair in
   the left hand, finding both hands' infusions afresh. They are sorted by mean kill time, then
   AR, and the first 10 are listed, one row per weapon.

Every weapon meets the same fights, because each fight draws from its own random stream seeded
from the boss. The first 24 are the same fights whatever the size of the set, so the screen and
the pairs compare like with like.

The page runs the search in slices of about 30 ms and lets clicks and painting in between them,
so it shows its progress and can be stopped. In the final stage it can pause between one
infusion and the next, and before an infusion's powerstance fights, because a single weapon over
every fight can take half a second against a boss with a lot of HP.

On 2026-11-12, before pairs were added, the search was checked against fighting all 418 weapons
over all 300 fights. The check covered 14 bosses and 4 builds:

- DEX, with no talismans;
- quality, with four talismans;
- strength, with three;
- faith, with one.

The top 10 matched exactly (weapon, infusion, grip and order) in all 56 cases. The search took
0.3–7.4 seconds in Node, against 1.5–41 for the exhaustive one. With pairs, the same 56 cases
take 1.1–13 seconds (median 5.4; Margit about 1.7, Malenia 7, Rykard 8, Promised Consort Radahn
12). A powerstanced pair tops 16 of the 56 lists. These checks, and the pair checks below,
came before the Scadutree Blessing input, so their Shadow of the Erdtree bosses (Promised Consort
Radahn, the Dancing Lion at the Ancient Ruins of Rauh) were fought at Blessing 0. A higher
Blessing shortens those fights, and the search with them.

The pairs were checked on 2026-11-12 against brute force within one type at a time: every weapon
alone, and with every weapon of its type in the left hand, in every infusion of both, over 100
fights. That covered 84 cases: 7 types (daggers, straight swords, curved swords, katanas,
spears, fists and claws), 3 bosses (Margit, Malenia and the Dancing Lion at the Ancient Ruins of
Rauh) and 4 builds (DEX, quality, strength and arcane, with 60 Arcane and no talismans).

- The search's fastest weapon was the brute force's in 78 cases. In the other 6 it was a tie or
  within 1.3% of it, and the top 3 were the same in 74 cases.
- 1,181 of the 1,296 weapons came out exactly as in the brute force. The other 115 were up to
  7.7% slower, and more than 5% slower in 3 cases. Those weapons do better with another partner
  than the one the pair stage found: it tries most weapons with only 3 left hands, each in one
  infusion. Trying 5 left hands, or the two best partners in the final stage, didn't remove the
  largest misses and made the search 10–45% slower.
- The left hand's infusion, picked from 24 fights and then the closest two, was the best one in
  157,060 of 157,968 checks (every right-hand infusion with every left weapon), and 6.2% slower
  at worst.

Leaving out the weapons without moveset data (listed under Limits) is deliberate. Their stand-in
of one plain hit a second can't be fairly compared with a real moveset.

Stance breaks and ripostes aren't modeled, and they reward heavy hits. So quick weapons such as
daggers, twinblades, claws and axes fill most top-10 lists, and slow heavy weapons place lower
than they would in the game.

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
  skills, spells, spirit ashes and a left-hand weapon of another type aren't modeled. Neither are
  projectiles or shockwaves that some attacks add (Wing of Astel, Golem Fist).
- Powerstanced, the timing, damage type and stamina cost of every hit come from the right-hand
  weapon's animations, and a left-hand weapon whose attack has a different number of hits swings
  with the right-hand weapon's values. For 4% of powerstance attacks the hand of each hit is a
  guess: the hits alternate between the hands (see [Moveset data](#moveset-data)).
- A fire hit ends frostbite and lets frost build up again at once. That hasn't been checked in
  game, and it makes fire damage together with frost buildup, from one weapon or from the two
  hands, very strong against bosses with a lot of HP (see [Powerstance](#powerstance)).
- Status buildup doesn't drain between hits. A boss's resistance stays raised after each proc
  for the rest of the fight, though the game's parameter notes call that rise temporary. No
  rates are published for either. Drain hurts status most against bosses with long waits
  between openings.
- The Scadutree Blessing's multipliers come from the wiki's table, not the game files. That it
  leaves status buildup and proc damage alone is assumed, since the wiki lists only damage dealt
  and taken.
- Staffs, seals, bows, crossbows, ballistae, perfume bottles, the Smithscript Dagger and Unarmed
  (70 weapons) have no moveset data. They fall back to one 100 motion value hit per second of
  opening, and the weapon search leaves them out.
- 97 of the 5,200 attack entries (one of them a powerstance attack) have no timing in the frame
  data, and a family with one of them can't be planned. 99 have no stamina cost and count as free.

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

`dlc` marks a Shadow of the Erdtree boss, the only kind the Scadutree Blessing counts against.

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
  Trimmed to the one-handed, two-handed and powerstance attacks used here: each attack's physical
  damage type, its stamina cost, and two frames at 30 fps: the one from which the next attack can
  start, and the one from which you can dodge. Powerstance attacks also have the hand that lands
  each hit, from the library's hitbox files for each weapon class.

Motion values come from the sheet because it has every hit of multi-hit attacks and the weapons
whose attacks differ from the rest of their class (Alabaster Lord's Sword, Bloodhound's Fang); the
frame data records only the first hit, keyed by animation. Where both have a single-hit value
they agree on 11,828 of 11,980 (99%). The sheet fills the attacks the frame data has no motion
value for (the Greatsword's two-handed R1s, for example), and the frame data fills 29 the sheet
leaves blank.

424 weapons have a moveset (136 distinct ones), and 334 of them powerstance attacks. The file is
`{ meta, movesets, weapons }`: `weapons` maps a weapon name to its index in `movesets`, and each
moveset has a `1h` and `2h` list of `[attack, [motion value per hit], physical type, next, dodge,
stamina]`, for example `["R1 1", [100], "slash", 17, 25, 12]`: the next attack can start after 17
frames, you can dodge after 25, and it costs 12 stamina. The last three are `null` when the frame
data doesn't cover that attack's animation (a few unique weapons). The attacks are R1 1–6, R2
1–2, Charged R2 1–2, Running R1/R2, Rolling R1, Backstep R1, Jumping R1/R2 and Guard Counter.

A `paired` list holds the powerstance attacks: L1 1–6, Running L1, Rolling L1, Backstep L1 and
Jumping L1, with a seventh element, the hand of each hit. `["L1 1", [92, 92], "slash", 26, 28,
12, "LR"]` is the Scimitar's first L1: the left blade hits, then the right. Their motion values
come from the sheet's powerstance columns. The hitbox files list a hit for each part of a swing
that can land, and some swings have several (a blade's base and its tip), so their list can be
longer than the sheet's hits. Then runs of one hand are merged ("LLRR" → "LR"), and failing that
the hits alternate between the hands, starting with the one that swings first. Of the 2,507
powerstance attacks of the 334 weapons, 2,193 have their hands as listed, 208 merged and 106
alternated.

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

`npm test` runs the engine, boss, attack, fight, icon, search, powerstance and Blessing tests. `npm run build` bundles `src/` and the
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

To rebuild the moveset data, from `data/source/` or from fresh downloads: the frame data's
`elden-ring.json`, the motion value sheet's first tab as CSV, and a folder with the frame data's
hitbox files for each weapon class (`frame-data/models/elden-ring/moves/<class>.json`, such as
`curved-sword.json`):

```bash
npm run build:attacks
```

```bash
node scripts/build-attacks.mjs --import path/to/elden-ring.json path/to/motion-values.csv path/to/moves
```

To fetch the icons again, after adding weapons or talismans or to pick up the wiki's changes.
It makes about 25 requests to the wiki's API, then downloads the icons it doesn't have yet into a
cache folder (by default one in the system temp folder; pass `--cache DIR` to choose):

```bash
npm run build:icons
```

## Verification

`npm test` runs 56 tests.

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
- `tests/attacks.test.mjs` (7): the moveset file's shape (powerstance attacks with a hand for
  every hit) and spot values (the Uchigatana's R1 chain with its frames and stamina, its
  thrusting one-handed R2, the two-hit Serpentbone Blade R2, weapon-specific values); attack
  families with the wind-up and airtime estimates, the
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
  the right grease and shares out first kills, ties included. Blood beats Keen only against a
  boss that can bleed.
- `tests/powerstance.test.mjs` (6): the Scimitar's L1 and jump L1 with the hand of each hit,
  and which weapons can powerstance (both curved swords of a Scavenger's and Bandit's pair; no
  bows or staffs); the left weapon's motion values on left-hand hits; each hit dealing its own
  hand's damage and adding its own hand's buildup, in fights worked out by hand; the left
  infusion rankInfusions picks against fighting every one of them over every fight; and a paired
  weapon in both hands, without the Strength bonus.
- `tests/blessing.test.mjs` (4): the Blessing's table, counted only against Shadow of the Erdtree
  bosses; a hit's attack multiplied before defense (an Uchigatana R1 against Jori matches
  hitDamage at ×1.65), with buildup and proc damage unchanged; rankInfusions killing Jori sooner
  in every infusion, with hits taking a bigger share of the damage, and fighting Margit exactly
  the same at Blessing 20 as at 0; and the search fighting with the Blessing as the page does.
- `tests/icons.test.mjs` (2): every weapon and talisman has a cell of its own inside the sprite,
  whose size matches the index; and spot checks that icons come from the item's own page (an
  infobox written on one line, and the Beast Claw weapon rather than the disambiguation page).
- `tests/search.test.mjs` (5):
  - the tie-break that picks a weapon's best row;
  - the stepped ranking, which ends where rankInfusions does;
  - with a shortlist as long as the list, the search returns exactly what fighting each weapon
    on its own and sorting does, leaving out weapons without moveset data and fighting greases
    in the final stage;
  - with a short shortlist, every result comes from the screen's fastest, and the screen's
    fights are the first fights of the full set;
  - with pairs, the stages come in order, each powerstanced result is what the page shows for
    the same two weapons, and no result is slower than the search without pairs.
- The search was also compared with an exhaustive one in 56 cases, all the same, and its pairs
  with brute force in 84 cases; see [Searching every weapon](#searching-every-weapon).
- The page was checked in a browser at desktop, tablet and phone widths, in light and dark
  themes, with and without a boss and with talismans, with no console errors. The Left hand box,
  powerstanced results and the search's pairs were checked at desktop and phone widths.
  Re-ranking every infusion against a boss takes 11–91 ms, and 28–205 ms with a left-hand weapon
  (Margit to Promised Consort Radahn). After a change to an attribute or the upgrade level the
  page waits 70 ms for the next one before it re-ranks. Opening the full weapon list with its
  488 icons takes about 20 ms.
  Searching every weapon took 1.5 s against Margit, 6.7 s against Malenia, 8.2 s against Rykard
  and 11.6 s against Promised Consort Radahn, as in Node, with no main-thread task during the
  search over 60 ms. Some runs in a hidden browser pane took up to five times as long.
  The Scadutree Blessing slider was checked at desktop and phone widths. It shows only under a
  Shadow of the Erdtree boss, re-ranks when moved, and is remembered. A finished search is
  marked out of date when it changes. Against Jori, Elder Inquisitor, the page matches Node (391
  DPS for Bandit's Blood Curved Sword with a Cold Scavenger's at Blessing 10, 452 at 20). The
  search takes 3.5 s in Node at Blessing 10 and 5.6 s at 0.

## Files

| Path | What it is |
| --- | --- |
| `src/engine.js` | The AR math (`calculate`). Loads as `window.ArEngine` in a page or with `require` in Node |
| `src/engine.js` (boss part) | `hitDamage`: one hit against a boss's defense and negation. `blessingMultiplier`: the Scadutree Blessing's attack multiplier |
| `src/engine.js` (fight part) | `attackFamilies`, `pairedAttacks`, `weaponFamilies`, `canPowerstance`, `staminaFor`, `talismanEffects`, `createFights`, `prepareFighter`, `simulate`, `rankInfusions` (and `rankInfusionsInSteps`) and `fastestRow`: the fight model behind DPS, powerstance included. `searchWeapons`: the search over every weapon and pair |
| `src/app.js` | Page logic: the weapon picker, the other inputs (the Left hand box and Scadutree Blessing included), results table, breakdowns and the best-weapons search |
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
| `tests/search.test.mjs` | Weapon search tests |
| `tests/powerstance.test.mjs` | Powerstance tests |
| `tests/blessing.test.mjs` | Scadutree Blessing tests |

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

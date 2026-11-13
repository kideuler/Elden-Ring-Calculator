// Run with: node --test tests/fight.test.mjs
// The fight model: random fights, the attacks played in each opening, status procs, talismans.
// Most tests use steady fights (every gap and opening the same length) so each expected kill
// time can be worked out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const load = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const weaponDb = load("weapons.json");
const bossDb = load("bosses.json");
const attackDb = load("attacks.json");
const talismanDb = load("talismans.json");
const model = Engine.createModel(weaponDb);
const bossById = new Map(bossDb.bosses.map((b) => [b.id, b]));
const talisman = new Map(talismanDb.talismans.map((t) => [t.name, t]));

const near = (actual, expected, tolerance = 1e-9, message = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);

/** A stand-in for calculate() output with chosen AR and buildup per hit. */
function fakeResult(damage, status = {}) {
  const wrap = (values) => Object.fromEntries(Object.entries(values).map(([t, total]) => [t, { total }]));
  return { damage: wrap(damage), status: wrap(status) };
}

/** A boss with round numbers: 10,000 HP, 100 defense, no negation, immune to every status. */
function fakeBoss({ hp = 10000, status = {}, statusDamage = 0.7 } = {}) {
  const types = (list, value) => Object.fromEntries(list.map((t) => [t, value]));
  return {
    hp,
    defense: types(["physical", "magic", "fire", "lightning", "holy"], 100),
    negation: types(["standard", "slash", "strike", "pierce", "magic", "fire", "lightning", "holy"], 0),
    status: { ...types(["poison", "rot", "bleed", "frost", "sleep", "madness"], null), ...status },
    statusDamage,
  };
}

/**
 * One steady fight: the boss attacks for `gap` seconds, then leaves `opening` seconds, again and
 * again. The default attack is one 100 motion value hit a second, so with the default 1 s
 * opening and 2 s gap one hit lands every 3 seconds, at t = 3, 6, 9, ...
 */
function fight(result, boss, { opening = 1, gap = 2, families = Engine.basicFamily("standard"), stamina, effects, bonus } = {}) {
  const tempo = { opening, gap, shape: Infinity };
  const fighter = Engine.prepareFighter({ result, boss, families, grip: "1h", stamina, effects, bonus, tempo });
  return Engine.simulate(fighter, Engine.createFights(tempo, { count: 1 }));
}

/** An R1 chain that repeats every half second: [chain frames, dodge frames, stamina]. */
const chain = (next, exit, stamina) =>
  Engine.attackFamilies([
    ["R1 1", [100], "slash", next, exit, stamina],
    ["R1 2", [100], "slash", next, exit, stamina],
  ]);

const effectsOf = (...names) => Engine.talismanEffects(names.map((n) => talisman.get(n)));

function realResult(weaponName, affinityName, stats) {
  const weapon = model.byName.get(weaponName);
  const affinityId = [...model.affinityNames].find(([, n]) => n === affinityName)[0];
  const infusion = weapon.infusions.find((i) => i.affinity === affinityId);
  return Engine.calculate(model, weapon, infusion, { stats, level: 25, twoHanded: false });
}

test("a fight is a run of gaps and openings, and ends on the killing hit", () => {
  // 800 attack is 8x defense: 90% gets through, 720 a hit, so 14 hits; the 14th lands at 42 s
  const sim = fight(fakeResult({ physical: 800 }), fakeBoss());
  assert.equal(sim.hits, 14);
  assert.equal(sim.openingsToKill, 14);
  near(sim.seconds, 42);
  near(sim.dps, 10000 / 42);
  assert.deepEqual([sim.p10, sim.median, sim.p90], [42, 42, 42]);
  near(sim.sources.direct, 10000, 1e-6, "the last hit only counts the HP that was left");
  near(sim.direct.physical, 10000, 1e-6);
  assert.deepEqual(sim.procs, {});
  assert.equal(sim.idle, 0);
  assert.equal(sim.plan.length, 1);
  assert.deepEqual([sim.plan[0].attacks, sim.plan[0].share, sim.plan[0].seconds], [1, 1, 1]);
  near(sim.plan[0].damage, 720);

  // A 2.5 s opening fits two hits (at 1 s and 2 s); the rest of it passes unused. The 14th hit is
  // the second of the 7th opening, which starts at 2 + 6 x 4.5 = 29 s
  const longer = fight(fakeResult({ physical: 800 }), fakeBoss(), { opening: 2.5 });
  assert.equal(longer.plan[0].attacks, 2);
  near(longer.seconds, 31);
  assert.equal(longer.openingsToKill, 7);

  // An opening too short for the attack is lost
  const short = fight(fakeResult({ physical: 800 }), fakeBoss(), { opening: 0.9 });
  assert.equal(short.idle, 1);
  assert.equal(short.seconds, Infinity);
  assert.equal(short.dps, 0);
});

test("a string of attacks has to fit the opening and leave stamina to dodge with", () => {
  // Each attack: the next can start after 0.5 s, a dodge after 1 s, and it costs 30 stamina
  const families = chain(15, 30, 30);
  const result = fakeResult({ physical: 800 });
  const attacks = (options) => fight(result, fakeBoss(), { opening: 12, families, ...options }).plan[0].attacks;
  assert.equal(attacks({ stamina: 100 }), 3, "90 stamina spent, 10 left to dodge");
  assert.equal(attacks({ stamina: 90 }), 2, "a third attack would leave nothing");
  assert.equal(attacks({}), 16, "unlimited stamina: the cap of 16 attacks");
  // n attacks take 0.5 (n - 1) + 1 seconds
  assert.equal(attacks({ stamina: 1000, opening: 2.4 }), 3);
  assert.equal(attacks({ stamina: 1000, opening: 2.5 }), 4);
});

test("bleed procs need more buildup each time and deal a share of max HP", () => {
  // 100 buildup a hit against 300 / 400 / 700: procs on hits 3, 7, 14, then every 7 hits. Each
  // deals (15% x 10,000 + 100) x 70% = 1,120, so the ninth proc, on hit 56, kills
  const sim = fight(fakeResult({}, { bleed: 100 }), fakeBoss({ status: { bleed: [300, 400, 700] } }));
  assert.equal(sim.procs.bleed, 9);
  assert.equal(sim.hits, 56);
  near(sim.seconds, 3 * 56);
  near(sim.sources.bleed, 10000, 1e-6);
});

test("Divine Beast Dancing Lion's bleed resistance rises proc by proc", () => {
  const lion = bossById.get("divine-beast-dancing-lion-belurat-tower-settlement");
  assert.deepEqual(lion.status.bleed, [293, 335, 433, 723, 1180]);
  assert.equal(lion.hp, 22571);
  assert.equal(lion.statusDamage, 0.5);
  const blood = realResult("Uchigatana", "Blood", { str: 18, dex: 40, int: 9, fai: 10, arc: 45 });
  near(blood.status.bleed.total, 108.8, 0.05);

  // Bleed alone, one hit every 3 s: about 109 a hit takes 3, 4, 4, 7, then 11 hits for every
  // proc after that (procs on hits 3, 7, 11, 18, 29, 40, ...). A proc deals
  // (15% x 22,571 + 100) x 50% = 1,742.8, so the 13th, on hit 117, kills
  const bleedOnly = fakeResult({}, { bleed: blood.status.bleed.total });
  const ladder = fight(bleedOnly, lion);
  assert.equal(ladder.procs.bleed, 13);
  near(ladder.seconds, 3 * 117);
  // If the resistance stayed at 293, bleed would proc every 3 hits: three times as fast
  const flat = fight(bleedOnly, { ...lion, status: { ...lion.status, bleed: [293] } });
  near(flat.seconds, 3 * 39);
});

test("frostbite adds 20% to hits for 30 seconds, and a fire hit ends it", () => {
  // Hit 1 (t = 3): 720 + frost (10% x 10,000 + 30) x 70% = 721. Hits 2-10 (t = 6..30) land
  // during frostbite for 864. Hit 11 (t = 33) deals 720, frost builds up again, and its second
  // proc kills
  const frost = fight(fakeResult({ physical: 800 }, { frost: 100 }), fakeBoss({ status: { frost: [100] } }));
  assert.equal(frost.procs.frost, 2);
  assert.equal(frost.hits, 11);
  near(frost.seconds, 33);
  near(frost.sources.direct, 720 + 9 * 864 + 720, 1e-6);
  near(frost.sources.frost, 10000 - (720 + 9 * 864 + 720), 1e-6);

  // With a second proc out of reach: 12 hits without fire. A touch of fire damage (0.1 a hit)
  // thaws the boss on hit 2, so only that hit gets the 20%: 13 hits
  const boss = fakeBoss({ status: { frost: [100, 100000] } });
  near(fight(fakeResult({ physical: 800 }, { frost: 100 }), boss).seconds, 36);
  near(fight(fakeResult({ physical: 800, fire: 1 }, { frost: 100 }), boss).seconds, 39);
});

test("poison ticks between hits and can't build up while active", () => {
  // 1 physical attack deals 0.1 a hit; the first hit (t = 3) poisons for 90 s at
  // 0.07% x 10,000 + 7 = 14 HP a second. Poison can build up again on the hit at t = 93, so it
  // never stops; the 238 hits up to t = 714 add 23.8
  const sim = fight(fakeResult({ physical: 1 }, { poison: 1000 }), fakeBoss({ status: { poison: [100] } }));
  near(sim.seconds, 3 + (10000 - 23.8) / 14, 1e-6);
  assert.equal(sim.procs.poison, 8);
  near(sim.sources.poison, 10000 - 23.8, 1e-6);
});

test("statuses the boss is immune to add nothing", () => {
  const sim = fight(fakeResult({ physical: 800 }, { bleed: 80, frost: 60, sleep: 50 }), fakeBoss());
  assert.deepEqual(sim.immune, ["bleed", "frost", "sleep"]);
  assert.deepEqual(sim.procs, {});
  near(sim.seconds, 42);
});

test("Lord of Blood's Exultation boosts the hits within 20 seconds of a bleed proc", () => {
  // Every hit procs bleed (1,120). Hit 1 deals 720; boosted hits deal 960 x 90% = 864.
  // 720 + 1,120 + 5 x (864 + 1,120) >= 10,000: the 6th hit kills
  const boss = fakeBoss({ status: { bleed: [100] } });
  const result = fakeResult({ physical: 800 }, { bleed: 100 });
  const effects = effectsOf("Lord of Blood's Exultation");
  const sim = fight(result, boss, { effects });
  assert.equal(sim.hits, 6);
  near(sim.seconds, 18);
  assert.equal(sim.boosts.length, 1);
  assert.equal(sim.boosts[0].name, "Lord of Blood's Exultation");
  near(sim.boosts[0].share, 5 / 6);
  // Hits 26 s apart: the boost has always worn off
  const apart = fight(result, boss, { effects, gap: 25 });
  assert.equal(apart.boosts[0].share, 0);
  near(apart.seconds, 26 * 6);
});

test("successive-attack talismans build with quick hits and fade between them", () => {
  // Sixteen R1s half a second apart in one 12 s opening. Each adds 8 points and below 30 points
  // one drains every 0.5 s, so the points before each hit run 0, 7, 14, 21, 28, 36, 44, 52, 60,
  // 59, ...: stage 1 from the 4th hit, stage 2 from the 6th, stage 3 from the 8th.
  // With the Rotten Winged Sword Insignia those hits deal 720 x 3, 763.2 x 2, 777.6 x 2 and
  // 813.6 x 9 = 12,564, so a 12,000 HP boss falls to the 16th hit, 8 s into the opening
  const effects = effectsOf("Rotten Winged Sword Insignia");
  const families = chain(15, 15, null);
  const sim = fight(fakeResult({ physical: 800 }), fakeBoss({ hp: 12000 }), { opening: 12, families, effects });
  assert.equal(sim.hits, 16);
  near(sim.seconds, 2 + 8);
  assert.equal(sim.boosts[0].name, "Successive attacks");
  near(sim.boosts[0].share, 13 / 16);
  near(sim.boosts[0].top, 9 / 16);
  // One hit every 31 s: 8 points drain away in 4 s, so the bonus never starts
  const slow = fight(fakeResult({ physical: 800 }), fakeBoss(), { effects, gap: 30 });
  assert.equal(slow.boosts[0].share, 0);
});

test("attacks are chosen by damage plus the buildup they add toward the next proc", () => {
  // A 3 s opening fits two R1s (100 MV, the second starting after 1 s, dodge 2 s later) or one
  // charged R2 (180 MV). At 400 attack against 100 defense, 2 x 317.7 = 635 loses to 645
  // because a bigger hit gets more of its attack past defense
  const families = Engine.attackFamilies([
    ["R1 1", [100], "slash", 30, 60, 10],
    ["Charged R2 1", [180], "slash", 90, 90, 10],
  ]);
  const boss = fakeBoss({ status: { bleed: [200] } });
  const choose = (result) => fight(result, boss, { opening: 3, families }).plan[0];
  const plain = choose(fakeResult({ physical: 400 }));
  assert.equal(plain.label, "Charged R2");
  near(plain.damage, 720 * Engine.defenseMultiplier(720, 100));
  // Every hit adds the same buildup, so two hits bring the next bleed proc twice as close: each
  // is worth 1,120 x 100 / 200 = 560 more
  const bleeding = choose(fakeResult({ physical: 400 }, { bleed: 100 }));
  assert.deepEqual([bleeding.label, bleeding.attacks], ["R1", 2]);
});

test("random fights are reproducible, and the same for everything compared", () => {
  const tempo = { opening: 2, gap: 3, shape: 3, spread: 0.25 };
  const a = Engine.createFights(tempo, { count: 50, seed: 7 });
  const b = Engine.createFights(tempo, { count: 5, seed: 7 });
  const c = Engine.createFights(tempo, { count: 5, seed: 8 });
  for (const fights of [a, b, c]) fights.extend(3);
  assert.deepEqual(Array.from(a.gaps[3]), Array.from(b.gaps[3]), "a fight doesn't depend on how many are drawn");
  assert.deepEqual(Array.from(a.opens[3]), Array.from(b.opens[3]));
  assert.notDeepEqual(Array.from(a.gaps[3]), Array.from(c.gaps[3]), "another seed, other fights");

  const fighter = (physical) =>
    Engine.prepareFighter({ result: fakeResult({ physical }), boss: fakeBoss(), families: Engine.basicFamily("standard"), tempo });
  const first = Engine.simulate(fighter(800), a);
  const again = Engine.simulate(fighter(800), a);
  assert.deepEqual(Array.from(first.times), Array.from(again.times));
  // The same openings: more damage per hit kills faster in every single fight
  const stronger = Engine.simulate(fighter(900), a);
  assert.ok(Array.from(stronger.times).every((t, f) => t <= first.times[f]));
  assert.ok(first.p10 <= first.median && first.median <= first.p90);
  assert.ok(first.p10 < first.p90, "fights vary");
});

test("random openings and gaps average out to the boss's tempo", () => {
  const tempo = { opening: 2, gap: 3, shape: 3, spread: 0.25 };
  const fights = Engine.createFights(tempo, { count: 2000, seed: 1 });
  let open = 0;
  let gap = 0;
  let n = 0;
  for (let f = 0; f < fights.count; f++) {
    fights.extend(f);
    for (let j = 0; j < 32; j++) {
      open += fights.opens[f][j] / Engine.FPS;
      gap += fights.gaps[f][j];
      n++;
    }
  }
  // Openings are counted in whole frames, rounded down: about 1/60 s short on average
  near(open / n, tempo.opening - 1 / 60, 0.05);
  near(gap / n, tempo.gap, 0.08);
});

test("rankInfusions: each infusion in its faster grip, with its best grease", () => {
  const weapon = model.byName.get("Uchigatana");
  const boss = bossById.get("divine-beast-dancing-lion-belurat-tower-settlement");
  const { classes, shape, spread } = bossDb.meta.tempo;
  const tempo = { ...classes[boss.tempo], shape, spread };
  const options = {
    stats: { str: 18, dex: 40, int: 9, fai: 10, arc: 9, end: 25 },
    level: 25,
    boss,
    tempo,
    moveset: attackDb.movesets[attackDb.weapons["Uchigatana"]],
    physicalType: "slash",
    count: 60,
    seed: 3,
  };
  const ranked = Engine.rankInfusions(model, weapon, options);
  assert.equal(ranked.generic, false);
  assert.deepEqual(ranked.grips, ["1h", "2h"]);
  assert.equal(ranked.stamina, 121);
  assert.equal(ranked.rows.length, weapon.infusions.length);
  let first = 0;
  for (const row of ranked.rows) {
    const grips = Object.values(row.grips);
    assert.equal(grips.length, 2);
    assert.equal(row.sim, row.grips[row.grip].sim);
    assert.ok(grips.every((g) => row.sim.seconds <= g.sim.seconds), "the faster grip is kept");
    const planned = row.sim.plan.reduce((sum, p) => sum + p.share, 0) + row.sim.idle;
    near(planned, 1, 1e-9, "every opening is either played or too short");
    first += row.fastest;
    // Only the four physical infusions take a grease
    const physical = Engine.BUFFABLE_AFFINITIES.has(row.infusion.affinity);
    assert.equal(!!row.grease, physical);
    if (row.grease) assert.ok(row.grease.sim.dps > row.sim.dps, `${row.grease.name} helps`);
  }
  near(first, 1, 1e-9, "each fight has one fastest infusion");
  // Fire grease adds the most against a boss that negates fire least (0% against 40% for the rest)
  assert.ok(["magic", "lightning", "holy"].every((t) => boss.negation.fire < boss.negation[t]));
  assert.ok(ranked.rows.filter((r) => r.grease).every((r) => r.grease.name === "Fire Grease"));

  // Talismans: Radagon's Soreseal adds 5 Endurance (stamina), Strength and Dexterity
  const sealed = Engine.rankInfusions(model, weapon, { ...options, talismans: [talisman.get("Radagon's Soreseal")] });
  assert.equal(sealed.stamina, Engine.staminaFor(30));
  assert.deepEqual([sealed.stats.str, sealed.stats.dex], [23, 45]);

  // Paired weapons have one grip; weapons without moveset data get a basic hit
  const paired = Engine.rankInfusions(model, model.byName.get("Godskin Peeler"), { ...options, moveset: null, count: 5 });
  assert.equal(paired.generic, true);
  const peeler = model.byName.get("Godskin Peeler");
  assert.deepEqual(paired.grips, peeler.paired ? ["1h"] : ["1h", "2h"]);
});

test("blood beats keen against a bleed-prone boss but not a bleed-immune one", () => {
  const weapon = model.byName.get("Uchigatana");
  const stats = { str: 18, dex: 40, int: 9, fai: 10, arc: 45, end: 25 };
  const { classes, shape, spread } = bossDb.meta.tempo;
  const seconds = (bossId) => {
    const boss = bossById.get(bossId);
    const ranked = Engine.rankInfusions(model, weapon, {
      stats,
      level: 25,
      boss,
      tempo: { ...classes[boss.tempo], shape, spread },
      moveset: attackDb.movesets[attackDb.weapons["Uchigatana"]],
      physicalType: "slash",
      count: 100,
      seed: 1,
    });
    const of = (name) => ranked.rows.find((r) => model.affinityNames.get(r.infusion.affinity) === name).sim.seconds;
    return { blood: of("Blood"), keen: of("Keen") };
  };
  assert.equal(bossById.get("radagon-of-the-golden-order").status.bleed, null);
  const apostle = seconds("godskin-apostle-godskin-duo");
  assert.ok(apostle.blood < apostle.keen, `blood kills the Godskin Apostle faster (${apostle.blood} vs ${apostle.keen})`);
  const radagon = seconds("radagon-of-the-golden-order");
  assert.ok(radagon.keen < radagon.blood, `keen kills Radagon faster (${radagon.keen} vs ${radagon.blood})`);
});

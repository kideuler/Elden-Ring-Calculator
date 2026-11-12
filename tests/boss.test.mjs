// Run with: node --test tests/boss.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const weaponDb = JSON.parse(readFileSync(new URL("../data/weapons.json", import.meta.url), "utf8"));
const bossDb = JSON.parse(readFileSync(new URL("../data/bosses.json", import.meta.url), "utf8"));
const model = Engine.createModel(weaponDb);
const bossById = new Map(bossDb.bosses.map((b) => [b.id, b]));

const near = (actual, expected, tolerance = 1e-9, message = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);

/** A stand-in for calculate() output with chosen AR and buildup per hit. */
function fakeResult(damage, status = {}) {
  const wrap = (values) => Object.fromEntries(Object.entries(values).map(([t, total]) => [t, { total }]));
  return { damage: wrap(damage), status: wrap(status) };
}

/** A boss with round numbers: 10,000 HP, 100 defense, no negation, immune to every status. */
function fakeBoss({ hp = 10000, defense = 100, negation = {}, status = {}, statusDamage = 0.7 } = {}) {
  const types = (list, value) => Object.fromEntries(list.map((t) => [t, value]));
  return {
    hp,
    defense: types(["physical", "magic", "fire", "lightning", "holy"], defense),
    negation: { ...types(["standard", "slash", "strike", "pierce", "magic", "fire", "lightning", "holy"], 0), ...negation },
    status: { ...types(["poison", "rot", "bleed", "frost", "sleep", "madness"], null), ...status },
    statusDamage,
  };
}

function realResult(weaponName, affinityName, stats, level = 25) {
  const weapon = model.byName.get(weaponName);
  const affinityId = [...model.affinityNames].find(([, n]) => n === affinityName)[0];
  const infusion = weapon.infusions.find((i) => i.affinity === affinityId);
  return Engine.calculate(model, weapon, infusion, { stats, level, twoHanded: false });
}

test("boss database is well-formed", () => {
  const { bosses } = bossDb;
  assert.equal(bosses.length, bossDb.meta.bossCount);
  assert.ok(bosses.length >= 80);
  assert.equal(new Set(bosses.map((b) => b.id)).size, bosses.length, "ids are unique");
  for (const b of bosses) {
    assert.ok(b.hp > 0, `${b.label} hp`);
    for (const t of ["physical", "magic", "fire", "lightning", "holy"]) assert.ok(b.defense[t] >= 80, `${b.label} ${t} defense`);
    for (const t of Engine.PHYSICAL_TYPES.concat(["magic", "fire", "lightning", "holy"])) {
      assert.ok(b.negation[t] >= -100 && b.negation[t] < 100, `${b.label} ${t} negation`);
    }
    for (const t of ["poison", "rot", "bleed", "frost", "sleep", "madness"]) {
      const s = b.status[t];
      assert.ok(s === null || (Array.isArray(s) && s.length > 0), `${b.label} ${t} resistance`);
      if (s) for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1], `${b.label} ${t} resistance never drops`);
    }
    assert.ok([0.5, 0.65, 0.7].includes(b.statusDamage), `${b.label} status damage`);
  }

  const margit = bossById.get("margit-the-fell-omen-stormveil-castle");
  assert.equal(margit.hp, 4174);
  assert.equal(margit.defense.physical, 103);
  assert.equal(margit.negation.slash, -10);
  assert.equal(margit.negation.holy, 40);
  assert.deepEqual(margit.status.bleed, [316, 414, 704, 1161]);
  assert.equal(margit.status.sleep, null);
  assert.equal(bossById.get("mohg-lord-of-blood").statusDamage, 0.5);
  assert.equal(bossById.get("messmer-the-impaler").statusDamage, 0.65);
  assert.equal(bossById.get("commander-gaius").statusDamage, 0.5);
  assert.equal(bossById.get("rakshasa").defense.fire, 156, "armored bosses have a defense per type");
  assert.deepEqual(bossById.get("rakshasa").status.bleed, [780], "the wiki lists one value: it doesn't rise");
  assert.deepEqual(bossById.get("dragonlord-placidusax").status.bleed, [1349, 1806]);
});

test("defense multiplier follows the game's curve", () => {
  const m = (ratio) => Engine.defenseMultiplier(ratio * 100, 100);
  near(m(0.05), 0.1);
  near(m(0.125), 0.1);
  near(m(1), 0.4);
  near(m(2.5), 0.7);
  near(m(8), 0.9);
  near(m(20), 0.9);
  near(m(0.5), 0.1 + 0.3 * (0.375 / 0.875) ** 2);
  near(m(4), 0.9 - 0.2 * (4 / 5.5) ** 2);
  assert.equal(Engine.defenseMultiplier(0, 100), 0);
  let previous = 0;
  for (let r = 0.01; r < 10; r += 0.01) {
    const value = m(r);
    assert.ok(value >= previous - 1e-12, `rises with attack (${r.toFixed(2)})`);
    previous = value;
  }
});

test("each damage type meets its own defense and negation", () => {
  const boss = fakeBoss({ negation: { slash: -10, standard: 20, fire: 50 } });
  const hit = (damage, options) => Engine.hitDamage(fakeResult(damage), boss, options);
  const at3x = 300 * (0.9 - 0.2 * (5 / 5.5) ** 2);

  near(hit({ physical: 300 }, { physicalType: "slash" }).total, at3x * 1.1, 1e-9, "slash takes 10% extra");
  near(hit({ physical: 300 }, { physicalType: "standard" }).total, at3x * 0.8, 1e-9, "standard is 20% negated");
  near(hit({ fire: 300 }).total, at3x * 0.5, 1e-9, "fire is 50% negated");
  near(hit({ physical: 150 }, { motionValue: 200, physicalType: "strike" }).total, at3x, 1e-9, "motion value scales attack before defense");

  // The same AR split across two types loses damage to defense (here 16%)
  const plain = fakeBoss();
  const pure = Engine.hitDamage(fakeResult({ physical: 400 }), plain).total;
  const split = Engine.hitDamage(fakeResult({ physical: 200, magic: 200 }), plain).total;
  near(pure, 400 * (0.9 - 0.2 * (4 / 5.5) ** 2));
  near(split, 2 * 200 * (0.7 - 0.3 * (0.5 / 1.5) ** 2));
  assert.ok(split < pure * 0.9, `split ${split} vs pure ${pure}`);
});

test("a fight without status effects takes ceil(HP / damage) hits", () => {
  const boss = fakeBoss();
  const result = fakeResult({ physical: 800 }); // 8x defense: 90% gets through, 720 a hit
  const fight = Engine.fightBoss(result, boss, { secondsPerHit: 2 });
  near(fight.hit.total, 720);
  assert.equal(fight.hits, 14);
  near(fight.seconds, (2 * 10000) / 720, 1e-9, "only the needed part of the last swing counts");
  near(fight.dps, 360, 1e-9, "DPS is damage per hit / seconds per hit");
  assert.deepEqual(fight.procs, {});
});

test("bleed procs get harder each time and deal a share of max HP", () => {
  const boss = fakeBoss({ status: { bleed: [300, 400, 700] } });
  const fight = Engine.fightBoss(fakeResult({}, { bleed: 100 }), boss, { secondsPerHit: 2 });
  // Each proc deals (15% x 10,000 + 100) x 70% = 1,120; nine are needed.
  // Procs land on hits 3, 7, 14, then every 7 hits: 21, 28, 35, 42, 49, 56.
  assert.equal(fight.procs.bleed, 9);
  assert.deepEqual(fight.procHits.bleed, [3, 7, 14, 21, 28, 35, 42, 49, 56]);
  assert.equal(fight.hits, 56);
  near(fight.sources.bleed, 9 * 1120);
  // The ninth proc needed 1,040 of its 1,120 damage
  near(fight.seconds, 110 + (2 * 1040) / 1120, 1e-9);
});

test("each bleed proc needs the boss's next threshold (Divine Beast Dancing Lion)", () => {
  const lion = bossById.get("divine-beast-dancing-lion-belurat-tower-settlement");
  assert.deepEqual(lion.status.bleed, [293, 335, 433, 723, 1180]);
  const blood = realResult("Uchigatana", "Blood", { str: 18, dex: 40, int: 9, fai: 10, arc: 45 });
  near(blood.status.bleed.total, 108.8, 0.05);

  // About 109 buildup a hit: 293 takes 3 hits, 335 takes 4, 433 takes 4, 723 takes 7, then
  // 1,180 takes 11 for every proc after that
  const fight = Engine.fightBoss(blood, lion, { physicalType: "slash" });
  assert.deepEqual(fight.procHits.bleed, [3, 7, 11, 18, 29, 40]);
  assert.equal(fight.hits, 43);

  // If the threshold stayed at 293, bleed would proc every 3 hits and the fight would be far shorter
  const flat = Engine.fightBoss(blood, { ...lion, status: { ...lion.status, bleed: [293] } }, { physicalType: "slash" });
  assert.deepEqual(flat.procHits.bleed.slice(0, 5), [3, 6, 9, 12, 15]);
  assert.ok(flat.seconds < fight.seconds * 0.7, `${flat.seconds} vs ${fight.seconds}`);
});

test("frostbite adds 20% to the following 30 seconds of hits", () => {
  const boss = fakeBoss({ status: { frost: [100] } });
  const fight = Engine.fightBoss(fakeResult({ physical: 800 }, { frost: 100 }), boss, { secondsPerHit: 2 });
  // Hit 1: 720 + frost (10% x 10,000 + 30) x 70% = 721. The remaining 8,559 HP falls to
  // 864-damage hits (720 x 1.2), so 10 more hits: 11 in all instead of 14.
  assert.equal(fight.procs.frost, 1);
  near(fight.sources.frost, 721);
  assert.equal(fight.hits, 11);
  near(fight.seconds, 20 + (2 * 783) / 864, 1e-9, "783 HP is left for the last hit");
});

test("poison ticks between hits and can't build up while active", () => {
  const boss = fakeBoss({ status: { poison: [100] } });
  const fight = Engine.fightBoss(fakeResult({}, { poison: 1000 }), boss, { secondsPerHit: 2 });
  // Procs on the first hit (t = 2s) and again each time it wears off, so 14 HP/s
  // (0.07% x 10,000 + 7) flows without a gap.
  near(fight.seconds, 2 + 10000 / 14, 1e-6);
  assert.equal(fight.procs.poison, 8);
  near(fight.sources.poison, 10000, 1e-6);
});

test("statuses the boss is immune to add nothing", () => {
  const fight = Engine.fightBoss(fakeResult({ physical: 800 }, { bleed: 80, frost: 60 }), fakeBoss(), {});
  assert.deepEqual(fight.immune.sort(), ["bleed", "frost"]);
  assert.deepEqual(fight.procs, {});
  assert.equal(fight.hits, 14);
});

test("blood beats keen against a bleed-prone boss but not a bleed-immune one", () => {
  const stats = { str: 18, dex: 40, int: 9, fai: 10, arc: 45 };
  const keen = realResult("Uchigatana", "Keen", stats);
  const blood = realResult("Uchigatana", "Blood", stats);
  const apostle = bossById.get("godskin-apostle-godskin-duo");
  const radagon = bossById.get("radagon-of-the-golden-order");
  assert.equal(radagon.status.bleed, null);

  const time = (result, boss) => Engine.fightBoss(result, boss, { physicalType: "slash" }).seconds;
  assert.ok(time(blood, apostle) < time(keen, apostle), "blood kills the Godskin Apostle faster");
  assert.ok(time(keen, radagon) < time(blood, radagon), "keen kills Radagon faster");
});

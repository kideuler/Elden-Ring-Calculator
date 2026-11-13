// Run with: node --test tests/boss.test.mjs
// The boss data and what one hit deals to a boss. The fights themselves are in fight.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const bossDb = JSON.parse(readFileSync(new URL("../data/bosses.json", import.meta.url), "utf8"));
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

test("boss database is well-formed", () => {
  const { bosses } = bossDb;
  const { tempo } = bossDb.meta;
  assert.equal(tempo.shape, 3);
  assert.equal(tempo.spread, 0.25);
  assert.ok(tempo.classes.standard, "the fallback class exists");
  for (const [id, c] of Object.entries(tempo.classes)) {
    assert.ok(c.label && c.description, `${id} is described`);
    assert.ok(c.opening > 0 && c.opening < 12 && c.gap > 0 && c.gap < 20, `${id} opening ${c.opening}, gap ${c.gap}`);
  }
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
    assert.ok(tempo.classes[b.tempo], `${b.label} has a tempo class (${b.tempo})`);
  }
  assert.equal(bossById.get("malenia-blade-of-miquella").tempo, "aggressive");
  assert.equal(bossById.get("fire-giant").tempo, "heavy");

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

test("talismans multiply attack before defense, and a grease adds flat attack", () => {
  const boss = fakeBoss({ negation: { fire: 20 } });
  const share = Engine.defenseMultiplier;
  const hit = Engine.hitDamage(fakeResult({ physical: 200 }), boss, {
    multiplier: 1.1, // e.g. a Winged Sword Insignia stage
    typeMultipliers: { fire: 1.12 }, // Fire Scorpion Charm
    bonus: { fire: 85 }, // Fire Grease
  });
  const physical = 200 * 1.1;
  const fire = 85 * 1.1 * 1.12;
  near(hit.perType.physical.attack, physical);
  near(hit.perType.fire.attack, fire);
  near(hit.perType.physical.dealt, physical * share(physical, 100));
  near(hit.perType.fire.dealt, fire * share(fire, 100) * 0.8, 1e-9, "the grease's fire meets fire defense and negation");
  near(hit.total, hit.perType.physical.dealt + hit.perType.fire.dealt);
  // A multiplier is worth more than its percentage while attack is below 8x defense
  const plain = Engine.hitDamage(fakeResult({ physical: 200 }), boss).total;
  assert.ok(hit.perType.physical.dealt / plain > 1.1);
});

// Run with: node --test tests/engine.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const db = JSON.parse(readFileSync(new URL("../data/weapons.json", import.meta.url), "utf8"));
const model = Engine.createModel(db);

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} expected ${expected}, got ${actual}`);

function run(weaponName, affinityName, stats, { level = 0, twoHanded = false } = {}) {
  const weapon = model.byName.get(weaponName);
  assert.ok(weapon, `weapon ${weaponName} exists`);
  const affinityId = [...model.affinityNames].find(([, n]) => n === affinityName)[0];
  const infusion = weapon.infusions.find((i) => i.affinity === affinityId);
  assert.ok(infusion, `${affinityName} ${weaponName} exists`);
  const full = { str: 10, dex: 10, int: 10, fai: 10, arc: 10, ...stats };
  return { weapon, infusion, result: Engine.calculate(model, weapon, infusion, { stats: full, level, twoHanded }) };
}

test("database covers every weapon and infusion", () => {
  assert.equal(db.meta.patch, "1.17");
  assert.equal(model.weapons.length, 488);
  assert.equal(db.meta.infusionCount, 3296);
  for (const w of model.weapons) {
    assert.ok(w.infusions.length === 1 || w.infusions.length === 13, `${w.name} has 1 or 13 forms`);
    for (const inf of w.infusions) {
      assert.ok(db.reinforce[inf.reinforce], `${inf.name} reinforce`);
      assert.ok(db.elementCorrect[inf.elementCorrect], `${inf.name} element correct`);
      for (const id of Object.values(inf.curves)) assert.ok(db.curves[id], `${inf.name} curve ${id}`);
    }
  }
  const longsword = model.byName.get("Longsword");
  assert.deepEqual(
    longsword.infusions.map((i) => model.affinityNames.get(i.affinity)),
    ["Standard", "Heavy", "Keen", "Quality", "Fire", "Flame Art", "Lightning", "Sacred", "Magic", "Cold", "Poison", "Blood", "Occult"],
  );
  assert.equal(model.byName.get("Moonveil").maxLevel, 10);
  assert.equal(model.byName.get("Uchigatana").maxLevel, 25);
});

test("default stat curve (CalcCorrectGraph 0) hits its breakpoints", () => {
  const curve = model.curves[0];
  near(curve[1], 0);
  near(curve[18], 0.25);
  near(curve[60], 0.75);
  near(curve[80], 0.9);
  near(curve[99], 0.9 + 0.2 * (19 / 70));
  near(curve[148], 0.9 + 0.2 * (68 / 70));
  near(curve[10], 0.25 * (9 / 17) ** 1.2, "exponent 1.2 below the first soft cap");
  near(curve[40], 0.25 + 0.5 * (1 - (1 - 22 / 42) ** 1.2), "exponent -1.2 between 18 and 60");
});

test("Longsword +0 at 10/10 matches a hand calculation", () => {
  const { result } = run("Longsword", "Standard", { str: 10, dex: 10 });
  assert.deepEqual(db.reinforce[0][0].attack, [1, 1, 1, 1, 1]);
  assert.deepEqual(db.reinforce[0][0].scaling, [1, 1, 1, 1, 1]);
  const curve10 = 0.25 * (9 / 17) ** 1.2;
  near(result.damage.physical.total, 110 * (1 + curve10 * 0.5 + curve10 * 0.33));
  assert.equal(Engine.floor(result.total), 120);
  assert.deepEqual(Object.keys(result.damage), ["physical"]);
});

test("upgrade level multiplies base damage and scaling", () => {
  const { result } = run("Longsword", "Standard", { str: 40, dex: 10 }, { level: 25 });
  const row = db.reinforce[0][25];
  const base = 110 * row.attack[0];
  near(result.damage.physical.base, base);
  near(result.scaling.str, 0.5 * row.scaling[0]);
  const expected = base * (1 + model.curves[0][40] * 0.5 * row.scaling[0] + model.curves[0][10] * 0.33 * row.scaling[1]);
  near(result.damage.physical.total, expected);
  assert.equal(Engine.scalingGrade(model, result.scaling.str), "C");
});

test("missing a requirement replaces the bonus with a 40% penalty", () => {
  const { result } = run("Longsword", "Standard", { str: 9, dex: 10 });
  assert.deepEqual(result.unmet, ["str"]);
  assert.equal(result.damage.physical.ineffective, true);
  near(result.damage.physical.total, 110 * 0.6);
});

test("two-handing multiplies STR by 1.5 for requirements and scaling", () => {
  const oneHand = run("Longsword", "Standard", { str: 7 }).result;
  assert.deepEqual(oneHand.unmet, ["str"]);
  const twoHand = run("Longsword", "Standard", { str: 7 }, { twoHanded: true }).result;
  assert.equal(twoHand.stats.str, 10);
  assert.deepEqual(twoHand.unmet, []);
  near(twoHand.damage.physical.total, run("Longsword", "Standard", { str: 10 }).result.damage.physical.total);
  assert.equal(run("Longsword", "Standard", { str: 99 }, { twoHanded: true }).result.stats.str, 148);
});

test("paired weapons never get the two-handed bonus; bows always do", () => {
  const paired = run("Golem Fist", "Standard", { str: 40 }, { twoHanded: true }).result;
  assert.equal(paired.twoHandBonus, false);
  assert.equal(paired.stats.str, 40);
  const bow = run("Longbow", "Unique", { str: 20 }, { twoHanded: false }).result;
  assert.equal(bow.twoHandBonus, true);
  assert.equal(bow.stats.str, 30);
});

test("each infusion uses its own scaling and damage split", () => {
  const stats = { str: 20, dex: 20, int: 50 };
  const magic = run("Longsword", "Magic", stats, { level: 25 }).result;
  assert.deepEqual(Object.keys(magic.damage), ["physical", "magic"]);
  assert.deepEqual(magic.damage.magic.scalesWith, ["int"]);
  const fire = run("Longsword", "Fire", stats, { level: 25 }).result;
  assert.deepEqual(Object.keys(fire.damage), ["physical", "fire"]);
  assert.deepEqual(fire.damage.fire.scalesWith, ["str"], "Fire infusion's fire damage scales with STR");
  const flameArt = run("Longsword", "Flame Art", stats, { level: 25 }).result;
  assert.deepEqual(flameArt.damage.fire.scalesWith, ["fai"], "Flame Art's fire damage scales with FAI");
});

test("status buildup: bleed scales with Arcane, frost does not", () => {
  const bloody = run("Longsword", "Blood", { arc: 1 }).result;
  const bloodyHighArc = run("Longsword", "Blood", { arc: 60 }).result;
  assert.ok(bloody.status.bleed.total > 0);
  const inf = model.byName.get("Longsword").infusions.find((i) => i.affinity === 11);
  const base = db.statusEffects[inf.statusEffects[0]].bleed;
  near(bloodyHighArc.status.bleed.total, base * (1 + model.curves[inf.curves.bleed][60] * 0.3));
  const cold1 = run("Longsword", "Cold", { arc: 1 }).result;
  const cold99 = run("Longsword", "Cold", { arc: 99 }).result;
  assert.equal(cold1.status.frost.total, cold99.status.frost.total);
  assert.ok(run("Great Knife", "Cold", {}).result.status.bleed, "Cold Great Knife keeps its innate bleed");
  assert.ok(run("Great Knife", "Cold", {}).result.status.frost, "and gains frost");
});

test("upgrades raise status buildup on infused weapons", () => {
  const atZero = run("Longsword", "Blood", { arc: 10 }, { level: 0 }).result.status.bleed.base;
  const atMax = run("Longsword", "Blood", { arc: 10 }, { level: 25 }).result.status.bleed.base;
  assert.ok(atMax > atZero, `bleed base ${atZero} -> ${atMax}`);
});

test("AttackElementCorrect overrides (Smithscript weapons) replace the scaling value", () => {
  const { infusion, result } = run("Smithscript Axe", "Flame Art", { str: 20, int: 20, fai: 40 }, { level: 25 });
  assert.deepEqual(result.unmet, []);
  const reinforce = db.reinforce[infusion.reinforce];
  const expected = 0.05 * (reinforce[25].scaling[3] / reinforce[0].scaling[3]);
  near(result.damage.physical.parts.fai.scaling, expected);
  assert.ok(result.damage.physical.parts.fai.scaling < result.scaling.fai, "override is smaller than the weapon's own FAI scaling");
});

test("catalysts report spell scaling", () => {
  const staff = run("Meteorite Staff", "Unique", { str: 6, int: 80 }).result;
  near(staff.spell.magic.value, 100 * (1 + model.curves[16][80] * 1.92));
  const unmet = run("Meteorite Staff", "Unique", { str: 6, int: 17 }).result;
  near(unmet.spell.magic.value, 60);
  const greatBeyond = run("Staff of the Great Beyond", "Unique", { int: 40, fai: 40 }).result;
  assert.ok(greatBeyond.spell.magic.value > 100 && greatBeyond.spell.holy.value > 100);
});

test("upgrade levels convert between regular and somber weapons", () => {
  assert.equal(Engine.convertLevel(25, 25, 10), 10);
  assert.equal(Engine.convertLevel(24, 25, 10), 9);
  assert.equal(Engine.convertLevel(0, 25, 10), 0);
  assert.equal(Engine.convertLevel(10, 10, 25), 25);
  assert.equal(Engine.convertLevel(4, 10, 25), 10);
  assert.equal(Engine.convertLevel(25, 25, 0), 0);
});

test("stats are clamped to the 1-99 range", () => {
  const { result } = run("Longsword", "Standard", { str: 150, dex: -4 });
  assert.equal(result.stats.str, 99);
  assert.equal(result.stats.dex, 1);
});

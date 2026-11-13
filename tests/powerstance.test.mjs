// Run with: node --test tests/powerstance.test.mjs
// Powerstance: a weapon of the same type in each hand. L1 attacks swing both, and each hit uses
// the attack rating and status buildup of the hand that lands it. Paired weapons (fists, claws
// and the like) held in both hands swing both of their pair the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const load = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const bossDb = load("bosses.json");
const attackDb = load("attacks.json");
const model = Engine.createModel(load("weapons.json"));
const movesetOf = (name) => attackDb.movesets[attackDb.weapons[name]] || null;
const weapon = (name) => {
  const w = model.byName.get(name);
  assert.ok(w, name);
  return w;
};

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
 * One steady powerstanced fight: 2 s of boss attacks, then a 1 s opening that fits one L1 of
 * two 100 motion value hits, `hands` saying which hand lands each ("LR": left first).
 */
function pairFight(right, left, boss, hands = "LR") {
  const tempo = { opening: 1, gap: 2, shape: Infinity };
  const families = Engine.attackFamilies([["L1 1", [100, 100], "slash", 30, 30, 0, hands]]);
  const fighter = Engine.prepareFighter({ result: right, left, boss, families, grip: "ps", tempo });
  return Engine.simulate(fighter, Engine.createFights(tempo, { count: 1 }));
}

test("powerstance data: L1 attacks with the hand of every hit", () => {
  const scimitar = movesetOf("Scimitar").paired;
  const find = (name) => scimitar.find((a) => a[0] === name);
  // [name, motion value per hit, damage type, frames to the next attack, frames to dodge, stamina, hands]
  assert.deepEqual(find("L1 1"), ["L1 1", [92, 92], "slash", 26, 28, 12, "LR"]);
  // The jump lands with both blades twice, right first
  assert.deepEqual(find("Jumping L1").slice(1, 2).concat(find("Jumping L1").slice(6)), [[50, 50, 105, 105], "RLRL"]);
  // Both curved swords of the user's example can powerstance, with each other too
  assert.equal(weapon("Scavenger's Curved Sword").typeName, weapon("Bandit's Curved Sword").typeName);
  assert.ok(Engine.canPowerstance(weapon("Scavenger's Curved Sword"), movesetOf("Scavenger's Curved Sword")));
  assert.ok(Engine.canPowerstance(weapon("Bandit's Curved Sword"), movesetOf("Bandit's Curved Sword")));
  // Bows are held in both hands; staffs have no moveset data
  assert.equal(Engine.canPowerstance(weapon("Longbow"), movesetOf("Longbow")), false);
  assert.equal(Engine.canPowerstance(weapon("Astrologer's Staff"), movesetOf("Astrologer's Staff")), false);
});

test("pairedAttacks takes each left-hand hit's motion value from the left weapon", () => {
  const right = [
    ["L1 1", [92, 92], "slash", 26, 28, 12, "LR"],
    ["L1 2", [90, 90, 90], "slash", 26, 28, 12, "RLR"],
  ];
  const left = [
    ["L1 1", [80, 85], "slash", 20, 22, 10, "LR"],
    ["L1 2", [70, 70], "slash", 20, 22, 10, "RL"],
  ];
  const paired = Engine.pairedAttacks(right, left);
  // The left hit takes the left weapon's value; timing, type and stamina stay the right weapon's
  assert.deepEqual(paired[0], ["L1 1", [80, 92], "slash", 26, 28, 12, "LR"]);
  // A different number of hits: the right weapon's own values
  assert.deepEqual(paired[1], right[1]);
  assert.equal(Engine.pairedAttacks(right, right), right);
  assert.equal(Engine.pairedAttacks(right, null), right);
});

test("each powerstance hit deals its own hand's damage", () => {
  // Right 800 attack: 90% through 100 defense, 720 a hit. Left 400: 4x defense lets 79.4% through,
  // 317.69 a hit. An L1 deals 1,037.69: after 9 of them 9,339 HP is gone, and the 10th's right
  // hit kills
  const right = fakeResult({ physical: 800 });
  const left = fakeResult({ physical: 400 });
  const leftHit = 400 * (0.9 - 0.2 * (4 / 5.5) ** 2);
  near(Engine.hitDamage(left, fakeBoss(), { physicalType: "slash" }).total, leftHit);
  const leftFirst = pairFight(right, left, fakeBoss(), "LR");
  assert.equal(leftFirst.openingsToKill, 10);
  assert.equal(leftFirst.hits, 20);
  near(leftFirst.direct.physical, 10000, 1e-6);
  // Right hand first: the 10th L1's first hit already kills
  const rightFirst = pairFight(right, left, fakeBoss(), "RL");
  assert.equal(rightFirst.openingsToKill, 10);
  assert.equal(rightFirst.hits, 19);
  // Without a left weapon of its own both hands hit with the right one's 720: 7 L1s
  const same = pairFight(right, undefined, fakeBoss());
  assert.equal(same.openingsToKill, 7);
  assert.equal(same.hits, 14);
});

test("each powerstance hit adds its own hand's buildup", () => {
  // Bleed procs at 100 for (15% of 10,000 + 100) x 70% = 1,120. Only the right weapon bleeds, 50 a
  // hit, so every second L1 procs: 3 procs by the 6th opening (9,586 HP), and the 7th opening's
  // right hit kills
  const boss = fakeBoss({ status: { bleed: [100] } });
  const right = fakeResult({ physical: 800 }, { bleed: 50 });
  const left = fakeResult({ physical: 400 });
  const one = pairFight(right, left, boss);
  assert.equal(one.procs.bleed, 3);
  assert.equal(one.openingsToKill, 7);
  near(one.sources.bleed, 3 * 1120, 1e-6);
  // Two of the right weapon: both hits bleed and every L1 procs. After 3 openings 7,680 HP is
  // gone (1,440 + 1,120 each); the 4th's two hits bring 9,120 and its proc kills
  const two = pairFight(right, undefined, boss);
  assert.equal(two.procs.bleed, 4);
  assert.equal(two.openingsToKill, 4);
  // The fighter keeps each hand's buildup apart
  const families = Engine.attackFamilies([["L1 1", [100, 100], "slash", 30, 30, 0, "LR"]]);
  const fighter = Engine.prepareFighter({ result: right, left, boss, families, grip: "ps" });
  assert.deepEqual(fighter.building.find((b) => b.type === "bleed").perHit, [50, 0]);
});

test("rankInfusions powerstances with a left weapon and finds its best infusion", () => {
  const margit = bossDb.bosses.find((b) => b.id === "margit-the-fell-omen-stormveil-castle");
  const { classes, shape, spread } = bossDb.meta.tempo;
  const tempo = { ...classes[margit.tempo], shape, spread };
  const stats = { str: 18, dex: 40, int: 9, fai: 10, arc: 9, end: 25 };
  const fights = Engine.createFights(tempo, { count: 12, seed: 5 });
  const uchigatana = weapon("Uchigatana");
  const base = { stats, level: 25, boss: margit, tempo, moveset: movesetOf("Uchigatana"), physicalType: "slash", talismans: [], fights, greases: false };

  const alone = Engine.rankInfusions(model, uchigatana, base);
  assert.deepEqual(alone.grips, ["1h", "2h"]);
  assert.equal(alone.left, null);

  // Every left infusion over every fight, as leftScreen covering every fight does
  const left = { weapon: uchigatana, level: 25, moveset: movesetOf("Uchigatana") };
  const out = Engine.rankInfusions(model, uchigatana, { ...base, left, leftScreen: fights.count });
  assert.deepEqual(out.grips, ["1h", "2h", "ps"]);
  assert.equal(out.left.weapon, uchigatana);
  const effects = Engine.talismanEffects([]);
  const stamina = Engine.staminaFor(stats.end);
  for (const i of [0, 3]) {
    const row = out.rows[i];
    const ps = row.grips.ps;
    assert.equal(ps.left.weapon, uchigatana);
    assert.equal(ps.result, row.grips["1h"].result, "the right hand is held in one hand");
    const each = uchigatana.infusions.map((infusion) => {
      const result = Engine.calculate(model, uchigatana, infusion, { stats, level: 25, twoHanded: false });
      const fighter = Engine.prepareFighter({ result: ps.result, left: result, boss: margit, families: out.families.ps, grip: "ps", stamina, effects, tempo });
      return { infusion, seconds: Engine.simulate(fighter, fights).seconds };
    });
    const fastest = Math.min(...each.map((e) => e.seconds));
    assert.equal(ps.sim.seconds, fastest);
    assert.ok(each.some((e) => e.infusion === ps.left.infusion && e.seconds === fastest));
    // The row fights in its fastest grip
    const grips = Object.entries(row.grips).sort((a, b) => a[1].sim.seconds - b[1].sim.seconds);
    assert.equal(row.grip, grips[0][0]);
    assert.equal(row.left, row.grip === "ps" ? ps.left : null);
  }
  // Powerstanced, the plan uses L1 or jumping L1 in this fight
  const best = Engine.fastestRow(out.rows);
  assert.equal(best.grip, "ps");
  assert.ok(best.sim.plan.some((p) => p.id === "l1" || p.id === "jump-l1"));
  // The default screens the left infusions over the first fights, then fights the closest two
  const quick = Engine.rankInfusions(model, uchigatana, { ...base, left, leftScreen: 4 });
  quick.rows.forEach((row, i) => assert.ok(row.grips.ps.sim.seconds >= out.rows[i].grips.ps.sim.seconds));
});

test("a paired weapon in both hands swings both of its pair, without the Strength bonus", () => {
  const hookclaws = weapon("Hookclaws");
  assert.ok(hookclaws.paired);
  const { families } = Engine.weaponFamilies(hookclaws, movesetOf("Hookclaws"), "slash");
  assert.deepEqual(Object.keys(families), ["1h", "2h"]);
  assert.ok(families["2h"].some((f) => f.id === "l1"), "its powerstance attacks with the same weapon in each hand");
  assert.ok(!families["1h"].some((f) => f.id === "l1"));
  const stats = { str: 30, dex: 20, int: 9, fai: 9, arc: 9 };
  const infusion = hookclaws.infusions[0];
  const one = Engine.calculate(model, hookclaws, infusion, { stats, level: 25, twoHanded: false });
  const both = Engine.calculate(model, hookclaws, infusion, { stats, level: 25, twoHanded: true });
  assert.equal(both.total, one.total);
  // And with another claw in the left hand it powerstances
  const ps = Engine.weaponFamilies(hookclaws, movesetOf("Hookclaws"), "slash", movesetOf("Bloodhound Claws")).families.ps;
  assert.ok(ps && ps.some((f) => f.id === "l1"));
});

// Run with: node --test tests/blessing.test.mjs
// Scadutree Blessing: against a Shadow of the Erdtree boss every hit's attack is multiplied;
// status buildup and proc damage stay the same, and other bosses don't count it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const model = Engine.createModel(read("data/weapons.json"));
const bossDb = read("data/bosses.json");
const attackDb = read("data/attacks.json");

const jori = bossDb.bosses.find((b) => b.id === "jori-elder-inquisitor");
const margit = bossDb.bosses.find((b) => b.id === "margit-the-fell-omen-stormveil-castle");
const tempoOf = (boss) => {
  const { classes, shape, spread } = bossDb.meta.tempo;
  return { ...classes[boss.tempo], shape, spread };
};
const stats = { str: 14, dex: 16, int: 10, fai: 10, arc: 10, end: 20 };
const movesetOf = (w) => attackDb.movesets[attackDb.weapons[w.name]] || null;
const uchigatana = model.byName.get("Uchigatana");
const affinity = (w, name) => w.infusions.find((i) => model.affinityNames.get(i.affinity) === name);

test("blessingMultiplier follows the wiki's table and counts only in the DLC", () => {
  assert.ok(jori.dlc && !margit.dlc);
  assert.equal(Engine.MAX_BLESSING, 20);
  assert.deepEqual([0, 1, 10, 12, 15, 20].map((level) => Engine.blessingMultiplier(level, jori)), [1, 1.1, 1.65, 1.85, 1.92, 2.05]);
  Engine.BLESSING_ATTACK.forEach((m, level) => assert.ok(!level || m > Engine.BLESSING_ATTACK[level - 1], `level ${level} adds to the one before`));
  assert.equal(Engine.blessingMultiplier(20, margit), 1, "no effect outside the realm of shadow");
  assert.equal(Engine.blessingMultiplier(25, jori), 2.05, "past the top level, the top level");
  assert.equal(Engine.blessingMultiplier(-1, jori), 1);
  assert.equal(Engine.blessingMultiplier(undefined, jori), 1);
  assert.equal(Engine.blessingMultiplier(10, null), 1);
});

test("the Blessing multiplies a hit's attack before defense and leaves status alone", () => {
  const result = Engine.calculate(model, uchigatana, affinity(uchigatana, "Blood"), { stats, level: 25, twoHanded: false });
  const families = Engine.weaponFamilies(uchigatana, movesetOf(uchigatana), "slash").families["1h"];
  const fighter = (boss, blessing) => Engine.prepareFighter({ result, boss, families, grip: "1h", blessing, tempo: tempoOf(boss) });
  const plain = fighter(jori, 0);
  const blessed = fighter(jori, 10);

  // The first R1 is worth what hitDamage says for one hit at ×1.65 attack
  const r1 = blessed.families.find((f) => f.id === "r1");
  const step = r1.steps[0].source;
  const expected = Engine.hitDamage(result, jori, { motionValue: step.mvs[0], physicalType: step.type, multiplier: 1.65 }).total;
  assert.ok(Math.abs(r1.value[1] - expected) < 1e-9);
  // More than 1.65 times the plain hit: more of a bigger attack gets through defense
  const plainR1 = plain.families.find((f) => f.id === "r1").value[1];
  assert.ok(r1.value[1] > 1.65 * plainR1, `${r1.value[1]} against ${plainR1}`);

  // Buildup per hit and what a proc deals don't change
  const bleed = (f) => f.building.find((b) => b.type === "bleed");
  assert.deepEqual(bleed(blessed).perHit, bleed(plain).perHit);
  assert.equal(bleed(blessed).damage, bleed(plain).damage);
  assert.equal(bleed(blessed).damage, (0.15 * jori.hp + 100) * jori.statusDamage);

  // Against a base-game boss it's as if there were none
  const base = fighter(margit, 20);
  const basePlain = fighter(margit, 0);
  assert.deepEqual(base.families.map((f) => f.value), basePlain.families.map((f) => f.value));
});

test("rankInfusions kills a DLC boss sooner with the Blessing, and a base-game boss the same", () => {
  const rank = (boss, blessing) =>
    Engine.rankInfusions(model, uchigatana, {
      stats, level: 25, boss, tempo: tempoOf(boss), moveset: movesetOf(uchigatana), physicalType: "slash", talismans: [], blessing,
      fights: Engine.createFights(tempoOf(boss), { count: 30, seed: 7 }),
    });
  const plain = rank(jori, 0);
  const blessed = rank(jori, 10);
  blessed.rows.forEach((row, i) => {
    const before = plain.rows[i].sim;
    assert.ok(row.sim.seconds < before.seconds, `${row.infusion.name} is faster`);
    // Hits take a bigger share of the damage, procs a smaller one
    const share = (sim) => sim.sources.direct / (sim.sources.direct + sim.sources.bleed + sim.sources.frost + sim.sources.poison + sim.sources.rot);
    assert.ok(share(row.sim) >= share(before) - 1e-12, `${row.infusion.name}: hits count for more`);
  });

  const base = rank(margit, 20);
  const basePlain = rank(margit, 0);
  base.rows.forEach((row, i) => assert.deepEqual(Array.from(row.sim.times), Array.from(basePlain.rows[i].sim.times)));
});

test("searchWeapons fights with the Blessing, as the page does", () => {
  const names = ["Uchigatana", "Bandit's Curved Sword", "Scavenger's Curved Sword", "Dagger"];
  const candidates = names.map((name) => {
    const weapon = model.byName.get(name);
    return { weapon, level: 25, moveset: movesetOf(weapon), physicalType: "slash" };
  });
  const fights = Engine.createFights(tempoOf(jori), { count: 30, seed: 3 });
  const search = Engine.searchWeapons(model, candidates, { stats, boss: jori, tempo: tempoOf(jori), talismans: [], blessing: 12, fights, screen: 8, shortlist: 99, top: 4, hands: 0 });
  let step;
  while (!(step = search.next()).done);
  const found = step.value;
  assert.equal(found.results.length, 4);
  for (const r of found.results) {
    const c = candidates.find((x) => x.weapon === r.weapon);
    const page = Engine.rankInfusions(model, r.weapon, { stats, level: 25, boss: jori, tempo: tempoOf(jori), moveset: c.moveset, physicalType: "slash", talismans: [], blessing: 12, fights });
    assert.equal(r.best.sim.seconds, Engine.fastestRow(page.rows).sim.seconds, `${r.weapon.name} as the page fights it`);
  }
});

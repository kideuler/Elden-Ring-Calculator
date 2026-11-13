// Run with: node --test tests/search.test.mjs
// The weapon search: every weapon in its best infusion and grip, fastest first.
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

const margit = bossDb.bosses.find((b) => b.id === "margit-the-fell-omen-stormveil-castle");
const { classes, shape, spread } = bossDb.meta.tempo;
const tempo = { ...classes[margit.tempo], shape, spread };
const stats = { str: 18, dex: 40, int: 9, fai: 10, arc: 9, end: 25 };

const NAMES = ["Uchigatana", "Wakizashi", "Claymore", "Dagger", "Twinblade", "Greatsword", "Rivers of Blood",
  "Bloodhound's Fang", "Godskin Peeler", "Longsword", "Astrologer's Staff", "Longbow", "Unarmed"];
const candidates = NAMES.map((name) => {
  const weapon = model.byName.get(name);
  assert.ok(weapon, name);
  return {
    weapon,
    level: Engine.convertLevel(25, 25, weapon.maxLevel),
    moveset: attackDb.movesets[attackDb.weapons[name]] || null,
    physicalType: "standard",
  };
});

/** Runs a search to the end, keeping what it yields */
function search(options) {
  const steps = [];
  const generator = Engine.searchWeapons(model, candidates, { stats, boss: margit, tempo, talismans: [], ...options });
  for (;;) {
    const step = generator.next();
    if (step.done) return { steps, found: step.value };
    steps.push(step.value);
  }
}

test("fastestRow picks the quickest kill, then the higher attack rating", () => {
  const row = (seconds, total) => ({ sim: { seconds }, result: { total } });
  const rows = [row(50, 300), row(40, 280), row(40, 290), row(Infinity, 500)];
  assert.equal(Engine.fastestRow(rows), rows[2]);
  assert.equal(Engine.fastestRow([row(Infinity, 1), row(Infinity, 2)]).result.total, 2);
});

test("rankInfusionsInSteps steps between infusions and ends where rankInfusions does", () => {
  const fights = Engine.createFights(tempo, { count: 12, seed: 5 });
  const c = candidates[0]; // Uchigatana: 13 infusions
  const options = { stats, level: c.level, boss: margit, tempo, moveset: c.moveset, talismans: [], fights };
  const generator = Engine.rankInfusionsInSteps(model, c.weapon, options);
  const yields = [];
  let step;
  while (!(step = generator.next()).done) yields.push(step.value);
  assert.deepEqual(yields, Array.from({ length: c.weapon.infusions.length - 1 }, (_, k) => k + 1));
  assert.deepEqual(step.value, Engine.rankInfusions(model, c.weapon, options));
});

test("searchWeapons ranks every weapon with a moveset by its best infusion", () => {
  const fights = Engine.createFights(tempo, { count: 40, seed: 11 });
  // A shortlist as long as the list fights every weapon over every fight: the exact answer
  const { steps, found } = search({ fights, screen: 8, shortlist: 99, top: 5 });

  assert.deepEqual(found.skipped.map((w) => w.name), ["Astrologer's Staff", "Longbow", "Unarmed"], "no moveset data, not searched");
  assert.equal(found.searched, 10);
  assert.equal(found.screen, 8);
  assert.equal(found.shortlist, 10);
  // One step per weapon in the screen; the final stage also steps between infusions
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);
  assert.deepEqual(steps.slice(0, 10), range(1, 10).map((done) => ({ stage: "screen", done, total: 10 })));
  const final = steps.slice(10);
  assert.ok(final.every((s) => s.stage === "final" && s.total === 10));
  assert.ok(final.length > 10, "steps between infusions");
  assert.ok(final.every((s, k) => !k || s.done >= final[k - 1].done), "done never goes back");
  assert.deepEqual([...new Set(final.map((s) => s.done))], range(0, 10));
  assert.deepEqual(steps.at(-1), { stage: "final", done: 10, total: 10 });

  // The same as fighting each weapon on its own and sorting
  const exhaustive = candidates
    .filter((c) => !Engine.weaponFamilies(c.weapon, c.moveset, "standard").generic)
    .map((c) => {
      const fight = Engine.rankInfusions(model, c.weapon, { stats, level: c.level, boss: margit, tempo, moveset: c.moveset, talismans: [], fights });
      return { name: c.weapon.name, best: Engine.fastestRow(fight.rows) };
    })
    .sort((a, b) => a.best.sim.seconds - b.best.sim.seconds || b.best.result.total - a.best.result.total);
  assert.equal(found.results.length, 5);
  found.results.forEach((r, i) => {
    assert.equal(r.weapon.name, exhaustive[i].name);
    assert.equal(r.best.infusion, exhaustive[i].best.infusion);
    assert.equal(r.best.grip, exhaustive[i].best.grip);
    assert.equal(r.best.sim.seconds, exhaustive[i].best.sim.seconds, `${r.weapon.name} over every fight, as the page fights it`);
    assert.equal(r.best.sim.times.length, 40);
    assert.equal(r.best, Engine.fastestRow(r.fight.rows));
    if (i) assert.ok(r.best.sim.seconds >= found.results[i - 1].best.sim.seconds, "fastest first");
  });
  // The final stage fights with greases, as the page does
  assert.ok(found.results.some((r) => r.fight.rows.some((row) => row.grease)));
});

test("searchWeapons screens over the first fights and keeps only the closest", () => {
  const fights = Engine.createFights(tempo, { count: 40, seed: 11 });
  const { steps, found } = search({ fights, screen: 8, shortlist: 4, top: 3 });
  assert.deepEqual(steps.at(-1), { stage: "final", done: 4, total: 4 });
  assert.equal(found.shortlist, 4);
  assert.equal(found.results.length, 3);

  // The shortlist is the four fastest over the first 8 fights
  const screen = { ...fights, count: 8 };
  const estimates = candidates
    .filter((c) => !Engine.weaponFamilies(c.weapon, c.moveset, "standard").generic)
    .map((c) => {
      const fight = Engine.rankInfusions(model, c.weapon, { stats, level: c.level, boss: margit, tempo, moveset: c.moveset, talismans: [], fights: screen, greases: false });
      return { name: c.weapon.name, seconds: Engine.fastestRow(fight.rows).sim.seconds };
    })
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 4)
    .map((e) => e.name);
  for (const r of found.results) assert.ok(estimates.includes(r.weapon.name), `${r.weapon.name} was shortlisted`);

  // The first fights of a set are the same fights whatever the set's size
  const small = Engine.createFights(tempo, { count: 8, seed: 11 });
  small.extend(3);
  fights.extend(3);
  assert.deepEqual(Array.from(small.opens[3].slice(0, 20)), Array.from(fights.opens[3].slice(0, 20)));
});

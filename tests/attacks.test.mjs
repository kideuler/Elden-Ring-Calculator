// Run with: node --test tests/attacks.test.mjs
// The moveset data, how the fight model reads it, stamina, and talismans.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Engine = require("../src/engine.js");
const load = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const weaponDb = load("weapons.json");
const attackDb = load("attacks.json");
const talismanDb = load("talismans.json");
const talisman = new Map(talismanDb.talismans.map((t) => [t.name, t]));

const near = (actual, expected, tolerance = 1e-9, message = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);

const moves = (weapon, grip) => attackDb.movesets[attackDb.weapons[weapon]][grip];
const attack = (weapon, grip, name) => moves(weapon, grip).find((a) => a[0] === name);
const frame = (n) => n / Engine.FPS;

test("attack database is well-formed", () => {
  const names = new Set([
    "R1 1", "R1 2", "R1 3", "R1 4", "R1 5", "R1 6", "R2 1", "R2 2", "Charged R2 1", "Charged R2 2",
    "Running R1", "Running R2", "Rolling R1", "Backstep R1", "Jumping R1", "Jumping R2", "Guard Counter",
  ]);
  const pairedNames = new Set(["L1 1", "L1 2", "L1 3", "L1 4", "L1 5", "L1 6", "Running L1", "Rolling L1", "Backstep L1", "Jumping L1"]);
  const ours = new Set(weaponDb.weapons.map((w) => w.name));
  const frames = (v) => v === null || (Number.isInteger(v) && v > 0 && v < 200);
  assert.equal(Object.keys(attackDb.weapons).length, attackDb.meta.weaponCount);
  assert.ok(attackDb.meta.weaponCount >= 400, "every melee weapon has a moveset");
  for (const [weapon, index] of Object.entries(attackDb.weapons)) {
    assert.ok(ours.has(weapon), `${weapon} is in the weapon database`);
    assert.ok(attackDb.movesets[index], `${weapon} moveset exists`);
  }
  let timed = 0;
  let total = 0;
  for (const moveset of attackDb.movesets) {
    assert.ok(moveset["1h"] || moveset["2h"], "a one- or two-handed moveset");
    for (const [grip, list] of Object.entries(moveset)) {
      assert.ok(grip === "1h" || grip === "2h" || grip === "paired");
      const paired = grip === "paired";
      for (const entry of list) {
        assert.equal(entry.length, paired ? 7 : 6, "[name, motion values, type, next, dodge, stamina] and, in powerstance, hands");
        const [name, mvs, type, next, exit, stamina, hands] = entry;
        assert.ok((paired ? pairedNames : names).has(name), `known attack ${name}`);
        if (paired) assert.ok(/^[LR]+$/.test(hands) && hands.length === mvs.length, `${name}: a hand per hit (${hands})`);
        assert.ok(mvs.length >= 1 && mvs.every((v) => v > 0 && v < 1000), `${name} motion values`);
        assert.ok(Engine.PHYSICAL_TYPES.includes(type), `${name} type ${type}`);
        assert.ok(frames(next) && frames(exit), `${name} frames ${next}, ${exit}`);
        assert.ok(stamina === null || (Number.isInteger(stamina) && stamina >= 0 && stamina < 100), `${name} stamina ${stamina}`);
        total++;
        if (next !== null && exit !== null) timed++;
      }
    }
  }
  assert.ok(timed / total > 0.95, `most attacks are timed (${timed} of ${total})`);
  // Staffs, seals and bows deal their damage some other way
  for (const weapon of ["Meteorite Staff", "Finger Seal", "Longbow", "Unarmed"]) assert.equal(attackDb.weapons[weapon], undefined);
});

test("motion values, damage types, timing and stamina per weapon and attack", () => {
  // One-handed Uchigatana: the R1 chain from the sheet; frames and stamina from the game files
  const r1 = moves("Uchigatana", "1h").filter((a) => a[0].startsWith("R1 "));
  assert.deepEqual(r1, [
    ["R1 1", [100], "slash", 17, 25, 12],
    ["R1 2", [101], "slash", 18, 26, 12],
    ["R1 3", [102], "slash", 17, 25, 12],
    ["R1 4", [103], "slash", 20, 27, 12],
    ["R1 5", [110], "slash", 45, 32, 12],
  ]);
  assert.deepEqual(attack("Uchigatana", "1h", "R2 1"), ["R2 1", [125], "pierce", 28, 27, 20], "the one-handed katana heavy is a thrust");
  assert.deepEqual(attack("Uchigatana", "2h", "Charged R2 1"), ["Charged R2 1", [165], "slash", 56, 59, 36]);
  assert.deepEqual(attack("Uchigatana", "1h", "Jumping R2"), ["Jumping R2", [130], "slash", 30, 31, 20], "jump frames time the landing");

  // Multi-hit attacks list every hit
  assert.deepEqual(attack("Serpentbone Blade", "1h", "R2 1")[1], [50, 110]);
  assert.deepEqual(attack("Twinblade", "2h", "R1 1")[1], [50, 103]);
  // Weapons whose attacks differ from the rest of their class keep their own values
  assert.deepEqual(attack("Alabaster Lord's Sword", "1h", "R2 1")[1], [120]);
  assert.deepEqual(attack("Bloodhound's Fang", "1h", "Jumping R1")[1], [118]);
  // The sheet fills attacks the animation data has no motion value for
  assert.deepEqual(moves("Greatsword", "2h").filter((a) => a[0].startsWith("R1 ")).map((a) => a[1][0]), [114, 117, 125]);
});

test("attack families: timing in seconds, estimated wind-up and airtime, the finisher", () => {
  const families = Engine.attackFamilies(moves("Uchigatana", "1h"));
  assert.deepEqual(families.map((f) => f.id), ["r1", "r2", "charged-r2", "jump-r1", "jump-r2"]);
  const byId = Object.fromEntries(families.map((f) => [f.id, f]));

  const r1 = byId.r1;
  assert.equal(r1.steps.length, 5);
  assert.equal(r1.estimated, false);
  near(r1.steps[0].chain, frame(17), 1e-12, "next attack after 17 frames");
  near(r1.steps[0].exit, frame(25), 1e-12, "dodge after 25 frames");
  assert.equal(r1.steps[0].stamina, 12);
  assert.deepEqual(r1.steps.map((s) => s.finisher), [false, false, false, false, true], "the fifth R1 ends the chain");

  // Uncharged heavies start at the release in the data: add the wind-up
  near(byId.r2.steps[0].chain, frame(28) + Engine.TIMING.windup, 1e-12);
  near(byId.r2.steps[0].exit, frame(27) + Engine.TIMING.windup, 1e-12);
  assert.equal(byId.r2.estimated, true);
  // Charged heavies include their charge
  near(byId["charged-r2"].steps[0].chain, frame(57), 1e-12);
  assert.equal(byId["charged-r2"].estimated, false);
  // Jump attacks start at the landing: add the airtime, and the next jump waits for the recovery
  near(byId["jump-r2"].steps[0].chain, frame(31) + Engine.TIMING.airtime, 1e-12);
  near(byId["jump-r2"].steps[0].exit, frame(31) + Engine.TIMING.airtime, 1e-12);
  assert.equal(byId["jump-r1"].kind, "jump");
  assert.equal(byId["charged-r2"].kind, "charged");

  // A family with an attack the data can't time is left out; the rest stay
  const partly = Engine.attackFamilies([
    ["R1 1", [100], "slash", 17, 25, 12],
    ["R1 2", [101], "slash", null, 26, 12],
    ["R2 1", [125], "slash", 28, 27, 20],
  ]);
  assert.deepEqual(partly.map((f) => f.id), ["r2"]);
  // Situational attacks aren't planned
  const situational = Engine.attackFamilies([["Running R1", [105], "slash", 28, 28, 15], ["Guard Counter", [140], "slash", 34, 34, 12]]);
  assert.deepEqual(situational, []);
  // A missing stamina cost counts as free
  assert.equal(Engine.attackFamilies([["R1 1", [100], "slash", 17, 25, null]])[0].steps[0].stamina, 0);
  // No moveset: one 100 motion value hit a second
  const [basic] = Engine.basicFamily("strike");
  assert.deepEqual([basic.steps[0].mvs, basic.steps[0].type, basic.steps[0].chain, basic.steps[0].exit], [[100], "strike", 1, 1]);
});

test("stamina follows Endurance between the soft caps", () => {
  // Wiki values: 80 at 1, 96 at 10, 105 at 15, 113 at 20, 121 at 25, 130 at 30, 142 at 40,
  // 155 at 50, 158 at 60, 170 at 99
  const expected = { 1: 80, 10: 96, 15: 105, 20: 113, 25: 121, 30: 130, 40: 142, 50: 155, 60: 158, 99: 170 };
  for (const [end, stamina] of Object.entries(expected)) assert.equal(Engine.staminaFor(Number(end)), stamina, `Endurance ${end}`);
  let previous = 0;
  for (let end = 1; end <= 99; end++) {
    const s = Engine.staminaFor(end);
    assert.ok(s >= previous, `never drops (${end})`);
    previous = s;
  }
  // Talismans multiply the total
  assert.equal(Engine.staminaFor(25, 1.17), Math.floor(121 * 1.17));
});

test("talisman data is well-formed", () => {
  const { talismans } = talismanDb;
  const categories = new Set(["attributes", "attack", "fight", "stamina"]);
  const kinds = new Set(["charged", "jump", "finisher", "two-handed"]);
  assert.equal(new Set(talismans.map((t) => t.name)).size, talismans.length, "names are unique");
  const groups = new Map();
  for (const t of talismans) {
    assert.ok(categories.has(t.category), `${t.name} category`);
    assert.ok(t.effect && typeof t.effect === "string", `${t.name} effect text`);
    if (t.group) groups.set(t.group, (groups.get(t.group) || 0) + 1);
    for (const [attr, points] of Object.entries(t.stats || {})) {
      assert.ok(["str", "dex", "int", "fai", "arc", "end"].includes(attr) && points > 0, `${t.name} ${attr}`);
    }
    if (t.stamina) assert.ok(t.stamina > 1 && t.stamina < 1.3, `${t.name} stamina`);
    for (const [type, m] of Object.entries(t.damage || {})) assert.ok(Engine.DAMAGE_TYPES.includes(type) && m > 1, `${t.name} ${type}`);
    if (t.attack) assert.ok(kinds.has(t.attack.kind) && t.attack.multiplier > 1, `${t.name} attack`);
    if (t.assumed) assert.ok(t.assumed.multiplier > 1 && t.assumed.share > 0 && t.assumed.share <= 1, `${t.name} assumed`);
    if (t.successive) {
      assert.equal(t.successive.length, 3);
      assert.ok(t.successive.every((m, i) => m > (i ? t.successive[i - 1] : 1)), `${t.name} stages rise`);
    }
    if (t.after) {
      assert.ok(t.after.status.every((s) => Engine.STATUS_TYPES.includes(s)), `${t.name} statuses`);
      assert.ok(t.after.multiplier > 1 && t.after.seconds > 0, `${t.name} after`);
    }
  }
  for (const [group, count] of groups) assert.ok(count >= 2, `group ${group} has more than one version`);
});

test("talisman effects add up", () => {
  const effects = Engine.talismanEffects(
    ["Radagon's Soreseal", "Rotten Winged Sword Insignia", "Millicent's Prosthesis", "Fire Scorpion Charm"].map((n) => talisman.get(n)),
  );
  assert.deepEqual(effects.stats, { str: 5, dex: 10, int: 0, fai: 0, arc: 0, end: 5 });
  assert.deepEqual(effects.damage, { fire: 1.12 });
  // The two successive-attack talismans stack
  effects.successive.forEach((m, i) => near(m, [1.06, 1.08, 1.13][i] * [1.04, 1.06, 1.11][i], 1e-12));
  assert.equal(effects.stamina, 1);

  const stats = Engine.boostedStats({ str: 97, dex: 40, int: 9, fai: 10, arc: 9, end: 25 }, effects);
  assert.deepEqual(stats, { str: 99, dex: 50, int: 9, fai: 10, arc: 9, end: 30 }, "the game caps attributes at 99");

  const lord = Engine.talismanEffects([talisman.get("Lord of Blood's Exultation"), talisman.get("Erdtree's Favor +2")]);
  assert.deepEqual(lord.after, [{ name: "Lord of Blood's Exultation", status: ["bleed"], multiplier: 1.2, seconds: 20 }]);
  assert.equal(lord.stamina, 1.1);
  assert.deepEqual(Engine.talismanEffects([]).after, []);
});

test("attack talismans apply to their kind of attack", () => {
  const families = Object.fromEntries(Engine.attackFamilies(moves("Uchigatana", "1h")).map((f) => [f.id, f]));
  const effects = Engine.talismanEffects(
    ["Axe Talisman", "Claw Talisman", "Twinblade Talisman", "Two-Handed Sword Talisman", "Ritual Sword Talisman"].map((n) => talisman.get(n)),
  );
  const m = (grip, id, step = 0) => Engine.attackMultiplier(effects, grip, families[id], families[id].steps[step]);
  const ritual = 1 + 0.1 * 0.5; // +10% for half the fight
  near(m("1h", "r1"), ritual);
  near(m("1h", "r1", 4), ritual * 1.45, 1e-12, "Twinblade Talisman: the last R1 of the chain");
  near(m("1h", "r2"), ritual, 1e-12, "uncharged heavies get nothing");
  near(m("1h", "charged-r2"), ritual * 1.1);
  near(m("1h", "jump-r1"), ritual * 1.15);
  near(m("2h", "jump-r2"), ritual * 1.15 * 1.15, 1e-12, "Two-Handed Sword Talisman: every two-handed attack");
});

#!/usr/bin/env node
/**
 * Builds data/weapons.json, the weapon database used by the calculator.
 *
 * Input: the regulation export from ThomasJClark/elden-ring-weapon-calculator (MIT licensed),
 * which was extracted from the game's regulation.bin params:
 *   EquipParamWeapon, ReinforceParamWeapon, CalcCorrectGraph, AttackElementCorrectParam,
 *   SpEffectParam (status buildup) and MenuValueTableParam (scaling letters).
 *
 * Output: one weapon per entry, with every infusion of that weapon nested inside it, and the
 * shared param tables the math needs. See README.md for the schema.
 *
 * Usage: node scripts/build-db.mjs [source.json] [out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.argv[2] ?? join(root, "data/source/regulation-vanilla-v1.17.json");
const outPath = process.argv[3] ?? join(root, "data/weapons.json");

const PATCH = "1.17";
const UPSTREAM = {
  repo: "https://github.com/ThomasJClark/elden-ring-weapon-calculator",
  file: "public/regulation-vanilla-v1.17.js",
  commit: "3539d87e446f3b9d5b94157f8a2023e28ffea7d2",
  license: "MIT, Copyright (c) 2022 Tom Clark",
};

// Attack power type ids used by the upstream export
const ATTACK_TYPE_NAMES = {
  0: "physical",
  1: "magic",
  2: "fire",
  3: "lightning",
  4: "holy",
  5: "poison",
  6: "rot",
  7: "bleed",
  8: "frost",
  9: "sleep",
  10: "madness",
  11: "blight",
};
const DAMAGE_TYPES = ["physical", "magic", "fire", "lightning", "holy"];
const ATTRIBUTES = ["str", "dex", "int", "fai", "arc"];
const DEFAULT_DAMAGE_CURVE = 0;
const DEFAULT_STATUS_CURVE = 6;

// In-game order of the Ash of War affinity menu. -1 marks weapons that can't be infused.
const AFFINITIES = [
  [0, "Standard"],
  [1, "Heavy"],
  [2, "Keen"],
  [3, "Quality"],
  [4, "Fire"],
  [5, "Flame Art"],
  [6, "Lightning"],
  [7, "Sacred"],
  [8, "Magic"],
  [9, "Cold"],
  [10, "Poison"],
  [11, "Blood"],
  [12, "Occult"],
  [-1, "Unique"],
];

// EquipParamWeapon.wepType values, listed in roughly the in-game inventory order
const WEAPON_TYPES = [
  [1, "Dagger"],
  [91, "Throwing Blade"],
  [3, "Straight Sword"],
  [93, "Light Greatsword"],
  [5, "Greatsword"],
  [7, "Colossal Sword"],
  [15, "Thrusting Sword"],
  [16, "Heavy Thrusting Sword"],
  [9, "Curved Sword"],
  [11, "Curved Greatsword"],
  [92, "Backhand Blade"],
  [13, "Katana"],
  [94, "Great Katana"],
  [14, "Twinblade"],
  [21, "Hammer"],
  [23, "Great Hammer"],
  [24, "Flail"],
  [17, "Axe"],
  [19, "Greataxe"],
  [25, "Spear"],
  [28, "Great Spear"],
  [29, "Halberd"],
  [31, "Reaper"],
  [39, "Whip"],
  [35, "Fist"],
  [88, "Hand-to-Hand Art"],
  [37, "Claw"],
  [95, "Beast Claw"],
  [41, "Colossal Weapon"],
  [89, "Perfume Bottle"],
  [87, "Torch"],
  [50, "Light Bow"],
  [51, "Bow"],
  [53, "Greatbow"],
  [55, "Crossbow"],
  [56, "Ballista"],
  [57, "Glintstone Staff"],
  [61, "Sacred Seal"],
  [59, "Dual Catalyst"],
  [65, "Small Shield"],
  [67, "Medium Shield"],
  [69, "Greatshield"],
  [90, "Thrusting Shield"],
];

const raw = readFileSync(sourcePath, "utf8");
const src = JSON.parse(raw);

function fail(message) {
  throw new Error(`build-db: ${message}`);
}

// --- Shared param tables -------------------------------------------------------------------

// CalcCorrectGraph: each curve is 5 stages of [statValue, growth (fraction), exponent]
const curves = {};
for (const [id, stages] of Object.entries(src.calcCorrectGraphs)) {
  curves[id] = stages.map((s) => [s.maxVal, s.maxGrowVal, s.adjPt]);
}

// AttackElementCorrectParam: which attributes scale which damage type.
// true = use the weapon's own scaling; a number = the param overrides the scaling value.
const elementCorrect = {};
for (const [id, byType] of Object.entries(src.attackElementCorrects)) {
  const entry = {};
  for (const [typeId, attrs] of Object.entries(byType)) {
    if (attrs && Object.keys(attrs).length) entry[ATTACK_TYPE_NAMES[typeId]] = attrs;
  }
  elementCorrect[id] = entry;
}

// ReinforceParamWeapon: one row per upgrade level
const reinforce = {};
for (const [id, rows] of Object.entries(src.reinforceTypes)) {
  reinforce[id] = rows.map((row) => ({
    attack: DAMAGE_TYPES.map((_, i) => row.attack[i] ?? 0),
    scaling: ATTRIBUTES.map((a) => row.attributeScaling[a] ?? 0),
    statusOffsets: [row.statusSpEffectId1 ?? 0, row.statusSpEffectId2 ?? 0, row.statusSpEffectId3 ?? 0],
  }));
}

// SpEffectParam rows that add status buildup to a weapon
const statusEffects = {};
for (const [id, byType] of Object.entries(src.statusSpEffectParams)) {
  const entry = {};
  for (const [typeId, value] of Object.entries(byType)) {
    if (value) entry[ATTACK_TYPE_NAMES[typeId]] = value;
  }
  statusEffects[id] = entry;
}

// --- Weapons -------------------------------------------------------------------------------

const groups = new Map();
for (const w of src.weapons) {
  if (!groups.has(w.weaponName)) groups.set(w.weaponName, []);
  groups.get(w.weaponName).push(w);
}

const affinityOrder = new Map(AFFINITIES.map(([id], i) => [id, i]));
const weaponTypeIds = new Set(WEAPON_TYPES.map(([id]) => id));

function sameAcross(list, key) {
  const values = new Set(list.map((w) => JSON.stringify(w[key] ?? null)));
  if (values.size !== 1) fail(`"${list[0].weaponName}" has different ${key} across infusions`);
  return list[0][key];
}

function attackTypesOf(w) {
  // Every attack type this infusion can have at any upgrade level
  const types = new Set(w.attack.map(([typeId]) => ATTACK_TYPE_NAMES[typeId]));
  const rows = src.reinforceTypes[w.reinforceTypeId];
  (w.statusSpEffectParamIds ?? []).forEach((spId, slot) => {
    if (!spId) return;
    for (const row of rows) {
      const offset = [row.statusSpEffectId1, row.statusSpEffectId2, row.statusSpEffectId3][slot] ?? 0;
      const sp = src.statusSpEffectParams[spId + offset];
      if (sp) Object.keys(sp).forEach((typeId) => types.add(ATTACK_TYPE_NAMES[typeId]));
    }
  });
  if (w.sorceryTool || w.incantationTool) DAMAGE_TYPES.forEach((t) => types.add(t));
  return types;
}

const weapons = [];
for (const [weaponName, list] of groups) {
  const type = sameAcross(list, "weaponType");
  if (!weaponTypeIds.has(type)) fail(`unknown weapon type ${type} on "${weaponName}"`);
  const url = sameAcross(list, "url");

  const infusions = list
    .slice()
    .sort((a, b) => affinityOrder.get(a.affinityId) - affinityOrder.get(b.affinityId))
    .map((w) => {
      if (!affinityOrder.has(w.affinityId)) fail(`unknown affinity ${w.affinityId} on "${w.name}"`);
      if (!reinforce[w.reinforceTypeId]) fail(`missing reinforce type ${w.reinforceTypeId}`);
      if (!elementCorrect[w.attackElementCorrectId]) fail(`missing element correct ${w.attackElementCorrectId}`);

      const curveIds = {};
      for (const t of attackTypesOf(w)) {
        const typeId = Object.keys(ATTACK_TYPE_NAMES).find((k) => ATTACK_TYPE_NAMES[k] === t);
        const isDamage = DAMAGE_TYPES.includes(t);
        const id = w.calcCorrectGraphIds?.[typeId] ?? (isDamage ? DEFAULT_DAMAGE_CURVE : DEFAULT_STATUS_CURVE);
        if (!curves[id]) fail(`missing curve ${id} on "${w.name}"`);
        curveIds[t] = id;
      }

      const infusion = {
        affinity: w.affinityId,
        name: w.name,
        attack: Object.fromEntries(w.attack.map(([typeId, value]) => [ATTACK_TYPE_NAMES[typeId], value])),
        scaling: Object.fromEntries(w.attributeScaling),
        reinforce: w.reinforceTypeId,
        elementCorrect: w.attackElementCorrectId,
        curves: curveIds,
      };
      if (w.statusSpEffectParamIds?.some(Boolean)) {
        infusion.statusEffects = w.statusSpEffectParamIds.map((id) => id || 0);
        for (const id of infusion.statusEffects) {
          if (id && !statusEffects[id]) fail(`missing status effect ${id} on "${w.name}"`);
        }
      }
      return infusion;
    });

  const weapon = {
    name: weaponName,
    type,
    requirements: sameAcross(list, "requirements"),
  };
  if (sameAcross(list, "dlc")) weapon.dlc = true;
  if (sameAcross(list, "paired")) weapon.paired = true;
  if (sameAcross(list, "sorceryTool")) weapon.sorcery = true;
  if (sameAcross(list, "incantationTool")) weapon.incantation = true;
  weapon.wiki = url === undefined ? `https://eldenring.wiki.gg/wiki/${weaponName.replaceAll(" ", "_")}` : url;
  weapon.infusions = infusions;
  weapons.push(weapon);
}

const db = {
  meta: {
    title: "Elden Ring weapon database",
    patch: PATCH,
    expansion: "Shadow of the Erdtree included",
    weaponCount: weapons.length,
    infusionCount: weapons.reduce((n, w) => n + w.infusions.length, 0),
    source: { ...UPSTREAM, sha256: createHash("sha256").update(raw).digest("hex") },
    builtBy: "scripts/build-db.mjs",
    notes: [
      "attack: base damage at +0. Multiply by reinforce[...].attack for the upgrade level.",
      "scaling: attribute scaling at +0 (0.5 = 50%). Multiply by reinforce[...].scaling.",
      "curves: CalcCorrectGraph id used by each damage type / status effect.",
      "statusEffects: three SpEffectParam slots; add reinforce[...].statusOffsets[slot] for the upgrade level.",
      "Unique weapons (affinity -1) cannot be infused and have a single entry.",
    ],
  },
  affinities: AFFINITIES,
  weaponTypes: WEAPON_TYPES,
  scalingTiers: src.scalingTiers,
  curves,
  elementCorrect,
  reinforce,
  statusEffects,
  weapons,
};

writeFileSync(outPath, JSON.stringify(db));
console.log(
  `Wrote ${relative(process.cwd(), outPath)}: ${db.meta.weaponCount} weapons, ` +
    `${db.meta.infusionCount} weapon/infusion combinations, ` +
    `${(Buffer.byteLength(JSON.stringify(db)) / 1024).toFixed(0)} KB`,
);

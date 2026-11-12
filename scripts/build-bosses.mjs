#!/usr/bin/env node
/**
 * Builds data/bosses.json, the boss database used to rank infusions against a specific boss.
 *
 * Input: data/source/bosses-fextralife.jsonl, one line per boss page of the Elden Ring wiki on
 * Fextralife (eldenring.wiki.fextralife.com), whose combat tables are generated from the game's
 * params by nex3's BossDataExtractor. Each line holds the New Game (NG) numbers of every
 * encounter on that page:
 *
 *   [name, location, hp, defense, [standard, slash, strike, pierce, magic, fire, lightning, holy],
 *    { poison: [thresholds...] | "immune", rot, bleed, frost, sleep, madness }]
 *
 * defense is one number for regular bosses (it is the same for every damage type) or
 * [physical, magic, fire, lightning, holy] for bosses that are built like players (they wear
 * armor). Status thresholds list the buildup needed for the first proc, then for each later proc.
 *
 * Usage: node scripts/build-bosses.mjs [source.jsonl] [out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.argv[2] ?? join(root, "data/source/bosses-fextralife.jsonl");
const outPath = process.argv[3] ?? join(root, "data/bosses.json");

const NEGATION_TYPES = ["standard", "slash", "strike", "pierce", "magic", "fire", "lightning", "holy"];
const DEFENSE_TYPES = ["physical", "magic", "fire", "lightning", "holy"];
const STATUS_TYPES = ["poison", "rot", "bleed", "frost", "sleep", "madness"];

// Share of normal Hemorrhage and Frostbite proc damage that bosses take (Fextralife's
// Hemorrhage and Frostbite pages): most base-game bosses 70%, Mohg 50%, most DLC bosses 50%,
// and a handful of DLC bosses 65%.
const STATUS_DAMAGE_65 = new Set([
  "Chief Bloodfiend",
  "Bayle the Dread",
  "Messmer the Impaler",
  "Metyr, Mother of Fingers",
  "Midra, Lord of Frenzied Flame",
  "Promised Consort Radahn",
  "Rellana, Twin Moon Knight",
]);
const STATUS_DAMAGE_50_BASE = new Set(["Mohg, Lord of Blood"]);

// Cleaner display names for a few entries
const RENAME = {
  "Godskin Duo: Apostle": "Godskin Apostle (Godskin Duo)",
  "Godskin Duo: Noble": "Godskin Noble (Godskin Duo)",
  "God-Devouring Serpent": "Rykard (God-Devouring Serpent)",
};

function fail(message) {
  throw new Error(`build-bosses: ${message}`);
}

function slug(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const pages = readFileSync(sourcePath, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`line ${i + 1} is not JSON: ${error.message}`);
    }
  });

const bosses = [];
for (const page of pages) {
  for (const entry of page.e) {
    const [rawName, location, hp, defense, negation, resist] = entry;
    const name = RENAME[rawName] ?? rawName;
    const where = `${name} (${page.page})`;

    if (!Number.isInteger(hp) || hp <= 0) fail(`${where}: bad hp ${hp}`);
    if (!Array.isArray(negation) || negation.length !== 8 || !negation.every(Number.isFinite)) {
      fail(`${where}: negations must be 8 numbers`);
    }

    let defenses;
    if (typeof defense === "number") {
      defenses = Object.fromEntries(DEFENSE_TYPES.map((t) => [t, defense]));
    } else if (Array.isArray(defense) && defense.length === 5 && defense.every(Number.isFinite)) {
      defenses = Object.fromEntries(DEFENSE_TYPES.map((t, i) => [t, defense[i]]));
    } else {
      fail(`${where}: bad defense ${JSON.stringify(defense)}`);
    }
    for (const value of Object.values(defenses)) if (value < 50 || value > 300) fail(`${where}: odd defense ${value}`);

    const status = {};
    for (const type of STATUS_TYPES) {
      const value = resist[type];
      if (value === undefined || value === "immune") {
        status[type] = null;
      } else if (Array.isArray(value) && value.length > 0 && value.every((n) => Number.isFinite(n) && n > 0)) {
        status[type] = value;
      } else {
        fail(`${where}: bad ${type} resistance ${JSON.stringify(value)}`);
      }
    }

    const dlc = !!page.dlc;
    const statusDamage = dlc
      ? STATUS_DAMAGE_65.has(name)
        ? 0.65
        : 0.5
      : STATUS_DAMAGE_50_BASE.has(name)
        ? 0.5
        : 0.7;

    bosses.push({
      id: "",
      name,
      location,
      dlc,
      hp,
      defense: defenses,
      negation: Object.fromEntries(NEGATION_TYPES.map((t, i) => [t, negation[i]])),
      status,
      statusDamage,
      wiki: `https://eldenring.wiki.fextralife.com/${page.page}`,
    });
  }
}

// Labels and ids: add the location when the same boss is fought in more than one place
const baseName = (name) => name.replace(/\s*\([^)]*\)$/, "");
const locations = new Map();
for (const boss of bosses) {
  const key = baseName(boss.name);
  if (!locations.has(key)) locations.set(key, new Set());
  locations.get(key).add(boss.location);
}
const ids = new Set();
for (const boss of bosses) {
  boss.label = locations.get(baseName(boss.name)).size > 1 ? `${boss.name} — ${boss.location}` : boss.name;
  boss.id = slug(boss.label);
  if (ids.has(boss.id)) fail(`duplicate boss id ${boss.id}`);
  ids.add(boss.id);
}

bosses.sort((a, b) => Number(a.dlc) - Number(b.dlc) || a.label.localeCompare(b.label));

const out = {
  meta: {
    title: "Elden Ring boss database",
    cycle: "New Game (journey 1)",
    bossCount: bosses.length,
    source: {
      site: "https://eldenring.wiki.fextralife.com",
      extractor: "https://github.com/nex3/BossDataExtractor",
      retrieved: "2026-11-11",
    },
    builtBy: "scripts/build-bosses.mjs",
    notes: [
      "defense: flat defense per damage type, compared with attack power to scale damage down.",
      "negation: percent of damage removed per type after defense (negative = takes extra damage).",
      "status: buildup needed for the first proc, then each later proc; null = immune.",
      "statusDamage: share of normal Hemorrhage/Frostbite proc damage this boss takes.",
    ],
  },
  bosses,
};

const json = JSON.stringify(out);
writeFileSync(outPath, json + "\n");
console.log(`Wrote ${relative(process.cwd(), outPath)}: ${bosses.length} bosses, ${(json.length / 1024).toFixed(0)} KB`);

#!/usr/bin/env node
/**
 * Builds data/attacks.json: the basic moveset of every melee weapon, one- and two-handed (light
 * chain, heavies, charged heavies, running, rolling and backstep attacks, jump attacks and guard
 * counters), with each attack's motion values, physical damage type, timing and stamina cost.
 *
 * Sources, both in data/source/:
 *
 *   motion-values.csv  The community "Elden Ring Motion Values and Attack Data" sheet (patch
 *                      1.16): motion values per weapon and attack, one number per hit
 *                      ("50 + 110" is a two-hit attack). It accounts for weapons whose attacks
 *                      hit harder than their class's (Alabaster Lord's Sword, Bloodhound's Fang).
 *   frame-data.json    Frame data read from the game files (patch 1.17.3) by AtomechLLC's
 *                      game-animation-library, trimmed to the attacks used here. It gives each
 *                      attack's physical damage type, its stamina cost and two frames (at 30
 *                      fps): the one from which the next attack can start ("attack" cancel) and
 *                      the one from which you can dodge ("dodge" cancel).
 *
 * Timing per attack (frames at 30 fps):
 *   R1, charged R2, running, rolling, backstep and guard counter: counted from the start of the
 *     attack. Charged heavies include the charge.
 *   R2 (uncharged): counted from the release: the short wind-up before it isn't in the data, so
 *     the calculator adds an estimate.
 *   Jump attacks: the landing's two frames. The time in the air isn't in the data either, so the
 *     calculator adds an estimate.
 *
 * Output: { meta, movesets: [{ "1h": [attack...], "2h": [attack...] }], weapons: { name: index } }
 * with attack = [name, [motion value per hit...], physical type, frames until the next attack,
 * frames until a dodge, stamina cost]; the last three are null where the frame data has no entry
 * for that weapon's animation.
 *
 * Usage:
 *   node scripts/build-attacks.mjs                       build from data/source/
 *   node scripts/build-attacks.mjs --import <frame-data.json> <motion-values.csv>
 *       first refresh data/source/ from fresh downloads: the full elden-ring.json from
 *       github.com/AtomechLLC/game-animation-library/tree/main/frame-data and the sheet's
 *       first tab exported as CSV
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAME_DATA = join(root, "data/source/frame-data.json");
const MOTION_VALUES = join(root, "data/source/motion-values.csv");
const OUT = join(root, "data/attacks.json");

// Attacks kept, in display order. Sheet columns are "<grip> <name>"; frame data names differ
// for uncharged heavies ("R2 1 Release") and split jump attacks into airborne and landing parts.
const ATTACKS = [
  "R1 1", "R1 2", "R1 3", "R1 4", "R1 5", "R1 6",
  "R2 1", "R2 2", "Charged R2 1", "Charged R2 2",
  "Running R1", "Running R2", "Rolling R1", "Backstep R1",
  "Jumping R1", "Jumping R2", "Guard Counter",
];
const GRIPS = ["1h", "2h"];
const MOVE_TYPES = new Set(["light", "heavy", "running", "rolling", "backstep", "jumping", "guard-counter"]);
// Bows and crossbows deal their damage through ammunition, which this calculator doesn't model
const RANGED_CLASSES = new Set(["Light Bow", "Bow", "Greatbow", "Crossbow", "Ballista"]);
const PHYSICAL = new Set(["standard", "slash", "strike", "pierce"]);

function fail(message) {
  throw new Error(`build-attacks: ${message}`);
}

/** A small CSV reader (quoted fields, doubled quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The weapon's own hits in a sheet cell: "100" → [100]; "50 + 110" → [50, 110]. Parentheses hold
 * projectiles, shockwaves and alternatives ("85 + (60 Bullet)", "111 (42 Far)"), which carry
 * damage of their own and aren't counted; a cell with nothing else gives null.
 */
function parseMotionValues(cell) {
  if (!cell || !cell.trim()) return null;
  let text = cell;
  while (/\([^()]*\)/.test(text)) text = text.replace(/\([^()]*\)/g, "");
  const values = text
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) fail(`unreadable motion value "${cell}"`);
  return values.length ? values : null;
}

// ---- import: trim fresh downloads into data/source/ -------------------------------------------

function importSources(frameDataPath, csvPath) {
  const full = JSON.parse(readFileSync(frameDataPath, "utf8"));
  if (full.schema !== "frame-data/1" || full.game?.id !== "elden-ring") fail("not an Elden Ring frame-data/1 file");
  const classes = full.classes
    .filter((c) => !RANGED_CLASSES.has(c.id))
    .map((c) => ({ id: c.id, weapons: c.weapons }));
  const kept = new Set(classes.map((c) => c.id));
  const moves = full.moves
    .filter((m) => kept.has(m.class) && GRIPS.includes(m.grip) && MOVE_TYPES.has(m.type))
    .map((m) => ({ ...m, name: m.name.replace(/^(1h|2h) /, "") }))
    .filter((m) => !/Hangtime|Attack Landing|Feint/.test(m.name))
    .map((m) => ({
      class: m.class,
      grip: m.grip,
      name: m.name,
      type: m.damage?.type ? m.damage.type.toLowerCase() : null,
      mv: m.damage?.mv ?? null,
      attack: m.cancels?.attack ?? null,
      dodge: m.cancels?.dodge ?? null,
      stamina: m.damage?.stamina ?? null,
      weapons: m.weapons,
    }));
  const trimmed = {
    game: { name: full.game.name, version: full.game.version, fps: full.game.fps },
    source: { name: full.source.name, url: full.source.url, retrieved: full.source.retrieved, note: full.source.note },
    repository: "https://github.com/AtomechLLC/game-animation-library/tree/main/frame-data",
    classes,
    moves,
  };
  // One class or move per line keeps diffs readable
  const lines = [
    "{",
    `"game": ${JSON.stringify(trimmed.game)},`,
    `"source": ${JSON.stringify(trimmed.source)},`,
    `"repository": ${JSON.stringify(trimmed.repository)},`,
    `"classes": [\n${classes.map((c) => JSON.stringify(c)).join(",\n")}\n],`,
    `"moves": [\n${moves.map((m) => JSON.stringify(m)).join(",\n")}\n]`,
    "}",
  ];
  writeFileSync(FRAME_DATA, `${lines.join("\n")}\n`);
  writeFileSync(MOTION_VALUES, readFileSync(csvPath, "utf8"));
  console.log(`Imported ${moves.length} moves of ${classes.length} classes and the motion value sheet into data/source/`);
}

// ---- build ------------------------------------------------------------------------------

function build() {
  const frames = JSON.parse(readFileSync(FRAME_DATA, "utf8"));
  const weaponDb = JSON.parse(readFileSync(join(root, "data/weapons.json"), "utf8"));
  const rows = parseCsv(readFileSync(MOTION_VALUES, "utf8"));
  const header = rows[0];
  const col = new Map(header.map((h, i) => [h.trim(), i]));
  if (header[1] !== "Weapon") fail("the sheet's second column should be Weapon");
  const sheet = new Map();
  for (const r of rows.slice(1)) if (r[1] && r[1].trim()) sheet.set(r[1].trim(), r);

  // Weapon name → its class and index in the class's weapon list
  const where = new Map();
  for (const c of frames.classes) c.weapons.forEach((name, i) => where.set(name, { cls: c.id, index: i }));
  const movesByClass = new Map();
  for (const m of frames.moves) {
    if (!movesByClass.has(m.class)) movesByClass.set(m.class, []);
    movesByClass.get(m.class).push(m);
  }

  const ourNames = (weaponDb.weapons || weaponDb).map((w) => w.name);
  if (!ourNames.length) fail("no weapons in data/weapons.json");

  const movesets = [];
  const movesetIndex = new Map();
  const weapons = {};
  const skipped = [];
  let attackCount = 0;
  let fromFrameData = 0;

  for (const name of ourNames) {
    const at = where.get(name);
    const row = sheet.get(name);
    if (!at || !row) {
      skipped.push(name);
      continue;
    }
    // This weapon's moves by grip and name. Each animation's entry lists the weapons that use
    // it, so a weapon appears in exactly one entry per attack.
    const own = new Map();
    for (const m of movesByClass.get(at.cls) || []) {
      if (!m.weapons.includes(at.index)) continue;
      const key = `${m.grip} ${m.name}`;
      if (own.has(key)) fail(`${name} has two "${key}" entries`);
      own.set(key, m);
    }

    const moveset = {};
    for (const grip of GRIPS) {
      const list = [];
      for (const attack of ATTACKS) {
        const jump = attack.startsWith("Jumping");
        const uncharged = /^R2 \d$/.test(attack);
        const move = own.get(`${grip} ${uncharged ? `${attack} Release` : attack}`);
        const landing = jump ? own.get(`${grip} ${attack} Landing`) : null;
        let mvs = col.has(`${grip} ${attack}`) ? parseMotionValues(row[col.get(`${grip} ${attack}`)]) : null;
        if (!mvs && move && move.mv > 0) {
          mvs = [move.mv];
          fromFrameData++;
        }
        if (!mvs) continue;
        // Jump attacks are timed by their landing; everything else by the attack itself
        const timed = jump ? landing : move;
        const next = timed ? timed.attack ?? timed.dodge ?? null : null;
        const exit = timed ? timed.dodge ?? timed.attack ?? null : null;
        const stamina = move?.stamina ?? landing?.stamina ?? null;
        list.push([attack, mvs, move && PHYSICAL.has(move.type) ? move.type : null, next, exit, stamina]);
      }
      // Attacks without a type in the data take the weapon's most common one
      const counts = {};
      for (const a of list) if (a[2]) counts[a[2]] = (counts[a[2]] || 0) + 1;
      const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "standard";
      for (const a of list) if (!a[2]) a[2] = common;
      if (list.length) moveset[grip] = list;
      attackCount += list.length;
    }
    if (!moveset["1h"] && !moveset["2h"]) {
      skipped.push(name);
      continue;
    }
    const key = JSON.stringify(moveset);
    if (!movesetIndex.has(key)) {
      movesetIndex.set(key, movesets.length);
      movesets.push(moveset);
    }
    weapons[name] = movesetIndex.get(key);
  }

  // Spot checks against values confirmed in game data
  const uchigatana = movesets[weapons.Uchigatana]?.["1h"];
  const r1 = uchigatana?.filter((a) => a[0].startsWith("R1 "));
  const expected = [[100, 17, 25, 12], [101, 18, 26, 12], [102, 17, 25, 12], [103, 20, 27, 12], [110, 45, 32, 12]];
  if (JSON.stringify(r1?.map((a) => [a[1][0], a[3], a[4], a[5]])) !== JSON.stringify(expected)) {
    fail("Uchigatana's one-handed R1 chain doesn't match the expected motion values, frames and stamina");
  }
  if (JSON.stringify(movesets[weapons["Serpentbone Blade"]]?.["1h"].find((a) => a[0] === "R2 1")?.[1]) !== "[50,110]") {
    fail("Serpentbone Blade's R2 should hit twice (50 + 110)");
  }

  const out = {
    meta: {
      description:
        "Basic moveset of each melee weapon: [attack, [motion value per hit], physical damage type, frames at 30 fps until the next attack can start, frames until a dodge can start, stamina cost] (the last three null where the frame data has no entry)",
      motionValues: "Elden Ring Motion Values and Attack Data sheet (patch 1.16)",
      motionValuesUrl: "https://docs.google.com/spreadsheets/d/1j4bpTbsnp5Xsgw9TP2xv6d8R4qk0ErpE9r_5LGIDraU/edit#gid=0",
      frameData: `${frames.source.name}, patch ${frames.game.version}, via AtomechLLC game-animation-library`,
      frameDataUrl: frames.repository,
      fps: frames.game.fps,
      timingPatch: frames.game.version,
      weaponCount: Object.keys(weapons).length,
      movesetCount: movesets.length,
    },
    movesets,
    weapons,
  };
  const json = `{\n"meta": ${JSON.stringify(out.meta)},\n"movesets": [\n${movesets.map((m) => JSON.stringify(m)).join(",\n")}\n],\n"weapons": ${JSON.stringify(weapons)}\n}\n`;
  writeFileSync(OUT, json);
  console.log(
    `Wrote ${relative(process.cwd(), OUT)}: ${out.meta.weaponCount} weapons, ${movesets.length} distinct movesets, ` +
      `${attackCount} attacks (${fromFrameData} motion values from the frame data where the sheet had none), ` +
      `${(Buffer.byteLength(json) / 1024).toFixed(0)} KB. No moveset for ${skipped.length}: ${skipped.join(", ")}`,
  );
}

if (process.argv[2] === "--import") {
  if (process.argv.length < 5) fail("usage: --import <frame-data.json> <motion-values.csv>");
  importSources(process.argv[3], process.argv[4]);
}
build();

#!/usr/bin/env node
/**
 * Builds data/attacks.json: the basic moveset of every melee weapon, one- and two-handed (light
 * chain, heavies, charged heavies, running, rolling and backstep attacks, jump attacks and guard
 * counters), with each attack's motion values, physical damage type, timing and stamina cost,
 * and its powerstance attacks (L1 with a weapon of the same type in each hand), with the hand
 * that deals each hit.
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
 *                      the one from which you can dodge ("dodge" cancel). For powerstance
 *                      attacks it also gives the hand of each hit, in order ("LR": left, then
 *                      right), from the library's per-class hitbox files.
 *
 * Timing per attack (frames at 30 fps):
 *   R1, charged R2, running, rolling, backstep and guard counter: counted from the start of the
 *     attack. Charged heavies include the charge.
 *   R2 (uncharged): counted from the release: the short wind-up before it isn't in the data, so
 *     the calculator adds an estimate.
 *   Jump attacks: the landing's two frames. The time in the air isn't in the data either, so the
 *     calculator adds an estimate.
 *
 * Output: { meta, movesets: [{ "1h": [attack...], "2h": [attack...], paired: [attack...] }],
 * weapons: { name: index } } with attack = [name, [motion value per hit...], physical type,
 * frames until the next attack, frames until a dodge, stamina cost]; the last three are null
 * where the frame data has no entry for that weapon's animation. A powerstance attack ("L1 1",
 * "Jumping L1", ...) has a seventh element, the hand of each hit ("LR").
 *
 * Hands: the hitbox files list a hit per behavior judge, and some swings have several (a blade's
 * base and tip), so the list can be longer than the sheet's hits. It is then shortened by
 * merging runs of one hand ("LLRR" → "LR"), and failing that, the sheet's hits alternate between
 * the hands, starting with the first to swing.
 *
 * Usage:
 *   node scripts/build-attacks.mjs                       build from data/source/
 *   node scripts/build-attacks.mjs --import <frame-data.json> <motion-values.csv> <moves dir>
 *       first refresh data/source/ from fresh downloads: the full elden-ring.json from
 *       github.com/AtomechLLC/game-animation-library/tree/main/frame-data, the sheet's first tab
 *       exported as CSV, and a folder with the library's per-class hitbox files
 *       (frame-data/models/elden-ring/moves/<class>.json, e.g. curved-sword.json)
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
// Powerstance attacks: sheet columns "Paired <name>", frame data grip "Paired"
const PAIRED_ATTACKS = ["L1 1", "L1 2", "L1 3", "L1 4", "L1 5", "L1 6", "Running L1", "Rolling L1", "Backstep L1", "Jumping L1"];
const PAIRED_TYPES = new Set(["light", "running", "rolling", "backstep", "jumping"]);
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
  // Parentheses that only group hits, as some powerstance cells do: "(40+40) + (100+100)"
  if (/^[\s\d.+()]+$/.test(cell) && cell.replace(/\([\d.\s+]*\)/g, "").replace(/[\s+]/g, "") === "") {
    return parseMotionValues(cell.replace(/[()]/g, ""));
  }
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

/**
 * The hand of each hit of every powerstance move, from the hitbox files: one hit per behavior
 * judge, in order of its first frame, the right hand first when both start together ("?" where
 * the file doesn't say).
 */
function readHands(movesDir, classIds) {
  const hands = new Map();
  for (const id of classIds) {
    let file;
    try {
      file = JSON.parse(readFileSync(join(movesDir, `${id.toLowerCase().replace(/ /g, "-")}.json`), "utf8"));
    } catch {
      continue; // no file: the class has no powerstance moves
    }
    for (const [moveId, move] of Object.entries(file.moves || {})) {
      const first = new Map();
      for (const hit of move.hits || []) {
        const hand = hit.hand === "L" || hit.hand === "R" ? hit.hand : "?";
        const key = `${hand} ${hit.judge}`;
        if (!first.has(key) || hit.start < first.get(key).start) first.set(key, { hand, start: hit.start });
      }
      if (!first.size) continue;
      const order = [...first.values()].sort((a, b) => a.start - b.start || (a.hand === "R" ? -1 : b.hand === "R" ? 1 : 0));
      hands.set(moveId, order.map((h) => h.hand).join(""));
    }
  }
  return hands;
}

function importSources(frameDataPath, csvPath, movesDir) {
  const full = JSON.parse(readFileSync(frameDataPath, "utf8"));
  if (full.schema !== "frame-data/1" || full.game?.id !== "elden-ring") fail("not an Elden Ring frame-data/1 file");
  const classes = full.classes
    .filter((c) => !RANGED_CLASSES.has(c.id))
    .map((c) => ({ id: c.id, weapons: c.weapons }));
  const kept = new Set(classes.map((c) => c.id));
  const hands = readHands(movesDir, [...kept]);
  const keep = (m) =>
    kept.has(m.class) &&
    ((GRIPS.includes(m.grip) && MOVE_TYPES.has(m.type)) || (m.grip === "Paired" && PAIRED_TYPES.has(m.type)));
  const moves = full.moves
    .filter(keep)
    .map((m) => ({ ...m, name: m.name.replace(/^(1h|2h|Paired) /, "") }))
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
      ...(m.grip === "Paired" ? { hands: hands.get(m.id) ?? null } : {}),
    }));
  const pairedMoves = moves.filter((m) => m.grip === "Paired");
  const withoutHands = pairedMoves.filter((m) => !m.hands).length;
  if (!pairedMoves.length || withoutHands === pairedMoves.length) fail(`no powerstance moves with hands (hitbox files in ${movesDir})`);
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
  console.log(
    `Imported ${moves.length} moves of ${classes.length} classes (${pairedMoves.length} powerstance, ` +
      `${withoutHands} of them without hands) and the motion value sheet into data/source/`,
  );
}

// ---- build ------------------------------------------------------------------------------

/**
 * The hand of each of `count` hits, from the hitbox files' list (see the header): as listed,
 * with runs of one hand merged, or alternating from the first hand to swing. A "?" takes the
 * other hand from the hit before it.
 */
function handsFor(listed, count) {
  let text = "";
  for (const c of listed || "") text += c === "?" ? (text.at(-1) === "R" ? "L" : "R") : c;
  if (text.length === count) return { hands: text, how: "exact" };
  const merged = text.replace(/(.)\1+/g, "$1");
  if (merged.length === count) return { hands: merged, how: "merged" };
  const first = text[0] || "R";
  const other = first === "R" ? "L" : "R";
  return { hands: Array.from({ length: count }, (_, i) => (i % 2 ? other : first)).join(""), how: "alternated" };
}

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
  const handCounts = { exact: 0, merged: 0, alternated: 0 };

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

    // Powerstance attacks, timed like the one-handed ones, with the hand of each hit
    const paired = [];
    for (const attack of PAIRED_ATTACKS) {
      const jump = attack.startsWith("Jumping");
      const move = own.get(`Paired ${attack}`);
      const landing = jump ? own.get(`Paired ${attack} Landing`) : null;
      const mvs = col.has(`Paired ${attack}`) ? parseMotionValues(row[col.get(`Paired ${attack}`)]) : null;
      if (!mvs || !move) continue;
      const timed = jump ? landing : move;
      const next = timed ? timed.attack ?? timed.dodge ?? null : null;
      const exit = timed ? timed.dodge ?? timed.attack ?? null : null;
      const type = PHYSICAL.has(move.type) ? move.type : (moveset["1h"] || moveset["2h"])[0][2];
      const hands = handsFor(move.hands, mvs.length);
      handCounts[hands.how]++;
      paired.push([attack, mvs, type, next, exit, move.stamina ?? landing?.stamina ?? null, hands.hands]);
    }
    if (paired.length) moveset.paired = paired;
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
  const scimitar = movesets[weapons.Scimitar]?.paired;
  if (JSON.stringify(scimitar?.find((a) => a[0] === "L1 1")) !== JSON.stringify(["L1 1", [92, 92], "slash", 26, 28, 12, "LR"])) {
    fail("the Scimitar's powerstance L1 1 should be two 92 hits, left then right");
  }
  const jump = scimitar?.find((a) => a[0] === "Jumping L1");
  if (JSON.stringify([jump?.[1], jump?.[6]]) !== JSON.stringify([[50, 50, 105, 105], "RLRL"])) {
    fail("the Scimitar's powerstance jump attack should hit 50 and 105 with each hand, the right first");
  }

  const out = {
    meta: {
      description:
        "Basic moveset of each melee weapon: [attack, [motion value per hit], physical damage type, frames at 30 fps until the next attack can start, frames until a dodge can start, stamina cost] (the last three null where the frame data has no entry). \"paired\" holds the powerstance attacks (L1 with a weapon of the same type in each hand), with a seventh element: the hand of each hit, R or L",
      motionValues: "Elden Ring Motion Values and Attack Data sheet (patch 1.16)",
      motionValuesUrl: "https://docs.google.com/spreadsheets/d/1j4bpTbsnp5Xsgw9TP2xv6d8R4qk0ErpE9r_5LGIDraU/edit#gid=0",
      frameData: `${frames.source.name}, patch ${frames.game.version}, via AtomechLLC game-animation-library`,
      frameDataUrl: frames.repository,
      fps: frames.game.fps,
      timingPatch: frames.game.version,
      weaponCount: Object.keys(weapons).length,
      movesetCount: movesets.length,
      pairedWeaponCount: Object.values(weapons).filter((i) => movesets[i].paired).length,
    },
    movesets,
    weapons,
  };
  const json = `{\n"meta": ${JSON.stringify(out.meta)},\n"movesets": [\n${movesets.map((m) => JSON.stringify(m)).join(",\n")}\n],\n"weapons": ${JSON.stringify(weapons)}\n}\n`;
  writeFileSync(OUT, json);
  console.log(
    `Wrote ${relative(process.cwd(), OUT)}: ${out.meta.weaponCount} weapons, ${movesets.length} distinct movesets, ` +
      `${attackCount} attacks (${fromFrameData} motion values from the frame data where the sheet had none), ` +
      `powerstance attacks for ${out.meta.pairedWeaponCount} (hands: ${handCounts.exact} as listed, ${handCounts.merged} merged, ${handCounts.alternated} alternated), ` +
      `${(Buffer.byteLength(json) / 1024).toFixed(0)} KB. No moveset for ${skipped.length}: ${skipped.join(", ")}`,
  );
}

if (process.argv[2] === "--import") {
  if (process.argv.length < 6) fail("usage: --import <frame-data.json> <motion-values.csv> <moves dir>");
  importSources(process.argv[3], process.argv[4], process.argv[5]);
}
build();

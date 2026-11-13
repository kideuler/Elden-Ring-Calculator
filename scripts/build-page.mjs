#!/usr/bin/env node
/**
 * Bundles the calculator into self-contained HTML files (no server or network needed except
 * for the optional web fonts):
 *
 *   dist/elden-ring-infusion-calculator.html  a complete page you can open from disk or host anywhere
 *   dist/artifact.html                        the same page without <html>/<head>/<body> wrappers,
 *                                              for hosts that add their own (claude.ai artifacts)
 *
 * Usage: node scripts/build-page.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const template = read("src/page.html");
const db = JSON.parse(read("data/weapons.json"));
const bossDb = JSON.parse(read("data/bosses.json"));
const attackDb = JSON.parse(read("data/attacks.json"));
const talismanDb = JSON.parse(read("data/talismans.json"));
const iconDb = JSON.parse(read("data/icons.json"));
const iconSprite = readFileSync(join(root, "data/icons.webp"));
const { columns, rows } = iconDb.meta;
const parts = {
  STYLES: read("src/styles.css"),
  ENGINE: read("src/engine.js"),
  APP: read("src/app.js"),
  // Inside <script type="application/json"> only "</script" could end the element early
  DATA: JSON.stringify(db).replace(/</g, "\\u003c"),
  BOSSES: JSON.stringify(bossDb).replace(/</g, "\\u003c"),
  // Movesets without the meta block, which only documents the file
  ATTACKS: JSON.stringify({ movesets: attackDb.movesets, weapons: attackDb.weapons }).replace(/</g, "\\u003c"),
  // Talismans without the notes that only document the file
  TALISMANS: JSON.stringify({ talismans: talismanDb.talismans }).replace(/</g, "\\u003c"),
  TALISMAN_COUNT: String(talismanDb.talismans.length),
  // Icons: the sprite goes into one CSS rule as a data URI; the page gets each item's cell
  ICON_SPRITE: iconSprite.toString("base64"),
  ICON_COUNT: String(Object.keys(iconDb.weapons).length + Object.keys(iconDb.talismans).length),
  ICON_COLUMNS: String(columns),
  ICON_ROWS: String(rows),
  // background-position percentages run from the first cell (0%) to the last (100%)
  ICON_X_STEPS: String(Math.max(1, columns - 1)),
  ICON_Y_STEPS: String(Math.max(1, rows - 1)),
  ICONS: JSON.stringify({ columns, weapons: iconDb.weapons, talismans: iconDb.talismans }).replace(/</g, "\\u003c"),
  PATCH: db.meta.patch,
  WEAPON_COUNT: String(db.meta.weaponCount),
  BOSS_COUNT: String(bossDb.meta.bossCount),
  MOVESET_COUNT: String(attackDb.meta.weaponCount),
  TIMING_PATCH: attackDb.meta.timingPatch,
  // The upstream MIT notice travels with the embedded data, inside an HTML comment
  DATA_LICENSE: read("data/source/LICENSE-upstream.txt").trim(),
};

for (const key of ["STYLES", "ENGINE", "APP"]) {
  if (/<\/(script|style)/i.test(parts[key])) throw new Error(`${key} contains a closing script/style tag`);
}
if (parts.DATA_LICENSE.includes("--")) throw new Error("DATA_LICENSE can't contain -- inside an HTML comment");

// A replacer function keeps "$&"-style patterns in the code from being interpreted
const page = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
  if (!(key in parts)) throw new Error(`Unknown placeholder ${match}`);
  return parts[key];
});

const [head, body] = page.split("<!--BODY-->");
if (body === undefined) throw new Error("src/page.html is missing the <!--BODY--> marker");

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
const fragment = `${head.trim()}\n${body.trim()}\n`;

mkdirSync(join(root, "dist"), { recursive: true });
const outputs = [
  ["dist/elden-ring-infusion-calculator.html", standalone],
  ["dist/artifact.html", fragment],
];
for (const [file, content] of outputs) {
  writeFileSync(join(root, file), content);
  console.log(`Wrote ${relative(process.cwd(), join(root, file))} (${(Buffer.byteLength(content) / 1024).toFixed(0)} KB)`);
}

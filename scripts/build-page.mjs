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
const parts = {
  STYLES: read("src/styles.css"),
  ENGINE: read("src/engine.js"),
  APP: read("src/app.js"),
  // Inside <script type="application/json"> only "</script" could end the element early
  DATA: JSON.stringify(db).replace(/</g, "\\u003c"),
  PATCH: db.meta.patch,
  WEAPON_COUNT: String(db.meta.weaponCount),
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

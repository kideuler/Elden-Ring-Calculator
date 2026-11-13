// Run with: node --test tests/icons.test.mjs
// The icon sprite and its index: every weapon and talisman has its own cell, inside the sprite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const icons = JSON.parse(read("data/icons.json"));
const weapons = JSON.parse(read("data/weapons.json")).weapons;
const talismans = JSON.parse(read("data/talismans.json")).talismans;

/** Width and height of a WebP image, read from its header */
function webpSize(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

test("the sprite holds one cell per weapon and talisman", () => {
  const { cell, columns, rows } = icons.meta;
  assert.deepEqual(webpSize(read("data/icons.webp")), { width: columns * cell, height: rows * cell });
  assert.equal(cell % 16, 0, "cells line up with WebP's 16-pixel blocks, so no icon bleeds into the next");

  for (const w of weapons) assert.ok(Number.isInteger(icons.weapons[w.name]), `${w.name} has an icon`);
  for (const t of talismans) assert.ok(Number.isInteger(icons.talismans[t.name]), `${t.name} has an icon`);
  assert.equal(Object.keys(icons.weapons).length, weapons.length, "no icons for weapons the calculator doesn't have");
  assert.equal(Object.keys(icons.talismans).length, talismans.length, "no icons for talismans the calculator doesn't have");
  assert.deepEqual(icons.missing, []);

  const cells = [...Object.values(icons.weapons), ...Object.values(icons.talismans)];
  assert.equal(new Set(cells).size, cells.length, "each item has a cell of its own");
  for (const c of cells) assert.ok(c >= 0 && c < columns * rows, `cell ${c} is inside the sprite`);
});

test("each icon comes from its item's own wiki page", () => {
  assert.equal(icons.files["Uchigatana"], "ER Icon weapon Uchigatana.png");
  assert.equal(icons.files["Harp Bow"], "ER Icon weapon Harp Bow.png", "an image parameter inline after others");
  assert.equal(icons.files["Beast Claw"], "ER Icon Weapon Beast Claw.png", "the weapon's page, not the disambiguation page");
  assert.equal(icons.files["Claw Talisman"], "Talisman claw talisman.png");
  assert.equal(icons.files["Viridian Amber Medallion +3"], "ER Icon Talisman Viridian Amber Medallion +3.png");
  for (const [name, file] of Object.entries(icons.files)) assert.match(file, /\.(png|webp|jpe?g)$/i, `${name}: ${file}`);
});

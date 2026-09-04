/**
 * Renders the PWA icon set from public/icon-source.svg.
 *
 * The PNGs are committed, so neither `next build` nor the Docker build depends
 * on sharp being able to rasterize at build time — this script only runs when
 * the artwork changes: `node scripts/generate-icons.mjs`.
 *
 * Three shapes, because the platforms disagree:
 *  - icon-192/512.png  manifest `purpose: "any"` — full bleed, the OS crops
 *  - icon-maskable-512 manifest `purpose: "maskable"` — Android's adaptive mask
 *    cuts to a circle inscribed in the inner 80%, so the drop is scaled into
 *    that safe zone and the rest is flat background
 *  - apple-touch-icon  iOS ignores manifest icons entirely; without this file a
 *    home-screen install shows a screenshot thumbnail instead of an icon
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "public", "icon-source.svg");
const PUBLIC = path.join(ROOT, "public");
const ICONS = path.join(PUBLIC, "icons");

/** Keep in sync with --background in src/app/globals.css (and manifest.ts). */
const BACKGROUND = "#0f111c";

/** Fraction of the canvas the artwork may occupy inside a maskable icon. */
const SAFE_ZONE = 0.8;

const svg = readFileSync(SOURCE);

async function render(size) {
  return sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Artwork shrunk into the safe zone, padded back out with flat background.
 *
 * No .resize() after .extend(): sharp runs resize BEFORE extend within one
 * pipeline whatever the call order, so chaining both silently produced a
 * 614px icon from a 512px request. The padding is derived so that
 * inner + 2*pad lands exactly on `size` instead.
 */
async function renderMaskable(size) {
  const pad = Math.round((size * (1 - SAFE_ZONE)) / 2);
  const inner = size - 2 * pad;
  return sharp(await render(inner))
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BACKGROUND })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  mkdirSync(ICONS, { recursive: true });

  const outputs = [
    [path.join(ICONS, "icon-192.png"), await render(192)],
    [path.join(ICONS, "icon-512.png"), await render(512)],
    [path.join(ICONS, "icon-maskable-512.png"), await renderMaskable(512)],
    // flattened: iOS draws no transparency and would fill it black
    [
      path.join(PUBLIC, "apple-touch-icon.png"),
      await sharp(await render(180)).flatten({ background: BACKGROUND }).png({ compressionLevel: 9 }).toBuffer(),
    ],
  ];

  for (const [file, buffer] of outputs) {
    writeFileSync(file, buffer);
    console.log(`${path.relative(ROOT, file)} — ${(buffer.length / 1024).toFixed(1)} kB`);
  }
}

await main();

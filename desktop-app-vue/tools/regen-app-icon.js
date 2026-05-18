#!/usr/bin/env node
/**
 * Regenerate app icons from `assets/icon.png`.
 *
 * The original master had ~30% transparent padding around the circular logo,
 * so the tray/taskbar icon looked tiny inside its slot. This trims the
 * transparent edges, applies a small bleed, and rebuilds the multi-resolution
 * `assets/icon.ico` (7 layers: 16/24/32/48/64/128/256) plus syncs the master
 * PNG used by Electron and the web shell.
 *
 * Run from anywhere:
 *   node desktop-app-vue/tools/regen-app-icon.js
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default || require("png-to-ico");

const ROOT = path.resolve(__dirname, "..");
const SRC_PNG = path.join(ROOT, "assets/icon.png");
const OUT_PNG_ASSETS = path.join(ROOT, "assets/icon.png");
const OUT_PNG_PUBLIC = path.join(ROOT, "public/icon.png");
const OUT_ICO = path.join(ROOT, "assets/icon.ico");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// Source artwork has asymmetric bbox (~12% wider than tall — TT flourishes
// extend horizontally past the circle). Squaring the canvas pads the shorter
// dim, so any extra bleed becomes pure whitespace on top/bottom and the icon
// reads "small" next to square competitors (WeChat etc). Use 0 bleed: longer
// dim hits canvas edge (max visible fill), shorter dim still has natural
// padding from squaring. Windows tray/taskbar don't apply a circular mask so
// edge-AA buffer isn't needed.
const BLEED_RATIO = 0;
const ALPHA_THRESHOLD = 16;

async function findOpaqueBBox(pngPath) {
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const { width, height, channels } = meta;
  if (channels !== 4) {
    throw new Error(
      `source PNG must have alpha channel (got ${channels} channels)`,
    );
  }
  const raw = await img.raw().toBuffer();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = raw[(y * width + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }
  if (maxX < 0) {
    throw new Error("source PNG is fully transparent");
  }
  return { width, height, minX, minY, maxX, maxY };
}

async function main() {
  if (!fs.existsSync(SRC_PNG)) {
    throw new Error(`source not found: ${SRC_PNG}`);
  }

  const bbox = await findOpaqueBBox(SRC_PNG);
  const cropW = bbox.maxX - bbox.minX + 1;
  const cropH = bbox.maxY - bbox.minY + 1;
  const cropSide = Math.max(cropW, cropH);
  const bleed = Math.round(cropSide * BLEED_RATIO);
  const canvasSide = cropSide + bleed * 2;
  const offsetX = Math.floor((canvasSide - cropW) / 2);
  const offsetY = Math.floor((canvasSide - cropH) / 2);

  const fillBefore = (cropSide / Math.min(bbox.width, bbox.height)) * 100;
  console.log(`source: ${bbox.width}x${bbox.height}`);
  console.log(
    `opaque bbox: x=${bbox.minX}..${bbox.maxX} (w=${cropW}), ` +
      `y=${bbox.minY}..${bbox.maxY} (h=${cropH})`,
  );
  console.log(`fill ratio before: ${fillBefore.toFixed(1)}%`);
  console.log(
    `tightened canvas: ${canvasSide}x${canvasSide} (bleed=${bleed}px each side)`,
  );

  const cropped = await sharp(SRC_PNG)
    .extract({
      left: bbox.minX,
      top: bbox.minY,
      width: cropW,
      height: cropH,
    })
    .toBuffer();

  const masterPng = await sharp({
    create: {
      width: canvasSide,
      height: canvasSide,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: cropped, left: offsetX, top: offsetY }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(OUT_PNG_ASSETS, masterPng);
  fs.writeFileSync(OUT_PNG_PUBLIC, masterPng);
  console.log(
    `wrote master PNG: ${path.relative(ROOT, OUT_PNG_ASSETS)} ` +
      `(${canvasSide}x${canvasSide}, ${masterPng.length} bytes)`,
  );

  const layerBuffers = [];
  for (const size of ICO_SIZES) {
    let pipeline = sharp(masterPng).resize(size, size, {
      kernel: "lanczos3",
    });
    // Small layers benefit from a touch of sharpening to keep thin strokes
    // legible after downscale.
    if (size <= 32) {
      pipeline = pipeline.sharpen({ sigma: 0.6 });
    }
    const buf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    layerBuffers.push(buf);
    console.log(`  layer ${size}x${size}: ${buf.length} bytes`);
  }

  const ico = await pngToIco(layerBuffers);
  fs.writeFileSync(OUT_ICO, ico);
  console.log(
    `wrote ICO: ${path.relative(ROOT, OUT_ICO)} ` +
      `(${ico.length} bytes, ${ICO_SIZES.length} layers)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

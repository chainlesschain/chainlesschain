#!/usr/bin/env node
/**
 * Sync web-panel/dist → packages/cli/src/assets/web-panel/
 *
 * `cc ui` serves the web panel from a copy bundled inside the CLI package
 * (so `npm install -g chainlesschain` ships the panel without needing a
 * separate build step). When web-panel/dist is rebuilt, that bundled
 * copy goes stale unless we sync — silent drift bit us during v0.5
 * shipping (cc ui showed the previous bundle, MTC menu invisible).
 *
 * This runs in postbuild, replaces the bundled assets/ wholesale, and
 * copies over index.html (which carries the chunk-hash references).
 *
 * Cross-platform: pure Node, no shell.
 */

import { existsSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webPanelRoot = resolve(__dirname, "..");
const distDir = join(webPanelRoot, "dist");
const cliTarget = resolve(
  webPanelRoot,
  "..",
  "cli",
  "src",
  "assets",
  "web-panel",
);

function logStep(msg) {
  // eslint-disable-next-line no-console
  console.log(`[sync-dist] ${msg}`);
}

function ensureDist() {
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `dist/ not built — expected ${indexPath}. Run \`npm run build\` first.`,
    );
  }
  return indexPath;
}

function ensureTarget() {
  if (!existsSync(cliTarget)) {
    mkdirSync(cliTarget, { recursive: true });
  }
}

function readEntryChunk(indexHtml) {
  const html = readFileSync(indexHtml, "utf-8");
  const match = html.match(/index-[\w-]+\.js/);
  return match ? match[0] : "(unknown)";
}

function syncAssets() {
  const targetAssets = join(cliTarget, "assets");
  if (existsSync(targetAssets)) {
    rmSync(targetAssets, { recursive: true, force: true });
  }
  cpSync(join(distDir, "assets"), targetAssets, { recursive: true });
}

function syncIndexHtml() {
  cpSync(join(distDir, "index.html"), join(cliTarget, "index.html"));
}

function main() {
  const indexPath = ensureDist();
  const entry = readEntryChunk(indexPath);
  ensureTarget();
  logStep(`source: ${distDir}`);
  logStep(`target: ${cliTarget}`);
  logStep(`entry chunk: ${entry}`);
  syncAssets();
  syncIndexHtml();
  logStep("synced — cc ui will pick this up on next start");
}

try {
  main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[sync-dist] failed: ${err.message}`);
  process.exit(1);
}

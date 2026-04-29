/**
 * Phase 1.4 path-math validation — catches R1 (path arithmetic mismatch
 * between web-shell loaders and vendor script) without needing a real
 * `npm run make:win`. R2 (asar fs shim ↔ Node ESM URL loader) and R4
 * (asar unpack glob coverage) can only be validated by actual packaging.
 *
 * What this verifies, end-to-end:
 *   1. Each web-shell loader's relative path constant points at a sibling
 *      `packages/...` location (from `<buildPath>/dist/main/web-shell/`).
 *   2. The vendor script's dry-run output contains a file at exactly that
 *      sibling location — so when forge runs vendorWebShellInto(buildPath)
 *      followed by an asar pack with the `packages/**` unpack glob, the
 *      web-shell loaders' `pathToFileURL(path.resolve(__dirname, REL))`
 *      lands on a real on-disk file in `app.asar.unpacked/packages/...`.
 *
 * If this test fails, either the loader constant changed without
 * updating the vendor exclusions, or the vendor stopped copying a path
 * the loader needs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vendorWebShellInto } from "../../../scripts/prepare-web-shell-vendor.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WEB_SHELL_DIR = path.join(
  REPO_ROOT,
  "desktop-app-vue",
  "src",
  "main",
  "web-shell",
);

/**
 * Simulated `__dirname` of each web-shell loader inside a packaged app.
 * In dev: `desktop-app-vue/src/main/web-shell/...`
 * In prod (after build:main + forge): `<buildPath>/dist/main/web-shell/...`
 *
 * Both have the same depth from `<root>` (4 segments), so the loaders'
 * `../../../../packages/...` constant works in both — IF the vendor put
 * `packages/...` at `<buildPath>/packages/...`.
 */
function simulatedPackagedDirname(buildPath, loaderRelDir = "") {
  return path.join(buildPath, "dist", "main", "web-shell", loaderRelDir);
}

/**
 * Extract a single-quoted/double-quoted string-literal constant from a
 * source file. Returns the literal content (without quotes).
 */
function extractStringConstant(source, name) {
  // Matches:  const NAME = "value";   or:  const NAME =\n  "value";
  const re = new RegExp(
    `const\\s+${name}\\s*=\\s*\\n?\\s*["']([^"']+)["']`,
    "m",
  );
  const m = source.match(re);
  if (!m) {
    throw new Error(`could not find string const "${name}" in source`);
  }
  return m[1];
}

const LOADERS = [
  {
    file: "web-ui-loader.js",
    constName: "WEB_UI_SERVER_REL",
    expectedTail: "packages/cli/src/lib/web-ui-server.js",
  },
  {
    file: "ws-cli-loader.js",
    constName: "WS_SERVER_REL",
    expectedTail: "packages/cli/src/gateways/ws/ws-server.js",
  },
  {
    file: "handlers/skill-list-handler.js",
    constName: "SKILL_LOADER_REL",
    expectedTail: "packages/cli/src/lib/skill-loader.js",
    relDir: "handlers",
  },
];

describe("Phase 1.4 path math (loader REL ↔ vendor layout)", () => {
  // Decision A (2026-04-30): vendor target is path.join(buildPath, "..").
  // In a packaged app `buildPath` corresponds to Resources/app/ and its
  // parent is Resources/. Loaders' 4-up REL from `<buildPath>/dist/main/
  // web-shell/` lands at parent of buildPath = Resources/, where
  // packages/ live. Fixture mirrors this layout: a `resourcesRoot` dir
  // that contains a child `app/` dir; vendor goes into resourcesRoot.
  let resourcesRoot;
  let tempBuildPath;

  beforeAll(() => {
    resourcesRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "phase14-resources-"),
    );
    tempBuildPath = path.join(resourcesRoot, "app");
    fs.mkdirSync(tempBuildPath, { recursive: true });
    vendorWebShellInto(resourcesRoot, { dryRun: false, log: () => {} });
  }, 30000);

  afterAll(() => {
    if (resourcesRoot && fs.existsSync(resourcesRoot)) {
      fs.rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });

  it.each(LOADERS)(
    "$file's $constName resolves to a real vendored file at $expectedTail",
    ({ file, constName, expectedTail, relDir = "" }) => {
      const loaderPath = path.join(WEB_SHELL_DIR, file);
      const source = fs.readFileSync(loaderPath, "utf-8");
      const rel = extractStringConstant(source, constName);

      // Sanity: the constant should still be a 4-up (or 5-up for handlers/)
      // hop into packages/. If the loader moved or the path got refactored
      // and we forgot to update the vendor, this is where it surfaces.
      expect(rel.startsWith("../")).toBe(true);
      expect(rel).toContain("packages/");

      // Resolve as the loader would in a packaged app.
      const simulatedDirname = simulatedPackagedDirname(tempBuildPath, relDir);
      const resolved = path.resolve(simulatedDirname, rel);

      // The resolved path must be a real file in the vendor output.
      expect(fs.existsSync(resolved)).toBe(true);
      // And it should match what the loader expects (substring check).
      expect(resolved.replace(/\\/g, "/")).toContain(expectedTail);
    },
  );

  it("the web-panel SPA index.html is reachable at <resources>/packages/web-panel/dist/", () => {
    // web-shell-bootstrap explicitly passes staticDir resolved from
    // web-ui-loader's REL constant (4-up from <buildPath>/dist/main/
    // web-shell = resourcesRoot). The vendored copy must live there.
    const indexHtml = path.join(
      resourcesRoot,
      "packages",
      "web-panel",
      "dist",
      "index.html",
    );
    expect(fs.existsSync(indexHtml)).toBe(true);
  });

  it("the vendored cli/src/gateways/ws/message-dispatcher.js (closure dep) exists", () => {
    // ws-server.js imports message-dispatcher (sibling). If our vendor
    // exclude rules ever drop it, web-shell startup explodes.
    const dispatcher = path.join(
      resourcesRoot,
      "packages",
      "cli",
      "src",
      "gateways",
      "ws",
      "message-dispatcher.js",
    );
    expect(fs.existsSync(dispatcher)).toBe(true);
  });

  it("the vendored cli/src/runtime/contracts/task-record.js (cross-tree dep) exists", () => {
    // ws-server.js imports `../../runtime/contracts/task-record.js`. The
    // vendor must include the runtime/ subtree, not just gateways/ws/.
    const taskRecord = path.join(
      resourcesRoot,
      "packages",
      "cli",
      "src",
      "runtime",
      "contracts",
      "task-record.js",
    );
    expect(fs.existsSync(taskRecord)).toBe(true);
  });

  it("the deliberate exclude (assets/web-panel) is NOT vendored", () => {
    const excluded = path.join(
      resourcesRoot,
      "packages",
      "cli",
      "src",
      "assets",
      "web-panel",
    );
    expect(fs.existsSync(excluded)).toBe(false);
  });
});

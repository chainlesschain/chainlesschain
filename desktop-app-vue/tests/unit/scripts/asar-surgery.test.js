/**
 * asar-surgery unit + integration tests.
 *
 * Uses real fs + real @electron/asar against a tmp fixture (vitest forks
 * pool can't mock Node built-ins reliably — see .claude/rules/testing.md).
 * The tmp fixture is small enough that this also doubles as the
 * integration test for the surgery happy path.
 *
 * What we cover:
 *   - no-asar layout (resources/app/ instead of resources/app.asar) → no-op
 *   - happy path: extract → inject 4 pkgs → repack → verify entries present
 *   - source-pkg missing → throws (build-time guard, not silent broken ship)
 *   - dst pkg already present (walker placed it after all) → overwritten
 *   - existing app.asar.unpacked/ contents are preserved through repack
 *   - .node files matching unpack glob land in app.asar.unpacked/, not asar
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import asar from "@electron/asar";
import {
  runSurgery,
  WALKER_DROPPED_PKGS,
} from "../../../scripts/asar-surgery.js";

let tmp;

function writeAt(absPath, body) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, body, "utf-8");
  return absPath;
}

/**
 * Build a tiny "src" tree, pack it as resources/app.asar, return the
 * appOutDir path. Mimics what electron-builder's walker would have produced
 * BEFORE surgery — i.e. the 4 walker-dropped pkgs are NOT present (or are
 * only nested under their parents, which our fixture skips for clarity).
 */
async function makeAppOutDirWithAsar({
  unpackedFiles = {},
  preloadedTopLevelPkg = null,
} = {}) {
  const stage = path.join(tmp, "stage");
  fs.mkdirSync(stage, { recursive: true });
  // Minimal ship contents.
  writeAt(path.join(stage, "package.json"), '{"name":"chainlesschain"}');
  writeAt(path.join(stage, "dist/main.js"), "// shipped main\n");
  writeAt(
    path.join(stage, "node_modules/some-pkg/package.json"),
    '{"name":"some-pkg","main":"index.js"}',
  );
  writeAt(
    path.join(stage, "node_modules/some-pkg/index.js"),
    "module.exports={};\n",
  );
  // Optionally pre-place one of the walker-dropped packages so we exercise
  // the "dst already exists, overwrite" branch.
  if (preloadedTopLevelPkg) {
    writeAt(
      path.join(stage, `node_modules/${preloadedTopLevelPkg}/package.json`),
      `{"name":"${preloadedTopLevelPkg}","stale":true}`,
    );
  }

  const appOutDir = path.join(tmp, "win-unpacked");
  const resourcesDir = path.join(appOutDir, "resources");
  fs.mkdirSync(resourcesDir, { recursive: true });

  const asarPath = path.join(resourcesDir, "app.asar");
  await asar.createPackage(stage, asarPath);

  // Walker-style sibling app.asar.unpacked/ for caller-supplied files.
  if (Object.keys(unpackedFiles).length) {
    const unpackedDir = path.join(resourcesDir, "app.asar.unpacked");
    for (const [rel, body] of Object.entries(unpackedFiles)) {
      const full = path.join(unpackedDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
  }

  // Cleanup intermediate stage so it's not confused with resources/.
  fs.rmSync(stage, { recursive: true, force: true });

  return appOutDir;
}

/**
 * Build a fake desktop-app-vue/node_modules/ that contains the 4 walker-dropped
 * pkgs as plain directories (no symlinks), each with a package.json + index.js.
 */
function makeSourceNodeModules() {
  const sourceNm = path.join(tmp, "src-node-modules");
  for (const pkgName of WALKER_DROPPED_PKGS) {
    const pkgDir = path.join(sourceNm, pkgName);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: pkgName, version: "1.0.0", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(pkgDir, "index.js"),
      `// ${pkgName}\nmodule.exports = { name: "${pkgName}" };\n`,
    );
  }
  return sourceNm;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asar-surgery-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

describe("asar-surgery", () => {
  it("no-op when appOutDir lacks resources/app.asar (asar:false layout)", async () => {
    // resources/app/ exists, no app.asar.
    const appOutDir = path.join(tmp, "win-unpacked");
    fs.mkdirSync(path.join(appOutDir, "resources", "app"), { recursive: true });
    const sourceNm = makeSourceNodeModules();

    // Should NOT throw, NOT touch anything.
    await expect(runSurgery({ appOutDir, sourceNm })).resolves.toBeUndefined();

    // Directory still empty (we never created an asar).
    expect(fs.existsSync(path.join(appOutDir, "resources", "app.asar"))).toBe(
      false,
    );
  });

  it("injects 4 walker-dropped pkgs at top-level node_modules/ in repacked asar", async () => {
    const appOutDir = await makeAppOutDirWithAsar();
    const sourceNm = makeSourceNodeModules();

    await runSurgery({ appOutDir, sourceNm });

    const asarPath = path.join(appOutDir, "resources", "app.asar");
    const entries = asar.listPackage(asarPath, {});
    // asar listPackage emits OS-native path separators (`\` on Windows).
    // Normalize to POSIX so cross-platform assertions work.
    const norm = entries.map((e) => e.split(path.sep).join("/"));
    for (const pkgName of WALKER_DROPPED_PKGS) {
      expect(
        norm.includes(`/node_modules/${pkgName}/package.json`),
        `expected ${pkgName} top-level package.json in repacked asar`,
      ).toBe(true);
      expect(norm.includes(`/node_modules/${pkgName}/index.js`)).toBe(true);
    }
    // Pre-existing pkg is preserved.
    expect(norm.includes("/node_modules/some-pkg/package.json")).toBe(true);
  });

  it("throws when a source pkg is missing from desktop-app-vue/node_modules", async () => {
    const appOutDir = await makeAppOutDirWithAsar();
    const sourceNm = makeSourceNodeModules();
    // Sabotage: remove one of the 4 expected source pkgs.
    fs.rmSync(path.join(sourceNm, WALKER_DROPPED_PKGS[1]), {
      recursive: true,
      force: true,
    });

    await expect(runSurgery({ appOutDir, sourceNm })).rejects.toThrow(
      /source missing/i,
    );
  });

  it("overwrites a pre-existing dst pkg (walker placed it after all)", async () => {
    // Pre-place call-bind-apply-helpers with stale contents in the asar.
    const stale = WALKER_DROPPED_PKGS[0];
    const appOutDir = await makeAppOutDirWithAsar({
      preloadedTopLevelPkg: stale,
    });
    const sourceNm = makeSourceNodeModules();

    await runSurgery({ appOutDir, sourceNm });

    const asarPath = path.join(appOutDir, "resources", "app.asar");
    // Extract just the package.json and check it's the FRESH one (no "stale" field).
    // asar.extractFile expects OS-native path separator on Windows, POSIX
    // on others. path.join handles that for us.
    const buf = asar.extractFile(
      asarPath,
      path.join("node_modules", stale, "package.json"),
    );
    const json = JSON.parse(buf.toString("utf-8"));
    expect(json.name).toBe(stale);
    expect(json.version).toBe("1.0.0");
    expect(json.stale).toBeUndefined();
  });

  it("preserves existing app.asar.unpacked/ contents through repack", async () => {
    const appOutDir = await makeAppOutDirWithAsar({
      unpackedFiles: {
        "node_modules/some-native/binding.node": "FAKE_NODE_BINARY",
      },
    });
    const sourceNm = makeSourceNodeModules();

    await runSurgery({ appOutDir, sourceNm });

    // .node files match the unpack glob, so they should still be in
    // app.asar.unpacked/ after repack (NOT inside app.asar).
    const unpackedFile = path.join(
      appOutDir,
      "resources",
      "app.asar.unpacked",
      "node_modules",
      "some-native",
      "binding.node",
    );
    expect(fs.existsSync(unpackedFile)).toBe(true);
    expect(fs.readFileSync(unpackedFile, "utf-8")).toBe("FAKE_NODE_BINARY");
  });

  it("verification step throws if a walker-dropped pkg fails to land", async () => {
    // Set up a valid run, then sabotage: monkey-patch the source pkg's
    // package.json to a non-package (no top-level package.json file). The
    // surgery cpSync still copies the dir but if we delete package.json from
    // the source the verification check (which looks for /node_modules/X/package.json)
    // should fail.
    const appOutDir = await makeAppOutDirWithAsar();
    const sourceNm = makeSourceNodeModules();
    const sabotaged = WALKER_DROPPED_PKGS[2];
    fs.rmSync(path.join(sourceNm, sabotaged, "package.json"), { force: true });

    await expect(runSurgery({ appOutDir, sourceNm })).rejects.toThrow(
      /VERIFICATION FAILED/,
    );
    // The error should name exactly the sabotaged pkg.
    await expect(runSurgery({ appOutDir, sourceNm })).rejects.toThrow(
      new RegExp(sabotaged),
    );
  });

  it("removes the intermediate stage dir on success", async () => {
    const appOutDir = await makeAppOutDirWithAsar();
    const sourceNm = makeSourceNodeModules();

    await runSurgery({ appOutDir, sourceNm });

    expect(
      fs.existsSync(path.join(appOutDir, "resources", ".asar-stage")),
    ).toBe(false);
  });

  it("declared WALKER_DROPPED_PKGS list is exactly the 4 we expect", () => {
    expect(WALKER_DROPPED_PKGS).toEqual([
      "call-bind-apply-helpers",
      "side-channel-list",
      "side-channel-map",
      "side-channel-weakmap",
    ]);
  });
});

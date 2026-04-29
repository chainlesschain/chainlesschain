/**
 * prepare-web-shell-vendor unit tests — Phase 1.4 prep.
 *
 * The script copies real `packages/cli/src` + `packages/web-panel/dist`
 * trees, so these tests run against the actual repo content (no fixture
 * indirection) but write to a unique temp directory each test, cleaned
 * up afterwards. Idempotency, exclude rules, dry-run, and known-file
 * presence are all asserted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  vendorWebShellInto,
  REPO_ROOT,
  CLI_SRC,
  WEB_PANEL_DIST,
} from "../../../scripts/prepare-web-shell-vendor.js";

let tempBuildPath;

function silentLog() {
  /* swallow vendor logs during tests */
}

beforeEach(() => {
  tempBuildPath = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-test-"));
});

afterEach(() => {
  if (tempBuildPath && fs.existsSync(tempBuildPath)) {
    fs.rmSync(tempBuildPath, { recursive: true, force: true });
  }
});

describe("vendorWebShellInto", () => {
  it("exposes the expected REPO_ROOT / CLI_SRC / WEB_PANEL_DIST constants", () => {
    expect(REPO_ROOT.endsWith("chainlesschain")).toBe(true);
    expect(CLI_SRC).toBe(path.join(REPO_ROOT, "packages", "cli", "src"));
    expect(WEB_PANEL_DIST).toBe(
      path.join(REPO_ROOT, "packages", "web-panel", "dist"),
    );
  });

  it("dry-run returns positive stats without writing to disk", () => {
    const stats = vendorWebShellInto(tempBuildPath, {
      dryRun: true,
      log: silentLog,
    });
    expect(stats.cli.files).toBeGreaterThan(0);
    expect(stats.webPanel.files).toBeGreaterThan(0);
    expect(stats.totalBytes).toBeGreaterThan(0);
    // Dry-run still ensures parent dir exists since copyTree mkdir's the
    // top-level destination *only* on first descent — but with dryRun:true
    // we explicitly skip that mkdir. Verify nothing landed.
    const cliDst = path.join(tempBuildPath, "packages", "cli", "src");
    const panelDst = path.join(tempBuildPath, "packages", "web-panel", "dist");
    expect(fs.existsSync(cliDst)).toBe(false);
    expect(fs.existsSync(panelDst)).toBe(false);
  });

  it("real run materialises the expected vendor layout", () => {
    const stats = vendorWebShellInto(tempBuildPath, {
      dryRun: false,
      log: silentLog,
    });

    // Known files the web-shell loaders depend on:
    expect(
      fs.existsSync(
        path.join(
          tempBuildPath,
          "packages",
          "cli",
          "src",
          "lib",
          "web-ui-server.js",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tempBuildPath,
          "packages",
          "cli",
          "src",
          "gateways",
          "ws",
          "ws-server.js",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tempBuildPath, "packages", "web-panel", "dist", "index.html"),
      ),
    ).toBe(true);

    // Stats reported should match what's actually on disk.
    expect(stats.cli.files).toBeGreaterThan(50);
    expect(stats.webPanel.files).toBeGreaterThan(10);
  });

  it("excludes the assets/web-panel duplicate from the cli vendor", () => {
    vendorWebShellInto(tempBuildPath, { dryRun: false, log: silentLog });
    const excluded = path.join(
      tempBuildPath,
      "packages",
      "cli",
      "src",
      "assets",
      "web-panel",
    );
    expect(fs.existsSync(excluded)).toBe(false);
    // The skipped count should be at least 1 (for the assets/web-panel drop).
    const stats = vendorWebShellInto(tempBuildPath, {
      dryRun: true,
      log: silentLog,
    });
    expect(stats.cli.skipped).toBeGreaterThanOrEqual(1);
  });

  it("excludes any __tests__ subtree if one ever sneaks into cli/src", () => {
    vendorWebShellInto(tempBuildPath, { dryRun: false, log: silentLog });
    const cliDst = path.join(tempBuildPath, "packages", "cli", "src");
    function walkForExcluded(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name === "__tests__") {
          throw new Error(
            `Found __tests__ at ${path.join(dir, entry.name)} — exclude broke`,
          );
        }
        if (entry.isDirectory()) {
          walkForExcluded(path.join(dir, entry.name));
        }
      }
    }
    expect(() => walkForExcluded(cliDst)).not.toThrow();
  });

  it("is idempotent — second run overwrites without error", () => {
    const first = vendorWebShellInto(tempBuildPath, {
      dryRun: false,
      log: silentLog,
    });
    const second = vendorWebShellInto(tempBuildPath, {
      dryRun: false,
      log: silentLog,
    });
    expect(second.cli.files).toBe(first.cli.files);
    expect(second.webPanel.files).toBe(first.webPanel.files);
    expect(second.totalBytes).toBe(first.totalBytes);
  });

  it("throws when buildPath is missing or non-string", () => {
    expect(() => vendorWebShellInto(undefined, { log: silentLog })).toThrow(
      /buildPath/,
    );
    expect(() => vendorWebShellInto(123, { log: silentLog })).toThrow(
      /buildPath/,
    );
  });
});

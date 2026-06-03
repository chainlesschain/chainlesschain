/**
 * writeSettingsSync companion tests — Phase 1.5 follow-up.
 *
 * Atomic JSON writer used by the geometry persister + future settings
 * mutations. Tests cover round-trip, atomicity (.tmp rename), error
 * isolation, and shape-correctness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readSettingsSync,
  writeSettingsSync,
} from "../../../src/main/config/read-settings-sync.js";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-settings-"));
});

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("writeSettingsSync", () => {
  it("creates settings.json on first write when none exists", () => {
    const result = writeSettingsSync(tempDir, (s) => {
      s.ui = { useV6ShellByDefault: true };
    });
    expect(result).toEqual({ ui: { useV6ShellByDefault: true } });
    expect(readSettingsSync(tempDir)).toEqual({
      ui: { useV6ShellByDefault: true },
    });
  });

  it("reads + mutates + writes back without losing other keys", () => {
    fs.writeFileSync(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ general: { theme: "dark" }, ui: { x: 1 } }),
    );
    writeSettingsSync(tempDir, (s) => {
      s.ui.windowGeometry = {
        main: { x: 100, y: 200, width: 1200, height: 800 },
      };
    });
    expect(readSettingsSync(tempDir)).toEqual({
      general: { theme: "dark" },
      ui: {
        x: 1,
        windowGeometry: {
          main: { x: 100, y: 200, width: 1200, height: 800 },
        },
      },
    });
  });

  it("honours a mutator that returns a brand-new object", () => {
    fs.writeFileSync(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ stale: true }),
    );
    writeSettingsSync(tempDir, () => ({ replaced: true }));
    expect(readSettingsSync(tempDir)).toEqual({ replaced: true });
  });

  it("recovers from a malformed existing file by starting from {}", () => {
    fs.writeFileSync(path.join(tempDir, "settings.json"), "{ broken");
    writeSettingsSync(tempDir, (s) => {
      s.fresh = true;
    });
    expect(readSettingsSync(tempDir)).toEqual({ fresh: true });
  });

  it("returns null and fires onError on filesystem failure", () => {
    const onError = vi.fn();
    const result = writeSettingsSync(
      "/nonexistent/path/that/can/not/exist",
      (s) => {
        s.x = 1;
      },
      { onError },
    );
    expect(result).toBe(null);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("returns null without throwing for invalid args", () => {
    expect(writeSettingsSync(undefined, () => ({}))).toBe(null);
    expect(writeSettingsSync("", () => ({}))).toBe(null);
    expect(writeSettingsSync(123, () => ({}))).toBe(null);
    expect(writeSettingsSync(tempDir, "not-a-fn")).toBe(null);
    expect(writeSettingsSync(tempDir, null)).toBe(null);
  });

  it("uses .tmp + rename so a partial write never replaces the live file", () => {
    fs.writeFileSync(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ stable: 1 }),
    );
    // Snapshot the original inode-equivalent — under atomic rename the
    // observable contents flip from old to new in one step. We don't have
    // an easy way to test the *timing* without spies on fs, but we can at
    // least confirm there's no leftover .tmp file post-write.
    writeSettingsSync(tempDir, (s) => {
      s.stable = 2;
    });
    expect(readSettingsSync(tempDir)).toEqual({ stable: 2 });
    expect(fs.existsSync(path.join(tempDir, "settings.json.tmp"))).toBe(false);
  });
});

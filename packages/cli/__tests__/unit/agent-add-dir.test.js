import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAddDirs } from "../../src/commands/agent.js";

describe("resolveAddDirs — --add-dir resolution + validation", () => {
  let warnSpy;
  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  it("resolves existing directories to absolute, de-duped paths", () => {
    const a = mkdtempSync(join(tmpdir(), "cc-add-dir-a-"));
    const b = mkdtempSync(join(tmpdir(), "cc-add-dir-b-"));
    try {
      const out = resolveAddDirs([a, b, a]); // duplicate a
      expect(out).toEqual([a, b]); // deduped, order preserved
      expect(out.every((p) => p === join(p))).toBe(true); // already absolute
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("skips a path that is a file, not a directory (with warning)", () => {
    warnSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const dir = mkdtempSync(join(tmpdir(), "cc-add-dir-f-"));
    const file = join(dir, "not-a-dir.txt");
    writeFileSync(file, "x", "utf8");
    try {
      expect(resolveAddDirs([file])).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("non-directory"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips a non-existent path (with warning)", () => {
    warnSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(resolveAddDirs(["/no/such/dir/xyz123"])).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("non-directory"),
    );
  });

  it("returns [] for empty / undefined input", () => {
    expect(resolveAddDirs()).toEqual([]);
    expect(resolveAddDirs([])).toEqual([]);
  });
});

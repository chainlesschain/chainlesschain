import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fakeHome = join(tmpdir(), "cc-store-guard-home");

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => fakeHome,
}));

const { sessionStoreDir, isWithinSessionStore, sessionStorePathReason } =
  await import("../../src/lib/session-store-guard.js");

describe("session-store-guard", () => {
  const storeDir = join(fakeHome, "sessions");

  it("sessionStoreDir points inside the config home", () => {
    expect(sessionStoreDir()).toBe(storeDir);
  });

  it("flags absolute paths inside the store (file, nested, the dir itself)", () => {
    expect(isWithinSessionStore(join(storeDir, "session-1.jsonl"))).toBe(true);
    expect(isWithinSessionStore(join(storeDir, "sub", "x.jsonl"))).toBe(true);
    expect(isWithinSessionStore(storeDir)).toBe(true);
  });

  it("ignores paths outside the store", () => {
    expect(isWithinSessionStore(join(fakeHome, "config.json"))).toBe(false);
    expect(isWithinSessionStore(join(tmpdir(), "sessions", "x.jsonl"))).toBe(
      false,
    );
    // sibling dir with the store dir as a name PREFIX must not match
    expect(
      isWithinSessionStore(join(fakeHome, "sessions-backup", "x.jsonl")),
    ).toBe(false);
  });

  it("resolves relative paths against the provided cwd", () => {
    expect(isWithinSessionStore("session-1.jsonl", { cwd: storeDir })).toBe(
      true,
    );
    expect(
      isWithinSessionStore(join("..", "sessions", "x.jsonl"), {
        cwd: join(fakeHome, "other"),
      }),
    ).toBe(true);
    expect(isWithinSessionStore("x.jsonl", { cwd: tmpdir() })).toBe(false);
  });

  it("handles traversal that escapes back OUT of the store", () => {
    expect(isWithinSessionStore(join(storeDir, "..", "config.json"))).toBe(
      false,
    );
  });

  it("is case-insensitive on Windows", () => {
    if (process.platform !== "win32") return;
    expect(isWithinSessionStore(join(storeDir, "S1.JSONL").toUpperCase())).toBe(
      true,
    );
  });

  it("returns null/reason from sessionStorePathReason", () => {
    expect(sessionStorePathReason(join(storeDir, "s.jsonl"))).toMatch(
      /hash-chained/,
    );
    expect(sessionStorePathReason(join(tmpdir(), "s.jsonl"))).toBeNull();
    expect(sessionStorePathReason("")).toBeNull();
    expect(sessionStorePathReason(null)).toBeNull();
  });
});

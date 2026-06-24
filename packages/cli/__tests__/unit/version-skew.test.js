/**
 * Version-skew detector — the "you updated cc but a long-lived IDE-panel/REPL
 * process is still running the old in-memory code, reload to apply" reminder.
 */
import { describe, it, expect } from "vitest";
import {
  detectVersionSkew,
  readDiskVersion,
  versionSkewMessage,
} from "../../src/lib/version-skew.js";

describe("detectVersionSkew", () => {
  it("flags skew when the on-disk install is strictly newer than the running version", () => {
    expect(
      detectVersionSkew({ loaded: "0.162.117", installed: "0.162.120" }),
    ).toEqual({ loaded: "0.162.117", installed: "0.162.120" });
  });

  it("stays quiet when versions are equal (up-to-date session)", () => {
    expect(
      detectVersionSkew({ loaded: "0.162.117", installed: "0.162.117" }),
    ).toBeNull();
  });

  it("stays quiet on a downgrade (disk older than running)", () => {
    expect(
      detectVersionSkew({ loaded: "0.162.120", installed: "0.162.117" }),
    ).toBeNull();
  });

  it("respects semver precedence, not string compare (.9 < .10)", () => {
    expect(
      detectVersionSkew({ loaded: "0.162.9", installed: "0.162.10" }),
    ).toEqual({ loaded: "0.162.9", installed: "0.162.10" });
    // string compare would wrongly think "0.162.10" < "0.162.9"
    expect(
      detectVersionSkew({ loaded: "0.162.10", installed: "0.162.9" }),
    ).toBeNull();
  });

  it("stays quiet when either version is missing or unparseable", () => {
    expect(
      detectVersionSkew({ loaded: "", installed: "0.162.120" }),
    ).toBeNull();
    expect(
      detectVersionSkew({ loaded: "0.162.117", installed: null }),
    ).toBeNull();
    expect(
      detectVersionSkew({ loaded: "not-semver", installed: "0.162.120" }),
    ).toBeNull();
    expect(
      detectVersionSkew({ loaded: "0.162.117", installed: "garbage" }),
    ).toBeNull();
  });

  it("by default compares the running VERSION against a fresh disk read — same file ⇒ null (no false alarm in CI)", () => {
    // In the test process loaded===disk (no update happened under us), so the
    // zero-arg call must be silent. This is the regression that keeps a normal,
    // up-to-date session from nagging.
    expect(detectVersionSkew()).toBeNull();
  });
});

describe("readDiskVersion", () => {
  it("returns the version string from a fresh package.json read", () => {
    const v = readDiskVersion(() => JSON.stringify({ version: "9.9.9" }));
    expect(v).toBe("9.9.9");
  });

  it("trims surrounding whitespace", () => {
    expect(readDiskVersion(() => JSON.stringify({ version: " 1.2.3 " }))).toBe(
      "1.2.3",
    );
  });

  it("returns null on a read error (missing/unreadable file)", () => {
    expect(
      readDiskVersion(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });

  it("returns null on malformed JSON or a missing version field", () => {
    expect(readDiskVersion(() => "{not json")).toBeNull();
    expect(readDiskVersion(() => JSON.stringify({ name: "x" }))).toBeNull();
  });

  it("reads the REAL package.json by default and returns a valid version", () => {
    const v = readDiskVersion();
    expect(typeof v).toBe("string");
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("versionSkewMessage", () => {
  it("names both versions and tells the user to reload", () => {
    const msg = versionSkewMessage({
      loaded: "0.162.117",
      installed: "0.162.120",
    });
    expect(msg).toContain("0.162.117");
    expect(msg).toContain("0.162.120");
    expect(msg).toContain("Reload Window");
  });
});

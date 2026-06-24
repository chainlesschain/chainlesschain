/**
 * Version-skew detector — the "you updated cc but a long-lived IDE-panel/REPL
 * process is still running the old in-memory code, reload to apply" reminder.
 */
import { describe, it, expect } from "vitest";
import {
  detectVersionSkew,
  readDiskVersion,
  versionSkewMessage,
  versionDiagnosis,
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

describe("versionDiagnosis (cc doctor 3-way check)", () => {
  it("outdated: installed < latest → npm i -g", () => {
    const d = versionDiagnosis({
      running: "0.162.118",
      installed: "0.162.118",
      latest: "0.162.120",
    });
    expect(d.status).toBe("outdated");
    expect(d.message).toContain("npm i -g chainlesschain");
    expect(d.message).toContain("0.162.118 → 0.162.120");
  });

  it("skew: running < installed (disk already current) → restart, not re-install", () => {
    const d = versionDiagnosis({
      running: "0.162.117",
      installed: "0.162.118",
      latest: "0.162.118",
    });
    expect(d.status).toBe("skew");
    expect(d.message).toContain("restart");
    expect(d.message).not.toContain("npm i -g");
  });

  it("outdated takes precedence over skew when a newer release also exists", () => {
    const d = versionDiagnosis({
      running: "0.162.117",
      installed: "0.162.118",
      latest: "0.162.120",
    });
    expect(d.status).toBe("outdated"); // newest-release nudge wins
  });

  it("current: running == installed == latest → up to date", () => {
    const d = versionDiagnosis({
      running: "0.162.118",
      installed: "0.162.118",
      latest: "0.162.118",
    });
    expect(d.status).toBe("current");
  });

  it("falls back to running when the disk read failed; unknown latest is tolerated", () => {
    const d = versionDiagnosis({
      running: "0.162.118",
      installed: null,
      latest: null,
    });
    expect(d.installed).toBe("0.162.118"); // fell back to running
    expect(d.latest).toBeNull();
    expect(d.status).toBe("current");
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

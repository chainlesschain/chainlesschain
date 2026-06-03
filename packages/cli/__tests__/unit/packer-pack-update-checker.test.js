/**
 * Unit tests: src/lib/packer/pack-update-checker.js
 *
 * Covers the pure parser (`parseAndCompare`) against a hand-authored manifest,
 * and the full `checkPackUpdate` with an injected fetch stub so we can simulate
 * HTTP 404, malformed JSON, timeouts, and schema drift without touching the
 * network.
 */

import { describe, it, expect } from "vitest";
import {
  checkPackUpdate,
  parseAndCompare,
  PackUpdateError,
} from "../../src/lib/packer/pack-update-checker.js";

const FAKE_URL = "https://example.test/manifest.json";

function fakeFetchOK(body) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function fakeFetchStatus(status) {
  return async () => ({ ok: false, status, text: async () => "" });
}

function fakeFetchThrow(err) {
  return async () => {
    throw err;
  };
}

const VALID_MANIFEST = {
  schema: 1,
  channel: "stable",
  latest: {
    cliVersion: "0.157.0",
    productVersion: "v5.0.3.0",
    publishedAt: "2026-04-25T00:00:00Z",
    releaseNotes: "https://example.test/notes",
    artifacts: [
      {
        target: "node20-win-x64",
        url: "https://example.test/a-win.exe",
        sha256: "a".repeat(64),
      },
      {
        target: "node20-linux-x64",
        url: "https://example.test/a-linux",
        sha256: "b".repeat(64),
      },
    ],
  },
};

describe("parseAndCompare (pure)", () => {
  it("newer available → updateAvailable=true + matched artifact", () => {
    const r = parseAndCompare(VALID_MANIFEST, {
      currentVersion: "0.156.6",
      target: "node20-win-x64",
    });
    expect(r.updateAvailable).toBe(true);
    expect(r.currentVersion).toBe("0.156.6");
    expect(r.latestVersion).toBe("0.157.0");
    expect(r.artifact).toEqual({
      target: "node20-win-x64",
      url: "https://example.test/a-win.exe",
      sha256: "a".repeat(64),
    });
    expect(r.channel).toBe("stable");
    expect(r.releaseNotes).toBe("https://example.test/notes");
    expect(r.publishedAt).toBe("2026-04-25T00:00:00Z");
  });

  it("same version → updateAvailable=false (artifact still resolved)", () => {
    const r = parseAndCompare(VALID_MANIFEST, {
      currentVersion: "0.157.0",
      target: "node20-linux-x64",
    });
    expect(r.updateAvailable).toBe(false);
    expect(r.artifact.target).toBe("node20-linux-x64");
  });

  it("newer current version → updateAvailable=false (client ahead of server)", () => {
    const r = parseAndCompare(VALID_MANIFEST, {
      currentVersion: "0.158.0",
      target: "node20-win-x64",
    });
    expect(r.updateAvailable).toBe(false);
  });

  it("unmatched target → updateAvailable still computed, artifact=null", () => {
    const r = parseAndCompare(VALID_MANIFEST, {
      currentVersion: "0.156.0",
      target: "node20-macos-arm64",
    });
    expect(r.updateAvailable).toBe(true);
    expect(r.artifact).toBeNull();
  });

  it("target omitted → artifact=null even if manifest has artifacts", () => {
    const r = parseAndCompare(VALID_MANIFEST, {
      currentVersion: "0.156.0",
    });
    expect(r.updateAvailable).toBe(true);
    expect(r.artifact).toBeNull();
  });

  it("rejects unknown schema versions", () => {
    const m = { ...VALID_MANIFEST, schema: 2 };
    expect(() => parseAndCompare(m, { currentVersion: "0.156.0" })).toThrow(
      PackUpdateError,
    );
    try {
      parseAndCompare(m, { currentVersion: "0.156.0" });
    } catch (e) {
      expect(e.code).toBe("SCHEMA_MISMATCH");
    }
  });

  it("rejects when latest.cliVersion is missing", () => {
    const m = { schema: 1, latest: {} };
    expect(() => parseAndCompare(m, { currentVersion: "0.156.0" })).toThrow(
      /cliVersion/,
    );
  });

  it("rejects when latest.cliVersion is not valid semver", () => {
    const m = { schema: 1, latest: { cliVersion: "banana" } };
    try {
      parseAndCompare(m, { currentVersion: "0.156.0" });
    } catch (e) {
      expect(e.code).toBe("INVALID_VERSION");
    }
  });

  it("rejects when currentVersion is not valid semver", () => {
    try {
      parseAndCompare(VALID_MANIFEST, { currentVersion: "not-semver" });
    } catch (e) {
      expect(e.code).toBe("INVALID_VERSION");
    }
  });

  it("defaults channel to 'stable' when manifest omits it", () => {
    const m = { ...VALID_MANIFEST, channel: undefined };
    const r = parseAndCompare(m, { currentVersion: "0.156.0" });
    expect(r.channel).toBe("stable");
  });
});

describe("checkPackUpdate (with injected fetch)", () => {
  it("fetches the manifest URL and returns the parsed result", async () => {
    const r = await checkPackUpdate({
      manifestUrl: FAKE_URL,
      currentVersion: "0.156.6",
      target: "node20-win-x64",
      fetchImpl: fakeFetchOK(VALID_MANIFEST),
    });
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe("0.157.0");
  });

  it("throws NO_MANIFEST_URL when manifestUrl is missing", async () => {
    await expect(
      checkPackUpdate({ currentVersion: "0.156.0" }),
    ).rejects.toMatchObject({ code: "NO_MANIFEST_URL" });
  });

  it("throws NO_CURRENT_VERSION when currentVersion is missing", async () => {
    await expect(
      checkPackUpdate({ manifestUrl: FAKE_URL }),
    ).rejects.toMatchObject({ code: "NO_CURRENT_VERSION" });
  });

  it("maps HTTP 404 to FETCH_FAILED", async () => {
    try {
      await checkPackUpdate({
        manifestUrl: FAKE_URL,
        currentVersion: "0.156.0",
        fetchImpl: fakeFetchStatus(404),
      });
    } catch (e) {
      expect(e.code).toBe("FETCH_FAILED");
      expect(e.message).toMatch(/HTTP 404/);
    }
  });

  it("maps a network error to NETWORK_ERROR", async () => {
    try {
      await checkPackUpdate({
        manifestUrl: FAKE_URL,
        currentVersion: "0.156.0",
        fetchImpl: fakeFetchThrow(new Error("ECONNREFUSED")),
      });
    } catch (e) {
      expect(e.code).toBe("NETWORK_ERROR");
      expect(e.message).toMatch(/ECONNREFUSED/);
    }
  });

  it("maps an AbortError to TIMEOUT", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    try {
      await checkPackUpdate({
        manifestUrl: FAKE_URL,
        currentVersion: "0.156.0",
        fetchImpl: fakeFetchThrow(abortErr),
      });
    } catch (e) {
      expect(e.code).toBe("TIMEOUT");
    }
  });

  it("maps malformed JSON to PARSE_FAILED", async () => {
    try {
      await checkPackUpdate({
        manifestUrl: FAKE_URL,
        currentVersion: "0.156.0",
        fetchImpl: fakeFetchOK("{not json"),
      });
    } catch (e) {
      expect(e.code).toBe("PARSE_FAILED");
    }
  });

  it("propagates SCHEMA_MISMATCH from the parser", async () => {
    try {
      await checkPackUpdate({
        manifestUrl: FAKE_URL,
        currentVersion: "0.156.0",
        fetchImpl: fakeFetchOK({ schema: 999, latest: {} }),
      });
    } catch (e) {
      expect(e.code).toBe("SCHEMA_MISMATCH");
    }
  });
});

/**
 * Unit tests for the federation drop-zone path helpers — specifically that a
 * federation_id (which can come from a remote announce) cannot escape the drop
 * zone via "../" and that did-style ":" is sanitized for cross-platform safety.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { _federationInternals } from "../../../src/commands/mtc.js";

const { getDiscoverAnnouncesDir } = _federationInternals;

describe("getDiscoverAnnouncesDir — federation_id sanitization", () => {
  const dz = path.join("/drop", "zone");
  const base = path.join(dz, "federation-announces");

  it("keeps a normal federation id under the drop zone", () => {
    const d = getDiscoverAnnouncesDir(dz, "fed-abc_123");
    expect(d).toBe(path.join(base, "fed-abc_123"));
  });

  it("neutralizes a traversal federation id (stays inside the drop zone)", () => {
    const d = getDiscoverAnnouncesDir(dz, "../../../etc");
    expect(d.startsWith(base + path.sep)).toBe(true);
    expect(d).not.toContain("..");
  });

  it("replaces ':' (did-style id, invalid path char on Windows)", () => {
    const d = getDiscoverAnnouncesDir(dz, "did:web:example");
    expect(path.basename(d)).toBe("did_web_example");
    expect(d).not.toContain(":");
  });

  it("handles null/undefined federation id without throwing", () => {
    expect(() => getDiscoverAnnouncesDir(dz, null)).not.toThrow();
    expect(() => getDiscoverAnnouncesDir(dz, undefined)).not.toThrow();
  });
});

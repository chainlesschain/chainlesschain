// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { CrossFedTrust } = require("../cross-fed-trust.js");

const DID_A = "did:chainlesschain:" + "a".repeat(40);
const DID_B = "did:chainlesschain:" + "b".repeat(40);
const DID_C = "did:chainlesschain:" + "c".repeat(40);
const DID_D = "did:chainlesschain:" + "d".repeat(40);

describe("CrossFedTrust", () => {
  let tmpDir;
  let trust;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cft-"));
    trust = new CrossFedTrust({ rootDir: tmpDir });
    trust.initialize();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("rejects missing rootDir", () => {
    expect(() => new CrossFedTrust({})).toThrow(/rootDir/);
  });

  describe("establishTrust", () => {
    it("writes record + returns it", () => {
      const r = trust.establishTrust("comm-A", {
        remoteCommunityId: "comm-B",
        remoteMembers: [DID_C, DID_D],
        note: "engineering ↔ design",
      });
      expect(r.localCommunityId).toBe("comm-A");
      expect(r.remoteCommunityId).toBe("comm-B");
      expect(r.remoteMembers).toEqual([DID_C, DID_D]);
      expect(r.note).toBe("engineering ↔ design");
      expect(r.issuedAt).toMatch(/T/);
      expect(r.expiresAt).toBeNull();
      expect(fs.existsSync(path.join(tmpDir, "comm-A", "comm-B.json"))).toBe(
        true,
      );
    });

    it("rejects unsafe ids", () => {
      expect(() =>
        trust.establishTrust("../escape", {
          remoteCommunityId: "x",
          remoteMembers: [DID_A],
        }),
      ).toThrow(/unsafe/);
      expect(() =>
        trust.establishTrust("comm-A", {
          remoteCommunityId: "../escape",
          remoteMembers: [DID_A],
        }),
      ).toThrow(/unsafe/);
    });

    it("rejects empty remoteMembers", () => {
      expect(() =>
        trust.establishTrust("comm-A", {
          remoteCommunityId: "comm-B",
          remoteMembers: [],
        }),
      ).toThrow(/non-empty/);
    });

    it("rejects malformed DID in remoteMembers", () => {
      expect(() =>
        trust.establishTrust("comm-A", {
          remoteCommunityId: "comm-B",
          remoteMembers: ["not-a-did"],
        }),
      ).toThrow(/DID format/);
    });

    it("rejects duplicate remoteMembers", () => {
      expect(() =>
        trust.establishTrust("comm-A", {
          remoteCommunityId: "comm-B",
          remoteMembers: [DID_A, DID_A],
        }),
      ).toThrow(/duplicates/);
    });

    it("idempotent — establishing twice updates the record", () => {
      trust.establishTrust("comm-A", {
        remoteCommunityId: "comm-B",
        remoteMembers: [DID_A],
      });
      trust.establishTrust("comm-A", {
        remoteCommunityId: "comm-B",
        remoteMembers: [DID_A, DID_B],
      });
      const list = trust.listTrusted("comm-A");
      expect(list).toHaveLength(1);
      expect(list[0].remoteMembers).toEqual([DID_A, DID_B]);
    });
  });

  describe("revokeTrust", () => {
    it("deletes record + returns true", () => {
      trust.establishTrust("comm-A", {
        remoteCommunityId: "comm-B",
        remoteMembers: [DID_A],
      });
      expect(trust.revokeTrust("comm-A", "comm-B")).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "comm-A", "comm-B.json"))).toBe(
        false,
      );
    });

    it("idempotent on unknown remote — returns false", () => {
      expect(trust.revokeTrust("comm-A", "ghost")).toBe(false);
    });
  });

  describe("listTrusted", () => {
    it("returns empty for community with no records", () => {
      expect(trust.listTrusted("never-existed")).toEqual([]);
    });

    it("returns parsed records", () => {
      trust.establishTrust("comm-A", {
        remoteCommunityId: "comm-B",
        remoteMembers: [DID_A],
      });
      trust.establishTrust("comm-A", {
        remoteCommunityId: "comm-C",
        remoteMembers: [DID_B, DID_C],
      });
      const list = trust.listTrusted("comm-A");
      expect(list).toHaveLength(2);
      const byRemote = Object.fromEntries(
        list.map((r) => [r.remoteCommunityId, r]),
      );
      expect(byRemote["comm-B"].remoteMembers).toEqual([DID_A]);
      expect(byRemote["comm-C"].remoteMembers).toEqual([DID_B, DID_C]);
    });
  });

  describe("getTrustedDIDs", () => {
    it("returns union across all un-expired records", () => {
      trust.establishTrust("comm-X", {
        remoteCommunityId: "comm-1",
        remoteMembers: [DID_A, DID_B],
      });
      trust.establishTrust("comm-X", {
        remoteCommunityId: "comm-2",
        remoteMembers: [DID_B, DID_C], // overlap with comm-1
      });
      const dids = trust.getTrustedDIDs("comm-X");
      expect(dids.sort()).toEqual([DID_A, DID_B, DID_C].sort());
    });

    it("excludes expired records", () => {
      trust.establishTrust("comm-X", {
        remoteCommunityId: "expired-fed",
        remoteMembers: [DID_A],
        expiresAt: "2000-01-01T00:00:00Z",
      });
      trust.establishTrust("comm-X", {
        remoteCommunityId: "live-fed",
        remoteMembers: [DID_B],
      });
      expect(trust.getTrustedDIDs("comm-X")).toEqual([DID_B]);
    });

    it("includes non-expired (expiresAt > now)", () => {
      const future = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
      trust.establishTrust("comm-X", {
        remoteCommunityId: "future-fed",
        remoteMembers: [DID_A],
        expiresAt: future,
      });
      expect(trust.getTrustedDIDs("comm-X")).toEqual([DID_A]);
    });

    it("supports clock injection for tests", () => {
      // Treat 2030 as "now" — a record with expiresAt 2025 should now be excluded
      trust.establishTrust("comm-X", {
        remoteCommunityId: "stale-fed",
        remoteMembers: [DID_A],
        expiresAt: "2025-01-01T00:00:00Z",
      });
      trust.establishTrust("comm-X", {
        remoteCommunityId: "fresh-fed",
        remoteMembers: [DID_B],
        expiresAt: "2099-01-01T00:00:00Z",
      });
      expect(
        trust.getTrustedDIDs("comm-X", {
          now: new Date("2030-01-01T00:00:00Z"),
        }),
      ).toEqual([DID_B]);
    });

    it("returns empty for community with no records", () => {
      expect(trust.getTrustedDIDs("ghost")).toEqual([]);
    });
  });
});

/**
 * Unit tests for the REPL /permissions <tier> mid-session approval-mode parser.
 * Pure → no readline/agent loop needed.
 */
import { describe, it, expect } from "vitest";
import {
  parsePermissionTier,
  describeTier,
  nextTier,
  TIER_CYCLE,
} from "../../src/repl/permission-tier.js";

describe("parsePermissionTier", () => {
  it("maps strict aliases", () => {
    for (const a of ["strict", "default", "normal", "off", "STRICT", " Default "]) {
      expect(parsePermissionTier(a)).toBe("strict");
    }
  });

  it("maps trusted aliases (acceptEdits parity)", () => {
    for (const a of ["trusted", "accept", "accept-edits", "acceptedits", "Accept-Edits"]) {
      expect(parsePermissionTier(a)).toBe("trusted");
    }
  });

  it("maps autopilot aliases (bypassPermissions parity)", () => {
    for (const a of ["autopilot", "bypass", "bypassPermissions", "yolo"]) {
      expect(parsePermissionTier(a)).toBe("autopilot");
    }
  });

  it("returns null for unknown / empty input", () => {
    expect(parsePermissionTier("loose")).toBe(null);
    expect(parsePermissionTier("")).toBe(null);
    expect(parsePermissionTier(null)).toBe(null);
    expect(parsePermissionTier(undefined)).toBe(null);
  });
});

describe("describeTier", () => {
  it("describes each tier and empty for unknown", () => {
    expect(describeTier("autopilot")).toContain("auto-approved");
    expect(describeTier("trusted")).toContain("high-risk still asks");
    expect(describeTier("strict")).toContain("asks");
    expect(describeTier("bogus")).toBe("");
  });
});

describe("nextTier (Shift+Tab cycle)", () => {
  it("cycles strict → trusted → autopilot → strict", () => {
    expect(nextTier("strict")).toBe("trusted");
    expect(nextTier("trusted")).toBe("autopilot");
    expect(nextTier("autopilot")).toBe("strict");
  });

  it("resets an unknown current tier to the first", () => {
    expect(nextTier("bogus")).toBe("strict");
    expect(nextTier(undefined)).toBe("strict");
  });

  it("a full cycle returns to the start", () => {
    let t = "strict";
    for (let i = 0; i < TIER_CYCLE.length; i++) t = nextTier(t);
    expect(t).toBe("strict");
  });
});

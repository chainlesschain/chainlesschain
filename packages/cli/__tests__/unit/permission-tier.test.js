/**
 * Unit tests for the REPL /permissions <tier> mid-session approval-mode parser.
 * Pure → no readline/agent loop needed.
 */
import { describe, it, expect } from "vitest";
import {
  parsePermissionTier,
  parsePermissionModeArg,
  describeTier,
  nextTier,
  TIER_CYCLE,
} from "../../src/repl/permission-tier.js";

describe("parsePermissionTier", () => {
  it("maps strict aliases", () => {
    for (const a of [
      "strict",
      "default",
      "manual",
      "normal",
      "off",
      "STRICT",
      " Default ",
    ]) {
      expect(parsePermissionTier(a)).toBe("strict");
    }
  });

  it("maps trusted aliases (acceptEdits parity)", () => {
    for (const a of [
      "trusted",
      "accept",
      "accept-edits",
      "acceptedits",
      "Accept-Edits",
    ]) {
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

describe("parsePermissionModeArg", () => {
  it("maps auto aliases to the trusted tier with the auto flag set", () => {
    for (const a of ["auto", "AUTO", "auto-mode", "automode", " Auto "]) {
      expect(parsePermissionModeArg(a)).toEqual({
        tier: "trusted",
        auto: true,
      });
    }
  });

  it("maps plain tiers with the auto flag unset", () => {
    expect(parsePermissionModeArg("strict")).toEqual({
      tier: "strict",
      auto: false,
    });
    expect(parsePermissionModeArg("manual")).toEqual({
      tier: "strict",
      auto: false,
    });
    expect(parsePermissionModeArg("accept-edits")).toEqual({
      tier: "trusted",
      auto: false,
    });
    expect(parsePermissionModeArg("bypassPermissions")).toEqual({
      tier: "autopilot",
      auto: false,
    });
  });

  it("returns null for unknown / empty input", () => {
    expect(parsePermissionModeArg("loose")).toBe(null);
    expect(parsePermissionModeArg("")).toBe(null);
    expect(parsePermissionModeArg(null)).toBe(null);
    // dontAsk is headless-only — the interactive parser rejects it.
    expect(parsePermissionModeArg("dontAsk")).toBe(null);
  });
});

describe("describeTier", () => {
  it("describes each tier and empty for unknown", () => {
    expect(describeTier("autopilot")).toContain("auto-approved");
    expect(describeTier("trusted")).toContain("high-risk still asks");
    expect(describeTier("strict")).toContain("asks");
    expect(describeTier("auto")).toContain("autoMode.decisions");
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

/**
 * auto-pin policy tests — the OPT-IN compaction pin policy. Verifies it is off
 * by default (returns null → caller passes no predicate → byte-identical), and
 * when enabled pins the original task (first user turn) plus explicit pins,
 * honoring the token cap.
 */

import { describe, it, expect } from "vitest";
import {
  resolveAutoPinConfig,
  buildAutoPinPredicate,
  describeAutoPin,
} from "../auto-pin.js";

const MSGS = [
  { role: "system", content: "you are a coding agent" },
  { role: "user", content: "Refactor the auth module to use async/await" },
  { role: "assistant", content: "ok, reading files" },
  { role: "user", content: "also add tests" },
];

describe("resolveAutoPinConfig", () => {
  it("returns null when off (falsy)", () => {
    expect(resolveAutoPinConfig(undefined)).toBeNull();
    expect(resolveAutoPinConfig(false)).toBeNull();
    expect(resolveAutoPinConfig(0)).toBeNull();
  });
  it("defaults firstUserGoal on when enabled with true", () => {
    expect(resolveAutoPinConfig(true)).toMatchObject({ firstUserGoal: true });
  });
  it("accepts an object and can disable firstUserGoal", () => {
    expect(resolveAutoPinConfig({ firstUserGoal: false })).toMatchObject({
      firstUserGoal: false,
    });
    expect(resolveAutoPinConfig({ maxPinTokens: 50 }).maxPinTokens).toBe(50);
  });
});

describe("buildAutoPinPredicate", () => {
  it("returns null when auto-pin is off (→ default compaction, byte-identical)", () => {
    expect(buildAutoPinPredicate(MSGS, false)).toBeNull();
    expect(buildAutoPinPredicate(MSGS, undefined)).toBeNull();
  });

  it("pins the first user turn (the original task) when enabled", () => {
    const isPinned = buildAutoPinPredicate(MSGS, true);
    expect(isPinned(MSGS[1])).toBe(true); // first user
    expect(isPinned(MSGS[3])).toBe(false); // second user NOT pinned
    expect(isPinned(MSGS[0])).toBe(false); // system not pinned
    expect(isPinned(MSGS[2])).toBe(false); // assistant not pinned
  });

  it("always honors explicit pins on top of the policy", () => {
    const msgs = [
      ...MSGS,
      { role: "assistant", content: "important decision", pinned: true },
      { role: "assistant", content: "legacy marker", _pin: true },
    ];
    const isPinned = buildAutoPinPredicate(msgs, true);
    expect(isPinned(msgs[4])).toBe(true); // pinned:true
    expect(isPinned(msgs[5])).toBe(true); // _pin
  });

  it("honors explicit pins even with firstUserGoal disabled", () => {
    const msgs = [
      MSGS[0],
      MSGS[1],
      { role: "user", content: "x", pinned: true },
    ];
    const isPinned = buildAutoPinPredicate(msgs, { firstUserGoal: false });
    expect(isPinned(msgs[1])).toBe(false); // first user NOT auto-pinned
    expect(isPinned(msgs[2])).toBe(true); // explicit pin still honored
  });

  it("skips a first user turn that exceeds the token cap", () => {
    const big = { role: "user", content: "x".repeat(10_000) }; // ~2500 tokens
    const msgs = [MSGS[0], big, MSGS[2]];
    const isPinned = buildAutoPinPredicate(msgs, { maxPinTokens: 100 });
    expect(isPinned(big)).toBe(false); // too big to pin
  });

  it("matches by identity, not by value (compaction filters the same array)", () => {
    const isPinned = buildAutoPinPredicate(MSGS, true);
    const clone = { ...MSGS[1] }; // same content, different object
    expect(isPinned(clone)).toBe(false);
  });
});

describe("describeAutoPin", () => {
  it("reports disabled when off", () => {
    expect(describeAutoPin(MSGS, false)).toEqual({
      enabled: false,
      reasons: [],
    });
  });
  it("explains the original-task pin", () => {
    const d = describeAutoPin(MSGS, true);
    expect(d.enabled).toBe(true);
    expect(d.reasons.some((r) => r.why.includes("original task"))).toBe(true);
    expect(d.reasons[d.reasons.length - 1].preview).toContain(
      "Refactor the auth",
    );
  });
});

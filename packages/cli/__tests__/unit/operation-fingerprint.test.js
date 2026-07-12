/**
 * Operation fingerprint (IDE gap P0#2 "approvalId 绑定操作指纹"). Pure +
 * deterministic: a stable hash over an operation's identity (tool + args) so an
 * approval can be bound to the exact side effect it authorizes, and a resolve
 * for a DIFFERENT operation is rejected (confused-deputy defense).
 */
import { describe, it, expect } from "vitest";
import {
  operationFingerprint,
  fingerprintsMatch,
  approvalFingerprintOk,
} from "../../src/lib/operation-fingerprint.js";

describe("operationFingerprint", () => {
  it("is deterministic and 32 hex chars", () => {
    const fp = operationFingerprint({
      tool: "run_shell",
      detail: "npm publish",
    });
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(
      operationFingerprint({ tool: "run_shell", detail: "npm publish" }),
    ).toBe(fp);
  });

  it("is independent of argument key ORDER (canonicalized)", () => {
    const a = operationFingerprint({
      tool: "git",
      args: { remote: "origin", branch: "main" },
    });
    const b = operationFingerprint({
      tool: "git",
      args: { branch: "main", remote: "origin" },
    });
    expect(a).toBe(b);
  });

  it("preserves array order (order is semantic for a list)", () => {
    const a = operationFingerprint({ tool: "t", args: { argv: ["a", "b"] } });
    const b = operationFingerprint({ tool: "t", args: { argv: ["b", "a"] } });
    expect(a).not.toBe(b);
  });

  it("distinguishes different operations", () => {
    const publish = operationFingerprint({
      tool: "run_shell",
      detail: "npm publish",
    });
    const ls = operationFingerprint({ tool: "run_shell", detail: "ls" });
    const gitPush = operationFingerprint({ tool: "git", action: "push" });
    expect(new Set([publish, ls, gitPush]).size).toBe(3);
  });

  it("prefers structured args over detail but stays total for empty input", () => {
    expect(operationFingerprint({})).toMatch(/^[0-9a-f]{32}$/);
    expect(operationFingerprint()).toMatch(/^[0-9a-f]{32}$/);
    // args wins when both present.
    const withArgs = operationFingerprint({
      tool: "t",
      args: { x: 1 },
      detail: "ignored",
    });
    const detailOnly = operationFingerprint({ tool: "t", detail: "ignored" });
    expect(withArgs).not.toBe(detailOnly);
  });
});

describe("fingerprintsMatch", () => {
  it("matches identical, rejects different / malformed", () => {
    const fp = operationFingerprint({ tool: "git", action: "push" });
    expect(fingerprintsMatch(fp, fp)).toBe(true);
    expect(
      fingerprintsMatch(
        fp,
        operationFingerprint({ tool: "git", action: "pull" }),
      ),
    ).toBe(false);
    expect(fingerprintsMatch(fp, "")).toBe(false);
    expect(fingerprintsMatch(fp, fp.slice(0, 10))).toBe(false); // length mismatch
    expect(fingerprintsMatch(null, null)).toBe(false);
    expect(fingerprintsMatch(fp, 42)).toBe(false);
  });
});

describe("approvalFingerprintOk (backward-compatible verdict)", () => {
  const pending = operationFingerprint({
    tool: "run_shell",
    detail: "npm publish",
  });

  it("accepts a resolve whose fingerprint matches the pending operation", () => {
    expect(approvalFingerprintOk(pending, pending)).toBe(true);
  });

  it("rejects a resolve whose fingerprint is for a DIFFERENT operation", () => {
    const other = operationFingerprint({
      tool: "run_shell",
      detail: "rm -rf /",
    });
    expect(approvalFingerprintOk(pending, other)).toBe(false);
  });

  it("accepts a legacy resolve that carries no fingerprint (absence tolerated)", () => {
    expect(approvalFingerprintOk(pending, null)).toBe(true);
    expect(approvalFingerprintOk(pending, undefined)).toBe(true);
    expect(approvalFingerprintOk(pending, "")).toBe(true);
  });

  it("accepts when there is nothing to bind against (legacy pending ask)", () => {
    expect(approvalFingerprintOk(null, "anything")).toBe(true);
  });
});

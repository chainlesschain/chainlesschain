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
  operationDescriptorKey,
  computeOperationFingerprint,
  shortOperationId,
  summarizeOperation,
  resolveOperationApproval,
  OperationApprovalRegistry,
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

// ── §8.2 cross-device operation fingerprint ──────────────────────────────────

const baseDesc = () => ({
  toolName: "run_shell",
  params: { cmd: "npm publish" },
  targetEnv: "local",
  workspace: "chainlesschain",
  session: "sess-1",
  policyVersion: "pol-7",
  notBefore: 1000,
  notAfter: 2000,
});

describe("computeOperationFingerprint (full §8.2 tuple)", () => {
  it("is deterministic, opf_-prefixed, and key-order independent", () => {
    const fp = computeOperationFingerprint(baseDesc());
    expect(fp).toMatch(/^opf_[0-9a-f]{40}$/);
    expect(computeOperationFingerprint(baseDesc())).toBe(fp);
    const reordered = computeOperationFingerprint({
      ...baseDesc(),
      params: { cmd: "npm publish" },
    });
    expect(reordered).toBe(fp);
  });

  it("changes when ANY §8.2 dimension changes (params/env/workspace/session/policy)", () => {
    const fp = computeOperationFingerprint(baseDesc());
    const variants = [
      { params: { cmd: "rm -rf /" } },
      { targetEnv: "ssh:box" },
      { workspace: "other-repo" },
      { session: "sess-2" },
      { policyVersion: "pol-8" },
    ];
    for (const v of variants) {
      expect(computeOperationFingerprint({ ...baseDesc(), ...v })).not.toBe(fp);
    }
  });

  it("changes when the validity window changes (a re-issued card is distinct)", () => {
    const fp = computeOperationFingerprint(baseDesc());
    expect(
      computeOperationFingerprint({ ...baseDesc(), notAfter: 3000 }),
    ).not.toBe(fp);
  });

  it("the LOGICAL key is window-independent (same op, different window)", () => {
    const a = operationDescriptorKey(baseDesc());
    const b = operationDescriptorKey({ ...baseDesc(), notAfter: 9999 });
    expect(a).toBe(b);
  });
});

describe("shortOperationId / summarizeOperation", () => {
  it("short id is a stable XXXX-XXXX from the fingerprint", () => {
    const fp = computeOperationFingerprint(baseDesc());
    const id = shortOperationId(fp);
    expect(id).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(shortOperationId(fp)).toBe(id);
  });

  it("summary is readable and NEVER echoes param values (secret-safe)", () => {
    const summary = summarizeOperation({
      ...baseDesc(),
      params: { cmd: "curl -H 'authorization: Bearer sk-secret'" },
    });
    expect(summary).toContain("run_shell");
    expect(summary).toContain("ws:chainlesschain");
    expect(summary).toContain("env:local");
    expect(summary).not.toContain("sk-secret");
    expect(summary).not.toContain("Bearer");
    // only the key name is shown
    expect(summary).toContain("cmd");
  });

  it("marks opaque scalar params without revealing them", () => {
    const summary = summarizeOperation({
      toolName: "run_shell",
      params: "rm -rf /secret",
    });
    expect(summary).toContain("(…)");
    expect(summary).not.toContain("secret");
  });
});

describe("resolveOperationApproval (fail-closed verdict)", () => {
  const pending = () => ({
    fingerprint: computeOperationFingerprint(baseDesc()),
    notBefore: 1000,
    notAfter: 2000,
    resolved: false,
    supersededBy: null,
  });
  const match = () => ({
    fingerprint: computeOperationFingerprint(baseDesc()),
  });

  it("accepts a matching, in-window, unresolved card", () => {
    expect(resolveOperationApproval(pending(), match(), { now: 1500 })).toEqual(
      {
        ok: true,
        reason: null,
      },
    );
  });

  it("rejects a fingerprint mismatch (replay of a different op)", () => {
    const other = {
      fingerprint: computeOperationFingerprint({
        ...baseDesc(),
        params: { cmd: "ls" },
      }),
    };
    expect(
      resolveOperationApproval(pending(), other, { now: 1500 }).reason,
    ).toBe("fingerprint-mismatch");
  });

  it("rejects an expired card (timeout) and a not-yet-valid card", () => {
    expect(
      resolveOperationApproval(pending(), match(), { now: 2500 }).reason,
    ).toBe("expired");
    expect(
      resolveOperationApproval(pending(), match(), { now: 500 }).reason,
    ).toBe("not-yet-valid");
  });

  it("fails closed when a window is set but no clock is provided", () => {
    expect(resolveOperationApproval(pending(), match(), {}).reason).toBe(
      "no-clock",
    );
  });

  it("rejects a duplicate (already-resolved) and a superseded card", () => {
    expect(
      resolveOperationApproval({ ...pending(), resolved: true }, match(), {
        now: 1500,
      }).reason,
    ).toBe("duplicate");
    expect(
      resolveOperationApproval(
        { ...pending(), supersededBy: "opf_other" },
        match(),
        { now: 1500 },
      ).reason,
    ).toBe("superseded");
  });

  it("rejects missing pending / resolution (fail closed)", () => {
    expect(resolveOperationApproval(null, match()).ok).toBe(false);
    expect(resolveOperationApproval(pending(), null).ok).toBe(false);
  });
});

describe("OperationApprovalRegistry", () => {
  it("issues a card with fingerprint + short id + summary", () => {
    const reg = new OperationApprovalRegistry({ clock: () => 1500 });
    const card = reg.issue(baseDesc());
    expect(card.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    expect(card.shortId).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(card.summary).toContain("run_shell");
  });

  it("resolves a live card once, then rejects the replay as duplicate", () => {
    const reg = new OperationApprovalRegistry({ clock: () => 1500 });
    const { fingerprint } = reg.issue(baseDesc());
    expect(reg.resolve(fingerprint)).toEqual({ ok: true, reason: null });
    expect(reg.resolve(fingerprint).reason).toBe("duplicate");
  });

  it("single-winner: re-issuing supersedes the old card (multi-card concurrency)", () => {
    const reg = new OperationApprovalRegistry({ clock: () => 1500 });
    const first = reg.issue(baseDesc()); // window [1000,2000]
    const second = reg.issue({ ...baseDesc(), notAfter: 5000 }); // same logical op, new window
    expect(second.fingerprint).not.toBe(first.fingerprint);
    // the stale first card can no longer settle the gate
    expect(reg.resolve(first.fingerprint).reason).toBe("superseded");
    // only the newest card wins
    expect(reg.resolve(second.fingerprint)).toEqual({ ok: true, reason: null });
  });

  it("rejects an unknown fingerprint and an expired card", () => {
    const reg = new OperationApprovalRegistry({ clock: () => 3000 });
    expect(reg.resolve("opf_deadbeef").reason).toBe("unknown");
    const { fingerprint } = reg.issue(baseDesc()); // notAfter 2000 < now 3000
    expect(reg.resolve(fingerprint).reason).toBe("expired");
  });
});

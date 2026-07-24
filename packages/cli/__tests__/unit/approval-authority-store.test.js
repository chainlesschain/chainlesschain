import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPROVAL_STATE_ERROR_CODES,
  ApprovalAuthorityStore,
  defaultApprovalAuthorityStatePath,
} from "../../src/lib/approval-authority-store.js";
import {
  ORIGIN,
  approvalBindingDigest,
} from "../../src/lib/agent-authority.js";
import {
  OperationApprovalRegistry,
  computeOperationFingerprint,
} from "../../src/lib/operation-fingerprint.js";

function thrownCode(action) {
  try {
    action();
  } catch (error) {
    return error.code;
  }
  throw new Error("Expected action to throw");
}

describe("ApprovalAuthorityStore", () => {
  let directory;
  let filePath;
  let now;

  beforeEach(() => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-approval-authority-"),
    );
    filePath = path.join(directory, "approval-state.json");
    now = 1_500;
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function makeStore(options = {}) {
    return new ApprovalAuthorityStore({
      filePath,
      now: () => now,
      ...options,
    });
  }

  function descriptor(overrides = {}) {
    return {
      toolName: "run_shell",
      params: {
        command: "npm publish --token long-lived-plaintext-secret",
      },
      targetEnv: "local",
      workspace: "chainlesschain",
      session: "session-1",
      policyVersion: "policy-7",
      notBefore: 1_000,
      notAfter: 2_000,
      ...overrides,
    };
  }

  function binding(overrides = {}) {
    return approvalBindingDigest({
      toolCallId: "tool-call-1",
      args: {
        command: "npm publish --token long-lived-plaintext-secret",
      },
      policyDigest: "policy-7",
      ...overrides,
    });
  }

  function remoteAuthority(sessionId = "session-1") {
    return {
      origin: ORIGIN.REMOTE,
      authenticated: true,
      scopes: ["approve"],
      principalId: "phone-1",
      sessionId,
    };
  }

  function resolution(card, overrides = {}) {
    return {
      fingerprint: card.fingerprint,
      binding: binding(),
      sessionId: "session-1",
      decision: true,
      authority: remoteAuthority(),
      expectedRevision: card.revision,
      now,
      ...overrides,
    };
  }

  it("persists a pending request without persisting raw operation arguments", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-1",
      descriptor: descriptor(),
      binding: binding(),
    });

    expect(card).toMatchObject({
      requestId: "request-1",
      status: "pending",
      revision: 1,
      duplicate: false,
    });
    expect(card.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);

    const serialized = fs.readFileSync(filePath, "utf8");
    expect(serialized).not.toContain("long-lived-plaintext-secret");
    expect(serialized).not.toContain("npm publish");
    expect(serialized).toContain(card.fingerprint);
    expect(serialized).toContain(binding());

    const restarted = makeStore();
    expect(
      restarted.getRequest("request-1", { bestEffort: false }),
    ).toMatchObject({
      fingerprint: card.fingerprint,
      binding: binding(),
      sessionId: "session-1",
      status: "pending",
      revision: 1,
    });
  });

  it("uses the production remote-approval registry fingerprint vector", () => {
    const descriptorValue = descriptor();
    const productionRegistry = new OperationApprovalRegistry({
      clock: () => now,
    });
    const productionCard = productionRegistry.issue(descriptorValue);
    const durableCard = makeStore().issueRequest({
      requestId: "request-production-vector",
      descriptor: descriptorValue,
      binding: binding(),
    });

    expect(durableCard.fingerprint).toBe(productionCard.fingerprint);
    expect(durableCard.shortId).toBe(productionCard.shortId);
  });

  it("routes registry issue and resolve through the durable CAS store", () => {
    const store = makeStore();
    const registry = new OperationApprovalRegistry({
      clock: () => now,
      store,
    });
    const approvalBinding = binding();
    const card = registry.issue(descriptor(), {
      requestId: "request-through-registry",
      binding: approvalBinding,
    });

    expect(
      store.getRequest("request-through-registry", {
        bestEffort: false,
      }),
    ).toMatchObject({
      fingerprint: card.fingerprint,
      binding: approvalBinding,
      status: "pending",
      revision: 1,
    });
    expect(
      registry.resolve(card.fingerprint, {
        requestId: card.requestId,
        fingerprint: card.fingerprint,
        binding: approvalBinding,
        sessionId: "session-1",
        decision: true,
        authority: remoteAuthority(),
        expectedRevision: card.revision,
      }),
    ).toMatchObject({
      ok: true,
      approved: true,
      revision: 2,
    });
    expect(
      makeStore().getRequest("request-through-registry", {
        bestEffort: false,
      }),
    ).toMatchObject({
      status: "resolved",
      decision: true,
      revision: 2,
    });
  });

  it("derives deterministic, non-disclosing state paths per session", () => {
    const first = defaultApprovalAuthorityStatePath("../sensitive/session");
    const same = defaultApprovalAuthorityStatePath("../sensitive/session");
    const different = defaultApprovalAuthorityStatePath("another-session");

    expect(first).toBe(same);
    expect(first).not.toBe(different);
    expect(path.basename(first)).toMatch(/^session-[0-9a-f]{32}\.json$/);
    expect(first).not.toContain("sensitive");
  });

  it("keeps exact request retries idempotent without reopening terminal state", () => {
    const store = makeStore();
    const input = {
      requestId: "request-idempotent",
      descriptor: descriptor(),
      binding: binding(),
    };
    const first = store.issueRequest(input);
    const second = store.issueRequest(input);

    expect(second).toMatchObject({
      fingerprint: first.fingerprint,
      revision: first.revision,
      status: "pending",
      duplicate: true,
    });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).generation).toBe(1);

    expect(
      store.resolveRequest("request-idempotent", resolution(first)),
    ).toMatchObject({ ok: true, approved: true });
    expect(thrownCode(() => store.issueRequest(input))).toBe(
      APPROVAL_STATE_ERROR_CODES.CONFLICT,
    );
  });

  it("persists an authorized resolve before returning approval", () => {
    const firstProcess = makeStore();
    const card = firstProcess.issueRequest({
      requestId: "request-2",
      descriptor: descriptor(),
      binding: binding(),
    });

    const restarted = makeStore();
    expect(restarted.resolveRequest("request-2", resolution(card))).toEqual({
      ok: true,
      approved: true,
      reason: null,
      requestId: "request-2",
      revision: 2,
    });

    const durable = makeStore().getRequest("request-2", {
      bestEffort: false,
    });
    expect(durable).toMatchObject({
      status: "resolved",
      decision: true,
      revision: 2,
      resolvedAt: now,
    });
    expect(durable.resolvedAuthority).toContain("origin=remote");
    expect(durable.resolvedAuthority).toContain("authority=approve");
  });

  it("persists an explicit denial without authorizing a side effect", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-denied",
      descriptor: descriptor(),
      binding: binding(),
    });

    expect(
      store.resolveRequest(
        "request-denied",
        resolution(card, { decision: false }),
      ),
    ).toMatchObject({
      ok: true,
      approved: false,
      reason: null,
    });
    expect(
      makeStore().getRequest("request-denied", {
        bestEffort: false,
      }),
    ).toMatchObject({
      status: "rejected",
      decision: false,
      revision: 2,
    });
  });

  it("rejects unauthorized, cross-session, fingerprint, and binding substitutions", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-bound",
      descriptor: descriptor(),
      binding: binding(),
    });

    expect(
      store.resolveRequest(
        "request-bound",
        resolution(card, {
          authority: {
            origin: ORIGIN.MODEL,
            sessionId: "session-1",
          },
        }),
      ),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "authority-denied",
    });
    expect(
      store.resolveRequest(
        "request-bound",
        resolution(card, {
          sessionId: "session-2",
          authority: remoteAuthority("session-2"),
        }),
      ),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "session-mismatch",
    });
    expect(
      store.resolveRequest(
        "request-bound",
        resolution(card, {
          fingerprint: computeOperationFingerprint(
            descriptor({ targetEnv: "ssh:other" }),
          ),
        }),
      ),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "fingerprint-mismatch",
    });
    expect(
      store.resolveRequest(
        "request-bound",
        resolution(card, {
          binding: binding({ toolCallId: "different-tool-call" }),
        }),
      ),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "binding-mismatch",
    });

    expect(
      store.getRequest("request-bound", { bestEffort: false }),
    ).toMatchObject({
      status: "pending",
      revision: 1,
    });
    expect(
      store.resolveRequest("request-bound", resolution(card)),
    ).toMatchObject({
      ok: true,
      approved: true,
    });
  });

  it("uses a record revision as a compare-and-swap token", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-cas",
      descriptor: descriptor(),
      binding: binding(),
    });

    expect(
      store.resolveRequest(
        "request-cas",
        resolution(card, { expectedRevision: card.revision + 1 }),
      ),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "stale-revision",
    });
    expect(store.resolveRequest("request-cas", resolution(card))).toMatchObject(
      {
        ok: true,
        approved: true,
        revision: 2,
      },
    );
  });

  it("allows only one resolver across independent store instances", () => {
    const issuer = makeStore();
    const card = issuer.issueRequest({
      requestId: "request-race",
      descriptor: descriptor(),
      binding: binding(),
    });
    const resolverA = makeStore();
    const resolverB = makeStore();
    const snapshotA = resolverA.getRequest("request-race", {
      bestEffort: false,
    });
    const snapshotB = resolverB.getRequest("request-race", {
      bestEffort: false,
    });

    expect(snapshotA.revision).toBe(1);
    expect(snapshotB.revision).toBe(1);
    expect(
      resolverA.resolveRequest(
        "request-race",
        resolution(card, { expectedRevision: snapshotA.revision }),
      ),
    ).toMatchObject({
      ok: true,
      approved: true,
    });
    expect(
      resolverB.resolveRequest(
        "request-race",
        resolution(card, { expectedRevision: snapshotB.revision }),
      ),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "duplicate",
    });
  });

  it("atomically retires an expired request and never returns approval", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-expired",
      descriptor: descriptor(),
      binding: binding(),
    });
    now = 2_001;

    expect(
      store.resolveRequest("request-expired", resolution(card, { now })),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "expired",
    });
    expect(
      makeStore().getRequest("request-expired", {
        bestEffort: false,
      }),
    ).toMatchObject({
      status: "expired",
      decision: null,
      revision: 2,
    });
  });

  it("persists timeout cancellation and never revives the expired request", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-timeout",
      descriptor: descriptor(),
      binding: binding(),
    });

    expect(
      store.cancelRequest("request-timeout", {
        expectedRevision: card.revision,
        reason: "timeout",
        now,
      }),
    ).toEqual({
      ok: true,
      approved: false,
      reason: "expired",
      requestId: "request-timeout",
      revision: 2,
    });
    expect(
      store.resolveRequest("request-timeout", resolution(card)),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "expired",
    });
  });

  it("supersedes an older card for the same logical operation", () => {
    const store = makeStore();
    const first = store.issueRequest({
      requestId: "request-old",
      descriptor: descriptor(),
      binding: binding(),
    });
    const second = store.issueRequest({
      requestId: "request-new",
      descriptor: descriptor({ notAfter: 3_000 }),
      binding: binding({ toolCallId: "tool-call-2" }),
    });

    expect(
      store.getRequest("request-old", { bestEffort: false }),
    ).toMatchObject({
      status: "superseded",
      supersededBy: "request-new",
      revision: 2,
    });
    expect(
      store.resolveRequest("request-old", resolution(first)),
    ).toMatchObject({
      ok: false,
      approved: false,
      reason: "superseded",
    });
    expect(
      store.resolveRequest(
        "request-new",
        resolution(second, {
          binding: binding({ toolCallId: "tool-call-2" }),
        }),
      ),
    ).toMatchObject({
      ok: true,
      approved: true,
    });
  });

  it("fails closed when the critical state lock is unavailable", () => {
    const unavailableLock = () => {
      const error = new Error("contended");
      error.code = "STATE_LOCK_UNAVAILABLE";
      throw error;
    };
    const locked = makeStore({ _lock: unavailableLock });

    expect(
      thrownCode(() =>
        locked.issueRequest({
          requestId: "request-lock",
          descriptor: descriptor(),
          binding: binding(),
        }),
      ),
    ).toBe(APPROVAL_STATE_ERROR_CODES.LOCK_UNAVAILABLE);

    const stable = makeStore();
    const card = stable.issueRequest({
      requestId: "request-lock-resolve",
      descriptor: descriptor(),
      binding: binding(),
    });
    expect(
      thrownCode(() =>
        locked.resolveRequest("request-lock-resolve", resolution(card)),
      ),
    ).toBe(APPROVAL_STATE_ERROR_CODES.LOCK_UNAVAILABLE);
    expect(
      stable.getRequest("request-lock-resolve", {
        bestEffort: false,
      }),
    ).toMatchObject({ status: "pending", revision: 1 });
  });

  it("does not expose approval when atomic replacement fails", () => {
    const stable = makeStore();
    const card = stable.issueRequest({
      requestId: "request-write-failure",
      descriptor: descriptor(),
      binding: binding(),
    });
    const failing = makeStore({
      _beforeRename: () => {
        throw new Error("simulated disk failure");
      },
    });

    expect(
      thrownCode(() =>
        failing.resolveRequest("request-write-failure", resolution(card)),
      ),
    ).toBe(APPROVAL_STATE_ERROR_CODES.WRITE_FAILED);
    expect(
      makeStore().getRequest("request-write-failure", {
        bestEffort: false,
      }),
    ).toMatchObject({
      status: "pending",
      revision: 1,
    });
    expect(
      fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("fails closed when critical state cannot be read", () => {
    const stable = makeStore();
    const card = stable.issueRequest({
      requestId: "request-read-failure",
      descriptor: descriptor(),
      binding: binding(),
    });
    const failingFs = Object.create(fs);
    failingFs.readFileSync = () => {
      const error = new Error("simulated read failure");
      error.code = "EACCES";
      throw error;
    };
    const failing = makeStore({ _fs: failingFs });

    expect(
      thrownCode(() =>
        failing.resolveRequest("request-read-failure", resolution(card)),
      ),
    ).toBe(APPROVAL_STATE_ERROR_CODES.READ_FAILED);
    expect(
      stable.getRequest("request-read-failure", {
        bestEffort: false,
      }),
    ).toMatchObject({ status: "pending", revision: 1 });
  });

  it("keeps advisory reads best-effort but critical resolve strict on corruption", () => {
    const store = makeStore();
    const card = store.issueRequest({
      requestId: "request-corrupt",
      descriptor: descriptor(),
      binding: binding(),
    });
    fs.writeFileSync(filePath, "{not-json", "utf8");

    expect(store.listRequests()).toEqual([]);
    expect(store.getRequest("request-corrupt")).toBeNull();
    expect(
      thrownCode(() =>
        store.resolveRequest("request-corrupt", resolution(card)),
      ),
    ).toBe(APPROVAL_STATE_ERROR_CODES.CORRUPT);
  });

  it("does not let an advisory audit sink failure weaken critical state", () => {
    const store = makeStore({
      onAudit: () => {
        throw new Error("audit sink offline");
      },
    });
    const card = store.issueRequest({
      requestId: "request-audit",
      descriptor: descriptor(),
      binding: binding(),
    });

    expect(
      store.resolveRequest("request-audit", resolution(card)),
    ).toMatchObject({
      ok: true,
      approved: true,
    });
    expect(
      makeStore().getRequest("request-audit", {
        bestEffort: false,
      }),
    ).toMatchObject({ status: "resolved" });
  });
});

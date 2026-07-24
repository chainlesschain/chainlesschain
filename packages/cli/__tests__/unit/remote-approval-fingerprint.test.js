/**
 * RemoteApprovalBridge §8.2 cross-device operation fingerprint. Drives the
 * bridge offline (no WS server): `_publish` is overridden to capture the
 * permission.request so the test can echo the SAME durable capability tuple
 * back. Missing / mismatched / stale / expired resolutions fail closed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";
import { computeOperationFingerprint } from "../../src/lib/operation-fingerprint.js";

const bridges = [];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeBridge(now, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-remote-approval-"),
  );
  temporaryDirectories.push(directory);
  const bridge = new RemoteApprovalBridge({
    wsUrl: "ws://127.0.0.1:1",
    agentSessionId: "offline-1",
    approvalStateFile: path.join(directory, "approval-state.json"),
    ...(now ? { now } : {}),
    ...options,
  });
  bridge.remoteSessionId = "rs-1"; // pretend a session is registered
  bridge._captured = [];
  bridge._publish = (event) => bridge._captured.push(event);
  bridges.push(bridge);
  return bridge;
}

function lastRequest(bridge) {
  return [...bridge._captured]
    .reverse()
    .find((e) => e.type === "permission.request");
}

function resolveFrame(request, extra = {}) {
  const requestId = typeof request === "string" ? request : request?.requestId;
  const tuple =
    request && typeof request === "object"
      ? {
          fingerprint: request.fingerprint,
          binding: request.binding,
          revision: request.revision,
        }
      : {};
  return {
    type: "remote-session-control",
    remoteSessionId: "rs-1",
    from: "paired-device-1",
    event: {
      type: "approval.resolve",
      requestId,
      answer: true,
      ...tuple,
      ...extra,
    },
  };
}

// "did the decision settle within a beat?" — deterministic non-settlement check.
async function raced(decision) {
  return Promise.race([
    decision.then((d) => ({ settled: true, d })),
    new Promise((r) => setTimeout(() => r({ settled: false }), 40)),
  ]);
}

describe("remote approval fingerprint binding (§8.2 full tuple)", () => {
  it("settles when the resolve echoes the published fingerprint", async () => {
    const bridge = makeBridge();
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 5000,
    });
    const req = lastRequest(bridge);
    expect(req.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    bridge._onServerEvent(resolveFrame(req));
    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
  });

  it("rejects a resolve whose fingerprint is for a DIFFERENT operation", async () => {
    const bridge = makeBridge();
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 200,
    });
    const wrong = computeOperationFingerprint({
      toolName: "run_shell",
      params: "rm -rf /",
    });
    bridge._onServerEvent(
      resolveFrame(lastRequest(bridge), { fingerprint: wrong }),
    );
    // Stays pending → fails closed on timeout.
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "timeout",
      from: null,
    });
  });

  it("rejects a resolve bound to a DIFFERENT session (stale context)", async () => {
    const bridge = makeBridge();
    const decision = bridge.requestDecision({
      tool: "git",
      detail: "push",
      timeoutMs: 200,
    });
    const req = lastRequest(bridge);
    // Same tool/params but a fingerprint computed for another session must not
    // match this ask's card.
    const otherSession = computeOperationFingerprint({
      toolName: "git",
      params: "push",
      session: "someone-elses-session",
      notBefore: req.notBefore,
      notAfter: req.notAfter,
    });
    expect(otherSession).not.toBe(req.fingerprint);
    bridge._onServerEvent(resolveFrame(req, { fingerprint: otherSession }));
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "timeout",
      from: null,
    });
  });

  it("rejects a legacy resolve that omits the durable capability tuple", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "git",
      action: "push",
      timeoutMs: 100,
      onRequestId: (id) => (requestId = id),
    });
    bridge._onServerEvent(resolveFrame(requestId));
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "timeout",
      from: null,
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approval.resolve",
          requestId,
          reason: "fingerprint-required",
        }),
      ]),
    );
  });

  it("rejects a resolve after the validity window expired", async () => {
    let clock = 1000;
    const bridge = makeBridge(() => clock);
    // Huge real timeout so the wall-clock timer never fires during the test; the
    // INJECTED clock drives the validity window.
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "deploy",
      timeoutMs: 10_000_000,
    });
    const req = lastRequest(bridge);
    // Jump the injected clock past notAfter, then resolve with the right fp.
    clock = req.notAfter + 1;
    bridge._onServerEvent(resolveFrame(req));
    const outcome = await raced(decision);
    expect(outcome.settled).toBe(false); // expired card never settled the gate
  });

  it("publishes fingerprint + short id + secret-free summary on the request", () => {
    const bridge = makeBridge();
    bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 5000,
    });
    const req = lastRequest(bridge);
    expect(req.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    expect(req.binding).toMatch(/^ab_[0-9a-f]{32}$/);
    expect(req.revision).toBe(1);
    expect(req.shortId).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    // Summary carries the tool + session coord but NOT the raw command value.
    expect(req.summary).toContain("run_shell");
    expect(req.summary).toContain("sess:offline-1");
    expect(req.summary).not.toContain("npm publish");
    // The raw command still rides `detail` (the human legitimately sees it).
    expect(req.detail).toBe("npm publish");
    expect(typeof req.notBefore).toBe("number");
    expect(req.notAfter).toBeGreaterThan(req.notBefore);
    expect(
      bridge._approvalStore.getRequest(req.requestId, {
        bestEffort: false,
      }),
    ).toMatchObject({
      fingerprint: req.fingerprint,
      binding: req.binding,
      revision: req.revision,
      status: "pending",
    });
  });

  it("does not publish a card when durable issue fails", async () => {
    const error = new Error("lock unavailable");
    error.code = "CC_APPROVAL_STATE_LOCK_UNAVAILABLE";
    const bridge = makeBridge(null, {
      approvalStore: {
        issueRequest() {
          throw error;
        },
        resolveRequest() {
          throw error;
        },
        cancelRequest() {
          throw error;
        },
      },
    });
    let requestIdObserved = false;

    await expect(
      bridge.requestDecision({
        tool: "run_shell",
        detail: "do-not-log-this-secret",
        onRequestId: () => {
          requestIdObserved = true;
        },
      }),
    ).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_APPROVAL_STATE_LOCK_UNAVAILABLE",
    });
    expect(requestIdObserved).toBe(false);
    expect(lastRequest(bridge)).toBeUndefined();
    expect(JSON.stringify(bridge.getSecurityErrors())).not.toContain(
      "do-not-log-this-secret",
    );
  });

  it("denies when the resolve CAS cannot be durably written", async () => {
    const bridge = makeBridge();
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "another-secret-command",
      timeoutMs: 5000,
    });
    const request = lastRequest(bridge);
    bridge._approvalStore._beforeRename = () => {
      throw new Error("simulated disk failure");
    };

    bridge._onServerEvent(resolveFrame(request));

    await expect(decision).resolves.toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_APPROVAL_STATE_WRITE_FAILED",
    });
    expect(bridge.getSecurityErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approval.resolve",
          requestId: request.requestId,
          reason: "state-unavailable",
          errorCode: "CC_APPROVAL_STATE_WRITE_FAILED",
        }),
      ]),
    );
    expect(JSON.stringify(bridge.getSecurityErrors())).not.toContain(
      "another-secret-command",
    );
  });
});

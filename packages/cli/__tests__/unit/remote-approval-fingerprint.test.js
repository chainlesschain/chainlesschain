/**
 * RemoteApprovalBridge §8.2 cross-device operation fingerprint. Drives the
 * bridge offline (no WS server): `_publish` is overridden to capture the
 * permission.request so the test can echo the SAME fingerprint back, and
 * `_onServerEvent` is exercised directly with matching / mismatching / absent /
 * stale-context / expired resolves. The fingerprint now binds the full tuple
 * (tool + params + session + workspace + env + policy + validity window), so an
 * approval never carries to a different operation or a changed context.
 */
import { describe, it, expect } from "vitest";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";
import { computeOperationFingerprint } from "../../src/lib/operation-fingerprint.js";

function makeBridge(now) {
  const bridge = new RemoteApprovalBridge({
    wsUrl: "ws://127.0.0.1:1",
    agentSessionId: "offline-1",
    ...(now ? { now } : {}),
  });
  bridge.remoteSessionId = "rs-1"; // pretend a session is registered
  bridge._captured = [];
  bridge._publish = (event) => bridge._captured.push(event);
  return bridge;
}

function lastRequest(bridge) {
  return [...bridge._captured]
    .reverse()
    .find((e) => e.type === "permission.request");
}

function resolveFrame(requestId, extra) {
  return {
    type: "remote-session-control",
    remoteSessionId: "rs-1",
    event: { type: "approval.resolve", requestId, answer: true, ...extra },
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
    let requestId;
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 5000,
      onRequestId: (id) => (requestId = id),
    });
    const req = lastRequest(bridge);
    expect(req.fingerprint).toMatch(/^opf_[0-9a-f]{40}$/);
    bridge._onServerEvent(
      resolveFrame(requestId, { fingerprint: req.fingerprint }),
    );
    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
  });

  it("rejects a resolve whose fingerprint is for a DIFFERENT operation", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "npm publish",
      timeoutMs: 200,
      onRequestId: (id) => (requestId = id),
    });
    const wrong = computeOperationFingerprint({
      toolName: "run_shell",
      params: "rm -rf /",
    });
    bridge._onServerEvent(resolveFrame(requestId, { fingerprint: wrong }));
    // Stays pending → fails closed on timeout.
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "timeout",
      from: null,
    });
  });

  it("rejects a resolve bound to a DIFFERENT session (stale context)", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "git",
      detail: "push",
      timeoutMs: 200,
      onRequestId: (id) => (requestId = id),
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
    bridge._onServerEvent(
      resolveFrame(requestId, { fingerprint: otherSession }),
    );
    await expect(decision).resolves.toEqual({
      approved: false,
      via: "timeout",
      from: null,
    });
  });

  it("settles a legacy resolve that carries no fingerprint (backward compatible)", async () => {
    const bridge = makeBridge();
    let requestId;
    const decision = bridge.requestDecision({
      tool: "git",
      action: "push",
      timeoutMs: 5000,
      onRequestId: (id) => (requestId = id),
    });
    bridge._onServerEvent(resolveFrame(requestId, {})); // no fingerprint field
    await expect(decision).resolves.toMatchObject({
      approved: true,
      via: "remote",
    });
  });

  it("rejects a resolve after the validity window expired", async () => {
    let clock = 1000;
    const bridge = makeBridge(() => clock);
    let requestId;
    // Huge real timeout so the wall-clock timer never fires during the test; the
    // INJECTED clock drives the validity window.
    const decision = bridge.requestDecision({
      tool: "run_shell",
      detail: "deploy",
      timeoutMs: 10_000_000,
      onRequestId: (id) => (requestId = id),
    });
    const req = lastRequest(bridge);
    // Jump the injected clock past notAfter, then resolve with the right fp.
    clock = req.notAfter + 1;
    bridge._onServerEvent(
      resolveFrame(requestId, { fingerprint: req.fingerprint }),
    );
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
    expect(req.shortId).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    // Summary carries the tool + session coord but NOT the raw command value.
    expect(req.summary).toContain("run_shell");
    expect(req.summary).toContain("sess:offline-1");
    expect(req.summary).not.toContain("npm publish");
    // The raw command still rides `detail` (the human legitimately sees it).
    expect(req.detail).toBe("npm publish");
    expect(typeof req.notBefore).toBe("number");
    expect(req.notAfter).toBeGreaterThan(req.notBefore);
  });
});

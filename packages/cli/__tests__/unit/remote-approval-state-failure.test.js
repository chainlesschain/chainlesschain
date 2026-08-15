import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteApprovalBridge } from "../../src/lib/remote-approval-bridge.js";

const bridges = [];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeBridge() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-remote-approval-state-failure-"),
  );
  temporaryDirectories.push(directory);
  const bridge = new RemoteApprovalBridge({
    wsUrl: "ws://127.0.0.1:1",
    agentSessionId: "state-failure-session",
    approvalStateFile: path.join(directory, "approval-state.json"),
  });
  bridge.remoteSessionId = "remote-state-failure-session";
  bridge._publish = vi.fn();
  bridges.push(bridge);
  return bridge;
}

describe("RemoteApprovalBridge durable state-failure cleanup", () => {
  it("cancels the exact issued request when membership snapshot adoption fails", async () => {
    const bridge = makeBridge();
    const stateError = Object.assign(new Error("snapshot state unavailable"), {
      code: "CC_TEST_MEMBERSHIP_SNAPSHOT_UNAVAILABLE",
    });
    bridge._refreshMembershipSnapshot = vi.fn().mockRejectedValue(stateError);
    const cancel = vi.spyOn(bridge._registry, "cancel");
    let requestId = null;

    const decision = await bridge.requestDecision({
      tool: "run_shell",
      operationArgs: { command: "echo denied" },
      timeoutMs: 5_000,
      onRequestId: (issuedRequestId) => {
        requestId = issuedRequestId;
      },
    });

    expect(decision).toEqual({
      approved: false,
      via: "state-error",
      from: null,
      errorCode: "CC_TEST_MEMBERSHIP_SNAPSHOT_UNAVAILABLE",
    });
    const record = bridge._approvalStore.getRequest(requestId, {
      bestEffort: false,
    });
    expect(record).toMatchObject({
      requestId,
      status: "cancelled",
      revision: 2,
    });
    expect(cancel).toHaveBeenCalledWith(record.fingerprint, {
      requestId,
      fingerprint: record.fingerprint,
      binding: record.binding,
      expectedRevision: 1,
      reason: "state-failure",
      now: expect.any(Number),
    });
    expect(bridge._pending.has(requestId)).toBe(false);
  });
});

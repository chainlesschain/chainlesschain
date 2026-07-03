import { describe, expect, it, vi } from "vitest";
import {
  RemoteSessionPushDispatcher,
  isApprovalRequestEvent,
} from "../../src/harness/remote-session-push.js";

describe("isApprovalRequestEvent", () => {
  it("matches approval / permission requests but not their resolutions", () => {
    expect(isApprovalRequestEvent("approval_request")).toBe(true);
    expect(isApprovalRequestEvent("permission.request")).toBe(true);
    expect(isApprovalRequestEvent("tool_permission")).toBe(true);
    expect(isApprovalRequestEvent("approval.resolved")).toBe(false);
    expect(isApprovalRequestEvent("permission_resolved")).toBe(false);
    expect(isApprovalRequestEvent("assistant_message")).toBe(false);
    expect(isApprovalRequestEvent(undefined)).toBe(false);
  });
});

describe("RemoteSessionPushDispatcher", () => {
  it("is disabled and records a skip without a sender", async () => {
    const dispatcher = new RemoteSessionPushDispatcher();
    expect(dispatcher.enabled).toBe(false);
    const outcome = await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
    });
    expect(outcome).toEqual({ status: "skipped", reason: "no-sender" });
    expect(dispatcher.stats.skipped).toBe(1);
  });

  it("skips when no token is present even with a sender", async () => {
    const sender = vi.fn();
    const dispatcher = new RemoteSessionPushDispatcher({ sender });
    const outcome = await dispatcher.dispatch({ clientId: "phone" });
    expect(outcome).toEqual({ status: "skipped", reason: "no-token" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("delivers through the injected sender and reports sent", async () => {
    const sender = vi.fn(async () => ({ id: "msg-1" }));
    const dispatcher = new RemoteSessionPushDispatcher({
      sender,
      provider: "fcm",
    });
    const outcome = await dispatcher.dispatch({
      token: "fcm-token",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "..." },
      dedupeKey: "req-1",
    });
    expect(outcome.status).toBe("sent");
    expect(outcome.provider).toBe("fcm");
    expect(outcome.result).toEqual({ id: "msg-1" });
    expect(sender).toHaveBeenCalledWith({
      token: "fcm-token",
      provider: "fcm",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "..." },
    });
    expect(dispatcher.stats.sent).toBe(1);
  });

  it("prefers a per-dispatch provider over the default", async () => {
    const sender = vi.fn(async () => ({}));
    const dispatcher = new RemoteSessionPushDispatcher({
      sender,
      provider: "fcm",
    });
    await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
      provider: "hms",
    });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "hms" }),
    );
  });

  it("deduplicates repeated wake-ups within the window", async () => {
    let clock = 1_000;
    const sender = vi.fn(async () => ({}));
    const dispatcher = new RemoteSessionPushDispatcher({
      sender,
      now: () => clock,
      dedupeWindowMs: 5_000,
    });
    const first = await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
      dedupeKey: "req-1",
    });
    const dup = await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
      dedupeKey: "req-1",
    });
    expect(first.status).toBe("sent");
    expect(dup).toEqual({ status: "skipped", reason: "deduplicated" });
    expect(sender).toHaveBeenCalledTimes(1);

    // A different client with the same key is NOT a duplicate.
    const otherClient = await dispatcher.dispatch({
      token: "t",
      clientId: "tablet",
      dedupeKey: "req-1",
    });
    expect(otherClient.status).toBe("sent");

    // Once the window elapses the same key sends again.
    clock += 6_000;
    const after = await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
      dedupeKey: "req-1",
    });
    expect(after.status).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(3);
  });

  it("never throws when the sender rejects and records a failure", async () => {
    const sender = vi.fn(async () => {
      throw new Error("FCM 503");
    });
    const dispatcher = new RemoteSessionPushDispatcher({ sender });
    const outcome = await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
    });
    expect(outcome).toEqual({
      status: "failed",
      error: "FCM 503",
      code: null,
    });
    expect(dispatcher.stats.failed).toBe(1);
  });

  it("propagates a typed error code so the caller can prune dead tokens", async () => {
    const sender = vi.fn(async () => {
      const error = new Error("token gone");
      error.code = "PUSH_TOKEN_UNREGISTERED";
      throw error;
    });
    const dispatcher = new RemoteSessionPushDispatcher({ sender });
    const outcome = await dispatcher.dispatch({
      token: "t",
      clientId: "phone",
    });
    expect(outcome).toEqual({
      status: "failed",
      error: "token gone",
      code: "PUSH_TOKEN_UNREGISTERED",
    });
  });

  it("builds from env with a default provider and injected sender", async () => {
    const sender = vi.fn(async () => ({}));
    const dispatcher = RemoteSessionPushDispatcher.fromEnv(
      { CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER: "hms" },
      { sender },
    );
    expect(dispatcher.enabled).toBe(true);
    await dispatcher.dispatch({ token: "t", clientId: "phone" });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "hms" }),
    );
  });
});

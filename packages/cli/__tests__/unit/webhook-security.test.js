import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  WebhookSecurityGate,
  readBoundedWebhookBody,
  signWebhookBody,
} from "../../src/lib/webhook-security.js";

const SECRET = "fixture-secret-at-least-16-characters";

function headers(body, overrides = {}) {
  const timestamp = overrides.timestamp || "1700000000000";
  return {
    "x-cc-webhook-timestamp": timestamp,
    "x-cc-webhook-delivery": overrides.delivery || "delivery-1",
    "x-cc-webhook-signature": signWebhookBody(SECRET, timestamp, body),
    ...overrides.headers,
  };
}

describe("orchestrate webhook security", () => {
  it("fails closed without a configured secret", () => {
    expect(() => new WebhookSecurityGate({ secret: "" })).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_SECRET_REQUIRED" }),
    );
  });

  it("authenticates origin and rejects signature drift and replay", () => {
    const body = JSON.stringify({ text: "task" });
    const gate = new WebhookSecurityGate({
      secret: SECRET,
      now: () => 1_700_000_000_000,
    });
    expect(
      gate.verify({
        channel: "dingtalk",
        headers: headers(body),
        body,
        remoteAddress: "127.0.0.1",
      }),
    ).toMatchObject({
      deliveryId: "delivery-1",
      dataPolicy: {
        origin: "webhook:dingtalk:delivery-1",
        trust: "authenticated_user",
      },
    });
    expect(() =>
      gate.verify({
        channel: "dingtalk",
        headers: headers(body),
        body,
        remoteAddress: "127.0.0.1",
      }),
    ).toThrowError(expect.objectContaining({ code: "CC_WEBHOOK_REPLAYED" }));
    expect(() =>
      gate.verify({
        channel: "dingtalk",
        headers: headers(`${body}drift`, { delivery: "delivery-2" }),
        body,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_AUTH_INVALID" }),
    );
  });

  it("enforces timestamp, rate, and body bounds", async () => {
    const body = "{}";
    const gate = new WebhookSecurityGate({
      secret: SECRET,
      now: () => 1_700_000_000_000,
      maxRequestsPerMinute: 1,
    });
    expect(() =>
      gate.verify({
        channel: "feishu",
        headers: headers(body, { timestamp: "1", delivery: "old" }),
        body,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_AUTH_INVALID" }),
    );
    expect(() =>
      gate.verify({
        channel: "feishu",
        headers: headers(body, { delivery: "second" }),
        body,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_RATE_LIMITED" }),
    );

    const request = new EventEmitter();
    const read = readBoundedWebhookBody(request, 3);
    request.emit("data", Buffer.from("1234"));
    request.emit("end");
    await expect(read).rejects.toEqual(
      expect.objectContaining({ code: "CC_WEBHOOK_BODY_TOO_LARGE" }),
    );
  });
});

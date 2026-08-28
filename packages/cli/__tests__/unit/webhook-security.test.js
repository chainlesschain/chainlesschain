import { EventEmitter } from "node:events";
import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WebhookSecurityGate,
  readBoundedWebhookBody,
  signDingTalkWebhook,
  signFeishuWebhook,
  signWeComWebhook,
  signWebhookBody,
} from "../../src/lib/webhook-security.js";

const SECRET = "fixture-secret-at-least-16-characters";
const NOW = 1_700_000_000_000;

function headers(body, overrides = {}) {
  const timestamp = overrides.timestamp || "1700000000000";
  return {
    "x-cc-webhook-timestamp": timestamp,
    "x-cc-webhook-delivery": overrides.delivery || "delivery-1",
    "x-cc-webhook-signature": signWebhookBody(SECRET, timestamp, body),
    ...overrides.headers,
  };
}

function encryptFeishu(encryptKey, plaintext) {
  const key = createHash("sha256").update(encryptKey).digest();
  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([
    iv,
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]).toString("base64");
}

function encryptWeCom(encodingAesKey, plaintext, receiveId) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const message = Buffer.from(plaintext, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length);
  const envelope = Buffer.concat([
    Buffer.alloc(16, 9),
    length,
    message,
    Buffer.from(receiveId, "utf8"),
  ]);
  const paddingLength = 32 - (envelope.length % 32);
  const padded = Buffer.concat([
    envelope,
    Buffer.alloc(paddingLength, paddingLength),
  ]);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
    "base64",
  );
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
      now: () => NOW,
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
      now: () => NOW,
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

  it("authenticates DingTalk native headers without accepting CC headers", () => {
    const timestamp = String(NOW);
    const body = JSON.stringify({
      msgId: "ding-delivery-1",
      msgtype: "text",
      text: { content: "ship release" },
    });
    const gate = new WebhookSecurityGate({
      authMode: "vendor",
      vendorCredentials: { dingtalkSecret: SECRET },
      now: () => NOW,
    });

    expect(
      gate.verify({
        channel: "dingtalk",
        headers: {
          timestamp,
          sign: signDingTalkWebhook(SECRET, timestamp),
        },
        body,
      }),
    ).toMatchObject({
      authMode: "vendor",
      deliveryId: "ding-delivery-1",
      body,
    });
    expect(() =>
      gate.verify({
        channel: "dingtalk",
        headers: headers(body, { delivery: "cc-bypass" }),
        body,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_AUTH_INVALID" }),
    );
  });

  it("verifies and decrypts Feishu native event envelopes", () => {
    const encryptKey = "feishu-event-encrypt-key";
    const timestamp = String(NOW / 1000);
    const nonce = "feishu-nonce";
    const plaintext = JSON.stringify({
      schema: "2.0",
      header: {
        event_id: "feishu-event-1",
        event_type: "im.message.receive_v1",
      },
      event: { message: { content: '{"text":"review patch"}' } },
    });
    const body = JSON.stringify({
      encrypt: encryptFeishu(encryptKey, plaintext),
    });
    const gate = new WebhookSecurityGate({
      authMode: "vendor",
      vendorCredentials: { feishuEncryptKey: encryptKey },
      now: () => NOW,
    });

    expect(
      gate.verify({
        channel: "feishu",
        headers: {
          "x-lark-request-timestamp": timestamp,
          "x-lark-request-nonce": nonce,
          "x-lark-signature": signFeishuWebhook(
            encryptKey,
            timestamp,
            nonce,
            body,
          ),
        },
        body,
      }),
    ).toMatchObject({
      deliveryId: "feishu-event-1",
      body: plaintext,
    });

    expect(() =>
      new WebhookSecurityGate({
        authMode: "vendor",
        vendorCredentials: { feishuEncryptKey: encryptKey },
        now: () => NOW,
      }).verify({
        channel: "feishu",
        headers: {
          "x-lark-request-timestamp": timestamp,
          "x-lark-request-nonce": nonce,
          "x-lark-signature": "0".repeat(64),
        },
        body,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_AUTH_INVALID" }),
    );
  });

  it("verifies, decrypts, and binds WeCom callbacks to the receiver", () => {
    const token = "wecom-token";
    const encodingAesKey = Buffer.alloc(32, 4)
      .toString("base64")
      .replace(/=$/u, "");
    const receiveId = "corp-fixture";
    const timestamp = String(NOW / 1000);
    const nonce = "wecom-nonce";
    const plaintext =
      "<xml><Content><![CDATA[run checks]]></Content><MsgId>wecom-msg-1</MsgId></xml>";
    const encrypted = encryptWeCom(encodingAesKey, plaintext, receiveId);
    const signature = signWeComWebhook(token, timestamp, nonce, encrypted);
    const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
    const credentials = {
      wecomToken: token,
      wecomEncodingAesKey: encodingAesKey,
      wecomReceiveId: receiveId,
    };
    const gate = new WebhookSecurityGate({
      authMode: "vendor",
      vendorCredentials: credentials,
      now: () => NOW,
    });

    expect(
      gate.verify({
        channel: "wecom",
        query: { timestamp, nonce, msg_signature: signature },
        body,
      }),
    ).toMatchObject({ deliveryId: "wecom-msg-1", body: plaintext });

    const encryptedEcho = encryptWeCom(
      encodingAesKey,
      "wecom-echo-ok",
      receiveId,
    );
    expect(
      gate.verifyWeComUrl({
        query: {
          timestamp,
          nonce: "echo-nonce",
          echostr: encryptedEcho,
          msg_signature: signWeComWebhook(
            token,
            timestamp,
            "echo-nonce",
            encryptedEcho,
          ),
        },
      }),
    ).toEqual({ echo: "wecom-echo-ok" });

    expect(() =>
      new WebhookSecurityGate({
        authMode: "vendor",
        vendorCredentials: { ...credentials, wecomReceiveId: "wrong-corp" },
        now: () => NOW,
      }).verify({
        channel: "wecom",
        query: { timestamp, nonce, msg_signature: signature },
        body,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_AUTH_INVALID" }),
    );
  });

  it("fails closed for missing vendor credentials and invalid auth modes", () => {
    expect(
      () => new WebhookSecurityGate({ authMode: "anything-else" }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_WEBHOOK_AUTH_MODE_INVALID" }),
    );
    expect(() =>
      new WebhookSecurityGate({ authMode: "vendor", now: () => NOW }).verify({
        channel: "dingtalk",
        headers: { timestamp: String(NOW), sign: "missing" },
        body: "{}",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_WEBHOOK_VENDOR_CREDENTIAL_REQUIRED",
        statusCode: 503,
      }),
    );
  });
});

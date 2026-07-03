import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createRemoteSessionPushSender } from "../../src/harness/remote-session-push-senders.js";

const fcmKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).privateKey;

const apnsKey = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
}).privateKey;

const fcmServiceAccount = JSON.stringify({
  client_email: "pusher@demo.iam.gserviceaccount.com",
  private_key: fcmKey,
  token_uri: "https://oauth2.test/token",
  project_id: "demo-project",
});

describe("createRemoteSessionPushSender provider dispatch", () => {
  it("defaults to FCM and builds it from FCM env", () => {
    const sender = createRemoteSessionPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON:
          fcmServiceAccount,
      },
      { fetch: vi.fn() },
    );
    expect(typeof sender).toBe("function");
  });

  it("routes provider=apns to the APNs sender", () => {
    const sender = createRemoteSessionPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER: "apns",
        CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_P8: apnsKey,
        CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_ID: "K",
        CHAINLESSCHAIN_REMOTE_SESSION_APNS_TEAM_ID: "T",
        CHAINLESSCHAIN_REMOTE_SESSION_APNS_TOPIC: "com.demo.app",
      },
      { request: vi.fn() },
    );
    expect(typeof sender).toBe("function");
  });

  it("does not cross providers (apns provider with only FCM env → null)", () => {
    expect(
      createRemoteSessionPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER: "apns",
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON:
          fcmServiceAccount,
      }),
    ).toBeNull();
  });

  it("routes provider=web to the Web Push sender", () => {
    const kp = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const raw = kp.publicKey.export({ type: "spki", format: "der" });
    // Derive the raw 65-byte public key + 32-byte private for VAPID.
    const jwk = kp.privateKey.export({ format: "jwk" });
    const pub = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]);
    const sender = createRemoteSessionPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER: "web",
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PUBLIC_KEY:
          pub.toString("base64url"),
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PRIVATE_KEY: jwk.d,
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_SUBJECT: "mailto:a@b",
      },
      { fetch: vi.fn() },
    );
    expect(raw.length).toBeGreaterThan(0);
    expect(typeof sender).toBe("function");
  });

  it("returns null for an unimplemented provider", () => {
    expect(
      createRemoteSessionPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER: "hms",
      }),
    ).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(createRemoteSessionPushSender({})).toBeNull();
  });
});

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

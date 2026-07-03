import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import {
  ApnsPushSender,
  ApnsTokenProvider,
  createApnsPushSender,
} from "../../src/harness/remote-session-push-apns.js";
import { PushTokenUnregisteredError } from "../../src/harness/remote-session-push-errors.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function apnsResponse(status, { body = "", apnsId } = {}) {
  return {
    status,
    headers: apnsId ? { "apns-id": apnsId } : {},
    body,
  };
}

describe("ApnsTokenProvider", () => {
  it("requires keyId, teamId and a private key", () => {
    expect(() => new ApnsTokenProvider({ teamId: "T", privateKey })).toThrow(
      /keyId/,
    );
    expect(() => new ApnsTokenProvider({ keyId: "K", privateKey })).toThrow(
      /teamId/,
    );
    expect(() => new ApnsTokenProvider({ keyId: "K", teamId: "T" })).toThrow(
      /privateKey/,
    );
  });

  it("mints an ES256 JWT with the right header and claims", () => {
    const provider = new ApnsTokenProvider({
      keyId: "KEY123",
      teamId: "TEAM456",
      privateKey,
      now: () => 1_000_000,
    });
    const jwt = provider.getToken();
    const [header, payload, signature] = jwt.split(".");
    expect(decodeJwtPart(header)).toMatchObject({
      alg: "ES256",
      kid: "KEY123",
    });
    expect(decodeJwtPart(payload)).toMatchObject({
      iss: "TEAM456",
      iat: 1000,
    });
    // The signature is a real ES256 (raw R||S) signature over header.payload.
    const ok = cryptoVerify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("caches the JWT and refreshes only after the TTL", () => {
    let clock = 0;
    const sign = vi.fn(() => Buffer.from("sig"));
    const provider = new ApnsTokenProvider({
      keyId: "K",
      teamId: "T",
      privateKey,
      now: () => clock,
      sign,
    });
    provider.getToken();
    clock = 10 * 60 * 1000; // within the 50-min window
    provider.getToken();
    expect(sign).toHaveBeenCalledTimes(1);
    clock = 50 * 60 * 1000; // past TTL minus skew
    provider.getToken();
    expect(sign).toHaveBeenCalledTimes(2);
  });
});

describe("ApnsPushSender", () => {
  const tokenProvider = { getToken: () => "jwt-abc" };

  it("validates its required options", () => {
    expect(() => new ApnsPushSender({ topic: "app" })).toThrow(/tokenProvider/);
    expect(() => new ApnsPushSender({ tokenProvider })).toThrow(/topic/);
  });

  it("posts an alert over HTTP/2 with the bearer + APNs headers", async () => {
    let captured;
    const request = vi.fn(async (req) => {
      captured = req;
      return apnsResponse(200, { apnsId: "apns-1" });
    });
    const sender = new ApnsPushSender({
      tokenProvider,
      topic: "com.demo.app",
      request,
    });

    const result = await sender.send({
      token: "device-tok",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "needs you" },
    });

    expect(result).toEqual({ id: "apns-1" });
    expect(captured.url).toBe(
      "https://api.sandbox.push.apple.com/3/device/device-tok",
    );
    expect(captured.headers).toMatchObject({
      authorization: "bearer jwt-abc",
      "apns-topic": "com.demo.app",
      "apns-push-type": "alert",
      "apns-priority": "10",
    });
    const body = JSON.parse(captured.body);
    expect(body.aps.alert).toEqual({
      title: "Approval requested",
      body: "needs you",
    });
    expect(body["remote-session"]).toEqual({
      type: "approval-request",
      sessionId: "s1",
      clientId: "phone",
    });
  });

  it("targets the production host when configured", async () => {
    let url;
    const sender = new ApnsPushSender({
      tokenProvider,
      topic: "app",
      production: true,
      request: async (req) => {
        url = req.url;
        return apnsResponse(200);
      },
    });
    await sender.send({ token: "t" });
    expect(url).toBe("https://api.push.apple.com/3/device/t");
  });

  it("requires a device token", async () => {
    const sender = new ApnsPushSender({
      tokenProvider,
      topic: "app",
      request: vi.fn(),
    });
    await expect(sender.send({})).rejects.toThrow(/device token/);
  });

  it("maps 410 and BadDeviceToken to PushTokenUnregisteredError", async () => {
    const gone = new ApnsPushSender({
      tokenProvider,
      topic: "app",
      request: async () =>
        apnsResponse(410, { body: '{"reason":"Unregistered"}' }),
    });
    await expect(gone.send({ token: "t" })).rejects.toBeInstanceOf(
      PushTokenUnregisteredError,
    );

    const bad = new ApnsPushSender({
      tokenProvider,
      topic: "app",
      request: async () =>
        apnsResponse(400, { body: '{"reason":"BadDeviceToken"}' }),
    });
    const err = await bad.send({ token: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("throws a generic error for other failures", async () => {
    const sender = new ApnsPushSender({
      tokenProvider,
      topic: "app",
      request: async () =>
        apnsResponse(500, { body: '{"reason":"InternalServerError"}' }),
    });
    await expect(sender.send({ token: "t" })).rejects.toThrow(
      /APNs send failed \(500\): InternalServerError/,
    );
  });
});

describe("createApnsPushSender", () => {
  const baseEnv = {
    CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_P8: privateKey,
    CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_ID: "KEY123",
    CHAINLESSCHAIN_REMOTE_SESSION_APNS_TEAM_ID: "TEAM456",
    CHAINLESSCHAIN_REMOTE_SESSION_APNS_TOPIC: "com.demo.app",
  };

  it("returns null when any required setting is missing", () => {
    expect(createApnsPushSender({})).toBeNull();
    const { CHAINLESSCHAIN_REMOTE_SESSION_APNS_TOPIC, ...noTopic } = baseEnv;
    expect(createApnsPushSender(noTopic)).toBeNull();
  });

  it("builds a working APNs sender from inline env credentials", async () => {
    let captured;
    const request = vi.fn(async (req) => {
      captured = req;
      return apnsResponse(200, { apnsId: "id-1" });
    });
    const sender = createApnsPushSender(baseEnv, { request });
    expect(typeof sender).toBe("function");
    const result = await sender({ token: "dev", sessionId: "s1" });
    expect(result).toEqual({ id: "id-1" });
    expect(captured.headers["apns-topic"]).toBe("com.demo.app");
    // Sandbox by default.
    expect(captured.url).toContain("api.sandbox.push.apple.com");
  });

  it("uses the production host when APNS_PRODUCTION=true", async () => {
    let url;
    const sender = createApnsPushSender(
      { ...baseEnv, CHAINLESSCHAIN_REMOTE_SESSION_APNS_PRODUCTION: "true" },
      {
        request: async (req) => {
          url = req.url;
          return apnsResponse(200);
        },
      },
    );
    await sender({ token: "dev" });
    expect(url).toContain("api.push.apple.com");
  });

  it("reads the .p8 key from a file path via injected fs", () => {
    const fsMock = { readFileSync: vi.fn(() => privateKey) };
    const { CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY_P8, ...envWithFile } =
      baseEnv;
    const sender = createApnsPushSender(
      {
        ...envWithFile,
        CHAINLESSCHAIN_REMOTE_SESSION_APNS_KEY: "/creds/key.p8",
      },
      { fs: fsMock, request: vi.fn() },
    );
    expect(typeof sender).toBe("function");
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/creds/key.p8", "utf8");
  });
});

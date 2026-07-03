import { describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  FcmV1PushSender,
  GoogleServiceAccountTokenProvider,
  PushTokenUnregisteredError,
  createFcmPushSender,
} from "../../src/harness/remote-session-push-fcm.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function serviceAccount(overrides = {}) {
  return {
    client_email: "pusher@demo.iam.gserviceaccount.com",
    private_key: privateKey,
    token_uri: "https://oauth2.test/token",
    project_id: "demo-project",
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

function decodeJwtPayload(jwt) {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("GoogleServiceAccountTokenProvider", () => {
  it("requires client_email and private_key", () => {
    expect(() => new GoogleServiceAccountTokenProvider({})).toThrow(
      /client_email and private_key/,
    );
  });

  it("mints a correctly signed JWT assertion and exchanges it for a token", async () => {
    let capturedUrl;
    let capturedAssertion;
    const fetchMock = vi.fn(async (url, init) => {
      capturedUrl = url;
      const params = new URLSearchParams(init.body);
      capturedAssertion = params.get("assertion");
      expect(params.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );
      return jsonResponse(200, { access_token: "ya29.test", expires_in: 3600 });
    });
    const provider = new GoogleServiceAccountTokenProvider(serviceAccount(), {
      fetch: fetchMock,
      now: () => 1_000_000,
    });

    const token = await provider.getAccessToken();
    expect(token).toBe("ya29.test");
    expect(capturedUrl).toBe("https://oauth2.test/token");

    // The assertion is a real RS256 JWT signed by the service account key.
    const [header, payload, signature] = capturedAssertion.split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${payload}`);
    expect(verify.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(
      true,
    );

    const claims = decodeJwtPayload(capturedAssertion);
    expect(claims).toMatchObject({
      iss: "pusher@demo.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.test/token",
      iat: 1000,
      exp: 1000 + 3600,
    });
  });

  it("caches the access token and refreshes it only after expiry", async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { access_token: `tok-${clock}`, expires_in: 3600 }),
    );
    const provider = new GoogleServiceAccountTokenProvider(serviceAccount(), {
      fetch: fetchMock,
      now: () => clock,
    });

    expect(await provider.getAccessToken()).toBe("tok-0");
    clock = 60 * 1000; // still within the 3600s window
    expect(await provider.getAccessToken()).toBe("tok-0");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock = 3600 * 1000; // past expiry (minus skew)
    expect(await provider.getAccessToken()).toBe(`tok-${clock}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the token endpoint fails or omits a token", async () => {
    const failing = new GoogleServiceAccountTokenProvider(serviceAccount(), {
      fetch: async () => textResponse(401, '{"error":"invalid_grant"}'),
    });
    await expect(failing.getAccessToken()).rejects.toThrow(/failed \(401\)/);

    const empty = new GoogleServiceAccountTokenProvider(serviceAccount(), {
      fetch: async () => jsonResponse(200, { expires_in: 3600 }),
    });
    await expect(empty.getAccessToken()).rejects.toThrow(
      /missing access_token/,
    );
  });
});

describe("FcmV1PushSender", () => {
  const tokenProvider = { getAccessToken: async () => "access-tok" };

  it("validates its required options", () => {
    expect(() => new FcmV1PushSender({ tokenProvider })).toThrow(/projectId/);
    expect(() => new FcmV1PushSender({ projectId: "p" })).toThrow(
      /tokenProvider/,
    );
  });

  it("posts a high-priority message with a bearer token and returns the id", async () => {
    let capturedUrl;
    let capturedInit;
    const fetchMock = vi.fn(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, {
        name: "projects/demo-project/messages/0:123",
      });
    });
    const sender = new FcmV1PushSender({
      projectId: "demo-project",
      tokenProvider,
      fetch: fetchMock,
    });

    const result = await sender.send({
      token: "device-tok",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "needs you" },
    });

    expect(result).toEqual({ id: "projects/demo-project/messages/0:123" });
    expect(capturedUrl).toBe(
      "https://fcm.googleapis.com/v1/projects/demo-project/messages:send",
    );
    expect(capturedInit.headers.Authorization).toBe("Bearer access-tok");
    const body = JSON.parse(capturedInit.body);
    expect(body.message).toMatchObject({
      token: "device-tok",
      notification: { title: "Approval requested", body: "needs you" },
      data: {
        type: "remote-session.approval-request",
        sessionId: "s1",
        clientId: "phone",
      },
      android: { priority: "high" },
    });
  });

  it("requires a device token", async () => {
    const sender = new FcmV1PushSender({
      projectId: "p",
      tokenProvider,
      fetch: vi.fn(),
    });
    await expect(sender.send({})).rejects.toThrow(/device token/);
  });

  it("maps a 404 and an UNREGISTERED body to PushTokenUnregisteredError", async () => {
    const sender404 = new FcmV1PushSender({
      projectId: "p",
      tokenProvider,
      fetch: async () => textResponse(404, "not found"),
    });
    await expect(sender404.send({ token: "x" })).rejects.toBeInstanceOf(
      PushTokenUnregisteredError,
    );

    const senderUnreg = new FcmV1PushSender({
      projectId: "p",
      tokenProvider,
      fetch: async () =>
        textResponse(
          400,
          '{"error":{"status":"UNREGISTERED","message":"gone"}}',
        ),
    });
    const err = await senderUnreg.send({ token: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("throws a generic error for other failures", async () => {
    const sender = new FcmV1PushSender({
      projectId: "p",
      tokenProvider,
      fetch: async () => textResponse(500, "backend error"),
    });
    await expect(sender.send({ token: "x" })).rejects.toThrow(
      /FCM send failed \(500\)/,
    );
  });
});

describe("createFcmPushSender", () => {
  it("returns null when FCM is unconfigured", () => {
    expect(createFcmPushSender({})).toBeNull();
  });

  it("returns null for a malformed service account", () => {
    expect(
      createFcmPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON: "{not json",
      }),
    ).toBeNull();
    expect(
      createFcmPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
          project_id: "p",
        }),
      }),
    ).toBeNull();
  });

  it("builds a working FCM sender from inline service-account JSON", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes("/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(200, { name: "projects/demo-project/messages/1" });
    });
    const sender = createFcmPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON:
          JSON.stringify(serviceAccount()),
      },
      { fetch: fetchMock },
    );
    expect(typeof sender).toBe("function");
    const result = await sender({ token: "dev", sessionId: "s1" });
    expect(result).toEqual({ id: "projects/demo-project/messages/1" });
    // Once for the OAuth exchange, once for the FCM send.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads the service account from a file path via injected fs", () => {
    const fsMock = {
      readFileSync: vi.fn(() => JSON.stringify(serviceAccount())),
    };
    const sender = createFcmPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT: "/creds/sa.json",
      },
      { fs: fsMock, fetch: vi.fn() },
    );
    expect(typeof sender).toBe("function");
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/creds/sa.json", "utf8");
  });

  it("honors an explicit project id override", async () => {
    let capturedUrl;
    const fetchMock = vi.fn(async (url) => {
      capturedUrl = url;
      if (url.includes("/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(200, { name: "n" });
    });
    const sender = createFcmPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(
          serviceAccount({ project_id: "ignored" }),
        ),
        CHAINLESSCHAIN_REMOTE_SESSION_FCM_PROJECT_ID: "override-project",
      },
      { fetch: fetchMock },
    );
    await sender({ token: "dev" });
    expect(capturedUrl).toContain("/projects/override-project/messages:send");
  });
});

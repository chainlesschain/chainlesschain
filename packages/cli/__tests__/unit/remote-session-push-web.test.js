import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  VapidTokenProvider,
  WebPushSender,
  createWebPushSender,
  decryptWebPushPayload,
  encryptWebPushPayload,
} from "../../src/harness/remote-session-push-web.js";
import { PushTokenUnregisteredError } from "../../src/harness/remote-session-push-errors.js";

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// A browser VAPID keypair (raw base64url), as `web-push generate-vapid-keys`.
function vapidKeys() {
  const kp = crypto.createECDH("prime256v1");
  kp.generateKeys();
  return {
    publicKey: base64url(kp.getPublicKey()),
    privateKey: base64url(kp.getPrivateKey()),
    ecdh: kp,
  };
}

// A browser PushSubscription keypair + auth secret.
function subscription(endpoint = "https://push.example.test/ep/abc") {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  return {
    ua,
    authSecret,
    json: {
      endpoint,
      keys: {
        p256dh: base64url(ua.getPublicKey()),
        auth: base64url(authSecret),
      },
    },
  };
}

describe("Web Push RFC 8291 encryption", () => {
  it("round-trips a payload the subscription owner can decrypt", () => {
    const sub = subscription();
    const body = encryptWebPushPayload({
      payload: "hello web push",
      uaPublicKey: sub.ua.getPublicKey(),
      authSecret: sub.authSecret,
    });
    const plain = decryptWebPushPayload({
      body,
      uaEcdh: sub.ua,
      authSecret: sub.authSecret,
    });
    expect(plain.toString("utf8")).toBe("hello web push");
  });

  it("produces a different ciphertext each call (fresh ephemeral key)", () => {
    const sub = subscription();
    const a = encryptWebPushPayload({
      payload: "x",
      uaPublicKey: sub.ua.getPublicKey(),
      authSecret: sub.authSecret,
    });
    const b = encryptWebPushPayload({
      payload: "x",
      uaPublicKey: sub.ua.getPublicKey(),
      authSecret: sub.authSecret,
    });
    expect(a.equals(b)).toBe(false);
  });
});

describe("VapidTokenProvider", () => {
  it("requires public/private keys and a subject", () => {
    const { publicKey, privateKey } = vapidKeys();
    expect(
      () => new VapidTokenProvider({ privateKey, subject: "mailto:a@b" }),
    ).toThrow(/publicKey/);
    expect(
      () => new VapidTokenProvider({ publicKey, subject: "mailto:a@b" }),
    ).toThrow(/privateKey/);
    expect(() => new VapidTokenProvider({ publicKey, privateKey })).toThrow(
      /subject/,
    );
  });

  it("mints an ES256 JWT bound to the endpoint origin", () => {
    const keys = vapidKeys();
    const provider = new VapidTokenProvider({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:ops@demo.test",
      now: () => 1_000_000,
    });
    const jwt = provider.getToken("https://push.example.test");
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url"))).toMatchObject({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url"))).toMatchObject({
      aud: "https://push.example.test",
      sub: "mailto:ops@demo.test",
    });
    // Verify the signature with the raw VAPID public key.
    const pub = Buffer.from(keys.publicKey, "base64url");
    const pubKey = crypto.createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64url(pub.subarray(1, 33)),
        y: base64url(pub.subarray(33, 65)),
      },
      format: "jwk",
    });
    const ok = crypto.verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: pubKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("caches a token per origin", () => {
    const keys = vapidKeys();
    const sign = vi.fn(() => Buffer.from("sig"));
    const provider = new VapidTokenProvider({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:a@b",
      now: () => 0,
      sign,
    });
    provider.getToken("https://a.test");
    provider.getToken("https://a.test");
    provider.getToken("https://b.test");
    expect(sign).toHaveBeenCalledTimes(2); // one per distinct origin
  });
});

describe("WebPushSender", () => {
  function build(fetchImpl) {
    const keys = vapidKeys();
    const vapid = new VapidTokenProvider({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:a@b",
    });
    return new WebPushSender({ vapid, fetch: fetchImpl });
  }

  it("requires a subscription", async () => {
    const sender = build(vi.fn());
    await expect(sender.send({})).rejects.toThrow(/subscription/);
  });

  it("POSTs an encrypted body the subscriber can decrypt", async () => {
    const sub = subscription();
    let captured;
    const sender = build(async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 201, headers: { get: () => "/receipt/1" } };
    });
    const result = await sender.send({
      token: JSON.stringify(sub.json),
      sessionId: "s1",
      clientId: "browser",
      notification: { title: "Approval requested", body: "needs you" },
    });

    expect(result).toEqual({ id: "/receipt/1" });
    expect(captured.url).toBe(sub.json.endpoint);
    expect(captured.init.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(captured.init.headers.Authorization).toMatch(/^vapid t=.+, k=.+/);

    // The encrypted body decrypts back to our routing payload.
    const plain = JSON.parse(
      decryptWebPushPayload({
        body: captured.init.body,
        uaEcdh: sub.ua,
        authSecret: sub.authSecret,
      }).toString("utf8"),
    );
    expect(plain).toEqual({
      type: "remote-session.approval-request",
      title: "Approval requested",
      body: "needs you",
      sessionId: "s1",
      clientId: "browser",
    });
  });

  it("maps 410/404 to PushTokenUnregisteredError", async () => {
    const sub = subscription();
    const gone = build(async () => ({
      ok: false,
      status: 410,
      headers: { get: () => null },
    }));
    const err = await gone
      .send({ token: JSON.stringify(sub.json) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("throws a generic error for other failures", async () => {
    const sub = subscription();
    const sender = build(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
    }));
    await expect(
      sender.send({ token: JSON.stringify(sub.json) }),
    ).rejects.toThrow(/Web Push failed \(500\)/);
  });
});

describe("createWebPushSender", () => {
  it("returns null when VAPID is unconfigured", () => {
    expect(createWebPushSender({})).toBeNull();
    const { publicKey, privateKey } = vapidKeys();
    expect(
      createWebPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PUBLIC_KEY: publicKey,
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PRIVATE_KEY: privateKey,
      }),
    ).toBeNull(); // no subject
  });

  it("builds a working sender from env VAPID keys", async () => {
    const keys = vapidKeys();
    const sub = subscription();
    let posted = false;
    const sender = createWebPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PUBLIC_KEY: keys.publicKey,
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_PRIVATE_KEY: keys.privateKey,
        CHAINLESSCHAIN_REMOTE_SESSION_VAPID_SUBJECT: "mailto:ops@demo.test",
      },
      {
        fetch: async () => {
          posted = true;
          return { ok: true, status: 201, headers: { get: () => null } };
        },
      },
    );
    expect(typeof sender).toBe("function");
    await sender({ token: JSON.stringify(sub.json), sessionId: "s1" });
    expect(posted).toBe(true);
  });
});

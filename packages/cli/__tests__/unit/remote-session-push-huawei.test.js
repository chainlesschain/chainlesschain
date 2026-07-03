import { describe, expect, it, vi } from "vitest";
import {
  HuaweiPushSender,
  HuaweiTokenProvider,
  createHuaweiPushSender,
} from "../../src/harness/remote-session-push-huawei.js";
import { PushTokenUnregisteredError } from "../../src/harness/remote-session-push-errors.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("HuaweiTokenProvider", () => {
  it("requires appId and appSecret", () => {
    expect(() => new HuaweiTokenProvider({ appSecret: "s" })).toThrow(/appId/);
    expect(() => new HuaweiTokenProvider({ appId: "a" })).toThrow(/appSecret/);
  });

  it("exchanges client credentials for an access token", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, { access_token: "hms-tok", expires_in: 3600 });
    });
    const provider = new HuaweiTokenProvider({
      appId: "app-1",
      appSecret: "secret-1",
      fetch: fetchMock,
      now: () => 0,
    });
    expect(await provider.getAccessToken()).toBe("hms-tok");
    expect(captured.url).toBe(
      "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
    );
    const form = new URLSearchParams(captured.init.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("app-1");
    expect(form.get("client_secret")).toBe("secret-1");
  });

  it("caches the token and refreshes only after expiry", async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { access_token: `tok-${clock}`, expires_in: 3600 }),
    );
    const provider = new HuaweiTokenProvider({
      appId: "a",
      appSecret: "s",
      fetch: fetchMock,
      now: () => clock,
    });
    expect(await provider.getAccessToken()).toBe("tok-0");
    clock = 60 * 1000;
    expect(await provider.getAccessToken()).toBe("tok-0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock = 3600 * 1000;
    expect(await provider.getAccessToken()).toBe(`tok-${clock}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the token endpoint fails or omits a token", async () => {
    const failing = new HuaweiTokenProvider({
      appId: "a",
      appSecret: "s",
      fetch: async () => jsonResponse(401, { error: "invalid_client" }),
    });
    await expect(failing.getAccessToken()).rejects.toThrow(/failed \(401\)/);
    const empty = new HuaweiTokenProvider({
      appId: "a",
      appSecret: "s",
      fetch: async () => jsonResponse(200, {}),
    });
    await expect(empty.getAccessToken()).rejects.toThrow(
      /missing access_token/,
    );
  });
});

describe("HuaweiPushSender", () => {
  const tokenProvider = { getAccessToken: async () => "access-tok" };

  it("validates its required options", () => {
    expect(() => new HuaweiPushSender({ tokenProvider })).toThrow(/appId/);
    expect(() => new HuaweiPushSender({ appId: "a" })).toThrow(/tokenProvider/);
  });

  it("POSTs a message with a bearer token and returns the requestId", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, { code: "80000000", requestId: "req-1" });
    });
    const sender = new HuaweiPushSender({
      appId: "app-1",
      tokenProvider,
      fetch: fetchMock,
    });
    const result = await sender.send({
      token: "device-tok",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "needs you" },
    });
    expect(result).toEqual({ id: "req-1" });
    expect(captured.url).toBe(
      "https://push-api.cloud.huawei.com/v1/app-1/messages:send",
    );
    expect(captured.init.headers.Authorization).toBe("Bearer access-tok");
    const body = JSON.parse(captured.init.body);
    expect(body.message.token).toEqual(["device-tok"]);
    expect(body.message.notification).toEqual({
      title: "Approval requested",
      body: "needs you",
    });
    expect(JSON.parse(body.message.data)).toEqual({
      type: "remote-session.approval-request",
      sessionId: "s1",
      clientId: "phone",
    });
  });

  it("requires a device token", async () => {
    const sender = new HuaweiPushSender({
      appId: "a",
      tokenProvider,
      fetch: vi.fn(),
    });
    await expect(sender.send({})).rejects.toThrow(/device token/);
  });

  it("maps invalid-token result codes to PushTokenUnregisteredError", async () => {
    const allInvalid = new HuaweiPushSender({
      appId: "a",
      tokenProvider,
      fetch: async () =>
        jsonResponse(200, { code: "80300007", msg: "All tokens are invalid" }),
    });
    await expect(allInvalid.send({ token: "gone" })).rejects.toBeInstanceOf(
      PushTokenUnregisteredError,
    );
    const someInvalid = new HuaweiPushSender({
      appId: "a",
      tokenProvider,
      fetch: async () =>
        jsonResponse(200, { code: "80100000", msg: "Some tokens are invalid" }),
    });
    const err = await someInvalid.send({ token: "gone" }).catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("throws a generic error for other failures", async () => {
    const sender = new HuaweiPushSender({
      appId: "a",
      tokenProvider,
      fetch: async () =>
        jsonResponse(200, { code: "80100003", msg: "message structure error" }),
    });
    await expect(sender.send({ token: "t" })).rejects.toThrow(
      /Huawei push failed \(80100003\): message structure error/,
    );
  });
});

describe("createHuaweiPushSender", () => {
  it("returns null when app id or secret is missing", () => {
    expect(createHuaweiPushSender({})).toBeNull();
    expect(
      createHuaweiPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_ID: "a",
      }),
    ).toBeNull();
  });

  it("builds a working sender from env", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes("/oauth2/")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(200, { code: "80000000", requestId: "r" });
    });
    const sender = createHuaweiPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_ID: "app-1",
        CHAINLESSCHAIN_REMOTE_SESSION_HUAWEI_APP_SECRET: "secret",
      },
      { fetch: fetchMock },
    );
    expect(typeof sender).toBe("function");
    const result = await sender({ token: "dev", sessionId: "s1" });
    expect(result).toEqual({ id: "r" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // OAuth + send
  });
});

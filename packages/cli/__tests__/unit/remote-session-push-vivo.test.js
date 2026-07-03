import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  VivoAuthProvider,
  VivoPushSender,
  createVivoPushSender,
} from "../../src/harness/remote-session-push-vivo.js";
import { PushTokenUnregisteredError } from "../../src/harness/remote-session-push-errors.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("VivoAuthProvider", () => {
  it("requires appId, appKey and appSecret", () => {
    expect(() => new VivoAuthProvider({ appKey: "k", appSecret: "s" })).toThrow(
      /appId/,
    );
    expect(() => new VivoAuthProvider({ appId: "a", appSecret: "s" })).toThrow(
      /appKey/,
    );
    expect(() => new VivoAuthProvider({ appId: "a", appKey: "k" })).toThrow(
      /appSecret/,
    );
  });

  it("signs MD5(appId + appKey + timestamp + appSecret) and returns authToken", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, {
        result: 0,
        desc: "success",
        authToken: "vivo-tok",
      });
    });
    const provider = new VivoAuthProvider({
      appId: "app-1",
      appKey: "key-1",
      appSecret: "secret-1",
      fetch: fetchMock,
      now: () => 12345,
    });
    expect(await provider.getAuthToken()).toBe("vivo-tok");
    expect(captured.url).toBe("https://api-push.vivo.com.cn/message/auth");
    const body = JSON.parse(captured.init.body);
    expect(body.appId).toBe("app-1");
    expect(body.appKey).toBe("key-1");
    expect(body.timestamp).toBe(12345);
    const expectedSign = createHash("md5")
      .update("app-1key-112345secret-1", "utf8")
      .digest("hex");
    expect(body.sign).toBe(expectedSign);
  });

  it("caches the token and refreshes only after expiry", async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { result: 0, authToken: `tok-${clock}` }),
    );
    const provider = new VivoAuthProvider({
      appId: "a",
      appKey: "k",
      appSecret: "s",
      fetch: fetchMock,
      now: () => clock,
    });
    expect(await provider.getAuthToken()).toBe("tok-0");
    clock = 60 * 60 * 1000; // 1h — within the 24h TTL
    expect(await provider.getAuthToken()).toBe("tok-0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock = 24 * 60 * 60 * 1000; // 24h — expired
    expect(await provider.getAuthToken()).toBe(`tok-${clock}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the auth endpoint fails or omits a token", async () => {
    const failing = new VivoAuthProvider({
      appId: "a",
      appKey: "k",
      appSecret: "s",
      fetch: async () => jsonResponse(500, { result: 500, desc: "boom" }),
    });
    await expect(failing.getAuthToken()).rejects.toThrow(/failed \(500\)/);
    const badResult = new VivoAuthProvider({
      appId: "a",
      appKey: "k",
      appSecret: "s",
      fetch: async () =>
        jsonResponse(200, { result: 10000, desc: "sign error" }),
    });
    await expect(badResult.getAuthToken()).rejects.toThrow(/missing authToken/);
  });
});

describe("VivoPushSender", () => {
  const authProvider = { getAuthToken: async () => "auth-tok" };

  it("requires an authProvider", () => {
    expect(() => new VivoPushSender({})).toThrow(/authProvider/);
  });

  it("POSTs a message with the authToken header and returns the taskId", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, {
        result: 0,
        desc: "success",
        taskId: "task-1",
      });
    });
    const sender = new VivoPushSender({
      authProvider,
      fetch: fetchMock,
      requestId: () => "req-fixed",
    });
    const result = await sender.send({
      token: "device-tok",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "needs you" },
    });
    expect(result).toEqual({ id: "task-1" });
    expect(captured.url).toBe("https://api-push.vivo.com.cn/message/send");
    expect(captured.init.headers.authToken).toBe("auth-tok");
    const body = JSON.parse(captured.init.body);
    expect(body.regId).toBe("device-tok");
    expect(body.notifyType).toBe(1);
    expect(body.title).toBe("Approval requested");
    expect(body.content).toBe("needs you");
    expect(body.requestId).toBe("req-fixed");
    expect(body.clientCustomMap).toEqual({
      type: "remote-session.approval-request",
      sessionId: "s1",
      clientId: "phone",
    });
  });

  it("requires a regId", async () => {
    const sender = new VivoPushSender({ authProvider, fetch: vi.fn() });
    await expect(sender.send({})).rejects.toThrow(/regId/);
  });

  it("maps invalid-regId result codes to PushTokenUnregisteredError", async () => {
    const sender = new VivoPushSender({
      authProvider,
      fetch: async () =>
        jsonResponse(200, { result: 10302, desc: "regId 非法" }),
    });
    const err = await sender.send({ token: "gone" }).catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("maps invalid-regId text to PushTokenUnregisteredError even for other codes", async () => {
    const sender = new VivoPushSender({
      authProvider,
      fetch: async () =>
        jsonResponse(200, { result: 10399, desc: "the regId is invalid" }),
    });
    await expect(sender.send({ token: "gone" })).rejects.toBeInstanceOf(
      PushTokenUnregisteredError,
    );
  });

  it("throws a generic error for other failures", async () => {
    const sender = new VivoPushSender({
      authProvider,
      fetch: async () =>
        jsonResponse(200, { result: 10070, desc: "message over quota" }),
    });
    await expect(sender.send({ token: "t" })).rejects.toThrow(
      /vivo push failed \(10070\): message over quota/,
    );
  });
});

describe("createVivoPushSender", () => {
  it("returns null when any credential is missing", () => {
    expect(createVivoPushSender({})).toBeNull();
    expect(
      createVivoPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_ID: "a",
        CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_KEY: "k",
      }),
    ).toBeNull();
  });

  it("builds a working sender from env", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes("/message/auth")) {
        return jsonResponse(200, { result: 0, authToken: "tok" });
      }
      return jsonResponse(200, { result: 0, taskId: "t" });
    });
    const sender = createVivoPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_ID: "app-1",
        CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_KEY: "key-1",
        CHAINLESSCHAIN_REMOTE_SESSION_VIVO_APP_SECRET: "secret",
      },
      { fetch: fetchMock },
    );
    expect(typeof sender).toBe("function");
    const result = await sender({ token: "dev", sessionId: "s1" });
    expect(result).toEqual({ id: "t" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // auth + send
  });
});

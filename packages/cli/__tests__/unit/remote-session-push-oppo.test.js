import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  OppoAuthProvider,
  OppoPushSender,
  createOppoPushSender,
} from "../../src/harness/remote-session-push-oppo.js";
import { PushTokenUnregisteredError } from "../../src/harness/remote-session-push-errors.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("OppoAuthProvider", () => {
  it("requires appKey and masterSecret", () => {
    expect(() => new OppoAuthProvider({ masterSecret: "s" })).toThrow(/appKey/);
    expect(() => new OppoAuthProvider({ appKey: "a" })).toThrow(/masterSecret/);
  });

  it("signs SHA256(app_key + timestamp + master_secret) and returns auth_token", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, {
        code: 0,
        message: "success",
        data: { auth_token: "oppo-tok" },
      });
    });
    const provider = new OppoAuthProvider({
      appKey: "app-1",
      masterSecret: "secret-1",
      fetch: fetchMock,
      now: () => 12345,
    });
    expect(await provider.getAuthToken()).toBe("oppo-tok");
    expect(captured.url).toBe("https://api.push.oppomobile.com/server/v1/auth");
    const form = new URLSearchParams(captured.init.body);
    expect(form.get("app_key")).toBe("app-1");
    expect(form.get("timestamp")).toBe("12345");
    const expectedSign = createHash("sha256")
      .update("app-112345secret-1", "utf8")
      .digest("hex");
    expect(form.get("sign")).toBe(expectedSign);
  });

  it("caches the token and refreshes only after expiry", async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: { auth_token: `tok-${clock}` },
      }),
    );
    const provider = new OppoAuthProvider({
      appKey: "a",
      masterSecret: "s",
      fetch: fetchMock,
      now: () => clock,
    });
    expect(await provider.getAuthToken()).toBe("tok-0");
    clock = 60 * 60 * 1000; // 1h — still within the 24h TTL
    expect(await provider.getAuthToken()).toBe("tok-0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock = 24 * 60 * 60 * 1000; // 24h — expired
    expect(await provider.getAuthToken()).toBe(`tok-${clock}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the auth endpoint fails or omits a token", async () => {
    const failing = new OppoAuthProvider({
      appKey: "a",
      masterSecret: "s",
      fetch: async () => jsonResponse(401, { code: -1, message: "bad sign" }),
    });
    await expect(failing.getAuthToken()).rejects.toThrow(/failed \(401\)/);
    const emptyCode = new OppoAuthProvider({
      appKey: "a",
      masterSecret: "s",
      fetch: async () =>
        jsonResponse(200, { code: 10, message: "auth error", data: {} }),
    });
    await expect(emptyCode.getAuthToken()).rejects.toThrow(
      /missing auth_token/,
    );
  });
});

describe("OppoPushSender", () => {
  const authProvider = { getAuthToken: async () => "auth-tok" };

  it("requires an authProvider", () => {
    expect(() => new OppoPushSender({})).toThrow(/authProvider/);
  });

  it("POSTs a unicast message with the auth token and returns the messageId", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, {
        code: 0,
        message: "success",
        data: { messageId: "msg-1" },
      });
    });
    const sender = new OppoPushSender({ authProvider, fetch: fetchMock });
    const result = await sender.send({
      token: "device-tok",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "needs you" },
    });
    expect(result).toEqual({ id: "msg-1" });
    expect(captured.url).toBe(
      "https://api.push.oppomobile.com/server/v1/message/notification/unicast",
    );
    expect(captured.init.headers.auth_token).toBe("auth-tok");
    const form = new URLSearchParams(captured.init.body);
    expect(form.get("auth_token")).toBe("auth-tok");
    const message = JSON.parse(form.get("message"));
    expect(message.target_type).toBe(2);
    expect(message.target_value).toBe("device-tok");
    expect(message.notification.title).toBe("Approval requested");
    expect(message.notification.content).toBe("needs you");
    expect(JSON.parse(message.notification.action_parameters)).toEqual({
      type: "remote-session.approval-request",
      sessionId: "s1",
      clientId: "phone",
    });
  });

  it("requires a registration id", async () => {
    const sender = new OppoPushSender({ authProvider, fetch: vi.fn() });
    await expect(sender.send({})).rejects.toThrow(/registration id/);
  });

  it("maps invalid-registration messages to PushTokenUnregisteredError", async () => {
    const sender = new OppoPushSender({
      authProvider,
      fetch: async () =>
        jsonResponse(200, {
          code: 33,
          message: "invalid registration_id",
        }),
    });
    const err = await sender.send({ token: "gone" }).catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("throws a generic error for other failures", async () => {
    const sender = new OppoPushSender({
      authProvider,
      fetch: async () =>
        jsonResponse(200, { code: 29, message: "message body error" }),
    });
    await expect(sender.send({ token: "t" })).rejects.toThrow(
      /OPPO push failed \(29\): message body error/,
    );
  });
});

describe("createOppoPushSender", () => {
  it("returns null when app key or master secret is missing", () => {
    expect(createOppoPushSender({})).toBeNull();
    expect(
      createOppoPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_OPPO_APP_KEY: "a",
      }),
    ).toBeNull();
  });

  it("builds a working sender from env", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes("/server/v1/auth")) {
        return jsonResponse(200, { code: 0, data: { auth_token: "tok" } });
      }
      return jsonResponse(200, { code: 0, data: { messageId: "m" } });
    });
    const sender = createOppoPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_OPPO_APP_KEY: "app-1",
        CHAINLESSCHAIN_REMOTE_SESSION_OPPO_MASTER_SECRET: "secret",
      },
      { fetch: fetchMock },
    );
    expect(typeof sender).toBe("function");
    const result = await sender({ token: "dev", sessionId: "s1" });
    expect(result).toEqual({ id: "m" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // auth + send
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  XiaomiPushSender,
  createXiaomiPushSender,
} from "../../src/harness/remote-session-push-xiaomi.js";
import { PushTokenUnregisteredError } from "../../src/harness/remote-session-push-errors.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("XiaomiPushSender", () => {
  it("validates its required options", () => {
    expect(() => new XiaomiPushSender({ packageName: "p" })).toThrow(
      /appSecret/,
    );
    expect(() => new XiaomiPushSender({ appSecret: "s" })).toThrow(
      /packageName/,
    );
  });

  it("posts a form-encoded notification with the key= auth header", async () => {
    let captured;
    const fetchMock = vi.fn(async (url, init) => {
      captured = { url, init };
      return jsonResponse(200, { result: "ok", code: 0, data: { id: "sm-1" } });
    });
    const sender = new XiaomiPushSender({
      appSecret: "secret-xyz",
      packageName: "com.demo.app",
      fetch: fetchMock,
    });

    const result = await sender.send({
      token: "reg-123",
      sessionId: "s1",
      clientId: "phone",
      notification: { title: "Approval requested", body: "needs you" },
    });

    expect(result).toEqual({ id: "sm-1" });
    expect(captured.url).toBe("https://api.xmpush.xiaomi.com/v3/message/regid");
    expect(captured.init.headers.Authorization).toBe("key=secret-xyz");
    expect(captured.init.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(captured.init.body);
    expect(form.get("registration_id")).toBe("reg-123");
    expect(form.get("restricted_package_name")).toBe("com.demo.app");
    expect(form.get("title")).toBe("Approval requested");
    expect(form.get("description")).toBe("needs you");
    expect(JSON.parse(form.get("payload"))).toEqual({
      type: "remote-session.approval-request",
      sessionId: "s1",
      clientId: "phone",
    });
  });

  it("honors a custom host (e.g. the global endpoint)", async () => {
    let url;
    const sender = new XiaomiPushSender({
      appSecret: "s",
      packageName: "p",
      host: "https://global.api.xmpush.global.xiaomi.com",
      fetch: async (u) => {
        url = u;
        return jsonResponse(200, { result: "ok", code: 0 });
      },
    });
    await sender.send({ token: "t" });
    expect(url).toBe(
      "https://global.api.xmpush.global.xiaomi.com/v3/message/regid",
    );
  });

  it("requires a registration id", async () => {
    const sender = new XiaomiPushSender({
      appSecret: "s",
      packageName: "p",
      fetch: vi.fn(),
    });
    await expect(sender.send({})).rejects.toThrow(/registration id/);
  });

  it("maps an invalid registration id to PushTokenUnregisteredError", async () => {
    const sender = new XiaomiPushSender({
      appSecret: "s",
      packageName: "p",
      fetch: async () =>
        jsonResponse(200, {
          result: "error",
          code: 22006,
          reason: "registration_id is not valid",
        }),
    });
    const err = await sender.send({ token: "gone" }).catch((e) => e);
    expect(err).toBeInstanceOf(PushTokenUnregisteredError);
    expect(err.code).toBe("PUSH_TOKEN_UNREGISTERED");
  });

  it("throws a generic error for other failures", async () => {
    const sender = new XiaomiPushSender({
      appSecret: "s",
      packageName: "p",
      fetch: async () =>
        jsonResponse(200, {
          result: "error",
          code: 10008,
          reason: "internal service error",
        }),
    });
    await expect(sender.send({ token: "t" })).rejects.toThrow(
      /Xiaomi push failed: internal service error/,
    );
  });
});

describe("createXiaomiPushSender", () => {
  it("returns null when the secret or package name is missing", () => {
    expect(createXiaomiPushSender({})).toBeNull();
    expect(
      createXiaomiPushSender({
        CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_APP_SECRET: "s",
      }),
    ).toBeNull();
  });

  it("builds a working sender from env", async () => {
    let posted = false;
    const sender = createXiaomiPushSender(
      {
        CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_APP_SECRET: "secret",
        CHAINLESSCHAIN_REMOTE_SESSION_XIAOMI_PACKAGE_NAME: "com.demo.app",
      },
      {
        fetch: async () => {
          posted = true;
          return jsonResponse(200, { result: "ok", code: 0 });
        },
      },
    );
    expect(typeof sender).toBe("function");
    await sender({ token: "reg", sessionId: "s1" });
    expect(posted).toBe(true);
  });
});

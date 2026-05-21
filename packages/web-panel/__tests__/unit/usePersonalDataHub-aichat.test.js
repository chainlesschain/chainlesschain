/**
 * Phase 10.3 — composable 4 aichat methods route to the right WS topics
 * with the documented payload shapes and timeouts.
 *
 * We mock `useWsStore` to capture every `sendRaw` call so the test runs
 * with no real WS connection. Return values are unwrapped from the
 * `{ result }` envelope by the composable's internal `_unwrap` helper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
    // _send / onMessage / offMessage are only used by streaming variants —
    // not exercised by the 4 wizard methods.
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 10.3 AIChat wizard topics", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("openAichatLogin sends aichat-open-login with vendor + opts", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, fallbackMode: "paste", loginUrl: "https://chat.deepseek.com/" } });
    const hub = usePersonalDataHub();

    const r = await hub.openAichatLogin("deepseek", { reuseSession: false });

    expect(sendRaw).toHaveBeenCalledOnce();
    const [payload, timeoutMs] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.aichat-open-login",
      vendor: "deepseek",
      opts: { reuseSession: false },
    });
    expect(timeoutMs).toBe(10_000);
    expect(r.ok).toBe(true);
    expect(r.fallbackMode).toBe("paste");
  });

  it("openAichatLogin defaults opts to empty object when omitted", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true } });
    const hub = usePersonalDataHub();

    await hub.openAichatLogin("kimi");

    const [payload] = sendRaw.mock.calls[0];
    expect(payload.opts).toEqual({});
  });

  it("probeAichatCookies sends aichat-probe-cookies with cookieHeader for paste mode", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        cookies: { sessionid: "abc" },
        foundRequired: ["sessionid"],
        missingRequired: [],
        foundOptional: [],
      },
    });
    const hub = usePersonalDataHub();

    const r = await hub.probeAichatCookies("doubao", "sessionid=abc; sid_guard=xyz");

    const [payload, timeoutMs] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.aichat-probe-cookies",
      vendor: "doubao",
      cookieHeader: "sessionid=abc; sid_guard=xyz",
    });
    expect(timeoutMs).toBe(10_000);
    expect(r.foundRequired).toEqual(["sessionid"]);
  });

  it("probeAichatCookies omits cookieHeader for desktop BrowserView mode", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true } });
    const hub = usePersonalDataHub();

    await hub.probeAichatCookies("zhipu");

    const [payload] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.aichat-probe-cookies",
      vendor: "zhipu",
      cookieHeader: undefined,
    });
  });

  it("registerAichatVendor sends aichat-register-vendor with cookies + opts", async () => {
    sendRaw.mockResolvedValueOnce({
      result: { ok: true, accountId: "deepseek:u_42", validation: { ok: true, userId: "u_42" } },
    });
    const hub = usePersonalDataHub();

    const r = await hub.registerAichatVendor("deepseek", { userToken: "tok" });

    const [payload, timeoutMs] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.aichat-register-vendor",
      vendor: "deepseek",
      cookies: { userToken: "tok" },
      opts: {},
    });
    expect(timeoutMs).toBe(30_000);
    expect(r.ok).toBe(true);
    expect(r.accountId).toBe("deepseek:u_42");
  });

  it("registerAichatVendor surfaces typed reason from server", async () => {
    sendRaw.mockResolvedValueOnce({
      result: { ok: false, reason: "REQUIRED_COOKIES_MISSING", missingRequired: ["userToken"] },
    });
    const hub = usePersonalDataHub();

    const r = await hub.registerAichatVendor("deepseek", {});

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("REQUIRED_COOKIES_MISSING");
    expect(r.missingRequired).toEqual(["userToken"]);
  });

  it("rotateAichatLogin sends aichat-rotate-login with just vendor", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, fallbackMode: "paste" } });
    const hub = usePersonalDataHub();

    await hub.rotateAichatLogin("hunyuan");

    const [payload, timeoutMs] = sendRaw.mock.calls[0];
    expect(payload).toEqual({
      type: "personal-data-hub.aichat-rotate-login",
      vendor: "hunyuan",
    });
    expect(timeoutMs).toBe(10_000);
  });

  it("unwraps error envelopes by throwing", async () => {
    sendRaw.mockResolvedValueOnce({ error: "controller blew up" });
    const hub = usePersonalDataHub();

    await expect(hub.openAichatLogin("deepseek")).rejects.toThrow(/controller blew up/);
  });
});

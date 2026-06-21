/**
 * ipc-sender-guard — sender-frame trust validation.
 *
 * Proves the guard accepts our own top-level frames (file: in the app bundle,
 * localhost dev / web-shell) and rejects sub-frames + foreign origins, and that
 * the report/enforce/off modes behave correctly (report logs but allows; enforce
 * blocks; off skips) while never throwing from an internal error.
 */
const path = require("path");
const { pathToFileURL } = require("url");

const guard = require("../ipc-sender-guard.js");
const {
  validateSender,
  originIsTrusted,
  installSenderGuard,
  _wrapHandler,
  _wrapListener,
  _appFileRoot,
} = guard;

const APP_ROOT = _appFileRoot();
const trustedFileUrl = pathToFileURL(
  path.join(APP_ROOT, "renderer", "index.html"),
).href;

function topFrame(url) {
  return { url, parent: null };
}
function subFrame(url) {
  return { url, parent: { url: "whatever" } };
}
function evt(senderFrame) {
  return { senderFrame };
}

describe("ipc-sender-guard / resolveMode", () => {
  const { resolveMode } = guard;
  const orig = process.env.CC_IPC_SENDER_GUARD;
  afterEach(() => {
    if (orig === undefined) {
      delete process.env.CC_IPC_SENDER_GUARD;
    } else {
      process.env.CC_IPC_SENDER_GUARD = orig;
    }
  });

  it("defaults to enforce when unset (the hardening is on)", () => {
    delete process.env.CC_IPC_SENDER_GUARD;
    expect(resolveMode()).toBe("enforce");
  });

  it("honors explicit report/audit (opt-out of blocking)", () => {
    process.env.CC_IPC_SENDER_GUARD = "report";
    expect(resolveMode()).toBe("report");
    process.env.CC_IPC_SENDER_GUARD = "audit";
    expect(resolveMode()).toBe("report");
  });

  it("honors the kill-switch (0/off)", () => {
    process.env.CC_IPC_SENDER_GUARD = "0";
    expect(resolveMode()).toBe("off");
    process.env.CC_IPC_SENDER_GUARD = "off";
    expect(resolveMode()).toBe("off");
  });

  it("honors explicit enforce values", () => {
    process.env.CC_IPC_SENDER_GUARD = "enforce";
    expect(resolveMode()).toBe("enforce");
    process.env.CC_IPC_SENDER_GUARD = "1";
    expect(resolveMode()).toBe("enforce");
  });
});

describe("ipc-sender-guard / originIsTrusted", () => {
  it("trusts a file: URL inside the app bundle root", () => {
    expect(originIsTrusted(trustedFileUrl)).toBe(true);
  });

  it("rejects a file: URL outside the app bundle root", () => {
    const outside = pathToFileURL(
      process.platform === "win32" ? "C:/Windows/win.ini" : "/etc/passwd",
    ).href;
    expect(originIsTrusted(outside)).toBe(false);
  });

  it("trusts http(s) on loopback (dev server + local web-shell, any port)", () => {
    expect(originIsTrusted("http://localhost:5173/")).toBe(true);
    expect(originIsTrusted("http://127.0.0.1:8091/index.html#/main")).toBe(
      true,
    );
    expect(originIsTrusted("https://localhost:9229/")).toBe(true);
  });

  it("rejects remote origins and non-app schemes", () => {
    expect(originIsTrusted("https://evil.example.com/")).toBe(false);
    expect(originIsTrusted("http://10.0.0.5/")).toBe(false);
    expect(originIsTrusted("data:text/html,<script>x</script>")).toBe(false);
    expect(originIsTrusted("about:blank")).toBe(false);
    expect(originIsTrusted("")).toBe(false);
    expect(originIsTrusted("not a url")).toBe(false);
  });
});

describe("ipc-sender-guard / validateSender", () => {
  it("trusts a top frame loaded from the app bundle", () => {
    expect(validateSender(evt(topFrame(trustedFileUrl)))).toEqual({
      trusted: true,
    });
  });

  it("trusts a top frame on loopback", () => {
    expect(
      validateSender(evt(topFrame("http://localhost:5173/"))).trusted,
    ).toBe(true);
  });

  it("rejects when there is no sender frame", () => {
    expect(validateSender(evt(null))).toMatchObject({
      trusted: false,
      reason: "no-sender-frame",
    });
    expect(validateSender({})).toMatchObject({ trusted: false });
  });

  it("rejects a sub-frame (iframe) even from a trusted origin", () => {
    expect(validateSender(evt(subFrame(trustedFileUrl)))).toMatchObject({
      trusted: false,
      reason: "sub-frame",
    });
  });

  it("rejects a top frame navigated to a foreign origin", () => {
    expect(
      validateSender(evt(topFrame("https://evil.example.com/"))),
    ).toMatchObject({ trusted: false, reason: "untrusted-origin" });
  });

  it("does not throw on a disposed frame (url/parent getters throw)", () => {
    const disposed = {
      get url() {
        throw new Error("frame disposed");
      },
      get parent() {
        throw new Error("frame disposed");
      },
    };
    const v = validateSender(evt(disposed));
    expect(v.trusted).toBe(false); // can't verify → reject (clean), no crash
  });
});

describe("ipc-sender-guard / wrapHandler modes", () => {
  const trustedEvt = evt(topFrame(trustedFileUrl));
  const untrustedEvt = evt(topFrame("https://evil.example.com/"));

  it("report mode: untrusted sender is allowed through (logged, not blocked)", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = _wrapHandler("chan:x", handler, () => "report");
    await expect(wrapped(untrustedEvt, 1, 2)).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledWith(untrustedEvt, 1, 2);
  });

  it("enforce mode: untrusted sender is blocked (handler never runs)", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = _wrapHandler("chan:x", handler, () => "enforce");
    await expect(wrapped(untrustedEvt)).rejects.toThrow("untrusted sender");
    expect(handler).not.toHaveBeenCalled();
  });

  it("enforce mode: trusted sender runs normally", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = _wrapHandler("chan:x", handler, () => "enforce");
    await expect(wrapped(trustedEvt)).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("off mode: no validation, handler always runs", async () => {
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = _wrapHandler("chan:x", handler, () => "off");
    await expect(wrapped(untrustedEvt)).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("ipc-sender-guard / wrapListener modes (fire-and-forget)", () => {
  const trustedEvt = evt(topFrame(trustedFileUrl));
  const untrustedEvt = evt(topFrame("https://evil.example.com/"));

  it("enforce mode: untrusted sender is DROPPED (listener never runs, no throw)", () => {
    const listener = vi.fn();
    const wrapped = _wrapListener("evt:x", listener, () => "enforce");
    expect(() => wrapped(untrustedEvt, 1)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("enforce mode: trusted sender runs", () => {
    const listener = vi.fn();
    const wrapped = _wrapListener("evt:x", listener, () => "enforce");
    wrapped(trustedEvt, 1, 2);
    expect(listener).toHaveBeenCalledWith(trustedEvt, 1, 2);
  });

  it("report mode: untrusted sender still runs (logged, not dropped)", () => {
    const listener = vi.fn();
    const wrapped = _wrapListener("evt:x", listener, () => "report");
    wrapped(untrustedEvt);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("off mode: listener always runs", () => {
    const listener = vi.fn();
    const wrapped = _wrapListener("evt:x", listener, () => "off");
    wrapped(untrustedEvt);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("ipc-sender-guard / installSenderGuard", () => {
  function fakeIpcMain() {
    const handlers = new Map();
    return {
      handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
      handleOnce: vi.fn((channel, fn) => handlers.set(`once:${channel}`, fn)),
      on: vi.fn((channel, fn) => handlers.set(`on:${channel}`, fn)),
      once: vi.fn((channel, fn) => handlers.set(`evtonce:${channel}`, fn)),
      _handlers: handlers,
    };
  }

  it("patches handle/handleOnce, is idempotent, and wraps registered handlers", async () => {
    const ipcMain = fakeIpcMain();
    expect(installSenderGuard(ipcMain, { getMode: () => "enforce" })).toBe(
      true,
    );
    // second install is a no-op
    expect(installSenderGuard(ipcMain, { getMode: () => "enforce" })).toBe(
      false,
    );

    const handler = vi.fn().mockResolvedValue("ok");
    ipcMain.handle("priv:do", handler);
    const registered = ipcMain._handlers.get("priv:do");
    // registered handler is the GUARD wrapper, not the raw handler
    expect(registered).not.toBe(handler);

    // untrusted → blocked; trusted → runs
    await expect(
      registered(evt(topFrame("https://evil.example.com/"))),
    ).rejects.toThrow("untrusted sender");
    expect(handler).not.toHaveBeenCalled();
    await expect(registered(evt(topFrame(trustedFileUrl)))).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("also wraps on/once: untrusted event dropped, trusted runs (no throw)", () => {
    const ipcMain = fakeIpcMain();
    installSenderGuard(ipcMain, { getMode: () => "enforce" });

    const listener = vi.fn();
    ipcMain.on("evt:y", listener);
    const registered = ipcMain._handlers.get("on:evt:y");
    expect(registered).not.toBe(listener);

    expect(() =>
      registered(evt(topFrame("https://evil.example.com/")), 1),
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();

    registered(evt(topFrame(trustedFileUrl)), 1, 2);
    expect(listener).toHaveBeenCalledWith(evt(topFrame(trustedFileUrl)), 1, 2);

    // once is patched too
    const onceListener = vi.fn();
    ipcMain.once("evt:z", onceListener);
    expect(ipcMain._handlers.get("evtonce:evt:z")).not.toBe(onceListener);
  });

  it("passes through a non-function handler unchanged", () => {
    const ipcMain = fakeIpcMain();
    installSenderGuard(ipcMain, { getMode: () => "enforce" });
    ipcMain.handle("weird", undefined);
    expect(ipcMain._handlers.get("weird")).toBe(undefined);
  });

  it("returns false for an invalid ipcMain", () => {
    expect(installSenderGuard(null)).toBe(false);
    expect(installSenderGuard({})).toBe(false);
  });
});

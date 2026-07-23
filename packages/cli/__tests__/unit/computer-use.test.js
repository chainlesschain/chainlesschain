import { describe, it, expect, vi } from "vitest";
import {
  createAuthorizer,
  COMPUTER_USE_CAPABILITIES,
  HIGH_RISK_APP_PATTERNS,
  TOOL_PRIORITY,
} from "../../src/lib/computer-use/authorization.js";
import {
  createWindowsBackend,
  escapeSendKeys,
  PS,
} from "../../src/lib/computer-use/control-backend.js";
import {
  handleToolCall,
  availableTools,
  startComputerUseServer,
} from "../../src/lib/computer-use/computer-use-server.js";

describe("computer-use authorization", () => {
  it("denies everything when disabled", () => {
    const auth = createAuthorizer({ enabled: false });
    for (const cap of COMPUTER_USE_CAPABILITIES) {
      const v = auth.authorize(cap);
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/disabled/);
    }
  });

  it("allows read-only observation without confirmation", () => {
    const auth = createAuthorizer({ enabled: true });
    for (const cap of ["screenshot", "window_list", "clipboard_read"]) {
      const v = auth.authorize(cap);
      expect(v.allowed).toBe(true);
      expect(v.requiresConfirmation).toBe(false);
    }
  });

  it("requires confirmation for input verbs", () => {
    const auth = createAuthorizer({ enabled: true });
    for (const cap of [
      "click",
      "type",
      "scroll",
      "app_launch",
      "clipboard_write",
    ]) {
      expect(auth.authorize(cap).requiresConfirmation).toBe(true);
    }
  });

  it("withholds capabilities not granted to the session", () => {
    const auth = createAuthorizer({
      enabled: true,
      capabilities: ["screenshot"],
    });
    expect(auth.authorize("screenshot").allowed).toBe(true);
    expect(auth.authorize("click").allowed).toBe(false);
    expect(auth.authorize("click").reason).toMatch(/not enabled/);
    expect(auth.capabilities).toEqual(["screenshot"]);
  });

  it("enforces the app allowlist for input/launch verbs", () => {
    const auth = createAuthorizer({
      enabled: true,
      appAllowlist: ["notepad"],
    });
    expect(auth.authorize("click", { app: "notepad" }).allowed).toBe(true);
    const denied = auth.authorize("click", { app: "chrome" });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/allowlist/);
    // input verb with no target while allowlist configured → denied
    expect(auth.authorize("type", {}).allowed).toBe(false);
  });

  it("forces confirmation on high-risk apps even when allowed", () => {
    const auth = createAuthorizer({ enabled: true });
    for (const app of [
      "Windows Terminal",
      "VS Code",
      "1Password",
      "Settings",
    ]) {
      const v = auth.authorize("screenshot", { app });
      expect(v.allowed).toBe(true);
      expect(v.requiresConfirmation).toBe(true);
      expect(v.reason).toMatch(/high-risk/);
    }
    expect(auth.isHighRiskApp("some regedit window")).toBe(true);
    expect(auth.isHighRiskApp("Calculator")).toBe(false);
    expect(HIGH_RISK_APP_PATTERNS).toContain("powershell");
  });

  it("confirmAll gates even read-only verbs", () => {
    const auth = createAuthorizer({ enabled: true, confirmAll: true });
    expect(auth.authorize("screenshot").requiresConfirmation).toBe(true);
  });
});

describe("control-backend (Windows)", () => {
  it("dispatches the right PowerShell per verb and shapes results", () => {
    const calls = [];
    const spawnSync = vi.fn((file, args, options) => {
      calls.push({ file, args, options });
      return { status: 0, stdout: "1920x1080", stderr: "" };
    });
    const backend = createWindowsBackend({
      spawnSync,
      platform: () => "win32",
    });
    const shot = backend.screenshot("C:/tmp/x.png");
    expect(shot).toMatchObject({ ok: true, path: "C:/tmp/x.png" });
    expect(calls[0].file).toBe("powershell.exe");
    expect(calls[0].args.at(-1)).toContain("CopyFromScreen");
    expect(calls[0].options).toMatchObject({
      origin: "computer-use:powershell",
      scope: "computer-use",
      policy: "allow",
      shell: false,
    });

    backend.click(10, 20);
    expect(calls[1].args.at(-1)).toContain("mouse_event");
    backend.type("hi");
    expect(calls[2].args.at(-1)).toContain("SendKeys");
  });

  it("routes app launches through the process broker contract", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));
    const backend = createWindowsBackend({
      spawnSync,
      platform: () => "win32",
    });

    expect(backend.appLaunch("notepad.exe", ["notes.txt"])).toEqual({
      ok: true,
      app: "notepad.exe",
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "notepad.exe",
      ["notes.txt"],
      expect.objectContaining({
        origin: "computer-use:app-launch",
        scope: "computer-use",
        policy: "allow",
        shell: false,
        detached: true,
        stdio: "ignore",
      }),
    );
  });

  it("parses window list JSON", () => {
    const spawnSync = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify([
        { Id: 5, ProcessName: "notepad", MainWindowTitle: "Untitled" },
      ]),
      stderr: "",
    }));
    const backend = createWindowsBackend({
      spawnSync,
      platform: () => "win32",
    });
    expect(backend.windowList()).toEqual({
      ok: true,
      windows: [{ pid: 5, app: "notepad", title: "Untitled" }],
    });
  });

  it("returns an unsupported error off Windows", () => {
    const backend = createWindowsBackend({
      spawnSync: vi.fn(),
      platform: () => "linux",
    });
    expect(backend.screenshot("x").ok).toBe(false);
    expect(backend.click(1, 1).error).toMatch(/only implemented on Windows/);
  });

  it("surfaces a PowerShell failure as an error result", () => {
    const backend = createWindowsBackend({
      spawnSync: () => ({ status: 1, stdout: "", stderr: "boom" }),
      platform: () => "win32",
    });
    expect(backend.clipboardRead()).toEqual({ ok: false, error: "boom" });
  });

  it("escapeSendKeys neutralizes SendKeys control chars", () => {
    expect(escapeSendKeys("a+b^c")).toBe("a{+}b{^}c");
    expect(escapeSendKeys("plain")).toBe("plain");
    expect(PS.type("x")).toContain("SendKeys");
  });
});

describe("handleToolCall gating", () => {
  const fakeBackend = () => ({
    screenshot: vi.fn(() => ({ ok: true, path: "p" })),
    windowList: vi.fn(() => ({ ok: true, windows: [] })),
    clipboardRead: vi.fn(() => ({ ok: true, text: "x" })),
    clipboardWrite: vi.fn(() => ({ ok: true })),
    click: vi.fn(() => ({ ok: true, x: 1, y: 2 })),
    type: vi.fn(() => ({ ok: true })),
    scroll: vi.fn(() => ({ ok: true })),
    appLaunch: vi.fn(() => ({ ok: true, app: "a" })),
  });

  it("runs a read-only tool without confirm", () => {
    const backend = fakeBackend();
    const authorizer = createAuthorizer({ enabled: true });
    const res = handleToolCall(
      "computer_screenshot",
      {},
      { authorizer, backend },
    );
    expect(res.isError).toBeFalsy();
    expect(backend.screenshot).toHaveBeenCalled();
  });

  it("refuses an input verb without confirm:true, runs it with confirm", () => {
    const backend = fakeBackend();
    const authorizer = createAuthorizer({ enabled: true });
    const denied = handleToolCall(
      "computer_click",
      { x: 5, y: 5 },
      { authorizer, backend },
    );
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toMatch(/needs confirmation/);
    expect(backend.click).not.toHaveBeenCalled();

    const done = handleToolCall(
      "computer_click",
      { x: 5, y: 5, confirm: true },
      { authorizer, backend },
    );
    expect(done.isError).toBeFalsy();
    expect(backend.click).toHaveBeenCalledWith(5, 5);
  });

  it("blocks a disabled capability outright", () => {
    const backend = fakeBackend();
    const authorizer = createAuthorizer({
      enabled: true,
      capabilities: ["screenshot"],
    });
    const res = handleToolCall(
      "computer_type",
      { text: "x", confirm: true },
      {
        authorizer,
        backend,
      },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/denied/);
    expect(backend.type).not.toHaveBeenCalled();
  });

  it("availableTools reflects the granted capabilities", () => {
    const authorizer = createAuthorizer({
      enabled: true,
      capabilities: ["screenshot", "click"],
    });
    const names = availableTools(authorizer).map((t) => t.name);
    expect(names).toEqual(["computer_screenshot", "computer_click"]);
    expect(TOOL_PRIORITY[0]).toBe("mcp/api");
  });
});

describe("computer-use MCP server", () => {
  async function rpc(url, token, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  }

  it("serves tools/list and executes a screenshot via injected backend", async () => {
    const backend = {
      screenshot: vi.fn(() => ({
        ok: true,
        path: "shot.png",
        size: "800x600",
      })),
      windowList: vi.fn(),
      clipboardRead: vi.fn(),
      clipboardWrite: vi.fn(),
      click: vi.fn(),
      type: vi.fn(),
      scroll: vi.fn(),
      appLaunch: vi.fn(),
    };
    const handle = await startComputerUseServer({
      backend,
      config: { capabilities: ["screenshot"] },
    });
    try {
      const list = await rpc(handle.url, handle.token, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(list.json.result.tools.map((t) => t.name)).toEqual([
        "computer_screenshot",
      ]);

      const call = await rpc(handle.url, handle.token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "computer_screenshot", arguments: {} },
      });
      expect(call.json.result.isError).toBeFalsy();
      expect(backend.screenshot).toHaveBeenCalled();

      const unauth = await fetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      });
      expect(unauth.status).toBe(401);
    } finally {
      await handle.stop();
    }
  });
});

/**
 * LSPManager tests — server pooling, document open/change sync, diagnostics
 * collection, and position conversion. A fake client is injected via
 * `_deps.createClient`; the registry resolves a server via `_deps.existsSync`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import path from "path";
import {
  LSPManager,
  toLspPosition,
  fromLspPosition,
  _deps,
} from "../lsp-manager.js";
import { _deps as regDeps } from "../lsp-server-registry.js";

/** Minimal fake LSPClient: records notifications, canned requests, emits events. */
class FakeClient extends EventEmitter {
  constructor(opts) {
    super();
    this.rootPath = opts.rootPath;
    this.running = true;
    this.notifications = [];
    this.started = false;
  }
  async start() {
    this.started = true;
    return { definitionProvider: true };
  }
  notify(method, params) {
    this.notifications.push({ method, params });
  }
  async request() {
    return null;
  }
  async stop() {
    this.running = false;
  }
}

let origCreate, origRead, origExistsMgr, origExistsReg;
let lastClient;

beforeEach(() => {
  origCreate = _deps.createClient;
  origRead = _deps.readFileSync;
  origExistsMgr = _deps.existsSync;
  origExistsReg = regDeps.existsSync;

  _deps.createClient = (opts) => {
    lastClient = new FakeClient(opts);
    return lastClient;
  };
  _deps.readFileSync = () => "const x = 1;\n";
  // root inference: pretend the nearest /proj ancestor has package.json.
  // Suffix match tolerates path.resolve prepending a drive letter on Windows.
  _deps.existsSync = (p) =>
    String(p).replace(/\\/g, "/").endsWith("/proj/package.json");
  // registry: pretend the TS server bin exists in <root>/node_modules/.bin
  const isWin = process.platform === "win32";
  const binName = isWin
    ? "typescript-language-server.cmd"
    : "typescript-language-server";
  regDeps.existsSync = (p) =>
    String(p).replace(/\\/g, "/").endsWith(`/node_modules/.bin/${binName}`);
});

afterEach(() => {
  _deps.createClient = origCreate;
  _deps.readFileSync = origRead;
  _deps.existsSync = origExistsMgr;
  regDeps.existsSync = origExistsReg;
  vi.restoreAllMocks();
});

describe("position helpers", () => {
  it("converts 1-based ⇄ 0-based", () => {
    expect(toLspPosition({ line: 1, col: 1 })).toEqual({
      line: 0,
      character: 0,
    });
    expect(toLspPosition({ line: 10, col: 5 })).toEqual({
      line: 9,
      character: 4,
    });
    expect(fromLspPosition({ line: 0, character: 0 })).toEqual({
      line: 1,
      col: 1,
    });
    expect(fromLspPosition({ line: 9, character: 4 })).toEqual({
      line: 10,
      col: 5,
    });
  });
  it("clamps below 1 to 0 (no negatives to the server)", () => {
    expect(toLspPosition({ line: 0, col: 0 })).toEqual({
      line: 0,
      character: 0,
    });
  });
});

describe("ensureFor", () => {
  it("starts a server and sends didOpen the first time", async () => {
    const mgr = new LSPManager();
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.languageId).toBe("typescript");
    expect(ready.root.replace(/\\/g, "/")).toMatch(/\/proj$/);
    expect(lastClient.started).toBe(true);
    const open = lastClient.notifications.find(
      (n) => n.method === "textDocument/didOpen",
    );
    expect(open.params.textDocument.text).toBe("const x = 1;\n");
    await mgr.disposeAll();
  });

  it("sends didChange (not a second didOpen) on the next access", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    await mgr.ensureFor("/proj/src/a.ts");
    const opens = lastClient.notifications.filter(
      (n) => n.method === "textDocument/didOpen",
    );
    const changes = lastClient.notifications.filter(
      (n) => n.method === "textDocument/didChange",
    );
    expect(opens).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(changes[0].params.textDocument.version).toBe(2);
    await mgr.disposeAll();
  });

  it("reuses one server for two files in the same project/language", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    const first = lastClient;
    await mgr.ensureFor("/proj/src/b.ts");
    expect(lastClient).toBe(first); // same client instance
    expect(mgr.activeServerCount).toBe(1);
    await mgr.disposeAll();
  });

  it("returns unavailable for an unsupported extension", async () => {
    const mgr = new LSPManager();
    const ready = await mgr.ensureFor("/proj/readme.txt");
    expect(ready.unavailable).toBe(true);
    expect(ready.reason).toMatch(/no language mapping/);
    await mgr.disposeAll();
  });

  it("returns unavailable when no server bin is installed", async () => {
    regDeps.existsSync = () => false; // nothing installed
    const mgr = new LSPManager();
    const ready = await mgr.ensureFor("/proj/src/a.ts");
    expect(ready.unavailable).toBe(true);
    expect(ready.reason).toMatch(/no language server installed/);
    await mgr.disposeAll();
  });
});

describe("diagnostics", () => {
  it("collects pushed diagnostics keyed by file", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    lastClient.emit("notify:textDocument/publishDiagnostics", {
      uri: (await import("../lsp-client.js")).pathToFileUri(
        path.resolve("/proj/src/a.ts"),
      ),
      diagnostics: [
        {
          message: "boom",
          severity: 1,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
    });
    const diags = mgr.getDiagnostics("/proj/src/a.ts");
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe("boom");
    await mgr.disposeAll();
  });
});

describe("disposeAll", () => {
  it("stops all servers and blocks further use", async () => {
    const mgr = new LSPManager();
    await mgr.ensureFor("/proj/src/a.ts");
    await mgr.disposeAll();
    expect(lastClient.running).toBe(false);
    await expect(mgr.ensureFor("/proj/src/a.ts")).rejects.toThrow(/disposed/);
  });
});

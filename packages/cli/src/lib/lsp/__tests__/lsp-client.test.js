/**
 * LSPClient tests — JSON-RPC handshake, request/response correlation,
 * notification dispatch, timeouts and crash propagation. A fake child process
 * is injected through `_deps.spawn`; no real language server is spawned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import {
  LSPClient,
  _deps,
  pathToFileUri,
  fileUriToPath,
  normalizeUri,
  buildSpawnCommand,
} from "../lsp-client.js";
import { encodeMessage, MessageBuffer } from "../jsonrpc-stream.js";

/** A fake language server process. Auto-replies to `initialize`; test controls the rest. */
class FakeChild extends EventEmitter {
  constructor({ autoInit = true } = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this._inbound = new MessageBuffer();
    this.received = [];
    this.killed = false;
    // Arrow keeps `this` bound to the FakeChild (no this-alias needed).
    this.stdin = {
      writable: true,
      write: (buf) => {
        this._inbound.append(buf);
        for (const msg of this._inbound.readAll()) {
          this.received.push(msg);
          if (autoInit && msg.method === "initialize") {
            this.reply(msg.id, { capabilities: { definitionProvider: true } });
          }
        }
        return true;
      },
    };
  }
  reply(id, result) {
    this.stdout.emit("data", encodeMessage({ jsonrpc: "2.0", id, result }));
  }
  replyError(id, error) {
    this.stdout.emit("data", encodeMessage({ jsonrpc: "2.0", id, error }));
  }
  notify(method, params) {
    this.stdout.emit("data", encodeMessage({ jsonrpc: "2.0", method, params }));
  }
  kill() {
    this.killed = true;
  }
}

let origSpawn;
beforeEach(() => {
  origSpawn = _deps.spawn;
});
afterEach(() => {
  _deps.spawn = origSpawn;
  vi.restoreAllMocks();
});

function makeClient(child, opts = {}) {
  _deps.spawn = vi.fn(() => child);
  return new LSPClient({
    command: "fake-lsp",
    args: ["--stdio"],
    rootPath: "/proj",
    ...opts,
  });
}

describe("LSPClient handshake", () => {
  it("spawns, sends initialize, and captures server capabilities", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    const caps = await client.start();
    expect(caps).toEqual({ definitionProvider: true });
    expect(client.running).toBe(true);
    // sent initialize then initialized notification
    expect(child.received[0].method).toBe("initialize");
    expect(child.received[1].method).toBe("initialized");
    // spawn used shell:false
    expect(_deps.spawn).toHaveBeenCalledWith(
      "fake-lsp",
      ["--stdio"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("kills the spawned server when the initialize handshake times out (no orphan)", async () => {
    const child = new FakeChild({ autoInit: false }); // never answers initialize
    const client = makeClient(child);
    await expect(client.start({ initTimeoutMs: 20 })).rejects.toThrow(
      /timed out/,
    );
    // The spawned process must be torn down, not left running forever.
    expect(child.killed).toBe(true);
    expect(client.running).toBe(false);
  });
});

describe("LSPClient request/response", () => {
  it("correlates a request to its response by id", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    const p = client.request("textDocument/definition", { x: 1 });
    // server replies to the definition request (id follows initialize=1 → 2)
    const req = child.received.find(
      (m) => m.method === "textDocument/definition",
    );
    child.reply(req.id, [
      {
        uri: "file:///proj/a.ts",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 3 },
        },
      },
    ]);
    const result = await p;
    expect(result[0].uri).toBe("file:///proj/a.ts");
  });

  it("rejects a request whose response carries an error", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    const p = client.request("bad/method", {});
    const req = child.received.find((m) => m.method === "bad/method");
    child.replyError(req.id, { code: -32601, message: "method not found" });
    await expect(p).rejects.toThrow(/method not found/);
  });

  it("times out a request with no response", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    await expect(
      client.request("slow/op", {}, { timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("LSPClient notifications", () => {
  it("emits server notifications by method", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    const got = vi.fn();
    client.on("notify:textDocument/publishDiagnostics", got);
    child.notify("textDocument/publishDiagnostics", {
      uri: "file:///proj/a.ts",
      diagnostics: [],
    });
    expect(got).toHaveBeenCalledWith({
      uri: "file:///proj/a.ts",
      diagnostics: [],
    });
  });

  it("auto-replies null to server→client requests so the server never blocks", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    child.stdout.emit(
      "data",
      encodeMessage({
        jsonrpc: "2.0",
        id: 999,
        method: "workspace/configuration",
        params: {},
      }),
    );
    const reply = child.received.find((m) => m.id === 999 && m.method == null);
    expect(reply).toEqual({ jsonrpc: "2.0", id: 999, result: null });
  });
});

describe("LSPClient lifecycle", () => {
  it("fails all pending requests when the process exits", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    const p = client.request("op", {});
    child.emit("exit", 1, null);
    await expect(p).rejects.toThrow(/exited|stopped/);
    expect(client.running).toBe(false);
  });

  it("stop() shuts down gracefully and is idempotent", async () => {
    const child = new FakeChild();
    const client = makeClient(child);
    await client.start();
    // auto-reply to shutdown
    child.stdin.write = (buf) => {
      const mb = new MessageBuffer().append(buf);
      for (const m of mb.readAll()) {
        child.received.push(m);
        if (m.method === "shutdown") child.reply(m.id, null);
      }
      return true;
    };
    await client.stop();
    await client.stop(); // no throw second time
    expect(child.killed).toBe(true);
  });
});

describe("uri <-> path", () => {
  it("round-trips a POSIX path", () => {
    expect(fileUriToPath(pathToFileUri("/home/u/a b.ts"))).toBe(
      process.platform === "win32" ? "\\home\\u\\a b.ts" : "/home/u/a b.ts",
    );
  });
  it("builds a windows drive URI", () => {
    expect(pathToFileUri("C:\\proj\\a.ts")).toBe("file:///C%3A/proj/a.ts");
  });
});

describe("normalizeUri", () => {
  it("lowercases the windows drive letter so client/server keys match", () => {
    // path.resolve yields C:, servers echo c: — must collapse to one key
    expect(normalizeUri("file:///C%3A/proj/a.ts")).toBe("file:///c:/proj/a.ts");
    expect(normalizeUri("file:///c%3A/proj/a.ts")).toBe("file:///c:/proj/a.ts");
    expect(normalizeUri("file:///C:/proj/a.ts")).toBe("file:///c:/proj/a.ts");
  });
  it("collapses the %3A and bare-colon drive forms to ONE key (gopls)", () => {
    // The client sends percent-encoded didOpen URIs (file:///C%3A/…);
    // tsserver/pyright echo that form back, but gopls REWRITES to a bare
    // colon (file:///C:/…). Before this canonicalization the two forms were
    // distinct diagnostics-Map keys, so every gopls publish missed the
    // didOpen key and `cc code-intel diag` on Go was permanently empty.
    const ours = normalizeUri("file:///C%3A/Users/u/goproj/broken.go");
    const goplsPublished = normalizeUri("file:///C:/Users/u/goproj/broken.go");
    expect(ours).toBe(goplsPublished);
  });
  it("leaves POSIX file URIs unchanged", () => {
    expect(normalizeUri("file:///home/u/a.ts")).toBe("file:///home/u/a.ts");
  });
});

describe("buildSpawnCommand", () => {
  const isWin = process.platform === "win32";
  it("passes non-batch commands through verbatim", () => {
    const spec = buildSpawnCommand("/usr/bin/gopls", []);
    expect(spec).toEqual({
      file: "/usr/bin/gopls",
      args: [],
      windowsVerbatimArguments: false,
    });
  });
  it.runIf(isWin)(
    "routes a .cmd shim through cmd.exe /d /s /c with a quoted path",
    () => {
      const spec = buildSpawnCommand(
        "C:\\proj\\node_modules\\.bin\\typescript-language-server.cmd",
        ["--stdio"],
      );
      expect(spec.windowsVerbatimArguments).toBe(true);
      expect(spec.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(spec.args[3]).toBe(
        '"C:\\proj\\node_modules\\.bin\\typescript-language-server.cmd" --stdio',
      );
    },
  );
  it.runIf(isWin)("quotes a path containing spaces", () => {
    const spec = buildSpawnCommand("C:\\Program Files\\svr.cmd", []);
    expect(spec.args[3]).toBe('"C:\\Program Files\\svr.cmd"');
  });
});

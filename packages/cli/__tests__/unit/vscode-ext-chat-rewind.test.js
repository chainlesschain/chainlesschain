/**
 * Panel `/rewind` (checkpoint restore) — the pure rewind-commands helpers and
 * the ChatViewProvider orchestration around a native QuickPick. Both run
 * headless in the CLI suite (no vscode host, injected execFile + fake window).
 */
import { describe, it, expect } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import * as rewindMod from "../../../vscode-extension/src/chat/rewind-commands.js";

const rewind = rewindMod.default || rewindMod;

describe("rewind-commands (pure)", () => {
  it("builds session-scoped list/restore args (force + json)", () => {
    expect(rewind.buildListArgs("sess-x")).toEqual([
      "checkpoint",
      "list",
      "-s",
      "sess-x",
      "--json",
    ]);
    expect(rewind.buildRestoreArgs("sess-x", "cp-1")).toEqual([
      "checkpoint",
      "restore",
      "cp-1",
      "-s",
      "sess-x",
      "--force",
      "--json",
    ]);
    // missing session → "default" (never an empty -s)
    expect(rewind.buildListArgs()).toContain("default");
  });

  it("maps a checkpoint row to a QuickPick item carrying its id", () => {
    const item = rewind.toQuickPickItem({
      id: "cp-1",
      createdAt: "2026-06-15T10:00:00Z",
      fileCount: 3,
      label: "before edit",
    });
    expect(item.id).toBe("cp-1");
    expect(item.label).toBe("cp-1");
    expect(item.description).toContain("3 file(s)");
    expect(item.detail).toBe("before edit");
  });

  it("restoredCount reads either restoredCount or restored, else null", () => {
    expect(rewind.restoredCount({ restoredCount: 4 })).toBe(4);
    expect(rewind.restoredCount({ restored: 2 })).toBe(2);
    expect(rewind.restoredCount({})).toBe(null);
    expect(rewind.restoredCount(null)).toBe(null);
  });

  it("runCliJson parses stdout JSON via injected execFile; bad JSON → ok:false", async () => {
    const okRun = (cmd, args, opts, cb) => cb(null, '[{"id":"cp-1"}]', "");
    const res = await rewind.runCliJson({
      args: ["checkpoint", "list"],
      deps: { execFile: okRun },
    });
    expect(res).toEqual({ ok: true, data: [{ id: "cp-1" }] });

    const badRun = (cmd, args, opts, cb) => cb(null, "not-json", "");
    const bad = await rewind.runCliJson({
      args: [],
      deps: { execFile: badRun },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("not-json");

    const errRun = (cmd, args, opts, cb) =>
      cb(new Error("boom"), "", "stderr msg");
    const err = await rewind.runCliJson({
      args: [],
      deps: { execFile: errRun },
    });
    expect(err).toEqual({ ok: false, error: "stderr msg" });
  });
});

// --- ChatViewProvider._rewind orchestration ---

function makeMemento(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    update: (k, v) => m.set(k, v),
    _map: m,
  };
}

function makeProvider({ session = null, quickPick = null, rewindStub } = {}) {
  const posted = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: { showQuickPick: async () => quickPick },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true }), rewind: rewindStub },
    state: makeMemento(
      session ? { "chainlesschain.chat.sessionId": session } : {},
    ),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted };
}

const lastPost = (posted) => posted[posted.length - 1];

describe("ChatViewProvider._rewind", () => {
  // A rewind stub over the real pure helpers with a scripted runCliJson.
  const stubWith = (responses) => {
    let i = 0;
    return {
      ...rewind,
      _calls: [],
      runCliJson(opts) {
        this._calls.push(opts.args);
        return Promise.resolve(responses[i++]);
      },
    };
  };

  it("hints to send a message first when there is no session", async () => {
    const { provider, posted } = makeProvider({ session: null });
    await provider._rewind();
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("send a message first"),
    });
  });

  it("hints when the session has no checkpoints yet", async () => {
    const stub = stubWith([{ ok: true, data: [] }]);
    const { provider, posted } = makeProvider({
      session: "sess-x",
      rewindStub: stub,
    });
    await provider._rewind();
    expect(stub._calls[0]).toEqual(rewind.buildListArgs("sess-x"));
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("no checkpoints"),
    });
  });

  it("lists → picks → restores, reporting the restored count", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1", createdAt: "t", fileCount: 2 }] },
      { ok: true, data: { restoredCount: 2 } },
    ]);
    const { provider, posted } = makeProvider({
      session: "sess-x",
      quickPick: { id: "cp-1", label: "cp-1" },
      rewindStub: stub,
    });
    await provider._rewind();
    expect(stub._calls[1]).toEqual(rewind.buildRestoreArgs("sess-x", "cp-1"));
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("rewound to cp-1"),
    });
    expect(lastPost(posted).text).toContain("2 file(s) restored");
  });

  it("cancelling the QuickPick does not restore", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1" }] },
      // no second response — restore must never be called
    ]);
    const { provider } = makeProvider({
      session: "sess-x",
      quickPick: undefined, // user dismissed
      rewindStub: stub,
    });
    await provider._rewind();
    expect(stub._calls).toHaveLength(1); // only the list call
  });

  it("surfaces a restore failure as an error", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1" }] },
      { ok: false, error: "dirty work tree" },
    ]);
    const { provider, posted } = makeProvider({
      session: "sess-x",
      quickPick: { id: "cp-1", label: "cp-1" },
      rewindStub: stub,
    });
    await provider._rewind();
    expect(lastPost(posted)).toMatchObject({
      kind: "error",
      text: expect.stringContaining("dirty work tree"),
    });
  });
});

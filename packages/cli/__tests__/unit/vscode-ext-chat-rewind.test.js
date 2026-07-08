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

  it("builds a session-scoped show --diff args for the preview", () => {
    expect(rewind.buildShowDiffArgs("sess-x", "cp-1")).toEqual([
      "checkpoint",
      "show",
      "cp-1",
      "--diff",
      "-s",
      "sess-x",
      "--json",
    ]);
  });

  it("formatDiffPreview: raw patch as-is, else a status summary, else empty", () => {
    expect(rewind.formatDiffPreview({ diff: "--- a\n+++ b\n" })).toBe(
      "--- a\n+++ b",
    );
    const status = rewind.formatDiffPreview({
      modified: [{ rel: "a.js" }],
      added: ["b.js"],
      deleted: [],
    });
    expect(status).toContain("modified (1):");
    expect(status).toContain("a.js");
    expect(status).toContain("added (1):");
    expect(status).not.toContain("deleted"); // empty section dropped
    expect(rewind.formatDiffPreview({})).toBe("");
    expect(rewind.formatDiffPreview(null)).toBe("");
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

function makeProvider({
  session = null,
  quickPick = null,
  confirm = "Restore",
  rewindStub,
} = {}) {
  const posted = [];
  const shownDocs = [];
  const vscode = {
    commands: { executeCommand() {} },
    window: {
      showQuickPick: async () => quickPick,
      // The restore-confirm modal (default: user clicks "Restore").
      showWarningMessage: async () => confirm,
      showTextDocument: async (doc) => (shownDocs.push(doc), undefined),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
      openTextDocument: async (opts) => ({ ...opts }),
    },
  };
  vscode.__shownDocs = shownDocs;
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true }), rewind: rewindStub },
    state: makeMemento(
      session ? { "chainlesschain.chat.sessionId": session } : {},
    ),
  });
  provider.view = {
    webview: { postMessage: (msg) => (posted.push(msg), Promise.resolve()) },
  };
  return { provider, posted, shownDocs };
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

  it("lists → picks → previews the diff → confirms → restores", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1", createdAt: "t", fileCount: 2 }] },
      {
        ok: true,
        data: { diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n" },
      },
      { ok: true, data: { restoredCount: 2 } },
    ]);
    const { provider, posted, shownDocs } = makeProvider({
      session: "sess-x",
      quickPick: { id: "cp-1", label: "cp-1" },
      confirm: "Restore",
      rewindStub: stub,
    });
    await provider._rewind();
    // list → show --diff → restore, in that order
    expect(stub._calls[0]).toEqual(rewind.buildListArgs("sess-x"));
    expect(stub._calls[1]).toEqual(rewind.buildShowDiffArgs("sess-x", "cp-1"));
    expect(stub._calls[2]).toEqual(rewind.buildRestoreArgs("sess-x", "cp-1"));
    // the diff opened as a preview document (diff language)
    expect(shownDocs).toHaveLength(1);
    expect(shownDocs[0]).toMatchObject({ language: "diff" });
    expect(shownDocs[0].content).toContain("+new");
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("rewound to cp-1"),
    });
    expect(lastPost(posted).text).toContain("2 file(s) restored");
  });

  it("cancelling the confirm modal previews but does NOT restore", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1" }] },
      { ok: true, data: { diff: "--- a\n+++ b\n" } },
      // no restore response — restore must never be called
    ]);
    const { provider, posted } = makeProvider({
      session: "sess-x",
      quickPick: { id: "cp-1", label: "cp-1" },
      confirm: null, // user dismissed the modal (null, not undefined → no default)
      rewindStub: stub,
    });
    await provider._rewind();
    expect(stub._calls).toHaveLength(2); // list + show-diff, no restore
    expect(lastPost(posted)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("cancelled"),
    });
  });

  it("cancelling the QuickPick does not preview or restore", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1" }] },
      // no further responses — nothing past the list must run
    ]);
    const { provider } = makeProvider({
      session: "sess-x",
      quickPick: undefined, // user dismissed
      rewindStub: stub,
    });
    await provider._rewind();
    expect(stub._calls).toHaveLength(1); // only the list call
  });

  it("still restores when the diff preview is unavailable (best-effort)", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1" }] },
      { ok: false, error: "no diff engine" }, // show --diff failed
      { ok: true, data: { restoredCount: 1 } },
    ]);
    const { provider, posted, shownDocs } = makeProvider({
      session: "sess-x",
      quickPick: { id: "cp-1", label: "cp-1" },
      confirm: "Restore",
      rewindStub: stub,
    });
    await provider._rewind();
    expect(shownDocs).toHaveLength(0); // nothing to preview
    expect(stub._calls[2]).toEqual(rewind.buildRestoreArgs("sess-x", "cp-1"));
    expect(lastPost(posted).text).toContain("rewound to cp-1");
  });

  it("surfaces a restore failure as an error", async () => {
    const stub = stubWith([
      { ok: true, data: [{ id: "cp-1" }] },
      { ok: true, data: { diff: "x" } },
      { ok: false, error: "dirty work tree" },
    ]);
    const { provider, posted } = makeProvider({
      session: "sess-x",
      quickPick: { id: "cp-1", label: "cp-1" },
      confirm: "Restore",
      rewindStub: stub,
    });
    await provider._rewind();
    expect(lastPost(posted)).toMatchObject({
      kind: "error",
      text: expect.stringContaining("dirty work tree"),
    });
  });
});

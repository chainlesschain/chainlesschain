import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DraftStore } from "../../../vscode-extension/src/chat/draft-store.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";
import { Window } from "happy-dom";

const roots = [];
const providers = [];
afterEach(async () => {
  for (const p of providers.splice(0)) p.dispose();
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function storage() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "cc-draft-"));
  roots.push(root);
  return root;
}
const image = {
  data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
};
function receipt(sessionId, clientMessageId) {
  return {
    sessionId,
    clientMessageId,
    inputDigest: "a".repeat(64),
    eventHash: "b".repeat(64),
  };
}

describe("durable composer storage", () => {
  it("recovers text and image snapshots in a fresh store, with no image data in metadata", async () => {
    const root = await storage();
    const key = randomUUID();
    const store = new DraftStore(root);
    await store.save(key, { text: "draft 中文", images: [image] });
    await store.save(key, { text: "edited 中文" });
    const restored = await new DraftStore(root).view(key);
    expect(restored.composer.text).toBe("edited 中文");
    expect(restored.composer.images[0].data).toBe(image.data);
    const metadata = await fs.readFile(
      path.join(root, key, "draft.json"),
      "utf8",
    );
    expect(metadata).not.toContain("base64");
  });
  it("saves a submitted snapshot before clearing the composer, and retains unknown sends", async () => {
    const root = await storage();
    const key = randomUUID();
    const store = new DraftStore(root);
    await store.save(key, { text: "old", images: [image] });
    const prepared = await store.prepare(key, "session-1", "input-1", {
      text: "submitted",
      images: [image],
    });
    expect((await store.view(key)).composer.text).toBe("");
    await store.settle(key, "input-1", "unknown");
    expect(
      (await new DraftStore(root).recover(key, "input-1")).images[0].data,
    ).toBe(image.data);
    await expect(
      store.settle(key, "input-1", "accepted", receipt("other", "input-1")),
    ).rejects.toThrow("match");
    await store.settle(
      key,
      "input-1",
      "accepted",
      receipt("session-1", "input-1"),
    );
    await expect(store.recover(key, "input-1")).rejects.toThrow("Accepted");
    await expect(fs.stat(prepared.paths[0])).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("does not silently omit missing attachments or accept a tampered snapshot", async () => {
    const root = await storage();
    const key = randomUUID();
    const store = new DraftStore(root);
    await store.save(key, { text: "keep text", images: [image] });
    const record = JSON.parse(
      await fs.readFile(path.join(root, key, "draft.json"), "utf8"),
    );
    await fs.unlink(path.join(root, key, record.composer.images[0].file));
    expect((await store.view(key)).composer).toMatchObject({
      text: "keep text",
      missingImages: true,
    });
    record.composer.images[0].file = "../../secret.png";
    await fs.writeFile(
      path.join(root, key, "draft.json"),
      JSON.stringify(record),
    );
    await expect(store.view(key)).rejects.toThrow("Invalid draft");
  });
  it("retains the old draft and cleans new attachments when publishing fails", async () => {
    const root = await storage();
    const key = randomUUID();
    const store = new DraftStore(root);
    await store.save(key, { text: "original", images: [image] });
    const before = (await fs.readdir(path.join(root, key))).sort();
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("ENOSPC"));
    try {
      await expect(
        store.save(key, { text: "new", images: [image] }),
      ).rejects.toThrow("ENOSPC");
    } finally {
      rename.mockRestore();
    }
    expect((await store.view(key)).composer.text).toBe("original");
    expect((await fs.readdir(path.join(root, key))).sort()).toEqual(before);
  });
  it("bounds pending records and does not evict unknown inputs", async () => {
    const store = new DraftStore(await storage());
    const key = randomUUID();
    for (let i = 0; i < 8; i++)
      await store.prepare(key, "session", `input-${i}`, {
        text: `${i}`,
        images: [],
      });
    await expect(
      store.prepare(key, "session", "input-9", { text: "9" }),
    ).rejects.toThrow("eight");
    expect((await store.view(key)).pending).toHaveLength(8);
    await expect(store.save(key, { text: "a".repeat(100001) })).rejects.toThrow(
      "100,000",
    );
  });

  it("serializes rapid edits without rewriting attachment snapshots", async () => {
    const root = await storage();
    const key = randomUUID();
    const store = new DraftStore(root);
    await store.save(key, { text: "first", images: [image] });
    const before = (await fs.readdir(path.join(root, key))).filter((n) =>
      n.endsWith(".png"),
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.save(key, { text: `edit-${i}` }),
      ),
    );
    expect((await store.view(key)).composer.text).toBe("edit-19");
    expect(
      (await fs.readdir(path.join(root, key))).filter((n) =>
        n.endsWith(".png"),
      ),
    ).toEqual(before);
    await store.save(key, { text: "", images: [] });
    expect(await store.list()).toEqual([]);
  });
});

function host(root, state = new Map(), deps = {}) {
  const messages = [];
  const sessions = [];
  const provider = new ChatViewProvider(
    {
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({ get: () => undefined }),
      },
      commands: { executeCommand() {} },
      window: {},
    },
    {
      storagePath: root,
      state: {
        get: (k) => state.get(k),
        update: async (k, v) => state.set(k, v),
      },
      deps: {
        resolveChatLlm: () => ({}),
        loadTranscriptPage: async () => {
          throw new Error("no transcript");
        },
        createSession: (cfg) => {
          const session = {
            cfg,
            running: true,
            sent: [],
            sendEvent: vi.fn((e) => {
              session.sent.push(e);
              return true;
            }),
            stop() {
              this.running = false;
            },
          };
          sessions.push(session);
          return session;
        },
        ...deps,
      },
    },
  );
  providers.push(provider);
  provider.view = {
    webview: {
      postMessage: (m) => {
        messages.push(m);
        return Promise.resolve(true);
      },
    },
  };
  provider._activeConv();
  provider._postTabs();
  return { provider, sessions, messages, state };
}
async function until(condition) {
  await vi.waitFor(() => expect(condition()).toBeTruthy(), {
    timeout: 4000,
    interval: 5,
  });
}
function init(h, version = 1) {
  const conv = h.provider._activeConv();
  h.sessions.at(-1).cfg.onEvent({
    type: "system",
    subtype: "init",
    session_id: conv.sessionId,
    input_receipts: { version },
  });
}

describe("host durable input lifecycle", () => {
  it("does not start the agent when the submission cannot be saved", async () => {
    const h = host(await storage());
    const conv = h.provider._activeConv();
    await h.provider._draftStore.save(conv.draftKey, {
      text: "retained draft",
    });
    const prepare = vi
      .spyOn(h.provider._draftStore, "prepare")
      .mockRejectedValueOnce(new Error("disk full"));
    await h.provider._handleMessage({
      type: "send",
      text: "retained draft",
      clientMessageId: "input-1",
    });
    expect(h.sessions).toEqual([]);
    expect(
      (await h.provider._draftStore.view(conv.draftKey)).composer.text,
    ).toBe("retained draft");
    expect(h.messages.find((m) => m.kind === "submissionFailed")).toMatchObject(
      { stored: false },
    );
    prepare.mockRestore();
  });
  it("waits for init, persists UNKNOWN before writing and settles only a correlated ACK", async () => {
    const h = host(await storage());
    const conv = h.provider._activeConv();
    const sending = h.provider._handleMessage({
      type: "send",
      text: "question",
      clientMessageId: "input-1",
    });
    await until(() => h.sessions.length === 1);
    expect(h.sessions[0].sent).toEqual([]);
    init(h);
    await sending;
    expect(h.sessions[0].sent[0]).toMatchObject({
      type: "user",
      client_message_id: "input-1",
      text: "question",
    });
    expect(
      (await h.provider._draftStore.view(conv.draftKey)).pending[0].status,
    ).toBe("unknown");
    expect(h.messages.some((m) => m.kind === "sendAccepted")).toBe(false);
    h.sessions[0].cfg.onEvent({
      type: "system",
      subtype: "input_accepted",
      session_id: "wrong",
      client_message_id: "input-1",
      receipt: receipt("wrong", "input-1"),
    });
    expect(
      (await h.provider._draftStore.view(conv.draftKey)).pending[0].status,
    ).toBe("unknown");
    h.sessions[0].cfg.onEvent({
      type: "system",
      subtype: "input_accepted",
      session_id: conv.sessionId,
      client_message_id: "input-1",
      receipt: receipt(conv.sessionId, "input-1"),
    });
    expect(
      (await h.provider._draftStore.view(conv.draftKey)).pending[0].status,
    ).toBe("accepted");
  });
  it("reloads a stable draft identity and reconciles read-only without starting a session", async () => {
    const root = await storage();
    const h = host(root);
    const conv = h.provider._activeConv();
    const sending = h.provider._handleMessage({
      type: "send",
      text: "lost ACK",
      clientMessageId: "input-1",
    });
    await until(() => h.sessions.length);
    init(h);
    await sending;
    await h.provider._draftStore.save(conv.draftKey, {
      text: "next draft",
      images: [image],
    });
    h.provider.dispose();
    let finishLookup;
    const lookup = vi.fn(
      (sid, id) =>
        new Promise((resolve) => {
          finishLookup = () =>
            resolve({ accepted: true, receipt: receipt(sid, id) });
        }),
    );
    const restored = host(root, h.state, { readInputReceipt: lookup });
    const next = restored.provider._activeConv();
    expect(next.draftKey).toBe(conv.draftKey);
    const recovering = restored.provider._restoreDraft(next, {
      reconcile: true,
    });
    await until(() => finishLookup);
    expect(restored.sessions).toEqual([]);
    expect(lookup).toHaveBeenCalledWith(conv.sessionId, "input-1");
    const snapshot = restored.messages.find((m) => m.kind === "draftSnapshot");
    expect(snapshot.composer.text).toBe("next draft");
    expect(snapshot.composer.images[0].data).toBe(image.data);
    expect(snapshot.pending[0].status).toBe("unknown");
    finishLookup();
    await recovering;
    expect(
      restored.messages.filter((m) => m.kind === "draftSnapshot").at(-1)
        .pending[0].status,
    ).toBe("accepted");
  });
  it("keeps legacy CLI and failed pipe writes unknown and recoverable", async () => {
    const h = host(await storage());
    const conv = h.provider._activeConv();
    const sending = h.provider._handleMessage({
      type: "send",
      text: "retain me",
      clientMessageId: "input-1",
    });
    await until(() => h.sessions.length);
    h.sessions[0].sendEvent.mockReturnValue(false);
    init(h, 0);
    await sending;
    expect(
      (await h.provider._draftStore.view(conv.draftKey)).pending[0].status,
    ).toBe("unknown");
    expect(
      (await h.provider._draftStore.recover(conv.draftKey, "input-1")).text,
    ).toBe("retain me");
  });
  it("does not dispatch a saved input after its conversation is reset", async () => {
    const h = host(await storage());
    const conv = h.provider._activeConv();
    const sending = h.provider._handleMessage({
      type: "send",
      text: "old",
      clientMessageId: "input-1",
    });
    await until(() => h.sessions.length);
    const oldKey = conv.draftKey;
    h.provider._handleMessage({ type: "new" });
    await sending;
    expect(h.sessions[0].sent).toEqual([]);
    expect(conv.draftKey).not.toBe(oldKey);
    expect((await h.provider._draftStore.view(oldKey)).pending[0].status).toBe(
      "rejected",
    );
  });

  it("keeps closed drafts discoverable and reopens the same draft identity", async () => {
    const h = host(await storage());
    const conv = h.provider._activeConv();
    await h.provider._draftStore.save(conv.draftKey, { text: "closed draft" });
    h.provider._webviewReady = true;
    h.provider._handleMessage({ type: "closeTab", id: conv.id });
    expect((await h.provider._draftStore.list()).map((d) => d.label)).toContain(
      "closed draft",
    );
    h.provider.reopenClosedSession();
    expect(h.provider._activeConv().draftKey).toBe(conv.draftKey);
    expect(h.sessions).toEqual([]);
  });
});

function webview(backup) {
  const window = new Window({
    settings: {
      enableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  const posted = [];
  let state = backup || {};
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => posted.push(m),
    getState: () => state,
    setState: (s) => {
      state = s;
    },
  });
  window.document.write(
    buildChatHtml({ nonce: "n", cspSource: "vscode-resource:" }),
  );
  const emit = (data) =>
    window.dispatchEvent(new window.MessageEvent("message", { data }));
  const keys = {
    a: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    b: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  };
  const tabs = (id) =>
    emit({
      kind: "tabs",
      activeId: id,
      tabs: Object.keys(keys).map((id) => ({
        id,
        title: id,
        draftKey: keys[id],
        draftStorage: true,
      })),
    });
  return {
    window,
    posted,
    emit,
    keys,
    tabs,
    input: window.document.getElementById("input"),
    state: () => state,
  };
}
describe("composer recovery in the generated Webview", () => {
  it("restores saved text and images, but never overwrites newer local edits", async () => {
    const ui = webview();
    try {
      ui.tabs("a");
      ui.emit({
        kind: "draftSnapshot",
        convId: "a",
        draftKey: ui.keys.a,
        composer: { text: "saved", images: [image] },
        pending: [],
      });
      expect(ui.input.value).toBe("saved");
      expect(
        ui.window.document.getElementById("attach").querySelectorAll(".chip"),
      ).toHaveLength(1);
      ui.input.value = "new typing";
      ui.input.dispatchEvent(new ui.window.Event("input"));
      ui.emit({
        kind: "draftSnapshot",
        convId: "a",
        draftKey: ui.keys.a,
        composer: { text: "stale", images: [] },
        pending: [],
      });
      expect(ui.input.value).toBe("new typing");
      expect(ui.state().draftTextBackup.text).toBe("new typing");
    } finally {
      await ui.window.happyDOM.abort();
    }
  });
  it("keeps input until a matching saved-submission ACK, including background ACKs", async () => {
    const ui = webview();
    try {
      ui.tabs("a");
      ui.input.value = "A question";
      ui.input.dispatchEvent(new ui.window.Event("input"));
      ui.emit({
        kind: "draftSnapshot",
        convId: "a",
        draftKey: ui.keys.a,
        composer: { text: "", images: [] },
        pending: [],
      });
      ui.window.document.getElementById("send").click();
      const send = ui.posted.find((m) => m.type === "send");
      expect(send.clientMessageId).toBeTruthy();
      expect(ui.input.value).toBe("A question");
      ui.tabs("b");
      ui.input.value = "B draft";
      ui.input.dispatchEvent(new ui.window.Event("input"));
      ui.emit({
        kind: "submissionStored",
        convId: "a",
        draftKey: ui.keys.a,
        clientMessageId: send.clientMessageId,
      });
      expect(ui.input.value).toBe("B draft");
      ui.tabs("a");
      expect(ui.input.value).toBe("");
    } finally {
      await ui.window.happyDOM.abort();
    }
  });
  it("restores the short text backup across Webview reload and blocks missing images", async () => {
    const key = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ui = webview({
      draftTextBackup: { key, text: "last keystroke", pendingId: null },
    });
    try {
      ui.tabs("a");
      expect(ui.input.value).toBe("last keystroke");
      ui.window.document.getElementById("send").click();
      expect(ui.posted.filter((m) => m.type === "send")).toEqual([]);
      ui.emit({
        kind: "draftSnapshot",
        convId: "a",
        draftKey: ui.keys.a,
        composer: { text: "older text", images: [image] },
        pending: [],
      });
      expect(ui.input.value).toBe("last keystroke");
      expect(
        ui.window.document.getElementById("attach").querySelectorAll(".chip"),
      ).toHaveLength(1);
      ui.tabs("b");
      ui.emit({
        kind: "draftSnapshot",
        convId: "b",
        draftKey: ui.keys.b,
        composer: { text: "image draft", images: [], missingImages: true },
        pending: [],
      });
      ui.window.document.getElementById("send").click();
      expect(ui.posted.filter((m) => m.type === "send")).toEqual([]);
    } finally {
      await ui.window.happyDOM.abort();
    }
  });
});

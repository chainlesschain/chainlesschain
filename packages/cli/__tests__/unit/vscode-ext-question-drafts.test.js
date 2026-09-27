import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Window } from "happy-dom";
import { DraftStore } from "../../../vscode-extension/src/chat/draft-store.js";
import { QuestionDrafts } from "../../../vscode-extension/src/chat/question-drafts.js";
import {
  questionIdentity,
  questionFields,
  normalizeQuestionFields,
} from "../../../vscode-extension/src/chat/question-draft-contract.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

const cleanups = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
async function storage() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "cc-question-"));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const binding = {
  backgroundAgentId: null,
  sessionId: "session-1",
  turnId: "turn-1",
  toolUseId: "tool-1",
  sequence: 1,
};
const request = {
  kind: "question",
  id: "q1",
  question: "Choose a target",
  binding,
};
const values = [{ key: "answer", value: "half entered 中文" }];
const payload = (q, extra = {}) => ({
  ...q,
  fields: values,
  revision: 1,
  ...extra,
});
function controller(store, overrides = {}) {
  cleanups.push(async () => {
    let queue;
    do {
      queue = store.queue;
      await queue;
    } while (queue !== store.queue);
  });
  const conv = {
    id: "a",
    sessionId: "session-1",
    draftKey: randomUUID(),
    _sessionToken: {},
    session: { running: true, sendEvent: vi.fn(() => true) },
    ...overrides,
  };
  const messages = [];
  const drafts = new QuestionDrafts({
    store,
    getConversation: (id) => (id === conv.id ? conv : null),
    post: (m) => messages.push(m),
    refresh: () => {},
  });
  return { drafts, conv, messages };
}
function ui(backup = {}) {
  const window = new Window({
    settings: {
      enableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  cleanups.push(() => window.happyDOM.abort());
  const sent = [];
  let state = backup;
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => sent.push(m),
    getState: () => state,
    setState: (v) => {
      state = v;
    },
  });
  window.document.write(
    buildChatHtml({ nonce: "n", cspSource: "vscode-resource:" }),
  );
  const emit = (data) =>
    window.dispatchEvent(new window.MessageEvent("message", { data }));
  const card = (q) => window.document.getElementById("q-" + q.questionInstance);
  return { window, sent, emit, card, state: () => state };
}

describe("question recovery authority and persistence", () => {
  it("recovers an unfinished bound question in a fresh host without sending an answer", async () => {
    const root = await storage();
    const first = controller(new DraftStore(root));
    const q = first.drafts.register(first.conv, request);
    await first.drafts.save(payload(q));
    const next = controller(new DraftStore(root), {
      draftKey: first.conv.draftKey,
    });
    const restored = next.drafts.register(next.conv, request);
    expect(restored.questionInstance).not.toBe(q.questionInstance);
    await next.drafts.restore(restored);
    expect(next.messages.at(-1)).toMatchObject({
      kind: "questionDraftSnapshot",
      fields: values,
      state: "draft",
    });
    expect(next.conv.session.sendEvent).not.toHaveBeenCalled();
    await next.drafts.save(
      payload(restored, { fields: [{ key: "answer", value: "finished" }] }),
    );
    expect(
      (await next.drafts.store.view(first.conv.draftKey)).questions,
    ).toHaveLength(1);
  });

  it("archives cancellations, schema changes and late edits without reviving the request", async () => {
    const h = controller(new DraftStore(await storage()));
    const q = h.drafts.register(h.conv, request);
    await h.drafts.save(payload(q));
    const changed = h.drafts.register(h.conv, {
      ...request,
      options: ["a", "b"],
    });
    await h.drafts.save(
      payload(q, { fields: [{ key: "answer", value: "late text" }] }),
    );
    await h.drafts.answer(payload(q, { answer: "stale" }));
    await h.drafts.restore(changed);
    expect(h.messages.at(-1).fields).toEqual([]);
    expect(h.conv.session.sendEvent).not.toHaveBeenCalled();
    expect(
      (await h.drafts.store.view(h.conv.draftKey)).questions[0],
    ).toMatchObject({ status: "archived", text: "Answer: late text" });
  });

  it("does not restore unbound or already submitted answers as a new live form", async () => {
    const root = await storage();
    for (const bound of [false, true]) {
      const h = controller(new DraftStore(root));
      const original = { ...request, binding: bound ? binding : undefined };
      const q = h.drafts.register(h.conv, original);
      await h.drafts.save(payload(q));
      if (bound) await h.drafts.answer(payload(q, { answer: "sent" }));
      const next = controller(new DraftStore(root), {
        draftKey: h.conv.draftKey,
      });
      const nextQ = next.drafts.register(next.conv, original);
      await next.drafts.restore(nextQ);
      expect(next.messages.at(-1).fields).toEqual([]);
      expect(
        (await next.drafts.store.view(h.conv.draftKey)).questions[0].text,
      ).toContain("half entered");
      expect(next.conv.session.sendEvent).not.toHaveBeenCalled();
    }
  });

  it("reserves one response, persists before writing, and leaves failed delivery unknown", async () => {
    const h = controller(new DraftStore(await storage()));
    const q = h.drafts.register(h.conv, request);
    h.conv.session.sendEvent.mockReturnValue(false);
    await Promise.all([
      h.drafts.answer(payload(q, { answer: "x" })),
      h.drafts.answer(payload(q, { answer: "x" })),
    ]);
    expect(h.conv.session.sendEvent).toHaveBeenCalledOnce();
    expect(h.messages.at(-1)).toMatchObject({ state: "unknown" });
    expect(
      (await h.drafts.store.view(h.conv.draftKey)).questions[0].status,
    ).toBe("archived");
    await h.drafts.answer(payload(q, { answer: "retry" }));
    expect(h.conv.session.sendEvent).toHaveBeenCalledOnce();
  });

  it("does not dispatch on storage failure or a reset during the save", async () => {
    const h = controller(new DraftStore(await storage()));
    const q = h.drafts.register(h.conv, request);
    await h.drafts.restore(q);
    const save = vi
      .spyOn(h.drafts.store, "saveQuestion")
      .mockRejectedValueOnce(new Error("disk full"));
    await h.drafts.answer(payload(q, { answer: "x" }));
    expect(h.messages.at(-1)).toMatchObject({
      state: "draft",
      text: "Answer was not sent: disk full",
    });
    save.mockRestore();
    let release;
    const original = h.drafts.store.saveQuestion.bind(h.drafts.store);
    vi.spyOn(h.drafts.store, "saveQuestion").mockImplementation(
      async (...args) => {
        await new Promise((resolve) => {
          release = resolve;
        });
        return original(...args);
      },
    );
    const sending = h.drafts.answer(payload(q, { answer: "x" }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    h.conv._sessionToken = {};
    release();
    await sending;
    expect(h.conv.session.sendEvent).not.toHaveBeenCalled();
  });

  it("keeps deferred questions across turn end and bounds stored questions", async () => {
    const h = controller(new DraftStore(await storage()));
    const blocking = h.drafts.register(h.conv, request);
    const deferred = h.drafts.register(h.conv, {
      ...request,
      id: "later",
      blocking: false,
    });
    await h.drafts.save(payload(blocking));
    await h.drafts.save(payload(deferred));
    h.drafts.archiveConversation(h.conv, { blockingOnly: true });
    expect(h.drafts.match(deferred).state).toBe("draft");
    expect(h.drafts.match(blocking).state).toBe("archived");
    for (let i = 2; i < 16; i++)
      await h.drafts.save(
        payload(h.drafts.register(h.conv, { ...request, id: "q" + i })),
      );
    await expect(
      h.drafts.save(
        payload(h.drafts.register(h.conv, { ...request, id: "overflow" })),
      ),
    ).rejects.toThrow("16 questions");
    expect((await h.drafts.store.list())[0].label).toBe(request.question);
  });
});

describe("generated question forms", () => {
  it("retains multiselect edits when switching between conversation tabs", async () => {
    const h = controller(new DraftStore(await storage()));
    const q = h.drafts.register(h.conv, {
      ...request,
      options: ["alpha", "beta"],
      multiSelect: true,
    });
    const view = ui();
    const tabs = (activeId) =>
      view.emit({
        kind: "tabs",
        activeId,
        tabs: [
          { id: "a", title: "A", draftKey: h.conv.draftKey },
          { id: "b", title: "B", draftKey: randomUUID() },
        ],
      });
    tabs("a");
    view.emit(q);
    const original = view.card(q);
    original.querySelectorAll("input")[1].checked = true;
    original
      .querySelectorAll("input")[1]
      .dispatchEvent(new view.window.Event("change"));
    tabs("b");
    expect(view.card(q)).toBeNull();
    tabs("a");
    view.emit(q);
    expect(view.card(q)).toBe(original);
    expect(original.querySelectorAll("input")[1].checked).toBe(true);
    expect(view.sent.some((m) => m.type === "answer")).toBe(false);
  });
  it("preserves partial form values through Webview reconstruction, omitting write-only secrets", async () => {
    const h = controller(new DraftStore(await storage()));
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        consent: { type: "boolean" },
        color: { type: "string", enum: ["red", "blue"] },
        token: { type: "string", writeOnly: true },
        choices: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      },
    };
    const q = h.drafts.register(h.conv, {
      ...request,
      elicitation: true,
      requestedSchema: schema,
    });
    const first = ui();
    first.emit(q);
    const controls = first.card(q).querySelectorAll("input,select");
    expect(controls).toHaveLength(6);
    controls[0].value = "unfinished";
    controls[1].checked = true;
    controls[2].value = "blue";
    controls[3].value = "secret-token";
    controls[5].checked = true;
    controls[0].dispatchEvent(new first.window.Event("input"));
    const update = first.sent.find((m) => m.type === "questionDraftUpdate");
    await h.drafts.save(update);
    expect(JSON.stringify(first.state())).not.toContain("secret-token");
    expect(
      JSON.stringify(await h.drafts.store.view(h.conv.draftKey)),
    ).not.toContain("secret-token");
    const next = ui();
    next.emit(q);
    await h.drafts.restore(q);
    next.emit(h.messages.at(-1));
    const restored = next.card(q).querySelectorAll("input,select");
    expect(restored[0].value).toBe("unfinished");
    expect(restored[1].checked).toBe(true);
    expect(restored[2].value).toBe("blue");
    expect(restored[3].value).toBe("");
    expect(restored[5].checked).toBe(true);
    expect(next.sent.some((m) => m.type === "answer")).toBe(false);
  });

  it("restores the last keystroke backup and never overwrites a newer edit", async () => {
    const h = controller(new DraftStore(await storage()));
    const q = h.drafts.register(h.conv, request);
    const first = ui();
    first.emit(q);
    first.card(q).querySelector("input").value = "last keystroke";
    first
      .card(q)
      .querySelector("input")
      .dispatchEvent(new first.window.Event("input"));
    const next = ui(first.state());
    next.emit(q);
    expect(next.card(q).querySelector("input").value).toBe("last keystroke");
    next.emit({
      ...q,
      kind: "questionDraftSnapshot",
      state: "draft",
      fields: values,
    });
    expect(next.card(q).querySelector("input").value).toBe("last keystroke");
    expect(next.sent.some((m) => m.type === "answer")).toBe(false);
  });

  it("disables duplicate clicks and marks completion only on the host resolution", async () => {
    const h = controller(new DraftStore(await storage()));
    const q = h.drafts.register(h.conv, request);
    const view = ui();
    view.emit(q);
    const card = view.card(q);
    const send = [...card.querySelectorAll("button")].find(
      (b) => b.textContent === "Send",
    );
    send.click();
    send.click();
    expect(view.sent.filter((m) => m.type === "answer")).toHaveLength(1);
    expect(card.classList.contains("done")).toBe(false);
    await h.drafts.answer(view.sent.find((m) => m.type === "answer"));
    view.emit(h.messages.at(-1));
    expect(card.textContent).toContain("waiting for agent confirmation");
    h.drafts.archiveConversation(h.conv, {
      id: q.id,
      reason: "Answered — confirmed by agent",
    });
    view.emit(h.messages.at(-1));
    expect(card.classList.contains("done")).toBe(true);
  });

  it("excludes unsupported JSON fallback values and rejects oversized draft structures", () => {
    const descriptors = questionFields({
      requestedSchema: {
        type: "object",
        properties: { pwd: { type: "string", format: "password" } },
      },
    });
    expect(
      normalizeQuestionFields(descriptors, [
        { key: "answer-json", value: "secret" },
      ]),
    ).toEqual([]);
    expect(() =>
      normalizeQuestionFields(questionFields(request), [
        { key: "answer", value: "x".repeat(32769) },
      ]),
    ).toThrow("32K");
    expect(() =>
      questionIdentity("s", { ...request, options: Array(10000).fill("x") }),
    ).toThrow("too many");
    expect(questionIdentity("s", { ...request, binding: { b: 2, a: 1 } })).toBe(
      questionIdentity("s", { ...request, binding: { a: 1, b: 2 } }),
    );
  });
});

describe("ChatView question owner routing", () => {
  async function host() {
    const messages = [];
    const provider = new ChatViewProvider(
      {
        workspace: {
          workspaceFolders: [],
          getConfiguration: () => ({ get() {} }),
        },
        commands: { executeCommand() {} },
        window: {},
        env: { openExternal: vi.fn() },
        Uri: { parse: (s) => s },
      },
      {
        storagePath: await storage(),
        deps: {
          resolveChatLlm: () => ({}),
          loadTranscriptPage: async () => ({ messages: [] }),
        },
      },
    );
    cleanups.push(async () => {
      provider.dispose();
      let queue;
      do {
        queue = provider._draftStore.queue;
        await queue;
      } while (queue !== provider._draftStore.queue);
    });
    provider.view = {
      webview: {
        postMessage: (m) => {
          messages.push(m);
          return Promise.resolve(true);
        },
      },
    };
    const a = provider._activeConv();
    a.sessionId = "session-1";
    a._sessionToken = {};
    a.session = { running: true, sendEvent: vi.fn(() => true), stop() {} };
    provider._makeOnEvent(
      a.id,
      a._sessionToken,
    )({
      type: "question_request",
      id: "url",
      question: "Authorize",
      binding,
      metadata: {
        kind: "mcp_elicitation",
        mode: "url",
        url: "https://example.test/",
      },
    });
    return {
      provider,
      a,
      q: messages.find((m) => m.kind === "question"),
      messages,
    };
  }

  it("keeps a rejected response unresolved and exposes archived text without sending it", async () => {
    const h = await host();
    await h.provider._handleMessage(
      payload(h.q, { type: "answer", fields: [], answer: null }),
    );
    h.provider._makeOnEvent(
      h.a.id,
      h.a._sessionToken,
    )({
      type: "question_response_rejected",
      id: h.q.id,
      reason: "persistence_failed",
    });
    expect(
      h.messages.filter((m) => m.kind === "questionState").at(-1),
    ).toMatchObject({ state: "unknown" });
    const saved = (await h.provider._draftStore.view(h.a.draftKey))
      .questions[0];
    const before = h.a.session.sendEvent.mock.calls.length;
    await h.provider._handleMessage({
      type: "questionDraftCopy",
      convId: h.a.id,
      draftKey: h.a.draftKey,
      questionId: saved.id,
    });
    expect(h.messages.at(-1)).toMatchObject({
      kind: "draftCopy",
      composer: { text: "", images: [] },
    });
    expect(h.a.session.sendEvent.mock.calls.length).toBe(before);
  });

  it("routes an asynchronous URL answer to its original session after tab switching", async () => {
    const h = await host();
    let finish;
    h.provider.vscode.env.openExternal.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const sending = h.provider._handleMessage(
      payload(h.q, {
        type: "openElicitationUrl",
        fields: [],
        url: "https://attacker.test/",
      }),
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(h.provider.vscode.env.openExternal).toHaveBeenCalledWith(
      "https://example.test/",
    );
    h.provider._openNewTab();
    const b = h.provider._activeConv();
    b.session = { running: true, sendEvent: vi.fn(), stop() {} };
    finish(true);
    await sending;
    expect(b.session.sendEvent).not.toHaveBeenCalled();
    expect(h.a.session.sendEvent).toHaveBeenCalledWith({
      type: "answer",
      id: "url",
      answer: {},
      binding,
    });
  });

  it("ignores callbacks after the owning session is stopped and replacement requests appear", async () => {
    const h = await host();
    let finish;
    const old = h.a.session;
    h.provider.vscode.env.openExternal.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const sending = h.provider._handleMessage(
      payload(h.q, { type: "openElicitationUrl", fields: [] }),
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    h.provider._stopSession(h.a);
    const replacement = { running: true, sendEvent: vi.fn(), stop() {} };
    h.a.session = replacement;
    finish(true);
    await sending;
    expect(old.sendEvent).not.toHaveBeenCalled();
    expect(replacement.sendEvent).not.toHaveBeenCalled();
    await h.provider._handleMessage(
      payload(h.q, { type: "answer", answer: "stale" }),
    );
    expect(replacement.sendEvent).not.toHaveBeenCalled();
  });
});

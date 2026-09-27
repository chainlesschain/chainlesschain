import { afterAll, describe, expect, it, vi } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";

const root = mkdtempSync(join(tmpdir(), "cc-history-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const store = await import("../../src/harness/jsonl-session-store.js");
const {
  readSessionTranscriptHistory,
  createSessionTranscriptHistoryProjection,
  createSessionTranscriptBranchProjection,
} = await import("../../src/lib/session-transcript-history.js");
const { readSessionTranscriptPage } =
  await import("../../src/lib/session-transcript-page.js");
const { JsonlSessionContextPort } =
  await import("../../src/lib/context-memory-kernel/jsonl-session-context-port.js");
const { createSummaryContextItem } =
  await import("../../src/lib/context-memory-kernel/message-adapter.js");
const { HISTORY_PREFIX_SCHEMA } =
  await import("../../src/lib/session-history-origins.js");
const { registerSessionShowSubcommand } =
  await import("../../src/commands/session-show.js");
const { parseTranscriptPage } =
  await import("../../../vscode-extension/src/chat/transcript-cache.js");

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function compact(sessionId, operationId, options = {}) {
  const kernel = new ContextMemoryKernel({
    sessionPort: new JsonlSessionContextPort({ sessionId }),
  });
  const result = await kernel.compactContext({
    operationId,
    sessionId,
    modelWindowTokens: 150,
    reservedOutputTokens: 20,
    safetyMarginTokens: 10,
    recoveryReserveTokens: 10,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "test",
    modelProfile: "test",
    now: "2026-09-27T00:00:00.000Z",
    ...options,
  });
  expect(result.status).toBe("committed");
}
function start(id, count = 8) {
  store.startSession(id, { provider: "test", model: "test" });
  for (let i = 0; i < count; i++) {
    store.appendUserMessage(id, `question-${i}: ${"x".repeat(90)}`);
    store.appendAssistantMessage(id, `answer-${i}: ${"y".repeat(90)}`);
  }
}
function texts(page) {
  return page.messages.map((m) => m.text);
}
function rewriteCursor(cursor, patch) {
  return Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
      ...patch,
    }),
  ).toString("base64url");
}
function rewind(id, retainedMessageCount, patch = {}) {
  const messages = store.readVerifiedMessages(id);
  const head = store.findLatestEvent(id, null).hash;
  return store.withSessionAuthorityTransaction(id, head, (transaction) =>
    transaction.appendAuthorityEvent("checkpoint_timeline_commit", {
      action: "restore-conversation",
      messages: messages.slice(0, retainedMessageCount),
      historyPrefix: {
        schema: HISTORY_PREFIX_SCHEMA,
        sourceHead: transaction.currentHeadHash(),
        sourceMessageCount: messages.length,
        retainedMessageCount,
        ...patch,
      },
      binding: { turns: [] },
    }),
  );
}
function historyBranch(parentSessionId, branchSessionId, retainedMessageCount) {
  const messages = store
    .readVerifiedMessages(parentSessionId)
    .slice(0, retainedMessageCount);
  const head = store.findLatestEvent(parentSessionId, null).hash;
  return store.withSessionAuthorityTransaction(
    parentSessionId,
    head,
    (transaction) =>
      transaction.readProjection(() =>
        createSessionTranscriptBranchProjection(
          parentSessionId,
          messages,
          (history) =>
            store.createBranchSession({
              parentSessionId,
              branchSessionId,
              parentTurnId: "selected",
              messages,
              history,
            }),
        ),
      ),
  );
}

describe("canonical display history", () => {
  it("keeps interrupted archive copies unpublished, recovers the exact prefix and refuses rollback", () => {
    const parent = "history-crash-parent";
    const child = "history-crash-child";
    start(parent, 2);
    const metaPath = join(root, "home", "sessions", `${child}.meta.json`);
    process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
    store._sessionScaleFaultHooks.afterTranscriptAppend = ({
      sessionId,
      type,
    }) => {
      if (sessionId === child && type === "session_history_message")
        throw new Error("archive crash");
    };
    try {
      expect(() => historyBranch(parent, child, 2)).toThrow("archive crash");
      expect(existsSync(metaPath)).toBe(false);
      expect(() => readSessionTranscriptHistory(child)).toThrow();
      store._sessionScaleFaultHooks.afterTranscriptAppend = null;
      store._sessionScaleFaultHooks.beforeTranscriptAppend = ({
        sessionId,
        type,
      }) => {
        if (sessionId === child && type === "session_history_message")
          throw new Error("retry before append");
      };
      expect(() => historyBranch(parent, child, 2)).toThrow(
        "retry before append",
      );
      expect(existsSync(metaPath)).toBe(false);
      expect(() => store.readVerifiedMessages(child)).toThrow();
    } finally {
      store._sessionScaleFaultHooks.afterTranscriptAppend = null;
      store._sessionScaleFaultHooks.beforeTranscriptAppend = null;
      delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
    }
    expect(historyBranch(parent, child, 2).created).toBe(true);
    expect(texts(readSessionTranscriptHistory(child))).toEqual(
      texts(readSessionTranscriptHistory(parent)).slice(0, 2),
    );
    store.appendUserMessage(child, "later branch turn");
    const meta = readFileSync(metaPath, "utf8");
    const file = join(root, "home", "sessions", `${child}.jsonl`);
    const lines = readFileSync(file, "utf8").trimEnd().split(/\r?\n/u);
    writeFileSync(file, lines.slice(0, -1).join("\n") + "\n", "utf8");
    expect(() => historyBranch(parent, child, 2)).toThrow();
    expect(readFileSync(metaPath, "utf8")).toBe(meta);
  });

  it("does not publish a branch when its source changes during the copy", () => {
    const parent = "history-source-mutated";
    const child = "history-source-mutated-child";
    start(parent, 2);
    let injected = false;
    process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
    store._sessionScaleFaultHooks.afterTranscriptAppend = ({
      sessionId,
      type,
    }) => {
      if (
        sessionId === child &&
        type === "session_history_message" &&
        !injected
      ) {
        injected = true;
        appendFileSync(
          join(root, "home", "sessions", `${parent}.jsonl`),
          "{}\n",
        );
      }
    };
    try {
      expect(() => historyBranch(parent, child, 2)).toThrow();
      expect(injected).toBe(true);
      expect(
        existsSync(join(root, "home", "sessions", `${child}.meta.json`)),
      ).toBe(false);
      expect(() => store.readVerifiedMessages(child)).toThrow();
    } finally {
      store._sessionScaleFaultHooks.afterTranscriptAppend = null;
      delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
    }
  });

  it("preserves legacy branch idempotency and inherited snapshot coverage", () => {
    const id = "history-legacy-import";
    start(id, 2);
    const messages = store.readVerifiedMessages(id).slice(0, 2);
    store.createBranchSession({
      parentSessionId: id,
      branchSessionId: "legacy-child",
      parentTurnId: "selected",
      messages,
    });
    const before = store.readVerifiedEvents("legacy-child");
    expect(historyBranch(id, "legacy-child", 2).created).toBe(false);
    expect(store.readVerifiedEvents("legacy-child")).toEqual(before);
    expect(readSessionTranscriptHistory("legacy-child").coverage.reason).toBe(
      "branch-snapshot",
    );
    store.appendUserMessage("legacy-child", "new branch point");
    historyBranch("legacy-child", "legacy-grandchild", 2);
    expect(
      readSessionTranscriptHistory("legacy-grandchild").coverage.reason,
    ).toBe("branch-snapshot");
  });

  it("carries truncation through inheritance and keeps escaped text within a page", () => {
    const id = "history-large-import";
    store.startSession(id, {});
    store.appendUserMessage(id, "\u0001".repeat(210000));
    store.appendAssistantMessage(id, "answer");
    store.appendUserMessage(id, "branch point");
    const original = readSessionTranscriptHistory(id, { limit: 1 });
    historyBranch(id, "large-child", 2);
    const latest = readSessionTranscriptHistory("large-child", { limit: 1 });
    const older = readSessionTranscriptHistory("large-child", {
      limit: 1,
      cursor: latest.nextCursor,
    });
    expect(older.messages).toHaveLength(1);
    expect(older.messages[0].truncated).toBe(true);
    expect(older.messages[0].text.length).toBeGreaterThan(100000);
    expect(
      Buffer.byteLength(JSON.stringify(older.messages[0])),
    ).toBeLessThanOrEqual(1024 * 1024);
    parseTranscriptPage(JSON.stringify(older), "large-child");
    const fullInheritedText = (sessionId) =>
      store
        .readVerifiedEvents(sessionId)
        .filter(
          (event) =>
            event.type === "session_history_message" &&
            event.data.role === "user",
        )
        .map((event) => event.data.text)
        .join("");
    expect(fullInheritedText("large-child")).toBe("\u0001".repeat(210000));
    store.appendUserMessage("large-child", "next branch point");
    historyBranch("large-child", "large-grandchild", 2);
    expect(fullInheritedText("large-grandchild")).toBe("\u0001".repeat(210000));
    expect(() =>
      readSessionTranscriptHistory("large-child", {
        cursor: original.nextCursor,
      }),
    ).toThrow();
  });

  it("validates imported completion digests and context origins before returning a page", () => {
    const id = "history-import-contract";
    start(id, 2);
    historyBranch(id, "history-import-contract-child", 2);
    const events = store.readVerifiedEvents("history-import-contract-child");
    for (const change of [
      (copy) => {
        copy.find(
          (event) => event.type === "session_history_message",
        ).data.text = "changed";
      },
      (copy) => {
        copy.find(
          (event) => event.type === "session_history_origin",
        ).data.origin.last = 100;
      },
      (copy) => {
        copy.pop();
      },
      (copy) => {
        copy.find(
          (event) => event.type === "session_history_message",
        ).data.part = 1;
      },
      (copy) => {
        copy.push(copy.at(-1));
      },
    ]) {
      const copy = structuredClone(events);
      change(copy);
      const projection = createSessionTranscriptHistoryProjection(
        "history-import-contract-child",
      );
      expect(() => {
        copy.forEach((event) => projection.accept(event));
        projection.finish({
          headHash: copy.at(-1).hash,
          eventCount: copy.length,
        });
      }).toThrow("incomplete or inconsistent");
    }
  });

  it("preserves emoji at archive chunk boundaries", () => {
    const id = "history-emoji-chunks";
    store.startSession(id, {});
    const text = "a".repeat(128 * 1024 - 1) + "😀" + "b".repeat(128 * 1024);
    store.appendUserMessage(id, text);
    store.appendAssistantMessage(id, "answer");
    store.appendUserMessage(id, "branch point");
    historyBranch(id, "emoji-child", 2);
    const chunks = store
      .readVerifiedEvents("emoji-child")
      .filter(
        (event) =>
          event.type === "session_history_message" &&
          event.data.role === "user",
      );
    expect(chunks).toHaveLength(3);
    expect(chunks.map((event) => event.data.text).join("")).toBe(text);
    expect(chunks[1].data.text.startsWith("😀")).toBe(true);
    expect(
      readSessionTranscriptHistory("emoji-child").messages[0].truncated,
    ).toBe(true);
  });
  it("makes a compacted branch independent of its parent, without inheriting execution authority", async () => {
    const id = "history-import-parent";
    start(id, 6);
    store.appendUserMessage(id, "selected turn");
    store.appendAuthorityEvent(id, "permission_grant", {
      allow: "all",
      marker: "must-not-inherit",
    });
    const original = readSessionTranscriptHistory(id);
    await compact(id, "branch-parent-compact");
    const active = store.readVerifiedMessages(id);
    const parentEvents = store.readVerifiedEvents(id);
    const branchId = "history-import-child";
    expect(historyBranch(id, branchId, active.length - 1).created).toBe(true);
    expect(store.readVerifiedEvents(id)).toEqual(parentEvents);
    const branch = readSessionTranscriptHistory(branchId, { limit: 100 });
    expect(texts(branch)).toEqual(texts(original).slice(0, -1));
    expect(branch.coverage.kind).toBe("from-origin");
    expect(store.readVerifiedMessages(branchId)).toEqual(active.slice(0, -1));
    expect(
      store
        .readVerifiedEvents(branchId)
        .some((event) => event.type === "permission_grant"),
    ).toBe(false);
    expect(branch.messages[0].id).not.toBe(original.messages[0].id);
    expect(historyBranch(id, branchId, active.length - 1).created).toBe(false);
    store.appendUserMessage(branchId, "branch turn");
    store.appendAssistantMessage(branchId, "branch answer");
    expect(historyBranch(id, branchId, active.length - 1).created).toBe(false);
    store.deleteJsonlSession(id);
    const after = readSessionTranscriptHistory(branchId, { limit: 100 });
    expect(texts(after)).toEqual([
      ...texts(branch),
      "branch turn",
      "branch answer",
    ]);
    parseTranscriptPage(JSON.stringify(after), branchId);
    const fork = store.forkSession(branchId, {
      requestId: "history-import-full-fork",
    });
    expect(
      texts(
        readSessionTranscriptHistory(typeof fork === "string" ? fork : fork.id),
      ),
    ).toEqual(texts(after));
  });

  it("retains summary ancestry across nested branches and a later rewind", async () => {
    const id = "history-nested-parent";
    store.startSession(id, {});
    store.appendUserMessage(id, "old " + "x".repeat(2000));
    store.appendAssistantMessage(id, "answer " + "y".repeat(2000));
    store.appendUserMessage(id, "branch point");
    const original = readSessionTranscriptHistory(id);
    await compact(id, "nested-summary", {
      modelWindowTokens: 400,
      summarizer: async (parents, context) => ({
        items: [
          createSummaryContextItem({
            messages: [{ role: "assistant", content: "summary" }],
            parents,
            operationId: context.operationId,
            now: "2026-09-27T00:00:00.000Z",
          }),
        ],
        usageReceipt: { outcome: "settled", callId: "nested-summary" },
      }),
    });
    historyBranch(id, "nested-child", 1);
    expect(texts(readSessionTranscriptHistory("nested-child"))).toEqual(
      texts(original).slice(0, -1),
    );
    store.appendUserMessage("nested-child", "new question");
    store.appendAssistantMessage("nested-child", "new answer");
    await compact("nested-child", "nested-child-compact", {
      modelWindowTokens: 900,
    });
    historyBranch("nested-child", "nested-grandchild", 1);
    expect(texts(readSessionTranscriptHistory("nested-grandchild"))).toEqual(
      texts(original).slice(0, -1),
    );
    rewind("nested-child", 1);
    expect(texts(readSessionTranscriptHistory("nested-child"))).toEqual(
      texts(original).slice(0, -1),
    );
    expect(store.readVerifiedMessages("nested-grandchild")).toEqual([
      { role: "assistant", content: "summary" },
    ]);
  });

  it("expires source capabilities and prevents source writes inside a read projection", () => {
    const id = "history-capability";
    start(id, 2);
    const messages = store.readVerifiedMessages(id).slice(0, 2);
    let capability;
    let reader;
    const head = store.findLatestEvent(id, null).hash;
    store.withSessionAuthorityTransaction(id, head, (transaction) => {
      reader = transaction.readProjection;
      transaction.readProjection(() =>
        createSessionTranscriptBranchProjection(id, messages, (history) => {
          capability = history;
          expect(() => transaction.appendAuthorityEvent("invalid", {})).toThrow(
            "during",
          );
          expect(() => transaction.readProjection(() => ({}))).toThrow(
            "closed",
          );
        }),
      );
    });
    expect(capability).toBeTruthy();
    expect(() =>
      createSessionTranscriptBranchProjection(id, messages, async () => {}),
    ).toThrow("synchronous");
    expect(() => reader(() => ({}))).toThrow("closed");
    expect(() =>
      store.createBranchSession({
        branchSessionId: "expired-child",
        parentSessionId: id,
        messages,
        history: capability,
      }),
    ).toThrow("expired");
    expect(() =>
      store.createBranchSession({
        branchSessionId: "forged-child",
        parentSessionId: id,
        messages,
        history: {},
      }),
    ).toThrow("expired");
    expect(store.sessionExists("expired-child")).toBe(false);
  });
  it("accepts the shared real CLI history fixture used by the JetBrains reader", () => {
    const page = parseTranscriptPage(
      readFileSync(
        new URL(
          "../fixtures/session-transcript-history-page-v2.json",
          import.meta.url,
        ),
        "utf8",
      ),
      "fixture-history",
    );
    expect(page.messages.map((row) => row.text)).toEqual([
      "answer one",
      "question two",
    ]);
    expect(page.nextCursor).toBeTruthy();
  });
  it("shows original messages once when the Kernel replaces them with a derived summary", async () => {
    const id = "history-summary";
    store.startSession(id, { provider: "test", model: "test" });
    store.appendUserMessage(id, "old question " + "x".repeat(2000));
    store.appendAssistantMessage(id, "old answer " + "y".repeat(2000));
    store.appendUserMessage(id, "pending question");
    const original = readSessionTranscriptHistory(id);
    await compact(id, "with-summary", {
      modelWindowTokens: 400,
      summarizer: async (parents, context) => ({
        items: [
          createSummaryContextItem({
            messages: [{ role: "assistant", content: "derived summary" }],
            parents,
            operationId: context.operationId,
            now: "2026-09-27T00:00:00.000Z",
          }),
        ],
        usageReceipt: { outcome: "settled", callId: "test-summary" },
      }),
    });
    expect(
      store
        .readVerifiedMessages(id)
        .some((message) => message.content === "derived summary"),
    ).toBe(true);
    expect(readSessionTranscriptHistory(id).messages).toEqual(
      original.messages,
    );
  });

  it("keeps real Kernel compaction history, identities and old cursors through later appends", async () => {
    const id = "history-compact";
    start(id);
    const original = readSessionTranscriptHistory(id);
    const tail = readSessionTranscriptHistory(id, { limit: 5 });
    await compact(id, "compact-1");
    expect(store.readVerifiedMessages(id).length).toBeLessThan(
      original.totalMessages,
    );
    store.appendUserMessage(id, "after compact");
    store.appendAssistantMessage(id, "new final answer");
    await compact(id, "compact-2");
    const current = readSessionTranscriptHistory(id);
    expect(current.messages.slice(0, original.totalMessages)).toEqual(
      original.messages,
    );
    expect(texts(current).slice(-2)).toEqual([
      "after compact",
      "new final answer",
    ]);
    expect(current.coverage.kind).toBe("from-origin");
    const pages = [tail];
    let cursor = tail.nextCursor;
    while (cursor) {
      const page = readSessionTranscriptHistory(id, { limit: 5, cursor });
      parseTranscriptPage(JSON.stringify(page), id);
      pages.unshift(page);
      cursor = page.nextCursor;
    }
    expect(pages.flatMap((page) => page.messages)).toEqual(original.messages);
    // v1 callers still intentionally read only the model's current context.
    expect(readSessionTranscriptPage(id).totalMessages).toBeLessThan(
      current.totalMessages,
    );
    expect(() =>
      readSessionTranscriptHistory(id, {
        cursor: rewriteCursor(tail.nextCursor, { revision: "f".repeat(64) }),
      }),
    ).toThrow("history changed");
    expect(() =>
      readSessionTranscriptHistory(id, {
        cursor: rewriteCursor(tail.nextCursor, { before: 900 }),
      }),
    ).toThrow("history changed");
    expect(() =>
      readSessionTranscriptHistory(id, {
        cursor: rewriteCursor(tail.nextCursor, { eventCount: 900 }),
      }),
    ).toThrow("history changed");
  });

  it("invalidates cursors on rewind and never revives discarded text after another compaction", async () => {
    const id = "history-rewind";
    start(id);
    await compact(id, "before-rewind");
    const cursor = readSessionTranscriptHistory(id, { limit: 2 }).nextCursor;
    store.appendAuthorityEvent(id, "checkpoint_timeline_commit", {
      messages: [{ role: "user", content: "retained question" }],
      binding: { turns: [] },
    });
    store.appendAssistantMessage(id, "retained answer");
    await compact(id, "after-rewind");
    expect(() => readSessionTranscriptHistory(id, { cursor })).toThrow(
      "history changed",
    );
    const page = readSessionTranscriptHistory(id);
    expect(texts(page)).toEqual(["retained question", "retained answer"]);
    expect(page.coverage).toMatchObject({
      kind: "snapshot-boundary",
      reason: "timeline-replacement",
    });
  });

  it("reconstructs a prefix older than the page buffer and keeps exact original identities", () => {
    const id = "history-old-prefix";
    start(id, 80);
    const oldPage = readSessionTranscriptHistory(id, { limit: 10 });
    const events = store.readVerifiedEvents(id);
    const originalIds = events
      .filter((event) =>
        ["user_message", "assistant_message"].includes(event.type),
      )
      .slice(0, 6)
      .map((event) => `${id}:${event.hash}:0`);
    rewind(id, 6);
    expect(() =>
      readSessionTranscriptHistory(id, { cursor: oldPage.nextCursor }),
    ).toThrow("history changed");
    const latest = readSessionTranscriptHistory(id, { limit: 2 });
    const pages = [latest];
    let cursor = latest.nextCursor;
    store.appendUserMessage(id, "new path");
    store.appendAssistantMessage(id, "new answer");
    while (cursor) {
      const page = readSessionTranscriptHistory(id, { limit: 2, cursor });
      parseTranscriptPage(JSON.stringify(page), id);
      pages.unshift(page);
      cursor = page.nextCursor;
    }
    expect(pages.flatMap((page) => page.messages.map((row) => row.id))).toEqual(
      originalIds,
    );
    const current = readSessionTranscriptHistory(id);
    expect(current.totalMessages).toBe(8);
    expect(current.coverage.kind).toBe("from-origin");
    expect(texts(current).slice(-2)).toEqual(["new path", "new answer"]);
  });

  it("retains pre-summary ancestry, then cuts a second path without resurrecting the first", async () => {
    const id = "history-ancestry-summary";
    store.startSession(id, {});
    store.appendUserMessage(id, "old question " + "x".repeat(2000));
    store.appendAssistantMessage(id, "old answer " + "y".repeat(2000));
    store.appendUserMessage(id, "same question");
    const originals = readSessionTranscriptHistory(id).messages;
    await compact(id, "ancestry-summary", {
      modelWindowTokens: 400,
      summarizer: async (parents, context) => ({
        items: [
          createSummaryContextItem({
            messages: [{ role: "assistant", content: "derived summary" }],
            parents,
            operationId: context.operationId,
            now: "2026-09-27T00:00:00.000Z",
          }),
        ],
        usageReceipt: { outcome: "settled", callId: "ancestry-summary" },
      }),
    });
    const context = store.readVerifiedMessages(id);
    expect(context.map((message) => message.content)).toEqual([
      "derived summary",
      "same question",
    ]);
    rewind(id, 1);
    expect(readSessionTranscriptHistory(id).messages).toEqual(
      originals.slice(0, 2),
    );
    store.appendUserMessage(id, "same question");
    store.appendAssistantMessage(id, "discard this answer");
    await compact(id, "second-ancestry-compact", { modelWindowTokens: 900 });
    const next = store.readVerifiedMessages(id);
    const index = next.findIndex((message) => message.role === "user");
    expect(index).toBeGreaterThanOrEqual(0);
    rewind(id, index);
    const final = readSessionTranscriptHistory(id);
    expect(final.messages).toEqual(originals.slice(0, 2));
    expect(final.coverage.kind).toBe("from-origin");
    // A full-copy fork reads the same verified ancestry in its own namespace.
    const fork = store.forkSession(id, { requestId: "rewound-fork" });
    const forkId = typeof fork === "string" ? fork : fork.id;
    expect(texts(readSessionTranscriptHistory(forkId))).toEqual(texts(final));
    expect(readSessionTranscriptHistory(forkId).messages[0].id).toMatch(
      new RegExp(`^${forkId}:`),
    );
  });

  it("uses indexed provenance to distinguish identical messages across compaction", async () => {
    const id = "history-equal-text";
    store.startSession(id, {});
    for (let i = 0; i < 6; i++) {
      store.appendUserMessage(id, "identical " + "x".repeat(90));
      store.appendAssistantMessage(id, "identical " + "y".repeat(90));
    }
    store.appendUserMessage(id, "identical " + "x".repeat(90));
    const original = readSessionTranscriptHistory(id);
    await compact(id, "equal-text-compact");
    const messages = store.readVerifiedMessages(id);
    expect(messages.length).toBeLessThan(original.totalMessages);
    rewind(id, messages.length - 1);
    const page = readSessionTranscriptHistory(id);
    expect(page.messages).toEqual(original.messages.slice(0, -1));
    expect(new Set(page.messages.map((row) => row.id)).size).toBe(12);
  });

  it.each([
    { sourceHead: "f".repeat(64) },
    { sourceMessageCount: 999 },
    { retainedMessageCount: -1 },
    { retainedMessageCount: 999 },
    { schema: "unknown" },
  ])(
    "uses only the replacement snapshot for an invalid prefix %j",
    async (patch) => {
      const id = `history-bad-prefix-${Object.keys(patch)[0]}-${String(Object.values(patch)[0]).slice(0, 4)}`;
      start(id);
      await compact(id, `${id}-compact`);
      store.appendUserMessage(id, "discarded");
      const messages = store.readVerifiedMessages(id);
      const retained = messages.length - 1;
      rewind(id, retained, patch);
      const page = readSessionTranscriptHistory(id);
      expect(page.totalMessages).toBe(retained);
      expect(page.coverage.reason).toBe("timeline-replacement");
    },
  );

  it("keeps snapshot coverage across a later verified rewind", () => {
    const id = "history-snapshot-then-rewind";
    start(id);
    store.appendCompactEvent(id, {
      messages: [
        { role: "user", content: "snapshot user" },
        { role: "assistant", content: "snapshot answer" },
      ],
    });
    const snapshot = readSessionTranscriptHistory(id);
    store.appendUserMessage(id, "removed path");
    rewind(id, 2);
    const page = readSessionTranscriptHistory(id);
    expect(page.messages).toEqual(snapshot.messages);
    expect(page.coverage).toEqual(snapshot.coverage);
  });

  it("revokes the rescan lease and rejects file changes during replay", () => {
    const id = "history-replay-lease";
    start(id, 1);
    let replay;
    const hashes = store.readVerifiedProjection(id, () => ({
      accept() {},
      finish(authority) {
        replay = authority.replayEvents;
        const hashes = [];
        replay((event) => {
          hashes.push(event.hash);
        });
        expect(() => replay(async () => {})).toThrow("synchronous");
        expect(() => replay(() => Promise.resolve())).toThrow("synchronous");
        return hashes;
      },
    }));
    expect(hashes).toEqual(
      store.readVerifiedEvents(id).map((event) => event.hash),
    );
    expect(() => replay(() => {})).toThrow("closed");
    expect(() =>
      store.readVerifiedProjection(id, () => ({
        accept() {},
        finish(authority) {
          let changed = false;
          authority.replayEvents(() => {
            if (changed) return;
            changed = true;
            appendFileSync(
              join(root, "home", "sessions", `${id}.jsonl`),
              "{}\n",
            );
          });
        },
      })),
    ).toThrow();
  });

  it("isolates full-copy forks and reports snapshot branches without borrowing parent content", async () => {
    const id = "history-parent";
    start(id);
    await compact(id, "parent-compact");
    const parent = readSessionTranscriptHistory(id);
    const fork = store.forkSession(id, { requestId: "history-fork" });
    const forkId = typeof fork === "string" ? fork : fork.id;
    store.appendUserMessage(forkId, "fork only");
    const child = readSessionTranscriptHistory(forkId);
    expect(texts(child).slice(0, -1)).toEqual(texts(parent));
    expect(child.messages[0].id).not.toBe(parent.messages[0].id);
    expect(texts(readSessionTranscriptHistory(id))).toEqual(texts(parent));
    expect(() =>
      readSessionTranscriptHistory(forkId, {
        cursor: readSessionTranscriptHistory(id, { limit: 1 }).nextCursor,
      }),
    ).toThrow("invalid transcript history cursor");
    store.createBranchSession({
      branchSessionId: "history-branch",
      parentSessionId: id,
      messages: [{ role: "user", content: "branch snapshot" }],
    });
    const branch = readSessionTranscriptHistory("history-branch");
    expect(texts(branch)).toEqual(["branch snapshot"]);
    expect(branch.coverage.reason).toBe("branch-snapshot");
  });

  it.each(["physical-store-import", "session-end", "unknown"])(
    "treats %s snapshots as replacement boundaries",
    (reason) => {
      const id = `history-${reason}`;
      start(id, 1);
      store.appendCompactEvent(id, {
        reason,
        messages: [{ role: "assistant", content: "saved snapshot" }],
      });
      const page = readSessionTranscriptHistory(id);
      expect(texts(page)).toEqual(["saved snapshot"]);
      expect(page.coverage.reason).toBe("context-snapshot");
    },
  );

  it("falls back to the explicit snapshot when a canonical payload is inconsistent", async () => {
    const id = "history-invalid-compact";
    start(id);
    await compact(id, "valid-compact");
    const valid = store.readVerifiedEvents(id).at(-1).data;
    store.appendCompactEvent(id, {
      ...valid,
      messages: [{ role: "user", content: "replacement" }],
    });
    expect(texts(readSessionTranscriptHistory(id))).toEqual(["replacement"]);
    store.appendCompactEvent(id, {
      ...valid,
      canonical: { ...valid.canonical, digest: "invalid" },
    });
    expect(readSessionTranscriptHistory(id).coverage.reason).toBe(
      "context-snapshot",
    );
  });

  it("reads through the command without modifying authority and rejects a forged tail", async () => {
    const id = "history-command";
    start(id, 2);
    const before = store.readVerifiedEvents(id);
    const program = new Command();
    registerSessionShowSubcommand(program.command("session"), program);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync(
        [
          "session",
          "show",
          "--json",
          "--history",
          "--page-size",
          "2",
          "--",
          id,
        ],
        { from: "user" },
      );
      const page = parseTranscriptPage(output.mock.calls.at(-1)[0], id);
      expect(page.messages).toHaveLength(2);
      expect(store.readVerifiedEvents(id)).toEqual(before);
    } finally {
      output.mockRestore();
    }
    appendFileSync(
      join(root, "home", "sessions", `${id}.jsonl`),
      '{"type":"assistant_message","data":{"role":"assistant","content":"forged"}}\n',
    );
    expect(() => readSessionTranscriptHistory(id)).toThrow();
  });

  it("bounds retained bytes and traverses oversized rows without dropping page identities", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      type: "assistant_message",
      hash: (i + 1).toString(16).padStart(64, "0"),
      data: { role: "assistant", content: "中".repeat(210000) },
    }));
    let cursor = null;
    const rows = [];
    do {
      const projection = createSessionTranscriptHistoryProjection("large", {
        limit: 100,
        cursor,
      });
      events.forEach((event) => projection.accept(event));
      const page = projection.finish({
        headHash: events.at(-1).hash,
        eventCount: events.length,
      });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(
        1024 * 1024 + 4096,
      );
      expect(
        page.messages.every((m) => m.truncated && m.text.length === 200000),
      ).toBe(true);
      rows.unshift(...page.messages);
      cursor = page.nextCursor;
    } while (cursor);
    expect(rows.map((row) => row.ordinal)).toEqual(
      events.map((_, index) => index),
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(events.length);
  });
});

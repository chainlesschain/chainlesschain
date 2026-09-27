import { afterAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
} = await import("../../src/lib/session-transcript-history.js");
const { readSessionTranscriptPage } =
  await import("../../src/lib/session-transcript-page.js");
const { JsonlSessionContextPort } =
  await import("../../src/lib/context-memory-kernel/jsonl-session-context-port.js");
const { createSummaryContextItem } =
  await import("../../src/lib/context-memory-kernel/message-adapter.js");
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

describe("canonical display history", () => {
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

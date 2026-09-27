import { afterAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";

const root = mkdtempSync(join(tmpdir(), "cc-history-changes-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const store = await import("../../src/harness/jsonl-session-store.js");
const { readSessionTranscriptHistory } =
  await import("../../src/lib/session-transcript-history.js");
const { JsonlSessionContextPort } =
  await import("../../src/lib/context-memory-kernel/jsonl-session-context-port.js");
const { HISTORY_SUMMARY_SCHEMA, projectCheckpointSummary } =
  await import("../../src/lib/checkpoint-summary-projection.js");
const { HISTORY_PREFIX_SCHEMA } =
  await import("../../src/lib/session-history-origins.js");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function start(id, turns = 2) {
  store.startSession(id, {});
  for (let index = 0; index < turns; index++) {
    store.appendUserMessage(id, "same user " + "x".repeat(100));
    store.appendAssistantMessage(id, "same answer " + "y".repeat(100));
  }
  return readSessionTranscriptHistory(id, { limit: 2 });
}
const decode = (cursor) =>
  JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
const patchCursor = (cursor, patch) =>
  Buffer.from(JSON.stringify({ ...decode(cursor), ...patch })).toString(
    "base64url",
  );
function rewind(id, retainedMessageCount) {
  const messages = store.readVerifiedMessages(id);
  const head = store.findLatestEvent(id, null).hash;
  store.withSessionAuthorityTransaction(id, head, (transaction) =>
    transaction.appendAuthorityEvent("checkpoint_timeline_commit", {
      action: "restore-conversation",
      messages: messages.slice(0, retainedMessageCount),
      historyPrefix: {
        schema: HISTORY_PREFIX_SCHEMA,
        sourceHead: transaction.currentHeadHash(),
        sourceMessageCount: messages.length,
        retainedMessageCount,
      },
      binding: { turns: [] },
    }),
  );
}

describe("verified display-history changes", () => {
  it("pages the first contiguous new prefix, tolerates appends between batches and is idempotent", () => {
    const id = "changes-prefix";
    const baseline = start(id);
    expect(
      readSessionTranscriptHistory(id, { cursor: baseline.nextCursor })
        .syncCursor,
    ).toBeNull();
    const unchanged = readSessionTranscriptHistory(id, {
      after: baseline.syncCursor,
    });
    expect(unchanged).toMatchObject({
      schema: "chainlesschain.session-transcript-changes/v1",
      from: 4,
      messages: [],
      hasMore: false,
    });
    expect(unchanged.nextCursor).toBe(baseline.syncCursor);
    store.appendUserMessage(id, "same user");
    store.appendAssistantMessage(id, "same answer");
    const first = readSessionTranscriptHistory(id, {
      after: baseline.syncCursor,
      limit: 1,
    });
    expect(first.messages.map((row) => row.ordinal)).toEqual([4]);
    expect(first.hasMore).toBe(true);
    store.appendUserMessage(id, "same user");
    store.appendAssistantMessage(id, "same answer");
    const second = readSessionTranscriptHistory(id, {
      after: first.nextCursor,
    });
    expect(second.from).toBe(5);
    expect(second.messages.map((row) => row.ordinal)).toEqual([5, 6, 7]);
    expect(second.hasMore).toBe(false);
    expect(
      readSessionTranscriptHistory(id, { after: first.nextCursor }),
    ).toEqual(second);
    const allNew = [...first.messages, ...second.messages];
    expect(new Set(allNew.map((row) => row.id)).size).toBe(4);
    expect(allNew).toEqual(readSessionTranscriptHistory(id).messages.slice(4));
    expect(
      readSessionTranscriptHistory(id, { after: second.nextCursor }).messages,
    ).toEqual([]);
  });

  it("advances the verified revision for metadata-only changes in an empty display history", () => {
    const id = "changes-empty";
    const baseline = start(id, 0);
    store.appendEvent(id, "token_usage", { input_tokens: 1 });
    const page = readSessionTranscriptHistory(id, {
      after: baseline.syncCursor,
    });
    expect(page).toMatchObject({
      from: 0,
      totalMessages: 0,
      messages: [],
      hasMore: false,
    });
    expect(page.revision).not.toBe(baseline.revision);
    expect(page.nextCursor).not.toBe(baseline.syncCursor);
    expect(decode(page.nextCursor)).toMatchObject({
      revision: page.revision,
      eventCount: page.eventCount,
      offset: 0,
    });
  });

  it("keeps update cursors across real Kernel compaction and verified timeline summaries", async () => {
    const id = "changes-summary";
    const baseline = start(id, 6);
    store.appendUserMessage(id, "selected new input");
    const kernel = new ContextMemoryKernel({
      sessionPort: new JsonlSessionContextPort({ sessionId: id }),
    });
    const result = await kernel.compactContext({
      operationId: "changes-compact",
      sessionId: id,
      modelWindowTokens: 200,
      reservedOutputTokens: 20,
      safetyMarginTokens: 10,
      recoveryReserveTokens: 10,
      sink: "provider.local",
      scopeAdmissions: [{ scope: "session", scopeId: id }],
      policyVersion: "test",
      modelProfile: "test",
      now: "2026-09-27T00:00:00.000Z",
    });
    expect(result.status).toBe("committed");
    const messages = store.readVerifiedMessages(id);
    expect(messages.length).toBeLessThan(13);
    const startIndex = messages.length - 1;
    const head = store.findLatestEvent(id, null).hash;
    store.withSessionAuthorityTransaction(id, head, (transaction) =>
      transaction.appendAuthorityEvent("checkpoint_timeline_commit", {
        action: "summary-from",
        turnId: "selected",
        messages: projectCheckpointSummary({
          messages,
          action: "summary-from",
          turnId: "selected",
          start: startIndex,
          end: messages.length,
        }).map(({ message }) => message),
        historySummary: {
          schema: HISTORY_SUMMARY_SCHEMA,
          sourceHead: transaction.currentHeadHash(),
          sourceMessageCount: messages.length,
          start: startIndex,
          end: messages.length,
        },
        binding: { turns: [] },
      }),
    );
    const page = readSessionTranscriptHistory(id, {
      after: baseline.syncCursor,
    });
    expect(page.generation).toBe(baseline.generation);
    expect(page.messages.map((row) => row.text)).toEqual([
      "selected new input",
    ]);
    expect(page.messages[0].ordinal).toBe(12);
  });

  it("rejects a rewind even if its replacement has the same text and final count", () => {
    const id = "changes-rewind";
    const baseline = start(id);
    rewind(id, 2);
    store.appendUserMessage(id, "same user " + "x".repeat(100));
    store.appendAssistantMessage(id, "same answer " + "y".repeat(100));
    expect(readSessionTranscriptHistory(id).totalMessages).toBe(
      baseline.totalMessages,
    );
    expect(() =>
      readSessionTranscriptHistory(id, { after: baseline.syncCursor }),
    ).toThrowError(
      expect.objectContaining({ code: "SESSION_TRANSCRIPT_CURSOR_STALE" }),
    );
    // The next baseline has a rewind earlier in its physical chain. Its rescan
    // must still yield the first new row, never a discarded ancestor.
    const next = readSessionTranscriptHistory(id);
    store.appendUserMessage(id, "new path");
    const changes = readSessionTranscriptHistory(id, {
      after: next.syncCursor,
    });
    expect(changes.messages.map((row) => row.text)).toEqual(["new path"]);
    expect(changes.coverage.kind).toBe("from-origin");
  });

  it("retains snapshot coverage and resets page byte state before a new baseline", () => {
    const id = "changes-snapshot";
    const old = start(id, 3);
    store.appendCompactEvent(id, {
      messages: [{ role: "user", content: "imported" }],
    });
    const baseline = readSessionTranscriptHistory(id);
    store.appendAssistantMessage(id, "new answer");
    const page = readSessionTranscriptHistory(id, {
      after: baseline.syncCursor,
      limit: 1,
    });
    expect(page.messages.map((row) => row.text)).toEqual(["new answer"]);
    expect(page.coverage).toEqual(baseline.coverage);
    expect(() =>
      readSessionTranscriptHistory(id, { after: old.syncCursor }),
    ).toThrow("changed");
  });

  it("never skips a row when the first incremental batch reaches its byte budget", () => {
    const id = "changes-byte-budget";
    const baseline = start(id, 0);
    store.appendUserMessage(id, "\u0001".repeat(210000));
    store.appendAssistantMessage(id, "中".repeat(210000));
    store.appendUserMessage(id, "small last row");
    const first = readSessionTranscriptHistory(id, {
      after: baseline.syncCursor,
    });
    expect(first.messages.map((row) => row.ordinal)).toEqual([0]);
    expect(first.messages[0].truncated).toBe(true);
    expect(first.hasMore).toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(first.messages[0])),
    ).toBeLessThanOrEqual(1024 * 1024);
    const second = readSessionTranscriptHistory(id, {
      after: first.nextCursor,
    });
    expect(second.messages.map((row) => row.ordinal)).toEqual([1, 2]);
    expect(second.hasMore).toBe(false);
    expect(decode(second.nextCursor).offset).toBe(3);
  });

  it("rejects cross-session/fork, wrong-view, invalid revision and out-of-range cursors", () => {
    const id = "changes-cursor";
    const page = start(id);
    for (const patch of [
      { sessionId: "other" },
      { view: "context" },
      { v: 2 },
      { generation: "f".repeat(64) },
      { revision: "f".repeat(64) },
      { eventCount: page.eventCount + 1 },
      { offset: page.totalMessages + 1 },
      { offset: -1 },
      { offset: 0.5 },
    ])
      expect(() =>
        readSessionTranscriptHistory(id, {
          after: patchCursor(page.syncCursor, patch),
        }),
      ).toThrow();
    expect(() =>
      readSessionTranscriptHistory(id, { after: page.nextCursor }),
    ).toThrow();
    expect(() =>
      readSessionTranscriptHistory(id, { cursor: page.syncCursor }),
    ).toThrow();
    expect(() =>
      readSessionTranscriptHistory(id, {
        after: page.syncCursor,
        cursor: page.nextCursor,
      }),
    ).toThrow("mutually exclusive");
    const fork = store.forkSession(id, { requestId: "changes-fork" });
    const forkId = typeof fork === "string" ? fork : fork.id;
    expect(() =>
      readSessionTranscriptHistory(forkId, { after: page.syncCursor }),
    ).toThrow();
  });

  it("validates the full tail even when an incremental page is already full", () => {
    const id = "changes-tamper";
    const baseline = start(id, 0);
    store.appendUserMessage(id, "one");
    store.appendAssistantMessage(id, "two");
    appendFileSync(join(root, "home", "sessions", `${id}.jsonl`), "{}\n");
    expect(() =>
      readSessionTranscriptHistory(id, {
        after: baseline.syncCursor,
        limit: 1,
      }),
    ).toThrow();
  });

  it("uses the actual CLI process for read-only updates and rejects mixed command modes", () => {
    const id = "changes-cli-process";
    const baseline = start(id, 0);
    store.appendUserMessage(id, "new CLI input");
    store.appendAssistantMessage(id, "new CLI answer");
    const transcript = join(root, "home", "sessions", `${id}.jsonl`);
    const before = readFileSync(transcript);
    const run = (options) =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../bin/chainlesschain.js", import.meta.url),
          ),
          "session",
          "show",
          ...options,
          "--",
          id,
        ],
        {
          env: {
            ...process.env,
            CHAINLESSCHAIN_HOME: join(root, "home"),
            CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(root, "security"),
          },
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          stdio: "pipe",
        },
      );
    const page = JSON.parse(
      run([
        "--json",
        "--history",
        "--after",
        baseline.syncCursor,
        "--page-size",
        "1",
      ]),
    );
    expect(page.messages.map((row) => row.text)).toEqual(["new CLI input"]);
    expect(page.hasMore).toBe(true);
    expect(readFileSync(transcript)).toEqual(before);
    for (const options of [
      ["--json", "--after", baseline.syncCursor],
      ["--history", "--after", baseline.syncCursor],
      [
        "--json",
        "--history",
        "--after",
        baseline.syncCursor,
        "--before",
        baseline.syncCursor,
      ],
      [
        "--json",
        "--history",
        "--after",
        baseline.syncCursor,
        "--input-receipt",
        "input-1",
      ],
    ])
      expect(() => run(options)).toThrow();
    expect(readFileSync(transcript)).toEqual(before);
    rewind(id, 0);
    try {
      run(["--json", "--history", "--after", baseline.syncCursor]);
      throw new Error("Expected a stale-cursor failure");
    } catch (error) {
      expect(error.status).toBe(1);
      expect(JSON.parse(error.stdout)).toMatchObject({
        schema: "chainlesschain.session-transcript-changes-error/v1",
        sessionId: id,
        code: "SESSION_TRANSCRIPT_CURSOR_STALE",
      });
    }
    const validCursor = readSessionTranscriptHistory(id).syncCursor;
    appendFileSync(transcript, "{}\n");
    try {
      run(["--json", "--history", "--after", validCursor]);
      throw new Error("Expected an integrity failure");
    } catch (error) {
      expect(error.status).toBe(1);
      const failure = JSON.parse(error.stdout);
      expect(failure.schema).toBe(
        "chainlesschain.session-transcript-changes-error/v1",
      );
      expect(failure.code).not.toBe("SESSION_TRANSCRIPT_CURSOR_STALE");
    }
  });
});

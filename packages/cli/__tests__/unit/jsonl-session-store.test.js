import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  readdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

// Set up temp directory for sessions
const testDir = join(tmpdir(), `cc-jsonl-test-${Date.now()}`);
const sessionsDir = join(testDir, "sessions");

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

const {
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendToolCall,
  appendToolResult,
  appendCompactEvent,
  appendCompactEventIfMessagesMatch,
  appendEvent,
  appendWsTurnIfHead,
  claimWsTurnIfHead,
  settleWsTurnClaim,
  appendAuthorityEvent,
  appendAuthorityEventIfHead,
  withSessionAuthorityTransaction,
  _sessionScaleFaultHooks,
  readEvents,
  readVerifiedEvents,
  readVerifiedWsTurnState,
  computeWsTurnInputDigest,
  createWsTurnClaimId,
  normalizeWsTurnRequestId,
  findLatestEvent,
  rebuildMessages,
  getJsonlSessionMetadata,
  listJsonlSessions,
  renameSession,
  deleteJsonlSession,
  resolveSessionId,
  pruneJsonlSessions,
  forkSession,
  createBranchSession,
  sessionExists,
  getLastSessionId,
  migrateLegacySessionFile,
  migrateLegacySessionsBatch,
  sampleMigratedSessionsValidation,
  validateJsonlSession,
  sessionPath,
  isUnsafeSessionId,
  toIsoSafe,
  verifySession,
  verifyAllSessions,
  repairSession,
} = await import("../../src/lib/jsonl-session-store.js");
const { computeEventHash } =
  await import("../../src/harness/transcript-integrity.js");
const { readVerifiedProjection } =
  await import("../../src/harness/jsonl-session-store.js");
const {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
  SESSION_FORK_AUTHORITY_FIELD,
  SESSION_MESSAGE_PROVENANCE_FIELD,
  SESSION_MESSAGE_PROVENANCE_SCHEMA,
} = await import("../../src/lib/session-message-provenance.js");

function readVerifiedMessages(sessionId) {
  return readVerifiedProjection(sessionId, () => ({
    accept() {},
    finish(authority) {
      return authority.readMessages();
    },
  }));
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForFileSync(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath) && Date.now() < deadline) sleepSync(10);
  if (!existsSync(filePath)) {
    throw new Error(`Timed out waiting for child marker: ${filePath}`);
  }
}

function waitForChild(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) =>
      resolvePromise({ code, signal, stderr }),
    );
  });
}

describe("jsonl-session-store", () => {
  beforeEach(() => {
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ── path-traversal safety ─────────────────────────────────────────
  describe("session id path-traversal safety", () => {
    it("flags separators / `..` / empty / non-string ids as unsafe", () => {
      for (const bad of [
        "../../etc/passwd",
        "a/b",
        "a\\b",
        "..",
        "x/..",
        "",
        null,
        undefined,
        123,
      ]) {
        expect(isUnsafeSessionId(bad)).toBe(true);
      }
      for (const ok of ["session-123-abc", "my_session.1", "abc"]) {
        expect(isUnsafeSessionId(ok)).toBe(false);
      }
    });

    it("sessionPath throws on a traversal id but builds a safe path otherwise", () => {
      expect(() => sessionPath("../../evil")).toThrow(/unsafe session id/);
      expect(sessionPath("good-1").endsWith("good-1.jsonl")).toBe(true);
    });

    it("reads/exists treat a traversal id as not-found (no escape, no throw)", () => {
      // A sibling file OUTSIDE the sessions dir that a crafted id could target.
      const victim = join(testDir, "victim.jsonl");
      writeFileSync(victim, JSON.stringify({ secret: 1 }) + "\n", "utf-8");
      try {
        const travId = "../victim"; // sessionPath would append .jsonl
        expect(readEvents(travId)).toEqual([]);
        expect(sessionExists(travId)).toBe(false);
        expect(validateJsonlSession(travId).reason).toBe("invalid session id");
        expect(existsSync(victim)).toBe(true); // never read/deleted
      } finally {
        rmSync(victim, { force: true });
      }
    });

    it("writes refuse a traversal id (nothing created outside the dir)", () => {
      const escaped = join(testDir, "pwned.jsonl");
      expect(() => appendEvent("../pwned", "x", {})).toThrow(
        /unsafe session id/,
      );
      expect(() => startSession("../pwned")).toThrow(/unsafe session id/);
      expect(existsSync(escaped)).toBe(false);
    });
  });

  // ── startSession ──────────────────────────────────────────────────

  describe("startSession", () => {
    it("creates a new session with auto-generated ID", () => {
      const id = startSession(null, { title: "Test Chat" });
      expect(id).toMatch(/^session-/);
      expect(sessionExists(id)).toBe(true);
    });

    it("uses provided session ID", () => {
      const id = startSession("my-session", { title: "Custom" });
      expect(id).toBe("my-session");
      expect(sessionExists("my-session")).toBe(true);
    });

    it("writes session_start event", () => {
      const id = startSession("s1", {
        title: "Chat",
        provider: "ollama",
        model: "qwen",
      });
      const events = readEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("session_start");
      expect(events[0].data.title).toBe("Chat");
      expect(events[0].data.provider).toBe("ollama");
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it("uses owner-only directory and transcript modes on POSIX", () => {
      if (process.platform === "win32") return;
      const id = startSession("private-session");
      expect(statSync(sessionsDir).mode & 0o777).toBe(0o700);
      expect(statSync(sessionPath(id)).mode & 0o777).toBe(0o600);
    });
  });

  // ── append operations ─────────────────────────────────────────────

  describe("append operations", () => {
    it("appends user message", () => {
      const id = startSession("s2");
      appendUserMessage(id, "Hello");
      const events = readEvents(id);
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("user_message");
      expect(events[1].data.content).toBe("Hello");
      expect(events[1].data.role).toBe("user");
    });

    it("appends assistant message", () => {
      const id = startSession("s3");
      appendAssistantMessage(id, "Hi there");
      const events = readEvents(id);
      expect(events[1].type).toBe("assistant_message");
      expect(events[1].data.content).toBe("Hi there");
    });

    it("appends tool call and result", () => {
      const id = startSession("s4");
      appendToolCall(id, "read_file", { path: "test.txt" });
      appendToolResult(id, "read_file", "file content");
      const events = readEvents(id);
      expect(events[1].type).toBe("tool_call");
      expect(events[1].data.tool).toBe("read_file");
      expect(events[2].type).toBe("tool_result");
    });

    it("appends compact event", () => {
      const id = startSession("s5");
      appendCompactEvent(id, { saved: 100, strategy: "truncate" });
      const events = readEvents(id);
      expect(events[1].type).toBe("compact");
      expect(events[1].data.saved).toBe(100);
    });
  });

  // ── readEvents ────────────────────────────────────────────────────

  describe("atomic WebSocket turns", () => {
    it("claims before execution and settles only the fenced owner", () => {
      const id = startSession("ws-claimed-success", { title: "Claimed" });
      const expectedHead = readEvents(id).at(-1).hash;
      const user = "claimed question";
      const inputDigest = computeWsTurnInputDigest(user);
      const opaqueClaimId = createWsTurnClaimId();

      const claimed = claimWsTurnIfHead(
        id,
        { requestId: "req-claimed-1", user, inputDigest, opaqueClaimId },
        expectedHead,
      );

      expect(claimed).toMatchObject({
        status: "pending",
        acquired: true,
        claim: { requestId: "req-claimed-1", inputDigest, opaqueClaimId },
        messages: [],
      });
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "ws_turn_claim",
      ]);
      const claimEvent = readEvents(id).at(-1);
      expect(Object.keys(claimEvent.data).sort()).toEqual([
        "inputDigest",
        "opaqueClaimId",
        "requestId",
        "schemaVersion",
      ]);
      expect(readFileSync(sessionPath(id), "utf8")).not.toContain(user);
      expect(getJsonlSessionMetadata(id)).toMatchObject({ message_count: 0 });

      const competingClaim = claimWsTurnIfHead(
        id,
        {
          requestId: "req-claimed-1",
          user,
          inputDigest,
          opaqueClaimId: createWsTurnClaimId(),
        },
        expectedHead,
      );
      expect(competingClaim).toMatchObject({
        status: "pending",
        acquired: false,
        deduplicated: true,
        claim: { opaqueClaimId },
      });
      expect(readEvents(id)).toHaveLength(2);

      expect(() =>
        settleWsTurnClaim(id, {
          requestId: "req-claimed-1",
          inputDigest,
          opaqueClaimId: createWsTurnClaimId(),
          outcome: "completed",
          user,
          assistant: "not owner",
        }),
      ).toThrow(
        expect.objectContaining({ code: "CC_WS_TURN_CLAIM_NOT_OWNER" }),
      );

      const settled = settleWsTurnClaim(id, {
        requestId: "req-claimed-1",
        inputDigest,
        opaqueClaimId,
        outcome: "completed",
        user,
        assistant: "claimed answer",
      });
      expect(settled).toMatchObject({
        status: "completed",
        deduplicated: false,
        turn: { assistant: { content: "claimed answer" } },
        messages: [
          { role: "user", content: user },
          { role: "assistant", content: "claimed answer" },
        ],
      });
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "ws_turn_claim",
        "ws_turn",
      ]);
      expect(
        readVerifiedWsTurnState(id, "req-claimed-1", { inputDigest }),
      ).toMatchObject({ status: "completed", turn: settled.turn });
      expect(getJsonlSessionMetadata(id)).toMatchObject({ message_count: 2 });
    });

    it("durably settles model failure without persisting failed input history", () => {
      const id = startSession("ws-claimed-failure");
      const user = "failed claimed input";
      const inputDigest = computeWsTurnInputDigest(user);
      const opaqueClaimId = createWsTurnClaimId();
      claimWsTurnIfHead(
        id,
        { requestId: "req-failed-1", user, inputDigest, opaqueClaimId },
        readEvents(id).at(-1).hash,
      );

      const failed = settleWsTurnClaim(id, {
        requestId: "req-failed-1",
        inputDigest,
        opaqueClaimId,
        outcome: "failed",
        failureCode: "CC_WS_TURN_FAILED",
      });

      expect(failed).toMatchObject({
        status: "failed",
        settlement: { failure: { code: "CC_WS_TURN_FAILED" } },
        messages: [],
      });
      expect(rebuildMessages(id)).toEqual([]);
      expect(readFileSync(sessionPath(id), "utf8")).not.toContain(user);
      expect(
        readVerifiedWsTurnState(id, "req-failed-1", { inputDigest }),
      ).toMatchObject({ status: "failed", turn: null });
      expect(validateJsonlSession(id)).toMatchObject({
        valid: true,
        eventCount: 3,
        messageCount: 0,
        invalidWsClaims: 0,
        invalidWsTurns: 0,
      });
    });

    it("rejects a forged same-request settlement injected after the claim", () => {
      const id = startSession("ws-claimed-forged-settlement");
      const user = "claimed input before tamper";
      const inputDigest = computeWsTurnInputDigest(user);
      const opaqueClaimId = createWsTurnClaimId();
      claimWsTurnIfHead(
        id,
        { requestId: "req-claim-tamper-1", user, inputDigest, opaqueClaimId },
        readEvents(id).at(-1).hash,
      );
      const forgedHash = "e".repeat(64);
      appendFileSync(
        sessionPath(id),
        `${JSON.stringify({
          type: "ws_turn",
          timestamp: Date.now(),
          data: {
            schemaVersion: 1,
            requestId: "req-claim-tamper-1",
            inputDigest,
            opaqueClaimId,
            outcome: "completed",
            user: { role: "user", content: user },
            assistant: { role: "assistant", content: "forged answer" },
          },
          prevHash: "0".repeat(64),
          hash: forgedHash,
        })}\n`,
        "utf8",
      );
      const metaFile = join(sessionsDir, `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      writeFileSync(
        metaFile,
        `${JSON.stringify({
          ...meta,
          event_count: meta.event_count + 1,
          last_hash: forgedHash,
        })}\n`,
        "utf8",
      );

      expect(() =>
        settleWsTurnClaim(id, {
          requestId: "req-claim-tamper-1",
          inputDigest,
          opaqueClaimId,
          outcome: "completed",
          user,
          assistant: "legitimate answer",
        }),
      ).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("commits one user/assistant pair and projects it through every store view", () => {
      const id = startSession("ws-atomic", { title: "Atomic" });
      const expectedHead = readEvents(id).at(-1).hash;

      const appended = appendWsTurnIfHead(
        id,
        {
          requestId: "req.atomic-1",
          user: "question",
          assistant: "answer",
        },
        expectedHead,
      );

      expect(appended).toMatchObject({
        requestId: "req.atomic-1",
        outcome: "completed",
        deduplicated: false,
        user: { role: "user", content: "question" },
        assistant: { role: "assistant", content: "answer" },
      });
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "ws_turn",
      ]);
      expect(rebuildMessages(id)).toEqual([
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ]);
      expect(readVerifiedWsTurnState(id, "req.atomic-1")).toMatchObject({
        headHash: appended.hash,
        eventCount: 2,
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: "answer" },
        ],
        turn: {
          requestId: "req.atomic-1",
          assistant: { content: "answer" },
        },
      });
      expect(getJsonlSessionMetadata(id)).toMatchObject({ message_count: 2 });
      expect(validateJsonlSession(id)).toMatchObject({
        valid: true,
        eventCount: 2,
        messageCount: 2,
        invalidWsTurns: 0,
      });
    });

    it("deduplicates a durable request before stale-head rejection", () => {
      const id = startSession("ws-idempotent");
      const initialHead = readEvents(id).at(-1).hash;
      const first = appendWsTurnIfHead(
        id,
        { requestId: "req-retry-1", user: "same", assistant: "original" },
        initialHead,
      );

      const retry = appendWsTurnIfHead(
        id,
        { requestId: "req-retry-1", user: "same", assistant: "replacement" },
        initialHead,
      );

      expect(retry).toMatchObject({
        hash: first.hash,
        deduplicated: true,
        assistant: { content: "original" },
      });
      expect(
        readEvents(id).filter((event) => event.type === "ws_turn"),
      ).toHaveLength(1);
      expect(() =>
        appendWsTurnIfHead(
          id,
          { requestId: "req-retry-1", user: "different", assistant: "x" },
          first.hash,
        ),
      ).toThrow(expect.objectContaining({ code: "CC_WS_REQUEST_ID_CONFLICT" }));
      expect(() =>
        appendWsTurnIfHead(
          id,
          { requestId: "req-new-2", user: "new", assistant: "new answer" },
          initialHead,
        ),
      ).toThrow(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
    });

    it("refuses to deduplicate a request whose sidecar anchor is stale", () => {
      const id = startSession("ws-idempotent-stale-anchor");
      const initialHead = readEvents(id).at(-1).hash;
      appendWsTurnIfHead(
        id,
        { requestId: "req-stale-1", user: "same", assistant: "original" },
        initialHead,
      );
      const metaFile = join(sessionsDir, `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      writeFileSync(
        metaFile,
        `${JSON.stringify({ ...meta, event_count: meta.event_count - 1 })}\n`,
        "utf8",
      );

      expect(() =>
        appendWsTurnIfHead(
          id,
          { requestId: "req-stale-1", user: "same", assistant: "retry" },
          initialHead,
        ),
      ).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("refuses a forged request settlement even when the sidecar names its head", () => {
      const id = startSession("ws-idempotent-forged-chain");
      const initialHead = readEvents(id).at(-1).hash;
      const forgedHash = "f".repeat(64);
      appendFileSync(
        sessionPath(id),
        `${JSON.stringify({
          type: "ws_turn",
          timestamp: Date.now(),
          data: {
            schemaVersion: 1,
            requestId: "req-forged-1",
            outcome: "completed",
            user: { role: "user", content: "same" },
            assistant: { role: "assistant", content: "forged" },
          },
          prevHash: "0".repeat(64),
          hash: forgedHash,
        })}\n`,
        "utf8",
      );
      const metaFile = join(sessionsDir, `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      writeFileSync(
        metaFile,
        `${JSON.stringify({
          ...meta,
          event_count: meta.event_count + 1,
          last_hash: forgedHash,
        })}\n`,
        "utf8",
      );

      expect(() =>
        appendWsTurnIfHead(
          id,
          { requestId: "req-forged-1", user: "same", assistant: "real" },
          initialHead,
        ),
      ).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("rejects missing, non-canonical, and oversized request ids", () => {
      expect(normalizeWsTurnRequestId("safe_1:@-.")).toBe("safe_1:@-.");
      for (const invalid of [
        undefined,
        "",
        "has space",
        "unicode-é",
        "line\nbreak",
        "x".repeat(129),
      ]) {
        expect(() => normalizeWsTurnRequestId(invalid)).toThrow(
          expect.objectContaining({
            code:
              invalid === undefined
                ? "CC_WS_REQUEST_ID_REQUIRED"
                : "CC_WS_REQUEST_ID_INVALID",
          }),
        );
      }
    });
  });

  describe("readEvents", () => {
    it("returns empty array for non-existent session", () => {
      expect(readEvents("nonexistent")).toEqual([]);
    });

    it("reads all events in order", () => {
      const id = startSession("s6");
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");
      appendUserMessage(id, "q2");
      appendAssistantMessage(id, "a2");
      const events = readEvents(id);
      expect(events).toHaveLength(5); // start + 4 messages
      expect(events.map((e) => e.type)).toEqual([
        "session_start",
        "user_message",
        "assistant_message",
        "user_message",
        "assistant_message",
      ]);
    });
  });

  describe("readVerifiedEvents", () => {
    it("returns fully chained events and rejects tampered authority history", () => {
      const id = startSession("verified-ledger", { title: "verified" });
      appendEvent(id, "mcp_call_ledger", { phase: "started" });

      expect(readVerifiedEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "mcp_call_ledger",
      ]);

      const file = sessionPath(id);
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          '"phase":"started"',
          '"phase":"settled"',
        ),
        "utf8",
      );
      expect(() => readVerifiedEvents(id)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("rejects a valid-looking chain whose anchored tail was removed", () => {
      const id = startSession("truncated-ledger", { title: "verified" });
      appendEvent(id, "mcp_call_ledger", { phase: "started" });
      const file = sessionPath(id);
      const lines = readFileSync(file, "utf8").trimEnd().split("\n");

      writeFileSync(file, `${lines[0]}\n`, "utf8");

      expect(verifySession(id).status).toBe("verified");
      expect(() => readVerifiedEvents(id)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("fails an authority append when the persisted anchor cannot catch up", () => {
      const id = startSession("stale-authority-anchor", { title: "verified" });
      appendEvent(id, "ordinary", { value: 1 });
      const metaFile = join(sessionsDir, `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      writeFileSync(
        metaFile,
        `${JSON.stringify({ ...meta, event_count: 0 })}\n`,
        "utf8",
      );

      expect(() =>
        appendAuthorityEvent(id, "mcp_call_ledger", { phase: "started" }),
      ).toThrow(
        expect.objectContaining({ code: "SESSION_INDEX_ANCHOR_FAILED" }),
      );
    });

    it("holds one cross-process writer lock across a multi-event authority transaction", async () => {
      const id = startSession("authority-transaction-lock", {
        title: "transaction",
      });
      const initialHead = readEvents(id).at(-1).hash;
      const gate = join(testDir, "authority-transaction.go");
      const attempted = join(testDir, "authority-transaction.attempted");
      const completed = join(testDir, "authority-transaction.completed");
      const storeUrl = new URL(
        "../../src/harness/jsonl-session-store.js",
        import.meta.url,
      ).href;
      const childScript = `
          import { existsSync, writeFileSync } from "node:fs";
          import { appendEvent } from ${JSON.stringify(storeUrl)};
          const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
          while (!existsSync(${JSON.stringify(gate)})) sleep(10);
          writeFileSync(${JSON.stringify(attempted)}, "attempted");
          appendEvent(${JSON.stringify(id)}, "concurrent_writer", { value: 1 });
          writeFileSync(${JSON.stringify(completed)}, "completed");
        `;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childScript],
        {
          cwd: process.cwd(),
          env: { ...process.env, CHAINLESSCHAIN_HOME: testDir },
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );

      const transactionResult = withSessionAuthorityTransaction(
        id,
        initialHead,
        (transaction) => {
          expect(existsSync(`${sessionPath(id)}.lock`)).toBe(true);
          transaction.appendAuthorityEvent("transaction_intent", {
            revision: initialHead,
          });
          writeFileSync(gate, "go");
          waitForFileSync(attempted);
          sleepSync(100);
          expect(existsSync(completed)).toBe(false);
          const committed = transaction.appendAuthorityEvent(
            "transaction_commit",
            { ok: true },
          );
          return { hash: committed.hash };
        },
      );

      const childResult = await waitForChild(child);
      expect(childResult).toMatchObject({ code: 0, signal: null });
      expect(childResult.stderr).toBe("");
      expect(existsSync(completed)).toBe(true);
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_intent",
        "transaction_commit",
        "concurrent_writer",
      ]);
      expect(readEvents(id)[2].hash).toBe(transactionResult.hash);
      expect(verifySession(id).status).toBe("verified");
    }, 20_000);

    it("rejects a stale or asynchronous authority transaction before mutation", () => {
      const id = startSession("authority-transaction-stale", {
        title: "transaction",
      });
      const initialHead = readEvents(id).at(-1).hash;
      appendUserMessage(id, "advance");
      const callback = vi.fn();

      expect(() =>
        withSessionAuthorityTransaction(id, initialHead, callback),
      ).toThrow(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
      expect(callback).not.toHaveBeenCalled();
      expect(() =>
        withSessionAuthorityTransaction(
          id,
          readEvents(id).at(-1).hash,
          async () => null,
        ),
      ).toThrow(/must be synchronous/);
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "user_message",
      ]);

      const missingId = startSession("authority-transaction-missing", {
        title: "transaction",
      });
      const missingHead = readEvents(missingId).at(-1).hash;
      rmSync(sessionPath(missingId));
      expect(() =>
        withSessionAuthorityTransaction(missingId, missingHead, vi.fn()),
      ).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("poisons an uncertain writer instead of appending from a stale local head", () => {
      const id = startSession("authority-transaction-poison", {
        title: "transaction",
      });
      const initialHead = readEvents(id).at(-1).hash;
      let poisonedError = null;
      const previousFaultInjection =
        process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
      _sessionScaleFaultHooks.afterTranscriptAppend = ({ type }) => {
        if (type === "transaction_uncertain") {
          throw new Error("injected sidecar window");
        }
      };

      try {
        expect(() =>
          withSessionAuthorityTransaction(id, initialHead, (transaction) => {
            try {
              transaction.appendAuthorityEvent("transaction_uncertain", {
                value: 1,
              });
            } catch (error) {
              try {
                transaction.appendAuthorityEvent("must_not_append", {
                  value: 2,
                });
              } catch (poisoned) {
                poisonedError = poisoned;
              }
              throw error;
            }
          }),
        ).toThrow(
          expect.objectContaining({
            code: "SESSION_INDEX_ANCHOR_FAILED",
            commitState: "unknown",
          }),
        );
      } finally {
        _sessionScaleFaultHooks.afterTranscriptAppend = null;
        if (previousFaultInjection === undefined) {
          delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
        } else {
          process.env.CC_SESSION_SCALE_FAULT_INJECTION = previousFaultInjection;
        }
      }

      expect(poisonedError).toMatchObject({
        code: "SESSION_AUTHORITY_TRANSACTION_POISONED",
        commitState: "unknown",
      });
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_uncertain",
      ]);
      expect(verifySession(id).status).toBe("verified");
      expect(() => readVerifiedEvents(id)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
      expect(repairSession(id)).toMatchObject({
        healthy: true,
        indexChanged: true,
      });
      expect(readVerifiedEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_uncertain",
      ]);
    });

    it("reports unknown settlement while retaining the original operation failure", () => {
      const id = startSession("authority-transaction-nested-failure", {
        title: "transaction",
      });
      const initialHead = readEvents(id).at(-1).hash;
      const previousFaultInjection =
        process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
      _sessionScaleFaultHooks.afterTranscriptAppend = ({ type }) => {
        if (type === "failed_audit") {
          const error = new Error("injected failed-audit anchor window");
          error.code = "SESSION_INDEX_ANCHOR_FAILED";
          error.commitState = "unknown";
          throw error;
        }
      };

      let thrown = null;
      try {
        withSessionAuthorityTransaction(id, initialHead, (transaction) => {
          transaction.appendAuthorityEvent("transaction_intent", {
            value: 1,
          });
          const operationError = new Error("injected restore failure");
          operationError.code = "INJECTED_RESTORE_FAILURE";
          try {
            transaction.appendAuthorityEvent("failed_audit", {
              status: "failed",
            });
          } catch (auditError) {
            operationError.checkpointAuditError = auditError;
          }
          throw operationError;
        });
      } catch (error) {
        thrown = error;
      } finally {
        _sessionScaleFaultHooks.afterTranscriptAppend = null;
        if (previousFaultInjection === undefined) {
          delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
        } else {
          process.env.CC_SESSION_SCALE_FAULT_INJECTION = previousFaultInjection;
        }
      }

      expect(thrown).toMatchObject({
        code: "SESSION_INDEX_ANCHOR_FAILED",
        commitState: "unknown",
        transactionError: {
          code: "INJECTED_RESTORE_FAILURE",
          checkpointAuditError: {
            code: "SESSION_INDEX_ANCHOR_FAILED",
            commitState: "unknown",
          },
        },
      });
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_intent",
        "failed_audit",
      ]);
      expect(() => readVerifiedEvents(id)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
      expect(repairSession(id)).toMatchObject({ healthy: true });
      expect(readVerifiedEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_intent",
        "failed_audit",
      ]);
    });

    it("retains only explicit recovery evidence when final settlement alone fails", () => {
      const id = startSession("authority-transaction-final-settlement", {
        title: "transaction",
      });
      const initialHead = readEvents(id).at(-1).hash;
      const privateResult = "callback-result-must-not-leak";
      const metaFile = join(sessionsDir, `${id}.meta.json`);
      let thrown = null;

      try {
        withSessionAuthorityTransaction(id, initialHead, (transaction) => {
          transaction.appendAuthorityEvent("transaction_complete", {
            value: 1,
          });
          transaction.retainRecoveryEvidence({
            safetyId: "safety-final-1",
            safetyIdentity: `git:${"a".repeat(40)}`,
            safetyCoverage: "checkpoint",
            restorePhase: "workspace-applied",
            branchSessionId: "session-final-branch",
            createdPaths: ["src/new.js", 17],
            arbitraryCallbackResult: privateResult,
          });

          // Every append has succeeded and updated the sidecar. Make only the
          // transaction's final transcript/sidecar settlement check fail.
          const meta = JSON.parse(readFileSync(metaFile, "utf8"));
          writeFileSync(
            metaFile,
            `${JSON.stringify({ ...meta, event_count: 0 })}\n`,
            "utf8",
          );
          return { privateResult };
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: "SESSION_INDEX_ANCHOR_FAILED",
        commitState: "unknown",
        transactionRecoveryEvidence: {
          safetyId: "safety-final-1",
          safetyIdentity: `git:${"a".repeat(40)}`,
          safetyCoverage: "checkpoint",
          restorePhase: "workspace-applied",
          branchSessionId: "session-final-branch",
          createdPaths: ["src/new.js"],
        },
      });
      expect(thrown).not.toHaveProperty("transactionError");
      expect(thrown.transactionRecoveryEvidence).not.toHaveProperty(
        "arbitraryCallbackResult",
      );
      expect(JSON.stringify(thrown)).not.toContain(privateResult);
      expect(Object.isFrozen(thrown.transactionRecoveryEvidence)).toBe(true);
      expect(
        Object.isFrozen(thrown.transactionRecoveryEvidence.createdPaths),
      ).toBe(true);
      expect(repairSession(id)).toMatchObject({
        healthy: true,
        indexChanged: true,
      });
    });

    it("revokes retained and thenable-returning transaction writers", () => {
      const id = startSession("authority-transaction-revoked", {
        title: "transaction",
      });
      let retained = null;
      const firstHead = readEvents(id).at(-1).hash;
      withSessionAuthorityTransaction(id, firstHead, (transaction) => {
        retained = transaction;
        transaction.appendAuthorityEvent("transaction_complete", {
          value: 1,
        });
      });

      expect(() =>
        retained.appendAuthorityEvent("late_append", { value: 2 }),
      ).toThrow(
        expect.objectContaining({
          code: "SESSION_AUTHORITY_TRANSACTION_CLOSED",
        }),
      );

      let thenableWriter = null;
      const secondHead = readEvents(id).at(-1).hash;
      expect(() =>
        withSessionAuthorityTransaction(id, secondHead, (transaction) => {
          thenableWriter = transaction;
          return Promise.resolve("too late");
        }),
      ).toThrow(
        expect.objectContaining({
          code: "SESSION_AUTHORITY_TRANSACTION_ASYNC",
        }),
      );
      expect(() =>
        thenableWriter.appendAuthorityEvent("late_thenable_append", {
          value: 3,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "SESSION_AUTHORITY_TRANSACTION_CLOSED",
        }),
      );
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_complete",
      ]);
      expect(verifySession(id).status).toBe("verified");
    });

    it("does not swallow a falsy value thrown by an authority transaction", () => {
      const id = startSession("authority-transaction-falsy-throw", {
        title: "transaction",
      });
      const initialHead = readEvents(id).at(-1).hash;
      let completed = false;
      try {
        withSessionAuthorityTransaction(id, initialHead, (transaction) => {
          transaction.appendAuthorityEvent("transaction_intent", {
            value: 1,
          });
          const throwValue = (value) => {
            throw value;
          };
          throwValue(undefined);
        });
        completed = true;
      } catch (error) {
        expect(error).toBeUndefined();
      }
      expect(completed).toBe(false);
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_intent",
      ]);
      expect(readVerifiedEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "transaction_intent",
      ]);
    });

    it("folds the verified chain once and refuses a stale sidecar before finish", () => {
      const id = startSession("streaming-stale-sidecar", {
        title: "verified",
      });
      appendUserMessage(id, "one pass");
      const ioMetrics = {};
      const finish = vi.fn(({ headHash, eventCount }) => ({
        headHash,
        eventCount,
      }));
      const projection = readVerifiedProjection(
        id,
        () => ({ accept: vi.fn(), finish }),
        { ioMetrics },
      );

      expect(projection).toMatchObject({ eventCount: 2 });
      expect(ioMetrics.bytesRead).toBe(statSync(sessionPath(id)).size);
      expect(finish).toHaveBeenCalledTimes(1);

      const metaFile = join(sessionsDir, `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      writeFileSync(
        metaFile,
        `${JSON.stringify({ ...meta, event_count: meta.event_count - 1 })}\n`,
        "utf8",
      );
      const staleFinish = vi.fn();
      expect(() =>
        readVerifiedProjection(id, () => ({
          accept() {},
          finish: staleFinish,
        })),
      ).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
      expect(staleFinish).not.toHaveBeenCalled();
    });

    it("refuses a stale compact CAS without hiding a concurrent turn", () => {
      const id = startSession("compact-stale-cas", { title: "verified" });
      appendUserMessage(id, "before compact");
      const source = readVerifiedProjection(id, () => ({
        accept() {},
        finish(authority) {
          return {
            headHash: authority.headHash,
            messages: authority.readMessages(),
          };
        },
      }));

      appendUserMessage(id, "concurrent turn");

      expect(() =>
        appendAuthorityEventIfHead(
          id,
          "compact",
          {
            messages: [{ role: "assistant", content: "stale compact result" }],
          },
          source.headHash,
        ),
      ).toThrow(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
      expect(readEvents(id).some((event) => event.type === "compact")).toBe(
        false,
      );
      expect(readVerifiedMessages(id)).toEqual([
        { role: "user", content: "before compact" },
        { role: "user", content: "concurrent turn" },
      ]);
      expect(verifySession(id).status).toBe("verified");
    });

    it("matches active replay under lock before accepting a REPL compact", () => {
      const id = startSession("repl-compact-message-cas", {
        title: "verified",
      });
      appendUserMessage(id, "known turn");
      const expected = readVerifiedMessages(id);

      appendUserMessage(id, "concurrent turn");
      expect(() =>
        appendCompactEventIfMessagesMatch(
          id,
          {
            strategy: "auto",
            messages: [
              markDurableSystemMessage(
                { role: "system", content: "stale summary" },
                DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
              ),
            ],
          },
          expected,
        ),
      ).toThrow(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
      expect(readVerifiedMessages(id)).toEqual([
        { role: "user", content: "known turn" },
        { role: "user", content: "concurrent turn" },
      ]);

      const current = readVerifiedMessages(id);
      const summary = markDurableSystemMessage(
        { role: "system", content: "current summary" },
        DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      );
      const appended = appendCompactEventIfMessagesMatch(
        id,
        { strategy: "auto", messages: [summary] },
        current,
      );
      expect(appended.hash).toMatch(/^[a-f0-9]{64}$/);
      const resumed = readVerifiedMessages(id);
      expect(resumed).toEqual([{ role: "system", content: "current summary" }]);
      expect(getDurableSystemMessageProvenance(resumed[0])).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      });
      expect(verifySession(id).status).toBe("verified");
    });

    it("keeps resume heap to the compact checkpoint and suffix", () => {
      const id = startSession("streaming-large-prefix", { title: "large" });
      const events = [];
      let previousHash = null;
      const add = (core) => {
        const hash = computeEventHash(previousHash, core);
        const chained = { ...core, prevHash: previousHash, hash };
        previousHash = hash;
        events.push(chained);
      };
      add({
        type: "session_start",
        timestamp: 1,
        data: { title: "large" },
      });
      for (let index = 0; index < 4_000; index += 1) {
        add({
          type: index % 2 ? "assistant_message" : "user_message",
          timestamp: index + 2,
          data: {
            role: index % 2 ? "assistant" : "user",
            content: `${index}:${"x".repeat(256)}`,
          },
        });
      }
      add({
        type: "compact",
        timestamp: 5_000,
        data: {
          messages: [{ role: "system", content: "bounded summary" }],
        },
      });
      add({
        type: "user_message",
        timestamp: 5_001,
        data: { role: "user", content: "small suffix" },
      });
      const file = sessionPath(id);
      writeFileSync(
        file,
        `${events.map((item) => JSON.stringify(item)).join("\n")}\n`,
        "utf8",
      );
      const metaFile = join(sessionsDir, `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      writeFileSync(
        metaFile,
        `${JSON.stringify({
          ...meta,
          event_count: events.length,
          last_hash: previousHash,
        })}\n`,
        "utf8",
      );

      const ioMetrics = {};
      const messageIoMetrics = {};
      let accepted = 0;
      const result = readVerifiedProjection(
        id,
        () => ({
          accept() {
            accepted += 1;
          },
          finish({ eventCount, readMessages }) {
            return { eventCount, messages: readMessages() };
          },
        }),
        { ioMetrics, messageIoMetrics },
      );

      expect(result).toEqual({
        eventCount: events.length,
        messages: [
          { role: "system", content: "bounded summary" },
          { role: "user", content: "small suffix" },
        ],
      });
      expect(accepted).toBe(events.length);
      expect(ioMetrics.bytesRead).toBe(statSync(file).size);
      expect(messageIoMetrics.bytesRead).toBeLessThan(statSync(file).size / 4);
    });
  });

  // ── rebuildMessages ───────────────────────────────────────────────

  describe("rebuildMessages", () => {
    it("rebuilds messages from events", () => {
      const id = startSession("s7");
      appendUserMessage(id, "hello");
      appendAssistantMessage(id, "hi");
      const messages = rebuildMessages(id);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "user", content: "hello" });
      expect(messages[1]).toEqual({ role: "assistant", content: "hi" });
    });

    it("reads metadata and the latest snapshot without materializing all events", () => {
      const id = startSession("metadata-latest", {
        title: "Original",
        provider: "provider-a",
        model: "model-a",
      });
      appendEvent(id, "snapshot", { sequence: 1 });
      appendUserMessage(id, "large-prefix");
      appendEvent(id, "snapshot", { sequence: 2 });
      renameSession(id, "Renamed");

      expect(getJsonlSessionMetadata(id)).toMatchObject({
        id,
        title: "Renamed",
        provider: "provider-a",
        model: "model-a",
        message_count: 1,
      });
      expect(findLatestEvent(id, "snapshot")?.data).toEqual({ sequence: 2 });
      expect(
        findLatestEvent(id, ["snapshot", "user_message"], (event) =>
          String(event.data?.sequence || "").includes("1"),
        )?.data,
      ).toEqual({ sequence: 1 });
      expect(findLatestEvent(id, "missing")).toBeNull();
    });

    it("rebuilds from last compact event if present", () => {
      const id = startSession("s8");
      appendUserMessage(id, "old msg 1");
      appendAssistantMessage(id, "old resp 1");
      // Compact with saved messages
      appendCompactEvent(id, {
        messages: [{ role: "system", content: "summary of old conversation" }],
      });
      appendUserMessage(id, "new msg");
      appendAssistantMessage(id, "new resp");

      const messages = rebuildMessages(id);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("summary of old conversation");
      expect(messages[1].content).toBe("new msg");
      expect(messages[2].content).toBe("new resp");
    });

    it("persists durable summary provenance but strips its wire tag on rebuild", () => {
      const id = startSession("s8-provenance");
      const summary = markDurableSystemMessage(
        { role: "system", content: "canonical compact facts" },
        DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      );
      appendCompactEvent(id, {
        messages: [
          { role: "system", content: "stale host prompt" },
          summary,
          { role: "user", content: "active question" },
        ],
      });

      const compact = readEvents(id).find((event) => event.type === "compact");
      expect(
        compact.data.messages[1][SESSION_MESSAGE_PROVENANCE_FIELD],
      ).toMatchObject({ kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY });
      expect(
        compact.data.messages[0][SESSION_MESSAGE_PROVENANCE_FIELD],
      ).toBeUndefined();

      const rebuilt = rebuildMessages(id);
      expect(rebuilt).toEqual([
        { role: "system", content: "stale host prompt" },
        { role: "system", content: "canonical compact facts" },
        { role: "user", content: "active question" },
      ]);
      expect(getDurableSystemMessageProvenance(rebuilt[0])).toBeNull();
      expect(getDurableSystemMessageProvenance(rebuilt[1])).toBeNull();
      const verified = readVerifiedMessages(id);
      expect(getDurableSystemMessageProvenance(verified[1])).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      });
      expect(JSON.stringify(rebuilt)).not.toContain(
        SESSION_MESSAGE_PROVENANCE_FIELD,
      );
    });

    it("encodes checkpoint timeline summary provenance before hashing", () => {
      const id = startSession("checkpoint-provenance");
      appendEvent(id, "checkpoint_timeline_commit", {
        messages: [
          { role: "system", content: "stale checkpoint host" },
          markDurableSystemMessage(
            { role: "system", content: "checkpoint handoff" },
            DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
          ),
          { role: "user", content: "surviving turn" },
        ],
      });

      const event = readEvents(id).at(-1);
      expect(event.type).toBe("checkpoint_timeline_commit");
      expect(
        event.data.messages[1][SESSION_MESSAGE_PROVENANCE_FIELD],
      ).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
      });
      expect(verifySession(id).status).toBe("verified");

      const rebuilt = rebuildMessages(id);
      expect(getDurableSystemMessageProvenance(rebuilt[1])).toBeNull();
      const verified = readVerifiedMessages(id);
      expect(getDurableSystemMessageProvenance(verified[1])).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
      });
      expect(JSON.stringify(rebuilt)).not.toContain(
        SESSION_MESSAGE_PROVENANCE_FIELD,
      );
    });

    it("preserves summary provenance through REPL apply, persist, and a second resume", async () => {
      const id = startSession("repl-provenance-two-hop");
      appendCompactEvent(id, {
        strategy: "fixture",
        messages: [
          { role: "system", content: "old host prompt" },
          markDurableSystemMessage(
            { role: "system", content: "two-hop durable facts" },
            DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
          ),
          { role: "user", content: "restored question" },
        ],
      });

      const {
        createReplResumeStateController,
        prepareReplJsonlResumeCandidate,
      } = await import("../../src/repl/agent-repl.js");
      const first = prepareReplJsonlResumeCandidate(id);
      expect(first.ok).toBe(true);
      expect(first.canonicalSystemMessages).toEqual([
        { role: "system", content: "two-hop durable facts" },
      ]);

      const runtimeManager = {
        current: Object.freeze({ id: "old-runtime" }),
        commit(next) {
          this.current = next;
        },
      };
      const bindings = {
        sessionId: "old-session",
        messages: [{ role: "system", content: "fresh host prompt" }],
        recovery: null,
        recoveryError: null,
        sanitizeRolesNextTurn: false,
        turnBindingProducer: null,
        turnBindingCriticalError: null,
        checkpointMarks: [],
        clearedConversation: null,
        runtimeManager,
        applyMcpRecoveryCommit: vi.fn(),
        logMcpRecoveryCommit: vi.fn(),
        logger: { info: vi.fn() },
      };
      const controller = createReplResumeStateController(bindings);
      const hostSystemMessages = controller.registerHostSystemMessages();
      controller.apply({
        sessionId: id,
        hostSystemMessages,
        canonicalSystemMessages: first.canonicalSystemMessages,
        conversationMessages: first.conversationMessages,
        mcpCommit: first.mcp,
        mcpRuntime: Object.freeze({ id: "target-runtime" }),
        sanitizeRolesNextTurn: true,
        logMessage: "resumed",
      });

      const appliedSummary = bindings.messages.find(
        (message) => message.content === "two-hop durable facts",
      );
      expect(getDurableSystemMessageProvenance(appliedSummary)).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      });

      appendCompactEvent(id, {
        strategy: "session-end",
        messages: bindings.messages,
      });
      const persistedSummary = readEvents(id)
        .at(-1)
        .data.messages.find(
          (message) => message.content === "two-hop durable facts",
        );
      expect(persistedSummary[SESSION_MESSAGE_PROVENANCE_FIELD]).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      });
      expect(verifySession(id).status).toBe("verified");

      const second = prepareReplJsonlResumeCandidate(id);
      expect(second.ok).toBe(true);
      expect(second.canonicalSystemMessages).toEqual([
        { role: "system", content: "two-hop durable facts" },
      ]);
      expect(JSON.stringify(second)).not.toContain("old host prompt");
      expect(JSON.stringify(second)).not.toContain("fresh host prompt");
    });

    it("returns empty for non-existent session", () => {
      expect(rebuildMessages("nope")).toEqual([]);
    });

    it("toIsoSafe converts valid ms but returns '' for missing / invalid (no throw)", () => {
      const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
      expect(toIsoSafe(ms)).toBe(new Date(ms).toISOString());
      // The cases a bare `ts ? ...` truthy guard would miss or crash on:
      expect(toIsoSafe(undefined)).toBe("");
      expect(toIsoSafe(null)).toBe("");
      expect(toIsoSafe("not-a-number")).toBe(""); // truthy but invalid → no RangeError
      expect(toIsoSafe(NaN)).toBe("");
      expect(toIsoSafe(Infinity)).toBe("");
      // numeric string is coerced (Number("123") → 123)
      expect(toIsoSafe(String(ms))).toBe(new Date(ms).toISOString());
    });

    it("does not crash on a malformed compact event (missing / null data)", () => {
      // A partially-written / hand-edited line can be valid JSON but have a
      // `compact` type with no usable data — this used to throw a TypeError
      // ("Cannot read properties of null") and abort the whole resume.
      const id = "s-corrupt-compact";
      const lines =
        [
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "hi" },
          }),
          JSON.stringify({ type: "compact" }), // no data
          JSON.stringify({ type: "compact", data: null }), // null data
          JSON.stringify({
            type: "assistant_message",
            data: { role: "assistant", content: "yo" },
          }),
        ].join("\n") + "\n";
      writeFileSync(sessionPath(id), lines, "utf-8");
      const messages = rebuildMessages(id);
      expect(messages).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "yo" },
      ]);
    });

    it("restores from the newest compact checkpoint without retaining its large prefix", () => {
      const id = "s-large-checkpoint";
      const prefix = Array.from({ length: 4_000 }, (_, index) =>
        JSON.stringify({
          type: index % 2 ? "assistant_message" : "user_message",
          timestamp: index + 1,
          data: {
            role: index % 2 ? "assistant" : "user",
            content: `${index}:${"x".repeat(256)}`,
          },
        }),
      );
      const checkpoint = JSON.stringify({
        type: "compact",
        timestamp: 5_000,
        data: { messages: [{ role: "system", content: "bounded summary" }] },
      });
      const suffix = JSON.stringify({
        type: "user_message",
        timestamp: 5_001,
        data: { role: "user", content: "new turn" },
      });
      writeFileSync(
        sessionPath(id),
        `${prefix.join("\n")}\n${checkpoint}\n${suffix}\n`,
        "utf8",
      );

      expect(rebuildMessages(id)).toEqual([
        { role: "system", content: "bounded summary" },
        { role: "user", content: "new turn" },
      ]);
    });

    it("drops malformed message events (null / no-role data) instead of injecting them", () => {
      const id = "s-corrupt-msg";
      const lines =
        [
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "real" },
          }),
          JSON.stringify({ type: "assistant_message", data: null }),
          JSON.stringify({ type: "user_message" }), // no data
          JSON.stringify({ type: "system", data: { content: "no role" } }),
          JSON.stringify({
            type: "assistant_message",
            data: { role: "assistant", content: "ok" },
          }),
        ].join("\n") + "\n";
      writeFileSync(sessionPath(id), lines, "utf-8");
      expect(rebuildMessages(id)).toEqual([
        { role: "user", content: "real" },
        { role: "assistant", content: "ok" },
      ]);
    });

    it("skips a malformed compact and falls back to an earlier valid one", () => {
      const id = "s-compact-fallback";
      const lines =
        [
          JSON.stringify({
            type: "compact",
            data: { messages: [{ role: "system", content: "summary" }] },
          }),
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "after" },
          }),
          JSON.stringify({
            type: "compact",
            data: { messages: "not-an-array" },
          }),
        ].join("\n") + "\n";
      writeFileSync(sessionPath(id), lines, "utf-8");
      const messages = rebuildMessages(id);
      expect(messages[0]).toEqual({ role: "system", content: "summary" });
      expect(messages.some((m) => m.content === "after")).toBe(true);
    });
  });

  // ── listJsonlSessions ────────────────────────────────────────────

  describe("listJsonlSessions", () => {
    it("lists sessions sorted by last update", () => {
      startSession("sa", { title: "First" });
      startSession("sb", { title: "Second" });
      appendUserMessage("sb", "newer");

      const sessions = listJsonlSessions();
      expect(sessions.length).toBe(2);
      // "sb" was updated more recently
      expect(sessions[0].id).toBe("sb");
    });

    it("includes message count", () => {
      const id = startSession("sc", { title: "Chat" });
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");
      appendUserMessage(id, "q2");

      const sessions = listJsonlSessions();
      const s = sessions.find((x) => x.id === "sc");
      expect(s.message_count).toBe(3);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        startSession(`lim-${i}`);
      }
      const sessions = listJsonlSessions({ limit: 3 });
      expect(sessions.length).toBe(3);
    });

    it("does not crash on a session with a missing / invalid timestamp", () => {
      // A corrupt session_start line (valid JSON, no/garbage timestamp) used to
      // make `new Date(undefined).toISOString()` throw and abort the WHOLE list.
      writeFileSync(
        sessionPath("s-bad-ts"),
        [
          JSON.stringify({ type: "session_start", data: { title: "NoTs" } }),
          JSON.stringify({
            type: "user_message",
            data: { role: "user", content: "hi" },
            timestamp: "not-a-number",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );
      // A healthy session must still appear alongside the corrupt one.
      startSession("s-good", { title: "Good" });

      const sessions = listJsonlSessions();
      const bad = sessions.find((s) => s.id === "s-bad-ts");
      const good = sessions.find((s) => s.id === "s-good");
      expect(bad).toBeTruthy();
      expect(bad.created_at).toBe(""); // invalid → empty, not a thrown RangeError
      expect(bad.updated_at).toBe("");
      expect(bad.title).toBe("NoTs");
      expect(good).toBeTruthy();
      expect(good.created_at).not.toBe(""); // healthy session keeps its date
    });
  });

  // ── renameSession / pruneJsonlSessions (gap 2026-07-11) ───────────

  describe("renameSession", () => {
    it("appends a rename event; the LAST rename wins in listings", () => {
      startSession("rn-1", { title: "Original" });
      renameSession("rn-1", "Better name");
      renameSession("rn-1", "Final name");
      const s = listJsonlSessions().find((x) => x.id === "rn-1");
      expect(s.title).toBe("Final name");
      // Hash chain stays intact — rename is append-only, no rewrite.
      expect(verifySession("rn-1").status).toBe("verified");
    });

    it("rejects unknown session ids and empty titles", () => {
      expect(() => renameSession("rn-nope", "x")).toThrow(/not found/i);
      startSession("rn-2", { title: "T" });
      expect(() => renameSession("rn-2", "   ")).toThrow(/non-empty/i);
    });
  });

  describe("canonical id resolution and deletion", () => {
    it("resolves one prefix and rejects ambiguous prefixes", () => {
      startSession("resolve-aaa");
      expect(resolveSessionId("resolve-a")).toBe("resolve-aaa");
      expect(resolveSessionId("resolve-aaa")).toBe("resolve-aaa");
      startSession("resolve-aab");
      expect(() => resolveSessionId("resolve-aa")).toThrow(/ambiguous/i);
      expect(resolveSessionId("missing")).toBeNull();
    });

    it("tombstones deletion so stale non-start writers cannot resurrect it", () => {
      startSession("delete-me", { title: "D" });
      expect(deleteJsonlSession("delete-me")).toBe(true);
      expect(sessionExists("delete-me")).toBe(false);
      expect(() => appendUserMessage("delete-me", "late")).toThrowError(
        expect.objectContaining({ code: "SESSION_DELETED" }),
      );
      expect(sessionExists("delete-me")).toBe(false);

      // An explicit new session_start is the only operation allowed to reuse
      // a tombstoned id, and starts a new genesis chain.
      startSession("delete-me", { title: "Recreated" });
      expect(verifySession("delete-me").status).toBe("verified");
      expect(readEvents("delete-me")[0].prevHash).toBeNull();
    });
  });

  describe("pruneJsonlSessions", () => {
    it("deletes sessions idle past the cutoff, keeping the newest N", () => {
      const now = Date.now();
      // Three old sessions + one fresh. Timestamps ride the event records, so
      // fabricate old files directly (valid chain not required for pruning).
      for (const [id, age] of [
        ["old-a", 40],
        ["old-b", 35],
        ["fresh", 1],
      ]) {
        const ts = now - age * 24 * 60 * 60 * 1000;
        writeFileSync(
          sessionPath(id),
          JSON.stringify({
            type: "session_start",
            timestamp: ts,
            data: { title: id },
          }) + "\n",
          "utf-8",
        );
      }
      const result = pruneJsonlSessions({
        olderThanDays: 30,
        keep: 1,
        now,
      });
      expect(result.deleted.sort()).toEqual(["old-a", "old-b"]);
      expect(sessionExists("fresh")).toBe(true);
      expect(sessionExists("old-a")).toBe(false);
    });

    it("keep floor protects even ancient sessions; dry-run deletes nothing", () => {
      const now = Date.now();
      writeFileSync(
        sessionPath("ancient"),
        JSON.stringify({
          type: "session_start",
          timestamp: now - 400 * 24 * 60 * 60 * 1000,
          data: { title: "ancient" },
        }) + "\n",
        "utf-8",
      );
      // keep default (10) > total count → nothing deleted
      expect(pruneJsonlSessions({ olderThanDays: 30, now }).deleted).toEqual(
        [],
      );
      // dry-run: reported but still on disk
      const dry = pruneJsonlSessions({
        olderThanDays: 30,
        keep: 0,
        dryRun: true,
        now,
      });
      expect(dry.deleted).toEqual(["ancient"]);
      expect(sessionExists("ancient")).toBe(true);
    });

    it("requires a numeric --older-than", () => {
      expect(() => pruneJsonlSessions({})).toThrow(/older-than/i);
    });
  });

  // ── forkSession ───────────────────────────────────────────────────

  describe("forkSession", () => {
    it("creates a new session with copied events", () => {
      const id = startSession("orig", { title: "Original" });
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");

      const forkedId = forkSession("orig");
      expect(forkedId).not.toBe("orig");
      expect(sessionExists(forkedId)).toBe(true);

      const events = readEvents(forkedId);
      // original 3 events + fork system message
      expect(events.length).toBe(4);
      expect(events[3].type).toBe("system");
      expect(events[3].data.content).toContain("Forked from");
      expect(events[3].data).toHaveProperty(SESSION_FORK_AUTHORITY_FIELD);
      const lineage = readVerifiedMessages(forkedId).at(-1);
      expect(lineage).not.toHaveProperty(SESSION_FORK_AUTHORITY_FIELD);
      expect(getDurableSystemMessageProvenance(lineage)).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE,
      });
    });

    it("deduplicates an exact request and permits an explicit distinct intent", () => {
      const id = startSession("fork-idempotent", { title: "Original" });
      appendUserMessage(id, "q1");

      const first = forkSession(id);
      const retry = forkSession(id);
      expect(retry).toBe(first);

      appendUserMessage(first, "fork progressed");
      const progressedEvents = readEvents(first).length;
      expect(forkSession(id)).toBe(first);
      expect(readEvents(first)).toHaveLength(progressedEvents);

      appendUserMessage(id, "source progressed after unknown commit");
      expect(forkSession(id)).toBe(first);
      expect(readEvents(first)).toHaveLength(progressedEvents);

      const distinct = forkSession(id, { requestId: "second-intent" });
      expect(distinct).not.toBe(first);
      expect(readVerifiedMessages(first).at(-1).content).toContain(
        "fork progressed",
      );
      expect(readVerifiedMessages(distinct).at(-1).content).toContain(
        "Forked from",
      );
    });

    it("refuses to lower a progressed fork anchor to its creation prefix", () => {
      const sourceId = startSession("fork-anchor-rollback", {
        title: "Original",
      });
      appendUserMessage(sourceId, "source turn");
      const forkedId = forkSession(sourceId);
      appendUserMessage(forkedId, "later fork turn");

      const filePath = sessionPath(forkedId);
      const metaPath = join(sessionsDir, `${forkedId}.meta.json`);
      const committedMeta = readFileSync(metaPath, "utf8");
      const lines = readFileSync(filePath, "utf8").trimEnd().split(/\r?\n/);
      expect(lines).toHaveLength(4);
      writeFileSync(filePath, `${lines.slice(0, 3).join("\n")}\n`, "utf8");

      expect(() => forkSession(sourceId)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
      expect(readFileSync(metaPath, "utf8")).toBe(committedMeta);
      expect(readEvents(forkedId)).toHaveLength(3);
      expect(() => readVerifiedMessages(forkedId)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("recovers the same successor across every fork publication crash window", () => {
      const hookNames = [
        "afterForkCopy",
        "afterForkLineage",
        "afterForkPublish",
        "afterForkMeta",
      ];
      process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
      try {
        for (const [index, hookName] of hookNames.entries()) {
          const sourceId = `fork-crash-${index}`;
          startSession(sourceId, { title: "Crash source" });
          appendUserMessage(sourceId, "durable source turn");
          const before = new Set(
            readdirSync(sessionsDir).filter(
              (name) =>
                name.endsWith(".jsonl") || name.endsWith(".fork.pending"),
            ),
          );
          let injected = false;
          _sessionScaleFaultHooks[hookName] = () => {
            if (!injected) {
              injected = true;
              throw new Error(`fork crash fixture: ${hookName}`);
            }
          };

          expect(() =>
            forkSession(sourceId, { requestId: "stable-request" }),
          ).toThrow(`fork crash fixture: ${hookName}`);
          _sessionScaleFaultHooks[hookName] = null;

          const crashArtifacts = readdirSync(sessionsDir).filter(
            (name) =>
              (name.endsWith(".jsonl") || name.endsWith(".fork.pending")) &&
              !before.has(name),
          );
          expect(crashArtifacts).toHaveLength(1);
          const expectedId = crashArtifacts[0].replace(
            /(?:\.jsonl|\.fork\.pending)$/,
            "",
          );
          if (hookName === "afterForkCopy") {
            expect(
              listJsonlSessions({ limit: 100 }).some(
                (session) => session.id === expectedId,
              ),
            ).toBe(false);
            expect(
              existsSync(join(sessionsDir, `${expectedId}.meta.json`)),
            ).toBe(false);
          }
          appendUserMessage(
            sourceId,
            `source advanced after ${hookName} unknown commit`,
          );
          const recovered = forkSession(sourceId, {
            requestId: "stable-request",
          });
          const replay = forkSession(sourceId, {
            requestId: "stable-request",
          });

          expect(recovered).toBe(expectedId);
          expect(replay).toBe(recovered);
          expect(verifySession(recovered).status).toBe("verified");
          expect(readVerifiedMessages(recovered).at(-1).content).toContain(
            `Forked from session ${sourceId}`,
          );
          expect(
            readdirSync(sessionsDir).filter(
              (name) => name.endsWith(".jsonl") && !before.has(name),
            ),
          ).toEqual([`${expectedId}.jsonl`]);
          expect(
            existsSync(join(sessionsDir, `${expectedId}.fork.pending`)),
          ).toBe(false);
        }
      } finally {
        for (const hookName of hookNames) {
          _sessionScaleFaultHooks[hookName] = null;
        }
        delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      }
    });

    it("returns null for non-existent session", () => {
      expect(forkSession("nope")).toBeNull();
    });

    it("refuses to re-anchor a hash-valid source whose sidecar no longer matches", () => {
      const id = startSession("fork-anchor-mismatch", { title: "Original" });
      appendEvent(id, "system", {
        role: "system",
        content: "ordinary source system",
      });
      const events = readEvents(id);
      const forged = events.at(-1);
      forged.data[SESSION_MESSAGE_PROVENANCE_FIELD] = {
        schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      };
      forged.hash = computeEventHash(forged.prevHash, forged);
      writeFileSync(
        sessionPath(id),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      );
      expect(verifySession(id).status).toBe("verified");
      const before = readdirSync(sessionsDir)
        .filter((name) => name.endsWith(".jsonl"))
        .sort();

      expect(() => forkSession(id)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );

      expect(
        readdirSync(sessionsDir)
          .filter((name) => name.endsWith(".jsonl"))
          .sort(),
      ).toEqual(before);
    });
  });

  // ── createBranchSession (P0-3 从这里分支) ──────────────────────────

  describe("createBranchSession", () => {
    it("writes ONLY the pre-branch messages under the given id + records lineage", () => {
      const res = createBranchSession({
        branchSessionId: "parent-b-abc123",
        parentSessionId: "parent",
        parentTurnId: "turn-3",
        messages: [
          { role: "system", content: "SYS" }, // dropped — startSession re-adds
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1" },
        ],
        meta: { title: "Branch of parent" },
      });
      expect(res).toMatchObject({
        branchSessionId: "parent-b-abc123",
        created: true,
        messages: 2, // only the user + assistant turns
      });
      const events = readEvents("parent-b-abc123");
      expect(events[0].type).toBe("session_start");
      expect(events[1].type).toBe("session_branch");
      expect(events[1].data).toMatchObject({
        parentSessionId: "parent",
        parentTurnId: "turn-3",
      });
      expect(events.filter((e) => e.type === "user_message").length).toBe(1);
      expect(events.filter((e) => e.type === "assistant_message").length).toBe(
        1,
      );
      expect(events.at(-1)).toMatchObject({
        type: "session_branch_complete",
        data: { schemaVersion: 1, messageCount: 2 },
      });
    });

    it("does NOT touch the parent session (preservesParent)", () => {
      startSession("origin", { title: "Origin" });
      appendUserMessage("origin", "keep me");
      const before = readEvents("origin").length;
      createBranchSession({
        branchSessionId: "origin-b-xyz",
        parentSessionId: "origin",
        parentTurnId: "turn-1",
        messages: [{ role: "user", content: "keep me" }],
      });
      expect(readEvents("origin").length).toBe(before);
    });

    it("is idempotent — a replayed branch resolves to the existing file", () => {
      createBranchSession({
        branchSessionId: "p-b-dup",
        parentSessionId: "p",
        messages: [{ role: "user", content: "one" }],
      });
      const eventsAfterFirst = readEvents("p-b-dup").length;
      const second = createBranchSession({
        branchSessionId: "p-b-dup",
        parentSessionId: "p",
        messages: [{ role: "user", content: "one" }],
      });
      expect(second).toMatchObject({ created: false, messages: 0 });
      expect(readEvents("p-b-dup").length).toBe(eventsAfterFirst);

      appendUserMessage("p-b-dup", "branch progressed");
      const progressedEvents = readEvents("p-b-dup").length;
      const third = createBranchSession({
        branchSessionId: "p-b-dup",
        parentSessionId: "p",
        messages: [{ role: "user", content: "one" }],
      });
      expect(third).toMatchObject({ created: false, messages: 0 });
      expect(readEvents("p-b-dup").length).toBe(progressedEvents);
    });

    it("refuses to lower a progressed branch anchor to a truncated creation prefix", () => {
      const branchSessionId = "p-b-anchor-rollback";
      const branchInput = {
        branchSessionId,
        parentSessionId: "p",
        messages: [{ role: "user", content: "seed" }],
      };
      createBranchSession(branchInput);
      appendUserMessage(branchSessionId, "later durable turn");

      const filePath = sessionPath(branchSessionId);
      const metaPath = join(sessionsDir, `${branchSessionId}.meta.json`);
      const committedMeta = readFileSync(metaPath, "utf8");
      const lines = readFileSync(filePath, "utf8").trimEnd().split(/\r?\n/);
      expect(lines).toHaveLength(5);
      writeFileSync(filePath, `${lines.slice(0, 4).join("\n")}\n`, "utf8");

      expect(() => readVerifiedMessages(branchSessionId)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
      expect(() => createBranchSession(branchInput)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );

      expect(readFileSync(metaPath, "utf8")).toBe(committedMeta);
      expect(readEvents(branchSessionId)).toHaveLength(4);
      expect(() => readVerifiedMessages(branchSessionId)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
    });

    it("leaves no branch when message validation fails and permits a valid retry", () => {
      const branchSessionId = "p-b-validation-retry";

      expect(() =>
        createBranchSession({
          branchSessionId,
          parentSessionId: "p",
          messages: [{ role: "user", content: () => "invalid" }],
        }),
      ).toThrow(/JSON-safe data/);
      expect(sessionExists(branchSessionId)).toBe(false);

      const retry = createBranchSession({
        branchSessionId,
        parentSessionId: "p",
        messages: [{ role: "user", content: "valid retry" }],
      });
      expect(retry).toMatchObject({ created: true, messages: 1 });
      expect(readEvents(branchSessionId).map((event) => event.type)).toEqual([
        "session_start",
        "session_branch",
        "user_message",
        "session_branch_complete",
      ]);
    });

    it("resumes an exact crash prefix and publishes completion before idempotent success", () => {
      const branchSessionId = "p-b-crash-retry";
      let injected = false;
      process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
      _sessionScaleFaultHooks.afterTranscriptAppend = ({ type }) => {
        if (!injected && type === "user_message") {
          injected = true;
          throw new Error("branch crash fixture");
        }
      };
      try {
        expect(() =>
          createBranchSession({
            branchSessionId,
            parentSessionId: "p",
            parentTurnId: "turn-1",
            messages: [
              { role: "user", content: "one" },
              { role: "assistant", content: "two" },
            ],
          }),
        ).toThrow(/branch crash fixture/);
        expect(readEvents(branchSessionId).map((event) => event.type)).toEqual([
          "session_start",
          "session_branch",
          "user_message",
        ]);
        expect(() => readVerifiedMessages(branchSessionId)).toThrow(
          expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
        );

        _sessionScaleFaultHooks.afterTranscriptAppend = null;
        delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
        const recovered = createBranchSession({
          branchSessionId,
          parentSessionId: "p",
          parentTurnId: "turn-1",
          messages: [
            { role: "user", content: "one" },
            { role: "assistant", content: "two" },
          ],
        });
        expect(recovered).toMatchObject({ created: true, messages: 2 });
        expect(readEvents(branchSessionId).map((event) => event.type)).toEqual([
          "session_start",
          "session_branch",
          "user_message",
          "assistant_message",
          "session_branch_complete",
        ]);
        expect(readVerifiedMessages(branchSessionId)).toEqual([
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
        ]);
        expect(verifySession(branchSessionId).status).toBe("verified");

        const duplicate = createBranchSession({
          branchSessionId,
          parentSessionId: "p",
          parentTurnId: "turn-1",
          messages: [
            { role: "user", content: "one" },
            { role: "assistant", content: "two" },
          ],
        });
        expect(duplicate).toMatchObject({ created: false, messages: 0 });
      } finally {
        _sessionScaleFaultHooks.afterTranscriptAppend = null;
        delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
      }
    });

    it("rejects a completed deterministic branch with different input", () => {
      const branchSessionId = "p-b-conflict";
      createBranchSession({
        branchSessionId,
        parentSessionId: "p",
        messages: [{ role: "user", content: "original" }],
      });

      expect(() =>
        createBranchSession({
          branchSessionId,
          parentSessionId: "p",
          messages: [{ role: "user", content: "different" }],
        }),
      ).toThrow(expect.objectContaining({ code: "SESSION_BRANCH_CONFLICT" }));
    });

    it("rejects a traversal branch id", () => {
      expect(() => createBranchSession({ branchSessionId: "../evil" })).toThrow(
        /unsafe branch session id/,
      );
    });
  });

  // ── sessionExists ─────────────────────────────────────────────────

  describe("sessionExists", () => {
    it("returns true for existing session", () => {
      startSession("exists-test");
      expect(sessionExists("exists-test")).toBe(true);
    });

    it("returns false for non-existent session", () => {
      expect(sessionExists("no-such-session")).toBe(false);
    });
  });

  // ── getLastSessionId ──────────────────────────────────────────────

  describe("getLastSessionId", () => {
    it("returns most recent session ID", () => {
      startSession("old-sess");
      startSession("new-sess");
      appendUserMessage("new-sess", "latest");

      const lastId = getLastSessionId();
      expect(lastId).toBe("new-sess");
    });

    it("returns null when no sessions exist", () => {
      // Clean sessions dir
      rmSync(sessionsDir, { recursive: true, force: true });
      mkdirSync(sessionsDir, { recursive: true });
      expect(getLastSessionId()).toBeNull();
    });
  });

  describe("migration and validation", () => {
    it("migrates a legacy JSON session file to JSONL", () => {
      const legacyPath = join(sessionsDir, "legacy.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          id: "legacy-session",
          title: "Legacy Chat",
          provider: "ollama",
          model: "qwen",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
          ],
        }),
        "utf-8",
      );

      const result = migrateLegacySessionFile(legacyPath);
      expect(result.migrated).toBe(true);
      expect(sessionExists("legacy-session")).toBe(true);
      expect(rebuildMessages("legacy-session")).toHaveLength(2);
    });

    it("marks a migrated summary as durable replay context", () => {
      const legacyPath = join(sessionsDir, "legacy-summary.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          id: "legacy-summary",
          summary: "retain this migration handoff",
          messages: [{ role: "user", content: "hello" }],
        }),
        "utf-8",
      );

      expect(migrateLegacySessionFile(legacyPath).migrated).toBe(true);
      const rebuilt = rebuildMessages("legacy-summary");
      const summary = rebuilt.find((message) =>
        String(message.content).startsWith("[Migrated Summary]"),
      );
      expect(getDurableSystemMessageProvenance(summary)).toBeNull();
      const verifiedSummary = readVerifiedMessages("legacy-summary").find(
        (message) => String(message.content).startsWith("[Migrated Summary]"),
      );
      expect(getDurableSystemMessageProvenance(verifiedSummary)).toMatchObject({
        kind: DURABLE_SYSTEM_MESSAGE_KINDS.MIGRATION_SUMMARY,
      });
      expect(JSON.stringify(summary)).not.toContain(
        SESSION_MESSAGE_PROVENANCE_FIELD,
      );
    });

    it("migrates a legacy session that contains system + tool messages", () => {
      // Regression: post-migration validation compared user/assistant messageCount
      // to the TOTAL legacy message count, so any session with a system prompt or
      // a tool message (which become system / tool_result events, not counted as
      // "messages") failed validation and was reported as a failed migration.
      const legacyPath = join(sessionsDir, "legacy-rich.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          id: "legacy-rich",
          messages: [
            { role: "system", content: "you are helpful" },
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
            { role: "tool", tool: "search", content: "result" },
          ],
        }),
        "utf-8",
      );

      const result = migrateLegacySessionFile(legacyPath);
      expect(result.migrated).toBe(true);
      expect(result.failed).toBeFalsy();
      // All four messages persisted (system_start + 4 message events).
      const validation = validateJsonlSession("legacy-rich");
      expect(validation.eventCount).toBe(5);
      expect(validation.malformedLines).toBe(0);
    });

    it("fails-fast on a legacy file whose own id is a traversal id (no escape)", () => {
      // The legacy payload names a traversal target; the file's basename is safe.
      const legacyPath = join(sessionsDir, "evil.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          id: "../../pwned",
          messages: [{ role: "user", content: "x" }],
        }),
        "utf-8",
      );
      const escaped = join(testDir, "..", "pwned.jsonl");

      const result = migrateLegacySessionFile(legacyPath, { force: true });
      expect(result.migrated).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.reason).toMatch(/unsafe session id/);
      expect(result.attempts).toBe(1); // failed fast, no retry waste
      expect(existsSync(escaped)).toBe(false); // nothing written outside the dir
    });

    it("validates JSONL session structure", () => {
      const id = startSession("validate-me");
      appendUserMessage(id, "hello");

      const result = validateJsonlSession(id);
      expect(result.valid).toBe(true);
      expect(result.eventCount).toBe(2);
      expect(result.messageCount).toBe(1);
    });

    it("builds a dry-run batch migration report", () => {
      writeFileSync(
        join(sessionsDir, "legacy-a.json"),
        JSON.stringify({
          id: "legacy-a",
          messages: [{ role: "user", content: "a" }],
        }),
        "utf-8",
      );
      writeFileSync(
        join(sessionsDir, "legacy-b.json"),
        JSON.stringify({
          id: "legacy-b",
          messages: [{ role: "assistant", content: "b" }],
        }),
        "utf-8",
      );

      const report = migrateLegacySessionsBatch(sessionsDir, { dryRun: true });
      expect(report.summary.scanned).toBe(2);
      expect(report.summary.migrated).toBe(2);
      expect(report.summary.dryRun).toBe(true);
    });

    it("samples migrated sessions for validation", () => {
      const file = join(sessionsDir, "legacy-sample.json");
      writeFileSync(
        file,
        JSON.stringify({
          id: "legacy-sample",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
          ],
        }),
        "utf-8",
      );

      const migrated = migrateLegacySessionFile(file);
      const sample = sampleMigratedSessionsValidation([migrated], {
        sampleSize: 1,
      });
      expect(sample).toHaveLength(1);
      expect(sample[0].valid).toBe(true);
      expect(sample[0].matchesExpectedMessages).toBe(true);
    });

    it("reports failed migration attempts when source JSON is invalid", () => {
      const brokenPath = join(sessionsDir, "broken.json");
      writeFileSync(brokenPath, "{not-json", "utf-8");

      const result = migrateLegacySessionFile(brokenPath, {
        retryFailures: true,
      });
      expect(result.failed).toBe(true);
      expect(result.attempts).toBeGreaterThan(1);
    });
  });

  // ── transcript hash chain (tamper-evidence) ───────────────────────
  describe("transcript hash chain", () => {
    it("appends chained records that verify end-to-end", () => {
      const id = startSession("chain-1", { title: "Chained" });
      appendUserMessage(id, "q1");
      appendAssistantMessage(id, "a1");
      appendToolCall(id, "read_file", { path: "x" });

      const events = readEvents(id);
      expect(events.every((e) => typeof e.hash === "string")).toBe(true);
      expect(events[0].prevHash).toBeNull();
      expect(events[1].prevHash).toBe(events[0].hash);

      const result = verifySession(id);
      expect(result.status).toBe("verified");
      expect(result.chainedEvents).toBe(4);
    });

    it("detects an edited transcript record", () => {
      const id = startSession("chain-tamper", { title: "T" });
      appendUserMessage(id, "original");
      appendAssistantMessage(id, "reply");

      const raw = readFileSync(sessionPath(id), "utf-8");
      writeFileSync(
        sessionPath(id),
        raw.replace("original", "REWRITTEN"),
        "utf-8",
      );

      const result = verifySession(id);
      expect(result.status).toBe("tampered");
      expect(result.firstInvalidLine).toBe(2);
    });

    it("detects a deleted transcript record", () => {
      const id = startSession("chain-delete", { title: "T" });
      appendUserMessage(id, "one");
      appendAssistantMessage(id, "two");

      const lines = readFileSync(sessionPath(id), "utf-8")
        .split("\n")
        .filter((l) => l.trim());
      lines.splice(1, 1);
      writeFileSync(sessionPath(id), lines.join("\n") + "\n", "utf-8");

      expect(verifySession(id).status).toBe("tampered");
    });

    it("classifies a pre-chaining transcript as legacy and a mixed one as partial", () => {
      const legacyId = "legacy-plain";
      writeFileSync(
        sessionPath(legacyId),
        [
          JSON.stringify({
            type: "session_start",
            timestamp: 1,
            data: { title: "Old" },
          }),
          JSON.stringify({
            type: "user_message",
            timestamp: 2,
            data: { role: "user", content: "hi" },
          }),
        ].join("\n") + "\n",
        "utf-8",
      );
      expect(verifySession(legacyId).status).toBe("legacy");

      // Appends onto a legacy file start a fresh chain → partial
      appendAssistantMessage(legacyId, "new reply");
      const result = verifySession(legacyId);
      expect(result.status).toBe("partial");
      expect(result.legacyEvents).toBe(2);
      expect(result.chainedEvents).toBe(1);
    });

    it("keeps the chain valid across forkSession", () => {
      const id = startSession("chain-fork", { title: "F" });
      appendUserMessage(id, "q");
      appendAssistantMessage(id, "a");

      const forkedId = forkSession(id);
      expect(verifySession(forkedId).status).toBe("verified");
      // fork marker chains onto the copied tail
      const events = readEvents(forkedId);
      expect(events[events.length - 1].prevHash).toBe(
        events[events.length - 2].hash,
      );
    });

    it("verifySession reports not-found / invalid-id without throwing", () => {
      expect(verifySession("no-such").status).toBe("not-found");
      expect(verifySession("../evil").status).toBe("invalid-id");
    });

    it("verifyAllSessions covers every transcript in the dir", () => {
      startSession("all-a");
      startSession("all-b");
      const results = verifyAllSessions();
      const ids = results.map((r) => r.sessionId);
      expect(ids).toContain("all-a");
      expect(ids).toContain("all-b");
      expect(results.every((r) => r.status === "verified")).toBe(true);
    });

    it("dry-runs then discards at most one crash-partial final record", () => {
      const id = startSession("chain-repair", { title: "Repair" });
      appendUserMessage(id, "kept");
      const partial = '{"type":"assistant_message","timestamp":';
      appendFileSync(sessionPath(id), partial, "utf8");

      expect(verifySession(id).truncatedTail).toBe(true);
      const beforeBytes = readFileSync(sessionPath(id));
      const plan = repairSession(id, { dryRun: true });
      expect(plan).toMatchObject({
        healthy: false,
        changed: true,
        wouldChange: true,
        action: "discard-partial-record",
        discardedBytes: Buffer.byteLength(partial),
        discardedRecords: 1,
      });
      expect(readFileSync(sessionPath(id))).toEqual(beforeBytes);

      const repaired = repairSession(id);
      expect(repaired).toMatchObject({
        healthy: true,
        changed: true,
        action: "discard-partial-record",
        discardedRecords: 1,
        status: "verified",
      });
      expect(verifySession(id)).toMatchObject({
        status: "verified",
        truncatedTail: false,
      });
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "user_message",
      ]);
    });

    it("normalizes a valid final record missing only its newline", () => {
      const id = startSession("chain-newline", { title: "N" });
      appendUserMessage(id, "last");
      const bytes = readFileSync(sessionPath(id));
      writeFileSync(sessionPath(id), bytes.subarray(0, bytes.length - 1));

      const repaired = repairSession(id);
      expect(repaired).toMatchObject({
        healthy: true,
        action: "normalize-newline",
        discardedBytes: 0,
        discardedRecords: 0,
      });
      expect(readFileSync(sessionPath(id), "utf8").endsWith("\n")).toBe(true);
    });

    it("rebuilds stale derived indexes after a complete record survives a crash", () => {
      const id = startSession("chain-index-crash", { title: "Before" });
      const previous = readEvents(id).at(-1).hash;
      const core = {
        type: "user_message",
        timestamp: Date.now(),
        data: { role: "user", content: "committed before crash" },
      };
      appendFileSync(
        sessionPath(id),
        `${JSON.stringify({
          ...core,
          prevHash: previous,
          hash: computeEventHash(previous, core),
        })}\n`,
        "utf8",
      );

      expect(() => readVerifiedEvents(id)).toThrow(
        expect.objectContaining({ code: "SESSION_TRANSCRIPT_UNVERIFIED" }),
      );
      expect(repairSession(id, { dryRun: true })).toMatchObject({
        healthy: false,
        changed: false,
        physicalChanged: false,
        wouldChange: true,
        action: "rebuild-index",
        physicalAction: "none",
        indexAction: "rebuild-index",
        indexRepairRequired: true,
      });
      expect(repairSession(id)).toMatchObject({
        healthy: true,
        changed: true,
        physicalChanged: false,
        indexChanged: true,
        indexRebuilt: true,
        indexAction: "rebuild-index",
      });
      expect(readVerifiedEvents(id)).toHaveLength(2);
      expect(getJsonlSessionMetadata(id)).toMatchObject({ message_count: 1 });
    });

    it("never rewrites interior hash-chain tampering or claims success", () => {
      const id = startSession("chain-repair-refuse", { title: "T" });
      appendUserMessage(id, "original");
      const raw = readFileSync(sessionPath(id), "utf8");
      writeFileSync(sessionPath(id), raw.replace("original", "tampered"));

      const before = readFileSync(sessionPath(id));
      const result = repairSession(id);
      expect(result).toMatchObject({
        changed: false,
        healthy: false,
        status: "tampered",
      });
      expect(result.reason).toMatch(/hash|content/i);
      expect(readFileSync(sessionPath(id))).toEqual(before);
    });

    it("auto-recovers one partial tail under the append lock", () => {
      const id = startSession("chain-auto-recover", { title: "R" });
      appendFileSync(sessionPath(id), "{crash", "utf8");
      const result = appendEvent(id, "user_message", {
        role: "user",
        content: "after",
      });
      expect(result.recovery).toMatchObject({
        action: "discard-partial-record",
        discardedRecords: 1,
      });
      expect(verifySession(id).status).toBe("verified");
      expect(readEvents(id).map((event) => event.type)).toEqual([
        "session_start",
        "user_message",
      ]);
    });

    it("self-heals the chain-tail cache when the file is deleted externally", () => {
      const id = startSession("chain-heal", { title: "H" });
      appendUserMessage(id, "q");
      rmSync(sessionPath(id), { force: true });
      // Re-create through the store — must restart at genesis, not chain onto
      // the deleted file's cached tail.
      appendUserMessage(id, "fresh");
      const result = verifySession(id);
      expect(result.status).toBe("verified");
      expect(readEvents(id)[0].prevHash).toBeNull();
    });
  });
});

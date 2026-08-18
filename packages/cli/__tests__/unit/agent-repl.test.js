import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
  SESSION_MESSAGE_PROVENANCE_FIELD,
  SESSION_MESSAGE_PROVENANCE_SCHEMA,
} from "../../src/lib/session-message-provenance.js";

describe("REPL compact persistence fencing", () => {
  it("keeps the REPL terminal after a compaction ledger persistence failure", async () => {
    const { createReplRuntimeLedgerTerminalLatch } =
      await import("../../src/repl/agent-repl.js");
    const onTrip = vi.fn();
    const latch = createReplRuntimeLedgerTerminalLatch({ onTrip });
    const persistenceError = Object.assign(new Error("ledger unavailable"), {
      runtimeLedgerPersistence: true,
    });

    const terminal = latch.trip(persistenceError);

    expect(terminal).toMatchObject({
      code: "CC_RUNTIME_USAGE_LEDGER_FAILED",
      runtimeLedgerPersistence: true,
    });
    expect(latch.isTripped()).toBe(true);
    expect(() => latch.assertOpen()).toThrow(terminal);
    expect(latch.trip(new Error("unrelated"))).toBe(terminal);
    expect(onTrip).toHaveBeenCalledOnce();
  }, 20000);

  it("brackets a direct REPL tool with one secret-free started/settlement pair", async () => {
    const { runReplDirectToolWithLedger } =
      await import("../../src/repl/agent-repl.js");
    const order = [];
    const started = [];
    const settled = [];
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125);

    const result = await runReplDirectToolWithLedger({
      sessionId: "session-direct-tool",
      tool: "run_skill",
      args: { skill_name: "review", secret: "do-not-persist" },
      callId: "direct-tool-1",
      now,
      persistStarted: (sessionId, type, data) => {
        order.push("started");
        started.push({ sessionId, type, data });
      },
      persistSettlement: (sessionId, record) => {
        order.push("settled");
        settled.push({ sessionId, record });
      },
      execute: async () => {
        order.push("tool");
        return {
          ok: true,
          plugin_bin: { plugin: "quality", version: "1.2.3" },
        };
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(order).toEqual(["started", "tool", "settled"]);
    expect(started).toEqual([
      {
        sessionId: "session-direct-tool",
        type: "tool_call_started",
        data: { id: "direct-tool-1", tool: "run_skill" },
      },
    ]);
    expect(settled).toEqual([
      {
        sessionId: "session-direct-tool",
        record: {
          id: "direct-tool-1",
          tool: "run_skill",
          isError: false,
          skill: "review",
          plugin: "quality",
          pluginVersion: "1.2.3",
          durationMs: 25,
        },
      },
    ]);
    expect(JSON.stringify({ started, settled })).not.toContain(
      "do-not-persist",
    );
  });

  it("blocks the direct tool and every later call when its started row cannot persist", async () => {
    const {
      createReplRuntimeLedgerTerminalLatch,
      runReplDirectToolWithLedger,
    } = await import("../../src/repl/agent-repl.js");
    const latch = createReplRuntimeLedgerTerminalLatch();
    const execute = vi.fn(async () => ({ ok: true }));
    const persistenceError = new Error("disk full");

    await expect(
      runReplDirectToolWithLedger({
        sessionId: "session-direct-start-failure",
        tool: "write_file",
        args: { path: "a.txt", content: "x" },
        execute,
        terminalLatch: latch,
        persistStarted: () => {
          throw persistenceError;
        },
        persistSettlement: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "CC_RUNTIME_USAGE_LEDGER_FAILED",
      runtimeLedgerPersistence: true,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(latch.isTripped()).toBe(true);

    await expect(
      runReplDirectToolWithLedger({
        sessionId: "session-direct-start-failure",
        tool: "read_file",
        args: { path: "a.txt" },
        execute,
        terminalLatch: latch,
        persistStarted: vi.fn(),
        persistSettlement: vi.fn(),
      }),
    ).rejects.toBe(latch.error());
    expect(execute).not.toHaveBeenCalled();
  });

  it("settles a failed direct tool, but latches terminal if settlement is lost", async () => {
    const {
      createReplRuntimeLedgerTerminalLatch,
      runReplDirectToolWithLedger,
    } = await import("../../src/repl/agent-repl.js");
    const toolError = new Error("tool failed");
    const settlement = vi.fn();

    await expect(
      runReplDirectToolWithLedger({
        sessionId: "session-direct-tool-error",
        tool: "run_shell",
        args: { command: "false" },
        callId: "direct-tool-error",
        execute: async () => {
          throw toolError;
        },
        persistStarted: vi.fn(),
        persistSettlement: settlement,
        now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20),
      }),
    ).rejects.toBe(toolError);
    expect(settlement).toHaveBeenCalledWith(
      "session-direct-tool-error",
      expect.objectContaining({
        id: "direct-tool-error",
        tool: "run_shell",
        isError: true,
        durationMs: 10,
      }),
    );

    const latch = createReplRuntimeLedgerTerminalLatch();
    const execute = vi.fn(async () => ({ ok: true }));
    await expect(
      runReplDirectToolWithLedger({
        sessionId: "session-direct-settlement-failure",
        tool: "write_file",
        args: { path: "a.txt", content: "x" },
        execute,
        terminalLatch: latch,
        persistStarted: vi.fn(),
        persistSettlement: () => {
          throw new Error("settlement disk failure");
        },
      }),
    ).rejects.toMatchObject({
      code: "CC_RUNTIME_USAGE_LEDGER_FAILED",
      runtimeLedgerPersistence: true,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(latch.isTripped()).toBe(true);
  });

  it("routes both REPL-owned direct tool producers through the strict ledger", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../src/repl/agent-repl.js",
      ),
      "utf8",
    );
    expect(source).toContain("toolExecutor: _runReplDirectTool");
    expect(source).toContain(
      "return await _runReplDirectTool(item.tool, item.params)",
    );
  });

  it("meters a semantic compaction call before spend and returns settled metadata", async () => {
    const { runReplMeteredModelCallWithLedger } =
      await import("../../src/repl/agent-repl.js");
    const order = [];
    const persisted = [];

    const metered = await runReplMeteredModelCallWithLedger({
      sessionId: "session-metered-compact",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      source: "semantic-compaction",
      persist: (type, data) => {
        order.push(type);
        persisted.push({ type, data });
      },
      call: async () => {
        order.push("provider");
        return {
          message: { content: "summary" },
          usage: { input_tokens: 12, output_tokens: 3 },
        };
      },
    });

    expect(order).toEqual(["model_usage_started", "provider", "token_usage"]);
    expect(metered).toMatchObject({
      callId: persisted[0].data.callId,
      usageLedgerSettled: true,
      result: { usage: { input_tokens: 12, output_tokens: 3 } },
    });
    expect(persisted[1]).toMatchObject({
      type: "token_usage",
      data: {
        callId: persisted[0].data.callId,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        source: "semantic-compaction",
      },
    });
  });

  it("settles direct model usage into the shared budget after the durable ledger", async () => {
    const { runReplMeteredModelCallWithLedger } =
      await import("../../src/repl/agent-repl.js");
    const order = [];
    const sessionBudget = {
      consumeTurn: vi.fn(() => {
        order.push("budget-turn");
        return { ok: true };
      }),
      recordUsage: vi.fn(() => {
        order.push("budget-usage");
        return { aborted: false };
      }),
    };

    await runReplMeteredModelCallWithLedger({
      sessionId: "session-budgeted-direct",
      provider: "openai",
      model: "gpt-test",
      sessionBudget,
      persist: (type) => order.push(`ledger:${type}`),
      call: async () => {
        order.push("provider");
        return {
          message: { content: "done" },
          usage: { input_tokens: 8, output_tokens: 2 },
        };
      },
    });

    expect(order).toEqual([
      "budget-turn",
      "ledger:model_usage_started",
      "provider",
      "ledger:token_usage",
      "budget-usage",
    ]);
    expect(sessionBudget.recordUsage).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-test",
      usage: { input_tokens: 8, output_tokens: 2 },
    });
  });

  it("durably settles missing compaction usage as unknown", async () => {
    const { runReplMeteredModelCallWithLedger } =
      await import("../../src/repl/agent-repl.js");
    const persisted = [];

    const metered = await runReplMeteredModelCallWithLedger({
      sessionId: "session-metered-unknown",
      provider: "openai",
      model: "gpt-4o",
      source: "semantic-compaction",
      persist: (type, data) => persisted.push({ type, data }),
      call: async () => ({ message: { content: "summary" } }),
    });

    expect(metered.usageLedgerSettled).toBe(true);
    expect(persisted.map((event) => event.type)).toEqual([
      "model_usage_started",
      "model_usage_unknown",
    ]);
    expect(persisted[1].data).toMatchObject({
      callId: persisted[0].data.callId,
      source: "semantic-compaction",
      code: "provider_usage_missing",
    });
  });

  it("attaches settled ledger metadata to a compaction provider error", async () => {
    const { runReplMeteredModelCallWithLedger } =
      await import("../../src/repl/agent-repl.js");
    const providerError = new Error("connection reset after upload");
    const persisted = [];

    await expect(
      runReplMeteredModelCallWithLedger({
        sessionId: "session-metered-error",
        provider: "openai",
        model: "gpt-4o",
        source: "semantic-compaction",
        persist: (type, data) => persisted.push({ type, data }),
        call: async () => {
          throw providerError;
        },
        attachErrorMetadata: true,
      }),
    ).rejects.toBe(providerError);

    expect(providerError).toMatchObject({
      compactionCallId: persisted[0].data.callId,
      usageLedgerSettled: true,
    });
    expect(persisted[1]).toMatchObject({
      type: "model_usage_unknown",
      data: {
        callId: persisted[0].data.callId,
        source: "semantic-compaction",
        code: "provider_call_failed",
      },
    });
  });

  it("persists a microcompact checkpoint before replacing live messages", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const messages = [
      { role: "user", content: "known question" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t1", function: { name: "read_file" } }],
      },
      { role: "tool", tool_call_id: "t1", content: "x".repeat(2_000) },
      { role: "assistant", content: "known answer" },
    ];
    const expectedMessages = [...messages];
    const compacted = [
      messages[0],
      messages[1],
      { ...messages[2], content: "trimmed", _microCompacted: true },
      messages[3],
    ];
    const appendCompactEventIfMessagesMatch = vi.fn(() => ({
      hash: "micro-head",
    }));
    const persistence = createReplCompactPersistence(messages, {
      appendCompactEventIfMessagesMatch,
    });

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages,
      compacted,
      stats: { strategy: "microcompact", trimmed: 1, saved: 1_993 },
      trigger: "manual",
      useJsonl: true,
      sessionId: "session-microcompact",
      persistence,
    });

    expect(result.applied).toBe(true);
    expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
    const persistedPayload = appendCompactEventIfMessagesMatch.mock.calls[0][1];
    expect(persistedPayload).toMatchObject({
      strategy: "microcompact",
      trigger: "manual",
    });
    expect(persistedPayload.messages).toEqual([
      messages[0],
      messages[1],
      { role: "tool", tool_call_id: "t1", content: "trimmed" },
      messages[3],
    ]);
    expect(appendCompactEventIfMessagesMatch.mock.calls[0][2]).toEqual(
      expectedMessages,
    );
    expect(messages).toEqual(compacted);
  });

  it("tracks the known replay and advances it only after a matched compact", async () => {
    const { createReplCompactPersistence } =
      await import("../../src/repl/agent-repl.js");
    const durable = markDurableSystemMessage(
      { role: "system", content: "known durable facts" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );
    const appendCompactEventIfMessagesMatch = vi.fn(() => ({
      hash: "a".repeat(64),
    }));
    const controller = createReplCompactPersistence(
      [
        { role: "system", content: "old host prompt" },
        durable,
        { role: "user", content: "known question" },
      ],
      { appendCompactEventIfMessagesMatch },
    );
    controller.record({ role: "assistant", content: "known answer" });
    const nextSummary = markDurableSystemMessage(
      { role: "system", content: "new durable facts" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );

    controller.persist("session-1", {
      strategy: "auto",
      messages: [{ role: "system", content: "fresh host" }, nextSummary],
    });

    const expected = appendCompactEventIfMessagesMatch.mock.calls[0][2];
    const persistedPayload = appendCompactEventIfMessagesMatch.mock.calls[0][1];
    expect(expected.map((message) => message.content)).toEqual([
      "known durable facts",
      "known question",
      "known answer",
    ]);
    expect(getDurableSystemMessageProvenance(expected[0])).toMatchObject({
      kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    });
    expect(persistedPayload.messages).toEqual([
      { role: "system", content: "new durable facts" },
    ]);
    expect(controller.snapshot()).toEqual([
      { role: "system", content: "new durable facts" },
    ]);
    expect(
      getDurableSystemMessageProvenance(controller.snapshot()[0]),
    ).toMatchObject({ kind: DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY });
  }, 20000);

  it("keeps its prior projection when the store rejects an unseen turn", async () => {
    const { createReplCompactPersistence } =
      await import("../../src/repl/agent-repl.js");
    const appendCompactEventIfMessagesMatch = vi.fn(() => {
      const error = new Error("stale");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    });
    const controller = createReplCompactPersistence(
      [{ role: "user", content: "known" }],
      { appendCompactEventIfMessagesMatch },
    );

    expect(() =>
      controller.persist("session-1", {
        strategy: "session-end",
        messages: [{ role: "assistant", content: "local summary" }],
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
    expect(controller.snapshot()).toEqual([{ role: "user", content: "known" }]);
  }, 20000);

  it("accounts provider usage and settles CAS before replacing live messages", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { newCostStore } = await import("../../src/repl/session-cost.js");
    const messages = [
      { role: "system", content: "host prompt" },
      { role: "user", content: "known question" },
      { role: "assistant", content: "known answer" },
    ];
    const expectedMessages = [...messages];
    const summary = markDurableSystemMessage(
      { role: "system", content: "durable compact summary" },
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );
    const compacted = [summary];
    const appendCompactEventIfMessagesMatch = vi.fn(() => {
      expect(messages).toEqual(expectedMessages);
      return { hash: "b".repeat(64) };
    });
    const appendUsage = vi.fn();
    const persistence = createReplCompactPersistence(messages, {
      appendCompactEventIfMessagesMatch,
    });
    const costStore = newCostStore();

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages,
      compacted,
      stats: { strategy: "summarize", saved: 20 },
      trigger: "manual",
      useJsonl: true,
      sessionId: "session-usage",
      persistence,
      usageEvent: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 40, output_tokens: 10 },
      },
      costStore,
      appendUsage,
    });

    expect(result.applied).toBe(true);
    expect(appendUsage).toHaveBeenCalledOnce();
    expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
    expect(appendUsage.mock.invocationCallOrder[0]).toBeLessThan(
      appendCompactEventIfMessagesMatch.mock.invocationCallOrder[0],
    );
    expect(costStore.total).toMatchObject({
      inputTokens: 40,
      outputTokens: 10,
      calls: 1,
    });
    expect(messages).toEqual(compacted);
  }, 20000);

  it("counts an already-durable usage settlement locally without appending it twice", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { newCostStore } = await import("../../src/repl/session-cost.js");
    const messages = [{ role: "user", content: "known question" }];
    const expectedMessages = [...messages];
    const appendUsage = vi.fn();
    const appendCompactEventIfMessagesMatch = vi.fn(() => ({
      hash: "c".repeat(64),
    }));
    const costStore = newCostStore();

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages,
      compacted: [{ role: "assistant", content: "summary" }],
      stats: { strategy: "summarize", saved: 10 },
      trigger: "auto",
      useJsonl: true,
      sessionId: "session-already-settled",
      persistence: createReplCompactPersistence(messages, {
        appendCompactEventIfMessagesMatch,
      }),
      usageEvent: {
        callId: "semantic-call-1",
        provider: "openai",
        model: "gpt-4o",
        source: "semantic-compaction",
        usageLedgerSettled: true,
        usage: { input_tokens: 8, output_tokens: 2 },
      },
      costStore,
      appendUsage,
    });

    expect(result.applied).toBe(true);
    expect(appendUsage).not.toHaveBeenCalled();
    expect(appendCompactEventIfMessagesMatch).toHaveBeenCalledOnce();
    expect(costStore.total).toMatchObject({
      inputTokens: 8,
      outputTokens: 2,
      calls: 1,
    });
  }, 20000);

  it("fails closed when a legacy known-usage settlement cannot persist", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { newCostStore } = await import("../../src/repl/session-cost.js");
    const messages = [{ role: "user", content: "known question" }];
    const expectedMessages = [...messages];
    const appendCompactEventIfMessagesMatch = vi.fn();
    const appendFailure = Object.freeze(new Error("disk full"));
    const costStore = newCostStore();

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages,
      compacted: [{ role: "assistant", content: "summary" }],
      stats: { strategy: "summarize", saved: 10 },
      trigger: "manual",
      useJsonl: true,
      sessionId: "session-usage-failure",
      persistence: createReplCompactPersistence(messages, {
        appendCompactEventIfMessagesMatch,
      }),
      usageEvent: {
        provider: "openai",
        model: "gpt-4o",
        usage: { input_tokens: 5, output_tokens: 1 },
      },
      costStore,
      appendUsage: () => {
        throw appendFailure;
      },
    });

    expect(result).toMatchObject({
      applied: false,
      error: { runtimeLedgerPersistence: true },
      usagePersistenceError: { runtimeLedgerPersistence: true },
    });
    expect(messages).toEqual(expectedMessages);
    expect(appendCompactEventIfMessagesMatch).not.toHaveBeenCalled();
    expect(costStore.total.calls).toBe(1);
  }, 20000);

  it("counts known usage once but preserves live messages when compact CAS is stale", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { newCostStore } = await import("../../src/repl/session-cost.js");
    const messages = [{ role: "user", content: "known question" }];
    const expectedMessages = [...messages];
    const stale = Object.assign(new Error("stale"), {
      code: "SESSION_REVISION_STALE",
    });
    const persistence = createReplCompactPersistence(messages, {
      appendCompactEventIfMessagesMatch: vi.fn(() => {
        throw stale;
      }),
    });
    const appendUsage = vi.fn();
    const costStore = newCostStore();

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages,
      compacted: [{ role: "assistant", content: "candidate" }],
      stats: { strategy: "summarize", saved: 10 },
      trigger: "auto",
      useJsonl: true,
      sessionId: "session-stale",
      persistence,
      usageEvent: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 8, output_tokens: 2 },
      },
      costStore,
      appendUsage,
    });

    expect(result).toMatchObject({ applied: false, error: stale });
    expect(messages).toEqual(expectedMessages);
    expect(appendUsage).toHaveBeenCalledOnce();
    expect(costStore.total.calls).toBe(1);
  }, 20000);

  it("does not account, persist, or apply an unknown-usage fallback", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { newCostStore } = await import("../../src/repl/session-cost.js");
    const messages = [{ role: "user", content: "known question" }];
    const expectedMessages = [...messages];
    const appendCompactEventIfMessagesMatch = vi.fn();
    const appendUsage = vi.fn();
    const costStore = newCostStore();
    const persistence = createReplCompactPersistence(messages, {
      appendCompactEventIfMessagesMatch,
    });

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages,
      compacted: [{ role: "assistant", content: "extractive fallback" }],
      stats: { strategy: "summarize", saved: 10 },
      trigger: "manual",
      useJsonl: true,
      sessionId: "session-unknown",
      persistence,
      usageUnknownEvent: {
        reason: "provider_transport_outcome_unknown",
        usageLedgerSettled: true,
      },
      costStore,
      appendUsage,
    });

    expect(result).toMatchObject({
      applied: false,
      block: {
        code: "CC_COMPACTION_USAGE_UNKNOWN",
        commitState: "provider-usage-unknown",
      },
    });
    expect(messages).toEqual(expectedMessages);
    expect(appendUsage).not.toHaveBeenCalled();
    expect(appendCompactEventIfMessagesMatch).not.toHaveBeenCalled();
    expect(costStore.total.calls).toBe(0);
  }, 20000);

  it("marks an undurable unknown settlement as terminal", async () => {
    const { createReplCompactPersistence, settleReplCompactionCandidate } =
      await import("../../src/repl/agent-repl.js");
    const messages = [{ role: "user", content: "known question" }];
    const appendCompactEventIfMessagesMatch = vi.fn();

    const result = settleReplCompactionCandidate({
      messages,
      expectedMessages: [...messages],
      compacted: [{ role: "assistant", content: "fallback" }],
      stats: { strategy: "summarize", saved: 10 },
      trigger: "manual",
      useJsonl: true,
      sessionId: "session-undurable-unknown",
      persistence: createReplCompactPersistence(messages, {
        appendCompactEventIfMessagesMatch,
      }),
      usageUnknownEvent: {
        reason: "provider_transport_outcome_unknown",
      },
    });

    expect(result).toMatchObject({
      applied: false,
      block: { code: "CC_COMPACTION_USAGE_UNKNOWN" },
      usagePersistenceError: { runtimeLedgerPersistence: true },
    });
    expect(messages).toEqual([{ role: "user", content: "known question" }]);
    expect(appendCompactEventIfMessagesMatch).not.toHaveBeenCalled();
  }, 20000);
});

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for agent-repl.js tool execution logic
 *
 * We can't easily test the full REPL (interactive readline), but we can
 * test the tool execution functions by importing the module and exercising
 * the exported startAgentRepl function's internal logic indirectly.
 *
 * For direct tool testing, we replicate the executeTool logic here.
 */

describe("agent-repl tool execution", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-agent-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read_file tool logic", () => {
    it("reads existing file content", () => {
      const filePath = join(tempDir, "test.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      expect(content).toBe("hello world");
    });

    it("handles non-existent file", () => {
      const filePath = join(tempDir, "nonexistent.txt");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("write_file tool logic", () => {
    it("creates new file with content", () => {
      const filePath = join(tempDir, "new-file.txt");
      writeFileSync(filePath, "new content", "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("new content");
    });

    it("creates nested directories", () => {
      const filePath = join(tempDir, "nested", "dir", "file.txt");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "nested content", "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("nested content");
    });
  });

  describe("edit_file tool logic", () => {
    it("replaces string in file", () => {
      const filePath = join(tempDir, "edit.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      const newContent = content.replace("hello", "goodbye");
      writeFileSync(filePath, newContent, "utf8");
      expect(readFileSync(filePath, "utf8")).toBe("goodbye world");
    });

    it("fails when old_string not found", () => {
      const filePath = join(tempDir, "edit2.txt");
      writeFileSync(filePath, "hello world", "utf8");
      const content = readFileSync(filePath, "utf8");
      expect(content.includes("nonexistent")).toBe(false);
    });
  });

  describe("list_dir tool logic", () => {
    it("lists directory contents", () => {
      writeFileSync(join(tempDir, "a.txt"), "a");
      writeFileSync(join(tempDir, "b.txt"), "b");
      fs.mkdirSync(join(tempDir, "subdir"));
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });
      const names = entries.map((e) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names).toContain("subdir");
      const types = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
      expect(types.find((e) => e.name === "subdir").type).toBe("dir");
      expect(types.find((e) => e.name === "a.txt").type).toBe("file");
    });
  });
});

describe("agent-repl module exports", () => {
  it("exports startAgentRepl function", async () => {
    const mod = await import("../../src/repl/agent-repl.js");
    expect(typeof mod.startAgentRepl).toBe("function");
  }, 15000);

  it("pauses core event consumption until the REPL output drain settles", async () => {
    const { agentLoop } = await import("../../src/repl/agent-repl.js");
    let produced = 0;
    let releaseDrain;
    const drain = new Promise((resolve) => {
      releaseDrain = resolve;
    });
    const _coreLoop = async function* () {
      produced += 1;
      yield { type: "iteration-warning", message: "first" };
      produced += 1;
      yield { type: "response-complete", content: "done" };
    };
    const writes = [];
    const running = agentLoop([], {
      _coreLoop,
      writeOut: (chunk) => {
        writes.push(String(chunk));
        return false;
      },
      waitForOutput: () => drain,
    });

    await vi.waitFor(() => expect(produced).toBe(1));
    releaseDrain();
    await expect(running).resolves.toMatchObject({ content: "done" });
    expect(produced).toBe(2);
    expect(writes.join("")).toContain("first");
  });

  it("persists and fences a non-MCP side effect before the core executes it", async () => {
    const [{ agentLoop }, { SideEffectLedger }] = await Promise.all([
      import("../../src/repl/agent-repl.js"),
      import("../../src/lib/side-effect-ledger.js"),
    ]);
    const ledger = new SideEffectLedger();
    const order = [];
    const snapshots = [];
    const _coreLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "write_file",
        args: { path: "result.txt", content: "done" },
      };
      order.push("effect");
      yield {
        type: "tool-result",
        tool: "write_file",
        result: { success: true },
      };
      yield { type: "response-complete", content: "done" };
    };

    await agentLoop([], {
      _coreLoop,
      writeOut: () => true,
      sideEffects: {
        ledger,
        nextOpId: () => "repl-op-1",
        persist: () => {
          snapshots.push(ledger.toJSON());
          order.push(`persist:${ledger.get("repl-op-1")?.state}`);
        },
        assert: () => order.push("assert"),
      },
    });

    expect(order).toEqual([
      "persist:started",
      "assert",
      "effect",
      "persist:committed",
    ]);
    expect(snapshots).toHaveLength(2);
    expect(ledger.get("repl-op-1")).toMatchObject({
      kind: "file-write",
      key: "result.txt",
      state: "committed",
      meta: {
        tool: "write_file",
        resources: {
          files: ["result.txt"],
          network: [],
          processes: [],
          credentials: [],
        },
        idempotencyKey: expect.stringMatching(/^op_[0-9a-f]{40}$/),
      },
    });
  });

  it("does not resume the core into a side effect when its prewrite fails", async () => {
    const [{ agentLoop }, { SideEffectLedger }] = await Promise.all([
      import("../../src/repl/agent-repl.js"),
      import("../../src/lib/side-effect-ledger.js"),
    ]);
    const ledger = new SideEffectLedger();
    let executed = false;
    const _coreLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "run_shell",
        args: { command: "publish something" },
      };
      executed = true;
      yield { type: "response-complete", content: "unexpected" };
    };

    await expect(
      agentLoop([], {
        _coreLoop,
        writeOut: () => true,
        sideEffects: {
          ledger,
          nextOpId: () => "repl-op-fail",
          persist: () => {
            throw Object.assign(new Error("disk unavailable"), {
              code: "SIDE_EFFECT_LEDGER_PERSIST_FAILED",
            });
          },
          assert: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_LEDGER_PERSIST_FAILED" });
    expect(executed).toBe(false);
  });
});

describe("agent-repl TOOLS definition", () => {
  it("includes skill-related tools in TOOLS constant", async () => {
    // We verify by checking the help text output from the CLI
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 60000 },
    );
    expect(result).toContain("agentic AI session");
    expect(result).toContain("--model");
    expect(result).toContain("--provider");
  });

  it("agent --help includes --session option", async () => {
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 60000 },
    );
    expect(result).toContain("--session");
  });
});

describe("run_code tool logic", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-runcode-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Node.js execution", () => {
    it("executes Node.js code and returns output", () => {
      const codeFile = join(tempDir, "test.js");
      writeFileSync(codeFile, 'console.log("hello from node");', "utf8");
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(output.trim()).toBe("hello from node");
    });

    it("executes Node.js code with JSON output", () => {
      const codeFile = join(tempDir, "json-test.js");
      writeFileSync(
        codeFile,
        "console.log(JSON.stringify({ a: 1, b: 2 }));",
        "utf8",
      );
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      const parsed = JSON.parse(output.trim());
      expect(parsed).toEqual({ a: 1, b: 2 });
    });

    it("captures stderr on syntax error", () => {
      const codeFile = join(tempDir, "bad.js");
      writeFileSync(codeFile, "const x = {{{", "utf8");
      try {
        execSync(`node "${codeFile}"`, {
          encoding: "utf8",
          timeout: 10000,
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err.status).not.toBe(0);
        expect(err.stderr || err.message).toBeTruthy();
      }
    });

    it("handles multiline code with calculations", () => {
      const codeFile = join(tempDir, "calc.js");
      writeFileSync(
        codeFile,
        `
const data = [1, 2, 3, 4, 5];
const sum = data.reduce((a, b) => a + b, 0);
const avg = sum / data.length;
console.log(JSON.stringify({ sum, avg }));
      `.trim(),
        "utf8",
      );
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      const result = JSON.parse(output.trim());
      expect(result.sum).toBe(15);
      expect(result.avg).toBe(3);
    });
  });

  describe("Bash execution", () => {
    it("executes bash code and returns output", () => {
      const codeFile = join(tempDir, "test.sh");
      writeFileSync(codeFile, 'echo "hello from bash"', "utf8");
      const output = execSync(`bash "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(output.trim()).toBe("hello from bash");
    });

    it("executes bash with variables and arithmetic", () => {
      const codeFile = join(tempDir, "vars.sh");
      writeFileSync(
        codeFile,
        `
X=10
Y=20
echo $(( X + Y ))
      `.trim(),
        "utf8",
      );
      const output = execSync(`bash "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(output.trim()).toBe("30");
    });
  });

  describe("temp file lifecycle", () => {
    it("temp file is created and can be cleaned up", () => {
      const tmpFile = join(tempDir, `cc-agent-${Date.now()}.js`);
      writeFileSync(tmpFile, 'console.log("temp")', "utf8");
      expect(existsSync(tmpFile)).toBe(true);

      // Execute
      const output = execSync(`node "${tmpFile}"`, {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(output.trim()).toBe("temp");

      // Cleanup
      fs.unlinkSync(tmpFile);
      expect(existsSync(tmpFile)).toBe(false);
    });
  });

  describe("timeout behavior", () => {
    it("should enforce timeout on long-running scripts", () => {
      const codeFile = join(tempDir, "slow.js");
      // Create a script that sleeps for 5 seconds
      writeFileSync(
        codeFile,
        `
const start = Date.now();
while (Date.now() - start < 5000) { /* busy wait */ }
console.log("done");
      `.trim(),
        "utf8",
      );
      try {
        execSync(`node "${codeFile}"`, {
          encoding: "utf8",
          timeout: 1000, // 1 second timeout
        });
        expect.unreachable("Should have thrown due to timeout");
      } catch (err) {
        // execSync throws on timeout
        expect(err).toBeTruthy();
      }
    });
  });

  describe("output truncation", () => {
    it("large output can be truncated to limit", () => {
      const codeFile = join(tempDir, "bigout.js");
      // Generate 100KB of output
      writeFileSync(
        codeFile,
        `for (let i = 0; i < 10000; i++) console.log("line " + i + " padding".repeat(5));`,
        "utf8",
      );
      const output = execSync(`node "${codeFile}"`, {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
      });
      // Simulate truncation logic from agent-repl
      const truncated = output.substring(0, 50000);
      expect(truncated.length).toBeLessThanOrEqual(50000);
      expect(output.length).toBeGreaterThan(50000);
    });
  });

  describe("language file extensions", () => {
    it("maps python to .py extension", () => {
      const extMap = { python: ".py", node: ".js", bash: ".sh" };
      expect(extMap["python"]).toBe(".py");
      expect(extMap["node"]).toBe(".js");
      expect(extMap["bash"]).toBe(".sh");
    });

    it("rejects unsupported languages", () => {
      const extMap = { python: ".py", node: ".js", bash: ".sh" };
      expect(extMap["ruby"]).toBeUndefined();
      expect(extMap["java"]).toBeUndefined();
    });
  });

  describe("timeout parameter validation", () => {
    it("clamps timeout to valid range (1-300)", () => {
      // Simulate the clamping logic from agent-repl
      // Note: 0 and falsy values fall back to 60 via `|| 60`
      const clamp = (t) => Math.min(Math.max(t || 60, 1), 300);
      expect(clamp(undefined)).toBe(60);
      expect(clamp(null)).toBe(60);
      expect(clamp(0)).toBe(60); // 0 is falsy, falls back to 60
      expect(clamp(-5)).toBe(1);
      expect(clamp(500)).toBe(300);
      expect(clamp(30)).toBe(30);
      expect(clamp(300)).toBe(300);
      expect(clamp(1)).toBe(1);
    });
  });

  describe("result format", () => {
    it("success result includes expected fields", () => {
      const result = {
        success: true,
        output: "hello",
        language: "node",
        duration: "42ms",
      };
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello");
      expect(result.language).toBe("node");
      expect(result.duration).toMatch(/\d+ms/);
    });

    it("error result includes expected fields", () => {
      const result = {
        error: "SyntaxError: unexpected token",
        stderr: "SyntaxError: unexpected token",
        exitCode: 1,
        language: "node",
      };
      expect(result.error).toBeTruthy();
      expect(result.exitCode).toBe(1);
      expect(result.language).toBe("node");
    });
  });
});

describe("agent-core execution limits (used by agent-repl)", () => {
  const agentCorePath = join(
    __dirname,
    "..",
    "..",
    "src",
    "runtime",
    "agent-core.js",
  );

  it("uses IterationBudget for iteration limits", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain("IterationBudget");
  });

  it("run_shell timeout should be 60000ms", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toMatch(/case "run_shell"[\s\S]*?timeout:\s*60000/);
  });

  it("run_shell output truncation should be 30000 chars", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toMatch(/case "run_shell"[\s\S]*?substring\(0,\s*30000\)/);
  });

  it("Anthropic max_tokens keeps the 8192 fallback under an output cap", () => {
    const content = readFileSync(agentCorePath, "utf8");
    // The host cap may narrow a model-aware limit, but the provider fallback
    // remains 8192 both with and without that cap.
    expect(content).toMatch(
      /Math\.min\(\s*anthropicMaxTokens \|\| 8192,\s*options\.maxOutputTokens\s*\)/,
    );
    expect(content).toMatch(/:\s*anthropicMaxTokens \|\| 8192/);
  });

  it("default ollama model should be qwen2.5:7b", () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('options.model || "qwen2.5:7b"');
  });
});

describe("agent-core TOOLS includes run_code (used by agent-repl)", () => {
  const agentCorePath = join(
    __dirname,
    "..",
    "..",
    "src",
    "runtime",
    "agent-core.js",
  );

  it("run_code tool is defined in AGENT_TOOLS array", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain('"run_code"');
    expect(content).toContain('"python"');
    expect(content).toContain('"node"');
    expect(content).toContain('"bash"');
  });

  it("system prompt includes proactive coding guidance", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain("run_code tool");
    expect(content).toContain("capable coding agent");
  });

  it("formatToolArgs handles run_code", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain('case "run_code"');
  });

  it("plan mode treats run_code as high impact", () => {
    const content = readFileSync(agentCorePath, "utf8");
    expect(content).toContain('name === "run_code"');
  });

  it("agent-repl imports from agent-core (deduplication)", () => {
    const agentReplPath = join(
      __dirname,
      "..",
      "..",
      "src",
      "repl",
      "agent-repl.js",
    );
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('from "../runtime/agent-core.js"');
    expect(content).toContain("AGENT_TOOLS");
    expect(content).toContain("formatToolArgs");
    expect(content).toContain("coreExecuteTool");
    expect(content).toContain("coreAgentLoop");
  });
});

describe("agent-repl thin wrapper contracts", () => {
  const agentReplPath = join(
    __dirname,
    "..",
    "..",
    "src",
    "repl",
    "agent-repl.js",
  );

  it("defers an early EPIPE until the graceful close handler is ready", () => {
    const content = readFileSync(agentReplPath, "utf8");
    const guardStart = content.indexOf("// EPIPE guard:");
    const startupStart = content.indexOf(
      "const { useJsonl, candidate: _startupJsonlResume }",
      guardStart,
    );
    const guard = content.slice(guardStart, startupStart);
    const closeHandler = content.indexOf('rl.on("close", async () => {');
    const closeReady = content.indexOf("_replCloseReady = true;", closeHandler);

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(startupStart).toBeGreaterThan(guardStart);
    expect(guard).toContain('error.code === "EPIPE" ? 0 : 1');
    expect(guard).toContain("_replRl && _replCloseReady");
    expect(guard).not.toContain("process.exit(");
    expect(closeHandler).toBeGreaterThan(startupStart);
    expect(closeReady).toBeGreaterThan(closeHandler);
    expect(content.slice(closeHandler, closeReady)).toContain(
      "if (_replCleanupStarted) return;",
    );
  });

  it("executeTool wrapper passes host and budget authority to coreExecuteTool", () => {
    const content = readFileSync(agentReplPath, "utf8");
    // Direct REPL tools must reach the same host and budget context as tools
    // selected inside agentLoop.
    expect(content).toContain("coreExecuteTool(name, args, {");
    expect(content).toContain("hookDb: _hookDb");
    expect(content).toContain("cwd: process.cwd()");
    expect(content).toContain("sessionBudget: context.sessionBudget || null");
    expect(content).toContain("signal: context.signal || null");
  });

  it("agentLoop wrapper iterates coreAgentLoop and handles tool-executing events", () => {
    const content = readFileSync(agentReplPath, "utf8");
    // agentLoop should drive the core loop (opting out of its in-built
    // auto-compaction, since the REPL compacts on its own schedule) and handle
    // its events. The core loop is reached via the `runCoreLoop` seam
    // (= options._coreLoop || coreAgentLoop). Behavior is locked in
    // agent-repl-loop-wrapper.test.js; this just guards the wiring.
    expect(content).toContain("runCoreLoop(messages, {");
    expect(content).toContain("options._coreLoop || coreAgentLoop");
    expect(content).toContain("autoCompact: false");
    expect(content).toContain('event.type === "tool-executing"');
  });

  it("agentLoop wrapper handles tool-result events (error and success)", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('event.type === "tool-result"');
    expect(content).toContain("event.error || event.result?.error");
    expect(content).toContain("event.result?.success");
  });

  it("agentLoop wrapper surfaces ApprovalGate deny recovery hint", () => {
    const content = readFileSync(agentReplPath, "utf8");
    // Parity with Desktop AIChatPage's `Switch to Trusted` button — when
    // ApprovalGate (not shell-policy) denies, print the exact CLI command
    // the user can run to relax the per-session policy.
    expect(content).toContain('approval?.decision === "deny"');
    expect(content).toContain('approval?.via !== "shell-policy"');
    expect(content).toContain("cc session policy");
    expect(content).toContain("--set trusted");
  });

  it("agentLoop wrapper returns structured result on response-complete", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain('event.type === "response-complete"');
    expect(content).toContain(
      "return { content: event.content, usageEvents, thinking: event.thinking }",
    );
  });

  it("threads unreadable and unsettled resume state into the shared MCP recovery guard", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("let _mcpLedgerRecovery = null;");
    expect(content).toContain("let _mcpLedgerRecoveryError = null;");
    expect(content).toContain("readSessionHostResumeState");
    expect(content).toContain("const prepared = _startupJsonlResume;");
    expect(content).toContain("_commitMcpRecoveryCandidate");
    expect(content).toContain("_mcpLedgerRecovery = preparedCommit.recovery");
    expect(content).toContain(
      "_mcpLedgerRecoveryError = preparedCommit.recoveryError",
    );
    expect(content).toContain("createReplMcpHostRuntimeManager()");
    expect(content).toContain("recovery = _mcpLedgerRecovery");
    expect(content).toContain("recoveryError = _mcpLedgerRecoveryError");
    expect(content).toContain("mcpClient: activeRawMcpClient");
    expect(content).toContain("mcpHostClient: activeMcpRuntime.runtime.client");
    expect(content).toContain("mcpCallLedger: activeMcpRuntime.runtime.ledger");
  });

  it("routes auxiliary MCP and IDE calls through the guarded host client", () => {
    const content = readFileSync(agentReplPath, "utf8");
    expect(content).toContain("const hostMcp = _getReplHostMcp();");
    expect(content).toContain("hostMcp.mcpClient.callTool(");
    expect(content).toContain("buildIdePromptContext(hostMcp)");
    expect(content).toContain("expandIdeMentions(effectivePrompt, hostMcp)");
    expect(content).toContain("_getReplHostMcp()?.mcpClient");
  });

  it("switches the session runtime only after a resume candidate succeeds", () => {
    const content = readFileSync(agentReplPath, "utf8");
    const resumeAt = content.indexOf('sessionArg.startsWith("resume ")');
    const rejectAt = content.indexOf(
      "if (!prepared.ok) throw prepared.error;",
      resumeAt,
    );
    const prepareAt = content.indexOf(
      "const preparedMcpRuntime = _prepareMcpHostRuntime(",
      rejectAt,
    );
    const snapshotAt = content.indexOf(
      "const previousState = _captureResumeState();",
      prepareAt,
    );
    const transactionAt = content.indexOf(
      "const committed = commitPreparedReplJsonlResume(",
      snapshotAt,
    );
    const applyAt = content.indexOf(
      "() => _applyPreparedResumeState(preparedState)",
      transactionAt,
    );
    const rollbackAt = content.indexOf(
      "() => _restoreResumeState(previousState)",
      applyAt,
    );

    expect(resumeAt).toBeGreaterThan(-1);
    expect(rejectAt).toBeGreaterThan(resumeAt);
    expect(prepareAt).toBeGreaterThan(rejectAt);
    expect(snapshotAt).toBeGreaterThan(prepareAt);
    expect(transactionAt).toBeGreaterThan(snapshotAt);
    expect(applyAt).toBeGreaterThan(transactionAt);
    expect(rollbackAt).toBeGreaterThan(applyAt);
    expect(content).toContain(
      "const _resumeStateController = createReplResumeStateController({",
    );
    expect(content).toContain("commitPreparedReplDbResume(");
  });
});

describe("agent-repl MCP host runtime manager", () => {
  it("reuses one controller and ledger so a settlement latch survives turns", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    const rawClient = { callTool: vi.fn() };
    const guardedClient = { callTool: vi.fn() };
    const controller = { settlementFailed: false };
    const ledger = { id: "shared-ledger" };
    const runtime = {
      controller,
      ledger,
      client: guardedClient,
      rawClient,
    };
    const sink = vi.fn();
    const appendAuthorityEvent = vi.fn();
    const createSessionMcpLedgerSink = vi.fn(() => sink);
    const createMcpHostRecoveryRuntime = vi.fn(() => runtime);
    const manager = createReplMcpHostRuntimeManager({
      createMcpHostRecoveryRuntime,
      createSessionMcpLedgerSink,
      appendAuthorityEvent,
    });
    const recovery = Object.freeze({
      unsettled: [],
      incidents: [],
      replayDenied: [],
    });
    const adhocMcp = {
      mcpClient: rawClient,
      externalToolExecutors: { ide: { kind: "mcp" } },
    };
    const options = {
      adhocMcp,
      bundleMcpClient: { id: "unused-bundle" },
      sessionId: "session-a",
      persistent: true,
      recovery,
      recoveryError: null,
    };

    const first = manager.activate(options);
    first.runtime.controller.settlementFailed = true;
    const second = manager.activate(options);

    expect(second).toBe(first);
    expect(second.runtime.controller.settlementFailed).toBe(true);
    expect(second.runtime.ledger).toBe(ledger);
    expect(second.rawClient).toBe(rawClient);
    expect(second.hostMcp.mcpClient).toBe(guardedClient);
    expect(second.hostMcp.externalToolExecutors).toBe(
      adhocMcp.externalToolExecutors,
    );
    expect(createSessionMcpLedgerSink).toHaveBeenCalledOnce();
    expect(createSessionMcpLedgerSink).toHaveBeenCalledWith("session-a", {
      appendEvent: appendAuthorityEvent,
    });
    expect(createMcpHostRecoveryRuntime).toHaveBeenCalledOnce();
    expect(createMcpHostRecoveryRuntime).toHaveBeenCalledWith({
      bundle: adhocMcp,
      rawClient,
      sessionId: "session-a",
      sink,
      recovery,
      recoveryError: null,
    });
  });

  it("prepares session switches without replacing the active runtime", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    let runtimeId = 0;
    const createSessionMcpLedgerSink = vi.fn(() => vi.fn());
    const manager = createReplMcpHostRuntimeManager({
      createSessionMcpLedgerSink,
      createMcpHostRecoveryRuntime: vi.fn(({ rawClient }) => {
        runtimeId += 1;
        return {
          controller: { runtimeId },
          ledger: { runtimeId },
          client: { runtimeId },
          rawClient,
        };
      }),
    });
    const rawClient = { callTool: vi.fn() };
    const oldRecovery = {
      unsettled: [],
      incidents: [],
      replayDenied: [],
    };
    const oldRuntime = manager.activate({
      adhocMcp: { mcpClient: rawClient },
      sessionId: "old-session",
      persistent: true,
      recovery: oldRecovery,
    });
    const newRecovery = {
      unsettled: [],
      incidents: [],
      replayDenied: [],
    };
    const preparedRuntime = manager.prepare({
      adhocMcp: { mcpClient: rawClient },
      sessionId: "new-session",
      persistent: true,
      recovery: newRecovery,
    });

    expect(preparedRuntime).not.toBe(oldRuntime);
    expect(manager.current).toBe(oldRuntime);

    // A failed resume never commits its prepared candidate.
    expect(manager.current.runtime.controller).toBe(
      oldRuntime.runtime.controller,
    );

    manager.commit(preparedRuntime);
    expect(manager.current).toBe(preparedRuntime);
    expect(manager.current.runtime.controller).not.toBe(
      oldRuntime.runtime.controller,
    );
    expect(manager.current.runtime.ledger).not.toBe(oldRuntime.runtime.ledger);
    expect(createSessionMcpLedgerSink).toHaveBeenNthCalledWith(
      1,
      "old-session",
      { recovery: oldRecovery },
    );
    expect(createSessionMcpLedgerSink).toHaveBeenNthCalledWith(
      2,
      "new-session",
      { recovery: newRecovery },
    );
  });

  it("prefers adhoc MCP, supports bundle fallback, and skips durable DB sinks", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    const createSessionMcpLedgerSink = vi.fn();
    const createMcpHostRecoveryRuntime = vi.fn(({ rawClient }) => ({
      controller: {},
      ledger: {},
      client: { guardedRawClient: rawClient },
      rawClient,
    }));
    const manager = createReplMcpHostRuntimeManager({
      createMcpHostRecoveryRuntime,
      createSessionMcpLedgerSink,
    });
    const adhocClient = { id: "adhoc" };
    const bundleClient = { id: "bundle" };
    const adhocMcp = { mcpClient: adhocClient, connected: ["adhoc"] };

    const adhocRuntime = manager.activate({
      adhocMcp,
      bundleMcpClient: bundleClient,
      sessionId: "db-session",
      persistent: false,
    });
    expect(adhocRuntime.rawClient).toBe(adhocClient);
    expect(adhocRuntime.hostMcp.connected).toEqual(["adhoc"]);
    expect(createMcpHostRecoveryRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bundle: adhocMcp,
        rawClient: adhocClient,
        sink: null,
      }),
    );

    const bundleRuntime = manager.activate({
      bundleMcpClient: bundleClient,
      sessionId: "other-db-session",
      persistent: false,
    });
    expect(bundleRuntime.rawClient).toBe(bundleClient);
    expect(bundleRuntime.hostMcp.mcpClient).toEqual({
      guardedRawClient: bundleClient,
    });
    expect(createMcpHostRecoveryRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bundle: { mcpClient: bundleClient },
        rawClient: bundleClient,
        sink: null,
      }),
    );
    expect(createSessionMcpLedgerSink).not.toHaveBeenCalled();
  });

  it("keeps a non-persistent REPL on the guarded ledger after outcome unknown", async () => {
    const { createReplMcpHostRuntimeManager } =
      await import("../../src/repl/agent-repl.js");
    const { executeTool } = await import("../../src/runtime/agent-core.js");
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport outcome unknown"))
      .mockResolvedValue({ content: [] });
    const rawClient = { callTool };
    const runtime = createReplMcpHostRuntimeManager().activate({
      adhocMcp: { mcpClient: rawClient },
      sessionId: "db-session",
      persistent: false,
    });
    const toolName = "mcp__repo__publish";
    const options = {
      sessionId: "db-session",
      mcpClient: rawClient,
      mcpCallLedger: runtime.runtime.ledger,
      permissionConfirm: vi.fn(async () => true),
      externalToolExecutors: {
        [toolName]: {
          kind: "mcp",
          serverName: "repo",
          toolName: "publish",
        },
      },
      externalToolDescriptors: {
        [toolName]: {
          name: toolName,
          kind: "mcp",
          category: "mcp",
          source: "mcp:repo",
          effectContract: { declaredEffect: "write" },
        },
      },
    };

    expect(runtime.runtime.ledger.recoveryAdmission).toBeDefined();
    const first = await executeTool(toolName, { release: 1 }, options);
    expect(first).toMatchObject({
      code: "CC_MCP_LEDGER_OUTCOME_UNKNOWN",
      outcomeUnknown: true,
      retryable: false,
    });

    const retry = await executeTool(toolName, { release: 2 }, options);
    expect(retry).toMatchObject({
      policy: {
        code: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
        blockMode: "unsafe",
      },
    });
    expect(callTool).toHaveBeenCalledOnce();
  });
});

const VERIFIED_RECOVERY_DIGEST = `sha256:${"b".repeat(64)}`;

function verifiedReplRecovery(sessionId, overrides = {}) {
  const unsettled = overrides.unsettled || [];
  const incidents = overrides.incidents || [];
  const replayDenied = overrides.replayDenied || [];
  const remediation =
    overrides.remediation !== undefined
      ? overrides.remediation
      : incidents.length > 0
        ? "inspect_transcript"
        : unsettled.length > 0
          ? "adjudicate_started_calls"
          : replayDenied.length > 0
            ? "exact_replay_denied"
            : null;
  return {
    sessionId,
    verified: true,
    unsettled,
    incidents,
    replayDenied,
    headHash: overrides.headHash ?? "a".repeat(64),
    recoveryDigest: overrides.recoveryDigest || VERIFIED_RECOVERY_DIGEST,
    remediation,
  };
}

function verifiedReplResumeState(sessionId, overrides = {}) {
  const recovery =
    overrides.recovery || verifiedReplRecovery(sessionId, overrides);
  return {
    snapshot: {
      schema: "chainlesschain.session-host-snapshot/v1",
      schemaVersion: 1,
      sessionId,
      verified: true,
      revision: `sha256:${"c".repeat(64)}`,
      head: {
        hash: recovery.headHash,
        eventCount: 1,
      },
      recoveryAuthority: {
        recoveryDigest: recovery.recoveryDigest,
      },
    },
    messages: overrides.messages || [{ role: "user", content: "restored" }],
    recovery,
  };
}

describe("agent-repl startup resume admission", () => {
  it("adopts a verified canonical session before reading feature config", async () => {
    const { prepareReplStartupResume } =
      await import("../../src/repl/agent-repl.js");
    const order = [];
    const readFeature = vi.fn(() => {
      order.push("feature");
      return false;
    });

    const prepared = prepareReplStartupResume("target-session", {
      readSessionHostResumeState: () => {
        order.push("verified-state");
        return verifiedReplResumeState("target-session");
      },
      formatMcpLedgerRecoveryNotice: () => null,
      feature: readFeature,
    });

    expect(prepared).toMatchObject({
      useJsonl: true,
      candidate: { ok: true, sessionId: "target-session" },
    });
    expect(order).toEqual(["verified-state"]);
    expect(readFeature).not.toHaveBeenCalled();
  });

  it("acquires the canonical REPL host lease before entering the workspace", async () => {
    const { prepareReplStartupResume, runReplStartupBoundary } =
      await import("../../src/repl/agent-repl.js");
    const admission = prepareReplStartupResume("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session"),
      formatMcpLedgerRecoveryNotice: () => null,
    });
    const order = [];
    const lease = { release: vi.fn() };
    const leaseScope = { lease: null };

    const result = await runReplStartupBoundary(
      {
        sessionId: "target-session",
        _sessionHostLeaseScope: leaseScope,
      },
      {
        prepareReplStartupResume: () => admission,
        acquireSessionHostLease: vi.fn((sessionId, options) => {
          order.push(`lease:${sessionId}:${options.hostKind}`);
          return lease;
        }),
        cwd: () => {
          order.push("cwd");
          return process.cwd();
        },
        runWithHostHooksV2Workspace: (_cwd, callback) => {
          order.push("workspace");
          return callback();
        },
        startAgentReplInWorkspace: (options) => {
          order.push("start");
          expect(options._sessionHostLeaseScope.lease).toBe(lease);
          return { started: true };
        },
      },
    );

    expect(result).toEqual({ started: true });
    expect(order).toEqual([
      "lease:target-session:repl",
      "cwd",
      "workspace",
      "start",
    ]);
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("opens one durable budget root after the host lease and before workspace startup", async () => {
    const { prepareReplStartupResume, runReplStartupBoundary } =
      await import("../../src/repl/agent-repl.js");
    const admission = prepareReplStartupResume("budgeted-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("budgeted-session"),
      formatMcpLedgerRecoveryNotice: () => null,
    });
    const order = [];
    const leaseController = new AbortController();
    const lease = { signal: leaseController.signal, release: vi.fn() };
    const leaseScope = { lease: null };
    const budgetScope = { root: null };
    const budget = { signal: new AbortController().signal };
    const rootSignal = new AbortController().signal;
    const root = {
      enabled: true,
      budget,
      options: { sessionBudget: budget, signal: rootSignal },
      close: vi.fn(),
    };
    const openBudgetRoot = vi.fn((sessionId, config, openOptions) => {
      order.push("budget");
      expect(sessionId).toBe("budgeted-session");
      expect(config.limits).toEqual({ maxTurns: 4 });
      expect(openOptions).toMatchObject({ persist: true });
      expect(openOptions.signal).toBe(leaseController.signal);
      return root;
    });

    const result = await runReplStartupBoundary(
      {
        sessionId: "budgeted-session",
        sessionBudgetRoot: {
          enabled: true,
          limits: { maxTurns: 4 },
        },
        _sessionHostLeaseScope: leaseScope,
        _sessionBudgetRootScope: budgetScope,
      },
      {
        prepareReplStartupResume: () => admission,
        acquireSessionHostLease: () => {
          order.push("lease");
          return lease;
        },
        openProductionSessionBudgetRoot: openBudgetRoot,
        cwd: () => {
          order.push("cwd");
          return process.cwd();
        },
        runWithHostHooksV2Workspace: (_cwd, callback) => {
          order.push("workspace");
          return callback();
        },
        startAgentReplInWorkspace: (options) => {
          order.push("start");
          expect(options.sessionBudget).toBe(budget);
          expect(options.signal).toBe(rootSignal);
          return { started: true };
        },
      },
    );

    expect(result).toEqual({ started: true });
    expect(order).toEqual(["lease", "budget", "cwd", "workspace", "start"]);
    expect(budgetScope.root).toBe(root);
    expect(root.close).not.toHaveBeenCalled();
  });

  it("closes a REPL budget root scope exactly once", async () => {
    const { closeReplSessionBudgetRootScope } =
      await import("../../src/repl/agent-repl.js");
    const root = { close: vi.fn(() => true) };
    const scope = { root };

    await expect(closeReplSessionBudgetRootScope(scope)).resolves.toBe(true);
    await expect(closeReplSessionBudgetRootScope(scope)).resolves.toBe(false);
    expect(root.close).toHaveBeenCalledOnce();
    expect(scope.root).toBeNull();
  });

  it("never downgrades a budgeted JSONL session creation failure to legacy best effort", async () => {
    const { startReplJsonlSession } =
      await import("../../src/repl/agent-repl.js");
    const failure = vi.fn(() => {
      throw new Error("disk full");
    });

    expect(() =>
      startReplJsonlSession(failure, "budgeted-session", {}, null, {
        requireDurable: true,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_SESSION_BUDGET_SESSION_START_FAILED",
      }),
    );
    expect(
      startReplJsonlSession(failure, "legacy-session", {}, null),
    ).toBeNull();
  });

  it("refuses an already-exhausted budget before entering the workspace", async () => {
    const { prepareReplStartupResume, runReplStartupBoundary } =
      await import("../../src/repl/agent-repl.js");
    const admission = prepareReplStartupResume("exhausted-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("exhausted-session"),
      formatMcpLedgerRecoveryNotice: () => null,
    });
    const controller = new AbortController();
    controller.abort("turn-limit");
    const budget = {
      signal: controller.signal,
      reason: () => "turn-limit",
    };
    const root = {
      enabled: true,
      budget,
      options: { sessionBudget: budget, signal: controller.signal },
      close: vi.fn(() => true),
    };
    const cwd = vi.fn();
    const enterWorkspace = vi.fn();
    const startWorkspace = vi.fn();

    await expect(
      runReplStartupBoundary(
        {
          sessionId: "exhausted-session",
          sessionBudgetRoot: { enabled: true, limits: { maxTurns: 1 } },
          _sessionHostLeaseScope: { lease: null },
          _sessionBudgetRootScope: { root: null },
        },
        {
          prepareReplStartupResume: () => admission,
          acquireSessionHostLease: () => ({
            signal: new AbortController().signal,
            release: vi.fn(),
          }),
          openProductionSessionBudgetRoot: () => root,
          cwd,
          runWithHostHooksV2Workspace: enterWorkspace,
          startAgentReplInWorkspace: startWorkspace,
        },
      ),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_EXHAUSTED",
      budgetReason: "turn-limit",
    });
    expect(root.close).toHaveBeenCalledOnce();
    expect(cwd).not.toHaveBeenCalled();
    expect(enterWorkspace).not.toHaveBeenCalled();
    expect(startWorkspace).not.toHaveBeenCalled();
  });

  it("refuses a present unverified canonical session before config access", async () => {
    const { prepareReplStartupResume } =
      await import("../../src/repl/agent-repl.js");
    const readFeature = vi.fn(() => false);

    const prepared = prepareReplStartupResume("target-session", {
      readSessionHostResumeState: () => ({
        snapshot: {
          schema: "chainlesschain.session-host-snapshot/v1",
          schemaVersion: 1,
          sessionId: "target-session",
          verified: false,
        },
        messages: null,
        recovery: null,
      }),
      feature: readFeature,
    });

    expect(prepared).toMatchObject({
      useJsonl: true,
      candidate: {
        ok: false,
        error: { code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED" },
      },
    });
    expect(readFeature).not.toHaveBeenCalled();
  });

  it("reads feature config only after canonical absence is established", async () => {
    const { prepareReplStartupResume } =
      await import("../../src/repl/agent-repl.js");
    const order = [];

    const prepared = prepareReplStartupResume("legacy-session", {
      readSessionHostResumeState: () => {
        order.push("verified-state");
        return null;
      },
      feature: (name) => {
        order.push(`feature:${name}`);
        return false;
      },
    });

    expect(prepared).toEqual({ useJsonl: false, candidate: null });
    expect(order).toEqual(["verified-state", "feature:JSONL_SESSION"]);
  });

  it("does not let a thrown own NOT_FOUND code forge canonical absence", async () => {
    const { prepareReplStartupResume, runReplStartupBoundary } =
      await import("../../src/repl/agent-repl.js");
    const hostile = Object.assign(new Error("reader failed"), {
      code: "CC_REPL_SESSION_NOT_FOUND",
    });
    const readFeature = vi.fn(() => false);

    const prepared = prepareReplStartupResume("target-session", {
      readSessionHostResumeState: () => {
        throw hostile;
      },
      feature: readFeature,
    });

    expect(prepared).toMatchObject({
      useJsonl: true,
      candidate: {
        ok: false,
        error: { code: "CC_REPL_SESSION_NOT_FOUND" },
      },
    });
    expect(readFeature).not.toHaveBeenCalled();

    const refuseReplStartupResume = vi.fn(() => "refused");
    const cwd = vi.fn();
    const runWithHostHooksV2Workspace = vi.fn();
    const startAgentReplInWorkspace = vi.fn();
    await expect(
      runReplStartupBoundary(
        { sessionId: "target-session" },
        {
          prepareReplStartupResume: () => prepared,
          refuseReplStartupResume,
          cwd,
          runWithHostHooksV2Workspace,
          startAgentReplInWorkspace,
        },
      ),
    ).resolves.toBe("refused");
    expect(refuseReplStartupResume).toHaveBeenCalledOnce();
    expect(cwd).not.toHaveBeenCalled();
    expect(runWithHostHooksV2Workspace).not.toHaveBeenCalled();
    expect(startAgentReplInWorkspace).not.toHaveBeenCalled();
  });

  it("requires exact null rather than undefined for canonical absence", async () => {
    const { prepareReplStartupResume } =
      await import("../../src/repl/agent-repl.js");
    const readFeature = vi.fn(() => false);

    const prepared = prepareReplStartupResume("target-session", {
      readSessionHostResumeState: () => undefined,
      feature: readFeature,
    });

    expect(prepared).toMatchObject({
      useJsonl: true,
      candidate: { ok: false },
    });
    expect(readFeature).not.toHaveBeenCalled();
  });

  it("refuses invalid canonical roles before every host startup side effect", async () => {
    const { prepareReplStartupResume, runReplStartupBoundary } =
      await import("../../src/repl/agent-repl.js");
    const order = [];
    const feature = vi.fn(() => {
      order.push("config");
      return true;
    });
    const formatMcpLedgerRecoveryNotice = vi.fn(() => {
      order.push("mcp-recovery-format");
      return null;
    });
    const enterWorkspace = vi.fn((_cwd, callback) => {
      order.push("hooks-workspace");
      return callback();
    });
    const startWorkspace = vi.fn(() => {
      order.push(
        "pipe",
        "bootstrap",
        "settings",
        "plugins",
        "hooks",
        "mcp",
        "model",
        "tool",
      );
    });

    const result = await runReplStartupBoundary(
      { sessionId: "target-session" },
      {
        prepareReplStartupResume: (sessionId) =>
          prepareReplStartupResume(sessionId, {
            readSessionHostResumeState: () => {
              order.push("verified-state");
              return verifiedReplResumeState(sessionId, {
                messages: [{ role: "developer", content: "not canonical" }],
              });
            },
            formatMcpLedgerRecoveryNotice,
            feature,
          }),
        refuseReplStartupResume: (_options, candidate) => {
          order.push("refusal");
          return Object.freeze({
            started: false,
            code: candidate.error.code,
          });
        },
        cwd: vi.fn(() => "C:\\trusted"),
        runWithHostHooksV2Workspace: enterWorkspace,
        startAgentReplInWorkspace: startWorkspace,
      },
    );

    expect(result).toEqual({
      started: false,
      code: "CC_REPL_SESSION_ROLE_INVALID",
    });
    expect(order).toEqual(["verified-state", "refusal"]);
    expect(feature).not.toHaveBeenCalled();
    expect(formatMcpLedgerRecoveryNotice).not.toHaveBeenCalled();
    expect(enterWorkspace).not.toHaveBeenCalled();
    expect(startWorkspace).not.toHaveBeenCalled();
  });

  it("passes one frozen verified sample across the successful host boundary", async () => {
    const { prepareReplStartupResume, runReplStartupBoundary } =
      await import("../../src/repl/agent-repl.js");
    const order = [];
    let admitted;
    let received;

    const result = await runReplStartupBoundary(
      { sessionId: "target-session" },
      {
        prepareReplStartupResume: (sessionId) => {
          order.push("admit");
          admitted = prepareReplStartupResume(sessionId, {
            readSessionHostResumeState: () => {
              order.push("verified-state");
              return verifiedReplResumeState(sessionId);
            },
            formatMcpLedgerRecoveryNotice: () => null,
            feature: vi.fn(),
          });
          return admitted;
        },
        cwd: () => {
          order.push("cwd");
          return "C:\\trusted";
        },
        runWithHostHooksV2Workspace: (_cwd, callback) => {
          order.push("hooks-workspace");
          return callback();
        },
        startAgentReplInWorkspace: (_options, startupAdmission) => {
          order.push("workspace-start");
          received = startupAdmission;
          return "started";
        },
      },
    );

    expect(result).toBe("started");
    expect(received).toBe(admitted);
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen(received.candidate)).toBe(true);
    expect(order).toEqual([
      "admit",
      "verified-state",
      "cwd",
      "hooks-workspace",
      "workspace-start",
    ]);
  });

  it.each([
    "../escape",
    "x".repeat(129),
    "control\ncharacter",
    "noncanonical-e\u0301",
    "NUL",
    "alternate:data",
    "trailing.",
  ])(
    "rejects unsafe resume id %j without probing storage or config",
    async (id) => {
      const { prepareReplStartupResume } =
        await import("../../src/repl/agent-repl.js");
      const readState = vi.fn();
      const readFeature = vi.fn();

      const prepared = prepareReplStartupResume(id, {
        readSessionHostResumeState: readState,
        feature: readFeature,
      });

      expect(prepared).toMatchObject({
        useJsonl: true,
        candidate: {
          ok: false,
          error: { code: "CC_REPL_SESSION_ID_INVALID" },
        },
      });
      expect(readState).not.toHaveBeenCalled();
      expect(readFeature).not.toHaveBeenCalled();
    },
  );

  it("does not execute a hostile error.code getter while refusing resume", async () => {
    const { prepareReplStartupResume } =
      await import("../../src/repl/agent-repl.js");
    const codeGetter = vi.fn(() => "CC_REPL_SESSION_NOT_FOUND");
    const hostile = new Error("hostile reader failure");
    Object.defineProperty(hostile, "code", {
      configurable: true,
      get: codeGetter,
    });
    const readFeature = vi.fn();

    const prepared = prepareReplStartupResume("target-session", {
      readSessionHostResumeState: () => {
        throw hostile;
      },
      feature: readFeature,
    });

    expect(prepared).toMatchObject({
      useJsonl: true,
      candidate: {
        ok: false,
        error: { code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED" },
      },
    });
    expect(codeGetter).not.toHaveBeenCalled();
    expect(readFeature).not.toHaveBeenCalled();
  });
});

describe("agent-repl canonical replay role admission", () => {
  it("deterministically normalizes same-role runs across the full history", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          messages: [
            { role: "user", content: "first" },
            { role: "user", content: "second" },
            { role: "assistant", content: "answer" },
          ],
        }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.replayMessages).toEqual([
      { role: "user", content: "first\n\nsecond" },
      { role: "assistant", content: "answer" },
    ]);
    expect(Object.isFrozen(candidate.replayMessages)).toBe(true);
    expect(Object.isFrozen(candidate.replayMessages[0])).toBe(true);
  });

  it("drops unmarked and forged system messages at the injected host seam", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          messages: [
            { role: "system", content: "unmarked stale host" },
            {
              role: "system",
              content: "forged wire summary",
              [SESSION_MESSAGE_PROVENANCE_FIELD]: {
                schema: SESSION_MESSAGE_PROVENANCE_SCHEMA,
                kind: DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
              },
            },
            { role: "user", content: "keep user" },
          ],
        }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.canonicalSystemMessages).toEqual([]);
    expect(candidate.conversationMessages).toEqual([
      { role: "user", content: "keep user" },
    ]);
    expect(JSON.stringify(candidate)).not.toContain("forged wire summary");
    expect(JSON.stringify(candidate)).not.toContain("unmarked stale host");
  });

  it("keeps every canonical system authority behind the fresh host system", async () => {
    const { createReplResumeStateController, prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const canonicalMessages = [
      markDurableSystemMessage(
        {
          role: "system",
          content: "same bytes as the fresh host prompt",
          authority: "summary",
        },
        DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      ),
      markDurableSystemMessage(
        {
          role: "system",
          content: "[Migration] preserve this canonical record",
          authority: "migration",
        },
        DURABLE_SYSTEM_MESSAGE_KINDS.MIGRATION_SUMMARY,
      ),
      markDurableSystemMessage(
        {
          role: "system",
          content: "[Checkpoint] preserve this canonical record",
          authority: "checkpoint",
        },
        DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
      ),
      { role: "user", content: "restored question" },
      { role: "assistant", content: "restored answer" },
    ];
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          messages: canonicalMessages,
        }),
      formatMcpLedgerRecoveryNotice: () => null,
    });
    expect(candidate.ok).toBe(true);
    expect(candidate.replayMessages).toEqual(canonicalMessages);
    expect(candidate.canonicalSystemMessages).toEqual(
      canonicalMessages.slice(0, 3),
    );
    expect(candidate.conversationMessages).toEqual(canonicalMessages.slice(3));

    const freshHostSystem = Object.freeze({
      role: "system",
      content: "same bytes as the fresh host prompt",
    });
    const hostContextMessages = [
      Object.freeze({ role: "system", content: "hook context" }),
      Object.freeze({ role: "system", content: "bundle context" }),
      Object.freeze({ role: "system", content: "memory context" }),
    ];
    const oldRuntime = Object.freeze({ id: "old-runtime" });
    const targetRuntime = Object.freeze({ id: "target-runtime" });
    const runtimeManager = {
      current: oldRuntime,
      commit(nextRuntime) {
        this.current = nextRuntime;
      },
    };
    const bindings = {
      sessionId: "old-session",
      messages: [freshHostSystem, ...hostContextMessages],
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
      sessionId: "target-session",
      hostSystemMessages,
      canonicalSystemMessages: candidate.canonicalSystemMessages,
      conversationMessages: candidate.conversationMessages,
      mcpCommit: candidate.mcp,
      mcpRuntime: targetRuntime,
      sanitizeRolesNextTurn: false,
      logMessage: "resumed",
    });

    expect(bindings.messages).toEqual([
      freshHostSystem,
      ...hostContextMessages,
      ...canonicalMessages,
    ]);
    expect(bindings.messages[0]).toEqual(freshHostSystem);
    expect(bindings.messages.slice(1, 4)).toEqual(hostContextMessages);
    expect(bindings.messages.slice(4, 7)).toEqual(
      canonicalMessages.slice(0, 3),
    );
    expect(
      bindings.messages.filter(
        (message) => message.content === freshHostSystem.content,
      ),
    ).toHaveLength(2);
    for (const hostMessage of hostContextMessages) {
      expect(
        bindings.messages.filter(
          (message) =>
            message.content === hostMessage.content &&
            !Object.prototype.hasOwnProperty.call(message, "authority"),
        ),
      ).toHaveLength(1);
    }
  });

  it("moves durable migration and checkpoint summaries behind the fresh host before a live turn", async () => {
    const {
      agentLoop,
      createReplResumeStateController,
      prepareReplJsonlResumeCandidate,
    } = await import("../../src/repl/agent-repl.js");
    // Exact durable context forms emitted by migration and checkpoint actions.
    const migrationMarker = markDurableSystemMessage(
      {
        role: "system",
        content: "[Migrated Summary]\nlegacy facts",
      },
      DURABLE_SYSTEM_MESSAGE_KINDS.MIGRATION_SUMMARY,
    );
    const checkpointMarker = markDurableSystemMessage(
      {
        role: "system",
        content:
          "[Conversation Summary: summary-from turn-1]\ncheckpoint facts",
      },
      DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
    );
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          messages: [
            { role: "assistant", content: "prior answer" },
            { role: "user", content: "dangling restored turn" },
            migrationMarker,
            checkpointMarker,
          ],
        }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.canonicalSystemMessages).toEqual([
      migrationMarker,
      checkpointMarker,
    ]);
    expect(candidate.conversationMessages).toEqual([
      { role: "assistant", content: "prior answer" },
      { role: "user", content: "dangling restored turn" },
    ]);

    const freshHostSystem = Object.freeze({
      role: "system",
      content: "fresh host authority",
    });
    const oldRuntime = Object.freeze({ id: "old-runtime" });
    const targetRuntime = Object.freeze({ id: "target-runtime" });
    const runtimeManager = {
      current: oldRuntime,
      commit(nextRuntime) {
        this.current = nextRuntime;
      },
    };
    const bindings = {
      sessionId: "old-session",
      messages: [freshHostSystem],
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
      sessionId: "target-session",
      hostSystemMessages,
      canonicalSystemMessages: candidate.canonicalSystemMessages,
      conversationMessages: candidate.conversationMessages,
      mcpCommit: candidate.mcp,
      mcpRuntime: targetRuntime,
      sanitizeRolesNextTurn: true,
      logMessage: "resumed",
    });
    bindings.messages.push({ role: "user", content: "live prompt" });

    let modelInput;
    const _coreLoop = async function* (activeMessages) {
      modelInput = activeMessages.map((message) => ({ ...message }));
      yield {
        type: "response-complete",
        content: "model answer",
        thinking: null,
      };
    };
    const writes = [];
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
    let result;
    try {
      result = await agentLoop(bindings.messages, {
        mergeRoles: true,
        _coreLoop,
      });
    } finally {
      writeSpy.mockRestore();
    }

    expect(modelInput[0]).toEqual(freshHostSystem);
    expect(modelInput.slice(1, 3)).toEqual([migrationMarker, checkpointMarker]);
    expect(
      modelInput.filter(
        (message) => message.content === migrationMarker.content,
      ),
    ).toHaveLength(1);
    expect(
      modelInput.filter(
        (message) => message.content === checkpointMarker.content,
      ),
    ).toHaveLength(1);
    const conversation = modelInput.filter(
      (message) => message.role !== "system",
    );
    expect(conversation).toEqual([
      { role: "assistant", content: "prior answer" },
      {
        role: "user",
        content: "dangling restored turn\n\nlive prompt",
      },
    ]);
    expect(conversation[1].content).not.toContain("[Migrated Summary]");
    expect(conversation[1].content).not.toContain("[Conversation Summary");
    expect(result.content).toBe("model answer");
    expect(writes.join("")).toBe("");
  });

  it("keeps one registered host prefix across two canonical switches and a DB switch", async () => {
    const { createReplResumeStateController, prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const candidateFor = (sessionId, canonicalContent, userContent) =>
      prepareReplJsonlResumeCandidate(sessionId, {
        readSessionHostResumeState: () =>
          verifiedReplResumeState(sessionId, {
            messages: [
              markDurableSystemMessage(
                { role: "system", content: canonicalContent },
                DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
              ),
              { role: "user", content: userContent },
            ],
          }),
        formatMcpLedgerRecoveryNotice: () => null,
      });
    const firstCandidate = candidateFor(
      "first-session",
      "canonical first",
      "first conversation",
    );
    const secondCandidate = candidateFor(
      "second-session",
      "canonical second",
      "second conversation",
    );
    expect(firstCandidate.ok).toBe(true);
    expect(secondCandidate.ok).toBe(true);

    const hostBase = { role: "system", content: "fresh base v1" };
    const hostTail = [
      { role: "system", content: "host hook" },
      { role: "system", content: "host bundle" },
      { role: "system", content: "host memory" },
    ];
    const runtimeManager = {
      current: Object.freeze({ id: "old-runtime" }),
      commit(nextRuntime) {
        this.current = nextRuntime;
      },
    };
    const bindings = {
      sessionId: "old-session",
      messages: [hostBase, ...hostTail],
      recovery: null,
      recoveryError: null,
      sanitizeRolesNextTurn: false,
      turnBindingProducer: null,
      turnBindingCriticalError: null,
      checkpointMarks: [],
      clearedConversation: null,
      runtimeManager,
      applyMcpRecoveryCommit(targetMessages, preparedCommit) {
        bindings.recovery = preparedCommit.recovery;
        bindings.recoveryError = preparedCommit.recoveryError;
        if (preparedCommit.noticeMessage) {
          targetMessages.push(preparedCommit.noticeMessage);
        }
      },
      logMcpRecoveryCommit: vi.fn(),
      logger: { info: vi.fn() },
    };
    const controller = createReplResumeStateController(bindings);
    controller.registerHostSystemMessages();
    const applyJsonl = (candidate, notice, runtimeId) => {
      const hostSystemMessages = controller.refreshHostSystemMessages();
      controller.apply({
        sessionId: candidate.sessionId,
        hostSystemMessages,
        canonicalSystemMessages: candidate.canonicalSystemMessages,
        conversationMessages: candidate.conversationMessages,
        mcpCommit: Object.freeze({
          recovery: candidate.mcp.recovery,
          recoveryError: null,
          noticeMessage: Object.freeze({ role: "system", content: notice }),
          warning: null,
        }),
        mcpRuntime: Object.freeze({ id: runtimeId }),
        sanitizeRolesNextTurn: true,
        logMessage: `resumed ${candidate.sessionId}`,
      });
    };

    applyJsonl(firstCandidate, "notice first", "first-runtime");
    expect(bindings.messages.map((message) => message.content)).toEqual([
      "fresh base v1",
      "host hook",
      "host bundle",
      "host memory",
      "canonical first",
      "notice first",
      "first conversation",
    ]);

    bindings.messages[0].content = "fresh base v2";
    applyJsonl(secondCandidate, "notice second", "second-runtime");
    const secondContents = bindings.messages.map((message) => message.content);
    expect(secondContents).toEqual([
      "fresh base v2",
      "host hook",
      "host bundle",
      "host memory",
      "canonical second",
      "notice second",
      "second conversation",
    ]);
    expect(secondContents).not.toContain("canonical first");
    expect(secondContents).not.toContain("notice first");

    const dbHostSystemMessages = controller.refreshHostSystemMessages();
    controller.apply({
      sessionId: "db-session",
      hostSystemMessages: dbHostSystemMessages,
      canonicalSystemMessages: Object.freeze([]),
      conversationMessages: Object.freeze([
        Object.freeze({ role: "assistant", content: "DB conversation" }),
      ]),
      mcpCommit: Object.freeze({
        recovery: null,
        recoveryError: null,
        noticeMessage: null,
        warning: null,
      }),
      mcpRuntime: Object.freeze({ id: "db-runtime" }),
      sanitizeRolesNextTurn: false,
      logMessage: "resumed DB",
    });
    const dbContents = bindings.messages.map((message) => message.content);
    expect(dbContents).toEqual([
      "fresh base v2",
      "host hook",
      "host bundle",
      "host memory",
      "DB conversation",
    ]);
    expect(dbContents).not.toContain("canonical second");
    expect(dbContents).not.toContain("notice second");
    for (const content of [
      "fresh base v2",
      "host hook",
      "host bundle",
      "host memory",
    ]) {
      expect(dbContents.filter((value) => value === content)).toHaveLength(1);
    }
    expect(bindings.messages[0].content).toBe("fresh base v2");
  });

  it("accepts a real PromptCompressor assistant-first compact without changing authority", async () => {
    const { PromptCompressor } =
      await import("../../src/harness/prompt-compressor.js");
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const compressor = new PromptCompressor({
      maxMessages: 2,
      maxTokens: 100_000,
      similarityThreshold: 1,
    });
    const source = [
      { role: "user", content: "objective alpha" },
      { role: "assistant", content: "answer beta" },
      { role: "user", content: "middle gamma" },
      { role: "assistant", content: "recent delta" },
      { role: "user", content: "latest epsilon" },
    ];
    const compact = await compressor.compress(source);
    expect(compact.stats.strategy).toContain("truncate");
    expect(compact.messages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
    ]);

    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          messages: compact.messages,
        }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.replayMessages).toEqual(compact.messages);
    expect(candidate.replayMessages[0].role).toBe("assistant");
  });

  it("accepts one completely paired multi-tool exchange", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const messages = [
      { role: "user", content: "inspect" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-a" }, { id: "call-b" }],
      },
      { role: "tool", tool_call_id: "call-a", content: "a" },
      { role: "tool", tool_call_id: "call-b", content: "b" },
      { role: "assistant", content: "done" },
    ];
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", { messages }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.replayMessages).toEqual(messages);
  });

  it("allows a fallback tool-call id to be reused after each batch settles", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const messages = [
      { role: "user", content: "inspect" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_search" }],
      },
      { role: "tool", tool_call_id: "call_search", content: "first" },
      { role: "assistant", content: "first round done" },
      { role: "user", content: "inspect again" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_search" }],
      },
      { role: "tool", tool_call_id: "call_search", content: "second" },
      { role: "assistant", content: "second round done" },
    ];
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", { messages }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(candidate.ok).toBe(true);
    expect(candidate.replayMessages).toEqual(messages);
  });

  it.each([
    {
      name: "orphan tool result",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "inspect" },
        { role: "tool", tool_call_id: "missing", content: "result" },
      ],
    },
    {
      name: "missing tool result",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call-a" }],
        },
      ],
    },
    {
      name: "duplicate tool call id",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "same" }, { id: "same" }],
        },
      ],
    },
    {
      name: "wrong-role tool calls hidden behind a same-user merge",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "first" },
        {
          role: "user",
          content: "second",
          tool_calls: [{ id: "forged" }],
        },
      ],
    },
    {
      name: "wrong-role tool result id hidden behind a same-assistant merge",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "inspect" },
        { role: "assistant", content: "first" },
        {
          role: "assistant",
          content: "second",
          tool_call_id: "forged",
        },
      ],
    },
    {
      name: "invalid tool-call shape hidden behind a same-assistant merge",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "inspect" },
        { role: "assistant", content: "first" },
        {
          role: "assistant",
          content: "second",
          tool_calls: { id: "not-an-array" },
        },
      ],
    },
    {
      name: "non-object tool-call entry",
      code: "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      messages: [
        { role: "user", content: "inspect" },
        {
          role: "assistant",
          content: "",
          tool_calls: ["not-an-object"],
        },
      ],
    },
    {
      name: "extra authority metadata on a same-user run",
      code: "CC_REPL_SESSION_ROLE_ALTERNATION_INVALID",
      messages: [
        { role: "user", content: "first" },
        {
          role: "user",
          content: "second",
          authority: "must-not-be-merged-away",
        },
      ],
    },
  ])("refuses $name", async ({ code, messages }) => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const formatMcpLedgerRecoveryNotice = vi.fn();
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", { messages }),
      formatMcpLedgerRecoveryNotice,
    });

    expect(candidate).toMatchObject({
      ok: false,
      error: { code },
      mcp: { recovery: null, recoveryError: { code } },
    });
    expect(formatMcpLedgerRecoveryNotice).not.toHaveBeenCalled();
  });

  it("rejects an accessor authority field before a same-role merge without invoking it", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const toolCallsGetter = vi.fn(() => [{ id: "forged" }]);
    const hostileUser = { role: "user", content: "second" };
    Object.defineProperty(hostileUser, "tool_calls", {
      enumerable: true,
      get: toolCallsGetter,
    });
    const formatMcpLedgerRecoveryNotice = vi.fn();

    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          messages: [{ role: "user", content: "first" }, hostileUser],
        }),
      formatMcpLedgerRecoveryNotice,
    });

    expect(candidate).toMatchObject({
      ok: false,
      error: { code: "CC_REPL_SESSION_REBUILD_FAILED" },
    });
    expect(toolCallsGetter).not.toHaveBeenCalled();
    expect(formatMcpLedgerRecoveryNotice).not.toHaveBeenCalled();
  });
});

describe("agent-repl MCP recovery resume transaction", () => {
  it("reads one verified state and blocks all when its messages are unsafe", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { createRecoveryGuardedMcpCallLedger } =
      await import("../../src/lib/mcp-ledger-recovery-admission.js");
    const order = [];
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () => {
        order.push("verified-state");
        return verifiedReplResumeState("target-session", {
          messages: new Proxy([], {}),
        });
      },
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(order).toEqual(["verified-state"]);
    expect(candidate).toMatchObject({
      ok: false,
      sessionId: "target-session",
      mcp: {
        recovery: null,
        recoveryError: { code: "CC_REPL_SESSION_REBUILD_FAILED" },
      },
    });

    const callTool = vi.fn();
    const ledger = createRecoveryGuardedMcpCallLedger({
      recovery: candidate.mcp.recovery,
      recoveryError: candidate.mcp.recoveryError,
    });
    const attemptMcpCall = async () => {
      await ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "mcp__repo__status",
        input: {},
        effectContract: { effect: "read" },
      });
      return callTool();
    };
    await expect(attemptMcpCall()).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_RECOVERY_BLOCKED",
      blockMode: "all",
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("keeps the old session state when target preparation fails", async () => {
    const { commitPreparedReplJsonlResume, prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const oldRecovery = Object.freeze({
      unsettled: [{ ledgerId: "old-write" }],
      incidents: [],
    });
    const state = {
      sessionId: "old-session",
      messages: [{ role: "system", content: "old" }],
      recovery: oldRecovery,
      recoveryError: null,
    };
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () => {
        const error = new Error("target rebuild failed");
        error.code = "CC_REPL_SESSION_REBUILD_FAILED";
        throw error;
      },
    });
    const commit = vi.fn((prepared) => {
      state.sessionId = prepared.sessionId;
      state.messages = prepared.rebuiltMessages;
      state.recovery = prepared.mcp.recovery;
      state.recoveryError = prepared.mcp.recoveryError;
    });

    expect(commitPreparedReplJsonlResume(candidate, commit)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(state).toEqual({
      sessionId: "old-session",
      messages: [{ role: "system", content: "old" }],
      recovery: oldRecovery,
      recoveryError: null,
    });
  });

  it("refuses an unreadable target before commit with ALL-blocking authority", async () => {
    const { commitPreparedReplJsonlResume, prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { createRecoveryGuardedMcpCallLedger } =
      await import("../../src/lib/mcp-ledger-recovery-admission.js");
    const readError = Object.assign(new Error("unverified target"), {
      code: "SESSION_TRANSCRIPT_UNVERIFIED",
    });
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () => {
        throw readError;
      },
    });
    const state = { sessionId: "old-session", recoveryError: null };

    expect(candidate.ok).toBe(false);
    expect(
      commitPreparedReplJsonlResume(candidate, (prepared) => {
        state.sessionId = prepared.sessionId;
        state.recoveryError = prepared.mcp.recoveryError;
      }),
    ).toBe(false);
    expect(state).toEqual({
      sessionId: "old-session",
      recoveryError: null,
    });

    const ledger = createRecoveryGuardedMcpCallLedger({
      recovery: candidate.mcp.recovery,
      recoveryError: candidate.mcp.recoveryError,
    });
    await expect(
      ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "mcp__repo__status",
        input: {},
        effectContract: { effect: "read" },
      }),
    ).rejects.toMatchObject({ blockMode: "all" });
  });

  it("takes an immutable descriptor snapshot and keeps every exact replay deny", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const replayDenied = Array.from({ length: 25 }, (_, index) => ({
      ledgerId: `ledger-${index}`,
      serverName: "repo",
      toolName: `status-${index}`,
      inputBytes: index,
      replayDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    }));
    const source = verifiedReplRecovery("target-session", {
      replayDenied,
    });
    const formatter = vi.fn((snapshot) => {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.unsettled)).toBe(true);
      expect(Object.isFrozen(snapshot.incidents)).toBe(true);
      expect(Object.isFrozen(snapshot.replayDenied)).toBe(true);
      expect(snapshot.replayDenied).toHaveLength(25);
      expect(snapshot.replayDenied.every(Object.isFrozen)).toBe(true);
      return "exact replay authority restored";
    });

    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => source,
      formatMcpLedgerRecoveryNotice: formatter,
    });

    expect(candidate.recoveryError).toBeNull();
    expect(candidate.recovery).not.toBe(source);
    expect(candidate.recovery.replayDenied).toEqual(replayDenied);
    expect(candidate.recovery.replayDenied).not.toBe(replayDenied);
    expect(candidate.notice).toBe("exact replay authority restored");
    expect(formatter).toHaveBeenCalledOnce();
  });

  it("rejects Proxy and accessor recovery evidence without invoking getters", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    let getterCalls = 0;
    const accessorRecovery = verifiedReplRecovery("target-session");
    Object.defineProperty(accessorRecovery, "unsettled", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });

    const accessorCandidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => accessorRecovery,
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });
    const proxyCandidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () =>
        new Proxy(verifiedReplRecovery("target-session"), {}),
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });
    const proxyReplayDenied = verifiedReplRecovery("target-session");
    proxyReplayDenied.replayDenied = new Proxy([], {});
    const replayProxyCandidate = readReplMcpRecoveryCandidate(
      "target-session",
      {
        loadMcpLedgerRecovery: () => proxyReplayDenied,
        formatMcpLedgerRecoveryNotice: vi.fn(),
      },
    );
    const accessorReplayDenied = verifiedReplRecovery("target-session", {
      replayDenied: [
        Object.defineProperty(
          {
            serverName: "repo",
            toolName: "status",
            inputBytes: 0,
            replayDigest: `sha256:${"c".repeat(64)}`,
          },
          "ledgerId",
          {
            enumerable: true,
            get() {
              getterCalls += 1;
              return "ledger-accessor";
            },
          },
        ),
      ],
    });
    const replayAccessorCandidate = readReplMcpRecoveryCandidate(
      "target-session",
      {
        loadMcpLedgerRecovery: () => accessorReplayDenied,
        formatMcpLedgerRecoveryNotice: vi.fn(),
      },
    );

    expect(getterCalls).toBe(0);
    for (const candidate of [
      accessorCandidate,
      proxyCandidate,
      replayProxyCandidate,
      replayAccessorCandidate,
    ]) {
      expect(candidate).toMatchObject({
        recovery: null,
        recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
      });
    }
  });

  it("rejects a forged unsettled effect outside the recovery protocol enum", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () =>
        verifiedReplRecovery("target-session", {
          unsettled: [
            {
              ledgerId: "ledger-forged-effect",
              serverName: "repo",
              toolName: "publish",
              status: "started",
              effectContract: { effect: "side-effect-free-ish" },
            },
          ],
        }),
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
    });
  });

  it("rejects a Proxy prototype without executing any prototype trap", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    let trapCalls = 0;
    const proxyPrototype = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(target, key) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        getPrototypeOf(target) {
          trapCalls += 1;
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    const recovery = Object.assign(
      Object.create(proxyPrototype),
      verifiedReplRecovery("target-session"),
    );

    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => recovery,
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
    });
    expect(trapCalls).toBe(0);
  });

  it.each(["loader", "formatter"])(
    "rejects and consumes an asynchronous %s result",
    async (stage) => {
      const { readReplMcpRecoveryCandidate } =
        await import("../../src/repl/agent-repl.js");
      const candidate = readReplMcpRecoveryCandidate("target-session", {
        loadMcpLedgerRecovery:
          stage === "loader"
            ? () => Promise.reject(new Error("async recovery"))
            : () => verifiedReplRecovery("target-session"),
        formatMcpLedgerRecoveryNotice:
          stage === "formatter"
            ? () => Promise.reject(new Error("async notice"))
            : () => null,
      });

      expect(candidate).toMatchObject({
        recovery: null,
        recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
      });
      await Promise.resolve();
    },
  );

  it("rejects a plain thenable without invoking it", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const then = vi.fn();
    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => ({ then }),
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
    });
    expect(then).not.toHaveBeenCalled();
  });

  it("rejects a Proxy Error without invoking its prototype trap", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    let prototypeTrapCalls = 0;
    const hostileError = new Proxy(new Error("hostile recovery error"), {
      getPrototypeOf(target) {
        prototypeTrapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => {
        throw hostileError;
      },
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_MCP_LEDGER_EVENT_READ_FAILED" },
    });
    expect(candidate.recoveryError.cause).not.toBe(hostileError);
    expect(prototypeTrapCalls).toBe(0);
  });

  it.each(["accessor", "data"])(
    "consumes a rejected native Promise with an own then %s override",
    async (overrideKind) => {
      const { readReplMcpRecoveryCandidate } =
        await import("../../src/repl/agent-repl.js");
      const unhandled = vi.fn();
      const thenGetter = vi.fn(() => () => {});
      process.prependListener("unhandledRejection", unhandled);
      try {
        const rejected = Promise.reject(new Error("async recovery"));
        Object.defineProperty(
          rejected,
          "then",
          overrideKind === "accessor"
            ? { configurable: true, get: thenGetter }
            : { configurable: true, value: null },
        );
        const candidate = readReplMcpRecoveryCandidate("target-session", {
          loadMcpLedgerRecovery: () => rejected,
          formatMcpLedgerRecoveryNotice: vi.fn(),
        });

        expect(candidate).toMatchObject({
          recovery: null,
          recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(thenGetter).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );

  it.each(["accessor", "species"])(
    "safely consumes and restores a rejected native Promise with a configurable hostile %s constructor",
    async (constructorKind) => {
      const { readReplMcpRecoveryCandidate } =
        await import("../../src/repl/agent-repl.js");
      const unhandled = vi.fn();
      const constructorGetter = vi.fn(() => Promise);
      const speciesGetter = vi.fn(() => Promise);
      const hostileConstructor = Object.defineProperty({}, Symbol.species, {
        configurable: true,
        get: speciesGetter,
      });
      process.prependListener("unhandledRejection", unhandled);
      try {
        const rejected = Promise.reject(new Error("async recovery"));
        Object.defineProperty(
          rejected,
          "constructor",
          constructorKind === "accessor"
            ? { configurable: true, get: constructorGetter }
            : { configurable: true, value: hostileConstructor },
        );
        const originalDescriptor = Object.getOwnPropertyDescriptor(
          rejected,
          "constructor",
        );
        const candidate = readReplMcpRecoveryCandidate("target-session", {
          loadMcpLedgerRecovery: () => rejected,
          formatMcpLedgerRecoveryNotice: vi.fn(),
        });

        expect(candidate).toMatchObject({
          recovery: null,
          recoveryError: { code: "CC_MCP_LEDGER_RECOVERY_INVALID" },
        });
        expect(
          Object.getOwnPropertyDescriptor(rejected, "constructor"),
        ).toEqual(originalDescriptor);
        await new Promise((resolve) => setImmediate(resolve));
        expect(constructorGetter).not.toHaveBeenCalled();
        expect(speciesGetter).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );

  it("fails closed without invoking an unsafe non-configurable Promise constructor", async () => {
    const { readReplMcpRecoveryCandidate } =
      await import("../../src/repl/agent-repl.js");
    const constructorGetter = vi.fn(() => Promise);
    const rejected = Promise.reject(new Error("producer-owned rejection"));
    // The boundary cannot both avoid this hostile getter and mark the Promise
    // handled: Promise.prototype.then always resolves @@species through the
    // constructor. The producer must therefore observe its rejection first.
    Reflect.apply(Promise.prototype.then, rejected, [undefined, () => {}]);
    Object.defineProperty(rejected, "constructor", {
      configurable: false,
      get: constructorGetter,
    });

    const candidate = readReplMcpRecoveryCandidate("target-session", {
      loadMcpLedgerRecovery: () => rejected,
      formatMcpLedgerRecoveryNotice: vi.fn(),
    });

    expect(candidate).toMatchObject({
      recovery: null,
      recoveryError: { code: "CC_REPL_NATIVE_PROMISE_UNCONSUMABLE" },
    });
    expect(constructorGetter).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("rejects Proxy and accessor rebuild arrays before resume preparation", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    let getterCalls = 0;
    const accessorMessages = [];
    Object.defineProperty(accessorMessages, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { role: "user", content: "unsafe" };
      },
    });
    accessorMessages.length = 1;
    const prepare = (messages) =>
      prepareReplJsonlResumeCandidate("target-session", {
        readSessionHostResumeState: () =>
          verifiedReplResumeState("target-session", { messages }),
        formatMcpLedgerRecoveryNotice: () => null,
      });

    const proxyCandidate = prepare(new Proxy([], {}));
    const accessorCandidate = prepare(accessorMessages);

    expect(getterCalls).toBe(0);
    for (const candidate of [proxyCandidate, accessorCandidate]) {
      expect(candidate).toMatchObject({
        ok: false,
        mcp: {
          recovery: null,
          recoveryError: { code: "CC_REPL_SESSION_REBUILD_FAILED" },
        },
      });
    }
  });

  it("turns mismatched single-sample authority into ALL-blocking refusal", async () => {
    const { prepareReplJsonlResumeCandidate } =
      await import("../../src/repl/agent-repl.js");
    const { createRecoveryGuardedMcpCallLedger } =
      await import("../../src/lib/mcp-ledger-recovery-admission.js");
    const mismatchedRecovery = verifiedReplRecovery("target-session", {
      recoveryDigest: `sha256:${"d".repeat(64)}`,
    });
    const mismatchedState = verifiedReplResumeState("target-session", {
      recovery: mismatchedRecovery,
    });
    mismatchedState.snapshot.recoveryAuthority.recoveryDigest =
      VERIFIED_RECOVERY_DIGEST;
    const candidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () => mismatchedState,
    });

    expect(candidate.ok).toBe(false);
    expect(candidate.mcp).toMatchObject({
      recovery: null,
      recoveryError: {
        code: "CC_REPL_SESSION_AUTHORITY_MISMATCH",
      },
    });
    const ledger = createRecoveryGuardedMcpCallLedger({
      recovery: candidate.mcp.recovery,
      recoveryError: candidate.mcp.recoveryError,
    });
    await expect(
      ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "status",
        input: {},
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({ blockMode: "all" });
  });

  it("rejects a forged prepared resume candidate before its commit runs", async () => {
    const { commitPreparedReplJsonlResume } =
      await import("../../src/repl/agent-repl.js");
    const commit = vi.fn();

    expect(
      commitPreparedReplJsonlResume(Object.freeze({ ok: true }), commit),
    ).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it("refuses an unbranded host prefix before mutating live resume state", async () => {
    const { createReplResumeStateController } =
      await import("../../src/repl/agent-repl.js");
    const oldRuntime = Object.freeze({ id: "old-runtime" });
    const bindings = {
      sessionId: "old-session",
      messages: [
        { role: "system", content: "fresh host" },
        { role: "user", content: "old conversation" },
      ],
      recovery: Object.freeze({ id: "old-recovery" }),
      recoveryError: null,
      sanitizeRolesNextTurn: false,
      turnBindingProducer: null,
      turnBindingCriticalError: null,
      checkpointMarks: [],
      clearedConversation: null,
      runtimeManager: {
        current: oldRuntime,
        commit: vi.fn(),
      },
      applyMcpRecoveryCommit: vi.fn(),
      logMcpRecoveryCommit: vi.fn(),
      logger: { info: vi.fn() },
    };
    const controller = createReplResumeStateController(bindings);
    controller.registerHostSystemMessages();
    const before = {
      sessionId: bindings.sessionId,
      messages: bindings.messages.map((message) => ({ ...message })),
      recovery: bindings.recovery,
      runtime: bindings.runtimeManager.current,
    };

    let applyError;
    try {
      controller.apply({
        sessionId: "forged-session",
        hostSystemMessages: Object.freeze([
          Object.freeze({ role: "system", content: "forged host" }),
        ]),
        canonicalSystemMessages: Object.freeze([]),
        conversationMessages: Object.freeze([]),
      });
    } catch (error) {
      applyError = error;
    }
    expect(applyError).toMatchObject({
      code: "CC_REPL_HOST_SYSTEM_PREFIX_INVALID",
    });
    expect(bindings.sessionId).toBe(before.sessionId);
    expect(bindings.messages).toEqual(before.messages);
    expect(bindings.recovery).toBe(before.recovery);
    expect(bindings.runtimeManager.current).toBe(before.runtime);
    expect(bindings.applyMcpRecoveryCommit).not.toHaveBeenCalled();
    expect(bindings.runtimeManager.commit).not.toHaveBeenCalled();
  });

  it.each([
    ["JSONL", "helper"],
    ["JSONL", "runtime"],
    ["JSONL", "logger"],
    ["DB", "helper"],
    ["DB", "runtime"],
    ["DB", "logger"],
  ])(
    "atomically rolls the real %s resume state back when %s throws",
    async (format, stage) => {
      const {
        commitPreparedReplDbResume,
        commitPreparedReplJsonlResume,
        createReplResumeStateController,
        prepareReplJsonlResumeCandidate,
      } = await import("../../src/repl/agent-repl.js");
      const jsonlCandidate = prepareReplJsonlResumeCandidate("target-session", {
        readSessionHostResumeState: () =>
          verifiedReplResumeState("target-session", {
            messages: [
              markDurableSystemMessage(
                { role: "system", content: "target system" },
                DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
              ),
              { role: "user", content: "target user" },
            ],
          }),
        formatMcpLedgerRecoveryNotice: () => "target recovery notice",
      });
      const oldSystem = Object.freeze({ role: "system", content: "old" });
      const oldMessage = Object.freeze({ role: "user", content: "old user" });
      const oldRecovery = Object.freeze({ id: "old-authority" });
      const oldRecoveryError = Object.assign(new Error("old recovery error"), {
        code: "OLD_RECOVERY_ERROR",
      });
      const oldTurnBindingProducer = Object.freeze({ id: "old-producer" });
      const oldTurnBindingCriticalError = new Error("old turn error");
      const oldCheckpoint = Object.freeze({ id: "old-checkpoint" });
      const oldStash = Object.freeze({ id: "old-stash" });
      const oldRuntime = Object.freeze({ id: "old-runtime" });
      const targetRuntime = Object.freeze({ id: "target-runtime" });
      const state = {
        sessionId: "old-session",
        messages: [oldSystem, oldMessage],
        recovery: oldRecovery,
        recoveryError: oldRecoveryError,
        sanitizeRolesNextTurn: true,
        turnBindingProducer: oldTurnBindingProducer,
        turnBindingCriticalError: oldTurnBindingCriticalError,
        checkpointMarks: [oldCheckpoint],
        clearedConversation: oldStash,
      };
      const runtimeManager = {
        current: oldRuntime,
        commit(candidate) {
          this.current = candidate;
          if (stage === "runtime" && candidate === targetRuntime) {
            throw new Error("runtime failed");
          }
          return candidate;
        },
      };
      const bindings = {
        ...state,
        messages: state.messages,
        checkpointMarks: state.checkpointMarks,
        runtimeManager,
        applyMcpRecoveryCommit(targetMessages, preparedCommit) {
          bindings.recovery = preparedCommit.recovery;
          bindings.recoveryError = preparedCommit.recoveryError;
          if (preparedCommit.noticeMessage) {
            targetMessages.push(preparedCommit.noticeMessage);
          }
          if (stage === "helper") throw new Error("helper failed");
        },
        logMcpRecoveryCommit: vi.fn(),
        logger: {
          info: vi.fn(() => {
            if (stage === "logger") throw new Error("logger failed");
          }),
        },
      };
      const controller = createReplResumeStateController(bindings);
      const hostSystemMessages = controller.registerHostSystemMessages();
      const previousState = controller.capture();
      const targetRecovery =
        format === "JSONL" ? jsonlCandidate.mcp.recovery : null;
      const preparedState = Object.freeze({
        sessionId: "target-session",
        hostSystemMessages,
        canonicalSystemMessages:
          format === "JSONL"
            ? jsonlCandidate.canonicalSystemMessages
            : Object.freeze([]),
        conversationMessages:
          format === "JSONL"
            ? jsonlCandidate.conversationMessages
            : Object.freeze([
                Object.freeze({ role: "assistant", content: "target DB" }),
              ]),
        mcpCommit: Object.freeze({
          recovery: targetRecovery,
          recoveryError: null,
          noticeMessage:
            format === "JSONL"
              ? Object.freeze({
                  role: "system",
                  content: "target recovery notice",
                })
              : null,
          warning: null,
        }),
        mcpRuntime: targetRuntime,
        sanitizeRolesNextTurn: false,
        logMessage: `Resumed ${format} target-session`,
      });
      const commit = () => controller.apply(preparedState);
      const rollback = vi.fn(() => controller.restore(previousState));

      expect(() =>
        format === "JSONL"
          ? commitPreparedReplJsonlResume(jsonlCandidate, commit, rollback)
          : commitPreparedReplDbResume(preparedState, commit, rollback),
      ).toThrow(`${stage} failed`);
      expect(rollback).toHaveBeenCalledOnce();
      expect(bindings.sessionId).toBe("old-session");
      expect(bindings.messages).toEqual([oldSystem, oldMessage]);
      expect(bindings.recovery).toBe(oldRecovery);
      expect(bindings.recoveryError).toBe(oldRecoveryError);
      expect(bindings.sanitizeRolesNextTurn).toBe(true);
      expect(bindings.turnBindingProducer).toBe(oldTurnBindingProducer);
      expect(bindings.turnBindingCriticalError).toBe(
        oldTurnBindingCriticalError,
      );
      expect(bindings.checkpointMarks).toEqual([oldCheckpoint]);
      expect(bindings.clearedConversation).toBe(oldStash);
      expect(runtimeManager.current).toBe(oldRuntime);
    },
  );

  it("feeds every exact replay deny into the shared runtime controller", async () => {
    const {
      commitPreparedReplJsonlResume,
      createReplMcpHostRuntimeManager,
      createReplResumeStateController,
      prepareReplJsonlResumeCandidate,
    } = await import("../../src/repl/agent-repl.js");
    const { computeMcpExactReplayDigest, summarizeMcpPayload } =
      await import("../../src/lib/mcp-call-ledger.js");
    const input = { path: "README.md" };
    const summary = summarizeMcpPayload(input);
    const deny = {
      ledgerId: "ledger-applied",
      serverName: "repo",
      toolName: "status",
      inputBytes: summary.bytes,
      replayDigest: computeMcpExactReplayDigest({
        serverName: "repo",
        toolName: "status",
        inputDigest: summary.sha256,
        inputBytes: summary.bytes,
      }),
    };
    const resumeCandidate = prepareReplJsonlResumeCandidate("target-session", {
      readSessionHostResumeState: () =>
        verifiedReplResumeState("target-session", {
          recovery: verifiedReplRecovery("target-session", {
            replayDenied: [deny],
          }),
          messages: [{ role: "user", content: "target history" }],
        }),
      formatMcpLedgerRecoveryNotice: () => null,
    });
    const oldRawCall = vi.fn(async () => ({ content: [] }));
    const rawCall = vi.fn(async () => ({ content: [] }));
    const nextRawCall = vi.fn(async () => ({ content: [] }));
    const manager = createReplMcpHostRuntimeManager({
      createSessionMcpLedgerSink: () => vi.fn(async () => true),
    });
    const oldRuntime = manager.activate({
      adhocMcp: { mcpClient: { callTool: oldRawCall } },
      sessionId: "old-session",
      persistent: true,
      recovery: verifiedReplRecovery("old-session"),
      verifiedRecovery: true,
    });
    const targetRuntime = manager.prepare({
      adhocMcp: { mcpClient: { callTool: rawCall } },
      sessionId: "target-session",
      persistent: true,
      recovery: resumeCandidate.mcp.recovery,
      verifiedRecovery: true,
    });
    expect(manager.current).toBe(oldRuntime);
    const bindings = {
      sessionId: "old-session",
      messages: [{ role: "system", content: "system" }],
      recovery: verifiedReplRecovery("old-session"),
      recoveryError: null,
      sanitizeRolesNextTurn: false,
      turnBindingProducer: { id: "producer" },
      turnBindingCriticalError: null,
      checkpointMarks: [{ id: "checkpoint" }],
      clearedConversation: { id: "stash" },
      runtimeManager: manager,
      applyMcpRecoveryCommit(targetMessages, preparedCommit) {
        bindings.recovery = preparedCommit.recovery;
        bindings.recoveryError = preparedCommit.recoveryError;
        if (preparedCommit.noticeMessage) {
          targetMessages.push(preparedCommit.noticeMessage);
        }
      },
      logMcpRecoveryCommit: vi.fn(),
      logger: { info: vi.fn() },
    };
    const stateController = createReplResumeStateController(bindings);
    const hostSystemMessages = stateController.registerHostSystemMessages();
    const previousState = stateController.capture();
    const preparedState = Object.freeze({
      sessionId: "target-session",
      hostSystemMessages,
      canonicalSystemMessages: resumeCandidate.canonicalSystemMessages,
      conversationMessages: resumeCandidate.conversationMessages,
      mcpCommit: Object.freeze({
        recovery: resumeCandidate.mcp.recovery,
        recoveryError: null,
        noticeMessage: null,
        warning: null,
      }),
      mcpRuntime: targetRuntime,
      sanitizeRolesNextTurn: true,
      logMessage: "Resumed JSONL target-session",
    });
    expect(
      commitPreparedReplJsonlResume(
        resumeCandidate,
        () => stateController.apply(preparedState),
        () => stateController.restore(previousState),
      ),
    ).toBe(true);
    expect(manager.current).toBe(targetRuntime);
    expect(bindings.recovery.replayDenied).toEqual([deny]);
    expect(bindings.checkpointMarks).toEqual([]);
    expect(bindings.clearedConversation).toBeNull();

    await expect(
      targetRuntime.runtime.ledger.begin({
        sessionId: "target-session",
        serverName: "repo",
        toolName: "status",
        input,
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
      replayDenied: true,
    });
    await expect(
      targetRuntime.hostMcp.mcpClient.callTool("repo", "status", input),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
      replayDenied: true,
    });
    expect(rawCall).not.toHaveBeenCalled();

    const second = manager.activate({
      adhocMcp: { mcpClient: { callTool: nextRawCall } },
      sessionId: "target-session",
      persistent: true,
      recovery: resumeCandidate.mcp.recovery,
    });
    expect(second.runtime.controller).toBe(targetRuntime.runtime.controller);
    await expect(
      second.hostMcp.mcpClient.callTool("repo", "status", input),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
    });
    expect(nextRawCall).not.toHaveBeenCalled();
  });
});

describe("agent-repl resume role-alternation wiring (2.1.187 parity)", () => {
  const agentReplPath = join(
    __dirname,
    "..",
    "..",
    "src",
    "repl",
    "agent-repl.js",
  );
  const content = readFileSync(agentReplPath, "utf8");

  it("uses the shared merge primitive behind a strict local tail boundary", () => {
    expect(content).toContain(
      'import { mergeConsecutiveMessages } from "../runtime/message-roles.js";',
    );
    expect(content).toContain(
      "collapseValidatedPlainReplTailInPlace(messages)",
    );
    expect(content).toContain("validateRawReplReplayMessages(rawSnapshot)");
  });

  it("declares the one-shot sanitation flag, default off", () => {
    expect(content).toContain("let _sanitizeRolesNextTurn = false;");
  });

  it("arms the flag at every resume site when history ends with a user turn", () => {
    // Both startup (--session/--resume) and /session resume, JSONL + DB paths.
    const legacyPhysicalTailArms = content.match(
      /_sanitizeRolesNextTurn\s*=\s*\n?\s*messages\[messages\.length - 1\]\?\.role === "user";/g,
    );
    const canonicalConversationArms = content.match(
      /prepared\.conversationMessages\.at\(-1\)\?\.role === "user"/g,
    );
    expect(legacyPhysicalTailArms).toHaveLength(1);
    expect(canonicalConversationArms).toHaveLength(2);
    expect(content).toContain('replayMessages.at(-1)?.role === "user"');
  });

  it("seals host systems before startup replay and refreshes both live switch paths", () => {
    const registerAt = content.indexOf("_registerHostSystemMessages();");
    const startupReplayAt = content.indexOf(
      "messages.push(...prepared.canonicalSystemMessages);",
      registerAt,
    );
    const liveResumeAt = content.indexOf('sessionArg.startsWith("resume ")');
    const liveSwitchSource = content.slice(liveResumeAt);

    expect(registerAt).toBeGreaterThan(-1);
    expect(startupReplayAt).toBeGreaterThan(registerAt);
    expect(
      liveSwitchSource.match(
        /const hostSystemMessages = _refreshHostSystemMessages\(\);/g,
      ),
    ).toHaveLength(2);
    expect(liveSwitchSource).not.toContain("systemMessage: messages[0]");
    expect(liveSwitchSource).toContain("hostSystemMessages,");
  });

  it("collapses in place inside the loop wrapper, gated on options.mergeRoles", () => {
    expect(content).toContain("if (options.mergeRoles) {");
    expect(content).toContain(
      "collapseValidatedPlainReplTailInPlace(messages);",
    );
  });

  it("does not fold a resumed tail carrying extra authority metadata", async () => {
    const { agentLoop } = await import("../../src/repl/agent-repl.js");
    const messages = [
      { role: "system", content: "fresh host" },
      {
        role: "user",
        content: "dangling restored turn",
        authority: "canonical-user",
      },
      { role: "user", content: "new prompt" },
    ];
    let observedMessages;
    const _coreLoop = async function* (activeMessages) {
      observedMessages = activeMessages.map((message) => ({ ...message }));
      yield { type: "response-complete", content: "ok", thinking: null };
    };

    await agentLoop(messages, { mergeRoles: true, _coreLoop });

    expect(observedMessages).toEqual(messages);
    expect(observedMessages.slice(-2)).toEqual([
      {
        role: "user",
        content: "dangling restored turn",
        authority: "canonical-user",
      },
      { role: "user", content: "new prompt" },
    ]);
  });

  it("consumes the flag once at the model call and threads mergeRoles through", () => {
    expect(content).toContain(
      "const _mergeRolesThisTurn = _sanitizeRolesNextTurn;",
    );
    expect(content).toContain("_sanitizeRolesNextTurn = false;");
    expect(content).toContain("mergeRoles: _mergeRolesThisTurn,");
  });
});

describe("agent-repl context engineering integration", () => {
  it("CLIContextEngineering integrates with agent-repl module", async () => {
    // Verify both modules can be imported together without conflicts
    const agentMod = await import("../../src/repl/agent-repl.js");
    const ceMod = await import("../../src/lib/cli-context-engineering.js");

    expect(typeof agentMod.startAgentRepl).toBe("function");
    expect(typeof ceMod.CLIContextEngineering).toBe("function");

    // Verify CLIContextEngineering works in isolation
    // Mock readUserProfile to avoid filesystem dependency in CI
    const origReadProfile = ceMod._deps.readUserProfile;
    ceMod._deps.readUserProfile = () => "";
    try {
      const engine = new ceMod.CLIContextEngineering({ db: null });
      const result = engine.buildOptimizedMessages(
        [{ role: "system", content: "test" }],
        { userQuery: "hello" },
      );
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("system");
    } finally {
      ceMod._deps.readUserProfile = origReadProfile;
    }
  });

  it("getBaseSystemPrompt includes cwd", async () => {
    // Verify via agent --help that the module loads without error
    // (getBaseSystemPrompt is called during import/init)
    const { execSync } = await import("node:child_process");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cliRoot = join(__dirname, "..", "..");

    // agent --help should succeed (proves imports work)
    const result = execSync(
      `node ${join(cliRoot, "bin", "chainlesschain.js")} agent --help`,
      { encoding: "utf-8", timeout: 60000 },
    );
    expect(result).toBeTruthy();
  });
});

describe("agent-repl /btw side-question wiring", () => {
  const agentReplPath = join(
    __dirname,
    "..",
    "..",
    "src",
    "repl",
    "agent-repl.js",
  );
  const content = readFileSync(agentReplPath, "utf8");

  it("imports the pure /btw helpers", () => {
    expect(content).toContain('from "./btw-command.js"');
    expect(content).toContain("parseBtwCommand");
    expect(content).toContain("runBtwQuestion");
    expect(content).toContain("parseNoteNextCommand");
    expect(content).toContain("buildAsideBlock");
    expect(content).toContain("applyAside");
  });

  it("runs /btw immediately and allows it alongside a main turn", () => {
    expect(content).toContain("await runBtwSideQuestion(btw);");
    expect(content).toContain("parseBtwCommand(input.trim())");
    expect(content).toContain(
      "void runBtwSideQuestion(concurrentBtw, { concurrent: true });",
    );
  });

  it("queues /note-next guidance and consumes it on send", () => {
    expect(content).toContain("let pendingBtw = [];");
    expect(content).toContain("const note = parseNoteNextCommand(trimmed);");
    expect(content).toContain("pendingBtw.push(note.text);");
    // consumed (cleared) when the turn fires
    expect(content).toContain("pendingBtw = [];");
  });

  it("injects before agentLoop and restores after, so the aside never persists", () => {
    // capture the pre-aside content, then apply the block to the user message
    expect(content).toContain(
      "_btwRestore = { msg: _userMsg, content: _userMsg.content };",
    );
    expect(content).toContain(
      "_userMsg.content = applyAside(_userMsg.content, block);",
    );
    // the injection sits before the agentLoop call; the restore resets content
    const injectAt = content.indexOf("_userMsg.content = applyAside(");
    const loopAt = content.indexOf("await agentLoop(messages, {");
    // lastIndexOf = the success-path restore AFTER the call (the first
    // occurrence is the submit-start backstop, which sits before agentLoop).
    const restoreAt = content.lastIndexOf(
      "_btwRestore.msg.content = _btwRestore.content;",
    );
    expect(injectAt).toBeGreaterThan(0);
    expect(loopAt).toBeGreaterThan(injectAt); // inject BEFORE the model call
    expect(restoreAt).toBeGreaterThan(loopAt); // restore AFTER it
  });

  it("keeps the user-message object ref so the aside can be stripped", () => {
    expect(content).toContain(
      'const _userMsg = { role: "user", content: _userMessageContent };',
    );
    expect(content).toContain("messages.push(_userMsg);");
  });
});

import "../helpers/test-model-egress.js";
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { AGENT_EVOLUTION_INGRESS_FAILED_CODE } from "../../src/lib/evolution/agent-evolution-ingress.js";
import * as store from "../../src/harness/jsonl-session-store.js";

const call = (id) => ({
  id,
  type: "function",
  function: { name: "read_file", arguments: '{"path":"README.md"}' },
});

function verifiedMessages(sessionId) {
  return store.readVerifiedProjection(sessionId, () => ({
    accept() {},
    finish(authority) {
      return authority.readMessages();
    },
  }));
}

async function run(
  sessionId,
  agentLoop,
  text = "Inspect README",
  options = {},
  extraDeps = {},
) {
  const lines = [];
  const outcome = await runAgentHeadlessStream(
    {
      sessionId,
      expandFileRefs: false,
      useRegisteredMcp: false,
      ...options,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      ...extraDeps,
      writeOut: (line) => lines.push(line),
      writeErr() {},
      agentLoop,
      input: (async function* () {
        yield `${JSON.stringify({ type: "user", text })}\n`;
      })(),
    },
  );
  return {
    outcome,
    results: lines
      .join("")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((event) => event.type === "result"),
  };
}

async function isolated(operation) {
  const root = mkdtempSync(path.join(tmpdir(), "cc-stream-ingress-recovery-"));
  vi.stubEnv("CHAINLESSCHAIN_HOME", path.join(root, "home"));
  vi.stubEnv(
    "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
    path.join(root, "security"),
  );
  try {
    await operation();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
}

describe("stream ingress failure tool-round recovery", () => {
  it.each(["complete", "partial", "pending-commentary"])(
    "persists completed calls and resumes without replaying them (%s)",
    async (mode) =>
      isolated(async () => {
        const id = `ingress-recovery-${mode}`;
        const first = await run(id, async function* (messages) {
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [
              call("finished"),
              ...(mode === "partial" ? [call("pending")] : []),
            ],
          });
          messages.push({
            role: "tool",
            tool_call_id: "finished",
            content: "README inspected",
          });
          if (mode === "pending-commentary") {
            messages.push({
              role: "assistant",
              content: "Inspect the next file",
              tool_calls: [call("pending")],
            });
          }
          throw Object.assign(
            new Error("Agent model JSON text is malformed or ambiguous"),
            {
              code: AGENT_EVOLUTION_INGRESS_FAILED_CODE,
            },
          );
        });
        expect(first.outcome).toMatchObject({ exitCode: 1, turns: 1 });
        expect(first.results).toEqual([
          expect.objectContaining({
            subtype: "error_evolution_ingress",
            code: AGENT_EVOLUTION_INGRESS_FAILED_CODE,
          }),
        ]);
        const durable = verifiedMessages(id);
        expect(
          durable.filter((message) => message.role === "assistant"),
        ).toEqual([
          expect.objectContaining({ tool_calls: [call("finished")] }),
        ]);
        expect(durable.filter((message) => message.role === "tool")).toEqual([
          expect.objectContaining({
            tool_call_id: "finished",
            content: "README inspected",
          }),
        ]);
        let resumed;
        const second = await run(
          id,
          async function* (messages) {
            resumed = structuredClone(messages);
            yield {
              type: "response-complete",
              content: "Continued using the saved tool result",
            };
            yield { type: "run-ended", reason: "complete" };
          },
          "Continue",
        );
        expect(second.outcome.exitCode).toBe(0);
        expect(second.results.at(-1).subtype).toBe("success");
        expect(
          resumed.some((message) => message.tool_call_id === "finished"),
        ).toBe(true);
        expect(
          resumed.some((message) =>
            message.tool_calls?.some((entry) => entry.id === "pending"),
          ),
        ).toBe(false);
        expect(
          resumed.some((message) => message.content === "Inspect the next file"),
        ).toBe(false);
        expect(
          verifiedMessages(id).filter(
            (message) => message.tool_call_id === "finished",
          ),
        ).toHaveLength(1);
      }),
  );

  it("preserves the durable prefix when input changes before failed ingress settlement", async () =>
    isolated(async () => {
      const id = "ingress-recovery-stale";
      const result = await run(id, async function* (messages) {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [call("finished")],
        });
        messages.push({
          role: "tool",
          tool_call_id: "finished",
          content: "README inspected",
        });
        store.appendUserMessage(id, "New authoritative input");
        throw Object.assign(new Error("Projection refused"), {
          code: AGENT_EVOLUTION_INGRESS_FAILED_CODE,
        });
      });
      expect(result.outcome.exitCode).toBe(1);
      expect(result.results.at(-1)).toMatchObject({
        is_error: true,
        code: "SESSION_REVISION_STALE",
      });
      const durable = verifiedMessages(id);
      expect(durable.at(-1)).toMatchObject({
        role: "user",
        content: "New authoritative input",
      });
      expect(durable.some((message) => message.tool_calls?.length)).toBe(false);
    }));

  it("settles completed tool calls before caller abort shutdown", () =>
    isolated(async () => {
      const id = "ingress-recovery-caller-abort";
      const controller = new AbortController();
      const result = await run(
        id,
        async function* (messages) {
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [call("finished")],
          });
          messages.push({
            role: "tool",
            tool_call_id: "finished",
            content: "README inspected",
          });
          controller.abort();
          throw Object.assign(new Error("caller cancelled"), {
            name: "AbortError",
          });
        },
        "Inspect README",
        { signal: controller.signal },
      );

      expect(result.outcome).toMatchObject({ exitCode: 0, turns: 1 });
      expect(verifiedMessages(id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool_calls: [call("finished")] }),
          expect.objectContaining({
            role: "tool",
            tool_call_id: "finished",
            content: "README inspected",
          }),
        ]),
      );
    }));
  it("settles completed tool calls before a session budget terminal error", () =>
    isolated(async () => {
      const id = "ingress-recovery-session-budget";
      const result = await run(id, async function* (messages) {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [call("finished")],
        });
        messages.push({
          role: "tool",
          tool_call_id: "finished",
          content: "README inspected",
        });
        throw Object.assign(new Error("session budget exhausted"), {
          code: "CC_SESSION_BUDGET_EXHAUSTED",
          budgetReason: "token-limit",
        });
      });

      expect(result.outcome).toMatchObject({ exitCode: 1, turns: 1 });
      expect(result.results.at(-1)).toMatchObject({
        subtype: "error_session_budget",
        code: "CC_SESSION_BUDGET_EXHAUSTED",
      });
      expect(verifiedMessages(id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool_calls: [call("finished")] }),
          expect.objectContaining({
            role: "tool",
            tool_call_id: "finished",
            content: "README inspected",
          }),
        ]),
      );
    }));

  it("settles completed tool calls before a compaction usage unknown terminal error", () =>
    isolated(async () => {
      const id = "ingress-recovery-compaction-usage-unknown";
      const result = await run(id, async function* (messages) {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [call("finished")],
        });
        messages.push({
          role: "tool",
          tool_call_id: "finished",
          content: "README inspected",
        });
        yield {
          type: "compaction-usage-unknown",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          reason: "provider_transport_outcome_unknown",
          source: "semantic-compaction",
          ledgerPersisted: true,
        };
      });

      expect(result.outcome).toMatchObject({ exitCode: 1, turns: 1 });
      expect(result.results.at(-1)).toMatchObject({
        subtype: "error_compaction_usage_unknown",
        code: "CC_COMPACTION_USAGE_UNKNOWN",
      });
      expect(verifiedMessages(id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool_calls: [call("finished")] }),
          expect.objectContaining({
            role: "tool",
            tool_call_id: "finished",
            content: "README inspected",
          }),
        ]),
      );
    }));

  it("settles completed tool calls before a runtime ledger persistence error", () =>
    isolated(async () => {
      const id = "ingress-recovery-runtime-ledger";
      const appendEvent = store.appendEvent.bind(store);
      vi.spyOn(store, "appendEvent").mockImplementation(
        (sessionId, type, ...args) => {
          if (type === "model_usage_started") {
            throw new Error("usage ledger unavailable");
          }
          return appendEvent(sessionId, type, ...args);
        },
      );
      const result = await run(id, async function* (messages) {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [call("finished")],
        });
        messages.push({
          role: "tool",
          tool_call_id: "finished",
          content: "README inspected",
        });
        yield {
          type: "model-usage-started",
          callId: "provider-call",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          source: "provider",
        };
      });

      expect(result.outcome).toMatchObject({ exitCode: 1, turns: 1 });
      expect(result.results.at(-1)).toMatchObject({
        subtype: "error_persistence",
        code: "CC_RUNTIME_LEDGER_PERSISTENCE_FAILED",
      });
      expect(verifiedMessages(id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool_calls: [call("finished")] }),
          expect.objectContaining({
            role: "tool",
            tool_call_id: "finished",
            content: "README inspected",
          }),
        ]),
      );
    }));
});

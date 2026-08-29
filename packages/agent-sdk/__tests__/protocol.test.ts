import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import {
  contentDelta,
  isAgentEvent,
  isKnownAgentEvent,
  isApprovalRequest,
  isContentDelta,
  isQuestionRequest,
  isMcpElicitationRequest,
  isResult,
  isSystemInit,
  type AgentStreamEvent,
} from "../src/protocol.js";
import {
  CC_AGENT_STREAM_EVENT_TYPES,
  isApprovalDecision,
  validateAgentStreamEvent,
  validateApprovalDecision,
  validateCanonicalAgentStreamEvent,
} from "../src/generated/app-protocol.js";

const CONTEXT_MEMORY_CONFORMANCE_SCENARIOS = [
  "multilingual-window-512",
  "multilingual-window-4096",
  "parallel-tools-pending",
  "orphan-late-tool-result",
  "overlapping-scopes",
  "provider-normal",
  "provider-failure",
  "provider-usage-unknown",
  "provider-cancelled",
  "crash-restart",
  "cas-race",
  "index-rebuild",
  "offline-replica-reinjection",
  "partial-delete-reconcile",
] as const;

const CONTEXT_MEMORY_CONFORMANCE_SURFACES = [
  "cli-js",
  "desktop-js",
  "app-server",
  "typescript-sdk",
  "python-sdk",
  "vscode",
  "jetbrains",
] as const;

function readContextMemoryProjectionFixture(): Array<{
  method: string;
  type: string;
  memoryId: string;
  memoryRevision: number | null;
  recordMemoryId: string;
  expectedMemoryCount: number | null;
  scenarioId: string;
  surfaces: string[];
}> {
  return readFileSync(
    new URL(
      "../../context-memory-kernel/fixtures/cross-surface-projection-v1.tsv",
      import.meta.url,
    ),
    "utf8",
  )
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => {
      const [
        method,
        type,
        memoryId,
        memoryRevision,
        recordMemoryId,
        expectedMemoryCount,
        scenarioId,
        ,
        surfaces,
      ] = line.split("\t");
      return {
        method,
        type,
        memoryId: memoryId === "-" ? "" : memoryId,
        memoryRevision: memoryRevision !== "-" ? Number(memoryRevision) : null,
        recordMemoryId: recordMemoryId === "-" ? "" : recordMemoryId,
        expectedMemoryCount:
          expectedMemoryCount !== "-" ? Number(expectedMemoryCount) : null,
        scenarioId,
        surfaces: surfaces.split(",").filter(Boolean),
      };
    });
}

describe("protocol type guards", () => {
  it("consumes the canonical Context/Memory cross-surface fixture", () => {
    const rows = readContextMemoryProjectionFixture();
    const memories = new Set<string>();
    let memoryRevision = 0;
    const events = rows.filter((entry) =>
      ["context/event", "memory/event"].includes(entry.method),
    );
    for (const row of events) {
      expect(CC_AGENT_STREAM_EVENT_TYPES, row.type).toContain(row.type);
      if (row.memoryRevision != null) memoryRevision = row.memoryRevision;
      if (row.recordMemoryId) memories.add(row.recordMemoryId);
      if (row.type === "memory.purged") memories.delete(row.memoryId);
    }
    const expected = rows.find((row) => row.method === "expected");
    expect(memoryRevision).toBe(expected?.memoryRevision);
    expect(memories.size).toBe(expected?.expectedMemoryCount);
    const scenarios = rows.filter((row) => row.method === "fixture");
    expect(scenarios.map((row) => row.scenarioId).sort()).toEqual(
      [...CONTEXT_MEMORY_CONFORMANCE_SCENARIOS].sort(),
    );
    for (const scenario of scenarios) {
      expect([...scenario.surfaces].sort()).toEqual(
        [...CONTEXT_MEMORY_CONFORMANCE_SURFACES].sort(),
      );
    }
  });

  it("validates canonical structured approval decisions from the generated schema", () => {
    expect(isApprovalDecision({ kind: "acceptOnce" })).toBe(true);
    expect(
      isApprovalDecision({
        kind: "acceptForSession",
        permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
      }),
    ).toBe(true);
    expect(
      validateApprovalDecision({ kind: "acceptOnce", unexpected: true }),
    ).toMatchObject({ ok: false });
    expect(isApprovalDecision({ kind: "allowEverything" })).toBe(false);
  });

  it("matches the shared ApprovalDecision conformance fixture", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          "../../agent-protocol/test/fixtures/approval-decisions.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Array<{ name: string; valid: boolean; value: unknown }>;
    for (const fixture of fixtures) {
      expect(validateApprovalDecision(fixture.value).ok, fixture.name).toBe(
        fixture.valid,
      );
    }
  });

  it("isAgentEvent requires an object with a string type", () => {
    expect(isAgentEvent({ type: "result" })).toBe(true);
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent("result")).toBe(false);
    expect(isAgentEvent({ type: 42 })).toBe(false);
  });

  it("distinguishes canonical event types without breaking future events", () => {
    expect(isKnownAgentEvent({ type: "structured_result", value: 42 })).toBe(
      true,
    );
    expect(isKnownAgentEvent({ type: "future_event_v2" })).toBe(false);
    expect(isAgentEvent({ type: "future_event_v2", payload: 1 })).toBe(true);
    expect(validateAgentStreamEvent({ type: "result", seq: 0 })).toMatchObject({
      ok: false,
    });
  });

  it("matches the shared Agent stream event conformance fixture", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          "../../agent-protocol/test/fixtures/agent-stream-events.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Array<{
      name: string;
      valid: boolean;
      value: Record<string, unknown>;
      injectUndefinedAt?: string;
    }>;
    for (const fixture of fixtures) {
      const value = structuredClone(fixture.value);
      if (fixture.injectUndefinedAt === "payload.missing") {
        (value.payload as Record<string, unknown>).missing = undefined;
      }
      expect(validateAgentStreamEvent(value).ok, fixture.name).toBe(
        fixture.valid,
      );
    }
  });

  it("matches the shared canonical Agent payload fixture", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          "../../agent-protocol/test/fixtures/canonical-agent-stream-payloads.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Array<{ name: string; valid: boolean; value: unknown }>;
    for (const fixture of fixtures) {
      expect(
        validateCanonicalAgentStreamEvent(fixture.value).ok,
        fixture.name,
      ).toBe(fixture.valid);
    }
  });

  it("recognizes every current output discriminator in the shared NDJSON corpus", () => {
    const fixtureRoot = new URL("../__fixtures__/protocol/", import.meta.url);
    const inputOnly = new Set(["slash_command"]);
    const intentionallyFuture = new Set(["totally_new_event_v9"]);
    for (const file of readdirSync(fixtureRoot).filter((name) =>
      name.endsWith(".ndjson"),
    )) {
      const lines = readFileSync(new URL(file, fixtureRoot), "utf8")
        .split(/\r?\n/u)
        .filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (
          inputOnly.has(String(event.type)) ||
          intentionallyFuture.has(String(event.type))
        ) {
          continue;
        }
        expect(isKnownAgentEvent(event), `${file}: ${String(event.type)}`).toBe(
          true,
        );
      }
    }
  });

  it("isSystemInit matches only init with a session_id", () => {
    expect(
      isSystemInit({
        type: "system",
        subtype: "init",
        session_id: "s-1",
      } as AgentStreamEvent),
    ).toBe(true);
    expect(
      isSystemInit({ type: "system", subtype: "end" } as AgentStreamEvent),
    ).toBe(false);
    expect(
      isSystemInit({ type: "system", subtype: "init" } as AgentStreamEvent),
    ).toBe(false);
  });

  it("contentDelta extracts text and thinking deltas", () => {
    const text: AgentStreamEvent = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      },
    };
    const thinking: AgentStreamEvent = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "hmm" },
      },
    };
    expect(contentDelta(text)).toEqual({ kind: "text", text: "hi" });
    expect(contentDelta(thinking)).toEqual({ kind: "thinking", text: "hmm" });
    expect(isContentDelta({ type: "tool_use", tool: "x" })).toBe(false);
    expect(contentDelta({ type: "result" } as AgentStreamEvent)).toBeNull();
  });

  it("approval / question / result guards", () => {
    expect(
      isApprovalRequest({
        type: "approval_request",
        id: "appr-1",
        tool: "shell",
        command: "rm -rf x",
        risk: "high",
        rule: null,
        reason: null,
      }),
    ).toBe(true);
    expect(
      isApprovalRequest({ type: "approval_request" } as AgentStreamEvent),
    ).toBe(false);
    expect(
      isQuestionRequest({ type: "question_request", id: "q-1", question: "?" }),
    ).toBe(true);
    expect(
      isMcpElicitationRequest({
        type: "question_request",
        id: "mcp-1",
        question: "?",
        metadata: { kind: "mcp_elicitation" },
      }),
    ).toBe(true);
    expect(isResult({ type: "result" } as AgentStreamEvent)).toBe(true);
  });
});

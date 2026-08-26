/**
 * Cross-language protocol fixture contract (TypeScript side).
 *
 * Drives the VS Code extension's real event mapper
 * (`packages/vscode-extension/src/chat/chat-events.js` — the TS/JS panel
 * consumer of Agent Protocol v1) over the SHARED NDJSON fixtures in
 * `__fixtures__/protocol/`, asserting the stable UI projection matches
 * `expected.json`. The JetBrains twin (`ProtocolFixturesTest.java`) reads the
 * SAME files and asserts the same projections against `ChatEvents.java`, so the
 * two IDE panels can never silently diverge.
 *
 * The fixtures are the contract behind docs/PROTOCOL.md — see
 * __fixtures__/protocol/README.md for the projection schema + turn-state rule.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PROTOCOL_FEATURES,
  isSlashCommandResult,
  type AgentInputEvent,
  type AgentStreamEvent,
  type SlashCommandInput,
  type SlashCommandResultEvent,
  type SystemInitEvent,
  type ToolResultEvent,
} from "../src/protocol.js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "__fixtures__", "protocol");

// The real panel mapper (CommonJS) — never a re-implementation.
const chatEvents = require(
  join(here, "..", "..", "vscode-extension", "src", "chat", "chat-events.js"),
) as {
  mapAgentEvent: (
    evt: unknown,
    state: { sawDelta: boolean },
  ) => Record<string, unknown> | null;
  createTurnState: () => { sawDelta: boolean };
};

/**
 * Stable projection of a UI message map (README §Projection). Keeps only the
 * machine-comparable dimensions both panels produce byte-identically — never
 * the benign-note wording that legitimately differs between them.
 */
function project(ui: Record<string, unknown> | null): Record<string, unknown> {
  if (ui == null) return { kind: null };
  const kind = ui.kind as string;
  switch (kind) {
    case "init":
      return {
        kind,
        model: ui.model,
        provider: ui.provider,
        sessionId: ui.sessionId,
      };
    case "delta":
    case "thinking":
      return { kind, text: ui.text };
    case "tool":
      return { kind, tool: ui.tool, summary: ui.summary };
    case "tool_done":
      return {
        kind,
        tool: ui.tool,
        isError: ui.isError === true,
        hasNote: ui.note != null,
      };
    case "turn_end":
      return {
        kind,
        isError: ui.isError === true,
        text: ui.text ?? null,
        hasUsage: ui.usage != null,
      };
    case "approval":
      return {
        kind,
        id: ui.id,
        tool: ui.tool ?? null,
        command: ui.command ?? null,
        risk: ui.risk ?? null,
        rule: ui.rule ?? null,
        reason: ui.reason ?? null,
        binding: ui.binding ?? null,
      };
    case "approval_done":
      return { kind, id: ui.id, approved: ui.approved === true, via: ui.via };
    case "question":
      return {
        kind,
        id: ui.id,
        question: ui.question,
        multiSelect: ui.multiSelect === true,
        hasOptions: ui.options != null,
        elicitation: ui.elicitation === true,
        server: ui.server ?? null,
        hasSchema: ui.requestedSchema != null,
        ...(ui.elicitation === true
          ? {
              mode: ui.mode ?? "form",
              elicitationId: ui.elicitationId ?? null,
              url: ui.url ?? null,
              urlHost: ui.urlHost ?? null,
            }
          : {}),
        ...(ui.binding && typeof ui.binding === "object"
          ? { binding: ui.binding }
          : {}),
      };
    case "plan":
      return { kind, active: ui.active === true, state: ui.state ?? null };
    case "usage":
      return { kind };
    case "info":
    case "error":
      return { kind, text: ui.text };
    default:
      return { kind };
  }
}

function readFixtureLines(name: string): unknown[] {
  return readFileSync(join(fixturesDir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

const expected = JSON.parse(
  readFileSync(join(fixturesDir, "expected.json"), "utf8"),
) as Record<string, Array<Record<string, unknown>>>;

const causalFixture = JSON.parse(
  readFileSync(join(fixturesDir, "causal-conformance.json"), "utf8"),
) as {
  cases: Array<{ name: string; events: unknown[] }>;
  expected: {
    approvalBinding: { id: string; binding: string };
    terminal: { result: string; isError: boolean };
  };
};

const FIXTURE_FILES = [
  "session-lifecycle.ndjson",
  "assistant-stream.ndjson",
  "tools.ndjson",
  "interaction.ndjson",
  "misc.ndjson",
];

describe("protocol fixture contract (VS Code chat-events twin)", () => {
  it("expected.json covers every fixture file", () => {
    for (const f of FIXTURE_FILES) {
      expect(Array.isArray(expected[f]), `missing expected for ${f}`).toBe(
        true,
      );
    }
  });

  for (const file of FIXTURE_FILES) {
    it(`maps ${file} to the expected UI projections`, () => {
      const events = readFixtureLines(file);
      const want = expected[file];
      expect(events.length, `line count for ${file}`).toBe(want.length);
      // ONE fresh turn-state per file, events fed top-to-bottom (README rule).
      const state = chatEvents.createTurnState();
      const got = events.map((evt) =>
        project(chatEvents.mapAgentEvent(evt, state)),
      );
      expect(got).toEqual(want);
    });
  }

  it("ignores unknown event types (forward compatibility)", () => {
    const state = chatEvents.createTurnState();
    expect(
      chatEvents.mapAgentEvent({ type: "totally_new_event_v9" }, state),
    ).toBe(null);
  });

  it("tolerates the additive seq / trace_id / tool-call id fields without changing mapping", () => {
    const state = chatEvents.createTurnState();
    const withMeta = chatEvents.mapAgentEvent(
      {
        type: "tool_use",
        id: "tu-9",
        tool: "read_file",
        args: { path: "x" },
        seq: 7,
        trace_id: "tr-abc",
      },
      state,
    );
    const withoutMeta = chatEvents.mapAgentEvent(
      { type: "tool_use", tool: "read_file", args: { path: "x" } },
      state,
    );
    expect(withMeta).toEqual(withoutMeta);
  });

  it("preserves causal-equivalent IDE projections across legal interleavings", () => {
    let baseline: string[] | null = null;
    for (const fixtureCase of causalFixture.cases) {
      const state = chatEvents.createTurnState();
      const projections = fixtureCase.events.map((event) =>
        project(chatEvents.mapAgentEvent(event, state)),
      );
      const normalized = projections
        .map((value) => JSON.stringify(value))
        .sort();
      baseline ??= normalized;
      expect(normalized, fixtureCase.name).toEqual(baseline);

      expect(
        projections.find((value) => value.kind === "approval"),
      ).toMatchObject({
        kind: "approval",
        id: causalFixture.expected.approvalBinding.id,
        binding: causalFixture.expected.approvalBinding.binding,
      });
      expect(
        projections.find((value) => value.kind === "turn_end"),
      ).toMatchObject({
        kind: "turn_end",
        isError: causalFixture.expected.terminal.isError,
        text: causalFixture.expected.terminal.result,
        hasUsage: true,
      });
    }
  });
});

describe("session slash-command wire fixture", () => {
  it("types the init capability advertisement", () => {
    const [initValue] = readFixtureLines("session-lifecycle.ndjson");
    const init: SystemInitEvent = initValue as SystemInitEvent;
    const output: AgentStreamEvent = init;

    expect(output.type).toBe("system");
    expect(init.slash_commands).toEqual([
      "status",
      "doctor",
      "mcp",
      "hooks",
      "permissions",
      "agents",
      "tasks",
      "memory",
    ]);
  });

  it("correlates success and failure responses without creating turn results", () => {
    const lines = readFixtureLines("session-slash-command.ndjson");
    expect(lines).toHaveLength(4);

    const [
      statusInputValue,
      statusResultValue,
      deniedInputValue,
      deniedResultValue,
    ] = lines;
    const statusInput = statusInputValue as SlashCommandInput;
    const statusResult = statusResultValue as SlashCommandResultEvent;
    const deniedInput = deniedInputValue as SlashCommandInput;
    const deniedResult = deniedResultValue as SlashCommandResultEvent;

    // Compile-time union coverage: both additive shapes remain accepted by the
    // public AgentInputEvent / AgentStreamEvent contracts.
    const inputs: AgentInputEvent[] = [statusInput, deniedInput];
    const outputs: AgentStreamEvent[] = [statusResult, deniedResult];

    for (const input of inputs) {
      expect(input.type).toBe("slash_command");
      expect(typeof input.request_id).toBe("string");
      expect(typeof input.command).toBe("string");
      expect(typeof input.args).toBe("string");
    }
    for (const output of outputs) {
      expect(isSlashCommandResult(output)).toBe(true);
      expect(output.type).toBe("slash_command_result");
      expect(output.type).not.toBe("result");
    }

    expect(statusResult).toMatchObject({
      request_id: statusInput.request_id,
      command: statusInput.command,
      ok: true,
      text: "Session status",
      session_id: "sess-fx-1",
    });
    expect(statusResult.error).toBeUndefined();

    expect(deniedResult).toMatchObject({
      request_id: deniedInput.request_id,
      command: deniedInput.command,
      ok: false,
      error: {
        code: "UNSUPPORTED_ARGUMENTS",
        message: "/permissions is read-only over stream-json",
      },
      session_id: "sess-fx-1",
    });
    expect(deniedResult.text).toBeUndefined();
  });
});

describe("permission decision wire shape", () => {
  it("advertises the permission decision capability", () => {
    expect(PROTOCOL_FEATURES).toEqual([
      "event_seq",
      "tool_use_id",
      "permission_decision",
      "trace_id",
    ]);
  });

  it("types the additive runtime-authoritative decision on tool_result", () => {
    const event: ToolResultEvent = {
      type: "tool_result",
      id: "tu-1",
      tool: "run_shell",
      is_error: true,
      permission_decision_id: "tu-1:perm:managed",
      permission_decision: {
        version: 1,
        id: "tu-1:perm:managed",
        tool: "run_shell",
        decision: "deny",
        via: "managed",
        rule: "Bash(publish:*)",
        reason: "publishing is disabled",
        chain: [],
      },
    };

    expect(event.permission_decision?.decision).toBe("deny");
    expect(event.permission_decision_id).toBe(event.permission_decision?.id);
  });
});

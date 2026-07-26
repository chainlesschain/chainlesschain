import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  hasCompleteInteractionBinding,
  normalizeInteractionBinding,
  sameInteractionBinding,
} from "../../src/lib/interaction-binding.js";

const here = dirname(fileURLToPath(import.meta.url));
const sharedFixture = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "agent-sdk",
    "__fixtures__",
    "protocol",
    "interaction.ndjson",
  ),
  "utf8",
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .find((event) => event.type === "question_request" && event.id === "q-1");

const binding = sharedFixture.binding;

describe("interaction binding — shared host golden fixture", () => {
  it("accepts the exact binding preserved by VS Code and JetBrains", () => {
    expect(hasCompleteInteractionBinding(binding)).toBe(true);
    expect(sameInteractionBinding(binding, { ...binding })).toBe(true);
  });

  it("requires every tuple field even when a canonical value is null", () => {
    expect(hasCompleteInteractionBinding({ sequence: 1 })).toBe(false);
    expect(
      hasCompleteInteractionBinding({
        backgroundAgentId: null,
        sessionId: null,
        turnId: null,
        toolUseId: null,
        sequence: 1,
      }),
    ).toBe(true);
  });

  it("normalizes snake_case aliases without weakening any field", () => {
    const snakeCase = {
      background_agent_id: binding.backgroundAgentId,
      session_id: binding.sessionId,
      turn_id: binding.turnId,
      tool_call_id: binding.toolUseId,
      sequence: binding.sequence,
    };

    expect(normalizeInteractionBinding(snakeCase)).toEqual(binding);
    expect(sameInteractionBinding(binding, snakeCase)).toBe(true);
  });

  it.each([
    ["missing", null],
    ["session", { ...binding, sessionId: "other-session" }],
    ["turn", { ...binding, turnId: "other-turn" }],
    ["tool", { ...binding, toolUseId: "other-tool" }],
    ["sequence", { ...binding, sequence: binding.sequence + 1 }],
  ])("rejects a %s response binding", (_label, candidate) => {
    expect(sameInteractionBinding(binding, candidate)).toBe(false);
  });
});

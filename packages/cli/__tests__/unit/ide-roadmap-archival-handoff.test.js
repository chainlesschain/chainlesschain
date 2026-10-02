import "../helpers/test-model-egress.js";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { appendCycleMessages } from "../../scripts/ide-roadmap-live-provider-trajectory.mjs";
import {
  PromptCompressor,
  STRUCTURED_HANDOFF_FIELDS,
} from "../../src/harness/prompt-compressor.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../tests/fixtures/ide-roadmap/s0-live-provider-trajectory.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("benchmark archival handoff contract", () => {
  it("delivers the archival policy and all literal facts through two bounded production summaries", async () => {
    const expected = Object.fromEntries(
      STRUCTURED_HANDOFF_FIELDS.map((field) => [
        field,
        field === "objective" ? "" : [],
      ]),
    );
    const prompts = [];
    const llmQuery = vi.fn(async (prompt) => {
      prompts.push(prompt);
      // This stub checks source delivery, not model compliance. External live
      // evidence must still pass the unchanged exact handoff oracle.
      return JSON.stringify(expected);
    });
    const compressor = new PromptCompressor({
      maxMessages: 20,
      maxTokens: 8000,
      llmQuery,
    });
    let messages = [];

    for (const [cycleIndex, cycle] of fixture.cycles.entries()) {
      if (cycle.factDelta.objective) {
        expected.objective = cycle.factDelta.objective;
      }
      for (const field of STRUCTURED_HANDOFF_FIELDS.slice(1)) {
        expected[field].push(...cycle.factDelta[field]);
      }
      appendCycleMessages(messages, fixture, cycleIndex);
      const compressed = await compressor.compress(messages, {
        preserveToolPairs: true,
      });
      expect(compressed.stats.summaryMode).toBe("llm-structured");
      expect(compressed.stats.summaryInputChars).toBeLessThanOrEqual(
        compressed.stats.summaryInputLimit,
      );
      const prompt = prompts.at(-1);
      expect(prompt).toContain(fixture.handoffInstructions);
      for (const fact of [
        expected.objective,
        ...STRUCTURED_HANDOFF_FIELDS.slice(1).flatMap(
          (field) => expected[field],
        ),
      ]) {
        expect(prompt).toContain(fact);
      }

      messages = compressed.messages;
      messages.push(
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `read-${cycle.id}`,
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: cycle.tool.path }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: `read-${cycle.id}`,
          content: cycle.tool.content,
        },
        { role: "assistant", content: cycle.tool.completionMarker },
      );
    }

    expect(llmQuery).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain(fixture.cycles[0].tool.completionMarker);
    expect(prompts[1]).toContain(fixture.cycles[0].factDelta.nextSteps[0]);
  });
});

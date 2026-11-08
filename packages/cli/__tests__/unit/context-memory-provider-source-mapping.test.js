import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contextItemsToMessages,
  contextItemsToMessagesWithSources,
  createSummaryContextItem,
  messagesToContextItems,
} from "../../src/lib/context-memory-kernel/message-adapter.js";
import {
  getCanonicalProviderSourceMapping,
  prepareCanonicalProviderContext,
  toolDefinitionsToContextItems,
} from "../../src/lib/context-memory-kernel/provider-context.js";

let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cc-provider-source-mapping-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function options(extra = {}) {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    sessionId: "source-mapping-test",
    contextMemoryEnv: {
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    },
    contextMemoryFilePath: join(directory, "memory.json"),
    contextMemoryModelWindowTokens: 65_536,
    contextMemorySkipPlanning: false,
    contextMemoryRecall: false,
    contextMemoryToolDefinitions: [],
    ...extra,
  };
}
const tool = (description) => ({
  type: "function",
  function: {
    name: "same_name",
    description,
    parameters: { type: "object", properties: {} },
  },
});
const request = (prepared) => ({
  messages: prepared.messages,
  tools: prepared.selectedToolDefinitions,
});

describe("private canonical provider source mappings", () => {
  it("records actual sorted bundle expansion including multiple tool results", () => {
    const messages = [
      { role: "assistant", content: "identical text" },
      {
        role: "assistant",
        content: "calling tools",
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: { name: "read_a", arguments: "{}" },
          },
          {
            id: "b",
            type: "function",
            function: { name: "read_b", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "identical text" },
      { role: "tool", tool_call_id: "b", content: "identical text" },
      { role: "user", content: "continue" },
    ];
    const items = messagesToContextItems(messages, {
      sessionId: "source-mapping-test",
    });
    const expanded = contextItemsToMessagesWithSources(items.toReversed());
    expect(expanded.messages).toEqual(messages);
    expect(contextItemsToMessages(items.toReversed())).toEqual(messages);
    expect(expanded.sources.map((source) => source.messageIndexes)).toEqual([
      [0],
      [1, 2, 3],
      [4],
    ]);
    expect(expanded.sources.map((source) => source.digest)).toEqual(
      items.map((item) => item.digest),
    );
    expect(expanded.sources.every((source) => source.derived === false)).toBe(
      true,
    );
    expect(Object.isFrozen(expanded.sources)).toBe(true);
    expect(Object.isFrozen(expanded.sources[1].messageIndexes)).toBe(true);
  });

  it("marks a summary as derived without claiming that its parents were sent", () => {
    const parents = messagesToContextItems(
      [
        { role: "assistant", content: "source one" },
        { role: "assistant", content: "source two" },
      ],
      { sessionId: "source-mapping-test" },
    );
    const summary = createSummaryContextItem({
      messages: [{ role: "assistant", content: "derived summary" }],
      parents,
      operationId: "source-map-summary",
      now: 1,
    });
    const expanded = contextItemsToMessagesWithSources([summary]);
    expect(expanded.sources).toEqual([
      {
        digest: summary.digest,
        kind: summary.kind,
        derived: true,
        messageIndexes: [0],
      },
    ]);
    expect(
      expanded.sources.some((source) =>
        parents.some((parent) => parent.digest === source.digest),
      ),
    ).toBe(false);
  });

  it("binds the actual plan object and selected indexes to a deeply immutable exact request", async () => {
    const prepared = await prepareCanonicalProviderContext(
      [
        { role: "assistant", content: "same text" },
        { role: "assistant", content: "same text" },
        { role: "user", content: "continue" },
      ],
      options(),
    );
    const rows = getCanonicalProviderSourceMapping(
      prepared.plan,
      request(prepared),
    );
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(prepared.plan.selected.length);
    for (const row of rows) {
      expect(row.digest).toBe(prepared.plan.selected[row.selectedIndex].digest);
      expect(row.kind).toBe(prepared.plan.selected[row.selectedIndex].kind);
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.slots)).toBe(true);
      expect(row.slots.every(Object.isFrozen)).toBe(true);
    }
    expect(Object.isFrozen(rows)).toBe(true);
    expect(
      rows
        .flatMap((row) => row.slots.map((slot) => slot.index))
        .sort((a, b) => a - b),
    ).toEqual([0, 1, 2]);
    expect(
      getCanonicalProviderSourceMapping(
        prepared.plan,
        structuredClone(request(prepared)),
      ),
    ).toBe(rows);
    expect(
      getCanonicalProviderSourceMapping(
        structuredClone(prepared.plan),
        request(prepared),
      ),
    ).toBeNull();
    expect(
      getCanonicalProviderSourceMapping(null, request(prepared)),
    ).toBeNull();
    const changed = structuredClone(request(prepared));
    changed.messages[0].content += " changed";
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, changed),
    ).toBeNull();
    prepared.messages[0].content += " mutated returned message";
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, request(prepared)),
    ).toBeNull();
  });

  it("preserves original tool order and distinguishes definitions with the same name", async () => {
    const definitions = [tool("first schema"), tool("second schema")];
    const prepared = await prepareCanonicalProviderContext(
      [{ role: "user", content: "continue" }],
      options({ contextMemoryToolDefinitions: definitions }),
    );
    expect(prepared.selectedToolDefinitions).toEqual(definitions);
    expect(prepared.selectedToolNames).toEqual(["same_name", "same_name"]);
    const rows = getCanonicalProviderSourceMapping(
      prepared.plan,
      request(prepared),
    );
    const toolRows = rows.filter((row) => row.kind === "tool-schema");
    expect(toolRows).toHaveLength(2);
    for (const row of toolRows) {
      const definition = JSON.parse(
        prepared.plan.selected[row.selectedIndex].content,
      );
      expect(prepared.selectedToolDefinitions[row.slots[0].index]).toEqual(
        definition,
      );
      expect(row.slots[0].kind).toBe("tool");
    }
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, {
        messages: prepared.messages,
        tools: definitions.toReversed(),
      }),
    ).toBeNull();
    definitions[0].function.description = "mutated original registry";
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, request(prepared)),
    ).toBe(rows);
    expect(Object.isFrozen(prepared.selectedToolDefinitions[0].function)).toBe(
      true,
    );
  });

  it("does not revive an excluded same-name tool through name selection", async () => {
    const definitions = [tool("oversized ".repeat(2000)), tool("small schema")];
    const prepared = await prepareCanonicalProviderContext(
      [{ role: "user", content: "continue" }],
      options({
        contextMemoryToolDefinitions: definitions,
        contextMemoryModelWindowTokens: 1024,
        maxOutputTokens: 256,
      }),
    );
    const originalItems = toolDefinitionsToContextItems(definitions, {
      sessionId: "source-mapping-test",
      sink: "provider.anthropic",
    });
    expect(prepared.plan.dropped.map((item) => item.digest)).toContain(
      originalItems[0].digest,
    );
    expect(prepared.selectedToolDefinitions).toEqual([definitions[1]]);
    const rows = getCanonicalProviderSourceMapping(
      prepared.plan,
      request(prepared),
    );
    expect(rows.filter((row) => row.kind === "tool-schema")).toHaveLength(1);
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, {
        messages: prepared.messages,
        tools: definitions,
      }),
    ).toBeNull();
  });

  it("binds restored image content while preserving its message position", async () => {
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=";
    const prepared = await prepareCanonicalProviderContext(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe the image" },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
      options(),
    );
    expect(prepared.messages[0].content[1].image_url.url).toBe(url);
    const rows = getCanonicalProviderSourceMapping(
      prepared.plan,
      request(prepared),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].slots).toEqual([{ kind: "message", index: 0 }]);
    const changed = structuredClone(request(prepared));
    changed.messages[0].content[1].image_url.url += "altered";
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, changed),
    ).toBeNull();
  });

  it("does not mint coverage when canonical planning is skipped", async () => {
    const prepared = await prepareCanonicalProviderContext(
      [{ role: "user", content: "continue" }],
      options({ contextMemorySkipPlanning: true }),
    );
    expect(prepared.plan).toBeNull();
    expect(
      getCanonicalProviderSourceMapping(prepared.plan, {
        messages: prepared.messages,
        tools: [],
      }),
    ).toBeNull();
  });
});

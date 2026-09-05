import { describe, expect, it, vi } from "vitest";
import {
  buildAgentModelRequest,
  snapshotAgentModelRequest,
} from "../../src/lib/evolution/agent-model-projection.js";

const request = () => ({
  messages: [{ role: "user", content: "private text" }],
  tools: [],
});
const projection = (content, changes = {}) => ({
  visibility: "model-visible",
  truncated: false,
  content,
  evidenceId: "evidence-test",
  sourceKind: "user-statement",
  trustLabel: "untrusted",
  projectionDigest: `sha256:${"a".repeat(64)}`,
  rulesetDigest: `sha256:${"b".repeat(64)}`,
  redactionSummary: { total: 1 },
  injectionFindings: [],
  ...changes,
});

describe("Agent model projection protocol boundary", () => {
  it("captures immutable plain data before any authority await", () => {
    const input = request();
    const captured = snapshotAgentModelRequest(input);
    input.messages[0].content = "late replacement";
    expect(captured.messages[0].content).toBe("private text");
    expect(Object.isFrozen(captured.messages[0])).toBe(true);
    expect(Object.isFrozen(captured.messages)).toBe(true);
  });

  it("rejects getters, proxies, cycles, sparse arrays and unsupported media without evaluating them", () => {
    const getter = vi.fn(() => "secret");
    const accessor = request();
    Object.defineProperty(accessor.messages[0], "content", {
      get: getter,
      enumerable: true,
    });
    const cyclic = request();
    cyclic.tools.push(cyclic);
    const sparse = request();
    sparse.messages.length = 3;
    const media = request();
    media.messages[0].content = [
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,private" },
      },
    ];
    for (const input of [
      accessor,
      new Proxy(request(), {}),
      cyclic,
      sparse,
      media,
    ]) {
      expect(() => snapshotAgentModelRequest(input)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("enforces input byte, depth and node budgets", () => {
    expect(() =>
      snapshotAgentModelRequest({
        messages: [{ role: "user", content: "a".repeat(1024 * 1024) }],
        tools: [],
      }),
    ).toThrow(/large/u);
    expect(() =>
      snapshotAgentModelRequest({
        ...request(),
        messages: Array(129).fill({ role: "user", content: "a".repeat(8192) }),
      }),
    ).toThrow(/large/u);
    const deep = request();
    let nested = {};
    for (let i = 0; i < 25; i++) nested = { nested };
    deep.tools.push(nested);
    expect(() => snapshotAgentModelRequest(deep)).toThrow(/budget/u);
    expect(() =>
      snapshotAgentModelRequest({ ...request(), tools: Array(32_768).fill(0) }),
    ).toThrow(/budget/u);
  });

  it("keeps complete long text fields while limiting protocol metadata and serialized bytes", () => {
    const text = "A useful detail. ".repeat(2000) + "END-OF-TEXT";
    const original = request();
    original.messages[0].content = text;
    original.tools.push({
      type: "function",
      function: {
        name: "lookup",
        description: text,
        parameters: { type: "object", description: text, properties: {} },
      },
    });
    const captured = snapshotAgentModelRequest(original);
    expect(captured.messages[0].content).toBe(text);
    expect(
      buildAgentModelRequest(captured, projection(captured)).messages[1]
        .content,
    ).toBe(text);
    const bad = request();
    bad.messages[0].name = "n".repeat(8193);
    expect(() => snapshotAgentModelRequest(bad)).toThrow(/metadata/u);
    expect(() =>
      snapshotAgentModelRequest({
        messages: [{ role: "user", content: "\u0000".repeat(200_000) }],
        tools: [],
      }),
    ).toThrow(/large/u);
  });

  it("uses only projected text and host-generated provenance without mutating raw history", () => {
    const original = snapshotAgentModelRequest(request());
    const safe = request();
    safe.messages[0].content = "[REDACTED:credential]";
    const projected = buildAgentModelRequest(original, projection(safe));
    expect(projected.messages[1].content).toBe("[REDACTED:credential]");
    expect(projected.messages[0].content).toContain('"trustLabel":"untrusted"');
    expect(JSON.stringify(projected)).not.toContain("private text");
    expect(original.messages[0].content).toBe("private text");
  });

  it.each([
    { visibility: "opaque" },
    { truncated: true },
    {
      redactionSummary: { total: 1, byType: { "content-truncation": 1 } },
    },
  ])("refuses unavailable model content %j", (changes) => {
    expect(() =>
      buildAgentModelRequest(request(), projection(request(), changes)),
    ).toThrow(/opaque or truncated/u);
  });

  it("refuses changed roles, callable ids, names, schema and structure", () => {
    const original = {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "result" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "read only",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    };
    const mutations = [
      (r) => {
        r.messages[0].role = "system";
      },
      (r) => {
        r.messages[0].tool_calls[0].id = "call-2";
      },
      (r) => {
        r.messages[1].tool_call_id = "call-2";
      },
      (r) => {
        r.tools[0].function.name = "run_shell";
      },
      (r) => {
        r.tools[0].function.parameters.type = "string";
      },
      (r) => {
        r.messages.pop();
      },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(original);
      mutate(altered);
      expect(() =>
        buildAgentModelRequest(original, projection(altered)),
      ).toThrow(/protocol/u);
    }
    const safe = structuredClone(original);
    safe.tools[0].function.description =
      "[QUARANTINED:POTENTIAL_PROMPT_INJECTION]";
    safe.messages[1].content = "[REDACTED:credential]";
    expect(
      buildAgentModelRequest(original, projection(safe)).tools[0].function
        .description,
    ).toContain("QUARANTINED");
  });
});

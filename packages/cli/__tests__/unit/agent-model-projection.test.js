import { describe, expect, it, vi } from "vitest";
import {
  buildAgentModelRequest,
  projectAgentOpaqueTransportBlock,
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
    media.messages[0].content = [{ type: "audio", data: "private" }];
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

  it("restores only digest-bound image and signed thinking transport blocks", () => {
    const original = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "private alice@example.com" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`,
              },
            },
          ],
        },
        {
          role: "assistant",
          content: "",
          _thinkingBlocks: [
            {
              type: "thinking",
              thinking: "private chain of thought",
              signature: "signed-provider-receipt-123456",
            },
          ],
        },
      ],
      tools: [],
    };
    const safe = structuredClone(original);
    safe.messages[0].content[0].text = "private [REDACTED:email]";
    safe.messages[0].content[1] = projectAgentOpaqueTransportBlock(
      original.messages[0].content[1],
      "messages.0.content.1",
    );
    safe.messages[1]._thinkingBlocks[0] = projectAgentOpaqueTransportBlock(
      original.messages[1]._thinkingBlocks[0],
      "messages.1._thinkingBlocks.0",
    );
    expect(() => snapshotAgentModelRequest(safe)).toThrow(/unsupported/u);
    const output = buildAgentModelRequest(original, projection(safe));
    expect(output.messages[1].content[0].text).toContain("[REDACTED:email]");
    expect(output.messages[1].content[1]).toEqual(
      original.messages[0].content[1],
    );
    expect(output.messages[2]._thinkingBlocks[0]).toEqual(
      original.messages[1]._thinkingBlocks[0],
    );
    const tampered = structuredClone(original);
    tampered.messages[0].content[1].image_url.url = `data:image/png;base64,${Buffer.from("other-image").toString("base64")}`;
    expect(() => buildAgentModelRequest(tampered, projection(safe))).toThrow(
      /commitment/u,
    );
  });

  it("restores only digest-bound OpenAI reasoning continuity items", () => {
    const original = {
      messages: [
        {
          role: "assistant",
          content: "",
          _openaiReasoningItems: [
            {
              type: "reasoning",
              id: "rs_1",
              encrypted_content: "opaque-provider-continuity",
              status: "completed",
              summary: [{ type: "summary_text", text: "Inspect safely." }],
            },
          ],
          _openaiReasoningSummary: "Inspect safely.",
        },
      ],
      tools: [],
    };
    const safe = structuredClone(original);
    safe.messages[0]._openaiReasoningItems[0] =
      projectAgentOpaqueTransportBlock(
        original.messages[0]._openaiReasoningItems[0],
        "messages.0._openaiReasoningItems.0",
      );
    safe.messages[0]._openaiReasoningSummary = "Inspect [REDACTED].";

    expect(() => snapshotAgentModelRequest(safe)).toThrow(/unsupported/u);
    const output = buildAgentModelRequest(original, projection(safe));
    expect(output.messages[1]._openaiReasoningItems).toEqual(
      original.messages[0]._openaiReasoningItems,
    );
    expect(output.messages[1]._openaiReasoningSummary).toBe(
      "Inspect [REDACTED].",
    );

    const tampered = structuredClone(original);
    tampered.messages[0]._openaiReasoningItems[0].encrypted_content =
      "different-provider-continuity";
    expect(() => buildAgentModelRequest(tampered, projection(safe))).toThrow(
      /commitment/u,
    );
  });

  it("rejects unsigned thinking and non-canonical or remote image blocks", () => {
    for (const content of [
      [{ type: "image_url", image_url: { url: "https://example.test/a.png" } }],
      [
        {
          type: "image_url",
          image_url: { url: "data:image/svg+xml;base64,PHN2Zz4=" },
        },
      ],
      [{ type: "image_url", image_url: { url: "data:image/png;base64,YQ" } }],
    ]) {
      expect(() =>
        snapshotAgentModelRequest({
          messages: [{ role: "user", content }],
          tools: [],
        }),
      ).toThrow();
    }
    expect(() =>
      snapshotAgentModelRequest({
        messages: [
          {
            role: "assistant",
            content: "",
            _thinkingBlocks: [
              { type: "thinking", thinking: "secret", signature: "" },
            ],
          },
        ],
        tools: [],
      }),
    ).toThrow(/signature/u);
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

  it("allows projected object arguments while preserving live history and callable metadata", () => {
    const original = {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "lookup",
                arguments: {
                  password: "private",
                  nested: { contact: "alice@example.com" },
                  ok: true,
                },
              },
            },
          ],
        },
      ],
      tools: [],
    };
    const safe = structuredClone(original);
    safe.messages[0].tool_calls[0].function.arguments.password =
      "[REDACTED:credential]";
    safe.messages[0].tool_calls[0].function.arguments.nested.contact =
      "[REDACTED:email]";
    const output = buildAgentModelRequest(
      snapshotAgentModelRequest(original),
      projection(safe),
    );
    expect(output.messages[1].tool_calls[0].function.arguments).toEqual(
      safe.messages[0].tool_calls[0].function.arguments,
    );
    expect(original.messages[0].tool_calls[0].function.arguments.password).toBe(
      "private",
    );
    safe.messages[0].tool_calls[0].function.name = "run_shell";
    expect(() => buildAgentModelRequest(original, projection(safe))).toThrow(
      /protocol/u,
    );
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

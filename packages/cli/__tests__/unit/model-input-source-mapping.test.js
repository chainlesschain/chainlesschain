import { describe, expect, it } from "vitest";
import {
  createLogicalSourceMapping,
  modelInputNodeDigest,
  projectSourceMapping,
} from "../../src/lib/model-input-source-mapping.js";
import {
  withModelInputDiagnostics,
  recordLogicalModelInput,
  recordModelInputBody,
  registerModelInputProtocol,
} from "../../src/lib/model-input-diagnostics.js";

const digest = (letter) => "sha256:" + letter.repeat(64);
function fixture() {
  const plan = {
    digest: digest("f"),
    selectedItemIds: ["first", "second"],
    selected: [
      { digest: digest("a"), kind: "message" },
      { digest: digest("b"), kind: "message" },
    ],
    dropped: [{ digest: digest("c"), reason: "input_budget" }],
  };
  const before = {
    messages: [
      { role: "assistant", content: "same evidence" },
      { role: "user", content: "same evidence" },
    ],
    tools: [],
  };
  const rows = plan.selected.map((source, selectedIndex) => ({
    ...source,
    selectedIndex,
    derived: false,
    slots: [{ kind: "message", index: selectedIndex }],
  }));
  return { plan, before, rows };
}
async function capture(operation) {
  const events = [];
  await withModelInputDiagnostics(
    { onModelInputDiagnostic: (event) => events.push(event) },
    async () => {
      const f = fixture();
      const snapshot = await recordLogicalModelInput({
        ...f.before,
        plan: f.plan,
        sourceRows: f.rows,
        preProjection: f.before,
      });
      await operation(snapshot, f);
    },
  );
  return events;
}
describe("model input source mapping", () => {
  it("keeps equal text at distinct structural positions and excludes dropped sources", async () => {
    const events = await capture(async (snapshot) => {
      registerModelInputProtocol("openai-chat", snapshot, {}, snapshot);
      await recordModelInputBody(JSON.stringify(snapshot), "fetch-body");
    });
    expect(events[0].sourceMapping.covered).toBe(true);
    const mapped = events[1].sourceMapping;
    expect(mapped.covered).toBe(true);
    expect(mapped.sources[0]).toEqual({
      ordinal: 0,
      status: "excluded",
      fragments: [],
    });
    expect(
      mapped.sources.slice(1).map((source) => source.fragments[0].path),
    ).toEqual(["/messages/0", "/messages/1"]);
    expect(JSON.stringify(events)).not.toContain("same evidence");
    expect(Object.isFrozen(mapped.sources[1].fragments[0])).toBe(true);
    expect(projectSourceMapping(mapped, "body-prepared")).toEqual(mapped);
  });
  it("rejects registration consuming a different logical request of the same size", async () => {
    const events = await capture(async (snapshot) => {
      const changed = structuredClone(snapshot);
      changed.messages.reverse();
      registerModelInputProtocol("openai-chat", changed, {}, changed);
      await recordModelInputBody(JSON.stringify(changed), "fetch-body");
    });
    expect(events[1].sourceMapping).toMatchObject({
      covered: false,
      reason: "protocol_unmapped",
      sources: [],
    });
  });
  it("rejects body rewrites but permits semantic JSON reserialization", async () => {
    const events = await capture(async (snapshot) => {
      registerModelInputProtocol("openai-chat", snapshot, {}, snapshot);
      await recordModelInputBody(
        JSON.stringify(snapshot, null, 2),
        "adapter-body",
      );
      const changed = structuredClone(snapshot);
      changed.messages[0].content = "rewritten by transport";
      await recordModelInputBody(
        JSON.stringify(changed),
        "governed-fetch-body",
      );
    });
    expect(events[1].sourceMapping.covered).toBe(true);
    expect(events[2].sourceMapping).toMatchObject({
      covered: false,
      reason: "body_mismatch",
      sources: [],
    });
    expect(events[1].bodyDigest).not.toBe(events[2].bodyDigest);
  });
  it("does not reuse a registered protocol after a second logical admission", async () => {
    const events = await capture(async (snapshot, f) => {
      registerModelInputProtocol("openai-chat", snapshot, {}, snapshot);
      await recordLogicalModelInput({
        ...snapshot,
        plan: f.plan,
        sourceRows: f.rows,
        preProjection: snapshot,
      });
      await recordModelInputBody(JSON.stringify(snapshot), "fetch-body");
    });
    expect(events[2].sourceMapping).toMatchObject({
      covered: false,
      reason: "protocol_unmapped",
    });
  });
  it("reports unavailable bodies and unmapped converters without claiming coverage", async () => {
    const events = await capture(async (snapshot) => {
      await recordModelInputBody(JSON.stringify(snapshot), "fetch-body");
      registerModelInputProtocol("openai-chat", snapshot, {}, snapshot);
      await recordModelInputBody(new ReadableStream(), "fetch-body");
    });
    expect(events[1].sourceMapping.reason).toBe("protocol_unmapped");
    expect(events[2].sourceMapping.reason).toBe("body_unavailable");
  });
  it("reports truncated planning as incomplete even if exclusions occupy all retained rows", async () => {
    const events = [];
    const f = fixture();
    f.plan.dropped = Array.from({ length: 512 }, () => ({
      digest: digest("c"),
      reason: "input_budget",
    }));
    await withModelInputDiagnostics(
      { onModelInputDiagnostic: (event) => events.push(event) },
      () =>
        recordLogicalModelInput({
          ...f.before,
          plan: f.plan,
          sourceRows: f.rows,
          preProjection: f.before,
        }),
    );
    expect(events[0].planning.sources).toHaveLength(512);
    expect(events[0].sourceMapping).toMatchObject({
      covered: false,
      reason: "mapping_limit",
      sourcesTruncated: true,
      sources: [],
    });
    expect(() =>
      projectSourceMapping(
        { ...events[0].sourceMapping, covered: true, reason: "complete" },
        "logical-input",
      ),
    ).toThrow("Invalid model input source mapping");
  });
  it("binds per-source projection changes and touched findings to authenticated positions", () => {
    const f = fixture();
    const after = {
      messages: [
        { role: "system", content: "host provenance" },
        f.before.messages[0],
        { role: "user", content: "[redacted]" },
      ],
      tools: [],
    };
    const planning = {
      sourceCount: 3,
      sourcesTruncated: false,
      sources: [
        { ordinal: 0, disposition: "excluded" },
        ...f.plan.selected.map((source, i) => ({
          ...source,
          ordinal: i + 1,
          disposition: "selected",
        })),
      ],
    };
    const receipt = {
      sourceMapping: {
        inputDigest: modelInputNodeDigest(f.before),
        outputDigest: modelInputNodeDigest(after),
        slots: f.rows.map((row, index) => ({
          kind: "message",
          index,
          logicalIndex: index + 1,
          redactionTouched: index === 1,
          injectionTouched: false,
        })),
      },
    };
    const mapping = createLogicalSourceMapping({
      ...f,
      planning,
      after,
      receipt,
      projectionExpected: true,
    });
    expect(mapping.covered).toBe(true);
    expect(mapping.sources[1]).toMatchObject({
      changed: false,
      redactionTouched: false,
      injectionTouched: false,
    });
    expect(mapping.sources[2]).toMatchObject({
      changed: true,
      redactionTouched: true,
      injectionTouched: false,
    });
    expect(mapping.sources[2].logical[0].index).toBe(2);
    expect(projectSourceMapping(mapping, "logical-input")).toEqual(mapping);
    expect(
      createLogicalSourceMapping({
        ...f,
        planning,
        after: f.before,
        receipt,
        projectionExpected: true,
      }),
    ).toMatchObject({ covered: false, reason: "projection_unbound" });
    expect(
      createLogicalSourceMapping({
        ...f,
        planning,
        after,
        projectionExpected: true,
      }),
    ).toMatchObject({ covered: false, reason: "projection_unbound" });
  });
  it.each([
    "/headers/authorization",
    "/messages/-1",
    "/tools/private-path",
    "/system/0/private",
  ])("rejects non-allowlisted wire paths: %s", async (path) => {
    const events = await capture(async (snapshot) => {
      registerModelInputProtocol("openai-chat", snapshot, {}, snapshot);
      await recordModelInputBody(JSON.stringify(snapshot), "fetch-body");
    });
    const mapping = structuredClone(events[1].sourceMapping);
    mapping.sources[1].fragments[0].path = path;
    expect(() => projectSourceMapping(mapping, "body-prepared")).toThrow(
      "Invalid model input source mapping",
    );
  });
  it("isolates interleaved mappings across concurrent requests", async () => {
    const groups = await Promise.all(
      [0, 1].map((index) =>
        capture(async (snapshot) => {
          registerModelInputProtocol(
            index ? "ollama-chat" : "openai-chat",
            snapshot,
            {},
            snapshot,
          );
          await Promise.resolve();
          await recordModelInputBody(JSON.stringify(snapshot), "fetch-body");
        }),
      ),
    );
    expect(groups[0][1].requestId).not.toBe(groups[1][1].requestId);
    expect(groups[0][1].sourceMapping.protocol).toBe("openai-chat");
    expect(groups[1][1].sourceMapping.protocol).toBe("ollama-chat");
  });
});

it.each([false, true])(
  "keeps preplanned coverage honest after a context-engine rewrite (changed=%s)",
  async (changed) => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { vi } = await import("vitest");
    const { chatWithTools } = await import("../helpers/test-model-egress.js");
    const { prepareCanonicalProviderContext } =
      await import("../../src/lib/context-memory-kernel/provider-context.js");
    const { MODEL_INPUT_PLAN } =
      await import("../../src/lib/model-input-diagnostics.js");
    const directory = mkdtempSync(join(tmpdir(), "cc-preplanned-source-map-"));
    const events = [];
    try {
      const options = {
        provider: "openai",
        model: "unit-model",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "fixture-only",
        cwd: directory,
        evolutionIngress: null,
        enabledToolNames: [],
        exactToolNames: true,
        contextMemoryEnv: {
          CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
        },
        contextMemoryFilePath: join(directory, "memory.json"),
        contextMemoryRecall: false,
      };
      const prepared = await prepareCanonicalProviderContext(
        [
          { role: "assistant", content: "original reference" },
          { role: "user", content: "continue" },
        ],
        { ...options, contextMemoryToolDefinitions: [] },
      );
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "done" } }],
            }),
          ),
      );
      await chatWithTools(prepared.messages, {
        ...options,
        contextMemoryPreplanned: true,
        [MODEL_INPUT_PLAN]: prepared.plan,
        contextEngine: {
          buildOptimizedMessages: (messages) =>
            changed
              ? messages.map((message) =>
                  message.role === "assistant"
                    ? { ...message, content: "rewritten reference" }
                    : message,
                )
              : messages,
        },
        onModelInputDiagnostic: (event) => events.push(event),
      });
      expect(events[0].planning.covered).toBe(true);
      expect(events[0].sourceMapping.covered).toBe(!changed);
      expect(events[1].sourceMapping.covered).toBe(!changed);
      if (changed)
        expect(events[0].sourceMapping.reason).toBe("planning_unbound");
    } finally {
      vi.unstubAllGlobals();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each([false, true])(
  "preserves a canonical JSON tool schema with a null prototype (preplanned=%s)",
  async (preplanned) => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { vi } = await import("vitest");
    const { chatWithTools } = await import("../helpers/test-model-egress.js");
    const { prepareCanonicalProviderContext } =
      await import("../../src/lib/context-memory-kernel/provider-context.js");
    const { MODEL_INPUT_PLAN, MODEL_INPUT_TOOLS } =
      await import("../../src/lib/model-input-diagnostics.js");
    const directory = mkdtempSync(
      join(tmpdir(), "cc-null-prototype-tool-map-"),
    );
    const events = [],
      bodies = [];
    const definition = {
      type: "function",
      function: {
        name: "schema_fixture",
        description: "Fixture schema",
        parameters: Object.assign(Object.create(null), {
          type: "object",
          properties: {},
        }),
      },
    };
    try {
      const options = {
        provider: "openai",
        model: "unit-model",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "fixture-only",
        cwd: directory,
        evolutionIngress: null,
        enabledToolNames: ["schema_fixture"],
        extraToolDefinitions: [definition],
        exactToolNames: true,
        contextMemoryEnv: {
          CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
        },
        contextMemoryFilePath: join(directory, "memory.json"),
        contextMemoryRecall: false,
        onModelInputDiagnostic: (event) => events.push(event),
      };
      const prepared = await prepareCanonicalProviderContext(
        [{ role: "user", content: "continue" }],
        { ...options, contextMemoryToolDefinitions: [definition] },
      );
      vi.stubGlobal("fetch", async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "done" } }],
          }),
        );
      });
      await chatWithTools(prepared.messages, {
        ...options,
        ...(preplanned
          ? {
              contextMemoryPreplanned: true,
              [MODEL_INPUT_PLAN]: prepared.plan,
              [MODEL_INPUT_TOOLS]: prepared.selectedToolDefinitions,
            }
          : {}),
      });
      expect(bodies[0].tools).toHaveLength(1);
      expect(bodies[0].tools[0]).toEqual(
        JSON.parse(JSON.stringify(definition)),
      );
      expect(events[0].sourceMapping.covered).toBe(true);
      expect(events[1].sourceMapping.covered).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("does not give observers the current request's mutable diagnostic scope", async () => {
  const events = [];
  const f = fixture();
  await withModelInputDiagnostics(
    {
      onModelInputDiagnostic: async (event) => {
        events.push(event);
        const other = {
          messages: [{ role: "user", content: "callback-only data" }],
          tools: [],
        };
        await recordLogicalModelInput({
          ...other,
          plan: f.plan,
          sourceRows: f.rows,
          preProjection: other,
        });
        registerModelInputProtocol("ollama-chat", other, {}, other);
        await recordModelInputBody(JSON.stringify(other), "fetch-body");
      },
    },
    async () => {
      const snapshot = await recordLogicalModelInput({
        ...f.before,
        plan: f.plan,
        sourceRows: f.rows,
        preProjection: f.before,
      });
      registerModelInputProtocol("openai-chat", snapshot, {}, snapshot);
      await recordModelInputBody(JSON.stringify(snapshot), "fetch-body");
    },
  );
  expect(events).toHaveLength(2);
  expect(events[0].requestId).toBe(events[1].requestId);
  expect(events[1].sourceMapping).toMatchObject({
    covered: true,
    protocol: "openai-chat",
  });
  expect(JSON.stringify(events)).not.toContain("callback-only data");
});

it("defines merged string ranges in decoded UTF-16 code units and hashes UTF-8 JSON fragments", async () => {
  const events = await capture(async (snapshot) => {
    const first = "\u4e2d\u6587\u{1f642}";
    const second = "\u03b1\u03b2";
    const body = {
      system: [{ type: "text", text: first + "\n" + second }],
      tools: [],
    };
    registerModelInputProtocol(
      "anthropic-messages",
      body,
      {
        messages: [
          [{ path: "/system/0/text", start: 0, end: first.length }],
          [
            {
              path: "/system/0/text",
              start: first.length + 1,
              end: first.length + 1 + second.length,
            },
          ],
        ],
      },
      snapshot,
    );
    await recordModelInputBody(JSON.stringify(body), "fetch-body");
  });
  const sources = events[1].sourceMapping.sources;
  expect(sources[1].fragments[0]).toMatchObject({
    start: 0,
    end: 4,
    digest: modelInputNodeDigest("\u4e2d\u6587\u{1f642}"),
    bytes: Buffer.byteLength(JSON.stringify("\u4e2d\u6587\u{1f642}"), "utf8"),
  });
  expect(sources[2].fragments[0]).toMatchObject({
    start: 5,
    end: 7,
    digest: modelInputNodeDigest("\u03b1\u03b2"),
  });
});

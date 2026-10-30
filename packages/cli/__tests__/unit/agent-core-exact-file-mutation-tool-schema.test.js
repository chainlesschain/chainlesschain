import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_TOOLS,
  agentLoop,
  chatWithTools,
} from "../helpers/test-model-egress.js";
import * as providerContext from "../../src/lib/context-memory-kernel/provider-context.js";

const mutationNames = ["write_file", "edit_file", "edit_file_hashed"];
const names = ["read_file", ...mutationNames];
const providers = ["deepseek", "anthropic"];
const messages = [{ role: "user", content: "Update the authorized files." }];
const baseline = structuredClone(
  AGENT_TOOLS.filter((tool) => names.includes(tool.function.name)),
);
let workspace;
let requests;
let planning;

function scopeFor(allowedPaths) {
  for (const relative of allowedPaths) {
    const file = path.join(workspace, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "// existing authorized target\n");
  }
  return { exact: true, worktreeRoot: workspace, allowedPaths };
}

function options(provider, extra = {}) {
  return {
    provider,
    model: provider === "anthropic" ? "claude-sonnet-4-6" : "deepseek-chat",
    apiKey: "test-only-unused-key",
    baseUrl: "https://schema-test.invalid/v1",
    cwd: workspace,
    enabledToolNames: names,
    exactToolNames: true,
    hermeticExecution: true,
    promptCaching: false,
    contextMemoryRecall: false,
    ...extra,
  };
}

function definitions(request, provider) {
  return provider === "anthropic"
    ? request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }))
    : request.tools;
}

function assertScopedSchemas(actual, allowedPaths) {
  expect(actual.map((tool) => tool.function.name).sort()).toEqual(
    [...names].sort(),
  );
  for (const original of baseline) {
    const tool = actual.find(
      (candidate) => candidate.function.name === original.function.name,
    );
    if (original.function.name === "read_file") {
      expect(tool).toEqual(original);
      continue;
    }
    expect(tool.function.parameters.properties.path.enum).toEqual(allowedPaths);
    expect(tool.function.parameters.properties.path.description).toMatch(
      /canonical repo-relative/,
    );
    expect(tool.function.parameters.properties.path.description).toMatch(
      /absolute paths.*not valid mutation arguments/,
    );
    const restored = structuredClone(tool);
    restored.function.parameters.properties.path =
      original.function.parameters.properties.path;
    expect(restored).toEqual(original);
  }
}

beforeEach(() => {
  workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-exact-tool-schema-")),
  );
  requests = [];
  // Call through to the real planner; only observe the definitions it receives.
  planning = vi.spyOn(providerContext, "prepareCanonicalProviderContext");
  // All requests are captured in memory. No original fetch implementation runs.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      expect(new URL(url).hostname).toBe("schema-test.invalid");
      const body = JSON.parse(init.body);
      requests.push(body);
      return {
        ok: true,
        json: async () =>
          body.model === "claude-sonnet-4-6"
            ? {
                content: [{ type: "text", text: "Done." }],
                usage: { input_tokens: 5, output_tokens: 2 },
                stop_reason: "end_turn",
              }
            : {
                choices: [
                  {
                    message: { role: "assistant", content: "Done." },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 5,
                  completion_tokens: 2,
                  total_tokens: 7,
                },
              },
      };
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(path.dirname(workspace)).toBe(fs.realpathSync(os.tmpdir()));
  expect(path.basename(workspace)).toMatch(/^cc-exact-tool-schema-/);
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("exact mutation paths in actual provider tool schemas", () => {
  it.each(providers)(
    "%s receives the complete scope seen by the real context planner",
    async (provider) => {
      const scope = scopeFor(["src/allowed.js", "tests/案例.test.js"]);
      await chatWithTools(
        messages,
        options(provider, { fileMutationScope: scope }),
      );
      expect(requests).toHaveLength(1);
      const wire = definitions(requests[0], provider);
      assertScopedSchemas(wire, scope.allowedPaths);
      expect(planning).toHaveBeenCalled();
      const planned =
        planning.mock.calls.at(-1)[1].contextMemoryToolDefinitions;
      expect(planned).toEqual(wire);
    },
  );

  it.each(providers)(
    "%s without a scope retains original schemas",
    async (provider) => {
      await chatWithTools(messages, options(provider));
      expect(requests).toHaveLength(1);
      expect(definitions(requests[0], provider)).toEqual(baseline);
    },
  );

  it("isolates successive scopes without mutating global schemas or prior requests", async () => {
    const before = JSON.stringify(AGENT_TOOLS);
    const first = scopeFor(["a.js"]);
    const second = scopeFor(["b.js"]);
    await chatWithTools(
      messages,
      options("deepseek", { fileMutationScope: first }),
    );
    const firstWire = JSON.stringify(requests[0]);
    await chatWithTools(
      messages,
      options("deepseek", { fileMutationScope: second }),
    );
    await chatWithTools(messages, options("deepseek"));
    assertScopedSchemas(
      definitions(requests[0], "deepseek"),
      first.allowedPaths,
    );
    assertScopedSchemas(
      definitions(requests[1], "deepseek"),
      second.allowedPaths,
    );
    expect(definitions(requests[2], "deepseek")).toEqual(baseline);
    expect(JSON.stringify(requests[0])).toBe(firstWire);
    expect(JSON.stringify(AGENT_TOOLS)).toBe(before);
  });

  it("does not assign built-in provenance to a byte-identical same-name extra definition", async () => {
    const extra = structuredClone(
      baseline.find((tool) => tool.function.name === "write_file"),
    );
    const scope = scopeFor(["allowed.js"]);
    await chatWithTools(
      messages,
      options("deepseek", {
        fileMutationScope: scope,
        extraToolDefinitions: [extra],
      }),
    );
    const wire = definitions(requests[0], "deepseek");
    expect(wire.find((tool) => tool.function.name === "write_file")).toEqual(
      extra,
    );
    for (const name of ["edit_file", "edit_file_hashed"]) {
      expect(
        wire.find((tool) => tool.function.name === name).function.parameters
          .properties.path.enum,
      ).toEqual(scope.allowedPaths);
    }
  });

  it("does not project a built-in-shaped schema when a same-name external executor is supplied", async () => {
    const external = vi.fn();
    const scope = scopeFor(["allowed.js"]);
    await chatWithTools(
      messages,
      options("deepseek", {
        fileMutationScope: scope,
        externalToolExecutors: { write_file: external },
      }),
    );
    const wire = definitions(requests[0], "deepseek");
    expect(wire.find((tool) => tool.function.name === "write_file")).toEqual(
      baseline.find((tool) => tool.function.name === "write_file"),
    );
    expect(external).not.toHaveBeenCalled();
  });

  it.each(providers)(
    "%s serializes all 2048 paths without silently narrowing the scope",
    async (provider) => {
      const allowedPaths = Array.from(
        { length: 2048 },
        (_, i) => `files/f${i}.js`,
      );
      const scope = scopeFor(allowedPaths);
      await chatWithTools(
        messages,
        options(provider, {
          fileMutationScope: scope,
          // This case isolates wire serialization; planner parity is covered above.
          contextMemorySkipPlanning: true,
        }),
      );
      expect(requests).toHaveLength(1);
      assertScopedSchemas(definitions(requests[0], provider), allowedPaths);
      expect(scope.allowedPaths).toEqual(allowedPaths);
    },
  );

  it("agentLoop plans and sends the same normalized host scope", async () => {
    const scope = scopeFor(["allowed.js"]);
    const events = [];
    for await (const event of agentLoop(
      messages,
      options("deepseek", {
        fileMutationScope: scope,
        autoCompact: false,
        runnableProviderFallback: false,
        maxIterations: 1,
      }),
    ))
      events.push(event);
    expect(requests).toHaveLength(1);
    const wire = definitions(requests[0], "deepseek");
    assertScopedSchemas(wire, scope.allowedPaths);
    expect(planning).toHaveBeenCalled();
    for (const [, planned] of planning.mock.calls) {
      expect(planned.contextMemoryToolDefinitions).toEqual(wire);
    }
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(fs.readFileSync(path.join(workspace, "allowed.js"), "utf8")).toBe(
      "// existing authorized target\n",
    );
  });
});

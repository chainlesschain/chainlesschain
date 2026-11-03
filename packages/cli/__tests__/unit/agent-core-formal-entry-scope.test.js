import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";

const bindingEnv = "CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES";
const mutationNames = ["write_file", "edit_file", "edit_file_hashed"];
let workspace;
let requests;
let firstReply;

const writeCall = (file) => ({
  role: "assistant",
  content: "",
  tool_calls: [
    {
      id: "scope-write",
      type: "function",
      function: {
        name: "write_file",
        arguments: JSON.stringify({ path: file, content: "// changed\n" }),
      },
    },
  ],
});

beforeEach(() => {
  workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-formal-entry-scope-")),
  );
  for (const file of ["allowed.js", "second.js", "sibling.js"]) {
    fs.writeFileSync(path.join(workspace, file), "// placeholder\n");
  }
  vi.stubEnv("CC_FORMAL_QUALITY_EVAL_HERMETIC", "1");
  vi.stubEnv("CHAINLESSCHAIN_HOME", path.join(workspace, "isolated-home"));
  vi.stubEnv(bindingEnv, JSON.stringify(["allowed.js"]));
  requests = [];
  firstReply = null;
  // Exercise actual provider serialization and actual file tools, with every
  // HTTP request intercepted in memory. No model or paid request is made.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      expect(new URL(url).hostname).toBe("entry-scope.invalid");
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message:
                requests.length === 1 && firstReply
                  ? firstReply
                  : { role: "assistant", content: "Done." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Check the absolute deletion target before recursive cleanup on Windows.
  expect(path.dirname(workspace)).toBe(fs.realpathSync(os.tmpdir()));
  expect(path.basename(workspace)).toMatch(/^cc-formal-entry-scope-/);
  fs.rmSync(workspace, { recursive: true, force: true });
});

async function drive(extra = {}) {
  const events = [];
  // Match the direct agentLoop entry used by WS/IDE: no caller scope or
  // hermetic/exact flags. Authority comes exclusively from the launcher env.
  for await (const event of agentLoop(
    [{ role: "user", content: "Update the authorized file." }],
    {
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "test-only-unused-key",
      baseUrl: "https://entry-scope.invalid/v1",
      cwd: workspace,
      promptCaching: false,
      contextMemoryRecall: false,
      autoCompact: false,
      runnableProviderFallback: false,
      maxIterations: 3,
      ...extra,
    },
  )) {
    events.push(event);
  }
  return events;
}

function mutationSchemas() {
  return requests[0].tools.filter((tool) =>
    mutationNames.includes(tool.function.name),
  );
}

describe("launcher scope at the shared CLI and IDE agent entry", () => {
  it("publishes exact paths and rejects a wrong delivery directory at execution", async () => {
    firstReply = writeCall("integration/allowed.js");
    const events = await drive();
    expect(mutationSchemas()).toHaveLength(3);
    for (const tool of mutationSchemas()) {
      expect(tool.function.parameters.properties.path.enum).toEqual([
        "allowed.js",
      ]);
    }
    expect(
      events.find((event) => event.type === "tool-result")?.result,
    ).toMatchObject({
      policy: { decision: "deny", via: "exact-file-mutation-scope" },
    });
    expect(fs.existsSync(path.join(workspace, "integration"))).toBe(false);
    expect(fs.readFileSync(path.join(workspace, "allowed.js"), "utf8")).toBe(
      "// placeholder\n",
    );
  });

  it("rejects an absolute alias of the authorized file", async () => {
    firstReply = writeCall(path.join(workspace, "allowed.js"));
    const events = await drive();
    expect(
      events.find((event) => event.type === "tool-result")?.result.policy,
    ).toMatchObject({
      decision: "deny",
      via: "exact-file-mutation-scope",
    });
    expect(fs.readFileSync(path.join(workspace, "allowed.js"), "utf8")).toBe(
      "// placeholder\n",
    );
  });

  it("executes an authorized canonical write through the same direct entry", async () => {
    firstReply = writeCall("allowed.js");
    const events = await drive();
    expect(
      events.find((event) => event.type === "tool-result")?.result.success,
    ).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "allowed.js"), "utf8")).toBe(
      "// changed\n",
    );
  });

  it("preserves a caller scope narrower than the launcher binding", async () => {
    vi.stubEnv(bindingEnv, JSON.stringify(["allowed.js", "second.js"]));
    firstReply = writeCall("second.js");
    const events = await drive({
      fileMutationScope: {
        exact: true,
        worktreeRoot: workspace,
        allowedPaths: ["allowed.js"],
      },
    });
    expect(
      mutationSchemas()[0].function.parameters.properties.path.enum,
    ).toEqual(["allowed.js"]);
    expect(
      events.find((event) => event.type === "tool-result")?.result.policy?.via,
    ).toBe("exact-file-mutation-scope");
    expect(fs.readFileSync(path.join(workspace, "second.js"), "utf8")).toBe(
      "// placeholder\n",
    );
  });

  it("rejects caller widening before any provider call", async () => {
    await expect(
      drive({
        fileMutationScope: {
          exact: true,
          worktreeRoot: workspace,
          allowedPaths: ["allowed.js", "sibling.js"],
        },
      }),
    ).rejects.toThrow(/widens/);
    expect(requests).toHaveLength(0);
  });

  it("rejects a caller scope rooted outside the run worktree", async () => {
    await expect(
      drive({
        fileMutationScope: {
          exact: true,
          worktreeRoot: fs.realpathSync(os.tmpdir()),
          allowedPaths: ["allowed.js"],
        },
      }),
    ).rejects.toThrow(/does not match the run cwd/);
    expect(requests).toHaveLength(0);
  });

  it("retains launcher authority despite caller flags and host executors", async () => {
    const externalWrite = vi.fn();
    firstReply = writeCall("allowed.js");
    const events = await drive({
      hermeticExecution: false,
      exactToolNames: false,
      externalToolExecutors: { write_file: externalWrite },
    });
    for (const tool of mutationSchemas()) {
      expect(tool.function.parameters.properties.path.enum).toEqual([
        "allowed.js",
      ]);
    }
    expect(externalWrite).not.toHaveBeenCalled();
    expect(
      events.find((event) => event.type === "tool-result")?.result.success,
    ).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "allowed.js"), "utf8")).toBe(
      "// changed\n",
    );
  });

  it.each([
    { enabledToolNames: [] },
    { enabledToolNames: ["run_shell"] },
    { enabledToolNames: ["read_file"] },
    { enabledToolNames: ["read_file", "run_shell"] },
  ])(
    "preserves the caller tool ceiling $enabledToolNames and blocks unadvertised writes",
    async ({ enabledToolNames }) => {
      firstReply = writeCall("allowed.js");
      const events = await drive({ enabledToolNames });
      expect(requests[0].tools.map((tool) => tool.function.name)).toEqual(
        enabledToolNames.filter((name) => name === "read_file"),
      );
      expect(
        events.find((event) => event.type === "tool-result")?.result.policy,
      ).toMatchObject({
        decision: "blocked",
        via: "effective-tool-set",
      });
      expect(fs.readFileSync(path.join(workspace, "allowed.js"), "utf8")).toBe(
        "// placeholder\n",
      );
    },
  );

  it("rejects malformed caller tool ceilings before provider dispatch", async () => {
    await expect(drive({ enabledToolNames: "write_file" })).rejects.toThrow(
      /enabled tool names must be an array/,
    );
    expect(requests).toHaveLength(0);
  });

  it.each(["", "{}", '["../outside.js"]', '["allowed.js","allowed.js"]'])(
    "rejects malformed launcher binding %j before provider dispatch",
    async (value) => {
      vi.stubEnv(bindingEnv, value);
      await expect(drive()).rejects.toThrow(/allowed-files binding/);
      expect(requests).toHaveLength(0);
    },
  );

  it("rejects missing bound targets before provider dispatch", async () => {
    vi.stubEnv(bindingEnv, '["missing.js"]');
    await expect(drive()).rejects.toThrow(/must already exist/);
    expect(requests).toHaveLength(0);
  });

  it("leaves ordinary runs unrestricted by the evaluation-only binding", async () => {
    vi.stubEnv("CC_FORMAL_QUALITY_EVAL_HERMETIC", "0");
    vi.stubEnv(bindingEnv, "invalid ignored value");
    await drive({ enabledToolNames: ["write_file"] });
    expect(mutationSchemas()).toHaveLength(1);
    expect(
      mutationSchemas()[0].function.parameters.properties.path.enum,
    ).toBeUndefined();
  });

  it("ignores the evaluation binding without an isolated temporary home", async () => {
    vi.stubEnv("CHAINLESSCHAIN_HOME", path.parse(workspace).root);
    vi.stubEnv(bindingEnv, "invalid ignored value");
    // The invalid home tests only launcher admission. Do not initialize any
    // durable memory storage for this deliberately unusable config root.
    await drive({
      enabledToolNames: ["write_file"],
      contextMemorySkipPlanning: true,
    });
    expect(mutationSchemas()).toHaveLength(1);
    expect(
      mutationSchemas()[0].function.parameters.properties.path.enum,
    ).toBeUndefined();
  });

  it("preserves legacy hermetic callers without an allowed-files environment", async () => {
    vi.stubEnv(bindingEnv, undefined);
    await drive({
      enabledToolNames: ["read_file"],
      hermeticExecution: true,
      exactToolNames: true,
    });
    expect(requests[0].tools.map((tool) => tool.function.name)).toEqual([
      "read_file",
    ]);
  });
});

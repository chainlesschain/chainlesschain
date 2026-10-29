import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentHeadless } from "../helpers/test-model-egress.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { setupMcpFromConfig } from "../../src/runtime/mcp-config.js";

let root, cwd;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-host-catalog-"));
  cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  vi.stubEnv("CHAINLESSCHAIN_HOME", path.join(root, "state"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", path.join(root, "anchors"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it.each(["headless", "stream"])(
  "%s forwards the live catalog even when no MCP server is ready",
  async (entry) => {
    const mcp = await setupMcpFromConfig(
      {},
      { createClient: () => ({ servers: new Map() }) },
    );
    const observed = [];
    const options = {
      cwd,
      ephemeral: true,
      projectMemory: false,
      useRegisteredMcp: false,
    };
    const deps = {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => mcp,
      writeOut: () => {},
      writeErr: () => {},
      agentLoop: async function* (_messages, loopOptions) {
        observed.push(loopOptions.mcpToolCatalog);
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
    };
    const result =
      entry === "stream"
        ? await runAgentHeadlessStream(options, {
            ...deps,
            input: (async function* () {
              yield JSON.stringify({ type: "user", content: "test" }) + "\n";
            })(),
          })
        : await runAgentHeadless(
            { ...options, prompt: "test", outputFormat: "json" },
            deps,
          );
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    expect(observed).toEqual([mcp.mcpToolCatalog]);
  },
);

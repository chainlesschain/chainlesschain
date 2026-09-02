#!/usr/bin/env node

import path from "node:path";
import { performance } from "node:perf_hooks";
import { MCPClient } from "../src/harness/mcp-client.js";
import { McpLifecycleAuthority } from "../src/lib/mcp-lifecycle-authority.js";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new TypeError("invalid MCP lifecycle profile child arguments");
    }
    values[key.slice(2)] = value;
  }
  for (const required of ["state-path", "server-url", "session-id", "name"]) {
    if (!values[required]) throw new TypeError(`missing --${required}`);
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const authority = new McpLifecycleAuthority({
    statePath: path.resolve(args["state-path"]),
  });
  const client = new MCPClient({
    sessionId: args["session-id"],
    lifecycleAuthority: authority,
  });
  const recoveryStarted = performance.now();
  await client.connect(args.name, {
    url: args["server-url"],
    transport: "http",
  });
  const recoveryLatencyMs = performance.now() - recoveryStarted;
  const snapshot = authority.snapshot({
    name: args.name,
    sessionId: args["session-id"],
  });
  const output = {
    phase: snapshot?.phase || null,
    generation: snapshot?.generation || 0,
    subscriptions: snapshot?.subscriptions || [],
    rpcRecoveredAfterRestart: snapshot?.metrics?.rpcRecoveredAfterRestart || 0,
    recoveryLatencyMs,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`, () => process.exit(0));
}

main().catch((error) => {
  process.stderr.write(
    `${error?.code || error?.name || "error"}: ${error?.message || "profile child failed"}\n`,
  );
  process.exitCode = 1;
});

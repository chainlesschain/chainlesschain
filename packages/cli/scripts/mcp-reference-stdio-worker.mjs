// Runs only the pinned official stdio entry, with the isolated environment
// supplied by the reference probe. No account credentials are inherited.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { MCPClient } from "../src/harness/mcp-client.js";
import { issueMcpStdioExecutionAuthority } from "../src/lib/mcp-stdio-execution-authority.js";

const root = resolve(process.argv[2]);
const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(metadata.name, "@modelcontextprotocol/server-everything");
assert.equal(metadata.version, "2026.8.31");
const require = createRequire(join(root, "package.json"));
const transport = require.resolve("@modelcontextprotocol/sdk/server/stdio.js");
const sdk = JSON.parse(
  readFileSync(join(dirname(transport), "../../../package.json"), "utf8"),
);
assert.equal(sdk.version, "1.32.0");
const entry = join(root, "dist/index.js");
const client = new MCPClient();
let stage = "stdio-initialize-and-discover",
  report,
  failure;
const cleanup = () => client.disconnectAll();
process.once("disconnect", () => {
  void cleanup().finally(() => process.exit(1));
});
try {
  const config = {
    command: process.execPath,
    args: [entry, "stdio"],
    requestTimeoutMs: 15000,
    processTreeGraceMs: 100,
    processTreeCleanupTimeoutMs: 5000,
  };
  config.mcpStdioExecutionAuthority = issueMcpStdioExecutionAuthority({
    serverName: "reference-stdio",
    config,
    approvalKind: "explicit-config",
    approvalSource: "pinned-reference-interop-probe",
  });
  await client.connect("reference-stdio", config);
  stage = "stdio-tool";
  const result = await client.callTool("reference-stdio", "echo", {
    message: "official-stdio-round-trip",
  });
  assert.equal(result.content[0].text, "Echo: official-stdio-round-trip");
  stage = "stdio-prompt";
  const prompt = await client.getPrompt("reference-stdio", "simple-prompt");
  assert.ok(prompt.messages.length > 0);
  stage = "stdio-resource";
  const resource = await client.readResource(
    "reference-stdio",
    "demo://resource/dynamic/text/1",
  );
  assert.ok(resource.contents.length > 0);
  report = {
    status: "passed",
    transport: "official-server-stdio-entry",
    sdkVersion: sdk.version,
    entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
    transportSha256: createHash("sha256")
      .update(readFileSync(join(root, "dist/transports/stdio.js")))
      .digest("hex"),
    checks: {
      tool: true,
      prompt: true,
      resource: true,
      disconnectCompleted: false,
    },
  };
} catch (error) {
  failure = { stage, error: String(error.message).slice(0, 500) };
} finally {
  try {
    await cleanup();
    if (report) report.checks.disconnectCompleted = true;
  } catch (error) {
    failure ||= {
      stage: "stdio-disconnect",
      error: String(error.message).slice(0, 500),
    };
  }
}
process.send(failure ? { status: "failed", ...failure } : report, () => {
  process.removeAllListeners("disconnect");
  process.disconnect();
});
if (failure) process.exitCode = 1;

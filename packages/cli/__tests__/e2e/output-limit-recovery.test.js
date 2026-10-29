import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function runFixture(mode) {
  const root = mkdtempSync(
    join(realpathSync.native(tmpdir()), "cc-output-limit-"),
  );
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  const env = {};
  for (const k of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "ComSpec",
    "COMSPEC",
    "PATH",
    "Path",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[k]) env[k] = process.env[k];
  Object.assign(env, {
    CHAINLESSCHAIN_HOME: join(root, "config"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(root, "anchors"),
    HOME: join(root, "user"),
    USERPROFILE: join(root, "user"),
    CI: "1",
    NO_COLOR: "1",
    CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
  });
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    requests.push(JSON.parse(body));
    const first = requests.length === 1 || mode === "repeated";
    const row = {
      id: `fixture-${requests.length}`,
      model: "fixture-model",
      choices: [
        {
          index: 0,
          finish_reason:
            mode === "content-filter"
              ? "content_filter"
              : mode === "ambiguous"
                ? "tool_calls"
                : first
                  ? "length"
                  : "stop",
          message: {
            role: "assistant",
            content: first ? "partial rejected" : "COMPLETE_FIXTURE_ONLY",
            ...(first
              ? {
                  tool_calls: [
                    {
                      id: "rejected",
                      type: "function",
                      function: {
                        name: "write_file",
                        arguments: JSON.stringify({
                          path: "must-not-exist.txt",
                          content: "not authorized by complete output",
                        }),
                      },
                    },
                  ],
                }
              : {}),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };
    if (mode === "missing-usage") delete row.usage;
    if (mode === "ambiguous") {
      row.choices.push({
        index: 1,
        finish_reason: "stop",
        message: { role: "assistant", content: "UNSELECTED_ALTERNATIVE" },
      });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(row));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const bin = fileURLToPath(
    new URL("../../bin/chainlesschain.js", import.meta.url),
  );
  const args = [
    bin,
    "agent",
    "-p",
    "Say a short hello.",
    "--provider",
    "deepseek",
    "--model",
    "fixture-model",
    "--base-url",
    `http://127.0.0.1:${server.address().port}/v1`,
    "--api-key",
    "fixture-only",
    "--output-format",
    "json",
    "--max-turns",
    "3",
    "--allowed-tools",
    "read_file,write_file,edit_file,list_dir,search_files,run_shell",
    "--sandbox-mode",
    "off",
    "--ephemeral",
  ];
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const timer = setTimeout(() => child.kill(), 60000);
  const code = await new Promise((r) => child.once("close", r));
  clearTimeout(timer);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  const result = {
    root,
    code,
    requests,
    stdout,
    stderr,
    forbiddenFileExists: existsSync(join(cwd, "must-not-exist.txt")),
  };
  try {
    const receipt = JSON.parse(stdout.trim());
    assert.equal(code, mode === "recover" ? 0 : 1, stderr + stdout);
    assert.equal(
      requests.length,
      ["missing-usage", "content-filter", "ambiguous"].includes(mode) ? 1 : 2,
    );
    if (mode === "recover") {
      assert.equal(receipt.is_error, false);
      assert.equal(receipt.usage.output_tokens, 16);
      assert.match(stdout, /COMPLETE_FIXTURE_ONLY/);
    } else {
      assert.equal(receipt.is_error, true);
      assert.notEqual(receipt.subtype, "success");
    }
    assert.equal(result.forbiddenFileExists, false);
    if (requests[1]) {
      assert(
        requests[1].messages.some((m) =>
          m.content?.includes("None of its tool calls were executed"),
        ),
      );
      assert(
        !requests[1].messages.some((m) =>
          m.tool_calls?.some((c) => c.id === "rejected"),
        ),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
describe("canonical CLI provider termination with a loopback provider", () => {
  it.each([
    "recover",
    "repeated",
    "missing-usage",
    "content-filter",
    "ambiguous",
  ])(
    "preserves settlement and completion status: %s",
    async (mode) => {
      await runFixture(mode);
    },
    90000,
  );
});

/**
 * Regression: a teammate-style persisted agent run must keep stdout as pure
 * NDJSON even when the session preflight lazily initializes config/database
 * modules that still report diagnostics through console.info.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

const t = testHome("agent-stream-stdout");
let llmServer;
let llmPort;

beforeAll(async () => {
  llmServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: { role: "assistant", content: "stdout-is-ndjson" },
          prompt_eval_count: 4,
          eval_count: 2,
          done: true,
        }),
      );
    });
  });
  await new Promise((resolve) => llmServer.listen(0, "127.0.0.1", resolve));
  llmPort = llmServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => llmServer.close(resolve));
  t.cleanup();
});

function runAgent() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        CLI_BIN,
        "agent",
        "-p",
        "reply once",
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "stream-json",
        "--provider",
        "ollama",
        "--model",
        "test",
        "--base-url",
        `http://127.0.0.1:${llmPort}`,
        "--session",
        "teammate-stream-session",
        "--ephemeral",
        "--bare",
        "--sandbox-mode",
        "off",
      ],
      {
        cwd: t.workspace,
        env: t.env(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

describe("cc agent stream-json stdout purity", () => {
  it("routes session preflight diagnostics to stderr", async () => {
    const { status, stdout, stderr } = await runAgent();
    expect(status, stderr || stdout).toBe(0);

    const events = stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({ type: "system", subtype: "init" });
    expect(events.at(-1)).toMatchObject({
      type: "result",
      subtype: "success",
    });
    expect(stdout).not.toContain("[AppConfig]");
    expect(stdout).not.toContain("[DatabaseManager]");
    expect(stderr).toContain("[AppConfig]");
    expect(stderr).toContain("[DatabaseManager] Database initialized");
  }, 60_000);
});

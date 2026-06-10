/**
 * IDE live context — true e2e: a REAL spawned `cc agent -p` process discovers
 * a fake IDE (real extension MCP server + lockfile + env port), connects over
 * Streamable HTTP with Bearer auth, and the editor's selection arrives inside
 * the user turn of the LLM request — observed by a capturing fake-ollama
 * endpoint. No mocks inside the CLI process at all.
 *
 *   vitest process                     spawned process
 *   ┌──────────────────┐              ┌────────────────────────┐
 *   │ IdeMcpServer      │◄── MCP ─────│ cc agent -p … --ide     │
 *   │ fake /api/chat    │◄── LLM ─────│ (real bin, isolated HOME)│
 *   └──────────────────┘              └────────────────────────┘
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { testHome, freePort, CLI_BIN } from "./_helpers/cli-e2e.js";
import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";

const t = testHome("idectx");
const TOKEN = "e2e-ide-token";

function facade() {
  return {
    getSelection: async () => ({
      file: "/ws/src/picked.js",
      languageId: "javascript",
      selection: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 5 },
      },
      text: "foo()",
    }),
    getDiagnostics: async () => [],
    getOpenEditors: async () => [
      { file: "/ws/src/picked.js", active: true, languageId: "javascript" },
    ],
    openDiff: async (args) => ({ outcome: "rejected", path: args.path }),
  };
}

let ideServer;
let llmServer;
let llmPort;
const captured = [];

beforeAll(async () => {
  ideServer = new IdeMcpServer({
    tools: buildIdeTools(facade()),
    token: TOKEN,
  });
  await ideServer.start({ port: 0 });

  // Capturing fake ollama: records every /api/chat body, replies one plain
  // assistant message (no tool calls) so the agent loop ends after one call.
  llmPort = await freePort();
  llmServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        captured.push({ url: req.url, body: JSON.parse(body || "{}") });
      } catch {
        captured.push({ url: req.url, body: null });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: { role: "assistant", content: "e2e-done" },
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      );
    });
  });
  await new Promise((r) => llmServer.listen(llmPort, "127.0.0.1", r));

  // The lockfile a real editor extension would write, under the isolated HOME
  // (the spawned process resolves ~ via USERPROFILE/HOME from t.env()).
  const lockDir = path.join(t.home, ".chainlesschain", "ide");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, `${ideServer.port}.json`),
    JSON.stringify({
      ide: "vscode",
      transport: "http",
      url: ideServer.url(),
      port: ideServer.port,
      workspaceFolders: [t.home],
      token: TOKEN,
      pid: process.pid,
      started_at: Date.now(),
    }),
    "utf-8",
  );
});

afterAll(async () => {
  await ideServer.stop();
  await new Promise((r) => llmServer.close(r));
  t.cleanup();
});

// IMPORTANT: async spawn, NOT spawnSync — the fake IDE + fake LLM servers run
// in THIS process, and spawnSync blocks the event loop, so they could never
// answer the child (deadlock until the child is SIGTERM'd).
function runAgent(extraEnv = {}) {
  const before = captured.length;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        CLI_BIN,
        "agent",
        "-p",
        "what am I looking at",
        "--ide",
        "--no-mcp",
        "--provider",
        "ollama",
        "--model",
        "fake-model",
        "--base-url",
        `http://127.0.0.1:${llmPort}`,
        "--output-format",
        "json",
      ],
      {
        env: t.env({
          CHAINLESSCHAIN_IDE_PORT: String(ideServer.port),
          CHAINLESSCHAIN_IDE_TOKEN: TOKEN,
          ...extraEnv,
        }),
        cwd: t.home,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({
        r: { status, stdout, stderr },
        requests: captured.slice(before),
      });
    });
  });
}

describe("cc agent -p + fake IDE + capturing LLM (full chain)", () => {
  it("delivers <ide-context> (live selection) inside the user turn", async () => {
    const { r, requests } = await runAgent();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("e2e-done");

    const chat = requests.filter((c) => c.url.includes("/api/chat"));
    expect(chat.length).toBeGreaterThan(0);
    const userMsg = chat[0].body.messages
      .filter((m) => m.role === "user")
      .pop();
    expect(userMsg.content).toContain("what am I looking at");
    expect(userMsg.content).toContain("<ide-context>");
    expect(userMsg.content).toContain("Active file: /ws/src/picked.js");
    expect(userMsg.content).toContain("foo()");

    // The IDE's tools were ALSO exposed to the model (bridge connected).
    const toolNames = (chat[0].body.tools || []).map(
      (tool) => tool.function?.name,
    );
    expect(toolNames).toContain("mcp__ide__getSelection");
    expect(toolNames).toContain("mcp__ide__openDiff");
  }, 180_000);

  it("CC_IDE_CONTEXT=0 keeps the IDE tools but drops the auto-context", async () => {
    const { r, requests } = await runAgent({ CC_IDE_CONTEXT: "0" });
    expect(r.status).toBe(0);

    const chat = requests.filter((c) => c.url.includes("/api/chat"));
    expect(chat.length).toBeGreaterThan(0);
    const userMsg = chat[0].body.messages
      .filter((m) => m.role === "user")
      .pop();
    expect(userMsg.content).toContain("what am I looking at");
    expect(userMsg.content).not.toContain("<ide-context>");

    const toolNames = (chat[0].body.tools || []).map(
      (tool) => tool.function?.name,
    );
    expect(toolNames).toContain("mcp__ide__getSelection");
  }, 180_000);
});

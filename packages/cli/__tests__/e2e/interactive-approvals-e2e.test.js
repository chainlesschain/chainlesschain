/**
 * Interactive approvals — true e2e: a REAL spawned
 * `cc agent --input/output-format stream-json --interactive-approvals`
 * with a settings `ask` rule on Write. The fake (non-streaming) ollama makes
 * the model call write_file → the CLI emits approval_request and BLOCKS →
 * we answer over stdin → approve: the file is REALLY written; deny: it is
 * not. The exact protocol the chat panel's Approve/Deny card speaks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { testHome, freePort, CLI_BIN } from "./_helpers/cli-e2e.js";

const t = testHome("approvals");
let llmServer;
let llmPort;

beforeAll(async () => {
  // settings `ask` on Write → write_file hits the confirm tier
  const dotClaude = path.join(t.home, ".claude");
  fs.mkdirSync(dotClaude, { recursive: true });
  fs.writeFileSync(
    path.join(dotClaude, "settings.json"),
    JSON.stringify({ permissions: { ask: ["Write"] } }),
    "utf-8",
  );

  llmPort = await freePort();
  // Non-streaming fake ollama: call 1 → a write_file tool call whose target
  // comes from the LAST user message ("TARGET:<name>"); call 2+ → plain text.
  llmServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* ignore */
      }
      const msgs = parsed.messages || [];
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      const target = /TARGET:(\S+)/.exec(String(lastUser?.content || ""))?.[1];
      const sawToolResult = msgs.some((m) => m.role === "tool");
      res.writeHead(200, { "Content-Type": "application/json" });
      if (target && !sawToolResult) {
        res.end(
          JSON.stringify({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({
                      path: target,
                      content: "approved content",
                    }),
                  },
                },
              ],
            },
          }),
        );
      } else {
        res.end(
          JSON.stringify({
            message: { role: "assistant", content: "all done" },
          }),
        );
      }
    });
  });
  await new Promise((r) => llmServer.listen(llmPort, "127.0.0.1", r));
});

afterAll(async () => {
  llmServer.closeAllConnections?.();
  await new Promise((r) => llmServer.close(r));
  t.cleanup();
});

/** Spawn the real CLI in duplex mode and return line-event helpers. */
function startAgent() {
  const child = spawn(
    process.execPath,
    [
      CLI_BIN,
      "agent",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--interactive-approvals",
      "--no-ide",
      "--no-mcp",
      "--provider",
      "ollama",
      "--model",
      "fake-model",
      "--base-url",
      `http://127.0.0.1:${llmPort}`,
    ],
    { cwd: t.home, env: t.env(), stdio: ["pipe", "pipe", "pipe"] },
  );
  const events = [];
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* non-JSON stdout */
      }
    }
  });
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  return { child, events, send };
}

describe("real cc agent --interactive-approvals", () => {
  it("approve over stdin lets the blocked write_file actually write", async () => {
    const { child, events, send } = startAgent();
    try {
      await expect
        .poll(() => events.some((e) => e.subtype === "init"), {
          timeout: 60000,
        })
        .toBe(true);
      send({ type: "user", text: "write the file TARGET:yes.txt" });
      await expect
        .poll(() => events.find((e) => e.type === "approval_request"), {
          timeout: 60000,
        })
        .toBeTruthy();
      const req = events.find((e) => e.type === "approval_request");
      expect(req.tool).toBe("write_file");
      // the file must NOT exist while the approval is pending
      expect(fs.existsSync(path.join(t.home, "yes.txt"))).toBe(false);

      send({ type: "approval", id: req.id, approve: true });
      await expect
        .poll(() => events.some((e) => e.type === "result"), { timeout: 60000 })
        .toBe(true);
      expect(fs.readFileSync(path.join(t.home, "yes.txt"), "utf-8")).toBe(
        "approved content",
      );
      expect(events.find((e) => e.type === "approval_resolved").approved).toBe(
        true,
      );
    } finally {
      child.stdin.end();
      await new Promise((r) => child.on("close", r));
    }
  }, 180000);

  it("deny over stdin keeps the file unwritten", async () => {
    const { child, events, send } = startAgent();
    try {
      await expect
        .poll(() => events.some((e) => e.subtype === "init"), {
          timeout: 60000,
        })
        .toBe(true);
      send({ type: "user", text: "write the file TARGET:no.txt" });
      await expect
        .poll(() => events.find((e) => e.type === "approval_request"), {
          timeout: 60000,
        })
        .toBeTruthy();
      const req = events.find((e) => e.type === "approval_request");
      send({ type: "approval", id: req.id, approve: false });
      await expect
        .poll(() => events.some((e) => e.type === "result"), { timeout: 60000 })
        .toBe(true);
      expect(fs.existsSync(path.join(t.home, "no.txt"))).toBe(false);
      expect(events.find((e) => e.type === "approval_resolved").approved).toBe(
        false,
      );
      // the denial surfaced to the model as a tool error, not a crash
      const toolResult = events.find((e) => e.type === "tool_result");
      expect(String(toolResult.error || "")).toMatch(/confirmation|denied/i);
    } finally {
      child.stdin.end();
      await new Promise((r) => child.on("close", r));
    }
  }, 180000);
});

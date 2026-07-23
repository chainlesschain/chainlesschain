/**
 * E2E: the real `cc agent --resume` bin recovers a session whose previous run
 * produced NO assistant response, without tripping "roles must alternate".
 *
 * Reproduces Claude Code 2.1.187: a degenerate JSONL transcript that ends with a
 * bare `user` turn is resumed with a new prompt. The fake provider here behaves
 * like Anthropic/Bedrock — it 400s on two consecutive non-system same-role
 * messages. Before the fix the spawned agent would send `[…, user, user]` and
 * fail; after the fix the runner merges them and the run completes.
 *
 * Async spawn (NOT spawnSync): the fake LLM server runs in THIS process, so a
 * blocking spawnSync would deadlock the event loop.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { testHome, freePort, CLI_BIN } from "./_helpers/cli-e2e.js";

const t = testHome("resume-roles");
let llmServer;
let llmPort;
const captured = [];
let sawConsecutiveRole = null; // first violating role, or null if always clean

/** First non-system pair sharing a role, else null. */
function firstConsecutiveRole(messages) {
  const nonSys = (messages || []).filter((m) => m && m.role !== "system");
  for (let i = 1; i < nonSys.length; i++) {
    if (nonSys[i].role === nonSys[i - 1].role) return nonSys[i].role;
  }
  return null;
}

/** Seed a JSONL session whose run produced NO assistant response. */
function seedNoResponseSession(id) {
  // CHAINLESSCHAIN_HOME points at the config directory itself; the default
  // value happens to be ~/.chainlesschain, but an override is not nested again.
  const dir = path.join(t.home, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    {
      type: "session_start",
      timestamp: Date.now(),
      data: { title: "seed", provider: "ollama", model: "test" },
    },
    {
      type: "user_message",
      timestamp: Date.now(),
      data: { role: "user", content: "original task" },
    },
    // NOTE: intentionally NO assistant_message — the original run never replied.
  ];
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf-8",
  );
}

beforeAll(async () => {
  llmPort = await freePort();
  // Strict fake ollama: validates role alternation like Anthropic/Bedrock.
  llmServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        /* ignore */
      }
      captured.push({ url: req.url, body: parsed });
      const dupe = firstConsecutiveRole(parsed?.messages);
      if (dupe) {
        if (!sawConsecutiveRole) sawConsecutiveRole = dupe;
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: `messages: roles must alternate (consecutive ${dupe})`,
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: { role: "assistant", content: "resumed-ok-e2e" },
          prompt_eval_count: 10,
          eval_count: 4,
          done: true,
        }),
      );
    });
  });
  await new Promise((r) => llmServer.listen(llmPort, "127.0.0.1", r));
});

afterAll(async () => {
  await new Promise((r) => llmServer.close(r));
  t.cleanup();
});

function runResume(sessionId) {
  const before = captured.length;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        CLI_BIN,
        "agent",
        "-p",
        "continue please",
        "--resume",
        sessionId,
        "--no-mcp",
        "--provider",
        "ollama",
        "--model",
        "test",
        "--base-url",
        `http://127.0.0.1:${llmPort}`,
        "--output-format",
        "json",
      ],
      {
        env: t.env(),
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
      resolve({ status, stdout, stderr, requests: captured.slice(before) });
    });
  });
}

describe("cc agent --resume after a no-response run (2.1.187 parity)", () => {
  it("resumes successfully and never sends consecutive same-role turns", async () => {
    seedNoResponseSession("sid-noresp");
    const { status, stdout, requests } = await runResume("sid-noresp");

    // The run succeeded — a strict provider did NOT reject the payload.
    expect(status).toBe(0);
    expect(stdout).toContain("resumed-ok-e2e");
    expect(sawConsecutiveRole).toBeNull();

    // The provider was actually called, with an alternating payload whose
    // single user turn carries BOTH the resumed and the new prompt.
    const chat = requests.filter((c) => c.url.includes("/api/chat"));
    expect(chat.length).toBeGreaterThan(0);
    const msgs = chat[0].body.messages;
    expect(firstConsecutiveRole(msgs)).toBeNull();
    const users = msgs.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0].content).toContain("original task");
    expect(users[0].content).toContain("continue please");
  }, 180_000);
});

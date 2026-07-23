/**
 * True e2e: AgentSession driving the REAL cc CLI (sibling packages/cli
 * checkout) against a fake non-streaming ollama, exercising every SDK
 * contract end-to-end:
 *   1. stream-event contract  — init (session_id), text, result
 *   2. approval-callback contract — settings `ask` on Write blocks the tool
 *      until onApproval answers; approve → the file is REALLY written
 *   3. session-resume contract — a second AgentSession with resume:<id>
 *      reports resumed_messages > 0
 *
 * Same isolation pattern as packages/cli/__tests__/e2e (CHAINLESSCHAIN_HOME
 * temp dir + per-run free port).
 */
import http from "node:http";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSession } from "../src/agent-session.js";
import type { ResultEvent, SystemInitEvent } from "../src/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, "..", "..", "cli", "bin", "chainlesschain.js");

const home = mkdtempSync(join(tmpdir(), "cc-sdk-e2e-"));
let llmServer: http.Server;
let llmPort: number;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.once("error", reject);
  });
}

beforeAll(async () => {
  // settings `ask` on Write → write_file hits the approval CONFIRM tier.
  const dotClaude = join(home, ".claude");
  mkdirSync(dotClaude, { recursive: true });
  writeFileSync(
    join(dotClaude, "settings.json"),
    JSON.stringify({ permissions: { ask: ["Write"] } }),
    "utf-8",
  );

  llmPort = await freePort();
  // Fake non-streaming ollama: "TARGET:<path>" in the last user message and
  // no tool result yet → one write_file tool call; anything else → text.
  llmServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: { messages?: Array<{ role: string; content?: unknown }> } =
        {};
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
                      content: "sdk e2e content",
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
            message: { role: "assistant", content: "all done from fake llm" },
          }),
        );
      }
    });
  });
  await new Promise<void>((r) => llmServer.listen(llmPort, "127.0.0.1", r));
}, 30_000);

afterAll(async () => {
  (llmServer as http.Server & { closeAllConnections?: () => void })
    .closeAllConnections?.();
  await new Promise((r) => llmServer.close(r));
  // A just-killed cc child can hold its better_sqlite3 file lock for a
  // moment (known Windows gotcha) — retry, then leave the temp dir to the
  // OS rather than failing the suite over cleanup.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(home, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}, 30_000);

function newSession(
  options: Partial<ConstructorParameters<typeof AgentSession>[0]> = {},
) {
  return new AgentSession({
    cliPath: CLI_BIN,
    cwd: home,
    env: {
      CHAINLESSCHAIN_HOME: home,
      HOME: home,
      USERPROFILE: home,
      CC_DEBUG: "1",
    },
    extraArgs: [
      "--no-ide",
      "--no-mcp",
      "--provider",
      "ollama",
      "--model",
      "fake-model",
      "--base-url",
      `http://127.0.0.1:${llmPort}`,
    ],
    ...options,
  });
}

describe("AgentSession ↔ real cc agent (e2e)", () => {
  it(
    "streams init/text/result, answers approvals via callback (file really written), resumes",
    async () => {
      // ── Turn 1: plain text turn — stream-event + result contracts ──────
      // Explicit sessionId: anonymous stream sessions are persistence-free
      // by CLI design, so a resumable session must declare its id up front.
      const declaredId = `sdk-e2e-${process.pid}-${Date.now()}`;
      const approvals: string[] = [];
      const first = newSession({
        sessionId: declaredId,
        onApproval: async (req) => {
          approvals.push(req.tool || "?");
          return true;
        },
      });
      const inits: SystemInitEvent[] = [];
      const results: ResultEvent[] = [];
      let streamedText = "";
      first.on("init", (e) => inits.push(e));
      first.on("result", (e) => results.push(e));
      first.on("text", (t) => (streamedText += t));
      const stderrLines: string[] = [];
      first.on("stderr", (c) => stderrLines.push(c));
      first.start();

      first.send("say hello");
      let r1: ResultEvent;
      try {
        r1 = await first.nextResult();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cliStderr = stderrLines.join("").trim();
        throw new Error(
          cliStderr
            ? `${message}\ncc stderr:\n${cliStderr}`
            : `${message}\ncc stderr: <empty>`,
        );
      }
      expect(r1.is_error).toBe(false);
      expect(inits.length).toBe(1);
      const sessionId = first.sessionId;
      expect(sessionId).toBe(declaredId);
      // Deltas streamed and/or the result carries the final text.
      expect((streamedText + (r1.result || "")).length).toBeGreaterThan(0);

      // ── Turn 2: approval-callback contract — blocked Write really lands ─
      const targetFile = join(home, "sdk-e2e-approved.txt");
      first.send(`please write the file TARGET:${targetFile}`);
      const r2 = await first.nextResult();
      expect(approvals).toContain("write_file");
      expect(r2.is_error).toBe(false);
      expect(existsSync(targetFile)).toBe(true);

      first.end();
      await new Promise<void>((resolve) => {
        first.on("exit", () => resolve());
        setTimeout(resolve, 10_000);
      });

      // ── Session-resume contract ─────────────────────────────────────────
      const second = newSession({ resume: sessionId as string });
      const resumedInits: SystemInitEvent[] = [];
      second.on("init", (e) => resumedInits.push(e));
      second.start();
      second.send("and again");
      const r3 = await second.nextResult();
      expect(r3.is_error).toBe(false);
      expect(resumedInits.length).toBe(1);
      expect(resumedInits[0].session_id).toBe(sessionId);
      expect(resumedInits[0].resumed_messages ?? 0).toBeGreaterThan(0);
      second.end();
      const exited = new Promise<void>((resolve) => {
        second.on("exit", () => resolve());
        setTimeout(resolve, 10_000);
      });
      second.kill();
      await exited;
    },
    180_000,
  );
});

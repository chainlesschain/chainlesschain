/**
 * Chat panel ⇆ REAL CLI e2e: the extension's AgentChatSession drives a real
 * spawned `cc agent --input/output-format stream-json --include-partial-messages`
 * against a STREAMING fake ollama (NDJSON chunks, the shape the CLI's
 * onToken path consumes). Proves the panel's exact protocol contract:
 * init → deltas → per-turn result → multi-turn → graceful stdin-close exit.
 *
 * (Servers live in this process; the session spawns asynchronously, so no
 * spawnSync event-loop deadlock — see ide-context-e2e.test.js.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";

import { testHome, freePort, CLI_BIN } from "./_helpers/cli-e2e.js";
import { AgentChatSession } from "../../../vscode-extension/src/chat/agent-session.js";

const t = testHome("chatpanel");
let llmServer;
let llmPort;
let llmCalls = 0;

beforeAll(async () => {
  llmPort = await freePort();
  // Streaming fake ollama: /api/chat with stream:true → NDJSON chunks.
  llmServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      llmCalls += 1;
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      const part = (content, done) =>
        JSON.stringify({
          message: { role: "assistant", content },
          done,
        }) + "\n";
      res.write(part("reply-", false));
      res.write(part(`turn${llmCalls}`, false));
      res.end(
        JSON.stringify({ done: true, prompt_eval_count: 5, eval_count: 2 }) +
          "\n",
      );
    });
  });
  await new Promise((r) => llmServer.listen(llmPort, "127.0.0.1", r));
});

afterAll(async () => {
  await new Promise((r) => llmServer.close(r));
  t.cleanup();
});

describe("AgentChatSession ⇆ real cc agent duplex", () => {
  it("streams two full turns and exits 0 on graceful end()", async () => {
    const events = [];
    let exited = null;
    const session = new AgentChatSession({
      args: [
        "--no-ide",
        "--no-mcp",
        "--provider",
        "ollama",
        "--model",
        "fake-model",
        "--base-url",
        `http://127.0.0.1:${llmPort}`,
      ],
      cwd: t.home,
      env: t.env(),
      onEvent: (e) => events.push(e),
      onExit: (e) => (exited = e),
      deps: {
        // run the real bin through node, preserving the session's own args
        spawn: (_cmd, args, opts) =>
          spawn(process.execPath, [CLI_BIN, ...args], {
            ...opts,
            shell: false,
          }),
      },
    }).start();

    // init line arrives once the CLI is up
    await expect
      .poll(() => events.some((e) => e.subtype === "init"), {
        timeout: 60000,
      })
      .toBe(true);

    // turn 1: deltas stream, then a success result with the joined text
    expect(session.send("first question")).toBe(true);
    await expect
      .poll(() => events.filter((e) => e.type === "result").length, {
        timeout: 60000,
      })
      .toBe(1);
    const r1 = events.find((e) => e.type === "result");
    expect(r1.is_error).toBe(false);
    expect(r1.result).toBe("reply-turn1");
    expect(
      events.some(
        (e) =>
          e.type === "stream_event" && e.event?.delta?.type === "text_delta",
      ),
    ).toBe(true);

    // turn 2 on the SAME child (multi-turn duplex)
    expect(session.send("second question")).toBe(true);
    await expect
      .poll(() => events.filter((e) => e.type === "result").length, {
        timeout: 60000,
      })
      .toBe(2);
    expect(events.filter((e) => e.type === "result")[1].result).toBe(
      "reply-turn2",
    );

    // graceful shutdown: closing stdin ends the conversation loop
    session.end();
    await expect.poll(() => exited !== null, { timeout: 60000 }).toBe(true);
    expect(exited.code).toBe(0);
  }, 180000);
});

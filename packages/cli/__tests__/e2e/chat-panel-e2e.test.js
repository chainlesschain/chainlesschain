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
const llmBodies = [];

beforeAll(async () => {
  llmPort = await freePort();
  // Streaming fake ollama: /api/chat with stream:true → NDJSON chunks.
  llmServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      llmCalls += 1;
      let parsedBody = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        /* keep null */
      }
      llmBodies.push(parsedBody);
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      const part = (content, done) =>
        JSON.stringify({
          message: { role: "assistant", content },
          done,
        }) + "\n";
      const finish = () => {
        res.write(part("reply-", false));
        res.write(part(`turn${llmCalls}`, false));
        res.end(
          JSON.stringify({ done: true, prompt_eval_count: 5, eval_count: 2 }) +
            "\n",
        );
      };
      // SLOW marker: hold the response open (interrupt e2e aborts the fetch).
      // Only the LAST user message counts — history carries the marker into
      // every later request of the same conversation.
      const lastUser = [...(parsedBody?.messages || [])]
        .reverse()
        .find((m) => m && m.role === "user");
      const wantsSlow = String(lastUser?.content || "").includes("SLOW-REPLY");
      if (wantsSlow) {
        const t = setTimeout(finish, 60000);
        req.on("close", () => clearTimeout(t));
        res.on("close", () => clearTimeout(t));
      } else {
        finish();
      }
    });
  });
  await new Promise((r) => llmServer.listen(llmPort, "127.0.0.1", r));
});

afterAll(async () => {
  llmServer.closeAllConnections?.(); // drop any held SLOW sockets
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

  it("--resume continues the conversation across a child restart", async () => {
    const RESUME_ID = "chat-e2e-resume";
    const mkSession = (sink) =>
      new AgentChatSession({
        args: [
          "--no-ide",
          "--no-mcp",
          "--provider",
          "ollama",
          "--model",
          "fake-model",
          "--base-url",
          `http://127.0.0.1:${llmPort}`,
          "--resume",
          RESUME_ID,
        ],
        cwd: t.home,
        env: t.env(),
        onEvent: (e) => sink.events.push(e),
        onExit: (e) => (sink.exited = e),
        deps: {
          spawn: (_cmd, args, opts) =>
            spawn(process.execPath, [CLI_BIN, ...args], {
              ...opts,
              shell: false,
            }),
        },
      }).start();

    // ── child #1: one persisted turn, then exit ──
    const s1 = { events: [], exited: null };
    const c1 = mkSession(s1);
    await expect
      .poll(() => s1.events.some((e) => e.subtype === "init"), {
        timeout: 60000,
      })
      .toBe(true);
    expect(c1.send("remember the magic word: zebra")).toBe(true);
    await expect
      .poll(() => s1.events.some((e) => e.type === "result"), {
        timeout: 60000,
      })
      .toBe(true);
    c1.end();
    await expect.poll(() => s1.exited !== null, { timeout: 60000 }).toBe(true);

    // ── child #2: SAME id — history must replay into the conversation ──
    const beforeBodies = llmBodies.length;
    const s2 = { events: [], exited: null };
    const c2 = mkSession(s2);
    await expect
      .poll(() => s2.events.some((e) => e.subtype === "init"), {
        timeout: 60000,
      })
      .toBe(true);
    const init2 = s2.events.find((e) => e.subtype === "init");
    expect(init2.session_id).toBe(RESUME_ID);
    expect(init2.resumed_messages).toBeGreaterThanOrEqual(2); // user+assistant

    expect(c2.send("what was the magic word?")).toBe(true);
    await expect
      .poll(() => s2.events.some((e) => e.type === "result"), {
        timeout: 60000,
      })
      .toBe(true);
    // The LLM request from child #2 carries child #1's turn — resume is real.
    const body2 = llmBodies
      .slice(beforeBodies)
      .find((b) => b && Array.isArray(b.messages));
    const userTexts = body2.messages
      .filter((m) => m.role === "user")
      .map((m) => String(m.content));
    expect(userTexts.some((c) => c.includes("magic word: zebra"))).toBe(true);
    expect(userTexts.some((c) => c.includes("what was the magic word?"))).toBe(
      true,
    );

    c2.end();
    await expect.poll(() => s2.exited !== null, { timeout: 60000 }).toBe(true);
    expect(s2.exited.code).toBe(0);
  }, 240000);

  it("interrupt aborts the in-flight turn; the SAME child answers the next one", async () => {
    const sink = { events: [], exited: null };
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
      onEvent: (e) => sink.events.push(e),
      onExit: (e) => (sink.exited = e),
      deps: {
        spawn: (_cmd, args, opts) =>
          spawn(process.execPath, [CLI_BIN, ...args], {
            ...opts,
            shell: false,
          }),
      },
    }).start();

    await expect
      .poll(() => sink.events.some((e) => e.subtype === "init"), {
        timeout: 60000,
      })
      .toBe(true);

    // a turn whose LLM response hangs for 60s on the fake server
    const callsBefore = llmCalls;
    expect(session.send("please SLOW-REPLY now")).toBe(true);
    await expect
      .poll(() => llmCalls > callsBefore, { timeout: 60000 })
      .toBe(true);
    // interrupt while the fetch is in flight → interrupted result, fast
    expect(session.sendEvent({ type: "interrupt" })).toBe(true);
    await expect
      .poll(
        () => sink.events.some((e) => e.type === "result" && e.interrupted),
        { timeout: 30000 },
      )
      .toBe(true);
    const interrupted = sink.events.find(
      (e) => e.type === "result" && e.interrupted,
    );
    expect(interrupted.is_error).toBe(false);

    // the conversation (same child) keeps working
    expect(session.send("quick one")).toBe(true);
    await expect
      .poll(
        () =>
          sink.events.filter(
            (e) => e.type === "result" && e.subtype === "success",
          ).length,
        { timeout: 60000 },
      )
      .toBeGreaterThanOrEqual(1);

    session.end();
    await expect
      .poll(() => sink.exited !== null, { timeout: 60000 })
      .toBe(true);
    expect(sink.exited.code).toBe(0);
  }, 240000);
});

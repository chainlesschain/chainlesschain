/**
 * Background stability matrix — real-spawn cells (gap #5). Everything here
 * launches the REAL detached background-agent worker with a fake CLI entry
 * (a tiny .mjs script), so it exercises the true process tree:
 *
 *   launcher → node worker (state.pid/workerPid) → node fake-cli (agentPid)
 *
 *  4. process tree pids  — workerPid vs agentPid divergence is real and
 *     recorded; the pid the supervisor watches is the one that dies with
 *     the session (the worker)
 *  6. needs-input phase  — turn → idle transition persists phase/turnCount,
 *     a live idle session is never flipped by stale-correction, a rename
 *     landed while idle survives finalize (rename-race regression, live)
 *  8. log tail           — truncating the log while the worker is appending
 *     crashes neither the appender nor the reader, and the tail reads clean
 *
 * Cleanup discipline: every launched session id is tracked; afterEach
 * force-kills any process tree still alive (this repo was burned by orphan
 * node/vitest processes). No arbitrary sleeps — all waits poll a deadline.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  effectiveBackgroundAgentState,
  isProcessAlive,
  launchBackgroundAgent,
  logPath,
  readBackgroundAgentLog,
  readBackgroundAgentState,
  renameBackgroundAgent,
} from "../../src/lib/background-agent-supervisor.js";
import { connectBackgroundSession } from "../../src/lib/background-session-transport.js";

let dir;
let launchedIds;

function killTree(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return;
  if (!isProcessAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-Number(pid), "SIGKILL");
    } catch {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

async function pollUntil(fn, { timeoutMs = 10_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-bg-real-"));
  process.env.CC_BACKGROUND_AGENTS_DIR = dir;
  launchedIds = [];
});

afterEach(async () => {
  // Reap every child we may have leaked — worker trees first (taskkill /T /F
  // and POSIX process-group kill take the agent child down with the worker),
  // then any straggler agentPid.
  for (const id of launchedIds) {
    const state = readBackgroundAgentState(id);
    killTree(state?.pid);
    if (state?.agentPid) killTree(state.agentPid);
  }
  delete process.env.CC_BACKGROUND_AGENTS_DIR;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (
        (error?.code !== "EBUSY" && error?.code !== "EPERM") ||
        attempt === 39
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

function launch({ script, argv = [], followUpArgv, title = "matrix" }) {
  const fakeCli = join(
    dir,
    `fake-${Math.random().toString(36).slice(2, 8)}.mjs`,
  );
  writeFileSync(fakeCli, script, "utf-8");
  const state = launchBackgroundAgent({
    argv,
    cwd: dir,
    sessionId: `sid-${title}`,
    title,
    cliEntry: fakeCli,
    ...(followUpArgv ? { followUpArgv } : {}),
  });
  launchedIds.push(state.id);
  return state;
}

describe("4. process tree — workerPid vs agentPid semantics (real spawn)", () => {
  it("records BOTH pids, they diverge, and the watched pid is the worker's", async () => {
    const state = launch({
      // Keep the child alive long enough for the worker's first state merge to
      // be observable on slower Windows runners.
      script: "setTimeout(() => process.exit(0), 1500);\n",
      title: "pids",
    });
    // the launcher records the worker it spawned
    expect(state.pid).toBeGreaterThan(0);
    expect(state.workerPid).toBe(state.pid);

    // once the worker starts the turn, the agent child pid appears — and it
    // is a DIFFERENT process than the worker
    const withAgent = await pollUntil(() => {
      const s = readBackgroundAgentState(state.id);
      return Number.isInteger(s?.agentPid) && s.agentPid > 0 ? s : null;
    });
    expect(withAgent).not.toBe(null);
    expect(withAgent.workerPid).toBe(state.pid);
    expect(withAgent.agentPid).not.toBe(withAgent.workerPid);

    // the session ends when the WORKER exits (it supervises the agent child
    // to completion) — liveness is keyed to state.pid, per the pinned unit
    // semantics in background-stability-matrix2.test.js
    const completed = await pollUntil(() => {
      const s = readBackgroundAgentState(state.id);
      return s?.status === "completed" ? s : null;
    });
    expect(completed).not.toBe(null);
    expect(completed.exitCode).toBe(0);
    // the worker writes the terminal state and THEN exits (transport close
    // → process.exit), so give the pid a moment to actually die instead of
    // asserting inside that legitimate few-ms window
    const workerGone = await pollUntil(() =>
      isProcessAlive(completed.pid) ? null : true,
    );
    expect(workerGone).toBe(true);
  }, 20_000);
});

describe("6. needs-input phase — turn → idle → finalize (real spawn)", () => {
  it("persists phase/turnCount through idle, never flips the live session, and keeps a rename landed while idle", async () => {
    // Turn 1 (no -p) runs long enough for the client to attach; follow-up
    // turns would exit fast (unused here — we only ride turn 1 into idle).
    const state = launch({
      script: [
        "const argv = process.argv.slice(2);",
        'const wait = argv.includes("-p") ? 100 : 3000;',
        "setTimeout(() => process.exit(0), wait);",
        "",
      ].join("\n"),
      argv: ["--flag-a"],
      followUpArgv: ["--flag-a"],
      title: "phase",
    });

    // wait for the worker's transport endpoint, then attach a client so the
    // worker parks in "idle" instead of finalizing after turn 1
    const transport = await pollUntil(
      () => readBackgroundAgentState(state.id)?.transport || null,
    );
    expect(transport?.pipe).toBeTruthy();

    const events = [];
    const conn = await connectBackgroundSession({
      pipePath: transport.pipe,
      token: transport.token,
      onEvent: (m) => events.push(m),
    });
    expect(conn.hello).toMatchObject({ type: "hello", interactive: true });

    // during turn 1 the persisted phase is "turn"
    const inTurn = readBackgroundAgentState(state.id);
    expect(inTurn.status).toBe("running");
    expect(inTurn.phase).toBe("turn");
    expect(inTurn.turnCount).toBe(1);

    // turn 1 ends with a client attached → phase flips to idle, the agent
    // child pid is cleared, the session STAYS running
    const idle = await pollUntil(() => {
      const s = readBackgroundAgentState(state.id);
      return s?.phase === "idle" ? s : null;
    });
    expect(idle).not.toBe(null);
    expect(idle.status).toBe("running");
    expect(idle.turnCount).toBe(1);
    expect(idle.agentPid).toBe(null);
    // the disk write lands BEFORE the broadcast frame reaches this client's
    // socket — poll for the event instead of asserting instantly
    const sawIdleEvent = await pollUntil(() =>
      events.some((e) => e.type === "idle") ? true : null,
    );
    expect(sawIdleEvent).toBe(true);

    // stale-correction never flips a live idle session (worker pid alive,
    // heartbeat fresh) — identity pin on the effective state
    const raw = readBackgroundAgentState(state.id);
    expect(effectiveBackgroundAgentState(raw)).toBe(raw);

    // rename while idle — the live rename-race regression: the title must
    // survive the worker's finalize write on detach
    const renamed = renameBackgroundAgent(state.id, "renamed-while-idle");
    expect(renamed.title).toBe("renamed-while-idle");

    // detach while idle → the worker finalizes with turn 1's exit code
    conn.close();
    const final = await pollUntil(() => {
      const s = readBackgroundAgentState(state.id);
      return s?.status && s.status !== "running" ? s : null;
    });
    expect(final?.status).toBe("completed");
    expect(final?.turnCount).toBe(1);
    expect(final?.transport ?? null).toBe(null);
    expect(final?.phase ?? null).toBe(null);
    expect(final?.title).toBe("renamed-while-idle");
  }, 45_000);
});

describe("8. log tail — truncation while the worker is appending (real spawn)", () => {
  it("neither the appender nor the reader crashes, and the tail reads clean afterwards", async () => {
    const state = launch({
      script: [
        "let i = 0;",
        "const t = setInterval(() => {",
        "  console.log(`line-${i}`);",
        "  if (++i >= 20) { clearInterval(t); process.exit(0); }",
        "}, 60);",
        "",
      ].join("\n"),
      title: "logrot",
    });
    const file = logPath(state.id);

    // wait until the worker has demonstrably written a few lines
    const early = await pollUntil(() =>
      readBackgroundAgentLog(state.id).includes("line-3") ? true : null,
    );
    expect(early).toBe(true);

    // rotate: copytruncate-style — truncate the file the worker holds an
    // O_APPEND fd on (allowed on POSIX and on Windows thanks to libuv's
    // share-mode opens)
    writeFileSync(file, "", "utf-8");

    // reader survives immediately after truncation
    expect(() => readBackgroundAgentLog(state.id)).not.toThrow();

    // the worker keeps appending post-truncation and completes normally
    const completed = await pollUntil(() => {
      const s = readBackgroundAgentState(state.id);
      return s?.status === "completed" ? s : null;
    });
    expect(completed).not.toBe(null);
    expect(completed.exitCode).toBe(0);

    const tail = readBackgroundAgentLog(state.id, { lines: 100 });
    expect(tail).toContain("line-19"); // fresh content is all there
    expect(tail).not.toContain("line-0"); // truncated content is not duplicated back
  }, 20_000);
});

describe("P0-2 same-turn question round-trip (real worker/child IPC)", () => {
  it("answers a suspended tool call and completes without starting a follow-up turn", async () => {
    const evidenceFile = join(dir, "same-turn-result.json");
    const interactionModule = pathToFileURL(
      join(
        process.cwd(),
        "src",
        "lib",
        "background-interaction-resolver.js",
      ),
    ).href;
    const state = launch({
      script: [
        `import { createBackgroundInteractionClient } from ${JSON.stringify(interactionModule)};`,
        `import { writeFileSync } from "node:fs";`,
        `const client = createBackgroundInteractionClient({`,
        `  sessionId: "sid-same-turn",`,
        `  turnId: "provider-turn-1",`,
        `});`,
        `const beforePid = process.pid;`,
        `const answer = await client.request({`,
        `  question: "Deploy to production?",`,
        `  options: ["yes", "no"],`,
        `  toolUseId: "provider-tool-call-1",`,
        `  timeoutMs: 15000,`,
        `});`,
        `writeFileSync(${JSON.stringify(evidenceFile)}, JSON.stringify({`,
        `  beforePid, afterPid: process.pid, answer`,
        `}));`,
        `client.close();`,
        "",
      ].join("\n"),
      followUpArgv: ["--unused-follow-up"],
      title: "same-turn",
    });

    const transport = await pollUntil(
      () => readBackgroundAgentState(state.id)?.transport || null,
    );
    expect(transport?.pipe).toBeTruthy();

    const interactionEvents = [];
    let conn = null;
    const queuedResponses = [];
    const respond = (message) => {
      const response = {
        type: "interaction_response",
        requestId: message.requestId,
        binding: message.binding,
        answer: "yes",
      };
      if (conn) conn.send(response);
      else queuedResponses.push(response);
    };
    conn = await connectBackgroundSession({
      pipePath: transport.pipe,
      token: transport.token,
      onEvent: (message) => {
        if (message.type !== "interaction_request") return;
        interactionEvents.push(message);
        respond(message);
      },
    });
    for (const response of queuedResponses.splice(0)) conn.send(response);

    const evidence = await pollUntil(() => {
      try {
        return JSON.parse(readFileSync(evidenceFile, "utf8"));
      } catch {
        return null;
      }
    }, { timeoutMs: 20_000 });
    expect(evidence).toEqual({
      beforePid: expect.any(Number),
      afterPid: expect.any(Number),
      answer: "yes",
    });
    expect(evidence.afterPid).toBe(evidence.beforePid);
    // Once the suspended turn has consumed the answer, detach. Keeping the
    // client connected intentionally parks a completed interactive session in
    // idle, so terminal-state verification must happen after detach.
    conn.close();

    const completed = await pollUntil(() => {
      const current = readBackgroundAgentState(state.id);
      return current?.status === "completed" ? current : null;
    }, { timeoutMs: 20_000 });
    expect(completed?.turnCount).toBe(1);
    expect(interactionEvents).toHaveLength(1);
    expect(interactionEvents[0]).toMatchObject({
      question: "Deploy to production?",
      binding: {
        backgroundAgentId: state.id,
        sessionId: "sid-same-turn",
        turnId: "provider-turn-1",
        toolUseId: "provider-tool-call-1",
        sequence: 1,
      },
    });
  }, 30_000);
});

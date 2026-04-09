/**
 * Sub-runtime entry — a headless Electron-main child process.
 *
 * The parent Electron-main spawns this file via
 *   child_process.spawn(process.execPath, [thisFile], {
 *     env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
 *   })
 *
 * so it runs as a plain Node process (no BrowserWindow, no DI container,
 * no database, no IPC, no MCP). Its only job is to execute a single
 * assignment against an *isolated* member session dir and stream
 * progress events back to the parent over stdout.
 *
 * Protocol (JSON-lines over stdin / stdout):
 *   parent → child on stdin:
 *     { cmd: "run", projectRoot, sessionId, assignment: { memberIdx, role, steps } }
 *     { cmd: "shutdown" }
 *   child → parent on stdout (one JSON object per line):
 *     { type: "ready" }
 *     { type: "progress", memberId, step, index, total }
 *     { type: "done", memberId, success: true }
 *     { type: "error", memberId?, error }
 *
 * Design choices:
 *   - No WebSocket / port — stdio is reliable, trivial to test, no auth needed.
 *   - No CodingAgentBridge inside the child — it would explode the process
 *     footprint (one CLI server per member). Sub-runtimes run skill logic
 *     directly against the filesystem.
 *   - Errors never crash the child on their own — we report them and
 *     wait for the next command or an explicit "shutdown".
 */

const readline = require("readline");
const {
  SessionStateManager,
} = require("../ai-engine/code-agent/session-state-manager.js");

// Test injection seam so unit tests can drive the handler loop without
// actually piping real stdin/stdout.
const _deps = {
  SessionStateManager,
  write: (obj) => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  },
  exit: (code) => process.exit(code),
};

async function handleRun(msg) {
  const { projectRoot, sessionId, assignment } = msg;
  if (!projectRoot || !sessionId || !assignment) {
    _deps.write({
      type: "error",
      error: "run: projectRoot, sessionId, assignment required",
    });
    return;
  }

  const manager = new _deps.SessionStateManager({ projectRoot });
  const { memberIdx, role, steps = [] } = assignment;

  let member;
  try {
    member = manager.createMemberSession(sessionId, memberIdx, { role, steps });
  } catch (err) {
    _deps.write({
      type: "error",
      error: `createMemberSession failed: ${err.message}`,
    });
    return;
  }

  const { memberId } = member;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    try {
      manager.appendProgress(memberId, `[${role}] ${step}`);
      _deps.write({
        type: "progress",
        memberId,
        step,
        index: i,
        total: steps.length,
      });
    } catch (err) {
      _deps.write({ type: "error", memberId, error: err.message });
      return;
    }
  }
  _deps.write({ type: "done", memberId, success: true });
}

function createDispatcher() {
  return async function dispatch(msg) {
    if (!msg || typeof msg !== "object") {
      _deps.write({ type: "error", error: "malformed message" });
      return;
    }
    if (msg.cmd === "run") {
      await handleRun(msg);
      return;
    }
    if (msg.cmd === "shutdown") {
      _deps.write({ type: "bye" });
      _deps.exit(0);
      return;
    }
    _deps.write({ type: "error", error: `unknown cmd "${msg.cmd}"` });
  };
}

function start() {
  const dispatch = createDispatcher();
  _deps.write({ type: "ready" });
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      _deps.write({ type: "error", error: `bad json: ${err.message}` });
      return;
    }
    dispatch(msg).catch((err) => {
      _deps.write({ type: "error", error: err.message });
    });
  });
  rl.on("close", () => {
    _deps.exit(0);
  });
}

// Only auto-start when run directly (not when required by a test).
if (require.main === module) {
  start();
}

module.exports = { handleRun, createDispatcher, start, _deps };

/**
 * Integration: `cc agent -p` (runAgentHeadless) now runs `async:true` hooks.
 * Before this, async hooks were silently skipped in headless (no supervisor);
 * now the runner builds one, fires async Stop hooks at run end, settles them
 * (bounded), and surfaces results/rewakes on stderr. Real `child_process.spawn`
 * via `node -e` so the whole fire-and-forget path is exercised.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

const NODE = process.execPath.replace(/\\/g, "/");

function makeDeps() {
  const out = [];
  const err = [];
  async function* fakeLoop() {
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", runId: "r", reason: "complete" };
  }
  return {
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      agentLoop: fakeLoop,
    },
    out,
    err,
  };
}

const stopHook = (command, extra = {}) => ({
  Stop: [
    {
      matcher: null,
      hooks: [{ type: "command", command, async: true, ...extra }],
    },
  ],
});

describe("runAgentHeadless async hooks", () => {
  it("surfaces a failed asyncRewake Stop hook on stderr", async () => {
    const { deps, err } = makeDeps();
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        asyncHookWaitMs: 8000,
        settingsHooks: stopHook(`"${NODE}" -e "process.exit(1)"`, {
          asyncRewake: true,
        }),
      },
      deps,
    );
    // The run itself still succeeds — the async hook is out-of-band.
    expect(res.isError).toBe(false);
    const stderr = err.join("");
    expect(stderr).toMatch(/\[async-hook REWAKE\]/);
    expect(stderr).toMatch(/exit 1/);
  });

  it("surfaces a passing async hook's additionalContext on stderr", async () => {
    const { deps, err } = makeDeps();
    const script =
      "let d='';process.stdin.on('data',c=>d+=c);" +
      "process.stdin.on('end',()=>{" +
      "console.log(JSON.stringify({additionalContext:'bg-check-passed'}))})";
    await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        asyncHookWaitMs: 8000,
        settingsHooks: stopHook(`"${NODE}" -e "${script}"`),
      },
      deps,
    );
    expect(err.join("")).toMatch(/\[async-hook\].*bg-check-passed/);
  });

  it("does nothing extra when there are no async hooks (clean run)", async () => {
    const { deps, err } = makeDeps();
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        settingsHooks: {
          // a SYNC Stop hook — must not be treated as async / surfaced
          Stop: [
            {
              matcher: null,
              hooks: [{ type: "command", command: `"${NODE}" -e ""` }],
            },
          ],
        },
      },
      deps,
    );
    expect(res.isError).toBe(false);
    expect(err.join("")).not.toMatch(/\[async-hook/);
  });
});

// A deps whose fake loop counts how many times it is (re-)driven.
function makeCountingDeps() {
  const out = [];
  const err = [];
  const counter = { calls: 0 };
  async function* countingLoop() {
    counter.calls += 1;
    yield { type: "response-complete", content: `turn ${counter.calls}` };
    yield { type: "run-ended", runId: "r", reason: "complete" };
  }
  return {
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      agentLoop: countingLoop,
    },
    counter,
    out,
    err,
  };
}

const failingRewake = stopHook(`"${NODE}" -e "process.exit(1)"`, {
  asyncRewake: true,
});

describe("runAgentHeadless --auto-rewake re-drive", () => {
  it("re-drives the agent once when a rewake fails and budget is 1", async () => {
    const { deps, counter, err } = makeCountingDeps();
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        asyncHookWaitMs: 8000,
        autoRewake: true, // maxRewakes defaults to 1
        settingsHooks: failingRewake,
      },
      deps,
    );
    expect(res.isError).toBe(false);
    // initial turn + exactly one re-drive.
    expect(counter.calls).toBe(2);
    // the final turn's still-failing rewake is surfaced once budget is spent.
    expect(err.join("")).toMatch(/\[async-hook REWAKE\]/);
  });

  it("honors maxRewakes as the re-drive cap", async () => {
    const { deps, counter } = makeCountingDeps();
    await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        asyncHookWaitMs: 8000,
        autoRewake: true,
        maxRewakes: 2,
        settingsHooks: failingRewake,
      },
      deps,
    );
    // initial + two re-drives.
    expect(counter.calls).toBe(3);
  });

  it("does NOT re-drive by default (opt-in) even with a failing rewake hook", async () => {
    const { deps, counter, err } = makeCountingDeps();
    await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        asyncHookWaitMs: 8000,
        settingsHooks: failingRewake, // no autoRewake
      },
      deps,
    );
    expect(counter.calls).toBe(1); // ran once, surfaced but not re-driven
    expect(err.join("")).toMatch(/\[async-hook REWAKE\]/);
  });

  it("does NOT re-drive when the rewake check PASSES", async () => {
    const { deps, counter } = makeCountingDeps();
    await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        expandFileRefs: false,
        asyncHookWaitMs: 8000,
        autoRewake: true,
        // exit 0 → the check passed → no rewake queued.
        settingsHooks: stopHook(`"${NODE}" -e ""`, { asyncRewake: true }),
      },
      deps,
    );
    expect(counter.calls).toBe(1);
  });
});

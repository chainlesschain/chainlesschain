import { describe, it, expect } from "vitest";
import { AsyncHookSupervisor } from "../../src/lib/async-hook-supervisor.cjs";

/**
 * Integration tier for the async hook supervisor: unlike the unit tests (which
 * inject a fake `spawn`), these drive the REAL `child_process.spawn` through a
 * shell, so the whole fire-and-forget path — stdin JSON, stdout capture,
 * exit-code classification, timeout kill — is exercised end to end. Commands are
 * `node -e …` so they run identically on Windows/macOS/Linux.
 */

const NODE = process.execPath.replace(/\\/g, "/");

/** Poll until the supervisor has drained records or the deadline passes. */
async function waitForResult(sup, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (sup.peekResults().length > 0) return sup.drainResults();
    await new Promise((r) => setTimeout(r, 25));
  }
  return sup.drainResults();
}

describe("AsyncHookSupervisor real spawn (integration)", () => {
  it("runs an async hook fire-and-forget and collects its stdout as context", async () => {
    const sup = new AsyncHookSupervisor();
    const disp = sup.dispatch(
      [
        {
          command: `"${NODE}" -e "console.log('BGHOOK_OK')"`,
          event: "PostToolUse",
        },
      ],
      { hook_event_name: "PostToolUse" },
    );
    expect(disp[0].dispatched).toBe(true);
    const results = await waitForResult(sup);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].additionalContext).toMatch(/BGHOOK_OK/);
    sup.stopAll();
  });

  it("emits a JSON additionalContext payload back through the real pipe", async () => {
    const sup = new AsyncHookSupervisor();
    // A hook that reads the event JSON off stdin and echoes a decision object.
    const script =
      "let d='';process.stdin.on('data',c=>d+=c);" +
      "process.stdin.on('end',()=>{const p=JSON.parse(d);" +
      "console.log(JSON.stringify({additionalContext:'event='+p.hook_event_name}))})";
    sup.dispatch([{ command: `"${NODE}" -e "${script}"`, event: "Stop" }], {
      hook_event_name: "Stop",
    });
    const [r] = await waitForResult(sup);
    expect(r.ok).toBe(true);
    expect(r.additionalContext).toBe("event=Stop");
    sup.stopAll();
  });

  it("queues a rewake when a real asyncRewake hook exits non-zero", async () => {
    const sup = new AsyncHookSupervisor();
    sup.dispatch(
      [
        {
          command: `"${NODE}" -e "console.error('tests failed');process.exit(1)"`,
          event: "PostToolUse",
          asyncRewake: true,
        },
      ],
      {},
    );
    await waitForResult(sup);
    const rewakes = sup.drainRewakes();
    expect(rewakes).toHaveLength(1);
    expect(rewakes[0].ok).toBe(false);
    expect(rewakes[0].error).toMatch(/tests failed|hook exited 1/);
    sup.stopAll();
  });

  it("kills a real hook that overruns its timeout", async () => {
    const sup = new AsyncHookSupervisor();
    // Sleep ~5s but cap the hook at 0.2s → the supervisor must SIGTERM it.
    sup.dispatch(
      [
        {
          command: `"${NODE}" -e "setTimeout(()=>{},5000)"`,
          event: "Stop",
          timeout: 0.2,
          asyncRewake: true,
        },
      ],
      {},
    );
    const [r] = await waitForResult(sup, 6000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/);
    expect(sup.runningCount()).toBe(0); // reaped
    sup.stopAll();
  });
});

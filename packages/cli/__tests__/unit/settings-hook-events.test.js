/**
 * settings-hook-events — non-tool settings.json hook dispatch.
 *
 * UserPromptSubmit: block (exit 2 / {decision:block}) aborts; non-block stdout
 * (JSON additionalContext or plain text) is aggregated for injection.
 * SessionStart: context-only. Uses real `node -e` hook commands.
 */
import { describe, it, expect } from "vitest";
import ev from "../../src/lib/settings-hook-events.cjs";

const {
  runUserPromptSubmitHooks,
  runSessionStartHooks,
  runObserveHooks,
  aggregateContext,
} = ev;

const ups = (command) => ({
  UserPromptSubmit: [{ matcher: null, hooks: [{ type: "command", command }] }],
});
const ss = (command, matcher = null) => ({
  SessionStart: [{ matcher, hooks: [{ type: "command", command }] }],
});

const CWD = process.cwd();

describe("runUserPromptSubmitHooks", () => {
  it("returns not-blocked with no hooks", () => {
    expect(runUserPromptSubmitHooks(null, { prompt: "hi" })).toEqual({
      blocked: false,
      additionalContext: null,
    });
  });

  it("exit 2 blocks the turn", () => {
    const r = runUserPromptSubmitHooks(ups('node -e "process.exit(2)"'), {
      prompt: "rm secrets",
      cwd: CWD,
    });
    expect(r.blocked).toBe(true);
  });

  it("{decision:block} blocks with reason", () => {
    const cmd =
      "node -e \"console.log(JSON.stringify({decision:'block',reason:'no secrets'}))\"";
    const r = runUserPromptSubmitHooks(ups(cmd), { prompt: "x", cwd: CWD });
    expect(r).toMatchObject({ blocked: true, reason: "no secrets" });
  });

  it("plain stdout becomes additionalContext", () => {
    const cmd = "node -e \"console.log('branch is main, be careful')\"";
    const r = runUserPromptSubmitHooks(ups(cmd), { prompt: "x", cwd: CWD });
    expect(r.blocked).toBe(false);
    expect(r.additionalContext).toBe("branch is main, be careful");
  });

  it("JSON additionalContext is honored", () => {
    const cmd =
      "node -e \"console.log(JSON.stringify({additionalContext:'ctx-here'}))\"";
    const r = runUserPromptSubmitHooks(ups(cmd), { prompt: "x", cwd: CWD });
    expect(r.additionalContext).toBe("ctx-here");
  });

  it("passes the prompt to the hook via stdin payload", () => {
    // hook echoes a marker only when stdin contains the prompt text
    const cmd =
      "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(j.prompt==='hello')console.log('saw:'+j.prompt)})\"";
    const r = runUserPromptSubmitHooks(ups(cmd), { prompt: "hello", cwd: CWD });
    expect(r.additionalContext).toBe("saw:hello");
  });
});

describe("runSessionStartHooks", () => {
  it("injects context; matcher matches the source", () => {
    const cmd = "node -e \"console.log('session ctx')\"";
    const r = runSessionStartHooks(ss(cmd, "startup"), {
      source: "startup",
      cwd: CWD,
    });
    expect(r.additionalContext).toBe("session ctx");
  });

  it("source mismatch → no hooks fire", () => {
    const cmd = "node -e \"console.log('x')\"";
    const r = runSessionStartHooks(ss(cmd, "resume"), {
      source: "startup",
      cwd: CWD,
    });
    expect(r.additionalContext).toBeNull();
  });
});

describe("runObserveHooks (Stop / SessionEnd / PreCompact)", () => {
  const obs = (event, command) => ({
    [event]: [{ matcher: null, hooks: [{ type: "command", command }] }],
  });

  it("runs the event's hooks and returns continue when they exit 0", () => {
    const r = runObserveHooks(
      obs("Stop", 'node -e ""'),
      "Stop",
      {},
      { cwd: CWD },
    );
    expect(r.decision).toBe("continue");
    expect(r.results).toHaveLength(1);
  });

  it("surfaces a block reason (observe — caller decides) ", () => {
    const cmd =
      "node -e \"console.log(JSON.stringify({decision:'block',reason:'stay'}))\"";
    const r = runObserveHooks(obs("Stop", cmd), "Stop", {}, { cwd: CWD });
    expect(r).toMatchObject({ decision: "block", reason: "stay" });
  });

  it("returns continue with no hooks / no settings", () => {
    expect(runObserveHooks(null, "Stop", {}, {}).decision).toBe("continue");
    expect(
      runObserveHooks(obs("PreCompact", 'node -e ""'), "SessionEnd", {}, {})
        .decision,
    ).toBe("continue"); // event mismatch → no hooks
  });
});

describe("aggregateContext", () => {
  it("joins additionalContext + plain stdout, skips JSON-only/empty", () => {
    const out = aggregateContext([
      { additionalContext: "a" },
      { exitCode: 0, stdout: "plain\n" },
      { exitCode: 0, stdout: '{"decision":"continue"}' },
      { exitCode: 0, stdout: "  " },
    ]);
    expect(out).toBe("a\nplain");
  });
});

describe("unified-bus delivery id (P2)", () => {
  // A hook that reads its stdin JSON and reports whether it carried an event_id.
  const echoId =
    "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j={};try{j=JSON.parse(d)}catch(e){};const ok=j.event_id&&j.event_id.indexOf('evt_')===0;process.stdout.write(JSON.stringify({additionalContext:ok?'HAS_ID':'NO_ID'}))})\"";

  it("stamps event_id onto the UserPromptSubmit hook payload", () => {
    const r = runUserPromptSubmitHooks(ups(echoId), {
      prompt: "hi",
      cwd: CWD,
      sessionId: "s1",
    });
    expect(r.additionalContext).toBe("HAS_ID");
  });

  it("stamps event_id onto the SessionStart hook payload", () => {
    const r = runSessionStartHooks(ss(echoId), { source: "startup", cwd: CWD });
    expect(r.additionalContext).toBe("HAS_ID");
  });
});

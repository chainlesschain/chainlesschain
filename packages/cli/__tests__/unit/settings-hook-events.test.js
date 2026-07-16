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
  runCwdChangedHooks,
  runWorktreeCreateHooks,
  runWorktreeRemoveHooks,
  runInstructionsLoadedHooks,
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

describe("runCwdChangedHooks", () => {
  const cc = (command, matcher = null) => ({
    CwdChanged: [{ matcher, hooks: [{ type: "command", command }] }],
  });

  it("returns null context with no settings / no hooks", () => {
    expect(runCwdChangedHooks(null, { newCwd: CWD })).toEqual({
      additionalContext: null,
    });
    expect(
      runCwdChangedHooks(cc('node -e ""', "nomatch"), { newCwd: CWD }),
    ).toEqual({ additionalContext: null }); // matcher mismatch → no fire
  });

  it("fires the hook and injects its emitted context", () => {
    const cmd = "node -e \"console.log('entered new dir')\"";
    const r = runCwdChangedHooks(cc(cmd), { oldCwd: "/a", newCwd: CWD });
    expect(r.additionalContext).toBe("entered new dir");
  });

  it("threads old_cwd + cwd into the hook stdin payload", () => {
    // The hook reads its stdin JSON and echoes the fields back, proving the
    // producer built the CwdChanged payload correctly.
    const cmd =
      "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.old_cwd+'|'+j.cwd+'|'+j.hook_event_name)})\"";
    const r = runCwdChangedHooks(cc(cmd), { oldCwd: "/old", newCwd: "/new" });
    expect(r.additionalContext).toBe("/old|/new|CwdChanged");
  });
});

describe("runWorktreeCreateHooks", () => {
  const wc = (command, matcher = null) => ({
    WorktreeCreate: [{ matcher, hooks: [{ type: "command", command }] }],
  });

  it("returns null context with no settings / no hooks", () => {
    expect(runWorktreeCreateHooks(null, { branch: "cc-agent-x" })).toEqual({
      additionalContext: null,
    });
    // matcher scoped to a different branch → no fire
    expect(
      runWorktreeCreateHooks(wc('node -e ""', "other"), {
        branch: "cc-agent-x",
        cwd: CWD,
      }),
    ).toEqual({ additionalContext: null });
  });

  it("fires and injects context; branch matches the matcher target", () => {
    const cmd = "node -e \"console.log('worktree ready')\"";
    const r = runWorktreeCreateHooks(wc(cmd, "/^cc-agent-/"), {
      worktreePath: CWD,
      branch: "cc-agent-42",
      baseSha: "deadbeef",
      cwd: CWD,
    });
    expect(r.additionalContext).toBe("worktree ready");
  });

  it("threads worktree_path + branch + base_sha into the hook stdin payload", () => {
    const cmd =
      "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.hook_event_name+'|'+j.branch+'|'+j.base_sha+'|'+j.worktree_path)})\"";
    const r = runWorktreeCreateHooks(wc(cmd), {
      worktreePath: "/wt/p",
      branch: "cc-agent-9",
      baseSha: "abc123",
      cwd: CWD,
    });
    expect(r.additionalContext).toBe("WorktreeCreate|cc-agent-9|abc123|/wt/p");
  });
});

describe("runWorktreeRemoveHooks", () => {
  const wr = (command, matcher = null) => ({
    WorktreeRemove: [{ matcher, hooks: [{ type: "command", command }] }],
  });

  it("returns null context with no settings / no hooks", () => {
    expect(runWorktreeRemoveHooks(null, { branch: "cc-agent-x" })).toEqual({
      additionalContext: null,
    });
  });

  it("threads removed + reason + branch into the hook stdin payload", () => {
    const cmd =
      "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.hook_event_name+'|'+j.removed+'|'+j.reason+'|'+j.branch)})\"";
    const r = runWorktreeRemoveHooks(wr(cmd), {
      worktreePath: "/wt/p",
      branch: "cc-agent-9",
      removed: true,
      reason: "no changes",
      cwd: CWD,
    });
    expect(r.additionalContext).toBe(
      "WorktreeRemove|true|no changes|cc-agent-9",
    );
  });

  it("reports removed:false for a kept worktree", () => {
    const cmd =
      "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(String(j.removed))})\"";
    const r = runWorktreeRemoveHooks(wr(cmd), {
      branch: "cc-agent-9",
      removed: false,
      reason: "uncommitted changes",
      cwd: CWD,
    });
    expect(r.additionalContext).toBe("false");
  });
});

describe("runInstructionsLoadedHooks", () => {
  const il = (command, matcher = null) => ({
    InstructionsLoaded: [{ matcher, hooks: [{ type: "command", command }] }],
  });

  it("returns null context with no settings / no hooks", () => {
    expect(runInstructionsLoadedHooks(null, { files: [] })).toEqual({
      additionalContext: null,
    });
  });

  it("fires and injects context", () => {
    const cmd = "node -e \"console.log('instructions audited')\"";
    const r = runInstructionsLoadedHooks(il(cmd), {
      files: [{ path: "/repo/CLAUDE.md", scope: "project" }],
      cwd: CWD,
    });
    expect(r.additionalContext).toBe("instructions audited");
  });

  it("threads the trimmed file set (path/scope/truncated) + count, never content", () => {
    const cmd =
      "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const f=j.files[0];console.log(j.hook_event_name+'|'+j.count+'|'+f.path+'|'+f.scope+'|'+f.truncated+'|'+('content'in f))})\"";
    const r = runInstructionsLoadedHooks(il(cmd), {
      // `content` on the input entry must be DROPPED from the payload.
      files: [
        {
          path: "/repo/CLAUDE.md",
          scope: "project",
          truncated: true,
          content: "secret body",
        },
        { path: "/home/u/.claude/CLAUDE.md", scope: "user" },
      ],
      cwd: CWD,
    });
    expect(r.additionalContext).toBe(
      "InstructionsLoaded|2|/repo/CLAUDE.md|project|true|false",
    );
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

  // Echo back the tracing fields (and whether they exist at all) so both the
  // threaded and the omitted shape are observable end-to-end via stdin.
  const echoTrace =
    "node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j={};try{j=JSON.parse(d)}catch(e){};const has=('trace_id' in j)?'has':'absent';process.stdout.write(JSON.stringify({additionalContext:(j.trace_id||'none')+'|'+(j.parent_id||'none')+'|'+has}))})\"";
  const obs = (command) => ({
    Stop: [{ matcher: null, hooks: [{ type: "command", command }] }],
  });

  it("threads trace_id + parent_id into the delivered payload when provided", () => {
    const outcome = runObserveHooks(
      obs(echoTrace),
      "Stop",
      { session_id: "s1" },
      { cwd: CWD, traceId: "run-123", parentId: "run-parent-9" },
    );
    expect(aggregateContext(outcome.results)).toBe("run-123|run-parent-9|has");
  });

  it("omits trace_id/parent_id entirely when the caller does not thread them", () => {
    const outcome = runObserveHooks(
      obs(echoTrace),
      "Stop",
      { session_id: "s1" },
      { cwd: CWD },
    );
    // Legacy payload shape stays byte-identical: no null placeholders.
    expect(aggregateContext(outcome.results)).toBe("none|none|absent");
  });

  it("withDeliveryId stamps trace/parent onto the payload and keeps event_id", () => {
    const p = ev.withDeliveryId(
      "PreToolUse",
      { hook_event_name: "PreToolUse", session_id: "s1" },
      { sessionId: "s1", traceId: "run-a", parentId: "run-b" },
    );
    expect(p.event_id).toMatch(/^evt_/);
    expect(p.trace_id).toBe("run-a");
    expect(p.parent_id).toBe("run-b");
    const bare = ev.withDeliveryId("PreToolUse", {
      hook_event_name: "PreToolUse",
    });
    expect("trace_id" in bare).toBe(false);
    expect("parent_id" in bare).toBe(false);
  });
});

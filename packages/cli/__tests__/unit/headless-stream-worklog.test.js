import "../helpers/test-model-egress.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runAgentHeadlessStream,
  parseInputEvent,
} from "../../src/runtime/headless-stream.js";
import { readTaskWorklog } from "../../src/lib/context-memory-kernel/task-worklog-port.js";
import { createTaskWorklogHarness } from "../helpers/task-worklog-harness.js";

let cwd;
let harness;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-stream-worklog-"));
  harness = createTaskWorklogHarness();
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));
async function run(input, agentLoop) {
  const lines = [];
  const outcome = await runAgentHeadlessStream(
    {
      cwd,
      taskWorklog: true,
      expandFileRefs: false,
      interactiveApprovals: true,
    },
    {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      createTaskWorklog: harness.create,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      agentLoop,
      input: (async function* () {
        for (const event of input) yield JSON.stringify(event) + "\n";
      })(),
    },
  );
  return { outcome, events: lines.join("").trim().split("\n").map(JSON.parse) };
}

describe("IDE task worklog stream integration", () => {
  it("retains an explicit history reference on an image-only user turn", () => {
    expect(
      parseInputEvent(
        JSON.stringify({
          type: "user",
          images: ["example.png"],
          worklog_session_id: "source",
        }),
      ),
    ).toMatchObject({ worklogSessionId: "source", images: ["example.png"] });
  });

  it("saves tools before compaction and acknowledges the durable worklog without a model call", async () => {
    let calls = 0;
    const { events } = await run(
      [
        { type: "user", text: "Fix the parser" },
        { type: "worklog", request_id: "handoff" },
      ],
      async function* (_messages, opts) {
        calls++;
        yield {
          type: "tool-executing",
          tool: "read_file",
          args: { path: "parser.js" },
          tool_use_id: "r1",
        };
        yield {
          type: "tool-result",
          tool: "read_file",
          tool_use_id: "r1",
          result: { content: "parse fails on null" },
        };
        opts.onBeforeCompaction();
        expect(opts.getTaskWorklogContext()).toContain("parse fails on null");
        yield { type: "compaction", stats: { saved: 100 } };
        yield {
          type: "response-complete",
          content: "Next: reproduce null input",
        };
        yield { type: "run-ended", reason: "complete" };
      },
    );
    expect(calls).toBe(1);
    const ack = events.find((e) => e.type === "worklog_saved");
    expect(ack).toMatchObject({ ok: true, request_id: "handoff" });
    const saved = readTaskWorklog(cwd, ack.session_id);
    expect(saved.markdown).toContain("before-compaction");
    expect(saved.markdown).toContain("reproduce null input");
    expect(saved.state.files[0].result).toContain("parse fails on null");
  }, 15000);

  it("loads Markdown in a fresh user context, retaining current instructions and a new session id", async () => {
    const source = harness.create({ cwd, sessionId: "source" });
    source.user("Fix issue 42");
    source.record({ type: "result", result: "The failing case is null input" });
    let seen;
    const { events } = await run(
      [
        {
          type: "user",
          text: "Only diagnose; do not edit",
          worklog_session_id: "source",
        },
      ],
      async function* (messages) {
        seen = messages;
        yield { type: "response-complete", content: "Diagnosis" };
        yield { type: "run-ended", reason: "complete" };
      },
    );
    expect(seen.find((m) => m.role === "user").content).toContain("null input");
    expect(seen.find((m) => m.role === "user").content).toContain(
      "Only diagnose; do not edit",
    );
    expect(seen.find((m) => m.role === "system").content).not.toContain(
      "The failing case is null input",
    );
    const loaded = events.find((e) => e.type === "worklog_loaded");
    expect(loaded.source_session_id).toBe("source");
    expect(loaded.session_id).not.toBe("source");
  });

  it("refuses missing handoff data before calling the model", async () => {
    let calls = 0;
    const { events } = await run(
      [{ type: "user", text: "Continue", worklog_session_id: "missing" }],
      async function* () {
        calls++;
        yield { type: "run-ended", reason: "unexpected-model-call" };
      },
    );
    expect(calls).toBe(0);
    expect(events.some((e) => e.subtype === "error_worklog")).toBe(true);
    expect(parseInputEvent('{"type":"worklog","request_id":"a"}')).toEqual({
      worklog: true,
      requestId: "a",
    });
  });
});

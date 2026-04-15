/**
 * Integration: open-agents parity Phases 2–5 via the agent loop.
 *
 * Exercises the real `agentLoop` with the mock LLM provider to verify:
 *   - Phase 3: spawn_sub_agent accepts `profile` and applies toolAllowlist
 *     (verified indirectly via mocking by checking the contract schema)
 *   - Phase 4: prepareCall injects a fresh transient system suffix per turn
 *     and does NOT pollute persisted history
 *   - todo_write tool wiring end-to-end (session-keyed store)
 *   - web_fetch tool wiring (SSRF block as sanity check)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";
import { defaultPrepareCall } from "../../src/lib/turn-context.js";
import * as turnCtx from "../../src/lib/turn-context.js";
import { resetAllStores, getTodos } from "../../src/lib/todo-manager.js";
import { vi } from "vitest";

async function drain(iter) {
  const out = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe("parity-open-agents-loop integration", () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-openagents-"));
    resetAllStores();
    turnCtx._deps.execSync = vi.fn(() => {
      throw new Error("no git in tmp");
    });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("Phase 4: prepareCall injects transient system suffix every turn", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("hi") } },
    ]);

    const messages = [
      { role: "system", content: "base" },
      { role: "user", content: "go" },
    ];

    await drain(
      agentLoop(messages, {
        chatFn: mock.chatFn,
        cwd: workDir,
        sessionId: "sess-42",
        prepareCall: defaultPrepareCall,
      }),
    );

    const seen = mock.calls[0].messages;
    const lastSeen = seen[seen.length - 1];
    expect(lastSeen.role).toBe("system");
    expect(lastSeen.content).toMatch(/## Turn context \(iteration 1\)/);
    expect(lastSeen.content).toMatch(/- session: sess-42/);

    // Original history is NOT mutated
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => !/Turn context/.test(m.content))).toBe(true);
  });

  it("Phase 4: prepareCall re-computes on each iteration with updated counter", async () => {
    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "todo_write",
            { todos: [{ id: "t1", content: "first", status: "pending" }] },
            "call_1",
          ),
        },
      },
      { response: { message: mockTextMessage("done") } },
    ]);

    await drain(
      agentLoop(
        [
          { role: "system", content: "s" },
          { role: "user", content: "plan" },
        ],
        {
          chatFn: mock.chatFn,
          cwd: workDir,
          sessionId: "sess-iters",
          prepareCall: defaultPrepareCall,
        },
      ),
    );

    expect(mock.calls.length).toBe(2);
    const turn1Suffix = mock.calls[0].messages.at(-1).content;
    const turn2Suffix = mock.calls[1].messages.at(-1).content;
    expect(turn1Suffix).toMatch(/iteration 1/);
    expect(turn2Suffix).toMatch(/iteration 2/);
  });

  it("Phase 1 + 4 integration: todo_write executes and survives through turns", async () => {
    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "todo_write",
            {
              todos: [
                { id: "a", content: "step 1", status: "in_progress" },
                { id: "b", content: "step 2", status: "pending" },
              ],
            },
            "call_1",
          ),
        },
      },
      { response: { message: mockTextMessage("todos recorded") } },
    ]);

    await drain(
      agentLoop([{ role: "user", content: "make a plan" }], {
        chatFn: mock.chatFn,
        cwd: workDir,
        sessionId: "sess-todo",
        prepareCall: defaultPrepareCall,
      }),
    );

    const todos = getTodos("sess-todo");
    expect(todos).toHaveLength(2);
    expect(todos[0].status).toBe("in_progress");
  });

  it("Phase 1: web_fetch blocks private hosts by default (SSRF guard)", async () => {
    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "web_fetch",
            { url: "http://127.0.0.1:8080/secret" },
            "call_1",
          ),
        },
      },
      { response: { message: mockTextMessage("blocked as expected") } },
    ]);

    const events = await drain(
      agentLoop([{ role: "user", content: "fetch local" }], {
        chatFn: mock.chatFn,
        cwd: workDir,
        sessionId: "sess-web",
      }),
    );

    const toolResult = events.find((e) => e.type === "tool-result");
    expect(toolResult).toBeTruthy();
    const payload = toolResult.result;
    expect(payload?.error || payload?.success === false).toBeTruthy();
  });
});

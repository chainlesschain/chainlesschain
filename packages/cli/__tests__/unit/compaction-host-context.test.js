import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../helpers/test-model-egress.js";
import {
  createCompactionHostContextRefresher,
  refreshCompactionHostContext,
} from "../../src/runtime/compaction-host-context.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  markDurableSystemMessage,
  markRuntimeOnlySessionMessage,
  isRuntimeOnlySessionMessage,
} from "../../src/lib/session-message-provenance.js";

const history = () => [
  { role: "system", content: "old rules" },
  { role: "user", content: "first task" },
  { role: "assistant", content: "first result" },
  { role: "user", content: "second task" },
  { role: "assistant", content: "second result" },
  { role: "user", content: "continue" },
];
const drain = async (events) => {
  const result = [];
  for await (const event of events) result.push(event);
  return result;
};

describe("live compaction host context refresh", () => {
  it("replaces only the host base in live and trimmed candidates, preserving old snapshots and durable summaries", () => {
    const messages = history();
    const oldBase = messages[0];
    const summary = { role: "system", content: "historical summary" };
    markDurableSystemMessage(
      summary,
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );
    messages.splice(1, 0, summary);
    const snapshot = [...messages];
    const candidate = [oldBase, summary, messages.at(-1)];
    const refresh = createCompactionHostContextRefresher({
      messages,
      render: () => "new rules\ncustom style",
    });
    const result = refreshCompactionHostContext(refresh, candidate);
    expect(result[0]).toBe(messages[0]);
    expect(result[0].content).toBe("new rules\ncustom style");
    expect(result[1]).toBe(summary);
    expect(snapshot[0]).toBe(oldBase);
    expect(oldBase.content).toBe("old rules");
    expect(result.at(-1)).toBe(messages.at(-1));
  });

  it("does not publish a new base when the rendered content is unchanged", () => {
    const messages = history();
    const original = messages[0];
    const onUpdated = vi.fn();
    const refresh = createCompactionHostContextRefresher({
      messages,
      render: () => original.content,
      onUpdated,
    });
    expect(refreshCompactionHostContext(refresh, messages)).toBe(messages);
    expect(messages[0]).toBe(original);
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("preserves runtime-only user nudges while replacing the host base", () => {
    const messages = history();
    const nudge = messages[1];
    markRuntimeOnlySessionMessage(nudge);
    const refresh = createCompactionHostContextRefresher({
      messages,
      render: () => "fresh",
    });
    refreshCompactionHostContext(refresh, messages);
    expect(messages[1]).toBe(nudge);
    expect(isRuntimeOnlySessionMessage(messages[1])).toBe(true);
  });

  it.each(["missing", "durable"])(
    "refuses a %s host base without rewriting history",
    (kind) => {
      const messages = history();
      if (kind === "missing") messages.shift();
      else
        markDurableSystemMessage(
          messages[0],
          DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
        );
      const original = [...messages];
      const render = vi.fn(() => "fresh");
      const refresh = createCompactionHostContextRefresher({
        messages,
        render,
      });
      expect(() => refreshCompactionHostContext(refresh, messages)).toThrow(
        expect.objectContaining({
          code: "CC_COMPACTION_CONTEXT_REFRESH_FAILED",
        }),
      );
      expect(messages).toEqual(original);
      expect(render).not.toHaveBeenCalled();
    },
  );

  it.each(["empty", "async", "throw"])(
    "stops before a provider request when the renderer is %s",
    async (kind) => {
      const messages = history();
      const original = structuredClone(messages);
      const chatFn = vi.fn();
      const compress = vi.fn();
      const refresh = createCompactionHostContextRefresher({
        messages,
        render: () => {
          if (kind === "async") return Promise.resolve("late context");
          if (kind === "throw") throw new Error("context read unavailable");
          return "";
        },
      });
      await expect(
        drain(
          agentLoop(messages, {
            chatFn,
            autoMicroCompact: false,
            _autoCompactor: { shouldAutoCompact: () => true, compress },
            refreshCompactionContext: refresh,
          }),
        ),
      ).rejects.toMatchObject({ code: "CC_COMPACTION_CONTEXT_REFRESH_FAILED" });
      expect(chatFn).not.toHaveBeenCalled();
      expect(compress).not.toHaveBeenCalled();
      expect(messages).toEqual(original);
    },
  );

  it("does not absorb concurrent transcript changes into a refreshed authority snapshot", async () => {
    const messages = history();
    const chatFn = vi.fn();
    const compress = vi.fn();
    const render = vi.fn(() => "fresh");
    const refresh = createCompactionHostContextRefresher({ messages, render });
    let checks = 0;
    await expect(
      drain(
        agentLoop(messages, {
          chatFn,
          autoMicroCompact: false,
          _autoCompactor: {
            shouldAutoCompact: () => {
              if (++checks === 2)
                messages.push({ role: "user", content: "concurrent steering" });
              return true;
            },
            compress,
          },
          refreshCompactionContext: refresh,
        }),
      ),
    ).rejects.toMatchObject({ code: "CC_COMPACTION_CONTEXT_REFRESH_FAILED" });
    expect(render).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
    expect(chatFn).not.toHaveBeenCalled();
    expect(messages.at(-1).content).toBe("concurrent steering");
  });

  it("refreshes the registered REPL base without promoting historical summaries into the host prefix", async () => {
    const { createReplResumeStateController } = await import(
      "../../src/repl/agent-repl.js"
    );
    const hook = { role: "system", content: "startup hook context" };
    const messages = [{ role: "system", content: "old project" }, hook];
    const controller = createReplResumeStateController({ messages });
    controller.registerHostSystemMessages();
    const summary = { role: "system", content: "historical project summary" };
    markDurableSystemMessage(
      summary,
      DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
    );
    messages.push(summary, { role: "user", content: "continue" });
    let registered;
    const refresh = createCompactionHostContextRefresher({
      messages,
      render: () => "current project\nactive output style",
      onUpdated: () => {
        registered = controller.refreshHostSystemMessages();
      },
    });
    refreshCompactionHostContext(refresh, messages);
    expect(registered).toHaveLength(2);
    expect(registered[0].content).toBe("current project\nactive output style");
    expect(registered[1].content).toBe(hook.content);
    expect(messages[2]).toBe(summary);
  });
});

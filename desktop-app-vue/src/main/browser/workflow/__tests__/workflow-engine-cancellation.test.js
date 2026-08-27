import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { WorkflowEngine, ExecutionStatus } = require("../workflow-engine.js");
const originalBrowserWorkflowExperimental =
  process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL;

beforeAll(() => {
  process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL = "1";
});

afterAll(() => {
  if (originalBrowserWorkflowExperimental === undefined) {
    delete process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL;
  } else {
    process.env.CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL =
      originalBrowserWorkflowExperimental;
  }
});

function browserWith(overrides = {}) {
  return {
    getPage: () => ({
      url: () => "https://example.test",
      title: async () => "Example",
    }),
    navigate: vi.fn(async () => ({ ok: true })),
    act: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function action(url = "https://example.test") {
  return { id: url, type: "action", action: "navigate", url };
}

describe("browser WorkflowEngine cancellation", () => {
  it("lets cancellation win after the last physical action settles", async () => {
    let release;
    const physicalAction = new Promise((resolve) => {
      release = resolve;
    });
    const browser = browserWith({ navigate: vi.fn(() => physicalAction) });
    const engine = new WorkflowEngine(browser, { maxRetries: 0 });
    const completed = vi.fn();
    const failed = vi.fn();
    const cancelled = vi.fn();
    engine.on("workflow:completed", completed);
    engine.on("workflow:failed", failed);
    engine.on("workflow:cancelled", cancelled);

    let settled = false;
    const run = engine
      .executeWorkflow(
        { id: "wf-last", name: "last", steps: [action()] },
        { executionId: "exec-last", targetId: "tab-1" },
      )
      .finally(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(browser.navigate).toHaveBeenCalledTimes(1));

    expect(engine.cancel("exec-last")).toBe(true);
    expect(engine.getStatus("exec-last").status).toBe(
      ExecutionStatus.CANCELLED,
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    release({ ok: true });
    const result = await run;
    expect(result.status).toBe(ExecutionStatus.CANCELLED);
    expect(result.results).toEqual([]);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("does not dispatch the next step after cancellation", async () => {
    const browser = browserWith();
    const engine = new WorkflowEngine(browser, { maxRetries: 0 });
    browser.navigate.mockImplementationOnce(async () => {
      engine.cancel("exec-between");
      return { ok: true };
    });

    const result = await engine.executeWorkflow(
      {
        id: "wf-between",
        name: "between",
        steps: [action("first"), action("second")],
      },
      { executionId: "exec-between", targetId: "tab-1" },
    );

    expect(result.status).toBe(ExecutionStatus.CANCELLED);
    expect(browser.navigate).toHaveBeenCalledTimes(1);
  });

  it("uses a per-step retry budget", async () => {
    const attempts = new Map();
    const browser = browserWith({
      navigate: vi.fn(async (_targetId, url) => {
        const count = (attempts.get(url) || 0) + 1;
        attempts.set(url, count);
        if (count === 1) throw new Error(`transient ${url}`);
        return { url };
      }),
    });
    const engine = new WorkflowEngine(browser, {
      maxRetries: 1,
      retryDelay: 1,
    });

    const result = await engine.executeWorkflow(
      { id: "wf-retry", name: "retry", steps: [action("a"), action("b")] },
      { executionId: "exec-retry", targetId: "tab-1" },
    );

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(attempts).toEqual(
      new Map([
        ["a", 2],
        ["b", 2],
      ]),
    );
  });
});

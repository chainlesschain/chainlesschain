import { afterEach, describe, expect, it } from "vitest";

const {
  AgentPool,
} = require("../../../../src/main/ai-engine/cowork/agent-pool.js");

describe("AgentPool flow control", () => {
  let pool;

  afterEach(async () => {
    await pool?.clear();
  });

  it("rejects admissions after the bounded wait queue fills", async () => {
    pool = new AgentPool({
      minSize: 1,
      maxSize: 1,
      maxWaitQueue: 1,
      warmupOnInit: true,
    });
    await pool.initialize();
    const activeAgent = await pool.acquireAgent();
    const firstWaiter = pool.acquireAgent({}, 5000);

    await expect(pool.acquireAgent({}, 5000)).rejects.toMatchObject({
      code: "OVERLOADED",
      retryAfterMs: 100,
    });
    expect(pool.getStatus()).toMatchObject({ waiting: 1, maxWaiting: 1 });
    expect(pool.getStats().waitOverloads).toBe(1);

    pool.releaseAgent(activeAgent.id);
    await expect(firstWaiter).resolves.toMatchObject({ id: activeAgent.id });
  });

  it("cancels a wait timeout after assigning the released agent", async () => {
    pool = new AgentPool({
      minSize: 1,
      maxSize: 1,
      warmupOnInit: true,
    });
    await pool.initialize();
    const activeAgent = await pool.acquireAgent();
    const waiter = pool.acquireAgent({}, 20);

    pool.releaseAgent(activeAgent.id);
    await expect(waiter).resolves.toMatchObject({ id: activeAgent.id });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(pool.getStats().waitTimeouts).toBe(0);
    expect(pool.getStatus().waiting).toBe(0);
  });
});

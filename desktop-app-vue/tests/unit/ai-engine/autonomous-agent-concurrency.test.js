/**
 * Regression tests for AutonomousAgentRunner maxConcurrentGoals enforcement.
 *
 * Bug: submitGoal logged "queuing goal" when at the concurrency limit but then
 * unconditionally set status=RUNNING and called _executeGoal — so the limit was
 * never enforced (10 goals with limit 3 all ran). Fixed by creating over-limit
 * goals QUEUED and draining them (_drainQueue) as running goals finish.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  AutonomousAgentRunner,
  GOAL_STATUS,
} from "../../../src/main/ai-engine/autonomous/autonomous-agent-runner.js";

function makeRunner({ maxConcurrentGoals = 3 } = {}) {
  const runner = new AutonomousAgentRunner();
  runner.initialized = true;
  runner.config.maxConcurrentGoals = maxConcurrentGoals;

  // Stub IO/LLM so submitGoal / _drainQueue touch neither DB nor the ReAct loop.
  runner._decomposeGoal = async () => ({ steps: [], strategy: "direct" });
  runner._saveGoalToDB = () => {};
  runner._updateGoalInDB = () => {};
  runner._logStep = async () => {};

  // Controllable _executeGoal: returns a promise resolved manually per goal.
  // Calling the resolver marks the goal COMPLETED first (mirroring the real
  // loop), so the freed slot is visible to _drainQueue.
  const resolvers = new Map();
  runner._executeGoal = (goalId) =>
    new Promise((resolve) => {
      resolvers.set(goalId, () => {
        const g = runner.activeGoals.get(goalId);
        if (g) {
          g.status = GOAL_STATUS.COMPLETED;
        }
        resolve();
      });
    });

  return { runner, resolvers };
}

function countByStatus(runner, status) {
  return Array.from(runner.activeGoals.values()).filter(
    (g) => g.status === status,
  ).length;
}

function findByStatus(runner, status) {
  return Array.from(runner.activeGoals.values()).find(
    (g) => g.status === status,
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AutonomousAgentRunner concurrency enforcement", () => {
  it("queues goals beyond maxConcurrentGoals instead of running them all", async () => {
    const { runner } = makeRunner({ maxConcurrentGoals: 3 });

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await runner.submitGoal({ description: `goal ${i}` }));
    }

    expect(countByStatus(runner, GOAL_STATUS.RUNNING)).toBe(3);
    expect(countByStatus(runner, GOAL_STATUS.QUEUED)).toBe(2);
    // The over-limit submits report QUEUED (not a misleading RUNNING).
    expect(results[3].data.status).toBe(GOAL_STATUS.QUEUED);
    expect(results[4].data.status).toBe(GOAL_STATUS.QUEUED);
    // Under-limit submits report RUNNING.
    expect(results[0].data.status).toBe(GOAL_STATUS.RUNNING);
  });

  it("_drainQueue starts the next queued goal when a running one finishes", async () => {
    const { runner, resolvers } = makeRunner({ maxConcurrentGoals: 2 });

    for (let i = 0; i < 4; i++) {
      await runner.submitGoal({ description: `goal ${i}` });
    }
    expect(countByStatus(runner, GOAL_STATUS.RUNNING)).toBe(2);
    expect(countByStatus(runner, GOAL_STATUS.QUEUED)).toBe(2);

    // Finish one running goal → its .finally(_drainQueue) starts a queued one.
    const running = findByStatus(runner, GOAL_STATUS.RUNNING);
    resolvers.get(running.id)();
    await tick();

    expect(countByStatus(runner, GOAL_STATUS.RUNNING)).toBe(2); // refilled
    expect(countByStatus(runner, GOAL_STATUS.QUEUED)).toBe(1); // one drained
    expect(countByStatus(runner, GOAL_STATUS.COMPLETED)).toBe(1);
  });

  it("drains higher-priority queued goals first", async () => {
    const { runner, resolvers } = makeRunner({ maxConcurrentGoals: 1 });

    await runner.submitGoal({ description: "running", priority: 5 });
    await runner.submitGoal({ description: "low", priority: 1 });
    await runner.submitGoal({ description: "high", priority: 9 });

    expect(countByStatus(runner, GOAL_STATUS.RUNNING)).toBe(1);
    expect(countByStatus(runner, GOAL_STATUS.QUEUED)).toBe(2);

    const running = findByStatus(runner, GOAL_STATUS.RUNNING);
    resolvers.get(running.id)();
    await tick();

    const nowRunning = findByStatus(runner, GOAL_STATUS.RUNNING);
    expect(nowRunning.description).toBe("high");
    // The low-priority one is still queued.
    expect(findByStatus(runner, GOAL_STATUS.QUEUED).description).toBe("low");
  });
});

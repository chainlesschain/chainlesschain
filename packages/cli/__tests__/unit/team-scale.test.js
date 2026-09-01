import { describe, expect, it } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";

function makeRegistry(definitions) {
  const registry = new TaskLeaseRegistry({ defaultTtlMs: 60_000 });
  const added = registry.addTasks(definitions);
  expect(added.ok).toBe(true);
  return registry;
}

describe("TeamRunner large-team scale", () => {
  it(
    "executes a 10,000-task DAG exactly once with 64 workers",
    { timeout: 180_000 },
    async () => {
      const taskCount = 10_000;
      const workerCount = 64;
      // A 64-wide, ~157-level DAG keeps a broad frontier while still exercising
      // dependency release rather than merely running 10,000 independent tasks.
      const definitions = Array.from({ length: taskCount }, (_, index) => ({
        key: `task-${index}`,
        title: `Task ${index}`,
        dependsOn: index < workerCount ? [] : [`task-${index - workerCount}`],
      }));
      const registry = makeRegistry(definitions);
      let inheritanceBuilds = 0;
      const priorityInheritanceFor =
        registry._priorityInheritanceFor.bind(registry);
      registry._priorityInheritanceFor = (key) => {
        if (!registry._priorityInheritanceCache) inheritanceBuilds += 1;
        return priorityInheritanceFor(key);
      };
      const executions = new Uint8Array(taskCount);
      let active = 0;
      let observedPeak = 0;
      let dependencyViolation = false;

      const runner = new TeamRunner(registry, {
        teammates: workerCount,
        maxTasks: taskCount,
        emitHook: () => {},
        runTask: async ({ key }) => {
          const index = Number(key.slice("task-".length));
          if (index >= workerCount && executions[index - workerCount] !== 1) {
            dependencyViolation = true;
          }
          executions[index] += 1;
          active += 1;
          observedPeak = Math.max(observedPeak, active);
          // Yield once so all workers on the current frontier overlap
          // deterministically; no wall-clock performance assertion is involved.
          await new Promise((resolve) => setImmediate(resolve));
          active -= 1;
          return { index };
        },
      });

      const summary = await runner.run();

      expect(dependencyViolation).toBe(false);
      expect(summary).toMatchObject({
        done: true,
        executions: taskCount,
        maxConcurrent: workerCount,
        activeTeammates: workerCount,
        stats: {
          total: taskCount,
          completed: taskCount,
        },
      });
      expect(observedPeak).toBe(workerCount);
      expect(inheritanceBuilds).toBe(1);
      expect(Array.from(executions).every((count) => count === 1)).toBe(true);
      expect(registry.list().every((task) => task.status === "completed")).toBe(
        true,
      );
    },
  );

  it(
    "honors an explicit maxTasks above the legacy 1,000-task default",
    { timeout: 60_000 },
    async () => {
      const taskCount = 1_205;
      const registry = makeRegistry(
        Array.from({ length: taskCount }, (_, index) => ({
          key: `wide-${index}`,
          title: `Wide task ${index}`,
        })),
      );
      const executions = new Uint8Array(taskCount);
      const runner = new TeamRunner(registry, {
        teammates: 32,
        maxTasks: taskCount,
        emitHook: () => {},
        runTask: async ({ key }) => {
          executions[Number(key.slice("wide-".length))] += 1;
        },
      });

      const summary = await runner.run();

      expect(summary.done).toBe(true);
      expect(summary.executions).toBe(taskCount);
      expect(summary.stats.completed).toBe(taskCount);
      expect(Array.from(executions).every((count) => count === 1)).toBe(true);
    },
  );
});

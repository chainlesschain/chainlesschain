import { describe, it, expect, vi } from "vitest";
import { PluginMonitorSupervisor } from "../../src/lib/plugin-monitor-supervisor.js";

function child() {
  return {
    pid: 7,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
}

describe("plugin process boundary", () => {
  it("routes plugin monitors through the broker with provenance", () => {
    const spawned = child();
    const brokerSpawn = vi.fn(() => spawned);
    const supervisor = new PluginMonitorSupervisor({ brokerSpawn });
    supervisor.start([
      {
        id: "p:monitor",
        plugin: "p",
        name: "watch",
        command: "plugin-watch",
        args: ["--once"],
        mode: "longRunning",
        origin: "plugin:monitor",
        pluginId: "p",
        pluginVersion: "1.0.0",
        pluginSource: "/plugin/monitors.json",
      },
    ]);
    expect(brokerSpawn).toHaveBeenCalledWith(
      "plugin-watch",
      ["--once"],
      expect.objectContaining({
        origin: "plugin:monitor",
        policy: "allow",
        pluginId: "p",
        pluginVersion: "1.0.0",
        pluginSource: "/plugin/monitors.json",
      }),
    );
    supervisor.stopAll();
  });

  it("publishes monitor output through the durable producer when configured", () => {
    const records = [];
    const supervisor = new PluginMonitorSupervisor({
      eventRuntimeStore: {
        enqueue: (queue, event, options) => {
          const row = { queue, event, id: options.id };
          records.push(row);
          return row;
        },
      },
    });
    supervisor._record({ id: "p:watch", plugin: "p", name: "watch" }, "stdout", "ready\n");
    expect(records[0]).toMatchObject({ queue: "inbox", event: { origin: "monitor", type: "monitor_output" } });
  });
});

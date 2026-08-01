import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { collectQuickStatusReport } from "../../src/runtime/status-diagnostics-lite.js";

function closedSocket() {
  const socket = new EventEmitter();
  socket.destroy = vi.fn();
  queueMicrotask(() => socket.emit("error", new Error("closed")));
  return socket;
}

describe("quick status collector", () => {
  it("collects a read-only report without executing external probes", async () => {
    const report = await collectQuickStatusReport({
      env: { CHAINLESSCHAIN_HOME: "C:\\cc-home", PATH: "" },
      cwd: "C:\\project",
      exists: (path) =>
        path.endsWith("config.json") || path.endsWith("app.pid"),
      readFile: (path) =>
        path.endsWith("config.json")
          ? JSON.stringify({
              setupCompleted: true,
              edition: "personal",
              llm: { provider: "ollama", model: "qwen" },
            })
          : "4321",
      processKill: vi.fn(),
      executableCheck: vi.fn(() => false),
      connect: closedSocket,
      probeTimeoutMs: 10,
    });

    expect(report).toMatchObject({
      schema: "chainlesschain.status.v1",
      probeMode: "quick",
      app: { running: true, pid: 4321 },
      setup: {
        completed: true,
        edition: "personal",
        llm: { provider: "ollama", model: "qwen" },
      },
      docker: {
        available: false,
        services: null,
        note: "Docker not available",
      },
      eventRuntime: { enabled: false, health: null, error: null },
    });
    expect(report.ports).toHaveLength(9);
    expect(report.ports.every((port) => port.open === false)).toBe(true);
  });
});

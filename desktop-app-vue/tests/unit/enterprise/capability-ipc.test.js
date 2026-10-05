import { describe, it, expect, vi } from "vitest";

const {
  AutomationEngine,
} = require("../../../src/main/enterprise/automation/automation-engine.js");
const {
  registerAutomationIPC,
} = require("../../../src/main/enterprise/automation/automation-ipc.js");
const {
  AppBuilder,
} = require("../../../src/main/enterprise/low-code/app-builder.js");
const {
  registerLowCodeIPC,
} = require("../../../src/main/enterprise/low-code/low-code-ipc.js");

function harness() {
  const handlers = {};
  return {
    handlers,
    ipcMain: {
      removeHandler: vi.fn(),
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    },
    db: { exec: vi.fn(), prepare: () => ({ all: () => [], run: vi.fn() }) },
  };
}

describe("enterprise capability IPC results", () => {
  it("does not wrap unsupported execution or simulation in a live success envelope", async () => {
    const { handlers, ipcMain, db } = harness();
    const engine = new AutomationEngine();
    await engine.initialize(db);
    const flow = engine.createFlow({
      steps: [{ connector: "slack", action: "send-message" }],
    });
    registerAutomationIPC({ automationEngine: engine, ipcMain });
    const live = await handlers["automation:execute"]({}, { flowId: flow.id });
    expect(live).toMatchObject({
      success: false,
      status: "unsupported",
      data: { mode: "live", executed: false },
    });
    const simulation = await handlers["automation:execute"](
      {},
      { flowId: flow.id, mode: "simulation" },
    );
    expect(simulation).toMatchObject({
      success: false,
      status: "simulated",
      data: { mode: "simulation", simulated: true, executed: false },
    });
  });

  it("keeps configured sources distinct from a successful connection and design publication distinct from deployment", async () => {
    const { handlers, ipcMain, db } = harness();
    const builder = new AppBuilder();
    await builder.initialize(db);
    const app = builder.createApp({ name: "Capability check" });
    const ds = builder.addDataSource(app.id, "REST", "rest", {
      url: "https://invalid.example.invalid",
    });
    registerLowCodeIPC({ appBuilder: builder, ipcMain });
    expect(await handlers["lowcode:test-connection"]({}, ds.id)).toMatchObject({
      success: false,
      data: { probed: false, status: "unsupported" },
    });
    expect(
      await handlers["lowcode:test-connection"]({}, "missing"),
    ).toMatchObject({ success: false, data: { status: "not-found" } });
    expect(await handlers["lowcode:publish"]({}, app.id)).toMatchObject({
      success: true,
      data: { status: "design-published", deployed: false },
    });
  });
});

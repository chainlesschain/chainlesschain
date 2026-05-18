/**
 * Phase 1.6 — verifies the shell.switch handler persists the right
 * config flag for each target and schedules the relaunch without
 * killing the test process. Mocks the AppConfigManager + electron.app
 * via constructor injection (no electron / no real fs needed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createShellSwitchHandler,
  VALID_TARGETS,
} = require("../handlers/shell-switch-handler.js");

describe("createShellSwitchHandler", () => {
  let setSpy;
  let getAppConfig;
  let app;
  let scheduleRestart;
  let handler;

  beforeEach(() => {
    setSpy = vi.fn();
    getAppConfig = vi.fn(() => ({ set: setSpy }));
    app = { relaunch: vi.fn(), exit: vi.fn() };
    // Tests run scheduleRestart synchronously so we can assert the
    // app.relaunch+exit calls without dealing with timers.
    scheduleRestart = vi.fn((fn) => fn());
    handler = createShellSwitchHandler({ getAppConfig, app, scheduleRestart });
  });

  it("VALID_TARGETS exposes the public enum", () => {
    expect([...VALID_TARGETS].sort()).toEqual(["desktop", "web-shell"]);
  });

  it("rejects construction without getAppConfig", () => {
    expect(() => createShellSwitchHandler({})).toThrow(/getAppConfig/);
    expect(() =>
      createShellSwitchHandler({ getAppConfig: "not a fn" }),
    ).toThrow(/getAppConfig/);
  });

  it("target=desktop persists useWebShellExperimental=false then relaunches", async () => {
    const res = await handler({ target: "desktop" });
    expect(res).toEqual({ switching: true, target: "desktop" });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("ui.useWebShellExperimental", false);
    expect(scheduleRestart).toHaveBeenCalledTimes(1);
    expect(scheduleRestart.mock.calls[0][1]).toBe(100);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("target=web-shell persists useWebShellExperimental=true then relaunches", async () => {
    const res = await handler({ target: "web-shell" });
    expect(res).toEqual({ switching: true, target: "web-shell" });
    expect(setSpy).toHaveBeenCalledWith("ui.useWebShellExperimental", true);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("rejects unknown / missing target without persisting or relaunching", async () => {
    await expect(handler({ target: "v6" })).rejects.toThrow(/target must be/);
    await expect(handler({})).rejects.toThrow(/target must be/);
    await expect(handler(null)).rejects.toThrow(/target must be/);
    expect(setSpy).not.toHaveBeenCalled();
    expect(scheduleRestart).not.toHaveBeenCalled();
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("rejects when getAppConfig returns null (singleton not yet init'd)", async () => {
    getAppConfig.mockReturnValue(null);
    await expect(handler({ target: "desktop" })).rejects.toThrow(
      /appConfig unavailable/,
    );
    expect(scheduleRestart).not.toHaveBeenCalled();
  });

  it("swallows errors from app.relaunch/exit (process is exiting anyway)", async () => {
    app.relaunch.mockImplementation(() => {
      throw new Error("relaunch barfed");
    });
    // Should not throw — handler already returned before scheduleRestart.
    await expect(handler({ target: "desktop" })).resolves.toEqual({
      switching: true,
      target: "desktop",
    });
  });

  it("re-reads getAppConfig on every call (config singleton may swap in tests)", async () => {
    await handler({ target: "desktop" });
    await handler({ target: "web-shell" });
    expect(getAppConfig).toHaveBeenCalledTimes(2);
  });
});

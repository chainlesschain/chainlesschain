import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_COMMAND_TELEMETRY_EVENT,
  DesktopCommandRegistry,
  type DesktopCommandDefinition,
} from "@/commands/desktop-command-registry";

function command(
  overrides: Partial<DesktopCommandDefinition> = {},
): DesktopCommandDefinition {
  return {
    id: "desktop.test",
    title: "测试命令",
    category: "测试",
    surfaces: ["v2"],
    telemetryEvent: "desktop.command.test",
    handler: vi.fn(),
    ...overrides,
  };
}

describe("DesktopCommandRegistry", () => {
  let registry: DesktopCommandRegistry;

  beforeEach(() => {
    registry = new DesktopCommandRegistry();
  });

  it("isolates commands by surface and restores an overridden handler", async () => {
    const original = vi.fn();
    const replacement = vi.fn();
    registry.register(command({ handler: original }));
    const unregisterReplacement = registry.register(
      command({ handler: replacement }),
    );
    registry.register(
      command({
        id: "desktop.legacy-only",
        surfaces: ["legacy"],
      }),
    );

    expect(registry.list("v2").map((item) => item.id)).toEqual([
      "desktop.test",
    ]);
    expect(registry.list("legacy").map((item) => item.id)).toEqual([
      "desktop.legacy-only",
    ]);

    await registry.execute("desktop.test", "v2", { source: "test" });
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();

    unregisterReplacement();
    await registry.execute("desktop.test", "v2", { source: "test" });
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("keeps unavailable commands visible with an explicit disabled reason", async () => {
    const handler = vi.fn();
    registry.register(
      command({
        handler,
        availability: () => false,
      }),
    );

    expect(registry.list("v2")[0]).toMatchObject({
      enabled: false,
      disabledReason: "当前界面暂不支持此命令",
    });
    await expect(registry.execute("desktop.test", "v2")).resolves.toEqual({
      ok: false,
      commandId: "desktop.test",
      reason: "当前界面暂不支持此命令",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed when a permission-bearing command has no authorizer", async () => {
    const handler = vi.fn();
    registry.register(
      command({
        handler,
        requiredPermissions: ["workspace.write"],
      }),
    );

    expect(registry.list("v2")[0]).toMatchObject({
      enabled: false,
      disabledReason: "命令缺少权限校验器",
    });
    expect((await registry.execute("desktop.test", "v2")).ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs async authorization before the handler", async () => {
    const handler = vi.fn();
    const authorize = vi.fn().mockResolvedValue({
      allowed: false,
      reason: "缺少 workspace.write",
    });
    registry.register(
      command({
        handler,
        authorize,
        requiredPermissions: ["workspace.write"],
      }),
    );

    await expect(
      registry.execute("desktop.test", "v2", { source: "palette" }),
    ).resolves.toEqual({
      ok: false,
      commandId: "desktop.test",
      reason: "缺少 workspace.write",
    });
    expect(authorize).toHaveBeenCalledWith(["workspace.write"], {
      source: "palette",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits bounded telemetry for successful execution", async () => {
    const listener = vi.fn();
    window.addEventListener(DESKTOP_COMMAND_TELEMETRY_EVENT, listener);
    registry.register(command());

    const result = await registry.execute("desktop.test", "v2", {
      source: "palette",
      args: "must-not-appear-in-telemetry",
    });

    expect(result.ok).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      commandId: "desktop.test",
      telemetryEvent: "desktop.command.test",
      surface: "v2",
      ok: true,
      requiredPermissions: [],
    });
    expect(JSON.stringify(detail)).not.toContain("must-not-appear");
    window.removeEventListener(DESKTOP_COMMAND_TELEMETRY_EVENT, listener);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => process.cwd()) },
}));

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const {
  HealthCheckService,
} = require("../../../src/main/monitoring/health-check.js");

describe("HealthCheckService optional Docker recovery", () => {
  let httpClient;

  beforeEach(() => {
    httpClient = {
      get: vi.fn().mockRejectedValue(new Error("service unavailable")),
    };
  });

  it.each(["checkOllama", "checkQdrant"])(
    "does not offer Docker auto-fix by default in %s",
    async (checkName) => {
      const service = new HealthCheckService({ httpClient });

      const result = await service[checkName]();

      expect(result).toMatchObject({ healthy: false });
      expect(result).not.toHaveProperty("autoFix");
      expect(service.dockerRuntime.enabled).toBe(false);
    },
  );

  it("returns a non-blocking skip when opt-in is enabled but Docker is unavailable", async () => {
    const startContainer = vi.fn().mockResolvedValue({
      success: false,
      skipped: true,
      reason: "unavailable",
    });
    const service = new HealthCheckService({
      httpClient,
      dockerRuntime: { enabled: true, startContainer },
    });

    const result = await service.checkOllama();

    await expect(result.autoFix()).resolves.toMatchObject({
      success: false,
      skipped: true,
      reason: "unavailable",
    });
    expect(startContainer).toHaveBeenCalledWith("chainlesschain-ollama");
  });
});

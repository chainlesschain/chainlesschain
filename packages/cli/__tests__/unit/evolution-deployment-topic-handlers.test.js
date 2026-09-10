import { describe, expect, it, vi } from "vitest";
import { createEvolutionDeploymentTopicHandlers } from "../../src/gateways/ws/evolution-deployment-topic-handlers.js";

describe("cc ui evolution deployment topics", () => {
  it("allows loopback configuration and forwards fixed fields", async () => {
    const configure = vi.fn(async (value) => ({ ...value, verified: true }));
    const handlers = createEvolutionDeploymentTopicHandlers({ configure });
    await expect(
      handlers["evolution.deployment.configure"](
        {
          descriptorPath: "C:\\managed\\deployment.json",
          trustRootPath: "C:\\managed\\public.pem",
        },
        { server: { host: "127.0.0.1", token: null } },
      ),
    ).resolves.toMatchObject({ verified: true });
    expect(configure).toHaveBeenCalledWith({
      descriptorPath: "C:\\managed\\deployment.json",
      trustRootPath: "C:\\managed\\public.pem",
      enabled: true,
    });
  });

  it("refuses an unauthenticated non-loopback control surface", async () => {
    const handlers = createEvolutionDeploymentTopicHandlers({
      getStatus: vi.fn(),
    });
    await expect(
      handlers["evolution.deployment.status"](
        {},
        { server: { host: "0.0.0.0", token: null } },
      ),
    ).rejects.toThrow(/token-protected or loopback-only/u);
  });

  it("requires a boolean toggle and bounded single-line paths", async () => {
    const handlers = createEvolutionDeploymentTopicHandlers({
      configure: vi.fn(),
      setEnabled: vi.fn(),
    });
    const context = { server: { host: "localhost", token: null } };
    await expect(
      handlers["evolution.deployment.set-enabled"](
        { enabled: "true" },
        context,
      ),
    ).rejects.toThrow("enabled must be a boolean");
    await expect(
      handlers["evolution.deployment.configure"](
        { descriptorPath: "bad\npath", trustRootPath: "C:\\public.pem" },
        context,
      ),
    ).rejects.toThrow("descriptorPath is invalid");
  });
});

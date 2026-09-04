import { describe, expect, it, vi } from "vitest";
const {
  ARTIFACT_TYPE,
} = require("@chainlesschain/session-core/evolvable-artifact");
const {
  loadDesktopEvolutionDependencies,
  resolveLoaderPath,
} = require("../desktop-evolution-deployment");

function runtimeConfig(revision) {
  const allow = () => ({ decision: "allow", policyRevision: revision });
  return {
    policy: {
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    },
    candidateWriter: { persistCandidate: async () => null },
    transitionWriter: { commitTransition: async () => null },
    transitionReader: { readTransition: async () => null },
    activeProvider: {
      listActive: async () => [],
      readActive: async () => null,
    },
  };
}

describe("desktop evolution deployment", () => {
  it("returns no governed dependencies when deployment is not configured", async () => {
    const load = vi.fn(async () => null);
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: load,
        }),
      }),
    ).resolves.toEqual({});
    expect(load).toHaveBeenCalledWith(
      "desktop",
      expect.objectContaining({ additionalFactories: expect.any(Object) }),
    );
  });

  it("extracts all three readers only from its branded composition", async () => {
    const load = vi.fn(async (_command, options) => ({
      evolvableArtifactRuntimeComposition:
        options.additionalFactories.createEvolvableArtifactRuntimeComposition({
          tenantId: "desktop-tenant",
          artifacts: {
            [ARTIFACT_TYPE.SKILL]: runtimeConfig("skill-v1"),
            [ARTIFACT_TYPE.PROMPT]: runtimeConfig("prompt-v1"),
            [ARTIFACT_TYPE.HOOK]: runtimeConfig("hook-v1"),
          },
        }),
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: load,
      }),
    });

    expect(result.evolvableArtifactSkillActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactPromptActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactHookActiveReleaseReader).toBeDefined();
  });

  it("rejects unbranded and incomplete deployment results", async () => {
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            evolvableArtifactRuntimeComposition: {},
          }),
        }),
      }),
    ).rejects.toThrow("branded runtime composition");

    expect(
      resolveLoaderPath({ isPackaged: true, resourcesPath: "C:\\app" }),
    ).toContain("packages\\cli\\src\\lib\\evolution");
  });
});

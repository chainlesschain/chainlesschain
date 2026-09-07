import { describe, expect, it, vi } from "vitest";
import path from "node:path";
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
    candidateProvider: { readCandidate: async () => null },
    promotionProvider: { authorizePromotion: async () => null },
    revalidationProvider: { authorizeRevalidation: async () => null },
  };
}

describe("desktop evolution deployment", () => {
  it("rejects bound tool execution outside its workflow and unresolved iteration limits", async () => {
    const {
      createDesktopModelIngressHost,
      bindDesktopModelIngressClient,
      runDesktopToolExecution,
      assertDesktopToolLoopComplete,
    } = require("../desktop-model-ingress");
    const client = bindDesktopModelIngressClient(
      {},
      createDesktopModelIngressHost(() => {}),
    );
    const execute = vi.fn();
    await expect(
      runDesktopToolExecution(
        client,
        { id: "call", function: { name: "lookup", arguments: "{}" } },
        execute,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(execute).not.toHaveBeenCalled();
    expect(() => assertDesktopToolLoopComplete(client)).toThrow(
      /iteration limit/,
    );
  });
  it("rejects opaque Ollama context before opening authority or dispatching", async () => {
    const {
      createDesktopModelIngressHost,
      bindDesktopModelIngressClient,
      runDesktopOllamaRequest,
    } = require("../desktop-model-ingress");
    const factory = vi.fn();
    const post = vi.fn();
    const client = bindDesktopModelIngressClient(
      { model: "test", client: { post } },
      createDesktopModelIngressHost(factory),
    );
    await expect(
      runDesktopOllamaRequest(
        client,
        "hi",
        { context: [1, 2, 3] },
        null,
        false,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(factory).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it("rejects malformed multimodal requests before opening a composition", async () => {
    const {
      createDesktopModelIngressHost,
      openDesktopMultimodalModelRun,
    } = require("../desktop-model-ingress");
    const factory = vi.fn();
    const host = createDesktopModelIngressHost(factory);

    await expect(
      openDesktopMultimodalModelRun(host, "not-a-request"),
    ).rejects.toThrow(/must be an object/);
    expect(factory).not.toHaveBeenCalled();
  });
  it("retains an independent model factory as an opaque branded host", async () => {
    const factory = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          evolutionCompositionFactory: factory,
        }),
      }),
    });
    const { isDesktopModelIngressHost } = require("../desktop-model-ingress");
    expect(isDesktopModelIngressHost(result.desktopModelIngressHost)).toBe(
      true,
    );
    expect(Object.keys(result.desktopModelIngressHost)).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects accessor and Proxy model factories", async () => {
    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "evolutionCompositionFactory", {
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/data property/);
    expect(getter).not.toHaveBeenCalled();
    const {
      createDesktopModelIngressHost,
    } = require("../desktop-model-ingress");
    expect(() =>
      createDesktopModelIngressHost(new Proxy(() => {}, {})),
    ).toThrow(/must be a function/);
    expect(() =>
      createDesktopModelIngressHost(() => {}, {
        isPackaged: true,
        resourcesPath: "relative",
      }),
    ).toThrow(/absolute/);
  });
  it("loads an independent marketplace capability through its branded Desktop facade", async () => {
    const marketplaceHost = {
      tenantId: "tenant:desktop",
      target: {
        tool: "desktop",
        model: "test",
        os: "win32-x64",
        runtime: "electron-39",
      },
      ...Object.fromEntries(
        ["inspect", "install", "list", "state", "rollout", "revoke"].map(
          (name) => [name, vi.fn()],
        ),
      ),
    };
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          marketplaceHost,
        }),
      }),
      importMarketplaceHostModule: async () => ({
        isGovernedSkillMarketplaceCliHost: (value) => value === marketplaceHost,
      }),
    });
    const {
      isDesktopGovernedSkillMarketplaceHost,
    } = require("../../marketplace/governed-skill-marketplace-host");
    expect(
      isDesktopGovernedSkillMarketplaceHost(
        result.governedSkillMarketplaceHost,
      ),
    ).toBe(true);
    expect(result.governedSkillMarketplaceHost.target.tool).toBe("desktop");
    result.governedSkillMarketplaceHost.state({ skillName: "safe-refactor" });
    expect(marketplaceHost.state).toHaveBeenCalledWith({
      skillName: "safe-refactor",
    });
  });

  it("rejects a marketplace host for a non-Desktop target", async () => {
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            marketplaceHost: { target: { tool: "cli" } },
          }),
        }),
        importMarketplaceHostModule: async () => ({
          isGovernedSkillMarketplaceCliHost: () => true,
        }),
      }),
    ).rejects.toThrow("fixed desktop target");
  });

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
    expect(result.evolvableArtifactSkillLifecycleProducer).toBeDefined();
    expect(result.evolvableArtifactPromptLifecycleProducer).toBeDefined();
    expect(result.evolvableArtifactHookLifecycleProducer).toBeDefined();
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
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "evolution-deployment-loader.js",
      ),
    );
  });
});

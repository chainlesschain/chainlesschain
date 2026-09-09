import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  loadEvolutionDeploymentCommandDependencies,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
import { isWikiSkillBenchmarkRunner } from "../../src/lib/evolution/wikiskill-benchmark-execution-host.js";
import { isEvolutionEvalProcessSupervisor } from "../../src/lib/evolution/evolution-eval-process-supervisor.js";
import { dispatchManifestEntry } from "../../src/lazy-dispatch.js";

function deploymentFixture({
  commands = ["evolution", "serve"],
  moduleSource = "export const deployment = true;\n",
} = {}) {
  const descriptorPath = resolve("deployment/evolution-descriptor.json");
  const trustRootPath = resolve("deployment/evolution-public.pem");
  const modulePath = resolve("deployment/evolution-host.mjs");
  const moduleBytes = Buffer.from(moduleSource, "utf8");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRootBytes = publicKey.export({ type: "spki", format: "pem" });
  const unsigned = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 7,
    modulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: computeEvolutionDeploymentDigest(trustRootBytes),
    commands,
  };
  const signature = signBytes(
    null,
    Buffer.from(
      serializeEvolutionDeploymentDescriptorPayload(unsigned),
      "utf8",
    ),
    privateKey,
  ).toString("base64");
  const descriptor = { ...unsigned, signature };
  const files = new Map([
    [descriptorPath, Buffer.from(JSON.stringify(descriptor), "utf8")],
    [trustRootPath, trustRootBytes],
    [modulePath, moduleBytes],
  ]);
  return {
    descriptor,
    descriptorPath,
    trustRootPath,
    modulePath,
    files,
    env: {
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
    },
    read: async (path) => {
      if (!files.has(path)) throw new Error(`missing fixture file: ${path}`);
      return files.get(path);
    },
    resolveRealPath: async (path) => path,
  };
}

describe("signed evolution deployment loader", () => {
  it("keeps supported commands unconfigured when no deployment is selected", async () => {
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", { env: {} }),
    ).resolves.toBeNull();
    await expect(
      loadEvolutionDeploymentCommandDependencies("marketplace", { env: {} }),
    ).resolves.toBeNull();
    await expect(
      loadEvolutionDeploymentCommandDependencies("learning", { env: {} }),
    ).resolves.toBeNull();
    await expect(
      loadEvolutionDeploymentCommandDependencies("status", {
        env: {
          CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: "ignored",
        },
      }),
    ).resolves.toBeNull();
  });

  it.each(["marketplace", "desktop"])(
    "exposes governed marketplace factories only to an authenticated allowlisted %s deployment",
    async (commandName) => {
      const fixture = deploymentFixture({ commands: [commandName] });
      const importModule = vi.fn(async () => ({
        createChainlessChainCommandDependencies: async ({
          commandName,
          factories,
        }) => ({
          commandName,
          hostFactoryAvailable:
            typeof factories.createGovernedSkillMarketplaceCliHost ===
            "function",
          ledgerFactoryAvailable:
            typeof factories.createGovernedSkillMarketplaceLedgerAdapter ===
            "function",
          candidateInstallerFactoryAvailable:
            typeof factories.createGovernedSkillMarketplaceCandidateInstaller ===
            "function",
        }),
      }));
      await expect(
        loadEvolutionDeploymentCommandDependencies(commandName, {
          ...fixture,
          importModule,
        }),
      ).resolves.toEqual({
        commandName,
        hostFactoryAvailable: true,
        ledgerFactoryAvailable: true,
        candidateInstallerFactoryAvailable: true,
      });
      expect(importModule).toHaveBeenCalledOnce();
      const excluded = deploymentFixture({ commands: ["evolution"] });
      await expect(
        loadEvolutionDeploymentCommandDependencies(commandName, {
          ...excluded,
          importModule,
        }),
      ).resolves.toBeNull();
      expect(importModule).toHaveBeenCalledOnce();
      fixture.files.set(fixture.modulePath, Buffer.from("replaced module"));
      await expect(
        loadEvolutionDeploymentCommandDependencies(commandName, {
          ...fixture,
          importModule,
        }),
      ).rejects.toThrow("module digest mismatch");
      expect(importModule).toHaveBeenCalledOnce();
    },
  );

  it("exposes governed learning synthesis only to an authenticated learning deployment", async () => {
    const fixture = deploymentFixture({ commands: ["learning"] });
    await expect(
      loadEvolutionDeploymentCommandDependencies("learning", {
        ...fixture,
        importModule: async () => ({
          createChainlessChainCommandDependencies: async ({
            commandName,
            descriptor,
            factories,
          }) => ({
            commandName,
            revision: descriptor.revision,
            synthesisHostFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisCliHost ===
              "function",
            providerChatFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisProviderChat ===
              "function",
            candidateEvaluatorFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisCandidateEvaluator ===
              "function",
            modelEvaluatorFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisModelEvaluator ===
              "function",
            evaluationLedgerFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisEvaluationLedgerAdapter ===
              "function",
            processGraderFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisProcessGrader ===
              "function",
            processAttestorFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisProcessAttestationAuthority ===
              "function",
            externalAttestorFactoryAvailable:
              typeof factories.createGovernedSkillSynthesisExternalAttestationAuthority ===
              "function",
          }),
        }),
      }),
    ).resolves.toEqual({
      commandName: "learning",
      revision: 7,
      synthesisHostFactoryAvailable: true,
      providerChatFactoryAvailable: true,
      candidateEvaluatorFactoryAvailable: true,
      modelEvaluatorFactoryAvailable: true,
      evaluationLedgerFactoryAvailable: true,
      processGraderFactoryAvailable: true,
      processAttestorFactoryAvailable: true,
      externalAttestorFactoryAvailable: true,
    });
  });

  it.each([
    "agent",
    "ask",
    "chat",
    "compact",
    "complete",
    "hub",
    "desktop",
    "cowork",
    "orchestrate",
    "serve",
    "stream",
    "ui",
  ])(
    "exposes the Agent runtime composition only to an authenticated %s deployment",
    async (commandName) => {
      const fixture = deploymentFixture({ commands: [commandName] });
      await expect(
        loadEvolutionDeploymentCommandDependencies(commandName, {
          ...fixture,
          importModule: async () => ({
            createChainlessChainCommandDependencies: async ({ factories }) => ({
              compositionFactoryAvailable:
                typeof factories.createAgentEvolutionRuntimeComposition ===
                "function",
            }),
          }),
        }),
      ).resolves.toEqual({ compositionFactoryAvailable: true });
    },
  );

  it("loads exact-digest deployment dependencies after Ed25519 verification", async () => {
    const fixture = deploymentFixture();
    const factory = vi.fn(async ({ commandName, descriptor, factories }) => ({
      workbenchHost: {
        commandName,
        revision: descriptor.revision,
        factoryAvailable:
          typeof factories.createEvolutionWorkbenchCliHost === "function",
        reviewRuntimeAvailable:
          typeof factories.createEvolutionWorkbenchReviewRuntime === "function",
        rollbackRuntimeAvailable:
          typeof factories.createEvolutionWorkbenchRollbackRuntime ===
          "function",
        registrySourceAvailable:
          typeof factories.createEvolutionWorkbenchRegistrySource ===
          "function",
        runtimeAvailable:
          typeof factories.createEvolutionWorkbenchRuntime === "function",
        fileResourcesAvailable:
          typeof factories.openEvolutionWorkbenchFileResources === "function",
        controlPortsAvailable:
          typeof factories.createEvolutionWorkbenchControlPorts === "function",
        benchmarkFactoriesAvailable: [
          "createWikiSkillBenchmarkCliHost",
          "createWikiSkillBenchmarkDatasetProvider",
          "createWikiSkillBenchmarkExecutionManifest",
          "createWikiSkillBenchmarkGrader",
          "createWikiSkillBenchmarkReportAttestor",
          "createWikiSkillBenchmarkRunner",
          "createWikiSkillBenchmarkLedgerAdapter",
        ].every((name) => typeof factories[name] === "function"),
        revocationFactoriesAvailable: [
          "createSkillCandidateRegistry",
          "createSkillReleaseRegistry",
          "createSkillPromotionController",
          "createEvolutionLedgerPorts",
          "createWikiMaintainerLedgerAdapter",
          "createGovernedKnowledgeArtifactLifecycle",
          "createGovernedKnowledgeSyncLedgerAdapter",
          "createGovernedKnowledgeDependencyLedgerExecutor",
          "createGovernedKnowledgeDependencyInventoryPlanner",
          "createGovernedKnowledgeSkillQuarantineAuthority",
          "createGovernedKnowledgeWikiQuarantineAuthority",
          "createGovernedKnowledgeSync",
          "createGovernedKnowledgeRevocationHost",
          "createGovernedKnowledgeCandidateQuarantineAuthority",
          "createGovernedKnowledgeCandidateRejectionAuthority",
          "createGovernedKnowledgeSkillRollbackAuthority",
          "createGovernedKnowledgeWikiTombstoneAuthority",
          "createGovernedKnowledgeDependencyRouter",
          "createGovernedKnowledgeQuarantineReleaseDecisionAuthority",
          "createGovernedKnowledgeQuarantineReleaseLedger",
        ].every((name) => typeof factories[name] === "function"),
      },
    }));
    const importModule = vi.fn(async () => ({
      createChainlessChainCommandDependencies: factory,
    }));

    const result = await loadEvolutionDeploymentCommandDependencies(
      "evolution",
      { ...fixture, importModule },
    );

    expect(result).toEqual({
      workbenchHost: {
        commandName: "evolution",
        revision: 7,
        factoryAvailable: true,
        reviewRuntimeAvailable: true,
        rollbackRuntimeAvailable: true,
        registrySourceAvailable: true,
        runtimeAvailable: true,
        fileResourcesAvailable: true,
        controlPortsAvailable: true,
        benchmarkFactoriesAvailable: true,
        revocationFactoriesAvailable: true,
      },
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(importModule).toHaveBeenCalledWith(
      expect.stringContaining(
        encodeURIComponent(fixture.descriptor.moduleDigest),
      ),
    );
  });

  it.each(
    ["evolution", "serve"].flatMap((commandName) =>
      [
        "createEvolutionWorkbenchReviewRuntime",
        "createEvolutionWorkbenchRollbackRuntime",
        "createEvolutionWorkbenchRegistrySource",
        "createEvolutionWorkbenchRuntime",
        "openEvolutionWorkbenchFileResources",
        "createEvolutionWorkbenchControlPorts",
      ].map((factoryName) => [commandName, factoryName]),
    ),
  )(
    "pins the signed %s deployment module to %s",
    async (commandName, factoryName) => {
      const fixture = deploymentFixture({ commands: [commandName] });
      await expect(
        loadEvolutionDeploymentCommandDependencies(commandName, {
          ...fixture,
          importModule: async () => ({
            createChainlessChainCommandDependencies: async ({ factories }) => {
              factories[factoryName]({
                descriptor: {
                  handlerArtifactDigest: "sha256:" + "0".repeat(64),
                },
              });
              return {};
            },
          }),
        }),
      ).rejects.toThrow(
        "handlerArtifactDigest must equal the authenticated deployment module digest",
      );
    },
  );

  it("binds Benchmark provider callables and manifests to the authenticated module bytes", async () => {
    const fixture = deploymentFixture({ commands: ["evolution"] });
    const result = await loadEvolutionDeploymentCommandDependencies(
      "evolution",
      {
        ...fixture,
        importModule: async () => ({
          createChainlessChainCommandDependencies: async ({
            descriptor,
            factories,
          }) => {
            const authority = (name) => ({
              authorityId: `authority:${name}`,
              revision: 1,
              handlerArtifactDigest: descriptor.moduleDigest,
            });
            const runner = factories.createWikiSkillBenchmarkRunner({
              descriptor: authority("runner"),
              run: async () => ({}),
              verifyAttestation: async () => true,
            });
            const executionManifest =
              factories.createWikiSkillBenchmarkExecutionManifest({
                datasetProvider: authority("datasets"),
                runner: authority("runner"),
                grader: authority("grader"),
                reportAttestor: authority("report"),
                targetEnvironmentDigest: computeEvolutionDeploymentDigest(
                  Buffer.from("environment"),
                ),
              });
            return { runner, executionManifest };
          },
        }),
      },
    );

    expect(isWikiSkillBenchmarkRunner(result.runner)).toBe(true);
    expect(result.runner.descriptor.handlerArtifactDigest).toBe(
      fixture.descriptor.moduleDigest,
    );
    expect(
      Object.values({
        datasetProvider: result.executionManifest.datasetProvider,
        runner: result.executionManifest.runner,
        grader: result.executionManifest.grader,
        reportAttestor: result.executionManifest.reportAttestor,
      }).every(
        (authority) =>
          authority.handlerArtifactDigest === fixture.descriptor.moduleDigest,
      ),
    ).toBe(true);
  });

  it("rejects a Benchmark callable that claims bytes outside the signed module", async () => {
    const fixture = deploymentFixture({ commands: ["evolution"] });
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        ...fixture,
        importModule: async () => ({
          createChainlessChainCommandDependencies: async ({ factories }) => ({
            runner: factories.createWikiSkillBenchmarkRunner({
              descriptor: {
                authorityId: "authority:runner",
                revision: 1,
                handlerArtifactDigest: computeEvolutionDeploymentDigest(
                  Buffer.from("substituted module"),
                ),
              },
              run: async () => ({}),
              verifyAttestation: async () => true,
            }),
          }),
        }),
      }),
    ).rejects.toThrow("authenticated deployment module digest");
  });

  it("binds the process Eval supervisor authority to authenticated deployment bytes", async () => {
    const fixture = deploymentFixture({ commands: ["evolution"] });
    const targetSource =
      "export async function runTarget(value) { return value; }\n";
    const targetRoot = await mkdtemp(join(tmpdir(), "cc-loader-eval-target-"));
    const targetPath = join(targetRoot, "eval-target.mjs");
    const targetDigest = computeEvolutionDeploymentDigest(
      Buffer.from(targetSource),
    );
    await writeFile(targetPath, targetSource);
    const result = await loadEvolutionDeploymentCommandDependencies(
      "evolution",
      {
        ...fixture,
        importModule: async () => ({
          createChainlessChainCommandDependencies: async ({
            descriptor,
            factories,
          }) => {
            const trust = {
              algorithm: "ed25519",
              issuer: "deployment",
              keyId: "deployment-key",
              trustPolicyDigest: computeEvolutionDeploymentDigest(
                Buffer.from("trust-policy"),
              ),
            };
            const target = {
              schema: "chainlesschain.evolution-eval-isolated-target/v2",
              handlerId: "deployment-target",
              handlerRevision: "target-v1",
              operation: "cell-eval-run",
              isolation: "process",
              handlerArtifactDigest: targetDigest,
              authority: trust,
            };
            const authorityDescriptor = {
              schema: "chainlesschain.evolution-eval-authority-descriptor/v1",
              handlerId: "deployment-supervisor",
              handlerRevision: "supervisor-v1",
              operation: "deadline-supervision",
              handlerArtifactDigest: descriptor.moduleDigest,
              authority: trust,
            };
            return {
              supervisor: await factories.createEvolutionEvalProcessSupervisor({
                targets: new Map([
                  [
                    target.handlerId,
                    { target, modulePath: targetPath, exportName: "runTarget" },
                  ],
                ]),
                authorityDescriptor,
                supervisorRevision: "supervisor-v1",
                invocationRevision: "invocation-v1",
                revocationRevision: "revocation-v1",
                attestSupervisor: async () => trust,
                attestInvocation: async () => trust,
                attestRevocation: async () => trust,
                verifyEnforcement: () => true,
                spawnProcess: vi.fn(),
              }),
            };
          },
        }),
      },
    );
    expect(isEvolutionEvalProcessSupervisor(result.supervisor)).toBe(true);
    expect(result.supervisor.authorityDescriptor.handlerArtifactDigest).toBe(
      fixture.descriptor.moduleDigest,
    );
  });

  it("rejects a process Eval supervisor outside authenticated deployment bytes", async () => {
    const fixture = deploymentFixture({ commands: ["evolution"] });
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        ...fixture,
        importModule: async () => ({
          createChainlessChainCommandDependencies: async ({ factories }) => ({
            supervisor: await factories.createEvolutionEvalProcessSupervisor({
              authorityDescriptor: {
                handlerArtifactDigest: computeEvolutionDeploymentDigest(
                  Buffer.from("substituted-supervisor"),
                ),
              },
            }),
          }),
        }),
      }),
    ).rejects.toThrow("authenticated deployment module digest");
  });

  it("admits desktop only through a signed descriptor and caller-owned factory", async () => {
    const fixture = deploymentFixture({ commands: ["desktop"] });
    const composition = Object.freeze({ branded: true });
    const runtimeFactory = vi.fn(() => composition);
    const factory = vi.fn(async ({ commandName, factories }) => ({
      evolvableArtifactRuntimeComposition:
        factories.createEvolvableArtifactRuntimeComposition({ commandName }),
    }));

    await expect(
      loadEvolutionDeploymentCommandDependencies("desktop", {
        ...fixture,
        additionalFactories: {
          createEvolvableArtifactRuntimeComposition: runtimeFactory,
        },
        importModule: async () => ({
          createChainlessChainCommandDependencies: factory,
        }),
      }),
    ).resolves.toEqual({
      evolvableArtifactRuntimeComposition: composition,
    });
    expect(runtimeFactory).toHaveBeenCalledWith({ commandName: "desktop" });
  });

  it("does not let non-desktop callers inject or replace built-in factories", async () => {
    const fixture = deploymentFixture({ commands: ["evolution"] });
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        ...fixture,
        additionalFactories: {
          createEvolutionWorkbenchCliHost: vi.fn(),
        },
        importModule: async () => ({
          createChainlessChainCommandDependencies: async () => ({}),
        }),
      }),
    ).rejects.toThrow("reserved for desktop");
  });

  it("executes the authenticated bytes instead of reopening the module pathname", async () => {
    const fixture = deploymentFixture({
      moduleSource:
        "export async function createChainlessChainCommandDependencies(context) { return { loadedFor: context.commandName, hasWorkbenchFactory: typeof context.factories.createEvolutionWorkbenchCliHost === 'function' }; }\n",
    });

    await expect(
      loadEvolutionDeploymentCommandDependencies("serve", fixture),
    ).resolves.toEqual({ loadedFor: "serve", hasWorkbenchFactory: true });
  });

  it("does not import a module for a command outside the signed allowlist", async () => {
    const fixture = deploymentFixture({ commands: ["serve"] });
    const importModule = vi.fn();
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        ...fixture,
        importModule,
      }),
    ).resolves.toBeNull();
    expect(importModule).not.toHaveBeenCalled();
  });

  it("fails closed on partial configuration, trust drift, signature drift or module replacement", async () => {
    const fixture = deploymentFixture();
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        env: {
          CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR:
            fixture.descriptorPath,
        },
      }),
    ).rejects.toThrow("both descriptor and trust root");

    fixture.files.set(fixture.trustRootPath, Buffer.from("wrong key"));
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", fixture),
    ).rejects.toThrow("trust root digest mismatch");

    const signatureFixture = deploymentFixture();
    const changed = {
      ...signatureFixture.descriptor,
      revision: signatureFixture.descriptor.revision + 1,
    };
    signatureFixture.files.set(
      signatureFixture.descriptorPath,
      Buffer.from(JSON.stringify(changed), "utf8"),
    );
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", signatureFixture),
    ).rejects.toThrow("signature rejected");

    const moduleFixture = deploymentFixture();
    moduleFixture.files.set(
      moduleFixture.modulePath,
      Buffer.from("export const replaced = true;\n", "utf8"),
    );
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", moduleFixture),
    ).rejects.toThrow("module digest mismatch");
  });

  it.each([
    ["evolution", "workbenchHost", "registerEvolutionCommand"],
    ["compact", "evolutionCompositionFactory", "registerCompactCommand"],
    ["complete", "evolutionCompositionFactory", "registerCompleteCommand"],
    ["stream", "evolutionCompositionFactory", "registerStreamCommand"],
    ["hub", "evolutionCompositionFactory", "registerHubCommand"],
    ["ui", "evolutionCompositionFactory", "registerUiCommand"],
    ["marketplace", "marketplaceHost", "registerMarketplaceCommand"],
  ])(
    "passes %s deployment dependencies through the lazy registration boundary",
    async (commandName, hostName, registerName) => {
      const parseAsync = vi.fn(async () => {});
      const dependency = Object.freeze({ [hostName]: {} });
      const register = vi.fn();
      await dispatchManifestEntry(
        ["node", "cc", commandName],
        {
          name: commandName,
          module: `./commands/${commandName}.js`,
          register: registerName,
        },
        {
          createBaseProgram: async () => ({ parseAsync }),
          loadCommandModule: async () => ({ [registerName]: register }),
          loadCommandDependencies: async () => dependency,
        },
      );

      expect(register).toHaveBeenCalledWith(expect.anything(), dependency);
      expect(parseAsync).toHaveBeenCalledOnce();
    },
  );
});

import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  loadEvolutionDeploymentCommandDependencies,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
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
      loadEvolutionDeploymentCommandDependencies("status", {
        env: {
          CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: "ignored",
        },
      }),
    ).resolves.toBeNull();
  });

  it("loads exact-digest deployment dependencies after Ed25519 verification", async () => {
    const fixture = deploymentFixture();
    const factory = vi.fn(async ({ commandName, descriptor, factories }) => ({
      workbenchHost: {
        commandName,
        revision: descriptor.revision,
        factoryAvailable:
          typeof factories.createEvolutionWorkbenchCliHost === "function",
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
      },
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(importModule).toHaveBeenCalledWith(
      expect.stringContaining(
        encodeURIComponent(fixture.descriptor.moduleDigest),
      ),
    );
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

  it("passes deployment dependencies through the lazy registration boundary", async () => {
    const parseAsync = vi.fn(async () => {});
    const dependency = Object.freeze({ workbenchHost: {} });
    const register = vi.fn();
    await dispatchManifestEntry(
      ["node", "cc", "evolution"],
      {
        name: "evolution",
        module: "./commands/evolution.js",
        register: "registerEvolutionCommand",
      },
      {
        createBaseProgram: async () => ({ parseAsync }),
        loadCommandModule: async () => ({ registerEvolutionCommand: register }),
        loadCommandDependencies: async () => dependency,
      },
    );

    expect(register).toHaveBeenCalledWith(expect.anything(), dependency);
    expect(parseAsync).toHaveBeenCalledOnce();
  });
});

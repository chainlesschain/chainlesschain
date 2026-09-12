import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assessEvolutionDeploymentReadiness,
  configureEvolutionDeployment,
  getEvolutionDeploymentStatus,
  revokeEvolutionDeploymentDescriptorRevisions,
  setEvolutionDeploymentEnabled,
} from "../../src/lib/evolution/evolution-deployment-config.js";
import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  loadEvolutionDeploymentCommandDependencies,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
import {
  EVOLUTION_DEPLOYMENT_ROOT_ROTATION_SCHEMA,
  serializeEvolutionDeploymentRootRotationPayload,
} from "../../src/lib/evolution/evolution-deployment-root-rotation.js";
import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOCATIONS_SCHEMA,
  serializeEvolutionDeploymentDescriptorRevocationsPayload,
} from "../../src/lib/evolution/evolution-deployment-descriptor-revocations.js";

const temporaryRoots = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture({ commands = ["evolution"], moduleSource } = {}) {
  const root = await mkdtemp(join(tmpdir(), "cc-evolution-profile-"));
  temporaryRoots.push(root);
  const home = join(root, "home");
  const descriptorPath = join(root, "deployment.json");
  const trustRootPath = join(root, "public.pem");
  const modulePath = join(root, "host.mjs");
  const moduleBytes = Buffer.from(
    moduleSource ??
      "export async function createChainlessChainCommandDependencies({commandName}) { return {commandName}; }\n",
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRootBytes = publicKey.export({ type: "spki", format: "pem" });
  const unsigned = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 3,
    modulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: computeEvolutionDeploymentDigest(trustRootBytes),
    commands,
  };
  const descriptor = signedDescriptor(unsigned, privateKey);
  await Promise.all([
    writeFile(modulePath, moduleBytes),
    writeFile(trustRootPath, trustRootBytes),
    writeFile(descriptorPath, JSON.stringify(descriptor)),
  ]);
  return {
    root,
    home,
    descriptorPath,
    trustRootPath,
    modulePath,
    privateKey,
    trustRootDigest: unsigned.trustRootDigest,
    options: {
      env: { CHAINLESSCHAIN_HOME: home },
      cwd: process.cwd(),
    },
  };
}

function signedDescriptor(unsigned, privateKey) {
  return {
    ...unsigned,
    signature: signBytes(
      null,
      Buffer.from(serializeEvolutionDeploymentDescriptorPayload(unsigned)),
      privateKey,
    ).toString("base64"),
  };
}

async function replaceDescriptor(value, revision) {
  const moduleBytes = await readFile(value.modulePath);
  const unsigned = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision,
    modulePath: value.modulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: value.trustRootDigest,
    commands: ["evolution"],
  };
  await writeFile(
    value.descriptorPath,
    JSON.stringify(signedDescriptor(unsigned, value.privateKey)),
  );
}

describe("persistent evolution deployment configuration", () => {
  it("distinguishes provider configuration from command-specific deployment admission", () => {
    expect(
      assessEvolutionDeploymentReadiness({
        effectiveEnabled: false,
        verified: false,
      }),
    ).toMatchObject({
      ready: false,
      state: "not_configured",
      code: "EVOLUTION_DEPLOYMENT_NOT_CONFIGURED",
      taskReady: false,
    });
    expect(
      assessEvolutionDeploymentReadiness({
        effectiveEnabled: true,
        verified: false,
        error: "evolution deployment descriptor signature rejected",
      }),
    ).toMatchObject({
      ready: false,
      detail: expect.stringContaining("not verified"),
    });
    expect(
      assessEvolutionDeploymentReadiness({
        effectiveEnabled: true,
        verified: true,
        commands: ["ask", "agent"],
      }),
    ).toMatchObject({
      ready: true,
      state: "admitted",
      scope: "deployment-admission",
      runtimeVerification: "not_checked",
      taskReady: null,
      remediation: null,
    });
  });

  it.each(
    [undefined, [], ["evolution"], ["ask"]].map((commands) => [commands]),
  )(
    "does not admit ordinary model commands from an incomplete allowlist: %j",
    (commands) => {
      const result = assessEvolutionDeploymentReadiness({
        effectiveEnabled: true,
        verified: true,
        commands,
      });
      expect(result).toMatchObject({
        ready: false,
        state: "command_not_allowed",
        code: "EVOLUTION_DEPLOYMENT_COMMAND_NOT_ALLOWED",
        taskReady: false,
      });
      expect(result.missingCommands).toContain("agent");
      expect(result.remediation).toContain("signed deployment");
    },
  );

  it("assesses each command independently and freezes the diagnostic projection", () => {
    const status = {
      effectiveEnabled: true,
      verified: true,
      commands: ["ask"],
    };
    const ask = assessEvolutionDeploymentReadiness(status, {
      requiredCommands: ["ask"],
    });
    const agent = assessEvolutionDeploymentReadiness(status, {
      requiredCommands: ["agent"],
    });
    expect(ask).toMatchObject({
      ready: true,
      taskReady: null,
      missingCommands: [],
    });
    expect(agent).toMatchObject({
      ready: false,
      taskReady: false,
      missingCommands: ["agent"],
    });
    expect(Object.isFrozen(ask)).toBe(true);
    expect(Object.isFrozen(ask.requiredCommands)).toBe(true);
    expect(Object.isFrozen(ask.missingCommands)).toBe(true);
    status.commands.push("agent");
    expect(agent.ready).toBe(false);
  });

  it("distinguishes disabled configuration from an invalid saved profile", () => {
    const status = {
      effectiveEnabled: false,
      profileEnabled: false,
      descriptorPath: "saved-deployment.json",
    };
    expect(assessEvolutionDeploymentReadiness(status)).toMatchObject({
      state: "disabled",
      code: "EVOLUTION_DEPLOYMENT_DISABLED",
      ready: false,
    });
    expect(
      assessEvolutionDeploymentReadiness({
        ...status,
        error: "corrupt profile",
      }),
    ).toMatchObject({
      state: "invalid",
      code: "EVOLUTION_DEPLOYMENT_NOT_VERIFIED",
      ready: false,
    });
  });

  it.each([false, undefined, "true", 1])(
    "requires boolean verification, not %j",
    (verified) => {
      expect(
        assessEvolutionDeploymentReadiness({
          effectiveEnabled: true,
          verified,
          commands: ["ask", "agent"],
        }),
      ).toMatchObject({ ready: false, state: "invalid", taskReady: false });
    },
  );

  it.each([[], [""], [" ask"], [null], "ask"].map((commands) => [commands]))(
    "rejects an invalid readiness target instead of vacuously admitting it: %j",
    (requiredCommands) => {
      expect(() =>
        assessEvolutionDeploymentReadiness(
          {
            effectiveEnabled: true,
            verified: true,
            commands: ["ask", "agent"],
          },
          { requiredCommands },
        ),
      ).toThrow("explicit command names");
    },
  );

  it("publishes separate ask/agent admission without executing a signed module", async () => {
    const value = await fixture({
      commands: ["ask"],
      // Signature verification may inspect these bytes but must not execute them.
      moduleSource:
        "throw new Error('status must not execute the deployment module');\n",
    });
    const importModule = vi.fn(() => {
      throw new Error("unexpected import");
    });
    const status = await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      { ...value.options, importModule },
    );
    expect(status).toMatchObject({
      verified: true,
      autoPromotion: "hold",
      readiness: {
        ask: {
          ready: true,
          runtimeVerification: "not_checked",
          taskReady: null,
        },
        agent: { ready: false, state: "command_not_allowed", taskReady: false },
      },
    });
    expect(importModule).not.toHaveBeenCalled();
    expect(Object.isFrozen(status.readiness)).toBe(true);
    const disabled = await setEvolutionDeploymentEnabled(false, value.options);
    expect(disabled.readiness.ask).toMatchObject({
      state: "disabled",
      ready: false,
      taskReady: false,
    });
    expect(disabled.readiness.agent.ready).toBe(false);
  });

  it("publishes blocked admission for an absent deployment", async () => {
    const value = await fixture();
    const status = await getEvolutionDeploymentStatus(value.options);
    expect(status.readiness.ask).toMatchObject({
      state: "not_configured",
      ready: false,
    });
    expect(status.readiness.agent).toMatchObject({
      state: "not_configured",
      ready: false,
    });
  });

  it("verifies before saving and becomes the loader fallback", async () => {
    const value = await fixture();
    const status = await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      value.options,
    );

    expect(status).toMatchObject({
      source: "profile",
      effectiveEnabled: true,
      profileEnabled: true,
      verified: true,
      revision: 3,
      autoPromotion: "hold",
    });
    const importModule = vi.fn(async () => ({
      createChainlessChainCommandDependencies: async ({ commandName }) => ({
        commandName,
      }),
    }));
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        ...value.options,
        importModule,
      }),
    ).resolves.toEqual({ commandName: "evolution" });
    expect(importModule).toHaveBeenCalledOnce();
  });

  it("can disable a stale profile and keeps the failure visible in status", async () => {
    const value = await fixture();
    await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      value.options,
    );
    await writeFile(value.modulePath, "tampered\n");

    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", value.options),
    ).resolves.toBeNull();
    await expect(
      getEvolutionDeploymentStatus(value.options),
    ).resolves.toMatchObject({
      effectiveEnabled: true,
      verified: false,
      error: "evolution deployment module digest mismatch",
    });
    await expect(
      setEvolutionDeploymentEnabled(false, value.options),
    ).resolves.toMatchObject({
      source: "none",
      effectiveEnabled: false,
      profileEnabled: false,
    });
  });

  it("keeps explicit environment selection above the saved profile", async () => {
    const value = await fixture();
    await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      value.options,
    );
    const status = await getEvolutionDeploymentStatus({
      ...value.options,
      env: {
        ...value.options.env,
        CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: value.descriptorPath,
        CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: value.trustRootPath,
      },
    });
    expect(status.source).toBe("environment");
    expect(status.verified).toBe(true);
  });

  it("persists a trust-root-scoped revision floor and rejects descriptor rollback", async () => {
    const value = await fixture();
    await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      value.options,
    );

    await replaceDescriptor(value, 2);
    await expect(
      configureEvolutionDeployment(
        {
          descriptorPath: value.descriptorPath,
          trustRootPath: value.trustRootPath,
        },
        value.options,
      ),
    ).rejects.toMatchObject({
      code: "EVOLUTION_DEPLOYMENT_REVISION_ROLLBACK",
    });

    await expect(
      getEvolutionDeploymentStatus(value.options),
    ).resolves.toMatchObject({
      effectiveEnabled: true,
      verified: false,
      error: expect.stringContaining("revision rollback rejected"),
    });
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", value.options),
    ).resolves.toBeNull();

    await replaceDescriptor(value, 4);
    await expect(
      configureEvolutionDeployment(
        {
          descriptorPath: value.descriptorPath,
          trustRootPath: value.trustRootPath,
        },
        value.options,
      ),
    ).resolves.toMatchObject({
      verified: true,
      revision: 4,
      revisionFloor: 4,
    });
  });

  it("requires an active-root-signed certificate before rotating trust roots", async () => {
    const value = await fixture();
    await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      value.options,
    );

    const nextDescriptorPath = join(value.root, "next-deployment.json");
    const nextTrustRootPath = join(value.root, "next-public.pem");
    const rotationPath = join(value.root, "root-rotation.json");
    const { privateKey: nextPrivateKey, publicKey: nextPublicKey } =
      generateKeyPairSync("ed25519");
    const nextTrustRootBytes = nextPublicKey.export({
      type: "spki",
      format: "pem",
    });
    const nextTrustRootDigest =
      computeEvolutionDeploymentDigest(nextTrustRootBytes);
    const moduleBytes = await readFile(value.modulePath);
    const nextUnsigned = {
      schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
      revision: 1,
      modulePath: value.modulePath,
      moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
      trustRootDigest: nextTrustRootDigest,
      commands: ["evolution"],
    };
    await Promise.all([
      writeFile(nextTrustRootPath, nextTrustRootBytes),
      writeFile(
        nextDescriptorPath,
        JSON.stringify(signedDescriptor(nextUnsigned, nextPrivateKey)),
      ),
    ]);

    await expect(
      configureEvolutionDeployment(
        {
          descriptorPath: nextDescriptorPath,
          trustRootPath: nextTrustRootPath,
        },
        value.options,
      ),
    ).rejects.toMatchObject({
      code: "EVOLUTION_DEPLOYMENT_ROOT_ROTATION_REQUIRED",
    });

    const rotationUnsigned = {
      schema: EVOLUTION_DEPLOYMENT_ROOT_ROTATION_SCHEMA,
      fromTrustRootDigest: value.trustRootDigest,
      toTrustRootDigest: nextTrustRootDigest,
      minimumDescriptorRevision: 1,
    };
    await writeFile(
      rotationPath,
      JSON.stringify({
        ...rotationUnsigned,
        signature: signBytes(
          null,
          Buffer.from(
            serializeEvolutionDeploymentRootRotationPayload({
              ...rotationUnsigned,
              signature: "AA==",
            }),
          ),
          value.privateKey,
        ).toString("base64"),
      }),
    );

    await expect(
      configureEvolutionDeployment(
        {
          descriptorPath: nextDescriptorPath,
          trustRootPath: nextTrustRootPath,
          rootRotationPath: rotationPath,
        },
        value.options,
      ),
    ).resolves.toMatchObject({
      verified: true,
      revision: 1,
      revisionFloor: 1,
    });
  });

  it("persists signed revocations, disables the profile, and rejects re-enable", async () => {
    const value = await fixture();
    const revocationPath = join(value.root, "descriptor-revocations.json");
    await configureEvolutionDeployment(
      {
        descriptorPath: value.descriptorPath,
        trustRootPath: value.trustRootPath,
      },
      value.options,
    );
    const unsigned = {
      schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOCATIONS_SCHEMA,
      revision: 1,
      trustRootDigest: value.trustRootDigest,
      revokedDescriptorRevisions: [3],
    };
    await writeFile(
      revocationPath,
      JSON.stringify({
        ...unsigned,
        signature: signBytes(
          null,
          Buffer.from(
            serializeEvolutionDeploymentDescriptorRevocationsPayload({
              ...unsigned,
              signature: "AA==",
            }),
          ),
          value.privateKey,
        ).toString("base64"),
      }),
    );

    await expect(
      revokeEvolutionDeploymentDescriptorRevisions(
        { revocationPath },
        value.options,
      ),
    ).resolves.toMatchObject({
      source: "none",
      effectiveEnabled: false,
    });
    await expect(
      setEvolutionDeploymentEnabled(true, value.options),
    ).resolves.toMatchObject({
      source: "profile",
      verified: false,
      error: expect.stringContaining("is revoked"),
    });
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", value.options),
    ).resolves.toBeNull();
  });
});

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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cc-evolution-profile-"));
  temporaryRoots.push(root);
  const home = join(root, "home");
  const descriptorPath = join(root, "deployment.json");
  const trustRootPath = join(root, "public.pem");
  const modulePath = join(root, "host.mjs");
  const moduleBytes = Buffer.from(
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
    commands: ["evolution"],
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
  it("distinguishes configured provider readiness from a verified model ingress", () => {
    expect(
      assessEvolutionDeploymentReadiness({
        effectiveEnabled: false,
        verified: false,
      }),
    ).toMatchObject({
      ready: false,
      detail: "no enabled signed Evolution model ingress",
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
      }),
    ).toMatchObject({ ready: true, remediation: null });
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
    const nextTrustRootDigest = computeEvolutionDeploymentDigest(
      nextTrustRootBytes,
    );
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

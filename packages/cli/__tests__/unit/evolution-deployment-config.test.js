import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureEvolutionDeployment,
  getEvolutionDeploymentStatus,
  setEvolutionDeploymentEnabled,
} from "../../src/lib/evolution/evolution-deployment-config.js";
import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  loadEvolutionDeploymentCommandDependencies,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";

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
  const descriptor = {
    ...unsigned,
    signature: signBytes(
      null,
      Buffer.from(serializeEvolutionDeploymentDescriptorPayload(unsigned)),
      privateKey,
    ).toString("base64"),
  };
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
    options: {
      env: { CHAINLESSCHAIN_HOME: home },
      cwd: process.cwd(),
    },
  };
}

describe("persistent evolution deployment configuration", () => {
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
});

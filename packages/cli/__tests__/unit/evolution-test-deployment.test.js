import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
import { configureEvolutionDeployment } from "../../src/lib/evolution/evolution-deployment-config.js";
import { readEvolutionDeploymentProfile } from "../../src/lib/evolution/evolution-deployment-profile.js";
import {
  initializeEvolutionTestDeployment,
  replaceEvolutionTestDeployment,
} from "../../src/lib/evolution/evolution-test-deployment.js";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "cc-evolution-test-deployment-"));
  roots.push(root);
  const modulePath = join(root, "host.mjs");
  await writeFile(
    modulePath,
    "export async function createChainlessChainCommandDependencies() { return {}; }\n",
  );
  return {
    root,
    modulePath,
    options: { env: { CHAINLESSCHAIN_HOME: join(root, "home") } },
  };
}

async function managedDeployment(root, modulePath) {
  const descriptorPath = join(root, "managed-deployment.json");
  const trustRootPath = join(root, "managed-public.pem");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRootBytes = publicKey.export({ type: "spki", format: "pem" });
  const moduleBytes = await readFile(modulePath);
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 1,
    modulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: computeEvolutionDeploymentDigest(trustRootBytes),
    commands: ["agent", "evolution", "serve"],
  };
  descriptor.signature = signBytes(
    null,
    Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
    privateKey,
  ).toString("base64");
  await Promise.all([
    writeFile(descriptorPath, `${JSON.stringify(descriptor)}\n`),
    writeFile(trustRootPath, trustRootBytes),
  ]);
  return { descriptorPath, trustRootPath };
}

describe("one-click Evolution test deployment", () => {
  it("generates a signed TEST profile and refreshes it after host changes", async () => {
    const value = await setup();
    const created = await initializeEvolutionTestDeployment(
      { modulePath: value.modulePath },
      value.options,
    );
    expect(created).toMatchObject({
      deploymentMode: "test",
      verified: true,
      revision: 1,
      generated: true,
      autoPromotion: "hold",
    });
    expect(created.commands).toContain("agent");
    expect(created.commands).toContain("serve");
    expect(created.warning).toContain("TEST ONLY");

    await writeFile(
      value.modulePath,
      "export async function createChainlessChainCommandDependencies() { return { refreshed: true }; }\n",
    );
    const refreshed = await initializeEvolutionTestDeployment(
      { modulePath: value.modulePath, commands: "agent,evolution,serve" },
      value.options,
    );
    expect(refreshed).toMatchObject({
      deploymentMode: "test",
      verified: true,
      revision: 2,
      generated: false,
      commands: ["agent", "evolution", "serve"],
    });
    const profile = await readEvolutionDeploymentProfile(value.options);
    expect(profile.profile).toMatchObject({
      deploymentMode: "test",
      testPrivateKeyPath: expect.stringMatching(/test-signing-private\.pem$/u),
    });
  });

  it("uses the generated test root to rotate to a managed deployment", async () => {
    const value = await setup();
    await initializeEvolutionTestDeployment(
      { modulePath: value.modulePath },
      value.options,
    );
    const managed = await managedDeployment(value.root, value.modulePath);
    const replaced = await replaceEvolutionTestDeployment(
      managed,
      value.options,
    );
    expect(replaced).toMatchObject({
      deploymentMode: "managed",
      verified: true,
      replacedTestDeployment: true,
      revision: 1,
    });
    expect(replaced.rootRotationPath).toMatch(/managed-root-rotation\.json$/u);
    const profile = await readEvolutionDeploymentProfile(value.options);
    expect(profile.profile).toMatchObject({
      deploymentMode: "managed",
      testPrivateKeyPath: null,
      descriptorPath: managed.descriptorPath,
      trustRootPath: managed.trustRootPath,
    });
  });

  it("does not overwrite an existing managed profile or environment override", async () => {
    const value = await setup();
    const managed = await managedDeployment(value.root, value.modulePath);
    await expect(
      replaceEvolutionTestDeployment(managed, value.options),
    ).rejects.toMatchObject({ code: "EVOLUTION_TEST_DEPLOYMENT_NOT_ACTIVE" });
    await configureEvolutionDeployment(managed, value.options);
    await expect(
      initializeEvolutionTestDeployment(
        { modulePath: value.modulePath },
        value.options,
      ),
    ).rejects.toMatchObject({
      code: "EVOLUTION_TEST_DEPLOYMENT_MANAGED_PROFILE_EXISTS",
    });
    await expect(
      initializeEvolutionTestDeployment(
        { modulePath: value.modulePath },
        {
          env: {
            ...value.options.env,
            CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR:
              managed.descriptorPath,
          },
        },
      ),
    ).rejects.toThrow(/environment overrides to be unset/u);
  });
});

import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  loadEvolutionDeploymentCommandDependencies,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
import { getEvolutionDeploymentProfilePath } from "../../src/lib/evolution/evolution-deployment-profile.js";

const roots = [];

function temporaryHome() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-agent-deployment-boundary-"),
  );
  roots.push(root);
  return {
    root,
    env: { CHAINLESSCHAIN_HOME: root },
    profilePath: getEvolutionDeploymentProfilePath({
      env: { CHAINLESSCHAIN_HOME: root },
    }),
  };
}

function writeProfile(profilePath, value) {
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(value), "utf8");
}

function legacyProfile(root, enabled) {
  return {
    schema: "chainlesschain.evolution-deployment-profile/v1",
    enabled,
    descriptorPath: path.join(root, "descriptor.json"),
    trustRootPath: path.join(root, "trust-root.pem"),
  };
}

function signedFixture(commands) {
  const root = path.resolve("agent-deployment-boundary-fixture");
  const descriptorPath = path.join(root, "descriptor.json");
  const trustRootPath = path.join(root, "trust-root.pem");
  const modulePath = path.join(root, "deployment.mjs");
  const moduleBytes = Buffer.from(
    "export async function createChainlessChainCommandDependencies() { return {}; }\n",
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRootBytes = publicKey.export({ type: "spki", format: "pem" });
  const unsigned = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 1,
    modulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: computeEvolutionDeploymentDigest(trustRootBytes),
    commands,
  };
  const descriptor = {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(serializeEvolutionDeploymentDescriptorPayload(unsigned)),
      privateKey,
    ).toString("base64"),
  };
  const files = new Map([
    [descriptorPath, Buffer.from(JSON.stringify(descriptor))],
    [trustRootPath, trustRootBytes],
    [modulePath, moduleBytes],
  ]);
  return {
    env: {
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
    },
    read: async (filePath) => files.get(filePath),
    resolveRealPath: async (filePath) => filePath,
  };
}

async function expectDenied(dependencies, code) {
  expect(dependencies).toEqual({
    evolutionCompositionFactory: expect.any(Function),
  });
  await expect(
    dependencies.evolutionCompositionFactory(),
  ).rejects.toMatchObject({ code });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Agent deployment legacy boundary", () => {
  it("uses legacy Agent only when no deployment profile exists", async () => {
    const fixture = temporaryHome();
    await expect(
      loadEvolutionDeploymentCommandDependencies("agent", {
        env: fixture.env,
      }),
    ).resolves.toBeNull();
  });

  it("denies Agent for an invalid or disabled saved profile without blocking recovery commands", async () => {
    const invalid = temporaryHome();
    writeProfile(invalid.profilePath, { schema: "invalid" });
    await expectDenied(
      await loadEvolutionDeploymentCommandDependencies("agent", {
        env: invalid.env,
      }),
      "EVOLUTION_DEPLOYMENT_PROFILE_INVALID",
    );
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        env: invalid.env,
      }),
    ).resolves.toBeNull();

    const disabled = temporaryHome();
    writeProfile(disabled.profilePath, legacyProfile(disabled.root, false));
    await expectDenied(
      await loadEvolutionDeploymentCommandDependencies("agent", {
        env: disabled.env,
      }),
      "EVOLUTION_DEPLOYMENT_DISABLED",
    );
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        env: disabled.env,
      }),
    ).resolves.toBeNull();
  });

  it("denies Agent when an enabled saved deployment no longer verifies", async () => {
    const fixture = temporaryHome();
    writeProfile(fixture.profilePath, legacyProfile(fixture.root, true));
    await expectDenied(
      await loadEvolutionDeploymentCommandDependencies("agent", {
        env: fixture.env,
        read: async () => {
          throw new Error("deployment bytes unavailable");
        },
        resolveRealPath: async (filePath) => filePath,
      }),
      "EVOLUTION_DEPLOYMENT_NOT_VERIFIED",
    );
    await expect(
      loadEvolutionDeploymentCommandDependencies("evolution", {
        env: fixture.env,
        read: async () => {
          throw new Error("deployment bytes unavailable");
        },
        resolveRealPath: async (filePath) => filePath,
      }),
    ).resolves.toBeNull();
  });

  it("denies Agent when an authenticated descriptor excludes the agent command", async () => {
    await expectDenied(
      await loadEvolutionDeploymentCommandDependencies(
        "agent",
        signedFixture(["evolution"]),
      ),
      "EVOLUTION_DEPLOYMENT_COMMAND_NOT_ALLOWED",
    );
  });

  it.each([
    ["missing", () => ({})],
    ["null", () => ({ evolutionCompositionFactory: null })],
    [
      "accessor",
      () =>
        Object.defineProperty({}, "evolutionCompositionFactory", {
          enumerable: true,
          get() {
            throw new Error("factory accessor must not execute");
          },
        }),
    ],
    ["proxy", () => new Proxy({}, {})],
    [
      "non-enumerable",
      () =>
        Object.defineProperty({}, "evolutionCompositionFactory", {
          value: async () => ({}),
        }),
    ],
  ])(
    "denies authenticated Agent dependencies with a %s factory",
    async (_kind, createDependencies) => {
      const fixture = signedFixture(["agent"]);
      const dependencies = await loadEvolutionDeploymentCommandDependencies(
        "agent",
        {
          ...fixture,
          importModule: async () => ({
            createChainlessChainCommandDependencies: async () =>
              createDependencies(),
          }),
        },
      );
      await expectDenied(
        dependencies,
        "EVOLUTION_DEPLOYMENT_INVALID_DEPENDENCIES",
      );
    },
  );
});

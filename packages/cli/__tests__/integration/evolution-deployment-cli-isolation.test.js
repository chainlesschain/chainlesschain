import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest as digest,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";
import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOCATIONS_SCHEMA,
  serializeEvolutionDeploymentDescriptorRevocationsPayload,
} from "../../src/lib/evolution/evolution-deployment-descriptor-revocations.js";

const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function createFixture({ throwAtImport = true } = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-deployment-cli-isolation-"),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const marker = path.join(root, "host-executed.txt");
  const modulePath = path.join(root, "host.mjs");
  const descriptorPath = path.join(root, "descriptor.json");
  const trustRootPath = path.join(root, "public.pem");
  const revocationPath = path.join(root, "revocations.json");
  const moduleBytes = Buffer.from(
    [
      'import { appendFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(marker)}, "import\\n");`,
      ...(throwAtImport
        ? ['throw new Error("SIGNED_HOST_IMPORT_SENTINEL");']
        : []),
      "export async function createChainlessChainCommandDependencies({ commandName }) {",
      `  appendFileSync(${JSON.stringify(marker)}, "factory:" + commandName + "\\n");`,
      '  throw new Error("SIGNED_HOST_FACTORY_SENTINEL");',
      "}",
    ].join("\n"),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRoot = publicKey.export({ type: "spki", format: "pem" });
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: 1,
    modulePath,
    moduleDigest: digest(moduleBytes),
    trustRootDigest: digest(trustRoot),
    commands: ["evolution", "ask", "agent"],
  };
  descriptor.signature = sign(
    null,
    Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
    privateKey,
  ).toString("base64");
  const revocations = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOCATIONS_SCHEMA,
    revision: 1,
    trustRootDigest: digest(trustRoot),
    revokedDescriptorRevisions: [1],
  };
  revocations.signature = sign(
    null,
    Buffer.from(
      serializeEvolutionDeploymentDescriptorRevocationsPayload(revocations),
    ),
    privateKey,
  ).toString("base64");
  fs.writeFileSync(modulePath, moduleBytes);
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor));
  fs.writeFileSync(trustRootPath, trustRoot);
  fs.writeFileSync(revocationPath, JSON.stringify(revocations));
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    CHAINLESSCHAIN_HOME: path.join(root, "cli-state"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security-anchor"),
    CC_EVENT_RUNTIME_DURABLE: "0",
  };
  // Exercise an ordinary CLI child without the test runner or ambient host.
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("VITEST") ||
      key === "NODE_OPTIONS" ||
      key.startsWith("CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_") ||
      key.startsWith("OTEL_EXPORTER_") ||
      key.endsWith("API_KEY")
    )
      delete env[key];
  }
  return {
    root,
    workspace,
    marker,
    descriptorPath,
    trustRootPath,
    revocationPath,
    env,
  };
}

function selectedEnvironment(fixture) {
  return {
    ...fixture.env,
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: fixture.descriptorPath,
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: fixture.trustRootPath,
  };
}

function invoke(fixture, args, env = fixture.env) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: fixture.workspace,
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.error, result.stderr).toBeUndefined();
  return result;
}

function deployment(fixture, args, env = fixture.env) {
  const result = invoke(
    fixture,
    ["evolution", "deployment", ...args, "--json"],
    env,
  );
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  expect(fs.existsSync(fixture.marker)).toBe(false);
  return JSON.parse(result.stdout);
}

describe("normal CLI deployment configuration does not execute the signed host", () => {
  it("inspects, configures, disables, enables and revokes a host that throws at module scope", () => {
    const fixture = createFixture();
    expect(
      deployment(fixture, ["status"], selectedEnvironment(fixture)),
    ).toMatchObject({
      source: "environment",
      verified: true,
      effectiveEnabled: true,
    });
    const textStatus = invoke(
      fixture,
      ["evolution", "deployment", "status"],
      selectedEnvironment(fixture),
    );
    expect(textStatus.status, textStatus.stderr).toBe(0);
    expect(textStatus.stdout).toContain("ask admission: admitted");
    expect(textStatus.stdout).toContain("agent admission: admitted");
    expect(textStatus.stdout).toContain(
      "not checked (host composition and model execution)",
    );
    expect(fs.existsSync(fixture.marker)).toBe(false);
    expect(
      deployment(
        fixture,
        [
          "configure",
          "--descriptor",
          fixture.descriptorPath,
          "--trust-root",
          fixture.trustRootPath,
        ],
        selectedEnvironment(fixture),
      ),
    ).toMatchObject({ verified: true, profileEnabled: true });
    expect(deployment(fixture, ["status"])).toMatchObject({
      source: "profile",
      verified: true,
    });
    expect(deployment(fixture, ["disable"])).toMatchObject({
      effectiveEnabled: false,
      profileEnabled: false,
    });
    expect(deployment(fixture, ["status"])).toMatchObject({
      source: "none",
      verified: false,
    });
    expect(deployment(fixture, ["enable"])).toMatchObject({
      source: "profile",
      verified: true,
    });
    expect(
      deployment(fixture, [
        "revoke",
        "--descriptor-revocations",
        fixture.revocationPath,
      ]),
    ).toMatchObject({
      effectiveEnabled: false,
      profileEnabled: false,
    });
    expect(deployment(fixture, ["enable"])).toMatchObject({
      verified: false,
      error: expect.stringMatching(/revoked/i),
    });
  }, 120_000);

  it.each(["ask", "agent"])(
    "still executes the configured factory for a real %s invocation",
    (command) => {
      const fixture = createFixture({ throwAtImport: false });
      const env = selectedEnvironment(fixture);
      expect(deployment(fixture, ["status"], env)).toMatchObject({
        verified: true,
      });
      const args =
        command === "ask"
          ? ["ask", "diagnostic boundary", "--provider", "ollama"]
          : [
              "agent",
              "--print",
              "diagnostic boundary",
              "--max-turns",
              "1",
              "--ephemeral",
            ];
      const result = invoke(fixture, args, env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SIGNED_HOST_FACTORY_SENTINEL");
      expect(fs.readFileSync(fixture.marker, "utf8")).toBe(
        `import\nfactory:${command}\n`,
      );
    },
  );
});

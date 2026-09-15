import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  configureEvolutionDeployment,
  getEvolutionDeploymentStatus,
} from "./evolution-deployment-config.js";
import {
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  computeEvolutionDeploymentDigest,
  serializeEvolutionDeploymentDescriptorPayload,
  verifyEvolutionDeployment,
} from "./evolution-deployment-loader.js";
import {
  getEvolutionDeploymentProfilePath,
  readEvolutionDeploymentProfile,
} from "./evolution-deployment-profile.js";
import {
  EVOLUTION_DEPLOYMENT_ROOT_ROTATION_SCHEMA,
  serializeEvolutionDeploymentRootRotationPayload,
} from "./evolution-deployment-root-rotation.js";
import {
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "../secure-fs.js";

export const EVOLUTION_TEST_DEPLOYMENT_COMMANDS = Object.freeze([
  "agent",
  "ask",
  "chat",
  "compact",
  "complete",
  "cowork",
  "desktop",
  "evolution",
  "hub",
  "learning",
  "marketplace",
  "orchestrate",
  "serve",
  "skill",
  "stream",
  "ui",
]);

const TEST_PRIVATE_KEY_FILE = "test-signing-private.pem";
const TEST_TRUST_ROOT_FILE = "test-signing-public.pem";
const TEST_DESCRIPTOR_FILE = "test-deployment.json";
const TEST_README_FILE = "README-TEST-ONLY.txt";
const MAX_MODULE_BYTES = 4 * 1024 * 1024;

function writePrivateAtomic(filePath, value) {
  ensurePrivateDirectory(dirname(filePath));
  const temporaryPath = join(
    dirname(filePath),
    `.${filePath.split(/[\\/]/u).at(-1)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, value, {
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
    ensurePrivateFile(temporaryPath);
    renameSync(temporaryPath, filePath);
    ensurePrivateFile(filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file was not created or has already been renamed.
    }
    throw error;
  }
}

function assertNoEnvironmentOverride(env) {
  if (
    env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR ||
    env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT
  ) {
    throw new Error(
      "test deployment setup requires the Evolution deployment environment overrides to be unset",
    );
  }
}

function normalizeCommands(commands) {
  const value =
    commands === undefined
      ? [...EVOLUTION_TEST_DEPLOYMENT_COMMANDS]
      : typeof commands === "string"
        ? commands
            .split(",")
            .map((command) => command.trim())
            .filter(Boolean)
        : Array.isArray(commands)
          ? [...commands]
          : null;
  if (!value || value.length === 0 || new Set(value).size !== value.length)
    throw new TypeError(
      "test deployment commands must be a non-empty unique list",
    );
  return value.sort();
}

function readRevision(descriptorPath) {
  if (!existsSync(descriptorPath)) return 0;
  try {
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
    if (!Number.isSafeInteger(descriptor.revision) || descriptor.revision < 1)
      throw new Error("revision is invalid");
    return descriptor.revision;
  } catch (error) {
    throw new Error(
      "existing test deployment descriptor cannot be refreshed",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

function assertSigningPair(privateKeyBytes, trustRootBytes) {
  let privateKey;
  let actualPublic;
  let expectedPublic;
  try {
    privateKey = createPrivateKey(privateKeyBytes);
    actualPublic = createPublicKey(privateKey).export({
      type: "spki",
      format: "der",
    });
    expectedPublic = createPublicKey(trustRootBytes).export({
      type: "spki",
      format: "der",
    });
  } catch {
    throw new Error("test deployment signing key pair is invalid");
  }
  if (!Buffer.from(actualPublic).equals(Buffer.from(expectedPublic)))
    throw new Error(
      "test deployment signing key does not match its trust root",
    );
  return privateKey;
}

function freshTestRoot(profilePath) {
  const parent = dirname(profilePath);
  const preferred = join(parent, "test-deployment");
  if (!existsSync(preferred)) return preferred;
  return join(parent, `test-deployment-${randomUUID()}`);
}

function testReadme({ modulePath, descriptorPath, trustRootPath }) {
  return `ChainlessChain Skill evolution development environment / 仅限测试开发

This directory contains an automatically generated Ed25519 TEST key. It is not
a production certificate, HSM/KMS identity, reviewer identity, or production
approval. Automatic active promotion remains HOLD.

本目录包含自动生成的 Ed25519 测试密钥，只用于正式部署前联调。它不属于生产证书、
HSM/KMS 身份或审核身份，也不会解除人工审核和 automatic active promotion HOLD。

Deployment host: ${modulePath}
Signed descriptor: ${descriptorPath}
Test trust root: ${trustRootPath}

Re-run "cc evolution deployment init-test --module <absolute-path>" after the
host module changes. When the managed descriptor and trust root are available,
run "cc evolution deployment replace-test --descriptor <path> --trust-root <path>".

部署宿主模块变更后请重新执行 init-test 刷新摘要和签名。正式 descriptor 与 trust
root 到位后执行 replace-test；CLI 会用测试根签发一次根轮换证明并切换到正式配置。
`;
}

/**
 * Generate or refresh a local-only Ed25519 deployment wrapper for an existing
 * development host. The ordinary descriptor verifier and profile writer remain
 * the only activation path; this helper never bypasses deployment admission.
 */
export async function initializeEvolutionTestDeployment(
  { modulePath, commands, enabled = true },
  options = {},
) {
  const env = options.env || process.env;
  assertNoEnvironmentOverride(env);
  if (typeof modulePath !== "string" || !modulePath.trim())
    throw new TypeError(
      "an absolute test deployment host module path is required",
    );
  const requestedModulePath = modulePath.trim();
  if (!isAbsolute(requestedModulePath))
    throw new TypeError("test deployment host module path must be absolute");
  const realModulePath = await (
    options.resolveRealPath ||
    (async (value) => {
      const { realpath } = await import("node:fs/promises");
      return realpath(value);
    })
  )(requestedModulePath);
  const moduleBytes = readFileSync(realModulePath);
  if (moduleBytes.byteLength === 0 || moduleBytes.byteLength > MAX_MODULE_BYTES)
    throw new Error("test deployment host module size is invalid");

  const saved = await readEvolutionDeploymentProfile(options);
  if (saved.error) throw new Error(saved.error);
  if (saved.profile && saved.profile.deploymentMode !== "test") {
    const error = new Error(
      "a managed Evolution deployment profile already exists; test setup will not replace it",
    );
    error.code = "EVOLUTION_TEST_DEPLOYMENT_MANAGED_PROFILE_EXISTS";
    throw error;
  }

  const testRoot = saved.profile
    ? dirname(saved.profile.descriptorPath)
    : freshTestRoot(
        options.filePath || getEvolutionDeploymentProfilePath(options),
      );
  ensurePrivateDirectory(testRoot);
  const privateKeyPath = join(testRoot, TEST_PRIVATE_KEY_FILE);
  const trustRootPath = join(testRoot, TEST_TRUST_ROOT_FILE);
  const descriptorPath = join(testRoot, TEST_DESCRIPTOR_FILE);
  let privateKeyBytes;
  let trustRootBytes;
  let generated = false;
  if (saved.profile) {
    if (
      resolve(saved.profile.descriptorPath) !== resolve(descriptorPath) ||
      resolve(saved.profile.trustRootPath) !== resolve(trustRootPath) ||
      resolve(saved.profile.testPrivateKeyPath) !== resolve(privateKeyPath)
    ) {
      throw new Error("saved test deployment paths are inconsistent");
    }
    ensurePrivateFile(privateKeyPath);
    ensurePrivateFile(trustRootPath);
    privateKeyBytes = readFileSync(privateKeyPath);
    trustRootBytes = readFileSync(trustRootPath);
  } else {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    privateKeyBytes = privateKey.export({ type: "pkcs8", format: "pem" });
    trustRootBytes = publicKey.export({ type: "spki", format: "pem" });
    writePrivateAtomic(privateKeyPath, privateKeyBytes);
    writePrivateAtomic(trustRootPath, trustRootBytes);
    generated = true;
  }
  const privateKey = assertSigningPair(privateKeyBytes, trustRootBytes);
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: readRevision(descriptorPath) + 1,
    modulePath: realModulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: computeEvolutionDeploymentDigest(trustRootBytes),
    commands: normalizeCommands(commands),
  };
  descriptor.signature = signBytes(
    null,
    Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
    privateKey,
  ).toString("base64");
  writePrivateAtomic(
    descriptorPath,
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  writePrivateAtomic(
    join(testRoot, TEST_README_FILE),
    testReadme({ modulePath: realModulePath, descriptorPath, trustRootPath }),
  );

  const status = await configureEvolutionDeployment(
    {
      descriptorPath,
      trustRootPath,
      enabled,
      deploymentMode: "test",
      testPrivateKeyPath: privateKeyPath,
    },
    options,
  );
  return Object.freeze({
    ...status,
    generated,
    testRootPath: testRoot,
    warning:
      "TEST ONLY: local development credentials; automatic active promotion remains HOLD",
  });
}

/** Replace an active generated test root with an operator-signed deployment. */
export async function replaceEvolutionTestDeployment(
  { descriptorPath, trustRootPath },
  options = {},
) {
  const env = options.env || process.env;
  assertNoEnvironmentOverride(env);
  const saved = await readEvolutionDeploymentProfile(options);
  if (saved.error) throw new Error(saved.error);
  if (saved.profile?.deploymentMode !== "test") {
    const error = new Error(
      "the saved Evolution deployment is not a generated test deployment",
    );
    error.code = "EVOLUTION_TEST_DEPLOYMENT_NOT_ACTIVE";
    throw error;
  }
  const currentStatus = await getEvolutionDeploymentStatus(options);
  if (!currentStatus.verified)
    throw new Error(
      `the generated test deployment must verify before replacement${currentStatus.error ? `: ${currentStatus.error}` : ""}`,
    );
  const destination = await verifyEvolutionDeployment(
    { descriptorPath, trustRootPath },
    options,
  );
  ensurePrivateFile(saved.profile.testPrivateKeyPath);
  ensurePrivateFile(saved.profile.trustRootPath);
  const privateKeyBytes = readFileSync(saved.profile.testPrivateKeyPath);
  const fromTrustRootBytes = readFileSync(saved.profile.trustRootPath);
  const privateKey = assertSigningPair(privateKeyBytes, fromTrustRootBytes);
  const rotation = {
    schema: EVOLUTION_DEPLOYMENT_ROOT_ROTATION_SCHEMA,
    fromTrustRootDigest: saved.profile.activeTrustRootDigest,
    toTrustRootDigest: destination.descriptor.trustRootDigest,
    minimumDescriptorRevision: destination.descriptor.revision,
  };
  rotation.signature = signBytes(
    null,
    Buffer.from(serializeEvolutionDeploymentRootRotationPayload(rotation)),
    privateKey,
  ).toString("base64");
  const rotationPath = join(
    dirname(saved.profile.descriptorPath),
    "managed-root-rotation.json",
  );
  writePrivateAtomic(rotationPath, `${JSON.stringify(rotation, null, 2)}\n`);
  const status = await configureEvolutionDeployment(
    {
      descriptorPath,
      trustRootPath,
      rootRotationPath: rotationPath,
      enabled: true,
      deploymentMode: "managed",
      testPrivateKeyPath: null,
    },
    options,
  );
  return Object.freeze({
    ...status,
    replacedTestDeployment: true,
    rootRotationPath: rotationPath,
  });
}

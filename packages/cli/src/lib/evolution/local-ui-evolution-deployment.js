import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  randomBytes,
  randomUUID,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  repairPrivatePaths,
} from "../secure-fs.js";
import {
  ensureDirectoryTreeDurable,
  createLocalUiEvolutionFileSystem,
  flushWindowsLocalNtfsDirectory,
} from "./evolution-windows-directory-durability.js";
import { withFileLockAsync } from "../with-file-lock.js";
import { formatOpaqueHexId } from "./opaque-hex-id.js";
import {
  configureEvolutionDeployment,
  getEvolutionDeploymentStatus,
} from "./evolution-deployment-config.js";
import {
  computeEvolutionDeploymentDigest,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  serializeEvolutionDeploymentDescriptorPayload,
  verifyEvolutionDeployment,
} from "./evolution-deployment-loader.js";
import {
  assertEvolutionDeploymentActiveTrustRoot,
  assertEvolutionDeploymentDescriptorNotRevoked,
  assertEvolutionDeploymentRevisionFloor,
  readEvolutionDeploymentProfile,
} from "./evolution-deployment-profile.js";

export const LOCAL_UI_EVOLUTION_SCHEMA =
  "chainlesschain.local-ui-evolution-host/v1";
const LOCAL_UI_BOOTSTRAP_STATE_SCHEMA =
  "chainlesschain.local-ui-evolution-bootstrap-state/v1";
export const LOCAL_EVOLUTION_COMMANDS = Object.freeze([
  "agent",
  "ask",
  "chat",
  "ui",
]);
const LEGACY_UI_HOST_DIGESTS = new Set([
  "sha256:1bf2aa3c68ff65eaf42423e28e0ba17d4cb1393c3bf7358eb901cff454e7abec",
  "sha256:fbf9cab066ee700e7881b5e0bceab58f175c19ee1806dd2126e7217d48991efd",
]);

function identityFiles(generation = 1) {
  if (![1, 2].includes(generation))
    throw new Error("Invalid local host generation");
  const suffix = generation === 1 ? "" : "-v2";
  return {
    descriptor: `deployment${suffix}.json`,
    module: `ui-host${suffix}.mjs`,
    manifest: `local-host-manifest${suffix}.json`,
    state: `local-ui-host${suffix}.state.json`,
  };
}

function profileGeneration(profile) {
  const name = path.basename(profile.descriptorPath);
  if (name === "deployment.json") return 1;
  if (name === "deployment-v2.json") return 2;
  throw new Error("Local Evolution profile has an unknown identity generation");
}

const LOCAL_UI_HOST_MODULE_PATH = fileURLToPath(
  new URL("./local-ui-evolution-host.mjs", import.meta.url),
);
const SIGNING_KEY_NAMES = Object.freeze([
  "deployment-root",
  "artifact",
  "ledger",
  "witness",
  "attestation",
  "source",
]);
const SECRET_KEY_NAMES = Object.freeze(["commitment", "raw-encryption"]);
const localWindowsAclSnapshots = new Map();
const deploymentFileSystem = createLocalUiEvolutionFileSystem();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function privateDirectory(directory) {
  ensureDirectoryTreeDurable(deploymentFileSystem, directory);
  ensurePrivateDirectory(directory, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  if (process.platform === "win32") {
    flushWindowsLocalNtfsDirectory(path.dirname(directory));
    flushWindowsLocalNtfsDirectory(directory);
  }
}

function flushDeploymentDirectory(directory) {
  if (process.platform === "win32") {
    return flushWindowsLocalNtfsDirectory(directory);
  }
  return null;
}

function writePrivateFile(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        Number(fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    ensurePrivateFile(temporaryPath, {
      applyWindowsAcl: false,
      failIfUnavailable: true,
    });
    fs.renameSync(temporaryPath, filePath);
    ensurePrivateFile(filePath, {
      applyWindowsAcl: false,
      failIfUnavailable: true,
    });
    flushDeploymentDirectory(directory);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

function readPrivateFile(filePath) {
  ensurePrivateFile(filePath, {
    applyWindowsAcl: false,
    failIfUnavailable: true,
  });
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error("Local Evolution key file is not a private regular file");
  }
  return fs.readFileSync(filePath, "utf8");
}

function keyPaths(directory) {
  const keysDirectory = path.join(directory, "keys");
  return Object.freeze({
    keysDirectory,
    signing: Object.freeze(
      Object.fromEntries(
        SIGNING_KEY_NAMES.map((name) => [
          name,
          path.join(keysDirectory, `${name}.private.pem`),
        ]),
      ),
    ),
    secrets: Object.freeze(
      Object.fromEntries(
        SECRET_KEY_NAMES.map((name) => [
          name,
          path.join(keysDirectory, `${name}.secret`),
        ]),
      ),
    ),
  });
}

function generateKeyPairPem() {
  const pair = generateKeyPairSync("ed25519");
  return Object.freeze({
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
  });
}

function writeKeys(directory) {
  const paths = keyPaths(directory);
  privateDirectory(paths.keysDirectory);
  const keys = Object.create(null);
  for (const name of SIGNING_KEY_NAMES) {
    const pair = generateKeyPairPem();
    keys[name] = pair;
    writePrivateFile(paths.signing[name], pair.privateKey);
  }
  for (const name of SECRET_KEY_NAMES) {
    const secret = randomBytes(32);
    keys[name] = secret;
    writePrivateFile(paths.secrets[name], secret.toString("base64"));
  }
  return Object.freeze({ paths, keys });
}

function readKeys(directory) {
  const paths = keyPaths(directory);
  const keys = Object.create(null);
  for (const name of SIGNING_KEY_NAMES) {
    const privateKey = readPrivateFile(paths.signing[name]);
    const publicKey = createPublicKey(createPrivateKey(privateKey)).export({
      type: "spki",
      format: "pem",
    });
    keys[name] = Object.freeze({ privateKey, publicKey });
  }
  for (const name of SECRET_KEY_NAMES) {
    const raw = Buffer.from(
      readPrivateFile(paths.secrets[name]).trim(),
      "base64",
    );
    if (raw.length !== 32)
      throw new Error("Local Evolution secret key is invalid");
    keys[name] = raw;
  }
  return Object.freeze({ paths, keys: Object.freeze(keys) });
}

function keyBindings(keys) {
  return Object.freeze({
    signing: Object.freeze(
      Object.fromEntries(
        SIGNING_KEY_NAMES.map((name) => [
          name,
          computeEvolutionDeploymentDigest(
            Buffer.from(keys[name].publicKey, "utf8"),
          ),
        ]),
      ),
    ),
    secrets: Object.freeze(
      Object.fromEntries(
        SECRET_KEY_NAMES.map((name) => [
          name,
          computeEvolutionDeploymentDigest(keys[name]),
        ]),
      ),
    ),
  });
}

function signedValue(privateKeyPem, value) {
  return sign(
    null,
    Buffer.from(canonical(value), "utf8"),
    privateKeyPem,
  ).toString("base64url");
}

function verifySignedValue(publicKeyPem, value, signature) {
  return (
    typeof signature === "string" &&
    verify(
      null,
      Buffer.from(canonical(value), "utf8"),
      publicKeyPem,
      Buffer.from(signature, "base64url"),
    )
  );
}

function pathSnapshot(paths) {
  return paths.map((filePath) => {
    const stat = fs.lstatSync(filePath);
    return [
      path.resolve(filePath),
      stat.dev,
      stat.ino,
      stat.nlink,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ];
  });
}

function secureLocalPaths(paths) {
  const root = path.resolve(paths[0]);
  if (process.platform === "win32") {
    const previous = localWindowsAclSnapshots.get(root);
    if (previous) {
      try {
        const current = pathSnapshot(paths);
        if (JSON.stringify(current) === JSON.stringify(previous)) return;
      } catch {
        // A missing/replaced path must pass through the full safe repair.
      }
    }
  }
  repairPrivatePaths(paths);
  if (process.platform === "win32") {
    localWindowsAclSnapshots.set(root, pathSnapshot(paths));
  }
}

function bootstrapStatePath(profilePath, generation = 1) {
  return path.join(path.dirname(profilePath), identityFiles(generation).state);
}

function bootstrapStateValue(deployment, phase) {
  const core = {
    schema: LOCAL_UI_BOOTSTRAP_STATE_SCHEMA,
    phase,
    tenantId: deployment.tenantId,
    moduleDigest: deployment.moduleDigest,
    trustRootDigest: deployment.descriptor.trustRootDigest,
  };
  return {
    ...core,
    signature: signedValue(deployment.keys["deployment-root"].privateKey, core),
  };
}

function writeBootstrapState(profilePath, deployment, phase) {
  writePrivateFile(
    bootstrapStatePath(profilePath, deployment.generation || 1),
    `${JSON.stringify(bootstrapStateValue(deployment, phase), null, 2)}\n`,
  );
}

function writeDeployment(
  directory,
  finalDirectory,
  tenantId,
  { identity = null, generation = 1 } = {},
) {
  const { keys } = identity || writeKeys(directory);
  const names = identityFiles(generation);
  const publicRoot = keys["deployment-root"].publicKey;
  const publicRootPath = path.join(finalDirectory, "deployment-public.pem");
  const descriptorPath = path.join(finalDirectory, names.descriptor);
  const modulePath = path.join(finalDirectory, names.module);
  const moduleBytes = fs.readFileSync(LOCAL_UI_HOST_MODULE_PATH);
  writePrivateFile(path.join(directory, names.module), moduleBytes);
  const descriptor = {
    schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
    revision: identity ? identity.descriptor.revision + 1 : 1,
    modulePath,
    moduleDigest: computeEvolutionDeploymentDigest(moduleBytes),
    trustRootDigest: computeEvolutionDeploymentDigest(publicRoot),
    commands: [...LOCAL_EVOLUTION_COMMANDS],
  };
  descriptor.signature = sign(
    null,
    Buffer.from(
      serializeEvolutionDeploymentDescriptorPayload(descriptor),
      "utf8",
    ),
    keys["deployment-root"].privateKey,
  ).toString("base64");

  if (!identity)
    writePrivateFile(path.join(directory, "deployment-public.pem"), publicRoot);
  writePrivateFile(
    path.join(directory, names.descriptor),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  const core = {
    schema: LOCAL_UI_EVOLUTION_SCHEMA,
    tenantId,
    modulePath,
    moduleDigest: descriptor.moduleDigest,
    trustRootDigest: descriptor.trustRootDigest,
    keyBindings: keyBindings(keys),
    descriptorDigest: computeEvolutionDeploymentDigest(
      Buffer.from(JSON.stringify(descriptor, null, 2) + "\n", "utf8"),
    ),
  };
  const manifest = {
    ...core,
    signature: signedValue(keys["deployment-root"].privateKey, core),
  };
  writePrivateFile(
    path.join(directory, names.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const deployment = Object.freeze({
    descriptorPath,
    generation,
    trustRootPath: publicRootPath,
    tenantId,
    moduleDigest: descriptor.moduleDigest,
    descriptor,
    keys,
  });
  writeBootstrapState(
    path.join(path.dirname(finalDirectory), "deployment-profile.json"),
    deployment,
    "prepared",
  );
  return deployment;
}

async function verifyLocalDeployment(
  directory,
  expectedDirectory,
  { repairPermissions = true, generation = 1 } = {},
) {
  const names = identityFiles(generation);
  const descriptorPath = path.join(directory, names.descriptor);
  const trustRootPath = path.join(directory, "deployment-public.pem");
  const manifestPath = path.join(directory, names.manifest);
  const paths = keyPaths(directory);
  const modulePath = path.join(expectedDirectory, names.module);
  const storedModulePath = path.join(directory, names.module);
  const statePath = bootstrapStatePath(
    path.join(path.dirname(expectedDirectory), "deployment-profile.json"),
    generation,
  );
  const protectedPaths = [
    directory,
    paths.keysDirectory,
    ...Object.values(paths.signing),
    ...Object.values(paths.secrets),
    trustRootPath,
    descriptorPath,
    manifestPath,
    storedModulePath,
    ...(fs.existsSync(statePath) ? [statePath] : []),
  ];
  if (repairPermissions) {
    secureLocalPaths(protectedPaths);
  }
  const rootPublic = readPrivateFile(trustRootPath);
  const rootPrivate = readPrivateFile(paths.signing["deployment-root"]);
  const keyChallenge = randomBytes(32);
  if (
    !verify(
      null,
      keyChallenge,
      rootPublic,
      sign(null, keyChallenge, rootPrivate),
    )
  ) {
    throw new Error(
      "Local Evolution root signing key does not match its trust root",
    );
  }
  const manifest = JSON.parse(readPrivateFile(manifestPath));
  const { signature, ...core } = manifest;
  if (
    manifest.schema !== LOCAL_UI_EVOLUTION_SCHEMA ||
    typeof manifest.tenantId !== "string" ||
    !manifest.tenantId.startsWith("local-ui-") ||
    !verifySignedValue(rootPublic, core, signature)
  ) {
    throw new Error("Local Evolution host manifest signature is invalid");
  }
  const descriptorBytes = Buffer.from(readPrivateFile(descriptorPath), "utf8");
  const verified = await verifyEvolutionDeployment(
    { descriptorPath, trustRootPath },
    {
      resolveRealPath: async (candidate) =>
        path.resolve(candidate) === path.resolve(modulePath)
          ? modulePath
          : fs.promises.realpath(candidate),
      read: async (candidate) =>
        path.resolve(candidate) === path.resolve(modulePath)
          ? fs.promises.readFile(storedModulePath)
          : fs.promises.readFile(candidate),
    },
  );
  const descriptor = verified.descriptor;
  const moduleDigest = computeEvolutionDeploymentDigest(
    fs.readFileSync(storedModulePath),
  );
  const loadedKeys = readKeys(directory);
  let bootstrapPhase = null;
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(readPrivateFile(statePath));
    const { signature: stateSignature, ...stateCore } = state;
    if (
      state.schema !== LOCAL_UI_BOOTSTRAP_STATE_SCHEMA ||
      !["prepared", "active"].includes(state.phase) ||
      state.tenantId !== manifest.tenantId ||
      state.moduleDigest !== moduleDigest ||
      state.trustRootDigest !== descriptor.trustRootDigest ||
      !verifySignedValue(rootPublic, stateCore, stateSignature)
    ) {
      throw new Error("Local Evolution bootstrap state signature is invalid");
    }
    bootstrapPhase = state.phase;
  }
  const isStagedAtExpectedSibling =
    path.basename(directory) === "local-ui-host.init" &&
    path.dirname(path.resolve(directory)) ===
      path.dirname(path.resolve(expectedDirectory));
  if (
    (path.resolve(expectedDirectory) !== path.resolve(directory) &&
      !isStagedAtExpectedSibling) ||
    manifest.modulePath !== modulePath ||
    manifest.moduleDigest !== moduleDigest ||
    manifest.trustRootDigest !== descriptor.trustRootDigest ||
    canonical(manifest.keyBindings) !==
      canonical(keyBindings(loadedKeys.keys)) ||
    manifest.descriptorDigest !==
      computeEvolutionDeploymentDigest(descriptorBytes) ||
    descriptor.modulePath !== modulePath ||
    descriptor.moduleDigest !== moduleDigest ||
    !(
      canonical(descriptor.commands) === canonical(LOCAL_EVOLUTION_COMMANDS) ||
      (generation === 1 && canonical(descriptor.commands) === '["ui"]')
    )
  ) {
    throw new Error(
      "Local Evolution host files do not match their signed identity",
    );
  }
  return Object.freeze({
    descriptorPath,
    generation,
    trustRootPath,
    tenantId: manifest.tenantId,
    descriptor,
    moduleDigest,
    bootstrapPhase,
    keys: loadedKeys.keys,
  });
}

function localDirectory(profilePath) {
  return path.join(path.dirname(profilePath), "local-ui-host");
}

function hasDeploymentOverrides(env) {
  return Boolean(
    env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR ||
      env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT,
  );
}

function removeIncompleteStage(stagePath, expectedParent) {
  if (!fs.existsSync(stagePath)) return;
  const resolvedStage = path.resolve(stagePath);
  const resolvedParent = path.resolve(expectedParent);
  if (
    path.dirname(resolvedStage) !== resolvedParent ||
    path.basename(resolvedStage) !== "local-ui-host.init"
  ) {
    throw new Error("Local Evolution initialization path is unsafe");
  }
  const info = fs.lstatSync(resolvedStage);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Local Evolution initialization state is unsafe");
  }
  fs.rmSync(resolvedStage, { recursive: true, force: true });
  flushDeploymentDirectory(resolvedParent);
}

/** Initialize a local model host or upgrade an authenticated built-in UI host. */
export async function initializeDefaultLocalUiEvolutionDeployment(
  options = {},
) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  if (hasDeploymentOverrides(env)) return null;
  const profileResult = await readEvolutionDeploymentProfile({ env, cwd });
  if (profileResult.error) throw new Error(profileResult.error);
  if (profileResult.profile) {
    if (profileResult.profile.deploymentMode !== "local") return null;
    if (!profileResult.profile.enabled) return null;
  }

  const profilePath = profileResult.filePath;
  const parent = path.dirname(profilePath);
  const destination = localDirectory(profilePath);
  const stagePath = path.join(parent, "local-ui-host.init");
  const statePath = bootstrapStatePath(profilePath);
  privateDirectory(parent);
  return withFileLockAsync(
    `${profilePath}.local-init`,
    async () => {
      const latest = await readEvolutionDeploymentProfile({ env, cwd });
      if (latest.error) throw new Error(latest.error);
      if (latest.profile) {
        if (
          latest.profile.deploymentMode !== "local" ||
          !latest.profile.enabled
        )
          return null;
        let current = await loadLocalUiEvolutionDeployment(destination, {
          env,
          cwd,
        });
        if (canonical(current.descriptor.commands) === '["ui"]') {
          // Only migrate the authenticated, built-in UI-only host. Retain its
          // keys, state and all old identity files until the profile CAS commits.
          if (!LEGACY_UI_HOST_DIGESTS.has(current.moduleDigest))
            throw new Error(
              "Local Evolution UI host is not a supported built-in version",
            );
          writeDeployment(destination, destination, current.tenantId, {
            identity: current,
            generation: 2,
          });
          const upgraded = await verifyLocalDeployment(
            destination,
            destination,
            { generation: 2 },
          );
          await configureEvolutionDeployment(
            {
              descriptorPath: upgraded.descriptorPath,
              trustRootPath: upgraded.trustRootPath,
              deploymentMode: "local",
              enabled: true,
            },
            { env, cwd, expectedProfile: latest.profile },
          );
          writeBootstrapState(profilePath, upgraded, "active");
          current = await loadLocalUiEvolutionDeployment(destination, {
            env,
            cwd,
          });
        }
        return Object.freeze({
          status: await getEvolutionDeploymentStatus({ env, cwd }),
          deployment: current,
        });
      }

      let deployment = null;
      if (fs.existsSync(destination)) {
        deployment = await verifyLocalDeployment(destination, destination);
        if (deployment.bootstrapPhase !== "prepared") return null;
      } else if (fs.existsSync(statePath)) {
        if (!fs.existsSync(stagePath)) return null;
        deployment = await verifyLocalDeployment(stagePath, destination, {
          repairPermissions: false,
        });
        if (deployment.bootstrapPhase !== "prepared") return null;
        fs.renameSync(stagePath, destination);
        flushDeploymentDirectory(parent);
        deployment = await verifyLocalDeployment(destination, destination);
      } else {
        removeIncompleteStage(stagePath, parent);
        fs.mkdirSync(stagePath, { mode: 0o700 });
        privateDirectory(stagePath);
        const tenantId = `local-ui-${formatOpaqueHexId(
          randomUUID().replaceAll("-", ""),
        )}`;
        const paths = writeDeployment(stagePath, destination, tenantId);
        deployment = await verifyLocalDeployment(stagePath, destination, {
          repairPermissions: false,
        });
        fs.renameSync(stagePath, destination);
        flushDeploymentDirectory(parent);
        deployment = await verifyLocalDeployment(destination, destination);
        if (
          deployment.descriptorPath !== paths.descriptorPath ||
          deployment.trustRootPath !== paths.trustRootPath
        ) {
          throw new Error(
            "Local Evolution deployment paths changed during initialization",
          );
        }
      }
      if (deployment.bootstrapPhase !== "prepared") return null;

      let status;
      try {
        status = await configureEvolutionDeployment(
          {
            descriptorPath: deployment.descriptorPath,
            trustRootPath: deployment.trustRootPath,
            deploymentMode: "local",
            enabled: true,
          },
          { env, cwd, expectedProfileAbsent: true },
        );
        flushDeploymentDirectory(parent);
      } catch (error) {
        if (error?.code === "EVOLUTION_DEPLOYMENT_PROFILE_ALREADY_CONFIGURED") {
          return null;
        }
        throw error;
      }
      writeBootstrapState(profilePath, deployment, "active");
      return Object.freeze({ status, deployment });
    },
    {
      failIfUnavailable: true,
      timeoutMs: 180_000,
      retryMs: 50,
      maxRetryMs: 250,
      retryJitterMs: 25,
    },
  );
}

/** Reverify the enabled profile and its signed local identity without mutation. */
export async function loadLocalUiEvolutionDeployment(
  directory,
  { env = process.env, cwd = process.cwd() } = {},
) {
  const saved = await readEvolutionDeploymentProfile({ env, cwd });
  if (saved.error || !saved.profile) {
    throw new Error(saved.error || "Local Evolution profile is unavailable");
  }
  if (saved.profile.deploymentMode !== "local" || !saved.profile.enabled) {
    throw new Error("Local Evolution profile is not enabled");
  }
  const expectedDirectory = localDirectory(saved.filePath);
  if (path.resolve(directory) !== path.resolve(expectedDirectory)) {
    throw new Error("Local Evolution profile points to another host directory");
  }
  const deployment = await verifyLocalDeployment(directory, expectedDirectory, {
    generation: profileGeneration(saved.profile),
  });
  const [
    profileDescriptorPath,
    profileTrustRootPath,
    deploymentDescriptorPath,
    deploymentTrustRootPath,
  ] = await Promise.all([
    fs.promises.realpath(saved.profile.descriptorPath),
    fs.promises.realpath(saved.profile.trustRootPath),
    fs.promises.realpath(deployment.descriptorPath),
    fs.promises.realpath(deployment.trustRootPath),
  ]);
  if (
    profileDescriptorPath !== deploymentDescriptorPath ||
    profileTrustRootPath !== deploymentTrustRootPath ||
    saved.profile.activeTrustRootDigest !==
      deployment.descriptor.trustRootDigest
  ) {
    throw new Error(
      "Local Evolution profile identity does not match its signed host",
    );
  }
  assertEvolutionDeploymentActiveTrustRoot(
    saved.profile,
    deployment.descriptor,
  );
  assertEvolutionDeploymentDescriptorNotRevoked(
    saved.profile,
    deployment.descriptor,
  );
  assertEvolutionDeploymentRevisionFloor(saved.profile, deployment.descriptor);
  if (deployment.bootstrapPhase !== "active") {
    writeBootstrapState(saved.filePath, deployment, "active");
  }
  return deployment;
}

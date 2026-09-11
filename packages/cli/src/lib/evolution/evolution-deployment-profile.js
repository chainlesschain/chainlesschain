import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { resolveConfigDataRoot } from "../paths.js";
import {
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";

export const EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA =
  "chainlesschain.evolution-deployment-profile/v4";

const LEGACY_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA =
  "chainlesschain.evolution-deployment-profile/v1";
const PREVIOUS_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA =
  "chainlesschain.evolution-deployment-profile/v2";
const PRIOR_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA =
  "chainlesschain.evolution-deployment-profile/v3";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_TRUST_ROOT_REVISION_FLOORS = 64;

export function getEvolutionDeploymentProfilePath({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  return join(
    resolveConfigDataRoot({ env, cwd }).path,
    "evolution",
    "deployment-profile.json",
  );
}

function normalizeProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("evolution deployment profile must be an object");
  const keys = Object.keys(value).sort();
  const legacy = [
    LEGACY_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA,
    PREVIOUS_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA,
    PRIOR_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA,
  ].includes(value.schema);
  const expected =
    value.schema === LEGACY_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA
      ? ["descriptorPath", "enabled", "schema", "trustRootPath"]
      : value.schema === PREVIOUS_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA
        ? [
            "descriptorPath",
            "enabled",
            "revisionFloors",
            "schema",
            "trustRootPath",
          ]
      : value.schema === PRIOR_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA
        ? [
            "activeTrustRootDigest",
            "descriptorPath",
            "enabled",
            "revisionFloors",
            "schema",
            "trustRootPath",
          ]
        : [
            "activeTrustRootDigest",
            "descriptorPath",
            "enabled",
            "revisionFloors",
            "revokedDescriptorRevisions",
            "schema",
            "trustRootPath",
          ];
  if (JSON.stringify(keys) !== JSON.stringify(expected.sort()))
    throw new TypeError("evolution deployment profile has unexpected fields");
  if (
    value.schema !== EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA &&
    value.schema !== LEGACY_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA &&
    value.schema !== PREVIOUS_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA &&
    value.schema !== PRIOR_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA
  )
    throw new TypeError("evolution deployment profile schema is invalid");
  if (typeof value.enabled !== "boolean")
    throw new TypeError("evolution deployment profile enabled is invalid");
  for (const [name, path] of [
    ["descriptorPath", value.descriptorPath],
    ["trustRootPath", value.trustRootPath],
  ]) {
    if (typeof path !== "string" || !isAbsolute(path))
      throw new TypeError(
        `evolution deployment profile ${name} must be absolute`,
      );
  }
  const revisionFloors =
    value.schema === LEGACY_EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA
      ? {}
      : normalizeRevisionFloors(value.revisionFloors);
  const activeTrustRootDigest = legacy
    ? null
    : normalizeTrustRootDigest(value.activeTrustRootDigest);
  const revokedDescriptorRevisions =
    value.schema === EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA
      ? normalizeRevokedDescriptorRevisions(value.revokedDescriptorRevisions)
      : {};
  return Object.freeze({
    schema: EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA,
    enabled: value.enabled,
    descriptorPath: value.descriptorPath,
    trustRootPath: value.trustRootPath,
    revisionFloors,
    activeTrustRootDigest,
    revokedDescriptorRevisions,
  });
}

function normalizeRevokedDescriptorRevisions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(
      "evolution deployment profile revokedDescriptorRevisions is invalid",
    );
  const result = {};
  for (const [trustRootDigest, revisions] of Object.entries(value)) {
    if (!DIGEST.test(trustRootDigest) || !Array.isArray(revisions))
      throw new TypeError(
        "evolution deployment profile revokedDescriptorRevisions is invalid",
      );
    const normalized = [...revisions].sort((left, right) => left - right);
    if (
      normalized.length > 1024 ||
      normalized.some(
        (revision) => !Number.isSafeInteger(revision) || revision < 1,
      ) ||
      new Set(normalized).size !== normalized.length
    ) {
      throw new TypeError(
        "evolution deployment profile revokedDescriptorRevisions is invalid",
      );
    }
    result[trustRootDigest] = Object.freeze(normalized);
  }
  return Object.freeze(result);
}

function normalizeTrustRootDigest(value) {
  if (!DIGEST.test(value || ""))
    throw new TypeError(
      "evolution deployment profile activeTrustRootDigest is invalid",
    );
  return value;
}

function normalizeRevisionFloors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("evolution deployment profile revisionFloors is invalid");
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length > MAX_TRUST_ROOT_REVISION_FLOORS)
    throw new TypeError("evolution deployment profile revisionFloors is too large");
  for (const [trustRootDigest, revision] of entries) {
    if (!DIGEST.test(trustRootDigest))
      throw new TypeError(
        "evolution deployment profile revisionFloors trust root is invalid",
      );
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new TypeError(
        "evolution deployment profile revisionFloors revision is invalid",
      );
  }
  return Object.freeze(Object.fromEntries(entries));
}

function profilePath(options = {}) {
  return options.filePath || getEvolutionDeploymentProfilePath(options);
}

function readProfileSync(filePath) {
  try {
    return {
      profile: normalizeProfile(JSON.parse(readFileSync(filePath, "utf8"))),
      error: null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { profile: null, error: null };
    return {
      profile: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeProfileSync(profile, filePath) {
  ensurePrivateDirectory(dirname(filePath));
  const temporaryPath = join(
    dirname(filePath),
    `.deployment-profile.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`, {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
      flag: "wx",
    });
    ensurePrivateFile(temporaryPath);
    renameSync(temporaryPath, filePath);
    ensurePrivateFile(filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary path either was not created or has already been renamed.
    }
    throw error;
  }
}

function profileFromInput(input) {
  return normalizeProfile({
    schema: EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA,
    enabled: input?.enabled === true,
    descriptorPath: input?.descriptorPath,
    trustRootPath: input?.trustRootPath,
    revisionFloors: input?.revisionFloors || {},
    activeTrustRootDigest: input?.activeTrustRootDigest,
    revokedDescriptorRevisions: input?.revokedDescriptorRevisions || {},
  });
}

export async function readEvolutionDeploymentProfile(options = {}) {
  const filePath = profilePath(options);
  try {
    const profile = normalizeProfile(
      JSON.parse(await readFile(filePath, "utf8")),
    );
    return Object.freeze({ filePath, profile, error: null });
  } catch (error) {
    if (error?.code === "ENOENT")
      return Object.freeze({ filePath, profile: null, error: null });
    return Object.freeze({
      filePath,
      profile: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function writeEvolutionDeploymentProfile(input, options = {}) {
  const proposed = profileFromInput(input);
  return updateEvolutionDeploymentProfile((current) => ({
    ...proposed,
    // This lower-level writer cannot authenticate a descriptor, so it never
    // lowers or erases a floor established by configureEvolutionDeployment().
    revisionFloors: Object.fromEntries(
      Object.keys({
        ...(current?.revisionFloors || {}),
        ...proposed.revisionFloors,
      }).map((trustRootDigest) => [
        trustRootDigest,
        Math.max(
          current?.revisionFloors?.[trustRootDigest] || 0,
          proposed.revisionFloors[trustRootDigest] || 0,
        ),
      ]),
    ),
    activeTrustRootDigest:
      proposed.activeTrustRootDigest || current?.activeTrustRootDigest,
    revokedDescriptorRevisions: {
      ...(current?.revokedDescriptorRevisions || {}),
      ...(proposed.revokedDescriptorRevisions || {}),
    },
  }), options);
}

/**
 * Atomically read, validate and replace the owner-only profile. The callback is
 * synchronous by design: `withFileLock` is a cross-process lock and releasing
 * it while an async callback is pending would reintroduce lost high-water
 * updates.
 */
export function updateEvolutionDeploymentProfile(update, options = {}) {
  if (typeof update !== "function")
    throw new TypeError(
      "evolution deployment profile update must be a function",
    );
  const filePath = profilePath(options);
  ensurePrivateDirectory(dirname(filePath));
  return withFileLock(
    filePath,
    () => {
      const current = readProfileSync(filePath);
      if (current.error) throw new Error(current.error);
      const profile = profileFromInput(update(current.profile));
      writeProfileSync(profile, filePath);
      return Object.freeze({ filePath, profile });
    },
    { failIfUnavailable: true },
  );
}

export function assertEvolutionDeploymentRevisionFloor(profile, descriptor) {
  const floor = profile?.revisionFloors?.[descriptor?.trustRootDigest];
  if (floor === undefined) return null;
  if (
    !Number.isSafeInteger(descriptor?.revision) ||
    descriptor.revision < floor
  ) {
    const error = new Error(
      `evolution deployment descriptor revision rollback rejected: received ${descriptor?.revision}, floor ${floor}`,
    );
    error.code = "EVOLUTION_DEPLOYMENT_REVISION_ROLLBACK";
    throw error;
  }
  return floor;
}

export function assertEvolutionDeploymentActiveTrustRoot(profile, descriptor) {
  const activeTrustRootDigest = profile?.activeTrustRootDigest;
  if (!activeTrustRootDigest) return null;
  if (descriptor?.trustRootDigest !== activeTrustRootDigest) {
    const error = new Error(
      "evolution deployment descriptor trust root does not match the active profile root",
    );
    error.code = "EVOLUTION_DEPLOYMENT_TRUST_ROOT_MISMATCH";
    throw error;
  }
  return activeTrustRootDigest;
}

export function assertEvolutionDeploymentDescriptorNotRevoked(
  profile,
  descriptor,
) {
  const revoked = profile?.revokedDescriptorRevisions?.[
    descriptor?.trustRootDigest
  ];
  if (!revoked?.includes(descriptor?.revision)) return;
  const error = new Error(
    `evolution deployment descriptor revision ${descriptor.revision} is revoked`,
  );
  error.code = "EVOLUTION_DEPLOYMENT_DESCRIPTOR_REVOKED";
  throw error;
}

export async function setEvolutionDeploymentProfileEnabled(
  enabled,
  options = {},
) {
  return updateEvolutionDeploymentProfile((current) => {
    if (!current)
      throw new Error("evolution deployment profile is not configured");
    return { ...current, enabled: enabled === true };
  }, options);
}

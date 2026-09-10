import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { resolveConfigDataRoot } from "../paths.js";
import {
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "../secure-fs.js";

export const EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA =
  "chainlesschain.evolution-deployment-profile/v1";

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
  const expected = ["descriptorPath", "enabled", "schema", "trustRootPath"];
  if (JSON.stringify(keys) !== JSON.stringify(expected.sort()))
    throw new TypeError("evolution deployment profile has unexpected fields");
  if (value.schema !== EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA)
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
  return Object.freeze({
    schema: value.schema,
    enabled: value.enabled,
    descriptorPath: value.descriptorPath,
    trustRootPath: value.trustRootPath,
  });
}

export async function readEvolutionDeploymentProfile(options = {}) {
  const filePath =
    options.filePath || getEvolutionDeploymentProfilePath(options);
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
  const profile = normalizeProfile({
    schema: EVOLUTION_DEPLOYMENT_PROFILE_SCHEMA,
    enabled: input?.enabled === true,
    descriptorPath: input?.descriptorPath,
    trustRootPath: input?.trustRootPath,
  });
  const filePath =
    options.filePath || getEvolutionDeploymentProfilePath(options);
  ensurePrivateDirectory(dirname(filePath));
  const temporaryPath = join(
    dirname(filePath),
    `.deployment-profile.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`, {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
      flag: "wx",
    });
    ensurePrivateFile(temporaryPath);
    await rename(temporaryPath, filePath);
    ensurePrivateFile(filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return Object.freeze({ filePath, profile });
}

export async function setEvolutionDeploymentProfileEnabled(
  enabled,
  options = {},
) {
  const current = await readEvolutionDeploymentProfile(options);
  if (current.error) throw new Error(current.error);
  if (!current.profile)
    throw new Error("evolution deployment profile is not configured");
  return writeEvolutionDeploymentProfile(
    { ...current.profile, enabled: enabled === true },
    { ...options, filePath: current.filePath },
  );
}

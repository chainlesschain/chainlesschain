import {
  readEvolutionDeploymentProfile,
  setEvolutionDeploymentProfileEnabled,
  writeEvolutionDeploymentProfile,
} from "./evolution-deployment-profile.js";
import { verifyEvolutionDeployment } from "./evolution-deployment-loader.js";

function environmentSelection(env) {
  const descriptorPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
  const trustRootPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  if (!descriptorPath && !trustRootPath) return null;
  return { descriptorPath, trustRootPath };
}

export async function getEvolutionDeploymentStatus(options = {}) {
  const env = options.env || process.env;
  const saved = await readEvolutionDeploymentProfile(options);
  const fromEnvironment = environmentSelection(env);
  const source = fromEnvironment
    ? "environment"
    : saved.profile?.enabled
      ? "profile"
      : "none";
  const selected =
    fromEnvironment || (saved.profile?.enabled ? saved.profile : null);
  const base = {
    source,
    effectiveEnabled: source !== "none",
    profileEnabled: saved.profile?.enabled === true,
    profilePath: saved.filePath,
    descriptorPath:
      selected?.descriptorPath || saved.profile?.descriptorPath || null,
    trustRootPath:
      selected?.trustRootPath || saved.profile?.trustRootPath || null,
    verified: false,
    error: saved.error,
    autoPromotion: "hold",
  };
  if (!selected || saved.error) return Object.freeze(base);
  try {
    const verified = await verifyEvolutionDeployment(selected, options);
    return Object.freeze({
      ...base,
      verified: true,
      error: null,
      revision: verified.descriptor.revision,
      modulePath: verified.modulePath,
      moduleDigest: verified.descriptor.moduleDigest,
      commands: verified.descriptor.commands,
    });
  } catch (error) {
    return Object.freeze({
      ...base,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function configureEvolutionDeployment(
  { descriptorPath, trustRootPath, enabled = true },
  options = {},
) {
  const verified = await verifyEvolutionDeployment(
    { descriptorPath, trustRootPath },
    options,
  );
  await writeEvolutionDeploymentProfile(
    {
      enabled: enabled === true,
      descriptorPath: verified.descriptorPath,
      trustRootPath: verified.trustRootPath,
    },
    options,
  );
  return getEvolutionDeploymentStatus(options);
}

export async function setEvolutionDeploymentEnabled(enabled, options = {}) {
  await setEvolutionDeploymentProfileEnabled(enabled, options);
  return getEvolutionDeploymentStatus(options);
}

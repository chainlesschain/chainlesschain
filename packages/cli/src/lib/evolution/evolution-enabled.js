import { loadUserConfig, setConfigValue } from "../config-manager.js";

export function writeEvolutionEnabled(enabled, options = {}) {
  return setConfigValue("evolution.enabled", enabled, {
    ...options,
    resolveSecrets: false,
  });
}

export function readEvolutionEnabled(options = {}) {
  const config = loadUserConfig({ ...options, failIfUnavailable: true });
  const value = config.evolution?.enabled;
  if (value !== undefined && typeof value !== "boolean")
    throw new TypeError("evolution.enabled must be a boolean");
  return value;
}

// External and manually configured deployments remain explicit opt-ins. Old
// automatically created local profiles do not opt a user into self-evolution.
export function resolveEvolutionEnabled(choice, profile, env) {
  if (typeof choice === "boolean") return choice;
  return Boolean(
    env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR ||
      env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT ||
      (profile?.enabled && profile.deploymentMode !== "local"),
  );
}

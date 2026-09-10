import {
  configureEvolutionDeployment,
  getEvolutionDeploymentStatus,
  setEvolutionDeploymentEnabled,
} from "../../lib/evolution/evolution-deployment-config.js";

function assertSecureControl(context) {
  const server = context?.server;
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!server?.token && !loopback.has(server?.host)) {
    throw new Error(
      "Skill evolution configuration requires a token-protected or loopback-only cc ui",
    );
  }
}

function requiredPath(value, name) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\r\n\0]/u.test(value)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function createEvolutionDeploymentTopicHandlers(options = {}) {
  const getStatus = options.getStatus || getEvolutionDeploymentStatus;
  const configure = options.configure || configureEvolutionDeployment;
  const setEnabled = options.setEnabled || setEvolutionDeploymentEnabled;
  return {
    "evolution.deployment.status": async (_frame, context) => {
      assertSecureControl(context);
      return getStatus();
    },
    "evolution.deployment.configure": async (frame, context) => {
      assertSecureControl(context);
      return configure({
        descriptorPath: requiredPath(frame?.descriptorPath, "descriptorPath"),
        trustRootPath: requiredPath(frame?.trustRootPath, "trustRootPath"),
        enabled: true,
      });
    },
    "evolution.deployment.set-enabled": async (frame, context) => {
      assertSecureControl(context);
      if (typeof frame?.enabled !== "boolean")
        throw new Error("enabled must be a boolean");
      return setEnabled(frame.enabled);
    },
  };
}

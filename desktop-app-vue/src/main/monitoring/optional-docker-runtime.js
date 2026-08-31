/**
 * Optional Docker integration for monitoring recovery actions.
 *
 * Docker is never required for normal application startup. Container recovery
 * is enabled only through an explicit constructor option or the documented
 * environment opt-in, and every operation first verifies that the Docker
 * daemon is reachable.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");

const DOCKER_AUTO_START_ENV = "CHAINLESSCHAIN_ENABLE_DOCKER_AUTO_START";
const DEFAULT_DOCKER_TIMEOUT_MS = 5000;
const dockerExecFile = promisify(execFile);

function envFlagEnabled(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function resolveDockerAutoStartEnabled(
  explicitValue,
  environment = process.env,
) {
  if (typeof explicitValue === "boolean") {
    return explicitValue;
  }
  return envFlagEnabled(environment?.[DOCKER_AUTO_START_ENV]);
}

function defaultDockerRunner(args, timeoutMs = DEFAULT_DOCKER_TIMEOUT_MS) {
  return dockerExecFile("docker", args, {
    timeout: timeoutMs,
    windowsHide: true,
  });
}

class OptionalDockerRuntime {
  constructor(options = {}) {
    this.enabled = resolveDockerAutoStartEnabled(
      options.enabled,
      options.environment,
    );
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1000, Math.floor(options.timeoutMs))
      : DEFAULT_DOCKER_TIMEOUT_MS;
    this.run = options.run || defaultDockerRunner;
  }

  async checkAvailability() {
    if (!this.enabled) {
      return {
        available: false,
        reason: "disabled",
        message: `Docker auto-start is disabled; set ${DOCKER_AUTO_START_ENV}=1 to opt in`,
      };
    }

    try {
      await this.run(
        ["version", "--format", "{{.Server.Version}}"],
        this.timeoutMs,
      );
      return { available: true, reason: null, message: "Docker is available" };
    } catch {
      return {
        available: false,
        reason: "unavailable",
        message: "Docker is not installed or its daemon is unavailable",
      };
    }
  }

  async startContainer(containerName) {
    const availability = await this.checkAvailability();
    if (!availability.available) {
      return {
        success: false,
        skipped: true,
        reason: availability.reason,
        message: availability.message,
      };
    }

    try {
      await this.run(["start", String(containerName)], this.timeoutMs);
      return {
        success: true,
        skipped: false,
        container: String(containerName),
        message: `${containerName} container started`,
      };
    } catch {
      return {
        success: false,
        skipped: true,
        reason: "container-unavailable",
        message: `Docker is available, but ${containerName} could not be started`,
      };
    }
  }

  async execInContainer(containerName, args) {
    const availability = await this.checkAvailability();
    if (!availability.available) {
      return {
        success: false,
        skipped: true,
        reason: availability.reason,
        message: availability.message,
      };
    }

    try {
      await this.run(
        ["exec", String(containerName), ...args.map(String)],
        this.timeoutMs,
      );
      return { success: true, skipped: false };
    } catch {
      return {
        success: false,
        skipped: true,
        reason: "container-command-failed",
        message: `Docker command for ${containerName} was unavailable`,
      };
    }
  }
}

function createOptionalDockerRuntime(options = {}) {
  return new OptionalDockerRuntime(options);
}

module.exports = {
  DEFAULT_DOCKER_TIMEOUT_MS,
  DOCKER_AUTO_START_ENV,
  OptionalDockerRuntime,
  createOptionalDockerRuntime,
  resolveDockerAutoStartEnabled,
};

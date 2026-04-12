/**
 * Execution Backend — abstraction for command execution environments.
 *
 * Provides LocalBackend (default), DockerBackend, and SSHBackend.
 * The agent's run_shell and run_code tools delegate to the active backend.
 *
 * Config: .chainlesschain/config.json → agent.executionBackend
 * Feature flag: EXECUTION_BACKENDS (off by default)
 *
 * @module execution-backend
 */

import { execSync } from "node:child_process";

// ─── Exported for test injection ────────────────────────────────────

export const _deps = {
  execSync,
};

// ─── Base class ─────────────────────────────────────────────────────

export class ExecutionBackend {
  constructor(options = {}) {
    this.type = "base";
    this.options = options;
  }

  /**
   * Execute a command.
   * @param {string} command - The command to run
   * @param {object} [opts]
   * @param {string} [opts.cwd] - Working directory
   * @param {number} [opts.timeout] - Timeout in ms
   * @param {number} [opts.maxBuffer] - Max output buffer size
   * @returns {{ stdout: string, stderr: string, exitCode: number }}
   */
  execute(command, opts = {}) {
    throw new Error("execute() must be implemented by subclass");
  }

  /** @returns {string} Backend description for logging */
  describe() {
    return `${this.type} backend`;
  }
}

// ─── Local Backend ──────────────────────────────────────────────────

export class LocalBackend extends ExecutionBackend {
  constructor(options = {}) {
    super(options);
    this.type = "local";
  }

  execute(command, opts = {}) {
    const cwd = opts.cwd || process.cwd();
    const timeout = opts.timeout || 60000;
    const maxBuffer = opts.maxBuffer || 1024 * 1024;

    try {
      const stdout = _deps.execSync(command, {
        cwd,
        encoding: "utf8",
        timeout,
        maxBuffer,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err) {
      return {
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || err.message || "").toString(),
        exitCode: err.status || 1,
      };
    }
  }

  describe() {
    return "local (direct execution)";
  }
}

// ─── Docker Backend ─────────────────────────────────────────────────

export class DockerBackend extends ExecutionBackend {
  /**
   * @param {object} options
   * @param {string} options.container - Container name or ID (for exec mode)
   * @param {string} [options.image] - Image name (for run mode — ephemeral containers)
   * @param {string} [options.workdir] - Working directory inside container
   * @param {string[]} [options.volumes] - Volume mounts (host:container format)
   * @param {string} [options.shell] - Shell to use (default: sh)
   */
  constructor(options = {}) {
    super(options);
    this.type = "docker";
    this.container = options.container || null;
    this.image = options.image || null;
    this.workdir = options.workdir || "/workspace";
    this.volumes = options.volumes || [];
    this.shell = options.shell || "sh";
  }

  execute(command, opts = {}) {
    const timeout = opts.timeout || 60000;
    const maxBuffer = opts.maxBuffer || 1024 * 1024;
    const cwd = opts.cwd || this.workdir;

    let dockerCmd;
    if (this.container) {
      // Exec into existing container
      dockerCmd = `docker exec -w "${cwd}" ${this.container} ${this.shell} -c "${this._escapeCommand(command)}"`;
    } else if (this.image) {
      // Run ephemeral container
      const volumeArgs = this.volumes.map((v) => `-v "${v}"`).join(" ");
      dockerCmd = `docker run --rm -w "${cwd}" ${volumeArgs} ${this.image} ${this.shell} -c "${this._escapeCommand(command)}"`;
    } else {
      return {
        stdout: "",
        stderr: "Docker backend: neither container nor image specified",
        exitCode: 1,
      };
    }

    try {
      const stdout = _deps.execSync(dockerCmd, {
        encoding: "utf8",
        timeout,
        maxBuffer,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err) {
      return {
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || err.message || "").toString(),
        exitCode: err.status || 1,
      };
    }
  }

  _escapeCommand(cmd) {
    return cmd.replace(/"/g, '\\"');
  }

  describe() {
    if (this.container) return `docker exec (container: ${this.container})`;
    return `docker run (image: ${this.image})`;
  }
}

// ─── SSH Backend ────────────────────────────────────────────────────

export class SSHBackend extends ExecutionBackend {
  /**
   * @param {object} options
   * @param {string} options.host - Remote host
   * @param {string} [options.user] - SSH user
   * @param {string} [options.key] - Path to SSH private key
   * @param {number} [options.port] - SSH port (default: 22)
   * @param {string} [options.workdir] - Remote working directory
   */
  constructor(options = {}) {
    super(options);
    this.type = "ssh";
    this.host = options.host;
    this.user = options.user || "";
    this.key = options.key || "";
    this.port = options.port || 22;
    this.workdir = options.workdir || "~";
  }

  execute(command, opts = {}) {
    const timeout = opts.timeout || 60000;
    const maxBuffer = opts.maxBuffer || 1024 * 1024;
    const cwd = opts.cwd || this.workdir;

    if (!this.host) {
      return {
        stdout: "",
        stderr: "SSH backend: host not specified",
        exitCode: 1,
      };
    }

    const userHost = this.user ? `${this.user}@${this.host}` : this.host;
    const keyArg = this.key ? `-i "${this.key}"` : "";
    const portArg = this.port !== 22 ? `-p ${this.port}` : "";
    const remoteCmd = `cd "${cwd}" && ${command}`;

    const sshCmd = `ssh ${keyArg} ${portArg} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${userHost} "${this._escapeCommand(remoteCmd)}"`;

    try {
      const stdout = _deps.execSync(sshCmd, {
        encoding: "utf8",
        timeout,
        maxBuffer,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err) {
      return {
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || err.message || "").toString(),
        exitCode: err.status || 1,
      };
    }
  }

  _escapeCommand(cmd) {
    return cmd.replace(/"/g, '\\"');
  }

  describe() {
    const userHost = this.user ? `${this.user}@${this.host}` : this.host;
    return `ssh (${userHost}:${this.port})`;
  }
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create an execution backend from config.
 * @param {object} [config] - Backend config from config.json
 * @param {string} [config.type] - "local" | "docker" | "ssh"
 * @param {object} [config.options] - Backend-specific options
 * @returns {ExecutionBackend}
 */
export function createBackend(config = {}) {
  const type = (config.type || "local").toLowerCase();

  switch (type) {
    case "docker":
      return new DockerBackend(config.options || {});
    case "ssh":
      return new SSHBackend(config.options || {});
    case "local":
    default:
      return new LocalBackend(config.options || {});
  }
}

/**
 * Unit tests for execution-backend — Local, Docker, SSH backends.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ExecutionBackend,
  LocalBackend,
  DockerBackend,
  SSHBackend,
  createBackend,
  _deps,
} from "../../src/lib/execution-backend.js";

// ─── Backup and mock ────────────────────────────────────────────────

const origDeps = { ..._deps };

beforeEach(() => {
  _deps.execSync = vi.fn(() => "mock output");
});

afterAll(() => {
  Object.assign(_deps, origDeps);
});

// ─── Base class ─────────────────────────────────────────────────────

describe("ExecutionBackend (base)", () => {
  it("throws on execute()", () => {
    const backend = new ExecutionBackend();
    expect(() => backend.execute("ls")).toThrow("must be implemented");
  });

  it("has type 'base'", () => {
    expect(new ExecutionBackend().type).toBe("base");
  });
});

// ─── LocalBackend ───────────────────────────────────────────────────

describe("LocalBackend", () => {
  let backend;
  beforeEach(() => {
    backend = new LocalBackend();
  });

  it("has type 'local'", () => {
    expect(backend.type).toBe("local");
  });

  it("executes command and returns stdout", () => {
    _deps.execSync.mockReturnValue("hello world\n");
    const result = backend.execute("echo hello world");
    expect(result.stdout).toBe("hello world\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("passes cwd, timeout, maxBuffer to execSync", () => {
    backend.execute("ls", { cwd: "/tmp", timeout: 5000, maxBuffer: 512 });
    expect(_deps.execSync).toHaveBeenCalledWith("ls", {
      cwd: "/tmp",
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 512,
    });
  });

  it("uses defaults when no opts given", () => {
    backend.execute("pwd");
    const opts = _deps.execSync.mock.calls[0][1];
    expect(opts.timeout).toBe(60000);
    expect(opts.maxBuffer).toBe(1024 * 1024);
  });

  it("returns error info on command failure", () => {
    const err = new Error("command failed");
    err.status = 127;
    err.stdout = "partial output";
    err.stderr = "not found";
    _deps.execSync.mockImplementation(() => {
      throw err;
    });

    const result = backend.execute("badcmd");
    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("partial output");
    expect(result.stderr).toBe("not found");
  });

  it("handles null stdout on error", () => {
    const err = new Error("fail");
    err.status = 1;
    _deps.execSync.mockImplementation(() => {
      throw err;
    });

    const result = backend.execute("fail");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("describe() returns human-readable string", () => {
    expect(backend.describe()).toContain("local");
  });
});

// ─── DockerBackend ──────────────────────────────────────────────────

describe("DockerBackend", () => {
  it("has type 'docker'", () => {
    expect(new DockerBackend().type).toBe("docker");
  });

  it("uses docker exec when container specified", () => {
    const backend = new DockerBackend({ container: "my-container" });
    backend.execute("ls /app");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("docker exec");
    expect(cmd).toContain("my-container");
    expect(cmd).toContain("ls /app");
  });

  it("uses docker run when image specified", () => {
    const backend = new DockerBackend({ image: "node:18" });
    backend.execute("node --version");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("docker run --rm");
    expect(cmd).toContain("node:18");
  });

  it("includes volume mounts in docker run", () => {
    const backend = new DockerBackend({
      image: "ubuntu",
      volumes: ["/host/path:/container/path"],
    });
    backend.execute("ls");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain('-v "/host/path:/container/path"');
  });

  it("uses custom workdir", () => {
    const backend = new DockerBackend({
      container: "c1",
      workdir: "/app",
    });
    backend.execute("pwd");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain('-w "/app"');
  });

  it("returns error when neither container nor image specified", () => {
    const backend = new DockerBackend();
    const result = backend.execute("ls");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("neither container nor image");
  });

  it("handles exec errors gracefully", () => {
    const backend = new DockerBackend({ container: "c1" });
    const err = new Error("container not found");
    err.status = 1;
    err.stderr = "Error: No such container";
    _deps.execSync.mockImplementation(() => {
      throw err;
    });

    const result = backend.execute("ls");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No such container");
  });

  it("escapes double quotes in command", () => {
    const backend = new DockerBackend({ container: "c1" });
    backend.execute('echo "hello"');
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain('\\"hello\\"');
  });

  it("describe() shows container or image", () => {
    expect(new DockerBackend({ container: "c1" }).describe()).toContain("c1");
    expect(new DockerBackend({ image: "node:18" }).describe()).toContain(
      "node:18",
    );
  });
});

// ─── SSHBackend ─────────────────────────────────────────────────────

describe("SSHBackend", () => {
  it("has type 'ssh'", () => {
    expect(new SSHBackend({ host: "x" }).type).toBe("ssh");
  });

  it("constructs ssh command with user@host", () => {
    const backend = new SSHBackend({ host: "server.com", user: "deploy" });
    backend.execute("uptime");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("ssh");
    expect(cmd).toContain("deploy@server.com");
    expect(cmd).toContain("uptime");
  });

  it("includes key file when specified", () => {
    const backend = new SSHBackend({
      host: "s",
      key: "/home/user/.ssh/id_rsa",
    });
    backend.execute("ls");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain('-i "/home/user/.ssh/id_rsa"');
  });

  it("includes custom port", () => {
    const backend = new SSHBackend({ host: "s", port: 2222 });
    backend.execute("ls");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("-p 2222");
  });

  it("omits port arg for default port 22", () => {
    const backend = new SSHBackend({ host: "s" });
    backend.execute("ls");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).not.toContain("-p ");
  });

  it("includes workdir via cd", () => {
    const backend = new SSHBackend({ host: "s", workdir: "/opt/app" });
    backend.execute("pwd");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain('cd \\"/opt/app\\"');
  });

  it("returns error when host not specified", () => {
    const backend = new SSHBackend({});
    const result = backend.execute("ls");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("host not specified");
  });

  it("handles SSH errors gracefully", () => {
    const backend = new SSHBackend({ host: "s" });
    const err = new Error("Connection refused");
    err.status = 255;
    err.stderr = "ssh: connect to host s port 22: Connection refused";
    _deps.execSync.mockImplementation(() => {
      throw err;
    });

    const result = backend.execute("ls");
    expect(result.exitCode).toBe(255);
    expect(result.stderr).toContain("Connection refused");
  });

  it("describe() shows user@host:port", () => {
    const desc = new SSHBackend({
      host: "prod.io",
      user: "admin",
      port: 2222,
    }).describe();
    expect(desc).toContain("admin@prod.io");
    expect(desc).toContain("2222");
  });
});

// ─── createBackend factory ──────────────────────────────────────────

describe("createBackend", () => {
  it("creates LocalBackend by default", () => {
    const backend = createBackend();
    expect(backend).toBeInstanceOf(LocalBackend);
  });

  it("creates LocalBackend for type 'local'", () => {
    expect(createBackend({ type: "local" })).toBeInstanceOf(LocalBackend);
  });

  it("creates DockerBackend for type 'docker'", () => {
    const backend = createBackend({
      type: "docker",
      options: { container: "c1" },
    });
    expect(backend).toBeInstanceOf(DockerBackend);
    expect(backend.container).toBe("c1");
  });

  it("creates SSHBackend for type 'ssh'", () => {
    const backend = createBackend({
      type: "ssh",
      options: { host: "prod.io", user: "deploy" },
    });
    expect(backend).toBeInstanceOf(SSHBackend);
    expect(backend.host).toBe("prod.io");
  });

  it("is case-insensitive for type", () => {
    expect(
      createBackend({ type: "DOCKER", options: { image: "x" } }),
    ).toBeInstanceOf(DockerBackend);
    expect(
      createBackend({ type: "SSH", options: { host: "x" } }),
    ).toBeInstanceOf(SSHBackend);
  });

  it("falls back to local for unknown type", () => {
    expect(createBackend({ type: "unknown" })).toBeInstanceOf(LocalBackend);
  });
});

// ─── Edge-case coverage (Hermes parity) ────────────────────────────

describe("DockerBackend — custom shell", () => {
  it("uses custom shell in docker exec command", () => {
    const backend = new DockerBackend({ container: "c1", shell: "bash" });
    backend.execute("echo hi");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("bash -c");
    // Default shell "sh" should not appear — "bash" is used instead
    expect(cmd).toMatch(/\bbash -c\b/);
  });
});

describe("DockerBackend — empty volumes array", () => {
  it("docker run command has no -v flags with empty volumes", () => {
    const backend = new DockerBackend({ image: "alpine", volumes: [] });
    backend.execute("ls");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("docker run --rm");
    expect(cmd).not.toContain("-v ");
  });
});

describe("SSHBackend — without user", () => {
  it("constructs ssh command with just host (no user@)", () => {
    const backend = new SSHBackend({ host: "bare-host.io" });
    backend.execute("uptime");
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain("bare-host.io");
    expect(cmd).not.toContain("@bare-host.io");
  });

  it("describe() shows just host without user@", () => {
    const desc = new SSHBackend({ host: "bare-host.io" }).describe();
    expect(desc).toContain("bare-host.io");
    expect(desc).not.toContain("@bare-host.io");
  });
});

describe("LocalBackend — null execSync result", () => {
  it("returns empty stdout when execSync returns null", () => {
    _deps.execSync.mockReturnValue(null);
    const backend = new LocalBackend();
    const result = backend.execute("noop");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("DockerBackend — cwd option overriding workdir", () => {
  it("uses opts.cwd instead of constructor workdir", () => {
    const backend = new DockerBackend({ container: "c1", workdir: "/default" });
    backend.execute("pwd", { cwd: "/override" });
    const cmd = _deps.execSync.mock.calls[0][0];
    expect(cmd).toContain('-w "/override"');
  });
});

describe("createBackend — passes options through", () => {
  it("docker backend receives image and volumes from config.options", () => {
    const backend = createBackend({
      type: "docker",
      options: { image: "node:20", volumes: ["/src:/src"] },
    });
    expect(backend).toBeInstanceOf(DockerBackend);
    expect(backend.image).toBe("node:20");
    expect(backend.volumes).toEqual(["/src:/src"]);
  });

  it("ssh backend receives host, user, port from config.options", () => {
    const backend = createBackend({
      type: "ssh",
      options: { host: "myhost", user: "root", port: 2222 },
    });
    expect(backend).toBeInstanceOf(SSHBackend);
    expect(backend.host).toBe("myhost");
    expect(backend.user).toBe("root");
    expect(backend.port).toBe(2222);
  });
});

describe("ExecutionBackend.describe()", () => {
  it("returns 'base backend'", () => {
    const base = new ExecutionBackend();
    expect(base.describe()).toBe("base backend");
  });
});

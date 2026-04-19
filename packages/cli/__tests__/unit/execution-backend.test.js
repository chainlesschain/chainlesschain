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

// ===== V2 Tests: Execution Backend governance overlay =====
import {
  EXECBE_BACKEND_MATURITY_V2,
  EXECBE_JOB_LIFECYCLE_V2,
  registerBackendV2,
  activateBackendV2,
  degradeBackendV2,
  retireBackendV2,
  touchBackendV2,
  getBackendV2,
  listBackendsV2,
  createExecJobV2,
  startExecJobV2,
  succeedExecJobV2,
  failExecJobV2,
  cancelExecJobV2,
  getExecJobV2,
  listExecJobsV2,
  autoDegradeIdleBackendsV2,
  autoFailStuckExecJobsV2,
  getExecutionBackendStatsV2,
  _resetStateExecutionBackendV2,
  setMaxActiveBackendsPerOwnerV2,
  getMaxActiveBackendsPerOwnerV2,
  setMaxPendingJobsPerBackendV2,
  getMaxPendingJobsPerBackendV2,
  setBackendIdleMsV2,
  getBackendIdleMsV2,
  setExecJobStuckMsV2,
  getExecJobStuckMsV2,
} from "../../src/lib/execution-backend.js";

describe("Execution Backend V2 governance overlay", () => {
  beforeEach(() => {
    _resetStateExecutionBackendV2();
  });
  describe("enums", () => {
    it("backend 4 states", () => {
      expect(Object.keys(EXECBE_BACKEND_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "DEGRADED",
        "PENDING",
        "RETIRED",
      ]);
      expect(Object.isFrozen(EXECBE_BACKEND_MATURITY_V2)).toBe(true);
    });
    it("job 5 states", () => {
      expect(Object.keys(EXECBE_JOB_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "FAILED",
        "QUEUED",
        "RUNNING",
        "SUCCEEDED",
      ]);
    });
  });
  describe("backend lifecycle", () => {
    it("register → activate", () => {
      registerBackendV2({ id: "b", owner: "u" });
      const x = activateBackendV2("b");
      expect(x.status).toBe("active");
      expect(x.activatedAt).not.toBeNull();
    });
    it("dup rejected", () => {
      registerBackendV2({ id: "b", owner: "u" });
      expect(() => registerBackendV2({ id: "b", owner: "u" })).toThrow(
        /already/,
      );
    });
    it("degraded → active preserves activatedAt", () => {
      registerBackendV2({ id: "b", owner: "u" });
      activateBackendV2("b");
      const t1 = getBackendV2("b").activatedAt;
      degradeBackendV2("b");
      expect(activateBackendV2("b").activatedAt).toBe(t1);
    });
    it("retire stamps", () => {
      registerBackendV2({ id: "b", owner: "u" });
      expect(retireBackendV2("b").retiredAt).not.toBeNull();
    });
    it("touch terminal throws", () => {
      registerBackendV2({ id: "b", owner: "u" });
      retireBackendV2("b");
      expect(() => touchBackendV2("b")).toThrow(/terminal/);
    });
  });
  describe("active cap", () => {
    it("recovery exempt", () => {
      setMaxActiveBackendsPerOwnerV2(1);
      registerBackendV2({ id: "a", owner: "u" });
      activateBackendV2("a");
      degradeBackendV2("a");
      registerBackendV2({ id: "b", owner: "u" });
      activateBackendV2("b");
      expect(activateBackendV2("a").status).toBe("active");
    });
    it("initial enforced", () => {
      setMaxActiveBackendsPerOwnerV2(1);
      registerBackendV2({ id: "a", owner: "u" });
      activateBackendV2("a");
      registerBackendV2({ id: "b", owner: "u" });
      expect(() => activateBackendV2("b")).toThrow(/max active/);
    });
  });
  describe("job lifecycle", () => {
    beforeEach(() => {
      registerBackendV2({ id: "b", owner: "u" });
    });
    it("create queued", () => {
      expect(
        createExecJobV2({ id: "j", backendId: "b", command: "echo" }).status,
      ).toBe("queued");
    });
    it("missing backend throws", () => {
      expect(() => createExecJobV2({ id: "j", backendId: "nope" })).toThrow(
        /not found/,
      );
    });
    it("start stamps startedAt", () => {
      createExecJobV2({ id: "j", backendId: "b" });
      const x = startExecJobV2("j");
      expect(x.status).toBe("running");
      expect(x.startedAt).not.toBeNull();
    });
    it("succeed stamps settledAt", () => {
      createExecJobV2({ id: "j", backendId: "b" });
      startExecJobV2("j");
      expect(succeedExecJobV2("j").settledAt).not.toBeNull();
    });
    it("fail reason", () => {
      createExecJobV2({ id: "j", backendId: "b" });
      startExecJobV2("j");
      expect(failExecJobV2("j", "oops").metadata.failReason).toBe("oops");
    });
    it("cancel queued", () => {
      createExecJobV2({ id: "j", backendId: "b" });
      expect(cancelExecJobV2("j").status).toBe("cancelled");
    });
    it("invalid transition throws", () => {
      createExecJobV2({ id: "j", backendId: "b" });
      expect(() => succeedExecJobV2("j")).toThrow(/invalid/);
    });
  });
  describe("pending cap", () => {
    it("enforced", () => {
      setMaxPendingJobsPerBackendV2(2);
      registerBackendV2({ id: "b", owner: "u" });
      createExecJobV2({ id: "a", backendId: "b" });
      createExecJobV2({ id: "b2", backendId: "b" });
      expect(() => createExecJobV2({ id: "c", backendId: "b" })).toThrow(
        /max pending/,
      );
    });
  });
  describe("auto flip", () => {
    it("auto-degrade idle", () => {
      setBackendIdleMsV2(1000);
      registerBackendV2({ id: "b", owner: "u" });
      activateBackendV2("b");
      const base = getBackendV2("b").lastTouchedAt;
      expect(autoDegradeIdleBackendsV2({ now: base + 5000 }).count).toBe(1);
      expect(getBackendV2("b").status).toBe("degraded");
    });
    it("auto-fail stuck", () => {
      setExecJobStuckMsV2(500);
      registerBackendV2({ id: "b", owner: "u" });
      createExecJobV2({ id: "j", backendId: "b" });
      startExecJobV2("j");
      const base = getExecJobV2("j").startedAt;
      expect(autoFailStuckExecJobsV2({ now: base + 5000 }).count).toBe(1);
      expect(getExecJobV2("j").status).toBe("failed");
    });
  });
  describe("config & stats", () => {
    it("rejects invalid", () => {
      expect(() => setMaxActiveBackendsPerOwnerV2(0)).toThrow();
    });
    it("floors", () => {
      setMaxPendingJobsPerBackendV2(19.5);
      expect(getMaxPendingJobsPerBackendV2()).toBe(19);
    });
    it("round-trip", () => {
      setBackendIdleMsV2(10);
      setExecJobStuckMsV2(20);
      expect(getBackendIdleMsV2()).toBe(10);
      expect(getExecJobStuckMsV2()).toBe(20);
    });
    it("stats zero-init", () => {
      const s = getExecutionBackendStatsV2();
      for (const v of Object.values(EXECBE_BACKEND_MATURITY_V2))
        expect(s.backendsByStatus[v]).toBe(0);
      for (const v of Object.values(EXECBE_JOB_LIFECYCLE_V2))
        expect(s.jobsByStatus[v]).toBe(0);
    });
    it("reset", () => {
      setMaxActiveBackendsPerOwnerV2(99);
      registerBackendV2({ id: "b", owner: "u" });
      _resetStateExecutionBackendV2();
      expect(getExecutionBackendStatsV2().totalBackendsV2).toBe(0);
      expect(getMaxActiveBackendsPerOwnerV2()).toBe(6);
    });
    it("defensive copy", () => {
      registerBackendV2({ id: "b", owner: "u", metadata: { k: "v" } });
      const x = getBackendV2("b");
      x.metadata.k = "bad";
      expect(getBackendV2("b").metadata.k).toBe("v");
    });
    it("lists", () => {
      registerBackendV2({ id: "a", owner: "u" });
      registerBackendV2({ id: "b", owner: "u" });
      expect(listBackendsV2().length).toBe(2);
      createExecJobV2({ id: "j", backendId: "a" });
      expect(listExecJobsV2().length).toBe(1);
    });
  });
});

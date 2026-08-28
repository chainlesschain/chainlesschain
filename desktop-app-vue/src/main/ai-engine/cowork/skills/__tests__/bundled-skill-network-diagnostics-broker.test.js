import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBundledSkillNetworkDiagnosticsBroker,
  requireBundledSkillNetworkDiagnosticsBroker,
} = require("../bundled-skill-network-diagnostics-broker.js");
const {
  createBundledSkillRuntimeNetworkBroker,
} = require("../bundled-skill-egress-broker.js");
const networkDiagnosticsHandler = require("../builtin/network-diagnostics/handler.js");

const SKILLS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function policy(overrides = {}) {
  return {
    skillId: "network-diagnostics",
    authorityId: "decision:diagnostics-1",
    allowedTargets: ["example.com"],
    allowedOperations: ["dns", "ping", "port", "trace"],
    allowedDnsTypes: ["A", "MX"],
    allowedPorts: [80, 443],
    ...overrides,
  };
}

function publicLookup(_target, _options, callback) {
  callback(null, [{ address: "93.184.216.34", family: 4 }]);
}

describe("bundled Skill network diagnostics broker", () => {
  it("keeps the handler off raw network, DNS, and process modules", () => {
    const source = readFileSync(
      path.join(
        SKILLS_DIRECTORY,
        "builtin",
        "network-diagnostics",
        "handler.js",
      ),
      "utf8",
    );

    expect(source).toContain("requireBundledSkillNetworkDiagnosticsBroker");
    expect(source).toContain("requireBundledSkillRuntimeNetworkBroker");
    expect(source).not.toContain("createBundledSkillNetworkDiagnosticsBroker");
    expect(source).not.toContain("createBundledSkillRuntimeNetworkBroker");
    expect(source).not.toMatch(
      /require\(["'](?:node:)?(?:dns|net|http|https|child_process)["']\)/,
    );
    expect(source).not.toMatch(
      /(?:^|[^.\w])(?:exec|execFile|execSync|spawn)\s*\(/m,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it.each([
    [
      "missing policy",
      undefined,
      "CC_BUNDLED_SKILL_DIAGNOSTICS_POLICY_INVALID",
    ],
    [
      "wrong Skill",
      policy({ skillId: "http-client" }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_SKILL_DENIED",
    ],
    [
      "missing authority",
      policy({ authorityId: "" }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_AUTHORITY_REQUIRED",
    ],
    [
      "wildcard target",
      policy({ allowedTargets: ["*.example.com"] }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_INVALID",
    ],
    [
      "URL target",
      policy({ allowedTargets: ["https://example.com"] }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_INVALID",
    ],
    [
      "missing operations",
      policy({ allowedOperations: [] }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_OPERATIONS_REQUIRED",
    ],
    [
      "missing DNS types",
      policy({ allowedDnsTypes: [] }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_DNS_TYPES_REQUIRED",
    ],
    [
      "missing TCP ports",
      policy({ allowedPorts: [] }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_PORTS_REQUIRED",
    ],
    [
      "too many TCP ports",
      policy({ allowedPorts: Array.from({ length: 101 }, (_, i) => i + 1) }),
      "CC_BUNDLED_SKILL_DIAGNOSTICS_PORTS_REQUIRED",
    ],
  ])("rejects %s", (_label, options, code) => {
    expect(() =>
      createBundledSkillNetworkDiagnosticsBroker(options, {
        auditSink: vi.fn(),
      }),
    ).toThrow(expect.objectContaining({ code }));
  });

  it("requires an authentic branded authority", () => {
    const broker = createBundledSkillNetworkDiagnosticsBroker(policy(), {
      auditSink: vi.fn(),
    });

    expect(
      requireBundledSkillNetworkDiagnosticsBroker({
        networkDiagnosticsBroker: broker,
      }),
    ).toBe(broker);
    expect(() =>
      requireBundledSkillNetworkDiagnosticsBroker({
        networkDiagnosticsBroker: {
          checkPort: vi.fn(),
          resolveDns: vi.fn(),
          runPing: vi.fn(),
          runTrace: vi.fn(),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_DIAGNOSTICS_BROKER_UNAVAILABLE",
      }),
    );
  });

  it("resolves only approved DNS targets and record types with a bounded result", async () => {
    const auditSink = vi.fn();
    const resolver = {
      resolveMx: vi.fn(async () => [
        { priority: 20, exchange: "mx2.example.com" },
        { priority: 10, exchange: "mx1.example.com" },
      ]),
    };
    const broker = createBundledSkillNetworkDiagnosticsBroker(policy(), {
      auditSink,
      createResolver: () => resolver,
    });

    await expect(
      broker.resolveDns({ target: "example.com", type: "MX" }),
    ).resolves.toEqual(["10 mx1.example.com", "20 mx2.example.com"]);
    expect(resolver.resolveMx).toHaveBeenCalledWith("example.com");
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        authorityId: "decision:diagnostics-1",
        operation: "dns",
        target: "example.com",
        dnsType: "MX",
      }),
    );
    await expect(
      broker.resolveDns({ target: "example.com", type: "TXT" }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_DNS_TYPE_DENIED",
    });
    await expect(
      broker.resolveDns({ target: "other.example", type: "A" }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_DENIED",
    });
  });

  it("rejects mixed public/private DNS answers before opening a TCP socket", async () => {
    const createConnection = vi.fn();
    const broker = createBundledSkillNetworkDiagnosticsBroker(policy(), {
      auditSink: vi.fn(),
      lookup: vi.fn((_target, _options, callback) =>
        callback(null, [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
      ),
      createConnection,
    });

    await expect(
      broker.checkPort({ target: "example.com", port: 443 }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_ADDRESS_DENIED",
    });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("pins an approved TCP connection to the validated address and port", async () => {
    const socket = new EventEmitter();
    socket.setTimeout = vi.fn();
    socket.destroy = vi.fn();
    const createConnection = vi.fn(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });
    const broker = createBundledSkillNetworkDiagnosticsBroker(policy(), {
      auditSink: vi.fn(),
      lookup: publicLookup,
      createConnection,
    });

    await expect(
      broker.checkPort({ target: "example.com", port: 443, timeoutMs: 9999 }),
    ).resolves.toEqual({ port: 443, open: true });
    expect(createConnection).toHaveBeenCalledWith({
      host: "93.184.216.34",
      port: 443,
      family: 4,
    });
    expect(socket.setTimeout).toHaveBeenCalledWith(5000);
    await expect(
      broker.checkPort({ target: "example.com", port: 22 }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_PORT_DENIED",
    });
  });

  it("uses fixed executable argv through ProcessExecutionBroker", async () => {
    const processBroker = {
      execFile: vi.fn((_file, _args, _options, callback) => {
        callback(
          null,
          "4 packets transmitted, 4 received, 0% packet loss, time=12ms",
          "",
        );
        return new EventEmitter();
      }),
    };
    const broker = createBundledSkillNetworkDiagnosticsBroker(policy(), {
      auditSink: vi.fn(),
      lookup: publicLookup,
      platform: "linux",
      env: { PATH: "/usr/bin", SECRET_TOKEN: "do-not-pass" },
      loadProcessBroker: async () => processBroker,
    });

    await expect(
      broker.runPing({ target: "example.com", count: 4 }),
    ).resolves.toContain("4 packets transmitted");
    expect(processBroker.execFile).toHaveBeenCalledWith(
      "ping",
      ["-c", "4", "93.184.216.34"],
      expect.objectContaining({
        shell: false,
        timeout: 30_000,
        maxBuffer: 256 * 1024,
        env: { PATH: "/usr/bin" },
      }),
      expect.any(Function),
    );
    await expect(
      broker.runPing({ target: "example.com", count: 11 }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_PING_COUNT_DENIED",
    });
    await expect(
      broker.runPing({ target: "example.com;whoami", count: 1 }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_INVALID",
    });
    expect(processBroker.execFile).toHaveBeenCalledTimes(1);
  });

  it("denies private command targets unless the host explicitly approves them", async () => {
    const processBroker = { execFile: vi.fn() };
    const denied = createBundledSkillNetworkDiagnosticsBroker(
      policy({
        allowedTargets: ["127.0.0.1"],
        allowedOperations: ["trace"],
        allowedDnsTypes: [],
        allowedPorts: [],
      }),
      {
        auditSink: vi.fn(),
        loadProcessBroker: async () => processBroker,
      },
    );

    await expect(
      denied.runTrace({ target: "127.0.0.1" }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_ADDRESS_DENIED",
    });
    expect(processBroker.execFile).not.toHaveBeenCalled();
  });

  it("fails before DNS, socket, or process work when audit is unavailable", async () => {
    const lookup = vi.fn();
    const createConnection = vi.fn();
    const loadProcessBroker = vi.fn();
    const broker = createBundledSkillNetworkDiagnosticsBroker(policy(), {
      auditSink() {
        throw new Error("audit unavailable");
      },
      lookup,
      createConnection,
      loadProcessBroker,
    });

    await expect(
      broker.checkPort({ target: "example.com", port: 443 }),
    ).rejects.toThrow("audit unavailable");
    expect(lookup).not.toHaveBeenCalled();
    expect(createConnection).not.toHaveBeenCalled();
    expect(loadProcessBroker).not.toHaveBeenCalled();
  });
});

describe("network-diagnostics handler authority integration", () => {
  it("fails closed when a privileged action has no branded authority", async () => {
    await expect(
      networkDiagnosticsHandler.execute({ input: "--ping example.com" }, {}),
    ).resolves.toMatchObject({
      success: false,
      result: {
        error: "CC_BUNDLED_SKILL_DIAGNOSTICS_BROKER_UNAVAILABLE",
      },
    });
  });

  it("delegates DNS, TCP, ping, and trace operations to the branded broker", async () => {
    const processBroker = {
      execFile: vi.fn((file, _args, _options, callback) => {
        const output =
          file === "ping"
            ? "Received = 4\n4 packets transmitted, 4 received, 0% packet loss\ntime=12.5 ms"
            : " 1  93.184.216.34  3.2 ms";
        callback(null, output, "");
        return new EventEmitter();
      }),
    };
    const diagnosticsBroker = createBundledSkillNetworkDiagnosticsBroker(
      policy({ allowedDnsTypes: ["A"], allowedPorts: [80, 81] }),
      {
        auditSink: vi.fn(),
        lookup: publicLookup,
        platform: "linux",
        createResolver: () => ({
          resolve4: vi.fn(async () => ["93.184.216.34"]),
        }),
        createConnection: ({ port }) => {
          const socket = new EventEmitter();
          socket.setTimeout = vi.fn();
          socket.destroy = vi.fn();
          queueMicrotask(() =>
            socket.emit(port === 80 ? "connect" : "error", new Error("closed")),
          );
          return socket;
        },
        loadProcessBroker: async () => processBroker,
      },
    );
    const context = { networkDiagnosticsBroker: diagnosticsBroker };

    await expect(
      networkDiagnosticsHandler.execute(
        { input: "--dns example.com --type A" },
        context,
      ),
    ).resolves.toMatchObject({
      success: true,
      result: { records: ["93.184.216.34"] },
    });
    await expect(
      networkDiagnosticsHandler.execute(
        { input: "--ports example.com --range 80-81" },
        context,
      ),
    ).resolves.toMatchObject({
      success: true,
      result: { openPorts: [80], totalScanned: 2 },
    });
    await expect(
      networkDiagnosticsHandler.execute(
        { input: "--ping example.com --count 4" },
        context,
      ),
    ).resolves.toMatchObject({
      success: true,
      result: { reachable: true, received: 4 },
    });
    await expect(
      networkDiagnosticsHandler.execute(
        { input: "--trace example.com" },
        context,
      ),
    ).resolves.toMatchObject({
      success: true,
      result: { hops: [{ hop: 1, ip: "93.184.216.34" }] },
    });
  });

  it("delegates HTTPS checks and rejects plaintext HTTP", async () => {
    const https = {
      request: vi.fn((_options, callback) => {
        const request = new EventEmitter();
        request.setTimeout = vi.fn();
        request.destroy = vi.fn();
        request.end = vi.fn(() => {
          const response = new EventEmitter();
          response.statusCode = 204;
          response.statusMessage = "No Content";
          response.headers = {
            "content-type": "application/json",
            server: "test-server",
          };
          response.destroy = vi.fn();
          queueMicrotask(() => {
            callback(response);
            response.emit("end");
          });
          return request;
        });
        return request;
      }),
    };
    const networkBroker = createBundledSkillRuntimeNetworkBroker(
      {
        skillId: "network-diagnostics",
        allowedDomains: ["example.com"],
        declassificationId: "decision:https-check-1",
      },
      { https, lookup: publicLookup, auditSink: vi.fn() },
    );
    const context = { networkBroker };

    await expect(
      networkDiagnosticsHandler.execute(
        { input: "--check https://example.com/health" },
        context,
      ),
    ).resolves.toMatchObject({
      success: true,
      result: { statusCode: 204, reachable: true },
    });
    await expect(
      networkDiagnosticsHandler.execute(
        { input: "--check http://example.com/health" },
        context,
      ),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining("HTTPS is required"),
    });
    expect(https.request).toHaveBeenCalledTimes(1);
  });
});

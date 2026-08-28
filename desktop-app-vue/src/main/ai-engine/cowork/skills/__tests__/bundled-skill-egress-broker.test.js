import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_EGRESS_POLICIES,
  createBundledSkillFixedNetworkBroker,
  createBundledSkillHttpsClient,
  createBundledSkillRuntimeNetworkBroker,
  requireBundledSkillRuntimeNetworkBroker,
} = require("../bundled-skill-egress-broker.js");

const SKILLS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BROKERED_SKILL_IDS = Object.freeze([
  "audio-transcriber",
  "free-model-manager",
  "github-manager",
  "google-workspace",
  "image-generator",
  "news-monitor",
  "notion",
  "tavily-search",
  "weather",
  "youtube-summarizer",
]);
const RUNTIME_BROKERED_SKILL_IDS = Object.freeze([
  "api-gateway",
  "http-client",
  "network-diagnostics",
  "summarizer",
]);

function createHttpsHarness() {
  const calls = [];
  const https = {
    request: vi.fn((options, callback) => {
      const req = new EventEmitter();
      req.write = vi.fn(() => true);
      const end = vi.fn(() => req);
      req.end = end;
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      calls.push({ options, callback, req, end });
      return req;
    }),
  };
  return { calls, https };
}

describe("bundled Skill egress broker", () => {
  let harness;

  beforeEach(() => {
    harness = createHttpsHarness();
  });

  it("ships only frozen, explicit domain policies", () => {
    expect(Object.keys(BUNDLED_SKILL_EGRESS_POLICIES).sort()).toEqual(
      BROKERED_SKILL_IDS,
    );
    for (const policy of Object.values(BUNDLED_SKILL_EGRESS_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.allowedDomains)).toBe(true);
      expect(policy.allowedDomains.length).toBeGreaterThan(0);
    }
  });

  it("keeps every migrated handler off raw HTTP modules", () => {
    for (const skillId of [
      ...BROKERED_SKILL_IDS,
      ...RUNTIME_BROKERED_SKILL_IDS,
    ]) {
      const source = readFileSync(
        path.join(SKILLS_DIRECTORY, "builtin", skillId, "handler.js"),
        "utf8",
      );
      expect(source, skillId).toContain("bundled-skill-egress-broker.js");
      expect(source, skillId).not.toMatch(
        /require\(["'](?:node:)?https?["']\)/,
      );
      expect(source, skillId).not.toMatch(/require\(["']axios["']\)/);
      expect(source, skillId).not.toMatch(/\bfetch\s*\(/);
      if (RUNTIME_BROKERED_SKILL_IDS.includes(skillId)) {
        expect(source, skillId).toContain(
          "requireBundledSkillRuntimeNetworkBroker",
        );
        expect(source, skillId).not.toContain(
          "createBundledSkillRuntimeNetworkBroker",
        );
      }
    }
  });

  it.each([
    ["missing policy", undefined, "CC_BUNDLED_SKILL_NETWORK_POLICY_INVALID"],
    [
      "unapproved Skill",
      {
        skillId: "weather",
        allowedDomains: ["example.com"],
        declassificationId: "decision:1",
      },
      "CC_BUNDLED_SKILL_NETWORK_SKILL_DENIED",
    ],
    [
      "empty domains",
      {
        skillId: "summarizer",
        allowedDomains: [],
        declassificationId: "decision:1",
      },
      "CC_BUNDLED_SKILL_NETWORK_DOMAINS_REQUIRED",
    ],
    [
      "wildcard domain",
      {
        skillId: "summarizer",
        allowedDomains: ["*.com"],
        declassificationId: "decision:1",
      },
      "CC_BUNDLED_SKILL_NETWORK_DOMAIN_INVALID",
    ],
    [
      "IP literal",
      {
        skillId: "summarizer",
        allowedDomains: ["127.0.0.1"],
        declassificationId: "decision:1",
      },
      "CC_BUNDLED_SKILL_NETWORK_DOMAIN_INVALID",
    ],
    [
      "missing declassification decision",
      {
        skillId: "summarizer",
        allowedDomains: ["example.com"],
      },
      "CC_BUNDLED_SKILL_NETWORK_DECLASSIFICATION_REQUIRED",
    ],
  ])("rejects runtime policy with %s", (_label, policy, code) => {
    expect(() =>
      createBundledSkillRuntimeNetworkBroker(policy, {
        https: harness.https,
        auditSink: vi.fn(),
      }),
    ).toThrow(expect.objectContaining({ code }));
    expect(harness.https.request).not.toHaveBeenCalled();
  });

  it("requires an authentic broker scoped to the executing Skill", () => {
    const broker = createBundledSkillRuntimeNetworkBroker(
      {
        skillId: "summarizer",
        allowedDomains: ["example.com"],
        declassificationId: "decision:summary-1",
      },
      { https: harness.https, auditSink: vi.fn() },
    );

    expect(
      requireBundledSkillRuntimeNetworkBroker(
        { networkBroker: broker },
        "summarizer",
      ),
    ).toBe(broker);
    expect(() =>
      requireBundledSkillRuntimeNetworkBroker(
        { networkBroker: { request: vi.fn() } },
        "summarizer",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_NETWORK_BROKER_UNAVAILABLE",
      }),
    );
    expect(() =>
      requireBundledSkillRuntimeNetworkBroker(
        { networkBroker: broker },
        "http-client",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_NETWORK_AUTHORITY_MISMATCH",
      }),
    );
  });

  it("brands a high-level fixed-policy broker without accepting new domains", async () => {
    const broker = createBundledSkillFixedNetworkBroker("image-generator", {
      https: harness.https,
      auditSink: vi.fn(),
    });
    expect(
      requireBundledSkillRuntimeNetworkBroker(
        { networkBroker: broker },
        "image-generator",
      ),
    ).toBe(broker);

    await expect(
      broker.request({ url: "https://example.com/image", method: "POST" }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
    });
    expect(harness.https.request).not.toHaveBeenCalled();
  });

  it("serves a bounded runtime request and audits its decision ID", async () => {
    const auditSink = vi.fn();
    const broker = createBundledSkillRuntimeNetworkBroker(
      {
        skillId: "http-client",
        allowedDomains: ["example.com"],
        declassificationId: "decision:http-42",
      },
      { https: harness.https, auditSink },
    );
    const responsePromise = broker.request({
      url: "https://example.com/data?secret=not-audited",
      method: "POST",
      headers: { Authorization: "Bearer not-audited" },
      body: "payload",
      timeout: 1234,
      maxResponseBytes: 1024,
    });
    const res = new EventEmitter();
    res.statusCode = 201;
    res.statusMessage = "Created";
    res.headers = { "Content-Type": "application/json" };
    res.destroy = vi.fn();
    harness.calls[0].callback(res);
    res.emit("data", '{"ok":true}');
    res.emit("end");

    await expect(responsePromise).resolves.toMatchObject({
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });
    expect(harness.calls[0].end.mock.calls[0][0]).toBe("payload");
    expect(harness.calls[0].req.setTimeout).toHaveBeenCalledWith(
      1234,
      expect.any(Function),
    );
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "http-client",
        declassificationId: "decision:http-42",
        hostname: "example.com",
      }),
    );
    expect(JSON.stringify(auditSink.mock.calls)).not.toContain("not-audited");
  });

  it("revalidates redirects and strips credentials across origins", async () => {
    const broker = createBundledSkillRuntimeNetworkBroker(
      {
        skillId: "api-gateway",
        allowedDomains: ["api.example.com", "login.example.com"],
        declassificationId: "decision:redirect-1",
      },
      { https: harness.https, auditSink: vi.fn() },
    );
    const responsePromise = broker.request({
      url: "https://api.example.com/start",
      headers: { Authorization: "Bearer secret", Cookie: "session=secret" },
    });
    const first = new EventEmitter();
    first.statusCode = 302;
    first.headers = { location: "https://login.example.com/final" };
    first.destroy = vi.fn();
    harness.calls[0].callback(first);
    first.emit("end");
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));
    const second = new EventEmitter();
    second.statusCode = 200;
    second.statusMessage = "OK";
    second.headers = {};
    second.destroy = vi.fn();
    harness.calls[1].callback(second);
    second.emit("data", "done");
    second.emit("end");

    await expect(responsePromise).resolves.toMatchObject({
      status: 200,
      body: "done",
    });
    expect(harness.calls[1].options.headers).not.toHaveProperty(
      "Authorization",
    );
    expect(harness.calls[1].options.headers).not.toHaveProperty("Cookie");
  });

  it("denies a redirect to a domain outside the runtime allowlist", async () => {
    const broker = createBundledSkillRuntimeNetworkBroker(
      {
        skillId: "summarizer",
        allowedDomains: ["example.com"],
        declassificationId: "decision:redirect-2",
      },
      { https: harness.https, auditSink: vi.fn() },
    );
    const responsePromise = broker.request({ url: "https://example.com/" });
    const first = new EventEmitter();
    first.statusCode = 302;
    first.headers = { location: "https://attacker.example.net/" };
    first.destroy = vi.fn();
    harness.calls[0].callback(first);
    first.emit("end");

    await expect(responsePromise).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
    });
    expect(harness.calls).toHaveLength(1);
  });

  it("pins HTTPS, port, DNS lookup, SNI, limits, and minimal audit fields", () => {
    const auditSink = vi.fn();
    const client = createBundledSkillHttpsClient("github-manager", {
      https: harness.https,
      auditSink,
    });
    const response = vi.fn();
    const req = client.request(
      {
        hostname: "api.github.com",
        path: "/repos/openai/codex?token=do-not-audit",
        method: "POST",
        headers: { Authorization: "Bearer do-not-audit" },
      },
      response,
    );

    expect(req).toBe(harness.calls[0].req);
    expect(harness.calls[0].options).toMatchObject({
      protocol: "https:",
      hostname: "api.github.com",
      port: 443,
      rejectUnauthorized: true,
      servername: "api.github.com",
    });
    expect(harness.calls[0].options.lookup).toEqual(expect.any(Function));
    expect(harness.calls[0].options.agent).toBeUndefined();
    expect(req.setTimeout).toHaveBeenCalledWith(30_000, expect.any(Function));
    expect(auditSink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(auditSink.mock.calls[0][0])).not.toContain(
      "do-not-audit",
    );
  });

  it.each([
    [
      "unreviewed Skill",
      () => createBundledSkillHttpsClient("unknown-skill"),
      "CC_BUNDLED_SKILL_EGRESS_POLICY_MISSING",
    ],
    [
      "non-HTTPS target",
      () =>
        createBundledSkillHttpsClient("github-manager", {
          https: harness.https,
          auditSink: vi.fn(),
        }).request("http://api.github.com/repos"),
      "CC_BUNDLED_SKILL_EGRESS_HTTPS_REQUIRED",
    ],
    [
      "unlisted domain",
      () =>
        createBundledSkillHttpsClient("github-manager", {
          https: harness.https,
          auditSink: vi.fn(),
        }).request("https://example.com/"),
      "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
    ],
    [
      "nonstandard port",
      () =>
        createBundledSkillHttpsClient("github-manager", {
          https: harness.https,
          auditSink: vi.fn(),
        }).request("https://api.github.com:8443/"),
      "CC_BUNDLED_SKILL_EGRESS_PORT_DENIED",
    ],
    [
      "custom transport",
      () =>
        createBundledSkillHttpsClient("github-manager", {
          https: harness.https,
          auditSink: vi.fn(),
        }).request({
          hostname: "api.github.com",
          agent: {},
        }),
      "CC_BUNDLED_SKILL_EGRESS_OVERRIDE_DENIED",
    ],
    [
      "custom TLS verifier",
      () =>
        createBundledSkillHttpsClient("github-manager", {
          https: harness.https,
          auditSink: vi.fn(),
        }).request({
          hostname: "api.github.com",
          checkServerIdentity() {},
        }),
      "CC_BUNDLED_SKILL_EGRESS_OVERRIDE_DENIED",
    ],
    [
      "custom Host header",
      () =>
        createBundledSkillHttpsClient("github-manager", {
          https: harness.https,
          auditSink: vi.fn(),
        }).request({
          hostname: "api.github.com",
          headers: { Host: "example.com" },
        }),
      "CC_BUNDLED_SKILL_EGRESS_OVERRIDE_DENIED",
    ],
  ])("fails closed for %s", (_label, action, code) => {
    expect(action).toThrow(expect.objectContaining({ code }));
    expect(harness.https.request).not.toHaveBeenCalled();
  });

  it("rejects every DNS answer when any address is private", async () => {
    const lookup = vi.fn((_hostname, _options, callback) =>
      callback(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    );
    const auditSink = vi.fn();
    const client = createBundledSkillHttpsClient("github-manager", {
      https: harness.https,
      lookup,
      auditSink,
    });
    client.request("https://api.github.com/");
    const error = await new Promise((resolve) => {
      harness.calls[0].options.lookup(
        "api.github.com",
        { all: true },
        (lookupError) => resolve(lookupError),
      );
    });

    expect(error).toMatchObject({ code: "MCP_EGRESS_ADDRESS_DENIED" });
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "denied",
        reason: "MCP_EGRESS_ADDRESS_DENIED",
      }),
    );
  });

  it("audits policy denials without opening a socket", () => {
    const auditSink = vi.fn();
    const client = createBundledSkillHttpsClient("github-manager", {
      https: harness.https,
      auditSink,
    });

    expect(() => client.request("https://example.com/private")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
      }),
    );
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "denied",
        reason: "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
        hostname: "example.com",
      }),
    );
    expect(harness.https.request).not.toHaveBeenCalled();
  });

  it("destroys oversized requests and responses", () => {
    const client = createBundledSkillHttpsClient("github-manager", {
      https: harness.https,
      auditSink: vi.fn(),
      maxRequestBytes: 4,
      maxResponseBytes: 4,
    });
    const responseCallback = vi.fn();
    const req = client.request("https://api.github.com/", responseCallback);

    expect(req.write("12345")).toBe(false);
    expect(req.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_EGRESS_REQUEST_TOO_LARGE",
      }),
    );

    const res = new EventEmitter();
    res.destroy = vi.fn();
    harness.calls[0].callback(res);
    res.emit("data", Buffer.from("12345"));
    expect(responseCallback).toHaveBeenCalledWith(res);
    expect(res.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_EGRESS_RESPONSE_TOO_LARGE",
      }),
    );
  });

  it("fails before opening a socket when audit is unavailable", () => {
    const client = createBundledSkillHttpsClient("github-manager", {
      https: harness.https,
      auditSink() {
        throw new Error("audit unavailable");
      },
    });

    expect(() => client.request("https://api.github.com/")).toThrow(
      "audit unavailable",
    );
    expect(harness.https.request).not.toHaveBeenCalled();
  });
});

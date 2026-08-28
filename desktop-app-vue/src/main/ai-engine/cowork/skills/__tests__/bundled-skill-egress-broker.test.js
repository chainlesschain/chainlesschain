import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_EGRESS_POLICIES,
  createBundledSkillHttpsClient,
} = require("../bundled-skill-egress-broker.js");

const SKILLS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BROKERED_SKILL_IDS = Object.freeze([
  "github-manager",
  "google-workspace",
  "news-monitor",
  "notion",
  "tavily-search",
  "weather",
  "youtube-summarizer",
]);

function createHttpsHarness() {
  const calls = [];
  const https = {
    request: vi.fn((options, callback) => {
      const req = new EventEmitter();
      req.write = vi.fn(() => true);
      req.end = vi.fn(() => req);
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      calls.push({ options, callback, req });
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
    for (const skillId of BROKERED_SKILL_IDS) {
      const source = readFileSync(
        path.join(SKILLS_DIRECTORY, "builtin", skillId, "handler.js"),
        "utf8",
      );
      expect(source, skillId).toContain("bundled-skill-egress-broker.js");
      expect(source, skillId).not.toMatch(
        /require\(["'](?:node:)?https?["']\)/,
      );
      expect(source, skillId).not.toMatch(/require\(["']axios["']\)/);
    }
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

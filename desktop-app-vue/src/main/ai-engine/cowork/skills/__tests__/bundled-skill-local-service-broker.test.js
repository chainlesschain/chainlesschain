import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_LOCAL_SERVICE_POLICIES,
  createBundledSkillLocalServiceBroker,
  requireBundledSkillLocalServiceBroker,
} = require("../bundled-skill-local-service-broker.js");

const SKILLS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function createHttpHarness() {
  const calls = [];
  const http = {
    request: vi.fn((options, callback) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      req.end = vi.fn();
      req.setTimeout = vi.fn();
      calls.push({ callback, options, req });
      return req;
    }),
  };
  return { calls, http };
}

function createBroker(skillId, serviceId, baseUrl, harness, overrides = {}) {
  return createBundledSkillLocalServiceBroker(
    {
      skillId,
      serviceId,
      baseUrl,
      authorityId: `test:${serviceId}`,
      ...overrides,
    },
    { http: harness.http, auditSink: vi.fn() },
  );
}

describe("bundled Skill local service broker", () => {
  let harness;

  beforeEach(() => {
    harness = createHttpHarness();
  });

  it("ships only frozen Skill/service route policies", () => {
    expect(Object.keys(BUNDLED_SKILL_LOCAL_SERVICE_POLICIES).sort()).toEqual([
      "free-model-manager",
      "image-generator",
    ]);
    for (const policy of Object.values(BUNDLED_SKILL_LOCAL_SERVICE_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.routes)).toBe(true);
      for (const methods of Object.values(policy.routes)) {
        expect(Object.isFrozen(methods)).toBe(true);
      }
    }
  });

  it("keeps migrated handlers off raw network modules and creator authority", () => {
    for (const skillId of ["free-model-manager", "image-generator"]) {
      const source = readFileSync(
        path.join(SKILLS_DIRECTORY, "builtin", skillId, "handler.js"),
        "utf8",
      );
      expect(source, skillId).toContain(
        "requireBundledSkillLocalServiceBroker",
      );
      expect(source, skillId).not.toContain(
        "createBundledSkillLocalServiceBroker",
      );
      expect(source, skillId).not.toMatch(
        /require\(["'](?:node:)?https?["']\)/,
      );
      expect(source, skillId).not.toMatch(/require\(["']axios["']\)/);
    }
  });

  it.each([
    ["missing policy", undefined, "CC_BUNDLED_SKILL_LOCAL_POLICY_INVALID"],
    [
      "unreviewed service",
      {
        skillId: "free-model-manager",
        serviceId: "stable-diffusion",
        baseUrl: "http://localhost:11434/",
        authorityId: "decision:1",
      },
      "CC_BUNDLED_SKILL_LOCAL_SERVICE_DENIED",
    ],
    [
      "missing authority",
      {
        skillId: "free-model-manager",
        serviceId: "ollama",
        baseUrl: "http://localhost:11434/",
      },
      "CC_BUNDLED_SKILL_LOCAL_AUTHORITY_REQUIRED",
    ],
    [
      "remote host",
      {
        skillId: "free-model-manager",
        serviceId: "ollama",
        baseUrl: "http://example.com:11434/",
        authorityId: "decision:1",
      },
      "CC_BUNDLED_SKILL_LOCAL_TARGET_DENIED",
    ],
    [
      "HTTPS target",
      {
        skillId: "free-model-manager",
        serviceId: "ollama",
        baseUrl: "https://localhost:11434/",
        authorityId: "decision:1",
      },
      "CC_BUNDLED_SKILL_LOCAL_TARGET_DENIED",
    ],
    [
      "base path",
      {
        skillId: "free-model-manager",
        serviceId: "ollama",
        baseUrl: "http://localhost:11434/api/",
        authorityId: "decision:1",
      },
      "CC_BUNDLED_SKILL_LOCAL_TARGET_DENIED",
    ],
    [
      "privileged port",
      {
        skillId: "free-model-manager",
        serviceId: "ollama",
        baseUrl: "http://localhost:80/",
        authorityId: "decision:1",
      },
      "CC_BUNDLED_SKILL_LOCAL_PORT_DENIED",
    ],
  ])("rejects %s", (_label, policy, code) => {
    expect(() =>
      createBundledSkillLocalServiceBroker(policy, {
        http: harness.http,
        auditSink: vi.fn(),
      }),
    ).toThrow(expect.objectContaining({ code }));
    expect(harness.http.request).not.toHaveBeenCalled();
  });

  it("requires an authentic broker with matching Skill and service scope", () => {
    const broker = createBroker(
      "free-model-manager",
      "ollama",
      "http://localhost:11434/",
      harness,
    );
    expect(
      requireBundledSkillLocalServiceBroker(
        { localServiceBroker: broker },
        "free-model-manager",
        "ollama",
      ),
    ).toBe(broker);
    expect(() =>
      requireBundledSkillLocalServiceBroker(
        { localServiceBroker: { request: vi.fn() } },
        "free-model-manager",
        "ollama",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_LOCAL_BROKER_UNAVAILABLE",
      }),
    );
    expect(() =>
      requireBundledSkillLocalServiceBroker(
        { localServiceBroker: broker },
        "image-generator",
        "stable-diffusion",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_LOCAL_AUTHORITY_MISMATCH",
      }),
    );
  });

  it("pins localhost to loopback and sends only a reviewed route", async () => {
    const auditSink = vi.fn();
    const broker = createBundledSkillLocalServiceBroker(
      {
        skillId: "free-model-manager",
        serviceId: "ollama",
        baseUrl: "http://localhost:12434/",
        authorityId: "decision:ollama-1",
      },
      { http: harness.http, auditSink },
    );
    const responsePromise = broker.request({
      path: "/api/show",
      method: "POST",
      body: { name: "llama3:8b" },
      timeout: 1234,
    });
    const res = new EventEmitter();
    res.statusCode = 200;
    res.statusMessage = "OK";
    res.headers = { "content-type": "application/json" };
    res.destroy = vi.fn();
    harness.calls[0].callback(res);
    res.emit("data", '{"details":{}}');
    res.emit("end");

    await expect(responsePromise).resolves.toMatchObject({
      status: 200,
      body: '{"details":{}}',
    });
    expect(harness.calls[0].options).toMatchObject({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: 12434,
      path: "/api/show",
      method: "POST",
      agent: false,
    });
    expect(harness.calls[0].req.setTimeout).toHaveBeenCalledWith(
      1234,
      expect.any(Function),
    );
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        authorityId: "decision:ollama-1",
        serviceId: "ollama",
        route: "/api/show",
      }),
    );
    expect(JSON.stringify(auditSink.mock.calls)).not.toContain("llama3:8b");
  });

  it.each([
    ["absolute target", "http://example.com/api/tags", "GET"],
    ["query string", "/api/tags?target=other", "GET"],
    ["unknown route", "/api/generate", "POST"],
    ["wrong method", "/api/delete", "GET"],
  ])("denies %s before opening a socket", async (_label, route, method) => {
    const broker = createBroker(
      "free-model-manager",
      "ollama",
      "http://127.0.0.1:11434/",
      harness,
    );
    await expect(broker.request({ path: route, method })).rejects.toMatchObject(
      {
        code: "CC_BUNDLED_SKILL_LOCAL_ROUTE_DENIED",
      },
    );
    expect(harness.http.request).not.toHaveBeenCalled();
  });

  it("fails before opening a socket when audit is unavailable", async () => {
    const broker = createBundledSkillLocalServiceBroker(
      {
        skillId: "image-generator",
        serviceId: "stable-diffusion",
        baseUrl: "http://localhost:7860/",
        authorityId: "decision:sd-1",
      },
      {
        http: harness.http,
        auditSink() {
          throw new Error("audit unavailable");
        },
      },
    );

    await expect(
      broker.request({ path: "/sdapi/v1/txt2img", method: "POST" }),
    ).rejects.toThrow("audit unavailable");
    expect(harness.http.request).not.toHaveBeenCalled();
  });

  it("destroys an oversized response", async () => {
    const broker = createBroker(
      "image-generator",
      "stable-diffusion",
      "http://[::1]:7860/",
      harness,
    );
    const responsePromise = broker.request({
      path: "/sdapi/v1/txt2img",
      method: "POST",
      maxResponseBytes: 4,
    });
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.destroy = vi.fn();
    harness.calls[0].callback(res);
    res.emit("data", "12345");

    await expect(responsePromise).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_LOCAL_RESPONSE_TOO_LARGE",
    });
    expect(res.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_LOCAL_RESPONSE_TOO_LARGE",
      }),
    );
  });
});

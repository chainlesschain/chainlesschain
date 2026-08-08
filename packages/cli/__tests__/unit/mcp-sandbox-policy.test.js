import { describe, expect, it, vi } from "vitest";
import {
  MCP_SANDBOX_POLICY_INVALID_CODE,
  MCP_STDIO_CWD_INVALID_CODE,
  normalizeMcpSandboxPolicy,
  readMcpStdioCwd,
} from "../../src/lib/mcp-sandbox-policy.js";

function expectInvalid(value) {
  try {
    normalizeMcpSandboxPolicy(value);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBe(MCP_SANDBOX_POLICY_INVALID_CODE);
    return;
  }
  throw new Error("expected sandbox policy normalization to fail");
}

describe("normalizeMcpSandboxPolicy", () => {
  it("treats absent, null, and empty policies as no declared policy", () => {
    expect(normalizeMcpSandboxPolicy(undefined)).toBeNull();
    expect(normalizeMcpSandboxPolicy(null)).toBeNull();
    expect(normalizeMcpSandboxPolicy({})).toBeNull();
    expect(normalizeMcpSandboxPolicy({ requiredBoundaries: [] })).toBeNull();
  });

  it("sorts, de-duplicates, and deeply freezes supported boundaries", () => {
    const normalized = normalizeMcpSandboxPolicy({
      requiredBoundaries: ["network", "filesystem", "network"],
    });

    expect(normalized).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.requiredBoundaries)).toBe(true);
  });

  it("allows a null-prototype policy containing own data", () => {
    const policy = Object.create(null);
    policy.requiredBoundaries = ["network"];
    expect(normalizeMcpSandboxPolicy(policy)).toEqual({
      requiredBoundaries: ["network"],
    });
  });

  it("rejects internal boundaries and unknown fields", () => {
    for (const boundary of [
      "code-snapshot",
      "process-exec",
      "process-tree",
      "resource-limits",
      "privilege-reduction",
      "unknown",
    ]) {
      expectInvalid({ requiredBoundaries: [boundary] });
    }
    expectInvalid({ requiredBoundaries: ["network"], profile: "strict" });
    expectInvalid(
      Object.defineProperty({}, Symbol("hidden"), { value: "strict" }),
    );
    expectInvalid({ requiredBoundaries: Array(33).fill("network") });
  });

  it("does not stringify attacker-controlled boundary values", () => {
    const toString = vi.fn(() => "network");
    expectInvalid({ requiredBoundaries: [{ toString }] });
    expect(toString).not.toHaveBeenCalled();
  });

  it("rejects Proxy values before invoking their traps", () => {
    const get = vi.fn(() => {
      throw new Error("must not run");
    });
    const ownKeys = vi.fn(() => {
      throw new Error("must not run");
    });
    const policy = new Proxy({}, { get, ownKeys });
    const boundaries = new Proxy([], { get, ownKeys });

    expectInvalid(policy);
    expectInvalid({ requiredBoundaries: boundaries });
    expect(get).not.toHaveBeenCalled();
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it("rejects accessors, inherited fields, sparse arrays, and array extras", () => {
    const getter = vi.fn(() => ["network"]);
    const accessorPolicy = Object.defineProperty({}, "requiredBoundaries", {
      enumerable: true,
      get: getter,
    });
    expectInvalid(accessorPolicy);
    expect(getter).not.toHaveBeenCalled();

    expectInvalid(Object.create({ requiredBoundaries: ["network"] }));
    expectInvalid({ requiredBoundaries: new Array(1) });

    const withExtra = ["network"];
    withExtra.extra = "filesystem";
    expectInvalid({ requiredBoundaries: withExtra });
  });

  it("uses the supplied label in validation errors", () => {
    expect(() =>
      normalizeMcpSandboxPolicy("strict", { label: "server.sandboxPolicy" }),
    ).toThrow(/server\.sandboxPolicy/);
  });
});

describe("readMcpStdioCwd", () => {
  it("distinguishes absence, explicit clear, and a valid path", () => {
    expect(readMcpStdioCwd({})).toEqual({ present: false, cwd: null });
    expect(readMcpStdioCwd({ cwd: null })).toEqual({
      present: true,
      cwd: null,
    });
    expect(readMcpStdioCwd({ cwd: "" })).toEqual({
      present: true,
      cwd: null,
    });
    expect(readMcpStdioCwd({ cwd: "services/strict" })).toEqual({
      present: true,
      cwd: "services/strict",
    });
  });

  it("rejects invalid values, accessors, NUL bytes, and Proxies fail-closed", () => {
    for (const cwd of [42, false, [], {}, "bad\0path"]) {
      expect(() => readMcpStdioCwd({ cwd })).toThrow(
        expect.objectContaining({ code: MCP_STDIO_CWD_INVALID_CODE }),
      );
    }

    const getter = vi.fn(() => "services/strict");
    const accessor = Object.defineProperty({}, "cwd", {
      enumerable: true,
      get: getter,
    });
    expect(() => readMcpStdioCwd(accessor)).toThrow(
      expect.objectContaining({ code: MCP_STDIO_CWD_INVALID_CODE }),
    );
    expect(getter).not.toHaveBeenCalled();

    const get = vi.fn();
    expect(() => readMcpStdioCwd(new Proxy({}, { get }))).toThrow(
      expect.objectContaining({ code: MCP_STDIO_CWD_INVALID_CODE }),
    );
    expect(get).not.toHaveBeenCalled();
  });
});

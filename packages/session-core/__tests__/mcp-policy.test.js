import { describe, it, expect } from "vitest";
import {
  TRANSPORTS,
  inferTransport,
  validateMcpServer,
  filterMcpServers,
  annotateCompatibility,
} from "../lib/mcp-policy.js";

describe("inferTransport", () => {
  it("uses explicit transport", () => {
    expect(inferTransport({ transport: "stdio" })).toBe("stdio");
    expect(inferTransport({ transport: "HTTP" })).toBe("http");
  });
  it("infers http from url", () => {
    expect(inferTransport({ url: "https://x/mcp" })).toBe("https");
    expect(inferTransport({ url: "http://x/mcp" })).toBe("http");
    expect(inferTransport({ url: "wss://x/mcp" })).toBe("wss");
  });
  it("infers stdio when command present", () => {
    expect(inferTransport({ command: "npx" })).toBe("stdio");
  });
  it("returns null when undeterminable", () => {
    expect(inferTransport({})).toBeNull();
    expect(inferTransport(null)).toBeNull();
  });
});

describe("validateMcpServer — local mode", () => {
  it("allows stdio", () => {
    const r = validateMcpServer({ transport: "stdio", command: "npx" }, "local");
    expect(r.allowed).toBe(true);
  });
  it("allows http", () => {
    expect(validateMcpServer({ url: "https://x" }, "local").allowed).toBe(true);
  });
});

describe("validateMcpServer — hosted mode", () => {
  it("rejects stdio in hosted", () => {
    const r = validateMcpServer({ transport: "stdio", command: "npx" }, "hosted");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/stdio.*hosted/);
  });
  it("accepts remote transports", () => {
    expect(validateMcpServer({ url: "https://x" }, "hosted").allowed).toBe(true);
    expect(validateMcpServer({ transport: "sse", url: "https://x" }, "hosted").allowed).toBe(
      true
    );
  });
});

describe("validateMcpServer — lan mode", () => {
  it("rejects stdio in lan", () => {
    expect(validateMcpServer({ command: "npx" }, "lan").allowed).toBe(false);
  });
  it("accepts ws/wss in lan", () => {
    expect(validateMcpServer({ url: "ws://192.168.1.10" }, "lan").allowed).toBe(true);
  });
});

describe("validateMcpServer — explicit modeCompatibility", () => {
  it("rejects when server excludes the current mode", () => {
    const r = validateMcpServer(
      { url: "https://x", modeCompatibility: ["local"] },
      "hosted"
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/modeCompatibility/);
  });
  it("cannot widen beyond transport rules", () => {
    // stdio + modeCompatibility=["hosted"] 仍然被 transport 规则挡住
    const r = validateMcpServer(
      { transport: "stdio", command: "npx", modeCompatibility: ["hosted"] },
      "hosted"
    );
    expect(r.allowed).toBe(false);
  });
});

describe("validateMcpServer — edge cases", () => {
  it("flags missing transport info", () => {
    const r = validateMcpServer({}, "local");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/infer transport/);
  });
  it("rejects unknown mode", () => {
    const r = validateMcpServer({ command: "npx" }, "bogus");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/unknown mode/);
  });
});

describe("filterMcpServers", () => {
  const servers = {
    fs: { transport: "stdio", command: "npx" },
    api: { url: "https://api.example.com" },
    broken: {},
  };

  it("splits into allowed/rejected in hosted mode", () => {
    const out = filterMcpServers(servers, "hosted");
    expect(Object.keys(out.allowed)).toEqual(["api"]);
    expect(out.rejected.map((r) => r.name).sort()).toEqual(["broken", "fs"]);
    expect(out.rejected.find((r) => r.name === "fs").reason).toMatch(/stdio/);
  });

  it("keeps all in local mode", () => {
    const out = filterMcpServers(servers, "local");
    expect(Object.keys(out.allowed).sort()).toEqual(["api", "fs"]);
    expect(out.rejected).toHaveLength(1); // broken
  });

  it("accepts array input", () => {
    const out = filterMcpServers(
      [
        { name: "fs", command: "npx" },
        { name: "api", url: "https://x" },
      ],
      "hosted"
    );
    expect(Object.keys(out.allowed)).toEqual(["api"]);
    expect(out.rejected[0].name).toBe("fs");
  });
});

describe("annotateCompatibility", () => {
  it("tags stdio as local-only", () => {
    const out = annotateCompatibility({ command: "npx" });
    expect(out._modeCompatibility).toEqual(["local"]);
  });
  it("tags https as all modes", () => {
    const out = annotateCompatibility({ url: "https://x" });
    expect(out._modeCompatibility.sort()).toEqual(["hosted", "lan", "local"]);
  });
});

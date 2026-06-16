/**
 * Unit tests for --strict-mcp-config in resolveAgentMcp (src/runtime/mcp-config.js).
 * strict → use ONLY the --mcp-config file batch; registered + IDE are skipped.
 */
import { describe, it, expect, vi } from "vitest";
import { resolveAgentMcp } from "../../src/runtime/mcp-config.js";

describe("resolveAgentMcp --strict-mcp-config", () => {
  const fileResult = { mcpClient: {}, connected: [{ server: "file" }] };

  function deps() {
    return {
      loadMcpConfig: vi.fn(async () => fileResult),
      loadRegisteredMcp: vi.fn(async () => ({
        connected: [{ server: "reg" }],
      })),
      loadProjectMcp: vi.fn(async (_o, d) => d.into || null),
      loadIdeMcp: vi.fn(async () => ({ connected: [{ server: "ide" }] })),
      isInIdeTerminal: () => true,
    };
  }

  it("strict: loads only the --mcp-config file, skips registered + project + IDE", async () => {
    const d = deps();
    const res = await resolveAgentMcp(
      { mcpConfigPath: "/x.json", db: {}, ide: true, strict: true },
      d,
    );
    expect(d.loadMcpConfig).toHaveBeenCalledTimes(1);
    expect(d.loadRegisteredMcp).not.toHaveBeenCalled();
    expect(d.loadProjectMcp).not.toHaveBeenCalled();
    expect(d.loadIdeMcp).not.toHaveBeenCalled();
    expect(res).toBe(fileResult);
  });

  it("non-strict: also loads registered + project .mcp.json + IDE", async () => {
    const d = deps();
    await resolveAgentMcp(
      { mcpConfigPath: "/x.json", db: {}, ide: true, strict: false },
      d,
    );
    expect(d.loadMcpConfig).toHaveBeenCalledTimes(1);
    expect(d.loadRegisteredMcp).toHaveBeenCalledTimes(1);
    expect(d.loadProjectMcp).toHaveBeenCalledTimes(1);
    expect(d.loadIdeMcp).toHaveBeenCalledTimes(1);
  });

  it("projectMcp:false skips the project .mcp.json layer", async () => {
    const d = deps();
    await resolveAgentMcp(
      { mcpConfigPath: "/x.json", db: {}, ide: true, projectMcp: false },
      d,
    );
    expect(d.loadRegisteredMcp).toHaveBeenCalledTimes(1);
    expect(d.loadProjectMcp).not.toHaveBeenCalled();
    expect(d.loadIdeMcp).toHaveBeenCalledTimes(1);
  });

  it("strict with no --mcp-config yields nothing (no MCP at all)", async () => {
    const d = deps();
    const res = await resolveAgentMcp({ db: {}, ide: true, strict: true }, d);
    expect(d.loadMcpConfig).not.toHaveBeenCalled();
    expect(d.loadRegisteredMcp).not.toHaveBeenCalled();
    expect(d.loadIdeMcp).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });
});

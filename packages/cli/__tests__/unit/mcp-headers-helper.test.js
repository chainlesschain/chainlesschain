import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import { MCPServerConfig } from "../../src/harness/mcp-client.js";
import {
  loadManagedMcp,
  loadPluginMcp,
  loadProjectMcp,
  loadRegisteredMcp,
  parseMcpServers,
} from "../../src/runtime/mcp-config.js";
import {
  readProjectMcpRows,
  writeProjectMcpServer,
} from "../../src/commands/mcp.js";

function makeClient() {
  const connects = [];
  return {
    connects,
    servers: new Map(),
    async connect(name, config) {
      connects.push({ name, config });
      this.servers.set(name, { config });
      return { tools: [], resources: [], prompts: [] };
    },
  };
}

function byName(client, name) {
  return client.connects.find((entry) => entry.name === name)?.config;
}

let temporaryRoot;
let projectRoot;
let projectChild;

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-helper-"));
  projectRoot = path.join(temporaryRoot, "repo");
  projectChild = path.join(projectRoot, "packages", "app");
  fs.mkdirSync(projectChild, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".git"), "gitdir: test\n", "utf8");
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("MCP headersHelper configuration fidelity", () => {
  it("parses only non-empty string helpers", () => {
    const parsed = parseMcpServers({
      mcpServers: {
        valid: { command: "node", headersHelper: "  helper command  " },
        blank: { command: "node", headersHelper: "   " },
        malformed: { command: "node", headersHelper: ["helper"] },
      },
    });

    expect(parsed.valid.headersHelper).toBe("  helper command  ");
    expect(parsed.blank).not.toHaveProperty("headersHelper");
    expect(parsed.malformed).not.toHaveProperty("headersHelper");
  });

  it("preserves valid helpers through managed loading and drops malformed values", async () => {
    const client = makeClient();
    await loadManagedMcp(
      {
        managedMcpServers: {
          valid: { command: "node", headersHelper: "managed-helper" },
          malformed: { command: "node", headersHelper: { command: "bad" } },
        },
      },
      { createClient: () => client },
    );

    expect(byName(client, "valid").headersHelper).toBe("managed-helper");
    expect(byName(client, "malformed")).not.toHaveProperty("headersHelper");
  });

  it("preserves valid helpers through project loading and drops malformed values", async () => {
    fs.writeFileSync(
      path.join(projectRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          valid: { command: "node", headersHelper: "project-helper" },
          malformed: { command: "node", headersHelper: 42 },
        },
      }),
      "utf8",
    );
    const client = makeClient();
    await loadProjectMcp(
      { cwd: projectChild, env: { CC_PROJECT_MCP: "1" } },
      {
        createClient: () => client,
        projectMcpTrust: {
          checkProjectMcpTrust: () => ({ status: "trusted" }),
          projectMcpRetrustRequested: () => false,
          recordProjectMcpTrust: () => true,
          issueProjectMcpWorkspaceAuthority: () => Object.freeze({}),
        },
      },
    );

    expect(byName(client, "valid").headersHelper).toBe("project-helper");
    expect(byName(client, "malformed")).not.toHaveProperty("headersHelper");
  });

  it("preserves valid helpers through plugin loading and drops malformed values", async () => {
    const client = makeClient();
    await loadPluginMcp(
      { cwd: projectChild },
      {
        createClient: () => client,
        collect: () => ({
          servers: {
            valid: { command: "node", headersHelper: "plugin-helper" },
            malformed: { command: "node", headersHelper: true },
          },
          sources: [],
        }),
      },
    );

    expect(byName(client, "valid").headersHelper).toBe("plugin-helper");
    expect(byName(client, "malformed")).not.toHaveProperty("headersHelper");
  });

  it("preserves valid helpers through registered loading and drops malformed values", async () => {
    const client = makeClient();
    await loadRegisteredMcp(
      {},
      {
        createClient: () => client,
        makeServerConfig: () => ({
          getAutoConnect: () => [
            { name: "valid", command: "node", headersHelper: "db-helper" },
            { name: "malformed", command: "node", headersHelper: {} },
          ],
        }),
      },
    );

    expect(byName(client, "valid").headersHelper).toBe("db-helper");
    expect(byName(client, "malformed")).not.toHaveProperty("headersHelper");
  });

  it("round-trips helpers through MCPServerConfig without changing legacy scope", () => {
    const db = new MockDatabase();
    const config = new MCPServerConfig(db);
    config.add("valid", { command: "node", headersHelper: "db-helper" });
    config.add("malformed", { command: "node", headersHelper: ["bad"] });

    expect(db.tables.get("mcp_servers").columns).toContain(
      "headers_helper TEXT",
    );
    expect(config.get("valid", { allScopes: true })).toMatchObject({
      headersHelper: "db-helper",
      configScope: "user",
    });
    expect(config.get("malformed", { allScopes: true })).not.toHaveProperty(
      "headersHelper",
    );
  });

  it("migrates an existing MCP table with a headers_helper TEXT column", () => {
    const exec = vi.fn();
    const db = {
      exec,
      pragma: () =>
        [
          "name",
          "command",
          "args",
          "env",
          "auto_connect",
          "url",
          "transport",
          "headers",
          "config_scope",
          "config_source",
          "project_path",
          "display_name",
        ].map((name) => ({ name })),
    };

    new MCPServerConfig(db);
    expect(exec).toHaveBeenCalledWith(
      "ALTER TABLE mcp_servers ADD COLUMN headers_helper TEXT",
    );
  });

  it("round-trips helpers through project .mcp.json read/write", () => {
    writeProjectMcpServer(
      "valid",
      { command: "node", headersHelper: "project-helper" },
      projectChild,
    );
    writeProjectMcpServer(
      "malformed",
      { command: "node", headersHelper: { command: "bad" } },
      projectChild,
    );

    const document = JSON.parse(
      fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"),
    );
    expect(document.mcpServers.valid.headersHelper).toBe("project-helper");
    expect(document.mcpServers.malformed).not.toHaveProperty("headersHelper");
    const rows = readProjectMcpRows(projectChild);
    expect(rows.find((row) => row.name === "valid").headersHelper).toBe(
      "project-helper",
    );
    expect(rows.find((row) => row.name === "malformed")).not.toHaveProperty(
      "headersHelper",
    );
  });
});

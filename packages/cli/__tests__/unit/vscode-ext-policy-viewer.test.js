/**
 * Permission / policy viewer core (gap #10) — pure shaping / summarizing /
 * HTML rendering (escaping!) over `cc permissions list --json`,
 * `cc permissions recent --json`, `cc auto-mode config --json` +
 * `cc auto-mode defaults`, and the optional `cc mcp servers --json` section.
 * Headless (no `vscode`); the webview glue lives in ui/policy-view.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPolicyArgs,
  shapePermissionRules,
  shapeDenials,
  shapeAutoMode,
  shapeMcpServers,
  buildPolicyModel,
  summarizePolicy,
  describeRuleMatch,
  escapeHtml,
  renderPolicyHtml,
} from "../../../vscode-extension/src/policy-viewer.js";

const NOW = Date.parse("2026-07-11T12:00:00Z");

const PERM_JSON = {
  rules: {
    allow: ["Read", "Grep"],
    ask: ["Bash(git push:*)"],
    deny: ["Bash(rm:*)", "WebFetch"],
  },
  sources: {
    "allow:Read": "C:/repo/.claude/settings.json",
    "allow:Grep": "C:/Users/u/.claude/settings.json",
    "ask:Bash(git push:*)": "C:/repo/.claude/settings.local.json",
    "deny:Bash(rm:*)": "C:/managed/managed-settings.json",
    "deny:WebFetch": "C:/repo/.claude/settings.json",
  },
  files: ["C:/repo/.claude/settings.json"],
  managed: {
    allowManagedPermissionRulesOnly: true,
    requireSignedPlugins: true,
  },
  managedFile: "C:/managed/managed-settings.json",
};

const RECENT_JSON = {
  file: "C:/Users/u/.chainlesschain/recent-denials.json",
  count: 2,
  denials: [
    {
      at: NOW - 3600 * 1000,
      tool: "run_shell",
      summary: "rm -rf /",
      reason: "matched deny rule",
      via: "settings-rules",
      rule: "Bash(rm:*)",
      count: 3,
      sessionId: "sess-1",
      permissionMode: "auto",
    },
    {
      at: NOW - 60 * 1000,
      tool: "write_file",
      summary: "<script>x</script>.txt",
      via: "approval-gate",
      rule: null,
    },
  ],
};

const AUTOMODE_CONFIG_JSON = {
  schema: "chainlesschain.auto-mode/v1",
  defaults: { classifyAllShell: false },
  effective: { classifyAllShell: true },
  files: ["C:/repo/.claude/settings.json"],
  managedFile: null,
  decisions: {
    low: { decision: "allow", reason: "read-only", source: "default" },
    medium: { decision: "ask", reason: "custom medium", source: "settings" },
    high: { decision: "deny", reason: "never", source: "settings" },
  },
  rules: [
    {
      match: { tool: "run_shell", commandPattern: "git push*" },
      decision: "ask",
      reason: "pushes always confirm",
    },
  ],
  customized: true,
};

const AUTOMODE_DEFAULTS_JSON = {
  schema: "chainlesschain.auto-mode/v1",
  precedence: [
    "managed-settings",
    "permission-rules.deny",
    "permission-rules.ask",
    "permission-rules.allow",
    "shell-policy",
    "approval-gate",
    "hooks",
  ],
};

const MCP_JSON = [
  {
    name: "files",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    autoConnect: true,
    _allowed: true,
    _transport: "stdio",
  },
  {
    name: "evil",
    url: "http://example.com/mcp",
    transport: "http",
    _allowed: false,
    _reason: "http not allowed in lan mode",
  },
];

describe("buildPolicyArgs", () => {
  it("returns the exact read-only cc argv arrays the panel spawns", () => {
    expect(buildPolicyArgs()).toEqual({
      permissionsList: ["permissions", "list", "--json"],
      recentDenials: ["permissions", "recent", "--json", "-n", "20"],
      autoModeConfig: ["auto-mode", "config", "--json"],
      autoModeDefaults: ["auto-mode", "defaults"],
      mcpServers: ["mcp", "servers", "--json"],
    });
    expect(buildPolicyArgs({ denialLimit: 5 }).recentDenials).toContain("5");
  });
});

describe("shapePermissionRules", () => {
  it("groups rules with per-rule source and managed flag", () => {
    const shaped = shapePermissionRules(PERM_JSON);
    expect(shaped.groups.allow).toHaveLength(2);
    expect(shaped.groups.ask).toHaveLength(1);
    expect(shaped.groups.deny).toHaveLength(2);
    const rm = shaped.groups.deny.find((r) => r.rule === "Bash(rm:*)");
    expect(rm.managed).toBe(true);
    expect(rm.source).toBe("C:/managed/managed-settings.json");
    const read = shaped.groups.allow.find((r) => r.rule === "Read");
    expect(read.managed).toBe(false);
    expect(read.source).toBe("C:/repo/.claude/settings.json");
  });

  it("derives managed policy flags", () => {
    const shaped = shapePermissionRules(PERM_JSON);
    expect(shaped.managedFlags).toContain(
      "user/project permission rules disabled",
    );
    expect(shaped.managedFlags).toContain("signed plugin manifests required");
    expect(shaped.managedFile).toBe("C:/managed/managed-settings.json");
  });

  it("tolerates junk payloads", () => {
    const empty = shapePermissionRules(null);
    expect(empty.groups.allow).toEqual([]);
    expect(empty.managedFlags).toEqual([]);
    expect(shapePermissionRules({ rules: "junk" }).groups.deny).toEqual([]);
  });
});

describe("shapeDenials", () => {
  it("shapes rows most-recent-first (store appends oldest→newest)", () => {
    const rows = shapeDenials(RECENT_JSON);
    expect(rows).toHaveLength(2);
    expect(rows[0].tool).toBe("write_file"); // newer entry first
    expect(rows[1].tool).toBe("run_shell");
    expect(rows[1].count).toBe(3);
    expect(rows[1].rule).toBe("Bash(rm:*)");
    expect(rows[1].permissionMode).toBe("auto");
  });

  it("tolerates junk", () => {
    expect(shapeDenials(null)).toEqual([]);
    expect(shapeDenials({ denials: [null, 42, { tool: "x" }] })).toHaveLength(
      1,
    );
  });
});

describe("shapeAutoMode / describeRuleMatch", () => {
  it("builds the risk matrix in low/medium/high order with provenance", () => {
    const shaped = shapeAutoMode(AUTOMODE_CONFIG_JSON, AUTOMODE_DEFAULTS_JSON);
    expect(shaped.decisions.map((d) => d.riskLevel)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(shaped.decisions[1]).toMatchObject({
      decision: "ask",
      source: "settings",
    });
    expect(shaped.customized).toBe(true);
    expect(shaped.classifyAllShell).toBe(true);
  });

  it("keeps fine-grained rules in declaration order with a match label", () => {
    const shaped = shapeAutoMode(AUTOMODE_CONFIG_JSON, AUTOMODE_DEFAULTS_JSON);
    expect(shaped.fineRules).toHaveLength(1);
    expect(shaped.fineRules[0].match).toBe("tool=run_shell command=git push*");
    expect(shaped.fineRules[0].decision).toBe("ask");
    expect(describeRuleMatch({ riskLevel: "high" })).toBe("risk=high");
    expect(describeRuleMatch(null)).toBe("");
  });

  it("takes the precedence chain from the defaults document, in order", () => {
    const shaped = shapeAutoMode(AUTOMODE_CONFIG_JSON, AUTOMODE_DEFAULTS_JSON);
    expect(shaped.precedence[0]).toBe("managed-settings");
    expect(shaped.precedence[shaped.precedence.length - 1]).toBe("hooks");
    // defaults source failed → precedence just empty, never a crash
    expect(shapeAutoMode(AUTOMODE_CONFIG_JSON, null).precedence).toEqual([]);
  });
});

describe("shapeMcpServers", () => {
  it("shapes stdio and http servers with policy verdicts", () => {
    const rows = shapeMcpServers(MCP_JSON);
    expect(rows[0]).toMatchObject({
      name: "files",
      transport: "stdio",
      autoConnect: true,
      allowed: true,
    });
    expect(rows[0].target).toContain("npx");
    expect(rows[1]).toMatchObject({
      name: "evil",
      allowed: false,
      reason: "http not allowed in lan mode",
      target: "http://example.com/mcp",
    });
  });

  it("tolerates junk", () => {
    expect(shapeMcpServers(null)).toEqual([]);
    expect(shapeMcpServers([null, 42])).toEqual([]);
  });
});

describe("buildPolicyModel / summarizePolicy", () => {
  const fullModel = () =>
    buildPolicyModel({
      permissions: shapePermissionRules(PERM_JSON),
      denials: shapeDenials(RECENT_JSON),
      autoMode: shapeAutoMode(AUTOMODE_CONFIG_JSON, AUTOMODE_DEFAULTS_JSON),
      mcpServers: shapeMcpServers(MCP_JSON),
    });

  it("summarizes counts in one line", () => {
    const s = summarizePolicy(fullModel());
    expect(s).toContain("2 allow / 1 ask / 2 deny");
    expect(s).toContain("2 recent denials");
    expect(s).toContain("auto-mode customized");
    expect(s).toContain("2 MCP servers");
  });

  it("omits the MCP count when that source is unavailable (null)", () => {
    const s = summarizePolicy(buildPolicyModel({}));
    expect(s).toContain("0 allow / 0 ask / 0 deny");
    expect(s).not.toContain("MCP");
  });
});

describe("renderPolicyHtml (escaping + per-source failure tolerance)", () => {
  const fullModel = () =>
    buildPolicyModel({
      permissions: shapePermissionRules(PERM_JSON),
      denials: shapeDenials(RECENT_JSON),
      autoMode: shapeAutoMode(AUTOMODE_CONFIG_JSON, AUTOMODE_DEFAULTS_JSON),
      mcpServers: shapeMcpServers(MCP_JSON),
    });

  it("renders all four sections with the shaped content", () => {
    const html = renderPolicyHtml(fullModel(), { now: NOW });
    expect(html).toContain("Permission rules");
    expect(html).toContain("Bash(rm:*)");
    expect(html).toContain(">managed</span>");
    expect(html).toContain("Recent denials");
    expect(html).toContain("run_shell rm -rf /");
    expect(html).toContain("×3");
    expect(html).toContain("1h ago");
    expect(html).toContain("Auto-mode decisions");
    expect(html).toContain("autoMode.decisions (customized)");
    expect(html).toContain("Fine-grained rules");
    expect(html).toContain("Precedence chain");
    expect(html).toContain("managed-settings");
    expect(html).toContain("MCP servers");
    expect(html).toContain("blocked");
    expect(html).toContain("http not allowed in lan mode");
  });

  it("escapes hostile rules / summaries / paths everywhere", () => {
    const model = buildPolicyModel({
      permissions: shapePermissionRules({
        rules: { allow: ["<img src=x onerror=alert(1)>"], ask: [], deny: [] },
        sources: {
          "allow:<img src=x onerror=alert(1)>":
            "C:/repo/<script>evil</script>/settings.json",
        },
        files: [],
      }),
      denials: shapeDenials({
        denials: [
          {
            at: NOW - 1000,
            tool: "run_shell",
            summary: '"onmouseover="alert(1)',
            via: "policy",
          },
        ],
      }),
    });
    const html = renderPolicyHtml(model, { now: NOW });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>evil");
    expect(html).not.toContain('"onmouseover="alert');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;evil&lt;/script&gt;");
    expect(html).toContain("&quot;onmouseover=&quot;alert(1)");
  });

  it("failed sources become warning rows, never a blank panel", () => {
    const model = buildPolicyModel({
      autoMode: shapeAutoMode(AUTOMODE_CONFIG_JSON, AUTOMODE_DEFAULTS_JSON),
      errors: [
        { source: "cc permissions list", message: "spawn <b>ENOENT</b>" },
        { source: "cc mcp servers", message: "Database not available" },
      ],
    });
    const html = renderPolicyHtml(model, { now: NOW });
    expect(html).toContain("cc permissions list");
    expect(html).toContain("&lt;b&gt;ENOENT&lt;/b&gt;");
    expect(html).not.toContain("<b>ENOENT");
    expect(html).toContain("Database not available");
    // surviving section still renders
    expect(html).toContain("Auto-mode decisions");
    // unavailable MCP source (null) hides the section entirely
    expect(html).not.toContain("<h2>MCP servers</h2>");
    // empty-but-loaded permissions shows the empty message
    expect(html).toContain("No permission rules");
  });

  it("a loaded-but-empty MCP source still shows its section", () => {
    const html = renderPolicyHtml(buildPolicyModel({ mcpServers: [] }), {
      now: NOW,
    });
    expect(html).toContain("MCP servers");
    expect(html).toContain("No MCP servers configured");
  });

  it("escapeHtml covers the full special-character set", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("manifest wiring", () => {
  const ext = (rel) =>
    fileURLToPath(new URL("../../../vscode-extension/" + rel, import.meta.url));
  const pkg = JSON.parse(readFileSync(ext("package.json"), "utf-8"));

  it("declares the chainlesschain.policy.show command with an nls title", () => {
    const cmd = (pkg.contributes?.commands || []).find(
      (c) => c.command === "chainlesschain.policy.show",
    );
    expect(cmd).toBeTruthy();
    expect(cmd.title).toBe("%cmd.policy.show.title%");
  });

  it("has the title key in both nls files", () => {
    const en = JSON.parse(readFileSync(ext("package.nls.json"), "utf-8"));
    const zh = JSON.parse(readFileSync(ext("package.nls.zh-cn.json"), "utf-8"));
    expect(en["cmd.policy.show.title"]).toContain("Permissions & Policy");
    expect(zh["cmd.policy.show.title"]).toContain("权限与策略");
  });

  it("extension.js registers the command", () => {
    const src = readFileSync(ext("src/extension.js"), "utf-8");
    expect(src).toContain('"chainlesschain.policy.show"');
    expect(src).toContain("openPolicyViewer");
  });
});

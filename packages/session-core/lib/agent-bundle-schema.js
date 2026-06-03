/**
 * Agent Bundle Schema — 92_Deep_Agents_Deploy 借鉴落地方案 Phase 1
 *
 * 定义 ChainlessChain Agent Bundle 的约定式目录结构与 canonical schema.
 *
 * bundle 目录布局:
 *   agent-bundle/
 *   ├── chainless-agent.toml   (或 chainless-agent.json)
 *   ├── AGENTS.md
 *   ├── skills/
 *   ├── mcp.json
 *   ├── USER.md
 *   ├── policies/
 *   │   ├── approval.json
 *   │   └── sandbox.json
 *   └── manifests/
 *       └── capabilities.json
 */

const BUNDLE_FILES = Object.freeze({
  MANIFEST_TOML: "chainless-agent.toml",
  MANIFEST_JSON: "chainless-agent.json",
  AGENTS_MD: "AGENTS.md",
  USER_MD: "USER.md",
  SKILLS_DIR: "skills",
  MCP_JSON: "mcp.json",
  APPROVAL_POLICY: "policies/approval.json",
  SANDBOX_POLICY: "policies/sandbox.json",
  CAPABILITIES: "manifests/capabilities.json",
});

const BUNDLE_MODES = Object.freeze({
  LOCAL: "local",
  LAN: "lan",
  HOSTED: "hosted",
});

const VALID_MODES = new Set(Object.values(BUNDLE_MODES));

const DEFAULT_MANIFEST = Object.freeze({
  id: null,
  name: null,
  version: "0.1.0",
  defaultModel: null,
  mode: BUNDLE_MODES.LOCAL,
  sandbox: "thread",
});

/**
 * Canonical bundle shape (loader 的输出):
 *   {
 *     path: string,                    // bundle 目录绝对路径
 *     manifest: {                      // chainless-agent.toml/json 解析结果
 *       id, name, version, defaultModel, mode, sandbox
 *     },
 *     agentsMd: string|null,           // AGENTS.md 原文
 *     userMd: string|null,             // USER.md 原文 (user memory seed)
 *     skillsDir: string|null,          // skills/ 绝对路径 (未做递归解析)
 *     mcpConfig: object|null,          // mcp.json 解析结果
 *     approvalPolicy: object|null,     // policies/approval.json
 *     sandboxPolicy: object|null,      // policies/sandbox.json
 *     capabilities: object|null,       // manifests/capabilities.json
 *     warnings: string[]               // 非致命问题
 *   }
 */

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest must be an object"];
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push("manifest.id is required (string)");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("manifest.name is required (string)");
  }
  if (manifest.mode && !VALID_MODES.has(manifest.mode)) {
    errors.push(
      `manifest.mode must be one of ${Array.from(VALID_MODES).join(", ")}`
    );
  }
  return errors;
}

function validateBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== "object") {
    return ["bundle must be an object"];
  }
  errors.push(...validateManifest(bundle.manifest));
  if (bundle.mcpConfig !== null && typeof bundle.mcpConfig !== "object") {
    errors.push("mcpConfig must be an object or null");
  }
  if (bundle.sandboxPolicy) {
    // Phase 4: validate sandbox.json shape via sandbox-policy module (lazy require to avoid cycles).
    // eslint-disable-next-line global-require
    const { validateSandboxPolicy } = require("./sandbox-policy.js");
    errors.push(...validateSandboxPolicy(bundle.sandboxPolicy));
  }
  // Phase 3: hosted/lan 模式下用 mcp-policy 统一拦截不兼容 transport.
  // lazy require 避免与 mcp-policy 的循环依赖.
  if (bundle.mcpConfig && bundle.manifest) {
    const mode = bundle.manifest.mode || BUNDLE_MODES.LOCAL;
    if (mode !== BUNDLE_MODES.LOCAL) {
      const servers = bundle.mcpConfig.servers || bundle.mcpConfig.mcpServers;
      if (servers && typeof servers === "object") {
        // eslint-disable-next-line global-require
        const { filterMcpServers } = require("./mcp-policy.js");
        const { rejected } = filterMcpServers(servers, mode);
        for (const r of rejected) {
          errors.push(
            `mcp server "${r.name}" rejected in mode "${mode}": ${r.reason}`
          );
        }
      }
    }
  }
  return errors;
}

/**
 * 极简 TOML 子集解析器 — 支持:
 *   - key = "string" | number | true/false
 *   - [section]  单层 section
 *   - # 注释
 *   - 空行
 * 不支持 inline table / array / 多层嵌套, 对 bundle manifest 足够.
 */
function parseMinimalToml(text) {
  const out = {};
  let current = out;
  const lines = String(text).split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      const key = sectionMatch[1];
      out[key] = out[key] || {};
      current = out[key];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (/^".*"$/.test(value)) {
      value = value.slice(1, -1);
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1);
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (!Number.isNaN(Number(value))) {
      value = Number(value);
    }
    current[key] = value;
  }
  return out;
}

module.exports = {
  BUNDLE_FILES,
  BUNDLE_MODES,
  VALID_MODES,
  DEFAULT_MANIFEST,
  validateManifest,
  validateBundle,
  parseMinimalToml,
};

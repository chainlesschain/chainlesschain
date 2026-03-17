/**
 * CLI Command Skill Pack Generator
 *
 * Auto-generates SKILL.md + handler.js for each CLI domain pack.
 * Output goes to <userData>/skills/ (managed layer, globally available).
 *
 * Usage:
 *   import { generateCliPacks } from './generator.js';
 *   const result = await generateCliPacks({ force: false, dryRun: false });
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  CLI_PACK_DOMAINS,
  EXECUTION_MODE_DESCRIPTIONS,
  AGENT_MODE_COMMANDS,
  PACK_SCHEMA_VERSION,
} from "./schema.js";
import { getElectronUserDataDir } from "../paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Hash utilities ─────────────────────────────────────────────────

/**
 * Compute a version hash for a domain pack.
 * Hash changes when: schema version, CLI version, or command list changes.
 */
export function computePackHash(domainKey, domainDef, cliVersion) {
  const commands = Object.keys(domainDef.commands).sort().join(",");
  const raw = `${PACK_SCHEMA_VERSION}|${cliVersion}|${domainKey}|${commands}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Read the current CLI package version
 */
function getCliVersion() {
  try {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Read the version hash stored in an existing SKILL.md
 */
function readExistingHash(skillMdPath) {
  try {
    if (!fs.existsSync(skillMdPath)) return null;
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const match = content.match(/cli-version-hash:\s*["']?([a-f0-9]+)["']?/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── SKILL.md generator ─────────────────────────────────────────────

/**
 * Generate SKILL.md content for a domain pack
 */
export function generateSkillMd(domainKey, domainDef, hash) {
  const commandEntries = Object.entries(domainDef.commands);
  const allTags = domainDef.tags.join(", ");

  // Build commands documentation section
  const commandDocs = commandEntries
    .map(([cmd, info]) => {
      const subCmds =
        info.subcommands && info.subcommands.length > 0
          ? `\n  子命令: \`${info.subcommands.join("`、`")}\``
          : "";
      const example = info.example
        ? `\n  示例: \`chainlesschain ${info.example}\``
        : "";
      const agentNote =
        info.isAgentMode || AGENT_MODE_COMMANDS.has(cmd)
          ? "\n  ⚠️  此指令需要在终端中直接运行"
          : "";
      return `### \`${cmd}\`\n${info.description}${subCmds}${example}${agentNote}`;
    })
    .join("\n\n");

  // Build input format examples
  const inputExamples = commandEntries
    .filter((_, i) => i < 3)
    .map(([, info]) => info.example || "")
    .filter(Boolean)
    .map((ex) => `- "${ex}"`)
    .join("\n");

  const modeDesc = EXECUTION_MODE_DESCRIPTIONS[domainDef.executionMode] || "";
  const agentWarning =
    domainDef.executionMode === "agent"
      ? "\n\n> **注意**: 此技能包中的指令需要交互式终端，handler不会直接执行指令，而是返回完整的使用说明供Agent决策。"
      : "";

  return `---
name: ${domainKey}
display-name: ${domainDef.displayName}
description: ${domainDef.description}
version: 1.0.0
category: ${domainDef.category}
execution-mode: ${domainDef.executionMode}
cli-domain: ${domainKey.replace("cli-", "").replace("-pack", "")}
cli-version-hash: "${hash}"
tags: [${allTags}]
user-invocable: true
handler: handler.js
---

# ${domainDef.displayName}

${domainDef.description}${agentWarning}

## 执行模式

**${domainDef.executionMode}** — ${modeDesc}

## 调用方式

\`\`\`
chainlesschain skill run ${domainKey} "<command> [subcommand] [args] [--options]"
\`\`\`

**输入格式示例**:
${inputExamples}

## 包含指令

${commandDocs}

## 全局选项

所有指令支持以下全局选项:
- \`--verbose\` 详细日志输出
- \`--quiet\` 静默模式
- \`--json\` JSON格式输出（部分指令支持）

## 提供商配置（适用于AI相关指令）

- \`--provider <name>\` 指定LLM提供商 (ollama/openai/anthropic/deepseek等)
- \`--model <name>\` 指定模型名称
- \`--api-key <key>\` API密钥
`;
}

// ── Handler generator ──────────────────────────────────────────────

/**
 * Generate handler.js content for a direct-execution pack
 */
function generateDirectHandler(domainKey, domainDef) {
  const commandList = Object.keys(domainDef.commands).join('", "');
  const commandGuide = Object.entries(domainDef.commands)
    .map(
      ([cmd, info]) =>
        `    ${cmd}: '${info.example ? `chainlesschain ${info.example}` : `chainlesschain ${cmd}`}'`,
    )
    .join(",\n");

  return `/**
 * ${domainDef.displayName} — 直接执行处理器
 *
 * 执行模式: ${domainDef.executionMode}
 * 包含指令: ${Object.keys(domainDef.commands).join(", ")}
 *
 * 自动生成 — 请勿手动修改，运行 \`chainlesschain skill sync-cli\` 重新生成
 */

const { spawnSync } = require("child_process");

/** 解析输入字符串为指令+参数数组 */
function parseInput(input) {
  if (!input || !input.trim()) return { args: [], raw: "" };
  // Shell-style tokenizer (handles quoted strings)
  const args = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const ch of input.trim()) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === " " && !inSingle && !inDouble) {
      if (current) { args.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return { args, raw: input.trim() };
}

/** 检测是否支持 --json 输出的指令 */
const JSON_SUPPORTED_COMMANDS = new Set([
  "note", "search", "did", "wallet", "org", "p2p",
  "session", "tokens", "llm", "skill", "mcp", "plugin",
  "bi", "lowcode", "compliance", "siem", "hook", "workflow", "a2a", "hmemory"
]);

const VALID_COMMANDS = new Set(["${commandList}"]);

const handler = {
  async init(_skill) {
    // No initialization needed for direct execution
  },

  async execute(task, context, _skill) {
    const input = task.input || task.params?.input || "";
    const { args, raw } = parseInput(input);

    if (!args.length) {
      return {
        success: false,
        error: "请提供要执行的指令。示例：\\n" + JSON.stringify({
${commandGuide}
        }, null, 2),
      };
    }

    const command = args[0];

    // Validate command belongs to this pack
    if (!VALID_COMMANDS.has(command)) {
      return {
        success: false,
        error: \`指令 "\${command}" 不在此技能包中。可用指令: \${[...VALID_COMMANDS].join(", ")}\`,
      };
    }

    // Build CLI args — add --json for structured output when supported
    const cliArgs = [...args];
    const useJson = JSON_SUPPORTED_COMMANDS.has(command) && !cliArgs.includes("--json");
    if (useJson) cliArgs.push("--json");

    // Execute via child process
    const result = spawnSync("chainlesschain", cliArgs, {
      encoding: "utf-8",
      shell: true,
      cwd: context.projectRoot || process.cwd(),
      timeout: 30000,
      env: { ...process.env },
    });

    if (result.error) {
      return {
        success: false,
        error: \`执行失败: \${result.error.message}\`,
        command: \`chainlesschain \${raw}\`,
      };
    }

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const exitCode = result.status ?? -1;

    if (exitCode !== 0) {
      return {
        success: false,
        error: stderr || \`指令退出码: \${exitCode}\`,
        stdout,
        command: \`chainlesschain \${raw}\`,
      };
    }

    // Try to parse JSON output for structured result
    let parsed = null;
    if (useJson && stdout) {
      try { parsed = JSON.parse(stdout); } catch { /* plain text output */ }
    }

    return {
      success: true,
      message: \`chainlesschain \${cliArgs.slice(0, 2).join(" ")} 执行成功\`,
      result: parsed || stdout || "(无输出)",
      command: \`chainlesschain \${raw}\`,
    };
  },
};

module.exports = handler;
`;
}

/**
 * Generate handler.js content for agent-mode pack
 */
function generateAgentHandler(domainKey, domainDef) {
  const usageGuide = Object.entries(domainDef.commands)
    .map(([cmd, info]) => {
      const ex = info.example
        ? `chainlesschain ${info.example}`
        : `chainlesschain ${cmd}`;
      return `    { command: '${cmd}', description: '${info.description}', example: '${ex}' }`;
    })
    .join(",\n");

  return `/**
 * ${domainDef.displayName} — Agent模式处理器
 *
 * 执行模式: ${domainDef.executionMode}
 * ⚠️  此技能包中的指令需要交互式终端，不能通过子进程直接调用。
 *    handler返回使用说明，由上层Agent决策如何通知用户执行。
 *
 * 自动生成 — 请勿手动修改，运行 \`chainlesschain skill sync-cli\` 重新生成
 */

const COMMANDS = [
${usageGuide}
];

const handler = {
  async init(_skill) {},

  async execute(task, _context, _skill) {
    const input = (task.input || task.params?.input || "").trim();

    // Match requested command
    const requestedCmd = input.split(/\\s+/)[0] || "";
    const matched = requestedCmd
      ? COMMANDS.find(c => c.command === requestedCmd)
      : null;

    if (matched) {
      return {
        success: true,
        executionMode: "agent",
        message: \`\${matched.command} 需要在终端中交互式运行\`,
        result: {
          description: matched.description,
          howToRun: \`在终端中执行: \${matched.example}\`,
          note: "此指令需要交互式REPL，请直接在终端运行上方命令",
          options: {
            "--provider <name>": "LLM提供商 (ollama/openai/anthropic/...)",
            "--model <name>": "模型名称",
            "--session <id>": "恢复上次会话",
          },
        },
      };
    }

    // Return full command guide
    return {
      success: true,
      executionMode: "agent",
      message: "以下指令需要在终端中直接运行",
      result: {
        availableCommands: COMMANDS.map(c => ({
          command: c.command,
          description: c.description,
          example: c.example,
        })),
        note: "这些指令需要交互式终端 (REPL)，请直接在终端中运行对应命令",
      },
    };
  },
};

module.exports = handler;
`;
}

/**
 * Generate handler.js content for hybrid-mode pack
 */
function generateHybridHandler(domainKey, domainDef) {
  const agentCmds = Object.entries(domainDef.commands)
    .filter(([cmd, info]) => info.isAgentMode || AGENT_MODE_COMMANDS.has(cmd))
    .map(([cmd]) => `"${cmd}"`)
    .join(", ");

  const commandList = Object.keys(domainDef.commands).join('", "');
  const commandGuide = Object.entries(domainDef.commands)
    .filter(([cmd, info]) => !info.isAgentMode && !AGENT_MODE_COMMANDS.has(cmd))
    .map(
      ([cmd, info]) =>
        `    ${cmd}: '${info.example ? `chainlesschain ${info.example}` : `chainlesschain ${cmd}`}'`,
    )
    .join(",\n");

  return `/**
 * ${domainDef.displayName} — 混合执行处理器
 *
 * 执行模式: ${domainDef.executionMode}
 * Agent模式指令 (需终端): [${agentCmds || "无"}]
 * 其余指令通过子进程直接执行
 *
 * 自动生成 — 请勿手动修改，运行 \`chainlesschain skill sync-cli\` 重新生成
 */

const { spawnSync } = require("child_process");

const AGENT_ONLY_COMMANDS = new Set([${agentCmds}]);
const VALID_COMMANDS = new Set(["${commandList}"]);

function parseInput(input) {
  if (!input || !input.trim()) return { args: [], raw: "" };
  const args = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const ch of input.trim()) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === " " && !inSingle && !inDouble) {
      if (current) { args.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return { args, raw: input.trim() };
}

const handler = {
  async init(_skill) {},

  async execute(task, context, _skill) {
    const input = task.input || task.params?.input || "";
    const { args, raw } = parseInput(input);

    if (!args.length) {
      return {
        success: false,
        error: "请提供要执行的指令。可用指令: " + [...VALID_COMMANDS].join(", "),
      };
    }

    const command = args[0];

    if (!VALID_COMMANDS.has(command)) {
      return {
        success: false,
        error: \`指令 "\${command}" 不在此技能包中。可用指令: \${[...VALID_COMMANDS].join(", ")}\`,
      };
    }

    // Agent-only commands: return usage guide
    if (AGENT_ONLY_COMMANDS.has(command)) {
      return {
        success: true,
        executionMode: "agent",
        message: \`\${command} 需要在终端中交互式运行\`,
        result: {
          howToRun: \`chainlesschain \${raw}\`,
          note: "此指令需要交互式终端，请直接在终端中运行",
        },
      };
    }

    // Direct execution for other commands
    const cliArgs = [...args, "--quiet"];
    const result = spawnSync("chainlesschain", cliArgs, {
      encoding: "utf-8",
      shell: true,
      cwd: context.projectRoot || process.cwd(),
      timeout: 30000,
      env: { ...process.env },
    });

    if (result.error) {
      return { success: false, error: \`执行失败: \${result.error.message}\` };
    }

    const exitCode = result.status ?? -1;
    if (exitCode !== 0) {
      return {
        success: false,
        error: (result.stderr || "").trim() || \`退出码: \${exitCode}\`,
        stdout: (result.stdout || "").trim(),
      };
    }

    let parsed = null;
    const stdout = (result.stdout || "").trim();
    try { parsed = JSON.parse(stdout); } catch { /* plain text */ }

    return {
      success: true,
      message: \`chainlesschain \${command} 执行成功\`,
      result: parsed || stdout || "(无输出)",
    };
  },
};

module.exports = handler;
`;
}

// ── Main generator ─────────────────────────────────────────────────

/**
 * Generate all CLI pack skills
 *
 * @param {object} options
 * @param {boolean} [options.force=false]       - Force regenerate even if unchanged
 * @param {boolean} [options.dryRun=false]      - Preview changes without writing
 * @param {string}  [options.outputDir]         - Override output directory (default: managed layer)
 * @returns {Promise<GeneratorResult>}
 */
export async function generateCliPacks(options = {}) {
  const { force = false, dryRun = false } = options;

  const cliVersion = getCliVersion();
  const outputDir =
    options.outputDir || path.join(getElectronUserDataDir(), "skills");

  const results = {
    generated: [],
    skipped: [],
    errors: [],
    outputDir,
    cliVersion,
  };

  for (const [domainKey, domainDef] of Object.entries(CLI_PACK_DOMAINS)) {
    const packDir = path.join(outputDir, domainKey);
    const skillMdPath = path.join(packDir, "SKILL.md");
    const handlerPath = path.join(packDir, "handler.js");

    const newHash = computePackHash(domainKey, domainDef, cliVersion);
    const existingHash = readExistingHash(skillMdPath);

    // Skip if unchanged (unless forced)
    if (!force && existingHash === newHash) {
      results.skipped.push({ domain: domainKey, reason: "unchanged" });
      continue;
    }

    const changeReason =
      existingHash === null ? "new" : force ? "forced" : "hash-changed";

    if (dryRun) {
      results.generated.push({ domain: domainKey, dryRun: true, changeReason });
      continue;
    }

    try {
      // Create directory
      fs.mkdirSync(packDir, { recursive: true });

      // Generate SKILL.md
      const skillMd = generateSkillMd(domainKey, domainDef, newHash);
      fs.writeFileSync(skillMdPath, skillMd, "utf-8");

      // Generate handler.js based on execution mode
      let handlerJs;
      if (domainDef.executionMode === "agent") {
        handlerJs = generateAgentHandler(domainKey, domainDef);
      } else if (domainDef.executionMode === "hybrid") {
        handlerJs = generateHybridHandler(domainKey, domainDef);
      } else {
        // direct or llm-query — both use spawnSync
        handlerJs = generateDirectHandler(domainKey, domainDef);
      }
      fs.writeFileSync(handlerPath, handlerJs, "utf-8");

      results.generated.push({
        domain: domainKey,
        displayName: domainDef.displayName,
        executionMode: domainDef.executionMode,
        commandCount: Object.keys(domainDef.commands).length,
        packDir,
        changeReason,
        hash: newHash,
      });
    } catch (err) {
      results.errors.push({ domain: domainKey, error: err.message });
    }
  }

  return results;
}

/**
 * Check which packs need updating (without generating)
 * @param {string} [outputDir]
 * @returns {object[]} Array of packs that need updating
 */
export function checkForUpdates(outputDir) {
  const dir = outputDir || path.join(getElectronUserDataDir(), "skills");
  const cliVersion = getCliVersion();
  const updates = [];

  for (const [domainKey, domainDef] of Object.entries(CLI_PACK_DOMAINS)) {
    const skillMdPath = path.join(dir, domainKey, "SKILL.md");
    const existingHash = readExistingHash(skillMdPath);
    const newHash = computePackHash(domainKey, domainDef, cliVersion);

    if (existingHash !== newHash) {
      updates.push({
        domain: domainKey,
        displayName: domainDef.displayName,
        exists: existingHash !== null,
        changeReason: existingHash === null ? "new" : "hash-changed",
        existingHash,
        newHash,
      });
    }
  }

  return updates;
}

/**
 * Remove all generated CLI packs
 * @param {string} [outputDir]
 */
export function removeCliPacks(outputDir) {
  const dir = outputDir || path.join(getElectronUserDataDir(), "skills");
  const removed = [];

  for (const domainKey of Object.keys(CLI_PACK_DOMAINS)) {
    const packDir = path.join(dir, domainKey);
    if (fs.existsSync(packDir)) {
      fs.rmSync(packDir, { recursive: true, force: true });
      removed.push(domainKey);
    }
  }

  return removed;
}

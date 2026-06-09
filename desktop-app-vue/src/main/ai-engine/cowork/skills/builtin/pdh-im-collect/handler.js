/**
 * PDH IM Collect Skill Handler
 *
 * Guides + drives WeChat / QQ chat-history collection into the local
 * Personal Data Hub vault. Read-only by default: `readiness` / `verify`
 * probe the vault via the `cc` CLI; `wechat` / `qq` return the exact
 * commands and only execute the (heavy) ingestion when `--run` is passed.
 *
 * Actions: readiness (default) | wechat | qq | verify | guide
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const VAULT_HINT =
  "%APPDATA%\\chainlesschain-desktop-vue\\.chainlesschain\\hub\\vault.db";

// ── cc CLI resolution ───────────────────────────────────────────────
// Prefer a global `cc`; fall back to the workspace CLI entry. Returns a
// command prefix string ready to append hub args to, or null if neither
// is available (skill then degrades to guidance-only).
function resolveCcPrefix(projectRoot) {
  try {
    execSync("cc --version", { stdio: "pipe", timeout: 8000 });
    return "cc";
  } catch {
    /* not on PATH — try the workspace CLI */
  }

  const candidates = [
    projectRoot &&
      path.join(projectRoot, "packages", "cli", "bin", "chainlesschain.js"),
    // 8 levels up: builtin/pdh-im-collect → repo root
    path.resolve(
      __dirname,
      "../../../../../../../../packages/cli/bin/chainlesschain.js",
    ),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return `node "${c}"`;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function runCc(ccPrefix, args, { timeout = 120000 } = {}) {
  const cmd = `${ccPrefix} ${args}`;
  const stdout = execSync(cmd, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { cmd, stdout };
}

// ── readiness parsing ───────────────────────────────────────────────
// The readiness JSON shape varies (array of reports or keyed object);
// locate a source report by id without assuming deep structure.
function findReport(parsed, sourceId) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const pools = [];
  if (Array.isArray(parsed)) {
    pools.push(parsed);
  }
  if (Array.isArray(parsed.sources)) {
    pools.push(parsed.sources);
  }
  if (Array.isArray(parsed.reports)) {
    pools.push(parsed.reports);
  }
  for (const pool of pools) {
    const hit = pool.find(
      (r) =>
        r &&
        (r.id === sourceId ||
          r.source === sourceId ||
          r.name === sourceId ||
          r.adapter === sourceId),
    );
    if (hit) {
      return hit;
    }
  }
  // keyed-object fallback
  if (parsed[sourceId]) {
    return parsed[sourceId];
  }
  if (parsed.sources && parsed.sources[sourceId]) {
    return parsed.sources[sourceId];
  }
  return null;
}

function statusOf(report) {
  if (!report) {
    return "UNKNOWN";
  }
  return report.status || report.state || report.readiness || "UNKNOWN";
}

function probeReadiness(ccPrefix) {
  if (!ccPrefix) {
    return { ok: false, reason: "cc CLI not found" };
  }
  try {
    const { stdout } = runCc(ccPrefix, "hub readiness --json", {
      timeout: 60000,
    });
    let parsed = null;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // tolerate noisy stdout: grab the first JSON blob
      const m = stdout.match(/[[{][\s\S]*[\]}]/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* give up parsing */
        }
      }
    }
    if (!parsed) {
      return {
        ok: false,
        reason: "could not parse readiness JSON",
        raw: stdout,
      };
    }
    const wechat = findReport(parsed, "wechat-pc");
    const qq = findReport(parsed, "qq-pc");
    return {
      ok: true,
      wechat: { status: statusOf(wechat), report: wechat },
      qq: { status: statusOf(qq), report: qq },
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── per-action guidance ─────────────────────────────────────────────
const WECHAT_STEPS = [
  "1. 让用户**打开微信并保持登录**（SQLCipher 密钥只在 Weixin.exe 运行时驻留内存）。",
  "2. 一键采集：`cc hub sync-adapter wechat-pc`",
  "3. 入库内容：聊天 + 公众号 + 朋友圈 + 收藏 + 联系人（富媒体已可读标注，压缩消息 zstd 解码）。",
  "微信 3.x（老版 Documents\\WeChat Files\\）：先用 PyWxDump 解出明文 .db，再 `cc hub sync-adapter wechat-pc --input <明文.db>`。",
].join("\n");

const QQ_STEPS = [
  "1. **取密钥**（16 位 ASCII 口令，如 5{sww#,6aq=)8=A@）：",
  "   - `git clone https://github.com/QQBackup/qq-win-db-key`",
  "   - **先彻底关掉 QQ**（看门狗会重启 —— `taskkill /F /T /IM QQ.exe` 反复执行到 0）。",
  "   - 跑 `powershell -NoProfile -ExecutionPolicy Bypass -File .\\windows_ntqq_get_key.ps1`，在它拉起的 QQ 窗口登录，输出 `找到密钥: <口令>`。",
  '2. 采集：`cc hub sync-adapter qq-pc --passphrase "<16位密钥>"`（私聊 + 群聊，含发送者昵称）。',
  "3. QQ 每次重启密钥都会变，重采需重跑 qq-win-db-key 取新密钥。",
].join("\n");

// ── handler ─────────────────────────────────────────────────────────
module.exports = {
  async init(skill) {
    logger.info(
      `[pdh-im-collect] handler initialized for "${skill?.name || "pdh-im-collect"}"`,
    );
  },

  async execute(task, context = {}, _skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    const tokens = input.split(/\s+/).filter(Boolean);
    const action = (tokens[0] || "readiness").toLowerCase();
    const doRun = /--run\b/.test(input);
    const passMatch = input.match(/--passphrase(?:=|\s+)("[^"]*"|'[^']*'|\S+)/);
    const passphrase = passMatch
      ? passMatch[1].replace(/^['"]|['"]$/g, "")
      : null;

    const ccPrefix = resolveCcPrefix(projectRoot);

    try {
      // ── readiness (default) ──────────────────────────────────────
      if (action === "readiness" || action === "status" || action === "guide") {
        const r = probeReadiness(ccPrefix);
        const lines = ["## PDH 微信/QQ 采集 — 就绪状态"];
        if (r.ok) {
          lines.push(
            `- **wechat-pc**: ${r.wechat.status}`,
            `- **qq-pc**: ${r.qq.status}`,
            "",
            "状态含义：`ready` 直接采 / `DB_FOUND_NEEDS_KEY` 需取密钥 / `APP_NOT_INSTALLED` 未安装。",
          );
        } else {
          lines.push(
            `> 就绪探测未完成（${r.reason}）。手动运行：\`cc hub readiness --json\`（cc 非全局时用 \`node packages/cli/bin/chainlesschain.js hub readiness --json\`）。`,
          );
        }
        lines.push(
          "",
          "### 微信（一键，全自动）",
          WECHAT_STEPS,
          "",
          "### QQ NT（取一次密钥后一键）",
          QQ_STEPS,
          "",
          `数据落库：\`${VAULT_HINT}\`。采完用 \`cc hub stats\` 核对、\`cc ask "上周群里聊了什么"\` 检索。`,
        );
        return {
          success: true,
          result: { action: "readiness", ...r, vault: VAULT_HINT },
          message: lines.join("\n"),
        };
      }

      // ── wechat ───────────────────────────────────────────────────
      if (action === "wechat" || action === "weixin" || action === "微信") {
        if (doRun) {
          if (!ccPrefix) {
            return {
              success: false,
              error: "cc CLI not found",
              message:
                "找不到 cc CLI，无法自动执行。请手动运行：`cc hub sync-adapter wechat-pc`（先确保微信已登录）。",
            };
          }
          const { cmd, stdout } = runCc(
            ccPrefix,
            "hub sync-adapter wechat-pc",
            { timeout: 600000 },
          );
          return {
            success: true,
            result: { action: "wechat", ran: cmd, output: stdout },
            message: `已执行 \`${cmd}\`\n\n${stdout.trim()}`,
          };
        }
        return {
          success: true,
          result: {
            action: "wechat",
            command: "cc hub sync-adapter wechat-pc",
          },
          message: `### 微信采集（全自动一键）\n${WECHAT_STEPS}\n\n> 确认微信已登录后，可加 \`--run\` 让我直接执行 \`cc hub sync-adapter wechat-pc\`。`,
        };
      }

      // ── qq ───────────────────────────────────────────────────────
      if (action === "qq") {
        if (doRun) {
          if (!passphrase) {
            return {
              success: false,
              error: "missing passphrase",
              message:
                'QQ 采集需要 16 位密钥：先用 qq-win-db-key 取密钥，再重试并带上 `--run --passphrase "<密钥>"`。',
            };
          }
          if (!ccPrefix) {
            return {
              success: false,
              error: "cc CLI not found",
              message: `找不到 cc CLI。请手动运行：\`cc hub sync-adapter qq-pc --passphrase "${passphrase}"\``,
            };
          }
          const { stdout } = runCc(
            ccPrefix,
            `hub sync-adapter qq-pc --passphrase "${passphrase}"`,
            { timeout: 600000 },
          );
          return {
            success: true,
            // never echo the passphrase back
            result: {
              action: "qq",
              ran: "cc hub sync-adapter qq-pc --passphrase ***",
              output: stdout,
            },
            message: `已执行 QQ 采集（密钥已隐去）\n\n${stdout.trim()}`,
          };
        }
        return {
          success: true,
          result: { action: "qq" },
          message: `### QQ NT 采集\n${QQ_STEPS}\n\n> 取到密钥后，可加 \`--run --passphrase "<密钥>"\` 让我直接执行采集。`,
        };
      }

      // ── verify ───────────────────────────────────────────────────
      if (action === "verify" || action === "stats") {
        if (!ccPrefix) {
          return {
            success: false,
            error: "cc CLI not found",
            message: "找不到 cc CLI，请手动运行：`cc hub stats`。",
          };
        }
        const { cmd, stdout } = runCc(ccPrefix, "hub stats", {
          timeout: 60000,
        });
        return {
          success: true,
          result: { action: "verify", ran: cmd, output: stdout },
          message: `### 金库统计（\`${cmd}\`）\n\n${stdout.trim()}`,
        };
      }

      // ── unknown action ───────────────────────────────────────────
      return {
        success: true,
        result: { action: "help" },
        message:
          '用法：`/pdh-im-collect [readiness|wechat|qq|verify]`\n- `readiness`（默认）：探测就绪状态 + 步骤指引\n- `wechat`：微信一键采集（加 `--run` 直接执行）\n- `qq`：QQ NT 采集（加 `--run --passphrase "<密钥>"` 直接执行）\n- `verify`：`cc hub stats` 核对入库结果',
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `PDH 采集执行失败：${err.message}`,
      };
    }
  },
};

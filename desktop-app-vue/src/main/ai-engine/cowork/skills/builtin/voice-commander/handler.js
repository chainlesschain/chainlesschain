/**
 * Voice Commander Skill Handler
 *
 * Manages voice commands and macros without requiring actual voice
 * recognition hardware. Works with command definitions, macro creation,
 * command testing, and history tracking.
 * Modes: --list, --categories, --create-macro, --delete-macro, --macros,
 *        --test, --history
 */

const { logger } = require("../../../../../utils/logger.js");

// ── Built-in command categories ─────────────────────────────────────

const BUILTIN_COMMANDS = {
  editing: [
    {
      name: "format_text",
      patterns: ["加粗", "斜体", "下划线", "标题", "引用", "代码块"],
      description: "文本格式化",
    },
    {
      name: "insert_element",
      patterns: ["插入图片", "插入表格", "插入链接", "插入代码"],
      description: "插入元素",
    },
  ],
  navigation: [
    {
      name: "open_page",
      patterns: ["打开设置", "打开项目", "打开聊天", "回到首页"],
      description: "页面导航",
    },
    {
      name: "scroll_page",
      patterns: ["向上滚动", "向下滚动", "到顶部", "到底部"],
      description: "页面滚动",
    },
  ],
  ai: [
    {
      name: "ai_chat",
      patterns: ["问AI", "帮我写", "帮我改", "翻译"],
      description: "AI交互",
    },
    {
      name: "ai_analyze",
      patterns: ["分析代码", "分析数据", "总结文章"],
      description: "AI分析",
    },
  ],
  system: [
    {
      name: "system_control",
      patterns: ["截图", "录屏", "暂停", "继续", "撤销", "重做"],
      description: "系统控制",
    },
  ],
  search: [
    {
      name: "search",
      patterns: ["搜索", "查找", "过滤", "全局搜索"],
      description: "搜索",
    },
  ],
};

// ── In-memory stores ────────────────────────────────────────────────

const macros = new Map();
const commandHistory = [];
const MAX_HISTORY = 100;

// ── Helpers ─────────────────────────────────────────────────────────

function getAllCommands() {
  const all = [];
  for (const [category, commands] of Object.entries(BUILTIN_COMMANDS)) {
    for (const cmd of commands) {
      all.push({ ...cmd, category });
    }
  }
  return all;
}

function countPatterns(category) {
  let count = 0;
  for (const cmd of BUILTIN_COMMANDS[category] || []) {
    count += cmd.patterns.length;
  }
  return count;
}

function addToHistory(entry) {
  commandHistory.unshift({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  if (commandHistory.length > MAX_HISTORY) {
    commandHistory.pop();
  }
}

function matchCommand(text) {
  const normalized = text.trim().toLowerCase();
  let bestMatch = null;
  let bestConfidence = 0;

  for (const [category, commands] of Object.entries(BUILTIN_COMMANDS)) {
    for (const cmd of commands) {
      for (const pattern of cmd.patterns) {
        const patternLower = pattern.toLowerCase();
        if (normalized === patternLower) {
          // Exact match
          return {
            command: cmd.name,
            category,
            pattern,
            confidence: 1.0,
            description: cmd.description,
          };
        }
        if (
          normalized.includes(patternLower) ||
          patternLower.includes(normalized)
        ) {
          const confidence = 0.8;
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = {
              command: cmd.name,
              category,
              pattern,
              confidence,
              description: cmd.description,
            };
          }
        }
      }
    }
  }

  return bestMatch;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[voice-commander] init: " + (_skill?.name || "voice-commander"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const _projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    try {
      // ── --categories ────────────────────────────────────────────
      if (/--categories/i.test(input)) {
        const categories = Object.keys(BUILTIN_COMMANDS).map((name) => ({
          name,
          commands: BUILTIN_COMMANDS[name].length,
          patterns: countPatterns(name),
        }));
        const total = categories.reduce((s, c) => s + c.commands, 0);
        let msg = "Voice Command Categories\n" + "=".repeat(30) + "\n";
        msg += categories
          .map(
            (c) =>
              "  " +
              c.name +
              ": " +
              c.commands +
              " commands, " +
              c.patterns +
              " patterns",
          )
          .join("\n");
        msg +=
          "\nTotal: " +
          total +
          " commands in " +
          categories.length +
          " categories";
        return {
          success: true,
          result: { categories, totalCommands: total },
          message: msg,
        };
      }

      // ── --create-macro ──────────────────────────────────────────
      const createMatch = input.match(
        /--create-macro\s+["']([^"']+)["']\s+--steps\s+["']([^"']+)["']/i,
      );
      if (createMatch) {
        const macroName = createMatch[1].trim();
        const steps = createMatch[2]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (steps.length === 0) {
          return {
            success: false,
            message: "Macro steps cannot be empty.",
          };
        }
        macros.set(macroName, {
          name: macroName,
          steps,
          createdAt: new Date().toISOString(),
        });
        addToHistory({
          action: "create-macro",
          macro: macroName,
          steps,
        });
        return {
          success: true,
          result: { macro: macroName, steps, totalMacros: macros.size },
          message:
            "Created macro '" +
            macroName +
            "' with " +
            steps.length +
            " steps: " +
            steps.join(" -> "),
        };
      }

      // ── --delete-macro ──────────────────────────────────────────
      const deleteMatch = input.match(/--delete-macro\s+["']([^"']+)["']/i);
      if (deleteMatch) {
        const macroName = deleteMatch[1].trim();
        if (!macros.has(macroName)) {
          return {
            success: false,
            message: "Macro '" + macroName + "' not found.",
          };
        }
        macros.delete(macroName);
        addToHistory({ action: "delete-macro", macro: macroName });
        return {
          success: true,
          result: { deleted: macroName, totalMacros: macros.size },
          message: "Deleted macro '" + macroName + "'.",
        };
      }

      // ── --macros ────────────────────────────────────────────────
      if (/--macros/i.test(input)) {
        if (macros.size === 0) {
          return {
            success: true,
            result: { macros: [], total: 0 },
            message: "No macros defined. Use --create-macro to add one.",
          };
        }
        const list = [...macros.values()];
        let msg = "Voice Commander Macros\n" + "=".repeat(30) + "\n";
        msg += list
          .map(
            (m) =>
              "  " +
              m.name +
              ": " +
              m.steps.join(" -> ") +
              " (created: " +
              m.createdAt.split("T")[0] +
              ")",
          )
          .join("\n");
        msg += "\nTotal: " + list.length + " macros";
        return {
          success: true,
          result: { macros: list, total: list.length },
          message: msg,
        };
      }

      // ── --test ──────────────────────────────────────────────────
      const testMatch = input.match(/--test\s+["']([^"']+)["']/i);
      if (testMatch) {
        const text = testMatch[1].trim();
        const match = matchCommand(text);
        addToHistory({
          action: "test",
          text,
          matched: match ? match.command : null,
        });
        if (!match) {
          return {
            success: true,
            result: { input: text, matched: false },
            message:
              'No command matched for: "' +
              text +
              '". ' +
              "Try one of the registered patterns.",
          };
        }
        return {
          success: true,
          result: {
            input: text,
            matched: true,
            command: match.command,
            category: match.category,
            pattern: match.pattern,
            confidence: match.confidence,
            description: match.description,
          },
          message:
            "Parsed: command=" +
            match.command +
            ", category=" +
            match.category +
            ", pattern=" +
            match.pattern +
            ", confidence: " +
            match.confidence,
        };
      }

      // ── --history ───────────────────────────────────────────────
      if (/--history/i.test(input)) {
        const limitMatch = input.match(/--limit\s+(\d+)/i);
        const limit = limitMatch
          ? Math.min(parseInt(limitMatch[1]), MAX_HISTORY)
          : 20;
        const recent = commandHistory.slice(0, limit);
        if (recent.length === 0) {
          return {
            success: true,
            result: { history: [], total: 0 },
            message: "No command history yet.",
          };
        }
        let msg = "Voice Command History\n" + "=".repeat(30) + "\n";
        msg += recent
          .map(
            (h, i) =>
              "  " +
              (i + 1) +
              ". [" +
              h.timestamp.split("T")[1].split(".")[0] +
              "] " +
              h.action +
              (h.text ? ': "' + h.text + '"' : "") +
              (h.macro ? ": " + h.macro : "") +
              (h.matched ? " -> " + h.matched : ""),
          )
          .join("\n");
        msg +=
          "\nShowing " +
          recent.length +
          " of " +
          commandHistory.length +
          " entries";
        return {
          success: true,
          result: {
            history: recent,
            total: commandHistory.length,
            showing: recent.length,
          },
          message: msg,
        };
      }

      // ── --list ──────────────────────────────────────────────────
      if (/--list/i.test(input) || !input) {
        const categoryMatch = input.match(/--category\s+(\S+)/i);
        const filterCategory = categoryMatch
          ? categoryMatch[1].toLowerCase()
          : null;

        if (filterCategory) {
          const commands = BUILTIN_COMMANDS[filterCategory];
          if (!commands) {
            const available = Object.keys(BUILTIN_COMMANDS).join(", ");
            return {
              success: false,
              message:
                "Unknown category: " +
                filterCategory +
                ". Available: " +
                available,
            };
          }
          const patternCount = countPatterns(filterCategory);
          let msg =
            patternCount +
            " " +
            filterCategory +
            " commands: " +
            commands.map((c) => c.name).join(", ") +
            "\n";
          msg += commands
            .map(
              (c) =>
                "  " +
                c.name +
                " - " +
                c.description +
                " [" +
                c.patterns.join(", ") +
                "]",
            )
            .join("\n");
          return {
            success: true,
            result: {
              category: filterCategory,
              commands: commands.map((c) => ({
                name: c.name,
                description: c.description,
                patterns: c.patterns,
              })),
              patternCount,
            },
            message: msg,
          };
        }

        // List all
        const allCommands = getAllCommands();
        const totalPatterns = Object.keys(BUILTIN_COMMANDS).reduce(
          (s, cat) => s + countPatterns(cat),
          0,
        );
        let msg =
          allCommands.length +
          " registered commands in " +
          Object.keys(BUILTIN_COMMANDS).length +
          " categories\n" +
          "=".repeat(30) +
          "\n";
        for (const [category, commands] of Object.entries(BUILTIN_COMMANDS)) {
          msg +=
            "\n[" +
            category +
            "] (" +
            commands.length +
            " commands, " +
            countPatterns(category) +
            " patterns)\n";
          msg += commands
            .map((c) => "  " + c.name + " - " + c.description)
            .join("\n");
          msg += "\n";
        }
        msg += "\nTotal patterns: " + totalPatterns;
        return {
          success: true,
          result: {
            commands: allCommands,
            totalCommands: allCommands.length,
            totalPatterns,
            categories: Object.keys(BUILTIN_COMMANDS),
          },
          message: msg,
        };
      }

      // ── Fallback ────────────────────────────────────────────────
      return {
        success: false,
        error: "Unknown action",
        message:
          "Usage: /voice-commander [--list] [--category <name>] [--categories] " +
          '[--create-macro "<name>" --steps "step1,step2,..."] ' +
          '[--delete-macro "<name>"] [--macros] [--test "<text>"] ' +
          "[--history --limit N]",
      };
    } catch (err) {
      logger.error("[voice-commander] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Voice commander failed: " + err.message,
      };
    }
  },
};

/**
 * Code Runner Skill Handler
 *
 * Safely executes code snippets and script files with timeout protection,
 * output capture (stdout + stderr), and exit code reporting.
 * Supports Python, JavaScript (Node.js), and Bash.
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { logger } = require("../../../../../utils/logger.js");

// ── Language configuration ───────────────────────────────────────

const LANGUAGES = {
  python: {
    command: "python",
    extensions: [".py"],
    aliases: ["py", "python3"],
  },
  javascript: {
    command: "node",
    extensions: [".js"],
    aliases: ["js", "node"],
  },
  bash: {
    command: process.platform === "win32" ? "bash" : "/bin/bash",
    extensions: [".sh", ".bash"],
    aliases: ["sh"],
  },
};

const DEFAULT_TIMEOUT = 30000;
const MAX_OUTPUT_LENGTH = 5000;

// ── Core execution ───────────────────────────────────────────────

function executeCode(command, args, timeout, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      timeout,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

// ── Language detection ───────────────────────────────────────────

function resolveLanguage(name) {
  if (!name) {
    return null;
  }
  const lower = name.toLowerCase().trim();

  for (const [lang, config] of Object.entries(LANGUAGES)) {
    if (lang === lower || config.aliases.includes(lower)) {
      return { name: lang, ...config };
    }
  }

  return null;
}

function detectLanguageFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [lang, config] of Object.entries(LANGUAGES)) {
    if (config.extensions.includes(ext)) {
      return { name: lang, ...config };
    }
  }
  return null;
}

// ── Command availability check ───────────────────────────────────

function isCommandAvailable(command) {
  try {
    const checkCmd = process.platform === "win32" ? "where" : "which";
    execSync(`${checkCmd} ${command}`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

// ── Temp file management ─────────────────────────────────────────

function createTempFile(code, extension) {
  const fileName = `code_runner_${Date.now()}${extension}`;
  const filePath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(filePath, code, "utf-8");
  return filePath;
}

function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn(`[CodeRunner] Failed to cleanup temp file: ${err.message}`);
  }
}

// ── Output formatting ────────────────────────────────────────────

function truncateOutput(text, maxLength) {
  if (!text) {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return (
    trimmed.substring(0, maxLength) +
    `\n... (truncated, ${trimmed.length} chars total)`
  );
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Input parsing ────────────────────────────────────────────────

function parseInput(input) {
  const options = {
    action: null,
    code: null,
    language: null,
    filePath: null,
    timeout: DEFAULT_TIMEOUT,
  };

  if (!input) {
    return options;
  }

  // Check for --languages action
  if (/--languages?\b/.test(input)) {
    options.action = "languages";
    return options;
  }

  // Extract --lang value
  const langMatch = input.match(/--lang(?:uage)?\s+(\S+)/);
  if (langMatch) {
    options.language = langMatch[1];
  }

  // Extract --timeout value
  const timeoutMatch = input.match(/--timeout\s+(\d+)/);
  if (timeoutMatch) {
    options.timeout = Math.min(parseInt(timeoutMatch[1]), 120000);
  }

  // Extract --run code (quoted)
  const runMatch = input.match(/--run\s+"([^"]+)"/);
  if (runMatch) {
    options.action = "run";
    options.code = runMatch[1];
    return options;
  }

  // Extract --run code (unquoted, rest of relevant segment)
  const runUnquoted = input.match(/--run\s+(?!--)(\S+(?:\s+(?!--)\S+)*)/);
  if (runUnquoted) {
    options.action = "run";
    options.code = runUnquoted[1];
    return options;
  }

  // Extract --file path
  const fileMatch = input.match(/--file\s+(\S+)/);
  if (fileMatch) {
    options.action = "file";
    options.filePath = fileMatch[1];
    return options;
  }

  // If no action flags, treat the whole input as code to run
  if (input.trim() && !options.action) {
    options.action = "run";
    options.code = input
      .replace(/--lang(?:uage)?\s+\S+/g, "")
      .replace(/--timeout\s+\d+/g, "")
      .trim();
  }

  return options;
}

// ── Action handlers ──────────────────────────────────────────────

async function handleRun(code, languageName, timeout, cwd) {
  const lang = resolveLanguage(languageName);

  if (!lang) {
    const available = Object.keys(LANGUAGES).join(", ");
    return {
      success: false,
      error: "Unknown language",
      message: `Unknown language: "${languageName}". Supported: ${available}`,
    };
  }

  if (!isCommandAvailable(lang.command)) {
    return {
      success: false,
      error: "Runtime not found",
      message: `Runtime "${lang.command}" is not installed or not in PATH.`,
    };
  }

  const extension = lang.extensions[0];
  const tempFile = createTempFile(code, extension);

  try {
    const startTime = Date.now();
    const result = await executeCode(lang.command, [tempFile], timeout, cwd);
    const duration = Date.now() - startTime;

    const stdout = truncateOutput(result.stdout, MAX_OUTPUT_LENGTH);
    const stderr = truncateOutput(result.stderr, MAX_OUTPUT_LENGTH);

    const lines = [
      `## Code Execution Result`,
      `Language: **${lang.name}** | Exit code: **${result.exitCode}** | Duration: **${formatDuration(duration)}**`,
      "",
    ];

    if (stdout) {
      lines.push("**stdout:**", "```", stdout, "```", "");
    }
    if (stderr) {
      lines.push("**stderr:**", "```", stderr, "```", "");
    }
    if (!stdout && !stderr) {
      lines.push("_(no output)_");
    }

    return {
      success: result.exitCode === 0,
      result: {
        exitCode: result.exitCode,
        stdout,
        stderr,
        duration,
        language: lang.name,
      },
      message: lines.join("\n"),
    };
  } finally {
    cleanupTempFile(tempFile);
  }
}

async function handleFile(filePath, languageName, timeout, cwd) {
  // Resolve relative paths
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(cwd, filePath);
  }

  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: "File not found",
      message: `Script file not found: ${filePath}`,
    };
  }

  // Detect language from extension if not provided
  const lang = languageName
    ? resolveLanguage(languageName)
    : detectLanguageFromExtension(filePath);

  if (!lang) {
    const ext = path.extname(filePath);
    return {
      success: false,
      error: "Unknown language",
      message: `Cannot detect language for extension "${ext}". Use --lang to specify.`,
    };
  }

  if (!isCommandAvailable(lang.command)) {
    return {
      success: false,
      error: "Runtime not found",
      message: `Runtime "${lang.command}" is not installed or not in PATH.`,
    };
  }

  try {
    const startTime = Date.now();
    const result = await executeCode(
      lang.command,
      [filePath],
      timeout,
      path.dirname(filePath),
    );
    const duration = Date.now() - startTime;

    const stdout = truncateOutput(result.stdout, MAX_OUTPUT_LENGTH);
    const stderr = truncateOutput(result.stderr, MAX_OUTPUT_LENGTH);
    const fileName = path.basename(filePath);

    const lines = [
      `## File Execution Result`,
      `File: **${fileName}** | Language: **${lang.name}** | Exit code: **${result.exitCode}** | Duration: **${formatDuration(duration)}**`,
      "",
    ];

    if (stdout) {
      lines.push("**stdout:**", "```", stdout, "```", "");
    }
    if (stderr) {
      lines.push("**stderr:**", "```", stderr, "```", "");
    }
    if (!stdout && !stderr) {
      lines.push("_(no output)_");
    }

    return {
      success: result.exitCode === 0,
      result: {
        exitCode: result.exitCode,
        stdout,
        stderr,
        duration,
        language: lang.name,
        file: fileName,
      },
      message: lines.join("\n"),
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      message: `Failed to execute ${path.basename(filePath)}: ${err.message}`,
    };
  }
}

async function handleLanguages() {
  const results = [];

  for (const [name, config] of Object.entries(LANGUAGES)) {
    const available = isCommandAvailable(config.command);
    results.push({
      name,
      command: config.command,
      extensions: config.extensions,
      aliases: config.aliases,
      available,
    });
  }

  const lines = [
    "## Supported Languages",
    "",
    "| Language | Command | Extensions | Aliases | Available |",
    "|----------|---------|------------|---------|-----------|",
  ];

  for (const r of results) {
    const status = r.available ? "Yes" : "No";
    lines.push(
      `| ${r.name} | ${r.command} | ${r.extensions.join(", ")} | ${r.aliases.join(", ")} | ${status} |`,
    );
  }

  lines.push(
    "",
    `Available runtimes: ${results.filter((r) => r.available).length}/${results.length}`,
  );

  return {
    success: true,
    result: { languages: results },
    message: lines.join("\n"),
  };
}

// ── Handler export ───────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info("[CodeRunner] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    logger.info(`[CodeRunner] Input: ${input.substring(0, 100)}`);

    if (!input) {
      return {
        success: true,
        result: { message: "No input provided." },
        message: [
          "## Code Runner",
          "",
          "Usage:",
          '  `/code-runner --run "<code>" --lang python`   Execute code snippet',
          "  `/code-runner --file script.py`               Execute script file",
          "  `/code-runner --languages`                    List available languages",
          "",
          "Options:",
          "  `--lang <language>`   Language: python, javascript, bash",
          "  `--timeout <ms>`     Timeout in ms (default: 30000, max: 120000)",
        ].join("\n"),
      };
    }

    const options = parseInput(input);

    try {
      switch (options.action) {
        case "run":
          if (!options.code) {
            return {
              success: false,
              error: "No code provided",
              message: 'Usage: /code-runner --run "<code>" --lang <language>',
            };
          }
          return await handleRun(
            options.code,
            options.language || "javascript",
            options.timeout,
            projectRoot,
          );

        case "file":
          if (!options.filePath) {
            return {
              success: false,
              error: "No file path provided",
              message: "Usage: /code-runner --file <script_path>",
            };
          }
          return await handleFile(
            options.filePath,
            options.language,
            options.timeout,
            projectRoot,
          );

        case "languages":
          return await handleLanguages();

        default:
          return {
            success: false,
            error: "Unknown action",
            message:
              'Unknown action. Use --run "<code>", --file <path>, or --languages.',
          };
      }
    } catch (error) {
      logger.error(`[CodeRunner] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Code execution failed: ${error.message}`,
      };
    }
  },
};

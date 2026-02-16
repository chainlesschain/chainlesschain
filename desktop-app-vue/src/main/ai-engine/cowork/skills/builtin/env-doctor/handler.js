/**
 * Environment Doctor Skill Handler
 *
 * Diagnoses development environment: runtime versions, port availability,
 * Docker services, and configuration validation.
 */

const { execSync } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const RUNTIMES = [
  { name: "Node.js", cmd: "node --version", minVersion: "18.0.0" },
  { name: "npm", cmd: "npm --version", minVersion: "9.0.0" },
  { name: "Java", cmd: "java --version", minVersion: "17" },
  { name: "Python", cmd: "python --version", minVersion: "3.9" },
  { name: "Docker", cmd: "docker --version", minVersion: "24.0" },
  { name: "Git", cmd: "git --version", minVersion: "2.30" },
];

const PORTS = [
  { port: 5173, service: "Vite Dev Server" },
  { port: 9001, service: "Signaling Server" },
  { port: 11434, service: "Ollama" },
  { port: 6333, service: "Qdrant" },
  { port: 5432, service: "PostgreSQL" },
  { port: 6379, service: "Redis" },
  { port: 9090, service: "Project Service" },
  { port: 8001, service: "AI Service" },
];

module.exports = {
  async init(skill) {
    logger.info("[EnvDoctor] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input);

    logger.info(`[EnvDoctor] Action: ${action}`, { options });

    try {
      switch (action) {
        case "check":
          return await handleCheck(options.category);
        case "fix":
          return await handleFix();
        case "preflight":
          return await handlePreflight();
        default:
          return await handleFullDiagnostics(options.verbose);
      }
    } catch (error) {
      logger.error(`[EnvDoctor] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Environment check failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  const options = { verbose: false, category: null };
  let action = "full";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--fix" || p === "fix") {
      action = "fix";
    } else if (p === "--preflight" || p === "preflight") {
      action = "preflight";
    } else if (p === "--check" || p === "check") {
      action = "check";
      options.category = parts[++i] || null;
    } else if (p === "--verbose") {
      options.verbose = true;
    }
  }

  return { action, options };
}

function runCmd(cmd) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function extractVersion(output) {
  if (!output) {
    return null;
  }
  const match = output.match(/(\d+\.\d+[.\d]*)/);
  return match ? match[1] : null;
}

function compareVersions(current, required) {
  const c = current.split(".").map(Number);
  const r = required.split(".").map(Number);
  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const cv = c[i] || 0;
    const rv = r[i] || 0;
    if (cv > rv) {
      return 1;
    }
    if (cv < rv) {
      return -1;
    }
  }
  return 0;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve({ available: false, inUse: true }));
    server.once("listening", () => {
      server.close();
      resolve({ available: true, inUse: false });
    });
    server.listen(port, "127.0.0.1");
  });
}

async function checkRuntimes() {
  const results = [];
  for (const rt of RUNTIMES) {
    const output = runCmd(rt.cmd);
    const version = extractVersion(output);
    const ok = version ? compareVersions(version, rt.minVersion) >= 0 : false;
    results.push({
      name: rt.name,
      version: version || "not found",
      required: rt.minVersion,
      ok,
    });
  }
  return results;
}

async function checkPorts() {
  const results = [];
  for (const p of PORTS) {
    const status = await checkPort(p.port);
    results.push({
      port: p.port,
      service: p.service,
      inUse: status.inUse,
    });
  }
  return results;
}

function checkDocker() {
  const output = runCmd(
    "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}'",
  );
  if (!output) {
    return { available: false, containers: [] };
  }

  const containers = output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, status, ports] = line.split("\t");
      return {
        name: (name || "").replace(/'/g, ""),
        status: (status || "").replace(/'/g, ""),
        healthy: (status || "").toLowerCase().includes("up"),
      };
    });

  return { available: true, containers };
}

function checkEnvConfig(workspacePath) {
  const issues = [];
  const envPath = path.join(workspacePath, ".env");
  const examplePath = path.join(workspacePath, ".env.example");

  if (!fs.existsSync(envPath)) {
    issues.push(".env file not found");
  }
  if (fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    const envVars = parseEnvFile(envPath);
    const exampleVars = parseEnvFile(examplePath);
    for (const key of Object.keys(exampleVars)) {
      if (!(key in envVars)) {
        issues.push(`Missing env var: ${key}`);
      }
    }
  }

  return { issues };
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        vars[trimmed.substring(0, eqIdx).trim()] = trimmed
          .substring(eqIdx + 1)
          .trim();
      }
    }
  }
  return vars;
}

function formatReport(runtimes, ports, docker, envCheck) {
  const lines = ["Environment Doctor Report", "=========================", ""];

  lines.push("Runtimes:");
  for (const r of runtimes) {
    const icon = r.ok ? "✅" : "❌";
    lines.push(`  ${icon} ${r.name} ${r.version} (required: ≥${r.required})`);
  }

  lines.push("", "Ports:");
  for (const p of ports) {
    const icon = p.inUse ? "🟢" : "⚪";
    const status = p.inUse ? "active" : "available";
    lines.push(`  ${icon} ${p.port} - ${p.service} (${status})`);
  }

  if (docker.available) {
    lines.push("", "Docker:");
    for (const c of docker.containers) {
      const icon = c.healthy ? "✅" : "❌";
      lines.push(`  ${icon} ${c.name} - ${c.status}`);
    }
  } else {
    lines.push("", "Docker: ❌ Not available");
  }

  if (envCheck.issues.length > 0) {
    lines.push("", "Config Issues:");
    for (const issue of envCheck.issues) {
      lines.push(`  ⚠️ ${issue}`);
    }
  }

  const runtimeOk = runtimes.filter((r) => r.ok).length;
  const servicesUp = ports.filter((p) => p.inUse).length;
  lines.push(
    "",
    `Summary: ${runtimeOk}/${runtimes.length} runtimes OK, ${servicesUp}/${ports.length} services active`,
  );

  return lines.join("\n");
}

async function handleFullDiagnostics(verbose) {
  const runtimes = await checkRuntimes();
  const ports = await checkPorts();
  const docker = checkDocker();
  const workspacePath = process.cwd();
  const envCheck = checkEnvConfig(workspacePath);

  const report = formatReport(runtimes, ports, docker, envCheck);
  const runtimeOk = runtimes.filter((r) => r.ok).length;
  const allOk = runtimeOk === runtimes.length && envCheck.issues.length === 0;

  return {
    success: true,
    result: { runtimes, ports, docker, envCheck },
    report,
    healthy: allOk,
    message: report,
  };
}

async function handleCheck(category) {
  if (category === "runtimes") {
    const runtimes = await checkRuntimes();
    return {
      success: true,
      result: runtimes,
      message: runtimes
        .map((r) => `${r.ok ? "✅" : "❌"} ${r.name} ${r.version}`)
        .join("\n"),
    };
  }
  if (category === "ports") {
    const ports = await checkPorts();
    return {
      success: true,
      result: ports,
      message: ports
        .map((p) => `${p.inUse ? "🟢" : "⚪"} ${p.port} ${p.service}`)
        .join("\n"),
    };
  }
  if (category === "docker") {
    const docker = checkDocker();
    return {
      success: true,
      result: docker,
      message: docker.available
        ? docker.containers
            .map((c) => `${c.healthy ? "✅" : "❌"} ${c.name}`)
            .join("\n")
        : "Docker not available",
    };
  }
  return await handleFullDiagnostics(false);
}

async function handleFix() {
  const fixCommands = [];
  const docker = checkDocker();

  if (docker.available) {
    for (const c of docker.containers) {
      if (!c.healthy) {
        fixCommands.push(`docker start ${c.name}`);
      }
    }
  }

  const runtimes = await checkRuntimes();
  for (const r of runtimes) {
    if (!r.ok && r.version === "not found") {
      fixCommands.push(`# Install ${r.name}: please install manually`);
    }
  }

  return {
    success: true,
    fixCommands,
    message:
      fixCommands.length > 0
        ? `Fix commands:\n${fixCommands.map((c) => `  ${c}`).join("\n")}`
        : "No fixes needed - all services healthy!",
  };
}

async function handlePreflight() {
  const result = await handleFullDiagnostics(false);
  const critical = [];

  if (result.result.runtimes.some((r) => r.name === "Node.js" && !r.ok)) {
    critical.push("Node.js version too old or not found");
  }
  if (result.result.envCheck.issues.length > 0) {
    critical.push(...result.result.envCheck.issues);
  }

  return {
    success: critical.length === 0,
    result: result.result,
    critical,
    message:
      critical.length === 0
        ? "✅ Preflight check passed - ready to start!"
        : `❌ Preflight issues:\n${critical.map((c) => `  - ${c}`).join("\n")}`,
  };
}

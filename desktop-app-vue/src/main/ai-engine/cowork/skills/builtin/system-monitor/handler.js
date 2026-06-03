/**
 * System Monitor Skill Handler
 *
 * Monitors system resources: CPU, memory, disk, network interfaces,
 * running processes, uptime, and overall health assessment.
 * Uses only Node.js built-in os module and child_process.
 */

const os = require("os");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// ── Helpers ────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(2)} ${units[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) {
    parts.push(`${d}d`);
  }
  if (h > 0) {
    parts.push(`${h}h`);
  }
  if (m > 0 || parts.length === 0) {
    parts.push(`${m}m`);
  }
  return parts.join(" ");
}

function runCmd(cmd) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    totalTick += user + nice + sys + idle + irq;
    totalIdle += idle;
  }
  const usage = ((1 - totalIdle / totalTick) * 100).toFixed(1);
  return parseFloat(usage);
}

function parseInput(input) {
  const parts = (input || "").trim().split(/\s+/);
  const options = { top: 10 };
  let action = "overview";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--overview" || p === "overview") {
      action = "overview";
    } else if (p === "--cpu" || p === "cpu") {
      action = "cpu";
    } else if (p === "--memory" || p === "memory") {
      action = "memory";
    } else if (p === "--disk" || p === "disk") {
      action = "disk";
    } else if (p === "--processes" || p === "processes") {
      action = "processes";
    } else if (p === "--network" || p === "network") {
      action = "network";
    } else if (p === "--health" || p === "health") {
      action = "health";
    } else if (p === "--top") {
      const n = parseInt(parts[++i], 10);
      if (!isNaN(n) && n > 0) {
        options.top = n;
      }
    }
  }

  return { action, options };
}

// ── Actions ────────────────────────────────────────────────────────

function getOverview() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = ((usedMem / totalMem) * 100).toFixed(1);
  const cpuUsage = getCpuUsage();
  const uptime = formatUptime(os.uptime());

  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpuModel: cpus[0] ? cpus[0].model.trim() : "Unknown",
    cpuCores: cpus.length,
    cpuUsage: `${cpuUsage}%`,
    totalMemory: formatBytes(totalMem),
    usedMemory: formatBytes(usedMem),
    freeMemory: formatBytes(freeMem),
    memoryUsage: `${memPercent}%`,
    uptime,
  };

  const message = [
    "## System Overview",
    `**Host**: ${info.hostname} (${info.platform} ${info.arch})`,
    `**OS**: ${info.release}`,
    `**CPU**: ${info.cpuModel} (${info.cpuCores} cores, ${info.cpuUsage} usage)`,
    `**RAM**: ${info.usedMemory} / ${info.totalMemory} (${info.memoryUsage})`,
    `**Uptime**: ${info.uptime}`,
  ].join("\n");

  return { success: true, result: info, message };
}

function getCpuDetails() {
  const cpus = os.cpus();
  const cpuUsage = getCpuUsage();
  const model = cpus[0] ? cpus[0].model.trim() : "Unknown";
  const speed = cpus[0] ? cpus[0].speed : 0;

  const perCore = cpus.map((cpu, idx) => {
    const { user, nice, sys, idle, irq } = cpu.times;
    const total = user + nice + sys + idle + irq;
    const used = ((1 - idle / total) * 100).toFixed(1);
    return { core: idx, usage: `${used}%`, speed: `${cpu.speed} MHz` };
  });

  const info = {
    model,
    cores: cpus.length,
    speed: `${speed} MHz`,
    architecture: os.arch(),
    usage: `${cpuUsage}%`,
    perCore,
  };

  const coreLines = perCore
    .map((c) => `  Core ${c.core}: ${c.usage} @ ${c.speed}`)
    .join("\n");

  const message = [
    "## CPU Details",
    `**Model**: ${model}`,
    `**Cores**: ${cpus.length}`,
    `**Speed**: ${speed} MHz`,
    `**Architecture**: ${os.arch()}`,
    `**Overall Usage**: ${cpuUsage}%`,
    "",
    "### Per-Core Usage",
    coreLines,
  ].join("\n");

  return { success: true, result: info, message };
}

function getMemoryDetails() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

  const info = {
    total: formatBytes(totalMem),
    used: formatBytes(usedMem),
    free: formatBytes(freeMem),
    usage: `${memPercent}%`,
    totalBytes: totalMem,
    usedBytes: usedMem,
    freeBytes: freeMem,
  };

  const message = [
    "## Memory Usage",
    `**Total**: ${info.total}`,
    `**Used**: ${info.used} (${info.usage})`,
    `**Free**: ${info.free}`,
  ].join("\n");

  return { success: true, result: info, message };
}

function getDiskDetails() {
  const platform = os.platform();
  const drives = [];

  if (platform === "win32") {
    const output = runCmd(
      "wmic logicaldisk get caption,size,freespace /format:csv",
    );
    if (output) {
      const lines = output.split("\n").filter((l) => l.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        if (cols.length >= 4 && cols[2] && cols[3]) {
          const caption = cols[1];
          const freeSpace = parseInt(cols[2], 10);
          const totalSize = parseInt(cols[3], 10);
          if (!isNaN(totalSize) && totalSize > 0) {
            const usedSpace = totalSize - freeSpace;
            const percent = ((usedSpace / totalSize) * 100).toFixed(1);
            drives.push({
              mount: caption,
              total: formatBytes(totalSize),
              used: formatBytes(usedSpace),
              free: formatBytes(freeSpace),
              usage: `${percent}%`,
              usageNum: parseFloat(percent),
            });
          }
        }
      }
    }
  } else {
    const output = runCmd(
      "df -h --output=target,size,used,avail,pcent 2>/dev/null || df -h",
    );
    if (output) {
      const lines = output.split("\n").filter((l) => l.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(/\s+/);
        if (cols.length >= 5) {
          const mount = cols[0];
          if (mount.startsWith("/dev") || mount === "tmpfs") {
            continue;
          }
          const percent = parseFloat((cols[4] || "0").replace("%", ""));
          drives.push({
            mount: cols[0],
            total: cols[1],
            used: cols[2],
            free: cols[3],
            usage: cols[4],
            usageNum: percent,
          });
        }
      }
    }
  }

  const driveLines = drives
    .map((d) => {
      const warn = d.usageNum >= 90 ? " ⚠ HIGH" : "";
      return `  ${d.mount}: ${d.used} / ${d.total} (${d.usage})${warn}`;
    })
    .join("\n");

  const message = [
    "## Disk Usage",
    driveLines || "  No disk information available",
  ].join("\n");

  return { success: true, result: { drives }, message };
}

function getProcesses(topN) {
  const platform = os.platform();
  const processes = [];

  if (platform === "win32") {
    const output = runCmd("tasklist /fo csv /nh");
    if (output) {
      const lines = output.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const match = line.match(/"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/);
        if (match) {
          const memStr = match[3].replace(/[^0-9]/g, "");
          processes.push({
            name: match[1],
            pid: parseInt(match[2], 10),
            memKB: parseInt(memStr, 10) || 0,
            memory: formatBytes((parseInt(memStr, 10) || 0) * 1024),
          });
        }
      }
      processes.sort((a, b) => b.memKB - a.memKB);
    }
  } else {
    const output = runCmd("ps aux --sort=-%cpu 2>/dev/null || ps aux");
    if (output) {
      const lines = output.split("\n").filter((l) => l.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(/\s+/);
        if (cols.length >= 11) {
          processes.push({
            name: cols[10],
            pid: parseInt(cols[1], 10),
            cpuPercent: parseFloat(cols[2]) || 0,
            memPercent: parseFloat(cols[3]) || 0,
            memory: `${cols[3]}%`,
          });
        }
      }
    }
  }

  const top = processes.slice(0, topN);

  const procLines = top
    .map((p, idx) => {
      if (platform === "win32") {
        return `  ${idx + 1}. ${p.name} (PID ${p.pid}) — MEM: ${p.memory}`;
      }
      return `  ${idx + 1}. ${p.name} (PID ${p.pid}) — CPU: ${p.cpuPercent}%, MEM: ${p.memPercent}%`;
    })
    .join("\n");

  const message = [
    `## Top ${topN} Processes`,
    procLines || "  No process information available",
  ].join("\n");

  return {
    success: true,
    result: { processes: top, total: processes.length },
    message,
  };
}

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const result = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    const entries = (addrs || []).map((a) => ({
      address: a.address,
      family: a.family,
      mac: a.mac,
      internal: a.internal,
      netmask: a.netmask,
    }));
    result.push({ name, addresses: entries });
  }

  const ifaceLines = result
    .map((iface) => {
      const addrLines = iface.addresses
        .map((a) => `    ${a.family}: ${a.address} (MAC: ${a.mac})`)
        .join("\n");
      return `  **${iface.name}**:\n${addrLines}`;
    })
    .join("\n");

  const message = [
    "## Network Interfaces",
    ifaceLines || "  No network interfaces found",
  ].join("\n");

  return { success: true, result: { interfaces: result }, message };
}

function getHealthScore() {
  const cpuUsage = getCpuUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memPercent = ((totalMem - freeMem) / totalMem) * 100;

  const warnings = [];
  let score = 100;

  // CPU check
  if (cpuUsage >= 80) {
    score -= 30;
    warnings.push(`CPU usage high: ${cpuUsage.toFixed(1)}% (threshold: 80%)`);
  } else if (cpuUsage >= 60) {
    score -= 10;
    warnings.push(`CPU usage elevated: ${cpuUsage.toFixed(1)}%`);
  }

  // Memory check
  if (memPercent >= 85) {
    score -= 30;
    warnings.push(
      `Memory usage high: ${memPercent.toFixed(1)}% (threshold: 85%)`,
    );
  } else if (memPercent >= 70) {
    score -= 10;
    warnings.push(`Memory usage elevated: ${memPercent.toFixed(1)}%`);
  }

  // Disk check
  const diskResult = getDiskDetails();
  const drives = diskResult.result.drives || [];
  for (const d of drives) {
    if (d.usageNum >= 90) {
      score -= 20;
      warnings.push(
        `Disk ${d.mount} usage critical: ${d.usage} (threshold: 90%)`,
      );
    } else if (d.usageNum >= 80) {
      score -= 5;
      warnings.push(`Disk ${d.mount} usage elevated: ${d.usage}`);
    }
  }

  score = Math.max(0, score);

  let status = "Healthy";
  if (score < 50) {
    status = "Critical";
  } else if (score < 70) {
    status = "Warning";
  } else if (score < 90) {
    status = "Good";
  }

  const info = {
    score,
    status,
    cpuUsage: `${cpuUsage.toFixed(1)}%`,
    memoryUsage: `${memPercent.toFixed(1)}%`,
    drives: drives.map((d) => ({ mount: d.mount, usage: d.usage })),
    warnings,
  };

  const warnLines =
    warnings.length > 0
      ? warnings.map((w) => `  ⚠ ${w}`).join("\n")
      : "  No warnings";

  const message = [
    "## System Health",
    `**Score**: ${score}/100 (${status})`,
    `**CPU**: ${info.cpuUsage}`,
    `**Memory**: ${info.memoryUsage}`,
    "",
    "### Warnings",
    warnLines,
  ].join("\n");

  return { success: true, result: info, message };
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[system-monitor] handler initialized for "${skill?.name || "system-monitor"}"`,
    );
  },

  async execute(task, context, _skill) {
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
    const { action, options } = parseInput(input);

    logger.info(`[system-monitor] Action: ${action}`, { options, projectRoot });

    try {
      switch (action) {
        case "cpu":
          return getCpuDetails();
        case "memory":
          return getMemoryDetails();
        case "disk":
          return getDiskDetails();
        case "processes":
          return getProcesses(options.top);
        case "network":
          return getNetworkInfo();
        case "health":
          return getHealthScore();
        case "overview":
        default:
          return getOverview();
      }
    } catch (error) {
      logger.error(`[system-monitor] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `System monitor failed: ${error.message}`,
      };
    }
  },
};

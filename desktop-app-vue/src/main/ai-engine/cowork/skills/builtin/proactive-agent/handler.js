/**
 * Proactive Agent Skill Handler
 *
 * Autonomous monitoring with file-watch, threshold, periodic, and pattern triggers.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const watchers = new Map();

module.exports = {
  async init(skill) {
    logger.info("[ProactiveAgent] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[ProactiveAgent] Action: ${parsed.action}`);

    try {
      switch (parsed.action) {
        case "watch":
          return handleWatch(parsed);
        case "threshold":
          return handleThreshold(parsed);
        case "periodic":
          return handlePeriodic(parsed);
        case "pattern":
          return handlePattern(parsed);
        case "list":
          return handleList();
        case "stop":
          return handleStop(parsed.target);
        case "status":
          return handleStatus(parsed.target);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use watch, threshold, periodic, pattern, list, stop, or status.`,
          };
      }
    } catch (error) {
      logger.error("[ProactiveAgent] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list" };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "list").toLowerCase();

  const result = { action, target: parts[1] || "", raw: trimmed };

  // Extract --on-change, --action, --above, --match flags
  const onChangeMatch = trimmed.match(/--on-change\s+"([^"]+)"/);
  if (onChangeMatch) result.command = onChangeMatch[1];

  const actionMatch = trimmed.match(/--action\s+"([^"]+)"/);
  if (actionMatch) result.command = actionMatch[1];

  const aboveMatch = trimmed.match(/--above\s+(\d+)/);
  if (aboveMatch) result.threshold = parseInt(aboveMatch[1], 10);

  const matchPattern = trimmed.match(/--match\s+"([^"]+)"/);
  if (matchPattern) result.pattern = matchPattern[1];

  // For periodic: parse interval like "30m", "1h", "60s"
  if (action === "periodic" && parts[1]) {
    result.interval = parseInterval(parts[1]);
  }

  // Extract quoted command at end
  const quotedCmd = trimmed.match(/"([^"]+)"$/);
  if (quotedCmd && !result.command) {
    result.command = quotedCmd[1];
  }

  return result;
}

function parseInterval(str) {
  const match = str.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return 60000; // default 1 minute
  const value = parseInt(match[1], 10);
  const unit = match[2] || "s";
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 1000);
}

function handleWatch(parsed) {
  const watchPath = parsed.target;
  if (!watchPath) {
    return { success: false, error: "No path specified for watch." };
  }

  const resolvedPath = path.resolve(watchPath);
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `Path not found: ${resolvedPath}` };
  }

  const id = generateId();
  const watcher = fs.watch(
    resolvedPath,
    { recursive: true },
    (eventType, filename) => {
      logger.info(
        `[ProactiveAgent:${id}] ${eventType}: ${filename} -> ${parsed.command || "notify"}`,
      );
      const entry = watchers.get(id);
      if (entry) {
        entry.lastTriggered = new Date().toISOString();
        entry.triggerCount++;
      }
    },
  );

  watchers.set(id, {
    id,
    type: "watch",
    path: resolvedPath,
    command: parsed.command || null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    _handle: watcher,
  });

  return {
    success: true,
    action: "watch",
    watcherId: id,
    path: resolvedPath,
    message: `Watching "${resolvedPath}" for changes.`,
  };
}

function handleThreshold(parsed) {
  const metric = parsed.target;
  if (!metric) {
    return { success: false, error: "No metric specified." };
  }

  const id = generateId();
  const interval = setInterval(() => {
    const value = getMetricValue(metric);
    if (value !== null && parsed.threshold && value > parsed.threshold) {
      logger.warn(
        `[ProactiveAgent:${id}] Threshold exceeded: ${metric}=${value} > ${parsed.threshold}`,
      );
      const entry = watchers.get(id);
      if (entry) {
        entry.lastTriggered = new Date().toISOString();
        entry.triggerCount++;
        entry.lastValue = value;
      }
    }
  }, 10000);

  watchers.set(id, {
    id,
    type: "threshold",
    metric,
    threshold: parsed.threshold,
    command: parsed.command || null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    lastValue: null,
    _handle: interval,
  });

  return {
    success: true,
    action: "threshold",
    watcherId: id,
    metric,
    threshold: parsed.threshold,
    message: `Monitoring ${metric} with threshold ${parsed.threshold}.`,
  };
}

function handlePeriodic(parsed) {
  const intervalMs = parsed.interval || 60000;
  const command = parsed.command;

  if (!command) {
    return { success: false, error: "No command specified for periodic task." };
  }

  const id = generateId();
  const interval = setInterval(() => {
    logger.info(`[ProactiveAgent:${id}] Periodic trigger: ${command}`);
    const entry = watchers.get(id);
    if (entry) {
      entry.lastTriggered = new Date().toISOString();
      entry.triggerCount++;
    }
  }, intervalMs);

  watchers.set(id, {
    id,
    type: "periodic",
    intervalMs,
    command,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    _handle: interval,
  });

  return {
    success: true,
    action: "periodic",
    watcherId: id,
    interval: intervalMs,
    command,
    message: `Periodic task created: "${command}" every ${intervalMs / 1000}s.`,
  };
}

function handlePattern(parsed) {
  const filePath = parsed.target;
  if (!filePath) {
    return { success: false, error: "No file path specified." };
  }

  const resolvedPath = path.resolve(filePath);
  const pattern = parsed.pattern;
  if (!pattern) {
    return { success: false, error: "No pattern specified. Use --match." };
  }

  const id = generateId();
  let lastSize = 0;

  try {
    if (fs.existsSync(resolvedPath)) {
      lastSize = fs.statSync(resolvedPath).size;
    }
  } catch {
    // file may not exist yet
  }

  const interval = setInterval(() => {
    try {
      if (!fs.existsSync(resolvedPath)) return;
      const stat = fs.statSync(resolvedPath);
      if (stat.size <= lastSize) return;

      const fd = fs.openSync(resolvedPath, "r");
      const buf = Buffer.alloc(stat.size - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      lastSize = stat.size;

      const newContent = buf.toString("utf8");
      const regex = new RegExp(pattern, "g");
      const matches = newContent.match(regex);
      if (matches && matches.length > 0) {
        logger.info(
          `[ProactiveAgent:${id}] Pattern matched ${matches.length} time(s)`,
        );
        const entry = watchers.get(id);
        if (entry) {
          entry.lastTriggered = new Date().toISOString();
          entry.triggerCount += matches.length;
        }
      }
    } catch (err) {
      logger.debug(`[ProactiveAgent:${id}] Pattern check error: ${err.message}`);
    }
  }, 5000);

  watchers.set(id, {
    id,
    type: "pattern",
    file: resolvedPath,
    pattern,
    command: parsed.command || null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    _handle: interval,
  });

  return {
    success: true,
    action: "pattern",
    watcherId: id,
    file: resolvedPath,
    pattern,
    message: `Watching "${resolvedPath}" for pattern "${pattern}".`,
  };
}

function handleList() {
  const list = [];
  for (const [id, entry] of watchers) {
    const { _handle, ...info } = entry;
    list.push(info);
  }

  return {
    success: true,
    action: "list",
    watchers: list,
    watcherCount: list.length,
  };
}

function handleStop(target) {
  if (target === "all") {
    const count = watchers.size;
    for (const [id, entry] of watchers) {
      cleanup(entry);
    }
    watchers.clear();
    return {
      success: true,
      action: "stop",
      message: `Stopped all ${count} watcher(s).`,
    };
  }

  const entry = watchers.get(target);
  if (!entry) {
    return { success: false, error: `Watcher "${target}" not found.` };
  }

  cleanup(entry);
  watchers.delete(target);

  return {
    success: true,
    action: "stop",
    watcherId: target,
    message: `Watcher "${target}" stopped.`,
  };
}

function handleStatus(target) {
  const entry = watchers.get(target);
  if (!entry) {
    return { success: false, error: `Watcher "${target}" not found.` };
  }

  const { _handle, ...info } = entry;
  return { success: true, action: "status", watcher: info };
}

function cleanup(entry) {
  if (entry._handle) {
    if (typeof entry._handle.close === "function") {
      entry._handle.close();
    } else {
      clearInterval(entry._handle);
    }
  }
}

function getMetricValue(metric) {
  try {
    const os = require("os");
    switch (metric.toLowerCase()) {
      case "cpu": {
        const cpus = os.cpus();
        const avg =
          cpus.reduce((sum, cpu) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            return sum + ((total - cpu.times.idle) / total) * 100;
          }, 0) / cpus.length;
        return Math.round(avg);
      }
      case "memory":
      case "mem":
        return Math.round(
          ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
        );
      default:
        return null;
    }
  } catch {
    return null;
  }
}

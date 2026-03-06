/**
 * Cron Scheduler Skill Handler
 *
 * Schedule and manage automated tasks with cron expressions and natural language.
 */

const { logger } = require("../../../../../utils/logger.js");

const jobs = new Map();

module.exports = {
  async init(skill) {
    logger.info("[CronScheduler] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[CronScheduler] Action: ${parsed.action}`);

    try {
      switch (parsed.action) {
        case "add":
          return handleAdd(parsed);
        case "list":
          return handleList();
        case "remove":
        case "cancel":
        case "delete":
          return handleRemove(parsed.target);
        case "pause":
          return handlePause(parsed.target);
        case "resume":
          return handleResume(parsed.target);
        case "status":
          return handleStatus(parsed.target);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use add, list, remove, pause, resume, or status.`,
          };
      }
    } catch (error) {
      logger.error("[CronScheduler] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
}

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list" };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "list").toLowerCase();

  if (["list", "ls"].includes(action)) return { action: "list" };

  if (["remove", "cancel", "delete", "pause", "resume", "status"].includes(action)) {
    return { action, target: parts[1] || "" };
  }

  if (action === "add") {
    // Extract schedule and command from quoted strings
    const quotes = trimmed.match(/"([^"]+)"/g) || [];
    const schedule = quotes[0] ? quotes[0].replace(/"/g, "") : parts[1] || "";
    const command = quotes[1]
      ? quotes[1].replace(/"/g, "")
      : parts.slice(2).join(" ").replace(/"/g, "");
    return { action: "add", schedule, command };
  }

  // Default: treat as add with natural language
  return {
    action: "add",
    schedule: trimmed,
    command: extractCommandFromNL(trimmed),
  };
}

function extractCommandFromNL(text) {
  // Try to extract command after time expression
  const timePatterns = [
    /every\s+(?:day|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+\d+[ap]m\s+/i,
    /every\s+\d+\s+(?:minute|hour|day|week)s?\s+/i,
    /tomorrow\s+at\s+\d+[ap]m\s+/i,
    /today\s+at\s+\d+[ap]m\s+/i,
    /at\s+\d+[ap]m\s+/i,
  ];

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      return text.substring(match.index + match[0].length).trim();
    }
  }

  return text;
}

function handleAdd(parsed) {
  const { schedule, command } = parsed;
  if (!schedule) {
    return { success: false, error: "No schedule provided." };
  }
  if (!command) {
    return { success: false, error: "No command provided." };
  }

  const cron = naturalLanguageToCron(schedule);
  const isRecurring = /every|daily|weekly|monthly|hourly/i.test(schedule);
  const id = generateId();

  let intervalMs = null;
  let handle = null;

  if (isRecurring) {
    intervalMs = cronToMs(cron);
    if (intervalMs) {
      handle = setInterval(() => {
        logger.info(`[CronScheduler:${id}] Triggered: ${command}`);
        const job = jobs.get(id);
        if (job && job.enabled) {
          job.lastRun = new Date().toISOString();
          job.runCount++;
        }
      }, intervalMs);
    }
  } else {
    // One-time: calculate delay
    const delay = calculateDelay(schedule);
    if (delay > 0) {
      handle = setTimeout(() => {
        logger.info(`[CronScheduler:${id}] One-time trigger: ${command}`);
        const job = jobs.get(id);
        if (job) {
          job.lastRun = new Date().toISOString();
          job.runCount++;
          job.enabled = false;
        }
      }, delay);
    }
  }

  jobs.set(id, {
    id,
    type: isRecurring ? "recurring" : "one-time",
    schedule,
    cron,
    command,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRun: null,
    runCount: 0,
    intervalMs,
    _handle: handle,
  });

  return {
    success: true,
    action: "add",
    jobId: id,
    type: isRecurring ? "recurring" : "one-time",
    schedule,
    cron,
    command,
    message: `Job "${id}" created: ${command} (${isRecurring ? cron : "one-time"}).`,
  };
}

function handleList() {
  const list = [];
  for (const [id, job] of jobs) {
    const { _handle, ...info } = job;
    list.push(info);
  }

  return {
    success: true,
    action: "list",
    jobs: list,
    jobCount: list.length,
  };
}

function handleRemove(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    return { success: false, error: `Job "${jobId}" not found.` };
  }

  if (job._handle) {
    if (job.type === "recurring") clearInterval(job._handle);
    else clearTimeout(job._handle);
  }
  jobs.delete(jobId);

  return {
    success: true,
    action: "remove",
    jobId,
    message: `Job "${jobId}" removed.`,
  };
}

function handlePause(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { success: false, error: `Job "${jobId}" not found.` };

  job.enabled = false;
  return { success: true, action: "pause", jobId, message: `Job "${jobId}" paused.` };
}

function handleResume(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { success: false, error: `Job "${jobId}" not found.` };

  job.enabled = true;
  return { success: true, action: "resume", jobId, message: `Job "${jobId}" resumed.` };
}

function handleStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { success: false, error: `Job "${jobId}" not found.` };

  const { _handle, ...info } = job;
  return { success: true, action: "status", job: info };
}

function naturalLanguageToCron(text) {
  const lower = text.toLowerCase().trim();

  // Already a cron expression
  if (/^[*0-9/,\-]+(\s+[*0-9/,\-]+){4}$/.test(lower)) return lower;

  // Every N minutes
  const minMatch = lower.match(/every\s+(\d+)\s+minute/);
  if (minMatch) return `*/${minMatch[1]} * * * *`;

  // Every N hours
  const hourMatch = lower.match(/every\s+(\d+)\s+hour/);
  if (hourMatch) return `0 */${hourMatch[1]} * * *`;

  // Every day at Xam/pm
  const dailyMatch = lower.match(/every\s+day\s+at\s+(\d{1,2})(am|pm)/);
  if (dailyMatch) {
    let hour = parseInt(dailyMatch[1], 10);
    if (dailyMatch[2] === "pm" && hour !== 12) hour += 12;
    if (dailyMatch[2] === "am" && hour === 12) hour = 0;
    return `0 ${hour} * * *`;
  }

  // Every weekday at Xam/pm
  const weekdayMatch = lower.match(/every\s+weekday\s+at\s+(\d{1,2})(am|pm)/);
  if (weekdayMatch) {
    let hour = parseInt(weekdayMatch[1], 10);
    if (weekdayMatch[2] === "pm" && hour !== 12) hour += 12;
    if (weekdayMatch[2] === "am" && hour === 12) hour = 0;
    return `0 ${hour} * * 1-5`;
  }

  // Every Monday/Tuesday/etc at Xam/pm
  const dayNames = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const dayMatch = lower.match(
    /every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2})(am|pm)/,
  );
  if (dayMatch) {
    let hour = parseInt(dayMatch[2], 10);
    if (dayMatch[3] === "pm" && hour !== 12) hour += 12;
    if (dayMatch[3] === "am" && hour === 12) hour = 0;
    return `0 ${hour} * * ${dayNames[dayMatch[1]]}`;
  }

  return lower;
}

function cronToMs(cron) {
  // Simple conversion for common intervals
  const minMatch = cron.match(/^\*\/(\d+)\s/);
  if (minMatch) return parseInt(minMatch[1], 10) * 60000;

  const hourMatch = cron.match(/^0\s\*\/(\d+)/);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 3600000;

  // Daily
  if (/^0\s\d+\s\*\s\*\s\*$/.test(cron)) return 86400000;

  return 3600000; // default 1 hour
}

function calculateDelay(text) {
  const lower = text.toLowerCase();
  const now = new Date();

  const atMatch = lower.match(/at\s+(\d{1,2})(am|pm)/);
  if (atMatch) {
    let hour = parseInt(atMatch[1], 10);
    if (atMatch[2] === "pm" && hour !== 12) hour += 12;
    if (atMatch[2] === "am" && hour === 12) hour = 0;

    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);

    if (lower.includes("tomorrow")) {
      target.setDate(target.getDate() + 1);
    } else if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    return Math.max(0, target.getTime() - now.getTime());
  }

  return 60000; // default 1 minute
}

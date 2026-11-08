"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Bounded diagnostics for synthetic journeys. Keep only related IPC error
// headers; never publish the environment-bearing application log.
function observeGoalJourneyErrors(child, { secrets = [] } = {}) {
  const errors = [];
  const attach = (stream) => {
    let pending = "";
    stream?.on("data", (bytes) => {
      const lines = (pending + bytes.toString("utf8")).split(/\r?\n/u);
      pending = lines.pop().slice(-4096);
      for (const line of lines) {
        const match =
          /^Error occurred in handler for '((?:project:(?:goal|risk)[a-z0-9:-]*|task:controlled[a-z0-9:-]*))': (.+)$/u.exec(
            line,
          );
        if (!match || errors.length >= 30) continue;
        let message = match[2].slice(0, 1500);
        for (const secret of secrets)
          if (secret)
            message = message.replaceAll(secret, "[fixture-secret-redacted]");
        errors.push({
          channel: match[1],
          message,
          at: new Date().toISOString(),
        });
      }
    });
  };
  attach(child.stdout);
  attach(child.stderr);
  return errors;
}
async function withGoalJourneyTimeout(operation, timeoutMs = 5000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("Journey observation timeout must be positive");
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            "Goal journey observation exceeded its deadline",
          );
          error.code = "GOAL_JOURNEY_OBSERVATION_TIMEOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function summarizeGoalJourneyError(error) {
  const names = [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TimeoutError",
    "AssertionError",
  ];
  const codes = [
    "ERR_ASSERTION",
    "MODULE_NOT_FOUND",
    "ERR_MODULE_NOT_FOUND",
    "GOAL_JOURNEY_OBSERVATION_TIMEOUT",
  ];
  const timeout = /Timeout (\d{1,6})ms exceeded/u.exec(String(error?.message));
  return {
    name: names.includes(error?.name) ? error.name : "Error",
    ...(codes.includes(error?.code) ? { code: error.code } : {}),
    message: timeout
      ? `Journey driver timeout after ${Number(timeout[1])}ms`
      : error?.code === "ERR_ASSERTION"
        ? "Journey assertion failed"
        : "Journey operation failed",
  };
}

function writeGoalJourneyEvidence(
  output,
  evidence,
  { terminal = false, required = true } = {},
) {
  if (
    evidence.persistenceError ||
    evidence.watchdogExpired ||
    evidence.unexpectedFailure
  )
    evidence.status = "failed";
  const destination = path.join(output, "journey.json");
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify(
        {
          ...evidence,
          status:
            !terminal && evidence.status === "passed"
              ? "finalizing"
              : evidence.status || "running",
        },
        null,
        2,
      ) + "\n",
    );
    fs.renameSync(temporary, destination);
    return true;
  } catch (error) {
    evidence.status = "failed";
    evidence.persistenceError ||= { name: error.name, code: error.code };
    if (required) throw error;
    return false;
  }
}

module.exports = {
  observeGoalJourneyErrors,
  withGoalJourneyTimeout,
  summarizeGoalJourneyError,
  writeGoalJourneyEvidence,
};

"use strict";

const {
  digestBusinessObjectContent,
} = require("./business-object-contract.js");
const formatters = new Map();
function invalid() {
  throw Object.assign(new Error("GOAL_INVALID_NOTIFICATION"), {
    code: "GOAL_INVALID_NOTIFICATION",
  });
}
function fields(value, allowed, required = allowed) {
  try {
    digestBusinessObjectContent(value);
  } catch {
    invalid();
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function formatter(timeZone) {
  let format = formatters.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      invalid();
    }
    if (formatters.size >= 100)
      formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone, format);
  }
  return format;
}
function normalizeGoalNotificationPolicy(value) {
  fields(value, ["channel", "mode", "quietHours"], ["channel", "mode"]);
  if (
    value.channel !== "in-app" ||
    !["changes-only", "silent"].includes(value.mode)
  )
    invalid();
  const policy = { channel: value.channel, mode: value.mode };
  if (Object.hasOwn(value, "quietHours")) {
    if (value.quietHours === null) policy.quietHours = null;
    else {
      const quiet = value.quietHours;
      fields(quiet, ["timeZone", "startMinute", "endMinute"]);
      if (
        typeof quiet.timeZone !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_./+-]{0,79}$/u.test(quiet.timeZone) ||
        !Number.isSafeInteger(quiet.startMinute) ||
        quiet.startMinute < 0 ||
        quiet.startMinute >= 1440 ||
        !Number.isSafeInteger(quiet.endMinute) ||
        quiet.endMinute < 0 ||
        quiet.endMinute >= 1440 ||
        quiet.startMinute === quiet.endMinute
      )
        invalid();
      formatter(quiet.timeZone);
      policy.quietHours = {
        timeZone: quiet.timeZone,
        startMinute: quiet.startMinute,
        endMinute: quiet.endMinute,
      };
    }
  }
  return policy;
}
function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    invalid();
  return value;
}
function isGoalNotificationQuiet(policy, at) {
  const quiet = normalizeGoalNotificationPolicy(policy).quietHours;
  epoch(at);
  if (!quiet) return false;
  const parts = formatter(quiet.timeZone).formatToParts(new Date(at));
  const minute =
    Number(parts.find((part) => part.type === "hour").value) * 60 +
    Number(parts.find((part) => part.type === "minute").value);
  return quiet.startMinute < quiet.endMinute
    ? minute >= quiet.startMinute && minute < quiet.endMinute
    : minute >= quiet.startMinute || minute < quiet.endMinute;
}
function nextGoalNotificationDelivery(policy, at) {
  epoch(at);
  if (!isGoalNotificationQuiet(policy, at)) return at;
  // Search in actual UTC minutes instead of adding a fixed zone offset. This
  // observes skipped/repeated wall-clock hours across daylight saving changes.
  let candidate = Math.floor(at / 60000) * 60000 + 60000;
  for (
    let index = 0;
    index < 2880 && candidate <= 253402300799999;
    index++, candidate += 60000
  )
    if (!isGoalNotificationQuiet(policy, candidate)) return candidate;
  invalid();
}

module.exports = {
  normalizeGoalNotificationPolicy,
  isGoalNotificationQuiet,
  nextGoalNotificationDelivery,
};

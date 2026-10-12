function windowError(code, message) {
  return Object.assign(new Error(`VERIFY-01 ${message}`), { code });
}

function timestamp(value) {
  if (typeof value !== "string") return NaN;
  // Frozen windows need an explicit timezone, valid calendar date, and at
  // most millisecond precision. Date.parse alone normalizes February 30 and
  // accepts local-time/numeric strings that are not suitable for admission.
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (!match) return NaN;
  const localUtc = `${match[1]}.${(match[2] || "").padEnd(3, "0")}Z`;
  const localTime = Date.parse(localUtc);
  if (
    !Number.isFinite(localTime) ||
    new Date(localTime).toISOString() !== localUtc
  )
    return NaN;
  return Date.parse(value);
}

/**
 * Admission immediately before a formal task starts or launches its agent.
 * This pure guard neither executes a task nor records an observation. It does
 * not establish human approval, account funding, or a provider spend limit.
 * Call with the full frozen task budget at task start; recheck with the
 * remaining required time at dispatch if preparation can span a window edge.
 */
export function assertVerify01ExecutionWindow(
  plan,
  { now = Date.now(), requiredTimeMs = 0 } = {},
) {
  const start = timestamp(plan?.window?.start);
  const end = timestamp(plan?.window?.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    !Number.isFinite(now) ||
    !Number.isFinite(requiredTimeMs) ||
    requiredTimeMs < 0
  ) {
    throw windowError(
      "CC_VERIFY01_WINDOW_INVALID",
      "execution window, current time, and required task duration must be valid",
    );
  }
  if (now < start) {
    throw windowError(
      "CC_VERIFY01_WINDOW_NOT_STARTED",
      "execution window has not started; no task may be launched",
    );
  }
  if (now >= end) {
    throw windowError(
      "CC_VERIFY01_WINDOW_EXPIRED",
      "execution window has expired; no task may be launched",
    );
  }
  if (requiredTimeMs > end - now) {
    throw windowError(
      "CC_VERIFY01_WINDOW_INSUFFICIENT_TIME",
      "execution window cannot fit the required task time budget",
    );
  }
  return { startedAt: now, windowEndMs: end };
}

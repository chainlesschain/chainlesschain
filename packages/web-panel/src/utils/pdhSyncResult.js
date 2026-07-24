/**
 * Interpret Personal Data Hub SyncReport objects without depending on Vue.
 * Registry failures and readiness-aware skips are returned as reports rather
 * than thrown exceptions, so every UI consumer must inspect status.
 */

export const SYNC_ENTITY_KEYS = Object.freeze([
  "events",
  "persons",
  "places",
  "items",
  "topics",
]);

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function optionalCount(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function optionalNonNegativeCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function syncEntityTotal(report) {
  const entityCounts = report?.entityCounts;
  if (!entityCounts || typeof entityCounts !== "object") return 0;
  return SYNC_ENTITY_KEYS.reduce(
    (total, key) => total + count(entityCounts[key]),
    0,
  );
}

export function analyzeSyncReport(report) {
  const validReport = !!report && typeof report === "object";
  const status =
    validReport && typeof report.status === "string"
      ? report.status
      : "invalid";
  const total = syncEntityTotal(report);
  const rawCount = count(report?.rawCount);
  const archivedRawCount = count(report?.archivedRawCount);
  const archiveFailureCount = count(report?.archiveFailureCount);
  const invalidCount = count(report?.invalidCount);
  const watermarkDeferred = report?.watermarkDeferred === true;
  const checkpointCommitted =
    typeof report?.checkpointCommitted === "boolean"
      ? report.checkpointCommitted
      : null;
  const durability = {
    archivedRawCount,
    archiveFailureCount,
    checkpointCommitted,
  };
  const pagination = {
    pageBudget: optionalCount(report?.pageBudget),
    nextPageBudget: optionalCount(report?.nextPageBudget),
    scanDeferredCount: count(report?.scanDeferredCount),
    watermarkLookbackMs: count(report?.watermarkLookbackMs),
    collectionSinceWatermark:
      typeof report?.collectionSinceWatermark === "string"
        ? report.collectionSinceWatermark
        : null,
  };
  const recovery = {
    attemptCount: count(report?.attemptCount),
    retryCount: count(report?.retryCount),
    totalRetryDelayMs: count(report?.totalRetryDelayMs),
    retryExhausted: report?.retryExhausted === true,
    retryAfterMs: optionalCount(report?.retryAfterMs),
    rateLimitReason:
      typeof report?.rateLimitReason === "string"
        ? report.rateLimitReason
        : null,
    rateLimitRemainingMinute: optionalNonNegativeCount(
      report?.rateLimitRemainingMinute,
    ),
    rateLimitRemainingDay: optionalNonNegativeCount(
      report?.rateLimitRemainingDay,
    ),
    sourceRequestCount: count(report?.sourceRequestCount),
    sourceRequestThrottleMs: count(report?.sourceRequestThrottleMs),
    sourceRequestRateLimitRemainingMinute: optionalNonNegativeCount(
      report?.sourceRequestRateLimitRemainingMinute,
    ),
    sourceRequestRateLimitRemainingDay: optionalNonNegativeCount(
      report?.sourceRequestRateLimitRemainingDay,
    ),
  };

  if (validReport && status === "skipped") {
    return {
      kind: "skipped",
      level: "info",
      completed: true,
      status,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      error: null,
      skipReason: report.skipReason || "NOT_READY",
      skipMessage: report.skipMessage || "来源当前未就绪",
    };
  }

  if (!validReport || status !== "ok") {
    return {
      kind: "failed",
      level: "error",
      completed: false,
      status,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      error:
        (validReport &&
          typeof report.error === "string" &&
          report.error.trim()) ||
        (status === "invalid" ? "未收到有效同步报告" : `同步状态：${status}`),
    };
  }

  if (
    watermarkDeferred ||
    archiveFailureCount > 0 ||
    checkpointCommitted === false ||
    invalidCount > 0 ||
    (rawCount > 0 && total === 0)
  ) {
    return {
      kind: "partial",
      level: "warning",
      completed: true,
      status,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      watermarkDeferred,
      error: null,
    };
  }

  if (total === 0) {
    return {
      kind: "empty",
      level: "info",
      completed: true,
      status,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      error: null,
    };
  }

  return {
    kind: "success",
    level: "success",
    completed: true,
    status,
    total,
    rawCount,
    ...durability,
    ...pagination,
    ...recovery,
    invalidCount,
    watermarkDeferred,
    error: null,
  };
}

export function analyzeSyncReports(reports) {
  if (!Array.isArray(reports)) {
    return {
      level: "error",
      completed: false,
      totalReports: 0,
      totalEntities: 0,
      success: 0,
      empty: 0,
      partial: 0,
      skipped: 0,
      failed: 1,
      analyses: [],
    };
  }

  const analyses = reports.map(analyzeSyncReport);
  const summary = {
    level: "success",
    completed: true,
    totalReports: analyses.length,
    totalEntities: analyses.reduce((total, item) => total + item.total, 0),
    success: analyses.filter((item) => item.kind === "success").length,
    empty: analyses.filter((item) => item.kind === "empty").length,
    partial: analyses.filter((item) => item.kind === "partial").length,
    skipped: analyses.filter((item) => item.kind === "skipped").length,
    failed: analyses.filter((item) => item.kind === "failed").length,
    analyses,
  };

  if (summary.failed > 0) {
    summary.level =
      summary.failed === summary.totalReports ? "error" : "warning";
    summary.completed = false;
  } else if (summary.partial > 0) {
    summary.level = "warning";
  } else if (summary.skipped > 0 || summary.success === 0) {
    summary.level = "info";
  }

  return summary;
}

export function selectImportantSyncReport(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  return (
    reports.find((report) => analyzeSyncReport(report).kind === "failed") ||
    reports.find((report) => analyzeSyncReport(report).kind === "partial") ||
    reports.find((report) => analyzeSyncReport(report).kind === "skipped") ||
    reports[reports.length - 1]
  );
}

"use strict";

/**
 * Convert the Registry's non-throwing SyncReport failure contract into the
 * `{ ok, report, reason, message }` shape used by one-click ADB collectors.
 */
function finalizeOneClickSyncReport(report) {
  if (report && report.status === "ok") {
    return { ok: true, report };
  }
  const status =
    report && typeof report.status === "string" ? report.status : "invalid";
  return {
    ok: false,
    reason: "SYNC_FAILED",
    message:
      (report && typeof report.error === "string" && report.error.trim()) ||
      `registry sync returned status=${status}`,
    report: report || null,
  };
}

const DEDICATED_COLLECTOR_METHODS = Object.freeze({
  "social-bilibili": "bilibiliAdbSync",
  "social-weibo": "weiboAdbSync",
  "social-douyin": "douyinAdbSync",
  "social-xiaohongshu": "xhsAdbSync",
  "social-toutiao": "toutiaoAdbSync",
  "social-kuaishou": "kuaishouAdbSync",
});

function failedDedicatedReport(report, error) {
  return {
    adapter: report?.adapter || "unknown",
    status: "error",
    rawCount: 0,
    archivedRawCount: 0,
    archiveFailureCount: 0,
    entityCounts: {
      events: 0,
      persons: 0,
      places: 0,
      items: 0,
      topics: 0,
    },
    invalidCount: 0,
    kgTripleCount: 0,
    ragDocCount: 0,
    durationMs: 0,
    error,
    watermark: null,
    watermarkDeferred: false,
    checkpointCommitted: false,
    pageBudget: null,
    nextPageBudget: null,
    scanDeferredCount: 0,
    watermarkLookbackMs: 0,
    collectionSinceWatermark: null,
    attemptCount: 0,
    retryCount: 0,
    totalRetryDelayMs: 0,
    retryExhausted: false,
    retryAfterMs: null,
    rateLimitReason: null,
    rateLimitRemainingMinute: null,
    rateLimitRemainingDay: null,
    sourceRequestCount: 0,
    sourceRequestThrottleMs: 0,
    sourceRequestRateLimitRemainingMinute: null,
    sourceRequestRateLimitRemainingDay: null,
  };
}

function emitSyncEvent(hub, event) {
  if (typeof hub?.registry?.onSyncEvent !== "function") {return;}
  try {
    hub.registry.onSyncEvent(event);
  } catch (_error) {
    // Progress listeners are best-effort.
  }
}

async function runDedicatedBatchCollectors(hub, reports) {
  if (!Array.isArray(reports)) {return reports;}
  const resolved = [...reports];

  for (let index = 0; index < resolved.length; index += 1) {
    const skipped = resolved[index];
    if (
      skipped?.status !== "skipped" ||
      skipped?.skipReason !== "DEDICATED_COLLECTOR_REQUIRED"
    ) {
      continue;
    }

    const methodName = DEDICATED_COLLECTOR_METHODS[skipped.adapter];
    const collect = methodName && hub?.[methodName];
    if (typeof collect !== "function") {continue;}

    emitSyncEvent(hub, {
      kind: "sync.batch.dedicated.start",
      adapter: skipped.adapter,
      phase: "collecting",
    });

    let result;
    try {
      result = await collect.call(hub, {});
    } catch (error) {
      result = {
        ok: false,
        reason: "COLLECTOR_THREW",
        message: error?.message || String(error),
      };
    }

    if (result?.ok === true && result.report?.status === "ok") {
      resolved[index] = result.report;
    } else {
      const reason = result?.reason || "DEDICATED_COLLECTOR_FAILED";
      const message =
        result?.message ||
        result?.report?.error ||
        "dedicated collector returned no successful SyncReport";
      resolved[index] = failedDedicatedReport(skipped, `${reason}: ${message}`);
    }

    emitSyncEvent(hub, {
      kind: "sync.batch.dedicated.done",
      adapter: skipped.adapter,
      phase: resolved[index].status,
      status: resolved[index].status,
      error: resolved[index].error || null,
    });
  }

  return resolved;
}

module.exports = {
  finalizeOneClickSyncReport,
  runDedicatedBatchCollectors,
  DEDICATED_COLLECTOR_METHODS,
};

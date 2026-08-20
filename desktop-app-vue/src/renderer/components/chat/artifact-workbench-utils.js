const WORKBENCH_SCHEMA = "cc-artifact-workbench/v1";
const RECOVERY_DECISIONS = new Set(["retry", "delete-orphan", "defer"]);

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateValue(value) {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

export function shapeArtifactWorkbench(payload) {
  if (
    !payload ||
    payload.schema !== WORKBENCH_SCHEMA ||
    !Array.isArray(payload.artifacts) ||
    !Array.isArray(payload.recovery?.items) ||
    !Array.isArray(payload.history?.activity)
  ) {
    return null;
  }

  const artifacts = payload.artifacts
    .filter((artifact) => artifact && typeof artifact.id === "string")
    .map((artifact) => ({
      id: artifact.id,
      title: stringValue(artifact.title) || artifact.id,
      kind: stringValue(artifact.kind) || "other",
      mime: stringValue(artifact.mime),
      size: finiteNumber(artifact.size, 0),
      sha256: stringValue(artifact.sha256),
      sessionId: stringValue(artifact.sessionId),
      createdAt: dateValue(artifact.createdAt),
      expiresAt: dateValue(artifact.expiresAt),
      immutable: artifact.immutable === true,
      recordDigest: stringValue(artifact.recordDigest),
      returnedResult:
        artifact.returnedResult &&
        typeof artifact.returnedResult.requestId === "string"
          ? {
              sessionId: stringValue(artifact.returnedResult.sessionId),
              requestId: artifact.returnedResult.requestId,
              reviewDigest: stringValue(artifact.returnedResult.reviewDigest),
              item: stringValue(artifact.returnedResult.item),
              kind: stringValue(artifact.returnedResult.kind),
              sourceDigest: stringValue(artifact.returnedResult.sourceDigest),
            }
          : null,
      history: {
        accessCount: finiteNumber(artifact.history?.accessCount, 0),
        latestAccess: artifact.history?.latestAccess
          ? {
              action: stringValue(artifact.history.latestAccess.action),
              client: stringValue(artifact.history.latestAccess.client),
              authorizedAt: stringValue(
                artifact.history.latestAccess.authorizedAt,
              ),
              eventDigest: stringValue(
                artifact.history.latestAccess.eventDigest,
              ),
            }
          : null,
      },
    }));

  const recoveryItems = payload.recovery.items
    .filter(
      (item) =>
        item &&
        typeof item.itemId === "string" &&
        typeof item.kind === "string" &&
        RECOVERY_DECISIONS.has(item.recommendedDecision),
    )
    .map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      severity: stringValue(item.severity) || "warning",
      timedOut: item.timedOut === true,
      recommendedDecision: item.recommendedDecision,
    }));

  const activity = payload.history.activity.slice(0, 200).map((event) => ({
    type: stringValue(event?.type) || "unknown",
    phase: stringValue(event?.phase),
    occurredAt: stringValue(event?.occurredAt),
    artifactId: stringValue(event?.artifactId),
    action: stringValue(event?.action),
    client: stringValue(event?.client),
    settlementId: stringValue(event?.settlementId),
    eventDigest: stringValue(event?.eventDigest),
  }));

  return {
    observedAt: stringValue(payload.observedAt),
    artifacts,
    recovery: {
      planDigest: stringValue(payload.recovery.planDigest),
      unattendedMutationAllowed:
        payload.recovery.policy?.unattendedMutationAllowed === true,
      summary: {
        itemCount: finiteNumber(
          payload.recovery.summary?.itemCount,
          recoveryItems.length,
        ),
        criticalCount: finiteNumber(payload.recovery.summary?.criticalCount, 0),
        timedOutCount: finiteNumber(payload.recovery.summary?.timedOutCount, 0),
      },
      items: recoveryItems,
    },
    history: {
      totalEventCount: finiteNumber(payload.history.totalEventCount, 0),
      truncated: payload.history.truncated === true,
      activity,
    },
  };
}

export function formatArtifactBytes(value) {
  const bytes = finiteNumber(value, 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortArtifactDigest(value) {
  const text = stringValue(value);
  if (!text) {
    return "—";
  }
  return text.length > 22 ? `${text.slice(0, 22)}…` : text;
}

export function recoveryDecisionLabel(decision) {
  return (
    {
      retry: "重试结算",
      "delete-orphan": "删除孤儿副本",
      defer: "暂缓处理",
    }[decision] || "复核"
  );
}

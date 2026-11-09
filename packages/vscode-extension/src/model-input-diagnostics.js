"use strict";
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/;
const reasons = [
  "expired",
  "scope_denied",
  "sink_denied",
  "untrusted_system_policy",
  "input_budget",
  "partition_ceiling",
  "unknown",
];
function check(ok) {
  if (!ok) throw new Error("Unsupported model-input diagnostic report");
}
function number(value, nullable = false) {
  if (nullable && value === null) return null;
  check(Number.isSafeInteger(value) && value >= 0);
  return value;
}
function digest(value) {
  check(value === null || (typeof value === "string" && HASH.test(value)));
  return value;
}
const sourceKinds = new Set([
  "system-policy",
  "tool-schema",
  "skill",
  "task-state",
  "message",
  "tool-evidence",
  "memory",
  "project-rule",
  "artifact-ref",
  "unknown",
]);
const mappingReasons = new Set([
  "complete",
  "planning_unbound",
  "projection_unbound",
  "mapping_limit",
  "protocol_unmapped",
  "body_unavailable",
  "body_mismatch",
]);
const protocols = new Set([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "ollama-chat",
]);
function parseSourceList(planning) {
  check(typeof planning.sourceDetailsCovered === "boolean");
  check(Array.isArray(planning.sources) && planning.sources.length <= 512);
  const sourceCount = number(planning.sourceCount);
  check(
    sourceCount >= planning.sources.length &&
      planning.sourcesTruncated === sourceCount > planning.sources.length,
  );
  return {
    sourceDetailsCovered: planning.sourceDetailsCovered,
    sourceCount,
    sourcesTruncated: planning.sourcesTruncated,
    sources: planning.sources.map((source, index) => {
      check(source.ordinal === index && sourceKinds.has(source.kind));
      check(["selected", "excluded"].includes(source.disposition));
      check(
        source.disposition === "selected"
          ? source.reason === null
          : reasons.includes(source.reason),
      );
      return {
        ordinal: index,
        digest: digest(source.digest),
        kind: source.kind,
        disposition: source.disposition,
        reason: source.reason,
      };
    }),
  };
}
function parseSourceMapping(mapping, phase) {
  check(
    mapping &&
      typeof mapping.covered === "boolean" &&
      mappingReasons.has(mapping.reason),
  );
  check(mapping.covered === (mapping.reason === "complete"));
  check(
    Number.isSafeInteger(mapping.sourceCount) &&
      mapping.sourceCount >= 0 &&
      Array.isArray(mapping.sources) &&
      mapping.sources.length <= 512 &&
      typeof mapping.sourcesTruncated === "boolean",
  );
  check(
    mapping.sourceCount >= mapping.sources.length &&
      (!mapping.covered ||
        (!mapping.sourcesTruncated &&
          mapping.sourceCount === mapping.sources.length)),
  );
  const slot = (entry) => {
    check(
      entry &&
        ["message", "tool"].includes(entry.kind) &&
        Number.isSafeInteger(entry.index) &&
        entry.index >= 0 &&
        entry.index < 4096,
    );
    return {
      kind: entry.kind,
      index: entry.index,
      digest: digest(entry.digest),
    };
  };
  const sources = mapping.sources.map((source, index) => {
    check(source.ordinal === index);
    if (phase === "logical-input") {
      check(
        Array.isArray(source.input) &&
          Array.isArray(source.logical) &&
          source.input.length === source.logical.length,
      );
      return {
        ordinal: index,
        input: source.input.map(slot),
        logical: source.logical.map(slot),
        changed: source.changed,
        redactionTouched: source.redactionTouched,
        injectionTouched: source.injectionTouched,
        derived: source.derived,
      };
    }
    check(["mapped", "excluded", "omitted"].includes(source.status));
    check(Array.isArray(source.fragments));
    return {
      ordinal: index,
      status: source.status,
      fragments: source.fragments.map((fragment) => {
        check(
          typeof fragment.path === "string" &&
            /^\/(?:messages\/\d+(?:\/content\/\d+)?|input\/\d+|tools\/\d+|system(?:\/0\/text)?)$/.test(
              fragment.path,
            ),
        );
        check(
          (fragment.start === null && fragment.end === null) ||
            (Number.isSafeInteger(fragment.start) &&
              Number.isSafeInteger(fragment.end) &&
              fragment.start >= 0 &&
              fragment.end >= fragment.start),
        );
        return {
          path: fragment.path,
          start: fragment.start,
          end: fragment.end,
          digest: digest(fragment.digest),
          bytes: number(fragment.bytes),
        };
      }),
    };
  });
  if (phase === "body-prepared")
    check(mapping.protocol === null || protocols.has(mapping.protocol));
  return {
    covered: mapping.covered,
    reason: mapping.reason,
    sourceCount: mapping.sourceCount,
    sourcesTruncated: mapping.sourcesTruncated,
    sources,
    ...(phase === "body-prepared" ? { protocol: mapping.protocol } : {}),
  };
}
function buildModelInputArgs(sessionId) {
  check(
    typeof sessionId === "string" &&
      /^[a-zA-Z0-9._-]{1,160}$/.test(sessionId) &&
      !sessionId.startsWith("-"),
  );
  return [
    "session",
    "show",
    sessionId,
    "--json",
    "--model-inputs",
    "--limit",
    "50",
  ];
}
function parseModelInputReport(text, sessionId) {
  check(typeof text === "string" && Buffer.byteLength(text) <= 8 * 1024 * 1024);
  const report = JSON.parse(text);
  check(
    report?.schema === "chainlesschain.session-model-inputs/v1" &&
      report.sessionId === sessionId,
  );
  check(
    report.billingVerified === false &&
      Array.isArray(report.records) &&
      report.records.length <= 50,
  );
  const total = number(report.total);
  check(
    total >= report.records.length &&
      report.truncated === total > report.records.length,
  );
  const records = report.records.map((record) => {
    check(
      typeof record.eventHash === "string" &&
        /^[a-f0-9]{64}$/.test(record.eventHash),
    );
    const row = record.diagnostic;
    check(
      row?.schema === "chainlesschain.model-input-diagnostic/v1" &&
        typeof row.requestId === "string" &&
        UUID.test(row.requestId),
    );
    check(
      row.usageCallId === null ||
        (typeof row.usageCallId === "string" &&
          /^(?:mdl|cmp|sub)-[a-f0-9-]{36}$/.test(row.usageCallId)),
    );
    check(row.billingVerified === false);
    const base = {
      requestId: row.requestId,
      usageCallId: row.usageCallId,
      phase: row.phase,
      bytes: number(row.bytes, true),
    };
    if (row.phase === "body-prepared") {
      check(
        ["adapter-body", "fetch-body", "governed-fetch-body"].includes(
          row.stage,
        ),
      );
      check(
        typeof row.bodyCovered === "boolean" &&
          row.providerAcceptanceVerified === false,
      );
      return {
        eventHash: record.eventHash,
        ...base,
        attempt: number(row.attempt, true),
        stage: row.stage,
        bodyCovered: row.bodyCovered,
        bodyDigest: digest(row.bodyDigest),
        providerAcceptanceVerified: false,
        ...(row.sourceMapping === undefined
          ? {}
          : {
              sourceMapping: parseSourceMapping(row.sourceMapping, row.phase),
            }),
      };
    }
    check(row.phase === "logical-input");
    const plan = row.planning,
      projection = row.projection;
    check(
      typeof plan?.covered === "boolean" &&
        typeof projection?.covered === "boolean",
    );
    const planDigest = digest(plan.digest);
    check(!plan.covered || planDigest !== null);
    const projectionSummary = {
      covered: projection.covered,
      manifestDigest: digest(projection.manifestDigest),
      projectionDigest: digest(projection.projectionDigest),
      rulesetDigest: digest(projection.rulesetDigest),
    };
    check(
      !projection.covered ||
        Object.values(projectionSummary).every((value) => value !== null),
    );
    return {
      eventHash: record.eventHash,
      ...base,
      logicalDigest: digest(row.logicalDigest),
      messageCount: number(row.messageCount),
      toolCount: number(row.toolCount),
      planning: {
        covered: plan.covered,
        digest: planDigest,
        selectedCount: number(plan.selectedCount, true),
        dropped: Object.fromEntries(
          reasons
            .filter((key) => Object.hasOwn(plan.dropped || {}, key))
            .map((key) => [key, number(plan.dropped[key])]),
        ),
        ...(plan.sources === undefined ? {} : parseSourceList(plan)),
      },
      projection: projectionSummary,
      ...(row.sourceMapping === undefined
        ? {}
        : { sourceMapping: parseSourceMapping(row.sourceMapping, row.phase) }),
    };
  });
  return {
    sessionId,
    total,
    truncated: report.truncated,
    records,
    billingVerified: false,
  };
}
async function openModelInputDiagnostics(
  vscode,
  { getSessionId, command, runCliResult, cwd } = {},
) {
  const sessionId = getSessionId?.();
  if (!sessionId) {
    await vscode.window.showInformationMessage(
      "当前没有可查询的会话。请先运行或恢复一个会话。",
    );
    return null;
  }
  try {
    const result = await runCliResult({
      command,
      cwd,
      args: buildModelInputArgs(sessionId),
      strictUtf8: true,
      maxBufferBytes: 8 * 1024 * 1024,
    });
    if (!result?.ok) throw new Error("CLI query failed");
    const report = parseModelInputReport(result.stdout, sessionId);
    if (getSessionId() !== sessionId) {
      await vscode.window.showInformationMessage(
        "会话已切换，请在当前会话重新打开模型输入诊断。",
      );
      return null;
    }
    if (!report.records.length) {
      await vscode.window.showInformationMessage(
        "该会话尚无模型输入诊断记录。请确认 CLI 支持此功能且会话已持久化。",
      );
      return null;
    }
    const content =
      "模型输入诊断\n会话：" +
      sessionId +
      "\n这些摘要描述准备的请求；服务端接收、模型理解和账单仍未验证。\n\n" +
      JSON.stringify(report, null, 2);
    const document = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content,
    });
    if (getSessionId() !== sessionId) {
      await vscode.window.showInformationMessage(
        "会话已切换，请在当前会话重新打开模型输入诊断。",
      );
      return null;
    }
    return vscode.window.showTextDocument(document, { preview: false });
  } catch {
    await vscode.window.showErrorMessage(
      "无法读取模型输入诊断。请检查会话完整性，并确认当前 CLI 支持 session show --model-inputs。",
    );
    return null;
  }
}
module.exports = {
  buildModelInputArgs,
  parseModelInputReport,
  openModelInputDiagnostics,
};

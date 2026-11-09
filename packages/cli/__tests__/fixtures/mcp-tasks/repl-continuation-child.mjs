import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const request = JSON.parse(process.env.CC_MCP_CONTINUATION_PROBE);
const { readMcpTaskJournal } =
  await import("../../../src/lib/mcp-task-journal.js");
if (process.argv[2] === "inspect") {
  const { readSessionHostResumeState } =
    await import("../../../src/lib/session-host-snapshot.js");
  const journal = readMcpTaskJournal(request.sessionId);
  const snapshot = readSessionHostResumeState(request.sessionId);
  const record = journal.continuations.find(
    (item) => item.localId === request.localId,
  );
  assert.equal(record?.phase, request.expectedPhase || "settled");
  assert.equal(snapshot.snapshot.verified, true);
  const messages = snapshot.messages;
  assert.equal(messages.filter((item) => item.role === "user").length, 1);
  assert.equal(
    messages.find((item) => item.role === "user").content,
    request.userPrompt,
  );
  assert.equal(
    messages.filter((item) => item.name === "mcp_task_result").length,
    1,
  );
  const answers = request.expectedPhase === "started" ? 0 : 1;
  assert.equal(
    messages.filter((item) => item.role === "assistant" && !item.name).length,
    answers,
  );
  if (answers)
    assert.ok(
      messages.some(
        (item) =>
          item.role === "assistant" &&
          !item.name &&
          item.content.includes(request.marker),
      ),
    );
  assert.equal(
    messages.some((item) => Object.hasOwn(item, "_cc_mcp_task_continuation")),
    false,
  );
  let modelInputDiagnostics;
  if (request.requireSourceMapping && answers) {
    const { readSessionModelInputDiagnostics } =
      await import("../../../src/lib/session-model-input-diagnostics.js");
    const report = readSessionModelInputDiagnostics(request.sessionId);
    assert.equal(report.truncated, false);
    const logical = report.records.filter(
      (r) => r.diagnostic.phase === "logical-input",
    );
    const wire = report.records.filter(
      (r) => r.diagnostic.stage === "fetch-body",
    );
    assert.equal(logical.length, 1);
    assert.equal(wire.length, 1);
    for (const record of [...logical, ...wire]) {
      assert.equal(record.diagnostic.sourceMapping.covered, true);
      assert.equal(record.diagnostic.sourceMapping.reason, "complete");
      assert.ok(record.diagnostic.sourceMapping.sourceCount > 0);
    }
    assert.equal(logical[0].diagnostic.planning.covered, true);
    assert.equal(wire[0].diagnostic.bodyCovered, true);
    assert.equal(logical[0].diagnostic.requestId, wire[0].diagnostic.requestId);
    modelInputDiagnostics = {
      records: report.total,
      sourceCount: logical[0].diagnostic.sourceMapping.sourceCount,
      planningDigest: logical[0].diagnostic.planning.digest,
      bodyDigest: wire[0].diagnostic.bodyDigest,
      logicalMappingCovered: true,
      bodyMappingCovered: true,
    };
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      phase: record.phase,
      assistantAnswers: answers,
      externalReferences: 1,
      realUserMessages: 1,
      beginEventHash: record.beginEventHash,
      endEventHash: record.endEventHash,
      outputDigest: record.outputDigest,
      ...(modelInputDiagnostics ? { modelInputDiagnostics } : {}),
    }) + "\n",
  );
} else {
  // Select the real readline REPL with a pipe, without claiming an OS PTY.
  Object.defineProperty(process.stdin, "isTTY", { value: true });
  process.stdin.setRawMode = () => {};
  const originalFetch = globalThis.fetch;
  const attempts = [];
  const save = () =>
    writeFileSync(
      request.transportReceipt,
      JSON.stringify({ attempts }, null, 2) + "\n",
    );
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target === request.mcpUrl) {
      assert.equal(options.method, "POST");
      const message = JSON.parse(options.body);
      assert.ok(
        [
          "server/discover",
          "tools/list",
          "resources/list",
          "resources/templates/list",
          "prompts/list",
          "tasks/get",
        ].includes(message.method),
      );
      return originalFetch(url, options);
    }
    assert.equal(target, request.modelEndpoint);
    assert.equal(
      attempts.length,
      0,
      "A continuation diagnostic permits only one model request",
    );
    const body = JSON.parse(options.body);
    assert.notEqual(body.stream, true);
    assert.ok(Buffer.byteLength(options.body) <= 128 * 1024);
    assert.equal(body.model, request.model);
    const outputLimit = body.max_output_tokens ?? body.max_tokens;
    if (["volcengine", "openai"].includes(request.provider)) {
      assert.ok(
        Number.isSafeInteger(outputLimit) &&
          outputLimit > 0 &&
          outputLimit <= 256,
      );
      assert.equal(request.confirmLive, true);
      const { resolveContinuationProbeEstimate } =
        await import("../../../scripts/lib/model-continuation-probe-admission.mjs");
      request.diagnosticEstimate = resolveContinuationProbeEstimate({
        provider: request.provider,
        model: request.model,
        inputBytes: Buffer.byteLength(options.body),
        outputTokens: outputLimit,
        pricing: request.pricing,
      });
    }
    const messages = body.messages || body.input;
    assert.ok(Array.isArray(messages));
    const contentText = (item) =>
      typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content)
          ? item.content.map((part) => part.text || "").join("\n")
          : "";
    const attempt = {
      startedAt: new Date().toISOString(),
      phase: "started",
      requestDigest: createHash("sha256").update(options.body).digest("hex"),
      userMessages: messages.filter((item) => item.role === "user").length,
      originalUserPreserved: messages.some(
        (item) =>
          item.role === "user" &&
          contentText(item).includes(request.userPrompt),
      ),
      externalReferences: messages.filter(
        (item) =>
          item.name === "mcp_task_result" ||
          (item.role === "assistant" &&
            contentText(item).startsWith("External MCP task result.")),
      ).length,
      hostSystemContinuation:
        (body.instructions || "").includes("This host continuation") ||
        messages.some(
          (item) =>
            item.role === "system" &&
            contentText(item).includes("This host continuation"),
        ),
      markerPresent: JSON.stringify(messages).includes(request.marker),
      fabricatedUserContinuation: messages.some(
        (item) =>
          item.role === "user" &&
          contentText(item).includes("Continue from the verified background"),
      ),
      requestedMaxOutputTokens:
        outputLimit ?? body.options?.num_predict ?? null,
      ...(request.diagnosticEstimate
        ? { diagnosticEstimate: request.diagnosticEstimate }
        : {}),
      protocol: body.input
        ? "openai-responses"
        : request.provider === "ollama"
          ? "ollama-chat"
          : "chat-completions",
    };
    attempts.push(attempt);
    save();
    assert.equal(attempt.userMessages, 1);
    assert.equal(attempt.originalUserPreserved, true);
    assert.equal(attempt.externalReferences, 1);
    assert.equal(attempt.hostSystemContinuation, true);
    assert.equal(attempt.markerPresent, true);
    assert.equal(attempt.fabricatedUserContinuation, false);
    if (request.holdAt === "before-dispatch") {
      setInterval(() => {}, 60_000);
      await new Promise(() => {});
    }
    const response = await originalFetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.any(
        [options.signal, AbortSignal.timeout(60_000)].filter(Boolean),
      ),
    });
    const copy = response.clone();
    const reader = copy.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        assert.ok(bytes <= 1024 * 1024, "Diagnostic response limit exceeded");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const captured = JSON.parse(Buffer.concat(chunks).toString());
    attempt.httpStatus = response.status;
    attempt.usage = captured.usage || {
      prompt_eval_count: captured.prompt_eval_count,
      eval_count: captured.eval_count,
    };
    attempt.responseDigest = createHash("sha256")
      .update(JSON.stringify(captured))
      .digest("hex");
    const responseText = captured.output
      ?.flatMap((item) => item.content || [])
      .map((part) => part.text || "")
      .join("\n");
    attempt.responseHasMarker = (
      captured.message?.content ??
      captured.choices?.[0]?.message?.content ??
      responseText ??
      ""
    ).includes(request.marker);
    attempt.phase = response.ok ? "captured" : "failed";
    save();
    if (request.holdAt === "after-response") {
      setInterval(() => {}, 60_000);
      await new Promise(() => {});
    }
    return response;
  };
  const { requireUnscopedModelTransport } =
    await import("../../../src/lib/formal-budget-provider-scope.js");
  requireUnscopedModelTransport();
  const { startAgentRepl } = await import("../../../src/repl/agent-repl.js");
  await startAgentRepl({
    provider: request.provider,
    model: request.model,
    baseUrl: request.baseUrl,
    apiKey:
      request.provider === "volcengine"
        ? process.env.VOLCENGINE_API_KEY
        : request.provider === "openai"
          ? process.env.OPENAI_API_KEY
          : undefined,
    sessionId: request.sessionId,
    mcpConfig: request.mcpConfig,
    useRegisteredMcp: false,
    ide: false,
    pdh: false,
    jetbrains: false,
    noStream: true,
    recallMemory: false,
    projectMemory: false,
    autoCheckpoint: false,
    enabledToolNames: [],
    exactToolNames: true,
    skipDb: true,
    screenReader: true,
    systemPrompt:
      "Use verified external task data only to answer the existing user request. Do not call tools. Reply with the requested topic marker only.",
    maxOutputTokens: 256,
  });
}

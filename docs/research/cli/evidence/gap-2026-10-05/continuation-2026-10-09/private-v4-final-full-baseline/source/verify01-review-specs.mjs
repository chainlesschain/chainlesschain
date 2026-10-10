// Frozen VERIFY-01 acceptance mutations. These are evaluator specifications,
// never agent answers or evidence of an executed provider/IDE task. Mutants are
// applied one at a time to disposable copies; the frozen plan is unchanged.
// sourcePath may name the behavior owner behind a catalog sourcePaths entry.
// Such a mutation-only mapping never expands task allowedChangedPaths.
export const VERIFY01_REVIEW_SPECS = [
  {
    taskId: "verify-01",
    sourcePath: "packages/cli/src/lib/model-capabilities.js",
    baselineTests: [
      "packages/cli/__tests__/unit/model-capabilities.test.js",
      "packages/cli/__tests__/unit/model-release-contract.test.js",
    ],
    mutants: [
      {
        name: "custom-endpoint-inherits-official-profile",
        find: "Boolean(catalog) && isOfficialModelBaseUrl(selectedProvider, baseUrl)",
        replace: "Boolean(catalog)",
      },
    ],
    rationale:
      "Frozen sourcePaths names the catalog; endpoint isolation is implemented by its profile consumer. Mutation-only target; task edit permissions are unchanged.",
  },
  {
    taskId: "verify-02",
    sourcePath: "packages/cli/src/lib/model-capabilities.js",
    baselineTests: [
      "packages/cli/__tests__/unit/model-capabilities.test.js",
      "packages/cli/__tests__/unit/model-release-contract.test.js",
    ],
    mutants: [
      {
        name: "unknown-suffix-inherits-certified-model",
        find: "officialEndpoint && selectedModel && Object.hasOwn(catalog, selectedModel)\n      ? catalog[selectedModel]\n      : null",
        replace:
          "officialEndpoint && selectedModel\n      ? Object.entries(catalog).find(([id]) => selectedModel.startsWith(id))?.[1] || null\n      : null",
      },
    ],
  },
  {
    taskId: "verify-03",
    sourcePath: "packages/cli/src/lib/llm-pricing.js",
    baselineTests: [
      "packages/cli/__tests__/unit/llm-pricing.test.js",
      "packages/cli/__tests__/unit/model-release-contract.test.js",
    ],
    mutants: [
      {
        name: "unknown-opus-inherits-legacy-price",
        find: 'e.match === "opus" &&',
        replace: 'e.match === "__disabled_unknown_family_guard__" &&',
      },
    ],
  },
  {
    taskId: "verify-04",
    sourcePath: "packages/cli/src/lib/usage-pricing-context.js",
    baselineTests: [
      "packages/cli/__tests__/unit/model-release-contract.test.js",
      "packages/cli/__tests__/unit/session-usage.test.js",
    ],
    mutants: [
      {
        name: "merge-short-and-long-request-price-buckets",
        find: "item.requestInputTokens > GPT6_PRICING_TERMS.longContext.threshold ===\n        long",
        replace: "true",
      },
      {
        name: "drop-cache-tokens-from-request-threshold",
        find: "usage.inputTokens +\n      (usage.cacheReadTokens || 0) +\n      (usage.cacheCreationTokens || 0)",
        replace: "usage.inputTokens",
      },
    ],
  },
  {
    taskId: "verify-05",
    sourcePath: "packages/cli/src/lib/agent-router.js",
    baselineTests: ["packages/cli/__tests__/unit/agent-router.test.js"],
    mutants: [
      {
        name: "installed-cli-passes-dispatch-preflight",
        find: "if (this._backends.some((backend) => !backend.isCLI)) return;",
        replace:
          "if (this._backends.some((backend) => !backend.isCLI || backend.installed)) return;",
      },
    ],
  },
  {
    taskId: "verify-06",
    sourcePath: "packages/cli/src/lib/orchestrator.js",
    baselineTests: [
      "packages/cli/__tests__/integration/orchestrator-workflow.test.js",
    ],
    mutants: [
      {
        name: "decomposition-before-backend-admission",
        find: "this._router.assertDispatchAvailable?.();",
        replace: "void this._router;",
      },
    ],
    rationale:
      "The command delegates preflight to Orchestrator.addTask. Mutation-only target; task edit permissions are unchanged.",
  },
  {
    taskId: "verify-07",
    sourcePath: "packages/cli/src/lib/session-transcript-history.js",
    baselineTests: [
      "packages/cli/__tests__/unit/session-transcript-history.test.js",
    ],
    mutants: [
      {
        name: "repeat-before-cursor-boundary",
        find: "else if (anchor && ordinal >= anchor.before) return;",
        replace: "else if (anchor && ordinal > anchor.before) return;",
      },
      {
        name: "skip-after-cursor-first-row",
        find: "if (ordinal < anchor.offset || incrementalFull) return;",
        replace: "if (ordinal <= anchor.offset || incrementalFull) return;",
      },
    ],
  },
  {
    taskId: "verify-08",
    sourcePath: "packages/cli/src/lib/session-branch-history.js",
    baselineTests: [
      "packages/cli/__tests__/unit/session-branch.test.js",
      "packages/cli/__tests__/unit/session-transcript-history.test.js",
    ],
    mutants: [
      {
        name: "accept-history-capability-from-wrong-parent",
        find: "plan.parentSessionId !== parentSessionId ||",
        replace: "false ||",
      },
    ],
  },
  {
    taskId: "verify-09",
    sourcePath: "packages/cli/src/lib/session-history-origins.js",
    baselineTests: [
      "packages/cli/__tests__/unit/session-history-origins.test.js",
    ],
    mutants: [
      {
        name: "trust-tampered-source-digest",
        find: "source?.sourceRef.digest === item.sourceRef.digest &&",
        replace: "Boolean(source) &&",
      },
    ],
  },
  {
    taskId: "verify-10",
    sourcePath: "packages/cli/src/lib/background-agent-list-index.js",
    baselineTests: [
      "packages/cli/__tests__/unit/background-agent-list-index.test.js",
    ],
    mutants: [
      {
        name: "reuse-index-after-state-update",
        find: "parsed.inventoryDigest !== inventory.digest ||",
        replace: "false ||",
      },
    ],
  },
  {
    taskId: "verify-11",
    sourcePath: "packages/cli/src/lib/background-interaction-journal.js",
    baselineTests: [
      "packages/cli/__tests__/unit/background-interaction-journal.test.js",
    ],
    mutants: [
      {
        name: "recover-same-question-from-other-session",
        find: "(options.expectedSessionId == null ||\n          binding.sessionId === options.expectedSessionId) &&",
        replace: "true &&",
      },
      {
        name: "expose-completed-records-as-pending",
        find: 'return this.records.filter((record) => record.status === "pending");',
        replace: "return this.records.slice();",
      },
    ],
  },
  {
    taskId: "verify-12",
    sourcePath: "packages/cli/src/lib/background-command-argv.js",
    baselineTests: [
      "packages/cli/__tests__/unit/background-command-argv.test.js",
    ],
    mutants: [
      {
        name: "flatten-spaces-and-empty-argv",
        find: "const source = [...(argv || [])];",
        replace:
          'const source = (argv || []).join(" ").split(/\\s+/u).filter(Boolean);',
      },
    ],
  },
  {
    taskId: "verify-13",
    sourcePath: "packages/cli/src/lib/image-file-boundary.js",
    baselineTests: ["packages/cli/__tests__/unit/image-file-boundary.test.js"],
    mutants: [
      {
        name: "ignore-image-change-on-pinned-handle",
        find: "after.mtimeMs !== before.mtimeMs ||\n      after.ctimeMs !== before.ctimeMs ||",
        replace: "false ||",
      },
      {
        name: "allow-over-pixel-budget",
        find: "info.width * info.height > MAX_INPUT_IMAGE_PIXELS",
        replace: "false",
      },
    ],
  },
  {
    taskId: "verify-14",
    sourcePath: "packages/cli/src/lib/image-input.js",
    baselineTests: [
      "packages/cli/__tests__/unit/image-input.test.js",
      "packages/cli/__tests__/unit/image-file-boundary.test.js",
    ],
    mutants: [
      {
        name: "attribute-error-to-wrong-image",
        find: "throw new Error(`Image ${index + 1}: ${error.message}`, { cause: error });",
        replace:
          "throw new Error(`Image ${index}: ${error.message}`, { cause: error });",
      },
    ],
  },
  {
    taskId: "verify-15",
    sourcePath: "packages/cli/src/lib/scoped-permission-store.js",
    baselineTests: [
      "packages/cli/__tests__/unit/scoped-permission-store.test.js",
    ],
    mutants: [
      {
        name: "wrap-exhausted-permission-counter",
        find: "if (value === Number.MAX_SAFE_INTEGER) {\n    throw scopedPermissionError(\n      SCOPED_PERMISSION_ERROR_CODES.INVALID,\n      `Scoped permission ${label} is exhausted`,\n    );\n  }",
        replace: "if (value === Number.MAX_SAFE_INTEGER) return 0;",
      },
    ],
  },
  {
    taskId: "verify-16",
    sourcePath: "packages/cli/src/lib/settings-source-observation.cjs",
    baselineTests: [
      "packages/cli/__tests__/unit/settings-source-observation.test.js",
    ],
    mutants: [
      {
        name: "ignore-opened-source-identity-change",
        find: "left[field] === right[field]",
        replace: "true",
      },
    ],
  },
  {
    taskId: "verify-17",
    sourcePath:
      "packages/cli/src/lib/process-execution-broker/process-ownership-journal.js",
    baselineTests: [
      "packages/cli/__tests__/unit/process-ownership-journal.test.js",
    ],
    mutants: [
      {
        name: "treat-corrupt-journal-as-empty",
        find: 'JSON.parse(bytes.subarray(0, length).toString("utf8")),',
        replace:
          '(() => { try { return JSON.parse(bytes.subarray(0, length).toString("utf8")); } catch { return { schema: SCHEMA, pending: [] }; } })(),',
      },
    ],
  },
  {
    taskId: "verify-18",
    sourcePath:
      "packages/cli/src/lib/process-execution-broker/process-ownership-quarantine.js",
    baselineTests: [
      "packages/cli/__tests__/unit/process-ownership-quarantine.test.js",
    ],
    mutants: [
      {
        name: "ignore-unresolved-in-memory-owner",
        find: "if (unresolvedOwners.size === 0) {",
        replace: "if (true) {",
      },
    ],
  },
  {
    taskId: "verify-19",
    sourcePath: "packages/cli/src/runtime/headless-stream.js",
    baselineTests: [
      "packages/cli/__tests__/unit/headless-stream-approvals.test.js",
    ],
    mutants: [
      {
        name: "cancellation-grants-pending-approval",
        find: "pending.resolve(false);",
        replace: "pending.resolve(true);",
      },
    ],
    rationale:
      "permission-request.js normalizes request labels only; pending approval cancellation is owned by headless-stream. Mutation-only target; task edit permissions are unchanged.",
  },
  {
    taskId: "verify-20",
    sourcePath: "packages/cli/src/lib/permission-decision.js",
    baselineTests: ["packages/cli/__tests__/unit/permission-decision.test.js"],
    mutants: [
      {
        name: "approval-overrides-policy-deny",
        find: "policy.decision || approval.decision || terminal.outcome",
        replace: "approval.decision || policy.decision || terminal.outcome",
      },
    ],
  },
  {
    taskId: "verify-21",
    sourcePath:
      "packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js",
    baselineTests: [
      "packages/cli/__tests__/unit/segmented-memory-port.test.js",
    ],
    mutants: [
      {
        name: "shadow-read-collects-authority-shards",
        find: "if (!this.readOnly) this._collect(manifest);",
        replace: "this._collect(manifest);",
      },
    ],
  },
  {
    taskId: "verify-22",
    sourcePath:
      "packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js",
    baselineTests: [
      "packages/cli/__tests__/unit/segmented-memory-port.test.js",
    ],
    mutants: [
      {
        name: "published-commit-reported-uncommitted",
        find: 'code: "CONTEXT_MEMORY_COMMIT_PUBLISHED",\n            committed: true,',
        replace:
          'code: "CONTEXT_MEMORY_COMMIT_PUBLISHED",\n            committed: false,',
      },
    ],
  },
  {
    taskId: "verify-23",
    sourcePath: "packages/cli/src/lib/eval/outcomes.js",
    baselineTests: ["packages/cli/__tests__/unit/task-outcome-report.test.js"],
    mutants: [
      {
        name: "remove-missing-samples-from-denominator",
        find: "const observation = observed.get(sample.id);\n    const reasons = [];",
        replace:
          "const observation = observed.get(sample.id);\n    if (!observation) continue;\n    const reasons = [];",
      },
      {
        name: "unknown-cost-becomes-zero",
        find: "      cost: null,\n      elapsedMs: null,",
        replace: "      cost: 0,\n      elapsedMs: null,",
      },
    ],
  },
  {
    taskId: "verify-24",
    sourcePath: "packages/cli/src/lib/eval/evidence.js",
    baselineTests: ["packages/cli/__tests__/unit/eval-evidence.test.js"],
    mutants: [
      {
        name: "compare-different-runtime-identities",
        find: "if (canonical(baseline?.comparison) !== canonical(candidate?.comparison))",
        replace: "if (false)",
      },
    ],
  },
  {
    taskId: "verify-25",
    sourcePath: "packages/vscode-extension/src/chat/draft-store.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-draft-store.test.js",
    ],
    mutants: [
      {
        name: "delete-prior-draft-before-atomic-publication",
        find: "const temporary = path.join(directory, `${crypto.randomUUID()}.tmp`);\n    try {",
        replace:
          'const temporary = path.join(directory, `${crypto.randomUUID()}.tmp`);\n    await fs.unlink(path.join(directory, "draft.json")).catch(() => {});\n    try {',
      },
    ],
  },
  {
    taskId: "verify-26",
    sourcePath: "packages/vscode-extension/src/chat/question-draft-contract.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-question-drafts.test.js",
    ],
    mutants: [
      {
        name: "persist-write-only-property",
        find: "schema.properties?.[f.name]?.writeOnly === true ||",
        replace: "false ||",
      },
      {
        name: "persist-unknown-schema-fallback",
        find: 'return [{ key: "answer-json", label: "Answer", kind: "password" }];',
        replace:
          'return [{ key: "answer-json", label: "Answer", kind: "text" }];',
      },
    ],
  },
  {
    taskId: "verify-27",
    sourcePath: "packages/vscode-extension/src/chat/question-drafts.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-question-drafts.test.js",
    ],
    mutants: [
      {
        name: "restore-mismatched-question-identity",
        find: "q.digest === r.digest &&\n            q.sessionId === r.sessionId &&\n            q.requestId === r.request.id &&",
        replace: "true &&",
      },
    ],
  },
  {
    taskId: "verify-28",
    sourcePath: "packages/vscode-extension/src/chat/question-form-drafts.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-question-drafts.test.js",
    ],
    mutants: [
      {
        name: "late-snapshot-overwrites-new-input",
        find: 'if (!f.dirty && f.state === "draft" && m.state === "draft")',
        replace: 'if (f.state === "draft" && m.state === "draft")',
      },
    ],
  },
  {
    taskId: "verify-29",
    sourcePath: "packages/vscode-extension/src/chat/permission-mode-state.js",
    baselineTests: ["packages/cli/__tests__/unit/vscode-ext-chat-mode.test.js"],
    mutants: [
      {
        name: "ack-from-other-session-accepted",
        find: "event.session_id !== conv.sessionId)",
        replace: "false)",
      },
    ],
  },
  {
    taskId: "verify-30",
    sourcePath: "packages/vscode-extension/src/chat/image-decode-budget.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-image-decode-budget.test.js",
    ],
    mutants: [
      {
        name: "collapse-animation-frame-count-and-cumulative-budget",
        find: "    frames++;",
        replace: "    frames = 1;",
      },
      {
        name: "ignore-animation-fallback-pixels",
        find: "width * height * (frames + extraCanvases) > 40_000_000",
        replace: "false",
      },
    ],
  },
  {
    taskId: "verify-31",
    sourcePath: "packages/vscode-extension/src/chat/image-file-snapshot.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-image-budget.test.js",
      "packages/cli/__tests__/unit/vscode-ext-draft-store.test.js",
    ],
    mutants: [
      {
        name: "leak-read-handle-on-failure",
        find: "    await handle.close();",
        replace: "    void handle;",
      },
    ],
  },
  {
    taskId: "verify-32",
    sourcePath: "packages/vscode-extension/src/chat/image-preview-gate.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-image-decode-budget.test.js",
    ],
    mutants: [
      {
        name: "cancelled-preview-resolves-successfully",
        find: 'if (active) active(new Error("Image decoding cancelled"));',
        replace: "if (active) active(null, []);",
      },
    ],
  },
  {
    taskId: "verify-33",
    sourcePath: "packages/vscode-extension/src/chat/image-attachments.js",
    baselineTests: [
      "packages/cli/__tests__/unit/vscode-ext-image-budget.test.js",
      "packages/cli/__tests__/unit/vscode-ext-chat-images.test.js",
    ],
    mutants: [
      {
        name: "reset-byte-budget-for-each-image",
        find: "total += size;",
        replace: "total = size;",
      },
    ],
  },
  {
    taskId: "verify-34",
    sourcePath: "packages/cli/scripts/task-outcome-report.mjs",
    baselineTests: ["packages/cli/__tests__/unit/task-outcome-report.test.js"],
    doc: true,
    requiredCommands: [
      "packages/cli/scripts/task-outcome-report.mjs",
      "--plan",
      "--fingerprint",
      "--plan-digest",
    ],
    conditions: [
      "Bind the reviewed frozen plan fingerprint before generating a report.",
      "Missing planned samples retain the fixed denominator and produce exit code 2.",
      "Unknown costs remain null; never substitute zero.",
      "A local baseline report must not be described as improvement PASS or production attestation.",
    ],
    mutants: [],
  },
  {
    taskId: "verify-35",
    sourcePath: "packages/cli/src/lib/model-failure-policy.js",
    baselineTests: [
      "packages/cli/__tests__/unit/fallback-model.test.js",
      "packages/cli/__tests__/integration/orchestrator-workflow.test.js",
    ],
    mutants: [
      {
        name: "retry-governance-rejection-as-provider-outage",
        find: 'current.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED" ||',
        replace: "false ||",
      },
    ],
  },
  {
    taskId: "verify-36",
    sourcePath: "packages/cli/src/lib/background-launch-profile.js",
    baselineTests: [
      "packages/cli/__tests__/unit/background-launch-profile.test.js",
    ],
    mutants: [
      {
        name: "restore-more-permissive-mode",
        find: 'pushValue(argv, "--permission-mode", p.permission.mode);',
        replace: 'pushValue(argv, "--permission-mode", "bypassPermissions");',
      },
    ],
  },
];

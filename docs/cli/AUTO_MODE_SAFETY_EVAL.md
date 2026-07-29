# Auto mode Safety Classifier Evaluation

Status: P2-15 complete (2026-07-29).

## Purpose

P2-15 provides a deterministic, offline benchmark for dangerous-operation
classification in Auto mode. It does not invoke a model, execute a corpus
command, access the network, or read any file named by a test case.

The benchmark separates two questions:

1. Did the classifier identify the dangerous intent with the expected stable
   category and reason code?
2. Does the existing policy composition preserve hard shell denies and require
   at least approval for a detected dangerous action?

The classifier is an additional defense signal. It does not replace managed
deny rules, credential guards, the Process Broker, or an OS filesystem/network
sandbox.

## Run

```bash
cc auto-mode eval
cc auto-mode eval --json
cc auto-mode eval --dataset ./custom-safety-dataset.json --json
```

The command returns exit code `0` only when every case and every objective gate
passes. The release floor is defined in trusted evaluator code: a custom
dataset cannot lower recall, raise the allowed false-positive/error counts,
reduce the six-category sample floor, or remove an operating system. Invalid
data and regressions return exit code `1`; JSON mode still emits exactly one
parseable report/error envelope.

The built-in suite is shipped inside the npm package at:

```text
packages/cli/src/data/auto-mode-safety-eval-v1.json
```

## Built-in corpus

Version `1.0.0` contains 145 labeled cases:

- 100 dangerous cases;
- 45 benign/category counterexamples;
- 6 or more positives for each release-critical category;
- Linux, macOS and Windows coverage;
- direct commands, compound commands, shell wrappers and structured tool
  calls;
- paired counterexamples such as `terraform destroy` versus `terraform plan`,
  production `kubectl apply` versus `kubectl diff`, and unconditional force
  push versus lease-protected push.

Release-critical categories:

| Category                       | Meaning                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `workspace.scope_escape`       | A mutating tool or shell write escapes declared workspace roots |
| `secret.egress`                | Credential/secret input is combined with an outbound sink       |
| `deployment.production`        | A command mutates an explicitly production environment          |
| `git.force_push`               | A remote ref is updated with unconditional force semantics      |
| `merge.unreviewed`             | A shared merge lacks trusted review/check/approval evidence     |
| `agent.third_party_unisolated` | A third-party agent disables approval or isolation boundaries   |

Additional regression categories cover destructive filesystem/infrastructure
operations, remote code execution, encoded PowerShell, and public artifact
publication.

## Objective CI gate

The built-in dataset requires:

- dangerous recall: `100%`;
- critical-tagged dangerous recall: `100%`;
- every release-critical category recall: `100%`;
- benign false-positive rate: `0%`;
- hard-deny bypasses: `0`;
- unsafe allows: `0`;
- unknown or contract-invalid classifier results: `0`;
- required reason-code and risk-floor misses: `0`.

The evaluator validates the complete classifier output contract, including its
schema/version, input base-risk binding, non-decreasing risk, signal-derived
severity and consistent categories/reason codes. Reports contain stable case
IDs, categories and reason codes only. Raw commands, arguments and JSON parser
fragments are deliberately omitted so corpus command content cannot leak
through CI output.

## Dataset contract

Custom datasets use schema
`chainlesschain.auto-mode-safety-dataset/v1`. Validation is fail-closed and
checks:

- strict top-level and case fields;
- SemVer dataset version;
- unique stable case IDs;
- maximum 64 KiB input per case and 2 MiB per dataset;
- positive cases with explicit required categories/reason codes/risk floor;
- negative cases with forbidden categories;
- paired positive/negative cases with a shared category;
- minimum case counts per release-critical category;
- minimum benign cases and platform tags bound to the declared input platform;
- category/reason identifiers that cannot mutate object prototypes or inject
  control characters.

The evaluator snapshots and freezes the dataset before validation/execution and
never trusts dataset metadata to weaken the release gate. All six canonical
categories, at least six positives per category, at least 18 negatives, all
three platforms, exact recall, zero false positives, zero unsafe allows and
zero unknown outputs remain mandatory.

## Runtime boundary

This task establishes the classifier, labeled corpus and regression gate. It
does not claim that every runtime tool is already routed through one universal
classifier:

- shell hard denies still run before ApprovalGate and cannot be upgraded by an
  Auto-mode allow decision;
- Git, MCP, third-party tools, hooks and Agent Teams have distinct admission
  paths;
- worktree isolation is not equivalent to OS process, network or credential
  isolation;
- the deterministic classifier recognizes the documented corpus syntax and a
  finite provider/tool allowlist; it is not a complete shell AST, arbitrary
  language source analyzer, or semantic model for every third-party schema;
- nested encodings such as heredocs or `env -S`, arbitrary provider-specific
  deployment forms, multi-stage download-then-execute flows, and generic
  `xargs` nesting remain outside the classifier's positive guarantee and must
  still be contained by deny rules and sandboxing;
- secret source/sink correlation is intentionally command-scoped and
  conservative, so a command that separately references a secret and an
  outbound sink may be escalated even when the values are not connected;
- a future runtime preflight must consume trusted provenance and may only raise
  risk or tighten a decision—it must never lower an existing policy result.

This boundary is intentional: wiring only one partial execution path would give
a false impression of global enforcement.

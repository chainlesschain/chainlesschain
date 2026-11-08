# MCP context scale benchmark

This archive records the local synthetic context benchmark at the current CLI source. It exercises the real skill loader, lazy body materialization, MCP tool deferral and exact schema selection at 200, 1,000 and 5,000 MCP tool definitions.

The run passed all three scales. It measured estimated metadata/schema tokens, lazy body loads, omitted descriptor search, exact schema selection and a deterministic synthetic keyword Recall@5 check. The benchmark does not call a provider, measure billed usage, or evaluate task quality; its non-target result ratio is not a model miscall rate. The 5,000 scale keeps the production skill discovery file budget by using a 1,000-entry skill fixture while measuring 5,000 MCP definitions.

Run from `packages/cli`:

```text
node scripts/implementation-plan-context-benchmark.mjs --output E:\code\chainlesschain\docs\cli\evidence\mcp-context-benchmark-20261108\report.json
```

Verify the archived report and current benchmark source:

```text
node docs/cli/evidence/mcp-context-benchmark-20261108/verify-evidence.mjs --check-current-source
```

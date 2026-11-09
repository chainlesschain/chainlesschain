# Real Volcengine MCP search smoke

This archive records one bounded real provider run at the 200-tool MCP scale.
The local credential came from `H:\\code\\api\\deepseek.txt`; its content was
never printed, committed, or written to the receipt.

The production `chatWithTools` path made two Volcengine requests. The first
request selected `tool_search` and searched for the exact target
`mcp__fixture__operation_7`; the host search returned one matching schema. The
second request emitted a call to that selected tool with the requested target.
No external MCP server was executed, so this proves provider-side discovery and
tool-call selection only. It is not a real Recall@5 campaign, miscall-rate
measurement, A/B comparison, billing verification, or 36+9 task result.

The receipt retains usage counts and digests only; response content and the
credential are excluded. Verify it with:

```text
node docs/cli/evidence/mcp-context-real-volcengine-20261108/verify-evidence.mjs --check-current-source
```

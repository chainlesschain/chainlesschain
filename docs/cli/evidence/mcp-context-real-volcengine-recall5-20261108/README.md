# Real Volcengine MCP Recall@5 smoke

This archive records five fixed-target provider queries at the 200-tool MCP
scale. The local credential came from `H:\\code\\api\\deepseek.txt`; its content
was never printed, committed, or written to the receipt.

Each target used two production `chatWithTools` requests: the first selected
`tool_search`, and the host returned one exact schema; the second emitted the
selected target tool call. All five targets were selected, giving a bounded
provider Recall@5 result of `1.0` (5/5 target calls). No external MCP server
was executed, so this does not measure tool execution success, miscall rate,
A/B quality, or billing. It is also separate from the 36+9 campaign.

The receipt retains usage counts and response digests only. Verify it with:

```text
node docs/cli/evidence/mcp-context-real-volcengine-recall5-20261108/verify-evidence.mjs --check-current-source
```

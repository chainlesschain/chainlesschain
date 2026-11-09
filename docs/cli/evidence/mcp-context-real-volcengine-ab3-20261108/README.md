# Real Volcengine MCP deferred/full A/B smoke

This archive records a bounded three-target comparison at the 200-tool MCP
scale. The local credential came from `H:\\code\\api\\deepseek.txt`; its content
was never printed, committed, or written to the receipt.

For each target, the deferred path used two requests (search, then selected
tool) and the full path used one request with all 200 definitions. All six
target calls were observed and no wrong tool call was emitted. The receipt
retains per-request usage and digests only. The first full-directory request
was much larger than later cache-hit requests, so these three rows are a
provider cache-sensitive smoke comparison, not a stable cost estimate.

No external MCP server was executed. `billingVerified:false`, and this does
not measure tool execution success, a production miscall rate, a complete
quality A/B, or the 36+9 campaign. Verify with:

```text
node docs/cli/evidence/mcp-context-real-volcengine-ab3-20261108/verify-evidence.mjs --check-current-source
```

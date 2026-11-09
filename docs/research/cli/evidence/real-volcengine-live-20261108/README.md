# Real Volcengine task receipt

This archive records one bounded real task through the production `chatWithTools` entry using the Volcengine Ark endpoint and model `deepseek-v4-1-flash-economy-261017`.

The credential was supplied from the local file `H:\code\api\deepseek.txt`; its content was never printed, committed, or written to the receipt. The task created a temporary fixture, asked the model to call `read_file`, executed that read through the host, and asked the model to confirm the marker. Two provider requests completed, the tool call and marker checks passed, and only request/response digests, lengths and usage counts were retained.

The receipt deliberately marks `billingVerified:false`: usage is observed, but no invoice or account billing statement was available. This is real provider/task evidence, not a 36+9 campaign result or a production paid-readiness claim.

Verify the source-bound receipt:

```text
node docs/research/cli/evidence/real-volcengine-live-20261108/verify-evidence.mjs --check-current-source
```

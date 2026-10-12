# Authorized Volcengine synthetic stream/tool smoke

Two authorized direct HTTPS requests completed with HTTP 200 for deepseek-v4-flash-ga-260731, default service tier and thinking disabled. The first stream finished with tool_calls/read_file for synthetic.txt; the fixed in-memory result was returned, and the second stream stopped with SMOKE_OK_731. Both raw SSE bodies match their captured/stored SHA256 metadata and independently parsed events.

Usage was 327 + 107 = 434 input tokens and 40 + 6 = 46 output tokens, with zero reported reasoning and cached tokens. The token-only estimate is CNY 0.001716 under the recorded 3/9-per-million rates; it is not billing confirmation or an FX conversion.

The final script SHA256 is 77d5da41f9f67a4a66c5310c2baa56bc6dc5c7dcdc9bfe6634ea879ade83d926. It has two dispatch call sites sharing one fixed-endpoint HTTPS implementation, an exclusive persistent attempt directory, at most two POST starts, zero automatic retries/redirects/fallback, and 128 max_tokens with thinking disabled. The synthetic tool reads no project files and invokes no shell or tool writes. The wrapper launches the helper process; evidence files are written locally.

The original Astra author review and official thinking-contract receipt are preserved separately from the final script and independent final AI review. The initial review stated root review was pending. Root subsequently revised byte capture; the final revision preserves original body bytes and records any key redaction explicitly. Both observed bodies were stored without redaction. No secret values were read during this archival review.

This is an independent direct-protocol diagnostic, not production Agent validation, frozen default-thinking acceptance, independent human approval or a formal sample. Formal evaluation remains NOT_RUN: 0/36 tasks and 0/9 first-run observations. No additional provider calls were made for archival.

See [summary.json](./summary.json) and [manifest.json](./manifest.json). All original scripts, process receipts, requests, raw SSE, metadata, parsed results and reviews are retained as gzip objects with original and compressed hashes.

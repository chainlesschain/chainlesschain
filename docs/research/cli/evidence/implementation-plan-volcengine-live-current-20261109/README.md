# Volcengine current-main diagnostic boundary (2026-11-09)

This authorized isolated-config run used the Volcengine key only through VOLCENGINE_API_KEY; no key or response text was persisted. The current main source binding is recorded in 
eceipt.json.

Three checks passed: streamed usage capture, provider output cap (max_tokens=1 observed as one output token), and the read-only fixture tool round-trip. The fourth check, provider-backed compaction fact retention, failed closed with ERR_ASSERTION after the fifth admitted request. No retry was admitted, all five requests were accounted for, and the receipt stores request/response digests and usage only. The failure identifies a current provider/compaction acceptance boundary but does not yet localize whether the bounded structured handoff was truncated or the retained facts were absent; formal paid admission and billing remain unverified.
